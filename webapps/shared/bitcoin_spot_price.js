/* Public BTC/USD spot feed: 2140data socket, 2140data REST, then legacy sources. */
(function () {
  "use strict";

  const SOCKET_URL = "wss://2140data.io/";
  const REST_URL = "https://2140data.io/price";
  const LEGACY_SOCKET_URL = "wss://ws-feed.exchange.coinbase.com";
  const SOCKET_STALL_MS = 65000;
  const QUOTE_LIVE_MS = 60000;
  const QUOTE_STALE_MS = 90000;
  const POLL_MS = 60000;
  const REQUEST_TIMEOUT_MS = 12000;
  const LEGACY_SOURCES = [
    {
      name: "Coinbase",
      url: "https://api.exchange.coinbase.com/products/BTC-USD/ticker",
      read: (data) => ({ price: Number(data?.price), at: Date.parse(data?.time) }),
    },
    {
      name: "Kraken",
      url: "https://api.kraken.com/0/public/Ticker?pair=XBTUSD",
      read: (data) => ({ price: Number(data?.result?.XXBTZUSD?.c?.[0]) }),
    },
    {
      name: "Coinbase spot",
      url: "https://api.coinbase.com/v2/prices/BTC-USD/spot",
      read: (data) => ({ price: Number(data?.data?.amount) }),
    },
    {
      name: "mempool.space",
      url: "https://mempool.space/api/v1/prices",
      read: (data) => ({ price: Number(data?.USD) }),
    },
  ];

  function create({ onQuote, legacySources = LEGACY_SOURCES, legacySocket = true } = {}) {
    let started = false;
    let socket = null;
    let socketPriceAt = 0;
    let socketHeardAt = 0;
    let oldSocket = null;
    let oldSocketPriceAt = 0;
    let restPriceAt = 0;
    let retryDelay = 2000;
    let retryTimer = 0;
    let watchTimer = 0;
    let pollTimer = 0;
    let liveTimer = 0;
    let staleTimer = 0;
    let request = null;
    let quote = null;
    let lastQuote = null;

    const isVisible = () => document.visibilityState !== "hidden";
    const current = () => quote && Date.now() - quote.at < QUOTE_STALE_MS ? quote : null;
    const last = () => lastQuote;
    const isLive = (value = lastQuote) => Boolean(value
      && Date.now() - (value.receivedAt ?? value.at) < QUOTE_LIVE_MS);
    const newerThan = (publishedAt) => {
      const raw = String(publishedAt || "").trim().replace(" UTC", "Z").replace(" ", "T");
      const utc = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?$/.test(raw)
        ? `${raw}Z` : raw;
      const parsed = Number.isFinite(publishedAt) ? Number(publishedAt) : Date.parse(utc);
      return lastQuote && lastQuote.at > (Number.isFinite(parsed) ? parsed : 0) ? lastQuote : null;
    };

    function scheduleLiveStatus() {
      clearTimeout(liveTimer);
      if (!lastQuote) return;
      const remaining = (lastQuote.receivedAt ?? lastQuote.at) + QUOTE_LIVE_MS - Date.now();
      if (remaining <= 0) return;
      liveTimer = window.setTimeout(() => {
        liveTimer = 0;
        onQuote?.(current());
      }, remaining);
    }

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
      if (lastQuote && at < lastQuote.at) return false;
      quote = { price, source, at, receivedAt: Date.now() };
      lastQuote = quote;
      scheduleLiveStatus();
      scheduleStale();
      onQuote?.(quote);
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

    function closeOldSocket() {
      oldSocketPriceAt = 0;
      if (!oldSocket) return;
      const old = oldSocket;
      oldSocket = null;
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
        watchTimer = window.setTimeout(watchSocket, SOCKET_STALL_MS / 2);
      };
      opened.onmessage = (event) => {
        let data;
        try { data = JSON.parse(event.data); } catch (_) { return; }
        const eventAt = data?.time ? Date.parse(data.time) : Date.now();
        if (!Number.isFinite(eventAt) || Math.abs(Date.now() - eventAt) > QUOTE_STALE_MS) return;
        if (publish(Number(data?.weightedPrice), "2140data.io live", eventAt)) {
          socketHeardAt = Date.now();
          socketPriceAt = Date.now();
          retryDelay = 2000;
          request?.abort();
          closeOldSocket();
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

    function connectOldSocket() {
      if (!legacySocket || !started || !isVisible() || oldSocket
          || typeof WebSocket === "undefined") return;
      try { oldSocket = new WebSocket(LEGACY_SOCKET_URL); }
      catch (_) { return; }
      const opened = oldSocket;
      opened.onopen = () => opened.send(JSON.stringify({
        type: "subscribe", product_ids: ["BTC-USD"], channels: ["ticker_batch"],
      }));
      opened.onmessage = (event) => {
        if (socketPriceAt && Date.now() - socketPriceAt < SOCKET_STALL_MS) return;
        if (restPriceAt && Date.now() - restPriceAt < POLL_MS + 5000) return;
        let data;
        try { data = JSON.parse(event.data); } catch (_) { return; }
        if (data?.type === "error" || (data?.type === "subscriptions" && !data.channels?.length)) {
          closeOldSocket();
          return;
        }
        if (data?.type !== "ticker" || data.product_id !== "BTC-USD") return;
        const eventAt = data.time ? Date.parse(data.time) : Date.now();
        if (!Number.isFinite(eventAt) || Math.abs(Date.now() - eventAt) > QUOTE_STALE_MS) return;
        if (publish(Number(data.price), "Coinbase live", eventAt)) oldSocketPriceAt = Date.now();
      };
      opened.onclose = () => {
        if (oldSocket === opened) oldSocket = null;
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
      if (!started || !isVisible() || request) return current();
      if (socketPriceAt && Date.now() - socketPriceAt < SOCKET_STALL_MS) {
        schedulePoll();
        return current();
      }
      const pollStartedAt = Date.now();
      const sources = [
        { name: "2140data.io REST", url: REST_URL,
          read: (data) => ({ price: Number(data?.price) }) },
        ...legacySources,
      ];
      let restSucceeded = false;
      for (const [index, source] of sources.entries()) {
        if (!started || !isVisible()) break;
        if (socketPriceAt && Date.now() - socketPriceAt < SOCKET_STALL_MS) break;
        if (index === 1) connectOldSocket();
        const controller = new AbortController();
        request = controller;
        const timeout = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
        try {
          const response = await fetch(source.url, { signal: controller.signal, cache: "no-store" });
          if (!response.ok) continue;
          const { price, at } = source.read(await response.json());
          if (!started || !isVisible()) break;
          if (socketPriceAt >= pollStartedAt) break;
          if (index > 0 && oldSocketPriceAt >= pollStartedAt) break;
          if (index === 0) {
            if (publish(price, source.name)) {
              restPriceAt = Date.now();
              restSucceeded = true;
              closeOldSocket();
              break;
            }
          } else if (Number.isFinite(at)) {
            if (Math.abs(Date.now() - at) > QUOTE_STALE_MS || at < (lastQuote?.at || 0)) continue;
            if (publish(price, source.name, at)) break;
          } else if (publish(price, source.name)) {
            break;
          }
        } catch (_) {
          // Try the next public source; the published snapshot remains available.
        } finally {
          clearTimeout(timeout);
          if (request === controller) request = null;
        }
      }
      if (!restSucceeded && (!socketPriceAt || Date.now() - socketPriceAt >= SOCKET_STALL_MS)) {
        connectOldSocket();
      }
      schedulePoll();
      return current();
    }

    function onVisibilityChange() {
      if (!started) return;
      if (!isVisible()) {
        clearTimeout(retryTimer);
        clearTimeout(pollTimer);
        retryTimer = pollTimer = 0;
        request?.abort();
        closeSocket();
        closeOldSocket();
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
      clearTimeout(liveTimer);
      clearTimeout(staleTimer);
      retryTimer = watchTimer = pollTimer = liveTimer = staleTimer = 0;
      request?.abort();
      closeSocket();
      closeOldSocket();
    }

    return { start, stop, current, last, isLive, newerThan, refresh: poll };
  }

  window.WSBBitcoinSpotPrice = { create };
}());
