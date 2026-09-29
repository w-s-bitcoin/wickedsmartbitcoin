/* Public BTC/USD spot feed. Socket prices are preferred; REST covers startup and outages. */
(function () {
  "use strict";

  const SOCKET_URL = "wss://ws-feed.exchange.coinbase.com";
  const SOCKET_STALL_MS = 65000;
  const QUOTE_STALE_MS = 90000;
  const POLL_MS = 60000;
  const REQUEST_TIMEOUT_MS = 12000;
  const SOURCES = [
    {
      name: "Coinbase",
      url: "https://api.exchange.coinbase.com/products/BTC-USD/stats",
      read: (data) => Number(data?.last),
    },
    {
      name: "Kraken",
      url: "https://api.kraken.com/0/public/Ticker?pair=XBTUSD",
      read: (data) => Number(data?.result?.XXBTZUSD?.c?.[0]),
    },
    {
      name: "Coinbase spot",
      url: "https://api.coinbase.com/v2/prices/BTC-USD/spot",
      read: (data) => Number(data?.data?.amount),
    },
    {
      name: "mempool.space",
      url: "https://mempool.space/api/v1/prices",
      read: (data) => Number(data?.USD),
    },
  ];

  function create({ onQuote } = {}) {
    let started = false;
    let socket = null;
    let socketPriceAt = 0;
    let socketHeardAt = 0;
    let retryDelay = 2000;
    let retryTimer = 0;
    let watchTimer = 0;
    let pollTimer = 0;
    let staleTimer = 0;
    let request = null;
    let quote = null;

    const isVisible = () => document.visibilityState !== "hidden";
    const current = () => quote && Date.now() - quote.at < QUOTE_STALE_MS ? quote : null;

    function scheduleStale() {
      clearTimeout(staleTimer);
      staleTimer = window.setTimeout(() => {
        staleTimer = 0;
        if (current()) {
          scheduleStale();
          return;
        }
        quote = null;
        onQuote?.(null);
      }, QUOTE_STALE_MS + 1);
    }

    function publish(price, source, at = Date.now()) {
      if (!Number.isFinite(price) || price <= 0 || !Number.isFinite(at)) return false;
      const changed = !quote || quote.price !== price || quote.source !== source || quote.at !== at;
      quote = { price, source, at };
      scheduleStale();
      if (changed) onQuote?.(quote);
      return true;
    }

    function closeSocket() {
      clearTimeout(watchTimer);
      watchTimer = 0;
      socketPriceAt = 0;
      if (!socket) return;
      const old = socket;
      socket = null;
      old.onopen = old.onmessage = old.onclose = old.onerror = null;
      old.close();
    }

    function retrySocket() {
      if (!started || !isVisible() || retryTimer) return;
      retryTimer = window.setTimeout(() => {
        retryTimer = 0;
        connectSocket();
      }, retryDelay);
      retryDelay = Math.min(60000, retryDelay * 2);
    }

    function watchSocket() {
      watchTimer = 0;
      if (!socket) return;
      if (Date.now() - socketHeardAt >= SOCKET_STALL_MS) {
        closeSocket();
        retrySocket();
        schedulePoll(0);
      } else {
        watchTimer = window.setTimeout(watchSocket, SOCKET_STALL_MS / 2);
      }
    }

    function connectSocket() {
      if (!started || !isVisible() || socket || typeof WebSocket === "undefined") return;
      try {
        socket = new WebSocket(SOCKET_URL);
      } catch (_) {
        retrySocket();
        return;
      }
      const opened = socket;
      opened.onopen = () => {
        socketHeardAt = Date.now();
        opened.send(JSON.stringify({
          type: "subscribe", product_ids: ["BTC-USD"], channels: ["ticker_batch"],
        }));
        watchTimer = window.setTimeout(watchSocket, SOCKET_STALL_MS / 2);
      };
      opened.onmessage = (event) => {
        socketHeardAt = Date.now();
        let data;
        try { data = JSON.parse(event.data); } catch (_) { return; }
        if (data?.type === "error" || (data?.type === "subscriptions" && !data.channels?.length)) {
          closeSocket();
          retrySocket();
          schedulePoll(0);
          return;
        }
        if (data?.type !== "ticker" || data.product_id !== "BTC-USD") return;
        const eventAt = data.time ? Date.parse(data.time) : Date.now();
        if (!Number.isFinite(eventAt) || Math.abs(Date.now() - eventAt) > QUOTE_STALE_MS) return;
        if (publish(Number(data.price), "Coinbase live", eventAt)) {
          socketPriceAt = Date.now();
          retryDelay = 2000;
        }
      };
      opened.onclose = () => {
        if (socket !== opened) return;
        socket = null;
        socketPriceAt = 0;
        clearTimeout(watchTimer);
        watchTimer = 0;
        retrySocket();
        schedulePoll(0);
      };
      opened.onerror = () => opened.close();
    }

    function schedulePoll(delay = POLL_MS) {
      if (!started || !isVisible()) return;
      clearTimeout(pollTimer);
      pollTimer = window.setTimeout(() => {
        pollTimer = 0;
        poll();
      }, delay);
    }

    async function poll() {
      if (!started || !isVisible() || request) return;
      if (socketPriceAt && Date.now() - socketPriceAt < SOCKET_STALL_MS) {
        schedulePoll();
        return;
      }
      const pollStartedAt = Date.now();
      for (const source of SOURCES) {
        if (!started || !isVisible()) break;
        const controller = new AbortController();
        request = controller;
        const timeout = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
        try {
          const response = await fetch(source.url, { signal: controller.signal, cache: "no-store" });
          if (!response.ok) continue;
          const price = source.read(await response.json());
          if (socketPriceAt >= pollStartedAt) break;
          if (publish(price, source.name)) break;
        } catch (_) {
          // Try the next public source; the published snapshot remains available.
        } finally {
          clearTimeout(timeout);
          if (request === controller) request = null;
        }
      }
      schedulePoll();
    }

    function onVisibilityChange() {
      if (!started) return;
      if (!isVisible()) {
        clearTimeout(retryTimer);
        clearTimeout(pollTimer);
        retryTimer = pollTimer = 0;
        request?.abort();
        closeSocket();
      } else {
        if (!current() && quote) {
          quote = null;
          onQuote?.(null);
        }
        retryDelay = 2000;
        connectSocket();
        schedulePoll(0);
      }
    }

    function start() {
      if (started) return;
      started = true;
      document.addEventListener("visibilitychange", onVisibilityChange);
      onVisibilityChange();
    }

    function stop() {
      if (!started) return;
      started = false;
      document.removeEventListener("visibilitychange", onVisibilityChange);
      clearTimeout(retryTimer);
      clearTimeout(watchTimer);
      clearTimeout(pollTimer);
      clearTimeout(staleTimer);
      retryTimer = watchTimer = pollTimer = staleTimer = 0;
      request?.abort();
      closeSocket();
    }

    return { start, stop, current };
  }

  window.WSBBitcoinSpotPrice = { create };
}());
