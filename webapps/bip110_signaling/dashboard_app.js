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
    const PANEL_VIEWPORT_FILL_SAFETY_PX = 2;
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
        if (anchor instanceof Element && anchor.closest(".miner-timeline-chain-split-cube")) {
          return true;
        }
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
      minerTimelineShowChainView: true,
      chainSplitScrollAdjustment: null,
      chainSplitHandlingScroll: false,
      chainSplitFollowLatest: true,
      chainSplitPendingScrollRender: false,
      chainSplitAgeTimer: null,
      chainSplitDrag: null,
      chainSplitSuppressClickUntil: 0,
      minerTimelineChainSplitScrollAdjustment: null,
      minerTimelineChainSplitHandlingScroll: false,
      minerTimelineChainSplitFollowLatest: true,
      minerTimelineChainSplitRenderFrame: null,
      minerTimelineChainSplitPendingScrollRender: false,
      minerTimelineChainSplitDrag: null,
      minerTimelineChainSplitSuppressClickUntil: 0,
      mainChainSplitScrollAdjustment: null,
      mainChainSplitHandlingScroll: false,
      mainChainSplitFollowLatest: true,
      mainChainSplitRenderFrame: null,
      mainChainSplitPendingScrollRender: false,
      mainChainSplitDrag: null,
      mainChainSplitSuppressClickUntil: 0,
      mainChainSplitDataReady: false,
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
        showMainChainView: false,
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
    const mainChainSplitPanel = document.getElementById("mainChainSplitPanel");
    const mainChainSplitWrap = document.getElementById("mainChainSplitWrap");
    const mainChainSplit = document.getElementById("mainChainSplit");
    const mainChainSplitPeriodBack = document.getElementById("mainChainSplitPeriodBack");
    const mainChainSplitSnapLatest = document.getElementById("mainChainSplitSnapLatest");
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
    const chainSplitBtn = document.getElementById("chainSplitBtn");
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
    const minerTimelineChainSplitWrap = document.getElementById("minerTimelineChainSplitWrap");
    const minerTimelineChainSplit = document.getElementById("minerTimelineChainSplit");
    const minerTimelineChainSplitPeriodBack = document.getElementById("minerTimelineChainSplitPeriodBack");
    const minerTimelineChainSplitSnapLatest = document.getElementById("minerTimelineChainSplitSnapLatest");
    const minerTimelineRangeValue = document.getElementById("minerTimelineRangeValue");
    const minerTimelineSignalValue = document.getElementById("minerTimelineSignalValue");
    const minerTimelineNodeButtons = Array.from(document.querySelectorAll("[data-miner-timeline-node]"));
    const minerTimelineWindowButtons = Array.from(document.querySelectorAll("[data-miner-timeline-window]"));
    const minerTimelineMinerButtons = Array.from(document.querySelectorAll("[data-miner-timeline-miners]"));
    const minerTimelineOrderButtons = Array.from(document.querySelectorAll("[data-miner-timeline-order]"));
    const minerTimelineSignalersFirst = document.getElementById("minerTimelineSignalersFirst");
    const minerTimelineShowChainView = document.getElementById("minerTimelineShowChainView");
    const chainSplitOverlay = document.getElementById("chainSplitOverlay");
    const chainSplitDialog = document.getElementById("chainSplitDialog");
    const chainSplitClose = document.getElementById("chainSplitClose");
    const chainSplitContent = document.getElementById("chainSplitContent");
    const chainSplitPeriodBack = document.getElementById("chainSplitPeriodBack");
    const chainSplitSnapLatest = document.getElementById("chainSplitSnapLatest");
    const chainSplitLegacyHeightValue = document.getElementById("chainSplitLegacyHeightValue");
    const chainSplitBip110HeightValue = document.getElementById("chainSplitBip110HeightValue");
    const chainSplitStatusValue = document.getElementById("chainSplitStatusValue");
    const vizInfoBtn = document.getElementById("vizInfoBtn");
    const segwitResizeHandle = document.getElementById("segwitResizeHandle");
    const bip110ResizeHandle = document.getElementById("bip110ResizeHandle");
    const bip110NodeResizeHandle = document.getElementById("bip110NodeResizeHandle");
    const segwitFillHeightBtn = document.getElementById("segwitFillHeightBtn");
    const bip110FillHeightBtn = document.getElementById("bip110FillHeightBtn");
    const bip110NodeFillHeightBtn = document.getElementById("bip110NodeFillHeightBtn");
    const swapPanelsBtn = document.getElementById("swapPanelsBtn");
    const mainChainViewToggle = document.getElementById("toggleMainChainView");
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
        mainChainSplitPeriodBack,
        mainChainSplitSnapLatest,
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
        chainSplitBtn,
        swapPanelsBtn,
        segwitFillHeightBtn,
        bip110FillHeightBtn,
        bip110NodeFillHeightBtn,
        mainChainSplitPeriodBack,
        mainChainSplitSnapLatest,
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

    function nodeViewForPanelKey(key) {
      return key === "bip110Node" ? "bip110" : "legacy";
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

    function getVisibleBip110PanelKeysFromDom() {
      return BIP110_PANEL_KEYS.filter((key) => {
        const panel = getPanelElement(key);
        return panel && !panel.classList.contains("hidden");
      });
    }

    function getVisiblePanelKeys() {
      const keys = [];
      if (state.controls.showSegwit) keys.push("segwit");
      keys.push(...getVisibleBip110PanelKeys());
      return keys;
    }

    function isMainChainPanelVisible() {
      return Boolean(state.controls.showMainChainView && state.mainChainSplitDataReady);
    }

    function syncMainChainPanelVisibility() {
      if (mainChainSplitPanel) {
        mainChainSplitPanel.classList.toggle("hidden", !isMainChainPanelVisible());
      }
      if (mainChainViewToggle) {
        mainChainViewToggle.checked = Boolean(state.controls.showMainChainView);
      }
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
      if (mainChainViewToggle) {
        mainChainViewToggle.checked = Boolean(state.controls.showMainChainView);
        mainChainViewToggle.disabled = !state.controlsEnabled;
      }
      syncMainChainPanelVisibility();
      syncNodePanelButtons();
    }

    function getMainWrapViewportHeight() {
      return Math.floor(mainWrap?.clientHeight || window.innerHeight || 0);
    }

    function getMainChainPanelHeightBudget(gap = 0) {
      if (!isMainChainPanelVisible() || !mainChainSplitPanel || mainChainSplitPanel.classList.contains("hidden")) {
        return 0;
      }
      const rectHeight = mainChainSplitPanel.getBoundingClientRect().height;
      const measuredHeight = Number.isFinite(rectHeight) && rectHeight > 0 ? rectHeight : 190;
      return measuredHeight + (Number(gap) || 0);
    }

    function getSinglePanelAvailableHeight() {
      const wrapStyle = getComputedStyle(mainWrap);
      const padTop = parseFloat(wrapStyle.paddingTop) || 0;
      const padBottom = parseFloat(wrapStyle.paddingBottom) || 0;
      const gap = parseFloat(wrapStyle.rowGap || wrapStyle.gap) || 0;
      const topbarH = topbar.getBoundingClientRect().height;
      const chainPanelH = getMainChainPanelHeightBudget(gap);
      const available = getMainWrapViewportHeight()
        - topbarH
        - padTop
        - padBottom
        - gap
        - chainPanelH
        - PANEL_VIEWPORT_FILL_SAFETY_PX;
      return Math.max(PANEL_RESIZE_MIN_HEIGHT, Math.floor(available));
    }

    function getDashboardLoaderHeight() {
      return getSinglePanelAvailableHeight();
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
        const chainSplitWasFollowingLatest = isChainSplitOverlayOpen()
          && (state.chainSplitFollowLatest === true || isChainSplitAtLatest(1));
        const latestSig = await fetchLatestBip110MetadataSignature();
        if (!latestSig || latestSig === state.dataSignature) {
          return;
        }

        setControlsEnabled(false);
        const loadBuster = Date.now();
        const loadToken = ++state.phasedLoadToken;
        let dashboardLoaderShown = false;
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
        if (hasVisibleSelectedPanel(BIP110_PANEL_KEYS) || isMainChainPanelVisible()) {
          dashboardLoaderShown = true;
          setDashboardLoaderVisible(true);
          await nextPaint();
        }

        await loadAndApplyBlockDataPhased(loadToken, state.data.metadata, ["bip110", "bip110Node"], loadBuster, { renderAfterEach: false });
        if (loadToken !== state.phasedLoadToken) return;
        setStatus(state.data);
        refreshOpenOverlays({
          followDefaultPeriodGrid: periodGridWasFollowingDefault,
          followLatestChainSplit: chainSplitWasFollowingLatest,
        });
      } catch (err) {
        console.warn("Auto-refresh check failed:", err);
      } finally {
        state.refreshInFlight = false;
        if (dashboardLoaderShown) {
          setDashboardLoaderVisible(false);
        }
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
          showMainChainView: Boolean(state.controls.showMainChainView),
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
          minerTimelineShowChainView: state.minerTimelineShowChainView !== false,
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
        state.minerTimelineShowChainView = typeof parsed.minerTimelineShowChainView === "boolean"
          ? parsed.minerTimelineShowChainView
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
        state.controls.showMainChainView = typeof parsed.showMainChainView === "boolean" ? parsed.showMainChainView : false;

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
        const controlKeys = ["stripes", "stripesExplicit", "blockSymbol", "markers", "labels", "showSegwit", "showBip110", "showLegacyNode", "showBip110Node", "panelsSwapped", "showMainChainView"];
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
          showMainChainView: false,
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
          showMainChainView: Boolean(state.controls.showMainChainView),
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
        if (typeof controls.showMainChainView === "boolean") state.controls.showMainChainView = controls.showMainChainView;
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
          toggleMainChainView: Boolean(mainChainViewToggle?.checked ?? state.controls.showMainChainView),
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
        state.controls.showMainChainView = typeof checkboxState.toggleMainChainView === "boolean"
          ? checkboxState.toggleMainChainView
          : Boolean(controls.showMainChainView);

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
        state.controls.showMainChainView = false;
        state.periodGridNodeView = "legacy";
        state.leaderboardWindow = "all";
        state.minerTimelineWindow = "past14d";
        state.minerTimelineNodeView = "legacy";
        state.minerTimelineMiners = "all";
        state.minerTimelineOrder = "recent";
        state.minerTimelineSignalersFirst = true;
        state.minerTimelineShowChainView = true;

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
      if (state.controls.showMainChainView) return false;
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
      const previousBip110PanelKeys = hasPriorVisibility ? getVisibleBip110PanelKeysFromDom() : [];
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
      syncMainChainPanelVisibility();

      const visibleCount = getVisiblePanelKeys().length;
      const visibleBip110PanelKeys = getVisibleBip110PanelKeys();
      if (hasPriorVisibility && previousBip110PanelKeys.length !== visibleBip110PanelKeys.length) {
        if (previousBip110PanelKeys.length === 1 && visibleBip110PanelKeys.length === 2) {
          const splitHeight = getEqualSplitPanelHeight(2);
          visibleBip110PanelKeys.forEach((key) => {
            setManualPanelHeight(key, splitHeight);
            state.filledPanels[key] = false;
            updateFillButtonState(key);
          });
        } else if (previousBip110PanelKeys.length === 2 && visibleBip110PanelKeys.length === 1) {
          const [key] = visibleBip110PanelKeys;
          clearManualPanelHeight(key);
          state.filledPanels[key] = true;
          updateFillButtonState(key);
        }
      }
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

      const orderedPanels = orderedKeys.map(getPanelElement).filter(Boolean);
      if (mainChainSplitPanel) {
        const chainBefore = dashboardLoader?.parentElement === mainWrap
          ? dashboardLoader
          : orderedPanels[0] || null;
        if (chainBefore) {
          mainWrap.insertBefore(mainChainSplitPanel, chainBefore);
        } else {
          mainWrap.appendChild(mainChainSplitPanel);
        }
      }
      if (dashboardLoader) {
        const loaderBefore = orderedPanels[0] || null;
        if (loaderBefore) {
          mainWrap.insertBefore(dashboardLoader, loaderBefore);
        } else {
          mainWrap.appendChild(dashboardLoader);
        }
      }
      orderedPanels.forEach((panel) => {
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

    function clearManualPanelHeight(key) {
      state.manualPanelHeights[key] = null;
      state.manualPanelHeightRatios[key] = null;
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
      return clampPanelResizeHeight(getSinglePanelAvailableHeight());
    }

    function getHalfPanelHeight() {
      const wrapStyle = getComputedStyle(mainWrap);
      const padTop = parseFloat(wrapStyle.paddingTop) || 0;
      const padBottom = parseFloat(wrapStyle.paddingBottom) || 0;
      const gap = parseFloat(wrapStyle.rowGap || wrapStyle.gap) || 0;
      const topbarH = topbar.getBoundingClientRect().height;
      const chainPanelH = getMainChainPanelHeightBudget(gap);
      const availableForPanels = getMainWrapViewportHeight()
        - topbarH
        - padTop
        - padBottom
        - chainPanelH
        - gap * 2
        - PANEL_VIEWPORT_FILL_SAFETY_PX;
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
      const topbarH = topbar.getBoundingClientRect().height;
      const gapsOutsidePanels = gap * count;
      const chainPanelH = getMainChainPanelHeightBudget(gap);
      const availableForPanels = getMainWrapViewportHeight()
        - topbarH
        - padTop
        - padBottom
        - gapsOutsidePanels
        - chainPanelH
        - PANEL_VIEWPORT_FILL_SAFETY_PX;
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

    function togglePanelFillMode(key) {
      if (state.filledPanels[key]) compactSinglePanel(key);
      else fillSinglePanelToViewportHeight(key);
    }

    function bindPanelFillButton(btn, key) {
      if (!btn) return;
      let lastTouchActivation = 0;
      const activate = (event, fromTouch = false) => {
        event?.stopPropagation?.();
        if (event?.cancelable) event.preventDefault();
        if (fromTouch) {
          const now = Date.now();
          if (now - lastTouchActivation < 180) return;
          lastTouchActivation = now;
        }
        hideTooltip();
        hideCustomTooltip();
        clearMobilePendingActivation();
        togglePanelFillMode(key);
      };

      btn.addEventListener("pointerdown", (event) => {
        event.stopPropagation();
      });
      btn.addEventListener("touchstart", (event) => {
        event.stopPropagation();
      }, { passive: true });
      btn.addEventListener("touchend", (event) => {
        activate(event, true);
      }, { passive: false });
      btn.addEventListener("pointerup", (event) => {
        if (event.pointerType === "touch" || event.pointerType === "pen") {
          activate(event, true);
        }
      });
      btn.addEventListener("click", (event) => {
        if (Date.now() - lastTouchActivation < 700) {
          event.stopPropagation();
          if (event.cancelable) event.preventDefault();
          return;
        }
        activate(event, false);
      });
    }

    function setupPanelFillButtons() {
      bindPanelFillButton(segwitFillHeightBtn, "segwit");
      bindPanelFillButton(bip110FillHeightBtn, "bip110");
      bindPanelFillButton(bip110NodeFillHeightBtn, "bip110Node");
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
        lines.push(`Miner: ${miner.name || "Loading"}`);
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

    function getNonOverlappingTooltipPosition(tipW, tipH, avoidRect, bounds, gap = 12) {
      if (!avoidRect || !bounds || !Number.isFinite(tipW) || !Number.isFinite(tipH)) return null;
      const edgePad = 10;
      const centerX = avoidRect.left + avoidRect.width / 2;
      const centerY = avoidRect.top + avoidRect.height / 2;
      const candidates = [
        { left: avoidRect.right + gap, top: centerY - tipH / 2 },
        { left: avoidRect.left - tipW - gap, top: centerY - tipH / 2 },
        { left: centerX - tipW / 2, top: avoidRect.top - tipH - gap },
        { left: centerX - tipW / 2, top: avoidRect.bottom + gap },
      ].map((candidate) => ({
        left: clamp(candidate.left, bounds.left + edgePad, bounds.right - tipW - edgePad),
        top: clamp(candidate.top, bounds.top + edgePad, bounds.bottom - tipH - edgePad),
      }));
      const overlaps = (candidate) => (
        candidate.left < avoidRect.right + gap
        && candidate.left + tipW > avoidRect.left - gap
        && candidate.top < avoidRect.bottom + gap
        && candidate.top + tipH > avoidRect.top - gap
      );
      return candidates.find((candidate) => !overlaps(candidate)) || candidates[2] || null;
    }

    function showPeriodGridTooltip(content, clientX, clientY, options = {}) {
      if (!periodGridTooltip || (!isPeriodGridOverlayOpen() && !isMinerTimelineOverlayOpen() && !isChainSplitOverlayOpen())) return;
      const normalizedContent = String(content || "");
      if (activePeriodGridTooltipContent !== normalizedContent) {
        periodGridTooltip.innerHTML = renderTooltipHtml(normalizedContent);
        activePeriodGridTooltipContent = normalizedContent;
      }
      periodGridTooltip.classList.toggle("is-compact", !!options.compact);
      const activeContent = isChainSplitOverlayOpen()
        ? chainSplitContent
        : isMinerTimelineOverlayOpen()
          ? minerTimelineContent
          : periodGridContent;
      const activeDialog = isChainSplitOverlayOpen()
        ? chainSplitDialog
        : isMinerTimelineOverlayOpen()
          ? minerTimelineDialog
          : periodGridDialog;
      const activeOverlay = isChainSplitOverlayOpen()
        ? chainSplitOverlay
        : isMinerTimelineOverlayOpen()
          ? minerTimelineOverlay
          : periodGridOverlay;
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
      const avoidPosition = getNonOverlappingTooltipPosition(tipW, tipH, options.avoidRect, bounds, 12);
      if (avoidPosition) {
        periodGridTooltip.style.left = `${avoidPosition.left}px`;
        periodGridTooltip.style.top = `${avoidPosition.top}px`;
        periodGridTooltip.style.transform = "none";
        periodGridTooltip.classList.add("show");
        return;
      }
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

    function isChainSplitOverlayOpen() {
      return Boolean(chainSplitOverlay?.classList.contains("show"));
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
        cellEl.dataset.nodeView = datasetKey === "bip110" ? normalizeBip110NodeView(state.periodGridNodeView) : "legacy";
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
      closeChainSplitOverlay();
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

    function shouldShowMinerTimelineChainView() {
      const isMobile = window.matchMedia?.("(max-width: 750px)")?.matches === true;
      return state.minerTimelineShowChainView !== false && !isMobile;
    }

    function syncMinerTimelineChainViewControls() {
      if (minerTimelineShowChainView) {
        minerTimelineShowChainView.checked = state.minerTimelineShowChainView !== false;
      }
      const visible = shouldShowMinerTimelineChainView();
      if (minerTimelineChainSplitWrap) {
        minerTimelineChainSplitWrap.hidden = !visible;
      }
      return visible;
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
      syncMinerTimelineChainViewControls();
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
        renderMinerTimelineMiniChainSplit();
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
          ? "Loading"
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
          latestMark.dataset.nodeView = normalizeBip110NodeView(state.minerTimelineNodeView);
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
          mark.dataset.nodeView = normalizeBip110NodeView(state.minerTimelineNodeView);
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
      renderMinerTimelineMiniChainSplit();
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
      state.minerTimelineChainSplitDrag = null;
      state.minerTimelineChainSplitRenderFrame = null;
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
      closeChainSplitOverlay();
      state.pinnedTooltip = null;
      clearMobilePendingActivation();
      hideTooltip();
      hideCustomTooltip();
      hidePeriodGridTooltip();
      state.minerTimelineChainSplitFollowLatest = true;
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

    function closeChainSplitOverlay() {
      if (!chainSplitOverlay) return;
      clearMobilePendingActivation();
      stopChainSplitAgeTimer();
      chainSplitOverlay.classList.remove("show");
      chainSplitOverlay.classList.remove("is-loading");
      chainSplitOverlay.setAttribute("aria-hidden", "true");
      hidePeriodGridTooltip();
    }

    function getChainSplitSyncMeta() {
      const sync = state.data?.metadata?.node_sync || state.dynamicData?.metadata?.node_sync;
      return sync && typeof sync === "object" ? sync : null;
    }

    function getBlockMapByHeight(blocks) {
      const map = new Map();
      (Array.isArray(blocks) ? blocks : []).forEach((block) => {
        const height = Number(block?.height);
        if (Number.isFinite(height)) map.set(height, block);
      });
      return map;
    }

    function getLatestBlockHeight(blocks) {
      const heights = (Array.isArray(blocks) ? blocks : [])
        .map((block) => Number(block?.height))
        .filter((height) => Number.isFinite(height));
      return heights.length ? Math.max(...heights) : null;
    }

    function getMinBlockHeight(blocks) {
      const heights = (Array.isArray(blocks) ? blocks : [])
        .map((block) => Number(block?.height))
        .filter((height) => Number.isFinite(height));
      return heights.length ? Math.min(...heights) : null;
    }

    function getChainSplitBranchBlocks(blockMap, startHeight, endHeight, limit) {
      const start = Number(startHeight);
      const end = Number(endHeight);
      if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return [];
      const blocks = [];
      for (let height = start; height <= end && blocks.length < limit; height += 1) {
        const block = blockMap.get(height);
        if (block) blocks.push(block);
      }
      return blocks;
    }

    function getLatestChainSplitBranchBlocks(blockMap, startHeight, endHeight, limit) {
      const start = Number(startHeight);
      const end = Number(endHeight);
      const count = Math.max(1, Number(limit) || 1);
      if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return [];
      return getChainSplitBranchBlocks(blockMap, Math.max(start, end - count + 1), end, count);
    }

    function getLatestChainRun(blockMap, tipHeight, limit) {
      const tip = Number(tipHeight);
      if (!Number.isFinite(tip)) return [];
      const start = Math.max(0, tip - limit + 1);
      const blocks = [];
      for (let height = start; height <= tip; height += 1) {
        const block = blockMap.get(height);
        if (block) blocks.push(block);
      }
      return blocks;
    }

    const CHAIN_SPLIT_DETAIL_BUFFER_BLOCKS = 24;
    const CHAIN_SPLIT_PLACEHOLDER_BUFFER_BLOCKS = 12;
    const CHAIN_SPLIT_FIRST_SIGNALING_HEIGHT = 927360;

    function hasChainSplitDemoFlag() {
      try {
        if (new URLSearchParams(window.location.search).has("chainSplitDemo")) return true;
      } catch (_) {}
      try {
        if (window.parent && window.parent !== window && new URLSearchParams(window.parent.location.search).has("chainSplitDemo")) return true;
      } catch (_) {}
      return false;
    }

    function getFirstBip110PeriodStartHeight(nodeView = "legacy") {
      const periods = getBip110PeriodsForNodeView(nodeView);
      const starts = (Array.isArray(periods) ? periods : [])
        .map((row) => Number(row?.period_start_height))
        .filter((height) => Number.isFinite(height));
      if (starts.length) return Math.max(CHAIN_SPLIT_FIRST_SIGNALING_HEIGHT, Math.min(...starts));
      return CHAIN_SPLIT_FIRST_SIGNALING_HEIGHT;
    }

    function updateChainSplitSnapLatestButton() {
      if (!chainSplitSnapLatest) return;
      const show = !isChainSplitAtLatest(0.5);
      chainSplitSnapLatest.hidden = !show;
    }

    function isChainSplitAtLatest(tolerance = 0.5) {
      if (!chainSplitContent) return true;
      const scrollLeft = Number(chainSplitContent.scrollLeft || 0);
      const latestScrollLeft = getChainSplitLatestScrollLeft();
      return Math.abs(scrollLeft - latestScrollLeft) <= tolerance;
    }

    function clampChainSplitScrollToLatest() {
      if (!chainSplitContent) return false;
      const latestScrollLeft = getChainSplitLatestScrollLeft();
      const currentScrollLeft = Number(chainSplitContent.scrollLeft || 0);
      if (!Number.isFinite(latestScrollLeft) || currentScrollLeft <= latestScrollLeft + 0.5) return false;
      state.chainSplitHandlingScroll = true;
      chainSplitContent.scrollLeft = latestScrollLeft;
      requestAnimationFrame(() => {
        finishChainSplitHandlingScroll();
      });
      return true;
    }

    function getChainSplitPreviousPeriodBoundary() {
      if (!chainSplitContent) return null;
      const model = getChainSplitModel();
      if (model.splitDetected || !Number.isFinite(model.rangeStart) || !Number.isFinite(model.rangeEnd)) return null;
      const metrics = getChainSplitLayoutMetrics();
      const periods = getBip110PeriodsForNodeView(model.straightNodeView);
      const starts = (Array.isArray(periods) ? periods : [])
        .map((period) => Number(period?.period_start_height))
        .filter((height) => Number.isFinite(height) && height >= model.rangeStart && height <= model.rangeEnd)
        .sort((a, b) => a - b);
      if (!starts.length) return null;
      const currentApproxHeight = model.rangeStart + Math.floor(Math.max(0, chainSplitContent.scrollLeft - metrics.startX) / metrics.gap);
      const targetHeight = starts.filter((height) => height < currentApproxHeight - 1).pop()
        || starts.filter((height) => height <= currentApproxHeight + 1).pop()
        || null;
      if (!Number.isFinite(targetHeight)) return null;
      const boundaryIndex = targetHeight - model.rangeStart;
      const emptyGap = Math.max(0, metrics.gap - getChainSplitSideDepth(metrics.cubeDepth) - metrics.cubeSize);
      const boundaryX = metrics.startX + boundaryIndex * metrics.gap - (emptyGap / 2);
      const viewportWidth = Number(chainSplitContent.clientWidth || 0);
      const localPad = Math.max(metrics.startX, metrics.gap);
      const periodStartX = metrics.startX + boundaryIndex * metrics.gap;
      const mobileInset = Math.max(10, Math.round(viewportWidth * 0.04));
      // Virtual render x is globalX - scrollLeft, so this puts the first period cube at the inset.
      const targetScrollLeft = Number.isFinite(viewportWidth) && viewportWidth < 760
        ? periodStartX - mobileInset
        : boundaryX;
      return {
        height: targetHeight,
        scrollLeft: clamp(targetScrollLeft, 0, Math.max(0, chainSplitContent.scrollWidth - chainSplitContent.clientWidth)),
      };
    }

    function updateChainSplitPeriodBackButton() {
      if (!chainSplitPeriodBack) return;
      chainSplitPeriodBack.hidden = !getChainSplitPreviousPeriodBoundary();
    }

    function updateChainSplitScrollButtons() {
      updateChainSplitSnapLatestButton();
      updateChainSplitPeriodBackButton();
    }

    function getChainSplitCurrentRightPad(cubeSize, cubeDepth, gap, options = {}) {
      const viewportWidth = Number(chainSplitContent?.clientWidth || window.innerWidth || 0);
      const cubeRightEdge = getChainSplitSideDepth(cubeDepth) + Number(cubeSize || 0);
      const spacing = Number(gap || 0);
      const desktopPad = cubeRightEdge + spacing * (options.split ? 2 : 1);
      if (!Number.isFinite(viewportWidth) || viewportWidth >= 760) return desktopPad;
      return cubeRightEdge + clamp(viewportWidth * 0.2, 30, 50);
    }

    function getChainSplitLatestScrollLeft() {
      if (!chainSplitContent) return 0;
      const currentTipX = Number(chainSplitContent.dataset.currentTipX);
      const currentRightPad = Number(chainSplitContent.dataset.currentRightPad);
      const currentTipLocalPad = Number(chainSplitContent.dataset.currentTipLocalPad || 0);
      const maxScrollLeft = Math.max(0, chainSplitContent.scrollWidth - chainSplitContent.clientWidth);
      if (!Number.isFinite(currentTipX) || !Number.isFinite(currentRightPad)) return maxScrollLeft;
      const localPad = Number.isFinite(currentTipLocalPad) ? currentTipLocalPad : 0;
      const isVirtualScrollSpace = chainSplitContent.dataset.virtualScrollSpace === "1";
      const target = currentTipX
        + (isVirtualScrollSpace ? 0 : localPad)
        - (chainSplitContent.clientWidth - currentRightPad);
      return clamp(target, 0, maxScrollLeft);
    }

    function isChainSplitDetected(sync) {
      if (!sync || sync.in_sync === true) return false;
      const legacyHeight = Number(sync.legacy_height);
      const bip110Height = Number(sync.bip110_height);
      const latestCommonHeight = Number(sync.latest_common_height);
      const legacyHash = String(sync.legacy_hash || "");
      const bip110HashAtLegacyHeight = String(sync.bip110_hash_at_legacy_height || "");
      if (!Number.isFinite(legacyHeight) || !Number.isFinite(bip110Height) || !Number.isFinite(latestCommonHeight)) {
        return false;
      }
      if (latestCommonHeight >= Math.min(legacyHeight, bip110Height)) return false;
      if (legacyHash && bip110HashAtLegacyHeight && legacyHash !== bip110HashAtLegacyHeight) return true;
      return String(sync.relation || "").toLowerCase().includes("split")
        || String(sync.relation || "").toLowerCase().includes("mismatch");
    }

    function shouldUseBip110BlockExplorer(height, nodeView = "legacy") {
      const h = Number(height);
      if (!Number.isFinite(h) || normalizeBip110NodeView(nodeView) !== "bip110") return false;

      if (hasChainSplitDemoFlag()) {
        const legacyTip = getLatestBlockHeight(state.data?.bip110Blocks || state.dynamicData?.bip110Blocks || []);
        const bip110Tip = getLatestBlockHeight(state.data?.bip110NodeBlocks || state.dynamicData?.bip110NodeBlocks || []);
        const common = Math.max(
          Number.isFinite(legacyTip) ? legacyTip : -Infinity,
          Number.isFinite(bip110Tip) ? bip110Tip : -Infinity
        );
        return Number.isFinite(common) && h > common;
      }

      const sync = getChainSplitSyncMeta();
      if (!isChainSplitDetected(sync)) return false;
      const common = Number(sync.latest_common_height);
      return Number.isFinite(common) && h > common;
    }

    function getBlockExplorerUrl(height, nodeView = "legacy") {
      const h = Number(height);
      if (!Number.isFinite(h)) return "";
      const baseUrl = shouldUseBip110BlockExplorer(h, nodeView)
        ? "https://mempool.guide"
        : "https://mempool.space";
      return `${baseUrl}/block/${h}`;
    }

    function openBlockExplorer(height, nodeView = "legacy") {
      const url = getBlockExplorerUrl(height, nodeView);
      if (!url) return;
      window.open(url, "_blank", "noopener,noreferrer");
    }

    function getChainSplitDemoBlock(height, options = {}) {
      const h = Number(height);
      const periodSize = Number(state.data?.metadata?.datasets?.bip110?.period_size || state.data?.metadata?.chart?.period_size || 2016);
      const rel = h - CHAIN_SPLIT_FIRST_SIGNALING_HEIGHT;
      return {
        height: h,
        is_signaling: options.signaling ? 1 : 0,
        version: options.signaling ? 0x20000010 : 0x20000000,
        block_time: Math.floor(Date.now() / 1000),
        is_demo: true,
        period: Number.isFinite(periodSize) && periodSize > 0 ? Math.floor(rel / periodSize) + 1 : null,
        y_in_period: Number.isFinite(periodSize) && periodSize > 0 ? ((rel % periodSize) + periodSize) % periodSize : null,
        miner: {
          name: options.minerName,
          slug: options.minerSlug,
          pool: options.pool || "",
          sub_miner: options.subMiner || "",
        },
      };
    }

    function getChainSplitModel() {
      const legacyBlocks = getBip110BlocksForNodeView("legacy");
      const bip110Blocks = getBip110BlocksForNodeView("bip110");
      const legacyMap = getBlockMapByHeight(legacyBlocks);
      const bip110Map = getBlockMapByHeight(bip110Blocks);
      const legacyTip = getLatestBlockHeight(legacyBlocks);
      const bip110Tip = getLatestBlockHeight(bip110Blocks);
      const legacyMin = getMinBlockHeight(legacyBlocks);
      const sync = getChainSplitSyncMeta();
      const splitDetected = isChainSplitDetected(sync);
      const commonHeight = Number(sync?.latest_common_height);

      if (hasChainSplitDemoFlag()) {
        const currentTip = Math.max(
          Number.isFinite(legacyTip) ? legacyTip : -Infinity,
          Number.isFinite(bip110Tip) ? bip110Tip : -Infinity
        );
        const demoHeight = Number.isFinite(currentTip) ? currentTip + 1 : null;
        if (!Number.isFinite(demoHeight)) {
          return {
            splitDetected: false,
            straightMap: legacyMap,
            straightNodeView: "legacy",
            canPageEarlier: false,
            rangeStart: null,
            rangeEnd: null,
          };
        }
        const common = demoHeight - 1;
        const trunkBlocks = getLatestChainRun(legacyMap, common, 12);
        const legacyBranch = [
          getChainSplitDemoBlock(demoHeight, {
            signaling: false,
            minerName: "Foundry USA",
            minerSlug: "foundryusa",
          }),
          getChainSplitDemoBlock(demoHeight + 1, {
            signaling: false,
            minerName: "AntPool",
            minerSlug: "antpool",
          }),
        ];
        const bip110Branch = [getChainSplitDemoBlock(demoHeight, {
          signaling: true,
          minerName: "Roughnecks",
          minerSlug: "ocean",
          pool: "OCEAN",
          subMiner: "Roughnecks",
        })];
        const heights = [...trunkBlocks, ...legacyBranch, ...bip110Branch]
          .map((block) => Number(block.height))
          .filter((height) => Number.isFinite(height));
        return {
          splitDetected: true,
          demoSplit: true,
          legacyHeight: demoHeight + 1,
          bip110Height: demoHeight,
          trunkBlocks,
          legacyBranch,
          bip110Branch,
          canPageEarlier: false,
          rangeStart: heights.length ? Math.min(...heights) : null,
          rangeEnd: heights.length ? Math.max(...heights) : null,
        };
      }

      if (splitDetected && Number.isFinite(commonHeight)) {
        const trunkBlocks = getLatestChainRun(legacyMap, commonHeight, 24);
        const legacyBranch = getLatestChainRun(legacyMap, legacyTip, 72).filter((block) => Number(block?.height) > commonHeight);
        const bip110Branch = getLatestChainRun(bip110Map, bip110Tip, 72).filter((block) => Number(block?.height) > commonHeight);
        const heights = [...trunkBlocks, ...legacyBranch, ...bip110Branch]
          .map((block) => Number(block.height))
          .filter((height) => Number.isFinite(height));
        return {
          splitDetected: true,
          demoSplit: false,
          legacyHeight: legacyTip,
          bip110Height: bip110Tip,
          trunkBlocks,
          legacyBranch,
          bip110Branch,
          canPageEarlier: false,
          rangeStart: heights.length ? Math.min(...heights) : null,
          rangeEnd: heights.length ? Math.max(...heights) : null,
        };
      }

      const straightTip = Number.isFinite(legacyTip) ? legacyTip : bip110Tip;
      const straightMap = Number.isFinite(legacyTip) ? legacyMap : bip110Map;
      const nodeView = Number.isFinite(legacyTip) ? "legacy" : "bip110";
      const straightMin = getFirstBip110PeriodStartHeight(nodeView);
      const fallbackMin = Number.isFinite(legacyTip) ? legacyMin : getMinBlockHeight(bip110Blocks);
      const rawRangeStart = Number.isFinite(straightMin) ? straightMin : fallbackMin;
      const rangeStart = Number.isFinite(rawRangeStart)
        ? Math.max(CHAIN_SPLIT_FIRST_SIGNALING_HEIGHT, rawRangeStart)
        : CHAIN_SPLIT_FIRST_SIGNALING_HEIGHT;
      const rangeEnd = straightTip;
      return {
        splitDetected: false,
        demoSplit: false,
        legacyHeight: legacyTip,
        bip110Height: bip110Tip,
        straightMap,
        straightNodeView: nodeView,
        canPageEarlier: false,
        rangeStart: Number.isFinite(rangeStart) ? rangeStart : null,
        rangeEnd: Number.isFinite(rangeEnd) ? rangeEnd : null,
      };
    }

    function getChainSplitCurrentPeriodSignaling() {
      const currentPeriod = Number(state.data?.metadata?.state?.current_period_index);
      const rows = getBip110PeriodsForNodeView("legacy");
      const row = rows.find((periodRow) => Number(periodRow?.period) === currentPeriod) || null;
      if (!Number.isFinite(currentPeriod) || !row) {
        return {
          label: "Period Signaling",
          labelHtml: "Period Signaling",
          valueHtml: "-",
        };
      }

      const signal = Number(row.signal_blocks || 0);
      const elapsed = Number(row.elapsed_blocks || 0);
      const periodSize = Number(state.data?.metadata?.chart?.period_size || 2016);
      const denominator = Number.isFinite(elapsed) && elapsed > 0 ? elapsed : periodSize;
      const percentText = Number.isFinite(periodSize) && periodSize > 0 ? pctLabel(signal, periodSize) : "0.0%";
      return {
        label: `Period ${currentPeriod.toLocaleString("en-US")} Signaling`,
        labelHtml: `Period <span class="chain-split-period-num">${currentPeriod.toLocaleString("en-US")}</span> Signaling`,
        valueHtml: `<span class="period-grid-signal-num">${signal.toLocaleString("en-US")}</span>/${denominator.toLocaleString("en-US")} (${percentText})`,
      };
    }

    function formatChainSplitHeightKpi(height, referenceHeight) {
      const h = Number(height);
      const ref = Number(referenceHeight);
      if (!Number.isFinite(h)) return "-";
      const delta = Number.isFinite(ref) ? h - ref : 0;
      const sign = delta >= 0 ? "+" : "";
      return `${h.toLocaleString("en-US")} (${sign}${delta.toLocaleString("en-US")})`;
    }

    function getChainSplitRawMiner(block, nodeView = "legacy") {
      const height = Number(block?.height);
      const selectedMap = normalizeBip110NodeView(nodeView) === "bip110"
        ? getBip110MinerMapForNodeView("bip110")
        : getBip110LeaderboardMinerMap();
      const fallbackMap = getBip110LeaderboardMinerMap();
      const map = selectedMap && Object.keys(selectedMap).length ? selectedMap : fallbackMap;
      return block?.miner || (Number.isFinite(height) && map ? map[String(height)] : null);
    }

    function getChainSplitMiner(block, nodeView = "legacy") {
      const rawMiner = getChainSplitRawMiner(block, nodeView);
      const miner = normalizeLeaderboardMiner(rawMiner);
      const label = hasUsableMinerAttribution(rawMiner)
        ? String(miner.name || "").trim() || "Unknown"
        : "Loading";
      const safeSlug = /^[a-z0-9-]+$/.test(String(miner.slug || "")) ? String(miner.slug).toLowerCase() : "";
      return {
        label: label.length > 18 ? `${label.slice(0, 16)}...` : label,
        slug: safeSlug,
        iconSrc: safeSlug && !missingMinerIconSlugs.has(safeSlug)
          ? `assets/mining-pools/${safeSlug}.svg`
          : "assets/mining-pools/default.svg",
      };
    }

    function formatChainSplitTooltip(block, nodeView = "legacy") {
      const rawMiner = getChainSplitRawMiner(block, nodeView);
      const tooltipBlock = hasUsableMinerAttribution(rawMiner)
        ? { ...block, miner: normalizeMinerTooltipData(rawMiner) }
        : block;
      return formatStripeTooltip(tooltipBlock, "bip110");
    }

    function formatChainSplitRelativeTime(blockTime) {
      const timestamp = Number(blockTime);
      if (!Number.isFinite(timestamp) || timestamp <= 0) return "Time loading";
      const deltaMs = Date.now() - (timestamp * 1000);
      const absMs = Math.abs(deltaMs);
      const suffix = deltaMs >= 0 ? "ago" : "from now";
      const minuteMs = 60 * 1000;
      const hourMs = 60 * minuteMs;
      const dayMs = 24 * hourMs;
      if (absMs < minuteMs) return "just now";
      if (absMs < hourMs) {
        const minutes = Math.max(1, Math.round(absMs / minuteMs));
        return `${minutes} minute${minutes === 1 ? "" : "s"} ${suffix}`;
      }
      if (absMs < dayMs) {
        const hours = Math.max(1, Math.round(absMs / hourMs));
        return `${hours} hour${hours === 1 ? "" : "s"} ${suffix}`;
      }
      const days = Math.max(1, Math.round(absMs / dayMs));
      return `${days} day${days === 1 ? "" : "s"} ${suffix}`;
    }

    function updateChainSplitAgeLabels() {
      if (!isChainSplitOverlayOpen() || !chainSplitContent) return;
      chainSplitContent.querySelectorAll(".chain-split-face-text.is-time[data-block-time]").forEach((label) => {
        const blockTime = Number(label.getAttribute("data-block-time"));
        if (!Number.isFinite(blockTime) || blockTime <= 0) return;
        label.textContent = formatChainSplitRelativeTime(blockTime);
      });
    }

    function startChainSplitAgeTimer() {
      if (state.chainSplitAgeTimer) return;
      state.chainSplitAgeTimer = window.setInterval(updateChainSplitAgeLabels, 15000);
    }

    function stopChainSplitAgeTimer() {
      if (!state.chainSplitAgeTimer) return;
      window.clearInterval(state.chainSplitAgeTimer);
      state.chainSplitAgeTimer = null;
    }

    function getChainSplitFaceRows(block) {
      const versionHex = formatBlockVersionHex(block?.version) || "Version loading";
      const mode = Number(block?.is_signaling) === 1 ? "Signaling" : "Non-signaling";
      return {
        version: versionHex,
        mode,
        time: block?.is_demo ? "Demo" : formatChainSplitRelativeTime(block?.block_time),
      };
    }

    function getChainSplitLayoutMetrics() {
      const targetHeight = clamp(window.innerHeight - 220, 500, 760);
      const viewportWidth = Number(chainSplitContent?.clientWidth || window.innerWidth || 0);
      const heightScale = clamp(targetHeight / 690, 0.74, 1.1);
      const widthScale = Number.isFinite(viewportWidth) && viewportWidth < 760
        ? clamp(viewportWidth / 455, 0.78, 1)
        : 1;
      const scale = heightScale * widthScale;
      const scaled = (value) => Math.round(value * scale);
      const cubeSize = scaled(146);
      const cubeDepth = scaled(27);
      const labelOffset = Math.max(13, Math.round(17 * scale));
      const visibleHeight = Number(chainSplitContent?.clientHeight || 0);
      const bottomGutter = Math.max(18, Math.round(28 * scale));
      const straightHeight = Number.isFinite(visibleHeight) && visibleHeight > 0
        ? Math.max(scaled(490), Math.max(1, Math.round(visibleHeight - bottomGutter)))
        : scaled(490);
      const centeringHeight = Number.isFinite(visibleHeight) && visibleHeight > 0
        ? visibleHeight
        : straightHeight;
      const straightY = Math.max(labelOffset + 2, Math.round((centeringHeight / 2) - cubeDepth - (cubeSize / 2)));
      return {
        scale,
        cubeSize,
        cubeDepth,
        labelOffset,
        bottomGutter,
        gap: scaled(200),
        startX: Math.max(42, scaled(56)),
        reservedHeight: scaled(690),
        straightHeight,
        straightY,
        splitY: straightY,
        bip110Y: straightY - scaled(130),
        legacyY: straightY + scaled(130),
      };
    }

    function getChainSplitPeriodBoundaryLabel(period) {
      const p = Number(period);
      if (p === 18) return "Mandatory Signaling Period";
      if (p === 19) return "Latest Lock-In Period";
      if (p === 20) return "Latest Activation Period";
      return Number.isFinite(p) ? `Period ${p.toLocaleString("en-US")}` : "Period";
    }

    function renderChainSplitPeriodMarkers(positions, options = {}) {
      if (!Array.isArray(positions) || positions.length < 2) return "";
      const yTop = Number(options.yTop);
      const yBottom = Number(options.yBottom);
      const labelOffset = Number(options.labelOffset || 12);
      const cubeSize = Number(options.cubeSize || 0);
      const cubeDepth = Number(options.cubeDepth || 0);
      if (!Number.isFinite(yTop) || !Number.isFinite(yBottom)) return "";
      return positions
        .slice(1)
        .map((position, index) => {
          const previous = positions[index];
          const previousPeriod = Number(previous?.block?.period);
          const nextPeriod = Number(position?.block?.period);
          if (!Number.isFinite(previousPeriod) || !Number.isFinite(nextPeriod) || previousPeriod === nextPeriod) {
            return "";
          }
          const previousX = Number(previous.x);
          const nextX = Number(position.x);
          const emptyGap = Math.max(0, nextX - previousX - getChainSplitSideDepth(cubeDepth) - cubeSize);
          const x = Math.round(nextX - (emptyGap / 2));
          if (!Number.isFinite(x)) return "";
          const label = getChainSplitPeriodBoundaryLabel(nextPeriod);
          return `
            <g class="chain-split-period-boundary-group">
              <line class="chain-split-period-boundary" x1="${x}" y1="${yTop}" x2="${x}" y2="${yBottom}"></line>
              <text class="chain-split-period-boundary-label" x="${x + labelOffset}" y="${yTop + labelOffset}" transform="rotate(90 ${x + labelOffset} ${yTop + labelOffset})">${escapeHtml(label)}</text>
            </g>
          `;
        })
        .join("");
    }

    function fitChainSplitFontSize(text, preferredSize, minSize, maxWidth, ratio = 0.68) {
      const length = Math.max(1, String(text || "").length);
      const width = Number(maxWidth);
      const preferred = Number(preferredSize);
      const minimum = Number(minSize);
      if (!Number.isFinite(width) || width <= 0 || !Number.isFinite(preferred)) {
        return Math.max(Number.isFinite(minimum) ? minimum : 1, preferred || 1);
      }
      const fitSize = Math.floor(width / (length * ratio));
      return Math.max(Number.isFinite(minimum) ? minimum : 1, Math.min(preferred, fitSize));
    }

    function getChainSplitSideDepth(depth) {
      const numericDepth = Number(depth);
      if (!Number.isFinite(numericDepth) || numericDepth <= 0) return 0;
      return Math.round(numericDepth * 1.28);
    }

    function renderChainSplitCube(block, x, y, options = {}) {
      const height = Number(block?.height);
      const size = options.size || 154;
      const depth = options.depth || 28;
      const sideDepth = getChainSplitSideDepth(depth);
      const nodeView = normalizeBip110NodeView(options.nodeView || "legacy");
      const frontX = x + sideDepth;
      const frontY = y + depth;
      const labelX = x + size / 2;
      const scale = Number(options.scale || 1);
      const faceRows = getChainSplitFaceRows(block);
      const blockTime = Number(block?.block_time);
      const timeAttrs = !block?.is_demo && Number.isFinite(blockTime) && blockTime > 0
        ? ` data-block-time="${blockTime}"`
        : "";
      const miner = getChainSplitMiner(block, options.nodeView || "legacy");
      const faceMaxWidth = size * 0.72;
      const heightFontSize = fitChainSplitFontSize(
        Number.isFinite(height) ? height.toLocaleString("en-US") : "",
        Math.round(13 * scale),
        10,
        size * 0.96,
        0.62
      );
      const faceVersionFontSize = fitChainSplitFontSize(faceRows.version, Math.round(13 * scale), 9, faceMaxWidth, 0.72);
      const faceModeFontSize = fitChainSplitFontSize(faceRows.mode, Math.round(13 * scale), 9, faceMaxWidth, 0.68);
      const faceTimeFontSize = fitChainSplitFontSize(faceRows.time, Math.round(12 * scale), 8, faceMaxWidth, 0.68);
      const minerFontSize = fitChainSplitFontSize(miner?.label || "", Math.round(11.5 * scale), 8, size * 0.76, 0.62);
      const minerIconSize = Math.max(9, Math.round(13 * scale));
      const minerGap = Math.max(6, Math.round(8 * scale));
      const labelOffset = Number(options.labelOffset) || Math.max(13, Math.round(17 * scale));
      const labelY = y - labelOffset;
      const minerY = frontY + size + labelOffset;
      const classes = Number(block?.is_signaling) === 1
        ? "chain-split-cube is-signaling"
        : "chain-split-cube is-nonsignaling";
      const minerLabelWidth = Math.min(size * 0.72, Math.max(28, miner.label.length * minerFontSize * 0.7));
      const minerGroupCenterX = frontX + size / 2;
      const minerStartX = minerGroupCenterX - ((minerIconSize + minerGap + minerLabelWidth) / 2);
      const faceTextX = frontX + size / 2;
      const front = `${frontX},${frontY} ${frontX + size},${frontY} ${frontX + size},${frontY + size} ${frontX},${frontY + size}`;
      const top = `${x},${y} ${x + size},${y} ${frontX + size},${frontY} ${frontX},${frontY}`;
      const side = `${x},${y} ${frontX},${frontY} ${frontX},${frontY + size} ${x},${y + size}`;
      return `
        <g class="${classes}" tabindex="0" role="button" aria-label="Open block ${Number.isFinite(height) ? height.toLocaleString("en-US") : ""}" data-height="${Number.isFinite(height) ? height : ""}" data-node-view="${nodeView}" data-miner-slug="${escapeHtml(miner.slug)}">
          <text class="chain-split-height-label" x="${labelX}" y="${labelY}" style="font-size:${heightFontSize}px">${Number.isFinite(height) ? height.toLocaleString("en-US") : ""}</text>
          <polygon class="chain-split-cube-face chain-split-cube-top" points="${top}"></polygon>
          <polygon class="chain-split-cube-face chain-split-cube-side" points="${side}"></polygon>
          <polygon class="chain-split-cube-face chain-split-cube-front" points="${front}"></polygon>
          <text class="chain-split-face-text" x="${faceTextX}" y="${frontY + size * 0.34}" style="font-size:${faceVersionFontSize}px">${escapeHtml(faceRows.version)}</text>
          <text class="chain-split-face-text is-mode" x="${faceTextX}" y="${frontY + size * 0.52}" style="font-size:${faceModeFontSize}px">${escapeHtml(faceRows.mode)}</text>
          <text class="chain-split-face-text is-time" x="${faceTextX}" y="${frontY + size * 0.70}" style="font-size:${faceTimeFontSize}px"${timeAttrs}>${escapeHtml(faceRows.time)}</text>
          <circle class="chain-split-miner-icon-bg" cx="${minerStartX + minerIconSize / 2}" cy="${minerY}" r="${minerIconSize / 2 + 3.5}" aria-hidden="true"></circle>
          <image class="chain-split-miner-icon" href="${escapeHtml(miner.iconSrc)}" x="${minerStartX}" y="${minerY - minerIconSize / 2}" width="${minerIconSize}" height="${minerIconSize}" style="width:${minerIconSize}px;height:${minerIconSize}px" aria-hidden="true"></image>
          <text class="chain-split-miner-label" x="${minerStartX + minerIconSize + minerGap}" y="${minerY}" style="font-size:${minerFontSize}px">${escapeHtml(miner.label)}</text>
        </g>
      `;
    }

    function renderChainSplitPlaceholderCube(height, x, y, options = {}) {
      const numericHeight = Number(height);
      const size = options.size || 154;
      const depth = options.depth || 28;
      const sideDepth = getChainSplitSideDepth(depth);
      const scale = Number(options.scale || 1);
      const frontX = x + sideDepth;
      const frontY = y + depth;
      const labelX = x + size / 2;
      const labelY = y - (Number(options.labelOffset) || Math.max(13, Math.round(17 * scale)));
      const heightText = Number.isFinite(numericHeight) ? numericHeight.toLocaleString("en-US") : "";
      const heightFontSize = fitChainSplitFontSize(heightText, Math.round(13 * scale), 10, size * 0.96, 0.62);
      const front = `${frontX},${frontY} ${frontX + size},${frontY} ${frontX + size},${frontY + size} ${frontX},${frontY + size}`;
      const top = `${x},${y} ${x + size},${y} ${frontX + size},${frontY} ${frontX},${frontY}`;
      const side = `${x},${y} ${frontX},${frontY} ${frontX},${frontY + size} ${x},${y + size}`;
      return `
        <g class="chain-split-cube chain-split-placeholder-cube" aria-hidden="true">
          <text class="chain-split-height-label" x="${labelX}" y="${labelY}" style="font-size:${heightFontSize}px">${heightText}</text>
          <polygon class="chain-split-cube-face chain-split-cube-top" points="${top}"></polygon>
          <polygon class="chain-split-cube-face chain-split-cube-side" points="${side}"></polygon>
          <polygon class="chain-split-cube-face chain-split-cube-front" points="${front}"></polygon>
        </g>
      `;
    }

    function getChainSplitStageWidth(count, gap, startX, cubeSize, cubeDepth) {
      const blockCount = Math.max(0, Number(count) || 0);
      const spacing = Number(gap);
      if (!Number.isFinite(spacing) || spacing <= 0) return 1120;
      return Math.max(1120, startX + Math.max(0, blockCount - 1) * spacing + cubeSize + getChainSplitSideDepth(cubeDepth) + spacing);
    }

    function getChainSplitScrollRange(rangeStart, rangeEnd, gap, startX, cubeSize, cubeDepth, options = {}) {
      const start = Number(rangeStart);
      const end = Number(rangeEnd);
      const spacing = Number(gap);
      if (!Number.isFinite(start) || !Number.isFinite(end) || end < start || !Number.isFinite(spacing) || spacing <= 0) {
        return null;
      }
      const scrollLeft = Number.isFinite(options.scrollLeft)
        ? Number(options.scrollLeft)
        : Number(chainSplitContent?.scrollLeft || 0);
      const clientWidth = Number(options.clientWidth || chainSplitContent?.clientWidth || 1120);
      const count = Math.floor(end - start + 1);
      const firstVisibleIndex = Math.max(0, Math.floor((scrollLeft - startX) / spacing));
      const lastVisibleIndex = Math.min(count - 1, Math.ceil((scrollLeft + clientWidth - startX) / spacing));
      const detailStartIndex = Math.max(0, firstVisibleIndex - CHAIN_SPLIT_DETAIL_BUFFER_BLOCKS);
      const detailEndIndex = Math.min(count - 1, lastVisibleIndex + CHAIN_SPLIT_DETAIL_BUFFER_BLOCKS);
      const renderStartIndex = Math.max(0, detailStartIndex - CHAIN_SPLIT_PLACEHOLDER_BUFFER_BLOCKS);
      const renderEndIndex = Math.min(count - 1, detailEndIndex + CHAIN_SPLIT_PLACEHOLDER_BUFFER_BLOCKS);
      return {
        count,
        width: getChainSplitStageWidth(count, spacing, startX, cubeSize, cubeDepth),
        firstVisibleIndex,
        lastVisibleIndex,
        detailStartIndex,
        detailEndIndex,
        renderStartIndex,
        renderEndIndex,
      };
    }

    function getChainSplitPeriodForHeight(height, nodeView = "legacy") {
      const numericHeight = Number(height);
      if (!Number.isFinite(numericHeight)) return null;
      const periods = getBip110PeriodsForNodeView(nodeView);
      return (Array.isArray(periods) ? periods : []).find((row) => {
        const start = Number(row?.period_start_height);
        const end = Number(row?.period_end_height);
        return Number.isFinite(start) && Number.isFinite(end) && numericHeight >= start && numericHeight <= end;
      }) || null;
    }

    function renderChainSplitVirtualMarkers(rangeStart, rangeEnd, range, metrics, nodeView = "legacy", xOffset = 0) {
      if (!range) return "";
      const periods = getBip110PeriodsForNodeView(nodeView);
      const startHeight = Number(rangeStart);
      const yTop = -1;
      const yBottom = Number(metrics.straightHeight || 0) + 1;
      const emptyGap = Math.max(0, metrics.gap - getChainSplitSideDepth(metrics.cubeDepth) - metrics.cubeSize);
      return (Array.isArray(periods) ? periods : [])
        .map((period) => {
          const periodStart = Number(period?.period_start_height);
          const periodNumber = Number(period?.period);
          if (!Number.isFinite(periodStart) || periodStart < Number(rangeStart) || periodStart > Number(rangeEnd)) return "";
          const boundaryIndex = periodStart - startHeight;
          if (boundaryIndex < range.renderStartIndex || boundaryIndex > range.renderEndIndex + 1) return "";
          const x = Math.round(metrics.startX + boundaryIndex * metrics.gap - (emptyGap / 2) - xOffset);
          const label = getChainSplitPeriodBoundaryLabel(periodNumber);
          const labelOffset = 12;
          return `
            <g class="chain-split-period-boundary-group">
              <line class="chain-split-period-boundary" x1="${x}" y1="${yTop}" x2="${x}" y2="${yBottom}"></line>
              <text class="chain-split-period-boundary-label" x="${x + labelOffset}" y="${yTop + labelOffset}" transform="rotate(90 ${x + labelOffset} ${yTop + labelOffset})">${escapeHtml(label)}</text>
            </g>
          `;
        })
        .join("");
    }

    function renderMinerTimelineMiniChainCube(block, x, y, options = {}) {
      const height = Number(block?.height);
      const size = Number(options.size || 46);
      const depth = Number(options.depth || 9);
      const sideDepth = getChainSplitSideDepth(depth);
      const frontX = x + sideDepth;
      const frontY = y + depth;
      const nodeView = normalizeBip110NodeView(options.nodeView || "legacy");
      const miner = getChainSplitMiner(block, nodeView);
      const classes = Number(block?.is_signaling) === 1
        ? "miner-timeline-chain-split-cube is-signaling"
        : "miner-timeline-chain-split-cube is-nonsignaling";
      const labelX = x + size / 2;
      const minerIconSize = Math.max(14, Math.min(20, size * 0.38));
      const minerIconX = frontX + (size / 2) - (minerIconSize / 2);
      const minerIconY = frontY + (size / 2) - (minerIconSize / 2);
      const top = `${x},${y} ${x + size},${y} ${frontX + size},${frontY} ${frontX},${frontY}`;
      const side = `${x},${y} ${frontX},${frontY} ${frontX},${frontY + size} ${x},${y + size}`;
      const front = `${frontX},${frontY} ${frontX + size},${frontY} ${frontX + size},${frontY + size} ${frontX},${frontY + size}`;
      const tooltip = formatChainSplitTooltip(block, nodeView);
      return `
        <g class="${classes}" tabindex="0" role="button" data-height="${Number.isFinite(height) ? height : ""}" data-node-view="${nodeView}" data-miner-slug="${escapeHtml(miner.slug || "")}" data-tooltip="${escapeHtml(tooltip)}" aria-label="Open block ${Number.isFinite(height) ? height.toLocaleString("en-US") : ""}">
          <text class="miner-timeline-chain-split-height-label" x="${labelX}" y="${y - 8}">${Number.isFinite(height) ? height.toLocaleString("en-US") : ""}</text>
          <polygon class="miner-timeline-chain-split-cube-face miner-timeline-chain-split-cube-top" points="${top}"></polygon>
          <polygon class="miner-timeline-chain-split-cube-face miner-timeline-chain-split-cube-side" points="${side}"></polygon>
          <polygon class="miner-timeline-chain-split-cube-face miner-timeline-chain-split-cube-front" points="${front}"></polygon>
          <circle class="miner-timeline-chain-split-miner-icon-bg" cx="${minerIconX + minerIconSize / 2}" cy="${minerIconY + minerIconSize / 2}" r="${minerIconSize / 2 + 5}" aria-hidden="true"></circle>
          <image class="miner-timeline-chain-split-miner-icon" href="${escapeHtml(miner.iconSrc)}" x="${minerIconX}" y="${minerIconY}" width="${minerIconSize}" height="${minerIconSize}" aria-hidden="true"></image>
        </g>
      `;
    }

    function renderMinerTimelineMiniChainPlaceholderCube(height, x, y, options = {}) {
      const numericHeight = Number(height);
      const size = Number(options.size || 38);
      const depth = Number(options.depth || 7);
      const sideDepth = getChainSplitSideDepth(depth);
      const frontX = x + sideDepth;
      const frontY = y + depth;
      const labelX = x + size / 2;
      const top = `${x},${y} ${x + size},${y} ${frontX + size},${frontY} ${frontX},${frontY}`;
      const side = `${x},${y} ${frontX},${frontY} ${frontX},${frontY + size} ${x},${y + size}`;
      const front = `${frontX},${frontY} ${frontX + size},${frontY} ${frontX + size},${frontY + size} ${frontX},${frontY + size}`;
      return `
        <g class="miner-timeline-chain-split-cube miner-timeline-chain-split-placeholder-cube" aria-hidden="true">
          <text class="miner-timeline-chain-split-height-label" x="${labelX}" y="${y - 8}">${Number.isFinite(numericHeight) ? numericHeight.toLocaleString("en-US") : ""}</text>
          <polygon class="miner-timeline-chain-split-cube-face miner-timeline-chain-split-cube-top" points="${top}"></polygon>
          <polygon class="miner-timeline-chain-split-cube-face miner-timeline-chain-split-cube-side" points="${side}"></polygon>
          <polygon class="miner-timeline-chain-split-cube-face miner-timeline-chain-split-cube-front" points="${front}"></polygon>
        </g>
      `;
    }

    function renderMinerTimelineMiniChainPeriodMarkers(positions, options = {}) {
      if (!Array.isArray(positions) || positions.length < 2) return "";
      const size = Number(options.size || 46);
      const depth = Number(options.depth || 9);
      const yTop = Number(options.yTop || 0);
      const yBottom = Number(options.yBottom || 0);
      return positions.slice(1).map((position, index) => {
        const previous = positions[index];
        const previousPeriod = Number(previous?.block?.period);
        const nextPeriod = Number(position?.block?.period);
        if (!Number.isFinite(previousPeriod) || !Number.isFinite(nextPeriod) || previousPeriod === nextPeriod) return "";
        const previousX = Number(previous.x);
        const nextX = Number(position.x);
        const emptyGap = Math.max(0, nextX - previousX - getChainSplitSideDepth(depth) - size);
        const x = Math.round(nextX - (emptyGap / 2));
        const label = getChainSplitPeriodBoundaryLabel(nextPeriod);
        return `
            <g class="miner-timeline-chain-split-period-boundary-group">
              <line class="miner-timeline-chain-split-period-boundary" x1="${x}" y1="${yTop}" x2="${x}" y2="${yBottom}"></line>
              <text class="miner-timeline-chain-split-period-boundary-label" x="${x + 5}" y="${Math.max(12, yTop + 12)}">${escapeHtml(label)}</text>
            </g>
          `;
      }).join("");
    }

    function getMinerTimelineMiniChainLatestScrollLeft() {
      if (!minerTimelineChainSplit) return 0;
      const currentTipX = Number(minerTimelineChainSplit.dataset.currentTipX);
      const currentRightPad = Number(minerTimelineChainSplit.dataset.currentRightPad);
      const currentTipLocalPad = Number(minerTimelineChainSplit.dataset.currentTipLocalPad || 0);
      const maxScrollLeft = Math.max(0, minerTimelineChainSplit.scrollWidth - minerTimelineChainSplit.clientWidth);
      if (!Number.isFinite(currentTipX) || !Number.isFinite(currentRightPad)) return maxScrollLeft;
      const localPad = Number.isFinite(currentTipLocalPad) ? currentTipLocalPad : 0;
      const isVirtualScrollSpace = minerTimelineChainSplit.dataset.virtualScrollSpace === "1";
      const target = currentTipX
        + (isVirtualScrollSpace ? 0 : localPad)
        - (minerTimelineChainSplit.clientWidth - currentRightPad);
      return clamp(target, 0, maxScrollLeft);
    }

    function isMinerTimelineMiniChainAtLatest(tolerance = 0.5) {
      if (!minerTimelineChainSplit) return true;
      const scrollLeft = Number(minerTimelineChainSplit.scrollLeft || 0);
      const latestScrollLeft = getMinerTimelineMiniChainLatestScrollLeft();
      return Math.abs(scrollLeft - latestScrollLeft) <= tolerance;
    }

    function clampMinerTimelineMiniChainScrollToLatest() {
      if (!minerTimelineChainSplit) return false;
      const latestScrollLeft = getMinerTimelineMiniChainLatestScrollLeft();
      const currentScrollLeft = Number(minerTimelineChainSplit.scrollLeft || 0);
      if (!Number.isFinite(latestScrollLeft) || currentScrollLeft <= latestScrollLeft + 0.5) return false;
      state.minerTimelineChainSplitHandlingScroll = true;
      minerTimelineChainSplit.scrollLeft = latestScrollLeft;
      requestAnimationFrame(() => {
        finishMinerTimelineMiniChainHandlingScroll();
      });
      return true;
    }

    function updateMinerTimelineMiniChainSnapLatestButton() {
      if (!minerTimelineChainSplitSnapLatest) return;
      minerTimelineChainSplitSnapLatest.hidden = isMinerTimelineMiniChainAtLatest(1);
    }

    function getMinerTimelineMiniChainPreviousPeriodBoundary() {
      if (!minerTimelineChainSplit) return null;
      const model = getChainSplitModel();
      if (model.splitDetected || !Number.isFinite(model.rangeStart) || !Number.isFinite(model.rangeEnd)) return null;
      const size = 38;
      const depth = 7;
      const gap = 52;
      const startX = 24;
      const periods = getBip110PeriodsForNodeView(model.straightNodeView);
      const starts = (Array.isArray(periods) ? periods : [])
        .map((period) => Number(period?.period_start_height))
        .filter((height) => Number.isFinite(height) && height >= model.rangeStart && height <= model.rangeEnd)
        .sort((a, b) => a - b);
      if (!starts.length) return null;
      const currentApproxHeight = model.rangeStart + Math.floor(Math.max(0, minerTimelineChainSplit.scrollLeft - startX) / gap);
      const targetHeight = starts.filter((height) => height < currentApproxHeight - 1).pop()
        || starts.filter((height) => height <= currentApproxHeight + 1).pop()
        || null;
      if (!Number.isFinite(targetHeight)) return null;
      const boundaryIndex = targetHeight - model.rangeStart;
      const emptyGap = Math.max(0, gap - getChainSplitSideDepth(depth) - size);
      const boundaryX = startX + boundaryIndex * gap - (emptyGap / 2);
      return {
        height: targetHeight,
        scrollLeft: clamp(boundaryX, 0, Math.max(0, minerTimelineChainSplit.scrollWidth - minerTimelineChainSplit.clientWidth)),
      };
    }

    function updateMinerTimelineMiniChainPeriodBackButton() {
      if (!minerTimelineChainSplitPeriodBack) return;
      minerTimelineChainSplitPeriodBack.hidden = !getMinerTimelineMiniChainPreviousPeriodBoundary();
    }

    function updateMinerTimelineMiniChainScrollButtons() {
      updateMinerTimelineMiniChainSnapLatestButton();
      updateMinerTimelineMiniChainPeriodBackButton();
    }

    function finishMinerTimelineMiniChainHandlingScroll() {
      state.minerTimelineChainSplitHandlingScroll = false;
      updateMinerTimelineMiniChainScrollButtons();
      if (!state.minerTimelineChainSplitPendingScrollRender || !isMinerTimelineOverlayOpen()) return;
      state.minerTimelineChainSplitPendingScrollRender = false;
      handleMinerTimelineMiniChainScroll();
    }

    function renderMinerTimelineMiniChainVirtualMarkers(rangeStart, rangeEnd, range, metrics, nodeView = "legacy", xOffset = 0) {
      if (!range) return "";
      const periods = getBip110PeriodsForNodeView(nodeView);
      const startHeight = Number(rangeStart);
      const emptyGap = Math.max(0, metrics.gap - getChainSplitSideDepth(metrics.depth) - metrics.size);
      return (Array.isArray(periods) ? periods : [])
        .map((period) => {
          const periodStart = Number(period?.period_start_height);
          if (!Number.isFinite(periodStart) || periodStart < Number(rangeStart) || periodStart > Number(rangeEnd)) return "";
          const boundaryIndex = periodStart - startHeight;
          if (boundaryIndex < range.renderStartIndex || boundaryIndex > range.renderEndIndex + 1) return "";
          const x = Math.round(metrics.startX + boundaryIndex * metrics.gap - (emptyGap / 2) - xOffset);
          const periodNumber = Number(period?.period);
          const label = getChainSplitPeriodBoundaryLabel(periodNumber);
          return `
            <g class="miner-timeline-chain-split-period-boundary-group">
              <line class="miner-timeline-chain-split-period-boundary" x1="${x}" y1="${metrics.yTop}" x2="${x}" y2="${metrics.yBottom}"></line>
              <text class="miner-timeline-chain-split-period-boundary-label" x="${x + 5}" y="${Math.max(12, Number(metrics.yTop || 0) + 12)}">${escapeHtml(label)}</text>
            </g>
          `;
        })
        .join("");
    }

    function applyMinerTimelineMiniChainPendingScrollAdjustment() {
      if (!minerTimelineChainSplit || !state.minerTimelineChainSplitScrollAdjustment) return;
      const adjustment = state.minerTimelineChainSplitScrollAdjustment;
      state.minerTimelineChainSplitScrollAdjustment = null;
      requestAnimationFrame(() => {
        state.minerTimelineChainSplitHandlingScroll = true;
        const target = clamp(
          Number(adjustment.scrollLeft || 0),
          0,
          Math.max(0, minerTimelineChainSplit.scrollWidth - minerTimelineChainSplit.clientWidth)
        );
        minerTimelineChainSplit.scrollLeft = target;
        updateMinerTimelineMiniChainScrollButtons();
        requestAnimationFrame(() => {
          finishMinerTimelineMiniChainHandlingScroll();
        });
      });
    }

    function scrollMinerTimelineMiniChainToLatest() {
      if (!minerTimelineChainSplit) return;
      state.minerTimelineChainSplitFollowLatest = true;
      requestAnimationFrame(() => {
        state.minerTimelineChainSplitHandlingScroll = true;
        minerTimelineChainSplit.scrollLeft = getMinerTimelineMiniChainLatestScrollLeft();
        updateMinerTimelineMiniChainScrollButtons();
        requestAnimationFrame(() => {
          renderMinerTimelineMiniChainSplit({ suppressFollowLatest: true });
          minerTimelineChainSplit.scrollLeft = getMinerTimelineMiniChainLatestScrollLeft();
          finishMinerTimelineMiniChainHandlingScroll();
        });
      });
    }

    function jumpMinerTimelineMiniChainToPreviousPeriod() {
      if (!minerTimelineChainSplit) return;
      const target = getMinerTimelineMiniChainPreviousPeriodBoundary();
      if (!target) return;
      state.minerTimelineChainSplitHandlingScroll = true;
      state.minerTimelineChainSplitFollowLatest = false;
      minerTimelineChainSplit.scrollLeft = target.scrollLeft;
      renderMinerTimelineMiniChainSplit({ suppressFollowLatest: true });
      minerTimelineChainSplit.scrollLeft = target.scrollLeft;
      requestAnimationFrame(() => {
        finishMinerTimelineMiniChainHandlingScroll();
      });
    }

    function snapMinerTimelineMiniChainToLatest() {
      state.minerTimelineChainSplitScrollAdjustment = null;
      state.minerTimelineChainSplitFollowLatest = true;
      renderMinerTimelineMiniChainSplit();
      scrollMinerTimelineMiniChainToLatest();
    }

    function handleMinerTimelineMiniChainScroll() {
      if (!minerTimelineChainSplit) return;
      if (state.minerTimelineChainSplitHandlingScroll) {
        state.minerTimelineChainSplitPendingScrollRender = true;
        return;
      }
      if (clampMinerTimelineMiniChainScrollToLatest()) {
        state.minerTimelineChainSplitFollowLatest = true;
        renderMinerTimelineMiniChainSplit({ suppressFollowLatest: true });
        return;
      }
      state.minerTimelineChainSplitFollowLatest = isMinerTimelineMiniChainAtLatest(0.5);
      updateMinerTimelineMiniChainScrollButtons();
      if (state.minerTimelineChainSplitDrag?.active) return;
      const renderScrollLeft = Number(minerTimelineChainSplit.dataset.virtualRenderScrollLeft);
      const gap = Number(minerTimelineChainSplit.dataset.windowGap || 0);
      if (!minerTimelineChainSplit.classList.contains("is-split")
        && Number.isFinite(renderScrollLeft)
        && Number.isFinite(gap)
        && gap > 0
        && Math.abs(Number(minerTimelineChainSplit.scrollLeft || 0) - renderScrollLeft) < gap * 0.5) {
        return;
      }
      if (state.minerTimelineChainSplitRenderFrame) return;
      state.minerTimelineChainSplitRenderFrame = requestAnimationFrame(() => {
        state.minerTimelineChainSplitRenderFrame = null;
        state.minerTimelineChainSplitFollowLatest = isMinerTimelineMiniChainAtLatest(0.5);
        renderMinerTimelineMiniChainSplit({ suppressFollowLatest: !state.minerTimelineChainSplitFollowLatest });
        updateMinerTimelineMiniChainScrollButtons();
      });
    }

    function handleMinerTimelineMiniChainPointerDown(event) {
      if (!minerTimelineChainSplit || event.button !== 0) return;
      if (event.target instanceof Element && event.target.closest("button, input, select, textarea, a")) return;
      state.minerTimelineChainSplitDrag = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        startScrollLeft: Number(minerTimelineChainSplit.scrollLeft || 0),
        active: false,
      };
      minerTimelineChainSplit.setPointerCapture?.(event.pointerId);
    }

    function handleMinerTimelineMiniChainPointerMove(event) {
      const drag = state.minerTimelineChainSplitDrag;
      if (!minerTimelineChainSplit || !drag || drag.pointerId !== event.pointerId) return;
      const dx = event.clientX - drag.startX;
      const dy = event.clientY - drag.startY;
      if (!drag.active) {
        if (Math.abs(dx) < 7 || Math.abs(dx) < Math.abs(dy) * 1.15) return;
        drag.active = true;
        minerTimelineChainSplit.classList.add("is-dragging");
        state.minerTimelineChainSplitSuppressClickUntil = Date.now() + 450;
      }
      event.preventDefault();
      minerTimelineChainSplit.scrollLeft = Math.min(drag.startScrollLeft - dx, getMinerTimelineMiniChainLatestScrollLeft());
      state.minerTimelineChainSplitFollowLatest = isMinerTimelineMiniChainAtLatest(0.5);
      updateMinerTimelineMiniChainScrollButtons();
    }

    function finishMinerTimelineMiniChainPointerDrag(event) {
      const drag = state.minerTimelineChainSplitDrag;
      if (!minerTimelineChainSplit || !drag || drag.pointerId !== event.pointerId) return;
      if (drag.active) {
        state.minerTimelineChainSplitSuppressClickUntil = Date.now() + 450;
      }
      state.minerTimelineChainSplitDrag = null;
      minerTimelineChainSplit.classList.remove("is-dragging");
      minerTimelineChainSplit.releasePointerCapture?.(event.pointerId);
      if (drag.active) {
        renderMinerTimelineMiniChainSplit({ suppressFollowLatest: true });
      }
      updateMinerTimelineMiniChainScrollButtons();
    }

    function renderMinerTimelineMiniChainSplit(options = {}) {
      if (!minerTimelineChainSplit) return;
      if (!syncMinerTimelineChainViewControls()) {
        minerTimelineChainSplit.innerHTML = "";
        updateMinerTimelineMiniChainScrollButtons();
        return;
      }
      const maxScrollBefore = Math.max(0, minerTimelineChainSplit.scrollWidth - minerTimelineChainSplit.clientWidth);
      const shouldFollowLatest = !!options.forceFollowLatest || (
        !options.suppressFollowLatest
        && (maxScrollBefore <= 2 || state.minerTimelineChainSplitFollowLatest === true)
      );
      const model = getChainSplitModel();
      const size = 38;
      const depth = 7;
      const sideDepth = getChainSplitSideDepth(depth);
      const gap = 52;
      const startX = 24;
      const topY = 0;
      const height = 190;
      const previewVerticalOffset = 3;
      const straightY = 66 + previewVerticalOffset;
      const splitY = 76 + previewVerticalOffset;
      const bip110Y = 45 + previewVerticalOffset;
      const legacyY = 115 + previewVerticalOffset;
      const currentRightPad = sideDepth + size + gap;
      const localPad = Math.max(startX, gap);
      let width = 0;
      let cubes = "";
      let markers = "";
      minerTimelineChainSplit.dataset.windowGap = String(gap);

      if (model.splitDetected) {
        const trunk = (model.trunkBlocks || []).slice(-10);
        const legacyBranch = (model.legacyBranch || []).slice(0, 8);
        const bip110Branch = (model.bip110Branch || []).slice(0, 8);
        const forkX = startX + Math.max(0, trunk.length - 1) * gap + gap;
        const trunkPositions = trunk.map((block, index) => ({ block, x: startX + index * gap, y: splitY, nodeView: "legacy" }));
        const bip110Positions = bip110Branch.map((block, index) => ({ block, x: forkX + index * gap, y: bip110Y, nodeView: "bip110" }));
        const legacyPositions = legacyBranch.map((block, index) => ({ block, x: forkX + index * gap, y: legacyY, nodeView: "legacy" }));
        const positions = [...trunkPositions, ...bip110Positions, ...legacyPositions];
        if (!positions.length) {
          minerTimelineChainSplit.innerHTML = "";
          return;
        }
        const longestTipX = positions.reduce((max, item) => Math.max(max, Number(item.x) || 0), startX);
        width = Math.max(720, longestTipX + currentRightPad);
        minerTimelineChainSplit.dataset.currentTipX = String(longestTipX);
        minerTimelineChainSplit.dataset.currentRightPad = String(currentRightPad);
        minerTimelineChainSplit.dataset.currentTipLocalPad = "0";
        minerTimelineChainSplit.dataset.virtualScrollSpace = "0";
        minerTimelineChainSplit.classList.add("is-split");
        cubes = positions.map((item) => renderMinerTimelineMiniChainCube(item.block, item.x, item.y, {
          size,
          depth,
          nodeView: item.nodeView,
        })).join("");
        markers = [
          renderMinerTimelineMiniChainPeriodMarkers(trunkPositions, { size, depth, yTop: topY, yBottom: height }),
          renderMinerTimelineMiniChainPeriodMarkers(bip110Positions, { size, depth, yTop: topY, yBottom: height }),
          renderMinerTimelineMiniChainPeriodMarkers(legacyPositions, { size, depth, yTop: topY, yBottom: height }),
        ].join("");
        const preservedScrollLeft = Number(minerTimelineChainSplit.scrollLeft || 0);
        minerTimelineChainSplit.innerHTML = `<svg class="miner-timeline-chain-split-svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="Compact BIP-110 chain split preview">${markers}${cubes}</svg>`;
        applyMinerTimelineMiniChainPendingScrollAdjustment();
        if (shouldFollowLatest) scrollMinerTimelineMiniChainToLatest();
        else {
          minerTimelineChainSplit.scrollLeft = clamp(preservedScrollLeft, 0, Math.max(0, minerTimelineChainSplit.scrollWidth - minerTimelineChainSplit.clientWidth));
          updateMinerTimelineMiniChainScrollButtons();
        }
        return;
      } else {
        const rangeEnd = Number(model.rangeEnd);
        const rangeStart = Number(model.rangeStart);
        const map = model.straightMap;
        if (!Number.isFinite(rangeStart) || !Number.isFinite(rangeEnd) || !map) {
          minerTimelineChainSplit.innerHTML = "";
          return;
        }
        minerTimelineChainSplit.classList.remove("is-split");
        const viewportClientWidth = Math.max(1, Number(minerTimelineChainSplit.clientWidth || 0));
        const viewportWidth = Math.max(720, viewportClientWidth);
        const totalBlockCount = Math.floor(rangeEnd - rangeStart + 1);
        const currentTipX = startX + Math.max(0, totalBlockCount - 1) * gap;
        const targetStageWidth = Math.max(
          getChainSplitStageWidth(totalBlockCount, gap, startX, size, depth),
          currentTipX + localPad + currentRightPad
        );
        const latestScrollLeft = clamp(
          currentTipX - (viewportClientWidth - currentRightPad),
          0,
          Math.max(0, targetStageWidth - viewportClientWidth)
        );
        const targetScrollLeft = shouldFollowLatest
          ? latestScrollLeft
          : clamp(Number(minerTimelineChainSplit.scrollLeft || 0), 0, latestScrollLeft);
        const virtualRange = getChainSplitScrollRange(rangeStart, rangeEnd, gap, startX, size, depth, {
          scrollLeft: targetScrollLeft,
          clientWidth: viewportClientWidth,
        });
        if (!virtualRange) {
          minerTimelineChainSplit.innerHTML = "";
          return;
        }
        const viewportLeft = targetScrollLeft;
        const xOffset = Math.max(0, viewportLeft - localPad);
        const positions = [];
        for (let index = virtualRange.renderStartIndex; index <= virtualRange.renderEndIndex; index += 1) {
          const heightValue = rangeStart + index;
          const block = map.get(heightValue);
          const x = startX + index * gap - xOffset;
          const detailLoaded = index >= virtualRange.detailStartIndex && index <= virtualRange.detailEndIndex && block;
          positions.push({ height: heightValue, block, x, y: straightY, detailLoaded });
        }
        const stageWidth = Math.max(virtualRange.width, targetStageWidth);
        width = viewportWidth + localPad * 2;
        minerTimelineChainSplit.dataset.currentTipX = String(currentTipX);
        minerTimelineChainSplit.dataset.currentRightPad = String(currentRightPad);
        minerTimelineChainSplit.dataset.currentTipLocalPad = String(localPad);
        minerTimelineChainSplit.dataset.virtualScrollSpace = "1";
        markers = renderMinerTimelineMiniChainVirtualMarkers(rangeStart, rangeEnd, virtualRange, {
          size,
          depth,
          gap,
          startX,
          yTop: topY,
          yBottom: height,
        }, model.straightNodeView, xOffset);
        cubes = positions.map((item) => (
          item.detailLoaded
            ? renderMinerTimelineMiniChainCube(item.block, item.x, item.y, { size, depth, nodeView: model.straightNodeView })
            : renderMinerTimelineMiniChainPlaceholderCube(item.height, item.x, item.y, { size, depth })
        )).join("");
        const preservedScrollLeft = targetScrollLeft;
        minerTimelineChainSplit.innerHTML = `<div class="miner-timeline-chain-split-virtual-stage" style="width:${stageWidth}px;height:${height}px"><svg class="miner-timeline-chain-split-svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" style="left:${xOffset}px" role="img" aria-label="Compact BIP-110 chain split preview">${markers}${cubes}</svg></div>`;
        minerTimelineChainSplit.dataset.virtualRenderScrollLeft = String(preservedScrollLeft);
        if (shouldFollowLatest) {
          state.minerTimelineChainSplitHandlingScroll = true;
          minerTimelineChainSplit.scrollLeft = getMinerTimelineMiniChainLatestScrollLeft();
          requestAnimationFrame(() => {
            finishMinerTimelineMiniChainHandlingScroll();
            scrollMinerTimelineMiniChainToLatest();
          });
        } else {
          state.minerTimelineChainSplitHandlingScroll = true;
          minerTimelineChainSplit.scrollLeft = clamp(preservedScrollLeft, 0, Math.max(0, minerTimelineChainSplit.scrollWidth - minerTimelineChainSplit.clientWidth));
          requestAnimationFrame(() => {
            finishMinerTimelineMiniChainHandlingScroll();
          });
        }
        applyMinerTimelineMiniChainPendingScrollAdjustment();
        updateMinerTimelineMiniChainScrollButtons();
        return;
      }
    }

    function getMainChainSplitLatestScrollLeft() {
      if (!mainChainSplit) return 0;
      const currentTipX = Number(mainChainSplit.dataset.currentTipX);
      const currentRightPad = Number(mainChainSplit.dataset.currentRightPad);
      const currentTipLocalPad = Number(mainChainSplit.dataset.currentTipLocalPad || 0);
      const maxScrollLeft = Math.max(0, mainChainSplit.scrollWidth - mainChainSplit.clientWidth);
      if (!Number.isFinite(currentTipX) || !Number.isFinite(currentRightPad)) return maxScrollLeft;
      const localPad = Number.isFinite(currentTipLocalPad) ? currentTipLocalPad : 0;
      const isVirtualScrollSpace = mainChainSplit.dataset.virtualScrollSpace === "1";
      const target = currentTipX
        + (isVirtualScrollSpace ? 0 : localPad)
        - (mainChainSplit.clientWidth - currentRightPad);
      return clamp(target, 0, maxScrollLeft);
    }

    function isMainChainSplitAtLatest(tolerance = 0.5) {
      if (!mainChainSplit) return true;
      return Math.abs(Number(mainChainSplit.scrollLeft || 0) - getMainChainSplitLatestScrollLeft()) <= tolerance;
    }

    function getMainChainSplitPreviousPeriodBoundary() {
      if (!mainChainSplit) return null;
      const model = getChainSplitModel();
      if (model.splitDetected || !Number.isFinite(model.rangeStart) || !Number.isFinite(model.rangeEnd)) return null;
      const size = 38;
      const depth = 7;
      const gap = 52;
      const startX = 24;
      const periods = getBip110PeriodsForNodeView(model.straightNodeView);
      const starts = (Array.isArray(periods) ? periods : [])
        .map((period) => Number(period?.period_start_height))
        .filter((height) => Number.isFinite(height) && height >= model.rangeStart && height <= model.rangeEnd)
        .sort((a, b) => a - b);
      if (!starts.length) return null;
      const currentApproxHeight = model.rangeStart + Math.floor(Math.max(0, mainChainSplit.scrollLeft - startX) / gap);
      const targetHeight = starts.filter((height) => height < currentApproxHeight - 1).pop()
        || starts.filter((height) => height <= currentApproxHeight + 1).pop()
        || null;
      if (!Number.isFinite(targetHeight)) return null;
      const boundaryIndex = targetHeight - model.rangeStart;
      const emptyGap = Math.max(0, gap - getChainSplitSideDepth(depth) - size);
      const boundaryX = startX + boundaryIndex * gap - (emptyGap / 2);
      return {
        height: targetHeight,
        scrollLeft: clamp(boundaryX, 0, Math.max(0, mainChainSplit.scrollWidth - mainChainSplit.clientWidth)),
      };
    }

    function updateMainChainSplitScrollButtons() {
      if (mainChainSplitSnapLatest) {
        mainChainSplitSnapLatest.hidden = isMainChainSplitAtLatest(1);
      }
      if (mainChainSplitPeriodBack) {
        mainChainSplitPeriodBack.hidden = !getMainChainSplitPreviousPeriodBoundary();
      }
    }

    function finishMainChainSplitHandlingScroll() {
      state.mainChainSplitHandlingScroll = false;
      updateMainChainSplitScrollButtons();
      if (!state.mainChainSplitPendingScrollRender || !isMainChainPanelVisible()) return;
      state.mainChainSplitPendingScrollRender = false;
      handleMainChainSplitScroll();
    }

    function applyMainChainSplitPendingScrollAdjustment() {
      if (!mainChainSplit || !state.mainChainSplitScrollAdjustment) return;
      const adjustment = state.mainChainSplitScrollAdjustment;
      state.mainChainSplitScrollAdjustment = null;
      requestAnimationFrame(() => {
        state.mainChainSplitHandlingScroll = true;
        mainChainSplit.scrollLeft = clamp(
          Number(adjustment.scrollLeft || 0),
          0,
          Math.max(0, mainChainSplit.scrollWidth - mainChainSplit.clientWidth)
        );
        updateMainChainSplitScrollButtons();
        requestAnimationFrame(() => {
          finishMainChainSplitHandlingScroll();
        });
      });
    }

    function scrollMainChainSplitToLatest() {
      if (!mainChainSplit) return;
      state.mainChainSplitFollowLatest = true;
      requestAnimationFrame(() => {
        state.mainChainSplitHandlingScroll = true;
        mainChainSplit.scrollLeft = getMainChainSplitLatestScrollLeft();
        updateMainChainSplitScrollButtons();
        requestAnimationFrame(() => {
          renderMainChainSplitPanel({ suppressFollowLatest: true });
          mainChainSplit.scrollLeft = getMainChainSplitLatestScrollLeft();
          finishMainChainSplitHandlingScroll();
        });
      });
    }

    function renderMainChainSplitPanel(options = {}) {
      if (!mainChainSplit) return;
      syncMainChainPanelVisibility();
      if (!isMainChainPanelVisible()) {
        mainChainSplit.innerHTML = "";
        updateMainChainSplitScrollButtons();
        return;
      }
      const maxScrollBefore = Math.max(0, mainChainSplit.scrollWidth - mainChainSplit.clientWidth);
      const shouldFollowLatest = !!options.forceFollowLatest || (
        !options.suppressFollowLatest
        && (maxScrollBefore <= 2 || state.mainChainSplitFollowLatest === true)
      );
      const model = getChainSplitModel();
      const size = 38;
      const depth = 7;
      const sideDepth = getChainSplitSideDepth(depth);
      const gap = 52;
      const startX = 24;
      const topY = 0;
      const height = 190;
      const previewVerticalOffset = 3;
      const straightY = 66 + previewVerticalOffset;
      const splitY = 76 + previewVerticalOffset;
      const bip110Y = 45 + previewVerticalOffset;
      const legacyY = 115 + previewVerticalOffset;
      const currentRightPad = sideDepth + size + gap;
      const localPad = Math.max(startX, gap);
      let width = 0;
      let cubes = "";
      let markers = "";
      mainChainSplit.dataset.windowGap = String(gap);

      if (model.splitDetected) {
        const trunk = (model.trunkBlocks || []).slice(-10);
        const legacyBranch = (model.legacyBranch || []).slice(0, 8);
        const bip110Branch = (model.bip110Branch || []).slice(0, 8);
        const forkX = startX + Math.max(0, trunk.length - 1) * gap + gap;
        const trunkPositions = trunk.map((block, index) => ({ block, x: startX + index * gap, y: splitY, nodeView: "legacy" }));
        const bip110Positions = bip110Branch.map((block, index) => ({ block, x: forkX + index * gap, y: bip110Y, nodeView: "bip110" }));
        const legacyPositions = legacyBranch.map((block, index) => ({ block, x: forkX + index * gap, y: legacyY, nodeView: "legacy" }));
        const positions = [...trunkPositions, ...bip110Positions, ...legacyPositions];
        if (!positions.length) {
          mainChainSplit.innerHTML = "";
          return;
        }
        const longestTipX = positions.reduce((max, item) => Math.max(max, Number(item.x) || 0), startX);
        width = Math.max(720, longestTipX + currentRightPad);
        mainChainSplit.dataset.currentTipX = String(longestTipX);
        mainChainSplit.dataset.currentRightPad = String(currentRightPad);
        mainChainSplit.dataset.currentTipLocalPad = "0";
        mainChainSplit.dataset.virtualScrollSpace = "0";
        mainChainSplit.classList.add("is-split");
        cubes = positions.map((item) => renderMinerTimelineMiniChainCube(item.block, item.x, item.y, {
          size,
          depth,
          nodeView: item.nodeView,
        })).join("");
        markers = [
          renderMinerTimelineMiniChainPeriodMarkers(trunkPositions, { size, depth, yTop: topY, yBottom: height }),
          renderMinerTimelineMiniChainPeriodMarkers(bip110Positions, { size, depth, yTop: topY, yBottom: height }),
          renderMinerTimelineMiniChainPeriodMarkers(legacyPositions, { size, depth, yTop: topY, yBottom: height }),
        ].join("");
        const preservedScrollLeft = Number(mainChainSplit.scrollLeft || 0);
        mainChainSplit.innerHTML = `<svg class="miner-timeline-chain-split-svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="Compact BIP-110 chain preview">${markers}${cubes}</svg>`;
        applyMainChainSplitPendingScrollAdjustment();
        if (shouldFollowLatest) scrollMainChainSplitToLatest();
        else {
          mainChainSplit.scrollLeft = clamp(preservedScrollLeft, 0, Math.max(0, mainChainSplit.scrollWidth - mainChainSplit.clientWidth));
          updateMainChainSplitScrollButtons();
        }
        return;
      }

      const rangeEnd = Number(model.rangeEnd);
      const rangeStart = Number(model.rangeStart);
      const map = model.straightMap;
      if (!Number.isFinite(rangeStart) || !Number.isFinite(rangeEnd) || !map) {
        mainChainSplit.innerHTML = "";
        return;
      }
      mainChainSplit.classList.remove("is-split");
      const viewportClientWidth = Math.max(1, Number(mainChainSplit.clientWidth || 0));
      const viewportWidth = Math.max(720, viewportClientWidth);
      const totalBlockCount = Math.floor(rangeEnd - rangeStart + 1);
      const currentTipX = startX + Math.max(0, totalBlockCount - 1) * gap;
      const targetStageWidth = Math.max(
        getChainSplitStageWidth(totalBlockCount, gap, startX, size, depth),
        currentTipX + localPad + currentRightPad
      );
      const latestScrollLeft = clamp(
        currentTipX - (viewportClientWidth - currentRightPad),
        0,
        Math.max(0, targetStageWidth - viewportClientWidth)
      );
      const targetScrollLeft = shouldFollowLatest
        ? latestScrollLeft
        : clamp(Number(mainChainSplit.scrollLeft || 0), 0, latestScrollLeft);
      const virtualRange = getChainSplitScrollRange(rangeStart, rangeEnd, gap, startX, size, depth, {
        scrollLeft: targetScrollLeft,
        clientWidth: viewportClientWidth,
      });
      if (!virtualRange) {
        mainChainSplit.innerHTML = "";
        return;
      }
      const viewportLeft = targetScrollLeft;
      const xOffset = Math.max(0, viewportLeft - localPad);
      const positions = [];
      for (let index = virtualRange.renderStartIndex; index <= virtualRange.renderEndIndex; index += 1) {
        const heightValue = rangeStart + index;
        const block = map.get(heightValue);
        const x = startX + index * gap - xOffset;
        const detailLoaded = index >= virtualRange.detailStartIndex && index <= virtualRange.detailEndIndex && block;
        positions.push({ height: heightValue, block, x, y: straightY, detailLoaded });
      }
      const stageWidth = Math.max(virtualRange.width, targetStageWidth);
      width = viewportWidth + localPad * 2;
      mainChainSplit.dataset.currentTipX = String(currentTipX);
      mainChainSplit.dataset.currentRightPad = String(currentRightPad);
      mainChainSplit.dataset.currentTipLocalPad = String(localPad);
      mainChainSplit.dataset.virtualScrollSpace = "1";
      markers = renderMinerTimelineMiniChainVirtualMarkers(rangeStart, rangeEnd, virtualRange, {
        size,
        depth,
        gap,
        startX,
        yTop: topY,
        yBottom: height,
      }, model.straightNodeView, xOffset);
      cubes = positions.map((item) => (
        item.detailLoaded
          ? renderMinerTimelineMiniChainCube(item.block, item.x, item.y, { size, depth, nodeView: model.straightNodeView })
          : renderMinerTimelineMiniChainPlaceholderCube(item.height, item.x, item.y, { size, depth })
      )).join("");
      const preservedScrollLeft = targetScrollLeft;
      mainChainSplit.innerHTML = `<div class="miner-timeline-chain-split-virtual-stage" style="width:${stageWidth}px;height:${height}px"><svg class="miner-timeline-chain-split-svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" style="left:${xOffset}px" role="img" aria-label="Compact BIP-110 chain preview">${markers}${cubes}</svg></div>`;
      mainChainSplit.dataset.virtualRenderScrollLeft = String(preservedScrollLeft);
      if (shouldFollowLatest) {
        state.mainChainSplitHandlingScroll = true;
        mainChainSplit.scrollLeft = getMainChainSplitLatestScrollLeft();
        requestAnimationFrame(() => {
          finishMainChainSplitHandlingScroll();
          scrollMainChainSplitToLatest();
        });
      } else {
        state.mainChainSplitHandlingScroll = true;
        mainChainSplit.scrollLeft = clamp(preservedScrollLeft, 0, Math.max(0, mainChainSplit.scrollWidth - mainChainSplit.clientWidth));
        requestAnimationFrame(() => {
          finishMainChainSplitHandlingScroll();
        });
      }
      applyMainChainSplitPendingScrollAdjustment();
      updateMainChainSplitScrollButtons();
    }

    function clampMainChainSplitScrollToLatest() {
      if (!mainChainSplit) return false;
      const latestScrollLeft = getMainChainSplitLatestScrollLeft();
      const currentScrollLeft = Number(mainChainSplit.scrollLeft || 0);
      if (!Number.isFinite(latestScrollLeft) || currentScrollLeft <= latestScrollLeft + 0.5) return false;
      state.mainChainSplitHandlingScroll = true;
      mainChainSplit.scrollLeft = latestScrollLeft;
      requestAnimationFrame(() => {
        finishMainChainSplitHandlingScroll();
      });
      return true;
    }

    function handleMainChainSplitScroll() {
      if (!mainChainSplit) return;
      if (state.mainChainSplitHandlingScroll) {
        state.mainChainSplitPendingScrollRender = true;
        return;
      }
      if (clampMainChainSplitScrollToLatest()) {
        state.mainChainSplitFollowLatest = true;
        renderMainChainSplitPanel({ suppressFollowLatest: true });
        return;
      }
      state.mainChainSplitFollowLatest = isMainChainSplitAtLatest(0.5);
      updateMainChainSplitScrollButtons();
      if (state.mainChainSplitDrag?.active) return;
      const renderScrollLeft = Number(mainChainSplit.dataset.virtualRenderScrollLeft);
      const gap = Number(mainChainSplit.dataset.windowGap || 0);
      if (!mainChainSplit.classList.contains("is-split")
        && Number.isFinite(renderScrollLeft)
        && Number.isFinite(gap)
        && gap > 0
        && Math.abs(Number(mainChainSplit.scrollLeft || 0) - renderScrollLeft) < gap * 0.5) {
        return;
      }
      if (state.mainChainSplitRenderFrame) return;
      state.mainChainSplitRenderFrame = requestAnimationFrame(() => {
        state.mainChainSplitRenderFrame = null;
        state.mainChainSplitFollowLatest = isMainChainSplitAtLatest(0.5);
        renderMainChainSplitPanel({ suppressFollowLatest: !state.mainChainSplitFollowLatest });
        updateMainChainSplitScrollButtons();
      });
    }

    function handleMainChainSplitPointerDown(event) {
      if (!mainChainSplit || event.button !== 0) return;
      if (event.target instanceof Element && event.target.closest("button, input, select, textarea, a")) return;
      state.mainChainSplitDrag = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        startScrollLeft: Number(mainChainSplit.scrollLeft || 0),
        active: false,
      };
      mainChainSplit.setPointerCapture?.(event.pointerId);
    }

    function handleMainChainSplitPointerMove(event) {
      const drag = state.mainChainSplitDrag;
      if (!mainChainSplit || !drag || drag.pointerId !== event.pointerId) return;
      const dx = event.clientX - drag.startX;
      const dy = event.clientY - drag.startY;
      if (!drag.active) {
        if (Math.abs(dx) < 7 || Math.abs(dx) < Math.abs(dy) * 1.15) return;
        drag.active = true;
        mainChainSplit.classList.add("is-dragging");
        state.mainChainSplitSuppressClickUntil = Date.now() + 450;
      }
      event.preventDefault();
      mainChainSplit.scrollLeft = Math.min(drag.startScrollLeft - dx, getMainChainSplitLatestScrollLeft());
      state.mainChainSplitFollowLatest = isMainChainSplitAtLatest(0.5);
      updateMainChainSplitScrollButtons();
    }

    function finishMainChainSplitPointerDrag(event) {
      const drag = state.mainChainSplitDrag;
      if (!mainChainSplit || !drag || drag.pointerId !== event.pointerId) return;
      if (drag.active) {
        state.mainChainSplitSuppressClickUntil = Date.now() + 450;
      }
      state.mainChainSplitDrag = null;
      mainChainSplit.classList.remove("is-dragging");
      mainChainSplit.releasePointerCapture?.(event.pointerId);
      if (drag.active) {
        // Cancel any scheduled render that might reset scrollLeft
        if (state.mainChainSplitRenderFrame != null) {
          cancelAnimationFrame(state.mainChainSplitRenderFrame);
          state.mainChainSplitRenderFrame = null;
        }
        // Clear pending scroll render flag and ensure we don't snap to latest
        state.mainChainSplitPendingScrollRender = false;
        state.mainChainSplitFollowLatest = false;
        // Keep the virtual render scroll position in sync with the user's final position
        try {
          mainChainSplit.dataset.virtualRenderScrollLeft = String(Number(mainChainSplit.scrollLeft || 0));
        } catch (_) {}
        renderMainChainSplitPanel({ suppressFollowLatest: true });
      }
      updateMainChainSplitScrollButtons();
    }

    function jumpMainChainSplitToPreviousPeriod() {
      if (!mainChainSplit) return;
      const target = getMainChainSplitPreviousPeriodBoundary();
      if (!target) return;
      state.mainChainSplitHandlingScroll = true;
      state.mainChainSplitFollowLatest = false;
      mainChainSplit.scrollLeft = target.scrollLeft;
      renderMainChainSplitPanel({ suppressFollowLatest: true });
      mainChainSplit.scrollLeft = target.scrollLeft;
      requestAnimationFrame(() => {
        finishMainChainSplitHandlingScroll();
      });
    }

    function snapMainChainSplitToLatest() {
      state.mainChainSplitScrollAdjustment = null;
      state.mainChainSplitFollowLatest = true;
      renderMainChainSplitPanel();
      scrollMainChainSplitToLatest();
    }

    function renderBip110ChainSplitOverlay(options = {}) {
      if (!chainSplitContent) return;
      const maxScrollBefore = Math.max(0, chainSplitContent.scrollWidth - chainSplitContent.clientWidth);
      const shouldFollowLatest = !!options.forceFollowLatest || (
        !options.suppressFollowLatest
        && (maxScrollBefore <= 2 || state.chainSplitFollowLatest === true)
      );
      const model = getChainSplitModel();
      const legacyHeight = Number(model.legacyHeight);
      const bip110Height = Number(model.bip110Height);
      if (chainSplitLegacyHeightValue) {
        chainSplitLegacyHeightValue.textContent = formatChainSplitHeightKpi(legacyHeight, bip110Height);
      }
      if (chainSplitBip110HeightValue) {
        chainSplitBip110HeightValue.textContent = formatChainSplitHeightKpi(bip110Height, legacyHeight);
      }
      if (chainSplitStatusValue) {
        const nodeSync = getNodeSyncStatus(state.data?.metadata || state.dynamicData?.metadata || {});
        const demoOutOfSync = !!model.demoSplit;
        const nodeSyncText = demoOutOfSync ? "Out-of-sync" : nodeSync.ok === true ? "In-sync" : nodeSync.ok === false ? "Out-of-sync" : "unknown";
        const nodeSyncClass = demoOutOfSync ? "chip-value chip-value-alert" : nodeSync.ok === true ? "chip-value chip-value-ok" : nodeSync.ok === false ? "chip-value chip-value-alert" : "chip-value";
        chainSplitStatusValue.textContent = nodeSyncText;
        chainSplitStatusValue.className = nodeSyncClass;
        if (chainSplitStatusValue.parentElement) {
          setCustomTooltip(chainSplitStatusValue.parentElement, demoOutOfSync ? "Demo split mode is showing different legacy and BIP-110 branch tips." : nodeSync.tooltip);
        }
      }

      const metrics = getChainSplitLayoutMetrics();
      const {
        cubeSize,
        cubeDepth,
        gap,
        scale,
        labelOffset,
        startX,
        reservedHeight,
        straightHeight,
        straightY,
        splitY,
        bip110Y,
        legacyY,
      } = metrics;
      chainSplitContent.dataset.windowGap = String(gap);
      chainSplitContent.dataset.canPageEarlier = model.canPageEarlier ? "1" : "0";
      chainSplitContent.classList.toggle("is-split", !!model.splitDetected);
      updateChainSplitScrollButtons();

      if (model.splitDetected) {
        const trunk = model.trunkBlocks || [];
        const legacyBranch = model.legacyBranch || [];
        const bip110Branch = model.bip110Branch || [];
        if (!trunk.length && !legacyBranch.length && !bip110Branch.length) {
          chainSplitContent.innerHTML = `<div class="chain-split-empty">No BIP-110 block data is available for the split view.</div>`;
          return;
        }

        const trunkPositions = trunk.map((block, index) => ({
          block,
          nodeView: "legacy",
          x: startX + index * gap,
          y: splitY,
        }));
        const forkX = startX + Math.max(0, trunk.length - 1) * gap + gap;
        const bip110Positions = bip110Branch.map((block, index) => ({
          block,
          nodeView: "bip110",
          x: forkX + index * gap,
          y: bip110Y,
        }));
        const legacyPositions = legacyBranch.map((block, index) => ({
          block,
          nodeView: "legacy",
          x: forkX + index * gap,
          y: legacyY,
        }));
        const allPositions = [...trunkPositions, ...bip110Positions, ...legacyPositions];
        const longestTipX = allPositions.reduce((max, item) => Math.max(max, Number(item.x) || 0), startX);
        const currentRightPad = getChainSplitCurrentRightPad(cubeSize, cubeDepth, gap, { split: true });
        const width = Math.max(1120, longestTipX + currentRightPad);
        const height = reservedHeight;
        chainSplitContent.dataset.currentTipX = String(longestTipX);
        chainSplitContent.dataset.currentRightPad = String(currentRightPad);
        chainSplitContent.dataset.currentTipLocalPad = "0";
        chainSplitContent.dataset.virtualScrollSpace = "0";
        const preservedScrollLeft = Number(chainSplitContent.scrollLeft || 0);
        const cubes = allPositions.map((item) => renderChainSplitCube(item.block, item.x, item.y, { size: cubeSize, depth: cubeDepth, scale, labelOffset, nodeView: item.nodeView })).join("");
        const markers = [
          renderChainSplitPeriodMarkers(trunkPositions, { yTop: -1, yBottom: height + 1, cubeSize, cubeDepth }),
          renderChainSplitPeriodMarkers(bip110Positions, { yTop: -1, yBottom: height + 1, cubeSize, cubeDepth }),
          renderChainSplitPeriodMarkers(legacyPositions, { yTop: -1, yBottom: height + 1, cubeSize, cubeDepth }),
        ].join("");
        chainSplitContent.innerHTML = `<svg class="chain-split-svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="BIP-110 chain split visualization">${cubes}${markers}</svg>`;
        applyChainSplitPendingScrollAdjustment();
        if (shouldFollowLatest) scrollChainSplitToLatest();
        else {
          chainSplitContent.scrollLeft = clamp(preservedScrollLeft, 0, Math.max(0, chainSplitContent.scrollWidth - chainSplitContent.clientWidth));
        }
        return;
      }

      const rangeStart = Number.isFinite(model.rangeStart) ? model.rangeStart : NaN;
      const rangeEnd = Number.isFinite(model.rangeEnd) ? model.rangeEnd : NaN;
      if (!Number.isFinite(rangeStart) || !Number.isFinite(rangeEnd) || rangeEnd < rangeStart) {
        chainSplitContent.innerHTML = `<div class="chain-split-empty">No BIP-110 block data is available for the chain split view.</div>`;
        return;
      }
      const viewportClientWidth = Math.max(1, Number(chainSplitContent.clientWidth || 0));
      const viewportWidth = Math.max(980, viewportClientWidth);
      const totalBlockCount = Math.floor(rangeEnd - rangeStart + 1);
      const currentTipX = startX + Math.max(0, totalBlockCount - 1) * gap;
      const currentRightPad = getChainSplitCurrentRightPad(cubeSize, cubeDepth, gap);
      const localPad = Math.max(startX, gap);
      const targetStageWidth = Math.max(
        getChainSplitStageWidth(totalBlockCount, gap, startX, cubeSize, cubeDepth),
        currentTipX + localPad + currentRightPad
      );
      const latestScrollLeft = clamp(
        currentTipX - (viewportClientWidth - currentRightPad),
        0,
        Math.max(0, targetStageWidth - viewportClientWidth)
      );
      const targetScrollLeft = shouldFollowLatest
        ? latestScrollLeft
        : clamp(Number(chainSplitContent.scrollLeft || 0), 0, latestScrollLeft);
      const virtualRange = getChainSplitScrollRange(rangeStart, rangeEnd, gap, startX, cubeSize, cubeDepth, { scrollLeft: targetScrollLeft });
      if (!virtualRange) {
        chainSplitContent.innerHTML = `<div class="chain-split-empty">No BIP-110 block data is available for the chain split view.</div>`;
        return;
      }
      const positions = [];
      const viewportLeft = targetScrollLeft;
      const xOffset = Math.max(0, viewportLeft - localPad);
      for (let index = virtualRange.renderStartIndex; index <= virtualRange.renderEndIndex; index += 1) {
        const height = rangeStart + index;
        const block = model.straightMap?.get(height);
        const x = startX + index * gap - xOffset;
        const detailLoaded = index >= virtualRange.detailStartIndex && index <= virtualRange.detailEndIndex && block;
        positions.push({ height, block, x, y: straightY, detailLoaded });
      }
      const stageWidth = Math.max(virtualRange.width, targetStageWidth);
      const width = viewportWidth + localPad * 2;
      const height = straightHeight;
      chainSplitContent.dataset.currentTipX = String(currentTipX);
      chainSplitContent.dataset.currentRightPad = String(currentRightPad);
      chainSplitContent.dataset.currentTipLocalPad = String(localPad);
      chainSplitContent.dataset.virtualScrollSpace = "1";
      const markers = renderChainSplitVirtualMarkers(rangeStart, rangeEnd, virtualRange, metrics, model.straightNodeView, xOffset);
      const cubes = positions.map((item) => (
        item.detailLoaded
          ? renderChainSplitCube(item.block, item.x, item.y, { size: cubeSize, depth: cubeDepth, scale, labelOffset, nodeView: model.straightNodeView })
          : renderChainSplitPlaceholderCube(item.height, item.x, item.y, { size: cubeSize, depth: cubeDepth, scale, labelOffset })
      )).join("");
      const preservedScrollLeft = targetScrollLeft;
      chainSplitContent.innerHTML = `<div class="chain-split-virtual-stage" style="width:${stageWidth}px;height:${height}px"><svg class="chain-split-svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" style="left:${xOffset}px" role="img" aria-label="Latest BIP-110 signaling chain">${cubes}${markers}</svg></div>`;
      chainSplitContent.dataset.virtualRenderScrollLeft = String(preservedScrollLeft);
      if (shouldFollowLatest) {
        state.chainSplitHandlingScroll = true;
        chainSplitContent.scrollLeft = getChainSplitLatestScrollLeft();
        requestAnimationFrame(() => {
          finishChainSplitHandlingScroll();
          scrollChainSplitToLatest();
        });
      }
      else {
        state.chainSplitHandlingScroll = true;
        chainSplitContent.scrollLeft = clamp(preservedScrollLeft, 0, Math.max(0, chainSplitContent.scrollWidth - chainSplitContent.clientWidth));
        requestAnimationFrame(() => {
          finishChainSplitHandlingScroll();
        });
      }
      applyChainSplitPendingScrollAdjustment();
      updateChainSplitScrollButtons();
    }

    function applyChainSplitPendingScrollAdjustment() {
      if (!chainSplitContent || !state.chainSplitScrollAdjustment) return;
      const adjustment = state.chainSplitScrollAdjustment;
      state.chainSplitScrollAdjustment = null;
      requestAnimationFrame(() => {
        state.chainSplitHandlingScroll = true;
        const target = clamp(
          Number(adjustment.scrollLeft || 0),
          0,
          Math.max(0, chainSplitContent.scrollWidth - chainSplitContent.clientWidth)
        );
        chainSplitContent.scrollLeft = target;
        updateChainSplitScrollButtons();
        requestAnimationFrame(() => {
          finishChainSplitHandlingScroll();
        });
      });
    }

    function finishChainSplitHandlingScroll() {
      state.chainSplitHandlingScroll = false;
      updateChainSplitScrollButtons();
      if (!state.chainSplitPendingScrollRender || !isChainSplitOverlayOpen()) return;
      state.chainSplitPendingScrollRender = false;
      handleChainSplitScroll();
    }

    function scrollChainSplitToLatest() {
      if (!chainSplitContent) return;
      state.chainSplitFollowLatest = true;
      requestAnimationFrame(() => {
        state.chainSplitHandlingScroll = true;
        chainSplitContent.scrollLeft = getChainSplitLatestScrollLeft();
        updateChainSplitScrollButtons();
        requestAnimationFrame(() => {
          renderBip110ChainSplitOverlay({ suppressFollowLatest: true });
          chainSplitContent.scrollLeft = getChainSplitLatestScrollLeft();
          finishChainSplitHandlingScroll();
        });
      });
    }

    function handleChainSplitScroll() {
      if (!chainSplitContent) return;
      if (state.chainSplitHandlingScroll) {
        state.chainSplitPendingScrollRender = true;
        return;
      }
      if (clampChainSplitScrollToLatest()) {
        state.chainSplitFollowLatest = true;
        renderBip110ChainSplitOverlay({ suppressFollowLatest: true });
        return;
      }
      state.chainSplitFollowLatest = isChainSplitAtLatest(0.5);
      updateChainSplitScrollButtons();
      if (state.chainSplitDrag?.active) return;
      const renderScrollLeft = Number(chainSplitContent.dataset.virtualRenderScrollLeft);
      const gap = Number(chainSplitContent.dataset.windowGap || 0);
      if (!chainSplitContent.classList.contains("is-split")
        && Number.isFinite(renderScrollLeft)
        && Number.isFinite(gap)
        && gap > 0
        && Math.abs(Number(chainSplitContent.scrollLeft || 0) - renderScrollLeft) < gap * 0.5) {
        return;
      }
      if (state.chainSplitRenderFrame) return;
      state.chainSplitRenderFrame = requestAnimationFrame(() => {
        state.chainSplitRenderFrame = null;
        state.chainSplitFollowLatest = isChainSplitAtLatest(0.5);
        renderBip110ChainSplitOverlay({ suppressFollowLatest: !state.chainSplitFollowLatest });
        updateChainSplitScrollButtons();
      });
    }

    function handleChainSplitPointerDown(event) {
      if (!chainSplitContent || event.button !== 0) return;
      if (event.target instanceof Element && event.target.closest("button, input, select, textarea, a")) return;
      state.chainSplitDrag = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        startScrollLeft: Number(chainSplitContent.scrollLeft || 0),
        active: false,
      };
      chainSplitContent.setPointerCapture?.(event.pointerId);
    }

    function handleChainSplitPointerMove(event) {
      const drag = state.chainSplitDrag;
      if (!chainSplitContent || !drag || drag.pointerId !== event.pointerId) return;
      const dx = event.clientX - drag.startX;
      const dy = event.clientY - drag.startY;
      if (!drag.active) {
        if (Math.abs(dx) < 7 || Math.abs(dx) < Math.abs(dy) * 1.15) return;
        drag.active = true;
        chainSplitContent.classList.add("is-dragging");
        state.chainSplitSuppressClickUntil = Date.now() + 450;
      }
      event.preventDefault();
      chainSplitContent.scrollLeft = Math.min(drag.startScrollLeft - dx, getChainSplitLatestScrollLeft());
      state.chainSplitFollowLatest = isChainSplitAtLatest(0.5);
      updateChainSplitScrollButtons();
    }

    function finishChainSplitPointerDrag(event) {
      const drag = state.chainSplitDrag;
      if (!chainSplitContent || !drag || drag.pointerId !== event.pointerId) return;
      if (drag.active) {
        state.chainSplitSuppressClickUntil = Date.now() + 450;
      }
      state.chainSplitDrag = null;
      chainSplitContent.classList.remove("is-dragging");
      chainSplitContent.releasePointerCapture?.(event.pointerId);
      if (drag.active) {
        renderBip110ChainSplitOverlay({ suppressFollowLatest: true });
      }
      updateChainSplitScrollButtons();
    }

    function stopChainSplitDashboardSwipe(event) {
      event.stopPropagation();
      if (event.cancelable) {
        event.preventDefault();
      }
    }

    function snapChainSplitToLatest() {
      state.chainSplitScrollAdjustment = null;
      state.chainSplitFollowLatest = true;
      renderBip110ChainSplitOverlay();
      scrollChainSplitToLatest();
    }

    function jumpChainSplitToPreviousPeriod() {
      if (!chainSplitContent) return;
      const target = getChainSplitPreviousPeriodBoundary();
      if (!target) return;
      state.chainSplitHandlingScroll = true;
      state.chainSplitFollowLatest = false;
      chainSplitContent.scrollLeft = target.scrollLeft;
      renderBip110ChainSplitOverlay({ suppressFollowLatest: true });
      chainSplitContent.scrollLeft = target.scrollLeft;
      requestAnimationFrame(() => {
        finishChainSplitHandlingScroll();
      });
    }

    async function openChainSplitOverlay() {
      if (!chainSplitOverlay || !chainSplitDialog) return;
      closePeriodGridOverlay();
      closeLeaderboardOverlay();
      closeMinerTimelineOverlay();
      clearMobilePendingActivation();
      hideTooltip();
      hideCustomTooltip();
      hidePeriodGridTooltip();
      state.chainSplitFollowLatest = true;
      chainSplitOverlay.classList.add("is-loading");
      chainSplitOverlay.classList.add("show");
      chainSplitOverlay.setAttribute("aria-hidden", "false");
      await waitForMinerTimelineFeedbackPaint();
      if (!chainSplitOverlay.classList.contains("show")) return;
      renderBip110ChainSplitOverlay({ forceFollowLatest: true });
      updateChainSplitAgeLabels();
      startChainSplitAgeTimer();
      chainSplitOverlay.classList.remove("is-loading");
      chainSplitDialog.focus({ preventScroll: true });
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
      closeChainSplitOverlay();
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

    function showTooltip(content, clientX, clientY, boundsRect = null, options = {}) {
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
      const avoidPosition = getNonOverlappingTooltipPosition(tipW, tipH, options.avoidRect, bounds, 12);
      if (avoidPosition) {
        tooltip.style.left = `${avoidPosition.left}px`;
        tooltip.style.top = `${avoidPosition.top}px`;
        tooltip.style.transform = "none";
        tooltip.classList.add("show");
        return;
      }
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
            openBlockExplorer(h, nodeViewForPanelKey(key));
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

    async function loadAndApplyBlockDataPhased(loadToken, metadata, datasetKeys = ["segwit", "bip110", "bip110Node"], cacheBust = null, options = {}) {
      const renderAfterEach = options.renderAfterEach !== false;
      const applyBlocks = async (key, blocks, applyOptions = {}) => {
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
          if (applyOptions.reconcile !== false) {
            state.dynamicData = reconcileBip110PeriodsFromBlocks(state.dynamicData, metadata);
          }
        }

        state.data = buildCombinedData(state.staticData, state.dynamicData, state.data);
        if (applyOptions.reconcile !== false) {
          setStatus(state.data);
        }
        if (renderAfterEach) {
          await renderSelectedPanelsWithSharedLoader(key === "bip110" || key === "bip110Node" ? BIP110_PANEL_KEYS : [key]);
          if ((key === "bip110" || key === "bip110Node") && isMainChainPanelVisible()) {
            renderMainChainSplitPanel({ forceFollowLatest: true });
          }
          await nextPaint();
        }
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
      if (datasetKeys.some((key) => key === "bip110" || key === "bip110Node")) {
        state.mainChainSplitDataReady = true;
        syncMainChainPanelVisibility();
        applyPanelOrder();
        applyDynamicPanelHeights();
        setDashboardLoaderVisible(false);
        renderMainChainSplitPanel({ forceFollowLatest: true });
        renderSelectedPanels(PANEL_KEYS);
        await nextPaint();
      }
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
          periods: getBip110PeriodsForNodeView("bip110"),
          blocks: getBip110BlocksForNodeView("bip110"),
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
      renderMainChainSplitPanel({ forceFollowLatest: true });
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
      if (isMainChainPanelVisible()) {
        if (options.followLatestChainSplit) {
          state.mainChainSplitFollowLatest = true;
        }
        renderMainChainSplitPanel({ forceFollowLatest: !!options.followLatestChainSplit });
      }
      if (isChainSplitOverlayOpen()) {
        hidePeriodGridTooltip();
        if (options.followLatestChainSplit) {
          state.chainSplitFollowLatest = true;
        }
        renderBip110ChainSplitOverlay({ forceFollowLatest: !!options.followLatestChainSplit });
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
      setCustomTooltip(chainSplitBtn, "Show chain split view");

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

      mainChainViewToggle?.addEventListener("change", () => {
        state.controls.showMainChainView = mainChainViewToggle.checked;
        state.mainChainSplitFollowLatest = true;
        syncMainChainPanelVisibility();
        applyPanelOrder();
        applyDynamicPanelHeights();
        renderMainChainSplitPanel({ forceFollowLatest: true });
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

      chainSplitBtn?.addEventListener("click", () => {
        if (!state.data) return;
        openChainSplitOverlay();
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

      minerTimelineShowChainView?.addEventListener("change", () => {
        state.minerTimelineShowChainView = minerTimelineShowChainView.checked;
        state.minerTimelineChainSplitFollowLatest = true;
        persistBip110OverlaySelections();
        renderMinerTimelineMiniChainSplit({ forceFollowLatest: true });
      });

      window.addEventListener("keydown", handlePeriodGridModalKeydown, true);

      window.addEventListener("resize", () => {
        if (!isChainSplitOverlayOpen()) return;
        renderBip110ChainSplitOverlay({ suppressFollowLatest: !state.chainSplitFollowLatest });
      });

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
              openBlockExplorer(height, cell.getAttribute("data-node-view"));
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
          openBlockExplorer(height, cell.getAttribute("data-node-view"));
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
          ? event.target.closest(".miner-timeline-block, .miner-timeline-latest-block, .miner-timeline-chain-split-cube")
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
        const isChainCube = mark.classList.contains("miner-timeline-chain-split-cube");
        showPeriodGridTooltip(content, event.clientX, event.clientY, {
          constrainToGrid: false,
          avoidRect: isChainCube ? mark.getBoundingClientRect() : null,
        });
      });

      minerTimelineOverlay?.addEventListener("mouseleave", () => {
        hidePeriodGridTooltip();
      });

      minerTimelineOverlay?.addEventListener("click", (event) => {
        if (Date.now() < state.minerTimelineChainSplitSuppressClickUntil
          && event.target instanceof Element
          && event.target.closest(".miner-timeline-chain-split")) {
          event.preventDefault();
          event.stopPropagation();
          return;
        }
        const mark = event.target instanceof Element
          ? event.target.closest(".miner-timeline-block, .miner-timeline-latest-block, .miner-timeline-chain-split-cube")
          : null;
        if (mark) {
          const height = Number(mark.getAttribute("data-height"));
          if (Number.isFinite(height) && shouldDeferMobileActivation("miner-timeline-block", height)) {
            const content = String(mark.getAttribute("data-tooltip") || "").trim();
            if (content) {
              const isChainCube = mark.classList.contains("miner-timeline-chain-split-cube");
              showPeriodGridTooltip(content, event.clientX, event.clientY, {
                constrainToGrid: false,
                avoidRect: isChainCube ? mark.getBoundingClientRect() : null,
              });
            }
            return;
          }
          if (Number.isFinite(height)) {
            openBlockExplorer(height, mark.getAttribute("data-node-view"));
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
          ? event.target.closest(".miner-timeline-block, .miner-timeline-latest-block, .miner-timeline-chain-split-cube")
          : null;
        if (!mark) return;
        event.preventDefault();
        const height = Number(mark.getAttribute("data-height"));
        if (Number.isFinite(height)) {
          openBlockExplorer(height, mark.getAttribute("data-node-view"));
        }
      });

      minerTimelineClose?.addEventListener("click", () => {
        closeMinerTimelineOverlay();
      });

      minerTimelineOverlay?.addEventListener("error", (event) => {
        const image = event.target instanceof Element
          ? event.target.closest(".miner-timeline-chain-split-miner-icon")
          : null;
        if (!image) return;
        const cube = image.closest(".miner-timeline-chain-split-cube");
        const slug = String(cube?.getAttribute("data-miner-slug") || "").trim().toLowerCase();
        if (slug) missingMinerIconSlugs.add(slug);
        image.setAttribute("href", "assets/mining-pools/default.svg");
      }, true);

      minerTimelineChainSplit?.addEventListener("scroll", handleMinerTimelineMiniChainScroll, { passive: true });
      minerTimelineChainSplit?.addEventListener("pointerdown", handleMinerTimelineMiniChainPointerDown);
      minerTimelineChainSplit?.addEventListener("pointermove", handleMinerTimelineMiniChainPointerMove);
      minerTimelineChainSplit?.addEventListener("pointerup", finishMinerTimelineMiniChainPointerDrag);
      minerTimelineChainSplit?.addEventListener("pointercancel", finishMinerTimelineMiniChainPointerDrag);

      minerTimelineChainSplitPeriodBack?.addEventListener("click", () => {
        jumpMinerTimelineMiniChainToPreviousPeriod();
      });

      minerTimelineChainSplitSnapLatest?.addEventListener("click", () => {
        snapMinerTimelineMiniChainToLatest();
      });

      mainChainSplit?.addEventListener("mousemove", (event) => {
        const cube = event.target instanceof Element
          ? event.target.closest(".miner-timeline-chain-split-cube")
          : null;
        if (!cube) {
          hideTooltip();
          return;
        }
        const content = String(cube.getAttribute("data-tooltip") || "").trim();
        if (!content) {
          hideTooltip();
          return;
        }
        showTooltip(content, event.clientX, event.clientY, mainChainSplit.getBoundingClientRect(), {
          avoidRect: cube.getBoundingClientRect(),
        });
      });

      mainChainSplit?.addEventListener("mouseleave", () => {
        hideTooltip();
      });

      mainChainSplit?.addEventListener("click", (event) => {
        if (Date.now() < state.mainChainSplitSuppressClickUntil) {
          event.preventDefault();
          event.stopPropagation();
          return;
        }
        const cube = event.target instanceof Element
          ? event.target.closest(".miner-timeline-chain-split-cube")
          : null;
        if (!cube) return;
        const height = Number(cube.getAttribute("data-height"));
        if (Number.isFinite(height)) {
          openBlockExplorer(height, cube.getAttribute("data-node-view"));
        }
      });

      mainChainSplit?.addEventListener("error", (event) => {
        const image = event.target instanceof Element
          ? event.target.closest(".miner-timeline-chain-split-miner-icon")
          : null;
        if (!image) return;
        const cube = image.closest(".miner-timeline-chain-split-cube");
        const slug = String(cube?.getAttribute("data-miner-slug") || "").trim().toLowerCase();
        if (slug) missingMinerIconSlugs.add(slug);
        image.setAttribute("href", "assets/mining-pools/default.svg");
      }, true);

      mainChainSplit?.addEventListener("scroll", handleMainChainSplitScroll, { passive: true });
      mainChainSplit?.addEventListener("pointerdown", handleMainChainSplitPointerDown);
      mainChainSplit?.addEventListener("pointermove", handleMainChainSplitPointerMove);
      mainChainSplit?.addEventListener("pointerup", finishMainChainSplitPointerDrag);
      mainChainSplit?.addEventListener("pointercancel", finishMainChainSplitPointerDrag);

      mainChainSplitPeriodBack?.addEventListener("click", () => {
        jumpMainChainSplitToPreviousPeriod();
      });

      mainChainSplitSnapLatest?.addEventListener("click", () => {
        snapMainChainSplitToLatest();
      });

      chainSplitOverlay?.addEventListener("mousemove", (event) => {
        const cube = event.target instanceof Element
          ? event.target.closest(".chain-split-cube")
          : null;
        if (!cube) {
          hidePeriodGridTooltip();
          return;
        }
        const content = String(cube.getAttribute("data-tooltip") || "").trim();
        if (!content) {
          hidePeriodGridTooltip();
          return;
        }
        showPeriodGridTooltip(content, event.clientX, event.clientY, {
          constrainToGrid: false,
          avoidRect: cube.getBoundingClientRect(),
        });
      });

      chainSplitOverlay?.addEventListener("mouseleave", () => {
        hidePeriodGridTooltip();
      });

      chainSplitOverlay?.addEventListener("click", (event) => {
        if (Date.now() < state.chainSplitSuppressClickUntil) {
          event.preventDefault();
          event.stopPropagation();
          return;
        }
        const cube = event.target instanceof Element
          ? event.target.closest(".chain-split-cube")
          : null;
        if (cube) {
          const height = Number(cube.getAttribute("data-height"));
          if (Number.isFinite(height) && shouldDeferMobileActivation("chain-split-block", height)) {
            const content = String(cube.getAttribute("data-tooltip") || "").trim();
            if (content) {
              showPeriodGridTooltip(content, event.clientX, event.clientY, {
                constrainToGrid: false,
                avoidRect: cube.getBoundingClientRect(),
              });
            }
            return;
          }
          if (Number.isFinite(height)) {
            openBlockExplorer(height, cube.getAttribute("data-node-view"));
          }
          return;
        }

        if (event.target === chainSplitOverlay) {
          clearMobilePendingActivation();
          closeChainSplitOverlay();
        }
      });

      chainSplitOverlay?.addEventListener("keydown", (event) => {
        if (event.key === "Escape") {
          closeChainSplitOverlay();
          return;
        }

        if (event.key !== "Enter" && event.key !== " ") return;
        const cube = event.target instanceof Element
          ? event.target.closest(".chain-split-cube")
          : null;
        if (!cube) return;
        event.preventDefault();
        const height = Number(cube.getAttribute("data-height"));
        if (Number.isFinite(height)) {
          openBlockExplorer(height, cube.getAttribute("data-node-view"));
        }
      });

      chainSplitClose?.addEventListener("click", () => {
        closeChainSplitOverlay();
      });

      chainSplitContent?.addEventListener("scroll", handleChainSplitScroll, { passive: true });
      chainSplitContent?.addEventListener("pointerdown", handleChainSplitPointerDown);
      chainSplitContent?.addEventListener("pointermove", handleChainSplitPointerMove);
      chainSplitContent?.addEventListener("pointerup", finishChainSplitPointerDrag);
      chainSplitContent?.addEventListener("pointercancel", finishChainSplitPointerDrag);
      chainSplitContent?.addEventListener("touchstart", stopChainSplitDashboardSwipe, { capture: true, passive: false });
      chainSplitContent?.addEventListener("touchmove", stopChainSplitDashboardSwipe, { capture: true, passive: false });
      chainSplitContent?.addEventListener("touchend", stopChainSplitDashboardSwipe, { capture: true, passive: false });

      chainSplitPeriodBack?.addEventListener("click", () => {
        jumpChainSplitToPreviousPeriod();
      });

      chainSplitSnapLatest?.addEventListener("click", () => {
        snapChainSplitToLatest();
      });

      chainSplitOverlay?.addEventListener("error", (event) => {
        const image = event.target instanceof Element
          ? event.target.closest(".chain-split-miner-icon")
          : null;
        if (!image) return;
        const cube = image.closest(".chain-split-cube");
        const slug = String(cube?.getAttribute("data-miner-slug") || "").trim().toLowerCase();
        if (slug) missingMinerIconSlugs.add(slug);
        image.setAttribute("href", "assets/mining-pools/default.svg");
      }, true);

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
