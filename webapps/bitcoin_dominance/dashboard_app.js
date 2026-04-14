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
      if (state.datasets) renderAll();
    });
    /* ────────────────────────────────────────────────────────────────── */
    const DASHBOARD_TIME = window.WSBDashboardTime || null;
    const LAYOUT_STORAGE_KEY = 'bitcoin_dominance_layout_v1';
    const CONTROLS_STORAGE_KEY = 'bitcoin_dominance_controls_v1';
    const AUTO_REFRESH_MS = 60000;
    const FORCE_REFRESH_MS = 3600000;
    const IS_CARD_PREVIEW = document.documentElement.classList.contains('card-preview');
    const FETCH_CACHE_MODE = IS_CARD_PREVIEW ? 'force-cache' : 'no-store';
    // Bust the cache once per UTC day in card-preview so data is never more than 24 h stale.
    const CARD_PREVIEW_CACHE_BUST = IS_CARD_PREVIEW
      ? new Date().toISOString().slice(0, 10).replace(/-/g, '')
      : null;
    const MOBILE_STACK_BREAKPOINT = 1100;
    const PANEL_SPLIT_MIN = 34;
    const PANEL_SPLIT_MAX = 72;
    const PANEL_SPLIT_CENTER = 50;
    const PANEL_SPLIT_SNAP_DISTANCE = 1.2;
    const STACKED_HISTORY_MIN_HEIGHT = 240;
    const STACKED_SNAPSHOT_MIN_HEIGHT = 260;
    const STACKED_HISTORY_DEFAULT_RATIO = 0.56;
    const PLOTLY_LIVE_BG = 'rgba(0,0,0,0)';
    const PLOTLY_EXPORT_BG = '#000';
    const STABLE_USD_GREEN = '#35b56a';
    const SHARE_STATE_PARAM = 'state';
    const LOCAL_RUNTIME_HOSTS = new Set(['localhost', '127.0.0.1', '::1']);
    const IS_LOCAL_RUNTIME = LOCAL_RUNTIME_HOSTS.has(window.location.hostname);
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
    // Hide tiny positive values that round to 0.00% in tooltip/display.
    const STABLE_MIN_PCT_FOR_PLOT = 0.01;

    function isMobileUiViewport() {
      return window.matchMedia('(max-width: 820px)').matches;
    }

    function setCustomTooltip(el, text) {
      if (!el) return;
      const value = String(text || '').trim();
      if (value) {
        el.setAttribute('data-tooltip', value);
      } else {
        el.removeAttribute('data-tooltip');
      }
      el.removeAttribute('title');
    }

    let customTooltipBound = false;
    let customTooltipAnchor = null;

    function ensureCustomTooltipElement() {
      let tooltip = document.getElementById('dashboardInlineTooltip');
      if (!tooltip) {
        tooltip = document.createElement('div');
        tooltip.id = 'dashboardInlineTooltip';
        tooltip.className = 'dashboard-inline-tooltip';
        document.body.appendChild(tooltip);
      }
      return tooltip;
    }

    function hideCustomTooltip() {
      const tooltip = document.getElementById('dashboardInlineTooltip');
      if (!tooltip) return;
      tooltip.classList.remove('is-visible');
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
      const text = String(anchor?.getAttribute('data-tooltip') || '').trim();
      if (!text) {
        hideCustomTooltip();
        return;
      }

      const tooltip = ensureCustomTooltipElement();
      tooltip.textContent = text;
      tooltip.classList.add('is-visible');
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
        if (!anchor) return true;
        if (!isMobileUiViewport()) return false;
        if (anchor instanceof Element && anchor.closest('#scriptBars .bar-stack-track')) {
          return false;
        }
        if (
          anchor instanceof HTMLElement
          && anchor.classList.contains('tag')
          && (anchor.classList.contains('tag-spend-never')
            || anchor.classList.contains('tag-spend-inactive')
            || anchor.classList.contains('tag-spend-active'))
        ) {
          return false;
        }
        return !(anchor instanceof HTMLElement && anchor.disabled);
      };

      document.addEventListener('mouseover', (event) => {
        const anchor = event.target instanceof Element ? event.target.closest('[data-tooltip]') : null;
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

      document.addEventListener('mousemove', (event) => {
        if (!customTooltipAnchor) return;
        const tooltip = document.getElementById('dashboardInlineTooltip');
        if (!tooltip || !tooltip.classList.contains('is-visible')) return;
        placeCustomTooltip(tooltip, event.clientX, event.clientY);
      });

      document.addEventListener('mouseout', (event) => {
        if (!customTooltipAnchor) return;
        const related = event.relatedTarget;
        if (related instanceof Node && customTooltipAnchor.contains(related)) return;
        customTooltipAnchor = null;
        clearMobileTooltipHideTimer();
        hideCustomTooltip();
      });

      document.addEventListener('touchstart', (event) => {
        const anchor = event.target instanceof Element ? event.target.closest('[data-tooltip]') : null;
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

      window.addEventListener('scroll', () => {
        if (!customTooltipAnchor) return;
        clearMobileTooltipHideTimer();
        hideCustomTooltip();
      }, { passive: true });
    }
    function getPlotlyHoverlabel() {
      const style = getComputedStyle(document.documentElement);
      const isLight = document.documentElement.dataset.theme === 'light';
      return {
        bgcolor: style.getPropertyValue('--panel').trim() || (isLight ? '#ffffff' : '#000000'),
        bordercolor: isLight ? 'rgba(0, 0, 0, 0.12)' : '#223038',
        font: {
          family: 'IBM Plex Mono, monospace',
          color: style.getPropertyValue('--fg').trim() || (isLight ? '#1c1b19' : '#e9f1f5'),
          size: 12,
        },
        align: 'left',
      };
    }

    const state = {
      staticMeta: null,
      includeStables: true,
      topN: 10,
      stackedDominance: true,
      showPrice: false,
      stackedDominanceTouched: false,
      range: '365',
      smooth: '7',
      panelsSwapped: false,
      showHistoryPanel: true,
      showSnapshotPanel: true,
      historyPanelPercent: 61.54,
      historyPanelManualHeight: 0,
      snapshotPanelManualHeight: 0,
      historyUserXAxisRange: null,
      refreshedAtText: '',
      timeZone: DASHBOARD_TIME?.getPreferredTimeZone?.() || 'UTC',
      preResetStateSnapshot: null,
      suppressResetSnapshotClear: false,
      autoRefreshTimer: null,
      refreshInFlight: false,
      lastSuccessfulRefreshAt: 0,
      dataSignature: '',
      priceHistory: [],
      datasets: {
        excl: {
          history: [],
          snapshot: [],
        },
        incl: {
          history: [],
          snapshot: [],
        },
      },
    };

    let snapshotResizeObserver = null;
    let snapshotResizeFrame = 0;
    let lastSnapshotChartSize = { width: 0, height: 0 };
    const snapshotCircularIconCache = new Map();
    const snapshotCircularIconPending = new Set();

    function getCircularSnapshotIconSource(iconUrl) {
      const href = String(iconUrl || '').trim();
      if (!href) return null;

      const resolvedHref = new URL(href, window.location.href).href;
      const cached = snapshotCircularIconCache.get(resolvedHref);
      if (cached) return cached;

      if (!snapshotCircularIconPending.has(resolvedHref)) {
        snapshotCircularIconPending.add(resolvedHref);
        const img = new window.Image();
        img.decoding = 'async';
        img.onload = () => {
          try {
            const naturalWidth = Math.max(1, Number(img.naturalWidth) || 1);
            const naturalHeight = Math.max(1, Number(img.naturalHeight) || 1);
            const side = Math.max(1, Math.min(naturalWidth, naturalHeight));
            const sx = Math.max(0, (naturalWidth - side) / 2);
            const sy = Math.max(0, (naturalHeight - side) / 2);

            const canvas = document.createElement('canvas');
            canvas.width = side;
            canvas.height = side;
            const ctx = canvas.getContext('2d');

            if (!ctx) {
              snapshotCircularIconCache.set(resolvedHref, resolvedHref);
            } else {
              ctx.beginPath();
              ctx.arc(side / 2, side / 2, side / 2, 0, Math.PI * 2);
              ctx.closePath();
              ctx.clip();
              ctx.drawImage(img, sx, sy, side, side, 0, 0, side, side);
              snapshotCircularIconCache.set(resolvedHref, canvas.toDataURL('image/png'));
            }
          } catch (_err) {
            snapshotCircularIconCache.set(resolvedHref, resolvedHref);
          } finally {
            snapshotCircularIconPending.delete(resolvedHref);
            scheduleSnapshotChartRender(true);
          }
        };
        img.onerror = () => {
          snapshotCircularIconCache.set(resolvedHref, resolvedHref);
          snapshotCircularIconPending.delete(resolvedHref);
          scheduleSnapshotChartRender(true);
        };
        img.src = resolvedHref;
      }

      return resolvedHref;
    }

    function isStackedLayout() {
      return window.matchMedia(`(max-width: ${MOBILE_STACK_BREAKPOINT}px)`).matches;
    }

    function applyCenterSnap(percent) {
      return Math.abs(percent - PANEL_SPLIT_CENTER) <= PANEL_SPLIT_SNAP_DISTANCE
        ? PANEL_SPLIT_CENTER
        : percent;
    }

    function loadLayoutFromStorage() {
      try {
        const raw = localStorage.getItem(LAYOUT_STORAGE_KEY);
        if (!raw) return;
        const parsed = JSON.parse(raw);
        const historyPanelPercent = Number(parsed.historyPanelPercent);
        const historyPanelManualHeight = Number(parsed.historyPanelManualHeight);
        const snapshotPanelManualHeight = Number(parsed.snapshotPanelManualHeight);

        if (Number.isFinite(historyPanelPercent)) {
          state.historyPanelPercent = clamp(historyPanelPercent, PANEL_SPLIT_MIN, PANEL_SPLIT_MAX);
        }
        if (Number.isFinite(historyPanelManualHeight) && historyPanelManualHeight > 0) {
          state.historyPanelManualHeight = historyPanelManualHeight;
        }
        if (Number.isFinite(snapshotPanelManualHeight) && snapshotPanelManualHeight > 0) {
          state.snapshotPanelManualHeight = snapshotPanelManualHeight;
        }
      } catch (_) {
      }
    }

    function saveLayoutToStorage() {
      try {
        const payload = {
          historyPanelPercent: Number(state.historyPanelPercent),
          historyPanelManualHeight: Number(state.historyPanelManualHeight),
          snapshotPanelManualHeight: Number(state.snapshotPanelManualHeight),
        };
        localStorage.setItem(LAYOUT_STORAGE_KEY, JSON.stringify(payload));
        if (!state.suppressResetSnapshotClear) {
          clearPreResetSnapshot();
        }
      } catch (_) {
      }
    }

    function loadControlsFromStorage() {
      try {
        const raw = localStorage.getItem(CONTROLS_STORAGE_KEY);
        if (!raw) return;
        const parsed = JSON.parse(raw);
        const includeStables = parsed.includeStables;
        const stackedDominance = parsed.stackedDominance;
        const showPrice = parsed.showPrice;
        const stackedDominanceTouched = parsed.stackedDominanceTouched;
        const showHistoryPanel = parsed.showHistoryPanel;
        const showSnapshotPanel = parsed.showSnapshotPanel;
        const range = String(parsed.range || '').trim();
        const smooth = String(parsed.smooth || '').trim();
        const panelsSwapped = parsed.panelsSwapped;
        const timeZone = String(parsed.timeZone || '').trim();

        if (typeof includeStables === 'boolean') {
          state.includeStables = includeStables;
        }
        if (typeof stackedDominance === 'boolean') {
          // Preserve default checked behavior unless the user explicitly changed this toggle.
          if (stackedDominanceTouched === true || stackedDominance === true) {
            state.stackedDominance = stackedDominance;
          }
        }
        if (typeof showPrice === 'boolean') {
          state.showPrice = showPrice;
        }
        if (stackedDominanceTouched === true) {
          state.stackedDominanceTouched = true;
        }
        if (typeof showHistoryPanel === 'boolean') {
          state.showHistoryPanel = showHistoryPanel;
        }
        if (typeof showSnapshotPanel === 'boolean') {
          state.showSnapshotPanel = showSnapshotPanel;
        }
        if (['30', '90', '180', '365', '0'].includes(range)) {
          state.range = range;
        }
        if (['1', '7', '30'].includes(smooth)) {
          state.smooth = smooth;
        }
        if (typeof panelsSwapped === 'boolean') {
          state.panelsSwapped = panelsSwapped;
        }
        // Keep at least one panel visible.
        if (!state.showHistoryPanel && !state.showSnapshotPanel) {
          state.showHistoryPanel = true;
        }
        if (timeZone) {
          state.timeZone = timeZone;
        }
      } catch (_) {
      }
    }

    function saveControlsToStorage() {
      try {
        const payload = {
          includeStables: Boolean(state.includeStables),
          stackedDominance: Boolean(state.stackedDominance),
          showPrice: Boolean(state.showPrice),
          stackedDominanceTouched: Boolean(state.stackedDominanceTouched),
          showHistoryPanel: Boolean(state.showHistoryPanel),
          showSnapshotPanel: Boolean(state.showSnapshotPanel),
          range: String(state.range || '365'),
          smooth: String(state.smooth || '7'),
          panelsSwapped: Boolean(state.panelsSwapped),
          timeZone: String(state.timeZone || 'UTC'),
        };
        localStorage.setItem(CONTROLS_STORAGE_KEY, JSON.stringify(payload));
        if (!state.suppressResetSnapshotClear) {
          clearPreResetSnapshot();
        }
      } catch (_) {
      }
    }

    function encodeShareState(payload) {
      try {
        const json = JSON.stringify(payload);
        const bytes = new TextEncoder().encode(json);
        let binary = '';
        bytes.forEach((byte) => {
          binary += String.fromCharCode(byte);
        });
        return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
      } catch (_) {
        return '';
      }
    }

    function decodeShareState(rawValue) {
      if (!rawValue) return null;
      try {
        const normalized = rawValue.replace(/-/g, '+').replace(/_/g, '/');
        const paddingLength = (4 - (normalized.length % 4)) % 4;
        const padded = normalized + '='.repeat(paddingLength);
        const binary = atob(padded);
        const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
        const json = new TextDecoder().decode(bytes);
        const parsed = JSON.parse(json);
        return parsed && typeof parsed === 'object' ? parsed : null;
      } catch (_) {
        return null;
      }
    }

    function getShareRouteBaseUrl() {
      const path = String(window.location.pathname || '');
      const dashboardMatch = path.match(/^(.*)\/webapps\/bitcoin_dominance\/dashboard\.html$/i);
      const basePath = dashboardMatch ? (dashboardMatch[1] || '') : path.replace(/\/[^/]*$/, '');
      if (IS_LOCAL_RUNTIME) {
        return `${window.location.origin}${basePath}/bitcoin_dominance.html`;
      }
      return `${window.location.origin}${basePath}/bitcoin_dominance`;
    }

    function buildShareableDashboardUrl() {
      const defaults = {
        includeStables: true,
        stackedDominance: true,
        showPrice: false,
        stackedDominanceTouched: false,
        range: '365',
        smooth: '7',
        panelsSwapped: false,
        showHistoryPanel: true,
        showSnapshotPanel: true,
        historyPanelPercent: 61.54,
        historyPanelManualHeight: 0,
        snapshotPanelManualHeight: 0,
        historyUserXAxisRange: null,
        timeZone: 'UTC',
      };

      const payload = {
        includeStables: Boolean(state.includeStables),
        stackedDominance: Boolean(state.stackedDominance),
        showPrice: Boolean(state.showPrice),
        stackedDominanceTouched: Boolean(state.stackedDominanceTouched),
        range: String(state.range || '365'),
        smooth: String(state.smooth || '7'),
        panelsSwapped: Boolean(state.panelsSwapped),
        showHistoryPanel: Boolean(state.showHistoryPanel),
        showSnapshotPanel: Boolean(state.showSnapshotPanel),
        historyPanelPercent: Number(state.historyPanelPercent || 61.54),
        historyPanelManualHeight: Number(state.historyPanelManualHeight || 0),
        snapshotPanelManualHeight: Number(state.snapshotPanelManualHeight || 0),
        historyUserXAxisRange: Array.isArray(state.historyUserXAxisRange)
          ? state.historyUserXAxisRange.slice()
          : null,
        timeZone: String(state.timeZone || 'UTC'),
      };

      const compactPayload = {};
      Object.entries(payload).forEach(([key, value]) => {
        const def = defaults[key];
        const sameArray = Array.isArray(def)
          ? Array.isArray(value) && def.length === value.length && def.every((entry, idx) => entry === value[idx])
          : false;
        if (sameArray || value === def) return;
        compactPayload[key] = value;
      });

      const shareUrl = new URL(getShareRouteBaseUrl());
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
      const params = new URLSearchParams(window.location.search || '');
      const decoded = decodeShareState(params.get(SHARE_STATE_PARAM) || '');
      if (!decoded) return;

      if (typeof decoded.includeStables === 'boolean') state.includeStables = decoded.includeStables;
      if (typeof decoded.stackedDominance === 'boolean') state.stackedDominance = decoded.stackedDominance;
      if (typeof decoded.showPrice === 'boolean') state.showPrice = decoded.showPrice;
      if (typeof decoded.stackedDominanceTouched === 'boolean') state.stackedDominanceTouched = decoded.stackedDominanceTouched;
      if (['30', '90', '180', '365', '0'].includes(String(decoded.range || ''))) state.range = String(decoded.range);
      if (['1', '7', '30'].includes(String(decoded.smooth || ''))) state.smooth = String(decoded.smooth);
      if (typeof decoded.panelsSwapped === 'boolean') state.panelsSwapped = decoded.panelsSwapped;
      if (typeof decoded.showHistoryPanel === 'boolean') state.showHistoryPanel = decoded.showHistoryPanel;
      if (typeof decoded.showSnapshotPanel === 'boolean') state.showSnapshotPanel = decoded.showSnapshotPanel;
      if (!state.showHistoryPanel && !state.showSnapshotPanel) state.showHistoryPanel = true;

      const historyPanelPercent = Number(decoded.historyPanelPercent);
      if (Number.isFinite(historyPanelPercent)) {
        state.historyPanelPercent = clamp(historyPanelPercent, PANEL_SPLIT_MIN, PANEL_SPLIT_MAX);
      }

      const historyPanelManualHeight = Number(decoded.historyPanelManualHeight);
      if (Number.isFinite(historyPanelManualHeight) && historyPanelManualHeight >= 0) {
        state.historyPanelManualHeight = historyPanelManualHeight;
      }

      const snapshotPanelManualHeight = Number(decoded.snapshotPanelManualHeight);
      if (Number.isFinite(snapshotPanelManualHeight) && snapshotPanelManualHeight >= 0) {
        state.snapshotPanelManualHeight = snapshotPanelManualHeight;
      }

      if (Array.isArray(decoded.historyUserXAxisRange) && decoded.historyUserXAxisRange.length === 2) {
        state.historyUserXAxisRange = decoded.historyUserXAxisRange.slice();
      }

      const timeZone = String(decoded.timeZone || '').trim();
      if (timeZone) {
        state.timeZone = DASHBOARD_TIME?.setPreferredTimeZone?.(timeZone) || timeZone;
      }
    }

    async function copyDashboardLinkToClipboard(buttonEl) {
      const link = buildShareableDashboardUrl();
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(link);
      } else {
        const textArea = document.createElement('textarea');
        textArea.value = link;
        textArea.setAttribute('readonly', 'readonly');
        textArea.style.position = 'absolute';
        textArea.style.left = '-9999px';
        document.body.appendChild(textArea);
        textArea.select();
        document.execCommand('copy');
        document.body.removeChild(textArea);
      }

      if (!buttonEl) return;
      const labelEl = buttonEl.querySelector('.btn-label');
      const original = labelEl ? labelEl.textContent : buttonEl.textContent;
      if (buttonEl.__copyFeedbackTimer) {
        window.clearTimeout(buttonEl.__copyFeedbackTimer);
      }
      buttonEl.classList.add('copy-link-btn--copied');
      setButtonIcon('copyDashboardIcon', ICONS.copyCopied);
      if (labelEl) labelEl.textContent = 'Copied!';
      else buttonEl.textContent = 'Copied!';
      buttonEl.__copyFeedbackTimer = window.setTimeout(() => {
        setButtonIcon('copyDashboardIcon', ICONS.copyLink);
        if (labelEl) labelEl.textContent = original || 'Copy Link';
        else buttonEl.textContent = original || 'Copy Link';
        buttonEl.classList.remove('copy-link-btn--copied');
        buttonEl.__copyFeedbackTimer = null;
      }, 1400);
    }

    function captureResetSnapshot() {
      const includeStablesToggle = document.getElementById('toggleIncludeStables');
      const stackedDominanceToggle = document.getElementById('toggleStackedDominance');
      const showPriceToggle = document.getElementById('toggleShowPrice');
      const historyToggle = document.getElementById('toggleHistoryPanel');
      const snapshotToggle = document.getElementById('toggleSnapshotPanel');
      return {
        includeStables: Boolean(state.includeStables),
        stackedDominance: Boolean(state.stackedDominance),
        showPrice: Boolean(state.showPrice),
        stackedDominanceTouched: Boolean(state.stackedDominanceTouched),
        range: String(state.range || '365'),
        smooth: String(state.smooth || '7'),
        panelsSwapped: Boolean(state.panelsSwapped),
        showHistoryPanel: Boolean(state.showHistoryPanel),
        showSnapshotPanel: Boolean(state.showSnapshotPanel),
        historyPanelPercent: Number(state.historyPanelPercent),
        historyPanelManualHeight: Number(state.historyPanelManualHeight),
        snapshotPanelManualHeight: Number(state.snapshotPanelManualHeight),
        historyUserXAxisRange: Array.isArray(state.historyUserXAxisRange) ? state.historyUserXAxisRange.slice() : state.historyUserXAxisRange,
        timeZone: String(state.timeZone || 'UTC'),
        checkboxState: {
          toggleIncludeStables: Boolean(includeStablesToggle?.checked ?? state.includeStables),
          toggleStackedDominance: Boolean(stackedDominanceToggle?.checked ?? state.stackedDominance),
          toggleShowPrice: Boolean(showPriceToggle?.checked ?? state.showPrice),
          toggleHistoryPanel: Boolean(historyToggle?.checked ?? state.showHistoryPanel),
          toggleSnapshotPanel: Boolean(snapshotToggle?.checked ?? state.showSnapshotPanel),
        },
      };
    }

    function restoreResetSnapshot(snapshot) {
      if (!snapshot || typeof snapshot !== 'object') return;

      state.suppressResetSnapshotClear = true;
      try {
        const checkboxState = snapshot.checkboxState || {};
        state.includeStables = typeof checkboxState.toggleIncludeStables === 'boolean'
          ? checkboxState.toggleIncludeStables
          : Boolean(snapshot.includeStables);
        state.stackedDominance = typeof checkboxState.toggleStackedDominance === 'boolean'
          ? checkboxState.toggleStackedDominance
          : Boolean(snapshot.stackedDominance);
        state.showPrice = typeof checkboxState.toggleShowPrice === 'boolean'
          ? checkboxState.toggleShowPrice
          : Boolean(snapshot.showPrice);
        state.stackedDominanceTouched = Boolean(snapshot.stackedDominanceTouched);
        state.range = String(snapshot.range || '365');
        state.smooth = String(snapshot.smooth || '7');
        state.panelsSwapped = Boolean(snapshot.panelsSwapped);
        state.showHistoryPanel = typeof checkboxState.toggleHistoryPanel === 'boolean'
          ? checkboxState.toggleHistoryPanel
          : Boolean(snapshot.showHistoryPanel);
        state.showSnapshotPanel = typeof checkboxState.toggleSnapshotPanel === 'boolean'
          ? checkboxState.toggleSnapshotPanel
          : Boolean(snapshot.showSnapshotPanel);
        if (!state.showHistoryPanel && !state.showSnapshotPanel) {
          state.showHistoryPanel = true;
        }
        state.historyPanelPercent = Number.isFinite(snapshot.historyPanelPercent) ? snapshot.historyPanelPercent : 61.54;
        state.historyPanelManualHeight = Number.isFinite(snapshot.historyPanelManualHeight) ? snapshot.historyPanelManualHeight : 0;
        state.snapshotPanelManualHeight = Number.isFinite(snapshot.snapshotPanelManualHeight) ? snapshot.snapshotPanelManualHeight : 0;
        state.historyUserXAxisRange = Array.isArray(snapshot.historyUserXAxisRange)
          ? snapshot.historyUserXAxisRange.slice()
          : null;
        state.timeZone = DASHBOARD_TIME?.setPreferredTimeZone?.(String(snapshot.timeZone || 'UTC')) || String(snapshot.timeZone || 'UTC');

        const includeStablesToggle = document.getElementById('toggleIncludeStables');
        const stackedDominanceToggle = document.getElementById('toggleStackedDominance');
        const showPriceToggle = document.getElementById('toggleShowPrice');
        const historyToggle = document.getElementById('toggleHistoryPanel');
        const snapshotToggle = document.getElementById('toggleSnapshotPanel');
        const rangeSelect = document.getElementById('rangeSelect');
        const smoothSelect = document.getElementById('smoothSelect');

        if (includeStablesToggle) includeStablesToggle.checked = state.includeStables;
        if (stackedDominanceToggle) stackedDominanceToggle.checked = state.stackedDominance;
        if (showPriceToggle) showPriceToggle.checked = state.showPrice;
        if (historyToggle) historyToggle.checked = state.showHistoryPanel;
        if (snapshotToggle) snapshotToggle.checked = state.showSnapshotPanel;
        if (rangeSelect) rangeSelect.value = state.range;
        if (smoothSelect) smoothSelect.value = state.smooth;

        populateUpdatedTimeZoneSelect();
        syncPanelToggleUi();
        applyPanelOrder();
        applyPanelVisibility();
        saveLayoutToStorage();
        saveControlsToStorage();
        renderAll();
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

      try {
        localStorage.removeItem(LAYOUT_STORAGE_KEY);
        localStorage.removeItem(CONTROLS_STORAGE_KEY);
      } catch (_) {
      }

      state.includeStables = true;
      state.topN = 10;
      state.stackedDominance = true;
      state.showPrice = false;
      state.stackedDominanceTouched = false;
      state.range = '365';
      state.smooth = '7';
      state.panelsSwapped = false;
      state.showHistoryPanel = true;
      state.showSnapshotPanel = true;
      state.historyPanelPercent = 61.54;
      state.historyPanelManualHeight = 0;
      state.snapshotPanelManualHeight = 0;
      state.historyUserXAxisRange = null;
      state.timeZone = DASHBOARD_TIME?.setPreferredTimeZone?.('UTC') || 'UTC';

      const includeStablesToggle = document.getElementById('toggleIncludeStables');
      const stackedDominanceToggle = document.getElementById('toggleStackedDominance');
      const showPriceToggle = document.getElementById('toggleShowPrice');
      const historyToggle = document.getElementById('toggleHistoryPanel');
      const snapshotToggle = document.getElementById('toggleSnapshotPanel');
      const rangeSelect = document.getElementById('rangeSelect');
      const smoothSelect = document.getElementById('smoothSelect');

      if (includeStablesToggle) includeStablesToggle.checked = true;
      if (stackedDominanceToggle) stackedDominanceToggle.checked = true;
      if (showPriceToggle) showPriceToggle.checked = false;
      if (historyToggle) historyToggle.checked = true;
      if (snapshotToggle) snapshotToggle.checked = true;
      if (rangeSelect) rangeSelect.value = '365';
      if (smoothSelect) smoothSelect.value = '7';

      populateUpdatedTimeZoneSelect();
      syncPanelToggleUi();
      applyPanelOrder();
      applyPanelVisibility();
      renderAll();
      updateResetButtonUi();
    }

    function restorePreviousDashboardState() {
      if (!state.preResetStateSnapshot) return;
      const snapshot = state.preResetStateSnapshot;
      state.preResetStateSnapshot = null;
      restoreResetSnapshot(snapshot);
    }

    function isDefaultState() {
      const rangeSelect = document.getElementById('rangeSelect');
      const smoothSelect = document.getElementById('smoothSelect');
      const includeStablesToggle = document.getElementById('toggleIncludeStables');
      const stackedDominanceToggle = document.getElementById('toggleStackedDominance');
      const showPriceToggle = document.getElementById('toggleShowPrice');
      const historyToggle = document.getElementById('toggleHistoryPanel');
      const snapshotToggle = document.getElementById('toggleSnapshotPanel');

      if (rangeSelect && rangeSelect.value !== '365') return false;
      if (smoothSelect && smoothSelect.value !== '7') return false;
      if (includeStablesToggle && !includeStablesToggle.checked) return false;
      if (stackedDominanceToggle && !stackedDominanceToggle.checked) return false;
      if (showPriceToggle && showPriceToggle.checked) return false;
      if (historyToggle && !historyToggle.checked) return false;
      if (snapshotToggle && !snapshotToggle.checked) return false;
      if (state.panelsSwapped) return false;
      if (Math.abs(Number(state.historyPanelPercent || 0) - 61.54) > 0.001) return false;
      if (Math.abs(Number(state.historyPanelManualHeight || 0)) > 0.001) return false;
      if (Math.abs(Number(state.snapshotPanelManualHeight || 0)) > 0.001) return false;
      if (state.historyUserXAxisRange) return false;
      if (state.timeZone !== 'UTC') return false;

      return true;
    }

    function updateResetButtonUi() {
      const btn = document.getElementById('resetDashboard');
      if (!btn) return;
      const labelEl = btn.querySelector('.btn-label');
      if (state.preResetStateSnapshot) {
        if (labelEl) labelEl.textContent = 'Undo Restore';
        else btn.textContent = 'Undo Restore';
        setButtonIcon('resetDashboardIcon', ICONS.resetUndo);
        btn.classList.add('reset-dashboard-btn--undo');
        btn.setAttribute('aria-label', 'Undo the last restore defaults action');
        setCustomTooltip(btn, 'Undo the last restore defaults action');
        btn.disabled = false;
      } else {
        if (labelEl) labelEl.textContent = 'Restore Defaults';
        else btn.textContent = 'Restore Defaults';
        setButtonIcon('resetDashboardIcon', ICONS.resetDefaults);
        btn.classList.remove('reset-dashboard-btn--undo');
        btn.setAttribute('aria-label', 'Restore dashboard defaults');
        setCustomTooltip(btn, 'Reset dashboard to defaults');
        btn.disabled = isDefaultState();
      }
    }

    function parseCsv(text) {
      const rows = [];
      let row = [];
      let value = '';
      let inQuotes = false;
      for (let i = 0; i < text.length; i += 1) {
        const ch = text[i];
        if (ch === '"') {
          if (inQuotes && text[i + 1] === '"') {
            value += '"';
            i += 1;
          } else {
            inQuotes = !inQuotes;
          }
          continue;
        }
        if (ch === ',' && !inQuotes) {
          row.push(value);
          value = '';
          continue;
        }
        if ((ch === '\n' || ch === '\r') && !inQuotes) {
          if (ch === '\r' && text[i + 1] === '\n') i += 1;
          row.push(value);
          if (row.some((cell) => String(cell || '').length)) rows.push(row);
          row = [];
          value = '';
          continue;
        }
        value += ch;
      }
      if (value.length || row.length) {
        row.push(value);
        if (row.some((cell) => String(cell || '').length)) rows.push(row);
      }
      if (!rows.length) return [];
      const headers = rows[0].map((header) => String(header || '').trim());
      return rows.slice(1).map((rawRow) => {
        const obj = {};
        headers.forEach((header, index) => {
          obj[header] = rawRow[index] ?? '';
        });
        return obj;
      });
    }

    function num(value) {
      const normalized = Number(String(value ?? '').replaceAll(',', '').trim());
      return Number.isFinite(normalized) ? normalized : 0;
    }

    function clamp(value, min, max) {
      return Math.max(min, Math.min(max, value));
    }

    function rollingAverage(values, windowSize) {
      if (windowSize <= 1) return values.slice();
      const out = [];
      let sum = 0;
      for (let i = 0; i < values.length; i += 1) {
        sum += values[i];
        if (i >= windowSize) sum -= values[i - windowSize];
        const denom = Math.min(i + 1, windowSize);
        out.push(sum / denom);
      }
      return out;
    }

    function rollingAverageNullable(values, windowSize) {
      if (windowSize <= 1) return values.slice();
      const out = [];
      const queue = [];
      let sum = 0;
      let count = 0;

      for (let i = 0; i < values.length; i += 1) {
        const value = values[i];
        queue.push(value);
        if (value != null && Number.isFinite(value)) {
          sum += value;
          count += 1;
        }

        if (queue.length > windowSize) {
          const removed = queue.shift();
          if (removed != null && Number.isFinite(removed)) {
            sum -= removed;
            count -= 1;
          }
        }

        out.push(count > 0 ? (sum / count) : null);
      }

      return out;
    }

    function fmtPctRatio(value, digits = 1) {
      return `${(num(value) * 100).toFixed(digits)}%`;
    }

    function fmtCompactMoney(value) {
      const n = num(value);
      if (!Number.isFinite(n)) return '$0';
      return new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: 'USD',
        notation: 'compact',
        maximumFractionDigits: 2,
      }).format(n);
    }

    function fmtAxisMarketCap(value) {
      const n = num(value);
      if (!Number.isFinite(n) || n <= 0) return '$0';
      if (n >= 1e12) {
        const trillions = n / 1e12;
        const digits = trillions >= 10 ? 0 : 1;
        return `$${trillions.toFixed(digits).replace(/\.0$/, '')}T`;
      }
      if (n >= 1e9) {
        const billions = n / 1e9;
        const digits = billions >= 100 ? 0 : billions >= 10 ? 1 : 2;
        return `$${billions.toFixed(digits).replace(/\.0+$/, '').replace(/(\.\d*[1-9])0+$/, '$1')}B`;
      }
      return fmtCompactMoney(n);
    }

    function fmtDate(value) {
      const raw = String(value || '').trim();
      if (!raw) return 'n/a';
      const parsed = new Date(`${raw}T00:00:00Z`);
      if (Number.isNaN(parsed.getTime())) return raw;
      return parsed.toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        timeZone: 'UTC',
      });
    }

    function measureTextWidth(text, font = '11px "IBM Plex Mono", monospace') {
      if (!measureTextWidth.canvas) {
        measureTextWidth.canvas = document.createElement('canvas');
      }
      const context = measureTextWidth.canvas.getContext('2d');
      if (!context) {
        return String(text || '').length * 7;
      }
      context.font = font;
      return context.measureText(String(text || '')).width;
    }

    function parsePriceDateToIso(row) {
      const timestamp = String(row?.timestamp || '').trim();
      if (/^\d{4}-\d{2}-\d{2}/.test(timestamp)) {
        return timestamp.slice(0, 10);
      }

      const rawDate = String(row?.date || '').trim();
      const shortMatch = rawDate.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
      if (shortMatch) {
        const month = shortMatch[1].padStart(2, '0');
        const day = shortMatch[2].padStart(2, '0');
        let year = shortMatch[3];
        if (year.length === 2) year = `20${year}`;
        return `${year}-${month}-${day}`;
      }

      return '';
    }

    function normalizeChartDate(value) {
      const raw = String(value || '').trim();
      if (!raw) return '';
      const isoMatch = raw.match(/^(\d{4}-\d{2}-\d{2})/);
      if (isoMatch) return isoMatch[1];
      const parsed = new Date(raw);
      if (!Number.isNaN(parsed.getTime())) {
        return parsed.toISOString().slice(0, 10);
      }
      return '';
    }

    function clampHistoryXAxisRange(range, minDate, maxDate) {
      if (!Array.isArray(range) || range.length !== 2 || !minDate || !maxDate) return null;
      const start = normalizeChartDate(range[0]);
      const end = normalizeChartDate(range[1]);
      if (!start || !end) return null;
      const clampedStart = start < minDate ? minDate : start;
      const clampedEnd = end > maxDate ? maxDate : end;
      if (clampedStart >= clampedEnd) return null;
      return [clampedStart, clampedEnd];
    }

    function adjustPriceAxisToXRange(xStart, xEnd) {
      // Recalculate and update the price y-axis based on visible prices in the x-axis range
      if (!state.priceHistory || !state.priceHistory.length) return;

      const startNorm = normalizeChartDate(xStart);
      const endNorm = normalizeChartDate(xEnd);
      if (!startNorm || !endNorm) return;

      // Find prices within the visible x-range
      const visiblePrices = state.priceHistory
        .filter((item) => item.date >= startNorm && item.date <= endNorm && Number.isFinite(item.price))
        .map((item) => item.price);

      if (!visiblePrices.length) return;

      // Calculate new max for this range (with 2% padding)
      const maxPrice = Math.max(...visiblePrices) * 1.02;
      const dominanceAxisMin = -2;
      const dominanceAxisMax = 100;
      const zeroOffsetRatio = (0 - dominanceAxisMin) / (dominanceAxisMax - dominanceAxisMin);
      const minPrice = -(zeroOffsetRatio / Math.max(1e-9, 1 - zeroOffsetRatio)) * maxPrice;

      Plotly.relayout('dominanceChart', { 'yaxis2.range': [minPrice, maxPrice] });
    }

    function bindHistoryChartViewportPersistence(minDate, maxDate) {
      const chartEl = document.getElementById('dominanceChart');
      if (!chartEl || typeof chartEl.on !== 'function') return;

      if (typeof chartEl.__historyRelayoutHandler === 'function' && typeof chartEl.removeListener === 'function') {
        chartEl.removeListener('plotly_relayout', chartEl.__historyRelayoutHandler);
      }

      const onRelayout = (eventData = {}) => {
        if (eventData['xaxis.autorange'] === true) return;

        const start = eventData['xaxis.range[0]'] ?? eventData.xaxis?.range?.[0];
        const end = eventData['xaxis.range[1]'] ?? eventData.xaxis?.range?.[1];
        if (start == null || end == null) return;

        state.historyUserXAxisRange = clampHistoryXAxisRange([start, end], minDate, maxDate);

        // Adjust price y-axis to show optimal range for the visible x-axis window
        if (state.showPrice) {
          adjustPriceAxisToXRange(start, end);
        }
      };

      chartEl.__historyRelayoutHandler = onRelayout;
      chartEl.on('plotly_relayout', onRelayout);
    }

    function loadScript(src, timeoutMs = 5000) {
      return new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = src;
        script.async = true;
        const timer = setTimeout(() => {
          script.onload = script.onerror = null;
          reject(new Error(`Timed out loading script: ${src}`));
        }, timeoutMs);
        script.onload = () => { clearTimeout(timer); resolve(); };
        script.onerror = () => { clearTimeout(timer); reject(new Error(`Failed to load script: ${src}`)); };
        document.head.appendChild(script);
      });
    }

    async function ensurePlotlyLoaded() {
      if (window.Plotly) return;
      const candidates = [
        'https://cdn.plot.ly/plotly-2.35.2.min.js',
        'https://cdn.jsdelivr.net/npm/plotly.js-dist-min@2.35.2/plotly.min.js',
        'https://unpkg.com/plotly.js-dist-min@2.35.2/plotly.min.js',
      ];
      for (const src of candidates) {
        try {
          await loadScript(src);
          if (window.Plotly) return;
        } catch (_) {
        }
      }
      throw new Error('Plotly failed to load from all CDN sources.');
    }

    const dashboardControlLock = window.WSBDashboardShared?.createDashboardControlLock?.({
      topbar: document.querySelector('.topbar'),
      extraControls: [document.getElementById('panelResizer')],
    });

    function syncSwapButtonEnabledState() {
      const swapBtn = document.getElementById('swapPanelsBtn');
      if (!swapBtn) return;
      swapBtn.disabled = !(state.showHistoryPanel && state.showSnapshotPanel);
    }

    function setControlsEnabled(enabled) {
      dashboardControlLock?.setEnabled(enabled);
      syncSwapButtonEnabledState();
    }

    async function fetchText(path) {
      const response = await fetch(path, { cache: FETCH_CACHE_MODE });
      if (!response.ok) throw new Error(`Failed to load ${path} (${response.status})`);
      return response.text();
    }

    function withCacheBust(path, cacheBust = null) {
      if (cacheBust == null) return path;
      const separator = path.includes('?') ? '&' : '?';
      return `${path}${separator}_=${cacheBust}`;
    }

    async function fetchTextWithCacheBust(path, cacheBust = null) {
      return fetchText(withCacheBust(path, cacheBust));
    }

    function mergeTimeseriesRows(...parts) {
      const byDate = new Map();
      parts.forEach((rows) => {
        (rows || []).forEach((row) => {
          const date = String(row?.Date || '').trim();
          if (!date) return;
          byDate.set(date, row);
        });
      });
      return Array.from(byDate.values()).sort((a, b) => new Date(`${a.Date}T00:00:00Z`) - new Date(`${b.Date}T00:00:00Z`));
    }

    async function fetchSplitTimeseriesRows({ historicalPath, currentDayPath, legacyPath, cacheBust = null }) {
      const [historicalText, currentDayText] = await Promise.all([
        fetchTextWithCacheBust(historicalPath, cacheBust).catch(() => ''),
        fetchTextWithCacheBust(currentDayPath, cacheBust).catch(() => ''),
      ]);

      if (historicalText || currentDayText) {
        return mergeTimeseriesRows(parseCsv(historicalText), parseCsv(currentDayText));
      }

      // Backward-compatible fallback for deployments that still publish a combined file.
      const legacyText = await fetchTextWithCacheBust(legacyPath, cacheBust);
      return parseCsv(legacyText);
    }

    function getDataSignature(staticMeta, refreshedAtText) {
      const generatedAt = String(staticMeta?.generated_at_utc || '').trim();
      const latestSnapshot = String(staticMeta?.latest_snapshot_date || '').trim();
      const refreshed = String(refreshedAtText || '').trim();
      return `${generatedAt}|${latestSnapshot}|${refreshed}`;
    }

    async function loadDashboardData(cacheBust = null) {
      const [
        chartStaticText,
        historyExclRows,
        historyInclRows,
        snapshotExclText,
        snapshotInclText,
        dailyPriceText,
        refreshedAtRaw,
      ] = await Promise.all([
        fetchTextWithCacheBust('webapp_data/chart_static.json', cacheBust),
        fetchSplitTimeseriesRows({
          historicalPath: 'webapp_data/btcd_timeseries_historical.csv',
          currentDayPath: 'webapp_data/btcd_timeseries_current_day.csv',
          legacyPath: 'webapp_data/btcd_timeseries.csv',
          cacheBust,
        }),
        fetchSplitTimeseriesRows({
          historicalPath: 'webapp_data/btcd_timeseries_incl_stables_historical.csv',
          currentDayPath: 'webapp_data/btcd_timeseries_incl_stables_current_day.csv',
          legacyPath: 'webapp_data/btcd_timeseries_incl_stables.csv',
          cacheBust,
        }),
        fetchTextWithCacheBust('webapp_data/top10_daily_excl_stables.csv', cacheBust),
        fetchTextWithCacheBust('webapp_data/top10_daily_incl_stables.csv', cacheBust),
        fetchTextWithCacheBust('../../assets/daily_price.csv', cacheBust),
        fetchTextWithCacheBust('webapp_data/last_updated.txt', cacheBust).catch(() => ''),
      ]);

      const staticMeta = JSON.parse(chartStaticText);
      const datasets = {
        excl: {
          history: historyExclRows,
          snapshot: parseCsv(snapshotExclText),
        },
        incl: {
          history: historyInclRows,
          snapshot: parseCsv(snapshotInclText),
        },
      };
      const priceHistory = parseCsv(dailyPriceText)
        .map((row) => ({
          date: parsePriceDateToIso(row),
          price: num(row.price),
        }))
        .filter((row) => row.date && Number.isFinite(row.price));
      const refreshedAtText = String(refreshedAtRaw || '').trim();

      return {
        staticMeta,
        datasets,
        priceHistory,
        refreshedAtText,
        signature: getDataSignature(staticMeta, refreshedAtText),
      };
    }

    async function fetchLatestDataSignature() {
      const cacheBust = Date.now();
      const [chartStaticText, refreshedAtRaw] = await Promise.all([
        fetchTextWithCacheBust('webapp_data/chart_static.json', cacheBust),
        fetchTextWithCacheBust('webapp_data/last_updated.txt', cacheBust).catch(() => ''),
      ]);
      const staticMeta = JSON.parse(chartStaticText);
      return getDataSignature(staticMeta, String(refreshedAtRaw || '').trim());
    }

    async function refreshIfDataChanged({ force = false } = {}) {
      if (state.refreshInFlight) return;
      state.refreshInFlight = true;

      try {
        if (!force && state.dataSignature) {
          const latestSignature = await fetchLatestDataSignature();
          if (latestSignature === state.dataSignature) {
            return;
          }
        }

        setPanelLoaderVisible('history', true);
        setPanelLoaderVisible('snapshot', true);

        const data = await loadDashboardData(Date.now());
        if (!data.datasets.excl.history.length) {
          throw new Error('No rows found in btcd_timeseries.csv.');
        }
        if (!data.datasets.excl.snapshot.length) {
          throw new Error('No rows found in top10_daily_excl_stables.csv.');
        }

        state.staticMeta = data.staticMeta;
        state.datasets = data.datasets;
        state.priceHistory = data.priceHistory;
        state.refreshedAtText = data.refreshedAtText;
        state.dataSignature = data.signature;
        state.lastSuccessfulRefreshAt = Date.now();

        hideError();
        renderAll();
      } catch (error) {
        console.warn('Auto-refresh check failed:', error);
      } finally {
        state.refreshInFlight = false;
        setPanelLoaderVisible('history', false);
        setPanelLoaderVisible('snapshot', false);
      }
    }

    function triggerRefreshSoon(delayMs = 150) {
      window.setTimeout(() => {
        refreshIfDataChanged();
      }, delayMs);
    }

    function setupRefreshWakeEvents() {
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') {
          triggerRefreshSoon(0);
        }
      });

      window.addEventListener('focus', () => {
        triggerRefreshSoon(0);
      });

      window.addEventListener('pageshow', () => {
        triggerRefreshSoon(0);
      });

      window.addEventListener('online', () => {
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

    function getModeKey() {
      return state.includeStables ? 'incl' : 'excl';
    }

    function getCurrentHistory() {
      return state.datasets[getModeKey()].history;
    }

    function getCurrentSnapshot() {
      return state.datasets[getModeKey()].snapshot;
    }

    function getCurrentColumn() {
      return `btcd_top${state.topN}`;
    }

    function getCurrentStableColumn() {
      const rows = getCurrentHistory();
      if (!rows.length) return null;
      const candidates = [`stabled_top${state.topN}`, `stable_top${state.topN}`];
      const sample = rows[0] || {};
      for (const key of candidates) {
        if (Object.prototype.hasOwnProperty.call(sample, key)) return key;
      }
      return null;
    }

    function getLatestRow() {
      const rows = getCurrentHistory();
      return rows.length ? rows[rows.length - 1] : null;
    }

    function setPanelLoaderVisible(key, visible) {
      const el = document.getElementById(key === 'history' ? 'historyLoader' : 'snapshotLoader');
      if (!el) return;
      el.classList.toggle('hidden', !visible);

      const grid = document.querySelector('.grid');
      const historyLoader = document.getElementById('historyLoader');
      const snapshotLoader = document.getElementById('snapshotLoader');
      const hasVisibleLoader = Boolean(
        (historyLoader && !historyLoader.classList.contains('hidden'))
        || (snapshotLoader && !snapshotLoader.classList.contains('hidden'))
      );
      grid?.classList.toggle('loading-panels', hasVisibleLoader);
    }

    function showError(message) {
      const box = document.getElementById('errorBox');
      if (!box) return;
      box.style.display = 'block';
      box.textContent = message;
    }

    function hideError() {
      const box = document.getElementById('errorBox');
      if (!box) return;
      box.style.display = 'none';
      box.textContent = '';
    }

    function getSnapshotRows() {
      const rows = getCurrentSnapshot().slice().sort((a, b) => num(a.Rank) - num(b.Rank));
      return rows.slice(0, Math.min(state.topN, rows.length));
    }

    function renderStatusChips() {
      const top10Chip = document.getElementById('kpiTop10MarketCap');
      const bitcoinMarketCapChip = document.getElementById('kpiBitcoinMarketCap');
      const stableMarketCapChip = document.getElementById('kpiStableMarketCap');
      if (!top10Chip || !bitcoinMarketCapChip || !stableMarketCapChip) return;
      const top10Value = top10Chip.querySelector('.chip-value');
      const bitcoinValue = bitcoinMarketCapChip.querySelector('.chip-value');
      const stableValue = stableMarketCapChip.querySelector('.chip-value');
      if (!top10Value || !bitcoinValue || !stableValue) return;
      const historyRows = getCurrentHistory();
      const snapshotRows = getSnapshotRows();
      const column = getCurrentColumn();
      const latest = getLatestRow();
      if (!historyRows.length || !latest) {
        return;
      }

      // Calculate Top 10 Market Cap (sum of snapshot market caps)
      let top10MarketCap = 0;
      if (snapshotRows.length) {
        top10MarketCap = snapshotRows.reduce((sum, row) => sum + num(row['Market Cap']), 0);
      }

      // Get Bitcoin Market Cap (first snapshot row, rank 1)
      const bitcoinRow = snapshotRows.find((row) => String(row.Symbol || '').toUpperCase() === 'BTC');
      const bitcoinMarketCap = bitcoinRow ? num(bitcoinRow['Market Cap']) : 0;

      // Calculate Stablecoin Market Caps (sum of stable rows in snapshot)
      const stableMarketCap = snapshotRows.reduce((sum, row) => {
        return String(row['Is Stable']).toLowerCase() === 'true'
          ? sum + num(row['Market Cap'])
          : sum;
      }, 0);

      top10Value.textContent = `${fmtCompactMoney(top10MarketCap)}`;
      bitcoinValue.textContent = `${fmtCompactMoney(bitcoinMarketCap)} · ${fmtPctRatio(latest[column])}`;

      // Include stable metrics only when stablecoins are enabled in this view.
      if (state.includeStables) {
        const stableColumn = getCurrentStableColumn();
        const stableDominance = stableColumn ? num(latest[stableColumn]) : 0;
        stableValue.textContent = `${fmtCompactMoney(stableMarketCap)} · ${fmtPctRatio(stableDominance)}`;
      } else {
        stableValue.textContent = '-';
      }
    }

    function updateModeLabels() {
      const historyTitle = document.getElementById('historyPanelTitle');
      const historySub = document.getElementById('historyPanelSub');
      const snapshotTitle = document.getElementById('snapshotPanelTitle');
      const snapshotSub = document.getElementById('snapshotPanelSub');

      if (state.includeStables) {
        if (historyTitle) historyTitle.textContent = 'Dominance Over Time (Top 10 By Market Cap incl. stablecoins)';
        if (snapshotTitle) snapshotTitle.textContent = 'Top 10 Cryptocurrencies By Market Cap (incl. stablecoins)';
      } else {
        if (historyTitle) historyTitle.textContent = 'Dominance Over Time (Top 10 By Market Cap excl. stablecoins)';
        if (snapshotTitle) snapshotTitle.textContent = 'Top 10 Cryptocurrencies By Market Cap (excl. stablecoins)';
      }
    }

    function setLastUpdated() {
      const display = document.getElementById('updatedTimeZoneDisplay');
      if (!display) return;
      const valueEl = display.querySelector('.chip-value');
      if (!valueEl) return;
      const source = String(state.refreshedAtText || state.staticMeta?.generated_at_utc || '').trim();
      const withParenthesizedZone = (text) => {
        const normalized = String(text || '').trim();
        if (!normalized) return normalized;
        if (/\([^()]+\)\s*$/.test(normalized)) return normalized;
        const m = normalized.match(/^(.*\d{2}:\d{2})(?:\s+([A-Za-z][A-Za-z0-9_:+\/-]*))$/);
        if (!m) return normalized;
        const prefix = m[1].trimEnd();
        const zone = m[2].trim();
        return `${prefix} (${zone})`;
      };
      if (!source) {
        valueEl.textContent = 'n/a';
        return;
      }
      if (DASHBOARD_TIME?.formatUtcTimestamp) {
        const formatted = DASHBOARD_TIME.formatUtcTimestamp(source, state.timeZone);
        valueEl.textContent = withParenthesizedZone(formatted.text || source);
        return;
      }
      valueEl.textContent = withParenthesizedZone(source);
    }

    function populateUpdatedTimeZoneSelect() {
      const select = document.getElementById('updatedTimeZoneSelect');
      if (!select) return;
      const preferred = DASHBOARD_TIME?.getPreferredTimeZone?.() || state.timeZone || 'UTC';
      state.timeZone = preferred;
      const options = DASHBOARD_TIME?.getTimeZoneOptions?.() || [{ value: 'UTC', label: 'UTC' }];
      select.innerHTML = options.map((option) => {
        const selected = option.value === preferred ? ' selected' : '';
        return `<option value="${option.value}"${selected}>${option.label}</option>`;
      }).join('');
      setLastUpdated();
    }

    function updateHistoryInputs() {
      const rows = getCurrentHistory();
      const latest = getLatestRow();
      const selectedDateText = document.getElementById('selectedDateText');
      if (selectedDateText) {
        selectedDateText.textContent = latest ? `${fmtDate(latest.Date)} · ${fmtPctRatio(latest[getCurrentColumn()])}` : 'n/a';
      }
    }

    function updateSnapshotMeta() {
      const rows = getCurrentSnapshot();
      const snapshotDate = rows[0] ? rows[0].Date : (state.staticMeta?.latest_snapshot_date || '');
      const snapshotDateText = document.getElementById('snapshotDateText');
      const snapshotPanelSub = document.getElementById('snapshotPanelSub');
      if (snapshotDateText) snapshotDateText.textContent = snapshotDate ? fmtDate(snapshotDate) : 'n/a';
    }

    function renderHistoryChart() {
      const _thStyle = getComputedStyle(document.documentElement);
      const _thFg = _thStyle.getPropertyValue('--fg').trim() || '#f1f5f7';
      const _thFgDim = _thStyle.getPropertyValue('--fg-dim').trim() || '#d6e1e6';
      const _thIsLight = document.documentElement.dataset.theme === 'light';
      // Use opaque fills that visually match prior translucent fills over light/dark backgrounds.
      const _fillBtc    = _thIsLight ? '#ffeed6' : '#5f3800';
      const _fillStable = _thIsLight ? '#e1f4e9' : '#123f26';
      const _fillOther  = _thIsLight ? '#e9e9e9' : '#2f2f2f';
      const rangeDays = Number(state.range != null ? state.range : document.getElementById('rangeSelect')?.value ?? 365);
      const smooth = Number(state.smooth ?? document.getElementById('smoothSelect')?.value ?? 7);
      const allRows = getCurrentHistory().slice().sort((a, b) => new Date(`${a.Date}T00:00:00Z`) - new Date(`${b.Date}T00:00:00Z`));
      let rows = allRows;
      let xAxisRange = null;
      if (allRows.length) {
        const allStart = allRows[0].Date;
        const allEnd = allRows[allRows.length - 1].Date;
        xAxisRange = [allStart, allEnd];
      }
      if (rangeDays > 0 && rows.length) {
        const end = new Date(`${allRows[allRows.length - 1].Date}T00:00:00Z`).getTime();
        const start = end - rangeDays * 24 * 60 * 60 * 1000;
        rows = rows.filter((r) => new Date(`${r.Date}T00:00:00Z`).getTime() >= start);
        const rangeStart = new Date(start).toISOString().slice(0, 10);
        const rangeEnd = allRows[allRows.length - 1].Date;
        xAxisRange = [rangeStart, rangeEnd];
      }
      if (allRows.length && state.historyUserXAxisRange) {
        const clampedUserRange = clampHistoryXAxisRange(
          state.historyUserXAxisRange,
          allRows[0].Date,
          allRows[allRows.length - 1].Date
        );
        state.historyUserXAxisRange = clampedUserRange;
        if (clampedUserRange) {
          xAxisRange = clampedUserRange;
        }
      }
      const column = getCurrentColumn();
      const stableColumn = state.includeStables ? getCurrentStableColumn() : null;
      if (!rows.length) {
        throw new Error('No history rows found in Bitcoin Dominance dataset.');
      }
      const x = rows.map((row) => row.Date);
      const yRaw = rows.map((row) => num(row[column]) * 100);
      const y = smooth > 1 ? rollingAverage(yRaw, smooth) : yRaw;
      const yFill = y.map((v) => (Number.isFinite(v) ? Math.max(0, v) : null));
      const priceByDate = new Map((state.priceHistory || []).map((row) => [row.date, row.price]));
      const priceYRaw = x.map((date) => {
        const price = priceByDate.get(date);
        return Number.isFinite(price) ? price : null;
      });
      const priceY = smooth > 1 ? rollingAverageNullable(priceYRaw, smooth) : priceYRaw;
      const hasPriceTrace = state.showPrice && priceY.some((value) => Number.isFinite(value));
      const traces = [];
      let hasStableTrace = false;
      let stableY = null;

      if (stableColumn) {
        const stableRaw = rows.map((row) => num(row[stableColumn]) * 100);
        const firstStableIdx = stableRaw.findIndex((value) => Number.isFinite(value) && value >= STABLE_MIN_PCT_FOR_PLOT);
        if (firstStableIdx !== -1) {
          stableY = stableRaw.map((value, idx) => {
            if (idx < firstStableIdx) return null;
            return Number.isFinite(value) && value >= STABLE_MIN_PCT_FOR_PLOT ? value : null;
          });
          if (smooth > 1) {
            stableY = rollingAverageNullable(stableY, smooth);
          }
          const hasRenderableStable = stableY.some((value) => Number.isFinite(value));
          if (hasRenderableStable) {
            hasStableTrace = true;
          }
        }
      }

      const stableSeries = hasStableTrace && Array.isArray(stableY) ? stableY : null;
      const stableValueY = y.map((btcVal, idx) => {
        if (!Number.isFinite(btcVal)) return 0;
        const stableVal = stableSeries && Number.isFinite(stableSeries[idx]) ? stableSeries[idx] : 0;
        return Math.max(0, stableVal);
      });
      const stableTopY = yFill.map((btcVal, idx) => {
        if (!Number.isFinite(btcVal)) return null;
        return btcVal + stableValueY[idx];
      });
      const otherValueY = y.map((btcVal, idx) => {
        if (!Number.isFinite(btcVal)) return null;
        const stableVal = stableValueY[idx];
        const value = 100 - btcVal - stableVal;
        return Number.isFinite(value) ? Math.max(0, value) : null;
      });
      const otherTopY = yFill.map((btcVal) => (Number.isFinite(btcVal) ? 100 : null));
      const hasStablePositive = stableSeries && stableSeries.some((v) => Number.isFinite(v) && v > 0);
      const parsedX = x
        .map((date) => {
          const ms = new Date(`${date}T00:00:00Z`).getTime();
          return Number.isFinite(ms) ? { date, ms } : null;
        })
        .filter(Boolean)
        .sort((a, b) => a.ms - b.ms);
      const xMin = parsedX.length ? parsedX[0].date : x[0];
      const xMax = parsedX.length ? parsedX[parsedX.length - 1].date : x[x.length - 1];
      const yTickvals = [0, 25, 50, 75, 100];
      const dominanceAxisMin = -2;
      const dominanceAxisMax = 100;
      const xTickvals = [];
      const xTicktext = [];

      if (xMin && xMax) {
        const startMs = new Date(`${xMin}T00:00:00Z`).getTime();
        const endMs = new Date(`${xMax}T00:00:00Z`).getTime();
        const spanDays = Math.max(1, Math.round((endMs - startMs) / (24 * 60 * 60 * 1000)));

        const pushTick = (dateObj, label) => {
          // Use midday tick positions so daily midnight data points don't exactly
          // match tickvals (prevents unified hover title from falling back to ticktext).
          const iso = `${dateObj.toISOString().slice(0, 10)}T12:00:00Z`;
          const ms = new Date(iso).getTime();
          if (ms < startMs || ms > endMs) return;
          if (xTickvals[xTickvals.length - 1] === iso) return;
          xTickvals.push(iso);
          xTicktext.push(label);
        };

        if (spanDays <= 400) {
          // 1Y and shorter ranges: monthly markers.
          const cursor = new Date(`${xMin}T00:00:00Z`);
          cursor.setUTCDate(1);
          cursor.setUTCHours(0, 0, 0, 0);

          while (cursor.getTime() <= endMs) {
            const monthLabel = cursor.toLocaleDateString('en-US', {
              month: 'short',
              timeZone: 'UTC',
            });
            const showYear = cursor.getUTCMonth() === 0;
            const label = showYear ? String(cursor.getUTCFullYear()) : monthLabel;
            pushTick(cursor, label);
            cursor.setUTCMonth(cursor.getUTCMonth() + 1);
          }
        } else {
          // Longer ranges: yearly markers with adaptive year step.
          const startYear = Number(String(xMin).slice(0, 4));
          const endYear = Number(String(xMax).slice(0, 4));
          if (Number.isFinite(startYear) && Number.isFinite(endYear) && endYear >= startYear) {
            const spanYears = endYear - startYear + 1;
            const maxTicks = 9;
            const minStep = Math.max(1, Math.ceil(spanYears / maxTicks));
            const stepOptions = [1, 2, 5, 10, 20, 25, 50];
            const step = stepOptions.find((candidate) => candidate >= minStep) || 50;
            for (let yr = startYear; yr <= endYear; yr += step) {
              const tickDate = new Date(`${yr}-01-01T00:00:00Z`);
              pushTick(tickDate, String(yr));
            }
          }
        }

      }

      const visiblePriceValues = priceY.filter((value) => Number.isFinite(value));
      const zeroOffsetRatio = (0 - dominanceAxisMin) / (dominanceAxisMax - dominanceAxisMin);
      const priceAxisMax = hasPriceTrace
        ? Math.max(1, ...visiblePriceValues) * 1.02
        : 1;
      const priceAxisMin = -(zeroOffsetRatio / Math.max(1e-9, 1 - zeroOffsetRatio)) * priceAxisMax;

      if (state.stackedDominance) {
        // Stacked fills: BTC to 0, Stable on BTC, Other to 100.
        traces.push({
          type: 'scatter',
          mode: 'lines',
          x,
          y: yFill,
          line: { color: '#ff9f1c', width: 0 },
          fill: 'tozeroy',
          fillcolor: _fillBtc,
          hoverinfo: 'skip',
          showlegend: false,
        });

        if (state.includeStables && hasStablePositive) {
          traces.push({
            type: 'scatter',
            mode: 'lines',
            x,
            y: stableTopY,
            line: { color: STABLE_USD_GREEN, width: 0 },
            fill: 'tonexty',
            fillcolor: _fillStable,
            hoverinfo: 'skip',
            showlegend: false,
          });
        }

        traces.push({
          type: 'scatter',
          mode: 'lines',
          x,
          y: otherTopY,
          line: { color: '#999999', width: 0 },
          fill: 'tonexty',
          fillcolor: _fillOther,
          hoverinfo: 'skip',
          showlegend: false,
        });
      } else {
        // Non-stacked fills: each series to zero.
        traces.push({
          type: 'scatter',
          mode: 'lines',
          x,
          y: yFill,
          line: { color: '#ff9f1c', width: 0 },
          fill: 'tozeroy',
          fillcolor: _fillBtc,
          hoverinfo: 'skip',
          showlegend: false,
        });

        traces.push({
          type: 'scatter',
          mode: 'lines',
          x,
          y: otherValueY,
          line: { color: '#999999', width: 0 },
          fill: 'tozeroy',
          fillcolor: _fillOther,
          hoverinfo: 'skip',
          showlegend: false,
        });

        if (state.includeStables && hasStablePositive) {
          traces.push({
            type: 'scatter',
            mode: 'lines',
            x,
            y: stableValueY,
            line: { color: STABLE_USD_GREEN, width: 0 },
            fill: 'tozeroy',
            fillcolor: _fillStable,
            hoverinfo: 'skip',
            showlegend: false,
          });
        }
      }

      // Draw custom grid lines above fills so they remain visible across filled areas.
      const gridLineColor = _thIsLight ? 'rgba(0,0,0,0.08)' : 'rgba(255,255,255,0.08)';
      yTickvals.forEach((yv) => {
        traces.push({
          type: 'scatter',
          mode: 'lines',
          x: [xMin, xMax],
          y: [yv, yv],
          line: { color: gridLineColor, width: 1 },
          hoverinfo: 'skip',
          showlegend: false,
        });
      });

      xTickvals.forEach((xv) => {
        traces.push({
          type: 'scatter',
          mode: 'lines',
          x: [xv, xv],
          y: [-2, 102],
          line: { color: gridLineColor, width: 1 },
          hoverinfo: 'skip',
          showlegend: false,
        });
      });

      // Keep BTC dominance on top by drawing the price line before dominance lines.
      if (hasPriceTrace) {
        traces.push({
          type: 'scatter',
          mode: 'lines',
          x,
          y: priceY,
          yaxis: 'y2',
          line: { color: _thFg, width: 2 },
          hovertemplate: 'BTC price: $%{y:,.0f}<extra></extra>',
          name: 'BTC Price',
          legendrank: 4,
          connectgaps: false,
        });
      }

      // Line layers (top stack): stable, other, btc
      if (state.includeStables && hasStablePositive) {
        traces.push({
          type: 'scatter',
          mode: 'lines',
          x,
          y: state.stackedDominance ? stableTopY : stableValueY,
          line: { color: STABLE_USD_GREEN, width: 2.1 },
          customdata: stableValueY,
          hovertemplate: 'Stable dominance: %{customdata:.1f}%<extra></extra>',
          name: 'Stable Dominance',
          legendrank: 2,
        });
      }

      traces.push({
        type: 'scatter',
        mode: 'lines',
        x,
        y: state.stackedDominance ? otherTopY : otherValueY,
        line: { color: '#999999', width: 2.5 },
        customdata: otherValueY,
        hovertemplate: 'Other dominance: %{customdata:.1f}%<extra></extra>',
        name: 'Other Dominance',
        legendrank: 3,
      });

      traces.push({
        type: 'scatter',
        mode: 'lines',
        x,
        y,
        line: { color: '#ff9f1c', width: 2.5 },
        hovertemplate: 'BTC dominance: %{y:.1f}%<extra></extra>',
        name: 'BTC Dominance',
        legendrank: 1,
      });

      const dominanceXAxisBottomMargin = isStackedLayout() ? 56 : 35;

      Plotly.react('dominanceChart', traces, {
        paper_bgcolor: PLOTLY_LIVE_BG,
        plot_bgcolor: PLOTLY_LIVE_BG,
        hoverlabel: getPlotlyHoverlabel(),
        hoverdistance: 5,
        margin: { l: 60, r: hasPriceTrace ? 74 : 24, t: 0, b: dominanceXAxisBottomMargin },
        showlegend: true,
        legend: {
          orientation: 'h',
          yanchor: 'bottom',
          y: 1.02,
          xanchor: 'left',
          x: 0,
          traceorder: 'normal',
          itemclick: false,
          itemdoubleclick: false,
          font: { family: 'IBM Plex Mono, monospace', size: 11, color: _thFgDim },
        },
        hovermode: 'x unified',
        xaxis: {
          automargin: true,
          ticklabelstandoff: 10,
          color: _thFgDim,
          showgrid: false,
          tickfont: { family: 'IBM Plex Mono, monospace', size: 11 },
          tickmode: xTickvals.length ? 'array' : 'auto',
          tickvals: xTickvals,
          ticktext: xTicktext,
          tickformat: xTickvals.length ? undefined : '%Y',
          hoverformat: '%b %d, %Y',
          unifiedhovertitle: {
            text: '%{x|%b %d, %Y}',
          },
          zeroline: false,
          range: xAxisRange,
          showspikes: true,
          spikemode: 'across',
          spikesnap: 'cursor',
          spikecolor: _thFg,
          spikethickness: 1,
          spikedash: 'dash',
        },
        yaxis: {
          title: { text: 'Dominance share', font: { family: 'IBM Plex Mono, monospace', size: 12 } },
          color: _thFgDim,
          showgrid: false,
          tickmode: 'array',
          tickvals: yTickvals,
          ticktext: ['0%', '25%', '50%', '75%', '100%'],
          tickfont: { family: 'IBM Plex Mono, monospace', size: 11 },
          zeroline: false,
          showspikes: false,
          range: [dominanceAxisMin, dominanceAxisMax],
        },
        yaxis2: {
          title: { text: 'BTC price', font: { family: 'IBM Plex Mono, monospace', size: 12 } },
          overlaying: 'y',
          side: 'right',
          color: _thFgDim,
          showgrid: false,
          zeroline: false,
          tickfont: { family: 'IBM Plex Mono, monospace', size: 11 },
          tickprefix: '$',
          tickformat: '~s',
          range: [priceAxisMin, priceAxisMax],
          showticklabels: hasPriceTrace,
          showline: hasPriceTrace,
          visible: hasPriceTrace,
        },
      }, {
        responsive: true,
        doubleClick: false,
        displayModeBar: false,
        displaylogo: false,
        modeBarButtonsToRemove: ['select2d', 'lasso2d', 'autoScale2d', 'toggleSpikelines'],
      }).then(() => {
        bindHistoryChartViewportPersistence(allRows[0]?.Date || '', allRows[allRows.length - 1]?.Date || '');
      });
    }

    function renderSnapshotChart() {
      const _thStyle = getComputedStyle(document.documentElement);
      const _thFgDim = _thStyle.getPropertyValue('--fg-dim').trim() || '#d6e1e6';
      const _thIsLight = document.documentElement.dataset.theme === 'light';
      const _thGrid = _thIsLight ? 'rgba(0,0,0,0.08)' : 'rgba(255,255,255,0.08)';
      const rows = getSnapshotRows();
      if (!rows.length) {
        throw new Error('No latest snapshot rows found in Bitcoin Dominance dataset.');
      }
      const getSnapshotIconUrl = (row) => {
        const primaryKey = String(row['Primary Key'] || '').trim();
        const symbol = String(row.Symbol || '').trim();
        const localPrimary = primaryKey ? `icons/${encodeURIComponent(primaryKey)}.png` : null;
        const localSymbol = symbol ? `icons/${encodeURIComponent(symbol.toUpperCase())}.png` : null;
        return localPrimary || localSymbol || null;
      };
      const fmtPriceForTooltip = (row) => {
        const isBtc = String(row.Symbol || '').toUpperCase() === 'BTC' || String(row['Primary Key']) === 'BTCBitcoin';
        const digits = isBtc ? 0 : 2;
        return new Intl.NumberFormat('en-US', {
          style: 'currency',
          currency: 'USD',
          minimumFractionDigits: digits,
          maximumFractionDigits: digits,
        }).format(num(row.Price));
      };
      const fmtSupplyForTooltip = (row) => {
        const symbol = String(row.Symbol || '').toUpperCase() || 'N/A';
        const supply = new Intl.NumberFormat('en-US', {
          maximumFractionDigits: 0,
        }).format(num(row['Circulating Supply']));
        return `${supply} ${symbol}`;
      };
      const topRows = rows.slice(0, Math.min(rows.length, 12)).reverse();
      const total = rows.reduce((sum, row) => sum + num(row['Market Cap']), 0);
      const maxCap = Math.max(...topRows.map((row) => num(row['Market Cap'])), 1);
      const barLabels = topRows.map((row) => {
        const marketCap = num(row['Market Cap']);
        const share = total > 0 ? (marketCap / total) * 100 : 0;
        return `${fmtCompactMoney(marketCap)} · ${share.toFixed(1)}%`;
      });

      // Calculate max y-axis label width across both datasets to maintain consistent left margin
      const calcMaxYAxisLabelWidth = (snapshotData) => {
        const topRowsForCalc = snapshotData.slice(0, Math.min(snapshotData.length, 12));
        const yAxisLabels = topRowsForCalc.map((row) => `${row.Symbol} · ${row.Name}`);
        return yAxisLabels.reduce((maxWidth, label) => {
          return Math.max(maxWidth, measureTextWidth(label));
        }, 0);
      };

      const exclMaxYAxisWidth = calcMaxYAxisLabelWidth(state.datasets.excl.snapshot);
      const inclMaxYAxisWidth = calcMaxYAxisLabelWidth(state.datasets.incl.snapshot);
      const maxYAxisWidthPx = Math.max(exclMaxYAxisWidth, inclMaxYAxisWidth);

      // Calculate max label width across both datasets to maintain consistent right margin
      const calcMaxLabelWidth = (snapshotData) => {
        const topRowsForCalc = snapshotData.slice(0, Math.min(snapshotData.length, 12)).reverse();
        const totalForCalc = snapshotData.reduce((sum, row) => sum + num(row['Market Cap']), 0);
        const labelsForCalc = topRowsForCalc.map((row) => {
          const marketCap = num(row['Market Cap']);
          const share = totalForCalc > 0 ? (marketCap / totalForCalc) * 100 : 0;
          return `${fmtCompactMoney(marketCap)} · ${share.toFixed(1)}%`;
        });
        return labelsForCalc.reduce((maxWidth, label) => {
          return Math.max(maxWidth, measureTextWidth(label));
        }, 0);
      };

      const exclMaxLabelWidth = calcMaxLabelWidth(state.datasets.excl.snapshot);
      const inclMaxLabelWidth = calcMaxLabelWidth(state.datasets.incl.snapshot);
      const maxLabelWidthPx = Math.max(exclMaxLabelWidth, inclMaxLabelWidth);

      const snapshotChartEl = document.getElementById('snapshotChart');
      const hideSnapshotXAxisTickLabels = isStackedLayout();
      const barWidth = 0.56;
      const layoutMargin = {
        l: Math.ceil(maxYAxisWidthPx + 40),
        r: Math.ceil(clamp(maxLabelWidthPx + 6, 48, 96)),
        t: 18,
        b: hideSnapshotXAxisTickLabels ? 12 : 34,
      };
      const plotWidthPx = Math.max(1, (snapshotChartEl?.clientWidth || 0) - layoutMargin.l - layoutMargin.r);
      const plotHeightPx = Math.max(1, (snapshotChartEl?.clientHeight || 0) - layoutMargin.t - layoutMargin.b);
      const categoryStepPx = plotHeightPx / Math.max(1, topRows.length);
      const barHeightPx = Math.max(1, categoryStepPx * barWidth);
      const iconSizePx = barHeightPx;
      const iconSizeY = iconSizePx / categoryStepPx;
      const iconGapPx = barHeightPx / 2;
      const labelGapPx = clamp(barHeightPx * 0.35, 6, 12);
      const clusterOffsetPx = iconGapPx + iconSizePx + labelGapPx;
      const targetStep = maxCap / 4;
      const tickCandidates = [50e9, 100e9, 200e9, 250e9, 500e9, 1e12, 2e12, 2.5e12, 5e12];
      const tickStep = tickCandidates.find((candidate) => candidate >= targetStep) || 5e12;
      const clusterFraction = Math.min(0.3, Math.max(0, clusterOffsetPx / plotWidthPx));
      const requiredXMax = maxCap / Math.max(0.7, 1 - clusterFraction);
      const xMax = Math.ceil(Math.max(maxCap * 1.005, requiredXMax) / tickStep) * tickStep;
      const xAxisMax = xMax + tickStep * 0.06;
      const tickvals = [];
      for (let current = 0; current <= xMax; current += tickStep) {
        tickvals.push(current);
      }
      const pxToX = xAxisMax / plotWidthPx;
      const iconXOffset = iconGapPx * pxToX;
      const labelXOffset = (iconGapPx + iconSizePx + labelGapPx) * pxToX;
      const iconImages = topRows.map((row) => {
        const marketCap = num(row['Market Cap']);
        const iconUrl = getSnapshotIconUrl(row);
        const circularIconSource = getCircularSnapshotIconSource(iconUrl);
        if (!circularIconSource || !Number.isFinite(marketCap)) return null;
        return {
          source: circularIconSource,
          xref: 'x',
          yref: 'y',
          x: marketCap + iconXOffset,
          y: `${row.Symbol} · ${row.Name}`,
          sizex: (iconSizePx / plotWidthPx) * xAxisMax,
          sizey: iconSizeY,
          xanchor: 'left',
          yanchor: 'middle',
          sizing: 'contain',
          opacity: 1,
          layer: 'above',
        };
      }).filter(Boolean);
      const yLabels = topRows.map((row) => `${row.Symbol} · ${row.Name}`);

      Plotly.react('snapshotChart', [{
        type: 'bar',
        orientation: 'h',
        width: barWidth,
        x: topRows.map((row) => num(row['Market Cap'])),
        y: yLabels,
        customdata: topRows.map((row) => {
          const marketCap = num(row['Market Cap']);
          const share = total > 0 ? marketCap / total : 0;
          return [
            fmtPriceForTooltip(row),
            fmtSupplyForTooltip(row),
            `${fmtCompactMoney(marketCap)} · ${(share * 100).toFixed(1)}%`,
          ];
        }),
        marker: {
          color: topRows.map((row) => {
            if (String(row['Primary Key']) === 'BTCBitcoin') return '#ff9f1c';
            if (String(row['Is Stable']).toLowerCase() === 'true') return STABLE_USD_GREEN;
            return _thIsLight ? 'rgba(0,0,0,0.28)' : 'rgba(255,255,255,0.34)';
          }),
        },
        hovertemplate: '%{y}<br>Price: %{customdata[0]}<br>Supply: %{customdata[1]}<br>Market cap: %{customdata[2]}<extra></extra>',
      }, {
        type: 'scatter',
        mode: 'text',
        x: topRows.map((row) => num(row['Market Cap']) + labelXOffset),
        y: yLabels,
        text: barLabels,
        textposition: 'middle right',
        textfont: { family: 'IBM Plex Mono, monospace', size: 11, color: _thFgDim },
        hoverinfo: 'skip',
        showlegend: false,
        cliponaxis: false,
      }], {
        paper_bgcolor: PLOTLY_LIVE_BG,
        plot_bgcolor: PLOTLY_LIVE_BG,
        hoverlabel: getPlotlyHoverlabel(),
        dragmode: false,
        margin: layoutMargin,
        showlegend: false,
        images: iconImages,
        xaxis: {
          automargin: true,
          ticklabelstandoff: hideSnapshotXAxisTickLabels ? 0 : 8,
          showticklabels: !hideSnapshotXAxisTickLabels,
          color: _thFgDim,
          gridcolor: _thGrid,
          tickmode: 'array',
          tickvals,
          ticktext: tickvals.map((value) => fmtAxisMarketCap(value)),
          range: [0, xAxisMax],
          fixedrange: true,
          tickfont: { family: 'IBM Plex Mono, monospace', size: 11 },
          showspikes: false,
        },
        yaxis: {
          automargin: false,
          ticklabelstandoff: 10,
          color: _thFgDim,
          fixedrange: true,
          tickfont: { family: 'IBM Plex Mono, monospace', size: 11 },
          showspikes: false,
        },
      }, {
        responsive: true,
        displayModeBar: false,
        displaylogo: false,
        scrollZoom: false,
        modeBarButtonsToRemove: ['zoom2d', 'pan2d', 'zoomIn2d', 'zoomOut2d', 'autoScale2d', 'resetScale2d', 'select2d', 'lasso2d', 'toggleSpikelines'],
      }).then(() => {
        requestAnimationFrame(() => bindSnapshotYAxisHover(yLabels));
      });
    }

    function bindSnapshotYAxisHover(yLabels) {
      const chartEl = document.getElementById('snapshotChart');
      if (!chartEl || !window.Plotly || !window.Plotly.Fx || !Array.isArray(yLabels) || !yLabels.length) return;

      if (typeof chartEl.__snapshotRowHoverCleanup === 'function') {
        chartEl.__snapshotRowHoverCleanup();
      }

      const labelToIndex = new Map(yLabels.map((label, idx) => [label, idx]));
      const tickNodes = Array.from(chartEl.querySelectorAll('.yaxislayer-above .ytick text'));
      const rowAnchors = tickNodes.map((node) => {
        const label = String(node.textContent || '').trim();
        const pointNumber = labelToIndex.get(label);
        if (!Number.isInteger(pointNumber)) return null;
        const rect = node.getBoundingClientRect();
        return {
          pointNumber,
          centerY: rect.top + rect.height / 2,
          node,
        };
      }).filter(Boolean);

      if (!rowAnchors.length) return;

      rowAnchors.sort((a, b) => a.centerY - b.centerY);
      const rowSteps = [];
      for (let i = 1; i < rowAnchors.length; i += 1) {
        rowSteps.push(Math.abs(rowAnchors[i].centerY - rowAnchors[i - 1].centerY));
      }
      const avgStep = rowSteps.length
        ? rowSteps.reduce((sum, val) => sum + val, 0) / rowSteps.length
        : 28;
      const maxSnapDistance = Math.max(10, avgStep * 0.62);

      let activePoint = null;
      const hoverPoint = (pointNumber) => {
        if (!Number.isInteger(pointNumber)) return;
        if (activePoint === pointNumber) return;
        activePoint = pointNumber;
        window.Plotly.Fx.hover(chartEl, [{ curveNumber: 0, pointNumber }], ['xy']);
      };
      const clearHover = () => {
        if (activePoint === null) return;
        activePoint = null;
        window.Plotly.Fx.unhover(chartEl);
      };

      const findNearestPoint = (clientY) => {
        let nearest = null;
        let nearestDist = Infinity;
        for (let i = 0; i < rowAnchors.length; i += 1) {
          const dist = Math.abs(clientY - rowAnchors[i].centerY);
          if (dist < nearestDist) {
            nearestDist = dist;
            nearest = rowAnchors[i];
          }
        }
        if (!nearest || nearestDist > maxSnapDistance) return null;
        return nearest.pointNumber;
      };

      const onChartMove = (event) => {
        const pointNumber = findNearestPoint(event.clientY);
        if (pointNumber === null) {
          clearHover();
          return;
        }
        hoverPoint(pointNumber);
      };
      const onChartLeave = () => {
        clearHover();
      };

      chartEl.addEventListener('mousemove', onChartMove);
      chartEl.addEventListener('mouseleave', onChartLeave);

      const labelListeners = [];
      rowAnchors.forEach(({ node, pointNumber }) => {
        node.style.pointerEvents = 'all';
        node.style.cursor = 'pointer';
        const onEnter = () => hoverPoint(pointNumber);
        const onMove = () => hoverPoint(pointNumber);
        node.addEventListener('mouseenter', onEnter);
        node.addEventListener('mousemove', onMove);
        labelListeners.push({ node, onEnter, onMove });
      });

      chartEl.__snapshotRowHoverCleanup = () => {
        chartEl.removeEventListener('mousemove', onChartMove);
        chartEl.removeEventListener('mouseleave', onChartLeave);
        labelListeners.forEach(({ node, onEnter, onMove }) => {
          node.removeEventListener('mouseenter', onEnter);
          node.removeEventListener('mousemove', onMove);
        });
        clearHover();
      };
    }

    function renderAll() {
      updateModeLabels();
      updateHistoryInputs();
      updateSnapshotMeta();
      renderStatusChips();
      setLastUpdated();
      if (state.showHistoryPanel) {
        renderHistoryChart();
      }
      if (state.showSnapshotPanel) {
        renderSnapshotChart();
      }
      setPanelLoaderVisible('history', false);
      setPanelLoaderVisible('snapshot', false);
      resizeVisibleCharts();
    }

    function scheduleSnapshotChartRender(force = false) {
      if (!state.showSnapshotPanel) return;
      if (!getCurrentSnapshot().length) return;
      const snapshotEl = document.getElementById('snapshotChart');
      if (!snapshotEl) return;
      if (snapshotResizeFrame) {
        cancelAnimationFrame(snapshotResizeFrame);
      }
      snapshotResizeFrame = requestAnimationFrame(() => {
        snapshotResizeFrame = 0;
        const width = Math.round(snapshotEl.clientWidth || 0);
        const height = Math.round(snapshotEl.clientHeight || 0);
        if (width <= 0 || height <= 0) return;
        const unchanged = width === lastSnapshotChartSize.width && height === lastSnapshotChartSize.height;
        if (!force && unchanged) return;
        lastSnapshotChartSize = { width, height };
        renderSnapshotChart();
      });
    }

    function resizeVisibleCharts() {
      if (!window.Plotly || !window.Plotly.Plots || typeof window.Plotly.Plots.resize !== 'function') return;
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          if (state.showHistoryPanel) {
            const historyEl = document.getElementById('dominanceChart');
            if (historyEl) window.Plotly.Plots.resize(historyEl);
          }
          if (state.showSnapshotPanel) {
            const snapshotEl = document.getElementById('snapshotChart');
            if (snapshotEl) window.Plotly.Plots.resize(snapshotEl);
            scheduleSnapshotChartRender(true);
          }
        });
      });
    }

    function installChartResizeObservers() {
      if (snapshotResizeObserver) {
        snapshotResizeObserver.disconnect();
        snapshotResizeObserver = null;
      }
      if (typeof ResizeObserver !== 'function') {
        window.addEventListener('resize', () => scheduleSnapshotChartRender(true));
        return;
      }
      const observedEls = [
        document.querySelector('.grid'),
        document.getElementById('snapshotPanel'),
        document.querySelector('.snapshot-chart-wrap'),
        document.getElementById('snapshotChart'),
      ].filter(Boolean);
      snapshotResizeObserver = new ResizeObserver(() => {
        scheduleSnapshotChartRender(false);
      });
      observedEls.forEach((el) => snapshotResizeObserver.observe(el));
    }

    function applyPanelSizing() {
      const grid = document.querySelector('.grid');
      const historyPanel = document.getElementById('historyPanel');
      const snapshotPanel = document.getElementById('snapshotPanel');
      const resizer = document.getElementById('panelResizer');
      if (!grid || !historyPanel || !snapshotPanel) return;

      const bothVisible = !historyPanel.hidden && !snapshotPanel.hidden;
      const stacked = isStackedLayout();
      grid.classList.toggle('stacked', stacked && bothVisible);
      grid.classList.toggle('swapped', Boolean(state.panelsSwapped));
      updateSwapControlOrientation();

      if (!bothVisible) {
        grid.style.gridTemplateColumns = '1fr';
        grid.style.gridTemplateRows = '1fr';
        grid.style.gap = '0px';
        if (resizer) resizer.hidden = true;
        return;
      }

      if (stacked) {
        grid.style.gap = '10px';
        grid.style.gridTemplateColumns = '1fr';
        const minHistoryHeight = STACKED_HISTORY_MIN_HEIGHT;
        const minSnapshotHeight = STACKED_SNAPSHOT_MIN_HEIGHT;
        const gridRect = grid.getBoundingClientRect();
        const gridAvailableHeight = Math.max(1, Math.round(gridRect.height - 10));
        const fallbackHistoryHeight = Math.max(minHistoryHeight, Math.round(gridAvailableHeight * STACKED_HISTORY_DEFAULT_RATIO));
        const fallbackSnapshotHeight = Math.max(minSnapshotHeight, gridAvailableHeight - fallbackHistoryHeight);

        const currentHistoryHeight = Math.max(minHistoryHeight, Math.round(historyPanel.getBoundingClientRect().height || fallbackHistoryHeight));
        const currentSnapshotHeight = Math.max(minSnapshotHeight, Math.round(snapshotPanel.getBoundingClientRect().height || fallbackSnapshotHeight));

        const historyHeight = Math.max(
          minHistoryHeight,
          Number(state.historyPanelManualHeight) > 0
            ? Number(state.historyPanelManualHeight)
            : (currentHistoryHeight || fallbackHistoryHeight)
        );
        const snapshotHeight = Math.max(
          minSnapshotHeight,
          Number(state.snapshotPanelManualHeight) > 0
            ? Number(state.snapshotPanelManualHeight)
            : (currentSnapshotHeight || fallbackSnapshotHeight)
        );
        if (state.panelsSwapped) {
          grid.style.gridTemplateRows = `minmax(${minSnapshotHeight}px, ${Math.round(snapshotHeight)}px) minmax(${minHistoryHeight}px, ${Math.round(historyHeight)}px)`;
        } else {
          grid.style.gridTemplateRows = `minmax(${minHistoryHeight}px, ${Math.round(historyHeight)}px) minmax(${minSnapshotHeight}px, ${Math.round(snapshotHeight)}px)`;
        }
        if (resizer) {
          resizer.hidden = true;
          resizer.setAttribute('aria-orientation', 'horizontal');
        }
      } else {
        grid.style.gap = '0px';
        const historyPercent = clamp(Number(state.historyPanelPercent) || 61.54, PANEL_SPLIT_MIN, PANEL_SPLIT_MAX);
        state.historyPanelPercent = historyPercent;
        grid.style.gridTemplateRows = '';
        const rightPercent = 100 - historyPercent;
        const leftPercent = state.panelsSwapped ? rightPercent : historyPercent;
        const finalRightPercent = 100 - leftPercent;
        grid.style.gridTemplateColumns = `minmax(0, ${leftPercent.toFixed(2)}%) var(--panel-resizer-width) minmax(0, ${finalRightPercent.toFixed(2)}%)`;
        if (resizer) {
          resizer.hidden = false;
          resizer.setAttribute('aria-orientation', 'vertical');
        }
      }
    }

    function updateSwapControlOrientation() {
      const swapBtn = document.getElementById('swapPanelsBtn');
      if (!swapBtn) return;
      swapBtn.classList.toggle('stacked', isStackedLayout());
      swapBtn.setAttribute('aria-pressed', state.panelsSwapped ? 'true' : 'false');
    }

    function applyPanelOrder() {
      const grid = document.querySelector('.grid');
      if (!grid) return;
      grid.classList.toggle('swapped', Boolean(state.panelsSwapped));
      applyPanelSizing();
    }

    function bindPanelResizeInteractions() {
      const panelResizer = document.getElementById('panelResizer');
      if (panelResizer) {
        let draggingPointerId = null;

        const applySplitFromPointer = (clientX) => {
          if (isStackedLayout()) return;
          const grid = document.querySelector('.grid');
          const historyPanel = document.getElementById('historyPanel');
          const snapshotPanel = document.getElementById('snapshotPanel');
          if (!grid || !historyPanel || !snapshotPanel || historyPanel.hidden || snapshotPanel.hidden) return;
          const rect = grid.getBoundingClientRect();
          if (!rect.width) return;
          const leftPercent = clamp(((clientX - rect.left) / rect.width) * 100, PANEL_SPLIT_MIN, PANEL_SPLIT_MAX);
          state.historyPanelPercent = applyCenterSnap(leftPercent);
          applyPanelSizing();
          updateResetButtonUi();
          resizeVisibleCharts();
        };

        const stopDragging = () => {
          if (draggingPointerId == null) return;
          draggingPointerId = null;
          panelResizer.classList.remove('dragging');
          document.body.classList.remove('resizing-panels');
          saveLayoutToStorage();
          updateResetButtonUi();
        };

        panelResizer.addEventListener('pointerdown', (event) => {
          if (event.button !== 0 || isStackedLayout()) return;
          const historyPanel = document.getElementById('historyPanel');
          const snapshotPanel = document.getElementById('snapshotPanel');
          if (!historyPanel || !snapshotPanel || historyPanel.hidden || snapshotPanel.hidden) return;
          draggingPointerId = event.pointerId;
          panelResizer.setPointerCapture(event.pointerId);
          panelResizer.classList.add('dragging');
          document.body.classList.add('resizing-panels');
          applySplitFromPointer(event.clientX);
        });

        panelResizer.addEventListener('pointermove', (event) => {
          if (draggingPointerId !== event.pointerId) return;
          applySplitFromPointer(event.clientX);
        });

        panelResizer.addEventListener('pointerup', (event) => {
          if (draggingPointerId !== event.pointerId) return;
          stopDragging();
        });

        panelResizer.addEventListener('pointercancel', stopDragging);
        panelResizer.addEventListener('lostpointercapture', stopDragging);

        panelResizer.addEventListener('keydown', (event) => {
          if (isStackedLayout()) return;
          const adjustStep = event.shiftKey ? 3 : 1;
          if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
          event.preventDefault();
          const direction = event.key === 'ArrowRight' ? 1 : -1;
          state.historyPanelPercent = applyCenterSnap(
            clamp(state.historyPanelPercent + (direction * adjustStep), PANEL_SPLIT_MIN, PANEL_SPLIT_MAX)
          );
          applyPanelSizing();
          saveLayoutToStorage();
          updateResetButtonUi();
          resizeVisibleCharts();
        });
      }

      const bindPanelResizeHandle = (handle, panelKey, minHeight = 60) => {
        if (!handle) return;
        let draggingPointerId = null;

        handle.addEventListener('pointerdown', (ev) => {
          ev.preventDefault();
          if (ev.button !== 0 || !isStackedLayout()) return;
          
          const historyPanel = document.getElementById('historyPanel');
          const snapshotPanel = document.getElementById('snapshotPanel');
          if (!historyPanel || !snapshotPanel || historyPanel.hidden || snapshotPanel.hidden) return;

          const startY = ev.clientY;
          const historyStartHeight = historyPanel.getBoundingClientRect().height;
          const snapshotStartHeight = snapshotPanel.getBoundingClientRect().height;

          draggingPointerId = ev.pointerId;
          handle.setPointerCapture(ev.pointerId);
          handle.classList.add('dragging');
          document.body.classList.add('resizing-panel');

          const onPointerMove = (moveEv) => {
            if (draggingPointerId !== moveEv.pointerId) return;
            const deltaY = moveEv.clientY - startY;
            
            // Dragging down (positive deltaY) = expand the panel whose button is being dragged
            // Dragging up (negative deltaY) = shrink the panel whose button is being dragged
            const nextHeight = Math.max(minHeight, (panelKey === 'history' ? historyStartHeight : snapshotStartHeight) + deltaY);
            
            if (panelKey === 'history') {
              state.historyPanelManualHeight = nextHeight;
            } else {
              state.snapshotPanelManualHeight = nextHeight;
            }
            applyPanelSizing();
            updateResetButtonUi();
            resizeVisibleCharts();
          };

          const stopResize = (stopEv) => {
            if (draggingPointerId == null || (stopEv && draggingPointerId !== stopEv.pointerId)) return;
            draggingPointerId = null;
            handle.classList.remove('dragging');
            document.body.classList.remove('resizing-panel');
            handle.removeEventListener('pointermove', onPointerMove);
            handle.removeEventListener('pointerup', stopResize);
            handle.removeEventListener('pointercancel', stopResize);
            handle.removeEventListener('lostpointercapture', stopResize);
            if (handle.hasPointerCapture(ev.pointerId)) {
              handle.releasePointerCapture(ev.pointerId);
            }
            saveLayoutToStorage();
            updateResetButtonUi();
          };

          handle.addEventListener('pointermove', onPointerMove);
          handle.addEventListener('pointerup', stopResize);
          handle.addEventListener('pointercancel', stopResize);
          handle.addEventListener('lostpointercapture', stopResize);
        });
      };

      bindPanelResizeHandle(document.getElementById('historyResizeHandle'), 'history', 60);
      bindPanelResizeHandle(document.getElementById('snapshotResizeHandle'), 'snapshot', 60);

      window.addEventListener('resize', () => {
        applyPanelSizing();
        resizeVisibleCharts();
      });
    }

    function syncPanelToggleUi() {
      const historyToggle = document.getElementById('toggleHistoryPanel');
      const snapshotToggle = document.getElementById('toggleSnapshotPanel');
      if (historyToggle) historyToggle.checked = state.showHistoryPanel;
      if (snapshotToggle) snapshotToggle.checked = state.showSnapshotPanel;
    }

    function applyPanelVisibility() {
      const historyPanel = document.getElementById('historyPanel');
      const snapshotPanel = document.getElementById('snapshotPanel');
      const grid = document.querySelector('.grid');

      if (historyPanel) {
        historyPanel.hidden = !state.showHistoryPanel;
      }
      if (snapshotPanel) {
        snapshotPanel.hidden = !state.showSnapshotPanel;
      }

      const oneVisible = state.showHistoryPanel !== state.showSnapshotPanel;
      grid?.classList.toggle('single-panel', oneVisible);
      const swapBtn = document.getElementById('swapPanelsBtn');
      if (swapBtn) {
        swapBtn.disabled = !(state.showHistoryPanel && state.showSnapshotPanel);
      }
      syncSwapButtonEnabledState();
      applyPanelSizing();
    }

    function bindControls() {
      bindCustomTooltips();
      const updatedTimeZoneSelect = document.getElementById('updatedTimeZoneSelect');
      const includeStablesToggle = document.getElementById('toggleIncludeStables');
      const stackedDominanceToggle = document.getElementById('toggleStackedDominance');
      const showPriceToggle = document.getElementById('toggleShowPrice');
      const historyToggle = document.getElementById('toggleHistoryPanel');
      const snapshotToggle = document.getElementById('toggleSnapshotPanel');
      const rangeSelect = document.getElementById('rangeSelect');
      const smoothSelect = document.getElementById('smoothSelect');
      const swapPanelsBtn = document.getElementById('swapPanelsBtn');
      const copyDashboardLinkButton = document.getElementById('copyDashboardLink');
      const resetDashboardButton = document.getElementById('resetDashboard');

      setCustomTooltip(copyDashboardLinkButton, 'Copy shareable dashboard link');
      setCustomTooltip(resetDashboardButton, state.preResetStateSnapshot ? 'Undo the last restore defaults action' : 'Reset dashboard to defaults');

      updatedTimeZoneSelect?.addEventListener('change', () => {
        state.timeZone = DASHBOARD_TIME?.setPreferredTimeZone?.(updatedTimeZoneSelect.value) || updatedTimeZoneSelect.value;
        setLastUpdated();
        saveControlsToStorage();
        updateResetButtonUi();
      });

      includeStablesToggle?.addEventListener('change', () => {
        state.includeStables = !!includeStablesToggle.checked;
        saveControlsToStorage();
        updateResetButtonUi();
        renderAll();
      });

      stackedDominanceToggle?.addEventListener('change', () => {
        state.stackedDominance = !!stackedDominanceToggle.checked;
        state.stackedDominanceTouched = true;
        saveControlsToStorage();
        updateResetButtonUi();
        renderHistoryChart();
        resizeVisibleCharts();
      });

      showPriceToggle?.addEventListener('change', () => {
        state.showPrice = !!showPriceToggle.checked;
        saveControlsToStorage();
        updateResetButtonUi();
        renderHistoryChart();
        resizeVisibleCharts();
      });

      rangeSelect?.addEventListener('change', () => {
        state.range = rangeSelect.value;
        state.historyUserXAxisRange = null;
        saveControlsToStorage();
        updateResetButtonUi();
        renderHistoryChart();
      });

      smoothSelect?.addEventListener('change', () => {
        state.smooth = smoothSelect.value;
        saveControlsToStorage();
        updateResetButtonUi();
        renderHistoryChart();
      });

      historyToggle?.addEventListener('change', () => {
        const nextHistory = !!historyToggle.checked;
        const nextSnapshot = !!snapshotToggle?.checked;
        if (!nextHistory && !nextSnapshot) {
          historyToggle.checked = true;
          return;
        }
        state.showHistoryPanel = nextHistory;
        state.showSnapshotPanel = nextSnapshot;
        saveControlsToStorage();
        updateResetButtonUi();
        syncPanelToggleUi();
        applyPanelVisibility();
        if (state.showHistoryPanel) {
          renderHistoryChart();
        }
        if (state.showSnapshotPanel) {
          renderSnapshotChart();
        }
        resizeVisibleCharts();
      });

      snapshotToggle?.addEventListener('change', () => {
        const nextSnapshot = !!snapshotToggle.checked;
        const nextHistory = !!historyToggle?.checked;
        if (!nextSnapshot && !nextHistory) {
          snapshotToggle.checked = true;
          return;
        }
        state.showSnapshotPanel = nextSnapshot;
        state.showHistoryPanel = nextHistory;
        saveControlsToStorage();
        updateResetButtonUi();
        syncPanelToggleUi();
        applyPanelVisibility();
        if (state.showHistoryPanel) {
          renderHistoryChart();
        }
        if (state.showSnapshotPanel) {
          renderSnapshotChart();
        }
        resizeVisibleCharts();
      });

      swapPanelsBtn?.addEventListener('click', () => {
        state.panelsSwapped = !state.panelsSwapped;
        applyPanelOrder();
        saveControlsToStorage();
        updateResetButtonUi();
        resizeVisibleCharts();
      });

      copyDashboardLinkButton?.addEventListener('click', async () => {
        try {
          await copyDashboardLinkToClipboard(copyDashboardLinkButton);
        } catch (err) {
          console.error(err);
        }
      });

      resetDashboardButton?.addEventListener('click', () => {
        if (state.preResetStateSnapshot) {
          restorePreviousDashboardState();
        } else {
          restoreDashboardDefaults();
        }
      });
    }

    function applyEmbeddedModalLayout() {
      window.WSBDashboardShared?.applyEmbeddedModalTopClearance?.();
    }

    async function init() {
      applyEmbeddedModalLayout();
      hideError();
      setControlsEnabled(false);
      
      try {
        // Load stored preferences before showing UI
        loadControlsFromStorage();
        loadLayoutFromStorage();
        applyDashboardShareStateFromUrl();
        
        // Apply panel visibility and sizing before showing loaders
        // This ensures the layout is correct from the start
        applyPanelVisibility();
        syncPanelToggleUi();
        
        // Now show loaders with correct layout already in place
        setPanelLoaderVisible('history', true);
        setPanelLoaderVisible('snapshot', true);
        
        const data = await loadDashboardData(CARD_PREVIEW_CACHE_BUST);
        state.staticMeta = data.staticMeta;
        state.datasets = data.datasets;
        state.priceHistory = data.priceHistory;
        state.refreshedAtText = data.refreshedAtText;
        state.dataSignature = data.signature;
        state.lastSuccessfulRefreshAt = Date.now();

        if (!state.datasets.excl.history.length) {
          throw new Error('No rows found in btcd_timeseries.csv.');
        }
        if (!state.datasets.excl.snapshot.length) {
          throw new Error('No rows found in top10_daily_excl_stables.csv.');
        }

        // Re-apply visibility/sizing now that data is loaded.
        applyPanelVisibility();
        syncPanelToggleUi();

        const includeStablesToggle = document.getElementById('toggleIncludeStables');
        const stackedDominanceToggle = document.getElementById('toggleStackedDominance');
        const showPriceToggle = document.getElementById('toggleShowPrice');
        const rangeSelect = document.getElementById('rangeSelect');
        const smoothSelect = document.getElementById('smoothSelect');
        if (includeStablesToggle) includeStablesToggle.checked = state.includeStables;
        if (stackedDominanceToggle) stackedDominanceToggle.checked = state.stackedDominance;
        if (showPriceToggle) showPriceToggle.checked = state.showPrice;
        if (rangeSelect && Array.from(rangeSelect.options).some((opt) => opt.value === state.range)) {
          rangeSelect.value = state.range;
        }
        if (smoothSelect && Array.from(smoothSelect.options).some((opt) => opt.value === state.smooth)) {
          smoothSelect.value = state.smooth;
        }
        populateUpdatedTimeZoneSelect();
        bindControls();
        updateResetButtonUi();
        bindPanelResizeInteractions();
        installChartResizeObservers();
        applyPanelOrder();
        renderAll();
        // Ensure button state is properly set after all rendering completes
        if (typeof window.requestIdleCallback === 'function') {
          window.requestIdleCallback(() => updateResetButtonUi(), { timeout: 500 });
        } else {
          window.setTimeout(() => updateResetButtonUi(), 100);
        }
        if (!IS_CARD_PREVIEW) {
          setupRefreshWakeEvents();
          startAutoRefresh();
        }
        setControlsEnabled(true);
      } catch (error) {
        console.error(error);
        showError(`Dashboard data failed to load: ${error.message || error}`);
        setPanelLoaderVisible('history', false);
        setPanelLoaderVisible('snapshot', false);
        setControlsEnabled(true);
      }
    }

    window.addEventListener('DOMContentLoaded', async () => {
      setControlsEnabled(false);

      const startInteractiveBootstrap = async () => {
        try {
          await Promise.race([
            ensurePlotlyLoaded(),
            new Promise((_, reject) => setTimeout(() => reject(new Error('Timed out loading Plotly.')), 12000)),
          ]);
          await init();
        } catch (error) {
          console.error(error);
          showError(`Plotly failed to load: ${error.message || error}`);
          setPanelLoaderVisible('history', false);
          setPanelLoaderVisible('snapshot', false);
          setControlsEnabled(true);
        }
      };

      if (IS_CARD_PREVIEW) {
        if (typeof window.requestIdleCallback === 'function') {
          window.requestIdleCallback(() => {
            void startInteractiveBootstrap();
          }, { timeout: 1200 });
        } else {
          window.setTimeout(() => {
            void startInteractiveBootstrap();
          }, 120);
        }
        return;
      }

      await startInteractiveBootstrap();
    });
