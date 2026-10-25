/* ===========================
 * HOMEPAGE: LIVE NETWORK SNAPSHOT WITH PUBLISHED FALLBACK
 * =========================== */
(function initHomepageNetworkSnapshot() {
  const TOP_KPIS_URL = "assets/top_kpis.json";
  const AUTO_REFRESH_MS = 60000;
  const TARGET_SUPPLY_BTC = 21000000;
  const HALVING_INTERVAL = 210000;
  const DIFFICULTY_INTERVAL = 2016;
  const TARGET_BLOCK_SECONDS = 600;
  const LATE_BLOCK_SECONDS = 2400;
  const FALLBACK_TIME_ZONE = "UTC";
  const TZ_STORAGE_KEY = "wicked_dashboard_timezone_v1";
  const TZ_CHANGE_EVENT = "wsb:timezonechange";

  const byId = (id) => document.getElementById(id);
  const container = byId("homeBip110Kpis");
  const timeZoneSelect = byId("homeKpiTimeZoneSelect");
  const chips = {
    clock: byId("homeBip110UpdatedKpi"),
    height: byId("homeBip110HeightKpi"),
    supply: byId("homeBip110SupplyKpi"),
  };
  if (!container || !timeZoneSelect || Object.values(chips).some((element) => !element)) return;

  const values = Object.fromEntries(Object.entries(chips).map(([key, element]) => [
    key, element.querySelector(".chip-value") || element,
  ]));
  const snapshotStatus = byId("homeKpiSnapshotStatus");
  const blockTime = byId("homeKpiBlockTime");
  const blockElapsed = byId("homeKpiBlockElapsed");
  const blockProgress = byId("homeKpiBlockProgress");
  const blockMeter = byId("homeKpiBlockMeter");
  const blockTicks = byId("homeKpiBlockTicks");
  const supplyProgress = byId("homeKpiSupplyProgress");
  const supplyCaption = byId("homeKpiSupplyCaption");
  const halvingRemaining = byId("homeKpiHalvingRemaining");
  const halvingProgress = byId("homeKpiHalvingProgress");
  const halvingCaption = byId("homeKpiHalvingCaption");
  const difficultyRemainingValue = byId("homeKpiDifficultyRemaining");
  const difficultyProgress = byId("homeKpiDifficultyProgress");
  const difficultyMeter = byId("homeKpiDifficultyMeter");
  const difficultyEpochCaption = byId("homeKpiDifficultyEpochCaption");
  const difficultyEstimate = byId("homeKpiDifficultyEstimate");
  const difficultyEstimateValue = byId("homeKpiDifficultyEstimateValue");
  const compactSupply = window.matchMedia("(max-width: 480px)");

  let lastSnapshot = null;
  let publishedSnapshot = null;
  let liveTip = null;
  let liveStatus = "connecting";
  let liveUnavailable = false;
  let reorgCeiling = -1;
  let lastSignature = "";
  let refreshInFlight = false;
  let refreshFailed = false;
  let wakeTimer = null;
  let blockScaleLabelKey = "";
  let blockScaleLabels = [];
  let blockFutureTimestamp = null;
  let blockFutureScaleSeconds = TARGET_BLOCK_SECONDS;

  function isDashboardExportActive() {
    return !!(window.wsbDashboardExportActive || window.dateRangeExportActive);
  }

  function getPreferredTimeZone() {
    if (window.WSBDashboardTime?.getPreferredTimeZone) {
      return window.WSBDashboardTime.getPreferredTimeZone();
    }
    try {
      const value = localStorage.getItem(TZ_STORAGE_KEY) || FALLBACK_TIME_ZONE;
      Intl.DateTimeFormat("en-US", { timeZone: value }).format();
      return value;
    } catch (_) {
      return FALLBACK_TIME_ZONE;
    }
  }

  function setPreferredTimeZone(value) {
    if (window.WSBDashboardTime?.setPreferredTimeZone) {
      return window.WSBDashboardTime.setPreferredTimeZone(value);
    }
    let normalized = String(value || "").trim() || FALLBACK_TIME_ZONE;
    try {
      Intl.DateTimeFormat("en-US", { timeZone: normalized }).format();
    } catch (_) {
      normalized = FALLBACK_TIME_ZONE;
    }
    try {
      localStorage.setItem(TZ_STORAGE_KEY, normalized);
    } catch (_) {}
    return normalized;
  }

  function renderTimeZoneOptions() {
    const current = getPreferredTimeZone();
    const options = window.WSBDashboardTime?.getTimeZoneOptions?.()
      || [{ value: FALLBACK_TIME_ZONE, label: FALLBACK_TIME_ZONE }];
    timeZoneSelect.replaceChildren();
    options.forEach(({ value, label }) => {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = label;
      option.selected = value === current;
      timeZoneSelect.appendChild(option);
    });
  }

  function formatTime(timestampMs, { seconds = false } = {}) {
    return new Intl.DateTimeFormat("en-US", {
      timeZone: getPreferredTimeZone(),
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      ...(seconds ? { second: "2-digit" } : {}),
      hourCycle: "h23",
      timeZoneName: "short",
    }).format(new Date(timestampMs));
  }

  function parseBlockTime(value) {
    if (typeof value === "number" || (typeof value === "string" && /^\d+(\.\d+)?$/.test(value.trim()))) {
      const numeric = Number(value);
      return numeric > 0 && Number.isFinite(numeric)
        ? new Date(numeric >= 1e12 ? numeric : numeric * 1000).getTime()
        : NaN;
    }
    if (typeof value !== "string") return NaN;
    const text = value.trim();
    const utc = text.match(/^(\d{4}-\d{2}-\d{2})\s+(\d{2}:\d{2})(?::(\d{2}))?\s+UTC$/i);
    const normalized = utc ? `${utc[1]}T${utc[2]}:${utc[3] || "00"}Z` : text;
    // Require an explicit time zone; an operator's browser must not reinterpret
    // the publication's block timestamp as their own local time.
    if (!/(?:Z|[+-]\d{2}:?\d{2})$/i.test(normalized)) return NaN;
    const timestamp = Date.parse(normalized);
    if (utc && Number.isFinite(timestamp) && new Date(timestamp).toISOString().slice(0, 19) !== normalized.slice(0, 19)) return NaN;
    return timestamp;
  }

  function requiredNumber(value, field, { minimum = 0, maximum = Infinity, integer = false } = {}) {
    if ((typeof value !== "number" && typeof value !== "string") || String(value).trim() === "") {
      throw new Error(`Missing ${field}`);
    }
    const numeric = Number(value);
    if (!Number.isFinite(numeric) || numeric < minimum || numeric > maximum || (integer && !Number.isSafeInteger(numeric))) {
      throw new Error(`Invalid ${field}`);
    }
    return numeric;
  }

  function prepareSnapshot(payload) {
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw new Error("Invalid network snapshot");
    const height = requiredNumber(payload.block_height, "block height", { integer: true });
    const minedAt = parseBlockTime(payload.block_timestamp ?? payload.block_time ?? payload.block_time_utc
      ?? payload.latest_block_time ?? payload.latest_block_timestamp);
    if (!Number.isFinite(minedAt) || minedAt <= 0) throw new Error("Invalid block timestamp");
    const supply = requiredNumber(payload.supply_btc, "supply", { maximum: TARGET_SUPPLY_BTC });
    const subsidy = requiredNumber(payload.subsidy_btc, "subsidy", { maximum: 50 });
    const difficulty = requiredNumber(payload.difficulty, "difficulty", { minimum: Number.MIN_VALUE });
    const rawProjection = payload.projected_difficulty_adjustment_percent;
    const projection = rawProjection == null ? null : requiredNumber(rawProjection, "projected difficulty adjustment", {
      minimum: -75, maximum: 300,
    });
    const rawEpochStart = payload.difficulty_epoch_start_timestamp;
    let difficultyEpochStart = rawEpochStart == null ? null : parseBlockTime(rawEpochStart);
    if (rawEpochStart != null && (!Number.isFinite(difficultyEpochStart) || difficultyEpochStart > minedAt)) {
      throw new Error("Invalid difficulty epoch start timestamp");
    }
    // Older published payloads contain only the rounded projection. Invert its
    // pace formula until the next producer publication supplies the exact start.
    const intervals = height % DIFFICULTY_INTERVAL;
    if (difficultyEpochStart == null && intervals > 0 && projection != null && projection > -75 && projection < 300) {
      const elapsed = DIFFICULTY_INTERVAL * TARGET_BLOCK_SECONDS * intervals
        / ((DIFFICULTY_INTERVAL - 1) * (1 + projection / 100));
      difficultyEpochStart = minedAt - elapsed * 1000;
    }
    return { height, minedAt, supply, subsidy, difficulty, projection, difficultyEpochStart };
  }

  function projectedAdjustment(height, minedAt, epochStart) {
    const intervals = height % DIFFICULTY_INTERVAL;
    const elapsed = (minedAt - epochStart) / 1000;
    if (!intervals || !Number.isFinite(elapsed) || elapsed <= 0) return null;
    const targetTimespan = DIFFICULTY_INTERVAL * TARGET_BLOCK_SECONDS;
    const projectedTimespan = elapsed * (DIFFICULTY_INTERVAL - 1) / intervals;
    const bounded = Math.max(targetTimespan / 4, Math.min(targetTimespan * 4, projectedTimespan));
    return Math.round((targetTimespan / bounded - 1) * 10000) / 100;
  }

  function scheduledSupplySats(height) {
    // Integer satoshis, including genesis; stop when the subsidy reaches zero.
    // Taking a difference preserves the publication's actual issuance baseline.
    let remaining = height + 1;
    let total = 0;
    for (let epoch = 0; remaining > 0 && epoch < 33; epoch += 1) {
      const blocks = Math.min(remaining, HALVING_INTERVAL);
      total += blocks * Math.floor(5000000000 / (2 ** epoch));
      remaining -= blocks;
    }
    return total;
  }

  function installCurrentSnapshot() {
    if (isDashboardExportActive()) return;
    // A delayed publication must not rewind a live tip, including a confirmed
    // reorg below the previous tip. A publication beyond both can catch up an
    // unavailable feed. At equal heights keep the feed's actual block time.
    const useLive = liveTip && (!publishedSnapshot || (liveStatus === "live" && lastSnapshot?.source === "live")
      || liveTip.height >= publishedSnapshot.height || publishedSnapshot.height <= reorgCeiling);
    let candidate = publishedSnapshot && { ...publishedSnapshot, source: "published", supplyEstimated: false };
    if (useLive) {
      const supplyEstimated = !!publishedSnapshot && (liveTip.height !== publishedSnapshot.height
        || liveTip.minedAt !== publishedSnapshot.minedAt);
      const supplySats = publishedSnapshot ? Math.round(publishedSnapshot.supply * 100000000)
        + scheduledSupplySats(liveTip.height) - scheduledSupplySats(publishedSnapshot.height) : null;
      candidate = {
        height: liveTip.height, minedAt: liveTip.minedAt, id: liveTip.id,
        supply: supplySats === null ? null : Math.max(0, Math.min(TARGET_SUPPLY_BTC, supplySats / 100000000)),
        source: "live", supplyEstimated,
        difficultyEpochStart: publishedSnapshot
          && Math.floor(publishedSnapshot.height / DIFFICULTY_INTERVAL) === Math.floor(liveTip.height / DIFFICULTY_INTERVAL)
          ? publishedSnapshot.difficultyEpochStart : null,
      };
    }
    if (!candidate) return;
    const signature = JSON.stringify(candidate);
    if (signature !== lastSignature) {
      lastSnapshot = candidate;
      lastSignature = signature;
      renderSnapshot();
    }
    renderStatus();
  }

  const chainFeed = window.WSBBitcoinChainTip?.create({
    onTip(tip) {
      if (publishedSnapshot && tip.height < publishedSnapshot.height && !tip.reorg && reorgCeiling < 0
          && lastSnapshot?.source !== "live") return;
      if (tip.reorg) reorgCeiling = Math.max(reorgCeiling, liveTip?.height ?? -1, publishedSnapshot?.height ?? -1);
      else if (tip.height >= reorgCeiling) reorgCeiling = -1;
      liveTip = tip;
      installCurrentSnapshot();
    },
    onStatus(status) {
      // A hidden tab intentionally pauses its socket. Resuming is not an outage;
      // keep real failures visible through retries until the feed confirms recovery.
      if (status === "offline") liveUnavailable = true;
      else if (status === "live") liveUnavailable = false;
      liveStatus = status;
      installCurrentSnapshot();
      renderStatus();
    },
  });

  function setText(element, text) {
    if (element && element.textContent !== text) element.textContent = text;
  }

  function setProgress(element, percent, text) {
    if (!element) return;
    element.max = 100;
    element.value = Math.max(0, Math.min(100, percent));
    element.setAttribute("aria-valuetext", text);
  }

  function formatProgressPercent(percent, decimalPlaces) {
    // A rounded 100% would claim completion before the final block is mined.
    const factor = 10 ** decimalPlaces;
    return (Math.floor(Math.max(0, Math.min(100, percent)) * factor) / factor).toFixed(decimalPlaces);
  }

  function formatOrdinal(number) {
    const lastTwo = number % 100;
    const suffix = lastTwo >= 11 && lastTwo <= 13
      ? "th"
      : { 1: "st", 2: "nd", 3: "rd" }[number % 10] || "th";
    return `${number}${suffix}`;
  }

  function renderClock() {
    values.clock.textContent = formatTime(Date.now());
  }

  function formatBlockDuration(seconds) {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor(seconds / 60) % 60;
    const remainder = String(seconds % 60).padStart(2, "0");
    return hours
      ? `${hours}h ${String(minutes).padStart(2, "0")}m ${remainder}s`
      : `${minutes}m ${remainder}s`;
  }

  function renderBlockScale(scaleSeconds) {
    if (!blockMeter || !blockTicks) return;
    const spacing = TARGET_BLOCK_SECONDS / scaleSeconds * 100;
    blockMeter.style.setProperty("--block-tick-spacing", `${spacing}%`);
    [10, 20, 30, 40].forEach((minutes) => {
      const stop = Math.min(100, minutes * 60 / scaleSeconds * 100);
      blockMeter.style.setProperty(`--block-${minutes}m-stop`, `${stop}%`);
    });
    blockMeter.dataset.scaleSeconds = String(scaleSeconds);
    blockMeter.dataset.endTick = scaleSeconds % TARGET_BLOCK_SECONDS === 0 ? "1" : "0";
    const width = blockTicks.clientWidth;
    const intervals = Math.floor(scaleSeconds / TARGET_BLOCK_SECONDS);
    // CSS draws every ten-minute tick. Bound label count by available space so
    // even an old retained snapshot cannot create thousands of DOM elements.
    const stride = Math.max(1, Math.ceil(intervals / Math.max(1, Math.floor(width / 32))));
    const key = `${intervals}:${stride}:${width}`;
    if (key !== blockScaleLabelKey) {
      blockScaleLabelKey = key;
      blockTicks.replaceChildren();
      blockScaleLabels = [];
      for (let interval = 1; interval <= intervals; interval += stride) {
        const label = document.createElement("span");
        label.dataset.minutes = String(interval * 10);
        label.textContent = `${interval * 10}m`;
        blockTicks.appendChild(label);
        blockScaleLabels.push({ label, interval });
      }
      blockScaleLabels.forEach((entry) => { entry.width = entry.label.getBoundingClientRect().width; });
    }
    // The compact scale shares the value's bottom edge. Keep tick labels out
    // from under the height itself while retaining every tick mark on the bar.
    let previousRight = values.height.getBoundingClientRect().right - blockTicks.getBoundingClientRect().left;
    blockScaleLabels.forEach(({ label, interval, width: labelWidth }) => {
      const position = interval * TARGET_BLOCK_SECONDS / scaleSeconds * width;
      const left = Math.max(0, Math.min(width - labelWidth, position - labelWidth / 2));
      label.hidden = left < previousRight + 6;
      if (label.hidden) return;
      label.style.left = `${left}px`;
      previousRight = left + labelWidth;
    });
  }

  function renderBlockElapsed() {
    if (!lastSnapshot) return;
    // Miner timestamps can be ahead of this clock. Keep the sign until the
    // clock reaches that timestamp, then resume the normal elapsed scale.
    const seconds = Math.floor((Date.now() - lastSnapshot.minedAt) / 1000);
    const future = seconds < 0;
    const magnitude = Math.abs(seconds);
    const duration = formatBlockDuration(magnitude);
    if (!future || blockFutureTimestamp !== lastSnapshot.minedAt) {
      blockFutureTimestamp = future ? lastSnapshot.minedAt : null;
      blockFutureScaleSeconds = TARGET_BLOCK_SECONDS;
    }
    // Hold the negative scale so even a timestamp over ten minutes ahead has
    // a shrinking bar. Only expand it if the local clock moves farther back.
    if (future) blockFutureScaleSeconds = Math.max(blockFutureScaleSeconds, magnitude);
    const scaleSeconds = future ? blockFutureScaleSeconds : Math.max(TARGET_BLOCK_SECONDS, seconds);
    const progressFraction = magnitude / scaleSeconds;
    if (blockMeter) {
      // Reclaim the negative side as the countdown shrinks. The zero tick meets
      // the gray fill's right edge, then stays at the left edge for elapsed time.
      blockMeter.style.setProperty("--block-future-fraction", String(future ? progressFraction : 0));
      if (future) blockMeter.dataset.countdownScaleSeconds = String(blockFutureScaleSeconds);
      else delete blockMeter.dataset.countdownScaleSeconds;
    }
    // Measure tick labels after moving zero so they use the expanded positive axis.
    renderBlockScale(Math.max(TARGET_BLOCK_SECONDS, seconds));
    const state = future ? "future" : seconds >= LATE_BLOCK_SECONDS ? "late" : seconds >= TARGET_BLOCK_SECONDS * 2 ? "slow" : "normal";
    setText(blockElapsed, future ? `−${duration}` : `${duration} ago`);
    if (blockElapsed) {
      blockElapsed.dataset.elapsedState = state;
      blockElapsed.title = future
        ? `${duration} until the displayed block timestamp; it is ahead of this clock`
        : "Time elapsed since the displayed block's timestamp";
      blockElapsed.hidden = false;
    }
    if (blockProgress) {
      blockProgress.dataset.elapsedState = state;
      blockProgress.setAttribute("aria-label", future ? "Time until the displayed block timestamp" : "Time since the displayed block");
      setProgress(blockProgress, progressFraction * 100, future
        ? `${duration} until the displayed block timestamp; it is ahead of this clock. Gray extends left of zero; the bar and its space shrink as zero moves to the left edge; left-side full scale ${formatBlockDuration(scaleSeconds)}. Ticks to the right mark 10-minute elapsed intervals`
        : `${duration} since the displayed block; the bar grows right from zero; ticks every 10 minutes; full scale ${formatBlockDuration(scaleSeconds)}, not a countdown`);
    }
  }

  function renderStatus() {
    if (isDashboardExportActive()) return;
    let text;
    if (lastSnapshot) {
      const live = lastSnapshot.source === "live";
      const available = live ? !liveUnavailable : !refreshFailed;
      text = live ? (liveUnavailable ? "Live connection unavailable · showing last received block."
        : liveStatus === "live" ? "Live blocks · mempool.space"
          : liveStatus === "paused" ? "Live updates paused · showing last received block."
            : "Connecting to live blocks…")
        : refreshFailed ? "Refresh unavailable · showing last published block." : "";
      container.dataset.snapshotState = available ? "ready" : "cached";
      container.dataset.snapshotSource = lastSnapshot.source;
    } else {
      text = refreshFailed ? "Published snapshot unavailable. Retrying automatically." : "Loading published snapshot…";
      container.dataset.snapshotState = refreshFailed ? "error" : "loading";
    }
    setText(snapshotStatus, text);
  }

  function renderSnapshot() {
    if (!lastSnapshot) return;
    const { height, minedAt, supply, supplyEstimated, difficultyEpochStart } = lastSnapshot;
    const epoch = Math.floor(height / HALVING_INTERVAL) + 1;
    const nextHalving = epoch * HALVING_INTERVAL;
    const epochMined = (height % HALVING_INTERVAL) + 1;
    const halvingPercent = epochMined / HALVING_INTERVAL * 100;
    const difficultyEpoch = Math.floor(height / DIFFICULTY_INTERVAL) + 1;
    const difficultyMined = (height % DIFFICULTY_INTERVAL) + 1;
    const difficultyRemaining = difficultyEpoch * DIFFICULTY_INTERVAL - height;
    const difficultyPercent = difficultyMined / DIFFICULTY_INTERVAL * 100;
    const supplyPercent = supply === null ? 0 : supply / TARGET_SUPPLY_BTC * 100;
    const supplyText = supply === null ? "Waiting for published supply"
      : `${formatProgressPercent(supplyPercent, 2)}% of 21 million BTC${supplyEstimated ? " · estimated" : ""}`;
    const halvingText = `${formatProgressPercent(halvingPercent, 1)}% through the ${formatOrdinal(epoch)} epoch`;
    const difficultyText = `${difficultyRemaining.toLocaleString("en-US")} ${difficultyRemaining === 1 ? "block" : "blocks"} until adjustment`;
    const difficultyEpochText = `${formatProgressPercent(difficultyPercent, 1)}% through the ${formatOrdinal(difficultyEpoch)} diff. epoch`;
    const scheduleIntervals = height % DIFFICULTY_INTERVAL;
    const validSchedule = Number.isFinite(difficultyEpochStart) && difficultyEpochStart <= minedAt;
    const expectedIntervals = validSchedule ? Math.max(0, (minedAt - difficultyEpochStart) / (TARGET_BLOCK_SECONDS * 1000)) : null;
    const difference = expectedIntervals == null ? null : scheduleIntervals - expectedIntervals;
    const pace = difference == null ? "unknown" : Math.abs(difference) < 0.5 ? "on" : difference > 0 ? "ahead" : "behind";
    const scheduleText = pace === "ahead" ? `Ahead by ${Math.round(difference).toLocaleString("en-US")} blocks`
      : pace === "behind" ? `Behind by ${Math.round(-difference).toLocaleString("en-US")} blocks`
        : pace === "on" ? "On schedule" : "";
    const estimate = lastSnapshot.source === "published" && lastSnapshot.projection != null
      ? lastSnapshot.projection
      : validSchedule ? projectedAdjustment(height, minedAt, difficultyEpochStart) : null;

    values.height.textContent = height.toLocaleString("en-US");
    values.supply.textContent = supply === null ? "—" : compactSupply.matches
      ? `${(supply / 1000000).toFixed(3)}M`
      : supply.toLocaleString("en-US", { maximumFractionDigits: 0 });
    chips.height.title = `Block timestamp: ${formatTime(minedAt, { seconds: true })}`;
    chips.supply.title = supply === null ? supplyText
      : `${supply.toLocaleString("en-US", { minimumFractionDigits: 8, maximumFractionDigits: 8 })} BTC${supplyEstimated ? " (estimated from block subsidies)" : ""}`;
    chips.supply.setAttribute("aria-label", supply === null ? supplyText : `${chips.supply.title} issued`);
    setText(blockTime, formatTime(minedAt));
    if (blockTime) blockTime.dateTime = new Date(minedAt).toISOString();
    renderBlockElapsed();
    setText(supplyCaption, supplyText);
    setText(halvingRemaining, (nextHalving - height).toLocaleString("en-US"));
    setText(halvingCaption, halvingText);
    setText(difficultyRemainingValue, difficultyRemaining.toLocaleString("en-US"));
    if (difficultyRemainingValue) difficultyRemainingValue.title = `Next adjustment at block ${(difficultyEpoch * DIFFICULTY_INTERVAL).toLocaleString("en-US")}`;
    setText(difficultyEpochCaption, difficultyEpochText);
    if (difficultyMeter) {
      difficultyMeter.dataset.pace = pace;
      difficultyMeter.dataset.tooltip = scheduleText;
      const expectedPercent = expectedIntervals == null ? difficultyPercent
        : Math.max(0, Math.min(100, (expectedIntervals + 1) / DIFFICULTY_INTERVAL * 100));
      difficultyMeter.style.setProperty("--schedule-start", `${Math.min(difficultyPercent, expectedPercent)}%`);
      difficultyMeter.style.setProperty("--schedule-width", `${pace === "ahead" || pace === "behind" ? Math.abs(difficultyPercent - expectedPercent) : 0}%`);
    }
    if (difficultyEstimate && difficultyEstimateValue) {
      difficultyEstimate.hidden = estimate == null;
      if (estimate != null) {
        const trend = estimate > 0 ? "up" : estimate < 0 ? "down" : "flat";
        difficultyEstimate.dataset.trend = trend;
        difficultyEstimateValue.textContent = `${Math.abs(estimate).toFixed(2)}%`;
        const description = `Estimated next difficulty adjustment: ${trend === "up" ? "increase" : trend === "down" ? "decrease" : "no change"} ${Math.abs(estimate).toFixed(2)}%`;
        difficultyEstimate.setAttribute("aria-label", description);
        difficultyEstimate.title = description;
      }
    }
    setProgress(supplyProgress, supplyPercent, supplyText);
    setProgress(halvingProgress, halvingPercent, halvingText);
    setProgress(difficultyProgress, difficultyPercent, `${difficultyEpochText}; ${difficultyText}${scheduleText ? `; ${scheduleText.toLowerCase()} at the latest block` : ""}`);
  }

  async function refreshSnapshot() {
    if (isDashboardExportActive() || refreshInFlight) return;
    refreshInFlight = true;
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 15000);
    try {
      const response = await fetch(`${TOP_KPIS_URL}?_=${Date.now()}`, { cache: "no-store", signal: controller.signal });
      if (!response.ok) throw new Error(`Network snapshot request failed: ${response.status}`);
      const candidate = prepareSnapshot(await response.json());
      // Keep the latest complete published anchor; cached responses can trail
      // both a previous publication and the live connection.
      const matchesLive = liveTip && candidate.height === liveTip.height && candidate.minedAt === liveTip.minedAt;
      if (!publishedSnapshot || candidate.height >= publishedSnapshot.height || matchesLive) publishedSnapshot = candidate;
      refreshFailed = false;
      installCurrentSnapshot();
    } catch (_) {
      // Preserve the complete prior snapshot, including its published block time.
      refreshFailed = true;
    } finally {
      window.clearTimeout(timeout);
      refreshInFlight = false;
      renderStatus();
    }
  }

  function refreshForTimeZone() {
    renderTimeZoneOptions();
    renderClock();
    renderSnapshot();
    renderStatus();
  }

  function queueRefresh() {
    renderBlockElapsed();
    if (wakeTimer !== null) return;
    wakeTimer = window.setTimeout(() => {
      wakeTimer = null;
      void refreshSnapshot();
    }, 0);
  }

  const glossary = container.querySelector(".snapshot-glossary");
  const glossarySummary = glossary?.querySelector("summary");
  const glossaryPanel = glossary?.querySelector(".snapshot-glossary-panel");
  if (glossarySummary && glossaryPanel) {
    let expanded = glossary.open;
    let panelAnimation = null;
    glossarySummary.addEventListener("click", (event) => {
      event.preventDefault();
      expanded = !expanded;
      const startHeight = glossary.open ? glossaryPanel.getBoundingClientRect().height : 0;
      const startOpacity = glossary.open ? Number(getComputedStyle(glossaryPanel).opacity) : 0;
      panelAnimation?.cancel();
      panelAnimation = null;
      glossaryPanel.style.height = "";
      glossaryPanel.style.opacity = "";
      if (window.matchMedia("(prefers-reduced-motion: reduce)").matches || !glossaryPanel.animate) {
        glossary.open = expanded;
        return;
      }

      glossary.open = true;
      const endHeight = expanded ? glossaryPanel.scrollHeight : 0;
      panelAnimation = glossaryPanel.animate([
        { height: `${startHeight}px`, opacity: startOpacity },
        { height: `${endHeight}px`, opacity: expanded ? 1 : 0 },
      ], { duration: 280, easing: "cubic-bezier(.22, 1, .36, 1)", fill: "forwards" });
      const animation = panelAnimation;
      animation.onfinish = () => {
        if (panelAnimation !== animation) return;
        glossary.open = expanded;
        glossaryPanel.style.height = `${endHeight}px`;
        glossaryPanel.style.opacity = expanded ? "1" : "0";
        animation.cancel();
        glossaryPanel.style.height = "";
        glossaryPanel.style.opacity = "";
        panelAnimation = null;
      };
    });
  }

  timeZoneSelect.addEventListener("change", () => {
    setPreferredTimeZone(timeZoneSelect.value);
    refreshForTimeZone();
  });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
      renderClock();
      queueRefresh();
    }
  });
  ["focus", "pageshow", "online"].forEach((event) => window.addEventListener(event, queueRefresh));
  window.addEventListener(TZ_CHANGE_EVENT, refreshForTimeZone);
  compactSupply.addEventListener("change", renderSnapshot);
  window.addEventListener("resize", renderBlockElapsed);
  window.addEventListener("storage", (event) => {
    if (event.key === TZ_STORAGE_KEY) refreshForTimeZone();
  });
  refreshForTimeZone();
  void refreshSnapshot();
  chainFeed?.start();
  window.setInterval(() => {
    if (!isDashboardExportActive()) renderClock();
  }, 30000);
  window.setInterval(() => {
    if (document.visibilityState === "visible" && !isDashboardExportActive()) {
      installCurrentSnapshot();
      renderBlockElapsed();
    }
  }, 1000);
  window.setInterval(() => { void refreshSnapshot(); }, AUTO_REFRESH_MS);
})();
