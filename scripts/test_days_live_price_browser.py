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


def check_live_exports(cdp):
    """Check real PNG/video snapshots while accepted quotes change during export."""
    cdp.evaluate(r"""(() => {
      const f=window.__daysExportFixture={errors:[],pngs:[],frames:[]};
      f.unit=Math.max(1000000,Math.ceil(Number(document.querySelector('#athKpi').textContent.replace(/[^0-9.]/g,''))*2));
      f.base=f.unit*2;
      window.alert=message=>f.errors.push(message);
      const now=Date.now;Date.now=()=>now()+10000;
      f.emit=price=>window.__dcaTestSocket.emit(price,'BTC-USD',new Date(Date.now()).toISOString());
      f.set=(id,value)=>{const input=document.getElementById(id);input.value=value;input.dispatchEvent(new Event('change',{bubbles:true}));};
      f.end=document.querySelector('#endDateInput').max;
      f.set('startDateInput',f.end);f.set('endDateInput',f.end);
      document.querySelector('#downloadQualitySelect [data-value="720"]').click();
      const text=CanvasRenderingContext2D.prototype.fillText;
      CanvasRenderingContext2D.prototype.fillText=function(value,...args){
        if(!this.canvas.id&&f.text)f.text.push(String(value));
        return text.call(this,value,...args);
      };
      f.originalText=text;
      WSBDashboardExport.downloadPng=async(canvas,filename)=>{
        const image=await createImageBitmap(await new Promise(resolve=>canvas.toBlob(resolve)));
        f.pngs.push({width:image.width,height:image.height,text:f.text.slice(),filename});image.close();
      };
      const ready=WSBDashboardExportBranding.ready;f.ready=ready;
      WSBDashboardExportBranding.ready=async()=>{await ready();await new Promise(resolve=>{f.release=resolve;});};
      const encode=WSBDashboardExport.encodeVideo;
      WSBDashboardExport.encodeVideo=async options=>{
        f.done=false;f.frames=[];f.finalPrice=f.base;f.base+=2*f.unit;
        let finalStart=options.settings.endFrameHold?30:0;
        options.frames.forEach((index,position)=>{if(index!==options.frames.at(-1))finalStart=position+1;});
        f.finalStart=finalStart;
        const blob=await encode({...options,renderFrame:async(index,canvas,position)=>{
          if(position===finalStart)f.emit(f.finalPrice);
          f.text=[];await options.renderFrame(index,canvas,position);
          f.frames.push({index,text:f.text.slice()});
          if(position===finalStart)f.emit(f.finalPrice+f.unit);
        }});
        f.bytes=blob?.size||0;f.done=true;return blob;
      };
      const click=HTMLAnchorElement.prototype.click;
      HTMLAnchorElement.prototype.click=function(){if(!this.href.startsWith('blob:'))click.call(this);};
      f.emit(f.unit/2);f.text=[];document.querySelector('#downloadImageBtn').click();
    })()""")
    wait_for(lambda: cdp.evaluate("!!window.__daysExportFixture.release"), description="Days PNG asset readiness gate")
    cdp.evaluate("window.__daysExportFixture.emit(window.__daysExportFixture.unit);window.__daysExportFixture.release();WSBDashboardExportBranding.ready=window.__daysExportFixture.ready")
    wait_for(lambda: cdp.evaluate("!document.querySelector('#downloadImageBtn').disabled"), timeout=45, description="Days live PNG")
    png=cdp.evaluate("window.__daysExportFixture.pngs.at(-1)")
    unit=cdp.evaluate("__daysExportFixture.unit")
    price=lambda multiple: f"${unit*multiple:,.2f}"
    assert [png["width"],png["height"]]==[3840,2160] and price(1) in png["text"], png

    def video():
        cdp.evaluate("window.__daysExportFixture.done=false;document.querySelector('#dateRangeDownloadBtn').click()")
        wait_for(lambda: cdp.evaluate("window.__daysExportFixture.done&&!document.querySelector('#dateRangeDownloadBtn').classList.contains('is-exporting')"), timeout=60, description="Days encoded video")
        result=cdp.evaluate("({frames:__daysExportFixture.frames,final:__daysExportFixture.finalPrice,bytes:__daysExportFixture.bytes,errors:__daysExportFixture.errors})")
        assert result["bytes"]>0 and not result["errors"], result
        return result

    single=video()
    assert len(single["frames"])==121, len(single["frames"])
    assert all(price(2) not in frame["text"] for frame in single["frames"][:30]), single["frames"][0]
    assert all(price(2) in frame["text"] and price(3) not in frame["text"] for frame in single["frames"][30:]), single["frames"][-1]
    cdp.evaluate("__daysExportFixture.set('startDateInput',new Date(Date.parse(__daysExportFixture.end+'T00:00:00Z')-2*86400000).toISOString().slice(0,10));document.querySelector('#downloadEndFrameHoldToggle').click()")
    motion=video()
    assert len(motion["frames"])==3 and price(4) in motion["frames"][-1]["text"], motion
    assert all(price(4) not in frame["text"] for frame in motion["frames"][:-1]), motion
    cdp.evaluate("document.querySelector('#playBtn').click();document.querySelector('#pauseBtn').click();__daysExportFixture.text=[];document.querySelector('#downloadImageBtn').click()")
    wait_for(lambda: cdp.evaluate("!document.querySelector('#downloadImageBtn').disabled"), timeout=45, description="Days paused historical PNG")
    paused_png=cdp.evaluate("__daysExportFixture.pngs.at(-1)")
    assert price(5) not in paused_png["text"], paused_png
    assert cdp.evaluate("document.querySelector('#endDateInput').value") in paused_png["filename"], paused_png
    paused=video()
    assert len(paused["frames"])==1 and price(6) not in paused["frames"][0]["text"], paused
    cdp.evaluate("document.querySelector('#stopBtn').click();CanvasRenderingContext2D.prototype.fillText=__daysExportFixture.originalText")
    print("Days live exports passed: asset-ready 4K PNG, separate single-day final capture/frozen hold, no-hold latest video, paused historical PNG/video")


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
              && window.__dcaTestSocket?.url === 'wss://2140data.io/'
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
                // Exercise the full dashboard and exports across missing days.
                const fixtureNow = Date.parse(publishedDay+'T12:00:00Z') + 3*86400000;
                Date.now = () => fixtureNow;
                const utcDay = new Date(Date.now()).toISOString().slice(0, 10);
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
            check_live_exports(cdp)
            cdp.command("Page.navigate", {"url": f"http://127.0.0.1:{server_port}/webapps/days_since_ath/preview.html"})
            wait_for(lambda: cdp.evaluate("""
              document.querySelector('#daysSinceAthPreview')?.dataset.priceSource === 'published'
              && window.__dcaTestSocket?.url === 'wss://2140data.io/'
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
                if (canvas.dataset.priceSource !== 'retained') return 'stale quote was not retained';
                if (canvas.toDataURL() === published) return 'card reverted to published price after feed loss';
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
