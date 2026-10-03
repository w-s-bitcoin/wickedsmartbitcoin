#!/usr/bin/env python3
"""Exercise the DCA live spot feed and historical fallback in a browser."""

import json
import os
import subprocess
import tempfile
import threading
import urllib.request
from http.server import ThreadingHTTPServer
from pathlib import Path

from test_stage1_refresh_atomicity import CdpSocket, QuietHandler, free_port, wait_for


ROOT = Path(__file__).resolve().parents[1]
CHROME = os.environ.get("CHROME_BIN", "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome")

FEED_SHIM = r"""
(() => {
  class PriceSocket {
    constructor(url) {
      this.url = url;
      if (url === 'wss://2140data.io/') window.__dcaTestSocket = this;
      setTimeout(() => this.onopen?.(), 0);
    }
    send(payload) { this.subscription = JSON.parse(payload); }
    close() { this.closed = true; }
    emit(price, product = 'BTC-USD', time = new Date().toISOString()) {
      this.onmessage?.({ data: JSON.stringify({
        ...(product === 'BTC-USD' ? { weightedPrice: String(price) } : { price: String(price) }),
        time,
      }) });
    }
  }
  window.WebSocket = PriceSocket;
  window.__dcaTestRest = { ticker: null };
  const nativeFetch = window.fetch.bind(window);
  window.fetch = (input, options) => {
    const url = String(typeof input === 'string' ? input : input?.url || '');
    if (url === 'https://2140data.io/price') {
      return Promise.reject(new TypeError('2140data REST intentionally offline in this fixture'));
    }
    if (url === 'https://api.exchange.coinbase.com/products/BTC-USD/ticker'
        && window.__dcaTestRest.ticker) {
      return Promise.resolve(new Response(JSON.stringify(window.__dcaTestRest.ticker), {
        status: 200, headers: { 'Content-Type': 'application/json' },
      }));
    }
    if (url === 'https://api.exchange.coinbase.com/products/BTC-USD/stats'
        && window.__dcaTestRest.ticker) {
      return Promise.resolve(new Response(JSON.stringify({ last: window.__dcaTestRest.ticker.price }), {
        status: 200, headers: { 'Content-Type': 'application/json' },
      }));
    }
    if (/^https:\/\/(api\.exchange\.coinbase\.com|api\.coinbase\.com|api\.kraken\.com|mempool\.space)\//.test(url)) {
      return Promise.reject(new TypeError('Price provider intentionally offline in this fixture'));
    }
    return nativeFetch(input, options);
  };
})();
"""


def main():
    if not Path(CHROME).is_file():
        raise SystemExit(f"Chrome not found at {CHROME}; set CHROME_BIN")
    server_port = free_port()
    debug_port = free_port()
    handler = lambda *args, **kwargs: QuietHandler(*args, directory=str(ROOT), **kwargs)
    server = ThreadingHTTPServer(("127.0.0.1", server_port), handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    live_probe = os.environ.get("DCA_LIVE_PROBE") == "1"

    with tempfile.TemporaryDirectory(prefix="wsb-dca-live-cdp-") as profile:
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
            if not live_probe:
                cdp.command("Page.addScriptToEvaluateOnNewDocument", {"source": FEED_SHIM})
            cdp.command("Page.navigate", {"url": f"http://127.0.0.1:{server_port}/webapps/dca_cost_basis/dashboard.html"})
            ready = """
              document.querySelector('#chartLoader')?.getAttribute('aria-hidden') === 'true'
              && document.querySelector('#costBasisChart')?.childElementCount > 0
            """
            if not live_probe:
                ready += "&& window.__dcaTestSocket?.url === 'wss://2140data.io/'"
            wait_for(lambda: cdp.evaluate(ready), timeout=60,
                     description="DCA chart and live price subscription")
            if live_probe:
                wait_for(lambda: cdp.evaluate("document.querySelector('#chipSpotPrice')?.dataset.live === 'true'"),
                         timeout=45, description="public live BTC/USD quote")
                source = cdp.evaluate("dcaSpotFeed.current()?.source || ''")
                cdp.command("Page.navigate", {"url": f"http://127.0.0.1:{server_port}/webapps/dca_cost_basis/preview.html"})
                try:
                    wait_for(lambda: cdp.evaluate("""
                      Boolean(document.querySelector('#costBasisChart[data-price-source="live"] svg line'))
                    """), timeout=65, description="public live BTC/USD quote on DCA home card")
                except TimeoutError:
                    diagnostic = cdp.evaluate("""
                      ({ source: document.querySelector('#costBasisChart')?.dataset.priceSource,
                         chart: Boolean(document.querySelector('#costBasisChart svg')),
                         helper: Boolean(window.WSBBitcoinSpotPrice),
                         visibility: document.visibilityState,
                         resources: performance.getEntriesByType('resource')
                           .filter(item => /coinbase|kraken|mempool/.test(item.name))
                           .map(item => item.name) })
                    """)
                    raise AssertionError(f"DCA home card public quote unavailable: {diagnostic}") from None
                print(f"Public live BTC/USD quote reached the dashboard from {source} and the home card.")
                return
            result = cdp.evaluate("""
              (() => {
                const snapshot = state.metadata.source;
                const snapshotText = updatedTimeZoneChip.formatUpdated(snapshot.latest_timestamp_utc, {
                  includeHeight: true, height: snapshot.latest_block_height,
                });
                if (document.querySelector('#chipUpdated .chip-value')?.textContent !== snapshotText)
                  return 'updated time and height do not match the price snapshot';
                if (state.seriesByCadence.daily_dca.at(-1).blockHeight !== snapshot.latest_block_height)
                  return 'published daily row height does not match the snapshot';
                const published = Number(state.metadata.source.latest_price);
                const quoted = published * 0.5;
                window.__dcaTestSocket.emit(quoted, 'ETH-USD');
                if (document.querySelector('#chipSpotPrice')?.dataset.live === 'true') return 'wrong product accepted';
                window.__dcaTestSocket.emit(quoted);
                if (document.querySelector('#chipSpotPrice')?.dataset.live !== 'true') return 'live badge missing';
                const quote = dcaSpotFeed.current();
                const quoteText = document.querySelector('#chipUpdated .chip-value')?.textContent;
                if (quoteText === snapshotText || !/[0-9]{2}:[0-9]{2}:[0-9]{2}/.test(quoteText))
                  return 'Updated did not advance to the live quote time';
                if (!quoteText.endsWith(` | ${Number(snapshot.latest_block_height).toLocaleString('en-US')}`))
                  return 'live quote changed the published snapshot height';
                if (getFilteredRows()[0].currentPrice !== quoted) return 'live valuation missing';
                const basisBefore = getFilteredRows().at(-1).dcaBasis;
                const basisPath = () => [...document.querySelectorAll('#costBasisChart svg path')]
                  .find(path => path.getAttribute('stroke') === getThemeColors().basis
                    && Number(path.getAttribute('stroke-width')) >= 3)?.getAttribute('d');
                const pathBefore = basisPath();
                window.__dcaTestSocket.emit(quoted * 1.2, 'BTC-USD',
                  new Date(Date.now() + 2000).toISOString());
                if (getFilteredRows().at(-1).dcaBasis === basisBefore)
                  return 'rolling cost basis did not recalculate on the next quote';
                if (!pathBefore || basisPath() === pathBefore)
                  return 'orange cost basis path did not redraw on the next quote';
                if (document.querySelector('#chipUpdated .chip-value')?.textContent === quoteText)
                  return 'Updated did not follow the second quote';
                const secondUpdated = document.querySelector('#chipUpdated .chip-value')?.textContent;
                window.__dcaTestSocket.emit(quoted * 1.2, 'BTC-USD',
                  new Date(Date.now() + 4000).toISOString());
                if (document.querySelector('#chipUpdated .chip-value')?.textContent === secondUpdated)
                  return 'same-price fresh quote did not advance Updated';
                if (Number(state.metadata.source.latest_price) !== published) return 'published data mutated';
                const realNow = Date.now;
                Date.now = () => realNow() + 61000;
                updateSpotPriceChip();
                if (document.querySelector('#chipSpotPrice').dataset.live !== 'false'
                    || document.querySelector('#chipSpotPrice .chip-spot-status').dataset.kind !== 'stale'
                    || getFilteredRows()[0].currentPrice !== quoted * 1.2)
                  return '60-second status changed or discarded the retained quote';
                Date.now = realNow;
                updateSpotPriceChip();
                state.dateRange.rangeTracksLatestEnd = false;
                if (getFilteredRows()[0].currentPrice !== state.priceRows.at(-1).price) return 'historical view changed';
                state.dateRange.rangeTracksLatestEnd = true;
                if (getFrameRows()[0].currentPrice !== state.priceRows.at(-1).price) return 'export frame changed';
                return '';
              })()
            """)
            if result:
                raise AssertionError(result)
            result = cdp.evaluate("""
              (async () => {
                const retained = dcaSpotFeed.last();
                const currentPrice = getFilteredRows()[0].currentPrice;
                const chipText = document.querySelector('#chipSpotPrice .chip-value').textContent;
                const publishedPrice = Number(state.metadata.source.latest_price);
                window.__dcaTestRest.ticker = {
                  price: String(publishedPrice), time: new Date(retained.at - 1000).toISOString(),
                };
                const realNow = Date.now;
                Date.now = () => realNow() + 10000;
                try {
                  window.__dcaTestSocket.onclose();
                  await new Promise((resolve) => setTimeout(resolve, 80));
                } finally {
                  Date.now = realNow;
                }
                if (dcaSpotFeed.last()?.price !== retained.price
                    || getFilteredRows()[0].currentPrice !== currentPrice
                    || document.querySelector('#chipSpotPrice .chip-value').textContent
                      !== chipText)
                  return 'older REST fallback replaced the retained live price during socket outage';
                return '';
              })()
            """)
            if result:
                raise AssertionError(result)
            cdp.command("Page.navigate", {"url": f"http://127.0.0.1:{server_port}/webapps/dca_cost_basis/preview.html"})
            wait_for(lambda: cdp.evaluate("""
              document.querySelector('#costBasisChart[data-price-source="published"] svg line')
              && window.__dcaTestSocket?.url === 'wss://2140data.io/'
            """), timeout=60, description="DCA home card and live price subscription")
            result = cdp.evaluate("""
              (() => {
                const chart = document.querySelector('#costBasisChart');
                const publishedLine = chart.querySelector('svg line').getAttribute('y1');
                const publishedPath = chart.querySelector('svg').innerHTML;
                const basisPath = () => [...chart.querySelectorAll('svg path')]
                  .find(path => path.getAttribute('stroke')
                    === getComputedStyle(document.documentElement).getPropertyValue('--accent').trim())
                  ?.getAttribute('d');
                window.__dcaTestSocket.emit(40000);
                if (chart.dataset.priceSource !== 'live') return 'home card stayed published';
                if (chart.querySelector('svg line').getAttribute('y1') === publishedLine)
                  return 'home card current price line did not move';
                if (chart.querySelector('svg').innerHTML === publishedPath)
                  return 'home card chart did not update';
                const firstLiveBasis = basisPath();
                window.__dcaTestSocket.emit(80000);
                if (!firstLiveBasis || basisPath() === firstLiveBasis)
                  return 'home card orange cost basis path did not update with the next quote';
                const now = Date.now;
                Date.now = () => now() + 90002;
                window.dispatchEvent(new Event('resize'));
                Date.now = now;
                if (chart.dataset.priceSource !== 'retained') return 'stale quote was not retained';
                if (chart.querySelector('svg').innerHTML === publishedPath)
                  return 'home card reverted to the published price after feed loss';
                return '';
              })()
            """)
            if result:
                raise AssertionError(result)
            print("DCA dashboard and home card live price browser regression passed.")
        finally:
            chrome.terminate()
            try:
                chrome.wait(timeout=5)
            except subprocess.TimeoutExpired:
                chrome.kill()
            server.shutdown()


if __name__ == "__main__":
    main()
