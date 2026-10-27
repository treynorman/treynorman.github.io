/**
 * model-package.js — loader for a `roota.raw-fp16.v1` voice package.
 *
 * A package is three files:
 *   manifest.json             dims + a per-tensor table (name, shape, offset, nbytes)
 *   weights.fp16.bin          one flat fp16 blob; tensors are addressed by offset_bytes
 *   piper-phoneme-config.json codepoint -> phoneme-id table (espeak IPA symbols)
 *
 * Nothing here is specific to one voice: the dims, the tensor names, the
 * decoder's channel widths and the phoneme table all come from the package,
 * so any package in this format loads and runs.
 *
 * The fp16 -> fp32 widening happens here, once, at load time.
 */

/* -------------------------------------------------------------------------- */
/* fp16                                                                        */
/* -------------------------------------------------------------------------- */

/** Half-precision -> single-precision. Exact for every input, including subnormals. */
export function f16ToF32(h) {
  const sign = (h & 0x8000) ? -1 : 1;
  const exp = (h & 0x7c00) >> 10;
  const frac = h & 0x03ff;
  if (exp === 0) return sign * 6.103515625e-5 * (frac / 1024);   // 2^-14
  if (exp === 0x1f) return frac ? NaN : sign * Infinity;
  return sign * Math.pow(2, exp - 15) * (1 + frac / 1024);
}

/** View a whole fp16 weight blob as Uint16Array. */
export function fp16View(bytes) {
  const buf = ArrayBuffer.isView(bytes)
    ? bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
    : bytes;
  return new Uint16Array(buf);
}

/** Widen `count` fp16 values starting at `index` within a Uint16Array view. */
export function widenFp16From(view, index, count) {
  const out = new Float32Array(count);
  for (let i = 0; i < count; i++) out[i] = f16ToF32(view[index + i]);
  return out;
}

/* -------------------------------------------------------------------------- */
/* package loading                                                             */
/* -------------------------------------------------------------------------- */

/** Element count implied by a tensor's shape. */
function numel(shape) {
  let n = 1;
  for (const d of shape) n *= d;
  return n;
}

/**
 * Materialise every tensor of every component as a Float32Array, keyed by
 * name within its component.
 */
export function loadTensors(manifest, weightsBytes) {
  const f16 = fp16View(weightsBytes);
  const out = {};
  for (const [name, component] of Object.entries(manifest.components)) {
    const tensors = {};
    for (const t of component.tensors) {
      tensors[t.name] = {
        data: widenFp16From(f16, t.offset_bytes / 2, numel(t.shape)),
        shape: t.shape,
      };
    }
    out[name] = { tensors, config: component.config };
  }
  return out;
}

/**
 * Read the package's phoneme table.
 *
 * `phoneme_id_map` maps an espeak IPA codepoint to a phoneme id. Some voices
 * use a different front end (pinyin, for the Chinese voice), in which case
 * the map is keyed by whole initials/finals rather than single codepoints;
 * that is reported so the caller can say so rather than phonemize wrongly.
 */
export function loadPhonemeConfig(config) {
  const map = config.phoneme_id_map || {};
  const type = config.phoneme_type || 'espeak';
  const singleCodepoint = Object.keys(map).every((k) => [...k].length === 1);
  // Each entry maps a symbol to a list of ids; a voice may share one symbol
  // across several ids, so the set of "ids this voice knows" is the union.
  const ids = new Set();
  for (const value of Object.values(map)) {
    for (const id of value) ids.add(id);
  }
  // The table as (codepoint, id) pairs, which is what the phonemizer's
  // tables are fingerprinted over.
  const entries = [];
  for (const [symbol, value] of Object.entries(map)) {
    if ([...symbol].length !== 1 || !Array.isArray(value) || value.length !== 1) continue;
    entries.push([symbol.codePointAt(0), value[0]]);
  }
  return {
    type,
    espeakVoice: (config.espeak && config.espeak.voice) || null,
    map,
    singleCodepoint,
    ids,
    entries,
  };
}

/**
 * Load a package from a base URL, using only relative fetches.
 *
 * @param {string} baseUrl  directory holding the package files
 */
export async function loadPackage(baseUrl) {
  const base = baseUrl.endsWith('/') ? baseUrl : baseUrl + '/';

  const manifestRes = await fetch(base + 'manifest.json');
  if (!manifestRes.ok) throw new Error(`manifest.json: HTTP ${manifestRes.status}`);
  const manifest = await manifestRes.json();
  if (manifest.format !== 'roota.raw-fp16.v1') {
    throw new Error(`unsupported package format ${manifest.format}`);
  }

  const phonemeRes = await fetch(base + 'piper-phoneme-config.json');
  if (!phonemeRes.ok) throw new Error(`piper-phoneme-config.json: HTTP ${phonemeRes.status}`);
  const phonemeConfig = await phonemeRes.json();

  const weightsRes = await fetch(base + manifest.weights_file);
  if (!weightsRes.ok) throw new Error(`${manifest.weights_file}: HTTP ${weightsRes.status}`);

  const weightsBytes = await weightsRes.arrayBuffer();
  if (manifest.weights_size_bytes !== undefined &&
      manifest.weights_size_bytes !== weightsBytes.byteLength) {
    throw new Error(`${manifest.weights_file} is ${weightsBytes.byteLength} bytes, ` +
                    `manifest says ${manifest.weights_size_bytes}`);
  }

  // Integrity check when the page is served from a secure context.
  let sha256 = null;
  if (manifest.weights_sha256 && globalThis.crypto?.subtle) {
    const digest = await crypto.subtle.digest('SHA-256', weightsBytes);
    sha256 = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
    if (sha256 !== manifest.weights_sha256) {
      throw new Error(`${manifest.weights_file} sha256 mismatch (got ${sha256})`);
    }
  }

  const tensors = loadTensors(manifest, weightsBytes);
  const phonemes = loadPhonemeConfig(phonemeConfig);

  const parameters = Object.values(manifest.components)
    .reduce((sum, c) => sum + (c.parameters || 0), 0);

  return {
    manifest,
    phonemes,
    tensors,
    sha256,
    sampleRate: manifest.sample_rate,
    parameters,
    defaultLengthScale: Number(manifest.inference?.duration_length_scale ?? 1.0),
    maxTokens: manifest.components.duration.config.max_tokens,
  };
}
