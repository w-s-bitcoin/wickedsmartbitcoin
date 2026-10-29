#!/usr/bin/env python3
"""Frozen UOA crypto visibility/history/share/reset and actual export regression."""
import argparse
import base64
import json
import subprocess
import tempfile
import threading
import urllib.request
from http.server import ThreadingHTTPServer
from pathlib import Path

from test_export_footer_browser import CHROME, ROOT, FrozenHandler, SHIM
from test_export_scale_browser import DECODE, INSTRUMENT, TRACE
from test_stage1_refresh_atomicity import CdpSocket, free_port, wait_for


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--data-dir', type=Path, default=ROOT/'webapps/uoa/webapp_data')
    args = parser.parse_args()
    meta = json.loads((args.data_dir/'uoa_pairs.json').read_text())
    coins = [code for code, entry in meta['currencies'].items() if entry.get('asset_type') == 'alternative_cryptocurrency']
    assert len(coins) >= 11
    FrozenHandler.snapshot = {'/assets/daily_price.csv': (ROOT/'assets/daily_price.csv').read_bytes()}
    for name in ['daily_fx_rates.csv', 'uoa_pairs.json', 'last_updated.txt']:
        FrozenHandler.snapshot['/webapps/uoa/webapp_data/'+name] = (args.data_dir/name).read_bytes()
    port, debug = free_port(), free_port()
    server = ThreadingHTTPServer(('127.0.0.1',port),lambda *a,**kw:FrozenHandler(*a,directory=str(ROOT),**kw))
    threading.Thread(target=server.serve_forever,daemon=True).start()
    with tempfile.TemporaryDirectory(prefix='wsb-uoa-crypto-') as profile:
        chrome = subprocess.Popen([CHROME,'--headless=new','--disable-gpu','--remote-allow-origins=*',f'--remote-debugging-port={debug}',f'--user-data-dir={profile}','about:blank'],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
        try:
            wait_for(lambda:urllib.request.urlopen(f'http://127.0.0.1:{debug}/json/version',timeout=.5).read(),description='Chrome')
            target=json.load(urllib.request.urlopen(urllib.request.Request(f'http://127.0.0.1:{debug}/json/new?about:blank',method='PUT')))
            cdp=CdpSocket(target['webSocketDebuggerUrl'])
            for command in ['Page.enable','Runtime.enable','Network.enable']:cdp.command(command)
            cdp.command('Network.setBlockedURLs',{'urls':['https://*','wss://*']})
            cdp.command('Page.addScriptToEvaluateOnNewDocument',{'source':SHIM+TRACE})
            base=f'http://127.0.0.1:{port}/webapps/uoa/dashboard.html'
            def ready():
                wait_for(lambda:cdp.evaluate("!!document.querySelector('#secondaryUoaSelect option[value=USD]') && !document.body.classList.contains('uoa-loading')"),timeout=40,description='UOA loaded')
            def select(selector, value):
                cdp.evaluate(f"(()=>{{const el=document.querySelector({json.dumps(selector)});el.value={json.dumps(value)};el.dispatchEvent(new Event('change',{{bubbles:true}}));}})()")
            def options():return cdp.evaluate("Array.from(document.querySelector('#secondaryUoaSelect').options,o=>o.value)")
            def checked():return cdp.evaluate("document.querySelector('#showAlternativeCryptocurrenciesToggle').checked")
            cdp.command('Page.navigate',{'url':base});ready()
            assert not checked()
            assert not set(coins).intersection(options())
            assert cdp.evaluate("!!(document.querySelector('#showAlternativeCryptocurrenciesToggle').compareDocumentPosition(document.querySelector('#showMonetaryMetalsToggle')) & Node.DOCUMENT_POSITION_FOLLOWING)")
            select('#uoaGroupSelect','alternative_cryptocurrencies')
            assert checked() and set(options()) == set(['BTC',*coins])
            select('#primaryUoaSelect','HYPE')
            cdp.evaluate("document.querySelector('[data-range=full]').click()")
            assert cdp.evaluate("document.querySelector('#startDateInput').value") == meta['alternative_crypto_history']['HYPE']['first_observation']
            cdp.evaluate("document.querySelector('#showAlternativeCryptocurrenciesToggle').click()")
            assert not checked() and not set(coins).intersection(options())
            assert cdp.evaluate("document.querySelector('#uoaGroupSelect').value") == 'all'
            assert cdp.evaluate("document.querySelector('#primaryUoaSelect').value") == 'BTC'
            cdp.evaluate("document.querySelector('#showAlternativeCryptocurrenciesToggle').click()")
            select('#primaryUoaSelect','DOGE');select('#secondaryUoaSelect','USD')
            cdp.evaluate("document.querySelector('[data-range=full]').click()")
            assert cdp.evaluate("document.querySelector('#startDateInput').value") == meta['alternative_crypto_history']['DOGE']['first_observation']
            before_reload = cdp.evaluate("({origin:performance.timeOrigin,stored:localStorage.getItem('uoa-dashboard-filters-v1')})")
            cdp.command('Page.reload')
            wait_for(lambda:cdp.evaluate('performance.timeOrigin') != before_reload['origin'], description='reload navigation')
            ready()
            assert checked() and cdp.evaluate("document.querySelector('#primaryUoaSelect').value") == 'DOGE', cdp.evaluate("({checked:document.querySelector('#showAlternativeCryptocurrenciesToggle').checked,pair:document.querySelector('#primaryUoaSelect').value,stored:localStorage.getItem('uoa-dashboard-filters-v1')})")
            cdp.evaluate("document.querySelector('#resetDashboard').click()")
            assert not checked() and not set(coins).intersection(options())
            cdp.evaluate("document.querySelector('#resetDashboard').click()")
            assert checked() and cdp.evaluate("document.querySelector('#primaryUoaSelect').value") == 'DOGE', cdp.evaluate("({checked:document.querySelector('#showAlternativeCryptocurrenciesToggle').checked,pair:document.querySelector('#primaryUoaSelect').value,stored:localStorage.getItem('uoa-dashboard-filters-v1')})")
            # Explicit variable-length pair URLs enable the group, even with a cold/off setting.
            cdp.evaluate('localStorage.clear()')
            cdp.command('Page.navigate',{'url':base+'?pair=HYPEUSD'});ready()
            assert checked() and cdp.evaluate("document.querySelector('#primaryUoaSelect').value") == 'HYPE'
            assert cdp.evaluate("document.querySelector('#secondaryUoaSelect').value") == 'USD'
            # Capture the real share payload and reload it without legacy pair parameters.
            cdp.evaluate("Object.defineProperty(navigator,'clipboard',{value:{writeText:async text=>{window.__copied=text;}}});document.querySelector('#copyDashboardLink').click()")
            wait_for(lambda:cdp.evaluate('window.__copied'),description='share link')
            shared=cdp.evaluate('new URL(__copied).search')
            cdp.evaluate('localStorage.clear()');cdp.command('Page.navigate',{'url':base+shared});ready()
            assert checked() and cdp.evaluate("document.querySelector('#primaryUoaSelect').value") == 'HYPE'
            cdp.command('Emulation.setDeviceMetricsOverride',{'width':390,'height':844,'deviceScaleFactor':2,'mobile':True})
            cdp.evaluate("document.querySelector('#uoaSettingsBtn').click()")
            assert cdp.evaluate("(()=>{const r=document.querySelector('label[for=showAlternativeCryptocurrenciesToggle]').getBoundingClientRect();return r.width>0&&r.left>=0&&r.right<=innerWidth;})()")
            shot=cdp.command('Page.captureScreenshot',{'format':'png'})
            Path('/tmp/wsb-uoa-crypto-settings.png').write_bytes(base64.b64decode(shot['data']))
            cdp.evaluate("document.querySelector('#uoaSettingsClose').click()")
            cdp.command('Emulation.setDeviceMetricsOverride',{'width':1440,'height':1000,'deviceScaleFactor':1,'mobile':False})
            cdp.evaluate(INSTRUMENT)
            cdp.evaluate("document.querySelector('#downloadImageBtn').click()")
            wait_for(lambda:cdp.evaluate('__footerTest.downloads.length===1||__footerTest.errors.length'),timeout=60,description='crypto PNG')
            assert not cdp.evaluate('__footerTest.errors'),cdp.evaluate('__footerTest.errors')
            assert cdp.evaluate(DECODE)==[3840,2160]
            text=cdp.evaluate('__scaleExport.png.text.map(x=>x.text).join(" ")')
            assert 'Hyperliquid' in text or 'HYPE' in text,text
            cdp.evaluate("document.querySelector('#dateRangeDownloadBtn').click()")
            wait_for(lambda:cdp.evaluate('__footerTest.downloads.length===2||__footerTest.errors.length'),timeout=60,description='crypto video')
            assert not cdp.evaluate('__footerTest.errors'),cdp.evaluate('__footerTest.errors')
            assert cdp.evaluate(DECODE)==[1280,720]
            assert cdp.evaluate("document.querySelector('#primaryUoaSelect').value") == 'HYPE'
            cdp.sock.close()
            print('UOA: default-off group, full histories, hide fallback, persistence, reset/undo, four-letter pair/share URLs, PNG and decoded video passed')
        finally:
            chrome.terminate();chrome.wait(timeout=10);server.shutdown()


if __name__=='__main__':main()
