(function () {
  "use strict";
  const MAX_SUPPLY = 20999999.9769;
  function parse(text) {
    const lines = text.trim().split(/\r?\n/);
    const headers = lines.shift().split(",");
    const required = ["date", "timestamp", "price", "block_height", "supply"];
    if (required.some((key) => !headers.includes(key))) throw new Error("Daily price history has missing columns.");
    const positions = required.map((key) => headers.indexOf(key));
    const rows = [];
    for (const line of lines) {
      if (!line) continue;
      const fields = line.split(",");
      const [date, timestamp, priceText, heightText, supplyText] = positions.map((index) => fields[index]);
      const dateParts = /^(\d{1,2})\/(\d{1,2})\/(\d{2})$/.exec(date);
      if (!dateParts) throw new Error("Daily price history has an invalid date.");
      const time = Date.UTC(2000 + Number(dateParts[3]), Number(dateParts[1]) - 1, Number(dateParts[2]));
      const iso = new Date(time).toISOString().slice(0, 10);
      if (!Number.isFinite(time) || Number(iso.slice(5, 7)) !== Number(dateParts[1]) || Number(iso.slice(8, 10)) !== Number(dateParts[2])) throw new Error("Daily price history has an invalid date.");
      const price = Number(priceText), height = Number(heightText), supply = Number(supplyText);
      if (!Number.isFinite(price) || price < 0 || !Number.isInteger(height) || height < 0 || !Number.isFinite(supply) || supply < 0 || supply > MAX_SUPPLY + 1) throw new Error("Daily price history has an invalid value.");
      if (rows.length && (time < rows.at(-1).time || height < rows.at(-1).height || supply + 0.000001 < rows.at(-1).supply)) throw new Error("Daily price history is out of order.");
      rows.push({ iso, time, timestamp, price, height, supply });
    }
    if (rows.length < 100 || !rows.some((row) => row.price > 0)) throw new Error("Daily price history is incomplete.");
    return rows;
  }
  async function prepareCandidate(fetchFresh) {
    const marker = await (await fetchFresh("../../assets/daily_price_metadata.json")).json();
    if (marker?.schema_version !== 1 || marker.artifact?.path !== "assets/daily_price.csv" ||
        !/^[0-9a-f]{64}$/.test(String(marker.artifact.sha256)) || !Number.isInteger(marker.artifact.rows)) {
      throw new Error("Daily price publication marker is invalid.");
    }
    const text = await (await fetchFresh("../../assets/daily_price.csv")).text();
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
    const hash = [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
    if (hash !== marker.artifact.sha256) throw new Error("Daily price history does not match its publication marker.");
    const rows = parse(text);
    if (rows.length !== marker.artifact.rows || rows.at(-1).iso !== marker.latest_date || rows.at(-1).height !== marker.latest_block_height) {
      throw new Error("Daily price history has incomplete publication metadata.");
    }
    return { rows, signature: marker.artifact.sha256, publishedAt: marker.latest_timestamp.replace(" ", "T") + "Z" };
  }
  function latestIndexAtDate(rows, iso) {
    let low = 0, high = rows.length;
    while (low < high) { const mid = (low + high) >> 1; if (rows[mid].iso <= iso) low = mid + 1; else high = mid; }
    return Math.max(0, Math.min(rows.length - 1, low - 1));
  }
  function withLiveQuote(rows, quote) {
    if (!rows.length || !quote || !Number.isFinite(quote.price) || quote.price <= 0) return rows;
    const copy = rows.slice();
    copy[copy.length - 1] = { ...copy.at(-1), price: quote.price, quoteAt: quote.at };
    return copy;
  }
  function openingPriceMilestones(rows) {
    if (!rows.length || rows[0].price > 0) return [];
    const firstPriced = rows.findIndex((row) => row.price > 0);
    return firstPriced < 0 ? [rows.length - 1] : [firstPriced - 1, firstPriced];
  }
  window.WSBDailyPriceHistory = { parse, prepareCandidate, latestIndexAtDate, withLiveQuote, openingPriceMilestones };
}());
