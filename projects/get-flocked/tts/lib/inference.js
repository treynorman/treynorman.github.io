/**
 * inference.js — the sanoTTS "root-A" student stack, in plain JavaScript.
 *
 * Three components, in order:
 *   duration  phoneme ids  -> per-token frame counts
 *   acoustic  ids+durations-> Piper generator latent  [192, frames]
 *   decoder   latent       -> waveform
 *
 * The weights come from a `roota.raw-fp16.v1` package: manifest.json gives
 * the dims and a per-tensor table, weights.fp16.bin holds the values as
 * fp16 addressed by offset_bytes. model-package.js does the loading.
 *
 * Semantics follow the fp32 C reference (mcu/src/snt_front_f32.c and
 * mcu/src/snt_piperlite.c), which is itself a port of the PyTorch training
 * code. Two details are load-bearing and easy to get wrong:
 *
 *   - torch.linspace(0, 1, n) computes step = 1/(n-1) in fp32 and fills the
 *     second half with fma(-step, n-1-i, 1). Reproduced exactly below;
 *     a naive i/(n-1) differs in the last bits and the duration model is
 *     sensitive to it because durations are rounded to integers.
 *   - torch.round is round-half-to-even. Math.round is round-half-up, so
 *     the ties are handled explicitly in roundHalfEven().
 *
 * Arrays are channel-major ([ch][T]) throughout, matching the C reference.
 */

/* -------------------------------------------------------------------------- */
/* scalar helpers                                                             */
/* -------------------------------------------------------------------------- */

/**
 * Fallback phoneme id for ids outside a component's trained vocabulary.
 *
 * The shared G2P table spans more phonemes than any one voice was trained
 * on (this voice's map runs to id 153, its duration student stops at 129),
 * so an id can be out of range for the duration or the acoustic pass.
 * Schwa is the neutral, always-in-vocabulary choice -- the same fallback
 * the reference runtime uses.
 */
const SCHWA_ID = 59;

/** torch.round: round half to even. */
function roundHalfEven(x) {
  const f = Math.floor(x);
  const diff = x - f;
  if (diff > 0.5) return f + 1;
  if (diff < 0.5) return f;
  return (f % 2 === 0) ? f : f + 1;
}

/** torch.linspace(0, 1, n) with exact CPU-kernel float semantics. */
function linspace01(n) {
  const out = new Float32Array(n);
  if (n <= 0) return out;
  if (n === 1) { out[0] = 0; return out; }
  const half = n >> 1;
  const step = 1 / (n - 1);
  for (let i = 0; i < half; i++) out[i] = step * i;
  for (let i = half; i < n; i++) out[i] = -step * (n - 1 - i) + 1;
  return out;
}

function silu(x) {
  for (let i = 0; i < x.length; i++) x[i] = x[i] / (1 + Math.exp(-x[i]));
}

function leakyRelu(x, slope) {
  for (let i = 0; i < x.length; i++) x[i] = x[i] > 0 ? x[i] : slope * x[i];
}

/* -------------------------------------------------------------------------- */
/* convolutions (channel-major [ch][T])                                       */
/* -------------------------------------------------------------------------- */

/**
 * Conv1d, PyTorch "same" semantics: pad = dilation*(K/2).
 *
 * x: [in_ch, T], weight: [out_ch, in_ch, K], bias: [out_ch].
 * Returns a fresh [out_ch, T].
 */
function conv1dSame(x, inCh, T, w, bias, outCh, K, dilation = 1) {
  const out = new Float32Array(outCh * T);
  const pad = dilation * (K >> 1);
  for (let oc = 0; oc < outCh; oc++) {
    const orow = out.subarray(oc * T, oc * T + T);
    orow.fill(bias[oc]);
    for (let ic = 0; ic < inCh; ic++) {
      const xrow = x.subarray(ic * T, ic * T + T);
      const wrow = w.subarray((oc * inCh + ic) * K, (oc * inCh + ic) * K + K);
      for (let k = 0; k < K; k++) {
        const wv = wrow[k];
        if (wv === 0) continue;
        const off = k * dilation - pad;
        const lo = off < 0 ? -off : 0;
        const hi = off > 0 ? T - off : T;
        for (let t = lo; t < hi; t++) orow[t] += wv * xrow[t + off];
      }
    }
  }
  return out;
}

/**
 * conv1dSame writing into a caller-provided buffer.
 *
 * The residual blocks call this once per block, so taking the output buffer
 * as an argument avoids allocating a fresh multi-megabyte array each time.
 */
function conv1dSameInto(out, x, inCh, T, w, bias, outCh, K, dilation = 1) {
  const pad = dilation * (K >> 1);
  for (let oc = 0; oc < outCh; oc++) {
    const orow = out.subarray(oc * T, oc * T + T);
    orow.fill(bias[oc]);
    for (let ic = 0; ic < inCh; ic++) {
      const xrow = x.subarray(ic * T, ic * T + T);
      const wrow = w.subarray((oc * inCh + ic) * K, (oc * inCh + ic) * K + K);
      for (let k = 0; k < K; k++) {
        const wv = wrow[k];
        if (wv === 0) continue;
        const off = k * dilation - pad;
        const lo = off < 0 ? -off : 0;
        const hi = off > 0 ? T - off : T;
        for (let t = lo; t < hi; t++) orow[t] += wv * xrow[t + off];
      }
    }
  }
  return out;
}

/**
 * ConvTranspose1d, PyTorch semantics.
 *
 * x: [in_ch, T], weight: [in_ch, out_ch, K], bias: [out_ch].
 * Output length L = (T-1)*stride - 2*padding + K.
 *
 * Implemented in gather form (for each output sample, sum the taps that
 * land on it) rather than the C reference's scatter form: with K/stride taps
 * per output the reads stay contiguous, which is what a JS engine wants.
 */
function convTranspose1d(x, inCh, T, w, bias, outCh, K, stride, padding) {
  const L = (T - 1) * stride - 2 * padding + K;
  const out = new Float32Array(outCh * L);
  for (let oc = 0; oc < outCh; oc++) {
    out.fill(bias[oc], oc * L, oc * L + L);
  }
  // For each output index j, the contributing taps are those k with
  // (j + padding - k) a multiple of stride and in range.
  for (let k = 0; k < K; k++) {
    const shift = k - padding;
    if (shift >= L) continue;
    // j = t*stride + shift
    let tLo = 0;
    if (shift < 0) tLo = Math.ceil(-shift / stride);
    let tHi = Math.min(T, Math.floor((L - 1 - shift) / stride) + 1);
    for (let ic = 0; ic < inCh; ic++) {
      const xrow = x.subarray(ic * T, ic * T + T);
      for (let oc = 0; oc < outCh; oc++) {
        const wv = w[(ic * outCh + oc) * K + k];
        if (wv === 0) continue;
        const orow = out.subarray(oc * L, oc * L + L);
        for (let t = tLo; t < tHi; t++) orow[t * stride + shift] += wv * xrow[t];
      }
    }
  }
  return out;
}

/* -------------------------------------------------------------------------- */
/* component 1: duration student                                               */
/* -------------------------------------------------------------------------- */

/**
 * ids -> per-token frame counts.
 *
 * exp(log_dur) -> clamp_min(1) -> * length_scale -> round-half-even
 *              -> clamp(1, max_duration)
 */
export function durationForward(tensors, config, ids, lengthScale) {
  const vocabSize = config.vocab_size;
  const hidden = config.hidden;
  const depth = config.depth;
  const maxTokens = config.max_tokens;
  const maxDuration = config.max_duration;

  const n = ids.length;
  if (n <= 0) throw new Error('durationForward: empty id sequence');

  // Embedding lookup + the three position/length/valid hints.
  const embed = tensors['embedding.weight'];
  const feat = new Float32Array((hidden + 3) * n);
  const fallback = SCHWA_ID < vocabSize ? SCHWA_ID : 0;
  for (let i = 0; i < n; i++) {
    const id = (ids[i] >= 0 && ids[i] < vocabSize) ? ids[i] : fallback;
    const row = id * hidden;
    for (let c = 0; c < hidden; c++) feat[c * n + i] = embed.data[row + c];
  }
  const pos = linspace01(n);
  feat.set(pos, hidden * n);
  const lengthHint = Math.log1p(n) / Math.log1p(maxTokens);
  feat.fill(lengthHint, (hidden + 1) * n, (hidden + 2) * n);
  feat.fill(1, (hidden + 2) * n, (hidden + 3) * n);

  // 1x1 projection, then the residual blocks.
  let x = conv1dSame(feat, hidden + 3, n,
                     tensors['input_proj.weight'].data, tensors['input_proj.bias'].data,
                     hidden, 1);
  x = runResidualBlocks(x, tensors, 'blocks', depth, hidden, config.kernel_size, n);

  const logits = conv1dSame(x, hidden, n,
                            tensors['output.weight'].data, tensors['output.bias'].data,
                            1, 1);

  const durations = new Int32Array(n);
  for (let i = 0; i < n; i++) {
    let v = Math.exp(logits[i]);
    if (v < 1) v = 1;
    v = roundHalfEven(v * lengthScale);
    if (v < 1) v = 1;
    if (v > maxDuration) v = maxDuration;
    durations[i] = v;
  }
  return durations;
}

/** depth residual blocks: x + scale * conv2(silu(conv1(x))). */
function runResidualBlocks(x, tensors, prefix, depth, h, K, T) {
  const c1 = new Float32Array(h * T);
  const c2 = new Float32Array(h * T);
  for (let b = 0; b < depth; b++) {
    const p = `${prefix}.${b}`;
    const scale = tensors[`${p}.scale`].data[0];
    conv1dSameInto(c1, x, h, T,
                   tensors[`${p}.net.0.weight`].data, tensors[`${p}.net.0.bias`].data, h, K);
    silu(c1);
    conv1dSameInto(c2, c1, h, T,
                   tensors[`${p}.net.2.weight`].data, tensors[`${p}.net.2.bias`].data, h, K);
    for (let i = 0; i < h * T; i++) x[i] += scale * c2[i];
  }
  return x;
}

/* -------------------------------------------------------------------------- */
/* component 2: acoustic student                                              */
/* -------------------------------------------------------------------------- */

/**
 * ids + durations -> latent [out_channels, frames].
 *
 * Token stage: embed, add (position, duration) hints, token blocks.
 * Frame stage: expand token context by duration, add frame hints,
 * frame blocks, output projection.
 */
export function acousticForward(tensors, config, ids, durations) {
  const vocabSize = config.vocab_size;
  const hidden = config.hidden;
  const tokenDepth = config.token_depth;
  const depth = config.depth;
  const outChannels = config.out_channels;

  const n = ids.length;
  let frames = 0;
  for (let i = 0; i < n; i++) {
    if (durations[i] < 1) throw new Error('acousticForward: non-positive duration');
    frames += durations[i];
  }

  // -- token stage --
  const embed = tensors['embedding.weight'];
  const big = new Float32Array((hidden + 2) * n);
  const fallback = SCHWA_ID < vocabSize ? SCHWA_ID : 0;
  for (let i = 0; i < n; i++) {
    const id = (ids[i] >= 0 && ids[i] < vocabSize) ? ids[i] : fallback;
    const row = id * hidden;
    for (let c = 0; c < hidden; c++) big[c * n + i] = embed.data[row + c];
  }
  big.set(linspace01(n), hidden * n);

  let maxDur = 1;
  for (let i = 0; i < n; i++) if (durations[i] > maxDur) maxDur = durations[i];
  const logMaxDur = Math.log1p(maxDur);
  for (let i = 0; i < n; i++) {
    big[(hidden + 1) * n + i] = Math.log1p(durations[i]) / logMaxDur;
  }

  let tok = conv1dSame(big, hidden + 2, n,
                        tensors['token_input_proj.weight'].data, tensors['token_input_proj.bias'].data,
                        hidden, 1);
  tok = runResidualBlocks(tok, tensors, 'token_blocks', tokenDepth, hidden, config.kernel_size, n);

  // -- expand token context to frames --
  const framesBuf = new Float32Array((hidden + 3) * frames);
  for (let c = 0; c < hidden; c++) {
    const orow = framesBuf.subarray(c * frames, c * frames + frames);
    const trow = tok.subarray(c * n, c * n + n);
    let pos = 0;
    for (let ti = 0; ti < n; ti++) {
      const v = trow[ti];
      for (let j = 0; j < durations[ti]; j++) orow[pos++] = v;
    }
  }
  framesBuf.set(linspace01(frames), hidden * frames);

  // Per-frame position hints, built in double then cast to fp32.
  const tokenCount = n > 1 ? n - 1 : 1;
  const tp = framesBuf.subarray((hidden + 1) * frames, (hidden + 2) * frames);
  const dp = framesBuf.subarray((hidden + 2) * frames, (hidden + 3) * frames);
  let pos = 0;
  for (let ti = 0; ti < n; ti++) {
    const d = durations[ti];
    const tv = ti / tokenCount;
    for (let j = 0; j < d; j++) {
      tp[pos] = tv;
      dp[pos] = d === 1 ? 0 : j / (d - 1);
      pos++;
    }
  }

  // -- frame stage --
  let x = conv1dSame(framesBuf, hidden + 3, frames,
                     tensors['frame_input_proj.weight'].data, tensors['frame_input_proj.bias'].data,
                     hidden, 1);
  x = runResidualBlocks(x, tensors, 'frame_blocks', depth, hidden, config.kernel_size, frames);

  const latent = conv1dSame(x, hidden, frames,
                            tensors['output.weight'].data, tensors['output.bias'].data,
                            outChannels, 1);
  return latent;
}

/* -------------------------------------------------------------------------- */
/* component 3: piperlite decoder                                             */
/* -------------------------------------------------------------------------- */

// Dilation each branch index uses in the piperlite residual bank. The
// kernel length itself is read from each tensor's shape, so a package whose
// bank uses different kernels still runs.
const BANK_DIL1 = [1, 2, 3];
const BANK_DIL2 = [2, 6, 12];

/**
 * latent [in_ch, frames] -> waveform (frames * 256 samples).
 *
 * pre Conv1d -> 3 x (leaky_relu, ConvTranspose1d, residual bank) ->
 * leaky_relu(0.01) -> post Conv1d -> tanh.
 */
export function decoderForward(tensors, config, latent) {
  const inCh = config.in_channels;
  const [c0, c1, c2, c3] = config.channels;
  const frames = latent.length / inCh;

  // The upsample stages are the "piperlite" variant's: three stages whose
  // strides multiply to the decoder hop. Channel widths and kernel lengths
  // come from the tensor shapes, so a package built with different widths
  // runs here without change; only the strides and paddings are fixed by
  // the variant.
  const stages = [
    { up: 'up0', bank: 'res0.0', branches: config.stage0_branches || [0, 1, 2] },
    { up: 'up1', bank: 'res1.0', branches: config.stage1_branches || [0, 1, 2] },
    { up: 'up2', bank: 'res2.0', branches: config.stage2_branches || [0, 1, 2] },
  ];

  let x = conv1dSame(latent, inCh, frames,
                     tensors['pre.weight'].data, tensors['pre.bias'].data, c0, 7);
  let T = frames;

  for (const st of stages) {
    const upW = tensors[`${st.up}.weight`];
    const upK = upW.shape[2];
    const upS = upStrideFor(st.up);
    const upP = upPaddingFor(st.up);
    leakyRelu(x, 0.1);
    x = convTranspose1d(x, upW.shape[0], T,
                        upW.data, tensors[`${st.up}.bias`].data,
                        upW.shape[1], upK, upS, upP);
    T = (T - 1) * upS - 2 * upP + upK;
    x = residualBank(x, tensors, st.bank, upW.shape[1], T, st.branches);
  }

  leakyRelu(x, 0.01);
  const audio = conv1dSame(x, c3, T,
                           tensors['post.weight'].data, tensors['post.bias'].data, 1, 7);
  for (let i = 0; i < audio.length; i++) audio[i] = Math.tanh(audio[i]);
  return applyPostFilter(audio, tensors, config);
}

/**
 * The piperlite upsample stages use fixed strides and paddings (they define
 * the variant's hop); only the kernel length and channel widths vary.
 */
function upStrideFor(name) {
  return name === 'up2' ? 4 : 8;
}
function upPaddingFor(name) {
  return name === 'up2' ? 2 : 4;
}

/**
 * Optional waveform post filter: a small residual refinement of the
 * waveform, present in some packages and absent in others.
 *
 *   r  = conv(audio)
 *   r += scale * conv2(lrelu(conv1(lrelu(r))))     per unit
 *   audio = tanh(audio + pf_scale * conv(r))
 */
function applyPostFilter(audio, tensors, config) {
  const channels = config.post_filter_channels || 0;
  const layers = config.post_filter_layers || 0;
  if (channels <= 0) return audio;

  const T = audio.length;
  const inW = tensors['post_filter.in_conv.weight'];
  const r = conv1dSame(new Float32Array(audio), 1, T,
                       inW.data, tensors['post_filter.in_conv.bias'].data,
                       channels, inW.shape[2]);
  const t = new Float32Array(channels * T);
  const u = new Float32Array(channels * T);
  for (let layer = 0; layer < layers; layer++) {
    const p = `post_filter.units.${layer}`;
    const scale = tensors[`${p}.scale`].data[0];
    const w1 = tensors[`${p}.conv1.weight`];
    const w2 = tensors[`${p}.conv2.weight`];
    leakyReluInto(t, r, 0.1);
    conv1dSameInto(u, t, channels, T, w1.data, tensors[`${p}.conv1.bias`].data,
                   channels, w1.shape[2], 1 + layer);
    leakyReluInto(t, u, 0.1);
    conv1dSameInto(u, t, channels, T, w2.data, tensors[`${p}.conv2.bias`].data,
                   channels, w2.shape[2], 1);
    for (let i = 0; i < channels * T; i++) r[i] += scale * u[i];
  }
  const outW = tensors['post_filter.out_conv.weight'];
  const out = conv1dSame(r, channels, T,
                         outW.data, tensors['post_filter.out_conv.bias'].data, 1, outW.shape[2]);
  const scale = config.post_filter_scale || 0;
  for (let i = 0; i < T; i++) audio[i] = Math.tanh(audio[i] + scale * out[i]);
  return audio;
}

/**
 * PiperResidualBank: the mean over three branches of
 *   y1 = conv1(lrelu(x)) + x
 *   y2 = conv2(lrelu(y1)) + y1
 */
function residualBank(x, tensors, prefix, ch, T, branches) {
  const sum = new Float32Array(ch * T);
  const t = new Float32Array(ch * T);
  const c1 = new Float32Array(ch * T);
  const c2 = new Float32Array(ch * T);
  for (const br of branches) {
    const p = `${prefix}.blocks.${br}`;
    const w1 = tensors[`${p}.conv1.weight`];
    const w2 = tensors[`${p}.conv2.weight`];
    leakyReluInto(t, x, 0.1);
    conv1dSameInto(c1, t, ch, T, w1.data, tensors[`${p}.conv1.bias`].data,
                   ch, w1.shape[2], BANK_DIL1[br]);
    for (let i = 0; i < ch * T; i++) c1[i] += x[i];          // y1
    leakyReluInto(t, c1, 0.1);
    conv1dSameInto(c2, t, ch, T, w2.data, tensors[`${p}.conv2.bias`].data,
                   ch, w2.shape[2], BANK_DIL2[br]);
    for (let i = 0; i < ch * T; i++) sum[i] += c2[i] + c1[i]; // y2
  }
  const inv = 1 / branches.length;
  for (let i = 0; i < ch * T; i++) sum[i] *= inv;
  return sum;
}

function leakyReluInto(dst, src, slope) {
  for (let i = 0; i < src.length; i++) dst[i] = src[i] > 0 ? src[i] : slope * src[i];
}

/* -------------------------------------------------------------------------- */
/* whole-pipeline convenience                                                  */
/* -------------------------------------------------------------------------- */

/**
 * ids -> waveform.
 *
 * @param {object} components  {duration:{tensors,config}, acoustic:{...}, decoder:{...}}
 * @param {Int32Array|number[]} ids  phoneme ids
 * @param {number} lengthScale  speech-rate multiplier (>1 is slower)
 */
export function synthesize(components, ids, lengthScale) {
  const durations = durationForward(
    components.duration.tensors, components.duration.config, ids, lengthScale);
  const latent = acousticForward(
    components.acoustic.tensors, components.acoustic.config, ids, durations);
  const audio = decoderForward(
    components.decoder.tensors, components.decoder.config, latent);
  return { audio, durations, latent };
}
