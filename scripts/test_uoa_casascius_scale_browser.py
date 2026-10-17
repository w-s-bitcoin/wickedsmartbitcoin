#!/usr/bin/env python3
"""Exercise UoA/Casascius native scale morphs with an isolated Chrome profile."""
import base64
import json
import os
import subprocess
import tempfile
import threading
import urllib.request
from http.server import ThreadingHTTPServer
from pathlib import Path

from test_stage1_refresh_atomicity import CdpSocket, QuietHandler, free_port, wait_for

ROOT = Path(__file__).resolve().parents[1]
CHROME = os.environ.get('CHROME_BIN', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome')
SHIM = r"""
(() => {
  window.__scaleErrors = [];
  addEventListener('error', event => window.__scaleErrors.push(event.message));
  window.__scaleFrames = [];
  window.__scaleControllers = [];
  const charting = window.WSBDashboardCharting = {};
  let create;
  Object.defineProperty(charting, 'createScaleTransitionController', {
    configurable: true,
    set(value) { create = value; },
    get() { return options => {
      const controller = create(options), getMix = controller.getMix;
      controller.getMix = (key, mode) => {
        const mix = getMix(key, mode);
        window.__scaleFrames.push({ key, mode, mix, time: performance.now() });
        return mix;
      };
      window.__scaleControllers.push(controller);
      return controller;
    }; }
  });
  for (const method of ['moveTo', 'lineTo', 'arc']) {
    const native = CanvasRenderingContext2D.prototype[method];
    CanvasRenderingContext2D.prototype[method] = function(...args) {
      if (args.slice(0, method === 'arc' ? 5 : 2).some(v => !Number.isFinite(v)))
        window.__scaleErrors.push('nonfinite canvas ' + method);
      return native.apply(this, args);
    };
  }
})();
"""


def encoded(value):
    return base64.urlsafe_b64encode(json.dumps(value).encode()).decode().rstrip('=')


def main():
    server_port, debug_port = free_port(), free_port()
    server = ThreadingHTTPServer(('127.0.0.1', server_port),
        lambda *args, **kwargs: QuietHandler(*args, directory=str(ROOT), **kwargs))
    threading.Thread(target=server.serve_forever, daemon=True).start()
    with tempfile.TemporaryDirectory(prefix='wsb-uoa-casa-scale-') as profile:
        chrome = subprocess.Popen([CHROME, '--headless=new', '--disable-gpu', '--remote-allow-origins=*',
            f'--remote-debugging-port={debug_port}', f'--user-data-dir={profile}', 'about:blank'],
            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        try:
            wait_for(lambda: urllib.request.urlopen(f'http://127.0.0.1:{debug_port}/json/version', timeout=.5).read(), description='Chrome')
            target = json.load(urllib.request.urlopen(urllib.request.Request(
                f'http://127.0.0.1:{debug_port}/json/new?about:blank', method='PUT'), timeout=2))
            cdp = CdpSocket(target['webSocketDebuggerUrl'])
            cdp.command('Page.enable')
            cdp.command('Runtime.enable')
            cdp.command('Emulation.setDeviceMetricsOverride', {'width': 1440, 'height': 1000, 'deviceScaleFactor': 1, 'mobile': False})
            cdp.command('Page.addScriptToEvaluateOnNewDocument', {'source': SHIM})

            def load(slug, state, ready):
                cdp.command('Page.navigate', {'url': f'http://127.0.0.1:{server_port}/webapps/{slug}/dashboard.html?state={encoded(state)}'})
                wait_for(lambda: cdp.evaluate(ready), timeout=100, description=slug + ' chart ready')
                assert not cdp.evaluate('window.__scaleErrors'), cdp.evaluate('window.__scaleErrors')

            def click(selector):
                box = cdp.evaluate(f"(() => {{ const r=document.querySelector({json.dumps(selector)}).getBoundingClientRect(); return {{ x:r.x+r.width/2, y:r.y+r.height/2 }}; }})()")
                cdp.command('Input.dispatchMouseEvent', {'type':'mousePressed', 'button':'left', 'clickCount':1, **box})
                cdp.command('Input.dispatchMouseEvent', {'type':'mouseReleased', 'button':'left', 'clickCount':1, **box})

            def settle():
                wait_for(lambda: cdp.evaluate('window.__scaleControllers.every(c => !c.isAnimating())'), timeout=3, description='scale endpoint')

            def check_toggle(selector, selected, key, other_key=None):
                before = cdp.evaluate(selected)
                cdp.evaluate('window.__scaleFrames = []')
                click(selector)
                after = cdp.evaluate(selected)
                assert before != after, ('either-half toggle', selector, before, after)
                wait_for(lambda: cdp.evaluate(f"window.__scaleFrames.some(f => f.key === {json.dumps(key)} && f.mix > .05 && f.mix < .95)"), timeout=2, description=key+' intermediate frame')
                settle()
                frames = cdp.evaluate(f"window.__scaleFrames.filter(f => f.key === {json.dumps(key)})")
                assert frames[-1]['mix'] == (1 if after == 'log' else 0), frames[-1]
                if other_key:
                    assert cdp.evaluate(f"window.__scaleFrames.filter(f => f.key === {json.dumps(other_key)}).every(f => f.mix === 0 || f.mix === 1)"), 'other panel animated'

            load('uoa', {'primaryCurrency':'BTC','secondaryCurrency':'USD'},
                 "document.querySelector('#primaryUoaSelect')?.options.length > 100 && document.querySelector('#btcUsdEndDateEdge')?.textContent && window.__scaleFrames.length > 1")
            left = "document.querySelector('#primaryScaleToggles .is-active').dataset.value"
            right = "document.querySelector('#secondaryScaleToggles .is-active').dataset.value"
            for group, key, other, selected in [('primaryScaleToggles','usdBtcChart','btcUsdChart',left), ('secondaryScaleToggles','btcUsdChart','usdBtcChart',right)]:
                for half in ['log','linear']:
                    selector = f'#{group} [data-value="{half}"]'
                    for _ in range(2):
                        check_toggle(selector, selected, key, other)
            # Native Space/Enter on the focused scale control must not start playback.
            selector = '#primaryScaleToggles [data-value="log"]'
            for key, code, vk in [(' ', 'Space', 32), ('Enter', 'Enter', 13)]:
                cdp.evaluate(f'document.querySelector({json.dumps(selector)}).focus()')
                before = cdp.evaluate(left)
                cdp.command('Input.dispatchKeyEvent', {'type':'keyDown','key':key,'code':code,'windowsVirtualKeyCode':vk, 'text':'\r' if key == 'Enter' else ' '})
                cdp.command('Input.dispatchKeyEvent', {'type':'keyUp','key':key,'code':code,'windowsVirtualKeyCode':vk})
                assert cdp.evaluate(left) != before, ('keyboard scale activation failed', key, cdp.evaluate("({focus:document.activeElement.outerHTML, value:document.querySelector('#primaryScaleToggles .is-active').dataset.value})"))
                settle()
            assert not cdp.evaluate('window.__scaleErrors'), cdp.evaluate('window.__scaleErrors')
            print('UoA independent panels, both toggle halves, native keyboard and finite intermediate canvas frames passed.', flush=True)

            state = {'coin':'cas_1btc_2011_s1','chartOpen':True,'chartMode':'price','priceUnit':'usd','priceScale':'linear',
                     'view':{'running':False},'panels':{'left':True,'bottom':True,'right':True,'leftMode':'active'}}
            load('casascius_explorer', state, "document.querySelector('.balance-chart-full-canvas')?._priceChartMeta?.points.length > 0")
            selected = "document.querySelector('[data-price-chart-scale].active').dataset.priceChartScale"
            for half in ['linear', 'log']:
                for _ in range(2):
                    check_toggle(f'[data-price-chart-scale="{half}"]', selected, 'price')
            assert cdp.evaluate("document.querySelector('.balance-chart-full-canvas')._priceChartMeta.unit") == 'usd'
            # A chart drag creates a real zoom; toggling retains its time window.
            bounds = cdp.evaluate("""(() => { const c=document.querySelector('.balance-chart-full-canvas'), m=c._priceChartMeta, r=c.getBoundingClientRect(); return { x:r.x+m.pad.left, y:r.y+m.pad.top, w:m.plotW, h:m.plotH }; })()""")
            start = {'x':bounds['x'] + bounds['w']*.15, 'y':bounds['y'] + bounds['h']*.15}
            end = {'x':bounds['x'] + bounds['w']*.85, 'y':bounds['y'] + bounds['h']*.85}
            cdp.command('Input.dispatchMouseEvent', {'type':'mousePressed','button':'left','clickCount':1, **start})
            cdp.command('Input.dispatchMouseEvent', {'type':'mouseMoved','button':'left','buttons':1, **end})
            cdp.command('Input.dispatchMouseEvent', {'type':'mouseReleased','button':'left','clickCount':1, **end})
            zoom_expression = "(() => { const m=document.querySelector('.balance-chart-full-canvas')._priceChartMeta; return {min:m.minTime,max:m.maxTime,fullMin:m.fullMinTime,fullMax:m.fullMaxTime}; })()"
            zoom = cdp.evaluate(zoom_expression)
            assert zoom['min'] > zoom['fullMin'] and zoom['max'] < zoom['fullMax'], zoom
            check_toggle('[data-price-chart-scale=linear]', selected, 'price')
            assert cdp.evaluate(zoom_expression) == zoom, 'scale change discarded chart zoom'
            cdp.evaluate("document.querySelector('[data-price-chart-scale=linear]').focus()")
            before = cdp.evaluate(selected)
            cdp.command('Input.dispatchKeyEvent', {'type':'keyDown','key':' ','code':'Space','windowsVirtualKeyCode':32})
            cdp.command('Input.dispatchKeyEvent', {'type':'keyUp','key':' ','code':'Space','windowsVirtualKeyCode':32})
            assert cdp.evaluate(selected) != before, 'Casascius focused Space intercepted'
            settle()
            # Rapid reversal starts at the last displayed mix.
            cdp.evaluate('window.__scaleFrames=[]')
            click('[data-price-chart-scale=linear]')
            wait_for(lambda: cdp.evaluate('window.__scaleFrames.some(f => f.mix > .15 && f.mix < .85)'), description='reverse midpoint')
            reversal = cdp.evaluate("(() => { const before=window.__scaleFrames.at(-1).mix; document.querySelector('[data-price-chart-scale=linear]').click(); return {before, after:window.__scaleFrames.at(-1).mix}; })()")
            assert abs(reversal['after']-reversal['before']) < .03, reversal
            settle()
            cdp.command('Emulation.setEmulatedMedia', {'features':[{'name':'prefers-reduced-motion','value':'reduce'}]})
            cdp.evaluate('window.__scaleFrames=[]')
            click('[data-price-chart-scale=linear]')
            assert cdp.evaluate('window.__scaleFrames.every(f => f.mix === 0 || f.mix === 1)'), 'reduced motion animated'
            assert not cdp.evaluate('window.__scaleErrors'), cdp.evaluate('window.__scaleErrors')
            print('Casascius both toggle halves, keyboard, reversal, reduced motion, retained zoom/currency and finite geometry passed.', flush=True)
        finally:
            chrome.terminate()
            try:
                chrome.wait(timeout=5)
            except subprocess.TimeoutExpired:
                chrome.kill()
            server.shutdown()


if __name__ == '__main__':
    main()
