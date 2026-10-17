#!/usr/bin/env python3
"""Exercise DCA LOG/LIN morphs and button activation with isolated Chrome.

Only frozen in-memory publication files and an isolated browser profile are used.
No producer, live data, or user preferences are modified.
"""

import json
import os
import subprocess
import tempfile
import threading
import urllib.request
from http.server import ThreadingHTTPServer
from pathlib import Path

from test_comparison_live_price_browser import FrozenHandler
from test_stage1_refresh_atomicity import CdpSocket, free_port, wait_for

ROOT = Path(__file__).resolve().parents[1]
CHROME = os.environ.get("CHROME_BIN", "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome")
FIXTURE = r"""
(() => {
  localStorage.clear();
  window.__scaleErrors = [];
  addEventListener('error', e => __scaleErrors.push(e.message));
  addEventListener('unhandledrejection', e => __scaleErrors.push(String(e.reason)));
  class PriceSocket { constructor() {} send() {} close() {} }
  window.WebSocket = PriceSocket;
  const fetchNative = window.fetch.bind(window);
  window.fetch = (input, options) => {
    const url = new URL(typeof input === 'string' ? input : input.url, location.href);
    return url.origin === location.origin ? fetchNative(input, options)
      : Promise.reject(new Error('External quote feed disabled in fixture'));
  };
})();
"""


def mouse_click(cdp, selector):
    point = cdp.evaluate(f"(() => {{const r=document.querySelector({json.dumps(selector)}).getBoundingClientRect();return {{x:r.x+r.width/2,y:r.y+r.height/2}};}})()")
    cdp.command("Input.dispatchMouseEvent", {"type": "mousePressed", "button": "left", "clickCount": 1, **point})
    cdp.command("Input.dispatchMouseEvent", {"type": "mouseReleased", "button": "left", "clickCount": 1, **point})


def sample(cdp):
    return cdp.evaluate("window.__scaleSample()")


def settled(cdp, expected):
    return wait_for(lambda: sample(cdp)["mix"] == expected, timeout=5, description=f"DCA scale endpoint {expected}")


def main():
    if not Path(CHROME).is_file():
        raise SystemExit(f"Chrome not found at {CHROME}; set CHROME_BIN")
    paths = [ROOT / "assets/daily_price.csv", ROOT / "assets/daily_price_metadata.json"]
    for slug in ("dca_cost_basis", "dca_comparison", "uoa"):
        paths.extend(p for p in (ROOT / "webapps" / slug / "webapp_data").rglob("*") if p.is_file())
    FrozenHandler.snapshot = {"/" + str(path.relative_to(ROOT)): path.read_bytes() for path in paths}
    server_port, debug_port = free_port(), free_port()
    handler = lambda *args, **kwargs: FrozenHandler(*args, directory=str(ROOT), **kwargs)
    server = ThreadingHTTPServer(("127.0.0.1", server_port), handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    with tempfile.TemporaryDirectory(prefix="wsb-dca-scale-") as profile:
        chrome = subprocess.Popen([
            CHROME, "--headless=new", "--disable-gpu", "--remote-allow-origins=*",
            f"--remote-debugging-port={debug_port}", f"--user-data-dir={profile}", "about:blank",
        ], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        try:
            wait_for(lambda: urllib.request.urlopen(f"http://127.0.0.1:{debug_port}/json/version", timeout=.5).read(), description="Chrome")
            target = json.load(urllib.request.urlopen(urllib.request.Request(f"http://127.0.0.1:{debug_port}/json/new?about:blank", method="PUT"), timeout=2))
            cdp = CdpSocket(target["webSocketDebuggerUrl"])
            cdp.command("Page.enable")
            cdp.command("Runtime.enable")
            cdp.command("Page.addScriptToEvaluateOnNewDocument", {"source": FIXTURE})
            cdp.command("Emulation.setDeviceMetricsOverride", {"width": 1280, "height": 900, "deviceScaleFactor": 1, "mobile": False})
            for slug, selector in (("dca_cost_basis", "#costBasisChart"), ("dca_comparison", "#chartCanvas")):
                cdp.command("Page.navigate", {"url": f"http://127.0.0.1:{server_port}/webapps/{slug}/dashboard.html"})
                # Both renderers expose their existing chart geometry for pointer interactions.
                wait_for(lambda: cdp.evaluate(f"Boolean(document.querySelector({json.dumps(selector)})?.__dcaChartGeometry)"), timeout=60, description=slug)
                cdp.evaluate(f"""(() => {{
                  const chart=document.querySelector({json.dumps(selector)});
                  window.__scaleSample=()=>{{const g=chart.__dcaChartGeometry;return {{mix:g.scaleMix,y:g.yForValue(1000),mode:document.querySelector('#scaleSelect').value,
                    start:document.querySelector('#dateRangeStartInput').value,end:document.querySelector('#dateRangeEndInput').value,
                    playing:document.querySelector('#dateRangePlayBtn').classList.contains('is-playing')}};}};
                  window.__scaleFrames=[];
                  const native=WSBDashboardCharting.morphScaleTicks;
                  WSBDashboardCharting.morphScaleTicks=(...args)=>{{const ticks=native(...args); __scaleFrames.push({{mix:args[2],zero:ticks.find(t=>t.value===0)?.alpha||0}});return ticks;}};
                }})()""")
                before = sample(cdp)
                assert before["mix"] == 0, before
                for half in ("linear", "linear", "log", "log"):
                    prior = sample(cdp)
                    cdp.evaluate("window.__scaleFrames=[]")
                    mouse_click(cdp, f'[data-scale-mode="{half}"]')
                    intermediate = wait_for(lambda: (v if 0 < (v := sample(cdp))["mix"] < 1 else False), description=f"{slug} intermediate")
                    expected = 1 - prior["mix"]
                    assert intermediate["mode"] == ("log" if expected else "linear"), intermediate
                    assert [intermediate[k] for k in ("start", "end", "playing")] == [prior[k] for k in ("start", "end", "playing")]
                    settled(cdp, expected)
                    endpoint = sample(cdp)
                    fraction = intermediate["mix"] if expected else 1 - intermediate["mix"]
                    expected_y = prior["y"] * (1 - fraction) + endpoint["y"] * fraction
                    assert abs(intermediate["y"] - expected_y) < .01, (prior, intermediate, endpoint)
                    frames = cdp.evaluate("__scaleFrames")
                    assert len(frames) > 2, frames
                    assert all(0 <= f["zero"] <= 1 for f in frames)
                    direction = 1 if expected else -1
                    assert all(direction * (b["mix"] - a["mix"]) >= -1e-9 for a, b in zip(frames, frames[1:])), frames
                    assert all(direction * (b["zero"] - a["zero"]) <= 1e-9 for a, b in zip(frames, frames[1:])), frames
                # Reverse from the visible shape, without a one-frame jump to an endpoint.
                mouse_click(cdp, '[data-scale-mode="linear"]')
                wait_for(lambda: .15 < sample(cdp)["mix"] < .85, description="reversal point")
                reversal = cdp.evaluate("(() => { const before=__scaleSample(); document.querySelector('[data-scale-mode=log]').click();return {before,after:__scaleSample()};})()")
                assert abs(reversal["after"]["mix"] - reversal["before"]["mix"]) < .03, reversal
                settled(cdp, 0)
                for key, code, vk in ((" ", "Space", 32), ("Enter", "Enter", 13)):
                    prior = sample(cdp)
                    cdp.evaluate("document.querySelector('[data-scale-mode=linear]').focus()")
                    cdp.command("Input.dispatchKeyEvent", {"type": "keyDown", "key": key, "code": code, "windowsVirtualKeyCode": vk, "nativeVirtualKeyCode": vk, "text": "\r" if key == "Enter" else " ", "unmodifiedText": "\r" if key == "Enter" else " "})
                    cdp.command("Input.dispatchKeyEvent", {"type": "keyUp", "key": key, "code": code, "windowsVirtualKeyCode": vk, "nativeVirtualKeyCode": vk})
                    settled(cdp, 1 - prior["mix"])
                    assert sample(cdp)["playing"] == prior["playing"], "Scale keyboard activation started playback"
                mouse_click(cdp, '[data-scale-mode="linear"]')
                wait_for(lambda: 0 < sample(cdp)["mix"] < 1, description="reduced motion mid-transition")
                cdp.command("Emulation.setEmulatedMedia", {"features": [{"name": "prefers-reduced-motion", "value": "reduce"}]})
                settled(cdp, 1)
                mouse_click(cdp, '[data-scale-mode="log"]')
                assert sample(cdp)["mix"] == 0, "Reduced motion did not switch immediately"
                cdp.command("Emulation.setEmulatedMedia", {"features": []})
                # Repaint a transition during a mobile resize and theme change.
                mouse_click(cdp, '[data-scale-mode="linear"]')
                cdp.command("Emulation.setDeviceMetricsOverride", {"width": 390, "height": 844, "deviceScaleFactor": 1, "mobile": False})
                cdp.evaluate("document.documentElement.dataset.theme='light';document.dispatchEvent(new CustomEvent('dashboard-theme-change'))")
                settled(cdp, 1)
                # Scale selection must not stop an active historical playback.
                cdp.command("Emulation.setDeviceMetricsOverride", {"width": 1280, "height": 900, "deviceScaleFactor": 1, "mobile": False})
                mouse_click(cdp, '#dateRangePlayBtn')
                wait_for(lambda: sample(cdp)["playing"], description="DCA playback")
                mouse_click(cdp, '[data-scale-mode="log"]')
                assert sample(cdp)["playing"], "Scale toggle stopped playback"
                mouse_click(cdp, '#dateRangePauseBtn')
                settled(cdp, 0)
                assert cdp.evaluate("__scaleErrors") == [], cdp.evaluate("__scaleErrors")
                cdp.command("Emulation.setDeviceMetricsOverride", {"width": 1280, "height": 900, "deviceScaleFactor": 1, "mobile": False})
                print(f"{slug}: morph, zero fade, either half, reversal, keyboard, reduced motion, mobile/theme passed")
        finally:
            chrome.terminate()
            chrome.wait(timeout=10)
            server.shutdown()


if __name__ == "__main__":
    main()
