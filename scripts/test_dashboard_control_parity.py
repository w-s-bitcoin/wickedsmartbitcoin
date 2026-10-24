#!/usr/bin/env python3
"""Compare EOE and Moving Average controls in an isolated, offline Chrome.

Uses the existing frozen publication/CDP harness, never a user's browser profile
or mutable live data. CSS pseudo states are forced through DevTools, while
selected/disabled/menu/calendar states are reached through the real controls.
Run from the repository root; set CHROME_BIN if Chrome is installed elsewhere.
"""

import argparse
import base64
import json
import subprocess
import tempfile
import threading
import urllib.request
from http.server import ThreadingHTTPServer
from pathlib import Path

from test_comparison_live_price_browser import FrozenHandler
from test_eoe_growth_browser import freeze_data
from test_moving_average_browser import CHROME, FIXTURE, ROOT
from test_stage1_refresh_atomicity import CdpSocket, free_port, wait_for


STYLE_PROPERTIES = """
display box-sizing position font-family font-size font-weight font-style
line-height letter-spacing font-variant-numeric text-align text-transform
color background-color opacity cursor appearance accent-color
border-top-width border-right-width border-bottom-width border-left-width
border-top-style border-right-style border-bottom-style border-left-style
border-top-color border-right-color border-bottom-color border-left-color
border-top-left-radius border-top-right-radius border-bottom-right-radius border-bottom-left-radius
padding-top padding-right padding-bottom padding-left
margin-top margin-right margin-bottom margin-left
min-width min-height max-width max-height
gap row-gap column-gap align-items justify-content flex-grow flex-shrink flex-basis flex-wrap
outline-width outline-style outline-color outline-offset box-shadow text-shadow
""".split()


def item(selector, anchor=None, *, height=True, pseudo=False):
    return {"selector": selector, "anchor": anchor, "height": height, "pseudo": pseudo}


BASE = [
    item(".info-btn"),
    item("#copyDashboardLink", ".title-actions"),
    item("#resetDashboard", ".title-actions"),
    item(".date-range-panel"),
    item(".date-range-header", ".date-range-panel"),
    item("label[for='startDateInput']", ".date-range-header"),
    item("label[for='endDateInput']", ".date-range-header"),
    item("#startDateBtn", "label[for='startDateInput']"),
    item("#endDateBtn", "label[for='endDateInput']"),
    item("#startDateBtn svg", "#startDateBtn"),
    item(".date-range-range-control", ".date-range-header"),
    item("#rangeButtons", ".date-range-range-control"),
    item(".date-range-days-segment", "#rangeButtons"),
    item("#rangeDaysInput", ".date-range-days-segment"),
    item(".date-range-days-suffix", ".date-range-days-segment"),
    *[item(f"#rangeButtons button[data-range-preset='{value}']", "#rangeButtons")
      for value in ("ytd", "1y", "2y", "4y", "8y", "full")],
    item("#dateRangePlaybackControls", ".date-range-header"),
    *[item("#" + identifier, "#dateRangePlaybackControls", pseudo=identifier == "dateRangeSettingsBtn")
      for identifier in ("playBtn", "pauseBtn", "stopBtn", "speedBtn", "dashboardExpandBtn",
                         "downloadImageBtn", "dateRangeDownloadBtn", "dateRangeSettingsBtn")],
    item("#downloadImageBtn svg", "#downloadImageBtn"),
    item("#dashboardExpandBtn svg", "#dashboardExpandBtn"),
    item("#dateRangeSliderWrap", ".date-range-panel"),
    # Slider selections have different historical lower bounds; their track and
    # handle styles still need to agree. Deliberately exclude selection widths.
    item("#dateRangeStartSlider", "#dateRangeSliderWrap"),
    item("#dateRangeEndSlider", "#dateRangeSliderWrap"),
]

PLAYBACK = [entry for entry in BASE if entry["anchor"] == "#dateRangePlaybackControls"]
MENU = [
    item("#dateRangeSettingsBtn", pseudo=True),
    # Help text describes different charts, so only menu width/styles are shared.
    item("#dateRangeSettingsMenu", height=False),
    *[item(f"#download{group}Select [data-value='{value}']", f"#download{group}Select")
      for group, values in (("Orientation", ("landscape", "portrait", "square")),
                            ("Quality", ("720", "1080", "1440", "2160")),
                            ("Fps", ("30", "60", "120", "240")),
                            ("Theme", ("light", "dark"))) for value in values],
    item("#downloadEndFrameHoldToggle"),
    item("#downloadSettingsDownloadBtn"),
]
CALENDAR = [
    item(".date-picker-popup"),
    item(".date-picker-header", ".date-picker-popup"),
    item(".date-picker-nav:first-child", ".date-picker-header"),
    item(".date-picker-nav:last-child", ".date-picker-header"),
    item(".date-picker-header-label", ".date-picker-header"),
    item(".date-picker-grid", ".date-picker-popup"),
    item(".date-picker-dow", ".date-picker-grid"),
    item(".date-picker-day.dp-selected", ".date-picker-grid"),
    item(".date-picker-day:not(.dp-empty):not(.dp-selected):not(.dp-disabled)", ".date-picker-grid"),
    item(".date-picker-day.dp-disabled", ".date-picker-grid"),
]


def click(cdp, selector):
    cdp.evaluate(f"document.querySelector({json.dumps(selector)}).click()")


def settle(cdp):
    # Wait for transitions, not arbitrary timeouts. Infinite progress animations
    # are irrelevant to these control snapshots and must not block the suite.
    cdp.evaluate("""(async()=>{
      await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
      await Promise.all(document.getAnimations().filter(animation=>
        Number.isFinite(animation.effect.getComputedTiming().endTime))
        .map(animation=>animation.finished.catch(()=>{})));
    })()""")


def set_dates(cdp, start="2020-01-01", end="2024-05-31"):
    cdp.evaluate(f"""(()=>{{
      for(const [id,value] of {json.dumps([['startDateInput', start], ['endDateInput', end]])}){{
        const input=document.getElementById(id);input.value=value;
        input.dispatchEvent(new Event('change',{{bubbles:true}}));
      }}
    }})()""")
    settle(cdp)


def snapshot(cdp, entries):
    settle(cdp)
    return cdp.evaluate(f"""(()=>{{
      const props={json.dumps(STYLE_PROPERTIES)},entries={json.dumps(entries)};
      const round=value=>Math.round(value*1000)/1000;
      const style=(element,pseudo)=>{{const s=getComputedStyle(element,pseudo);
        return Object.fromEntries(props.map(key=>[key,s.getPropertyValue(key)]));}};
      return Object.fromEntries(entries.map(entry=>{{
        const el=document.querySelector(entry.selector);
        if(!el)throw new Error('Missing control: '+entry.selector);
        const rect=el.getBoundingClientRect(),anchor=entry.anchor&&document.querySelector(entry.anchor).getBoundingClientRect();
        const value={{style:style(el),width:round(rect.width),disabled:!!el.disabled,
          selected:el.hasAttribute('data-range-preset')?el.classList.contains('is-active'):
            el.getAttribute('aria-pressed'),expanded:el.getAttribute('aria-expanded')}};
        if(entry.height)value.height=round(rect.height);
        if(anchor){{value.x=round(rect.x-anchor.x);value.y=round(rect.y-anchor.y);}}
        if(entry.pseudo)for(const pseudo of ['::before','::after']){{
          const s=getComputedStyle(el,pseudo);value[pseudo]={{...style(el,pseudo),
            content:s.content,width:s.width,height:s.height,transform:s.transform}};
        }}
        return [entry.selector,value];
      }}));
    }})()""")


def pseudo(cdp, selectors, states):
    root = cdp.command("DOM.getDocument")["root"]["nodeId"]
    for selector in selectors:
        node = cdp.command("DOM.querySelector", {"nodeId": root, "selector": selector})["nodeId"]
        assert node, f"Missing pseudo-state target {selector}"
        cdp.command("CSS.forcePseudoState", {"nodeId": node, "forcedPseudoClasses": states})
    if not states:
        # Chrome propagates forced focus/hover to ancestors. Clear those too so
        # later real clicks and screenshots do not retain an artificial popover.
        nodes = cdp.command("DOM.querySelectorAll", {"nodeId": root, "selector": ":hover,:focus,:focus-visible,:focus-within"})["nodeIds"]
        for node in nodes:
            cdp.command("CSS.forcePseudoState", {"nodeId": node, "forcedPseudoClasses": []})
    settle(cdp)


def screenshot(cdp, path):
    result = cdp.command("Page.captureScreenshot", {"format": "png", "captureBeyondViewport": False})
    path.write_bytes(base64.b64decode(result["data"]))


def playback_state(cdp):
    # Opening settings must not move a stopped/paused cursor or alter playback.
    # A running cursor is free to advance, but its configured range stays fixed.
    return cdp.evaluate("""(()=>{
      const app=window.WSBEOEGrowthDashboard||window.WSBMovingAverageDashboard,s=app.getState();
      const value={playing:app.isPlaying(),paused:s.pausedPlayback,start:s.startIso,end:s.endIso,speed:s.speed};
      if(!value.playing)value.current=s.currentIso;
      return value;
    })()""")


def open_menu(cdp):
    before = playback_state(cdp)
    click(cdp, "#dateRangeSettingsBtn")
    assert cdp.evaluate("document.querySelector('#dateRangeSettingsMenu').classList.contains('open')")
    assert playback_state(cdp) == before, ("Opening settings altered playback", before, playback_state(cdp))
    settle(cdp)
    assert cdp.evaluate("""(()=>{const r=document.querySelector('#dateRangeSettingsMenu').getBoundingClientRect();
      return r.left>=7&&r.right<=innerWidth-7;})()"""), "Settings menu overflowed viewport"


def collect(cdp, url, slug, theme, width, output):
    cdp.command("Emulation.setDeviceMetricsOverride", {"width": width, "height": 1000, "deviceScaleFactor": 1, "mobile": False})
    cdp.command("Page.navigate", {"url": url + "?fixture_reset=1"})
    wait_for(lambda: cdp.evaluate("document.body?.dataset.ready==='true'&&!!(window.WSBEOEGrowthDashboard||window.WSBMovingAverageDashboard)?.getModel()"), description=slug + " ready")
    cdp.evaluate(f"window.dispatchEvent(new MessageEvent('message',{{data:{{type:'quantum-dashboard-theme',theme:{json.dumps(theme)}}}}}))")
    # Explicitly use the same export choices: the default follows dashboard
    # theme, while this suite changes theme after the real initialization.
    set_dates(cdp)
    result = {"normal": snapshot(cdp, BASE)}
    screenshot(cdp, output / f"{slug}-{width}-{theme}.png")
    hover = [entry["selector"] for entry in BASE if entry["selector"] in (
        ".info-btn", "#copyDashboardLink", "#resetDashboard", "#startDateBtn", "#endDateBtn",
        "#playBtn", "#pauseBtn", "#stopBtn", "#speedBtn", "#downloadImageBtn", "#dateRangeDownloadBtn", "#dateRangeSettingsBtn"
    )] + ["#rangeButtons button[data-range-preset='1y']"]
    pseudo(cdp, hover, ["hover"])
    result["hover"] = snapshot(cdp, [entry for entry in BASE if entry["selector"] in hover])
    pseudo(cdp, hover, [])
    pseudo(cdp, hover, ["focus", "focus-visible"])
    result["keyboard-focus"] = snapshot(cdp, [entry for entry in BASE if entry["selector"] in hover])
    pseudo(cdp, hover, [])
    click(cdp, "#rangeButtons button[data-range-preset='1y']")
    assert cdp.evaluate("document.querySelector(\"#rangeButtons button[data-range-preset='1y']\").classList.contains('is-active')")
    if slug == "eoe_growth":
        # EOE additionally announces preset state to assistive technology; MA's
        # older markup only exposes its visual is-active class. Preserve this
        # accessibility improvement instead of requiring both to omit ARIA.
        assert cdp.evaluate("document.querySelector(\"#rangeButtons button[data-range-preset='1y']\").getAttribute('aria-pressed')==='true'")
    result["selected-preset"] = snapshot(cdp, BASE)
    set_dates(cdp)
    open_menu(cdp)
    result["open-menu"] = snapshot(cdp, MENU)
    screenshot(cdp, output / f"{slug}-{width}-{theme}-menu.png")
    for group, value in (("Orientation", "square"), ("Quality", "1080"), ("Fps", "120"), ("Theme", "light")):
        click(cdp, f"#download{group}Select [data-value='{value}']")
    result["selected-menu"] = snapshot(cdp, MENU)
    option_hover = ["#downloadOrientationSelect [data-value='landscape']", "#downloadOrientationSelect [data-value='square']", "#downloadSettingsDownloadBtn"]
    pseudo(cdp, option_hover, ["hover"])
    result["hover-menu"] = snapshot(cdp, MENU)
    pseudo(cdp, option_hover, [])
    click(cdp, "#dateRangeSettingsBtn")
    click(cdp, "#playBtn")
    result["playing"] = snapshot(cdp, PLAYBACK)
    open_menu(cdp)
    click(cdp, "#dateRangeSettingsBtn")
    click(cdp, "#pauseBtn")
    assert playback_state(cdp)["paused"] and not playback_state(cdp)["playing"]
    result["paused"] = snapshot(cdp, PLAYBACK)
    open_menu(cdp)
    click(cdp, "#dateRangeSettingsBtn")
    click(cdp, "#stopBtn")
    set_dates(cdp, end="2020-01-10")
    click(cdp, "#startDateBtn")
    result["calendar"] = snapshot(cdp, CALENDAR)
    screenshot(cdp, output / f"{slug}-{width}-{theme}-calendar.png")
    calendar_hover = [".date-picker-nav:first-child", ".date-picker-day.dp-selected",
                      ".date-picker-day:not(.dp-empty):not(.dp-selected):not(.dp-disabled)", ".date-picker-day.dp-disabled"]
    pseudo(cdp, calendar_hover, ["hover"])
    result["hover-calendar"] = snapshot(cdp, CALENDAR)
    pseudo(cdp, calendar_hover, [])
    errors = cdp.evaluate("window.__maFixture.errors")
    assert errors == [], errors
    return result


def differences(reference, candidate, path=""):
    if isinstance(reference, dict) and isinstance(candidate, dict):
        found = []
        for key in sorted(reference.keys() | candidate.keys()):
            found.extend(differences(reference.get(key), candidate.get(key), f"{path}/{key}"))
        return found
    # Chrome layout uses 1/64 CSS-pixel increments. Allow only rounding noise.
    if isinstance(reference, (float, int)) and not isinstance(reference, bool) and isinstance(candidate, (float, int)):
        equal = abs(reference - candidate) <= .02
    else:
        equal = reference == candidate
    return [] if equal else [{"path": path, "moving_average": reference, "eoe_growth": candidate}]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output-dir", default="/tmp/dashboard-control-parity-review")
    args = parser.parse_args()
    output = Path(args.output_dir)
    output.mkdir(parents=True, exist_ok=True)
    if not Path(CHROME).is_file():
        raise SystemExit(f"Chrome not found at {CHROME}; set CHROME_BIN")
    freeze_data()
    server_port, debug_port = free_port(), free_port()
    server = ThreadingHTTPServer(("127.0.0.1", server_port), lambda *a, **kw: FrozenHandler(*a, directory=str(ROOT), **kw))
    threading.Thread(target=server.serve_forever, daemon=True).start()
    failures, snapshots = [], {}
    with tempfile.TemporaryDirectory(prefix="wsb-control-parity-") as profile:
        chrome = subprocess.Popen([CHROME, "--headless=new", "--disable-gpu", "--remote-allow-origins=*",
                                   f"--remote-debugging-port={debug_port}", f"--user-data-dir={profile}", "about:blank"],
                                  stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        try:
            wait_for(lambda: urllib.request.urlopen(f"http://127.0.0.1:{debug_port}/json/version", timeout=.5).read(), description="isolated Chrome")
            target = json.load(urllib.request.urlopen(urllib.request.Request(f"http://127.0.0.1:{debug_port}/json/new?about:blank", method="PUT")))
            cdp = CdpSocket(target["webSocketDebuggerUrl"])
            for domain in ("Page", "Runtime", "Network", "DOM", "CSS"):
                cdp.command(domain + ".enable")
            cdp.command("Network.setBlockedURLs", {"urls": ["https://*", "wss://*"]})
            cdp.command("Page.addScriptToEvaluateOnNewDocument", {"source": FIXTURE})
            for width in (1440, 390, 320):
                for theme in ("dark", "light"):
                    pair = {}
                    for slug in ("moving_average", "eoe_growth"):
                        url = f"http://127.0.0.1:{server_port}/webapps/{slug}/dashboard.html"
                        pair[slug] = collect(cdp, url, slug, theme, width, output)
                    key = f"{width}-{theme}"
                    snapshots[key] = pair
                    mismatch = differences(pair["moving_average"], pair["eoe_growth"], key)
                    failures.extend(mismatch)
                    (output / "snapshots.json").write_text(json.dumps(snapshots, indent=2) + "\n")
                    (output / "differences.json").write_text(json.dumps(failures, indent=2) + "\n")
                    print(f"{'FAIL' if mismatch else 'PASS'} {key}: {len(pair['moving_average'])} visual states; {len(mismatch)} computed differences", flush=True)
            if failures:
                for failure in failures[:30]:
                    print(json.dumps(failure), flush=True)
                raise AssertionError(f"{len(failures)} control differences; full diagnostics: {output / 'differences.json'}")
            print("PASS exact shared control geometry, typography, borders, colors, gear pseudo-elements, focus/hover/selected/disabled states, calendar, and settings preserving stopped/playing/paused playback", flush=True)
        finally:
            chrome.terminate()
            try:
                chrome.wait(timeout=5)
            except subprocess.TimeoutExpired:
                chrome.kill()
                chrome.wait(timeout=5)
            server.shutdown()


if __name__ == "__main__":
    main()
