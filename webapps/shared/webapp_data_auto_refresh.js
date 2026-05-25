(function () {
  const config = window.WSBWebappDataAutoRefresh || {};
  const urls = Array.isArray(config.urls) ? config.urls.filter(Boolean) : [];
  if (!urls.length) return;

  const intervalMs = Number(config.intervalMs) > 0 ? Number(config.intervalMs) : 60000;
  let currentSignature = "";
  let checkInFlight = false;
  let timerId = 0;

  function withBust(url) {
    const separator = String(url).includes("?") ? "&" : "?";
    return `${url}${separator}refresh=${Date.now()}`;
  }

  async function fetchSignaturePart(url) {
    const response = await fetch(withBust(url), { cache: "no-store" });
    if (!response.ok) throw new Error(`Failed to load ${url} (${response.status})`);
    return (await response.text()).trim();
  }

  async function fetchSignature() {
    const parts = await Promise.all(urls.map(fetchSignaturePart));
    return parts.join("\n---WSB-DATA-SIGNATURE-PART---\n");
  }

  async function checkForUpdates() {
    if (checkInFlight) return;
    checkInFlight = true;
    try {
      const latestSignature = await fetchSignature();
      if (!currentSignature) {
        currentSignature = latestSignature;
        return;
      }
      if (latestSignature && latestSignature !== currentSignature) {
        window.location.reload();
      }
    } catch (error) {
      console.warn("Webapp data auto-refresh check failed:", error);
    } finally {
      checkInFlight = false;
    }
  }

  function triggerCheckSoon(delayMs = 150) {
    window.setTimeout(checkForUpdates, delayMs);
  }

  function start() {
    triggerCheckSoon(0);
    timerId = window.setInterval(checkForUpdates, intervalMs);
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") triggerCheckSoon(0);
    });
    window.addEventListener("focus", () => triggerCheckSoon(0));
    window.addEventListener("pageshow", () => triggerCheckSoon(0));
    window.addEventListener("online", () => triggerCheckSoon(0));
    window.addEventListener("pagehide", () => {
      if (timerId) window.clearInterval(timerId);
    }, { once: true });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start, { once: true });
  } else {
    start();
  }
}());
