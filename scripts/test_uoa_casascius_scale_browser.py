#!/usr/bin/env python3
"""Exercise UoA paired hover and UoA/Casascius scales in isolated Chrome."""
import base64
import json
import os
import re
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

            load('uoa', {'primaryUoa':'BTC','secondaryUoa':'USD'},
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

            # Two reciprocal panels intentionally show linked tooltips. Check
            # actual rendered values and guide/tooltip geometry in both directions;
            # a shared surface must not discard the inverted y-position contract.
            def paired_hover(source_id, y_ratio):
                return cdp.evaluate(f"""(() => {{
                  const source=document.getElementById({json.dumps(source_id)});
                  const panel=source.closest('.chart-panel'), rect=source.getBoundingClientRect();
                  source.dispatchEvent(new MouseEvent('mousemove',{{bubbles:true,clientX:rect.left+rect.width*.62,clientY:rect.top+rect.height*.5}}));
                  const firstGuide=panel.querySelector('.chart-hover-line')?.getBoundingClientRect();
                  if(!firstGuide) return {{error:'Source hover guide missing'}};
                  source.dispatchEvent(new MouseEvent('mousemove',{{bubbles:true,clientX:firstGuide.left,clientY:firstGuide.top+firstGuide.height*{y_ratio}}}));
                  return ['usdBtcChart','btcUsdChart'].map(id=>{{
                    const canvas=document.getElementById(id),owner=canvas.closest('.chart-panel');
                    const tip=owner.querySelector('.chart-hover-value-tooltip'),guide=owner.querySelector('.chart-hover-line');
                    if(!tip||!guide) return {{id,error:'Linked tooltip missing'}};
                    const value=tip.querySelector('.wsb-tooltip-value'),label=tip.querySelector('.wsb-tooltip-label'),swatch=tip.querySelector('.wsb-tooltip-swatch');
                    const box=tip.getBoundingClientRect(),line=guide.getBoundingClientRect();
                    return {{id,date:tip.querySelector('.wsb-tooltip-title')?.textContent,
                      value:value?.textContent,label:label?.textContent,swatch:!!swatch,
                      visible:getComputedStyle(tip).display!=='none'&&getComputedStyle(guide).display!=='none',
                      neutral:!!value&&getComputedStyle(value).color===getComputedStyle(tip).color,
                      ratio:(box.top+box.height/2-line.top)/line.height, box:{{top:box.top,height:box.height}}, line:{{top:line.top,height:line.height}}, input:{{top:firstGuide.top,height:firstGuide.height,canvasTop:rect.top}}}};
                  }});
                }})()""")

            def numeric_rate(text):
                match = re.search(r'([0-9][0-9,]*(?:\.[0-9]+)?)\s*([kMBT]?)(?:\s|$)', text)
                assert match, ('Unrecognized displayed exchange rate', text)
                value = float(match.group(1).replace(',', '')) * {'':1,'k':1e3,'M':1e6,'B':1e9,'T':1e12}[match.group(2)]
                if 'msats' in text: value /= 1000
                if 'μsats' in text: value /= 1000000
                return value

            for primary, secondary, product in [('BTC','USD',1e8),('USD','EUR',1)]:
                load('uoa', {'primaryUoa':primary,'secondaryUoa':secondary,'startDate':'2020-01-01','endDate':'2024-01-01'},
                     "document.querySelector('#primaryUoaSelect')?.options.length > 100 && document.querySelector('#btcUsdEndDateEdge')?.textContent && window.__scaleFrames.length > 1")
                assert cdp.evaluate("[document.querySelector('#primaryUoaSelect').value,document.querySelector('#secondaryUoaSelect').value]") == [primary,secondary], 'Requested reciprocal pair did not load'
                for width in (1440,390):
                    cdp.command('Emulation.setDeviceMetricsOverride', {'width':width,'height':1000,'deviceScaleFactor':1,'mobile':False})
                    for theme in ('dark','light'):
                        cdp.evaluate(f"document.documentElement.dataset.theme={json.dumps(theme)};document.dispatchEvent(new CustomEvent('dashboard-theme-change'));window.dispatchEvent(new Event('resize'));")
                        cdp.evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))')
                        for source_id in ('usdBtcChart','btcUsdChart'):
                            observed = []
                            for ratio in (.3,.7):
                                result = paired_hover(source_id, ratio)
                                assert isinstance(result,list) and len(result)==2, result
                                assert all(row.get('visible') and row.get('swatch') and row.get('neutral') for row in result), result
                                assert result[0]['date'] and result[0]['date']==result[1]['date'], result
                                for row in result:
                                    expected = ratio if row['id']==source_id else 1-ratio
                                    assert abs(row['ratio']-expected)<.015, ('Linked hover lost y inversion',width,theme,source_id,result)
                                actual_product = numeric_rate(result[0]['value'])*numeric_rate(result[1]['value'])
                                assert abs(actual_product/product-1)<.002, ('Tooltip rates are not reciprocal',primary,secondary,result,actual_product)
                                observed.append([(row['date'],row['value']) for row in result])
                            assert observed[0]==observed[1], ('Pointer y changed tooltip rates',observed)
                        cdp.evaluate("document.querySelector('#btcUsdChart').dispatchEvent(new MouseEvent('mouseleave',{bubbles:true}));")
                        assert cdp.evaluate("[...document.querySelectorAll('.chart-hover-value-tooltip,.chart-hover-line')].every(el=>getComputedStyle(el).display==='none')"), 'Leaving chart retained paired hover'
                assert not cdp.evaluate('window.__scaleErrors'), cdp.evaluate('window.__scaleErrors')
            cdp.command('Emulation.setDeviceMetricsOverride', {'width':1440,'height':1000,'deviceScaleFactor':1,'mobile':False})
            print('UoA paired tooltip reciprocal rates, linked dates, inverted y-position, neutral values/swatches and leave cleanup passed in both themes and desktop/mobile.', flush=True)

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
