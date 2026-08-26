(() => {
  const canvas = document.getElementById("patoshiPreview");
  const ctx = canvas.getContext("2d", { alpha: false });
  const DATA_URL = "webapp_data/patoshi_preview_blocks.csv?v=80d3dc54f671";
  const DATA_SHA256 = "80d3dc54f671aefb7a01d9b675970c59243ad82f648a089cfab4daaab1df1d73";
  const EXPECTED_ROWS = 16214;
  const START = Date.UTC(2009, 0, 9);
  const END = Date.UTC(2009, 5, 1);
  let installedRows = [];
  let loadInFlight = null;
  let presentationPending = false;
  let retrySequence = 0;

  async function sha256Text(text) {
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
    return Array.from(new Uint8Array(digest), value => value.toString(16).padStart(2, "0")).join("");
  }

  function parseCsv(text) {
    const lines = String(text || "").trim().split(/\r?\n/);
    const header = (lines.shift() || "").split(",").map(value => value.trim());
    const timestampIndex = header.indexOf("timestamp");
    const extranonceIndex = header.indexOf("extranonce");
    const patoshiIndex = header.indexOf("patoshi");
    if (timestampIndex < 0 || extranonceIndex < 0 || patoshiIndex < 0) {
      throw new Error("Patoshi preview data has an invalid header.");
    }
    const rows = lines.map((line) => {
      const parts = line.split(",");
      return {
        ms: Number(parts[timestampIndex]) * 1000,
        extranonce: Number(parts[extranonceIndex]),
        patoshi: parts[patoshiIndex] === "1",
      };
    });
    if (rows.length !== EXPECTED_ROWS) throw new Error("Patoshi preview data is incomplete.");
    let patoshiCount = 0;
    for (const row of rows) {
      // Bitcoin block timestamps are miner supplied and can legitimately move
      // backward between adjacent heights. The exact file hash fixes the build
      // geometry; validate its time domain without imposing false monotonicity.
      if (!Number.isFinite(row.ms) || row.ms < START || row.ms > END) {
        throw new Error("Patoshi preview timestamps are invalid.");
      }
      if (!Number.isFinite(row.extranonce) || row.extranonce < 0) {
        throw new Error("Patoshi preview extranonce data is invalid.");
      }
      patoshiCount += row.patoshi ? 1 : 0;
    }
    if (rows[0].ms > START + 86400000 || rows[rows.length - 1].ms < END - 86400000) {
      throw new Error("Patoshi preview date coverage is incomplete.");
    }
    if (patoshiCount < 1000 || (rows.length - patoshiCount) < 1000) {
      throw new Error("Patoshi preview classifications are incomplete.");
    }
    return rows;
  }

  function resize() {
    const dpr = Math.max(1, window.devicePixelRatio || 1);
    const w = Math.max(320, window.innerWidth);
    const h = Math.max(180, window.innerHeight);
    canvas.width = Math.floor(w * dpr);
    canvas.height = Math.floor(h * dpr);
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { w, h };
  }

  function draw(rows) {
    const { w, h } = resize();
    const light = document.documentElement.dataset.theme === "light";
    ctx.fillStyle = light ? "#fff" : "#000";
    ctx.fillRect(0, 0, w, h);
    if (!rows.length) return;
    const maxY = Math.max(500, ...rows.filter(row => row.patoshi).map(row => row.extranonce));
    const x = ms => 16 + ((ms - START) / (END - START)) * (w - 32);
    const y = value => h - 12 - (value / maxY) * (h - 24);

    ctx.lineWidth = 1.5;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = "#ff9900";
    ctx.beginPath();
    let started = false;
    let previous = null;
    rows.filter(row => row.patoshi).forEach(row => {
      if (previous && row.extranonce > previous.extranonce) {
        if (!started) {
          ctx.moveTo(x(previous.ms), y(previous.extranonce));
          started = true;
        }
        ctx.lineTo(x(row.ms), y(row.extranonce));
      } else if (started) {
        ctx.stroke();
        ctx.beginPath();
        started = false;
      }
      previous = row;
    });
    if (started) ctx.stroke();

    rows.forEach(row => {
      ctx.fillStyle = row.patoshi ? "#ff9900" : "#0065ff";
      ctx.globalAlpha = row.patoshi ? 0.95 : 0.5;
      ctx.beginPath();
      ctx.arc(x(row.ms), y(row.extranonce), row.patoshi ? 2.2 : 1.8, 0, Math.PI * 2);
      ctx.fill();
    });
    ctx.globalAlpha = 1;
  }

  function requestPresentation() {
    if (document.visibilityState !== "visible") {
      presentationPending = true;
      return false;
    }
    presentationPending = false;
    draw(installedRows);
    canvas.dataset.previewState = installedRows.length ? "presented" : "fallback";
    return true;
  }

  async function loadStaticData({ refresh = false } = {}) {
    if (loadInFlight) return loadInFlight;
    loadInFlight = (async () => {
      const controller = new AbortController();
      const timer = window.setTimeout(() => {
        controller.abort(new DOMException("Patoshi preview load timed out.", "TimeoutError"));
      }, 30000);
      try {
        const url = new URL(DATA_URL, document.baseURI);
        if (refresh) {
          retrySequence += 1;
          url.searchParams.set("wsb_preview_asset_retry", `${Date.now()}-${retrySequence}`);
        }
        const response = await fetch(url.href, {
          cache: refresh ? "reload" : "force-cache",
          signal: controller.signal,
        });
        if (!response.ok) throw new Error(`Patoshi preview request failed (${response.status}).`);
        const text = await response.text();
        if (await sha256Text(text) !== DATA_SHA256) {
          throw new Error("Patoshi preview fingerprint does not match its static build.");
        }
        const candidate = parseCsv(text);
        installedRows = candidate;
        delete canvas.dataset.previewError;
        canvas.dataset.previewState = "installed";
        requestPresentation();
        return true;
      } finally {
        window.clearTimeout(timer);
        loadInFlight = null;
      }
    })();
    return loadInFlight;
  }

  async function recoverStaticData() {
    if (installedRows.length) {
      if (presentationPending) requestPresentation();
      return;
    }
    try {
      await loadStaticData({ refresh: true });
    } catch (error) {
      canvas.dataset.previewError = String(error?.message || error || "Preview recovery failed");
      console.warn("Patoshi preview recovery failed; keeping the current canvas.", error);
    }
  }

  window.WSBPreviewShared?.initStaticPreview?.({
    filename: "patoshi_pattern.png",
    onThemeChanged: requestPresentation,
    ready: () => loadStaticData(),
    onError: error => {
      canvas.dataset.previewError = String(error?.message || error || "Preview data unavailable");
      console.warn("Patoshi preview data is unavailable; waiting to retry.", error);
      requestPresentation();
    },
  });
  window.addEventListener("resize", requestPresentation);
  window.addEventListener("online", recoverStaticData);
  window.addEventListener("pageshow", recoverStaticData);
  document.addEventListener("resume", recoverStaticData);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") recoverStaticData();
  });
})();
