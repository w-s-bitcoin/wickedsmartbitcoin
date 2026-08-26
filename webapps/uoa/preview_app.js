(function () {
  const AUTO_REFRESH_MS = 60000;
  const DATA_URL = "../../assets/daily_price.csv";
  const MARKER_URL = "../../assets/daily_price_metadata.json";
  const MARKER_ARTIFACT_PATH = "assets/daily_price.csv";
  const DEFAULT_START_DATE_UTC = new Date("2011-02-09T00:00:00Z");
  const PRIMARY_COLOR_LIGHT = "#ff9900";
  const PRIMARY_COLOR_DARK = "#ffae00";
  const SECONDARY_COLOR_LIGHT = "#39d7a4";
  const SECONDARY_COLOR_DARK = "#34d399";
  const MS_DAY = 86400000;

  let cachedRows = [];
  let installedPublicationSignature = "";
  let installedBounds = null;
  let refresher = null;

  function parseCsv(text) {
    const records = [];
    let record = [];
    let value = "";
    let inQuotes = false;
    for (let index = 0; index < text.length; index += 1) {
      const char = text[index];
      if (char === '"') {
        if (inQuotes && text[index + 1] === '"') {
          value += '"';
          index += 1;
        } else {
          inQuotes = !inQuotes;
        }
      } else if (char === "," && !inQuotes) {
        record.push(value);
        value = "";
      } else if ((char === "\n" || char === "\r") && !inQuotes) {
        if (char === "\r" && text[index + 1] === "\n") index += 1;
        record.push(value);
        if (record.some((cell) => String(cell).length)) records.push(record);
        record = [];
        value = "";
      } else {
        value += char;
      }
    }
    if (value.length || record.length) {
      record.push(value);
      if (record.some((cell) => String(cell).length)) records.push(record);
    }
    const header = records.shift()?.map((cell) => String(cell).trim()) || [];
    return {
      header,
      rows: records.map((cells) => Object.fromEntries(header.map((name, index) => [name, cells[index] ?? ""]))),
    };
  }

  function parseCalendarDate(value) {
    const raw = String(value || "").trim();
    let year;
    let month;
    let day;
    let match = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (match) {
      year = Number(match[1]);
      month = Number(match[2]);
      day = Number(match[3]);
    } else {
      match = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/);
      if (!match) return null;
      month = Number(match[1]);
      day = Number(match[2]);
      year = Number(match[3].length === 2 ? `20${match[3]}` : match[3]);
    }
    const parsed = new Date(Date.UTC(year, month - 1, day));
    if (
      !Number.isFinite(parsed.getTime()) ||
      parsed.getUTCFullYear() !== year ||
      parsed.getUTCMonth() !== month - 1 ||
      parsed.getUTCDate() !== day
    ) return null;
    return parsed;
  }

  function parseTimestampUtc(value) {
    const raw = String(value || "").trim();
    const match = raw.match(
      /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?)(Z|[+-]\d{2}:?\d{2})?$/
    );
    if (!match) return null;
    let zone = match[3] || "Z";
    if (/^[+-]\d{4}$/.test(zone)) zone = `${zone.slice(0, 3)}:${zone.slice(3)}`;
    const parsed = new Date(`${match[1]}T${match[2]}${zone}`);
    return Number.isFinite(parsed.getTime()) ? parsed : null;
  }

  function isValidIsoDate(value) {
    const parsed = parseCalendarDate(value);
    return parsed !== null && parsed.toISOString().slice(0, 10) === value;
  }

  async function sha256Hex(text) {
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
    return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
  }

  function parseMarker(text) {
    let marker;
    try {
      marker = JSON.parse(text);
    } catch (error) {
      throw new Error(`Unit of Account publication marker is invalid JSON: ${error.message}`);
    }
    const artifact = marker?.artifact;
    if (
      marker?.schema_version !== 1 ||
      !artifact || artifact.path !== MARKER_ARTIFACT_PATH ||
      !/^[0-9a-f]{64}$/.test(String(artifact.sha256 || "")) ||
      !Number.isInteger(artifact.rows) || artifact.rows < 1 ||
      !isValidIsoDate(marker.first_date) || !isValidIsoDate(marker.latest_date) ||
      !Number.isInteger(marker.latest_block_height) || marker.latest_block_height < 0 ||
      !parseTimestampUtc(marker.latest_timestamp)
    ) {
      throw new Error("Unit of Account publication marker has invalid daily-price metadata.");
    }
    return marker;
  }

  function parseDailyPriceRows(text) {
    const { header, rows } = parseCsv(text);
    const required = ["date", "timestamp", "block_height", "price", "daily_high"];
    if (required.some((column) => !header.includes(column)) || !rows.length) {
      throw new Error("Unit of Account daily-price data is empty or missing required columns.");
    }
    let previousDay = null;
    let previousHeight = -1;
    return rows.map((row, index) => {
      const calendarDay = parseCalendarDate(row.date);
      const timestamp = parseTimestampUtc(row.timestamp);
      const height = Number(row.block_height);
      const price = Number(row.price);
      const dailyHigh = Number(row.daily_high);
      if (
        !calendarDay || !timestamp ||
        calendarDay.toISOString().slice(0, 10) !== timestamp.toISOString().slice(0, 10) ||
        !Number.isInteger(height) || height < 0 ||
        !Number.isFinite(price) || price < 0 ||
        !Number.isFinite(dailyHigh) || dailyHigh < 0
      ) {
        throw new Error(`Unit of Account daily-price row ${index + 1} is invalid.`);
      }
      if (
        previousDay &&
        (calendarDay.getTime() - previousDay.getTime() !== MS_DAY || height < previousHeight)
      ) {
        throw new Error(`Unit of Account daily-price row ${index + 1} is out of order.`);
      }
      previousDay = calendarDay;
      previousHeight = height;
      return { date: calendarDay, timestamp, height, price, dailyHigh, rawTimestamp: String(row.timestamp).trim() };
    });
  }

  function drawChart(canvas, values, color) {
    const dpr = Math.max(1, window.devicePixelRatio || 1);
    const rect = canvas.getBoundingClientRect();
    const width = Math.max(200, Math.round(rect.width));
    const height = Math.max(150, Math.round(rect.height));
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    const ctx = canvas.getContext("2d");
    if (!ctx || !values.length) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);

    const minLog = Math.log10(Math.max(Math.min(...values), 1e-300));
    const maxLog = Math.log10(Math.max(Math.max(...values), 1e-300));
    const padX = 12;
    const padY = 12;
    const chartWidth = width - padX * 2;
    const chartHeight = height - padY * 2;
    const xFor = (index) => padX + (index / Math.max(1, values.length - 1)) * chartWidth;
    const yFor = (value) => padY + (
      (maxLog - Math.log10(Math.max(value, 1e-300))) / Math.max(1e-9, maxLog - minLog)
    ) * chartHeight;

    const isSecondary = [SECONDARY_COLOR_LIGHT, SECONDARY_COLOR_DARK]
      .includes(String(color || "").toLowerCase());
    const gradient = ctx.createLinearGradient(0, padY, 0, height);
    gradient.addColorStop(0, `rgba(${isSecondary ? "52, 211, 153" : "255, 174, 0"}, 0.15)`);
    gradient.addColorStop(1, `rgba(${isSecondary ? "52, 211, 153" : "255, 174, 0"}, 0)`);
    ctx.fillStyle = gradient;
    ctx.beginPath();
    values.forEach((value, index) => {
      if (index === 0) ctx.moveTo(xFor(index), yFor(value));
      else ctx.lineTo(xFor(index), yFor(value));
    });
    ctx.lineTo(width - padX, height - padY);
    ctx.lineTo(padX, height - padY);
    ctx.closePath();
    ctx.fill();

    ctx.strokeStyle = color;
    ctx.lineWidth = 2.5;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.beginPath();
    values.forEach((value, index) => {
      if (index === 0) ctx.moveTo(xFor(index), yFor(value));
      else ctx.lineTo(xFor(index), yFor(value));
    });
    ctx.stroke();
  }

  function render() {
    if (!cachedRows.length) return;
    const isLight = document.documentElement.dataset.theme === "light";
    drawChart(
      document.getElementById("leftChart"),
      cachedRows.map((row) => 100000000 / row.price),
      isLight ? PRIMARY_COLOR_LIGHT : PRIMARY_COLOR_DARK
    );
    drawChart(
      document.getElementById("rightChart"),
      cachedRows.map((row) => row.price),
      isLight ? SECONDARY_COLOR_LIGHT : SECONDARY_COLOR_DARK
    );
  }

  function renderInitialFallback() {
    const color = getComputedStyle(document.documentElement).getPropertyValue("--bg").trim() || "#000";
    ["leftChart", "rightChart"].forEach((id) => {
      const canvas = document.getElementById(id);
      if (!canvas) return;
      const ctx = canvas.getContext("2d");
      const rect = canvas.getBoundingClientRect();
      const dpr = Math.max(1, window.devicePixelRatio || 1);
      const width = Math.max(200, Math.round(rect.width));
      const height = Math.max(150, Math.round(rect.height));
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.fillStyle = color;
      ctx.fillRect(0, 0, width, height);
    });
  }

  async function prepareCandidate(context) {
    const marker = parseMarker(context.signatureParts[0]);
    const response = await context.fetchFresh(DATA_URL);
    const csvText = await response.text();
    const sourceRows = parseDailyPriceRows(csvText);
    return {
      marker,
      sourceRows,
      sha256: await sha256Hex(csvText),
      displayRows: sourceRows.filter((row) => row.price > 0 && row.date >= DEFAULT_START_DATE_UTC),
    };
  }

  function validateCandidate(candidate) {
    const { marker, sourceRows } = candidate;
    const first = sourceRows[0];
    const latest = sourceRows[sourceRows.length - 1];
    if (
      candidate.sha256 !== marker.artifact.sha256 ||
      sourceRows.length !== marker.artifact.rows ||
      first.date.toISOString().slice(0, 10) !== marker.first_date ||
      latest.date.toISOString().slice(0, 10) !== marker.latest_date ||
      latest.rawTimestamp !== marker.latest_timestamp ||
      latest.height !== marker.latest_block_height ||
      !candidate.displayRows.length
    ) {
      throw new Error("Unit of Account daily-price data does not match its publication marker.");
    }
    if (installedBounds && latest.height < installedBounds.latestHeight) {
      throw new Error("Unit of Account daily-price generation regressed.");
    }
    return true;
  }

  function commitCandidate(candidate, context) {
    cachedRows = candidate.displayRows;
    const latest = candidate.sourceRows[candidate.sourceRows.length - 1];
    installedBounds = { latestDate: latest.date, latestHeight: latest.height };
    installedPublicationSignature = context.signature;
    return { present: true };
  }

  function requestPresent(reason) {
    if (refresher) refresher.requestPresent(reason);
  }

  function init() {
    const shared = window.WSBPreviewShared;
    if (!shared?.createDataRefresher) {
      renderInitialFallback();
      shared?.markReady?.({ filename: "uoa.png" });
      return;
    }
    shared.initThemeSync({ onThemeChanged: () => requestPresent("theme") });
    window.addEventListener("resize", () => requestPresent("resize"));
    refresher = shared.createDataRefresher({
      filename: "uoa.png",
      urls: [MARKER_URL],
      intervalMs: AUTO_REFRESH_MS,
      getInstalledSignature: () => installedPublicationSignature,
      prepare: prepareCandidate,
      validate: validateCandidate,
      commit: commitCandidate,
      present: render,
      onInitialError(error) {
        console.error("Unit of Account preview initial load failed:", error);
        renderInitialFallback();
      },
      onError(error) {
        console.warn("Unit of Account preview refresh deferred:", error);
      },
    });
    refresher.start();
  }

  init();
}());
