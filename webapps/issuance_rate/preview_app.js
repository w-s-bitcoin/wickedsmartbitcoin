(function () {
  const AUTO_REFRESH_MS = 60000;
  const PREVIEW_URL = "webapp_data/issuance_rate_preview.json";
  const PUBLICATION_URL = "webapp_data/published_generation.json";
  let cachedRows = [];
  let installedPublicationSignature = "";
  let installedBounds = null;
  let refresher = null;

  function getCss(name, fallback) {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
  }

  function toNumber(value) {
    const n = Number(value);
    return Number.isFinite(n) ? n : NaN;
  }

  function isValidIsoDate(value) {
    const raw = String(value || "").trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return false;
    const parsed = new Date(`${raw}T00:00:00Z`);
    return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === raw;
  }

  function utcDayNumber(value) {
    return Date.parse(`${value}T00:00:00Z`) / 86400000;
  }

  async function sha256Hex(text) {
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
    return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
  }

  function parsePublicationMarker(text) {
    let marker;
    try {
      marker = JSON.parse(text);
    } catch (error) {
      throw new Error(`Issuance publication marker is invalid JSON: ${error.message}`);
    }
    const preview = marker?.preview;
    if (
      marker?.schema_version !== 1 ||
      !String(marker.generated_utc || "").trim() ||
      !Number.isInteger(marker.latest_block_height) || marker.latest_block_height < 0 ||
      !preview || preview.path !== PREVIEW_URL ||
      !/^[0-9a-f]{64}$/.test(String(preview.sha256 || "")) ||
      preview.sha256 !== marker.preview_sha256 ||
      !Number.isInteger(preview.rows) || preview.rows < 1 ||
      !isValidIsoDate(preview.first_date) ||
      !isValidIsoDate(preview.latest_date) ||
      !Number.isInteger(preview.first_height) || preview.first_height < 0 ||
      !Number.isInteger(preview.latest_height) || preview.latest_height < preview.first_height
    ) {
      throw new Error("Issuance publication marker has invalid preview metadata.");
    }
    return marker;
  }

  function validateRows(rows) {
    if (!Array.isArray(rows) || !rows.length) throw new Error("Issuance preview is empty.");
    return rows.map((row, index) => {
      const date = String(row?.date || "").trim();
      const height = Number(row?.height);
      const epoch = Number(row?.epoch);
      const issuanceRate = Number(row?.issuance_rate);
      const targetRate = Number(row?.target_rate);
      if (
        !isValidIsoDate(date) ||
        !Number.isInteger(height) || height < 0 ||
        !Number.isInteger(epoch) || epoch < 1 ||
        !Number.isFinite(issuanceRate) || issuanceRate < 0 ||
        !Number.isFinite(targetRate) || targetRate < 0
      ) {
        throw new Error(`Issuance preview row ${index + 1} is invalid.`);
      }
      if (index > 0) {
        const previous = rows[index - 1];
        if (utcDayNumber(date) !== utcDayNumber(previous.date) + 1 || height < Number(previous.height)) {
          throw new Error(`Issuance preview row ${index + 1} is out of order.`);
        }
      }
      return row;
    });
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

    if (!cachedRows.length) {
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

  async function prepareCandidate(context) {
    const marker = parsePublicationMarker(context.signatureParts[0]);
    const response = await context.fetchFresh(PREVIEW_URL);
    const previewText = await response.text();
    let payload;
    try {
      payload = JSON.parse(previewText);
    } catch (error) {
      throw new Error(`Issuance preview is invalid JSON: ${error.message}`);
    }
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
      throw new Error("Issuance preview payload is not an object.");
    }
    return {
      marker,
      payload,
      rows: validateRows(payload.rows),
      sha256: await sha256Hex(previewText),
    };
  }

  function validateCandidate(candidate) {
    const marker = candidate.marker;
    const preview = marker.preview;
    const source = candidate.payload.source;
    const first = candidate.rows[0];
    const latest = candidate.rows[candidate.rows.length - 1];
    if (
      candidate.sha256 !== preview.sha256 ||
      candidate.payload.generated_utc !== marker.generated_utc ||
      !source || Number(source.latest_block_height) !== marker.latest_block_height ||
      candidate.rows.length !== preview.rows ||
      first.date !== preview.first_date || latest.date !== preview.latest_date ||
      Number(first.height) !== preview.first_height || Number(latest.height) !== preview.latest_height ||
      Number(latest.height) !== marker.latest_block_height
    ) {
      throw new Error("Issuance preview does not match its publication marker.");
    }
    if (installedBounds && Number(latest.height) < installedBounds.latestHeight) {
      throw new Error("Issuance preview generation regressed.");
    }
    return true;
  }

  function commitCandidate(candidate, context) {
    cachedRows = candidate.rows;
    const latest = candidate.rows[candidate.rows.length - 1];
    installedBounds = { latestDate: latest.date, latestHeight: Number(latest.height) };
    installedPublicationSignature = context.signature;
    return { present: true };
  }

  function renderInitialFallback() {
    const canvas = document.getElementById("issuancePreview");
    if (!canvas) return;
    const { ctx, width, height } = setupCanvas(canvas);
    renderFallback(ctx, width, height, "Preview unavailable");
  }

  function requestPresent(reason) {
    if (refresher) refresher.requestPresent(reason);
  }

  function init() {
    const shared = window.WSBPreviewShared;
    if (!shared?.createDataRefresher) {
      renderInitialFallback();
      shared?.markReady?.({ filename: "issuance_rate.png" });
      return;
    }
    shared.initThemeSync({ onThemeChanged: () => requestPresent("theme") });
    window.addEventListener("resize", () => requestPresent("resize"));
    refresher = shared.createDataRefresher({
      filename: "issuance_rate.png",
      urls: [PUBLICATION_URL],
      intervalMs: AUTO_REFRESH_MS,
      getInstalledSignature: () => installedPublicationSignature,
      prepare: prepareCandidate,
      validate: validateCandidate,
      commit: commitCandidate,
      present: render,
      onInitialError(error) {
        console.error("Issuance preview initial load failed:", error);
        renderInitialFallback();
      },
      onError(error) {
        console.warn("Issuance preview refresh deferred:", error);
      },
    });
    refresher.start();
  }

  init();
}());
