/**
 * g2p.js — text to Piper phoneme ids.
 *
 * The model package is a raw neural stack: its input contract is a sequence
 * of Piper phoneme ids, not text. Converting text to those ids is espeak-ng's
 * job, so this wraps the espeak-ng WebAssembly build in `vendor/` -- the same
 * one upstream uses, and the only piece of the pipeline that is not
 * implemented here in JavaScript (espeak-ng is a large C translator whose
 * rules and dictionaries cannot be reasonably reimplemented).
 *
 * The espeak-ng module carries one codepoint -> id table per voice, and a
 * package's own `piper-phoneme-config.json` holds the map it was trained
 * with. That map identifies the table exactly: it is fingerprinted and
 * looked up below, so the right table is chosen rather than guessed.
 *
 * Slot numbers are the module's table order:
 *   0 en (kristin)   1 en-us (amy)   2 en-us (hfc)   3 vi   4 id   5 ne
 *   6 hi   7 cmn (zh)   8 de   9 fr   10 ru   11 es   12 it   13 pt-br
 *   14 ro   15 cs   16 ar   17 tr   18 pl
 */

const MAX_PHONEME_IDS = 8192;

/**
 * Which table slots carry which id table.
 *
 * The tables are shared between voices that were trained on the same symbol
 * set -- amy, vi, fr, ro and tr all use one table, for instance -- so a
 * table is identified by a fingerprint of its contents rather than by the
 * voice it happens to sit next to. Each entry lists the slots that hold that
 * table, with the espeak voice each one also selects.
 *
 * The fingerprints are of the whole table (codepoint -> id), computed the
 * same way as `tableFingerprint()` below. They were taken from the upstream
 * build of the phonemizer this module wraps.
 */
const TABLE_FINGERPRINTS = {
  240166162: [{ slot: 1, voice: 'en-us' }, { slot: 3, voice: 'vi' }, { slot: 9, voice: 'fr' }, { slot: 14, voice: 'ro' }, { slot: 17, voice: 'tr' }],
  327484320: [{ slot: 0, voice: 'en' }, { slot: 6, voice: 'hi' }, { slot: 12, voice: 'it' }],
  1376855658: [{ slot: 2, voice: 'en-us' }, { slot: 15, voice: 'cs' }, { slot: 16, voice: 'ar' }],
  1670374985: [{ slot: 4, voice: 'id' }, { slot: 5, voice: 'ne' }, { slot: 13, voice: 'pt-br' }],
  3845829536: [{ slot: 7, voice: 'cmn' }, { slot: 8, voice: 'de' }, { slot: 11, voice: 'es' }, { slot: 18, voice: 'pl' }],
  4140562980: [{ slot: 10, voice: 'ru' }],
};

/**
 * Fingerprint a codepoint -> id table.
 *
 * FNV-1a over the sorted (codepoint, id) pairs, so that the order the map
 * happens to be written in does not matter.
 */
function tableFingerprint(entries) {
  const sorted = entries.slice().sort((a, b) => a[0] - b[0]);
  let hash = 0x811c9dc5;
  for (const [codepoint, id] of sorted) {
    hash = Math.imul(hash ^ codepoint, 0x01000193) >>> 0;
    hash = Math.imul(hash ^ id, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

/**
 * espeak-ng writes dictionary-compile progress to stderr, which Emscripten
 * routes to console.error. For a dictionary that is present those lines are
 * noise; anything unrecognised still surfaces as an error.
 */
const G2P_CHATTER = /^(?:Can't read dictionary file|Using phonemetable|Compiling: )|^\s*\d+ entries\s*$|^\s*\d+ rules, \d+ groups|^\s*$/;

/**
 * Load the espeak-ng module.
 *
 * @param {string} vendorUrl  directory holding snt_g2p.{js,wasm,data}
 */
export async function loadG2P(vendorUrl) {
  const base = vendorUrl.endsWith('/') ? vendorUrl : vendorUrl + '/';

  // The Emscripten module is a classic script (it defines a global factory
  // rather than exporting one), so it is loaded as a script tag rather than
  // imported -- the same way upstream's page does it.
  const factory = await loadScript(base + 'snt_g2p.js', 'SaanoG2P');
  const mod = await factory({
    locateFile: (path) => base + path,
    printErr: (text) => {
      if (G2P_CHATTER.test(text)) console.debug('g2p:', text);
      else console.error('g2p:', text);
    },
  });

  const rc = mod._snt_g2p_init();
  if (rc !== 0) throw new Error(`espeak-ng failed to initialize (rc=${rc})`);

  return new Phonemizer(mod);
}

/** Inject a classic script tag and resolve the global it defines. */
function loadScript(url, globalName) {
  return new Promise((resolve, reject) => {
    const el = document.createElement('script');
    el.src = url;
    el.async = true;
    el.onload = () => {
      const value = globalThis[globalName];
      if (typeof value !== 'function') {
        reject(new Error(`${url} loaded but window.${globalName} is not a function`));
        return;
      }
      resolve(value);
    };
    el.onerror = () => reject(new Error(`failed to load ${url}`));
    document.head.appendChild(el);
  });
}

class Phonemizer {
  constructor(mod) {
    this.mod = mod;
    this.setVoice = mod.cwrap('snt_g2p_set_voice', 'number', ['string', 'number']);
    this.currentSlot = -1;
  }

  /**
   * Select the espeak voice and the id table to use.
   *
   * @param {string} espeakVoice  the voice's espeak name, e.g. "en-us"
   * @param {number} slot  the table slot within that voice
   */
  selectVoice(espeakVoice, slot) {
    if (this.currentSlot === slot) return;
    const rc = this.setVoice(espeakVoice, slot);
    if (rc !== 0) {
      throw new Error(`espeak-ng could not select voice ${espeakVoice} (rc=${rc})`);
    }
    this.currentSlot = slot;
  }

  /**
   * Text -> Piper phoneme ids.
   *
   * The returned sequence is framed the way the model expects:
   * BOS, PAD, (id, PAD)*, EOS.
   */
  phonemize(text) {
    const mod = this.mod;
    const bytes = mod.lengthBytesUTF8(text) + 1;
    const textPtr = mod._malloc(bytes);
    const idsPtr = mod._malloc(MAX_PHONEME_IDS * 4);
    try {
      mod.stringToUTF8(text, textPtr, bytes);
      const n = mod._snt_g2p_text_to_ids(textPtr, idsPtr, MAX_PHONEME_IDS);
      if (n <= 0) throw new Error(`phonemizer returned ${n}`);
      return new Int32Array(mod.HEAP32.buffer, idsPtr, n).slice();
    } finally {
      mod._free(textPtr);
      mod._free(idsPtr);
    }
  }

  /**
   * Find the table slot that matches a package's phoneme map.
   *
   * The package's own map is the id table it was trained against, so its
   * fingerprint identifies the slot directly. When several slots share a
   * table, the one whose espeak voice matches the package's is taken, since
   * the voice selects the rules and dictionary and the table selects the ids.
   *
   * @param {object} phonemes  as returned by loadPhonemeConfig
   * @returns {number} the slot number
   */
  resolveSlot(phonemes) {
    const voice = phonemes.espeakVoice;
    const fingerprint = tableFingerprint(phonemes.entries);
    const slots = TABLE_FINGERPRINTS[fingerprint];
    if (!slots) {
      throw new Error(`no espeak-ng id table matches this package's phoneme map`);
    }
    const match = slots.find((s) => s.voice === voice);
    if (!match) {
      throw new Error(`the phoneme map for voice "${voice}" is not one of the ` +
                      `tables this phonemizer carries`);
    }
    return match.slot;
  }
}
