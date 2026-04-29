/* ===========================
 * HOMEPAGE: BIP-110 KPI CHIPS
 * =========================== */
(function initHomepageBip110Kpis() {
  const TOP_KPIS_URL = "assets/top_kpis.json";
  const AUTO_REFRESH_MS = 60000;
  const FORCE_REFRESH_MS = 3600000;
  const TARGET_SUPPLY_BTC = 20999999.9769;
  const FALLBACK_TIME_ZONE = "UTC";
  const TZ_STORAGE_KEY = "wicked_dashboard_timezone_v1";
  const TZ_CHANGE_EVENT = "wsb:timezonechange";

  const updatedEl = document.getElementById("homeBip110UpdatedKpi");
  const kpisContainerEl = document.getElementById("homeBip110Kpis");
  const heightEl = document.getElementById("homeBip110HeightKpi");
  const epochEl = document.getElementById("homeBip110EpochKpi");
  const subsidyEl = document.getElementById("homeBip110SubsidyKpi");
  const supplyEl = document.getElementById("homeBip110SupplyKpi");
  const targetHashrateEl = document.getElementById("homeBip110TargetHashrateKpi");
  const difficultyEpochEl = document.getElementById("homeBip110DifficultyEpochKpi");
  const difficultyEl = document.getElementById("homeBip110DifficultyKpi");
  const timeZoneSelect = document.getElementById("homeKpiTimeZoneSelect");
  if (!updatedEl || !kpisContainerEl || !heightEl || !epochEl || !subsidyEl || !supplyEl || !targetHashrateEl || !difficultyEpochEl || !difficultyEl || !timeZoneSelect) return;

  const updatedValueEl = updatedEl.querySelector(".chip-value") || updatedEl;
  const heightValueEl = heightEl.querySelector(".chip-value") || heightEl;
  const epochValueEl = epochEl.querySelector(".chip-value") || epochEl;
  const subsidyValueEl = subsidyEl.querySelector(".chip-value") || subsidyEl;
  const supplyValueEl = supplyEl.querySelector(".chip-value") || supplyEl;
  const targetHashrateValueEl = targetHashrateEl.querySelector(".chip-value") || targetHashrateEl;
  const difficultyEpochValueEl = difficultyEpochEl.querySelector(".chip-value") || difficultyEpochEl;
  const difficultyValueEl = difficultyEl.querySelector(".chip-value") || difficultyEl;

  let lastBlockHeight = NaN;
  let metadataSignature = "";
  let autoRefreshTimer = null;
  let refreshInFlight = false;
  let lastSuccessfulRefreshAt = 0;
  let lastEpoch = NaN;
  let lastEpochComplete = NaN;
  let lastBlockMinedAtMs = NaN;
  let lastSubsidyDisplay = "n/a";
  let lastSubsidySatsDisplay = "n/a";
  let lastSupplyDisplay = "n/a";
  let lastSupplyBtcRaw = "n/a";
  let lastSupplyTargetComplete = NaN;
  let lastTargetHashrateDisplay = "n/a";
  let lastTargetHexDisplay = "";
  let lastDifficultyDisplay = "n/a";
  let lastDifficultyPreciseDisplay = "n/a";
  let balanceRowsScheduled = false;

  function clearKpiRowBreaks() {
    kpisContainerEl.querySelectorAll(".kpi-row-break").forEach((node) => node.remove());
  }

  function balanceKpiRowsNow() {
    // Only clear any previously-inserted breaks; let flexbox wrap naturally.
    // Inserting zero-height break spans creates doubled row-gaps (gap above + gap below
    // the 0-height row), making spacing appear uneven. Pure flex-wrap + gap:8px is uniform.
    clearKpiRowBreaks();
  }

  function scheduleBalanceKpiRows() {
    if (balanceRowsScheduled) return;
    balanceRowsScheduled = true;
    window.requestAnimationFrame(() => {
      balanceRowsScheduled = false;
      balanceKpiRowsNow();
    });
  }

  function getPreferredTimeZone() {
    if (window.WSBDashboardTime?.getPreferredTimeZone) {
      return window.WSBDashboardTime.getPreferredTimeZone();
    }
    try {
      const raw = String(localStorage.getItem(TZ_STORAGE_KEY) || "").trim();
      if (!raw) return FALLBACK_TIME_ZONE;
      Intl.DateTimeFormat("en-US", { timeZone: raw }).format(new Date());
      return raw;
    } catch (_) {
      return FALLBACK_TIME_ZONE;
    }
  }

  function setPreferredTimeZone(value) {
    if (window.WSBDashboardTime?.setPreferredTimeZone) {
      return window.WSBDashboardTime.setPreferredTimeZone(value);
    }
    const normalized = String(value || "").trim() || FALLBACK_TIME_ZONE;
    try {
      localStorage.setItem(TZ_STORAGE_KEY, normalized);
    } catch (_) {
      // Ignore storage failures.
    }
    return normalized;
  }

  function getDashboardTimeZoneOptions() {
    if (window.WSBDashboardTime?.getTimeZoneOptions) {
      return window.WSBDashboardTime.getTimeZoneOptions();
    }
    return [{ value: FALLBACK_TIME_ZONE, label: FALLBACK_TIME_ZONE }];
  }

  function renderTimeZoneOptions() {
    const current = getPreferredTimeZone();
    const options = getDashboardTimeZoneOptions();
    timeZoneSelect.innerHTML = "";
    options.forEach(({ value, label }) => {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = label;
      option.selected = value === current;
      timeZoneSelect.appendChild(option);
    });
  }

  function formatNowForSelectedTimeZone(now = new Date()) {
    const parsed = now instanceof Date ? now : new Date(now);
    if (Number.isNaN(parsed.getTime())) return "n/a";

    const timeZone = getPreferredTimeZone();
    try {
      const formatter = new Intl.DateTimeFormat("en-CA", {
        timeZone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
        timeZoneName: "short",
      });
      const parts = formatter.formatToParts(parsed);
      const values = Object.create(null);
      parts.forEach((part) => {
        values[part.type] = part.value;
      });
      const shortName = String(values.timeZoneName || timeZone || FALLBACK_TIME_ZONE).trim();
      return `${values.year}-${values.month}-${values.day} ${values.hour}:${values.minute} (${shortName})`;
    } catch (_) {
      return "n/a";
    }
  }

  function parseBlockTimeToMs(value) {
    if (value == null) return NaN;
    if (value instanceof Date) return value.getTime();

    if (typeof value === "number") {
      if (!Number.isFinite(value) || value <= 0) return NaN;
      return value >= 1e12 ? value : value * 1000;
    }

    const text = String(value).trim();
    if (!text) return NaN;

    // Accept explicit UTC strings like "YYYY-MM-DD HH:MM UTC" or
    // "YYYY-MM-DD HH:MM:SS UTC" across browsers.
    const utcMatch = text.match(
      /^(\d{4})-(\d{2})-(\d{2})\s+(\d{2}):(\d{2})(?::(\d{2}))?\s+UTC$/i
    );
    if (utcMatch) {
      const [, year, month, day, hour, minute, second = "00"] = utcMatch;
      const parsedUtcMs = Date.UTC(
        Number(year),
        Number(month) - 1,
        Number(day),
        Number(hour),
        Number(minute),
        Number(second)
      );
      return Number.isFinite(parsedUtcMs) ? parsedUtcMs : NaN;
    }

    if (/^\d+(\.\d+)?$/.test(text)) {
      const parsed = Number(text);
      if (!Number.isFinite(parsed) || parsed <= 0) return NaN;
      return parsed >= 1e12 ? parsed : parsed * 1000;
    }

    const parsedDate = new Date(text);
    return Number.isNaN(parsedDate.getTime()) ? NaN : parsedDate.getTime();
  }

  function formatTimestampForSelectedTimeZone(timestampMs) {
    const parsed = new Date(Number(timestampMs));
    if (Number.isNaN(parsed.getTime())) return "n/a";

    const timeZone = getPreferredTimeZone();
    try {
      const formatter = new Intl.DateTimeFormat("en-CA", {
        timeZone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: false,
        timeZoneName: "short",
      });
      const parts = formatter.formatToParts(parsed);
      const values = Object.create(null);
      parts.forEach((part) => {
        values[part.type] = part.value;
      });
      const shortName = String(values.timeZoneName || timeZone || FALLBACK_TIME_ZONE).trim();
      return `${values.year}-${values.month}-${values.day} ${values.hour}:${values.minute}:${values.second} (${shortName})`;
    } catch (_) {
      return "n/a";
    }
  }

  function getHalvingEpoch(height) {
    const numericHeight = Number(height);
    if (!Number.isFinite(numericHeight) || numericHeight < 0) return NaN;
    return Math.floor(numericHeight / 210000) + 1;
  }

  function getEpochComplete(height) {
    const blocksMined = getEpochBlocksMinedInCurrentEpoch(height);
    if (!Number.isFinite(blocksMined)) return NaN;
    return blocksMined / 210000;
  }

  function getEpochBlocksMinedInCurrentEpoch(height) {
    const numericHeight = Number(height);
    if (!Number.isFinite(numericHeight) || numericHeight < 0) return NaN;
    return (numericHeight % 210000) + 1;
  }

  function getDifficultyEpoch(height) {
    const numericHeight = Number(height);
    if (!Number.isFinite(numericHeight) || numericHeight < 0) return NaN;
    return Math.floor(numericHeight / 2016) + 1;
  }

  function getDifficultyEpochBlocksMined(height) {
    const numericHeight = Number(height);
    if (!Number.isFinite(numericHeight) || numericHeight < 0) return NaN;
    return (numericHeight % 2016) + 1;
  }

  function getDifficultyEpochComplete(height) {
    const blocksMined = getDifficultyEpochBlocksMined(height);
    if (!Number.isFinite(blocksMined)) return NaN;
    return blocksMined / 2016;
  }

  function formatEpochCompletePercent(completeRatio) {
    const numeric = Number(completeRatio);
    if (!Number.isFinite(numeric) || numeric < 0) return "n/a";
    const flooredOneDecimal = Math.floor(numeric * 1000) / 10;
    return `${flooredOneDecimal.toFixed(1)}%`;
  }

  function formatEpochCompleteBlocks(completeRatio) {
    const numeric = Number(completeRatio);
    if (!Number.isFinite(numeric) || numeric < 0) return null;
    const clamped = Math.max(0, Math.min(1, numeric));
    return Math.floor(clamped * 210000);
  }

  function updateChipProgressRing(chipEl, completeRatio) {
    if (!chipEl) return;
    const progressSvgEl = chipEl.querySelector(".epoch-progress-ring");
    const progressMeterEl = chipEl.querySelector(".epoch-progress-meter");
    if (!progressSvgEl || !progressMeterEl) return;

    const width = Math.max(1, chipEl.clientWidth || chipEl.getBoundingClientRect().width || 0);
    const height = Math.max(1, chipEl.clientHeight || chipEl.getBoundingClientRect().height || 0);
    const strokeWidth = 1.8;
    const chipStyles = window.getComputedStyle(chipEl);
    const chipBorderWidth = Number.parseFloat(chipStyles.borderTopWidth || "1") || 1;
    const centerlineNudgePx = -1;
    const inset = (chipBorderWidth / 2) + centerlineNudgePx;

    const left = inset;
    const top = inset;
    const innerWidth = Math.max(1, width - inset * 2);
    const innerHeight = Math.max(1, height - inset * 2);
    const right = left + innerWidth;
    const bottom = top + innerHeight;
    const radius = Math.max(0, Math.min(innerHeight / 2, innerWidth / 2));
    const centerX = left + (innerWidth / 2);

    const d = [
      `M ${centerX} ${top}`,
      `H ${right - radius}`,
      `A ${radius} ${radius} 0 0 1 ${right} ${top + radius}`,
      `V ${bottom - radius}`,
      `A ${radius} ${radius} 0 0 1 ${right - radius} ${bottom}`,
      `H ${left + radius}`,
      `A ${radius} ${radius} 0 0 1 ${left} ${bottom - radius}`,
      `V ${top + radius}`,
      `A ${radius} ${radius} 0 0 1 ${left + radius} ${top}`,
      `H ${centerX}`,
    ].join(" ");

    const progressRatio = Number.isFinite(Number(completeRatio))
      ? Math.max(0, Math.min(1, Number(completeRatio)))
      : 0;

    progressSvgEl.setAttribute("viewBox", `0 0 ${width} ${height}`);
    progressMeterEl.setAttribute("d", d);
    progressMeterEl.setAttribute("stroke-width", String(strokeWidth));
    progressMeterEl.style.strokeDasharray = `${(progressRatio * 100).toFixed(3)} 100`;
  }

  function getBlockSubsidySats(height) {
    const numericHeight = Number(height);
    if (!Number.isFinite(numericHeight) || numericHeight < 0) return null;

    const halvings = Math.floor(numericHeight / 210000);
    const initialSubsidySats = 5_000_000_000n; // 50 BTC
    if (halvings >= 64) return 0n;
    return initialSubsidySats >> BigInt(halvings);
  }

  function formatSubsidyBtc(height) {
    const subsidySats = getBlockSubsidySats(height);
    if (subsidySats === null) return "n/a";

    const satsPerBtc = 100_000_000n;
    const whole = subsidySats / satsPerBtc;
    const fractional = subsidySats % satsPerBtc;
    if (fractional === 0n) return `${whole.toString()}`;

    const fractionText = fractional.toString().padStart(8, "0").replace(/0+$/, "");
    return `${whole.toString()}.${fractionText}`;
  }

  function formatDifficultyTrillions(value) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric) || numeric <= 0) return "n/a";
    return `${(numeric / 1e12).toFixed(2)}T`;
  }

  function formatDifficultyPrecise(value) {
    const normalizedRaw = String(value ?? "").trim();
    if (!normalizedRaw) return "n/a";

    const normalizedNumeric = Number.parseFloat(normalizedRaw.replaceAll(",", ""));
    if (!Number.isFinite(normalizedNumeric) || normalizedNumeric <= 0) {
      return normalizedRaw;
    }

    const hasDecimals = !Number.isInteger(normalizedNumeric);
    return normalizedNumeric.toLocaleString("en-US", {
      maximumFractionDigits: hasDecimals ? 8 : 0,
    });
  }

  function formatSupplyBtc(value) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric) || numeric < 0) return "n/a";

    return numeric.toLocaleString("en-US", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  }

  function formatSupplyBtcPrecise(value) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric) || numeric < 0) return "n/a";

    return numeric.toLocaleString("en-US", {
      minimumFractionDigits: 8,
      maximumFractionDigits: 8,
    });
  }

  function formatSupplyTargetTooltip(supplyBtcValue, completeRatio) {
    const precise = formatSupplyBtcPrecise(supplyBtcValue);
    const numeric = Number(completeRatio);
    if (!Number.isFinite(numeric) || numeric < 0) return precise !== "n/a" ? `${precise} BTC` : "n/a";
    const clamped = Math.max(0, Math.min(1, numeric));
    const flooredTwoDecimals = Math.floor(clamped * 10000) / 100;
    const pct = `(${flooredTwoDecimals.toFixed(2)}% of 21M BTC)`;
    return precise !== "n/a" ? `${precise} BTC\n${pct}` : pct;
  }

  function formatTargetHashrate(value) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric) || numeric <= 0) return "n/a";

    const units = ["H/s", "kH/s", "MH/s", "GH/s", "TH/s", "PH/s", "EH/s", "ZH/s", "YH/s"];
    let scaled = numeric;
    let unitIndex = 0;
    while (scaled >= 1000 && unitIndex < units.length - 1) {
      scaled /= 1000;
      unitIndex += 1;
    }
    return `${scaled.toFixed(2)} ${units[unitIndex]}`;
  }

  function formatTargetHashrateTooltip(targetHex) {
    const cleaned = String(targetHex || "").trim();
    if (!cleaned) return "n/a";
    const hex = cleaned.toLowerCase().replace(/^0x/, "");
    if (!hex || !/^[0-9a-f]+$/.test(hex)) return "n/a";

    const normalized = hex.padStart(64, "0");
    const leadingZerosMatch = normalized.match(/^0+/);
    const leadingZeros = leadingZerosMatch ? leadingZerosMatch[0].length : 0;
    const compressedRaw = normalized.slice(leadingZeros) || "0";

    return `0x${compressedRaw}\n(${leadingZeros} leading zeros)`;
  }

  function setKpis({
    height,
    blockMinedAt,
    epoch,
    epochComplete,
    subsidyBtc,
    subsidySats,
    supplyBtc,
    supplyTargetComplete,
    targetHashrate,
    targetHex,
    difficultyDisplay,
    difficultyPreciseDisplay,
  }) {
    if (typeof height !== "undefined") {
      const numericHeight = Number(height);
      lastBlockHeight = Number.isFinite(numericHeight) ? numericHeight : NaN;
    }
    const displayTime = formatNowForSelectedTimeZone(new Date());

    updatedValueEl.textContent = displayTime;
    heightValueEl.textContent = Number.isFinite(lastBlockHeight)
      ? `${lastBlockHeight.toLocaleString()}`
      : "n/a";

    if (typeof blockMinedAt !== "undefined") {
      const parsedBlockMinedAt = parseBlockTimeToMs(blockMinedAt);
      lastBlockMinedAtMs = Number.isFinite(parsedBlockMinedAt) ? parsedBlockMinedAt : NaN;
    }

    if (heightEl) {
      heightEl.setAttribute(
        "data-kpi-tooltip",
        Number.isFinite(lastBlockMinedAtMs)
          ? formatTimestampForSelectedTimeZone(lastBlockMinedAtMs)
          : "n/a"
      );
    }

    if (typeof epoch !== "undefined") {
      const parsedEpoch = Number(epoch);
      lastEpoch = Number.isFinite(parsedEpoch) ? parsedEpoch : NaN;
    } else if (Number.isFinite(lastBlockHeight)) {
      lastEpoch = getHalvingEpoch(lastBlockHeight);
    }

    if (Number.isFinite(lastBlockHeight)) {
      lastEpochComplete = getEpochComplete(lastBlockHeight);
    } else if (typeof epochComplete !== "undefined") {
      const parsedEpochComplete = Number(epochComplete);
      lastEpochComplete = Number.isFinite(parsedEpochComplete) ? parsedEpochComplete : NaN;
    }

    const epochPct = formatEpochCompletePercent(lastEpochComplete);
    const epochBlocksComplete = Number.isFinite(lastBlockHeight)
      ? getEpochBlocksMinedInCurrentEpoch(lastBlockHeight)
      : formatEpochCompleteBlocks(lastEpochComplete);
    epochValueEl.textContent = Number.isFinite(lastEpoch)
      ? `${lastEpoch.toLocaleString()}`
      : "n/a";

    if (epochEl) {
      updateChipProgressRing(epochEl, lastEpochComplete);
      epochEl.setAttribute(
        "data-epoch-tooltip",
        Number.isFinite(epochBlocksComplete)
          ? `${epochBlocksComplete.toLocaleString()} / 210,000 (${epochPct})`
          : "n/a"
      );
    }

    const difficultyEpoch = Number.isFinite(lastBlockHeight)
      ? getDifficultyEpoch(lastBlockHeight)
      : NaN;
    const difficultyEpochComplete = Number.isFinite(lastBlockHeight)
      ? getDifficultyEpochComplete(lastBlockHeight)
      : NaN;
    const difficultyEpochBlocksMined = Number.isFinite(lastBlockHeight)
      ? getDifficultyEpochBlocksMined(lastBlockHeight)
      : NaN;
    const difficultyEpochPct = formatEpochCompletePercent(difficultyEpochComplete);

    difficultyEpochValueEl.textContent = Number.isFinite(difficultyEpoch)
      ? `${difficultyEpoch.toLocaleString()}`
      : "n/a";

    if (difficultyEpochEl) {
      updateChipProgressRing(difficultyEpochEl, difficultyEpochComplete);
      difficultyEpochEl.setAttribute(
        "data-epoch-tooltip",
        Number.isFinite(difficultyEpochBlocksMined)
          ? `${difficultyEpochBlocksMined.toLocaleString()} / 2,016 (${difficultyEpochPct})`
          : "n/a"
      );
    }

    if (typeof subsidyBtc !== "undefined") {
      const cleaned = String(subsidyBtc || "").trim();
      lastSubsidyDisplay = cleaned || "n/a";
    } else if (Number.isFinite(lastBlockHeight)) {
      lastSubsidyDisplay = formatSubsidyBtc(lastBlockHeight);
    }

    subsidyValueEl.textContent = lastSubsidyDisplay === "n/a"
      ? "n/a"
      : `${lastSubsidyDisplay} BTC`;

    if (typeof subsidySats !== "undefined") {
      const rawText = String(subsidySats || "").trim();
      if (rawText) {
        if (/^\d+$/.test(rawText)) {
          lastSubsidySatsDisplay = Number(rawText).toLocaleString();
        } else {
          lastSubsidySatsDisplay = rawText;
        }
      } else {
        lastSubsidySatsDisplay = "n/a";
      }
    } else if (Number.isFinite(lastBlockHeight)) {
      const subsidySatsComputed = getBlockSubsidySats(lastBlockHeight);
      lastSubsidySatsDisplay = subsidySatsComputed === null
        ? "n/a"
        : subsidySatsComputed.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
    }

    if (subsidyEl) {
      subsidyEl.setAttribute(
        "data-kpi-tooltip",
        lastSubsidySatsDisplay === "n/a"
          ? "n/a"
          : `${lastSubsidySatsDisplay} sats`
      );
    }

    if (typeof supplyBtc !== "undefined") {
      lastSupplyDisplay = formatSupplyBtc(supplyBtc);
      lastSupplyBtcRaw = supplyBtc;
    }

    if (typeof supplyTargetComplete !== "undefined") {
      const parsedSupplyTargetComplete = Number(supplyTargetComplete);
      lastSupplyTargetComplete = Number.isFinite(parsedSupplyTargetComplete)
        ? parsedSupplyTargetComplete
        : NaN;
    } else if (typeof supplyBtc !== "undefined") {
      const parsedSupplyBtc = Number(supplyBtc);
      lastSupplyTargetComplete = Number.isFinite(parsedSupplyBtc)
        ? (parsedSupplyBtc / TARGET_SUPPLY_BTC)
        : NaN;
    }

    supplyValueEl.textContent = lastSupplyDisplay === "n/a"
      ? "n/a"
      : `${lastSupplyDisplay} BTC`;

    if (supplyEl) {
      updateChipProgressRing(supplyEl, lastSupplyTargetComplete);
      supplyEl.setAttribute("data-epoch-tooltip", formatSupplyTargetTooltip(lastSupplyBtcRaw, lastSupplyTargetComplete));
    }

    if (typeof targetHashrate !== "undefined") {
      lastTargetHashrateDisplay = formatTargetHashrate(targetHashrate);
    }

    if (typeof targetHex !== "undefined") {
      lastTargetHexDisplay = String(targetHex || "").trim();
    }

    targetHashrateValueEl.textContent = lastTargetHashrateDisplay;
    if (targetHashrateEl) {
      targetHashrateEl.setAttribute("data-kpi-tooltip", formatTargetHashrateTooltip(lastTargetHexDisplay));
    }

    if (typeof difficultyDisplay !== "undefined") {
      const cleaned = String(difficultyDisplay || "").trim();
      lastDifficultyDisplay = cleaned || "n/a";
    }

    if (typeof difficultyPreciseDisplay !== "undefined") {
      const cleaned = String(difficultyPreciseDisplay || "").trim();
      lastDifficultyPreciseDisplay = cleaned || "n/a";
    }

    difficultyValueEl.textContent = lastDifficultyDisplay === "n/a"
      ? "n/a"
      : `${lastDifficultyDisplay}`;

    if (difficultyEl) {
      difficultyEl.setAttribute("data-kpi-tooltip", lastDifficultyPreciseDisplay);
    }

    scheduleBalanceKpiRows();
  }

  async function refreshFromTopKpis() {
    if (refreshInFlight) return;
    refreshInFlight = true;
    try {
      const response = await fetch(`${TOP_KPIS_URL}?_=${Date.now()}`, { cache: "no-store" });
      if (!response.ok) throw new Error(`Top KPI request failed: ${response.status}`);
      const topKpis = await response.json();
      const nextSignature = `${String(topKpis?.block_height ?? "").trim()}|${String(topKpis?.epoch ?? "").trim()}|${String(topKpis?.epoch_complete ?? "").trim()}|${String(topKpis?.subsidy_btc ?? "").trim()}|${String(topKpis?.difficulty_trillions ?? "").trim()}`;
      metadataSignature = nextSignature;
      lastSuccessfulRefreshAt = Date.now();

      const difficultyDisplay = String(topKpis?.difficulty_display || "").trim() || (
        Number.isFinite(Number(topKpis?.difficulty_trillions))
          ? `${Number(topKpis.difficulty_trillions).toFixed(2)}T`
          : formatDifficultyTrillions(topKpis?.difficulty)
      );
      const difficultyPreciseDisplay = String(topKpis?.difficulty_precise || "").trim() || (
        formatDifficultyPrecise(topKpis?.difficulty)
      );

      setKpis({
        height: topKpis?.block_height,
        blockMinedAt: topKpis?.block_timestamp
          ?? topKpis?.block_time
          ?? topKpis?.block_time_utc
          ?? topKpis?.latest_block_time
          ?? topKpis?.latest_block_timestamp,
        epoch: topKpis?.epoch,
        epochComplete: topKpis?.epoch_complete,
        subsidyBtc: topKpis?.subsidy_btc,
        subsidySats: topKpis?.subsidy_sats,
        supplyBtc: topKpis?.supply_btc,
        supplyTargetComplete: topKpis?.supply_target_complete,
        targetHashrate: topKpis?.target_hashrate_hps,
        targetHex: topKpis?.target_hex,
        difficultyDisplay,
        difficultyPreciseDisplay,
      });
    } catch (_) {
      setKpis({});
    } finally {
      refreshInFlight = false;
    }
  }

  function triggerRefreshSoon(delayMs = 150) {
    window.setTimeout(() => {
      refreshFromTopKpis();
    }, delayMs);
  }

  function setupRefreshWakeEvents() {
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") {
        triggerRefreshSoon(0);
      }
    });

    window.addEventListener("focus", () => {
      triggerRefreshSoon(0);
    });

    window.addEventListener("pageshow", () => {
      triggerRefreshSoon(0);
    });

    window.addEventListener("online", () => {
      triggerRefreshSoon(0);
    });
  }

  function startAutoRefresh() {
    if (autoRefreshTimer) {
      window.clearInterval(autoRefreshTimer);
    }
    autoRefreshTimer = window.setInterval(() => {
      const now = Date.now();
      const shouldForceRefresh = (now - lastSuccessfulRefreshAt) >= FORCE_REFRESH_MS;
      if (shouldForceRefresh || metadataSignature) {
        refreshFromTopKpis();
      }
    }, AUTO_REFRESH_MS);
  }

  function refreshForTimezoneOnly() {
    renderTimeZoneOptions();
    setKpis({});
  }

  timeZoneSelect.addEventListener("change", () => {
    setPreferredTimeZone(timeZoneSelect.value);
    refreshForTimezoneOnly();
  });

  renderTimeZoneOptions();
  refreshFromTopKpis();
  setKpis({});
  window.setInterval(() => setKpis({}), 30000);
  setupRefreshWakeEvents();
  startAutoRefresh();

  window.addEventListener(TZ_CHANGE_EVENT, refreshForTimezoneOnly);
  window.addEventListener("storage", (event) => {
    if (event.key !== TZ_STORAGE_KEY) return;
    refreshForTimezoneOnly();
  });
  window.addEventListener("resize", () => {
    setKpis({});
    scheduleBalanceKpiRows();
  });
})();
