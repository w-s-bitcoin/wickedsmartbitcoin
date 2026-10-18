import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createHash, webcrypto } from "node:crypto";
import { runInNewContext } from "node:vm";
import test from "node:test";
import "../webapps/moving_average/moving_average_model.js";

const M = globalThis.WSBMovingAverageModel;
if (!globalThis.crypto) Object.defineProperty(globalThis, "crypto", { value: webcrypto });
const utc = (date) => Date.parse(`${date}T00:00:00Z`);
const iso = (time) => new Date(time).toISOString().slice(0, 10);
function rowsFrom(first, count, price = (index) => index + 1) {
  return Array.from({ length: count }, (_, index) => {
    const time = utc(first) + index * M.DAY_MS;
    return { date: iso(time), time, price: price(index) };
  });
}
function at(model, values, date) {
  return values[model.rows.findIndex((row) => row.date === date)];
}
function approximate(actual, expected) {
  assert.ok(Math.abs(actual - expected) <= Math.max(1e-10, Math.abs(expected) * 1e-10), `${actual} != ${expected}`);
}
function publication(rows, timestamp) {
  const csv = "date,timestamp,price,block_height\n" + rows.map((row, index) =>
    `${row.date},${index === rows.length - 1 && timestamp ? timestamp : `${row.date} 23:59:59`},${row.price},${index}`).join("\n") + "\n";
  const marker = {
    schema_version: 1,
    artifact: { path: "assets/daily_price.csv", rows: rows.length, sha256: createHash("sha256").update(csv).digest("hex") },
    first_date: rows[0].date, latest_date: rows.at(-1).date,
    latest_timestamp: timestamp || `${rows.at(-1).date} 23:59:59`, latest_block_height: rows.length - 1,
  };
  return { csv, marker, signature: JSON.stringify(marker) };
}
function fetchFixture(publication, finalMarker = publication.signature) {
  const calls = [];
  const fetchFresh = async (url) => {
    calls.push(url);
    const text = url === M.DATA_URL ? publication.csv : calls.length > 1 ? finalMarker : publication.signature;
    return { ok: true, text: async () => text };
  };
  return { fetchFresh, calls };
}

test("daily values follow the notebook's prior-N mean and exclude the current price", () => {
  const source = rowsFrom("2010-01-01", 300, (index) => index < 5 ? 0 : index ** 2 + 1);
  const model = M.buildModel(source), values = M.calculate(model, { period: 200, unit: "day" });
  assert.equal(model.rows[0].date, source[5].date);
  assert.equal(values[199], null);
  for (let index = 200; index < model.rows.length; index += 1) {
    approximate(values[index], model.rows.slice(index - 200, index).reduce((sum, row) => sum + row.price, 0) / 200);
  }
  assert.equal(M.calculate(model, { period: 3, unit: "day" })[3], (26 + 37 + 50) / 3);
});

test("weekly values match prior Sunday closes and calculate a causal latest endpoint", () => {
  const model = M.buildModel(rowsFrom("2010-01-01", 1600, (index) => index ** 2 + 1));
  const values = M.calculate(model, { period: 200, unit: "week" });
  const sundays = model.rows.filter((row) => new Date(row.time).getUTCDay() === 0);
  for (let index = 200; index < sundays.length; index += 1) {
    const expected = sundays.slice(index - 200, index).reduce((sum, row) => sum + row.price, 0) / 200;
    approximate(at(model, values, sundays[index].date), expected);
  }
  const endpoint = model.rows.at(-1);
  assert.notEqual(new Date(endpoint.time).getUTCDay(), 0);
  approximate(values.at(-1), sundays.filter((row) => row.time < endpoint.time).slice(-200).reduce((sum, row) => sum + row.price, 0) / 200);
  assert.equal(values[1399], null, "200 weeks must span 1400 days even when enough Sunday observations exist");
});

test("monthly averages use actual month-end closes, exclude the current close, and handle leap years", () => {
  const model = M.buildModel(rowsFrom("2024-01-01", 160));
  const values = M.calculate(model, { period: 3, unit: "month" });
  const price = (date) => model.rows.find((row) => row.date === date).price;
  assert.equal(at(model, values, "2024-03-31"), null);
  approximate(at(model, values, "2024-04-01"), (price("2024-01-31") + price("2024-02-29") + price("2024-03-31")) / 3);
  approximate(at(model, values, "2024-04-30"), at(model, values, "2024-04-01"));
  approximate(at(model, values, "2024-05-31"), (price("2024-02-29") + price("2024-03-31") + price("2024-04-30")) / 3);
  approximate(at(model, values, "2024-06-01"), (price("2024-03-31") + price("2024-04-30") + price("2024-05-31")) / 3);
  assert.equal(iso(M.windowStart(utc("2024-05-31"), 3, "month")), "2024-02-29");
  assert.equal(iso(M.windowStart(utc("2023-05-31"), 3, "month")), "2023-02-28");
  assert.equal(iso(M.windowStart(utc("2024-03-11"), 3, "day")), "2024-03-08", "DST does not move UTC day boundaries");
});

test("limits use the first positive price and latest date, with complete trailing spans", () => {
  const model = M.buildModel(rowsFrom("2023-12-31", 153, (index) => index === 0 ? 0 : index));
  assert.equal(model.rows[0].date, "2024-01-01");
  assert.deepEqual(model.limits, { day: 151, week: 21, month: 4 });
  for (const unit of ["day", "week", "month"]) {
    assert.ok(M.calculate(model, { period: model.limits[unit], unit }).at(-1) > 0);
    assert.throws(() => M.calculate(model, { period: model.limits[unit] + 1, unit }), RangeError);
    assert.throws(() => M.calculate(model, { period: 2, unit }), RangeError);
    assert.throws(() => M.calculate(model, { period: 3.1, unit }), RangeError);
  }
  assert.equal(M.label({ period: 200, unit: "week" }, true), "200W SMA");
  assert.equal(M.label({ period: 3, unit: "month" }), "3-month simple moving average");
});

test("display windows stay anchored at the price-history start until their full day/week/month span has elapsed", () => {
  const historyStart = utc("2009-10-06");
  for (const [period, unit, threshold] of [[200, "day", "2010-04-24"], [600, "day", "2011-05-29"],
    [200, "week", "2013-08-06"], [12, "month", "2010-10-06"]]) {
    const end = utc(threshold);
    for (const time of [historyStart, historyStart + M.DAY_MS, end - M.DAY_MS, end]) {
      assert.deepEqual(M.windowBounds(time, period, unit), { startTime: historyStart, endTime: end });
    }
    const next = end + M.DAY_MS;
    assert.deepEqual(M.windowBounds(next, period, unit), { startTime: historyStart + M.DAY_MS, endTime: next });
    const later = utc("2024-05-31");
    assert.deepEqual(M.windowBounds(later, period, unit), { startTime: M.windowStart(later, period, unit), endTime: later });
  }
  assert.deepEqual(M.windowBounds(utc("2024-05-31"), 3, "month"), { startTime: utc("2024-02-29"), endTime: utc("2024-05-31") });
  assert.equal(M.windowStart(utc("2009-01-04"), 200, "day"), utc("2008-06-18"), "display anchoring never changes historical lookback calculations");
});

test("EMA seeds from the first N completed closes and recurs without using the active close", () => {
  const prices = [10, 20, 30, 40, 100, 20, 80];
  const model = M.buildModel(rowsFrom("2024-01-01", prices.length, (index) => prices[index]));
  const selection = { period: 3, unit: "day", type: "ema" };
  assert.deepEqual(M.calculate(model, selection), [null, null, null, 20, 30, 65, 42.5]);
  assert.deepEqual(M.calculateCurrent(model, selection), [null, null, null, 20, 30, 65, 61.25]);
  assert.equal(M.label(selection, true), "3D EMA");
  assert.equal(M.label(selection), "3-day exponential moving average");
  assert.equal(M.label({ period: 200, unit: "month", type: "sma" }, true), "200M SMA");
});

test("weekly and monthly EMAs advance only after UTC Sunday and calendar-month closes", () => {
  const weeklyCloses = { "2024-01-07": 10, "2024-01-14": 20, "2024-01-21": 30, "2024-01-28": 40, "2024-02-04": 100 };
  const weekly = M.buildModel(rowsFrom("2024-01-01", 45).map((row) => ({ ...row, price: weeklyCloses[row.date] ?? 1 })));
  const weekValues = M.calculate(weekly, { period: 3, unit: "week", type: "ema" });
  assert.equal(at(weekly, weekValues, "2024-01-21"), null);
  assert.equal(at(weekly, weekValues, "2024-01-22"), 20);
  assert.equal(at(weekly, weekValues, "2024-01-28"), 20);
  assert.equal(at(weekly, weekValues, "2024-01-29"), 30);
  assert.equal(at(weekly, weekValues, "2024-02-05"), 65);
  const sundayStart = M.buildModel(weekly.rows.slice(6));
  const gatedWeeks = M.calculate(sundayStart, { period: 3, unit: "week", type: "ema" });
  assert.equal(at(sundayStart, gatedWeeks, "2024-01-22"), null, "three closes alone do not bypass the full three-week span");
  assert.equal(at(sundayStart, gatedWeeks, "2024-01-28"), 20);

  const monthlyCloses = { "2024-01-31": 10, "2024-02-29": 20, "2024-03-31": 30, "2024-04-30": 40, "2024-05-31": 100, "2024-06-30": 20 };
  const monthly = M.buildModel(rowsFrom("2024-01-01", 190).map((row) => ({ ...row, price: monthlyCloses[row.date] ?? 1 })));
  const monthValues = M.calculate(monthly, { period: 3, unit: "month", type: "ema" });
  assert.equal(at(monthly, monthValues, "2024-03-31"), null);
  assert.equal(at(monthly, monthValues, "2024-04-01"), 20);
  assert.equal(at(monthly, monthValues, "2024-04-30"), 20);
  assert.equal(at(monthly, monthValues, "2024-05-01"), 30);
  assert.equal(at(monthly, monthValues, "2024-06-01"), 65);
  assert.equal(at(monthly, monthValues, "2024-07-01"), 42.5);
  const midmonthStart = M.buildModel(monthly.rows.slice(14));
  const gatedMonths = M.calculate(midmonthStart, { period: 3, unit: "month", type: "ema" });
  assert.equal(at(midmonthStart, gatedMonths, "2024-04-01"), null);
  assert.equal(at(midmonthStart, gatedMonths, "2024-04-15"), 20);
});

test("SMA, EMA, and None have separate cached series and legacy selections remain SMA", () => {
  const model = M.buildModel(rowsFrom("2024-01-01", 190, (index) => index ** 2 + 1));
  for (const unit of ["day", "week", "month"]) {
    const selection = { period: 3, unit }, sma = M.calculate(model, selection);
    assert.equal(M.calculate(model, { ...selection, type: "sma" }), sma);
    const ema = M.calculate(model, { ...selection, type: "ema" });
    assert.notEqual(ema, sma);
    assert.notEqual(ema.at(-1), sma.at(-1));
    const none = M.calculate(model, { ...selection, type: "none" });
    assert.equal(none.length, model.rows.length);
    assert.ok(none.every((value) => value === null));
    const currentNone = M.calculateCurrent(model, { ...selection, type: "none" });
    assert.notEqual(currentNone, none);
    assert.deepEqual(currentNone, none);
    assert.equal(M.label({ ...selection, type: "none" }, true), "None");
  }
  assert.ok(M.calculate(model, { type: "none" }).every((value) => value === null));
  assert.equal(M.label({ type: "none" }), "None");
  assert.throws(() => M.calculate(model, { period: 3, unit: "day", type: "wma" }), /type must/);
  assert.throws(() => M.calculate(model, { period: 2, unit: "day", type: "ema" }), RangeError);
});

test("adding future data cannot change any earlier calculated value", () => {
  const rows = rowsFrom("2023-01-01", 500, (index) => index + 10);
  const early = M.buildModel(rows.slice(0, 260));
  const later = M.buildModel(rows.map((row, index) => index < 260 ? row : { ...row, price: row.price * 10000 }));
  for (const type of ["sma", "ema"]) {
    for (const unit of ["day", "week", "month"]) {
      const selection = { period: 3, unit, type };
      assert.deepEqual(M.calculate(later, selection).slice(0, early.rows.length), M.calculate(early, selection));
    }
  }
});

test("current averages include the newest price only at the final endpoint", () => {
  const model = M.buildModel(rowsFrom("2024-01-01", 182));
  for (const unit of ["day", "week", "month"]) {
    const selection = { period: 3, unit }, historical = M.calculate(model, selection);
    const original = historical.slice(), current = M.calculateCurrent(model, selection);
    const latest = model.rows.at(-1);
    const completed = model.samples[unit].filter((row) => row.time < latest.time).slice(-2);
    approximate(current.at(-1), (latest.price + completed.reduce((sum, row) => sum + row.price, 0)) / 3);
    assert.deepEqual(current.slice(0, -1), historical.slice(0, -1));
    assert.deepEqual(historical, original);
    assert.notEqual(current, historical);
    assert.equal(M.calculateCurrent(model, selection), current, "current series has a separate reusable cache entry");
    assert.equal(M.calculate(model, selection), historical);
    assert.equal(current[0], null, "incomplete historical windows stay unavailable");
  }
  for (let period = 3; period <= 30; period += 1) {
    for (const type of ["sma", "ema"]) M.calculateCurrent(model, { period, unit: "day", type });
  }
  assert.ok(model.cache.size <= 16, "historical and current series share the bounded cache");
});

test("live EMA updates are alpha times the price change and never compound prior quotes", () => {
  const rows = rowsFrom("2024-01-01", 182).map((row) => ({ ...row, timestamp: `${row.date}T10:00:00Z` }));
  const model = M.buildModel(rows), publishedAt = rows.at(-1).timestamp;
  const quote1 = { price: 10000, at: Date.parse("2024-06-30T11:00:00Z") };
  const quote2 = { price: 10300, at: quote1.at + 1000 };
  const first = M.withLiveQuote(model, quote1, { publishedAt, now: quote2.at });
  const second = M.withLiveQuote(model, quote2, { publishedAt, now: quote2.at });
  const fromPriorQuote = M.withLiveQuote(first, quote2, { publishedAt, now: quote2.at });
  for (const unit of ["day", "week", "month"]) {
    const selection = { period: 3, unit, type: "ema" }, alpha = 0.5;
    const historical = M.calculate(model, selection), firstValues = M.calculateCurrent(first, selection), secondValues = M.calculateCurrent(second, selection);
    approximate(firstValues.at(-1), alpha * quote1.price + (1 - alpha) * historical.at(-1));
    approximate(secondValues.at(-1) - firstValues.at(-1), alpha * (quote2.price - quote1.price));
    assert.deepEqual(secondValues, M.calculateCurrent(fromPriorQuote, selection));
    assert.deepEqual(secondValues.slice(0, -1), historical.slice(0, -1));
    assert.deepEqual(M.calculate(second, selection), historical);
  }
});

test("same-day live prices update current averages by delta/N while historical averages and the published model stay unchanged", () => {
  const source = rowsFrom("2024-01-01", 182).map((row) => ({ ...row, timestamp: `${row.date}T23:59:59Z` }));
  source.at(-1).timestamp = "2024-06-30T11:00:00Z";
  const model = M.buildModel(source), selections = ["day", "week", "month"].map((unit) => ({ period: 3, unit }));
  const publishedValues = selections.map((selection) => M.calculate(model, selection));
  const currentValues = selections.map((selection) => M.calculateCurrent(model, selection));
  const before = JSON.stringify({ rows: model.rows, sums: model.sums, samples: model.samples, limits: model.limits });
  const quote = { price: 9999, at: Date.parse("2024-06-30T12:00:00Z"), source: "fixture" };
  const projected = M.withLiveQuote(model, quote, { publishedAt: "2024-06-30T10:00:00Z", now: quote.at });
  assert.notEqual(projected, model);
  assert.equal(projected.rows.at(-1).price, quote.price);
  assert.equal(projected.rows.length, model.rows.length);
  assert.notEqual(projected.rows, model.rows);
  assert.notEqual(projected.rows[0], model.rows[0]);
  assert.notEqual(projected.cache, model.cache);
  assert.notEqual(projected.limits, model.limits);
  assert.notEqual(projected.liveQuote, quote);
  assert.deepEqual(projected.liveQuote, quote);
  for (const [index, selection] of selections.entries()) {
    assert.deepEqual(M.calculate(projected, selection), publishedValues[index]);
    const current = M.calculateCurrent(projected, selection);
    approximate(current.at(-1) - currentValues[index].at(-1), (quote.price - model.rows.at(-1).price) / selection.period);
    assert.deepEqual(current.slice(0, -1), publishedValues[index].slice(0, -1));
    assert.equal(M.calculateCurrent(model, selection), currentValues[index]);
    assert.equal(M.calculate(model, selection), publishedValues[index], "published cache entries remain untouched");
    assert.notEqual(projected.sums[selection.unit], model.sums[selection.unit]);
  }
  assert.equal(JSON.stringify({ rows: model.rows, sums: model.sums, samples: model.samples, limits: model.limits }), before);
  assert.equal(model.liveQuote, undefined);
});

test("a next-day live point uses published prior closes and keeps published period limits", () => {
  const source = rowsFrom("2024-01-01", 182).map((row) => ({ ...row, timestamp: `${row.date}T23:00:00Z` }));
  const model = M.buildModel(source);
  const quote = { price: 9999, at: Date.parse("2024-07-01T00:10:00Z") };
  const projected = M.withLiveQuote(model, quote, { publishedAt: "2024-06-30T23:30:00Z", now: quote.at });
  assert.equal(projected.rows.length, model.rows.length + 1);
  assert.equal(projected.rows.at(-1).date, "2024-07-01");
  assert.equal(projected.rows.at(-1).timestamp, "2024-07-01T00:10:00.000Z");
  assert.equal(projected.rows.at(-2).price, model.rows.at(-1).price);
  assert.deepEqual(projected.limits, model.limits);
  assert.deepEqual(projected.limits, { day: 181, week: 25, month: 5 });
  for (const unit of ["day", "week", "month"]) {
    const selection = { period: 3, unit }, values = M.calculate(projected, selection);
    assert.deepEqual(values.slice(0, -1), M.calculate(model, selection));
    const closes = model.rows.filter((row) => M.isSampleDate(row.time, unit)).slice(-3);
    approximate(values.at(-1), closes.reduce((sum, row) => sum + row.price, 0) / 3);
    const current = M.calculateCurrent(projected, selection);
    approximate(current.at(-1), (quote.price + closes.slice(-2).reduce((sum, row) => sum + row.price, 0)) / 3);
    assert.deepEqual(current.slice(0, -1), M.calculate(model, selection));
    assert.throws(() => M.calculate(projected, { period: model.limits[unit] + 1, unit }), RangeError);
    const emaSelection = { ...selection, type: "ema" }, alpha = 0.5;
    const priorEMA = M.calculate(model, emaSelection), rolledEMA = M.calculate(projected, emaSelection);
    assert.deepEqual(rolledEMA.slice(0, -1), priorEMA);
    approximate(rolledEMA.at(-1), alpha * model.rows.at(-1).price + (1 - alpha) * priorEMA.at(-1));
    approximate(M.calculateCurrent(projected, emaSelection).at(-1), alpha * quote.price + (1 - alpha) * rolledEMA.at(-1));
    assert.throws(() => M.calculate(projected, { period: model.limits[unit] + 1, unit, type: "ema" }), RangeError);
  }
});

test("live projection rejects invalid, superseded, future, and noncontiguous quotes but retains usable quotes", () => {
  const source = rowsFrom("2024-01-01", 182);
  source.at(-1).timestamp = "2024-06-30T11:00:00Z";
  const model = M.buildModel(source), at = Date.parse("2024-06-30T12:00:00Z");
  const options = { publishedAt: "2024-06-30T10:00:00Z", now: at };
  const quote = { price: 200, at };
  for (const rejected of [null, undefined, {}, ...[0, -1, NaN, Infinity, "200"].map((price) => ({ ...quote, price })),
    ...[NaN, Infinity, null, undefined, "2024-06-30T12:00:00Z", at + 1,
      Date.parse("2024-06-30T10:00:00Z"), Date.parse("2024-06-30T11:00:00Z"),
      Date.parse("2024-06-29T23:00:00Z")].map((time) => ({ ...quote, at: time }))]) {
    assert.equal(M.withLiveQuote(model, rejected, options), model);
  }
  assert.equal(M.withLiveQuote(model, quote, { ...options, publishedAt: "2024-06-30T12:00:00Z" }), model);
  assert.equal(M.withLiveQuote(model, quote, { ...options, publishedAt: "invalid" }), model);
  assert.equal(M.withLiveQuote(model, quote, { ...options, now: NaN }), model);
  assert.equal(M.withLiveQuote(model, { ...quote, at: utc("2024-07-02") }, { ...options, now: utc("2024-07-02") }), model);
  assert.equal(M.withLiveQuote(model, { ...quote, at: utc("2024-07-03") }, { ...options, now: utc("2024-07-03") }), model);
  const retained = M.withLiveQuote(model, quote, { ...options, now: utc("2024-07-10") });
  assert.equal(retained.liveQuote.at, at, "quote retention does not fabricate a newer timestamp or extra dates");
  assert.equal(retained.rows.length, model.rows.length);
  assert.equal(retained.rows.at(-1).date, "2024-06-30");
});

test("preview live quotes respect hidden presentation, publication supersession, and feed lifecycle", async () => {
  const rows = rowsFrom("2010-01-01", 1600).map((row) => ({ ...row, timestamp: `${row.date}T10:00:00Z` }));
  const model = M.buildModel(rows), publishedAt = model.rows.at(-1).timestamp;
  let selectedQuote = null, visible = true, live = true, adapter, onQuote, starts = 0, stops = 0;
  const frames = [], handlers = new Map();
  const canvas = { dataset: {} };
  const previewWindow = {
    WSBMovingAverageModel: M,
    WSBMovingAverageCharts: {
      setup: () => ({ ctx: {}, width: 640, height: 360 }),
      composite: (_ctx, _width, _height, options) => frames.push(options),
    },
    WSBBitcoinSpotPrice: {
      create: (options) => {
        onQuote = options.onQuote;
        return {
          newerThan: (time) => selectedQuote && selectedQuote.at > Date.parse(time) ? selectedQuote : null,
          isLive: () => live,
          start: () => { starts += 1; }, stop: () => { stops += 1; },
        };
      },
    },
    WSBPreviewShared: {
      initThemeSync: () => {},
      createDataRefresher: (options) => {
        adapter = options;
        return { start: () => {}, requestPresent: () => { if (visible) options.present(); } };
      },
    },
    addEventListener: (event, handler) => handlers.set(event, handler),
  };
  runInNewContext(await readFile(new URL("../webapps/moving_average/preview_app.js", import.meta.url), "utf8"), {
    window: previewWindow,
    document: { getElementById: () => canvas, documentElement: { dataset: { theme: "dark" } } },
    console,
  });
  assert.equal(starts, 1);
  adapter.commit({ model, rows: model.rows, signature: "first", publishedAt });
  adapter.present();
  const published = frames.at(-1);
  assert.equal(canvas.dataset.priceSource, "published");
  selectedQuote = { price: 9999, at: Date.parse(publishedAt) + 3600000 };
  onQuote(selectedQuote);
  assert.equal(frames.at(-1).model.rows.at(-1).price, 9999);
  assert.equal(canvas.dataset.priceSource, "live");
  assert.equal(canvas.dataset.endDate, model.rows.at(-1).date);
  for (const [index, values] of frames.at(-1).series.entries()) {
    assert.deepEqual(values.slice(0, -1), published.series[index].slice(0, -1));
    approximate(values.at(-1) - published.series[index].at(-1), (9999 - 1600) / 200);
  }
  assert.equal(model.rows.at(-1).price, 1600);
  visible = false;
  const painted = frames.length;
  selectedQuote = { price: 10000, at: selectedQuote.at + 3600000 };
  onQuote(selectedQuote);
  assert.equal(frames.length, painted, "hidden quotes only request a deferred presentation");
  visible = true;
  adapter.present();
  assert.equal(frames.at(-1).model.rows.at(-1).price, 10000);
  live = false; onQuote(null);
  assert.equal(frames.at(-1).model.rows.at(-1).price, 10000, "a stale feed callback retains the newest usable quote");
  assert.equal(canvas.dataset.priceSource, "retained");
  const nextRows = rows.map((row, index) => index === rows.length - 1 ? { ...row, price: 1700, timestamp: `${row.date}T14:00:00Z` } : row);
  const nextModel = M.buildModel(nextRows);
  visible = false;
  const beforeInstall = frames.length;
  adapter.commit({ model: nextModel, rows: nextModel.rows, signature: "second", publishedAt: nextRows.at(-1).timestamp });
  assert.equal(frames.length, beforeInstall, "hidden publication installation does not paint");
  visible = true;
  adapter.present();
  assert.equal(frames.at(-1).model, nextModel, "a newer publication supersedes the retained quote");
  assert.equal(canvas.dataset.priceSource, "published");
  handlers.get("pagehide")(); assert.equal(stops, 1);
  handlers.get("pageshow")(); assert.equal(starts, 2);
});

test("missing dates, internal zero prices, bad numbers, and duplicate dates cannot silently shorten windows", () => {
  const valid = rowsFrom("2024-01-01", 10);
  assert.throws(() => M.buildModel(valid.filter((_, index) => index !== 5)), /missing/);
  assert.throws(() => M.buildModel(valid.map((row, index) => index === 5 ? { ...row, price: 0 } : row)), /missing price/);
  assert.throws(() => M.buildModel([...valid.slice(0, 5), valid[4], ...valid.slice(5)]), /duplicated/);
  assert.throws(() => M.buildModel(valid.map((row) => ({ ...row, price: 0 }))), /no nonzero/);
  assert.throws(() => M.parseCSV("date,price\n2024-02-30,1\n"), /invalid/);
  assert.throws(() => M.parseCSV("date,price\n2024-01-01,\n"), /invalid/);
  assert.throws(() => M.parseCSV("date,price\n2024-01-01,Infinity\n"), /invalid/);
  assert.throws(() => M.parseCSV("date,price\n2024-01-01,-1\n"), /invalid/);
  assert.throws(() => M.parseCSV("date,price\n2024-01-01,1,extra\n"), /extra/);
  assert.equal(M.parseCSV('\uFEFFdate,price\r\n"1/2/09","2.5"\r\n')[0].date, "2009-01-02");
});

test("initial data loading checks the exact payload hash and rechecks the publication marker", async () => {
  const p = publication(rowsFrom("2024-01-01", 100));
  const fixture = fetchFixture(p);
  const candidate = await M.prepareCandidate(fixture);
  assert.deepEqual(fixture.calls, [M.MARKER_URL, M.DATA_URL, M.MARKER_URL]);
  assert.equal(candidate.rows.length, 100);
  assert.equal(candidate.signature, p.signature);
  assert.equal(candidate.publishedAt, `${p.marker.latest_date}T23:59:59.000Z`);
  await assert.rejects(M.prepareCandidate(fetchFixture(p, JSON.stringify({ ...p.marker, latest_block_height: 999 }))), /changed during loading/);
  const corrupt = { ...p, csv: p.csv.replace(",1,0\n", ",900,0\n") };
  await assert.rejects(M.prepareCandidate(fetchFixture(corrupt)), /does not match/);
  const wrongBounds = { ...p, signature: JSON.stringify({ ...p.marker, latest_date: "2024-04-10" }) };
  await assert.rejects(M.prepareCandidate(fetchFixture(wrongBounds)), /does not match/);
  await assert.rejects(M.prepareCandidate(fetchFixture({ ...p, signature: "{}" })), /marker is incomplete/);
});

test("refresh candidates use the shared controller signature and reject backward publications", async () => {
  const p = publication(rowsFrom("2024-01-01", 100), "2024-04-09 12:00:00");
  const fixture = fetchFixture(p);
  const candidate = await M.prepareCandidate({ ...fixture, signatureParts: [p.signature] });
  assert.deepEqual(fixture.calls, [M.DATA_URL], "shared refresh supplies both marker probes");
  const older = publication(rowsFrom("2024-01-01", 100), "2024-04-09 11:00:00");
  await assert.rejects(M.prepareCandidate({ ...fetchFixture(older), installed: candidate }), /moved backward/);
  const failedFetch = async () => ({ ok: false, status: 503 });
  await assert.rejects(M.prepareCandidate({ fetchFresh: failedFetch }), /503/);
  assert.equal(candidate.marker.latest_timestamp, "2024-04-09 12:00:00", "failed candidates leave installed data untouched");
});

test("checked-in shared price data has a complete, usable default generation", async () => {
  const csv = await readFile(new URL("../assets/daily_price.csv", import.meta.url), "utf8");
  const model = M.buildModel(M.parseCSV(csv));
  for (const unit of ["day", "week"]) {
    const values = M.calculate(model, { period: 200, unit });
    assert.ok(values.at(-1) > 0);
    assert.equal(values.length, model.rows.length);
  }
});

test("period-line hover matches linear/log chart interpolation and clips future samples at playback", async () => {
  const chartWindow = { WSBMovingAverageModel: M, WSBDashboardCharting: {} };
  runInNewContext(await readFile(new URL("../webapps/moving_average/moving_average_charts.js", import.meta.url), "utf8"), { window: chartWindow });
  const hover = chartWindow.WSBMovingAverageCharts.hoverValue;
  const model = M.buildModel(rowsFrom("2024-01-01", 100));
  const index = (date) => model.rows.findIndex((row) => row.date === date);
  const values = Array(model.rows.length).fill(9999);
  const line = { period: 3, unit: "week" };
  values[index("2024-01-28")] = 100;
  values[index("2024-02-04")] = 400;
  const tuesday = index("2024-01-30"), endpoint = index("2024-02-04");
  const linear = hover(model, values, line, tuesday, endpoint, "linear");
  approximate(linear.value, 100 + 300 * 2 / 7);
  assert.equal(linear.interpolated, true);
  approximate(hover(model, values, line, tuesday, endpoint, "log").value, 100 * 4 ** (2 / 7));
  assert.equal(hover(model, values, line, endpoint, endpoint, "log").interpolated, false);
  assert.equal(hover(model, values, line, endpoint, endpoint, "log").value, 400);

  // A Wednesday playback endpoint substitutes for the not-yet-visible Sunday.
  const wednesday = index("2024-01-31"); values[wednesday] = 250;
  approximate(hover(model, values, line, tuesday, wednesday, "linear").value, 200);
  approximate(hover(model, values, line, tuesday, wednesday, "log").value, 100 * 2.5 ** (2 / 3));
  values[endpoint] = 1e10;
  approximate(hover(model, values, line, tuesday, wednesday, "linear").value, 200);

  const monthly = { period: 3, unit: "month" };
  values[index("2024-01-31")] = 100;
  values[index("2024-02-29")] = 400;
  const midmonth = index("2024-02-14"), monthEnd = index("2024-02-29");
  approximate(hover(model, values, monthly, midmonth, monthEnd, "linear").value, 100 + 300 * 14 / 29);
  approximate(hover(model, values, monthly, midmonth, monthEnd, "log").value, 100 * 4 ** (14 / 29));
  values[index("2024-01-31")] = null;
  assert.equal(hover(model, values, monthly, midmonth, monthEnd, "linear").value, null);
  assert.equal(hover(model, values, { period: 3, unit: "day" }, midmonth, monthEnd, "log").value, 9999);
});

test("chart axes render round, distinct currency ticks at current and early prices", async () => {
  const chartWindow = { WSBMovingAverageModel: M };
  for (const file of ["shared/dashboard_charting.js", "moving_average/moving_average_charts.js"]) {
    runInNewContext(await readFile(new URL(`../webapps/${file}`, import.meta.url), "utf8"), { window: chartWindow });
  }
  function labels(low, high, scale, height = 260) {
    const text = [];
    const ctx = new Proxy({ fillText: (label, x, y) => text.push({ label, x, y }), measureText: (label) => ({ width: label.length * 7 }) }, {
      get: (target, key) => key in target ? target[key] : () => {},
    });
    const model = M.buildModel(rowsFrom("2024-01-01", 2, (i) => i ? high : low));
    chartWindow.WSBMovingAverageCharts.panel(ctx, { width: 640, height }, {
      model, series: [], lines: [], endIndex: 1, startTime: model.rows[0].time, scale,
    });
    return text.filter((item) => item.x === 640 - 84 + 8).map((item) => item.label);
  }
  assert.deepEqual(labels(59000, 90000, "linear"), ["$60k", "$70k", "$80k", "$90k"]);
  assert.deepEqual(labels(59000, 90000, "log"), ["$60k", "$70k", "$80k", "$90k"]);
  assert.deepEqual(labels(100000, 101000, "linear"), ["$100k", "$100.5k", "$101k"]);
  assert.deepEqual(labels(0.0007, 0.0013, "linear"), ["0.075¢", "0.1¢", "0.125¢"]);
  assert.deepEqual(labels(0.001, 100000, "log", 620), ["0.1¢", "1¢", "10¢", "$1", "$10", "$100", "$1k", "$10k", "$100k"]);
  assert.deepEqual(labels(0.01, 1, "linear"), ["$0", "50¢", "$1"]);
  assert.equal(chartWindow.WSBMovingAverageCharts.money(0.1), "$0.1", "hover formatting stays in dollars");
  for (const [value, expected] of [[0,"0.00¢"],[0.0000562,"0.0056¢"],[0.0007,"0.07¢"],
    [0.0045,"0.45¢"],[0.1,"10.00¢"],[0.99,"99.00¢"],[1,"$1.00"],[1234.5,"$1,234.50"],
    [NaN,"N/A"],[Infinity,"N/A"]]) {
    assert.equal(chartWindow.WSBMovingAverageCharts.kpiMoney(value), expected,
      "sub-dollar KPIs use cents with adaptive precision; dollars keep two decimals");
  }
});

async function loadChartGeometry() {
  const chartWindow = { WSBMovingAverageModel: M, WSBDashboardExport: { drawFooterUrl() {} } };
  for (const file of ["shared/dashboard_charting.js", "moving_average/moving_average_charts.js"]) {
    runInNewContext(await readFile(new URL(`../webapps/${file}`, import.meta.url), "utf8"), { window: chartWindow });
  }
  return chartWindow.WSBMovingAverageCharts;
}

function recordChartStrokes() {
  const strokes = [], stack = [];
  let path = [], pendingClip, state = { x: 0, y: 0, clip: null };
  const target = {
    measureText: (label) => ({ width: label.length * 7 }),
    save: () => stack.push({ ...state, strokeStyle: target.strokeStyle }),
    restore: () => { const previous = stack.pop(); state = previous; target.strokeStyle = previous.strokeStyle; },
    translate: (x, y) => { state.x += x; state.y += y; },
    beginPath: () => { path = []; },
    moveTo: (x, y) => path.push([x + state.x, y + state.y]),
    lineTo: (x, y) => path.push([x + state.x, y + state.y]),
    rect: (x, y, width, height) => { pendingClip = { left: x + state.x, top: y + state.y, right: x + state.x + width, bottom: y + state.y + height, height }; },
    clip: () => { state.clip = pendingClip; },
    stroke: () => strokes.push({ color: target.strokeStyle, clip: state.clip, points: path.slice() }),
  };
  return { strokes, ctx: new Proxy(target, { get: (object, key) => key in object ? object[key] : () => {} }) };
}

function measuredChartMargins(recording, colors) {
  const panels = new Map();
  for (const stroke of recording.strokes) {
    if (!stroke.clip || !colors.includes(stroke.color)) continue;
    const plot = stroke.clip, key = JSON.stringify(plot);
    if (!panels.has(key)) panels.set(key, { plot, ys: [] });
    for (const [x, y] of stroke.points) {
      assert.ok(Number.isFinite(x) && Number.isFinite(y), "data strokes have finite coordinates");
      if (x >= plot.left - 1e-7 && x <= plot.right + 1e-7) panels.get(key).ys.push(y);
    }
  }
  return [...panels.values()].map(({ plot, ys }) => {
    assert.ok(ys.length > 0, "each panel has visible data strokes");
    return { plot, top: Math.min(...ys) - plot.top, bottom: plot.bottom - Math.max(...ys) };
  });
}

test("early chart and compact-preview windows leave future axis space empty while price advances from the price-history start", async () => {
  const G = await loadChartGeometry();
  const model = M.buildModel(rowsFrom("2009-10-06", 1600, (index) => index + 1));
  for (const [period, unit, endIndex] of [[200, "day", 99], [200, "day", 200], [200, "day", 201],
    [200, "week", 100], [12, "month", 100]]) {
    const recording = recordChartStrokes(), activeTime = model.rows[endIndex].time;
    const bounds = M.windowBounds(activeTime, period, unit);
    const geometry = G.panel(recording.ctx, { width: 640, height: 300 }, {
      model, lines: [], series: [], endIndex, ...bounds, scale: "linear",
    });
    const stroke = recording.strokes.find((item) => item.clip && item.color === G.palette("dark").fg);
    const maxX = Math.max(...stroke.points.map(([x]) => x));
    const fraction = (activeTime - bounds.startTime) / (bounds.endTime - bounds.startTime);
    approximate(maxX, geometry.plot.left + geometry.plot.width * fraction);
    assert.equal(geometry.endTime, bounds.endTime);
    assert.ok(stroke.points.length <= endIndex + 1, "the chart never draws future rows");
    if (bounds.endTime > activeTime) assert.ok(maxX < geometry.plot.right);
    else approximate(maxX, geometry.plot.right);
  }
  const recording = recordChartStrokes(), lines = [{ period: 200, unit: "day", type: "sma" }, { period: 200, unit: "week", type: "sma" }];
  G.composite(recording.ctx, 1280, 720, { model, lines, series: [[], []], endIndex: 100, compact: true });
  const strokes = recording.strokes.filter((item) => item.clip && item.color === G.palette("dark").fg);
  assert.equal(strokes.length, 3);
  for (const [index, stroke] of strokes.slice(1).entries()) {
    const bounds = M.windowBounds(model.rows[100].time, lines[index].period, lines[index].unit);
    const fraction = (model.rows[100].time - bounds.startTime) / (bounds.endTime - bounds.startTime);
    approximate(Math.max(...stroke.points.map(([x]) => x)), stroke.clip.left + (stroke.clip.right - stroke.clip.left) * fraction);
  }
});

test("chart data has the same pixel margins in LIN and LOG at different panel heights and price ranges", async () => {
  const G = await loadChartGeometry();
  for (const [low, high] of [[0.00001, 0.004], [0.001, 100000], [100000, 100100]]) {
    const model = M.buildModel(rowsFrom("2024-01-01", 10, (i) => low + (high - low) * i / 9));
    for (const scale of ["linear", "log"]) {
      for (const height of [70, 210, 280, 620]) {
        const recording = recordChartStrokes();
        G.panel(recording.ctx, { width: 640, height }, {
          model, series: [], lines: [], endIndex: 9, startTime: model.rows[0].time, scale,
        });
        const [margin] = measuredChartMargins(recording, [G.palette("dark").fg]);
        const expected = Math.min(16, margin.plot.height / 4);
        approximate(margin.top, expected);
        approximate(margin.bottom, expected);
      }
    }
  }
});

test("scale morphs blend pixel positions, invert hovered values, and retain fixed data margins", async () => {
  const G = await loadChartGeometry();
  const model = M.buildModel(rowsFrom("2024-01-01", 10, (i) => 0.001 * 10 ** (8 * i / 9)));
  function render(mix, height) {
    const recording = recordChartStrokes();
    const geometry = G.panel(recording.ctx, { width: 640, height }, {
      model, series: [], lines: [], endIndex: 9, startTime: model.rows[0].time,
      scale: "log", scaleMix: mix,
    });
    return { geometry, margin: measuredChartMargins(recording, [G.palette("dark").fg])[0] };
  }
  for (const height of [70, 260, 620]) {
    const linear = render(0, height).geometry, log = render(1, height).geometry;
    for (const mix of [0, 0.05, 0.25, 0.5, 0.75, 0.95, 1]) {
      const { geometry: g, margin } = render(mix, height);
      assert.equal(g.scaleMix, mix);
      const expectedPadding = Math.min(16, g.plot.height / 4);
      approximate(margin.top, expectedPadding); approximate(margin.bottom, expectedPadding);
      for (const price of [0.001, 0.01, 0.1, 1, 10, 100, 1000, 100000]) {
        const expected = linear.valueToY(price) * (1 - mix) + log.valueToY(price) * mix;
        approximate(g.valueToY(price), expected);
        approximate(g.yToValue(g.valueToY(price)), price);
      }
    }
  }
});

function renderChartAxis(G, low, high, mix, height = 620) {
  const labels = [], stack = [];
  const target = {
    globalAlpha: 1,
    measureText: (label) => ({ width: label.length * 7 }),
    save: () => stack.push(target.globalAlpha), restore: () => { target.globalAlpha = stack.pop(); },
    fillText: (label, x, y) => { if (x === 640 - 84 + 8) labels.push({ label, x, y, alpha: target.globalAlpha }); },
  };
  const ctx = new Proxy(target, { get: (object, key) => key in object ? object[key] : () => {} });
  const model = M.buildModel(rowsFrom("2024-01-01", 2, (i) => i ? high : low));
  const geometry = G.panel(ctx, { width: 640, height }, {
    model, series: [], lines: [], endIndex: 1, startTime: model.rows[0].time, scale: "log", scaleMix: mix,
  });
  return { labels, geometry };
}

test("scale morph tick labels move and crossfade without duplicate text or visible collisions", async () => {
  const G = await loadChartGeometry();
  const render = (...args) => renderChartAxis(G, ...args);
  for (const [low, high] of [[0.001, 100000], [59000, 90000], [100000, 100100]]) {
    for (const height of [210, 620]) {
      for (const mix of [0, 0.1, 0.25, 0.5, 0.75, 0.9, 1]) {
        const { labels } = render(low, high, mix, height);
        assert.equal(new Set(labels.map((label) => label.label)).size, labels.length, "each value is drawn once");
        for (const tick of labels) {
          assert.ok(Number.isFinite(tick.x) && Number.isFinite(tick.y), JSON.stringify(tick));
          assert.ok(tick.alpha > 0 && tick.alpha <= 1, JSON.stringify(tick));
        }
        const visible = labels.filter((tick) => tick.alpha > 0.05).sort((a, b) => a.y - b.y);
        for (let i = 1; i < visible.length; i++) assert.ok(visible[i].y - visible[i - 1].y >= 12, `overlapping ticks at ${mix}: ${JSON.stringify(visible)}`);
      }
    }
  }
  const linear = render(59000, 90000, 0, 260), log = render(59000, 90000, 1, 260);
  const middle = render(59000, 90000, 0.5, 260);
  for (const first of linear.labels) {
    const last = log.labels.find((tick) => tick.label === first.label), mid = middle.labels.find((tick) => tick.label === first.label);
    if (!last) continue;
    assert.ok(mid, `shared tick ${first.label} disappeared`);
    approximate(mid.alpha, 1);
    approximate(mid.y, (first.y + last.y) / 2);
  }
  assert.ok(render(0.001, 100000, 0.5).labels.some((tick) => tick.alpha > 0 && tick.alpha < 1), "scale-specific labels crossfade");
});

test("the zero tick fades only once in either scale direction, including off-decade history minima", async () => {
  const G = await loadChartGeometry();
  // Exact powers of ten mask the old flicker: the lowest log tick stays close
  // to zero. Off-decade minima let that tick move away and formerly reveal $0
  // a second time late in the LIN-to-LOG animation.
  for (const [low, high] of [[0.000764, 126000], [0.00000764, 100000], [0.00764, 0.9], [0.0764, 9]]) {
    for (const height of [70, 210, 260, 500, 620, 1080]) {
      const frames = Array.from({ length: 201 }, (_, step) => renderChartAxis(G, low, high, step / 200, height).labels);
      const opacity = frames.map((ticks) => ticks.find((tick) => tick.label === "$0")?.alpha ?? 0);
      assert.equal(opacity[0], 1, `LIN includes zero for ${low}..${high} at height ${height}`);
      assert.equal(opacity.at(-1), 0, "LOG excludes zero");
      assert.ok(opacity.some((alpha) => alpha > 0 && alpha < 1), "zero fades rather than abruptly vanishing");
      for (const direction of [1, -1]) {
        const sequence = direction === 1 ? opacity : opacity.slice().reverse();
        for (let step = 1; step < sequence.length; step++) {
          assert.ok(direction * (sequence[step] - sequence[step - 1]) <= 1e-12,
            `zero reversed its fade at ${low}..${high}, height ${height}, direction ${direction}, frame ${step}`);
        }
      }
      for (const ticks of frames) {
        const zero = ticks.find((tick) => tick.label === "$0" && tick.alpha > 0.05);
        if (!zero) continue;
        for (const tick of ticks) {
          if (tick === zero || tick.alpha <= 0.05) continue;
          assert.ok(Math.abs(tick.y - zero.y) >= 12, `zero overlaps ${tick.label} at height ${height}`);
        }
      }
    }
  }
});

test("hover interpolation follows the line's blended pixel position throughout a scale morph", async () => {
  const G = await loadChartGeometry();
  const model = M.buildModel(rowsFrom("2024-01-01", 40));
  const index = (date) => model.rows.findIndex((row) => row.date === date);
  const values = Array(model.rows.length).fill(null), line = { period: 3, unit: "week" };
  const before = index("2024-01-28"), after = index("2024-02-04"), hovered = index("2024-01-30");
  values[before] = 100; values[after] = 400;
  for (const mix of [0, 0.2, 0.5, 0.8, 1]) {
    const recording = recordChartStrokes();
    const g = G.panel(recording.ctx, { width: 640, height: 260 }, {
      model, series: [values], lines: [line], endIndex: after, startTime: model.rows[before].time,
      scale: "log", scaleMix: mix,
    });
    const hover = G.hoverValue(model, values, line, hovered, after, "log", g);
    assert.equal(hover.interpolated, true);
    approximate(g.valueToY(hover.value), g.valueToY(100) + (g.valueToY(400) - g.valueToY(100)) * 2 / 7);
    assert.equal(G.hoverValue(model, values, line, after, after, "log", g).value, 400);
  }
});

test("compact composites keep equal data margins for mixed scales, both orientations, and one or two averages", async () => {
  const G = await loadChartGeometry();
  const model = M.buildModel(rowsFrom("2024-01-01", 100, (i) => 0.00001 * 1.18 ** i));
  const selections = [{ period: 15, unit: "day", type: "sma" }, { period: 60, unit: "day", type: "ema" }];
  const series = [model.rows.map((row) => row.price * 0.75), model.rows.map((row) => row.price * 1.15)];
  const colors = G.palette("dark");
  for (const [width, height] of [[1280, 720], [620, 1120], [430, 430]]) {
    for (const scales of [["linear", "linear", "log"], ["log", "log", "linear"]]) {
      for (const single of [false, true]) {
        const recording = recordChartStrokes();
        const lines = selections.map((line, i) => single && i === 1 ? { ...line, type: "none" } : line);
        // Full exports have their own notebook-style renderer and browser
        // regression; the compact homepage composition retains pixel margins.
        G.composite(recording.ctx, width, height, { model, lines, series, endIndex: 99, scales, compact: true });
        const margins = measuredChartMargins(recording, [colors.fg, ...colors.lines]);
        assert.equal(margins.length, single ? 2 : 3);
        for (const margin of margins) {
          approximate(margin.top, 16);
          approximate(margin.bottom, 16);
        }
      }
    }
  }
});

test("flat histories keep finite centered price strokes in both scales", async () => {
  const G = await loadChartGeometry();
  for (const price of [0.00001, 100000]) {
    const model = M.buildModel(rowsFrom("2024-01-01", 10, () => price));
    for (const scale of ["linear", "log"]) {
      const recording = recordChartStrokes();
      G.panel(recording.ctx, { width: 640, height: 260 }, { model, series: [], lines: [], endIndex: 9, startTime: model.rows[0].time, scale });
      const [margin] = measuredChartMargins(recording, [G.palette("dark").fg]);
      approximate(margin.top, margin.plot.height / 2);
      approximate(margin.bottom, margin.plot.height / 2);
    }
  }
});

test("date axes use UTC calendar boundaries and readable month/year context", async () => {
  const chartWindow = { WSBMovingAverageModel: M };
  for (const file of ["shared/dashboard_charting.js", "moving_average/moving_average_charts.js"]) {
    runInNewContext(await readFile(new URL(`../webapps/${file}`, import.meta.url), "utf8"), { window: chartWindow });
  }
  function render(first, last, width = 640) {
    const text = [], paths = []; let path = [];
    const ctx = new Proxy({
      measureText: (label) => ({ width: label.length * 7 }),
      fillText: (label, x, y) => text.push({ label, x, y }),
      beginPath: () => { path = []; }, moveTo: (x, y) => path.push([x, y]),
      lineTo: (x, y) => path.push([x, y]), stroke: () => paths.push(path.slice()),
    }, { get: (target, key) => key in target ? target[key] : () => {} });
    const model = M.buildModel(rowsFrom(first, Math.round((utc(last) - utc(first)) / M.DAY_MS) + 1));
    const geometry = chartWindow.WSBMovingAverageCharts.panel(ctx, { width, height: 260 }, {
      model, series: [], lines: [], endIndex: model.rows.length - 1, startTime: utc(first),
    });
    const { plot } = geometry;
    const dates = paths.filter((p) => p.length === 2 && p[0][0] === p[1][0] && p[0][1] === plot.top && p[1][1] === plot.bottom)
      .map((p) => iso(Math.round(utc(first) + (p[0][0] - plot.left) / plot.width * (utc(last) - utc(first)))));
    const labels = text.filter((item) => item.y === 250);
    let edge = plot.left - 10;
    for (const item of labels) {
      const half = item.label.length * 7 / 2;
      assert.ok(item.x - half >= edge + 9.99, `Overlapping date label: ${item.label}`);
      assert.ok(item.x + half <= plot.right + .01);
      edge = item.x + half;
    }
    assert.equal(labels.length, dates.length);
    assert.ok(labels.length > 0, `Missing date labels for ${first}–${last}`);
    return { dates, labels: labels.map((item) => item.label) };
  }
  const history = render("2009-10-06", "2026-10-17");
  assert.deepEqual(history.dates, ["2010-01-01", "2012-01-01", "2014-01-01", "2016-01-01", "2018-01-01", "2020-01-01", "2022-01-01", "2024-01-01", "2026-01-01"]);
  assert.deepEqual(history.labels, history.dates.map((date) => date.slice(0,4)));
  for (const width of [260, 320, 400, 560, 800]) {
    const ticks = render("2009-10-06", "2026-10-17", width);
    const years = ticks.labels.map(Number), step = years[1] - years[0];
    assert.ok(years.length >= 2 && Number.isInteger(Math.log2(step)) && step >= 2,
      `Long history uses power-of-two year spacing at ${width}px: ${years}`);
    assert.ok(ticks.dates.every((date, index) => date === `${years[index]}-01-01` && years[index] % step === 0));
    assert.ok(years.slice(1).every((year, index) => year - years[index] === step));
  }
  const months = render("2026-03-31", "2026-10-17");
  assert.ok(months.dates.every((date) => date.endsWith("-01")));
  assert.equal(months.labels[0], "Apr 2026");
  assert.ok(months.labels.includes("Oct"));
  const rollover = render("2025-11-15", "2026-03-15");
  assert.ok(rollover.labels.includes("Dec 2025") && rollover.labels.includes("2026"));
  assert.ok(!rollover.labels.some((label) => /^Jan \d{4}$/.test(label)));
  const leap = render("2024-02-27", "2024-03-01");
  assert.ok(leap.dates.includes("2024-02-29"));
  const weeks = render("2026-05-01", "2026-05-22", 320);
  assert.ok(weeks.dates.every((date) => new Date(utc(date)).getUTCDay() === 0));
  for (const range of [["2026-10-14","2026-10-17"],["2026-07-17","2026-10-17"],["2009-10-06","2026-10-17"]]) render(...range, 320);
});
