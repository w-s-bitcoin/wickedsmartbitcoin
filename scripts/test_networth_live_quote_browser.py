#!/usr/bin/env python3
"""Check Net Worth quote retention, freshness, and published-price priority."""

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

SHIM = r"""
(() => {
  const nativeFetch = window.fetch.bind(window);
  window.__netQuote = { offline: localStorage.getItem('netQuoteFixtureOffline') === '1', price: 123456 };
  window.fetch = (input, options) => {
    const url = String(typeof input === 'string' ? input : input?.url || '');
    if (url.includes('/0/public/Ticker?pair=USDCUSD,XBTUSDC')) {
      if (window.__netQuote.offline) return Promise.reject(new TypeError('fixture offline'));
      return Promise.resolve(new Response(JSON.stringify({ result: {
        USDCUSD: { a: ['1'] }, XBTUSDC: { a: [String(window.__netQuote.price)] },
      } }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    }
    return nativeFetch(input, options);
  };
})();
"""


def main():
    if not Path(CHROME).is_file():
        raise SystemExit(f"Chrome not found at {CHROME}; set CHROME_BIN")
    server_port, debug_port = free_port(), free_port()
    server = ThreadingHTTPServer(("127.0.0.1", server_port),
        lambda *args, **kwargs: QuietHandler(*args, directory=str(ROOT), **kwargs))
    threading.Thread(target=server.serve_forever, daemon=True).start()
    with tempfile.TemporaryDirectory(prefix="wsb-networth-quote-cdp-") as profile:
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
            cdp.command("Page.addScriptToEvaluateOnNewDocument", {"source": SHIM})
            cdp.command("Page.navigate", {"url":
                f"http://127.0.0.1:{server_port}/webapps/bitcoin_net_worth/dashboard.html"})
            wait_for(lambda: cdp.evaluate("""
              document.querySelector('#quoteStatusDot')?.dataset.kind === 'live'
              && Number(formState.btcusd) === 123456
              && publishedBtcPriceAt > 0
            """), timeout=65, description="Net Worth live quote and published snapshot")
            result = cdp.evaluate("""
              (async () => {
                const price = Number(formState.btcusd);
                window.__netQuote.offline = true;
                const realNow = Date.now;
                Date.now = () => realNow() + 61000;
                updateQuoteStatus();
                const stale = document.querySelector('#quoteStatusDot').dataset.kind === 'stale'
                  && Number(formState.btcusd) === price
                  && document.querySelector('#quoteStatusDot').title.includes('last Kraken quote');
                Date.now = realNow;
                if (!stale) return 'outage did not retain the quote with a gray dot';
                const candidate = await fetchPublishedDemoCandidate((url, init) => fetch(url, init));
                const priceLines = candidate.priceText.trim().split(/\\r?\\n/);
                const lastCells = priceLines.at(-1).split(',');
                lastCells[1] = new Date(lastQuoteRefreshAt.getTime() + 1000)
                  .toISOString().slice(0, 19).replace('T', ' ');
                priceLines[priceLines.length - 1] = lastCells.join(',');
                candidate.priceText = priceLines.join('\\n') + '\\n';
                candidate.prices[mmddyy(new Date(candidate.latestPriceDateMs))] = 99000;
                installPublishedDemoCandidate(candidate);
                if (document.querySelector('#quoteStatusDot').dataset.kind !== 'stale'
                    || !document.querySelector('#quoteTime').textContent.startsWith('Published')
                    || Number(formState.btcusd) !== 99000)
                  return 'newer published price did not take priority';
                return '';
              })()
            """)
            if result:
                raise AssertionError(result)
            cdp.evaluate("""
              localStorage.setItem('bitcoinNetWorthTrackerBtcusdCacheTimeV1',
                String(Date.now() - 120000));
              localStorage.setItem('netQuoteFixtureOffline', '1');
            """)
            cdp.command("Page.navigate", {"url":
                f"http://127.0.0.1:{server_port}/webapps/bitcoin_net_worth/dashboard.html"})
            wait_for(lambda: cdp.evaluate("""
              document.querySelector('#quoteStatusDot')?.dataset.kind === 'stale'
              && Number(formState.btcusd) === 123456
              && document.querySelector('#quoteStatusDot')?.title.includes('last Kraken quote')
            """), timeout=65, description="retained Net Worth quote after reload while offline")
            print("Net Worth quote retention and status browser regression passed.")
        finally:
            chrome.terminate()
            try:
                chrome.wait(timeout=5)
            except subprocess.TimeoutExpired:
                chrome.kill()
            server.shutdown()


if __name__ == "__main__":
    main()
