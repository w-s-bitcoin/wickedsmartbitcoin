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
      if (state.history.length) {
        renderHistoryChart({ preserveViewport: true });
        if (state.software.length) renderSoftwarePanel();
      }
    });
    /* ────────────────────────────────────────────────────────────────── */
    const CONTROLS_STORAGE_KEY = 'node_count_dashboard_controls_v2';
    const DASHBOARD_TIME = window.WSBDashboardTime || null;
    const MOBILE_STACK_BREAKPOINT = 1100;
    const PANEL_SPLIT_MIN = 34;
    const PANEL_SPLIT_MAX = 72;
    const PANEL_SPLIT_STACK_MIN = 10;
    const PANEL_SPLIT_STACK_MAX = 90;
    const PANEL_SPLIT_CENTER = 50;
    const PANEL_SPLIT_SNAP_DISTANCE = 1.2;
    const AUTO_REFRESH_MS = 60000;
    const FORCE_REFRESH_MS = 3600000;
    const IS_CARD_PREVIEW = document.documentElement.classList.contains('card-preview');
    const FETCH_CACHE_MODE = IS_CARD_PREVIEW ? 'force-cache' : 'no-store';
    // Bust the cache once per UTC day in card-preview so data is never more than 24 h stale.
    const CARD_PREVIEW_CACHE_BUST = IS_CARD_PREVIEW
      ? new Date().toISOString().slice(0, 10).replace(/-/g, '')
      : null;
    const SOFTWARE_SPLIT_MIN = 32;
    const SOFTWARE_SPLIT_MAX = 78;

    function parseCsv(text) {
      const rows = [];
      let row = [];
      let value = "";
      let inQuotes = false;
      for (let i = 0; i < text.length; i += 1) {
        const ch = text[i];
        const next = text[i + 1];
        if (ch === '"') {
          if (inQuotes && next === '"') {
            value += '"';
            i += 1;
          } else {
            inQuotes = !inQuotes;
          }
          continue;
        }
        if (ch === ',' && !inQuotes) {
          row.push(value);
          value = "";
          continue;
        }
        if ((ch === '\n' || ch === '\r') && !inQuotes) {
          if (ch === '\r' && next === '\n') i += 1;
          row.push(value);
          const hasContent = row.some((cell) => String(cell).trim() !== "");
          if (hasContent) rows.push(row);
          row = [];
          value = "";
          continue;
        }
        value += ch;
      }
      if (value.length || row.length) {
        row.push(value);
        rows.push(row);
      }
      if (!rows.length) return [];
      const headers = rows[0].map((h) => String(h || "").trim());
      return rows.slice(1).map((r) => {
        const obj = {};
        headers.forEach((h, idx) => {
          obj[h] = r[idx] == null ? "" : String(r[idx]);
        });
        return obj;
      });
    }

    function num(v) {
      const n = Number(String(v).replaceAll(',', '').trim());
      return Number.isFinite(n) ? n : 0;
    }

    function numOrNull(v) {
      const raw = String(v ?? '').replaceAll(',', '').trim();
      if (!raw) return null;
      const n = Number(raw);
      return Number.isFinite(n) ? n : null;
    }

    function fmtInt(v) {
      return Number(v || 0).toLocaleString('en-US', { maximumFractionDigits: 0 });
    }

    function fmtPct(v) {
      return `${Number(v || 0).toFixed(2)}%`;
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

    function maskLeadingZeros(values) {
      const firstNonZeroIndex = values.findIndex((v) => Number(v) > 0);
      if (firstNonZeroIndex < 0) return values.map(() => null);
      if (firstNonZeroIndex === 0) return values.slice();
      return values.map((v, idx) => (idx < firstNonZeroIndex ? null : v));
    }

    function clamp(value, min, max) {
      return Math.max(min, Math.min(max, value));
    }

    function applyCenterSnap(percent) {
      return Math.abs(percent - PANEL_SPLIT_CENTER) <= PANEL_SPLIT_SNAP_DISTANCE
        ? PANEL_SPLIT_CENTER
        : percent;
    }

    async function fetchTextWithFallback(primary, fallback) {
      const first = await fetch(primary, { cache: FETCH_CACHE_MODE });
      if (first.ok) return first.text();
      if (!fallback) throw new Error(`Failed to load ${primary} (${first.status})`);
      const second = await fetch(fallback, { cache: FETCH_CACHE_MODE });
      if (!second.ok) throw new Error(`Failed to load ${fallback} (${second.status})`);
      return second.text();
    }

    function withCacheBust(path, cacheBust = null) {
      if (cacheBust == null) return path;
      const separator = path.includes('?') ? '&' : '?';
      return `${path}${separator}_=${cacheBust}`;
    }

    async function fetchTextWithFallbackCacheBust(primary, fallback, cacheBust = null) {
      return fetchTextWithFallback(
        withCacheBust(primary, cacheBust),
        fallback ? withCacheBust(fallback, cacheBust) : fallback
      );
    }

    function sanitizeHistoryRows(rows) {
      if (!Array.isArray(rows) || !rows.length) return [];

      const cleaned = rows.filter((r) => {
        const t = new Date(r.datetime).getTime();
        return Number.isFinite(t);
      });
      if (cleaned.length < 3) return cleaned;

      const badIndexes = new Set();
      const totals = cleaned.map((r) => num(r.total_count));

      for (let i = 0; i < totals.length; i += 1) {
        if (!Number.isFinite(totals[i]) || totals[i] <= 0) {
          badIndexes.add(i);
        }
      }

      for (let i = 1; i < totals.length - 1; i += 1) {
        if (badIndexes.has(i)) continue;
        const prev = totals[i - 1];
        const curr = totals[i];
        const next = totals[i + 1];
        if (!(prev > 0 && curr > 0 && next > 0)) continue;

        const neighborLow = Math.min(prev, next);
        const neighborHigh = Math.max(prev, next);
        const neighborsAreClose = neighborLow > 0 && (neighborHigh / neighborLow) <= 1.25;
        const severeIsolatedDip = curr < (neighborLow * 0.72);

        if (neighborsAreClose && severeIsolatedDip) {
          badIndexes.add(i);
        }
      }

      if (!badIndexes.size) return cleaned;
      return cleaned.filter((_, idx) => !badIndexes.has(idx));
    }

    function getEmbedState() {
      const inIframe = window.self !== window.top;
      if (!inIframe) return false;
      try {
        const hostDoc = window.parent?.document;
        if (!hostDoc?.body) return false;
        return hostDoc.body.classList.contains('modal-open') || hostDoc.getElementById('modal');
      } catch (_) {
        return true;
      }
    }

    function applyEmbeddedModalLayout() {
      window.WSBDashboardShared?.applyEmbeddedModalTopClearance?.();
    }

    const state = {
      history: [],
      software: [],
      softwareExpandedKeys: new Set(),
      hiddenHistorySeries: new Set(),
      refreshedAtText: '',
      timeZone: DASHBOARD_TIME?.getPreferredTimeZone?.() || 'UTC',
      panelsSwapped: false,
      historyPanelPercent: 61.54,
      historyPanelStackPercent: 52,
      stackedTopPanelHeight: 0,
      historyPanelManualHeight: 0,
      softwarePanelManualHeight: 0,
      softwareChartPercent: 52,
      softwareChartStackPercent: 48,
      softwareContentHeightWide: 0,
      softwareContentHeightStack: 0,
      autoRefreshTimer: null,
      refreshInFlight: false,
      lastSuccessfulRefreshAt: 0,
      dataSignature: '',
    };

    function getDataSignature(historyRows, softwareRows, refreshedAtText) {
      const latestDatetime = historyRows.length
        ? String(historyRows[historyRows.length - 1].datetime || '').trim()
        : '';
      const refreshed = String(refreshedAtText || '').trim();
      return `${refreshed}|${latestDatetime}|${historyRows.length}|${softwareRows.length}`;
    }

    async function loadDashboardData(cacheBust = null) {
      const [historyCsv, softwareCsv, refreshedAtRaw] = await Promise.all([
        fetchTextWithFallbackCacheBust('webapp_data/bitcoin_node_history.csv', null, cacheBust),
        fetchTextWithFallbackCacheBust('webapp_data/node_software_counts_grouped.csv', null, cacheBust),
        fetchTextWithFallbackCacheBust('webapp_data/last_updated.txt', '../../assets/last_updated.txt', cacheBust).catch(() => ''),
      ]);

      const refreshedAtText = String(refreshedAtRaw || '').trim();
      const historyRows = sanitizeHistoryRows(
        parseCsv(historyCsv).map((r) => ({
          ...r,
          datetime: r.datetime || (r.timestamp ? new Date(num(r.timestamp) * 1000).toISOString() : ''),
        })).filter((r) => !!r.datetime)
      );
      const softwareRows = parseCsv(softwareCsv);

      return {
        historyRows,
        softwareRows,
        refreshedAtText,
        signature: getDataSignature(historyRows, softwareRows, refreshedAtText),
      };
    }

    async function fetchLatestDataSignature() {
      const refreshedAtRaw = await fetchTextWithFallbackCacheBust(
        'webapp_data/last_updated.txt',
        '../../assets/last_updated.txt',
        Date.now()
      ).catch(() => '');
      return String(refreshedAtRaw || '').trim();
    }

    async function refreshIfDataChanged({ force = false } = {}) {
      if (state.refreshInFlight) return;
      state.refreshInFlight = true;

      try {
        if (!force) {
          const latestStamp = await fetchLatestDataSignature();
          const currentStamp = String(state.refreshedAtText || '').trim();
          if (latestStamp && currentStamp && latestStamp === currentStamp) {
            return;
          }
        }

        setPanelLoaderVisible('history', true);
        setPanelLoaderVisible('software', true);

        const data = await loadDashboardData(Date.now());
        if (!data.historyRows.length) {
          throw new Error('No history rows found in node count dataset.');
        }
        if (!data.softwareRows.length) {
          throw new Error('No software rows found in grouped software dataset.');
        }

        state.history = data.historyRows;
        state.software = data.softwareRows;
        state.refreshedAtText = data.refreshedAtText;
        state.dataSignature = data.signature;
        state.lastSuccessfulRefreshAt = Date.now();

        setLastUpdated();
        renderHistoryChart();
        renderSoftwarePanel();
      } catch (err) {
        console.warn('Auto-refresh check failed:', err);
      } finally {
        state.refreshInFlight = false;
        setPanelLoaderVisible('history', false);
        setPanelLoaderVisible('software', false);
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

    function isStackedLayout() {
      return window.matchMedia(`(max-width: ${MOBILE_STACK_BREAKPOINT}px)`).matches;
    }

    function getPreferredDashboardTimeZone() {
      if (!DASHBOARD_TIME?.getPreferredTimeZone) return state.timeZone || 'UTC';
      return DASHBOARD_TIME.getPreferredTimeZone();
    }

    function setPreferredDashboardTimeZone(value) {
      if (!DASHBOARD_TIME?.setPreferredTimeZone) {
        state.timeZone = String(value || 'UTC').trim() || 'UTC';
        return state.timeZone;
      }
      state.timeZone = DASHBOARD_TIME.setPreferredTimeZone(value);
      return state.timeZone;
    }

    function getDashboardTimeZoneOptions() {
      if (!DASHBOARD_TIME?.getTimeZoneOptions) {
        return [{ value: 'UTC', label: 'UTC - Greenwich Mean Time (GMT)' }];
      }
      return DASHBOARD_TIME.getTimeZoneOptions();
    }

    function formatUpdatedForSelectedTimeZone(value) {
      const raw = String(value || '').trim();
      if (!raw) return '';

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

      if (DASHBOARD_TIME?.formatUtcTimestamp) {
        const normalized = raw.endsWith('UTC')
          ? `${raw.replace(/\s+UTC$/, '').replace(' ', 'T')}Z`
          : raw;
        return withParenthesizedZone(
          DASHBOARD_TIME.formatUtcTimestamp(normalized, state.timeZone || 'UTC').text
        );
      }

      const stamp = new Date(raw.endsWith('UTC') ? `${raw.replace(/\s+UTC$/, '').replace(' ', 'T')}Z` : raw);
      if (Number.isNaN(stamp.getTime())) return raw;
      return withParenthesizedZone(`${stamp.toISOString().replace('T', ' ').slice(0, 16)} UTC`);
    }

    function getUpdatedRawValue() {
      if (state.refreshedAtText) return state.refreshedAtText;
      if (!state.history.length) return '';
      const latest = state.history
        .slice()
        .sort((a, b) => new Date(a.datetime) - new Date(b.datetime))
        .at(-1);
      if (!latest) return '';
      const stamp = new Date(latest.datetime);
      return `${stamp.toISOString().replace('T', ' ').slice(0, 16)} UTC`;
    }

    function populateUpdatedTimeZoneSelect() {
      const select = document.getElementById('updatedTimeZoneSelect');
      if (!select) return;
      const preferred = getPreferredDashboardTimeZone();
      state.timeZone = preferred;
      const options = getDashboardTimeZoneOptions();
      select.innerHTML = options.map((opt) => {
        const selected = opt.value === preferred ? ' selected' : '';
        return `<option value="${opt.value}"${selected}>${opt.label}</option>`;
      }).join('');
    }

    function bindTimeZoneChipEvents() {
      const select = document.getElementById('updatedTimeZoneSelect');
      if (!select) return;
      select.addEventListener('change', () => {
        setPreferredDashboardTimeZone(select.value);
        setLastUpdated();
      });
    }

    function loadControlsFromStorage() {
      try {
        const raw = localStorage.getItem(CONTROLS_STORAGE_KEY);
        if (!raw) return;
        const parsed = JSON.parse(raw);

        const range = String(parsed.range || '');
        const smooth = String(parsed.smooth || '');
        const topN = Number(parsed.topN);
        const showHistory = parsed.showHistoryPanel;
        const showSoftware = parsed.showSoftwarePanel;
        const panelsSwapped = parsed.panelsSwapped;
        const historyPanelPercent = Number(parsed.historyPanelPercent);
        const historyPanelStackPercent = Number(parsed.historyPanelStackPercent);
        // Heights are stored as ratios of window.innerHeight; convert back to pixels.
        const vh = window.innerHeight || 1;
        const stackedTopPanelHeight = Number(parsed.stackedTopPanelHeight) * vh;
        const historyPanelManualHeight = Number(parsed.historyPanelManualHeight) * vh;
        const softwarePanelManualHeight = Number(parsed.softwarePanelManualHeight) * vh;
        const softwareChartPercent = Number(parsed.softwareChartPercent);
        const softwareChartStackPercent = Number(parsed.softwareChartStackPercent);
        const hiddenHistorySeries = Array.isArray(parsed.hiddenHistorySeries)
          ? parsed.hiddenHistorySeries
          : [];

        const rangeSelect = document.getElementById('rangeSelect');
        const smoothSelect = document.getElementById('smoothSelect');
        const topNInput = document.getElementById('topNInput');
        const toggleHistoryPanel = document.getElementById('toggleHistoryPanel');
        const toggleSoftwarePanel = document.getElementById('toggleSoftwarePanel');

        if (range && Array.from(rangeSelect.options).some((o) => o.value === range)) rangeSelect.value = range;
        if (smooth && Array.from(smoothSelect.options).some((o) => o.value === smooth)) smoothSelect.value = smooth;

        const minTopN = Number(topNInput.min || 6);
        const maxTopN = Number(topNInput.max || 30);
        if (Number.isFinite(topN)) {
          topNInput.value = String(Math.max(minTopN, Math.min(maxTopN, topN)));
        }

        if (typeof showHistory === 'boolean' && toggleHistoryPanel) toggleHistoryPanel.checked = showHistory;
        if (typeof showSoftware === 'boolean' && toggleSoftwarePanel) toggleSoftwarePanel.checked = showSoftware;
        if (typeof panelsSwapped === 'boolean') state.panelsSwapped = panelsSwapped;
        if (Number.isFinite(historyPanelPercent)) {
          state.historyPanelPercent = clamp(historyPanelPercent, PANEL_SPLIT_MIN, PANEL_SPLIT_MAX);
        }
        if (Number.isFinite(historyPanelStackPercent)) {
          state.historyPanelStackPercent = clamp(historyPanelStackPercent, PANEL_SPLIT_STACK_MIN, PANEL_SPLIT_STACK_MAX);
        }
        if (Number.isFinite(stackedTopPanelHeight) && stackedTopPanelHeight > 0) {
          state.stackedTopPanelHeight = stackedTopPanelHeight;
        }
        if (Number.isFinite(historyPanelManualHeight) && historyPanelManualHeight > 0) {
          state.historyPanelManualHeight = historyPanelManualHeight;
        }
        if (Number.isFinite(softwarePanelManualHeight) && softwarePanelManualHeight > 0) {
          state.softwarePanelManualHeight = softwarePanelManualHeight;
        }
        if (Number.isFinite(softwareChartPercent)) {
          state.softwareChartPercent = clamp(softwareChartPercent, SOFTWARE_SPLIT_MIN, SOFTWARE_SPLIT_MAX);
        }
        if (Number.isFinite(softwareChartStackPercent)) {
          state.softwareChartStackPercent = clamp(softwareChartStackPercent, SOFTWARE_SPLIT_MIN, SOFTWARE_SPLIT_MAX);
        }
        if (hiddenHistorySeries.length) {
          const allowed = new Set(['total', 'unreachable', 'listening', 'knots', 'core', 'bip110']);
          state.hiddenHistorySeries = new Set(
            hiddenHistorySeries
              .map((v) => String(v || '').trim())
              .filter((v) => allowed.has(v))
          );
        }
      } catch (_) {
      }
    }

    function saveControlsToStorage() {
      try {
        const toggleHistoryPanel = document.getElementById('toggleHistoryPanel');
        const toggleSoftwarePanel = document.getElementById('toggleSoftwarePanel');
        const payload = {
          range: document.getElementById('rangeSelect').value,
          smooth: document.getElementById('smoothSelect').value,
          topN: Number(document.getElementById('topNInput').value),
          showHistoryPanel: Boolean(toggleHistoryPanel?.checked ?? true),
          showSoftwarePanel: Boolean(toggleSoftwarePanel?.checked ?? true),
          panelsSwapped: Boolean(state.panelsSwapped),
          historyPanelPercent: Number(state.historyPanelPercent),
          historyPanelStackPercent: Number(state.historyPanelStackPercent),
          // Store heights as ratios of window.innerHeight so they restore correctly on different-sized screens.
          stackedTopPanelHeight: Number(state.stackedTopPanelHeight) > 0
            ? parseFloat((Number(state.stackedTopPanelHeight) / (window.innerHeight || 1)).toFixed(4))
            : 0,
          historyPanelManualHeight: Number(state.historyPanelManualHeight) > 0
            ? parseFloat((Number(state.historyPanelManualHeight) / (window.innerHeight || 1)).toFixed(4))
            : 0,
          softwarePanelManualHeight: Number(state.softwarePanelManualHeight) > 0
            ? parseFloat((Number(state.softwarePanelManualHeight) / (window.innerHeight || 1)).toFixed(4))
            : 0,
          softwareChartPercent: Number(state.softwareChartPercent),
          softwareChartStackPercent: Number(state.softwareChartStackPercent),
          hiddenHistorySeries: Array.from(state.hiddenHistorySeries),
        };
        localStorage.setItem(CONTROLS_STORAGE_KEY, JSON.stringify(payload));
      } catch (_) {
      }
    }

    function applySoftwarePanelSizing(options = {}) {
      const softwarePanel = document.querySelector('.software-panel');
      const softwareResizer = document.getElementById('softwareResizer');
      const panelHead = softwarePanel?.querySelector('.panel-head');
      if (!softwarePanel || softwarePanel.hidden || !panelHead) return;

      const { recalculateAvailableHeight = false } = options;

      const stacked = isStackedLayout();
      const chartPercent = clamp(
        Number(stacked ? state.softwareChartStackPercent : state.softwareChartPercent) || (stacked ? 48 : 52),
        SOFTWARE_SPLIT_MIN,
        SOFTWARE_SPLIT_MAX,
      );
      const tablePercent = 100 - chartPercent;

      if (stacked) {
        state.softwareChartStackPercent = chartPercent;
      } else {
        state.softwareChartPercent = chartPercent;
      }

      const styles = getComputedStyle(softwarePanel);
      const resizerSize = parseFloat(styles.getPropertyValue('--software-resizer-size')) || 14;
      const chartMinHeight = parseFloat(styles.getPropertyValue('--software-chart-min-height')) || 156;
      const tableMinHeight = parseFloat(styles.getPropertyValue('--software-table-min-height')) || 84;
      const minContentHeight = chartMinHeight + tableMinHeight;
      const panelRect = softwarePanel.getBoundingClientRect();
      const headRect = panelHead.getBoundingClientRect();
      const currentAvailableHeight = Math.max(
        minContentHeight,
        Math.round(panelRect.height - (headRect.bottom - panelRect.top) - resizerSize),
      );
      const cacheKey = stacked ? 'softwareContentHeightStack' : 'softwareContentHeightWide';

      if (
        recalculateAvailableHeight
        || !Number.isFinite(state[cacheKey])
        || state[cacheKey] <= 0
      ) {
        state[cacheKey] = currentAvailableHeight;
      }

      const totalContentHeight = Math.max(minContentHeight, Number(state[cacheKey]) || currentAvailableHeight);
      const maxChartHeight = Math.max(chartMinHeight, totalContentHeight - tableMinHeight);
      const chartHeight = clamp((totalContentHeight * chartPercent) / 100, chartMinHeight, maxChartHeight);
      const tableHeight = Math.max(tableMinHeight, totalContentHeight - chartHeight);

      softwarePanel.style.setProperty('--software-chart-fr', chartPercent.toFixed(2));
      softwarePanel.style.setProperty('--software-table-fr', tablePercent.toFixed(2));
      softwarePanel.style.gridTemplateRows = [
        'auto',
        `${chartHeight.toFixed(0)}px`,
        'var(--software-resizer-size)',
        `${tableHeight.toFixed(0)}px`
      ].join(' ');

      if (softwareResizer) {
        softwareResizer.setAttribute('aria-valuemin', String(SOFTWARE_SPLIT_MIN));
        softwareResizer.setAttribute('aria-valuemax', String(SOFTWARE_SPLIT_MAX));
        softwareResizer.setAttribute('aria-valuenow', String(Math.round(chartPercent)));
      }
    }

    function updateSwapControlOrientation() {
      const swapBtn = document.getElementById('swapPanelsBtn');
      if (!swapBtn) return;
      swapBtn.classList.toggle('stacked', isStackedLayout());
    }

    function getStackedSoftwareMinHeight(softwarePanel) {
      if (!softwarePanel) return 260;

      const panelHead = softwarePanel.querySelector('.panel-head');
      const softwareStyles = getComputedStyle(softwarePanel);
      const chartMinHeight = parseFloat(softwareStyles.getPropertyValue('--software-chart-min-height')) || 156;
      const tableMinHeight = parseFloat(softwareStyles.getPropertyValue('--software-table-min-height')) || 84;
      const softwareResizerSize = parseFloat(softwareStyles.getPropertyValue('--software-resizer-size')) || 14;
      const headHeight = panelHead ? Math.ceil(panelHead.getBoundingClientRect().height) : 44;
      const minSoftwarePanelHeight = Math.ceil(headHeight + chartMinHeight + tableMinHeight + softwareResizerSize);

      // Keep software panel usable in stacked mode; if viewport is short this pushes overflow to page scroll.
      softwarePanel.style.minHeight = `${minSoftwarePanelHeight}px`;
      return minSoftwarePanelHeight;
    }

    function applyPanelSizing() {
      const grid = document.querySelector('.grid');
      const historyPanel = document.querySelector('.history-panel');
      const softwarePanel = document.querySelector('.software-panel');
      const resizer = document.getElementById('panelResizer');
      if (!grid || !historyPanel || !softwarePanel) return;

      const stacked = isStackedLayout();
      const bothVisible = !historyPanel.hidden && !softwarePanel.hidden;

      grid.classList.toggle('stacked', stacked && bothVisible);
      updateSwapControlOrientation();

      if (!bothVisible || stacked) {
        if (!bothVisible) {
          grid.style.gridTemplateColumns = '1fr';
          grid.style.gridTemplateRows = '1fr';
          if (resizer) {
            resizer.hidden = true;
          }
          return;
        }
      }

      if (stacked) {
        const minSoftwarePanelHeight = getStackedSoftwareMinHeight(softwarePanel);
        const historyMinHeight = 180;
        const gridStyles = getComputedStyle(grid);
        const gridGap = parseFloat(gridStyles.getPropertyValue('gap')) || 0;
        const availableForPanels = Math.max(1, Math.round(grid.getBoundingClientRect().height - gridGap));
        const fallbackHistoryPercent = clamp(Number(state.historyPanelStackPercent) || 52, PANEL_SPLIT_STACK_MIN, PANEL_SPLIT_STACK_MAX);
        const fallbackHistoryHeight = Math.max(historyMinHeight, Math.round((availableForPanels * fallbackHistoryPercent) / 100));
        const fallbackSoftwareHeight = Math.max(minSoftwarePanelHeight, availableForPanels - fallbackHistoryHeight);

        const currentHistoryHeight = Math.max(historyMinHeight, Math.round(historyPanel.getBoundingClientRect().height || historyMinHeight));
        const currentSoftwareHeight = Math.max(minSoftwarePanelHeight, Math.round(softwarePanel.getBoundingClientRect().height || minSoftwarePanelHeight));

        if (!(Number(state.historyPanelManualHeight) > 0)) {
          state.historyPanelManualHeight = currentHistoryHeight || fallbackHistoryHeight;
        }
        if (!(Number(state.softwarePanelManualHeight) > 0)) {
          state.softwarePanelManualHeight = currentSoftwareHeight || fallbackSoftwareHeight;
        }

        const historyHeight = Math.max(historyMinHeight, Number(state.historyPanelManualHeight) || fallbackHistoryHeight);
        const softwareHeight = Math.max(minSoftwarePanelHeight, Number(state.softwarePanelManualHeight) || fallbackSoftwareHeight);

        grid.style.gridTemplateColumns = '1fr';
        if (state.panelsSwapped) {
          grid.style.gridTemplateRows = `minmax(${minSoftwarePanelHeight}px, ${Math.round(softwareHeight)}px) minmax(${historyMinHeight}px, ${Math.round(historyHeight)}px)`;
        } else {
          grid.style.gridTemplateRows = `minmax(${historyMinHeight}px, ${Math.round(historyHeight)}px) minmax(${minSoftwarePanelHeight}px, ${Math.round(softwareHeight)}px)`;
        }
      } else {
        softwarePanel.style.minHeight = '';
        const historyPercent = clamp(Number(state.historyPanelPercent) || 61.54, PANEL_SPLIT_MIN, PANEL_SPLIT_MAX);
        state.historyPanelPercent = historyPercent;
        const leftPercent = state.panelsSwapped ? (100 - historyPercent) : historyPercent;
        const rightPercent = 100 - leftPercent;
        grid.style.gridTemplateRows = '';
        grid.style.gridTemplateColumns = `minmax(0, ${leftPercent.toFixed(2)}%) var(--panel-resizer-width) minmax(0, ${rightPercent.toFixed(2)}%)`;
      }

      if (resizer) {
        resizer.hidden = false;
      }

      applySoftwarePanelSizing({ recalculateAvailableHeight: true });
    }

    function applyPanelOrder() {
      const grid = document.querySelector('.grid');
      if (!grid) return;
      grid.classList.toggle('swapped', Boolean(state.panelsSwapped));
      applyPanelSizing();
      const swapBtn = document.getElementById('swapPanelsBtn');
      if (swapBtn) {
        swapBtn.setAttribute('aria-pressed', state.panelsSwapped ? 'true' : 'false');
      }
    }

    function applyPanelVisibility() {
      const toggleHistory = document.getElementById('toggleHistoryPanel');
      const toggleSoftware = document.getElementById('toggleSoftwarePanel');
      const grid = document.querySelector('.grid');
      const historyPanel = document.querySelector('.history-panel');
      const softwarePanel = document.querySelector('.software-panel');
      const panelResizer = document.getElementById('panelResizer');

      let showHistory = toggleHistory ? Boolean(toggleHistory.checked) : true;
      let showSoftware = toggleSoftware ? Boolean(toggleSoftware.checked) : true;

      // Failsafe: keep at least one panel visible.
      if (!showHistory && !showSoftware) {
        showHistory = true;
        if (toggleHistory) toggleHistory.checked = true;
      }

      if (historyPanel) {
        historyPanel.hidden = !showHistory;
        historyPanel.style.display = showHistory ? '' : 'none';
      }
      if (softwarePanel) {
        softwarePanel.hidden = !showSoftware;
        softwarePanel.style.display = showSoftware ? '' : 'none';
      }

      if (grid) {
        grid.classList.toggle('single-panel', showHistory !== showSoftware);
      }

      if (panelResizer) {
        panelResizer.hidden = !(showHistory && showSoftware);
      }

      const swapBtn = document.getElementById('swapPanelsBtn');
      if (swapBtn) {
        const bothVisible = showHistory && showSoftware;
        swapBtn.disabled = !bothVisible;
      }

      applyPanelSizing();
      applySoftwarePanelSizing({ recalculateAvailableHeight: true });

      if (window.Plotly) {
        requestAnimationFrame(() => {
          if (showHistory) Plotly.Plots.resize('historyChart');
          if (showSoftware) Plotly.Plots.resize('softwareChart');
          if (showHistory) updateHistoryLegendSizing();
        });
      }
    }

    function getPlotlyHoverlabel() {
      const style = getComputedStyle(document.documentElement);
      const isLight = document.documentElement.dataset.theme === 'light';
      return {
        bgcolor: style.getPropertyValue('--panel').trim() || (isLight ? '#ffffff' : '#000000'),
        bordercolor: isLight ? 'rgba(0, 0, 0, 0.12)' : '#223038',
        font: {
          family: '"IBM Plex Mono", monospace',
          color: style.getPropertyValue('--fg').trim() || (isLight ? '#1c1b19' : '#e9f1f5'),
          size: 12,
        },
        align: 'left',
      };
    }

    const PLOTLY_LIVE_BG = 'rgba(0,0,0,0)';
    const PLOTLY_EXPORT_BG = '#000';

    async function downloadPlotlyChartWithBlackBackground(chartId, filename) {
      if (!window.Plotly) return;

      const sourceEl = document.getElementById(chartId);
      if (!sourceEl?.data || !sourceEl?.layout) return;

      const rect = sourceEl.getBoundingClientRect();
      const width = Math.max(1, Math.round(rect.width || sourceEl.clientWidth || 1200));
      const height = Math.max(1, Math.round(rect.height || sourceEl.clientHeight || 700));
      const exportHost = document.createElement('div');

      exportHost.style.position = 'fixed';
      exportHost.style.left = '-10000px';
      exportHost.style.top = '0';
      exportHost.style.width = `${width}px`;
      exportHost.style.height = `${height}px`;
      exportHost.style.opacity = '0';
      exportHost.style.pointerEvents = 'none';
      document.body.appendChild(exportHost);

      try {
        const exportData = JSON.parse(JSON.stringify(sourceEl.data));
        const exportLayout = JSON.parse(JSON.stringify(sourceEl.layout));
        exportLayout.paper_bgcolor = PLOTLY_EXPORT_BG;
        exportLayout.plot_bgcolor = PLOTLY_EXPORT_BG;
        exportLayout.width = width;
        exportLayout.height = height;

        await Plotly.newPlot(exportHost, exportData, exportLayout, {
          displayModeBar: false,
          responsive: false,
          staticPlot: true,
        });

        await Plotly.downloadImage(exportHost, {
          format: 'png',
          filename,
          width,
          height,
          scale: 2,
        });
      } finally {
        try {
          Plotly.purge(exportHost);
        } catch (_) {
        }
        exportHost.remove();
      }
    }

    function getPlotlyConfig(chartId, filename) {
      return {
        displaylogo: false,
        responsive: true,
        modeBarButtonsToRemove: ['toImage', 'lasso2d', 'select2d', 'toggleSpikelines'],
        modeBarButtonsToAdd: [{
          name: 'toImageBlackBackground',
          title: 'Download plot as PNG',
          icon: Plotly.Icons.camera,
          click: () => {
            downloadPlotlyChartWithBlackBackground(chartId, filename).catch((err) => {
              console.error(err);
              showError(`Chart export failed: ${err.message || err}`);
            });
          },
        }],
      };
    }

    const SOFTWARE_COLORS = {
      core: '#f7931a',
      knots: '#39d98a',
      bip110: '#4169e1',
      other: '#8ea3ad',
    };

    const HISTORY_COLORS = {
      total: '#d1d5db',
      listening: '#6b7280',
      unreachable: '#9ca3af',
      core: SOFTWARE_COLORS.core,
      knots: SOFTWARE_COLORS.knots,
      bip110: SOFTWARE_COLORS.bip110,
    };

    function normalizeSoftwareLabel(value) {
      const raw = String(value || '').trim();
      const lc = raw.toLowerCase();
      if (!raw || lc === 'unknown') return 'other';
      if (lc.includes('bip110')) return 'BIP110';
      if (lc.includes('knots')) return 'Bitcoin Knots';
      if (lc.includes('core')) return 'Bitcoin Core';
      return 'other';
    }

    function displayMainVersion(value) {
      const v = String(value || '').trim();
      if (!v || v.toLowerCase() === 'unknown') return '';
      return v;
    }

    function updateKpis(filtered) {
      const latest = filtered[filtered.length - 1] || {};
      const total = num(latest.total_count);
      const unreachable = num(latest.est_unreachable);
      const listening = num(latest.listening);
      const knots = num(latest.knots_count);
      const core30 = num(latest.core_v30_count);
      const bip110 = num(latest.bip110_count);

      document.getElementById('kpiTotal').textContent = `Total ${fmtInt(total)}`;
      document.getElementById('kpiUnreachable').textContent = `Non-listening ${fmtInt(unreachable)}`;
      document.getElementById('kpiListening').textContent = `Listening ${fmtInt(listening)}`;
      document.getElementById('kpiKnots').textContent = `Knots ${fmtInt(Math.max(0, knots - bip110))}`;
      document.getElementById('kpiCore30').textContent = `Core v30 ${fmtInt(core30)}`;
      document.getElementById('kpiBip110').textContent = `BIP-110 ${fmtInt(bip110)}`;
    }

    function renderHistoryLegend(items) {
      const legend = document.getElementById('historyLegend');
      const list = document.getElementById('historyLegendList');
      if (!legend || !list) return;

      if (!items.length) {
        legend.hidden = true;
        list.innerHTML = '';
        return;
      }

      let clickTimer = null;

      list.innerHTML = items.map((item) => `
        <div class="history-legend-item ${item.key}${state.hiddenHistorySeries.has(item.key) ? ' is-hidden' : ''}" data-key="${item.key}" role="button" tabindex="0" aria-pressed="${state.hiddenHistorySeries.has(item.key) ? 'false' : 'true'}" title="Click to toggle. Double-click to isolate.">
          <span class="history-legend-swatch" style="border-top-color: ${item.color}"></span>
          <span class="history-legend-label">${item.label}</span>
        </div>
      `).join('');

      const toggleSeries = (seriesKey) => {
        if (!seriesKey) return;
        const allKeys = items.map((i) => i.key);
        const visibleKeys = allKeys.filter((k) => !state.hiddenHistorySeries.has(k));
        const isOnlyVisible = visibleKeys.length === 1 && visibleKeys[0] === seriesKey;

        if (isOnlyVisible) {
          state.hiddenHistorySeries = new Set();
        } else if (state.hiddenHistorySeries.has(seriesKey)) {
          state.hiddenHistorySeries.delete(seriesKey);
        } else {
          state.hiddenHistorySeries.add(seriesKey);
        }
        saveControlsToStorage();
        const rangeDays = Number(document.getElementById('rangeSelect')?.value || 0);
        renderHistoryChart({
          preserveViewport: rangeDays !== 0,
          fitVisibleAllRange: rangeDays === 0,
        });
      };

      const isolateSeries = (seriesKey) => {
        if (!seriesKey) return;
        const allKeys = items.map((i) => i.key);
        const visibleKeys = allKeys.filter((k) => !state.hiddenHistorySeries.has(k));
        const isOnlyVisible = visibleKeys.length === 1 && visibleKeys[0] === seriesKey;
        state.hiddenHistorySeries = isOnlyVisible
          ? new Set()
          : new Set(allKeys.filter((k) => k !== seriesKey));
        saveControlsToStorage();
        const rangeDays = Number(document.getElementById('rangeSelect')?.value || 0);
        renderHistoryChart({
          preserveViewport: rangeDays !== 0,
          fitVisibleAllRange: rangeDays === 0,
        });
      };

      list.querySelectorAll('.history-legend-item').forEach((el) => {
        const seriesKey = el.getAttribute('data-key');
        el.addEventListener('click', () => {
          if (clickTimer) clearTimeout(clickTimer);
          clickTimer = setTimeout(() => {
            toggleSeries(seriesKey);
          }, 260);
        });
        el.addEventListener('dblclick', () => {
          if (clickTimer) clearTimeout(clickTimer);
          isolateSeries(seriesKey);
        });
        el.addEventListener('keydown', (event) => {
          if (event.key !== 'Enter' && event.key !== ' ') return;
          event.preventDefault();
          toggleSeries(seriesKey);
        });
      });

      legend.hidden = false;
      updateHistoryLegendSizing();
    }

    function updateHistoryLegendSizing() {
      const panel = document.querySelector('.history-panel');
      const head = panel?.querySelector('.panel-head');
      const legend = document.getElementById('historyLegend');
      const chart = document.getElementById('historyChart');
      const list = document.getElementById('historyLegendList');
      const items = document.querySelectorAll('#historyLegendList .history-legend-item');
      if (!panel || !head || !legend || !chart || !list || !items.length || legend.hidden) return;

      const rowHeight = items[0].getBoundingClientRect().height || 28;
      const rowGap = 2;
      const panelHeight = panel.getBoundingClientRect().height;
      const headHeight = head.getBoundingClientRect().height;
      const chartMinHeight = 180;
      const availableForLegend = Math.max(rowHeight, panelHeight - headHeight - chartMinHeight - 12);
      const preferredLegendHeight = Math.max(rowHeight, Math.round(panelHeight * 0.16));
      const fullLegendHeight = Math.max(rowHeight, Math.ceil(list.scrollHeight));
      const minScrollableHeight = rowHeight + rowGap;
      const legendHeight = Math.min(
        fullLegendHeight,
        Math.max(minScrollableHeight, Math.min(availableForLegend, preferredLegendHeight))
      );

      legend.style.maxHeight = `${legendHeight}px`;
    }

    function setPanelLoaderVisible(panelKey, visible) {
      const loader = panelKey === 'history' ? document.getElementById('historyLoader') : document.getElementById('softwareLoader');
      if (!loader) return;
      loader.classList.toggle('hidden', !visible);
    }

    function renderHistoryChart(options = {}) {
      const _thStyle = getComputedStyle(document.documentElement);
      const _thFg = _thStyle.getPropertyValue('--fg').trim() || '#eef4f6';
      const _thIsLight = document.documentElement.dataset.theme === 'light';
      const _thGrid = _thIsLight ? 'rgba(0,0,0,0.08)' : 'rgba(255,255,255,0.08)';
      setPanelLoaderVisible('history', true);
      const preserveViewport = Boolean(options.preserveViewport);
      const fitVisibleAllRange = Boolean(options.fitVisibleAllRange);
      const historyChartEl = document.getElementById('historyChart');
      const priorXRange = preserveViewport
        ? historyChartEl?.layout?.xaxis?.range
        : null;
      const hasPriorXRange = Array.isArray(priorXRange) && priorXRange.length === 2;

      const rangeDays = Number(document.getElementById('rangeSelect').value);
      const smooth = Number(document.getElementById('smoothSelect').value);

      let rows = state.history.slice().sort((a, b) => new Date(a.datetime) - new Date(b.datetime));
      if (rangeDays > 0 && rows.length) {
        const end = new Date(rows[rows.length - 1].datetime).getTime();
        const start = end - rangeDays * 24 * 60 * 60 * 1000;
        rows = rows.filter((r) => new Date(r.datetime).getTime() >= start);
      }

      // Skip leading rows where all tracked series are still at zero.
      const firstNonZeroIndex = rows.findIndex((r) => (
        num(r.total_count) > 0
        || num(r.est_unreachable) > 0
        || num(r.listening) > 0
        || num(r.knots_count) > 0
        || num(r.core_v30_count) > 0
        || num(r.bip110_count) > 0
      ));
      if (firstNonZeroIndex > 0) {
        rows = rows.slice(firstNonZeroIndex);
      }

      const x = rows.map((r) => r.datetime);
      const totalRaw = rows.map((r) => num(r.total_count));
      const unreachRaw = rows.map((r) => num(r.est_unreachable));
      const listenRaw = rows.map((r) => num(r.listening));
      const knotsRaw = rows.map((r) => Math.max(0, num(r.knots_count) - num(r.bip110_count)));
      const core30Raw = rows.map((r) => numOrNull(r.core_v30_count));
      const bip110Raw = rows.map((r) => numOrNull(r.bip110_count));

      const total = rollingAverage(totalRaw, smooth);
      const unreachable = rollingAverage(unreachRaw, smooth);
      const listening = rollingAverage(listenRaw, smooth);
      const knots = rollingAverage(knotsRaw, smooth);
      const core30 = rollingAverageNullable(core30Raw, smooth);
      const bip110 = rollingAverageNullable(bip110Raw, smooth);

      const totalPlot = maskLeadingZeros(total);
      const unreachablePlot = maskLeadingZeros(unreachable);
      const listeningPlot = maskLeadingZeros(listening);
      const knotsPlot = maskLeadingZeros(knots);
      const core30Plot = maskLeadingZeros(core30);
      const bip110Plot = maskLeadingZeros(bip110);

      const traces = [
        {
          x,
          y: totalPlot,
          type: 'scatter',
          mode: 'lines',
          name: `Total${smooth > 1 ? ` (${smooth}d avg)` : ''}`,
          line: { color: HISTORY_COLORS.total, width: 2.6 },
          hovertemplate: 'Total: %{y:,.0f}<extra></extra>',
          visible: state.hiddenHistorySeries.has('total') ? 'legendonly' : true,
        },
        {
          x,
          y: unreachablePlot,
          type: 'scatter',
          mode: 'lines',
          name: `Non-listening${smooth > 1 ? ` (${smooth}d avg)` : ''}`,
          line: { color: HISTORY_COLORS.unreachable, width: 1.8 },
          hovertemplate: 'Non-listening: %{y:,.0f}<extra></extra>',
          visible: state.hiddenHistorySeries.has('unreachable') ? 'legendonly' : true,
        },
        {
          x,
          y: listeningPlot,
          type: 'scatter',
          mode: 'lines',
          name: `Listening${smooth > 1 ? ` (${smooth}d avg)` : ''}`,
          line: { color: HISTORY_COLORS.listening, width: 1.8 },
          hovertemplate: 'Listening: %{y:,.0f}<extra></extra>',
          visible: state.hiddenHistorySeries.has('listening') ? 'legendonly' : true,
        },
        {
          x,
          y: knotsPlot,
          type: 'scatter',
          mode: 'lines',
          name: `Knots${smooth > 1 ? ` (${smooth}d avg)` : ''}`,
          line: { color: HISTORY_COLORS.knots, width: 1.8 },
          hovertemplate: 'Knots: %{y:,.0f}<extra></extra>',
          visible: state.hiddenHistorySeries.has('knots') ? 'legendonly' : true,
        },
        {
          x,
          y: core30Plot,
          type: 'scatter',
          mode: 'lines',
          name: `Core v30${smooth > 1 ? ` (${smooth}d avg)` : ''}`,
          line: { color: HISTORY_COLORS.core, width: 1.8 },
          hovertemplate: 'Core v30: %{y:,.0f}<extra></extra>',
          visible: state.hiddenHistorySeries.has('core') ? 'legendonly' : true,
        },
        {
          x,
          y: bip110Plot,
          type: 'scatter',
          mode: 'lines',
          name: `BIP-110${smooth > 1 ? ` (${smooth}d avg)` : ''}`,
          line: { color: HISTORY_COLORS.bip110, width: 1.8 },
          hovertemplate: 'BIP-110: %{y:,.0f}<extra></extra>',
          visible: state.hiddenHistorySeries.has('bip110') ? 'legendonly' : true,
        },
      ];

      const getVisibleTraceRange = () => {
        let minTime = null;
        let maxTime = null;
        traces.forEach((trace) => {
          if (trace.visible === 'legendonly') return;
          for (let i = 0; i < trace.x.length; i += 1) {
            const y = trace.y[i];
            if (y == null || !Number.isFinite(y)) continue;
            const t = new Date(trace.x[i]).getTime();
            if (!Number.isFinite(t)) continue;
            if (minTime == null || t < minTime) minTime = t;
            if (maxTime == null || t > maxTime) maxTime = t;
          }
        });
        if (minTime == null || maxTime == null) return null;
        return [new Date(minTime).toISOString(), new Date(maxTime).toISOString()];
      };

      const shouldFitVisibleAllRange = fitVisibleAllRange || (rangeDays === 0 && !hasPriorXRange);
      const visibleAllRange = shouldFitVisibleAllRange ? getVisibleTraceRange() : null;
      const hasVisibleAllRange = Array.isArray(visibleAllRange) && visibleAllRange.length === 2;

      renderHistoryLegend([
        { key: 'total', label: `Total${smooth > 1 ? ` (${smooth}d avg)` : ''}`, color: HISTORY_COLORS.total },
        { key: 'unreachable', label: `Non-listening${smooth > 1 ? ` (${smooth}d avg)` : ''}`, color: HISTORY_COLORS.unreachable },
        { key: 'listening', label: `Listening${smooth > 1 ? ` (${smooth}d avg)` : ''}`, color: HISTORY_COLORS.listening },
        { key: 'knots', label: `Knots${smooth > 1 ? ` (${smooth}d avg)` : ''}`, color: HISTORY_COLORS.knots },
        { key: 'core', label: `Core v30${smooth > 1 ? ` (${smooth}d avg)` : ''}`, color: HISTORY_COLORS.core },
        { key: 'bip110', label: `BIP-110${smooth > 1 ? ` (${smooth}d avg)` : ''}`, color: HISTORY_COLORS.bip110 },
      ]);

      Plotly.react('historyChart', traces, {
        margin: { l: 64, r: 24, t: 16, b: 25 },
        paper_bgcolor: PLOTLY_LIVE_BG,
        plot_bgcolor: PLOTLY_LIVE_BG,
        font: { color: _thFg, family: '"IBM Plex Mono", monospace', size: 12 },
        hoverlabel: getPlotlyHoverlabel(),
        hoverdistance: 5,
        showlegend: false,
        xaxis: {
          hoverformat: '%Y-%m-%d',
          gridcolor: _thGrid,
          zeroline: false,
          showspikes: true,
          spikemode: 'across',
          spikesnap: 'cursor',
          spikecolor: _thFg,
          spikethickness: 1,
          spikedash: 'dash',
          ...(
            hasVisibleAllRange
              ? { autorange: false, range: visibleAllRange }
              : (hasPriorXRange ? { autorange: false, range: priorXRange } : {})
          ),
        },
        yaxis: {
          title: 'Node count',
          rangemode: 'tozero',
          gridcolor: _thGrid,
          zeroline: false,
          showspikes: false,
        },
        legend: {
          orientation: 'h',
          yanchor: 'bottom',
          y: 1.02,
          xanchor: 'left',
          x: 0,
        },
        hovermode: 'x unified',
      }, getPlotlyConfig('historyChart', 'bitcoin-node-count-over-time'));

      updateKpis(rows);
      updateHistoryLegendSizing();
      const first = rows[0] ? new Date(rows[0].datetime).toISOString().slice(0, 10) : '-';
      const last = rows[rows.length - 1] ? new Date(rows[rows.length - 1].datetime).toISOString().slice(0, 10) : '-';
      document.getElementById('rangeSummary').textContent = `${first} to ${last}`;
      requestAnimationFrame(() => setPanelLoaderVisible('history', false));
    }

    function renderSoftwarePanel() {
      const _thStyle = getComputedStyle(document.documentElement);
      const _thFg = _thStyle.getPropertyValue('--fg').trim() || '#eef4f6';
      const _thIsLight = document.documentElement.dataset.theme === 'light';
      const _thGrid = _thIsLight ? 'rgba(0,0,0,0.08)' : 'rgba(255,255,255,0.08)';
      setPanelLoaderVisible('software', true);
      const topN = Number(document.getElementById('topNInput').value);
      document.getElementById('topNLabel').textContent = String(topN);

      const displaySoftwareName = (name) => {
        const s = String(name || '').trim();
        return s.toLowerCase() === 'other' ? 'Other' : s;
      };

      const softwareRows = state.software.filter(
        (r) => !String(r.software || '').toLowerCase().includes('(excluded)')
      );

      const groupedMap = new Map();
      softwareRows.forEach((r) => {
        const sourceSoftwareRaw = String(r.software || '').trim() || 'other';
        const sourceSoftwareLc = sourceSoftwareRaw.toLowerCase();
        const sourceSoftware = (
          sourceSoftwareLc === 'bitcoinj / wallets'
          || sourceSoftwareLc === 'bitcoinj/wallets'
          || sourceSoftwareLc === 'bitcoinj'
        ) ? 'other' : sourceSoftwareRaw;

        const software = normalizeSoftwareLabel(r.software);
        const mainVersionRaw = displayMainVersion(r.main_version);
        const subVersionRaw = String(r.sub_version || 'unknown').trim() || 'unknown';
        const mainVersion = software === 'other' ? '' : mainVersionRaw;
        const subVersion = software === 'other'
          ? (mainVersionRaw || 'unknown')
          : subVersionRaw;
        const total = num(r.total_count);
        const key = `${software}||${mainVersion}`;

        if (!groupedMap.has(key)) {
          groupedMap.set(key, {
            key,
            software,
            mainVersion,
            totalCount: 0,
            subRows: [],
          });
        }

        const group = groupedMap.get(key);
        group.totalCount += total;
        group.subRows.push({
          software,
          sourceSoftware,
          mainVersion,
          subVersion,
          totalCount: total,
        });
      });

      const ranked = Array.from(groupedMap.values())
        .sort((a, b) => b.totalCount - a.totalCount)
        .slice(0, topN);

      const visibleKeys = new Set(ranked.map((r) => r.key));
      Array.from(state.softwareExpandedKeys).forEach((key) => {
        if (!visibleKeys.has(key)) state.softwareExpandedKeys.delete(key);
      });

      const x = ranked.map((r) => {
        const softwareName = displaySoftwareName(String(r.software || '').replace(/^bitcoin\s+/i, ''));
        return `${softwareName}${r.mainVersion ? ` ${r.mainVersion}` : ''}`.trim();
      });
      const y = ranked.map((r) => r.totalCount);
      const colors = ranked.map((r) => {
        const s = String(r.software || '').toLowerCase();
        if (s.includes('core')) return SOFTWARE_COLORS.core;
        if (s.includes('knots')) return SOFTWARE_COLORS.knots;
        if (s.includes('bip110')) return SOFTWARE_COLORS.bip110;
        return SOFTWARE_COLORS.other;
      });

      Plotly.react('softwareChart', [{
        type: 'bar',
        x,
        y,
        marker: { color: colors, line: { width: 0 } },
        hovertemplate: 'Total: %{y:,.0f}<extra></extra>',
      }], {
        margin: { l: 64, r: 18, t: 6, b: 62 },
        paper_bgcolor: PLOTLY_LIVE_BG,
        plot_bgcolor: PLOTLY_LIVE_BG,
        font: { color: _thFg, family: '"IBM Plex Mono", monospace', size: 12 },
        hoverlabel: getPlotlyHoverlabel(),
        hovermode: 'x unified',
        xaxis: { tickangle: -28, automargin: true, gridcolor: _thGrid, showspikes: false },
        yaxis: { title: 'Nodes', gridcolor: _thGrid, showspikes: false },
      }, getPlotlyConfig('softwareChart', 'bitcoin-node-software-versions'));

      applySoftwarePanelSizing();

      const totalAll = softwareRows.reduce((acc, r) => acc + num(r.total_count), 0) || 1;
      const body = document.getElementById('versionTableBody');
      body.innerHTML = ranked.map((group) => {
        const isExpanded = state.softwareExpandedKeys.has(group.key);
        const mainShare = (group.totalCount / totalAll) * 100;

        const mainRow = `
          <tr class="software-main-row" data-key="${group.key}">
            <td><span class="row-toggle">${isExpanded ? '▾' : '▸'}</span>${displaySoftwareName(group.software)}</td>
            <td>${group.mainVersion || '-'}</td>
            <td>${fmtInt(group.totalCount)}</td>
            <td class="tiny">${fmtPct(mainShare)}</td>
          </tr>
        `;

        if (!isExpanded) return mainRow;

        const subRows = group.subRows
          .slice()
          .sort((a, b) => b.totalCount - a.totalCount)
          .map((sub) => {
            const subShare = (sub.totalCount / totalAll) * 100;
            const subSoftwareLabel = group.software === 'other'
              ? (sub.sourceSoftware || 'other')
              : sub.software;
            return `
              <tr class="software-sub-row">
                <td>${displaySoftwareName(subSoftwareLabel)}</td>
                <td>${sub.subVersion}</td>
                <td>${fmtInt(sub.totalCount)}</td>
                <td class="tiny">${fmtPct(subShare)}</td>
              </tr>
            `;
          })
          .join('');

        return `${mainRow}${subRows}`;
      }).join('');

      body.querySelectorAll('tr.software-main-row').forEach((row) => {
        row.addEventListener('click', () => {
          const key = row.getAttribute('data-key');
          if (!key) return;
          if (state.softwareExpandedKeys.has(key)) {
            state.softwareExpandedKeys.delete(key);
          } else {
            state.softwareExpandedKeys.add(key);
          }
          renderSoftwarePanel();
        });
      });

      requestAnimationFrame(() => setPanelLoaderVisible('software', false));
    }

    function setLastUpdated() {
      const updatedChip = document.getElementById('updatedChip');
      if (!updatedChip) return;
      const updatedRaw = getUpdatedRawValue();
      if (!updatedRaw) return;
      updatedChip.textContent = `Updated ${formatUpdatedForSelectedTimeZone(updatedRaw)}`;
    }

    function bindControls() {
      ['rangeSelect', 'smoothSelect'].forEach((id) => {
        document.getElementById(id).addEventListener('change', () => {
          saveControlsToStorage();
          renderHistoryChart();
        });
      });
      document.getElementById('topNInput').addEventListener('input', () => {
        saveControlsToStorage();
        renderSoftwarePanel();
      });
      ['toggleHistoryPanel', 'toggleSoftwarePanel'].forEach((id) => {
        const el = document.getElementById(id);
        if (!el) return;
        el.addEventListener('change', () => {
          const toggleHistory = document.getElementById('toggleHistoryPanel');
          const toggleSoftware = document.getElementById('toggleSoftwarePanel');
          if (!toggleHistory || !toggleSoftware) return;

          // If the user turns off the only visible panel, automatically enable the other one.
          if (!toggleHistory.checked && !toggleSoftware.checked) {
            if (id === 'toggleHistoryPanel') {
              toggleSoftware.checked = true;
            } else {
              toggleHistory.checked = true;
            }
          }

          applyPanelVisibility();
          saveControlsToStorage();
        });
      });
      const swapPanelsBtn = document.getElementById('swapPanelsBtn');
      if (swapPanelsBtn) {
        swapPanelsBtn.addEventListener('click', () => {
          state.panelsSwapped = !state.panelsSwapped;
          applyPanelOrder();
          saveControlsToStorage();
          requestAnimationFrame(() => {
            if (window.Plotly) {
              Plotly.Plots.resize('historyChart');
              Plotly.Plots.resize('softwareChart');
              updateHistoryLegendSizing();
            }
          });
        });
      }

      const panelResizer = document.getElementById('panelResizer');
      if (panelResizer) {
        let draggingPointerId = null;

        const applySplitFromPointer = (clientX, clientY) => {
          const grid = document.querySelector('.grid');
          const historyPanel = document.querySelector('.history-panel');
          const softwarePanel = document.querySelector('.software-panel');
          if (!grid || !historyPanel || !softwarePanel || historyPanel.hidden || softwarePanel.hidden) return;
          const rect = grid.getBoundingClientRect();
          const stacked = isStackedLayout();

          if (stacked) {
            const softwareMinHeight = getStackedSoftwareMinHeight(softwarePanel);
            const historyMinHeight = 180;
            const topPanelMinHeight = state.panelsSwapped ? softwareMinHeight : historyMinHeight;
            const nextTopHeight = Math.max(topPanelMinHeight, Math.round(clientY - rect.top));
            state.stackedTopPanelHeight = nextTopHeight;
          } else {
            if (!rect.width) return;
            const leftPercent = clamp(((clientX - rect.left) / rect.width) * 100, PANEL_SPLIT_MIN, PANEL_SPLIT_MAX);
            const historyPercent = state.panelsSwapped
              ? (100 - leftPercent)
              : leftPercent;
            state.historyPanelPercent = applyCenterSnap(historyPercent);
          }

          applyPanelSizing();
          if (window.Plotly) {
            Plotly.Plots.resize('historyChart');
            Plotly.Plots.resize('softwareChart');
            updateHistoryLegendSizing();
          }
        };

        const stopDragging = () => {
          if (draggingPointerId == null) return;
          draggingPointerId = null;
          panelResizer.classList.remove('dragging');
          document.body.classList.remove('resizing-panels');
          document.body.classList.remove('resizing-panels-y');
          saveControlsToStorage();
        };

        panelResizer.addEventListener('pointerdown', (event) => {
          if (event.button !== 0) return;
          const historyPanel = document.querySelector('.history-panel');
          const softwarePanel = document.querySelector('.software-panel');
          if (!historyPanel || !softwarePanel || historyPanel.hidden || softwarePanel.hidden) return;

          draggingPointerId = event.pointerId;
          panelResizer.setPointerCapture(event.pointerId);
          panelResizer.classList.add('dragging');
          document.body.classList.toggle('resizing-panels', !isStackedLayout());
          document.body.classList.toggle('resizing-panels-y', isStackedLayout());
          applySplitFromPointer(event.clientX, event.clientY);
        });

        panelResizer.addEventListener('pointermove', (event) => {
          if (draggingPointerId !== event.pointerId) return;
          applySplitFromPointer(event.clientX, event.clientY);
        });

        panelResizer.addEventListener('pointerup', (event) => {
          if (draggingPointerId !== event.pointerId) return;
          stopDragging();
        });

        panelResizer.addEventListener('pointercancel', stopDragging);
        panelResizer.addEventListener('lostpointercapture', stopDragging);

        panelResizer.addEventListener('keydown', (event) => {
          const adjustStep = event.shiftKey ? 3 : 1;
          const stacked = isStackedLayout();
          const decrementKey = stacked ? 'ArrowUp' : 'ArrowLeft';
          const incrementKey = stacked ? 'ArrowDown' : 'ArrowRight';
          if (event.key !== decrementKey && event.key !== incrementKey) return;
          event.preventDefault();
          const direction = event.key === incrementKey ? 1 : -1;
          const signed = state.panelsSwapped ? -direction : direction;
          if (stacked) {
            const softwarePanel = document.querySelector('.software-panel');
            const softwareMinHeight = getStackedSoftwareMinHeight(softwarePanel);
            const historyMinHeight = 180;
            const topPanelMinHeight = state.panelsSwapped ? softwareMinHeight : historyMinHeight;
            const currentHeight = Number(state.stackedTopPanelHeight) || topPanelMinHeight;
            const nextHeight = Math.max(topPanelMinHeight, currentHeight + (direction * adjustStep * 8));
            state.stackedTopPanelHeight = nextHeight;
          } else {
            const nextPercent = clamp(state.historyPanelPercent + (signed * adjustStep), PANEL_SPLIT_MIN, PANEL_SPLIT_MAX);
            state.historyPanelPercent = applyCenterSnap(nextPercent);
          }
          applyPanelSizing();
          saveControlsToStorage();
          if (window.Plotly) {
            Plotly.Plots.resize('historyChart');
            Plotly.Plots.resize('softwareChart');
            updateHistoryLegendSizing();
          }
        });
      }

      const softwareResizer = document.getElementById('softwareResizer');
      if (softwareResizer) {
        let draggingPointerId = null;

        const setSoftwareChartPercent = (value) => {
          const nextValue = clamp(value, SOFTWARE_SPLIT_MIN, SOFTWARE_SPLIT_MAX);
          if (isStackedLayout()) {
            state.softwareChartStackPercent = nextValue;
          } else {
            state.softwareChartPercent = nextValue;
          }
        };

        const applySoftwareSplitFromPointer = (clientY) => {
          const softwarePanel = document.querySelector('.software-panel');
          const panelHead = softwarePanel?.querySelector('.panel-head');
          if (!softwarePanel || softwarePanel.hidden || !panelHead) return;

          const panelRect = softwarePanel.getBoundingClientRect();
          const headRect = panelHead.getBoundingClientRect();
          const styles = getComputedStyle(softwarePanel);
          const resizerSize = parseFloat(styles.getPropertyValue('--software-resizer-size')) || 14;
          const contentTop = headRect.bottom - panelRect.top;
          const available = panelRect.height - contentTop - resizerSize;
          if (available <= 0) return;

          const offset = clamp(clientY - panelRect.top - contentTop, 0, available);
          setSoftwareChartPercent((offset / available) * 100);
          applySoftwarePanelSizing();
          if (window.Plotly) {
            Plotly.Plots.resize('softwareChart');
          }
        };

        const stopDragging = () => {
          if (draggingPointerId == null) return;
          draggingPointerId = null;
          softwareResizer.classList.remove('dragging');
          document.body.classList.remove('resizing-software');
          saveControlsToStorage();
        };

        softwareResizer.addEventListener('pointerdown', (event) => {
          if (event.button !== 0) return;
          const softwarePanel = document.querySelector('.software-panel');
          if (!softwarePanel || softwarePanel.hidden) return;

          draggingPointerId = event.pointerId;
          softwareResizer.setPointerCapture(event.pointerId);
          softwareResizer.classList.add('dragging');
          document.body.classList.add('resizing-software');
          applySoftwareSplitFromPointer(event.clientY);
        });

        softwareResizer.addEventListener('pointermove', (event) => {
          if (draggingPointerId !== event.pointerId) return;
          applySoftwareSplitFromPointer(event.clientY);
        });

        softwareResizer.addEventListener('pointerup', (event) => {
          if (draggingPointerId !== event.pointerId) return;
          stopDragging();
        });

        softwareResizer.addEventListener('pointercancel', stopDragging);
        softwareResizer.addEventListener('lostpointercapture', stopDragging);

        softwareResizer.addEventListener('keydown', (event) => {
          if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
          event.preventDefault();
          const adjustStep = event.shiftKey ? 3 : 1;
          const direction = event.key === 'ArrowDown' ? 1 : -1;
          const currentValue = isStackedLayout()
            ? state.softwareChartStackPercent
            : state.softwareChartPercent;
          setSoftwareChartPercent(currentValue + (direction * adjustStep));
          applySoftwarePanelSizing();
          saveControlsToStorage();
          if (window.Plotly) {
            Plotly.Plots.resize('softwareChart');
          }
        });
      }

      const bindPanelResizeHandle = (handle, panelType, minHeight = 180) => {
        if (!handle) return;

        let draggingPointerId = null;

        handle.addEventListener('pointerdown', (ev) => {
          ev.preventDefault();
          if (ev.button !== 0) return;
          if (!isStackedLayout()) return;

          const panel = handle.closest('.panel');
          if (!panel) return;

          const startY = ev.clientY;
          const startHeight = panel.getBoundingClientRect().height;

          draggingPointerId = ev.pointerId;
          handle.setPointerCapture(ev.pointerId);
          handle.classList.add('dragging');
          document.body.classList.add('resizing-panel');

          const onPointerMove = (moveEv) => {
            if (draggingPointerId !== moveEv.pointerId) return;

            const deltaY = moveEv.clientY - startY;
            const nextHeight = Math.max(minHeight, startHeight + deltaY);

            if (panelType === 'history') {
              state.historyPanelManualHeight = nextHeight;
            } else if (panelType === 'software') {
              state.softwarePanelManualHeight = nextHeight;
            }

            applyPanelSizing();
            if (window.Plotly) {
              Plotly.Plots.resize('historyChart');
              Plotly.Plots.resize('softwareChart');
              updateHistoryLegendSizing();
            }
          };

          const stopResize = (stopEv) => {
            if (draggingPointerId === null || (stopEv && draggingPointerId !== stopEv.pointerId)) return;

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

            // Persist the final height
            if (panelType === 'history') {
              state.historyPanelManualHeight = Math.max(minHeight, panel.getBoundingClientRect().height);
            } else if (panelType === 'software') {
              state.softwarePanelManualHeight = Math.max(minHeight, panel.getBoundingClientRect().height);
            }
            saveControlsToStorage();
          };

          handle.addEventListener('pointermove', onPointerMove);
          handle.addEventListener('pointerup', stopResize);
          handle.addEventListener('pointercancel', stopResize);
          handle.addEventListener('lostpointercapture', stopResize);
        });
      };

      const historyResizeHandle = document.getElementById('historyResizeHandle');
      const softwareResizeHandle = document.getElementById('softwareResizeHandle');
      
      bindPanelResizeHandle(historyResizeHandle, 'history', 180);
      
      const softwarePanel = document.querySelector('.software-panel');
      const softwareMinHeight = getStackedSoftwareMinHeight(softwarePanel);
      bindPanelResizeHandle(softwareResizeHandle, 'software', softwareMinHeight);

      window.addEventListener('resize', () => {
        applyPanelSizing();
        applySoftwarePanelSizing({ recalculateAvailableHeight: true });
        Plotly.Plots.resize('historyChart');
        Plotly.Plots.resize('softwareChart');
        updateHistoryLegendSizing();
      });
    }

    function showError(message) {
      const box = document.getElementById('errorBox');
      box.style.display = 'block';
      box.textContent = message;
    }

    function loadScript(src, timeoutMs = 5000) {
      return new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = src;
        s.async = true;
        const timer = setTimeout(() => {
          s.onload = s.onerror = null;
          reject(new Error(`Timed out loading script: ${src}`));
        }, timeoutMs);
        s.onload = () => { clearTimeout(timer); resolve(); };
        s.onerror = () => { clearTimeout(timer); reject(new Error(`Failed to load script: ${src}`)); };
        document.head.appendChild(s);
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

    function setControlsEnabled(enabled) {
      dashboardControlLock?.setEnabled(enabled);
    }

    async function init() {
      applyEmbeddedModalLayout();
      setControlsEnabled(false);
      setPanelLoaderVisible('history', true);
      setPanelLoaderVisible('software', true);
      try {
        const data = await loadDashboardData(CARD_PREVIEW_CACHE_BUST);
        state.history = data.historyRows;
        state.software = data.softwareRows;
        state.refreshedAtText = data.refreshedAtText;
        state.dataSignature = data.signature;
        state.lastSuccessfulRefreshAt = Date.now();

        if (!state.history.length) {
          throw new Error('No history rows found in node count dataset.');
        }
        if (!state.software.length) {
          throw new Error('No software rows found in grouped software dataset.');
        }

        populateUpdatedTimeZoneSelect();
        bindTimeZoneChipEvents();
        loadControlsFromStorage();
        applyPanelOrder();
        applyPanelVisibility();
        setLastUpdated();
        bindControls();
        renderHistoryChart();
        renderSoftwarePanel();
        if (!IS_CARD_PREVIEW) {
          setupRefreshWakeEvents();
          startAutoRefresh();
        }
        setControlsEnabled(true);
      } catch (err) {
        console.error(err);
        showError(`Dashboard data failed to load: ${err.message || err}`);
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
        } catch (err) {
          console.error(err);
          showError(`Dashboard failed to initialize: ${err.message || err}`);
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
