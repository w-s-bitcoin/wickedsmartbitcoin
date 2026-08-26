(function () {
  const AUTO_REFRESH_MS = 60000;
  const PREVIEW_URL = "webapp_data/dca_comparison_preview.csv";
  const PUBLICATION_URL = "webapp_data/published_generation.json";
  const MS_DAY = 86400000;
  const DEFAULT_AMOUNT = 50;
  const DEFAULT_ASSET_A = "BTC";
  const DEFAULT_ASSET_B = "XAU";
  const DEFAULT_CADENCE = "weekly";
  const DEFAULT_RANGE_YEARS = 4;

  const ASSETS = {
    BTC: { column: "BTC", cssVar: "--btc" },
    XAU: { column: "XAU", cssVar: "--gold" },
    XAG: { column: "XAG", cssVar: "--silver" },
    SPY: { column: "SPY", cssVar: "--ink-dim" },
    QQQ: { column: "QQQ", cssVar: "--muted" },
    TLT: { column: "TLT", cssVar: "--link" },
    MSTR: { column: "MSTR", cssVar: "--accent" },
  };

  let cachedRows = [];
  let installedPublicationSignature = "";
  let installedBounds = null;
  let refresher = null;

  function parseCsv(text) {
    const rows = [];
    let row = [];
    let value = "";
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
      if (ch === "," && !inQuotes) {
        row.push(value);
        value = "";
        continue;
      }
      if ((ch === "\n" || ch === "\r") && !inQuotes) {
        if (ch === "\r" && text[i + 1] === "\n") i += 1;
        row.push(value);
        if (row.some((cell) => String(cell || "").length)) rows.push(row);
        row = [];
        value = "";
        continue;
      }
      value += ch;
    }

    if (value.length || row.length) {
      row.push(value);
      if (row.some((cell) => String(cell || "").length)) rows.push(row);
    }

    return rows;
  }

  function toNumber(value) {
    const parsed = Number.parseFloat(String(value ?? "").replaceAll(",", "").trim());
    return Number.isFinite(parsed) ? parsed : NaN;
  }

  function isoFromMaybeUsDate(value) {
    const raw = String(value || "").trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
    const match = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
    if (!match) return "";
    const year = Number(match[3].length === 2 ? `20${match[3]}` : match[3]);
    return `${year}-${String(Number(match[1])).padStart(2, "0")}-${String(Number(match[2])).padStart(2, "0")}`;
  }

  function dateFromIso(iso) {
    const [year, month, day] = iso.split("-").map(Number);
    return new Date(Date.UTC(year, month - 1, day));
  }

  function isValidIsoDate(iso) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(iso || ""))) return false;
    const parsed = dateFromIso(iso);
    return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === iso;
  }

  function dayDiff(startIso, endIso) {
    return Math.round((dateFromIso(endIso) - dateFromIso(startIso)) / MS_DAY);
  }

  function subtractCalendarYears(iso, years) {
    const end = dateFromIso(iso);
    const start = new Date(Date.UTC(end.getUTCFullYear() - years, end.getUTCMonth(), end.getUTCDate()));
    if (end.getUTCMonth() === 1 && end.getUTCDate() === 29) {
      start.setUTCDate(28);
    }
    return start.toISOString().slice(0, 10);
  }

  function getNextFridayIso(iso) {
    const d = dateFromIso(iso);
    const daysUntilFriday = (5 - d.getUTCDay() + 7) % 7;
    d.setUTCDate(d.getUTCDate() + daysUntilFriday);
    return d.toISOString().slice(0, 10);
  }

  function parsePreviewRows(text) {
    const rows = parseCsv(text);
    const header = rows.shift() || [];
    const dateIdx = header.indexOf("date");
    const btcIdx = header.indexOf("BTC");
    const xauIdx = header.indexOf("XAU");
    if (dateIdx < 0 || btcIdx < 0 || xauIdx < 0) {
      throw new Error("DCA comparison preview is missing required columns.");
    }
    const parsed = rows.map((row, index) => {
      const date = isoFromMaybeUsDate(row[dateIdx]);
      const btc = toNumber(row[btcIdx]);
      const xau = toNumber(row[xauIdx]);
      if (!isValidIsoDate(date) || !(btc > 0) || !(xau > 0)) {
        throw new Error(`DCA comparison preview row ${index + 1} is invalid.`);
      }
      return { date, BTC: btc, XAU: xau };
    });
    if (!parsed.length) throw new Error("DCA comparison preview is empty.");
    parsed.forEach((row, index) => {
      if (index === 0) return;
      if (dayDiff(parsed[index - 1].date, row.date) !== 1) {
        throw new Error(`DCA comparison preview row ${index + 1} is not the next UTC day.`);
      }
    });
    return parsed;
  }

  async function sha256Hex(text) {
    const bytes = new TextEncoder().encode(text);
    const digest = await crypto.subtle.digest("SHA-256", bytes);
    return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
  }

  function parsePublicationMarker(text) {
    let marker;
    try {
      marker = JSON.parse(text);
    } catch (error) {
      throw new Error(`DCA comparison publication marker is invalid JSON: ${error.message}`);
    }
    const artifact = marker?.artifact;
    if (
      marker?.schema_version !== 1 ||
      !artifact ||
      artifact.path !== PREVIEW_URL ||
      !/^[0-9a-f]{64}$/.test(String(artifact.sha256 || "")) ||
      !Number.isInteger(artifact.rows) || artifact.rows < 1 ||
      !isValidIsoDate(artifact.first_date) ||
      !isValidIsoDate(artifact.latest_date) ||
      artifact.first_date > artifact.latest_date
    ) {
      throw new Error("DCA comparison publication marker has invalid preview metadata.");
    }
    return marker;
  }

  function getThemeColors() {
    const style = getComputedStyle(document.documentElement);
    return {
      bg: style.getPropertyValue("--bg").trim() || "#000",
      savings: style.getPropertyValue("--savings").trim() || "#41b36b",
      assetA: style.getPropertyValue(ASSETS[DEFAULT_ASSET_A].cssVar).trim() || "#ff9900",
      assetB: style.getPropertyValue(ASSETS[DEFAULT_ASSET_B].cssVar).trim() || "#ffd000",
    };
  }

  function buildDefaultSeries() {
    if (!cachedRows.length) return [];
    const endIso = cachedRows[cachedRows.length - 1].date;
    const rawStartIso = subtractCalendarYears(endIso, DEFAULT_RANGE_YEARS);
    const startIso = getNextFridayIso(rawStartIso);
    let unitsA = 0;
    let unitsB = 0;
    let invested = 0;
    const points = [];

    for (const row of cachedRows) {
      if (row.date < startIso || row.date > endIso) continue;
      if (dayDiff(startIso, row.date) % 7 === 0) {
        invested += DEFAULT_AMOUNT;
        unitsA += DEFAULT_AMOUNT / row[DEFAULT_ASSET_A];
        unitsB += DEFAULT_AMOUNT / row[DEFAULT_ASSET_B];
      }
      if (invested > 0) {
        points.push({
          date: row.date,
          invested,
          valueA: unitsA * row[DEFAULT_ASSET_A],
          valueB: unitsB * row[DEFAULT_ASSET_B],
        });
      }
    }

    return points;
  }

  function renderFallback() {
    const canvas = document.getElementById("comparisonPreview");
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
    const width = Math.max(1, canvas.clientWidth || 1280);
    const height = Math.max(1, canvas.clientHeight || 720);
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = getThemeColors().bg;
    ctx.fillRect(0, 0, width, height);
  }

  function drawLine(ctx, points, key, mapX, mapY, color, width) {
    ctx.save();
    ctx.beginPath();
    points.forEach((point, idx) => {
      const x = mapX(idx);
      const y = mapY(point[key]);
      if (idx === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.stroke();
    ctx.restore();
  }

  function render() {
    const canvas = document.getElementById("comparisonPreview");
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const points = buildDefaultSeries();
    if (points.length < 2) {
      renderFallback();
      return;
    }

    const dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
    const width = Math.max(1, canvas.clientWidth || 1280);
    const height = Math.max(1, canvas.clientHeight || 720);
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const colors = getThemeColors();
    ctx.fillStyle = colors.bg;
    ctx.fillRect(0, 0, width, height);

    const padding = {
      top: Math.max(8, height * 0.035),
      right: Math.max(10, width * 0.025),
      bottom: Math.max(8, height * 0.035),
      left: Math.max(10, width * 0.025),
    };
    const chartW = Math.max(1, width - padding.left - padding.right);
    const chartH = Math.max(1, height - padding.top - padding.bottom);
    const values = points.flatMap((point) => [point.invested, point.valueA, point.valueB]);
    const minY = 0;
    const maxRaw = Math.max(...values, DEFAULT_AMOUNT * 2);
    const maxY = maxRaw * 1.04;
    const spanY = Math.max(1, maxY - minY);
    const mapX = (idx) => padding.left + (idx / Math.max(1, points.length - 1)) * chartW;
    const mapY = (value) => padding.top + ((maxY - value) / spanY) * chartH;

    const lineWidth = Math.max(2, Math.min(4.2, width / 340));
    drawLine(ctx, points, "invested", mapX, mapY, colors.savings, lineWidth);
    drawLine(ctx, points, "valueA", mapX, mapY, colors.assetA, lineWidth);
    drawLine(ctx, points, "valueB", mapX, mapY, colors.assetB, lineWidth);
  }

  async function prepareCandidate(context) {
    const marker = parsePublicationMarker(context.signatureParts[0]);
    const response = await context.fetchFresh(PREVIEW_URL);
    const csvText = await response.text();
    return {
      marker,
      rows: parsePreviewRows(csvText),
      sha256: await sha256Hex(csvText),
    };
  }

  function validateCandidate(candidate) {
    const artifact = candidate.marker.artifact;
    const firstDate = candidate.rows[0]?.date || "";
    const latestDate = candidate.rows[candidate.rows.length - 1]?.date || "";
    if (
      candidate.sha256 !== artifact.sha256 ||
      candidate.rows.length !== artifact.rows ||
      firstDate !== artifact.first_date ||
      latestDate !== artifact.latest_date
    ) {
      throw new Error("DCA comparison preview does not match its publication marker.");
    }
    if (installedBounds && latestDate < installedBounds.latestDate) {
      throw new Error("DCA comparison preview generation regressed.");
    }
    return true;
  }

  function commitCandidate(candidate, context) {
    cachedRows = candidate.rows;
    installedBounds = {
      firstDate: candidate.rows[0].date,
      latestDate: candidate.rows[candidate.rows.length - 1].date,
    };
    installedPublicationSignature = context.signature;
    return { present: true };
  }

  function requestPresent(reason) {
    if (refresher) refresher.requestPresent(reason);
  }

  function init() {
    const shared = window.WSBPreviewShared;
    if (!shared?.createDataRefresher) {
      renderFallback();
      shared?.markReady?.({ filename: "dca_comparison.png" });
      return;
    }
    shared.initThemeSync({ onThemeChanged: () => requestPresent("theme") });
    window.addEventListener("resize", () => requestPresent("resize"));
    refresher = shared.createDataRefresher({
      filename: "dca_comparison.png",
      urls: [PUBLICATION_URL],
      intervalMs: AUTO_REFRESH_MS,
      getInstalledSignature: () => installedPublicationSignature,
      prepare: prepareCandidate,
      validate: validateCandidate,
      commit: commitCandidate,
      present: render,
      onInitialError(error) {
        console.error("DCA comparison preview initial load failed:", error);
        renderFallback();
      },
      onError(error) {
        console.warn("DCA comparison preview refresh deferred:", error);
      },
    });
    refresher.start();
  }

  init();
}());
