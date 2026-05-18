(function () {
  "use strict";

  const textEncoder = new TextEncoder();

  function ascii(value) {
    return textEncoder.encode(value);
  }

  function uint8(...values) {
    return new Uint8Array(values);
  }

  function uint16(value) {
    return uint8((value >>> 8) & 255, value & 255);
  }

  function uint24(value) {
    return uint8((value >>> 16) & 255, (value >>> 8) & 255, value & 255);
  }

  function uint32(value) {
    return uint8((value >>> 24) & 255, (value >>> 16) & 255, (value >>> 8) & 255, value & 255);
  }

  function concat(parts) {
    const size = parts.reduce((total, part) => total + part.length, 0);
    const out = new Uint8Array(size);
    let offset = 0;
    parts.forEach((part) => {
      out.set(part, offset);
      offset += part.length;
    });
    return out;
  }

  function box(type, ...payloads) {
    const payload = concat(payloads);
    return concat([uint32(payload.length + 8), ascii(type), payload]);
  }

  function fullBox(type, version, flags, ...payloads) {
    return box(type, uint8(version), uint24(flags), ...payloads);
  }

  function matrix() {
    return concat([
      uint32(0x00010000), uint32(0), uint32(0),
      uint32(0), uint32(0x00010000), uint32(0),
      uint32(0), uint32(0), uint32(0x40000000),
    ]);
  }

  function ftyp() {
    return box("ftyp", ascii("isom"), uint32(512), ascii("isom"), ascii("iso2"), ascii("avc1"), ascii("mp41"));
  }

  function mvhd(timescale, duration) {
    return fullBox(
      "mvhd",
      0,
      0,
      uint32(0),
      uint32(0),
      uint32(timescale),
      uint32(duration),
      uint32(0x00010000),
      uint16(0x0100),
      uint16(0),
      uint32(0),
      uint32(0),
      matrix(),
      new Uint8Array(24),
      uint32(2)
    );
  }

  function tkhd(width, height, duration) {
    return fullBox(
      "tkhd",
      0,
      0x000007,
      uint32(0),
      uint32(0),
      uint32(1),
      uint32(0),
      uint32(duration),
      uint32(0),
      uint32(0),
      uint16(0),
      uint16(0),
      uint16(0),
      uint16(0),
      matrix(),
      uint32(width << 16),
      uint32(height << 16)
    );
  }

  function mdhd(timescale, duration) {
    return fullBox("mdhd", 0, 0, uint32(0), uint32(0), uint32(timescale), uint32(duration), uint16(0x55c4), uint16(0));
  }

  function hdlr() {
    return fullBox("hdlr", 0, 0, uint32(0), ascii("vide"), uint32(0), uint32(0), uint32(0), ascii("VideoHandler\0"));
  }

  function vmhd() {
    return fullBox("vmhd", 0, 1, uint16(0), uint16(0), uint16(0), uint16(0));
  }

  function dref() {
    return fullBox("dref", 0, 0, uint32(1), fullBox("url ", 0, 1));
  }

  function dinf() {
    return box("dinf", dref());
  }

  function stts(sampleCount, sampleDuration) {
    return fullBox("stts", 0, 0, uint32(1), uint32(sampleCount), uint32(sampleDuration));
  }

  function stsc(sampleCount) {
    return fullBox("stsc", 0, 0, uint32(1), uint32(1), uint32(sampleCount), uint32(1));
  }

  function stsz(samples) {
    return fullBox("stsz", 0, 0, uint32(0), uint32(samples.length), ...samples.map((sample) => uint32(sample.data.length)));
  }

  function stco(offset) {
    return fullBox("stco", 0, 0, uint32(1), uint32(offset));
  }

  function stss(samples) {
    const keyframes = samples
      .map((sample, index) => sample.key ? index + 1 : 0)
      .filter(Boolean);
    return fullBox("stss", 0, 0, uint32(keyframes.length), ...keyframes.map((index) => uint32(index)));
  }

  function avc1(width, height, avcConfig) {
    const compressor = new Uint8Array(32);
    const name = ascii("WebCodecs H.264");
    compressor[0] = Math.min(31, name.length);
    compressor.set(name.slice(0, 31), 1);
    return box(
      "avc1",
      new Uint8Array(6),
      uint16(1),
      uint16(0),
      uint16(0),
      uint32(0),
      uint32(0),
      uint32(0),
      uint16(width),
      uint16(height),
      uint32(0x00480000),
      uint32(0x00480000),
      uint32(0),
      uint16(1),
      compressor,
      uint16(0x0018),
      uint16(0xffff),
      box("avcC", avcConfig)
    );
  }

  function stsd(width, height, avcConfig) {
    return fullBox("stsd", 0, 0, uint32(1), avc1(width, height, avcConfig));
  }

  function stbl(width, height, samples, timescale, sampleDuration, avcConfig, dataOffset) {
    return box(
      "stbl",
      stsd(width, height, avcConfig),
      stts(samples.length, sampleDuration),
      stss(samples),
      stsc(samples.length),
      stsz(samples),
      stco(dataOffset)
    );
  }

  function minf(width, height, samples, timescale, sampleDuration, avcConfig, dataOffset) {
    return box("minf", vmhd(), dinf(), stbl(width, height, samples, timescale, sampleDuration, avcConfig, dataOffset));
  }

  function mdia(width, height, samples, timescale, sampleDuration, avcConfig, dataOffset) {
    return box(
      "mdia",
      mdhd(timescale, samples.length * sampleDuration),
      hdlr(),
      minf(width, height, samples, timescale, sampleDuration, avcConfig, dataOffset)
    );
  }

  function trak(width, height, samples, timescale, sampleDuration, avcConfig, dataOffset) {
    return box(
      "trak",
      tkhd(width, height, samples.length * sampleDuration),
      mdia(width, height, samples, timescale, sampleDuration, avcConfig, dataOffset)
    );
  }

  function moov(width, height, samples, timescale, sampleDuration, avcConfig, dataOffset) {
    return box(
      "moov",
      mvhd(timescale, samples.length * sampleDuration),
      trak(width, height, samples, timescale, sampleDuration, avcConfig, dataOffset)
    );
  }

  function buildMp4Blob({ width, height, fps, samples, avcConfig }) {
    if (!samples?.length || !avcConfig?.length) return null;
    const timescale = Math.max(1, Math.round(fps || 30));
    const sampleDuration = 1;
    const fileType = ftyp();
    const placeholderMoov = moov(width, height, samples, timescale, sampleDuration, avcConfig, 0);
    const dataOffset = fileType.length + placeholderMoov.length + 8;
    const movie = moov(width, height, samples, timescale, sampleDuration, avcConfig, dataOffset);
    const mediaData = box("mdat", ...samples.map((sample) => sample.data));
    return new Blob([fileType, movie, mediaData], { type: "video/mp4" });
  }

  async function getSupportedAvcConfig(width, height, bitrate, fps) {
    if (!window.VideoEncoder || !window.VideoFrame || typeof VideoEncoder.isConfigSupported !== "function") return null;
    const configs = [
      {
        codec: "avc1.42E01E",
        width,
        height,
        bitrate,
        framerate: fps,
        avc: { format: "avc" },
        latencyMode: "realtime",
        hardwareAcceleration: "prefer-hardware",
      },
      {
        codec: "avc1.42E01E",
        width,
        height,
        bitrate,
        framerate: fps,
        avc: { format: "avc" },
        latencyMode: "realtime",
      },
    ];
    for (const config of configs) {
      try {
        const support = await VideoEncoder.isConfigSupported(config);
        if (support?.supported) return support.config || config;
      } catch (_) {
        // Try the next config.
      }
    }
    return null;
  }

  window.WSBMp4Muxer = {
    buildMp4Blob,
    getSupportedAvcConfig,
  };
})();
