/**
 * gpu.js — WebGPU backend for the sanoTTS decoder.
 *
 * The decoder is the expensive part of synthesis: for a four-second
 * sentence it is ~97% of the arithmetic. On the CPU that is a few seconds
 * of scalar JavaScript; on a GPU the same work is milliseconds.
 *
 * The graph is unchanged -- this computes the same thing as the JavaScript
 * engine in inference.js, just on the GPU.
 *
 * Three kernels do the work:
 *
 *   conv1d    out[oc][t] = bias[oc] + sum_{ic,k} w[oc][ic][k] * src[ic][t + k*dil - pad]
 *   convt1d   the transpose, gathered: each output sample sums the taps
 *             that land on it
 *   bank      one step of the residual bank:
 *               y1 = conv1(lrelu(x)) + x
 *               y2 = conv2(lrelu(y1)) + y1
 *
 * The leaky ReLU is folded into the convolution kernels rather than run as
 * its own pass: the bank needs lrelu(x) for the conv and lrelu(y1) for the
 * second conv, and fusing it removes two full-size buffers and two passes
 * over the largest tensor in the graph.
 *
 * Weights are uploaded as fp32 and stay resident in one GPU buffer for the
 * session; only the latent and the finished waveform cross the boundary.
 *
 * This backend is optional. If WebGPU is missing, or a device cannot be
 * created, or the device is lost, the caller falls back to the JavaScript
 * engine; the two produce the same audio.
 */

const WORKGROUP = 64;

/**
 * Dilation each branch index uses in the piperlite residual bank.
 *
 * The branch's two convolutions use different dilations, which is what makes
 * the three branches differ from each other. The kernel lengths come from
 * the weight shapes, so a package whose bank uses other kernels still runs.
 */
const BANK_DIL1 = [1, 2, 3];
const BANK_DIL2 = [2, 6, 12];

/**
 * The convolution kernels.
 *
 * Weights are packed as [out_channel][in_channel][kernel], which is how the
 * manifest already stores the conv1d weights. The transposed convolution's
 * weights are stored [in][out][kernel] and are transposed on upload.
 */
const CONV_SHADER = /* wgsl */ `
struct ConvParams {
  in_channels : u32,
  out_channels : u32,
  length : u32,
  out_length : u32,
  kernel : u32,
  dilation : u32,
  stride : u32,
  padding : u32,
  weight_offset : u32,
  bias_offset : u32,
  apply_leaky : u32,
  _pad0 : u32,
  leaky_slope : f32,
  _pad1 : f32,
};

@group(0) @binding(0) var<storage, read> src : array<f32>;
@group(0) @binding(1) var<storage, read_write> dst : array<f32>;
@group(0) @binding(2) var<storage, read> weights : array<f32>;
@group(0) @binding(3) var<uniform> params : ConvParams;

fn leaky(v : f32) -> f32 {
  if (params.apply_leaky == 0u) { return v; }
  return select(params.leaky_slope * v, v, v > 0.0);
}

@compute @workgroup_size(64)
fn conv1d(@builtin(global_invocation_id) gid : vec3<u32>) {
  let t = gid.x;
  let oc = gid.y;
  if (t >= params.length || oc >= params.out_channels) { return; }

  let in_ch = params.in_channels;
  let K = params.kernel;
  let dil = params.dilation;
  let pad = params.padding;

  var acc = weights[params.bias_offset + oc];
  for (var ic = 0u; ic < in_ch; ic = ic + 1u) {
    let wbase = params.weight_offset + (oc * in_ch + ic) * K;
    let xbase = ic * params.length;
    for (var k = 0u; k < K; k = k + 1u) {
      let off = i32(k) * i32(dil) - i32(pad);
      let idx = i32(t) + off;
      if (idx >= 0 && idx < i32(params.length)) {
        acc = acc + weights[wbase + k] * leaky(src[xbase + u32(idx)]);
      }
    }
  }
  dst[oc * params.length + t] = acc;
}

// The transposed convolution, gathered: output sample j sums the taps that
// land on it, i.e. t = (j + pad - k) / stride for each k where that is an
// integer in range.
@compute @workgroup_size(64)
fn convt1d(@builtin(global_invocation_id) gid : vec3<u32>) {
  let j = gid.x;
  let oc = gid.y;
  if (j >= params.out_length || oc >= params.out_channels) { return; }

  let in_ch = params.in_channels;
  let K = params.kernel;
  let stride = params.stride;
  let pad = params.padding;

  var acc = weights[params.bias_offset + oc];
  for (var ic = 0u; ic < in_ch; ic = ic + 1u) {
    let wbase = params.weight_offset + (oc * in_ch + ic) * K;
    let xbase = ic * params.length;
    for (var k = 0u; k < K; k = k + 1u) {
      let num = i32(j) + i32(pad) - i32(k);
      if (num >= 0 && num % i32(stride) == 0) {
        let t = num / i32(stride);
        if (t >= 0 && t < i32(params.length)) {
          acc = acc + weights[wbase + k] * leaky(src[xbase + u32(t)]);
        }
      }
    }
  }
  dst[oc * params.out_length + j] = acc;
}
`;

/**
 * One step of the piperlite residual bank.
 *
 * mode 0: dst = conv1(lrelu(src)) + src            (this is y1)
 * mode 1: dst += conv2(lrelu(src)) + src           (this is y2, accumulated)
 *
 * The branch's two kernels have different lengths and dilations, so both
 * are carried in the uniform and the mode selects which is used.
 */
const BANK_SHADER = /* wgsl */ `
struct BankParams {
  in_channels : u32,
  out_channels : u32,
  length : u32,
  kernel1 : u32,
  dilation1 : u32,
  kernel2 : u32,
  dilation2 : u32,
  w1_offset : u32,
  b1_offset : u32,
  w2_offset : u32,
  b2_offset : u32,
  mode : u32,
  _pad0 : u32,
  _pad1 : u32,
  _pad2 : u32,
};

@group(0) @binding(0) var<storage, read> src : array<f32>;
@group(0) @binding(1) var<storage, read_write> dst : array<f32>;
@group(0) @binding(2) var<storage, read> weights : array<f32>;
@group(0) @binding(3) var<uniform> params : BankParams;

@compute @workgroup_size(64)
fn bank(@builtin(global_invocation_id) gid : vec3<u32>) {
  let t = gid.x;
  let oc = gid.y;
  if (t >= params.length || oc >= params.out_channels) { return; }

  let in_ch = params.in_channels;
  let is_first = params.mode == 0u;
  let K = select(params.kernel2, params.kernel1, is_first);
  let dil = select(params.dilation2, params.dilation1, is_first);
  let w_off = select(params.w2_offset, params.w1_offset, is_first);
  let b_off = select(params.b2_offset, params.b1_offset, is_first);
  let pad = dil * (K >> 1u);

  var acc = weights[b_off + oc];
  for (var ic = 0u; ic < in_ch; ic = ic + 1u) {
    let wbase = w_off + (oc * in_ch + ic) * K;
    let xbase = ic * params.length;
    for (var k = 0u; k < K; k = k + 1u) {
      let off = i32(k) * i32(dil) - i32(pad);
      let idx = i32(t) + off;
      if (idx >= 0 && idx < i32(params.length)) {
        var xv = src[xbase + u32(idx)];
        xv = select(0.1 * xv, xv, xv > 0.0);
        acc = acc + weights[wbase + k] * xv;
      }
    }
  }

  // + x: the residual the branch adds back.
  acc = acc + src[oc * params.length + t];

  if (is_first) {
    dst[oc * params.length + t] = acc;
  } else {
    dst[oc * params.length + t] = dst[oc * params.length + t] + acc;
  }
}
`;

/** tanh, without overflowing for large absolute x. */
const TANH_SHADER = /* wgsl */ `
struct TanhParams { count : u32, _pad : u32, _pad2 : u32, _pad3 : u32 };
@group(0) @binding(0) var<storage, read> src : array<f32>;
@group(0) @binding(1) var<storage, read_write> dst : array<f32>;
@group(0) @binding(2) var<uniform> params : TanhParams;

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid : vec3<u32>) {
  let i = gid.x;
  if (i >= params.count) { return; }
  let v = src[i];
  let e = exp(2.0 * v);
  if (v > 0.0) {
    dst[i] = 1.0 - 2.0 / (e + 1.0);
  } else {
    dst[i] = (e - 1.0) / (e + 1.0);
  }
}
`;

/** dst = dst * scale, in place. */
const SCALE_SHADER = /* wgsl */ `
struct ScaleParams { count : u32, _pad : u32, scale : f32, _pad2 : f32 };
@group(0) @binding(0) var<storage, read_write> dst : array<f32>;
@group(0) @binding(1) var<uniform> params : ScaleParams;

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid : vec3<u32>) {
  let i = gid.x;
  if (i >= params.count) { return; }
  dst[i] = dst[i] * params.scale;
}
`;

/**
 * Request an adapter, retrying while the GPU process starts.
 *
 * The first requestAdapter() call in a fresh browser can resolve to null
 * while the GPU process is still coming up, even though an adapter is
 * available a moment later. That is a cold-start race, not a missing GPU, so
 * it is retried with a short backoff before giving up. The fallback adapter
 * is tried as well, which covers the case where the hardware adapter is
 * unusable but a software one is not.
 *
 * @param {number} attempts  how many times to ask
 * @returns {Promise<GPUAdapter|null>}
 */
async function requestAdapter(attempts = 5) {
  for (let i = 0; i < attempts; i++) {
    let adapter = null;
    try {
      adapter = await navigator.gpu.requestAdapter();
      if (!adapter) {
        adapter = await navigator.gpu.requestAdapter({ forceFallbackAdapter: true });
      }
    } catch {
      // Treated the same as "no adapter this time": try again.
    }
    if (adapter) return adapter;
    // The GPU process needs a moment; back off a little longer each time.
    await new Promise((resolve) => setTimeout(resolve, 100 * (i + 1)));
  }
  return null;
}

/**
 * Create the GPU backend.
 *
 * @param {object} tensors  the package's decoder tensors
 * @param {object} config   the decoder component's config
 * @returns {Promise<object|null>} the backend, or null if WebGPU is unusable
 */
export async function createGPUDecoder(tensors, config) {
  if (typeof navigator === 'undefined' || !navigator.gpu) return null;

  const adapter = await requestAdapter();
  if (!adapter) return null;

  let device = null;
  try {
    device = await adapter.requestDevice();
  } catch {
    return null;
  }
  if (!device) return null;

  const backend = new GPUDecoder(device, config);
  device.lost?.then((info) => {
    backend.lost = true;
    console.warn('gpu: device lost:', info && info.message);
  });
  try {
    await backend.uploadWeights(tensors);
  } catch (error) {
    console.warn('gpu: weight upload failed:', error);
    return null;
  }
  return backend;
}

class GPUDecoder {
  constructor(device, config) {
    this.device = device;
    this.config = config;
    this.lost = false;

    const convModule = device.createShaderModule({ code: CONV_SHADER });
    this.conv1dPipeline = device.createComputePipeline({
      layout: 'auto', compute: { module: convModule, entryPoint: 'conv1d' } });
    this.convt1dPipeline = device.createComputePipeline({
      layout: 'auto', compute: { module: convModule, entryPoint: 'convt1d' } });

    this.bankPipeline = device.createComputePipeline({
      layout: 'auto',
      compute: { module: device.createShaderModule({ code: BANK_SHADER }), entryPoint: 'bank' } });
    this.tanhPipeline = device.createComputePipeline({
      layout: 'auto',
      compute: { module: device.createShaderModule({ code: TANH_SHADER }), entryPoint: 'main' } });
    this.scalePipeline = device.createComputePipeline({
      layout: 'auto',
      compute: { module: device.createShaderModule({ code: SCALE_SHADER }), entryPoint: 'main' } });

    this.weightBuffer = null;
    this.weightOffsets = new Map();
    this.shapes = new Map();
    this.pool = [];
  }

  /**
   * Upload every decoder weight into one packed fp32 buffer.
   *
   * The kernels index weights as [out_channel][in_channel][kernel]. The
   * conv1d weights already have that layout; the transposed convolution's
   * weights are stored [in][out][kernel] and are transposed here.
   */
  async uploadWeights(tensors) {
    const parts = [];
    let offset = 0;
    for (const [name, tensor] of Object.entries(tensors)) {
      this.shapes.set(name, tensor.shape);
      let data = tensor.data;
      if (name.startsWith('up') && name.endsWith('.weight') && tensor.shape.length === 3) {
        const [inCh, outCh, K] = tensor.shape;
        const packed = new Float32Array(outCh * inCh * K);
        for (let oc = 0; oc < outCh; oc++) {
          for (let ic = 0; ic < inCh; ic++) {
            for (let k = 0; k < K; k++) {
              packed[(oc * inCh + ic) * K + k] = data[(ic * outCh + oc) * K + k];
            }
          }
        }
        data = packed;
      }
      this.weightOffsets.set(name, offset);
      parts.push(data);
      offset += data.length;
    }

    const flat = new Float32Array(offset);
    let at = 0;
    for (const part of parts) { flat.set(part, at); at += part.length; }

    this.weightBuffer = this.device.createBuffer({
      size: offset * 4,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    this.device.queue.writeBuffer(this.weightBuffer, 0, flat);
  }

  /**
   * A GPU buffer of at least `floats` elements, from a pool.
   *
   * Buffers are handed out for the duration of one decode and released
   * together, so a buffer is never reused while still live.
   */
  alloc(floats) {
    for (const entry of this.pool) {
      if (!entry.inUse && entry.size >= floats) {
        entry.inUse = true;
        return entry;
      }
    }
    const entry = {
      buffer: this.device.createBuffer({
        size: floats * 4,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC,
      }),
      size: floats,
      inUse: true,
    };
    this.pool.push(entry);
    return entry;
  }

  releaseAll() {
    for (const entry of this.pool) entry.inUse = false;
  }

  /** Run one compute dispatch. */
  dispatch(pipeline, bindGroup, x, y) {
    const encoder = this.device.createCommandEncoder();
    const pass = encoder.beginComputePass();
    pass.setPipeline(pipeline);
    pass.setBindGroup(0, bindGroup);
    pass.dispatchWorkgroups(x, y, 1);
    pass.end();
    this.device.queue.submit([encoder.finish()]);
  }

  makeUniform(data) {
    const buffer = this.device.createBuffer({
      size: Math.max(data.byteLength, 16),
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    this.device.queue.writeBuffer(buffer, 0, data);
    return buffer;
  }

  /**
   * Decode a latent into a waveform.
   *
   * @param {Float32Array} latent  [in_channels, frames]
   * @returns {Promise<Float32Array>} mono PCM
   */
  async decode(latent) {
    if (this.lost) throw new Error('gpu: device lost');
    this.releaseAll();

    const cfg = this.config;
    const inCh = cfg.in_channels;
    const frames = latent.length / inCh;
    const channels = cfg.channels;

    // Upload the latent.
    const src = this.alloc(latent.length);
    this.device.queue.writeBuffer(src.buffer, 0, latent);

    // pre: Conv1d(in_ch, c0, 7)
    const pre = this.alloc(channels[0] * frames);
    this.runConv1d(src, pre, 'pre.weight', 'pre.bias',
                   inCh, channels[0], frames, 7, 1, 3, 0, 0);

    // The upsample stages: leaky_relu, ConvTranspose1d, residual bank.
    const stages = [
      { up: 'up0', bank: 'res0.0', stride: 8, padding: 4 },
      { up: 'up1', bank: 'res1.0', stride: 8, padding: 4 },
      { up: 'up2', bank: 'res2.0', stride: 4, padding: 2 },
    ];

    let x = pre;
    let xChannels = channels[0];
    let xSamples = frames;

    for (let stageIndex = 0; stageIndex < stages.length; stageIndex++) {
      const st = stages[stageIndex];
      const [, outCh, K] = this.shapes.get(st.up + '.weight');
      const outSamples = (xSamples - 1) * st.stride - 2 * st.padding + K;

      // ConvTranspose1d, with the leaky ReLU folded in.
      const up = this.alloc(outCh * outSamples);
      this.runConvT(x, up, st.up + '.weight', st.up + '.bias',
                    xChannels, outCh, xSamples, outSamples, K, st.stride, st.padding, 0.1);

      // The residual bank: y1 per branch, then accumulate the y2s.
      const y1 = this.alloc(outCh * outSamples);
      const sum = this.alloc(outCh * outSamples);
      this.device.queue.writeBuffer(sum.buffer, 0, new Float32Array(outCh * outSamples));

      const branches = cfg[`stage${stageIndex}_branches`] || [0, 1, 2];
      for (const br of branches) {
        const p = `${st.bank}.blocks.${br}`;
        const K1 = this.shapes.get(`${p}.conv1.weight`)[2];
        const K2 = this.shapes.get(`${p}.conv2.weight`)[2];
        this.runBank(up, y1, p, outCh, outSamples, K1, BANK_DIL1[br], K2, BANK_DIL2[br], 0);
        this.runBank(y1, sum, p, outCh, outSamples, K1, BANK_DIL1[br], K2, BANK_DIL2[br], 1);
      }

      // The bank averages its branches.
      this.runScale(sum, 1 / branches.length, outCh * outSamples);

      x = sum;
      xChannels = outCh;
      xSamples = outSamples;
    }

    // post: leaky_relu(0.01) -> Conv1d(c3, 1, 7) -> tanh
    const c3 = channels[3];
    const post = this.alloc(xSamples);
    this.runConv1d(x, post, 'post.weight', 'post.bias',
                   c3, 1, xSamples, 7, 1, 3, 0.01, 1);

    const audio = this.alloc(xSamples);
    this.runTanh(post, audio, xSamples);

    const out = await this.read(audio, xSamples);
    this.releaseAll();
    return out;
  }

  /* -- individual passes -- */

  runConv1d(src, dst, weightName, biasName, inCh, outCh, samples, K,
            dilation, padding, leakySlope = 0, applyLeaky = 0) {
    const params = new ArrayBuffer(56);
    const u = new Uint32Array(params);
    const f = new Float32Array(params);
    u[0] = inCh; u[1] = outCh; u[2] = samples; u[3] = 0;
    u[4] = K; u[5] = dilation; u[6] = 1; u[7] = padding;
    u[8] = this.weightOffsets.get(weightName);
    u[9] = this.weightOffsets.get(biasName);
    u[10] = applyLeaky;
    f[12] = leakySlope;
    const uniform = this.makeUniform(params);

    const bind = this.device.createBindGroup({
      layout: this.conv1dPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: src.buffer } },
        { binding: 1, resource: { buffer: dst.buffer } },
        { binding: 2, resource: { buffer: this.weightBuffer } },
        { binding: 3, resource: { buffer: uniform } },
      ],
    });
    this.dispatch(this.conv1dPipeline, bind, Math.ceil(samples / WORKGROUP), outCh);
  }

  runConvT(src, dst, weightName, biasName, inCh, outCh, samples, outSamples,
            K, stride, padding, leakySlope = 0) {
    const params = new ArrayBuffer(56);
    const u = new Uint32Array(params);
    const f = new Float32Array(params);
    u[0] = inCh; u[1] = outCh; u[2] = samples; u[3] = outSamples;
    u[4] = K; u[5] = 1; u[6] = stride; u[7] = padding;
    u[8] = this.weightOffsets.get(weightName);
    u[9] = this.weightOffsets.get(biasName);
    u[10] = 1;
    f[12] = leakySlope;
    const uniform = this.makeUniform(params);

    const bind = this.device.createBindGroup({
      layout: this.convt1dPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: src.buffer } },
        { binding: 1, resource: { buffer: dst.buffer } },
        { binding: 2, resource: { buffer: this.weightBuffer } },
        { binding: 3, resource: { buffer: uniform } },
      ],
    });
    this.dispatch(this.convt1dPipeline, bind, Math.ceil(outSamples / WORKGROUP), outCh);
  }

  /**
   * One branch of the residual bank.
   *
   * mode 0 computes y1 into dst, mode 1 accumulates y2 into dst.
   *
   * The two convolutions of a branch have different dilations -- that is
   * what makes the bank's three branches look different from each other --
   * so they are passed in rather than assumed.
   */
  runBank(src, dst, prefix, channels, samples, K1, dil1, K2, dil2, mode) {
    const params = new ArrayBuffer(64);
    const u = new Uint32Array(params);
    u[0] = channels; u[1] = channels; u[2] = samples;
    u[3] = K1; u[4] = dil1; u[5] = K2; u[6] = dil2;
    u[7] = this.weightOffsets.get(`${prefix}.conv1.weight`);
    u[8] = this.weightOffsets.get(`${prefix}.conv1.bias`);
    u[9] = this.weightOffsets.get(`${prefix}.conv2.weight`);
    u[10] = this.weightOffsets.get(`${prefix}.conv2.bias`);
    u[11] = mode;
    const uniform = this.makeUniform(params);

    const bind = this.device.createBindGroup({
      layout: this.bankPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: src.buffer } },
        { binding: 1, resource: { buffer: dst.buffer } },
        { binding: 2, resource: { buffer: this.weightBuffer } },
        { binding: 3, resource: { buffer: uniform } },
      ],
    });
    this.dispatch(this.bankPipeline, bind, Math.ceil(samples / WORKGROUP), channels);
  }

  /** dst *= scale, in place. */
  runScale(dst, scale, count) {
    const params = new ArrayBuffer(16);
    new Uint32Array(params, 0, 2).set([count, 0]);
    new Float32Array(params, 8, 2).set([scale, 0]);
    const uniform = this.makeUniform(params);
    const bind = this.device.createBindGroup({
      layout: this.scalePipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: dst.buffer } },
        { binding: 1, resource: { buffer: uniform } },
      ],
    });
    this.dispatch(this.scalePipeline, bind, Math.ceil(count / WORKGROUP), 1);
  }

  runTanh(src, dst, count) {
    const params = new ArrayBuffer(16);
    new Uint32Array(params, 0, 4).set([count, 0, 0, 0]);
    const uniform = this.makeUniform(params);
    const bind = this.device.createBindGroup({
      layout: this.tanhPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: src.buffer } },
        { binding: 1, resource: { buffer: dst.buffer } },
        { binding: 2, resource: { buffer: uniform } },
      ],
    });
    this.dispatch(this.tanhPipeline, bind, Math.ceil(count / WORKGROUP), 1);
  }

  /** Read a buffer back to the CPU. */
  async read(entry, count) {
    const readback = this.device.createBuffer({
      size: count * 4,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
    });
    const encoder = this.device.createCommandEncoder();
    encoder.copyBufferToBuffer(entry.buffer, 0, readback, 0, count * 4);
    this.device.queue.submit([encoder.finish()]);
    await readback.mapAsync(GPUMapMode.READ);
    const out = new Float32Array(readback.getMappedRange().slice(0));
    readback.unmap();
    readback.destroy();
    return out;
  }
}
