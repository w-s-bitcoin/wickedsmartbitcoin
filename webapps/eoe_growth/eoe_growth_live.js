(function (root) {
  "use strict";
  const EPOCH_BLOCKS = 210000, CHUNK_SIZE = 4096, RECORD_BYTES = 16;
  const TIP_URL = "../../assets/top_kpis.json", REFERENCE_URL = "webapp_data/reference/";
  const MANIFEST_URL = REFERENCE_URL + "manifest.json", POLL_MS = 60000, TIMEOUT_MS = 15000;

  function utcTime(value) {
    if (typeof value === "number") return Number.isFinite(value) && value > 0 ? value : NaN;
    const text = String(value || "").trim().replace(/ UTC$/i, "Z").replace(" ", "T");
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})$/i.test(text)) return NaN;
    if (Number(text.slice(11, 13)) > 23 || Number(text.slice(14, 16)) > 59 || Number(text.slice(17, 19)) > 59) return NaN;
    const day = Date.parse(text.slice(0, 10) + "T00:00:00Z");
    if (!Number.isFinite(day) || new Date(day).toISOString().slice(0, 10) !== text.slice(0, 10)) return NaN;
    const time = Date.parse(text);
    return Number.isFinite(time) && time > 0 ? time : NaN;
  }

  function parseTip(payload) {
    const height = payload?.block_height;
    const rawTime = payload?.block_time_utc ?? payload?.block_timestamp;
    const blockTime = utcTime(typeof rawTime === "number" && rawTime < 1e12 ? rawTime * 1000 : rawTime);
    if (!Number.isSafeInteger(height) || height < 0 || !Number.isFinite(blockTime)) {
      throw new Error("Invalid published block height or UTC timestamp.");
    }
    return Object.freeze({ height, blockTime });
  }

  function safePath(path) {
    return typeof path === "string" && path.split("/").every((part) =>
      /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(part) && part !== "." && part !== "..");
  }

  function validateManifest(value) {
    if (value?.schema_version !== 1 || value.chunk_size !== CHUNK_SIZE || value.record_bytes !== RECORD_BYTES
        || !Number.isSafeInteger(value.first_height) || value.first_height < 0
        || !Number.isSafeInteger(value.last_height) || value.last_height < value.first_height
        || !Array.isArray(value.chunks) || !value.chunks.length) {
      throw new Error("Invalid epoch reference manifest.");
    }
    let next = value.first_height;
    const paths = new Set();
    const chunks = value.chunks.map((chunk) => {
      if (!Number.isSafeInteger(chunk?.start) || chunk.start !== next
          || !Number.isSafeInteger(chunk.count) || chunk.count < 1 || chunk.count > CHUNK_SIZE
          || !safePath(chunk.path) || paths.has(chunk.path) || !/^[a-f0-9]{64}$/.test(chunk.sha256 || "")) {
        throw new Error("Invalid or incomplete epoch reference chunk catalog.");
      }
      next += chunk.count;
      if (!Number.isSafeInteger(next) || next > value.last_height + 1) throw new Error("Epoch reference bounds do not match the catalog.");
      paths.add(chunk.path);
      return Object.freeze({ start: chunk.start, count: chunk.count, path: chunk.path, sha256: chunk.sha256 });
    });
    if (next !== value.last_height + 1) throw new Error("Epoch reference catalog is truncated.");
    return Object.freeze({ schema_version: 1, chunk_size: CHUNK_SIZE, record_bytes: RECORD_BYTES,
      first_height: value.first_height, last_height: value.last_height, chunks: Object.freeze(chunks) });
  }

  function chunkForHeight(manifest, height) {
    if (!Number.isSafeInteger(height) || height < manifest.first_height || height > manifest.last_height) return null;
    // The first chunk may start partway through a nominal 4,096-block range.
    let low = 0, high = manifest.chunks.length;
    while (low < high) {
      const mid = (low + high) >>> 1;
      if (manifest.chunks[mid].start <= height) low = mid + 1; else high = mid;
    }
    const chunk = manifest.chunks[low - 1];
    return chunk && height < chunk.start + chunk.count ? chunk : null;
  }

  async function decodeChunk(buffer, chunk) {
    if (!(buffer instanceof ArrayBuffer) || buffer.byteLength !== chunk.count * RECORD_BYTES) {
      throw new Error("Epoch reference chunk has an invalid length.");
    }
    const digest = await root.crypto.subtle.digest("SHA-256", buffer);
    const hash = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
    if (hash !== chunk.sha256) throw new Error("Epoch reference chunk does not match its published hash.");
    const view = new DataView(buffer), rows = [];
    for (let offset = 0; offset < chunk.count; offset += 1) {
      const position = offset * RECORD_BYTES, blockTime = view.getUint32(position, true) * 1000;
      const priceTime = view.getUint32(position + 4, true) * 1000, price = view.getFloat64(position + 8, true);
      if (!Number.isFinite(price) || price < 0) throw new Error("Epoch reference chunk contains an invalid price.");
      rows.push(blockTime > 0 && priceTime > 0 && price > 0
        ? Object.freeze({ height: chunk.start + offset, blockTime, priceTime, price }) : null);
    }
    return Object.freeze(rows);
  }

  const sameTip = (a, b) => a?.height === b?.height && a?.blockTime === b?.blockTime;

  function create({ onChange, getPublishedAt } = {}) {
    const doc = root.document;
    let started = false, serial = 0, controller = null, timer = 0, timeoutTimer = 0, pair = null;
    const cache = new Map();
    const visible = () => doc?.visibilityState !== "hidden";
    const notify = () => { if (started) onChange?.(); };
    const spot = root.WSBBitcoinSpotPrice?.create({ onQuote: notify });
    const validRun = (id) => started && visible() && id === serial && !controller?.signal.aborted;

    function current(context) {
      const supplied = context ?? getPublishedAt?.() ?? {};
      const options = typeof supplied === "object" ? supplied : { publishedAt: supplied };
      const publishedAt = utcTime(options.publishedAt);
      if (!pair || !Number.isFinite(publishedAt)
          || (Number.isFinite(options.latestHeight) && pair.tip.height < options.latestHeight)) return null;
      const quote = spot?.newerThan(publishedAt);
      if (!quote || !Number.isFinite(quote.price) || quote.price <= 0
          || !Number.isFinite(quote.at) || quote.at <= publishedAt) return null;
      return Object.freeze({ quote: Object.freeze({ ...quote }), tip: pair.tip, reference: pair.reference,
        live: !!spot.isLive(quote) });
    }

    async function json(url, signal) {
      const response = await root.fetch(url, { cache: "no-store", signal });
      if (!response.ok) throw new Error(`Current epoch data request failed (${response.status}).`);
      return response.json();
    }

    function schedule() {
      root.clearTimeout(timer);
      if (started && visible()) timer = root.setTimeout(() => { timer = 0; void refresh(); }, POLL_MS);
    }

    async function refresh() {
      if (!started || !visible()) return false;
      root.clearTimeout(timer); timer = 0;
      controller?.abort();
      root.clearTimeout(timeoutTimer);
      const request = controller = new AbortController(), id = ++serial;
      const timeout = timeoutTimer = root.setTimeout(() => request.abort(), TIMEOUT_MS);
      try {
        const [tipPayload, manifestPayload] = await Promise.all([
          json(TIP_URL, request.signal), json(MANIFEST_URL, request.signal),
        ]);
        if (!validRun(id)) return false;
        const tip = parseTip(tipPayload), manifest = validateManifest(manifestPayload);
        // A lagging CDN or a shorter replacement chain must not regress the
        // visible comparison. A later complete publication can advance it.
        if (pair && tip.height < pair.tip.height) return false;
        const height = tip.height - EPOCH_BLOCKS, chunk = chunkForHeight(manifest, height);
        if (!chunk) return false;
        const cacheKey = JSON.stringify(chunk);
        let rows = cache.get(cacheKey);
        if (!rows) {
          const response = await root.fetch(REFERENCE_URL + chunk.path + "?sha=" + chunk.sha256,
            { cache: "force-cache", signal: request.signal });
          if (!response.ok) throw new Error(`Epoch reference request failed (${response.status}).`);
          rows = await decodeChunk(await response.arrayBuffer(), chunk);
          if (!validRun(id)) return false;
          cache.set(cacheKey, rows);
        } else {
          cache.delete(cacheKey); cache.set(cacheKey, rows);
        }
        while (cache.size > 3) cache.delete(cache.keys().next().value);
        const reference = rows[height - chunk.start];
        if (!reference) return false;
        const [finalTip, finalManifest] = await Promise.all([
          json(TIP_URL, request.signal), json(MANIFEST_URL, request.signal),
        ]);
        if (!validRun(id) || !sameTip(tip, parseTip(finalTip))
            || JSON.stringify(manifest) !== JSON.stringify(validateManifest(finalManifest))) return false;
        const changed = !sameTip(pair?.tip, tip) || JSON.stringify(pair?.reference) !== JSON.stringify(reference);
        pair = Object.freeze({ tip, reference });
        if (changed) notify();
        return true;
      } catch (_) {
        // Keep the last complete comparison. The daily dashboard never waits
        // for this optional overlay, and the next visible refresh retries it.
        return false;
      } finally {
        root.clearTimeout(timeout);
        if (id === serial) { controller = null; timeoutTimer = 0; schedule(); }
      }
    }

    function onVisibility() {
      if (visible()) { void refresh(); return; }
      ++serial; controller?.abort(); controller = null;
      root.clearTimeout(timeoutTimer); timeoutTimer = 0;
      root.clearTimeout(timer); timer = 0;
    }
    function start() {
      if (started) return;
      started = true;
      doc?.addEventListener("visibilitychange", onVisibility);
      spot?.start();
      void refresh();
    }
    function stop() {
      if (!started) return;
      started = false; ++serial;
      controller?.abort(); controller = null;
      root.clearTimeout(timeoutTimer); timeoutTimer = 0;
      root.clearTimeout(timer); timer = 0;
      doc?.removeEventListener("visibilitychange", onVisibility);
      spot?.stop();
    }
    return { start, stop, refresh, current };
  }

  const api = { create, parseTip, validateManifest, chunkForHeight, decodeChunk, EPOCH_BLOCKS, TIP_URL, MANIFEST_URL };
  root.WSBEOEGrowthLive = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
}(typeof window !== "undefined" ? window : globalThis));
