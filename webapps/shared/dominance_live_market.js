(function (root) {
  'use strict';

  const URL = 'https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=100&page=1&sparkline=false';
  const POLL_MS = 60000;
  const FRESH_MS = 60000;

  function positive(value) {
    const number = Number(value);
    return Number.isFinite(number) && number > 0 ? number : 0;
  }

  function primaryKey(coin) {
    return `${String(coin?.symbol || '').toUpperCase().trim()}${String(coin?.name || '').trim()}`;
  }

  // Use the same primary keys and stablecoin classifications as the published
  // dataset. A new coin enters this universe at the next producer publication.
  function buildSnapshot(payload, published, fetchedAt = Date.now()) {
    if (!Array.isArray(payload) || !Array.isArray(published?.incl) || !Array.isArray(published?.excl)) return null;
    const known = new Map();
    for (const mode of ['incl', 'excl']) {
      for (const row of published[mode]) {
        const key = String(row['Primary Key'] || '').trim();
        if (key) known.set(key, row);
      }
    }
    if (known.size < 10 || !known.has('BTCBitcoin')) return null;
    const quotes = new Map();
    for (const coin of payload) {
      const key = primaryKey(coin);
      if (!known.has(key) || quotes.has(key)) continue;
      const price = positive(coin.current_price);
      const supply = positive(coin.circulating_supply);
      const cap = positive(coin.market_cap) || (price && supply ? price * supply : 0);
      if (!cap) continue;
      quotes.set(key, {
        ...known.get(key),
        Date: new Date(fetchedAt).toISOString().slice(0, 10),
        'Market Cap': cap,
        Price: price,
        'Circulating Supply': supply,
        'Snapshot Type': 'live',
      });
    }
    // Never combine fresh quotes with old caps in the same top-10 denominator.
    if (quotes.size !== known.size) return null;
    const snapshots = {};
    const history = {};
    for (const mode of ['incl', 'excl']) {
      const keys = new Set(published[mode].map((row) => row['Primary Key']));
      const rows = [...quotes.entries()]
        .filter(([key]) => keys.has(key))
        .map(([, row]) => row)
        .sort((a, b) => b['Market Cap'] - a['Market Cap'])
        .slice(0, 10)
        .map((row, index) => ({ ...row, Rank: index + 1 }));
      if (rows.length !== 10 || !rows.some((row) => row['Primary Key'] === 'BTCBitcoin')) return null;
      const total = rows.reduce((sum, row) => sum + row['Market Cap'], 0);
      const btc = rows.find((row) => row['Primary Key'] === 'BTCBitcoin')['Market Cap'];
      const stable = rows.reduce((sum, row) => sum + (String(row['Is Stable']).toLowerCase() === 'true' ? row['Market Cap'] : 0), 0);
      snapshots[mode] = rows;
      history[mode] = {
        Date: rows[0].Date,
        btcd_top10: btc / total,
        stabled_top10: stable / total,
        otherd_top10: (total - btc - stable) / total,
      };
    }
    return { snapshots, history, fetchedAt };
  }

  function overlayHistory(publishedRows, liveRow) {
    if (!liveRow || !Array.isArray(publishedRows) || !publishedRows.length) return publishedRows;
    const last = publishedRows[publishedRows.length - 1];
    if (liveRow.Date < last.Date) return publishedRows;
    if (liveRow.Date === last.Date) return [...publishedRows.slice(0, -1), { ...last, ...liveRow }];
    return [...publishedRows, { ...last, ...liveRow }];
  }

  function createFeed({ getPublished, getPublishedAt, onChange, fetchImpl = root.fetch.bind(root), now = Date.now }) {
    let latest = null;
    let inFlight = false;
    let timer = null;
    let statusTimer = null;
    let started = false;

    function current() {
      const publishedAt = Date.parse(getPublishedAt?.() || '') || 0;
      return latest && latest.fetchedAt > publishedAt ? latest : null;
    }

    function isLive() {
      const value = current();
      return Boolean(value && now() - value.fetchedAt < FRESH_MS);
    }

    function publishedChanged() {
      if (latest && !current()) latest = null;
      onChange?.(true);
    }

    async function poll() {
      if (inFlight || root.document?.visibilityState === 'hidden') return;
      const published = getPublished?.();
      if (!published?.incl?.length || !published?.excl?.length) return;
      inFlight = true;
      try {
        const response = await fetchImpl(URL, { cache: 'no-store' });
        if (!response.ok) throw new Error(`CoinGecko HTTP ${response.status}`);
        const fetchedAt = now();
        const candidate = buildSnapshot(await response.json(), getPublished?.(), fetchedAt);
        if (!candidate) throw new Error('Incomplete Bitcoin Dominance market snapshot');
        if (candidate.fetchedAt > (Date.parse(getPublishedAt?.() || '') || 0)) {
          latest = candidate;
          onChange?.();
        }
      } catch (error) {
        // Keep the last complete live snapshot; the UI marks it stale after 60s.
        root.console?.warn?.('Bitcoin Dominance live market refresh failed:', error);
      } finally {
        inFlight = false;
      }
    }

    function start() {
      if (started) return;
      started = true;
      void poll();
      timer = root.setInterval(poll, POLL_MS);
      statusTimer = root.setInterval(() => onChange?.(true), 5000);
      root.document?.addEventListener('visibilitychange', () => {
        if (root.document.visibilityState === 'visible') void poll();
      });
      root.addEventListener?.('online', poll);
    }

    function stop() {
      root.clearInterval(timer);
      root.clearInterval(statusTimer);
      started = false;
    }

    return { current, isLive, poll, publishedChanged, start, stop };
  }

  root.WSBDominanceLiveMarket = { buildSnapshot, overlayHistory, createFeed };
}(typeof window !== 'undefined' ? window : globalThis));
