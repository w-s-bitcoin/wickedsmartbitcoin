#!/usr/bin/env python3
"""Render the notebook-reference date, early history, and selected export modes.

Frozen published data and blocked live feeds; never invokes a data producer.
Writes review PNGs to /tmp/wsb-days-reference (or --output-dir).
"""
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
from test_export_scale_browser import TRACE
from test_stage1_refresh_atomicity import CdpSocket, free_port, wait_for


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output-dir', default='/tmp/wsb-days-reference')
    args = parser.parse_args()
    output = Path(args.output_dir)
    output.mkdir(parents=True, exist_ok=True)
    FrozenHandler.snapshot = {'/assets/' + name: (ROOT / 'assets' / name).read_bytes()
                             for name in ('daily_price.csv', 'daily_price_metadata.json')}
    port, debug = free_port(), free_port()
    server = ThreadingHTTPServer(('127.0.0.1', port),
        lambda *a, **kw: FrozenHandler(*a, directory=str(ROOT), **kw))
    threading.Thread(target=server.serve_forever, daemon=True).start()
    with tempfile.TemporaryDirectory(prefix='wsb-days-reference-') as profile:
        chrome = subprocess.Popen([CHROME, '--headless=new', '--disable-gpu', '--remote-allow-origins=*',
            f'--remote-debugging-port={debug}', f'--user-data-dir={profile}', 'about:blank'],
            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        try:
            wait_for(lambda: urllib.request.urlopen(f'http://127.0.0.1:{debug}/json/version', timeout=.5).read(), description='Chrome')
            target = json.load(urllib.request.urlopen(urllib.request.Request(
                f'http://127.0.0.1:{debug}/json/new?about:blank', method='PUT')))
            cdp = CdpSocket(target['webSocketDebuggerUrl'])
            for command in ('Page.enable', 'Runtime.enable', 'Network.enable'):
                cdp.command(command)
            cdp.command('Network.setBlockedURLs', {'urls': ['https://*', 'wss://*']})
            cdp.command('Page.addScriptToEvaluateOnNewDocument', {'source': SHIM + TRACE})
            cdp.command('Page.navigate', {'url': f'http://127.0.0.1:{port}/webapps/days_since_ath/dashboard.html'})
            wait_for(lambda: cdp.evaluate("!!document.querySelector('#endDateInput').value"), description='Days data')

            def select(group, value):
                if group == 'downloadChartModeSelect':
                    # The two chart buttons are a required multi-selection.
                    wanted = ['left', 'right'] if value == 'both' else [value]
                    cdp.evaluate(f"""(() => {{
                        const buttons=[...document.querySelectorAll('#{group} button')];
                        const wanted={json.dumps(wanted)};
                        for(const b of buttons) if(wanted.includes(b.dataset.value)&&b.getAttribute('aria-pressed')!=='true') b.click();
                        for(const b of buttons) if(!wanted.includes(b.dataset.value)&&b.getAttribute('aria-pressed')==='true') b.click();
                    }})()""")
                    return
                cdp.evaluate(f"document.querySelector('#{group} [data-value={json.dumps(value)}]').click()")

            def dates(start, end):
                for name, value in [('startDateInput', start), ('endDateInput', end)]:
                    cdp.evaluate(f"(() => {{const el=document.getElementById('{name}');el.value='{value}';el.dispatchEvent(new Event('change'));}})()")

            def capture(name):
                count = cdp.evaluate('__footerTest.downloads.length')
                cdp.evaluate("document.querySelector('#downloadImageBtn').click()")
                wait_for(lambda: cdp.evaluate(f'__footerTest.downloads.length>{count}||__footerTest.errors.length'),
                         timeout=60, description=name)
                assert not cdp.evaluate('__footerTest.errors'), cdp.evaluate('__footerTest.errors')
                encoded = cdp.evaluate("""(async()=>{
                    const bitmap=await createImageBitmap(__footerTest.downloads.at(-1).blob);
                    const canvas=document.createElement('canvas');
                    canvas.width=bitmap.width;canvas.height=bitmap.height;
                    canvas.getContext('2d').drawImage(bitmap,0,0);bitmap.close();
                    return canvas.toDataURL('image/png').split(',')[1];
                })()""")
                (output / f'{name}.png').write_bytes(base64.b64decode(encoded))
                trace = cdp.evaluate('__scaleExport.png')
                assert min(trace['width'], trace['height']) == 2160
                assert all(0 <= item['x'] <= 1 and 0 <= item['y'] <= 1 for item in trace['text']), trace
                labels = [item['text'] for item in trace['text']]
                print(name + ': rendered 2160-quality PNG', flush=True)
                return labels

            dates('2009-01-03', '2026-03-13')
            select('downloadThemeSelect', 'dark')
            labels = capture('reference-landscape')
            for expected in ('$126,094', '$73,789.00', '-41.48%', '158', 'MAR 13, 2026',
                             '630', '209', '1131', '1079', '188', '845', '236', 'Oct 6, 2025'):
                assert expected in labels, (expected, labels)
            for orientation in ('portrait', 'square'):
                select('downloadOrientationSelect', orientation)
                capture('reference-' + orientation)
            select('downloadOrientationSelect', 'landscape')
            select('downloadThemeSelect', 'light')
            capture('reference-light')
            select('downloadThemeSelect', 'dark')
            select('downloadChartModeSelect', 'left')
            select('downloadPriceScaleSelect', 'linear')
            labels = capture('price-linear')
            assert 'BTCUSD' in labels and 'DAYS SINCE ATH' not in labels
            select('downloadChartModeSelect', 'right')
            select('downloadDaysScaleSelect', 'log')
            labels = capture('days-log')
            assert 'BTCUSD' not in labels and 'DAYS SINCE ATH · LOG' in labels
            select('downloadChartModeSelect', 'both')
            select('downloadPriceScaleSelect', 'log')
            select('downloadDaysScaleSelect', 'linear')
            dates('2009-01-03', '2009-01-03')
            labels = capture('genesis')
            assert 'Not Valued' in labels and 'N/A' in labels
            dates('2025-10-07', '2026-03-13')
            labels = capture('cropped-range')
            assert '$126,094' in labels and '158' in labels
            for toggle in ('toggleAthLabels', 'toggleAthMarkers', 'toggleHalvings'):
                cdp.evaluate(f"document.getElementById('{toggle}').click()")
            dates('2009-01-03', '2026-03-13')
            labels = capture('annotations-hidden')
            assert '1131' not in labels and 'Oct 6, 2025' not in labels and '1st Halving' not in labels
            cdp.sock.close()
        finally:
            chrome.terminate()
            chrome.wait(timeout=10)
            server.shutdown()


if __name__ == '__main__':
    main()
