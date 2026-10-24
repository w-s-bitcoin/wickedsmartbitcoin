/* Public Bitcoin chain tip: mempool.space blocks socket with a REST fallback. */
(function () {
  "use strict";

  const SOCKET_URL = "wss://mempool.space/api/v1/ws";
  const REST_URL = "https://mempool.space/api/blocks";
  const POLL_MS = 60000;
  const REQUEST_TIMEOUT_MS = 12000;
  const PING_MS = 25000;
  const SILENCE_MS = 45000;

  function readBlock(block) {
    if (!block || !Number.isSafeInteger(block.height) || block.height < 0
        || !Number.isSafeInteger(block.timestamp) || block.timestamp <= 0
        || block.timestamp > 0xffffffff || typeof block.id !== "string"
        || !/^[0-9a-f]{64}$/i.test(block.id)) return null;
    const tip = { height: block.height, minedAt: block.timestamp * 1000, id: block.id.toLowerCase() };
    // Consumers with a verified recent window can append a socket block without
    // fetching it again. Older/basic responses can still omit the parent hash.
    if (block.previousblockhash != null) {
      if (typeof block.previousblockhash !== "string" || !/^[0-9a-f]{64}$/i.test(block.previousblockhash)) return null;
      tip.previousblockhash = block.previousblockhash.toLowerCase();
    }
    return tip;
  }

  function readBlocks(blocks) {
    if (!Array.isArray(blocks) || !blocks.length) return null;
    let newest = null;
    const heights = new Map();
    for (const raw of blocks) {
      const block = readBlock(raw);
      if (!block || (heights.has(block.height) && heights.get(block.height) !== block.id)) return null;
      heights.set(block.height, block.id);
      if (!newest || block.height > newest.height) newest = block;
    }
    return newest;
  }

  function create({ onTip, onStatus } = {}) {
    let started = false;
    let pageHidden = false;
    let suspended = true;
    let tip = null;
    let status = null;
    let socket = null;
    let heardAt = null;
    let socketRevision = 0;
    let retryDelay = 2000;
    let retryTimer = 0;
    let openTimer = 0;
    let pingTimer = 0;
    let silenceTimer = 0;
    let pollTimer = 0;
    let request = null;
    let lastPollAt = -Infinity;

    const active = () => started && !pageHidden && document.visibilityState !== "hidden"
      && (typeof navigator === "undefined" || navigator.onLine !== false);
    const last = () => tip;
    // A block can take much longer than ten minutes. Liveness follows transport
    // replies, never the miner timestamp or the time since the last new block.
    const isLive = () => Boolean(active() && socket && socket.readyState === 1
      && heardAt !== null && Date.now() - heardAt < SILENCE_MS);

    function setStatus(next) {
      if (status === next) return;
      status = next;
      onStatus?.(next);
    }

    function publish(candidate, authoritative) {
      if (tip && !authoritative && candidate.height < tip.height) return false;
      if (tip && candidate.height === tip.height && candidate.id === tip.id
          && candidate.minedAt === tip.minedAt) return true;
      tip = Object.freeze({ ...candidate, reorg: Boolean(tip && candidate.height < tip.height) });
      onTip?.(tip);
      return true;
    }

    function cancelRequest() {
      if (!request) return;
      const pending = request;
      request = null;
      clearTimeout(pending.timer);
      pending.controller.abort();
    }

    function closeSocket() {
      clearTimeout(openTimer);
      clearTimeout(pingTimer);
      clearTimeout(silenceTimer);
      openTimer = pingTimer = silenceTimer = 0;
      heardAt = null;
      if (!socket) return;
      const old = socket;
      socket = null;
      old.onopen = old.onmessage = old.onclose = old.onerror = null;
      try { old.close(); } catch (_) { /* Already closed or unavailable. */ }
    }

    function schedulePoll() {
      clearTimeout(pollTimer);
      pollTimer = 0;
      if (!active() || isLive() || request) return;
      pollTimer = window.setTimeout(() => {
        pollTimer = 0;
        poll();
      }, Math.max(0, lastPollAt + POLL_MS - Date.now()));
    }

    function scheduleRetry() {
      if (!active() || retryTimer || typeof WebSocket === "undefined") return;
      retryTimer = window.setTimeout(() => {
        retryTimer = 0;
        connect();
      }, retryDelay);
      retryDelay = Math.min(60000, retryDelay * 2);
    }

    function disconnected(opened) {
      if (socket !== opened) return;
      closeSocket();
      setStatus(active() ? "offline" : "paused");
      scheduleRetry();
      schedulePoll();
    }

    function send(opened, payload) {
      if (socket !== opened || opened.readyState !== 1) return false;
      try { opened.send(JSON.stringify(payload)); return true; }
      catch (_) { disconnected(opened); return false; }
    }

    function watchSilence(opened) {
      clearTimeout(silenceTimer);
      silenceTimer = window.setTimeout(() => disconnected(opened), SILENCE_MS);
    }

    function ping(opened) {
      if (!send(opened, { action: "ping" })) return;
      clearTimeout(pingTimer);
      pingTimer = window.setTimeout(() => ping(opened), PING_MS);
    }

    function confirmed(opened) {
      heardAt = Date.now();
      retryDelay = 2000;
      clearTimeout(pollTimer);
      pollTimer = 0;
      watchSilence(opened);
      setStatus("live");
    }

    function connect() {
      if (!active() || socket) return;
      if (typeof WebSocket === "undefined") { setStatus("offline"); return; }
      setStatus("connecting");
      try { socket = new WebSocket(SOCKET_URL); }
      catch (_) {
        setStatus("offline");
        scheduleRetry();
        schedulePoll();
        return;
      }
      const opened = socket;
      openTimer = window.setTimeout(() => disconnected(opened), REQUEST_TIMEOUT_MS);
      opened.onopen = () => {
        if (socket !== opened || !active()) return;
        clearTimeout(openTimer);
        openTimer = 0;
        watchSilence(opened);
        if (send(opened, { action: "want", data: ["blocks"] })) ping(opened);
      };
      opened.onmessage = (event) => {
        if (socket !== opened || opened.readyState !== 1 || !active()) return;
        let data;
        try { data = JSON.parse(event.data); } catch (_) { return; }
        if (!data || typeof data !== "object" || Array.isArray(data)) return;
        const hasBlocks = Object.prototype.hasOwnProperty.call(data, "blocks");
        const hasBlock = Object.prototype.hasOwnProperty.call(data, "block");
        const blocksTip = hasBlocks ? readBlocks(data.blocks) : null;
        const blockTip = hasBlock ? readBlock(data.block) : null;
        // A partial payload must never install just its valid fields.
        if ((hasBlocks && !blocksTip) || (hasBlock && !blockTip)) return;
        const candidate = blockTip && (!blocksTip || blockTip.height > blocksTip.height)
          ? blockTip : blocksTip;
        if (!candidate && data.pong !== true) return;
        confirmed(opened);
        if (!candidate || (tip && !hasBlocks && candidate.height < tip.height)) return;
        socketRevision += 1;
        cancelRequest();
        publish(candidate, hasBlocks);
      };
      opened.onclose = () => disconnected(opened);
      opened.onerror = () => disconnected(opened);
    }

    async function poll() {
      if (!active() || isLive() || request) return tip;
      const pending = { controller: new AbortController(), revision: socketRevision, timer: 0 };
      request = pending;
      lastPollAt = Date.now();
      pending.timer = window.setTimeout(() => {
        if (request !== pending) return;
        cancelRequest();
        schedulePoll();
      }, REQUEST_TIMEOUT_MS);
      try {
        const response = await fetch(REST_URL, { cache: "no-store", signal: pending.controller.signal });
        if (!response.ok) return tip;
        const candidate = readBlocks(await response.json());
        if (candidate && active() && request === pending && !pending.controller.signal.aborted
            && socketRevision === pending.revision) publish(candidate, true);
      } catch (_) {
        // Keep the last complete tip while the socket and REST service recover.
      } finally {
        clearTimeout(pending.timer);
        if (request === pending) {
          request = null;
          schedulePoll();
        }
      }
      return tip;
    }

    function pause() {
      suspended = true;
      clearTimeout(retryTimer);
      clearTimeout(pollTimer);
      retryTimer = pollTimer = 0;
      cancelRequest();
      closeSocket();
      // Losing network access is a failure; hiding the page is an intentional pause.
      setStatus(typeof navigator !== "undefined" && navigator.onLine === false ? "offline" : "paused");
    }

    function refresh() {
      if (!active()) return Promise.resolve(tip);
      if (!socket && !retryTimer) connect();
      if (isLive()) {
        const opened = socket;
        if (send(opened, { "refresh-blocks": true })) ping(opened);
        return Promise.resolve(tip);
      }
      return poll();
    }

    function wake() {
      if (!started) return;
      if (!active()) { pause(); return; }
      if (suspended) {
        suspended = false;
        retryDelay = 2000;
      }
      // Resume catches up immediately, even within the previous REST interval.
      refresh();
    }

    function onPageHide() { pageHidden = true; if (started) pause(); }
    function onPageShow() { pageHidden = false; wake(); }
    const listeners = [
      [document, "visibilitychange", wake],
      [window, "online", wake],
      [window, "offline", wake],
      [window, "focus", wake],
      [window, "pagehide", onPageHide],
      [window, "pageshow", onPageShow],
    ];

    function start() {
      if (started) return;
      started = true;
      pageHidden = false;
      listeners.forEach(([target, name, listener]) => target.addEventListener(name, listener));
      wake();
    }

    function stop() {
      if (!started) return;
      started = false;
      listeners.forEach(([target, name, listener]) => target.removeEventListener(name, listener));
      pause();
    }

    return { start, stop, refresh, last, isLive };
  }

  window.WSBBitcoinChainTip = { create };
}());
