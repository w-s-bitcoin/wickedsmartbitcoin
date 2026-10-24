import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";
import { readFileSync } from "node:fs";
import { createHash, webcrypto } from "node:crypto";
import L from "../webapps/eoe_growth/eoe_growth_live.js";

if (!globalThis.crypto) Object.defineProperty(globalThis, "crypto", { value: webcrypto });
const source = readFileSync(new URL("../webapps/eoe_growth/eoe_growth_live.js", import.meta.url), "utf8");
const publishedAt = "2026-10-24T12:00:00Z", quoteTime = Date.parse("2026-10-24T12:40:00Z");
const tip = (height, time = "2026-10-24 12:34:43 UTC") => ({ block_height: height, block_time_utc: time });
const digest = (buffer) => createHash("sha256").update(Buffer.from(buffer)).digest("hex");
function chunk(start, records) {
  const buffer = new ArrayBuffer(records.length * 16), data = new DataView(buffer);
  records.forEach(([blockTime, priceTime, price], index) => {
    data.setUint32(index * 16, blockTime, true); data.setUint32(index * 16 + 4, priceTime, true);
    data.setFloat64(index * 16 + 8, price, true);
  });
  return { buffer, descriptor: { start, count: records.length, path: `${start}.bin`, sha256: digest(buffer) } };
}
function publication(chunks) {
  return { schema_version: 1, chunk_size: 4096, record_bytes: 16,
    first_height: chunks[0].descriptor.start,
    last_height: chunks.at(-1).descriptor.start + chunks.at(-1).descriptor.count - 1,
    chunks: chunks.map((item) => item.descriptor) };
}
const record = (price = 100) => [1600000000, 1600000200, price];

test("tip validation requires an exact integer height and explicit valid UTC time", () => {
  assert.deepEqual(L.parseTip(tip(972920)), { height: 972920, blockTime: Date.parse("2026-10-24T12:34:43Z") });
  assert.equal(L.parseTip({ block_height: 1, block_timestamp: 1600000000 }).blockTime, 1600000000000);
  for (const value of [tip(-1), tip(1.5), tip("1"), tip(1, "2026-10-24 12:00:00"),
    tip(1, "2026-02-30T12:00:00Z"), tip(1, "2026-10-24T24:00:00Z"), tip(1, "invalid")]) assert.throws(() => L.parseTip(value));
});

test("manifest lookup supports partial first chunks and rejects malformed catalogs and unsafe paths", () => {
  const first = chunk(4094, [record(), record()]), second = chunk(4096, [record(), record(), record()]);
  const manifest = L.validateManifest(publication([first, second]));
  assert.equal(L.chunkForHeight(manifest, 4095).start, 4094);
  assert.equal(L.chunkForHeight(manifest, 4096).start, 4096);
  assert.equal(L.chunkForHeight(manifest, 4093), null);
  assert.equal(L.chunkForHeight(manifest, 4099), null);
  for (const path of ["../bad.bin", "/bad.bin", "https://example.org/file", "part//file", "file?query", "%2e%2e/file"]) {
    const bad = structuredClone(manifest); bad.chunks[0].path = path;
    assert.throws(() => L.validateManifest(bad), path);
  }
  for (const mutate of [m => m.chunk_size = 2, m => m.record_bytes = 8, m => m.schema_version = 2,
    m => m.chunks[1].start++, m => m.chunks[1].count = 4097, m => m.last_height++,
    m => m.chunks[0].sha256 = "fabricated", m => m.chunks[1].path = m.chunks[0].path]) {
    const bad = structuredClone(manifest); mutate(bad); assert.throws(() => L.validateManifest(bad));
  }
});

test("binary records verify SHA and lengths, preserve nonmonotonic block times, and expose unavailable rows", async () => {
  const fixture = chunk(500, [record(123.45), [1599999000, 1600000200, 90], [0, 0, 0],
    [1600000000, 1600000200, 0], [1600000000, 0, 20]]);
  const rows = await L.decodeChunk(fixture.buffer, fixture.descriptor);
  assert.deepEqual(rows[0], { height: 500, blockTime: 1600000000000, priceTime: 1600000200000, price: 123.45 });
  assert.equal(rows[1].blockTime, 1599999000000);
  assert.deepEqual(rows.slice(2), [null, null, null]);
  assert.ok(Object.isFrozen(rows) && Object.isFrozen(rows[0]));
  await assert.rejects(L.decodeChunk(fixture.buffer.slice(0, -1), fixture.descriptor), /length/);
  await assert.rejects(L.decodeChunk(fixture.buffer, { ...fixture.descriptor, sha256: "0".repeat(64) }), /hash/);
  for (const price of [NaN, Infinity, -1]) {
    const bad = chunk(1, [record(price)]);
    await assert.rejects(L.decodeChunk(bad.buffer, bad.descriptor), /price/);
  }
});

function fixture(chunks = [chunk(500, [record(100), record(200), record(300)])]) {
  const timers = new Map(), listeners = new Map(), requests = [];
  let nextTimer = 1, onQuote, changed = 0, starts = 0, stops = 0;
  const state = { tip: tip(210500), manifest: publication(chunks), live: true,
    quote: { price: 1000, at: quoteTime, receivedAt: quoteTime, source: "Fixture live" }, intercept: null };
  const buffers = new Map(chunks.map((item) => [item.descriptor.path, item.buffer]));
  const root = { crypto: webcrypto, AbortController, ArrayBuffer, DataView, Uint8Array,
    document: { visibilityState: "visible", addEventListener: (name, fn) => listeners.set(name, fn),
      removeEventListener: name => listeners.delete(name) },
    setTimeout: (fn, delay) => { const id = nextTimer++; timers.set(id, { fn, delay }); return id; },
    clearTimeout: id => timers.delete(id),
    WSBBitcoinSpotPrice: { create: ({ onQuote: callback }) => {
      onQuote = callback;
      return { start: () => starts++, stop: () => stops++, isLive: () => state.live,
        newerThan: time => state.quote?.at > time ? state.quote : null };
    } },
    fetch: async (url, options) => {
      requests.push({ url, options });
      const intercepted = state.intercept?.(url, options);
      if (intercepted !== undefined) return intercepted;
      if (url === L.TIP_URL) return { ok: true, json: async () => structuredClone(state.tip) };
      if (url === L.MANIFEST_URL) return { ok: true, json: async () => structuredClone(state.manifest) };
      const path = url.split("?")[0].split("/").at(-1), buffer = buffers.get(path);
      return buffer ? { ok: true, arrayBuffer: async () => buffer.slice(0) } : { ok: false, status: 404 };
    },
  };
  const sandbox = { window: root, AbortController, ArrayBuffer, DataView, Uint8Array, console };
  vm.runInNewContext(source, sandbox);
  const adapter = root.WSBEOEGrowthLive.create({ onChange: () => changed++, getPublishedAt: () => publishedAt });
  const context = { publishedAt, latestHeight: 210499 };
  return { root, state, requests, buffers, timers, adapter, context,
    start: async () => { adapter.start(); return adapter.refresh(); },
    current: () => adapter.current(context), changes: () => changed,
    emit: () => onQuote(), counts: () => ({ starts, stops }),
    visibility: value => { root.document.visibilityState = value; listeners.get("visibilitychange")?.(); } };
}
const deferred = () => { let resolve; const promise = new Promise(r => resolve = r); return { promise, resolve }; };
async function until(predicate) {
  for (let count = 0; count < 200; count++) {
    if (predicate()) return;
    await new Promise(resolve => setImmediate(resolve));
  }
  throw new Error("Fixture did not reach the expected async state.");
}

test("complete comparison uses shared quote freshness and superseding publication rules", async () => {
  const f = fixture();
  assert.equal(f.current(), null);
  assert.equal(await f.start(), true);
  const current = f.current();
  assert.equal(current.tip.height, 210500); assert.equal(current.reference.height, 500);
  assert.equal(current.reference.price, 100); assert.equal(current.quote.price, 1000); assert.equal(current.live, true);
  assert.ok(Object.isFrozen(current) && Object.isFrozen(current.quote));
  assert.equal(f.adapter.current({ publishedAt, latestHeight: 210501 }), null);
  assert.equal(f.adapter.current({ publishedAt: quoteTime, latestHeight: 210499 }), null);
  assert.equal(f.adapter.current().tip.height, 210500, "optional publication getter is supported");
  const changed = f.changes(); f.state.live = false; f.emit();
  assert.equal(f.current().live, false); assert.equal(f.changes(), changed + 1);
  f.state.quote = null; f.emit(); assert.equal(f.current(), null);
  f.adapter.stop(); assert.deepEqual(f.counts(), { starts: 1, stops: 1 }); assert.equal(f.timers.size, 0);
});

test("new heights commit atomically, reuse verified chunks, and retain the prior pair after failure", async () => {
  const f = fixture(); await f.start();
  const requests = f.requests.filter(r => r.url.includes(".bin?")).length;
  f.state.tip = tip(210501);
  assert.equal(await f.adapter.refresh(), true);
  assert.equal(f.current().reference.price, 200);
  assert.equal(f.requests.filter(r => r.url.includes(".bin?")).length, requests, "one chunk serves successive heights");
  f.state.tip = tip(210502);
  f.state.intercept = url => url === L.MANIFEST_URL ? Promise.reject(new Error("Offline")) : undefined;
  assert.equal(await f.adapter.refresh(), false);
  assert.equal(f.current().tip.height, 210501); assert.equal(f.current().reference.height, 501);
  f.state.intercept = null;
  assert.equal(await f.adapter.refresh(), true); assert.equal(f.current().reference.price, 300);
  f.state.tip = tip(210500);
  assert.equal(await f.adapter.refresh(), false); assert.equal(f.current().tip.height, 210502, "stale/shorter chain cannot regress view");
  f.adapter.stop();
});

test("tip and manifest must still match after lookup; same-height replacement requires a stable pair", async () => {
  const f = fixture(); await f.start();
  f.state.tip = tip(210501); let tipCalls = 0;
  f.state.intercept = url => url === L.TIP_URL && ++tipCalls === 2
    ? { ok: true, json: async () => tip(210502) } : undefined;
  assert.equal(await f.adapter.refresh(), false); assert.equal(f.current().tip.height, 210500);
  let markerCalls = 0;
  f.state.intercept = url => url === L.MANIFEST_URL && ++markerCalls === 2
    ? { ok: true, json: async () => ({ ...f.state.manifest, last_height: 900 }) } : undefined;
  assert.equal(await f.adapter.refresh(), false); assert.equal(f.current().tip.height, 210500);
  f.state.intercept = null; f.state.tip = tip(210500, "2026-10-24 12:35:00 UTC");
  assert.equal(await f.adapter.refresh(), true);
  assert.equal(f.current().tip.blockTime, Date.parse("2026-10-24T12:35:00Z"));
  f.adapter.stop();
});

test("out-of-order requests cannot replace a newer complete pair and stop cancels pending work", async () => {
  const a = chunk(500, [record(100)]), b = chunk(501, [record(200)]), c = chunk(502, [record(300)]);
  const f = fixture([a, b, c]); await f.start();
  const hold = deferred(); f.state.tip = tip(210501);
  f.state.intercept = url => url.includes("/501.bin?") ? hold.promise : undefined;
  const old = f.adapter.refresh();
  await until(() => f.requests.some(r => r.url.includes("/501.bin?")));
  assert.equal(f.current().tip.height, 210500, "pending reference cannot expose a new height with the old denominator");
  f.state.tip = tip(210502); assert.equal(await f.adapter.refresh(), true);
  hold.resolve({ ok: true, arrayBuffer: async () => b.buffer });
  assert.equal(await old, false); assert.equal(f.current().reference.price, 300);
  const pending = deferred(); f.state.intercept = url => url === L.TIP_URL ? pending.promise : undefined;
  const stopped = f.adapter.refresh(), changed = f.changes(); f.adapter.stop();
  pending.resolve({ ok: true, json: async () => tip(210502) });
  assert.equal(await stopped, false); f.emit(); assert.equal(f.changes(), changed);
  assert.equal(f.timers.size, 0); assert.equal(await f.adapter.refresh(), false);
});

test("zero or missing reference data remains unavailable and corrected chunks are reverified", async () => {
  const zeros = fixture([chunk(500, [[1600000000, 1600000200, 0]])]);
  assert.equal(await zeros.start(), false); assert.equal(zeros.current(), null); zeros.adapter.stop();
  const f = fixture([0, 1, 2, 3].map(i => chunk(500 + i, [record(100 + i)])));
  await f.start();
  for (let offset = 1; offset <= 3; offset++) {
    f.state.tip = tip(210500 + offset); assert.equal(await f.adapter.refresh(), true);
  }
  // A new manifest can safely reuse a path after publication, because SHA is in
  // both the verified-cache key and the request URL.
  const replacement = chunk(503, [record(999)]);
  f.state.manifest.chunks[3] = replacement.descriptor; f.buffers.set("503.bin", replacement.buffer);
  assert.equal(await f.adapter.refresh(), true); assert.equal(f.current().reference.price, 999);
  f.state.tip = tip(210504); assert.equal(await f.adapter.refresh(), false); assert.equal(f.current().tip.height, 210503);
  f.adapter.stop();
});

test("verified cache evicts older chunks after three generations", async () => {
  const original = chunk(500, [record(100)]), f = fixture([original]);
  await f.start();
  for (const price of [200, 300, 400]) {
    const next = chunk(500, [record(price)]);
    f.state.manifest = publication([next]); f.buffers.set(next.descriptor.path, next.buffer);
    assert.equal(await f.adapter.refresh(), true);
  }
  const requests = f.requests.filter(request => request.url.includes(".bin?")).length;
  f.state.manifest = publication([original]); f.buffers.set(original.descriptor.path, original.buffer);
  assert.equal(await f.adapter.refresh(), true);
  assert.equal(f.requests.filter(request => request.url.includes(".bin?")).length, requests + 1,
    "the fourth distinct verified chunk evicts the oldest instead of accumulating history");
  assert.equal(f.current().reference.price, 100); f.adapter.stop();
});

test("a request completing after its timeout cannot commit even if transport ignores abort", async () => {
  const f = fixture(); await f.start();
  f.state.tip = tip(210501); const pending = deferred();
  f.state.intercept = url => url === L.TIP_URL ? pending.promise : undefined;
  const refresh = f.adapter.refresh();
  const timeout = [...f.timers.values()].find(timer => timer.delay === 15000);
  assert.ok(timeout); timeout.fn();
  pending.resolve({ ok: true, json: async () => f.state.tip });
  assert.equal(await refresh, false); assert.equal(f.current().tip.height, 210500);
  f.adapter.stop();
});

test("visibility cancels pending lookup and polling resumes only while visible", async () => {
  const f = fixture(); await f.start();
  assert.ok([...f.timers.values()].some(timer => timer.delay === 60000));
  f.visibility("hidden"); assert.equal(f.timers.size, 0);
  const before = f.requests.length;
  assert.equal(await f.adapter.refresh(), false); assert.equal(f.requests.length, before);
  f.visibility("visible"); await until(() => f.requests.length > before);
  await f.adapter.refresh(); assert.ok([...f.timers.values()].some(timer => timer.delay === 60000));
  f.adapter.stop(); assert.equal(f.timers.size, 0);
});
