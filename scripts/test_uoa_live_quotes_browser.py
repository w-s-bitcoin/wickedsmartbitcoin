#!/usr/bin/env python3
"""Exercise selected-only UoA quotes against frozen published data in Chrome."""

import json
import os
import subprocess
import tempfile
import threading
import urllib.request
from datetime import date, datetime, time, timedelta, timezone
from http.server import ThreadingHTTPServer
from pathlib import Path

from test_comparison_live_price_browser import FrozenHandler
from test_dca_live_price_browser import FEED_SHIM
from test_stage1_refresh_atomicity import CdpSocket, free_port, wait_for


ROOT = Path(__file__).resolve().parents[1]
CHROME = os.environ.get("CHROME_BIN", "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome")
DATA = (
    "assets/daily_price.csv",
    "webapps/uoa/webapp_data/daily_fx_rates.csv",
    "webapps/uoa/webapp_data/uoa_pairs.json",
    "webapps/uoa/webapp_data/last_updated.txt",
)

QUOTE_SHIM = r"""
(() => {
  const NativeDate = Date;
  const now = __FAKE_NOW__;
  class FixtureDate extends NativeDate {
    constructor(...args) { super(...(args.length ? args : [now])); }
    static now() { return now; }
  }
  window.Date = FixtureDate;
  const nativeFetch = window.fetch.bind(window);
  window.__uoaQuoteFixture = { calls: [], hold: false, pending: [], rates: {
    'FX_IDC:EURUSD': 1.2, 'FX_IDC:USDJPY': 150,
  } };
  window.fetch = (input, options = {}) => {
    const url = String(typeof input === 'string' ? input : input?.url || '');
    const fixture = window.__uoaQuoteFixture;
    if (url === 'https://scanner.tradingview.com/forex/scan') {
      const tickers = JSON.parse(options.body).symbols.tickers;
      fixture.calls.push(tickers);
      const reply = () => new Response(JSON.stringify({ data: tickers
        .filter((ticker) => fixture.rates[ticker])
        .map((ticker) => ({ s: ticker, d: [fixture.rates[ticker],
          ticker === 'FX_IDC:USDJPY' ? 'delayed_streaming_900' : 'streaming'] }))
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      if (fixture.hold) return new Promise((resolve) => fixture.pending.push(() => resolve(reply())));
      return Promise.resolve(reply());
    }
    if (url.startsWith('https://api.gold-api.com/price/')) {
      fixture.calls.push([url]);
      const symbol = url.split('/').at(-1);
      return Promise.resolve(new Response(JSON.stringify({
        symbol, currency: 'USD', price: 3000, updatedAt: new Date(now).toISOString(),
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
    FrozenHandler.snapshot = {"/" + name: (ROOT / name).read_bytes() for name in DATA}
    fx_last = FrozenHandler.snapshot["/webapps/uoa/webapp_data/daily_fx_rates.csv"].decode().strip().splitlines()[-1].split(",", 1)[0]
    next_day = date.fromisoformat(fx_last) + timedelta(days=1)
    fake_now = int(datetime.combine(next_day, time(12), timezone.utc).timestamp() * 1000)
    server_port, debug_port = free_port(), free_port()
    server = ThreadingHTTPServer(("127.0.0.1", server_port),
        lambda *args, **kwargs: FrozenHandler(*args, directory=str(ROOT), **kwargs))
    threading.Thread(target=server.serve_forever, daemon=True).start()
    with tempfile.TemporaryDirectory(prefix="wsb-uoa-live-") as profile:
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
                "source": FEED_SHIM + QUOTE_SHIM.replace("__FAKE_NOW__", str(fake_now)),
            })
            cdp.command("Page.navigate", {"url": f"http://127.0.0.1:{server_port}/webapps/uoa/dashboard.html"})
            try:
                wait_for(lambda: cdp.evaluate("""
                  document.querySelector('#usdBtcChart')?.width > 0
                  && document.querySelector('#primaryUoaSelect')?.options.length > 100
                  && document.querySelector('#btcUsdEndDateEdge')?.textContent?.trim()
                  && window.__dcaTestSocket?.subscription?.channels?.[0] === 'ticker_batch'
                """), timeout=35, description="Unit of Account dashboard load")
            except TimeoutError:
                diagnostic = cdp.evaluate("""({
                  canvas: document.querySelector('#usdBtcChart')?.width,
                  options: document.querySelector('#primaryUoaSelect')?.options.length,
                  end: document.querySelector('#btcUsdEndDateEdge')?.textContent,
                  socket: window.__dcaTestSocket?.subscription,
                  updated: document.querySelector('#updatedKpiValue')?.textContent,
                  title: document.querySelector('#pairKpiChip')?.title,
                  body: document.body?.className,
                })""")
                raise AssertionError(f"Unit of Account startup: {diagnostic}") from None
            assert_browser(cdp, """(() => {
              if (window.__uoaQuoteFixture.calls.length) return 'unselected FX was fetched at startup';
              if (!document.querySelector('#pairKpiChip').title.includes('published snapshot'))
                return 'cold-start snapshot is not identified';
              if (document.querySelector('.pair-primary .pair-status')?.dataset.kind !== 'published'
                  || document.querySelector('.pair-secondary .pair-status')?.dataset.kind !== 'reference')
                return 'cold-start pair dots do not identify snapshot and USD reference';
              for (const leg of document.querySelectorAll('#pairKpiValue .pair-leg')) {
                const dot = leg.querySelector('.pair-status').getBoundingClientRect();
                const code = leg.querySelector('.pair-code').getBoundingClientRect();
                if (dot.right >= code.left || Math.abs((dot.top + dot.bottom) / 2 - (code.top + code.bottom) / 2) > 2)
                  return 'pair status dot is not vertically centered to the left of its currency';
              }
              window.__uoaQuoteFixture.publishedHeight = document.querySelector('#updatedKpiValue').textContent.split(' | ').at(-1);
              return '';
            })()""")
            cdp.evaluate("window.__dcaTestSocket.emit(90000, 'BTC-USD', new Date().toISOString())")
            wait_for(lambda: cdp.evaluate("document.querySelector('#pairKpiChip')?.title.includes('BTC: Coinbase live')"),
                     description="live BTC quote")
            assert_browser(cdp, """(() => {
              if (document.querySelector('.pair-primary .pair-status')?.dataset.kind !== 'live')
                return 'BTC dot did not turn green after its quote';
              window.__uoaQuoteFixture.hold = true;
              const secondary = document.querySelector('#secondaryUoaSelect');
              secondary.value = 'EUR';
              secondary.dispatchEvent(new Event('change', { bubbles: true }));
              if (!document.querySelector('#pairKpiChip').title.includes('published snapshot: EUR'))
                return 'switch did not retain the EUR snapshot while loading';
              if (document.querySelector('.pair-secondary .pair-status')?.dataset.kind !== 'published')
                return 'pending EUR dot should show the published snapshot';
              window.__uoaQuoteFixture.pendingEurValue = document.querySelector('#btcUsdBig').textContent;
              return '';
            })()""")
            wait_for(lambda: cdp.evaluate("window.__uoaQuoteFixture.pending.length > 0"),
                     description="selected EUR request")
            assert_browser(cdp, """(() => {
              const calls = window.__uoaQuoteFixture.calls.flat();
              if (calls.some((ticker) => !ticker.includes('EUR')))
                return 'unselected fiat currencies were requested';
              window.__uoaQuoteFixture.hold = false;
              window.__uoaQuoteFixture.pending.splice(0).forEach((reply) => reply());
              return '';
            })()""")
            wait_for(lambda: cdp.evaluate("document.querySelector('#pairKpiChip')?.title.includes('EUR: TradingView FX')"),
                     description="EUR quote and cross")
            assert_browser(cdp, f"""(() => {{
              if (document.querySelector('.pair-secondary .pair-status')?.dataset.kind !== 'live')
                return 'EUR dot did not turn green after its quote';
              if (document.querySelector('#btcUsdBig').textContent === window.__uoaQuoteFixture.pendingEurValue)
                return 'EUR quote did not change the latest KPI value';
              if (document.querySelector('#btcUsdEndDateEdge').textContent !== '{next_day.month}/{next_day.day}/{next_day.year % 100:02d}')
                return 'provisional current-day point is missing';
              if (!document.querySelector('#updatedKpiValue').textContent.endsWith(' | ' + window.__uoaQuoteFixture.publishedHeight))
                return 'published block height disappeared from Updated';
              const primary = document.querySelector('#primaryUoaSelect');
              primary.value = 'JPY';
              primary.dispatchEvent(new Event('change', {{ bubbles: true }}));
              window.__uoaQuoteFixture.pendingJpyValue = document.querySelector('#btcUsdBig').textContent;
              return '';
            }})()""")
            wait_for(lambda: cdp.evaluate("document.querySelector('#pairKpiChip')?.title.includes('JPY: TradingView FX')"),
                     description="selected JPY quote")
            assert_browser(cdp, """(() => {
              const calls = window.__uoaQuoteFixture.calls.flat();
              if (calls.some((ticker) => !/EUR|JPY/.test(ticker)))
                return 'a currency outside the selected pair was fetched';
              const title = document.querySelector('#pairKpiChip').title;
              if (!title.includes('EUR: TradingView FX') || !title.includes('JPY: TradingView FX'))
                return 'fiat cross did not use both USD legs';
              if (document.querySelector('.pair-primary .pair-status')?.dataset.kind !== 'delayed')
                return 'delayed JPY dot was not distinguished from a live quote';
              if (document.querySelector('#btcUsdBig').textContent === window.__uoaQuoteFixture.pendingJpyValue)
                return 'JPY quote did not change the fiat cross KPI';
              const secondary = document.querySelector('#secondaryUoaSelect');
              secondary.value = 'XAU';
              secondary.dispatchEvent(new Event('change', { bubbles: true }));
              return '';
            })()""")
            wait_for(lambda: cdp.evaluate("document.querySelector('#pairKpiChip')?.title.includes('XAU: Gold API')"),
                     description="selected gold quote")
            assert_browser(cdp, """(() => {
              const calls = window.__uoaQuoteFixture.calls.flat();
              if (!calls.some((item) => item === 'https://api.gold-api.com/price/XAU'))
                return 'selected metal was not requested';
              if (calls.some((item) => String(item).includes('/price/XAG')
                  || String(item).includes('/price/XPT') || String(item).includes('/price/XPD')))
                return 'unselected metals were requested';
              const secondary = document.querySelector('#secondaryUoaSelect');
              secondary.value = 'CUP';
              secondary.dispatchEvent(new Event('change', { bubbles: true }));
              return '';
            })()""")
            wait_for(lambda: cdp.evaluate("window.__uoaQuoteFixture.calls.flat().some((ticker) => ticker === 'FX_IDC:CUPUSD')"),
                     description="unavailable selected currency request")
            assert_browser(cdp, """(() => {
              const title = document.querySelector('#pairKpiChip').title;
              if (!title.includes('published snapshot: CUP'))
                return 'unavailable currency lost its published fallback';
              if (!document.querySelector('#btcUsdBig').textContent.trim())
                return 'unavailable live quote blanked the comparison';
              if (document.querySelector('.pair-secondary .pair-status')?.dataset.kind !== 'published')
                return 'unavailable CUP quote should keep a gray snapshot dot';
              window.__uoaQuoteFixture.hold = true;
              const secondary = document.querySelector('#secondaryUoaSelect');
              secondary.value = 'EUR';
              secondary.dispatchEvent(new Event('change', { bubbles: true }));
              return '';
            })()""")
            wait_for(lambda: cdp.evaluate("window.__uoaQuoteFixture.pending.length > 0"),
                     description="held old selection request")
            assert_browser(cdp, """(() => {
              const secondary = document.querySelector('#secondaryUoaSelect');
              secondary.value = 'XAU';
              secondary.dispatchEvent(new Event('change', { bubbles: true }));
              return '';
            })()""")
            wait_for(lambda: cdp.evaluate("document.querySelector('#pairKpiChip')?.title.includes('XAU: Gold API')"),
                     description="new selection while old request remains pending")
            assert_browser(cdp, """(() => {
              window.__uoaQuoteFixture.hold = false;
              window.__uoaQuoteFixture.pending.splice(0).forEach((reply) => reply());
              if (document.querySelector('#secondaryUoaSelect').value !== 'XAU')
                return 'old request changed the selected currency';
              if (document.querySelector('.pair-secondary .pair-status')?.dataset.kind !== 'live')
                return 'selected metal dot should be green';
              const retained = document.querySelector('#btcUsdBig').textContent;
              const originalNow = Date.now;
              Date.now = () => originalNow() + 59999;
              window.dispatchEvent(new Event('resize'));
              if (document.querySelector('.pair-secondary .pair-status')?.dataset.kind !== 'live')
                return 'metal dot went gray before 60 seconds';
              Date.now = () => originalNow() + 60000;
              window.dispatchEvent(new Event('resize'));
              if (document.querySelector('.pair-secondary .pair-status')?.dataset.kind !== 'stale'
                  || document.querySelector('.pair-primary .pair-status')?.dataset.kind !== 'stale')
                return 'retained quote dots did not turn gray at 60 seconds';
              if (document.querySelector('#btcUsdBig').textContent !== retained)
                return 'feed outage changed the last displayed price';
              Date.now = originalNow;
              return '';
            })()""")
            print("UoA selected live quotes browser regression passed")
        finally:
            chrome.terminate()
            try:
                chrome.wait(timeout=5)
            except subprocess.TimeoutExpired:
                chrome.kill()
            server.shutdown()


if __name__ == "__main__":
    main()
