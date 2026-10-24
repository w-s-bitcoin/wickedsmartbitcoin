#!/usr/bin/env python3
"""Browser checks for the homepage's elapsed block timer.

Serves the real snapshot markup, styles, and scripts with in-memory clock/fetch
fixtures. No published datasets or production jobs are read or changed.
"""

from __future__ import annotations

import json
import mimetypes
from pathlib import Path
import re
import subprocess
import threading
import urllib.parse
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

if __package__:
    from .browser_cdp import CdpSocket, free_port, wait_for
    from .capture_card_fallbacks import capture_workspace, close_browser, find_chrome
else:
    from browser_cdp import CdpSocket, free_port, wait_for
    from capture_card_fallbacks import capture_workspace, close_browser, find_chrome


ROOT = Path(__file__).resolve().parents[1]
FIXED_NOW_MS = 1792857600000  # 2026-10-24T16:00:00Z
LATE_SECONDS = 2400
SERVED_FILES = {
    "/assets/styles.css", "/assets/homepage.css",
    "/js/11_dashboard_timezone_preferences.js", "/js/12_homepage_kpis.js",
}


def fixture_html():
    source = (ROOT / "index.html").read_text()
    section = re.search(r'<section\b[^>]*id="homeBip110Kpis"[\s\S]*?</section>', source)
    clock = re.search(r'<div class="home-clock">[^\n]+</div>', source)
    body = re.search(r'<body\b[^>]*>', source)
    if not section or not clock or not body:
        raise AssertionError("Homepage snapshot or clock markup was not found")
    return ("<!doctype html><html lang='en' data-theme='dark'><head><meta charset='utf-8'>"
            "<link rel='stylesheet' href='/assets/styles.css'>"
            "<link rel='stylesheet' href='/assets/homepage.css'></head>"
            + body.group(0) + section.group(0) + clock.group(0)
            + "<script src='/js/11_dashboard_timezone_preferences.js'></script>"
            "<script src='/js/12_homepage_kpis.js'></script></body></html>").encode()


def harness_source():
    return """(() => {
      const state = window.__kpiTest = {
        now: FIXED_NOW, requests: 0, mode: 'fail',
        payload: {block_height: 973001, block_timestamp: (FIXED_NOW / 1000) - 300,
          supply_btc: 20000000, subsidy_btc: 3.125, difficulty: 100000000000000,
          projected_difficulty_adjustment_percent: 1.5},
      };
      Date.now = () => state.now;
      localStorage.clear();
      localStorage.setItem('wicked_dashboard_timezone_v1', 'UTC');
      const intervals = new Map();
      let nextInterval = 1;
      window.setInterval = (callback, delay, ...args) => {
        const id = nextInterval++;
        intervals.set(id, {callback, delay, args});
        return id;
      };
      window.clearInterval = id => intervals.delete(id);
      state.advance = seconds => {
        state.now += seconds * 1000;
        // Exercise the real one-second timer without also causing a data poll.
        for (const {callback, delay, args} of intervals.values()) {
          if (delay <= 1000) callback(...args);
        }
      };
      state.publish = (ageSeconds, height = state.payload.block_height + 1) => {
        state.payload = {...state.payload, block_height: height,
          block_timestamp: (state.now / 1000) - ageSeconds};
        state.mode = 'ok';
        window.dispatchEvent(new Event('online'));
      };
      window.fetch = async input => {
        const url = new URL(typeof input === 'string' ? input : input.url, location.href);
        if (url.pathname !== '/assets/top_kpis.json') throw new Error(`Unexpected fetch: ${url}`);
        state.requests += 1;
        if (state.mode === 'fail') throw new TypeError('Isolated refresh failure');
        return new Response(JSON.stringify(state.payload), {
          status: 200, headers: {'Content-Type': 'application/json'},
        });
      };
    })();""".replace("FIXED_NOW", str(FIXED_NOW_MS))


STATE = """(() => {
  const progress = document.getElementById('homeKpiBlockProgress');
  const elapsed = document.getElementById('homeKpiBlockElapsed');
  const time = document.getElementById('homeKpiBlockTime');
  const meter = document.getElementById('homeKpiBlockMeter');
  return {
    value: progress?.value, max: progress?.max, tag: progress?.tagName,
    state: progress?.dataset.elapsedState, elapsedState: elapsed?.dataset.elapsedState,
    elapsed: elapsed?.textContent.trim(), color: elapsed ? getComputedStyle(elapsed).color : '',
    barColor: progress ? getComputedStyle(progress).accentColor : '',
    scaleSeconds: meter ? Number(meter.dataset.scaleSeconds) : null,
    tickSpacing: meter ? parseFloat(getComputedStyle(meter).getPropertyValue('--block-tick-spacing')) : null,
    tickLabels: Array.from(document.querySelectorAll('#homeKpiBlockTicks [data-minutes]'),
      label => ({minutes: Number(label.dataset.minutes), text: label.textContent.trim()})),
    timestamp: time?.dateTime, displayedTime: time?.textContent,
    height: document.querySelector('#homeBip110HeightKpi .chip-value')?.textContent,
    snapshot: document.getElementById('homeBip110Kpis')?.dataset.snapshotState,
    requests: window.__kpiTest.requests,
  };
})()"""


def require(condition, message, state):
    if not condition:
        raise AssertionError(f"{message}: {state!r}")


def snapshot(cdp):
    return cdp.evaluate(STATE)


def publish(cdp, age_seconds):
    before = snapshot(cdp)
    cdp.evaluate(f"window.__kpiTest.publish({age_seconds})")
    return wait_for(
        lambda: (state if (state := snapshot(cdp))["snapshot"] == "ready"
                 and state["height"] != before["height"] else None),
        description="new published block installed",
    )


def advance(cdp, seconds):
    cdp.evaluate(f"window.__kpiTest.advance({seconds})")
    return snapshot(cdp)


def check_elapsed(state, text, progress, status):
    require(state.get("elapsed") == text, "Unexpected elapsed counter", state)
    require(abs(state.get("value", -1) - progress) < 0.001, "Unexpected elapsed progress", state)
    require(state.get("state") == status and state.get("elapsedState") == status,
            "Counter and progress disagree on elapsed status", state)
    require(state.get("barColor") == state.get("color"), "Counter and bar colors disagree", state)


def check_scale(state, seconds, spacing):
    require(state.get("scaleSeconds") == seconds, "Elapsed scale did not follow its displayed age", state)
    require(abs((state.get("tickSpacing") or 0) - spacing) < 0.001,
            "Tick lines are not spaced every ten minutes on the elapsed scale", state)


def test_elapsed_timer(cdp):
    cold = wait_for(lambda: (state if (state := snapshot(cdp))["snapshot"] == "error" else None),
                    description="cold snapshot failure")
    require(cold.get("tag") == "PROGRESS" and cold.get("max") == 100,
            "Block elapsed bar is not a native 100-percent progress element", cold)
    require(cold.get("value") == 0, "Missing data should leave an empty elapsed bar", cold)
    require("ago" not in (cold.get("elapsed") or ""), "Missing data invented an elapsed time", cold)
    require(cold.get("state") not in ("future", "normal", "slow", "late"),
            "Missing data has an active elapsed color", cold)

    five_minutes = publish(cdp, 300)
    check_elapsed(five_minutes, "5m 00s ago", 50, "normal")
    check_scale(five_minutes, 600, 100)
    requests = five_minutes["requests"]
    almost_ten = advance(cdp, 299)
    check_elapsed(almost_ten, "9m 59s ago", 599 / 600 * 100, "normal")
    ten_minutes = advance(cdp, 1)
    check_elapsed(ten_minutes, "10m 00s ago", 100, "slow")
    require(ten_minutes["requests"] == requests, "Elapsed clock tick fetched network data", ten_minutes)
    require(ten_minutes["color"] != five_minutes["color"], "Ten-minute boundary did not change color", ten_minutes)

    twenty_minutes = advance(cdp, 600)
    check_elapsed(twenty_minutes, "20m 00s ago", 100, "slow")
    check_scale(twenty_minutes, 1200, 50)
    labels = {label["minutes"]: label["text"] for label in twenty_minutes["tickLabels"]}
    require(labels.get(10) == "10m" and labels.get(20) == "20m",
            "Desktop elapsed scale lacks its ten- and twenty-minute labels", twenty_minutes)
    thirty_minutes = advance(cdp, 600)
    check_elapsed(thirty_minutes, "30m 00s ago", 100, "slow")
    check_scale(thirty_minutes, 1800, 100 / 3)

    before_late = advance(cdp, LATE_SECONDS - 1801)
    require(before_late["state"] == "slow", "Red warning started before its threshold", before_late)
    late = advance(cdp, 1)
    check_elapsed(late, "40m 00s ago", 100, "late")
    require(late["color"] != ten_minutes["color"], "Late boundary did not change color", late)
    hour = advance(cdp, 3600 - LATE_SECONDS)
    check_elapsed(hour, "1h 00m 00s ago", 100, "late")

    # Changing the displayed timezone changes the timestamp, not block age.
    cdp.evaluate("""(() => {
      const select = document.getElementById('homeKpiTimeZoneSelect');
      select.value = 'America/New_York';
      select.dispatchEvent(new Event('change', {bubbles: true}));
    })()""")
    zoned = snapshot(cdp)
    check_elapsed(zoned, hour["elapsed"], hour["value"], hour["state"])
    require(zoned["displayedTime"] != hour["displayedTime"] and zoned["timestamp"] == hour["timestamp"],
            "Timezone did not change only the timestamp presentation", zoned)
    require(zoned["requests"] == requests, "Timezone preference fetched new block data", zoned)

    reset = publish(cdp, 0)
    check_elapsed(reset, "0m 00s ago", 0, "normal")
    check_scale(reset, 600, 100)
    retained = publish(cdp, 30)
    cdp.evaluate("window.__kpiTest.mode = 'fail'; window.dispatchEvent(new Event('online'))")
    failed = wait_for(lambda: (state if (state := snapshot(cdp))["snapshot"] == "cached" else None),
                      description="failed refresh keeps last published block")
    still_ticking = advance(cdp, 90)
    check_elapsed(still_ticking, "2m 00s ago", 20, "normal")
    require(still_ticking["timestamp"] == retained["timestamp"] and still_ticking["height"] == retained["height"],
            "Refresh failure replaced the last complete block", still_ticking)
    require(still_ticking["requests"] == failed["requests"], "Retained clock tick fetched data", still_ticking)
    print("Passed: elapsed progress/color boundaries, local ticking, timezone, new blocks, and failure retention", flush=True)


def test_future_timestamp(cdp):
    normal = publish(cdp, 0)
    future = publish(cdp, -60)
    check_elapsed(future, "−1m 00s", 10, "future")
    check_scale(future, 600, 100)
    requests = future["requests"]

    halfway = advance(cdp, 30)
    check_elapsed(halfway, "−0m 30s", 5, "future")
    check_scale(halfway, 600, 100)
    cdp.evaluate("window.WSBDashboardTime.setPreferredTimeZone('Asia/Kathmandu')")
    zoned = snapshot(cdp)
    check_elapsed(zoned, halfway["elapsed"], halfway["value"], "future")
    require(zoned["displayedTime"] != halfway["displayedTime"]
            and zoned["timestamp"] == halfway["timestamp"],
            "Timezone changed the future timestamp or its remaining time", zoned)

    for theme in ("dark", "light"):
        cdp.evaluate(f"document.documentElement.dataset.theme = {json.dumps(theme)}")
        themed = snapshot(cdp)
        check_elapsed(themed, "−0m 30s", 5, "future")
        gray = re.fullmatch(r"rgb\((\d+), (\d+), (\d+)\)", themed["color"])
        require(gray is not None and len(set(gray.groups())) == 1
                and 0 < int(gray.group(1)) < 255,
                f"Future timer is not neutral gray in {theme} theme", themed)
    cdp.evaluate("document.documentElement.dataset.theme = 'dark'")

    # Floor signed elapsed seconds: the last millisecond remains −1s, not −0s.
    last_millisecond = advance(cdp, 29.999)
    check_elapsed(last_millisecond, "−0m 01s", 1 / 6, "future")
    zero = advance(cdp, 0.001)
    check_elapsed(zero, "0m 00s ago", 0, "normal")
    check_scale(zero, 600, 100)
    require(zero["color"] == normal["color"] and zero["color"] != future["color"],
            "Future timer did not return to green at zero", zero)
    positive = advance(cdp, 1)
    check_elapsed(positive, "0m 01s ago", 1 / 6, "normal")
    require(positive["requests"] == requests,
            "Future countdown, timezone, theme, or zero crossing fetched network data", positive)

    long_future = publish(cdp, -1200)
    check_elapsed(long_future, "−20m 00s", 100, "future")
    check_scale(long_future, 1200, 50)
    shrinking = advance(cdp, 60)
    check_elapsed(shrinking, "−19m 00s", 95, "future")
    check_scale(shrinking, 1200, 50)
    cdp.evaluate("window.WSBDashboardTime.setPreferredTimeZone('UTC')")
    zoned_long = snapshot(cdp)
    check_elapsed(zoned_long, shrinking["elapsed"], shrinking["value"], "future")
    check_scale(zoned_long, 1200, 50)
    require(zoned_long["requests"] == long_future["requests"],
            "Long future countdown or timezone change fetched network data", zoned_long)

    cdp.evaluate("window.__kpiTest.mode = 'fail'; window.dispatchEvent(new Event('online'))")
    failed = wait_for(lambda: (state if (state := snapshot(cdp))["snapshot"] == "cached" else None),
                      description="failed refresh retains future block timestamp")
    retained = advance(cdp, 60)
    check_elapsed(retained, "−18m 00s", 90, "future")
    check_scale(retained, 1200, 50)
    require(retained["timestamp"] == long_future["timestamp"]
            and retained["height"] == long_future["height"],
            "Failed refresh replaced the future block timestamp", retained)
    require(retained["requests"] == failed["requests"],
            "Retained future countdown fetched network data", retained)

    replacement = publish(cdp, -120)
    check_elapsed(replacement, "−2m 00s", 20, "future")
    check_scale(replacement, 600, 100)
    long_again = publish(cdp, -1200)
    check_elapsed(long_again, "−20m 00s", 100, "future")
    check_scale(long_again, 1200, 50)
    long_zero = advance(cdp, 1200)
    check_elapsed(long_zero, "0m 00s ago", 0, "normal")
    check_scale(long_zero, 600, 100)
    require(long_zero["requests"] == long_again["requests"],
            "Long future countdown crossing zero fetched network data", long_zero)
    print("Passed: signed gray future countdown, held scale, zero crossing, timezone, replacement, and failure retention", flush=True)


def test_orange_theme_matching(cdp):
    publish(cdp, 1200)
    for theme in ("dark", "light"):
        colors = cdp.evaluate("""(() => {
          document.documentElement.dataset.theme = THEME;
          return {
            bars: Array.from(document.querySelectorAll('.snapshot-card progress'),
              progress => ({id: progress.id, color: getComputedStyle(progress).accentColor})),
            counter: getComputedStyle(document.getElementById('homeKpiBlockElapsed')).color,
          };
        })()""".replace("THEME", json.dumps(theme)))
        require(len(colors["bars"]) == 4 and all(bar["color"] == "rgb(247, 147, 26)" for bar in colors["bars"]),
                f"Orange elapsed bar differs from the other bars in {theme} theme", colors)
        require(colors["counter"] == "rgb(247, 147, 26)",
                f"Orange counter differs from its bar in {theme} theme", colors)
    cdp.evaluate("document.documentElement.dataset.theme = 'dark'")
    print("Passed: orange counter and all four bars match in dark and light themes", flush=True)


def test_scale_layout(cdp):
    publish(cdp, 3600)
    cdp.evaluate("window.WSBDashboardTime.setPreferredTimeZone('Asia/Kathmandu')")
    layouts = []
    for width in (1440, 375, 320):
        cdp.command("Emulation.setDeviceMetricsOverride", {
            "width": width, "height": 900, "deviceScaleFactor": 1, "mobile": False,
        })
        cdp.evaluate("new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))")
        layouts.append(cdp.evaluate("""(() => {
          const block = document.getElementById('homeKpiBlockProgress');
          const supply = document.getElementById('homeKpiSupplyProgress');
          const meterElement = document.getElementById('homeKpiBlockMeter');
          const meter = meterElement.getBoundingClientRect();
          const height = document.querySelector('#homeBip110HeightKpi .chip-value').getBoundingClientRect();
          const heightRow = document.getElementById('homeBip110HeightKpi').getBoundingClientRect();
          const tickStyle = getComputedStyle(meterElement, '::before');
          const labels = Array.from(document.querySelectorAll('#homeKpiBlockTicks [data-minutes]'), label => {
            const box = label.getBoundingClientRect();
            return {text: label.textContent, left: box.left, right: box.right, width: box.width,
              hidden: label.hidden};
          });
          return {
            width: innerWidth, clientWidth: document.documentElement.clientWidth,
            scrollWidth: document.documentElement.scrollWidth,
            blockBarTop: block.getBoundingClientRect().top,
            supplyBarTop: supply.getBoundingClientRect().top,
            valueBarGap: block.getBoundingClientRect().top - heightRow.bottom,
            heightRight: height.right,
            blockCaptionHeight: document.querySelector('.snapshot-block-caption').getBoundingClientRect().height,
            supplyCaptionHeight: document.getElementById('homeKpiSupplyCaption').getBoundingClientRect().height,
            timestamp: document.getElementById('homeKpiBlockTime').textContent,
            elapsed: document.getElementById('homeKpiBlockElapsed').textContent,
            tickSpacing: parseFloat(getComputedStyle(meterElement).getPropertyValue('--block-tick-spacing')),
            tickBackgroundSpacing: parseFloat(tickStyle.backgroundSize),
            tickBackgroundImage: tickStyle.backgroundImage,
            meterLeft: meter.left, meterRight: meter.right, labels,
          };
        })()"""))
    for layout in layouts:
        require(layout["elapsed"] == "1h 00m 00s ago" and "GMT+5:45" in layout["timestamp"],
                "Responsive fixture did not exercise a long elapsed counter and timezone", layout)
        require(abs(layout["blockBarTop"] - layout["supplyBarTop"]) < 1,
                "First-row progress bars do not align", layouts)
        if layout["width"] == 1440:
            require(0 <= layout["valueBarGap"] <= 9,
                    "Desktop value-to-bar gap is no longer compact", layout)
        require(layout["scrollWidth"] <= layout["clientWidth"],
                "Long timezone or elapsed counter creates horizontal overflow", layouts)
        require(abs(layout["tickSpacing"] - 100 / 6) < 0.001,
                "Elapsed scale lost its ten-minute tick spacing", layout)
        require(layout["tickBackgroundImage"] != "none"
                and abs(layout["tickBackgroundSpacing"] - 100 / 6) < 0.001,
                "Hiding labels removed or changed the ten-minute tick lines", layout)
        require(any(label["hidden"] for label in layout["labels"]),
                "One-hour scale did not hide labels beneath the block height", layout)
        labels = sorted((label for label in layout["labels"] if not label["hidden"]),
                        key=lambda label: label["left"])
        require(bool(labels), "Elapsed scale has no readable labels", layout)
        require(all(label["width"] > 0 and label["left"] >= layout["heightRight"] + 5
                    for label in labels), "Elapsed labels crowd the block height", layout)
        require(all(label["left"] >= layout["meterLeft"] - 1 and label["right"] <= layout["meterRight"] + 1
                    for label in labels), "Elapsed labels overflow their bar", layout)
        require(all(left["right"] <= right["left"] for left, right in zip(labels, labels[1:])),
                "Elapsed labels overlap", layout)
    print("Passed: compact scale, height clearance, and aligned bars at 1440px, 375px, and 320px", flush=True)


def main():
    chrome_path = find_chrome()
    html = fixture_html()

    class FixtureHandler(BaseHTTPRequestHandler):
        def do_GET(self):
            path = urllib.parse.urlsplit(self.path).path
            if path == "/kpi-fixture.html":
                payload, content_type = html, "text/html"
            elif path in SERVED_FILES:
                payload = (ROOT / path.lstrip("/")).read_bytes()
                content_type = mimetypes.guess_type(path)[0] or "application/octet-stream"
            else:
                self.send_error(404)
                return
            self.send_response(200)
            self.send_header("Content-Type", content_type)
            self.send_header("Content-Length", str(len(payload)))
            self.send_header("Cache-Control", "no-store")
            self.send_header("Content-Security-Policy", "default-src 'self' 'unsafe-inline'; connect-src 'none'")
            self.end_headers()
            self.wfile.write(payload)

        def log_message(self, *_args):
            pass

    server = ThreadingHTTPServer(("127.0.0.1", 0), FixtureHandler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    try:
        with capture_workspace() as workspace:
            debug_port = free_port()
            with (workspace / "chrome.log").open("w+") as log:
                chrome = subprocess.Popen([
                    chrome_path, "--headless=new", "--disable-gpu", "--disable-dev-shm-usage",
                    "--no-first-run", "--no-default-browser-check", "--disable-background-networking",
                    "--remote-allow-origins=*", f"--remote-debugging-port={debug_port}",
                    f"--user-data-dir={workspace / 'profile'}", "about:blank",
                ], stdout=log, stderr=log, start_new_session=True)
                cdp = None
                try:
                    wait_for(lambda: urllib.request.urlopen(f"http://127.0.0.1:{debug_port}/json/version", timeout=.5).read(),
                             description="Chrome DevTools endpoint")
                    request = urllib.request.Request(f"http://127.0.0.1:{debug_port}/json/new?about:blank", method="PUT")
                    with urllib.request.urlopen(request, timeout=2) as response:
                        target = json.load(response)
                    cdp = CdpSocket(target["webSocketDebuggerUrl"])
                    cdp.command("Page.enable")
                    cdp.command("Runtime.enable")
                    cdp.command("Emulation.setDeviceMetricsOverride", {
                        "width": 1440, "height": 1000, "deviceScaleFactor": 1, "mobile": False,
                    })
                    cdp.command("Page.addScriptToEvaluateOnNewDocument", {"source": harness_source()})
                    cdp.command("Page.navigate", {"url": f"http://127.0.0.1:{server.server_port}/kpi-fixture.html"})
                    test_elapsed_timer(cdp)
                    test_future_timestamp(cdp)
                    test_orange_theme_matching(cdp)
                    test_scale_layout(cdp)
                finally:
                    close_browser(chrome, cdp)
    finally:
        server.shutdown()
        server.server_close()


if __name__ == "__main__":
    main()
