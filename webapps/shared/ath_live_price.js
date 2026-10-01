/* Apply a fresh BTC/USD quote to the current UTC day without changing published history. */
(function () {
  "use strict";

  const DAY_MS = 86400000;

  function observeHigh(previous, quote) {
    if (!(quote?.price > 0) || !Number.isFinite(Number(quote.at))) return previous;
    const day = new Date(Number(quote.at)).toISOString().slice(0, 10);
    return { day, price: previous?.day === day
      ? Math.max(previous.price, quote.price) : quote.price };
  }

  function withQuote(rows, quote, now = Date.now(), observedHigh = null) {
    if (!Array.isArray(rows) || !rows.length || !(quote?.price > 0)) return rows;
    const quoteAt = Number(quote.at);
    if (!Number.isFinite(quoteAt)) return rows;
    const today = new Date(now).toISOString().slice(0, 10);
    if (new Date(quoteAt).toISOString().slice(0, 10) !== today) return rows;

    const latest = rows[rows.length - 1];
    const latestMs = Date.parse(`${latest.date}T00:00:00Z`);
    const todayMs = Date.parse(`${today}T00:00:00Z`);
    const gapDays = Math.round((todayMs - latestMs) / DAY_MS);
    if (gapDays !== 0 && gapDays !== 1) return rows;

    const previousAth = gapDays === 0 ? rows[rows.length - 2]?.athPrice : latest.athPrice;
    const previousHigh = Number.isFinite(previousAth) ? previousAth : 0;
    const observedPrice = observedHigh?.day === today ? Number(observedHigh.price) : quote.price;
    const high = gapDays === 0 ? Math.max(latest.price, quote.price, observedPrice)
      : Math.max(quote.price, observedPrice);
    const athPrice = Math.max(previousHigh, gapDays === 0 ? latest.athPrice : 0, high);
    const athDate = high >= athPrice ? today : latest.athDate;
    const liveRow = {
      ...(gapDays === 0 ? latest : {}),
      date: today,
      timestamp: new Date(quoteAt).toISOString(),
      height: gapDays === 0 ? latest.height : null,
      price: high,
      snapshotPrice: gapDays === 0 ? latest.snapshotPrice : quote.price,
      spotPrice: quote.price,
      athPrice,
      athDate,
      isAth: high > previousHigh,
      daysSinceAth: Math.round((todayMs - Date.parse(`${athDate}T00:00:00Z`)) / DAY_MS),
    };
    return gapDays === 0 ? [...rows.slice(0, -1), liveRow] : [...rows, liveRow];
  }

  window.WSBAthLivePrice = Object.freeze({ observeHigh, withQuote });
}());
