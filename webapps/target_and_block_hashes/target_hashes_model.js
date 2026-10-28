(function () {
  "use strict";
  const MARKER = "webapp_data/manifest.json", RECORD_BYTES = 36;
  const cache = new Map();
  let prepared = null;
  const integer = (v) => v.toLocaleString("en-US");
  // Match Python's reference formatting of the source float (not Intl's
  // shortest-decimal rounding, which can differ by a cent at this magnitude).
  const number = (v) => { const [whole, fraction] = v.toFixed(2).split("."); return `${Number(whole).toLocaleString("en-US")}.${fraction}`; };
  function hashrate(value) {
    for (const [unit, divisor] of [["EH/s", 1e18], ["PH/s", 1e15], ["TH/s", 1e12], ["GH/s", 1e9], ["MH/s", 1e6]]) {
      if (value >= divisor || divisor === 1e6) return `${number(value / divisor)} ${unit}`;
    }
  }
  const hex = (bytes) => Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  function logHex(value) { return Math.log2(Number(BigInt("0x" + value))) / 4; }
  function summary(row) {
    return { date: new Date(row.time).toLocaleDateString("en-US", { timeZone: "UTC", year: "numeric", month: "short", day: "numeric" }),
      height: integer(row.height), difficulty: number(row.difficulty), hashrate: hashrate(2 ** 256 / Number(BigInt("0x" + row.target)) / 600),
      lowest: integer(row.lowHeight), epoch: Math.floor(row.height / 2016) + 1 };
  }
  function latestIndexAtDate(rows, iso) {
    if (rows.dateEnds.has(iso)) return rows.dateEnds.get(iso);
    let result = 0;
    for (const [date, index] of rows.dateEnds) if (date <= iso) result = Math.max(result, index);
    return result;
  }
  async function prepareCandidate(fetchFresh) {
    const manifest = await (await fetchFresh(MARKER)).json();
    if (prepared && JSON.stringify(manifest) === prepared.manifestText) return prepared.candidate;
    if (manifest.schema_version !== 1 || manifest.record_bytes !== RECORD_BYTES || !Number.isInteger(manifest.count) || manifest.count < 1 ||
        !/^[a-f0-9]{64}$/.test(manifest.signature) || !Array.isArray(manifest.chunks) || !Array.isArray(manifest.epochs) || !manifest.epochs.length) throw new Error("Invalid block-history manifest.");
    let expected = 0;
    for (const [i, chunk] of manifest.chunks.entries()) {
      if (chunk.start !== expected || chunk.start !== i * 100000 || !Number.isInteger(chunk.count) || chunk.count < 1 || chunk.count > 100000 ||
          (i < manifest.chunks.length - 1 && chunk.count !== 100000) ||
          !/^\d+-[a-f0-9]{20}\.bin$/.test(chunk.path) || !/^[a-f0-9]{64}$/.test(chunk.sha256)) throw new Error("Invalid block chunk bounds.");
      expected += chunk.count;
    }
    if (expected !== manifest.count) throw new Error("Incomplete block history.");
    const epochs = manifest.epochs.map((e, i, all) => {
      if (!Number.isInteger(e.height) || e.height < 0 || e.height >= expected || (i === 0 ? e.height !== 0 : e.height <= all[i - 1].height) ||
          !Number.isFinite(e.difficulty) || e.difficulty < 1 || !/^[a-f0-9]{64}$/.test(e.target) || BigInt("0x" + e.target) <= 0n) throw new Error("Invalid difficulty history.");
      return { ...e, log: logHex(e.target) };
    });
    const chunks = [];
    // Bound concurrency and reuse immutable chunks across publication refreshes.
    for (let i = 0; i < manifest.chunks.length; i += 3) {
      chunks.push(...await Promise.all(manifest.chunks.slice(i, i + 3).map(async (chunk) => {
        if (cache.has(chunk.sha256)) return cache.get(chunk.sha256);
        const bytes = await (await fetchFresh("webapp_data/" + chunk.path)).arrayBuffer();
        const digest = hex(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)));
        if (bytes.byteLength !== chunk.count * RECORD_BYTES || digest !== chunk.sha256) throw new Error("Block history failed integrity validation.");
        return { ...chunk, view: new DataView(bytes), bytes: new Uint8Array(bytes) };
      })));
    }
    const count = manifest.count, logs = new Float64Array(count), lows = new Uint32Array(count), epochAt = new Uint16Array(count), means = new Float64Array(count);
    const dateEnds = new Map(), timestamps = new Uint32Array(count);
    let lowest = Infinity, lowHeight = 0, epoch = 0, sum = 0, lowestBytes = null;
    const records = [0];
    for (const chunk of chunks) {
      for (let j = 0; j < chunk.count; j++) {
        const i = chunk.start + j, offset = j * RECORD_BYTES;
        while (epoch + 1 < epochs.length && epochs[epoch + 1].height <= i) epoch++;
        // The leading 53 significant bits suffice for plotting; full bytes are
        // retained separately for the exact displayed hashes and record minima.
        const hashBytes = chunk.bytes.subarray(offset + 4, offset + RECORD_BYTES);
        let first = 0; while (first < 32 && hashBytes[first] === 0) first++;
        let significant = 0; const end = Math.min(32, first + 7);
        for (let k = first; k < end; k++) significant = significant * 256 + hashBytes[k];
        const log = Math.log2(significant) / 4 + (32 - end) * 2;
        const ts = chunk.view.getUint32(offset, true);
        if (!ts || !Number.isFinite(log) || log > epochs[epoch].log + 1e-10) throw new Error("Invalid block record.");
        logs[i] = log; timestamps[i] = ts; epochAt[i] = epoch;
        let isLower = lowestBytes === null;
        if (lowestBytes && log <= lowest + 1e-12) {
          for (let b = 0; b < 32; b++) if (hashBytes[b] !== lowestBytes[b]) { isLower = hashBytes[b] < lowestBytes[b]; break; }
        }
        if (isLower) { lowest = log; lowHeight = i; lowestBytes = hashBytes; if (i) records.push(i); }
        lows[i] = lowHeight; sum += epochs[epoch].log - lowest; means[i] = sum / (i + 1);
        const iso = new Date(ts * 1000).toISOString().slice(0, 10);
        dateEnds.set(iso, i);
      }
    }
    if (timestamps[count - 1] !== manifest.last_timestamp) throw new Error("Snapshot timestamp does not match its last block.");
    const getHash = (i) => {
      const chunk = chunks[Math.floor(i / 100000)];
      const offset = (i - chunk.start) * RECORD_BYTES;
      return hex(chunk.bytes.subarray(offset + 4, offset + RECORD_BYTES));
    };
    function rowAt(i) {
      if (i < 0) i += count;
      if (i < 0 || i >= count) return undefined;
      const time = timestamps[i] * 1000, stamp = new Date(time).toISOString();
      return { time, iso: stamp.slice(0, 10), timestamp: stamp.slice(0, 19).replace("T", " "),
        hash: getHash(i), ...epochs[epochAt[i]], height: i, lowHeight: lows[i] };
    }
    // Lazy row views keep a million-block history compact. Installed generations
    // are immutable, so an export snapshot can safely retain this same object.
    const data = Object.assign(new Array(count), { logs, lows, epochAt, epochs, means, timestamps, dateEnds, getHash, records,
      at: rowAt, slice: () => rows });
    const rows = new Proxy(data, { get: (obj, key) => typeof key === "string" && /^\d+$/.test(key) ? rowAt(Number(key)) : obj[key] });
    cache.clear(); chunks.forEach((chunk) => cache.set(chunk.sha256, chunk));
    const candidate = { rows, signature: manifest.signature, publishedAt: new Date(timestamps[count - 1] * 1000).toISOString() };
    prepared = { manifestText: JSON.stringify(manifest), candidate };
    return candidate;
  }
  function frameIndices(rows, end, start, settings) {
    const E = window.WSBDashboardExport, step = Math.max(1, 144 * Number(settings.exportSpeed || 1));
    const frames = new Set([start, end]);
    for (let i = start; i < end; i += step) frames.add(Math.floor(i));
    for (let i = 210000; i <= end; i += 210000) if (i >= start) frames.add(i);
    const motion = [...frames].sort((a, b) => a - b);
    return settings.endHold ? [...Array(E.VIDEO_FPS).fill(end), ...motion, ...Array(E.VIDEO_FPS * 3).fill(end)] : motion;
  }
  window.WSBTargetHashesModel = { MARKER, prepareCandidate, latestIndexAtDate, summary, hashrate, frameIndices, withLiveQuote: (rows) => rows };
}());
