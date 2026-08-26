(function () {
  const AUTO_REFRESH_MS = 60000;

  const HISTORY_COLORS = {
    total: '#d1d5db',
    listening: '#6b7280',
    unreachable: '#9ca3af',
    core: '#f7931a',
    knots: '#39d98a',
    bip110: '#4169e1',
  };

  function parseCsv(text) {
    const rows = [];
    let row = [];
    let value = '';
    let inQuotes = false;
    for (let i = 0; i < text.length; i += 1) {
      const ch = text[i];
      const next = text[i + 1];
      if (ch === '"') {
        if (inQuotes && next === '"') {
          value += '"';
          i += 1;
        } else {
          inQuotes = !inQuotes;
        }
        continue;
      }
      if (ch === ',' && !inQuotes) {
        row.push(value);
        value = '';
        continue;
      }
      if ((ch === '\n' || ch === '\r') && !inQuotes) {
        if (ch === '\r' && next === '\n') i += 1;
        row.push(value);
        const hasContent = row.some((cell) => String(cell).trim() !== '');
        if (hasContent) rows.push(row);
        row = [];
        value = '';
        continue;
      }
      value += ch;
    }
    if (value.length || row.length) {
      row.push(value);
      rows.push(row);
    }
    if (!rows.length) return [];
    const headers = rows[0].map((h) => String(h || '').trim());
    return rows.slice(1).map((r) => {
      const obj = {};
      headers.forEach((h, idx) => {
        obj[h] = r[idx] == null ? '' : String(r[idx]);
      });
      return obj;
    });
  }

  function num(v) {
    const n = Number(String(v).replaceAll(',', '').trim());
    return Number.isFinite(n) ? n : 0;
  }

  function sanitizeHistoryRows(rows) {
    if (!Array.isArray(rows) || !rows.length) return [];

    const cleaned = rows.filter((r) => {
      const t = new Date(r.datetime).getTime();
      return Number.isFinite(t);
    });
    if (cleaned.length < 3) return cleaned;

    const badIndexes = new Set();
    const totals = cleaned.map((r) => num(r.total_count));

    for (let i = 0; i < totals.length; i += 1) {
      if (!Number.isFinite(totals[i]) || totals[i] <= 0) {
        badIndexes.add(i);
      }
    }

    for (let i = 1; i < totals.length - 1; i += 1) {
      if (badIndexes.has(i)) continue;
      const prev = totals[i - 1];
      const curr = totals[i];
      const next = totals[i + 1];
      if (!(prev > 0 && curr > 0 && next > 0)) continue;

      const neighborLow = Math.min(prev, next);
      const neighborHigh = Math.max(prev, next);
      const neighborsAreClose = neighborLow > 0 && (neighborHigh / neighborLow) <= 1.25;
      const severeIsolatedDip = curr < (neighborLow * 0.72);

      if (neighborsAreClose && severeIsolatedDip) {
        badIndexes.add(i);
      }
    }

    if (!badIndexes.size) return cleaned;
    return cleaned.filter((_, idx) => !badIndexes.has(idx));
  }

  function buildSvgLinePath(points) {
    if (!points.length) return '';
    let d = '';
    for (let i = 0; i < points.length; i += 1) {
      d += i === 0
        ? `M ${points[i][0].toFixed(2)} ${points[i][1].toFixed(2)}`
        : ` L ${points[i][0].toFixed(2)} ${points[i][1].toFixed(2)}`;
    }
    return d;
  }

  const state = {
    installedSignature: null,
    marker: null,
    rows: [],
  };
  let dataRefresher = null;

  async function sha256Text(text) {
    if (!window.crypto?.subtle || typeof TextEncoder !== 'function') {
      throw new Error('SHA-256 validation is unavailable in this browser.');
    }
    const digest = await window.crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
    return Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, '0')).join('');
  }

  function strictOptionalNumber(value) {
    const raw = String(value ?? '').trim();
    if (!raw) return null;
    const parsed = Number(raw.replaceAll(',', ''));
    return Number.isFinite(parsed) ? parsed : NaN;
  }

  function render() {
    const chart = document.getElementById('historyChart');
    if (!chart) return;

    const rows = state.rows;
    if (!rows.length) {
      chart.dataset.previewState = 'fallback';
      chart.innerHTML = '<div class="preview-unavailable" style="display:grid;place-items:center;width:100%;height:100%;color:#95a6ae;font:500 22px IBM Plex Mono,monospace">Preview unavailable</div>';
      return true;
    }

    const firstNonZero = rows.findIndex((r) => (
      num(r.knots_count) > 0
      || num(r.core_v30_count) > 0
      || num(r.bip110_count) > 0
    ));
    const data = firstNonZero > 0 ? rows.slice(firstNonZero) : rows;
    if (!data.length) return false;

    const width = Math.max(chart.clientWidth || 0, 420);
    const lineWidth = Math.max(2, Math.min(4.2, width / 340));
    const series = [
      { values: data.map((r) => Math.max(0, num(r.knots_count) - num(r.bip110_count))), color: HISTORY_COLORS.knots, width: lineWidth },
      { values: data.map((r) => num(r.core_v30_count)), color: HISTORY_COLORS.core, width: lineWidth },
      { values: data.map((r) => num(r.bip110_count)), color: HISTORY_COLORS.bip110, width: lineWidth },
    ];

    const height = Math.max(chart.clientHeight || 0, 220);
    const pad = { top: 12, right: 18, bottom: 16, left: 18 };
    const plotW = Math.max(1, width - pad.left - pad.right);
    const plotH = Math.max(1, height - pad.top - pad.bottom);
    const n = data.length;

    const allValues = series.flatMap((s) => s.values).filter((v) => Number.isFinite(v) && v > 0);
    if (!allValues.length) return false;
    const minY = 0;
    const maxY = Math.max(...allValues) * 1.05;
    const spanY = Math.max(1, maxY - minY);

    const mapX = (i) => pad.left + (i / Math.max(1, n - 1)) * plotW;
    const mapY = (v) => pad.top + ((maxY - Math.max(0, v)) / spanY) * plotH;

    const paths = series.map(({ values, color, width: sw }) => {
      const points = [];
      for (let i = 0; i < values.length; i += 1) {
        const v = values[i];
        if (Number.isFinite(v) && v > 0) points.push([mapX(i), mapY(v)]);
      }
      if (!points.length) return '';
      return `<path d="${buildSvgLinePath(points)}" fill="none" stroke="${color}" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round" />`;
    }).join('');

    chart.innerHTML = `<svg viewBox="0 0 ${width} ${height}" width="100%" height="100%" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Node Count Over Time preview chart">${paths}</svg>`;
    chart.dataset.previewState = 'ready';
    return true;
  }

  async function prepareCandidate(context) {
    const marker = JSON.parse(String(context.signatureParts?.[0] || '').trim());
    const response = await context.fetchFresh('webapp_data/bitcoin_node_history.csv');
    const csvText = await response.text();
    const rawRows = parseCsv(csvText).map((r) => ({
        ...r,
        datetime: r.datetime || (r.timestamp ? new Date(num(r.timestamp) * 1000).toISOString() : ''),
      }));
    return {
      marker,
      rawRows,
      rows: sanitizeHistoryRows(rawRows).sort((a, b) => new Date(a.datetime) - new Date(b.datetime)),
      dataHash: await sha256Text(csvText),
    };
  }

  function validateCandidate(candidate) {
    const marker = candidate?.marker;
    const artifact = marker?.artifacts?.['bitcoin_node_history.csv'];
    const rawRows = candidate?.rawRows;
    const expectedHash = String(artifact?.sha256 || '').toLowerCase();
    if (Number(marker?.schema_version) !== 1 || !String(marker?.generation_id || '').trim()) return false;
    if (!/^[a-f0-9]{64}$/.test(expectedHash) || candidate.dataHash !== expectedHash) return false;
    if (!Array.isArray(rawRows) || rawRows.length !== Number(artifact?.rows) || rawRows.length < 2) return false;
    if (!candidate.rows.length || candidate.rows.length < rawRows.length * 0.95) return false;

    let previousTime = -Infinity;
    for (const row of rawRows) {
      const timestamp = strictOptionalNumber(row.timestamp);
      const datetimeMs = Date.parse(String(row.datetime || ''));
      const total = strictOptionalNumber(row.total_count);
      const listening = strictOptionalNumber(row.listening);
      const unreachable = strictOptionalNumber(row.est_unreachable);
      if (!Number.isInteger(timestamp) || timestamp <= 0 || !Number.isFinite(datetimeMs)) return false;
      if (Math.abs(datetimeMs - timestamp * 1000) > 1000) return false;
      // Historical snapshots may legitimately share the same collection
      // second. Reject regressions, but retain equal-timestamp observations.
      if (datetimeMs < previousTime) return false;
      // The raw history intentionally retains a small number of dated source
      // gaps. Those rows are excluded from the rendered series, but remain
      // part of the exact published artifact and its row count.
      if (total !== null && (!Number.isFinite(total) || total <= 0)) return false;
      if (listening !== null && (!Number.isFinite(listening) || listening < 0)) {
        return false;
      }
      if (unreachable !== null && (!Number.isFinite(unreachable) || unreachable < 0)) return false;
      for (const key of ['knots_count', 'core_v30_count', 'bip110_count']) {
        const value = strictOptionalNumber(row[key]);
        if (value !== null && (!Number.isFinite(value) || value < 0)) return false;
      }
      previousTime = datetimeMs;
    }

    const latestMarkerMs = Date.parse(String(marker.latest_history_datetime || ''));
    const latestRowMs = Date.parse(String(rawRows[rawRows.length - 1].datetime || ''));
    if (!Number.isFinite(latestMarkerMs) || latestMarkerMs !== latestRowMs) return false;
    const installedMs = Date.parse(String(state.marker?.latest_history_datetime || ''));
    if (Number.isFinite(installedMs) && latestMarkerMs < installedMs) return false;
    return true;
  }

  function initialize() {
    window.WSBPreviewShared?.initThemeSync({
      onThemeChanged: () => dataRefresher?.requestPresent('theme'),
    });
    dataRefresher = window.WSBPreviewShared?.createDataRefresher({
      filename: 'node_count.png',
      urls: ['webapp_data/published_generation.json'],
      intervalMs: AUTO_REFRESH_MS,
      getInstalledSignature: () => state.installedSignature,
      prepare: prepareCandidate,
      validate: (candidate) => {
        if (!validateCandidate(candidate)) {
          throw new Error('Node Count preview publication is incomplete or inconsistent.');
        }
        return true;
      },
      commit: (candidate, context) => {
        state.marker = candidate.marker;
        state.rows = candidate.rows;
        state.installedSignature = context.signature;
        return true;
      },
      present: render,
      onInitialError: (error) => {
        console.error(error);
        if (document.visibilityState === 'visible') render();
      },
      onError: (error) => console.warn('Node Count preview refresh failed:', error),
    });
    window.addEventListener('resize', () => dataRefresher?.requestPresent('resize'));
    dataRefresher?.start();
  }

  try {
    initialize();
  } catch (error) {
    console.error(error);
    if (document.visibilityState === 'visible') render();
    window.WSBPreviewShared?.markReady?.({ filename: 'node_count.png' });
  }
}());
