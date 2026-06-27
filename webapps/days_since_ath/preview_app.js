(function () {
  const AUTO_REFRESH_MS = 60000;
  const PRICE_FALLBACK = 0.0001;
  let cachedRows = [];
  let hasLoadedPreviewData = false;

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
    const n = Number(String(value ?? "").replaceAll(",", "").trim());
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
        return {
          date,
          price: Number.isFinite(price) ? price : 0,
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

  async function load() {
    const resp = await fetch("../../assets/daily_price.csv", { cache: "no-store" });
    if (!resp.ok) throw new Error(`Failed to load daily_price.csv (${resp.status}).`);
    cachedRows = buildRows(parseCsv(await resp.text()));
    hasLoadedPreviewData = true;
  }

  async function init() {
    window.WSBPreviewShared?.initThemeSync({ onThemeChanged: render });
    await load();
    render();
    window.WSBPreviewShared?.markReady?.({ filename: "days_since_ath.png" });
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
    const canvas = document.getElementById("daysSinceAthPreview");
    if (canvas) {
      const { ctx, width, height } = setupCanvas(canvas);
      renderFallback(ctx, width, height);
    }
    window.WSBPreviewShared?.markReady?.({ filename: "days_since_ath.png" });
  });
}());
