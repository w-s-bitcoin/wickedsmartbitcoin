#!/usr/bin/env python3
"""Exercise current-day DCA Comparison prices and its homepage card in Chrome."""

import json
import mimetypes
import os
import subprocess
import tempfile
import threading
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from http.server import ThreadingHTTPServer
from pathlib import Path

from test_dca_live_price_browser import FEED_SHIM
from test_stage1_refresh_atomicity import CdpSocket, QuietHandler, free_port, wait_for


ROOT = Path(__file__).resolve().parents[1]
CHROME = os.environ.get("CHROME_BIN", "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome")

DATA_PATHS = (
    "assets/daily_price.csv",
    "webapps/uoa/webapp_data/daily_fx_rates.csv",
    "webapps/dca_comparison/webapp_data/market_indices.csv",
    "webapps/dca_comparison/webapp_data/last_updated.txt",
    "webapps/dca_comparison/webapp_data/dca_comparison_preview.csv",
    "webapps/dca_comparison/webapp_data/published_generation.json",
)


class FrozenHandler(QuietHandler):
    snapshot = {}

    def do_GET(self):
        pathname = urllib.parse.unquote(urllib.parse.urlparse(self.path).path)
        body = self.snapshot.get(pathname)
        if body is None:
            return super().do_GET()
        self.send_response(200)
        self.send_header("Content-Type", mimetypes.guess_type(pathname)[0] or "application/octet-stream")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)


QUOTE_SHIM = r"""
(() => {
  const NativeDate = Date;
  const fakeNow = __FAKE_NOW_MS__;
  class FixtureDate extends NativeDate {
    constructor(...args) { super(...(args.length ? args : [fakeNow])); }
    static now() { return fakeNow; }
  }
  window.Date = FixtureDate;
  const nativeFetch = window.fetch.bind(window);
  const prices = { XAU: 5000, XAG: 60,
    'AMEX:SPY': 900, 'NASDAQ:QQQ': 850, 'NASDAQ:TLT': 100, 'NASDAQ:MSTR': 200 };
  window.__comparisonPriceFixture = { prices, fakeNow, calls: [] };
  window.fetch = (input, options = {}) => {
    const url = String(typeof input === 'string' ? input : input?.url || '');
    if (url.startsWith('https://api.gold-api.com/price/')) {
      const symbol = url.split('/').at(-1);
      window.__comparisonPriceFixture.calls.push(symbol);
      return Promise.resolve(new Response(JSON.stringify({
        symbol, currency: 'USD', price: prices[symbol], updatedAt: new Date(fakeNow).toISOString(),
      }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    }
    if (url === 'https://scanner.tradingview.com/america/scan') {
      const request = JSON.parse(options.body);
      window.__comparisonPriceFixture.calls.push('stocks');
      return Promise.resolve(new Response(JSON.stringify({
        data: request.symbols.tickers.map((ticker) => ({
          s: ticker, d: [prices[ticker], 'delayed_streaming_900'],
        })),
      }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    }
    return nativeFetch(input, options);
  };
})();
"""


def assert_browser(cdp, expression):
    result = cdp.evaluate(expression)
    if result:
        raise AssertionError(result)


def main():
    if not Path(CHROME).is_file():
        raise SystemExit(f"Chrome not found at {CHROME}; set CHROME_BIN")
    FrozenHandler.snapshot = {"/" + name: (ROOT / name).read_bytes() for name in DATA_PATHS}
    last_market_day = FrozenHandler.snapshot[
        "/webapps/dca_comparison/webapp_data/market_indices.csv"
    ].decode().strip().splitlines()[-1].split(",", 1)[0]
    fake_now_ms = int(datetime.fromisoformat(last_market_day).replace(
        hour=15, tzinfo=timezone.utc).timestamp() * 1000)
    server_port, debug_port = free_port(), free_port()
    server = ThreadingHTTPServer(("127.0.0.1", server_port),
        lambda *args, **kwargs: FrozenHandler(*args, directory=str(ROOT), **kwargs))
    threading.Thread(target=server.serve_forever, daemon=True).start()
    with tempfile.TemporaryDirectory(prefix="wsb-comparison-live-cdp-") as profile:
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
            cdp.command("Page.addScriptToEvaluateOnNewDocument", {
                "source": FEED_SHIM + QUOTE_SHIM.replace("__FAKE_NOW_MS__", str(fake_now_ms)),
            })
            cdp.command("Page.navigate", {"url": f"http://127.0.0.1:{server_port}/webapps/dca_comparison/dashboard.html"})
            try:
                wait_for(lambda: cdp.evaluate("""
                  document.querySelector('#chartCanvas')?.width > 0
                  && document.querySelector('#assetBPriceStatus')?.dataset.kind === 'live'
                  && window.__dcaTestSocket?.subscription?.channels?.[0] === 'ticker_batch'
                  && document.querySelector('#errorBox')?.hidden
                """), timeout=25, description="DCA Comparison data, metal quote and BTC socket")
            except TimeoutError:
                diagnostic = cdp.evaluate("""({
                  canvas: document.querySelector('#chartCanvas')?.width,
                  status: document.querySelector('#assetBPriceStatus')?.textContent,
                  socket: window.__dcaTestSocket?.subscription,
                  error: document.querySelector('#errorBox')?.textContent,
                  errorHidden: document.querySelector('#errorBox')?.hidden,
                  calls: window.__comparisonPriceFixture?.calls,
                  end: document.querySelector('#dateRangeEndInput')?.value,
                  updated: document.querySelector('#updatedKpi')?.textContent,
                })""")
                raise AssertionError(f"DCA Comparison startup: {diagnostic}") from None
            assert_browser(cdp, """
              (() => {
                const fixture = window.__comparisonPriceFixture;
                if (!['XAU', 'XAG', 'stocks'].every((item) => fixture.calls.includes(item)))
                  return 'not all quote providers were polled';
                const initialHeight = document.querySelector('#updatedKpi').textContent.split(' | ').at(-1);
                const firstImage = document.querySelector('#chartCanvas').toDataURL();
                const firstValue = document.querySelector('#assetADcaValue').textContent;
                window.__dcaTestSocket.emit(90000, 'BTC-USD', new Date(Date.now()).toISOString());
                const btcStatus = document.querySelector('#assetAPriceStatus');
                if (btcStatus.dataset.kind !== 'live' || btcStatus.textContent
                    || !btcStatus.closest('.kpi-card').title.includes('Green dot:'))
                  return 'BTC live dot or tooltip missing';
                if (document.querySelector('#assetAPrice').textContent !== '$90,000')
                  return 'BTC live price missing';
                if (document.querySelector('#assetADcaValue').textContent === firstValue)
                  return 'current DCA valuation did not follow BTC';
                if (document.querySelector('#chartCanvas').toDataURL() === firstImage)
                  return 'chart did not redraw on BTC quote';
                if (!document.querySelector('#updatedKpi').textContent.endsWith(` | ${initialHeight}`))
                  return 'live quote changed published block height';
                const selector = document.querySelector('#assetBSelect');
                for (const [asset, expected] of [
                  ['XAG', '$60.00'], ['SPY', '$900.00'], ['QQQ', '$850.00'],
                  ['TLT', '$100.00'], ['MSTR', '$200.00'], ['XAU', '$5,000'],
                ]) {
                  selector.value = asset;
                  selector.dispatchEvent(new Event('change', { bubbles: true }));
                  if (document.querySelector('#assetBPrice').textContent !== expected)
                    return `${asset} current price did not reach its KPI`;
                  const status = document.querySelector('#assetBPriceStatus').textContent;
                  const indicator = document.querySelector('#assetBPriceStatus');
                  if (['XAG', 'XAU'].includes(asset)) {
                    if (status || indicator.dataset.kind !== 'live'
                        || !indicator.closest('.kpi-card').title.includes('Green dot:'))
                      return `${asset} live dot or tooltip missing`;
                  } else if (status !== '15m delayed' || indicator.dataset.kind !== 'delayed') {
                    return `${asset} source delay is not identified`;
                  }
                }
                const historicalEnd = new Date(Date.parse(`${document.querySelector('#dateRangeEndInput').value}T00:00:00Z`)
                  - 86400000).toISOString().slice(0, 10);
                const endInput = document.querySelector('#dateRangeEndInput');
                endInput.value = historicalEnd;
                endInput.dispatchEvent(new Event('change', { bubbles: true }));
                if (document.querySelector('#assetAPriceStatus').textContent
                    || document.querySelector('#assetBPriceStatus').textContent)
                  return 'historical range kept current quote badges';
                return '';
              })()
            """)
            cdp.command("Page.navigate", {"url": f"http://127.0.0.1:{server_port}/webapps/dca_comparison/preview.html"})
            wait_for(lambda: cdp.evaluate("""
              document.querySelector('#comparisonPreview')?.dataset.priceSource === 'live'
              && window.__dcaTestSocket?.subscription?.channels?.[0] === 'ticker_batch'
            """), timeout=65, description="DCA Comparison live home card")
            assert_browser(cdp, """
              (() => {
                const canvas = document.querySelector('#comparisonPreview');
                const metalImage = canvas.toDataURL();
                window.__dcaTestSocket.emit(90000, 'BTC-USD', new Date(Date.now()).toISOString());
                const first = canvas.toDataURL();
                if (first === metalImage) return 'home card ignored BTC quote';
                window.__dcaTestSocket.emit(100000, 'BTC-USD', new Date(Date.now() + 1000).toISOString());
                const second = canvas.toDataURL();
                if (second === first) return 'home card ignored the next BTC quote';
                window.__comparisonCardBeforeStale = second;
                window.__comparisonRealNow = Date.now;
                Date.now = () => window.__comparisonRealNow() + 182000;
                window.dispatchEvent(new Event('resize'));
                return '';
              })()
            """)
            wait_for(lambda: cdp.evaluate("""
              document.querySelector('#comparisonPreview')?.dataset.priceSource === 'published'
            """), timeout=8, description="stale comparison preview fallback")
            assert_browser(cdp, """
              (() => {
                const canvas = document.querySelector('#comparisonPreview');
                Date.now = window.__comparisonRealNow;
                return canvas.toDataURL() === window.__comparisonCardBeforeStale
                  ? 'fallback did not redraw the home card' : '';
              })()
            """)
            print("DCA Comparison dashboard and home card live quote regression passed.")
        finally:
            chrome.terminate()
            try:
                chrome.wait(timeout=5)
            except subprocess.TimeoutExpired:
                chrome.kill()
            server.shutdown()


if __name__ == "__main__":
    main()
