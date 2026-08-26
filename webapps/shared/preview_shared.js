(function () {
  const DEFAULT_THEME_KEY = "quantum-research-dashboard-theme";
  const DEFAULT_REFRESH_MS = 60000;
  const SIGNATURE_SEPARATOR = "\n---WSB-DATA-SIGNATURE-PART---\n";
  const dataRefreshers = new Map();

  function resolvePreferredTheme() {
    return "dark";
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

  function withRefreshToken(url, token) {
    const freshUrl = new URL(String(url), document.baseURI);
    freshUrl.searchParams.set("wsb_preview_refresh", String(token));
    return freshUrl.href;
  }

  function makeHttpError(url, response) {
    const error = new Error(`Failed to load ${url} (${response.status})`);
    error.response = response;
    return error;
  }

  /**
   * Atomic live-data controller for dashboard previews.
   *
   * `prepare` must build a detached candidate. `commit` is the only callback
   * allowed to replace live preview state, and `present` is the only callback
   * that should touch the visible chart. The controller rechecks every marker
   * immediately before commit, keeps the last complete preview on failures,
   * and defers presentation while the iframe is hidden.
   */
  function createDataRefresher(options = {}) {
    const filename = String(options.filename || "").trim();
    const urls = Array.isArray(options.urls) ? options.urls.filter(Boolean) : [];
    const intervalMs = Number(options.intervalMs) > 0
      ? Number(options.intervalMs)
      : DEFAULT_REFRESH_MS;
    const retryBaseMs = Number(options.retryBaseMs) > 0
      ? Number(options.retryBaseMs)
      : Math.min(5000, intervalMs);
    const retryMaxMs = Number(options.retryMaxMs) > 0
      ? Math.max(Number(options.retryMaxMs), retryBaseMs)
      : Math.max(retryBaseMs, intervalMs);
    const requestTimeoutMs = Number(options.requestTimeoutMs) > 0
      ? Number(options.requestTimeoutMs)
      : Math.min(30000, Math.max(10000, intervalMs / 2));
    const prepare = typeof options.prepare === "function" ? options.prepare : null;
    const validate = typeof options.validate === "function" ? options.validate : null;
    const commit = typeof options.commit === "function" ? options.commit : null;
    const present = typeof options.present === "function" ? options.present : null;
    const isPresentationBlocked = typeof options.isPresentationBlocked === "function"
      ? options.isPresentationBlocked
      : null;
    const onError = typeof options.onError === "function" ? options.onError : null;
    const onInitialError = typeof options.onInitialError === "function"
      ? options.onInitialError
      : null;

    if (!filename || !urls.length || !prepare || !commit || !present) {
      throw new TypeError(
        "Preview data refresh requires filename, marker urls, prepare, commit, and present."
      );
    }

    let acceptedSignature = null;
    let acceptedSignatureParts = [];
    let activeController = null;
    let activeRequestTimer = 0;
    let activeRequestTimedOut = false;
    let checkInFlight = false;
    let checkQueued = false;
    let destroyed = false;
    let forceApplyCurrentGeneration = false;
    let initialSettled = false;
    let pausedForPageHide = false;
    let presentationPending = false;
    let retryAttempt = 0;
    let requestSequence = 0;
    let scheduledAt = 0;
    let scheduledTimer = 0;
    let started = false;
    const pendingReasons = new Set();

    function dispatchStatus(status, extra = {}) {
      const detail = Object.assign({
        status,
        filename,
        acceptedSignature,
        checkInFlight,
        presentationPending,
        visibilityState: document.visibilityState,
      }, extra);
      try {
        window.dispatchEvent(new CustomEvent("wsb:preview-refresh-status", { detail }));
      } catch (_error) {
        // Diagnostics must never affect the preview.
      }
    }

    function settleInitial(error = null) {
      if (initialSettled) return;
      initialSettled = true;
      if (error && onInitialError) {
        try {
          onInitialError(error);
        } catch (_handlerError) {}
      }
      markReady({ filename });
    }

    function clearScheduledCheck() {
      if (scheduledTimer) window.clearTimeout(scheduledTimer);
      scheduledTimer = 0;
      scheduledAt = 0;
    }

    function retryDelay() {
      return Math.min(retryMaxMs, retryBaseMs * (2 ** Math.min(retryAttempt, 6)));
    }

    function scheduleCheck(reason, delayMs = 0) {
      if (destroyed) return;
      pendingReasons.add(reason || "requested");
      if (!started || pausedForPageHide || checkInFlight) {
        checkQueued = true;
        return;
      }
      const dueAt = Date.now() + Math.max(0, Number(delayMs) || 0);
      if (scheduledTimer && scheduledAt <= dueAt) return;
      clearScheduledCheck();
      scheduledAt = dueAt;
      scheduledTimer = window.setTimeout(() => {
        scheduledTimer = 0;
        scheduledAt = 0;
        void runCheck();
      }, Math.max(0, dueAt - Date.now()));
    }

    async function fetchSignaturePart(url, signal, token) {
      const response = await fetch(withRefreshToken(url, token), {
        cache: "no-store",
        signal,
      });
      if (!response.ok) throw makeHttpError(url, response);
      return (await response.text()).trim();
    }

    async function fetchSignature(signal, requestId, phase) {
      const parts = await Promise.all(urls.map((url, index) => (
        fetchSignaturePart(url, signal, `${requestId}-${phase}-${index}`)
      )));
      return { parts, signature: parts.join(SIGNATURE_SEPARATOR) };
    }

    function makeFreshFetcher(signal, requestId) {
      let sequence = 0;
      return async function fetchFresh(url, init = {}) {
        sequence += 1;
        const response = await fetch(
          withRefreshToken(url, `${requestId}-data-${sequence}`),
          Object.assign({}, init, { cache: "no-store", signal })
        );
        if (!response.ok) throw makeHttpError(url, response);
        return response;
      };
    }

    function presentationBlocked() {
      if (document.visibilityState !== "visible") return true;
      if (!isPresentationBlocked) return false;
      try {
        return isPresentationBlocked() === true;
      } catch (_error) {
        return true;
      }
    }

    function requestPresent(reason = "requested") {
      if (destroyed) return false;
      presentationPending = true;
      if (presentationBlocked()) {
        dispatchStatus("presentation-deferred", { reason });
        return false;
      }
      let result;
      try {
        result = present({ reason, acceptedSignature });
      } catch (error) {
        if (onError) {
          try { onError(error); } catch (_handlerError) {}
        }
        dispatchStatus("presentation-error", { reason, error });
        return false;
      }
      if (result === false) return false;
      presentationPending = false;
      dispatchStatus("presented", { reason });
      return true;
    }

    async function applyCandidate(observed, context) {
      const candidate = await prepare(context);
      if (context.signal.aborted) throw new DOMException("Refresh aborted", "AbortError");
      if (validate && (await validate(candidate, context)) === false) {
        dispatchStatus("deferred", {
          requestId: context.requestId,
          reason: "validation",
          signature: observed.signature,
        });
        return "retry";
      }

      const verified = await fetchSignature(context.signal, context.requestId, "pre-commit");
      if (verified.signature !== observed.signature) {
        checkQueued = true;
        pendingReasons.add("generation-superseded");
        dispatchStatus("superseded", {
          requestId: context.requestId,
          signature: observed.signature,
        });
        return "superseded";
      }

      context.visibilityState = document.visibilityState;
      const committed = await commit(candidate, context);
      if (committed === false) {
        dispatchStatus("deferred", {
          requestId: context.requestId,
          reason: "commit",
          signature: observed.signature,
        });
        return "retry";
      }
      acceptedSignature = observed.signature;
      acceptedSignatureParts = observed.parts.slice();
      forceApplyCurrentGeneration = false;
      retryAttempt = 0;
      dispatchStatus("applied", {
        requestId: context.requestId,
        signature: observed.signature,
        previousSignature: context.previousSignature,
      });
      if (!committed || committed.present !== false) {
        requestPresent("data-applied");
      }

      try {
        const postflight = await fetchSignature(context.signal, context.requestId, "verify");
        if (postflight.signature !== acceptedSignature) {
          checkQueued = true;
          pendingReasons.add("generation-advanced");
        }
      } catch (error) {
        if (error?.name === "AbortError") throw error;
        // The committed generation remains valid. A later poll retries the probe.
      }
      return "idle";
    }

    async function checkForUpdates(reason) {
      const requestId = ++requestSequence;
      const controller = new AbortController();
      activeController = controller;
      const signal = controller.signal;
      activeRequestTimedOut = false;
      activeRequestTimer = window.setTimeout(() => {
        activeRequestTimedOut = true;
        controller.abort(new DOMException("Preview refresh timed out.", "TimeoutError"));
      }, requestTimeoutMs);
      if (typeof navigator !== "undefined" && navigator.onLine === false) {
        throw new Error("Preview refresh is offline.");
      }
      const observed = await fetchSignature(signal, requestId, "probe");
      if (observed.signature === acceptedSignature && !forceApplyCurrentGeneration) {
        retryAttempt = 0;
        dispatchStatus("unchanged", { requestId, reason });
        return "idle";
      }
      const context = {
        filename,
        signature: observed.signature,
        signatureParts: observed.parts.slice(),
        previousSignature: acceptedSignature,
        previousSignatureParts: acceptedSignatureParts.slice(),
        reason,
        requestId,
        signal,
        visibilityState: document.visibilityState,
        urls: urls.slice(),
        fetchFresh: makeFreshFetcher(signal, requestId),
      };
      dispatchStatus("preparing", {
        requestId,
        reason,
        signature: observed.signature,
        previousSignature: acceptedSignature,
      });
      return applyCandidate(observed, context);
    }

    async function runCheck() {
      if (destroyed || pausedForPageHide || checkInFlight) return;
      checkInFlight = true;
      checkQueued = false;
      const reason = Array.from(pendingReasons).join(",") || "scheduled";
      pendingReasons.clear();
      dispatchStatus("checking", { reason });
      let outcome = "idle";
      let failure = null;
      try {
        outcome = await checkForUpdates(reason);
      } catch (error) {
        failure = error;
        if (!error || error.name !== "AbortError" || activeRequestTimedOut) {
          if (onError) {
            try { onError(error); } catch (_handlerError) {}
          }
          dispatchStatus("error", { reason, error });
          outcome = "retry";
        }
      } finally {
        if (activeRequestTimer) window.clearTimeout(activeRequestTimer);
        activeRequestTimer = 0;
        activeRequestTimedOut = false;
        activeController = null;
        checkInFlight = false;
        settleInitial(failure);
      }
      if (destroyed || pausedForPageHide) return;
      if (checkQueued || pendingReasons.size || outcome === "superseded") {
        scheduleCheck("coalesced", 0);
      } else if (outcome === "retry") {
        const delay = retryDelay();
        retryAttempt += 1;
        scheduleCheck("retry", delay);
      } else {
        scheduleCheck("interval", intervalMs);
      }
    }

    function requestCheck(reason = "manual") {
      scheduleCheck(reason, 0);
    }

    function initializeInstalledSignature() {
      let installed = null;
      try {
        const value = typeof options.getInstalledSignature === "function"
          ? options.getInstalledSignature()
          : options.installedSignature;
        if (typeof value === "string" && value.trim()) installed = value.trim();
      } catch (_error) {}
      acceptedSignature = installed;
      acceptedSignatureParts = installed === null ? [] : installed.split(SIGNATURE_SEPARATOR);
      forceApplyCurrentGeneration = installed === null;
    }

    function handleVisibilityChange() {
      if (document.visibilityState === "visible") {
        if (presentationPending) requestPresent("visible");
        requestCheck("visible");
      }
    }

    function handleResume() {
      if (presentationPending) requestPresent("resume");
      requestCheck("resume");
    }

    function handleFocus() {
      if (presentationPending) requestPresent("focus");
      requestCheck("focus");
    }

    function handlePageShow() {
      pausedForPageHide = false;
      if (presentationPending) requestPresent("pageshow");
      requestCheck("pageshow");
    }

    function handleOnline() {
      requestCheck("online");
    }

    function handlePageHide() {
      pausedForPageHide = true;
      clearScheduledCheck();
      if (activeRequestTimer) window.clearTimeout(activeRequestTimer);
      activeRequestTimer = 0;
      activeRequestTimedOut = false;
      if (activeController) activeController.abort();
    }

    function start() {
      if (started || destroyed) return api;
      started = true;
      initializeInstalledSignature();
      document.addEventListener("visibilitychange", handleVisibilityChange);
      document.addEventListener("resume", handleResume);
      window.addEventListener("focus", handleFocus);
      window.addEventListener("pageshow", handlePageShow);
      window.addEventListener("online", handleOnline);
      window.addEventListener("pagehide", handlePageHide);
      requestCheck("initial");
      return api;
    }

    function destroy() {
      if (destroyed) return;
      destroyed = true;
      clearScheduledCheck();
      if (activeRequestTimer) window.clearTimeout(activeRequestTimer);
      activeRequestTimer = 0;
      activeRequestTimedOut = false;
      if (activeController) activeController.abort();
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      document.removeEventListener("resume", handleResume);
      window.removeEventListener("focus", handleFocus);
      window.removeEventListener("pageshow", handlePageShow);
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("pagehide", handlePageHide);
      if (dataRefreshers.get(filename) === api) dataRefreshers.delete(filename);
    }

    function getStatus() {
      return {
        filename,
        acceptedSignature,
        acceptedSignatureParts: acceptedSignatureParts.slice(),
        checkInFlight,
        checkQueued,
        destroyed,
        forceApplyCurrentGeneration,
        initialSettled,
        pausedForPageHide,
        presentationPending,
        retryAttempt,
        scheduledAt,
        started,
      };
    }

    const api = { destroy, getStatus, requestCheck, requestPresent, start };
    dataRefreshers.set(filename, api);
    return api;
  }

  function initStaticPreview(options = {}) {
    const filename = String(options.filename || "").trim();
    const ready = typeof options.ready === "function" ? options.ready : () => undefined;
    initThemeSync({
      themeKey: options.themeKey,
      onThemeChanged: options.onThemeChanged,
    });
    return Promise.resolve()
      .then(ready)
      .catch((error) => {
        if (typeof options.onError === "function") options.onError(error);
        else console.error(error);
      })
      .finally(() => markReady({ filename }));
  }

  function markReady(options = {}) {
    const filename = String(options.filename || "").trim();
    const delayFrames = Math.max(1, Number(options.frames) || 2);
    const repeatCount = Math.max(1, Number(options.repeatCount) || 5);
    const repeatMs = Math.max(100, Number(options.repeatMs) || 500);
    let sentCount = 0;
    let remainingFrames = delayFrames;
    let postingStarted = false;
    const postReady = () => {
      sentCount += 1;
      try {
        document.documentElement.dataset.previewReady = "1";
      } catch (_) {}
      try {
        const targetOrigin = window.location.protocol === "file:" ? "*" : window.location.origin;
        window.parent?.postMessage(
          {
            type: "wsb-preview-ready",
            filename,
          },
          targetOrigin
        );
      } catch (_) {}
      if (sentCount < repeatCount) {
        window.setTimeout(postReady, repeatMs);
      }
    };
    const beginPosting = () => {
      if (postingStarted) return;
      postingStarted = true;
      postReady();
    };
    const waitForPaint = () => {
      if (remainingFrames > 0) {
        remainingFrames -= 1;
        requestAnimationFrame(waitForPaint);
        return;
      }
      beginPosting();
    };
    // requestAnimationFrame may be suspended before an off-screen iframe ever
    // receives a paint. Readiness must still settle so the homepage can retain
    // the frame and let its own visibility wake reconcile presentation later.
    window.setTimeout(beginPosting, 1000);
    requestAnimationFrame(waitForPaint);
  }

  window.WSBPreviewShared = {
    SIGNATURE_SEPARATOR,
    createDataRefresher,
    initThemeSync,
    initStaticPreview,
    getDataRefresher(filename) {
      return dataRefreshers.get(String(filename || "").trim()) || null;
    },
    markReady,
  };
}());
