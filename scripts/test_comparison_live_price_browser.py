#!/usr/bin/env python3
"""Exercise current-day DCA Comparison prices and its homepage card in Chrome."""

import hashlib
import json
import mimetypes
import os
import subprocess
import tempfile
import threading
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone
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


def check_live_exports(cdp):
    """Encode real output while changing quotes between opening and final frames."""
    cdp.evaluate(r"""(() => {
      Date.now = window.__comparisonRealNow;
      const f = window.__comparisonPriceFixture;
      f.errors = []; f.pngs = []; f.done = false;
      window.alert = message => f.errors.push(message);
      f.set = (id, value) => {
        const input = document.getElementById(id); input.value = value;
        input.dispatchEvent(new Event('change', {bubbles:true}));
      };
      f.end = document.querySelector('#dateRangeEndInput').max;
      f.start = document.querySelector('#dateRangeStartInput').value;
      f.cadence = document.querySelector('#cadenceSelect').value;
      f.emit = price => window.__dcaTestSocket.emit(price, 'BTC-USD', new Date(Date.now()).toISOString());
      f.set('cadenceSelect', 'daily');
      f.set('dateRangeStartInput', f.end); f.set('dateRangeEndInput', f.end);
      const hold=document.querySelector('#downloadEndFrameHoldToggle');
      if(!hold.checked)hold.click();
      document.querySelector('#downloadQualitySelect [data-value="720"]').click();
      f.emit(90000);
      const originalText = CanvasRenderingContext2D.prototype.fillText;
      CanvasRenderingContext2D.prototype.fillText = function(text, ...args) {
        if (this.canvas.id !== 'chartCanvas' && f.text) f.text.push(String(text));
        return originalText.call(this, text, ...args);
      };
      f.originalText = originalText;
      WSBDashboardExport.downloadPng = async(canvas, filename) => {
        const image = await createImageBitmap(await new Promise(resolve => canvas.toBlob(resolve)));
        f.pngs.push({width:image.width,height:image.height,text:f.text.slice(),filename});
        image.close();
      };
      const ready = WSBDashboardExportBranding.ready;
      WSBDashboardExportBranding.ready = async () => { await ready(); f.emit(100000); };
      f.ready = ready;
      const encode = WSBDashboardExport.encodeVideo;
      WSBDashboardExport.encodeVideo = async options => {
        f.frames = []; f.done = false;
        const opening = options.settings.endFrameHold ? 30 : 0;
        let finalStart = opening;
        options.frames.forEach((date, position) => { if(date !== options.frames.at(-1)) finalStart=position+1; });
        f.finalStart = finalStart;
        const blob = await encode({...options, renderFrame: async(date, canvas, position) => {
          if(position === finalStart) f.emit(110000);
          f.text = [];
          await options.renderFrame(date, canvas, position);
          f.frames.push({date,text:f.text.slice()});
          if(position === 0) f.emit(105000);
          if(position === finalStart) f.emit(120000);
        }});
        f.videoBytes = blob?.size || 0;
        f.done = true;
        return blob;
      };
      const click = HTMLAnchorElement.prototype.click;
      HTMLAnchorElement.prototype.click = function() {if(!this.href.startsWith('blob:'))click.call(this);};
      f.text = [];
      document.querySelector('#downloadImageBtn').click();
    })()""")
    wait_for(lambda: cdp.evaluate("!document.querySelector('#downloadImageBtn').disabled"), timeout=45, description="Comparison latest PNG")
    png = cdp.evaluate("window.__comparisonPriceFixture.pngs.at(-1)")
    assert png and [png["width"], png["height"]] == [3840, 2160] and "$100,000" in png["text"], png
    cdp.evaluate("WSBDashboardExportBranding.ready=window.__comparisonPriceFixture.ready")

    def video():
        cdp.evaluate("window.__comparisonPriceFixture.emit(90000);window.__comparisonPriceFixture.done=false;document.querySelector('#dateRangeDownloadBtn').click()")
        wait_for(lambda: cdp.evaluate("window.__comparisonPriceFixture.done && !document.querySelector('#dateRangeDownloadBtn').classList.contains('is-exporting')"), timeout=60, description="Comparison live video")
        result = cdp.evaluate("({frames:window.__comparisonPriceFixture.frames,bytes:window.__comparisonPriceFixture.videoBytes,errors:window.__comparisonPriceFixture.errors})")
        assert result["bytes"] > 0 and not result["errors"], result
        return result["frames"]

    single = video()
    assert len(single) == 121, len(single)
    assert all("$90,000" in frame["text"] for frame in single[:30]), single[0]
    assert all("$110,000" in frame["text"] and "$120,000" not in frame["text"] for frame in single[30:]), single[-1]
    cdp.evaluate("window.__comparisonPriceFixture.set('dateRangeStartInput',new Date(Date.parse(window.__comparisonPriceFixture.end+'T00:00:00Z')-2*86400000).toISOString().slice(0,10));document.querySelector('#downloadEndFrameHoldToggle').click()")
    motion = video()
    assert len(motion) == 3 and "$110,000" in motion[-1]["text"], motion[-1]
    assert all("$90,000" not in frame["text"] and "$110,000" not in frame["text"] for frame in motion[:-1]), motion[:-1]
    cdp.evaluate("window.__comparisonPriceFixture.set('dateRangeEndInput',new Date(Date.parse(window.__comparisonPriceFixture.end+'T00:00:00Z')-86400000).toISOString().slice(0,10))")
    historical = video()
    assert len(historical) == 2 and all("$110,000" not in frame["text"] for frame in historical), historical
    cdp.evaluate("""(() => {
      const f=window.__comparisonPriceFixture;
      f.set('dateRangeEndInput',f.end);
      document.querySelector('#dateRangePlayBtn').click();
      document.querySelector('#dateRangePauseBtn').click();
    })()""")
    paused = video()
    assert len(paused) == 1 and "$110,000" not in paused[0]["text"], paused
    cdp.evaluate("document.activeElement?.blur();document.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowRight',bubbles:true}))")
    paused_latest = video()
    assert len(paused_latest) == 3 and "$110,000" in paused_latest[-1]["text"], paused_latest
    cdp.evaluate("document.querySelector('#dateRangeStopBtn').click()")
    cdp.evaluate("""(() => {
      const f=window.__comparisonPriceFixture;
      CanvasRenderingContext2D.prototype.fillText=f.originalText;
      f.set('dateRangeStartInput',f.start);f.set('dateRangeEndInput',f.end);f.emit(90000);
      f.set('cadenceSelect',f.cadence);
    })()""")
    print("DCA Comparison live exports passed: 4K PNG after asset readiness, single-day opening/final holds, latest/historical/paused video")


def main():
    if not Path(CHROME).is_file():
        raise SystemExit(f"Chrome not found at {CHROME}; set CHROME_BIN")
    FrozenHandler.snapshot = {"/" + name: (ROOT / name).read_bytes() for name in DATA_PATHS}
    last_market_day = FrozenHandler.snapshot[
        "/webapps/dca_comparison/webapp_data/market_indices.csv"
    ].decode().strip().splitlines()[-1].split(",", 1)[0]
    # Published CSVs include forward-filled weekend rows. Keep this fixture on
    # a trading day so its delayed equity quotes can legitimately supersede it.
    market_day = datetime.fromisoformat(last_market_day)
    while market_day.weekday() >= 5:
        market_day -= timedelta(days=1)
    last_market_day = market_day.date().isoformat()
    for path in DATA_PATHS:
        if not path.endswith(".csv"):
            continue
        key = "/" + path
        lines = FrozenHandler.snapshot[key].decode().strip().splitlines()
        date_column = 1 if path == "assets/daily_price.csv" else 0
        kept = [line for line in lines[1:]
                if line.split(",")[date_column][:10] <= last_market_day]
        FrozenHandler.snapshot[key] = ("\n".join([lines[0], *kept]) + "\n").encode()
    btc_path = "/assets/daily_price.csv"
    btc_lines = FrozenHandler.snapshot[btc_path].decode().strip().splitlines()
    btc_tail = btc_lines[-1].split(",")
    btc_tail[1] = f"{last_market_day} 13:00:00"
    btc_lines[-1] = ",".join(btc_tail)
    FrozenHandler.snapshot[btc_path] = ("\n".join(btc_lines) + "\n").encode()
    FrozenHandler.snapshot["/webapps/dca_comparison/webapp_data/last_updated.txt"] = (
        f"{last_market_day} 14:00:00.000000 UTC\n".encode()
    )
    marker_path = "/webapps/dca_comparison/webapp_data/published_generation.json"
    marker = json.loads(FrozenHandler.snapshot[marker_path])
    marker["generated_utc"] = f"{last_market_day}T14:00:00Z"
    preview = FrozenHandler.snapshot["/webapps/dca_comparison/webapp_data/dca_comparison_preview.csv"]
    preview_rows = preview.decode().strip().splitlines()[1:]
    marker["artifact"].update({
        "sha256": hashlib.sha256(preview).hexdigest(),
        "rows": len(preview_rows),
        "first_date": preview_rows[0].split(",")[0],
        "latest_date": preview_rows[-1].split(",")[0],
    })
    FrozenHandler.snapshot[marker_path] = json.dumps(marker).encode()
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
                  && window.__dcaTestSocket?.url === 'wss://ws-feed.exchange.coinbase.com'
                  && document.querySelector('#errorBox')?.hidden
                """), timeout=25, description="DCA Comparison data, metal quote and BTC socket")
            except TimeoutError:
                diagnostic = cdp.evaluate("""({
                  canvas: document.querySelector('#chartCanvas')?.width,
                  status: document.querySelector('#assetBPriceStatus')?.textContent,
                  socket: window.__dcaTestSocket?.url,
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
                for (const indicator of [btcStatus, document.querySelector('#assetBPriceStatus')]) {
                  const card = indicator.closest('.kpi-card').getBoundingClientRect();
                  const dot = indicator.getBoundingClientRect();
                  if (Math.abs(dot.left - card.left - 11) > 2
                      || Math.abs(dot.top - card.top - 11) > 2)
                    return 'live dot is not in the card top-left corner';
                }
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
                  } else if (status || indicator.dataset.kind !== 'delayed'
                      || !indicator.title.includes('15m delayed')) {
                    return `${asset} amber delay dot or tooltip is missing`;
                  }
                }
                const finalChart = document.querySelector('#chartCanvas').toDataURL();
                window.__comparisonRealNow = Date.now;
                Date.now = () => window.__comparisonRealNow() + 59999;
                window.dispatchEvent(new Event('resize'));
                if (btcStatus.dataset.kind !== 'live'
                    || document.querySelector('#assetBPriceStatus').dataset.kind !== 'live')
                  return 'a price dot turned gray before 60 seconds without an update';
                Date.now = () => window.__comparisonRealNow() + 60000;
                window.dispatchEvent(new Event('resize'));
                if (btcStatus.dataset.kind !== 'stale'
                    || !btcStatus.closest('.kpi-card').title.includes('Gray dot:')
                    || document.querySelector('#assetAPrice').textContent !== '$90,000')
                  return 'disconnected BTC price was not retained with a gray dot';
                if (document.querySelector('#assetBPriceStatus').dataset.kind !== 'stale'
                    || document.querySelector('#assetBPrice').textContent !== '$5,000')
                  return 'disconnected gold price was not retained with a gray dot';
                if (document.querySelector('#chartCanvas').toDataURL() !== finalChart)
                  return 'disconnect changed the chart despite retaining prices';
                return '';
              })()
            """)
            check_live_exports(cdp)
            btc_tail[1] = f"{last_market_day} 15:01:00"
            btc_tail[2] = "88000"
            btc_tail[4] = str(int(btc_tail[4]) + 1)
            btc_lines[-1] = ",".join(btc_tail)
            FrozenHandler.snapshot[btc_path] = ("\n".join(btc_lines) + "\n").encode()
            FrozenHandler.snapshot["/webapps/dca_comparison/webapp_data/last_updated.txt"] = (
                f"{last_market_day} 15:01:30.000000 UTC\n".encode()
            )
            cdp.evaluate("Date.now = window.__comparisonRealNow; window.WSBWebappDataAutoRefresh.requestCheck('newer-published-price')")
            try:
                wait_for(lambda: cdp.evaluate("""
                  document.querySelector('#assetAPrice')?.textContent === '$88,000'
                  && document.querySelector('#assetAPriceStatus')?.dataset.kind === 'stale'
                  && document.querySelector('#assetAPriceStatus')?.closest('.kpi-card')?.title
                    .includes('published snapshot is newer')
                """), timeout=12, description="newer published price replaces retained quote")
            except TimeoutError:
                diagnostic = cdp.evaluate("""({
                  price: document.querySelector('#assetAPrice')?.textContent,
                  gold: document.querySelector('#assetBPrice')?.textContent,
                  status: document.querySelector('#assetAPriceStatus')?.dataset.kind,
                  tooltip: document.querySelector('#assetAPriceStatus')?.closest('.kpi-card')?.title,
                  updated: document.querySelector('#updatedKpi')?.textContent,
                  refresh: window.WSBWebappDataAutoRefresh?.getStatus(),
                  error: document.querySelector('#errorBox')?.textContent,
                })""")
                raise AssertionError(f"Newer publication did not replace quote: {diagnostic}") from None
            assert_browser(cdp, """
              (() => {
                if (document.querySelector('#assetBPrice').textContent === '$5,000')
                  return 'newer published snapshot did not replace the retained gold quote';
                if (!document.querySelector('#updatedKpi').textContent.includes('15:01'))
                  return 'Updated did not follow the newer published snapshot';
                const historicalEnd = new Date(Date.parse(`${document.querySelector('#dateRangeEndInput').value}T00:00:00Z`)
                  - 86400000).toISOString().slice(0, 10);
                const endInput = document.querySelector('#dateRangeEndInput');
                endInput.value = historicalEnd;
                endInput.dispatchEvent(new Event('change', { bubbles: true }));
                if (document.querySelector('#assetAPriceStatus').dataset.kind !== 'published'
                    || document.querySelector('#assetBPriceStatus').dataset.kind !== 'published')
                  return 'historical range kept current quote badges';
                return '';
              })()
            """)
            cdp.command("Page.navigate", {"url": f"http://127.0.0.1:{server_port}/webapps/dca_comparison/preview.html"})
            wait_for(lambda: cdp.evaluate("""
              document.querySelector('#comparisonPreview')?.dataset.priceSource === 'live'
              && window.__dcaTestSocket?.url === 'wss://ws-feed.exchange.coinbase.com'
            """), timeout=65, description="DCA Comparison live home card")
            assert_browser(cdp, """
              (() => {
                const canvas = document.querySelector('#comparisonPreview');
                const metalImage = canvas.toDataURL();
                window.__dcaTestSocket.emit(90000, 'BTC-USD', new Date(Date.now()).toISOString());
                const first = canvas.toDataURL();
                if (first === metalImage) return 'home card ignored BTC quote';
                window.__dcaTestSocket.emit(100000, 'BTC-USD', new Date(Date.now()).toISOString());
                const second = canvas.toDataURL();
                if (second === first) return 'home card ignored the next BTC quote';
                window.__comparisonCardBeforeStale = second;
                window.__comparisonRealNow = Date.now;
                Date.now = () => window.__comparisonRealNow() + 60000;
                window.dispatchEvent(new Event('resize'));
                return '';
              })()
            """)
            wait_for(lambda: cdp.evaluate("""
              document.querySelector('#comparisonPreview')?.dataset.priceSource === 'retained'
            """), timeout=8, description="retained comparison preview quote")
            assert_browser(cdp, """
              (() => {
                const canvas = document.querySelector('#comparisonPreview');
                Date.now = window.__comparisonRealNow;
                return canvas.toDataURL() !== window.__comparisonCardBeforeStale
                  ? 'retained quote changed the home card values' : '';
              })()
            """)
            # Reproduce a publication that is several days behind the quote.
            cdp.command("Page.navigate", {"url": f"http://127.0.0.1:{server_port}/webapps/dca_comparison/dashboard.html"})
            wait_for(lambda: cdp.evaluate("!!document.querySelector('#assetAPrice')?.textContent && !!window.__dcaTestSocket"), timeout=60, description="lagged publication dashboard")
            assert_browser(cdp, """(() => {
              const set=(id,value)=>{const el=document.getElementById(id);el.value=value;el.dispatchEvent(new Event('change',{bubbles:true}));};
              const end=document.querySelector('#dateRangeEndInput').max;
              set('cadenceSelect','daily'); set('dateRangeEndInput',end);
              const count=document.querySelector('#countKpi').textContent;
              const invested=document.querySelector('#investedKpi').textContent;
              const now=Date.parse(end+'T15:00:00Z')+3*86400000;
              Date.now=()=>now; window.__comparisonRealNow=Date.now;
              window.__dcaTestSocket.emit(90000,'BTC-USD',new Date(now).toISOString());
              if(document.querySelector('#assetAPrice').textContent!=='$90,000')return 'publication gap disabled live BTC';
              if(document.querySelector('#assetAPriceStatus').dataset.kind!=='live')return 'publication gap lost live status';
              if(!document.querySelector('#updatedKpi').textContent.includes(new Date(now).toISOString().slice(0,10)))return 'Updated stayed on old publication';
              if(document.querySelector('#countKpi').textContent!==count||document.querySelector('#investedKpi').textContent!==invested)return 'gap invented purchases';
              return '';
            })()""")
            check_live_exports(cdp)
            cdp.command("Page.navigate", {"url": f"http://127.0.0.1:{server_port}/webapps/dca_comparison/preview.html"})
            wait_for(lambda: cdp.evaluate("document.querySelector('#comparisonPreview')?.dataset.priceSource==='live' && !!window.__dcaTestSocket"), timeout=60, description="lagged publication preview")
            cdp.evaluate("""(() => {
              const now=Date.now()+3*86400000;Date.now=()=>now;
              const canvas=document.querySelector('#comparisonPreview');window.__gapPreviewBefore=canvas.toDataURL();
              window.__dcaTestSocket.emit(190000,'BTC-USD',new Date(now).toISOString());
            })()""")
            # Gold is now retained while BTC is fresh, so the combined card can
            # correctly report retained despite using the new BTC valuation.
            wait_for(lambda: cdp.evaluate("document.querySelector('#comparisonPreview').dataset.priceSource!=='published' && document.querySelector('#comparisonPreview').toDataURL()!==window.__gapPreviewBefore"), timeout=10, description="live preview across publication gap")
            print("DCA Comparison live quotes, exports and publication-gap regressions passed.")
        finally:
            chrome.terminate()
            try:
                chrome.wait(timeout=5)
            except subprocess.TimeoutExpired:
                chrome.kill()
            server.shutdown()


if __name__ == "__main__":
    main()
