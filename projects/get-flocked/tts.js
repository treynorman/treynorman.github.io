/**
 * tts.js — the browser-side TTS engine.
 *
 * This is the sanoTTS engine from `references/sanoTTS-web`, wired up for
 * this app. The split is the same as in the reference:
 *
 *   text -> phoneme ids -> (chunked) -> worker -> waveform -> WAV
 *
 * The page owns the phonemizer (espeak-ng in WebAssembly) and the worker
 * owns the model. The worker does the expensive arithmetic, so the page
 * stays responsive while a clip is being generated.
 *
 * The engine runs entirely in the browser: the model weights are fetched
 * from `tts/model/`, the phonemizer from `tts/vendor/`, and the synthesis
 * happens in a Web Worker. Nothing is sent to a server and no build step
 * is involved.
 */

import { loadG2P } from './tts/lib/g2p.js';
import { encodeWav } from './tts/lib/audio.js';
import { planChunks } from './tts/lib/chunking.js';

/**
 * Resolve a path relative to this module, so the app works from any mount.
 *
 * The paths in config.js are relative to the app directory, which is where
 * this file lives -- so they resolve the same way no matter which page
 * loaded it.
 */
function assetUrl(path) {
  return new URL(path, import.meta.url).href;
}

export class TtsEngine {
  constructor({ modelDir, vendorDir, worker, speed }) {
    this.modelDir = modelDir;
    this.vendorDir = vendorDir;
    this.workerUrl = worker;
    this.speed = speed;
    this.phonemizer = null;
    this.worker = null;
    this.info = null;
    this.maxTokens = 265;
    this.pending = new Map();
    this.nextRequestId = 1;
    this.booting = null;
    // The worker keeps the model in one place, so two syntheses must not
    // run at the same time; they are chained here instead.
    this.queue = Promise.resolve();
  }

  /**
   * Load the phonemizer and the model.
   *
   * The model is ~2 MB of weights, so this takes a moment; it happens while
   * the browser is asking for camera permission, which is exactly the
   * delay the app wants to use. Calling this more than once is safe: the
   * same load is shared.
   */
  boot() {
    if (!this.booting) this.booting = this.#load();
    return this.booting;
  }

  async #load() {
    this.phonemizer = await loadG2P(assetUrl(this.vendorDir));

    this.worker = new Worker(assetUrl(this.workerUrl), { type: 'module' });
    this.worker.onmessage = (event) => {
      const { type, id } = event.data;
      const entry = this.pending.get(id);
      if (!entry) return;
      this.pending.delete(id);
      if (type === 'error') entry.reject(new Error(event.data.message));
      else entry.resolve(event.data);
    };
    this.worker.onerror = (event) => {
      console.error('[combo] tts worker failed:', event.message);
      for (const entry of this.pending.values()) entry.reject(new Error(event.message));
      this.pending.clear();
    };

    const reply = await this.ask({ type: 'load', modelBaseUrl: assetUrl(this.modelDir) });
    this.info = reply.info;

    // Pick the espeak-ng id table this model was trained against.
    const slot = this.phonemizer.resolveSlot({
      espeakVoice: this.info.espeakVoice,
      entries: this.info.phonemeEntries,
    });
    this.phonemizer.selectVoice(this.info.espeakVoice, slot);
    this.maxTokens = this.info.maxTokens;
    return this.info;
  }

  /** Talk to the worker and await the reply for a given request id. */
  ask(message, transfer = []) {
    const id = this.nextRequestId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.worker.postMessage({ ...message, id }, transfer);
    });
  }

  /**
   * Synthesize a sentence.
   *
   * Calls are serialized: the worker holds the model in one piece of
   * memory, so overlapping syntheses would corrupt each other.
   *
   * @param {string} text
   * @param {number} [speed]  speaking rate; 1.0 is the trained rate
   * @returns {Promise<{blob: Blob, url: string, seconds: number}>}
   */
  synthesize(text, speed = this.speed) {
    const run = this.queue.then(() => this.#synthesize(text, speed));
    // The chain must not break when one synthesis fails.
    this.queue = run.catch(() => {});
    return run;
  }

  async #synthesize(text, speed) {
    await this.boot();

    const chunks = planChunks(
      text,
      this.phonemizer.phonemize(text),
      (piece) => this.phonemizer.phonemize(piece),
      this.maxTokens,
    );
    if (!chunks.length) throw new Error('nothing to synthesize');

    // Each chunk is transferred to the worker, which detaches it here, so
    // the buffers have to be copied out before the transfer.
    const buffers = chunks.map((ids) => ids.slice().buffer);
    const result = await this.ask(
      { type: 'synthesize', chunks: buffers, speed: Number(speed) },
      buffers,
    );

    const samples = new Float32Array(result.audio);
    const blob = encodeWav(samples, result.sampleRate);
    return {
      blob,
      url: URL.createObjectURL(blob),
      seconds: samples.length / result.sampleRate,
    };
  }
}
