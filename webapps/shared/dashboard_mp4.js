(function () {
  "use strict";

  // A single, square-pixel AVC video track. Baseline AVC has no B pictures, so
  // decode order and presentation order agree; reordered output is rejected.
  // Media bytes remain separate Blob parts rather than another giant mdat copy.
  const TIMESCALE = 1_000_000, UINT32_MAX = 0xffffffff;
  const ascii = (text) => new TextEncoder().encode(text);
  const zeros = (length) => new Uint8Array(length);
  function integer(value, minimum, maximum, label) {
    if (!Number.isSafeInteger(value) || value < minimum || value > maximum) throw new Error(`Invalid MP4 ${label}.`);
    return value;
  }
  function u16(value) {
    const bytes = zeros(2); new DataView(bytes.buffer).setUint16(0, integer(value, 0, 0xffff, "16-bit field")); return bytes;
  }
  function u32(values) {
    const bytes = zeros(values.length * 4), view = new DataView(bytes.buffer);
    values.forEach((value, index) => view.setUint32(index * 4, integer(value, 0, UINT32_MAX, "32-bit field")));
    return bytes;
  }
  function u64(value) {
    const number = BigInt(value);
    if (number < 0n || number > 0xffffffffffffffffn) throw new Error("Invalid MP4 64-bit field.");
    const bytes = zeros(8); new DataView(bytes.buffer).setBigUint64(0, number); return bytes;
  }
  function concat(parts) {
    const size = parts.reduce((sum, bytes) => sum + bytes.byteLength, 0);
    integer(size, 0, UINT32_MAX, "metadata size");
    const result = zeros(size); let offset = 0;
    for (const part of parts) { result.set(part, offset); offset += part.byteLength; }
    return result;
  }
  function box(type, parts = []) {
    const size = 8 + parts.reduce((sum, bytes) => sum + bytes.byteLength, 0);
    return concat([u32([size]), ascii(type), ...parts]);
  }
  function fullBox(type, version, flags, parts = []) {
    return box(type, [Uint8Array.of(version, flags >>> 16, flags >>> 8, flags), ...parts]);
  }
  function bytesOf(value) {
    if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
    if (Object.prototype.toString.call(value) === "[object ArrayBuffer]") return new Uint8Array(value);
    throw new Error("MP4 requires an AVC decoder configuration description.");
  }
  function avcDescription(config) {
    if (!/^avc1\.[0-9a-f]{6}$/i.test(config?.codec || "")) throw new Error("MP4 requires an avc1 decoder configuration.");
    const bytes = bytesOf(config.description);
    if (bytes.length < 7 || bytes[0] !== 1 || bytes[1] !== 66 || parseInt(config.codec.slice(5, 7), 16) !== 66) {
      throw new Error("MP4 requires a baseline AVC configuration with no frame reordering.");
    }
    // Chrome may keep the requested codec string (42E0) while canonicalizing
    // the actual SPS/avcC constraint flags (42C0). avcC and its SPS describe the
    // real stream; both must agree below, but need not echo the requested level.
    const lengthSize = (bytes[4] & 3) + 1;
    if (lengthSize === 3) throw new Error("Invalid MP4 AVC NAL length size.");
    let offset = 6;
    function parameterSets(count, type) {
      if (!count) throw new Error("MP4 AVC configuration is missing parameter sets.");
      for (let index = 0; index < count; index++) {
        if (offset + 2 > bytes.length) throw new Error("Truncated MP4 AVC parameter set.");
        const size = bytes[offset] * 256 + bytes[offset + 1]; offset += 2;
        if (!size || offset + size > bytes.length || (bytes[offset] & 31) !== type) throw new Error("Invalid MP4 AVC parameter set.");
        if (type === 7 && (size < 4 || bytes[offset + 1] !== bytes[1] || bytes[offset + 2] !== bytes[2] || bytes[offset + 3] !== bytes[3])) {
          throw new Error("MP4 AVC sequence parameters disagree with the configuration.");
        }
        offset += size;
      }
    }
    parameterSets(bytes[5] & 31, 7);
    if (offset >= bytes.length) throw new Error("Truncated MP4 AVC picture parameters.");
    parameterSets(bytes[offset++], 8);
    return { bytes, lengthSize };
  }
  function validateSample(frame, lengthSize) {
    const bytes = frame.data;
    if (Object.prototype.toString.call(bytes) !== "[object Uint8Array]" || !bytes.byteLength || bytes.byteLength > UINT32_MAX) {
      throw new Error("MP4 frames require nonempty Uint8Array samples smaller than 4 GiB.");
    }
    if (frame.type !== "key" && frame.type !== "delta") throw new Error("Invalid MP4 frame type.");
    let offset = 0, picture = false, idr = false;
    while (offset < bytes.length) {
      if (offset + lengthSize > bytes.length) throw new Error("Truncated MP4 AVC sample length.");
      let size = 0;
      for (let index = 0; index < lengthSize; index++) size = size * 256 + bytes[offset++];
      if (!size || offset + size > bytes.length) throw new Error("Invalid MP4 length-prefixed AVC sample.");
      const type = bytes[offset] & 31;
      if (type === 1 || type === 5) picture = true;
      if (type === 5) idr = true;
      offset += size;
    }
    if (!picture || idr !== (frame.type === "key")) throw new Error("MP4 AVC sample does not match its keyframe flag.");
  }
  const matrix = () => u32([0x10000, 0, 0, 0, 0x10000, 0, 0, 0, 0x40000000]);
  function movieHeader(duration) {
    return fullBox("mvhd", 1, 0, [u64(0), u64(0), u32([TIMESCALE]), u64(duration), u32([0x10000]),
      u16(0x100), zeros(10), matrix(), zeros(24), u32([2])]);
  }
  function trackHeader(width, height, duration) {
    return fullBox("tkhd", 1, 7, [u64(0), u64(0), u32([1, 0]), u64(duration), zeros(8),
      u16(0), u16(0), u16(0), u16(0), matrix(), u32([width * 65536, height * 65536])]);
  }
  function sampleEntry(width, height, description, colorSpace) {
    const name = ascii("WebCodecs H.264"), compressor = zeros(32);
    compressor[0] = name.length; compressor.set(name, 1);
    const children = [box("avcC", [description]), box("pasp", [u32([1, 1])])];
    // Preserve explicit color metadata emitted by the encoder. Unknown values
    // remain unspecified rather than inventing a different color conversion.
    if (colorSpace && typeof colorSpace.fullRange === "boolean") {
      const primaries = { bt709: 1, bt470bg: 5, smpte170m: 6, bt2020: 9, smpte432: 12 };
      const transfers = { bt709: 1, smpte170m: 6, "iec61966-2-1": 13, "linear": 8, "pq": 16, "hlg": 18 };
      const matrices = { rgb: 0, bt709: 1, bt470bg: 5, smpte170m: 6, "bt2020-ncl": 9 };
      children.push(box("colr", [ascii("nclx"), u16(primaries[colorSpace.primaries] ?? 2),
        u16(transfers[colorSpace.transfer] ?? 2), u16(matrices[colorSpace.matrix] ?? 2), Uint8Array.of(colorSpace.fullRange ? 0x80 : 0)]));
    }
    return box("avc1", [zeros(6), u16(1), zeros(16), u16(width), u16(height), u32([0x480000, 0x480000, 0]),
      u16(1), compressor, u16(24), u16(0xffff), ...children]);
  }
  function movie({ width, height, duration, runs, sizes, keys, description, colorSpace, offset, title }) {
    const stbl = box("stbl", [
      fullBox("stsd", 0, 0, [u32([1]), sampleEntry(width, height, description, colorSpace)]),
      fullBox("stts", 0, 0, [u32([runs.length / 2]), u32(runs)]),
      fullBox("stss", 0, 0, [u32([keys.length]), u32(keys)]),
      fullBox("stsc", 0, 0, [u32([1, 1, sizes.length, 1])]),
      fullBox("stsz", 0, 0, [u32([0, sizes.length]), u32(sizes)]),
      fullBox("co64", 0, 0, [u32([1]), u64(offset)]),
    ]);
    const dref = fullBox("dref", 0, 0, [u32([1]), fullBox("url ", 0, 1)]);
    const minf = box("minf", [fullBox("vmhd", 0, 1, [zeros(8)]), box("dinf", [dref]), stbl]);
    const mdhd = fullBox("mdhd", 1, 0, [u64(0), u64(0), u32([TIMESCALE]), u64(duration), u16(0x55c4), u16(0)]);
    const hdlr = fullBox("hdlr", 0, 0, [u32([0]), ascii("vide"), zeros(12), ascii(String(title || "Video").replace(/\0/g, "").slice(0, 128)), zeros(1)]);
    const trak = box("trak", [trackHeader(width, height, duration), box("mdia", [mdhd, hdlr, minf])]);
    return box("moov", [movieHeader(duration), trak]);
  }
  function buildBlob({ frames, width, height, fps = 30, decoderConfig, title } = {}) {
    integer(width, 1, 0xffff, "width"); integer(height, 1, 0xffff, "height");
    if (!Number.isFinite(fps) || fps <= 0 || fps > TIMESCALE) throw new Error("Invalid MP4 frame rate.");
    if (!Array.isArray(frames) || !frames.length || frames.length > UINT32_MAX) throw new Error("MP4 requires video frames.");
    const { bytes: description, lengthSize } = avcDescription(decoderConfig);
    const runs = [], sizes = [], keys = []; let mediaSize = 0n, duration = 0n;
    for (let index = 0; index < frames.length; index++) {
      const frame = frames[index];
      integer(frame.timestamp, 0, Number.MAX_SAFE_INTEGER, "frame timestamp");
      if ((!index && frame.timestamp !== 0) || (index && frame.timestamp <= frames[index - 1].timestamp)) {
        throw new Error("MP4 timestamps must start at zero and remain in strictly increasing decode order.");
      }
      if (!index && frame.type !== "key") throw new Error("The first MP4 frame must be a keyframe.");
      validateSample(frame, lengthSize);
      if (frame.duration != null) integer(frame.duration, 1, UINT32_MAX, "frame duration");
      const lastDuration = frame.duration ?? (Math.round(frames.length * TIMESCALE / fps) - Math.round((frames.length - 1) * TIMESCALE / fps));
      const delta = index + 1 < frames.length ? frames[index + 1].timestamp - frame.timestamp : lastDuration;
      integer(delta, 1, UINT32_MAX, "sample duration or frame order");
      if (runs.length && runs[runs.length - 1] === delta) runs[runs.length - 2]++;
      else runs.push(1, delta);
      if (frame.type === "key") keys.push(index + 1);
      sizes.push(frame.data.byteLength); mediaSize += BigInt(frame.data.byteLength); duration += BigInt(delta);
    }
    const ftyp = box("ftyp", [ascii("isom"), u32([0x200]), ascii("isomiso2avc1mp41")]);
    const metadata = { width, height, duration, runs, sizes, keys, description, colorSpace: decoderConfig.colorSpace, title };
    const placeholder = movie({ ...metadata, offset: 0n });
    const moov = movie({ ...metadata, offset: BigInt(ftyp.byteLength + placeholder.byteLength + 16) });
    const mdatHeader = concat([u32([1]), ascii("mdat"), u64(mediaSize + 16n)]);
    return new Blob([ftyp, moov, mdatHeader, ...frames.map((frame) => frame.data)], { type: "video/mp4" });
  }

  window.WSBDashboardMP4 = { buildBlob };
}());
