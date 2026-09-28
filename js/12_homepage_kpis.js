/* ===========================
 * HOMEPAGE: PUBLISHED NETWORK SNAPSHOT
 * =========================== */
(function initHomepageNetworkSnapshot() {
  const TOP_KPIS_URL = "assets/top_kpis.json";
  const AUTO_REFRESH_MS = 60000;
  const TARGET_SUPPLY_BTC = 21000000;
  const HALVING_INTERVAL = 210000;
  const DIFFICULTY_INTERVAL = 2016;
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
  const supplyProgress = byId("homeKpiSupplyProgress");
  const supplyCaption = byId("homeKpiSupplyCaption");
  const halvingRemaining = byId("homeKpiHalvingRemaining");
  const halvingProgress = byId("homeKpiHalvingProgress");
  const halvingCaption = byId("homeKpiHalvingCaption");
  const difficultyRemainingValue = byId("homeKpiDifficultyRemaining");
  const difficultyProgress = byId("homeKpiDifficultyProgress");
  const difficultyCaption = byId("homeKpiDifficultyCaption");
  const compactSupply = window.matchMedia("(max-width: 480px)");

  let lastSnapshot = null;
  let lastSignature = "";
  let refreshInFlight = false;
  let refreshFailed = false;
  let wakeTimer = null;

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
    return { height, minedAt, supply, subsidy, difficulty, projection };
  }

  function setText(element, text) {
    if (element) element.textContent = text;
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

  function renderStatus() {
    let text;
    if (lastSnapshot) {
      text = refreshFailed ? "Refresh unavailable · showing last published block." : "";
      container.dataset.snapshotState = refreshFailed ? "cached" : "ready";
    } else {
      text = refreshFailed ? "Published snapshot unavailable. Retrying automatically." : "Loading published snapshot…";
      container.dataset.snapshotState = refreshFailed ? "error" : "loading";
    }
    setText(snapshotStatus, text);
  }

  function renderSnapshot() {
    if (!lastSnapshot) return;
    const { height, minedAt, supply } = lastSnapshot;
    const epoch = Math.floor(height / HALVING_INTERVAL) + 1;
    const nextHalving = epoch * HALVING_INTERVAL;
    const epochMined = (height % HALVING_INTERVAL) + 1;
    const halvingPercent = epochMined / HALVING_INTERVAL * 100;
    const difficultyEpoch = Math.floor(height / DIFFICULTY_INTERVAL) + 1;
    const difficultyMined = (height % DIFFICULTY_INTERVAL) + 1;
    const difficultyRemaining = difficultyEpoch * DIFFICULTY_INTERVAL - height;
    const difficultyPercent = difficultyMined / DIFFICULTY_INTERVAL * 100;
    const supplyPercent = supply / TARGET_SUPPLY_BTC * 100;
    const supplyText = `${formatProgressPercent(supplyPercent, 2)}% of 21 million BTC`;
    const halvingText = `${formatProgressPercent(halvingPercent, 1)}% through the ${formatOrdinal(epoch)} epoch`;
    const difficultyText = `${difficultyRemaining.toLocaleString("en-US")} ${difficultyRemaining === 1 ? "block" : "blocks"} until adjustment`;
    const difficultyEpochText = `${formatProgressPercent(difficultyPercent, 1)}% through the ${formatOrdinal(difficultyEpoch)} diff. epoch`;

    values.height.textContent = height.toLocaleString("en-US");
    values.supply.textContent = compactSupply.matches
      ? `${(supply / 1000000).toFixed(3)}M`
      : supply.toLocaleString("en-US", { maximumFractionDigits: 0 });
    chips.height.title = `Block timestamp: ${formatTime(minedAt, { seconds: true })}`;
    chips.supply.title = `${supply.toLocaleString("en-US", { minimumFractionDigits: 8, maximumFractionDigits: 8 })} BTC`;
    chips.supply.setAttribute("aria-label", `${chips.supply.title} issued`);
    setText(blockTime, formatTime(minedAt));
    if (blockTime) blockTime.dateTime = new Date(minedAt).toISOString();
    setText(supplyCaption, supplyText);
    setText(halvingRemaining, (nextHalving - height).toLocaleString("en-US"));
    setText(halvingCaption, halvingText);
    setText(difficultyRemainingValue, difficultyRemaining.toLocaleString("en-US"));
    if (difficultyRemainingValue) difficultyRemainingValue.title = `Next adjustment at block ${(difficultyEpoch * DIFFICULTY_INTERVAL).toLocaleString("en-US")}`;
    setText(difficultyCaption, difficultyEpochText);
    setProgress(supplyProgress, supplyPercent, supplyText);
    setProgress(halvingProgress, halvingPercent, halvingText);
    setProgress(difficultyProgress, difficultyPercent, `${difficultyEpochText}; ${difficultyText}`);
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
      const signature = JSON.stringify(candidate);
      if (signature !== lastSignature) {
        lastSnapshot = candidate;
        lastSignature = signature;
        renderSnapshot();
      }
      refreshFailed = false;
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
  window.addEventListener("storage", (event) => {
    if (event.key === TZ_STORAGE_KEY) refreshForTimeZone();
  });
  refreshForTimeZone();
  void refreshSnapshot();
  window.setInterval(() => {
    if (!isDashboardExportActive()) renderClock();
  }, 30000);
  window.setInterval(() => { void refreshSnapshot(); }, AUTO_REFRESH_MS);
})();
