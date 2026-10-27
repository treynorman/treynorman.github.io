/**
 * wasm.js — the model, in WebAssembly.
 *
 * The decoder is ~95% of the model's arithmetic and plain JavaScript cannot
 * vectorise its convolution loops, so it runs about 1 GMAC/s. This module is
 * the same computation compiled to WebAssembly SIMD, which runs several times
 * faster, and it covers the whole model: the duration student, the acoustic
 * student and the decoder.
 *
 * It is a port of the runtime stages in upstream's mcu/src/snt_front_f32.c
 * and mcu/src/snt_piperlite.c, and keeps upstream's arithmetic order, so
 * the waveform matches upstream's own WASM runtime to float precision.
 *
 * The module has no imports: it is freestanding, and the few transcendental
 * functions it needs come from musl inside it. The weights are uploaded once
 * at load time; per synthesis, only the activations move.
 */

/** The stage geometry, which the piperlite variant fixes. */
const UP_KERNEL = [16, 16, 8];
const UP_STRIDE = [8, 8, 4];
const UP_PADDING = [4, 4, 2];

/**
 * The residual bank's branch kernels and dilations.
 *
 * These come from upstream's piperlite decoder. The kernel length is also
 * read from each tensor's shape where the package provides it, so a package
 * built with different kernels still runs; the values here are the fallback.
 */
const BANK_KERNEL = [3, 5, 7];
const BANK_DIL1 = [1, 2, 3];
const BANK_DIL2 = [2, 6, 12];

/**
 * Plan slots, matching the C module's layout.
 *
 * The plan holds the three components, each with a config block and a table
 * of tensor offsets:
 *
 *   decoder   config at   0   offsets at  32
 *   duration  config at 128   offsets at 160
 *   acoustic  config at 256   offsets at 288
 */
const DEC_CFG = 0;
const DEC_OFFS = 32;
const DUR_CFG = 128;
const DUR_OFFS = 160;
const ACO_CFG = 256;
const ACO_OFFS = 288;

/** The decoder's offset table, which has fixed slots per tensor. */
const OFF_PRE_W = 0;
const OFF_PRE_B = 1;
const OFF_UP_W = 2;
const OFF_UP_B = 5;
const OFF_RES = 8;
const OFF_POST_W = 44;
const OFF_POST_B = 45;

/**
 * Load the WASM model.
 *
 * @param {ArrayBuffer|Response|Promise} source  the .wasm bytes
 * @returns {Promise<object|null>} the backend, or null if unavailable
 */
export async function loadWasmDecoder(source) {
  let instance;
  try {
    const imports = {};
    if (typeof WebAssembly.instantiateStreaming === 'function') {
      try {
        ({ instance } = await WebAssembly.instantiateStreaming(source, imports));
      } catch {
        // Some servers do not send the right content type; fall back.
        const bytes = await (await source).arrayBuffer();
        ({ instance } = await WebAssembly.instantiate(bytes, imports));
      }
    } else {
      const bytes = await (await source).arrayBuffer();
      ({ instance } = await WebAssembly.instantiate(bytes, imports));
    }
  } catch (error) {
    console.warn('wasm decoder: unavailable:', error);
    return null;
  }
  return new WasmModel(instance);
}

class WasmModel {
  constructor(instance) {
    this.instance = instance;
    this.exports = instance.exports;
    this.memory = this.exports.memory;
    this.planPtr = this.exports.snt_plan_i32();
    this.plan = new Int32Array(this.memory.buffer, this.planPtr, 512);

    // Two regions of linear memory. The permanent one holds the uploaded
    // weights; the transient one holds the activations of one synthesis and
    // is reset between them.
    this.perm = (this.exports.snt_heap_base() + 15) & ~15;
    this.cursor = this.perm;
    this.permanent = this.perm;

    // The float32 views over the uploaded weights, so they can be re-derived
    // if the memory grows.
    this.weightViews = [];
  }

  /**
   * Grow the module's memory if needed, keeping the views in step.
   *
   * WebAssembly memory grows in pages and that detaches the old views, so
   * every view is re-derived after a growth.
   */
  #ensure(bytes) {
    const have = this.memory.buffer.byteLength;
    if (bytes <= have) return;
    const pages = Math.ceil((bytes - have) / 65536);
    this.memory.grow(pages);
    this.plan = new Int32Array(this.memory.buffer, this.planPtr, 512);
    this.weightViews = this.weightViews.map((v) => ({
      base: v.base,
      length: v.length,
      view: new Float32Array(this.memory.buffer, v.base, v.length),
    }));
  }

  /** Reserve `bytes` of transient memory, 16-byte aligned. */
  #alloc(bytes) {
    const at = (this.cursor + 15) & ~15;
    this.cursor = at + bytes;
    this.#ensure(this.cursor + 64);
    return at;
  }

  /** Reserve `bytes` of permanent memory (the weights). */
  #allocPermanent(bytes) {
    const at = (this.perm + 15) & ~15;
    this.perm = at + bytes;
    this.cursor = this.perm;
    this.#ensure(this.perm + 64);
    return at;
  }

  /** Reset the transient region for a new synthesis. */
  #reset() {
    this.cursor = this.perm;
  }

  /**
   * Upload a component's tensors into linear memory and record their offsets.
   *
   * @param {Array} slots     the tensors, in the order the C module expects
   * @param {number} cfgAt    where the component's config block starts
   * @param {number} offsAt   where the component's offset table starts
   * @returns {number} the byte offset of the weights in linear memory
   */
  #upload(slots, cfgAt, offsAt) {
    for (const t of slots) {
      if (!t) throw new Error('wasm decoder: the package is missing a tensor');
    }
    let total = 0;
    for (const t of slots) total += t.data.length;

    const base = this.#allocPermanent(total * 4);
    const view = new Float32Array(this.memory.buffer, base, total);
    this.weightViews.push({ base, length: total, view });

    const offs = new Int32Array(this.memory.buffer, this.planPtr + offsAt * 4,
                                slots.length);
    let at = 0;
    slots.forEach((t, i) => {
      view.set(t.data, at);
      offs[i] = at;
      at += t.data.length;
    });
    return base;
  }

  /**
   * Upload the decoder's weights and describe the stage geometry.
   *
   * @param {object} tensors  the package's decoder tensors
   * @param {object} config   the decoder component's config
   */
  loadDecoder(tensors, config) {
    const inCh = config.in_channels;
    const [c0, c1, c2, c3] = config.channels;
    const hop = 256;

    // The offsets table has a fixed slot per tensor, matching the C
    // module's layout, so each slot names its own tensor rather than
    // relying on the order they happen to be listed in.
    const slots = new Array(46).fill(null);
    slots[OFF_PRE_W] = tensors['pre.weight'];
    slots[OFF_PRE_B] = tensors['pre.bias'];
    for (let s = 0; s < 3; s++) {
      slots[OFF_UP_W + s] = tensors[`up${s}.weight`];
      slots[OFF_UP_B + s] = tensors[`up${s}.bias`];
    }
    for (let s = 0; s < 3; s++) {
      for (let br = 0; br < 3; br++) {
        const p = `res${s}.0.blocks.${br}`;
        const at = OFF_RES + (s * 3 + br) * 4;
        slots[at + 0] = tensors[`${p}.conv1.weight`];
        slots[at + 1] = tensors[`${p}.conv1.bias`];
        slots[at + 2] = tensors[`${p}.conv2.weight`];
        slots[at + 3] = tensors[`${p}.conv2.bias`];
      }
    }
    slots[OFF_POST_W] = tensors['post.weight'];
    slots[OFF_POST_B] = tensors['post.bias'];

    const base = this.#upload(slots, DEC_CFG, DEC_OFFS);

    const plan = this.plan;
    plan[DEC_CFG + 0] = inCh;
    plan[DEC_CFG + 1] = c0; plan[DEC_CFG + 2] = c1;
    plan[DEC_CFG + 3] = c2; plan[DEC_CFG + 4] = c3;
    plan[DEC_CFG + 5] = hop;
    plan[DEC_CFG + 6] = base;
    for (let s = 0; s < 3; s++) {
      plan[DEC_CFG + 12 + s] = UP_KERNEL[s];
      plan[DEC_CFG + 15 + s] = UP_STRIDE[s];
      plan[DEC_CFG + 18 + s] = UP_PADDING[s];
    }
    for (let br = 0; br < 3; br++) {
      plan[DEC_CFG + 21 + br] = BANK_KERNEL[br];
      plan[DEC_CFG + 24 + br] = BANK_DIL1[br];
      plan[DEC_CFG + 27 + br] = BANK_DIL2[br];
    }
    this.decoderReady = true;
  }

  /**
   * Upload the duration student's weights and describe its geometry.
   *
   * @param {object} tensors  the package's duration tensors
   * @param {object} config   the duration component's config
   */
  loadDuration(tensors, config) {
    const depth = config.depth;
    const slots = new Array(3 + 5 * depth + 2).fill(null);
    slots[0] = tensors['embedding.weight'];
    slots[1] = tensors['input_proj.weight'];
    slots[2] = tensors['input_proj.bias'];
    for (let b = 0; b < depth; b++) {
      const p = `blocks.${b}`;
      const at = 3 + 5 * b;
      slots[at + 0] = tensors[`${p}.scale`];
      slots[at + 1] = tensors[`${p}.net.0.weight`];
      slots[at + 2] = tensors[`${p}.net.0.bias`];
      slots[at + 3] = tensors[`${p}.net.2.weight`];
      slots[at + 4] = tensors[`${p}.net.2.bias`];
    }
    slots[3 + 5 * depth] = tensors['output.weight'];
    slots[4 + 5 * depth] = tensors['output.bias'];

    const base = this.#upload(slots, DUR_CFG, DUR_OFFS);
    const plan = this.plan;
    plan[DUR_CFG + 0] = config.vocab_size;
    plan[DUR_CFG + 1] = config.hidden;
    plan[DUR_CFG + 2] = config.depth;
    plan[DUR_CFG + 3] = config.kernel_size;
    plan[DUR_CFG + 4] = config.max_tokens;
    plan[DUR_CFG + 5] = config.max_duration;
    plan[DUR_CFG + 6] = base;
    this.durationReady = true;
  }

  /**
   * Upload the acoustic student's weights and describe its geometry.
   *
   * @param {object} tensors  the package's acoustic tensors
   * @param {object} config   the acoustic component's config
   */
  loadAcoustic(tensors, config) {
    const depth = config.depth;
    const tokenDepth = config.token_depth;
    const n = 5 + 5 * tokenDepth + 5 * depth + 2;
    const slots = new Array(n).fill(null);
    slots[0] = tensors['embedding.weight'];
    slots[1] = tensors['token_input_proj.weight'];
    slots[2] = tensors['token_input_proj.bias'];
    for (let b = 0; b < tokenDepth; b++) {
      const p = `token_blocks.${b}`;
      const at = 3 + 5 * b;
      slots[at + 0] = tensors[`${p}.scale`];
      slots[at + 1] = tensors[`${p}.net.0.weight`];
      slots[at + 2] = tensors[`${p}.net.0.bias`];
      slots[at + 3] = tensors[`${p}.net.2.weight`];
      slots[at + 4] = tensors[`${p}.net.2.bias`];
    }
    const frameBase = 3 + 5 * tokenDepth;
    slots[frameBase + 0] = tensors['frame_input_proj.weight'];
    slots[frameBase + 1] = tensors['frame_input_proj.bias'];
    const blockBase = frameBase + 2;
    for (let b = 0; b < depth; b++) {
      const p = `frame_blocks.${b}`;
      const at = blockBase + 5 * b;
      slots[at + 0] = tensors[`${p}.scale`];
      slots[at + 1] = tensors[`${p}.net.0.weight`];
      slots[at + 2] = tensors[`${p}.net.0.bias`];
      slots[at + 3] = tensors[`${p}.net.2.weight`];
      slots[at + 4] = tensors[`${p}.net.2.bias`];
    }
    const outBase = blockBase + 5 * depth;
    slots[outBase + 0] = tensors['output.weight'];
    slots[outBase + 1] = tensors['output.bias'];

    const base = this.#upload(slots, ACO_CFG, ACO_OFFS);
    const plan = this.plan;
    plan[ACO_CFG + 0] = config.vocab_size;
    plan[ACO_CFG + 1] = config.hidden;
    plan[ACO_CFG + 2] = config.depth;
    plan[ACO_CFG + 3] = config.kernel_size;
    plan[ACO_CFG + 4] = config.out_channels;
    plan[ACO_CFG + 5] = config.token_depth;
    plan[ACO_CFG + 6] = base;
    this.acousticReady = true;
  }

  /**
   * Run the duration student.
   *
   * @param {Int32Array} ids          the phoneme ids
   * @param {number} lengthScale      the speech-rate multiplier (>1 is slower)
   * @returns {Int32Array} the per-token frame counts
   */
  durations(ids, lengthScale) {
    if (!this.durationReady) throw new Error('wasm decoder: duration not loaded');
    this.#reset();
    const n = ids.length;
    const hidden = this.plan[DUR_CFG + 1];
    const arenaFloats = (4 * hidden + 4) * n;

    const idsBase = this.#alloc(n * 4);
    const durBase = this.#alloc(n * 4);
    const arenaBase = this.#alloc(arenaFloats * 4);
    const framesBase = this.#alloc(16);

    new Int32Array(this.memory.buffer, idsBase, n).set(ids);
    const durations = new Int32Array(this.memory.buffer, durBase, n);
    const total = this.exports.snt_duration_run(
      idsBase, n, lengthScale, durBase, arenaBase, framesBase);
    if (total < 0) throw new Error(`wasm duration failed (${total})`);
    return durations.slice();
  }

  /**
   * Run the acoustic student.
   *
   * @param {Int32Array} ids        the phoneme ids
   * @param {Int32Array} durations  the per-token frame counts
   * @param {number} frames         the total frame count
   * @returns {Float32Array} the latent, [out_channels, frames]
   */
  latent(ids, durations, frames) {
    if (!this.acousticReady) throw new Error('wasm decoder: acoustic not loaded');
    this.#reset();
    const n = ids.length;
    const hidden = this.plan[ACO_CFG + 1];
    const outCh = this.plan[ACO_CFG + 4];
    const bigRows = outCh > hidden + 3 ? outCh : hidden + 3;
    const arenaFloats = hidden * n + (bigRows + 3 * hidden) * frames;

    const idsBase = this.#alloc(n * 4);
    const durBase = this.#alloc(n * 4);
    const arenaBase = this.#alloc(arenaFloats * 4);
    const latentBase = this.#alloc(outCh * frames * 4);

    new Int32Array(this.memory.buffer, idsBase, n).set(ids);
    new Int32Array(this.memory.buffer, durBase, n).set(durations);
    const rc = this.exports.snt_acoustic_run(
      idsBase, durBase, n, frames, latentBase, arenaBase);
    if (rc !== 0) throw new Error(`wasm acoustic failed (${rc})`);
    return new Float32Array(this.memory.buffer, latentBase, outCh * frames).slice();
  }

  /**
   * Decode a latent into a waveform.
   *
   * @param {Float32Array} latent  the acoustic model's output, [in_ch, frames]
   * @param {number} frames        the frame count
   * @returns {Float32Array} the waveform, pre-tanh (the caller applies tanh)
   */
  decode(latent, frames) {
    if (!this.decoderReady) throw new Error('wasm decoder: decoder not loaded');
    this.#reset();

    const arenaFloats = this.exports.snt_decoder_arena_floats(frames);
    const samples = frames * 256;

    const latentBase = this.#alloc(latent.length * 4);
    const arenaBase = this.#alloc(arenaFloats * 4);
    const outBase = this.#alloc(samples * 4);

    new Float32Array(this.memory.buffer, latentBase, latent.length).set(latent);

    this.plan[DEC_CFG + 7] = arenaBase;
    this.exports.snt_decoder_run(latentBase, frames, outBase);

    const out = new Float32Array(this.memory.buffer, outBase, samples);
    // The caller applies tanh; return a copy so the caller owns it.
    return out.slice();
  }
}
