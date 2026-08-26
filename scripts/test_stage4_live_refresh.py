#!/usr/bin/env python3
"""Browser regressions for Casascius and Days Since ATH live refresh.

The server snapshot is read-only.  A fetch shim installed before dashboard code
runs synthesizes marker generations and publication races in memory, including
a held pre-commit marker.  Production data files are never rewritten.

Coverage:

* startup installed-signature reconciliation and in-place cold-start recovery;
* hidden state installation followed by one visible presentation;
* rejection of a generation superseded at the shared pre-commit gate;
* no reload, loader flash, visible blanking, or loss of representative state;
* Days Since ATH refresh while a checkbox or SELECT owns focus.

Run both targets, or select one::

    python3 scripts/test_stage4_live_refresh.py
    python3 scripts/test_stage4_live_refresh.py casascius_explorer
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

DASHBOARDS = {
    "casascius_explorer": {
        "path": "webapps/casascius_explorer/dashboard.html",
        "ready": """
          document.querySelector('#leftDataPanel')?.classList.contains('data-ready')
          && document.querySelector('#recentSpendsView .spend-row')
          && document.querySelector('#coinInfoPanel table')
          && window.WSBWebappDataAutoRefresh?.getStatus?.().acceptedSignature !== null
        """,
    },
    "days_since_ath": {
        "path": "webapps/days_since_ath/dashboard.html",
        "ready": """
          document.querySelector('#priceChartLoader')?.classList.contains('hidden')
          && document.querySelector('#daysChartLoader')?.classList.contains('hidden')
          && document.querySelector('#priceCanvas')?.width > 0
          && document.querySelector('#daysCanvas')?.width > 0
          && document.querySelector('#updatedKpi')?.textContent?.trim()
          && document.querySelector('#updatedKpi')?.textContent?.trim() !== 'Load failed'
          && window.WSBWebappDataAutoRefresh?.getStatus?.().acceptedSignature !== null
        """,
    },
}


def build_data_snapshot() -> dict[str, bytes]:
    """Freeze data artifacts so an external dev sync cannot split a test run."""

    snapshot: dict[str, bytes] = {}
    for relative in (
        "assets/daily_price.csv",
        "assets/daily_price_metadata.json",
        "webapps/casascius_explorer/assets/right_panel_data.js",
        "webapps/casascius_explorer/data/casascius_explorer.csv",
        "webapps/casascius_explorer/data/casascius_graded.csv",
        "webapps/casascius_explorer/data/casascius_coin_series_dates_prices.csv",
    ):
        path = ROOT / relative
        if path.is_file():
            snapshot["/" + relative] = path.read_bytes()
    return snapshot


class SnapshotHandler(QuietHandler):
    snapshot: dict[str, bytes] = {}

    def do_GET(self):
        pathname = urllib.parse.unquote(urllib.parse.urlparse(self.path).path)
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


FETCH_HARNESS = r"""
  (() => {
    const nativeFetch = window.fetch.bind(window);
    const pathname = location.pathname;
    const params = new URLSearchParams(location.search);
    const coldStart = params.get('stage4_cold_start') === '1';
    const initialGeneration = Number(params.get('stage4_initial_generation') || '7');
    if (params.get('stage4_reset') === '1') {
      try { localStorage.clear(); } catch (_) {}
    }

    const isCasascius = pathname === '/webapps/casascius_explorer/dashboard.html';
    const isDaysDashboard = pathname === '/webapps/days_since_ath/dashboard.html';
    const isDaysPreview = pathname === '/webapps/days_since_ath/preview.html';
    const isDays = isDaysDashboard || isDaysPreview;
    const casasciusMarkerPath = '/webapps/casascius_explorer/assets/right_panel_data.js';
    const casasciusTrackerPath = '/webapps/casascius_explorer/data/casascius_explorer.csv';
    const daysMarkerPath = '/assets/daily_price_metadata.json';
    const daysDataPath = '/assets/daily_price.csv';
    const markerPath = isCasascius ? casasciusMarkerPath : daysMarkerPath;
    const loadKey = `wsb-stage4-load-count:${pathname}`;
    const loadCount = Number(sessionStorage.getItem(loadKey) || '0') + 1;
    sessionStorage.setItem(loadKey, String(loadCount));
    const nativeTextCache = new Map();
    const generatedTextCache = new Map();

    const test = {
      generation: initialGeneration,
      rightGeneration: initialGeneration,
      priceGeneration: initialGeneration,
      mode: 'pass',
      coldStart,
      coldFailuresRemaining: coldStart ? 4 : 0,
      coldFailures: [],
      previewDataFailuresRemaining: 0,
      priceHydrationFailuresRemaining: 0,
      priceHydrationFailures: [],
      pending: [],
      events: [],
      errors: [],
      markerRequests: [],
      dataRequests: [],
      loaderShows: [],
      blankSamples: [],
      presentation: {
        casascius: 0,
        casaBalanceThumb: 0,
        casaPriceThumb: 0,
        casaFullChart: 0,
        preview: 0,
        price: 0,
        days: 0,
      },
      monitorTimer: 0,
      monitorObserver: null,
      loadCount,
      setGeneration(value, mode = 'pass') {
        if (this.pending.length) throw new Error('A Stage 4 publication is still held.');
        this.generation = Number(value);
        this.rightGeneration = Number(value);
        this.priceGeneration = Number(value);
        this.mode = mode;
      },
      setPriceGeneration(value, mode = 'pass') {
        if (this.pending.length) throw new Error('A Stage 4 publication is still held.');
        this.generation = Number(value);
        this.priceGeneration = Number(value);
        this.mode = mode;
      },
      releaseAll() {
        const releases = this.pending.splice(0);
        releases.forEach((release) => release());
        return releases.length;
      },
    };
    window.__wsbStage4RefreshTest = test;

    const originalFillRect = CanvasRenderingContext2D.prototype.fillRect;
    CanvasRenderingContext2D.prototype.fillRect = function (...args) {
      if (this.canvas?.id === 'priceCanvas' && Number(args[0]) === 0 && Number(args[1]) === 0) {
        test.presentation.price += 1;
      } else if (this.canvas?.id === 'daysCanvas' && Number(args[0]) === 0 && Number(args[1]) === 0) {
        test.presentation.days += 1;
      } else if (this.canvas?.id === 'daysSinceAthPreview' && Number(args[0]) === 0 && Number(args[1]) === 0) {
        test.presentation.preview += 1;
      }
      return originalFillRect.apply(this, args);
    };
    const originalClearRect = CanvasRenderingContext2D.prototype.clearRect;
    CanvasRenderingContext2D.prototype.clearRect = function (...args) {
      if (Number(args[0]) === 0 && Number(args[1]) === 0) {
        if (this.canvas?.classList?.contains('balance-chart-canvas')) {
          test.presentation.casaBalanceThumb += 1;
        } else if (this.canvas?.classList?.contains('selected-price-chart-canvas')) {
          test.presentation.casaPriceThumb += 1;
        } else if (this.canvas?.classList?.contains('balance-chart-full-canvas')) {
          test.presentation.casaFullChart += 1;
        }
      }
      return originalClearRect.apply(this, args);
    };

    const generationsFromSignature = (value) => {
      const text = String(value || '');
      const right = text.match(/stage4Generation\"?\s*:\s*(\d+)/i);
      const price = text.match(/stage4_generation\"?\s*:\s*(\d+)/i);
      const rightGeneration = right ? Number(right[1]) : 0;
      const priceGeneration = price ? Number(price[1]) : 0;
      return {
        rightGeneration,
        priceGeneration,
        generation: Math.max(rightGeneration, priceGeneration),
      };
    };
    window.addEventListener('wsb:data-refresh-status', (event) => {
      const detail = event.detail || {};
      const generations = generationsFromSignature(detail.signature);
      test.events.push({
        status: String(detail.status || ''),
        ...generations,
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
    const textResponse = (text, response = null, contentType = 'text/plain; charset=utf-8') => {
      const headers = new Headers(response?.headers || {});
      headers.delete('content-length');
      headers.delete('content-encoding');
      headers.set('cache-control', 'no-store');
      headers.set('content-type', contentType);
      return new Response(text, {
        status: response?.status || 200,
        statusText: response?.statusText || 'OK',
        headers,
      });
    };
    const nativeText = async (url) => {
      const key = new URL(url, location.href).pathname;
      if (!nativeTextCache.has(key)) {
        nativeTextCache.set(key, (async () => {
          const response = await nativeFetch(new URL(key, location.origin).href, { cache: 'no-store' });
          if (!response.ok) throw new Error(`Unable to stage ${key} (${response.status})`);
          return response.text();
        })());
      }
      return nativeTextCache.get(key);
    };
    const casasciusMarker = async (generation) => {
      const key = `casascius:${Number(generation)}`;
      if (!generatedTextCache.has(key)) {
        generatedTextCache.set(key, (async () => {
          const raw = (await nativeText(casasciusMarkerPath)).trim();
          const prefix = 'window.CASASCIUS_RIGHT_PANEL_DATA = ';
          const payload = JSON.parse(raw.slice(prefix.length, -1));
          payload.publication.stage4Generation = Number(generation);
          return `${prefix}${JSON.stringify(payload)};`;
        })());
      }
      return generatedTextCache.get(key);
    };
    const daysRevision = (generation) => ({ 7: 1, 1: 2, 2: 3, 3: 4, 4: 5, 5: 6 })[generation]
      || Math.max(1, Number(generation) + 10);
    const daysData = async (generation) => {
      const numericGeneration = Number(generation);
      const key = `days:${numericGeneration}`;
      if (!generatedTextCache.has(key)) {
        generatedTextCache.set(key, (async () => {
          const raw = await nativeText(daysDataPath);
          if (numericGeneration === 0) return raw;
          const hadNewline = raw.endsWith('\n');
          const lines = raw.trimEnd().split(/\r?\n/);
          const headers = lines[0].split(',');
          const cells = lines.at(-1).split(',');
          const revision = daysRevision(numericGeneration);
          const indexOf = (name) => headers.indexOf(name);
          const dateIndex = indexOf('date');
          const timestampIndex = indexOf('timestamp');
          const priceIndex = indexOf('price');
          const highIndex = indexOf('daily_high');
          const heightIndex = indexOf('block_height');
          const isoDate = String(cells[timestampIndex] || '').slice(0, 10);
          if (!isoDate || !cells[dateIndex]) throw new Error('Days fixture has no latest date.');
          cells[timestampIndex] = `${isoDate} 23:${String(revision).padStart(2, '0')}:00`;
          cells[priceIndex] = String(Number(cells[priceIndex]) + revision);
          cells[highIndex] = String(Number(cells[highIndex]) + revision);
          cells[heightIndex] = String(Number(cells[heightIndex]) + revision);
          lines[lines.length - 1] = cells.join(',');
          return lines.join('\n') + (hadNewline ? '\n' : '');
        })());
      }
      return generatedTextCache.get(key);
    };

    const sha256Text = async (value) => {
      const bytes = new TextEncoder().encode(String(value));
      const digest = await crypto.subtle.digest('SHA-256', bytes);
      return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
    };
    const daysMarker = async (generation) => {
      const numericGeneration = Number(generation);
      const key = `days-marker:${numericGeneration}`;
      if (!generatedTextCache.has(key)) {
        generatedTextCache.set(key, (async () => {
          const payload = JSON.parse(await nativeText(daysMarkerPath));
          const csvText = await daysData(numericGeneration);
          const lines = csvText.trimEnd().split(/\r?\n/);
          const headers = lines[0].split(',');
          const cells = lines.at(-1).split(',');
          const indexOf = (name) => headers.indexOf(name);
          payload.artifact.sha256 = await sha256Text(csvText);
          payload.artifact.rows = lines.length - 1;
          payload.latest_timestamp = String(cells[indexOf('timestamp')] || '');
          payload.latest_date = payload.latest_timestamp.slice(0, 10);
          payload.latest_block_height = Number(cells[indexOf('block_height')]);
          payload.stage4_generation = numericGeneration;
          return JSON.stringify(payload);
        })());
      }
      return generatedTextCache.get(key);
    };

    const markerText = async (generation, markerKind) => (
      markerKind === 'right'
        ? casasciusMarker(generation)
        : daysMarker(generation)
    );
    const markerResponse = async (input, init, generation, phase, markerKind) => {
      const nativeResponse = await nativeFetch(input, init);
      if (!nativeResponse.ok) return nativeResponse;
      test.markerRequests.push({ generation: Number(generation), phase, markerKind });
      return textResponse(
        await markerText(generation, markerKind),
        nativeResponse,
        markerKind === 'right' ? 'application/javascript; charset=utf-8' : 'application/json; charset=utf-8',
      );
    };

    window.fetch = async (input, init) => {
      const raw = typeof input === 'string' ? input : input?.url;
      const url = new URL(raw, location.href);
      const refreshValue = url.searchParams.get('wsb_refresh') || '';
      const previewRefreshValue = url.searchParams.get('wsb_preview_refresh') || '';
      const priceHydrationValue = url.searchParams.get('wsb_price') || '';
      const phase = phaseFor(refreshValue);
      const isRightMarker = isCasascius && url.pathname === casasciusMarkerPath;
      const isPriceMarker = url.pathname === daysMarkerPath;
      const markerKind = isRightMarker ? 'right' : 'price';
      const markerGeneration = markerKind === 'right'
        ? Number(test.rightGeneration)
        : Number(test.priceGeneration);
      const isSharedMarker = (isRightMarker || isPriceMarker) && !!phase;
      const isInitialCasasciusMarker = isCasascius
        && url.pathname === markerPath
        && url.searchParams.has('wsb_initial');
      const isInitialDaysMarker = isDays && url.pathname === markerPath && !refreshValue;

      if (isDaysPreview && isPriceMarker && previewRefreshValue) {
        return markerResponse(input, init, Number(test.priceGeneration), 'preview', 'price');
      }
      if (isCasascius && isPriceMarker && priceHydrationValue) {
        return markerResponse(input, init, Number(test.priceGeneration), 'hydration', 'price');
      }

      if (isSharedMarker && phase === 'pre-commit' && test.mode === 'hold-precommit') {
        return new Promise((resolve, reject) => {
          test.pending.push(() => markerResponse(
            input,
            init,
            markerKind === 'right' ? Number(test.rightGeneration) : Number(test.priceGeneration),
            phase,
            markerKind,
          ).then(resolve, reject));
        });
      }
      if (isSharedMarker) {
        return markerResponse(input, init, markerGeneration, phase, markerKind);
      }
      if (isInitialCasasciusMarker || isInitialDaysMarker) {
        return markerResponse(input, init, 0, 'initial', markerKind);
      }

      const isInitialCasasciusData = isCasascius
        && url.pathname === casasciusTrackerPath
        && url.searchParams.has('wsb_initial');
      const isInitialDaysData = isDays && url.pathname === daysDataPath && !refreshValue;
      if (isDaysPreview && url.pathname === daysDataPath && previewRefreshValue) {
        test.dataRequests.push({
          generation: Number(test.priceGeneration),
          pathname: url.pathname,
          phase: 'preview',
        });
        if (test.previewDataFailuresRemaining > 0) {
          test.previewDataFailuresRemaining -= 1;
          return new Response('Injected Stage 4 preview failure', { status: 503 });
        }
        return textResponse(
          await daysData(Number(test.priceGeneration)),
          null,
          'text/csv; charset=utf-8',
        );
      }
      if (isCasascius && url.pathname === daysDataPath && priceHydrationValue) {
        test.dataRequests.push({
          generation: Number(test.priceGeneration),
          pathname: url.pathname,
          phase: 'hydration',
        });
        if (test.priceHydrationFailuresRemaining > 0) {
          test.priceHydrationFailuresRemaining -= 1;
          test.priceHydrationFailures.push(Number(test.priceGeneration));
          return new Response('Injected Stage 4 Casascius price failure', { status: 503 });
        }
        return textResponse(
          await daysData(Number(test.priceGeneration)),
          null,
          'text/csv; charset=utf-8',
        );
      }
      if ((isInitialCasasciusData || isInitialDaysData) && test.coldFailuresRemaining > 0) {
        test.coldFailuresRemaining -= 1;
        test.coldFailures.push(url.pathname);
        return new Response('Injected Stage 4 cold-start failure', { status: 503 });
      }
      if (isInitialCasasciusData) {
        test.dataRequests.push({ generation: 0, pathname: url.pathname, phase: 'initial' });
        return textResponse(await nativeText(casasciusTrackerPath), null, 'text/csv; charset=utf-8');
      }
      if (isInitialDaysData) {
        test.dataRequests.push({ generation: 0, pathname: url.pathname, phase: 'initial' });
        return textResponse(await daysData(0), null, 'text/csv; charset=utf-8');
      }
      if (refreshValue.includes('-data-') && url.pathname === casasciusTrackerPath) {
        test.dataRequests.push({ generation: Number(test.rightGeneration), pathname: url.pathname, phase: 'candidate' });
        return textResponse(await nativeText(casasciusTrackerPath), null, 'text/csv; charset=utf-8');
      }
      if (refreshValue.includes('-data-') && url.pathname === daysDataPath) {
        test.dataRequests.push({ generation: Number(test.priceGeneration), pathname: url.pathname, phase: 'candidate' });
        return textResponse(await daysData(Number(test.priceGeneration)), null, 'text/csv; charset=utf-8');
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
    const sample = () => {
      const loaderSelectors = isCasascius
        ? ['#stageLoadingRing']
        : ['#priceChartLoader', '#daysChartLoader'];
      loaderSelectors.forEach((selector) => {
        if (isVisible(document.querySelector(selector)) && !test.loaderShows.includes(selector)) {
          test.loaderShows.push(selector);
        }
      });
      if (isCasascius) {
        for (const selector of ['#recentSpendsView', '#activeCoinsView', '#coinInfoPanel']) {
          const element = document.querySelector(selector);
          const text = element?.textContent?.trim() || '';
          if ((!element?.childElementCount || text === 'Loading…' || text === 'Loading...')
              && !test.blankSamples.includes(selector)) test.blankSamples.push(selector);
        }
      } else {
        for (const selector of ['#priceCanvas', '#daysCanvas']) {
          const canvas = document.querySelector(selector);
          if ((!canvas || canvas.width <= 0 || canvas.height <= 0)
              && !test.blankSamples.includes(selector)) test.blankSamples.push(selector);
        }
      }
    };
    test.startMonitor = () => {
      test.loaderShows = [];
      test.blankSamples = [];
      const coinPanel = document.querySelector('#coinInfoPanel');
      if (coinPanel) {
        test.monitorObserver = new MutationObserver((records) => {
          if (records.some((record) => record.type === 'childList')) test.presentation.casascius += 1;
          sample();
        });
        test.monitorObserver.observe(coinPanel, { subtree: true, childList: true, characterData: true });
      } else {
        test.monitorObserver = new MutationObserver(sample);
        test.monitorObserver.observe(document.body, { subtree: true, childList: true, attributes: true });
      }
      sample();
      test.monitorTimer = setInterval(sample, 15);
    };
    test.resetPresentation = () => {
      test.presentation = {
        casascius: 0,
        casaBalanceThumb: 0,
        casaPriceThumb: 0,
        casaFullChart: 0,
        preview: 0,
        price: 0,
        days: 0,
      };
      return { ...test.presentation };
    };
    test.stopMonitor = () => {
      if (test.monitorTimer) clearInterval(test.monitorTimer);
      test.monitorTimer = 0;
      test.monitorObserver?.disconnect();
      test.monitorObserver = null;
    };
  })();
"""


def wait_for_generation_event(
    cdp: CdpSocket,
    status: str,
    generation: int,
    *,
    timeout: int = 120,
):
    return wait_for(
        lambda: cdp.evaluate(
            "window.__wsbStage4RefreshTest?.events.some((event) => "
            f"event.status === {json.dumps(status)} && event.generation === {generation})"
        ),
        timeout=timeout,
        description=f"{status} event for generation {generation}",
    )


def capture_state(cdp: CdpSocket, slug: str):
    if slug == "days_since_ath":
        return cdp.evaluate(
            """
              ({
                start: document.querySelector('#startDateInput')?.value || '',
                end: document.querySelector('#endDateInput')?.value || '',
                startSlider: document.querySelector('#dateRangeStartSlider')?.value || '',
                endSlider: document.querySelector('#dateRangeEndSlider')?.value || '',
                priceScale: document.querySelector('#priceScaleButtons .is-active')?.dataset.priceScale || '',
                daysScale: document.querySelector('#daysScaleButtons .is-active')?.dataset.daysScale || '',
                labels: !!document.querySelector('#toggleAthLabels')?.checked,
                markers: !!document.querySelector('#toggleAthMarkers')?.checked,
                halvings: !!document.querySelector('#toggleHalvings')?.checked,
                chartMode: document.querySelector('#chartGrid')?.className || '',
                playing: !!document.querySelector('#playBtn')?.classList.contains('is-playing'),
                expanded: document.body.classList.contains('days-since-ath-dashboard-expanded'),
              })
            """
        )
    return cdp.evaluate(
        """
          (() => {
            const modalCanvas = document.querySelector('.balance-chart-modal.open .balance-chart-full-canvas');
            if (modalCanvas) window.__wsbStage4ChartAnchor = modalCanvas;
            return {
              activeSlug: localStorage.getItem('casasciusSpinnerActiveSlug') || '',
              allWindow: localStorage.getItem('casasciusSpinnerAllItemsWindow') || '',
              selectedRecent: document.querySelector('#recentSpendsView .spend-row-selected')?.dataset.address || '',
              selectedActive: document.querySelector('#activeCoinsView .spend-row-selected')?.dataset.address || '',
              selectedGraded: document.querySelector('#gradedCoinsView .spend-row-selected')?.dataset.address || '',
              scrollTop: Math.round(document.querySelector('#recentSpendsPanel')?.scrollTop || 0),
              zoom: document.querySelector('#zoom')?.value || '',
              speed: document.querySelector('#speed')?.value || '',
              running: !!document.querySelector('#toggle')?.classList.contains('is-running'),
              viewMode: document.querySelector('#app')?.classList.contains('all-items-mode') ? 'all' : 'single',
              leftMode: document.querySelector('#leftPanelTitle')?.textContent?.trim() || '',
              chartOpen: !!document.querySelector('.balance-chart-modal')?.classList.contains('open'),
              chartUnit: document.querySelector('[data-balance-chart-unit][aria-pressed="true"]')?.dataset.balanceChartUnit || '',
              chartSame: !window.__wsbStage4ChartAnchor
                || window.__wsbStage4ChartAnchor === document.querySelector('.balance-chart-modal.open .balance-chart-full-canvas'),
            };
          })()
        """
    )


def set_representative_state(cdp: CdpSocket, slug: str):
    if slug == "days_since_ath":
        cdp.evaluate(
            """
              (() => {
                const start = document.querySelector('#dateRangeStartSlider');
                const end = document.querySelector('#dateRangeEndSlider');
                const max = Number(end.max || start.max || 0);
                start.value = String(Math.round(max * 0.31));
                start.dispatchEvent(new Event('input', { bubbles: true }));
                end.value = String(Math.round(max * 0.69));
                end.dispatchEvent(new Event('input', { bubbles: true }));
                const labels = document.querySelector('#toggleAthLabels');
                labels.checked = false;
                labels.dispatchEvent(new Event('change', { bubbles: true }));
                document.querySelector('[data-price-scale="linear"]')?.click();
                document.querySelector('[data-days-scale="log"]')?.click();
                document.activeElement?.blur?.();
              })()
            """
        )
    else:
        cdp.evaluate(
            """
              (() => {
                const running = document.querySelector('#toggle')?.classList.contains('is-running');
                if (running) document.querySelector('#toggle')?.click();
                document.querySelector(
                  '.coin-tab[data-repeat="1"][data-group-key="coin:1000"]'
                )?.click();
              })()
            """
        )
        wait_for(
            lambda: cdp.evaluate(
                "!document.querySelector('#app')?.classList.contains('all-items-mode') "
                "&& !!document.querySelector('.version-tab.active') "
                "&& document.querySelector('#leftDataPanel')?.classList.contains('data-ready') "
                "&& !!document.querySelector('#coinInfoPanel .balance-chart-canvas')"
            ),
            timeout=60,
            description="Casascius single-coin representative state",
        )
        cdp.evaluate(
            """
              (() => {
                const rows = [...document.querySelectorAll('#recentSpendsView .spend-row')];
                (rows[Math.min(8, rows.length - 1)] || rows[0])?.click();
                const zoom = document.querySelector('#zoom');
                zoom.value = '125';
                zoom.dispatchEvent(new Event('input', { bubbles: true }));
                zoom.dispatchEvent(new Event('change', { bubbles: true }));
              })()
            """
        )
        time.sleep(0.8)
        cdp.evaluate(
            """
              (() => {
                document.querySelector('#coinInfoPanel [data-balance-chart-open]')?.click();
                const panel = document.querySelector('#recentSpendsPanel');
                if (panel) {
                  panel.scrollTop = Math.min(panel.scrollHeight - panel.clientHeight, 96);
                  panel.dispatchEvent(new Event('scroll'));
                }
                const full = document.querySelector('.balance-chart-full-canvas');
                const thumb = document.querySelector('.balance-chart-canvas');
                window.__wsbStage4FailedHydrationBaseline = {
                  full,
                  thumb,
                  fullPixels: full?.toDataURL() || '',
                  thumbPixels: thumb?.toDataURL() || '',
                };
                window.__wsbStage4RefreshTest.priceHydrationFailuresRemaining = 4;
                document.querySelector('[data-balance-chart-unit="usd"]')?.click();
                document.activeElement?.blur?.();
              })()
            """
        )
        wait_for(
            lambda: cdp.evaluate(
                "window.__wsbStage4RefreshTest.priceHydrationFailures.length === 4"
            ),
            timeout=30,
            description="Casascius failed lazy daily-price hydration",
        )
        time.sleep(0.25)
        failed_hydration = cdp.evaluate(
            """
              (() => {
                const baseline = window.__wsbStage4FailedHydrationBaseline;
                const full = document.querySelector('.balance-chart-full-canvas');
                const thumb = document.querySelector('.balance-chart-canvas');
                return {
                  responsive: true,
                  activeUnit: document.querySelector(
                    '[data-balance-chart-unit][aria-pressed="true"]'
                  )?.dataset.balanceChartUnit || '',
                  fullSame: baseline?.full === full,
                  thumbSame: baseline?.thumb === thumb,
                  fullPixelsSame: baseline?.fullPixels === (full?.toDataURL() || ''),
                  thumbPixelsSame: baseline?.thumbPixels === (thumb?.toDataURL() || ''),
                  fullMetaUnit: full?._balanceChartMeta?.unit || '',
                  thumbMetaUnit: thumb?._balanceChartMeta?.unit || '',
                };
              })()
            """
        )
        expected_failure_state = {
            "responsive": True,
            "activeUnit": "usd",
            "fullSame": True,
            "thumbSame": True,
            "fullPixelsSame": True,
            "thumbPixelsSame": True,
            "fullMetaUnit": "btc",
            "thumbMetaUnit": "btc",
        }
        if failed_hydration != expected_failure_state:
            raise AssertionError(
                "Casascius lazy price failure disturbed or blanked the prior chart: "
                f"{failed_hydration!r}"
            )
        cdp.evaluate(
            "document.querySelector('[data-balance-chart-unit=\"btc\"]')?.click(); true"
        )
        time.sleep(0.15)
        cdp.evaluate(
            "document.querySelector('[data-balance-chart-unit=\"usd\"]')?.click(); true"
        )
        # Hashing the lazy price CSV and drawing the first USD surface can keep
        # the headless renderer busy long enough to exceed a single CDP socket
        # read. Let that one-time task settle before polling, so the protocol
        # stream cannot be desynchronized by an expected busy-frame timeout.
        time.sleep(20)
        try:
            wait_for(
                lambda: cdp.evaluate(
                    "document.querySelector('.balance-chart-full-canvas')?._balanceChartMeta?.unit === 'usd' "
                    "&& document.querySelector('.balance-chart-canvas')?._balanceChartMeta?.unit === 'usd'"
                ),
                timeout=30,
                description="Casascius lazy daily-price hydration",
            )
        except TimeoutError as exc:
            diagnostic = cdp.evaluate(
                "({ button: !!document.querySelector('#coinInfoPanel [data-balance-chart-open]'), "
                "modalOpen: document.querySelector('.balance-chart-modal')?.classList.contains('open'), "
                "activeUnit: document.querySelector('[data-balance-chart-unit][aria-pressed=\"true\"]')?.dataset.balanceChartUnit, "
                "fullUnit: document.querySelector('.balance-chart-full-canvas')?._balanceChartMeta?.unit || '', "
                "thumbUnit: document.querySelector('.balance-chart-canvas')?._balanceChartMeta?.unit || '', "
                "fullMeta: !!document.querySelector('.balance-chart-full-canvas')?._balanceChartMeta, "
                "thumbMeta: !!document.querySelector('.balance-chart-canvas')?._balanceChartMeta, "
                "errors: [...window.__wsbStage4RefreshTest.errors], "
                "events: [...window.__wsbStage4RefreshTest.events], "
                "markers: [...window.__wsbStage4RefreshTest.markerRequests], "
                "data: [...window.__wsbStage4RefreshTest.dataRequests] })"
            )
            raise AssertionError(
                f"Casascius lazy daily-price hydration failed: {diagnostic!r}"
            ) from exc
    time.sleep(0.65)


def assert_state_preserved(cdp: CdpSocket, slug: str, expected: dict, stage: str):
    actual = capture_state(cdp, slug)
    if slug == "casascius_explorer":
        if abs(actual["scrollTop"] - expected["scrollTop"]) <= 2:
            actual["scrollTop"] = expected["scrollTop"]
        # The identity bit is the assertion; it is initially true by definition.
        expected = {**expected, "chartSame": True}
    if actual != expected:
        raise AssertionError(
            f"{slug} state changed during {stage}: expected={expected!r}, actual={actual!r}"
        )


def presentation_counts(cdp: CdpSocket):
    return cdp.evaluate("({ ...window.__wsbStage4RefreshTest.presentation })")


def assert_no_presentation(slug: str, counts: dict, stage: str):
    relevant = (
        [
            counts["casascius"],
            counts["casaBalanceThumb"],
            counts["casaPriceThumb"],
            counts["casaFullChart"],
        ]
        if slug == "casascius_explorer"
        else [counts["price"], counts["days"]]
    )
    if any(value != 0 for value in relevant):
        raise AssertionError(f"{slug} presented during {stage}: {counts!r}")


def wait_for_one_presentation(cdp: CdpSocket, slug: str, stage: str, *, kind: str = "tracker"):
    if slug == "casascius_explorer":
        if kind == "price":
            wait_for(
                lambda: (
                    presentation_counts(cdp)["casaBalanceThumb"] >= 1
                    and presentation_counts(cdp)["casaFullChart"] >= 1
                ),
                timeout=60,
                description=f"{slug} {stage} price presentation",
            )
        else:
            wait_for(
                lambda: presentation_counts(cdp)["casascius"] >= 1,
                timeout=60,
                description=f"{slug} {stage} tracker presentation",
            )
    else:
        wait_for(
            lambda: (
                presentation_counts(cdp)["price"] >= 1
                and presentation_counts(cdp)["days"] >= 1
            ),
            timeout=60,
            description=f"{slug} {stage} presentation",
        )
    time.sleep(0.45)
    counts = presentation_counts(cdp)
    if slug == "casascius_explorer" and kind == "price":
        relevant = [counts["casaBalanceThumb"], counts["casaFullChart"]]
        if counts["casascius"] != 0:
            raise AssertionError(f"{slug} rebuilt tracker panels during {stage}: {counts!r}")
    elif slug == "casascius_explorer":
        relevant = [counts["casascius"]]
    else:
        relevant = [counts["price"], counts["days"]]
    if any(value != 1 for value in relevant):
        raise AssertionError(f"{slug} did not present {stage} exactly once: {counts!r}")


def test_focused_days_control(cdp: CdpSocket, selector: str, generation: int):
    if selector == "#updatedTimeZoneSelect":
        cdp.evaluate(
            """
              (() => {
                const style = document.createElement('style');
                style.id = 'stage4-select-focus-style';
                style.textContent = '#updatedTimeZoneSelect{display:block!important;position:fixed!important;left:-9999px!important}';
                document.head.appendChild(style);
              })()
            """
        )
    focused = cdp.evaluate(
        f"(() => {{ const element = document.querySelector({json.dumps(selector)}); element?.focus(); return document.activeElement === element; }})()"
    )
    if not focused:
        raise AssertionError(f"Days Since ATH could not focus {selector}")
    cdp.evaluate(
        f"window.__wsbStage4RefreshTest.resetPresentation(); "
        f"window.__wsbStage4RefreshTest.setGeneration({generation}); "
        f"window.WSBWebappDataAutoRefresh.requestCheck('stage4-focused-control'); true"
    )
    wait_for_generation_event(cdp, "applied", generation)
    wait_for_one_presentation(cdp, "days_since_ath", f"focused {selector}")
    if cdp.evaluate(f"document.activeElement !== document.querySelector({json.dumps(selector)})"):
        raise AssertionError(f"Days Since ATH refresh displaced focus from {selector}")
    cdp.evaluate("document.activeElement?.blur?.(); document.querySelector('#stage4-select-focus-style')?.remove(); true")


def test_days_playback_deferral(cdp: CdpSocket, generation: int):
    cdp.evaluate("document.querySelector('#playBtn')?.click(); true")
    wait_for(
        lambda: cdp.evaluate("document.querySelector('#playBtn')?.classList.contains('is-playing')"),
        timeout=15,
        description="Days Since ATH playback start",
    )
    cdp.evaluate(
        f"window.__wsbStage4RefreshTest.setGeneration({generation}); "
        "window.WSBWebappDataAutoRefresh.requestCheck('stage4-active-playback'); true"
    )
    wait_for_generation_event(cdp, "deferred", generation, timeout=150)
    if not cdp.evaluate("document.querySelector('#playBtn')?.classList.contains('is-playing')"):
        raise AssertionError("Days Since ATH refresh interrupted active playback")

    cdp.evaluate("document.querySelector('#pauseBtn')?.click(); true")
    wait_for(
        lambda: cdp.evaluate("!document.querySelector('#playBtn')?.classList.contains('is-playing')"),
        timeout=15,
        description="Days Since ATH playback pause",
    )
    time.sleep(0.15)
    paused_state = capture_state(cdp, "days_since_ath")
    cdp.evaluate(
        "window.__wsbStage4RefreshTest.resetPresentation(); "
        "window.WSBWebappDataAutoRefresh.requestCheck('stage4-paused-playback-retry'); true"
    )
    wait_for_generation_event(cdp, "applied", generation, timeout=150)
    wait_for_one_presentation(cdp, "days_since_ath", "paused playback retry")
    assert_state_preserved(
        cdp,
        "days_since_ath",
        paused_state,
        "paused playback generation apply",
    )
    return paused_state


def test_dashboard(cdp: CdpSocket, server_port: int, slug: str, spec: dict):
    url = (
        f"http://127.0.0.1:{server_port}/{spec['path']}"
        "?stage4_refresh_test=1&stage4_initial_generation=7&stage4_reset=1"
    )
    cdp.command("Page.navigate", {"url": url})
    wait_for(
        lambda: cdp.evaluate(f"Boolean(window.__wsbStage4RefreshTest && ({spec['ready']}))"),
        timeout=150,
        description=f"complete initial {slug} dashboard",
    )
    wait_for_generation_event(cdp, "applied", 7, timeout=150)
    time.sleep(0.65)

    set_representative_state(cdp, slug)
    expected_state = capture_state(cdp, slug)
    baseline = cdp.evaluate(
        """
          (() => {
            const test = window.__wsbStage4RefreshTest;
            test.startMonitor();
            test.resetPresentation();
            return {
              loadCount: test.loadCount,
              storedLoadCount: Number(sessionStorage.getItem(`wsb-stage4-load-count:${location.pathname}`) || '0'),
              navigationCount: performance.getEntriesByType('navigation').length,
              href: location.href,
            };
          })()
        """
    )

    visibility_override = cdp.evaluate(
        """
          (() => {
            try {
              window.__wsbStage4Visibility = 'hidden';
              Object.defineProperty(document, 'visibilityState', {
                configurable: true,
                get: () => window.__wsbStage4Visibility,
              });
              document.dispatchEvent(new Event('visibilitychange'));
              return document.visibilityState === 'hidden';
            } catch (_) { return false; }
          })()
        """
    )
    if not visibility_override:
        raise AssertionError(f"Could not install hidden-document override for {slug}")

    hidden_generation = 8 if slug == "casascius_explorer" else 1
    if slug == "casascius_explorer":
        cdp.evaluate(
            f"window.__wsbStage4RefreshTest.setPriceGeneration({hidden_generation}); "
            "window.WSBWebappDataAutoRefresh.requestCheck('stage4-hidden-price-only'); true"
        )
    else:
        cdp.evaluate(
            f"window.__wsbStage4RefreshTest.setGeneration({hidden_generation}); "
            "window.WSBWebappDataAutoRefresh.requestCheck('stage4-hidden'); true"
        )
    wait_for_generation_event(cdp, "applied", hidden_generation, timeout=150)
    time.sleep(0.35)
    assert_state_preserved(cdp, slug, expected_state, "hidden generation install")
    assert_no_presentation(slug, presentation_counts(cdp), "hidden generation install")

    cdp.evaluate(
        "window.__wsbStage4Visibility = 'visible'; "
        "document.dispatchEvent(new Event('visibilitychange')); true"
    )
    wait_for_one_presentation(
        cdp,
        slug,
        "visible catch-up",
        kind="price" if slug == "casascius_explorer" else "tracker",
    )
    assert_state_preserved(cdp, slug, expected_state, "visible catch-up")
    if slug == "casascius_explorer":
        price_only_requests = cdp.evaluate(
            f"window.__wsbStage4RefreshTest.dataRequests.filter((request) => request.generation === {hidden_generation})"
        )
        tracker_path = "/webapps/casascius_explorer/data/casascius_explorer.csv"
        price_path = "/assets/daily_price.csv"
        if any(request["pathname"] == tracker_path for request in price_only_requests):
            raise AssertionError(
                "Casascius price-only refresh fetched the 5.3 MB tracker: "
                f"{price_only_requests!r}"
            )
        if sum(request["pathname"] == price_path for request in price_only_requests) != 1:
            raise AssertionError(
                "Casascius price-only refresh did not fetch exactly one daily-price candidate: "
                f"{price_only_requests!r}"
            )

    cdp.evaluate("window.__wsbStage4RefreshTest.resetPresentation()")
    superseded_generation = 9 if slug == "casascius_explorer" else 2
    recovery_generation = 10 if slug == "casascius_explorer" else 3
    cdp.evaluate(
        f"window.__wsbStage4RefreshTest.setGeneration({superseded_generation}, 'hold-precommit'); "
        "window.WSBWebappDataAutoRefresh.requestCheck('stage4-superseded'); true"
    )
    wait_for(
        lambda: cdp.evaluate("window.__wsbStage4RefreshTest.pending.length > 0"),
        timeout=150,
        description=f"held {slug} generation-{superseded_generation} pre-commit marker",
    )
    released = cdp.evaluate(
        f"window.__wsbStage4RefreshTest.generation = {recovery_generation}; "
        f"window.__wsbStage4RefreshTest.rightGeneration = {recovery_generation}; "
        f"window.__wsbStage4RefreshTest.priceGeneration = {recovery_generation}; "
        "window.__wsbStage4RefreshTest.mode = 'pass'; "
        "window.__wsbStage4RefreshTest.releaseAll()"
    )
    if released < 1:
        raise AssertionError(
            f"Expected held generation-{superseded_generation} pre-commit for {slug}"
        )
    wait_for_generation_event(cdp, "deferred", superseded_generation, timeout=150)
    wait_for_generation_event(cdp, "applied", recovery_generation, timeout=150)
    wait_for_one_presentation(cdp, slug, "superseded-generation recovery")
    assert_state_preserved(cdp, slug, expected_state, "superseded-generation recovery")

    if slug == "days_since_ath":
        expected_state = test_days_playback_deferral(cdp, 4)
        test_focused_days_control(cdp, "#toggleAthLabels", 5)
        assert_state_preserved(cdp, slug, expected_state, "checkbox-focused refresh")
        test_focused_days_control(cdp, "#updatedTimeZoneSelect", 6)
        assert_state_preserved(cdp, slug, expected_state, "SELECT-focused refresh")

    result = cdp.evaluate(
        """
          (() => {
            const test = window.__wsbStage4RefreshTest;
            test.stopMonitor();
            return {
              loadCount: test.loadCount,
              storedLoadCount: Number(sessionStorage.getItem(`wsb-stage4-load-count:${location.pathname}`) || '0'),
              navigationCount: performance.getEntriesByType('navigation').length,
              href: location.href,
              loaderShows: [...test.loaderShows],
              blankSamples: [...test.blankSamples],
              errors: [...test.errors],
              applied: test.events.filter((event) => event.status === 'applied').map((event) => event.generation),
              deferred: test.events.filter((event) => event.status === 'deferred').map((event) => event.generation),
              markerRequests: [...test.markerRequests],
              dataRequests: [...test.dataRequests],
            };
          })()
        """
    )
    if (
        result["loadCount"] != baseline["loadCount"]
        or result["storedLoadCount"] != baseline["storedLoadCount"]
        or result["navigationCount"] != baseline["navigationCount"]
        or result["href"] != baseline["href"]
    ):
        raise AssertionError(f"{slug} navigated/reloaded during live refresh: {result!r}")
    if result["loaderShows"]:
        raise AssertionError(f"{slug} showed a routine refresh loader: {result['loaderShows']!r}")
    if result["blankSamples"]:
        raise AssertionError(f"{slug} blanked visible content: {result['blankSamples']!r}")
    if result["errors"]:
        raise AssertionError(f"{slug} raised browser errors: {result['errors']!r}")
    expected_applied = (7, hidden_generation, recovery_generation)
    if not all(generation in result["applied"] for generation in expected_applied):
        raise AssertionError(f"{slug} did not apply all complete generations: {result!r}")
    if (
        superseded_generation in result["applied"]
        or superseded_generation not in result["deferred"]
    ):
        raise AssertionError(f"{slug} committed a superseded candidate: {result!r}")


def test_cold_start_recovery(cdp: CdpSocket, server_port: int, slug: str, spec: dict):
    url = (
        f"http://127.0.0.1:{server_port}/{spec['path']}"
        "?stage4_refresh_test=1&stage4_initial_generation=7&stage4_cold_start=1&stage4_reset=1"
    )
    cdp.command("Page.navigate", {"url": url})
    wait_for(
        lambda: cdp.evaluate("window.__wsbStage4RefreshTest?.coldFailures.length === 4"),
        timeout=45,
        description=f"four injected {slug} cold-start failures",
    )
    baseline = cdp.evaluate(
        "({ loadCount: window.__wsbStage4RefreshTest.loadCount, "
        "storedLoadCount: Number(sessionStorage.getItem(`wsb-stage4-load-count:${location.pathname}`) || '0'), "
        "navigationCount: performance.getEntriesByType('navigation').length, href: location.href })"
    )
    wait_for_generation_event(cdp, "applied", 7, timeout=180)
    wait_for(
        lambda: cdp.evaluate(f"Boolean(({spec['ready']}))"),
        timeout=180,
        description=f"{slug} in-place cold-start recovery",
    )
    time.sleep(0.65)
    result = cdp.evaluate(
        """
          ({
            loadCount: window.__wsbStage4RefreshTest.loadCount,
            storedLoadCount: Number(sessionStorage.getItem(`wsb-stage4-load-count:${location.pathname}`) || '0'),
            navigationCount: performance.getEntriesByType('navigation').length,
            href: location.href,
            errors: [...window.__wsbStage4RefreshTest.errors],
            updated: document.querySelector('#updatedKpi')?.textContent?.trim() || '',
            casaLoading: ['#recentSpendsView', '#activeCoinsView', '#coinInfoPanel']
              .some((selector) => /Loading(?:…|\\.\\.\\.)/.test(document.querySelector(selector)?.textContent || '')),
          })
        """
    )
    if result != {
        **baseline,
        "errors": [],
        "updated": result["updated"],
        "casaLoading": False,
    }:
        raise AssertionError(f"{slug} cold-start recovery left stale state: {result!r}")
    if slug == "days_since_ath" and (not result["updated"] or result["updated"] == "Load failed"):
        raise AssertionError(f"Days Since ATH retained its cold-start failure KPI: {result!r}")


def test_days_preview(cdp: CdpSocket, server_port: int):
    url = (
        f"http://127.0.0.1:{server_port}/webapps/days_since_ath/preview.html"
        "?stage4_refresh_test=1&stage4_initial_generation=7&stage4_reset=1"
    )
    cdp.command("Page.navigate", {"url": url})
    wait_for(
        lambda: cdp.evaluate(
            "document.documentElement.dataset.previewReady === '1' "
            "&& window.__wsbStage4RefreshTest?.dataRequests.some((request) => "
            "request.phase === 'preview' && request.generation === 7) "
            "&& window.__wsbStage4RefreshTest?.presentation.preview > 0"
        ),
        timeout=150,
        description="Days Since ATH preview initial render",
    )
    baseline = cdp.evaluate(
        "({ navigationCount: performance.getEntriesByType('navigation').length, "
        "href: location.href, loadCount: window.__wsbStage4RefreshTest.loadCount, "
        "canvas: document.querySelector('#daysSinceAthPreview').toDataURL(), "
        "markerCount: window.__wsbStage4RefreshTest.markerRequests.length, "
        "dataCount: window.__wsbStage4RefreshTest.dataRequests.length })"
    )

    cdp.evaluate(
        "window.__wsbStage4RefreshTest.resetPresentation(); "
        "window.dispatchEvent(new Event('focus')); true"
    )
    wait_for(
        lambda: cdp.evaluate(
            f"window.__wsbStage4RefreshTest.markerRequests.length > {baseline['markerCount']}"
        ),
        timeout=30,
        description="Days preview unchanged-marker poll",
    )
    time.sleep(0.45)
    unchanged = cdp.evaluate(
        "({ dataCount: window.__wsbStage4RefreshTest.dataRequests.length, "
        "presentation: window.__wsbStage4RefreshTest.presentation.preview, "
        "canvas: document.querySelector('#daysSinceAthPreview').toDataURL() })"
    )
    if unchanged != {
        "dataCount": baseline["dataCount"],
        "presentation": 0,
        "canvas": baseline["canvas"],
    }:
        raise AssertionError(
            "Days preview fetched/repainted after an unchanged marker: "
            f"{unchanged!r}"
        )

    cdp.evaluate(
        "window.__wsbStage4RefreshTest.setPriceGeneration(8); "
        "window.__wsbStage4RefreshTest.previewDataFailuresRemaining = 1; "
        "window.__wsbStage4RefreshTest.resetPresentation(); "
        "window.dispatchEvent(new Event('focus')); true"
    )
    wait_for(
        lambda: cdp.evaluate(
            "window.__wsbStage4RefreshTest.dataRequests.filter((request) => "
            "request.phase === 'preview' && request.generation === 8).length >= 1"
        ),
        timeout=45,
        description="Days preview injected candidate failure",
    )
    time.sleep(0.45)
    failed = cdp.evaluate(
        "({ presentation: window.__wsbStage4RefreshTest.presentation.preview, "
        "canvas: document.querySelector('#daysSinceAthPreview').toDataURL() })"
    )
    if failed != {"presentation": 0, "canvas": baseline["canvas"]}:
        raise AssertionError(f"Days preview disturbed its canvas after refresh failure: {failed!r}")

    cdp.evaluate("window.dispatchEvent(new Event('focus')); true")
    wait_for(
        lambda: cdp.evaluate(
            "window.__wsbStage4RefreshTest.dataRequests.filter((request) => "
            "request.phase === 'preview' && request.generation === 8).length >= 2 "
            "&& window.__wsbStage4RefreshTest.presentation.preview >= 1"
        ),
        timeout=60,
        description="Days preview recovery render",
    )
    time.sleep(0.35)
    if cdp.evaluate("window.__wsbStage4RefreshTest.presentation.preview") != 1:
        raise AssertionError("Days preview did not repaint its recovered generation exactly once")

    visible_canvas = cdp.evaluate("document.querySelector('#daysSinceAthPreview').toDataURL()")
    override = cdp.evaluate(
        "(() => { try { window.__wsbStage4Visibility = 'hidden'; "
        "Object.defineProperty(document, 'visibilityState', { configurable: true, "
        "get: () => window.__wsbStage4Visibility }); "
        "document.dispatchEvent(new Event('visibilitychange')); "
        "return document.visibilityState === 'hidden'; } catch (_) { return false; } })()"
    )
    if not override:
        raise AssertionError("Could not install hidden-document override for Days preview")
    cdp.evaluate(
        "window.__wsbStage4RefreshTest.setPriceGeneration(9); "
        "window.__wsbStage4RefreshTest.resetPresentation(); "
        "window.dispatchEvent(new Event('focus')); true"
    )
    wait_for(
        lambda: cdp.evaluate(
            "window.__wsbStage4RefreshTest.dataRequests.some((request) => "
            "request.phase === 'preview' && request.generation === 9)"
        ),
        timeout=60,
        description="Days preview hidden generation install",
    )
    time.sleep(0.45)
    hidden = cdp.evaluate(
        "({ presentation: window.__wsbStage4RefreshTest.presentation.preview, "
        "canvas: document.querySelector('#daysSinceAthPreview').toDataURL() })"
    )
    if hidden != {"presentation": 0, "canvas": visible_canvas}:
        raise AssertionError(f"Days preview presented while hidden: {hidden!r}")

    cdp.evaluate(
        "window.__wsbStage4Visibility = 'visible'; "
        "document.dispatchEvent(new Event('visibilitychange')); true"
    )
    wait_for(
        lambda: cdp.evaluate("window.__wsbStage4RefreshTest.presentation.preview >= 1"),
        timeout=30,
        description="Days preview visible catch-up",
    )
    time.sleep(0.35)
    final = cdp.evaluate(
        "({ navigationCount: performance.getEntriesByType('navigation').length, "
        "href: location.href, loadCount: window.__wsbStage4RefreshTest.loadCount, "
        "presentation: window.__wsbStage4RefreshTest.presentation.preview, "
        "errors: [...window.__wsbStage4RefreshTest.errors] })"
    )
    if final != {
        "navigationCount": baseline["navigationCount"],
        "href": baseline["href"],
        "loadCount": baseline["loadCount"],
        "presentation": 1,
        "errors": [],
    }:
        raise AssertionError(f"Days preview live refresh was not atomic/in-place: {final!r}")


def assert_homepage_refresh_ownership():
    source = (ROOT / "js/09_bootstrap_fetch_init_global_exports.js").read_text()
    try:
        mapping = source.split(
            "const HOMEPAGE_GRID_CARD_DATA_SOURCES = Object.freeze({", 1
        )[1].split("});", 1)[0]
    except IndexError as exc:
        raise AssertionError("Could not locate homepage grid-card refresh ownership map") from exc
    duplicate_owners = [
        filename
        for filename in ("casascius_explorer.png", "days_since_ath.png")
        if filename in mapping
    ]
    if duplicate_owners:
        raise AssertionError(
            "Homepage still owns iframe reloads for Stage 4 self-refreshing previews: "
            + ", ".join(duplicate_owners)
        )


def main():
    chrome_path = Path(CHROME)
    if not chrome_path.is_file():
        raise SystemExit(f"Chrome not found at {CHROME}; set CHROME_BIN")

    requested = sys.argv[1:]
    unknown = set(requested).difference(DASHBOARDS)
    if unknown:
        raise SystemExit(f"Unknown dashboard target(s): {', '.join(sorted(unknown))}")
    targets = requested or list(DASHBOARDS)
    assert_homepage_refresh_ownership()

    server_port = free_port()
    debug_port = free_port()
    SnapshotHandler.snapshot = build_data_snapshot()
    handler = lambda *args, **kwargs: SnapshotHandler(*args, directory=str(ROOT), **kwargs)
    server = ThreadingHTTPServer(("127.0.0.1", server_port), handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()

    with tempfile.TemporaryDirectory(prefix="wsb-stage4-refresh-cdp-") as profile:
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
                print(f"Testing Stage 4 live refresh: {slug}...", flush=True)
                test_dashboard(cdp, server_port, slug, DASHBOARDS[slug])
                test_cold_start_recovery(cdp, server_port, slug, DASHBOARDS[slug])
                print(f"Passed: {slug}", flush=True)
            if "days_since_ath" in targets:
                print("Testing Stage 4 live refresh: days_since_ath preview...", flush=True)
                test_days_preview(cdp, server_port)
                print("Passed: days_since_ath preview", flush=True)
        finally:
            chrome.terminate()
            try:
                chrome.wait(timeout=5)
            except subprocess.TimeoutExpired:
                chrome.kill()
            server.shutdown()


if __name__ == "__main__":
    main()
