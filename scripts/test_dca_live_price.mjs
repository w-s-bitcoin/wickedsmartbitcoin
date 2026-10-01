#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const root = new URL('../', import.meta.url);
const app = readFileSync(new URL('webapps/dca_cost_basis/dashboard_app.js', root), 'utf8');
const spot = readFileSync(new URL('webapps/shared/bitcoin_spot_price.js', root), 'utf8');

async function testDcaValuation() {
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
      state, buildCadenceCaches, buildPriceRowsFromSeries, getFrameRows,
      getDateRangeFinalFrameStartIndex,
      encodeDateRangeAnimationWebM,
      setDrawExportFrame(fn) { drawExportFrame = fn; },
      setQuote(quote) { dcaSpotFeed = { current: () => quote }; },
    };`), sandbox);
  const { state, buildCadenceCaches, buildPriceRowsFromSeries, getFrameRows,
    getDateRangeFinalFrameStartIndex,
    encodeDateRangeAnimationWebM, setDrawExportFrame, setQuote } = sandbox.testDca;
  const recovered = buildPriceRowsFromSeries([
    { dateIso: twoDaysAgo, timestampUtc: '', blockHeight: 1, historicalPrice: 100,
      daysAgo: 2, purchaseCount: 2, dcaBasis: 2 / (1 / 100 + 1 / 200) },
    { dateIso: today, timestampUtc: '', blockHeight: 2, historicalPrice: 400,
      daysAgo: 1, purchaseCount: 1, dcaBasis: 400 },
  ]);
  assert.equal(recovered[1].dateIso, yesterday);
  assert.ok(Math.abs(recovered[1].price - 200) < 1e-8,
    'legacy hourly files recover the hidden prior-day purchase price');
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
  assert.equal(rows[0].dateIso, today, 'a live current-day purchase gets its own row');
  assert.equal(rows[0].dcaBasis, 400);
  assert.ok(Math.abs(rows[1].dcaBasis - 2 / (1 / 200 + 1 / 400)) < 1e-8,
    'yesterday’s fixed purchase and today’s live purchase set the rolling basis');
  assert.equal(rows[1].historicalPrice, 200);
  assert.equal(rows[0].currentPrice, 400, 'the current valuation still uses live spot');
  setQuote({ price: 800, source: 'Coinbase live', at: Date.now() });
  rows = getFrameRows(twoDaysAgo, yesterday, true);
  assert.equal(rows[0].dcaBasis, 800, 'every accepted quote recalculates today’s basis');
  assert.ok(Math.abs(rows[1].dcaBasis - 2 / (1 / 200 + 1 / 800)) < 1e-8);
  rows = getFrameRows(twoDaysAgo, yesterday);
  assert.equal(rows[0].dateIso, yesterday, 'export frames retain the published end date');
  assert.equal(rows[0].dcaBasis, 200);

  state.cadence = 'weekly_dca';
  if (new Date(`${today}T00:00:00Z`).getUTCDay() !== 5) {
    rows = getFrameRows(twoDaysAgo, yesterday, true);
    assert.equal(rows[0].dateIso, today);
    assert.equal(rows[0].purchaseCount, rows[1].purchaseCount,
      'a day without a weekly purchase does not invent a buy');
  }

  state.cadence = 'daily_dca';
  state.dateRange.rangeTracksLatestEnd = false;
  const frozenQuote = { price: 800, source: 'Coinbase live', at: Date.now() };
  setQuote({ price: 1200, source: 'Coinbase live', at: Date.now() });
  rows = getFrameRows(twoDaysAgo, yesterday, true, frozenQuote);
  assert.equal(rows[0].dcaBasis, 800, 'the export can freeze the final live quote');
  assert.equal(getFrameRows(twoDaysAgo, yesterday, true)[0].dcaBasis, 200,
    'a fixed on-screen historical range remains published');
  assert.equal(getDateRangeFinalFrameStartIndex([yesterday, twoDaysAgo, yesterday, yesterday]), 2,
    'the initial hold remains historical and the final motion frame begins the live hold');
  assert.equal(getDateRangeFinalFrameStartIndex([yesterday]), 0);

  const captured = [];
  setDrawExportFrame(async (_ctx, _canvas, _date, _settings, _palette, exportRows) => {
    captured.push(exportRows);
  });
  sandbox.window.WSBDashboardExport = {
    async encodeWebM({ frames, renderFrame }) {
      for (let index = 0; index < frames.length; index += 1) {
        await renderFrame(frames[index], {}, index);
        if (index === 2) setQuote({ price: 1600, source: 'Coinbase live', at: Date.now() });
      }
      return null;
    },
  };
  state.dateRange.startIso = twoDaysAgo;
  await encodeDateRangeAnimationWebM({
    canvas: { width: 100, height: 100 }, ctx: {}, settings: { quality: 720 },
    theme: 'dark', palette: {},
    frameDates: [yesterday, twoDaysAgo, yesterday, yesterday],
  });
  assert.equal(captured[0][0].dcaBasis, 200, 'the opening hold stays on published data');
  assert.equal(captured[1][0].dateIso, twoDaysAgo, 'historical motion frames stay published');
  assert.equal(captured[2][0].dcaBasis, 1200, 'the final motion frame uses the latest accepted quote');
  assert.equal(captured[3][0].dcaBasis, 1200, 'the final hold freezes that live generation');
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
  const firstQuoteAt = quotes.at(-1).at;
  now += 1000;
  socket.onmessage({ data: JSON.stringify({
    type: 'ticker', product_id: 'BTC-USD', price: '400', time: new Date(now).toISOString(),
  }) });
  assert.ok(quotes.at(-1).at > firstQuoteAt,
    'a fresh accepted quote updates the timestamp even when its price is unchanged');
  const repeatedAt = quotes.at(-1).at;
  const notices = quotes.length;
  now += 1000;
  socket.onmessage({ data: JSON.stringify({
    type: 'ticker', product_id: 'BTC-USD', price: '400', time: new Date(repeatedAt).toISOString(),
  }) });
  assert.equal(quotes.length, notices + 1, 'a repeated exchange tick refreshes the live-status clock');
  assert.equal(quotes.at(-1).receivedAt, now);

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
  assert.equal(feed.last().price, 400, 'the accepted quote remains available after the feed stalls');
  assert.equal(feed.isLive(), false, 'the retained quote is not labelled live');
  assert.equal(feed.newerThan(new Date(firstQuoteAt - 1000).toISOString())?.price, 400,
    'the retained quote wins over an older publication');
  assert.equal(feed.newerThan(new Date(repeatedAt - 3600000).toISOString()
    .slice(0, 19).replace('T', ' '))?.price, 400,
  'a zone-free published CSV timestamp is interpreted as UTC');
  assert.equal(feed.newerThan(new Date(now + 1000).toISOString()), null,
    'a newer publication wins over the retained quote');
  assert.equal(quotes.at(-1), null);
  feed.stop();
}

await testDcaValuation();
await testSpotFeed();
console.log('DCA live price regressions passed.');
