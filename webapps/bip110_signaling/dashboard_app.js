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
          : 'dark');
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
    const CONTROLS_STORAGE_KEY = "bip110_signaling_controls_v3";
    const BIP110_OVERLAY_SELECTIONS_STORAGE_KEY = "bip110_signaling_overlay_selections_v2";
    const PANEL_RESIZE_MIN_HEIGHT = 220;
    const PANEL_RESIZE_VIEWPORT_PAD = 24;
    const PANEL_RESIZE_SNAP_PX = 18;
    const EXPECTED_FORK_HEIGHT = 961632;
    const EXPECTED_BLOCK_INTERVAL_MS = 10 * 60 * 1000;
    const MAX_DOWNWARD_DIFFICULTY_ADJUSTMENT = 4;
    const DASHBOARD_TIME = window.WSBDashboardTime || null;
    const SHARE_STATE_PARAM = "bip110_state";
    const LOCAL_RUNTIME_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);
    const IS_LOCAL_RUNTIME = LOCAL_RUNTIME_HOSTS.has(window.location.hostname);
    const missingMinerIconSlugs = new Set();
    window.__bip110MinerIconMissing = (slug) => {
      const safeSlug = String(slug || "").trim().toLowerCase();
      if (/^[a-z0-9-]+$/.test(safeSlug)) {
        missingMinerIconSlugs.add(safeSlug);
      }
    };

    const ICONS = {
      copyLink: '<svg viewBox="0 0 24 24" focusable="false" aria-hidden="true"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"></path><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"></path></svg>',
      copyCopied: '<svg viewBox="0 0 24 24" focusable="false" aria-hidden="true"><path d="M20 6 9 17l-5-5"></path></svg>',
      resetDefaults: '<svg viewBox="0 0 24 24" focusable="false" aria-hidden="true"><path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8"></path><path d="M21 3v5h-5"></path></svg>',
      resetUndo: '<svg viewBox="0 0 24 24" focusable="false" aria-hidden="true"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"></path><path d="M3 3v5h5"></path></svg>',
    };

    function setButtonIcon(iconId, markup) {
      const iconEl = document.getElementById(iconId);
      if (!iconEl || !markup) return;
      iconEl.outerHTML = markup.replace('<svg ', `<svg id="${iconId}" `);
    }

    function isMobileUiViewport() {
      return window.matchMedia("(max-width: 820px)").matches;
    }

    function setCustomTooltip(el, text) {
      if (!el) return;
      const value = String(text || "").trim();
      if (value) {
        el.setAttribute("data-tooltip", value);
      } else {
        el.removeAttribute("data-tooltip");
      }
      el.removeAttribute("title");
    }

    let customTooltipBound = false;
    let customTooltipAnchor = null;

    function ensureCustomTooltipElement() {
      let tooltip = document.getElementById("dashboardInlineTooltip");
      if (!tooltip) {
        tooltip = document.createElement("div");
        tooltip.id = "dashboardInlineTooltip";
        tooltip.className = "dashboard-inline-tooltip";
        document.body.appendChild(tooltip);
      }
      return tooltip;
    }

    function hideCustomTooltip() {
      const tooltip = document.getElementById("dashboardInlineTooltip");
      if (!tooltip) return;
      tooltip.classList.remove("is-visible");
    }

    function placeCustomTooltip(tooltip, x, y) {
      const viewportWidth = window.innerWidth;
      const viewportHeight = window.innerHeight;
      const offset = 14;

      let left = x + offset;
      let top = y + offset;

      const maxLeft = viewportWidth - tooltip.offsetWidth - 8;
      const maxTop = viewportHeight - tooltip.offsetHeight - 8;

      if (left > maxLeft) left = Math.max(8, x - tooltip.offsetWidth - offset);
      if (top > maxTop) top = Math.max(8, y - tooltip.offsetHeight - offset);

      tooltip.style.left = `${left}px`;
      tooltip.style.top = `${top}px`;
    }

    function showCustomTooltip(anchor, x, y) {
      const text = String(anchor?.getAttribute("data-tooltip") || "").trim();
      if (!text) {
        hideCustomTooltip();
        return;
      }

      const tooltip = ensureCustomTooltipElement();
      tooltip.textContent = text;
      tooltip.classList.add("is-visible");
      placeCustomTooltip(tooltip, x, y);
    }

    function bindCustomTooltips() {
      if (customTooltipBound) return;
      customTooltipBound = true;
      let mobileTooltipHideTimerId = null;

      const clearMobileTooltipHideTimer = () => {
        if (mobileTooltipHideTimerId !== null) {
          window.clearTimeout(mobileTooltipHideTimerId);
          mobileTooltipHideTimerId = null;
        }
      };

      const shouldSuppressTooltipForAnchor = (anchor) => {
        if (isPeriodGridOverlayOpen() || isMinerTimelineOverlayOpen()) return true;
        if (!anchor) return true;
        if (!isMobileUiViewport()) return false;
        if (anchor instanceof Element && anchor.closest("#scriptBars .bar-stack-track")) {
          return false;
        }
        if (
          anchor instanceof HTMLElement
          && anchor.classList.contains("tag")
          && (anchor.classList.contains("tag-spend-never")
            || anchor.classList.contains("tag-spend-inactive")
            || anchor.classList.contains("tag-spend-active"))
        ) {
          return false;
        }
        return !(anchor instanceof HTMLElement && anchor.disabled);
      };

      document.addEventListener("mouseover", (event) => {
        const anchor = event.target instanceof Element ? event.target.closest("[data-tooltip]") : null;
        if (shouldSuppressTooltipForAnchor(anchor)) {
          if (customTooltipAnchor === anchor) {
            customTooltipAnchor = null;
          }
          hideCustomTooltip();
          return;
        }
        if (!anchor) return;
        customTooltipAnchor = anchor;
        showCustomTooltip(anchor, event.clientX, event.clientY);
      });

      document.addEventListener("mousemove", (event) => {
        if (!customTooltipAnchor) return;
        const tooltip = document.getElementById("dashboardInlineTooltip");
        if (!tooltip || !tooltip.classList.contains("is-visible")) return;
        placeCustomTooltip(tooltip, event.clientX, event.clientY);
      });

      document.addEventListener("mouseout", (event) => {
        if (!customTooltipAnchor) return;
        const related = event.relatedTarget;
        if (related instanceof Node && customTooltipAnchor.contains(related)) return;
        customTooltipAnchor = null;
        clearMobileTooltipHideTimer();
        hideCustomTooltip();
      });

      document.addEventListener("touchstart", (event) => {
        const anchor = event.target instanceof Element ? event.target.closest("[data-tooltip]") : null;
        if (shouldSuppressTooltipForAnchor(anchor)) {
          customTooltipAnchor = null;
          clearMobileTooltipHideTimer();
          hideCustomTooltip();
          return;
        }

        const touch = event.touches && event.touches.length ? event.touches[0] : null;
        const rect = anchor.getBoundingClientRect();
        const x = touch ? touch.clientX : rect.left + (rect.width / 2);
        const y = touch ? touch.clientY : rect.top + (rect.height / 2);
        customTooltipAnchor = anchor;
        showCustomTooltip(anchor, x, y);

        clearMobileTooltipHideTimer();
        mobileTooltipHideTimerId = window.setTimeout(() => {
          if (customTooltipAnchor === anchor) {
            customTooltipAnchor = null;
          }
          hideCustomTooltip();
          mobileTooltipHideTimerId = null;
        }, 1800);
      }, { passive: true });

      window.addEventListener("scroll", () => {
        if (!customTooltipAnchor) return;
        clearMobileTooltipHideTimer();
        hideCustomTooltip();
      }, { passive: true });
    }

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
      mobilePendingActivation: null,
      hoverTooltip: null,
      periodGridDataset: "bip110",
      periodGridSelectedPeriod: null,
      periodGridNodeView: "legacy",
      leaderboardWindow: "all",
      minerTimelineWindow: "past14d",
      minerTimelineNodeView: "legacy",
      minerTimelineMiners: "all",
      minerTimelineOrder: "recent",
      minerTimelineSignalersFirst: true,
      controls: {
        stripes: true,
        stripesExplicit: false,
        blockSymbol: "square",
        markers: true,
        labels: true,
        showSegwit: false,
        showBip110: true,
        showLegacyNode: true,
        showBip110Node: false,
        panelsSwapped: false,
      },
      manualPanelHeights: {
        segwit: null,
        bip110: null,
        bip110Node: null,
      },
      manualPanelHeightRatios: {
        segwit: null,
        bip110: null,
        bip110Node: null,
      },
      filledPanels: {
        segwit: true,
        bip110: true,
        bip110Node: true,
      },
      lastVisibleCount: -1,
      hitMaps: {
        segwit: [],
        bip110: [],
        bip110Node: [],
      },
      releaseMaps: {
        segwit: [],
        bip110: [],
        bip110Node: [],
      },
      stripeMaps: {
        segwit: [],
        bip110: [],
        bip110Node: [],
      },
      barMaps: {
        segwit: [],
        bip110: [],
        bip110Node: [],
      },
      deferredEnhancementRaf: {
        segwit: null,
        bip110: null,
        bip110Node: null,
      },
      dpr: Math.max(1, window.devicePixelRatio || 1),
      timeZone: DASHBOARD_TIME?.getPreferredTimeZone?.() || "UTC",
    };

    const segwitCanvas = document.getElementById("segwitCanvas");
    const bip110Canvas = document.getElementById("bip110Canvas");
    const bip110NodeCanvas = document.getElementById("bip110NodeCanvas");
    const segwitPanel = document.getElementById("segwitPanel");
    const bip110Panel = document.getElementById("bip110Panel");
    const bip110NodePanel = document.getElementById("bip110NodePanel");
    const segwitCanvasBox = document.getElementById("segwitCanvasBox");
    const bip110CanvasBox = document.getElementById("bip110CanvasBox");
    const bip110NodeCanvasBox = document.getElementById("bip110NodeCanvasBox");
    const dashboardLoader = document.getElementById("dashboardLoader");
    const segwitLoader = document.getElementById("segwitLoader");
    const bip110Loader = document.getElementById("bip110Loader");
    const bip110NodeLoader = document.getElementById("bip110NodeLoader");
    const mainWrap = document.getElementById("mainWrap");
    const topbar = document.getElementById("topbar");
    const statusChips = document.getElementById("statusChips");
    const tooltip = document.getElementById("tooltip");
    const periodGridTooltip = document.getElementById("periodGridTooltip");
    const periodGridBtn = document.getElementById("periodGridBtn");
    const leaderboardBtn = document.getElementById("leaderboardBtn");
    const minerTimelineBtn = document.getElementById("minerTimelineBtn");
    const periodGridOverlay = document.getElementById("periodGridOverlay");
    const periodGridDialog = document.getElementById("periodGridDialog");
    const periodGridHeader = document.getElementById("periodGridHeader");
    const periodGridLegend = document.getElementById("periodGridLegend");
    const periodGridClose = document.getElementById("periodGridClose");
    const periodGridPeriodChip = document.getElementById("periodGridPeriodChip");
    const periodGridPeriodLabel = document.getElementById("periodGridPeriodLabel");
    const periodGridPeriodSelect = document.getElementById("periodGridPeriodSelect");
    const periodGridRangeValue = document.getElementById("periodGridRangeValue");
    const periodGridSignalValue = document.getElementById("periodGridSignalValue");
    const periodGridContent = document.getElementById("periodGridContent");
    const periodGridLowActivityLegendItem = document.getElementById("periodGridLowActivityLegendItem");
    const periodGridNodeControls = document.getElementById("periodGridNodeControls");
    const periodGridNodeButtons = Array.from(document.querySelectorAll("[data-period-grid-node]"));
    const leaderboardOverlay = document.getElementById("leaderboardOverlay");
    const leaderboardDialog = document.getElementById("leaderboardDialog");
    const leaderboardClose = document.getElementById("leaderboardClose");
    const leaderboardTotalValue = document.getElementById("leaderboardTotalValue");
    const leaderboardRangeValue = document.getElementById("leaderboardRangeValue");
    const leaderboardWindowButtons = Array.from(document.querySelectorAll("[data-leaderboard-window]"));
    const leaderboardContent = document.getElementById("leaderboardContent");
    const minerTimelineOverlay = document.getElementById("minerTimelineOverlay");
    const minerTimelineDialog = document.getElementById("minerTimelineDialog");
    const minerTimelineClose = document.getElementById("minerTimelineClose");
    const minerTimelineContent = document.getElementById("minerTimelineContent");
    const minerTimelineRangeValue = document.getElementById("minerTimelineRangeValue");
    const minerTimelineSignalValue = document.getElementById("minerTimelineSignalValue");
    const minerTimelineNodeButtons = Array.from(document.querySelectorAll("[data-miner-timeline-node]"));
    const minerTimelineWindowButtons = Array.from(document.querySelectorAll("[data-miner-timeline-window]"));
    const minerTimelineMinerButtons = Array.from(document.querySelectorAll("[data-miner-timeline-miners]"));
    const minerTimelineOrderButtons = Array.from(document.querySelectorAll("[data-miner-timeline-order]"));
    const minerTimelineSignalersFirst = document.getElementById("minerTimelineSignalersFirst");
    const vizInfoBtn = document.getElementById("vizInfoBtn");
    const segwitResizeHandle = document.getElementById("segwitResizeHandle");
    const bip110ResizeHandle = document.getElementById("bip110ResizeHandle");
    const bip110NodeResizeHandle = document.getElementById("bip110NodeResizeHandle");
    const segwitFillHeightBtn = document.getElementById("segwitFillHeightBtn");
    const bip110FillHeightBtn = document.getElementById("bip110FillHeightBtn");
    const bip110NodeFillHeightBtn = document.getElementById("bip110NodeFillHeightBtn");
    const swapPanelsBtn = document.getElementById("swapPanelsBtn");
    const nodePanelButtons = Array.from(document.querySelectorAll("[data-node-panel]"));
    const PANEL_KEYS = ["segwit", "bip110", "bip110Node"];
    const BIP110_PANEL_KEYS = ["bip110", "bip110Node"];
    const dashboardControlLock = window.WSBDashboardShared?.createDashboardControlLock?.({
      topbar,
      extraControls: [
        segwitResizeHandle,
        bip110ResizeHandle,
        bip110NodeResizeHandle,
        segwitFillHeightBtn,
        bip110FillHeightBtn,
        bip110NodeFillHeightBtn,
        ...nodePanelButtons,
      ],
    });

    function setControlsEnabled(enabled) {
      state.controlsEnabled = Boolean(enabled);
      if (dashboardControlLock) {
        dashboardControlLock.setEnabled(enabled);
        syncSwapButtonEnabledState();
        syncNodePanelButtons();
        updateResetButtonUi();
        return;
      }

      topbar.classList.toggle("ui-locked", !enabled);

      [
        vizInfoBtn,
        periodGridBtn,
        leaderboardBtn,
        minerTimelineBtn,
        swapPanelsBtn,
        segwitFillHeightBtn,
        bip110FillHeightBtn,
        bip110NodeFillHeightBtn,
        segwitResizeHandle,
        bip110ResizeHandle,
        bip110NodeResizeHandle,
        ...nodePanelButtons,
        ...topbar.querySelectorAll('input[type="checkbox"]'),
        ...topbar.querySelectorAll('select'),
      ].filter(Boolean).forEach((control) => {
        control.disabled = !enabled;
      });

      syncSwapButtonEnabledState();
      syncNodePanelButtons();
      updateResetButtonUi();
    }

    function isBip110PanelKey(key) {
      return key === "bip110" || key === "bip110Node";
    }

    function chartTypeForPanelKey(key) {
      return isBip110PanelKey(key) ? "bip110" : "segwit";
    }

    function getPanelElement(key) {
      if (key === "segwit") return segwitPanel;
      if (key === "bip110Node") return bip110NodePanel;
      return bip110Panel;
    }

    function getCanvasBoxElement(key) {
      if (key === "segwit") return segwitCanvasBox;
      if (key === "bip110Node") return bip110NodeCanvasBox;
      return bip110CanvasBox;
    }

    function getCanvasElement(key) {
      if (key === "segwit") return segwitCanvas;
      if (key === "bip110Node") return bip110NodeCanvas;
      return bip110Canvas;
    }

    function getFillButtonElement(key) {
      if (key === "segwit") return segwitFillHeightBtn;
      if (key === "bip110Node") return bip110NodeFillHeightBtn;
      return bip110FillHeightBtn;
    }

    function getVisibleBip110PanelKeys() {
      if (!state.controls.showBip110) return [];
      return BIP110_PANEL_KEYS.filter((key) => key === "bip110" ? state.controls.showLegacyNode : state.controls.showBip110Node);
    }

    function getVisiblePanelKeys() {
      const keys = [];
      if (state.controls.showSegwit) keys.push("segwit");
      keys.push(...getVisibleBip110PanelKeys());
      return keys;
    }

    function getVisibleChartCanvases() {
      return getVisiblePanelKeys()
        .map(getCanvasElement)
        .filter(Boolean);
    }

    function getPanelLabel(key) {
      if (key === "segwit") return "SegWit";
      if (key === "bip110Node") return "BIP-110 node";
      return "Legacy node";
    }

    function syncSwapButtonEnabledState() {
      if (!swapPanelsBtn) return;
      swapPanelsBtn.disabled = getVisiblePanelKeys().length < 2;
    }

    function enforceNodePanelSelectionRules() {
      if (!state.controls.showLegacyNode && !state.controls.showBip110Node) {
        state.controls.showLegacyNode = true;
      }
      const bothNodesSelected = Boolean(state.controls.showLegacyNode && state.controls.showBip110Node);
      if (bothNodesSelected && state.controls.showSegwit) {
        state.controls.showSegwit = false;
      }
    }

    function ensureAtLeastOnePanelVisible(preferredKey = "bip110") {
      enforceNodePanelSelectionRules();
      if (getVisiblePanelKeys().length > 0) return false;
      if (preferredKey === "segwit") {
        state.controls.showSegwit = true;
      } else {
        state.controls.showBip110 = true;
        state.controls.showLegacyNode = true;
      }
      return true;
    }

    function syncNodePanelButtons() {
      enforceNodePanelSelectionRules();
      nodePanelButtons.forEach((button) => {
        const key = button.getAttribute("data-node-panel");
        const pressed = key === "legacy" ? state.controls.showLegacyNode : state.controls.showBip110Node;
        button.classList.toggle("is-active", Boolean(pressed));
        button.setAttribute("aria-pressed", pressed ? "true" : "false");
        button.disabled = !state.controlsEnabled || !state.controls.showBip110;
      });
    }

    function syncPanelCheckboxes() {
      enforceNodePanelSelectionRules();
      const segwitWindow = document.getElementById("toggleSegwitWindow");
      const bip110Window = document.getElementById("toggleBip110Window");
      const bothNodesSelected = Boolean(state.controls.showLegacyNode && state.controls.showBip110Node);
      if (segwitWindow) {
        segwitWindow.checked = state.controls.showSegwit;
        segwitWindow.disabled = bothNodesSelected || !state.controlsEnabled;
        setCustomTooltip(
          segwitWindow.closest("label"),
          bothNodesSelected
            ? "SegWit periods are unavailable while both Legacy and BIP-110 node panels are shown."
            : ""
        );
      }
      if (bip110Window) {
        bip110Window.checked = state.controls.showBip110;
        bip110Window.disabled = !state.controlsEnabled;
      }
      syncNodePanelButtons();
    }

    function getDashboardLoaderHeight() {
      const wrapStyle = getComputedStyle(mainWrap);
      const padTop = parseFloat(wrapStyle.paddingTop) || 0;
      const padBottom = parseFloat(wrapStyle.paddingBottom) || 0;
      const gap = parseFloat(wrapStyle.rowGap || wrapStyle.gap) || 0;
      const viewportH = window.innerHeight;
      const topbarH = topbar.getBoundingClientRect().height;
      return Math.max(PANEL_RESIZE_MIN_HEIGHT, Math.floor(viewportH - topbarH - padTop - padBottom - gap));
    }

    function setDashboardLoaderVisible(visible) {
      if (!dashboardLoader) return;
      if (visible) {
        dashboardLoader.style.height = `${getDashboardLoaderHeight()}px`;
      }
      dashboardLoader.classList.toggle("hidden", !visible);
    }

    function setPanelLoadersVisible(visible) {
      setDashboardLoaderVisible(visible);
      [segwitLoader, bip110Loader].forEach((loader) => {
        if (!loader) return;
        loader.classList.add("hidden");
      });
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

    function formatGeneratedDateTimeForSelectedTimeZone(value) {
      const raw = String(value || "").trim();
      if (!raw) return "n/a";

      const parsed = parseUtcTimestamp(raw);
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

    function parseUtcTimestamp(value) {
      const raw = String(value || "").trim();
      if (!raw) return new Date(NaN);
      const normalized = raw
        .replace(/\s+UTC$/i, "Z")
        .replace(/^(\d{4}-\d{2}-\d{2})\s+(\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?)Z$/, "$1T$2Z");
      return new Date(normalized);
    }

    function estimateExpectedForkDate(meta) {
      const sourceHeight = Number(meta?.source_block_height);
      const sourceTime = parseUtcTimestamp(meta?.source_block_time_utc || meta?.generated_utc);
      if (!Number.isFinite(sourceHeight) || sourceHeight <= 0 || Number.isNaN(sourceTime.getTime())) {
        return null;
      }

      const blocksRemaining = Math.max(0, EXPECTED_FORK_HEIGHT - sourceHeight);
      return {
        height: EXPECTED_FORK_HEIGHT,
        blocksRemaining,
        date: new Date(sourceTime.getTime() + blocksRemaining * EXPECTED_BLOCK_INTERVAL_MS),
      };
    }

    function getNodeSyncStatus(meta) {
      const sync = meta?.node_sync;
      if (!sync || typeof sync !== "object") {
        return {
          ok: null,
          relation: "missing",
          tooltip: "Node sync status is not available in this metadata bundle.",
        };
      }

      const legacyHeight = Number(sync.legacy_height);
      const bip110Height = Number(sync.bip110_height);
      const heightDelta = Number(sync.height_delta);
      const blocksBehind = Number(sync.blocks_behind);
      const latestCommonHeight = Number(sync.latest_common_height);
      const blocksSinceCommon = Number(sync.blocks_since_common_height);
      const attempts = Number(sync.attempts);
      const maxAttempts = Number(sync.max_attempts);
      const checkedText = sync.checked_utc
        ? formatGeneratedDateTimeForSelectedTimeZone(sync.checked_utc)
        : "";
      const legacyText = Number.isFinite(legacyHeight) ? legacyHeight.toLocaleString("en-US") : "n/a";
      const bip110Text = Number.isFinite(bip110Height) ? bip110Height.toLocaleString("en-US") : "n/a";
      const heightDeltaText = Number.isFinite(heightDelta) ? heightDelta.toLocaleString("en-US") : "n/a";
      const behindText = Number.isFinite(blocksBehind) ? blocksBehind.toLocaleString("en-US") : "n/a";
      const commonText = Number.isFinite(latestCommonHeight) ? latestCommonHeight.toLocaleString("en-US") : "n/a";
      const sinceCommonText = Number.isFinite(blocksSinceCommon) ? blocksSinceCommon.toLocaleString("en-US") : "n/a";
      const attemptsText = Number.isFinite(attempts) && Number.isFinite(maxAttempts)
        ? `${attempts.toLocaleString("en-US")} / ${maxAttempts.toLocaleString("en-US")}`
        : "n/a";
      const relationText = String(sync.relation || "unknown").replace(/_/g, " ");
      const errorText = sync.error ? ` Error: ${sync.error}` : "";
      const hashText = sync.bip110_hash_at_legacy_height
        ? " The BIP-110 hash at the legacy height matched the legacy block hash."
        : "";
      const aheadText = sync.relation === "bip110_ahead"
        ? " The BIP-110 node was ahead, but the earlier legacy-height block matched, so it is treated as in sync."
        : "";
      const checkedSuffix = checkedText ? ` Checked ${checkedText}.` : "";

      return {
        ok: Boolean(sync.in_sync),
        relation: relationText,
        tooltip: `Compares the legacy source node tip against the local BIP-110 node. Legacy height: ${legacyText}. BIP-110 height: ${bip110Text}. Height delta: ${heightDeltaText}. BIP-110 blocks behind: ${behindText}. Latest common height: ${commonText}. Blocks since latest common height: ${sinceCommonText}. Attempts: ${attemptsText}. Relation: ${relationText}.${hashText}${aheadText}${checkedSuffix}${errorText}`,
      };
    }

      const SELECT_DROPDOWN_CONFIGS = [
        {
          selectId: 'blockSymbolSelect',
          dropdownId: 'blockSymbolDropdown',
          triggerId: 'blockSymbolDropdownTrigger',
          menuId: 'blockSymbolDropdownMenu',
        },
      ];

      let selectDropdownGlobalListenersBound = false;
      let updatedTimeZoneChip = null;

      function setDropdownOpen(dropdownEl, menuEl, isOpen) {
        if (!menuEl) return;
        const open = !!isOpen;
        menuEl.classList.toggle('open', open);
        if (dropdownEl) dropdownEl.classList.toggle('is-open', open);
        if (dropdownEl?.parentElement?.classList.contains('chip-menu-wrap')) {
          dropdownEl.parentElement.classList.toggle('is-open', open);
        }
      }

      function closeAllSelectDropdowns(exceptDropdown = null) {
        SELECT_DROPDOWN_CONFIGS.forEach(({ dropdownId, menuId }) => {
          const dropdown = document.getElementById(dropdownId);
          const menu = document.getElementById(menuId);
          if (!dropdown || !menu) return;
          if (exceptDropdown && dropdown === exceptDropdown) return;
          setDropdownOpen(dropdown, menu, false);
        });
      }

      function parseCssPx(value, fallback = 0) {
        const n = Number.parseFloat(String(value || '').trim());
        return Number.isFinite(n) ? n : fallback;
      }

      function escapeHtml(value) {
        return String(value == null ? '' : value)
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;')
          .replace(/"/g, '&quot;')
          .replace(/'/g, '&#39;');
      }

      function sizeUpdatedTimeZoneDropdownMenu(select, dropdown, menu, probeEl) {
        if (!select || !dropdown || !menu || !probeEl) return;

        const style = window.getComputedStyle(probeEl);
        const font = style.font || `${style.fontWeight} ${style.fontSize} / ${style.lineHeight} ${style.fontFamily}`;
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        ctx.font = font;

        let maxTextWidth = 0;
        Array.from(select.options).forEach((option) => {
          const text = String(option.textContent || '');
          maxTextWidth = Math.max(maxTextWidth, ctx.measureText(text).width);
        });

        const menuStyle = window.getComputedStyle(menu);
        const leftPad = parseCssPx(menuStyle.getPropertyValue('--dca-dropdown-content-pad'), 10);
        const rightPad = parseCssPx(menuStyle.getPropertyValue('--dca-dropdown-content-pad'), 10);
        const borderAndSafety = 44;
        const desired = Math.ceil(maxTextWidth + leftPad + rightPad + borderAndSafety);

        const pillWidth = Math.ceil(dropdown.getBoundingClientRect().width + 8);
        const minWidth = Math.max(pillWidth, 360);
        const maxWidth = Math.max(minWidth, Math.floor(window.innerWidth - 24));
        const width = Math.max(minWidth, Math.min(desired, maxWidth));

        menu.style.left = '0px';
        menu.style.width = `${width}px`;
        menu.style.minWidth = `${width}px`;
        menu.style.maxWidth = `${width}px`;
      }

      function sizeSelectDropdownToOptions(selectId, dropdownId, triggerId) {
        const select = document.getElementById(selectId);
        const dropdown = document.getElementById(dropdownId);
        const trigger = document.getElementById(triggerId);
        const valueEl = document.getElementById(triggerId.replace('Trigger', 'Value'));
        if (!select || !dropdown) return;

        if (selectId === 'updatedTimeZoneSelect') return;
        if (dropdown.classList.contains('dca-dropdown-overlay')) return;

        // Only size once — never recompute on selection changes.
        if (dropdown.dataset.fixedWidthPx) return;

        const probeEl = valueEl || trigger;
        if (!probeEl) return;

        const style = window.getComputedStyle(probeEl);
        const measurer = document.createElement('span');
        measurer.style.position = 'fixed';
        measurer.style.left = '-99999px';
        measurer.style.top = '-99999px';
        measurer.style.visibility = 'hidden';
        measurer.style.pointerEvents = 'none';
        measurer.style.whiteSpace = 'nowrap';
        measurer.style.font = style.font || `${style.fontWeight} ${style.fontSize} / ${style.lineHeight} ${style.fontFamily}`;
        measurer.style.letterSpacing = style.letterSpacing;
        measurer.style.textTransform = style.textTransform;
        document.body.appendChild(measurer);

        let maxTextWidth = 0;
        Array.from(select.options).forEach((option) => {
          measurer.textContent = String(option.textContent || '');
          maxTextWidth = Math.max(maxTextWidth, measurer.getBoundingClientRect().width);
        });
        document.body.removeChild(measurer);

        const dropdownStyle = window.getComputedStyle(dropdown);
        const leftPad = parseCssPx(dropdownStyle.getPropertyValue('--dca-dropdown-content-pad'), 10);
        const rightPad = parseCssPx(dropdownStyle.getPropertyValue('--dca-dropdown-arrow-gap'), 18);
        const fudge = 1;
        const measuredWidth = Math.max(54, Math.ceil(maxTextWidth + leftPad + rightPad + fudge));
        const priorLockedWidth = Number.parseFloat(dropdown.dataset.fixedWidthPx || '0');
        const fixedWidth = Number.isFinite(priorLockedWidth) && priorLockedWidth > 0
          ? Math.max(priorLockedWidth, measuredWidth)
          : measuredWidth;
        dropdown.dataset.fixedWidthPx = String(fixedWidth);
        const widthPx = `${fixedWidth}px`;
        dropdown.style.width = widthPx;
        dropdown.style.minWidth = widthPx;
        dropdown.style.maxWidth = widthPx;
        dropdown.style.flexBasis = widthPx;
        const wrapper = dropdown.closest('label.chip') || dropdown.closest('.chip-menu-wrap');
        if (wrapper) {
          const dropdownRect = dropdown.getBoundingClientRect();
          const wrapperRect = wrapper.getBoundingClientRect();
          const prefixWidth = Math.max(0, Math.ceil(wrapperRect.width - dropdownRect.width));
          const measuredWrapperWidth = Math.max(prefixWidth + fixedWidth, Math.ceil(wrapperRect.width));
          const priorWrapperWidth = Number.parseFloat(wrapper.dataset.fixedPillWidthPx || '0');
          const fixedWrapperWidth = Number.isFinite(priorWrapperWidth) && priorWrapperWidth > 0
            ? Math.max(priorWrapperWidth, measuredWrapperWidth)
            : measuredWrapperWidth;
          wrapper.dataset.fixedPillWidthPx = String(fixedWrapperWidth);
          const wrapperWidthPx = `${fixedWrapperWidth}px`;
          wrapper.style.width = wrapperWidthPx;
          wrapper.style.minWidth = wrapperWidthPx;
          wrapper.style.maxWidth = wrapperWidthPx;
          wrapper.style.flexBasis = wrapperWidthPx;
          wrapper.style.flexShrink = '0';
        }
      }

      function syncSelectDropdown(selectId, triggerId, menuId) {
        const select = document.getElementById(selectId);
        const trigger = document.getElementById(triggerId);
        const dropdown = document.getElementById(triggerId.replace('Trigger', 'Dropdown'));
        const menu = document.getElementById(menuId);
        const valueEl = document.getElementById(triggerId.replace('Trigger', 'Value'));
        if (!select || !menu) return;

        const selectedOption = select.options[select.selectedIndex];
        if (valueEl && selectId !== 'updatedTimeZoneSelect') {
          valueEl.textContent = selectedOption ? selectedOption.textContent : '';
        }
        if (trigger && selectId === 'updatedTimeZoneSelect') {
          trigger.textContent = selectedOption ? selectedOption.textContent : '';
        }

        menu.innerHTML = Array.from(select.options)
          .map((option) => {
            const selectedClass = option.value === select.value ? ' dca-option-btn--selected' : '';
            return `<button type="button" class="dca-option-btn${selectedClass}" data-value="${escapeHtml(option.value)}">${escapeHtml(option.textContent || '')}</button>`;
          })
          .join('');

        if (selectId === 'updatedTimeZoneSelect') {
          sizeUpdatedTimeZoneDropdownMenu(select, dropdown, menu, trigger);
        }
      }

      function bindSelectDropdowns() {
        SELECT_DROPDOWN_CONFIGS.forEach(({ selectId, dropdownId, triggerId, menuId }) => {
          const select = document.getElementById(selectId);
          const dropdown = document.getElementById(dropdownId);
          const trigger = document.getElementById(triggerId);
          const menu = document.getElementById(menuId);
          if (!select || !dropdown || !trigger || !menu) return;
          if (dropdown.dataset.bound === '1') return;
          dropdown.dataset.bound = '1';

          const toggleRoot = dropdown.closest('.chip-menu-wrap') || dropdown.closest('label.chip');

          if (toggleRoot) {
            toggleRoot.classList.add('dca-dropdown-pill');
          }

          if (toggleRoot && toggleRoot.dataset.dropdownPillBound !== '1') {
            toggleRoot.dataset.dropdownPillBound = '1';
            toggleRoot.addEventListener('click', (event) => {
              if (menu.contains(event.target)) return;
              event.preventDefault();
              event.stopPropagation();
              const willOpen = !menu.classList.contains('open');
              closeAllSelectDropdowns(willOpen ? dropdown : null);
              setDropdownOpen(dropdown, menu, willOpen);
            });
          }

          menu.addEventListener('click', (event) => {
            const btn = event.target.closest('.dca-option-btn');
            if (!btn) return;
            const nextValue = String(btn.dataset.value || '');
            if (select.value !== nextValue) {
              select.value = nextValue;
              select.dispatchEvent(new Event('change', { bubbles: true }));
            }
            if (selectId === 'blockSymbolSelect') {
              syncBlockSymbolControl();
            }
            syncSelectDropdown(selectId, triggerId, menuId);
            setDropdownOpen(dropdown, menu, false);
          });
        });

        requestAnimationFrame(() => {
          SELECT_DROPDOWN_CONFIGS.forEach(({ selectId, dropdownId, triggerId }) => {
            sizeSelectDropdownToOptions(selectId, dropdownId, triggerId);
          });
        });

        if (selectDropdownGlobalListenersBound) return;
        selectDropdownGlobalListenersBound = true;

        document.addEventListener('click', (event) => {
          const target = event.target;
          SELECT_DROPDOWN_CONFIGS.forEach(({ dropdownId, menuId }) => {
            const dropdown = document.getElementById(dropdownId);
            const menu = document.getElementById(menuId);
            if (!dropdown || !menu) return;
            if (dropdown.contains(target)) return;
            setDropdownOpen(dropdown, menu, false);
          });
        });

        document.addEventListener('keydown', (event) => {
          if (event.key !== 'Escape') return;
          closeAllSelectDropdowns();
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

    function decodeBlockPoints(buffer, startHeight, periodSize, datasetMeta = {}) {
      const view = new DataView(buffer);
      const declaredRecordSize = Number(datasetMeta?.record_size);
      const declaredRows = Number(datasetMeta?.rows);
      const inferredRecordSize = Number.isFinite(declaredRows) && declaredRows > 0
        ? buffer.byteLength / declaredRows
        : null;
      const supportedRecordSizes = new Set([5, 9, 13]);
      const recordSize = supportedRecordSizes.has(declaredRecordSize)
        ? declaredRecordSize
        : (supportedRecordSizes.has(inferredRecordSize)
          ? inferredRecordSize
          : (buffer.byteLength % 13 === 0 ? 13 : (buffer.byteLength % 9 === 0 ? 9 : 5)));
      const count = Math.floor(view.byteLength / recordSize);
      const rows = new Array(count);

      for (let i = 0; i < count; i += 1) {
        const offset = i * recordSize;
        const height = view.getUint32(offset, true);
        const isSignaling = view.getUint8(offset + 4);
        const version = recordSize >= 9 ? view.getUint32(offset + 5, true) : null;
        const blockTime = recordSize >= 13 ? view.getUint32(offset + 9, true) : null;
        const rel = height - startHeight;
        const period = Math.floor(rel / periodSize) + 1;
        const yInPeriod = ((rel % periodSize) + periodSize) % periodSize;

        rows[i] = {
          height,
          is_signaling: isSignaling,
          version,
          block_time: blockTime,
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

    async function loadOptionalJson(path, fallbackValue = {}, options = {}) {
      try {
        const resp = await fetch(path, options);
        if (!resp.ok) {
          if (resp.status !== 404) {
            console.warn(`Optional data failed to load: ${path} (${resp.status})`);
          }
          return fallbackValue;
        }
        return await resp.json();
      } catch (err) {
        console.warn(`Optional data failed to load: ${path}`, err);
        return fallbackValue;
      }
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

      const segwitMiners = await loadOptionalJson(
        "webapp_data/segwit_miners.json",
        {},
        { cache: "no-store" }
      );
      const segwitLowActivityBlocks = await loadOptionalJson(
        "webapp_data/segwit_low_activity_blocks.json",
        {},
        { cache: "no-store" }
      );
      const topKpis = await loadOptionalJson(
        "../../assets/top_kpis.json",
        {},
        { cache: "no-store" }
      );

      return {
        metadata: staticMetadata || (await loadStaticMetadataOnly()).metadata,
        topKpis,
        segwitPeriods: castRows(parseCsv(await segwitPeriodsResp.text())),
        segwitBlocks: [],
        segwitMiners,
        segwitLowActivityBlocks,
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

      const bip110SignalMiners = await loadOptionalJson(
        withBust("webapp_data/bip110_miners.json"),
        previousDynamicData?.bip110SignalMiners || {},
        { cache: "no-store" }
      );
      if (Object.keys(bip110SignalMiners).length === 0) {
        Object.assign(bip110SignalMiners, await loadOptionalJson(
          withBust("webapp_data/bip110_signal_miners.json"),
          previousDynamicData?.bip110SignalMiners || {},
          { cache: "no-store" }
        ));
      }
      const bip110LeaderboardMiners = await loadOptionalJson(
        withBust("webapp_data/bip110_signal_miners.json"),
        previousDynamicData?.bip110LeaderboardMiners || bip110SignalMiners,
        { cache: "no-store" }
      );
      const bip110NodePeriodsResp = await fetch(withBust("webapp_data/bip110_node_periods.csv"), { cache: "no-store" }).catch(() => null);
      const bip110NodePeriods = bip110NodePeriodsResp?.ok
        ? castRows(parseCsv(await bip110NodePeriodsResp.text()))
        : (previousDynamicData?.bip110NodePeriods || []);
      const bip110NodeMiners = await loadOptionalJson(
        withBust("webapp_data/bip110_node_miners.json"),
        previousDynamicData?.bip110NodeMiners || {},
        { cache: "no-store" }
      );
      const bip110NodeSignalMiners = await loadOptionalJson(
        withBust("webapp_data/bip110_node_signal_miners.json"),
        previousDynamicData?.bip110NodeSignalMiners || bip110NodeMiners,
        { cache: "no-store" }
      );
      return {
        metadata,
        signature,
        bip110Periods: castRows(parseCsv(await bip110PeriodsResp.text())),
        bip110Blocks: [],
        bip110NodePeriods,
        bip110NodeBlocks: previousDynamicData?.bip110NodeBlocks || [],
        bip110Releases: bip110ReleasesResp
          ? castRows(parseCsv(await bip110ReleasesResp.text())).map((d) => ({
              ...d,
              display_label: String(d.display_label || "").replaceAll("\\n", "\n"),
            }))
          : (previousDynamicData?.bip110Releases || []),
        bip110Ticks: bip110TicksResp
          ? castRows(parseCsv(await bip110TicksResp.text()))
          : (previousDynamicData?.bip110Ticks || []),
        bip110SignalMiners,
        bip110LeaderboardMiners,
        bip110NodeMiners,
        bip110NodeSignalMiners,
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
        bip110NodePeriods: dynamicData?.bip110NodePeriods || previousData?.bip110NodePeriods || [],
        topKpis: staticData?.topKpis || previousData?.topKpis || {},
        segwitBlocks: staticData?.segwitBlocks || previousData?.segwitBlocks || [],
        bip110Blocks: dynamicData?.bip110Blocks || previousData?.bip110Blocks || [],
        bip110NodeBlocks: dynamicData?.bip110NodeBlocks || previousData?.bip110NodeBlocks || [],
        segwitMiners: staticData?.segwitMiners || previousData?.segwitMiners || {},
        segwitLowActivityBlocks: staticData?.segwitLowActivityBlocks || previousData?.segwitLowActivityBlocks || {},
        segwitReleases: staticData?.segwitReleases || previousData?.segwitReleases || [],
        bip110Releases: dynamicData?.bip110Releases || previousData?.bip110Releases || [],
        segwitTicks: staticData?.segwitTicks || previousData?.segwitTicks || [],
        bip110Ticks: dynamicData?.bip110Ticks || previousData?.bip110Ticks || [],
        bip110SignalMiners: dynamicData?.bip110SignalMiners || previousData?.bip110SignalMiners || {},
        bip110LeaderboardMiners: dynamicData?.bip110LeaderboardMiners || previousData?.bip110LeaderboardMiners || {},
        bip110NodeMiners: dynamicData?.bip110NodeMiners || previousData?.bip110NodeMiners || {},
        bip110NodeSignalMiners: dynamicData?.bip110NodeSignalMiners || previousData?.bip110NodeSignalMiners || {},
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
      const isBip110Node = datasetKey === "bip110Node";
      const file = isSegwit
        ? withBust("webapp_data/segwit_block_points.bin")
        : isBip110Node
          ? withBust("webapp_data/bip110_node_block_points.bin")
          : withBust("webapp_data/bip110_block_points.bin");

      const resp = await fetch(file, { cache: "no-store" });
      if (!resp.ok) {
        if (isBip110Node && resp.status === 404) return [];
        throw new Error(`Failed to load ${file} (${resp.status})`);
      }

      const periodSize = Number(metadata?.chart?.period_size || 2016);
      const datasetMeta = isSegwit
        ? (metadata?.datasets?.segwit_blocks || {})
        : isBip110Node
          ? (metadata?.datasets?.bip110_node_blocks || metadata?.datasets?.bip110_blocks || {})
          : (metadata?.datasets?.bip110_blocks || {});
      const startHeight = Number(datasetMeta?.start_height || 0);

      return decodeBlockPoints(await resp.arrayBuffer(), startHeight, periodSize, datasetMeta);
    }

    function attachMinerData(blocks, minerMap) {
      if (!Array.isArray(blocks) || !minerMap || typeof minerMap !== "object") {
        return blocks;
      }

      return blocks.map((block) => {
        const rawMiner = minerMap[String(block.height)];
        const miner = typeof rawMiner === "string"
          ? { name: rawMiner.trim(), slug: "" }
          : rawMiner && typeof rawMiner === "object"
            ? {
                name: String(rawMiner.name || "").trim(),
                slug: String(rawMiner.slug || "").trim(),
                pool: String(rawMiner.pool || "").trim(),
                subMiner: String(rawMiner.sub_miner || rawMiner.subMiner || "").trim(),
              }
            : null;
        return miner?.name ? { ...block, miner } : block;
      });
    }

    function getLowActivityBlockSet(lowActivityBlockData) {
      const values = Array.isArray(lowActivityBlockData)
        ? lowActivityBlockData
        : Array.isArray(lowActivityBlockData?.low_activity)
          ? lowActivityBlockData.low_activity
          : [];
      return new Set(values.map((height) => Number(height)).filter((height) => Number.isFinite(height)));
    }

    function attachLowActivityBlockData(blocks, lowActivityBlockData) {
      if (!Array.isArray(blocks)) return blocks;
      const lowActivityBlocks = getLowActivityBlockSet(lowActivityBlockData);
      if (lowActivityBlocks.size === 0) return blocks;
      return blocks.map((block) => (
        lowActivityBlocks.has(Number(block?.height))
          ? { ...block, is_low_activity_block: 1 }
          : block
      ));
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

    async function refreshIfDataChanged() {
      if (!state.data) return;
      if (state.refreshInFlight) return;

      state.refreshInFlight = true;
      try {
        const periodGridWasFollowingDefault = isPeriodGridOverlayOpen()
          && getSelectedPeriodGridPeriod() === getDefaultPeriodGridPeriod();
        const latestSig = await fetchLatestBip110MetadataSignature();
        if (!latestSig || latestSig === state.dataSignature) {
          return;
        }

        setControlsEnabled(false);
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
        await renderSelectedPanelsWithSharedLoader(BIP110_PANEL_KEYS);

        await loadAndApplyBlockDataPhased(loadToken, state.data.metadata, ["bip110", "bip110Node"], loadBuster);
        setStatus(state.data);
        refreshOpenOverlays({ followDefaultPeriodGrid: periodGridWasFollowingDefault });
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
      state.autoRefreshTimer = setInterval(refreshIfDataChanged, AUTO_REFRESH_MS);
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
        const bip110NodeRatio = Number.isFinite(state.manualPanelHeightRatios.bip110Node)
          ? state.manualPanelHeightRatios.bip110Node
          : (Number.isFinite(state.manualPanelHeights.bip110Node)
            ? (state.manualPanelHeights.bip110Node / (window.innerHeight || 1))
            : null);
        const payload = {
          stripes: Boolean(state.controls.stripes),
          stripesExplicit: Boolean(state.controls.stripesExplicit),
          blockSymbol: normalizeBlockSymbol(state.controls.blockSymbol),
          markers: Boolean(state.controls.markers),
          labels: Boolean(state.controls.labels),
          showSegwit: Boolean(state.controls.showSegwit),
          showBip110: Boolean(state.controls.showBip110),
          showLegacyNode: Boolean(state.controls.showLegacyNode),
          showBip110Node: Boolean(state.controls.showBip110Node),
          panelsSwapped: Boolean(state.controls.panelsSwapped),
          manualPanelHeights: {
            segwit: Number.isFinite(segwitRatio)
              ? parseFloat(segwitRatio.toFixed(4))
              : null,
            bip110: Number.isFinite(bip110Ratio)
              ? parseFloat(bip110Ratio.toFixed(4))
              : null,
            bip110Node: Number.isFinite(bip110NodeRatio)
              ? parseFloat(bip110NodeRatio.toFixed(4))
              : null,
          },
          filledPanels: {
            segwit: Boolean(state.filledPanels.segwit),
            bip110: Boolean(state.filledPanels.bip110),
            bip110Node: Boolean(state.filledPanels.bip110Node),
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

    function normalizeBip110OverlayWindow(value) {
      const normalized = String(value || "all");
      return ["all", "last", "current", "past14d", "past7d", "past24h"].includes(normalized) ? normalized : "all";
    }

    function normalizeBip110TimelineMinerFilter(value) {
      const normalized = String(value || "all");
      return ["all", "nonsignaling", "signaling"].includes(normalized) ? normalized : "all";
    }

    function normalizeBip110NodeView(value) {
      return String(value || "").toLowerCase() === "bip110" ? "bip110" : "legacy";
    }

    function persistBip110OverlaySelections() {
      try {
        const payload = {
          periodGridNodeView: normalizeBip110NodeView(state.periodGridNodeView),
          leaderboardWindow: normalizeBip110OverlayWindow(state.leaderboardWindow),
          minerTimelineWindow: normalizeBip110OverlayWindow(state.minerTimelineWindow),
          minerTimelineNodeView: normalizeBip110NodeView(state.minerTimelineNodeView),
          minerTimelineMiners: normalizeBip110TimelineMinerFilter(state.minerTimelineMiners),
          minerTimelineOrder: normalizeMinerTimelineOrder(state.minerTimelineOrder),
          minerTimelineSignalersFirst: state.minerTimelineSignalersFirst !== false,
        };
        localStorage.setItem(BIP110_OVERLAY_SELECTIONS_STORAGE_KEY, JSON.stringify(payload));
      } catch (_) {
        // Ignore storage failures (private mode or unavailable storage).
      }
    }

    function restoreBip110OverlaySelections() {
      try {
        const raw = localStorage.getItem(BIP110_OVERLAY_SELECTIONS_STORAGE_KEY);
        if (!raw) return false;

        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== "object") return false;

        state.periodGridNodeView = normalizeBip110NodeView(parsed.periodGridNodeView);
        state.leaderboardWindow = normalizeBip110OverlayWindow(parsed.leaderboardWindow);
        state.minerTimelineWindow = normalizeBip110OverlayWindow(parsed.minerTimelineWindow);
        state.minerTimelineNodeView = normalizeBip110NodeView(parsed.minerTimelineNodeView);
        state.minerTimelineMiners = normalizeBip110TimelineMinerFilter(parsed.minerTimelineMiners);
        state.minerTimelineOrder = normalizeMinerTimelineOrder(parsed.minerTimelineOrder);
        state.minerTimelineSignalersFirst = typeof parsed.minerTimelineSignalersFirst === "boolean"
          ? parsed.minerTimelineSignalersFirst
          : true;
        return true;
      } catch (_) {
        return false;
      }
    }

    function syncBip110OverlaySelectionControls() {
      updateLeaderboardWindowButtons();
      updatePeriodGridNodeViewButtons();
      updateMinerTimelineNodeViewButtons();
      updateMinerTimelineWindowButtons();
      updateMinerTimelineMinerButtons();
      updateMinerTimelineOrderControls();
    }

    function refreshBip110OverlaySelectionsFromStorage() {
      if (!restoreBip110OverlaySelections()) return;
      syncBip110OverlaySelectionControls();
      if (leaderboardOverlay?.classList.contains("show")) {
        renderBip110LeaderboardOverlay();
      }
      if (isMinerTimelineOverlayOpen()) {
        renderBip110MinerTimelineOverlay();
        scrollMinerTimelineToLatestPeriod();
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
        state.controls.blockSymbol = normalizeBlockSymbol(parsed.blockSymbol);
        state.controls.markers = typeof parsed.markers === "boolean" ? parsed.markers : true;
        state.controls.labels = typeof parsed.labels === "boolean" ? parsed.labels : true;
        state.controls.showSegwit = typeof parsed.showSegwit === "boolean" ? parsed.showSegwit : false;
        state.controls.showBip110 = typeof parsed.showBip110 === "boolean" ? parsed.showBip110 : true;
        state.controls.showLegacyNode = typeof parsed.showLegacyNode === "boolean" ? parsed.showLegacyNode : true;
        state.controls.showBip110Node = typeof parsed.showBip110Node === "boolean" ? parsed.showBip110Node : false;
        ensureAtLeastOnePanelVisible("bip110");
        state.controls.panelsSwapped = typeof parsed.panelsSwapped === "boolean" ? parsed.panelsSwapped : false;

        const parseStoredHeight = (value) => {
          if (value == null || value === "") return null;
          const n = Number(value);
          if (!Number.isFinite(n) || n <= 0) return null;
          return n;
        };

        const segwitHeight = parseStoredHeight(parsed?.manualPanelHeights?.segwit);
        const bip110Height = parseStoredHeight(parsed?.manualPanelHeights?.bip110);
        const bip110NodeHeight = parseStoredHeight(parsed?.manualPanelHeights?.bip110Node);
        applyManualPanelHeightFromRatio("segwit", segwitHeight);
        applyManualPanelHeightFromRatio("bip110", bip110Height);
        applyManualPanelHeightFromRatio("bip110Node", bip110NodeHeight);

        state.filledPanels.segwit = typeof parsed?.filledPanels?.segwit === "boolean"
          ? parsed.filledPanels.segwit
          : true;
        state.filledPanels.bip110 = typeof parsed?.filledPanels?.bip110 === "boolean"
          ? parsed.filledPanels.bip110
          : true;
        state.filledPanels.bip110Node = typeof parsed?.filledPanels?.bip110Node === "boolean"
          ? parsed.filledPanels.bip110Node
          : true;
        normalizeDefaultFilledPanelHeights();

        // In filled mode, height is derived from viewport; manual ratios should remain unset.
        PANEL_KEYS.forEach((key) => {
          if (state.filledPanels[key]) {
            state.manualPanelHeights[key] = null;
            state.manualPanelHeightRatios[key] = null;
          }
        });

        const stripes = document.getElementById("toggleStripes");
        const markers = document.getElementById("toggleMarkers");
        const labels = document.getElementById("toggleLabels");
        const segwitWindow = document.getElementById("toggleSegwitWindow");
        const bip110Window = document.getElementById("toggleBip110Window");
        const blockSymbolSelect = document.getElementById("blockSymbolSelect");

        if (stripes) stripes.checked = state.controls.stripes;
        if (blockSymbolSelect) blockSymbolSelect.value = normalizeBlockSymbol(state.controls.blockSymbol);
        syncBlockSymbolControl();
        if (markers) markers.checked = state.controls.markers;
        if (labels) labels.checked = state.controls.labels;
        syncPanelCheckboxes();

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

    function isBip110SharePayload(decoded) {
      if (!decoded || typeof decoded !== "object") return false;
      const controls = decoded.controls;
      if (controls && typeof controls === "object") {
        const controlKeys = ["stripes", "stripesExplicit", "blockSymbol", "markers", "labels", "showSegwit", "showBip110", "showLegacyNode", "showBip110Node", "panelsSwapped"];
        if (controlKeys.some((key) => Object.prototype.hasOwnProperty.call(controls, key))) return true;
      }
      const manualHeights = decoded.manualPanelHeights;
      if (manualHeights && typeof manualHeights === "object") {
        if (Object.prototype.hasOwnProperty.call(manualHeights, "segwit")
          || Object.prototype.hasOwnProperty.call(manualHeights, "bip110")
          || Object.prototype.hasOwnProperty.call(manualHeights, "bip110Node")) {
          return true;
        }
      }
      const filled = decoded.filledPanels;
      if (filled && typeof filled === "object") {
        if (Object.prototype.hasOwnProperty.call(filled, "segwit")
          || Object.prototype.hasOwnProperty.call(filled, "bip110")
          || Object.prototype.hasOwnProperty.call(filled, "bip110Node")) {
          return true;
        }
      }
      return typeof decoded.timeZone === "string";
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
      const defaults = {
        controls: {
          stripes: window.innerWidth >= 760,
          stripesExplicit: false,
          blockSymbol: "square",
          markers: true,
          labels: true,
          showSegwit: false,
          showBip110: true,
          showLegacyNode: true,
          showBip110Node: false,
          panelsSwapped: false,
        },
        manualPanelHeights: {
          segwit: null,
          bip110: null,
          bip110Node: null,
        },
        filledPanels: {
          segwit: true,
          bip110: true,
          bip110Node: true,
        },
        timeZone: "UTC",
      };

      const payload = {
        controls: {
          stripes: Boolean(state.controls.stripes),
          stripesExplicit: Boolean(state.controls.stripesExplicit),
          blockSymbol: normalizeBlockSymbol(state.controls.blockSymbol),
          markers: Boolean(state.controls.markers),
          labels: Boolean(state.controls.labels),
          showSegwit: Boolean(state.controls.showSegwit),
          showBip110: Boolean(state.controls.showBip110),
          showLegacyNode: Boolean(state.controls.showLegacyNode),
          showBip110Node: Boolean(state.controls.showBip110Node),
          panelsSwapped: Boolean(state.controls.panelsSwapped),
        },
        manualPanelHeights: {
          segwit: Number.isFinite(state.manualPanelHeightRatios.segwit) ? state.manualPanelHeightRatios.segwit : null,
          bip110: Number.isFinite(state.manualPanelHeightRatios.bip110) ? state.manualPanelHeightRatios.bip110 : null,
          bip110Node: Number.isFinite(state.manualPanelHeightRatios.bip110Node) ? state.manualPanelHeightRatios.bip110Node : null,
        },
        filledPanels: {
          segwit: Boolean(state.filledPanels.segwit),
          bip110: Boolean(state.filledPanels.bip110),
          bip110Node: Boolean(state.filledPanels.bip110Node),
        },
        timeZone: String(state.timeZone || "UTC"),
      };

      const shareUrl = new URL(getShareRouteBaseUrl());
      const compactPayload = {
        controls: {},
        manualPanelHeights: {},
        filledPanels: {},
      };

      Object.entries(payload.controls).forEach(([key, value]) => {
        if (value !== defaults.controls[key]) compactPayload.controls[key] = value;
      });
      Object.entries(payload.manualPanelHeights).forEach(([key, value]) => {
        if (value !== defaults.manualPanelHeights[key]) compactPayload.manualPanelHeights[key] = value;
      });
      Object.entries(payload.filledPanels).forEach(([key, value]) => {
        if (value !== defaults.filledPanels[key]) compactPayload.filledPanels[key] = value;
      });
      if (payload.timeZone !== defaults.timeZone) {
        compactPayload.timeZone = payload.timeZone;
      }

      if (!Object.keys(compactPayload.controls).length) delete compactPayload.controls;
      if (!Object.keys(compactPayload.manualPanelHeights).length) delete compactPayload.manualPanelHeights;
      if (!Object.keys(compactPayload.filledPanels).length) delete compactPayload.filledPanels;

      if (!Object.keys(compactPayload).length) {
        return shareUrl.toString();
      }

      const encoded = encodeShareState(compactPayload);
      if (encoded) {
        shareUrl.searchParams.set(SHARE_STATE_PARAM, encoded);
      }
      return shareUrl.toString();
    }

    function applyDashboardShareStateFromUrl() {
      const params = new URLSearchParams(window.location.search || "");
      const decodedPrimary = decodeShareState(params.get(SHARE_STATE_PARAM) || "");
      const decoded = isBip110SharePayload(decodedPrimary) ? decodedPrimary : null;
      if (!decoded) return;

      const controls = decoded.controls && typeof decoded.controls === "object" ? decoded.controls : null;
      if (controls) {
        if (typeof controls.stripes === "boolean") state.controls.stripes = controls.stripes;
        if (typeof controls.stripesExplicit === "boolean") state.controls.stripesExplicit = controls.stripesExplicit;
        if (typeof controls.blockSymbol === "string") state.controls.blockSymbol = normalizeBlockSymbol(controls.blockSymbol);
        if (typeof controls.markers === "boolean") state.controls.markers = controls.markers;
        if (typeof controls.labels === "boolean") state.controls.labels = controls.labels;
        if (typeof controls.showSegwit === "boolean") state.controls.showSegwit = controls.showSegwit;
        if (typeof controls.showBip110 === "boolean") state.controls.showBip110 = controls.showBip110;
        if (typeof controls.showLegacyNode === "boolean") state.controls.showLegacyNode = controls.showLegacyNode;
        if (typeof controls.showBip110Node === "boolean") state.controls.showBip110Node = controls.showBip110Node;
        ensureAtLeastOnePanelVisible("bip110");
        if (typeof controls.panelsSwapped === "boolean") state.controls.panelsSwapped = controls.panelsSwapped;
      }

      const heights = decoded.manualPanelHeights && typeof decoded.manualPanelHeights === "object"
        ? decoded.manualPanelHeights
        : null;
      if (heights) {
        applyManualPanelHeightFromRatio("segwit", heights.segwit);
        applyManualPanelHeightFromRatio("bip110", heights.bip110);
        applyManualPanelHeightFromRatio("bip110Node", heights.bip110Node);
      }

      const filled = decoded.filledPanels && typeof decoded.filledPanels === "object"
        ? decoded.filledPanels
        : null;
      if (filled) {
        if (typeof filled.segwit === "boolean") state.filledPanels.segwit = filled.segwit;
        if (typeof filled.bip110 === "boolean") state.filledPanels.bip110 = filled.bip110;
        if (typeof filled.bip110Node === "boolean") state.filledPanels.bip110Node = filled.bip110Node;
      }
      normalizeDefaultFilledPanelHeights();

      const timeZone = String(decoded.timeZone || "").trim();
      if (timeZone) {
        state.timeZone = setPreferredDashboardTimeZone(timeZone);
      }

      const stripes = document.getElementById("toggleStripes");
      const markers = document.getElementById("toggleMarkers");
      const labels = document.getElementById("toggleLabels");
      const segwitWindow = document.getElementById("toggleSegwitWindow");
      const bip110Window = document.getElementById("toggleBip110Window");
      const blockSymbolSelect = document.getElementById("blockSymbolSelect");
      if (stripes) stripes.checked = state.controls.stripes;
      if (blockSymbolSelect) blockSymbolSelect.value = normalizeBlockSymbol(state.controls.blockSymbol);
      syncBlockSymbolControl();
      if (markers) markers.checked = state.controls.markers;
      if (labels) labels.checked = state.controls.labels;
      syncPanelCheckboxes();
    }

    async function copyDashboardLinkToClipboard(buttonEl) {
      await window.WSBDashboardComponents.copyDashboardLink({
        button: buttonEl,
        getUrl: buildShareableDashboardUrl,
        copiedIcon: ICONS.copyCopied,
        defaultIcon: ICONS.copyLink,
        setIcon: (icon) => setButtonIcon("copyDashboardIcon", icon),
      });
    }

    function captureResetSnapshot() {
      const stripes = document.getElementById("toggleStripes");
      const markers = document.getElementById("toggleMarkers");
      const labels = document.getElementById("toggleLabels");
      const segwitWindow = document.getElementById("toggleSegwitWindow");
      const bip110Window = document.getElementById("toggleBip110Window");
      const blockSymbolSelect = document.getElementById("blockSymbolSelect");
      return {
        controls: {
          stripes: Boolean(state.controls.stripes),
          stripesExplicit: Boolean(state.controls.stripesExplicit),
          blockSymbol: normalizeBlockSymbol(state.controls.blockSymbol),
          markers: Boolean(state.controls.markers),
          labels: Boolean(state.controls.labels),
          showSegwit: Boolean(state.controls.showSegwit),
          showBip110: Boolean(state.controls.showBip110),
          showLegacyNode: Boolean(state.controls.showLegacyNode),
          showBip110Node: Boolean(state.controls.showBip110Node),
          panelsSwapped: Boolean(state.controls.panelsSwapped),
        },
        filledPanels: {
          segwit: Boolean(state.filledPanels.segwit),
          bip110: Boolean(state.filledPanels.bip110),
          bip110Node: Boolean(state.filledPanels.bip110Node),
        },
        manualPanelHeightRatios: {
          segwit: Number.isFinite(state.manualPanelHeightRatios.segwit) ? state.manualPanelHeightRatios.segwit : null,
          bip110: Number.isFinite(state.manualPanelHeightRatios.bip110) ? state.manualPanelHeightRatios.bip110 : null,
          bip110Node: Number.isFinite(state.manualPanelHeightRatios.bip110Node) ? state.manualPanelHeightRatios.bip110Node : null,
        },
        timeZone: String(state.timeZone || 'UTC'),
        checkboxState: {
          toggleStripes: Boolean(stripes?.checked ?? state.controls.stripes),
          toggleMarkers: Boolean(markers?.checked ?? state.controls.markers),
          toggleLabels: Boolean(labels?.checked ?? state.controls.labels),
          toggleSegwitWindow: Boolean(segwitWindow?.checked ?? state.controls.showSegwit),
          toggleBip110Window: Boolean(bip110Window?.checked ?? state.controls.showBip110),
          blockSymbol: normalizeBlockSymbol(blockSymbolSelect?.value ?? state.controls.blockSymbol),
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
        state.controls.blockSymbol = typeof checkboxState.blockSymbol === 'string'
          ? normalizeBlockSymbol(checkboxState.blockSymbol)
          : normalizeBlockSymbol(controls.blockSymbol);
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
        state.controls.showLegacyNode = typeof controls.showLegacyNode === "boolean" ? controls.showLegacyNode : true;
        state.controls.showBip110Node = typeof controls.showBip110Node === "boolean" ? controls.showBip110Node : false;
        ensureAtLeastOnePanelVisible("bip110");
        state.controls.panelsSwapped = Boolean(controls.panelsSwapped);

        const filledPanels = snapshot.filledPanels || {};
        state.filledPanels.segwit = Boolean(filledPanels.segwit);
        state.filledPanels.bip110 = Boolean(filledPanels.bip110);
        state.filledPanels.bip110Node = typeof filledPanels.bip110Node === "boolean" ? Boolean(filledPanels.bip110Node) : true;

        state.manualPanelHeights.segwit = null;
        state.manualPanelHeights.bip110 = null;
        state.manualPanelHeights.bip110Node = null;
        state.manualPanelHeightRatios.segwit = null;
        state.manualPanelHeightRatios.bip110 = null;
        state.manualPanelHeightRatios.bip110Node = null;

        const ratios = snapshot.manualPanelHeightRatios || {};
        applyManualPanelHeightFromRatio('segwit', ratios.segwit);
        applyManualPanelHeightFromRatio('bip110', ratios.bip110);
        applyManualPanelHeightFromRatio('bip110Node', ratios.bip110Node);
        normalizeDefaultFilledPanelHeights();
        state.timeZone = setPreferredDashboardTimeZone(String(snapshot.timeZone || 'UTC'));

        const stripes = document.getElementById('toggleStripes');
        const markers = document.getElementById('toggleMarkers');
        const labels = document.getElementById('toggleLabels');
        const segwitWindow = document.getElementById('toggleSegwitWindow');
        const bip110Window = document.getElementById('toggleBip110Window');
        const blockSymbolSelect = document.getElementById('blockSymbolSelect');
        if (stripes) stripes.checked = state.controls.stripes;
        if (blockSymbolSelect) blockSymbolSelect.value = normalizeBlockSymbol(state.controls.blockSymbol);
        syncBlockSymbolControl();
        if (markers) markers.checked = state.controls.markers;
        if (labels) labels.checked = state.controls.labels;
        syncPanelCheckboxes();

        persistControls();
        applyPanelOrder();
        applyDynamicPanelHeights();
        updatePanelVisibility();
        updateFillButtonState('segwit');
        updateFillButtonState('bip110');
        updateFillButtonState('bip110Node');
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
          localStorage.removeItem(BIP110_OVERLAY_SELECTIONS_STORAGE_KEY);
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
        state.controls.blockSymbol = "square";
        state.controls.markers = true;
        state.controls.labels = true;
        state.controls.showSegwit = false;
        state.controls.showBip110 = true;
        state.controls.showLegacyNode = true;
        state.controls.showBip110Node = false;
        state.controls.panelsSwapped = false;
        state.periodGridNodeView = "legacy";
        state.leaderboardWindow = "all";
        state.minerTimelineWindow = "past14d";
        state.minerTimelineNodeView = "legacy";
        state.minerTimelineMiners = "all";
        state.minerTimelineOrder = "recent";
        state.minerTimelineSignalersFirst = true;

        state.filledPanels.segwit = true;
        state.filledPanels.bip110 = true;
        state.filledPanels.bip110Node = true;
        state.manualPanelHeights.segwit = null;
        state.manualPanelHeights.bip110 = null;
        state.manualPanelHeights.bip110Node = null;
        state.manualPanelHeightRatios.segwit = null;
        state.manualPanelHeightRatios.bip110 = null;
        state.manualPanelHeightRatios.bip110Node = null;
        // Keep manual height metadata cleared so reload stays in default state.
        state.filledPanels.segwit = true;
        state.filledPanels.bip110 = true;
        state.filledPanels.bip110Node = true;

        state.timeZone = setPreferredDashboardTimeZone("UTC");

        const stripes = document.getElementById("toggleStripes");
        const markers = document.getElementById("toggleMarkers");
        const labels = document.getElementById("toggleLabels");
        const segwitWindow = document.getElementById("toggleSegwitWindow");
        const bip110Window = document.getElementById("toggleBip110Window");
        const blockSymbolSelect = document.getElementById("blockSymbolSelect");

        if (stripes) stripes.checked = state.controls.stripes;
        if (blockSymbolSelect) blockSymbolSelect.value = "square";
        syncBlockSymbolControl();
        if (markers) markers.checked = true;
        if (labels) labels.checked = true;
        syncPanelCheckboxes();

        applyPanelOrder();
        applyDynamicPanelHeights();
        updatePanelVisibility();
        updateFillButtonState("segwit");
        updateFillButtonState("bip110");
        updateFillButtonState("bip110Node");
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
      if (normalizeBlockSymbol(state.controls.blockSymbol) !== 'square') return false;
      if (markers && !markers.checked) return false;
      if (labels && !labels.checked) return false;
      if (segwitWindow && segwitWindow.checked) return false;
      if (bip110Window && !bip110Window.checked) return false;
      if (!state.controls.showLegacyNode) return false;
      if (state.controls.showBip110Node) return false;
      if (state.controls.panelsSwapped) return false;
      if (!state.filledPanels.segwit) return false;
      if (!state.filledPanels.bip110) return false;
      if (!state.filledPanels.bip110Node) return false;
      // In filled mode, viewport-derived height can introduce tiny persisted ratios.
      // Treat filled panel state as canonical default and only enforce null manual ratios
      // for panels that are NOT in filled mode.
      if (!state.filledPanels.segwit && state.manualPanelHeightRatios.segwit != null) return false;
      if (!state.filledPanels.bip110 && state.manualPanelHeightRatios.bip110 != null) return false;
      if (!state.filledPanels.bip110Node && state.manualPanelHeightRatios.bip110Node != null) return false;
      if (state.timeZone !== 'UTC') return false;

      return true;
    }

    function updateResetButtonUi() {
      const btn = document.getElementById('resetDashboard');
      if (!state.controlsEnabled) {
        if (btn) btn.disabled = true;
        return;
      }
      window.WSBDashboardComponents.setResetButtonState({
        button: btn,
        isUndo: !!state.preResetStateSnapshot,
        disabled: isDefaultState(),
        undoIcon: ICONS.resetUndo,
        defaultIcon: ICONS.resetDefaults,
        setIcon: (icon) => setButtonIcon('resetDashboardIcon', icon),
      });
      setCustomTooltip(btn, state.preResetStateSnapshot ? 'Undo the last restore defaults action' : 'Reset dashboard to defaults');
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

      const appendStatusChip = (label, valueHtml, tooltipText = "") => {
        const div = document.createElement("div");
        div.className = "chip";
        div.innerHTML = `<span class="chip-label">${label}</span> <span class="chip-value">${valueHtml}</span>`;
        setCustomTooltip(div, tooltipText);
        statusChips.appendChild(div);
      };

      const appendExpectedForkTimeChip = (signalingHashrate) => {
        const estimate = estimateExpectedForkDate(meta);
        if (!estimate) {
          appendStatusChip("Est. Fork Time", "n/a");
          return;
        }

        const dateText = formatGeneratedDateTimeForSelectedTimeZone(estimate.date.toISOString());
        const heightText = estimate.height.toLocaleString("en-US");
        const blocksText = estimate.blocksRemaining.toLocaleString("en-US");
        const tooltipText = estimate.blocksRemaining > 0
          ? `The fork would likely happen when mandatory signaling begins at height ${heightText}. This projection assumes blocks continue arriving every 10 minutes and starts from block ${Number(meta.source_block_height).toLocaleString("en-US")}; ${blocksText} blocks remain.`
          : `The fork would likely happen when mandatory signaling begins at height ${heightText}. That height has already been reached or passed.`;
        const activationEstimate = estimateActivationAfterFork(estimate, signalingHashrate, meta);
        const activationText = activationEstimate
          ? `Activation would come after the signaling chain mines the mandatory signaling period and then the lock-in period. Given the current 14 day signaling share of ${signalingHashrate.shareText}, the signaling chain would take about ${formatBlockInterval(activationEstimate.mandatoryPeriodMs)} to mine the 2,016-block mandatory signaling period, then receive the maximum ${MAX_DOWNWARD_DIFFICULTY_ADJUSTMENT}x downward difficulty adjustment. At that reduced difficulty, the following 2,016-block lock-in period would take about ${formatBlockInterval(activationEstimate.lockInPeriodMs)}, putting activation around ${formatGeneratedDateTimeForSelectedTimeZone(activationEstimate.date.toISOString())}.`
          : "Activation would come after the signaling chain mines the mandatory signaling period and then the lock-in period. This projection will appear once the 14 day signaling-share data is loaded.";
        appendStatusChip("Est. Fork Time", dateText, `${tooltipText}\n\n${activationText}`);
      };

      const appendExpectedBlockTimeChip = (signalingHashrate) => {
        if (!signalingHashrate) {
          appendStatusChip(
            "Est. Block Time",
            "...",
            "Block time shows how long blocks would take after the fork if hashrate splits between the BIP-110 signaling chain and the legacy chain. Waiting for 14 day signaling block data."
          );
          return;
        }

        const forkBlockTime = estimateBlockIntervalForShare(signalingHashrate.signalingShare);
        const legacyBlockTime = estimateBlockIntervalForShare(1 - signalingHashrate.signalingShare);
        const tooltipText = `Block time shows how long blocks would take after the fork if hashrate splits between the BIP-110 signaling chain and the legacy chain. The BIP-110 signaling chain would find a block about every ${formatBlockInterval(forkBlockTime)}, while the legacy chain would find a block about every ${formatBlockInterval(legacyBlockTime)}. This is calculated by dividing Bitcoin's 10 minute target block interval by each chain's hashrate share. The signaling share is ${signalingHashrate.shareText} (${signalingHashrate.signalingBlocks.toLocaleString("en-US")} / ${signalingHashrate.totalBlocks.toLocaleString("en-US")} blocks over the past 14 days), so this KPI uses a 14 day average.`;

        appendStatusChip("Est. Block Time", formatBlockInterval(forkBlockTime), tooltipText);
      };

      statusChips.innerHTML = "";
      statusChips.appendChild(buildUpdatedChip(meta));
      const nodeSync = getNodeSyncStatus(meta);
      const nodeSyncText = nodeSync.ok === true ? "In-sync" : nodeSync.ok === false ? "Out-of-sync" : "unknown";
      const nodeSyncClass = nodeSync.ok === true ? "chip-value-ok" : nodeSync.ok === false ? "chip-value-alert" : "";
      appendStatusChip(
        "Legacy & BIP-110",
        `<span class="${nodeSyncClass}">${escapeHtml(nodeSyncText)}</span>`,
        nodeSync.tooltip
      );
      updatedTimeZoneChip = window.WSBDashboardComponents?.createUpdatedTimeZoneChipController?.({
        chip: "#updatedTimeZoneDisplay",
        value: "#updatedTimeZoneDisplay .chip-value",
        getTimeZone: () => state.timeZone || DASHBOARD_TIME?.getPreferredTimeZone?.() || "UTC",
        setTimeZone: (value) => {
          state.timeZone = setPreferredDashboardTimeZone(value);
          return state.timeZone;
        },
        onChange: (timeZone) => {
          state.timeZone = timeZone || state.timeZone;
          if (state.data) setStatus(state.data);
        },
      });
      const updatedHeight = Number(meta?.source_block_height);
      updatedTimeZoneChip?.setUpdated(meta?.generated_utc, {
        includeHeight: Number.isFinite(updatedHeight) && updatedHeight > 0,
        height: updatedHeight,
      });
      const periodSignalValue = currentSignal != null
        ? `<span class="chip-value-signal">${currentSignal.toLocaleString()}</span> (${currentSignalPct})`
        : `<span class="chip-value-signal">...</span>`;
      appendStatusChip(
        "Period",
        `${s.current_period_index ?? "N/A"} <span class="chip-label">Signaling</span> ${periodSignalValue}`
      );
      const signalingHashrate = estimateSignalingHashrateKpi(data);
      appendStatusChip(
        "Signaling Hashrate",
        signalingHashrate ? formatHashrate(signalingHashrate.value) : "...",
        signalingHashrate
          ? `Signaling share: ${signalingHashrate.shareText} (${signalingHashrate.signalingBlocks.toLocaleString("en-US")} / ${signalingHashrate.totalBlocks.toLocaleString("en-US")} blocks over the past 14 days). This KPI uses a 14 day average.`
          : "Waiting for 14 day signaling block data. This KPI uses a 14 day average."
      );
      appendExpectedForkTimeChip(signalingHashrate);
      appendExpectedBlockTimeChip(signalingHashrate);
      bindSelectDropdowns();
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

    function normalizeBlockSymbol(value) {
      const normalized = String(value || "").trim().toLowerCase();
      if (normalized === "dash" || normalized === "square" || normalized === "x") return normalized;
      return "square";
    }

    function pctLabel(signal, periodSize) {
      const pct = (signal / periodSize) * 100;
      if (pct > 0 && pct < 0.1) return "< 0.1%";
      return `${pct.toFixed(1)}%`;
    }

    function formatHashrate(value) {
      const n = Number(value);
      if (!Number.isFinite(n) || n < 0) return "n/a";
      const units = ["H/s", "kH/s", "MH/s", "GH/s", "TH/s", "PH/s", "EH/s", "ZH/s", "YH/s"];
      let scaled = n;
      let unitIndex = 0;
      while (scaled >= 1000 && unitIndex < units.length - 1) {
        scaled /= 1000;
        unitIndex += 1;
      }
      return `${scaled.toFixed(2)} ${units[unitIndex]}`;
    }

    function formatSharePct(numerator, denominator) {
      const top = Number(numerator);
      const bottom = Number(denominator);
      if (!Number.isFinite(top) || !Number.isFinite(bottom) || bottom <= 0) return "n/a";
      const pct = (top / bottom) * 100;
      if (pct > 0 && pct < 0.01) return "< 0.01%";
      return `${pct.toFixed(2)}%`;
    }

    function estimateBlockIntervalForShare(share) {
      const n = Number(share);
      if (!Number.isFinite(n) || n <= 0) return Infinity;
      return EXPECTED_BLOCK_INTERVAL_MS / n;
    }

    function estimateActivationAfterFork(forkEstimate, signalingHashrate, meta) {
      const periodSize = Number(meta?.chart?.period_size || 2016);
      const forkTime = forkEstimate?.date instanceof Date ? forkEstimate.date.getTime() : NaN;
      const signalingShare = Number(signalingHashrate?.signalingShare);
      if (
        !Number.isFinite(periodSize)
        || periodSize <= 0
        || !Number.isFinite(forkTime)
        || !Number.isFinite(signalingShare)
        || signalingShare <= 0
      ) {
        return null;
      }

      const forkBlockTime = estimateBlockIntervalForShare(signalingShare);
      const mandatoryPeriodMs = periodSize * forkBlockTime;
      const reducedDifficultyBlockTime = forkBlockTime / MAX_DOWNWARD_DIFFICULTY_ADJUSTMENT;
      const lockInPeriodMs = periodSize * reducedDifficultyBlockTime;

      return {
        mandatoryPeriodMs,
        lockInPeriodMs,
        date: new Date(forkTime + mandatoryPeriodMs + lockInPeriodMs),
      };
    }

    function formatBlockInterval(ms) {
      const n = Number(ms);
      if (!Number.isFinite(n) || n <= 0) return "n/a";
      if (n < 60 * 60 * 1000) {
        const totalSeconds = Math.max(1, Math.round(n / 1000));
        const minutes = Math.floor(totalSeconds / 60);
        const seconds = totalSeconds % 60;
        if (!minutes) return `${seconds}s`;
        return `${minutes}m ${seconds}s`;
      }

      const oneDayMs = 24 * 60 * 60 * 1000;
      const oneYearMs = 365 * oneDayMs;
      if (n >= oneYearMs) {
        return `${(n / oneYearMs).toFixed(1)} years`;
      }
      if (n >= oneDayMs) {
        return `${(n / oneDayMs).toFixed(1)} days`;
      }

      const totalMinutes = Math.max(1, Math.round(n / (60 * 1000)));
      const hours = Math.floor(totalMinutes / 60);
      const minutes = totalMinutes % 60;
      const parts = [];

      if (hours) parts.push(`${hours}h`);
      parts.push(`${minutes}m`);
      return parts.join(" ");
    }

    function estimateSignalingHashrateKpi(data) {
      const blocks = Array.isArray(data?.bip110Blocks) ? data.bip110Blocks : [];
      const networkHashrate = Number(data?.topKpis?.target_hashrate_hps);
      const windowSeconds = 14 * 24 * 60 * 60;
      const latestBlockTime = blocks.reduce((latest, block) => {
        const t = Number(block?.block_time);
        return Number.isFinite(t) && t > latest ? t : latest;
      }, 0);

      if (!Number.isFinite(networkHashrate) || networkHashrate <= 0 || !latestBlockTime) {
        return null;
      }

      const windowStart = latestBlockTime - windowSeconds;
      const recentBlocks = blocks.filter((block) => {
        const t = Number(block?.block_time);
        return Number.isFinite(t) && t > windowStart && t <= latestBlockTime;
      });
      const totalBlocks = recentBlocks.length;
      if (!totalBlocks) return null;

      const signalingBlocks = recentBlocks.reduce((sum, block) => (
        sum + (Number(block?.is_signaling) === 1 ? 1 : 0)
      ), 0);
      const signalingShare = signalingBlocks / totalBlocks;
      return {
        value: networkHashrate * signalingShare,
        signalingBlocks,
        totalBlocks,
        signalingShare,
        shareText: formatSharePct(signalingBlocks, totalBlocks),
      };
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
        wrapper.id = "updatedChipWrap";

        const display = document.createElement("div");
        display.className = "chip chip-kpi-display";
        display.id = "updatedTimeZoneDisplay";
        const height = Number(meta?.source_block_height);
        const heightText = Number.isFinite(height) && height > 0 ? height.toLocaleString("en-US") : "";
        const updatedText = formatGeneratedDateTimeForSelectedTimeZone(meta.generated_utc);
        const updatedDisplayText = updatedText && heightText ? `${updatedText} | ${heightText}` : updatedText;
        display.innerHTML = `<span class="chip-label">Updated</span> <span class="chip-value">${updatedDisplayText}</span>`;

        const dropdown = document.createElement("div");
        dropdown.id = "updatedTimeZoneDropdown";
        dropdown.className = "dca-dropdown dca-dropdown-overlay";

        const trigger = document.createElement("button");
        trigger.id = "updatedTimeZoneDropdownTrigger";
        trigger.type = "button";
        trigger.className = "dca-dropdown-trigger";
        trigger.setAttribute("aria-label", "Updated timestamp time zone");

        const menu = document.createElement("div");
        menu.id = "updatedTimeZoneDropdownMenu";
        menu.className = "dca-dropdown-menu";
        menu.setAttribute("aria-label", "Time zone options");

        dropdown.appendChild(trigger);
        dropdown.appendChild(menu);

        const select = document.createElement("select");
        select.className = "chip-menu-select chip-kpi-select-overlay dca-native-select";
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
        wrapper.appendChild(dropdown);
        wrapper.appendChild(select);
        return wrapper;
    }

    function syncBlockSymbolControl() {
      const select = document.getElementById("blockSymbolSelect");
      const display = document.getElementById("blockSymbolDisplay");
      if (!select || !display) return;
      const value = normalizeBlockSymbol(select.value || state.controls.blockSymbol);
      const symbols = {
        dash: "-",
        square: "■",
        x: "×",
      };
      const label = symbols[value] || symbols.square;
      select.value = value;
      display.innerHTML = `<span class="chip-label">Block symbol</span> <span class="chip-value">${label}</span>`;
      syncSelectDropdown('blockSymbolSelect', 'blockSymbolDropdownTrigger', 'blockSymbolDropdownMenu');
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

    function drawBlockStripeMarker(ctx, symbol, x0, x1, y, color, lineWidth, isMobile) {
      const marker = normalizeBlockSymbol(symbol);
      const centerX = (x0 + x1) / 2;
      const segmentWidth = Math.max(1, Math.abs(x1 - x0));

      if (marker === "square") {
        const squareSize = Math.max(isMobile ? 2.6 : 3.2, Math.min(isMobile ? 4.8 : 5.4, segmentWidth * 0.85));
        ctx.fillStyle = color;
        ctx.fillRect(centerX - (squareSize / 2), y - (squareSize / 2), squareSize, squareSize);
        return { x0: centerX - (squareSize / 2), x1: centerX + (squareSize / 2), yPad: Math.max(2.5, squareSize * 0.7) };
      }

      if (marker === "x") {
        const arm = Math.max(isMobile ? 2.4 : 2.8, Math.min(isMobile ? 4.8 : 5.6, segmentWidth * 0.95));
        ctx.strokeStyle = color;
        ctx.lineWidth = Math.max(1.1, lineWidth * 0.75);
        ctx.beginPath();
        ctx.moveTo(centerX - arm, y - arm);
        ctx.lineTo(centerX + arm, y + arm);
        ctx.moveTo(centerX - arm, y + arm);
        ctx.lineTo(centerX + arm, y - arm);
        ctx.stroke();
        return { x0: centerX - arm, x1: centerX + arm, yPad: Math.max(2.6, arm + 1) };
      }

      ctx.strokeStyle = color;
      ctx.lineWidth = lineWidth;
      ctx.beginPath();
      ctx.moveTo(x0, y);
      ctx.lineTo(x1, y);
      ctx.stroke();
      return { x0: Math.min(x0, x1), x1: Math.max(x0, x1), yPad: Math.max(2.5, lineWidth * 1.6) };
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
        return "Latest Activation Period";
      }
      const isTargetLabel = key.startsWith("mandatory signaling period")
        || key.startsWith("latest lock-in")
        || key.startsWith("latest activation period")
        || key.startsWith("maximum activation height")
        || key.startsWith("max activation height");
      if (isTargetLabel) {
        return raw.replace(/\b([a-zA-Z])([a-zA-Z']*)\b/g, (_, first, rest) => {
          return `${first.toUpperCase()}${rest.toLowerCase()}`;
        });
      }
      return raw;
    }

    function drawPanel({ canvas, key, title, panelTag = "", periods, blocks, releases, ticks, threshold, thresholdPct, showBottomAxis, specialLabels = [], markerTypography = null, numericTypography = null, renderStripes = true, renderLabels = true, renderMarkers = true, renderSpecialLabels = true }) {
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
        top: isMobile ? 51 : 53,
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

        if (isBip110PanelKey(key)) {
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
        const stripeSymbol = normalizeBlockSymbol(state.controls.blockSymbol);

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
          const barHoverEdge = signaling
            ? xScale(p + chart.bar.width / 2)
            : xScale(p - chart.bar.width / 2);
          const sideMidpoint = signaling
            ? xScale(p + 0.5)
            : xScale(p - 0.5);

          ctx.globalAlpha = 0.98;
          const markerBounds = drawBlockStripeMarker(
            ctx,
            stripeSymbol,
            x0,
            x1,
            y,
            signaling ? colors.signal : colors.nonsignal,
            stripeWidth,
            isMobile
          );

          state.stripeMaps[key].push({
            x0: Math.min(markerBounds.x0, signaling ? barHoverEdge : sideMidpoint),
            x1: Math.max(markerBounds.x1, signaling ? sideMidpoint : barHoverEdge),
            y0: y - markerBounds.yPad,
            y1: y + markerBounds.yPad,
            markerX0: markerBounds.x0,
            markerX1: markerBounds.x1,
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
      if (isBip110PanelKey(key)) {
        const mandatoryRampX = xScale(17.5);
        const mandatoryEndX = xScale(18.5);
        const mandatoryY = yScale(periodSize);
        ctx.moveTo(plot.x, thresholdY);
        ctx.lineTo(mandatoryRampX, thresholdY);
        ctx.lineTo(mandatoryRampX, mandatoryY);
        ctx.lineTo(mandatoryEndX, mandatoryY);
      } else {
        ctx.moveTo(plot.x, thresholdY);
        ctx.lineTo(plot.x + plot.w, thresholdY);
      }
      ctx.stroke();
      ctx.globalAlpha = 1;

      if (renderLabels) {
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
      }

      if (renderLabels) {
        periods.forEach((row) => {
          const p = Number(row.period);
          const signalRaw = Number(row.signal_blocks || 0);
          const status = String(row.status || "completed");
          if (isBip110PanelKey(key) && status === "future") return;
          if (isBip110PanelKey(key) && status === "post_window") return;

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

      const xAxisLabelMax = isBip110PanelKey(key)
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
        panelTag,
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
      const visibleCanvases = getVisibleChartCanvases();
      const widthCandidates = visibleCanvases
        .map((canvas) => estimateBarWidthForCanvas(canvas, chart))
        .filter((w) => Number.isFinite(w) && w > 8);
      const targetWidth = Math.max(38, (widthCandidates.length ? Math.min(...widthCandidates) : 30) * 1.55);
      const visibleWidths = visibleCanvases
        .map((canvas) => canvas.getBoundingClientRect().width)
        .filter((w) => Number.isFinite(w) && w > 8);
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

      const visibleCanvases = getVisibleChartCanvases();
      const widthCandidates = visibleCanvases
        .flatMap((canvas) => [
          estimateBarWidthForCanvas(canvas, chart) - 4,
          estimateThresholdLabelWidthForCanvas(canvas, chart),
        ])
        .filter((w) => Number.isFinite(w) && w > 8);
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

      const visibleWidths = visibleCanvases
        .map((canvas) => canvas.getBoundingClientRect().width)
        .filter((w) => Number.isFinite(w) && w > 8);
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
      enforceNodePanelSelectionRules();

      if (hasPriorVisibility) {
        // Preserve the user-visible panel heights when toggling panel visibility.
        PANEL_KEYS.forEach((key) => {
          const panel = getPanelElement(key);
          if (!panel || panel.classList.contains("hidden")) return;
          const panelHeight = panel.getBoundingClientRect().height;
          if (Number.isFinite(panelHeight) && panelHeight > 0) {
            setManualPanelHeight(key, panelHeight);
          }
        });
      }

      segwitPanel.classList.toggle("hidden", !state.controls.showSegwit);
      bip110Panel.classList.toggle("hidden", !(state.controls.showBip110 && state.controls.showLegacyNode));
      bip110NodePanel.classList.toggle("hidden", !(state.controls.showBip110 && state.controls.showBip110Node));

      const visibleCount = getVisiblePanelKeys().length;
      state.lastVisibleCount = visibleCount;
      syncPanelCheckboxes();
      syncSwapButtonEnabledState();

      if (hasPriorVisibility && visibleCount !== prevCount) {
        persistControls();
        updateResetButtonUi();
      }

      applyDynamicPanelHeights();
    }

    function applyPanelOrder() {
      const bothBip110NodesVisible = Boolean(
        state.controls.showBip110
        && state.controls.showLegacyNode
        && state.controls.showBip110Node
      );
      const orderedKeys = bothBip110NodesVisible
        ? (state.controls.panelsSwapped ? ["bip110Node", "bip110", "segwit"] : ["bip110", "bip110Node", "segwit"])
        : (state.controls.panelsSwapped ? ["bip110", "segwit", "bip110Node"] : ["segwit", "bip110", "bip110Node"]);

      orderedKeys.forEach((key) => {
        const panel = getPanelElement(key);
        if (!panel) return;
        mainWrap.appendChild(panel);
      });
    }

    function formatBip110Status(status) {
      if (status === "completed") return "Completed";
      if (status === "in_progress") return "In progress";
      if (status === "future" || status === "post_window") return "Future";
      return String(status || "").replace(/_/g, " ").replace(/^\w/, (char) => char.toUpperCase());
    }

    function getBip110PostWindowHeights(data, periodSize) {
      const period = Number(data?.period);
      const periods = Array.isArray(state?.data?.bip110Periods)
        ? state.data.bip110Periods
        : [];
      const knownStarts = periods
        .map((row) => Number(row?.period_start_height))
        .filter((height) => Number.isFinite(height) && height > 0);
      const startPeriod = periods.find((row) => Number(row?.period) === 1);
      const baseHeight = Number(startPeriod?.period_start_height);
      const fallbackBase = knownStarts.length ? Math.min(...knownStarts) : NaN;
      const firstHeight = Number.isFinite(baseHeight) && baseHeight > 0 ? baseHeight : fallbackBase;

      if (!Number.isFinite(period) || !Number.isFinite(firstHeight)) {
        return { start: NaN, end: NaN };
      }

      const start = firstHeight + ((period - 1) * periodSize);
      return { start, end: start + periodSize - 1 };
    }

    function getBip110TooltipPeriodLabel(data) {
      const period = Number(data?.period);
      if (period === 18) return "Mandatory Signaling";
      if (period === 19) return "Latest Lock-In";
      if (period === 20) return "Latest Activation";
      return `BIP-110 ${data?.period}`;
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
      PANEL_KEYS.forEach((key) => {
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

    function panelHasManualHeight(key) {
      return Number.isFinite(state.manualPanelHeights[key])
        || Number.isFinite(state.manualPanelHeightRatios[key]);
    }

    function normalizeDefaultFilledPanelHeights() {
      PANEL_KEYS.forEach((key) => {
        if (panelHasManualHeight(key)) return;
        state.filledPanels[key] = true;
      });
    }

    function isPanelViewportFilled(key) {
      return Boolean(state.filledPanels[key]) || !panelHasManualHeight(key);
    }

    function applyDynamicPanelHeights() {
      const visiblePanels = getVisiblePanelKeys().map((key) => ({ key, box: getCanvasBoxElement(key) }));
      if (!visiblePanels.length) return;

      visiblePanels.forEach(({ key, box }) => {
        const panel = getPanelElement(key);
        const manual = state.manualPanelHeights[key];
        const isFilledPanel = state.filledPanels[key];
        const targetHeight = isFilledPanel || !Number.isFinite(manual)
          ? getViewportFillHeightForSinglePanel()
          : clampPanelResizeHeight(manual);
        panel.style.height = `${targetHeight}px`;
        box.style.height = "";
      });

      if (!state.controls.showSegwit) {
        segwitPanel.style.height = "";
      }
      if (!(state.controls.showBip110 && state.controls.showLegacyNode)) {
        bip110Panel.style.height = "";
      }
      if (!(state.controls.showBip110 && state.controls.showBip110Node)) {
        bip110NodePanel.style.height = "";
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

    function getVisiblePanelCount() {
      return getVisiblePanelKeys().length;
    }

    function getCompactTargetHeight(visibleCount) {
      const count = Math.max(1, Number(visibleCount) || 1);
      if (count === 1) {
        return clampPanelResizeHeight(getHalfPanelHeight());
      }
      return getEqualSplitPanelHeight(count);
    }

    function resolvePanelResizeSnap(key, rawHeightPx) {
      const visibleCount = getVisiblePanelCount();
      const manualHeight = clampPanelResizeHeight(rawHeightPx);
      const compactHeight = getCompactTargetHeight(visibleCount);
      const compactDistance = Math.abs(manualHeight - compactHeight);

      const fillHeight = clampPanelResizeHeight(getViewportFillHeightForSinglePanel());
      const fillDistance = Math.abs(manualHeight - fillHeight);

      if (fillHeight != null && fillDistance <= PANEL_RESIZE_SNAP_PX && fillDistance <= compactDistance) {
        return { mode: "fill", height: fillHeight };
      }
      if (compactDistance <= PANEL_RESIZE_SNAP_PX) {
        return { mode: "compact", height: compactHeight };
      }
      return { mode: "manual", height: manualHeight };
    }

    function applyPanelResizeMode(key, mode, targetHeight) {
      const panel = getPanelElement(key);
      if (!panel) return;

      if (mode === "fill") {
        state.filledPanels[key] = true;
        state.manualPanelHeights[key] = null;
        state.manualPanelHeightRatios[key] = null;
        panel.style.height = `${clampPanelResizeHeight(targetHeight)}px`;
      } else {
        const appliedHeight = setManualPanelHeight(key, targetHeight);
        state.filledPanels[key] = false;
        panel.style.height = `${appliedHeight}px`;
      }

      updateFillButtonState(key);
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
      const btn = getFillButtonElement(key);
      if (!btn) return;
      const filled = isPanelViewportFilled(key);
      btn.innerHTML = filled ? FILL_BTN_SVG_COMPACT : FILL_BTN_SVG_EXPAND;
      btn.title = filled ? "Compact chart height" : "Fill chart height";
      btn.setAttribute("aria-label", filled
        ? `Compact ${getPanelLabel(key)} chart height`
        : `Fill ${getPanelLabel(key)} chart height`);
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
      const visibleCount = getVisiblePanelCount();
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

      if (bip110NodeFillHeightBtn) {
        bip110NodeFillHeightBtn.addEventListener("click", () => {
          if (state.filledPanels.bip110Node) compactSinglePanel("bip110Node");
          else fillSinglePanelToViewportHeight("bip110Node");
        });
      }
    }

    function setupPanelResizeHandles() {
      const bindHandle = (handle, key, box) => {
        const panel = getPanelElement(key);
        if (!handle || !box) return;

        handle.addEventListener("pointerdown", (ev) => {
          ev.preventDefault();

          const startY = ev.clientY;
          const startHeight = panel.getBoundingClientRect().height;

          document.body.classList.add("resizing-panel");

          const onPointerMove = (moveEv) => {
            const deltaY = moveEv.clientY - startY;
            const snap = resolvePanelResizeSnap(key, startHeight + deltaY);
            applyPanelResizeMode(key, snap.mode, snap.height);
            box.style.height = "";
            updateResetButtonUi();
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

            // Persist only the panel that was actively resized, honoring snapped mode.
            if (state.filledPanels[key]) {
              state.manualPanelHeights[key] = null;
              state.manualPanelHeightRatios[key] = null;
            } else {
              setManualPanelHeight(key, panel.getBoundingClientRect().height);
            }
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
      bindHandle(bip110NodeResizeHandle, "bip110Node", bip110NodeCanvasBox);
    }

    function drawPanelTag(ctx, { text, chart, plot, isMobile }) {
      const label = String(text || "").trim();
      if (!label) return;

      const colors = getCanvasColors(chart.colors);
      const x = isMobile ? 10 : 12;
      const y = plot.y - 28;

      ctx.save();
      ctx.font = `${isMobile ? 10 : 11}px "IBM Plex Mono", monospace`;
      ctx.fillStyle = colors.muted || colors.foreground;
      ctx.textAlign = "left";
      ctx.textBaseline = "bottom";
      ctx.fillText(label, x, y);
      ctx.restore();
    }

    function drawAxes(ctx, { plot, panelWidth, xScale, yScale, xMax, xAxisLabelMax = xMax, periodSize, title, panelTag = "", ticks, showBottomAxis, chart, isMobile }) {
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
      drawPanelTag(ctx, { text: panelTag, chart, plot, isMobile });

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
          `Period: SegWit ${data.period}`,
          `Height: ${Number(data.period_start_height).toLocaleString()}-${Number(data.period_end_height).toLocaleString()}`,
          `Signaling: ${signal.toLocaleString()} (${pctLabel(signal, periodSize)})`,
          `Non-signaling: ${non.toLocaleString()} (${pctLabel(non, periodSize)})`,
        ].join("\n");
      }

      const signal = Number(data.signal_blocks || 0);
      const elapsed = Number(data.elapsed_blocks || 0);
      const periodSize = Number(state?.data?.metadata?.chart?.period_size || 2016);
      const non = clamp(elapsed - signal, 0, periodSize);
      const unmined = clamp(periodSize - elapsed, 0, periodSize);
      const status = String(data.status || "");
      const displayStatus = formatBip110Status(status);
      const heightStart = Number(data.period_start_height);
      const heightEnd = Number(data.period_end_height);
      const inferredHeights = status === "post_window" ? getBip110PostWindowHeights(data, periodSize) : null;
      const startHeight = Number.isFinite(heightStart) && heightStart > 0 ? heightStart : Number(inferredHeights?.start);
      const endHeight = Number.isFinite(heightEnd) && heightEnd > 0 ? heightEnd : Number(inferredHeights?.end);
      const heightLine = Number.isFinite(startHeight) && Number.isFinite(endHeight)
        ? `Height: ${startHeight.toLocaleString()} - ${endHeight.toLocaleString()}`
        : "Height: Unavailable";

      const lines = [
        `Period: ${getBip110TooltipPeriodLabel(data)}`,
        `Status: ${displayStatus}`,
        heightLine,
      ];

      if (status === "completed") {
        lines.push(`Signaling: ${signal.toLocaleString()} (${pctLabel(signal, periodSize)})`);
        lines.push(`Non-signaling: ${non.toLocaleString()} (${pctLabel(non, periodSize)})`);
      } else if (status === "in_progress") {
        lines.push(`Signaling: ${signal.toLocaleString()} (${pctLabel(signal, periodSize)})`);
        lines.push(`Non-signaling: ${non.toLocaleString()} (${pctLabel(non, periodSize)})`);
        lines.push(`Unmined: ${unmined.toLocaleString()} (${pctLabel(unmined, periodSize)})`);
      } else {
        lines.push(`Unmined: ${unmined.toLocaleString()} (${pctLabel(unmined, periodSize)})`);
      }

      return lines.join("\n");
    }

    function formatReleaseTooltip(data) {
      const when = data.release_time_utc
        ? String(data.release_time_utc)
        : "Date/time unavailable";
      return [
        `Release: ${String(data.label || "Release")}`,
        `Date: ${when}`,
      ].join("\n");
    }

    function formatBlockVersionHex(version) {
      const n = Number(version);
      if (!Number.isFinite(n) || n === 0) return "";
      return `0x${(n >>> 0).toString(16).padStart(8, "0")}`;
    }

    function normalizeMinerTooltipData(miner) {
      if (!miner) {
        return { name: "", slug: "", pool: "", subMiner: "" };
      }
      if (typeof miner === "string") {
        return { name: miner.trim(), slug: "", pool: "", subMiner: "" };
      }
      if (typeof miner === "object") {
        return {
          name: String(miner.name || "").trim(),
          slug: String(miner.slug || "").trim(),
          pool: String(miner.pool || "").trim(),
          subMiner: String(miner.subMiner || miner.sub_miner || "").trim(),
        };
      }
      return { name: "", slug: "", pool: "", subMiner: "" };
    }

    function formatBlockTooltipDate(blockTime) {
      const timestamp = Number(blockTime);
      if (!Number.isFinite(timestamp) || timestamp <= 0) return "";
      return formatGeneratedDateTimeForSelectedTimeZone(new Date(timestamp * 1000).toISOString());
    }

    function formatStripeTooltip(data, chartType) {
      const fork = chartType === "segwit" ? "SegWit" : "BIP-110";
      const mode = Number(data.is_signaling) === 1
        ? `Signaling for ${fork}`
        : `Non-signaling for ${fork}`;
      const dateText = formatBlockTooltipDate(data.block_time);
      const lines = dateText
        ? [`Date: ${dateText}`, `Height: ${Number(data.height).toLocaleString()}`]
        : [`Height: ${Number(data.height).toLocaleString()}`];
      const versionHex = formatBlockVersionHex(data.version);
      lines.push(`Version: ${versionHex || "Loading..."}`);
      lines.push(`Mode: ${mode}`);
      const miner = normalizeMinerTooltipData(data.miner);
      if (chartType === "bip110" || chartType === "segwit") {
        lines.push(`Miner: ${miner.name || "Unavailable"}`);
        if (miner.slug) {
          lines.push(`MinerSlug: ${miner.slug}`);
        }
        if (miner.pool) {
          lines.push(`MinerPool: ${miner.pool}`);
        }
        if (miner.subMiner) {
          lines.push(`MinerSub: ${miner.subMiner}`);
        }
      }
      return lines.join("\n");
    }

    function getPeriodGridDataset() {
      return state.periodGridDataset === "segwit" ? "segwit" : "bip110";
    }

    function getBip110PeriodsForNodeView(nodeView) {
      const view = normalizeBip110NodeView(nodeView);
      if (view === "bip110") {
        const nodePeriods = state.data?.bip110NodePeriods || state.dynamicData?.bip110NodePeriods;
        if (Array.isArray(nodePeriods) && nodePeriods.length) return nodePeriods;
      }
      return state.data?.bip110Periods || state.dynamicData?.bip110Periods || [];
    }

    function getBip110BlocksForNodeView(nodeView) {
      const view = normalizeBip110NodeView(nodeView);
      if (view === "bip110") {
        const nodeBlocks = state.data?.bip110NodeBlocks || state.dynamicData?.bip110NodeBlocks;
        if (Array.isArray(nodeBlocks) && nodeBlocks.length) return nodeBlocks;
      }
      return state.data?.bip110Blocks || state.dynamicData?.bip110Blocks || [];
    }

    function getBip110MinerMapForNodeView(nodeView) {
      const view = normalizeBip110NodeView(nodeView);
      if (view === "bip110") {
        const nodeMinerMap = state.dynamicData?.bip110NodeSignalMiners || state.data?.bip110NodeSignalMiners || state.dynamicData?.bip110NodeMiners || state.data?.bip110NodeMiners;
        if (nodeMinerMap && typeof nodeMinerMap === "object" && Object.keys(nodeMinerMap).length > 0) return nodeMinerMap;
      }
      return null;
    }

    function getPeriodGridRows(datasetKey = getPeriodGridDataset()) {
      if (!state.data) return [];
      return datasetKey === "segwit"
        ? (state.data.segwitPeriods || [])
        : getBip110PeriodsForNodeView(state.periodGridNodeView);
    }

    function getPeriodGridBlocks(datasetKey = getPeriodGridDataset()) {
      if (!state.data) return [];
      return datasetKey === "segwit"
        ? (state.data.segwitBlocks || [])
        : getBip110BlocksForNodeView(state.periodGridNodeView);
    }

    function getPeriodGridRow(periodNumber, datasetKey = getPeriodGridDataset()) {
      const target = Number(periodNumber);
      if (!Number.isFinite(target)) return null;
      return getPeriodGridRows(datasetKey).find((row) => Number(row.period) === target) || null;
    }

    function getCurrentBip110PeriodNumber() {
      const currentPeriod = Number(state.data?.metadata?.state?.current_period_index);
      return Number.isFinite(currentPeriod) ? currentPeriod : null;
    }

    function getPeriodGridAvailablePeriods(datasetKey = getPeriodGridDataset()) {
      return getPeriodGridRows(datasetKey)
        .map((row) => Number(row.period))
        .filter((period) => Number.isFinite(period))
        .sort((left, right) => left - right);
    }

    function getDefaultPeriodGridPeriod(datasetKey = getPeriodGridDataset()) {
      const availablePeriods = getPeriodGridAvailablePeriods(datasetKey);
      if (datasetKey === "bip110") {
        const currentPeriod = getCurrentBip110PeriodNumber();
        if (Number.isFinite(currentPeriod) && availablePeriods.includes(currentPeriod)) {
          return currentPeriod;
        }
      }
      return availablePeriods[availablePeriods.length - 1] || 1;
    }

    function getSelectedPeriodGridPeriod() {
      const availablePeriods = getPeriodGridAvailablePeriods();
      const selected = Number(state.periodGridSelectedPeriod);
      if (Number.isFinite(selected) && availablePeriods.includes(selected)) {
        return selected;
      }
      return getDefaultPeriodGridPeriod();
    }

    function ensurePeriodGridPeriodSelectOptions() {
      if (!periodGridPeriodSelect) return;
      const availablePeriods = getPeriodGridAvailablePeriods();
      const currentValues = Array.from(periodGridPeriodSelect.options).map((option) => option.value);
      const desiredValues = availablePeriods.map((period) => String(period));
      if (currentValues.length === desiredValues.length && currentValues.every((value, index) => value === desiredValues[index])) {
        return;
      }
      periodGridPeriodSelect.innerHTML = "";
      availablePeriods.forEach((period) => {
        const option = document.createElement("option");
        option.value = String(period);
        option.textContent = String(period);
        periodGridPeriodSelect.appendChild(option);
      });
    }

    function setPeriodGridSelectedPeriod(periodNumber) {
      const requested = Number(periodNumber);
      const availablePeriods = getPeriodGridAvailablePeriods();
      const normalized = Number.isFinite(requested) && availablePeriods.includes(requested)
        ? requested
        : getDefaultPeriodGridPeriod();
      state.periodGridSelectedPeriod = normalized;
      if (periodGridPeriodSelect) {
        periodGridPeriodSelect.value = String(normalized);
      }
    }

    function updatePeriodGridNodeViewButtons() {
      state.periodGridNodeView = normalizeBip110NodeView(state.periodGridNodeView);
      periodGridNodeButtons.forEach((button) => {
        const active = normalizeBip110NodeView(button.dataset.periodGridNode) === state.periodGridNodeView;
        button.classList.toggle("is-active", active);
        button.setAttribute("aria-pressed", active ? "true" : "false");
      });
      if (periodGridNodeControls) {
        const show = getPeriodGridDataset() === "bip110";
        periodGridNodeControls.hidden = !show;
        periodGridNodeControls.style.display = show ? "" : "none";
      }
    }

    function cyclePeriodGridPeriod(delta) {
      const availablePeriods = getPeriodGridAvailablePeriods();
      if (!availablePeriods.length) return;
      const current = getSelectedPeriodGridPeriod();
      const currentIndex = Math.max(0, availablePeriods.indexOf(current));
      const nextIndex = (currentIndex + delta + availablePeriods.length) % availablePeriods.length;
      setPeriodGridSelectedPeriod(availablePeriods[nextIndex]);
      renderCurrentPeriodGridOverlay();
    }

    function handlePeriodGridModalKeydown(event) {
      if (!isPeriodGridOverlayOpen()) return;
      const isArrowLeft = event.key === "ArrowLeft";
      const isArrowRight = event.key === "ArrowRight";
      const isSpace = event.key === " " || event.key === "Spacebar" || event.code === "Space";
      if (!isArrowLeft && !isArrowRight && !isSpace) return;
      if (event.altKey || event.ctrlKey || event.metaKey) return;

      event.preventDefault();
      event.stopPropagation();
      if (typeof event.stopImmediatePropagation === "function") {
        event.stopImmediatePropagation();
      }
      if (isSpace) {
        closePeriodGridOverlay();
        return;
      }
      cyclePeriodGridPeriod(isArrowRight ? 1 : -1);
    }

    function buildCurrentPeriodGridCells() {
      const datasetKey = getPeriodGridDataset();
      const selectedPeriod = getSelectedPeriodGridPeriod();
      const row = getPeriodGridRow(selectedPeriod, datasetKey);
      if (!row || !state.data) return [];

      const periodSize = Number(state.data?.metadata?.chart?.period_size || 2016);
      const startHeight = Number(row.period_start_height);
      if (!Number.isFinite(startHeight)) return [];

      const status = String(row.status || "");
      const elapsed = datasetKey === "segwit"
        ? periodSize
        : status === "completed"
          ? periodSize
          : status === "in_progress"
            ? clamp(Number(row.elapsed_blocks || 0), 0, periodSize)
            : 0;

      const currentPeriod = Number(row.period);
      const blockByHeight = new Map();
      getPeriodGridBlocks(datasetKey).forEach((block) => {
        if (Number(block.period) !== currentPeriod) return;
        const height = Number(block.height);
        if (!Number.isFinite(height)) return;
        blockByHeight.set(height, block);
      });

      const cells = [];
      for (let idx = 0; idx < periodSize; idx += 1) {
        const height = startHeight + idx;
        const hasMinedBlock = idx < elapsed;
        const block = blockByHeight.get(height) || null;

        if (hasMinedBlock && block) {
          const isSignaling = Number(block.is_signaling) === 1;
          const isLowActivityBlock = datasetKey === "segwit" && Number(block.is_low_activity_block) === 1;
          cells.push({
            height,
            isSignaling,
            isLowActivityBlock,
            isMined: true,
            className: `${isSignaling ? "is-signaling" : "is-nonsignaling"}${isLowActivityBlock ? " is-low-activity-block" : ""}`,
            tooltip: formatStripeTooltip(block, datasetKey),
            clickable: true,
          });
          continue;
        }

        cells.push({
          height,
          isSignaling: false,
          isMined: false,
          className: "is-unmined",
          tooltip: [
            `Height: ${Number(height).toLocaleString()}`,
            "Mode: Unmined",
          ].join("\n"),
          clickable: false,
        });
      }

      return cells;
    }

    function renderTooltipHtml(content) {
      const escapeHtml = (value) => String(value ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/\"/g, "&quot;")
        .replace(/'/g, "&#39;");

      const lines = String(content || "").split("\n");
      const tooltipFork = (() => {
        const modeLine = lines.find((line) => /^Mode:/i.test(String(line || "").trim()));
        const modeText = String(modeLine || "");
        if (/SegWit/i.test(modeText)) return "segwit";
        if (/BIP-110/i.test(modeText)) return "bip110";
        return "";
      })();

      const renderVersionValue = (value) => {
        const raw = String(value || "").trim();
        if (/^Loading\.\.\.$/i.test(raw)) {
          return `<span class="tooltip-version-loading">${escapeHtml(raw)}</span>`;
        }
        if (!/^0x[0-9a-f]{8}$/i.test(raw)) {
          return escapeHtml(value);
        }

        const version = Number.parseInt(raw.slice(2), 16);
        if (!Number.isFinite(version)) {
          return escapeHtml(value);
        }

        let signalNibbleIndex = -1;
        if (tooltipFork === "segwit" && (version & (1 << 1)) !== 0) {
          signalNibbleIndex = raw.length - 1;
        } else if (tooltipFork === "bip110" && (version & (1 << 4)) !== 0) {
          signalNibbleIndex = raw.length - 2;
        }

        if (signalNibbleIndex < 0) {
          return escapeHtml(value);
        }

        return [
          escapeHtml(raw.slice(0, signalNibbleIndex)),
          `<span class="tooltip-version-signal-bit">${escapeHtml(raw.charAt(signalNibbleIndex))}</span>`,
          escapeHtml(raw.slice(signalNibbleIndex + 1)),
        ].join("");
      };

      const renderMinerValue = (value) => {
        const raw = String(value || "").trim();
        if (/^Unavailable$/i.test(raw)) {
          return `<span class="tooltip-miner-unavailable">${escapeHtml(raw)}</span>`;
        }
        const slugLine = lines.find((line) => /^MinerSlug:/i.test(String(line || "").trim()));
        const poolLine = lines.find((line) => /^MinerPool:/i.test(String(line || "").trim()));
        const subMinerLine = lines.find((line) => /^MinerSub:/i.test(String(line || "").trim()));
        const slug = String(slugLine || "").replace(/^MinerSlug:\s*/i, "").trim().toLowerCase();
        const pool = String(poolLine || "").replace(/^MinerPool:\s*/i, "").trim();
        const subMiner = String(subMinerLine || "").replace(/^MinerSub:\s*/i, "").trim();
        const safeSlug = /^[a-z0-9-]+$/.test(slug) ? slug : "";
        const defaultIconSrc = "assets/mining-pools/default.svg";
        const iconSrc = safeSlug && !missingMinerIconSlugs.has(safeSlug)
          ? `assets/mining-pools/${escapeHtml(safeSlug)}.svg`
          : defaultIconSrc;
        const onError = safeSlug && !missingMinerIconSlugs.has(safeSlug)
          ? `window.__bip110MinerIconMissing&&window.__bip110MinerIconMissing('${safeSlug}');this.onerror=null;this.src='${defaultIconSrc}'`
          : `this.onerror=null`;
        const iconHtml = `<img class="tooltip-miner-icon" src="${iconSrc}" alt="" aria-hidden="true" onerror="${onError}">`;

        if (subMiner && pool) {
          return [
            `<span class="tooltip-miner-with-icon">`,
            `<span class="tooltip-miner-name">${escapeHtml(subMiner)}</span>`,
            iconHtml,
            `<span class="tooltip-miner-pool">${escapeHtml(pool)}</span>`,
            `</span>`,
          ].join("");
        }

        return [
          `<span class="tooltip-miner-with-icon">`,
          iconHtml,
          `<span class="tooltip-miner-name">${escapeHtml(raw)}</span>`,
          `</span>`,
        ].join("");
      };

      const renderSignalingValue = (value) => {
        const raw = String(value || "").trim();
        const match = raw.match(/^([0-9][0-9,]*)(\s*\([^)]*\))?$/);
        if (!match) {
          return escapeHtml(raw);
        }
        const count = Number(match[1].replace(/,/g, ""));
        if (!Number.isFinite(count) || count <= 0) {
          return escapeHtml(raw);
        }
        return [
          `<span class="chip-value-signal">${escapeHtml(match[1])}</span>`,
          escapeHtml(match[2] || ""),
        ].join("");
      };

      return lines
        .map((line) => {
          const match = line.match(/^([^:]+:)(\s*)(.*)$/);
          if (!match) {
            return `<div class="tooltip-line"><span class="tooltip-value">${escapeHtml(line)}</span></div>`;
          }
          const label = match[1].toLowerCase();
          if (label === "minerslug:" || label === "minerpool:" || label === "minersub:") {
            return "";
          }
          const valueHtml = label === "version:"
            ? renderVersionValue(match[3])
            : label === "miner:"
              ? renderMinerValue(match[3])
              : label === "signaling:"
                ? renderSignalingValue(match[3])
                : escapeHtml(match[3]);
          const lineClass = label === "miner:" ? " tooltip-line-miner" : "";
          const valueClass = label === "miner:" ? " tooltip-value-miner" : "";
          return `<div class="tooltip-line${lineClass}"><span class="tooltip-label">${escapeHtml(match[1])}</span><span class="tooltip-value${valueClass}">${valueHtml}</span></div>`;
        })
        .join("");
    }

    let activePeriodGridTooltipContent = "";

    function showPeriodGridTooltip(content, clientX, clientY, options = {}) {
      if (!periodGridTooltip || (!isPeriodGridOverlayOpen() && !isMinerTimelineOverlayOpen())) return;
      const normalizedContent = String(content || "");
      if (activePeriodGridTooltipContent !== normalizedContent) {
        periodGridTooltip.innerHTML = renderTooltipHtml(normalizedContent);
        activePeriodGridTooltipContent = normalizedContent;
      }
      periodGridTooltip.classList.toggle("is-compact", !!options.compact);
      const activeContent = isMinerTimelineOverlayOpen() ? minerTimelineContent : periodGridContent;
      const activeDialog = isMinerTimelineOverlayOpen() ? minerTimelineDialog : periodGridDialog;
      const activeOverlay = isMinerTimelineOverlayOpen() ? minerTimelineOverlay : periodGridOverlay;
      const contentRect = options.constrainToGrid === false ? null : activeContent?.getBoundingClientRect();
      const dialogRect = activeDialog?.getBoundingClientRect();
      const overlayRect = activeOverlay?.getBoundingClientRect();
      const bounds = contentRect || dialogRect || overlayRect || {
        left: 0,
        top: 0,
        right: window.innerWidth,
        bottom: window.innerHeight,
      };

      const tipW = periodGridTooltip.offsetWidth || 320;
      const tipH = periodGridTooltip.offsetHeight || 64;
      const edgePad = 10;
      const yOffset = 14;
      const half = tipW / 2;

      const minX = bounds.left + edgePad + half;
      const maxX = bounds.right - edgePad - half;
      const clampedX = clamp(clientX, Math.min(minX, maxX), Math.max(minX, maxX));

      const roomAbove = clientY - bounds.top - edgePad;
      const showBelow = options.placement === "below"
        ? true
        : options.placement === "above"
          ? false
          : roomAbove < tipH + yOffset;
      const minY = showBelow
        ? bounds.top + edgePad - yOffset
        : bounds.top + edgePad + tipH + yOffset;
      const maxY = showBelow
        ? bounds.bottom - edgePad - tipH - yOffset
        : bounds.bottom - edgePad + yOffset;
      const clampedY = clamp(clientY, Math.min(minY, maxY), Math.max(minY, maxY));

      periodGridTooltip.style.left = `${clampedX}px`;
      periodGridTooltip.style.top = `${clampedY}px`;
      periodGridTooltip.style.transform = showBelow
        ? "translate(-50%, 14px)"
        : "translate(-50%, calc(-100% - 14px))";
      periodGridTooltip.classList.add("show");
    }

    function hidePeriodGridTooltip() {
      if (!periodGridTooltip) return;
      periodGridTooltip.classList.remove("show");
    }

    function clearMobilePendingActivation() {
      state.mobilePendingActivation = null;
    }

    function shouldDeferMobileActivation(kind, id) {
      if (!isMobileUiViewport()) return false;
      const key = String(kind || "");
      const value = String(id || "");
      if (!key || !value) return false;
      const pending = state.mobilePendingActivation;
      if (pending && pending.kind === key && pending.id === value) {
        clearMobilePendingActivation();
        return false;
      }
      state.mobilePendingActivation = { kind: key, id: value };
      return true;
    }

    function isPeriodGridOverlayOpen() {
      return Boolean(periodGridOverlay?.classList.contains("show"));
    }

    function isMinerTimelineOverlayOpen() {
      return Boolean(minerTimelineOverlay?.classList.contains("show"));
    }

    function notifyParentPeriodGridOverlayState(isOpen) {
      if (window.self === window.top) return;
      try {
        window.parent?.postMessage(
          { type: "bip110-period-grid-overlay", open: !!isOpen },
          window.location.origin
        );
      } catch (_err) {
        // Best effort only.
      }
    }

    function closePeriodGridOverlay() {
      if (!periodGridOverlay) return;
      clearMobilePendingActivation();
      periodGridOverlay.classList.remove("show");
      periodGridOverlay.setAttribute("aria-hidden", "true");
      hidePeriodGridTooltip();
      notifyParentPeriodGridOverlayState(false);
    }

    function getPeriodGridAvailableSpace() {
      const overlayStyle = periodGridOverlay ? getComputedStyle(periodGridOverlay) : null;
      const dialogStyle = periodGridDialog ? getComputedStyle(periodGridDialog) : null;
      const headerRect = periodGridHeader?.getBoundingClientRect();
      const headerStyle = periodGridHeader ? getComputedStyle(periodGridHeader) : null;
      const legendRect = periodGridLegend?.getBoundingClientRect();
      const legendStyle = periodGridLegend ? getComputedStyle(periodGridLegend) : null;

      const overlayPadLeft = parseFloat(overlayStyle?.paddingLeft || "0");
      const overlayPadRight = parseFloat(overlayStyle?.paddingRight || "0");
      const overlayPadTop = parseFloat(overlayStyle?.paddingTop || "0");
      const overlayPadBottom = parseFloat(overlayStyle?.paddingBottom || "0");

      const dialogPadX = (parseFloat(dialogStyle?.paddingLeft || "0") + parseFloat(dialogStyle?.paddingRight || "0"));
      const dialogPadY = (parseFloat(dialogStyle?.paddingTop || "0") + parseFloat(dialogStyle?.paddingBottom || "0"));

      const maxDialogWidth = Math.min(
        window.innerWidth - overlayPadLeft - overlayPadRight,
        window.innerWidth * 0.92,
        1220
      );
      const maxDialogHeight = Math.min(
        window.innerHeight - overlayPadTop - overlayPadBottom,
        window.innerHeight * 0.9
      );

      const headerHeight = headerRect?.height || 0;
      const headerMarginBottom = parseFloat(headerStyle?.marginBottom || "0");
      const legendHeight = legendRect?.height || 0;
      const legendMarginTop = parseFloat(legendStyle?.marginTop || "0");
      const legendMarginBottom = parseFloat(legendStyle?.marginBottom || "0");
      const legendSpace = legendHeight + legendMarginTop + legendMarginBottom;

      const availableWidth = Math.max(40, maxDialogWidth - dialogPadX);
      const availableHeight = Math.max(40, maxDialogHeight - dialogPadY - headerHeight - headerMarginBottom - legendSpace);

      return { availableWidth, availableHeight };
    }

    function choosePeriodGridDimensionsForSpace(cellCount, availableWidth, availableHeight) {
      const total = Number(cellCount || 0);
      if (!Number.isFinite(total) || total <= 0) {
        return { cols: 63, rows: 32 };
      }

      const targetAspect = Number(availableWidth) / Math.max(Number(availableHeight) || 1, 1);

      const candidates = [];
      for (let cols = 1; cols <= Math.sqrt(total); cols += 1) {
        if (total % cols !== 0) continue;
        const rows = total / cols;
        candidates.push({ cols, rows });
        if (rows !== cols) {
          candidates.push({ cols: rows, rows: cols });
        }
      }

      // Avoid degenerate ultra-thin layouts and keep options in practical dashboard ranges.
      const practical = candidates.filter((candidate) => candidate.cols >= 24 && candidate.rows >= 24);
      const pool = practical.length ? practical : candidates;

      pool.sort((left, right) => {
        const leftScore = Math.abs((left.cols / left.rows) - targetAspect);
        const rightScore = Math.abs((right.cols / right.rows) - targetAspect);
        if (leftScore !== rightScore) return leftScore - rightScore;

        // Tie-break toward shapes near prior default around 63x32.
        const leftTie = Math.abs(left.cols - 63) + Math.abs(left.rows - 32);
        const rightTie = Math.abs(right.cols - 63) + Math.abs(right.rows - 32);
        return leftTie - rightTie;
      });

      return pool[0] || { cols: 63, rows: 32 };
    }

    function choosePeriodGridDimensions(cellCount) {
      const space = getPeriodGridAvailableSpace();
      return choosePeriodGridDimensionsForSpace(cellCount, space.availableWidth, space.availableHeight);
    }

    function computePeriodGridCellSizeForSpace(cols, rows, availableWidth, availableHeight, fitMarginX = 0, fitMarginY = 6) {
      const minCellPx = 4;
      const gapPx = 1;

      const colsNum = Math.max(1, Number(cols) || 1);
      const rowsNum = Math.max(1, Number(rows) || 1);

      const usableWidth = Math.max(40, Number(availableWidth || 0) - (fitMarginX * 2));
      const usableHeight = Math.max(40, Number(availableHeight || 0) - (fitMarginY * 2));

      const byWidth = Math.floor((usableWidth - ((colsNum - 1) * gapPx)) / colsNum);
      const byHeight = Math.floor((usableHeight - ((rowsNum - 1) * gapPx)) / rowsNum);
      const target = Math.min(byWidth, byHeight);

      return Math.max(minCellPx, target);
    }

    function computePeriodGridCellSize(cols, rows) {
      const fitSpace = getPeriodGridAvailableSpace();
      return computePeriodGridCellSizeForSpace(cols, rows, fitSpace.availableWidth, fitSpace.availableHeight);
    }

    function formatPercentCompact(numerator, denominator) {
      const num = Number(numerator || 0);
      const den = Number(denominator || 0);
      if (!Number.isFinite(num) || !Number.isFinite(den) || den <= 0) return "0.0%";
      const pct = (num / den) * 100;
      const roundedOne = Math.round(pct * 10) / 10;
      return `${roundedOne.toFixed(1)}%`;
    }

    function formatSignalingValueWithOrangeNumerator(signalingText) {
      const text = String(signalingText || "").trim();
      const match = text.match(/^([0-9][0-9,]*)\/([0-9][0-9,]*)\s+\(([^)]+)\)$/);
      if (!match) return text;
      const [, numerator, denominator, pct] = match;
      return `<span class="period-grid-signal-num">${numerator}</span>/${denominator} (${pct})`;
    }

    function getCurrentPeriodGridSummary() {
      const datasetKey = getPeriodGridDataset();
      const selectedPeriod = getSelectedPeriodGridPeriod();
      const row = getPeriodGridRow(selectedPeriod, datasetKey);
      if (!row || !state.data) {
        return {
          period: String(selectedPeriod),
          range: "Height Range: -",
          signaling: "Signaling: -",
        };
      }

      const periodSize = Number(state.data?.metadata?.chart?.period_size || 2016);
      const period = Number(row.period);
      const startHeight = Number(row.period_start_height);
      const endHeight = Number.isFinite(Number(row.period_end_height))
        ? Number(row.period_end_height)
        : (Number.isFinite(startHeight) ? (startHeight + periodSize - 1) : null);

      const status = String(row.status || "");
      const mined = datasetKey === "segwit"
        ? periodSize
        : status === "completed"
          ? periodSize
          : status === "in_progress"
            ? clamp(Number(row.elapsed_blocks || 0), 0, periodSize)
            : 0;
      const signaling = clamp(Number(row.signal_blocks || 0), 0, mined);
      const signalingPct = formatPercentCompact(signaling, Math.max(mined, 1));

      const periodText = Number.isFinite(period) ? String(period) : String(selectedPeriod);
      const rangeText = (Number.isFinite(startHeight) && Number.isFinite(endHeight))
        ? `Height Range: ${startHeight.toLocaleString()} - ${endHeight.toLocaleString()}`
        : "Height Range: -";
      const signalingText = `Signaling: ${signaling.toLocaleString()}/${mined.toLocaleString()} (${signalingPct})`;

      return {
        period: periodText,
        range: rangeText,
        signaling: signalingText,
      };
    }

    function renderCurrentPeriodGridOverlay() {
      if (!periodGridContent) return;
      periodGridContent.innerHTML = "";

      const summary = getCurrentPeriodGridSummary();
      ensurePeriodGridPeriodSelectOptions();
      const datasetKey = getPeriodGridDataset();
      if (periodGridPeriodLabel) {
        periodGridPeriodLabel.textContent = datasetKey === "segwit" ? "SegWit Signaling Period" : "BIP-110 Signaling Period";
      }
      if (periodGridPeriodSelect) {
        periodGridPeriodSelect.setAttribute("aria-label", datasetKey === "segwit" ? "SegWit signaling period" : "BIP-110 signaling period");
      }
      if (periodGridPeriodSelect) {
        periodGridPeriodSelect.value = String(summary.period || getSelectedPeriodGridPeriod());
      }
      if (periodGridLowActivityLegendItem) {
        const showLowActivityLegend = datasetKey === "segwit";
        periodGridLowActivityLegendItem.hidden = !showLowActivityLegend;
        periodGridLowActivityLegendItem.style.display = showLowActivityLegend ? "" : "none";
      }
      updatePeriodGridNodeViewButtons();
      if (periodGridRangeValue) periodGridRangeValue.textContent = String(summary.range || "").replace(/^Height Range:\s*/i, "");
      if (periodGridSignalValue) {
        periodGridSignalValue.innerHTML = formatSignalingValueWithOrangeNumerator(
          String(summary.signaling || "").replace(/^Signaling:\s*/i, "")
        );
      }

      const cells = buildCurrentPeriodGridCells();
      if (!cells.length) return;

      const dims = choosePeriodGridDimensions(cells.length);
      const cellSizePx = computePeriodGridCellSize(dims.cols, dims.rows);
      periodGridContent.style.setProperty("--period-grid-cols", String(dims.cols));
      periodGridContent.style.setProperty("--period-grid-cell-size", `${cellSizePx}px`);
      periodGridContent.style.setProperty("--period-grid-gap", "1px");
      periodGridContent.setAttribute("data-grid-cols", String(dims.cols));
      periodGridContent.setAttribute("data-grid-rows", String(dims.rows));
      periodGridContent.setAttribute("data-grid-cell-size", String(cellSizePx));

      const fragment = document.createDocumentFragment();
      cells.forEach((cell) => {
        const cellEl = document.createElement("button");
        cellEl.type = "button";
        cellEl.className = `period-grid-cell ${cell.className}`;
        cellEl.dataset.height = String(cell.height);
        cellEl.dataset.tooltip = cell.tooltip;
        cellEl.dataset.clickable = cell.clickable ? "1" : "0";
        if (!cell.clickable) {
          cellEl.setAttribute("aria-disabled", "true");
        }
        fragment.appendChild(cellEl);
      });

      periodGridContent.appendChild(fragment);
    }

    function openPeriodGridOverlay(periodOverride = null, datasetKey = "bip110", nodeViewOverride = null) {
      if (!periodGridOverlay || !periodGridDialog) return;
      closeLeaderboardOverlay();
      closeMinerTimelineOverlay();
      state.periodGridDataset = datasetKey === "segwit" ? "segwit" : "bip110";
      if (state.periodGridDataset === "bip110" && nodeViewOverride != null) {
        state.periodGridNodeView = normalizeBip110NodeView(nodeViewOverride);
      }
      const hasExplicitOverride = periodOverride !== null && periodOverride !== undefined && periodOverride !== "";
      const requestedPeriod = hasExplicitOverride ? Number(periodOverride) : NaN;
      if (hasExplicitOverride && Number.isFinite(requestedPeriod)) {
        setPeriodGridSelectedPeriod(requestedPeriod);
      } else {
        setPeriodGridSelectedPeriod(getDefaultPeriodGridPeriod(state.periodGridDataset));
      }
      updatePeriodGridNodeViewButtons();
      state.pinnedTooltip = null;
      clearMobilePendingActivation();
      hideTooltip();
      hideCustomTooltip();
      hidePeriodGridTooltip();
      periodGridOverlay.classList.add("show");
      periodGridOverlay.setAttribute("aria-hidden", "false");
      renderCurrentPeriodGridOverlay();
      periodGridDialog.focus({ preventScroll: true });
      notifyParentPeriodGridOverlayState(true);
    }

    function getBip110LeaderboardMinerMap() {
      const explicit = state.dynamicData?.bip110LeaderboardMiners || state.data?.bip110LeaderboardMiners;
      if (explicit && typeof explicit === "object" && Object.keys(explicit).length > 0) {
        return explicit;
      }
      const fallback = state.dynamicData?.bip110SignalMiners || state.data?.bip110SignalMiners;
      return fallback && typeof fallback === "object" ? fallback : {};
    }

    function normalizeLeaderboardMiner(rawMiner) {
      const miner = normalizeMinerTooltipData(rawMiner);
      const name = miner.subMiner || miner.name || "Unknown";
      const pool = miner.subMiner ? (miner.pool || miner.name || "") : miner.pool;
      const slug = String(miner.slug || "").trim().toLowerCase();
      return {
        name,
        pool,
        slug,
        key: [
          slug && /^[a-z0-9-]+$/.test(slug) ? slug : "",
          String(name || "").trim().toLowerCase(),
          String(pool || "").trim().toLowerCase(),
        ].join("|"),
      };
    }

    function hasUsableMinerAttribution(rawMiner) {
      const miner = normalizeMinerTooltipData(rawMiner);
      return !!(miner.name || miner.subMiner || miner.pool || miner.slug);
    }

    function getMaxAttributedMinerHeight(minerMap) {
      if (!minerMap || typeof minerMap !== "object") return -Infinity;
      return Object.entries(minerMap).reduce((maxHeight, [heightRaw, rawMiner]) => {
        if (!hasUsableMinerAttribution(rawMiner)) return maxHeight;
        const height = Number(heightRaw);
        return Number.isFinite(height) ? Math.max(maxHeight, height) : maxHeight;
      }, -Infinity);
    }

    function getWindowMs(windowName) {
      switch (windowName) {
        case "past24h":
          return 24 * 60 * 60 * 1000;
        case "past7d":
          return 7 * 24 * 60 * 60 * 1000;
        case "past14d":
          return 14 * 24 * 60 * 60 * 1000;
        case "all":
        default:
          return 0;
      }
    }

    function getLeaderboardWindowMs() {
      return getWindowMs(state.leaderboardWindow);
    }

    function getLeaderboardWindowLabel() {
      switch (state.leaderboardWindow) {
        case "last":
          return "the last completed period";
        case "current":
          return "the current period";
        case "past24h":
          return "the past 24 hours";
        case "past7d":
          return "the past 7 days";
        case "past14d":
          return "the past 14 days";
        case "all":
        default:
          return "all loaded blocks";
      }
    }

    function getLeaderboardWindowStartMs(blocks) {
      const windowMs = getLeaderboardWindowMs();
      if (!windowMs) return null;
      const maxBlockTimeMs = Math.max(
        ...blocks
          .map((block) => Number(block?.block_time || 0) * 1000)
          .filter((timeMs) => Number.isFinite(timeMs) && timeMs > 0)
      );
      if (!Number.isFinite(maxBlockTimeMs) || maxBlockTimeMs <= 0) return null;
      return maxBlockTimeMs - windowMs;
    }

    function updateLeaderboardWindowButtons() {
      leaderboardWindowButtons.forEach((button) => {
        const active = button.dataset.leaderboardWindow === state.leaderboardWindow;
        button.classList.toggle("is-active", active);
        button.setAttribute("aria-pressed", active ? "true" : "false");
      });
    }

    function updateMinerTimelineWindowButtons() {
      minerTimelineWindowButtons.forEach((button) => {
        const active = button.dataset.minerTimelineWindow === state.minerTimelineWindow;
        button.classList.toggle("is-active", active);
        button.setAttribute("aria-pressed", active ? "true" : "false");
      });
    }

    function updateMinerTimelineMinerButtons() {
      minerTimelineMinerButtons.forEach((button) => {
        const active = button.dataset.minerTimelineMiners === state.minerTimelineMiners;
        button.classList.toggle("is-active", active);
        button.setAttribute("aria-pressed", active ? "true" : "false");
      });
    }

    function normalizeMinerTimelineOrder(value) {
      return value === "recent" ? "recent" : "total";
    }

    function updateMinerTimelineOrderControls() {
      state.minerTimelineOrder = normalizeMinerTimelineOrder(state.minerTimelineOrder);
      minerTimelineOrderButtons.forEach((button) => {
        const active = button.dataset.minerTimelineOrder === state.minerTimelineOrder;
        button.classList.toggle("is-active", active);
        button.setAttribute("aria-pressed", active ? "true" : "false");
      });
      if (minerTimelineSignalersFirst) {
        minerTimelineSignalersFirst.checked = state.minerTimelineSignalersFirst !== false;
      }
    }

    function updateMinerTimelineNodeViewButtons() {
      state.minerTimelineNodeView = normalizeBip110NodeView(state.minerTimelineNodeView);
      minerTimelineNodeButtons.forEach((button) => {
        const active = normalizeBip110NodeView(button.dataset.minerTimelineNode) === state.minerTimelineNodeView;
        button.classList.toggle("is-active", active);
        button.setAttribute("aria-pressed", active ? "true" : "false");
      });
    }

    function getPeriodFilterForWindow(windowName) {
      const currentPeriod = getCurrentBip110PeriodNumber();
      if (!Number.isFinite(currentPeriod)) return null;
      if (windowName === "current") {
        return currentPeriod;
      }
      if (windowName === "last") {
        return Math.max(1, currentPeriod - 1);
      }
      return null;
    }

    function getLeaderboardPeriodFilter() {
      return getPeriodFilterForWindow(state.leaderboardWindow);
    }

    function getLeaderboardFilteredBlocks(blocks) {
      const windowStartMs = getLeaderboardWindowStartMs(blocks);
      const periodFilter = getLeaderboardPeriodFilter();
      return blocks.filter((block) => {
        if (periodFilter != null) return Number(block?.period) === periodFilter;
        if (windowStartMs == null) return true;
        const blockTimeMs = Number(block?.block_time || 0) * 1000;
        return Number.isFinite(blockTimeMs) && blockTimeMs >= windowStartMs;
      });
    }

    function getFilteredBlocksForWindow(blocks, windowName) {
      const periodFilter = getPeriodFilterForWindow(windowName);
      const windowMs = getWindowMs(windowName);
      let windowStartMs = null;
      if (windowMs) {
        const maxBlockTimeMs = Math.max(
          ...blocks
            .map((block) => Number(block?.block_time || 0) * 1000)
            .filter((timeMs) => Number.isFinite(timeMs) && timeMs > 0)
        );
        if (Number.isFinite(maxBlockTimeMs) && maxBlockTimeMs > 0) {
          windowStartMs = maxBlockTimeMs - windowMs;
        }
      }
      return blocks.filter((block) => {
        if (periodFilter != null) return Number(block?.period) === periodFilter;
        if (windowStartMs == null) return true;
        const blockTimeMs = Number(block?.block_time || 0) * 1000;
        return Number.isFinite(blockTimeMs) && blockTimeMs >= windowStartMs;
      });
    }

    function formatLeaderboardRange(blocks) {
      if (!Array.isArray(blocks) || blocks.length === 0) return "-";

      const heights = blocks
        .map((block) => Number(block?.height))
        .filter((height) => Number.isFinite(height));
      if (!heights.length) return "-";
      const minHeight = Math.min(...heights);
      const maxHeight = Math.max(...heights);
      return `${minHeight.toLocaleString()} - ${maxHeight.toLocaleString()}`;
    }

    function formatLeaderboardSignalingValue(signalingBlocks, totalBlocks) {
      const signalingCount = Number(signalingBlocks) || 0;
      const blockCount = Number(totalBlocks) || 0;
      const percentText = blockCount > 0 ? pctLabel(signalingCount, blockCount) : "0.0%";
      return `<span class="chip-value-signal">${signalingCount.toLocaleString()}</span> / ${blockCount.toLocaleString()} (${percentText})`;
    }

    function buildBip110LeaderboardRows() {
      const minerMap = getBip110LeaderboardMinerMap();
      const blocks = state.data?.bip110Blocks || state.dynamicData?.bip110Blocks || [];
      const filteredBlocks = getLeaderboardFilteredBlocks(blocks);
      const signalingBlocks = filteredBlocks.filter((block) => Number(block?.is_signaling) === 1);
      const total = signalingBlocks.length;
      const blockTotal = filteredBlocks.length;
      const counts = new Map();

      signalingBlocks.forEach((block) => {
        const height = Number(block?.height);
        if (!Number.isFinite(height)) return;
        const rawMiner = minerMap[String(height)] || block.miner || null;
        const miner = normalizeLeaderboardMiner(rawMiner);
        const current = counts.get(miner.key) || {
          name: miner.name,
          pool: miner.pool,
          slug: miner.slug,
          count: 0,
        };
        current.count += 1;
        if (!current.slug && miner.slug) current.slug = miner.slug;
        if (!current.pool && miner.pool) current.pool = miner.pool;
        counts.set(miner.key, current);
      });

      const rows = Array.from(counts.values())
        .sort((left, right) => {
          if (right.count !== left.count) return right.count - left.count;
          return String(left.name || "").localeCompare(String(right.name || ""));
        })
        .map((row, index) => ({
          ...row,
          rank: index + 1,
          pct: total > 0 ? row.count / total : 0,
        }));

      return {
        total,
        blockTotal,
        rows,
        windowLabel: getLeaderboardWindowLabel(),
        rangeLabel: formatLeaderboardRange(filteredBlocks),
      };
    }

    function setMinerIconSource(img, slug) {
      const safeSlug = /^[a-z0-9-]+$/.test(String(slug || "")) ? String(slug).toLowerCase() : "";
      const defaultIconSrc = "assets/mining-pools/default.svg";
      img.src = safeSlug && !missingMinerIconSlugs.has(safeSlug)
        ? `assets/mining-pools/${safeSlug}.svg`
        : defaultIconSrc;
      img.onerror = () => {
        if (safeSlug) missingMinerIconSlugs.add(safeSlug);
        img.onerror = null;
        img.src = defaultIconSrc;
      };
    }

    function renderBip110LeaderboardOverlay() {
      if (!leaderboardContent) return;
      updateLeaderboardWindowButtons();
      const { total, blockTotal, rows, windowLabel, rangeLabel } = buildBip110LeaderboardRows();
      if (leaderboardTotalValue) leaderboardTotalValue.innerHTML = formatLeaderboardSignalingValue(total, blockTotal);
      if (leaderboardRangeValue) leaderboardRangeValue.textContent = rangeLabel;
      leaderboardContent.innerHTML = "";

      if (!rows.length) {
        const empty = document.createElement("div");
        empty.className = "leaderboard-empty";
        empty.textContent = total === 0
          ? `No BIP-110 signaling blocks were found for ${windowLabel}.`
          : `No signaling miner attribution is available for ${windowLabel}.`;
        leaderboardContent.appendChild(empty);
        return;
      }

      const list = document.createElement("ol");
      list.className = "leaderboard-list";
      rows.forEach((row) => {
        const item = document.createElement("li");
        item.className = "leaderboard-row";

        const rank = document.createElement("div");
        rank.className = "leaderboard-rank";
        rank.textContent = `#${row.rank}`;

        const miner = document.createElement("div");
        miner.className = "leaderboard-miner";
        const icon = document.createElement("img");
        icon.className = "leaderboard-miner-icon";
        icon.alt = "";
        icon.setAttribute("aria-hidden", "true");
        setMinerIconSource(icon, row.slug);

        const minerText = document.createElement("div");
        minerText.className = "leaderboard-miner-text";
        const name = document.createElement("div");
        name.className = "leaderboard-miner-name";
        name.textContent = row.name || "Unknown";
        minerText.appendChild(name);
        if (row.pool) {
          const pool = document.createElement("div");
          pool.className = "leaderboard-miner-pool";
          pool.textContent = row.pool;
          minerText.appendChild(pool);
        }
        miner.appendChild(icon);
        miner.appendChild(minerText);

        const count = document.createElement("div");
        count.className = "leaderboard-count";
        count.textContent = row.count.toLocaleString();
        const pct = document.createElement("span");
        pct.className = "leaderboard-pct";
        pct.textContent = formatPercentCompact(row.count, total);
        count.appendChild(pct);

        item.appendChild(rank);
        item.appendChild(miner);
        item.appendChild(count);
        list.appendChild(item);
      });
      leaderboardContent.appendChild(list);
    }

    function getBip110TimelineMinerMap() {
      const selectedMap = getBip110MinerMapForNodeView(state.minerTimelineNodeView);
      if (selectedMap) return selectedMap;
      const full = state.dynamicData?.bip110SignalMiners || state.data?.bip110SignalMiners;
      if (full && typeof full === "object" && Object.keys(full).length > 0) {
        return full;
      }
      return getBip110LeaderboardMinerMap();
    }

    function getTimelineIndexForBlock(block, firstPeriod, periodSize) {
      const height = Number(block?.height);
      const period = Number(block?.period);
      if (!Number.isFinite(height) || !Number.isFinite(period)) return null;
      const yInPeriod = Number.isFinite(Number(block?.y_in_period))
        ? Number(block.y_in_period)
        : (height % periodSize);
      return ((period - firstPeriod) * periodSize) + clamp(yInPeriod, 0, periodSize - 1);
    }

    const MINER_TIMELINE_LEFT_PADDING_PX = 12;
    const MINER_TIMELINE_RIGHT_PADDING_PX = 6;
    const MINER_TIMELINE_ALL_RIGHT_PADDING_PX = 18;
    const MINER_TIMELINE_STICKY_COLUMNS_WIDTH_PX = 220 + 72 + 72 + 72;

    function getMinerTimelineRightPadding() {
      return state.minerTimelineWindow === "all"
        ? MINER_TIMELINE_ALL_RIGHT_PADDING_PX
        : MINER_TIMELINE_RIGHT_PADDING_PX;
    }

    function getTimelineWindowMetricsForBlocks(blocks, firstPeriod, periodSize) {
      const indexes = Array.isArray(blocks)
        ? blocks
          .map((block) => getTimelineIndexForBlock(block, firstPeriod, periodSize))
          .filter((index) => Number.isFinite(index))
        : [];
      if (!indexes.length) {
        return {
          startIndex: 0,
          endIndex: 0,
          span: 0,
        };
      }
      const startIndex = Math.min(...indexes);
      const endIndex = Math.max(...indexes);
      return {
        startIndex,
        endIndex,
        span: Math.max(1, endIndex - startIndex + 1),
      };
    }

    function getBip110TimelineBlocks() {
      const allBlocks = getBip110BlocksForNodeView(state.minerTimelineNodeView);
      const blocks = getFilteredBlocksForWindow(allBlocks, state.minerTimelineWindow);
      const periodSize = Number(state.data?.metadata?.chart?.period_size || 2016);
      const loadedPeriods = blocks
        .map((block) => Number(block?.period))
        .filter((period) => Number.isFinite(period));
      if (!loadedPeriods.length) {
        return {
          periodSize,
          firstPeriod: null,
          lastPeriod: null,
          blocks: [],
        };
      }
      const firstPeriod = Math.min(...loadedPeriods);
      const lastPeriod = Math.max(...loadedPeriods);
      const filtered = blocks
        .filter((block) => {
          const period = Number(block?.period);
          const height = Number(block?.height);
          return Number.isFinite(period)
            && Number.isFinite(height)
            && period >= firstPeriod
            && period <= lastPeriod;
        })
        .sort((left, right) => Number(left.height) - Number(right.height));
      return {
        periodSize,
        firstPeriod,
        lastPeriod,
        blocks: filtered,
      };
    }

    function buildBip110MinerTimelineRows() {
      const minerMap = getBip110TimelineMinerMap();
      const maxAttributedMinerHeight = getMaxAttributedMinerHeight(minerMap);
      const { periodSize, firstPeriod, lastPeriod, blocks } = getBip110TimelineBlocks();
      if (!Number.isFinite(firstPeriod) || !Number.isFinite(lastPeriod) || blocks.length === 0) {
        return {
          periodSize,
          firstPeriod,
          lastPeriod,
          periodCount: 0,
          totalBlocks: 0,
          blockTotal: 0,
          signalingTotal: 0,
          rows: [],
          rangeLabel: "-",
        };
      }

      const minerRows = new Map();
      const compactTimeline = getWindowMs(state.minerTimelineWindow) > 0;
      const rawTimelineIndexes = blocks
        .map((block) => getTimelineIndexForBlock(block, firstPeriod, periodSize))
        .filter((index) => Number.isFinite(index));
      const timelineOffset = compactTimeline && rawTimelineIndexes.length
        ? Math.min(...rawTimelineIndexes)
        : 0;
      blocks.forEach((block) => {
        const height = Number(block?.height);
        if (!Number.isFinite(height)) return;
        const rawMiner = block.miner || minerMap[String(height)] || null;
        const miner = normalizeLeaderboardMiner(rawMiner);
        const isPendingMinerAttribution = !hasUsableMinerAttribution(rawMiner)
          && Number.isFinite(maxAttributedMinerHeight)
          && height > maxAttributedMinerHeight;
        const rawTimelineIndex = getTimelineIndexForBlock(block, firstPeriod, periodSize);
        if (!Number.isFinite(rawTimelineIndex)) return;
        const timelineIndex = Math.max(0, rawTimelineIndex - timelineOffset);
        const row = minerRows.get(miner.key) || {
          key: miner.key,
          name: miner.name,
          pool: miner.pool,
          slug: miner.slug,
          totalBlocks: 0,
          signalingBlocks: 0,
          nonSignalingBlocks: 0,
          latestSignalHeight: -Infinity,
          latestBlockHeight: -Infinity,
          latestBlockIsSignaling: false,
          latestBlock: null,
          pendingMinerAttribution: false,
          blocks: [],
        };
        if (isPendingMinerAttribution) row.pendingMinerAttribution = true;
        row.totalBlocks += 1;
        if (!row.slug && miner.slug) row.slug = miner.slug;
        if (!row.pool && miner.pool) row.pool = miner.pool;
        if (height > row.latestBlockHeight) {
          row.latestBlockHeight = height;
          row.latestBlockIsSignaling = Number(block?.is_signaling) === 1;
          row.latestBlock = block;
        }
        if (Number(block?.is_signaling) === 1) {
          row.signalingBlocks += 1;
          row.latestSignalHeight = Math.max(row.latestSignalHeight, height);
        } else {
          row.nonSignalingBlocks += 1;
        }
        row.blocks.push({
          block,
          timelineIndex,
        });
        minerRows.set(miner.key, row);
      });

      const compareMinerTimelineRowsByOrder = (left, right) => {
        if (normalizeMinerTimelineOrder(state.minerTimelineOrder) === "recent") {
          if (right.latestBlockHeight !== left.latestBlockHeight) return right.latestBlockHeight - left.latestBlockHeight;
          if (right.totalBlocks !== left.totalBlocks) return right.totalBlocks - left.totalBlocks;
          return String(left.name || "").localeCompare(String(right.name || ""));
        }
        if (right.totalBlocks !== left.totalBlocks) return right.totalBlocks - left.totalBlocks;
        if (right.latestBlockHeight !== left.latestBlockHeight) return right.latestBlockHeight - left.latestBlockHeight;
        return String(left.name || "").localeCompare(String(right.name || ""));
      };

      const sortMinerTimelineRows = (left, right) => {
        if (state.minerTimelineSignalersFirst !== false && left.latestBlockIsSignaling !== right.latestBlockIsSignaling) {
          return right.latestBlockIsSignaling ? 1 : -1;
        }
        return compareMinerTimelineRowsByOrder(left, right);
      };

      const visibleRows = Array.from(minerRows.values()).filter((row) => {
        if (state.minerTimelineMiners === "signaling") return row.latestBlockIsSignaling;
        if (state.minerTimelineMiners === "nonsignaling") return !row.latestBlockIsSignaling;
        return true;
      }).sort(sortMinerTimelineRows);
      const visibleBlocks = visibleRows.flatMap((row) => row.blocks.map((item) => item.block));
      const heights = visibleBlocks.map((block) => Number(block.height)).filter((height) => Number.isFinite(height));
      const signalingTotal = visibleBlocks.filter((block) => Number(block?.is_signaling) === 1).length;
      const total = visibleBlocks.length;
      const periodCount = lastPeriod - firstPeriod + 1;
      const maxTimelineIndex = blocks.reduce((maxValue, block) => {
        const rawTimelineIndex = getTimelineIndexForBlock(block, firstPeriod, periodSize);
        if (!Number.isFinite(rawTimelineIndex)) return maxValue;
        const timelineIndex = Math.max(0, rawTimelineIndex - timelineOffset);
        return Math.max(maxValue, timelineIndex);
      }, -1);
      const allBlocks = getBip110BlocksForNodeView(state.minerTimelineNodeView);
      const latest14dBlocks = state.minerTimelineWindow === "all"
        ? getFilteredBlocksForWindow(allBlocks, "past14d")
        : [];
      const visibleWindowMetrics = state.minerTimelineWindow === "all"
        ? getTimelineWindowMetricsForBlocks(latest14dBlocks, firstPeriod, periodSize)
        : { startIndex: 0, endIndex: 0, span: 0 };
      const rangeStartIndex = state.minerTimelineWindow === "all"
        ? visibleWindowMetrics.startIndex
        : 0;
      const rangeEndIndex = state.minerTimelineWindow === "all"
        ? visibleWindowMetrics.endIndex
        : Math.max(0, maxTimelineIndex);
      const rangeStartPeriod = (() => {
        if (state.minerTimelineWindow === "all" && latest14dBlocks.length) {
          const firstWindowBlock = latest14dBlocks.reduce((earliest, block) => {
            const blockIndex = getTimelineIndexForBlock(block, firstPeriod, periodSize);
            const earliestIndex = getTimelineIndexForBlock(earliest, firstPeriod, periodSize);
            if (!Number.isFinite(blockIndex)) return earliest;
            if (!earliest || !Number.isFinite(earliestIndex)) return block;
            return blockIndex < earliestIndex ? block : earliest;
          }, null);
          const period = Number(firstWindowBlock?.period);
          return Number.isFinite(period) ? period : firstPeriod;
        }
        return firstPeriod;
      })();
      return {
        periodSize,
        firstPeriod,
        lastPeriod,
        periodCount,
        totalBlocks: Math.max(1, maxTimelineIndex + 1),
        visibleWindowBlocks: visibleWindowMetrics.span,
        rangeStartIndex,
        rangeEndIndex,
        rangeStartPeriod,
        timelineOffset,
        compactTimeline,
        blockTotal: total,
        signalingTotal,
        rows: visibleRows,
        rangeLabel: heights.length
          ? `${Math.min(...heights).toLocaleString()} - ${Math.max(...heights).toLocaleString()}`
          : "-",
      };
    }

    function getMinerTimelineCellSize(data) {
      const totalBlocks = Number(data?.totalBlocks || 1);
      const size = state.minerTimelineWindow === "all"
        ? Math.max(1, Number(data?.visibleWindowBlocks || 0) || totalBlocks)
        : Math.max(1, totalBlocks);
      const dialogWidth = Number(minerTimelineDialog?.getBoundingClientRect?.().width || 0);
      const contentWidth = Number(minerTimelineContent?.getBoundingClientRect?.().width || 0);
      const fallbackWidth = Math.min(window.innerWidth * 0.92, 1180) - 24;
      const availableWidth = Math.max(180, (contentWidth || dialogWidth || fallbackWidth) - MINER_TIMELINE_STICKY_COLUMNS_WIDTH_PX - 18);
      const gutterWidth = MINER_TIMELINE_LEFT_PADDING_PX + getMinerTimelineRightPadding();
      return Math.max(0.35, Math.max(80, availableWidth - gutterWidth) / Math.max(1, size));
    }

    function renderBip110MinerTimelineOverlay() {
      if (!minerTimelineContent) return;
      updateMinerTimelineNodeViewButtons();
      const data = buildBip110MinerTimelineRows();
      const cellSize = getMinerTimelineCellSize(data);
      minerTimelineContent.innerHTML = "";
      minerTimelineContent.style.setProperty("--miner-timeline-total-blocks", String(Math.max(data.totalBlocks || 0, 1)));
      minerTimelineContent.style.setProperty("--miner-timeline-cell-size", `${cellSize}px`);
      minerTimelineContent.style.setProperty("--miner-timeline-left-padding", `${MINER_TIMELINE_LEFT_PADDING_PX}px`);
      minerTimelineContent.style.setProperty("--miner-timeline-right-padding", `${getMinerTimelineRightPadding()}px`);
      const timelineOffset = Number(data.timelineOffset || 0);
      const rangeStartIndex = Number(data.rangeStartIndex || 0);
      const rangeEndIndex = Number(data.rangeEndIndex || rangeStartIndex);
      const effectiveRangeStartIndex = data.compactTimeline ? 0 : rangeStartIndex;
      const effectiveRangeOffset = data.compactTimeline ? timelineOffset : rangeStartIndex;
      const offsetInPeriod = data.periodSize
        ? ((effectiveRangeOffset % data.periodSize) + data.periodSize) % data.periodSize
        : 0;
      minerTimelineContent.dataset.latestWindowLeft = String(rangeStartIndex * cellSize);
      minerTimelineContent.dataset.latestWindowRight = String(
        MINER_TIMELINE_LEFT_PADDING_PX
          + ((Math.max(rangeStartIndex, rangeEndIndex) + 1) * cellSize)
          + getMinerTimelineRightPadding()
      );
      minerTimelineContent.dataset.latestPeriodLeft = String(
        data.periodSize && Number.isFinite(data.firstPeriod) && Number.isFinite(data.lastPeriod)
          ? MINER_TIMELINE_LEFT_PADDING_PX + Math.max(0, (((data.lastPeriod - data.firstPeriod) * data.periodSize) - timelineOffset) * cellSize)
          : 0
      );
      updateMinerTimelineWindowButtons();
      updateMinerTimelineMinerButtons();
      updateMinerTimelineOrderControls();
      if (minerTimelineRangeValue) minerTimelineRangeValue.textContent = data.rangeLabel;
      if (minerTimelineSignalValue) {
        minerTimelineSignalValue.innerHTML = formatLeaderboardSignalingValue(data.signalingTotal, data.blockTotal);
      }

      if (!data.rows.length) {
        const empty = document.createElement("div");
        empty.className = "miner-timeline-empty";
        empty.textContent = "No BIP-110 miner attribution is available for the signaling window.";
        minerTimelineContent.appendChild(empty);
        return;
      }

      const axis = document.createElement("div");
      axis.className = "miner-timeline-axis";
      const axisLabel = document.createElement("div");
      axisLabel.className = "miner-timeline-axis-label";
      axisLabel.textContent = "Miner";
      const axisNon = document.createElement("div");
      axisNon.className = "miner-timeline-axis-count is-nonsignaling";
      axisNon.textContent = "Non";
      const axisSig = document.createElement("div");
      axisSig.className = "miner-timeline-axis-count is-signaling";
      axisSig.textContent = "Sig";
      const axisLatest = document.createElement("div");
      axisLatest.className = "miner-timeline-axis-count is-latest";
      axisLatest.textContent = "Latest";
      const axisTrack = document.createElement("div");
      axisTrack.className = "miner-timeline-axis-track";
      const renderPeriodMarker = (period, markerIndex, options = {}) => {
        const marker = document.createElement("div");
        marker.className = "miner-timeline-period-marker";
        if (options.rangeStart) marker.classList.add("is-range-start");
        if (!options.divider) marker.classList.add("is-floating-label");
        marker.style.left = `${MINER_TIMELINE_LEFT_PADDING_PX + (markerIndex * cellSize)}px`;
        marker.textContent = `Period ${period.toLocaleString()}`;
        axisTrack.appendChild(marker);
      };
      const periodDividers = [];
      const shouldRenderRangeStartLabel = data.compactTimeline;
      const suppressInitialRangeDivider = state.minerTimelineWindow === "current" || state.minerTimelineWindow === "last";
      if (shouldRenderRangeStartLabel) {
        const renderRangeDivider = offsetInPeriod === 0 && !suppressInitialRangeDivider;
        if (renderRangeDivider) {
          periodDividers.push(effectiveRangeStartIndex);
        }
        const nextBoundaryIndex = offsetInPeriod === 0
          ? data.periodSize
          : data.periodSize - offsetInPeriod;
        const spaceToNextBoundary = Number.isFinite(nextBoundaryIndex) && nextBoundaryIndex > 0
          ? Math.min(nextBoundaryIndex, data.totalBlocks) * cellSize
          : data.totalBlocks * cellSize;
        const startPeriod = Number(data.rangeStartPeriod || data.firstPeriod || 0);
        const startPeriodLabel = `Period ${startPeriod.toLocaleString()}`;
        const estimatedStartLabelWidth = (startPeriodLabel.length * 7) + 18;
        if (spaceToNextBoundary >= estimatedStartLabelWidth) {
          renderPeriodMarker(startPeriod, effectiveRangeStartIndex, {
            rangeStart: true,
            divider: renderRangeDivider,
          });
        }
      }
      for (let period = data.firstPeriod; period <= data.lastPeriod; period += 1) {
        const markerIndex = ((period - data.firstPeriod) * data.periodSize) - timelineOffset;
        if (markerIndex < 0 || markerIndex > data.totalBlocks) continue;
        if (shouldRenderRangeStartLabel && markerIndex === effectiveRangeStartIndex) continue;
        if (suppressInitialRangeDivider && markerIndex === 0) {
          renderPeriodMarker(period, markerIndex, {
            rangeStart: true,
            divider: false,
          });
          continue;
        }
        renderPeriodMarker(period, markerIndex, { divider: true });
        periodDividers.push(markerIndex);
      }
      axis.appendChild(axisLabel);
      axis.appendChild(axisNon);
      axis.appendChild(axisSig);
      axis.appendChild(axisLatest);
      axis.appendChild(axisTrack);
      minerTimelineContent.appendChild(axis);

      const fragment = document.createDocumentFragment();
      data.rows.forEach((row) => {
        const rowEl = document.createElement("div");
        rowEl.className = "miner-timeline-row";

        const minerEl = document.createElement("div");
        minerEl.className = "miner-timeline-miner";
        const icon = document.createElement("img");
        icon.className = "miner-timeline-miner-icon";
        icon.alt = "";
        icon.setAttribute("aria-hidden", "true");
        setMinerIconSource(icon, row.slug);
        const minerText = document.createElement("div");
        minerText.className = "miner-timeline-miner-text";
        const name = document.createElement("div");
        name.className = "miner-timeline-miner-name";
        name.textContent = row.pendingMinerAttribution && (row.name || "Unknown") === "Unknown"
          ? "Loading..."
          : (row.name || "Unknown");
        minerText.appendChild(name);
        minerEl.appendChild(icon);
        minerEl.appendChild(minerText);

        const nonCount = document.createElement("div");
        nonCount.className = "miner-timeline-count is-nonsignaling";
        nonCount.textContent = row.nonSignalingBlocks > 0 ? row.nonSignalingBlocks.toLocaleString() : "";
        const signalCount = document.createElement("div");
        signalCount.className = "miner-timeline-count is-signaling";
        signalCount.textContent = row.signalingBlocks > 0 ? row.signalingBlocks.toLocaleString() : "";
        const latestCell = document.createElement("div");
        latestCell.className = "miner-timeline-count is-latest";
        if (row.latestBlock) {
          const latestMark = document.createElement("button");
          latestMark.type = "button";
          latestMark.className = `miner-timeline-latest-block${Number(row.latestBlock?.is_signaling) === 1 ? " is-signaling" : ""}`;
          latestMark.dataset.tooltip = formatStripeTooltip(row.latestBlock, "bip110");
          latestMark.dataset.height = String(row.latestBlock.height);
          latestMark.setAttribute("aria-label", `Latest block ${Number(row.latestBlock.height).toLocaleString()}`);
          latestCell.appendChild(latestMark);
        }

        const track = document.createElement("div");
        track.className = "miner-timeline-track";
        periodDividers.forEach((markerIndex) => {
          const divider = document.createElement("div");
          divider.className = "miner-timeline-period-divider";
          divider.style.left = `${MINER_TIMELINE_LEFT_PADDING_PX + (markerIndex * cellSize)}px`;
          track.appendChild(divider);
        });
        row.blocks.forEach(({ block, timelineIndex }) => {
          const mark = document.createElement("button");
          mark.type = "button";
          mark.className = `miner-timeline-block${Number(block?.is_signaling) === 1 ? " is-signaling" : ""}`;
          mark.style.left = `${MINER_TIMELINE_LEFT_PADDING_PX + (timelineIndex * cellSize)}px`;
          mark.dataset.tooltip = formatStripeTooltip(block, "bip110");
          mark.dataset.height = String(block.height);
          mark.setAttribute("aria-label", `Block ${Number(block.height).toLocaleString()}`);
          track.appendChild(mark);
        });

        rowEl.appendChild(minerEl);
        rowEl.appendChild(nonCount);
        rowEl.appendChild(signalCount);
        rowEl.appendChild(latestCell);
        rowEl.appendChild(track);
        fragment.appendChild(rowEl);
      });
      minerTimelineContent.appendChild(fragment);
    }

    function scrollMinerTimelineToLatestPeriod() {
      if (!minerTimelineContent) return;
      const latestLeft = state.minerTimelineWindow === "all"
        ? Number(minerTimelineContent.dataset.latestWindowLeft || 0)
        : Number(minerTimelineContent.dataset.latestPeriodLeft || 0);
      const latestRight = Number(minerTimelineContent.dataset.latestWindowRight || 0);
      const scrollBackoff = state.minerTimelineWindow === "all" ? 0 : 24;
      requestAnimationFrame(() => {
        if (state.minerTimelineWindow === "all" && latestRight > 0) {
          const trackViewportWidth = Math.max(0, minerTimelineContent.clientWidth - MINER_TIMELINE_STICKY_COLUMNS_WIDTH_PX);
          minerTimelineContent.scrollLeft = Math.max(0, latestRight - trackViewportWidth);
          return;
        }
        minerTimelineContent.scrollLeft = Math.max(0, latestLeft - scrollBackoff);
      });
    }

    function closeMinerTimelineOverlay() {
      if (!minerTimelineOverlay) return;
      clearMobilePendingActivation();
      minerTimelineOverlay.classList.remove("show");
      minerTimelineOverlay.classList.remove("is-loading");
      minerTimelineOverlay.setAttribute("aria-hidden", "true");
      hidePeriodGridTooltip();
    }

    function waitForMinerTimelineFeedbackPaint() {
      return new Promise((resolve) => {
        requestAnimationFrame(() => {
          requestAnimationFrame(resolve);
        });
      });
    }

    async function openMinerTimelineOverlay() {
      if (!minerTimelineOverlay || !minerTimelineDialog) return;
      closePeriodGridOverlay();
      closeLeaderboardOverlay();
      state.pinnedTooltip = null;
      clearMobilePendingActivation();
      hideTooltip();
      hideCustomTooltip();
      hidePeriodGridTooltip();
      minerTimelineOverlay.classList.add("is-loading");
      minerTimelineOverlay.classList.add("show");
      minerTimelineOverlay.setAttribute("aria-hidden", "false");
      await waitForMinerTimelineFeedbackPaint();
      if (!minerTimelineOverlay.classList.contains("show")) return;
      renderBip110MinerTimelineOverlay();
      scrollMinerTimelineToLatestPeriod();
      minerTimelineOverlay.classList.remove("is-loading");
      minerTimelineDialog.focus({ preventScroll: true });
    }

    function closeLeaderboardOverlay() {
      if (!leaderboardOverlay) return;
      clearMobilePendingActivation();
      leaderboardOverlay.classList.remove("show");
      leaderboardOverlay.setAttribute("aria-hidden", "true");
    }

    function openLeaderboardOverlay() {
      if (!leaderboardOverlay || !leaderboardDialog) return;
      closePeriodGridOverlay();
      closeMinerTimelineOverlay();
      clearMobilePendingActivation();
      hideTooltip();
      hideCustomTooltip();
      renderBip110LeaderboardOverlay();
      leaderboardOverlay.classList.add("show");
      leaderboardOverlay.setAttribute("aria-hidden", "false");
      leaderboardDialog.focus({ preventScroll: true });
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
        knots: "bitcoinknots/bitcoin",
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

    function getTooltipPanelBounds(canvas) {
      if (!canvas) return null;
      const panel = canvas.closest(".card") || canvas.parentElement || canvas;
      return panel.getBoundingClientRect();
    }

    let activeTooltipContent = "";

    function showTooltip(content, clientX, clientY, boundsRect = null) {
      if (isPeriodGridOverlayOpen() || isMinerTimelineOverlayOpen()) {
        tooltip.classList.remove("show");
        return;
      }
      const normalizedContent = String(content || "");
      if (activeTooltipContent !== normalizedContent) {
        tooltip.innerHTML = renderTooltipHtml(normalizedContent);
        activeTooltipContent = normalizedContent;
      }
      const edgePad = 12;
      const viewportBounds = {
        left: 0,
        top: 0,
        right: window.innerWidth,
        bottom: window.innerHeight,
        width: window.innerWidth,
        height: window.innerHeight,
      };
      const rawBounds = boundsRect || viewportBounds;
      const bounds = {
        left: clamp(rawBounds.left, 0, viewportBounds.right),
        top: clamp(rawBounds.top, 0, viewportBounds.bottom),
        right: clamp(rawBounds.right, 0, viewportBounds.right),
        bottom: clamp(rawBounds.bottom, 0, viewportBounds.bottom),
      };
      if (bounds.right <= bounds.left) {
        bounds.left = viewportBounds.left;
        bounds.right = viewportBounds.right;
      }
      if (bounds.bottom <= bounds.top) {
        bounds.top = viewportBounds.top;
        bounds.bottom = viewportBounds.bottom;
      }
      const maxWidth = Math.max(180, Math.min(viewportBounds.width - (edgePad * 2), bounds.right - bounds.left - (edgePad * 2)));
      tooltip.style.maxWidth = `${maxWidth}px`;
      const tipW = tooltip.offsetWidth || 320;
      const tipH = tooltip.offsetHeight || 0;
      const half = tipW / 2;
      const clampedX = clamp(clientX, bounds.left + edgePad + half, bounds.right - edgePad - half);
      const offsetY = 14;
      const roomAbove = clientY - bounds.top - edgePad;
      const showBelow = roomAbove < tipH + offsetY;
      const minAnchorY = showBelow
        ? bounds.top + edgePad - offsetY
        : bounds.top + edgePad + tipH + offsetY;
      const maxAnchorY = showBelow
        ? bounds.bottom - edgePad - tipH - offsetY
        : bounds.bottom - edgePad + offsetY;
      const clampedY = clamp(clientY, Math.min(minAnchorY, maxAnchorY), Math.max(minAnchorY, maxAnchorY));
      tooltip.style.left = `${clampedX}px`;
      tooltip.style.top = `${clampedY}px`;
      tooltip.style.transform = showBelow
        ? "translate(-50%, 14px)"
        : "translate(-50%, calc(-100% - 14px))";
      tooltip.classList.add("show");
    }

    function hideTooltip() {
      if (!state.pinnedTooltip) {
        tooltip.classList.remove("show");
      }
    }

    function getCanvasHitTooltipContent(key, hit) {
      if (!hit) return "";
      return hit.type === "release"
        ? formatReleaseTooltip(hit.data)
        : hit.type === "stripe"
          ? formatStripeTooltip(hit.data, chartTypeForPanelKey(key))
          : formatPeriodTooltip(hit.data, chartTypeForPanelKey(key));
    }

    function getCanvasHitMobileActivation(hit, key) {
      if (!hit) return null;
      if (hit.type === "stripe") {
        const height = Number(hit.data?.height);
        return Number.isFinite(height) ? { kind: "canvas-stripe", id: `${key}:${height}` } : null;
      }
      if ((isBip110PanelKey(key) || key === "segwit") && hit.type === "period") {
        const period = Number(hit.data?.period);
        return Number.isFinite(period) ? { kind: "canvas-period", id: `${key}:${period}` } : null;
      }
      return null;
    }

    function pinCanvasHitTooltip(canvas, key, hit, ev) {
      const content = getCanvasHitTooltipContent(key, hit);
      state.pinnedTooltip = { content, x: ev.clientX, y: ev.clientY };
      showTooltip(content, ev.clientX, ev.clientY, getTooltipPanelBounds(canvas));
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
            ? formatStripeTooltip(hit.data, chartTypeForPanelKey(key))
          : formatPeriodTooltip(hit.data, chartTypeForPanelKey(key));
        showTooltip(content, ev.clientX, ev.clientY, getTooltipPanelBounds(canvas));
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
          clearMobilePendingActivation();
          hideTooltip();
          return;
        }

        const mobileActivation = getCanvasHitMobileActivation(hit, key);
        if (mobileActivation && shouldDeferMobileActivation(mobileActivation.kind, mobileActivation.id)) {
          pinCanvasHitTooltip(canvas, key, hit, ev);
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
          clearMobilePendingActivation();
          const url = getReleaseGithubUrl(hit.data);
          window.open(url, "_blank", "noopener,noreferrer");
          return;
        }

        if ((isBip110PanelKey(key) || key === "segwit") && hit.type === "period") {
          const period = Number(hit.data?.period);
          openPeriodGridOverlay(
            Number.isFinite(period) ? period : null,
            chartTypeForPanelKey(key),
            key === "bip110Node" ? "bip110" : key === "bip110" ? "legacy" : null
          );
          return;
        }

        clearMobilePendingActivation();
        pinCanvasHitTooltip(canvas, key, hit, ev);
      });
    }

    async function loadAndApplyBlockDataPhased(loadToken, metadata, datasetKeys = ["segwit", "bip110", "bip110Node"], cacheBust = null) {
      const applyBlocks = async (key, blocks, options = {}) => {
        if (loadToken !== state.phasedLoadToken || !state.data) return;

        if (key === "segwit") {
          state.staticData.segwitBlocks = attachLowActivityBlockData(attachMinerData(
            blocks,
            state.staticData?.segwitMiners
          ), state.staticData?.segwitLowActivityBlocks);
        } else if (key === "bip110Node") {
          state.dynamicData.bip110NodeBlocks = attachMinerData(
            blocks,
            state.dynamicData?.bip110NodeSignalMiners || state.dynamicData?.bip110NodeMiners
          );
        } else {
          state.dynamicData.bip110Blocks = attachMinerData(
            blocks,
            state.dynamicData?.bip110SignalMiners
          );
          if (options.reconcile !== false) {
            state.dynamicData = reconcileBip110PeriodsFromBlocks(state.dynamicData, metadata);
          }
        }

        state.data = buildCombinedData(state.staticData, state.dynamicData, state.data);
        if (options.reconcile !== false) {
          setStatus(state.data);
        }
        await renderSelectedPanelsWithSharedLoader(key === "bip110" || key === "bip110Node" ? BIP110_PANEL_KEYS : [key]);
        await nextPaint();
      };

      const loadPromises = datasetKeys.map((key) => loadBlockPointsForDataset(key, metadata, cacheBust)
        .then(async (blocks) => {
          if (key === "bip110") {
            const signalingBlocks = blocks.filter((block) => Number(block.is_signaling) === 1);
            if (signalingBlocks.length > 0 && signalingBlocks.length < blocks.length) {
              await applyBlocks(key, signalingBlocks, { reconcile: false });
            }
          }
          await applyBlocks(key, blocks);
        })
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

      if (selected.has("bip110") && state.controls.showBip110 && state.controls.showLegacyNode) {
        drawPanel({
          canvas: bip110Canvas,
          key: "bip110",
          title: "Reduced Data Temporary Softfork (BIP-110) Signaling Periods",
          panelTag: "Legacy: Core v28",
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

      if (selected.has("bip110Node") && state.controls.showBip110 && state.controls.showBip110Node) {
        drawPanel({
          canvas: bip110NodeCanvas,
          key: "bip110Node",
          title: "Reduced Data Temporary Softfork (BIP-110) Signaling Periods",
          panelTag: "BIP-110: Knots v29",
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
      renderSelectedPanels(PANEL_KEYS);
      refreshOpenOverlays();
    }

    function refreshOpenOverlays(options = {}) {
      if (isPeriodGridOverlayOpen()) {
        hidePeriodGridTooltip();
        if (options.followDefaultPeriodGrid) {
          setPeriodGridSelectedPeriod(getDefaultPeriodGridPeriod());
        }
        renderCurrentPeriodGridOverlay();
      }
      if (leaderboardOverlay?.classList.contains("show")) {
        renderBip110LeaderboardOverlay();
      }
      if (isMinerTimelineOverlayOpen()) {
        hidePeriodGridTooltip();
        renderBip110MinerTimelineOverlay();
      }
    }

    function hasVisibleSelectedPanel(keys) {
      return keys.some((key) => (
        (key === "segwit" && state.controls.showSegwit)
        || (key === "bip110" && state.controls.showBip110 && state.controls.showLegacyNode)
        || (key === "bip110Node" && state.controls.showBip110 && state.controls.showBip110Node)
      ));
    }

    async function renderSelectedPanelsWithSharedLoader(keys, options = {}) {
      const showLoader = hasVisibleSelectedPanel(keys);
      if (showLoader) {
        setDashboardLoaderVisible(true);
        await nextPaint();
      }
      renderSelectedPanels(keys, options);
      setDashboardLoaderVisible(false);
    }

    function setControlHandlers() {
      bindCustomTooltips();
      const stripes = document.getElementById("toggleStripes");
      const blockSymbolSelect = document.getElementById("blockSymbolSelect");
      const markers = document.getElementById("toggleMarkers");
      const labels = document.getElementById("toggleLabels");
      const segwitWindow = document.getElementById("toggleSegwitWindow");
      const bip110Window = document.getElementById("toggleBip110Window");
      const copyDashboardLinkButton = document.getElementById("copyDashboardLink");
      const resetDashboardButton = document.getElementById("resetDashboard");

      setCustomTooltip(copyDashboardLinkButton, "Copy shareable dashboard link");
      setCustomTooltip(resetDashboardButton, state.preResetStateSnapshot ? "Undo the last restore defaults action" : "Reset dashboard to defaults");
      setCustomTooltip(periodGridBtn, "Show current 2,016-block period grid");
      setCustomTooltip(leaderboardBtn, "Show signaling miner leaderboard");
      setCustomTooltip(minerTimelineBtn, "Show miner signaling timeline");

      stripes.addEventListener("change", () => {
        state.controls.stripes = stripes.checked;
        state.controls.stripesExplicit = true;
        persistControls();
        updateResetButtonUi();
        void renderSelectedPanelsWithSharedLoader(PANEL_KEYS);
      });

      if (blockSymbolSelect) {
        blockSymbolSelect.value = normalizeBlockSymbol(state.controls.blockSymbol);
        syncBlockSymbolControl();
        blockSymbolSelect.addEventListener("change", () => {
          state.controls.blockSymbol = normalizeBlockSymbol(blockSymbolSelect.value);
          blockSymbolSelect.value = state.controls.blockSymbol;
          syncBlockSymbolControl();
          persistControls();
          updateResetButtonUi();
          void renderSelectedPanelsWithSharedLoader(PANEL_KEYS);
        });
      }

      markers.addEventListener("change", () => {
        state.controls.markers = markers.checked;
        persistControls();
        updateResetButtonUi();
        void renderSelectedPanelsWithSharedLoader(PANEL_KEYS);
      });

      labels.addEventListener("change", () => {
        state.controls.labels = labels.checked;
        persistControls();
        updateResetButtonUi();
        void renderSelectedPanelsWithSharedLoader(PANEL_KEYS);
      });

      nodePanelButtons.forEach((button) => {
        button.addEventListener("click", () => {
          const key = button.getAttribute("data-node-panel");
          if (key === "legacy") {
            state.controls.showLegacyNode = !state.controls.showLegacyNode;
          } else if (key === "bip110") {
            state.controls.showBip110Node = !state.controls.showBip110Node;
          }
          enforceNodePanelSelectionRules();
          if (state.controls.showLegacyNode && state.controls.showBip110Node) {
            state.controls.showSegwit = false;
          }
          ensureAtLeastOnePanelVisible("bip110");
          syncPanelCheckboxes();
          persistControls();
          updateResetButtonUi();
          updatePanelVisibility();
          void renderSelectedPanelsWithSharedLoader(PANEL_KEYS);
        });
      });

      segwitWindow.addEventListener("change", () => {
        if (segwitWindow.disabled) {
          segwitWindow.checked = false;
          return;
        }
        if (!segwitWindow.checked && !bip110Window.checked) {
          bip110Window.checked = true;
        }
        state.controls.showSegwit = segwitWindow.checked;
        state.controls.showBip110 = bip110Window.checked;
        enforceNodePanelSelectionRules();
        ensureAtLeastOnePanelVisible("bip110");
        syncPanelCheckboxes();
        persistControls();
        updateResetButtonUi();
        updatePanelVisibility();
        void renderSelectedPanelsWithSharedLoader(PANEL_KEYS);
      });

      bip110Window.addEventListener("change", () => {
        if (!bip110Window.checked && !segwitWindow.checked) {
          segwitWindow.checked = true;
        }
        state.controls.showSegwit = segwitWindow.checked;
        state.controls.showBip110 = bip110Window.checked;
        enforceNodePanelSelectionRules();
        ensureAtLeastOnePanelVisible("bip110");
        syncPanelCheckboxes();
        persistControls();
        updateResetButtonUi();
        updatePanelVisibility();
        void renderSelectedPanelsWithSharedLoader(PANEL_KEYS);
      });

      copyDashboardLinkButton?.addEventListener("click", async () => {
        try {
          await copyDashboardLinkToClipboard(copyDashboardLinkButton);
        } catch (err) {
          console.error(err);
        }
      });

      periodGridBtn?.addEventListener("click", () => {
        if (!state.data) return;
        openPeriodGridOverlay(null, "bip110");
      });

      leaderboardBtn?.addEventListener("click", () => {
        if (!state.data) return;
        openLeaderboardOverlay();
      });

      minerTimelineBtn?.addEventListener("click", () => {
        if (!state.data) return;
        openMinerTimelineOverlay();
      });

      leaderboardWindowButtons.forEach((button) => {
        button.addEventListener("click", () => {
          const value = String(button.dataset.leaderboardWindow || "all");
          state.leaderboardWindow = normalizeBip110OverlayWindow(value);
          persistBip110OverlaySelections();
          renderBip110LeaderboardOverlay();
        });
      });

      periodGridNodeButtons.forEach((button) => {
        button.addEventListener("click", () => {
          state.periodGridNodeView = normalizeBip110NodeView(button.dataset.periodGridNode);
          setPeriodGridSelectedPeriod(getSelectedPeriodGridPeriod());
          persistBip110OverlaySelections();
          renderCurrentPeriodGridOverlay();
        });
      });

      minerTimelineNodeButtons.forEach((button) => {
        button.addEventListener("click", () => {
          state.minerTimelineNodeView = normalizeBip110NodeView(button.dataset.minerTimelineNode);
          persistBip110OverlaySelections();
          renderBip110MinerTimelineOverlay();
          scrollMinerTimelineToLatestPeriod();
        });
      });

      minerTimelineWindowButtons.forEach((button) => {
        button.addEventListener("click", () => {
          const value = String(button.dataset.minerTimelineWindow || "all");
          state.minerTimelineWindow = normalizeBip110OverlayWindow(value);
          persistBip110OverlaySelections();
          renderBip110MinerTimelineOverlay();
          scrollMinerTimelineToLatestPeriod();
        });
      });

      minerTimelineMinerButtons.forEach((button) => {
        button.addEventListener("click", () => {
          const value = String(button.dataset.minerTimelineMiners || "all");
          state.minerTimelineMiners = normalizeBip110TimelineMinerFilter(value);
          persistBip110OverlaySelections();
          renderBip110MinerTimelineOverlay();
          scrollMinerTimelineToLatestPeriod();
        });
      });

      minerTimelineOrderButtons.forEach((button) => {
        button.addEventListener("click", () => {
          state.minerTimelineOrder = normalizeMinerTimelineOrder(button.dataset.minerTimelineOrder);
          persistBip110OverlaySelections();
          renderBip110MinerTimelineOverlay();
          scrollMinerTimelineToLatestPeriod();
        });
      });

      minerTimelineSignalersFirst?.addEventListener("change", () => {
        state.minerTimelineSignalersFirst = minerTimelineSignalersFirst.checked;
        persistBip110OverlaySelections();
        renderBip110MinerTimelineOverlay();
        scrollMinerTimelineToLatestPeriod();
      });

      window.addEventListener("keydown", handlePeriodGridModalKeydown, true);

      const showPeriodGridLegendTooltip = (event) => {
        if (!periodGridLowActivityLegendItem || periodGridLowActivityLegendItem.hidden) return;
        const content = String(periodGridLowActivityLegendItem.getAttribute("data-period-grid-tooltip") || "").trim();
        if (!content) return;
        const rect = periodGridLowActivityLegendItem.getBoundingClientRect();
        const x = Number.isFinite(event?.clientX) ? event.clientX : rect.left + rect.width / 2;
        const y = Number.isFinite(event?.clientY) ? event.clientY : rect.top + rect.height / 2;
        showPeriodGridTooltip(content, x, y, { compact: true, constrainToGrid: false, placement: "below" });
      };

      periodGridLowActivityLegendItem?.addEventListener("mouseenter", showPeriodGridLegendTooltip);
      periodGridLowActivityLegendItem?.addEventListener("mousemove", showPeriodGridLegendTooltip);
      periodGridLowActivityLegendItem?.addEventListener("mouseleave", () => {
        hidePeriodGridTooltip();
      });

      periodGridOverlay?.addEventListener("mousemove", (event) => {
        const cell = event.target instanceof Element ? event.target.closest(".period-grid-cell") : null;
        const legendTooltipTarget = event.target instanceof Element ? event.target.closest("[data-period-grid-tooltip]") : null;
        if (legendTooltipTarget && !legendTooltipTarget.hidden) {
          const content = String(legendTooltipTarget.getAttribute("data-period-grid-tooltip") || "").trim();
          if (content) {
            showPeriodGridTooltip(content, event.clientX, event.clientY, { compact: true, constrainToGrid: false, placement: "below" });
            return;
          }
        }
        if (!cell) {
          hidePeriodGridTooltip();
          return;
        }
        const content = String(cell.getAttribute("data-tooltip") || "").trim();
        if (!content) {
          hidePeriodGridTooltip();
          return;
        }
        showPeriodGridTooltip(content, event.clientX, event.clientY);
      });

      periodGridOverlay?.addEventListener("mouseleave", () => {
        hidePeriodGridTooltip();
      });

      periodGridOverlay?.addEventListener("click", (event) => {
        const cell = event.target instanceof Element ? event.target.closest(".period-grid-cell") : null;
        if (cell) {
          if (cell.getAttribute("data-clickable") === "1") {
            const height = Number(cell.getAttribute("data-height"));
            if (Number.isFinite(height) && shouldDeferMobileActivation("period-grid-block", height)) {
              const content = String(cell.getAttribute("data-tooltip") || "").trim();
              if (content) {
                showPeriodGridTooltip(content, event.clientX, event.clientY);
              }
              return;
            }
            if (Number.isFinite(height)) {
              window.open(`https://mempool.space/block/${height}`, "_blank", "noopener,noreferrer");
            }
          }
          return;
        }

        if (event.target === periodGridOverlay) {
          clearMobilePendingActivation();
          closePeriodGridOverlay();
        }
      });

      periodGridOverlay?.addEventListener("keydown", (event) => {
        if (event.key === "Escape") {
          closePeriodGridOverlay();
          return;
        }

        if (event.key === "ArrowUp" || event.key === "ArrowDown") {
          event.preventDefault();
          cyclePeriodGridPeriod(event.key === "ArrowUp" ? 1 : -1);
          return;
        }

        if (event.key !== "Enter" && event.key !== " ") return;
        const cell = event.target instanceof Element ? event.target.closest(".period-grid-cell") : null;
        if (!cell || cell.getAttribute("data-clickable") !== "1") return;

        event.preventDefault();
        const height = Number(cell.getAttribute("data-height"));
        if (Number.isFinite(height)) {
          window.open(`https://mempool.space/block/${height}`, "_blank", "noopener,noreferrer");
        }
      });

      periodGridPeriodSelect?.addEventListener("change", () => {
        const selected = Number(periodGridPeriodSelect.value);
        setPeriodGridSelectedPeriod(selected);
        renderCurrentPeriodGridOverlay();
      });

      periodGridPeriodChip?.addEventListener("click", (event) => {
        if (!periodGridPeriodSelect) return;
        if (event.target instanceof Element && event.target.closest("#periodGridPeriodSelect")) return;
        if (event.target instanceof Element && event.target.closest("[data-period-grid-node]")) return;
        periodGridPeriodSelect.focus({ preventScroll: true });
        try {
          if (typeof periodGridPeriodSelect.showPicker === "function") {
            periodGridPeriodSelect.showPicker();
            return;
          }
        } catch (_) {
          // Fall through to click for browsers that gate showPicker behind user-gesture rules.
        }
        periodGridPeriodSelect.click();
      });

      periodGridClose?.addEventListener("click", () => {
        closePeriodGridOverlay();
      });

      leaderboardOverlay?.addEventListener("click", (event) => {
        if (event.target === leaderboardOverlay) {
          closeLeaderboardOverlay();
        }
      });

      leaderboardOverlay?.addEventListener("keydown", (event) => {
        if (event.key === "Escape") {
          closeLeaderboardOverlay();
        }
      });

      leaderboardClose?.addEventListener("click", () => {
        closeLeaderboardOverlay();
      });

      minerTimelineOverlay?.addEventListener("mousemove", (event) => {
        const mark = event.target instanceof Element
          ? event.target.closest(".miner-timeline-block, .miner-timeline-latest-block")
          : null;
        if (!mark) {
          hidePeriodGridTooltip();
          return;
        }
        const content = String(mark.getAttribute("data-tooltip") || "").trim();
        if (!content) {
          hidePeriodGridTooltip();
          return;
        }
        showPeriodGridTooltip(content, event.clientX, event.clientY, { constrainToGrid: false });
      });

      minerTimelineOverlay?.addEventListener("mouseleave", () => {
        hidePeriodGridTooltip();
      });

      minerTimelineOverlay?.addEventListener("click", (event) => {
        const mark = event.target instanceof Element
          ? event.target.closest(".miner-timeline-block, .miner-timeline-latest-block")
          : null;
        if (mark) {
          const height = Number(mark.getAttribute("data-height"));
          if (Number.isFinite(height) && shouldDeferMobileActivation("miner-timeline-block", height)) {
            const content = String(mark.getAttribute("data-tooltip") || "").trim();
            if (content) {
              showPeriodGridTooltip(content, event.clientX, event.clientY, { constrainToGrid: false });
            }
            return;
          }
          if (Number.isFinite(height)) {
            window.open(`https://mempool.space/block/${height}`, "_blank", "noopener,noreferrer");
          }
          return;
        }

        if (event.target === minerTimelineOverlay) {
          clearMobilePendingActivation();
          closeMinerTimelineOverlay();
        }
      });

      minerTimelineOverlay?.addEventListener("keydown", (event) => {
        if (event.key === "Escape") {
          closeMinerTimelineOverlay();
          return;
        }

        if (event.key !== "Enter" && event.key !== " ") return;
        const mark = event.target instanceof Element
          ? event.target.closest(".miner-timeline-block, .miner-timeline-latest-block")
          : null;
        if (!mark) return;
        event.preventDefault();
        const height = Number(mark.getAttribute("data-height"));
        if (Number.isFinite(height)) {
          window.open(`https://mempool.space/block/${height}`, "_blank", "noopener,noreferrer");
        }
      });

      minerTimelineClose?.addEventListener("click", () => {
        closeMinerTimelineOverlay();
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
        restoreBip110OverlaySelections();
        if (!restoredPersistedControls) {
          applyNarrowWindowDefaults();

          state.controls.showSegwit = false;
          state.controls.showBip110 = true;
          state.controls.showLegacyNode = true;
          state.controls.showBip110Node = false;
          state.filledPanels.segwit = true;
          state.filledPanels.bip110 = true;
          state.filledPanels.bip110Node = true;
          state.manualPanelHeights.segwit = null;
          state.manualPanelHeightRatios.segwit = null;
          state.manualPanelHeights.bip110 = null;
          state.manualPanelHeightRatios.bip110 = null;
          state.manualPanelHeights.bip110Node = null;
          state.manualPanelHeightRatios.bip110Node = null;

          syncPanelCheckboxes();

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
          segwitMiners: {},
          segwitLowActivityBlocks: {},
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
          bip110SignalMiners: {},
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
        updateFillButtonState("bip110Node");
        setupPanelResizeHandles();
        updatePanelVisibility();
        attachPointer(segwitCanvas, "segwit");
        attachPointer(bip110Canvas, "bip110");
        attachPointer(bip110NodeCanvas, "bip110Node");
        updateResetButtonUi();
        setupRefreshWakeEvents();
        startAutoRefresh();
        await renderSelectedPanelsWithSharedLoader(PANEL_KEYS, { enhanced: false, scheduleEnhancements: true });
        // Keep controls responsive while block marker data finishes loading in the background.
        setControlsEnabled(true);
        updateResetButtonUi();
        if (loadToken !== state.phasedLoadToken) return;

        await loadAndApplyBlockDataPhased(loadToken, state.data.metadata, ["segwit", "bip110", "bip110Node"]);
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
            if (isPeriodGridOverlayOpen()) {
              closePeriodGridOverlay();
              return;
            }
            state.pinnedTooltip = null;
            hideTooltip();
          }
        });

        window.addEventListener("storage", (ev) => {
          if (ev.key === BIP110_OVERLAY_SELECTIONS_STORAGE_KEY) {
            refreshBip110OverlaySelectionsFromStorage();
            return;
          }
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
