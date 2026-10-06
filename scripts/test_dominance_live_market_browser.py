#!/usr/bin/env python3
"""Check Bitcoin Dominance dashboard and home preview with a browser market fixture."""

import csv
import io
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
DATA = [
    "webapps/bitcoin_dominance/webapp_data/published_generation.json",
    "webapps/bitcoin_dominance/webapp_data/chart_static.json",
    "webapps/bitcoin_dominance/webapp_data/btcd_timeseries_historical.csv",
    "webapps/bitcoin_dominance/webapp_data/btcd_timeseries_current_day.csv",
    "webapps/bitcoin_dominance/webapp_data/btcd_timeseries_incl_stables_historical.csv",
    "webapps/bitcoin_dominance/webapp_data/btcd_timeseries_incl_stables_current_day.csv",
    "webapps/bitcoin_dominance/webapp_data/top10_daily_excl_stables.csv",
    "webapps/bitcoin_dominance/webapp_data/top10_daily_incl_stables.csv",
    "assets/daily_price.csv",
    "assets/last_updated.txt",
    "assets/top_kpis.json",
]


def main():
    FrozenHandler.snapshot = {"/" + name: (ROOT / name).read_bytes() for name in DATA}
    read_rows = lambda name: list(csv.DictReader(io.StringIO(FrozenHandler.snapshot[
        "/webapps/bitcoin_dominance/webapp_data/" + name
    ].decode())))
    incl = read_rows("top10_daily_incl_stables.csv")
    excl = read_rows("top10_daily_excl_stables.csv")
    known = {row["Primary Key"]: row for row in incl + excl}
    quotes = [{
        "symbol": row["Symbol"].lower(),
        "name": row["Name"],
        "market_cap": float(row["Market Cap"]) * (1.1 if row["Symbol"] == "BTC" else 1),
        "current_price": float(row["Price"]),
        "circulating_supply": float(row["Circulating Supply"]),
    } for row in known.values()]
    fixture = """(() => {
      const nativeFetch = window.fetch.bind(window);
      window.__marketCalls = 0;
      window.__marketQuotes = __QUOTES__;
      window.fetch = (input, options) => {
        if (String(input).startsWith('https://api.coingecko.com/api/v3/coins/markets')) {
          window.__marketCalls += 1;
          return Promise.resolve(new Response(JSON.stringify(window.__marketQuotes), {
            status: 200, headers: { 'Content-Type': 'application/json' },
          }));
        }
        return nativeFetch(input, options);
      };
      window.Plotly = {
        react(target, traces) {
          const el = typeof target === 'string' ? document.getElementById(target) : target;
          if (el.querySelector('.hoverlayer')) {
            el.querySelector('.hoverlayer').remove();
            (el.__plotlyHandlers?.plotly_unhover || []).forEach((handler) => handler());
          }
          el.data = traces;
          el.__plotlyHandlers ||= {};
          el.on = (name, handler) => (el.__plotlyHandlers[name] ||= []).push(handler);
          el.removeListener = (name, handler) => {
            el.__plotlyHandlers[name] = (el.__plotlyHandlers[name] || []).filter((value) => value !== handler);
          };
          return Promise.resolve(el);
        },
        relayout: () => Promise.resolve(),
        Plots: { resize: () => Promise.resolve() },
        Fx: {
          hover(el, points) {
            const { curveNumber, pointNumber } = points[0];
            const trace = el.data[curveNumber];
            const x = trace.x[pointNumber];
            const y = trace.y[pointNumber];
            const layer = el.querySelector('.hoverlayer') || el.appendChild(document.createElement('div'));
            layer.className = 'hoverlayer';
            layer.innerHTML = '<div class="hovertext"></div>';
            layer.querySelector('.hovertext').textContent = el.id === 'snapshotChart'
              ? `${trace.customdata[pointNumber][0]} | ${trace.customdata[pointNumber][2]}`
              : `${Number(y).toFixed(3)}%`;
            el.__hoverCalls = (el.__hoverCalls || 0) + 1;
            (el.__plotlyHandlers?.plotly_hover || []).forEach((handler) => handler({ points: [{ x, y }] }));
          },
          unhover(el) {
            el.querySelector('.hoverlayer')?.remove();
            (el.__plotlyHandlers?.plotly_unhover || []).forEach((handler) => handler());
          },
        },
      };
    })();""".replace("__QUOTES__", json.dumps(quotes))
    port, debug_port = free_port(), free_port()
    server = ThreadingHTTPServer(("127.0.0.1", port),
        lambda *args, **kwargs: FrozenHandler(*args, directory=str(ROOT), **kwargs))
    threading.Thread(target=server.serve_forever, daemon=True).start()
    with tempfile.TemporaryDirectory(prefix="wsb-dominance-live-cdp-") as profile:
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
            cdp.command("Page.addScriptToEvaluateOnNewDocument", {"source": fixture})
            cdp.command("Page.navigate", {"url": f"http://127.0.0.1:{port}/webapps/bitcoin_dominance/dashboard.html"})
            wait_for(lambda: cdp.evaluate("""
              document.querySelector('#marketLiveDot')?.classList.contains('is-live')
              && document.querySelector('#kpiBitcoinMarketCap .chip-value')?.textContent.includes('·')
              && document.querySelector('#dominanceChart')?.data?.length > 0
            """), timeout=25, description="live Bitcoin Dominance dashboard")
            dashboard = cdp.evaluate("""({
              calls: window.__marketCalls,
              updated: document.querySelector('#updatedTimeZoneDisplay')?.textContent,
              cap: document.querySelector('#kpiBitcoinMarketCap .chip-value')?.textContent,
              stable: document.querySelector('#kpiStableMarketCap .chip-value')?.textContent,
              snapshotBtcCap: document.querySelector('#snapshotChart')?.data?.[0]?.x?.at(-1),
              dominance: document.querySelector('#dominanceChart')?.data?.[0]?.y?.at(-1),
              error: document.querySelector('#errorBox')?.textContent,
            })""")
            assert dashboard["calls"] >= 1 and not dashboard["error"], dashboard
            expected_btc_cap = next(quote["market_cap"] for quote in quotes if quote["symbol"] == "btc")
            expected_dominance = 100 * expected_btc_cap / sum(
                quote["market_cap"] for quote in quotes
                if quote["symbol"].upper() in {row["Symbol"] for row in incl}
            )
            assert dashboard["snapshotBtcCap"] == expected_btc_cap, dashboard
            assert abs(dashboard["dominance"] - expected_dominance) < 1e-9, dashboard
            assert "2026" in dashboard["updated"], dashboard
            cdp.evaluate("""(() => {
              const chart = document.querySelector('#snapshotChart');
              Plotly.Fx.hover(chart, [{ curveNumber: 0, pointNumber: chart.data[0].y.length - 1 }]);
              window.__beforeSnapshotHover = chart.querySelector('.hovertext').textContent;
              const btc = window.__marketQuotes.find((quote) => quote.symbol === 'btc');
              btc.market_cap *= 1.05;
              btc.current_price *= 1.05;
              document.dispatchEvent(new Event('visibilitychange'));
            })()""")
            wait_for(lambda: cdp.evaluate("""
              window.__marketCalls >= 2
              && document.querySelector('#snapshotChart')?.__hoverCalls >= 2
              && document.querySelector('#snapshotChart .hovertext')?.textContent !== window.__beforeSnapshotHover
            """), timeout=10, description="snapshot tooltip repaint while hovered")
            cdp.evaluate("""(() => {
              Plotly.Fx.unhover(document.querySelector('#snapshotChart'));
              const chart = document.querySelector('#dominanceChart');
              const curveNumber = chart.data.findIndex((trace) => trace.name === 'BTC Dominance');
              Plotly.Fx.hover(chart, [{ curveNumber, pointNumber: chart.data[curveNumber].x.length - 1 }]);
              window.__beforeHistoryHover = chart.querySelector('.hovertext').textContent;
              window.__marketQuotes.find((quote) => quote.symbol === 'btc').market_cap *= 1.05;
              document.dispatchEvent(new Event('visibilitychange'));
            })()""")
            wait_for(lambda: cdp.evaluate("""
              window.__marketCalls >= 3
              && document.querySelector('#dominanceChart')?.__hoverCalls >= 2
              && document.querySelector('#dominanceChart .hovertext')?.textContent !== window.__beforeHistoryHover
            """), timeout=10, description="dominance tooltip repaint while hovered")
            cdp.command("Page.navigate", {"url": f"http://127.0.0.1:{port}/webapps/bitcoin_dominance/preview.html"})
            wait_for(lambda: cdp.evaluate("""
              document.querySelector('#previewChart')?.dataset.previewState === 'ready'
              && !document.querySelector('#marketLiveDot')
            """), timeout=20, description="live Bitcoin Dominance home card")
            assert cdp.evaluate("window.__marketCalls >= 1")
            print("Bitcoin Dominance dashboard and home card live market checks passed")
        finally:
            chrome.terminate()
            chrome.wait(timeout=10)
            server.shutdown()


if __name__ == "__main__":
    main()
