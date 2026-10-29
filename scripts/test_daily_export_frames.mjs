import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import test from "node:test";

const window = {};
runInNewContext(readFileSync(new URL("../webapps/shared/dashboard_export.js", import.meta.url), "utf8"), { window });
const E = window.WSBDashboardExport;
const plan = (first, last, options) => Array.from(E.buildDailyFrameIndices(first, last, options));

test("daily export dates keep padded calendar cells across day, month and year boundaries", () => {
  for (const [value, expected] of [
    ["2025-12-31", "Dec 31, 2025"], ["2026-01-01", "Jan 01, 2026"],
    ["2026-01-09", "Jan 09, 2026"], ["2026-01-10", "Jan 10, 2026"],
    ["2024-02-29", "Feb 29, 2024"], ["2026-09-09T23:59:59Z", "Sep 09, 2026"],
    [Date.UTC(2026, 0, 9, 23, 59), "Jan 09, 2026"],
  ]) assert.equal(E.formatDailyDate(value), expected);
  assert.equal(E.formatDailyDate("invalid"), "--");
});

test("1x includes every day without a duration cap, for short and full histories", () => {
  for (const [first, last] of [[0, 0], [4, 9], [0, 6506]]) {
    const frames = plan(first, last);
    assert.deepEqual(frames, Array.from({ length: last - first + 1 }, (_, i) => first + i));
    assert.equal(E.estimateDownload({}, { frameCount: frames.length }).videoSeconds, frames.length / 30);
  }
});

test("speed scales days per frame and always preserves the selected endpoint", () => {
  assert.deepEqual(plan(3, 9, { speed: .5 }), [3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9]);
  assert.deepEqual(plan(3, 9, { speed: "1" }), [3, 4, 5, 6, 7, 8, 9]);
  assert.deepEqual(plan(3, 8, { speed: 2 }), [3, 5, 7, 8]);
  assert.deepEqual(plan(3, 9, { speed: 4 }), [3, 7, 9]);
});

test("milestones preserve skipped transition days without duplicating or escaping the range", () => {
  const milestones = [-1, 2, 4, 4, 5, 7, 12, NaN, 4.5];
  assert.deepEqual(plan(3, 9, { speed: 4, milestones }), [3, 4, 5, 7, 9]);
  assert.deepEqual(plan(3, 9, { speed: .5, milestones }), plan(3, 9, { speed: .5 }));
  assert.deepEqual(milestones, [-1, 2, 4, 4, 5, 7, 12, NaN, 4.5]);
});

test("optional holds add one and three seconds of the final frame at every speed", () => {
  for (const speed of [.5, 1, 2, 4]) {
    for (const [first, last] of [[0, 0], [3, 9], [0, 6506]]) {
      const options = { speed, milestones: [5, 7] };
      const motion = plan(first, last, options);
      const held = plan(first, last, { ...options, endFrameHold: true });
      assert.deepEqual(held.slice(0, 30), Array(30).fill(last));
      assert.deepEqual(held.slice(30, -90), motion);
      assert.deepEqual(held.slice(-90), Array(90).fill(last));
      assert.equal(held.length, motion.length + 120);
      assert.equal(E.estimateDownload({}, { frameCount: held.length }).videoSeconds, (motion.length + 120) / 30);
    }
  }
});

test("invalid ranges and speeds fail explicitly instead of truncating history", () => {
  for (const [first, last] of [[-1, 2], [3, 2], [0, 1.5], [0, Infinity]]) {
    assert.throws(() => plan(first, last), /valid daily export range/);
  }
  for (const speed of [0, -1, 1.5, Infinity, "bad"]) {
    assert.throws(() => plan(0, 4, { speed }), /valid daily export speed/);
  }
});
