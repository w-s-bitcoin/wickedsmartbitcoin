(function () {
  const DEFAULT_THEME_KEY = "quantum-research-dashboard-theme";
  const DEFAULT_REFRESH_MS = 60000;
  const DEFAULT_WAKE_DELAY_MS = 150;

  function resolvePreferredTheme() {
    try {
      const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
      return prefersDark ? "dark" : "light";
    } catch (_err) {
      return "dark";
    }
  }

  function applyTheme(theme) {
    document.documentElement.dataset.theme = theme === "light" ? "light" : "dark";
  }

  function initThemeSync(options = {}) {
    const themeKey = String(options.themeKey || DEFAULT_THEME_KEY);
    const onThemeChanged = typeof options.onThemeChanged === "function"
      ? options.onThemeChanged
      : null;

    try {
      const stored = window.localStorage.getItem(themeKey);
      if (stored === "light" || stored === "dark") {
        applyTheme(stored);
      } else {
        applyTheme(resolvePreferredTheme());
      }
    } catch (_err) {
      applyTheme(resolvePreferredTheme());
    }

    window.addEventListener("message", (event) => {
      if (!event.data || event.data.type !== "quantum-dashboard-theme") return;
      applyTheme(event.data.theme);
      if (onThemeChanged) onThemeChanged();
    });

    window.addEventListener("storage", (event) => {
      if (event.key !== themeKey) return;
      if (event.newValue === "light" || event.newValue === "dark") {
        applyTheme(event.newValue);
        if (onThemeChanged) onThemeChanged();
      }
    });
  }

  function createAutoRefresher(options = {}) {
    const refreshFn = typeof options.refresh === "function" ? options.refresh : null;
    const intervalMs = Number(options.intervalMs) > 0 ? Number(options.intervalMs) : DEFAULT_REFRESH_MS;
    const wakeDelayMs = Number(options.wakeDelayMs) >= 0
      ? Number(options.wakeDelayMs)
      : DEFAULT_WAKE_DELAY_MS;

    let refreshInFlight = false;
    let autoRefreshTimer = null;

    async function refreshNow() {
      if (!refreshFn || refreshInFlight) return;
      refreshInFlight = true;
      try {
        await refreshFn();
      } catch (error) {
        console.error(error);
      } finally {
        refreshInFlight = false;
      }
    }

    function triggerRefreshSoon(delayMs = wakeDelayMs) {
      window.setTimeout(() => {
        refreshNow();
      }, Math.max(0, Number(delayMs) || 0));
    }

    function setupWakeEvents() {
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
        refreshNow();
      }, intervalMs);
    }

    function start() {
      setupWakeEvents();
      startAutoRefresh();
    }

    function stop() {
      if (autoRefreshTimer) {
        window.clearInterval(autoRefreshTimer);
        autoRefreshTimer = null;
      }
    }

    return {
      refreshNow,
      triggerRefreshSoon,
      start,
      stop,
    };
  }

  window.WSBPreviewShared = {
    initThemeSync,
    createAutoRefresher,
  };
}());
