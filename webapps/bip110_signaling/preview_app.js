(function () {
  const AUTO_REFRESH_MS = 60000;
  const SVG_NS = "http://www.w3.org/2000/svg";
  const LATEST_LOCK_IN_PERIOD = 19;
  const CHART = Object.freeze({
    width: 1280,
    height: 720,
    padX: 36,
    padY: 40,
    maxBarWidth: 46,
    minimumSignalHeight: 5.5,
  });

  const state = {
    installedSignature: null,
    metadata: null,
    periods: [],
  };
  let dataRefresher = null;

  function parseCsv(text) {
    const rows = [];
    let row = [];
    let value = "";
    let inQuotes = false;

    for (let index = 0; index < text.length; index += 1) {
      const current = text[index];
      const next = text[index + 1];

      if (current === '"') {
        if (inQuotes && next === '"') {
          value += '"';
          index += 1;
        } else {
          inQuotes = !inQuotes;
        }
        continue;
      }

      if (current === "," && !inQuotes) {
        row.push(value);
        value = "";
        continue;
      }

      if ((current === "\n" || current === "\r") && !inQuotes) {
        if (current === "\r" && next === "\n") index += 1;
        row.push(value);
        value = "";
        if (row.length > 1 || row[0] !== "") rows.push(row);
        row = [];
        continue;
      }

      value += current;
    }

    if (inQuotes) throw new Error("BIP-110 period CSV contains an unterminated quoted field.");
    if (value.length > 0 || row.length > 0) {
      row.push(value);
      rows.push(row);
    }

    if (!rows.length) return [];
    const headers = rows[0].map((header) => String(header || "").trim());
    return rows.slice(1).map((cells) => {
      if (cells.length !== headers.length) {
        throw new Error("BIP-110 period CSV contains an incomplete row.");
      }
      const parsed = {};
      headers.forEach((header, index) => {
        parsed[header] = (cells[index] ?? "").trim();
      });
      return parsed;
    });
  }

  function parseMaybeNumber(value) {
    if (value === "" || value == null) return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : value;
  }

  function castRows(rows) {
    return rows.map((row) => {
      const casted = {};
      Object.entries(row).forEach(([key, value]) => {
        casted[key] = parseMaybeNumber(value);
      });
      return casted;
    });
  }

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  async function sha256Text(text) {
    if (!window.crypto?.subtle || typeof TextEncoder !== "function") {
      throw new Error("SHA-256 validation is unavailable in this browser.");
    }
    const digest = await window.crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
    return Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, "0")).join("");
  }

  function getPeriodSize() {
    const periodSize = Number(
      state.metadata?.chart?.period_size
      || state.metadata?.datasets?.bip110_blocks?.period_size
      || 2016
    );
    return Number.isFinite(periodSize) && periodSize > 0 ? periodSize : 2016;
  }

  function getMainChainPeriod() {
    const inProgress = state.periods.find((row) => String(row.status || "") === "in_progress");
    const inProgressPeriod = Number(inProgress?.period);
    if (Number.isFinite(inProgressPeriod)) return inProgressPeriod;

    const periodSize = getPeriodSize();
    const firstPeriod = state.periods.find((row) => Number(row.period) === 1);
    const firstHeight = Number(firstPeriod?.period_start_height);
    const sourceHeight = Number(state.metadata?.source_block_height);
    if (Number.isFinite(firstHeight) && Number.isFinite(sourceHeight) && sourceHeight >= firstHeight) {
      return Math.floor((sourceHeight - firstHeight) / periodSize) + 1;
    }

    const metadataPeriod = Number(state.metadata?.state?.current_period_index);
    if (Number.isFinite(metadataPeriod)) return metadataPeriod;

    const completedPeriods = Number(state.metadata?.state?.completed_periods);
    return Number.isFinite(completedPeriods) ? completedPeriods : null;
  }

  function getVisiblePeriods() {
    const currentMainPeriod = getMainChainPeriod();
    if (!Number.isFinite(currentMainPeriod)) return [];
    const lastVisiblePeriod = Math.min(LATEST_LOCK_IN_PERIOD, currentMainPeriod);
    return state.periods
      .filter((row) => {
        const period = Number(row.period);
        return Number.isFinite(period) && period >= 1 && period <= lastVisiblePeriod;
      })
      .sort((left, right) => Number(left.period) - Number(right.period));
  }

  function createSvgElement(tagName, attributes = {}) {
    const element = document.createElementNS(SVG_NS, tagName);
    Object.entries(attributes).forEach(([name, value]) => {
      element.setAttribute(name, String(value));
    });
    return element;
  }

  function minedBlocksForPeriod(row, currentMainPeriod, periodSize) {
    const period = Number(row.period);
    const status = String(row.status || "");
    if (status === "completed" || period < currentMainPeriod) return periodSize;

    const elapsed = Number(row.elapsed_blocks);
    if (Number.isFinite(elapsed)) return clamp(elapsed, 0, periodSize);

    const startHeight = Number(row.period_start_height);
    const sourceHeight = Number(state.metadata?.source_block_height);
    if (period === currentMainPeriod && Number.isFinite(startHeight) && Number.isFinite(sourceHeight)) {
      return clamp(sourceHeight - startHeight + 1, 0, periodSize);
    }
    return 0;
  }

  function render() {
    const chart = document.getElementById("previewChart");
    if (!chart) return false;
    chart.replaceChildren();

    const rows = getVisiblePeriods();
    if (!rows.length) {
      chart.dataset.previewState = "fallback";
      const fallback = createSvgElement("text", {
        x: CHART.width / 2,
        y: CHART.height / 2,
        fill: "var(--nonsignal)",
        "font-family": "IBM Plex Mono, monospace",
        "font-size": 26,
        "text-anchor": "middle",
      });
      fallback.textContent = "Preview unavailable";
      chart.appendChild(fallback);
      return true;
    }

    const periodSize = getPeriodSize();
    const currentMainPeriod = getMainChainPeriod();
    const plotWidth = CHART.width - (CHART.padX * 2);
    const plotHeight = CHART.height - (CHART.padY * 2);
    const step = plotWidth / rows.length;
    const barWidth = Math.min(CHART.maxBarWidth, step * 0.72);
    const baseline = CHART.height - CHART.padY;

    const fragment = document.createDocumentFragment();
    rows.forEach((row, index) => {
      const period = Number(row.period);
      const minedBlocks = minedBlocksForPeriod(row, currentMainPeriod, periodSize);
      const signalBlocks = clamp(Number(row.signal_blocks) || 0, 0, minedBlocks);
      const minedHeight = (minedBlocks / periodSize) * plotHeight;
      const actualSignalHeight = (signalBlocks / periodSize) * plotHeight;
      const signalHeight = signalBlocks > 0
        ? Math.min(minedHeight, Math.max(actualSignalHeight, CHART.minimumSignalHeight))
        : 0;
      const x = CHART.padX + (index * step) + ((step - barWidth) / 2);
      const group = createSvgElement("g", {
        "data-period": period,
        "data-mined-blocks": minedBlocks,
        "data-signal-blocks": signalBlocks,
      });
      const title = createSvgElement("title");
      title.textContent = `Period ${period}: ${signalBlocks.toLocaleString()} signaling blocks out of ${minedBlocks.toLocaleString()} mined`;
      group.appendChild(title);

      if (minedHeight > 0) {
        group.appendChild(createSvgElement("rect", {
          class: "period-nonsignal",
          x,
          y: baseline - minedHeight,
          width: barWidth,
          height: minedHeight,
        }));
      }
      if (signalHeight > 0) {
        group.appendChild(createSvgElement("rect", {
          class: "period-signal",
          x,
          y: baseline - signalHeight,
          width: barWidth,
          height: signalHeight,
        }));
      }
      fragment.appendChild(group);
    });
    chart.appendChild(fragment);
    chart.setAttribute(
      "aria-label",
      `Main-chain BIP-110 signaling periods 1 through ${Number(rows[rows.length - 1].period)}`
    );
    chart.dataset.previewState = "ready";
    return true;
  }

  async function prepareCandidate(context) {
    const markerText = String(context.signatureParts?.[0] || "").trim();
    const metadata = JSON.parse(markerText);
    const periodsResponse = await context.fetchFresh("webapp_data/bip110_periods.csv");
    const periodsText = await periodsResponse.text();
    return {
      metadata,
      periods: castRows(parseCsv(periodsText)),
      periodsHash: await sha256Text(periodsText),
    };
  }

  function validateCandidate(candidate) {
    const metadata = candidate?.metadata;
    const artifact = metadata?.datasets?.bip110_periods;
    const rows = candidate?.periods;
    const expectedHash = String(artifact?.sha256 || "").toLowerCase();
    const expectedHeaders = [
      "period",
      "period_start_height",
      "period_end_height",
      "status",
      "signal_blocks",
      "elapsed_blocks",
    ];
    if (!metadata || !Number.isInteger(Number(metadata.source_block_height))) return false;
    if (String(artifact?.path || "") !== "bip110_periods.csv") return false;
    if (!/^[a-f0-9]{64}$/.test(expectedHash) || candidate.periodsHash !== expectedHash) return false;
    if (!Array.isArray(rows) || rows.length !== Number(artifact.rows) || rows.length < 1) return false;
    if (Object.keys(rows[0] || {}).join("|") !== expectedHeaders.join("|")) return false;
    if (Number(rows[0]?.period) !== Number(artifact.first_period)) return false;
    if (Number(rows[rows.length - 1]?.period) !== Number(artifact.last_period)) return false;
    if (Number(rows[0]?.period_start_height) !== Number(artifact.start_height)) return false;
    if (Number(rows[rows.length - 1]?.period_end_height) !== Number(artifact.end_height)) return false;

    let previousEnd = null;
    for (let index = 0; index < rows.length; index += 1) {
      const row = rows[index];
      const period = Number(row.period);
      const start = Number(row.period_start_height);
      const end = Number(row.period_end_height);
      const signal = Number(row.signal_blocks);
      const elapsed = Number(row.elapsed_blocks);
      const status = String(row.status || "");
      const periodSize = end - start + 1;
      if (![period, start, end, signal, elapsed].every(Number.isInteger)) return false;
      if (period !== Number(artifact.first_period) + index || periodSize !== 2016) return false;
      if (previousEnd !== null && start !== previousEnd + 1) return false;
      if (elapsed < 0 || elapsed > periodSize || signal < 0 || signal > elapsed) return false;
      if (status !== (elapsed === periodSize ? "completed" : elapsed > 0 ? "in_progress" : "future")) {
        return false;
      }
      previousEnd = end;
    }

    const installedHeight = Number(state.metadata?.source_block_height);
    const candidateHeight = Number(metadata.source_block_height);
    if (Number.isFinite(installedHeight) && candidateHeight < installedHeight) return false;
    return true;
  }

  function initialize() {
    window.WSBPreviewShared?.initThemeSync({
      onThemeChanged: () => dataRefresher?.requestPresent("theme"),
    });
    dataRefresher = window.WSBPreviewShared?.createDataRefresher({
      filename: "bip110_signaling.png",
      urls: ["webapp_data/bip110_metadata.json"],
      intervalMs: AUTO_REFRESH_MS,
      getInstalledSignature: () => state.installedSignature,
      prepare: prepareCandidate,
      validate: (candidate) => {
        if (!validateCandidate(candidate)) {
          throw new Error("BIP-110 preview publication is incomplete or inconsistent.");
        }
        return true;
      },
      commit: (candidate, context) => {
        state.metadata = candidate.metadata;
        state.periods = candidate.periods;
        state.installedSignature = context.signature;
        return true;
      },
      present: render,
      onInitialError: (error) => {
        console.error(error);
        if (document.visibilityState === "visible") render();
      },
      onError: (error) => console.warn("BIP-110 preview refresh failed:", error),
    });
    window.addEventListener("resize", () => dataRefresher?.requestPresent("resize"));
    dataRefresher?.start();
  }

  try {
    initialize();
  } catch (error) {
    console.error(error);
    if (document.visibilityState === "visible") render();
    window.WSBPreviewShared?.markReady?.({ filename: "bip110_signaling.png" });
  }
}());
