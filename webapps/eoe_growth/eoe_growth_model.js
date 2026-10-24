(function (root) {
  "use strict";

  const DAY_MS = 86400000, EPOCH_BLOCKS = 210000;
  const DATA_URL = "../../assets/daily_price.csv";
  const MARKER_URL = "../../assets/daily_price_metadata.json";

  function isoTime(value) {
    const text = String(value || "").trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return NaN;
    const time = Date.parse(`${text}T00:00:00Z`);
    return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === text ? time : NaN;
  }

  function parseDate(value) {
    const text = String(value || "").trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
    const parts = /^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/.exec(text);
    if (!parts) return "";
    let year = Number(parts[3]);
    if (parts[3].length === 2) year += year <= 68 ? 2000 : 1900;
    return `${year}-${parts[1].padStart(2, "0")}-${parts[2].padStart(2, "0")}`;
  }

  function timestampTime(value) {
    let text = String(value || "").trim();
    if (!/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?$/.test(text)) return NaN;
    text = text.replace(" ", "T");
    if (!/(?:Z|[+-]\d{2}:?\d{2})$/.test(text)) text += "Z";
    return Date.parse(text);
  }

  function csvRecords(text) {
    const records = [];
    let record = [], value = "", quoted = false;
    const source = String(text).replace(/^\uFEFF/, "");
    for (let i = 0; i < source.length; i += 1) {
      const char = source[i];
      if (char === '"') {
        if (quoted && source[i + 1] === '"') { value += '"'; i += 1; }
        else quoted = !quoted;
      } else if (char === "," && !quoted) {
        record.push(value); value = "";
      } else if ((char === "\n" || char === "\r") && !quoted) {
        if (char === "\r" && source[i + 1] === "\n") i += 1;
        record.push(value);
        if (record.some((cell) => cell.trim())) records.push(record);
        record = []; value = "";
      } else value += char;
    }
    if (quoted) throw new Error("Price CSV contains an unterminated quoted field.");
    record.push(value);
    if (record.some((cell) => cell.trim())) records.push(record);
    return records;
  }

  function parseCSV(text) {
    const records = csvRecords(text);
    if (records.length < 2) throw new Error("Price CSV is empty.");
    const headers = records.shift().map((header) => header.trim());
    if (new Set(headers).size !== headers.length
        || !["date", "timestamp", "price", "block_height"].every((key) => headers.includes(key))) {
      throw new Error("Price CSV requires unique date, timestamp, price, and block_height columns.");
    }
    return records.map((cells, index) => {
      if (cells.length !== headers.length) throw new Error(`Price CSV row ${index + 2} has missing or extra fields.`);
      const source = Object.fromEntries(headers.map((header, column) => [header, cells[column].trim()]));
      const date = parseDate(source.date), time = isoTime(date), timestamp = source.timestamp;
      const price = source.price === "" ? NaN : Number(source.price);
      const height = source.block_height === "" ? NaN : Number(source.block_height);
      if (!Number.isFinite(time) || !Number.isFinite(price) || price < 0) {
        throw new Error(`Price CSV row ${index + 2} has an invalid date or price.`);
      }
      const timestampMs = timestampTime(timestamp);
      if (!Number.isFinite(timestampMs) || Math.floor(timestampMs / DAY_MS) * DAY_MS !== time) {
        throw new Error(`Price CSV row ${index + 2} has an invalid UTC timestamp.`);
      }
      if (!Number.isSafeInteger(height) || height < 0) {
        throw new Error(`Price CSV row ${index + 2} has an invalid block height.`);
      }
      return { date, time, timestamp, price, height };
    });
  }

  function lowerBound(rows, value, field) {
    let low = 0, high = rows.length;
    while (low < high) {
      const mid = (low + high) >>> 1;
      if (rows[mid][field] < value) low = mid + 1;
      else high = mid;
    }
    return low;
  }

  // Published heights may repeat on days with no new blocks. Select the first
  // observation in an exact or equidistant match, like the notebook's argmin.
  function nearestRow(rows, epochBlockCount) {
    if (!rows?.length || !Number.isFinite(epochBlockCount)) return null;
    const right = lowerBound(rows, epochBlockCount, "epochBlockCount");
    if (right === 0) return rows[0];
    const left = rows[right - 1];
    if (right < rows.length && rows[right].epochBlockCount - epochBlockCount < epochBlockCount - left.epochBlockCount) {
      return rows[right];
    }
    return rows[lowerBound(rows, left.epochBlockCount, "epochBlockCount")];
  }

  function buildModel(sourceRows) {
    if (!Array.isArray(sourceRows) || !sourceRows.length) throw new Error("No price history is available.");
    let firstPositive = -1;
    const rows = sourceRows.map((source, index) => {
      if (!Number.isFinite(source.time) || isoTime(source.date) !== source.time
          || !Number.isFinite(source.price) || source.price < 0
          || !Number.isSafeInteger(source.height) || source.height < 0) {
        throw new Error(`Price history contains an invalid row at ${index + 1}.`);
      }
      if (index && source.time - sourceRows[index - 1].time !== DAY_MS) {
        throw new Error("Price history has a missing, duplicated, or out-of-order UTC date.");
      }
      if (index && source.height < sourceRows[index - 1].height) {
        throw new Error("Price history block heights moved backward.");
      }
      if (firstPositive < 0 && source.price > 0) firstPositive = index;
      if (firstPositive >= 0 && source.price === 0) {
        throw new Error("Price history contains a missing price after its first nonzero price.");
      }
      const epoch = Math.floor(source.height / EPOCH_BLOCKS) + 1;
      // The genesis block is the first block. Counts run 1…210000 in every
      // epoch, including the last pre-halving and first post-halving block.
      const epochBlockCount = source.height % EPOCH_BLOCKS + 1;
      return { ...source, index, epoch, epochBlockCount, count: epochBlockCount,
        previousIndex: null, previousPrice: null, growth: null };
    });
    const epochs = [], byEpoch = new Map();
    for (const row of rows) {
      if (!byEpoch.has(row.epoch)) {
        const group = { epoch: row.epoch, rows: [] };
        byEpoch.set(row.epoch, group); epochs.push(group);
      }
      byEpoch.get(row.epoch).rows.push(row);
    }
    for (const row of rows) {
      const previous = nearestRow(byEpoch.get(row.epoch - 1)?.rows, row.epochBlockCount);
      if (!previous) continue;
      row.previousIndex = previous.index;
      row.previousPrice = previous.price;
      // Unvalued history stays zero in the model. It is never replaced with a
      // fictitious denominator or interpreted as a measured -100% change.
      if (row.price > 0 && previous.price > 0) row.growth = (row.price - previous.price) / previous.price * 100;
    }
    return { rows, epochs, firstTime: rows[0].time, latestTime: rows.at(-1).time,
      firstPositiveIndex: firstPositive, firstGrowthIndex: rows.findIndex((row) => Number.isFinite(row.growth)) };
  }

  function indexAtTime(model, time) {
    const value = typeof time === "string" ? isoTime(time) : Number(time);
    if (!Number.isFinite(value)) throw new RangeError("Select a valid UTC date.");
    const index = lowerBound(model.rows, value, "time");
    return Math.max(0, Math.min(model.rows.length - 1,
      index < model.rows.length && model.rows[index].time === value ? index : index - 1));
  }

  function frame(model, indexOrTime = model.rows.length - 1) {
    const requested = typeof indexOrTime === "string" || Math.abs(indexOrTime) >= DAY_MS
      ? indexAtTime(model, indexOrTime) : Number(indexOrTime);
    if (!Number.isSafeInteger(requested)) throw new RangeError("Select a valid playback frame.");
    const index = Math.max(0, Math.min(model.rows.length - 1, requested)), row = model.rows[index];
    const epochs = [];
    for (const group of model.epochs) {
      if (group.rows[0].index > index) break;
      const end = lowerBound(group.rows, index + 1, "index"), rows = group.rows.slice(0, end);
      epochs.push({ epoch: group.epoch, rows, marker: nearestRow(rows, row.epochBlockCount) });
    }
    return { ...row, row, index, epochs };
  }

  // Project a complete current quote/block/reference tuple onto fresh display
  // arrays. Historical playback and exports continue to use the published model.
  function liveFrame(model, current) {
    if (!Array.isArray(model?.rows) || !model.rows.length || !Array.isArray(model.epochs)) return null;
    const latest = model.rows.at(-1), { quote, tip, reference } = current || {};
    const validTime = (value) => Number.isFinite(value) && value > 0 && Number.isFinite(new Date(value).getTime());
    const publishedTime = timestampTime(latest.timestamp);
    if (!quote || !tip || !reference || !Number.isFinite(quote.price) || quote.price <= 0
        || !Number.isFinite(reference.price) || reference.price <= 0
        || !Number.isSafeInteger(tip.height) || tip.height < EPOCH_BLOCKS
        || (tip.height < latest.height && !(tip.reorg === true && latest.height <= tip.reorgFrom))
        || !Number.isSafeInteger(reference.height) || reference.height !== tip.height - EPOCH_BLOCKS
        || !validTime(quote.at) || !validTime(tip.blockTime) || !validTime(reference.blockTime) || !validTime(reference.priceTime)
        || quote.at <= (Number.isFinite(publishedTime) ? publishedTime : latest.time)) return null;

    const snapshot = { quote: { ...quote }, tip: { ...tip }, reference: { ...reference }, live: current.live === true,
      ...(typeof current.chainLive === "boolean" ? { chainLive: current.chainLive } : {}) };
    const index = model.rows.length - 1, epoch = Math.floor(tip.height / EPOCH_BLOCKS) + 1;
    const epochBlockCount = tip.height % EPOCH_BLOCKS + 1;
    // A replacement chain may be shorter than the last daily publication.
    // Omit orphaned future heights only from this projection; history is intact.
    const epochs = model.epochs.map((group) => ({ epoch: group.epoch,
      rows: group.rows.filter((row) => row.height <= tip.height) })).filter((group) => group.rows.length);
    const byEpoch = new Map(epochs.map((group) => [group.epoch, group]));
    const makePoint = (height, price, at, pointIndex, previous) => {
      const time = Math.floor(at / DAY_MS) * DAY_MS;
      return { date: new Date(time).toISOString().slice(0, 10), time, timestamp: new Date(at).toISOString(),
        height, price, index: pointIndex, epoch: Math.floor(height / EPOCH_BLOCKS) + 1,
        epochBlockCount, count: epochBlockCount, previousIndex: previous?.index ?? null,
        previousPrice: previous?.price ?? null,
        growth: previous?.price > 0 ? (price - previous.price) / previous.price * 100 : null };
    };
    const older = nearestRow(byEpoch.get(epoch - 2)?.rows, epochBlockCount);
    const referenceRow = { ...makePoint(reference.height, reference.price, reference.priceTime,
      indexAtTime(model, Math.floor(reference.priceTime / DAY_MS) * DAY_MS), older),
      source: "block-reference", liveSource: "reference", blockTime: reference.blockTime, priceTime: reference.priceTime };
    const row = { ...makePoint(tip.height, quote.price, quote.at, index, referenceRow),
      source: snapshot.live ? "live" : "retained", liveSource: "current", quoteAt: quote.at, blockTime: tip.blockTime,
      referenceHeight: reference.height, referenceBlockTime: reference.blockTime, referencePriceTime: reference.priceTime };
    function upsert(point) {
      let group = byEpoch.get(point.epoch);
      if (!group) {
        group = { epoch: point.epoch, rows: [] }; byEpoch.set(point.epoch, group); epochs.push(group);
      }
      // Repeated published heights must not leave a competing old marker at
      // the exact offset. All other published observations stay untouched.
      group.rows = group.rows.filter((existing) => existing.height !== point.height);
      group.rows.splice(lowerBound(group.rows, point.height, "height"), 0, point);
    }
    // Replace today's unfinished daily endpoint only within its own epoch.
    // At a halving the prior epoch's final endpoint remains part of its curve.
    if (latest.epoch === epoch && latest.date === row.date) {
      const group = byEpoch.get(epoch);
      if (group) group.rows = group.rows.filter((existing) => existing !== latest);
    }
    upsert(referenceRow); upsert(row);
    epochs.sort((a, b) => a.epoch - b.epoch);
    for (const group of epochs) group.marker = nearestRow(group.rows, epochBlockCount);
    return { ...row, row, index, epochs, live: snapshot.live, referenceRow, current: snapshot };
  }

  // These source indices are rendered at a fixed 30 output frames per second.
  // The optional fast intro changes only sampling before the first measured
  // EOE growth, not later gaps or zero/negative growth, nor the selected bounds.
  function exportFrames(model, options = {}) {
    if (!Array.isArray(model?.rows) || !model.rows.length) throw new RangeError("No export frames are available.");
    const { startIndex = 0, endIndex = model.rows.length - 1, speed = 1,
      fastIntro = true, endFrameHold = true } = options;
    if (!Number.isSafeInteger(startIndex) || !Number.isSafeInteger(endIndex)
        || startIndex < 0 || endIndex >= model.rows.length || startIndex > endIndex) {
      throw new RangeError("Select a valid export frame range.");
    }
    if (![0.5, 1, 2, 4].includes(speed)) throw new RangeError("Select a valid export speed.");
    const firstGrowthIndex = model.rows.findIndex((row) => Number.isFinite(row.growth));
    const boundary = firstGrowthIndex < 0 ? endIndex + 1 : firstGrowthIndex;
    const split = fastIntro && startIndex < boundary ? Math.min(boundary, endIndex + 1) : startIndex;
    const frames = [];
    const sample = (first, last, stride) => {
      for (let position = 0; Math.floor(position * stride) <= last - first; position += 1) {
        frames.push(first + Math.floor(position * stride));
      }
    };
    sample(startIndex, split - 1, speed * 4);
    // Restart the selected speed at the first measured frame so a skipped
    // intro stride can never conceal the first available comparison.
    sample(split, endIndex, speed);
    if (frames.at(-1) !== endIndex) frames.push(endIndex);
    return endFrameHold ? [...Array(30).fill(endIndex), ...frames, ...Array(90).fill(endIndex)] : frames;
  }

  function parseMarker(signature) {
    let marker;
    try { marker = JSON.parse(signature); }
    catch (_) { throw new Error("The price publication marker is invalid JSON."); }
    if (marker?.schema_version !== 1 || marker?.artifact?.path !== "assets/daily_price.csv"
        || !/^[a-f0-9]{64}$/.test(marker.artifact.sha256 || "")
        || !Number.isSafeInteger(marker.artifact.rows) || marker.artifact.rows < 1
        || !Number.isFinite(isoTime(marker.first_date)) || !Number.isFinite(isoTime(marker.latest_date))
        || marker.first_date > marker.latest_date || !Number.isFinite(timestampTime(marker.latest_timestamp))
        || Math.floor(timestampTime(marker.latest_timestamp) / DAY_MS) * DAY_MS !== isoTime(marker.latest_date)
        || !Number.isSafeInteger(marker.latest_block_height) || marker.latest_block_height < 0) {
      throw new Error("The price publication marker is incomplete or invalid.");
    }
    return marker;
  }

  function validateCandidate(candidate, installed) {
    const marker = candidate.marker, rows = candidate.sourceRows;
    const latest = rows[rows.length - 1];
    if (candidate.dataHash !== marker.artifact.sha256 || rows.length !== marker.artifact.rows
        || rows[0].date !== marker.first_date || latest.date !== marker.latest_date
        || latest.timestamp !== marker.latest_timestamp || latest.height !== marker.latest_block_height) {
      throw new Error("Price data does not match its publication marker; keeping the previous complete generation.");
    }
    if (installed?.marker && (marker.first_date !== installed.marker.first_date
        || marker.latest_date < installed.marker.latest_date
        || timestampTime(marker.latest_timestamp) < timestampTime(installed.marker.latest_timestamp)
        || marker.latest_block_height < installed.marker.latest_block_height)) {
      throw new Error("The price publication moved backward; keeping the previous complete generation.");
    }
    return true;
  }

  async function prepareCandidate(context = {}) {
    const fetchResource = context.fetchFresh || ((url) => root.fetch(url, { cache: "no-store", signal: context.signal }));
    const readText = async (url) => {
      const response = await fetchResource(url);
      if (!response.ok) throw new Error(`Unable to load ${url} (${response.status}).`);
      return response.text();
    };
    const expectedSignature = String(context.signatureParts?.[0] || context.signature || "").trim();
    const signature = expectedSignature || (await readText(MARKER_URL)).trim();
    const marker = parseMarker(signature), csv = await readText(DATA_URL);
    if (!root.crypto?.subtle) throw new Error("Price validation requires a secure browser context or localhost.");
    const digest = await root.crypto.subtle.digest("SHA-256", new TextEncoder().encode(csv));
    const dataHash = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
    const sourceRows = parseCSV(csv), model = buildModel(sourceRows);
    const candidate = { sourceRows, model, rows: model.rows, marker, signature, dataHash,
      publishedAt: new Date(timestampTime(marker.latest_timestamp)).toISOString(), latestHeight: marker.latest_block_height };
    validateCandidate(candidate, context.installed);
    // Refresh controllers recheck expected signatures immediately before commit.
    // The first load performs that same gate here before returning any data.
    if (!expectedSignature && (await readText(MARKER_URL)).trim() !== signature) {
      throw new Error("Price publication changed during loading; retrying is safe.");
    }
    return candidate;
  }

  root.WSBEOEGrowthModel = Object.freeze({ DAY_MS, EPOCH_BLOCKS, DATA_URL, MARKER_URL,
    parseCSV, buildModel, nearestRow, indexAtTime, frame, liveFrame, exportFrames, prepareCandidate, validateCandidate });
}(typeof window === "undefined" ? globalThis : window));
