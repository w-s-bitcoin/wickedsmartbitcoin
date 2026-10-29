#!/usr/bin/env python3
"""Compare 4K PNG and real video drawing proportions for every animated dashboard.

Frozen local data, blocked live feeds, isolated Chrome, and two encoded endpoint
frames per video. Records final-canvas text/stroke/marker sizes, including nested
chart canvases, rather than relying on lossy pixel equality. No producer runs.
"""
import argparse
import json
import re
import subprocess
import tempfile
import threading
import urllib.request
from http.server import ThreadingHTTPServer
from pathlib import Path

from test_export_footer_browser import CHROME, ROOT, FrozenHandler, SHIM
from test_stage1_refresh_atomicity import CdpSocket, free_port, wait_for

SLUGS = ('dca_cost_basis', 'dca_comparison', 'days_since_ath', 'issuance_rate', 'uoa',
         'patoshi_pattern', 'moving_average', 'eoe_growth', 'mined_supply_price',
         'price_distribution', 'target_and_block_hashes')
DAILY = {'mined_supply_price', 'price_distribution', 'target_and_block_hashes'}

TRACE = r"""
(() => {
  const traces=new WeakMap(), P=CanvasRenderingContext2D.prototype;
  const fresh=canvas=>{const t={text:[],strokes:[],arcs:[]};traces.set(canvas,t);return t;};
  const get=canvas=>traces.get(canvas)||fresh(canvas);
  const scale=m=>Math.hypot(m.a,m.b);
  const point=(m,x,y)=>({x:m.a*x+m.c*y+m.e,y:m.b*x+m.d*y+m.f});
  const native={};
  for(const name of ['clearRect','fillRect','fillText','stroke','arc','drawImage']) native[name]=P[name];
  P.clearRect=function(x,y,w,h){if(x===0&&y===0)fresh(this.canvas);return native.clearRect.call(this,x,y,w,h);};
  P.fillRect=function(x,y,w,h){
    const m=this.getTransform();
    if(x===0&&y===0&&Math.abs(w*m.a-this.canvas.width)<2&&Math.abs(h*m.d-this.canvas.height)<2)fresh(this.canvas);
    return native.fillRect.call(this,x,y,w,h);
  };
  P.fillText=function(text,x,y,...args){
    const m=this.getTransform(),size=Number(this.font.match(/([\d.]+)px/)?.[1]);
    if(/^[A-Z][a-z]{2} \d{2}, \d{4}(?:$| )/.test(String(text))){
      const cell=this.measureText('0').width;
      for(const length of [3,4,6,8,12]) {
        if(Math.abs(this.measureText(String(text).slice(0,length)).width-cell*length)>.1)
          throw new Error('Export date cells move: '+text+' '+this.font);
      }
    }
    get(this.canvas).text.push({text:String(text),size:size*scale(m),ux:size*m.a,uy:size*m.b,...point(m,x,y)});
    return native.fillText.call(this,text,x,y,...args);
  };
  P.stroke=function(...args){
    const t=get(this.canvas),size=this.lineWidth*scale(this.getTransform()),color=String(this.strokeStyle);
    if(!t.strokes.some(e=>e.size===size&&e.color===color))t.strokes.push({size,color});
    return native.stroke.apply(this,args);
  };
  P.arc=function(x,y,r,...args){
    const t=get(this.canvas),size=r*scale(this.getTransform());
    if(!t.arcs.some(e=>e.size===size))t.arcs.push({size});
    return native.arc.call(this,x,y,r,...args);
  };
  P.drawImage=function(image,...args){
    const src=traces.get(image);
    if(src&&args.length!==8){
      const [x,y,w=image.width,h=image.height]=args,m=this.getTransform();
      const s=scale(m)*w/image.width,t=get(this.canvas);
      src.text.forEach(e=>{
        const ux=m.a*e.ux*w/image.width+m.c*e.uy*h/image.height;
        const uy=m.b*e.ux*w/image.width+m.d*e.uy*h/image.height;
        t.text.push({...e,ux,uy,size:Math.hypot(ux,uy),...point(m,x+e.x*w/image.width,y+e.y*h/image.height)});
      });
      for(const kind of ['strokes','arcs'])src[kind].forEach(e=>{
        const scaled={...e,size:e.size*s};
        if(!t[kind].some(a=>a.size===scaled.size&&a.color===scaled.color))t[kind].push(scaled);
      });
    }
    return native.drawImage.call(this,image,...args);
  };
  window.__scaleExport={videos:[],png:null,read:canvas=>{
    const t=get(canvas),w=canvas.width,h=canvas.height;
    return {width:w,height:h,text:t.text.map(({ux,uy,...e})=>({...e,size:e.size/w,x:e.x/w,y:e.y/h})),
      strokes:t.strokes.map(e=>({...e,size:e.size/w})),arcs:t.arcs.map(e=>({...e,size:e.size/w}))};
  }};
  const toBlob=HTMLCanvasElement.prototype.toBlob;
  HTMLCanvasElement.prototype.toBlob=function(callback,type,...args){
    if(type==='image/png'&&Math.min(this.width,this.height)===2160)__scaleExport.png=__scaleExport.read(this);
    return toBlob.call(this,callback,type,...args);
  };
})();
"""

INSTRUMENT = r"""
(() => {
  const E=WSBDashboardExport,encode=E.encodeVideo;
  E.encodeVideo=options=>encode({...options,frames:[options.frames.find(i=>i!==options.frames.at(-1))??options.frames[0],options.frames.at(-1)],
    renderFrame:async(index,canvas,position)=>{
      // Pass the original final position so existing live-final-frame contracts apply.
      await options.renderFrame(index,canvas,position===0?options.frames.indexOf(index):options.frames.length-1);
      __scaleExport.videos.push(__scaleExport.read(canvas));
    }});
})();
"""

DECODE = r"""(async()=>{
  const item=__footerTest.downloads.at(-1),url=URL.createObjectURL(item.blob);
  try{
    if(item.blob.type==='image/png'){
      const bitmap=await createImageBitmap(item.blob),size=[bitmap.width,bitmap.height];bitmap.close();return size;
    }
    const video=document.createElement('video');video.muted=true;
    await new Promise((resolve,reject)=>{video.onloadeddata=resolve;video.onerror=reject;video.src=url;});
    const size=[video.videoWidth,video.videoHeight];video.remove();return size;
  }finally{URL.revokeObjectURL(url);}
})()"""


def assert_same(png, video, context):
    assert len(png['text']) == len(video['text']), (context, 'text count', len(png['text']), len(video['text']))
    assert png['text'], (context, 'no text captured')
    for a, b in zip(png['text'], video['text']):
        daily_date = (context[0] in {'dca_cost_basis', 'mined_supply_price'}
                      and re.fullmatch(r'[A-Z][a-z]{2} \d{2}, \d{4}', b['text'])
                      and a['text'].startswith(b['text'] + ' ')
                      and re.search(r'\d{2}:\d{2} \([^)]+\)$', a['text']))
        assert a['text'] == b['text'] or daily_date, (context, 'label changed', a, b)
        # Font rasterization/snapping can shift positions by one output pixel.
        assert abs(a['size']-b['size']) < 0.000015, (context, 'font proportion', a, b)
        assert abs(a['x']-b['x']) < 0.003 and abs(a['y']-b['y']) < 0.003, (context, 'text position', a, b)
    for kind in ('strokes', 'arcs'):
        a=sorted(set(round(e['size'], 6) for e in png[kind]))
        b=sorted(set(round(e['size'], 6) for e in video[kind]))
        assert len(a)==len(b) and all(abs(x-y)<0.00002 for x,y in zip(a,b)), (context, kind, a, b)


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('slugs',nargs='*',choices=SLUGS)
    parser.add_argument('--qualities',nargs='+',choices=['720','1080','1440','2160'],default=['720','1080','1440','2160'])
    parser.add_argument('--orientations',nargs='+',choices=['landscape','portrait','square'],default=['landscape','portrait','square'])
    parser.add_argument('--theme',choices=['dark','light'],default='dark')
    parser.add_argument('--mobile-video',action='store_true',help='Compare desktop PNG with 390px/DPR-2 video')
    parser.add_argument('--output-dir',default='/tmp/wsb-export-scale-review')
    args=parser.parse_args(); output=Path(args.output_dir);output.mkdir(parents=True,exist_ok=True)
    snapshots={}
    for directory in [ROOT/'assets',*(ROOT/'webapps'/slug/'webapp_data' for slug in SLUGS)]:
        if directory.exists():
            for path in directory.rglob('*'):
                if path.is_file() and path.suffix in ('.csv','.json','.txt','.bin') and 'block_data_' not in path.name:
                    snapshots['/'+path.relative_to(ROOT).as_posix()]=path.read_bytes()
    FrozenHandler.snapshot=snapshots
    port,debug=free_port(),free_port()
    server=ThreadingHTTPServer(('127.0.0.1',port),lambda *a,**kw:FrozenHandler(*a,directory=str(ROOT),**kw))
    threading.Thread(target=server.serve_forever,daemon=True).start()
    with tempfile.TemporaryDirectory(prefix='wsb-export-scale-') as profile:
        chrome=subprocess.Popen([CHROME,'--headless=new','--disable-gpu','--remote-allow-origins=*',f'--remote-debugging-port={debug}',f'--user-data-dir={profile}','about:blank'],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
        try:
            wait_for(lambda:urllib.request.urlopen(f'http://127.0.0.1:{debug}/json/version',timeout=.5).read(),description='Chrome')
            target=json.load(urllib.request.urlopen(urllib.request.Request(f'http://127.0.0.1:{debug}/json/new?about:blank',method='PUT')))
            cdp=CdpSocket(target['webSocketDebuggerUrl'])
            for command in ('Page.enable','Runtime.enable','Network.enable'):cdp.command(command)
            cdp.command('Network.setBlockedURLs',{'urls':['https://*','wss://*']})
            cdp.command('Page.addScriptToEvaluateOnNewDocument',{'source':SHIM+TRACE})
            cdp.command('Page.addScriptToEvaluateOnNewDocument',{'source':f"localStorage.setItem('quantum-research-dashboard-theme',{json.dumps(args.theme)});"})
            for slug in args.slugs or SLUGS:
                cdp.command('Emulation.setDeviceMetricsOverride',{'width':1440,'height':1000,'deviceScaleFactor':1,'mobile':False})
                cdp.command('Page.navigate',{'url':f'http://127.0.0.1:{port}/webapps/{slug}/dashboard.html'})
                image='#downloadImage' if slug in DAILY else '#downloadImageBtn'
                video='#downloadVideo' if slug in DAILY else '#downloadBtn' if slug=='patoshi_pattern' else '#dateRangeDownloadBtn'
                prefix='export' if slug in DAILY else 'download'
                orientation_group=f'#{prefix}Orientation'+('' if slug in DAILY else 'Select')
                quality_group=f'#{prefix}Quality'+('' if slug in DAILY else 'Select')
                theme_group=f'#{prefix}Theme'+('' if slug in DAILY else 'Select')
                wait_for(lambda:cdp.evaluate(f"!!document.querySelector('{image}:not([disabled])') && [...document.querySelectorAll('input[type=date],input[type=datetime-local]')].some(el=>el.value)"),timeout=90,description=slug+' ready')
                cdp.evaluate(INSTRUMENT)
                cdp.evaluate(f"document.querySelector('{theme_group} [data-value={args.theme}]').click()")
                for orientation in args.orientations:
                    cdp.command('Emulation.setDeviceMetricsOverride',{'width':1440,'height':1000,'deviceScaleFactor':1,'mobile':False})
                    cdp.evaluate(f"document.querySelector('{orientation_group} [data-value={orientation}]').click()")
                    n=cdp.evaluate('__footerTest.downloads.length')
                    cdp.evaluate(f"document.querySelector('{image}').click()")
                    wait_for(lambda:cdp.evaluate(f'__footerTest.downloads.length>{n}||__footerTest.errors.length'),timeout=90,description=f'{slug} {orientation} PNG')
                    assert not cdp.evaluate('__footerTest.errors'),(slug,cdp.evaluate('__footerTest.errors'))
                    png=cdp.evaluate('__scaleExport.png');assert png,(slug,'PNG not captured')
                    if slug=='uoa':
                        assert not any(re.fullmatch(r'\d{1,2}/\d{1,2}/\d{2}',e['text']) for e in png['text']),('unpadded UOA date',png['text'])
                    assert cdp.evaluate(DECODE)==[png['width'],png['height']]
                    assert min(png['width'],png['height'])==2160,png
                    (output/f'{slug}-{orientation}-png.json').write_text(json.dumps(png,indent=2))
                    if args.mobile_video:
                        cdp.command('Emulation.setDeviceMetricsOverride',{'width':390,'height':844,'deviceScaleFactor':2,'mobile':True})
                    for quality in args.qualities:
                        n=cdp.evaluate('__footerTest.downloads.length')
                        cdp.evaluate(f"document.querySelector('{quality_group} [data-value=\"{quality}\"]').click();document.querySelector('{video}').click()")
                        wait_for(lambda:cdp.evaluate(f'__footerTest.downloads.length>{n}||__footerTest.errors.length'),timeout=90,description=f'{slug} {orientation} {quality} video')
                        assert not cdp.evaluate('__footerTest.errors'),(slug,cdp.evaluate('__footerTest.errors'))
                        frame=cdp.evaluate('__scaleExport.videos.at(-1)');assert frame,(slug,'video not captured')
                        if slug in {'dca_cost_basis', 'mined_supply_price'}:
                            for captured in cdp.evaluate('__scaleExport.videos.slice(-2)'):
                                dates=[e['text'] for e in captured['text'] if re.match(r'^[A-Z][a-z]{2} \d{2}, \d{4}',e['text'])]
                                assert dates and all(re.fullmatch(r'[A-Z][a-z]{2} \d{2}, \d{4}',d) for d in dates),(slug,'video timestamp',dates)
                        assert cdp.evaluate(DECODE)==[frame['width'],frame['height']]
                        assert min(frame['width'],frame['height'])==int(quality),frame
                        (output/f'{slug}-{orientation}-{quality}.json').write_text(json.dumps(frame,indent=2))
                        assert_same(png,frame,(slug,orientation,quality))
                    print(f'{slug} {orientation}: 4K PNG matches video proportions at '+', '.join(args.qualities),flush=True)
            cdp.sock.close()
        finally:
            chrome.terminate();chrome.wait(timeout=10);server.shutdown()


if __name__=='__main__':main()
