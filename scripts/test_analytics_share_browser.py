#!/usr/bin/env python3
"""Verify Copy Link snapshots survive standalone routing and stored preferences."""

import base64
import json
import os
import subprocess
import tempfile
import threading
import urllib.parse
import urllib.request
from http.server import ThreadingHTTPServer
from pathlib import Path

from test_stage1_refresh_atomicity import CdpSocket, QuietHandler, free_port, wait_for


ROOT = Path(__file__).resolve().parents[1]
CHROME = os.environ.get("CHROME_BIN", "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome")
DASHBOARDS = ("node_count", "bitcoin_dominance", "bip110_signaling", "patoshi_pattern")
READY = {
    "node_count": "state.interactiveInitialized && document.getElementById('historyChart')?.data?.length > 0",
    "bitcoin_dominance": "state.interactiveInitialized && document.getElementById('dominanceChart')?.data?.length > 0",
    "bip110_signaling": "state.interactiveInitialized && state.controlsEnabled",
    "patoshi_pattern": "document.getElementById('loadingRing')?.style.display === 'none'",
}
POISONED_STORAGE = {
    "node_count_dashboard_controls_v2": {
        "range": "30", "smooth": "30", "topN": 29, "hiddenHistorySeries": ["knots"], "showHistoryPanel": False,
    },
    "bitcoin_dominance_controls_v1": {
        "includeStables": False, "stackedDominance": False, "stackedDominanceTouched": True,
        "showPrice": True, "range": "30", "smooth": "30",
    },
    "bitcoin_dominance_layout_v1": {"historyPanelManualHeight": 1500},
    "bip110_signaling_controls_v3": {
        "markers": False, "labels": False, "showSegwit": True, "showBip110": False,
    },
    "bip110_signaling_overlay_selections_v2": {"leaderboardWindow": "last", "minerTimelineMiners": "signaling"},
    "wsb_patoshi_pattern_state_v6": {
        "startMs": 0, "endMs": 0, "showSpent": False, "markerScale": 3, "speedIndex": 3, "countMetric": "time",
    },
}
CUSTOMIZE = {
    "node_count": """
      document.getElementById('rangeSelect').value = '365';
      document.getElementById('smoothSelect').value = '7';
      document.getElementById('topNInput').value = '17';
      state.hiddenHistorySeries = new Set(['total', 'core']);
      state.softwareExpandedKeys = new Set(['Bitcoin Core']);
      renderHistoryChart();
      renderSoftwarePanel();
      const chart = document.getElementById('historyChart');
      const dates = chart.data[0].x;
      await Plotly.relayout(chart, {
        'xaxis.range': [dates[Math.floor(dates.length / 3)], dates[Math.floor(dates.length * 2 / 3)]],
        'yaxis.range': [0, 150000],
      });
    """,
    "bitcoin_dominance": """
      Object.assign(state, {
        includeStables: false, showPrice: true, stackedDominance: false, stackedDominanceTouched: true,
        range: '365', smooth: '7', historyUserXAxisRange: ['2026-06-01', '2026-09-15'],
      });
      await renderHistoryChart();
      await Plotly.relayout('dominanceChart', { 'yaxis.range': [20, 80] });
    """,
    "bip110_signaling": """
      Object.assign(state.controls, {
        showSegwit: true, showBip110: true, showLegacyNode: false, showBip110Node: true,
        blockSymbol: 'square', markers: false, labels: false, collapseSplitLegacy: false,
      });
      Object.assign(state, {
        periodGridDataset: 'segwit', periodGridSelectedPeriod: 1, periodGridNodeView: 'bip110',
        leaderboardWindow: 'past7d', minerTimelineWindow: 'past24h', minerTimelineNodeView: 'bip110',
        minerTimelineMiners: 'nonsignaling', minerTimelineOrder: 'total', minerTimelineSignalersFirst: false,
        minerTimelineShowChainView: false, chainSplitHashrateAverageDays: 7, mainHashrateAverageDays: 1,
      });
    """,
    "patoshi_pattern": """
      for (let i = 0; i < 3; i++) document.getElementById('speedBtn').click();
      const metric = document.getElementById('countMetric');
      metric.value = 'time';
      metric.dispatchEvent(new Event('change', { bubbles: true }));
      document.getElementById('showSpent').click();
    """,
}


def decode_state(url):
    query = urllib.parse.parse_qs(urllib.parse.urlparse(url).query)
    value = query.get("state", query.get("bip110_state"))[0]
    return json.loads(base64.urlsafe_b64decode(value + "=" * ((4 - len(value) % 4) % 4)))


def main():
    if not Path(CHROME).is_file():
        raise SystemExit(f"Chrome not found at {CHROME}; set CHROME_BIN")
    server_port, debug_port = free_port(), free_port()
    handler = lambda *args, **kwargs: QuietHandler(*args, directory=str(ROOT), **kwargs)
    server = ThreadingHTTPServer(("127.0.0.1", server_port), handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    base = f"http://127.0.0.1:{server_port}"

    with tempfile.TemporaryDirectory(prefix="wsb-analytics-share-") as profile:
        chrome = subprocess.Popen([
            CHROME, "--headless=new", "--disable-gpu", "--remote-allow-origins=*",
            f"--remote-debugging-port={debug_port}", f"--user-data-dir={profile}", "about:blank",
        ], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        try:
            wait_for(lambda: urllib.request.urlopen(
                f"http://127.0.0.1:{debug_port}/json/version", timeout=0.5).read(),
                description="Chrome DevTools endpoint")
            target = json.load(urllib.request.urlopen(urllib.request.Request(
                f"http://127.0.0.1:{debug_port}/json/new?about:blank", method="PUT"), timeout=2))
            cdp = CdpSocket(target["webSocketDebuggerUrl"])
            cdp.command("Page.enable")
            cdp.command("Runtime.enable")
            # Keep market changes from racing viewport comparisons; chart libraries still load normally.
            cdp.command("Page.addScriptToEvaluateOnNewDocument", {"source": """
              window.WebSocket = class { close() {} send() {} };
              const nativeFetch = window.fetch.bind(window);
              window.fetch = (input, options) => {
                const url = new URL(typeof input === 'string' ? input : input.url, location.href);
                if (url.origin !== location.origin) return Promise.reject(new TypeError('Offline market fixture'));
                return nativeFetch(input, options);
              };
            """})

            def evaluate_frame(code):
                return cdp.evaluate(
                    "(() => { const frame = document.querySelector('#modal-embed')?.contentWindow;"
                    " return frame?.eval(" + json.dumps(code) + "); })()")

            def navigate(url, slug):
                cdp.command("Page.navigate", {"url": url})
                wait_for(lambda: cdp.evaluate(
                    "location.href === " + json.dumps(url) + " && document.readyState === 'complete'")
                    and evaluate_frame("location.pathname.includes(" + json.dumps("/" + slug + "/")
                                       + ") && document.readyState === 'complete' && (" + READY[slug] + ")"),
                    timeout=80, description=f"{slug} standalone and chart ready")

            def copy_link(slug):
                button = "copyLinkBtn" if slug == "patoshi_pattern" else "copyDashboardLink"
                return evaluate_frame("""(() => {
                  window.__copiedDashboardLink = null;
                  WSBDashboardComponents.copyDashboardLink = async options => {
                    window.__copiedDashboardLink = options.getUrl();
                  };
                  document.getElementById(""" + json.dumps(button) + """).click();
                  return window.__copiedDashboardLink;
                })()""")

            for slug in DASHBOARDS:
                navigate(f"{base}/{slug}.html?state=e30", slug)
                for variant in ("defaults", "custom"):
                    if variant == "custom":
                        evaluate_frame("(async () => {" + CUSTOMIZE[slug] + "})()")
                    link = copy_link(slug)
                    assert link, (slug, "Copy Link did not produce a URL")
                    expected = decode_state(link)
                    assert expected, (slug, "default values must be explicitly included")
                    if slug == "patoshi_pattern" and variant == "custom":
                        assert expected["speedIndex"] == 0, "0.5x playback speed was lost"
                    cdp.evaluate("Object.entries(" + json.dumps(POISONED_STORAGE)
                                 + ").forEach(([key, value]) => localStorage.setItem(key, JSON.stringify(value)))")
                    navigate(link, slug)
                    actual = decode_state(copy_link(slug))
                    assert actual == expected, (slug, variant, {
                        key: {"expected": value, "actual": actual.get(key)}
                        for key, value in expected.items() if actual.get(key) != value
                    })
                    print(f"{slug}: {variant} Copy Link → standalone paste passed", flush=True)
                if slug == "bip110_signaling":
                    navigate(link.replace("?state=", "?bip110_state="), slug)
                    assert decode_state(copy_link(slug)) == expected, "Legacy BIP-110 links changed"
                    print("bip110_signaling: legacy bip110_state alias passed", flush=True)
        finally:
            chrome.terminate()
            chrome.wait(timeout=10)
            server.shutdown()


if __name__ == "__main__":
    main()
