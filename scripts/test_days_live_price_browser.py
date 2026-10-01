#!/usr/bin/env python3
"""Check Days Since ATH live BTC/USD presentation against a frozen publication."""

import json
import os
import subprocess
import tempfile
import threading
import urllib.request
from http.server import ThreadingHTTPServer
from pathlib import Path

from test_dca_live_price_browser import FEED_SHIM
from test_stage1_refresh_atomicity import CdpSocket, free_port, wait_for
from test_stage4_live_refresh import SnapshotHandler, build_data_snapshot


ROOT = Path(__file__).resolve().parents[1]
CHROME = os.environ.get("CHROME_BIN", "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome")


def check(cdp, expression):
    result = cdp.evaluate(expression)
    if result:
        raise AssertionError(result)


def main():
    if not Path(CHROME).is_file():
        raise SystemExit(f"Chrome not found at {CHROME}; set CHROME_BIN")
    SnapshotHandler.snapshot = build_data_snapshot()
    server_port, debug_port = free_port(), free_port()
    server = ThreadingHTTPServer(("127.0.0.1", server_port),
        lambda *args, **kwargs: SnapshotHandler(*args, directory=str(ROOT), **kwargs))
    threading.Thread(target=server.serve_forever, daemon=True).start()

    with tempfile.TemporaryDirectory(prefix="wsb-days-live-cdp-") as profile:
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
            cdp.command("Page.addScriptToEvaluateOnNewDocument", {"source": FEED_SHIM})
            cdp.command("Page.navigate", {"url": f"http://127.0.0.1:{server_port}/webapps/days_since_ath/dashboard.html"})
            wait_for(lambda: cdp.evaluate("""
              document.querySelector('#priceChartLoader')?.classList.contains('hidden')
              && document.querySelector('#daysChartLoader')?.classList.contains('hidden')
              && document.querySelector('#priceCanvas')?.width > 0
              && window.__dcaTestSocket?.subscription?.channels?.[0] === 'ticker_batch'
            """), timeout=65, description="Days Since ATH dashboard and spot subscription")
            check(cdp, """
              (() => {
                const dollars = (text) => Number(text.replace(/[^0-9.]/g, ''));
                const updated = document.querySelector('#updatedKpi').textContent;
                const height = updated.split(' | ').at(-1);
                if (!/^[0-9,]+$/.test(height)) return 'published height missing from Updated';
                if (document.querySelector('#chipSpotPrice').dataset.live !== 'false')
                  return 'published fallback badge missing';
                const high = document.querySelector('#dailyHighKpi').textContent;
                const publishedDay = document.querySelector('#endDateInput').value;
                const utcDay = new Date().toISOString().slice(0, 10);
                const drawdown = document.querySelector('#drawdownKpi').textContent;
                const priceImage = document.querySelector('#priceCanvas').toDataURL();
                const quote = Math.max(1, dollars(high) * 0.8);
                window.__dcaTestSocket.emit(quote, 'ETH-USD');
                if (document.querySelector('#chipSpotPrice').dataset.live !== 'false')
                  return 'wrong product accepted';
                window.__dcaTestSocket.emit(quote);
                if (document.querySelector('#chipSpotPrice').dataset.live !== 'true')
                  return 'live BTCUSD badge missing';
                if (publishedDay === utcDay && document.querySelector('#dailyHighKpi').textContent !== high)
                  return 'lower spot quote lowered the published daily high';
                if (publishedDay !== utcDay &&
                    Math.abs(dollars(document.querySelector('#dailyHighKpi').textContent) - quote) > 0.01)
                  return `new UTC day high: published=${publishedDay} utc=${utcDay} quote=${quote} high=${document.querySelector('#dailyHighKpi').textContent}`;
                if (document.querySelector('#drawdownKpi').textContent === drawdown)
                  return 'drawdown did not follow spot';
                if (document.querySelector('#priceCanvas').toDataURL() === priceImage)
                  return 'current price guide did not redraw';
                if (!document.querySelector('#updatedKpi').textContent.endsWith(` | ${height}`))
                  return 'live quote changed the published height';
                const firstTime = document.querySelector('#updatedKpi').textContent;
                window.__dcaTestSocket.emit(quote, 'BTC-USD', new Date(Date.now() + 2000).toISOString());
                if (document.querySelector('#updatedKpi').textContent === firstTime)
                  return 'fresh same-price quote did not advance Updated';
                const daysImage = document.querySelector('#daysCanvas').toDataURL();
                const newAth = dollars(document.querySelector('#athKpi').textContent) * 1.1;
                window.__dcaTestSocket.emit(newAth, 'BTC-USD', new Date(Date.now() + 4000).toISOString());
                if (document.querySelector('#dailyHighKpi').textContent === high)
                  return 'new daily high missing from KPI';
                if (document.querySelector('#daysKpi').textContent !== '0')
                  return 'new ATH did not reset days since ATH';
                if (document.querySelector('#daysCanvas').toDataURL() === daysImage)
                  return 'days since ATH chart did not redraw at new ATH';
                const athText = document.querySelector('#athKpi').textContent;
                const liveHighText = document.querySelector('#dailyHighKpi').textContent;
                window.__dcaTestSocket.emit(quote, 'BTC-USD', new Date(Date.now() + 6000).toISOString());
                if (document.querySelector('#dailyHighKpi').textContent !== liveHighText
                    || document.querySelector('#athKpi').textContent !== athText)
                  return 'later lower quote erased the observed high or ATH';
                if (document.querySelector('#daysKpi').textContent !== '0')
                  return 'later lower quote erased the ATH date';
                return '';
              })()
            """)
            cdp.command("Page.navigate", {"url": f"http://127.0.0.1:{server_port}/webapps/days_since_ath/preview.html"})
            wait_for(lambda: cdp.evaluate("""
              document.querySelector('#daysSinceAthPreview')?.dataset.priceSource === 'published'
              && window.__dcaTestSocket?.subscription?.channels?.[0] === 'ticker_batch'
            """), timeout=65, description="Days Since ATH homepage card and spot subscription")
            check(cdp, """
              (() => {
                const canvas = document.querySelector('#daysSinceAthPreview');
                const published = canvas.toDataURL();
                window.__dcaTestSocket.emit(40000);
                if (canvas.dataset.priceSource !== 'live') return 'home card stayed published';
                const first = canvas.toDataURL();
                if (first === published) return 'home card current spot guide did not move';
                window.__dcaTestSocket.emit(80000);
                if (canvas.toDataURL() === first) return 'home card did not update on next quote';
                const realNow = Date.now;
                Date.now = () => realNow() + 90002;
                window.dispatchEvent(new Event('resize'));
                Date.now = realNow;
                if (canvas.dataset.priceSource !== 'published') return 'stale quote did not fall back';
                if (canvas.toDataURL() !== published) return 'published card changed after fallback';
                return '';
              })()
            """)
            print("Days Since ATH dashboard and home card live price browser regression passed.")
        finally:
            chrome.terminate()
            try:
                chrome.wait(timeout=5)
            except subprocess.TimeoutExpired:
                chrome.kill()
            server.shutdown()


if __name__ == "__main__":
    main()
