(function () {
  const AUTO_REFRESH_MS = 60000;

  function parseCsv(text) {
    const rows = [];
    let row = [];
    let value = '';
    let inQuotes = false;
    for (let i = 0; i < text.length; i += 1) {
      const ch = text[i];
      if (ch === '"') {
        if (inQuotes && text[i + 1] === '"') {
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
        if (ch === '\r' && text[i + 1] === '\n') i += 1;
        row.push(value);
        if (row.some((cell) => String(cell || '').length)) rows.push(row);
        row = [];
        value = '';
        continue;
      }
      value += ch;
    }
    if (value.length || row.length) {
      row.push(value);
      if (row.some((cell) => String(cell || '').length)) rows.push(row);
    }
    if (!rows.length) return [];
    const headers = rows[0].map((header) => String(header || '').trim());
    return rows.slice(1).map((rawRow) => {
      const obj = {};
      headers.forEach((header, index) => {
        obj[header] = rawRow[index] ?? '';
      });
      return obj;
    });
  }

  function strictNumber(value) {
    const raw = String(value ?? '').replaceAll(',', '').trim();
    if (!raw) return NaN;
    const normalized = Number(raw);
    return Number.isFinite(normalized) ? normalized : NaN;
  }

  const state = {
    installedSignature: null,
    marker: null,
    rows: [],
  };
  let dataRefresher = null;

  function iconPathForRow(row) {
    return row['Primary Key']
      ? `icons/${encodeURIComponent(row['Primary Key'])}.png`
      : (row['Symbol'] ? `icons/${encodeURIComponent(row['Symbol'].toUpperCase())}.png` : null);
  }

  async function sha256Text(text) {
    if (!window.crypto?.subtle || typeof TextEncoder !== 'function') {
      throw new Error('SHA-256 validation is unavailable in this browser.');
    }
    const digest = await window.crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
    return Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, '0')).join('');
  }

  function render() {
    const chartEl = document.getElementById('previewChart');
    if (!chartEl) return false;

    const rows = state.rows;
    if (!rows.length) {
      chartEl.dataset.previewState = 'fallback';
      chartEl.innerHTML = '<div class="preview-unavailable" style="display:grid;place-items:center;width:100%;height:100%;color:#95a6ae;font:500 22px IBM Plex Mono,monospace">Preview unavailable</div>';
      return true;
    }

    const maxCap = rows[0]['Market Cap'];
    const isLight = document.documentElement.dataset.theme === 'light';

    // Use a normalized coordinate space so bars always fill width,
    // regardless of whether clientWidth is 0 at render time.
    const VW = 1000; // viewBox width units
    const iconSize = 28;
    const iconGap = 12;
    const padT = 8;
    const padB = 8;
    const padL = 18;
    const padR = iconSize + iconGap + 18; // right of the longest bar
    const plotW = VW - padL - padR;
    const n = rows.length;
    // Use aspect ratio from actual element if available, else default
    const elW = chartEl.getBoundingClientRect().width || chartEl.clientWidth || 420;
    const elH = chartEl.getBoundingClientRect().height || chartEl.clientHeight || 280;
    const rowH = Math.max(16, Math.floor((elH * (VW / elW) - padT - padB) / n));
    const barH = Math.round(rowH * 0.52);
    const totalH = padT + n * rowH + padB;

    const items = rows.map((row, idx) => {
      const cap = row['Market Cap'];
      const barW = Math.max(4, Math.round((cap / maxCap) * plotW));
      const barColor = row['Primary Key'] === 'BTCBitcoin'
        ? '#ff9f1c'
        : (row['Is Stable'] ? '#35b56a' : (isLight ? 'rgba(0,0,0,0.28)' : 'rgba(255,255,255,0.34)'));
      const iconPath = iconPathForRow(row);
      const rowTop = padT + idx * rowH;
      const barTop = rowTop + Math.round((rowH - barH) / 2);
      const iconTop = rowTop + Math.round((rowH - iconSize) / 2);
      const iconLeft = padL + barW + iconGap;

      return [
        `<rect x="${padL}" y="${barTop}" width="${barW}" height="${barH}" rx="2" fill="${barColor}" />`,
        iconPath
          ? `<image href="${iconPath}" x="${iconLeft}" y="${iconTop}" width="${iconSize}" height="${iconSize}" clip-path="url(#clip-icon-${idx})" />`
          : '',
        `<clipPath id="clip-icon-${idx}"><circle cx="${iconLeft + iconSize / 2}" cy="${iconTop + iconSize / 2}" r="${iconSize / 2}" /></clipPath>`,
      ].join('');
    }).join('');

    chartEl.innerHTML = `<svg viewBox="0 0 ${VW} ${totalH}" width="100%" height="100%" preserveAspectRatio="none" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Top 10 Crypto by Market Cap"><defs></defs>${items}</svg>`;
    chartEl.dataset.previewState = 'ready';
    return true;
  }

  async function prepareCandidate(context) {
    const marker = JSON.parse(String(context.signatureParts?.[0] || '').trim());
    const response = await context.fetchFresh('webapp_data/top10_daily_incl_stables.csv');
    const csvText = await response.text();
    const rawRows = parseCsv(csvText);
    const rows = rawRows
      .map((r) => ({
        Date: String(r.Date || '').trim(),
        Rank: strictNumber(r.Rank),
        'Market Cap': strictNumber(r['Market Cap']),
        'Primary Key': String(r['Primary Key'] || '').trim(),
        'Symbol': String(r.Symbol || '').trim(),
        'Is Stable': String(r['Is Stable'] || '').toLowerCase() === 'true',
      }))
      .sort((a, b) => b['Market Cap'] - a['Market Cap']);
    return {
      marker,
      rawRows,
      rows,
      dataHash: await sha256Text(csvText),
    };
  }

  function validateCandidate(candidate) {
    const marker = candidate?.marker;
    const artifact = marker?.artifacts?.['top10_daily_incl_stables.csv'];
    const expectedHash = String(artifact?.sha256 || '').toLowerCase();
    const rows = candidate?.rows;
    if (Number(marker?.schema_version) !== 1 || !String(marker?.generation_id || '').trim()) return false;
    if (!/^[a-f0-9]{64}$/.test(expectedHash) || candidate.dataHash !== expectedHash) return false;
    if (!Array.isArray(rows) || rows.length !== Number(artifact?.rows) || rows.length !== 10) return false;
    if (candidate.rawRows.length !== rows.length) return false;
    const latestDate = String(marker.latest_snapshot_date || marker.latest_date || '');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(latestDate)) return false;
    const ranks = new Set();
    const primaryKeys = new Set();
    const symbols = new Set();
    for (let index = 0; index < rows.length; index += 1) {
      const row = rows[index];
      if (row.Date !== latestDate || !Number.isInteger(row.Rank) || row.Rank < 1) return false;
      if (!Number.isFinite(row['Market Cap']) || row['Market Cap'] <= 0) return false;
      if (!row['Primary Key'] || !row.Symbol) return false;
      if (index > 0 && rows[index - 1]['Market Cap'] < row['Market Cap']) return false;
      if (ranks.has(row.Rank) || primaryKeys.has(row['Primary Key']) || symbols.has(row.Symbol)) return false;
      ranks.add(row.Rank);
      primaryKeys.add(row['Primary Key']);
      symbols.add(row.Symbol);
    }
    const installedDate = String(state.marker?.latest_snapshot_date || state.marker?.latest_date || '');
    if (installedDate && latestDate < installedDate) return false;
    return true;
  }

  function initialize() {
    window.WSBPreviewShared?.initThemeSync({
      onThemeChanged: () => dataRefresher?.requestPresent('theme'),
    });
    dataRefresher = window.WSBPreviewShared?.createDataRefresher({
      filename: 'bitcoin_dominance.png',
      urls: ['webapp_data/published_generation.json'],
      intervalMs: AUTO_REFRESH_MS,
      getInstalledSignature: () => state.installedSignature,
      prepare: prepareCandidate,
      validate: (candidate) => {
        if (!validateCandidate(candidate)) {
          throw new Error('Bitcoin dominance preview publication is incomplete or inconsistent.');
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
      onError: (error) => console.warn('Bitcoin dominance preview refresh failed:', error),
    });
    window.addEventListener('resize', () => dataRefresher?.requestPresent('resize'));
    dataRefresher?.start();
  }

  try {
    initialize();
  } catch (error) {
    console.error(error);
    if (document.visibilityState === 'visible') render();
    window.WSBPreviewShared?.markReady?.({ filename: 'bitcoin_dominance.png' });
  }
}());
