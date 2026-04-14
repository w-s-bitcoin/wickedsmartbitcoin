/* ===========================
 * HOMEPAGE: BIP-110 KPI CHIPS
 * =========================== */
(function initHomepageBip110Kpis() {
  const TOP_KPIS_URL = "assets/top_kpis.json";
  const AUTO_REFRESH_MS = 60000;
  const FORCE_REFRESH_MS = 3600000;
  const FALLBACK_TIME_ZONE = "UTC";
  const TZ_STORAGE_KEY = "wicked_dashboard_timezone_v1";
  const TZ_CHANGE_EVENT = "wsb:timezonechange";

  const updatedEl = document.getElementById("homeBip110UpdatedKpi");
  const heightEl = document.getElementById("homeBip110HeightKpi");
  const epochEl = document.getElementById("homeBip110EpochKpi");
  const subsidyEl = document.getElementById("homeBip110SubsidyKpi");
  const difficultyEl = document.getElementById("homeBip110DifficultyKpi");
  const timeZoneSelect = document.getElementById("homeKpiTimeZoneSelect");
  if (!updatedEl || !heightEl || !epochEl || !subsidyEl || !difficultyEl || !timeZoneSelect) return;

  const updatedValueEl = updatedEl.querySelector(".chip-value") || updatedEl;
  const heightValueEl = heightEl.querySelector(".chip-value") || heightEl;
  const epochValueEl = epochEl.querySelector(".chip-value") || epochEl;
  const subsidyValueEl = subsidyEl.querySelector(".chip-value") || subsidyEl;
  const difficultyValueEl = difficultyEl.querySelector(".chip-value") || difficultyEl;

  let lastBlockHeight = NaN;
  let metadataSignature = "";
  let autoRefreshTimer = null;
  let refreshInFlight = false;
  let lastSuccessfulRefreshAt = 0;
  let lastEpoch = NaN;
  let lastEpochComplete = NaN;
  let lastSubsidyDisplay = "n/a";
  let lastDifficultyDisplay = "n/a";

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

  function getHalvingEpoch(height) {
    const numericHeight = Number(height);
    if (!Number.isFinite(numericHeight) || numericHeight < 0) return NaN;
    return Math.floor(numericHeight / 210000) + 1;
  }

  function getEpochComplete(height) {
    const numericHeight = Number(height);
    if (!Number.isFinite(numericHeight) || numericHeight < 0) return NaN;
    return (numericHeight % 210000) / 210000;
  }

  function formatEpochCompletePercent(completeRatio) {
    const numeric = Number(completeRatio);
    if (!Number.isFinite(numeric) || numeric < 0) return "n/a";
    const flooredOneDecimal = Math.floor(numeric * 1000) / 10;
    return `${flooredOneDecimal.toFixed(1)}%`;
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

  function setKpis({ height, epoch, epochComplete, subsidyBtc, difficultyDisplay }) {
    if (typeof height !== "undefined") {
      const numericHeight = Number(height);
      lastBlockHeight = Number.isFinite(numericHeight) ? numericHeight : NaN;
    }
    const displayTime = formatNowForSelectedTimeZone(new Date());

    updatedValueEl.textContent = displayTime;
    heightValueEl.textContent = Number.isFinite(lastBlockHeight)
      ? `${lastBlockHeight.toLocaleString()}`
      : "n/a";

    if (typeof epoch !== "undefined") {
      const parsedEpoch = Number(epoch);
      lastEpoch = Number.isFinite(parsedEpoch) ? parsedEpoch : NaN;
    } else if (Number.isFinite(lastBlockHeight)) {
      lastEpoch = getHalvingEpoch(lastBlockHeight);
    }

    if (typeof epochComplete !== "undefined") {
      const parsedEpochComplete = Number(epochComplete);
      lastEpochComplete = Number.isFinite(parsedEpochComplete) ? parsedEpochComplete : NaN;
    } else if (Number.isFinite(lastBlockHeight)) {
      lastEpochComplete = getEpochComplete(lastBlockHeight);
    }

    const epochPct = formatEpochCompletePercent(lastEpochComplete);
    epochValueEl.textContent = Number.isFinite(lastEpoch)
      ? (epochPct === "n/a"
        ? `${lastEpoch.toLocaleString()}`
        : `${lastEpoch.toLocaleString()} (${epochPct} Complete)`)
      : "n/a";

    if (typeof subsidyBtc !== "undefined") {
      const cleaned = String(subsidyBtc || "").trim();
      lastSubsidyDisplay = cleaned || "n/a";
    } else if (Number.isFinite(lastBlockHeight)) {
      lastSubsidyDisplay = formatSubsidyBtc(lastBlockHeight);
    }

    subsidyValueEl.textContent = lastSubsidyDisplay === "n/a"
      ? "n/a"
      : `${lastSubsidyDisplay} BTC`;

    if (typeof difficultyDisplay !== "undefined") {
      const cleaned = String(difficultyDisplay || "").trim();
      lastDifficultyDisplay = cleaned || "n/a";
    }

    difficultyValueEl.textContent = lastDifficultyDisplay === "n/a"
      ? "n/a"
      : `${lastDifficultyDisplay}`;
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

      setKpis({
        height: topKpis?.block_height,
        epoch: topKpis?.epoch,
        epochComplete: topKpis?.epoch_complete,
        subsidyBtc: topKpis?.subsidy_btc,
        difficultyDisplay,
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
})();
