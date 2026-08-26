(function () {
  const AUTO_REFRESH_MS = 60000;
  const PRICE_FALLBACK = 0.0001;
  const DATA_URL = "../../assets/daily_price.csv";
  const PUBLICATION_URL = "../../assets/daily_price_metadata.json";
  let cachedRows = [];
  let hasLoadedPreviewData = false;
  let installedPublicationSignature = "";
  let previewRefresher = null;

  function getCss(name, fallback) {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
  }

  function parseCsv(text) {
    const lines = String(text || "").trim().split(/\r?\n/).filter(Boolean);
    if (!lines.length) return [];
    const headers = lines.shift().split(",").map((header) => header.trim());
    return lines.map((line) => {
      const cells = line.split(",");
      const row = {};
      headers.forEach((header, index) => {
        row[header] = cells[index] ?? "";
      });
      return row;
    });
  }

  function toNumber(value) {
    const normalized = String(value ?? "").replaceAll(",", "").trim();
    if (!normalized) return NaN;
    const n = Number(normalized);
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

  function renderFallback(ctx, width, height) {
    ctx.fillStyle = getCss("--bg", "#000");
    ctx.fillRect(0, 0, width, height);
    ctx.fillStyle = getCss("--muted", "#95a6ae");
    ctx.font = "500 12px IBM Plex Mono, monospace";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("Preview unavailable", width / 2, height / 2);
  }

  function buildRows(rawRows) {
    let athPrice = PRICE_FALLBACK;
    let athDate = "";
    return rawRows
      .map((row) => {
        const date = String(row.timestamp || "").slice(0, 10);
        const price = toNumber(row.daily_high);
        const height = toNumber(row.block_height);
        return {
          date,
          timestamp: String(row.timestamp || ""),
          price: Number.isFinite(price) ? price : 0,
          sourcePriceValid: Number.isFinite(price),
          height,
        };
      })
      .filter((row) => /^\d{4}-\d{2}-\d{2}$/.test(row.date))
      .map((row) => {
        if (row.price > PRICE_FALLBACK && row.price >= athPrice) {
          athPrice = row.price;
          athDate = row.date;
        }
        const daysSinceAth = athDate
          ? Math.max(0, Math.round((Date.parse(`${row.date}T00:00:00Z`) - Date.parse(`${athDate}T00:00:00Z`)) / 86400000))
          : 0;
        return { ...row, daysSinceAth };
      });
  }

  async function sha256Text(text) {
    if (!window.crypto?.subtle || typeof TextEncoder !== "function") return "";
    const digest = await window.crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
    return Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, "0")).join("");
  }

  function validateCandidate(candidate) {
    const marker = candidate?.marker;
    const artifact = marker?.artifact;
    const rows = candidate?.rows;
    const expectedHash = String(artifact?.sha256 || "").toLowerCase();
    if (!marker || Number(marker.schema_version) !== 1) return false;
    if (String(artifact?.path || "") !== "assets/daily_price.csv") return false;
    if (!/^[a-f0-9]{64}$/.test(expectedHash) || candidate.dataHash !== expectedHash) return false;
    if (!Array.isArray(rows) || rows.length !== Number(artifact.rows) || rows.length < 6000) return false;
    if (rows[0]?.date !== String(marker.first_date || "") || rows[0]?.date !== "2009-01-03") return false;
    const latest = rows[rows.length - 1];
    if (latest?.date !== String(marker.latest_date || "")) return false;
    if (latest?.timestamp !== String(marker.latest_timestamp || "")) return false;
    if (latest?.height !== Number(marker.latest_block_height)) return false;
    if (cachedRows.length) {
      const installedLatest = cachedRows[cachedRows.length - 1];
      if (rows.length < cachedRows.length) return false;
      if (latest.date < installedLatest.date || latest.height < installedLatest.height) return false;
    }

    let previousDate = "";
    let previousHeight = -1;
    for (const row of rows) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(row.date)) return false;
      if (!row.sourcePriceValid || !Number.isFinite(row.price) || row.price < 0) return false;
      if (!Number.isInteger(row.height) || row.height < previousHeight) return false;
      if (previousDate) {
        const elapsed = Date.parse(`${row.date}T00:00:00Z`) - Date.parse(`${previousDate}T00:00:00Z`);
        if (elapsed !== 86400000) return false;
      }
      previousDate = row.date;
      previousHeight = row.height;
    }
    return true;
  }

  async function prepareCandidate(context) {
    const markerSignature = String(context?.signatureParts?.[0] || context?.signature || "").trim();
    const marker = JSON.parse(markerSignature);
    const csvText = await (await context.fetchFresh(DATA_URL)).text();
    const rows = buildRows(parseCsv(csvText));
    const candidate = {
      marker,
      markerSignature,
      rows,
      dataHash: await sha256Text(csvText),
    };
    if (!validateCandidate(candidate)) {
      throw new Error("Days Since ATH preview publication is incomplete or inconsistent.");
    }
    return candidate;
  }

  function installCandidate(candidate) {
    if (!candidate) return false;
    cachedRows = candidate.rows;
    installedPublicationSignature = candidate.markerSignature;
    hasLoadedPreviewData = true;
    return true;
  }

  function drawPanel(ctx, x, y, width, height, rows, getValue, options = {}) {
    const bg = getCss("--bg", "#000");
    const accent = getCss("--accent", "#ff9900");
    const pad = { top: 18, right: 18, bottom: 18, left: 18 };
    const plotX = x + pad.left;
    const plotY = y + pad.top;
    const plotW = Math.max(1, width - pad.left - pad.right);
    const plotH = Math.max(1, height - pad.top - pad.bottom);

    ctx.save();
    ctx.fillStyle = bg;
    ctx.beginPath();
    ctx.roundRect(x + 0.5, y + 0.5, Math.max(1, width - 1), Math.max(1, height - 1), 8);
    ctx.fill();
    ctx.clip();

    const values = rows.map(getValue).filter(Number.isFinite);
    if (!values.length) {
      ctx.restore();
      return;
    }

    const maxRaw = Math.max(...values);
    const minRaw = Math.min(...values);
    const useLog = options.log === true;
    const minY = useLog ? Math.log10(PRICE_FALLBACK) : Math.min(0, minRaw);
    const maxY = useLog
      ? Math.max(minY + 1e-9, Math.log10(Math.max(PRICE_FALLBACK * 10, maxRaw)))
      : Math.max(1e-9, maxRaw);
    const spanY = Math.max(1e-9, maxY - minY);
    const xFor = (index) => plotX + (index / Math.max(1, rows.length - 1)) * plotW;
    const yFor = (value) => {
      const mapped = useLog ? Math.log10(Math.max(PRICE_FALLBACK, value)) : value;
      return plotY + (1 - ((mapped - minY) / spanY)) * plotH;
    };

    ctx.strokeStyle = accent;
    ctx.lineWidth = 2.4;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    let started = false;
    rows.forEach((row, index) => {
      const rawValue = getValue(row);
      if (!Number.isFinite(rawValue) || (options.skipZero && rawValue <= PRICE_FALLBACK)) {
        if (started) {
          ctx.stroke();
          started = false;
        }
        return;
      }
      const xValue = xFor(index);
      const yValue = yFor(rawValue);
      if (!started) {
        ctx.beginPath();
        ctx.moveTo(xValue, yValue);
        started = true;
      } else {
        ctx.lineTo(xValue, yValue);
      }
    });
    if (started) ctx.stroke();
    ctx.restore();
  }

  function render() {
    const canvas = document.getElementById("daysSinceAthPreview");
    if (!canvas) return;
    const { ctx, width, height } = setupCanvas(canvas);
    const bg = getCss("--bg", "#000");
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, width, height);

    if (!hasLoadedPreviewData || !cachedRows.length) {
      renderFallback(ctx, width, height);
      return;
    }

    const gap = Math.max(10, Math.round(width * 0.012));
    const outerPad = Math.max(10, Math.round(Math.min(width, height) * 0.025));
    const panelY = outerPad;
    const panelH = Math.max(1, height - outerPad * 2);
    const panelW = Math.max(1, (width - outerPad * 2 - gap) / 2);
    const leftX = outerPad;
    const rightX = outerPad + panelW + gap;

    drawPanel(ctx, leftX, panelY, panelW, panelH, cachedRows, (row) => row.price, { log: true, skipZero: true });
    drawPanel(ctx, rightX, panelY, panelW, panelH, cachedRows, (row) => row.daysSinceAth, { log: false });
  }

  function renderInitialFallback() {
    const canvas = document.getElementById("daysSinceAthPreview");
    if (canvas) {
      const { ctx, width, height } = setupCanvas(canvas);
      renderFallback(ctx, width, height);
    }
  }

  function init() {
    window.WSBPreviewShared?.initThemeSync({
      onThemeChanged: () => previewRefresher?.requestPresent("theme"),
    });
    previewRefresher = window.WSBPreviewShared?.createDataRefresher({
      filename: "days_since_ath.png",
      urls: [PUBLICATION_URL],
      intervalMs: AUTO_REFRESH_MS,
      getInstalledSignature: () => installedPublicationSignature,
      prepare: prepareCandidate,
      validate: validateCandidate,
      commit: (candidate) => {
        installCandidate(candidate);
        return { present: true };
      },
      present: render,
      onInitialError: renderInitialFallback,
      onError: (error) => {
        console.warn("Days Since ATH preview refresh failed; keeping the current chart.", error);
      },
    });
    if (!previewRefresher) {
      renderInitialFallback();
      window.WSBPreviewShared?.markReady?.({ filename: "days_since_ath.png" });
      return;
    }
    window.addEventListener("resize", () => previewRefresher.requestPresent("resize"));
    previewRefresher.start();
  }

  try {
    init();
  } catch (error) {
    console.error(error);
    renderInitialFallback();
    window.WSBPreviewShared?.markReady?.({ filename: "days_since_ath.png" });
  }
}());
