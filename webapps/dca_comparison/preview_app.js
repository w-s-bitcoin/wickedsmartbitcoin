(function () {
  const AUTO_REFRESH_MS = 60000;
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
  };

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

  async function load() {
    const [btcText, fxText, indicesText] = await Promise.all([
      fetch("../../assets/daily_price.csv", { cache: "default" }).then((resp) => resp.text()),
      fetch("../uoa/webapp_data/daily_fx_rates.csv", { cache: "default" }).then((resp) => resp.text()),
      fetch("webapp_data/market_indices.csv", { cache: "default" }).then((resp) => (resp.ok ? resp.text() : "")).catch(() => ""),
    ]);

    const btcRows = parseCsv(btcText);
    const btcHeader = btcRows.shift() || [];
    const fxRows = parseCsv(fxText);
    const fxHeader = fxRows.shift() || [];
    const indexRows = indicesText ? parseCsv(indicesText) : [];
    const indexHeader = indexRows.length ? indexRows.shift() || [] : [];
    const btcDateIdx = btcHeader.indexOf("date");
    const btcPriceIdx = btcHeader.indexOf("price");
    const fxDateIdx = fxHeader.indexOf("date");
    const xauIdx = fxHeader.indexOf("xauusd");
    const xagIdx = fxHeader.indexOf("xagusd");
    const indexDateIdx = indexHeader.indexOf("date");
    const spyIdx = indexHeader.indexOf("spy");
    const qqqIdx = indexHeader.indexOf("qqq");
    const tltIdx = indexHeader.indexOf("tlt");
    const byDate = new Map();

    for (const row of btcRows) {
      const iso = isoFromMaybeUsDate(row[btcDateIdx]);
      const price = toNumber(row[btcPriceIdx]);
      if (iso && Number.isFinite(price) && price > 0) byDate.set(iso, { date: iso, BTC: price });
    }

    for (const row of fxRows) {
      const iso = isoFromMaybeUsDate(row[fxDateIdx]);
      const target = byDate.get(iso);
      if (!target) continue;
      const xau = toNumber(row[xauIdx]);
      const xag = toNumber(row[xagIdx]);
      if (Number.isFinite(xau) && xau > 0) target.XAU = xau;
      if (Number.isFinite(xag) && xag > 0) target.XAG = xag;
    }

    for (const row of indexRows) {
      const iso = isoFromMaybeUsDate(row[indexDateIdx]);
      const target = byDate.get(iso);
      if (!target) continue;
      const spy = toNumber(row[spyIdx]);
      const qqq = toNumber(row[qqqIdx]);
      const tlt = toNumber(row[tltIdx]);
      if (Number.isFinite(spy) && spy > 0) target.SPY = spy;
      if (Number.isFinite(qqq) && qqq > 0) target.QQQ = qqq;
      if (Number.isFinite(tlt) && tlt > 0) target.TLT = tlt;
    }

    cachedRows = [...byDate.values()]
      .filter((row) => Number.isFinite(row.BTC) && Number.isFinite(row.XAU))
      .sort((a, b) => a.date.localeCompare(b.date));
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
    renderFallback();
  });
}());
