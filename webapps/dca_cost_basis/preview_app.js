(function () {
  const AUTO_REFRESH_MS = 60000;
  const PREVIEW_URL = "webapp_data/daily_dca.csv";
  const PUBLICATION_URL = "webapp_data/dca_cost_basis_metadata.json";
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

    if (!rows.length) return [];
    const headers = rows[0].map((header) => String(header || "").trim());
    return rows.slice(1).map((rawRow) => {
      const obj = {};
      headers.forEach((header, index) => {
        obj[header] = rawRow[index] ?? "";
      });
      return obj;
    });
  }

  function toNumber(value) {
    const normalized = Number.parseFloat(String(value ?? "").replaceAll(",", "").trim());
    return Number.isFinite(normalized) ? normalized : NaN;
  }

  function isValidIsoDate(value) {
    const raw = String(value || "").trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return false;
    const parsed = new Date(`${raw}T00:00:00Z`);
    return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === raw;
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
      throw new Error(`DCA cost basis publication marker is invalid JSON: ${error.message}`);
    }
    const artifact = marker?.artifact;
    if (
      marker?.schema_version !== 1 ||
      !artifact || artifact.path !== PREVIEW_URL ||
      !/^[0-9a-f]{64}$/.test(String(artifact.sha256 || "")) ||
      !Number.isInteger(artifact.rows) || artifact.rows < 1 ||
      !isValidIsoDate(artifact.first_date) ||
      !isValidIsoDate(artifact.latest_date) ||
      artifact.first_date > artifact.latest_date
    ) {
      throw new Error("DCA cost basis publication marker has invalid daily preview metadata.");
    }
    return marker;
  }

  function parsePreviewRows(text) {
    const rawRows = parseCsv(text);
    if (!rawRows.length) throw new Error("DCA cost basis daily preview is empty.");
    const required = [
      "days_ago", "date_iso", "block_height", "historical_price", "dca_basis", "is_price_above",
    ];
    if (required.some((column) => !(column in rawRows[0]))) {
      throw new Error("DCA cost basis daily preview is missing required columns.");
    }
    const rows = rawRows.map((row, index) => {
      const daysAgo = Number(row.days_ago);
      const blockHeight = Number(row.block_height);
      const historicalPrice = toNumber(row.historical_price);
      const dcaBasis = toNumber(row.dca_basis);
      const isPriceAbove = Number(row.is_price_above);
      const date = String(row.date_iso || "").trim();
      if (
        !Number.isInteger(daysAgo) || daysAgo < 1 ||
        !Number.isInteger(blockHeight) || blockHeight < 0 ||
        !isValidIsoDate(date) ||
        !(historicalPrice > 0) || !(dcaBasis > 0) ||
        (isPriceAbove !== 0 && isPriceAbove !== 1)
      ) {
        throw new Error(`DCA cost basis daily preview row ${index + 1} is invalid.`);
      }
      return { daysAgo, date, blockHeight, historicalPrice, dcaBasis, isPriceAbove };
    });
    rows.forEach((row, index) => {
      if (index === 0) return;
      const previous = rows[index - 1];
      if (row.date <= previous.date || row.daysAgo !== previous.daysAgo - 1) {
        throw new Error(`DCA cost basis daily preview row ${index + 1} is out of order.`);
      }
      if (row.blockHeight < previous.blockHeight) {
        throw new Error(`DCA cost basis daily preview row ${index + 1} has a decreasing height.`);
      }
    });
    return rows;
  }

  function getThemeColors() {
    const style = getComputedStyle(document.documentElement);
    const isLight = document.documentElement.dataset.theme === "light";
    return {
      muted: style.getPropertyValue("--muted").trim() || (isLight ? "#6f685f" : "#95a6ae"),
      up: style.getPropertyValue("--price-up").trim() || "#41b36b",
      down: style.getPropertyValue("--price-down").trim() || "#d33a45",
      basis: style.getPropertyValue("--accent").trim() || "#ff9f1c",
      currentLine: isLight ? "rgba(0,0,0,0.55)" : "rgba(255,255,255,0.65)",
    };
  }

  function buildSvgLinePath(values, mapX, mapY) {
    if (!values.length) return "";
    let d = "";
    for (let i = 0; i < values.length; i += 1) {
      const x = mapX(i);
      const y = mapY(values[i]);
      d += i === 0 ? `M ${x.toFixed(2)} ${y.toFixed(2)}` : ` L ${x.toFixed(2)} ${y.toFixed(2)}`;
    }
    return d;
  }

  function buildSvgSegmentedPaths(values, mapX, mapY) {
    const paths = [];
    let current = "";

    for (let i = 0; i < values.length; i += 1) {
      const value = values[i];
      if (!Number.isFinite(value)) {
        if (current) {
          paths.push(current);
          current = "";
        }
        continue;
      }

      const x = mapX(i);
      const y = mapY(value);
      current += current
        ? ` L ${x.toFixed(2)} ${y.toFixed(2)}`
        : `M ${x.toFixed(2)} ${y.toFixed(2)}`;
    }

    if (current) paths.push(current);
    return paths;
  }

  function renderCardPreviewFromRows(rows) {
    const chart = document.getElementById("costBasisChart");
    if (!chart) return;

    const safeRows = (rows || []).filter((row) => (
      Number.isFinite(row.daysAgo) &&
      Number.isFinite(row.historicalPrice) &&
      Number.isFinite(row.dcaBasis) &&
      Number.isFinite(row.isPriceAbove)
    ));

    if (!safeRows.length) {
      chart.innerHTML = "";
      const fallback = document.createElement("div");
      fallback.textContent = "Preview unavailable";
      fallback.style.display = "grid";
      fallback.style.placeItems = "center";
      fallback.style.width = "100%";
      fallback.style.height = "100%";
      fallback.style.color = getThemeColors().muted;
      fallback.style.fontFamily = "IBM Plex Mono, monospace";
      fallback.style.fontSize = "12px";
      chart.appendChild(fallback);
      return;
    }

    const colors = getThemeColors();
    const width = Math.max(chart.clientWidth || 0, 420);
    const height = Math.max(chart.clientHeight || 0, 220);
    const padding = { top: 12, right: 18, bottom: 16, left: 18 };
    const plotWidth = Math.max(1, width - padding.left - padding.right);
    const plotHeight = Math.max(1, height - padding.top - padding.bottom);

    const priceValues = safeRows.map((r) => r.historicalPrice);
    const basisValues = safeRows.map((r) => r.dcaBasis);
    const priceUpValues = safeRows.map((r) => (r.isPriceAbove === 1 ? r.historicalPrice : NaN));
    const priceDownValues = safeRows.map((r) => (r.isPriceAbove === 0 ? r.historicalPrice : NaN));

    for (let i = 0; i < safeRows.length - 1; i += 1) {
      const curr = safeRows[i];
      const next = safeRows[i + 1];
      if (curr.isPriceAbove === next.isPriceAbove) continue;

      if (curr.isPriceAbove === 1) {
        priceUpValues[i + 1] = next.historicalPrice;
      } else {
        priceDownValues[i + 1] = next.historicalPrice;
      }
    }

    const minYRaw = Math.min(...priceValues, ...basisValues);
    const maxYRaw = Math.max(...priceValues, ...basisValues);
    const padY = (maxYRaw - minYRaw) * 0.1 || Math.max(1, maxYRaw * 0.08);
    const minY = Math.max(0, minYRaw - padY);
    const maxY = maxYRaw + padY;
    const spanY = Math.max(1e-9, maxY - minY);

    const mapX = (idx) => padding.left + (idx / Math.max(1, safeRows.length - 1)) * plotWidth;
    const mapY = (v) => padding.top + ((maxY - v) / spanY) * plotHeight;

    const basisPath = buildSvgLinePath(basisValues, mapX, mapY);
    const upPaths = buildSvgSegmentedPaths(priceUpValues, mapX, mapY);
    const downPaths = buildSvgSegmentedPaths(priceDownValues, mapX, mapY);
    const yCurrent = mapY(priceValues[priceValues.length - 1]);

    const upPathElements = upPaths.map((d) => (
      `<path d="${d}" fill="none" stroke="${colors.up}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />`
    )).join("");

    const downPathElements = downPaths.map((d) => (
      `<path d="${d}" fill="none" stroke="${colors.down}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />`
    )).join("");

    chart.innerHTML = `
<svg viewBox="0 0 ${width} ${height}" width="100%" height="100%" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="DCA Cost Basis preview chart">
  <line x1="${padding.left}" y1="${yCurrent.toFixed(2)}" x2="${(padding.left + plotWidth).toFixed(2)}" y2="${yCurrent.toFixed(2)}" stroke="${colors.currentLine}" stroke-width="1.2" stroke-dasharray="5 4" />
  ${downPathElements}
  ${upPathElements}
  <path d="${basisPath}" fill="none" stroke="${colors.basis}" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" />
</svg>`;
  }

  function render() {
    if (!cachedRows.length) return;
    renderCardPreviewFromRows(cachedRows);
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
      throw new Error("DCA cost basis daily preview does not match its publication marker.");
    }
    const latestHeight = candidate.rows[candidate.rows.length - 1]?.blockHeight ?? -1;
    if (
      installedBounds &&
      (latestDate < installedBounds.latestDate || latestHeight < installedBounds.latestHeight)
    ) {
      throw new Error("DCA cost basis preview generation regressed.");
    }
    return true;
  }

  function commitCandidate(candidate, context) {
    cachedRows = candidate.rows;
    installedBounds = {
      firstDate: candidate.rows[0].date,
      latestDate: candidate.rows[candidate.rows.length - 1].date,
      latestHeight: candidate.rows[candidate.rows.length - 1].blockHeight,
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
      renderCardPreviewFromRows([]);
      shared?.markReady?.({ filename: "dca_cost_basis.png" });
      return;
    }
    shared.initThemeSync({ onThemeChanged: () => requestPresent("theme") });
    window.addEventListener("resize", () => requestPresent("resize"));
    refresher = shared.createDataRefresher({
      filename: "dca_cost_basis.png",
      urls: [PUBLICATION_URL],
      intervalMs: AUTO_REFRESH_MS,
      getInstalledSignature: () => installedPublicationSignature,
      prepare: prepareCandidate,
      validate: validateCandidate,
      commit: commitCandidate,
      present: render,
      onInitialError(error) {
        console.error("DCA cost basis preview initial load failed:", error);
        renderCardPreviewFromRows([]);
      },
      onError(error) {
        console.warn("DCA cost basis preview refresh deferred:", error);
      },
    });
    refresher.start();
  }

  init();
}());
