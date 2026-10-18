#!/usr/bin/env python3
"""Render and inspect Moving Average's image/video exports in isolated Chrome.

Uses the existing frozen publication and fake live feed. Real PNGs, WebM, and
render geometry are written outside the repository for visual review. No data
producer or live dataset is changed. Set CHROME_BIN if needed; optionally pass
--output-dir /tmp/moving-average-review to retain a predictable review location.
"""

import argparse
import base64
import json
import math
import re
import subprocess
import tempfile
import threading
import urllib.request
from datetime import datetime
from http.server import ThreadingHTTPServer
from pathlib import Path

from test_moving_average_browser import (
    CHROME, FIXTURE, ROOT, FrozenHandler, assert_clean, click, dashboard,
    freeze_data, navigate, select_line, select_type, set_input,
)
from test_stage1_refresh_atomicity import CdpSocket, free_port, wait_for


RECORD_EXPORTS = r"""
const fixture=w.__maFixture, G=w.WSBMovingAverageCharts;
fixture.renders=[];
const composite=G.composite;
G.composite=(ctx,width,height,options)=>{
  const record={width,height,canvasWidth:ctx.canvas.width,canvasHeight:ctx.canvas.height,
    date:options.model.rows[options.endIndex].date,text:[],plots:[],axes:[],images:[],priceStrokes:[]};
  const native={fillText:ctx.fillText,rect:ctx.rect,clip:ctx.clip,drawImage:ctx.drawImage,
    beginPath:ctx.beginPath,moveTo:ctx.moveTo,lineTo:ctx.lineTo,stroke:ctx.stroke};
  let lastRect=null,path=[],axisStart=0;
  const point=(x,y)=>{const p=new DOMPoint(x,y).matrixTransform(ctx.getTransform());return [p.x,p.y];};
  ctx.beginPath=function(...args){path=[];return native.beginPath.apply(ctx,args);};
  for(const name of ['moveTo','lineTo'])ctx[name]=function(x,y){path.push(point(x,y));return native[name].call(ctx,x,y);};
  ctx.stroke=function(...args){
    if(lastRect&&['#ffffff','#111111'].includes(ctx.strokeStyle)&&path.length)
      record.priceStrokes.push({minX:Math.min(...path.map(p=>p[0])),maxX:Math.max(...path.map(p=>p[0])),points:path.length});
    return native.stroke.apply(ctx,args);
  };
  ctx.fillText=function(text,x,y,...args){
    const transform=ctx.getTransform(),metrics=ctx.measureText(text);
    const squeeze=args[0]>0?Math.min(1,args[0]/metrics.width):1;
    const corners=[[x-metrics.actualBoundingBoxLeft*squeeze,y-metrics.actualBoundingBoxAscent],
      [x+metrics.actualBoundingBoxRight*squeeze,y-metrics.actualBoundingBoxAscent],
      [x-metrics.actualBoundingBoxLeft*squeeze,y+metrics.actualBoundingBoxDescent],
      [x+metrics.actualBoundingBoxRight*squeeze,y+metrics.actualBoundingBoxDescent]].map(([a,b])=>point(a,b));
    record.text.push({text:String(text),x,y,position:point(x,y),font:ctx.font,
      width:metrics.width,scale:Math.hypot(transform.a,transform.b),align:ctx.textAlign,
      rotated:Math.abs(transform.b)>1e-6,angle:Math.atan2(transform.b,transform.a),color:ctx.fillStyle,
      bounds:[Math.min(...corners.map(p=>p[0])),Math.min(...corners.map(p=>p[1])),
        Math.max(...corners.map(p=>p[0])),Math.max(...corners.map(p=>p[1]))]});
    return native.fillText.call(ctx,text,x,y,...args);
  };
  ctx.rect=function(x,y,width,height){lastRect={origin:point(x,y),end:point(x+width,y+height)};return native.rect.call(ctx,x,y,width,height);};
  ctx.clip=function(...args){
    if(lastRect){
      record.plots.push(lastRect);
      const text=record.text.slice(axisStart);
      record.axes.push({x:text.filter(item=>item.rotated),
        y:text.filter(item=>!item.rotated&&(/^[\$]|¢$/.test(item.text))&&
          item.position[1]>=lastRect.origin[1]-.1&&item.position[1]<=lastRect.end[1]+.1)});
      axisStart=record.text.length;
    }
    return native.clip.apply(ctx,args);
  };
  ctx.drawImage=function(image,...args){
    const dest=args.length===8?args.slice(4):args;
    record.images.push({source:image.currentSrc||image.src||'',origin:point(dest[0],dest[1]),
      end:point(dest[0]+(dest[2]||image.width),dest[1]+(dest[3]||image.height))});
    return native.drawImage.call(ctx,image,...args);
  };
  fixture.renderOptions=options;fixture.renderReference={width,height};
  try{return composite(ctx,width,height,options);}
  finally{Object.assign(ctx,native);fixture.renders.push(record);}
};
fixture.renderDate=date=>{
  const options=fixture.renderOptions,reference=fixture.renderReference;
  const canvas=d.createElement('canvas');canvas.width=3840;canvas.height=2160;
  const ctx=canvas.getContext('2d');ctx.scale(canvas.width/reference.width,canvas.height/reference.height);
  const endIndex=options.model.rows.findIndex(row=>row.date===date);
  if(endIndex<0)throw new Error('Missing historical fixture date '+date);
  G.composite(ctx,reference.width,reference.height,{...options,endIndex});
  return {record:fixture.renders.at(-1),image:canvas.toDataURL('image/png').split(',')[1]};
};
const encode=w.WSBDashboardExport.encodeWebM;
w.WSBDashboardExport.encodeWebM=options=>{
  fixture.video={width:options.width,height:options.height,frames:[...options.frames],rendered:[]};
  const render=options.renderFrame;
  return encode({...options,renderFrame:async (...args)=>{fixture.video.rendered.push(args[0]);return render(...args);}});
};
"""


def choose(cdp, group, value):
    click(cdp, f'#{group} button[data-value="{value}"]')


def export_blob(cdp, extension, output, decode_at=0):
    count = dashboard(cdp, "return w.__maFixture.downloads.length;")
    click(cdp, "#downloadImageBtn" if extension == "png" else "#dateRangeDownloadBtn")
    wait_for(lambda: dashboard(cdp, f"return w.__maFixture.downloads.length>{count};"),
             timeout=60, description=f"actual {extension} export")
    return save_blob(cdp,extension,output,decode_at)


def save_blob(cdp, extension, output, decode_at=0):
    dashboard(cdp,f"w.__maFixture.decodeAt={decode_at};")
    result = dashboard(cdp, """
      return (async()=>{
        const item=w.__maFixture.downloads.at(-1),blob=item.blob;
        const data=await new Promise(resolve=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result.split(',')[1]);reader.readAsDataURL(blob);});
        let width,height,decodedFrame,decodedTime,duration;
        if(blob.type==='image/png'){
          const bitmap=await createImageBitmap(blob);width=bitmap.width;height=bitmap.height;bitmap.close();
        }else{
          const video=d.createElement('video'),url=URL.createObjectURL(blob);
          await new Promise((resolve,reject)=>{video.onloadeddata=resolve;video.onerror=()=>reject(new Error('Exported WebM is not decodable'));video.preload='auto';video.src=url;});
          if(w.__maFixture.decodeAt)await new Promise(resolve=>{video.onseeked=resolve;video.currentTime=w.__maFixture.decodeAt;});
          width=video.videoWidth;height=video.videoHeight;
          decodedTime=video.currentTime;duration=video.duration;
          const frame=d.createElement('canvas');frame.width=width;frame.height=height;
          frame.getContext('2d').drawImage(video,0,0);decodedFrame=frame.toDataURL('image/png').split(',')[1];
          URL.revokeObjectURL(url);
        }
        return {name:item.name,type:blob.type,size:blob.size,width,height,data,decodedFrame,decodedTime,duration,record:w.__maFixture.renders.at(-1)};
      })();
    """)
    content = base64.b64decode(result.pop("data"))
    assert len(content) > 1000, result
    assert content.startswith(b"\x89PNG\r\n\x1a\n" if extension == "png" else b"\x1aE\xdf\xa3"), result
    output.write_bytes(content)
    if frame := result.pop("decodedFrame",None):
        output.with_name(output.stem+"-frame.png").write_bytes(base64.b64decode(frame))
    return result


def overlaps(first, second):
    return first[0] < second[2] and first[2] > second[0] and first[1] < second[3] and first[3] > second[1]


def check_geometry(record, count=3):
    assert len(record["plots"]) == count, record["plots"]
    for rect in record["plots"]:
        x, y = rect["origin"]
        right, bottom = rect["end"]
        assert 0 <= x < right <= record["canvasWidth"] and 0 <= y < bottom <= record["canvasHeight"], rect
    footer = [item for item in record["text"] if "wickedsmartbitcoin.com/moving_average" in item["text"]]
    assert len(footer) == 1, footer
    assert footer[0]["position"][1] > record["canvasHeight"] * .9, footer
    assert len(record['axes']) == count, record['axes']
    titles=[item for item in record['text'] if 'History (' in item['text'] or 'Window (' in item['text']]
    for index,(plot,axes) in enumerate(zip(record['plots'],record['axes'])):
        assert axes['x'] and axes['y'], (index,axes)
        assert len({tick['text'] for tick in axes['x']}) == len(axes['x']), ('Repeated month label',index,axes['x'])
        year_only=[bool(re.fullmatch(r'\d{4}',tick['text'])) for tick in axes['x']]
        assert all(year_only) or not any(year_only), ('Mixed date formats on one axis',index,axes['x'])
        for tick in axes['x']:
            assert re.fullmatch(r'(?:(?:0[1-9]|1[0-2])-)?\d{4}',tick['text']), ('Wrong date format',index,tick)
            assert abs(tick['angle']-math.pi/6)<1e-9, ('Date label must slope down-right 30 degrees',index,tick)
            assert tick['position'][1]>plot['end'][1], ('Date label is not below its plot',index,tick)
        for tick in axes['y']:
            assert tick['position'][0]>plot['end'][0] and tick['bounds'][0]>=plot['end'][0], ('Y label is not in the right gutter',index,tick,plot)
        ticks=axes['x']+axes['y']
        for tick in ticks:
            assert not overlaps(tick['bounds'],footer[0]['bounds']), ('Tick overlaps footer',index,tick,footer[0])
            for other_plot in record['plots']:
                bounds=[*other_plot['origin'],*other_plot['end']]
                assert not overlaps(tick['bounds'],bounds), ('Tick overlaps chart',index,tick,other_plot)
            for title in titles:
                assert not overlaps(tick['bounds'],title['bounds']), ('Tick overlaps panel title',index,tick,title)
    all_ticks=[tick for axes in record['axes'] for tick in axes['x']+axes['y']]
    for index,tick in enumerate(all_ticks):
        for other in all_ticks[index+1:]:
            assert not overlaps(tick['bounds'],other['bounds']), ('Ticks overlap',tick,other)
    assert len(record["images"]) == 1, record["images"]
    logo = record["images"][0]
    assert logo["origin"][0] > record["canvasWidth"] * .65 and logo["origin"][1] < record["canvasHeight"] * .12, logo
    assert logo["end"][0] <= record["canvasWidth"] and logo["end"][1] < record["canvasHeight"] * .2, logo
    for text in record["text"]:
        left,top,right,bottom = text["bounds"]
        assert -1 <= left <= right <= record["canvasWidth"]+1 and -1 <= top <= bottom <= record["canvasHeight"]+1, ('Clipped text',text)


def fixed_axis_anchors(record):
    return [(sorted({tick['position'][0] for tick in axes['y']}),
             sorted({tick['position'][1] for tick in axes['x']})) for axes in record['axes']]


def check_reference_dates(record):
    history_dates=[tick['text'] for tick in record['axes'][0]['x']]
    week_dates=[tick['text'] for tick in record['axes'][2]['x']]
    assert '2022' in history_dates and all(re.fullmatch(r'\d{4}',label) for label in history_dates),history_dates
    assert '01-2022' in week_dates and '07-2022' in week_dates,week_dates


def fixed_headings(record):
    items=record["text"]
    return [("Date:" if item["text"].startswith("Date:") else "Price:" if item["text"].startswith("Price:") else "Average value" if index and items[index-1]["text"].endswith("MA:") else item["text"], item["position"], item["font"])
            for index,item in enumerate(items) if any(word in item["text"] for word in ("History", "Window", "Moving Average", "Price:", "Date:"))
            or item["text"].endswith("MA:") or (index and items[index-1]["text"].endswith("MA:"))]


def check_price_endpoint(record,panel,first,last):
    start,end,active=(datetime.fromisoformat(value) for value in (first,last,record['date']))
    span=(end-start).total_seconds()
    # Export keeps the notebook's fixed 1% left time margin.
    expected=((active-start).total_seconds()+span*.01)/(span*1.01)
    plot=record['plots'][panel]
    actual=(record['priceStrokes'][panel]['maxX']-plot['origin'][0])/(plot['end'][0]-plot['origin'][0])
    assert abs(actual-expected)<1e-8,(record['date'],panel,actual,expected)
    if first=='2009-10-06':
        start_fraction=(record['priceStrokes'][panel]['minX']-plot['origin'][0])/(plot['end'][0]-plot['origin'][0])
        assert abs(start_fraction-1/101)<1e-8,(record['date'],panel,start_fraction)


def check_cents_statistics(record):
    values=[]
    for index,item in enumerate(record['text']):
        if item['text'].startswith('Price: '):values.append(item['text'][7:])
        elif index and record['text'][index-1]['text'].endswith('MA:'):values.append(item['text'])
    assert len(values) == 3 and values[0] != 'N/A',values
    assert all(value == 'N/A' or re.fullmatch(r'\d+\.\d{2,}¢',value) for value in values),values


def run_checks(cdp, direct, output):
    navigate(cdp, direct + "?fixture_reset=1")
    dashboard(cdp, "return w.WSBMovingAverageExport.ready();")
    dashboard(cdp, RECORD_EXPORTS)
    set_input(cdp, "#endDateInput", "2024-09-16", "change")
    click(cdp, "#dateRangeSettingsBtn")
    choose(cdp, "downloadThemeSelect", "dark")
    choose(cdp, "downloadQualitySelect", "720")
    results = {}
    reference = results["reference"] = export_blob(cdp, "png", output / "reference-4k.png")
    dashboard(cdp,"w.__maFixture.fullHistoryOptions={...w.__maFixture.renderOptions,startIndex:0};")
    assert (reference["width"], reference["height"]) == (3840,2160), reference
    check_geometry(reference["record"])
    check_reference_dates(reference['record'])
    # Wide changes in date and value length must never resize or move panels,
    # headings, or the logo. Compare drawing calls, not just DOM positions.
    for date in ("2010-01-01", "2010-06-01", "2011-09-16", "2017-09-16", "2024-09-16"):
        result = dashboard(cdp, f"return w.__maFixture.renderDate({json.dumps(date)});")
        (output / f"history-{date}.png").write_bytes(base64.b64decode(result.pop("image")))
        record = result["record"]
        check_geometry(record)
        assert record["plots"] == reference["record"]["plots"], (date, record["plots"])
        assert fixed_axis_anchors(record) == fixed_axis_anchors(reference['record']), (date,fixed_axis_anchors(record))
        assert fixed_headings(record) == fixed_headings(reference["record"]), (date, fixed_headings(record))
        assert record["images"] == reference["record"]["images"], date
        results[date] = record
    check_price_endpoint(results['2010-06-01'],2,'2009-10-06','2013-08-06')
    check_price_endpoint(results['2010-01-01'],1,'2009-10-06','2010-04-24')
    check_price_endpoint(results['2010-01-01'],2,'2009-10-06','2013-08-06')
    check_cents_statistics(results['2010-06-01'])
    check_price_endpoint(results['2011-09-16'],2,'2009-10-06','2013-08-06')
    for orientation,theme,expected in (("landscape","light",(3840,2160)),("square","dark",(2160,2160)),("portrait","dark",(2160,3840))):
        choose(cdp,"downloadOrientationSelect",orientation);choose(cdp,"downloadThemeSelect",theme)
        result = results[f"{orientation}-{theme}"] = export_blob(cdp,"png",output/f"{orientation}-{theme}-4k.png")
        assert (result["width"],result["height"]) == expected,result
        check_geometry(result["record"])
        # Six-digit linear ticks must fit the same fixed right gutters in every
        # orientation, without shifting a panel when scale or data changes.
        set_input(cdp,'#endDateInput',dashboard(cdp,'return w.WSBMovingAverageDashboard.getModel().rows.at(-1).date;'),'change')
        click(cdp,'#historyScale [data-value="linear"]')
        linear=results[f'{orientation}-linear']=export_blob(cdp,'png',output/f'{orientation}-linear-4k.png')
        check_geometry(linear['record'])
        assert linear['record']['plots'] == result['record']['plots'], (orientation,linear['record']['plots'],result['record']['plots'])
        assert fixed_axis_anchors(linear['record']) == fixed_axis_anchors(result['record']),orientation
        click(cdp,'#historyScale [data-value="log"]');set_input(cdp,'#endDateInput','2024-09-16','change')
    choose(cdp,"downloadOrientationSelect","landscape")
    select_line(cdp,1,9,"day");select_type(cdp,1,"ema");select_type(cdp,2,"none")
    result = results["ema-only"] = export_blob(cdp,"png",output/"ema-only-4k.png")
    check_geometry(result["record"],count=2)
    assert not any("200 Week" in item["text"] for item in result["record"]["text"]),result["record"]["text"]
    assert any("Exponential" in item["text"] or "EMA" in item["text"] for item in result["record"]["text"]),result["record"]["text"]
    select_line(cdp,1,200,"day");select_type(cdp,1,"sma");select_type(cdp,2,"sma")
    # A short range inside January has no year-start tick. Its fallback label
    # therefore retains the month even though every date is in January.
    set_input(cdp,'#endDateInput','2010-01-05','change');set_input(cdp,'#startDateInput','2010-01-02','change')
    january=results['january-short-range']=export_blob(cdp,'png',output/'january-short-range-4k.png')
    check_geometry(january['record'])
    assert [tick['text'] for tick in january['record']['axes'][0]['x']] == ['01-2010'],january['record']['axes'][0]
    set_input(cdp,'#startDateInput','2009-12-29','change')
    dashboard(cdp,"const hold=d.querySelector('#downloadEndFrameHoldToggle');hold.checked=false;hold.dispatchEvent(new w.Event('change',{bubbles:true}));")
    choose(cdp,"downloadQualitySelect","1080")
    set_input(cdp,'#endDateInput','2010-01-01','change');set_input(cdp,'#startDateInput','2009-12-29','change')
    early_video=results['initial-window-video']=export_blob(cdp,'webm',output/'initial-window-1080.webm',decode_at=.1)
    assert (early_video['width'],early_video['height']) == (1920,1080),early_video
    assert early_video['record']['date'] == '2010-01-01' and early_video['decodedTime'] >= .1,early_video
    check_geometry(early_video['record']);check_price_endpoint(early_video['record'],2,'2009-10-06','2013-08-06')
    check_price_endpoint(early_video['record'],1,'2009-10-06','2010-04-24')
    check_cents_statistics(early_video['record'])
    assert [tick['text'] for tick in early_video['record']['axes'][0]['x']] == ['2010'],early_video['record']['axes'][0]
    early_frames=dashboard(cdp,'return w.__maFixture.video;')
    assert len(early_frames['frames']) == 4 and early_frames['frames'] == early_frames['rendered'],early_frames
    set_input(cdp,'#endDateInput','2024-09-16','change');set_input(cdp,"#startDateInput","2024-09-13","change")
    result = results["video"] = export_blob(cdp,"webm",output/"reference-1080.webm")
    assert (result["width"],result["height"]) == (1920,1080),result
    video = dashboard(cdp,"return w.__maFixture.video;")
    assert len(video["frames"]) == 4 and video["frames"] == video["rendered"],video
    check_geometry(result["record"])
    # Use the same renderer and shared encoder with a full-history snapshot to
    # review the reference composition in motion without encoding 5,000+ days.
    dashboard(cdp,"""
      return (async()=>{
        const fixture=w.__maFixture,options=fixture.fullHistoryOptions;
        const dates=['2024-09-13','2024-09-14','2024-09-15','2024-09-16'];
        const frames=dates.flatMap(date=>Array(15).fill(options.model.rows.findIndex(row=>row.date===date)));
        const canvas=d.createElement('canvas');canvas.width=1920;canvas.height=1080;
        const blob=await w.WSBDashboardExport.encodeWebM({canvas,width:1920,height:1080,
          settings:{quality:'1080',orientation:'landscape',theme:'dark'},fps:30,frames,title:'Moving Average export review',
          renderFrame:index=>w.WSBMovingAverageCharts.composite(canvas.getContext('2d'),1920,1080,{...options,endIndex:index})});
        if(!blob)throw new Error('Review WebM encoding failed');
        fixture.downloads.push({name:'full-history-sample.webm',blob});
      })();
    """)
    sample=results["full-history-sample"]=save_blob(cdp,"webm",output/"full-history-sample.webm",decode_at=1.95)
    assert (sample["width"],sample["height"]) == (1920,1080),sample
    assert sample["record"]["date"] == "2024-09-16" and sample["decodedTime"] >= 1.5,sample
    check_geometry(sample["record"])
    check_reference_dates(sample['record'])
    set_input(cdp,'#startDateInput',dashboard(cdp,'return w.WSBMovingAverageDashboard.getModel().rows[0].date;'),'change')
    for period,unit,date,axis_end in [(200,'day','2010-01-01','2010-04-24'),
        (200,'day','2010-04-24','2010-04-24'),(600,'day','2010-01-01','2011-05-29'),
        (600,'day','2011-05-29','2011-05-29'),(200,'week','2013-08-06','2013-08-06'),
        (12,'month','2010-01-01','2010-10-06'),(12,'month','2010-10-06','2010-10-06')]:
        select_line(cdp,1,period,unit);set_input(cdp,'#endDateInput',date,'change')
        key=f'initial-window-{period}-{unit}-{date}'
        result=results[key]=export_blob(cdp,'png',output/f'{key}.png')
        check_geometry(result['record'])
        check_price_endpoint(result['record'],1,'2009-10-06',axis_end)
        if date == '2010-01-01':check_cents_statistics(result['record'])
    assert_clean(cdp)
    (output/"render-observations.json").write_text(json.dumps(results,indent=2)+"\n")
    print("PASS export: true 4K PNG, decoded WebM, right-side y labels, consistent per-axis year/month formatting, no clipped/overlapping labels, stable historical geometry, light/square/portrait and EMA/None",flush=True)
    print(f"Review images, video, and geometry: {output}",flush=True)


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output-dir",type=Path)
    args=parser.parse_args()
    output=args.output_dir or Path(tempfile.mkdtemp(prefix="wsb-moving-average-export-review-"))
    output.mkdir(parents=True,exist_ok=True)
    if not Path(CHROME).is_file():
        raise SystemExit(f"Chrome not found at {CHROME}; set CHROME_BIN")
    freeze_data()
    server_port,debug_port=free_port(),free_port()
    server=ThreadingHTTPServer(("127.0.0.1",server_port),lambda *a,**kw:FrozenHandler(*a,directory=str(ROOT),**kw))
    threading.Thread(target=server.serve_forever,daemon=True).start()
    with tempfile.TemporaryDirectory(prefix="wsb-moving-average-export-") as profile:
        chrome=subprocess.Popen([CHROME,"--headless=new","--disable-gpu","--remote-allow-origins=*",f"--remote-debugging-port={debug_port}",f"--user-data-dir={profile}","about:blank"],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
        try:
            wait_for(lambda:urllib.request.urlopen(f"http://127.0.0.1:{debug_port}/json/version",timeout=.5).read(),description="Chrome DevTools")
            target=json.load(urllib.request.urlopen(urllib.request.Request(f"http://127.0.0.1:{debug_port}/json/new?about:blank",method="PUT")))
            cdp=CdpSocket(target["webSocketDebuggerUrl"])
            cdp.command("Page.enable");cdp.command("Runtime.enable");cdp.command("Network.enable")
            cdp.command("Network.setBlockedURLs",{"urls":["*fonts.googleapis.com*","*fonts.gstatic.com*"]})
            cdp.command("Emulation.setDeviceMetricsOverride",{"width":1280,"height":900,"deviceScaleFactor":1,"mobile":False})
            cdp.command("Page.addScriptToEvaluateOnNewDocument",{"source":FIXTURE})
            run_checks(cdp,f"http://127.0.0.1:{server_port}/webapps/moving_average/dashboard.html",output)
        finally:
            chrome.terminate()
            try:chrome.wait(timeout=5)
            except subprocess.TimeoutExpired:chrome.kill();chrome.wait(timeout=5)
            server.shutdown()


if __name__ == "__main__":
    main()
