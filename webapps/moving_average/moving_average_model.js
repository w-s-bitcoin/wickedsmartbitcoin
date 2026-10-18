(function (root) {
  "use strict";

  const DAY_MS = 86400000;
  const PRICE_HISTORY_START_TIME = Date.UTC(2009, 9, 6);
  const DATA_URL = "../../assets/daily_price.csv";
  const MARKER_URL = "../../assets/daily_price_metadata.json";
  const UNITS = ["day", "week", "month"];

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
    if (new Set(headers).size !== headers.length || !headers.includes("date") || !headers.includes("price")) {
      throw new Error("Price CSV must contain unique date and price columns.");
    }
    return records.map((cells, index) => {
      if (cells.length !== headers.length) throw new Error(`Price CSV row ${index + 2} has missing or extra fields.`);
      const source = Object.fromEntries(headers.map((header, column) => [header, cells[column].trim()]));
      const date = parseDate(source.date), time = isoTime(date);
      const price = source.price === "" ? NaN : Number(source.price);
      if (!Number.isFinite(time) || !Number.isFinite(price) || price < 0) {
        throw new Error(`Price CSV row ${index + 2} has an invalid date or price.`);
      }
      const row = { date, time, price };
      if (headers.includes("timestamp")) {
        row.timestamp = source.timestamp;
        const timestamp = timestampTime(row.timestamp);
        if (!Number.isFinite(timestamp) || Math.floor(timestamp / DAY_MS) * DAY_MS !== time) {
          throw new Error(`Price CSV row ${index + 2} has an invalid UTC timestamp.`);
        }
      }
      if (headers.includes("block_height")) {
        row.height = source.block_height === "" ? NaN : Number(source.block_height);
        if (!Number.isSafeInteger(row.height) || row.height < 0) {
          throw new Error(`Price CSV row ${index + 2} has an invalid block height.`);
        }
      }
      return row;
    });
  }

  // Clamp the day within the target calendar month, preserving UTC midnight.
  // May 31 minus three months is February 28 (29 in leap years).
  function windowStart(time, period, unit) {
    if (!Number.isFinite(time) || !Number.isSafeInteger(period) || period < 0 || !UNITS.includes(unit)) {
      throw new RangeError("A lookback requires a valid UTC date, integer period, and day/week/month unit.");
    }
    if (unit !== "month") return time - period * DAY_MS * (unit === "week" ? 7 : 1);
    const end = new Date(time);
    const target = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth() - period, 1));
    const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
    return Date.UTC(target.getUTCFullYear(), target.getUTCMonth(), Math.min(end.getUTCDate(), lastDay));
  }

  function windowBounds(time, period, unit) {
    const startTime = windowStart(time, period, unit);
    // Anchor early windows at the beginning of price history. Only the plotted
    // data ends at the active date until the complete window has elapsed.
    const firstEnd = unit === "month" ? Date.UTC(2009, 9 + period, 6)
      : PRICE_HISTORY_START_TIME + period * DAY_MS * (unit === "week" ? 7 : 1);
    return time < firstEnd ? { startTime: PRICE_HISTORY_START_TIME, endTime: firstEnd } : { startTime, endTime: time };
  }

  function isSampleDate(time, unit) {
    const date = new Date(time);
    if (unit === "day") return true;
    if (unit === "week") return date.getUTCDay() === 0;
    if (unit === "month") return new Date(time + DAY_MS).getUTCDate() === 1;
    throw new RangeError("Moving average unit must be day, week, or month.");
  }

  function prefixSums(rows) {
    const sums = [0];
    for (const row of rows) sums.push(sums[sums.length - 1] + row.price);
    return sums;
  }

  function buildModel(sourceRows) {
    if (!Array.isArray(sourceRows) || !sourceRows.length) throw new Error("No price history is available.");
    let firstPositive = -1;
    sourceRows.forEach((row, index) => {
      if (!Number.isFinite(row.time) || isoTime(row.date) !== row.time || !Number.isFinite(row.price) || row.price < 0) {
        throw new Error(`Price history contains an invalid row at ${index + 1}.`);
      }
      if (index && row.time - sourceRows[index - 1].time !== DAY_MS) {
        throw new Error("Price history has a missing, duplicated, or out-of-order UTC date.");
      }
      if (index && row.height !== undefined && sourceRows[index - 1].height > row.height) {
        throw new Error("Price history block heights moved backward.");
      }
      if (firstPositive < 0 && row.price > 0) firstPositive = index;
      if (firstPositive >= 0 && row.price === 0) {
        throw new Error("Price history contains a missing price after its first nonzero price.");
      }
    });
    if (firstPositive < 0) throw new Error("Price history has no nonzero prices.");
    const rows = sourceRows.slice(firstPositive).map((row) => ({ ...row }));
    const firstTime = rows[0].time, latestTime = rows[rows.length - 1].time;
    const samples = {
      day: rows,
      week: rows.filter((row) => isSampleDate(row.time, "week")),
      month: rows.filter((row) => isSampleDate(row.time, "month")),
    };
    const first = new Date(firstTime), latest = new Date(latestTime);
    let months = (latest.getUTCFullYear() - first.getUTCFullYear()) * 12 + latest.getUTCMonth() - first.getUTCMonth();
    while (months > 0 && windowStart(latestTime, months, "month") < firstTime) months -= 1;
    const priorCount = (unit) => samples[unit].filter((row) => row.time < latestTime).length;
    const limits = {
      day: rows.length - 1,
      week: Math.min(Math.floor((latestTime - firstTime) / DAY_MS / 7), priorCount("week")),
      month: Math.min(months, priorCount("month")),
    };
    return {
      rows, firstTime, latestTime, limits, samples,
      sums: Object.fromEntries(UNITS.map((unit) => [unit, prefixSums(samples[unit])])),
      cache: new Map(),
    };
  }

  function averageType(selection) {
    const type = selection?.type === undefined ? "sma" : selection.type;
    if (!["sma", "ema", "none"].includes(type)) throw new RangeError("Moving average type must be sma, ema, or none.");
    return type;
  }

  function cacheValues(model, key, values) {
    // Bound combined historical/current cache memory as users explore settings.
    if (model.cache.size >= 16) model.cache.delete(model.cache.keys().next().value);
    model.cache.set(key, values);
    return values;
  }

  function calculate(model, selection) {
    const type = averageType(selection);
    const period = Number(selection?.period), unit = selection?.unit;
    const key = `${type}:${period}:${unit}`;
    if (model.cache.has(key)) return model.cache.get(key);
    if (type === "none") return cacheValues(model, key, model.rows.map(() => null));
    if (!UNITS.includes(unit) || !Number.isSafeInteger(period) || period < 3 || period > model.limits[unit]) {
      throw new RangeError(`Choose an integer from 3 to ${model.limits[unit] ?? 0} for ${unit || "the selected unit"}.`);
    }
    const samples = model.samples[unit], sums = model.sums[unit];
    const alpha = 2 / (period + 1);
    let count = 0, ema = null;
    const values = model.rows.map((row) => {
      // Strictly earlier observations match the notebook's [i:i+N] means,
      // whose result is assigned to the following day/Sunday/month-end.
      while (count < samples.length && samples[count].time < row.time) {
        count += 1;
        if (type === "ema") {
          if (count === period) ema = sums[count] / period;
          else if (count > period) ema = alpha * samples[count - 1].price + (1 - alpha) * ema;
        }
      }
      if (count < period || windowStart(row.time, period, unit) < model.firstTime) return null;
      return type === "ema" ? ema : (sums[count] - sums[count - period]) / period;
    });
    return cacheValues(model, key, values);
  }

  // Current-data presentation includes the current price as the newest sample.
  // Earlier points retain the notebook's prior-close convention for playback.
  function calculateCurrent(model, selection) {
    const historical = calculate(model, selection);
    const type = averageType(selection), period = Number(selection?.period), unit = selection?.unit;
    const key = `current:${type}:${period}:${unit}`;
    if (model.cache.has(key)) return model.cache.get(key);
    const values = historical.slice(), latest = model.rows.at(-1);
    if (Number.isFinite(values.at(-1))) {
      if (type === "ema") {
        const alpha = 2 / (period + 1);
        values[values.length - 1] = alpha * latest.price + (1 - alpha) * historical.at(-1);
      } else {
        const samples = model.samples[unit], sums = model.sums[unit];
        let count = samples.length;
        while (count && samples[count - 1].time >= latest.time) count -= 1;
        values[values.length - 1] = (latest.price + sums[count] - sums[count - period + 1]) / period;
      }
    }
    return cacheValues(model, key, values);
  }

  // A live quote is a presentation overlay, never a replacement for published
  // history. At UTC rollover the published final close remains the prior day.
  function withLiveQuote(model, quote, { publishedAt, now = Date.now() } = {}) {
    const latest = model?.rows?.at(-1);
    if (!latest || !Number.isFinite(quote?.price) || quote.price <= 0
        || !Number.isFinite(quote.at) || !Number.isFinite(now) || quote.at > now) return model;
    const publicationTime = Number.isFinite(publishedAt) ? publishedAt : timestampTime(publishedAt);
    const latestTimestamp = latest.timestamp === undefined ? latest.time : timestampTime(latest.timestamp);
    if (!Number.isFinite(publicationTime) || !Number.isFinite(latestTimestamp)
        || quote.at <= publicationTime || quote.at <= latestTimestamp) return model;
    const timestamp = new Date(quote.at);
    if (!Number.isFinite(timestamp.getTime())) return model;
    const date = timestamp.toISOString().slice(0, 10), time = isoTime(date), gap = time - latest.time;
    if (gap !== 0 && gap !== DAY_MS) return model;
    const liveRow = { ...(gap === 0 ? latest : {}), date, time, price: quote.price, timestamp: timestamp.toISOString() };
    const rows = gap === 0 ? [...model.rows.slice(0, -1), liveRow] : [...model.rows, liveRow];
    const projected = buildModel(rows);
    // Selectable periods belong to the published generation, even when a live
    // quote adds a provisional day with another complete lookback window.
    projected.limits = { ...model.limits };
    projected.liveQuote = { ...quote };
    return projected;
  }

  function label(selection, short = false) {
    const type = averageType(selection);
    if (type === "none") return "None";
    const unit = selection?.unit;
    if (!UNITS.includes(unit)) throw new RangeError("Moving average unit must be day, week, or month.");
    return short ? `${selection.period}${{ day: "D", week: "W", month: "M" }[unit]} ${type.toUpperCase()}`
      : `${selection.period}-${unit} ${type === "ema" ? "exponential" : "simple"} moving average`;
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
    const marker = parseMarker(signature);
    const csv = await readText(DATA_URL);
    if (!root.crypto?.subtle) throw new Error("Price validation requires a secure browser context or localhost.");
    const digest = await root.crypto.subtle.digest("SHA-256", new TextEncoder().encode(csv));
    const dataHash = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
    const sourceRows = parseCSV(csv), model = buildModel(sourceRows);
    const candidate = {
      sourceRows, model, rows: model.rows, marker, signature, dataHash,
      publishedAt: new Date(timestampTime(marker.latest_timestamp)).toISOString(),
      latestHeight: marker.latest_block_height,
    };
    validateCandidate(candidate, context.installed);
    // Shared dashboard/preview refresh controllers recheck expected signatures
    // immediately before commit. Initial loads need the same gate here.
    if (!expectedSignature && (await readText(MARKER_URL)).trim() !== signature) {
      throw new Error("Price publication changed during loading; retrying is safe.");
    }
    return candidate;
  }

  root.WSBMovingAverageModel = Object.freeze({
    DAY_MS, PRICE_HISTORY_START_TIME, DATA_URL, MARKER_URL, parseCSV, buildModel, calculate, calculateCurrent, withLiveQuote,
    windowStart, windowBounds, isSampleDate, label, prepareCandidate, validateCandidate,
  });
}(typeof window === "undefined" ? globalThis : window));
