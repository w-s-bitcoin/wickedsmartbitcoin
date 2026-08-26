#!/usr/bin/env python3
"""Atomic live-refresh regressions for every homepage dashboard preview.

The test serves a frozen, read-only snapshot of mutable preview artifacts and
installs a fetch shim before preview code runs.  The shim changes publication
signatures, delays responses, and injects failures entirely in browser memory;
production data files are never rewritten.

The nine periodically refreshed previews share one bounded lifecycle:

* initial render and unchanged-marker probe (with no payload fetch);
* hidden generation install and exactly one visible presentation;
* offline failure retaining the last-good visual, followed by online recovery;
* a held generation superseded before commit by a newer marker;
* truncated payload rejection followed by in-place recovery;
* cold-start failure, fallback readiness, and in-place recovery.

Patoshi is tested as a validated static data asset (slow, offline, and partial
cold starts with explicit recovery).  Bitcoin Net Worth and Casascius are
tested as static image previews.  A final homepage pass proves that wake events
do not navigate preview iframes or disturb ordering, favorites-only filtering,
focus, scroll, theme, or card-ready state.

Run all targets or select preview slugs::

    python3 scripts/test_homepage_preview_refresh.py
    python3 scripts/test_homepage_preview_refresh.py days_since_ath uoa
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
import urllib.parse
import urllib.request
from http.server import ThreadingHTTPServer
from pathlib import Path

from test_stage1_refresh_atomicity import CdpSocket, QuietHandler, free_port, wait_for


ROOT = Path(__file__).resolve().parents[1]
CHROME = os.environ.get(
    "CHROME_BIN",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
)


PERIODIC_PREVIEWS = {
    "bip110_signaling": {
        "filename": "bip110_signaling.png",
        "path": "webapps/bip110_signaling/preview.html",
        "roots": ["#previewChart"],
        "markers": ["/webapps/bip110_signaling/webapp_data/bip110_metadata.json"],
        "data": ["/webapps/bip110_signaling/webapp_data/bip110_periods.csv"],
    },
    "bitcoin_dominance": {
        "filename": "bitcoin_dominance.png",
        "path": "webapps/bitcoin_dominance/preview.html",
        "roots": ["#previewChart"],
        "markers": ["/webapps/bitcoin_dominance/webapp_data/published_generation.json"],
        "data": ["/webapps/bitcoin_dominance/webapp_data/top10_daily_incl_stables.csv"],
    },
    "dca_comparison": {
        "filename": "dca_comparison.png",
        "path": "webapps/dca_comparison/preview.html",
        "roots": ["#comparisonPreview"],
        "markers": ["/webapps/dca_comparison/webapp_data/published_generation.json"],
        "data": ["/webapps/dca_comparison/webapp_data/dca_comparison_preview.csv"],
    },
    "dca_cost_basis": {
        "filename": "dca_cost_basis.png",
        "path": "webapps/dca_cost_basis/preview.html",
        "roots": ["#costBasisChart"],
        "markers": ["/webapps/dca_cost_basis/webapp_data/dca_cost_basis_metadata.json"],
        "data": ["/webapps/dca_cost_basis/webapp_data/daily_dca.csv"],
    },
    "days_since_ath": {
        "filename": "days_since_ath.png",
        "path": "webapps/days_since_ath/preview.html",
        "roots": ["#daysSinceAthPreview"],
        "markers": ["/assets/daily_price_metadata.json"],
        "data": ["/assets/daily_price.csv"],
    },
    "issuance_rate": {
        "filename": "issuance_rate.png",
        "path": "webapps/issuance_rate/preview.html",
        "roots": ["#issuancePreview"],
        "markers": ["/webapps/issuance_rate/webapp_data/published_generation.json"],
        "data": ["/webapps/issuance_rate/webapp_data/issuance_rate_preview.json"],
    },
    "node_count": {
        "filename": "node_count.png",
        "path": "webapps/node_count/preview.html",
        "roots": ["#historyChart"],
        "markers": ["/webapps/node_count/webapp_data/published_generation.json"],
        "data": ["/webapps/node_count/webapp_data/bitcoin_node_history.csv"],
    },
    "quantum_exposure": {
        "filename": "quantum_exposure.png",
        "path": "webapps/quantum_exposure/preview.html",
        "roots": ["#historicalChart"],
        "markers": ["/webapps/quantum_exposure/webapp_data/published_generation.json"],
        "data": ["/webapps/quantum_exposure/webapp_data/historical_eco.csv"],
    },
    "uoa": {
        "filename": "uoa.png",
        "path": "webapps/uoa/preview.html",
        "roots": ["#leftChart", "#rightChart"],
        "markers": ["/assets/daily_price_metadata.json"],
        "data": ["/assets/daily_price.csv"],
    },
}

PATOSHI = {
    "filename": "patoshi_pattern.png",
    "path": "webapps/patoshi_pattern/preview.html",
    "roots": ["#patoshiPreview"],
    "data": ["/webapps/patoshi_pattern/webapp_data/patoshi_preview_blocks.csv"],
}

STATIC_IMAGES = {
    "bitcoin_net_worth": {
        "filename": "bitcoin_net_worth.png",
        "path": "webapps/bitcoin_net_worth/preview.html",
        "block": ["*bitcoin-icon.png*"],
        "hold_paths": ["/assets/bitcoin-icon.png"],
        "root": "#bitcoinPreviewIcon",
        "failed": "document.querySelector('#bitcoinPreviewIcon')?.dataset.previewState === 'fallback'",
        "recovered": "document.querySelector('#bitcoinPreviewIcon')?.dataset.previewState === 'ready' && document.querySelector('#bitcoinPreviewIcon')?.naturalWidth > 0",
    },
    "casascius_explorer": {
        "filename": "casascius_explorer.png",
        "path": "webapps/casascius_explorer/preview.html",
        "block": ["*coin-1000-gold-2012-front.png*", "*coin-1000-gold-2012-back.png*"],
        "hold_paths": [
            "/webapps/casascius_explorer/preview_assets/coin-1000-gold-2012-front.png",
            "/webapps/casascius_explorer/preview_assets/coin-1000-gold-2012-back.png",
        ],
        "root": "#stage",
        "failed": "document.querySelector('#stage')?.dataset.previewState === 'fallback' && !document.querySelector('#stage')?.classList.contains('is-ready')",
        "recovered": "document.querySelector('#stage')?.dataset.previewState === 'ready' && document.querySelector('#stage')?.classList.contains('is-ready')",
    },
}

ALL_FILENAMES = [
    "quantum_exposure.png",
    "dca_cost_basis.png",
    "days_since_ath.png",
    "issuance_rate.png",
    "dca_comparison.png",
    "patoshi_pattern.png",
    "bip110_signaling.png",
    "bitcoin_dominance.png",
    "uoa.png",
    "node_count.png",
    "bitcoin_net_worth.png",
    "casascius_explorer.png",
]


def browser_specs() -> dict[str, dict]:
    specs = {}
    for spec in PERIODIC_PREVIEWS.values():
        specs["/" + spec["path"]] = {
            "kind": "periodic",
            "filename": spec["filename"],
            "roots": spec["roots"],
            "markers": spec["markers"],
            "data": spec["data"],
        }
    specs["/" + PATOSHI["path"]] = {
        "kind": "static-data",
        "filename": PATOSHI["filename"],
        "roots": PATOSHI["roots"],
        "markers": [],
        "data": PATOSHI["data"],
    }
    for spec in STATIC_IMAGES.values():
        specs["/" + spec["path"]] = {
            "kind": "static-image",
            "filename": spec["filename"],
            "roots": [spec["root"]],
            "markers": [],
            "data": [],
        }
    return specs


def build_data_snapshot() -> dict[str, bytes]:
    """Freeze mutable artifacts so a concurrent pipeline cannot split a run."""

    snapshot = {}
    paths = set()
    for spec in browser_specs().values():
        paths.update(spec["markers"])
        paths.update(spec["data"])
    for pathname in sorted(paths):
        disk_path = ROOT / pathname.lstrip("/")
        if disk_path.is_file():
            snapshot[pathname] = disk_path.read_bytes()
    return snapshot


class SnapshotHandler(QuietHandler):
    snapshot: dict[str, bytes] = {}
    asset_hold_paths: set[str] = set()
    asset_hold_event = threading.Event()
    asset_hold_lock = threading.Lock()
    asset_hold_requests: list[str] = []
    asset_hold_event.set()

    @classmethod
    def begin_asset_hold(cls, paths):
        with cls.asset_hold_lock:
            cls.asset_hold_paths = set(paths)
            cls.asset_hold_requests = []
            cls.asset_hold_event.clear()

    @classmethod
    def release_asset_hold(cls):
        with cls.asset_hold_lock:
            cls.asset_hold_paths = set()
            cls.asset_hold_event.set()

    @classmethod
    def held_asset_request_count(cls):
        with cls.asset_hold_lock:
            return len(cls.asset_hold_requests)

    def do_GET(self):
        pathname = urllib.parse.unquote(urllib.parse.urlparse(self.path).path)
        with self.asset_hold_lock:
            should_hold = pathname in self.asset_hold_paths
            if should_hold:
                self.asset_hold_requests.append(pathname)
        if should_hold:
            self.asset_hold_event.wait(timeout=30)
        body = self.snapshot.get(pathname)
        if body is None:
            return super().do_GET()
        self.send_response(200)
        self.send_header(
            "Content-Type",
            mimetypes.guess_type(pathname)[0] or "application/octet-stream",
        )
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)


FETCH_HARNESS_TEMPLATE = r"""
(() => {
  const SPECS = __STAGE5_SPECS__;
  const pathname = location.pathname;
  const spec = SPECS[pathname] || null;
  const params = new URLSearchParams(location.search);

  if (pathname === '/index.html' && params.get('stage5_home') === '1') {
    try {
      const filenames = __STAGE5_FILENAMES__;
      localStorage.setItem('favorites', JSON.stringify(filenames));
      localStorage.setItem('showFavoritesOnly', 'true');
      localStorage.setItem('wsb_dashboard_grid_order_v1', JSON.stringify([...filenames].reverse()));
      localStorage.setItem('quantum-research-dashboard-theme', 'dark');
    } catch (_) {}
  }

  if (!spec) return;
  const nativeFetch = window.fetch.bind(window);
  const loadKey = `wsb-stage5-load-count:${pathname}`;
  const loadCount = Number(sessionStorage.getItem(loadKey) || '0') + 1;
  sessionStorage.setItem(loadKey, String(loadCount));

  const test = {
    spec,
    generation: Number(params.get('stage5_generation') || '0'),
    mode: params.get('stage5_mode') || 'pass',
    coldFailuresRemaining: params.get('stage5_cold') === '1' ? 1 : 0,
    pending: [],
    events: [],
    errors: [],
    markerRequests: [],
    dataRequests: [],
    blankSamples: [],
    loaderSamples: [],
    visualChangeSamples: [],
    monitorFingerprint: '',
    monitorTimer: 0,
    loadCount,
    rootRefs: [],
    setGeneration(generation, mode = 'pass') {
      this.generation = Number(generation);
      this.mode = String(mode || 'pass');
    },
    setMode(mode) {
      this.mode = String(mode || 'pass');
    },
    releaseAll() {
      const releases = this.pending.splice(0);
      releases.forEach((release) => release());
      return releases.length;
    },
    resetActivity() {
      this.events.length = 0;
      this.markerRequests.length = 0;
      this.dataRequests.length = 0;
    },
  };
  window.__wsbStage5PreviewTest = test;

  const generationFrom = (value) => {
    const match = String(value || '').match(/stage5_generation["']?\s*[:=]\s*(\d+)/i);
    return match ? Number(match[1]) : -1;
  };
  test.generationFrom = generationFrom;

  window.addEventListener('wsb:preview-refresh-status', (event) => {
    const detail = event.detail || {};
    const signature = detail.signature || detail.acceptedSignature || '';
    test.events.push({
      status: String(detail.status || ''),
      generation: generationFrom(signature),
      requestId: Number(detail.requestId || 0),
      reason: String(detail.reason || ''),
    });
  });
  window.addEventListener('error', (event) => {
    test.errors.push(String(event.error?.stack || event.message || event.error || 'window error'));
  });
  window.addEventListener('unhandledrejection', (event) => {
    test.errors.push(String(event.reason?.stack || event.reason || 'unhandled rejection'));
  });

  function rebuiltResponse(response, text, contentType) {
    const headers = new Headers(response.headers);
    headers.delete('content-length');
    headers.delete('content-encoding');
    headers.delete('etag');
    headers.set('cache-control', 'no-store');
    if (contentType) headers.set('content-type', contentType);
    return new Response(text, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  }

  function stampMarker(text, generation) {
    try {
      const parsed = JSON.parse(String(text || ''));
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        parsed.stage5_generation = Number(generation);
        return JSON.stringify(parsed);
      }
    } catch (_) {}
    return `${String(text || '').trim()}\nstage5_generation=${Number(generation)}\n`;
  }

  function truncatePayload(text) {
    const value = String(text || '');
    if (!value) return value;
    const newline = value.indexOf('\n');
    if (newline >= 0) return value.slice(0, Math.min(value.length, newline + 8));
    return value.slice(0, Math.max(1, Math.floor(value.length / 5)));
  }

  window.fetch = async (input, init) => {
    const raw = typeof input === 'string' ? input : input?.url;
    const url = new URL(raw, document.baseURI);
    const target = url.pathname;
    const isMarker = spec.markers.includes(target);
    const isData = spec.data.includes(target);
    if (!isMarker && !isData) return nativeFetch(input, init);

    const generation = test.generation;
    const refreshToken = url.searchParams.get('wsb_preview_refresh') || '';
    const phaseMatch = refreshToken.match(/-(probe|pre-commit|verify)-/);
    const phase = phaseMatch ? phaseMatch[1] : (isMarker ? 'marker' : 'data');
    const request = { pathname: target, generation, phase, mode: test.mode };
    (isMarker ? test.markerRequests : test.dataRequests).push(request);

    if (test.coldFailuresRemaining > 0 && (isMarker || spec.kind === 'static-data')) {
      test.coldFailuresRemaining -= 1;
      throw new TypeError('Stage 5 injected cold-start offline failure');
    }
    if (test.mode === 'offline') {
      throw new TypeError('Stage 5 injected offline failure');
    }

    const response = await nativeFetch(input, init);
    if (!response.ok) return response;
    let text = await response.clone().text();

    if (isData && test.mode === 'hold-data') {
      await new Promise((resolve) => test.pending.push(resolve));
    }
    if (isMarker) {
      text = stampMarker(text, generation);
      return rebuiltResponse(response, text, 'application/json');
    }
    if (isData && test.mode === 'truncate') {
      text = truncatePayload(text);
    }
    return rebuiltResponse(response, text, response.headers.get('content-type') || 'text/plain');
  };

  function rootVisual(root) {
    if (!root || !root.isConnected) return false;
    const rect = root.getBoundingClientRect();
    if (!(rect.width > 0 && rect.height > 0)) return false;
    if (root instanceof HTMLCanvasElement) return root.width > 0 && root.height > 0;
    if (root instanceof HTMLImageElement) return root.complete && root.naturalWidth > 0;
    return root.childElementCount > 0 || String(root.textContent || '').trim().length > 0;
  }

  test.rootsReady = () => spec.roots.every((selector) => rootVisual(document.querySelector(selector)));
  function textFingerprint(value) {
    const text = String(value || '');
    let hash = 2166136261;
    for (let index = 0; index < text.length; index += 1) {
      hash ^= text.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return `${text.length}:${(hash >>> 0).toString(16)}`;
  }
  test.fingerprints = () => spec.roots.map((selector) => {
    const root = document.querySelector(selector);
    if (!root) return { selector, missing: true };
    if (root instanceof HTMLCanvasElement) {
      return {
        selector,
        kind: 'canvas',
        width: root.width,
        height: root.height,
        value: textFingerprint(root.toDataURL()),
      };
    }
    return {
      selector,
      kind: 'dom',
      width: Math.round(root.getBoundingClientRect().width),
      height: Math.round(root.getBoundingClientRect().height),
      value: textFingerprint(root.innerHTML),
    };
  });
  test.captureRootRefs = () => {
    test.rootRefs = spec.roots.map((selector) => document.querySelector(selector));
  };
  test.sameRootRefs = () => (
    test.rootRefs.length === spec.roots.length
    && test.rootRefs.every((root, index) => root === document.querySelector(spec.roots[index]))
  );
  test.visibleLoader = () => Array.from(document.querySelectorAll(
    '.chart-loading, [class*="loader" i], [id*="loader" i]'
  )).some((element) => {
    if (!element.isConnected || element.hidden) return false;
    const style = getComputedStyle(element);
    return style.display !== 'none' && style.visibility !== 'hidden'
      && style.opacity !== '0' && element.getAttribute('aria-hidden') !== 'true';
  });
  test.startMonitor = () => {
    test.stopMonitor();
    test.captureRootRefs();
    test.monitorFingerprint = JSON.stringify(test.fingerprints());
    const sample = () => {
      if (!test.rootsReady()) test.blankSamples.push(Date.now());
      if (test.visibleLoader()) test.loaderSamples.push(Date.now());
      if (JSON.stringify(test.fingerprints()) !== test.monitorFingerprint) {
        test.visualChangeSamples.push(Date.now());
      }
    };
    test.monitorTimer = window.setInterval(sample, 20);
    sample();
  };
  test.stopMonitor = () => {
    if (test.monitorTimer) window.clearInterval(test.monitorTimer);
    test.monitorTimer = 0;
  };
})();
"""


def fetch_harness_source() -> str:
    return (
        FETCH_HARNESS_TEMPLATE
        .replace("__STAGE5_SPECS__", json.dumps(browser_specs(), separators=(",", ":")))
        .replace("__STAGE5_FILENAMES__", json.dumps(ALL_FILENAMES, separators=(",", ":")))
    )


def js(value) -> str:
    return json.dumps(value, separators=(",", ":"))


def controller_expression(filename: str) -> str:
    return f"window.WSBPreviewShared?.getDataRefresher?.({js(filename)})"


def wait_for_status(
    cdp: CdpSocket,
    status: str,
    generation: int | None = None,
    *,
    timeout: float = 45,
    description: str | None = None,
):
    generation_test = (
        "true" if generation is None else f"event.generation === {int(generation)}"
    )
    return wait_for(
        lambda: cdp.evaluate(
            "window.__wsbStage5PreviewTest?.events.some((event) => "
            f"event.status === {js(status)} && ({generation_test}))"
        ),
        timeout=timeout,
        description=description or f"{status} status for generation {generation}",
    )


def wait_for_periodic_ready(cdp: CdpSocket, spec: dict, generation: int = 0):
    filename = spec["filename"]
    wait_for(
        lambda: cdp.evaluate(
            "Boolean(document.documentElement.dataset.previewReady === '1' "
            f"&& {controller_expression(filename)} "
            "&& window.__wsbStage5PreviewTest?.rootsReady())"
        ),
        timeout=60,
        description=f"{filename} preview readiness",
    )
    wait_for_status(cdp, "applied", generation, timeout=60)
    wait_for_status(cdp, "presented", generation, timeout=60)


def accepted_generation(cdp: CdpSocket, filename: str) -> int:
    return int(
        cdp.evaluate(
            "window.__wsbStage5PreviewTest.generationFrom("
            f"{controller_expression(filename)}?.getStatus?.().acceptedSignature)"
        )
    )


def capture_preview_baseline(cdp: CdpSocket) -> dict:
    return cdp.evaluate(
        r"""
        (() => {
          const test = window.__wsbStage5PreviewTest;
          test.blankSamples.length = 0;
          test.loaderSamples.length = 0;
          test.visualChangeSamples.length = 0;
          test.startMonitor();
          return {
            href: location.href,
            navigationCount: performance.getEntriesByType('navigation').length,
            loadCount: test.loadCount,
            storedLoadCount: Number(sessionStorage.getItem(`wsb-stage5-load-count:${location.pathname}`) || '0'),
            theme: document.documentElement.dataset.theme || '',
            fingerprints: test.fingerprints(),
          };
        })()
        """
    )


def capture_preview_state(cdp: CdpSocket) -> dict:
    return cdp.evaluate(
        r"""
        (() => {
          const test = window.__wsbStage5PreviewTest;
          return {
            href: location.href,
            navigationCount: performance.getEntriesByType('navigation').length,
            loadCount: test.loadCount,
            storedLoadCount: Number(sessionStorage.getItem(`wsb-stage5-load-count:${location.pathname}`) || '0'),
            theme: document.documentElement.dataset.theme || '',
            fingerprints: test.fingerprints(),
            sameRootRefs: test.sameRootRefs(),
            blankSamples: [...test.blankSamples],
            loaderSamples: [...test.loaderSamples],
            visualChangeSamples: [...test.visualChangeSamples],
            errors: [...test.errors],
          };
        })()
        """
    )


def assert_failure_preserved(cdp: CdpSocket, expected_fingerprints, stage: str):
    state = cdp.evaluate(
        "({ fingerprints: window.__wsbStage5PreviewTest.fingerprints(), "
        "sameRootRefs: window.__wsbStage5PreviewTest.sameRootRefs(), "
        "rootsReady: window.__wsbStage5PreviewTest.rootsReady(), "
        "loader: window.__wsbStage5PreviewTest.visibleLoader() })"
    )
    if state["fingerprints"] != expected_fingerprints:
        raise AssertionError(
            f"Preview replaced its last-good visual during {stage}: {state!r}"
        )
    if not state["sameRootRefs"] or not state["rootsReady"] or state["loader"]:
        raise AssertionError(f"Preview lost stable presentation during {stage}: {state!r}")


def assert_periodic_in_place(cdp: CdpSocket, baseline: dict, slug: str):
    cdp.evaluate("window.__wsbStage5PreviewTest.stopMonitor(); true")
    state = capture_preview_state(cdp)
    identity_keys = (
        "href",
        "navigationCount",
        "loadCount",
        "storedLoadCount",
        "theme",
        "fingerprints",
    )
    changed = {
        key: (baseline[key], state[key])
        for key in identity_keys
        if baseline[key] != state[key]
    }
    if changed:
        raise AssertionError(f"{slug} changed stable preview state: {changed!r}")
    if not state["sameRootRefs"]:
        raise AssertionError(f"{slug} replaced a preview render root")
    if state["blankSamples"]:
        raise AssertionError(f"{slug} visibly blanked during refresh")
    if state["loaderSamples"]:
        raise AssertionError(f"{slug} showed a routine refresh loader")
    if state["visualChangeSamples"]:
        raise AssertionError(
            f"{slug} exposed an intermediate visual during an unchanged-data refresh"
        )
    if state["errors"]:
        raise AssertionError(f"{slug} raised browser errors: {state['errors']!r}")


def request_periodic_check(cdp: CdpSocket, filename: str, reason: str):
    accepted = cdp.evaluate(
        f"Boolean({controller_expression(filename)}?.requestCheck?.({js(reason)}) !== undefined)"
    )
    # requestCheck intentionally returns undefined; the API existence is the contract.
    if not cdp.evaluate(
        f"typeof {controller_expression(filename)}?.requestCheck === 'function'"
    ):
        raise AssertionError(f"No shared preview refresher registered for {filename}")
    return accepted


def set_test_generation(cdp: CdpSocket, generation: int, mode: str = "pass"):
    cdp.evaluate(
        f"window.__wsbStage5PreviewTest.setGeneration({int(generation)}, {js(mode)}); true"
    )


def reset_test_activity(cdp: CdpSocket):
    cdp.evaluate("window.__wsbStage5PreviewTest.resetActivity(); true")


def test_periodic_preview(cdp: CdpSocket, server_port: int, slug: str, spec: dict):
    url = (
        f"http://127.0.0.1:{server_port}/{spec['path']}"
        "?stage5_preview_test=1&stage5_generation=0"
    )
    cdp.command("Page.navigate", {"url": url})
    wait_for_periodic_ready(cdp, spec)
    time.sleep(0.2)
    filename = spec["filename"]
    baseline = capture_preview_baseline(cdp)

    # An unchanged marker is only a probe.  Payload files must remain untouched.
    reset_test_activity(cdp)
    request_periodic_check(cdp, filename, "stage5-unchanged")
    wait_for_status(cdp, "unchanged", 0)
    unchanged = cdp.evaluate(
        "({ data: [...window.__wsbStage5PreviewTest.dataRequests], "
        "presented: window.__wsbStage5PreviewTest.events.filter((event) => event.status === 'presented') })"
    )
    if unchanged["data"] or unchanged["presented"]:
        raise AssertionError(
            f"{slug} fetched or painted after an unchanged marker: {unchanged!r}"
        )

    # Data may install while hidden, but presentation waits for one visible wake.
    reset_test_activity(cdp)
    hidden_override = cdp.evaluate(
        r"""
        (() => {
          try {
            window.__wsbStage5Visibility = 'hidden';
            Object.defineProperty(document, 'visibilityState', {
              configurable: true,
              get: () => window.__wsbStage5Visibility,
            });
            document.dispatchEvent(new Event('visibilitychange'));
            return document.visibilityState === 'hidden';
          } catch (_) { return false; }
        })()
        """
    )
    if not hidden_override:
        raise AssertionError(f"Could not simulate hidden state for {slug}")
    set_test_generation(cdp, 1)
    request_periodic_check(cdp, filename, "stage5-hidden")
    wait_for_status(cdp, "applied", 1)
    time.sleep(0.15)
    hidden = cdp.evaluate(
        "({ presented: window.__wsbStage5PreviewTest.events.filter((event) => "
        "event.status === 'presented').length, fingerprints: "
        "window.__wsbStage5PreviewTest.fingerprints() })"
    )
    if hidden["presented"] != 0 or hidden["fingerprints"] != baseline["fingerprints"]:
        raise AssertionError(f"{slug} painted while hidden: {hidden!r}")
    cdp.evaluate(
        "window.__wsbStage5Visibility = 'visible'; "
        "document.dispatchEvent(new Event('visibilitychange')); true"
    )
    wait_for_status(cdp, "presented", 1)
    time.sleep(0.2)
    visible_presentations = cdp.evaluate(
        "window.__wsbStage5PreviewTest.events.filter((event) => "
        "event.status === 'presented' && event.generation === 1).length"
    )
    if visible_presentations != 1:
        raise AssertionError(
            f"{slug} did not coalesce visible presentation: {visible_presentations}"
        )

    # Offline errors retain the complete generation, then an online wake recovers.
    reset_test_activity(cdp)
    before_failure = cdp.evaluate("window.__wsbStage5PreviewTest.fingerprints()")
    set_test_generation(cdp, 2, "offline")
    request_periodic_check(cdp, filename, "stage5-offline")
    wait_for_status(cdp, "error", timeout=30)
    wait_for(
        lambda: not cdp.evaluate(
            f"{controller_expression(filename)}?.getStatus?.().checkInFlight"
        ),
        timeout=10,
        description=f"{slug} offline check completion",
    )
    if accepted_generation(cdp, filename) != 1:
        raise AssertionError(f"{slug} advanced its signature after an offline failure")
    assert_failure_preserved(cdp, before_failure, f"{slug} offline failure")
    set_test_generation(cdp, 2)
    cdp.evaluate("window.dispatchEvent(new Event('online')); true")
    request_periodic_check(cdp, filename, "stage5-online-recovery")
    wait_for_status(cdp, "applied", 2)
    wait_for_status(cdp, "presented", 2)

    # A held old candidate must lose the marker race and never install or paint.
    reset_test_activity(cdp)
    set_test_generation(cdp, 3, "hold-data")
    request_periodic_check(cdp, filename, "stage5-held-generation")
    wait_for(
        lambda: cdp.evaluate("window.__wsbStage5PreviewTest.pending.length > 0"),
        timeout=30,
        description=f"{slug} held payload request",
    )
    set_test_generation(cdp, 4)
    request_periodic_check(cdp, filename, "stage5-newer-generation")
    released = cdp.evaluate("window.__wsbStage5PreviewTest.releaseAll()")
    if released < 1:
        raise AssertionError(f"{slug} did not hold the stale generation")
    wait_for_status(cdp, "superseded", 3)
    wait_for_status(cdp, "applied", 4)
    wait_for_status(cdp, "presented", 4)
    stale = cdp.evaluate(
        "window.__wsbStage5PreviewTest.events.filter((event) => "
        "event.generation === 3 && (event.status === 'applied' || event.status === 'presented'))"
    )
    if stale:
        raise AssertionError(f"{slug} exposed superseded generation 3: {stale!r}")

    # A truncated body cannot replace the accepted generation or last-good view.
    reset_test_activity(cdp)
    before_failure = cdp.evaluate("window.__wsbStage5PreviewTest.fingerprints()")
    set_test_generation(cdp, 5, "truncate")
    request_periodic_check(cdp, filename, "stage5-truncated")
    wait_for(
        lambda: cdp.evaluate(
            "window.__wsbStage5PreviewTest.dataRequests.some((request) => request.generation === 5)"
        ),
        timeout=30,
        description=f"{slug} truncated payload request",
    )
    wait_for(
        lambda: not cdp.evaluate(
            f"{controller_expression(filename)}?.getStatus?.().checkInFlight"
        ),
        timeout=30,
        description=f"{slug} truncated candidate rejection",
    )
    if accepted_generation(cdp, filename) != 4:
        raise AssertionError(f"{slug} accepted a truncated generation")
    assert_failure_preserved(cdp, before_failure, f"{slug} truncated candidate")
    set_test_generation(cdp, 5)
    request_periodic_check(cdp, filename, "stage5-truncated-recovery")
    wait_for_status(cdp, "applied", 5)
    wait_for_status(cdp, "presented", 5)

    time.sleep(0.25)
    assert_periodic_in_place(cdp, baseline, slug)


def test_periodic_cold_recovery(cdp: CdpSocket, server_port: int, slug: str, spec: dict):
    url = (
        f"http://127.0.0.1:{server_port}/{spec['path']}"
        "?stage5_preview_test=1&stage5_generation=0&stage5_cold=1"
    )
    cdp.command("Page.navigate", {"url": url})
    filename = spec["filename"]
    wait_for(
        lambda: cdp.evaluate(
            "Boolean(window.__wsbStage5PreviewTest "
            f"&& {controller_expression(filename)} "
            "&& document.documentElement.dataset.previewReady === '1' "
            "&& window.__wsbStage5PreviewTest.events.some((event) => event.status === 'error'))"
        ),
        timeout=30,
        description=f"{slug} cold fallback readiness",
    )
    failed = cdp.evaluate(
        "({ rootsReady: window.__wsbStage5PreviewTest.rootsReady(), "
        "href: location.href, navigationCount: performance.getEntriesByType('navigation').length, "
        "loadCount: window.__wsbStage5PreviewTest.loadCount, "
        "storedLoadCount: Number(sessionStorage.getItem(`wsb-stage5-load-count:${location.pathname}`) || '0') })"
    )
    if not failed["rootsReady"]:
        raise AssertionError(f"{slug} cold failure left a blank fallback: {failed!r}")
    request_periodic_check(cdp, filename, "stage5-cold-recovery")
    wait_for_periodic_ready(cdp, spec)
    recovered = cdp.evaluate(
        "({ rootsReady: window.__wsbStage5PreviewTest.rootsReady(), href: location.href, "
        "navigationCount: performance.getEntriesByType('navigation').length, "
        "loadCount: window.__wsbStage5PreviewTest.loadCount, "
        "storedLoadCount: Number(sessionStorage.getItem(`wsb-stage5-load-count:${location.pathname}`) || '0'), "
        "errors: [...window.__wsbStage5PreviewTest.errors] })"
    )
    for key in ("href", "navigationCount", "loadCount", "storedLoadCount"):
        if recovered[key] != failed[key]:
            raise AssertionError(f"{slug} navigated during cold recovery: {recovered!r}")
    if not recovered["rootsReady"] or recovered["errors"]:
        raise AssertionError(f"{slug} cold recovery did not settle cleanly: {recovered!r}")


def patoshi_state(cdp: CdpSocket) -> dict:
    return cdp.evaluate(
        r"""
        (() => {
          const test = window.__wsbStage5PreviewTest;
          const root = document.querySelector('#patoshiPreview');
          return {
            href: location.href,
            navigationCount: performance.getEntriesByType('navigation').length,
            loadCount: test?.loadCount || 0,
            storedLoadCount: Number(sessionStorage.getItem(`wsb-stage5-load-count:${location.pathname}`) || '0'),
            ready: document.documentElement.dataset.previewReady === '1',
            previewState: root?.dataset?.previewState || '',
            fingerprints: test?.fingerprints?.() || [],
            rootsReady: test?.rootsReady?.() || false,
            dataRequests: [...(test?.dataRequests || [])],
            errors: [...(test?.errors || [])],
          };
        })()
        """
    )


def assert_same_navigation(before: dict, after: dict, stage: str):
    for key in ("href", "navigationCount", "loadCount", "storedLoadCount"):
        if before[key] != after[key]:
            raise AssertionError(f"{stage} navigated/reloaded: {before!r} -> {after!r}")


def test_patoshi_failure_recovery(
    cdp: CdpSocket,
    server_port: int,
    mode: str,
):
    url = (
        f"http://127.0.0.1:{server_port}/{PATOSHI['path']}"
        f"?stage5_preview_test=1&stage5_mode={urllib.parse.quote(mode)}"
    )
    cdp.command("Page.navigate", {"url": url})
    wait_for(
        lambda: cdp.evaluate(
            "document.documentElement.dataset.previewReady === '1' "
            "&& window.__wsbStage5PreviewTest?.dataRequests.length >= 1"
        ),
        timeout=30,
        description=f"Patoshi {mode} cold fallback",
    )
    failed = patoshi_state(cdp)
    if failed["previewState"] != "fallback":
        raise AssertionError(
            f"Patoshi accepted or blanked a {mode} cold payload: {failed!r}"
        )
    cdp.evaluate(
        "window.__wsbStage5PreviewTest.captureRootRefs(); "
        "window.__wsbStage5PreviewTest.setMode('pass'); "
        "window.dispatchEvent(new Event('online')); true"
    )
    wait_for(
        lambda: cdp.evaluate(
            "document.querySelector('#patoshiPreview')?.dataset.previewState === 'presented' "
            "&& window.__wsbStage5PreviewTest?.rootsReady() "
            "&& window.__wsbStage5PreviewTest?.dataRequests.length >= 2"
        ),
        timeout=30,
        description=f"Patoshi online recovery after {mode}",
    )
    recovered = patoshi_state(cdp)
    assert_same_navigation(failed, recovered, f"Patoshi {mode} recovery")
    if not recovered["rootsReady"] or recovered["errors"]:
        raise AssertionError(f"Patoshi {mode} recovery was not clean: {recovered!r}")
    if recovered["fingerprints"] == failed["fingerprints"]:
        raise AssertionError(f"Patoshi {mode} recovery did not replace its fallback pixels")
    if not cdp.evaluate("window.__wsbStage5PreviewTest.sameRootRefs()"):
        raise AssertionError(f"Patoshi replaced its canvas during {mode} recovery")

    # A successful static data preview has no periodic controller or wake fetch.
    cdp.evaluate(
        "window.__wsbStage5PreviewTest.resetActivity(); "
        "window.dispatchEvent(new Event('focus')); "
        "document.dispatchEvent(new Event('visibilitychange')); true"
    )
    time.sleep(0.4)
    static_contract = cdp.evaluate(
        "({ controller: !!window.WSBPreviewShared?.getDataRefresher?.('patoshi_pattern.png'), "
        "requests: window.__wsbStage5PreviewTest.dataRequests.length, "
        "fingerprints: window.__wsbStage5PreviewTest.fingerprints() })"
    )
    if static_contract["controller"] or static_contract["requests"]:
        raise AssertionError(f"Patoshi unexpectedly polls after install: {static_contract!r}")
    if static_contract["fingerprints"] != recovered["fingerprints"]:
        raise AssertionError(f"Patoshi wake disturbed its installed chart: {static_contract!r}")


def test_patoshi_slow_start(cdp: CdpSocket, server_port: int):
    url = (
        f"http://127.0.0.1:{server_port}/{PATOSHI['path']}"
        "?stage5_preview_test=1&stage5_mode=hold-data"
    )
    cdp.command("Page.navigate", {"url": url})
    wait_for(
        lambda: cdp.evaluate("window.__wsbStage5PreviewTest?.pending.length > 0"),
        timeout=30,
        description="held Patoshi cold payload",
    )
    held = patoshi_state(cdp)
    if held["ready"]:
        raise AssertionError(f"Patoshi marked an unresolved slow payload ready: {held!r}")
    cdp.evaluate(
        "window.__wsbStage5PreviewTest.setMode('pass'); "
        "window.__wsbStage5PreviewTest.releaseAll(); true"
    )
    try:
        wait_for(
            lambda: cdp.evaluate(
                "document.documentElement.dataset.previewReady === '1' "
                "&& document.querySelector('#patoshiPreview')?.dataset.previewState === 'presented' "
                "&& window.__wsbStage5PreviewTest?.rootsReady()"
            ),
            timeout=30,
            description="Patoshi slow payload completion",
        )
    except TimeoutError as error:
        diagnostics = cdp.evaluate(
            "({ visibility: document.visibilityState, ready: document.documentElement.dataset.previewReady || '', "
            "previewState: document.querySelector('#patoshiPreview')?.dataset.previewState || '', "
            "previewError: document.querySelector('#patoshiPreview')?.dataset.previewError || '', "
            "pending: window.__wsbStage5PreviewTest?.pending.length || 0, "
            "mode: window.__wsbStage5PreviewTest?.mode || '', "
            "requests: [...(window.__wsbStage5PreviewTest?.dataRequests || [])], "
            "errors: [...(window.__wsbStage5PreviewTest?.errors || [])] })"
        )
        raise AssertionError(f"Patoshi slow payload did not settle: {diagnostics!r}") from error
    recovered = patoshi_state(cdp)
    assert_same_navigation(held, recovered, "Patoshi slow start")
    if not recovered["rootsReady"] or recovered["errors"]:
        raise AssertionError(f"Patoshi slow start did not settle cleanly: {recovered!r}")


def test_patoshi(cdp: CdpSocket, server_port: int):
    test_patoshi_slow_start(cdp, server_port)
    test_patoshi_failure_recovery(cdp, server_port, "offline")
    test_patoshi_failure_recovery(cdp, server_port, "truncate")


def static_image_state(cdp: CdpSocket, spec: dict) -> dict:
    return cdp.evaluate(
        f"""
        (() => {{
          const test = window.__wsbStage5PreviewTest;
          const root = document.querySelector({js(spec['root'])});
          return {{
            href: location.href,
            navigationCount: performance.getEntriesByType('navigation').length,
            loadCount: test?.loadCount || 0,
            storedLoadCount: Number(sessionStorage.getItem(`wsb-stage5-load-count:${{location.pathname}}`) || '0'),
            ready: document.documentElement.dataset.previewReady === '1',
            recovered: Boolean({spec['recovered']}),
            rootConnected: !!root?.isConnected,
            sameRootRefs: test?.sameRootRefs?.() ?? true,
            fingerprints: test?.fingerprints?.() || [],
            previewState: root?.dataset?.previewState || '',
            naturalWidth: root instanceof HTMLImageElement ? root.naturalWidth : 0,
            edgeCount: root?.querySelectorAll?.('.edge')?.length || 0,
            loaderVisible: test?.visibleLoader?.() || false,
            theme: document.documentElement.dataset.theme || '',
            errors: [...(test?.errors || [])],
          }};
        }})()
        """
    )


def test_static_image_preview(
    cdp: CdpSocket,
    server_port: int,
    slug: str,
    spec: dict,
):
    cdp.command("Network.setBlockedURLs", {"urls": spec["block"]})
    url = f"http://127.0.0.1:{server_port}/{spec['path']}?stage5_preview_test=1"
    cdp.command("Page.navigate", {"url": url})
    wait_for(
        lambda: cdp.evaluate(
            f"document.documentElement.dataset.previewReady === '1' && ({spec['failed']})"
        ),
        timeout=30,
        description=f"{slug} failed-asset readiness",
    )
    failed = static_image_state(cdp, spec)
    if not failed["rootConnected"]:
        raise AssertionError(f"{slug} removed its render root after an image failure")
    if failed["loaderVisible"]:
        raise AssertionError(f"{slug} showed a loader after an image failure")
    cdp.evaluate("window.__wsbStage5PreviewTest.captureRootRefs(); true")
    cdp.command("Network.setBlockedURLs", {"urls": []})
    cdp.evaluate("window.dispatchEvent(new Event('online')); true")
    wait_for(
        lambda: cdp.evaluate(f"Boolean({spec['recovered']})"),
        timeout=30,
        description=f"{slug} static asset recovery",
    )
    recovered = static_image_state(cdp, spec)
    assert_same_navigation(failed, recovered, f"{slug} static asset recovery")
    if (
        not recovered["rootConnected"]
        or not recovered["sameRootRefs"]
        or recovered["theme"] != failed["theme"]
        or recovered["errors"]
    ):
        raise AssertionError(f"{slug} recovery disturbed preview state: {recovered!r}")

    stable_fingerprint = recovered["fingerprints"]
    cdp.evaluate(
        "window.dispatchEvent(new Event('online')); "
        "document.dispatchEvent(new Event('resume')); true"
    )
    time.sleep(0.35)
    final = static_image_state(cdp, spec)
    assert_same_navigation(recovered, final, f"{slug} repeated wake")
    if final["fingerprints"] != stable_fingerprint or not final["sameRootRefs"]:
        raise AssertionError(f"{slug} repeated wake reset its visual state: {final!r}")

    if slug == "casascius_explorer":
        animation = cdp.evaluate(
            "(() => { const model = document.querySelector('#model'); "
            "const style = getComputedStyle(model); return { edges: model.querySelectorAll('.edge').length, "
            "name: style.animationName, playState: style.animationPlayState }; })()"
        )
        if animation["edges"] < 100 or animation["name"] == "none" or animation["playState"] != "running":
            raise AssertionError(f"Casascius animation did not survive recovery: {animation!r}")


def test_static_image_slow_recovery(
    cdp: CdpSocket,
    server_port: int,
    slug: str,
    spec: dict,
):
    SnapshotHandler.begin_asset_hold(spec["hold_paths"])
    try:
        url = (
            f"http://127.0.0.1:{server_port}/{spec['path']}"
            "?stage5_preview_test=1&wsb_preview_asset_timeout_ms=250"
        )
        cdp.command("Page.navigate", {"url": url})
        wait_for(
            lambda: SnapshotHandler.held_asset_request_count() >= 1,
            timeout=10,
            description=f"{slug} held image request",
        )
        wait_for(
            lambda: cdp.evaluate(
                f"document.documentElement.dataset.previewReady === '1' && ({spec['failed']})"
            ),
            timeout=5,
            description=f"{slug} bounded slow-image fallback",
        )
        failed = static_image_state(cdp, spec)
        if not failed["rootConnected"] or failed["loaderVisible"]:
            raise AssertionError(f"{slug} slow fallback was blank or loading: {failed!r}")
        cdp.evaluate("window.__wsbStage5PreviewTest.captureRootRefs(); true")
    finally:
        SnapshotHandler.release_asset_hold()

    cdp.evaluate("window.dispatchEvent(new Event('online')); true")
    wait_for(
        lambda: cdp.evaluate(f"Boolean({spec['recovered']})"),
        timeout=15,
        description=f"{slug} held-image recovery",
    )
    recovered = static_image_state(cdp, spec)
    assert_same_navigation(failed, recovered, f"{slug} held-image recovery")
    if (
        not recovered["rootConnected"]
        or not recovered["sameRootRefs"]
        or recovered["loaderVisible"]
        or recovered["theme"] != failed["theme"]
        or recovered["errors"]
    ):
        raise AssertionError(f"{slug} held-image recovery disturbed state: {recovered!r}")
    if slug == "bitcoin_net_worth" and recovered["naturalWidth"] <= 0:
        raise AssertionError(f"Bitcoin Net Worth held image did not install: {recovered!r}")
    if slug == "casascius_explorer" and recovered["edgeCount"] < 100:
        raise AssertionError(f"Casascius held images did not restore the model: {recovered!r}")


def assert_parent_refresh_ownership_removed():
    source_path = ROOT / "js/09_bootstrap_fetch_init_global_exports.js"
    source = source_path.read_text()
    forbidden = (
        "HOMEPAGE_GRID_CARD_DATA_SOURCES",
        "refreshHomepageGridCards",
        "reloadHomepageDashboardCard",
        "refreshHomepageDashboardPreview",
    )
    present = [name for name in forbidden if name in source]
    if present:
        raise AssertionError(
            "Homepage still owns routine iframe navigation: " + ", ".join(present)
        )


def homepage_state(cdp: CdpSocket) -> dict:
    return cdp.evaluate(
        r"""
        (() => {
          const frames = Array.from(document.querySelectorAll('.dashboard-preview-frame'));
          const focused = document.activeElement?.closest?.('.chart-container');
          return {
            href: location.href,
            navigationCount: performance.getEntriesByType('navigation').length,
            order: Array.isArray(imageList) ? imageList.map((item) => item.filename) : [],
            cssOrder: Array.from(document.querySelectorAll('#image-grid > div')).map((container) => ({
              filename: container.querySelector('.chart-container')?.dataset.filename || '',
              order: container.style.order || '',
            })),
            favorites: typeof getFavorites === 'function' ? [...getFavorites()] : [],
            favoritesOnly: Boolean(showFavoritesOnly),
            favoritesToggle: document.querySelector('#favoritesToggle')?.classList.contains('active') || false,
            visible: Array.from(document.querySelectorAll('.chart-container[data-grid-index]'))
              .filter((card) => card.offsetParent !== null)
              .map((card) => card.dataset.filename),
            focused: focused?.dataset.filename || '',
            scrollY: Math.round(window.scrollY),
            theme: document.documentElement.dataset.theme || '',
            bodyClass: document.body.className,
            frames: frames.map((frame) => ({
              filename: frame.dataset.filename || '',
              src: frame.getAttribute('src') || '',
              datasetSrc: frame.dataset.src || '',
              token: frame.contentWindow?.__wsbStage5HomepageToken || '',
              loadEvents: Number(frame.__wsbStage5LoadEvents || 0),
              ready: frame.closest('.chart-wrapper')?.classList.contains('card-ready') || false,
              loading: frame.closest('.chart-wrapper')?.classList.contains('card-loading') || false,
              childHref: (() => { try { return frame.contentWindow?.location.href || ''; } catch (_) { return ''; } })(),
              childLoadCount: (() => {
                try { return frame.contentWindow?.__wsbStage5PreviewTest?.loadCount || 0; }
                catch (_) { return 0; }
              })(),
              childErrors: (() => {
                try { return [...(frame.contentWindow?.__wsbStage5PreviewTest?.errors || [])]; }
                catch (_) { return []; }
              })(),
            })),
            loaderMutations: [...(window.__wsbStage5HomepageLoaderMutations || [])],
            windowErrors: [...(window.__wsbStage5HomepageErrors || [])],
          };
        })()
        """
    )


def test_homepage_integration(cdp: CdpSocket, server_port: int):
    assert_parent_refresh_ownership_removed()
    url = f"http://127.0.0.1:{server_port}/index.html?stage5_home=1"
    cdp.command("Page.navigate", {"url": url})
    wait_for(
        lambda: cdp.evaluate(
            "typeof loadDashboardPreviewFrame === 'function' "
            "&& document.querySelectorAll('.dashboard-preview-frame').length === 12"
        ),
        timeout=30,
        description="homepage preview grid",
    )
    cdp.evaluate(
        r"""
        (async () => {
          const cards = Array.from(cardByFilename.values()).filter((card) => card?.preview?.iframe);
          for (const card of cards) {
            card.container.scrollIntoView({ block: 'center' });
            await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
            loadDashboardPreviewFrame(card);
            await new Promise((resolve) => setTimeout(resolve, 30));
          }
          window.scrollTo(0, 0);
          return cards.length;
        })()
        """
    )
    wait_for(
        lambda: cdp.evaluate(
            "Array.from(document.querySelectorAll('.dashboard-preview-frame')).every((frame) => "
            "frame.getAttribute('src') && frame.contentDocument?.documentElement?.dataset.previewReady === '1' "
            "&& frame.closest('.chart-wrapper')?.classList.contains('card-ready'))"
        ),
        timeout=90,
        description="all homepage previews ready",
    )

    setup = cdp.evaluate(
        r"""
        (() => {
          const frames = Array.from(document.querySelectorAll('.dashboard-preview-frame'));
          frames.forEach((frame, index) => {
            frame.contentWindow.__wsbStage5HomepageToken = `stage5-frame-${index}-${Date.now()}`;
            frame.__wsbStage5LoadEvents = 0;
            frame.addEventListener('load', () => { frame.__wsbStage5LoadEvents += 1; });
          });
          window.__wsbStage5HomepageLoaderMutations = [];
          window.__wsbStage5HomepageErrors = [];
          window.addEventListener('error', (event) => {
            window.__wsbStage5HomepageErrors.push(String(event.message || event.error || 'window error'));
          });
          window.addEventListener('unhandledrejection', (event) => {
            window.__wsbStage5HomepageErrors.push(String(event.reason || 'unhandled rejection'));
          });
          const observer = new MutationObserver((records) => {
            records.forEach((record) => {
              const wrapper = record.target;
              if (wrapper.classList?.contains('card-loading')) {
                window.__wsbStage5HomepageLoaderMutations.push(
                  wrapper.closest('.chart-container')?.dataset.filename || 'unknown'
                );
              }
            });
          });
          document.querySelectorAll('.chart-wrapper').forEach((wrapper) => {
            observer.observe(wrapper, { attributes: true, attributeFilter: ['class'] });
          });
          window.__wsbStage5HomepageObserver = observer;
          const focusTarget = Array.from(document.querySelectorAll('.chart-container[data-grid-index]'))
            .filter((card) => card.offsetParent !== null)[5];
          focusTarget?.focus();
          window.scrollTo(0, Math.min(240, Math.max(0, document.documentElement.scrollHeight - innerHeight)));
          return {
            frameCount: frames.length,
            allFavorites: document.querySelectorAll('.favorite-star.filled').length >= 12,
            favoritesOnly: Boolean(showFavoritesOnly),
          };
        })()
        """
    )
    if setup != {"frameCount": 12, "allFavorites": True, "favoritesOnly": True}:
        raise AssertionError(f"Could not establish homepage representative state: {setup!r}")
    time.sleep(0.2)
    baseline = homepage_state(cdp)

    expected_order = list(reversed(ALL_FILENAMES))
    if baseline["order"][: len(expected_order)] != expected_order:
        raise AssertionError(
            f"Homepage did not honor custom dashboard order: {baseline['order']!r}"
        )
    if not baseline["focused"]:
        raise AssertionError(f"Could not focus a homepage grid card: {baseline!r}")

    cdp.evaluate(
        r"""
        (() => {
          try {
            window.__wsbStage5HomepageVisibility = 'hidden';
            Object.defineProperty(document, 'visibilityState', {
              configurable: true,
              get: () => window.__wsbStage5HomepageVisibility,
            });
          } catch (_) {}
          document.dispatchEvent(new Event('visibilitychange'));
          window.__wsbStage5HomepageVisibility = 'visible';
          document.dispatchEvent(new Event('visibilitychange'));
          window.dispatchEvent(new Event('focus'));
          window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }));
          window.dispatchEvent(new Event('online'));
          document.querySelectorAll('.dashboard-preview-frame').forEach((frame) => {
            try {
              frame.contentWindow.postMessage({ type: 'wsb-preview-activity', active: false }, location.origin);
              frame.contentWindow.postMessage({ type: 'wsb-preview-activity', active: true }, location.origin);
            } catch (_) {}
          });
          return true;
        })()
        """
    )
    time.sleep(1.0)
    final = homepage_state(cdp)
    cdp.evaluate("window.__wsbStage5HomepageObserver?.disconnect?.(); true")

    for key in (
        "href",
        "navigationCount",
        "order",
        "cssOrder",
        "favorites",
        "favoritesOnly",
        "favoritesToggle",
        "visible",
        "focused",
        "theme",
        "bodyClass",
        "frames",
    ):
        if final[key] != baseline[key]:
            raise AssertionError(
                f"Homepage changed {key} during preview wake: "
                f"before={baseline[key]!r}, after={final[key]!r}"
            )
    if abs(final["scrollY"] - baseline["scrollY"]) > 2:
        raise AssertionError(
            f"Homepage changed scroll during preview wake: {baseline['scrollY']} -> {final['scrollY']}"
        )
    if final["loaderMutations"]:
        raise AssertionError(
            f"Homepage restored routine card loaders: {final['loaderMutations']!r}"
        )
    if final["windowErrors"]:
        raise AssertionError(f"Homepage raised browser errors: {final['windowErrors']!r}")
    bad_frames = [
        frame
        for frame in final["frames"]
        if frame["loadEvents"] or not frame["ready"] or frame["loading"] or frame["childErrors"]
    ]
    if bad_frames:
        raise AssertionError(f"Homepage preview frames were not stable: {bad_frames!r}")


def validate_snapshot(snapshot: dict[str, bytes], targets: set[str]):
    required = set()
    for slug, spec in PERIODIC_PREVIEWS.items():
        if slug in targets or "homepage" in targets:
            required.update(spec["markers"])
            required.update(spec["data"])
    if "patoshi_pattern" in targets or "homepage" in targets:
        required.update(PATOSHI["data"])
    missing = sorted(path for path in required if path not in snapshot)
    if missing:
        raise AssertionError(
            "Stage 5 preview publication artifacts are missing:\n  " + "\n  ".join(missing)
        )


def main():
    chrome_path = Path(CHROME)
    if not chrome_path.is_file():
        raise SystemExit(f"Chrome not found at {CHROME}; set CHROME_BIN")

    known = set(PERIODIC_PREVIEWS) | {"patoshi_pattern", *STATIC_IMAGES, "homepage"}
    requested = sys.argv[1:]
    unknown = set(requested).difference(known)
    if unknown:
        raise SystemExit(f"Unknown Stage 5 target(s): {', '.join(sorted(unknown))}")
    targets = set(requested) if requested else known

    assert_parent_refresh_ownership_removed()
    snapshot = build_data_snapshot()
    validate_snapshot(snapshot, targets)
    SnapshotHandler.snapshot = snapshot

    server_port = free_port()
    debug_port = free_port()
    handler = lambda *args, **kwargs: SnapshotHandler(*args, directory=str(ROOT), **kwargs)
    server = ThreadingHTTPServer(("127.0.0.1", server_port), handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()

    with tempfile.TemporaryDirectory(prefix="wsb-stage5-preview-cdp-") as profile:
        chrome = subprocess.Popen(
            [
                CHROME,
                "--headless=new",
                "--disable-gpu",
                "--remote-allow-origins=*",
                "--window-size=1440,1000",
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
            cdp.command("Network.enable")
            cdp.command(
                "Page.addScriptToEvaluateOnNewDocument",
                {"source": fetch_harness_source()},
            )

            for slug, spec in PERIODIC_PREVIEWS.items():
                if slug not in targets:
                    continue
                print(f"Testing homepage preview refresh: {slug}...", flush=True)
                test_periodic_preview(cdp, server_port, slug, spec)
                test_periodic_cold_recovery(cdp, server_port, slug, spec)
                print(f"Passed: {slug}", flush=True)

            if "patoshi_pattern" in targets:
                print("Testing static data preview: patoshi_pattern...", flush=True)
                test_patoshi(cdp, server_port)
                print("Passed: patoshi_pattern", flush=True)

            for slug, spec in STATIC_IMAGES.items():
                if slug not in targets:
                    continue
                print(f"Testing static image preview: {slug}...", flush=True)
                test_static_image_slow_recovery(cdp, server_port, slug, spec)
                test_static_image_preview(cdp, server_port, slug, spec)
                print(f"Passed: {slug}", flush=True)

            if "homepage" in targets:
                print("Testing homepage preview lifecycle integration...", flush=True)
                test_homepage_integration(cdp, server_port)
                print("Passed: homepage integration", flush=True)
        finally:
            chrome.terminate()
            try:
                chrome.wait(timeout=5)
            except subprocess.TimeoutExpired:
                chrome.kill()
            server.shutdown()


if __name__ == "__main__":
    main()
