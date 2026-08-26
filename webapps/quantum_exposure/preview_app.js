(function () {
  const AUTO_REFRESH_MS = 60000;

  const state = {
    installedSignature: null,
    marker: null,
    points: [],
  };
  let dataRefresher = null;

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

    if (inQuotes) throw new Error('Quantum historical CSV contains an unterminated quoted field.');
    if (value.length || row.length) {
      row.push(value);
      const hasContent = row.some((cell) => String(cell || '').trim() !== '');
      if (hasContent) rows.push(row);
    }

    if (!rows.length) return [];
    const headers = rows[0].map((h) => String(h || '').trim());
    return rows.slice(1).map((r) => {
      if (r.length !== headers.length) {
        throw new Error('Quantum historical CSV contains an incomplete row.');
      }
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

  function strictNumber(value) {
    const raw = String(value ?? '').replaceAll(',', '').trim();
    if (!raw) return NaN;
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed : NaN;
  }

  async function sha256Text(text) {
    if (!window.crypto?.subtle || typeof TextEncoder !== 'function') {
      throw new Error('SHA-256 validation is unavailable in this browser.');
    }
    const digest = await window.crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
    return Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, '0')).join('');
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

  function render() {
    const container = document.getElementById('historicalChart');
    if (!container) return false;

    if (!state.points.length) {
      container.dataset.previewState = 'fallback';
      container.innerHTML = '<div class="preview-unavailable" style="display:grid;place-items:center;width:100%;height:100%;color:#95a6ae;font:500 22px IBM Plex Mono,monospace">Preview unavailable</div>';
      return true;
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

    container.innerHTML = `
      <svg class="historical-svg" width="${width}" height="${height}" role="img" aria-label="Historical stacked supply chart">
        <path class="seg-never" d="${neverPath}"></path>
        <path class="seg-inactive" d="${inactivePath}"></path>
        <path class="seg-active" d="${activePath}"></path>
        <path class="seg-nonexposed" d="${nonExposedPath}"></path>
      </svg>
    `;
    container.dataset.previewState = 'ready';
    return true;
  }

  async function prepareCandidate(context) {
    const marker = JSON.parse(String(context.signatureParts?.[0] || '').trim());
    const response = await context.fetchFresh('webapp_data/historical_eco.csv');
    const csvText = await response.text();
    const rows = parseCsv(csvText);
    return {
      marker,
      rows,
      points: buildPointsFromRows(rows),
      dataHash: await sha256Text(csvText),
    };
  }

  function validateCandidate(candidate) {
    const marker = candidate?.marker;
    const artifact = marker?.artifacts?.['historical_eco.csv'];
    const rows = candidate?.rows;
    const expectedHash = String(artifact?.sha256 || '').toLowerCase();
    const requiredHeaders = [
      'snapshot',
      'balance_filter',
      'script_type_filter',
      'spend_activity_filter',
      'pubkey_count',
      'utxo_count',
      'supply_sats',
      'exposed_pubkey_count',
      'exposed_utxo_count',
      'exposed_supply_sats',
      'estimated_migration_blocks',
    ];
    if (Number(marker?.format) !== 1 || !String(marker?.generation_id || '').trim()) return false;
    if (String(artifact?.path || '') !== 'historical_eco.csv') return false;
    if (!/^[a-f0-9]{64}$/.test(expectedHash) || candidate.dataHash !== expectedHash) return false;
    if (!Array.isArray(rows) || rows.length !== Number(artifact?.rows) || rows.length < 1) return false;
    if (Object.keys(rows[0] || {}).join('|') !== requiredHeaders.join('|')) return false;

    const keys = new Set();
    const snapshotHeights = [];
    const requiredBySnapshot = new Map();
    let previousHeight = -1;
    for (const row of rows) {
      const snapshot = strictNumber(row.snapshot);
      if (!Number.isInteger(snapshot) || snapshot < 0 || snapshot < previousHeight) return false;
      const balance = String(row.balance_filter || '').trim();
      const scriptType = String(row.script_type_filter || '').trim();
      const activity = String(row.spend_activity_filter || '').trim();
      if (!balance || !scriptType || !activity) return false;
      const key = `${snapshot}|${balance}|${scriptType}|${activity}`;
      if (keys.has(key)) return false;
      keys.add(key);
      for (const field of [
        'pubkey_count',
        'utxo_count',
        'supply_sats',
        'exposed_pubkey_count',
        'exposed_utxo_count',
        'exposed_supply_sats',
      ]) {
        const value = strictNumber(row[field]);
        if (!Number.isInteger(value) || value < 0) return false;
      }
      const migrationBlocks = strictNumber(row.estimated_migration_blocks);
      if (!Number.isFinite(migrationBlocks) || migrationBlocks < 0) return false;
      if (!requiredBySnapshot.has(snapshot)) requiredBySnapshot.set(snapshot, new Set());
      if (balance === 'all' && scriptType === 'All') {
        requiredBySnapshot.get(snapshot).add(activity);
      }
      if (!snapshotHeights.length || snapshotHeights[snapshotHeights.length - 1] !== snapshot) {
        snapshotHeights.push(snapshot);
      }
      previousHeight = snapshot;
    }

    if (snapshotHeights[0] !== Number(artifact.first_snapshot)) return false;
    if (snapshotHeights[snapshotHeights.length - 1] !== Number(artifact.latest_snapshot)) return false;
    if (Number(artifact.latest_snapshot) !== Number(marker.snapshot_blockheight)) return false;
    for (const [snapshot, activities] of requiredBySnapshot.entries()) {
      // Snapshot zero is the genesis baseline and predates the activity
      // buckets; later snapshots must carry the complete stacked breakdown.
      const requiredActivities = snapshot === 0
        ? ['all', 'never_spent']
        : ['all', 'never_spent', 'inactive', 'active'];
      if (!requiredActivities.every((value) => activities.has(value))) {
        return false;
      }
    }
    if (candidate.points.length !== snapshotHeights.length) return false;
    const installedHeight = Number(state.marker?.snapshot_blockheight);
    if (Number.isFinite(installedHeight) && Number(marker.snapshot_blockheight) < installedHeight) return false;
    return true;
  }

  function initialize() {
    window.WSBPreviewShared?.initThemeSync({
      onThemeChanged: () => dataRefresher?.requestPresent('theme'),
    });
    dataRefresher = window.WSBPreviewShared?.createDataRefresher({
      filename: 'quantum_exposure.png',
      urls: ['webapp_data/published_generation.json'],
      intervalMs: AUTO_REFRESH_MS,
      getInstalledSignature: () => state.installedSignature,
      prepare: prepareCandidate,
      validate: (candidate) => {
        if (!validateCandidate(candidate)) {
          throw new Error('Quantum preview publication is incomplete or inconsistent.');
        }
        return true;
      },
      commit: (candidate, context) => {
        state.marker = candidate.marker;
        state.points = candidate.points;
        state.installedSignature = context.signature;
        return true;
      },
      present: render,
      onInitialError: (error) => {
        console.error(error);
        if (document.visibilityState === 'visible') render();
      },
      onError: (error) => console.warn('Quantum preview refresh failed:', error),
    });
    window.addEventListener('resize', () => dataRefresher?.requestPresent('resize'));
    dataRefresher?.start();
  }

  try {
    initialize();
  } catch (error) {
    console.error(error);
    if (document.visibilityState === 'visible') render();
    window.WSBPreviewShared?.markReady?.({ filename: 'quantum_exposure.png' });
  }
}());
