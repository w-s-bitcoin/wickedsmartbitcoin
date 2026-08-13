(function () {
  const AUTO_REFRESH_MS = 60000;
  let cachedRows = [];
  let hasLoadedPreviewData = false;

  function getCss(name, fallback) {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
  }

  function toNumber(value) {
    const n = Number(value);
    return Number.isFinite(n) ? n : NaN;
  }

  function setupCanvas(canvas) {
    const rect = canvas.getBoundingClientRect();
    const dpr = Math.max(1, window.devicePixelRatio || 1);
    const width = Math.max(1, Math.round(rect.width));
    const height = Math.max(1, Math.round(rect.height));
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    const ctx = canvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { ctx, width, height };
  }

  function renderFallback(ctx, width, height, text) {
    ctx.fillStyle = getCss("--bg", "#000");
    ctx.fillRect(0, 0, width, height);
    ctx.fillStyle = getCss("--muted", "#95a6ae");
    ctx.font = "500 12px IBM Plex Mono, monospace";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(text, width / 2, height / 2);
  }

  function drawLine(ctx, rows, xFor, yFor, key, color, lineWidth) {
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = lineWidth;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    let started = false;
    rows.forEach((row, index) => {
      const x = xFor(row, index);
      const y = yFor(toNumber(row[key]));
      if (!Number.isFinite(x) || !Number.isFinite(y)) return;
      if (!started) {
        ctx.beginPath();
        ctx.moveTo(x, y);
        started = true;
      } else {
        ctx.lineTo(x, y);
      }
    });
    if (started) ctx.stroke();
    ctx.restore();
  }

  function getCurrentEpochRows() {
    const latest = cachedRows[cachedRows.length - 1];
    const epoch = toNumber(latest?.epoch);
    if (!Number.isFinite(epoch)) return cachedRows;
    return cachedRows.filter((row) => toNumber(row.epoch) === epoch);
  }

  function render() {
    const canvas = document.getElementById("issuancePreview");
    if (!canvas) return;
    const { ctx, width, height } = setupCanvas(canvas);
    const bg = getCss("--bg", "#000");
    const actual = getCss("--actual", "#f1f5f7");
    const target = getCss("--target", "#ff9900");

    if (!hasLoadedPreviewData || !cachedRows.length) {
      renderFallback(ctx, width, height, "Preview unavailable");
      return;
    }

    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, width, height);

    const currentEpochRows = getCurrentEpochRows();
    const pad = { top: 18, right: 24, bottom: 22, left: 36 };
    const plotW = Math.max(1, width - pad.left - pad.right);
    const plotH = Math.max(1, height - pad.top - pad.bottom);
    const latest = currentEpochRows[currentEpochRows.length - 1];
    const latestEpoch = toNumber(latest?.epoch);
    const epochStartHeight = Number.isFinite(latestEpoch) ? (latestEpoch - 1) * 210000 : toNumber(currentEpochRows[0]?.height);
    const epochEndHeight = epochStartHeight + 210000;
    const domainPaddingBlocks = 0.025 * 210000;
    const domainStartHeight = Number.isFinite(epochStartHeight) ? epochStartHeight - domainPaddingBlocks : toNumber(cachedRows[0]?.height);
    const domainEndHeight = Number.isFinite(epochEndHeight) ? epochEndHeight + domainPaddingBlocks : toNumber(cachedRows[cachedRows.length - 1]?.height);
    const rows = cachedRows.filter((row) => {
      const heightValue = toNumber(row.height);
      return Number.isFinite(heightValue)
        && Number.isFinite(domainStartHeight)
        && Number.isFinite(domainEndHeight)
        && heightValue >= domainStartHeight
        && heightValue <= domainEndHeight;
    });
    const values = rows.flatMap((row) => [toNumber(row.issuance_rate), toNumber(row.target_rate)])
      .filter(Number.isFinite);
    const minY = Math.min(0, ...values);
    const maxRaw = Math.max(0.01, ...values);
    const maxY = maxRaw * 1.04;
    const xFor = (row, idx) => {
      const heightValue = toNumber(row.height);
      if (Number.isFinite(heightValue) && Number.isFinite(domainStartHeight) && Number.isFinite(domainEndHeight)) {
        return pad.left + ((heightValue - domainStartHeight) / Math.max(1, domainEndHeight - domainStartHeight)) * plotW;
      }
      return pad.left + (idx / Math.max(1, rows.length - 1)) * plotW;
    };
    const yFor = (value) => pad.top + ((maxY - value) / Math.max(1e-9, maxY - minY)) * plotH;

    drawLine(ctx, rows, xFor, yFor, "issuance_rate", actual, 1.6);
    drawLine(ctx, rows, xFor, yFor, "target_rate", bg, 5);
    drawLine(ctx, rows, xFor, yFor, "target_rate", target, 3.2);

  }

  async function fetchJsonWithFallback(urls) {
    let lastError = null;
    for (const url of urls) {
      try {
        const resp = await fetch(url, { cache: "no-store" });
        if (!resp.ok) throw new Error(`Failed to load ${url} (${resp.status}).`);
        return await resp.json();
      } catch (error) {
        lastError = error;
      }
    }
    throw lastError || new Error("Failed to load issuance preview data.");
  }

  async function load() {
    const data = await fetchJsonWithFallback([
      "webapp_data/issuance_rate_preview.json",
      "webapp_data/issuance_rate_data.json",
    ]);
    cachedRows = Array.isArray(data?.rows) ? data.rows.filter((row) => (
      Number.isFinite(toNumber(row.issuance_rate)) &&
      Number.isFinite(toNumber(row.target_rate))
    )) : [];
    hasLoadedPreviewData = true;
  }

  async function init() {
    window.WSBPreviewShared?.initThemeSync({ onThemeChanged: render });
    await load();
    render();
    window.WSBPreviewShared?.markReady?.({ filename: "issuance_rate.png" });
    window.addEventListener("resize", render);
    window.WSBPreviewShared
      ?.createAutoRefresher({
        intervalMs: AUTO_REFRESH_MS,
        refresh: async () => {
          await load();
          render();
        },
      })
      .start();
  }

  init().catch((error) => {
    console.error(error);
    const canvas = document.getElementById("issuancePreview");
    if (canvas) {
      const { ctx, width, height } = setupCanvas(canvas);
      renderFallback(ctx, width, height, "Preview unavailable");
    }
    window.WSBPreviewShared?.markReady?.({ filename: "issuance_rate.png" });
  });
}());
