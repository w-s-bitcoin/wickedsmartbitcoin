#!/usr/bin/env python3
"""Verify Copy Link round trips for the five canvas time-series dashboards.

Uses frozen, read-only published data and isolated Chrome storage. Copies both
nondefault/paused and default states, then opens each actual standalone link in
an environment with conflicting saved settings. No producers or live quotes run.

    CHROME_BIN=/path/to/chrome python3 scripts/test_time_series_share_browser.py
"""

import base64
import json
import os
import subprocess
import tempfile
import threading
from datetime import date, timedelta
import urllib.parse
import urllib.request
from http.server import ThreadingHTTPServer
from pathlib import Path

from test_comparison_live_price_browser import FrozenHandler
from test_stage1_refresh_atomicity import CdpSocket, free_port, wait_for


ROOT = Path(__file__).resolve().parents[1]
CHROME = os.environ.get("CHROME_BIN", "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome")
CASES = {
    "uoa": {
        "startDate": "2021-01-01", "endDate": "2022-06-01",
        "uoaGroup": "monetary_metals", "primaryUoa": "XAU", "secondaryUoa": "XAG",
        "scaleMode": "linear", "primaryScaleMode": "linear", "secondaryScaleMode": "log",
        "orderMode": "alpha-desc", "smoothVesRedenom": False, "metalDenomination": "gram",
        "showPeggedCurrencies": True, "showMonetaryMetals": True,
        "playbackFps": 120, "chartMode": "left", "timeZone": "America/New_York",
        "pausedPlaybackSession": {
            "startDate": "2021-01-01", "targetEndDate": "2024-01-01", "currentEndDate": "2022-06-01",
        },
    },
    "dca_cost_basis": {
        "cadence": "monthly_dca", "yScale": "log", "showHalvings": False,
        "timeZone": "America/New_York", "startIso": "2021-01-01", "endIso": "2024-01-01",
        "currentEndIso": "2022-06-01", "selectedPreset": "custom",
        "rangeTracksLatestEnd": False, "playbackSpeed": 4,
        "pausedPlaybackSession": {
            "startIso": "2021-01-01", "targetEndIso": "2024-01-01", "currentEndIso": "2022-06-01",
        },
    },
    "dca_comparison": {
        "dcaStart": "2021-01-01", "rangeStart": "2021-01-01", "rangeEnd": "2024-01-01",
        "cadence": "monthly", "amount": 75, "assetA": "BTC", "assetB": "XAG",
        "maxBtcPurchasePct": 2, "capBtcTotalToSupply": False, "preset": "",
        "rangeTracksLatestEnd": False, "speed": 4, "scale": "log",
        "currentIso": "2022-06-01", "timeZone": "America/New_York",
        "pausedPlaybackSession": {
            "startIso": "2021-01-01", "targetEndIso": "2024-01-01", "currentIso": "2022-06-01",
        },
    },
    "days_since_ath": {
        "startIso": "2021-01-01", "endIso": "2022-06-01", "currentIso": "2022-06-01",
        "preset": "", "speed": 4, "chartMode": "days", "priceScaleMode": "linear",
        "daysScaleMode": "log", "showAthLabels": False, "showAthMarkers": False,
        "showHalvings": False, "timeZone": "America/New_York",
        "pausedPlaybackSession": {
            "startIso": "2021-01-01", "targetEndIso": "2024-01-01", "currentEndIso": "2022-06-01",
        },
    },
    "issuance_rate": {
        "start": "2021-01-01", "end": "2024-01-01", "current": "2022-06-01",
        "endTracksLatest": False, "currentTracksLatest": False, "speed": 4,
        "playbackState": "paused", "preset": "custom", "viewMode": "all", "scaleMode": "log",
        "showPerfectIssuanceMarkers": False, "showTargetIssuanceRate": False,
        "dailyCalculationsUseSelectedTimeZone": True, "timeZone": "America/New_York",
    },
}

FIXTURE_SHIM = r"""
(() => {
  window.__shareErrors = [];
  window.addEventListener('error', event => window.__shareErrors.push(event.message));
  Object.defineProperty(navigator, 'clipboard', {
    value: { writeText: async text => { window.__copiedLink = text; } },
  });
  const params = new URLSearchParams(location.search);
  if (params.has('share_fixture_reset')) localStorage.clear();
  if (params.has('share_fixture_conflict')) {
    const conflicting = {
      cadence: 'daily_dca', showHalvings: true, showAthLabels: true, showAthMarkers: true,
      assetA: 'XAU', assetB: 'USD', primaryUoa: 'BTC', secondaryUoa: 'USD',
      startIso: '2015-01-01', endIso: '2016-01-01', startDate: '2015-01-01', endDate: '2016-01-01',
      scaleMode: 'linear', yScale: 'linear', amount: 999, timeZone: 'Asia/Tokyo',
    };
    [
      'uoa-dashboard-filters-v1', 'dca_cost_basis_controls_v2', 'dca_cost_basis_date_range_v1',
      'dca_comparison_settings_v1', 'days_since_ath_dashboard_state_v1', 'issuance_rate_dashboard_state_v1',
    ].forEach(key => localStorage.setItem(key, JSON.stringify(conflicting)));
    localStorage.setItem('wicked_dashboard_timezone_v1', 'Asia/Tokyo');
  }
  window.WebSocket = class { close() {} };
  const originalFetch = window.fetch.bind(window);
  window.fetch = (input, options) => {
    const url = new URL(typeof input === 'string' ? input : input.url, location.href);
    if (url.origin !== location.origin) return Promise.reject(new Error('External feeds disabled in sharing fixture'));
    return originalFetch(input, options);
  };
})();
"""


def encode_state(state):
    return base64.urlsafe_b64encode(json.dumps(state).encode()).decode().rstrip("=")


def parse_state(url):
    params = urllib.parse.parse_qs(urllib.parse.urlparse(url).query)
    assert "state" in params, f"Copy Link omitted explicit state: {url}"
    encoded = params["state"][0]
    state = json.loads(base64.urlsafe_b64decode(encoded + "=" * (-len(encoded) % 4)))
    assert state, "Copy Link must explicitly capture even default field values"
    return state


def navigate_ready(cdp, url, *, standalone=False):
    cdp.command("Page.navigate", {"url": url})
    dashboard_document = "document.querySelector('iframe')?.contentDocument" if standalone else "document"
    expression = f"""(() => {{
      window.__shareDocument = {dashboard_document};
      const doc = window.__shareDocument;
      return !!(doc?.querySelector('#copyDashboardLink')
        && (doc.querySelector('#startDateInput')?.value || doc.querySelector('#dateRangeStartInput')?.value)
        && !doc.body.classList.contains('issuance-loading')
        && !doc.body.classList.contains('uoa-loading')
        && Array.from(doc.querySelectorAll('#chartLoader, #priceChartLoader, #daysChartLoader'))
          .every(loader => loader.classList.contains('hidden')));
    }})()"""
    wait_for(lambda: cdp.evaluate(expression), description=f"dashboard load: {url.split('?')[0]}")


def copy_link(cdp):
    cdp.evaluate("""(() => {
      const doc = window.__shareDocument;
      doc.defaultView.__copiedLink = '';
      doc.querySelector('#copyDashboardLink').click();
    })()""")
    wait_for(lambda: cdp.evaluate("window.__shareDocument.defaultView.__copiedLink"), description="Copy Link")
    errors = cdp.evaluate("window.__shareDocument.defaultView.__shareErrors")
    assert not errors, errors
    return cdp.evaluate("window.__shareDocument.defaultView.__copiedLink")


def assert_standalone_roundtrip(cdp, slug, first_link):
    parsed = urllib.parse.urlparse(first_link)
    assert parsed.path == f"/{slug}.html", (slug, "noncanonical local route", parsed.path)
    first_state = parse_state(first_link)
    if slug == "uoa":
        pair = urllib.parse.parse_qs(parsed.query).get("pair", [""])[0]
        assert pair == first_state["primaryUoa"] + first_state["secondaryUoa"], pair
    navigate_ready(cdp, first_link + "&share_fixture_conflict=1", standalone=True)
    restored = parse_state(copy_link(cdp))
    assert restored == first_state, (slug, "round trip changed fields", first_state, restored)


def freeze_data():
    paths = [ROOT / "assets/daily_price.csv", ROOT / "assets/daily_price_metadata.json"]
    for slug in CASES:
        paths.extend(path for path in (ROOT / "webapps" / slug / "webapp_data").rglob("*") if path.is_file())
    FrozenHandler.snapshot = {"/" + str(path.relative_to(ROOT)): path.read_bytes() for path in paths if path.is_file()}


def main():
    if not Path(CHROME).is_file():
        raise SystemExit(f"Chrome not found at {CHROME}; set CHROME_BIN")
    freeze_data()
    server_port, debug_port = free_port(), free_port()
    server = ThreadingHTTPServer(("127.0.0.1", server_port),
        lambda *args, **kwargs: FrozenHandler(*args, directory=str(ROOT), **kwargs))
    threading.Thread(target=server.serve_forever, daemon=True).start()
    with tempfile.TemporaryDirectory(prefix="wsb-time-series-share-") as profile:
        chrome = subprocess.Popen([
            CHROME, "--headless=new", "--disable-gpu", "--remote-allow-origins=*",
            f"--remote-debugging-port={debug_port}", f"--user-data-dir={profile}", "about:blank",
        ], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        try:
            wait_for(lambda: urllib.request.urlopen(
                f"http://127.0.0.1:{debug_port}/json/version", timeout=.5).read(),
                description="Chrome DevTools endpoint")
            target = json.load(urllib.request.urlopen(urllib.request.Request(
                f"http://127.0.0.1:{debug_port}/json/new?about:blank", method="PUT")))
            cdp = CdpSocket(target["webSocketDebuggerUrl"])
            cdp.command("Page.enable")
            cdp.command("Runtime.enable")
            cdp.command("Page.addScriptToEvaluateOnNewDocument", {"source": FIXTURE_SHIM})
            for slug, selected in CASES.items():
                direct = f"http://127.0.0.1:{server_port}/webapps/{slug}/dashboard.html"
                navigate_ready(cdp, f"{direct}?state={encode_state(selected)}&share_fixture_conflict=1")
                first_link = copy_link(cdp)
                captured = parse_state(first_link)
                for field, expected in selected.items():
                    assert captured.get(field) == expected, (slug, field, expected, captured.get(field))
                assert_standalone_roundtrip(cdp, slug, first_link)
                print(f"PASS {slug}: nondefault controls, paused frame, conflicting storage, standalone", flush=True)

                navigate_ready(cdp, f"{direct}?share_fixture_reset=1")
                default_link = copy_link(cdp)
                default_state = parse_state(default_link)
                assert all(field in default_state for field in selected), (slug, "missing default fields")
                assert_standalone_roundtrip(cdp, slug, default_link)
                print(f"PASS {slug}: explicit default fields override recipient settings", flush=True)

                if slug in ("dca_cost_basis", "dca_comparison"):
                    paused = dict(default_state)
                    if slug == "dca_cost_basis":
                        paused["currentEndIso"] = paused["startIso"]
                        paused["pausedPlaybackSession"] = {
                            "startIso": paused["startIso"], "targetEndIso": paused["endIso"],
                            "currentEndIso": paused["startIso"],
                        }
                        frame_field = "currentEndIso"
                    else:
                        paused["currentIso"] = paused["rangeStart"]
                        paused["pausedPlaybackSession"] = {
                            "startIso": paused["rangeStart"], "targetEndIso": paused["rangeEnd"],
                            "currentIso": paused["rangeStart"],
                        }
                        frame_field = "currentIso"
                    navigate_ready(cdp, f"{direct}?state={encode_state(paused)}&share_fixture_conflict=1")
                    paused_link = copy_link(cdp)
                    assert parse_state(paused_link)[frame_field] == paused[frame_field], (slug, "preset lost playback frame")
                    assert_standalone_roundtrip(cdp, slug, paused_link)
                    print(f"PASS {slug}: selected preset preserves paused frame", flush=True)

                if slug == "dca_comparison":
                    latest = date.fromisoformat(default_state["rangeEnd"])
                    start = (latest - timedelta(days=60)).isoformat()
                    current = (latest - timedelta(days=30)).isoformat()
                    custom = {
                        **default_state, "cadence": "daily", "preset": "",
                        "rangeStart": start, "dcaStart": start, "currentIso": current,
                        "pausedPlaybackSession": {
                            "startIso": start, "targetEndIso": default_state["rangeEnd"],
                            "currentIso": current,
                        },
                    }
                    navigate_ready(cdp, f"{direct}?state={encode_state(custom)}&share_fixture_conflict=1")
                    custom_link = copy_link(cdp)
                    assert parse_state(custom_link)["currentIso"] == current, (slug, "custom rolling range lost playback frame")
                    assert_standalone_roundtrip(cdp, slug, custom_link)
                    print(f"PASS {slug}: custom range ending latest preserves paused frame", flush=True)
        finally:
            chrome.terminate()
            chrome.wait(timeout=10)
            server.shutdown()


if __name__ == "__main__":
    main()
