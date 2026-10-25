#!/usr/bin/env python3
"""Decode dashboard video and PNG exports and check their shared creator/QR footer.

Uses frozen local payloads and isolated Chrome. Only two frames per export are
encoded; output PNG review images are written to /tmp, never to live data paths.
Node Count uses its normal public Plotly CDN loader; other targets block external
requests. Use --theme light to exercise the alternative export palette.
"""
import argparse
import base64
import json
import subprocess
import tempfile
import threading
import urllib.request
from http.server import ThreadingHTTPServer
from pathlib import Path

from test_comparison_live_price_browser import CHROME, ROOT, FrozenHandler
from test_stage1_refresh_atomicity import CdpSocket, free_port, wait_for

SLUGS = ("dca_cost_basis", "dca_comparison", "days_since_ath", "issuance_rate", "uoa", "patoshi_pattern", "node_count")

SHIM = r"""
window.__footerTest={downloads:[],errors:[],diagnostics:[],renders:[]};
const nativeConsoleError=console.error.bind(console);
console.error=(...args)=>{__footerTest.diagnostics.push(args.map(value=>value?.stack||String(value)).join(' '));nativeConsoleError(...args);};
window.WebSocket=undefined;
window.alert=message=>__footerTest.errors.push(String(message));
addEventListener('error',event=>__footerTest.errors.push(event.message));
addEventListener('unhandledrejection',event=>__footerTest.errors.push(String(event.reason)));
const makeUrl=URL.createObjectURL.bind(URL),blobs=new Map();
URL.createObjectURL=blob=>{const url=makeUrl(blob);blobs.set(url,blob);return url;};
const nativeClick=HTMLAnchorElement.prototype.click;
HTMLAnchorElement.prototype.click=function(){
  if(this.download){__footerTest.downloads.push({name:this.download,blob:blobs.get(this.href)});return;}
  return nativeClick.call(this);
};
"""

INSTRUMENT = r"""
(() => {
  const E=window.WSBDashboardExport,B=window.WSBDashboardExportBranding,F=window.__footerTest;
  if(window.WSBDashboardMP4){
    const mux=window.WSBDashboardMP4.buildBlob;
    window.WSBDashboardMP4.buildBlob=options=>{F.decoder={...options.decoderConfig,description:Array.from(new Uint8Array(options.decoderConfig.description))};return mux(options);};
  }
  const encode=E.encodeVideo;
  E.encodeVideo=options=>encode({...options,frames:[options.frames[0],options.frames.at(-1)]});
  const draw=B.drawFooterStrip,drawCanonical=B.drawFooter;
  const wordmark=B.drawWordmark;
  B.drawWordmark=(ctx,bounds,settings)=>{
    const transform=ctx.getTransform();
    F.wordmark={x:bounds.x*transform.a+transform.e,y:bounds.y*transform.d+transform.f,
      width:bounds.width*transform.a,height:bounds.width*394/1873*transform.d};
    return wordmark(ctx,bounds,settings);
  };
  const inspect=(ctx,url,metrics,settings,callback)=>{
    const images=[],footerText=[],native=ctx.drawImage,nativeText=ctx.fillText;
    ctx.fillText=function(text,...args){footerText.push(String(text));return nativeText.call(ctx,text,...args);};
    ctx.drawImage=function(image,...args){
      const derived=image instanceof HTMLCanvasElement;
      const src=image.src||(derived?'/webapps/shared/export_assets/'+(image.width>image.height?'bitcoin-wordmark.jpg':'wicked-apple.png'):'');
      images.push({src,derived,x:args[0],y:args[1],width:args[2],height:args[3]});return native.call(ctx,image,...args);
    };
    try{const layout=callback();F.renders.push({url,metrics,settings,layout,images,footerText,wordmark:F.wordmark});}
    finally{ctx.drawImage=native;ctx.fillText=nativeText;}
  };
  B.drawFooterStrip=(ctx,url,metrics,settings)=>inspect(ctx,url,metrics,settings,()=>draw(ctx,url,metrics,settings));
  B.drawFooter=(ctx,slug,metrics,settings)=>inspect(ctx,'https://wickedsmartbitcoin.com/'+slug,metrics,settings,()=>drawCanonical(ctx,slug,metrics,settings));
})();
"""

DECODE = r"""
(async()=>{
  const item=__footerTest.downloads.at(-1),video=document.createElement('video');
  const url=URL.createObjectURL(item.blob);
  try{
    const canvas=document.createElement('canvas');
    let bitmap;
    if(item.blob.type==='image/png'){
      bitmap=await createImageBitmap(item.blob);canvas.width=bitmap.width;canvas.height=bitmap.height;
    }else{
      await new Promise((resolve,reject)=>{video.onloadeddata=resolve;video.onerror=()=>reject(new Error('Video decode failed'));video.src=url;});
      video.muted=true;document.body.appendChild(video);
      await new Promise((resolve,reject)=>{video.requestVideoFrameCallback(resolve);video.play().catch(reject);});
      video.pause();canvas.width=video.videoWidth;canvas.height=video.videoHeight;
    }
    const ctx=canvas.getContext('2d');ctx.drawImage(bitmap||video,0,0);bitmap?.close();
    // Estimate calibration can draw another footer after the requested PNG.
    const render=(item.blob.type==='image/png'
      ? __footerTest.renders.findLast(entry=>entry.metrics.width===canvas.width&&entry.metrics.height===canvas.height)
      : null)||__footerTest.renders.at(-1);
    const decodedImages=render.images.map(image=>{
      const x=Math.floor(image.x*canvas.width/render.metrics.width),y=Math.floor(image.y*canvas.height/render.metrics.height);
      const width=Math.max(1,Math.floor(image.width*canvas.width/render.metrics.width)),height=Math.max(1,Math.floor(image.height*canvas.height/render.metrics.height));
      const pixels=ctx.getImageData(x,y,width,height).data;
      let colored=0,white=0;
      for(let i=0;i<pixels.length;i+=4){if(Math.max(pixels[i],pixels[i+1],pixels[i+2])-Math.min(pixels[i],pixels[i+1],pixels[i+2])>50)colored++;if(pixels[i]>200&&pixels[i+1]>200&&pixels[i+2]>200)white++;}
      const at=(a,b)=>Array.from(pixels.slice((b*width+a)*4,(b*width+a)*4+3));
      const inset=Math.max(1,Math.floor(Math.min(width,height)*.02));
      const corners=[[inset,inset],[width-1-inset,inset],[inset,height-1-inset],[width-1-inset,height-1-inset]].map(([a,b])=>at(a,b));
      // Preserve the exact destination rectangle before rounding a source
      // landmark to a decoded pixel; rounded crop widths shift narrow gaps.
      const limbGaps=[[.505,.805],[.665,.775]].map(([a,b])=>{
        const px=Math.round((image.x+image.width*a)*canvas.width/render.metrics.width);
        const py=Math.round((image.y+image.height*b)*canvas.height/render.metrics.height);
        return Array.from(ctx.getImageData(px,py,1,1).data.slice(0,3));
      });
      const edges=[];
      for(let a=inset;a<width-inset;a++)edges.push(at(a,inset),at(a,height-1-inset));
      for(let b=inset;b<height-inset;b++)edges.push(at(inset,b),at(width-1-inset,b));
      const edgeWhite=edges.filter(rgb=>rgb.every(channel=>channel>=225)).length/edges.length;
      return {src:image.src,colored,white,corners,limbGaps,edgeWhite};
    });
    let sourceOrange=0;
    if(render.wordmark){
      const mark=render.wordmark,size=Math.max(1,Math.floor(mark.height));
      const coin=ctx.getImageData(Math.floor(mark.x),Math.floor(mark.y),size,size).data;
      for(let i=0;i<coin.length;i+=4)
        if(Math.abs(coin[i]-247)<20&&Math.abs(coin[i+1]-147)<20&&Math.abs(coin[i+2]-27)<20)sourceOrange++;
    }
    return {name:item.name,type:item.blob.type,bytes:item.blob.size,width:canvas.width,height:canvas.height,
      frame:canvas.toDataURL('image/png').split(',')[1],render,decodedImages,sourceOrange,errors:__footerTest.errors};
  }finally{video.remove();URL.revokeObjectURL(url);}
})();
"""


def assert_light_branding(result, *, wordmark=False):
    creator = next(image for image in result["decodedImages"] if image["src"].endswith("wicked-apple.png"))
    qr = next(image for image in result["decodedImages"] if image["src"].endswith("qr_lightning.png"))
    threshold = 250 if result["type"] == "image/png" else 225
    assert all(min(corner) >= threshold for corner in creator["corners"]), ("Black creator background", creator)
    assert all(min(gap) >= threshold for gap in creator["limbGaps"]), ("Black background remains between mascot limbs", creator)
    assert all(min(corner) >= threshold for corner in qr["corners"]), ("Black QR corners", qr)
    assert qr["edgeWhite"] >= .98, ("QR outer edge is not clean white", qr)
    if wordmark:
        assert result["sourceOrange"] > 20, ("Bitcoin emblem lost its source orange", result["sourceOrange"])


def assert_footer_url(result):
    render = result["render"]
    urls = [text for text in render["footerText"] if text.startswith("https://wickedsmartbitcoin.com/")]
    if result["width"] <= result["height"]:
        assert urls == [] and render["layout"]["url"] is None, ("Portrait or square footer still includes website URL", render)
        metrics = render["metrics"]
        compact_height = max(54, int(min(metrics["width"], metrics["height"]) * 117 / 1080 + .5))
        assert metrics["footerHeight"] == compact_height, ("Portrait or square still reserves the removed URL row", metrics)
    else:
        assert urls == [render["url"]] and render["layout"]["url"] is not None, ("Landscape footer lost website URL", render)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("slugs", nargs="*", choices=SLUGS)
    parser.add_argument("--output-dir", default="/tmp/wsb-export-footer-review")
    parser.add_argument("--theme", choices=("dark", "light"), default="dark")
    parser.add_argument("--images-only", action="store_true", help="Check 2160 PNG actions without encoding video")
    args = parser.parse_args()
    output = Path(args.output_dir)
    output.mkdir(parents=True, exist_ok=True)
    snapshots = {}
    for directory in [ROOT / "assets", *(ROOT / "webapps" / slug / "webapp_data" for slug in SLUGS)]:
        if not directory.exists():
            continue
        for path in directory.rglob("*"):
            if path.is_file() and path.suffix in (".csv", ".json", ".txt", ".bin") and "block_data_" not in path.name:
                snapshots["/" + path.relative_to(ROOT).as_posix()] = path.read_bytes()
    FrozenHandler.snapshot = snapshots
    port, debug = free_port(), free_port()
    server = ThreadingHTTPServer(("127.0.0.1", port), lambda *a, **kw: FrozenHandler(*a, directory=str(ROOT), **kw))
    threading.Thread(target=server.serve_forever, daemon=True).start()
    with tempfile.TemporaryDirectory(prefix="wsb-export-footer-") as profile:
        chrome = subprocess.Popen([CHROME, "--headless=new", "--disable-gpu", "--remote-allow-origins=*",
            f"--remote-debugging-port={debug}", f"--user-data-dir={profile}", "about:blank"],
            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        try:
            wait_for(lambda: urllib.request.urlopen(f"http://127.0.0.1:{debug}/json/version", timeout=.5).read(), description="Chrome")
            target = json.load(urllib.request.urlopen(urllib.request.Request(f"http://127.0.0.1:{debug}/json/new?about:blank", method="PUT")))
            cdp = CdpSocket(target["webSocketDebuggerUrl"])
            cdp.command("Page.enable")
            cdp.command("Runtime.enable")
            cdp.command("Network.enable")
            cdp.command("Page.addScriptToEvaluateOnNewDocument", {"source": SHIM})
            cdp.command("Page.addScriptToEvaluateOnNewDocument", {"source": f"localStorage.setItem('quantum-research-dashboard-theme',{json.dumps(args.theme)});"})
            for slug in args.slugs or (("days_since_ath", "dca_comparison", "issuance_rate", "uoa", "patoshi_pattern") if args.images_only else SLUGS):
                # Node's existing Plotly loader uses its public CDN mirrors.
                cdp.command("Network.setBlockedURLs", {"urls": ["*fonts.googleapis.com*", "*fonts.gstatic.com*"] if slug == "node_count" else ["https://*", "wss://*"]})
                cdp.command("Page.navigate", {"url": f"http://127.0.0.1:{port}/webapps/{slug}/dashboard.html"})
                selector = "#downloadImageBtn" if args.images_only else ("#downloadBtn" if slug == "patoshi_pattern" else "#dateRangeDownloadBtn")
                if slug == "node_count":
                    wait_for(lambda: cdp.evaluate("!!document.querySelector('#historyChart')?.data?.length"), timeout=60, description="Node Plotly data")
                else:
                    wait_for(lambda: cdp.evaluate(f"!!document.querySelector('{selector}:not([disabled])') && !!window.WSBDashboardExportBranding"), timeout=60, description=slug)
                    wait_for(lambda: cdp.evaluate("Array.from(document.querySelectorAll('input[type=date],input[type=datetime-local]')).some(input=>!!input.value)"), timeout=60, description=f"{slug} data")
                    if args.images_only:
                        video_selector = "#downloadBtn" if slug == "patoshi_pattern" else "#dateRangeDownloadBtn"
                        assert cdp.evaluate(f"(() => {{const image=document.querySelector('{selector}'),video=document.querySelector('{video_selector}');return video?.previousElementSibling===image&&getComputedStyle(image).display!=='none'&&image.getBoundingClientRect().width>=30;}})()"), slug
                cdp.evaluate(INSTRUMENT)
                for orientation in (("history", "software") if slug == "node_count" else ("landscape", "portrait", "square")):
                    count = cdp.evaluate("__footerTest.downloads.length")
                    if slug == "node_count":
                        cdp.evaluate(f"downloadPlotlyChartWithBlackBackground('{orientation}Chart','node-count-{orientation}-footer-test')")
                    else:
                        cdp.evaluate(f"document.querySelector('#downloadOrientationSelect [data-value={orientation}]').click();document.querySelector('#downloadQualitySelect [data-value=\"720\"]').click();")
                        cdp.evaluate(f"document.querySelector('#downloadThemeSelect [data-value={args.theme}]')?.click()")
                        cdp.evaluate(f"document.querySelector('{selector}').click()")
                    wait_for(lambda: cdp.evaluate(f"__footerTest.downloads.length>{count} || __footerTest.errors.length"), timeout=60,
                             description=f"{slug} {orientation} {'image' if args.images_only else 'video'}")
                    assert cdp.evaluate("__footerTest.errors") == [], (slug, orientation, cdp.evaluate("({errors:__footerTest.errors,diagnostics:__footerTest.diagnostics,decoder:__footerTest.decoder})"))
                    result = cdp.evaluate(DECODE)
                    image = result.pop("frame")
                    (output / f"{slug}-{orientation}.png").write_bytes(base64.b64decode(image))
                    assert result["bytes"] > 1000, result
                    extension = {"image/png": "png", "video/mp4": "mp4", "video/webm": "webm"}[result["type"]]
                    assert result["name"].endswith("." + extension), result
                    if args.images_only:
                        assert result["type"] == "image/png", result
                        assert (result["width"], result["height"]) == {
                            "landscape": (3840, 2160), "portrait": (2160, 3840), "square": (2160, 2160),
                        }[orientation], result
                    if slug == "node_count":
                        assert (result["width"], result["height"]) == (3840, 2160), result
                    assert result["errors"] == [], result["errors"]
                    assert_footer_url(result)
                    render = result["render"]
                    if args.images_only and slug == "uoa":
                        assert (render["metrics"]["width"], render["metrics"]["height"]) == (result["width"], result["height"]), render
                    assert render["url"] == f"https://wickedsmartbitcoin.com/{slug}", render
                    images = render["images"]
                    assert any(image["src"].endswith("wicked-apple.png") for image in images), render
                    assert any(image["src"].endswith("qr_lightning.png") for image in images), render
                    assert any(image["src"].endswith("wicked-apple.png") and image["colored"] > 20 for image in result["decodedImages"]), result
                    assert any(image["src"].endswith("qr_lightning.png") and image["white"] > 20 for image in result["decodedImages"]), result
                    if args.theme == "light":
                        assert_light_branding(result, wordmark=slug == "dca_cost_basis")
                    metrics = render["metrics"]
                    for image in images:
                        assert image["x"] >= 0 and image["x"] + image["width"] <= metrics["width"], image
                        assert image["y"] >= metrics["height"] - metrics["footerHeight"], image
                        assert image["y"] + image["height"] <= metrics["height"], image
                    (output / f"{slug}-{orientation}.json").write_text(json.dumps(result, indent=2))
                    print(f"{slug} {orientation}: decoded {result['width']}×{result['height']} export with creator and Lightning QR", flush=True)
                    if slug == "dca_cost_basis" and args.theme == "light":
                        count = cdp.evaluate("__footerTest.downloads.length")
                        cdp.evaluate("document.querySelector('#downloadImageBtn').click()")
                        wait_for(lambda: cdp.evaluate(f"__footerTest.downloads.length>{count}"), timeout=60,
                                 description=f"DCA {orientation} light PNG")
                        png = cdp.evaluate(DECODE)
                        assert png["type"] == "image/png", png
                        assert_footer_url(png)
                        assert_light_branding(png, wordmark=True)
                        (output / f"{slug}-{orientation}-png.png").write_bytes(base64.b64decode(png.pop("frame")))
                        (output / f"{slug}-{orientation}-png.json").write_text(json.dumps(png, indent=2))
                count = cdp.evaluate("__footerTest.downloads.length")
                cdp.evaluate("__footerTest.ready=WSBDashboardExportBranding.ready;WSBDashboardExportBranding.ready=async()=>{throw new Error('Fixture branding asset unavailable');};")
                if slug == "node_count":
                    cdp.evaluate("downloadPlotlyChartWithBlackBackground('historyChart','node-count-failure-test').catch(error=>__footerTest.errors.push(error.message))")
                else:
                    cdp.evaluate(f"document.querySelector('{selector}').click()")
                wait_for(lambda: cdp.evaluate("__footerTest.errors.length>0"), description=f"{slug} asset failure")
                assert cdp.evaluate("__footerTest.downloads.length") == count, slug
                if slug != "node_count":
                    assert cdp.evaluate(f"!document.querySelector('{selector}').classList.contains('is-exporting') && !document.querySelector('{selector}').disabled && !window.wsbDashboardExportActive && !window.dateRangeExportActive"), slug
                cdp.evaluate("WSBDashboardExportBranding.ready=__footerTest.ready;__footerTest.errors=[];")
                if slug == "node_count":
                    cdp.evaluate("downloadPlotlyChartWithBlackBackground('historyChart','node-count-recovery-test')")
                else:
                    cdp.evaluate(f"document.querySelector('{selector}').click()")
                wait_for(lambda: cdp.evaluate(f"__footerTest.downloads.length>{count}"), timeout=60, description=f"{slug} asset recovery")
                assert cdp.evaluate("__footerTest.errors") == [], slug
                print(f"{slug}: failed branding retains controls and exports after recovery", flush=True)
            cdp.sock.close()
        finally:
            chrome.terminate()
            chrome.wait(timeout=10)
            server.shutdown()


if __name__ == "__main__":
    main()
