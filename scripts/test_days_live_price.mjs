#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../webapps/shared/ath_live_price.js', import.meta.url), 'utf8');
const sandbox = { window: {} };
vm.createContext(sandbox);
vm.runInContext(source, sandbox);
const { observeHigh, withQuote } = sandbox.window.WSBAthLivePrice;

const today = new Date().toISOString().slice(0, 10);
const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
const twoDaysAgo = new Date(Date.now() - 2 * 86400000).toISOString().slice(0, 10);
const now = Date.now();
const rows = [
  { date: twoDaysAgo, price: 120, athPrice: 120, athDate: twoDaysAgo,
    daysSinceAth: 0, isAth: true, height: 1, snapshotPrice: 118 },
  { date: today, price: 100, athPrice: 120, athDate: twoDaysAgo,
    daysSinceAth: 2, isAth: false, height: 2, snapshotPrice: 95 },
];

let displayed = withQuote(rows, { price: 90, at: now }, now);
assert.equal(displayed.at(-1).price, 100, 'a falling spot price does not lower the daily high');
assert.equal(displayed.at(-1).spotPrice, 90);
assert.equal(displayed.at(-1).daysSinceAth, 2);
assert.equal(rows.at(-1).spotPrice, undefined, 'published history stays unchanged');

displayed = withQuote(rows, { price: 130, at: now }, now);
assert.equal(displayed.at(-1).price, 130);
assert.equal(displayed.at(-1).athPrice, 130);
assert.equal(displayed.at(-1).athDate, today);
assert.equal(displayed.at(-1).daysSinceAth, 0, 'a live ATH resets elapsed days');
const observed = observeHigh(observeHigh(null, { price: 130, at: now }), { price: 90, at: now });
displayed = withQuote(rows, { price: 90, at: now }, now, observed);
assert.equal(displayed.at(-1).price, 130, 'a later lower quote retains the observed daily high');
assert.equal(displayed.at(-1).athPrice, 130, 'a later lower quote retains the observed ATH');
assert.equal(displayed.at(-1).spotPrice, 90, 'drawdown still uses the latest spot');

const priorDayRows = [rows[0], { ...rows[1], date: yesterday, daysSinceAth: 1 }];
displayed = withQuote(priorDayRows, { price: 110, at: now }, now);
assert.equal(displayed.length, 3, 'a missing current-day row is modeled without changing published rows');
assert.equal(displayed.at(-1).date, today);
assert.equal(displayed.at(-1).height, null, 'a quote does not invent a block height');
assert.equal(displayed.at(-1).athPrice, 120);
assert.equal(displayed.at(-1).daysSinceAth, 2);

assert.equal(withQuote(rows, { price: 130, at: now - 86400000 }, now), rows,
  'a previous-day quote does not rewrite a newer published day');
displayed = withQuote(priorDayRows, { price: 130, at: now - 86400000 }, now);
assert.equal(displayed.at(-1).spotPrice, 130,
  'a retained previous-day quote stays on its day after midnight');
displayed = withQuote([rows[0]], { price: 130, at: now }, now);
assert.equal(displayed.length, 2,
  'a multi-day publication gap adds one provisional quote day without inventing intermediate highs');
for (const gap of [3, 7]) {
  const at = now + gap * 86400000;
  const low = withQuote(rows, { price: 90, at }, at);
  assert.equal(low.length, rows.length + 1);
  assert.equal(low.at(-1).spotPrice, 90);
  assert.equal(low.at(-1).daysSinceAth, gap + 2, 'elapsed time counts calendar days, including missing observations');
  assert.equal(low.at(-1).athPrice, 120);
  const high = observeHigh(null, { price: 140, at });
  const fallen = withQuote(rows, { price: 90, at: at + 1000 }, at + 1000, high);
  assert.equal(fallen.at(-1).athPrice, 140);
  assert.equal(fallen.at(-1).spotPrice, 90);
  assert.equal(fallen.at(-1).daysSinceAth, 0);
  rows.forEach((row, index) => assert.equal(fallen[index], row));
}
console.log('Days Since ATH live price calculations passed.');
