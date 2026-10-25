/* Latest scheduled issuance from public canonical block headers; no price data. */
(function (root) {
  "use strict";
  const BLOCKS_URL = "https://mempool.space/api/v1/blocks/";
  const HASH_URL = "https://mempool.space/api/block-height/";
  const DAY_SECONDS = 86400, HALVING = 210000, MAX_HEADERS = 720;
  const HASH = /^[0-9a-f]{64}$/i;

  function readHeader(value) {
    const timestamp = value?.timestamp ?? (Number.isFinite(value?.minedAt) ? value.minedAt / 1000 : NaN);
    if (!Number.isSafeInteger(value?.height) || value.height < 0 || !Number.isSafeInteger(timestamp)
        || timestamp <= 0 || timestamp > 0xffffffff || !HASH.test(value.id || "")
        || (value.height > 0 && !HASH.test(value.previousblockhash || ""))) return null;
    return Object.freeze({ height: value.height, id: value.id.toLowerCase(), timestamp,
      previousblockhash: value.height > 0 ? value.previousblockhash.toLowerCase() : null });
  }

  function readTip(value) {
    const timestamp = value?.timestamp ?? (Number.isFinite(value?.minedAt) ? value.minedAt / 1000 : NaN);
    if (!Number.isSafeInteger(value?.height) || value.height < 0 || !HASH.test(value.id || "")
        || !Number.isSafeInteger(timestamp) || timestamp <= 0 || timestamp > 0xffffffff) return null;
    return Object.freeze({ height: value.height, id: value.id.toLowerCase(), timestamp,
      previousblockhash: HASH.test(value.previousblockhash || "") ? value.previousblockhash.toLowerCase() : null,
      reorg: value.reorg === true });
  }

  // Matches the existing Issuance model: scheduled subsidy, including genesis.
  // This is not the homepage's observed/claimed-subsidy supply anchor.
  function supplyAtHeight(height) {
    if (!Number.isSafeInteger(height) || height < -1) throw new Error("Invalid issuance height");
    let remaining = height + 1, supply = 0, epoch = 0;
    while (remaining > 0 && epoch < 33) {
      const count = Math.min(remaining, HALVING);
      supply += count * (50 / 2 ** epoch);
      remaining -= count; epoch += 1;
    }
    return supply;
  }

  function calculateWindow(headers, tipValue) {
    const tip = readTip(tipValue);
    if (!tip) throw new Error("Invalid chain tip");
    const byHash = new Map();
    for (const value of headers) {
      const header = readHeader(value);
      if (!header) throw new Error("Invalid block header");
      const previous = byHash.get(header.id);
      if (previous && JSON.stringify(previous) !== JSON.stringify(header)) throw new Error("Conflicting header");
      byHash.set(header.id, header);
    }
    const cutoff = tip.timestamp - DAY_SECONDS;
    let block = byHash.get(tip.id), count = 0;
    if (!block || block.height !== tip.height || block.timestamp !== tip.timestamp) return null;
    // Descend by parent hash, not timestamp. The first timestamp <= cutoff is
    // the highest canonical boundary height, even when miner times go backwards.
    while (block && count++ <= MAX_HEADERS) {
      if (block.timestamp <= cutoff || block.height === 0) {
        const supply = supplyAtHeight(tip.height), epoch = Math.floor(tip.height / HALVING) + 1;
        const subsidy = epoch > 33 ? 0 : 50 / 2 ** (epoch - 1);
        const issuance = supply - supplyAtHeight(block.height), target = 144 * subsidy;
        return Object.freeze({ tip: byHash.get(tip.id), boundary: block,
          row: Object.freeze({ height: tip.height, epoch, subsidy, supply,
            daily_issuance: issuance, issuance_rate: supply > 0 ? issuance * 365 / supply : 0,
            target_issuance: target, target_rate: supply > 0 ? target * 365 / supply : 0,
            rolling_24h_start_height: block.height,
            rolling_24h_start_time_utc: new Date(block.timestamp * 1000).toISOString(),
            uses_rolling_24h: true, timezone_blocks: tip.height - block.height }) });
      }
      const parent = byHash.get(block.previousblockhash);
      if (!parent) return null;
      if (parent.height !== block.height - 1) throw new Error("Noncontiguous header chain");
      block = parent;
    }
    return null;
  }

  function isNewerThanPublication(snapshot, publication) {
    if (!snapshot || !publication?.rows?.length) return false;
    const height = Number(publication.source?.latest_block_height ?? publication.rows.at(-1).height);
    const publishedAt = Date.parse(publication.generated_utc || "");
    const blockTime = Date.parse(publication.source?.latest_block_time_utc || "") / 1000;
    if (snapshot.tip.height > height) return true;
    // Height/time cannot identify a same-height replacement. Keep established
    // reorg lineage until an equally current publication reconciles it; a later
    // old-branch higher-height publication must not resurrect orphaned data.
    if (snapshot.reorg && height <= snapshot.reorgFrom) {
      const reconciled = snapshot.tip.height === height && snapshot.tip.timestamp === blockTime
        && publishedAt >= snapshot.reorgAt;
      return !reconciled;
    }
    return false;
  }

  function projectRows(publication, snapshot, now = Date.now()) {
    const rows = publication?.rows || [];
    if (!isNewerThanPublication(snapshot, publication)) return rows;
    const last = rows.at(-1), today = new Date(now).toISOString().slice(0, 10);
    // Producer rows use the wall-clock UTC day, not the miner timestamp date.
    // Never create invented dates between an older publication and today.
    if (today < last.date) return rows;
    const previousDay = new Date(Date.parse(today + "T00:00:00Z") - 86400000).toISOString().slice(0, 10);
    const previous = rows.findLast(entry => entry.date < today);
    let target = snapshot.row.target_issuance;
    // Preserve the producer's mixed-subsidy target on a known halving day.
    // Without the adjacent UTC-day boundary, use the current subsidy target.
    if (previous?.date === previousDay && Number(previous.height) < snapshot.tip.height
        && Number(previous.epoch) !== snapshot.row.epoch) {
      const currentBlocks = snapshot.tip.height - (snapshot.row.epoch - 1) * HALVING + 1;
      const oldBlocks = snapshot.tip.height - currentBlocks - Number(previous.height);
      const total = Math.max(1, oldBlocks + currentBlocks);
      target = 144 * ((oldBlocks / total) * (50 / 2 ** (Number(previous.epoch) - 1))
        + (currentBlocks / total) * snapshot.row.subsidy);
    }
    const row = Object.freeze({ ...last, ...snapshot.row, target_issuance: target,
      target_rate: snapshot.row.supply > 0 ? target * 365 / snapshot.row.supply : 0, date: today,
      date_num: Date.parse(today + "T00:00:00Z") / 86400000,
      live_block_time_utc: new Date(snapshot.tip.timestamp * 1000).toISOString(),
      live_observed_at: snapshot.observedAt, live_block_hash: snapshot.tip.id, provisional: true });
    // A replacement chain can retreat behind the previous published day.
    // Clip orphaned future heights only in this current-view projection.
    const preceding = (today === last.date ? rows.slice(0, -1) : rows)
      .filter(previous => Number(previous.height) <= snapshot.tip.height);
    return [...preceding, row];
  }

  function create({ onChange, fetchResource = (...args) => root.fetch(...args),
                    pageDelayMs = 150, maxPages = 32, requestTimeoutMs = 12000 } = {}) {
    let started = false, pageHidden = false, wanted = null, snapshot = null, revision = 0;
    let controller = null, worker = null, retryTimer = 0, retryAt = 0, retryDelay = 5000;
    let failed = false, reorgFrom = -1, reorgAt = 0;
    let cache = new Map();
    const active = () => started && !pageHidden && root.document?.visibilityState !== "hidden"
      && root.navigator?.onLine !== false;
    const notify = () => { if (started) onChange?.(); };
    const chain = root.WSBBitcoinChainTip?.create({ onTip, onStatus: notify });
    const current = () => snapshot && Object.freeze({ ...snapshot,
      live: active() && !failed && wanted?.id === snapshot.tip.id && !!chain?.isLive() });

    function install(windowValue, id) {
      if (!windowValue || !active() || id !== revision || windowValue.tip.id !== wanted?.id) return false;
      // A wake/retry is not a new chain observation or a newer publication.
      if (snapshot?.tip.id !== windowValue.tip.id || snapshot?.boundary.id !== windowValue.boundary.id) {
        snapshot = Object.freeze({ ...windowValue, observedAt: Date.now(),
          reorg: windowValue.tip.height <= reorgFrom, reorgFrom, reorgAt });
      }
      failed = false; retryDelay = 5000; retryAt = 0;
      root.clearTimeout(retryTimer); retryTimer = 0;
      for (const height of cache.keys()) {
        if (height > wanted.height || height < wanted.height - MAX_HEADERS) cache.delete(height);
      }
      notify();
      return true;
    }
    function armRetry() {
      root.clearTimeout(retryTimer); retryTimer = 0;
      if (!active() || !retryAt) return;
      retryTimer = root.setTimeout(() => { retryTimer = 0; void refreshWindow(); }, Math.max(0, retryAt - Date.now()));
    }
    function scheduleRetry(error) {
      failed = true;
      retryAt = Date.now() + Math.max(retryDelay, error?.retryAfter || 0);
      retryDelay = Math.min(300000, retryDelay * 2);
      armRetry(); notify();
    }
    async function request(url, requestController, text = false) {
      const timeout = root.setTimeout(() => requestController.abort(), requestTimeoutMs);
      try {
        const response = await fetchResource(url, { cache: "no-store", signal: requestController.signal });
        if (!response.ok) {
          const error = new Error("Recent issuance headers unavailable");
          if (response.status === 429) {
            const raw = response.headers?.get?.("Retry-After"), seconds = Number(raw);
            const delay = raw && Number.isFinite(seconds) ? seconds * 1000 : Date.parse(raw || "") - Date.now();
            error.retryAfter = Math.max(60000, Math.min(600000, Number.isFinite(delay) ? delay : 60000));
          }
          throw error;
        }
        const body = await (text ? response.text() : response.json());
        if (requestController.signal.aborted) throw new Error("Issuance header request aborted");
        return body;
      } finally { root.clearTimeout(timeout); }
    }
    async function refreshWindow() {
      if (!active() || !wanted || Date.now() < retryAt) { armRetry(); return false; }
      if (worker) return worker;
      const id = revision, tip = wanted;
      const requestController = controller = new AbortController();
      // Unvalidated REST ancestry never enters the cache used for instant WS
      // appends. A changed canonical tip discards this entire transaction.
      const pending = new Map(cache);
      const candidate = () => calculateWindow(pending.values(), tip);
      const run = async () => {
        try {
          let expected = tip, pages = 0, walked = 0;
          while (active() && id === revision && walked++ <= MAX_HEADERS) {
            if (candidate()) break;
            const existing = pending.get(expected.height);
            if (existing?.id === expected.id) {
              if (existing.height === 0) break;
              expected = { height: existing.height - 1, id: existing.previousblockhash };
              continue;
            }
            if (pages++ >= maxPages) break;
            const payload = await request(BLOCKS_URL + expected.height, requestController);
            if (!active() || id !== revision) return false;
            if (!Array.isArray(payload) || !payload.length || payload.length > 15) throw new Error("Invalid header page");
            const page = payload.map(readHeader);
            if (page.some(header => !header) || page[0].height !== expected.height || page[0].id !== expected.id) {
              throw new Error("Header page changed chain");
            }
            for (let index = 1; index < page.length; index++) {
              if (page[index - 1].height !== page[index].height + 1 || page[index - 1].previousblockhash !== page[index].id) {
                throw new Error("Header page has a gap");
              }
            }
            page.forEach(header => pending.set(header.height, header));
            if (candidate()) break;
            const last = page.at(-1);
            if (last.height === 0) break;
            expected = { height: last.height - 1, id: last.previousblockhash };
            if (pageDelayMs > 0) await new Promise(resolve => root.setTimeout(resolve, pageDelayMs));
          }
          const complete = candidate();
          if (!complete) throw new Error("Incomplete rolling issuance window");
          const canonicalHash = (await request(HASH_URL + tip.height, requestController, true)).trim();
          if (!active() || id !== revision) return false;
          if (canonicalHash !== tip.id) throw new Error("Issuance tip changed during catch-up");
          cache = pending;
          return install(complete, id);
        } catch (error) {
          if (active() && id === revision) scheduleRetry(error);
          return false;
        } finally {
          if (controller === requestController) controller = null;
        }
      };
      worker = run();
      try { return await worker; }
      finally {
        worker = null;
        if (active() && id !== revision) void refreshWindow();
      }
    }
    function onTip(value) {
      const tip = readTip(value);
      if (!active() || !tip) return;
      if (wanted?.id === tip.id && wanted.timestamp === tip.timestamp) return;
      const previous = snapshot?.tip || wanted;
      if (previous && (tip.reorg || tip.height < previous.height
          || (tip.height === previous.height && tip.id !== previous.id))) {
        reorgFrom = Math.max(reorgFrom, previous.height, tip.height);
        reorgAt = Date.now();
      }
      wanted = tip; ++revision; controller?.abort();
      const header = readHeader(value);
      if (header) cache.set(header.height, header);
      // Only a new authoritative tip linked to already validated ancestry can
      // take this zero-request path. Bootstrap/catch-up always recheck canon.
      if (snapshot && header) {
        try { if (install(calculateWindow(cache.values(), wanted), revision)) return; }
        catch (_) { /* Inconsistent cached ancestry requires REST validation. */ }
      }
      void refreshWindow();
    }
    function pause() {
      ++revision; controller?.abort();
      root.clearTimeout(retryTimer); retryTimer = 0; notify();
    }
    function wake() {
      if (!started) return;
      if (!active()) { pause(); return; }
      chain?.refresh();
      if (retryAt > Date.now()) armRetry();
      else if (!snapshot || wanted?.id !== snapshot.tip.id || failed) void refreshWindow();
      notify();
    }
    function hide() { pageHidden = true; pause(); }
    function show() { pageHidden = false; wake(); }
    function start() {
      if (started) return;
      started = true; pageHidden = false;
      root.document?.addEventListener("visibilitychange", wake);
      root.addEventListener?.("pageshow", show);
      root.addEventListener?.("pagehide", hide);
      root.addEventListener?.("online", wake);
      root.addEventListener?.("offline", wake);
      chain?.start(); wake();
    }
    function stop() {
      if (!started) return;
      started = false; pause(); controller = null;
      root.document?.removeEventListener("visibilitychange", wake);
      root.removeEventListener?.("pageshow", show);
      root.removeEventListener?.("pagehide", hide);
      root.removeEventListener?.("online", wake);
      root.removeEventListener?.("offline", wake);
      chain?.stop();
    }
    return { start, stop, current, refresh: wake };
  }

  const api = Object.freeze({ create, readHeader, readTip, calculateWindow, supplyAtHeight,
    projectRows, isNewerThanPublication, BLOCKS_URL, HASH_URL });
  root.WSBIssuanceLive = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
}(typeof window !== "undefined" ? window : globalThis));
