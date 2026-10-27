/**
 * app.js — the orchestrator.
 *
 * The flow, in the order the spec lays it out:
 *
 *  1. On page load the caller's IP geolocation is looked up.
 *  2. The TTS engine immediately starts generating the two clips from that
 *     geolocation, in the background.
 *  3. The pico.js face/pupil detector asks for the camera, and the wait for
 *     the user to grant it is what gives the TTS engine time to work.
 *  4. Two seconds after the camera comes up, the playlist starts playing.
 *  5. Losing face lock injects a lock file into the queue.
 *  6. Alongside all of it, the browser fingerprint is captured and shown
 *     on screen.
 *
 * Everything that is worth changing lives in config.js.
 */

import { GEO, TTS, PLAYLIST, AUDIO_DIR, VIDEO, FACE_LOCK, PLAYBACK, FINGERPRINT, TELEMETRY } from './config.js';
import { fetchGeo, renderTemplate } from './geo.js';
import { TtsEngine } from './tts.js';
import { FaceLock } from './lock.js';
import { Playlist } from './playlist.js';
import { Player } from './player.js';
import { TelemetryPanel } from './telemetry-panel.js';

/** The generated clips, by playlist name. */
const generated = new Map();

/** Where the face-lock state machine is kept. */
const lock = new FaceLock({
  lockFiles: FACE_LOCK.lockFiles,
  debounceMs: FACE_LOCK.debounceMs,
});

const playlist = new Playlist();

const player = new Player({
  onTrackStart: handleTrackStart,
  onTrackEnd: handleTrackEnd,
});

/** Where the captured identifiers are shown. */
const panel = new TelemetryPanel({
  root: document.getElementById('telemetry'),
  scrollSpeed: TELEMETRY.scrollSpeed,
});

/* ------------------------------------------------------------------ *
 * The clips the TTS engine produces
 * ------------------------------------------------------------------ */

/**
 * The URL of a file in the audio directory.
 *
 * The path is relative to this module, which sits in the app directory
 * next to the audio folder.
 */
function audioUrl(name) {
  return new URL(AUDIO_DIR.dir + name + AUDIO_DIR.extension, import.meta.url).href;
}

/**
 * Start generating one clip.
 *
 * The promise is stored right away, so a track can wait for its clip
 * instead of missing it: the playlist reaches audio2.wav while the engine
 * may still be working on it.
 *
 * @param {TtsEngine} engine
 * @param {object} clip
 * @param {Promise<object>} geo  the geolocation, once it is known
 */
function generateClip(engine, clip, geo) {
  const speed = clip.speed ?? TTS.speed;

  const promise = geo.then((location) => {
    const text = renderTemplate(clip.template, location);
    console.log(`[combo] generating ${clip.name}: "${text}" (speed ${speed})`);
    return engine.synthesize(text, speed);
  }).then((result) => {
    console.log(`[combo] ${clip.name} ready: ${result.seconds.toFixed(2)}s of audio`);
    return result;
  }).catch((error) => {
    console.error(`[combo] ${clip.name} failed to synthesize:`, error);
    return null;
  });

  generated.set(clip.name, promise);
  return promise;
}

/**
 * The audio for a playlist entry.
 *
 * A name the TTS engine produces is served from the generated clip; every
 * other name is a file in the audio directory. If the generated clip fails,
 * a file of the same name on disk is used instead, so the playlist still
 * plays.
 */
function resolveTrack(name) {
  const pending = generated.get(name);
  if (!pending) return player.decode(audioUrl(name));

  const fromDisk = () => player.decode(audioUrl(name));
  return pending.then((result) => (result ? player.decode(result.url) : fromDisk()),
                       () => fromDisk());
}

/* ------------------------------------------------------------------ *
 * The playlist
 * ------------------------------------------------------------------ */

function buildPlaylist() {
  const items = PLAYLIST.map((name) => ({
    name,
    buffer: () => resolveTrack(name),
  }));
  playlist.set(items);
}

/**
 * A track started playing.
 *
 * The fallback lives here: if the face has still not been lost by the time
 * audio6.wav comes up, lock1.wav is queued anyway and the loss counter is
 * advanced, so a later real loss still counts as the second one.
 */
function handleTrackStart(track) {
  console.log(`[combo] playing ${track.name}`);

  if (track.name !== FACE_LOCK.fallbackTrack) return;

  const file = lock.fallback();
  if (!file) return;
  console.log(`[combo] face never lost by ${track.name}: queueing ${file}.wav`);
  injectAfterCurrent(file);
}

function handleTrackEnd(track) {
  console.log(`[combo] finished ${track.name}`);
}

/**
 * Queue a track right after the one that is playing.
 *
 * The queue ends with the playlist it was given, so there is nothing to
 * queue once the last clip is playing: a lock file then has nowhere to go
 * and is dropped.
 *
 * @param {string} name  the file name without extension
 * @returns {boolean}  true if it was queued
 */
function injectAfterCurrent(name) {
  const item = {
    name,
    buffer: () => resolveTrack(name),
  };

  if (!playlist.injectAfterCurrent(item)) {
    console.log(`[combo] not queuing ${name}.wav: the playlist is over`);
    return false;
  }

  // Decode it now, so it is ready when its turn comes.
  player.prefetch(item);
  console.log(`[combo] queued ${name}.wav after ${playlist.current?.name ?? 'the start'}`);
  return true;
}

/* ------------------------------------------------------------------ *
 * Face lock
 * ------------------------------------------------------------------ */

/**
 * The detector's state for the current frame.
 *
 * The lock is held while a face is being seen and lost when the face
 * disappears; the lock file is queued when that happens.
 */
function handleFaceLock(event) {
  const file = lock.update(!!event.detail?.locked);
  if (!file) return;
  console.log(`[combo] face lock lost: queueing ${file}.wav`);
  injectAfterCurrent(file);
}

/* ------------------------------------------------------------------ *
 * Start-up
 * ------------------------------------------------------------------ */

/**
 * Look the caller up and start the TTS engine.
 *
 * The clip promises are registered before the lookup is awaited, so the
 * playlist cannot reach a generated clip before it knows about it.
 */
function startTelemetryAndTts() {
  const engine = new TtsEngine(TTS);

  const geo = fetchGeo().then((location) => {
    console.log('[combo] geolocation:', location);
    return location;
  }).catch((error) => {
    console.error('[combo] geolocation failed:', error);
    // The engine still speaks, with what it knows.
    const unknown = {};
    for (const key of Object.keys(GEO.fields)) unknown[key] = GEO.fallbackValue;
    return unknown;
  });

  for (const clip of TTS.clips) {
    generateClip(engine, clip, geo);
  }
}

/**
 * Capture the fingerprint and the location, and show them.
 *
 * This runs alongside the speech engine rather than in front of it, so the
 * capture does not delay the first clip.
 *
 * The fingerprint is loaded on purpose, rather than with a plain import at
 * the top of the file. If it is missing, blocked, or broken, the page must
 * still work: the fingerprint is one part of the readout, and the app is
 * more than that. A failed load is reported and the readout carries on
 * without it.
 */
async function startFingerprintCapture() {
	let captureFingerprint = null;

	try {
		const module = await import('./fingerprint.js');
		captureFingerprint = module.captureFingerprint;
	} catch (error) {
		console.warn('[combo] the fingerprint module could not be loaded:', error);
	}

	if (!captureFingerprint) {
		// Without the fingerprint there is still the location to show.
		showTelemetry({ fingerprint: false });
		return;
	}

	try {
		const capture = await captureFingerprint({ timeout: FINGERPRINT.timeoutMs });
		console.log(`[combo] fingerprint captured in ${capture.ms} ms`);
		if (capture.errors.length) {
			console.warn('[combo] capture problems:', capture.errors);
		}
		showTelemetry(capture);
	} catch (error) {
		console.error('[combo] fingerprint capture failed:', error);
		showTelemetry({ fingerprint: false });
	}
}

/**
 * Show the readout, with whatever was captured.
 *
 * The location is fetched separately from the fingerprint, so the readout
 * still has the geolocation data when the fingerprint is unavailable.
 */
async function showTelemetry(capture) {
	let geo = null;
	let geoMs = 0;

	const geoStarted = performance.now();
	try {
		geo = await fetchGeo();
		geoMs = Math.round(performance.now() - geoStarted);
	} catch (error) {
		console.warn('[combo] geolocation for the readout failed:', error);
	}

	// The time in the heading is how long the capture took. With no
	// fingerprint, it is the time the location took.
	const ms = capture.ms ?? geoMs;

	const shown = {
		ms,
		thumbmark: capture.thumbmark ?? '',
		components: capture.components ?? {},
		geo: capture.geo ?? geo,
		errors: capture.errors ?? [],
	};

	panel.show(shown);
	window.combo.capture = shown;
}

/**
 * Start playing once the camera is up.
 */
function startPlayback() {
  if (player.playing) return;
  console.log('[combo] starting playback');
  player.play(playlist).catch((error) => {
    console.error('[combo] playback failed:', error);
  });
}

function main() {
  // Mirror the view, if the config says so.
  document.body.classList.toggle('mirrored', VIDEO.mirror);

  document.addEventListener('combo:face-lock', handleFaceLock);

  document.addEventListener('combo:camera-ready', () => {
    console.log('[combo] camera ready');
    setTimeout(startPlayback, PLAYBACK.startDelayMs);
  });

  // Watch for the camera being refused, so playback can start anyway.
  // Wrapping getUserMedia is the only way to hear about it: the request
  // is made by the detector script, which only knows how to throw.
  watchCamera();

  buildPlaylist();
  startTelemetryAndTts();
  startFingerprintCapture();

  // A small API for driving the app from the console, and for saving the
  // generated clips into the audio directory.
  window.combo = {
    geo: GEO,
    tts: TTS,
    playlist,
    player,
    lock,
    generated,
    /**
     * Write the generated clips into the audio directory.
     *
     * Uses the File System Access API where it exists, so the clips land
     * next to the static ones; elsewhere they are downloaded.
     */
    async saveClips() {
      const pairs = [];
      for (const [name, promise] of generated) {
        const result = await promise;
        if (!result) continue;
        pairs.push({ name: name + AUDIO_DIR.extension, blob: result.blob });
      }
      if (!pairs.length) throw new Error('no clips have been generated yet');

      if (window.showDirectoryPicker) {
        const dir = await window.showDirectoryPicker({ mode: 'readwrite' });
        for (const { name, blob } of pairs) {
          const handle = await dir.getFileHandle(name, { create: true });
          const writable = await handle.createWritable();
          await writable.write(blob);
          await writable.close();
          console.log(`[combo] saved ${name}`);
        }
        return pairs.map((p) => p.name);
      }

      for (const { name, blob } of pairs) {
        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.download = name;
        link.click();
        URL.revokeObjectURL(link.href);
      }
      return pairs.map((p) => p.name);
    },
  };
}

/**
 * Notice when the camera is refused.
 *
 * The detector asks for the camera itself, so the request is wrapped here
 * to turn a refusal into an event. Without a camera the playlist still
 * plays; it just never reacts to the face.
 */
function watchCamera() {
  const devices = navigator.mediaDevices;
  if (!devices?.getUserMedia) return;

  const original = devices.getUserMedia.bind(devices);
  devices.getUserMedia = async (constraints) => {
    try {
      return await original(constraints);
    } catch (error) {
      console.warn('[combo] no camera:', error.message);
      document.dispatchEvent(new CustomEvent('combo:camera-error', { detail: error }));
      throw error;
    }
  };

  document.addEventListener('combo:camera-error', () => {
    setTimeout(startPlayback, PLAYBACK.startDelayMs);
  });
}

main();
