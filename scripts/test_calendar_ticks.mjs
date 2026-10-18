import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import test from "node:test";

const window = {};
runInNewContext(readFileSync(new URL("../webapps/shared/dashboard_charting.js", import.meta.url), "utf8"), { window });
const C = window.WSBDashboardCharting;
const DAY = 86400000;
const utc = (date) => Date.parse(`${date}T00:00:00Z`);
const iso = (time) => new Date(time).toISOString().slice(0, 10);
const dates = (ticks) => Array.from(ticks.times, iso);
const empty = { times: [], unit: null, step: 0 };

function ticks(first, last, options) {
  return C.createCalendarTicks(utc(first), utc(last), options);
}

test("history capacity coarsens through doubling year intervals on aligned January boundaries", () => {
  for (const [maxTicks, step, expected] of [
    [9, 2, [2010, 2012, 2014, 2016, 2018, 2020, 2022, 2024, 2026]],
    [8, 4, [2012, 2016, 2020, 2024]],
    [3, 8, [2016, 2024]],
    [1, 16, [2016]],
  ]) {
    const result = ticks("2009-10-06", "2026-10-17", { maxTicks });
    assert.equal(result.unit, "year");
    assert.equal(result.step, step);
    assert.deepEqual(dates(result), expected.map((year) => `${year}-01-01`));
    assert.ok(result.times.length <= maxTicks);
    assert.ok(expected.every((year) => year % step === 0));
  }
});

test("daily ticks include leap day and exact UTC endpoints without daylight-saving shifts", () => {
  const leap = ticks("2024-02-27", "2024-03-01", { maxTicks: 4 });
  assert.equal(leap.unit, "day");
  assert.equal(leap.step, 1);
  assert.deepEqual(dates(leap), ["2024-02-27", "2024-02-28", "2024-02-29", "2024-03-01"]);
  const dst = ticks("2024-03-09", "2024-03-12", { maxTicks: 4 });
  assert.deepEqual(dates(dst), ["2024-03-09", "2024-03-10", "2024-03-11", "2024-03-12"]);
  assert.ok(dst.times.slice(1).every((time, index) => time - dst.times[index] === DAY));
});

test("week ticks use a stable Sunday anchor", () => {
  const result = ticks("2026-05-01", "2026-05-22", { maxTicks: 4 });
  assert.equal(result.unit, "week");
  assert.equal(result.step, 1);
  assert.deepEqual(dates(result), ["2026-05-03", "2026-05-10", "2026-05-17"]);
  const fortnight = ticks("2026-05-01", "2026-06-20", { maxTicks: 4 });
  assert.equal(fortnight.unit, "week");
  assert.equal(fortnight.step, 2);
  assert.ok(fortnight.times.every((time) => (time - utc("1970-01-04")) % (14 * DAY) === 0));
});

test("month ticks cross year and leap-month boundaries using calendar arithmetic", () => {
  const result = ticks("2023-11-15", "2024-03-15", { minUnit: "month", maxTicks: 4 });
  assert.equal(result.unit, "month");
  assert.equal(result.step, 1);
  assert.deepEqual(dates(result), ["2023-12-01", "2024-01-01", "2024-02-01", "2024-03-01"]);
  assert.deepEqual(Array.from(result.times.slice(1), (time, index) => (time - result.times[index]) / DAY), [31, 31, 29]);
});

test("calendar construction preserves early years and normalizes months before year zero", () => {
  const early = ticks("0049-11-15", "0050-03-15", { minUnit: "month", maxTicks: 4 });
  assert.deepEqual(dates(early), ["0049-12-01", "0050-01-01", "0050-02-01", "0050-03-01"]);
  const ancient = ticks("-000001-11-15", "0000-03-15", { minUnit: "month", maxTicks: 4 });
  assert.deepEqual(Array.from(ancient.times, (time) => new Date(time).toISOString().split("T")[0]),
    ["-000001-12-01", "0000-01-01", "0000-02-01", "0000-03-01"]);
});

test("count mode rejects an overflowing interval instead of accepting a truncated prefix", () => {
  const result = ticks("2024-01-01", "2024-01-10", { maxTicks: 3.9 });
  assert.ok(result.times.length <= 3);
  assert.equal(result.unit, "week");
  assert.deepEqual(dates(result), ["2024-01-07"]);
});

test("a caller can reject fitting-count candidates to account for measured label bounds", () => {
  const seen = [];
  const result = ticks("2024-01-01", "2024-04-01", {
    maxTicks: 4,
    minUnit: "month",
    accept(candidate) {
      seen.push({ unit: candidate.unit, step: candidate.step, dates: dates(candidate) });
      return candidate.step >= 2;
    },
  });
  assert.deepEqual(seen, [
    { unit: "month", step: 1, dates: ["2024-01-01", "2024-02-01", "2024-03-01", "2024-04-01"] },
    { unit: "month", step: 2, dates: ["2024-01-01", "2024-03-01"] },
  ]);
  assert.equal(result.step, 2);
  assert.deepEqual(dates(result), ["2024-01-01", "2024-03-01"]);
  assert.deepEqual(JSON.parse(JSON.stringify(ticks("2024-01-01", "2024-04-01", { accept: () => false }))), empty);
});

test("minimum unit keeps narrow export ranges free of daily or weekly candidates", () => {
  const result = ticks("2024-01-01", "2024-01-05", { minUnit: "month" });
  assert.equal(result.unit, "month");
  assert.equal(result.step, 1);
  assert.deepEqual(dates(result), ["2024-01-01"]);
  const annual = ticks("2023-10-01", "2024-03-01", { minUnit: "year" });
  assert.equal(annual.unit, "year");
  assert.deepEqual(dates(annual), ["2024-01-01"]);
});

test("span density preserves export interval transitions independently of inclusive tick counts", () => {
  const range = [utc("2009-10-06"), utc("2026-09-16")];
  // The renderer reserves one percent of the history span before the first data point.
  range[0] -= (range[1] - range[0]) * 0.01;
  for (const [width, step] of [[798, 4], [864, 2]]) {
    const result = C.createCalendarTicks(...range, {
      maxTicks: Math.max(2, Math.floor(width / 90)), minUnit: "month", density: "span", fallback: true,
    });
    assert.equal(result.unit, "year");
    assert.equal(result.step, step);
    assert.ok(result.times.every((time) => new Date(time).getUTCFullYear() % step === 0));
  }
  const inclusive = ticks("2024-01-01", "2024-03-01", { maxTicks: 2, minUnit: "month", density: "span" });
  assert.equal(inclusive.step, 1);
  assert.deepEqual(dates(inclusive), ["2024-01-01", "2024-02-01", "2024-03-01"]);
});

test("empty calendar windows can opt into one in-range fallback without inventing a month boundary", () => {
  const first = utc("2010-01-02") + DAY / 2, last = utc("2010-01-05");
  const options = { minUnit: "month", density: "span" };
  assert.equal(C.createCalendarTicks(first, last, options).times.length, 0);
  const fallback = C.createCalendarTicks(first, last, { ...options, fallback: true });
  assert.deepEqual(dates(fallback), ["2010-01-03"]);
  assert.equal(fallback.times.length, 1);
  const subdayEnd = first + DAY / 4;
  assert.deepEqual(Array.from(C.createCalendarTicks(first, subdayEnd, { ...options, fallback: true }).times), [subdayEnd]);
});

test("single-point ranges retain an aligned tick or an explicitly requested fallback", () => {
  assert.deepEqual(dates(ticks("2024-01-01", "2024-01-01")), ["2024-01-01"]);
  const time = utc("2024-01-02") + DAY / 2;
  const result = C.createCalendarTicks(time, time, { minUnit: "month", density: "span", fallback: true });
  assert.deepEqual(Array.from(result.times), [time]);
});

test("invalid ranges and selection options fail without ticks", () => {
  const first = utc("2024-01-01"), last = utc("2024-02-01");
  const cases = [
    [NaN, last], [first, Infinity], [-Infinity, last], [last, first], [0, 8.64e15 + 1],
    [first, last, { maxTicks: 0 }], [first, last, { maxTicks: 0.5 }], [first, last, { maxTicks: -1 }],
    [first, last, { maxTicks: NaN }], [first, last, { maxTicks: Infinity }],
    [first, last, { minUnit: "hour" }], [first, last, { density: "pixels" }], [first, last, { accept: true }],
  ];
  for (const args of cases) {
    assert.deepEqual(JSON.parse(JSON.stringify(C.createCalendarTicks(...args))), empty);
  }
});
