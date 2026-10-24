#!/usr/bin/env python3
"""Exercise real Patoshi MP4/WebM export in isolated Chrome and decode every frame.

The default one-day, 1D-window fixture produces 571 frames including holds.
--long uses Jan 10 through Feb 21, 2009: 19,021 frames / 634.033333 seconds.
--quality selects landscape output height; 2160 exercises native 3840 × 2160.
Both use the dashboard's actual frame planner, renderer, and download button.
A small test-only binary strip in the bottom eight pixels identifies every
decoded frame; selected source PNGs are captured before adding that strip.

Requires Chrome, ffmpeg, and ffprobe, with no third-party Python dependencies.
All fixtures and downloads stay in a temporary profile and --output-dir.
No source datasets, browser profiles, producers, or production jobs are changed.
"""

from __future__ import annotations

import argparse
import base64
import hashlib
import json
import math
import os
import platform
import re
import shutil
import struct
import subprocess
import tempfile
import threading
import time
import urllib.request
from datetime import datetime, timezone
from http.server import ThreadingHTTPServer
from pathlib import Path

from test_comparison_live_price_browser import CHROME, ROOT, FrozenHandler
from test_stage1_refresh_atomicity import CdpSocket, free_port, wait_for


FPS = 30
QUALITIES = {720: (1280, 720), 1080: (1920, 1080), 1440: (2560, 1440), 2160: (3840, 2160)}
FRAME_SHIFT_MS = 192_000
START = "2009-01-10T00:00"
SHORT_END = "2009-01-11T00:00"
LONG_END = "2009-02-21T00:00"

SHIM = r"""
(() => {
  const fixture=window.__videoTest={errors:[],run:null};
  window.WebSocket=undefined;
  window.alert=message=>fixture.errors.push(String(message));
  const logError=console.error.bind(console);
  console.error=(...items)=>{fixture.errors.push(items.map(item=>String(item?.stack||item)).join(' '));logError(...items);};
  addEventListener('error',event=>fixture.errors.push(event.message));
  addEventListener('unhandledrejection',event=>fixture.errors.push(String(event.reason)));
  const nativeEncoder=window.VideoEncoder;
  if(nativeEncoder){
    window.VideoEncoder=new Proxy(nativeEncoder,{
      construct(Target,[callbacks]){
        const run=fixture.run;
        const encoder=new Target({
          ...callbacks,
          output(chunk,metadata){
            if(run){
              run.output.push({timestamp:chunk.timestamp,duration:chunk.duration,type:chunk.type,bytes:chunk.byteLength});
              run.encodedBytes+=chunk.byteLength;
              run.lastOutputAt=performance.now();
              if(metadata?.decoderConfig){
                const config=metadata.decoderConfig,description=config.description;
                const bytes=description?(ArrayBuffer.isView(description)?new Uint8Array(description.buffer,description.byteOffset,description.byteLength):new Uint8Array(description)):[];
                (run.decoderConfigs||=[]).push({...config,description:Array.from(bytes).slice(0,16)});
              }
            }
            callbacks.output(chunk,metadata);
          }
        });
        const configure=encoder.configure.bind(encoder),encode=encoder.encode.bind(encoder);
        encoder.configure=config=>{if(run)run.config={...config};return configure(config);};
        encoder.encode=(frame,options)=>{
          if(run)run.input.push({timestamp:frame.timestamp,duration:frame.duration,keyFrame:!!options?.keyFrame});
          return encode(frame,options);
        };
        return encoder;
      },
      get(Target,key){
        if(key==='isConfigSupported')return config=>fixture.run?.mode==='fallback'&&config.codec.startsWith('avc1')
          ? Promise.resolve({supported:false,config}) : Target.isConfigSupported(config);
        const value=Reflect.get(Target,key);return typeof value==='function'?value.bind(Target):value;
      }
    });
  }
  const click=HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click=function(){
    if(this.download&&fixture.run){
      const run=fixture.run;
      run.originalName=this.download;
      this.download=run.name+'.'+this.download.split('.').at(-1);
      run.downloadName=this.download;
      run.downloadAt=performance.now();
    }
    return click.call(this);
  };
})();
"""

INSTALL = r"""
(() => {
  const E=window.WSBDashboardExport,F=window.__videoTest;
  if(F.installed)return;
  F.installed=true;
  const video=E.encodeVideo,webm=E.encodeWebM;
  E.encodeVideo=async options=>{
    const run=F.run;
    run.plan=[...options.frames];run.fps=options.fps;run.width=options.width;run.height=options.height;
    run.settings={...options.settings};run.startedAt=performance.now();
    const samples=new Set([0,30,Math.floor(options.frames.length/3),Math.floor(options.frames.length*2/3),options.frames.length-91,options.frames.length-1]);
    const thumbnail=document.createElement('canvas');thumbnail.width=96;thumbnail.height=54;
    const thumbCtx=thumbnail.getContext('2d',{willReadFrequently:true});
    const render=options.renderFrame;
    const native=run.mode==='webm'?webm:video;
    if(typeof native!=='function')throw new Error('Requested shared encoder is unavailable');
    const blob=await native({...options,
      onProgress:value=>{run.progress=value;run.progressValues.push(value);options.onProgress?.(value);},
      renderFrame:async(state,canvas,index)=>{
        const before=performance.now();
        await render(state,canvas,index);
        run.renderMs+=performance.now()-before;
        run.rendered.push(state);
        const instrumentStart=performance.now();
        thumbCtx.drawImage(canvas,0,0,96,54);
        const pixels=thumbCtx.getImageData(0,0,96,54).data;
        let signature=2166136261;
        for(let at=0;at<pixels.length;at++)signature=Math.imul(signature^pixels[at],16777619);
        run.sourceSignatures.push(signature>>>0);
        if(samples.has(index))run.samples[index]=canvas.toDataURL('image/png').split(',')[1];
        // 0xa5 sync byte, unsigned frame index, and its inverse: 40 robust cells.
        // The strip is outside the chart and excluded from quality comparisons.
        const bits=[...Array.from({length:8},(_,bit)=>(0xa5>>(7-bit))&1),
          ...Array.from({length:16},(_,bit)=>(index>>(15-bit))&1),
          ...Array.from({length:16},(_,bit)=>((index^0xffff)>>(15-bit))&1)];
        const ctx=canvas.getContext('2d');ctx.save();ctx.setTransform(1,0,0,1,0,0);
        bits.forEach((bit,column)=>{ctx.fillStyle=bit?'#ffffff':'#000000';ctx.fillRect(column*8,canvas.height-8,8,8);});
        ctx.restore();run.lastRenderAt=performance.now();run.instrumentationMs+=performance.now()-instrumentStart;
      }});
    run.finishedAt=performance.now();run.blobType=blob?.type;run.blobBytes=blob?.size;
    return blob;
  };
  for(const [namespace,name] of [[window.WSBDashboardMP4,'buildBlob']]){
    if(!namespace?.[name])continue;
    const original=namespace[name];
    namespace[name]=(...args)=>{const before=performance.now();try{return original(...args);}finally{if(F.run)F.run.muxMs+=performance.now()-before;}};
  }
})();
"""

PROBE = r"""
(async(width,height)=>{
  const E=window.WSBDashboardExport,results=[];
  // Match Patoshi's actual pixel-based bitrate instead of probing a fixed
  // 720p AVC level (which cannot describe the requested 4K output).
  const bitrate=Math.max(4000000,Math.round(width*height*30*.16));
  const avc=await E.getSupportedMp4Config(width,height,{quality:height},{fps:30,getBitrate:()=>bitrate});
  results.push({codec:'avc1 (selected level)',supported:!!avc,config:avc});
  for(const codec of ['vp09.00.10.08','vp8']){
    const config={codec,width,height,framerate:30,bitrate,latencyMode:'quality'};
    try{const result=await VideoEncoder.isConfigSupported(config);results.push({codec,supported:result.supported,config:result.config});}
    catch(error){results.push({codec,supported:false,error:String(error)});}
  }
  return{userAgent:navigator.userAgent,platform:navigator.platform,hardwareConcurrency:navigator.hardwareConcurrency,
    deviceMemory:navigator.deviceMemory,videoEncoder:!!window.VideoEncoder,configs:results,
    output:{width,height},screen:{width:innerWidth,height:innerHeight,dpr:devicePixelRatio}};
})
"""


def run_command(args, **kwargs):
    return subprocess.run(args, check=True, capture_output=True, **kwargs)


def run_verification(args, label, *, text=False):
    """Spool diagnostic/metadata output while reporting long decode progress."""
    started = time.perf_counter()
    print(f"{label}: started", flush=True)
    with tempfile.TemporaryFile() as stdout, tempfile.TemporaryFile() as stderr:
        process = subprocess.Popen(args, stdout=stdout, stderr=stderr)
        last_report = started
        while process.poll() is None:
            now = time.perf_counter()
            if now - last_report >= 15:
                print(f"{label}: {now - started:.1f}s elapsed", flush=True)
                last_report = now
            time.sleep(.25)
        stdout.seek(0)
        stderr.seek(0)
        result = subprocess.CompletedProcess(args, process.returncode, stdout.read(), stderr.read())
    if text:
        result.stdout, result.stderr = result.stdout.decode(), result.stderr.decode()
    result.check_returncode()
    print(f"{label}: finished in {time.perf_counter() - started:.1f}s", flush=True)
    return result


def epoch_ms(value):
    return int(datetime.fromisoformat(value).replace(tzinfo=timezone.utc).timestamp() * 1000)


def expected_plan(end):
    start_ms, end_ms = epoch_ms(START), epoch_ms(end)
    return [start_ms] * 30 + list(range(start_ms, end_ms, FRAME_SHIFT_MS)) + [end_ms] * 91


def process_tree_rss(root_pid):
    """Include renderer/GPU/helper processes; this is RSS, not JS heap alone."""
    processes = {}
    for line in run_command(["ps", "-axo", "pid=,ppid=,rss="], text=True).stdout.splitlines():
        pid, parent, kib = map(int, line.split())
        processes[pid] = (parent, kib * 1024)
    included = {root_pid}
    while True:
        extended = included | {pid for pid, (parent, _) in processes.items() if parent in included}
        if extended == included:
            break
        included = extended
    return sum(processes.get(pid, (0, 0))[1] for pid in included)


class MemorySampler:
    """Sample independently of CDP, including blocked mux/download intervals."""

    def __init__(self, pid, path):
        self.pid, self.path = pid, path
        self.started = time.perf_counter()
        self.samples = [{"seconds": 0, "rss_bytes": process_tree_rss(pid)}]
        self.stopped = threading.Event()
        self.thread = threading.Thread(target=self._sample, daemon=True)

    def start(self):
        self.thread.start()

    def _sample(self):
        with self.path.open("w") as log:
            log.write(json.dumps(self.samples[0]) + "\n")
            log.flush()
            while not self.stopped.wait(.5):
                try:
                    sample = {"seconds": time.perf_counter() - self.started,
                        "rss_bytes": process_tree_rss(self.pid)}
                    self.samples.append(sample)
                    log.write(json.dumps(sample) + "\n")
                    log.flush()
                except Exception as error:
                    log.write(json.dumps({"seconds": time.perf_counter() - self.started, "error": str(error)}) + "\n")
                    log.flush()

    def stop(self):
        self.stopped.set()
        self.thread.join(timeout=5)
        assert not self.thread.is_alive(), "Memory sampler did not stop"
        self.samples.append({"seconds": time.perf_counter() - self.started,
            "rss_bytes": process_tree_rss(self.pid)})
        with self.path.open("a") as log:
            log.write(json.dumps(self.samples[-1]) + "\n")


def frozen_patoshi():
    directory = ROOT / "webapps/patoshi_pattern/webapp_data"
    # A background data publication is allowed to finish; never rewrite it.
    for _ in range(4):
        marker = (directory / "patoshi_metadata.json").read_bytes()
        payload = (directory / "patoshi_blocks.csv").read_bytes()
        metadata = json.loads(marker)
        if marker == (directory / "patoshi_metadata.json").read_bytes() and hashlib.sha256(payload).hexdigest() == metadata["data_sha256"]:
            return {
                "/webapps/patoshi_pattern/webapp_data/patoshi_metadata.json": marker,
                "/webapps/patoshi_pattern/webapp_data/patoshi_blocks.csv": payload,
            }, metadata
        time.sleep(.25)
    raise AssertionError("Patoshi publication did not settle; no files were changed")


def set_controls(cdp, end, quality):
    cdp.evaluate(f"""(() => {{
      document.querySelector('#stopBtn').click();
      for(const [id,value] of [['startInput',{json.dumps(START)}],['endInput',{json.dumps(end)}]]){{
        const input=document.getElementById(id);input.value=value;input.dispatchEvent(new Event('change',{{bubbles:true}}));
      }}
      const days=document.getElementById('windowDaysInput');days.value='1';days.dispatchEvent(new Event('input',{{bubbles:true}}));days.dispatchEvent(new Event('change',{{bubbles:true}}));
      for(const [id,value] of [['downloadOrientationSelect','landscape'],['downloadQualitySelect',{json.dumps(str(quality))}],['downloadSpeedSelect','1'],['downloadThemeSelect','dark']]){{
        document.querySelector('#'+id+' [data-value="'+value+'"]').click();
      }}
      const hold=document.getElementById('downloadEndFrameHoldToggle');if(!hold.checked)hold.click();
    }})()""")
    controls = cdp.evaluate("({start:document.querySelector('#startInput').value,end:document.querySelector('#endInput').value,days:document.querySelector('#windowDaysInput').value})")
    assert controls["start"] == START and controls["end"] == end and float(controls["days"]) == 1, controls


def assert_accounting(record, plan, dimensions):
    assert record["plan"] == plan, "Actual dashboard planner differs from independent schedule"
    assert record["rendered"] == plan, "Rendered source states omitted, repeated, or reordered"
    count = len(plan)
    assert len(record["input"]) == count == len(record["output"]), "Encoder input/output frame count differs"
    timestamps = [math.floor(index * 1_000_000 / FPS + .5) for index in range(count + 1)]
    assert [frame["timestamp"] for frame in record["input"]] == timestamps[:-1]
    assert [frame["duration"] for frame in record["input"]] == [b - a for a, b in zip(timestamps, timestamps[1:])]
    assert sorted(frame["timestamp"] for frame in record["output"]) == timestamps[:-1]
    if record["blobType"] == "video/mp4":
        assert [frame["timestamp"] for frame in record["output"]] == timestamps[:-1]
    assert all(frame["bytes"] > 0 for frame in record["output"])
    assert record["output"][0]["type"] == "key"
    assert record["progressValues"] == sorted(record["progressValues"])
    assert record["progressValues"][-1] == 1 and all(value < 1 for value in record["progressValues"][:-1])
    assert (record["width"], record["height"], record["fps"]) == (*dimensions, FPS)
    assert len(set(record["sourceSignatures"][:31])) == 1, "Opening source hold changed"
    assert len(set(record["sourceSignatures"][-91:])) == 1, "Ending source hold changed"
    assert len(set(record["sourceSignatures"])) > 10, "The moving source chart remained frozen"


def verify_video(path, count, ffmpeg, ffprobe, output, dimensions):
    width, height = dimensions
    started = time.perf_counter()
    probe = json.loads(run_verification([ffprobe, "-v", "error", "-count_frames", "-show_streams", "-show_format", "-show_frames",
        "-show_entries", "frame=best_effort_timestamp_time,pkt_duration_time:stream:format", "-of", "json", str(path)], f"{path.stem}: probe all frames", text=True).stdout)
    frames = probe.pop("frames")
    streams = probe["streams"]
    assert len(streams) == 1 and streams[0]["codec_type"] == "video", probe
    stream = streams[0]
    assert (stream["width"], stream["height"], int(stream["nb_read_frames"])) == (width, height, count), probe
    assert stream["pix_fmt"] == "yuv420p", stream
    if path.suffix == ".mp4":
        assert stream["codec_name"] == "h264" and "Baseline" in stream["profile"], stream
        assert stream["codec_tag_string"] == "avc1", stream
        atoms = []
        with path.open("rb") as media:
            while header := media.read(8):
                assert len(header) == 8
                size, kind = struct.unpack(">I4s", header)
                header_bytes = 8
                if size == 1:
                    size = struct.unpack(">Q", media.read(8))[0]
                    header_bytes += 8
                assert size >= header_bytes
                atoms.append(kind.decode("ascii"))
                media.seek(size - header_bytes, 1)
        assert atoms[0] == "ftyp" and atoms.index("moov") < atoms.index("mdat"), atoms
    else:
        assert stream["codec_name"] in ("vp9", "vp8"), stream
    rate_numerator, rate_denominator = map(int, stream["avg_frame_rate"].split("/"))
    assert abs(rate_numerator / rate_denominator - FPS) < .001, stream
    numerator, denominator = map(int, stream["time_base"].split("/"))
    tick = numerator / denominator
    assert abs(float(probe["format"]["duration"]) - count / FPS) <= max(tick, 1e-6), probe
    assert len(frames) == count
    times = [float(frame["best_effort_timestamp_time"]) for frame in frames]
    assert all(right > left for left, right in zip(times, times[1:])), "Decoded timestamps are not strictly increasing"
    assert all(abs(value - index / FPS) <= tick + 1e-6 for index, value in enumerate(times)), "Decoded timestamp drift/gaps"
    (output / (path.stem + "-timestamps.json")).write_text(json.dumps(frames))
    # Decode the strip from EVERY frame. Forty averaged cells occupy only forty
    # output bytes per frame, so verification does not retain full RGBA frames.
    marker_count, minimum_contrast = 0, 255
    last_report = time.perf_counter()
    print(f"{path.stem}: decoding every frame identity", flush=True)
    with tempfile.TemporaryFile() as errors:
        process = subprocess.Popen([ffmpeg, "-nostdin", "-v", "error", "-i", str(path), "-vf",
            f"crop=320:8:0:{height - 8},scale=40:1:flags=area,format=gray", "-fps_mode", "passthrough",
            "-f", "rawvideo", "-pix_fmt", "gray", "pipe:1"], stdout=subprocess.PIPE, stderr=errors)
        try:
            while cells := process.stdout.read(40):
                index = marker_count
                assert len(cells) == 40 and index < count, "Unexpected decoded frame count/size"
                bits = [value >= 128 for value in cells]
                integer = lambda items: sum(int(bit) << (len(items) - offset - 1) for offset, bit in enumerate(items))
                assert integer(bits[:8]) == 0xa5, f"Frame {index}: marker sync failed"
                assert integer(bits[8:24]) == index, f"Frame {index}: missing/duplicated/reordered decoded picture"
                assert integer(bits[24:]) == (index ^ 0xffff), f"Frame {index}: marker checksum failed"
                minimum_contrast = min(minimum_contrast, min(abs(value - 128) for value in cells))
                marker_count += 1
                now = time.perf_counter()
                if now - last_report >= 15:
                    print(f"{path.stem}: {marker_count:,}/{count:,} decoded identities verified", flush=True)
                    last_report = now
            returncode = process.wait()
            errors.seek(0)
            assert returncode == 0, errors.read().decode()
        finally:
            process.stdout.close()
            if process.poll() is None:
                process.kill()
                process.wait()
    assert marker_count == count, (marker_count, count)
    return {"probe": probe, "decoded_frames_verified": count, "minimum_marker_threshold_distance": minimum_contrast,
            "max_pts_error_seconds": max(abs(value - index / FPS) for index, value in enumerate(times)),
            "verification_seconds": time.perf_counter() - started}


def quality_metrics(source, decoded, ffmpeg, crop):
    metrics = {}
    for name in ("ssim", "psnr"):
        result = run_command([ffmpeg, "-nostdin", "-hide_banner", "-i", str(source), "-i", str(decoded),
            "-filter_complex", f"[0:v]crop={crop},format=yuv420p[a];[1:v]crop={crop},format=yuv420p[b];[a][b]{name}",
            "-frames:v", "1", "-f", "null", "-"], text=True)
        pattern = r"All:([0-9.]+)" if name == "ssim" else r"average:([0-9.]+|inf)"
        matches = re.findall(pattern, result.stderr)
        assert matches, result.stderr
        metrics[name] = float(matches[-1])
    # Deliberately broad corruption guards; report actual measurements and
    # compare both codecs, rather than claiming a lossy encoding is identical.
    assert metrics["ssim"] >= .90 and metrics["psnr"] >= 28, metrics
    return metrics


def sampled_quality(path, samples, output, ffmpeg, dimensions):
    width, height = dimensions
    scale = height / 720
    crops = {"full": f"{width}:{height - 8}:0:0",
        "header": f"{width}:{round(92 * scale)}:0:{round(20 * scale)}",
        "footer": f"{width}:{round(80 * scale)}:0:{round(632 * scale)}"}
    metrics = []
    indices = sorted(map(int, samples))
    selection = "+".join(f"eq(n\\,{index})" for index in indices)
    # One pass through the full video, rather than decoding separately up to
    # every selected index (which is costly for the ten-minute fixture).
    with tempfile.TemporaryDirectory(prefix="wsb-video-samples-") as extracted:
        run_verification([ffmpeg, "-nostdin", "-v", "error", "-y", "-i", str(path), "-vf", f"select={selection}",
            "-fps_mode", "passthrough", "-frames:v", str(len(indices)), str(Path(extracted) / "%02d.png")], f"{path.stem}: extract six quality samples")
        for order, index in enumerate(indices, 1):
            decoded = output / f"{path.stem}-decoded-{index:05d}.png"
            shutil.move(Path(extracted) / f"{order:02d}.png", decoded)
    for index in indices:
        data = samples[str(index)]
        source = output / f"{path.stem}-source-{int(index):05d}.png"
        decoded = output / f"{path.stem}-decoded-{int(index):05d}.png"
        source.write_bytes(base64.b64decode(data))
        metrics.append({"index": int(index), "source": str(source), "decoded": str(decoded), **quality_metrics(source, decoded, ffmpeg, crops["full"]),
            "regions": {"header": quality_metrics(source, decoded, ffmpeg, crops["header"]),
                "footer": quality_metrics(source, decoded, ffmpeg, crops["footer"])}})
    return metrics


def export_case(cdp, chrome, output, mode, long, ffmpeg, ffprobe, quality):
    dimensions = QUALITIES[quality]
    end = LONG_END if long else SHORT_END
    name = f"patoshi-{'long' if long else 'short'}-{mode}"
    assert not list(output.glob(name + ".*")), f"Choose a fresh output directory; {name} already exists"
    plan = expected_plan(end)
    set_controls(cdp, end, quality)
    cdp.evaluate(f"__videoTest.run={{name:{json.dumps(name)},mode:{json.dumps(mode)},input:[],output:[],rendered:[],sourceSignatures:[],samples:{{}},progressValues:[],renderMs:0,instrumentationMs:0,muxMs:0,encodedBytes:0}};__videoTest.errors=[];")
    sampler = MemorySampler(chrome.pid, output / (name + "-rss.jsonl"))
    sampler.start()
    started = time.perf_counter()
    memory, last_report = [], 0
    deadline = started + (3600 if long else 300)
    try:
        cdp.evaluate("document.querySelector('#downloadBtn').click()")
        while time.perf_counter() < deadline:
            status = cdp.evaluate("({errors:__videoTest.errors,download:__videoTest.run.downloadName||null,progress:__videoTest.run.progress||0,inputs:__videoTest.run.input.length,outputs:__videoTest.run.output.length,bytes:__videoTest.run.encodedBytes,heap:performance.memory?{used:performance.memory.usedJSHeapSize,total:performance.memory.totalJSHeapSize,limit:performance.memory.jsHeapSizeLimit}:null})")
            elapsed = time.perf_counter() - started
            memory.append({"seconds": elapsed, **status})
            if status["errors"]:
                raise AssertionError(status)
            if status["download"]:
                path = output / status["download"]
                if path.is_file() and not list(output.glob(name + "*.crdownload")):
                    break
            if elapsed - last_report >= 15:
                print(f"{name} {quality}p: {status['inputs']:,}/{len(plan):,} frames submitted, {status['outputs']:,} received, {elapsed:.1f}s, RSS {sampler.samples[-1]['rss_bytes']/1024**2:.0f}MiB", flush=True)
                last_report = elapsed
            time.sleep(.5)
        else:
            raise TimeoutError(f"{name} export timed out")
        wall = time.perf_counter() - started
    except Exception as error:
        failure = {"error": str(error), "elapsed_seconds": time.perf_counter() - started,
            "quality": quality, "dimensions": dimensions, "observations": memory}
        try:
            failure["record"] = cdp.evaluate("__videoTest.run")
        except Exception as diagnostic_error:
            failure["diagnostic_error"] = str(diagnostic_error)
        (output / (name + "-failure.json")).write_text(json.dumps(failure))
        raise
    finally:
        sampler.stop()
        (output / (name + "-memory.json")).write_text(json.dumps({"rss_samples": sampler.samples, "browser_observations": memory}))
    record = cdp.evaluate("__videoTest.run")
    samples = record.pop("samples")
    (output / (name + "-accounting.json")).write_text(json.dumps(record))
    # Save expensive evidence before any assertions or lengthy full-file decode.
    for index, data in samples.items():
        (output / f"{name}-source-{int(index):05d}.png").write_bytes(base64.b64decode(data))
    peak_rss = max(item["rss_bytes"] for item in sampler.samples)
    baseline_rss = sampler.samples[0]["rss_bytes"]
    result = {"path": str(path), "bytes": path.stat().st_size, "frames": len(plan), "duration_seconds": len(plan) / FPS,
        "quality": quality, "dimensions": dimensions,
        "wall_export_seconds": wall, "browser_export_seconds": (record["finishedAt"] - record["startedAt"]) / 1000,
        "render_seconds": record["renderMs"] / 1000, "mux_seconds": record["muxMs"] / 1000,
        "test_instrumentation_seconds": record["instrumentationMs"] / 1000,
        "baseline_process_tree_rss_bytes": baseline_rss, "peak_process_tree_rss_bytes": peak_rss,
        "peak_process_tree_rss_growth_bytes": peak_rss - baseline_rss,
        "final_process_tree_rss_bytes": sampler.samples[-1]["rss_bytes"],
        "rss_sampling_interval_seconds": .5,
        "peak_js_heap_bytes": max((item["heap"]["used"] for item in memory if item["heap"]), default=None),
        "encoder_config": record["config"], "verification_status": "pending"}
    result_path = output / (name + "-result.json")
    result_path.write_text(json.dumps(result, indent=2))
    print(f"{name}: download complete in {wall:.2f}s; {path.stat().st_size/1e6:.2f}MB; baseline/peak RSS {baseline_rss/1024**3:.2f}/{peak_rss/1024**3:.2f}GiB. Starting full verification.", flush=True)
    try:
        assert samples["0"] == samples["30"], "Opening source PNG changed across its hold"
        assert samples[str(len(plan) - 91)] == samples[str(len(plan) - 1)], "Ending source PNG changed across its hold"
        assert_accounting(record, plan, dimensions)
        assert record["blobType"] == ("video/mp4" if mode == "mp4" else "video/webm"), record["config"]
        assert path.stat().st_size == record["blobBytes"]
        assert cdp.evaluate("!document.querySelector('#downloadBtn').disabled&&!document.querySelector('#downloadBtn').classList.contains('is-exporting')"), "Export controls did not recover"
        result["verification"] = verify_video(path, len(plan), ffmpeg, ffprobe, output, dimensions)
        result["verification_status"] = "frames_verified_quality_pending"
        result_path.write_text(json.dumps(result, indent=2))
        result["sampled_quality"] = sampled_quality(path, samples, output, ffmpeg, dimensions)
        result["verification_status"] = "passed"
    except Exception as error:
        result["verification_status"] = "failed"
        result["verification_error"] = str(error)
        raise
    finally:
        result_path.write_text(json.dumps(result, indent=2))
    print(f"{name}: {len(plan):,} decoded frame identities and timestamps verified; {wall:.2f}s export, {path.stat().st_size/1e6:.2f}MB", flush=True)
    return result


def verify_cancel(cdp, output, quality):
    """Cancel the real renderer/encoder, then let normal cases prove recovery."""
    set_controls(cdp, SHORT_END, quality)
    cdp.evaluate("__videoTest.run={name:'patoshi-canceled',mode:'mp4',input:[],output:[],rendered:[],sourceSignatures:[],samples:{},progressValues:[],renderMs:0,instrumentationMs:0,muxMs:0,encodedBytes:0};__videoTest.errors=[];document.querySelector('#downloadBtn').click();")
    wait_for(lambda: cdp.evaluate("__videoTest.run.input.length>=12"), description="frames before cancellation")
    cdp.evaluate("document.querySelector('#downloadBtn').click()")
    wait_for(lambda: cdp.evaluate("!document.querySelector('#downloadBtn').classList.contains('is-exporting')"), description="export cancellation")
    status = cdp.evaluate("({inputs:__videoTest.run.input.length,outputs:__videoTest.run.output.length,download:__videoTest.run.downloadName||null,errors:__videoTest.errors,disabled:document.querySelector('#downloadBtn').disabled,progress:__videoTest.run.progress||0})")
    assert not status["download"] and not status["errors"] and not status["disabled"], status
    assert 0 < status["outputs"] <= status["inputs"] < len(expected_plan(SHORT_END)), status
    assert status["progress"] < 1 and not list(output.glob("patoshi-canceled*")), status
    (output / "cancellation.json").write_text(json.dumps(status, indent=2))
    print(f"Cancellation: {status['inputs']} submitted frames discarded; no file downloaded and controls recovered", flush=True)


def compare_codecs(results, output, ffmpeg):
    by_codec = {Path(result["path"]).suffix: result for result in results}
    if not all(codec in by_codec for codec in (".mp4", ".webm")):
        return None
    mp4, webm = by_codec[".mp4"], by_codec[".webm"]
    assert mp4["frames"] == webm["frames"]
    assert mp4["dimensions"] == webm["dimensions"]
    width, height = mp4["dimensions"]
    accounting = [json.loads((output / (Path(item["path"]).stem + "-accounting.json")).read_text()) for item in (mp4, webm)]
    assert accounting[0]["plan"] == accounting[1]["plan"]
    assert accounting[0]["sourceSignatures"] == accounting[1]["sourceSignatures"], "Codec runs rendered different source thumbnails"
    for left, right in zip(mp4["sampled_quality"], webm["sampled_quality"]):
        assert left["index"] == right["index"]
        assert Path(left["source"]).read_bytes() == Path(right["source"]).read_bytes(), "Selected original source PNGs differ between codecs"
    stats = output / (Path(mp4["path"]).stem + "-vs-vp9-ssim.txt")
    result = run_command([ffmpeg, "-nostdin", "-hide_banner", "-i", mp4["path"], "-i", webm["path"],
        "-filter_complex", f"[0:v]crop={width}:{height - 8}:0:0,settb=1/30,setpts=N[a];[1:v]crop={width}:{height - 8}:0:0,settb=1/30,setpts=N[b];[a][b]ssim=stats_file={stats}:shortest=1",
        "-f", "null", "-"], text=True)
    values = [float(value) for value in re.findall(r"All:([0-9.]+)", stats.read_text())]
    assert len(values) == mp4["frames"]
    assert min(values) >= .90, min(values)
    comparison = {"frames_compared": len(values), "minimum_ssim": min(values), "mean_ssim": sum(values) / len(values),
        "all_source_thumbnail_signatures_match": True, "selected_source_pngs_identical": True,
        "p01_ssim": sorted(values)[max(0, math.floor(len(values) * .01) - 1)],
        "mp4_vs_webm_wall_time_ratio": mp4["wall_export_seconds"] / webm["wall_export_seconds"],
        "mp4_vs_webm_size_ratio": mp4["bytes"] / webm["bytes"], "stats_file": str(stats),
        "note": "Lossy codec comparison over all decoded chart pixels, excluding the test strip; source-relative quality is measured separately at selected frames."}
    (output / "codec-comparison.json").write_text(json.dumps(comparison, indent=2))
    return comparison


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--long", action="store_true", help="Run the complete 10m34s, 19,021-frame export")
    parser.add_argument("--quality", type=int, choices=tuple(QUALITIES), default=720, help="Landscape video height; 2160 renders native 3840 × 2160")
    parser.add_argument("--codecs", nargs="+", choices=("mp4", "webm", "fallback"), default=["mp4", "webm"],
        help="fallback makes AVC capability probing fail, then verifies the default encoder produces genuine WebM")
    parser.add_argument("--probe-only", action="store_true")
    parser.add_argument("--test-cancel", action="store_true", help="Cancel a real export before the normal cases, verifying recovery")
    parser.add_argument("--output-dir", default="/tmp/wsb-video-export-review")
    args = parser.parse_args()
    output = Path(args.output_dir).resolve()
    output.mkdir(parents=True, exist_ok=True)
    ffmpeg, ffprobe = shutil.which("ffmpeg"), shutil.which("ffprobe")
    if not Path(CHROME).is_file() or not ffmpeg or not ffprobe:
        raise SystemExit("Chrome, ffmpeg and ffprobe are required; set CHROME_BIN/PATH as needed")
    FrozenHandler.snapshot, metadata = frozen_patoshi()
    port, debug = free_port(), free_port()
    server = ThreadingHTTPServer(("127.0.0.1", port), lambda *a, **kw: FrozenHandler(*a, directory=str(ROOT), **kw))
    threading.Thread(target=server.serve_forever, daemon=True).start()
    with tempfile.TemporaryDirectory(prefix="wsb-video-export-profile-") as profile:
        flags = ["--headless=new", "--remote-allow-origins=*", "--no-first-run", "--disable-background-networking", "--enable-precise-memory-info",
            f"--remote-debugging-port={debug}", f"--user-data-dir={profile}", "about:blank"]
        chrome = subprocess.Popen([CHROME, *flags], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        try:
            wait_for(lambda: urllib.request.urlopen(f"http://127.0.0.1:{debug}/json/version", timeout=.5).read(), description="isolated Chrome")
            target = json.load(urllib.request.urlopen(urllib.request.Request(f"http://127.0.0.1:{debug}/json/new?about:blank", method="PUT")))
            cdp = CdpSocket(target["webSocketDebuggerUrl"])
            cdp.command("Page.enable")
            cdp.command("Runtime.enable")
            cdp.command("Network.enable")
            cdp.command("Network.setBlockedURLs", {"urls": ["https://*", "wss://*"]})
            cdp.command("Browser.setDownloadBehavior", {"behavior": "allow", "downloadPath": str(output), "eventsEnabled": True})
            cdp.command("Emulation.setDeviceMetricsOverride", {"width": 1440, "height": 1000, "deviceScaleFactor": 1, "mobile": False})
            cdp.command("Page.addScriptToEvaluateOnNewDocument", {"source": SHIM})
            cdp.command("Page.navigate", {"url": f"http://127.0.0.1:{port}/webapps/patoshi_pattern/dashboard.html"})
            wait_for(lambda: cdp.evaluate("!!document.querySelector('#startInput')?.value&&document.querySelector('#loadingRing')?.style.display==='none'&&!!window.WSBDashboardExport"), timeout=60, description="Patoshi initialized")
            # The application normally gets this family from Google Fonts.
            # Bind its bundled Medium face locally so network-isolated tests
            # exercise the chart's real family rather than a serif fallback.
            cdp.evaluate("(async()=>{const face=new FontFace('IBM Plex Mono','url(/webapps/shared/export_assets/IBMPlexMono-Medium.ttf)',{weight:'500'});await face.load();document.fonts.add(face);await document.fonts.ready;})()")
            environment = {"platform": platform.platform(), "chrome_path": CHROME, "chrome_flags": flags,
                "probe": cdp.evaluate(f"{PROBE}({QUALITIES[args.quality][0]},{QUALITIES[args.quality][1]})"), "metadata": metadata,
                "quality": args.quality, "dimensions": QUALITIES[args.quality],
                "source_sha256": {str(path.relative_to(ROOT)): hashlib.sha256(path.read_bytes()).hexdigest() for path in
                    [Path(__file__).resolve(), ROOT / "webapps/patoshi_pattern/dashboard_app.js", ROOT / "webapps/shared/dashboard_export.js", ROOT / "webapps/shared/dashboard_mp4.js"]},
                "ffmpeg": run_command([ffmpeg, "-version"], text=True).stdout.splitlines()[0],
                "font_fixture": "IBM Plex Mono uses the repository's bundled Medium face; browser weight matching/synthesis supplies other requested weights. Google Fonts and all external requests are blocked.",
                "memory_note": "RSS sums isolated Chrome process tree; JS heap excludes native codec/GPU allocations. Headless Chrome keeps GPU enabled; configured acceleration preference is not proof of actual hardware use."}
            (output / "environment.json").write_text(json.dumps(environment, indent=2))
            print(environment["probe"]["userAgent"], flush=True)
            print("Encoder support: " + ", ".join(f"{config['codec']}={config['supported']}" for config in environment["probe"]["configs"]), flush=True)
            if not args.probe_only:
                cdp.evaluate(INSTALL)
                if args.test_cancel:
                    verify_cancel(cdp, output, args.quality)
                results = [export_case(cdp, chrome, output, mode, args.long, ffmpeg, ffprobe, args.quality) for mode in args.codecs]
                comparison = compare_codecs(results, output, ffmpeg)
                (output / "results.json").write_text(json.dumps({"exports": results, "comparison": comparison}, indent=2))
            cdp.sock.close()
        finally:
            chrome.terminate()
            chrome.wait(timeout=15)
            server.shutdown()


if __name__ == "__main__":
    main()
