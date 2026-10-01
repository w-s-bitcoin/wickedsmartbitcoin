/* Selected USD legs for the Unit of Account dashboard. Published rows stay immutable. */
(function () {
  "use strict";

  const POLL_MS = 60000;
  const FRESH_MS = 60000;
  const TIMEOUT_MS = 12000;
  const METALS = new Set(["XAU", "XAG", "XPT", "XPD"]);
  const dayOf = (instant) => new Date(instant).toISOString().slice(0, 10);

  function publishedInstant(value) {
    const text = String(value || "").trim().replace(" UTC", "Z").replace(" ", "T");
    const parsed = Date.parse(text);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  function project(rows, selected, quotes, snapshotUsd, publishedAt, now = Date.now()) {
    if (!Array.isArray(rows) || !rows.length) return { rows, used: {}, provisional: false };
    const latest = rows[rows.length - 1];
    const latestDay = dayOf(latest.date);
    const today = dayOf(now);
    if (latestDay > today) return { rows, used: {}, provisional: false };
    const cutoff = Math.max(publishedInstant(publishedAt), Number(latest.date));
    const used = {};
    const values = {};
    for (const code of new Set(selected)) {
      const snapshot = code === "USD" ? 1 : Number(snapshotUsd?.[code]);
      const quote = quotes?.[code];
      const accepted = quote && Number(quote.usd) > 0 && Number.isFinite(quote.at)
        && quote.at > cutoff && quote.at <= now && dayOf(quote.at) >= latestDay;
      const usd = accepted ? Number(quote.usd) : snapshot;
      if (Number.isFinite(usd) && usd > 0) values[code] = usd;
      if (accepted) used[code] = quote;
    }
    if (!Object.keys(used).length || selected.some((code) => !(values[code] > 0))) {
      return { rows, used: {}, provisional: false };
    }
    const targetDay = Object.values(used).map((quote) => dayOf(quote.at)).sort().at(-1);
    const provisional = targetDay > latestDay;
    const projected = {
      ...latest,
      date: provisional ? new Date(`${targetDay}T00:00:00Z`) : latest.date,
      price: values.BTC || latest.price,
      liveUsdValues: values,
      provisional,
    };
    return {
      rows: provisional ? [...rows, projected] : [...rows.slice(0, -1), projected],
      used,
      provisional,
    };
  }

  function create({ onQuote } = {}) {
    const quotes = {};
    let selected = [];
    let started = false;
    let polling = false;
    let pollVersion = 0;
    let timer = 0;
    let statusTimer = 0;
    const controllers = new Set();
    const btc = window.WSBBitcoinSpotPrice?.create({ onQuote: (quote) => {
      if (quote && selected.includes("BTC")) {
        publish("BTC", quote.price, quote.at, quote.source, "Live");
      } else onQuote?.(current());
    } });

    function current() {
      const now = Date.now();
      return Object.fromEntries(Object.entries(quotes).map(([code, quote]) => [code, {
        ...quote, live: now - quote.at < FRESH_MS,
      }]));
    }

    function scheduleStatus() {
      clearTimeout(statusTimer);
      if (!started || document.visibilityState === "hidden") return;
      const now = Date.now();
      const expiries = selected.map((code) => quotes[code])
        .filter((quote) => quote?.at + FRESH_MS > now)
        .map((quote) => quote.at + FRESH_MS);
      if (!expiries.length) return;
      statusTimer = setTimeout(() => {
        statusTimer = 0;
        onQuote?.(current());
        scheduleStatus();
      }, Math.max(1, Math.min(...expiries) - now));
    }

    function publish(code, usd, at, source, delay) {
      if (!selected.includes(code) || !(Number(usd) > 0) || !Number.isFinite(at)
          || at < (quotes[code]?.at || 0)) return;
      quotes[code] = { usd: Number(usd), at, source, delay, connected: true };
      scheduleStatus();
      onQuote?.(current());
    }

    async function fetchJson(url, options = {}) {
      const controller = new AbortController();
      controllers.add(controller);
      const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
      try {
        const response = await fetch(url, { ...options, cache: "no-store", signal: controller.signal });
        if (!response.ok) throw new Error(`Quote feed returned ${response.status}`);
        return response.json();
      } finally {
        clearTimeout(timeout);
        controllers.delete(controller);
      }
    }

    async function pollMetal(code) {
      try {
        const data = await fetchJson(`https://api.gold-api.com/price/${code}`);
        const at = Date.parse(data?.updatedAt);
        if (data?.symbol !== code || data.currency !== "USD"
            || !Number.isFinite(at) || Math.abs(Date.now() - at) > 180000) throw new Error("Stale metal quote");
        publish(code, data.price, at, "Gold API", "Live");
      } catch (_) {
        if (quotes[code]) quotes[code].connected = false;
      }
    }

    async function pollFiat(codes) {
      if (!codes.length) return;
      const tickers = codes.flatMap((code) => [`FX_IDC:${code}USD`, `FX_IDC:USD${code}`]);
      try {
        const data = await fetchJson("https://scanner.tradingview.com/forex/scan", {
          method: "POST",
          headers: { "Content-Type": "text/plain" },
          body: JSON.stringify({ symbols: { tickers }, columns: ["close", "update_mode"] }),
        });
        const receivedAt = Date.now();
        for (const code of codes) {
          const direct = data?.data?.find((item) => item.s === `FX_IDC:${code}USD`);
          const inverse = data?.data?.find((item) => item.s === `FX_IDC:USD${code}`);
          const item = direct?.d?.[0] > 0 ? direct : inverse?.d?.[0] > 0 ? inverse : null;
          const mode = String(item?.d?.[1] || "");
          if (!item || !mode.includes("streaming")) {
            if (quotes[code]) quotes[code].connected = false;
            continue;
          }
          const usd = item === direct ? Number(item.d[0]) : 1 / Number(item.d[0]);
          const delaySeconds = Number(mode.match(/delayed_streaming_(\d+)/)?.[1]);
          publish(code, usd, receivedAt, "TradingView FX", delaySeconds > 0
            ? `${Math.round(delaySeconds / 60)}m delayed` : "Indicative");
        }
      } catch (_) {
        for (const code of codes) if (quotes[code]) quotes[code].connected = false;
      }
    }

    function schedule(delay = POLL_MS) {
      clearTimeout(timer);
      if (started && document.visibilityState !== "hidden"
          && selected.some((code) => code !== "BTC" && code !== "USD")) {
        timer = setTimeout(poll, delay);
      }
    }

    async function poll() {
      if (!started || document.visibilityState === "hidden" || polling) return;
      polling = true;
      const version = ++pollVersion;
      const wanted = selected.filter((code) => code !== "USD" && code !== "BTC");
      try {
        await Promise.allSettled([
          pollFiat(wanted.filter((code) => !METALS.has(code))),
          ...wanted.filter((code) => METALS.has(code)).map(pollMetal),
        ]);
        onQuote?.(current());
      } finally {
        if (version === pollVersion) {
          polling = false;
          schedule();
        }
      }
    }

    function setSelection(codes) {
      const next = [...new Set(codes.filter((code) => code && code !== "USD"))];
      if (next.join("|") === selected.join("|")) return;
      selected = next;
      pollVersion += 1;
      polling = false;
      for (const controller of controllers) controller.abort();
      scheduleStatus();
      if (selected.includes("BTC")) btc?.start();
      else btc?.stop();
      schedule(0);
    }

    function start() {
      if (started) return;
      started = true;
      if (selected.includes("BTC")) btc?.start();
      scheduleStatus();
      schedule(0);
    }

    function stop() {
      started = false;
      pollVersion += 1;
      polling = false;
      clearTimeout(timer);
      clearTimeout(statusTimer);
      for (const controller of controllers) controller.abort();
      btc?.stop();
    }

    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "hidden") {
        clearTimeout(timer);
        clearTimeout(statusTimer);
        for (const controller of controllers) controller.abort();
      } else if (started) {
        onQuote?.(current());
        scheduleStatus();
        schedule(0);
      }
    });
    window.addEventListener("pagehide", stop);
    window.addEventListener("pageshow", start);
    return { start, stop, setSelection, current };
  }

  window.WSBUoaLiveQuotes = Object.freeze({ create, project, publishedInstant });
}());
