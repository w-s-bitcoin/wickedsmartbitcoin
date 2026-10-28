#!/usr/bin/env python3
"""Browser regression for price distribution/price rendering and exports.

Serves the checkout read-only. The dashboard verifies the published daily-price
marker and CSV; no producer, live market endpoint, or dataset mutation runs.
"""

from __future__ import annotations

import argparse
import base64
import json
from pathlib import Path
import subprocess
import threading
import urllib.request
from http.server import ThreadingHTTPServer

from daily_history_tooltip_checks import check_tooltips
from browser_cdp import CdpSocket, QuietHandler, free_port, wait_for
from capture_card_fallbacks import capture_workspace, close_browser, find_chrome

ROOT = Path(__file__).resolve().parents[1]


class Handler(QuietHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)


def check(cdp: CdpSocket, origin: str, artifact_dir: Path | None = None) -> None:
    # Replace the shared feed at its script boundary; no live endpoints are used.
    cdp.command("Page.addScriptToEvaluateOnNewDocument", {"source": """
      Object.defineProperty(window, 'WSBBitcoinSpotPrice', { configurable: true,
        set(api) {
          let quote = null, live = false, callback;
          const feed = { start() {}, stop() {}, refresh: async () => quote,
            current: () => live ? quote : null, last: () => quote, isLive: () => live,
            newerThan: (at) => quote && quote.at > Date.parse(at || 0) ? quote : null };
          api.create = ({ onQuote }) => { callback = onQuote; return feed; };
          window.__spotEmit = (price, isLive = true) => {
            if (price) quote = { price, source: 'test feed', at: Date.now() + 86400000, receivedAt: Date.now() };
            live = isLive; callback?.(live ? quote : null);
          };
          Object.defineProperty(window, 'WSBBitcoinSpotPrice', { value: api, configurable: true });
        }
      });
    """})
    cdp.command("Emulation.setDeviceMetricsOverride", {
        "width": 1440, "height": 900, "deviceScaleFactor": 1, "mobile": False,
    })
    cdp.command("Page.navigate", {"url": origin + "/webapps/price_distribution/preview.html"})
    preview = wait_for(lambda: (state if (state := cdp.evaluate("""({
      ready: document.documentElement.dataset.previewReady,
      available: document.documentElement.dataset.previewAvailable,
      date: document.getElementById('previewCanvas')?.dataset.endDate,
    })""")).get("ready") == "1" else None), description="price distribution preview")
    assert preview["available"] == "1" and preview["date"], preview
    for theme in ("dark", "light"):
        cdp.evaluate(f'window.postMessage({{type:"quantum-dashboard-theme",theme:{json.dumps(theme)}}},"*")')
        cdp.evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))')
        bounds = cdp.evaluate('''(() => {
          const canvas=document.getElementById('previewCanvas'), w=canvas.width, h=canvas.height;
          const data=canvas.getContext('2d').getImageData(0,0,w,h).data;
          let left=w,right=0,top=h,bottom=0;
          for(let y=0;y<h;y++)for(let x=0;x<w;x++){
            const i=(y*w+x)*4;
            if(data[i]>data[i+2]+40 && data[i]>data[i+1]+20){
              left=Math.min(left,x);right=Math.max(right,x);top=Math.min(top,y);bottom=Math.max(bottom,y);
            }
          }
          return {left,right,top,bottom,w,h};
        })()''')
        assert abs(bounds['left'] - bounds['w'] / 40) <= 3, bounds
        assert abs(bounds['w'] - bounds['right'] - bounds['w'] / 40) <= 3, bounds
        assert abs(bounds['top'] - bounds['h'] / 30) <= 2, 'Preview must crop empty upper price bands'
        if artifact_dir:
            shot = cdp.command('Page.captureScreenshot', {'format':'png'})
            (artifact_dir / f'preview-{theme}.png').write_bytes(base64.b64decode(shot['data']))

    cdp.command("Page.navigate", {"url": origin + "/webapps/price_distribution/dashboard.html"})
    initial = wait_for(lambda: (state if (state := cdp.evaluate("""({
      model: window.WSBPriceDistributionDashboard?.getState(),
      error: document.getElementById('dashboardStatus')?.textContent,
      size: [document.getElementById('dashboardCanvas')?.width, document.getElementById('dashboardCanvas')?.height],
    })""")).get("model", {}).get("rows", 0) > 100 else None), description="price distribution dashboard")
    assert not initial["error"] and initial["size"][0] > 500 and initial["size"][1] > 300, initial
    assert initial["model"]["startIndex"] == 0, "Full range must include Not Valued history"
    assert cdp.evaluate("document.getElementById('startDateBtn').disabled && !document.getElementById('dateRangeStartSlider') && document.getElementById('rangeDaysInput').readOnly"), "Start must stay locked with only one handle"
    assert cdp.evaluate("!document.getElementById('kpiHeight')"), "Block chip duplicates Updated"
    check_tooltips(cdp, "WSBPriceDistributionChart", artifact_dir)
    linked = cdp.evaluate("""(() => {
      const G = WSBPriceDistributionChart, rows = [0,0,.2,.2,2,2,.2,.2].map((price,i) => ({
        price, height:i, time:Date.UTC(2009,0,3+i), iso:`2009-01-${String(3+i).padStart(2,'0')}`,
      }));
      const canvas = document.createElement('canvas'); canvas.width=1000; canvas.height=600;
      const ctx=canvas.getContext('2d'), results=[];
      for (const theme of ['dark','light']) {
        const render = hover => G.render(ctx,1000,600,rows,7,{theme,hover});
        const history=render({x:100,y:200}).plot, histogram=render({x:650,y:200}).plot;
        const model=G.distribution(rows,7), rowHeight=histogram.height/model.bins.length;
        const bin=4, binY=histogram.y+histogram.height-(bin+.5)*rowHeight;
        const px=i=>history.x+i/7*history.width;
        const py=price=>history.y+history.height-(Math.log10(price)-model.min+1)/model.bins.length*history.height;
        const background=theme==='dark'?0:255;
        const strength=(x,y)=>{
          const data=ctx.getImageData(Math.floor(x)-2,Math.floor(y)-2,5,5).data;let best=0;
          for(let i=0;i<data.length;i+=4) best=Math.max(best,Math.abs(data[i]-background)+Math.abs(data[i+1]-background)+Math.abs(data[i+2]-background));
          return best;
        };
        render(null);
        const matching=strength(px(2.5),py(.2)), other=strength(px(4.5),py(2));
        const binInfo=render({x:histogram.x+8,y:binY});
        const highlighted=strength(px(2.5),py(.2)), dimmed=strength(px(4.5),py(2));
        const columns=[];
        render(null);
        // Recover the actual bar extent from its orange pixels, independently of marker math.
        const stripe=ctx.getImageData(Math.ceil(histogram.x)+2,Math.floor(binY),Math.floor(histogram.width)-4,1).data;
        for(let i=0;i<stripe.length;i+=4) if(stripe[i]>180 && stripe[i+1]>80 && stripe[i+1]<180 && stripe[i+2]<20) columns.push(i/4+Math.ceil(histogram.x)+2);
        const end=Math.max(...columns)+1;
        const markers=[];
        for(const [index,ordinal] of [[2,1],[6,3],[7,4]]) {
          const tip=render({x:px(index),y:history.y+20});
          const pixels=ctx.getImageData(Math.ceil(histogram.x)+2,Math.floor(binY),Math.floor(histogram.width)-4,1).data, whites=[];
          for(let i=0;i<pixels.length;i+=4) if(pixels[i]>240 && pixels[i+1]>240 && pixels[i+2]>240) {
            const x=i/4+Math.ceil(histogram.x)+2; if(x<end-1) whites.push(x);
          }
          const expected=histogram.x+(ordinal-.5)/4*(end-histogram.x);
          markers.push({expected,found:whites.some(x=>Math.abs(x-expected)<2),entries:tip.entries.map(e=>e.label)});
        }
        results.push({theme,matching,highlighted,other,dimmed,markers,barEntries:binInfo.entries.map(e=>e.label)});
      }
      return results;
    })()""")
    for result in linked:
        assert result["highlighted"] >= result["matching"] * .95, result
        assert result["dimmed"] <= result["other"] * .3, result
        assert result["barEntries"] == ["Days", "Share"], result
        assert all(m["found"] and m["entries"] == ["Block", "Price"] for m in result["markers"]), result

    if artifact_dir:
        points = cdp.evaluate("""(async () => {
          const rows=WSBPriceDistributionChart.parse(await (await fetch('../../assets/daily_price.csv')).text());
          const r=document.getElementById('dashboardCanvas').getBoundingClientRect(), out=document.createElement('canvas');out.width=r.width;out.height=r.height;
          const render=hover=>WSBPriceDistributionChart.render(out.getContext('2d'),out.width,out.height,rows,rows.length-1,{theme:'dark',hover});
          const hp=render({x:100,y:200}).plot, bp=render({x:r.width*.7,y:r.height*.5}).plot;
          return {history:{x:r.left+hp.x+hp.width*.78,y:r.top+hp.y+hp.height*.35},range:{x:r.left+bp.x+24,y:r.top+bp.y+bp.height*(3.5/13)}};
        })()""")
        for kind, point in points.items():
            cdp.command('Input.dispatchMouseEvent', {'type':'mouseMoved', **point})
            wait_for(lambda: cdp.evaluate("!document.getElementById('chartTooltip').hidden"), description='linked hover screenshot')
            shot=cdp.command('Page.captureScreenshot', {'format':'png'})
            (artifact_dir / f'linked-{kind}.png').write_bytes(base64.b64decode(shot['data']))
        cdp.evaluate("document.getElementById('dashboardCanvas').dispatchEvent(new PointerEvent('pointerleave'))")
    cdp.evaluate("window.__spotEmit(123456.78)")
    wait_for(lambda: cdp.evaluate("document.getElementById('kpiPrice').textContent === '$123,456.78'"), description="live price KPI")
    assert cdp.evaluate("document.getElementById('priceLiveStatus').dataset.kind === 'live'")
    cdp.evaluate("window.__spotEmit(null, false)")
    wait_for(lambda: cdp.evaluate("document.getElementById('priceLiveStatus').dataset.kind === 'retained'"), description="retained price status")
    assert cdp.evaluate("document.getElementById('kpiPrice').textContent === '$123,456.78'")
    expanded = cdp.evaluate("""(() => {
      document.getElementById('expandDashboard').click();
      return { active: document.body.classList.contains('price-distribution-dashboard-expanded'),
        pressed: document.getElementById('expandDashboard').getAttribute('aria-pressed') };
    })()""")
    assert expanded == {"active": True, "pressed": "true"}, expanded
    cdp.evaluate("document.getElementById('expandDashboard').click()")
    assert cdp.evaluate("!document.body.classList.contains('price-distribution-dashboard-expanded')")

    scrubbed = cdp.evaluate("""(() => {
      const slider = document.getElementById('dateRangeEndSlider');
      slider.value = String(Math.floor(window.WSBPriceDistributionDashboard.getState().rows / 2));
      slider.dispatchEvent(new Event('input', { bubbles: true }));
      return window.WSBPriceDistributionDashboard.getState();
    })()""")
    assert scrubbed["startIndex"] < scrubbed["index"] < initial["model"]["index"], scrubbed
    cdp.evaluate("window.__spotEmit(234567.89)")
    assert cdp.evaluate("document.getElementById('priceLiveStatus').dataset.kind === 'published' && document.getElementById('kpiPrice').textContent !== '$234,567.89'"), "Live ticks changed history"
    assert cdp.evaluate("!document.getElementById('latestBtn').classList.contains('is-active') && document.getElementById('latestBtn').getAttribute('aria-pressed') === 'false'"), "Historical dates must clear Latest"
    cdp.evaluate("(() => { const end = document.getElementById('dateRangeEndSlider'); end.value = end.max; end.dispatchEvent(new Event('input', {bubbles:true})); })()")
    assert cdp.evaluate("document.getElementById('latestBtn').classList.contains('is-active') && document.getElementById('latestBtn').getAttribute('aria-pressed') === 'true'"), "Returning the end slider to latest must restore its highlight"

    wait_for(lambda: cdp.evaluate("document.getElementById('kpiPrice').textContent === '$234,567.89'"), description="latest resumes live feed")
    shared = cdp.evaluate("""(() => {
      document.getElementById('dateRangeSettingsBtn').click();
      const group = document.getElementById('exportOrientation');
      group.querySelector('[data-value="square"]').click();
      const result = { menu: document.getElementById('dateRangeSettingsMenu').classList.contains('open'),
        orientation: WSBDashboardComponents.getButtonGroupValue(group),
        toolbar: !!document.querySelector('.date-range-playback-button-group #downloadImage'),
        range: !!document.querySelector('.date-range-slider-wrap .date-range-slider'),
        buttonHeight: getComputedStyle(document.getElementById('playPause')).height };
      document.getElementById('dateRangeSettingsBtn').click();
      return result;
    })()""")
    assert shared["menu"] and shared["orientation"] == "square" and shared["toolbar"] and shared["range"], shared
    # Playback keeps the selected end, Pause retains its frame, Stop restores it.
    cdp.evaluate("document.getElementById('playPause').click(); document.getElementById('pausePlayback').click()")
    assert cdp.evaluate("document.getElementById('priceLiveStatus').dataset.kind === 'published'")
    cdp.evaluate("document.getElementById('stopPlayback').click()")
    assert cdp.evaluate("WSBPriceDistributionDashboard.getState().index === WSBPriceDistributionDashboard.getState().rows - 1")
    export = cdp.evaluate("""(async () => {
      await WSBDashboardExportBranding.ready();
      const text = await (await fetch('../../assets/daily_price.csv')).text();
      const rows = WSBPriceDistributionChart.parse(text), results = {};
      const firstPriced = rows.findIndex(r => r.price > 0);
      const zero = WSBPriceDistributionChart.distribution(rows, firstPriced - 1);
      const all = WSBPriceDistributionChart.distribution(rows, rows.length - 1);
      const short = WSBPriceDistributionChart.distribution(rows, firstPriced, firstPriced);
      const prices = [0, .0001, .00099999, .001, .009999, .01, .1, 1, 10, 100, 1000, 10000, 100000, 1000000];
      const edges = WSBPriceDistributionChart.distribution(prices.map(price => ({price})), prices.length - 1);
      results.calculations = { zero: zero.bins[0].count, firstPriced, total: all.total,
        sum: all.bins.reduce((sum,b) => sum + b.count, 0), rows: rows.length,
        short: short.bins.reduce((sum,b) => sum + b.count, 0), labels: all.bins.length,
        edgeCounts: edges.bins.map(b => b.count), genesisAge: WSBPriceDistributionChart.summary(rows[0]).days,
        tinyPrice: WSBPriceDistributionChart.priceLabel(.000764) };
      for (const orientation of ['landscape', 'portrait', 'square']) {
        const { width, height } = WSBDashboardExport.getDimensions({ quality: '2160', orientation });
        const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
        const ctx = canvas.getContext('2d');
        WSBPriceDistributionChart.render(ctx, width, height, rows, rows.length - 1,
          { theme: 'dark', export: true, branded: true });
        const pixels = ctx.getImageData(0, 0, width, height).data;
        let orange = 0; for (let i = 0; i < pixels.length; i += 4) if (pixels[i] > 180 && pixels[i+1] > 80 && pixels[i+1] < 200 && pixels[i+2] < 50) orange++;
        const plot = [orange, 0, 0, 255];
        const pngBlob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
        const png = await createImageBitmap(pngBlob);
        results[orientation] = { width, height, plot: [...plot], pngSize: [png.width, png.height] };
        png.close();
        if (__SAVE_ARTIFACTS__) results[orientation].data = canvas.toDataURL('image/png');
        WSBPriceDistributionChart.render(ctx, width, height, rows, rows.length - 1,
          { theme: 'light', export: true, branded: true });
        const lightBlob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
        const lightImage = await createImageBitmap(lightBlob);
        results[orientation].lightSize = [lightImage.width, lightImage.height]; lightImage.close();
        if (__SAVE_ARTIFACTS__) results[orientation].light = canvas.toDataURL('image/png');

      }
      return results;
    })()""".replace("__SAVE_ARTIFACTS__", "true" if artifact_dir else "false"))
    for orientation in ("landscape", "portrait", "square"):
        result = export[orientation]
        if artifact_dir:
            (artifact_dir / f"{orientation}.png").write_bytes(base64.b64decode(result.pop("data").split(",", 1)[1]))
            (artifact_dir / f"{orientation}-light.png").write_bytes(base64.b64decode(result.pop("light").split(",", 1)[1]))
        assert result["pngSize"] == result["lightSize"] == [result["width"], result["height"]], result
    assert [(export[key]["width"], export[key]["height"]) for key in ("landscape", "portrait", "square")] == [
        (3840, 2160), (2160, 3840), (2160, 2160)], export
    calc = export["calculations"]
    assert calc["zero"] == calc["firstPriced"] and calc["sum"] == calc["rows"] == calc["total"], calc
    assert calc["short"] == 1 and calc["labels"] == 13 and calc["genesisAge"] == 1, calc
    assert calc["edgeCounts"] == [1, 2, 2, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0], calc
    assert calc["tinyPrice"] == "0.0764¢", calc
    assert all(export[key]["plot"][3] == 255 and max(export[key]["plot"][:3]) > 20
               for key in ("landscape", "portrait", "square")), export

    # Capture the actual canvas path: the opening line must grow on a fixed
    # timeline, including shortened exports and nonstandard unpriced histories.
    opening = cdp.evaluate("""(async () => {
      const G=WSBPriceDistributionChart;
      const published=G.parse(await (await fetch('../../assets/daily_price.csv')).text());
      const synthetic=[0,0,0,0,.001,.002].map((price,i)=>({price,height:i,time:Date.UTC(2009,0,3+i),iso:'2009-01-'+String(3+i).padStart(2,'0')}));
      const NativePath=window.Path2D,results=[];
      try {
        for(const rows of [published,synthetic,synthetic.slice(0,4)]) {
          const lastZero=G.exportMilestones(rows)[0];
          for(const orientation of ['landscape','portrait','square']) {
            const {width,height}=WSBDashboardExport.getDimensions({quality:'720',orientation});
            const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;
            for(const index of [...new Set([0,1,Math.floor(lastZero/2),lastZero-1,lastZero,Math.min(lastZero+1,rows.length-1)])]) {
              let points=[];
              window.Path2D=class extends NativePath {
                moveTo(x,y){points.push({move:true,x,y});super.moveTo(x,y);}
                lineTo(x,y){points.push({move:false,x,y});super.lineTo(x,y);}
              };
              G.render(canvas.getContext('2d'),width,height,rows,index,{theme:'dark',export:true,branded:true});
              const left=24*width/(orientation==='landscape'?1920:1080);
              const right=orientation==='landscape'?width*.604:width-left;
              results.push({orientation,index,lastZero,left,right,points});
            }
          }
        }
      } finally { window.Path2D=NativePath; }
      return results;
    })()""")
    for result in opening:
        points, index, last = result['points'], result['index'], result['lastZero']
        assert len(points) == index + 1, result
        last_unpriced = points[min(index, last)]
        expected = result['left'] + min(index, last) / max(index, last) * (result['right'] - result['left'])
        assert abs(last_unpriced['x'] - expected) < .001, result
        assert all(abs(point['y'] - points[0]['y']) < .001 for point in points[:last+1]), result
        if index < last:
            assert last_unpriced['x'] < result['right'], result
        if index > last:
            assert points[-1]['move'] and points[-1]['y'] < last_unpriced['y'], result

    frozen = cdp.evaluate("""(async () => {
      const originalEncode = WSBDashboardExport.encodeVideo;
      const originalRender = WSBPriceDistributionChart.render;
      const observed = [];
      const publishedPrice = WSBPriceDistributionChart.parse(await (await fetch('../../assets/daily_price.csv')).text()).at(-1).price;
      let milestonesPreserved = false;
      WSBPriceDistributionChart.render = (ctx, width, height, rows, index, options) => {
        if (options.export) observed.push({index, price: rows[index].price});
        return originalRender(ctx, width, height, rows, index, options);
      };
      WSBDashboardExport.encodeVideo = async (config) => {
        const rows=WSBPriceDistributionChart.parse(await (await fetch('../../assets/daily_price.csv')).text());
        milestonesPreserved=WSBPriceDistributionChart.exportMilestones(rows).every(index=>config.frames.includes(index));
        await config.renderFrame(config.frames[0], config.canvas, 0);
        window.__spotEmit(345678.90);
        await config.renderFrame(config.frames.at(-1), config.canvas, config.frames.length - 1);
        window.__spotEmit(456789.01);
        await config.renderFrame(config.frames.at(-1), config.canvas, config.frames.length - 1);
        // Exercise control recovery on an encoder failure as well.
        return null;
      };
      try {
        document.getElementById('downloadVideo').click();
        for (let i = 0; i < 100 && WSBPriceDistributionDashboard.getState().exporting; i++)
          await new Promise(resolve => setTimeout(resolve, 20));
        return {observed, publishedPrice, milestonesPreserved, recovered: !WSBPriceDistributionDashboard.getState().exporting && !document.getElementById('downloadImage').disabled};
      } finally {
        WSBDashboardExport.encodeVideo = originalEncode;
        WSBPriceDistributionChart.render = originalRender;
      }
    })()""")
    assert frozen["recovered"] and frozen["milestonesPreserved"] and len(frozen["observed"]) == 3, frozen
    assert cdp.evaluate("document.getElementById('startDateBtn').disabled && !document.getElementById('dateRangeStartSlider')"), "Export recovery unlocked Start"
    assert frozen["observed"][0]["index"] == frozen["observed"][-1]["index"], frozen
    assert frozen["observed"][0]["price"] == frozen["publishedPrice"], frozen
    assert [row["price"] for row in frozen["observed"][1:]] == [345678.90, 345678.90], frozen

    videos = cdp.evaluate("""(async () => {
      const rows = WSBPriceDistributionChart.parse(await (await fetch('../../assets/daily_price.csv')).text());
      const firstPriced = rows.findIndex(row => row.price > 0), results = {};
      const frames = [0, 1, Math.floor((firstPriced-1)/2), firstPriced-2, firstPriced-1, firstPriced, rows.length-1];
      for (const orientation of ['landscape', 'portrait', 'square']) {
        const settings = { quality: '720', orientation, theme: 'dark' };
        const { width, height } = WSBDashboardExport.getDimensions(settings);
        const canvas = document.createElement('canvas');
        const blob = await WSBDashboardExport.encodeVideo({
          canvas, width, height, fps: WSBDashboardExport.VIDEO_FPS, settings, frames,
          renderFrame: async (i, target) => WSBPriceDistributionChart.render(
            target.getContext('2d'), width, height, rows, i, { theme: 'dark', export: true, branded: true }),
        });
        if (!blob) throw new Error('No encoded video for ' + orientation);
        const player = document.createElement('video'), url = URL.createObjectURL(blob);
        player.muted = true; player.preload = 'auto';
        try {
          await new Promise((resolve, reject) => { player.onloadedmetadata = resolve; player.onerror = reject; player.src = url; });
          await new Promise((resolve, reject) => { player.onseeked = resolve; player.onerror = reject; player.currentTime = Math.max(0, player.duration - .5/WSBDashboardExport.VIDEO_FPS); });
          const decoded = document.createElement('canvas'); decoded.width = width; decoded.height = height;
          const ctx = decoded.getContext('2d'); ctx.drawImage(player, 0, 0);
          const pixels = ctx.getImageData(0, 0, width, height).data;
          let orange = 0; for (let i = 0; i < pixels.length; i += 4) if (pixels[i] > 180 && pixels[i+1] > 80 && pixels[i+1] < 200 && pixels[i+2] < 70) orange++;
          const pixel = [orange, 0, 0, 255];
          results[orientation] = { size: blob.size, extension: WSBDashboardExport.videoExtension(blob),
            width: player.videoWidth, height: player.videoHeight, duration: player.duration, pixel: [...pixel] };
          const finalImage=decoded.toDataURL('image/png');
          await new Promise((resolve,reject)=>{player.onseeked=resolve;player.onerror=reject;player.currentTime=2.5/WSBDashboardExport.VIDEO_FPS;});
          ctx.drawImage(player,0,0);
          if(orientation==='landscape') {
            const u=width/1920,left=24*u,seam=width*.604,top=115*u,bottom=height-134*u;
            const y=bottom-(bottom-top)*.5/13, xs=[];
            const stripe=ctx.getImageData(Math.ceil(left),Math.floor(y)-3,Math.floor(seam-left)-3,7);
            for(let j=0;j<stripe.data.length;j+=4) {
              const [r,g,b]=stripe.data.slice(j,j+3);
              if(r>150&&g>65&&g<200&&b<80)xs.push(Math.ceil(left)+(j/4)%stripe.width);
            }
            results[orientation].openingEnd=Math.max(...xs);
            results[orientation].expectedOpeningEnd=left+frames[2]/(firstPriced-1)*(seam-left);
          }
          if (__SAVE_ARTIFACTS__) results[orientation].opening = decoded.toDataURL('image/png');
          if (__SAVE_ARTIFACTS__) {
            results[orientation].data = await new Promise(resolve => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.readAsDataURL(blob); });
            results[orientation].frame = finalImage;
          }
        } finally { player.removeAttribute('src'); player.load(); URL.revokeObjectURL(url); }
      }
      return results;
    })()""".replace("__SAVE_ARTIFACTS__", "true" if artifact_dir else "false"))
    for orientation, expected in (("landscape", (1280, 720)), ("portrait", (720, 1280)), ("square", (720, 720))):
        result = videos[orientation]
        if orientation == 'landscape':
            assert abs(result['openingEnd'] - result['expectedOpeningEnd']) < 4, result
        if artifact_dir:
            (artifact_dir / f"{orientation}-opening-video-frame.png").write_bytes(base64.b64decode(result.pop("opening").split(",", 1)[1]))
            (artifact_dir / f"{orientation}.{result['extension']}").write_bytes(base64.b64decode(result.pop("data").split(",", 1)[1]))
            (artifact_dir / f"{orientation}-video-frame.png").write_bytes(base64.b64decode(result.pop("frame").split(",", 1)[1]))
        assert (result["width"], result["height"]) == expected and abs(result["duration"] - 7/30) < .002, result
        assert result["size"] > 1000 and result["extension"] in ("mp4", "webm"), result
        assert result["pixel"][3] == 255 and max(result["pixel"][:3]) > 20, result

    # A corrupt detached generation must not replace the visible history.
    failure = cdp.evaluate("""(async () => {
      const before = WSBPriceDistributionDashboard.getState(), originalFetch = window.fetch;
      window.fetch = async (url, options) => String(url).includes('daily_price.csv')
        ? new Response('incomplete fixture', {status: 200}) : originalFetch(url, options);
      try {
        await WSBPriceDistributionDashboard.refresh();
        return { before, after: WSBPriceDistributionDashboard.getState(), message: document.getElementById('dashboardStatus').textContent };
      } finally { window.fetch = originalFetch; }
    })()""")
    assert failure["before"] == failure["after"] and "last complete history" in failure["message"], failure
    cdp.evaluate("WSBPriceDistributionDashboard.refresh()")
    wait_for(lambda: cdp.evaluate("!document.getElementById('dashboardStatus').textContent"), description="refresh recovery")

    # URL state beats saved controls, persists, and supports reset/undo.
    query = cdp.evaluate("""new URL(WSBDashboardComponents.buildShareUrl({slug: 'price_distribution', state: {
      startDate: '2016-01-01', date: '2020-01-01', speed: '2', orientation: 'portrait', quality: '1080', exportSpeed: '2', exportTheme: 'light', endHold: false
    }})).search""")
    cdp.command("Page.navigate", {"url": origin + "/webapps/price_distribution/dashboard.html" + query})
    wait_for(lambda: cdp.evaluate("WSBPriceDistributionDashboard?.getState()?.date === '2020-01-01'"), description="share state")
    shared_state = cdp.evaluate("WSBPriceDistributionDashboard.getState()")
    assert cdp.evaluate("document.getElementById('startDateInput').value === '2009-01-03' && WSBDashboardComponents.getButtonGroupValue(document.getElementById('exportOrientation')) === 'portrait'")
    cdp.evaluate("document.getElementById('resetDashboard').click()")
    assert cdp.evaluate("WSBPriceDistributionDashboard.getState().startIndex === 0")
    cdp.evaluate("document.getElementById('resetDashboard').click()")
    assert cdp.evaluate("WSBPriceDistributionDashboard.getState()") == shared_state
    cdp.command("Page.reload")
    wait_for(lambda: cdp.evaluate("WSBPriceDistributionDashboard?.getState()?.date === '2020-01-01'"), description="reloaded view")
    cdp.evaluate("document.getElementById('latestBtn').click()")
    cdp.evaluate("document.activeElement?.blur()")
    cdp.command("Input.dispatchKeyEvent", {"type": "keyDown", "key": " ", "code": "Space", "windowsVirtualKeyCode": 32})
    wait_for(lambda: cdp.evaluate("WSBPriceDistributionDashboard.getState().playing"), description="keyboard playback")
    cdp.evaluate("document.getElementById('stopPlayback').click()")

    # Shell snapshots provide review artifacts at both required desktop widths.
    for width in (1440, 1024):
        cdp.command("Emulation.setDeviceMetricsOverride", {"width": width, "height": 900, "deviceScaleFactor": 1, "mobile": False})
        if artifact_dir:
            cdp.evaluate("new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))")
            shot = cdp.command("Page.captureScreenshot", {"format": "png", "captureBeyondViewport": True})
            (artifact_dir / f"dashboard-{width}-dark.png").write_bytes(base64.b64decode(shot["data"]))
    cdp.evaluate("window.postMessage({type:'quantum-dashboard-theme', theme:'light'}, location.origin)")
    wait_for(lambda: cdp.evaluate("document.documentElement.dataset.theme === 'light'"), description="shared light theme message")
    for width in (390, 320):
        cdp.command("Emulation.setDeviceMetricsOverride", {
            "width": width, "height": 844, "deviceScaleFactor": 1, "mobile": True,
        })
        mobile = cdp.evaluate("""({ viewport: innerWidth,
          scroll: document.documentElement.scrollWidth,
          chart: document.getElementById('dashboardCanvas').getBoundingClientRect().width,
        })""")
        assert mobile["scroll"] <= mobile["viewport"] and mobile["chart"] > 200, mobile
        if artifact_dir:
            cdp.evaluate("new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))")
            shot = cdp.command("Page.captureScreenshot", {"format": "png", "captureBeyondViewport": True})
            (artifact_dir / f"dashboard-{width}-light.png").write_bytes(base64.b64decode(shot["data"]))
    cdp.command("Emulation.setDeviceMetricsOverride", {
        "width": 1440, "height": 900, "deviceScaleFactor": 1, "mobile": False,
    })
    cdp.command("Page.navigate", {"url": origin + "/price_distribution.html"})
    wait_for(lambda: cdp.evaluate("window.document.getElementById('modal-embed')?.contentWindow?.WSBPriceDistributionDashboard?.getState()?.rows > 100"),
             description="price distribution standalone shell")
    embedded = cdp.evaluate("""(() => {
      const frame = document.getElementById('modal-embed');
      frame.contentWindow.document.getElementById('expandDashboard').click();
      return { shell: document.body.classList.contains('price-distribution-dashboard-expanded'),
        frame: frame.contentWindow.document.body.classList.contains('price-distribution-dashboard-expanded') };
    })()""")
    wait_for(lambda: cdp.evaluate("document.body.classList.contains('price-distribution-dashboard-expanded')"),
             description="standalone expand message")
    assert embedded["frame"] and cdp.evaluate("document.body.classList.contains('price-distribution-dashboard-expanded')"), embedded
    print("Passed: shared controls, live/retained/historical price, genesis range, playback, three decoded PNG/video layouts, frozen live final frame, refresh failure/recovery, share/reset/undo, keyboard playback, mobile widths, and standalone expand")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--artifacts", type=Path, help="Save PNGs, short videos, and decoded final frames for visual review")
    args = parser.parse_args()
    if args.artifacts:
        args.artifacts.mkdir(parents=True, exist_ok=True)
    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    try:
        with capture_workspace() as workspace:
            port = free_port()
            with (workspace / "chrome.log").open("w+") as log:
                chrome = subprocess.Popen([
                    find_chrome(), "--headless=new", "--disable-gpu", "--disable-dev-shm-usage",
                    "--no-first-run", "--no-default-browser-check", "--disable-background-networking",
                    "--remote-allow-origins=*", f"--remote-debugging-port={port}",
                    f"--user-data-dir={workspace / 'profile'}", "about:blank",
                ], stdout=log, stderr=log, start_new_session=True)
                cdp = None
                try:
                    wait_for(lambda: urllib.request.urlopen(f"http://127.0.0.1:{port}/json/version", timeout=.5).read(),
                             description="Chrome DevTools endpoint")
                    request = urllib.request.Request(f"http://127.0.0.1:{port}/json/new?about:blank", method="PUT")
                    with urllib.request.urlopen(request, timeout=2) as response:
                        target = json.load(response)
                    cdp = CdpSocket(target["webSocketDebuggerUrl"])
                    cdp.command("Page.enable")
                    cdp.command("Runtime.enable")
                    check(cdp, f"http://127.0.0.1:{server.server_port}", args.artifacts)
                finally:
                    close_browser(chrome, cdp)
    finally:
        server.shutdown()
        server.server_close()


if __name__ == "__main__":
    main()
