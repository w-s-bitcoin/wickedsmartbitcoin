(function () {
  "use strict";
  const P = window.WSBPreviewShared, canvas = document.getElementById("previewCanvas");
  let installed = null, refresher;
  async function prepare(context) {
    const marker = await (await context.fetchFresh("webapp_data/manifest.json")).json();
    if (marker.schema_version !== 1 || !marker.previews || !Number.isInteger(marker.count) || marker.count < 1 ||
        !Number.isFinite(marker.last_timestamp) || !/^[a-f0-9]{64}$/.test(marker.signature)) throw new Error("Invalid card publication.");
    if (installed?.signature === marker.signature) return installed;
    const images = {};
    for (const theme of ["dark", "light"]) {
      const artifact = marker.previews[theme];
      if (!artifact || !new RegExp(`^preview-${theme}-[a-f0-9]{20}\\.svg$`).test(artifact.path) ||
          !/^[a-f0-9]{64}$/.test(artifact.sha256) || !Number.isInteger(artifact.bytes)) throw new Error("Invalid preview artifact.");
      const bytes = await (await context.fetchFresh("webapp_data/" + artifact.path)).arrayBuffer();
      const digest = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)), b => b.toString(16).padStart(2, "0")).join("");
      if (bytes.byteLength !== artifact.bytes || digest !== artifact.sha256) throw new Error("Preview integrity check failed.");
      const url = URL.createObjectURL(new Blob([bytes], { type: "image/svg+xml" }));
      try {
        const image = new Image(); image.src = url; await image.decode();
        if (image.naturalWidth !== 640 || image.naturalHeight !== 360) throw new Error("Invalid preview dimensions.");
        images[theme] = image;
      } finally { URL.revokeObjectURL(url); }
    }
    return { signature: marker.signature, images, date: new Date(marker.last_timestamp * 1000).toISOString().slice(0, 10) };
  }
  function render() {
    if (!installed) return false;
    // The grid displays a small card. Decode and paint at its deliberate 640px
    // resolution, independent of iframe size or a high device pixel ratio.
    canvas.width = 640; canvas.height = 360;
    canvas.getContext("2d").drawImage(installed.images[document.documentElement.dataset.theme === "light" ? "light" : "dark"], 0, 0, 640, 360);
    canvas.dataset.endDate = installed.date;
    return true;
  }
  P.initThemeSync({ onThemeChanged: () => refresher?.requestPresent("theme") });
  refresher = P.createDataRefresher({ filename: "target_and_block_hashes.png", urls: ["webapp_data/manifest.json"],
    getInstalledSignature: () => installed?.signature || "", prepare,
    commit: (candidate) => { installed = candidate; return { present: true }; }, present: render,
    onError: (error) => console.warn("Target & Block Hashes preview retained its last complete publication.", error),
  });
  window.addEventListener("resize", () => refresher.requestPresent("resize"));
  refresher.start();
}());
