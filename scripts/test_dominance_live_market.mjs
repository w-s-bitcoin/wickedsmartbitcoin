import assert from 'node:assert/strict';
import '../webapps/shared/dominance_live_market.js';

const market = globalThis.WSBDominanceLiveMarket;
const names = [
  ['BTC', 'Bitcoin', false], ['ETH', 'Ethereum', false],
  ['USDT', 'Tether', true], ['BNB', 'BNB', false],
  ['XRP', 'XRP', false], ['USDC', 'USDC', true],
  ['SOL', 'Solana', false], ['TRX', 'TRON', false],
  ['ZEC', 'Zcash', false], ['HYPE', 'Hyperliquid', false],
  ['DOGE', 'Dogecoin', false], ['LINK', 'Chainlink', false],
];
const rows = names.map(([symbol, name, stable], i) => ({
  Date: '2026-09-30',
  Rank: i + 1,
  'Primary Key': symbol + name,
  Symbol: symbol,
  Name: name,
  'Market Cap': (12 - i) * 100,
  'Is Stable': String(stable),
}));
const published = { incl: rows.slice(0, 10), excl: rows.filter((row) => row['Is Stable'] === 'false').slice(0, 10) };
const payload = names.map(([symbol, name], i) => ({
  symbol: symbol.toLowerCase(),
  name,
  market_cap: (12 - i) * 100,
  current_price: 2,
  circulating_supply: (12 - i) * 50,
}));
payload[1].market_cap = null; // Price × circulating supply fallback.
const fetchedAt = Date.parse('2026-09-30T12:00:00Z');
const snapshot = market.buildSnapshot(payload, published, fetchedAt);
assert.ok(snapshot);
assert.equal(snapshot.snapshots.incl.length, 10);
assert.equal(snapshot.snapshots.excl.length, 10);
assert.equal(snapshot.snapshots.incl.find((row) => row.Symbol === 'ETH')['Market Cap'], 1100);
assert.equal(snapshot.history.incl.btcd_top10,
  snapshot.snapshots.incl.find((row) => row.Symbol === 'BTC')['Market Cap']
  / snapshot.snapshots.incl.reduce((sum, row) => sum + row['Market Cap'], 0));
assert.ok(snapshot.history.incl.stabled_top10 > 0);
assert.equal(snapshot.history.excl.stabled_top10, 0);
assert.equal(market.buildSnapshot(payload.slice(0, -1), published, fetchedAt), null);

const history = [{ Date: '2026-09-29', btcd_top10: 0.5 }, { Date: '2026-09-30', btcd_top10: 0.6 }];
assert.equal(market.overlayHistory(history, snapshot.history.incl).length, 2);
assert.equal(market.overlayHistory(history, snapshot.history.incl)[1].btcd_top10, snapshot.history.incl.btcd_top10);
const tomorrow = { ...snapshot.history.incl, Date: '2026-10-01' };
assert.equal(market.overlayHistory(history, tomorrow).length, 3);
assert.equal(history[1].btcd_top10, 0.6); // Published rows are untouched.

let time = fetchedAt;
let publishedAt = '2026-09-30T11:00:00Z';
let fail = false;
const feed = market.createFeed({
  getPublished: () => published,
  getPublishedAt: () => publishedAt,
  now: () => time,
  fetchImpl: async () => fail
    ? { ok: false, status: 429 }
    : { ok: true, json: async () => payload },
});
await feed.poll();
assert.equal(feed.isLive(), true);
fail = true;
time += 61000;
await feed.poll();
assert.ok(feed.current()); // An outage retains the last complete snapshot.
assert.equal(feed.isLive(), false);
publishedAt = '2026-09-30T13:00:00Z';
feed.publishedChanged();
assert.equal(feed.current(), null); // Newer publication takes precedence.
console.log('Bitcoin Dominance live market checks passed');
