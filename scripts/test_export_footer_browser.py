#!/usr/bin/env python3
"""Decode legacy WebM/Node PNG exports and check their shared creator/QR footer.

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
window.__footerTest={downloads:[],errors:[],renders:[]};
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
  const encode=E.encodeWebM;
  E.encodeWebM=options=>encode({...options,frames:[options.frames[0],options.frames.at(-1)]});
  const draw=B.drawFooterStrip,drawCanonical=B.drawFooter;
  const inspect=(ctx,url,metrics,settings,callback)=>{
    const images=[],native=ctx.drawImage;
    ctx.drawImage=function(image,...args){images.push({src:image.src,x:args[0],y:args[1],width:args[2],height:args[3]});return native.call(ctx,image,...args);};
    try{const layout=callback();F.renders.push({url,metrics,settings,layout,images});}
    finally{ctx.drawImage=native;}
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
      await new Promise((resolve,reject)=>{video.onloadeddata=resolve;video.onerror=()=>reject(new Error('WebM decode failed'));video.src=url;});
      video.muted=true;document.body.appendChild(video);
      await new Promise((resolve,reject)=>{video.requestVideoFrameCallback(resolve);video.play().catch(reject);});
      video.pause();canvas.width=video.videoWidth;canvas.height=video.videoHeight;
    }
    const ctx=canvas.getContext('2d');ctx.drawImage(bitmap||video,0,0);bitmap?.close();
    const render=__footerTest.renders.at(-1);
    const decodedImages=render.images.map(image=>{
      const x=Math.floor(image.x*canvas.width/render.metrics.width),y=Math.floor(image.y*canvas.height/render.metrics.height);
      const width=Math.max(1,Math.floor(image.width*canvas.width/render.metrics.width)),height=Math.max(1,Math.floor(image.height*canvas.height/render.metrics.height));
      const pixels=ctx.getImageData(x,y,width,height).data;
      let colored=0,white=0;
      for(let i=0;i<pixels.length;i+=4){if(Math.max(pixels[i],pixels[i+1],pixels[i+2])-Math.min(pixels[i],pixels[i+1],pixels[i+2])>50)colored++;if(pixels[i]>200&&pixels[i+1]>200&&pixels[i+2]>200)white++;}
      return {src:image.src,colored,white};
    });
    return {name:item.name,bytes:item.blob.size,width:canvas.width,height:canvas.height,
      frame:canvas.toDataURL('image/png').split(',')[1],render,decodedImages,errors:__footerTest.errors};
  }finally{video.remove();URL.revokeObjectURL(url);}
})();
"""


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("slugs", nargs="*", choices=SLUGS)
    parser.add_argument("--output-dir", default="/tmp/wsb-export-footer-review")
    parser.add_argument("--theme", choices=("dark", "light"), default="dark")
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
            for slug in args.slugs or SLUGS:
                # Node's existing Plotly loader uses its public CDN mirrors.
                cdp.command("Network.setBlockedURLs", {"urls": ["*fonts.googleapis.com*", "*fonts.gstatic.com*"] if slug == "node_count" else ["https://*", "wss://*"]})
                cdp.command("Page.navigate", {"url": f"http://127.0.0.1:{port}/webapps/{slug}/dashboard.html"})
                selector = "#downloadBtn" if slug == "patoshi_pattern" else "#dateRangeDownloadBtn"
                if slug == "node_count":
                    wait_for(lambda: cdp.evaluate("!!document.querySelector('#historyChart')?.data?.length"), timeout=60, description="Node Plotly data")
                else:
                    wait_for(lambda: cdp.evaluate(f"!!document.querySelector('{selector}:not([disabled])') && !!window.WSBDashboardExportBranding"), timeout=60, description=slug)
                    wait_for(lambda: cdp.evaluate("Array.from(document.querySelectorAll('input[type=date],input[type=datetime-local]')).some(input=>!!input.value)"), timeout=60, description=f"{slug} data")
                cdp.evaluate(INSTRUMENT)
                for orientation in (("history", "software") if slug == "node_count" else ("landscape", "portrait", "square")):
                    count = cdp.evaluate("__footerTest.downloads.length")
                    if slug == "node_count":
                        cdp.evaluate(f"downloadPlotlyChartWithBlackBackground('{orientation}Chart','node-count-{orientation}-footer-test')")
                    else:
                        cdp.evaluate(f"document.querySelector('#downloadOrientationSelect [data-value={orientation}]').click();document.querySelector('#downloadQualitySelect [data-value=\"720\"]').click();")
                        cdp.evaluate(f"document.querySelector('#downloadThemeSelect [data-value={args.theme}]')?.click()")
                        cdp.evaluate(f"document.querySelector('{selector}').click()")
                    wait_for(lambda: cdp.evaluate(f"__footerTest.downloads.length>{count} || __footerTest.errors.length"), timeout=60, description=f"{slug} {orientation} WebM")
                    assert cdp.evaluate("__footerTest.errors") == [], cdp.evaluate("__footerTest.errors")
                    result = cdp.evaluate(DECODE)
                    image = result.pop("frame")
                    (output / f"{slug}-{orientation}.png").write_bytes(base64.b64decode(image))
                    assert result["bytes"] > 1000, result
                    if slug == "node_count":
                        assert (result["width"], result["height"]) == (3840, 2160), result
                    assert result["errors"] == [], result["errors"]
                    render = result["render"]
                    assert render["url"] == f"https://wickedsmartbitcoin.com/{slug}", render
                    images = render["images"]
                    assert any(image["src"].endswith("wicked-apple.png") for image in images), render
                    assert any(image["src"].endswith("qr_lightning.png") for image in images), render
                    assert any(image["src"].endswith("wicked-apple.png") and image["colored"] > 20 for image in result["decodedImages"]), result
                    assert any(image["src"].endswith("qr_lightning.png") and image["white"] > 20 for image in result["decodedImages"]), result
                    metrics = render["metrics"]
                    for image in images:
                        assert image["x"] >= 0 and image["x"] + image["width"] <= metrics["width"], image
                        assert image["y"] >= metrics["height"] - metrics["footerHeight"], image
                        assert image["y"] + image["height"] <= metrics["height"], image
                    (output / f"{slug}-{orientation}.json").write_text(json.dumps(result, indent=2))
                    print(f"{slug} {orientation}: decoded {result['width']}×{result['height']} export with creator and Lightning QR", flush=True)
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
