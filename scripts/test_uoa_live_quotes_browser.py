#!/usr/bin/env python3
"""Exercise selected-only UoA quotes against frozen published data in Chrome."""

import base64
import json
import shutil
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
    'FX_IDC:LBPUSD': 0.000007, 'FX_IDC:USDLBP': 89500,
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


def check_live_exports(cdp, next_day):
    """Render real PNG/MP4 output while quotes change during the encoder callback."""
    cdp.evaluate(r"""(() => {
      const f = window.__uoaQuoteFixture;
      f.errors = [];
      window.alert = message => f.errors.push(message);
      const set = (id, value) => {
        const input = document.getElementById(id); input.value = value;
        input.dispatchEvent(new Event(input.type === 'range' ? 'input' : 'change', { bubbles: true }));
      };
      set('primaryUoaSelect', 'BTC'); set('secondaryUoaSelect', 'LBP');
      f.set = set;
    })()""")
    wait_for(lambda: cdp.evaluate("document.querySelector('#pairKpiChip').title.includes('LBP: TradingView FX')"),
             description="corrected LBP quote")
    assert_browser(cdp, """(() => {
      if (window.__uoaQuoteFixture.calls.flat().includes('FX_IDC:LBPUSD'))
        return 'bad LBP direction requested';
      return '';
    })()""")
    cdp.evaluate(r"""(() => {
      const f = window.__uoaQuoteFixture;
      const max = Number(document.querySelector('#dateRangeEndSlider').max);
      f.set('dateRangeStartSlider', max - 2); f.set('dateRangeEndSlider', max);
      f.max = max;
      f.emit = price => window.__dcaTestSocket.emit(price, 'BTC-USD', new Date().toISOString());
      f.expected = {};
      for (const price of [90000, 100000, 110000, 120000]) {
        f.emit(price);
        f.expected[price] = [document.querySelector('#usdBtcBig').textContent,
          document.querySelector('#btcUsdBig').textContent];
      }
      f.emit(90000);
      f.read = () => {
        const surface = [...document.querySelectorAll('.uoa-export-surface')].at(-1);
        return { values: [...surface.querySelectorAll('.big-value')].map(e => e.textContent),
          date: surface.querySelector('.chart-date-edges > span:last-child').textContent };
      };
      f.pngs = [];
      WSBDashboardExport.downloadPng = async (canvas, filename) => {
        const shown = f.read();
        const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
        const decoded = await createImageBitmap(blob);
        f.pngs.push({...shown, width: decoded.width, height: decoded.height, filename});
        decoded.close();
        f.pngData = canvas.toDataURL('image/png');
      };
      const nativeEncode = WSBDashboardExport.encodeVideo;
      WSBDashboardExport.encodeVideo = async options => {
        f.frames = []; f.done = false;
        const render = options.renderFrame;
        const end = options.frames.at(-1);
        let finalStart = 0;
        options.frames.forEach((index, position) => { if (index !== end) finalStart = position + 1; });
        f.finalStart = finalStart;
        const blob = await nativeEncode({...options, renderFrame: async (index, canvas, position) => {
          if (position === finalStart) f.emit(110000);
          await render(index, canvas, position);
          f.frames.push({...f.read(), index, position});
          if (position === 0) f.emit(100000);
          if (position === finalStart) f.emit(120000);
        }});
        if (blob) {
          f.videoData = await new Promise(resolve => {
            const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.readAsDataURL(blob);
          });
          f.videoType = blob.type;
        }
        f.done = true;
        return blob;
      };
      const nativeClick = HTMLAnchorElement.prototype.click;
      HTMLAnchorElement.prototype.click = function() {
        if (!this.href.startsWith('blob:')) nativeClick.call(this);
      };
    })()""")
    expected = cdp.evaluate("window.__uoaQuoteFixture.expected")
    # The corrected cross is ~8.055 billion LBP/BTC at $90k, not 12.86 billion.
    assert "8.05" in expected["90000"][1], expected
    live_date = next_day.strftime('%b %d, %Y')
    for orientation, size in [("landscape", [3840, 2160]), ("portrait", [2160, 3840]), ("square", [2160, 2160])]:
        cdp.evaluate(f"document.querySelector('#downloadOrientationSelect [data-value={orientation}]').click(); document.querySelector('#downloadImageBtn').click()")
        wait_for(lambda: cdp.evaluate("!document.querySelector('#downloadImageBtn').disabled"), timeout=45, description=orientation + " PNG")
        png = cdp.evaluate("window.__uoaQuoteFixture.pngs.at(-1)")
        assert png and [png["width"], png["height"]] == size, png
        assert png["values"] == expected["90000"] and png["date"] == live_date, png
        if os.environ.get("UOA_EXPORT_OUTPUT"):
            output = Path(os.environ["UOA_EXPORT_OUTPUT"])
            output.mkdir(parents=True, exist_ok=True)
            data = cdp.evaluate("window.__uoaQuoteFixture.pngData")
            (output / f"uoa-{orientation}.png").write_bytes(base64.b64decode(data.split(",", 1)[1]))
    cdp.evaluate("document.querySelector('#downloadOrientationSelect [data-value=landscape]').click(); document.querySelector('#dateRangeDownloadBtn').click()")
    wait_for(lambda: cdp.evaluate("window.__uoaQuoteFixture.done"), timeout=100, description="real live UOA video")
    frames = cdp.evaluate("window.__uoaQuoteFixture.frames")
    final_start = cdp.evaluate("window.__uoaQuoteFixture.finalStart")
    assert len(frames) == 123, len(frames)
    assert all(frame["values"] == expected["90000"] and frame["date"] == live_date for frame in frames[:30]), frames[:2]
    assert all(frame["values"] == expected["110000"] and frame["date"] == live_date for frame in frames[final_start:]), frames[-2:]
    assert all(frame["date"] != live_date for frame in frames[30:final_start]), frames[30:final_start]
    assert not cdp.evaluate("window.__uoaQuoteFixture.errors"), cdp.evaluate("window.__uoaQuoteFixture.errors")
    data = cdp.evaluate("window.__uoaQuoteFixture.videoData")
    with tempfile.TemporaryDirectory(prefix="wsb-uoa-video-") as folder:
        output = Path(os.environ.get("UOA_EXPORT_OUTPUT", folder))
        output.mkdir(parents=True, exist_ok=True)
        extension = "mp4" if "mp4" in cdp.evaluate("window.__uoaQuoteFixture.videoType") else "webm"
        video = output / f"uoa-live.{extension}"
        video.write_bytes(base64.b64decode(data.split(",", 1)[1]))
        if shutil.which("ffmpeg"):
            subprocess.run(["ffmpeg", "-v", "error", "-i", str(video), "-f", "null", "-"], check=True)
        else:
            print("SKIP: ffmpeg unavailable; encoded UOA video was not externally decoded")
    wait_for(lambda: cdp.evaluate("!document.querySelector('#dateRangeDownloadBtn').classList.contains('is-exporting')"),
             description="export controls restored")
    # No holds: historical frames remain historical, the final motion frame is live.
    cdp.evaluate("""(() => {
      const f=window.__uoaQuoteFixture; f.done=false;
      const hold=document.querySelector('#downloadEndFrameHoldToggle'); hold.checked=false;
      hold.dispatchEvent(new Event('change', {bubbles:true}));
      document.querySelector('#dateRangeDownloadBtn').click();
    })()""")
    wait_for(lambda: cdp.evaluate("window.__uoaQuoteFixture.done"), timeout=60, description="no-hold live video")
    frames = cdp.evaluate("window.__uoaQuoteFixture.frames")
    assert len(frames) == 3 and frames[-1]["values"] == expected["110000"], frames
    assert frames[0]["date"] != live_date, frames
    wait_for(lambda: cdp.evaluate("!document.querySelector('#dateRangeDownloadBtn').classList.contains('is-exporting')"),
             description="no-hold export controls restored")
    # Explicit historical end: PNG and video must agree and ignore new quotes.
    cdp.evaluate("""(() => {
      const f=window.__uoaQuoteFixture; f.set('dateRangeEndSlider', f.max-1);
      f.historical=[document.querySelector('#usdBtcBig').textContent,document.querySelector('#btcUsdBig').textContent];
      document.querySelector('#downloadImageBtn').click();
    })()""")
    wait_for(lambda: cdp.evaluate("!document.querySelector('#downloadImageBtn').disabled"), timeout=45, description="historical PNG")
    historical = cdp.evaluate("window.__uoaQuoteFixture.historical")
    assert cdp.evaluate("window.__uoaQuoteFixture.pngs.at(-1).values") == historical, (historical, cdp.evaluate("window.__uoaQuoteFixture.pngs.at(-1)"))
    cdp.evaluate("window.__uoaQuoteFixture.done=false; document.querySelector('#dateRangeDownloadBtn').click()")
    wait_for(lambda: cdp.evaluate("window.__uoaQuoteFixture.done"), timeout=60, description="historical video")
    frames = cdp.evaluate("window.__uoaQuoteFixture.frames")
    assert len(frames) == 2 and frames[-1]["values"] == historical, frames
    assert not cdp.evaluate("window.__uoaQuoteFixture.errors"), cdp.evaluate("window.__uoaQuoteFixture.errors")
    wait_for(lambda: cdp.evaluate("!document.querySelector('#dateRangeDownloadBtn').classList.contains('is-exporting')"),
             description="historical export controls restored")
    cdp.evaluate("""(() => {
      const f=window.__uoaQuoteFixture;
      f.set('dateRangeStartSlider', f.max-10); f.set('dateRangeEndSlider', f.max);
      document.querySelector('#dateRangePlayBtn').click();
      document.querySelector('#dateRangePauseBtn').click();
      const [month,day,year]=document.querySelector('#btcUsdEndDateEdge').textContent.split('/');
      f.pausedDate=WSBDashboardExport.formatDailyDate(`20${year}-${month.padStart(2,'0')}-${day.padStart(2,'0')}`);
      f.done=false; document.querySelector('#dateRangeDownloadBtn').click();
    })()""")
    wait_for(lambda: cdp.evaluate("window.__uoaQuoteFixture.done"), timeout=60, description="paused video")
    frames = cdp.evaluate("window.__uoaQuoteFixture.frames")
    assert len(frames) == 1 and frames[0]["date"] == cdp.evaluate("window.__uoaQuoteFixture.pausedDate"), frames
    print("UOA live PNG/video exports passed (opening/final snapshots, historical frames, no holds, all PNG orientations)")


def check_export_visual_consistency(cdp):
    """Compare actual star paths and layout geometry in PNGs and encoded video frames."""
    wait_for(lambda: cdp.evaluate("!document.querySelector('#dateRangeDownloadBtn').classList.contains('is-exporting')"),
             description="prior export cleanup")
    cdp.evaluate(r"""(() => {
      const f=window.__uoaQuoteFixture;
      document.querySelector('#dateRangeStopBtn').click();
      f.set('startDateInput','2023-02-01'); f.set('endDateInput','2023-02-04');
      const traces=new WeakMap(), proto=CanvasRenderingContext2D.prototype;
      for(const method of ['clearRect','beginPath','moveTo','lineTo','closePath','fill']) {
        const native=proto[method];
        proto[method]=function(...args) {
          let trace=traces.get(this.canvas);
          if(!trace) {trace={points:[],stars:[]};traces.set(this.canvas,trace);}
          if(method==='clearRect') trace.stars=[];
          if(method==='beginPath') {trace.points=[];trace.closed=false;}
          if(method==='moveTo'||method==='lineTo') trace.points.push(args);
          if(method==='closePath') trace.closed=true;
          if(method==='fill'&&trace.closed&&trace.points.length===10) {
            const cx=trace.points.reduce((sum,p)=>sum+p[0],0)/10;
            const cy=trace.points.reduce((sum,p)=>sum+p[1],0)/10;
            trace.stars.push({radii:trace.points.map(p=>Math.hypot(p[0]-cx,p[1]-cy)),
              fill:this.fillStyle,scale:this.getTransform().a});
          }
          return native.apply(this,args);
        };
      }
      f.visualRead=() => {
        const surface=[...document.querySelectorAll('.uoa-export-surface')].at(-1);
        return {width:surface.getBoundingClientRect().width,height:surface.getBoundingClientRect().height,
          fonts:[...surface.querySelectorAll('.panel-title,.big-value,.sub-value,.chart-date-edges')]
            .map(node=>getComputedStyle(node).fontSize),
          charts:[...surface.querySelectorAll('canvas')].map(canvas=>({
            width:canvas.getBoundingClientRect().width,pixels:canvas.width,stars:traces.get(canvas)?.stars||[]
          }))};
      };
      const png=WSBDashboardExport.downloadPng;
      WSBDashboardExport.downloadPng=async(...args)=>{f.pngVisual=f.visualRead();return png(...args);};
      const encode=WSBDashboardExport.encodeVideo;
      WSBDashboardExport.encodeVideo=async options=>{
        f.videoVisual=[];
        const render=options.renderFrame;
        return encode({...options,renderFrame:async(...args)=>{
          await render(...args);f.videoVisual.push(f.visualRead());
        }});
      };
    })()""")
    for orientation in ("landscape", "portrait", "square"):
        # Exercise both themes and make mobile/DPR changes between PNG and video.
        theme = "light" if orientation == "portrait" else "dark"
        cdp.evaluate(f"document.querySelector('#downloadOrientationSelect [data-value={orientation}]').click(); document.querySelector('#downloadThemeSelect [data-value={theme}]').click(); document.querySelector('#downloadImageBtn').click()")
        wait_for(lambda: cdp.evaluate("!document.querySelector('#downloadImageBtn').disabled"), timeout=45, description=orientation+" star PNG")
        png = cdp.evaluate("window.__uoaQuoteFixture.pngVisual")
        assert len(png["charts"]) == 2 and all(len(c["stars"]) == 1 for c in png["charts"]), png
        for chart in png["charts"]:
            assert abs(chart["pixels"] / chart["width"] - 1.5) < 0.01, chart
            star = chart["stars"][0]
            assert all(abs(radius - (14 if i % 2 == 0 else 6.4)) < 0.01 for i, radius in enumerate(star["radii"])), star
        if os.environ.get("UOA_EXPORT_OUTPUT"):
            output=Path(os.environ["UOA_EXPORT_OUTPUT"])
            (output/f"uoa-stars-{orientation}.png").write_bytes(base64.b64decode(cdp.evaluate("window.__uoaQuoteFixture.pngData").split(",",1)[1]))
        cdp.command('Emulation.setDeviceMetricsOverride', {'width':390,'height':844,'deviceScaleFactor':2,'mobile':False})
        cdp.evaluate("window.__uoaQuoteFixture.done=false; document.querySelector('#dateRangeDownloadBtn').click()")
        wait_for(lambda: cdp.evaluate("window.__uoaQuoteFixture.done"), timeout=90, description=orientation+" star video")
        frames=cdp.evaluate("window.__uoaQuoteFixture.videoVisual")
        assert len(frames)==4, len(frames)
        assert all(not chart['stars'] for frame in frames[:2] for chart in frame['charts']), frames[:2]
        assert all(len(chart['stars'])==1 for frame in frames[2:] for chart in frame['charts']), frames[2:]
        final=frames[-1]
        assert final['fonts']==png['fonts'] and final['width']==png['width'] and final['height']==png['height'], (png,final)
        for photo,video in zip(png['charts'], final['charts']):
            assert photo['width']==video['width'], (photo,video)
            for a,b in zip(photo['stars'][0]['radii'],video['stars'][0]['radii']):
                assert abs(a-b)<0.001, (photo,video)
        wait_for(lambda: cdp.evaluate("!document.querySelector('#dateRangeDownloadBtn').classList.contains('is-exporting')"), description="star video cleanup")
        cdp.command('Emulation.setDeviceMetricsOverride', {'width':1440,'height':1000,'deviceScaleFactor':1,'mobile':False})
    assert not cdp.evaluate("window.__uoaQuoteFixture.errors"), cdp.evaluate("window.__uoaQuoteFixture.errors")
    print("UOA export stars and PNG/video proportions passed in all orientations, including mobile/DPR changes")


def main():
    if not Path(CHROME).is_file():
        raise SystemExit(f"Chrome not found at {CHROME}; set CHROME_BIN")
    FrozenHandler.snapshot = {"/" + name: (ROOT / name).read_bytes() for name in DATA}
    fx_key = "/webapps/uoa/webapp_data/daily_fx_rates.csv"
    fx_lines = FrozenHandler.snapshot[fx_key].decode().splitlines()
    cup_index = fx_lines[0].split(",").index("cupusd")
    last_fx_row = fx_lines[-1].split(",")
    last_fx_row[cup_index] = "0.04167"  # Simulate a newly appended official-rate endpoint.
    fx_lines[-1] = ",".join(last_fx_row)
    FrozenHandler.snapshot[fx_key] = ("\n".join(fx_lines) + "\n").encode()
    fx_last = last_fx_row[0]
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
                  && window.__dcaTestSocket?.url === 'wss://2140data.io/'
                """), timeout=35, description="Unit of Account dashboard load")
            except TimeoutError:
                diagnostic = cdp.evaluate("""({
                  canvas: document.querySelector('#usdBtcChart')?.width,
                  options: document.querySelector('#primaryUoaSelect')?.options.length,
                  end: document.querySelector('#btcUsdEndDateEdge')?.textContent,
                  socket: window.__dcaTestSocket?.url,
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
            wait_for(lambda: cdp.evaluate("document.querySelector('#pairKpiChip')?.title.includes('BTC: 2140data.io live')"),
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
            assert_browser(cdp, r"""(() => {
              const title = document.querySelector('#pairKpiChip').title;
              if (!title.includes('published snapshot: CUP'))
                return 'CUP lost its published informal-market rate';
              if (!document.querySelector('#btcUsdBig').textContent.trim())
                return 'published CUP rate blanked the comparison';
              const cupValue = document.querySelector('#btcUsdBig').textContent.trim();
              const match = cupValue.match(/([\d,.]+)\s*([kMBT]?)\s*CUP/);
              const magnitude = match ? Number(match[1].replace(/,/g, ''))
                * ({ k: 1e3, M: 1e6, B: 1e9, T: 1e12 }[match[2]] || 1) : 0;
              if (magnitude < 1)
                return `official CUP endpoint leaked into the chart: ${cupValue}`;
              if (document.querySelector('.pair-secondary .pair-status')?.dataset.kind !== 'published')
                return 'CUP should keep a gray snapshot dot';
              if (!document.querySelector('.pair-secondary .pair-status')?.title.includes('informal-market'))
                return 'CUP status did not explain its source';
              if (window.__uoaQuoteFixture.calls.flat().some((ticker) => ticker === 'FX_IDC:CUPUSD'
                  || ticker === 'FX_IDC:USDCUP'))
                return 'the incompatible indicative CUP quote was requested';
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
            check_live_exports(cdp, next_day)
            check_export_visual_consistency(cdp)
        finally:
            chrome.terminate()
            try:
                chrome.wait(timeout=5)
            except subprocess.TimeoutExpired:
                chrome.kill()
            server.shutdown()


if __name__ == "__main__":
    main()
