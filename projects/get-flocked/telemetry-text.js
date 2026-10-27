/**
 * telemetry-text.js — the text the app shows the user.
 *
 * The first line is static and bold: how long the capture took. The lines
 * under it are the data itself, and they scroll slowly upward.
 *
 * Which lines appear, in what order, and how they are labelled is all set
 * in the TELEMETRY section of config.js. This file only knows how to turn
 * the captured data into the strings that go on screen.
 *
 * The labels are the friendly names; the values come from thumbmarkjs and
 * ipwho.is. Where the two disagree on a name -- "Area" for the city, for
 * instance -- the friendly name wins, because that is what a person
 * reading it expects to see.
 */

import { TELEMETRY } from './config.js';

/**
 * Build the lines of text.
 *
 * @param {object} capture  the result of captureFingerprint()
 * @returns {{header: string, lines: Array<{label: string, value: string}>}}
 */
export function buildTelemetry(capture) {
	const context = buildContext(capture);

	const header = String(TELEMETRY.header ?? 'Face and other identifiers captured ({ms} ms)...')
		.replace('{ms}', String(capture.ms ?? 0));

	const lines = [];

	for (const entry of TELEMETRY.lines ?? []) {
		const value = readValue(entry, context);
		// A line with nothing behind it is left out entirely, rather than
		// shown as a row of dashes.
		if (value === '' || value === undefined || value === null) continue;

		lines.push({ label: entry.label, value });
	}

	return { header, lines };
}

/**
 * The captured data, arranged so that a config entry can point at it.
 *
 * The pieces that come from the fingerprint are left out when there is no
 * fingerprint, so the lines that depend on them drop out of the readout
 * on their own.
 */
function buildContext(capture) {
	const components = capture.components ?? {};

	const context = {
		fingerprint: capture.thumbmark || undefined,
		geo: capture.geo ?? undefined,
	};

	// The fingerprint's own pieces. Each one is only there when the
	// fingerprint was captured.
	if (Object.keys(components).length) {
		context.system = components.system;
		context.hardware = components.hardware;
		context.locales = components.locales;
		context.screen = components.screen;
		context.audio = components.audio;
		context.plugins = components.plugins;
		context.webrtc = components.webrtc?.details;
	}

	return context;
}

/**
 * Read the value for one config entry.
 *
 * The `source` is a path into the context, such as "geo.city" or
 * "system.platform". The optional `format` names one of the formatters
 * below, for the values that need a bit of putting together.
 */
function readValue(entry, context) {
	const raw = resolve(context, entry.source);

	if (raw === undefined || raw === null) return '';

	const formatter = entry.format ? FORMATTERS[entry.format] : null;
	if (!formatter) return formatValue(raw);

	return formatter(raw, context);
}

/**
 * Follow a dotted path into the context.
 */
function resolve(context, path) {
	if (!path) return undefined;

	return String(path).split('.').reduce((value, key) => {
		if (value === undefined || value === null) return undefined;
		return value[key];
	}, context);
}

/**
 * The value on its own, with nothing special done to it.
 */
function formatValue(value) {
	if (typeof value === 'object') return '';
	if (value === '') return '';
	return String(value);
}

/* ------------------------------------------------------------------ *
 * The formatters
 *
 * Each one takes the value the config entry points at, and returns the
 * string that goes on screen.
 * ------------------------------------------------------------------ */

const FORMATTERS = {
	/** The fingerprint, shortened. */
	fingerprint: (value) => truncate(value, 14),

	/** Yes or No. */
	yesNo: (value) => {
		if (value === undefined || value === null) return '';
		return value ? 'Yes' : 'No';
	},

	/** The browser, with the engine version. */
	browserName: (system) => {
		const browser = system?.browser ?? {};
		if (!browser.name) return '';

		const version = browser.version ? ` ${browser.version}` : '';

		// The engine version is in the user agent as "Gecko/20100101".
		const ua = system.useragent ?? '';
		const gecko = /Gecko\/(\d+)/.exec(ua);
		const engine = gecko ? ` (Gecko ${gecko[1]})` : '';
		return `${browser.name}${version}${engine}`;
	},

	/** The plugins, counted by name. */
	pluginSummary: (plugins) => {
		const list = plugins?.plugins;
		if (!Array.isArray(list) || !list.length) return '';

		// Each entry is "name|filename|description".
		const entries = list.map((entry) => {
			const [name = '', filename = '', description = ''] = String(entry).split('|');
			return { name, filename, description };
		});

		// Group by the file they come from.
		const groups = new Map();
		for (const entry of entries) {
			const key = entry.filename || entry.name;
			if (!groups.has(key)) groups.set(key, []);
			groups.get(key).push(entry);
		}

		const parts = [];
		for (const [filename, group] of groups) {
			if (group.length === 1) {
				parts.push(group[0].name || filename);
				continue;
			}
			const variants = group.map((entry) => variantName(entry.name)).join(', ');
			parts.push(`${group.length}× ${pluginLabel(group)} variants (${variants}) — all "${filename}"`);
		}
		return parts.join(', ');
	},

	/** Whether Apple Pay is available, and which version. */
	applePay: (system) => {
		const version = system?.applePayVersion;
		if (!version) return 'Not present';
		return `Present (version ${version})`;
	},

	/** The graphics card. */
	gpuName: (hardware) => {
		const card = hardware?.videocard;
		if (!card || card === 'undefined') return '';

		const renderer = card.rendererUnmasked ?? card.renderer;
		if (!renderer) return '';

		const parts = [renderer];
		const versions = [card.version, shadingVersion(card.shadingLanguageVersion)].filter(Boolean);
		if (versions.length) parts.push(`(${versions.join(', ')})`);
		if (card.vendor) parts.push(`— vendor "${card.vendor}"`);
		return parts.join(' ');
	},

	/** The amount of memory, in gigabytes. */
	deviceMemory: (hardware) => {
		const value = hardware?.deviceMemory;
		if (value === undefined || value === null || value === '' || value === '0') {
			return '0 (not exposed)';
		}
		return `${value} GB`;
	},

	/** The JavaScript heap limit, in megabytes. */
	heapLimit: (hardware) => {
		const value = hardware?.jsHeapSizeLimit;
		if (!value) return '0 (not exposed)';
		return `${Math.round(value / 1024 / 1024)} MB`;
	},

	/** The screen's colour depth. */
	colorDepth: (screen) => {
		if (!screen?.colorDepth) return '';
		return `${screen.colorDepth}-bit`;
	},

	/** Whether there is a touchscreen, and how many points it reports. */
	touchscreen: (screen) => {
		const points = screen?.maxTouchPoints;
		if (points === undefined || points === null) return '';
		return points ? `Yes (${points} touch points)` : `No (${points} touch points)`;
	},

	/** The pointer type. */
	pointer: (screen) => {
		const matches = Array.isArray(screen?.mediaMatches) ? screen.mediaMatches : [];
		const pointerMatch = matches.find((m) => m.startsWith('pointer:'));
		if (!pointerMatch) return '';
		const type = pointerMatch.split(': ')[1];
		return type === 'fine' ? 'fine (mouse)' : type;
	},

	/** The languages, with their quality values. */
	languages: (locales) => {
		const list = Array.isArray(navigator?.languages) && navigator.languages.length
			? navigator.languages
			: [locales?.languages].filter(Boolean);
		if (!list.length) return '';

		const qualities = list.map((_, index) => (index === 0 ? '1.0' : (1 - index / 10).toFixed(1)));
		return `${list.join(', ')} (q ${qualities.join(' / ')})`;
	},

	/** The number of audio channels, and the mode they are mixed in. */
	audioChannels: (audio) => {
		const channels = audio?.maxChannels;
		if (!channels) return '';
		return `${channels} (mode: ${audio.channelCountMode ?? 'unknown'})`;
	},

	/** The audio and video entries the browser exposes. */
	deviceSummary: (entry) => {
		if (!entry || !entry.count) return '';
		return `${entry.count} entries exposed (hash ${truncate(entry.hash, 8)})`;
	},
};

/* ------------------------------------------------------------------ *
 * Small helpers
 * ------------------------------------------------------------------ */

/** Shorten a hash for display, with an ellipsis. */
function truncate(value, length) {
	if (!value) return '';
	return String(value).length > length ? `${String(value).slice(0, length)}…` : String(value);
}

/**
 * The short name of a plugin variant.
 *
 * The PDF viewers are all called "<something> PDF Viewer", so the common
 * part is dropped and what is left names the variant. The plain "PDF
 * Viewer" has nothing left, and is called "generic".
 */
function variantName(name) {
	const stripped = String(name)
		.replace(/\s*PDF\s*Viewer\s*$/i, '')
		.replace(/\s*built-in\s*PDF\s*$/i, '')
		.replace(/^Microsoft\s+/i, '')
		.trim();
	return stripped || 'generic';
}

/** What the group of plugins is, for the summary line. */
function pluginLabel(group) {
	const description = group.find((entry) => entry.description)?.description;
	if (description && /document format/i.test(description)) return 'PDF viewer';
	return 'plugin';
}

/**
 * The shading language version, without the redundant "WebGL " prefix.
 *
 * Firefox reports "GLSL ES 1.0" and Chrome reports "WebGL GLSL ES 3.00",
 * for the same thing. Dropping the prefix makes the two look alike.
 */
function shadingVersion(value) {
	if (!value) return '';
	return String(value).replace(/^WebGL\s+/, '');
}
