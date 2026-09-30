#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../webapps/shared/comparison_live_price.js', import.meta.url), 'utf8');
const sandbox = { window: {}, Date, Intl };
vm.createContext(sandbox);
vm.runInContext(source, sandbox);
const { project, withQuotes, lastEquitySessionDay, publishedInstant } = sandbox.window.WSBComparisonLivePrice;

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
assert.equal(result.at(-1).QQQ, 999, 'the last quote remains until a newer publication');
assert.equal(result.at(-1).XAG, 49, 'missing quotes use the published fallback');
assert.equal(result.at(-1).height, 969209, 'the supply cap retains the published block height');
assert.equal(rows[0].BTC, 80000, 'published history must not be mutated');

result = withQuotes([{ ...rows[0], date: '2026-09-30' }], quotes, now);
assert.equal(result.length, 1);
assert.equal(result[0].BTC, 81000);
assert.equal(result[0].XAU, 4200);
assert.equal(withQuotes(rows, { BTC: { ...quotes.BTC, checkedAt: now - 180001 } }, now).at(-1).BTC,
  81000, 'a disconnected quote remains in this tab');
assert.equal(project(rows, quotes, now, now - 1500).rows.at(-1).XAU, 4100,
  'a newer published generation replaces the older gold quote');
assert.equal(project(rows, quotes, now, now - 500).rows, rows,
  'publication newer than every quote wins');
assert.equal(withQuotes(rows, { BTC: quotes.BTC }, Date.parse('2026-10-01T01:00:00Z')).at(-1).date,
  '2026-09-30', 'a retained quote must not invent an October 1 purchase');
assert.equal(publishedInstant('2026-09-29 23:11:13.991202 UTC'),
  Date.parse('2026-09-29T23:11:13.991Z'));
assert.equal(publishedInstant('2026-09-29 22:00:00'), Date.parse('2026-09-29T22:00:00Z'));
assert.equal(withQuotes([{ ...rows[0], date: '2026-09-27' }], quotes, now).length, 1,
  'a multi-day gap must not fabricate omitted purchases');

assert.equal(lastEquitySessionDay(Date.parse('2026-09-29T15:00:00Z')), '2026-09-29');
assert.equal(lastEquitySessionDay(Date.parse('2026-09-30T05:00:00Z')), '2026-09-29');
assert.equal(lastEquitySessionDay(Date.parse('2026-09-27T15:00:00Z')), '2026-09-25');
console.log('DCA Comparison current-day price calculations passed.');
