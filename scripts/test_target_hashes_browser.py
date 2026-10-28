#!/usr/bin/env python3
"""Read-only browser regressions for Target & Block Hashes and shared controls.

Build its ignored local data first with scripts/build_target_hashes.py. Failures
use fetch shims; no source/live datasets, production jobs or databases change.
"""
import argparse
import base64
import json
from pathlib import Path
import subprocess
import threading
import urllib.request
from http.server import ThreadingHTTPServer
from browser_cdp import CdpSocket, QuietHandler, free_port, wait_for
from capture_card_fallbacks import capture_workspace, close_browser, find_chrome

ROOT = Path(__file__).resolve().parents[1]


class Handler(QuietHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)


def check(cdp, origin, artifacts):
    def js(source):
        return cdp.evaluate(source)

    def state():
        return js('window.WSBTargetHashesDashboard?.getState()')

    def search(value):
        js(f'''(() => {{ const input = document.getElementById('blockSearchInput');
          input.value = {json.dumps(str(value))}; document.getElementById('blockSearchTarget').click(); }})()''')

    def hash_color():
        return js('getComputedStyle(document.querySelectorAll("#chartTooltip strong")[1]).color')

    def save(name, data):
        if artifacts:
            (artifacts / name).write_bytes(base64.b64decode(data.split(',')[-1]))

    cdp.command('Emulation.setDeviceMetricsOverride', {'width': 1440, 'height': 900, 'deviceScaleFactor': 1, 'mobile': False})
    cdp.command('Page.navigate', {'url': origin + '/webapps/target_and_block_hashes/dashboard.html'})
    wait_for(lambda: (state() or {}).get('rows', 0) > 940536, description='block history')
    assert js('document.getElementById("dashboardStatus").textContent') == ''
    initial = state()
    model = js('''(async () => {
      const c = await WSBTargetHashesModel.prepareCandidate(async url => fetch(url));
      window.__testRows = c.rows;
      const row = c.rows[940536], summary = WSBTargetHashesModel.summary(row);
      const e = WSBDashboardExport, m = WSBTargetHashesModel;
      const frames = m.frameIndices(c.rows, 420001, 0, {exportSpeed:'1',endHold:false});
      const held = m.frameIndices(c.rows, 300, 0, {exportSpeed:'1',endHold:true});
      return { hash:row.hash, target:row.target, low:row.lowHeight, summary,
        genesisLow:c.rows[0].lowHeight, beforeLow:c.rows[756950].lowHeight,
        frames:[frames[0],frames[1],frames.at(-1)], milestones:[frames.includes(210000),frames.includes(420000)],
        holds:[held.slice(0,e.VIDEO_FPS).every(i=>i===300),held.slice(-e.VIDEO_FPS*3).every(i=>i===300)],
        half:m.frameIndices(c.rows,300,0,{exportSpeed:'.5',endHold:false}).slice(0,3),
        missingDate:m.latestIndexAtDate(c.rows,'2009-01-04') };
    })()''')
    assert model['hash'] == '0000000000000000000149e8754832535cbc2d6508a14bdfb05794800e314410', model
    assert model['summary']['difficulty'] == '145,042,165,424,853.31' and model['summary']['hashrate'] == '1,038.27 EH/s', model
    assert model['low'] == 756951 and model['beforeLow'] != 756951 and model['genesisLow'] == 0, model
    assert model['frames'] == [0,144,420001] and all(model['milestones']) and all(model['holds']), model
    assert model['half'] == [0,72,144] and model['missingDate'] == 0

    # A search selects an actual block regardless of the dense point cloud.
    search(756951)
    assert state()['selectedHeight'] == 756951 and state()['index'] == initial['index']
    assert js('!document.getElementById("chartTooltip").hidden && document.getElementById("chartTooltip").textContent.includes("756,951")')
    assert hash_color() == 'rgb(79, 145, 63)', 'Current lowest hash uses its green marker color'
    js('document.getElementById("dashboardCanvas").dispatchEvent(new PointerEvent("pointermove",{clientX:20,clientY:20})); document.getElementById("dashboardCanvas").dispatchEvent(new PointerEvent("pointerleave"));')
    assert js('!document.getElementById("chartTooltip").hidden'), 'Search tooltip must persist across pointer movement'
    search('invalid')
    assert state()['selectedHeight'] == 756951 and js('document.getElementById("blockSearchInput").getAttribute("aria-invalid")') == 'true'
    search(0)
    assert state()['selectedHeight'] == 0 and js('!document.getElementById("chartTooltip").hidden')
    assert hash_color() == 'rgb(255, 153, 0)', 'Genesis is not a halving or the current record low'
    assert js('''(() => {
      const input=getComputedStyle(document.getElementById('blockSearchInput'));
      return input.backgroundColor==='rgba(0, 0, 0, 0)' && input.borderTopWidth==='0px' && input.fontFamily.includes('IBM Plex Mono');
    })()'''), 'Search must use the shared transparent mono field'
    assert js('''(() => {
      const canvas=document.createElement('canvas');canvas.width=1000;canvas.height=600;
      const ctx=canvas.getContext('2d');
      const info=WSBTargetHashesChart.render(ctx,1000,600,__testRows,__testRows.length-1,{theme:'dark',selectedHeight:0});
      const dot=ctx.getImageData(Math.round(info.pointer.x),Math.round(info.pointer.y)+1,1,1).data;
      return 600-info.pointer.y>=16 && dot[0]>200 && dot[1]>200 && dot[2]>200;
    })()'''), 'Genesis dot and ring need clearance below the point'
    js('document.getElementById("blockSearchClear").click()')
    assert state()['selectedHeight'] is None and js('document.getElementById("chartTooltip").hidden')
    search(840000)
    assert hash_color() == 'rgb(19, 56, 190)', 'Halving hash uses its blue marker color'
    js('document.getElementById("resetDashboard").click()')
    assert state()['selectedHeight'] is None
    js('document.getElementById("resetDashboard").click()')
    assert state()['selectedHeight'] == 840000, 'Reset undo restores search'
    js('document.getElementById("playPause").click()')
    wait_for(lambda: state()['index'] > 0, description='block playback')
    js('document.getElementById("pausePlayback").click()')
    paused = state()['index']
    assert not state()['playing'] and paused < initial['index']
    js('document.getElementById("stopPlayback").click()')
    assert state()['index'] == initial['index']

    # Freeze the reference height independently from the same day's last block.
    js('document.getElementById("rangeDaysInput").value="940537"; document.getElementById("rangeDaysInput").dispatchEvent(new Event("change"))')
    search(756951)
    cdp.command('Page.reload')
    wait_for(lambda: (state() or {}).get('rows',0)>940536, description='saved exact height')
    assert state()['index'] == 940536 and state()['selectedHeight'] == 756951
    js('document.getElementById("copyDashboardLink").click()')
    # URL-state precedence is tested by navigation with an explicit shared state.
    query = js('new URL(WSBDashboardComponents.buildShareUrl({slug:"target_and_block_hashes",state:{date:"2009-01-03",height:0,selectedHeight:0}})).search')
    cdp.command('Page.navigate', {'url':origin+'/webapps/target_and_block_hashes/dashboard.html'+query})
    wait_for(lambda: (state() or {}).get('rows',0)>940536, description='shared genesis')
    assert state()['index'] == 0 and state()['selectedHeight'] == 0
    search(756951)
    assert state()['index'] == 756951, 'A future search reveals the requested block'

    # Cached/failed generations never blank or replace the current view.
    refresh = js('''(async () => {
      const before = WSBTargetHashesDashboard.getState(), original = window.fetch;
      window.fetch = async (...args) => String(args[0]).includes('manifest.json') ? new Response('unavailable',{status:503}) : original(...args);
      await WSBTargetHashesDashboard.refresh(); const failed = WSBTargetHashesDashboard.getState();
      window.fetch = original; await WSBTargetHashesDashboard.refresh();
      return {before,failed,after:WSBTargetHashesDashboard.getState(),error:document.getElementById('dashboardStatus').textContent};
    })()''')
    assert refresh['before'] == refresh['failed'] == refresh['after'] and not refresh['error'], refresh
    assert js('''(async () => {
      const M=WSBTargetHashesModel, fetchFresh=async url=>fetch(url);
      const marker=await (await fetch(M.MARKER)).json(); marker.chunks[0].sha256='f'.repeat(64);
      try { await M.prepareCandidate(async url=>url===M.MARKER ? new Response(JSON.stringify(marker)) : fetch(url)); return false; }
      catch(error) { return /integrity/.test(error.message); }
    })()'''), 'Corrupt publication must fail validation'

    # Decode real PNGs and short videos in all three export orientations.
    exports = js('''(async () => {
      const rows=(await WSBTargetHashesModel.prepareCandidate(async url=>fetch(url))).rows;
      const C=WSBTargetHashesChart,E=WSBDashboardExport,B=WSBDashboardExportBranding; await B.ready();
      const results={};
      for(const orientation of ['landscape','portrait','square']) {
        const dims=E.getDimensions({quality:'2160',orientation});
        const canvas=document.createElement('canvas'); Object.assign(canvas,dims);
        C.render(canvas.getContext('2d'),dims.width,dims.height,rows,940536,{export:true,branded:true,theme:'dark'});
        const bitmap=await createImageBitmap(await new Promise(r=>canvas.toBlob(r,'image/png')));
        const entry={pngSize:[bitmap.width,bitmap.height],png:canvas.toDataURL('image/png')}; bitmap.close();
        C.render(canvas.getContext('2d'),dims.width,dims.height,rows,940536,{export:true,branded:true,theme:'light'});
        entry.light=canvas.toDataURL('image/png');
        const settings={quality:'720',orientation,theme:'dark'}, size=E.getDimensions(settings);
        const frames=[0,144,210000,420000,630000,756951,840000,940536];
        const blob=await E.encodeVideo({canvas,width:size.width,height:size.height,fps:E.VIDEO_FPS,settings,frames,
          renderFrame:(i,target)=>C.render(target.getContext('2d'),size.width,size.height,rows,i,{export:true,branded:true,theme:'dark'})});
        if(!blob)throw Error('Video encoder unavailable');
        const video=document.createElement('video'),url=URL.createObjectURL(blob);video.muted=true;
        await new Promise((resolve,reject)=>{video.onloadedmetadata=resolve;video.onerror=reject;video.src=url;});
        await new Promise((resolve,reject)=>{video.onseeked=resolve;video.onerror=reject;video.currentTime=video.duration-.5/E.VIDEO_FPS;});
        const decoded=document.createElement('canvas');Object.assign(decoded,size);const ctx=decoded.getContext('2d');ctx.drawImage(video,0,0);
        entry.videoSize=[video.videoWidth,video.videoHeight];entry.duration=video.duration;entry.extension=E.videoExtension(blob);
        entry.frame=decoded.toDataURL('image/png');entry.video=await new Promise(resolve=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.readAsDataURL(blob);});
        let orange=0;const pixels=ctx.getImageData(0,0,size.width,size.height).data;
        for(let j=0;j<pixels.length;j+=4)if(pixels[j]>180&&pixels[j+1]>80&&pixels[j+1]<200&&pixels[j+2]<70)orange++;
        entry.orange=orange;results[orientation]=entry;video.removeAttribute('src');video.load();URL.revokeObjectURL(url);
      }
      return results;
    })()''')
    for orientation, expected in [('landscape',[3840,2160]),('portrait',[2160,3840]),('square',[2160,2160])]:
        result=exports[orientation]
        assert result['pngSize'] == expected and result['orange'] > 100 and abs(result['duration']-8/30)<.05, (orientation,{k:v for k,v in result.items() if k not in ('png','light','frame','video')})
        for key,suffix in [('png','.png'),('light','-light.png'),('frame','-decoded.png'),('video','.'+result['extension'])]: save(orientation+suffix,result[key])

    for width in [1440,1024,390,320]:
        cdp.command('Emulation.setDeviceMetricsOverride',{'width':width,'height':900,'deviceScaleFactor':1,'mobile':False})
        for theme in ['dark','light']:
            js(f'document.documentElement.dataset.theme="{theme}"')
            search(756951)
            bounds=js('''(() => {
              const rect=document.getElementById('chartTooltip').getBoundingClientRect();
              const input=document.getElementById('blockSearchInput').getBoundingClientRect();
              return {width:innerWidth,scroll:document.documentElement.scrollWidth,tooltip:[rect.left,rect.right],search:[input.left,input.right]};
            })()''')
            assert bounds['scroll']<=width+1 and bounds['search'][0]>=0 and bounds['search'][1]<=width, bounds
            assert bounds['tooltip'][0]>=0 and bounds['tooltip'][1]<=width+1, bounds
            shot=cdp.command('Page.captureScreenshot',{'format':'png','captureBeyondViewport':True});save(f'dashboard-{width}-{theme}.png',shot['data'])
    cdp.command('Emulation.setDeviceMetricsOverride',{'width':1280,'height':720,'deviceScaleFactor':1,'mobile':False})
    cdp.command('Page.navigate',{'url':origin+'/webapps/target_and_block_hashes/preview.html'})
    wait_for(lambda: js('document.documentElement.dataset.previewReady')=='1',description='homepage preview')
    assert js(r'''(() => {
      const canvas=document.getElementById('previewCanvas');
      const chunks=performance.getEntriesByType('resource').filter(r=>/\.bin(?:\?|$)/.test(r.name));
      const rgba=canvas.getContext('2d').getImageData(0,0,640,360).data;
      let left=640,right=0,top=360,bottom=0;
      for(let y=0;y<360;y++)for(let x=0;x<640;x++){
        const off=(y*640+x)*4;if(rgba[off]+rgba[off+1]+rgba[off+2]>40){left=Math.min(left,x);right=Math.max(right,x);top=Math.min(top,y);bottom=Math.max(bottom,y);}
      }
      return canvas.width===640 && canvas.height===360 && chunks.length===0 && left>=8 && left<24 && right>615 && right<634 && top>=6 && bottom>=355 && bottom<359;
    })()'''), 'Compact card must avoid full-history downloads and keep a small visible margin'
    save('preview.png',js('document.getElementById("previewCanvas").toDataURL("image/png")'))
    cdp.command('Page.navigate',{'url':origin+'/target_and_block_hashes.html'})
    wait_for(lambda:js('document.getElementById("modal-embed")?.contentWindow?.WSBTargetHashesDashboard?.getState()?.rows>940536'),description='standalone')
    js('document.getElementById("modal-embed").contentDocument.getElementById("expandDashboard").click()')
    wait_for(lambda:js('document.body.classList.contains("target-hashes-dashboard-expanded")'),description='standalone expansion')
    print('Passed: exact reference data, no future record lows, 144-block pacing/holds, persistent block search/clear/validation, reset/undo, exact-height state, refresh failures/integrity, decoded PNG/video in all orientations, dark/light desktop/mobile, preview, standalone expansion')


def main():
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--artifacts',type=Path);args=parser.parse_args()
    if args.artifacts:args.artifacts.mkdir(parents=True,exist_ok=True)
    server=ThreadingHTTPServer(('127.0.0.1',0),Handler);threading.Thread(target=server.serve_forever,daemon=True).start()
    try:
        with capture_workspace() as workspace:
            port=free_port()
            with (workspace/'chrome.log').open('w+') as log:
                chrome=subprocess.Popen([find_chrome(),'--headless=new','--disable-gpu','--disable-dev-shm-usage','--no-first-run','--no-default-browser-check','--disable-background-networking','--remote-allow-origins=*',f'--remote-debugging-port={port}',f'--user-data-dir={workspace / "profile"}','about:blank'],stdout=log,stderr=log,start_new_session=True)
                cdp=None
                try:
                    wait_for(lambda:urllib.request.urlopen(f'http://127.0.0.1:{port}/json/version',timeout=.5).read(),description='Chrome')
                    request=urllib.request.Request(f'http://127.0.0.1:{port}/json/new?about:blank',method='PUT')
                    with urllib.request.urlopen(request,timeout=2) as response:target=json.load(response)
                    cdp=CdpSocket(target['webSocketDebuggerUrl']);cdp.command('Page.enable');cdp.command('Runtime.enable')
                    check(cdp,f'http://127.0.0.1:{server.server_port}',args.artifacts)
                finally:close_browser(chrome,cdp)
    finally:server.shutdown();server.server_close()


if __name__=='__main__':main()
