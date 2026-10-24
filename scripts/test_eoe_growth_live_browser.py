#!/usr/bin/env python3
"""Isolated EOE live reference, playback, and export snapshot regression tests."""

import argparse
import json
from pathlib import Path
import subprocess
import tempfile
import threading
import urllib.request
from http.server import ThreadingHTTPServer

from test_eoe_growth_browser import (
    ROOT, CHROME, FIXTURE, FrozenHandler, CdpSocket, free_port, wait_for,
    freeze_data, dashboard, navigate, click, set_input, state, assert_clean,
    choose, export_blob, RECORD_EXPORT,
)


LIVE_FIXTURE = r"""
(() => {
  const source=__SOURCE__;
  const f=window.__eoeLiveFixture={requests:{},mode:'pass',pending:[],chunks:new Map(),renders:[],
    generation:0,referenceCount:64,refreshes:[],now:source.at+120000,first:source.height-210000,tip:{block_height:source.height+2,
    block_time_utc:new Date(source.at+60000).toISOString()}};
  const NativeDate=Date;
  window.Date=class extends NativeDate {constructor(...args){super(...(args.length?args:[f.now]));}static now(){return f.now;}};
  f.last={price:100000.25,at:f.now,receivedAt:f.now,source:'Isolated quote'};
  f.emit=(price=f.last.price,advance=1000)=>{
    f.now+=advance;f.last={price,at:f.now,receivedAt:f.now,source:'Isolated quote'};f.onQuote?.(f.last);
  };
  f.publish=async generation=>{
    const bytes=new Uint8Array(f.referenceCount*16),view=new DataView(bytes.buffer);
    for(let i=0;i<f.referenceCount;i++){
      view.setUint32(i*16,1668284000+i*60,true);
      view.setUint32(i*16+4,Math.round((1668284000+i*60)/600)*600,true);
      view.setFloat64(i*16+8,17000.125+i*10+generation*1000,true);
    }
    const digest=await crypto.subtle.digest('SHA-256',bytes),sha=Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,'0')).join('');
    const path=`${f.first}-${sha.slice(0,16)}.bin`;
    f.chunks.set(path,bytes);f.generation=generation;
    f.manifest={schema_version:1,chunk_size:4096,record_bytes:16,first_height:f.first,last_height:f.first+f.referenceCount-1,
      chunks:[{start:f.first,count:f.referenceCount,path,sha256:sha}]};
  };
  f.expected=()=>({price:f.last.price,height:f.tip.block_height,
    reference:17000.125+(f.tip.block_height-210000-f.first)*10+f.generation*1000});
  f.advance=async price=>{
    f.emit(price);f.tip={block_height:f.tip.block_height+1,block_time_utc:new Date(f.now).toISOString()};
    await f.publish(f.generation+1);
  };
  f.ready=f.publish(0);
  const nativeFetch=window.fetch.bind(window);
  window.fetch=async(input,options)=>{
    const url=new URL(typeof input==='string'?input:input.url,location.href),path=url.pathname;
    f.requests[path]=(f.requests[path]||0)+1;
    if(path==='/assets/top_kpis.json'||path.endsWith('/reference/manifest.json')){
      await f.ready;
      if(f.mode==='fail')return new Response('Unavailable',{status:503});
      return new Response(JSON.stringify(path==='/assets/top_kpis.json'?f.tip:f.manifest),{status:200});
    }
    if(path.includes('/reference/')&&path.endsWith('.bin')){
      await f.ready;
      const payload=f.chunks.get(path.split('/').at(-1))?.slice();
      if(f.mode==='hold')await new Promise(resolve=>f.pending.push(resolve));
      if(!payload)return new Response('Missing',{status:404});
      if(f.mode==='corrupt')payload[0]^=1;
      return new Response(payload,{status:200});
    }
    return nativeFetch(input,options);
  };
  Object.defineProperty(window,'WSBBitcoinSpotPrice',{configurable:true,set(api){
    Object.defineProperty(window,'WSBBitcoinSpotPrice',{configurable:true,writable:true,value:{...api,create({onQuote}){
      f.onQuote=onQuote;
      return {start(){onQuote(f.last);},stop(){},newerThan(at){return !f.noQuote&&f.last.at>(typeof at==='number'?at:Date.parse(at))?{...f.last}:null;},
        isLive(q){return f.now-(q.receivedAt??q.at)<60000;},current(){return {...f.last};},last(){return {...f.last};}};
    }}});
  }});
  Object.defineProperty(window,'WSBEOEGrowthLive',{configurable:true,set(api){
    const create=api.create;
    api.create=options=>{const controller=create(options),refresh=controller.refresh;
      controller.refresh=(...args)=>{f.refreshes.push({position:f.position??-1,quote:f.last.price,height:f.tip.block_height});return refresh(...args);};
      f.controller=controller;return controller;};
    Object.defineProperty(window,'WSBEOEGrowthLive',{configurable:true,writable:true,value:api});
  }});
})();
"""


def live(cdp, expression):
    return dashboard(cdp, "const f=w.__eoeLiveFixture;" + expression)


def displayed(cdp):
    return dashboard(cdp, """
      const view=w.WSBEOEGrowthDashboard.getFrame();return {row:view.row,current:view.current,
        markers:view.epochs.map(group=>({epoch:group.epoch,marker:group.marker})),
        price:d.querySelector('#priceKpi').textContent,previous:d.querySelector('#previousPriceKpi').textContent,
        growth:d.querySelector('#growthKpi').textContent,updated:d.querySelector('#updatedKpi').textContent,
        updatedTitle:d.querySelector('#chipUpdated').title,source:d.querySelector('#priceChip').dataset.priceSource,
        dot:d.querySelector('#priceLiveStatus').dataset.kind};
    """)


def wait_price(cdp, value):
    wait_for(lambda: displayed(cdp)["row"]["price"] == value, description=f"EOE price {value}")


def check_current(cdp):
    wait_for(lambda: displayed(cdp).get("current"), description="complete live reference tuple")
    shown = displayed(cdp)
    tip = live(cdp, "return f.tip.block_height;")
    assert shown["row"]["height"] == tip
    assert shown["row"]["previousPrice"] == 17020.125
    assert shown["row"]["referenceHeight"] == tip - 210000
    assert abs(shown["row"]["growth"] - (100000.25 / 17020.125 - 1) * 100) < 1e-9
    assert shown["source"] == "live" and shown["dot"] == "live", shown
    markers = {row["epoch"]: row["marker"] for row in shown["markers"]}
    epoch = shown["row"]["epoch"]
    assert markers[epoch]["height"] == tip and markers[epoch]["price"] == 100000.25
    assert markers[epoch - 1]["height"] == tip - 210000 and markers[epoch - 1]["price"] == 17020.125
    assert dashboard(cdp, "return !d.querySelector('#dateKpi')&&![...d.querySelectorAll('.chip-label')].some(e=>e.textContent.trim()==='Date');")
    assert f"{tip:,}" in shown["updated"] and "Quote time:" in shown["updatedTitle"] and "mined" in shown["updatedTitle"]
    assert dashboard(cdp, """
      const row=w.WSBEOEGrowthDashboard.getFrame().row,G=w.WSBEOEGrowthCharts;
      return d.querySelector('#priceKpi').textContent===G.kpiMoney(row.price)
        &&d.querySelector('#previousPriceKpi').textContent===G.kpiMoney(row.previousPrice)
        &&d.querySelector('#growthKpi').textContent===G.growthLabel(row.growth);
    """)
    before = live(cdp, "return {...f.requests};")
    live(cdp, "f.emit(100123.5);f.emit(100456.75);f.emit(100999.25);")
    wait_price(cdp, 100999.25)
    dashboard(cdp, "d.documentElement.dataset.theme='light';d.dispatchEvent(new w.CustomEvent('dashboard-theme-change'));w.dispatchEvent(new w.Event('resize'));")
    assert live(cdp, "return {...f.requests};") == before, "quotes/theme/resize fetched a reference again"
    shown = displayed(cdp)
    assert live(cdp, "return new Date(f.last.at).toISOString();") in shown["updatedTitle"]
    live(cdp, "f.now+=61000;f.onQuote(null);")
    wait_for(lambda: displayed(cdp)["source"] == "retained", description="retained quote status")
    assert displayed(cdp)["dot"] == "stale" and displayed(cdp)["row"]["price"] == 100999.25
    live(cdp, "f.emit(101000);")
    wait_price(cdp, 101000)
    print("PASS live: exact height/time reference, matching KPIs/markers, freshness, Updated time, no Date chip, cached redraws", flush=True)


def check_playback(cdp):
    last = dashboard(cdp, "return w.WSBEOEGrowthDashboard.getModel().rows.length-1;")
    original = dashboard(cdp, "return JSON.stringify(w.WSBEOEGrowthDashboard.getModel().rows);")
    click(cdp, "#playBtn")
    click(cdp, "#pauseBtn")
    set_input(cdp, "#dateRangeEndSlider", last)
    assert not displayed(cdp).get("current") and displayed(cdp)["source"] == "published"
    value = displayed(cdp)["row"]["price"]
    live(cdp, "f.emit(102000);")
    assert displayed(cdp)["row"]["price"] == value
    set_input(cdp, "#dateRangeEndSlider", last - 4)
    assert displayed(cdp)["row"]["index"] == last - 4 and not displayed(cdp).get("current")
    click(cdp, "#stopBtn")
    wait_price(cdp, 102000)
    assert dashboard(cdp, "return JSON.stringify(w.WSBEOEGrowthDashboard.getModel().rows);") == original
    print("PASS playback: pause and seek use daily rows; Stop restores live; published model unchanged", flush=True)


def check_refresh(cdp):
    original = displayed(cdp)
    live(cdp, "f.mode='fail';return f.controller.refresh();")
    assert displayed(cdp)["current"] == original["current"]
    live(cdp, "return f.publish(1);")
    live(cdp, "f.mode='corrupt';return f.controller.refresh();")
    assert displayed(cdp)["current"] == original["current"]
    # Hold an uncached chunk while the tip changes. Its first candidate must
    # fail the marker recheck; the next complete request installs the new pair.
    live(cdp, "f.mode='hold';f.refreshPromise=f.controller.refresh();")
    wait_for(lambda: live(cdp, "return f.pending.length;"), description="held reference chunk")
    live(cdp, "f.tip={...f.tip,block_height:f.tip.block_height+1,block_time_utc:new Date(f.now).toISOString()};f.mode='pass';f.pending.splice(0).forEach(resolve=>resolve());return f.refreshPromise;")
    assert displayed(cdp)["current"] == original["current"], "mixed tip and reference escaped recheck"
    assert live(cdp, "return f.controller.refresh();")
    wait_for(lambda: displayed(cdp)["row"]["previousPrice"] == 18030.125, description="complete replacement reference")
    assert displayed(cdp)["row"]["height"] == original["row"]["height"] + 1
    before = live(cdp, "return Object.entries(f.requests).filter(([path])=>path.endsWith('.bin')).reduce((n,[_,count])=>n+count,0);")
    live(cdp, "f.tip={...f.tip,block_height:f.tip.block_height+1};return f.controller.refresh();")
    wait_for(lambda: displayed(cdp)["row"]["previousPrice"] == 18040.125, description="next height from cached chunk")
    assert live(cdp, "return Object.entries(f.requests).filter(([path])=>path.endsWith('.bin')).reduce((n,[_,count])=>n+count,0);") == before
    assert not live(cdp, "return Object.keys(f.requests).some(path=>/block_data_|btcusd_10m_prices/.test(path));")
    print("PASS atomic refresh: failure/hash rejection retain last good; changed tip rejected then recovered; chunk cached across heights", flush=True)


def check_exports(cdp, output):
    dashboard(cdp, RECORD_EXPORT)
    dashboard(cdp, """
      const X=w.WSBEOEGrowthExport,native=X.render;
      X.render=(ctx,width,height,options)=>{const view=w.WSBEOEGrowthCharts.getFrame(options);
        w.__eoeLiveFixture.renders.push({price:view.row.price,height:view.row.height,reference:view.row.previousPrice,
          date:view.row.date,index:view.row.index,current:!!view.current,
          quoteAt:view.row.quoteAt??null,blockTime:view.row.blockTime??null,priceTime:view.row.referencePriceTime??null});
        w.__eoeLiveFixture.afterCapture?.();return native(ctx,width,height,options);};
      w.__eoeLiveFixture.nativeReady=X.ready;
      X.ready=async()=>{await w.__eoeLiveFixture.nativeReady();await new Promise(resolve=>w.__eoeLiveFixture.releasePng=resolve);};
    """)
    before = dashboard(cdp, "return w.__eoeFixture.downloads.length;")
    click(cdp, "#downloadImageBtn")
    wait_for(lambda: live(cdp, "return !!f.releasePng;"), description="PNG snapshot ready gate")
    # Change both the quote and the uninstalled reference after assets started
    # loading. The PNG must refresh this pair, then ignore the next quote.
    expected_png = live(cdp, "return(async()=>{await f.advance(110000);f.afterCapture=()=>f.emit(111000);const expected=f.expected();f.releasePng();return expected;})();")
    wait_for(lambda: dashboard(cdp, f"return w.__eoeFixture.downloads.length>{before};"), timeout=60, description="frozen PNG")
    record = live(cdp, "return f.renders.at(-1);")
    assert record["current"] and all(record[key] == value for key, value in expected_png.items()), (record, expected_png)
    dashboard(cdp, "w.WSBEOEGrowthExport.ready=w.__eoeLiveFixture.nativeReady;w.__eoeLiveFixture.afterCapture=null;")
    wait_price(cdp, 111000)
    dates = dashboard(cdp, "return w.WSBEOEGrowthDashboard.getModel().rows.slice(-3).map(row=>row.date);")
    set_input(cdp, "#startDateInput", dates[0], "change")
    choose(cdp, "downloadQualitySelect", "720")
    choose(cdp, "downloadOrientationSelect", "landscape")
    choose(cdp, "downloadFpsSelect", "60")
    dashboard(cdp, """
      const encode=w.WSBDashboardExport.encodeWebM;
      w.WSBDashboardExport.encodeWebM=async options=>{
        const f=w.__eoeLiveFixture,draw=options.renderFrame;
        const renderFrame=async(...args)=>{f.position=args[2];await f.beforeFrame?.(...args);return draw(...args);};
        if(!f.stubEncode)return encode({...options,renderFrame});
        for(let index=0;index<options.frames.length;index++){
          if(options.isCanceled?.())return null;
          await renderFrame(options.frames[index],options.canvas,index);
        }
        return new Blob(['isolated export policy fixture'],{type:'video/webm'});
      };
    """)
    daily = dashboard(cdp, "return w.WSBEOEGrowthDashboard.getModel().rows.slice(-3).map(row=>({price:row.price,height:row.height,index:row.index,date:row.date}));")
    videos = []
    for holds in (False, True):
        if dashboard(cdp, "return d.querySelector('#downloadEndFrameHoldToggle').checked;") != holds:
            click(cdp, "#downloadEndFrameHoldToggle")
        opening = 30 if holds else 0
        live(cdp, f"f.opening={opening};return f.advance(130000);")
        live(cdp, """
          f.renders=[];f.refreshes=[];f.position=-1;f.initialExpected=f.expected();
          f.beforeFrame=async(_,canvas,position)=>{
            if(position===1&&f.opening)f.emit(140000);
            if(position===f.opening)await f.advance(150000);
            if(position===f.opening+1)await f.advance(155000);
            if(position===f.opening+2){await f.advance(160000);f.finalExpected=f.expected();}
            if(position===f.opening+3){await f.advance(170000);}
            if(position>f.opening+3)f.emit(170000+position);
          };
        """)
        result = export_blob(cdp, "webm", output / ("live-ending-holds.webm" if holds else "live-ending.webm"))
        captures = live(cdp, "return {renders:f.renders,initial:f.initialExpected,final:f.finalExpected,refreshes:f.refreshes};")
        renders = captures["renders"]
        assert len(renders) == (123 if holds else 3), len(renders)
        history = renders[opening:opening + 2]
        assert all(not row["current"] for row in history), history
        assert [{key: row[key] for key in ("price", "height", "index", "date")} for row in history] == daily[:2]
        ending = renders[opening + 2:]
        assert all(row == ending[0] for row in ending), "ending hold changed after final snapshot"
        assert ending[0]["current"] and all(ending[0][key] == value for key, value in captures["final"].items()), (ending[0], captures["final"])
        assert any(event["position"] == opening + 2 for event in captures["refreshes"]), captures["refreshes"]
        if holds:
            assert all(row == renders[0] for row in renders[:30]), "opening hold did not freeze its own snapshot"
            assert renders[0]["current"] and all(renders[0][key] == value for key, value in captures["initial"].items()), (renders[0], captures["initial"])
            assert renders[0] != ending[0], "opening hold froze the final capture too early"
        assert abs(result["duration"] - len(renders) / 30) < 1e-6, result
        videos.append({"holds": holds, **captures, "decoded": result})
    live(cdp, "f.beforeFrame=null;f.stubEncode=true;")
    if dashboard(cdp, "return d.querySelector('#downloadEndFrameHoldToggle').checked;"):
        click(cdp, "#downloadEndFrameHoldToggle")

    def policy_export():
        live(cdp, "f.renders=[];f.refreshes=[];f.position=-1;")
        count = dashboard(cdp, "return w.__eoeFixture.downloads.length;")
        click(cdp, "#dateRangeDownloadBtn")
        wait_for(lambda: dashboard(cdp, f"return w.__eoeFixture.downloads.length>{count}&&!w.dateRangeExportActive;"), description="export policy fixture")
        return live(cdp, "return f.renders;")

    # With a single selected day every source index equals the end index.
    # Frame position, rather than source-index equality, must distinguish the
    # opening hold from the first motion frame and its final hold.
    set_input(cdp, "#startDateInput", dates[2], "change")
    click(cdp, "#downloadEndFrameHoldToggle")
    live(cdp, """
      return(async()=>{
        await f.advance(200000);f.singleInitial=f.expected();
        f.beforeFrame=async(_,canvas,position)=>{
          if(position===1)f.emit(210000);
          if(position===30){await f.advance(220000);f.singleFinal=f.expected();}
          if(position===31)await f.advance(230000);
          if(position>31)f.emit(230000+position);
        };
      })();
    """)
    single = policy_export()
    single_expected = live(cdp, "return {initial:f.singleInitial,final:f.singleFinal,refreshes:f.refreshes};")
    assert len(single) == 121 and all(row["current"] for row in single), len(single)
    assert all(row == single[0] for row in single[:30]), "single-day opening hold changed"
    assert all(row == single[30] for row in single[30:]), "single-day ending hold changed"
    assert all(single[0][key] == value for key, value in single_expected["initial"].items()), (single[0], single_expected)
    assert all(single[30][key] == value for key, value in single_expected["final"].items()), (single[30], single_expected)
    assert single[0] != single[30], "single-day opening captured the final snapshot too early"
    assert [event["position"] for event in single_expected["refreshes"]] == [0, 30], single_expected
    live(cdp, "f.beforeFrame=null;")
    click(cdp, "#downloadEndFrameHoldToggle")
    set_input(cdp, "#startDateInput", dates[0], "change")
    print("PASS single-day latest export: separate captures at frames 0 and 30, each frozen through its hold", flush=True)

    set_input(cdp, "#endDateInput", dates[1], "change")
    selected = policy_export()
    assert len(selected) == 2 and all(not row["current"] for row in selected), selected
    set_input(cdp, "#endDateInput", dates[2], "change")
    click(cdp, "#playBtn")
    click(cdp, "#pauseBtn")
    set_input(cdp, "#dateRangeEndSlider", daily[1]["index"])
    paused = policy_export()
    assert len(paused) == 2 and all(not row["current"] for row in paused), paused
    click(cdp, "#stopBtn")
    click(cdp, "#playBtn")
    click(cdp, "#pauseBtn")
    set_input(cdp, "#dateRangeEndSlider", daily[-1]["index"])
    paused_latest = policy_export()
    assert len(paused_latest) == 3 and not any(row["current"] for row in paused_latest[:2]) and paused_latest[-1]["current"], paused_latest
    click(cdp, "#stopBtn")
    live(cdp, "f.noQuote=true;f.onQuote(null);")
    fallback = policy_export()
    assert len(fallback) == 3 and all(not row["current"] for row in fallback), fallback
    assert fallback[-1]["price"] == daily[-1]["price"]
    live(cdp, "f.noQuote=false;f.emit(190000);f.stubEncode=false;")
    (output / "live-export-records.json").write_text(json.dumps({"frozen_png": record, "videos": videos,
        "single_day_latest": {"renders": single, **single_expected},
        "selected_historical": selected, "paused_historical": paused,
        "paused_latest": paused_latest, "no_quote_fallback": fallback}, indent=2))
    print("PASS exports: PNG refreshes after assets; daily motion ends on refreshed live capture; separate opening/final holds; decoded holds on/off; historical/no-feed policies", flush=True)


def check_cancelled_export(cdp):
    # Force the final reference refresh to wait on an uncached chunk, cancel
    # from the normal button, then let the request settle without a download.
    count = dashboard(cdp, "return w.__eoeFixture.downloads.length;")
    live(cdp, """
      f.beforeFrame=async(_,canvas,position)=>{
        if(position!==2)return;
        await f.advance(195000);f.mode='hold';
      };
    """)
    click(cdp, "#dateRangeDownloadBtn")
    wait_for(lambda: live(cdp, "return f.pending.length;"), description="held final reference refresh")
    click(cdp, "#dateRangeDownloadBtn")
    assert dashboard(cdp, "return d.querySelector('#dateRangeDownloadBtn').classList.contains('is-canceling');")
    live(cdp, "f.mode='pass';f.pending.splice(0).forEach(resolve=>resolve());")
    wait_for(lambda: dashboard(cdp, "return !w.dateRangeExportActive;"), description="cancelled export controls restored")
    assert dashboard(cdp, "return !d.querySelector('#downloadImageBtn').disabled&&!d.querySelector('#dateRangeSettingsBtn').disabled;")
    assert dashboard(cdp, "return w.__eoeFixture.downloads.length;") == count
    live(cdp, "f.beforeFrame=null;")
    print("PASS cancellation: held final refresh releases without download and restores controls", flush=True)


def check_hidden_export(cdp, output):
    live(cdp, """
      f.stubEncode=true;f.hidden=false;f.visibilityWaiters=new Set();
      Object.defineProperty(d,'hidden',{configurable:true,get:()=>f.hidden});
      Object.defineProperty(d,'visibilityState',{configurable:true,get:()=>f.hidden?'hidden':'visible'});
      f.nativeAdd=d.addEventListener;f.nativeRemove=d.removeEventListener;
      d.addEventListener=function(type,listener,...args){if(type==='visibilitychange')f.visibilityWaiters.add(listener);return f.nativeAdd.call(this,type,listener,...args);};
      d.removeEventListener=function(type,listener,...args){if(type==='visibilitychange')f.visibilityWaiters.delete(listener);return f.nativeRemove.call(this,type,listener,...args);};
      f.visibility=hidden=>{f.hidden=hidden;d.dispatchEvent(new w.Event('visibilitychange'));};
      f.beforeFrame=async(_,canvas,position)=>{if(position===2)f.visibility(true);};
    """)
    count = dashboard(cdp, "return w.__eoeFixture.downloads.length;")
    live(cdp, "f.renders=[];")
    click(cdp, "#dateRangeDownloadBtn")
    wait_for(lambda: live(cdp, "return f.hidden&&f.visibilityWaiters.size===1;"), description="final capture waiting for visibility")
    assert dashboard(cdp, "return w.dateRangeExportActive;")
    assert dashboard(cdp, "return w.__eoeFixture.downloads.length;") == count
    assert live(cdp, "return f.renders.length;") == 2, "final snapshot was drawn while hidden"
    expected = live(cdp, "return(async()=>{await f.advance(240000);const expected=f.expected();f.visibility(false);return expected;})();")
    wait_for(lambda: dashboard(cdp, f"return w.__eoeFixture.downloads.length>{count}&&!w.dateRangeExportActive;"), description="visible final snapshot export")
    records = live(cdp, "return f.renders;")
    assert len(records) == 3 and records[-1]["current"] and all(records[-1][key] == value for key, value in expected.items()), (records, expected)
    assert live(cdp, "return f.visibilityWaiters.size;") == 0, "completed visibility wait leaked its listener"

    count = dashboard(cdp, "return w.__eoeFixture.downloads.length;")
    live(cdp, "f.renders=[];")
    click(cdp, "#dateRangeDownloadBtn")
    wait_for(lambda: live(cdp, "return f.hidden&&f.visibilityWaiters.size===1;"), description="cancellable hidden final capture")
    click(cdp, "#dateRangeDownloadBtn")
    wait_for(lambda: dashboard(cdp, "return !w.dateRangeExportActive;"), description="hidden cancellation releases export")
    assert live(cdp, "return f.hidden&&f.visibilityWaiters.size===0;"), "cancelled visibility wait leaked its listener"
    assert dashboard(cdp, "return w.__eoeFixture.downloads.length;") == count
    assert live(cdp, "return f.renders.length;") == 2
    assert dashboard(cdp, "return !d.querySelector('#downloadImageBtn').disabled&&!d.querySelector('#dateRangeSettingsBtn').disabled;")
    live(cdp, """
      f.visibility(false);f.beforeFrame=null;f.stubEncode=false;
      d.addEventListener=f.nativeAdd;d.removeEventListener=f.nativeRemove;
      delete d.hidden;delete d.visibilityState;
    """)
    (output / "visibility-export-records.json").write_text(json.dumps({"expected": expected, "renders": records}, indent=2))
    print("PASS hidden export: waits before final capture, refreshes on visibility, and cancellation removes its listener/restores controls", flush=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output-dir", default="/tmp/eoe-growth-live-review")
    args = parser.parse_args()
    output = Path(args.output_dir).resolve()
    output.mkdir(parents=True, exist_ok=True)
    freeze_data()
    marker = json.loads(FrozenHandler.snapshot["/assets/daily_price_metadata.json"])
    from datetime import datetime, timezone
    published = datetime.fromisoformat(marker["latest_timestamp"].replace("Z", "+00:00"))
    if published.tzinfo is None:
        published = published.replace(tzinfo=timezone.utc)
    source = {"height": marker["latest_block_height"], "at": int(published.timestamp() * 1000)}
    server_port, debug_port = free_port(), free_port()
    server = ThreadingHTTPServer(("127.0.0.1", server_port), lambda *a, **kw: FrozenHandler(*a, directory=str(ROOT), **kw))
    threading.Thread(target=server.serve_forever, daemon=True).start()
    with tempfile.TemporaryDirectory(prefix="wsb-eoe-live-") as profile:
        chrome = subprocess.Popen([CHROME, "--headless=new", "--disable-gpu", "--remote-allow-origins=*", f"--remote-debugging-port={debug_port}",
            f"--user-data-dir={profile}", "about:blank"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        try:
            wait_for(lambda: urllib.request.urlopen(f"http://127.0.0.1:{debug_port}/json/version", timeout=.5).read(), description="Chrome DevTools")
            target = json.load(urllib.request.urlopen(urllib.request.Request(f"http://127.0.0.1:{debug_port}/json/new?about:blank", method="PUT")))
            cdp = CdpSocket(target["webSocketDebuggerUrl"])
            for method in ["Page.enable", "Runtime.enable", "Network.enable"]:
                cdp.command(method)
            cdp.command("Network.setBlockedURLs", {"urls": ["*fonts.googleapis.com*", "*fonts.gstatic.com*"]})
            cdp.command("Emulation.setDeviceMetricsOverride", {"width": 1440, "height": 900, "deviceScaleFactor": 1, "mobile": False})
            cdp.command("Page.addScriptToEvaluateOnNewDocument", {"source": FIXTURE + LIVE_FIXTURE.replace("__SOURCE__", json.dumps(source))})
            navigate(cdp, f"http://127.0.0.1:{server_port}/webapps/eoe_growth/dashboard.html?fixture_reset=1")
            check_current(cdp)
            check_playback(cdp)
            check_refresh(cdp)
            check_exports(cdp, output)
            check_cancelled_export(cdp)
            check_hidden_export(cdp, output)
            assert_clean(cdp)
            print(f"Review files: {output}", flush=True)
        finally:
            chrome.terminate()
            try:
                chrome.wait(timeout=5)
            except subprocess.TimeoutExpired:
                chrome.kill()
                chrome.wait(timeout=5)
            server.shutdown()


if __name__ == "__main__":
    main()
