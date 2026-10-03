#!/usr/bin/env python3
"""Round-trip Quantum and Casascius Copy Link through their standalone shells.

Uses an isolated Chrome profile; no published datasets or user storage are edited.
"""

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
SHIM = r"""
(() => {
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: {
    writeText: async (text) => { window.__copiedLink = text; }
  }});
  localStorage.setItem('quantum-research-dashboard-filters-v1', JSON.stringify({
    balance: 'ge1000', scriptTypes: ['P2TR'], spendActivities: ['active'],
    scriptPanelMode: 'historical', supplyDisplayMode: 'filtered', topExposureAddressQuery: 'conflicting fixture'
  }));
  localStorage.setItem('quantum-research-dashboard-runtime-mode-v1', 'full');
  localStorage.setItem('quantum-research-archived-snapshots-enabled-v1', 'true');
  localStorage.setItem('casasciusSpinnerActiveSlug', 'cas_bar_100btc_gp');
  localStorage.setItem('casasciusSpinnerQuarterComparison', 'true');
  localStorage.setItem('casasciusSpinnerPriceChartUnit', 'btc');
  localStorage.setItem('casasciusSpinnerPriceChartScale', 'linear');
  localStorage.setItem('casasciusSpinnerPanelState', JSON.stringify({ left: false, bottom: false, right: false, leftMode: 'graded' }));
})();
"""


def encoded(state):
    return base64.urlsafe_b64encode(json.dumps(state).encode()).decode().rstrip("=")


def decoded_link(link):
    raw = urllib.parse.parse_qs(urllib.parse.urlsplit(link).query)["state"][0]
    return json.loads(base64.urlsafe_b64decode(raw + "=" * (-len(raw) % 4)))


def main():
    if not Path(CHROME).is_file():
        raise SystemExit(f"Chrome not found at {CHROME}; set CHROME_BIN")
    server_port, debug_port = free_port(), free_port()
    server = ThreadingHTTPServer(("127.0.0.1", server_port),
        lambda *args, **kwargs: QuietHandler(*args, directory=str(ROOT), **kwargs))
    threading.Thread(target=server.serve_forever, daemon=True).start()
    with tempfile.TemporaryDirectory(prefix="wsb-specialized-share-") as profile:
        chrome = subprocess.Popen([
            CHROME, "--headless=new", "--disable-gpu", "--remote-allow-origins=*",
            f"--remote-debugging-port={debug_port}", f"--user-data-dir={profile}", "about:blank",
        ], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        try:
            wait_for(lambda: urllib.request.urlopen(
                f"http://127.0.0.1:{debug_port}/json/version", timeout=0.5).read(), description="Chrome")
            target = json.load(urllib.request.urlopen(urllib.request.Request(
                f"http://127.0.0.1:{debug_port}/json/new?about:blank", method="PUT"), timeout=2))
            cdp = CdpSocket(target["webSocketDebuggerUrl"])
            cdp.command("Page.enable")
            cdp.command("Runtime.enable")
            cdp.command("Page.addScriptToEvaluateOnNewDocument", {"source": SHIM})

            def evaluate(expression):
                return cdp.evaluate("(() => { const frame = document.getElementById('modal-embed'); "
                    "return frame?.contentWindow?.eval(" + json.dumps(expression) + "); })()")

            def load(slug, state=None, link=None):
                url = link or f"http://127.0.0.1:{server_port}/{slug}.html?state={encoded(state)}"
                cdp.command("Page.navigate", {"url": url})
                expected = state if state is not None else decoded_link(link)
                ready = ("typeof state !== 'undefined' && !!state.snapshotHeight && state.ge1Rows.length > 0 && !state.topExposuresLoading"
                    if slug == "quantum_exposure" else
                    "!!document.querySelector('#coinInfoPanel .balance-chart-thumb') && !document.documentElement.classList.contains('panels-booting')")
                if slug == "quantum_exposure" and expected.get("n"):
                    ready += f" && state.topExposuresVisibleCount === {int(expected['n'])}"
                if slug == "casascius_explorer" and expected.get("chartOpen"):
                    ready += " && document.documentElement.classList.contains('balance-chart-open')"
                wait_for(lambda: evaluate(ready), timeout=100, description=f"{slug} shell and data")

            def copy(slug):
                button = "copyDashboardLink"
                evaluate(f"document.getElementById('{button}').click()")
                wait_for(lambda: evaluate("!!window.__copiedLink"), description=f"{slug} clipboard")
                return evaluate("window.__copiedLink")

            quantum = "quantum_exposure"
            load(quantum, {"b": "ge1", "s": ["P2PK"], "p": ["never_spent"], "m": "exposed", "c": 1, "e": 1, "r": "lite", "n": 25})
            link = copy(quantum)
            before = decoded_link(link)
            assert before["b"] == "ge1" and before["s"] == ["P2PK"] and before["p"] == ["never_spent"], before
            assert before["q"] == "" and before["r"] == "lite" and before["a"] == 0, before
            assert before["h"].isdigit() and before["t"] == "s" and before["n"] == 25, before
            load(quantum, link=link)
            assert decoded_link(copy(quantum)) == before, "Quantum copied state changed after paste"
            load(quantum, {})
            default = decoded_link(copy(quantum))
            assert default["b"] == "all" and default["s"] == ["All"] and default["v"] == "bars", default
            assert default["q"] == "" and default["m"] == "total" and default["r"] == "lite", default
            print("Quantum filters, snapshot, table count, and default override round trips passed.", flush=True)

            casascius = "casascius_explorer"
            casa_state = {
                "coin": "cas_1btc_2011_s1", "quarter": False,
                "panels": {"left": True, "bottom": True, "right": True, "leftMode": "active"},
                "view": {"angle": 180, "tilt": 0, "speedValue": 54, "zoomValue": 120, "running": False, "viewMode": "back"},
                "priceUnit": "usd", "priceScale": "log", "balanceUnit": "usd",
                "priceGroups": {"originalFunded": False, "fundedSale": True, "originalPremium": False, "redeemedSale": True},
                "balanceSeries": {"minted": True, "active": False, "redeemed": True},
                "chartOpen": True, "chartMode": "balance", "chartBackgroundHidden": True,
                "versionsCollapsed": False, "query": "",
            }
            load(casascius, casa_state)
            link = copy(casascius)
            before = decoded_link(link)
            assert evaluate("!!document.querySelector('#copyDashboardLink svg') && document.getElementById('copyDashboardLink').title === 'Link copied'"), "Casascius copy feedback missing"
            assert evaluate("(async () => { await new Promise(resolve => setTimeout(resolve, 1500)); return !!document.querySelector('#copyDashboardLink svg') && document.getElementById('copyDashboardLink').title === 'Copy link to this view'; })()"), "Casascius copy icon or label was not restored"
            for key in ["coin", "quarter", "panels", "priceUnit", "priceScale", "balanceUnit", "priceGroups", "balanceSeries", "chartOpen", "chartMode", "chartBackgroundHidden"]:
                assert before[key] == casa_state[key], (key, before[key], casa_state[key])
            load(casascius, link=link)
            after = decoded_link(copy(casascius))
            for key in ["coin", "quarter", "panels", "view", "priceUnit", "priceScale", "balanceUnit", "priceGroups", "balanceSeries", "chartOpen", "chartMode", "chartBackgroundHidden", "selection"]:
                assert after[key] == before[key], (key, before[key], after[key])
            if before["selection"]["address"]:
                search_state = {**before, "query": before["selection"]["address"]}
                load(casascius, search_state)
                searched = decoded_link(copy(casascius))
                assert searched["query"] == search_state["query"], searched
                assert searched["selection"]["address"] == search_state["query"], searched
                assert searched["view"] == before["view"], (searched["view"], before["view"])
            load(casascius, {})
            default = decoded_link(copy(casascius))
            assert default["coin"] == "all:coins-bars" and default["quarter"] is False, default
            assert default["priceUnit"] == "btc" and default["priceScale"] == "linear" and default["chartOpen"] is False, default
            print("Casascius coin, search, selection, chart, currency, series, view, and default override round trips passed.", flush=True)
        finally:
            chrome.terminate()
            try:
                chrome.wait(timeout=5)
            except subprocess.TimeoutExpired:
                chrome.kill()
            server.shutdown()


if __name__ == "__main__":
    main()
