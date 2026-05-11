(function () {
  const AUTO_REFRESH_MS = 60000;
  const DEFAULT_START_DATE_UTC = new Date("2011-02-09T00:00:00Z");
  const PRIMARY_COLOR_LIGHT = "#ff9900";
  const PRIMARY_COLOR_DARK = "#ffae00";
  const SECONDARY_COLOR_LIGHT = "#39d7a4";
  const SECONDARY_COLOR_DARK = "#34d399";

  function parseCsv(text) {
    const lines = String(text || "").trim().split(/\r?\n/);
    if (lines.length < 2) return [];
    const headers = lines[0].split(",");
    return lines.slice(1).map((line) => {
      const cols = line.split(",");
      const out = {};
      headers.forEach((h, i) => out[h.trim()] = (cols[i] || "").trim());
      return out;
    });
  }

  async function loadRows() {
    const res = await fetch("../../assets/daily_price.csv", { cache: "no-store" });
    if (!res.ok) return [];
    const rows = parseCsv(await res.text())
      .map((r) => ({
        date: new Date(r.date),
        price: Number(r.price),
      }))
      .filter((r) => !Number.isNaN(r.date.getTime()) && Number.isFinite(r.price) && r.price > 0)
      .filter((r) => r.date >= DEFAULT_START_DATE_UTC)
      .sort((a, b) => a.date - b.date);
    return rows;
  }

  function drawChart(canvas, values, color, isLight) {
    const dpr = Math.max(1, window.devicePixelRatio || 1);
    const rect = canvas.getBoundingClientRect();
    const w = Math.max(200, Math.round(rect.width));
    const h = Math.max(150, Math.round(rect.height));
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);

    const ctx = canvas.getContext("2d");
    if (!ctx || !values.length) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    // Keep canvas background transparent so it matches the page/panel background exactly.
    ctx.clearRect(0, 0, w, h);

    // Grid lines
    const gridColor = isLight ? "rgba(0, 0, 0, 0.08)" : "rgba(255, 255, 255, 0.08)";
    ctx.strokeStyle = gridColor;
    ctx.lineWidth = 1;
    ctx.globalAlpha = 0.3;

    // Vertical grid lines
    for (let i = 0; i <= 4; i++) {
      const x = (w * i) / 4;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, h);
      ctx.stroke();
    }

    // Horizontal grid lines
    for (let i = 0; i <= 3; i++) {
      const y = (h * i) / 3;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
      ctx.stroke();
    }

    ctx.globalAlpha = 1;

    // Calculate scales
    const min = Math.min(...values);
    const max = Math.max(...values);
    const minL = Math.log10(Math.max(min, 1e-300));
    const maxL = Math.log10(Math.max(max, 1e-300));
    const padX = 12;
    const padY = 12;
    const cw = w - padX * 2;
    const ch = h - padY * 2;

    const xFor = (i) => padX + (i / Math.max(1, values.length - 1)) * cw;
    const yFor = (v) => padY + ((maxL - Math.log10(Math.max(v, 1e-300))) / Math.max(1e-9, maxL - minL)) * ch;

    // Draw area gradient under line first.
    const gradient = ctx.createLinearGradient(0, padY, 0, h);
    const normalizedColor = String(color || "").toLowerCase();
    const isSecondaryColor = normalizedColor === SECONDARY_COLOR_LIGHT || normalizedColor === SECONDARY_COLOR_DARK;
    const colorRgb = isSecondaryColor ? "52, 211, 153" : "255, 174, 0";
    gradient.addColorStop(0, `rgba(${colorRgb}, 0.15)`);
    gradient.addColorStop(1, `rgba(${colorRgb}, 0)`);
    ctx.fillStyle = gradient;
    ctx.beginPath();
    values.forEach((v, i) => {
      const x = xFor(i);
      const y = yFor(v);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.lineTo(w - padX, h - padY);
    ctx.lineTo(padX, h - padY);
    ctx.closePath();
    ctx.fill();

    // Draw line on top so the stroke keeps full brightness.
    ctx.strokeStyle = color;
    ctx.lineWidth = 2.5;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.beginPath();
    values.forEach((v, i) => {
      const x = xFor(i);
      const y = yFor(v);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();
  }

  async function render() {
    const isLight = document.documentElement.dataset.theme === "light";
    const rows = await loadRows();
    if (!rows.length) return;

    const leftValues = rows.map((r) => 100000000 / r.price); // sats per dollar
    const rightValues = rows.map((r) => r.price); // price in dollars

    const primaryColor = isLight ? PRIMARY_COLOR_LIGHT : PRIMARY_COLOR_DARK;
    const secondaryColor = isLight ? SECONDARY_COLOR_LIGHT : SECONDARY_COLOR_DARK;
    drawChart(document.getElementById("leftChart"), leftValues, primaryColor, isLight);
    drawChart(document.getElementById("rightChart"), rightValues, secondaryColor, isLight);
  }

  async function init() {
    window.WSBPreviewShared?.initThemeSync({ onThemeChanged: render });
    await render();
    window.addEventListener("resize", render);
    window.WSBPreviewShared
      ?.createAutoRefresher({
        intervalMs: AUTO_REFRESH_MS,
        refresh: render,
      })
      .start();
  }

  init().catch((error) => {
    console.error("UoA preview init error:", error);
  });
}());
