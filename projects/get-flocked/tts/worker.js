/**
 * worker.js — the synthesis worker.
 *
 * The decoder is the expensive part: a few seconds of arithmetic for a few
 * seconds of audio. Running it here keeps the page responsive -- the slider
 * and the button stay live, and the status line can report progress.
 *
 * The worker owns the model. It fetches the package at startup, widens the
 * fp16 weights to fp32 once, and then answers synthesis requests.
 *
 * The decoder runs on the GPU when WebGPU is available and falls back to the
 * JavaScript engine when it is not. Both produce the same audio; the GPU is
 * simply much faster.
 */

import { loadPackage } from './lib/model-package.js';
import { durationForward, acousticForward, decoderForward } from './lib/inference.js';
import { loadWasmDecoder } from './lib/wasm.js';
import { createGPUDecoder } from './lib/gpu.js';

let package_ = null;
let defaultLengthScale = 1.0;
let sampleRate = 22050;
let gpu = null;
let wasm = null;

/**
 * Load the voice package.
 *
 * Everything is fetched relative to the URL the page passes in, so the worker
 * works from any mount point without a rebuilt path.
 */
async function load(modelBaseUrl) {
  const pkg = await loadPackage(modelBaseUrl);
  package_ = pkg;
  defaultLengthScale = Number(pkg.manifest.inference?.duration_length_scale ?? 1.0);
  sampleRate = Number(pkg.manifest.sample_rate ?? 22050);

  // The GPU decoder needs the decoder's tensors and dims; a package whose
  // decoder uses a post filter is left to the CPU path, which implements it.
  const decoder = package_.tensors.decoder;
  let backend = 'cpu';

  if (!(decoder.config.post_filter_channels > 0)) {
    // The WebAssembly decoder is the fast CPU path. It is loaded from a
    // file next to the page, so it costs nothing when the browser has no
    // WebGPU and no SIMD support.
    try {
      wasm = await loadWasmDecoder(
        fetch(new URL('./wasm/snt_decoder.wasm', import.meta.url)));
      if (wasm) {
        wasm.loadDecoder(decoder.tensors, decoder.config);
        // The front end goes to WebAssembly too: it is a third of the work
        // and the same convolutions.
        wasm.loadDuration(package_.tensors.duration.tensors,
                          package_.tensors.duration.config);
        wasm.loadAcoustic(package_.tensors.acoustic.tensors,
                          package_.tensors.acoustic.config);
        backend = 'wasm';
      }
    } catch (error) {
      console.warn('wasm decoder: unavailable, using the JavaScript engine:', error);
      wasm = null;
    }

    try {
      gpu = await createGPUDecoder(decoder.tensors, decoder.config);
      if (gpu) backend = 'webgpu';
    } catch (error) {
      console.warn('gpu: unavailable, using the CPU engine:', error);
      gpu = null;
    }

    // Both backends are available, so time them and keep the faster one.
    // A GPU is usually much faster, but not always: a software adapter
    // (SwiftShader, or a GPU with no driver) is slower than the CPU, and
    // the measurement settles it either way.
    if (gpu && wasm) {
      let scores = null;
      try {
        scores = await calibrate(decoder.config);
      } catch (error) {
        console.warn('calibration failed, keeping the GPU:', error);
      }
      if (scores && scores.gpu >= scores.cpu) {
        // The GPU is no faster than the CPU, so drop it: every decode would
        // pay its setup cost for nothing.
        gpu = null;
        backend = 'wasm';
      } else if (scores) {
        backend = 'webgpu';
      }
    }
  }

  const parameters = Object.values(package_.manifest.components)
    .reduce((sum, c) => sum + (c.parameters || 0), 0);

  return {
    sampleRate,
    defaultLengthScale,
    parameters,
    backend,
    weightsSha256: package_.sha256,
    // The phonemizer runs on the main thread, so the page needs to know
    // which id table this package was trained against.
    espeakVoice: package_.phonemes.espeakVoice,
    phonemeEntries: package_.phonemes.entries,
    maxTokens: package_.maxTokens,
  };
}

/**
 * The backend in use, which the page shows.
 */
function currentBackend() {
  if (gpu && !gpu.lost) return 'webgpu';
  if (wasm) return 'wasm';
  return 'cpu';
}

/**
 * Time both decoders on a short synthetic latent.
 *
 * Returns the time each took, so the smaller one wins.
 */
async function calibrate(config) {
  const inCh = config.in_channels;
  const frames = 32;
  const latent = new Float32Array(inCh * frames);
  for (let i = 0; i < latent.length; i++) latent[i] = Math.sin(i * 0.01) * 0.1;

  const time = async (fn) => {
    const start = performance.now();
    await fn();
    return performance.now() - start;
  };

  // Warm both up first: the first call pays for shader compilation and
  // for the WebAssembly module's first touch of its memory.
  await time(() => gpu.decode(latent));
  await time(() => wasm.decode(latent, frames));

  const gpuMs = Math.min(
    await time(() => gpu.decode(latent)),
    await time(() => gpu.decode(latent)));
  const cpuMs = Math.min(
    await time(() => wasm.decode(latent, frames)),
    await time(() => wasm.decode(latent, frames)));

  console.log(`calibration: gpu ${gpuMs.toFixed(1)} ms, wasm ${cpuMs.toFixed(1)} ms`);
  // The score is the time each backend would take, so the smaller wins.
  return { gpu: gpuMs, cpu: cpuMs };
}

/**
 * Decode a latent on the CPU: WebAssembly when it loaded, else JavaScript.
 */
function decodeOnCpu(components, latent) {
  if (wasm) {
    const frames = latent.length / components.decoder.config.in_channels;
    const raw = wasm.decode(latent, frames);
    for (let i = 0; i < raw.length; i++) raw[i] = Math.tanh(raw[i]);
    return raw;
  }
  return decoderForward(
    components.decoder.tensors, components.decoder.config, latent);
}

/**
 * Synthesize one chunk of phoneme ids.
 *
 * `speed` is a multiplier on the model's native rate: 1.0 is the rate the
 * package was trained at, 2.0 is twice as fast. Piper expresses speech rate
 * as a duration multiplier, so a faster rate means a smaller one.
 */
async function render(ids, speed) {
  const lengthScale = defaultLengthScale / speed;
  const components = package_.tensors;

  let durations, latent;
  if (wasm && wasm.durationReady && wasm.acousticReady) {
    // The whole front end in WebAssembly: the durations come back as
    // integers and the latent stays in the module's memory.
    durations = wasm.durations(ids, lengthScale);
    let frames = 0;
    for (let i = 0; i < durations.length; i++) frames += durations[i];
    latent = wasm.latent(ids, durations, frames);
  } else {
    durations = durationForward(
      components.duration.tensors, components.duration.config, ids, lengthScale);
    latent = acousticForward(
      components.acoustic.tensors, components.acoustic.config, ids, durations);
  }

  let audio;
  if (gpu && !gpu.lost) {
    try {
      audio = await gpu.decode(latent);
    } catch (error) {
      console.warn('gpu: decode failed, falling back to the CPU engine:', error);
      gpu = null;
      audio = decodeOnCpu(components, latent);
    }
  } else {
    audio = decodeOnCpu(components, latent);
  }

  let frames = 0;
  for (let i = 0; i < durations.length; i++) frames += durations[i];
  return { audio, frames };
}

self.onmessage = async (event) => {
  const { type, id } = event.data;
  try {
    if (type === 'load') {
      const info = await load(event.data.modelBaseUrl);
      self.postMessage({ type: 'loaded', id, info });
      return;
    }
    if (type === 'synthesize') {
      // The chunks arrive already split: the page decides the split, because
      // it is the one that knows the phoneme count.
      const chunks = event.data.chunks.map((c) => new Int32Array(c));
      const speed = Number(event.data.speed);

      const parts = [];
      let frames = 0;
      for (const ids of chunks) {
        const { audio, frames: f } = await render(ids, speed);
        parts.push(audio);
        frames += f;
      }

      // Concatenate the chunks into one waveform.
      const total = parts.reduce((n, p) => n + p.length, 0);
      const out = new Float32Array(total);
      let at = 0;
      for (const p of parts) { out.set(p, at); at += p.length; }

      // The buffer is transferred rather than copied: it is the single
      // largest thing crossing the boundary.
      self.postMessage(
        { type: 'synthesized', id, audio: out.buffer, frames, sampleRate,
          chunks: chunks.length, backend: currentBackend() },
        [out.buffer]);
      return;
    }
    throw new Error(`unknown message type: ${type}`);
  } catch (error) {
    self.postMessage({ type: 'error', id, message: String(error && error.message || error) });
  }
};
