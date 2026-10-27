/**
 * audio.js — PCM to a playable WAV.
 *
 * The decoder emits mono float samples at the model's sample rate. Browsers
 * play WAV natively, so the samples are wrapped in a RIFF container and handed
 * to the page as a blob URL; no audio library is needed.
 */

/**
 * Encode mono float samples as a 16-bit PCM WAV file.
 *
 * @param {Float32Array} samples  mono PCM in [-1, 1]
 * @param {number} sampleRate
 * @returns {Blob}
 */
export function encodeWav(samples, sampleRate) {
  const bytesPerSample = 2;
  const dataBytes = samples.length * bytesPerSample;
  const buffer = new ArrayBuffer(44 + dataBytes);
  const view = new DataView(buffer);

  const ascii = (offset, text) => {
    for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i));
  };

  ascii(0, 'RIFF');
  view.setUint32(4, 36 + dataBytes, true);      // chunk size
  ascii(8, 'WAVE');
  ascii(12, 'fmt ');
  view.setUint32(16, 16, true);                // fmt chunk size
  view.setUint16(20, 1, true);                 // PCM
  view.setUint16(22, 1, true);                 // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * bytesPerSample, true); // byte rate
  view.setUint16(32, bytesPerSample, true);    // block align
  view.setUint16(34, 8 * bytesPerSample, true);// bits per sample
  ascii(36, 'data');
  view.setUint32(40, dataBytes, true);

  let offset = 44;
  for (let i = 0; i < samples.length; i++) {
    // Clamp before scaling: the decoder can overshoot [-1, 1] slightly.
    let s = samples[i];
    if (s > 1) s = 1; else if (s < -1) s = -1;
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    offset += bytesPerSample;
  }
  return new Blob([buffer], { type: 'audio/wav' });
}
