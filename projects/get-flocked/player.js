import { AUDIO } from './config.js';

/**
 * player.js — WAV playback.
 *
 * A single AudioContext plays the playlist one track at a time. Each track
 * is fetched and decoded once and then scheduled, so a track that comes up
 * later in the playlist (an injected lock file, say) starts without delay.
 *
 * Everything is routed through one output chain -- a compressor, a makeup
 * gain and a soft limiter -- so the clips the speech engine generates and
 * the ones in `audio/` come out at the same level.
 *
 * The AudioContext is created lazily and resumed on the first user gesture,
 * because browsers keep a context suspended until the user interacts with
 * the page. A suspended context does not run its clock, so nothing would
 * ever be heard and no track would ever end -- the player resumes the
 * context whenever it can, and says so when it is waiting for a gesture.
 */

/**
 * A soft-clipping curve for the limiter.
 *
 * Below the knee the signal passes through untouched. Above it the curve
 * rolls off smoothly, so a peak is squeezed rather than cut off -- the
 * characteristic of a limiter.
 *
 * @param {number} knee  where the roll-off starts, 0..1
 * @returns {Float32Array} the curve for a WaveShaperNode
 */
export function softClipCurve(knee) {
  const samples = 2048;
  const curve = new Float32Array(samples);
  for (let i = 0; i < samples; i++) {
    // The node maps input [-1, 1] onto the curve.
    const x = (i / (samples - 1)) * 2 - 1;
    const magnitude = Math.abs(x);
    if (magnitude <= knee) {
      curve[i] = x;
    } else {
      // Roll off above the knee. The curve is built so that the top of
      // the range maps to exactly full scale: an over-range input is
      // brought to 1.0 rather than past it, and the approach is smooth,
      // so it is squeezed rather than cut off.
      const over = (magnitude - knee) / (1 - knee);
      const shaped = knee + (1 - knee) * (1 - Math.exp(-over * 3));
      curve[i] = Math.sign(x) * Math.min(1, shaped);
    }
  }
  return curve;
}

export class Player {
  /**
   * @param {object} options
   * @param {(track: object) => void} [options.onTrackStart]
   * @param {(track: object) => void} [options.onTrackEnd]
   */
  constructor({ onTrackStart, onTrackEnd } = {}) {
    this.ctx = null;
    this.playlist = null;
    this.onTrackStart = onTrackStart;
    this.onTrackEnd = onTrackEnd;
    this.playing = false;
    this.gestureBound = false;
    // Decoded audio, by track name. The next track is decoded while the
    // current one plays, so the queue does not gap between tracks.
    this.decoded = new Map();
    // The output chain, built with the context.
    this.compressor = null;
    this.makeup = null;
    this.limiter = null;
  }

  /**
   * The AudioContext, created on first use.
   */
  context() {
    if (!this.ctx) {
      const Ctor = window.AudioContext || window.webkitAudioContext;
      this.ctx = new Ctor();
      // The context can be suspended again -- by the browser, or by the
      // tab going into the background. Resume it whenever it wakes up.
      this.ctx.addEventListener?.('statechange', () => this.resume());
      this.buildOutputChain();
    }
    return this.ctx;
  }

  /**
   * Build the compressor -> makeup gain -> limiter chain.
   *
   * The compressor pulls the peaks down so the gain stage can push
   * everything up without clipping, and the limiter catches whatever
   * still manages to get through.
   */
  buildOutputChain() {
    const ctx = this.ctx;

    this.compressor = ctx.createDynamicsCompressor();
    const c = AUDIO.compressor;
    this.compressor.threshold.value = c.threshold;
    this.compressor.knee.value = c.knee;
    this.compressor.ratio.value = c.ratio;
    this.compressor.attack.value = c.attack;
    this.compressor.release.value = c.release;

    this.makeup = ctx.createGain();
    this.makeup.gain.value = Math.pow(10, AUDIO.makeupGainDb / 20);

    this.limiter = ctx.createWaveShaper();
    this.limiter.curve = softClipCurve(AUDIO.limiterKnee);
    // No oversampling: it would interpolate between the curve's points
    // and could overshoot them, letting a sample past full scale. The
    // curve is smooth enough that the steps do not show.
    this.limiter.oversample = 'none';

    this.compressor.connect(this.makeup);
    this.makeup.connect(this.limiter);
    this.limiter.connect(ctx.destination);
  }

  /**
   * Resume the context if it is suspended.
   *
   * @returns {boolean} whether the context is running
   */
  resume() {
    const ctx = this.ctx;
    if (!ctx || ctx.state === 'running') return true;
    ctx.resume().catch(() => {});
    return ctx.state === 'running';
  }

  /**
   * Resume the context on the next user gesture.
   *
   * Browsers block audio until the page has been interacted with; the
   * camera permission prompt does not count as an interaction with the
   * page, so a click on the video (or any keypress) is what unlocks sound.
   */
  resumeOnGesture() {
    if (this.gestureBound) return;
    this.gestureBound = true;
    const resume = () => this.resume();
    for (const event of ['pointerdown', 'keydown', 'touchend', 'click']) {
      window.addEventListener(event, resume, { passive: true });
    }
  }

  /**
   * Fetch and decode a WAV file.
   *
   * @param {string} url
   * @returns {Promise<AudioBuffer>}
   */
  async decode(url) {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
    const bytes = await response.arrayBuffer();
    return await this.context().decodeAudioData(bytes);
  }

  /**
   * Decode a track ahead of time.
   *
   * The buffer is remembered, so asking for it again does not fetch or
   * decode it a second time.
   *
   * @param {object} track  the track to prepare
   * @returns {Promise<AudioBuffer|null>} the buffer, or null if it failed
   */
  prefetch(track) {
    if (!track) return Promise.resolve(null);
    if (!this.decoded.has(track.name)) {
      const promise = track.buffer()
        .catch((error) => {
          console.error(`[combo] could not decode ${track.name}:`, error.message);
          return null;
        });
      this.decoded.set(track.name, promise);
    }
    return this.decoded.get(track.name);
  }

  /**
   * Play a playlist from the beginning.
   *
   * @param {Playlist} playlist
   */
  async play(playlist) {
    this.playlist = playlist;
    this.playing = true;
    this.resumeOnGesture();

    if (!this.resume()) {
      console.warn('[combo] audio is waiting for an interaction with the page');
    }

    while (this.playing) {
      const track = this.playlist.next();
      if (!track) {
        // The queue is empty, and nothing can be added to it: the playlist
        // ends with the clip it was given, so there is no more to play.
        break;
      }

      // Get the next one ready while this one plays.
      this.prefetch(this.playlist.upcoming[0]);

      const buffer = await this.prefetch(track);
      if (!buffer) {
        this.onTrackEnd?.(track);
        continue;
      }

      const source = this.context().createBufferSource();
      source.buffer = buffer;
      // Into the compressor, not straight to the speakers, so every clip
      // gets the same treatment.
      source.connect(this.compressor);

      // Tell the playlist what is playing, so an injection lands after it.
      this.playlist.startPlaying(track);
      this.onTrackStart?.(track);

      await new Promise((resolve) => {
        source.onended = resolve;
        source.start(0);
      });

      this.playlist.stopPlaying(track);
      this.onTrackEnd?.(track);
    }
  }

  /** Stop playback after the current track. */
  stop() {
    this.playing = false;
  }
}
