(function () {
  const SATS_PER_BTC = 100000000;
  const THEME_KEY = 'quantum-research-dashboard-theme';

  const state = {
    points: [],
  };

  function applyTheme(theme) {
    document.documentElement.dataset.theme = theme === 'dark' ? 'dark' : 'light';
  }

  function initThemeSync() {
    try {
      const stored = window.localStorage.getItem(THEME_KEY);
      if (stored === 'light' || stored === 'dark') {
        applyTheme(stored);
      } else {
        applyTheme(window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
      }
    } catch (_err) {
      applyTheme(window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
    }

    window.addEventListener('message', (event) => {
      if (!event.data || event.data.type !== 'quantum-dashboard-theme') return;
      applyTheme(event.data.theme);
      render();
    });

    window.addEventListener('storage', (event) => {
      if (event.key !== THEME_KEY) return;
      if (event.newValue === 'light' || event.newValue === 'dark') {
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
        const hasContent = row.some((cell) => String(cell || '').trim() !== '');
        if (hasContent) rows.push(row);
        row = [];
        value = '';
        continue;
      }
      value += ch;
    }

    if (value.length || row.length) {
      row.push(value);
      const hasContent = row.some((cell) => String(cell || '').trim() !== '');
      if (hasContent) rows.push(row);
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

  function toInt(value) {
    if (value == null || value === '') return 0;
    const normalized = Number.parseFloat(String(value).replaceAll(',', '').trim());
    return Number.isFinite(normalized) ? Math.round(normalized) : 0;
  }

  function getAggregateFromRows(rows, balanceFilter, scriptType, spendType, fieldName) {
    const row = rows.find(
      (r) =>
        r.balance_filter === balanceFilter &&
        r.script_type_filter === scriptType &&
        r.spend_activity_filter === spendType
    );
    return row ? toInt(row[fieldName]) : 0;
  }

  function areaPath(points, xAt, yLowerAt, yUpperAt) {
    if (!points.length) return '';

    let path = `M ${xAt(points[0])} ${yUpperAt(points[0])}`;
    for (let i = 1; i < points.length; i += 1) {
      path += ` L ${xAt(points[i])} ${yUpperAt(points[i])}`;
    }
    for (let i = points.length - 1; i >= 0; i -= 1) {
      path += ` L ${xAt(points[i])} ${yLowerAt(points[i])}`;
    }
    path += ' Z';
    return path;
  }

  function buildPointsFromRows(rows) {
    const groupedBySnapshot = new Map();
    rows.forEach((row) => {
      const snapshot = String(row.snapshot || '').trim();
      if (!snapshot) return;
      if (!groupedBySnapshot.has(snapshot)) {
        groupedBySnapshot.set(snapshot, []);
      }
      const aggregateRow = { ...row };
      delete aggregateRow.snapshot;
      groupedBySnapshot.get(snapshot).push(aggregateRow);
    });

    const points = Array.from(groupedBySnapshot.entries())
      .sort((left, right) => Number.parseInt(left[0], 10) - Number.parseInt(right[0], 10))
      .map(([snapshot, aggregatesRows]) => {
        const snapshotHeight = Number.parseInt(snapshot, 10) || 0;
        const totalSupplySats = getAggregateFromRows(aggregatesRows, 'all', 'All', 'all', 'supply_sats');
        const fullNever = getAggregateFromRows(aggregatesRows, 'all', 'All', 'never_spent', 'exposed_supply_sats');
        const fullInactive = getAggregateFromRows(aggregatesRows, 'all', 'All', 'inactive', 'exposed_supply_sats');
        const fullActive = getAggregateFromRows(aggregatesRows, 'all', 'All', 'active', 'exposed_supply_sats');
        const fullExposed = fullNever + fullInactive + fullActive;
        const fullNonExposed = Math.max(totalSupplySats - fullExposed, 0);

        const neverTop = fullNever;
        const inactiveTop = neverTop + fullInactive;
        const activeTop = inactiveTop + fullActive;
        const totalTop = activeTop + fullNonExposed;

        return {
          snapshot,
          snapshotHeight,
          totalSupplySats,
          fullNever,
          fullInactive,
          fullActive,
          fullNonExposed,
          neverTop,
          inactiveTop,
          activeTop,
          totalTop,
        };
      })
      .filter((point) => point.totalSupplySats > 0 || point.snapshot === '0');

    return points;
  }

  async function loadData() {
    const resp = await fetch('webapp_data/historical_eco.csv', { cache: 'default' });
    if (!resp.ok) {
      throw new Error(`Could not load webapp_data/historical_eco.csv (${resp.status})`);
    }

    const rows = parseCsv(await resp.text());
    state.points = buildPointsFromRows(rows);
  }

  function render() {
    const container = document.getElementById('historicalChart');
    if (!container) return;

    if (!state.points.length) {
      container.innerHTML = '';
      return;
    }

    const points = state.points;
    const maxTotal = Math.max(...points.map((point) => point.totalTop), 1);
    const minHeight = Math.min(...points.map((point) => point.snapshotHeight));
    const maxHeight = Math.max(...points.map((point) => point.snapshotHeight));

    const containerWidth = Math.floor(container.clientWidth || container.getBoundingClientRect().width || 0);
    const width = Math.max(containerWidth, 280);
    const height = Math.max(container.clientHeight || 300, 140);

    const margin = {
      top: 12,
      right: 18,
      bottom: 16,
      left: 18,
    };
    const plotWidth = Math.max(width - margin.left - margin.right, 80);
    const plotHeight = Math.max(height - margin.top - margin.bottom, 56);

    const xDomainSpan = Math.max(maxHeight - minHeight, 1);
    const xAtHeight = (blockheight) => margin.left + ((blockheight - minHeight) / xDomainSpan) * plotWidth;

    const markerHeadHeightPx = 16;
    const markerGapToPointPx = 6;
    const markerTopPaddingPx = 1;
    const markerClearancePx = markerHeadHeightPx + markerGapToPointPx + markerTopPaddingPx;
    const clearanceRatio = Math.min(markerClearancePx / Math.max(plotHeight, 1), 0.92);
    const yMaxSats = Math.max(maxTotal / Math.max(1 - clearanceRatio, 0.08), 1);
    const yAt = (value) => margin.top + (1 - value / yMaxSats) * plotHeight;

    const pointsWithIndex = points.map((point) => ({
      ...point,
      x: xAtHeight(point.snapshotHeight),
    }));

    const nonExposedPath = areaPath(
      pointsWithIndex,
      (point) => point.x,
      (point) => yAt(point.activeTop),
      (point) => yAt(point.totalTop)
    );
    const neverPath = areaPath(
      pointsWithIndex,
      (point) => point.x,
      () => yAt(0),
      (point) => yAt(point.neverTop)
    );
    const inactivePath = areaPath(
      pointsWithIndex,
      (point) => point.x,
      (point) => yAt(point.neverTop),
      (point) => yAt(point.inactiveTop)
    );
    const activePath = areaPath(
      pointsWithIndex,
      (point) => point.x,
      (point) => yAt(point.inactiveTop),
      (point) => yAt(point.activeTop)
    );

    const selectedPoint = pointsWithIndex[pointsWithIndex.length - 1] || null;
    const currentMarker = selectedPoint
      ? (() => {
          const markerX = selectedPoint.x;
          const markerTipY = Math.max(
            margin.top + markerTopPaddingPx + markerHeadHeightPx,
            yAt(selectedPoint.totalTop) - markerGapToPointPx
          );
          const markerTopY = Math.max(margin.top + markerTopPaddingPx, markerTipY - markerHeadHeightPx);
          const headHalfWidth = 4;
          return `
            <g class="historical-current-marker">
              <line x1="${markerX}" y1="${markerTopY}" x2="${markerX}" y2="${markerTipY - 5}" stroke-width="1.6"></line>
              <path d="M ${markerX - headHalfWidth} ${markerTipY - 5} L ${markerX + headHalfWidth} ${markerTipY - 5} L ${markerX} ${markerTipY} Z"></path>
            </g>
          `;
        })()
      : '';

    container.innerHTML = `
      <svg class="historical-svg" width="${width}" height="${height}" role="img" aria-label="Historical stacked supply chart">
        <path class="seg-never" d="${neverPath}"></path>
        <path class="seg-inactive" d="${inactivePath}"></path>
        <path class="seg-active" d="${activePath}"></path>
        <path class="seg-nonexposed" d="${nonExposedPath}"></path>
        ${currentMarker}
      </svg>
    `;
  }

  async function init() {
    initThemeSync();
    await loadData();
    render();
    window.addEventListener('resize', render);
  }

  init().catch((error) => {
    console.error(error);
  });
}());
