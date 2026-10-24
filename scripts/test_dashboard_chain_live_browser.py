#!/usr/bin/env python3
"""Real dashboard/preview regressions using isolated public-block feed responses.

Serves a frozen copy of published data and mocks public sockets/REST in the
browser. No producer, database, production service, or published file is changed.
Run from the repository root; optionally pass eoe_growth or issuance_rate.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import subprocess
import tempfile
import threading
import time
import urllib.request
from http.server import ThreadingHTTPServer

from test_comparison_live_price_browser import FrozenHandler
from test_stage1_refresh_atomicity import CdpSocket, free_port, wait_for

ROOT = Path(__file__).resolve().parents[1]
CHROME = os.environ.get("CHROME_BIN", "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome")


def freeze_data():
    paths = [
        "assets/daily_price.csv", "assets/daily_price_metadata.json", "assets/top_kpis.json",
        "webapps/issuance_rate/webapp_data/issuance_rate_data.json",
        "webapps/issuance_rate/webapp_data/issuance_rate_preview.json",
        "webapps/issuance_rate/webapp_data/published_generation.json",
    ]
    for _ in range(5):
        frozen = {"/" + path: (ROOT / path).read_bytes() for path in paths}
        price = json.loads(frozen["/assets/daily_price_metadata.json"])
        issuance = json.loads(frozen["/webapps/issuance_rate/webapp_data/published_generation.json"])
        checks = [
            (frozen["/assets/daily_price.csv"], price["artifact"]["sha256"]),
            (frozen["/webapps/issuance_rate/webapp_data/issuance_rate_data.json"], issuance["data_sha256"]),
            (frozen["/webapps/issuance_rate/webapp_data/issuance_rate_preview.json"], issuance["preview_sha256"]),
        ]
        if all(hashlib.sha256(payload).hexdigest() == expected for payload, expected in checks):
            FrozenHandler.snapshot = frozen
            source = json.loads(frozen["/webapps/issuance_rate/webapp_data/issuance_rate_preview.json"])["source"]
            return {
                "height": max(source["latest_block_height"], price["latest_block_height"]),
                "at": source["latest_block_time_utc"],
            }
    raise AssertionError("Published generation did not settle for the read-only fixture")


SHIM = r"""
(() => {
  const source=__SOURCE__, NativeDate=Date;
  const f=window.__chainFixture={source,sockets:[],feeds:[],controllers:{},requests:[],errors:[],
    now:Date.parse(source.at)+120000,height:source.height+2,version:0,apiFail:false,socketFail:false,
    changes:0,panels:[],paints:[],publicationReads:0,exportFrames:[],exports:0,releaseExport:null};
  localStorage.clear();
  window.Date=class extends NativeDate {constructor(...args){super(...(args.length?args:[f.now]));}static now(){return f.now;}};
  const hash=(height)=>BigInt(height+f.version*10000000).toString(16).padStart(64,'0');
  f.block=(height)=>({height,id:hash(height),previousblockhash:hash(height-1),timestamp:
    Math.floor(Date.parse(source.at)/1000)+(height-source.height)*600+f.version*5});
  const json=value=>new Response(JSON.stringify(value),{headers:{'Content-Type':'application/json'}});
  const nativeFetch=window.fetch.bind(window);
  f.referenceReady=(async()=>{
    const count=128,start=source.height-210000-8,bytes=new Uint8Array(count*16),view=new DataView(bytes.buffer);
    for(let i=0;i<count;i++){
      view.setUint32(i*16,1668284000+i*60,true);view.setUint32(i*16+4,1668284000+i*60,true);
      view.setFloat64(i*16+8,17000+i*25,true);
    }
    const digest=await crypto.subtle.digest('SHA-256',bytes),sha=Array.from(new Uint8Array(digest),v=>v.toString(16).padStart(2,'0')).join('');
    f.reference=bytes;
    f.manifest={schema_version:1,chunk_size:4096,record_bytes:16,first_height:start,last_height:start+count-1,
      chunks:[{start,count,path:'fixture.bin',sha256:sha}]};
  })();
  window.fetch=async(input,options={})=>{
    const url=new URL(typeof input==='string'?input:input.url,location.href),path=url.pathname;
    f.requests.push(url.href);
    if(url.hostname==='mempool.space'){
      if(f.apiFail)return new Response('Offline fixture',{status:503});
      if(path==='/api/blocks'||/^\/api\/(v1\/)?blocks\/\d+$/.test(path)){
        const height=path==='/api/blocks'?f.height:Number(path.split('/').at(-1));
        return json(Array.from({length:15},(_,i)=>f.block(height-i)));
      }
      if(/^\/api\/block-height\/\d+$/.test(path))return new Response(hash(Number(path.split('/').at(-1))));
      if(/^\/api\/block\/[a-f0-9]{64}$/.test(path)){
        const height=Number(BigInt('0x'+path.split('/').at(-1)))-f.version*10000000;
        return json(f.block(height));
      }
      throw new Error('Unmocked mempool fixture endpoint '+url.href);
    }
    if(url.origin!==location.origin)throw new Error('External request blocked by fixture: '+url.origin);
    if(f.publicationPayloads?.has(path))return new Response(f.publicationPayloads.get(path),{headers:{'Content-Type':'application/json'}});
    if(path.endsWith('/eoe_growth/webapp_data/reference/manifest.json')){await f.referenceReady;return json(f.manifest);}
    if(path.endsWith('/eoe_growth/webapp_data/reference/fixture.bin')){await f.referenceReady;return new Response(f.reference.slice());}
    if(path.includes('/webapp_data/')||path.startsWith('/assets/'))f.publicationReads++;
    return nativeFetch(input,options);
  };
  f.publish=async()=>{
    const prefix='/webapps/issuance_rate/webapp_data/';
    const [data,preview,marker]=await Promise.all(['issuance_rate_data.json','issuance_rate_preview.json','published_generation.json'].map(async name=>(await nativeFetch(prefix+name)).json()));
    const stamp=new Date(f.now+1000).toISOString();data.generated_utc=preview.generated_utc=marker.generated_utc=stamp;
    const text=JSON.stringify(data),previewText=JSON.stringify(preview);
    const sha=async value=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value))),v=>v.toString(16).padStart(2,'0')).join('');
    marker.data_sha256=await sha(text);marker.preview_sha256=marker.preview.sha256=await sha(previewText);
    f.publicationPayloads=new Map([[prefix+'issuance_rate_data.json',text],[prefix+'issuance_rate_preview.json',previewText],[prefix+'published_generation.json',JSON.stringify(marker)]]);
    return stamp;
  };
  class Socket {
    static CONNECTING=0;static OPEN=1;static CLOSING=2;static CLOSED=3;
    constructor(url){this.url=String(url);this.readyState=0;f.sockets.push(this);setTimeout(()=>{
      if(f.socketFail){this.readyState=3;this.onclose?.({});return;}
      this.readyState=1;this.onopen?.({});
    },0);}
    send(message){const value=JSON.parse(message);if(value.action==='ping')setTimeout(()=>this.message({pong:true}),0);}
    message(value){if(this.readyState===1)this.onmessage?.({data:JSON.stringify(value)});}
    close(){this.readyState=3;}
    disconnect(){this.readyState=3;this.onclose?.({});}
  }
  window.WebSocket=Socket;
  f.push=(height,{authoritative=false,reorg=false}={})=>{
    f.height=height;if(reorg)f.version++;
    f.now=Math.max(f.now,f.block(height).timestamp*1000+60000);
    const message=authoritative?{blocks:[f.block(height),f.block(height-1)]}:{block:f.block(height)};
    f.sockets.filter(socket=>socket.url.includes('mempool.space')&&socket.readyState===1).forEach(socket=>socket.message(message));
    return message;
  };
  f.setVisibility=visible=>{
    f.visible=visible;
    Object.defineProperty(document,'visibilityState',{configurable:true,get:()=>f.visible?'visible':'hidden'});
    Object.defineProperty(document,'hidden',{configurable:true,get:()=>!f.visible});
    document.dispatchEvent(new Event('visibilitychange'));
  };
  function intercept(name,wrap){Object.defineProperty(window,name,{configurable:true,set(api){
    Object.defineProperty(window,name,{configurable:true,writable:true,value:wrap(api)});
  }});}
  intercept('WSBBitcoinChainTip',api=>({...api,create(options){const feed=api.create(options);f.feeds.push(feed);return feed;}}));
  intercept('WSBBitcoinSpotPrice',api=>({...api,create({onQuote}){
    let price=100000;
    const quote=()=>({price,at:f.now,receivedAt:f.now,source:'Isolated quote'});
    f.deliverQuote=value=>{price=value;f.now++;onQuote?.(quote());};
    return {start(){onQuote?.(quote());},stop(){},newerThan(at){return f.now>(typeof at==='number'?at:Date.parse(at))?quote():null;},
      isLive(){return true;},current:quote,last:quote};
  }}));
  for(const [name,key] of [['WSBEOEGrowthLive','eoe'],['WSBIssuanceLive','issuance']])intercept(name,api=>({...api,
    projectRows:api.projectRows&&((...args)=>{const rows=api.projectRows(...args);f.projection={date:rows.at(-1)?.date,height:rows.at(-1)?.height,length:rows.length,publishedLength:args[0].rows.length,publishedDate:args[0].rows.at(-1)?.date,provisional:!!rows.at(-1)?.provisional};return rows;}),
    create(options){
    const onChange=options?.onChange,adapter=api.create({...options,onChange(...args){f.changes++;onChange?.(...args);}});
    f.controllers[key]=adapter;return adapter;
  }}));
  intercept('WSBEOEGrowthCharts',api=>{const panel=api.panel;api.panel=(ctx,rect,options)=>{
    const result=panel(ctx,rect,options);
    f.paints.push({at:performance.now(),height:options.frame?.row?.height,price:options.frame?.row?.price});
    f.panels.push({height:options.frame?.row?.height,current:!!options.frame?.current,
      referenceHeight:options.frame?.row?.referenceHeight,previousPrice:options.frame?.row?.previousPrice,blockTime:options.frame?.row?.blockTime});
    return result;};return api;});
  const anchorClick=HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click=function(){if(this.download){f.exports++;return;}return anchorClick.call(this);};
  window.addEventListener('error',event=>f.errors.push(event.message));
  window.addEventListener('unhandledrejection',event=>f.errors.push(String(event.reason?.stack||event.reason)));
})();
"""


def evaluate(cdp, expression):
    return cdp.evaluate("(() => { const f=window.__chainFixture; " + expression + " })()")


def wait_expr(cdp, expression, description):
    wait_for(lambda: evaluate(cdp, expression), timeout=90, description=description)


def set_value(cdp, selector, value, event="input"):
    evaluate(cdp, "const input=document.querySelector(" + json.dumps(selector) + ");input.value=" + json.dumps(str(value))
             + ";input.dispatchEvent(new Event(" + json.dumps(event) + ",{bubbles:true}));")


def pushed(cdp, height, **options):
    evaluate(cdp, "return f.push(" + str(height) + "," + json.dumps(options) + ");")


def check_eoe(cdp, preview):
    wait_expr(cdp, "return f.panels.some(p=>p.current);", "EOE initial direct-block point")
    height = evaluate(cdp, "return f.height;")
    wait_expr(cdp, f"return f.panels.at(-1)?.height==={height};", "EOE initial mempool height")
    before = evaluate(cdp, "return JSON.stringify(window.WSBEOEGrowthDashboard?.getModel().rows||null);")
    anchor_reads = evaluate(cdp, "return f.requests.filter(url=>new URL(url).pathname==='/assets/top_kpis.json').length;")
    check_eoe_paint_latency(cdp, height + 1, preview)
    wait_expr(cdp, f"return f.panels.at(-1)?.height==={height+1};", "EOE pushed block without publication")
    shown = evaluate(cdp, "return f.panels.at(-1);")
    assert evaluate(cdp, "return f.requests.filter(url=>new URL(url).pathname==='/assets/top_kpis.json').length;") == anchor_reads
    selector = "#eoeGrowthPreview" if preview else "#chipUpdated"
    assert evaluate(cdp, "return document.querySelector(" + json.dumps(selector) + ").dataset.chainSource;") == "live"
    assert shown["referenceHeight"] == height + 1 - 210000, shown
    assert shown["previousPrice"] == 17000 + (height + 1 - evaluate(cdp, "return f.source.height;") + 8) * 25
    assert evaluate(cdp, "return JSON.stringify(window.WSBEOEGrowthDashboard?.getModel().rows||null);") == before
    if not preview:
        check_eoe_resize_release(cdp, height + 2)
        height += 1
        last = evaluate(cdp, "return window.WSBEOEGrowthDashboard.getModel().rows.length-1;")
        evaluate(cdp, "document.querySelector('#playBtn').click();document.querySelector('#pauseBtn').click();")
        set_value(cdp, "#dateRangeEndSlider", last - 5)
        historical = evaluate(cdp, "return JSON.stringify(window.WSBEOEGrowthDashboard.getFrame());")
        pushed(cdp, height + 2)
        time.sleep(1.2)
        assert evaluate(cdp, "return JSON.stringify(window.WSBEOEGrowthDashboard.getFrame());") == historical
        evaluate(cdp, "document.querySelector('#stopBtn').click();")
        wait_expr(cdp, f"return f.panels.at(-1)?.height==={height+2};", "EOE Stop restores newest block")
    else:
        pushed(cdp, height + 2)
        wait_expr(cdp, f"return f.panels.at(-1)?.height==={height+2};", "EOE preview next block")
    current_height = height + 2
    if not preview:
        check_eoe_export(cdp, height + 3)
        current_height = height + 3
    pushed(cdp, current_height, authoritative=True, reorg=True)
    replacement_time = evaluate(cdp, "return f.block(f.height).timestamp*1000;")
    wait_expr(cdp, f"return f.panels.at(-1)?.blockTime==={replacement_time};", "EOE same-height replacement timestamp")
    pushed(cdp, current_height - 1, authoritative=True, reorg=True)
    wait_expr(cdp, f"return f.panels.at(-1)?.height==={current_height-1};", "EOE authoritative shorter replacement")
    evaluate(cdp, "return f.controllers.eoe.refresh();")
    assert evaluate(cdp, "return f.panels.at(-1).height;") == current_height - 1, "stale published anchor rewound the live pair"
    check_lifecycle(cdp, "eoe", "return f.panels.at(-1)?.height;", current_height - 1)



def check_eoe_paint_latency(cdp, next_height, preview):
    # Prime a real quote-driven paint, then prove a quote burst stays batched.
    evaluate(cdp, "f.deliverQuote(100001);")
    wait_expr(cdp, "return f.paints.at(-1)?.price===100001;", "EOE priming quote paint")
    evaluate(cdp, "f.burstStart=f.paints.length;f.burstAt=performance.now();[100002,100003,100004].forEach(f.deliverQuote);")
    time.sleep(.2)
    assert evaluate(cdp, "return f.paints.length===f.burstStart;"), "price-only ticks bypassed the repaint batch"
    wait_expr(cdp, "return f.paints.at(-1)?.price===100004;", "EOE batched latest quote")
    assert evaluate(cdp, "return f.paints.length-f.burstStart;") == 1, "price burst caused multiple paints"
    # Queue another quote inside the new throttle window, then deliver one block.
    # There is no later quote to wake the chart: the validated pair must do it.
    evaluate(cdp, "f.beforeBlockPaints=f.paints.length;f.deliverQuote(100005);f.blockAt=performance.now();f.push(" + str(next_height) + ");")
    wait_expr(cdp, f"return f.paints.at(-1)?.height==={next_height};", "EOE block bypasses pending quote repaint")
    measurement = evaluate(cdp, "const paint=f.paints.slice(f.beforeBlockPaints).find(p=>p.height===" + str(next_height) + ");return {block_ms:paint.at-f.blockAt,quote_batch_ms:f.paints[f.burstStart].at-f.burstAt,price:paint.price};")
    print(f"EOE {'preview' if preview else 'dashboard'} paint timing: {json.dumps(measurement)}", flush=True)
    assert measurement["block_ms"] < 400, f"block waited behind quote repaint: {measurement}"
    assert measurement["price"] == 100005, "block paint did not include the pending newest quote"
    time.sleep(1.15)
    assert evaluate(cdp, "return f.paints.length-f.beforeBlockPaints;") == 1, "canceled quote timer repainted after the block"


def check_eoe_resize_release(cdp, next_height):
    evaluate(cdp, "document.querySelector('#chartsResizeHandle').scrollIntoView({block:'center'});")
    point = evaluate(cdp, "const r=document.querySelector('#chartsResizeHandle').getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};")
    cdp.command("Input.dispatchMouseEvent", {"type":"mousePressed",**point,"button":"left","buttons":1,"clickCount":1})
    point["y"] += 20
    cdp.command("Input.dispatchMouseEvent", {"type":"mouseMoved",**point,"button":"left","buttons":1})
    evaluate(cdp, "f.resizeHeldFrame=JSON.stringify(window.WSBEOEGrowthDashboard.getFrame());f.resizeHeldPaints=f.paints.length;")
    pushed(cdp, next_height)
    wait_expr(cdp, f"return f.controllers.eoe.current()?.tip.height==={next_height};", "EOE complete block while resize is held")
    assert evaluate(cdp, "return JSON.stringify(window.WSBEOEGrowthDashboard.getFrame())===f.resizeHeldFrame&&f.paints.length===f.resizeHeldPaints;"), "block painted during resize"
    evaluate(cdp, "f.resizeReleaseAt=performance.now();")
    cdp.command("Input.dispatchMouseEvent", {"type":"mouseReleased",**point,"button":"left","buttons":0,"clickCount":1})
    wait_expr(cdp, f"return f.paints.at(-1)?.height==={next_height};", "EOE resize release paints retained block")
    lag = evaluate(cdp, "return f.paints.find((p,i)=>i>=f.resizeHeldPaints&&p.height===" + str(next_height) + ").at-f.resizeReleaseAt;")
    assert lag < 400, f"resize release did not immediately flush the block: {lag} ms"
    print(f"EOE resize release paint: {lag:.1f} ms", flush=True)


def check_eoe_export(cdp, next_height):
    evaluate(cdp, """
      f.nativeEncoder=window.WSBDashboardExport.encodeVideo;
      window.WSBDashboardExport.encodeVideo=async options=>{
        f.exportOptions=options;
        await new Promise(resolve=>f.releaseExport=resolve);
        return new Blob(['isolated export policy fixture'],{type:'video/webm'});
      };
      document.querySelector('#dateRangeDownloadBtn').click();
    """)
    wait_expr(cdp, "return !!f.releaseExport;", "EOE export freeze")
    evaluate(cdp, """
      return(async()=>{
        const options=f.exportOptions,index=options.frames.length-1;
        await options.renderFrame(options.frames[index],options.canvas,index);
        f.exportPixels=options.canvas.toDataURL();
        f.visibleDuringExport=document.querySelector('#epochChart').toDataURL();
      })();
    """)
    pushed(cdp, next_height)
    wait_expr(cdp, f"return f.controllers.eoe.current({{publishedAt:f.source.at,latestHeight:f.source.height}})?.tip.height==={next_height};", "EOE accepted block during export")
    time.sleep(1.1)
    assert evaluate(cdp, "return document.querySelector('#epochChart').toDataURL()===f.visibleDuringExport;")
    assert evaluate(cdp, "return(async()=>{const o=f.exportOptions,i=o.frames.length-1;await o.renderFrame(o.frames[i],o.canvas,i);return o.canvas.toDataURL()===f.exportPixels;})();"), "new block changed the frozen ending frame"
    evaluate(cdp, "f.releaseExport();")
    wait_expr(cdp, "return f.exports===1;", "EOE isolated export completion")
    wait_expr(cdp, f"return window.WSBEOEGrowthDashboard.getFrame().row.height==={next_height};", "EOE latest block after export")
    evaluate(cdp, "window.WSBDashboardExport.encodeVideo=f.nativeEncoder;")


def check_lifecycle(cdp, key, expression, expected):
    retained = evaluate(cdp, "return JSON.stringify(f.controllers.issuance?.current()?.row||f.panels.at(-1));")
    evaluate(cdp, "f.apiFail=true;f.socketFail=true;f.sockets.forEach(s=>s.disconnect());")
    evaluate(cdp, "f.feeds.forEach(feed=>feed.refresh());")
    time.sleep(.4)
    assert evaluate(cdp, expression) == expected, "REST failure replaced the last complete result"
    assert evaluate(cdp, "return JSON.stringify(f.controllers.issuance?.current()?.row||f.panels.at(-1));") == retained
    evaluate(cdp, "f.setVisibility(false);window.dispatchEvent(new Event('pagehide'));")
    pushed(cdp, expected + 1)
    assert evaluate(cdp, expression) == expected, "hidden feed changed the presented snapshot"
    evaluate(cdp, "f.apiFail=false;f.socketFail=false;f.setVisibility(true);window.dispatchEvent(new Event('pageshow'));")
    wait_expr(cdp, "return f.sockets.some(s=>s.url.includes('mempool.space')&&s.readyState===1);", "feed reconnect after tab resume")
    wait_expr(cdp, expression.replace(";", f"==={expected+1};"), "complete latest block after tab resume")
    assert not evaluate(cdp, "return document.body.innerText.includes('Live connection unavailable');")
    assert evaluate(cdp, "return f.errors;") == [], evaluate(cdp, "return f.errors;")


def check_issuance(cdp, preview):
    selector = "#issuancePreview" if preview else "#issuanceChart"
    chart_height = "return Number(document.querySelector(" + json.dumps(selector) + ")?.dataset.liveHeight||0);"
    wait_expr(cdp, "return !!f.controllers.issuance?.current();", "Issuance validated rolling block window")
    height = evaluate(cdp, "return f.height;")
    wait_expr(cdp, chart_height.replace(";", f"==={height};"), "Issuance initial live chart")
    published_reads = evaluate(cdp, "return f.publicationReads;")
    pushed(cdp, height + 1)
    wait_expr(cdp, chart_height.replace(";", f"==={height+1};"), "Issuance pushed block without publication")
    current = evaluate(cdp, "return f.controllers.issuance.current();")
    row = current["row"]
    assert row["height"] == height + 1 and current["tip"]["height"] == height + 1
    assert row["timezone_blocks"] == height + 1 - current["boundary"]["height"]
    assert abs(row["daily_issuance"] - row["timezone_blocks"] * row["subsidy"]) < 1e-9
    assert abs(row["issuance_rate"] - row["daily_issuance"] * 365 / row["supply"]) < 1e-9
    assert evaluate(cdp, "return f.publicationReads;") == published_reads, "block arrival refetched published history"
    if not preview:
        assert str(height + 1) == evaluate(cdp, "return document.querySelector('#chipHeight .chip-value').textContent.replaceAll(',','').trim();")
        latest = evaluate(cdp, "return document.querySelector('#dateRangeEndInput').value;")
        earlier = evaluate(cdp, "const date=new Date(document.querySelector('#dateRangeEndInput').value+'T00:00:00Z');date.setUTCDate(date.getUTCDate()-5);return date.toISOString().slice(0,10);")
        set_value(cdp, "#dateRangeEndInput", earlier, "change")
        time.sleep(.2)
        evaluate(cdp, "f.historicalCanvas=document.querySelector('#issuanceChart').toDataURL();f.historicalHeight=document.querySelector('#chipHeight').textContent;")
        pushed(cdp, height + 2)
        wait_expr(cdp, f"return f.controllers.issuance.current()?.tip.height==={height+2};", "Issuance hidden historical overlay catch-up")
        time.sleep(.2)
        assert evaluate(cdp, "return document.querySelector('#issuanceChart').toDataURL()===f.historicalCanvas&&document.querySelector('#chipHeight').textContent===f.historicalHeight;")
        set_value(cdp, "#dateRangeEndInput", latest, "change")
        wait_expr(cdp, chart_height.replace(";", f"==={height+2};"), "Issuance latest selection restores live")
        evaluate(cdp, "f.beforePlaybackCanvas=document.querySelector('#issuanceChart').toDataURL();document.querySelector('#dateRangePlayBtn').click();document.querySelector('#dateRangePauseBtn').click();")
        assert evaluate(cdp, "return document.querySelector('#issuanceChart').toDataURL()!==f.beforePlaybackCanvas&&document.querySelector('#dateRangePauseBtn').classList.contains('is-paused')&&Number(document.querySelector('#chipHeight .chip-value').textContent.replaceAll(',','').trim())<" + str(height) + ";"), "immediate pause left the latest chart paired with historical KPIs"
        evaluate(cdp, "f.pausedCanvas=document.querySelector('#issuanceChart').toDataURL();f.pausedHeight=document.querySelector('#chipHeight').textContent;")
        pushed(cdp, height + 3)
        wait_expr(cdp, f"return f.controllers.issuance.current()?.tip.height==={height+3};", "Issuance accepted block during paused playback")
        time.sleep(.2)
        assert evaluate(cdp, "return document.querySelector('#issuanceChart').toDataURL()===f.pausedCanvas&&document.querySelector('#chipHeight').textContent===f.pausedHeight;")
        stamp = evaluate(cdp, "return f.publish();")
        evaluate(cdp, "window.WSBWebappDataAutoRefresh.requestCheck('fixture-new-publication');")
        wait_expr(cdp, "return JSON.parse(window.WSBWebappDataAutoRefresh.getStatus().acceptedSignature||'{}').generated_utc===" + json.dumps(stamp) + ";", "new publication during paused historical view")
        assert evaluate(cdp, "return document.querySelector('#issuanceChart').toDataURL()===f.pausedCanvas&&document.querySelector('#chipHeight').textContent===f.pausedHeight;"), "new publication changed paused historical selection"
        evaluate(cdp, "document.querySelector('#dateRangeStopBtn').click();")
        wait_expr(cdp, chart_height.replace(";", f"==={height+3};"), "Issuance Stop restores latest block")
        check_issuance_export(cdp, chart_height, height + 4)
        current_height = height + 4
    else:
        pushed(cdp, height + 2)
        wait_expr(cdp, chart_height.replace(";", f"==={height+2};"), "Issuance preview next block")
        current_height = height + 2
    pushed(cdp, current_height, authoritative=True, reorg=True)
    replacement = evaluate(cdp, "return f.block(f.height).id;")
    wait_expr(cdp, "return f.controllers.issuance.current()?.tip.id===" + json.dumps(replacement) + ";", "Issuance same-height replacement window")
    pushed(cdp, current_height - 1, authoritative=True, reorg=True)
    wait_expr(cdp, chart_height.replace(";", f"==={current_height-1};"), "Issuance shorter authoritative chain")
    check_lifecycle(cdp, "issuance", chart_height, current_height - 1)
    check_issuance_rollover(cdp, chart_height, preview)


def check_issuance_rollover(cdp, chart_height, preview):
    next_height = evaluate(cdp, "return f.height+1;")
    day = evaluate(cdp, "const date=new Date(f.now);date.setUTCHours(24,0,0,0);f.now=date.getTime()+60000;return date.toISOString().slice(0,10);")
    pushed(cdp, next_height)
    wait_expr(cdp, chart_height.replace(";", f"==={next_height};"), "Issuance UTC rollover live row")
    projection = evaluate(cdp, "return f.projection;")
    assert projection["date"] == day and projection["date"] > projection["publishedDate"], projection
    assert projection["length"] == projection["publishedLength"] + 1 and projection["provisional"], projection
    miner_day = evaluate(cdp, "return new Date(f.block(f.height).timestamp*1000).toISOString().slice(0,10);")
    assert miner_day < day, "fixture must distinguish wall-clock day from miner timestamp day"
    if not preview:
        assert evaluate(cdp, "return document.querySelector('#dateRangeEndInput').value;") == day
    pushed(cdp, next_height + 1)
    wait_expr(cdp, chart_height.replace(";", f"==={next_height+1};"), "second block on the provisional day")
    assert evaluate(cdp, "return f.projection.length;") == projection["length"], "each block appended another provisional row"


def check_issuance_export(cdp, chart_height, next_height):
    evaluate(cdp, """
      f.nativeEncoder=window.WSBDashboardExport.encodeVideo;
      window.WSBDashboardExport.encodeVideo=async options=>{
        f.exportOptions=options;
        await new Promise(resolve=>f.releaseExport=resolve);
        return new Blob(['isolated export policy fixture'],{type:'video/webm'});
      };
      document.querySelector('#dateRangeDownloadBtn').click();
    """)
    wait_expr(cdp, "return !!f.releaseExport;", "Issuance export freeze")
    evaluate(cdp, """
      return(async()=>{
        await f.exportOptions.renderFrame(f.exportOptions.frames.at(-1));
        f.exportPixels=f.exportOptions.canvas.__exportChartCanvas.toDataURL();
        f.visibleDuringExport=document.querySelector('#issuanceChart').toDataURL();
      })();
    """)
    pushed(cdp, next_height)
    wait_expr(cdp, f"return f.controllers.issuance.current()?.tip.height==={next_height};", "Issuance new tip during export")
    time.sleep(.2)
    assert evaluate(cdp, "return document.querySelector('#issuanceChart').toDataURL()===f.visibleDuringExport;")
    assert evaluate(cdp, "return(async()=>{await f.exportOptions.renderFrame(f.exportOptions.frames.at(-1));return f.exportOptions.canvas.__exportChartCanvas.toDataURL()===f.exportPixels;})();"), "live block altered a frozen export frame"
    evaluate(cdp, "f.releaseExport();")
    wait_expr(cdp, "return f.exports===1;", "Issuance isolated export completion")
    wait_expr(cdp, chart_height.replace(";", f"==={next_height};"), "Issuance live presentation after export")
    evaluate(cdp, "window.WSBDashboardExport.encodeVideo=f.nativeEncoder;")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("targets", nargs="*", choices=["eoe_growth", "issuance_rate"])
    parser.add_argument("--preview-only", action="store_true")
    args = parser.parse_args()
    targets = args.targets or ["eoe_growth", "issuance_rate"]
    if not Path(CHROME).is_file():
        raise SystemExit("Chrome not found; set CHROME_BIN")
    source = freeze_data()
    handler = lambda *args, **kwargs: FrozenHandler(*args, directory=str(ROOT), **kwargs)
    server = ThreadingHTTPServer(("127.0.0.1", 0), handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    with tempfile.TemporaryDirectory(prefix="wsb-chain-live-browser-") as profile:
        port = free_port()
        with open(Path(profile) / "chrome.log", "w+") as log:
            chrome = subprocess.Popen([CHROME, "--headless=new", "--disable-gpu", "--disable-dev-shm-usage",
                "--no-first-run", "--no-default-browser-check", "--disable-background-networking",
                "--remote-allow-origins=*", f"--remote-debugging-port={port}", f"--user-data-dir={profile}", "about:blank"],
                stdout=log, stderr=log)
            cdp = None
            try:
                wait_for(lambda: urllib.request.urlopen(f"http://127.0.0.1:{port}/json/version", timeout=.5).read(), description="Chrome endpoint")
                request = urllib.request.Request(f"http://127.0.0.1:{port}/json/new?about:blank", method="PUT")
                target = json.load(urllib.request.urlopen(request, timeout=2))
                cdp = CdpSocket(target["webSocketDebuggerUrl"])
                cdp.command("Page.enable")
                cdp.command("Runtime.enable")
                cdp.command("Emulation.setDeviceMetricsOverride", {"width":1440,"height":1000,"deviceScaleFactor":1,"mobile":False})
                cdp.command("Page.addScriptToEvaluateOnNewDocument", {"source":SHIM.replace("__SOURCE__",json.dumps(source))})
                for slug in targets:
                    for preview in ((True,) if args.preview_only else (False, True)):
                        page = "preview.html" if preview else "dashboard.html"
                        print(f"Testing direct blocks: {slug}/{page}...", flush=True)
                        cdp.command("Page.navigate", {"url":f"http://127.0.0.1:{server.server_port}/webapps/{slug}/{page}"})
                        try:
                            (check_eoe if slug == "eoe_growth" else check_issuance)(cdp, preview)
                        except Exception:
                            print(evaluate(cdp, "return {errors:f.errors,panels:f.panels.slice(-4),requests:f.requests.slice(-12),body:document.body.innerText.slice(-1200)};"), flush=True)
                            raise
                        print(f"Passed: {slug}/{page}", flush=True)
            finally:
                if cdp:
                    try: cdp.sock.close()
                    except OSError: pass
                chrome.terminate()
                try: chrome.wait(timeout=5)
                except subprocess.TimeoutExpired: chrome.kill(); chrome.wait(timeout=5)
                server.shutdown()
                server.server_close()


if __name__ == "__main__":
    main()
