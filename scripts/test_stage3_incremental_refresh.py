#!/usr/bin/env python3
"""Browser regressions for normalized incremental dashboard refreshes.

The repository's published files are served read-only.  A fetch shim installed
before application code runs synthesizes coherent marker generations in memory,
including valid JSON markers and matching adapter-private marker reads.  This
lets the test exercise publication races without rewriting production data.

Coverage:

* BIP-110 Signaling, Node Count, Bitcoin Dominance, Issuance Rate, and Patoshi;
* startup installed-signature reconciliation through the shared controller;
* hidden state commits followed by one visible presentation update;
* no navigation, routine loader visibility, or visible-panel blanking;
* representative control/range/selection preservation;
* rejection of a candidate superseded at the pre-commit publication gate.

Run every target, or pass one or more dashboard slugs::

    python3 scripts/test_stage3_incremental_refresh.py
    python3 scripts/test_stage3_incremental_refresh.py node_count patoshi_pattern
"""

from __future__ import annotations

import json
import mimetypes
import os
import subprocess
import sys
import tempfile
import threading
import time
import urllib.request
import urllib.parse
from http.server import ThreadingHTTPServer
from pathlib import Path

from test_stage1_refresh_atomicity import CdpSocket, QuietHandler, free_port, wait_for


ROOT = Path(__file__).resolve().parents[1]
CHROME = os.environ.get(
    "CHROME_BIN",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
)


DASHBOARDS = {
    "bip110_signaling": {
        "path": "webapps/bip110_signaling/dashboard.html",
        "ready": """
          document.querySelector('#dashboardLoader')?.classList.contains('hidden')
          && document.querySelector('#mainChainSplit')?.childElementCount > 0
          && document.querySelector('#statusChips .chip-value')?.textContent?.trim()
        """,
        "loaders": ["#dashboardLoader", "#segwitLoader", "#bip110Loader", "#bip110NodeLoader"],
        "anchors": [
            {"selector": "#mainChainSplit", "kind": "children"},
            {"selector": "#statusChips", "kind": "children"},
        ],
        "updated": "#updatedChipWrap .chip-value",
        "set_state": """
          const symbol = document.querySelector('#blockSymbolSelect');
          symbol.value = 'x';
          symbol.dispatchEvent(new Event('change', { bubbles: true }));
          const labels = document.querySelector('#toggleLabels');
          labels.checked = false;
          labels.dispatchEvent(new Event('change', { bubbles: true }));
        """,
        "capture": """
          ({
            symbol: document.querySelector('#blockSymbolSelect')?.value || '',
            labels: !!document.querySelector('#toggleLabels')?.checked,
            segwit: !!document.querySelector('#toggleSegwitWindow')?.checked,
            bip110: !!document.querySelector('#toggleBip110Window')?.checked,
            nodeView: document.querySelector('#bip110NodePanelBtn')?.getAttribute('aria-pressed') || '',
          })
        """,
    },
    "node_count": {
        "path": "webapps/node_count/dashboard.html",
        "ready": """
          document.querySelector('#historyLoader')?.classList.contains('hidden')
          && document.querySelector('#softwareLoader')?.classList.contains('hidden')
          && document.querySelector('#historyChart .plot-container')
          && document.querySelector('#softwareChart .plot-container')
        """,
        "loaders": ["#historyLoader", "#softwareLoader"],
        "anchors": [
            {"selector": "#historyChart", "kind": "plotly"},
            {"selector": "#softwareChart", "kind": "plotly"},
            {"selector": "#versionTableBody", "kind": "children"},
        ],
        "updated": "#updatedChip .chip-value",
        "set_state": """
          for (const [selector, value] of [['#rangeSelect', '90'], ['#smoothSelect', '7']]) {
            const select = document.querySelector(selector);
            select.value = value;
            select.dispatchEvent(new Event('change', { bubbles: true }));
          }
          const topN = document.querySelector('#topNInput');
          topN.value = '9';
          topN.dispatchEvent(new Event('input', { bubbles: true }));
          topN.dispatchEvent(new Event('change', { bubbles: true }));
        """,
        "capture": """
          ({
            range: document.querySelector('#rangeSelect')?.value || '',
            smooth: document.querySelector('#smoothSelect')?.value || '',
            topN: document.querySelector('#topNInput')?.value || '',
            history: !!document.querySelector('#toggleHistoryPanel')?.checked,
            software: !!document.querySelector('#toggleSoftwarePanel')?.checked,
          })
        """,
    },
    "bitcoin_dominance": {
        "path": "webapps/bitcoin_dominance/dashboard.html",
        "ready": """
          document.querySelector('#historyLoader')?.classList.contains('hidden')
          && document.querySelector('#snapshotLoader')?.classList.contains('hidden')
          && document.querySelector('#dominanceChart .plot-container')
          && document.querySelector('#snapshotChart .plot-container')
        """,
        "loaders": ["#historyLoader", "#snapshotLoader"],
        "anchors": [
            {"selector": "#dominanceChart", "kind": "plotly"},
            {"selector": "#snapshotChart", "kind": "plotly"},
        ],
        "updated": "#updatedTimeZoneDisplay .chip-value",
        "set_state": """
          for (const [selector, value] of [['#rangeSelect', '365'], ['#smoothSelect', '7']]) {
            const select = document.querySelector(selector);
            select.value = value;
            select.dispatchEvent(new Event('change', { bubbles: true }));
          }
          const price = document.querySelector('#toggleShowPrice');
          price.checked = true;
          price.dispatchEvent(new Event('change', { bubbles: true }));
        """,
        "capture": """
          ({
            range: document.querySelector('#rangeSelect')?.value || '',
            smooth: document.querySelector('#smoothSelect')?.value || '',
            price: !!document.querySelector('#toggleShowPrice')?.checked,
            stables: !!document.querySelector('#toggleIncludeStables')?.checked,
            stacked: !!document.querySelector('#toggleStackedDominance')?.checked,
          })
        """,
    },
    "issuance_rate": {
        "path": "webapps/issuance_rate/dashboard.html",
        "ready": """
          !document.body.classList.contains('issuance-loading')
          && document.querySelector('#issuanceChart')?.width > 0
          && document.querySelector('#issuanceChart')?.height > 0
          && document.querySelector('#dateRangeEndSlider')?.max !== '0'
        """,
        "loaders": [".panel > .dashboard-ring-loader", "#chartLoading"],
        "anchors": [{"selector": "#issuanceChart", "kind": "canvas"}],
        "updated": "#chipUpdated .chip-value",
        "set_state": """
          const start = document.querySelector('#dateRangeStartSlider');
          const end = document.querySelector('#dateRangeEndSlider');
          const min = Number(start.min || 0);
          const max = Number(end.max || start.max || 0);
          start.value = String(Math.round(min + (max - min) * 0.23));
          start.dispatchEvent(new Event('input', { bubbles: true }));
          start.dispatchEvent(new Event('change', { bubbles: true }));
          end.value = String(Math.round(min + (max - min) * 0.77));
          end.dispatchEvent(new Event('input', { bubbles: true }));
          end.dispatchEvent(new Event('change', { bubbles: true }));
          const target = document.querySelector('#showTargetIssuanceRateToggle');
          target.checked = false;
          target.dispatchEvent(new Event('change', { bubbles: true }));
        """,
        "capture": """
          ({
            start: document.querySelector('#dateRangeStartSlider')?.value || '',
            end: document.querySelector('#dateRangeEndSlider')?.value || '',
            target: !!document.querySelector('#showTargetIssuanceRateToggle')?.checked,
            perfect: !!document.querySelector('#showPerfectIssuanceToggle')?.checked,
          })
        """,
    },
    "patoshi_pattern": {
        "path": "webapps/patoshi_pattern/dashboard.html",
        "ready": """
          getComputedStyle(document.querySelector('#loadingRing')).display === 'none'
          && document.querySelector('#patoshiChart')?.width > 0
          && document.querySelector('#patoshiChart')?.height > 0
          && Number(document.querySelector('#endRange')?.max || 0) > 1
        """,
        "loaders": ["#loadingRing"],
        "anchors": [{"selector": "#patoshiChart", "kind": "canvas"}],
        "updated": "#updatedKpiValue",
        "set_state": """
          const start = document.querySelector('#startRange');
          const end = document.querySelector('#endRange');
          const min = Number(start.min || 0);
          const max = Number(end.max || start.max || 0);
          start.value = String(Math.round(min + (max - min) * 0.19));
          start.dispatchEvent(new Event('input', { bubbles: true }));
          start.dispatchEvent(new Event('change', { bubbles: true }));
          end.value = String(Math.round(min + (max - min) * 0.73));
          end.dispatchEvent(new Event('input', { bubbles: true }));
          end.dispatchEvent(new Event('change', { bubbles: true }));
          const metric = document.querySelector('#countMetric');
          metric.value = 'spent';
          metric.dispatchEvent(new Event('change', { bubbles: true }));
          const spent = document.querySelector('#showSpent');
          spent.checked = true;
          spent.dispatchEvent(new Event('change', { bubbles: true }));
        """,
        "capture": """
          ({
            start: document.querySelector('#startRange')?.value || '',
            end: document.querySelector('#endRange')?.value || '',
            metric: document.querySelector('#countMetric')?.value || '',
            spent: !!document.querySelector('#showSpent')?.checked,
            pattern: document.querySelector('[data-patoshi-pattern][aria-pressed="true"]')?.dataset.patoshiPattern || '',
          })
        """,
    },
}


def build_data_snapshot():
    """Freeze tested publications so a live dev sync cannot split a CDP run."""

    snapshot = {}
    for slug in DASHBOARDS:
        data_dir = ROOT / "webapps" / slug / "webapp_data"
        if not data_dir.is_dir():
            continue
        for path in data_dir.rglob("*"):
            if path.is_file():
                snapshot["/" + path.relative_to(ROOT).as_posix()] = path.read_bytes()
    for relative in (
        "assets/last_updated.txt",
        "assets/daily_price.csv",
        "assets/top_kpis.json",
    ):
        path = ROOT / relative
        if path.is_file():
            snapshot["/" + relative] = path.read_bytes()
    return snapshot


class SnapshotHandler(QuietHandler):
    snapshot = {}

    def do_GET(self):
        pathname = urllib.parse.unquote(urllib.parse.urlparse(self.path).path)
        body = self.snapshot.get(pathname)
        if body is None:
            return super().do_GET()
        self.send_response(200)
        self.send_header("Content-Type", mimetypes.guess_type(pathname)[0] or "application/octet-stream")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)


FETCH_HARNESS = r"""
  (() => {
    const nativeFetch = window.fetch.bind(window);
    const pathname = window.location.pathname;
    const markerPaths = {
      '/webapps/bip110_signaling/dashboard.html': [
        '/webapps/bip110_signaling/webapp_data/bip110_metadata.json',
      ],
      '/webapps/node_count/dashboard.html': [
        '/webapps/node_count/webapp_data/published_generation.json',
      ],
      '/webapps/bitcoin_dominance/dashboard.html': [
        '/webapps/bitcoin_dominance/webapp_data/published_generation.json',
        '/assets/last_updated.txt',
      ],
      '/webapps/issuance_rate/dashboard.html': [
        '/webapps/issuance_rate/webapp_data/published_generation.json',
      ],
      '/webapps/patoshi_pattern/dashboard.html': [
        '/webapps/patoshi_pattern/webapp_data/patoshi_metadata.json',
      ],
    }[pathname] || [];
    const markerSet = new Set(markerPaths);
    const loadKey = `wsb-stage3-load-count:${pathname}`;
    const loadCount = Number(sessionStorage.getItem(loadKey) || '0') + 1;
    sessionStorage.setItem(loadKey, String(loadCount));
    const issuanceCache = new Map();

    const test = {
      generation: Number(new URLSearchParams(location.search).get('stage3_initial_generation') || '0'),
      coldStart: new URLSearchParams(location.search).get('stage3_cold_start') === '1',
      coldFailuresRemaining: 1,
      coldFailures: [],
      coldErrors: [],
      mode: 'pass',
      pending: [],
      events: [],
      errors: [],
      markerRequests: [],
      dataRequests: [],
      loaderShows: [],
      blankSamples: [],
      updateChanges: [],
      updateBaseline: '',
      updateLast: '',
      monitorTimer: 0,
      monitorObserver: null,
      loaderSelectors: [],
      anchors: [],
      updatedSelector: '',
      loadCount,
      setGeneration(generation, mode = 'pass') {
        if (this.pending.length) throw new Error('A synthetic publication request is still held.');
        this.generation = Number(generation);
        this.mode = mode;
      },
      releaseAll() {
        const releases = this.pending.splice(0);
        releases.forEach((release) => release());
        return releases.length;
      },
    };
    window.__wsbStage3RefreshTest = test;
    if (test.coldStart) {
      const coldErrorObserver = new MutationObserver(() => {
        const message = document.querySelector('main > .error')?.textContent?.trim() || '';
        if (message && !test.coldErrors.includes(message)) test.coldErrors.push(message);
      });
      coldErrorObserver.observe(document, { subtree: true, childList: true, characterData: true });
    }

    const stamp = (generation) => {
      const minute = String(Math.max(0, Math.min(59, Number(generation) || 0))).padStart(2, '0');
      return `2099-01-01T00:${minute}:00.000Z`;
    };
    const generationFromSignature = (value) => {
      const source = String(value || '');
      const tagged = source.match(/"stage3_generation"\s*:\s*(\d+)/);
      if (tagged) return Number(tagged[1]);
      const dated = source.match(/2099-01-01T00:(\d{2}):00(?:\.000)?Z/);
      return dated ? Number(dated[1]) : 0;
    };
    window.addEventListener('wsb:data-refresh-status', (event) => {
      const detail = event.detail || {};
      test.events.push({
        status: String(detail.status || ''),
        generation: generationFromSignature(detail.signature),
        requestId: Number(detail.requestId || 0),
      });
    });
    window.addEventListener('error', (event) => {
      test.errors.push(String(event.error?.stack || event.message || event.error || 'window error'));
    });
    window.addEventListener('unhandledrejection', (event) => {
      test.errors.push(String(event.reason?.stack || event.reason || 'unhandled rejection'));
    });

    const phaseFor = (refreshValue) => {
      const match = String(refreshValue || '').match(/-(probe|pre-commit|pre-update|verify)-/);
      return match ? match[1] : '';
    };
    const sha256 = async (text) => {
      const bytes = new TextEncoder().encode(text);
      const digest = await crypto.subtle.digest('SHA-256', bytes);
      return [...new Uint8Array(digest)]
        .map((value) => value.toString(16).padStart(2, '0')).join('');
    };
    const responseFromText = (text, response = null, contentType = '') => {
      const headers = new Headers(response?.headers || {});
      headers.delete('content-length');
      headers.delete('content-encoding');
      headers.set('cache-control', 'no-store');
      if (contentType) headers.set('content-type', contentType);
      return new Response(text, {
        status: response?.status || 200,
        statusText: response?.statusText || 'OK',
        headers,
      });
    };
    const getIssuanceGeneration = async (generation) => {
      const key = Number(generation);
      if (!issuanceCache.has(key)) {
        issuanceCache.set(key, (async () => {
          const url = new URL('/webapps/issuance_rate/webapp_data/issuance_rate_data.json', location.origin);
          const response = await nativeFetch(url.href, { cache: 'no-store' });
          if (!response.ok) throw new Error(`Failed to stage issuance fixture (${response.status})`);
          const payload = await response.json();
          payload.generated_utc = stamp(key);
          const text = JSON.stringify(payload);
          return { text, hash: await sha256(text), payload };
        })());
      }
      return issuanceCache.get(key);
    };
    const mutateMarker = async (input, init, markerPath, generation, phase) => {
      const response = await nativeFetch(input, init);
      if (!response.ok) return response;
      const raw = await response.clone().text();
      let text = stamp(generation);
      if (markerPath.endsWith('/bip110_metadata.json')) {
        const marker = JSON.parse(raw);
        marker.generated_utc = stamp(generation);
        marker.stage3_generation = Number(generation);
        text = JSON.stringify(marker);
      } else if (markerPath === '/webapps/issuance_rate/webapp_data/published_generation.json') {
        const marker = JSON.parse(raw);
        const staged = await getIssuanceGeneration(generation);
        marker.generated_utc = stamp(generation);
        marker.latest_block_height = Number(staged.payload?.source?.latest_block_height);
        marker.first_date = String(staged.payload?.rows?.[0]?.date || '');
        marker.latest_date = String(staged.payload?.rows?.at?.(-1)?.date || '');
        marker.row_count = Number(staged.payload?.rows?.length || 0);
        marker.time_zone_count = Object.keys(staged.payload?.time_zone_daily || {}).length;
        marker.data_sha256 = staged.hash;
        marker.stage3_generation = Number(generation);
        text = JSON.stringify(marker);
      } else if (
        markerPath === '/webapps/node_count/webapp_data/published_generation.json'
        || markerPath === '/webapps/bitcoin_dominance/webapp_data/published_generation.json'
      ) {
        const marker = JSON.parse(raw);
        marker.generation_id = `stage3-generation-${generation}`;
        marker.published_at_utc = stamp(generation);
        marker.stage3_generation = Number(generation);
        text = JSON.stringify(marker);
      } else if (markerPath.endsWith('/patoshi_metadata.json')) {
        const marker = JSON.parse(raw);
        marker.generated_at = stamp(generation);
        marker.stage3_generation = Number(generation);
        text = JSON.stringify(marker);
      }
      test.markerRequests.push({ markerPath, generation: Number(generation), phase });
      return responseFromText(
        text,
        response,
        markerPath.endsWith('.json') ? 'application/json' : 'text/plain; charset=utf-8'
      );
    };

    window.fetch = async (input, init) => {
      const raw = typeof input === 'string' ? input : input?.url;
      const url = new URL(raw, location.href);
      const refreshValue = url.searchParams.get('wsb_refresh') || '';
      const phase = phaseFor(refreshValue);
      const generation = Number(test.generation);

      if (
        test.coldStart
        && test.coldFailuresRemaining > 0
        && pathname === '/webapps/bip110_signaling/dashboard.html'
        && url.pathname.endsWith('/bip110_periods.csv')
        && !refreshValue
        && !url.searchParams.has('_')
        && !url.searchParams.has('v')
      ) {
        test.coldFailuresRemaining -= 1;
        test.coldFailures.push(url.pathname);
        throw new TypeError(`Synthetic cold-start failure for ${url.pathname}`);
      }

      const isSharedMarkerRead = generation > 0 && markerSet.has(url.pathname) && !!phase;
      const isInitialMarkerRead = markerSet.has(url.pathname) && !refreshValue;
      const isBipPrivateMarkerRead = generation > 0
        && pathname === '/webapps/bip110_signaling/dashboard.html'
        && url.pathname.endsWith('/bip110_metadata.json')
        && (url.searchParams.has('_') || url.searchParams.has('v'));

      if (isSharedMarkerRead && phase === 'pre-commit' && test.mode === 'hold-precommit') {
        return new Promise((resolve, reject) => {
          test.pending.push(() => mutateMarker(
            input, init, url.pathname, Number(test.generation), phase
          ).then(resolve, reject));
        });
      }
      if (isSharedMarkerRead || isBipPrivateMarkerRead) {
        return mutateMarker(
          input,
          init,
          url.pathname,
          generation,
          phase || 'candidate',
        );
      }
      if (isInitialMarkerRead) {
        return mutateMarker(input, init, url.pathname, 0, 'initial');
      }

      if (
        pathname === '/webapps/issuance_rate/dashboard.html'
        && url.pathname.endsWith('/issuance_rate_data.json')
        && (refreshValue.includes('-data-') || !refreshValue)
      ) {
        const dataGeneration = refreshValue.includes('-data-') ? generation : 0;
        const staged = await getIssuanceGeneration(dataGeneration);
        test.dataRequests.push({ pathname: url.pathname, generation: dataGeneration });
        return responseFromText(staged.text, null, 'application/json');
      }

      if (refreshValue.includes('-data-') || (
        pathname === '/webapps/bip110_signaling/dashboard.html'
        && (url.searchParams.has('_') || url.searchParams.has('v'))
        && String(url.searchParams.get('_') || url.searchParams.get('v') || '').includes('snapshot')
      )) {
        test.dataRequests.push({ pathname: url.pathname, generation });
      }
      return nativeFetch(input, init);
    };

    const isVisible = (element) => {
      if (!element || !element.isConnected || element.hidden) return false;
      const style = getComputedStyle(element);
      return style.display !== 'none'
        && style.visibility !== 'hidden'
        && Number(style.opacity || '1') > 0
        && element.getAttribute('aria-hidden') !== 'true';
    };
    const anchorIsBlank = (anchor) => {
      const element = document.querySelector(anchor.selector);
      if (!element || !element.isConnected) return true;
      if (anchor.kind === 'canvas') return element.width <= 0 || element.height <= 0;
      if (anchor.kind === 'plotly') return !element.querySelector('.plot-container');
      return element.childElementCount === 0;
    };
    test.startMonitor = (loaderSelectors, anchors, updatedSelector) => {
      test.loaderSelectors = [...loaderSelectors];
      test.anchors = [...anchors];
      test.updatedSelector = String(updatedSelector || '');
      test.loaderShows = [];
      test.blankSamples = [];
      test.updateChanges = [];
      test.updateBaseline = document.querySelector(test.updatedSelector)?.textContent?.trim() || '';
      test.updateLast = test.updateBaseline;
      const sample = () => {
        test.loaderSelectors.forEach((selector) => {
          document.querySelectorAll(selector).forEach((loader) => {
            if (isVisible(loader) && !test.loaderShows.includes(selector)) {
              test.loaderShows.push(selector);
            }
          });
        });
        test.anchors.forEach((anchor) => {
          if (anchorIsBlank(anchor) && !test.blankSamples.includes(anchor.selector)) {
            test.blankSamples.push(anchor.selector);
          }
        });
        const next = document.querySelector(test.updatedSelector)?.textContent?.trim() || '';
        if (next && next !== test.updateLast) {
          test.updateLast = next;
          test.updateChanges.push(next);
        }
      };
      sample();
      test.monitorTimer = setInterval(sample, 15);
      test.monitorObserver = new MutationObserver(sample);
      test.monitorObserver.observe(document.body, {
        subtree: true,
        childList: true,
        characterData: true,
        attributes: true,
        attributeFilter: ['class', 'style', 'hidden', 'aria-hidden'],
      });
    };
    test.resetPresentationChanges = () => {
      test.updateChanges = [];
      test.updateBaseline = document.querySelector(test.updatedSelector)?.textContent?.trim() || '';
      test.updateLast = test.updateBaseline;
      return test.updateBaseline;
    };
    test.stopMonitor = () => {
      if (test.monitorTimer) clearInterval(test.monitorTimer);
      test.monitorTimer = 0;
      test.monitorObserver?.disconnect();
      test.monitorObserver = null;
    };
  })();
"""


def capture_state(cdp: CdpSocket, spec: dict):
    return cdp.evaluate(f"(() => {spec['capture']})()")


def set_representative_state(cdp: CdpSocket, spec: dict):
    cdp.evaluate(
        f"""
          (async () => {{
            {spec['set_state']}
            document.activeElement?.blur?.();
            await new Promise((resolve) => setTimeout(resolve, 350));
            return true;
          }})()
        """
    )


def wait_for_generation_event(cdp: CdpSocket, status: str, generation: int, *, timeout=90):
    return wait_for(
        lambda: cdp.evaluate(
            "window.__wsbStage3RefreshTest?.events.some((event) => "
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


def test_dashboard(cdp: CdpSocket, server_port: int, slug: str, spec: dict):
    url = (
        f"http://127.0.0.1:{server_port}/{spec['path']}"
        "?stage3_refresh_test=1&stage3_initial_generation=7"
    )
    cdp.command("Page.navigate", {"url": url})

    try:
        wait_for(
            lambda: cdp.evaluate(
                "Boolean(window.__wsbStage3RefreshTest "
                "&& window.WSBWebappDataAutoRefresh?.getStatus?.().acceptedSignature !== null "
                f"&& ({spec['ready']}))"
            ),
            timeout=120,
            description=f"complete initial {slug} dashboard",
        )
    except TimeoutError as error:
        diagnostic = cdp.evaluate(
            "({ events: window.__wsbStage3RefreshTest?.events || [], "
            "errors: window.__wsbStage3RefreshTest?.errors || [], "
            "markerRequests: window.__wsbStage3RefreshTest?.markerRequests || [], "
            "status: window.WSBWebappDataAutoRefresh?.getStatus?.() || null, "
            "bodyClass: document.body.className, "
            "visibleLoaders: [...document.querySelectorAll('.panel-loader, .dashboard-loader, .dashboard-ring-loader')]"
            ".filter((el) => getComputedStyle(el).display !== 'none').map((el) => el.id || el.className), "
            "errorText: document.querySelector('.error, #errorBox')?.textContent?.trim() || '' })"
        )
        raise AssertionError(f"{slug} startup did not settle: {diagnostic!r}") from error
    # The shared controller may baseline generation 7 before the adapter has
    # installed the page's original generation.  Registration must reconcile
    # that exact installed signature and explicitly apply generation 7.
    wait_for_generation_event(cdp, "applied", 7, timeout=120)
    time.sleep(0.45)

    set_representative_state(cdp, spec)
    expected_state = capture_state(cdp, spec)
    baseline = cdp.evaluate(
        f"""
          (() => {{
            const test = window.__wsbStage3RefreshTest;
            test.startMonitor(
              {json.dumps(spec['loaders'])},
              {json.dumps(spec['anchors'])},
              {json.dumps(spec['updated'])}
            );
            return {{
              loadCount: test.loadCount,
              navigationCount: performance.getEntriesByType('navigation').length,
              href: location.href,
              updated: test.updateBaseline,
            }};
          }})()
        """
    )
    if not baseline["updated"]:
        raise AssertionError(f"{slug} did not expose a populated Updated KPI")

    visibility_override = cdp.evaluate(
        """
          (() => {
            try {
              window.__wsbStage3Visibility = 'hidden';
              Object.defineProperty(document, 'visibilityState', {
                configurable: true,
                get: () => window.__wsbStage3Visibility,
              });
              document.dispatchEvent(new Event('visibilitychange'));
              return document.visibilityState === 'hidden';
            } catch (_) { return false; }
          })()
        """
    )
    if not visibility_override:
        raise AssertionError(f"Could not install hidden-document override for {slug}")

    cdp.evaluate(
        "window.__wsbStage3RefreshTest.setGeneration(1, 'pass'); "
        "window.WSBWebappDataAutoRefresh.requestCheck('stage3-hidden'); true"
    )
    wait_for_generation_event(cdp, "applied", 1, timeout=120)
    time.sleep(0.25)
    assert_state_preserved(cdp, spec, expected_state, "hidden generation commit")
    hidden_presentation = cdp.evaluate(
        "({ updated: document.querySelector(window.__wsbStage3RefreshTest.updatedSelector)"
        "?.textContent?.trim() || '', changes: [...window.__wsbStage3RefreshTest.updateChanges] })"
    )
    if hidden_presentation["updated"] != baseline["updated"] or hidden_presentation["changes"]:
        raise AssertionError(
            f"{slug} presented hidden generation 1 instead of staging it: {hidden_presentation!r}"
        )

    cdp.evaluate(
        "window.__wsbStage3Visibility = 'visible'; "
        "document.dispatchEvent(new Event('visibilitychange')); true"
    )
    wait_for(
        lambda: cdp.evaluate(
            "document.querySelector(window.__wsbStage3RefreshTest.updatedSelector)"
            "?.textContent?.trim() !== window.__wsbStage3RefreshTest.updateBaseline"
        ),
        timeout=45,
        description=f"{slug} visible presentation catch-up",
    )
    time.sleep(0.45)
    assert_state_preserved(cdp, spec, expected_state, "visible presentation catch-up")
    visible_changes = cdp.evaluate("[...window.__wsbStage3RefreshTest.updateChanges]")
    if len(visible_changes) != 1:
        raise AssertionError(
            f"{slug} did not present the hidden generation exactly once: {visible_changes!r}"
        )

    cdp.evaluate("window.__wsbStage3RefreshTest.resetPresentationChanges()")
    cdp.evaluate(
        "window.__wsbStage3RefreshTest.setGeneration(2, 'hold-precommit'); "
        "window.WSBWebappDataAutoRefresh.requestCheck('stage3-superseded'); true"
    )
    wait_for(
        lambda: cdp.evaluate("window.__wsbStage3RefreshTest.pending.length > 0"),
        timeout=120,
        description=f"held {slug} generation-2 pre-commit marker",
    )
    released = cdp.evaluate(
        "window.__wsbStage3RefreshTest.generation = 3; "
        "window.__wsbStage3RefreshTest.mode = 'pass'; "
        "window.__wsbStage3RefreshTest.releaseAll()"
    )
    if released < 1:
        raise AssertionError(f"Expected a held generation-2 pre-commit for {slug}")
    wait_for_generation_event(cdp, "deferred", 2, timeout=120)
    wait_for_generation_event(cdp, "applied", 3, timeout=120)
    time.sleep(0.5)
    assert_state_preserved(cdp, spec, expected_state, "superseded-generation recovery")

    result = cdp.evaluate(
        """
          (() => {
            const test = window.__wsbStage3RefreshTest;
            test.stopMonitor();
            return {
              loadCount: test.loadCount,
              storedLoadCount: Number(sessionStorage.getItem(
                `wsb-stage3-load-count:${location.pathname}`
              ) || '0'),
              navigationCount: performance.getEntriesByType('navigation').length,
              href: location.href,
              loaderShows: [...test.loaderShows],
              blankSamples: [...test.blankSamples],
              errors: [...test.errors],
              applied: test.events.filter((event) => event.status === 'applied')
                .map((event) => event.generation),
              deferred: test.events.filter((event) => event.status === 'deferred')
                .map((event) => event.generation),
              markerRequests: [...test.markerRequests],
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
        raise AssertionError(f"{slug} navigated/reloaded during incremental refresh: {result!r}")
    if result["loaderShows"]:
        raise AssertionError(f"{slug} showed routine refresh loaders: {result['loaderShows']!r}")
    if result["blankSamples"]:
        raise AssertionError(f"{slug} blanked visible panels: {result['blankSamples']!r}")
    if result["errors"]:
        raise AssertionError(f"{slug} raised browser errors: {result['errors']!r}")
    if not all(generation in result["applied"] for generation in (7, 1, 3)):
        raise AssertionError(f"{slug} did not apply all complete generations: {result!r}")
    if 2 in result["applied"] or 2 not in result["deferred"]:
        raise AssertionError(f"{slug} committed a superseded candidate: {result!r}")
    if slug == "bip110_signaling":
        candidate_generations = {
            request["generation"]
            for request in result["markerRequests"]
            if request["phase"] == "candidate"
        }
        if not {7, 1, 2, 3}.issubset(candidate_generations):
            raise AssertionError(
                "BIP-110 adapter-private metadata reads did not match every synthetic marker: "
                f"{sorted(candidate_generations)!r}"
            )


def test_bip_cold_start_recovery(cdp: CdpSocket, server_port: int):
    spec = DASHBOARDS["bip110_signaling"]
    url = (
        f"http://127.0.0.1:{server_port}/{spec['path']}"
        "?stage3_refresh_test=1&stage3_initial_generation=7&stage3_cold_start=1"
    )
    cdp.command("Page.navigate", {"url": url})
    wait_for(
        lambda: cdp.evaluate(
            "window.__wsbStage3RefreshTest?.coldFailures.length === 1"
        ),
        timeout=40,
        description="injected BIP-110 cold-start failure",
    )
    baseline = cdp.evaluate(
        "({ loadCount: window.__wsbStage3RefreshTest.loadCount, "
        "navigationCount: performance.getEntriesByType('navigation').length, href: location.href })"
    )

    wait_for_generation_event(cdp, "applied", 7, timeout=120)
    wait_for(
        lambda: cdp.evaluate(
            "Boolean("
            f"({spec['ready']})"
            " && !document.querySelector('main > .error')"
            " && !document.querySelector('#blockSymbolSelect')?.disabled"
            " && !document.querySelector('#toggleBip110Window')?.disabled"
            ")"
        ),
        timeout=120,
        description="BIP-110 in-place cold-start recovery",
    )
    time.sleep(0.5)
    result = cdp.evaluate(
        f"""
          (() => {{
            const isVisible = (element) => {{
              if (!element || element.hidden) return false;
              const style = getComputedStyle(element);
              return style.display !== 'none' && style.visibility !== 'hidden'
                && element.getAttribute('aria-hidden') !== 'true';
            }};
            return {{
              loadCount: window.__wsbStage3RefreshTest.loadCount,
              storedLoadCount: Number(sessionStorage.getItem(
                `wsb-stage3-load-count:${{location.pathname}}`
              ) || '0'),
              navigationCount: performance.getEntriesByType('navigation').length,
              href: location.href,
              error: document.querySelector('main > .error')?.textContent?.trim() || '',
              visibleLoaders: {json.dumps(spec['loaders'])}.filter(
                (selector) => [...document.querySelectorAll(selector)].some(isVisible)
              ),
              controlsEnabled: !document.querySelector('#blockSymbolSelect')?.disabled
                && !document.querySelector('#toggleBip110Window')?.disabled,
              errors: [...window.__wsbStage3RefreshTest.errors],
            }};
          }})()
        """
    )
    if (
        result["loadCount"] != baseline["loadCount"]
        or result["storedLoadCount"] != baseline["loadCount"]
        or result["navigationCount"] != baseline["navigationCount"]
        or result["href"] != baseline["href"]
    ):
        raise AssertionError(f"BIP-110 navigated during cold-start recovery: {result!r}")
    if result["error"] or result["visibleLoaders"] or not result["controlsEnabled"]:
        raise AssertionError(f"BIP-110 cold-start recovery left stale UI behind: {result!r}")
    if result["errors"]:
        raise AssertionError(f"BIP-110 cold-start recovery raised browser errors: {result!r}")


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
    SnapshotHandler.snapshot = build_data_snapshot()
    handler = lambda *args, **kwargs: SnapshotHandler(*args, directory=str(ROOT), **kwargs)
    server = ThreadingHTTPServer(("127.0.0.1", server_port), handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()

    with tempfile.TemporaryDirectory(prefix="wsb-stage3-refresh-cdp-") as profile:
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
                print(f"Testing Stage 3 incremental refresh: {slug}...", flush=True)
                test_dashboard(cdp, server_port, slug, DASHBOARDS[slug])
                if slug == "bip110_signaling":
                    test_bip_cold_start_recovery(cdp, server_port)
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
