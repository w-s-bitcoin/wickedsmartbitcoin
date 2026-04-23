(function () {
  const AUTO_REFRESH_MS = 60000;
  const GRID_LAYOUT = Object.freeze({
    cols: 63,
    cellSizePx: 19,
    gapPx: 1,
  });

  const state = {
    metadata: null,
    periods: [],
    bip110Blocks: [],
  };

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

    if (value.length > 0 || row.length > 0) {
      row.push(value);
      rows.push(row);
    }

    if (!rows.length) return [];
    const headers = rows[0];
    return rows.slice(1).map((cells) => {
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

  function decodeBlockPoints(buffer, startHeight, periodSize) {
    const view = new DataView(buffer);
    const recordSize = 5;
    const count = Math.floor(view.byteLength / recordSize);
    const rows = new Array(count);

    for (let index = 0; index < count; index += 1) {
      const offset = index * recordSize;
      const height = view.getUint32(offset, true);
      const isSignaling = view.getUint8(offset + 4);
      const relativeHeight = height - startHeight;
      const period = Math.floor(relativeHeight / periodSize) + 1;

      rows[index] = {
        height,
        is_signaling: isSignaling,
        period,
      };
    }

    return rows;
  }

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function getCurrentPeriodNumber() {
    const currentPeriod = Number(state.metadata?.state?.current_period_index);
    return Number.isFinite(currentPeriod) ? currentPeriod : null;
  }

  function getCurrentPeriodRow() {
    const currentPeriod = getCurrentPeriodNumber();
    if (!Number.isFinite(currentPeriod)) return null;
    return state.periods.find((row) => Number(row.period) === currentPeriod) || null;
  }

  function buildCurrentPeriodCells() {
    const periodSize = Number(state.metadata?.chart?.period_size || 2016);
    const row = getCurrentPeriodRow();
    if (!row) return [];

    const currentPeriod = Number(row.period);
    const startHeight = Number(row.period_start_height);
    if (!Number.isFinite(startHeight)) return [];

    const currentPeriodBlocks = state.bip110Blocks.filter((block) => Number(block.period) === currentPeriod);
    const blockByHeight = new Map();
    currentPeriodBlocks.forEach((block) => {
      blockByHeight.set(Number(block.height), block);
    });
    const mined = clamp(currentPeriodBlocks.length, 0, periodSize);

    const cells = [];
    for (let offset = 0; offset < periodSize; offset += 1) {
      const height = startHeight + offset;
      const block = blockByHeight.get(height) || null;
      if (block) {
        cells.push(Number(block.is_signaling) === 1 ? "is-signaling" : "is-nonsignaling");
        continue;
      }
      cells.push(offset < mined ? "is-nonsignaling" : "");
    }
    return cells;
  }

  function render() {
    const grid = document.getElementById("previewGrid");
    if (!grid) return;

    grid.style.setProperty("--grid-cols", String(GRID_LAYOUT.cols));
    grid.style.setProperty("--grid-cell-size", `${GRID_LAYOUT.cellSizePx}px`);
    grid.style.setProperty("--grid-gap", `${GRID_LAYOUT.gapPx}px`);

    const cells = buildCurrentPeriodCells();
    grid.innerHTML = "";

    const fragment = document.createDocumentFragment();
    cells.forEach((className) => {
      const cell = document.createElement("div");
      cell.className = `preview-cell${className ? ` ${className}` : ""}`;
      fragment.appendChild(cell);
    });
    grid.appendChild(fragment);
  }

  async function load() {
    const [metadataResp, periodsResp, blockPointsResp] = await Promise.all([
      fetch("webapp_data/bip110_metadata.json", { cache: "no-store" }),
      fetch("webapp_data/bip110_periods.csv", { cache: "no-store" }),
      fetch("webapp_data/bip110_block_points.bin", { cache: "no-store" }),
    ]);

    if (!metadataResp.ok) throw new Error(`Failed to load webapp_data/bip110_metadata.json (${metadataResp.status})`);
    if (!periodsResp.ok) throw new Error(`Failed to load webapp_data/bip110_periods.csv (${periodsResp.status})`);
    if (!blockPointsResp.ok) throw new Error(`Failed to load webapp_data/bip110_block_points.bin (${blockPointsResp.status})`);

    const metadataRoot = await metadataResp.json();
    state.metadata = metadataRoot;
    state.periods = castRows(parseCsv(await periodsResp.text()));

    const datasetMeta = state.metadata?.datasets?.bip110_blocks || {};
    const startHeight = Number(datasetMeta.start_height || 0);
    const periodSize = Number(datasetMeta.period_size || state.metadata?.chart?.period_size || 2016);
    state.bip110Blocks = decodeBlockPoints(await blockPointsResp.arrayBuffer(), startHeight, periodSize);
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
  });
}());