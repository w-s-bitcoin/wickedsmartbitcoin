#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const root = new URL('../', import.meta.url);
const app = readFileSync(new URL('webapps/dca_cost_basis/dashboard_app.js', root), 'utf8');
const spot = readFileSync(new URL('webapps/shared/bitcoin_spot_price.js', root), 'utf8');

function testDcaValuation() {
  const today = new Date().toISOString().slice(0, 10);
  const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  const twoDaysAgo = new Date(Date.now() - 2 * 86400000).toISOString().slice(0, 10);
  const sandbox = {
    console,
    localStorage: { getItem: () => null },
    window: {
      location: { hostname: 'localhost' },
      addEventListener() {},
      WSBDashboardComponents: {},
    },
    document: {
      documentElement: { dataset: { theme: 'dark' } },
      addEventListener() {},
      dispatchEvent() {},
      getElementById: () => null,
    },
    CustomEvent: class {},
  };
  vm.createContext(sandbox);
  vm.runInContext(app.replace(/\binit\(\);\s*$/, `
    globalThis.testDca = {
      state, buildCadenceCaches, getFrameRows,
      setQuote(quote) { dcaSpotFeed = { current: () => quote }; },
    };`), sandbox);
  const { state, buildCadenceCaches, getFrameRows, setQuote } = sandbox.testDca;
  state.priceRows = [
    { dateIso: yesterday, timestampUtc: '', blockHeight: 1, price: 100, utcDay: new Date(`${yesterday}T00:00:00Z`).getUTCDay(), monthDay: Number(yesterday.slice(8)) },
    { dateIso: today, timestampUtc: '', blockHeight: 2, price: 200, utcDay: new Date(`${today}T00:00:00Z`).getUTCDay(), monthDay: Number(today.slice(8)) },
  ];
  state.cadenceCaches = buildCadenceCaches(state.priceRows);
  Object.assign(state.dateRange, { startIso: yesterday, endIso: today, currentEndIso: today, rangeTracksLatestEnd: true });
  setQuote({ price: 400, source: 'Coinbase live', at: Date.now() });

  let rows = getFrameRows(yesterday, today, true);
  assert.equal(rows[0].dcaBasis, 400, 'today’s first daily buy uses the live price');
  assert.equal(rows[0].historicalPrice, 400);
  assert.ok(Math.abs(rows[1].dcaBasis - 160) < 1e-8, 'rolling basis replaces today’s published buy');
  assert.equal(rows[1].currentPrice, 400);
  rows = getFrameRows(yesterday, today);
  assert.equal(rows[0].currentPrice, 200, 'export/playback frames remain published and deterministic');
  assert.ok(Math.abs(rows[1].dcaBasis - 133.33333333333334) < 1e-8);

  state.dateRange.rangeTracksLatestEnd = false;
  assert.equal(getFrameRows(yesterday, today, true)[0].currentPrice, 200, 'fixed historical range ignores live spot');
  state.dateRange.rangeTracksLatestEnd = true;
  state.priceRows[0].dateIso = twoDaysAgo;
  state.priceRows[1].dateIso = yesterday;
  state.cadenceCaches = buildCadenceCaches(state.priceRows);
  rows = getFrameRows(twoDaysAgo, yesterday, true);
  assert.equal(rows[0].dcaBasis, 200, 'yesterday’s purchase keeps its published price');
  assert.equal(rows[0].historicalPrice, 200);
  assert.equal(rows[0].currentPrice, 400, 'the current valuation still uses live spot');
}

async function testSpotFeed() {
  let now = Date.now();
  let nextId = 1;
  const timers = new Map();
  const events = new Map();
  const quotes = [];
  const sockets = [];
  let restPrice = 300;
  const FakeDate = class extends Date { static now() { return now; } };
  class FakeSocket {
    constructor(url) { this.url = url; sockets.push(this); }
    send(payload) { this.subscription = JSON.parse(payload); }
    close() { this.closed = true; }
  }
  const sandbox = {
    Date: FakeDate,
    WebSocket: FakeSocket,
    AbortController,
    fetch: async () => ({ ok: true, json: async () => ({ last: String(restPrice) }) }),
    window: {
      setTimeout(fn, delay) { const id = nextId++; timers.set(id, { at: now + delay, fn }); return id; },
    },
    document: {
      visibilityState: 'visible',
      addEventListener(type, fn) { events.set(type, fn); },
      removeEventListener(type) { events.delete(type); },
    },
  };
  sandbox.clearTimeout = (id) => timers.delete(id);
  sandbox.window.clearTimeout = sandbox.clearTimeout;
  vm.createContext(sandbox);
  vm.runInContext(spot, sandbox);
  const feed = sandbox.window.WSBBitcoinSpotPrice.create({ onQuote: (quote) => quotes.push(quote) });
  feed.start();
  const socket = sockets[0];
  socket.onopen();
  assert.equal(socket.subscription.channels[0], 'ticker_batch');
  socket.onmessage({ data: JSON.stringify({ type: 'ticker', product_id: 'ETH-USD', price: '1000' }) });
  assert.equal(quotes.length, 0, 'other products do not affect BTC');
  socket.onmessage({ data: JSON.stringify({
    type: 'ticker', product_id: 'BTC-USD', price: '400', time: new Date(now).toISOString(),
  }) });
  assert.equal(feed.current().price, 400);
  assert.equal(quotes.at(-1).source, 'Coinbase live');

  // A REST response already in flight must not overwrite a newer socket tick.
  restPrice = 300;
  for (const [id, timer] of [...timers]) {
    if (timer.at === now) { timers.delete(id); timer.fn(); }
  }
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(feed.current().price, 400);

  sandbox.document.visibilityState = 'hidden';
  events.get('visibilitychange')();
  assert.equal(socket.closed, true, 'hidden documents release the socket');
  now += 90002;
  for (const [id, timer] of [...timers]) {
    if (timer.at <= now) { timers.delete(id); timer.fn(); }
  }
  assert.equal(feed.current(), null, 'stale quotes fall back to the published snapshot');
  assert.equal(quotes.at(-1), null);
  feed.stop();
}

testDcaValuation();
await testSpotFeed();
console.log('DCA live price regressions passed.');
