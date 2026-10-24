import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createHash, webcrypto } from "node:crypto";
import test from "node:test";
import "../webapps/eoe_growth/eoe_growth_model.js";

const M = globalThis.WSBEOEGrowthModel;
if (!globalThis.crypto) Object.defineProperty(globalThis, "crypto", { value: webcrypto });
const utc = (date) => Date.parse(`${date}T00:00:00Z`);
const iso = (time) => new Date(time).toISOString().slice(0, 10);
function rowsFrom(heights, prices, first = "2009-01-03") {
  return heights.map((height, index) => {
    const time = utc(first) + index * M.DAY_MS, date = iso(time);
    return { date, time, timestamp: `${date} 23:59:59`, height, price: prices?.[index] ?? index + 1 };
  });
}
function publication(rows, changes = {}) {
  const csv = "date,timestamp,price,block_height\n" + rows.map((row) =>
    `${row.date},${row.timestamp},${row.price},${row.height}`).join("\n") + "\n";
  const marker = {
    schema_version: 1,
    artifact: { path: "assets/daily_price.csv", rows: rows.length, sha256: createHash("sha256").update(csv).digest("hex") },
    first_date: rows[0].date, latest_date: rows.at(-1).date,
    latest_timestamp: rows.at(-1).timestamp, latest_block_height: rows.at(-1).height,
    ...changes,
  };
  return { csv, marker, signature: JSON.stringify(marker) };
}
function fetchFixture(pub, finalMarker = pub.signature) {
  const calls = [];
  return { calls, fetchFresh: async (url) => {
    calls.push(url);
    const text = url === M.DATA_URL ? pub.csv : calls.length > 1 ? finalMarker : pub.signature;
    return { ok: true, text: async () => text };
  } };
}

test("epoch and block count include genesis and both sides of halving boundaries", () => {
  const source = rowsFrom([0, 209999, 210000, 419999, 420000, 839999, 840000]);
  const model = M.buildModel(source);
  assert.deepEqual(model.rows.map((row) => [row.epoch, row.epochBlockCount]),
    [[1, 1], [1, 210000], [2, 1], [2, 210000], [3, 1], [4, 210000], [5, 1]]);
  assert.ok(model.rows.every((row) => row.count === row.epochBlockCount));
  assert.equal(model.firstTime, source[0].time);
  assert.equal(model.latestTime, source.at(-1).time);
  assert.equal(source[0].epoch, undefined, "model building must not mutate published source rows");
});

test("nearest block-offset comparison chooses the first row on ties and repeated heights", () => {
  const model = M.buildModel(rowsFrom([0, 0, 10, 20, 20, 210000, 210005, 210018, 210020, 210030],
    [2, 3, 4, 5, 6, 8, 12, 15, 20, 25]));
  assert.deepEqual(model.rows.slice(5).map((row) => row.previousIndex), [0, 0, 3, 3, 3]);
  assert.deepEqual(model.rows.slice(5).map((row) => row.previousPrice), [2, 2, 5, 5, 5]);
  assert.deepEqual(model.rows.slice(5).map((row) => row.growth), [300, 500, 200, 300, 400]);
  assert.equal(M.nearestRow(model.epochs[0].rows, 11).index, 2);
  assert.equal(M.nearestRow([], 10), null);
});

test("unvalued history is retained separately from unavailable comparison and measured zero growth", () => {
  const model = M.buildModel(rowsFrom([0, 10, 20, 210000, 210010, 210020], [0, 0, 5, 2, 3, 5]));
  assert.equal(model.rows.length, 6);
  assert.equal(model.rows[0].price, 0);
  assert.equal(model.rows[0].previousPrice, null);
  assert.equal(model.rows[0].growth, null);
  assert.equal(model.rows[3].previousPrice, 0);
  assert.equal(model.rows[3].growth, null);
  assert.equal(model.rows[5].growth, 0);
  assert.equal(model.firstPositiveIndex, 2);
  assert.equal(model.firstGrowthIndex, 5, "zero growth is a measured comparison");
  const unvalued = M.buildModel(rowsFrom([0, 0, 0], [0, 0, 0]));
  assert.equal(unvalued.firstPositiveIndex, -1);
  assert.equal(unvalued.firstGrowthIndex, -1);
});

test("negative growth remains a measured decline and missing epochs do not become fabricated comparisons", () => {
  const model = M.buildModel(rowsFrom([0, 210000, 630000], [100, 70, 500]));
  assert.equal(model.rows[1].growth, -30);
  assert.equal(model.firstGrowthIndex, 1, "a decline is a measured comparison");
  assert.equal(model.rows[2].epoch, 4);
  assert.equal(model.rows[2].previousPrice, null);
  assert.equal(model.rows[2].growth, null);
});

test("every historical frame matches a model built only from observations then available", () => {
  const source = rowsFrom([0, 10, 20, 209999, 210000, 210009, 210020, 419999, 420000], [0, 1, 2, 3, 4, 5, 6, 7, 8]);
  const model = M.buildModel(source);
  for (let index = 0; index < source.length; index += 1) {
    const actual = M.frame(model, index), prefix = M.frame(M.buildModel(source.slice(0, index + 1)));
    assert.deepEqual(actual, prefix);
    assert.ok(actual.epochs.every((group) => group.rows.every((row) => row.index <= index)));
    assert.ok(actual.epochs.every((group) => group.marker.index <= index));
    assert.equal(M.frame(model, source[index].date).index, index);
    assert.equal(M.frame(model, source[index].time).index, index);
  }
  assert.equal(M.indexAtTime(model, model.rows[3].time + 1000), 3, "an intraday selection never selects tomorrow");
  assert.equal(M.frame(model, -1).index, 0);
  assert.equal(M.frame(model, 999).index, source.length - 1);
  assert.throws(() => M.frame(model, 0.2), RangeError);
  assert.throws(() => M.frame(model, "bad"), RangeError);
});

function currentTuple(model, changes = {}) {
  const latest = model.rows.at(-1), at = Date.parse(latest.timestamp.replace(" ", "T") + "Z") + 500;
  const height = latest.height + 5, referenceHeight = height - M.EPOCH_BLOCKS;
  const prior = M.nearestRow(model.epochs.find((group) => group.epoch === Math.floor(referenceHeight / M.EPOCH_BLOCKS) + 1)?.rows,
    referenceHeight % M.EPOCH_BLOCKS + 1) || model.rows[0];
  const referenceTime = prior.time + M.DAY_MS / 2;
  return { quote: { price: 90, at, source: "fixture" }, tip: { height, blockTime: at - 60000 },
    reference: { height: referenceHeight, blockTime: referenceTime, priceTime: referenceTime + 30000, price: 30 },
    live: true, ...changes };
}
function deepFreeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value); Object.values(value).forEach(deepFreeze);
  }
  return value;
}

test("current EOE projection uses the exact block reference and leaves published history immutable", () => {
  const model = deepFreeze(M.buildModel(rowsFrom([0, 5, 10, 210000, 210005, 210010, 420000, 420005, 420010],
    [1, 2, 3, 10, 20, 25, 50, 60, 70])));
  const current = deepFreeze(currentTuple(model)), published = M.frame(model), serialized = JSON.stringify(model);
  const projected = M.liveFrame(model, current), first = projected.epochs.find((group) => group.epoch === 1);
  const previous = projected.epochs.find((group) => group.epoch === 2), active = projected.epochs.find((group) => group.epoch === 3);
  assert.equal(projected.row.price, 90);
  assert.equal(projected.row.previousPrice, 30);
  assert.equal(projected.row.growth, 200);
  assert.deepEqual([projected.row.height, projected.row.epoch, projected.row.epochBlockCount, projected.row.count], [420015, 3, 16, 16]);
  assert.equal(previous.marker, projected.referenceRow);
  assert.equal(previous.marker.height, 210015);
  assert.equal(previous.marker.price, projected.row.previousPrice, "marker and growth denominator must use the same exact reference");
  assert.equal(active.marker, projected.row);
  assert.equal(projected.referenceRow.previousPrice, 3, "older bands may retain the nearest published comparison");
  assert.equal(projected.referenceRow.growth, 900);
  assert.deepEqual(active.rows.map((row) => row.height), [420000, 420005, 420015], "replace the unfinished same-day endpoint");
  assert.deepEqual(previous.rows.slice(0, -1), model.epochs[1].rows);
  assert.deepEqual(first.rows, model.epochs[0].rows);
  assert.notEqual(first.rows, model.epochs[0].rows, "display arrays must be separate from the published model");
  assert.equal(JSON.stringify(model), serialized);
  assert.deepEqual(M.frame(model), published, "historical/export frames remain byte-for-byte equivalent");
  assert.notEqual(projected.current, current);
  assert.notEqual(projected.current.quote, current.quote);
  assert.deepEqual(projected.current, current);
  assert.equal(projected.row.source, "live");
  assert.equal(projected.row.liveSource, "current");
  assert.equal(projected.referenceRow.source, "block-reference");
  assert.equal(projected.referenceRow.liveSource, "reference");
  assert.equal(projected.row.quoteAt, current.quote.at);
  assert.equal(projected.row.blockTime, current.tip.blockTime);
  assert.equal(projected.row.referenceHeight, current.reference.height);
  assert.equal(projected.row.referenceBlockTime, current.reference.blockTime);
  assert.equal(projected.row.referencePriceTime, current.reference.priceTime);
  assert.equal(projected.referenceRow.timestamp, new Date(current.reference.priceTime).toISOString());
  assert.equal(projected.referenceRow.priceTime, current.reference.priceTime, "preserve actual sample time even after the block timestamp");
  assert.ok(projected.epochs.every((group) => group.rows.every((row) => row.index <= model.rows.length - 1)));
});

test("a new halving epoch starts at count one and preserves the prior epoch's final daily point", () => {
  const model = M.buildModel(rowsFrom([0, 210000, 419999], [1, 10, 20]));
  const current = currentTuple(model);
  current.tip.height = 420000; current.reference.height = 210000; current.reference.price = 12;
  const projected = M.liveFrame(model, current);
  assert.equal(projected.row.epoch, 3);
  assert.equal(projected.row.epochBlockCount, 1);
  assert.deepEqual(projected.epochs.map((group) => group.epoch), [1, 2, 3]);
  assert.deepEqual(projected.epochs[1].rows.map((row) => [row.height, row.price]), [[210000, 12], [419999, 20]]);
  assert.deepEqual(projected.epochs[2].rows, [projected.row]);
  assert.equal(projected.epochs[1].marker, projected.referenceRow);
  assert.equal(projected.row.previousPrice, 12);
  assert.equal(projected.row.growth, 650);
  assert.equal(model.epochs.length, 2);
  assert.equal(model.rows.at(-1).height, 419999);
});

test("exact repeated heights get one live point and reference marker while all other offsets retain their order", () => {
  const model = M.buildModel(rowsFrom([0, 5, 210000, 210005, 210005, 210010, 420000, 420005, 420005],
    [1, 2, 10, 20, 21, 30, 50, 60, 61]));
  const current = currentTuple(model);
  current.tip.height = 420005; current.reference.height = 210005;
  const projected = M.liveFrame(model, current), previous = projected.epochs[1], active = projected.epochs[2];
  assert.deepEqual(previous.rows.map((row) => row.height), [210000, 210005, 210010]);
  assert.deepEqual(active.rows.map((row) => row.height), [420000, 420005]);
  assert.equal(M.nearestRow(previous.rows, 6), projected.referenceRow);
  assert.equal(M.nearestRow(active.rows, 6), projected.row);
  assert.equal(model.epochs[1].rows.length, 4);
  assert.equal(model.epochs[2].rows.length, 3);
});

test("zero and negative current growth are measured, and retained quotes preserve their provenance", () => {
  const model = M.buildModel(rowsFrom([0, 210000], [10, 20]));
  for (const [price, growth] of [[30, 0], [15, -50]]) {
    const current = currentTuple(model);
    current.quote.price = price; current.live = false;
    const projected = M.liveFrame(model, current);
    assert.equal(projected.row.growth, growth);
    assert.equal(projected.source, "retained");
    assert.equal(projected.live, false);
    assert.equal(projected.current.live, false);
    assert.equal(projected.referenceRow.previousPrice, null, "epoch one has no older comparison");
    assert.equal(projected.referenceRow.growth, null);
  }
});

test("a quote after UTC rollover appends a current endpoint with bounded display indices", () => {
  const model = M.buildModel(rowsFrom([0, 210000, 210005], [1, 10, 20]));
  const current = currentTuple(model);
  current.quote.at += M.DAY_MS;
  const projected = M.liveFrame(model, current);
  assert.equal(projected.row.date, iso(model.latestTime + M.DAY_MS));
  assert.equal(projected.row.time, model.latestTime + M.DAY_MS);
  assert.equal(projected.row.timestamp, new Date(current.quote.at).toISOString());
  assert.equal(projected.row.index, model.rows.length - 1);
  assert.deepEqual(projected.epochs[1].rows.map((row) => row.height), [210000, 210005, 210010]);
  assert.equal(model.rows.at(-1).date, iso(model.latestTime));
});

test("invalid, mismatched, backward-height, and stale live tuples fall back without changing the model", () => {
  const model = deepFreeze(M.buildModel(rowsFrom([0, 210000, 210005], [1, 10, 20])));
  assert.equal(M.liveFrame(null, null), null);
  for (const value of [null, {}, { quote: {} }, { tip: {} }, { reference: {} }]) assert.equal(M.liveFrame(model, value), null);
  const bad = [
    (tuple) => { tuple.quote.price = 0; }, (tuple) => { tuple.quote.price = -1; },
    (tuple) => { tuple.quote.price = NaN; }, (tuple) => { tuple.reference.price = 0; },
    (tuple) => { tuple.reference.price = -1; }, (tuple) => { tuple.reference.price = Infinity; },
    (tuple) => { tuple.quote.at -= 500; }, (tuple) => { tuple.quote.at -= M.DAY_MS; },
    (tuple) => { tuple.quote.at = Infinity; }, (tuple) => { tuple.quote.at = 9e15; },
    (tuple) => { tuple.tip.height = model.rows.at(-1).height - 1; tuple.reference.height = tuple.tip.height - M.EPOCH_BLOCKS; },
    (tuple) => { tuple.tip.height += .5; tuple.reference.height += .5; },
    (tuple) => { tuple.reference.height += 1; }, (tuple) => { tuple.tip.blockTime = 0; },
    (tuple) => { tuple.reference.blockTime = NaN; }, (tuple) => { tuple.reference.priceTime = undefined; },
  ];
  for (const change of bad) {
    const tuple = currentTuple(model); change(tuple);
    assert.equal(M.liveFrame(model, tuple), null, change.toString());
  }
  assert.equal(M.liveFrame(model, currentTuple(model)).row.price, 90, "a rejected tuple does not poison a later complete update");
});

function uniformExportFrames(startIndex, endIndex, speed) {
  const frames = [];
  for (let position = 0; Math.floor(position * speed) <= endIndex - startIndex; position += 1) {
    frames.push(startIndex + Math.floor(position * speed));
  }
  if (frames.at(-1) !== endIndex) frames.push(endIndex);
  return frames;
}
const exportFixture = (growth) => ({ rows: growth.map((value) => ({ growth: value })) });

test("disabling the fast intro preserves the prior frame plan at every selected speed", () => {
  const model = exportFixture([...Array(10).fill(null), 0, -5, null, null, 20, 30, 40]);
  for (const speed of [0.5, 1, 2, 4]) {
    for (const [startIndex, endIndex] of [[0, 16], [1, 9], [9, 10], [10, 16], [12, 15], [16, 16]]) {
      const options = { startIndex, endIndex, speed, endFrameHold: false };
      assert.deepEqual(M.exportFrames(model, { ...options, fastIntro: false }),
        uniformExportFrames(startIndex, endIndex, speed));
      if (startIndex >= 10) assert.deepEqual(M.exportFrames(model, { ...options, fastIntro: true }),
        uniformExportFrames(startIndex, endIndex, speed), "later gaps never restart the accelerated intro");
    }
  }
});

test("the intro samples at four times the chosen speed and includes the first measured frame", () => {
  const model = exportFixture([...Array(10).fill(null), 0, -5, null, null, 20, 30, 40]);
  const expected = new Map([
    [0.5, [1, 3, 5, 7, 9, 10, 10, 11, 11, 12, 12, 13, 13, 14, 14, 15, 15, 16, 16]],
    [1, [1, 5, 9, 10, 11, 12, 13, 14, 15, 16]],
    [2, [1, 9, 10, 12, 14, 16]],
    [4, [1, 10, 14, 16]],
  ]);
  for (const [speed, indices] of expected) {
    assert.deepEqual(M.exportFrames(model, { startIndex: 1, endIndex: 16, speed, endFrameHold: false }), indices);
  }
});

test("zero and negative growth end the intro, while nonfinite values do not", () => {
  for (const firstGrowth of [0, -25]) {
    const model = exportFixture([null, undefined, NaN, Infinity, -Infinity, firstGrowth, null, null]);
    assert.deepEqual(M.exportFrames(model, { endFrameHold: false }), [0, 4, 5, 6, 7]);
  }
  const firstRowMeasured = exportFixture([0, null, null, null, -10]);
  assert.deepEqual(M.exportFrames(firstRowMeasured, { endFrameHold: false }), [0, 1, 2, 3, 4]);
});

test("short and paused ranges preserve both endpoints without exporting beyond the selected end", () => {
  const model = exportFixture([...Array(10).fill(null), 20, 30, 40]);
  for (const [startIndex, endIndex, expected] of [[1, 8, [1, 5, 8]], [1, 9, [1, 5, 9]],
    [1, 10, [1, 5, 9, 10]], [8, 11, [8, 10, 11]], [7, 7, [7]], [10, 10, [10]]]) {
    const actual = M.exportFrames(model, { startIndex, endIndex, endFrameHold: false });
    assert.deepEqual(actual, expected);
    assert.ok(actual.every((index) => index >= startIndex && index <= endIndex));
  }
  assert.deepEqual(M.exportFrames(exportFixture(Array(10).fill(null)), { endFrameHold: false }), [0, 4, 8, 9]);
});

test("export holds retain thirty opening and ninety final copies of the selected end frame", () => {
  const model = exportFixture([...Array(10).fill(null), 0, 20, 30]);
  const options = { startIndex: 1, endIndex: 11, speed: 2 };
  const sourceFrames = M.exportFrames(model, { ...options, endFrameHold: false });
  const held = M.exportFrames(model, options);
  assert.deepEqual(held, [...Array(30).fill(11), ...sourceFrames, ...Array(90).fill(11)]);
  assert.equal((held.length - sourceFrames.length) / 30, 4, "hold duration remains four seconds at 30 output fps");
  assert.equal(Math.max(...held), 11, "opening and final holds respect a paused export endpoint");
});

test("export planning rejects invalid ranges and unsupported sampling speeds", () => {
  const model = exportFixture([null, null, 0]);
  for (const options of [{ startIndex: -1 }, { endIndex: 3 }, { startIndex: 2, endIndex: 1 },
    { startIndex: 0.5 }, { endIndex: NaN }, { speed: 0 }, { speed: -1 }, { speed: Infinity }, { speed: 0.1 }]) {
    assert.throws(() => M.exportFrames(model, options), RangeError);
  }
  assert.throws(() => M.exportFrames(exportFixture([])), RangeError);
});

test("CSV parsing validates dates, UTC timestamps, required heights, and quoted fields", () => {
  const csv = '\ufeffdate,timestamp,price,block_height,note\r\n"1/3/09","2009-01-03 23:59:59",0,0,"hello, ""Bitcoin"""\r\n';
  assert.deepEqual(M.parseCSV(csv), rowsFrom([0], [0]));
  assert.equal(M.parseCSV(csv.replace("1/3/09", "2009-01-03"))[0].date, "2009-01-03");
  for (const invalid of [csv.replace("1/3/09", "2/30/09"), csv.replace("23:59:59", "24:59:59"),
    csv.replace("23:59:59", "23:59:59-02:00"), csv.replace(",0,0,", ",-1,0,"),
    csv.replace(",0,0,", ",NaN,0,"), csv.replace(",0,0,", ",0,1.1,"),
    csv.replace(",0,0,", ",0,,"), csv.replace("block_height", "height"),
    csv.replace("block_height", "price"), csv.slice(0, -3)]) assert.throws(() => M.parseCSV(invalid));
});

test("incomplete days, invalid heights, and zero prices after valued history reject the entire model", () => {
  const rows = rowsFrom([0, 1, 2], [0, 1, 2]);
  assert.throws(() => M.buildModel([]), /No price history/);
  assert.throws(() => M.buildModel([rows[0], rows[2]]), /missing, duplicated/);
  assert.throws(() => M.buildModel([rows[0], rows[0]]), /missing, duplicated/);
  assert.throws(() => M.buildModel([rows[0], rows[1], { ...rows[2], height: 0 }]), /moved backward/);
  assert.throws(() => M.buildModel([rows[0], rows[1], { ...rows[2], price: 0 }]), /missing price/);
  assert.throws(() => M.buildModel([{ ...rows[0], height: -1 }]), /invalid row/);
  assert.throws(() => M.buildModel([{ ...rows[0], time: rows[0].time + 1 }]), /invalid row/);
});

test("initial loading binds all source rows to a hash marker and rechecks before returning", async () => {
  const pub = publication(rowsFrom([0, 20, 210010], [0, 2, 10])), fixture = fetchFixture(pub);
  const candidate = await M.prepareCandidate(fixture);
  assert.deepEqual(fixture.calls, [M.MARKER_URL, M.DATA_URL, M.MARKER_URL]);
  assert.equal(candidate.signature, pub.signature);
  assert.equal(candidate.publishedAt, "2009-01-05T23:59:59.000Z");
  assert.equal(candidate.latestHeight, 210010);
  assert.equal(candidate.sourceRows[0].price, 0);
  assert.equal(M.validateCandidate(candidate), true);
  const superseded = fetchFixture(pub, pub.signature.replace('"rows":3', '"rows":4'));
  await assert.rejects(M.prepareCandidate(superseded), /changed during loading/);
});

test("refresh candidates honor the controller's marker and leave final rechecking to it", async () => {
  const pub = publication(rowsFrom([0, 1], [0, 2])), fixture = fetchFixture(pub);
  const candidate = await M.prepareCandidate({ ...fixture, signatureParts: [pub.signature] });
  assert.deepEqual(fixture.calls, [M.DATA_URL]);
  assert.equal(candidate.signature, pub.signature);
  assert.equal(M.validateCandidate(candidate, candidate), true);
});

test("corrupt, incomplete, failed, and superseded publications never yield a candidate", async () => {
  const pub = publication(rowsFrom([0, 20, 210010], [0, 2, 10]));
  await assert.rejects(M.prepareCandidate(fetchFixture({ ...pub, csv: pub.csv.replace(",10,", ",11,") })), /does not match/);
  for (const change of [{ latest_block_height: 210011 }, { latest_date: "2009-01-06" },
    { artifact: { ...pub.marker.artifact, rows: 4 } }, { schema_version: 2 },
    { artifact: { ...pub.marker.artifact, path: "wrong.csv" } }, { latest_timestamp: "bad" }]) {
    const invalid = { ...pub, signature: JSON.stringify({ ...pub.marker, ...change }) };
    await assert.rejects(M.prepareCandidate(fetchFixture(invalid)), /invalid|does not match/);
  }
  await assert.rejects(M.prepareCandidate({ fetchFresh: async () => ({ ok: false, status: 503 }) }), /503/);
  await assert.rejects(M.prepareCandidate({ fetchFresh: async () => { throw new Error("offline"); } }), /offline/);
  await assert.rejects(M.prepareCandidate(fetchFixture({ ...pub, signature: "{" })), /invalid JSON/);
});

test("refresh rejects backward publication date, timestamp, height, and history start", async () => {
  const current = await M.prepareCandidate(fetchFixture(publication(rowsFrom([0, 20, 210010], [0, 2, 10]))));
  for (const rows of [rowsFrom([0, 20], [0, 2]), rowsFrom([0, 20, 210009], [0, 2, 10]),
    rowsFrom([20, 210010], [2, 10], "2009-01-04")]) {
    const fixture = fetchFixture(publication(rows));
    await assert.rejects(M.prepareCandidate({ ...fixture, installed: current }), /moved backward/);
  }
  const earlier = rowsFrom([0, 20, 210010], [0, 2, 10]);
  earlier.at(-1).timestamp = "2009-01-05 12:00:00";
  await assert.rejects(M.prepareCandidate({ ...fetchFixture(publication(earlier)), installed: current }), /moved backward/);
  assert.equal(current.rows.at(-1).price, 10, "failed prepare cannot mutate installed data");
});

test("published history matches independent nearest-offset notebook calculations", async () => {
  const csv = await readFile(new URL("../assets/daily_price.csv", import.meta.url), "utf8");
  const rows = M.parseCSV(csv), model = M.buildModel(rows);
  assert.equal(model.rows.length, rows.length);
  assert.equal(model.rows[0].date, "2009-01-03");
  for (const row of model.rows) {
    const prior = model.epochs.find((group) => group.epoch === row.epoch - 1)?.rows;
    if (!prior) { assert.equal(row.growth, null); continue; }
    const nearest = prior.reduce((best, candidate) =>
      Math.abs(candidate.height % M.EPOCH_BLOCKS - row.height % M.EPOCH_BLOCKS)
        < Math.abs(best.height % M.EPOCH_BLOCKS - row.height % M.EPOCH_BLOCKS) ? candidate : best);
    assert.equal(row.previousIndex, nearest.index);
    assert.equal(row.previousPrice, nearest.price);
    assert.equal(row.growth, row.price > 0 && nearest.price > 0 ? (row.price - nearest.price) / nearest.price * 100 : null);
    assert.ok(nearest.index < row.index, "the previous epoch sample must precede its observation");
  }
});
