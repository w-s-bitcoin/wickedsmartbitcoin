(function () {
  const ns = window.WSBDashboardExport = window.WSBDashboardExport || {};
  const DEFAULT_FPS = 30;
  const DEFAULT_QUALITY = 720;
  const DEFAULT_REFERENCE_QUALITY = 720;
  const DEFAULT_BITRATE_FLOOR = 4_000_000;
  const DEFAULT_BITRATE_PER_QUALITY = 8000;
  const DEFAULT_WEBM_EXTENSION_MULTIPLIER = 0.78;

  function normalizeQuality(quality, fallback = DEFAULT_QUALITY) {
    const parsed = Number(quality);
    if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
    return parsed;
  }

  function getDimensions(settings = {}) {
    const quality = normalizeQuality(settings.quality);
    if (settings.orientation === "portrait") return { width: quality, height: Math.round(quality * 16 / 9) };
    if (settings.orientation === "square") return { width: quality, height: quality };
    return { width: Math.round(quality * 16 / 9), height: quality };
  }

  function getLayoutMetrics(settings = {}) {
    const { width, height } = getDimensions(settings);
    const panelGap = Math.max(8, Math.round(Math.min(width, height) * 0.012));
    const outerMargin = panelGap;
    const footerHeight = Math.max(34, Math.round(Math.min(width, height) * 0.052));
    return { width, height, outerMargin, panelGap, footerHeight };
  }

  function getReferenceSettings(settings = {}, referenceQuality = DEFAULT_REFERENCE_QUALITY) {
    return { ...settings, quality: String(referenceQuality) };
  }

  function getPixelScale(settings = {}, referenceQuality = DEFAULT_REFERENCE_QUALITY) {
    const referenceDimensions = getDimensions(getReferenceSettings(settings, referenceQuality));
    const outputDimensions = getDimensions(settings);
    return Math.max(
      outputDimensions.width / Math.max(1, referenceDimensions.width),
      outputDimensions.height / Math.max(1, referenceDimensions.height),
    );
  }

  function getBitrate(settings = {}, opts = {}) {
    if (typeof opts.getBitrate === "function") return opts.getBitrate(settings);
    const quality = normalizeQuality(settings.quality);
    return Math.max(
      Number(opts.floor) || DEFAULT_BITRATE_FLOOR,
      quality * (Number(opts.perQuality) || DEFAULT_BITRATE_PER_QUALITY),
    );
  }

  function formatDuration(seconds) {
    if (!Number.isFinite(seconds) || seconds < 0) return "--";
    const rounded = Math.max(0, Math.round(seconds));
    const hours = Math.floor(rounded / 3600);
    const minutes = Math.floor((rounded % 3600) / 60);
    const secs = rounded % 60;
    if (hours) return `${hours}h ${minutes}m ${secs}s`;
    if (minutes) return `${minutes}m ${String(secs).padStart(2, "0")}s`;
    return `${secs}s`;
  }

  function formatSize(bytes) {
    if (!Number.isFinite(bytes) || bytes <= 0) return "--";
    const mib = bytes / (1024 * 1024);
    if (mib < 10) return `${mib.toFixed(1)} MB`;
    return `${Math.round(mib).toLocaleString("en-US")} MB`;
  }

  function estimateDownload(settings = {}, opts = {}) {
    const fps = Math.max(1, Number(opts.outputFps) || DEFAULT_FPS);
    const frameCount = Math.max(0, Number(opts.frameCount) || 0);
    const uniqueFrameCount = Math.max(0, Number(opts.uniqueFrameCount) || frameCount);
    const videoSeconds = Number.isFinite(opts.videoSeconds) ? Math.max(0, opts.videoSeconds) : frameCount / fps;
    const dimensions = opts.dimensions || getDimensions(settings);
    const bitrate = Number(opts.bitrate) || getBitrate(settings, opts);
    const extensionMultiplier = Number.isFinite(opts.extensionMultiplier)
      ? opts.extensionMultiplier
      : DEFAULT_WEBM_EXTENSION_MULTIPLIER;
    const estimatedBytes = (bitrate * videoSeconds / 8) * extensionMultiplier;
    const megapixels = Math.max(0.1, (dimensions.width * dimensions.height) / 1_000_000);
    const calibratedFrameSeconds = opts.calibration?.msPerFrame
      ? Math.max(0.001, opts.calibration.msPerFrame / 1000)
      : null;
    const fallbackFrameSeconds = Number.isFinite(opts.fallbackFrameSeconds)
      ? opts.fallbackFrameSeconds
      : Math.max(0.004, 0.003 + Math.sqrt(megapixels) * 0.002);
    const chartCount = Math.max(1, Number(opts.chartCount) || 1);
    const renderSeconds = Math.max(
      Number(opts.minRenderSeconds) || 1,
      uniqueFrameCount * chartCount * (calibratedFrameSeconds ?? fallbackFrameSeconds),
    );
    const encodeSeconds = Math.max(
      Number(opts.minEncodeSeconds) || 0,
      frameCount * (Number.isFinite(opts.encodeFrameSeconds) ? opts.encodeFrameSeconds : Math.max(0.0003, megapixels * 0.00015)),
    );
    const processingSeconds = renderSeconds + encodeSeconds;
    return {
      bytes: estimatedBytes,
      videoSeconds,
      processingSeconds,
      sizeText: formatSize(estimatedBytes),
      lengthText: formatDuration(videoSeconds),
      timeText: `~${formatDuration(processingSeconds)}`,
    };
  }

  function createCalibrationStore() {
    return {
      cache: new Map(),
      pending: new Set(),
      timer: null,
      requestId: 0,
    };
  }

  function getRepresentativeFrames(frames, limit = 3) {
    const uniqueFrames = Array.from(new Set(frames || []));
    if (uniqueFrames.length <= limit) return uniqueFrames;
    if (limit <= 1) return [uniqueFrames[Math.floor((uniqueFrames.length - 1) / 2)]];
    return [
      uniqueFrames[0],
      uniqueFrames[Math.floor((uniqueFrames.length - 1) / 2)],
      uniqueFrames[uniqueFrames.length - 1],
    ];
  }

  function scheduleCalibration(store, key, frames, calibrate, onComplete, delayMs = 180) {
    if (!store || !key || typeof calibrate !== "function") return;
    if (store.cache.has(key) || store.pending.has(key)) return;
    if (store.timer) window.clearTimeout(store.timer);
    store.timer = window.setTimeout(async () => {
      store.timer = null;
      if (store.cache.has(key) || store.pending.has(key)) return;
      store.pending.add(key);
      const requestId = ++store.requestId;
      try {
        const started = performance.now();
        const sampleCount = await calibrate(getRepresentativeFrames(frames));
        if (requestId !== store.requestId || !sampleCount) return;
        const msPerFrame = (performance.now() - started) / sampleCount;
        if (!Number.isFinite(msPerFrame) || msPerFrame <= 0) return;
        store.cache.set(key, { msPerFrame, sampleCount });
        if (typeof onComplete === "function") onComplete(store.cache.get(key));
      } catch (error) {
        console.warn("Unable to calibrate dashboard export estimate.", error);
      } finally {
        store.pending.delete(key);
      }
    }, delayMs);
  }

  function concatUint8Arrays(arrays) {
    const totalLength = arrays.reduce((sum, item) => sum + item.length, 0);
    const out = new Uint8Array(totalLength);
    let offset = 0;
    arrays.forEach((item) => {
      out.set(item, offset);
      offset += item.length;
    });
    return out;
  }

  function ebmlIdBytes(id) {
    const hex = id.toString(16).padStart(2, "0");
    const padded = hex.length % 2 ? `0${hex}` : hex;
    const bytes = new Uint8Array(padded.length / 2);
    for (let i = 0; i < bytes.length; i += 1) {
      bytes[i] = Number.parseInt(padded.slice(i * 2, i * 2 + 2), 16);
    }
    return bytes;
  }

  function ebmlSizeBytes(size) {
    if (size < 0x7f) return Uint8Array.of(0x80 | size);
    if (size < 0x3fff) return Uint8Array.of(0x40 | (size >> 8), size & 0xff);
    if (size < 0x1fffff) return Uint8Array.of(0x20 | (size >> 16), (size >> 8) & 0xff, size & 0xff);
    if (size < 0x0fffffff) {
      return Uint8Array.of(0x10 | (size >> 24), (size >> 16) & 0xff, (size >> 8) & 0xff, size & 0xff);
    }
    const bytes = new Uint8Array(8);
    bytes[0] = 0x01;
    let value = size;
    for (let i = 7; i >= 1; i -= 1) {
      bytes[i] = value & 0xff;
      value = Math.floor(value / 256);
    }
    return bytes;
  }

  function ebmlUnknownSizeBytes() {
    return Uint8Array.of(0x01, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff);
  }

  function ebmlElement(id, data) {
    return concatUint8Arrays([ebmlIdBytes(id), ebmlSizeBytes(data.length), data]);
  }

  function ebmlUint(value, byteLength = 0) {
    let length = byteLength || 1;
    if (!byteLength) {
      let probe = Math.max(0, Number(value) || 0);
      while (probe > 0xff) {
        length += 1;
        probe = Math.floor(probe / 256);
      }
    }
    const bytes = new Uint8Array(length);
    let next = Math.max(0, Number(value) || 0);
    for (let i = length - 1; i >= 0; i -= 1) {
      bytes[i] = next & 0xff;
      next = Math.floor(next / 256);
    }
    return bytes;
  }

  function ebmlFloat64(value) {
    const bytes = new Uint8Array(8);
    new DataView(bytes.buffer).setFloat64(0, Number(value) || 0, false);
    return bytes;
  }

  function ebmlAscii(value) {
    return new TextEncoder().encode(String(value || ""));
  }

  function webmSimpleBlock(trackNumber, relativeTimecode, keyFrame, data) {
    const header = new Uint8Array(4);
    header[0] = 0x80 | Math.max(1, Math.min(126, trackNumber));
    new DataView(header.buffer).setInt16(1, Math.max(-32768, Math.min(32767, Math.round(relativeTimecode))), false);
    header[3] = keyFrame ? 0x80 : 0x00;
    return ebmlElement(0xa3, concatUint8Arrays([header, data]));
  }

  function buildWebMBlob(encodedFrames, width, height, fps, codecId, title = "wickedsmartbitcoin") {
    const durationSeconds = encodedFrames.length / Math.max(1, fps);
    const ebmlHeader = ebmlElement(0x1a45dfa3, concatUint8Arrays([
      ebmlElement(0x4286, ebmlUint(1)),
      ebmlElement(0x42f7, ebmlUint(1)),
      ebmlElement(0x42f2, ebmlUint(4)),
      ebmlElement(0x42f3, ebmlUint(8)),
      ebmlElement(0x4282, ebmlAscii("webm")),
      ebmlElement(0x4287, ebmlUint(4)),
      ebmlElement(0x4285, ebmlUint(2)),
    ]));
    const info = ebmlElement(0x1549a966, concatUint8Arrays([
      ebmlElement(0x2ad7b1, ebmlUint(1000000)),
      ebmlElement(0x4489, ebmlFloat64(durationSeconds)),
      ebmlElement(0x4d80, ebmlAscii("wickedsmartbitcoin")),
      ebmlElement(0x5741, ebmlAscii("wickedsmartbitcoin")),
    ]));
    const video = ebmlElement(0xe0, concatUint8Arrays([
      ebmlElement(0xb0, ebmlUint(width)),
      ebmlElement(0xba, ebmlUint(height)),
    ]));
    const trackEntry = ebmlElement(0xae, concatUint8Arrays([
      ebmlElement(0xd7, ebmlUint(1)),
      ebmlElement(0x73c5, ebmlUint(1)),
      ebmlElement(0x83, ebmlUint(1)),
      ebmlElement(0x86, ebmlAscii(codecId)),
      ebmlElement(0x258688, ebmlAscii(title)),
      video,
    ]));
    const tracks = ebmlElement(0x1654ae6b, trackEntry);
    const clusters = [];
    let clusterStartMs = -1;
    let clusterBlocks = [];
    const flushCluster = () => {
      if (clusterStartMs < 0 || !clusterBlocks.length) return;
      clusters.push(ebmlElement(0x1f43b675, concatUint8Arrays([
        ebmlElement(0xe7, ebmlUint(clusterStartMs)),
        ...clusterBlocks,
      ])));
      clusterStartMs = -1;
      clusterBlocks = [];
    };
    encodedFrames.forEach((frame) => {
      const timeMs = Math.round(frame.timestamp / 1000);
      if (clusterStartMs < 0 || timeMs - clusterStartMs > 30000) {
        flushCluster();
        clusterStartMs = timeMs;
      }
      clusterBlocks.push(webmSimpleBlock(1, timeMs - clusterStartMs, frame.type === "key", frame.data));
    });
    flushCluster();
    const segmentPayload = concatUint8Arrays([info, tracks, ...clusters]);
    const segment = concatUint8Arrays([ebmlIdBytes(0x18538067), ebmlUnknownSizeBytes(), segmentPayload]);
    return new Blob([ebmlHeader, segment], { type: "video/webm" });
  }

  async function getSupportedWebCodecsConfig(width, height, settings = {}, opts = {}) {
    if (!hasWebCodecsExportSupport()) return null;
    const fps = Math.max(1, Number(opts.fps) || DEFAULT_FPS);
    const candidates = opts.candidates || [
      { codec: "vp09.00.10.08", webmCodecId: "V_VP9" },
      { codec: "vp8", webmCodecId: "V_VP8" },
    ];
    for (const candidate of candidates) {
      const config = {
        codec: candidate.codec,
        width,
        height,
        bitrate: getBitrate(settings, opts),
        framerate: fps,
        latencyMode: "quality",
      };
      try {
        const support = await VideoEncoder.isConfigSupported(config);
        if (support?.supported) return { ...candidate, config: support.config || config };
      } catch (_) {
        // Try the next codec.
      }
    }
    return null;
  }

  function hasWebCodecsExportSupport() {
    return !!(window.VideoEncoder && window.VideoFrame && typeof VideoEncoder.isConfigSupported === "function");
  }

  async function encodeWebM({
    canvas,
    width,
    height,
    fps = DEFAULT_FPS,
    settings = {},
    frames = [],
    renderFrame,
    isCanceled,
    onProgress,
    title,
    bitrate,
  }) {
    if (!canvas || typeof renderFrame !== "function") throw new Error("Missing export canvas or frame renderer.");
    const exportWidth = Math.max(1, Math.round(width || canvas.width || getDimensions(settings).width));
    const exportHeight = Math.max(1, Math.round(height || canvas.height || getDimensions(settings).height));
    if (canvas.width !== exportWidth) canvas.width = exportWidth;
    if (canvas.height !== exportHeight) canvas.height = exportHeight;
    const frameRate = Math.max(1, Number(fps) || DEFAULT_FPS);
    const encoderConfig = await getSupportedWebCodecsConfig(exportWidth, exportHeight, settings, {
      fps: frameRate,
      getBitrate: bitrate ? () => bitrate : undefined,
    });
    if (!encoderConfig) return null;
    const encodedFrames = [];
    const frameDurationUs = Math.round(1000000 / frameRate);
    let frameIndex = 0;
    let encodeError = null;
    const encoder = new VideoEncoder({
      output: (chunk) => {
        const data = new Uint8Array(chunk.byteLength);
        chunk.copyTo(data);
        encodedFrames.push({ timestamp: chunk.timestamp, type: chunk.type, data });
      },
      error: (error) => {
        encodeError = error;
      },
    });
    encoder.configure(encoderConfig.config);
    for (const frameState of frames) {
      if (typeof isCanceled === "function" && isCanceled()) break;
      await renderFrame(frameState, canvas, frameIndex);
      const frame = new VideoFrame(canvas, {
        timestamp: frameIndex * frameDurationUs,
        duration: frameDurationUs,
      });
      encoder.encode(frame, { keyFrame: frameIndex % frameRate === 0 });
      frame.close();
      if (encodeError) throw encodeError;
      frameIndex += 1;
      if (typeof onProgress === "function") onProgress(frameIndex / Math.max(1, frames.length));
      if (encoder.encodeQueueSize > 8) {
        await encoder.flush();
        await wait(0);
      } else if (frameIndex % 6 === 0) {
        await wait(0);
      }
    }
    await encoder.flush();
    if (encodeError) throw encodeError;
    encoder.close();
    if (typeof isCanceled === "function" && isCanceled()) return null;
    encodedFrames.sort((a, b) => a.timestamp - b.timestamp);
    return buildWebMBlob(encodedFrames, exportWidth, exportHeight, frameRate, encoderConfig.webmCodecId, title);
  }

  function wait(ms) {
    return new Promise((resolve) => window.setTimeout(resolve, ms));
  }

  function drawFooterUrl(ctx, url, metrics, settings = {}) {
    if (!ctx || !url || !metrics) return;
    const { width, height, footerHeight } = metrics;
    const theme = settings.theme === "light" ? "light" : "dark";
    ctx.save();
    ctx.fillStyle = theme === "dark" ? "#6f7f87" : "#8f887f";
    const referenceQuality = normalizeQuality(settings.referenceQuality, 1440);
    const referenceDimensions = getDimensions({ ...settings, quality: referenceQuality });
    const referenceFooterHeight = Math.max(34, Math.round(Math.min(referenceDimensions.width, referenceDimensions.height) * 0.052));
    const referenceFontSize = Math.max(30, Math.round(referenceFooterHeight * 0.6));
    const outputScale = height / Math.max(1, referenceDimensions.height);
    const pixelScale = Math.max(1, Number(settings.pixelScale) || 1);
    const footerFontSize = Math.max(12, referenceFontSize * outputScale / pixelScale);
    ctx.font = `500 ${footerFontSize}px IBM Plex Mono, monospace`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(url, width / 2, height - footerHeight * 0.68);
    ctx.restore();
  }

  function writeEstimateElements(elements = {}, estimate = {}, options = {}) {
    const sizeEl = elements.size || elements.downloadEstimateSize;
    const lengthEl = elements.length || elements.downloadEstimateLength;
    const timeEl = elements.time || elements.downloadEstimateTime;
    if (sizeEl) sizeEl.textContent = estimate.sizeText || options.emptyText || "--";
    if (lengthEl) lengthEl.textContent = estimate.lengthText || options.emptyText || "--";
    if (timeEl) timeEl.textContent = estimate.timeText || options.emptyText || "--";
  }

  ns.getDimensions = getDimensions;
  ns.getLayoutMetrics = getLayoutMetrics;
  ns.getReferenceSettings = getReferenceSettings;
  ns.getPixelScale = getPixelScale;
  ns.getBitrate = getBitrate;
  ns.formatDuration = formatDuration;
  ns.formatSize = formatSize;
  ns.estimateDownload = estimateDownload;
  ns.createCalibrationStore = createCalibrationStore;
  ns.scheduleCalibration = scheduleCalibration;
  ns.getRepresentativeFrames = getRepresentativeFrames;
  ns.buildWebMBlob = buildWebMBlob;
  ns.getSupportedWebCodecsConfig = getSupportedWebCodecsConfig;
  ns.hasWebCodecsExportSupport = hasWebCodecsExportSupport;
  ns.encodeWebM = encodeWebM;
  ns.drawFooterUrl = drawFooterUrl;
  ns.writeEstimateElements = writeEstimateElements;
})();
