import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import test from "node:test";

const source = readFileSync(new URL("../webapps/shared/dashboard_export.js", import.meta.url), "utf8");
function fixture(options = {}) {
  const log = { configs: [], inputs: [], output: [], draws: [], framesClosed: 0, closed: 0, flushes: 0, progress: [] };
  let output, error, mp4, pending = [];
  const metadata = { decoderConfig: { codec: "avc1.42E01f", description: Uint8Array.of(1, 66, 224, 31) } };
  class VideoFrame {
    constructor(_canvas, value) { Object.assign(this, value); }
    close() { log.framesClosed++; }
  }
  class VideoEncoder {
    static async isConfigSupported(config) {
      log.configs.push(config);
      return { config, supported: config.codec.startsWith("avc1") ? options.avc !== false : options.webm !== false };
    }
    constructor(callbacks) { ({ output, error } = callbacks); this.state = "unconfigured"; this.encodeQueueSize = 0; }
    configure(config) { mp4 = config.codec.startsWith("avc1"); this.state = "configured"; if (options.configureError) throw new Error("configure failed"); }
    encode(frame) {
      const index = log.inputs.length;
      log.inputs.push({ timestamp: frame.timestamp, duration: frame.duration });
      if (options.encodeError) throw new Error("encode failed");
      const emit = () => {
        if (options.drop === index) return;
        const timestamp = frame.timestamp + (options.wrongTimestamp === index ? 1 : 0);
        const chunk = { timestamp, type: index === 0 ? "key" : "delta", byteLength: options.empty === index ? 0 : 1, copyTo(bytes) { bytes[0] = index & 255; } };
        log.output.push(timestamp);
        output(chunk, mp4 ? (options.configChange === index ? { decoderConfig: { ...metadata.decoderConfig, description: Uint8Array.of(1, 66, 224, 40) } } : metadata) : undefined);
        if (options.duplicate === index) output(chunk, mp4 ? metadata : undefined);
        if (options.asyncError === index) error(new Error("encoder failed"));
      };
      if (options.delayed) pending.push(emit); else emit();
    }
    async flush() {
      log.flushes++;
      if (options.flushError) throw new Error("flush failed");
      if (options.reorder) pending.reverse();
      pending.splice(0).forEach((emit) => emit());
    }
    close() { log.closed++; this.state = "closed"; }
  }
  const window = {
    VideoEncoder, VideoFrame, setTimeout: (fn) => setTimeout(fn, 0),
    WSBDashboardExportBranding: { async ready() { if (options.assetError) throw new Error("assets failed"); } },
    WSBDashboardMP4: { buildBlob(value) { log.mux = value; return new Blob([Uint8Array.of(1)], { type: "video/mp4" }); } },
  };
  runInNewContext(source, { window, VideoEncoder, VideoFrame, TextEncoder, Uint8Array, DataView, Blob });
  const args = {
    canvas: { width: 1280, height: 720 }, fps: 30, frames: Array.from({ length: 35 }, (_, i) => i),
    renderFrame(_state, _canvas, index) { log.draws.push(index); if (options.renderError) throw new Error("render failed"); },
    onProgress(value) { log.progress.push(value); },
  };
  return { E: window.WSBDashboardExport, args, log };
}

test("MP4 encodes once in quality mode, preserves every timestamp and closes frames", async () => {
  const { E, args, log } = fixture({ delayed: true });
  const blob = await E.encodeVideo(args);
  assert.equal(blob.type, "video/mp4");
  assert.equal(E.videoExtension(blob), "mp4");
  assert.equal(log.configs[0].latencyMode, "quality");
  assert.equal(log.configs[0].avc.format, "avc");
  assert.equal(log.configs[0].bitrate, 11_520_000);
  assert.equal(log.inputs.length, 35);
  assert.equal(log.draws.length, 35);
  assert.equal(log.framesClosed, 35);
  assert.equal(log.closed, 1);
  assert.ok(log.flushes >= 4, "backpressure also bounds submitted frames awaiting output");
  assert.equal(log.progress.at(-1), 1);
  assert.ok(log.progress.slice(0, -1).every((n) => n < 1));
  for (let i = 0; i < 35; i++) {
    assert.equal(log.mux.frames[i].timestamp, Math.round(i * 1e6 / 30));
    assert.equal(log.mux.frames[i].duration, Math.round((i + 1) * 1e6 / 30) - Math.round(i * 1e6 / 30));
  }
});

test("unsupported AVC falls back to actual WebM before drawing, while explicit WebM stays WebM", async () => {
  for (const force of [false, true]) {
    const { E, args, log } = fixture({ avc: false });
    const blob = await (force ? E.encodeWebM(args) : E.encodeVideo(args));
    assert.equal(blob.type, "video/webm");
    assert.equal(E.videoExtension(blob), "webm");
    assert.equal(log.draws.length, args.frames.length);
    assert.equal(log.closed, 1);
    if (force) assert.ok(log.configs.every((c) => !c.codec.startsWith("avc1")));
  }
  const { E, args, log } = fixture({ avc: false, webm: false });
  assert.equal(await E.encodeVideo(args), null);
  assert.equal(log.draws.length, 0);
});

for (const [fault, message] of [
  [{ drop: 2 }, /preserved 34 of 35/], [{ duplicate: 2 }, /duplicate/],
  [{ wrongTimestamp: 2 }, /unexpected/], [{ configChange: 2 }, /configuration/],
  [{ empty: 2 }, /empty frame/],
  [{ delayed: true, reorder: true }, /reordered/], [{ encodeError: true }, /encode failed/],
  [{ renderError: true }, /render failed/], [{ flushError: true }, /flush failed/],
  [{ configureError: true }, /configure failed/], [{ asyncError: 2 }, /encoder failed/],
]) {
  test(`fail closed with cleanup and no second render pass: ${JSON.stringify(fault)}`, async () => {
    const { E, args, log } = fixture(fault);
    await assert.rejects(E.encodeVideo(args), message);
    assert.equal(log.closed, 1);
    assert.equal(log.mux, undefined);
    assert.ok(!log.progress.includes(1));
    assert.ok(log.draws.length <= args.frames.length);
    assert.equal(log.configs.length, 1, "runtime failure must not restart export in WebM");
  });
}

test("cancel after asynchronous render closes encoder without submitting that frame", async () => {
  const { E, args, log } = fixture();
  let canceled = false;
  args.renderFrame = async () => { canceled = true; };
  args.isCanceled = () => canceled;
  assert.equal(await E.encodeVideo(args), null);
  assert.equal(log.inputs.length, 0);
  assert.equal(log.closed, 1);
});

test("WebM fallback also rejects empty output instead of counting it as a frame", async () => {
  const { E, args, log } = fixture({ avc: false, empty: 2 });
  await assert.rejects(E.encodeVideo(args), /empty frame/);
  assert.equal(log.closed, 1);
  assert.ok(!log.progress.includes(1));
});

test("empty animation and branding errors never create an encoder", async () => {
  const { E, args, log } = fixture({ assetError: true });
  await assert.rejects(E.encodeVideo({ ...args, frames: [] }), /No animation frames/);
  await assert.rejects(E.encodeVideo(args), /assets failed/);
  assert.equal(log.draws.length, 0);
  assert.equal(log.closed, 0);
});

test("AVC levels account for dimensions, frame rate and bitrate up through 4K", async () => {
  const { E } = fixture();
  for (const [width, height] of [[1280, 720], [1920, 1080], [2560, 1440], [3840, 2160], [2160, 3840], [2160, 2160]]) {
    const selected = await E.getSupportedMp4Config(width, height, { quality: Math.min(width, height) }, { fps: 30 });
    assert.ok(selected);
    assert.ok(parseInt(selected.config.codec.slice(-2), 16) >= (Math.max(width, height) === 3840 ? 51 : 31));
    assert.equal(selected.config.latencyMode, "quality");
  }
  assert.equal(await E.getSupportedMp4Config(10000, 10000, {}, { fps: 30 }), null);
});

test("a ten-minute timeline has no accumulated rounding drift", async () => {
  const { E, args, log } = fixture();
  args.frames = Array.from({ length: 19021 }, (_, i) => i);
  await E.encodeVideo(args);
  const last = log.mux.frames.at(-1);
  assert.equal(last.timestamp, 634000000);
  assert.equal(last.timestamp + last.duration, Math.round(19021 / 30 * 1e6));
});

test("default video cadence and estimates stay at 30 fps regardless of playback speed", async () => {
  const { E, args, log } = fixture();
  delete args.fps;
  args.settings = { fps: "240" };
  args.frames = Array.from({ length: 60 }, (_, i) => i);
  await E.encodeVideo(args);
  assert.equal(E.VIDEO_FPS, 30);
  assert.equal(log.configs[0].framerate, E.VIDEO_FPS);
  assert.equal(log.mux.fps, E.VIDEO_FPS);
  const last = log.mux.frames.at(-1);
  assert.equal(last.timestamp + last.duration, 2000000);
  assert.equal(E.estimateDownload(args.settings, { frameCount: 60 }).videoSeconds, 2);
});
