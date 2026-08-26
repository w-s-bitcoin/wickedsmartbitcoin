(function () {
  "use strict";

  // Inline configuration remains `{ urls, intervalMs }`. Dashboard code loaded
  // after this helper registers either:
  //   { getInstalledSignature?(), prepare(context), validate?(candidate, context), commit(candidate, context) }
  // or, for compatibility, `{ onUpdate(context) }` / `config.onUpdate`.
  // A resolved value other than explicit `false` accepts the update. `false`,
  // rejection, or validation failure leaves the prior signature active so the
  // same generation is retried without disturbing the rendered dashboard.

  const config = window.WSBWebappDataAutoRefresh || {};
  const urls = Array.isArray(config.urls) ? config.urls.filter(Boolean) : [];
  const intervalMs = Number(config.intervalMs) > 0 ? Number(config.intervalMs) : 60000;
  const retryBaseMs = Number(config.retryBaseMs) > 0
    ? Number(config.retryBaseMs)
    : Math.min(5000, intervalMs);
  const retryMaxMs = Number(config.retryMaxMs) > 0
    ? Math.max(Number(config.retryMaxMs), retryBaseMs)
    : Math.max(retryBaseMs, intervalMs);

  let acceptedSignature = null;
  let acceptedSignatureParts = [];
  let adapter = null;
  let activeController = null;
  let checkInFlight = false;
  let checkQueued = false;
  let destroyed = false;
  let forceApplyCurrentGeneration = false;
  let pausedForPageHide = false;
  let retryAttempt = 0;
  let requestSequence = 0;
  let scheduledAt = 0;
  let scheduledTimer = 0;
  let started = false;
  const pendingReasons = new Set();

  function withBust(url, bustValue) {
    const freshUrl = new URL(String(url), document.baseURI);
    freshUrl.searchParams.set("wsb_refresh", String(bustValue));
    return freshUrl.href;
  }

  function makeHttpError(url, response) {
    const error = new Error(`Failed to load ${url} (${response.status})`);
    error.response = response;
    return error;
  }

  async function fetchSignaturePart(url, signal, bustValue) {
    const response = await fetch(withBust(url, bustValue), {
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
    return {
      parts,
      signature: parts.join("\n---WSB-DATA-SIGNATURE-PART---\n"),
    };
  }

  function dispatchStatus(status, extra) {
    const detail = Object.assign({
      status,
      acceptedSignature,
      checkInFlight,
      visibilityState: document.visibilityState,
    }, extra || {});
    try {
      window.dispatchEvent(new CustomEvent("wsb:data-refresh-status", { detail }));
    } catch (_error) {
      // Status events are diagnostic only; refreshes must not depend on them.
    }
  }

  function clearScheduledCheck() {
    if (scheduledTimer) window.clearTimeout(scheduledTimer);
    scheduledTimer = 0;
    scheduledAt = 0;
  }

  function scheduleCheck(reason, delayMs) {
    if (destroyed) return;
    pendingReasons.add(reason || "requested");

    if (!started || pausedForPageHide) {
      checkQueued = true;
      return;
    }

    if (checkInFlight) {
      checkQueued = true;
      return;
    }

    const delay = Math.max(0, Number(delayMs) || 0);
    const dueAt = Date.now() + delay;
    if (scheduledTimer && scheduledAt <= dueAt) return;

    clearScheduledCheck();
    scheduledAt = dueAt;
    scheduledTimer = window.setTimeout(() => {
      scheduledTimer = 0;
      scheduledAt = 0;
      void runCheck();
    }, delay);
  }

  function retryDelay() {
    const exponent = Math.min(retryAttempt, 6);
    return Math.min(retryMaxMs, retryBaseMs * (2 ** exponent));
  }

  function makeFreshFetcher(signal, requestId) {
    let fetchSequence = 0;
    return async function fetchFresh(url, init) {
      fetchSequence += 1;
      const options = Object.assign({}, init || {}, {
        cache: "no-store",
        signal,
      });
      const response = await fetch(
        withBust(url, `${requestId}-data-${fetchSequence}`),
        options
      );
      if (!response.ok) throw makeHttpError(url, response);
      return response;
    };
  }

  function currentAdapter() {
    if (adapter) return adapter;
    if (typeof config.onUpdate === "function") {
      return { onUpdate: config.onUpdate, onError: config.onError };
    }
    return null;
  }

  async function applyUpdate(updateAdapter, context) {
    if (typeof updateAdapter.onUpdate === "function") {
      // A one-phase callback cannot be checked between its private preparation
      // and commit steps. At least ensure the generation is still current at
      // the point control is handed to it. New adapters should prefer the
      // prepare/commit contract below for a strict pre-commit generation gate.
      const verified = await fetchSignature(
        context.signal,
        context.requestId,
        "pre-update"
      );
      if (verified.signature !== context.signature) {
        pendingReasons.add("generation-superseded");
        checkQueued = true;
        return false;
      }
      context.visibilityState = document.visibilityState;
      return (await updateAdapter.onUpdate(context)) !== false;
    }

    if (typeof updateAdapter.prepare !== "function"
        || typeof updateAdapter.commit !== "function") {
      throw new TypeError(
        "Webapp data auto-refresh adapter requires onUpdate, or prepare and commit callbacks."
      );
    }

    const candidate = await updateAdapter.prepare(context);
    if (context.signal.aborted) throw new DOMException("Refresh aborted", "AbortError");

    if (typeof updateAdapter.validate === "function") {
      const isValid = await updateAdapter.validate(candidate, context);
      if (isValid === false) return false;
    }

    // Nothing visible has changed yet. Re-probe the publication marker and
    // discard this detached candidate if a newer generation appeared while it
    // was loading. This is the atomic boundary promised by register().
    const verified = await fetchSignature(
      context.signal,
      context.requestId,
      "pre-commit"
    );
    if (verified.signature !== context.signature) {
      pendingReasons.add("generation-superseded");
      checkQueued = true;
      return false;
    }

    context.visibilityState = document.visibilityState;
    const committed = await updateAdapter.commit(candidate, context);
    return committed !== false;
  }

  async function checkForUpdates(reason) {
    const requestId = ++requestSequence;
    const controller = new AbortController();
    activeController = controller;
    const signal = controller.signal;
    const observed = await fetchSignature(signal, requestId, "probe");

    if (acceptedSignature === null && !forceApplyCurrentGeneration) {
      acceptedSignature = observed.signature;
      acceptedSignatureParts = observed.parts.slice();
      retryAttempt = 0;
      dispatchStatus("baseline", { requestId, reason });
      return "idle";
    }

    if (observed.signature === acceptedSignature && !forceApplyCurrentGeneration) {
      retryAttempt = 0;
      dispatchStatus("unchanged", { requestId, reason });
      return "idle";
    }

    const updateAdapter = currentAdapter();
    if (!updateAdapter) {
      dispatchStatus("waiting-for-adapter", {
        requestId,
        reason,
        signature: observed.signature,
      });
      return "retry";
    }

    const previousSignature = acceptedSignature;
    const context = {
      signature: observed.signature,
      signatureParts: observed.parts.slice(),
      previousSignature,
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
      previousSignature,
    });

    let applied;
    try {
      applied = await applyUpdate(updateAdapter, context);
    } catch (error) {
      if (typeof updateAdapter.onError === "function") {
        try {
          updateAdapter.onError(error, context);
        } catch (_onErrorFailure) {
          // The original refresh error remains the useful failure.
        }
      }
      throw error;
    }

    if (!applied) {
      dispatchStatus("deferred", {
        requestId,
        reason,
        signature: observed.signature,
        previousSignature,
      });
      return "retry";
    }

    // The dashboard has atomically installed this generation. Advance only now;
    // failed or deliberately deferred commits continue to target the same data.
    acceptedSignature = observed.signature;
    acceptedSignatureParts = observed.parts.slice();
    forceApplyCurrentGeneration = false;
    retryAttempt = 0;
    dispatchStatus("applied", {
      requestId,
      reason,
      signature: observed.signature,
      previousSignature,
    });

    // If publishing advanced while the adapter was preparing, immediately fetch
    // the next complete generation instead of treating it as already applied.
    try {
      const verified = await fetchSignature(signal, requestId, "verify");
      if (verified.signature !== acceptedSignature) {
        pendingReasons.add("generation-advanced");
        checkQueued = true;
      }
    } catch (error) {
      if (error && error.name === "AbortError") throw error;
      // The accepted generation is already installed. A failed verification is
      // harmless; the regular poll/wake path will check again.
      console.warn("Webapp data auto-refresh verification failed:", error);
    }

    return "idle";
  }

  async function runCheck() {
    if (destroyed || pausedForPageHide || checkInFlight || !urls.length) return;
    checkInFlight = true;
    checkQueued = false;
    const reason = Array.from(pendingReasons).join(",") || "scheduled";
    pendingReasons.clear();
    dispatchStatus("checking", { reason });

    let outcome = "idle";
    try {
      outcome = await checkForUpdates(reason);
    } catch (error) {
      if (!error || error.name !== "AbortError") {
        console.warn("Webapp data auto-refresh check failed:", error);
        dispatchStatus("error", { reason, error });
        outcome = "retry";
      }
    } finally {
      activeController = null;
      checkInFlight = false;
    }

    if (destroyed || pausedForPageHide) return;
    if (checkQueued || pendingReasons.size) {
      scheduleCheck("coalesced", 0);
      return;
    }
    if (outcome === "retry") {
      const delay = retryDelay();
      retryAttempt += 1;
      scheduleCheck("retry", delay);
      return;
    }
    scheduleCheck("interval", intervalMs);
  }

  function requestCheck(reason) {
    scheduleCheck(reason || "manual", 0);
  }

  function register(nextAdapter) {
    if (typeof nextAdapter === "function") {
      adapter = { onUpdate: nextAdapter };
    } else if (nextAdapter && typeof nextAdapter === "object") {
      adapter = nextAdapter;
    } else {
      throw new TypeError("Webapp data auto-refresh register() requires an adapter.");
    }

    // The adapter registers only after its initial dashboard data is installed.
    // Let it identify that exact generation so a publication that overlapped
    // startup cannot be mistaken for an already-rendered baseline. When an
    // adapter cannot identify its installed generation, reconcile the current
    // marker once rather than risk leaving stale initial state indefinitely.
    let installedSignature = null;
    try {
      const value = typeof adapter.getInstalledSignature === "function"
        ? adapter.getInstalledSignature()
        : adapter.installedSignature;
      if (typeof value === "string" && value.trim()) {
        installedSignature = value.trim();
      }
    } catch (_error) {
      installedSignature = null;
    }
    if (installedSignature !== null) {
      acceptedSignature = installedSignature;
      acceptedSignatureParts = [installedSignature];
      forceApplyCurrentGeneration = false;
    } else {
      forceApplyCurrentGeneration = true;
    }
    requestCheck("adapter-registered");
    const registeredAdapter = adapter;
    return function unregister() {
      if (adapter === registeredAdapter) adapter = null;
    };
  }

  function getStatus() {
    return {
      acceptedSignature,
      acceptedSignatureParts: acceptedSignatureParts.slice(),
      checkInFlight,
      checkQueued,
      destroyed,
      pausedForPageHide,
      forceApplyCurrentGeneration,
      retryAttempt,
      scheduledAt,
      started,
    };
  }

  function destroy() {
    if (destroyed) return;
    destroyed = true;
    clearScheduledCheck();
    if (activeController) activeController.abort();
    document.removeEventListener("visibilitychange", handleVisibilityChange);
    document.removeEventListener("resume", handleResume);
    window.removeEventListener("focus", handleFocus);
    window.removeEventListener("pageshow", handlePageShow);
    window.removeEventListener("online", handleOnline);
    window.removeEventListener("pagehide", handlePageHide);
  }

  function handleVisibilityChange() {
    if (document.visibilityState === "visible") requestCheck("visible");
  }

  function handleResume() {
    requestCheck("resume");
  }

  function handleFocus() {
    requestCheck("focus");
  }

  function handlePageShow() {
    pausedForPageHide = false;
    requestCheck("pageshow");
  }

  function handleOnline() {
    requestCheck("online");
  }

  function handlePageHide() {
    pausedForPageHide = true;
    clearScheduledCheck();
    if (activeController) activeController.abort();
  }

  // Preserve the existing inline `{ urls, intervalMs }` configuration object so
  // dashboard code loaded after this helper can attach an adapter at runtime.
  Object.assign(config, {
    register,
    requestCheck,
    getStatus,
    destroy,
  });
  window.WSBWebappDataAutoRefresh = config;

  function start() {
    if (destroyed || !urls.length) return;
    started = true;
    document.addEventListener("visibilitychange", handleVisibilityChange);
    document.addEventListener("resume", handleResume);
    window.addEventListener("focus", handleFocus);
    window.addEventListener("pageshow", handlePageShow);
    window.addEventListener("online", handleOnline);
    window.addEventListener("pagehide", handlePageHide);
    requestCheck("initial");
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start, { once: true });
  } else {
    start();
  }
}());
