/* ===========================
 * HOMEPAGE: BIP-110 KPI CHIPS
 * =========================== */
(function initHomepageBip110Kpis() {
  const METADATA_URL = "webapps/bip110_signaling/webapp_data/bip110_metadata.json";
  const AUTO_REFRESH_MS = 60000;
  const FORCE_REFRESH_MS = 3600000;
  const FALLBACK_TIME_ZONE = "UTC";
  const TZ_STORAGE_KEY = "wicked_dashboard_timezone_v1";
  const TZ_CHANGE_EVENT = "wsb:timezonechange";

  const updatedEl = document.getElementById("homeBip110UpdatedKpi");
  const heightEl = document.getElementById("homeBip110HeightKpi");
  const timeZoneSelect = document.getElementById("homeKpiTimeZoneSelect");
  if (!updatedEl || !heightEl || !timeZoneSelect) return;

  let lastBlockHeight = NaN;
  let metadataSignature = "";
  let autoRefreshTimer = null;
  let refreshInFlight = false;
  let lastSuccessfulRefreshAt = 0;

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

  function setKpis({ height }) {
    if (typeof height !== "undefined") {
      const numericHeight = Number(height);
      lastBlockHeight = Number.isFinite(numericHeight) ? numericHeight : NaN;
    }
    const displayTime = formatNowForSelectedTimeZone(new Date());

    updatedEl.textContent = displayTime;
    heightEl.textContent = Number.isFinite(lastBlockHeight)
      ? `Height ${lastBlockHeight.toLocaleString()}`
      : "Height n/a";
  }

  async function refreshFromMetadata() {
    if (refreshInFlight) return;
    refreshInFlight = true;
    try {
      const response = await fetch(`${METADATA_URL}?_=${Date.now()}`, { cache: "no-store" });
      if (!response.ok) throw new Error(`Metadata request failed: ${response.status}`);
      const metadata = await response.json();
      const nextSignature = `${String(metadata?.generated_utc || "").trim()}|${String(metadata?.source_block_height ?? "").trim()}`;
      metadataSignature = nextSignature;
      lastSuccessfulRefreshAt = Date.now();
      setKpis({
        height: metadata?.source_block_height,
      });
    } catch (_) {
      setKpis({});
    } finally {
      refreshInFlight = false;
    }
  }

  function triggerRefreshSoon(delayMs = 150) {
    window.setTimeout(() => {
      refreshFromMetadata();
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
        refreshFromMetadata();
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
  refreshFromMetadata();
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
