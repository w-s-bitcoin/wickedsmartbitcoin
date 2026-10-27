#!/usr/bin/env python3
"""Check every video dashboard's shared cadence, progress, cancel and recovery.

Uses an isolated Chrome profile, read-only frozen data and two real video frames.
External feeds are blocked; deliberate failure/cancel runs never download files.
"""
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

SLUGS = ('dca_cost_basis', 'dca_comparison', 'days_since_ath', 'issuance_rate',
         'uoa', 'patoshi_pattern', 'moving_average', 'eoe_growth',
         'mined_supply_price', 'price_distribution')
SHIM = r"""
window.WebSocket=undefined;
window.__progressTest={errors:[],downloads:[],mode:'success'};
window.alert=()=>{};
addEventListener('error',e=>__progressTest.errors.push(e.message));
addEventListener('unhandledrejection',e=>__progressTest.errors.push(String(e.reason)));
const create=URL.createObjectURL.bind(URL),blobs=new Map();
URL.createObjectURL=blob=>{const url=create(blob);blobs.set(url,blob);return url;};
HTMLAnchorElement.prototype.click=function(){if(this.download)__progressTest.downloads.push(blobs.get(this.href));};
"""
INSTALL = r"""
(() => {
 const E=WSBDashboardExport,F=__progressTest,encode=E.encodeVideo;
 E.encodeVideo=async options=>{
   F.options=options; F.fps=options.fps; F.entered=true;
   options.onProgress(.25);
   F.ring=document.querySelector('.date-range-export-progress');
   await new Promise(resolve=>F.release=resolve);
   if(F.mode==='failure')throw Error('Intentional fixture failure');
   if(F.mode==='cancel'){F.canceled=options.isCanceled();return null;}
   const blob=await encode({...options,frames:[options.frames[0],options.frames.at(-1)]});
   const video=document.createElement('video'); video.muted=true; video.src=URL.createObjectURL(blob);
   await new Promise((resolve,reject)=>{video.onloadeddata=resolve;video.onerror=reject;});
   F.decoded={width:video.videoWidth,height:video.videoHeight,duration:video.duration,type:blob.type};
   URL.revokeObjectURL(video.src);
   return blob;
 };
})();
"""
PROBE = r"""
(() => {
 const F=__progressTest,ring=document.querySelector('.date-range-export-progress');
 const style=getComputedStyle(ring),before=getComputedStyle(ring,'::before');
 return {same:ring===F.ring,width:style.width,height:style.height,
   transition:before.transitionDuration,property:before.transitionProperty,
   background:before.backgroundImage,progress:style.getPropertyValue('--date-range-export-progress').trim(),
   stop:!!ring.querySelector('.date-range-export-stop-square'),
   enabled:!ring.closest('button').disabled,label:ring.closest('button').getAttribute('aria-label')};
})();
"""

def main():
    snapshots = {}
    for directory in [ROOT/'assets', *(ROOT/'webapps'/slug/'webapp_data' for slug in SLUGS)]:
        if directory.exists():
            for path in directory.rglob('*'):
                if path.is_file() and path.suffix in ('.csv', '.json', '.txt', '.bin') and 'block_data_' not in path.name:
                    snapshots['/'+path.relative_to(ROOT).as_posix()] = path.read_bytes()
    FrozenHandler.snapshot = snapshots
    port, debug = free_port(), free_port()
    server = ThreadingHTTPServer(('127.0.0.1', port), lambda *a, **kw: FrozenHandler(*a, directory=str(ROOT), **kw))
    threading.Thread(target=server.serve_forever, daemon=True).start()
    output = Path(tempfile.mkdtemp(prefix='wsb-export-progress-review-'))
    with tempfile.TemporaryDirectory(prefix='wsb-export-progress-profile-') as profile:
        chrome = subprocess.Popen([CHROME, '--headless=new', '--disable-gpu', '--remote-allow-origins=*',
            f'--remote-debugging-port={debug}', f'--user-data-dir={profile}', 'about:blank'], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        try:
            wait_for(lambda: urllib.request.urlopen(f'http://127.0.0.1:{debug}/json/version', timeout=.5).read(), description='Chrome')
            target = json.load(urllib.request.urlopen(urllib.request.Request(f'http://127.0.0.1:{debug}/json/new?about:blank', method='PUT')))
            cdp = CdpSocket(target['webSocketDebuggerUrl'])
            cdp.command('Page.enable'); cdp.command('Runtime.enable'); cdp.command('Network.enable')
            cdp.command('Network.setBlockedURLs', {'urls':['https://*','wss://*']})
            cdp.command('Page.addScriptToEvaluateOnNewDocument', {'source':SHIM})
            for slug in SLUGS:
                selector = '#downloadBtn' if slug=='patoshi_pattern' else ('#downloadVideo' if slug in SLUGS[-2:] else '#dateRangeDownloadBtn')
                cdp.command('Page.navigate', {'url':f'http://127.0.0.1:{port}/webapps/{slug}/dashboard.html'})
                wait_for(lambda: cdp.evaluate(f"!!document.querySelector('{selector}:not([disabled])') && !!window.WSBDashboardExportBranding && Array.from(document.querySelectorAll('input[type=date],input[type=datetime-local]')).some(input=>!!input.value)"), timeout=60, description=slug)
                cdp.evaluate(INSTALL)
                # Historical EOE endpoint avoids requesting the intentionally blocked live service.
                if slug=='eoe_growth':
                    cdp.evaluate("const end=document.querySelector('#endDateInput');end.value='2020-01-01';end.dispatchEvent(new Event('change',{bubbles:true}));")
                for mode in ('success','cancel','failure'):
                    count=cdp.evaluate('__progressTest.downloads.length')
                    cdp.evaluate(f"Object.assign(__progressTest,{{mode:'{mode}',entered:false,canceled:false}});document.querySelector('{selector}').click();")
                    wait_for(lambda: cdp.evaluate('__progressTest.entered'), timeout=60, description=f'{slug} {mode} encoder')
                    assert cdp.evaluate('__progressTest.fps')==30, slug
                    cdp.evaluate('__progressTest.options.onProgress(.75)')
                    for theme,gray in [('dark','95, 95, 95'),('light','189, 189, 189')]:
                        cdp.evaluate(f"document.documentElement.dataset.theme='{theme}'")
                        probe=cdp.evaluate(PROBE)
                        assert probe['same'] and probe['stop'] and probe['enabled'], (slug,probe)
                        assert (probe['width'],probe['height'],probe['transition'],probe['progress'])==('22px','22px','0.14s','75%'), (slug,probe)
                        assert probe['property']=='--date-range-export-progress' and gray in probe['background'], (slug,probe)
                        assert probe['label']=='Cancel animation download', (slug,probe)
                        if mode=='success':
                            screenshot=cdp.command('Page.captureScreenshot', {'format':'png'})
                            (output/f'{slug}-{theme}.png').write_bytes(base64.b64decode(screenshot['data']))
                    if mode=='cancel':cdp.evaluate(f"document.querySelector('{selector}').click()")
                    cdp.evaluate('__progressTest.release()')
                    wait_for(lambda: cdp.evaluate(f"!document.querySelector('{selector}').classList.contains('is-exporting') && !document.querySelector('{selector}').disabled"),timeout=60,description=f'{slug} {mode} cleanup')
                    assert cdp.evaluate(f"!document.querySelector('{selector}').classList.contains('is-canceling')"),slug
                    assert cdp.evaluate('__progressTest.downloads.length')==count+(mode=='success'),slug
                    if mode=='success':
                        decoded=cdp.evaluate('__progressTest.decoded')
                        assert decoded['width']>0 and decoded['height']>0 and abs(decoded['duration']-2/30)<.002,decoded
                    if mode=='cancel':assert cdp.evaluate('__progressTest.canceled'),slug
                    assert cdp.evaluate('__progressTest.errors')==[],(slug,cdp.evaluate('__progressTest.errors'))
                print(f'{slug}: 30 fps decoded video, shared ring in both themes, cancellation and failure recovery passed',flush=True)
            cdp.sock.close()
        finally:
            chrome.terminate();chrome.wait(timeout=10);server.shutdown()
    print(f'Review screenshots: {output}',flush=True)

if __name__=='__main__':main()
