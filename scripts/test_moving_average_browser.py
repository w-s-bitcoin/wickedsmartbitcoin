#!/usr/bin/env python3
"""Moving Average UI, sharing, refresh and export regression using isolated Chrome.

Published prices are frozen in memory and failures/races are injected through a
browser fetch shim. Live quotes use a fake WebSocket and controllable clock.
This never modifies datasets or runs production producers.
Run from the repository root; set CHROME_BIN when Chrome is installed elsewhere.
"""

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
  const params = new URLSearchParams(location.search);
  if (params.has('fixture_reset')) localStorage.clear();
  if (params.has('fixture_conflict')) localStorage.setItem('moving_average_dashboard_state_v1', JSON.stringify({
    lines: [{period: 9, unit:'week'}, {period: 10, unit:'month'}], scales:['linear','log','log'],
    startIso:'2015-01-01', endIso:'2016-01-01', currentIso:'2015-06-01', pausedPlayback:true, tracksLatest:false,
    speed:4, height:1000, preset:'custom', timeZone:'Asia/Tokyo'
  }));
  const fixture = window.__maFixture = {errors:[], generation:0, mode:'pass', payloads:0, markers:0, pending:[], events:[], downloads:[], sockets:[], now:null, publication:null};
  const nativeNow=Date.now.bind(Date); Date.now=()=>fixture.now ?? nativeNow();
  class PriceSocket {
    constructor(url) {
      this.url=url; fixture.sockets.push(this);
      if(url==='wss://2140data.io/') fixture.socket=this;
      setTimeout(()=>{if(!this.closed)this.onopen?.();},0);
    }
    send(payload) {this.subscription=payload;}
    close() {this.closed=true;}
    emit(price,time=new Date(Date.now()).toISOString()) {
      this.onmessage?.({data:JSON.stringify({weightedPrice:String(price),time})});
    }
  }
  window.WebSocket=PriceSocket;
  window.addEventListener('error', event => fixture.errors.push(event.message));
  window.addEventListener('unhandledrejection', event => fixture.errors.push(String(event.reason)));
  window.addEventListener('wsb:data-refresh-status', event => fixture.events.push(event.detail));
  Object.defineProperty(navigator, 'clipboard', {value:{writeText:async text => { fixture.copied = text; }}});
  const originalFetch = window.fetch.bind(window);
  window.fetch = async (input, options) => {
    const url = new URL(typeof input === 'string' ? input : input.url, location.href);
    if (url.origin !== location.origin) throw new Error('External feeds disabled in fixture');
    if (url.pathname === '/assets/daily_price_metadata.json') {
      fixture.markers++;
      const marker = fixture.publication ? {...fixture.publication.marker} : await (await originalFetch(input, options)).json();
      if (fixture.generation) marker.fixture_generation = fixture.generation;
      return new Response(JSON.stringify(marker), {status:200});
    }
    if (url.pathname === '/assets/daily_price.csv') {
      fixture.payloads++;
      if (fixture.mode === 'fail') return new Response('Unavailable', {status:503});
      if (fixture.mode === 'hold') await new Promise(resolve => fixture.pending.push(resolve));
      const response = fixture.publication ? new Response(fixture.publication.csv,{status:200}) : await originalFetch(input, options);
      if (fixture.mode === 'corrupt') return new Response((await response.text()).split('\n').slice(0,-3).join('\n'), {status:200});
      return response;
    }
    return originalFetch(input, options);
  };
  const createURL = URL.createObjectURL.bind(URL);
  const blobs = new Map();
  URL.createObjectURL = blob => { const url = createURL(blob); blobs.set(url,blob); return url; };
  const nativeClick = HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click = function () {
    if (this.download) { fixture.downloads.push({name:this.download, blob:blobs.get(this.href)}); return; }
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
            for path in (ROOT / "webapps/days_since_ath/webapp_data").rglob("*"):
                if path.is_file():
                    FrozenHandler.snapshot["/" + str(path.relative_to(ROOT))] = path.read_bytes()
            return
    raise AssertionError("Shared price publication did not settle while freezing the browser fixture")


def dashboard(cdp, expression):
    return cdp.evaluate(f"(() => {{ const w=window.__maWindow || window; const d=w.document; {expression} }})()")


def state(cdp):
    return dashboard(cdp, "return w.WSBMovingAverageDashboard.getState();")


def navigate(cdp, url, standalone=False):
    cdp.command("Page.navigate", {"url": url})
    scope = "document.querySelector('iframe')?.contentWindow" if standalone else "window"
    wait_for(lambda: cdp.evaluate(f"(() => {{ const w={scope}; if (!w?.WSBMovingAverageDashboard?.getModel() || w.document.body.dataset.ready !== 'true') return false; window.__maWindow=w; return true; }})()"), description="Moving Average ready")


def click(cdp, selector):
    dashboard(cdp, f"d.querySelector({json.dumps(selector)}).click();")


def set_input(cdp, selector, value, event="input"):
    dashboard(cdp, f"const element=d.querySelector({json.dumps(selector)}); element.value={json.dumps(str(value))}; element.dispatchEvent(new w.Event({json.dumps(event)},{{bubbles:true}}));")


def select_line(cdp, number, period, unit):
    # Set both fields before dispatch so changing units cannot temporarily clamp
    # a previously longer period or accidentally overwrite the intended input.
    dashboard(cdp, f"d.querySelector('#ma{number}Period').value={period}; d.querySelector('#ma{number}Unit').value={json.dumps(unit)}; d.querySelector('#ma{number}Period').dispatchEvent(new w.Event('input',{{bubbles:true}}));")


def select_type(cdp, number, average_type):
    click(cdp, f"#ma{number}TypeDropdownTrigger")
    click(cdp, f'#ma{number}TypeDropdownMenu .dca-option-btn[data-value="{average_type}"]')


def assert_clean(cdp):
    assert dashboard(cdp, "return w.__maFixture.errors;") == [], dashboard(cdp, "return w.__maFixture.errors;")


def hover_chart(cdp):
    dashboard(cdp, "const canvas=d.querySelector('#historyChart'), rect=canvas.getBoundingClientRect(); canvas.dispatchEvent(new w.PointerEvent('pointermove',{clientX:rect.left+rect.width/2,clientY:rect.top+rect.height/2,bubbles:true}));")
    assert dashboard(cdp, "return !d.querySelector('#chartTooltip').hidden;"), "Chart hover did not open its tooltip"


def assert_spans(cdp):
    result = dashboard(cdp, """
      const app=w.WSBMovingAverageDashboard, s=app.getState(), m=app.getModel(), M=w.WSBMovingAverageModel;
      const time=Date.parse(s.currentIso+'T00:00:00Z');
      return s.lines.map((line,i) => {
        const canvas=d.querySelector('#window'+(i+1)+'Chart');
        return {actual:[canvas.dataset.startDate,canvas.dataset.endDate],
          expected:[new Date(M.windowStart(time,line.period,line.unit)).toISOString().slice(0,10),s.currentIso]};
      });
    """)
    assert all(pair["actual"] == pair["expected"] for pair in result), result


def copy_link(cdp):
    dashboard(cdp, "w.__maFixture.copied='';")
    click(cdp, "#copyDashboardLink")
    return wait_for(lambda: dashboard(cdp, "return w.__maFixture.copied;"), description="copy link")


def check_controls(cdp):
    initial = state(cdp)
    assert initial["lines"] == [{"period": 200, "unit": "day", "type":"sma"}, {"period": 200, "unit": "week", "type":"sma"}], initial
    assert dashboard(cdp, "return d.querySelector('#chartLoader').classList.contains('hidden');"), "Loading overlay remained visible"
    limits = dashboard(cdp, "return w.WSBMovingAverageDashboard.getModel().limits;")
    for unit in ("day", "week", "month"):
        for number in (1, 2):
            for period in (3, limits[unit]):
                select_line(cdp, number, period, unit)
                assert state(cdp)["lines"][number - 1] == {"period": period, "unit": unit, "type":"sma"}
                assert dashboard(cdp, f"return d.querySelector('#ma{number}Period').max;") == str(limits[unit])
                assert dashboard(cdp, f"return d.querySelector('#ma{number}KpiLabel').textContent;") == f"{period}" + {"day":"D","week":"W","month":"M"}[unit] + " SMA"
                assert dashboard(cdp, f"const app=w.WSBMovingAverageDashboard; return JSON.stringify(app.getSeries()[{number - 1}]) === JSON.stringify(w.WSBMovingAverageModel.calculate(app.getModel(),{{period:{period},unit:{json.dumps(unit)}}}));")
                assert_spans(cdp)
            prior = state(cdp)["lines"][number - 1]
            for bad in (2, limits[unit] + 1, "3.5", ""):
                set_input(cdp, f"#ma{number}Period", bad)
                assert state(cdp)["lines"][number - 1] == prior
                assert dashboard(cdp, f"return d.querySelector('#ma{number}Period').getAttribute('aria-invalid');") == "true"
                assert dashboard(cdp, f"return !!d.querySelector('#ma{number}Error').textContent;")
            select_line(cdp, number, 3, unit)
    select_line(cdp, 1, 200, "day")
    select_line(cdp, 2, 200, "week")
    expected_scales = ["log", "linear", "linear"]
    for index, selector in enumerate(("#historyScale", "#window1Scale", "#window2Scale")):
        scale = "linear" if index == 0 else "log"
        click(cdp, f'{selector} [data-value="{scale}"]')
        expected_scales[index] = scale
        assert state(cdp)["scales"] == expected_scales
        assert dashboard(cdp, f"return d.querySelector('{selector} [aria-pressed=\"true\"]').dataset.value;") == scale
    assert state(cdp)["scales"] == ["linear", "log", "log"]
    for value in ("ytd", "1y", "2y", "4y", "8y", "full"):
        click(cdp, f'#rangeButtons button[data-range-preset="{value}"], #rangeButtons button[data-range="{value}"]')
        assert state(cdp)["preset"] == value, state(cdp)
    assert_clean(cdp)
    print("PASS periods: defaults, both lines, all units, min/max, validation, labels, scales, presets", flush=True)


def check_scale_toggle_controls(cdp, direct):
    navigate(cdp, direct + '?fixture_reset=1')
    cdp.command('Emulation.setEmulatedMedia', {'features':[{'name':'prefers-reduced-motion','value':'reduce'}]})
    try:
        for index, selector in enumerate(('#historyScale', '#window1Scale', '#window2Scale')):
            for side in ('log', 'linear'):
                button = f'{selector} [data-value="{side}"]'
                # Repeated clicks on the same physical half cover both its
                # selected and unselected states. Both must toggle exactly once.
                for _ in range(2):
                    before = state(cdp)
                    point = dashboard(cdp, f"const b=d.querySelector({json.dumps(button)});b.scrollIntoView({{block:'center'}});const r=b.getBoundingClientRect();return {{x:r.left+r.width/2,y:r.top+r.height/2}};")
                    for event in ('mousePressed', 'mouseReleased'):
                        cdp.command('Input.dispatchMouseEvent', {'type':event, **point, 'button':'left', 'buttons':int(event=='mousePressed'), 'clickCount':1})
                    expected = json.loads(json.dumps(before))
                    expected['scales'][index] = 'linear' if before['scales'][index] == 'log' else 'log'
                    assert state(cdp) == expected, (selector, side, before, state(cdp))
                    assert dashboard(cdp, f"return d.querySelector('{selector} [aria-pressed=\"true\"]').dataset.value;") == expected['scales'][index]
                # Native button activation must retain keyboard accessibility
                # and must not bubble Space into dashboard playback.
                for key, code, keycode in (('Enter', 'Enter', 13), (' ', 'Space', 32)):
                    before = state(cdp)
                    dashboard(cdp, f"d.querySelector({json.dumps(button)}).focus();")
                    for event in ('keyDown', 'keyUp'):
                        payload = {'type':event, 'key':key, 'code':code, 'windowsVirtualKeyCode':keycode}
                        if event == 'keyDown':
                            payload.update(text='\r' if key == 'Enter' else ' ', unmodifiedText='\r' if key == 'Enter' else ' ')
                        cdp.command('Input.dispatchKeyEvent', payload)
                    expected = json.loads(json.dumps(before))
                    expected['scales'][index] = 'linear' if before['scales'][index] == 'log' else 'log'
                    assert state(cdp) == expected, (selector, side, key, before, state(cdp))
                    assert not dashboard(cdp, 'return w.WSBMovingAverageDashboard.isPlaying();')
        assert_clean(cdp)
    finally:
        cdp.command('Emulation.setEmulatedMedia', {'features':[{'name':'prefers-reduced-motion','value':'no-preference'}]})
    print('PASS scale toggles: either half, repeated selected/unselected clicks, Enter/Space, exactly one change, independent panels', flush=True)


def check_scale_animation(cdp, direct):
    navigate(cdp, direct + '?fixture_reset=1')
    dashboard(cdp, """
      const fixture=w.__maFixture,G=w.WSBMovingAverageCharts;
      fixture.scalePanels={};fixture.scaleFrames=[];fixture.scaleOriginal=G.panel;
      G.panel=(ctx,rect,options)=>{
        const labels=[],fillText=ctx.fillText;
        ctx.fillText=function(text,x,y,...args){
          if(x===rect.width-(rect.width<370?65:84)+8)labels.push({text:String(text),y,alpha:this.globalAlpha});
          return fillText.call(this,text,x,y,...args);
        };
        let g;try{g=fixture.scaleOriginal(ctx,rect,options);}finally{ctx.fillText=fillText;}
        const price=options.model.rows[options.endIndex].price;
        const record={id:ctx.canvas.id,mix:g.scaleMix,padding:g.yPadding,labels,price,
          y:g.valueToY(price),roundtrip:g.yToValue(g.valueToY(price)),plot:g.plot};
        fixture.scalePanels[record.id]=record;fixture.scaleFrames.push(record);
        return g;
      };
      w.dispatchEvent(new w.Event('resize'));
    """)
    wait_for(lambda: dashboard(cdp, "return Object.keys(w.__maFixture.scalePanels).length===3;"), description="initial scale geometry")

    def wait_mix(chart, target=None):
        condition = 'value>0.1 && value<0.9' if target is None else f'Math.abs(value-{target})<1e-9'
        return dashboard(cdp, f"""
          return new Promise((resolve,reject)=>{{let frames=0;const poll=()=>{{
            const record=w.__maFixture.scalePanels[{json.dumps(chart)}],value=record?.mix;
            if({condition})return resolve(record);
            if(++frames>180)return reject(new Error('scale animation did not reach requested frame: '+value));
            w.requestAnimationFrame(poll);
          }};poll();}});
        """)

    # Capture a complete real-frame transition in each direction. The zero tick
    # must fade only once: collision avoidance cannot make it vanish and return.
    for target, direction in ((0, 1), (1, -1)):
        start = dashboard(cdp, "w.__maFixture.zeroStart=w.__maFixture.scalePanels.historyChart;return w.__maFixture.scaleFrames.length;")
        click(cdp, '#historyScale [aria-pressed="true"]')
        wait_mix('historyChart', target)
        records = dashboard(cdp, f"return [w.__maFixture.zeroStart,...w.__maFixture.scaleFrames.slice({start}).filter(frame=>frame.id==='historyChart')];")
        alphas = [next((label['alpha'] for label in record['labels'] if label['text'] == '$0'), 0) for record in records]
        assert len({round(record['mix'], 4) for record in records if 0 < record['mix'] < 1}) >= 3, records
        assert abs(alphas[0] - target) < 0.001 and abs(alphas[-1] - (1-target)) < 0.001, alphas
        assert all(direction*(after-before) >= -1e-6 for before,after in zip(alphas,alphas[1:])), alphas
        assert any(0 < alpha < 1 for alpha in alphas), alphas

    # Toggling changes persistent state immediately while the rendered
    # geometry progresses through actual browser animation frames.
    click(cdp, '#historyScale [data-value="linear"]')
    assert state(cdp)['scales'] == ['linear', 'linear', 'linear']
    assert dashboard(cdp, "return JSON.parse(localStorage.getItem('moving_average_dashboard_state_v1')).scales;") == ['linear', 'linear', 'linear']
    middle = wait_mix('historyChart')
    assert 0 < middle['mix'] < 1, middle
    assert dashboard(cdp, "return ['window1Chart','window2Chart'].every(id=>w.__maFixture.scalePanels[id].mix===0);")
    # A reversal starts from the exact last painted shape, without snapping to
    # the endpoint of the transition that was interrupted.
    reversal = dashboard(cdp, """
      const before=w.__maFixture.scalePanels.historyChart.mix;
      d.querySelector('#historyScale [aria-pressed="true"]').click();
      return {before,after:w.__maFixture.scalePanels.historyChart.mix};
    """)
    assert abs(reversal['before'] - reversal['after']) < 0.001, reversal
    wait_mix('historyChart', 1)

    for selector, chart in (('#window1Scale', 'window1Chart'), ('#window2Scale', 'window2Chart')):
        before = state(cdp)
        click(cdp, f'{selector} [aria-pressed="true"]')
        wait_mix(chart)
        reversal = dashboard(cdp, f"""
          const before=w.__maFixture.scalePanels[{json.dumps(chart)}].mix;
          d.querySelector('{selector} [aria-pressed="true"]').click();
          return {{before,after:w.__maFixture.scalePanels[{json.dumps(chart)}].mix}};
        """)
        assert abs(reversal['before'] - reversal['after']) < 0.001, reversal
        assert state(cdp) == before, (before, state(cdp))
        wait_mix(chart, 0)

    # All three controls have independent in-flight transitions. Resizing and
    # theme changes must continue to produce finite geometry and fixed padding.
    dashboard(cdp, """
      d.querySelector('#historyScale [data-value="linear"]').click();
      d.querySelector('#window1Scale [data-value="log"]').click();
      d.querySelector('#window2Scale [data-value="log"]').click();
    """)
    for chart in ('historyChart', 'window1Chart', 'window2Chart'):
        wait_mix(chart)
    cdp.command('Emulation.setDeviceMetricsOverride', {'width':390,'height':900,'deviceScaleFactor':1,'mobile':False})
    dashboard(cdp, "d.documentElement.dataset.theme='light';d.dispatchEvent(new w.CustomEvent('dashboard-theme-change'));w.dispatchEvent(new w.Event('resize'));")
    for chart, target in (('historyChart',0),('window1Chart',1),('window2Chart',1)):
        wait_mix(chart,target)
    frames = dashboard(cdp, 'return w.__maFixture.scaleFrames;')
    for chart in ('historyChart', 'window1Chart', 'window2Chart'):
        assert len({round(frame['mix'],4) for frame in frames if frame['id']==chart and 0<frame['mix']<1}) >= 2, chart
    for frame in frames:
        assert 0 <= frame['mix'] <= 1 and frame['y'] is not None, frame
        assert abs(frame['roundtrip'] - frame['price']) < 0.001, frame
        assert all(abs(frame['padding'][side]-16)<0.001 for side in ('top','bottom')), frame
        assert len({label['text'] for label in frame['labels']}) == len(frame['labels']), frame
        assert all(label['y'] is not None and 0<label['alpha']<=1 for label in frame['labels']), frame
    assert any(0<label['alpha']<1 for frame in frames for label in frame['labels']), 'Y-axis labels did not crossfade'
    cdp.command('Emulation.setDeviceMetricsOverride', {'width':1280,'height':900,'deviceScaleFactor':1,'mobile':False})
    dashboard(cdp, "d.documentElement.dataset.theme='dark';d.dispatchEvent(new w.CustomEvent('dashboard-theme-change'));w.dispatchEvent(new w.Event('resize'));")

    # Reduced-motion changes settle running animations and subsequent clicks
    # toggle directly to the opposite scale.
    click(cdp, '#historyScale [data-value="log"]'); wait_mix('historyChart')
    cdp.command('Emulation.setEmulatedMedia', {'features':[{'name':'prefers-reduced-motion','value':'reduce'}]})
    wait_mix('historyChart',1)
    click(cdp, '#historyScale [data-value="linear"]')
    assert dashboard(cdp, 'return w.__maFixture.scalePanels.historyChart.mix;') == 0
    cdp.command('Emulation.setEmulatedMedia', {'features':[{'name':'prefers-reduced-motion','value':'no-preference'}]})

    # PNG export while a transition is running uses only the selected endpoint.
    dashboard(cdp, """
      const G=w.WSBMovingAverageCharts;w.__maFixture.scaleComposite=G.composite;
      G.composite=(ctx,width,height,options)=>{
        w.__maFixture.scaleExport={scales:options.scales,keys:Object.keys(options)};
        return w.__maFixture.scaleComposite(ctx,width,height,options);
      };
    """)
    click(cdp, '#historyScale [data-value="log"]'); wait_mix('historyChart')
    click(cdp, '#downloadImageBtn')
    wait_for(lambda: dashboard(cdp, "return w.__maFixture.downloads.some(item=>item.name.endsWith('.png'));"), description='target-scale PNG export')
    exported = dashboard(cdp, 'return w.__maFixture.scaleExport;')
    assert exported['scales'] == state(cdp)['scales'] and 'scaleMix' not in exported['keys'] and 'scaleMixes' not in exported['keys'], exported
    wait_mix('historyChart',1)
    assert_clean(cdp)
    # A fresh page also verifies that no intermediate mix leaked into settings.
    saved = state(cdp)
    navigate(cdp, direct)
    assert state(cdp) == saved
    print('PASS scale animation: real intermediate frames, monotonic $0 fade in both directions, independent panels, continuous reversals, moving/fading ticks, fixed padding, mobile/theme resize, reduced motion, target-scale export and persistence', flush=True)


def assert_custom_control_sync(cdp):
    result = dashboard(cdp, """
      const s=w.WSBMovingAverageDashboard.getState();
      return s.lines.map((line,i)=>{
        const prefix='ma'+(i+1),select=d.getElementById(prefix+'Unit');
        return {line,value:select.value,period:d.getElementById(prefix+'Period').value,
          label:d.getElementById(prefix+'UnitDropdownValue').textContent,
          expectedLabel:select.selectedOptions[0].textContent,
          type:d.getElementById(prefix+'Type').value,typeLabel:d.getElementById(prefix+'TypeDropdownValue').textContent,
          expectedTypeLabel:line.type==='none'?'None':line.type.toUpperCase()+(i+1),
          selected:[...d.querySelectorAll('#'+prefix+'UnitDropdownMenu .dca-option-btn--selected')].map(button=>button.dataset.value)};
      });
    """)
    for item in result:
        assert item["value"] == item["line"]["unit"] and item["selected"] == [item["line"]["unit"]], item
        assert item["label"] == item["expectedLabel"] and item["period"] == f"{item['line']['period']:,}", item
        assert item["type"] == item["line"]["type"] and item["typeLabel"] == item["expectedTypeLabel"], item


def check_custom_controls(cdp):
    def mouse_click(selector):
        point = dashboard(cdp, f"const element=d.querySelector({json.dumps(selector)});element.scrollIntoView({{block:'center'}});const r=element.getBoundingClientRect();return {{x:r.left+r.width/2,y:r.top+r.height/2}};")
        for event in ("mousePressed", "mouseReleased"):
            cdp.command("Input.dispatchMouseEvent", {"type":event,**point,"button":"left","buttons":int(event=="mousePressed"),"clickCount":1})

    def key(value):
        code = {"Enter":"Enter","Escape":"Escape","ArrowDown":"ArrowDown","ArrowUp":"ArrowUp","Home":"Home","End":"End"}[value]
        cdp.command("Input.dispatchKeyEvent", {"type":"keyDown","key":value,"code":code})
        cdp.command("Input.dispatchKeyEvent", {"type":"keyUp","key":value,"code":code})

    def is_open(number):
        return dashboard(cdp, f"return d.querySelector('#ma{number}UnitDropdownMenu').classList.contains('open') && d.querySelector('#ma{number}UnitDropdownTrigger').getAttribute('aria-expanded')==='true';")

    # Load the real comparison styles and its amount/cadence markup without
    # starting that dashboard's feeds or data pipeline.
    dashboard(cdp, """
      return (async()=>{
        const source=await (await w.fetch('../dca_comparison/dashboard.html')).text();
        const parsed=new w.DOMParser().parseFromString(source,'text/html');
        const frame=d.createElement('iframe'); frame.id='comparisonControlReference';
        frame.style.cssText='position:fixed;left:-20000px;top:0;width:1280px;height:900px;border:0';
        const styles=[...parsed.head.querySelectorAll('style,link[rel="stylesheet"]')].map(node=>node.outerHTML).join('');
        frame.srcdoc='<!doctype html><html><head>'+styles+'</head><body><div class="controls">'+parsed.querySelector('.dca-amount-cadence-chip').outerHTML+'</div></body></html>';
        const loaded=new Promise(resolve=>frame.onload=resolve);d.body.append(frame);await loaded;
        frame.contentDocument.querySelector('#cadenceDropdownMenu').innerHTML=['day','week','month'].map(unit=>'<button type="button" class="dca-option-btn" data-value="'+unit+'">'+unit+'</button>').join('');
      })();
    """)
    for width in (1280, 390, 320):
        cdp.command("Emulation.setDeviceMetricsOverride", {"width":width,"height":900,"deviceScaleFactor":1,"mobile":False})
        for theme in ("dark", "light"):
            dashboard(cdp, f"d.documentElement.dataset.theme={json.dumps(theme)};d.dispatchEvent(new w.CustomEvent('dashboard-theme-change'));const frame=d.querySelector('#comparisonControlReference');frame.style.width='{width}px';frame.contentDocument.documentElement.dataset.theme={json.dumps(theme)};")
            for number in (1, 2):
                mouse_click(f"#ma{number}UnitDropdownTrigger")
                assert is_open(number), (width, theme, number)
                mismatches = dashboard(cdp, f"""
                  const reference=d.querySelector('#comparisonControlReference').contentDocument;
                  const prefix='ma{number}',unit=d.getElementById(prefix+'Unit').value;
                  reference.querySelector('#cadenceDropdown').classList.add('is-open');
                  reference.querySelector('#cadenceDropdownMenu').classList.add('open');
                  reference.querySelectorAll('.dca-option-btn').forEach(button=>button.classList.toggle('dca-option-btn--selected',button.dataset.value===unit));
                  const pairs=[['#'+prefix+'Period','#amountInput'],['#'+prefix+'Period','.dca-amount-cadence-chip',true],
                    ['#'+prefix+'UnitDropdown','.dca-dropdown'],['#'+prefix+'UnitDropdownValue','#cadenceDropdownValue'],
                    ['#'+prefix+'UnitDropdownTrigger','#cadenceDropdownTrigger'],['#'+prefix+'UnitDropdownMenu','#cadenceDropdownMenu'],
                    ['#'+prefix+'UnitDropdownMenu .dca-option-btn','#cadenceDropdownMenu .dca-option-btn'],
                    ['#'+prefix+'UnitDropdownMenu .dca-option-btn--selected','#cadenceDropdownMenu .dca-option-btn--selected']];
                  const properties=['font-family','font-size','font-weight','line-height','padding','gap','min-height','color','background-color','border-top-width','border-top-color','border-radius','box-shadow'];
                  const diff=[];
                  for (let i=0;i<pairs.length;i++) {{
                    const [actualSelector,expectedSelector,chip]=pairs[i];
                    const actual=chip?d.querySelector(actualSelector).closest('.ma-input-group'):d.querySelector(actualSelector);
                    const a=w.getComputedStyle(actual),b=reference.defaultView.getComputedStyle(reference.querySelector(expectedSelector));
                    for(const property of properties)if(!(actualSelector.endsWith('Trigger') && property.startsWith('font-')) && a.getPropertyValue(property)!==b.getPropertyValue(property))
                      diff.push({{actualSelector,property,actual:a.getPropertyValue(property),expected:b.getPropertyValue(property)}});
                  }}
                  return diff;
                """)
                assert not mismatches, (width, theme, number, mismatches)
                key("Escape"); assert not is_open(number)
    dashboard(cdp, "d.querySelector('#comparisonControlReference').remove();d.documentElement.dataset.theme='dark';d.documentElement.scrollTop=0;w.dispatchEvent(new w.Event('resize'));")
    limits=dashboard(cdp, "return w.WSBMovingAverageDashboard.getModel().limits;")
    select_line(cdp, 1, limits["day"], "day")
    select_line(cdp, 2, limits["month"], "month")
    cdp.command("Emulation.setDeviceMetricsOverride", {"width":320,"height":900,"deviceScaleFactor":1,"mobile":False})
    for number in (1, 2):
        mouse_click(f"#ma{number}UnitDropdownTrigger")
        geometry=dashboard(cdp, f"""
          const input=d.querySelector('#ma{number}Period'),menu=d.querySelector('#ma{number}UnitDropdownMenu');
          return {{overflow:d.documentElement.scrollWidth>w.innerWidth+1,
            bounds:[input.closest('.ma-input-group'),menu].map(node=>{{const r=node.getBoundingClientRect();return {{left:r.left,right:r.right}};}}),
            textFits:input.scrollWidth<=input.clientWidth+1}};
        """)
        assert not geometry["overflow"] and geometry["textFits"] and all(box["left"]>=0 and box["right"]<=320 for box in geometry["bounds"]), geometry
        key("Escape")
    select_line(cdp, 1, 200, "day"); select_line(cdp, 2, 200, "week")
    cdp.command("Emulation.setDeviceMetricsOverride", {"width":1280,"height":900,"deviceScaleFactor":1,"mobile":False})

    for number in (1, 2):
        select_line(cdp, number, 200, "day")
        trigger=f"#ma{number}UnitDropdownTrigger"
        mouse_click(trigger); assert is_open(number)
        mouse_click(f'#ma{number}UnitDropdownMenu [data-value="week"]')
        assert state(cdp)["lines"][number-1] == {"period":200,"unit":"week","type":"sma"} and not is_open(number)
        dashboard(cdp, f"d.querySelector({json.dumps(trigger)}).focus();")
        key("ArrowDown"); assert is_open(number)
        assert state(cdp)["lines"][number-1]["unit"] == "month"
        key("ArrowUp"); assert state(cdp)["lines"][number-1]["unit"] == "week"
        key("Home"); assert state(cdp)["lines"][number-1]["unit"] == "day"
        key("End"); assert state(cdp)["lines"][number-1]["unit"] == "month"
        key("Escape"); assert not is_open(number)
        assert dashboard(cdp, "return d.activeElement.id;") == trigger[1:]
        key("Enter"); assert is_open(number)
        mouse_click(f"#ma{3-number}UnitDropdownTrigger")
        assert is_open(3-number) and not is_open(number)
        mouse_click("#rangeDaysInput"); assert not is_open(3-number)

        select_line(cdp, number, 3, "day")
        mouse_click(f"#ma{number}Period")
        narrow_width=dashboard(cdp, f"return d.querySelector('#ma{number}Period').getBoundingClientRect().width;")
        dashboard(cdp, f"d.querySelector('#ma{number}Period').select();")
        cdp.command("Input.insertText", {"text":"1234"})
        assert state(cdp)["lines"][number-1] == {"period":1234,"unit":"day","type":"sma"}
        formatted=dashboard(cdp, f"const input=d.querySelector('#ma{number}Period');return {{value:input.value,caret:input.selectionStart,width:input.getBoundingClientRect().width,focused:d.activeElement===input}};")
        assert formatted["value"] == "1,234" and formatted["caret"] == 5 and formatted["focused"] and formatted["width"] > narrow_width, formatted
        key("Enter"); assert dashboard(cdp, "return d.activeElement.id;") != f"ma{number}Period"
        # A unit with a smaller maximum leaves the plotted line unchanged until
        # the edited period becomes valid; it must not silently clamp it.
        prior=state(cdp)["lines"][number-1]
        mouse_click(trigger); mouse_click(f'#ma{number}UnitDropdownMenu [data-value="month"]')
        assert state(cdp)["lines"][number-1] == prior
        assert dashboard(cdp, f"return d.querySelector('#ma{number}Period').getAttribute('aria-invalid');") == "true"
        set_input(cdp, f"#ma{number}Period", 3)
        assert state(cdp)["lines"][number-1] == {"period":3,"unit":"month","type":"sma"}
        prior=state(cdp)["lines"][number-1]
        for invalid in ("2", "3.5", ""):
            mouse_click(f"#ma{number}Period")
            set_input(cdp, f"#ma{number}Period", invalid)
            dashboard(cdp, "d.dispatchEvent(new w.CustomEvent('dashboard-theme-change'));")
            assert state(cdp)["lines"][number-1] == prior
            assert dashboard(cdp, f"return d.querySelector('#ma{number}Period').value;") == invalid
        select_line(cdp, number, 200, "day" if number==1 else "week")
        dashboard(cdp, "d.activeElement?.blur();")
    assert_custom_control_sync(cdp)
    assert_clean(cdp)
    print("PASS custom controls: Comparison style parity, mouse/keyboard menus, formatted periods/caret, validation, independent settings", flush=True)


def check_reference_controls(cdp):
    dashboard(cdp, """
      const frame=d.createElement('iframe'); frame.id='athStyleReference';
      frame.src='../days_since_ath/dashboard.html';
      frame.style.cssText=`position:fixed;left:-20000px;top:0;width:${w.innerWidth}px;height:900px;border:0`;
      d.body.append(frame);
    """)
    wait_for(lambda: dashboard(cdp, "return !!d.querySelector('#athStyleReference')?.contentDocument?.querySelector('#startDateInput')?.value;"), description="Days Since ATH style reference")
    dashboard(cdp, """
      for (const doc of [d,d.querySelector('#athStyleReference').contentDocument]) {
        const style=doc.createElement('style'); style.id='styleParityNoTransitions';
        style.textContent='*,*::before,*::after{transition:none!important}'; doc.head.append(style);
      }
    """)
    for width in (1280, 390):
        cdp.command("Emulation.setDeviceMetricsOverride", {"width":width,"height":900,"deviceScaleFactor":1,"mobile":False})
        for theme in ("dark", "light"):
            dashboard(cdp, f"""
              const frame=d.querySelector('#athStyleReference'); frame.style.width='{width}px';
              d.documentElement.dataset.theme={json.dumps(theme)};
              frame.contentDocument.documentElement.dataset.theme={json.dumps(theme)};
            """)
            mismatches = dashboard(cdp, """
              const reference=d.querySelector('#athStyleReference').contentDocument;
              const properties=['font-family','font-size','font-weight','line-height','padding','gap','min-height','min-width',
                'color','background-color','border-top-color','border-top-width','border-radius','opacity','box-shadow','touch-action'];
              const selectors=['#startDateBtn','#endDateBtn','#rangeDaysInput','.date-range-days-segment',
                '[data-range-preset="1y"]','[data-range-preset="full"]','#playBtn','#pauseBtn','#stopBtn',
                '#speedBtn','#dashboardExpandBtn','#dateRangeDownloadBtn','#dateRangeSettingsBtn',
                '#dateRangeSliderWrap','#dateRangeStartSlider','#dateRangeEndSlider'];
              const diff=[];
              for (const selector of selectors) {
                const a=w.getComputedStyle(d.querySelector(selector));
                const b=reference.defaultView.getComputedStyle(reference.querySelector(selector));
                for (const property of properties) if(!(selector.includes('Slider') && property.startsWith('font-')) && a.getPropertyValue(property)!==b.getPropertyValue(property))
                  diff.push({selector,property,actual:a.getPropertyValue(property),expected:b.getPropertyValue(property)});
              }
              for (const pseudo of ['::before','::after']) {
                const a=w.getComputedStyle(d.querySelector('#dateRangeSliderWrap'),pseudo);
                const b=reference.defaultView.getComputedStyle(reference.querySelector('#dateRangeSliderWrap'),pseudo);
                for (const property of ['height','background-color','border-radius','cursor','transform'])
                  if(a.getPropertyValue(property)!==b.getPropertyValue(property))diff.push({pseudo,property,actual:a.getPropertyValue(property),expected:b.getPropertyValue(property)});
              }
              return diff;
            """)
            assert not mismatches, (width, theme, mismatches)
    dashboard(cdp, "d.querySelector('#athStyleReference').remove(); d.querySelector('#styleParityNoTransitions').remove(); d.documentElement.dataset.theme='dark';")
    cdp.command("Emulation.setDeviceMetricsOverride", {"width":1280,"height":900,"deviceScaleFactor":1,"mobile":False})
    assert_clean(cdp)
    print("PASS control styling: Days Since ATH parity in dark/light at desktop/mobile widths", flush=True)


def check_slider_ux(cdp):
    def index():
        return dashboard(cdp, "const app=w.WSBMovingAverageDashboard;return app.getModel().rows.findIndex(row=>row.date===app.getState().currentIso);")

    def drag_slider(first, last):
        rect = dashboard(cdp, "const r=d.querySelector('#dateRangeSliderWrap').getBoundingClientRect();return {left:r.left,width:r.width,y:r.top+r.height/2};")
        start_x, end_x = rect["left"] + rect["width"] * first, rect["left"] + rect["width"] * last
        cdp.command("Input.dispatchMouseEvent", {"type":"mousePressed","x":start_x,"y":rect["y"],"button":"left","buttons":1,"clickCount":1})
        cdp.command("Input.dispatchMouseEvent", {"type":"mouseMoved","x":end_x,"y":rect["y"],"button":"left","buttons":1})
        cdp.command("Input.dispatchMouseEvent", {"type":"mouseReleased","x":end_x,"y":rect["y"],"button":"left","buttons":0,"clickCount":1})

    click(cdp, "#playBtn")
    assert dashboard(cdp, "return d.querySelector('#playBtn').getAttribute('aria-pressed');") == "true"
    click(cdp, "#pauseBtn")
    set_input(cdp, "#dateRangeEndSlider", 1000)
    assert dashboard(cdp, "return d.querySelector('#endDateInput').value;") == state(cdp)["currentIso"]
    assert dashboard(cdp, "return Number(d.querySelector('#dateRangeEndSlider').value);") == index()
    assert dashboard(cdp, "return d.querySelector('#rangeDaysInput').value;") == "1,001"
    assert dashboard(cdp, "return d.querySelector('#dateRangeSelection').classList.contains('active');")
    assert dashboard(cdp, "return parseFloat(d.querySelector('#dateRangeSelection').style.left)>0 && !d.querySelector('#dateRangeSelection').style.width;")
    for key, code, delta in ((".", "Period", 1), (",", "Comma", -1), ("ArrowRight", "ArrowRight", 600)):
        before = index()
        dashboard(cdp, f"d.activeElement?.blur();d.dispatchEvent(new w.KeyboardEvent('keydown',{{key:{json.dumps(key)},code:{json.dumps(code)},bubbles:true}}));")
        assert index() == before + delta, (key, before, index())
    maximum = dashboard(cdp, "return w.WSBMovingAverageDashboard.getModel().rows.length-1;")
    original_end = state(cdp)["endIso"]
    drag_slider(index() / maximum, .5)
    assert abs(index() - maximum * .5) <= 2
    assert state(cdp)["endIso"] == original_end and state(cdp)["pausedPlayback"]
    click(cdp, "#playBtn")
    drag_slider(index() / maximum, .6)
    assert dashboard(cdp, "return w.WSBMovingAverageDashboard.isPlaying();"), "Scrubbing failed to resume playback"
    click(cdp, "#pauseBtn")
    click(cdp, "#stopBtn")
    assert state(cdp)["currentIso"] == original_end and not state(cdp)["pausedPlayback"]

    # Dragging the start handle during a paused session edits the visible range.
    click(cdp, "#playBtn"); click(cdp, "#pauseBtn")
    set_input(cdp, "#dateRangeEndSlider", int(maximum * .5))
    current_end = state(cdp)["currentIso"]
    drag_slider(0, .1)
    assert not state(cdp)["pausedPlayback"] and state(cdp)["endIso"] == current_end
    before_span = dashboard(cdp, "const s=w.WSBMovingAverageDashboard.getState();return Date.parse(s.endIso)-Date.parse(s.startIso);")
    before_start = state(cdp)["startIso"]
    drag_slider(.3, .35)
    assert state(cdp)["startIso"] > before_start
    assert dashboard(cdp, "const s=w.WSBMovingAverageDashboard.getState();return Date.parse(s.endIso)-Date.parse(s.startIso);") == before_span

    # A redraw must not erase a partially entered range length.
    dashboard(cdp, "const input=d.querySelector('#rangeDaysInput');input.focus();input.value='1,2';d.dispatchEvent(new w.CustomEvent('dashboard-theme-change'));")
    assert dashboard(cdp, "return d.querySelector('#rangeDaysInput').value;") == "1,2"
    set_input(cdp, "#rangeDaysInput", "1,234", "change")
    assert dashboard(cdp, "const s=w.WSBMovingAverageDashboard.getState();return (Date.parse(s.currentIso)-Date.parse(s.startIso))/86400000+1;") == 1234
    dashboard(cdp, "d.activeElement?.blur();")
    click(cdp, '#rangeButtons [data-range-preset="full"]')
    assert_clean(cdp)
    print("PASS slider UX: moving end handle/date, remaining segment, keyboard steps, scrub/resume, start/range dragging, focused input", flush=True)


def check_playback(cdp):
    initial = state(cdp)
    hover_chart(cdp)
    click(cdp, "#playBtn")
    assert dashboard(cdp, "return d.querySelector('#chartTooltip').hidden;"), "Play retained stale hover values"
    click(cdp, "#pauseBtn")
    set_input(cdp, "#dateRangeEndSlider", 1000)
    hover_chart(cdp)
    set_input(cdp, "#dateRangeEndSlider", 0)
    assert dashboard(cdp, "return d.querySelector('#chartTooltip').hidden;"), "Seeking retained stale hover values"
    early = state(cdp)
    assert early["currentIso"] == early["startIso"]
    assert early["lines"] == initial["lines"] and early["endIso"] == initial["endIso"]
    assert dashboard(cdp, "return ['#ma1Kpi','#ma2Kpi'].every(id=>d.querySelector(id).textContent==='Insufficient history');")
    assert_spans(cdp)
    assert dashboard(cdp, "return Number(d.querySelector('#ma2Period').max)===w.WSBMovingAverageDashboard.getModel().limits.week;")
    dashboard(cdp, "d.activeElement?.blur(); d.dispatchEvent(new w.KeyboardEvent('keydown',{key:'ArrowRight',code:'ArrowRight',bubbles:true}));")
    after = state(cdp)
    assert after["currentIso"] > early["currentIso"], (early, after)
    dashboard(cdp, "d.dispatchEvent(new w.KeyboardEvent('keydown',{key:' ',code:'Space',bubbles:true}));")
    assert dashboard(cdp, "return w.WSBMovingAverageDashboard.isPlaying();")
    click(cdp, "#pauseBtn")
    assert not dashboard(cdp, "return w.WSBMovingAverageDashboard.isPlaying();")
    click(cdp, "#stopBtn")
    assert state(cdp)["currentIso"] == state(cdp)["endIso"] and not state(cdp)["pausedPlayback"]
    set_input(cdp, "#startDateInput", "2020-01-01", "change")
    set_input(cdp, "#endDateInput", "2024-05-31", "change")
    assert state(cdp)["startIso"] == "2020-01-01" and state(cdp)["endIso"] == "2024-05-31"
    click(cdp, "#startDateBtn")
    assert dashboard(cdp, "return !!d.querySelector('.date-picker-popup');"), "Custom calendar did not open"
    dashboard(cdp, "[...d.querySelectorAll('.date-picker-day')].find(day=>day.textContent==='2').click();")
    assert state(cdp)["startIso"] == "2020-01-02", "Custom calendar did not select the day"
    select_line(cdp, 1, 3, "month")
    select_line(cdp, 2, 20, "week")
    assert_spans(cdp)
    assert dashboard(cdp, "return d.querySelector('#window1Chart').dataset.startDate;") == "2024-02-29"
    assert_clean(cdp)
    print("PASS playback: early insufficient history, preserved periods/limits, keyboard, dates, leap-month spans", flush=True)


def check_synchronized_hover(cdp):
    # Observe actual dashed canvas strokes, rather than merely checking the
    # hover index passed into the renderer. The normal renderer still runs.
    dashboard(cdp, """
      const fixture=w.__maFixture, charts=w.WSBMovingAverageCharts;
      fixture.hoverPanels={}; fixture.originalPanel=charts.panel;
      charts.panel=function(ctx,rect,options) {
        const native={}, guides=[]; let path=[], geometry;
        for(const method of ['beginPath','moveTo','lineTo','stroke']) native[method]=ctx[method];
        ctx.beginPath=function(...args){path=[];return native.beginPath.apply(this,args);};
        ctx.moveTo=function(x,y){path.push({x,y});return native.moveTo.call(this,x,y);};
        ctx.lineTo=function(x,y){path.push({x,y});return native.lineTo.call(this,x,y);};
        ctx.stroke=function(...args){
          if(this.getLineDash().some(value=>value>0) && path.length===2 && Math.abs(path[0].x-path[1].x)<.01)
            guides.push({path:path.map(point=>({...point})),width:this.lineWidth,color:this.strokeStyle,dash:this.getLineDash()});
          return native.stroke.apply(this,args);
        };
        try {geometry=fixture.originalPanel.call(this,ctx,rect,options);}
        finally {for(const method of Object.keys(native)) ctx[method]=native[method];}
        fixture.hoverPanels[ctx.canvas.id]={geometry,guides}; return geometry;
      };
      const reference=d.createElement('iframe'); reference.id='uoaTooltipReference';
      reference.style.cssText='position:fixed;left:-20000px;top:0;width:600px;height:400px;border:0';
      reference.srcdoc='<!doctype html><html><head><link rel="stylesheet" href="../shared/dashboard_shared.css"><link rel="stylesheet" href="../shared/dashboard_controls.css"><link rel="stylesheet" href="../uoa/dashboard.css"></head><body><div class="chart-hover-value-tooltip"><div class="chart-hover-tooltip-date">Date</div><div class="chart-hover-tooltip-value">Value</div></div></body></html>';
      d.body.append(reference);
      w.dispatchEvent(new w.Event('resize'));
    """)
    wait_for(lambda: dashboard(cdp, "const reference=d.querySelector('#uoaTooltipReference').contentDocument;return reference?.styleSheets.length===3 && reference.querySelector('.chart-hover-tooltip-date') && reference.defaultView.getComputedStyle(reference.querySelector('.chart-hover-tooltip-date')).marginBottom==='3px';"), description="UoA tooltip style reference")

    def move(chart_id, date=None, corner=None):
        dashboard(cdp, f"d.getElementById({json.dumps(chart_id)}).scrollIntoView({{block:'center'}});return new Promise(resolve=>w.requestAnimationFrame(()=>w.requestAnimationFrame(resolve)));")
        position = dashboard(cdp, f"""
          const id={json.dumps(chart_id)}, rect=d.getElementById(id).getBoundingClientRect();
          const g=w.__maFixture.hoverPanels[id].geometry, p=g.plot;
          const date={json.dumps(date)}, corner={json.dumps(corner)};
          let x=p.left+p.width/2, y=p.top+p.height/2;
          if(date) x=p.left+(Date.parse(date)-g.startTime-864000)/(g.endTime-g.startTime)*p.width;
          if(corner) {{x=corner.includes('left')?p.left+2:p.right-2;y=corner.includes('top')?p.top+2:p.bottom-2;}}
          return w.__maFixture.hoverPointer={{x:rect.left+x,y:rect.top+y}};
        """)
        cdp.command("Input.dispatchMouseEvent", {"type":"mouseMoved", **position})
        return position

    def assert_guides(source, count=None):
        result = dashboard(cdp, rf"""
          const fixture=w.__maFixture, tip=d.querySelector('#chartTooltip'), date=tip.textContent.split('\n')[0];
          const time=Date.parse(date), box=tip.getBoundingClientRect(), source=d.getElementById({json.dumps(source)}).getBoundingClientRect();
          const sourceGeometry=fixture.hoverPanels[{json.dumps(source)}].geometry;
          const colorContext=d.createElement('canvas').getContext('2d');
          colorContext.strokeStyle=d.documentElement.dataset.theme==='light'?'rgba(75,85,99,.55)':'rgba(120,120,120,.7)';
          const reference=d.querySelector('#uoaTooltipReference').contentDocument;
          reference.documentElement.dataset.theme=d.documentElement.dataset.theme;
          const styleDiff=[], compareStyle=(actual,expected,properties)=>{{
            if(!actual) {{styleDiff.push({{missing:expected.className}});return;}}
            const a=w.getComputedStyle(actual),b=reference.defaultView.getComputedStyle(expected);
            for(const property of properties) if(a.getPropertyValue(property)!==b.getPropertyValue(property))
              styleDiff.push({{element:actual.className,property,actual:a.getPropertyValue(property),expected:b.getPropertyValue(property)}});
          }};
          compareStyle(tip,reference.querySelector('.chart-hover-value-tooltip'),['font-family','font-size','line-height','padding','border-top-color','border-top-width','border-radius','background-color','color','box-shadow']);
          compareStyle(tip.firstElementChild,reference.querySelector('.chart-hover-tooltip-date'),['font-family','font-size','line-height','font-weight','margin-bottom','color']);
          const palette=w.WSBMovingAverageCharts.palette(d.documentElement.dataset.theme),colors=[palette.fg,...palette.lines];
          const valueRows=[...tip.children].slice(1),referenceValue=reference.querySelector('.chart-hover-tooltip-value');
          if(valueRows.length!==3) styleDiff.push({{valueRows:valueRows.length,expected:3}});
          valueRows.forEach((row,i)=>{{
            referenceValue.style.color=colors[i];
            compareStyle(row,referenceValue,['font-family','font-size','line-height','font-weight','font-variant-numeric','color']);
          }});
          return {{hidden:tip.hidden,date,time,visibleTooltips:d.querySelectorAll('.chart-tooltip:not([hidden])').length,
            styleDiff,
            contained:box.left>=Math.max(0,source.left)-1 && box.right<=Math.min(w.innerWidth,source.right)+1 && box.top>=Math.max(0,source.top)-1 && box.bottom<=Math.min(w.innerHeight,source.bottom)+1,
            box:{{left:box.left,right:box.right,top:box.top,bottom:box.bottom,height:box.height}},
            guideX:source.left+sourceGeometry.plot.left+(time-sourceGeometry.startTime)/(sourceGeometry.endTime-sourceGeometry.startTime)*sourceGeometry.plot.width,
            cursorY:fixture.hoverPointer.y,expectedColor:colorContext.strokeStyle,
            bounds:{{left:Math.max(8,source.left+sourceGeometry.plot.left+8),right:Math.min(w.innerWidth-8,source.left+sourceGeometry.plot.right-8),top:Math.max(8,source.top+sourceGeometry.plot.top),bottom:Math.min(w.innerHeight-8,source.top+sourceGeometry.plot.bottom)}},
            panels:Object.entries(fixture.hoverPanels).map(([id,{{geometry:g,guides}}])=>({{id,
              expected:time>=g.startTime && time<=g.endTime,
              guides:guides.map(({{path,width,color,dash}})=>({{width,color,dash,time:g.startTime+(path[0].x-g.plot.left)/g.plot.width*(g.endTime-g.startTime),
                fullHeight:Math.abs(path[0].y-g.plot.top)<.01 && Math.abs(path[1].y-g.plot.bottom)<.01}}))}}))}};
        """)
        assert not result["hidden"] and result["visibleTooltips"] == 1, result
        assert not result["styleDiff"], (source, result["styleDiff"])
        assert result["contained"], (source, result)
        box, bounds = result["box"], result["bounds"]
        assert box["left"] >= bounds["left"]-1 and box["right"] <= bounds["right"]+1, (source, "Tooltip overlaps the axis gutter", result)
        expected_top = max(bounds["top"], min(result["cursorY"] - box["height"] / 2, bounds["bottom"] - box["height"]))
        assert abs(box["top"] - expected_top) < 1, (source, result)
        # UoA anchors to the selected date guide, ten pixels to either side.
        # A narrow panel can clamp the box if neither side has enough room.
        assert (abs(box["left"] - result["guideX"] - 10) < 1
                or abs(result["guideX"] - box["right"] - 10) < 1
                or abs(box["left"] - bounds["left"]) < 1
                or abs(box["right"] - bounds["right"]) < 1), (source, result)
        actual_count = 0
        for panel in result["panels"]:
            assert len(panel["guides"]) == int(panel["expected"]), panel
            for guide in panel["guides"]:
                assert abs(guide["time"] - result["time"]) < 1 and guide["fullHeight"], panel
                assert guide["width"] == 1 and guide["dash"] == [3, 3] and guide["color"] == result["expectedColor"], panel
                actual_count += 1
        if count is not None:
            assert actual_count == count, result

    def assert_clear():
        result = dashboard(cdp, "return {hidden:d.querySelector('#chartTooltip').hidden,panels:w.__maFixture.hoverPanels};")
        assert result["hidden"] and all(not panel["guides"] for panel in result["panels"].values()), result

    set_input(cdp, "#startDateInput", "2020-01-01", "change")
    set_input(cdp, "#endDateInput", "2024-05-31", "change")
    for source in ("historyChart", "window1Chart", "window2Chart"):
        move(source, "2024-04-15")
        assert_guides(source, 3)
    # Different spans share a date, not a screen position; off-window guides
    # disappear instead of being clamped to the other panel's edge.
    move("historyChart", "2022-06-15"); assert_guides("historyChart", 2)
    move("historyChart", "2020-02-01"); assert_guides("historyChart", 1)
    set_input(cdp, "#startDateInput", "2024-05-01", "change")
    move("window1Chart", "2024-04-15"); assert_guides("window1Chart", 2)

    for width in (1280, 390, 320):
        cdp.command("Emulation.setDeviceMetricsOverride", {"width":width,"height":900,"deviceScaleFactor":1,"mobile":False})
        dashboard(cdp, "w.dispatchEvent(new w.Event('resize'));")
        for theme in ("dark", "light"):
            dashboard(cdp, f"d.documentElement.dataset.theme={json.dumps(theme)};d.dispatchEvent(new w.CustomEvent('dashboard-theme-change'));")
            assert_clear()
            for source in ("historyChart", "window1Chart", "window2Chart"):
                move(source); assert_guides(source)
                for corner in ("top-left", "top-right", "bottom-left", "bottom-right"):
                    move(source, corner=corner); assert_guides(source)
                    if width==1280 and theme=="dark" and source=="historyChart" and corner=="bottom-right":
                        screenshot=cdp.command("Page.captureScreenshot",{"format":"png","captureBeyondViewport":False})
                        Path("/tmp/wsb-moving-average-tooltip-axis.png").write_bytes(base64.b64decode(screenshot["data"]))
        # Axis margins are still inside the canvas but outside its data plot.
        margin = dashboard(cdp, "const r=d.querySelector('#window2Chart').getBoundingClientRect();return {x:r.left+2,y:r.top+r.height/2};")
        cdp.command("Input.dispatchMouseEvent", {"type":"mouseMoved", **margin}); assert_clear()
        move("window2Chart", corner="top-right")
        cdp.command("Input.dispatchMouseEvent", {"type":"mouseMoved","x":1,"y":1}); assert_clear()

    cdp.command("Emulation.setDeviceMetricsOverride", {"width":1280,"height":900,"deviceScaleFactor":1,"mobile":False})
    dashboard(cdp, "d.documentElement.dataset.theme='dark'; w.dispatchEvent(new w.Event('resize'));")
    position = move("historyChart", "2024-05-15")
    cdp.command("Input.dispatchMouseEvent", {"type":"mousePressed",**position,"button":"left","buttons":1,"clickCount":1})
    assert_clear()
    cdp.command("Input.dispatchMouseEvent", {"type":"mouseMoved","x":position["x"]+10,"y":position["y"],"button":"left","buttons":1})
    assert_clear()
    cdp.command("Input.dispatchMouseEvent", {"type":"mouseReleased","x":position["x"]+10,"y":position["y"],"button":"left","buttons":0,"clickCount":1})
    move("window1Chart", corner="top-right")
    click(cdp, "#playBtn"); assert_clear()
    move("historyChart", corner="top-right"); assert_clear()
    click(cdp, "#pauseBtn")
    click(cdp, "#stopBtn")
    click(cdp, '#rangeButtons [data-range-preset="full"]')
    set_input(cdp, "#dateRangeEndSlider", 3)
    move("window2Chart", corner="top-left"); assert_clear()
    click(cdp, "#stopBtn")
    dashboard(cdp, "w.WSBMovingAverageCharts.panel=w.__maFixture.originalPanel; d.querySelector('#uoaTooltipReference').remove(); d.documentElement.scrollTop=0; w.dispatchEvent(new w.Event('resize'));")
    assert_clean(cdp)
    print("PASS hover: UoA guide/tooltip style parity, synchronized dates, centered placement outside axis gutters, light/dark desktop/mobile edges, leave/drag/playback cleanup", flush=True)


def check_sharing(cdp, direct):
    click(cdp, "#playBtn")
    click(cdp, "#pauseBtn")
    set_input(cdp, "#dateRangeEndSlider", dashboard(cdp, "return w.WSBMovingAverageDashboard.getModel().rows.findIndex(row=>row.date==='2022-06-01');"))
    saved = state(cdp)
    link = copy_link(cdp)
    assert "/moving_average.html?" in link, link
    navigate(cdp, link + "&fixture_conflict=1", standalone=True)
    assert state(cdp) == saved, (saved, state(cdp))
    assert_custom_control_sync(cdp)
    assert not dashboard(cdp, "return w.WSBMovingAverageDashboard.isPlaying();")
    assert_spans(cdp)
    # The recipient's actual interaction persists the URL-selected view.
    click(cdp, "#speedBtn")
    persisted = state(cdp)
    navigate(cdp, direct)
    assert state(cdp) == persisted, (persisted, state(cdp))
    assert_custom_control_sync(cdp)
    click(cdp, "#resetDashboard")
    assert state(cdp)["lines"] == [{"period":200,"unit":"day","type":"sma"},{"period":200,"unit":"week","type":"sma"}]
    assert_custom_control_sync(cdp)
    click(cdp, "#resetDashboard")
    assert state(cdp) == persisted
    assert_custom_control_sync(cdp)
    assert_clean(cdp)
    print("PASS sharing: standalone/embedded roundtrip over conflicting storage, paused frame, persistence, reset/undo", flush=True)


def check_refresh(cdp):
    before = state(cdp)
    signature = dashboard(cdp, "return w.WSBMovingAverageDashboard.getInstalledSignature();")
    dashboard(cdp, "w.__maFixture.generation=1; w.__maFixture.mode='fail'; w.WSBWebappDataAutoRefresh.requestCheck('fixture-failure');")
    wait_for(lambda: dashboard(cdp, "return w.__maFixture.events.some(event=>event.status==='error');"), description="failed refresh")
    assert state(cdp) == before
    assert dashboard(cdp, "return w.WSBMovingAverageDashboard.getInstalledSignature();") == signature
    assert dashboard(cdp, "return !d.querySelector('#loadStatus').hidden;")
    dashboard(cdp, "w.__maFixture.mode='pass'; w.WSBWebappDataAutoRefresh.requestCheck('fixture-recover');")
    wait_for(lambda: dashboard(cdp, "return JSON.parse(w.WSBMovingAverageDashboard.getInstalledSignature()).fixture_generation===1;"), description="refresh recovery")
    assert state(cdp) == before
    dashboard(cdp, "w.__maFixture.mode='hold'; w.__maFixture.generation=2; w.WSBWebappDataAutoRefresh.requestCheck('fixture-race');")
    wait_for(lambda: dashboard(cdp, "return w.__maFixture.pending.length;"), description="held payload")
    assert dashboard(cdp, "return JSON.parse(w.WSBMovingAverageDashboard.getInstalledSignature()).fixture_generation;") == 1
    dashboard(cdp, "w.__maFixture.generation=3; w.__maFixture.mode='pass'; w.__maFixture.pending.splice(0).forEach(resolve=>resolve());")
    wait_for(lambda: dashboard(cdp, "return JSON.parse(w.WSBMovingAverageDashboard.getInstalledSignature()).fixture_generation===3;"), description="superseded generation skipped")
    assert state(cdp) == before
    assert not dashboard(cdp, "return w.__maFixture.events.some(event=>event.status==='applied' && event.signature && JSON.parse(event.signature).fixture_generation===2);")
    dashboard(cdp, "w.__maFixture.mode='corrupt'; w.__maFixture.generation=4; w.WSBWebappDataAutoRefresh.requestCheck('fixture-corrupt');")
    wait_for(lambda: dashboard(cdp, "return w.__maFixture.events.filter(event=>event.status==='error').length>=2;"), description="truncated payload rejection")
    assert dashboard(cdp, "return JSON.parse(w.WSBMovingAverageDashboard.getInstalledSignature()).fixture_generation;") == 3
    dashboard(cdp, "w.__maFixture.mode='pass'; w.WSBWebappDataAutoRefresh.requestCheck('fixture-final');")
    wait_for(lambda: dashboard(cdp, "return JSON.parse(w.WSBMovingAverageDashboard.getInstalledSignature()).fixture_generation===4;"), description="final refresh recovery")
    assert state(cdp) == before
    dashboard(cdp, "d.querySelector('#dateRangeEndSlider').dispatchEvent(new w.PointerEvent('pointerdown',{pointerId:77,button:0,bubbles:true}));w.__maFixture.generation=5;w.WSBWebappDataAutoRefresh.requestCheck('fixture-drag');")
    wait_for(lambda: dashboard(cdp, "return w.__maFixture.events.some(event=>event.status==='deferred' && JSON.parse(event.signature).fixture_generation===5);"), description="drag defers publication")
    assert dashboard(cdp, "return JSON.parse(w.WSBMovingAverageDashboard.getInstalledSignature()).fixture_generation;") == 4
    dashboard(cdp, "d.querySelector('#dateRangeEndSlider').dispatchEvent(new w.PointerEvent('pointerup',{pointerId:77,button:0,bubbles:true}));")
    wait_for(lambda: dashboard(cdp, "return JSON.parse(w.WSBMovingAverageDashboard.getInstalledSignature()).fixture_generation===5;"), description="fresh publication after drag release")
    assert state(cdp) == before
    print("PASS refresh: network failure, truncated CSV, superseded candidate, drag deferral/recovery, retained playback/settings", flush=True)


def check_layout_and_export(cdp):
    for width, height in ((1280, 900), (390, 844), (320, 844)):
        cdp.command("Emulation.setDeviceMetricsOverride", {"width":width,"height":height,"deviceScaleFactor":1,"mobile":width<500})
        for theme in ("light", "dark"):
            dashboard(cdp, f"w.dispatchEvent(new w.MessageEvent('message',{{data:{{type:'quantum-dashboard-theme',theme:{json.dumps(theme)}}}}})); w.dispatchEvent(new w.Event('resize'));")
            assert dashboard(cdp, "return d.documentElement.scrollWidth <= w.innerWidth + 1;"), dashboard(cdp, "return {width:w.innerWidth,scroll:d.documentElement.scrollWidth};")
            assert dashboard(cdp, "return ['historyChart','window1Chart','window2Chart'].every(id=>{const r=d.getElementById(id).getBoundingClientRect();return r.width>100&&r.height>100;});")
    cdp.command("Emulation.setDeviceMetricsOverride", {"width":1280,"height":900,"deviceScaleFactor":1,"mobile":False})
    set_input(cdp, "#startDateInput", "2024-05-28", "change")
    set_input(cdp, "#endDateInput", "2024-05-31", "change")
    select_line(cdp, 1, 3, "month")
    select_line(cdp, 2, 20, "week")
    click(cdp, "#dateRangeSettingsBtn")
    dashboard(cdp, "const checkbox=d.querySelector('#downloadEndFrameHoldToggle'); checkbox.checked=false; checkbox.dispatchEvent(new w.Event('change',{bubbles:true}));")
    click(cdp, '#downloadFpsSelect button[data-value="60"]')
    dashboard(cdp, """
      const original=w.WSBDashboardExport.encodeWebM;
      w.WSBDashboardExport.encodeWebM=options=>{
        w.__maFixture.exportFrames=[...options.frames]; w.__maFixture.renderedFrames=[];
        const render=options.renderFrame;
        return original({...options,renderFrame:async (...args)=>{w.__maFixture.renderedFrames.push(args[0]);return render(...args);}});
      };
      const composite=w.WSBMovingAverageCharts.composite;
      w.WSBMovingAverageCharts.composite=(ctx,width,height,options)=>{
        w.__maFixture.lastExport={lines:options.lines,scales:options.scales,date:options.model.rows[options.endIndex].date};
        return composite(ctx,width,height,options);
      };
    """)
    click(cdp, "#downloadImageBtn")
    wait_for(lambda: dashboard(cdp, "return w.__maFixture.downloads.some(item=>item.name.endsWith('.png'));"), description="PNG export")
    result = dashboard(cdp, "return (async()=>{const item=w.__maFixture.downloads.find(item=>item.name.endsWith('.png'));const bitmap=await createImageBitmap(item.blob);return {size:item.blob.size,width:bitmap.width,height:bitmap.height,signature:Array.from(new Uint8Array(await item.blob.slice(0,8).arrayBuffer()))};})();")
    assert result["size"] > 1000 and result["width"] == 1280 and result["height"] == 720, result
    assert result["signature"] == [137,80,78,71,13,10,26,10], result
    assert dashboard(cdp, "return w.__maFixture.lastExport.lines;") == state(cdp)["lines"]
    assert dashboard(cdp, "return w.WSBDashboardExport.hasWebCodecsExportSupport();"), "Chrome lacks required WebCodecs export support"
    click(cdp, "#dateRangeDownloadBtn")
    wait_for(lambda: dashboard(cdp, "return w.__maFixture.downloads.some(item=>item.name.endsWith('.webm'));"), timeout=60, description="actual deterministic WebM export")
    result = dashboard(cdp, "return (async()=>{const item=w.__maFixture.downloads.find(item=>item.name.endsWith('.webm'));return {size:item.blob.size,type:item.blob.type,signature:Array.from(new Uint8Array(await item.blob.slice(0,4).arrayBuffer())),frames:w.__maFixture.exportFrames,rendered:w.__maFixture.renderedFrames,last:w.__maFixture.lastExport};})();")
    assert result["size"] > 1000 and result["type"] == "video/webm", result
    assert result["signature"] == [26,69,223,163], result
    assert len(result["frames"]) == 4 and result["frames"] == result["rendered"], result
    assert result["last"]["date"] == "2024-05-31" and result["last"]["lines"] == state(cdp)["lines"]
    click(cdp, "#playBtn"); click(cdp, "#pauseBtn")
    set_input(cdp, "#dateRangeEndSlider", dashboard(cdp, "return w.WSBMovingAverageDashboard.getModel().rows.findIndex(row=>row.date==='2024-05-30');"))
    prior_downloads = dashboard(cdp, "return w.__maFixture.downloads.length;")
    click(cdp, "#dateRangeDownloadBtn")
    wait_for(lambda: dashboard(cdp, f"return w.__maFixture.downloads.length>{prior_downloads};"), timeout=60, description="paused-range WebM export")
    result = dashboard(cdp, "return {name:w.__maFixture.downloads.at(-1).name,frames:w.__maFixture.exportFrames,last:w.__maFixture.lastExport};")
    assert len(result["frames"]) == 3 and result["last"]["date"] == "2024-05-30", result
    assert result["name"].endswith("2024-05-30.webm"), result
    assert state(cdp)["endIso"] == "2024-05-31", "Export changed the playback target"
    assert_clean(cdp)
    print("PASS presentation: dark/light desktop/mobile, three canvases, real PNG/WebM, export ends at visible paused date", flush=True)


def check_export_refresh(cdp):
    before = state(cdp)
    old_signature = dashboard(cdp, "return w.WSBMovingAverageDashboard.getInstalledSignature();")
    old_generation = json.loads(old_signature)["fixture_generation"]
    pending_generation, latest_generation = old_generation + 1, old_generation + 2
    errors = dashboard(cdp, "return w.__maFixture.events.filter(event=>event.status==='error').length;")
    downloads = dashboard(cdp, "return w.__maFixture.downloads.length;")
    dashboard(cdp, """
      const encode=w.WSBDashboardExport.encodeWebM;
      w.WSBDashboardExport.encodeWebM=async options=>{
        await new Promise(resolve=>{w.__maFixture.releaseExport=resolve;});
        return encode(options);
      };
    """)
    click(cdp, "#dateRangeDownloadBtn")
    wait_for(lambda: dashboard(cdp, "return typeof w.__maFixture.releaseExport==='function';"), description="held export")
    assert dashboard(cdp, "return d.querySelector('#ma1Period').disabled;"), "Export did not freeze controls"
    dashboard(cdp, f"w.__maFixture.generation={pending_generation}; w.WSBWebappDataAutoRefresh.requestCheck('fixture-export-pending');")
    wait_for(lambda: dashboard(cdp, f"return w.__maFixture.events.some(event=>event.status==='deferred' && JSON.parse(event.signature).fixture_generation==={pending_generation});"), description="export defers new generation")
    assert dashboard(cdp, "return w.WSBMovingAverageDashboard.getInstalledSignature();") == old_signature
    assert dashboard(cdp, "return w.WSBWebappDataAutoRefresh.getStatus().acceptedSignature;") == old_signature
    assert state(cdp) == before
    # A newer marker arrives while encoding is held. Its failed payload must
    # retain the original installation, rather than install the queued stale one.
    dashboard(cdp, f"w.__maFixture.generation={latest_generation}; w.__maFixture.mode='fail'; w.__maFixture.releaseExport();")
    wait_for(lambda: dashboard(cdp, f"return w.__maFixture.downloads.length>{downloads} && !d.querySelector('#ma1Period').disabled;"), timeout=60, description="held export finishes")
    wait_for(lambda: dashboard(cdp, f"return w.__maFixture.events.filter(event=>event.status==='error').length>{errors};"), description="post-export marker recheck")
    assert dashboard(cdp, "return w.WSBMovingAverageDashboard.getInstalledSignature();") == old_signature
    assert not dashboard(cdp, f"return w.__maFixture.events.some(event=>event.status==='applied' && JSON.parse(event.signature).fixture_generation==={pending_generation});")
    assert state(cdp) == before
    dashboard(cdp, "w.__maFixture.mode='pass'; w.WSBWebappDataAutoRefresh.requestCheck('fixture-export-recover');")
    wait_for(lambda: dashboard(cdp, f"return JSON.parse(w.WSBMovingAverageDashboard.getInstalledSignature()).fixture_generation==={latest_generation};"), description="post-export generation recovery")
    assert state(cdp) == before
    assert_clean(cdp)
    print("PASS export refresh: deferred commit, fresh marker after encoding, failed newer payload retains old data", flush=True)


def check_average_types(cdp, direct):
    navigate(cdp,direct+'?fixture_reset=1')
    assert_custom_control_sync(cdp)
    assert dashboard(cdp,"return [...d.querySelector('#ma1Type').options].map(option=>option.value);") == ["sma","ema"]
    assert dashboard(cdp,"return [...d.querySelector('#ma2Type').options].map(option=>option.value);") == ["sma","ema","none"]
    dashboard(cdp,"d.querySelector('#ma1TypeDropdownTrigger').focus();")
    for event in ("keyDown","keyUp"):
        cdp.command("Input.dispatchKeyEvent",{"type":event,"key":"ArrowDown","code":"ArrowDown"})
    assert state(cdp)["lines"][0]["type"] == "ema"
    assert dashboard(cdp,"return d.querySelector('#ma1TypeDropdownMenu').classList.contains('open');")
    for event in ("keyDown","keyUp"):
        cdp.command("Input.dispatchKeyEvent",{"type":event,"key":"Escape","code":"Escape"})
    assert dashboard(cdp,"return d.activeElement.id==='ma1TypeDropdownTrigger' && !d.querySelector('#ma1TypeDropdownMenu').classList.contains('open');")
    select_type(cdp,2,"ema")
    for number in (1,2):
        for unit in ("day","week","month"):
            select_line(cdp,number,9,unit)
            result=dashboard(cdp,f"""
              const app=w.WSBMovingAverageDashboard,line=app.getState().lines[{number-1}],M=w.WSBMovingAverageModel;
              const actual=app.getSeries()[{number-1}],sma=M.calculate(app.getModel(),{{...line,type:'sma'}});
              return {{line,label:d.querySelector('#ma{number}KpiLabel').textContent,
                correct:JSON.stringify(actual)===JSON.stringify(M.calculate(app.getModel(),line)),different:actual.at(-1)!==sma.at(-1)}};
            """)
            assert result["line"] == {"period":9,"unit":unit,"type":"ema"} and result["correct"] and result["different"],result
            assert result["label"] == '9'+{"day":"D","week":"W","month":"M"}[unit]+' EMA',result
    select_line(cdp,1,9,"day");select_line(cdp,2,17,"month")
    second=state(cdp)["lines"][1].copy()
    dashboard(cdp,"const canvas=d.querySelector('#window2Chart'),r=canvas.getBoundingClientRect();canvas.dispatchEvent(new w.PointerEvent('pointermove',{clientX:r.left+r.width/2,clientY:r.top+r.height/2,bubbles:true}));")
    assert dashboard(cdp,"return !d.querySelector('#chartTooltip').hidden;")
    select_type(cdp,2,"none")
    assert dashboard(cdp,"return d.querySelector('#chartTooltip').hidden;")
    assert state(cdp)["lines"][1] == {**second,"type":"none"}
    assert dashboard(cdp,"return w.WSBMovingAverageDashboard.getSeries()[1].every(value=>value===null);")

    # Observe actual strokes, text and clip regions in output, so a hidden DOM
    # panel cannot conceal a second average accidentally left in the renderer.
    dashboard(cdp,"""
      const fixture=w.__maFixture,G=w.WSBMovingAverageCharts;fixture.singleExports=[];fixture.singlePanels={};
      const colorContext=d.createElement('canvas').getContext('2d');
      const panel=G.panel;
      G.panel=(ctx,rect,options)=>{
        let secondStrokes=0;const stroke=ctx.stroke;colorContext.strokeStyle=G.palette(options.theme).lines[1];const color=colorContext.strokeStyle;
        ctx.stroke=function(...args){if(this.strokeStyle===color)secondStrokes++;return stroke.apply(this,args);};
        let result;try{result=panel(ctx,rect,options);}finally{ctx.stroke=stroke;}
        fixture.singlePanels[ctx.canvas.id]={secondStrokes};return result;
      };
      const composite=G.composite;
      G.composite=(ctx,width,height,options)=>{
        const capture={clips:0,text:[],secondStrokes:0,width,height},clip=ctx.clip,fillText=ctx.fillText,stroke=ctx.stroke;
        colorContext.strokeStyle=G.palette(options.theme).lines[1];const color=colorContext.strokeStyle;
        ctx.clip=function(...args){capture.clips++;return clip.apply(this,args);};
        ctx.fillText=function(text,...args){capture.text.push(String(text));return fillText.call(this,text,...args);};
        ctx.stroke=function(...args){if(this.strokeStyle===color)capture.secondStrokes++;return stroke.apply(this,args);};
        try{return composite(ctx,width,height,options);}finally{ctx.clip=clip;ctx.fillText=fillText;ctx.stroke=stroke;fixture.singleExports.push(capture);}
      };
      w.dispatchEvent(new w.Event('resize'));
    """)
    for width in (1280,390,320):
        cdp.command("Emulation.setDeviceMetricsOverride",{"width":width,"height":900,"deviceScaleFactor":1,"mobile":False})
        for theme in ("dark","light"):
            # CDP can queue a native resize after the explicit event below;
            # let it settle before hover, since resizing correctly clears it.
            dashboard(cdp,f"d.documentElement.dataset.theme={json.dumps(theme)};d.dispatchEvent(new w.CustomEvent('dashboard-theme-change'));w.dispatchEvent(new w.Event('resize'));return new Promise(resolve=>w.requestAnimationFrame(()=>w.requestAnimationFrame(resolve)));")
            layout=dashboard(cdp,"""
              const visible=node=>node.getClientRects().length>0;
              const first=d.querySelector('#window1Panel').getBoundingClientRect(),history=d.querySelector('#historyChart').closest('.chart-panel').getBoundingClientRect();
              return {hidden:['ma2KpiChip','ma2PeriodControls','window2Panel'].every(id=>!visible(d.getElementById(id))),
                visibleCharts:['historyChart','window1Chart','window2Chart'].filter(id=>visible(d.getElementById(id))),
                fullRight:Math.abs(first.top-history.top)<1 && Math.abs(first.bottom-history.bottom)<1,
                overflow:d.documentElement.scrollWidth>w.innerWidth+1,strokes:Object.values(w.__maFixture.singlePanels).map(panel=>panel.secondStrokes)};
            """)
            assert layout["hidden"] and layout["visibleCharts"] == ["historyChart","window1Chart"] and not layout["overflow"],layout
            if width==1280: assert layout["fullRight"],layout
            assert all(value==0 for value in layout["strokes"]),layout
            hover_chart(cdp)
            assert dashboard(cdp,"return d.querySelector('#chartTooltip').children.length===3 && !d.querySelector('#chartTooltip').textContent.includes('17M');")
            dashboard(cdp,"d.querySelector('#historyChart').dispatchEvent(new w.PointerEvent('pointerleave'));const canvas=d.querySelector('#window2Chart');canvas.dispatchEvent(new w.PointerEvent('pointermove',{clientX:20,clientY:20,bubbles:true}));")
            assert dashboard(cdp,"return d.querySelector('#chartTooltip').hidden;"),"Hidden panel recreated hover"
    cdp.command("Emulation.setDeviceMetricsOverride",{"width":1280,"height":900,"deviceScaleFactor":1,"mobile":False})
    select_type(cdp,2,"ema")
    assert state(cdp)["lines"][1] == second
    assert dashboard(cdp,"return !d.querySelector('#window2Panel').hidden && !d.querySelector('#ma2PeriodControls').hidden;")
    select_type(cdp,2,"none")
    set_input(cdp,"#startDateInput","2024-05-28","change");set_input(cdp,"#endDateInput","2024-05-31","change")
    click(cdp,"#downloadImageBtn")
    wait_for(lambda:dashboard(cdp,"return w.__maFixture.downloads.some(item=>item.name.endsWith('.png'));"),description="single-average PNG")
    click(cdp,"#dateRangeSettingsBtn")
    click(cdp,'#downloadOrientationSelect button[data-value="portrait"]')
    click(cdp,"#downloadImageBtn")
    wait_for(lambda:dashboard(cdp,"return w.__maFixture.downloads.filter(item=>item.name.endsWith('.png')).length===2;"),description="single-average portrait PNG")
    dashboard(cdp,"const hold=d.querySelector('#downloadEndFrameHoldToggle');hold.checked=false;hold.dispatchEvent(new w.Event('change',{bubbles:true}));")
    click(cdp,"#dateRangeDownloadBtn")
    wait_for(lambda:dashboard(cdp,"return w.__maFixture.downloads.some(item=>item.name.endsWith('.webm'));"),timeout=60,description="single-average WebM")
    exports=dashboard(cdp,"return w.__maFixture.singleExports;")
    assert len(exports)>=6 and all(frame["clips"]==2 and frame["secondStrokes"]==0 and any('9D EMA' in text for text in frame["text"]) and not any('17M' in text or '17 Month' in text for text in frame["text"]) for frame in exports),exports[:1]
    assert {(frame["width"],frame["height"]) for frame in exports}=={(1280,720),(720,1280)}
    saved=state(cdp);link=copy_link(cdp)
    navigate(cdp,link+'&fixture_conflict=1',standalone=True)
    assert state(cdp)==saved
    assert_custom_control_sync(cdp)
    assert dashboard(cdp,"return d.querySelector('#window2Panel').hidden;")
    click(cdp,"#resetDashboard")
    assert [line["type"] for line in state(cdp)["lines"]] == ["sma","sma"]
    assert dashboard(cdp,"return !d.querySelector('#window2Panel').hidden;")
    click(cdp,"#resetDashboard");assert state(cdp)==saved
    assert dashboard(cdp,"return d.querySelector('#window2Panel').hidden;")
    legacy=dashboard(cdp,"const legacy=w.WSBMovingAverageDashboard.getState();legacy.lines.forEach(line=>delete line.type);return w.WSBDashboardShare.encodeShareState(legacy);")
    navigate(cdp,direct+'?state='+legacy+'&fixture_conflict=1')
    assert [line["type"] for line in state(cdp)["lines"]] == ["sma","sma"]
    assert [(line["period"],line["unit"]) for line in state(cdp)["lines"]] == [(9,"day"),(17,"month")]
    assert_custom_control_sync(cdp)
    navigate(cdp,direct+'?fixture_conflict=1')
    assert state(cdp)["lines"] == [{"period":9,"unit":"week","type":"sma"},{"period":10,"unit":"month","type":"sma"}]
    assert_custom_control_sync(cdp);assert_clean(cdp)
    print("PASS average types: SMA/EMA controls and calculations, None layout/hover/export, typed shares/reset/undo, legacy SMA migration",flush=True)


def check_live_price(cdp, direct):
    navigate(cdp, direct + "?fixture_reset=1")
    wait_for(lambda: dashboard(cdp, "return !!w.__maFixture.socket && !!w.WSBMovingAverageDashboard.getDisplayModel;"), description="isolated Moving Average live feed")
    baseline=dashboard(cdp, """
      const app=w.WSBMovingAverageDashboard,m=app.getModel(),marker=JSON.parse(app.getInstalledSignature());
      w.__maFixture.publishedRows=JSON.stringify(m.rows);w.__maFixture.publishedSeries=JSON.stringify(app.getSeries());
      const panel=w.WSBMovingAverageCharts.panel;w.__maFixture.livePanels={};
      w.WSBMovingAverageCharts.panel=(ctx,rect,options)=>{const geometry=panel(ctx,rect,options);w.__maFixture.livePanels[ctx.canvas.id]={geometry,row:options.model.rows[options.endIndex]};return geometry;};
      const composite=w.WSBMovingAverageCharts.composite;w.__maFixture.liveExports=[];
      w.WSBMovingAverageCharts.composite=(ctx,width,height,options)=>{w.__maFixture.liveExports.push({row:options.model.rows[options.endIndex],series:options.series.map(values=>values[options.endIndex]),live:!!options.model.liveQuote});return composite(ctx,width,height,options);};
      return {row:m.rows.at(-1),count:m.rows.length,marker,updated:d.querySelector('#updatedKpi').textContent,
        currentAverages:app.getDisplaySeries().map(values=>values.at(-1)),periods:app.getState().lines.map(line=>line.period)};
    """)
    published_at=dashboard(cdp, f"return Date.parse({json.dumps(baseline['marker']['latest_timestamp'].replace(' ', 'T'))}+'Z');")
    quoted=round(baseline["row"]["price"] * .5, 2)

    def emit(price, at):
        dashboard(cdp, f"w.__maFixture.now={at};w.__maFixture.socket.emit({price},new Date({at}).toISOString());")
        wait_for(lambda: dashboard(cdp, f"return w.WSBMovingAverageDashboard.getDisplayModel().rows.at(-1).price==={price};"), description="live quote rendered")

    emit(quoted,published_at+100)
    live=dashboard(cdp, """
      const app=w.WSBMovingAverageDashboard;
      return {source:d.querySelector('#priceChip').dataset.priceSource,live:d.querySelector('#priceChip').dataset.live,
        status:d.querySelector('#priceLiveStatus').dataset.kind,kpi:d.querySelector('#priceKpi').textContent,
        expected:new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',minimumFractionDigits:2,maximumFractionDigits:2}).format(app.getDisplayModel().rows.at(-1).price),updated:d.querySelector('#updatedKpi').textContent,
        immutable:JSON.stringify(app.getModel().rows)===w.__maFixture.publishedRows && JSON.stringify(app.getSeries())===w.__maFixture.publishedSeries,
        averages:app.getDisplaySeries().map(values=>values.at(-1)),averageLabels:[1,2].map(number=>d.querySelector('#ma'+number+'Kpi').textContent),
        expectedAverageLabels:app.getDisplaySeries().map(values=>new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',minimumFractionDigits:2,maximumFractionDigits:2}).format(values.at(-1))),
        priorAveragesUnchanged:app.getDisplaySeries().every((values,i)=>JSON.stringify(values.slice(0,-1))===JSON.stringify(app.getSeries()[i].slice(0,-1))),
        panelPrices:Object.values(w.__maFixture.livePanels).map(panel=>panel.row.price)};
    """)
    assert live["source"] == "live" and live["live"] == "true" and live["status"] == "live", live
    assert live["kpi"] == live["expected"] and live["immutable"] and live["priorAveragesUnchanged"], live
    for i, value in enumerate(live["averages"]):
        assert abs(value-baseline["currentAverages"][i]-(quoted-baseline["row"]["price"])/baseline["periods"][i]) < .000001, live
        assert live["averageLabels"][i] == live["expectedAverageLabels"][i], live
    assert live["panelPrices"] == [quoted]*3, live
    # Same-date quote timestamps can differ only by milliseconds at a day end;
    # Updated must still retain the published block height.
    assert live["updated"].endswith(f"{baseline['marker']['latest_block_height']:,}"), live
    dashboard(cdp, "const canvas=d.querySelector('#historyChart'),r=canvas.getBoundingClientRect(),p=w.__maFixture.livePanels.historyChart.geometry.plot;canvas.dispatchEvent(new w.PointerEvent('pointermove',{clientX:r.left+p.right,clientY:r.top+p.top+p.height/2,bubbles:true}));")
    assert dashboard(cdp, f"return !d.querySelector('#chartTooltip').hidden && d.querySelector('#chartTooltip').textContent.includes(w.WSBMovingAverageCharts.money({quoted}));")
    dashboard(cdp, f"w.__maFixture.socket.emit({quoted+999},new Date({published_at}).toISOString());")
    assert dashboard(cdp, "return w.WSBMovingAverageDashboard.getDisplayModel().rows.at(-1).price;") == quoted

    for elapsed in (61000,91000):
        dashboard(cdp, f"w.__maFixture.now={published_at+100+elapsed};d.dispatchEvent(new w.Event('visibilitychange'));w.dispatchEvent(new w.Event('resize'));")
        wait_for(lambda: dashboard(cdp, "return d.querySelector('#priceChip').dataset.priceSource==='retained';"), description="stale retained quote")
        assert dashboard(cdp, "return {price:w.WSBMovingAverageDashboard.getDisplayModel().rows.at(-1).price,live:d.querySelector('#priceChip').dataset.live,status:d.querySelector('#priceLiveStatus').dataset.kind};") == {"price":quoted,"live":"false","status":"stale"}
    click(cdp,"#playBtn"); click(cdp,"#pauseBtn")
    set_input(cdp,"#dateRangeEndSlider",baseline["count"]-1)
    assert dashboard(cdp, "return {price:w.WSBMovingAverageDashboard.getDisplayModel().rows.at(-1).price,source:d.querySelector('#priceChip').dataset.priceSource};") == {"price":baseline["row"]["price"],"source":"published"}
    set_input(cdp,"#dateRangeEndSlider",1000)
    assert dashboard(cdp, "const app=w.WSBMovingAverageDashboard;return d.querySelector('#priceKpi').textContent===new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',minimumFractionDigits:2,maximumFractionDigits:2}).format(app.getModel().rows[1000].price) && !app.getDisplayModel().liveQuote;")
    click(cdp,"#stopBtn")
    emit(quoted+11,published_at+200)

    start=dashboard(cdp, "return w.WSBMovingAverageDashboard.getModel().rows.at(-3).date;")
    set_input(cdp,"#startDateInput",start,"change")
    click(cdp,"#downloadImageBtn")
    wait_for(lambda: dashboard(cdp,"return w.__maFixture.downloads.some(item=>item.name.endsWith('.png'));"),description="live PNG")
    png_frame=dashboard(cdp,"return w.__maFixture.liveExports.at(-1);")
    assert png_frame["row"]["price"] == quoted+11
    assert all(abs(value-live["averages"][i]-11/baseline["periods"][i]) < .000001 for i,value in enumerate(png_frame["series"])), png_frame
    click(cdp,"#dateRangeSettingsBtn")
    dashboard(cdp,"const input=d.querySelector('#downloadEndFrameHoldToggle');input.checked=true;input.dispatchEvent(new w.Event('change',{bubbles:true}));")
    click(cdp,'#downloadFpsSelect button[data-value="60"]')
    dashboard(cdp,f"""
      w.__maFixture.liveExports=[];
      const encode=w.WSBDashboardExport.encodeWebM;
      w.WSBDashboardExport.encodeWebM=options=>{{
        w.__maFixture.liveFrameCount=options.frames.length;
        w.__maFixture.liveFinalStart=options.frames.findLastIndex(index=>index!==options.frames.at(-1))+1;
        const render=options.renderFrame;
        return encode({{...options,renderFrame:async (...args)=>{{
          if(!w.__maFixture.quoteDuringExport) {{w.__maFixture.quoteDuringExport=true;w.__maFixture.now={published_at+300};w.__maFixture.socket.emit({quoted+22},new Date({published_at+300}).toISOString());}}
          const result=await render(...args);
          if(args[2]>=w.__maFixture.liveFinalStart && !w.__maFixture.quoteDuringHold) {{w.__maFixture.quoteDuringHold=true;w.__maFixture.now={published_at+350};w.__maFixture.socket.emit({quoted+99},new Date({published_at+350}).toISOString());}}
          return result;
        }}}});
      }};
    """)
    click(cdp,"#dateRangeDownloadBtn")
    wait_for(lambda: dashboard(cdp,"return w.__maFixture.downloads.some(item=>item.name.endsWith('.webm'));"),timeout=60,description="live final-frame WebM")
    exported=dashboard(cdp,"return {frames:w.__maFixture.liveExports,count:w.__maFixture.liveFrameCount,finalStart:w.__maFixture.liveFinalStart};")
    assert exported["count"] == len(exported["frames"]) and len(exported["frames"]) > 3, exported
    final_frames=exported["frames"][exported["finalStart"]:]
    assert len(final_frames) > 1 and all(frame["row"]["price"] == quoted+22 and frame["live"] for frame in final_frames), final_frames[:2]
    assert all(all(abs(value-live["averages"][i]-22/baseline["periods"][i]) < .000001 for i,value in enumerate(frame["series"])) for frame in final_frames), final_frames[:2]
    assert all(not frame["live"] for frame in exported["frames"][:exported["finalStart"]])
    wait_for(lambda: dashboard(cdp,f"return w.WSBMovingAverageDashboard.getDisplayModel().rows.at(-1).price==={quoted+99};"),description="new quote visible after frozen export")

    # Publish a complete newer generation only through the in-memory fetch shim.
    published_price=quoted+33
    dashboard(cdp,f"""
      return (async()=>{{
        const marker=JSON.parse(w.WSBMovingAverageDashboard.getInstalledSignature());
        const csv=await (await w.fetch('../../assets/daily_price.csv')).text();
        const records=csv.trimEnd().split(/\\r?\\n/),headers=records[0].split(','),row=records.at(-1).split(',');
        const timestamp=new Date({published_at+400}).toISOString().replace('T',' ').replace('Z','');
        row[headers.indexOf('timestamp')]=timestamp;row[headers.indexOf('price')]='{published_price}';row[headers.indexOf('block_height')]=String(marker.latest_block_height+1);
        records[records.length-1]=row.join(',');const payload=records.join('\\n')+'\\n';
        const hash=[...new Uint8Array(await w.crypto.subtle.digest('SHA-256',new w.TextEncoder().encode(payload)))].map(value=>value.toString(16).padStart(2,'0')).join('');
        w.__maFixture.publication={{csv:payload,marker:{{...marker,latest_timestamp:timestamp,latest_block_height:marker.latest_block_height+1,artifact:{{...marker.artifact,sha256:hash}}}}}};
        w.__maFixture.generation++;w.WSBWebappDataAutoRefresh.requestCheck('live-new-publication');
      }})();
    """)
    wait_for(lambda: dashboard(cdp,f"return w.WSBMovingAverageDashboard.getModel().rows.at(-1).price==={published_price};"),description="new published price overrides quote")
    assert dashboard(cdp,"return {source:d.querySelector('#priceChip').dataset.priceSource,price:w.WSBMovingAverageDashboard.getDisplayModel().rows.at(-1).price};") == {"source":"published","price":published_price}
    next_day=baseline["row"]["time"]+86400000
    emit(quoted+44,next_day+1000)
    rollover=dashboard(cdp,"const app=w.WSBMovingAverageDashboard;return {published:app.getModel().rows.length,display:app.getDisplayModel().rows.length,row:app.getDisplayModel().rows.at(-1),averages:app.getDisplaySeries().map(values=>values.at(-1)),limits:app.getModel().limits};")
    assert rollover["published"] == baseline["count"] and rollover["display"] == baseline["count"]+1 and rollover["row"]["time"] == next_day, rollover
    emit(quoted+55,next_day+2000)
    next_averages=dashboard(cdp,"return w.WSBMovingAverageDashboard.getDisplaySeries().map(values=>values.at(-1));")
    for i,value in enumerate(next_averages):
        assert abs(value-rollover["averages"][i]-11/baseline["periods"][i]) < .000001, (rollover,next_averages)
    select_type(cdp,1,"ema");select_type(cdp,2,"ema")
    ema_before=dashboard(cdp,"const app=w.WSBMovingAverageDashboard;w.__maFixture.emaHistory=JSON.stringify(app.getSeries());return app.getDisplaySeries().map(values=>values.at(-1));")
    emit(quoted+66,next_day+3000)
    ema_after=dashboard(cdp,"return w.WSBMovingAverageDashboard.getDisplaySeries().map(values=>values.at(-1));")
    assert all(abs(value-ema_before[i]-11*2/(baseline["periods"][i]+1))<.000001 for i,value in enumerate(ema_after)),(ema_before,ema_after)
    assert dashboard(cdp,"return JSON.stringify(w.WSBMovingAverageDashboard.getSeries())===w.__maFixture.emaHistory;")
    assert_clean(cdp)

    cdp.command("Page.navigate",{"url":direct.replace('dashboard.html','preview.html')})
    wait_for(lambda: cdp.evaluate("!!window.__maFixture?.socket && document.querySelector('#movingAveragePreview')?.dataset.priceSource==='published'"),description="published preview and isolated feed")
    cdp.evaluate(f"""(()=>{{
      const fixture=window.__maFixture,original=window.WSBMovingAverageCharts.composite;
      window.WSBMovingAverageCharts.composite=(ctx,width,height,options)=>{{fixture.previewFrame={{row:options.model.rows[options.endIndex],averages:options.series.map(values=>values[options.endIndex])}};return original(ctx,width,height,options);}};
      fixture.now={published_at+100};fixture.socket.emit({quoted},new Date(fixture.now).toISOString());
    }})()""")
    wait_for(lambda: cdp.evaluate("document.querySelector('#movingAveragePreview').dataset.priceSource==='live'"),description="live preview")
    assert cdp.evaluate("window.__maFixture.previewFrame.row.price") == quoted
    preview_averages=cdp.evaluate("window.__maFixture.previewFrame.averages")
    cdp.evaluate(f"window.__maFixture.now={published_at+200};window.__maFixture.socket.emit({quoted+10},new Date(window.__maFixture.now).toISOString());")
    wait_for(lambda: cdp.evaluate(f"window.__maFixture.previewFrame.row.price==={quoted+10}"),description="preview moving averages update")
    preview_next=cdp.evaluate("window.__maFixture.previewFrame.averages")
    assert all(abs(value-preview_averages[i]-10/200) < .000001 for i,value in enumerate(preview_next)), (preview_averages,preview_next)
    cdp.evaluate(f"window.__maFixture.now={published_at+91200};document.dispatchEvent(new Event('visibilitychange'));window.dispatchEvent(new Event('resize'));")
    wait_for(lambda: cdp.evaluate("document.querySelector('#movingAveragePreview').dataset.priceSource==='retained'"),description="preview retained quote")
    assert cdp.evaluate("window.__maFixture.previewFrame.row.price") == quoted+10
    assert cdp.evaluate("window.__maFixture.errors") == []
    print("PASS live price: isolated quotes, live MA endpoints, two-decimal KPIs, charts/hover/preview, retained outage value, immutable history, publication wins, next-day row, frozen PNG/WebM final quote",flush=True)


def main():
    if not Path(CHROME).is_file():
        raise SystemExit(f"Chrome not found at {CHROME}; set CHROME_BIN")
    freeze_data()
    server_port, debug_port = free_port(), free_port()
    server = ThreadingHTTPServer(("127.0.0.1", server_port), lambda *args, **kwargs: FrozenHandler(*args, directory=str(ROOT), **kwargs))
    threading.Thread(target=server.serve_forever, daemon=True).start()
    with tempfile.TemporaryDirectory(prefix="wsb-moving-average-") as profile:
        chrome = subprocess.Popen([CHROME,"--headless=new","--disable-gpu","--remote-allow-origins=*",f"--remote-debugging-port={debug_port}",f"--user-data-dir={profile}","about:blank"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        try:
            wait_for(lambda: urllib.request.urlopen(f"http://127.0.0.1:{debug_port}/json/version", timeout=.5).read(), description="Chrome DevTools")
            target = json.load(urllib.request.urlopen(urllib.request.Request(f"http://127.0.0.1:{debug_port}/json/new?about:blank", method="PUT")))
            cdp = CdpSocket(target["webSocketDebuggerUrl"])
            cdp.command("Page.enable"); cdp.command("Runtime.enable")
            cdp.command("Network.enable")
            cdp.command("Network.setBlockedURLs", {"urls":["*fonts.googleapis.com*","*fonts.gstatic.com*"]})
            cdp.command("Emulation.setDeviceMetricsOverride", {"width":1280,"height":900,"deviceScaleFactor":1,"mobile":False})
            cdp.command("Page.addScriptToEvaluateOnNewDocument", {"source":FIXTURE})
            direct = f"http://127.0.0.1:{server_port}/webapps/moving_average/dashboard.html"
            navigate(cdp, direct + "?fixture_reset=1")
            check_reference_controls(cdp)
            check_slider_ux(cdp)
            check_controls(cdp)
            check_scale_toggle_controls(cdp, direct)
            check_scale_animation(cdp, direct)
            check_custom_controls(cdp)
            check_synchronized_hover(cdp)
            check_playback(cdp)
            check_sharing(cdp, direct)
            check_refresh(cdp)
            check_layout_and_export(cdp)
            check_export_refresh(cdp)
            check_average_types(cdp,direct)
            check_live_price(cdp,direct)
        finally:
            chrome.terminate()
            try: chrome.wait(timeout=5)
            except subprocess.TimeoutExpired: chrome.kill(); chrome.wait(timeout=5)
            server.shutdown()


if __name__ == "__main__":
    main()
