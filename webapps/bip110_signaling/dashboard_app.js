    /* ── theme sync ─────────────────────────────────────────────────── */
    (function () {
      const THEME_KEY = 'quantum-research-dashboard-theme';
      function applyTheme(t) {
        document.documentElement.dataset.theme = (t === 'light' ? 'light' : 'dark');
        document.dispatchEvent(new CustomEvent('dashboard-theme-change'));
      }
      try {
        const stored = localStorage.getItem(THEME_KEY);
        applyTheme(stored === 'light' || stored === 'dark'
          ? stored
          : (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'));
      } catch (_) { applyTheme('dark'); }
      window.addEventListener('message', function (e) {
        if (e.data && e.data.type === 'quantum-dashboard-theme') applyTheme(e.data.theme);
      });
      window.addEventListener('storage', function (e) {
        if (e.key === THEME_KEY && (e.newValue === 'light' || e.newValue === 'dark')) applyTheme(e.newValue);
      });
    }());
    document.addEventListener('dashboard-theme-change', function () {
      if (typeof renderAll === 'function') renderAll();
    });
    /* ────────────────────────────────────────────────────────────────── */
    const AUTO_REFRESH_MS = 60000;
    const FORCE_REFRESH_MS = 3600000;
    const CONTROLS_STORAGE_KEY = "bip110_signaling_controls_v3";
    const PANEL_RESIZE_MIN_HEIGHT = 220;
    const PANEL_RESIZE_VIEWPORT_PAD = 24;
    const DASHBOARD_TIME = window.WSBDashboardTime || null;
    const SHARE_STATE_PARAM = "state";
    const LOCAL_RUNTIME_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);
    const IS_LOCAL_RUNTIME = LOCAL_RUNTIME_HOSTS.has(window.location.hostname);

    const state = {
      staticData: null,
      dynamicData: null,
      data: null,
      dataSignature: null,
      preResetStateSnapshot: null,
      suppressResetSnapshotClear: false,
      autoRefreshTimer: null,
      phasedLoadToken: 0,
      refreshInFlight: false,
      lastSuccessfulRefreshAt: 0,
      controlsEnabled: true,
      pinnedTooltip: null,
      hoverTooltip: null,
      controls: {
        stripes: true,
        stripesExplicit: false,
        markers: true,
        labels: true,
        showSegwit: false,
        showBip110: true,
        panelsSwapped: false,
      },
      manualPanelHeights: {
        segwit: null,
        bip110: null,
      },
      manualPanelHeightRatios: {
        segwit: null,
        bip110: null,
      },
      filledPanels: {
        segwit: false,
        bip110: false,
      },
      lastVisibleCount: -1,
      hitMaps: {
        segwit: [],
        bip110: [],
      },
      releaseMaps: {
        segwit: [],
        bip110: [],
      },
      stripeMaps: {
        segwit: [],
        bip110: [],
      },
      barMaps: {
        segwit: [],
        bip110: [],
      },
      deferredEnhancementRaf: {
        segwit: null,
        bip110: null,
      },
      dpr: Math.max(1, window.devicePixelRatio || 1),
      timeZone: DASHBOARD_TIME?.getPreferredTimeZone?.() || "UTC",
    };

    const segwitCanvas = document.getElementById("segwitCanvas");
    const bip110Canvas = document.getElementById("bip110Canvas");
    const segwitPanel = document.getElementById("segwitPanel");
    const bip110Panel = document.getElementById("bip110Panel");
    const segwitCanvasBox = document.getElementById("segwitCanvasBox");
    const bip110CanvasBox = document.getElementById("bip110CanvasBox");
    const segwitLoader = document.getElementById("segwitLoader");
    const bip110Loader = document.getElementById("bip110Loader");
    const mainWrap = document.getElementById("mainWrap");
    const topbar = document.getElementById("topbar");
    const statusChips = document.getElementById("statusChips");
    const tooltip = document.getElementById("tooltip");
    const vizInfoBtn = document.getElementById("vizInfoBtn");
    const segwitResizeHandle = document.getElementById("segwitResizeHandle");
    const bip110ResizeHandle = document.getElementById("bip110ResizeHandle");
    const segwitFillHeightBtn = document.getElementById("segwitFillHeightBtn");
    const bip110FillHeightBtn = document.getElementById("bip110FillHeightBtn");
    const swapPanelsBtn = document.getElementById("swapPanelsBtn");
    const dashboardControlLock = window.WSBDashboardShared?.createDashboardControlLock?.({
      topbar,
      extraControls: [
        segwitResizeHandle,
        bip110ResizeHandle,
        segwitFillHeightBtn,
        bip110FillHeightBtn,
      ],
    });

    function setControlsEnabled(enabled) {
      state.controlsEnabled = Boolean(enabled);
      if (dashboardControlLock) {
        dashboardControlLock.setEnabled(enabled);
        updateResetButtonUi();
        return;
      }

      topbar.classList.toggle("ui-locked", !enabled);

      [
        vizInfoBtn,
        swapPanelsBtn,
        segwitFillHeightBtn,
        bip110FillHeightBtn,
        segwitResizeHandle,
        bip110ResizeHandle,
        ...topbar.querySelectorAll('input[type="checkbox"]'),
      ].filter(Boolean).forEach((control) => {
        control.disabled = !enabled;
      });

      updateResetButtonUi();
    }

    function setPanelLoadersVisible(visible) {
      [segwitLoader, bip110Loader].forEach((loader) => {
        if (!loader) return;
        loader.classList.toggle("hidden", !visible);
      });
    }

    function setPanelLoaderVisible(key, visible) {
      const loader = key === "segwit" ? segwitLoader : bip110Loader;
      if (!loader) return;
      loader.classList.toggle("hidden", !visible);
    }

    function getPreferredDashboardTimeZone() {
      if (!DASHBOARD_TIME?.getPreferredTimeZone) return state.timeZone || "UTC";
      return DASHBOARD_TIME.getPreferredTimeZone();
    }

    function setPreferredDashboardTimeZone(value) {
      if (!DASHBOARD_TIME?.setPreferredTimeZone) {
        state.timeZone = String(value || "UTC").trim() || "UTC";
        return state.timeZone;
      }
      state.timeZone = DASHBOARD_TIME.setPreferredTimeZone(value);
      return state.timeZone;
    }

    function getDashboardTimeZoneOptions() {
      if (!DASHBOARD_TIME?.getTimeZoneOptions) {
        return [{ value: "UTC", label: "UTC" }];
      }
      return DASHBOARD_TIME.getTimeZoneOptions();
    }

    function formatGeneratedForSelectedTimeZone(value) {
      if (!DASHBOARD_TIME?.formatUtcTimestamp) {
        return formatGeneratedUtc(value);
      }
      return DASHBOARD_TIME.formatUtcTimestamp(value, state.timeZone || "UTC").text;
    }

    function formatGeneratedDateTimeForSelectedTimeZone(value) {
      const raw = String(value || "").trim();
      if (!raw) return "n/a";

      const parsed = new Date(raw);
      if (Number.isNaN(parsed.getTime())) {
        return raw;
      }

      const timeZone = state.timeZone || "UTC";
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
        const shortName = String(values.timeZoneName || timeZone || "UTC").trim();
        return `${values.year}-${values.month}-${values.day} ${values.hour}:${values.minute} (${shortName})`;
      } catch (_) {
        return `${formatGeneratedUtc(value).replace(/\s+UTC$/, "")} (${timeZone})`;
      }
    }

    function bindTimeZoneChipEvents() {
      const select = document.getElementById("updatedTimeZoneSelect");
      if (!select) return;

      select.addEventListener("change", () => {
        setPreferredDashboardTimeZone(select.value);
        if (state.data) {
          setStatus(state.data);
        }
      });
    }

    function nextPaint() {
      return new Promise((resolve) => {
        requestAnimationFrame(() => resolve());
      });
    }

    function applyEmbedModalTopClearance() {
      window.WSBDashboardShared?.applyEmbeddedModalTopClearance?.();
    }

    applyEmbedModalTopClearance();

    function parseCsv(text) {
      const rows = [];
      let row = [];
      let value = "";
      let inQuotes = false;

      for (let i = 0; i < text.length; i += 1) {
        const c = text[i];
        const n = text[i + 1];

        if (c === '"') {
          if (inQuotes && n === '"') {
            value += '"';
            i += 1;
          } else {
            inQuotes = !inQuotes;
          }
          continue;
        }

        if (c === "," && !inQuotes) {
          row.push(value);
          value = "";
          continue;
        }

        if ((c === "\n" || c === "\r") && !inQuotes) {
          if (c === "\r" && n === "\n") i += 1;
          row.push(value);
          value = "";
          if (row.length > 1 || row[0] !== "") {
            rows.push(row);
          }
          row = [];
          continue;
        }

        value += c;
      }

      if (value.length > 0 || row.length > 0) {
        row.push(value);
        rows.push(row);
      }

      if (!rows.length) return [];
      const headers = rows[0];
      return rows.slice(1).map((r) => {
        const o = {};
        headers.forEach((h, idx) => {
          o[h] = (r[idx] ?? "").trim();
        });
        return o;
      });
    }

    function parseMaybeNumber(value) {
      if (value === "" || value == null) return null;
      const n = Number(value);
      return Number.isFinite(n) ? n : value;
    }

    function castRows(rows) {
      return rows.map((row) => {
        const casted = {};
        Object.entries(row).forEach(([k, v]) => {
          casted[k] = parseMaybeNumber(v);
        });
        return casted;
      });
    }

    function decodeBlockPoints(buffer, startHeight, periodSize) {
      const view = new DataView(buffer);
      const recordSize = 5;
      const count = Math.floor(view.byteLength / recordSize);
      const rows = new Array(count);

      for (let i = 0; i < count; i += 1) {
        const offset = i * recordSize;
        const height = view.getUint32(offset, true);
        const isSignaling = view.getUint8(offset + 4);
        const rel = height - startHeight;
        const period = Math.floor(rel / periodSize) + 1;
        const yInPeriod = ((rel % periodSize) + periodSize) % periodSize;

        rows[i] = {
          height,
          is_signaling: isSignaling,
          period,
          y_in_period: yInPeriod,
        };
      }

      return rows;
    }

    async function fetchJsonWithFallback(primaryPath, fallbackPath, options = {}) {
      const primaryResp = await fetch(primaryPath, options);
      if (primaryResp.ok) {
        return primaryResp;
      }

      if (primaryResp.status !== 404 || !fallbackPath) {
        throw new Error(`Failed to load ${primaryPath} (${primaryResp.status})`);
      }

      const fallbackResp = await fetch(fallbackPath, options);
      if (!fallbackResp.ok) {
        throw new Error(`Failed to load ${fallbackPath} (${fallbackResp.status})`);
      }

      return fallbackResp;
    }

    function buildMetadataSignature(meta, resp = null) {
      const etag = String(resp?.headers?.get("etag") || "");
      const lastModified = String(resp?.headers?.get("last-modified") || "");
      return `${getDataSignature(meta)}|${etag}|${lastModified}`;
    }

    async function loadStaticMetadataOnly() {
      const metadataResp = await fetchJsonWithFallback(
        "webapp_data/chart_static.json",
        "webapp_data/chart_metadata.json"
      );

      if (!metadataResp.ok) {
        throw new Error(`Failed to load webapp_data/chart_static.json (${metadataResp.status})`);
      }

      return {
        metadata: await metadataResp.json(),
      };
    }

    async function loadDynamicMetadataOnly(cacheBust = null) {
      const withBust = (path) => {
        if (cacheBust == null) return path;
        const sep = path.includes("?") ? "&" : "?";
        return `${path}${sep}_=${cacheBust}`;
      };

      const metadataResp = await fetchJsonWithFallback(
        withBust("webapp_data/bip110_metadata.json"),
        withBust("webapp_data/chart_metadata.json")
      );

      if (!metadataResp.ok) {
        throw new Error(`Failed to load webapp_data/bip110_metadata.json (${metadataResp.status})`);
      }

      const metadata = await metadataResp.json();
      return {
        metadata,
        signature: buildMetadataSignature(metadata, metadataResp),
      };
    }

    async function loadStaticData(staticMetadata = null) {
      const metadataPath = "webapp_data/chart_static.json";
      const files = {
        segwitPeriods: "webapp_data/segwit_periods.csv",
        segwitReleases: "webapp_data/segwit_releases.csv",
        segwitTicks: "webapp_data/segwit_month_ticks.csv",
      };

      const responses = await Promise.all(Object.values(files).map((file) => fetch(file)));
      const [segwitPeriodsResp, segwitReleasesResp, segwitTicksResp] = responses;

      const requiredResponses = [
        [segwitPeriodsResp, files.segwitPeriods],
        [segwitReleasesResp, files.segwitReleases],
        [segwitTicksResp, files.segwitTicks],
      ];

      requiredResponses.forEach(([resp, path]) => {
        if (!resp.ok) {
          throw new Error(`Failed to load ${path} (${resp.status})`);
        }
      });

      return {
        metadata: staticMetadata || (await loadStaticMetadataOnly()).metadata,
        segwitPeriods: castRows(parseCsv(await segwitPeriodsResp.text())),
        segwitBlocks: [],
        segwitReleases: castRows(parseCsv(await segwitReleasesResp.text())).map((d) => ({
          ...d,
          display_label: String(d.display_label || "").replaceAll("\\n", "\n"),
        })),
        segwitTicks: castRows(parseCsv(await segwitTicksResp.text())),
      };
    }

    async function loadDynamicData(cacheBust = null, dynamicMetadata = null, metadataSignature = null, previousDynamicData = null) {
      const withBust = (path) => {
        if (cacheBust == null) return path;
        const sep = path.includes("?") ? "&" : "?";
        return `${path}${sep}_=${cacheBust}`;
      };

      const reuseReleases = Array.isArray(previousDynamicData?.bip110Releases)
        && previousDynamicData.bip110Releases.length > 0;
      const reuseTicks = Array.isArray(previousDynamicData?.bip110Ticks)
        && previousDynamicData.bip110Ticks.length > 0;

      const files = {
        bip110Periods: withBust("webapp_data/bip110_periods.csv"),
      };
      if (!reuseReleases) {
        files.bip110Releases = withBust("webapp_data/bip110_releases.csv");
      }
      if (!reuseTicks) {
        files.bip110Ticks = withBust("webapp_data/bip110_month_ticks.csv");
      }

      const entries = Object.entries(files);
      const responsesList = await Promise.all(entries.map(([, path]) => fetch(path)));
      const responseMap = Object.fromEntries(entries.map(([key], idx) => [key, responsesList[idx]]));

      const bip110PeriodsResp = responseMap.bip110Periods;
      const bip110ReleasesResp = responseMap.bip110Releases || null;
      const bip110TicksResp = responseMap.bip110Ticks || null;

      const responses = [
        [bip110PeriodsResp, files.bip110Periods],
        ...(bip110ReleasesResp ? [[bip110ReleasesResp, files.bip110Releases]] : []),
        ...(bip110TicksResp ? [[bip110TicksResp, files.bip110Ticks]] : []),
      ];

      responses.forEach(([resp, path]) => {
        if (!resp.ok) {
          throw new Error(`Failed to load ${path} (${resp.status})`);
        }
      });

      let metadata = dynamicMetadata;
      let signature = metadataSignature;
      if (!metadata) {
        const metadataResult = await loadDynamicMetadataOnly(cacheBust);
        metadata = metadataResult.metadata;
        signature = metadataResult.signature;
      }

      return {
        metadata,
        signature,
        bip110Periods: castRows(parseCsv(await bip110PeriodsResp.text())),
        bip110Blocks: [],
        bip110Releases: bip110ReleasesResp
          ? castRows(parseCsv(await bip110ReleasesResp.text())).map((d) => ({
              ...d,
              display_label: String(d.display_label || "").replaceAll("\\n", "\n"),
            }))
          : (previousDynamicData?.bip110Releases || []),
        bip110Ticks: bip110TicksResp
          ? castRows(parseCsv(await bip110TicksResp.text()))
          : (previousDynamicData?.bip110Ticks || []),
      };
    }

    function buildCombinedData(staticData, dynamicData, previousData = null) {
      const staticMetadata = staticData?.metadata || {};
      const dynamicMetadata = dynamicData?.metadata || {};

      return {
        metadata: {
          ...staticMetadata,
          ...dynamicMetadata,
          chart: {
            ...(staticMetadata.chart || {}),
            ...(dynamicMetadata.chart || {}),
          },
          datasets: {
            ...(staticMetadata.datasets || {}),
            ...(dynamicMetadata.datasets || {}),
          },
        },
        segwitPeriods: staticData?.segwitPeriods || previousData?.segwitPeriods || [],
        bip110Periods: dynamicData?.bip110Periods || previousData?.bip110Periods || [],
        segwitBlocks: staticData?.segwitBlocks || previousData?.segwitBlocks || [],
        bip110Blocks: dynamicData?.bip110Blocks || previousData?.bip110Blocks || [],
        segwitReleases: staticData?.segwitReleases || previousData?.segwitReleases || [],
        bip110Releases: dynamicData?.bip110Releases || previousData?.bip110Releases || [],
        segwitTicks: staticData?.segwitTicks || previousData?.segwitTicks || [],
        bip110Ticks: dynamicData?.bip110Ticks || previousData?.bip110Ticks || [],
      };
    }

    function reconcileBip110PeriodsFromBlocks(dynamicData, metadata) {
      if (!dynamicData || !Array.isArray(dynamicData.bip110Periods) || dynamicData.bip110Periods.length === 0) {
        return dynamicData;
      }
      if (!Array.isArray(dynamicData.bip110Blocks) || dynamicData.bip110Blocks.length === 0) {
        return dynamicData;
      }

      const periodSize = Number(metadata?.chart?.period_size || 2016);
      const perPeriodCounts = new Map();

      dynamicData.bip110Blocks.forEach((block) => {
        const period = Number(block?.period);
        if (!Number.isFinite(period)) return;

        const counts = perPeriodCounts.get(period) || { elapsed: 0, signaling: 0 };
        counts.elapsed += 1;
        if (Number(block?.is_signaling) === 1) {
          counts.signaling += 1;
        }
        perPeriodCounts.set(period, counts);
      });

      const reconciledPeriods = dynamicData.bip110Periods.map((row) => {
        const period = Number(row?.period);
        const status = String(row?.status || "");
        const counts = perPeriodCounts.get(period);
        if (!counts) return row;

        if (status === "completed") {
          return {
            ...row,
            elapsed_blocks: periodSize,
            signal_blocks: counts.signaling,
          };
        }

        if (status === "in_progress") {
          return {
            ...row,
            elapsed_blocks: counts.elapsed,
            signal_blocks: counts.signaling,
          };
        }

        return row;
      });

      return {
        ...dynamicData,
        bip110Periods: reconciledPeriods,
      };
    }

    async function loadBlockPointsForDataset(datasetKey, metadata, cacheBust = null) {
      const withBust = (path) => {
        if (cacheBust == null) return path;
        const sep = path.includes("?") ? "&" : "?";
        return `${path}${sep}_=${cacheBust}`;
      };

      const isSegwit = datasetKey === "segwit";
      const file = isSegwit
        ? withBust("webapp_data/segwit_block_points.bin")
        : withBust("webapp_data/bip110_block_points.bin");

      const resp = await fetch(file);
      if (!resp.ok) {
        throw new Error(`Failed to load ${file} (${resp.status})`);
      }

      const periodSize = Number(metadata?.chart?.period_size || 2016);
      const segwitStart = Number(metadata?.datasets?.segwit_blocks?.start_height || 0);
      const bip110Start = Number(metadata?.datasets?.bip110_blocks?.start_height || 0);
      const startHeight = isSegwit ? segwitStart : bip110Start;

      return decodeBlockPoints(await resp.arrayBuffer(), startHeight, periodSize);
    }

    function getDataSignature(meta) {
      const generated = String(meta?.generated_utc || "");
      const height = String(meta?.source_block_height ?? "");
      return `${generated}|${height}`;
    }

    async function fetchLatestBip110MetadataSignature() {
      const cacheBust = Date.now();
      const result = await loadDynamicMetadataOnly(cacheBust);
      return result.signature;
    }

    async function refreshIfDataChanged({ force = false } = {}) {
      if (!state.data) return;
      if (state.refreshInFlight) return;

      state.refreshInFlight = true;
      setControlsEnabled(false);
      try {
        if (!force) {
          const latestSig = await fetchLatestBip110MetadataSignature();
          if (!latestSig || latestSig === state.dataSignature) {
            return;
          }
        }

        const loadBuster = Date.now();
        const loadToken = ++state.phasedLoadToken;
        state.dynamicData = await loadDynamicData(loadBuster, null, null, state.dynamicData);
        state.data = buildCombinedData(state.staticData, state.dynamicData, state.data);
        state.dataSignature = state.dynamicData.signature || getDataSignature(state.dynamicData.metadata);
        state.lastSuccessfulRefreshAt = Date.now();
        setStatus(state.data);
        updatePanelVisibility();
        state.pinnedTooltip = null;
        hideTooltip();
        await nextPaint();
        if (loadToken !== state.phasedLoadToken) return;
        setPanelLoaderVisible("bip110", true);
        renderSelectedPanels(["bip110"]);
        setPanelLoaderVisible("bip110", false);

        await loadAndApplyBlockDataPhased(loadToken, state.data.metadata, ["bip110"], loadBuster);
        setStatus(state.data);
      } catch (err) {
        console.warn("Auto-refresh check failed:", err);
      } finally {
        state.refreshInFlight = false;
        setControlsEnabled(true);
      }
    }

    function triggerRefreshSoon(delayMs = 150) {
      window.setTimeout(() => {
        refreshIfDataChanged();
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
      if (state.autoRefreshTimer) {
        clearInterval(state.autoRefreshTimer);
      }
      state.autoRefreshTimer = setInterval(() => {
        const now = Date.now();
        const shouldForceRefresh = (now - state.lastSuccessfulRefreshAt) >= FORCE_REFRESH_MS;
        refreshIfDataChanged({ force: shouldForceRefresh });
      }, AUTO_REFRESH_MS);
    }

    function persistControls() {
      try {
        const segwitRatio = Number.isFinite(state.manualPanelHeightRatios.segwit)
          ? state.manualPanelHeightRatios.segwit
          : (Number.isFinite(state.manualPanelHeights.segwit)
            ? (state.manualPanelHeights.segwit / (window.innerHeight || 1))
            : null);
        const bip110Ratio = Number.isFinite(state.manualPanelHeightRatios.bip110)
          ? state.manualPanelHeightRatios.bip110
          : (Number.isFinite(state.manualPanelHeights.bip110)
            ? (state.manualPanelHeights.bip110 / (window.innerHeight || 1))
            : null);
        const payload = {
          stripes: Boolean(state.controls.stripes),
          stripesExplicit: Boolean(state.controls.stripesExplicit),
          markers: Boolean(state.controls.markers),
          labels: Boolean(state.controls.labels),
          showSegwit: Boolean(state.controls.showSegwit),
          showBip110: Boolean(state.controls.showBip110),
          panelsSwapped: Boolean(state.controls.panelsSwapped),
          manualPanelHeights: {
            segwit: Number.isFinite(segwitRatio)
              ? parseFloat(segwitRatio.toFixed(4))
              : null,
            bip110: Number.isFinite(bip110Ratio)
              ? parseFloat(bip110Ratio.toFixed(4))
              : null,
          },
          filledPanels: {
            segwit: Boolean(state.filledPanels.segwit),
            bip110: Boolean(state.filledPanels.bip110),
          },
        };
        localStorage.setItem(CONTROLS_STORAGE_KEY, JSON.stringify(payload));
        if (!state.suppressResetSnapshotClear) {
          clearPreResetSnapshot();
        }
      } catch (_) {
        // Ignore storage failures (private mode or unavailable storage).
      }
    }

    function restorePersistedControls() {
      try {
        const raw = localStorage.getItem(CONTROLS_STORAGE_KEY);
        if (!raw) return false;

        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== "object") return false;

        const hasExplicitStripePreference = typeof parsed.stripesExplicit === "boolean";
        state.controls.stripesExplicit = hasExplicitStripePreference ? parsed.stripesExplicit : false;
        state.controls.stripes = state.controls.stripesExplicit
          ? Boolean(parsed.stripes)
          : window.innerWidth >= 760;
        state.controls.markers = typeof parsed.markers === "boolean" ? parsed.markers : true;
        state.controls.labels = typeof parsed.labels === "boolean" ? parsed.labels : true;
        state.controls.showSegwit = typeof parsed.showSegwit === "boolean" ? parsed.showSegwit : false;
        state.controls.showBip110 = typeof parsed.showBip110 === "boolean" ? parsed.showBip110 : true;
        state.controls.panelsSwapped = typeof parsed.panelsSwapped === "boolean" ? parsed.panelsSwapped : false;

        const parseStoredHeight = (value) => {
          if (value == null || value === "") return null;
          const n = Number(value);
          if (!Number.isFinite(n) || n <= 0) return null;
          return n;
        };

        const segwitHeight = parseStoredHeight(parsed?.manualPanelHeights?.segwit);
        const bip110Height = parseStoredHeight(parsed?.manualPanelHeights?.bip110);
        applyManualPanelHeightFromRatio("segwit", segwitHeight);
        applyManualPanelHeightFromRatio("bip110", bip110Height);

        state.filledPanels.segwit = typeof parsed?.filledPanels?.segwit === "boolean"
          ? parsed.filledPanels.segwit
          : false;
        state.filledPanels.bip110 = typeof parsed?.filledPanels?.bip110 === "boolean"
          ? parsed.filledPanels.bip110
          : true;

        // In filled mode, height is derived from viewport; manual ratios should remain unset.
        ["segwit", "bip110"].forEach((key) => {
          if (state.filledPanels[key]) {
            state.manualPanelHeights[key] = null;
            state.manualPanelHeightRatios[key] = null;
          }
        });

        if (!state.controls.showSegwit && !state.controls.showBip110) {
          state.controls.showBip110 = true;
        }

        const stripes = document.getElementById("toggleStripes");
        const markers = document.getElementById("toggleMarkers");
        const labels = document.getElementById("toggleLabels");
        const segwitWindow = document.getElementById("toggleSegwitWindow");
        const bip110Window = document.getElementById("toggleBip110Window");

        if (stripes) stripes.checked = state.controls.stripes;
        if (markers) markers.checked = state.controls.markers;
        if (labels) labels.checked = state.controls.labels;
        if (segwitWindow) segwitWindow.checked = state.controls.showSegwit;
        if (bip110Window) bip110Window.checked = state.controls.showBip110;

        if (!hasExplicitStripePreference) {
          persistControls();
        }

        return true;
      } catch (_) {
        return false;
      }
    }

    function encodeShareState(payload) {
      try {
        const json = JSON.stringify(payload);
        const bytes = new TextEncoder().encode(json);
        let binary = "";
        bytes.forEach((byte) => {
          binary += String.fromCharCode(byte);
        });
        return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
      } catch (_) {
        return "";
      }
    }

    function decodeShareState(rawValue) {
      if (!rawValue) return null;
      try {
        const normalized = rawValue.replace(/-/g, "+").replace(/_/g, "/");
        const paddingLength = (4 - (normalized.length % 4)) % 4;
        const padded = normalized + "=".repeat(paddingLength);
        const binary = atob(padded);
        const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
        const json = new TextDecoder().decode(bytes);
        const parsed = JSON.parse(json);
        return parsed && typeof parsed === "object" ? parsed : null;
      } catch (_) {
        return null;
      }
    }

    function getShareRouteBaseUrl() {
      const path = String(window.location.pathname || "");
      const dashboardMatch = path.match(/^(.*)\/webapps\/bip110_signaling\/dashboard\.html$/i);
      const basePath = dashboardMatch ? (dashboardMatch[1] || "") : path.replace(/\/[^/]*$/, "");
      if (IS_LOCAL_RUNTIME) {
        return `${window.location.origin}${basePath}/bip110_signaling.html`;
      }
      return `${window.location.origin}${basePath}/bip110_signaling`;
    }

    function buildShareableDashboardUrl() {
      const payload = {
        controls: {
          stripes: Boolean(state.controls.stripes),
          stripesExplicit: Boolean(state.controls.stripesExplicit),
          markers: Boolean(state.controls.markers),
          labels: Boolean(state.controls.labels),
          showSegwit: Boolean(state.controls.showSegwit),
          showBip110: Boolean(state.controls.showBip110),
          panelsSwapped: Boolean(state.controls.panelsSwapped),
        },
        manualPanelHeights: {
          segwit: Number.isFinite(state.manualPanelHeightRatios.segwit) ? state.manualPanelHeightRatios.segwit : null,
          bip110: Number.isFinite(state.manualPanelHeightRatios.bip110) ? state.manualPanelHeightRatios.bip110 : null,
        },
        filledPanels: {
          segwit: Boolean(state.filledPanels.segwit),
          bip110: Boolean(state.filledPanels.bip110),
        },
        timeZone: String(state.timeZone || "UTC"),
      };

      const shareUrl = new URL(getShareRouteBaseUrl());
      const encoded = encodeShareState(payload);
      if (encoded) {
        shareUrl.searchParams.set(SHARE_STATE_PARAM, encoded);
      }
      return shareUrl.toString();
    }

    function applyDashboardShareStateFromUrl() {
      const params = new URLSearchParams(window.location.search || "");
      const decoded = decodeShareState(params.get(SHARE_STATE_PARAM) || "");
      if (!decoded) return;

      const controls = decoded.controls && typeof decoded.controls === "object" ? decoded.controls : null;
      if (controls) {
        if (typeof controls.stripes === "boolean") state.controls.stripes = controls.stripes;
        if (typeof controls.stripesExplicit === "boolean") state.controls.stripesExplicit = controls.stripesExplicit;
        if (typeof controls.markers === "boolean") state.controls.markers = controls.markers;
        if (typeof controls.labels === "boolean") state.controls.labels = controls.labels;
        if (typeof controls.showSegwit === "boolean") state.controls.showSegwit = controls.showSegwit;
        if (typeof controls.showBip110 === "boolean") state.controls.showBip110 = controls.showBip110;
        if (typeof controls.panelsSwapped === "boolean") state.controls.panelsSwapped = controls.panelsSwapped;
      }

      if (!state.controls.showSegwit && !state.controls.showBip110) {
        state.controls.showBip110 = true;
      }

      const heights = decoded.manualPanelHeights && typeof decoded.manualPanelHeights === "object"
        ? decoded.manualPanelHeights
        : null;
      if (heights) {
        applyManualPanelHeightFromRatio("segwit", heights.segwit);
        applyManualPanelHeightFromRatio("bip110", heights.bip110);
      }

      const filled = decoded.filledPanels && typeof decoded.filledPanels === "object"
        ? decoded.filledPanels
        : null;
      if (filled) {
        if (typeof filled.segwit === "boolean") state.filledPanels.segwit = filled.segwit;
        if (typeof filled.bip110 === "boolean") state.filledPanels.bip110 = filled.bip110;
      }

      const timeZone = String(decoded.timeZone || "").trim();
      if (timeZone) {
        state.timeZone = setPreferredDashboardTimeZone(timeZone);
      }

      const stripes = document.getElementById("toggleStripes");
      const markers = document.getElementById("toggleMarkers");
      const labels = document.getElementById("toggleLabels");
      const segwitWindow = document.getElementById("toggleSegwitWindow");
      const bip110Window = document.getElementById("toggleBip110Window");
      if (stripes) stripes.checked = state.controls.stripes;
      if (markers) markers.checked = state.controls.markers;
      if (labels) labels.checked = state.controls.labels;
      if (segwitWindow) segwitWindow.checked = state.controls.showSegwit;
      if (bip110Window) bip110Window.checked = state.controls.showBip110;
    }

    async function copyDashboardLinkToClipboard(buttonEl) {
      const link = buildShareableDashboardUrl();
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(link);
      } else {
        const textArea = document.createElement("textarea");
        textArea.value = link;
        textArea.setAttribute("readonly", "readonly");
        textArea.style.position = "absolute";
        textArea.style.left = "-9999px";
        document.body.appendChild(textArea);
        textArea.select();
        document.execCommand("copy");
        document.body.removeChild(textArea);
      }

      if (!buttonEl) return;
      const labelEl = buttonEl.querySelector(".label");
      const original = labelEl ? labelEl.textContent : buttonEl.textContent;
      if (labelEl) labelEl.textContent = "Copied!";
      else buttonEl.textContent = "Copied!";
      window.setTimeout(() => {
        if (labelEl) labelEl.textContent = original || "Copy Link";
        else buttonEl.textContent = original || "Copy Link";
      }, 1400);
    }

    function captureResetSnapshot() {
      const stripes = document.getElementById("toggleStripes");
      const markers = document.getElementById("toggleMarkers");
      const labels = document.getElementById("toggleLabels");
      const segwitWindow = document.getElementById("toggleSegwitWindow");
      const bip110Window = document.getElementById("toggleBip110Window");
      return {
        controls: {
          stripes: Boolean(state.controls.stripes),
          stripesExplicit: Boolean(state.controls.stripesExplicit),
          markers: Boolean(state.controls.markers),
          labels: Boolean(state.controls.labels),
          showSegwit: Boolean(state.controls.showSegwit),
          showBip110: Boolean(state.controls.showBip110),
          panelsSwapped: Boolean(state.controls.panelsSwapped),
        },
        filledPanels: {
          segwit: Boolean(state.filledPanels.segwit),
          bip110: Boolean(state.filledPanels.bip110),
        },
        manualPanelHeightRatios: {
          segwit: Number.isFinite(state.manualPanelHeightRatios.segwit) ? state.manualPanelHeightRatios.segwit : null,
          bip110: Number.isFinite(state.manualPanelHeightRatios.bip110) ? state.manualPanelHeightRatios.bip110 : null,
        },
        timeZone: String(state.timeZone || 'UTC'),
        checkboxState: {
          toggleStripes: Boolean(stripes?.checked ?? state.controls.stripes),
          toggleMarkers: Boolean(markers?.checked ?? state.controls.markers),
          toggleLabels: Boolean(labels?.checked ?? state.controls.labels),
          toggleSegwitWindow: Boolean(segwitWindow?.checked ?? state.controls.showSegwit),
          toggleBip110Window: Boolean(bip110Window?.checked ?? state.controls.showBip110),
        },
      };
    }

    function restoreResetSnapshot(snapshot) {
      if (!snapshot || typeof snapshot !== 'object') return;

      state.suppressResetSnapshotClear = true;
      try {
        const controls = snapshot.controls || {};
        const checkboxState = snapshot.checkboxState || {};
        state.controls.stripes = typeof checkboxState.toggleStripes === 'boolean'
          ? checkboxState.toggleStripes
          : Boolean(controls.stripes);
        state.controls.stripesExplicit = Boolean(controls.stripesExplicit);
        state.controls.markers = typeof checkboxState.toggleMarkers === 'boolean'
          ? checkboxState.toggleMarkers
          : Boolean(controls.markers);
        state.controls.labels = typeof checkboxState.toggleLabels === 'boolean'
          ? checkboxState.toggleLabels
          : Boolean(controls.labels);
        state.controls.showSegwit = typeof checkboxState.toggleSegwitWindow === 'boolean'
          ? checkboxState.toggleSegwitWindow
          : Boolean(controls.showSegwit);
        state.controls.showBip110 = typeof checkboxState.toggleBip110Window === 'boolean'
          ? checkboxState.toggleBip110Window
          : Boolean(controls.showBip110);
        if (!state.controls.showSegwit && !state.controls.showBip110) {
          state.controls.showBip110 = true;
        }
        state.controls.panelsSwapped = Boolean(controls.panelsSwapped);

        const filledPanels = snapshot.filledPanels || {};
        state.filledPanels.segwit = Boolean(filledPanels.segwit);
        state.filledPanels.bip110 = Boolean(filledPanels.bip110);

        state.manualPanelHeights.segwit = null;
        state.manualPanelHeights.bip110 = null;
        state.manualPanelHeightRatios.segwit = null;
        state.manualPanelHeightRatios.bip110 = null;

        const ratios = snapshot.manualPanelHeightRatios || {};
        applyManualPanelHeightFromRatio('segwit', ratios.segwit);
        applyManualPanelHeightFromRatio('bip110', ratios.bip110);
        state.timeZone = setPreferredDashboardTimeZone(String(snapshot.timeZone || 'UTC'));

        const stripes = document.getElementById('toggleStripes');
        const markers = document.getElementById('toggleMarkers');
        const labels = document.getElementById('toggleLabels');
        const segwitWindow = document.getElementById('toggleSegwitWindow');
        const bip110Window = document.getElementById('toggleBip110Window');
        if (stripes) stripes.checked = state.controls.stripes;
        if (markers) markers.checked = state.controls.markers;
        if (labels) labels.checked = state.controls.labels;
        if (segwitWindow) segwitWindow.checked = state.controls.showSegwit;
        if (bip110Window) bip110Window.checked = state.controls.showBip110;

        persistControls();
        applyPanelOrder();
        applyDynamicPanelHeights();
        updatePanelVisibility();
        updateFillButtonState('segwit');
        updateFillButtonState('bip110');
        if (state.data) {
          setStatus(state.data);
          renderAll();
        }
      } finally {
        state.suppressResetSnapshotClear = false;
      }
      updateResetButtonUi();
    }

    function clearPreResetSnapshot() {
      if (!state.preResetStateSnapshot) return;
      state.preResetStateSnapshot = null;
      updateResetButtonUi();
    }

    function restoreDashboardDefaults() {
      state.preResetStateSnapshot = captureResetSnapshot();
      state.suppressResetSnapshotClear = true;

      try {
        try {
          localStorage.removeItem(CONTROLS_STORAGE_KEY);
        } catch (_) {
        }
        try {
          const params = new URLSearchParams(window.location.search || "");
          if (params.has(SHARE_STATE_PARAM)) {
            params.delete(SHARE_STATE_PARAM);
            const nextQuery = params.toString();
            const nextUrl = `${window.location.pathname}${nextQuery ? `?${nextQuery}` : ""}${window.location.hash || ""}`;
            window.history.replaceState(null, "", nextUrl);
          }
        } catch (_) {
        }

        state.controls.stripes = window.innerWidth >= 760;
        state.controls.stripesExplicit = false;
        state.controls.markers = true;
        state.controls.labels = true;
        state.controls.showSegwit = false;
        state.controls.showBip110 = true;
        state.controls.panelsSwapped = false;

        state.filledPanels.segwit = false;
        state.filledPanels.bip110 = true;
        state.manualPanelHeights.segwit = null;
        state.manualPanelHeights.bip110 = null;
        state.manualPanelHeightRatios.segwit = null;
        state.manualPanelHeightRatios.bip110 = null;
        // Default for this dashboard is filled bip110 panel, not a manual fixed ratio.
        // Keep manual height metadata cleared so reload stays in default state.
        state.filledPanels.segwit = false;
        state.filledPanels.bip110 = true;

        state.timeZone = setPreferredDashboardTimeZone("UTC");

        const stripes = document.getElementById("toggleStripes");
        const markers = document.getElementById("toggleMarkers");
        const labels = document.getElementById("toggleLabels");
        const segwitWindow = document.getElementById("toggleSegwitWindow");
        const bip110Window = document.getElementById("toggleBip110Window");

        if (stripes) stripes.checked = state.controls.stripes;
        if (markers) markers.checked = true;
        if (labels) labels.checked = true;
        if (segwitWindow) segwitWindow.checked = false;
        if (bip110Window) bip110Window.checked = true;

        applyPanelOrder();
        applyDynamicPanelHeights();
        updatePanelVisibility();
        updateFillButtonState("segwit");
        updateFillButtonState("bip110");
        if (state.data) {
          setStatus(state.data);
          renderAll();
        }
      } finally {
        state.suppressResetSnapshotClear = false;
      }
      updateResetButtonUi();
    }

    function restorePreviousDashboardState() {
      if (!state.preResetStateSnapshot) return;
      const snapshot = state.preResetStateSnapshot;
      state.preResetStateSnapshot = null;
      restoreResetSnapshot(snapshot);
    }

    function isDefaultState() {
      const stripes = document.getElementById("toggleStripes");
      const markers = document.getElementById("toggleMarkers");
      const labels = document.getElementById("toggleLabels");
      const segwitWindow = document.getElementById("toggleSegwitWindow");
      const bip110Window = document.getElementById("toggleBip110Window");

      const defaultStripesOn = window.innerWidth >= 760;

      if (state.controls.stripesExplicit) return false;
      if (stripes && stripes.checked !== defaultStripesOn) return false;
      if (markers && !markers.checked) return false;
      if (labels && !labels.checked) return false;
      if (segwitWindow && segwitWindow.checked) return false;
      if (bip110Window && !bip110Window.checked) return false;
      if (state.controls.panelsSwapped) return false;
      if (state.filledPanels.segwit) return false;
      if (!state.filledPanels.bip110) return false;
      // In filled mode, viewport-derived height can introduce tiny persisted ratios.
      // Treat filled panel state as canonical default and only enforce null manual ratios
      // for panels that are NOT in filled mode.
      if (!state.filledPanels.segwit && state.manualPanelHeightRatios.segwit != null) return false;
      if (!state.filledPanels.bip110 && state.manualPanelHeightRatios.bip110 != null) return false;
      if (state.timeZone !== 'UTC') return false;

      return true;
    }

    function updateResetButtonUi() {
      const btn = document.getElementById('resetDashboard');
      if (!btn) return;

      if (!state.controlsEnabled) {
        btn.disabled = true;
        return;
      }

      if (state.preResetStateSnapshot) {
        btn.textContent = 'Undo Restore';
        btn.classList.add('reset-dashboard-btn--undo');
        btn.disabled = false;
      } else {
        btn.textContent = 'Restore Defaults';
        btn.classList.remove('reset-dashboard-btn--undo');
        btn.disabled = isDefaultState();
      }
    }

    function applyNarrowWindowDefaults() {
      // First-visit defaults: keep block markers off on narrow screens, on otherwise.
      const stripes = document.getElementById("toggleStripes");
      const defaultStripesOn = window.innerWidth >= 760;

      if (stripes) stripes.checked = defaultStripesOn;

      state.controls.stripes = defaultStripesOn;
      state.controls.stripesExplicit = false;
      persistControls();
    }

    function setStatus(data) {
      const meta = data.metadata;
      const s = meta.state;
      const currentPeriod = Number(s.current_period_index);
      const currentPeriodRow = data.bip110Periods.find((row) => Number(row.period) === currentPeriod) || null;
      const currentSignal = currentPeriodRow ? Number(currentPeriodRow.signal_blocks || 0) : null;
      const currentSignalPct = currentPeriodRow
        ? pctLabel(Number(currentPeriodRow.signal_blocks || 0), Number(meta.chart.period_size))
        : null;
      const currentPeriodBlocks = Number(s.blocks_into_current_period || 0);
      const periodSize = Number(meta?.chart?.period_size || 2016);

      statusChips.innerHTML = "";
      statusChips.appendChild(buildUpdatedChip(meta));
      const chipValues = [
        `Height ${Number(meta.source_block_height).toLocaleString()}`,
        `BIP-110 ${s.completed_periods}/${s.bip110_total_periods} periods complete`,
        currentSignal != null
          ? `Period ${s.current_period_index ?? "n/a"} signaling ${currentSignal.toLocaleString()} (${currentSignalPct})`
          : `Period ${s.current_period_index ?? "n/a"} ${currentPeriodBlocks.toLocaleString()} / ${periodSize.toLocaleString()} blocks mined`,
      ];
      chipValues.forEach((text) => {
        const div = document.createElement("div");
        div.className = "chip";
        div.textContent = text;
        statusChips.appendChild(div);
      });
      bindTimeZoneChipEvents();
    }

    function configureCanvas(canvas) {
      const rect = canvas.getBoundingClientRect();
      const dpr = state.dpr;
      canvas.width = Math.max(2, Math.floor(rect.width * dpr));
      canvas.height = Math.max(2, Math.floor(rect.height * dpr));
      const ctx = canvas.getContext("2d");
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      return { ctx, width: rect.width, height: rect.height };
    }

    function clamp(x, min, max) {
      return Math.max(min, Math.min(max, x));
    }

    function pctLabel(signal, periodSize) {
      const pct = (signal / periodSize) * 100;
      if (pct > 0 && pct < 0.1) return "< 0.1%";
      return `${pct.toFixed(1)}%`;
    }

    function formatGeneratedUtc(value) {
      const raw = String(value || "").trim();
      if (!raw) return "n/a";

      const parsed = new Date(raw);
      if (Number.isNaN(parsed.getTime())) {
        return raw;
      }

      const year = parsed.getUTCFullYear();
      const month = String(parsed.getUTCMonth() + 1).padStart(2, "0");
      const day = String(parsed.getUTCDate()).padStart(2, "0");
      const hours = String(parsed.getUTCHours()).padStart(2, "0");
      const minutes = String(parsed.getUTCMinutes()).padStart(2, "0");
      return `${year}-${month}-${day} ${hours}:${minutes} UTC`;
    }

    function buildUpdatedChip(meta) {
      const wrapper = document.createElement("div");
      wrapper.className = "chip-menu-wrap single-select";

      const display = document.createElement("div");
      display.className = "chip chip-kpi-display";
      display.textContent = `Updated ${formatGeneratedDateTimeForSelectedTimeZone(meta.generated_utc)}`;

      const select = document.createElement("select");
      select.className = "chip-menu-select chip-kpi-select-overlay";
      select.id = "updatedTimeZoneSelect";
      select.setAttribute("aria-label", "Updated timestamp time zone");

      getDashboardTimeZoneOptions().forEach((option) => {
        const optionEl = document.createElement("option");
        optionEl.value = option.value;
        optionEl.textContent = option.label;
        optionEl.selected = option.value === state.timeZone;
        select.appendChild(optionEl);
      });

      wrapper.appendChild(display);
      wrapper.appendChild(select);
      return wrapper;
    }

    function fitFontPx(ctx, text, maxWidth, basePx, minPx, fontFamily) {
      let size = basePx;
      while (size > minPx) {
        ctx.font = `${size}px ${fontFamily}`;
        if (ctx.measureText(text).width <= maxWidth) {
          return size;
        }
        size -= 0.5;
      }
      return minPx;
    }

    function fitUniformMultilineFontPx(ctx, multilineLabels, maxWidth, basePx, minPx, fontFamily) {
      let size = basePx;
      const labels = Array.isArray(multilineLabels) && multilineLabels.length ? multilineLabels : [[""]];
      while (size > minPx) {
        ctx.font = `${size}px ${fontFamily}`;
        const longest = labels.reduce((longestSoFar, lines) => {
          const safeLines = Array.isArray(lines) && lines.length ? lines : [""];
          const localMax = safeLines.reduce((w, line) => Math.max(w, ctx.measureText(String(line)).width), 0);
          return Math.max(longestSoFar, localMax);
        }, 0);
        if (longest <= maxWidth) {
          return size;
        }
        size -= 0.5;
      }
      return minPx;
    }

    function markerLabelLines(label) {
      return String(label || "").split("\n");
    }

    function getCanvasColors(chartColors) {
      const style = getComputedStyle(document.documentElement);
      const isLight = document.documentElement.dataset.theme === 'light';
      return Object.assign({}, chartColors, {
        foreground: style.getPropertyValue('--fg').trim() || chartColors.foreground,
        background: style.getPropertyValue('--panel').trim() || chartColors.background,
        nonsignal: isLight ? '#c8c8c8' : chartColors.nonsignal,
        future: style.getPropertyValue('--future').trim() || chartColors.future,
        threshold: style.getPropertyValue('--threshold').trim() || chartColors.threshold,
        muted: style.getPropertyValue('--muted').trim() || '#888',
        gridLine: isLight ? 'rgba(0,0,0,0.1)' : 'rgba(255,255,255,0.14)',
        axisLine: isLight ? 'rgba(0,0,0,0.25)' : 'rgba(255,255,255,0.35)',
        tickMark: isLight ? 'rgba(0,0,0,0.35)' : 'rgba(255,255,255,0.55)',
        stripe: isLight ? 'rgba(0,0,0,0.03)' : 'rgba(255,255,255,0.03)',
      });
    }

    function drawDiamond(ctx, x, y, size, color) {
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(Math.PI / 4);
      ctx.fillStyle = color;
      ctx.fillRect(-size / 2, -size / 2, size, size);
      ctx.restore();
    }

    function drawMultiline(ctx, text, x, y, align, baseline, color, font, lineHeight) {
      const lines = markerLabelLines(text);
      let startY = y;
      if (baseline === "bottom") {
        // For bottom-anchored labels, draw the full text block above the anchor.
        startY = y - (Math.max(lines.length, 1) * lineHeight) + 3;
      }
      ctx.save();
      ctx.fillStyle = color;
      ctx.font = font;
      ctx.textAlign = align;
      ctx.textBaseline = "top";
      lines.forEach((line, idx) => {
        ctx.fillText(line, x, startY + idx * lineHeight);
      });
      ctx.restore();
    }

    function drawVerticalText(ctx, text, x, y, direction = "up", flow = "forward") {
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(direction === "up" ? -Math.PI / 2 : Math.PI / 2);
      ctx.textAlign = flow === "backward" ? "right" : "left";
      ctx.textBaseline = "middle";
      ctx.fillText(String(text), 0, 0);
      ctx.restore();
    }

    function splitWordToFitWidth(ctx, word, maxWidth) {
      const text = String(word || "");
      if (!text) return [""];
      if (ctx.measureText(text).width <= maxWidth) return [text];

      const chunks = [];
      let current = "";
      for (const ch of text) {
        const candidate = current + ch;
        if (current && ctx.measureText(candidate).width > maxWidth) {
          chunks.push(current);
          current = ch;
        } else {
          current = candidate;
        }
      }
      if (current) chunks.push(current);
      return chunks.length ? chunks : [text];
    }

    function wrapTextToWidth(ctx, text, maxWidth) {
      const words = String(text || "").trim().split(/\s+/).filter(Boolean);
      if (!words.length) return [""];

      const lines = [];
      let line = "";

      words.forEach((word) => {
        if (ctx.measureText(word).width > maxWidth) {
          if (line) {
            lines.push(line);
            line = "";
          }
          const chunks = splitWordToFitWidth(ctx, word, maxWidth);
          lines.push(...chunks.slice(0, -1));
          line = chunks[chunks.length - 1] || "";
          return;
        }

        const candidate = line ? `${line} ${word}` : word;
        if (!line || ctx.measureText(candidate).width <= maxWidth) {
          line = candidate;
        } else {
          lines.push(line);
          line = word;
        }
      });

      if (line) lines.push(line);
      return lines.length ? lines : [String(text || "")];
    }

    function formatSpecialPeriodLabel(text) {
      const raw = String(text || "").trim();
      const key = raw.toLowerCase().replace(/\s+/g, " ");
      const maxHeightMatch = raw.match(/^\s*max(?:imum)?\s+activation\s+height\b(.*)$/i);
      if (maxHeightMatch) {
        const suffix = maxHeightMatch[1] || "";
        return `Max Activation Height${suffix}`;
      }
      const isTargetLabel = key.startsWith("mandatory signaling period")
        || key.startsWith("latest lock-in")
        || key.startsWith("maximum activation height")
        || key.startsWith("max activation height");
      if (isTargetLabel) {
        return raw.replace(/\b([a-zA-Z])([a-zA-Z']*)\b/g, (_, first, rest) => {
          return `${first.toUpperCase()}${rest.toLowerCase()}`;
        });
      }
      return raw;
    }

    function drawPanel({ canvas, key, title, periods, blocks, releases, ticks, threshold, thresholdPct, showBottomAxis, specialLabels = [], markerTypography = null, numericTypography = null, renderStripes = true, renderLabels = true, renderMarkers = true, renderSpecialLabels = true }) {
      const { metadata } = state.data;
      const chart = metadata.chart;
      const periodSize = chart.period_size;
      const xMax = chart.x_max;
      const colors = getCanvasColors(chart.colors);
      const yTicks = [0, 250, 500, 750, 1000, 1250, 1500, 1750, 2000];

      const { ctx, width, height } = configureCanvas(canvas);
      const isMobile = width < 760;

      const yTickFontSize = isMobile ? 10 : 11;
      ctx.font = `${yTickFontSize}px "IBM Plex Mono", monospace`;
      const maxYTickWidth = yTicks.reduce((maxW, t) => {
        return Math.max(maxW, ctx.measureText(String(t)).width);
      }, 0);

      const yAxisLabelFontSize = isMobile ? 11 : 12;
      const yAxisLabelHalfThickness = yAxisLabelFontSize * 0.55;
      const yTickLabelPad = 8;
      const yAxisLabelPadFromTicks = isMobile ? 6 : 8;
      const yAxisLabelPadFromPanel = isMobile ? 4 : 6;
      const minLeftPanelPad = isMobile ? 4 : 6;
      const minLeftMarginForYAxis = minLeftPanelPad
        + yAxisLabelPadFromPanel
        + yAxisLabelHalfThickness
        + yAxisLabelPadFromTicks
        + maxYTickWidth
        + yAxisLabelHalfThickness
        + yTickLabelPad;

      const margin = {
        top: isMobile ? 44 : 46,
        right: isMobile ? 10 : 14,
        bottom: showBottomAxis ? (isMobile ? 44 : 50) : (isMobile ? 18 : 20),
        left: Math.max(isMobile ? 44 : 56, Math.ceil(minLeftMarginForYAxis)),
      };

      const plot = {
        x: margin.left,
        y: margin.top,
        w: width - margin.left - margin.right,
        h: height - margin.top - margin.bottom,
      };

      const xMin = 0.1;
      const xMaxDomain = 20.5;
      const xScale = (x) => plot.x + ((x - xMin) / (xMaxDomain - xMin)) * plot.w;
      const yScale = (y) => plot.y + plot.h - (y / periodSize) * plot.h;
      const barWidth = xScale(1 + chart.bar.width / 2) - xScale(1 - chart.bar.width / 2);
      const minSignalLinePx = isMobile ? 1.25 : 1.5;
      const renderedSignalTopByPeriod = new Map();

      state.hitMaps[key] = [];
      state.releaseMaps[key] = [];
      state.stripeMaps[key] = [];
      state.barMaps[key] = [];

      ctx.clearRect(0, 0, width, height);

      ctx.fillStyle = colors.background;
      ctx.fillRect(0, 0, width, height);

      for (let p = 1; p <= xMax; p += 1) {
        const xCenter = xScale(p);
        const x0 = xCenter - barWidth / 2;
        ctx.fillStyle = colors.stripe;
        ctx.fillRect(x0, plot.y, barWidth, plot.h);
      }

      ctx.save();
      ctx.beginPath();
      ctx.rect(plot.x, plot.y, plot.w, plot.h);
      ctx.clip();

      periods.forEach((row) => {
        const p = Number(row.period);
        if (!Number.isFinite(p)) return;

        const xCenter = xScale(p);
        const x0 = xCenter - barWidth / 2;

        const signalRaw = Number(row.signal_blocks || 0);
        let signal = signalRaw;
        let nonsignal = clamp(periodSize - signalRaw, 0, periodSize);
        let unmined = 0;

        if (key === "bip110") {
          const status = String(row.status || "");
          const elapsed = Number(row.elapsed_blocks || 0);
          if (status === "completed") {
            signal = signalRaw;
            nonsignal = clamp(periodSize - signalRaw, 0, periodSize);
            unmined = 0;
          } else if (status === "in_progress") {
            signal = signalRaw;
            nonsignal = clamp(elapsed - signalRaw, 0, periodSize);
            unmined = clamp(periodSize - elapsed, 0, periodSize);
          } else {
            signal = 0;
            nonsignal = 0;
            unmined = periodSize;
          }
        }

        const ySignal = yScale(signal);
        const yNonSignal = yScale(signal + nonsignal);
        const actualSignalHeightPx = yScale(0) - ySignal;
        const displaySignalHeightPx = signalRaw > 0 ? Math.max(actualSignalHeightPx, minSignalLinePx) : 0;
        const displaySignalTopY = yScale(0) - displaySignalHeightPx;
        renderedSignalTopByPeriod.set(p, displaySignalTopY);

        if (signalRaw > 0) {
          ctx.fillStyle = colors.signal;
          ctx.fillRect(x0, displaySignalTopY, barWidth, displaySignalHeightPx);
        }

        if (nonsignal > 0) {
          ctx.fillStyle = colors.nonsignal;
          ctx.fillRect(x0, yNonSignal, barWidth, displaySignalTopY - yNonSignal);
        }

        if (unmined > 0) {
          const yTopUnmined = yScale(signal + nonsignal + unmined);
          ctx.fillStyle = colors.future;
          ctx.fillRect(x0, yTopUnmined, barWidth, yNonSignal - yTopUnmined);
        }

        state.barMaps[key].push({
          period: p,
          x0,
          x1: x0 + barWidth,
          y0: plot.y,
          y1: yScale(0),
          data: row,
        });
      });

      if (renderStripes) {
        const stripeOffset = Number(chart.signal_stripes.x_offset);
        const stripeHalf = Number(chart.signal_stripes.halfwidth);
        const stripeWidth = Math.max(0.5, Number(chart.signal_stripes.linewidth) * 2.5);
        const stripeHitPad = Math.max(2.5, stripeWidth * 1.6);

        blocks.forEach((b) => {
          const p = Number(b.period);
          const y = yScale(Number(b.y_in_period));
          const signaling = Number(b.is_signaling) === 1;

          const x0 = signaling
            ? xScale(p + stripeOffset - stripeHalf)
            : xScale(p - stripeOffset - stripeHalf);
          const x1 = signaling
            ? xScale(p + stripeOffset + stripeHalf)
            : xScale(p - stripeOffset + stripeHalf);

          ctx.strokeStyle = signaling ? colors.signal : colors.nonsignal;
          ctx.lineWidth = stripeWidth;
          ctx.globalAlpha = 0.98;
          ctx.beginPath();
          ctx.moveTo(x0, y);
          ctx.lineTo(x1, y);
          ctx.stroke();

          state.stripeMaps[key].push({
            x0: Math.min(x0, x1),
            x1: Math.max(x0, x1),
            y0: y - stripeHitPad,
            y1: y + stripeHitPad,
            data: b,
          });
        });

        ctx.globalAlpha = 1;
      }

      ctx.restore();

      const thresholdY = yScale(threshold);
      ctx.strokeStyle = colors.threshold;
      ctx.lineWidth = 1;
      ctx.globalAlpha = 0.84;
      ctx.beginPath();
      ctx.moveTo(plot.x, thresholdY);
      ctx.lineTo(plot.x + plot.w, thresholdY);
      ctx.stroke();
      ctx.globalAlpha = 1;

      const thresholdX = xScale(0.375);
      const thresholdPctText = `${thresholdPct}%`;
      const thresholdCountText = Number(threshold).toLocaleString();
      const firstBarLeft = xScale(1) - barWidth / 2;
      const halfSpace = Math.max(
        10,
        Math.min(
          thresholdX - plot.x - 2,
          firstBarLeft - thresholdX - 2
        )
      );
      const thresholdMaxWidth = Math.max(20, halfSpace * 2);
      const thresholdFontSize = numericTypography?.fontSize
        ? Math.min(
            numericTypography.fontSize,
            fitFontPx(ctx, thresholdPctText, thresholdMaxWidth, numericTypography.fontSize, 6, '"IBM Plex Mono", monospace'),
            fitFontPx(ctx, thresholdCountText, thresholdMaxWidth, numericTypography.fontSize, 6, '"IBM Plex Mono", monospace')
          )
        : Math.min(
            fitFontPx(ctx, thresholdPctText, thresholdMaxWidth, isMobile ? 10 : 11, 6, '"IBM Plex Mono", monospace'),
            fitFontPx(ctx, thresholdCountText, thresholdMaxWidth, isMobile ? 10 : 11, 6, '"IBM Plex Mono", monospace')
          );
      const thresholdOffset = Math.max(4, Math.round(thresholdFontSize * 0.6));
      const useVerticalThresholdLabels = isMobile || barWidth < 16;

      ctx.fillStyle = colors.threshold;
      ctx.font = `${thresholdFontSize}px "IBM Plex Mono", monospace`;
      if (useVerticalThresholdLabels) {
        drawVerticalText(ctx, thresholdPctText, thresholdX, thresholdY - thresholdOffset, "up");
        drawVerticalText(ctx, thresholdCountText, thresholdX, thresholdY + thresholdOffset, "up", "backward");
      } else {
        ctx.textAlign = "center";
        ctx.textBaseline = "bottom";
        ctx.fillText(thresholdPctText, thresholdX, thresholdY - thresholdOffset);
        ctx.textBaseline = "top";
        ctx.fillText(thresholdCountText, thresholdX, thresholdY + thresholdOffset);
      }

      if (renderLabels) {
        periods.forEach((row) => {
          const p = Number(row.period);
          const signalRaw = Number(row.signal_blocks || 0);
          const status = String(row.status || "completed");
          if (key === "bip110" && status === "future") return;
          if (key === "bip110" && status === "post_window") return;

          const x = xScale(p);
          const pct = pctLabel(signalRaw, periodSize);
          const countText = Number(signalRaw).toLocaleString();
          const baseNumericSize = numericTypography?.fontSize ?? (isMobile ? 10 : 11);
          const fitPct = fitFontPx(
            ctx,
            pct,
            Math.max(14, barWidth - 4),
            baseNumericSize,
            6,
            '"IBM Plex Mono", monospace'
          );
          const fitCount = fitFontPx(
            ctx,
            countText,
            Math.max(14, barWidth - 4),
            baseNumericSize,
            6,
            '"IBM Plex Mono", monospace'
          );
          const sharedNumericSize = Math.min(baseNumericSize, fitPct, fitCount);
          const labelAnchorY = (renderedSignalTopByPeriod.get(p) ?? yScale(signalRaw));
          const useVerticalLabels = isMobile || barWidth < 16;

          if (useVerticalLabels) {
            ctx.fillStyle = "#111";
            ctx.font = `${sharedNumericSize}px "IBM Plex Mono", monospace`;
            drawVerticalText(ctx, pct, x, labelAnchorY - 4, "up");
          } else {
            ctx.fillStyle = "#111";
            ctx.font = `${sharedNumericSize}px "IBM Plex Mono", monospace`;
            ctx.textAlign = "center";
            ctx.textBaseline = "bottom";
            ctx.fillText(pct, x, labelAnchorY - 4);
          }

          if (signalRaw > 0) {
            if (useVerticalLabels) {
              ctx.fillStyle = signalRaw < 100 ? colors.signal : "#111";
              ctx.font = `${sharedNumericSize}px "IBM Plex Mono", monospace`;
              drawVerticalText(ctx, countText, x, labelAnchorY + 4, "up", "backward");
            } else {
              if (signalRaw < 100) {
                ctx.fillStyle = colors.signal;
                ctx.font = `${sharedNumericSize}px "IBM Plex Mono", monospace`;
                ctx.textBaseline = "top";
                ctx.fillText(countText, x - barWidth * 0.48, yScale(0) + 6);
              } else {
                ctx.fillStyle = "#111";
                ctx.font = `${sharedNumericSize}px "IBM Plex Mono", monospace`;
                ctx.textBaseline = "top";
                ctx.fillText(countText, x, labelAnchorY + 2);
              }
            }
          }
        });
      }

      if (renderMarkers) {
        const markerFontSize = markerTypography?.fontSize ?? (isMobile ? 8.5 : 9.5);
        const markerLineHeight = markerTypography?.lineHeight ?? Math.max(8, markerFontSize + 1);

        releases.forEach((r) => {
          const p = Number(r.period);
          const y = yScale(Number(r.y_in_period));
          const x = xScale(p);
          const dyDataUnits = Number(r.label_dy || 55);
          // Spacing depends only on this panel's own rendered chart height.
          const rawMarkerLabelOffset = dyDataUnits * (plot.h / periodSize);
          const minMarkerLabelOffsetPx = 2;
          const maxMarkerLabelOffsetPx = isMobile ? 9 : 12;
          const boundedMarkerLabelOffset = Math.min(
            maxMarkerLabelOffsetPx,
            Math.max(minMarkerLabelOffsetPx, Math.abs(rawMarkerLabelOffset))
          );
          const cappedMarkerLabelOffset = Math.sign(rawMarkerLabelOffset || dyDataUnits || 1)
            * boundedMarkerLabelOffset;
          const labelY = y - cappedMarkerLabelOffset;
          const anchor = String(r.label_anchor || "").toLowerCase();
          const baseline = anchor === "below"
            ? "top"
            : anchor === "above"
              ? "bottom"
              : (dyDataUnits < 0 ? "top" : "bottom");
          drawDiamond(ctx, x, y, isMobile ? 6 : 7, colors.marker);

          drawMultiline(
            ctx,
            String(r.display_label || r.label || ""),
            x,
            labelY,
            "center",
            baseline,
            colors.foreground,
            `${markerFontSize}px "Space Grotesk", sans-serif`,
            markerLineHeight
          );

          state.releaseMaps[key].push({ x, y, radius: isMobile ? 10 : 11, data: r });
        });
      }

      if (renderSpecialLabels) specialLabels.forEach((labelDef) => {
        const p = Number(labelDef.period);
        const x = xScale(p);
        const bottomInset = isMobile ? 8 : 10;
        const y = yScale(0) - bottomInset;
        const topInset = isMobile ? 6 : 8;
        const maxUpwardSpan = Math.max(28, y - (plot.y + topInset));
        const labelText = formatSpecialPeriodLabel(labelDef.text);
        const labelFontPx = Math.round((8.8 + (12 - 8.8) * clamp((width - 420) / 560, 0, 1)) * 10) / 10;
        const labelLineHeight = Math.max(10, Math.round(labelFontPx * 1.12));
        ctx.save();
        ctx.fillStyle = colors.muted;
        ctx.font = `${labelFontPx}px "Space Grotesk", sans-serif`;

        let labelLines = [labelText];
        if (ctx.measureText(labelText).width > maxUpwardSpan) {
          labelLines = wrapTextToWidth(ctx, labelText, maxUpwardSpan);
        }

        ctx.translate(x, y);
        ctx.rotate(-Math.PI / 2);
        // Keep each wrapped line centered in the bar while text still flows upward.
        ctx.textAlign = "left";
        ctx.textBaseline = "middle";
        const centeredLineOffset = ((labelLines.length - 1) * labelLineHeight) / 2;
        labelLines.forEach((line, idx) => {
          const lineOffset = idx * labelLineHeight - centeredLineOffset;
          ctx.fillText(line, 0, lineOffset);
        });
        ctx.restore();
      });

      const xAxisLabelMax = key === "bip110"
        ? periods.reduce((maxPeriod, row) => {
            const period = Number(row.period);
            const status = String(row.status || "");
            if (!Number.isFinite(period) || status === "post_window") return maxPeriod;
            return Math.max(maxPeriod, period);
          }, 0)
        : xMax;

      drawAxes(ctx, {
        plot,
        panelWidth: width,
        xScale,
        yScale,
        xMax,
        xAxisLabelMax,
        periodSize,
        title,
        ticks,
        showBottomAxis,
        chart,
        isMobile,
      });

      state.hitMaps[key] = [
        ...state.stripeMaps[key].map((s) => ({ type: "stripe", ...s })),
        ...state.barMaps[key].map((b) => ({ type: "period", ...b })),
        ...state.releaseMaps[key].map((r) => ({ type: "release", ...r })),
      ];
    }

    function estimateBarWidthForCanvas(canvas, chart) {
      const rect = canvas.getBoundingClientRect();
      if (!rect.width || rect.width < 40) {
        return 0;
      }
      const isMobile = rect.width < 760;
      const left = isMobile ? 44 : 56;
      const right = isMobile ? 10 : 14;
      const plotW = Math.max(10, rect.width - left - right);
      const xMin = 0.1;
      const xMaxDomain = 20.5;
      const pxPerDomain = plotW / (xMaxDomain - xMin);
      return pxPerDomain * Number(chart.bar.width || 0.5);
    }

    function estimateThresholdLabelWidthForCanvas(canvas, chart) {
      const rect = canvas.getBoundingClientRect();
      if (!rect.width || rect.width < 40) {
        return 0;
      }
      const isMobile = rect.width < 760;
      const left = isMobile ? 44 : 56;
      const right = isMobile ? 10 : 14;
      const plotW = Math.max(10, rect.width - left - right);
      const xMin = 0.1;
      const xMaxDomain = 20.5;
      const pxPerDomain = plotW / (xMaxDomain - xMin);
      const xScale = (x) => left + (x - xMin) * pxPerDomain;
      const barWidth = pxPerDomain * Number(chart.bar.width || 0.5);
      const thresholdX = xScale(0.375);
      const firstBarLeft = xScale(1) - barWidth / 2;
      const halfSpace = Math.max(
        10,
        Math.min(
          thresholdX - left - 2,
          firstBarLeft - thresholdX - 2
        )
      );
      return Math.max(20, halfSpace * 2);
    }

    function getSharedMarkerTypography(metadata, segwitReleases, bip110Releases) {
      const chart = metadata.chart;
      const tmpCanvas = document.createElement("canvas");
      const tmpCtx = tmpCanvas.getContext("2d");
      if (!tmpCtx) {
        const fallbackSize = window.innerWidth < 760 ? 8.5 : 9.5;
        return { fontSize: fallbackSize, lineHeight: Math.max(8, fallbackSize + 1) };
      }

      const combinedReleases = [...segwitReleases, ...bip110Releases];
      const combinedLines = combinedReleases.map((r) => markerLabelLines(String(r.display_label || r.label || "")));
      const barW1 = estimateBarWidthForCanvas(segwitCanvas, chart);
      const barW2 = estimateBarWidthForCanvas(bip110Canvas, chart);
      const widthCandidates = [barW1, barW2].filter((w) => Number.isFinite(w) && w > 8);
      const targetWidth = Math.max(38, (widthCandidates.length ? Math.min(...widthCandidates) : 30) * 1.55);
      const visibleWidths = [
        segwitCanvas.getBoundingClientRect().width,
        bip110Canvas.getBoundingClientRect().width,
      ].filter((w) => Number.isFinite(w) && w > 8);
      const isMobile = (visibleWidths.length ? Math.min(...visibleWidths) : window.innerWidth) < 760;
      const fontSize = fitUniformMultilineFontPx(
        tmpCtx,
        combinedLines,
        targetWidth,
        isMobile ? 8.5 : 9.5,
        6,
        '"Space Grotesk", sans-serif'
      );

      return {
        fontSize,
        lineHeight: Math.max(8, fontSize + 1),
      };
    }

    function getSharedNumericTypography(metadata, segwitPeriods, bip110Periods) {
      const chart = metadata.chart;
      const tmpCanvas = document.createElement("canvas");
      const tmpCtx = tmpCanvas.getContext("2d");
      if (!tmpCtx) {
        const fallbackSize = window.innerWidth < 760 ? 10 : 11;
        return { fontSize: fallbackSize };
      }

      const segBarW = estimateBarWidthForCanvas(segwitCanvas, chart);
      const bipBarW = estimateBarWidthForCanvas(bip110Canvas, chart);
      const segThrW = estimateThresholdLabelWidthForCanvas(segwitCanvas, chart);
      const bipThrW = estimateThresholdLabelWidthForCanvas(bip110Canvas, chart);
      const widthCandidates = [segBarW - 4, bipBarW - 4, segThrW, bipThrW].filter((w) => Number.isFinite(w) && w > 8);
      const maxWidth = Math.max(14, widthCandidates.length ? Math.min(...widthCandidates) : 18);

      const texts = [
        ...segwitPeriods.map((r) => pctLabel(Number(r.signal_blocks || 0), Number(chart.period_size))),
        ...segwitPeriods.map((r) => Number(r.signal_blocks || 0).toLocaleString()),
        ...bip110Periods.map((r) => pctLabel(Number(r.signal_blocks || 0), Number(chart.period_size))),
        ...bip110Periods.map((r) => Number(r.signal_blocks || 0).toLocaleString()),
        `${Number(chart.thresholds.segwit.pct)}%`,
        `${Number(chart.thresholds.bip110.pct)}%`,
        Number(chart.thresholds.segwit.blocks).toLocaleString(),
        Number(chart.thresholds.bip110.blocks).toLocaleString(),
      ];

      const visibleWidths = [
        segwitCanvas.getBoundingClientRect().width,
        bip110Canvas.getBoundingClientRect().width,
      ].filter((w) => Number.isFinite(w) && w > 8);
      const isMobile = (visibleWidths.length ? Math.min(...visibleWidths) : window.innerWidth) < 760;
      const base = isMobile ? 10 : 11;
      const size = texts.reduce((acc, txt) => {
        const fitted = fitFontPx(tmpCtx, String(txt), maxWidth, acc, 6, '"IBM Plex Mono", monospace');
        return Math.min(acc, fitted);
      }, base);

      return { fontSize: size };
    }

    function updatePanelVisibility() {
      const prevCount = state.lastVisibleCount;
      const hasPriorVisibility = prevCount >= 0;

      if (hasPriorVisibility) {
        // Preserve the user-visible panel heights when toggling panel visibility.
        if (!segwitPanel.classList.contains("hidden")) {
          const segwitHeight = segwitPanel.getBoundingClientRect().height;
          if (Number.isFinite(segwitHeight) && segwitHeight > 0) {
            setManualPanelHeight("segwit", segwitHeight);
          }
        }
        if (!bip110Panel.classList.contains("hidden")) {
          const bip110Height = bip110Panel.getBoundingClientRect().height;
          if (Number.isFinite(bip110Height) && bip110Height > 0) {
            setManualPanelHeight("bip110", bip110Height);
          }
        }
      }

      segwitPanel.classList.toggle("hidden", !state.controls.showSegwit);
      bip110Panel.classList.toggle("hidden", !state.controls.showBip110);

      const visibleCount = (state.controls.showSegwit ? 1 : 0) + (state.controls.showBip110 ? 1 : 0);
      const solo = visibleCount === 1;
      state.lastVisibleCount = visibleCount;

      if (hasPriorVisibility && visibleCount !== prevCount) {
        persistControls();
        updateResetButtonUi();
      }

      applyDynamicPanelHeights();
    }

    function applyPanelOrder() {
      if (state.controls.panelsSwapped) {
        mainWrap.insertBefore(bip110Panel, segwitPanel);
      } else {
        mainWrap.insertBefore(segwitPanel, bip110Panel);
      }
    }

      function setupSwapButton() {
        if (!swapPanelsBtn) return;
        swapPanelsBtn.addEventListener("click", () => {
          state.controls.panelsSwapped = !state.controls.panelsSwapped;
          applyPanelOrder();
          persistControls();
          updateResetButtonUi();
        });
      }

    function panelResizeMaxHeightPx() {
      return Math.max(PANEL_RESIZE_MIN_HEIGHT, window.innerHeight - PANEL_RESIZE_VIEWPORT_PAD);
    }

    function clampPanelResizeHeight(height) {
      return Math.round(clamp(height, PANEL_RESIZE_MIN_HEIGHT, panelResizeMaxHeightPx()));
    }

    function panelHeightPxToViewportRatio(height) {
      const n = Number(height);
      if (!Number.isFinite(n) || n <= 0) return null;
      return n / (window.innerHeight || 1);
    }

    function panelHeightRatioToPx(ratio) {
      const n = Number(ratio);
      if (!Number.isFinite(n) || n <= 0) return null;
      return n * (window.innerHeight || 1);
    }

    function setManualPanelHeight(key, heightPx) {
      const clamped = clampPanelResizeHeight(heightPx);
      state.manualPanelHeights[key] = clamped;
      state.manualPanelHeightRatios[key] = panelHeightPxToViewportRatio(clamped);
      return clamped;
    }

    function applyManualPanelHeightFromRatio(key, ratio) {
      const restoredPx = panelHeightRatioToPx(ratio);
      if (!Number.isFinite(restoredPx)) {
        state.manualPanelHeights[key] = null;
        state.manualPanelHeightRatios[key] = null;
        return null;
      }
      return setManualPanelHeight(key, restoredPx);
    }

    function syncManualPanelHeightsToViewport() {
      ["segwit", "bip110"].forEach((key) => {
        if (state.filledPanels[key]) {
          state.manualPanelHeights[key] = null;
          state.manualPanelHeightRatios[key] = null;
          return;
        }
        const ratio = state.manualPanelHeightRatios[key];
        if (Number.isFinite(ratio)) {
          setManualPanelHeight(key, panelHeightRatioToPx(ratio));
          return;
        }
        if (Number.isFinite(state.manualPanelHeights[key])) {
          setManualPanelHeight(key, state.manualPanelHeights[key]);
        }
      });
    }

    function applyDynamicPanelHeights() {
      const visiblePanels = [];
      if (state.controls.showSegwit) visiblePanels.push({ key: "segwit", box: segwitCanvasBox });
      if (state.controls.showBip110) visiblePanels.push({ key: "bip110", box: bip110CanvasBox });
      if (!visiblePanels.length) return;

      const wrapStyle = getComputedStyle(mainWrap);
      const padTop = parseFloat(wrapStyle.paddingTop) || 0;
      const padBottom = parseFloat(wrapStyle.paddingBottom) || 0;
      const gap = parseFloat(wrapStyle.rowGap || wrapStyle.gap) || 0;

      const n = visiblePanels.length;
      const viewportH = window.innerHeight;
      const topbarH = topbar.getBoundingClientRect().height;
      const gapsOutsidePanels = gap * n;
      const availableForPanels = viewportH - topbarH - padTop - padBottom - gapsOutsidePanels;

      const minPerPanel = n === 1 ? 600 : 300;
      const panelHeight = Math.max(minPerPanel, Math.floor(availableForPanels / n));

      visiblePanels.forEach(({ key, box }) => {
        const panel = key === "segwit" ? segwitPanel : bip110Panel;
        const manual = state.manualPanelHeights[key];
        const isFilledSinglePanel = n === 1 && state.filledPanels[key];
        const targetHeight = isFilledSinglePanel
          ? getViewportFillHeightForSinglePanel()
          : (Number.isFinite(manual)
            ? clampPanelResizeHeight(manual)
            : panelHeight);
        panel.style.height = `${targetHeight}px`;
        box.style.height = "";
      });

      if (!state.controls.showSegwit) {
        segwitPanel.style.height = "";
      }
      if (!state.controls.showBip110) {
        bip110Panel.style.height = "";
      }
    }

    function getViewportFillHeightForSinglePanel() {
      const wrapStyle = getComputedStyle(mainWrap);
      const padTop = parseFloat(wrapStyle.paddingTop) || 0;
      const padBottom = parseFloat(wrapStyle.paddingBottom) || 0;
      const gap = parseFloat(wrapStyle.rowGap || wrapStyle.gap) || 0;
      const viewportH = window.innerHeight;
      const topbarH = topbar.getBoundingClientRect().height;
      const gapsOutsidePanels = gap;
      const availableForPanel = viewportH - topbarH - padTop - padBottom - gapsOutsidePanels;
      return clampPanelResizeHeight(availableForPanel);
    }

    function getHalfPanelHeight() {
      const wrapStyle = getComputedStyle(mainWrap);
      const padTop = parseFloat(wrapStyle.paddingTop) || 0;
      const padBottom = parseFloat(wrapStyle.paddingBottom) || 0;
      const gap = parseFloat(wrapStyle.rowGap || wrapStyle.gap) || 0;
      const viewportH = window.innerHeight;
      const topbarH = topbar.getBoundingClientRect().height;
      const availableForPanels = viewportH - topbarH - padTop - padBottom - gap * 2;
      return Math.max(300, Math.floor(availableForPanels / 2));
    }

    function getEqualSplitPanelHeight(visibleCount) {
      const count = Math.max(1, Number(visibleCount) || 1);
      const wrapStyle = getComputedStyle(mainWrap);
      const padTop = parseFloat(wrapStyle.paddingTop) || 0;
      const padBottom = parseFloat(wrapStyle.paddingBottom) || 0;
      const gap = parseFloat(wrapStyle.rowGap || wrapStyle.gap) || 0;
      const viewportH = window.innerHeight;
      const topbarH = topbar.getBoundingClientRect().height;
      const gapsOutsidePanels = gap * count;
      const availableForPanels = viewportH - topbarH - padTop - padBottom - gapsOutsidePanels;
      const minPerPanel = count === 1 ? 600 : 300;
      return clampPanelResizeHeight(Math.max(minPerPanel, Math.floor(availableForPanels / count)));
    }

    const FILL_BTN_SVG_EXPAND = `<svg viewBox="0 0 16 16" aria-hidden="true" focusable="false"><line x1="8" y1="3.8" x2="8" y2="12.2"></line><polyline points="5.2,6.2 8,3.4 10.8,6.2"></polyline><polyline points="5.2,9.8 8,12.6 10.8,9.8"></polyline></svg>`;
    const FILL_BTN_SVG_COMPACT = `<svg viewBox="0 0 16 16" aria-hidden="true" focusable="false"><line x1="8" y1="3.8" x2="8" y2="12.2"></line><polyline points="5.2,3.4 8,6.2 10.8,3.4"></polyline><polyline points="5.2,12.6 8,9.8 10.8,12.6"></polyline></svg>`;

    function updateFillButtonState(key) {
      const btn = key === "segwit" ? segwitFillHeightBtn : bip110FillHeightBtn;
      if (!btn) return;
      const filled = state.filledPanels[key];
      btn.innerHTML = filled ? FILL_BTN_SVG_COMPACT : FILL_BTN_SVG_EXPAND;
      btn.title = filled ? "Compact chart height" : "Fill chart height";
      btn.setAttribute("aria-label", filled
        ? `Compact ${key === "segwit" ? "SegWit" : "BIP-110"} chart height`
        : `Fill ${key === "segwit" ? "SegWit" : "BIP-110"} chart height`);
    }

    function fillSinglePanelToViewportHeight(key) {
      state.manualPanelHeights[key] = null;
      state.manualPanelHeightRatios[key] = null;
      state.filledPanels[key] = true;
      updateFillButtonState(key);
      persistControls();
      updateResetButtonUi();
      applyDynamicPanelHeights();
      renderAll();
      if (state.pinnedTooltip) {
        showTooltip(state.pinnedTooltip.content, state.pinnedTooltip.x, state.pinnedTooltip.y);
      }
    }

    function compactSinglePanel(key) {
      const visibleCount = (state.controls.showSegwit ? 1 : 0) + (state.controls.showBip110 ? 1 : 0);
      if (visibleCount === 1) {
        setManualPanelHeight(key, getHalfPanelHeight());
      } else {
        setManualPanelHeight(key, getEqualSplitPanelHeight(visibleCount));
      }
      state.filledPanels[key] = false;
      updateFillButtonState(key);
      persistControls();
      updateResetButtonUi();
      applyDynamicPanelHeights();
      renderAll();
      if (state.pinnedTooltip) {
        showTooltip(state.pinnedTooltip.content, state.pinnedTooltip.x, state.pinnedTooltip.y);
      }
    }

    function setupPanelFillButtons() {
      if (segwitFillHeightBtn) {
        segwitFillHeightBtn.addEventListener("click", () => {
          if (state.filledPanels.segwit) compactSinglePanel("segwit");
          else fillSinglePanelToViewportHeight("segwit");
        });
      }

      if (bip110FillHeightBtn) {
        bip110FillHeightBtn.addEventListener("click", () => {
          if (state.filledPanels.bip110) compactSinglePanel("bip110");
          else fillSinglePanelToViewportHeight("bip110");
        });
      }
    }

    function setupPanelResizeHandles() {
      const bindHandle = (handle, key, box) => {
        const panel = key === "segwit" ? segwitPanel : bip110Panel;
        if (!handle || !box) return;

        handle.addEventListener("pointerdown", (ev) => {
          ev.preventDefault();

          const startY = ev.clientY;
          const startHeight = panel.getBoundingClientRect().height;

          document.body.classList.add("resizing-panel");

          const onPointerMove = (moveEv) => {
            const deltaY = moveEv.clientY - startY;
            const nextHeight = setManualPanelHeight(key, startHeight + deltaY);
            state.filledPanels[key] = false;
            updateFillButtonState(key);
            panel.style.height = `${nextHeight}px`;
            box.style.height = "";
            renderSelectedPanels([key]);
            if (state.pinnedTooltip) {
              showTooltip(state.pinnedTooltip.content, state.pinnedTooltip.x, state.pinnedTooltip.y);
            }
          };

          const stopResize = () => {
            document.body.classList.remove("resizing-panel");
            window.removeEventListener("pointermove", onPointerMove);
            window.removeEventListener("pointerup", stopResize);
            window.removeEventListener("pointercancel", stopResize);
            // Persist only the panel that was actively resized.
            setManualPanelHeight(key, panel.getBoundingClientRect().height);
            persistControls();
            updateResetButtonUi();
          };

          window.addEventListener("pointermove", onPointerMove);
          window.addEventListener("pointerup", stopResize);
          window.addEventListener("pointercancel", stopResize);
        });
      };

      bindHandle(segwitResizeHandle, "segwit", segwitCanvasBox);
      bindHandle(bip110ResizeHandle, "bip110", bip110CanvasBox);
    }

    function drawAxes(ctx, { plot, panelWidth, xScale, yScale, xMax, xAxisLabelMax = xMax, periodSize, title, ticks, showBottomAxis, chart, isMobile }) {
      const colors = getCanvasColors(chart.colors);
      const fg = colors.foreground;
      const yTicks = [0, 250, 500, 750, 1000, 1250, 1500, 1750, 2000];

      ctx.strokeStyle = colors.gridLine;
      ctx.lineWidth = 1;
      yTicks.forEach((t) => {
        const y = yScale(t);
        ctx.beginPath();
        ctx.moveTo(plot.x, y);
        ctx.lineTo(plot.x + plot.w, y);
        ctx.stroke();
      });

      ctx.strokeStyle = colors.axisLine;
      ctx.beginPath();
      ctx.moveTo(plot.x, plot.y);
      ctx.lineTo(plot.x, plot.y + plot.h);
      ctx.lineTo(plot.x + plot.w, plot.y + plot.h);
      ctx.stroke();

      ctx.fillStyle = fg;
      ctx.font = `${isMobile ? 10 : 11}px "IBM Plex Mono", monospace`;
      ctx.textAlign = "right";
      ctx.textBaseline = "middle";
      const yTickLabelPad = 8;
      const yTickLabelX = plot.x - yTickLabelPad;
      const maxYTickWidth = yTicks.reduce((maxW, t) => {
        return Math.max(maxW, ctx.measureText(String(t)).width);
      }, 0);
      yTicks.forEach((t) => {
        ctx.fillText(String(t), yTickLabelX, yScale(t));
      });

      const yAxisLabelFontSize = isMobile ? 11 : 12;
      const yAxisLabelHalfThickness = yAxisLabelFontSize * 0.55;
      const yAxisLabelPadFromTicks = isMobile ? 6 : 8;
      const yAxisLabelPadFromPanel = isMobile ? 4 : 6;
      const minLeftPanelPad = isMobile ? 4 : 6;
      const yAxisLabelX = Math.max(
        minLeftPanelPad + yAxisLabelPadFromPanel + yAxisLabelHalfThickness,
        yTickLabelX - maxYTickWidth - yAxisLabelPadFromTicks - yAxisLabelHalfThickness
      );

      ctx.save();
      ctx.translate(yAxisLabelX, plot.y + plot.h / 2);
      ctx.rotate(-Math.PI / 2);
      ctx.fillStyle = fg;
      ctx.font = `${yAxisLabelFontSize}px "Space Grotesk", sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(chart.axis_labels.y, 0, 0);
      ctx.restore();

      ctx.fillStyle = fg;
      const titleFontSize = isMobile ? 11 : 13;
      const titleLeftPad = isMobile ? 10 : 12;
      const titleRightPad = isMobile ? 40 : 44;
      ctx.font = `${titleFontSize}px "Space Grotesk", sans-serif`;
      const titleWidth = ctx.measureText(String(title || "")).width;
      const centeredMaxWidth = Math.max(40, Number(panelWidth || 0) - titleLeftPad - titleRightPad);
      const canCenterTitle = titleWidth <= centeredMaxWidth;
      ctx.textAlign = canCenterTitle ? "center" : "left";
      ctx.textBaseline = "bottom";
      ctx.fillText(title, canCenterTitle ? (plot.x + plot.w / 2) : titleLeftPad, plot.y - 28);

      ctx.textAlign = "center";
      ctx.textBaseline = "bottom";
      ctx.font = `${isMobile ? 10 : 11}px "IBM Plex Mono", monospace`;
      ctx.strokeStyle = colors.tickMark;
      ctx.lineWidth = 1;
      ticks.forEach((tick) => {
        const x = xScale(Number(tick.x));
        ctx.beginPath();
        ctx.moveTo(x, plot.y);
        ctx.lineTo(x, plot.y - (isMobile ? 5 : 6));
        ctx.stroke();
        ctx.fillStyle = fg;
        ctx.fillText(String(tick.label), x, plot.y - 8);
      });

      if (showBottomAxis) {
        ctx.font = `${isMobile ? 10 : 11}px "IBM Plex Mono", monospace`;
        for (let i = 1; i <= xAxisLabelMax; i += 1) {
          const x = xScale(i);
          ctx.fillStyle = fg;
          ctx.textBaseline = "top";
          ctx.fillText(String(i), x, plot.y + plot.h + 6);
        }

        ctx.fillStyle = fg;
        ctx.font = `${isMobile ? 11 : 12}px "Space Grotesk", sans-serif`;
        ctx.textBaseline = "bottom";
        ctx.fillText(chart.axis_labels.x_bottom, plot.x + plot.w / 2, plot.y + plot.h + (isMobile ? 34 : 38));
      }
    }

    function formatPeriodTooltip(data, chartType) {
      if (chartType === "segwit") {
        const signal = Number(data.signal_blocks || 0);
        const periodSize = Number(state?.data?.metadata?.chart?.period_size || 2016);
        const non = clamp(periodSize - signal, 0, periodSize);
        return [
          `SegWit period ${data.period}`,
          `Height ${Number(data.period_start_height).toLocaleString()}-${Number(data.period_end_height).toLocaleString()}`,
          `Signaling ${signal.toLocaleString()} (${pctLabel(signal, periodSize)})`,
          `Non-signaling ${non.toLocaleString()}`,
        ].join("\n");
      }

      const signal = Number(data.signal_blocks || 0);
      const elapsed = Number(data.elapsed_blocks || 0);
      const periodSize = Number(state?.data?.metadata?.chart?.period_size || 2016);
      const non = clamp(elapsed - signal, 0, periodSize);
      const unmined = clamp(periodSize - elapsed, 0, periodSize);
      const status = String(data.status || "");

      const lines = [
        `BIP-110 period ${data.period}`,
        `Status ${status}`,
        data.period_start_height ? `Height ${Number(data.period_start_height).toLocaleString()}-${Number(data.period_end_height).toLocaleString()}` : "Outside signaling window",
        `Signaling ${signal.toLocaleString()} (${pctLabel(signal, periodSize)})`,
      ];

      if (status === "completed") {
        lines.push(`Non-signaling ${non.toLocaleString()}`);
      } else if (status === "in_progress") {
        lines.push(`Non-signaling ${non.toLocaleString()}`);
        lines.push(`Mined ${elapsed.toLocaleString()} | Unmined ${unmined.toLocaleString()}`);
      } else {
        lines.push(`Mined ${elapsed.toLocaleString()} | Unmined ${unmined.toLocaleString()}`);
      }

      return lines.join("\n");
    }

    function formatReleaseTooltip(data) {
      const when = data.release_time_utc
        ? String(data.release_time_utc)
        : "Date/time unavailable";
      return [
        String(data.label || "Release"),
        when,
      ].join("\n");
    }

    function formatStripeTooltip(data, chartType) {
      const fork = chartType === "segwit" ? "SegWit" : "BIP-110";
      const mode = Number(data.is_signaling) === 1
        ? `Signaling for ${fork}`
        : `Non-signaling for ${fork}`;
      return [
        `Height ${Number(data.height).toLocaleString()}`,
        mode,
      ].join("\n");
    }

    function getReleaseGithubUrl(data) {
      if (data && typeof data.github_url === "string" && data.github_url.trim()) {
        return data.github_url.trim();
      }

      const rawLabel = String(data?.label || "");
      const idx = rawLabel.indexOf(":");
      const prefix = (idx >= 0 ? rawLabel.slice(0, idx) : rawLabel).toLowerCase();
      const version = idx >= 0 ? rawLabel.slice(idx + 1) : "";

      const perPrefixRepo = {
        core: "bitcoin/bitcoin",
        bip110: "dathonohm/bitcoin",
        uasf: "UASF/bitcoin",
        segwit2x: "btc1/bitcoin",
      };

      if (version && perPrefixRepo[prefix]) {
        return `https://github.com/${perPrefixRepo[prefix]}/releases/tag/${encodeURIComponent(version)}`;
      }

      const q = encodeURIComponent(rawLabel || version || "bitcoin release");
      return `https://github.com/search?q=${q}&type=repositories`;
    }

    function findHit(key, x, y) {
      const releases = state.releaseMaps[key];
      for (let i = 0; i < releases.length; i += 1) {
        const r = releases[i];
        const dx = x - r.x;
        const dy = y - r.y;
        if (dx * dx + dy * dy <= r.radius * r.radius) {
          return { type: "release", data: r.data };
        }
      }

      const stripes = state.stripeMaps[key];
      for (let i = 0; i < stripes.length; i += 1) {
        const s = stripes[i];
        if (x >= s.x0 && x <= s.x1 && y >= s.y0 && y <= s.y1) {
          return { type: "stripe", data: s.data };
        }
      }

      const bars = state.barMaps[key];
      for (let i = 0; i < bars.length; i += 1) {
        const b = bars[i];
        if (x >= b.x0 && x <= b.x1 && y >= b.y0 && y <= b.y1) {
          return { type: "period", data: b.data };
        }
      }
      return null;
    }

    function showTooltip(content, clientX, clientY) {
      tooltip.textContent = content;
      const viewportW = window.innerWidth;
      const tipW = tooltip.offsetWidth || 320;
      const edgePad = 12;
      const half = tipW / 2;
      const clampedX = clamp(clientX, edgePad + half, viewportW - edgePad - half);
      tooltip.style.left = `${clampedX}px`;
      tooltip.style.top = `${clientY}px`;
      tooltip.classList.add("show");
    }

    function hideTooltip() {
      if (!state.pinnedTooltip) {
        tooltip.classList.remove("show");
      }
    }

    function attachPointer(canvas, key) {
      canvas.addEventListener("mousemove", (ev) => {
        if (!state.data) return;
        if (state.pinnedTooltip) return;

        const rect = canvas.getBoundingClientRect();
        const x = ev.clientX - rect.left;
        const y = ev.clientY - rect.top;
        const hit = findHit(key, x, y);
        if (!hit) {
          hideTooltip();
          return;
        }

        const content = hit.type === "release"
          ? formatReleaseTooltip(hit.data)
          : hit.type === "stripe"
            ? formatStripeTooltip(hit.data, key)
          : formatPeriodTooltip(hit.data, key);
        showTooltip(content, ev.clientX, ev.clientY);
      });

      canvas.addEventListener("mouseleave", () => {
        hideTooltip();
      });

      canvas.addEventListener("click", (ev) => {
        const rect = canvas.getBoundingClientRect();
        const x = ev.clientX - rect.left;
        const y = ev.clientY - rect.top;
        const hit = findHit(key, x, y);

        if (!hit) {
          state.pinnedTooltip = null;
          hideTooltip();
          return;
        }

        if (hit.type === "stripe") {
          const h = Number(hit.data.height);
          if (Number.isFinite(h)) {
            window.open(`https://mempool.space/block/${h}`, "_blank", "noopener,noreferrer");
          }
          return;
        }

        if (hit.type === "release") {
          const url = getReleaseGithubUrl(hit.data);
          window.open(url, "_blank", "noopener,noreferrer");
          return;
        }

        const content = hit.type === "release"
          ? formatReleaseTooltip(hit.data)
          : hit.type === "stripe"
            ? formatStripeTooltip(hit.data, key)
          : formatPeriodTooltip(hit.data, key);

        state.pinnedTooltip = { content, x: ev.clientX, y: ev.clientY };
        showTooltip(content, ev.clientX, ev.clientY);
      });
    }

    async function loadAndApplyBlockDataPhased(loadToken, metadata, datasetKeys = ["segwit", "bip110"], cacheBust = null) {
      const applyBlocks = async (key, blocks) => {
        if (loadToken !== state.phasedLoadToken || !state.data) return;

        if (key === "segwit") {
          state.staticData.segwitBlocks = blocks;
        } else {
          state.dynamicData.bip110Blocks = blocks;
          state.dynamicData = reconcileBip110PeriodsFromBlocks(state.dynamicData, metadata);
        }

        state.data = buildCombinedData(state.staticData, state.dynamicData, state.data);
        renderSelectedPanels([key]);
        await nextPaint();
      };

      const loadPromises = datasetKeys.map((key) => loadBlockPointsForDataset(key, metadata, cacheBust)
        .then((blocks) => applyBlocks(key, blocks))
        .catch((err) => {
          console.warn(`${key === "segwit" ? "SegWit" : "BIP-110"} block markers failed to load:`, err);
        }));

      await Promise.all(loadPromises);
    }

    function cancelDeferredEnhancement(keys = ["segwit", "bip110"]) {
      keys.forEach((key) => {
        const id = state.deferredEnhancementRaf[key];
        if (id != null) {
          cancelAnimationFrame(id);
          state.deferredEnhancementRaf[key] = null;
        }
      });
    }

    function scheduleDeferredEnhancement(keys) {
      keys.forEach((key) => {
        if (state.deferredEnhancementRaf[key] != null) return;
        state.deferredEnhancementRaf[key] = requestAnimationFrame(() => {
          state.deferredEnhancementRaf[key] = null;
          renderSelectedPanels([key], { enhanced: true });
        });
      });
    }

    function renderSelectedPanels(keys, options = {}) {
      if (!state.data) return;

      const enhanced = options.enhanced !== false;
      const scheduleEnhancements = options.scheduleEnhancements === true;
      const selected = new Set(keys);
      const { metadata } = state.data;
      const segThreshold = Number(metadata.chart.thresholds.segwit.blocks);
      const bipThreshold = Number(metadata.chart.thresholds.bip110.blocks);
      const shouldRenderStripes = enhanced && state.controls.stripes;
      const shouldRenderLabels = enhanced && state.controls.labels;
      const shouldRenderMarkers = enhanced && state.controls.markers;
      const shouldRenderSpecialLabels = enhanced;
      const needsMarkerTypography = shouldRenderMarkers;
      const needsNumericTypography = shouldRenderLabels;
      const sharedMarkerTypography = needsMarkerTypography
        ? getSharedMarkerTypography(
            metadata,
            state.data.segwitReleases,
            state.data.bip110Releases
          )
        : null;
      const sharedNumericTypography = needsNumericTypography
        ? getSharedNumericTypography(
            metadata,
            state.data.segwitPeriods,
            state.data.bip110Periods
          )
        : null;

      if (enhanced) {
        cancelDeferredEnhancement(keys);
      }

      if (selected.has("segwit") && state.controls.showSegwit) {
        drawPanel({
          canvas: segwitCanvas,
          key: "segwit",
          title: "SegWit (BIP-141) Signaling Periods",
          periods: state.data.segwitPeriods,
          blocks: state.data.segwitBlocks,
          releases: state.data.segwitReleases,
          ticks: state.data.segwitTicks,
          threshold: segThreshold,
          thresholdPct: Number(metadata.chart.thresholds.segwit.pct),
          showBottomAxis: true,
          markerTypography: sharedMarkerTypography,
          numericTypography: sharedNumericTypography,
          renderStripes: shouldRenderStripes,
          renderLabels: shouldRenderLabels,
          renderMarkers: shouldRenderMarkers,
          renderSpecialLabels: shouldRenderSpecialLabels,
        });
      }

      if (selected.has("bip110") && state.controls.showBip110) {
        drawPanel({
          canvas: bip110Canvas,
          key: "bip110",
          title: "Reduced Data Temporary Softfork (BIP-110) Signaling Periods",
          periods: state.data.bip110Periods,
          blocks: state.data.bip110Blocks,
          releases: state.data.bip110Releases,
          ticks: state.data.bip110Ticks,
          threshold: bipThreshold,
          thresholdPct: Number(metadata.chart.thresholds.bip110.pct),
          showBottomAxis: true,
          specialLabels: metadata.chart.special_period_labels,
          markerTypography: sharedMarkerTypography,
          numericTypography: sharedNumericTypography,
          renderStripes: shouldRenderStripes,
          renderLabels: shouldRenderLabels,
          renderMarkers: shouldRenderMarkers,
          renderSpecialLabels: shouldRenderSpecialLabels,
        });
      }

      if (scheduleEnhancements) {
        scheduleDeferredEnhancement(keys);
      }
    }

    function renderAll() {
      renderSelectedPanels(["segwit", "bip110"]);
    }

    function setControlHandlers() {
      const stripes = document.getElementById("toggleStripes");
      const markers = document.getElementById("toggleMarkers");
      const labels = document.getElementById("toggleLabels");
      const segwitWindow = document.getElementById("toggleSegwitWindow");
      const bip110Window = document.getElementById("toggleBip110Window");
      const copyDashboardLinkButton = document.getElementById("copyDashboardLink");
      const resetDashboardButton = document.getElementById("resetDashboard");

      stripes.addEventListener("change", () => {
        state.controls.stripes = stripes.checked;
        state.controls.stripesExplicit = true;
        persistControls();
        updateResetButtonUi();
        renderAll();
      });

      markers.addEventListener("change", () => {
        state.controls.markers = markers.checked;
        persistControls();
        updateResetButtonUi();
        renderAll();
      });

      labels.addEventListener("change", () => {
        state.controls.labels = labels.checked;
        persistControls();
        updateResetButtonUi();
        renderAll();
      });

      segwitWindow.addEventListener("change", () => {
        if (!segwitWindow.checked && !bip110Window.checked) {
          bip110Window.checked = true;
        }
        state.controls.showSegwit = segwitWindow.checked;
        state.controls.showBip110 = bip110Window.checked;
        persistControls();
        updateResetButtonUi();
        updatePanelVisibility();
        renderAll();
      });

      bip110Window.addEventListener("change", () => {
        if (!segwitWindow.checked && !bip110Window.checked) {
          segwitWindow.checked = true;
        }
        state.controls.showSegwit = segwitWindow.checked;
        state.controls.showBip110 = bip110Window.checked;
        persistControls();
        updateResetButtonUi();
        updatePanelVisibility();
        renderAll();
      });

      copyDashboardLinkButton?.addEventListener("click", async () => {
        try {
          await copyDashboardLinkToClipboard(copyDashboardLinkButton);
        } catch (err) {
          console.error(err);
        }
      });

      resetDashboardButton?.addEventListener("click", () => {
        if (!state.preResetStateSnapshot && isDefaultState()) {
          updateResetButtonUi();
          return;
        }
        if (state.preResetStateSnapshot) {
          restorePreviousDashboardState();
        } else {
          restoreDashboardDefaults();
        }
      });
    }

    function showError(message) {
      const error = document.createElement("div");
      error.className = "error";
      error.innerHTML = `${message}<br><br>Tip: if this page is opened with file://, load it from a simple local server so fetch() can read CSV files.`;
      document.querySelector("main").prepend(error);
    }

    async function init() {
      try {
        const loadToken = ++state.phasedLoadToken;
        state.timeZone = getPreferredDashboardTimeZone();
        const restoredPersistedControls = restorePersistedControls();
        if (!restoredPersistedControls) {
          applyNarrowWindowDefaults();

          state.controls.showSegwit = false;
          state.controls.showBip110 = true;
          state.filledPanels.segwit = false;
          state.filledPanels.bip110 = true;
          state.manualPanelHeights.segwit = null;
          state.manualPanelHeightRatios.segwit = null;
           state.manualPanelHeights.bip110 = null;
           state.manualPanelHeightRatios.bip110 = null;

          const segwitWindow = document.getElementById("toggleSegwitWindow");
          const bip110Window = document.getElementById("toggleBip110Window");
          if (segwitWindow) segwitWindow.checked = false;
          if (bip110Window) bip110Window.checked = true;

          persistControls();
        }
        applyDashboardShareStateFromUrl();
        applyPanelOrder();
        applyDynamicPanelHeights();
        setControlsEnabled(false);
        setPanelLoadersVisible(true);
        const [staticMetadataResult, dynamicMetadataResult] = await Promise.all([
          loadStaticMetadataOnly(),
          loadDynamicMetadataOnly(),
        ]);
        state.staticData = {
          metadata: staticMetadataResult.metadata,
          segwitPeriods: [],
          segwitBlocks: [],
          segwitReleases: [],
          segwitTicks: [],
        };
        state.dynamicData = {
          metadata: dynamicMetadataResult.metadata,
          signature: dynamicMetadataResult.signature,
          bip110Periods: [],
          bip110Blocks: [],
          bip110Releases: [],
          bip110Ticks: [],
        };
        state.data = buildCombinedData(state.staticData, state.dynamicData);
        state.dataSignature = dynamicMetadataResult.signature;
        setStatus(state.data);
        await nextPaint();
        [state.staticData, state.dynamicData] = await Promise.all([
          loadStaticData(staticMetadataResult.metadata),
          loadDynamicData(null, dynamicMetadataResult.metadata, dynamicMetadataResult.signature),
        ]);
        state.data = buildCombinedData(state.staticData, state.dynamicData);
        state.dataSignature = state.dynamicData.signature || dynamicMetadataResult.signature;
        state.lastSuccessfulRefreshAt = Date.now();
        setStatus(state.data);
        setControlHandlers();
        setupSwapButton();
        applyPanelOrder();
        setupPanelFillButtons();
        updateFillButtonState("segwit");
        updateFillButtonState("bip110");
        setupPanelResizeHandles();
        updatePanelVisibility();
        attachPointer(segwitCanvas, "segwit");
        attachPointer(bip110Canvas, "bip110");
        updateResetButtonUi();
        setupRefreshWakeEvents();
        startAutoRefresh();
        renderSelectedPanels(["segwit", "bip110"], { enhanced: false, scheduleEnhancements: true });
        setPanelLoaderVisible("segwit", false);
        setPanelLoaderVisible("bip110", false);
        if (loadToken !== state.phasedLoadToken) return;

        await loadAndApplyBlockDataPhased(loadToken, state.data.metadata, ["segwit", "bip110"]);
        setControlsEnabled(true);
        updateResetButtonUi();
        // Ensure button state is properly set after all rendering and loading completes
        if (typeof window.requestIdleCallback === 'function') {
          window.requestIdleCallback(() => updateResetButtonUi(), { timeout: 500 });
        } else {
          window.setTimeout(() => updateResetButtonUi(), 100);
        }

        window.addEventListener("resize", () => {
          syncManualPanelHeightsToViewport();
          applyDynamicPanelHeights();
          renderAll();
          if (state.pinnedTooltip) {
            showTooltip(state.pinnedTooltip.content, state.pinnedTooltip.x, state.pinnedTooltip.y);
          }
        });

        window.addEventListener("keydown", (ev) => {
          if (ev.key === "Escape") {
            state.pinnedTooltip = null;
            hideTooltip();
          }
        });

        window.addEventListener("storage", (ev) => {
          if (!DASHBOARD_TIME?.STORAGE_KEY || ev.key !== DASHBOARD_TIME.STORAGE_KEY) return;
          const newTz = DASHBOARD_TIME.getPreferredTimeZone?.() || "UTC";
          if (newTz !== state.timeZone) {
            state.timeZone = newTz;
            if (state.data) setStatus(state.data);
          }
        });
      } catch (err) {
        console.error(err);
        setPanelLoadersVisible(false);
        showError(String(err.message || err));
        setControlsEnabled(true);
      }
    }

    init();
