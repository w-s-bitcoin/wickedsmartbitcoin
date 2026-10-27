#!/usr/bin/env python3
"""Browser checks for the homepage's network KPIs and elapsed block timer.

Serves the real snapshot markup, styles, and scripts with in-memory clock,
publication, and WebSocket fixtures. No external feeds, published datasets, or
production jobs are read or changed.
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
    "/webapps/shared/bitcoin_chain_tip.js",
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
            "<script src='/webapps/shared/bitcoin_chain_tip.js'></script>"
            "<script src='/js/12_homepage_kpis.js'></script></body></html>").encode()


def harness_source():
    return """(() => {
      const state = window.__kpiTest = {
        now: FIXED_NOW, requests: 0, mode: 'fail', sockets: [], feedRequests: 0,
        visibility: 'visible', online: true,
        payload: {block_height: 973001, block_timestamp: (FIXED_NOW / 1000) - 300,
          supply_btc: 20000000, subsidy_btc: 3.125, difficulty: 100000000000000,
          projected_difficulty_adjustment_percent: 1.5},
      };
      Date.now = () => state.now;
      Object.defineProperty(document, 'visibilityState', {get: () => state.visibility, configurable: true});
      Object.defineProperty(navigator, 'onLine', {get: () => state.online, configurable: true});
      state.setVisible = visible => {
        state.visibility = visible ? 'visible' : 'hidden';
        document.dispatchEvent(new Event('visibilitychange'));
      };
      state.setOnline = online => {
        state.online = online;
        window.dispatchEvent(new Event(online ? 'online' : 'offline'));
      };
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
      // Exercise the real shared feed controller without permitting network I/O.
      class FixtureWebSocket extends EventTarget {
        static CONNECTING = 0; static OPEN = 1; static CLOSING = 2; static CLOSED = 3;
        constructor(url) {
          super(); this.url = url; this.readyState = 0; this.sent = [];
          state.sockets.push(this);
        }
        emit(type, data) {
          const event = type === 'message' ? new MessageEvent(type, {data}) : new Event(type);
          this[`on${type}`]?.(event);
          this.dispatchEvent(event);
        }
        send(data) {
          if (this.readyState !== 1) throw new Error('Fixture socket is not open');
          this.sent.push(JSON.parse(data));
        }
        close() {
          if (this.readyState === 3) return;
          this.readyState = 3; this.emit('close');
        }
      }
      window.WebSocket = FixtureWebSocket;
      state.feedOpen = () => {
        const socket = state.sockets.at(-1);
        if (!socket || socket.readyState === 3) throw new Error('No active fixture socket');
        if (socket.readyState === 0) { socket.readyState = 1; socket.emit('open'); }
      };
      state.feedPush = payload => {
        const socket = state.sockets.at(-1);
        if (!socket || socket.readyState !== 1) throw new Error('No open fixture socket');
        socket.emit('message', typeof payload === 'string' ? payload : JSON.stringify(payload));
      };
      state.block = (height, ageSeconds, variant = 0) => ({
        id: (BigInt(height) * 1000n + BigInt(variant)).toString(16).padStart(64, '0'),
        height, timestamp: (state.now / 1000) - ageSeconds, difficulty: 100000000000000,
      });
      window.fetch = async input => {
        const url = new URL(typeof input === 'string' ? input : input.url, location.href);
        if (url.origin !== location.origin) {
          state.feedRequests += 1;
          throw new TypeError('Isolated live REST failure');
        }
        if (url.pathname !== '/assets/top_kpis.json') throw new Error(`Unexpected fetch: ${url}`);
        state.requests += 1;
        if (state.mode === 'fail') throw new TypeError('Isolated refresh failure');
        const body = JSON.stringify(state.payload);
        if (state.mode === 'defer') await new Promise(resolve => { state.finishPublication = resolve; });
        return new Response(body, {
          status: 200, headers: {'Content-Type': 'application/json'},
        });
      };
    })();""".replace("FIXED_NOW", str(FIXED_NOW_MS))


STATE = """(() => {
  const progress = document.getElementById('homeKpiBlockProgress');
  const elapsed = document.getElementById('homeKpiBlockElapsed');
  const time = document.getElementById('homeKpiBlockTime');
  const meter = document.getElementById('homeKpiBlockMeter');
  const status = document.getElementById('homeKpiSnapshotStatus');
  return {
    value: progress?.value, max: progress?.max, tag: progress?.tagName,
    state: progress?.dataset.elapsedState, elapsedState: elapsed?.dataset.elapsedState,
    elapsed: elapsed?.textContent.trim(), color: elapsed ? getComputedStyle(elapsed).color : '',
    barColor: progress ? getComputedStyle(progress).accentColor : '',
    bandFill: progress ? getComputedStyle(progress).getPropertyValue('--block-band-fill') : '',
    bandStops: meter ? [10, 20, 30, 40].map(minutes =>
      parseFloat(getComputedStyle(meter).getPropertyValue(`--block-${minutes}m-stop`))) : [],
    scaleSeconds: meter ? Number(meter.dataset.scaleSeconds) : null,
    countdownScaleSeconds: meter?.dataset.countdownScaleSeconds == null
      ? null : Number(meter.dataset.countdownScaleSeconds),
    tickSpacing: meter ? parseFloat(getComputedStyle(meter).getPropertyValue('--block-tick-spacing')) : null,
    tickLabels: Array.from(document.querySelectorAll('#homeKpiBlockTicks [data-minutes]'),
      label => ({minutes: Number(label.dataset.minutes), text: label.textContent.trim()})),
    timestamp: time?.dateTime, displayedTime: time?.textContent,
    height: document.querySelector('#homeBip110HeightKpi .chip-value')?.textContent,
    snapshot: document.getElementById('homeBip110Kpis')?.dataset.snapshotState,
    source: document.getElementById('homeBip110Kpis')?.dataset.snapshotSource,
    status: document.getElementById('homeKpiSnapshotStatus')?.textContent,
    statusDisplay: status ? getComputedStyle(status).display : '',
    supply: document.getElementById('homeBip110SupplyKpi')?.title,
    supplyDisplayed: document.querySelector('#homeBip110SupplyKpi .chip-value')?.textContent,
    supplyCaption: document.getElementById('homeKpiSupplyCaption')?.textContent,
    supplyProgress: document.getElementById('homeKpiSupplyProgress')?.value,
    halving: document.getElementById('homeKpiHalvingRemaining')?.textContent,
    halvingProgress: document.getElementById('homeKpiHalvingProgress')?.value,
    difficulty: document.getElementById('homeKpiDifficultyRemaining')?.textContent,
    difficultyProgress: document.getElementById('homeKpiDifficultyProgress')?.value,
    difficultyPace: document.getElementById('homeKpiDifficultyMeter')?.dataset.pace,
    difficultyEpochCaption: document.getElementById('homeKpiDifficultyEpochCaption')?.textContent,
    difficultySchedule: document.getElementById('homeKpiDifficultyMeter')?.dataset.tooltip,
    difficultyTooltipContent: getComputedStyle(document.getElementById('homeKpiDifficultyMeter'), '::after').content,
    difficultyTooltipColor: getComputedStyle(document.getElementById('homeKpiDifficultyMeter'), '::after').color,
    difficultySegmentColor: getComputedStyle(document.querySelector('.snapshot-difficulty-variance')).backgroundColor,
    difficultyEstimateColor: getComputedStyle(document.getElementById('homeKpiDifficultyEstimate')).color,
    difficultySegmentStart: parseFloat(document.getElementById('homeKpiDifficultyMeter')?.style.getPropertyValue('--schedule-start')),
    difficultySegmentWidth: parseFloat(document.getElementById('homeKpiDifficultyMeter')?.style.getPropertyValue('--schedule-width')),
    difficultyEstimate: document.getElementById('homeKpiDifficultyEstimateValue')?.textContent,
    difficultyEstimateTrend: document.getElementById('homeKpiDifficultyEstimate')?.dataset.trend,
    difficultyEstimateHidden: document.getElementById('homeKpiDifficultyEstimate')?.hidden,
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


def check_bands(state, age_seconds):
    scale = max(600, age_seconds)
    expected = [min(100, minutes * 60 / scale * 100) for minutes in (10, 20, 30, 40)]
    require(len(state["bandStops"]) == 4 and
            all(abs(actual - target) < .001 for actual, target in zip(state["bandStops"], expected)),
            "Ten-minute color bands do not follow the elapsed scale", state)
    require(all(color in state["bandFill"] for color in
                ("#3ec735", "#2a4f1f", "#f7931a", "#5d3d16", "#eb3226")),
            "Elapsed bar lost one of its retained color bands", state)


def check_countdown_scale(state, seconds):
    check_scale(state, 600, 100)
    require(state.get("countdownScaleSeconds") == seconds,
            "Negative countdown scale was not held independently of the positive axis", state)


def check_gray(state, theme):
    gray = re.fullmatch(r"rgb\((\d+), (\d+), (\d+)\)", state["color"])
    require(gray is not None and len(set(gray.groups())) == 1
            and 0 < int(gray.group(1)) < 255,
            f"Future timer is not neutral gray in {theme} theme", state)
    require("linear-gradient" not in state["bandFill"],
            f"Future countdown inherited elapsed color bands in {theme} theme", state)


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
    check_bands(five_minutes, 300)
    requests = five_minutes["requests"]
    almost_ten = advance(cdp, 299)
    check_elapsed(almost_ten, "9m 59s ago", 599 / 600 * 100, "normal")
    ten_minutes = advance(cdp, 1)
    check_elapsed(ten_minutes, "10m 00s ago", 100, "normal")
    check_bands(ten_minutes, 600)
    require(ten_minutes["requests"] == requests, "Elapsed clock tick fetched network data", ten_minutes)
    require(ten_minutes["color"] == five_minutes["color"], "Ten-minute boundary changed from light green", ten_minutes)

    fifteen_minutes = advance(cdp, 300)
    check_elapsed(fifteen_minutes, "15m 00s ago", 100, "normal")
    check_bands(fifteen_minutes, 900)
    almost_twenty = advance(cdp, 299)
    check_elapsed(almost_twenty, "19m 59s ago", 100, "normal")
    require(almost_twenty["color"] == five_minutes["color"], "Light green ended before 20 minutes", almost_twenty)
    twenty_minutes = advance(cdp, 1)
    check_elapsed(twenty_minutes, "20m 00s ago", 100, "slow")
    require(twenty_minutes["color"] != almost_twenty["color"], "Orange did not start at 20 minutes", twenty_minutes)
    check_bands(twenty_minutes, 1200)
    check_scale(twenty_minutes, 1200, 50)
    labels = {label["minutes"]: label["text"] for label in twenty_minutes["tickLabels"]}
    require(labels.get(10) == "10m" and labels.get(20) == "20m",
            "Desktop elapsed scale lacks its ten- and twenty-minute labels", twenty_minutes)
    twenty_five_minutes = advance(cdp, 300)
    check_elapsed(twenty_five_minutes, "25m 00s ago", 100, "slow")
    check_bands(twenty_five_minutes, 1500)
    thirty_minutes = advance(cdp, 300)
    check_elapsed(thirty_minutes, "30m 00s ago", 100, "slow")
    check_bands(thirty_minutes, 1800)
    check_scale(thirty_minutes, 1800, 100 / 3)

    thirty_five_minutes = advance(cdp, 300)
    check_elapsed(thirty_five_minutes, "35m 00s ago", 100, "slow")
    check_bands(thirty_five_minutes, 2100)
    before_late = advance(cdp, LATE_SECONDS - 2101)
    require(before_late["state"] == "slow", "Red warning started before its threshold", before_late)
    late = advance(cdp, 1)
    check_elapsed(late, "40m 00s ago", 100, "late")
    check_bands(late, 2400)
    require(late["color"] != ten_minutes["color"], "Late boundary did not change color", late)
    forty_five_minutes = advance(cdp, 300)
    check_elapsed(forty_five_minutes, "45m 00s ago", 100, "late")
    check_bands(forty_five_minutes, 2700)
    hour = advance(cdp, 3600 - 2700)
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
    check_countdown_scale(future, 600)
    requests = future["requests"]

    halfway = advance(cdp, 30)
    check_elapsed(halfway, "−0m 30s", 5, "future")
    check_countdown_scale(halfway, 600)
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
        check_gray(themed, theme)
    cdp.evaluate("document.documentElement.dataset.theme = 'dark'")

    # Floor signed elapsed seconds: the last millisecond remains −1s, not −0s.
    last_millisecond = advance(cdp, 29.999)
    check_elapsed(last_millisecond, "−0m 01s", 1 / 6, "future")
    zero = advance(cdp, 0.001)
    check_elapsed(zero, "0m 00s ago", 0, "normal")
    check_scale(zero, 600, 100)
    require(zero["countdownScaleSeconds"] is None, "Zero retained the negative scale", zero)
    require(zero["color"] == normal["color"] and zero["color"] != future["color"],
            "Future timer did not return to green at zero", zero)
    positive = advance(cdp, 1)
    check_elapsed(positive, "0m 01s ago", 1 / 6, "normal")
    require(positive["requests"] == requests,
            "Future countdown, timezone, theme, or zero crossing fetched network data", positive)

    long_future = publish(cdp, -1200)
    check_elapsed(long_future, "−20m 00s", 100, "future")
    check_countdown_scale(long_future, 1200)
    shrinking = advance(cdp, 60)
    check_elapsed(shrinking, "−19m 00s", 95, "future")
    check_countdown_scale(shrinking, 1200)
    cdp.evaluate("window.WSBDashboardTime.setPreferredTimeZone('UTC')")
    zoned_long = snapshot(cdp)
    check_elapsed(zoned_long, shrinking["elapsed"], shrinking["value"], "future")
    check_countdown_scale(zoned_long, 1200)
    require(zoned_long["requests"] == long_future["requests"],
            "Long future countdown or timezone change fetched network data", zoned_long)

    cdp.evaluate("window.__kpiTest.mode = 'fail'; window.dispatchEvent(new Event('online'))")
    failed = wait_for(lambda: (state if (state := snapshot(cdp))["snapshot"] == "cached" else None),
                      description="failed refresh retains future block timestamp")
    retained = advance(cdp, 60)
    check_elapsed(retained, "−18m 00s", 90, "future")
    check_countdown_scale(retained, 1200)
    require(retained["timestamp"] == long_future["timestamp"]
            and retained["height"] == long_future["height"],
            "Failed refresh replaced the future block timestamp", retained)
    require(retained["requests"] == failed["requests"],
            "Retained future countdown fetched network data", retained)

    replacement = publish(cdp, -120)
    check_elapsed(replacement, "−2m 00s", 20, "future")
    check_countdown_scale(replacement, 600)
    long_again = publish(cdp, -1200)
    check_elapsed(long_again, "−20m 00s", 100, "future")
    check_countdown_scale(long_again, 1200)
    long_zero = advance(cdp, 1200)
    check_elapsed(long_zero, "0m 00s ago", 0, "normal")
    check_scale(long_zero, 600, 100)
    require(long_zero["countdownScaleSeconds"] is None,
            "Zero retained the expanded negative scale", long_zero)
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
    publish(cdp, 2700)
    for theme in ("dark", "light"):
        cdp.evaluate(f"document.documentElement.dataset.theme = {json.dumps(theme)}")
        late = snapshot(cdp)
        require(late["state"] == "late", f"Red band is not active in {theme} theme", late)
        check_bands(late, 2700)
        require(late["color"] == "rgb(235, 50, 38)" and late["barColor"] == late["color"],
                f"Elapsed time text does not match the reference-red bar in {theme} theme", late)
    cdp.evaluate("document.documentElement.dataset.theme = 'dark'")
    print("Passed: orange counters and matching reference-red bar/time in dark and light themes", flush=True)


def signed_bar_geometry(cdp, theme, future):
    geometry = cdp.evaluate("""(() => {
      const progress = document.getElementById('homeKpiBlockProgress');
      const bar = progress.getBoundingClientRect();
      const meter = document.getElementById('homeKpiBlockMeter').getBoundingClientRect();
      const zero = document.getElementById('homeKpiBlockZero').getBoundingClientRect();
      const axis = document.getElementById('homeKpiBlockTicks').getBoundingClientRect();
      const style = getComputedStyle(progress);
      const fillWidth = bar.width * progress.value / progress.max;
      const fillLeft = style.direction === 'rtl' ? bar.right - fillWidth : bar.left;
      return {
        state: progress.dataset.elapsedState, value: progress.value, direction: style.direction,
        meterLeft: meter.left, meterRight: meter.right, meterWidth: meter.width,
        zeroLeft: zero.left, zeroWidth: zero.width,
        axisLeft: axis.left, axisRight: axis.right, axisWidth: axis.width,
        barLeft: bar.left, barRight: bar.right, barWidth: bar.width, barTop: bar.top,
        fillLeft, fillRight: fillLeft + fillWidth, fillWidth,
        color: style.accentColor,
        bandFill: style.getPropertyValue('--block-band-fill'),
        counterColor: getComputedStyle(document.getElementById('homeKpiBlockElapsed')).color,
        supplyTop: document.getElementById('homeKpiSupplyProgress').getBoundingClientRect().top,
        clientWidth: document.documentElement.clientWidth,
        scrollWidth: document.documentElement.scrollWidth,
      };
    })()""")
    reserved_fraction = 0.2 * geometry["value"] / 100 if future else 0
    zero = geometry["meterLeft"] + geometry["meterWidth"] * reserved_fraction
    require(geometry["meterLeft"] <= geometry["zeroLeft"] < geometry["meterRight"]
            and geometry["zeroWidth"] > 0 and abs(geometry["zeroLeft"] - zero) < 1,
            "Zero marker does not follow the remaining countdown space", geometry)
    require(abs(geometry["axisLeft"] - zero) < 1
            and abs(geometry["axisRight"] - geometry["meterRight"]) < 1
            and abs(geometry["axisWidth"] - geometry["meterWidth"] * (1 - reserved_fraction)) < 1,
            "Ten-minute labels are not confined to the positive side of zero", geometry)
    require(abs(geometry["barTop"] - geometry["supplyTop"]) < 1,
            "Signed block bar no longer aligns with the supply bar", geometry)
    require(geometry["scrollWidth"] <= geometry["clientWidth"],
            "Signed block bar causes horizontal overflow", geometry)
    require(geometry["color"] == geometry["counterColor"],
            "Signed bar and counter colors differ", geometry)
    if future:
        check_gray(geometry, theme)
        require(geometry["state"] == "future" and geometry["direction"] == "ltr"
                and abs(geometry["barLeft"] - geometry["meterLeft"]) < 1
                and abs(geometry["barWidth"] - geometry["meterWidth"] * 0.2) < 1
                and abs(geometry["fillLeft"] - geometry["meterLeft"]) < 1
                and abs(geometry["fillRight"] - zero) < 1
                and geometry["fillLeft"] < zero,
                "Gray countdown does not fill the shrinking space left of zero", geometry)
    else:
        green = re.fullmatch(r"rgb\((\d+), (\d+), (\d+)\)", geometry["color"])
        require(green is not None and int(green.group(2)) > max(int(green.group(1)), int(green.group(3))),
                f"Nonnegative timer is not green in {theme} theme", geometry)
        require(geometry["state"] == "normal" and geometry["direction"] == "ltr"
                and abs(geometry["barLeft"] - zero) < 1
                and abs(geometry["barWidth"] - geometry["meterWidth"]) < 1
                and abs(geometry["fillLeft"] - zero) < 1
                and geometry["fillRight"] <= geometry["meterRight"] + 1,
                "Elapsed green bar does not use the full meter from the left edge", geometry)
    return geometry


def test_signed_bar_geometry(cdp):
    for width in (375, 320):
        cdp.command("Emulation.setDeviceMetricsOverride", {
            "width": width, "height": 900, "deviceScaleFactor": 1, "mobile": False,
        })
        cdp.evaluate("new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))")
        for theme in ("dark", "light"):
            cdp.evaluate(f"document.documentElement.dataset.theme = {json.dumps(theme)}")
            publish(cdp, -60)
            short = signed_bar_geometry(cdp, theme, future=True)
            advance(cdp, 30)
            short_half = signed_bar_geometry(cdp, theme, future=True)
            require(short_half["zeroLeft"] < short["zeroLeft"]
                    and abs(short_half["fillWidth"] / short["fillWidth"] - 0.5) < 0.001,
                    "A short countdown kept unused space before zero", short_half)
            publish(cdp, 30)
            signed_bar_geometry(cdp, theme, future=False)
            start = publish(cdp, -1200)
            full = signed_bar_geometry(cdp, theme, future=True)
            advance(cdp, 60)
            shrinking = signed_bar_geometry(cdp, theme, future=True)
            require(abs(shrinking["fillLeft"] - full["fillLeft"]) < 0.1
                    and abs(shrinking["fillWidth"] / full["fillWidth"] - 0.95) < 0.001
                    and shrinking["zeroLeft"] < full["zeroLeft"]
                    and shrinking["axisWidth"] > full["axisWidth"],
                    "Countdown space did not shrink and expand the positive axis", shrinking)
            advance(cdp, 1139)
            last_second = signed_bar_geometry(cdp, theme, future=True)
            require(0 < last_second["zeroLeft"] - last_second["meterLeft"] < 0.1,
                    "The last countdown second left a visible reserved gap", last_second)
            advance(cdp, 1)
            empty = signed_bar_geometry(cdp, theme, future=False)
            require(empty["fillWidth"] == 0 and empty["zeroLeft"] == empty["meterLeft"],
                    "Crossing zero retained negative space or a filled bar", empty)
            advance(cdp, 1)
            one_second = signed_bar_geometry(cdp, theme, future=False)
            require(one_second["fillWidth"] > 0 and one_second["fillRight"] > one_second["fillLeft"],
                    "The first elapsed second did not fill to the right", one_second)
            advance(cdp, 29)
            thirty_seconds = signed_bar_geometry(cdp, theme, future=False)
            require(thirty_seconds["fillWidth"] > one_second["fillWidth"]
                    and abs(thirty_seconds["value"] - 5) < 0.001
                    and thirty_seconds["zeroLeft"] == thirty_seconds["meterLeft"],
                    "Elapsed green fill did not grow right from the left edge", thirty_seconds)
            require(snapshot(cdp)["requests"] == start["requests"],
                    "Signed bar animation fetched new snapshot data", thirty_seconds)
    cdp.evaluate("document.documentElement.dataset.theme = 'dark'")
    cdp.command("Emulation.setDeviceMetricsOverride", {
        "width": 1440, "height": 1000, "deviceScaleFactor": 1, "mobile": False,
    })
    print("Passed: negative space shrinks to zero, then green uses the full width in both themes at 375px and 320px", flush=True)


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


def test_difficulty_schedule(cdp):
    for pace, height, difference, projection in (
        ("ahead", 973001, 36, 5.02),
        ("behind", 973002, -42, -3.14),
        ("ahead", 973727, 20, 1.00),
        ("behind", 973700, -27, -2.00),
    ):
        cdp.command("Page.reload")
        wait_for(lambda: snapshot(cdp)["snapshot"] == "error", description="cold schedule fixture")
        intervals = height % 2016
        mined_at = FIXED_NOW_MS // 1000 - 300
        start = mined_at - (intervals - difference) * 600
        cdp.evaluate(f"""(() => {{
          const test=window.__kpiTest;
          test.payload={{...test.payload,block_height:{height},block_timestamp:{mined_at},
            difficulty_epoch_start_timestamp:{start},projected_difficulty_adjustment_percent:{projection}}};
          test.mode='ok'; window.dispatchEvent(new Event('online'));
        }})()""")
        state = wait_for(lambda: (item if (item := snapshot(cdp))["snapshot"] == "ready" else None),
                         description=f"{pace} schedule")
        require(state["difficultyPace"] == pace and state["difficultySchedule"] ==
                f"{pace.capitalize()} by {abs(difference)} blocks", "Schedule variance text or state changed", state)
        require(not cdp.evaluate("!!document.querySelector('.snapshot-difficulty-schedule-mark')"),
                "Difficulty bar retained its target tick", state)
        require("Ahead" not in state["difficultyEpochCaption"] and "Behind" not in state["difficultyEpochCaption"],
                "Schedule variance should appear only in the bar tooltip", state)
        require(re.search(r"\b\d+(?:st|nd|rd|th) diff\. epoch\b", state["difficultyEpochCaption"]),
                "Difficulty caption lost its numbered epoch", state)
        require(state["difficultySegmentWidth"] > 0 and state["difficultyEstimateTrend"] ==
                ("up" if pace == "ahead" else "down") and state["difficultyEstimate"] == f"{abs(projection):.2f}%",
                "Projection or colored segment missing", state)
        actual = state["difficultyProgress"]
        expected = max(0, min(100, (intervals - difference + 1) / 2016 * 100))
        require((actual > expected) == (pace == "ahead") and
                abs(state["difficultySegmentStart"] - min(actual, expected)) < .001 and
                abs(state["difficultySegmentWidth"] - abs(actual - expected)) < .001,
                "Variance segment does not span scheduled and actual progress", state)
        expected_color = "rgb(62, 199, 53)" if pace == "ahead" else "rgb(235, 50, 38)"
        require(state["difficultySegmentColor"] == expected_color and
                state["difficultyEstimateColor"] == expected_color,
                "Segment and estimate do not share the expected pace color", state)
        geometry = cdp.evaluate("""(() => {
          const track = document.querySelector('.snapshot-difficulty-track');
          const progress = document.getElementById('homeKpiDifficultyProgress');
          const segment = document.querySelector('.snapshot-difficulty-variance');
          const box = element => { const r = element.getBoundingClientRect();
            return {left: r.left, right: r.right, top: r.top, bottom: r.bottom, height: r.height}; };
          const style = getComputedStyle(segment);
          return {track: box(track), progress: box(progress), segment: box(segment),
            clip: getComputedStyle(track).overflowX,
            leftCorners: [style.borderTopLeftRadius, style.borderBottomLeftRadius],
            rightCorners: [style.borderTopRightRadius, style.borderBottomRightRadius]};
        })()""")
        require(geometry["clip"] == "hidden" and
                abs(geometry["segment"]["top"] - geometry["progress"]["top"]) < .1 and
                abs(geometry["segment"]["height"] - geometry["progress"]["height"]) < .1 and
                geometry["leftCorners"] == ["0px", "0px"] and
                all(corner != "0px" for corner in geometry["rightCorners"]),
                "Schedule segment does not match the bar thickness and edge shape", geometry)
        require(geometry["segment"]["left"] >= geometry["track"]["left"] - .1 and
                geometry["segment"]["right"] <= geometry["track"]["right"] + .1,
                "Schedule segment crosses the gray track edge", geometry)
        if height % 2016 >= 1980:
            require(abs(geometry["segment"]["right"] - geometry["track"]["right"]) < .1,
                    "Near-end schedule segment did not stop at the track edge", geometry)
        cdp.evaluate("document.getElementById('homeKpiDifficultyProgress').focus()")
        focused = snapshot(cdp)
        require(focused["difficultySchedule"] in focused["difficultyTooltipContent"] and
                focused["difficultyTooltipColor"] == expected_color,
                "Keyboard focus did not reveal the matching schedule tooltip", focused)
        cdp.evaluate("document.getElementById('homeKpiDifficultyProgress').blur()")
        center = cdp.evaluate("""(() => { const r = document.getElementById('homeKpiDifficultyMeter').getBoundingClientRect();
          return {x: r.left + r.width / 2, y: r.top + r.height / 2}; })()""")
        cdp.command("Input.dispatchMouseEvent", {"type": "mouseMoved", **center})
        hovered = snapshot(cdp)
        require(hovered["difficultySchedule"] in hovered["difficultyTooltipContent"],
                "Hover did not reveal the schedule tooltip", hovered)
        cdp.command("Input.dispatchMouseEvent", {"type": "mouseMoved", "x": 0, "y": 0})
        if pace == "ahead" and height == 973001:
            cdp.evaluate(f"""(() => {{
              const test = window.__kpiTest;
              test.feedOpen();
              test.feedPush({{blocks: [test.block({height + 1}, 60)]}});
            }})()""")
            live = snapshot(cdp)
            require(live["source"] == "live" and live["difficultyPace"] == "ahead"
                    and not live["difficultyEstimateHidden"] and live["difficultySegmentWidth"] > 0,
                    "A same-epoch live block lost the schedule comparison", live)

    # The current published file may predate the exact epoch-start field.
    cdp.evaluate("""(() => {
      const test = window.__kpiTest;
      const {difficulty_epoch_start_timestamp, ...legacy} = test.payload;
      test.payload = legacy;
      window.dispatchEvent(new Event('online'));
    })()""")
    legacy = wait_for(lambda: (item if (item := snapshot(cdp))["requests"] > state["requests"] else None),
                      description="legacy projection fallback")
    require(legacy["difficultyPace"] == "behind" and not legacy["difficultyEstimateHidden"],
            "Legacy published projection did not retain a schedule comparison", legacy)

    # A cold live tip has no epoch anchor; neither a forecast nor a colored
    # schedule gap should be invented from a previous epoch's publication.
    cdp.command("Page.reload")
    wait_for(lambda: snapshot(cdp)["snapshot"] == "error", description="cold live schedule fixture")
    cdp.evaluate("window.__kpiTest.feedOpen();window.__kpiTest.feedPush({blocks:[window.__kpiTest.block(846720,1)]})")
    missing = snapshot(cdp)
    require(missing["difficultyPace"] == "unknown" and missing["difficultyEstimateHidden"] and
            missing["difficultySegmentWidth"] == 0, "Cold live tip invented a schedule estimate", missing)
    print("Passed: difficulty schedule ahead/behind segments, arrows, and unavailable fallback", flush=True)


def check_live_cards(state, height, supply, *, estimated=True):
    require(state["height"] == f"{height:,}", "Live block height did not update", state)
    expected_supply = f"{supply:,.8f} BTC"
    require(state["supply"].startswith(expected_supply),
            f"Supply should remain anchored to published issuance ({expected_supply})", state)
    require(("estimated" in state["supplyCaption"].lower()) == estimated,
            "Supply estimate is not identified accurately", state)
    require(abs(state["supplyProgress"] - supply / 21000000 * 100) < 1e-8,
            "Supply progress did not follow the live height", state)
    halving_remaining = (height // 210000 + 1) * 210000 - height
    difficulty_remaining = (height // 2016 + 1) * 2016 - height
    require(state["halving"] == f"{halving_remaining:,}"
            and abs(state["halvingProgress"] - (height % 210000 + 1) / 210000 * 100) < 1e-8,
            "Halving countdown or progress did not follow the live height", state)
    require(state["difficulty"] == f"{difficulty_remaining:,}"
            and abs(state["difficultyProgress"] - (height % 2016 + 1) / 2016 * 100) < 1e-8,
            "Difficulty countdown or progress did not follow the live height", state)


def visible_values(state):
    return {key: state[key] for key in (
        "height", "timestamp", "supply", "supplyCaption", "supplyProgress",
        "halving", "halvingProgress", "difficulty", "difficultyProgress",
    )}


def test_live_without_publication(cdp):
    cdp.command("Page.reload")
    wait_for(lambda: snapshot(cdp)["snapshot"] == "error", description="cold publication failure")
    cdp.evaluate("""(() => {
      const test = window.__kpiTest;
      test.feedOpen();
      test.feedPush({blocks: [test.block(846719, 37)]});
    })()""")
    live = snapshot(cdp)
    require(live["height"] == "846,719" and live["snapshot"] == "ready" and live["source"] == "live",
            "Live tip waited for an unavailable publication", live)
    check_elapsed(live, "0m 37s ago", 37 / 600 * 100, "normal")
    require(live["supplyDisplayed"] == "—" and live["supplyProgress"] == 0
            and "waiting" in live["supplyCaption"].lower(),
            "Cold live tip invented an authoritative supply anchor", live)
    require(live["halving"] == "203,281" and live["difficulty"] == "1",
            "Cold live tip did not update height-derived countdowns", live)
    cdp.evaluate("window.__kpiTest.feedPush({block: window.__kpiTest.block(846720, 1)})")
    boundary = snapshot(cdp)
    require(boundary["difficulty"] == "2,016"
            and abs(boundary["difficultyProgress"] - 100 / 2016) < 1e-8,
            "New difficulty epoch did not reset its countdown and progress", boundary)
    cdp.evaluate("""(() => {
      const test = window.__kpiTest;
      test.payload = {...test.payload, supply_btc: 19700000.875};
      test.publish(1, 846720);
    })()""")
    anchored = wait_for(
        lambda: (state if (state := snapshot(cdp))["supply"].startswith("19,700,000.87500000") else None),
        description="first supply publication installed below live cards",
    )
    check_live_cards(anchored, 846720, 19700000.875, estimated=False)
    print("Passed: cold live tip without invented supply, difficulty boundary, and publication recovery", flush=True)


def test_live_blocks(cdp):
    cdp.command("Emulation.setDeviceMetricsOverride", {
        "width": 1440, "height": 1000, "deviceScaleFactor": 1, "mobile": False,
    })
    cdp.command("Page.reload")
    wait_for(lambda: snapshot(cdp)["snapshot"] == "error", description="fresh isolated live fixture")
    cdp.evaluate("""(() => {
      const test = window.__kpiTest;
      test.payload = {...test.payload, block_height: 839998, supply_btc: 19680000.125,
        subsidy_btc: 6.25};
      test.publish(300, 839998);
    })()""")
    baseline = wait_for(lambda: (state if (state := snapshot(cdp))["height"] == "839,998" else None),
                        description="pre-halving published supply anchor")
    check_live_cards(baseline, 839998, 19680000.125, estimated=False)
    cdp.evaluate("""(() => {
      const test = window.__kpiTest;
      test.feedOpen();
      test.feedPush({blocks: [test.block(839997, 900), test.block(839999, 20), test.block(839998, 300)]});
    })()""")
    live = snapshot(cdp)
    check_live_cards(live, 839999, 19680006.375)
    check_elapsed(live, "0m 20s ago", 20 / 600 * 100, "normal")
    require(live["requests"] == baseline["requests"],
            "Live block update waited for a published snapshot fetch", live)
    require(live["source"] == "live" and "live" in live["status"].lower()
            and "mempool.space" in live["status"], "Live source is not identified", live)
    subscription = cdp.evaluate("window.__kpiTest.sockets.at(-1).sent")
    require(any(message.get("action") == "want" and "blocks" in message.get("data", [])
                for message in subscription), "Shared feed did not subscribe to blocks", subscription)

    # Finish an older publication after a new socket block has already arrived.
    cdp.evaluate("""(() => {
      const test = window.__kpiTest;
      test.payload = {...test.payload, block_height: 839999,
        block_timestamp: test.now / 1000 - 20, supply_btc: 19680006.225};
      test.mode = 'defer';
      window.dispatchEvent(new Event('online'));
    })()""")
    wait_for(lambda: cdp.evaluate("typeof window.__kpiTest.finishPublication === 'function'"),
             description="published refresh held in flight")
    cdp.evaluate("window.__kpiTest.feedPush({block: window.__kpiTest.block(840000, 7)})")
    halving = snapshot(cdp)
    check_live_cards(halving, 840000, 19680009.5)
    check_elapsed(halving, "0m 07s ago", 7 / 600 * 100, "normal")
    cdp.evaluate("window.__kpiTest.finishPublication(); window.__kpiTest.mode = 'ok'")
    reanchored = wait_for(
        lambda: (state if (state := snapshot(cdp))["supply"].startswith("19,680,009.35000000") else None),
        description="published supply correction applied below the live tip",
    )
    check_live_cards(reanchored, 840000, 19680009.35)
    require(reanchored["timestamp"] == halving["timestamp"],
            "Late published response rewound the live block timestamp", reanchored)

    # Same-height publication replaces the estimated supply with authoritative issuance.
    cdp.evaluate("""(() => {
      const test = window.__kpiTest;
      test.payload = {...test.payload, supply_btc: 19680009.2, subsidy_btc: 3.125};
      test.publish(7, 840000);
    })()""")
    caught_up = wait_for(
        lambda: (state if (state := snapshot(cdp))["supply"].startswith("19,680,009.20000000") else None),
        description="same-height authoritative supply correction",
    )
    check_live_cards(caught_up, 840000, 19680009.2, estimated=False)
    require(caught_up["source"] == "live", "Publication catchup dropped the live source", caught_up)

    for message in (
        "'{broken json'",
        "{block: {...window.__kpiTest.block(840001, 1), height: -1}}",
        "{block: {...window.__kpiTest.block(840001, 1), timestamp: 'invalid'}}",
        "{blocks: [window.__kpiTest.block(840001, 1), {height: 840002}]}",
    ):
        cdp.evaluate(f"window.__kpiTest.feedPush({message})")
        invalid = snapshot(cdp)
        require(visible_values(invalid) == visible_values(caught_up),
                "Malformed feed message replaced part of the complete snapshot", invalid)

    cdp.evaluate("window.__kpiTest.feedPush({block: window.__kpiTest.block(840000, 11, 1)})")
    replacement = snapshot(cdp)
    require(replacement["height"] == caught_up["height"]
            and replacement["timestamp"] != caught_up["timestamp"],
            "Same-height replacement retained the old block timestamp", replacement)
    check_elapsed(replacement, "0m 11s ago", 11 / 600 * 100, "normal")
    cdp.evaluate("window.__kpiTest.feedPush({blocks: [window.__kpiTest.block(839999, 70, 1)]})")
    reorganized = snapshot(cdp)
    check_live_cards(reorganized, 839999, 19680006.075)
    check_elapsed(reorganized, "1m 10s ago", 70 / 600 * 100, "normal")

    cdp.evaluate("window.WSBDashboardTime.setPreferredTimeZone('Asia/Kathmandu')")
    zoned = snapshot(cdp)
    require(zoned["timestamp"] == reorganized["timestamp"]
            and zoned["elapsed"] == reorganized["elapsed"]
            and zoned["displayedTime"] != reorganized["displayedTime"],
            "Timezone changed the live tip or its age", zoned)

    # A published anchor above a just-reorganized tip is not a new chain event.
    cdp.evaluate("window.__kpiTest.publish(7, 840000)")
    cdp.evaluate("new Promise(resolve => setTimeout(resolve, 50))")
    require(visible_values(snapshot(cdp)) == visible_values(zoned),
            "Unchanged publication undid the accepted lower-height reorganization", snapshot(cdp))

    # Even a higher publication can describe the abandoned chain. The healthy
    # socket remains authoritative about the active tip while supply is estimated.
    cdp.evaluate("""(() => {
      const test = window.__kpiTest;
      test.payload = {...test.payload, supply_btc: 19680024.825};
      test.publish(1, 840005);
    })()""")
    cdp.evaluate("new Promise(resolve => setTimeout(resolve, 50))")
    higher_publication = snapshot(cdp)
    require(visible_values(higher_publication) == visible_values(zoned)
            and higher_publication["source"] == "live",
            "Higher stale publication replaced the healthy reorganized live tip", higher_publication)

    # A publication matching the replacement tip is authoritative even though
    # its height is lower than the abandoned chain's last published anchor.
    cdp.evaluate("""(() => {
      const test = window.__kpiTest;
      test.payload = {...test.payload, supply_btc: 19680006.025, subsidy_btc: 6.25};
      test.publish(70, 839999);
    })()""")
    corrected_reorg = wait_for(
        lambda: (state if (state := snapshot(cdp))["supply"].startswith("19,680,006.02500000") else None),
        description="lower matching publication corrects reorganized supply",
    )
    check_live_cards(corrected_reorg, 839999, 19680006.025, estimated=False)
    require(corrected_reorg["timestamp"] == zoned["timestamp"]
            and corrected_reorg["source"] == "live",
            "Matching lower publication changed the live chain tip", corrected_reorg)

    cdp.evaluate("window.wsbDashboardExportActive = true; window.__kpiTest.sockets.at(-1).close()")
    frozen = advance(cdp, 30)
    require(visible_values(frozen) == visible_values(corrected_reorg)
            and frozen["snapshot"] == corrected_reorg["snapshot"]
            and frozen["status"] == corrected_reorg["status"]
            and frozen["elapsed"] == corrected_reorg["elapsed"],
            "Feed disconnection or timer tick changed the frozen export view", frozen)
    cdp.evaluate("window.wsbDashboardExportActive = false")
    disconnected = advance(cdp, 0)
    require(visible_values(disconnected) == visible_values(corrected_reorg),
            "Disconnection discarded the last complete live snapshot", disconnected)
    require(disconnected["snapshot"] == "cached"
            and ("unavailable" in disconnected["status"].lower()
                 or "last received" in disconnected["status"].lower()),
            "Disconnected block feed still claims to be live", disconnected)
    check_elapsed(disconnected, "1m 40s ago", 100 / 600 * 100, "normal")
    retained = advance(cdp, 30)
    check_elapsed(retained, "2m 10s ago", 130 / 600 * 100, "normal")
    require(retained["requests"] == disconnected["requests"],
            "Retained live timer fetched published data", retained)
    print("Passed: pushed block cards, halving math, publication races/catchup, malformed events, reorgs, timezone, export freeze/resume, and disconnect retention", flush=True)


def test_reconnect_pong_preserves_publication(cdp):
    cdp.command("Page.reload")
    wait_for(lambda: snapshot(cdp)["snapshot"] == "error", description="fresh reconnect fixture")
    cdp.evaluate("window.__kpiTest.publish(300, 973000)")
    wait_for(lambda: snapshot(cdp)["height"] == "973,000", description="initial reconnect publication")
    cdp.evaluate("""(() => {
      const test = window.__kpiTest;
      test.feedOpen();
      test.feedPush({blocks: [test.block(973001, 30)]});
    })()""")
    initial_live = snapshot(cdp)
    check_live_cards(initial_live, 973001, 20000003.125)
    cdp.evaluate("""(() => {
      const test = window.__kpiTest;
      test.sockets.at(-1).close();
      test.payload = {...test.payload, supply_btc: 20000009.375};
      test.publish(12, 973003);
    })()""")
    published = wait_for(
        lambda: (state if (state := snapshot(cdp))["height"] == "973,003" else None),
        description="newer publication catches up disconnected live feed",
    )
    check_live_cards(published, 973003, 20000009.375, estimated=False)
    require(published["source"] == "published", "New publication did not replace the old live fallback", published)
    wait_for(lambda: cdp.evaluate("window.__kpiTest.sockets.at(-1).readyState === 0"),
             description="shared feed reconnects after backoff")
    cdp.evaluate("window.__kpiTest.feedOpen(); window.__kpiTest.feedPush({pong: true})")
    pong = snapshot(cdp)
    require(visible_values(pong) == visible_values(published) and pong["source"] == "published",
            "Reconnect heartbeat promoted an older retained tip over the newer publication", pong)
    cdp.evaluate("window.__kpiTest.feedPush({block: window.__kpiTest.block(973004, 5)})")
    resumed = snapshot(cdp)
    check_live_cards(resumed, 973004, 20000012.5)
    check_elapsed(resumed, "0m 05s ago", 5 / 600 * 100, "normal")
    require(resumed["source"] == "live" and resumed["snapshot"] == "ready"
            and resumed["requests"] == published["requests"],
            "Fresh reconnect block did not resume live updates independently of publication", resumed)
    print("Passed: reconnect heartbeat preserves newer publication until a fresh live block arrives", flush=True)


def test_tab_resume_status(cdp):
    cdp.command("Page.reload")
    wait_for(lambda: snapshot(cdp)["snapshot"] == "error", description="fresh tab lifecycle fixture")
    cdp.evaluate("window.__kpiTest.publish(300, 973000)")
    wait_for(lambda: snapshot(cdp)["height"] == "973,000", description="tab lifecycle publication")
    cdp.evaluate("""(() => {
      const test = window.__kpiTest;
      test.feedOpen();
      test.feedPush({blocks: [test.block(973001, 30)]});
    })()""")
    live = snapshot(cdp)
    check_live_cards(live, 973001, 20000003.125)

    def expect_retained_status(*, warning):
        state = snapshot(cdp)
        require(visible_values(state) == visible_values(live),
                "Lifecycle status changed the last complete live values", state)
        if warning:
            require(state["snapshot"] == "cached" and state["statusDisplay"] != "none"
                    and "unavailable" in state["status"].lower(),
                    "A genuine outage lost its visible warning before confirmation", state)
        else:
            require(state["snapshot"] == "ready" and state["statusDisplay"] == "none",
                    "Intentional tab suspension or reconnect showed a warning", state)
        return state

    expect_retained_status(warning=False)
    cdp.evaluate("window.__kpiTest.setVisible(false)")
    expect_retained_status(warning=False)
    cdp.evaluate("window.__kpiTest.setVisible(true)")
    require(cdp.evaluate("window.__kpiTest.sockets.at(-1).readyState") == 0,
            "Resume fixture did not exercise an unconfirmed connection", snapshot(cdp))
    expect_retained_status(warning=False)
    cdp.evaluate("window.__kpiTest.feedOpen()")
    # Leave a full browser frame between reconnect and confirmation: the status
    # must stay hidden during the interval that caused the reported orange flash.
    cdp.evaluate("new Promise(resolve => requestAnimationFrame(resolve))")
    expect_retained_status(warning=False)
    cdp.evaluate("window.__kpiTest.feedPush({pong: true})")
    expect_retained_status(warning=False)

    cdp.evaluate("window.dispatchEvent(new Event('pagehide'))")
    expect_retained_status(warning=False)
    cdp.evaluate("window.dispatchEvent(new Event('pageshow'))")
    expect_retained_status(warning=False)
    cdp.evaluate("window.__kpiTest.feedOpen(); window.__kpiTest.feedPush({pong: true})")
    expect_retained_status(warning=False)

    # A real loss remains visible throughout the automatic reconnect, including
    # an open socket that has not yet confirmed the connection with a reply.
    cdp.evaluate("window.__kpiTest.sockets.at(-1).close()")
    expect_retained_status(warning=True)
    wait_for(lambda: cdp.evaluate("window.__kpiTest.sockets.at(-1).readyState === 0"),
             description="retry after genuine socket failure")
    expect_retained_status(warning=True)
    cdp.evaluate("window.__kpiTest.feedOpen()")
    expect_retained_status(warning=True)
    cdp.evaluate("window.__kpiTest.feedPush({pong: true})")
    expect_retained_status(warning=False)

    # Browser offline is a failure, even though the helper pauses its work.
    cdp.evaluate("window.__kpiTest.setOnline(false)")
    expect_retained_status(warning=True)
    cdp.evaluate("window.__kpiTest.setVisible(false); window.__kpiTest.setVisible(true)")
    expect_retained_status(warning=True)
    cdp.evaluate("window.__kpiTest.setOnline(true)")
    expect_retained_status(warning=True)
    cdp.evaluate("window.__kpiTest.feedOpen()")
    expect_retained_status(warning=True)
    cdp.evaluate("window.__kpiTest.feedPush({pong: true})")
    expect_retained_status(warning=False)

    # An initially uneventful resume must still report its first real failure.
    cdp.evaluate("window.__kpiTest.setVisible(false); window.__kpiTest.setVisible(true)")
    expect_retained_status(warning=False)
    cdp.evaluate("window.__kpiTest.sockets.at(-1).close()")
    expect_retained_status(warning=True)
    cdp.evaluate("window.dispatchEvent(new Event('pagehide')); window.dispatchEvent(new Event('pageshow'))")
    expect_retained_status(warning=True)
    cdp.evaluate("window.__kpiTest.feedOpen(); window.__kpiTest.feedPush({pong: true})")
    expect_retained_status(warning=False)
    print("Passed: quiet tab/page resume, persistent socket/offline warnings through retry, and confirmed recovery", flush=True)


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
                    test_signed_bar_geometry(cdp)
                    test_orange_theme_matching(cdp)
                    test_scale_layout(cdp)
                    test_difficulty_schedule(cdp)
                    test_live_without_publication(cdp)
                    test_live_blocks(cdp)
                    test_reconnect_pong_preserves_publication(cdp)
                    test_tab_resume_status(cdp)
                finally:
                    close_browser(chrome, cdp)
    finally:
        server.shutdown()
        server.server_close()


if __name__ == "__main__":
    main()
