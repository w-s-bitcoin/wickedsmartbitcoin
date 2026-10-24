import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import test from "node:test";

function fixture(branding) {
  const events = [];
  class VideoEncoder {
    static async isConfigSupported(config) { return { supported: true, config }; }
    constructor({ output }) { this.output = output; this.encodeQueueSize = 0; events.push("encoder"); }
    configure() {}
    encode(frame) {
      events.push("encode");
      this.output({ byteLength: 1, timestamp: frame.timestamp, type: "key", copyTo(bytes) { bytes[0] = 1; } });
    }
    async flush() {}
    close() {}
  }
  class VideoFrame {
    constructor(_canvas, options) { Object.assign(this, options); }
    close() {}
  }
  const window = { VideoEncoder, VideoFrame, WSBDashboardExportBranding: branding, setTimeout };
  runInNewContext(readFileSync(new URL("../webapps/shared/dashboard_export.js", import.meta.url), "utf8"),
    { window, VideoEncoder, VideoFrame, TextEncoder, Uint8Array, DataView, Blob });
  return { E: window.WSBDashboardExport, events };
}

test("legacy URL footer calls use the creator and Lightning strip", () => {
  const calls = [];
  const { E } = fixture({ drawFooterStrip(...args) { calls.push(args); } });
  const ctx = {}, metrics = E.getLayoutMetrics({ quality: 1080, orientation: "landscape" });
  assert.equal(metrics.footerHeight, 122);
  assert.equal(E.getLayoutMetrics({ quality: 720, orientation: "portrait" }).footerHeight, 100);
  assert.equal(E.getLayoutMetrics({ quality: 720, orientation: "square" }).footerHeight, 100);
  E.drawFooterUrl(ctx, "https://wickedsmartbitcoin.com/uoa", metrics, { theme: "light" });
  assert.equal(calls.length, 1);
  assert.strictEqual(calls[0][0], ctx);
  assert.equal(calls[0][1], "https://wickedsmartbitcoin.com/uoa");
  assert.strictEqual(calls[0][2], metrics);
  assert.equal(calls[0][3].theme, "light");
});

test("WebM never creates an encoder or draws a frame before branding is ready", async () => {
  let release;
  const pending = new Promise((resolve) => { release = resolve; });
  const { E, events } = fixture({ ready: () => pending });
  const result = E.encodeWebM({ canvas: { width: 1920, height: 1080 }, frames: [0], renderFrame: () => events.push("draw") });
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(events, []);
  release();
  const blob = await result;
  assert.deepEqual(events, ["encoder", "draw", "encode"]);
  assert.equal(blob.type, "video/webm");
});

test("missing branding assets fail before a partial video is rendered", async () => {
  const { E, events } = fixture({ ready: async () => { throw new Error("QR unavailable"); } });
  await assert.rejects(E.encodeWebM({ canvas: { width: 1920, height: 1080 }, frames: [0], renderFrame: () => events.push("draw") }), /QR unavailable/);
  assert.deepEqual(events, []);
});
