/**
 * chunking.js — split long text into synthesizable pieces.
 *
 * The rule matches the upstream browser demo and the Hugging Face WebGPU
 * space: sentences first, then clause punctuation, then a word boundary.
 *
 * Why chunk at all: the duration student has a `max_tokens` window, and the
 * acoustic student's frame expansion grows with the token count, so a long
 * paragraph is both slower and less accurate than the same text split into
 * sentence-sized pieces. Splitting also lets playback start on the first
 * sentence instead of after the whole paragraph.
 *
 * The exact split rule is shared with upstream, so the same text produces
 * the same chunks -- and therefore the same audio -- as the reference
 * implementation.
 */

const MAX_CHARS = 120;
const MIN_CHARS = 40;

// Sentence terminators, including the CJK full stops.
const SENTENCE_RE = /[^.!?।。！？]+[.!?।。！？]*\s*/g;

// Clause breaks preferred when a sentence has to be cut further.
const CLAUSE_RE = /[,;:、，；：]\s*/g;

/**
 * Split text into chunks small enough to synthesize.
 *
 * @param {string} text
 * @returns {string[]} at least one chunk
 */
export function splitChunks(text) {
  const sentences = text.match(SENTENCE_RE) || [text];

  // A full stop between two digits is a decimal point, not the end of a
  // sentence. Without this, "3.5" is cut into "3." and "5" before the
  // phonemizer ever sees it, and the voice says "three ... five" instead of
  // "three point five".
  for (let i = sentences.length - 2; i >= 0; i--) {
    if (/\p{Nd}\.$/u.test(sentences[i].trimEnd()) && /^\s*\p{Nd}/u.test(sentences[i + 1])) {
      sentences[i] = sentences[i].trimEnd() + sentences[i + 1];
      sentences.splice(i + 1, 1);
    }
  }

  const chunks = [];
  for (let sentence of sentences) {
    sentence = sentence.trim();
    if (!sentence) continue;
    while (sentence.length > MAX_CHARS) {
      let cut = -1;
      // Prefer a clause break inside the usable window.
      for (const m of sentence.matchAll(CLAUSE_RE)) {
        const end = m.index + m[0].length;
        if (end >= MIN_CHARS && end <= MAX_CHARS) cut = end;
      }
      if (cut < 0) {
        // Otherwise break at the last word boundary.
        const sp = sentence.lastIndexOf(' ', MAX_CHARS);
        cut = sp > MIN_CHARS ? sp + 1 : MAX_CHARS;
      }
      chunks.push(sentence.slice(0, cut).trim());
      sentence = sentence.slice(cut).trim();
    }
    if (sentence) chunks.push(sentence);
  }
  return chunks.length ? chunks : [text];
}

/**
 * Decide how to synthesize a piece of text.
 *
 * The whole text is used as one piece when it fits the model's token window
 * -- that is the accurate path, and it matches the reference implementation
 * exactly. Longer text is split into sentence-sized pieces, each phonemized
 * on its own so that it carries its own beginning and end of utterance.
 *
 * The whole text's ids are passed in rather than counted, so the text is
 * only phonemized once.
 *
 * @param {string} text
 * @param {Int32Array|number[]} wholeIds  ids for the whole text
 * @param {(chunk: string) => Int32Array} phonemize  ids for one piece
 * @param {number} maxTokens  the model's token window
 * @returns {Int32Array[]} the pieces to synthesize
 */
export function planChunks(text, wholeIds, phonemize, maxTokens) {
  if (wholeIds.length <= maxTokens) return [wholeIds];
  return splitChunks(text)
    .map((piece) => phonemize(piece))
    .filter((ids) => ids.length > 3);
}
