(function () {
  "use strict";
  const M = window.WSBMovingAverageModel, G = window.WSBMovingAverageCharts;
  const lines = [{ period: 200, unit: "day", type: "sma" }, { period: 200, unit: "week", type: "sma" }];
  let installed = null, displayModel = null, series = [], refresher = null;
  const spotFeed = window.WSBBitcoinSpotPrice?.create({
    onQuote: () => refresher?.requestPresent("spot-quote"),
  });
  function render() {
    if (!installed) return;
    const quote = spotFeed?.newerThan(installed.publishedAt);
    const applied = displayModel?.liveQuote;
    const alreadyApplied = quote && applied?.at === quote.at && applied.price === quote.price
      && applied.receivedAt === quote.receivedAt && applied.source === quote.source;
    const nextModel = alreadyApplied ? displayModel : M.withLiveQuote(installed.model, quote, { publishedAt: installed.publishedAt });
    if (nextModel !== displayModel) {
      const nextSeries = lines.map((line) => M.calculateCurrent(nextModel, line));
      displayModel = nextModel; series = nextSeries;
    }
    const canvas = document.getElementById("movingAveragePreview"), { ctx, width, height } = G.setup(canvas);
    canvas.dataset.priceSource = displayModel.liveQuote ? (spotFeed?.isLive?.(displayModel.liveQuote) ? "live" : "retained") : "published";
    canvas.dataset.endDate = displayModel.rows.at(-1).date;
    G.composite(ctx, width, height, { model: displayModel, series, lines, endIndex: displayModel.rows.length - 1,
      // The sparse 200-day trace needs more stroke weight to visually match the
      // overlapping daily segments in the full-history and 200-week thumbnails.
      priceLineWidths: [1.3, 2.2, 1.3],
      previewInsets: window.WSBPreviewShared.chartInsets(width, height),
      scales: ["log", "linear", "linear"], theme: document.documentElement.dataset.theme, compact: true });
  }
  window.WSBPreviewShared?.initThemeSync({ onThemeChanged: () => refresher?.requestPresent("theme") });
  refresher = window.WSBPreviewShared.createDataRefresher({ filename: "moving_average.png", urls: [M.MARKER_URL],
    getInstalledSignature: () => installed?.signature || "", prepare: M.prepareCandidate,
    validate: (candidate) => M.validateCandidate(candidate, installed),
    commit: (candidate) => {
      // Calculate while detached so a malformed candidate cannot partially replace a card.
      const nextSeries = lines.map((line) => M.calculateCurrent(candidate.model, line));
      installed = candidate; displayModel = candidate.model; series = nextSeries; return { present: true };
    }, present: render,
    onError: (error) => console.warn("Moving Average preview retained its last complete generation.", error),
  });
  window.addEventListener("resize", () => refresher.requestPresent("resize"));
  refresher.start();
  spotFeed?.start();
  window.addEventListener("pagehide", () => spotFeed?.stop());
  window.addEventListener("pageshow", () => spotFeed?.start());
}());
