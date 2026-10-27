"""Shared browser checks for both daily-history charts' actual hover contracts."""
import base64
from browser_cdp import wait_for


def check_tooltips(cdp, model_name, artifact_dir=None):
    # Exercise exact rendered geometry rather than hard-coding chart coordinates.
    cdp.evaluate(f"window.__tooltipChart = window.{model_name}")
    for theme, width in [('dark', 1440), ('light', 320)]:
        cdp.command('Emulation.setDeviceMetricsOverride', {'width': width, 'height': 900, 'deviceScaleFactor': 1, 'mobile': False})
        cdp.evaluate(f"window.postMessage({{type:'quantum-dashboard-theme',theme:'{theme}'}},location.origin)")
        wait_for(lambda: cdp.evaluate(f"document.documentElement.dataset.theme === '{theme}'"), description='tooltip theme')
        cdp.evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))')
        targets = cdp.evaluate("""(async () => {
          const chart = window.__tooltipChart, rows = chart.parse(await (await fetch('../../assets/daily_price.csv')).text());
          const rect = document.getElementById('dashboardCanvas').getBoundingClientRect();
          const out = document.createElement('canvas'); out.width = Math.round(rect.width); out.height = Math.round(rect.height);
          const ctx = out.getContext('2d'), found = {};
          for (let y = 16; y < rect.height; y += 25) for (let x = 16; x < rect.width; x += 25) {
            const hover = {x,y};
            const info = chart.render(ctx,out.width,out.height,rows,rows.length-1,{theme:document.documentElement.dataset.theme,hover});
            if (info && !found[info.key]) found[info.key] = {hover,info};
            if (Object.keys(found).length === 2) return found;
          }
          return found;
        })()""")
        assert 'history' in targets and len(targets) == 2, targets
        for key, target in targets.items():
            cdp.evaluate(f"window.__tooltipPoint = {target['hover']!r}".replace("'", '"'))
            cdp.evaluate("""(() => { const c=document.getElementById('dashboardCanvas'), r=c.getBoundingClientRect();
              window.scrollTo(0, scrollY+r.top+window.__tooltipPoint.y-innerHeight/2); })()""")
            cdp.evaluate('new Promise(resolve => requestAnimationFrame(resolve))')
            point = cdp.evaluate("""(() => {const r=document.getElementById('dashboardCanvas').getBoundingClientRect();return {x:r.left+__tooltipPoint.x,y:r.top+__tooltipPoint.y};})()""")
            cdp.command('Input.dispatchMouseEvent', {'type':'mouseMoved', **point})
            tip = wait_for(lambda: cdp.evaluate("""(() => {
              const t=document.getElementById('chartTooltip'); if (!t || t.hidden) return null;
              const b=t.getBoundingClientRect(), c=document.getElementById('dashboardCanvas').getBoundingClientRect(), s=getComputedStyle(t);
              return {text:t.textContent,box:{x:b.x,y:b.y,right:b.right,bottom:b.bottom},canvas:{x:c.x,y:c.y},viewport:{width:innerWidth,height:innerHeight},radius:s.borderRadius,font:s.fontSize};
            })()"""), description='visible chart tooltip')
            assert tip['radius'] == '8px' and tip['font'] == '12px', tip
            for entry in target['info']['entries']:
                assert entry['value'] in tip['text'], (entry, tip)
            b, c, p = tip['box'], tip['canvas'], target['info']['plot']
            assert b['x'] >= max(0, c['x']+p['x']) and b['right'] <= min(tip['viewport']['width'],c['x']+p['x']+p['width'])+1, tip
            assert b['y'] >= max(0,c['y']+p['y'])-1 and b['bottom'] <= min(tip['viewport']['height'],c['y']+p['y']+p['height'])+1, tip
            if artifact_dir:
                shot=cdp.command('Page.captureScreenshot', {'format':'png'})
                (artifact_dir / f'tooltip-{key}-{theme}.png').write_bytes(base64.b64decode(shot['data']))
            cdp.evaluate("document.getElementById('dashboardCanvas').dispatchEvent(new PointerEvent('pointerleave'))")
            assert cdp.evaluate("document.getElementById('chartTooltip').hidden")
            cdp.command('Input.dispatchMouseEvent', {'type':'mouseMoved','x':point['x']+1,'y':point['y']})
            cdp.evaluate("document.getElementById('playPause').click(); document.getElementById('pausePlayback').click()")
            assert cdp.evaluate("document.getElementById('chartTooltip').hidden"), 'Paused playback revived a stale tooltip'
            cdp.evaluate("document.getElementById('stopPlayback').click()")
        cdp.evaluate('window.scrollTo(0,0)')
    cdp.command('Emulation.setDeviceMetricsOverride', {'width':1440,'height':900,'deviceScaleFactor':1,'mobile':False})
    cdp.evaluate("window.postMessage({type:'quantum-dashboard-theme',theme:'dark'},location.origin)")
    wait_for(lambda: cdp.evaluate("document.documentElement.dataset.theme === 'dark'"), description='restore tooltip theme')
