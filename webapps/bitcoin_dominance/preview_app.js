(function () {
  const THEME_KEY = 'quantum-research-dashboard-theme';

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

  function num(value) {
    const normalized = Number(String(value ?? '').replaceAll(',', '').trim());
    return Number.isFinite(normalized) ? normalized : 0;
  }

  let cachedRows = null;

  function render() {
    const chartEl = document.getElementById('previewChart');
    if (!chartEl || !cachedRows) return;

    const rows = cachedRows;
    if (!rows.length) { chartEl.innerHTML = ''; return; }

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
      const iconPath = row['Primary Key']
        ? `icons/${encodeURIComponent(row['Primary Key'])}.png`
        : (row['Symbol'] ? `icons/${encodeURIComponent(row['Symbol'].toUpperCase())}.png` : null);
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
  }

  async function load() {
    const resp = await fetch('webapp_data/top10_daily_incl_stables.csv', { cache: 'default' });
    if (!resp.ok) throw new Error(`Failed to load top10_daily_incl_stables.csv (${resp.status}).`);

    cachedRows = parseCsv(await resp.text())
      .map((r) => ({
        'Market Cap': num(r['Market Cap']) || 0,
        'Primary Key': String(r['Primary Key'] || '').trim(),
        'Symbol': String(r.Symbol || '').trim(),
        'Is Stable': String(r['Is Stable'] || '').toLowerCase() === 'true',
      }))
      .filter((r) => r['Market Cap'] > 0)
      .sort((a, b) => b['Market Cap'] - a['Market Cap'])
      .slice(0, 10);
  }

  async function init() {
    initThemeSync();
    await load();
    render();
    window.addEventListener('resize', render);
  }

  init().catch((error) => {
    console.error(error);
  });
}());
