#!/usr/bin/env python3
"""Browser regressions for the shared no-reload dashboard refresh controller.

The production files served by this test are never modified. A fetch harness
installed before each dashboard script runs changes only the controller's
signature responses while returning the repository's original files to each
adapter. This models a newly published generation without manufacturing five
large fixture datasets.

Coverage:

* UOA, DCA Comparison, DCA Cost Basis, Bitcoin Net Worth, and Quantum Exposure;
* hidden-document fetching followed by a visible presentation catch-up;
* no navigation/reload, routine loader visibility, or panel blanking;
* representative date-range/filter selections survive both refreshes;
* a generation superseded during prepare is rejected before commit.

Run from anywhere with:

    python3 scripts/test_stage2_refresh_atomicity.py

Dashboard slugs may be passed to run a subset. Set CHROME_BIN when Chrome is
installed somewhere other than the default macOS application path.
"""

from __future__ import annotations

import json
import os
import subprocess
import sys
import tempfile
import threading
import time
import urllib.request
from http.server import ThreadingHTTPServer
from pathlib import Path

from test_stage1_refresh_atomicity import (
    CdpSocket,
    QuietHandler,
    free_port,
    wait_for,
)


ROOT = Path(__file__).resolve().parents[1]
CHROME = os.environ.get(
    "CHROME_BIN",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
)


DASHBOARDS = {
    "uoa": {
        "path": "webapps/uoa/dashboard.html",
        "ready": """
          !document.body.classList.contains('uoa-loading')
          && document.querySelector('#usdBtcChart')?.width > 0
          && document.querySelector('#btcUsdChart')?.width > 0
          && document.querySelector('#primaryUoaSelect')?.options.length > 1
        """,
        "anchors": ["#usdBtcChart", "#btcUsdChart"],
        "select": "#primaryUoaSelect",
        "range": True,
        "capture": """
          ({
            primary: document.querySelector('#primaryUoaSelect')?.value || '',
            secondary: document.querySelector('#secondaryUoaSelect')?.value || '',
            start: document.querySelector('#dateRangeStartSlider')?.value || '',
            end: document.querySelector('#dateRangeEndSlider')?.value || '',
          })
        """,
    },
    "dca_comparison": {
        "path": "webapps/dca_comparison/dashboard.html",
        "ready": """
          document.querySelector('#chartLoader')?.getAttribute('aria-hidden') === 'true'
          && document.querySelector('#chartCanvas')?.width > 0
          && document.querySelector('#assetASelect')?.options.length > 1
        """,
        "anchors": ["#chartCanvas"],
        "select": "#assetASelect",
        "range": True,
        "capture": """
          ({
            assetA: document.querySelector('#assetASelect')?.value || '',
            assetB: document.querySelector('#assetBSelect')?.value || '',
            cadence: document.querySelector('#cadenceSelect')?.value || '',
            start: document.querySelector('#dateRangeStartSlider')?.value || '',
            end: document.querySelector('#dateRangeEndSlider')?.value || '',
          })
        """,
    },
    "dca_cost_basis": {
        "path": "webapps/dca_cost_basis/dashboard.html",
        "ready": """
          document.querySelector('#chartLoader')?.getAttribute('aria-hidden') === 'true'
          && document.querySelector('#costBasisChart')?.childElementCount > 0
          && document.querySelector('#cadenceSelect')?.options.length > 1
        """,
        "anchors": ["#costBasisChart"],
        "select": "#cadenceSelect",
        "range": True,
        "capture": """
          ({
            cadence: document.querySelector('#cadenceSelect')?.value || '',
            scale: document.querySelector('#scaleSelect')?.value || '',
            start: document.querySelector('#dateRangeStartSlider')?.value || '',
            end: document.querySelector('#dateRangeEndSlider')?.value || '',
          })
        """,
    },
    "bitcoin_net_worth": {
        "path": "webapps/bitcoin_net_worth/dashboard.html",
        "ready": """
          document.querySelector('#netChartLoader')?.getAttribute('aria-hidden') === 'true'
          && document.querySelector('#alChartLoader')?.getAttribute('aria-hidden') === 'true'
          && document.querySelector('#historyTableBody')?.children.length > 0
          && document.querySelector('#primaryUoaSelect')?.options.length > 1
        """,
        "anchors": ["#netChart", "#alChart", "#historyTableBody"],
        "select": "#primaryUoaSelect",
        "range": False,
        "capture": """
          ({
            primary: document.querySelector('#primaryUoaSelect')?.value || '',
            secondary: document.querySelector('#secondaryUoaSelect')?.value || '',
            selectedHistory: document.querySelector('#historyTableBody tr.active-snapshot td')
              ?.textContent?.trim() || '',
          })
        """,
    },
    "quantum_exposure": {
        "path": "webapps/quantum_exposure/dashboard.html",
        "ready": """
          document.querySelector('#snapshotFilter')?.options.length > 0
          && document.querySelector('#scriptBars')?.textContent?.trim()
          && !document.querySelector('#scriptBars')?.textContent?.includes('Loading')
          && document.querySelector('#topExposuresList')?.textContent?.trim()
          && !document.querySelector('#topExposuresList')?.textContent?.includes('Loading')
        """,
        "anchors": ["#scriptBars", "#topExposuresList"],
        "select": "#balanceFilter",
        "range": False,
        "capture": """
          ({
            snapshot: document.querySelector('#snapshotFilter')?.value || '',
            balance: document.querySelector('#balanceFilter')?.value || '',
            scriptMode: document.querySelector('#scriptPanelSupplyMode')?.value || '',
            panelMode: document.querySelector('#scriptPanelModeToggle')?.dataset.mode || '',
          })
        """,
    },
}


FETCH_HARNESS = r"""
  (() => {
    const nativeFetch = window.fetch.bind(window);
    const signaturePaths = {
      '/webapps/uoa/dashboard.html': '/webapps/uoa/webapp_data/last_updated.txt',
      '/webapps/dca_comparison/dashboard.html': '/webapps/dca_comparison/webapp_data/last_updated.txt',
      '/webapps/dca_cost_basis/dashboard.html': '/webapps/dca_cost_basis/webapp_data/dca_cost_basis_metadata.json',
      '/webapps/bitcoin_net_worth/dashboard.html': '/assets/last_updated.txt',
      '/webapps/quantum_exposure/dashboard.html': '/webapps/quantum_exposure/webapp_data/published_generation.json',
    };
    const signaturePath = signaturePaths[window.location.pathname] || '';
    const loadKey = `wsb-stage2-load-count:${window.location.pathname}`;
    const loadCount = Number(sessionStorage.getItem(loadKey) || '0') + 1;
    sessionStorage.setItem(loadKey, String(loadCount));

    const test = {
      generation: Number(new URLSearchParams(window.location.search).get('stage2_initial_generation') || '0'),
      mode: 'pass',
      pending: [],
      normalHoldSubstring: '',
      normalPending: [],
      freshFailureSubstring: '',
      freshFailuresRemaining: 0,
      signatureRequests: [],
      dataRequests: [],
      events: [],
      errors: [],
      loaderShows: [],
      blankSamples: [],
      loadCount,
      monitorTimer: 0,
      monitorObserver: null,
      anchorSelectors: [],
      setGeneration(generation, mode = 'pass') {
        if (this.pending.length) throw new Error('Cannot replace a generation with held requests pending.');
        this.generation = Number(generation);
        this.mode = mode;
      },
      releaseAll() {
        const releases = this.pending.splice(0);
        releases.forEach((release) => release());
        return releases.length;
      },
      holdNormalRequests(pathSubstring) {
        if (this.normalPending.length) throw new Error('Normal requests are already held.');
        this.normalHoldSubstring = String(pathSubstring || '');
      },
      releaseNormalRequests() {
        this.normalHoldSubstring = '';
        const releases = this.normalPending.splice(0);
        releases.forEach((release) => release());
        return releases.length;
      },
      failFreshRequests(pathSubstring, count = 1) {
        this.freshFailureSubstring = String(pathSubstring || '');
        this.freshFailuresRemaining = Math.max(0, Number(count) || 0);
      },
    };
    window.__wsbStage2RefreshTest = test;

    const generationFromSignature = (value) => {
      const match = String(value || '').match(/(?:#stage2-generation-|"generation_id":"stage2-generation-)(\d+)/);
      return match ? Number(match[1]) : 0;
    };
    window.addEventListener('wsb:data-refresh-status', (event) => {
      const detail = event.detail || {};
      test.events.push({
        status: detail.status || '',
        generation: generationFromSignature(detail.signature),
        requestId: detail.requestId || 0,
      });
    });
    window.addEventListener('error', (event) => {
      test.errors.push(String(event.error?.stack || event.message || event.error || 'window error'));
    });
    window.addEventListener('unhandledrejection', (event) => {
      test.errors.push(String(event.reason?.stack || event.reason || 'unhandled rejection'));
    });

    const fetchSource = async (input, init) => {
      const response = await nativeFetch(input, init);
      const raw = typeof input === 'string' ? input : input?.url;
      const url = new URL(raw, window.location.href);
      const synthesizeBtcTailLag = (
        [
          '/webapps/uoa/dashboard.html',
          '/webapps/dca_comparison/dashboard.html',
        ].includes(window.location.pathname)
        && new URLSearchParams(window.location.search).get('stage2_btc_tail_lag') === '1'
        && url.pathname === '/assets/daily_price.csv'
        && response.ok
      );
      if (!synthesizeBtcTailLag) return response;

      const text = await response.clone().text();
      const lines = text.trimEnd().split(/\r?\n/);
      const latest = String(lines[lines.length - 1] || '').split(',');
      const instant = new Date(`${latest[1]?.replace(' ', 'T')}Z`);
      if (latest.length < 5 || Number.isNaN(instant.getTime())) return response;
      instant.setUTCDate(instant.getUTCDate() + 1);
      latest[0] = `${instant.getUTCMonth() + 1}/${instant.getUTCDate()}/${String(instant.getUTCFullYear()).slice(-2)}`;
      latest[1] = instant.toISOString().slice(0, 19).replace('T', ' ');
      latest[4] = String(Number(latest[4] || 0) + 1);
      const headers = new Headers(response.headers);
      headers.delete('content-length');
      headers.delete('content-encoding');
      return new Response(`${lines.join('\n')}\n${latest.join(',')}\n`, {
        status: response.status,
        statusText: response.statusText,
        headers,
      });
    };

    const signaturePhase = (refreshValue) => {
      const match = String(refreshValue || '').match(/-(probe|pre-commit|pre-update|verify)-/);
      return match ? match[1] : '';
    };
    const freshResponse = async (input, init, generation, phase) => {
      const response = await fetchSource(input, init);
      if (!response.ok) return response;
      const text = await response.clone().text();
      const headers = new Headers(response.headers);
      headers.delete('content-length');
      headers.delete('content-encoding');
      headers.set('cache-control', 'no-store');
      headers.set('x-wsb-stage2-generation', String(generation));
      test.signatureRequests.push({ generation, phase });
      let responseText = `${text}\n#stage2-generation-${generation}`;
      if (signaturePath.endsWith('/published_generation.json')) {
        const marker = JSON.parse(text);
        marker.generation_id = `stage2-generation-${generation}`;
        responseText = JSON.stringify(marker);
      }
      return new Response(responseText, {
        status: response.status,
        statusText: response.statusText,
        headers,
      });
    };

    window.fetch = async (input, init) => {
      const raw = typeof input === 'string' ? input : input?.url;
      const url = new URL(raw, window.location.href);
      const refreshValue = url.searchParams.get('wsb_refresh') || '';
      const phase = signaturePhase(refreshValue);

      if (signaturePath && url.pathname === signaturePath && phase && test.generation > 0) {
        return freshResponse(input, init, test.generation, phase);
      }

      // Net Worth brackets its large price fetch with fresh reads of the small
      // watched price marker. Return the same simulated marker generation to
      // those adapter reads so candidate.signature can be checked exactly.
      if (
        window.location.pathname === '/webapps/bitcoin_net_worth/dashboard.html'
        && url.pathname === signaturePath
        && refreshValue.includes('-data-')
        && test.generation > 0
      ) {
        return freshResponse(input, init, test.generation, 'candidate');
      }

      if (refreshValue.includes('-data-')) {
        test.dataRequests.push({
          generation: test.generation,
          pathname: url.pathname,
          held: test.mode === 'hold-data',
        });
        if (
          test.freshFailuresRemaining > 0
          && test.freshFailureSubstring
          && url.pathname.includes(test.freshFailureSubstring)
        ) {
          test.freshFailuresRemaining -= 1;
          if (test.freshFailuresRemaining === 0) test.freshFailureSubstring = '';
          throw new TypeError(`Synthetic transient fetch failure for ${url.pathname}`);
        }
        if (test.mode === 'hold-data') {
          return new Promise((resolve, reject) => {
            test.pending.push(() => fetchSource(input, init).then(resolve, reject));
          });
        }
      }
      if (
        !refreshValue
        && test.normalHoldSubstring
        && url.pathname.includes(test.normalHoldSubstring)
      ) {
        return new Promise((resolve, reject) => {
          test.normalPending.push(() => fetchSource(input, init).then(resolve, reject));
        });
      }
      return fetchSource(input, init);
    };

    function isVisible(element) {
      if (!element || !element.isConnected || element.hidden) return false;
      const style = getComputedStyle(element);
      return style.display !== 'none'
        && style.visibility !== 'hidden'
        && Number(style.opacity || '1') > 0
        && element.getAttribute('aria-hidden') !== 'true';
    }

    function anchorIsBlank(selector) {
      const element = document.querySelector(selector);
      if (!element || !element.isConnected) return true;
      if (element instanceof HTMLCanvasElement) {
        return element.width <= 0 || element.height <= 0;
      }
      if (element.tagName === 'TBODY') return element.children.length === 0;
      if (element.id === 'costBasisChart') return element.childElementCount === 0;
      if (element.id === 'scriptBars' || element.id === 'topExposuresList') {
        const text = element.textContent.trim();
        return !text || /Loading/i.test(text);
      }
      return false;
    }

    test.startMonitor = (anchorSelectors) => {
      test.anchorSelectors = [...anchorSelectors];
      test.loaderShows = [];
      test.blankSamples = [];
      const sample = () => {
        document.querySelectorAll('.dashboard-ring-loader').forEach((loader) => {
          if (isVisible(loader)) {
            const key = loader.id || loader.getAttribute('aria-label') || loader.className;
            if (!test.loaderShows.includes(key)) test.loaderShows.push(key);
          }
        });
        test.anchorSelectors.forEach((selector) => {
          if (anchorIsBlank(selector) && !test.blankSamples.includes(selector)) {
            test.blankSamples.push(selector);
          }
        });
      };
      sample();
      test.monitorTimer = window.setInterval(sample, 20);
      test.monitorObserver = new MutationObserver(sample);
      test.monitorObserver.observe(document.body, {
        subtree: true,
        childList: true,
        attributes: true,
        attributeFilter: ['class', 'style', 'hidden', 'aria-hidden'],
      });
    };
    test.stopMonitor = () => {
      if (test.monitorTimer) window.clearInterval(test.monitorTimer);
      test.monitorTimer = 0;
      test.monitorObserver?.disconnect();
      test.monitorObserver = null;
    };
  })();
"""


def capture_state(cdp: CdpSocket, spec: dict):
    return cdp.evaluate(f"(() => {spec['capture']})()")


def set_representative_state(cdp: CdpSocket, spec: dict):
    script = f"""
      (async () => {{
        const select = document.querySelector({json.dumps(spec['select'])});
        if (select && select.options.length > 1) {{
          const option = [...select.options].find((item, index) => (
            index > 0 && !item.disabled && item.value !== select.value
          ));
          if (option) {{
            select.value = option.value;
            select.dispatchEvent(new Event('change', {{ bubbles: true }}));
          }}
        }}
        if ({str(spec['range']).lower()}) {{
          const start = document.querySelector('#dateRangeStartSlider');
          const end = document.querySelector('#dateRangeEndSlider');
          if (start && end) {{
            const min = Number(start.min || 0);
            const max = Number(end.max || start.max || 0);
            const span = Math.max(0, max - min);
            const startValue = Math.round(min + span * 0.21);
            const endValue = Math.max(startValue, Math.round(min + span * 0.79));
            start.value = String(startValue);
            start.dispatchEvent(new Event('input', {{ bubbles: true }}));
            start.dispatchEvent(new Event('change', {{ bubbles: true }}));
            end.value = String(endValue);
            end.dispatchEvent(new Event('input', {{ bubbles: true }}));
            end.dispatchEvent(new Event('change', {{ bubbles: true }}));
          }}
        }}
        document.activeElement?.blur?.();
        await new Promise((resolve) => setTimeout(resolve, 300));
        return true;
      }})()
    """
    cdp.evaluate(script)


def wait_for_generation_event(cdp: CdpSocket, status: str, generation: int, *, timeout=60):
    return wait_for(
        lambda: cdp.evaluate(
            "window.__wsbStage2RefreshTest?.events.some((event) => "
            f"event.status === {json.dumps(status)} && event.generation === {generation})"
        ),
        timeout=timeout,
        description=f"{status} event for generation {generation}",
    )


def assert_state_preserved(cdp: CdpSocket, spec: dict, expected, stage: str):
    actual = capture_state(cdp, spec)
    if actual != expected:
        raise AssertionError(
            f"Dashboard state changed during {stage}: expected={expected!r}, actual={actual!r}"
        )


def test_quantum_snapshot_load_serialization(cdp: CdpSocket):
    target = cdp.evaluate(
        r"""
          (() => {
            const select = document.querySelector('#snapshotFilter');
            const target = [...(select?.options || [])]
              .map((option) => option.value)
              .find((value) => value && value !== select.value);
            if (!target || typeof window.loadSnapshotData !== 'function') return '';
            window.__wsbStage2RefreshTest.holdNormalRequests(
              `/${target}/dashboard_pubkeys_ge_1btc_top100.csv`
            );
            window.__wsbQuantumSnapshotRacePromise = window.loadSnapshotData(target);
            return target;
          })()
        """
    )
    if not target:
        raise AssertionError("Quantum race regression needs a second snapshot and loadSnapshotData()")

    wait_for(
        lambda: cdp.evaluate(
            "window.__wsbStage2RefreshTest.normalPending.length > 0"
        ),
        timeout=40,
        description="held Quantum top-100 interaction load",
    )
    cdp.evaluate(
        "window.__wsbStage2RefreshTest.setGeneration(8, 'pass'); "
        "window.WSBWebappDataAutoRefresh.requestCheck('quantum-interaction-race'); true"
    )
    wait_for_generation_event(cdp, "deferred", 8, timeout=80)
    if cdp.evaluate(
        "window.__wsbStage2RefreshTest.events.some((event) => "
        "event.status === 'applied' && event.generation === 8)"
    ):
        raise AssertionError("Quantum refresh committed while a snapshot load was active")

    released = cdp.evaluate(
        "window.__wsbStage2RefreshTest.releaseNormalRequests()"
    )
    if released < 1:
        raise AssertionError("Quantum race regression did not release a held top-100 request")
    wait_for(
        lambda: cdp.evaluate(
            "window.__wsbQuantumSnapshotRacePromise "
            "&& Promise.resolve(window.__wsbQuantumSnapshotRacePromise).then(() => true)"
        ),
        timeout=40,
        description="completed Quantum snapshot interaction load",
    )
    try:
        wait_for_generation_event(cdp, "applied", 8, timeout=80)
    except TimeoutError as error:
        diagnostic = cdp.evaluate(
            "({ events: window.__wsbStage2RefreshTest?.events || [], "
            "errors: window.__wsbStage2RefreshTest?.errors || [], "
            "quantum: { snapshotLoad: quantumSnapshotDataLoadActive, "
            "indexLoad: quantumSnapshotIndexLoadActive, lookupLoad: quantumSnapshotLookupLoadActive, "
            "fullLoad: quantumFullDataLoadActive, selected: selectedQuantumSnapshotHeight(), "
            "latest: latestSnapshotHeight(), needsFull: quantumSelectedSnapshotNeedsFullRows(selectedQuantumSnapshotHeight()), "
            "deferredReason: quantumLastRefreshDeferredReason, "
            "validationReason: quantumLastRefreshValidationReason, "
            "selectedCacheComplete: quantumSnapshotDatasetIsComplete(state.snapshotDataCache.get(selectedQuantumSnapshotHeight()), selectedQuantumSnapshotHeight()), "
            "selectedCacheParts: (() => { const c = state.snapshotDataCache.get(selectedQuantumSnapshotHeight()); return { "
            "meta: quantumSnapshotMetaIsComplete(c?.metaRows, selectedQuantumSnapshotHeight()), "
            "aggregates: quantumAggregateRowsAreComplete(c?.aggregatesRows), "
            "top100: quantumExposureRowsAreComplete(c?.top100Rows, c?.aggregatesRows), "
            "ge1Same: c?.ge1Rows === c?.top100Rows, ge1Length: c?.ge1Rows?.length, "
            "top100Length: c?.top100Rows?.length, includesFull: c?.includesFullRows }; })(), "
            "historicalLength: state.historicalSeries.length, historicalLoading: state.historicalSeriesLoading, "
            "panelMode: state.scriptPanelMode, archivedEnabled: state.archivedSnapshotsEnabled, "
            "archivedAvailable: state.archivedSnapshotsAvailable }, "
            "status: window.WSBWebappDataAutoRefresh?.getStatus?.() || null })"
        )
        raise AssertionError(
            f"Quantum generation 8 did not apply after the interaction load: {diagnostic!r}"
        ) from error
    selected = cdp.evaluate(
        "document.querySelector('#snapshotFilter')?.value || ''"
    )
    if selected != target:
        raise AssertionError(
            f"Quantum refresh displaced the explicit snapshot selection: {selected!r} != {target!r}"
        )

    cdp.evaluate(
        r"""
          (() => {
            const toggle = document.querySelector('#scriptPanelModeToggle');
            if (toggle?.dataset.mode !== 'historical') toggle?.click();
            return true;
          })()
        """
    )
    wait_for(
        lambda: cdp.evaluate(
            "document.querySelector('#scriptPanelModeToggle')?.dataset.mode === 'historical' "
            "&& document.querySelector('#scriptBars')?.classList.contains('historical-chart') "
            "&& !document.querySelector('#scriptBars')?.textContent.includes('Loading')"
        ),
        timeout=60,
        description="loaded Quantum historical series before atomic refresh",
    )


def test_quantum_archive_retry_and_integrity(cdp: CdpSocket):
    integrity = cdp.evaluate(
        r"""
          (() => {
            const selected = selectedQuantumSnapshotHeight();
            const cache = state.snapshotDataCache.get(selected);
            const fullRequests = window.__wsbStage2RefreshTest.dataRequests.filter(
              (request) => request.pathname.endsWith('/dashboard_pubkeys_ge_1btc.csv')
            );
            return {
              aggregateTruncationRejected: !quantumAggregateRowsAreComplete(
                (cache?.aggregatesRows || []).slice(0, 1)
              ),
              top100TruncationRejected: !quantumExposureRowsAreComplete(
                (cache?.top100Rows || []).slice(0, 1),
                cache?.aggregatesRows || []
              ),
              currentTop100Accepted: quantumExposureRowsAreComplete(
                cache?.top100Rows || [],
                cache?.aggregatesRows || []
              ),
              historicalTruncationRejected: !quantumHistoricalSeriesIsComplete(
                state.historicalSeries.slice(-1),
                state.availableSnapshots,
                latestSnapshotHeight(),
                state.snapshotDataCache.get(latestSnapshotHeight())?.aggregatesRows || []
              ),
              unexpectedFullRequests: fullRequests.map((request) => request.pathname),
            };
          })()
        """
    )
    expected_true = (
        "aggregateTruncationRejected",
        "top100TruncationRejected",
        "currentTop100Accepted",
        "historicalTruncationRejected",
    )
    if any(not integrity.get(key) for key in expected_true):
        raise AssertionError(f"Quantum completeness guards failed: {integrity!r}")
    if integrity["unexpectedFullRequests"]:
        raise AssertionError(
            "Quantum fetched full exposure rows without explicit demand: "
            f"{integrity['unexpectedFullRequests']!r}"
        )

    for generation, failure_path, label in (
        (9, "/archived_index.csv", "archive index"),
        (10, "/archived/", "archive snapshot probe"),
    ):
        error_count = cdp.evaluate(
            "window.__wsbStage2RefreshTest.events.filter((event) => event.status === 'error').length"
        )
        cdp.evaluate(
            f"window.__wsbStage2RefreshTest.setGeneration({generation}, 'pass'); "
            f"window.__wsbStage2RefreshTest.failFreshRequests({json.dumps(failure_path)}, 1); "
            "window.WSBWebappDataAutoRefresh.requestCheck('quantum-archive-transient'); true"
        )
        wait_for(
            lambda: cdp.evaluate(
                "window.__wsbStage2RefreshTest.events.filter((event) => event.status === 'error').length"
            ) > error_count,
            timeout=30,
            description=f"Quantum transient {label} failure",
        )
        if cdp.evaluate(
            "window.__wsbStage2RefreshTest.events.some((event) => "
            f"event.status === 'applied' && event.generation === {generation})"
        ):
            raise AssertionError(
                f"Quantum committed generation {generation} with an unverified {label}"
            )
        wait_for_generation_event(cdp, "applied", generation, timeout=40)


def test_dashboard(cdp: CdpSocket, server_port: int, slug: str, spec: dict):
    btc_tail_lag_query = "&stage2_btc_tail_lag=1" if slug in {"uoa", "dca_comparison"} else ""
    url = (
        f"http://127.0.0.1:{server_port}/{spec['path']}"
        f"?stage2_refresh_test=1&stage2_initial_generation=7{btc_tail_lag_query}"
    )
    cdp.command("Page.navigate", {"url": url})

    wait_for(
        lambda: cdp.evaluate(
            "Boolean(window.__wsbStage2RefreshTest "
            "&& window.WSBWebappDataAutoRefresh?.getStatus?.().acceptedSignature !== null "
            f"&& ({spec['ready']}))"
        ),
        timeout=80,
        description=f"complete initial {slug} dashboard",
    )
    time.sleep(0.4)

    # The controller may observe generation 7 before the async dashboard init
    # has installed its original files. Registration must identify the actually
    # installed signature and reconcile generation 7 instead of accepting it as
    # an already-rendered baseline.
    wait_for_generation_event(cdp, "applied", 7, timeout=80)

    if slug == "quantum_exposure":
        test_quantum_snapshot_load_serialization(cdp)
        test_quantum_archive_retry_and_integrity(cdp)

    set_representative_state(cdp, spec)
    expected_state = capture_state(cdp, spec)
    baseline = cdp.evaluate(
        f"""
          (() => {{
            const test = window.__wsbStage2RefreshTest;
            test.startMonitor({json.dumps(spec['anchors'])});
            return {{
              loadCount: test.loadCount,
              navigationCount: performance.getEntriesByType('navigation').length,
              href: window.location.href,
            }};
          }})()
        """
    )

    visibility_override = cdp.evaluate(
        r"""
          (() => {
            try {
              window.__wsbStage2Visibility = 'hidden';
              Object.defineProperty(document, 'visibilityState', {
                configurable: true,
                get: () => window.__wsbStage2Visibility,
              });
              document.dispatchEvent(new Event('visibilitychange'));
              return document.visibilityState === 'hidden';
            } catch (_) {
              return false;
            }
          })()
        """
    )
    if not visibility_override:
        raise AssertionError(f"Could not install hidden-document override for {slug}")

    cdp.evaluate(
        "window.__wsbStage2RefreshTest.setGeneration(1, 'pass'); "
        "window.dispatchEvent(new Event('online')); true"
    )
    wait_for_generation_event(cdp, "applied", 1, timeout=80)
    assert_state_preserved(cdp, spec, expected_state, "hidden generation commit")

    cdp.evaluate(
        "window.__wsbStage2Visibility = 'visible'; "
        "document.dispatchEvent(new Event('visibilitychange')); true"
    )
    wait_for(
        lambda: not cdp.evaluate(
            "window.WSBWebappDataAutoRefresh?.getStatus?.().checkInFlight"
        ),
        timeout=30,
        description=f"{slug} visible catch-up completion",
    )
    time.sleep(0.35)
    assert_state_preserved(cdp, spec, expected_state, "visible catch-up")

    # Hold the first adapter data request for generation 2. Advance the marker
    # before releasing it; the shared pre-commit probe must reject generation 2
    # and immediately prepare/commit generation 3 instead.
    cdp.evaluate(
        "window.__wsbStage2RefreshTest.setGeneration(2, 'hold-data'); "
        "window.WSBWebappDataAutoRefresh.requestCheck('stage2-superseded'); true"
    )
    wait_for(
        lambda: cdp.evaluate("window.__wsbStage2RefreshTest.pending.length > 0"),
        timeout=40,
        description=f"held {slug} generation-2 candidate",
    )
    released = cdp.evaluate(
        "window.__wsbStage2RefreshTest.generation = 3; "
        "window.__wsbStage2RefreshTest.mode = 'pass'; "
        "window.__wsbStage2RefreshTest.releaseAll()"
    )
    if released < 1:
        raise AssertionError(f"Expected held adapter requests for {slug}, released {released}")

    wait_for_generation_event(cdp, "deferred", 2, timeout=80)
    wait_for_generation_event(cdp, "applied", 3, timeout=80)
    time.sleep(0.35)
    assert_state_preserved(cdp, spec, expected_state, "superseded-generation recovery")

    result = cdp.evaluate(
        r"""
          (() => {
            const test = window.__wsbStage2RefreshTest;
            test.stopMonitor();
            return {
              loadCount: test.loadCount,
              storedLoadCount: Number(sessionStorage.getItem(
                `wsb-stage2-load-count:${window.location.pathname}`
              ) || '0'),
              navigationCount: performance.getEntriesByType('navigation').length,
              href: window.location.href,
              loaderShows: [...test.loaderShows],
              blankSamples: [...test.blankSamples],
              errors: [...test.errors],
              applied: test.events
                .filter((event) => event.status === 'applied')
                .map((event) => event.generation),
              deferred: test.events
                .filter((event) => event.status === 'deferred')
                .map((event) => event.generation),
              dataRequestCount: test.dataRequests.length,
            };
          })()
        """
    )

    if (
        result["loadCount"] != baseline["loadCount"]
        or result["storedLoadCount"] != baseline["loadCount"]
        or result["navigationCount"] != baseline["navigationCount"]
        or result["href"] != baseline["href"]
    ):
        raise AssertionError(f"{slug} navigated/reloaded during refresh: {result!r}")
    if result["loaderShows"]:
        raise AssertionError(f"{slug} showed routine refresh loaders: {result['loaderShows']!r}")
    if result["blankSamples"]:
        raise AssertionError(f"{slug} blanked visible panels: {result['blankSamples']!r}")
    if result["errors"]:
        raise AssertionError(f"{slug} raised browser errors: {result['errors']!r}")
    if 1 not in result["applied"] or 3 not in result["applied"]:
        raise AssertionError(f"{slug} did not apply both complete generations: {result!r}")
    if 2 in result["applied"] or 2 not in result["deferred"]:
        raise AssertionError(f"{slug} committed a superseded generation: {result!r}")
    if result["dataRequestCount"] < 2:
        raise AssertionError(f"{slug} adapter did not fetch candidate data: {result!r}")


def main():
    chrome_path = Path(CHROME)
    if not chrome_path.is_file():
        raise SystemExit(f"Chrome not found at {CHROME}; set CHROME_BIN")

    requested = sys.argv[1:]
    unknown = set(requested).difference(DASHBOARDS)
    if unknown:
        raise SystemExit(f"Unknown dashboard target(s): {', '.join(sorted(unknown))}")
    targets = requested or list(DASHBOARDS)

    server_port = free_port()
    debug_port = free_port()
    handler = lambda *args, **kwargs: QuietHandler(*args, directory=str(ROOT), **kwargs)
    server = ThreadingHTTPServer(("127.0.0.1", server_port), handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()

    with tempfile.TemporaryDirectory(prefix="wsb-stage2-refresh-cdp-") as profile:
        chrome = subprocess.Popen(
            [
                CHROME,
                "--headless=new",
                "--disable-gpu",
                "--remote-allow-origins=*",
                f"--remote-debugging-port={debug_port}",
                f"--user-data-dir={profile}",
                "about:blank",
            ],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
        try:
            version_url = f"http://127.0.0.1:{debug_port}/json/version"
            wait_for(
                lambda: urllib.request.urlopen(version_url, timeout=0.5).read(),
                description="Chrome DevTools endpoint",
            )
            request = urllib.request.Request(
                f"http://127.0.0.1:{debug_port}/json/new?about:blank",
                method="PUT",
            )
            target = json.load(urllib.request.urlopen(request, timeout=2))
            cdp = CdpSocket(target["webSocketDebuggerUrl"])
            cdp.command("Page.enable")
            cdp.command("Runtime.enable")
            cdp.command("Page.addScriptToEvaluateOnNewDocument", {"source": FETCH_HARNESS})

            for slug in targets:
                print(f"Testing Stage 2 atomic refresh: {slug}...", flush=True)
                test_dashboard(cdp, server_port, slug, DASHBOARDS[slug])
                print(f"Passed: {slug}", flush=True)
        finally:
            chrome.terminate()
            try:
                chrome.wait(timeout=5)
            except subprocess.TimeoutExpired:
                chrome.kill()
            server.shutdown()


if __name__ == "__main__":
    main()
