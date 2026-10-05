#!/usr/bin/env python3
"""Real Chrome integration with isolated immutable exports and fetch failures."""
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import threading
import urllib.request
from http.server import ThreadingHTTPServer

from test_stage1_refresh_atomicity import CdpSocket, QuietHandler, free_port, wait_for
from test_quantum_immutable_generation import seed, seed_archive_summaries

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "webapps/quantum_exposure/pipeline"))
import immutable_generation as publication
import quantum_runtime as runtime
import quantum_v2_delivery as delivery


def main():
    chrome_binary = os.environ.get("CHROME_BIN", "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome")
    if not Path(chrome_binary).is_file():
        raise SystemExit("Chrome unavailable; set CHROME_BIN")
    with tempfile.TemporaryDirectory(prefix="quantum-v2-browser-") as directory:
        root = Path(directory)
        for source, target in runtime.runtime_dependency_copies(ROOT / "webapps/quantum_exposure", root):
            runtime.copy_file_if_changed(source, target)
        first = root / "fixtures/1"
        first.mkdir(parents=True)
        metadata = seed(first)
        seed_archive_summaries(first, heights=(500,))
        marker1 = json.loads(publication.publish_immutable_generation(first, metadata=metadata, reason="fixture", generation_id="browser-1", include_archives=True))
        second = root / "fixtures/2"
        delivery.prepare_output(first, second, 2000)
        metadata2 = seed(second, 2000)
        metadata2["snapshot_blockheight"] = 2000
        marker2 = delivery.finish_output(second, metadata2, "browser-2")
        server_port, debug_port = free_port(), free_port()
        server = ThreadingHTTPServer(("127.0.0.1", server_port), lambda *args, **kwargs: QuietHandler(*args, directory=str(root), **kwargs))
        threading.Thread(target=server.serve_forever, daemon=True).start()
        chrome = subprocess.Popen([chrome_binary, "--headless=new", "--disable-gpu", "--remote-allow-origins=*",
                                   f"--remote-debugging-port={debug_port}", f"--user-data-dir={root / 'profile'}", "about:blank"],
                                  stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        try:
            wait_for(lambda: urllib.request.urlopen(f"http://127.0.0.1:{debug_port}/json/version", timeout=.5).read(), description="Chrome")
            target = json.load(urllib.request.urlopen(urllib.request.Request(f"http://127.0.0.1:{debug_port}/json/new?about:blank", method="PUT"), timeout=2))
            cdp = CdpSocket(target["webSocketDebuggerUrl"])
            cdp.command("Page.enable")
            cdp.command("Runtime.enable")
            cdp.command("Page.addScriptToEvaluateOnNewDocument", {"source": """
              window.fixture = { generation: 1, corrupt: '', requests: [], errors: [] };
              addEventListener('error', event => fixture.errors.push(event.message));
              const originalFetch = window.fetch.bind(window);
              window.fetch = async (input, options) => {
                const url = new URL(String(input), location.href);
                const prefix = '/webapps/quantum_exposure/webapp_data/';
                if (!url.pathname.startsWith(prefix)) return originalFetch(input, options);
                const path = url.pathname.slice(prefix.length);
                fixture.requests.push(path);
                if (path === fixture.holdPath) {
                  await new Promise(resolve => { fixture.releaseHold = resolve; });
                }
                const response = await originalFetch(`/fixtures/${fixture.generation}/${path}`, options);
                if (path === fixture.corrupt) {
                  const bytes = new Uint8Array(await response.arrayBuffer());
                  if (bytes.length) bytes[bytes.length - 2] ^= 1;
                  return new Response(bytes, { status: response.status });
                }
                return response;
              };
            """})
            cdp.command("Page.navigate", {"url": f"http://127.0.0.1:{server_port}/webapps/quantum_exposure/dashboard.html"})
            try:
                wait_for(lambda: cdp.evaluate("typeof state !== 'undefined' && state.publishedGenerationSignature && state.ge1Rows.length"), description="v2 initial verified generation")
            except TimeoutError:
                raise AssertionError(cdp.evaluate("({ errors: fixture.errors, requests: fixture.requests, height: typeof state === 'undefined' ? null : state.snapshotHeight, reason: typeof quantumLastRefreshValidationReason === 'undefined' ? null : quantumLastRefreshValidationReason })"))
            assert cdp.evaluate("state.ge1IsUsingEcoSubset"), "Initial load expanded full detail"
            assert cdp.evaluate("document.getElementById('kpiExposedPubkeys').closest('.kpi').querySelector('.kpi-title').textContent")=='Exposed Groups'
            assert 'reporting group' in cdp.evaluate("document.getElementById('kpiExposedPubkeys').closest('.kpi').querySelector('.kpi-title').getAttribute('data-tooltip')")
            subset=cdp.evaluate("aggregateAllKpis({balance:'ge1',scriptTypes:['P2PK','P2PKH'],spendActivities:['all']})")
            overall=cdp.evaluate("aggregateAllKpis({balance:'ge1',scriptTypes:['All'],spendActivities:['all']})")
            assert subset['exposed_pubkey_count']==overall['exposed_pubkey_count']==1,(subset,overall)
            assert subset['estimated_migration_blocks']==overall['estimated_migration_blocks']>0,(subset,overall)
            assert not cdp.evaluate("fixture.requests.some(path => path.includes('blockheight_to_datetime'))")
            summary_path = marker1['artifacts']['historical_archive_summaries.csv']['path']
            assert not cdp.evaluate(f"fixture.requests.includes({json.dumps(summary_path)})"), 'Compact-first rendering eagerly fetched archive summaries'
            assert cdp.evaluate("state.archivedSnapshotsAvailable"), 'Summary-only history did not enable the archive control'
            assert cdp.evaluate("state.snapshotLocationByHeight['500'] === undefined && !state.availableSnapshots.includes('500')"), 'Summary-only point became a selectable snapshot'
            cdp.evaluate(f"fixture.corrupt = {json.dumps(summary_path)}; state.archivedSnapshotsEnabled = true; true")
            summary_failure = cdp.evaluate("""(async () => {
              const before = state.publishedGenerationSignature;
              try { await loadHistoricalAggregateCsvRowsBySnapshot({ includeArchived: true }); return false; }
              catch (_error) { return state.publishedGenerationSignature === before && state.snapshotHeight === '1000'; }
            })()""")
            assert summary_failure, 'Corrupt lazy summary silently became missing history'
            cdp.evaluate("state.scriptPanelMode = 'historical'; resetHistoricalSeriesState(); update(); true")
            wait_for(lambda: cdp.evaluate("!!state.historicalSeriesError && !!document.querySelector('.historical-retry')"), description='bounded historical failure')
            assert cdp.evaluate("""(async () => {
              const count = fixture.requests.length; update(); update();
              await new Promise(resolve => setTimeout(resolve, 250));
              return fixture.requests.length === count && state.snapshotHeight === '1000';
            })()"""), 'Historical failure retried automatically without bound'
            cdp.evaluate("fixture.corrupt = ''; document.querySelector('.historical-retry').click(); true")
            wait_for(lambda: cdp.evaluate("state.historicalSeries.some(point => point.snapshot === '500')"), description='explicit historical retry')
            assert cdp.evaluate("state.historicalSeries.some(point => point.snapshot === '500')"), 'Preserved summary absent from archive history'
            assert cdp.evaluate("quantumMethodologyLabel('500').includes('unreconciled')"), 'Legacy history was presented as corrected analysis'
            assert not cdp.evaluate("fixture.requests.some(path => /^500\\//.test(path) || /^archived\\/500\\//.test(path))"), 'Summary-only point fetched nonexistent snapshot payloads'
            for mobile in (False, True):
                cdp.command('Emulation.setDeviceMetricsOverride', {'width': 390 if mobile else 1200,
                    'height': 850, 'deviceScaleFactor': 1, 'mobile': mobile})
                clicked = cdp.evaluate("""(async () => {
                  await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
                  update();
                  const target = document.getElementById('historicalHoverTarget');
                  const rect = target.getBoundingClientRect();
                  const before = [state.snapshotHeight, location.href, document.getElementById('kpiExposedPubkeys').textContent];
                  const count = fixture.requests.length;
                  for (const type of ['mousemove', 'click', 'click', 'dblclick']) {
                    target.dispatchEvent(new MouseEvent(type, { bubbles: true,
                      clientX: rect.left + rect.width / 2, clientY: rect.top + rect.height / 2 }));
                  }
                  const tooltip = document.getElementById('historicalHoverTooltip').textContent;
                  await new Promise(resolve => setTimeout(resolve, 100));
                  return { unchanged: JSON.stringify(before) === JSON.stringify([state.snapshotHeight, location.href,
                    document.getElementById('kpiExposedPubkeys').textContent]), noFetch: count === fixture.requests.length,
                    tooltip };
                })()""")
                assert clicked['unchanged'] and clicked['noFetch'], (mobile, clicked)
                assert 'unreconciled' in clicked['tooltip'] and 'details unavailable' in clicked['tooltip'], (mobile, clicked)
            cdp.command('Emulation.clearDeviceMetricsOverride')
            cdp.evaluate("document.getElementById('archivedSnapshotsToggle').click(); true")
            wait_for(lambda: cdp.evaluate("!state.archivedSnapshotsEnabled && !state.historicalSeries.some(point => point.snapshot === '500')"), description='hide archive history')
            old_history = cdp.evaluate("JSON.stringify(state.historicalSeries)")
            cdp.evaluate(f"fixture.corrupt = {json.dumps(summary_path)}; document.getElementById('archivedSnapshotsToggle').click(); true")
            wait_for(lambda: cdp.evaluate("document.getElementById('archivedSnapshotsToggle').getAttribute('data-tooltip')?.includes('could not be verified')"), description='failed archive toggle')
            assert cdp.evaluate("JSON.stringify(state.historicalSeries)") == old_history
            assert cdp.evaluate("!state.archivedSnapshotsEnabled && state.snapshotHeight === '1000'"), 'Failed archive toggle changed visible data'
            cdp.evaluate(f"fixture.corrupt = ''; fixture.holdPath = {json.dumps(summary_path)}; document.getElementById('archivedSnapshotsToggle').click(); true")
            wait_for(lambda: cdp.evaluate("typeof fixture.releaseHold === 'function'"), description='pending archive toggle')
            held_count = cdp.evaluate(f"fixture.requests.filter(path => path === {json.dumps(summary_path)}).length")
            cdp.evaluate("document.getElementById('archivedSnapshotsToggle').click(); true")
            assert cdp.evaluate(f"fixture.requests.filter(path => path === {json.dumps(summary_path)}).length") == held_count, 'Archive toggle allowed overlapping preparations'
            cdp.evaluate("fixture.holdPath = ''; fixture.releaseHold(); true")
            wait_for(lambda: cdp.evaluate("state.archivedSnapshotsEnabled && state.historicalSeries.some(point => point.snapshot === '500')"), description='archive toggle retry')
            sentinel = cdp.evaluate("""(() => {
              const originalRows = state.ge1Rows, originalManifest = state.publicationManifest;
              state.publicationManifest = { metadata: { methodology_by_snapshot: { '1000': { methodology_version: 'legacy-v1-unreconciled' } } } };
              state.ge1Rows = originalRows.map(row => ({ ...row, last_spend_blockheight: '1', last_spend_unix_time: '1231469665', spend_activity: 'inactive' }));
              state.topExposuresDataCache.clear(); updateTopExposures();
              const tooltip = document.querySelector('#topExposuresList .tag-spend-inactive')?.getAttribute('data-tooltip') || '';
              state.ge1Rows = originalRows; state.publicationManifest = originalManifest;
              state.topExposuresDataCache.clear(); updateTopExposures();
              return tooltip;
            })()""")
            assert 'Last spend: Unknown (legacy placeholder)' in sentinel, sentinel
            assert 'Last spend: 16' not in sentinel and '1 ·' not in sentinel, sentinel
            full_path = marker1["artifacts"]["1000/dashboard_pubkeys_ge_1btc.csv"]["path"]
            cdp.evaluate(f"fixture.corrupt = {json.dumps(full_path)}; true")
            cdp.evaluate("triggerFullDataLoad()")
            assert cdp.evaluate("state.ge1IsUsingEcoSubset"), "Corrupt lazy detail replaced visible rows"
            cdp.evaluate("fixture.corrupt = ''; triggerFullDataLoad()")
            assert not cdp.evaluate("state.ge1IsUsingEcoSubset"), "Verified lazy detail failed"
            # Fix the old selection by advertising another installed latest;
            # refresh must preserve its verified full cache when it is omitted.
            cdp.evaluate("state.publishedSnapshotHeight = '1500'; state.availableSnapshots = ['1500', '1000']; fixture.generation = 2; true")
            signature = json.dumps(json.dumps(marker2))
            correction_path=marker2['artifacts']['2000/dashboard_script_corrections.csv']['path']
            cdp.evaluate(f"fixture.corrupt = {json.dumps(correction_path)}; true")
            corrupt=cdp.evaluate(f"""(async () => {{
              const before=state.publishedGenerationSignature;
              try {{ await prepareQuantumDataRefresh({{signature:{signature},fetchFresh:url=>fetch(url)}}); return false; }}
              catch (_error) {{ return state.publishedGenerationSignature===before && state.snapshotHeight==='1000'; }}
            }})()""")
            assert corrupt,'Corrupt corrections must reject the candidate and preserve visible generation'
            cdp.evaluate("fixture.corrupt = ''; true")
            summary_path2 = marker2['artifacts']['historical_archive_summaries.csv']['path']
            cdp.evaluate(f"fixture.corrupt = {json.dumps(summary_path2)}; true")
            bad_history = cdp.evaluate(f"""(async () => {{
              const before = state.publishedGenerationSignature;
              try {{ await prepareQuantumDataRefresh({{ signature: {signature}, fetchFresh: url => fetch(url) }}); return false; }}
              catch (_error) {{ return state.publishedGenerationSignature === before
                && state.historicalSeries.some(point => point.snapshot === '500'); }}
            }})()""")
            assert bad_history, 'Corrupt refresh summary replaced or dropped installed history'
            cdp.evaluate("fixture.corrupt = ''; true")
            result = cdp.evaluate(f"""(async () => {{
              const candidate = await prepareQuantumDataRefresh({{ signature: {signature}, fetchFresh: url => fetch(url) }});
              const valid = validateQuantumDataRefresh(candidate);
              return {{ valid, reason: quantumLastRefreshValidationReason, committed: valid && commitQuantumDataRefresh(candidate),
                height: state.snapshotHeight, selected: document.getElementById('snapshotFilter').value,
                full: !state.ge1IsUsingEcoSubset, latest: state.availableSnapshots[0] }};
            }})()""")
            assert result == {"valid": True, "reason": "", "committed": True, "height": "1000", "selected": "1000", "full": True, "latest": "2000"}, result
            assert cdp.evaluate("state.historicalSeries.some(point => point.snapshot === '500') && state.snapshotLocationByHeight['500'] === undefined"), 'Atomic refresh lost summary-only history or made it selectable'
            assert not cdp.evaluate("fixture.errors.length"), cdp.evaluate("fixture.errors")
            print("Quantum v2 Chrome fixture passed: compact-first load, lazy detail/summary integrity, archive history, atomic refresh and selected snapshot retention.")
        finally:
            chrome.terminate()
            try:
                chrome.wait(timeout=5)
            except subprocess.TimeoutExpired:
                chrome.kill()
            server.shutdown()


if __name__ == "__main__":
    main()
