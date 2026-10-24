#!/usr/bin/env python3
"""Exercise Days Since ATH and Issuance scale morphs in isolated Chrome.

Uses frozen published inputs and disabled external feeds. No producer is run.
"""
import json
import os
from pathlib import Path
import subprocess
import tempfile
import threading
import urllib.request
from http.server import ThreadingHTTPServer

from test_stage1_refresh_atomicity import CdpSocket, free_port, wait_for
from test_stage4_live_refresh import SnapshotHandler, build_data_snapshot

ROOT = Path(__file__).resolve().parents[1]
CHROME = os.environ.get('CHROME_BIN', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome')
HARNESS = r"""
(() => {
  localStorage.clear();
  const test = window.__scaleTest = {samples:[], ticks:[], errors:[], controllers:[], exports:[], priceFrames:[]};
  addEventListener('error', e => test.errors.push(e.message));
  addEventListener('unhandledrejection', e => test.errors.push(String(e.reason)));
  const fetchOriginal = fetch;
  window.fetch = (input, options) => {
    const url = new URL(typeof input === 'string' ? input : input.url, location.href);
    return url.origin === location.origin ? fetchOriginal(input, options) : Promise.reject(new Error('Fixture disables external feeds'));
  };
  window.WebSocket = class { send() {} close() {} };
  const charting = window.WSBDashboardCharting = {};
  Object.defineProperty(charting, 'createScaleTransitionController', {set(factory) {
    Object.defineProperty(charting, 'createScaleTransitionController', {value(options) {
      const controller = factory(options), sample = controller.getMix;
      controller.getMix = (key, target) => {
        const mix = sample(key, target);
        test.samples.push({key, target, mix});
        return mix;
      };
      test.controllers.push(controller);
      return controller;
    }, configurable:true});
  }, configurable:true});
  Object.defineProperty(charting, 'morphScaleTicks', {set(morph) {
    Object.defineProperty(charting, 'morphScaleTicks', {value(...args) {
      const ticks = morph(...args);
      test.ticks.push({mix:args[2], ticks});
      return ticks;
    }, configurable:true});
  }, configurable:true});
  // Observe production canvas output rather than only the controller's scalar.
  const frames = new WeakMap(), paths = new WeakMap();
  const proto = CanvasRenderingContext2D.prototype;
  const fillText = proto.fillText, beginPath = proto.beginPath;
  const moveTo = proto.moveTo, lineTo = proto.lineTo, stroke = proto.stroke;
  proto.fillText = function(text, x, y, ...args) {
    if (text === 'Daily High Price') {
      const frame = {export: this.canvas.id !== 'priceCanvas',
        mix: test.samples.findLast(sample => sample.key === 'price')?.mix,
        labels: [], grid: []};
      frames.set(this, frame);
      test.priceFrames.push(frame);
    }
    const frame = frames.get(this);
    if (frame && (text === '$0' || text === 'Not Valued') && this.textBaseline === 'middle') {
      frame.labels.push({text, x, y, alpha:this.globalAlpha, font:this.font});
    }
    return fillText.call(this, text, x, y, ...args);
  };
  proto.beginPath = function(...args) { paths.set(this, []); return beginPath.apply(this, args); };
  proto.moveTo = function(x, y) { paths.get(this)?.push({x,y}); return moveTo.call(this, x, y); };
  proto.lineTo = function(x, y) { paths.get(this)?.push({x,y}); return lineTo.call(this, x, y); };
  proto.stroke = function(...args) {
    const path = paths.get(this), frame = frames.get(this);
    if (frame && path?.length === 2 && path[0].x === 18
        && path[1].x > path[0].x && path[0].y === path[1].y) {
      frame.grid.push({y:path[0].y, alpha:this.globalAlpha});
    }
    return stroke.apply(this,args);
  };
  test.checkPriceFrames = (source, options = {}) => {
    const visible = source.filter(frame => frame.export === !!options.export);
    if (!visible.length) return 'No price-chart frames captured';
    if (options.animated && !visible.some(frame => frame.mix > 0 && frame.mix < 1))
      return 'No intermediate baseline label frames';
    let previous = null, baselineY = null;
    for (const frame of visible) {
      const mix = options.endpoint ?? frame.mix;
      const zero = frame.labels.filter(label => label.text === '$0');
      const unvalued = frame.labels.filter(label => label.text === 'Not Valued');
      if (zero.length !== Number(mix < 1) || unvalued.length !== Number(mix > 0))
        return `Wrong baseline label layers at mix ${mix}: ${JSON.stringify(frame.labels)}`;
      const z = zero[0], n = unvalued[0], label = z || n;
      const zeroAlpha = z?.alpha || 0, unvaluedAlpha = n?.alpha || 0;
      if (Math.abs(zeroAlpha - (1-mix)) > 1e-9 || Math.abs(unvaluedAlpha-mix) > 1e-9
          || Math.abs(zeroAlpha+unvaluedAlpha-1) > 1e-9) return 'Baseline alpha is not complementary';
      if (z && n && (z.x !== n.x || z.y !== n.y)) return 'Crossfade labels moved to different baselines';
      if (baselineY !== null && Math.abs(label.y-baselineY) > 1e-9) return 'Baseline grid position moved during fade';
      baselineY = label.y;
      const grid = frame.grid.filter(line => Math.abs(line.y-label.y) < 1e-9);
      if (grid.length !== 1 || grid[0].alpha !== 1) return 'Baseline grid duplicated or faded with its labels';
      if (previous && options.direction !== undefined) {
        const direction = options.direction;
        if (direction*(unvaluedAlpha-previous.unvaluedAlpha) < -1e-9
            || direction*(previous.zeroAlpha-zeroAlpha) < -1e-9) return 'Baseline labels flashed during fade';
      }
      previous = {zeroAlpha,unvaluedAlpha};
    }
    return '';
  };
  const click = HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click = function() { if (!this.download) click.call(this); };
})();
"""


def check(cdp, expression):
    error = cdp.evaluate(expression)
    if error:
        raise AssertionError(error)


def click(cdp, selector):
    point = cdp.evaluate(f"""(() => {{ const r=document.querySelector({json.dumps(selector)}).getBoundingClientRect(); return {{x:r.x+r.width/2,y:r.y+r.height/2}}; }})()""")
    for kind in ('mousePressed', 'mouseReleased'):
        cdp.command('Input.dispatchMouseEvent', {'type': kind, **point, 'button': 'left', 'clickCount': 1})


def main():
    if not Path(CHROME).is_file():
        raise SystemExit(f'Chrome not found: {CHROME}')
    SnapshotHandler.snapshot = build_data_snapshot()
    for name in ('issuance_rate_data.json', 'published_generation.json'):
        relative = f'webapps/issuance_rate/webapp_data/{name}'
        SnapshotHandler.snapshot['/' + relative] = (ROOT / relative).read_bytes()
    port, debug = free_port(), free_port()
    server = ThreadingHTTPServer(('127.0.0.1', port), lambda *a, **k: SnapshotHandler(*a, directory=str(ROOT), **k))
    threading.Thread(target=server.serve_forever, daemon=True).start()
    with tempfile.TemporaryDirectory(prefix='wsb-days-issuance-scale-') as profile:
        chrome = subprocess.Popen([CHROME, '--headless=new', '--disable-gpu', '--remote-allow-origins=*',
            f'--remote-debugging-port={debug}', f'--user-data-dir={profile}', 'about:blank'], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        try:
            wait_for(lambda: urllib.request.urlopen(f'http://127.0.0.1:{debug}/json/version', timeout=.5).read(), description='DevTools')
            target = json.load(urllib.request.urlopen(urllib.request.Request(f'http://127.0.0.1:{debug}/json/new?about:blank', method='PUT')))
            cdp = CdpSocket(target['webSocketDebuggerUrl'])
            cdp.command('Page.enable')
            cdp.command('Runtime.enable')
            cdp.command('Emulation.setDeviceMetricsOverride', {'width':1440,'height':1000,'deviceScaleFactor':1,'mobile':False})
            cdp.command('Page.addScriptToEvaluateOnNewDocument', {'source':HARNESS})
            for slug, groups, ready in [
                ('days_since_ath', [('price','[data-price-scale]','priceScaleMode'), ('days','[data-days-scale]','daysScaleMode')], "document.querySelector('#priceChartLoader')?.classList.contains('hidden')"),
                ('issuance_rate', [('issuance','[data-scale-mode]','scaleMode')], "Number(document.querySelector('#dateRangeEndSlider')?.max)>100"),
            ]:
                cdp.command('Page.navigate', {'url':f'http://127.0.0.1:{port}/webapps/{slug}/dashboard.html'})
                wait_for(lambda: cdp.evaluate(ready + ' && __scaleTest.samples.length > 0'), timeout=65, description=slug)
                for key, selector, state_key in groups:
                    for half in (1, 2):
                        button = f'{selector}:nth-child({half})'
                        # Clicking each half twice covers both active and inactive halves.
                        for _ in range(2):
                            cdp.evaluate(f"__scaleTest.samples=[]; __scaleTest.ticks=[]; __scaleTest.priceFrames=[]; __scaleTest.before=JSON.parse(localStorage.getItem('{slug}_dashboard_state_v1'))")
                            click(cdp, button)
                            wait_for(lambda: cdp.evaluate('!__scaleTest.controllers.some(c=>c.isAnimating())'), timeout=4, description=f'{slug} {key} settling')
                            check(cdp, f"""(() => {{
                              const after=JSON.parse(localStorage.getItem('{slug}_dashboard_state_v1'));
                              const before=__scaleTest.before, samples=__scaleTest.samples.filter(s=>s.key==='{key}');
                              if(after.{state_key}===before.{state_key}) return 'Either-half click did not toggle {key}';
                              for(const field of ['priceScaleMode','daysScaleMode','viewMode','startIso','endIso','startIndex','endIndex']) {{
                                if(field!=='{state_key}' && after[field]!==before[field]) return 'Scale click changed '+field;
                              }}
                              if(!samples.some(s=>s.mix>0&&s.mix<1)) return 'No intermediate frames for {key}';
                              const target=Number(after.{state_key}==='log');
                              if(samples.at(-1).mix!==target) return 'Wrong endpoint';
                              if(samples.some((s,i)=>i && (target ? s.mix<samples[i-1].mix : s.mix>samples[i-1].mix))) return 'Nonmonotonic transition';
                              if(__scaleTest.ticks.some(f=>f.ticks.some(t=>!Number.isFinite(t.y)||!Number.isFinite(t.alpha)))) return 'Invalid tick';
                              if('{key}'==='days' && __scaleTest.ticks.some(f=>f.ticks.find(t=>t.value===0)?.alpha!==1)) return 'Shared zero faded';
                              return '';
                            }})()""")
                            if key == 'price':
                                check(cdp, "__scaleTest.checkPriceFrames(__scaleTest.priceFrames, {animated:true, direction:__scaleTest.samples.filter(s=>s.key==='price').at(-1).mix ? 1 : -1})")
                    # Reverse while moving and verify the first reverse draw keeps the last painted position.
                    click(cdp, f'{selector}:nth-child(1)')
                    wait_for(lambda: cdp.evaluate(f"__scaleTest.samples.filter(s=>s.key==='{key}').at(-1)?.mix > .1 && __scaleTest.samples.filter(s=>s.key==='{key}').at(-1)?.mix < .9"), timeout=2, description='intermediate reversal')
                    check(cdp, f"""(() => {{
                      const before=__scaleTest.samples.filter(s=>s.key==='{key}').at(-1).mix;
                      document.querySelector('{selector}').click();
                      const after=__scaleTest.samples.filter(s=>s.key==='{key}').at(-1).mix;
                      return Math.abs(before-after)>1e-9 ? `Reversal jumped: ${{before}} -> ${{after}}` : '';
                    }})()""")
                    wait_for(lambda: cdp.evaluate('!__scaleTest.controllers.some(c=>c.isAnimating())'), timeout=4, description='reverse settling')
                    for code, key_text, virtual in [('Enter','Enter',13), ('Space',' ',32)]:
                        cdp.evaluate(f"document.querySelector('{selector}').focus(); __scaleTest.before=JSON.parse(localStorage.getItem('{slug}_dashboard_state_v1'))")
                        cdp.command('Input.dispatchKeyEvent', {'type':'keyDown','key':key_text,'code':code,'windowsVirtualKeyCode':virtual,'text':'\r' if code=='Enter' else ' ','unmodifiedText':'\r' if code=='Enter' else ' '})
                        cdp.command('Input.dispatchKeyEvent', {'type':'keyUp','key':key_text,'code':code,'windowsVirtualKeyCode':virtual})
                        wait_for(lambda: cdp.evaluate('!__scaleTest.controllers.some(c=>c.isAnimating())'), timeout=4, description='keyboard settling')
                        check(cdp, f"""(() => {{ const after=JSON.parse(localStorage.getItem('{slug}_dashboard_state_v1')); return after.{state_key}===__scaleTest.before.{state_key} ? 'Keyboard {code} did not toggle {key}; focused='+document.activeElement?.outerHTML : (document.querySelector('#playBtn, #dateRangePlayBtn')?.classList.contains('is-playing') ? 'Space started playback' : ''); }})()""")
                # Accessibility preference settles an active morph and future toggles immediately.
                selector = groups[0][1]
                click(cdp, f'{selector}:nth-child(1)')
                cdp.command('Emulation.setEmulatedMedia', {'features':[{'name':'prefers-reduced-motion','value':'reduce'}]})
                wait_for(lambda: cdp.evaluate('!__scaleTest.controllers.some(c=>c.isAnimating())'), timeout=3, description='reduced motion')
                cdp.evaluate('__scaleTest.samples=[]; __scaleTest.priceFrames=[]')
                click(cdp, f'{selector}:nth-child(2)')
                check(cdp, "__scaleTest.samples.some(s=>s.mix>0&&s.mix<1) ? 'Reduced motion interpolated' : ''")
                if slug == 'days_since_ath':
                    check(cdp, "__scaleTest.checkPriceFrames(__scaleTest.priceFrames, {endpoint:__scaleTest.samples.filter(s=>s.key==='price').at(-1).mix})")
                    cdp.evaluate('__scaleTest.samples=[]; __scaleTest.priceFrames=[]')
                    click(cdp, f'{selector}:nth-child(1)')
                    check(cdp, "__scaleTest.checkPriceFrames(__scaleTest.priceFrames, {endpoint:__scaleTest.samples.filter(s=>s.key==='price').at(-1).mix})")
                cdp.command('Emulation.setEmulatedMedia', {'features':[{'name':'prefers-reduced-motion','value':'no-preference'}]})
                # Exercise the production export renderer during an unfinished UI transition.
                cdp.evaluate("""WSBDashboardExport.encodeVideo = async options => {
                  const start=__scaleTest.samples.length, ticks=__scaleTest.ticks.length, priceFrames=__scaleTest.priceFrames.length;
                  options.renderFrame(options.frames.at(-1), options.canvas, options.frames.length-1);
                  __scaleTest.exports.push({samples:__scaleTest.samples.length-start,ticks:__scaleTest.ticks.length-ticks,width:options.canvas.width,
                    priceFrames:__scaleTest.priceFrames.slice(priceFrames), priceScale:options.settings.leftScale});
                  return new Blob(['fixture'],{type:'video/webm'});
                };""")
                click(cdp, f'{selector}:nth-child(1)')
                click(cdp, '#dateRangeDownloadBtn')
                wait_for(lambda: cdp.evaluate('__scaleTest.exports.length > 0'), timeout=15, description='endpoint export')
                check(cdp, "__scaleTest.exports.some(e=>e.samples||e.ticks||!e.width) ? 'Export sampled transitional scale' : __scaleTest.errors.join('; ')")
                if slug == 'days_since_ath':
                    check(cdp, "__scaleTest.exports.map(e=>__scaleTest.checkPriceFrames(e.priceFrames,{export:true,endpoint:Number(e.priceScale==='log')})).filter(Boolean).join('; ')")
                    # The alternate export setting must remain an explicit endpoint choice.
                    cdp.evaluate("document.querySelector('#downloadPriceScaleSelect [data-value=linear]').click()")
                    click(cdp, '#dateRangeDownloadBtn')
                    wait_for(lambda: cdp.evaluate('__scaleTest.exports.length > 1'), timeout=15, description='linear baseline export')
                    check(cdp, "__scaleTest.exports.map(e=>__scaleTest.checkPriceFrames(e.priceFrames,{export:true,endpoint:Number(e.priceScale==='log')})).filter(Boolean).join('; ')")
                cdp.command('Emulation.setDeviceMetricsOverride', {'width':390,'height':844,'deviceScaleFactor':1,'mobile':False})
                click(cdp, f'{selector}:nth-child(2)')
                wait_for(lambda: cdp.evaluate('!__scaleTest.controllers.some(c=>c.isAnimating())'), timeout=4, description='mobile transition')
                check(cdp, '__scaleTest.errors.join("; ")')
                cdp.command('Emulation.setDeviceMetricsOverride', {'width':1440,'height':1000,'deviceScaleFactor':1,'mobile':False})
                print(f'{slug}: either half, animation, reversal, keyboard, reduced motion, export and mobile passed', flush=True)
        finally:
            chrome.terminate()
            chrome.wait(timeout=10)
            server.shutdown()


if __name__ == '__main__':
    main()
