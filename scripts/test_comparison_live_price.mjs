#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../webapps/shared/comparison_live_price.js', import.meta.url), 'utf8');
const sandbox = { window: {}, Date, Intl };
vm.createContext(sandbox);
vm.runInContext(source, sandbox);
const { withQuotes, lastEquitySessionDay } = sandbox.window.WSBComparisonLivePrice;

const now = Date.parse('2026-09-30T15:00:00Z');
const rows = [{ date: '2026-09-29', BTC: 80000, XAU: 4100, XAG: 49,
  SPY: 760, QQQ: 730, TLT: 78, MSTR: 155, height: 969209 }];
const quotes = {
  BTC: { price: 81000, day: '2026-09-30', checkedAt: now - 1000 },
  XAU: { price: 4200, day: '2026-09-30', checkedAt: now - 2000 },
  SPY: { price: 765, day: '2026-09-30', checkedAt: now - 3000 },
  QQQ: { price: 999, day: '2026-09-29', checkedAt: now - 3000 },
};
let result = withQuotes(rows, quotes, now);
assert.equal(result.length, 2);
assert.equal(result.at(-1).date, '2026-09-30');
assert.equal(result.at(-1).BTC, 81000);
assert.equal(result.at(-1).XAU, 4200);
assert.equal(result.at(-1).SPY, 765);
assert.equal(result.at(-1).QQQ, 730, 'a previous-day quote must not become today’s price');
assert.equal(result.at(-1).XAG, 49, 'missing quotes use the published fallback');
assert.equal(result.at(-1).height, 969209, 'the supply cap retains the published block height');
assert.equal(rows[0].BTC, 80000, 'published history must not be mutated');

result = withQuotes([{ ...rows[0], date: '2026-09-30' }], quotes, now);
assert.equal(result.length, 1);
assert.equal(result[0].BTC, 81000);
assert.equal(result[0].XAU, 4200);
assert.equal(withQuotes(rows, { BTC: { ...quotes.BTC, checkedAt: now - 180001 } }, now), rows);
assert.equal(withQuotes([{ ...rows[0], date: '2026-09-27' }], quotes, now).length, 1,
  'a multi-day gap must not fabricate omitted purchases');

assert.equal(lastEquitySessionDay(Date.parse('2026-09-29T15:00:00Z')), '2026-09-29');
assert.equal(lastEquitySessionDay(Date.parse('2026-09-30T05:00:00Z')), '2026-09-29');
assert.equal(lastEquitySessionDay(Date.parse('2026-09-27T15:00:00Z')), '2026-09-25');
console.log('DCA Comparison current-day price calculations passed.');
