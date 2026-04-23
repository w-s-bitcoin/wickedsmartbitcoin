(function () {
  const AUTO_REFRESH_MS = 60000;
  let cachedRows = [];

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

  function getThemeColors() {
    const style = getComputedStyle(document.documentElement);
    const isLight = document.documentElement.dataset.theme === "light";
    return {
      muted: style.getPropertyValue("--muted").trim() || (isLight ? "#6f685f" : "#95a6ae"),
      grid: isLight ? "rgba(0,0,0,0.10)" : "rgba(255,255,255,0.14)",
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

    const gridLines = [0.25, 0.5, 0.75].map((t) => {
      const y = padding.top + (plotHeight * t);
      return `<line x1="${padding.left}" y1="${y.toFixed(2)}" x2="${(padding.left + plotWidth).toFixed(2)}" y2="${y.toFixed(2)}" stroke="${colors.grid}" stroke-width="1" />`;
    }).join("");

    const upPathElements = upPaths.map((d) => (
      `<path d="${d}" fill="none" stroke="${colors.up}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />`
    )).join("");

    const downPathElements = downPaths.map((d) => (
      `<path d="${d}" fill="none" stroke="${colors.down}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />`
    )).join("");

    chart.innerHTML = `
<svg viewBox="0 0 ${width} ${height}" width="100%" height="100%" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="DCA Cost Basis preview chart">
  ${gridLines}
  <line x1="${padding.left}" y1="${yCurrent.toFixed(2)}" x2="${(padding.left + plotWidth).toFixed(2)}" y2="${yCurrent.toFixed(2)}" stroke="${colors.currentLine}" stroke-width="1.2" stroke-dasharray="5 4" />
  ${downPathElements}
  ${upPathElements}
  <path d="${basisPath}" fill="none" stroke="${colors.basis}" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" />
</svg>`;
  }

  function render() {
    renderCardPreviewFromRows(cachedRows);
  }

  async function load() {
    const resp = await fetch("webapp_data/daily_dca.csv", { cache: "no-store" });
    if (!resp.ok) throw new Error(`Failed to load daily_dca.csv (${resp.status}).`);

    cachedRows = parseCsv(await resp.text())
      .map((row) => ({
        daysAgo: Number.parseInt(row.days_ago || "0", 10),
        historicalPrice: toNumber(row.historical_price),
        dcaBasis: toNumber(row.dca_basis),
        isPriceAbove: toNumber(row.is_price_above),
      }))
      .filter((row) => (
        Number.isFinite(row.daysAgo) &&
        Number.isFinite(row.historicalPrice) &&
        Number.isFinite(row.dcaBasis) &&
        Number.isFinite(row.isPriceAbove)
      ))
      .sort((a, b) => b.daysAgo - a.daysAgo);
  }

  async function init() {
    window.WSBPreviewShared?.initThemeSync({ onThemeChanged: render });
    await load();
    render();
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
    renderCardPreviewFromRows([]);
  });
}());
