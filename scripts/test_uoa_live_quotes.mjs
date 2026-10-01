#!/usr/bin/env node
/* Selected-pair projection contracts without touching published data files. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const window = {};
const context = vm.createContext({ window, document: { addEventListener() {} } });
vm.runInContext(readFileSync('webapps/shared/uoa_live_quotes.js', 'utf8'), context);
const { project } = window.WSBUoaLiveQuotes;
const at = Date.parse('2026-10-01T12:00:00Z');
const publishedAt = '2026-09-30 17:06:42.153039 UTC';
const rows = [{ date: new Date('2026-09-30T00:00:00Z'), price: 84000, blockHeight: 969322 }];
const snapshot = { BTC: 84000, USD: 1, EUR: 1.12, JPY: 0.0064 };
const quotes = {
  BTC: { usd: 85000, at: at - 1000, source: 'Coinbase live' },
  EUR: { usd: 1.13, at: at - 2000, source: 'TradingView FX' },
  JPY: { usd: 0.0063, at: at - 3000, source: 'TradingView FX' },
};

const btcEur = project(rows, ['BTC', 'EUR'], quotes, snapshot, publishedAt, at);
assert.equal(btcEur.rows.length, 2, 'today gets a provisional endpoint');
assert.equal(btcEur.rows.at(-1).date.toISOString().slice(0, 10), '2026-10-01');
assert.equal(btcEur.rows.at(-1).liveUsdValues.BTC, 85000);
assert.equal(btcEur.rows.at(-1).liveUsdValues.EUR, 1.13);
assert.equal(btcEur.rows.at(-1).liveUsdValues.JPY, undefined, 'unselected currency is untouched');
assert.equal(btcEur.rows.at(-1).blockHeight, 969322, 'published block stays attached');
assert.equal(rows[0].price, 84000, 'published row remains immutable');

const eurJpy = project(rows, ['EUR', 'JPY'], quotes, snapshot, publishedAt, at);
assert.equal(eurJpy.rows.at(-1).liveUsdValues.EUR / eurJpy.rows.at(-1).liveUsdValues.JPY,
  1.13 / 0.0063, 'fiat cross uses USD legs');

const pending = project(rows, ['BTC', 'EUR'], { BTC: quotes.BTC }, snapshot, publishedAt, at);
assert.equal(pending.rows.at(-1).liveUsdValues.EUR, 1.12,
  'selected currency keeps its snapshot while its live quote is pending');

const old = project(rows, ['BTC', 'EUR'], {
  BTC: { ...quotes.BTC, at: Date.parse('2026-09-30T16:00:00Z') },
  EUR: { ...quotes.EUR, at: Date.parse('2026-09-30T16:00:00Z') },
}, snapshot, publishedAt, at);
assert.equal(old.rows, rows, 'newer publication wins over cached quotes');

const disconnected = project(rows, ['BTC', 'EUR'], {
  BTC: { ...quotes.BTC, live: false, connected: false },
}, snapshot, publishedAt, at);
assert.equal(disconnected.rows.at(-1).liveUsdValues.BTC, 85000,
  'a dropped feed retains its latest accepted price');

const refreshedRows = [{ date: new Date('2026-10-01T00:00:00Z'), price: 86000, blockHeight: 969500 }];
const refreshed = project(refreshedRows, ['BTC', 'EUR'], quotes,
  { ...snapshot, BTC: 86000 }, '2026-10-01 12:30:00 UTC',
  Date.parse('2026-10-01T12:35:00Z'));
assert.equal(refreshed.rows, refreshedRows, 'a newer published refresh replaces older retained live data');

const weekendAt = Date.parse('2026-10-04T12:00:00Z');
const weekend = project(rows, ['BTC', 'EUR'], {
  BTC: { ...quotes.BTC, at: weekendAt - 1000 },
}, snapshot, publishedAt, weekendAt);
assert.equal(weekend.rows.at(-1).date.toISOString().slice(0, 10), '2026-10-04',
  'a live BTC quote can bridge a weekend without inventing intermediate rows');
assert.equal(weekend.rows.at(-1).liveUsdValues.EUR, 1.12,
  'the other selected leg keeps its published value');

const overnight = project(rows, ['BTC', 'EUR'], quotes, snapshot, publishedAt,
  Date.parse('2026-10-02T01:00:00Z'));
assert.equal(overnight.rows.at(-1).date.toISOString().slice(0, 10), '2026-10-01',
  'an old quote must not create a new-day point after midnight');

const timers = new Map();
let nextTimer = 0;
let spotFeed;
const notifications = [];
context.document.visibilityState = 'visible';
context.window.__now = at;
context.window.addEventListener = () => {};
context.window.WSBBitcoinSpotPrice = { create({ onQuote }) {
  spotFeed = { start() {}, stop() {}, emit(quote) { onQuote(quote); } };
  return spotFeed;
} };
context.setTimeout = (callback, delay) => {
  const id = ++nextTimer;
  timers.set(id, { callback, delay });
  return id;
};
context.clearTimeout = (id) => timers.delete(id);
vm.runInContext('Date.now = () => window.__now', context);
const source = window.WSBUoaLiveQuotes.create({ onQuote: (current) => notifications.push(current) });
source.setSelection(['BTC', 'USD']);
source.start();
spotFeed.emit({ price: 85000, at, source: 'Coinbase live' });
assert.equal(notifications.at(-1).BTC.live, true, 'a fresh quote reports live');
const expiry = [...timers.values()].find((timer) => timer.delay === 60000);
assert.ok(expiry, 'a status repaint is scheduled for the 60-second boundary');
context.window.__now = at + 60000;
expiry.callback();
assert.equal(notifications.at(-1).BTC.live, false, 'the dot turns stale automatically after 60 seconds');
assert.equal(notifications.at(-1).BTC.usd, 85000, 'stale status retains the last price');
source.stop();

console.log('UoA selected live quote projection passed');
