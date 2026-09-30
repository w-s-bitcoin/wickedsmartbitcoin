/* Browser quotes for DCA Comparison. Published daily rows remain the source of history. */
(function () {
  "use strict";

  const DAY_MS = 86400000;
  const POLL_MS = 60000;
  const QUOTE_LIVE_MS = 60000;
  const SOURCE_STALE_MS = 180000;
  const REQUEST_TIMEOUT_MS = 12000;
  const METALS = { XAU: "XAU", XAG: "XAG" };
  const STOCKS = {
    SPY: "AMEX:SPY",
    QQQ: "NASDAQ:QQQ",
    TLT: "NASDAQ:TLT",
    MSTR: "NASDAQ:MSTR",
  };
  const ALL_ASSETS = ["BTC", ...Object.keys(METALS), ...Object.keys(STOCKS)];

  function utcDay(value) {
    return new Date(value).toISOString().slice(0, 10);
  }

  function lastEquitySessionDay(now) {
    const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", {
      timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", hourCycle: "h23",
    }).formatToParts(new Date(now)).map((part) => [part.type, part.value]));
    let day = `${parts.year}-${parts.month}-${parts.day}`;
    const minutes = Number(parts.hour) * 60 + Number(parts.minute);
    // The public equity feed is 15 minutes delayed. Before its first regular
    // session quote, its close still belongs to the previous trading day.
    if (minutes < 9 * 60 + 45) day = utcDay(Date.parse(`${day}T00:00:00Z`) - DAY_MS);
    while ([0, 6].includes(new Date(`${day}T00:00:00Z`).getUTCDay())) {
      day = utcDay(Date.parse(`${day}T00:00:00Z`) - DAY_MS);
    }
    return day;
  }

  function publishedInstant(value) {
    if (Number.isFinite(value)) return Number(value);
    const raw = String(value || "").trim();
    const normalized = raw.replace(" ", "T").replace(/\.(\d{3})\d+/, ".$1").replace(/ UTC$/, "Z");
    const instant = Date.parse(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(normalized)
      && !/(Z|[+-]\d{2}:?\d{2})$/.test(normalized) ? `${normalized}Z` : normalized);
    return Number.isFinite(instant) ? instant : 0;
  }

  function quoteIsLive(quote, now = Date.now()) {
    return Number.isFinite(quote?.checkedAt)
      && now >= quote.checkedAt && now - quote.checkedAt < QUOTE_LIVE_MS;
  }

  function project(rows, quotes, now = Date.now(), publishedAt = 0) {
    if (!Array.isArray(rows) || !rows.length || !quotes) return { rows, appliedQuotes: {} };
    const today = utcDay(now);
    const latest = rows[rows.length - 1];
    const cutoff = Math.max(publishedInstant(publishedAt), publishedInstant(latest.timestamp));
    const accepted = Object.fromEntries(ALL_ASSETS.flatMap((asset) => {
      const quote = quotes[asset];
      if (!(quote?.price > 0) || !Number.isFinite(quote.checkedAt)
          || quote.checkedAt <= cutoff || quote.checkedAt > now
          || quote.day < latest.date || quote.day > today) return [];
      return [[asset, quote]];
    }));
    const quoteDays = Object.values(accepted).map((quote) => quote.day);
    if (!quoteDays.length) return { rows, appliedQuotes: {} };
    const targetDay = quoteDays.sort().at(-1);
    const gap = Math.round((Date.parse(`${targetDay}T00:00:00Z`)
      - Date.parse(`${latest.date}T00:00:00Z`)) / DAY_MS);
    if (gap !== 0 && gap !== 1) return { rows, appliedQuotes: {} };
    const live = { ...latest, date: targetDay, provisional: gap === 1 };
    for (const [asset, quote] of Object.entries(accepted)) live[asset] = quote.price;
    return {
      rows: gap === 0 ? [...rows.slice(0, -1), live] : [...rows, live],
      appliedQuotes: accepted,
    };
  }

  function withQuotes(rows, quotes, now = Date.now(), publishedAt = 0) {
    return project(rows, quotes, now, publishedAt).rows;
  }

  function create({ assets = ALL_ASSETS, onQuote } = {}) {
    const selected = new Set(assets.filter((asset) => ALL_ASSETS.includes(asset)));
    const quotes = {};
    let started = false;
    let pollTimer = 0;
    let statusTimer = 0;
    let polling = false;
    const requests = new Set();

    function current() {
      const now = Date.now();
      return Object.fromEntries(Object.entries(quotes).map(([asset, quote]) => [asset, {
        ...quote,
        live: quoteIsLive(quote, now),
      }]));
    }

    function scheduleStatus() {
      clearTimeout(statusTimer);
      if (!started || document.visibilityState === "hidden") return;
      const now = Date.now();
      const expiries = Object.values(quotes)
        .map((quote) => quote.checkedAt + QUOTE_LIVE_MS)
        .filter((expiry) => expiry > now);
      if (!expiries.length) return;
      statusTimer = window.setTimeout(() => {
        statusTimer = 0;
        onQuote?.(current());
        scheduleStatus();
      }, Math.max(1, Math.min(...expiries) - now));
    }

    function markUnavailable(asset, notify = true) {
      if (quotes[asset]) quotes[asset].connected = false;
      if (notify) onQuote?.(current());
    }

    function publish(asset, price, { day, checkedAt, source, delayLabel = "Live", notify = true }) {
      if (!selected.has(asset) || !(Number(price) > 0) || !/^\d{4}-\d{2}-\d{2}$/.test(day)
          || !Number.isFinite(checkedAt) || checkedAt < (quotes[asset]?.checkedAt || 0)) return false;
      quotes[asset] = { price: Number(price), day, checkedAt, source, delayLabel, connected: true };
      scheduleStatus();
      if (notify) onQuote?.(current());
      return true;
    }

    const btcFeed = selected.has("BTC") ? window.WSBBitcoinSpotPrice?.create({
      onQuote: (quote) => {
        if (quote) publish("BTC", quote.price, {
          day: utcDay(quote.at), checkedAt: quote.at, source: quote.source,
        });
        else markUnavailable("BTC");
      },
    }) : null;

    async function fetchJson(url, options = {}) {
      const controller = new AbortController();
      requests.add(controller);
      const timeout = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
      try {
        const response = await fetch(url, { ...options, cache: "no-store", signal: controller.signal });
        if (!response.ok) throw new Error(`Quote feed returned ${response.status}`);
        return response.json();
      } finally {
        clearTimeout(timeout);
        requests.delete(controller);
      }
    }

    async function pollMetal(asset) {
      try {
        const data = await fetchJson(`https://api.gold-api.com/price/${METALS[asset]}`);
        const at = Date.parse(data?.updatedAt);
        if (data?.symbol !== asset || data.currency !== "USD" || !(Number(data.price) > 0)
            || !Number.isFinite(at)
            || Math.abs(Date.now() - at) >= SOURCE_STALE_MS) {
          markUnavailable(asset, false);
          return;
        }
        if (!publish(asset, data.price, { day: utcDay(at), checkedAt: at, source: "Gold API", notify: false })) {
          markUnavailable(asset, false);
        }
      } catch (_) {
        markUnavailable(asset, false);
      }
    }

    async function pollStocks() {
      const wanted = Object.entries(STOCKS).filter(([asset]) => selected.has(asset));
      if (!wanted.length) return;
      try {
        // text/plain is a simple CORS request accepted by the public scanner.
        const data = await fetchJson("https://scanner.tradingview.com/america/scan", {
          method: "POST",
          headers: { "Content-Type": "text/plain" },
          body: JSON.stringify({
            symbols: { tickers: wanted.map(([, ticker]) => ticker) },
            columns: ["close", "update_mode"],
          }),
        });
        const receivedAt = Date.now();
        const day = lastEquitySessionDay(receivedAt);
        for (const [asset, ticker] of wanted) {
          const item = data?.data?.find((entry) => entry.s === ticker);
          const delaySeconds = Number(String(item?.d?.[1] || "").match(/delayed_streaming_(\d+)/)?.[1]);
          const delayLabel = delaySeconds > 0 ? `${Math.round(delaySeconds / 60)}m delayed` : "Indicative";
          if (item?.d?.[0] > 0) publish(asset, item.d[0], {
            day, checkedAt: receivedAt, source: "TradingView", delayLabel, notify: false,
          });
          else markUnavailable(asset, false);
        }
      } catch (_) {
        for (const [asset] of wanted) markUnavailable(asset, false);
      }
    }

    function schedulePoll(delay = POLL_MS) {
      clearTimeout(pollTimer);
      if (started && document.visibilityState !== "hidden") {
        pollTimer = window.setTimeout(poll, delay);
      }
    }

    async function poll() {
      if (!started || document.visibilityState === "hidden" || polling) return;
      polling = true;
      try {
        await Promise.allSettled([
          ...Object.keys(METALS).filter((asset) => selected.has(asset)).map(pollMetal),
          pollStocks(),
        ]);
        onQuote?.(current());
      } finally {
        polling = false;
        schedulePoll();
      }
    }

    function start() {
      if (started) return;
      started = true;
      btcFeed?.start();
      scheduleStatus();
      schedulePoll(0);
    }

    function stop() {
      started = false;
      clearTimeout(pollTimer);
      clearTimeout(statusTimer);
      for (const request of requests) request.abort();
      btcFeed?.stop();
      for (const asset of selected) markUnavailable(asset, false);
      onQuote?.(current());
    }

    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "hidden") {
        clearTimeout(pollTimer);
        clearTimeout(statusTimer);
        for (const request of requests) request.abort();
      } else if (started) {
        onQuote?.(current());
        scheduleStatus();
        schedulePoll(0);
      }
    });
    window.addEventListener("pagehide", stop);
    window.addEventListener("pageshow", start);
    return { start, stop, current };
  }

  window.WSBComparisonLivePrice = Object.freeze({ project, withQuotes, create, lastEquitySessionDay, publishedInstant, quoteIsLive });
}());
