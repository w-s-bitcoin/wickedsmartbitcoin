(function () {
  const THEME_KEY = 'quantum-research-dashboard-theme';

  const HISTORY_COLORS = {
    total: '#d1d5db',
    listening: '#6b7280',
    unreachable: '#9ca3af',
    core: '#f7931a',
    knots: '#39d98a',
    bip110: '#4169e1',
  };

  function applyTheme(theme) {
    document.documentElement.dataset.theme = theme === 'light' ? 'light' : 'dark';
  }

  function initThemeSync() {
    try {
      const stored = localStorage.getItem(THEME_KEY);
      applyTheme(
        stored === 'light' || stored === 'dark'
          ? stored
          : (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
      );
    } catch (_) {
      applyTheme('dark');
    }

    window.addEventListener('message', (event) => {
      if (event.data && event.data.type === 'quantum-dashboard-theme') {
        applyTheme(event.data.theme);
        render();
      }
    });

    window.addEventListener('storage', (event) => {
      if (event.key === THEME_KEY && (event.newValue === 'light' || event.newValue === 'dark')) {
        applyTheme(event.newValue);
        render();
      }
    });
  }

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

  let cachedRows = [];

  function render() {
    const chart = document.getElementById('historyChart');
    if (!chart) return;

    const rows = cachedRows;
    if (!rows.length) { chart.innerHTML = ''; return; }

    const firstNonZero = rows.findIndex((r) => num(r.total_count) > 0);
    const data = firstNonZero > 0 ? rows.slice(firstNonZero) : rows;
    if (!data.length) { chart.innerHTML = ''; return; }

    const series = [
      { values: data.map((r) => num(r.total_count)), color: HISTORY_COLORS.total, width: 2.6 },
      { values: data.map((r) => num(r.est_unreachable)), color: HISTORY_COLORS.unreachable, width: 1.8 },
      { values: data.map((r) => num(r.listening)), color: HISTORY_COLORS.listening, width: 1.8 },
      { values: data.map((r) => Math.max(0, num(r.knots_count) - num(r.bip110_count))), color: HISTORY_COLORS.knots, width: 1.8 },
      { values: data.map((r) => num(r.core_v30_count)), color: HISTORY_COLORS.core, width: 1.8 },
      { values: data.map((r) => num(r.bip110_count)), color: HISTORY_COLORS.bip110, width: 1.8 },
    ];

    const isLight = document.documentElement.dataset.theme === 'light';
    const gridColor = isLight ? 'rgba(0,0,0,0.08)' : 'rgba(255,255,255,0.08)';

    const width = Math.max(chart.clientWidth || 0, 420);
    const height = Math.max(chart.clientHeight || 0, 220);
    const pad = { top: 12, right: 18, bottom: 16, left: 18 };
    const plotW = Math.max(1, width - pad.left - pad.right);
    const plotH = Math.max(1, height - pad.top - pad.bottom);
    const n = data.length;

    const allValues = series.flatMap((s) => s.values).filter((v) => Number.isFinite(v) && v > 0);
    const minY = 0;
    const maxY = Math.max(...allValues) * 1.05;
    const spanY = Math.max(1, maxY - minY);

    const mapX = (i) => pad.left + (i / Math.max(1, n - 1)) * plotW;
    const mapY = (v) => pad.top + ((maxY - Math.max(0, v)) / spanY) * plotH;

    const gridLines = [0.25, 0.5, 0.75].map((t) => {
      const y = pad.top + plotH * t;
      return `<line x1="${pad.left}" y1="${y.toFixed(2)}" x2="${(pad.left + plotW).toFixed(2)}" y2="${y.toFixed(2)}" stroke="${gridColor}" stroke-width="1" />`;
    }).join('');

    const paths = series.map(({ values, color, width: sw }) => {
      const points = [];
      for (let i = 0; i < values.length; i += 1) {
        const v = values[i];
        if (Number.isFinite(v) && v > 0) points.push([mapX(i), mapY(v)]);
      }
      if (!points.length) return '';
      return `<path d="${buildSvgLinePath(points)}" fill="none" stroke="${color}" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round" />`;
    }).join('');

    chart.innerHTML = `<svg viewBox="0 0 ${width} ${height}" width="100%" height="100%" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Node Count Over Time preview chart">${gridLines}${paths}</svg>`;
  }

  async function load() {
    const resp = await fetch('webapp_data/bitcoin_node_history.csv', { cache: 'default' });
    if (!resp.ok) throw new Error(`Failed to load bitcoin_node_history.csv (${resp.status}).`);

    cachedRows = sanitizeHistoryRows(
      parseCsv(await resp.text()).map((r) => ({
        ...r,
        datetime: r.datetime || (r.timestamp ? new Date(num(r.timestamp) * 1000).toISOString() : ''),
      })).filter((r) => !!r.datetime)
    ).sort((a, b) => new Date(a.datetime) - new Date(b.datetime));
  }

  async function init() {
    initThemeSync();
    await load();
    render();
    window.addEventListener('resize', render);
  }

  init().catch((error) => {
    console.error(error);
    const chart = document.getElementById('historyChart');
    if (chart) chart.innerHTML = '';
  });
}());
