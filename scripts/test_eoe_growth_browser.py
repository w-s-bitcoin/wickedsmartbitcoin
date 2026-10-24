#!/usr/bin/env python3
"""EOE dashboard, publication, and actual PNG/video checks in isolated Chrome.

Freeze the published generation in memory; inject failed/superseded responses
without editing live data. Save review images outside the repository. Run from
the repository root, setting CHROME_BIN if needed.
"""

import argparse
import base64
import hashlib
import json
import os
import subprocess
import tempfile
import threading
import urllib.request
from http.server import ThreadingHTTPServer
from pathlib import Path

from test_comparison_live_price_browser import FrozenHandler
from test_stage1_refresh_atomicity import CdpSocket, free_port, wait_for


ROOT = Path(__file__).resolve().parents[1]
CHROME = os.environ.get("CHROME_BIN", "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome")
FIXTURE = r"""
(() => {
  const params=new URLSearchParams(location.search);
  if(params.has('fixture_reset'))localStorage.clear();
  if(params.has('fixture_conflict'))localStorage.setItem('eoe_growth_dashboard_state_v1',JSON.stringify({
    startIso:'2015-01-01',endIso:'2016-01-01',currentIso:'2015-06-01',pausedPlayback:true,
    tracksLatest:false,speed:4,height:1000,preset:'custom',timeZone:'Asia/Tokyo'}));
  const fixture=window.__eoeFixture={errors:[],generation:0,mode:'pass',payloads:0,markers:0,pending:[],events:[],downloads:[],renders:[]};
  // The historical suite must never open the production spot sockets. Live
  // behavior has a separate explicit quote fixture in test_eoe_growth_live_browser.py.
  window.WebSocket=class {
    static CONNECTING=0;static OPEN=1;static CLOSING=2;static CLOSED=3;
    constructor(url){this.url=url;this.readyState=0;}
    send(){}
    close(){this.readyState=3;}
  };
  if(params.has('fixture_hold_initial'))fixture.mode='hold';
  window.addEventListener('error',event=>fixture.errors.push(event.message));
  window.addEventListener('unhandledrejection',event=>fixture.errors.push(String(event.reason)));
  window.addEventListener('wsb:data-refresh-status',event=>fixture.events.push(event.detail));
  Object.defineProperty(navigator,'clipboard',{value:{writeText:async text=>{fixture.copied=text;}}});
  const originalFetch=window.fetch.bind(window);
  window.fetch=async(input,options)=>{
    const url=new URL(typeof input==='string'?input:input.url,location.href);
    if(url.origin!==location.origin)throw new Error('External requests disabled in fixture');
    if(url.pathname==='/assets/daily_price_metadata.json'){
      fixture.markers++;const marker=await(await originalFetch(input,options)).json();
      if(fixture.generation)marker.fixture_generation=fixture.generation;
      return new Response(JSON.stringify(marker),{status:200});
    }
    if(url.pathname==='/assets/daily_price.csv'){
      fixture.payloads++;
      if(fixture.mode==='fail')return new Response('Unavailable',{status:503});
      if(fixture.mode==='hold')await new Promise(resolve=>fixture.pending.push(resolve));
      const response=await originalFetch(input,options);
      if(fixture.mode==='corrupt')return new Response((await response.text()).split('\n').slice(0,-3).join('\n'),{status:200});
      return response;
    }
    return originalFetch(input,options);
  };
  const createURL=URL.createObjectURL.bind(URL),blobs=new Map();
  URL.createObjectURL=blob=>{const url=createURL(blob);blobs.set(url,blob);return url;};
  const nativeClick=HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click=function(){
    if(this.download){fixture.downloads.push({name:this.download,blob:blobs.get(this.href)});return;}
    nativeClick.call(this);
  };
})();
"""


def freeze_data():
    for _ in range(5):
        before = (ROOT / "assets/daily_price_metadata.json").read_bytes()
        csv = (ROOT / "assets/daily_price.csv").read_bytes()
        after = (ROOT / "assets/daily_price_metadata.json").read_bytes()
        if before == after and hashlib.sha256(csv).hexdigest() == json.loads(before)["artifact"]["sha256"]:
            FrozenHandler.snapshot = {"/assets/daily_price.csv": csv, "/assets/daily_price_metadata.json": before}
            return
    raise AssertionError("Price publication did not settle while freezing the fixture")


def dashboard(cdp, expression):
    return cdp.evaluate(f"(() => {{ const w=window.__eoeWindow||window,d=w.document; {expression} }})()")


def state(cdp):
    return dashboard(cdp, "return w.WSBEOEGrowthDashboard.getState();")


def navigate(cdp, url, standalone=False):
    cdp.command("Page.navigate", {"url": url})
    scope = "document.querySelector('iframe')?.contentWindow" if standalone else "window"
    try:
        wait_for(lambda: cdp.evaluate(f"(() => {{ const w={scope}; if(!w?.WSBEOEGrowthDashboard?.getModel()||w.document.body.dataset.ready!=='true')return false;window.__eoeWindow=w;return true; }})()"), description="EOE dashboard ready")
    except TimeoutError:
        print(cdp.evaluate(f"(() => {{ const w={scope};return {{status:w?.document.querySelector('#loadStatus')?.textContent,errors:w?.__eoeFixture?.errors,events:w?.__eoeFixture?.events,html:w?.document.body?.innerText.slice(0,600)}}; }})()"), flush=True)
        raise


def click(cdp, selector):
    dashboard(cdp, f"d.querySelector({json.dumps(selector)}).click();")


def set_input(cdp, selector, value, event="input"):
    dashboard(cdp, f"const input=d.querySelector({json.dumps(selector)});input.value={json.dumps(str(value))};input.dispatchEvent(new w.Event({json.dumps(event)},{{bubbles:true}}));")


def assert_clean(cdp):
    errors = dashboard(cdp, "return w.__eoeFixture.errors;")
    assert errors == [], errors


def assert_kpis(cdp):
    result = dashboard(cdp, """
      const app=w.WSBEOEGrowthDashboard,row=app.getFrame().row,G=w.WSBEOEGrowthCharts;
      return {epoch:d.querySelector('#epochKpi').textContent===String(row.epoch),
        count:Number(d.querySelector('#countKpi').textContent.replaceAll(',',''))===row.epochBlockCount,
        price:d.querySelector('#priceKpi').textContent===(row.price===0?'Not Valued':G.kpiMoney(row.price)),
        previous:d.querySelector('#previousPriceKpi').textContent===(row.previousPrice===0?'Not Valued':G.kpiMoney(row.previousPrice)),
        growth:d.querySelector('#growthKpi').textContent===G.growthLabel(row.growth),
        causal:app.getFrame().epochs.every(group=>group.rows.every(value=>value.index<=row.index)),
        date:app.getState().currentIso===row.date};
    """)
    assert all(result.values()), result


def check_invalid_share_dates(cdp, direct):
    encoded = dashboard(cdp, "return w.WSBDashboardShare.encodeShareState({startIso:'2024-02-30',endIso:'2024-05-31',currentIso:'2024-02-30',tracksLatest:false,pausedPlayback:true});")
    navigate(cdp, direct + "?state=" + encoded)
    selected = state(cdp)
    assert selected["startIso"] == "2009-01-03" and selected["endIso"] == "2024-05-31" and selected["currentIso"] == "2024-05-31", selected
    navigate(cdp, direct + "?fixture_reset=1")
    print("PASS validation: impossible calendar dates do not roll into a different date", flush=True)


def check_pending_play(cdp, direct):
    cdp.command("Page.navigate", {"url": direct + "?fixture_reset=1&fixture_hold_initial=1"})
    wait_for(lambda: cdp.evaluate("window.__eoeFixture?.pending.length&&!!window.WSBEOEGrowthDashboard"), description="held initial history")
    assert dashboard(cdp, "return w.WSBEOEGrowthDashboard.getModel()===null;")
    click(cdp, "#playBtn")
    assert dashboard(cdp, "return w.WSBEOEGrowthDashboard.getModel()===null&&!w.WSBEOEGrowthDashboard.isPlaying();"), "pending Play bypassed data validation"
    dashboard(cdp, "w.__eoeFixture.mode='pass';w.__eoeFixture.pending.splice(0).forEach(resolve=>resolve());")
    wait_for(lambda: dashboard(cdp, "return d.body.dataset.ready==='true'&&w.WSBEOEGrowthDashboard.isPlaying();"), description="pending Play after validated install")
    assert dashboard(cdp, "return w.WSBEOEGrowthDashboard.getModel().rows.length===JSON.parse(w.WSBEOEGrowthDashboard.getInstalledSignature()).artifact.rows;")
    click(cdp, "#stopBtn")
    assert_clean(cdp)
    print("PASS initial Play: remembers first click and starts only after validated publication installation", flush=True)


def check_control_parity(cdp):
    def pointer(selector, event):
        dashboard(cdp, f"""
          const el=d.querySelector({json.dumps(selector)}),wrap=d.querySelector('#dateRangeSliderWrap'),rect=wrap.getBoundingClientRect();
          const x=rect.left+Number(el.value)/Number(el.max)*rect.width;
          el.dispatchEvent(new w.PointerEvent({json.dumps(event)},{{pointerId:55,button:0,clientX:x,clientY:rect.top+rect.height/2,bubbles:true}}));
        """)

    def row_index(iso):
        return dashboard(cdp, f"return w.WSBEOEGrowthDashboard.getModel().rows.findIndex(row=>row.date==={json.dumps(iso)});")

    set_input(cdp, "#startDateInput", "2020-01-01", "change")
    set_input(cdp, "#endDateInput", "2020-01-10", "change")
    assert dashboard(cdp, "return d.querySelector('#startDateInput').max==='2020-01-10'&&d.querySelector('#endDateInput').min==='2020-01-01';")
    click(cdp, "#playBtn")
    click(cdp, "#pauseBtn")
    set_input(cdp, "#dateRangeEndSlider", row_index("2020-01-05"))
    pointer("#dateRangeStartSlider", "pointerdown")
    assert state(cdp)["endIso"] == "2020-01-05" and not state(cdp)["pausedPlayback"], state(cdp)
    pointer("#dateRangeStartSlider", "pointerup")
    set_input(cdp, "#endDateInput", "2020-01-10", "change")
    click(cdp, "#playBtn")
    click(cdp, "#pauseBtn")
    pointer("#dateRangeEndSlider", "pointerdown")
    set_input(cdp, "#dateRangeEndSlider", row_index("2020-01-12"))
    assert state(cdp)["currentIso"] == "2020-01-12" and state(cdp)["endIso"] == "2020-01-10"
    pointer("#dateRangeEndSlider", "pointerup")
    assert state(cdp)["endIso"] == "2020-01-12" and not state(cdp)["pausedPlayback"], state(cdp)
    set_input(cdp, "#endDateInput", "2021-01-01", "change")
    click(cdp, "#playBtn")
    pointer("#dateRangeEndSlider", "pointerdown")
    assert not dashboard(cdp, "return w.WSBEOEGrowthDashboard.isPlaying();")
    set_input(cdp, "#dateRangeEndSlider", row_index("2020-01-10"))
    pointer("#dateRangeEndSlider", "pointerup")
    assert dashboard(cdp, "return w.WSBEOEGrowthDashboard.isPlaying();"), "end scrubbing did not resume playback"
    click(cdp, "#pauseBtn")
    dashboard(cdp, "d.querySelector('#speedBtn').focus();d.activeElement.dispatchEvent(new w.KeyboardEvent('keydown',{key:' ',code:'Space',bubbles:true}));")
    assert dashboard(cdp, "return w.WSBEOEGrowthDashboard.isPlaying();"), "focused playback button blocked Space"
    dashboard(cdp, "d.querySelector('#dateRangeEndSlider').focus();d.activeElement.dispatchEvent(new w.KeyboardEvent('keydown',{key:'ArrowRight',code:'ArrowRight',bubbles:true}));")
    assert not dashboard(cdp, "return w.WSBEOEGrowthDashboard.isPlaying();")
    assert state(cdp)["currentIso"] == state(cdp)["endIso"] and state(cdp)["pausedPlayback"], state(cdp)
    dashboard(cdp, "w.__eoeFixture.encode=w.WSBDashboardExport.encodeVideo;w.WSBDashboardExport.encodeVideo=async()=>{await new Promise(resolve=>w.__eoeFixture.releaseExport=resolve);return null;};")
    click(cdp, "#dateRangeDownloadBtn")
    wait_for(lambda: dashboard(cdp, "return !!w.__eoeFixture.releaseExport;"), description="held export control fixture")
    assert dashboard(cdp, "return d.querySelector('#dateRangeDownloadBtn').title==='Cancel download'&&d.querySelector('#downloadSettingsDownloadBtn').textContent==='Stop Download';")
    click(cdp, "#dateRangeDownloadBtn")
    assert dashboard(cdp, "return d.querySelector('#dateRangeDownloadBtn').classList.contains('is-canceling');")
    dashboard(cdp, "w.__eoeFixture.releaseExport();")
    wait_for(lambda: dashboard(cdp, "return !w.dateRangeExportActive;"), description="cancelled export controls restored")
    assert dashboard(cdp, "return !d.querySelector('#dateRangeDownloadBtn').classList.contains('is-canceling')&&d.querySelector('#dateRangeDownloadBtn').title==='Download animation';")
    dashboard(cdp, "w.WSBDashboardExport.encodeVideo=w.__eoeFixture.encode;")
    click(cdp, "#stopBtn")
    set_input(cdp, "#endDateInput", "2024-05-31", "change")
    assert_clean(cdp)
    print("PASS control parity: calendar bounds, start/end scrub, resume, focused shortcuts, final-frame hold, export cancellation", flush=True)


def check_playback(cdp):
    assert dashboard(cdp, "return d.querySelector('#chartLoader').hidden||d.querySelector('#chartLoader').classList.contains('hidden');")
    assert_kpis(cdp)
    initial = state(cdp)
    click(cdp, "#playBtn")
    click(cdp, "#pauseBtn")
    set_input(cdp, "#dateRangeEndSlider", 0)
    assert state(cdp)["currentIso"] == "2009-01-03"
    assert state(cdp)["endIso"] == initial["endIso"]
    assert dashboard(cdp, "return d.querySelector('#growthKpi').textContent==='—';")
    assert_kpis(cdp)
    dashboard(cdp, "d.activeElement?.blur();d.dispatchEvent(new w.KeyboardEvent('keydown',{key:'.',code:'Period',bubbles:true}));")
    assert state(cdp)["currentIso"] == "2009-01-04"
    dashboard(cdp, "d.dispatchEvent(new w.KeyboardEvent('keydown',{key:' ',code:'Space',bubbles:true}));")
    assert dashboard(cdp, "return w.WSBEOEGrowthDashboard.isPlaying();")
    click(cdp, "#pauseBtn")
    paused = state(cdp)
    assert not dashboard(cdp, "return w.WSBEOEGrowthDashboard.isPlaying();")
    assert state(cdp) == paused
    click(cdp, "#stopBtn")
    assert state(cdp)["currentIso"] == initial["endIso"]
    assert not state(cdp)["pausedPlayback"]
    set_input(cdp, "#startDateInput", "2020-01-01", "change")
    set_input(cdp, "#endDateInput", "2024-05-31", "change")
    assert state(cdp)["startIso"] == "2020-01-01"
    assert state(cdp)["endIso"] == "2024-05-31"
    click(cdp, "#startDateBtn")
    assert dashboard(cdp, "return !!d.querySelector('.date-picker-popup');")
    dashboard(cdp, "[...d.querySelectorAll('.date-picker-day')].find(day=>day.textContent==='2').click();")
    assert state(cdp)["startIso"] == "2020-01-02"
    assert_kpis(cdp)
    assert_clean(cdp)
    print("PASS playback: early unvalued history, causal KPIs, date pickers, seek/pause/stop, keyboard", flush=True)


def check_sharing(cdp, direct):
    click(cdp, "#playBtn")
    click(cdp, "#pauseBtn")
    selected = dashboard(cdp, "return w.WSBEOEGrowthDashboard.getModel().rows.findIndex(row=>row.date==='2022-06-01');")
    set_input(cdp, "#dateRangeEndSlider", selected)
    click(cdp, "#speedBtn")
    saved = state(cdp)
    click(cdp, "#copyDashboardLink")
    link = wait_for(lambda: dashboard(cdp, "return w.__eoeFixture.copied;"), description="copied dashboard link")
    assert "/eoe_growth.html?" in link, link
    navigate(cdp, link + "&fixture_conflict=1", standalone=True)
    assert state(cdp) == saved, (saved, state(cdp))
    assert not dashboard(cdp, "return w.WSBEOEGrowthDashboard.isPlaying();")
    assert_kpis(cdp)
    click(cdp, "#speedBtn")
    persisted = state(cdp)
    navigate(cdp, direct)
    assert state(cdp) == persisted, (persisted, state(cdp))
    click(cdp, "#resetDashboard")
    assert state(cdp)["startIso"] == "2009-01-03"
    assert state(cdp)["currentIso"] == state(cdp)["endIso"]
    click(cdp, "#resetDashboard")
    assert state(cdp) == persisted
    assert_clean(cdp)
    print("PASS state: standalone share beats conflicting storage, persistence, reset and undo", flush=True)


def check_refresh(cdp):
    before = state(cdp)
    signature = dashboard(cdp, "return w.WSBEOEGrowthDashboard.getInstalledSignature();")
    dashboard(cdp, "w.__eoeFixture.generation=1;w.__eoeFixture.mode='fail';w.WSBWebappDataAutoRefresh.requestCheck('fixture-failure');")
    wait_for(lambda: dashboard(cdp, "return w.__eoeFixture.events.some(event=>event.status==='error');"), description="refresh failure")
    assert state(cdp) == before
    assert dashboard(cdp, "return w.WSBEOEGrowthDashboard.getInstalledSignature();") == signature
    dashboard(cdp, "w.__eoeFixture.mode='pass';w.WSBWebappDataAutoRefresh.requestCheck('fixture-recovery');")
    wait_for(lambda: dashboard(cdp, "return JSON.parse(w.WSBEOEGrowthDashboard.getInstalledSignature()).fixture_generation===1;"), description="refresh recovery")
    dashboard(cdp, "w.__eoeFixture.mode='hold';w.__eoeFixture.generation=2;w.WSBWebappDataAutoRefresh.requestCheck('fixture-race');")
    wait_for(lambda: dashboard(cdp, "return w.__eoeFixture.pending.length;"), description="held refresh payload")
    dashboard(cdp, "w.__eoeFixture.generation=3;w.__eoeFixture.mode='pass';w.__eoeFixture.pending.splice(0).forEach(resolve=>resolve());")
    wait_for(lambda: dashboard(cdp, "return JSON.parse(w.WSBEOEGrowthDashboard.getInstalledSignature()).fixture_generation===3;"), description="newer generation installed")
    assert not dashboard(cdp, "return w.__eoeFixture.events.some(event=>event.status==='applied'&&event.signature&&JSON.parse(event.signature).fixture_generation===2);")
    dashboard(cdp, "w.__eoeFixture.mode='corrupt';w.__eoeFixture.generation=4;w.WSBWebappDataAutoRefresh.requestCheck('fixture-corrupt');")
    wait_for(lambda: dashboard(cdp, "return w.__eoeFixture.events.filter(event=>event.status==='error').length>=2;"), description="hash mismatch rejected")
    assert dashboard(cdp, "return JSON.parse(w.WSBEOEGrowthDashboard.getInstalledSignature()).fixture_generation;") == 3
    assert state(cdp) == before
    assert_kpis(cdp)
    dashboard(cdp, "w.__eoeFixture.mode='pass';w.WSBWebappDataAutoRefresh.requestCheck('fixture-final');")
    wait_for(lambda: dashboard(cdp, "return JSON.parse(w.WSBEOEGrowthDashboard.getInstalledSignature()).fixture_generation===4;"), description="final refresh recovery")
    assert state(cdp) == before
    assert_clean(cdp)
    print("PASS refresh: failed/truncated payload retention, superseded candidate rejection, playback state retained", flush=True)


def check_menu_keyboard(cdp):
    before = state(cdp)
    assert before["pausedPlayback"]
    click(cdp, "#dateRangeSettingsBtn")
    dashboard(cdp, "d.querySelector('#downloadOrientationSelect button').focus();d.activeElement.dispatchEvent(new w.KeyboardEvent('keydown',{key:'Escape',code:'Escape',bubbles:true}));")
    assert dashboard(cdp, "return !d.querySelector('#dateRangeSettingsMenu').classList.contains('open')&&d.activeElement.id==='dateRangeSettingsBtn';"), "Escape did not close the menu and return focus"
    assert state(cdp) == before, "Escape in an open menu changed the paused playback frame"
    click(cdp, "#startDateBtn")
    dashboard(cdp, "d.querySelector('.date-picker-nav').focus();d.activeElement.dispatchEvent(new w.KeyboardEvent('keydown',{key:'Escape',code:'Escape',bubbles:true}));")
    assert dashboard(cdp, "return !d.querySelector('.date-picker-popup')&&d.activeElement.id==='startDateBtn';")
    assert state(cdp) == before
    dashboard(cdp, "d.querySelector('#updatedTimeZoneDropdownTrigger').focus();d.activeElement.dispatchEvent(new w.KeyboardEvent('keydown',{key:'ArrowDown',code:'ArrowDown',bubbles:true}));")
    assert dashboard(cdp, "return d.querySelector('#updatedTimeZoneDropdownMenu').classList.contains('open')&&d.activeElement.classList.contains('dca-dropdown-option');"), "Timezone keyboard did not open and focus an option"
    dashboard(cdp, "d.activeElement.dispatchEvent(new w.KeyboardEvent('keydown',{key:'End',code:'End',bubbles:true}));")
    assert dashboard(cdp, "return d.activeElement===d.querySelector('#updatedTimeZoneDropdownMenu').lastElementChild;")
    dashboard(cdp, "d.activeElement.dispatchEvent(new w.KeyboardEvent('keydown',{key:'Home',code:'Home',bubbles:true}));")
    assert dashboard(cdp, "return d.activeElement===d.querySelector('#updatedTimeZoneDropdownMenu').firstElementChild;")
    selected = dashboard(cdp, "d.activeElement.dispatchEvent(new w.KeyboardEvent('keydown',{key:'ArrowDown',code:'ArrowDown',bubbles:true}));return d.activeElement.dataset.value;")
    dashboard(cdp, "d.activeElement.dispatchEvent(new w.KeyboardEvent('keydown',{key:'Enter',code:'Enter',bubbles:true}));")
    assert state(cdp)["timeZone"] == selected
    assert dashboard(cdp, "return !d.querySelector('#updatedTimeZoneDropdownMenu').classList.contains('open')&&d.activeElement.id==='updatedTimeZoneDropdownTrigger';")
    assert state(cdp)["currentIso"] == before["currentIso"] and state(cdp)["pausedPlayback"]
    dashboard(cdp, "d.activeElement.dispatchEvent(new w.KeyboardEvent('keydown',{key:' ',code:'Space',bubbles:true}));d.activeElement.dispatchEvent(new w.KeyboardEvent('keydown',{key:'Escape',code:'Escape',bubbles:true}));")
    assert dashboard(cdp, "return !d.querySelector('#updatedTimeZoneDropdownMenu').classList.contains('open')&&d.activeElement.id==='updatedTimeZoneDropdownTrigger';")
    assert state(cdp)["pausedPlayback"]
    assert_clean(cdp)
    print("PASS keyboard: menu/calendar Escape preserves playback; timezone arrows/Home/End/Enter/Space/Escape", flush=True)


def screenshot(cdp, output):
    result = cdp.command("Page.captureScreenshot", {"format": "png", "captureBeyondViewport": True})
    output.write_bytes(base64.b64decode(result["data"]))


def check_layout(cdp, output):
    for theme in ("dark", "light"):
        dashboard(cdp, f"d.documentElement.dataset.theme={json.dumps(theme)};w.dispatchEvent(new w.Event('resize'));")
        for width in (1440, 1024, 390, 320):
            cdp.command("Emulation.setDeviceMetricsOverride", {"width": width, "height": 900, "deviceScaleFactor": 1, "mobile": False})
            wait_for(lambda: dashboard(cdp, f"return w.innerWidth==={width};"), description="responsive width")
            dimensions = dashboard(cdp, """
              const rect=d.querySelector('#epochChart').getBoundingClientRect();
              return {viewport:w.innerWidth,scroll:d.documentElement.scrollWidth,width:rect.width,height:rect.height,
                disabled:[...d.querySelectorAll('#playBtn,#downloadImageBtn,#dateRangeSettingsBtn')].some(button=>button.disabled)};
            """)
            assert dimensions["scroll"] <= width + 1, dimensions
            assert dimensions["width"] > 100 and dimensions["height"] > 100 and not dimensions["disabled"], dimensions
            assert_kpis(cdp)
            screenshot(cdp, output / f"dashboard-{theme}-{width}.png")
    cdp.command("Emulation.setDeviceMetricsOverride", {"width": 1440, "height": 900, "deviceScaleFactor": 1, "mobile": False})
    dashboard(cdp, "d.documentElement.dataset.theme='dark';w.dispatchEvent(new w.Event('resize'));")
    assert_clean(cdp)
    print("PASS layout: dark/light at 1440/1024/390/320px without page overflow; screenshots saved", flush=True)


RECORD_EXPORT = r"""
if(!w.__eoeFixture.exportsRecorded){
w.__eoeFixture.exportsRecorded=true;
const fixture=w.__eoeFixture,exporter=w.WSBEOEGrowthExport,nativeRender=exporter.render;
exporter.render=(ctx,width,height,options)=>{
  const row=w.WSBEOEGrowthCharts.getFrame(options).row;
  const record={width,height,date:row.date,index:row.index,growth:row.growth,text:[],images:[]};
  const fillText=ctx.fillText,drawImage=ctx.drawImage;
  const point=(x,y)=>{const p=new DOMPoint(x,y).matrixTransform(ctx.getTransform());return [p.x,p.y];};
  ctx.fillText=function(text,x,y,...args){
    const m=ctx.measureText(text),squeeze=args[0]>0?Math.min(1,args[0]/m.width):1;
    const corners=[[x-m.actualBoundingBoxLeft*squeeze,y-m.actualBoundingBoxAscent],[x+m.actualBoundingBoxRight*squeeze,y-m.actualBoundingBoxAscent],
      [x-m.actualBoundingBoxLeft*squeeze,y+m.actualBoundingBoxDescent],[x+m.actualBoundingBoxRight*squeeze,y+m.actualBoundingBoxDescent]].map(([a,b])=>point(a,b));
    record.text.push({text:String(text),font:ctx.font,bounds:[Math.min(...corners.map(p=>p[0])),Math.min(...corners.map(p=>p[1])),Math.max(...corners.map(p=>p[0])),Math.max(...corners.map(p=>p[1]))]});
    return fillText.call(ctx,text,x,y,...args);
  };
  ctx.drawImage=function(image,...args){record.images.push({source:image.currentSrc||image.src||'',width:image.naturalWidth,height:image.naturalHeight});return drawImage.call(ctx,image,...args);};
  try{return nativeRender(ctx,width,height,options);}finally{ctx.fillText=fillText;ctx.drawImage=drawImage;fixture.renders.push(record);}
};
const encode=w.WSBDashboardExport.encodeVideo;
w.WSBDashboardExport.encodeVideo=options=>{
  fixture.video={frames:[...options.frames],rendered:[],width:options.width,height:options.height,fps:options.fps,settings:{...options.settings}};
  const render=options.renderFrame;
  return encode({...options,renderFrame:async(...args)=>{fixture.video.rendered.push(args[0]);return render(...args);}});
};
}
"""


def choose(cdp, group, value):
    click(cdp, f'#{group} button[data-value="{value}"]')


def export_blob(cdp, extension, output):
    before = dashboard(cdp, "return w.__eoeFixture.downloads.length;")
    click(cdp, "#downloadImageBtn" if extension == "png" else "#dateRangeDownloadBtn")
    outcome = wait_for(lambda: dashboard(cdp, f"const status=d.querySelector('#loadStatus');return w.__eoeFixture.downloads.length>{before}?'downloaded':!status.hidden&&status.textContent.startsWith('Export failed:')?status.textContent:false;"), timeout=60, description=f"real {extension} export")
    assert outcome == "downloaded", outcome
    result = dashboard(cdp, """
      return(async()=>{
        const item=w.__eoeFixture.downloads.at(-1),blob=item.blob;
        const data=await new Promise(resolve=>{const r=new FileReader();r.onload=()=>resolve(r.result.split(',')[1]);r.readAsDataURL(blob);});
        let width,height,frame,duration;
        if(blob.type==='image/png'){const bitmap=await createImageBitmap(blob);width=bitmap.width;height=bitmap.height;bitmap.close();}
        else{
          const video=d.createElement('video'),url=URL.createObjectURL(blob);
          await new Promise((resolve,reject)=>{video.onloadeddata=resolve;video.onerror=()=>reject(new Error('Video decode failed'));video.preload='auto';video.src=url;});
          width=video.videoWidth;height=video.videoHeight;duration=video.duration;
          video.muted=true;d.body.append(video);
          await new Promise((resolve,reject)=>{video.requestVideoFrameCallback(()=>{video.pause();resolve();});video.play().catch(reject);});
          const canvas=d.createElement('canvas');canvas.width=width;canvas.height=height;canvas.getContext('2d').drawImage(video,0,0);frame=canvas.toDataURL('image/png').split(',')[1];
          const pixels=canvas.getContext('2d').getImageData(0,0,width,height).data;
          if(!pixels.some((value,index)=>index%4!==3&&value>30))throw new Error('Decoded video frame is blank');
          video.remove();
          URL.revokeObjectURL(url);
        }
        return{name:item.name,type:blob.type,width,height,duration,data,frame,record:w.__eoeFixture.renders.at(-1)};
      })();
    """)
    content = base64.b64decode(result.pop("data"))
    assert len(content) > 1000
    actual_extension = {"image/png": "png", "video/mp4": "mp4", "video/webm": "webm"}[result["type"]]
    assert result["name"].endswith("." + actual_extension), result
    if actual_extension == "mp4":
        assert content[4:8] == b"ftyp", result
    else:
        assert content.startswith(b"\x89PNG\r\n\x1a\n" if actual_extension == "png" else b"\x1aE\xdf\xa3"), result
    output = output.with_suffix("." + actual_extension)
    output.write_bytes(content)
    if frame := result.pop("frame", None):
        output.with_name(output.stem + "-frame.png").write_bytes(base64.b64decode(frame))
    assert dashboard(cdp, "return !d.querySelector('#downloadImageBtn').disabled;")
    return result


def check_exports(cdp, output):
    set_input(cdp, "#endDateInput", "2026-03-19", "change")
    dashboard(cdp, RECORD_EXPORT)
    choose(cdp, "downloadQualitySelect", "720")
    choose(cdp, "downloadThemeSelect", "dark")
    records = []
    for orientation, dimensions in (("landscape", (3840, 2160)), ("portrait", (2160, 3840)), ("square", (2160, 2160))):
        choose(cdp, "downloadOrientationSelect", orientation)
        result = export_blob(cdp, "png", output / f"export-{orientation}.png")
        assert (result["width"], result["height"]) == dimensions, result
        record = result["record"]
        assert record["date"] == state(cdp)["currentIso"]
        texts = [item["text"] for item in record["text"]]
        assert "Epoch-Over-Epoch (EOE) Growth" in texts
        assert "https://wickedsmartbitcoin.com/eoe_growth" in texts
        for asset in ("bitcoin-wordmark.jpg", "wicked-apple.png", "qr_lightning.png"):
            assert any(image["source"].endswith(asset) and image["width"] > 0 for image in record["images"]), (orientation, asset)
        for label in ("CREATOR", "Wicked", "@w_s_bitcoin", "LIGHTNING", "DONATIONS", "wicked", "@primal.net"):
            assert label in texts, (orientation, label)
        for item in record["text"]:
            left, top, right, bottom = item["bounds"]
            assert -1 <= left <= right <= dimensions[0] + 1 and -1 <= top <= bottom <= dimensions[1] + 1, (orientation, "Clipped text", item)
        records.append(result)
    choose(cdp, "downloadOrientationSelect", "landscape")
    choose(cdp, "downloadThemeSelect", "light")
    light = export_blob(cdp, "png", output / "export-landscape-light.png")
    assert (light["width"], light["height"]) == (3840, 2160)
    records.append(light)
    choose(cdp, "downloadThemeSelect", "dark")
    set_input(cdp, "#startDateInput", "2026-03-17", "change")
    set_input(cdp, "#endDateInput", "2026-03-19", "change")
    if dashboard(cdp, "return d.querySelector('#downloadEndFrameHoldToggle').checked;"):
        click(cdp, "#downloadEndFrameHoldToggle")
    video = export_blob(cdp, "video", output / "export-short.mp4")
    assert (video["width"], video["height"]) == (1280, 720), video
    assert video["record"]["date"] == "2026-03-19"
    frame_record = dashboard(cdp, "return w.__eoeFixture.video;")
    assert len(frame_record["rendered"]) == len(frame_record["frames"]) == 3, frame_record
    assert abs(video["duration"] - 3 / 30) < .002, video["duration"]
    records.append(video)
    faces = dashboard(cdp, "return [...d.fonts].filter(face=>face.family.includes('WSB Export')).map(face=>({family:face.family,status:face.status}));")
    assert len(faces) >= 3 and all(face["status"] == "loaded" for face in faces), faces
    (output / "export-records.json").write_text(json.dumps({"exports": records, "video": frame_record, "fonts": faces}, indent=2))
    assert_clean(cdp)
    print("PASS exports: decoded 4K PNG in all orientations with low video quality, light/dark, real short video", flush=True)


def check_fast_intro(cdp, direct, output, *, encode=True):
    """Exercise persisted controls and real encoding around the first EOE value."""
    navigate(cdp, direct + "?fixture_reset=1")
    checkbox = "#downloadFastIntroToggle"
    assert dashboard(cdp, f"return d.querySelector('{checkbox}').checked;"), "Fast intro must default on"
    click(cdp, "#dateRangeSettingsBtn")
    for theme in ("dark", "light"):
        dashboard(cdp, f"d.documentElement.dataset.theme={json.dumps(theme)};")
        for width in (1440, 390, 320):
            cdp.command("Emulation.setDeviceMetricsOverride", {"width": width, "height": 1000, "deviceScaleFactor": 1, "mobile": False})
            dashboard(cdp, "return new Promise(resolve=>w.requestAnimationFrame(()=>w.requestAnimationFrame(resolve))); ")
            # Open at the target viewport, as a user would, so the shared menu
            # positioner measures that viewport rather than the prior one.
            click(cdp, "#dateRangeSettingsBtn")
            click(cdp, "#dateRangeSettingsBtn")
            style = dashboard(cdp, """
              const fast=d.querySelector('#downloadFastIntroToggle'),hold=d.querySelector('#downloadEndFrameHoldToggle');
              const first=fast.closest('label'),second=hold.closest('label');
              const properties=['appearance','width','height','margin','accent-color','cursor','font-family','font-size','color'];
              const labelProperties=['display','align-items','gap','font-family','font-size','line-height','color','cursor'];
              const styles=(el,keys)=>Object.fromEntries(keys.map(key=>[key,w.getComputedStyle(el).getPropertyValue(key)]));
              const a=first.getBoundingClientRect(),b=second.getBoundingClientRect();
              return {fast:styles(fast,properties),hold:styles(hold,properties),first:styles(first,labelProperties),second:styles(second,labelProperties),
                ordered:!!(first.compareDocumentPosition(second)&w.Node.DOCUMENT_POSITION_FOLLOWING),
                separated:a.bottom<=b.top,inside:a.left>=0&&a.right<=w.innerWidth&&b.right<=w.innerWidth,
                label:first.textContent.trim(),hint:first.title||fast.title};
            """)
            assert style["fast"] == style["hold"] and style["first"] == style["second"], style
            assert style["ordered"] and style["separated"] and style["inside"], style
            assert style["label"] == "4x speed before first EOE value" and "four times" in style["hint"].lower() and "selected playback speed" in style["hint"], style
            if width == 390:
                screenshot(cdp, output / f"fast-intro-menu-{theme}-390.png")
    cdp.command("Emulation.setDeviceMetricsOverride", {"width": 1440, "height": 900, "deviceScaleFactor": 1, "mobile": False})
    dashboard(cdp, "d.documentElement.dataset.theme='dark';")
    screenshot(cdp, output / "fast-intro-settings.png")
    for enabled in (False, True):
        if dashboard(cdp, f"return d.querySelector('{checkbox}').checked;") != enabled:
            click(cdp, checkbox)
        saved = dashboard(cdp, "return JSON.parse(w.localStorage.getItem('eoe_growth_download_settings_v1'));")
        assert saved["fastIntro"] is enabled, saved
        navigate(cdp, direct)
        assert dashboard(cdp, f"return d.querySelector('{checkbox}').checked;") is enabled, "Fast intro preference did not survive reload"
    print("PASS fast intro UI: checked by default, shared checkbox style/order at desktop/390/320 dark/light, both preference values persist", flush=True)

    bounds = dashboard(cdp, """
      const model=w.WSBEOEGrowthDashboard.getModel(),first=model.rows.findIndex(row=>Number.isFinite(row.growth));
      if(first<80||first+200>=model.rows.length)throw new Error('Fixture lacks enough data around first EOE');
      return {first,date:model.rows[first].date,growth:model.rows[first].growth,dates:model.rows.map(row=>row.date)};
    """)
    dashboard(cdp, """
      const native=w.WSBDashboardExport.estimateDownload;
      w.__eoeFixture.estimates=[];
      w.WSBDashboardExport.estimateDownload=(settings,options)=>{
        const result=native(settings,options);
        w.__eoeFixture.estimates.push({settings:{...settings},options:{...options},result});
        return result;
      };
    """)

    def toggle(enabled):
        if dashboard(cdp, f"return d.querySelector('{checkbox}').checked;") != enabled:
            click(cdp, checkbox)

    def select_range(start, end):
        # Widen the current end first so either direction can be selected via
        # the real validation path without briefly producing an inverted range.
        set_input(cdp, "#endDateInput", bounds["dates"][-1], "change")
        set_input(cdp, "#startDateInput", bounds["dates"][start], "change")
        set_input(cdp, "#endDateInput", bounds["dates"][end], "change")

    def estimate():
        value = dashboard(cdp, "return w.__eoeFixture.estimates.at(-1);")
        assert value, "No estimate was generated"
        visible = dashboard(cdp, "return {size:d.querySelector('#downloadEstimateSize').textContent,length:d.querySelector('#downloadEstimateLength').textContent,time:d.querySelector('#downloadEstimateTime').textContent};")
        assert visible == {"size": value["result"]["sizeText"], "length": value["result"]["lengthText"], "time": value["result"]["timeText"]}, (visible, value)
        return value

    choose(cdp, "downloadFpsSelect", "60")
    choose(cdp, "downloadOrientationSelect", "landscape")
    choose(cdp, "downloadQualitySelect", "720")
    choose(cdp, "downloadThemeSelect", "dark")
    if dashboard(cdp, "return d.querySelector('#downloadEndFrameHoldToggle').checked;"):
        click(cdp, "#downloadEndFrameHoldToggle")
    first = bounds["first"]
    estimates = {}
    for name, start, end in (("leading-only", first-80, first-1), ("crossing", first-80, first+200), ("after-first", first, first+200)):
        select_range(start, end)
        toggle(False)
        normal = estimate()
        toggle(True)
        fast = estimate()
        if name == "after-first":
            assert fast["options"] == normal["options"] and fast["result"] == normal["result"], (name, normal, fast)
        else:
            assert fast["options"]["frameCount"] < normal["options"]["frameCount"], (name, normal, fast)
            assert fast["result"]["videoSeconds"] < normal["result"]["videoSeconds"] and fast["result"]["bytes"] < normal["result"]["bytes"], (name, normal, fast)
            assert fast["result"]["lengthText"] != normal["result"]["lengthText"], (name, normal, fast)
        estimates[name] = {"normal": normal, "fast": fast}
    # The measured segment contributes every daily frame at the selected 1x
    # rate: only the preceding 80 days become 20 frames.
    assert estimates["crossing"]["normal"]["options"]["frameCount"] == 281
    assert estimates["crossing"]["fast"]["options"]["frameCount"] == 221
    print("PASS fast intro estimates: only leading unavailable growth is accelerated; measured history retains selected speed", flush=True)

    exports = []
    if encode:
        dashboard(cdp, RECORD_EXPORT)
        select_range(first-8, first+2)
        for enabled, expected in ((True, [first-8, first-4, first, first+1, first+2]),
                                  (False, list(range(first-8, first+3)))):
            toggle(enabled)
            planned = estimate()
            assert planned["options"]["frameCount"] == len(expected), planned
            dashboard(cdp, "w.__eoeFixture.renders=[];")
            result = export_blob(cdp, "video", output / ("fast-intro-on.mp4" if enabled else "fast-intro-off.mp4"))
            recorded = dashboard(cdp, "return {video:w.__eoeFixture.video,renders:w.__eoeFixture.renders.map(({index,date,growth})=>({index,date,growth}))};")
            assert recorded["video"]["frames"] == expected and recorded["video"]["rendered"] == expected, recorded
            assert [frame["index"] for frame in recorded["renders"]] == expected, recorded
            assert {"index": first, "date": bounds["date"], "growth": bounds["growth"]} in recorded["renders"], recorded
            assert recorded["video"]["fps"] == 30 and recorded["video"]["settings"]["fastIntro"] is enabled, recorded
            assert (result["width"], result["height"]) == (1280, 720), result
            assert abs(result["duration"]-len(expected)/30) < .002, (result["duration"], expected)
            assert abs(result["duration"]-planned["result"]["videoSeconds"]) < .002, (result, planned)
            exports.append({"enabled": enabled, "result": result, **recorded})
        # Keep the new default for callers that proceed to other export checks.
        toggle(True)
        print("PASS fast intro video: 5 fast vs 11 uniform submitted/rendered frames, exact decoded durations, first EOE and final frames retained", flush=True)
    (output / "fast-intro-records.json").write_text(json.dumps({"firstGrowthIndex": first, "firstGrowthDate": bounds["date"], "estimates": estimates, "exports": exports}, indent=2))
    assert_clean(cdp)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output-dir", default="/tmp/eoe-growth-review")
    parser.add_argument("--skip-exports", action="store_true", help="Run UI/state/refresh checks without real PNG/video encoding")
    parser.add_argument("--fast-intro-only", action="store_true", help="Run only the fast-intro controls, estimates, and short boundary video checks")
    args = parser.parse_args()
    output = Path(args.output_dir).resolve()
    output.mkdir(parents=True, exist_ok=True)
    if not Path(CHROME).is_file():
        raise SystemExit(f"Chrome not found at {CHROME}; set CHROME_BIN")
    freeze_data()
    server_port, debug_port = free_port(), free_port()
    server = ThreadingHTTPServer(("127.0.0.1", server_port), lambda *a, **kw: FrozenHandler(*a, directory=str(ROOT), **kw))
    threading.Thread(target=server.serve_forever, daemon=True).start()
    with tempfile.TemporaryDirectory(prefix="wsb-eoe-growth-") as profile:
        chrome = subprocess.Popen([CHROME, "--headless=new", "--disable-gpu", "--remote-allow-origins=*", f"--remote-debugging-port={debug_port}", f"--user-data-dir={profile}", "about:blank"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        try:
            wait_for(lambda: urllib.request.urlopen(f"http://127.0.0.1:{debug_port}/json/version", timeout=.5).read(), description="Chrome DevTools")
            target = json.load(urllib.request.urlopen(urllib.request.Request(f"http://127.0.0.1:{debug_port}/json/new?about:blank", method="PUT")))
            cdp = CdpSocket(target["webSocketDebuggerUrl"])
            cdp.command("Page.enable")
            cdp.command("Runtime.enable")
            cdp.command("Network.enable")
            cdp.command("Network.setBlockedURLs", {"urls": ["*fonts.googleapis.com*", "*fonts.gstatic.com*"]})
            cdp.command("Emulation.setDeviceMetricsOverride", {"width": 1440, "height": 900, "deviceScaleFactor": 1, "mobile": False})
            cdp.command("Page.addScriptToEvaluateOnNewDocument", {"source": FIXTURE})
            direct = f"http://127.0.0.1:{server_port}/webapps/eoe_growth/dashboard.html"
            if args.fast_intro_only:
                check_fast_intro(cdp, direct, output, encode=not args.skip_exports)
                print(f"Review files: {output}", flush=True)
                return
            navigate(cdp, direct + "?fixture_reset=1")
            check_invalid_share_dates(cdp, direct)
            check_pending_play(cdp, direct)
            check_playback(cdp)
            check_control_parity(cdp)
            check_sharing(cdp, direct)
            check_menu_keyboard(cdp)
            check_refresh(cdp)
            check_layout(cdp, output)
            if not args.skip_exports:
                check_exports(cdp, output)
            check_fast_intro(cdp, direct, output, encode=not args.skip_exports)
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
