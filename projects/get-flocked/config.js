/**
 * config.js — the knobs for the whole app.
 *
 * Everything that is likely to change between runs lives here: which
 * geolocation endpoint is queried, the two sentences the TTS engine speaks,
 * the tags those sentences pull out of the geolocation record, and the
 * order of the playlist.
 *
 * This file is plain ES module data. Edit it, reload the page, done --
 * there is no build step and nothing to install.
 */

/**
 * The geolocation lookup.
 *
 * `primary` is queried first; if it fails or answers with `success: false`
 * the lookup falls back to `fallback`. Both endpoints are called from the
 * browser, so both have to send permissive CORS headers (they do).
 *
 * `fields` maps a logical name onto the candidate keys of either endpoint.
 * ipwho.is nests the ISP under `connection.org`, ipapi.co puts it at the
 * top level as `org`, so each field lists both spellings.
 */
export const GEO = {
  primary: 'https://ipwho.is/',
  fallback: 'https://ipapi.co/json/',
  fields: {
    country: ['country_name', 'country'],
    region: ['region', 'state'],
    city: ['city'],
    org: ['connection.org', 'org'],
    ip: ['ip'],
  },
  // Used when the lookup fails or a field is missing, so the TTS engine
  // always has something to say.
  fallbackValue: 'Unknown',
};

/**
 * The TTS engine.
 *
 * `clips` is the list of sentences to synthesize at startup. Each clip gets
 * a `name` (which doubles as the playlist slot it fills) and a `template`
 * containing `{tag}` placeholders. Tags are looked up in the geolocation
 * record; see GEO.fields for the tag names that are available.
 *
 * `speed` is the speaking rate: 1.0 is the rate the voice was trained at,
 * 0.95 is a touch slower.
 */
export const TTS = {
  modelDir: 'tts/model/',
  vendorDir: 'tts/vendor/',
  worker: 'tts/worker.js',
  speed: 0.95,
  clips: [
    {
      name: 'audio2',
      template: "It looks like you're in the {city} {region} area right now.",
    },
    {
      name: 'audio4',
      template: 'Are you a {org} subscriber?',
    },
  ],
};

/**
 * The playlist.
 *
 * Entries are played in order. A name that matches one of the TTS clips
 * above is synthesized in the browser at startup; every other name is a
 * file under `dir` and is fetched as-is.
 */
export const PLAYLIST = [
  'audio1',
  'audio2',
  'audio3',
  'audio4',
  'audio5',
  'audio6',
  'audio7',
  'audio8',
  'audio9',
];

/**
 * The files that are fetched from `dir`.
 */
export const AUDIO_DIR = {
  dir: 'audio/',
  extension: '.wav',
};

/**
 * The video view.
 *
 * `mirror` flips the camera image horizontally, the way a mirror would.
 * The flip is applied to the canvas as a whole, so the red face circle and
 * the pupil dots stay glued to the face: the detection runs on the
 * unflipped pixels and the markers are drawn in the same coordinates, and
 * the canvas is mirrored on its way to the screen.
 */
export const VIDEO = {
  mirror: true,
};

/**
 * The audio output chain.
 *
 * Every clip -- the ones the speech engine generates and the ones in
 * `audio/` -- goes through the same chain, so they all come out at the
 * same level.
 *
 * The chain is a compressor, then makeup gain, then a soft limiter:
 *
 *   compressor -> makeup gain -> limiter -> speakers
 *
 * The compressor evens out the dynamics, so the quiet parts of the speech
 * come up and the loud parts are held back. The makeup gain then raises
 * the whole thing, which is what makes the quiet speech audible. The
 * limiter is the safety net: a soft clipper, so nothing can ever exceed
 * full scale, but it only starts working near the top.
 *
 * A DynamicsCompressorNode applies no makeup gain of its own, which is
 * why the gain stage is separate.
 */
export const AUDIO = {
  /** The compressor. Level and times are in the units the Web Audio API uses. */
  compressor: {
    // The clips sit around -23 dB RMS with peaks near -6 dB, so the
    // threshold is set low enough that the compressor is working on the
    // body of the speech, not just its peaks. That is what evens the
    // level out between the quiet and loud clips.
    threshold: -30,   // dB, above this the compressor starts working
    knee: 12,         // dB, the range over which it eases in
    ratio: 4,         // how hard it pulls the peaks down
    attack: 0.005,    // seconds, how fast it reacts
    release: 0.15,    // seconds, how fast it lets go
  },
  /** Makeup gain, in dB, applied after the compressor. */
  makeupGainDb: 8,
  /** The limiter's soft knee, as a fraction of full scale. */
  limiterKnee: 0.8,
};

/**
 * What happens when the face is lost.
 *
 * `lockFiles` is consulted by loss count: the first loss queues
 * lockFiles[0], the second lockFiles[1], the third lockFiles[2]. Loss
 * numbers past the end of the list are ignored.
 *
 * `debounceMs` is the dead time after an injection during which further
 * losses are swallowed. Without it, a face that flickers in and out of
 * frame would queue every lock file at once.
 *
 * `fallbackTrack` is the track that forces an injection: if the face has
 * not been lost by the time this track starts, lockFiles[0] is queued
 * anyway and the loss counter is advanced, so a later real loss still
 * produces the second lock file.
 */
export const FACE_LOCK = {
  lockFiles: ['lock1', 'lock2', 'lock2'],
  debounceMs: 6000,
  fallbackTrack: 'audio6',
};

/**
 * Playback timing.
 *
 * `startDelayMs` is how long the app waits after the camera comes up
 * before the first clip plays -- long enough for the TTS engine to finish
 * the two synthesized clips.
 */
export const PLAYBACK = {
  startDelayMs: 2000,
};

/**
 * The browser fingerprint.
 *
 * `timeoutMs` is how long to wait for the fingerprint and the location
 * before giving up on them.
 */
export const FINGERPRINT = {
  timeoutMs: 10000,
};

/**
 * The readout of captured identifiers.
 *
 * `header` is the bold line at the top. `{ms}` is replaced with how long
 * the capture took.
 *
 * `lines` is what goes under it, in the order it is listed. Each entry
 * names:
 *
 *   - `label`: what the line is called on screen
 *   - `source`: where the value comes from, as a path into the capture.
 *     "geo.city" is the city from the location lookup; "system.platform"
 *     is the platform from the fingerprint; "webrtc.video" is the video
 *     codec list.
 *   - `format`: optional, the name of one of the formatters in
 *     telemetry-text.js, for the values that need putting together.
 *
 * Take a line out by deleting it; put one back by adding it. A line whose
 * source has nothing behind it -- because the fingerprint could not be
 * captured, say -- is left out of the readout on its own.
 *
 * `scrollSpeed` is how fast the lines scroll upward, in pixels per second.
 * Slower is easier to read.
 */
export const TELEMETRY = {
  header: 'Face and other identifiers captured ({ms} ms)...',

  scrollSpeed: 12,

  lines: [
    { label: 'User Fingerprint', source: 'fingerprint', format: 'fingerprint' },

    // From ipwho.is. "Area" is the city: the location data is coarse,
    // so it is labelled for what it really is.
    { label: 'Country', source: 'geo.country' },
    { label: 'Region', source: 'geo.region' },
    { label: 'Area', source: 'geo.city' },
    { label: 'Connection', source: 'geo.org' },

    // From thumbmarkjs.
    { label: 'Browser', source: 'system', format: 'browserName' },
    { label: 'Plugins', source: 'plugins', format: 'pluginSummary' },
    { label: 'Mobile', source: 'system.mobile', format: 'yesNo' },
    { label: 'Apple Pay', source: 'system', format: 'applePay' },
    { label: 'Platform', source: 'system.platform' },
    { label: 'CPU cores', source: 'system.hardwareConcurrency' },
    { label: 'GPU', source: 'hardware', format: 'gpuName' },
    { label: 'Device memory', source: 'hardware', format: 'deviceMemory' },
    { label: 'JS heap limit', source: 'hardware', format: 'heapLimit' },
    { label: 'Display color depth', source: 'screen', format: 'colorDepth' },
    { label: 'Touchscreen', source: 'screen', format: 'touchscreen' },
    { label: 'Pointer', source: 'screen', format: 'pointer' },
    { label: 'Language', source: 'locales', format: 'languages' },
    { label: 'Timezone', source: 'locales.timezone' },
    { label: 'Audio: channels', source: 'audio', format: 'audioChannels' },
    { label: 'Audio devices', source: 'webrtc.audio', format: 'deviceSummary' },
    { label: 'Video devices', source: 'webrtc.video', format: 'deviceSummary' },
  ],
};
