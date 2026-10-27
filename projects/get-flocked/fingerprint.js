/**
 * fingerprint.js — capture the browser fingerprint and the IP location.
 *
 * Two things are collected at the same time:
 *
 *  - the thumbmark, a hash of the browser's identifying properties
 *    (thumbmarkjs, running entirely in the browser -- no API key, so
 *    nothing is sent anywhere)
 *  - the caller's IP location, from ipwho.is
 *
 * The time both take together is measured, because that is what the app
 * shows the user: how long the capture took.
 */

import { fetchGeo } from './geo.js';

/**
 * Capture the fingerprint and the location, and time them.
 *
 * The fingerprint library is loaded on purpose rather than with a plain
 * import, so that a missing or blocked copy does not take the whole
 * module down with it. When it cannot be loaded, the location is still
 * captured and the fingerprint is simply empty.
 *
 * @param {object} options
 * @param {number} [options.timeout]  how long to wait, in milliseconds
 * @returns {Promise<{ms: number, thumbmark: string, components: object, geo: object|null, errors: string[]}>}
 */
export async function captureFingerprint({ timeout = 10000 } = {}) {
	const started = performance.now();

	const errors = [];

	// The fingerprint and the location are collected at the same time, so
	// the measurement is the time for the slower of the two, not their sum.
	const [thumbmarkResult, geoResult] = await Promise.allSettled([
		captureThumbmark(timeout),
		withTimeout(fetchGeo(), timeout, 'location'),
	]);

	const ms = Math.round(performance.now() - started);

	if (thumbmarkResult.status === 'rejected') {
		errors.push(`fingerprint: ${thumbmarkResult.reason?.message ?? thumbmarkResult.reason}`);
	}
	if (geoResult.status === 'rejected') {
		errors.push(`location: ${geoResult.reason?.message ?? geoResult.reason}`);
	}

	const fingerprint = thumbmarkResult.status === 'fulfilled' ? thumbmarkResult.value : null;

	return {
		ms,
		thumbmark: fingerprint?.thumbmark ?? '',
		components: fingerprint?.components ?? {},
		geo: geoResult.status === 'fulfilled' ? geoResult.value : null,
		errors,
	};
}

/**
 * The fingerprint on its own.
 *
 * The library is loaded here, so that a failure to load it is caught
 * rather than taking the page down.
 */
async function captureThumbmark(timeout) {
	let getThumbmark;

	try {
		const module = await import('./js/vendor/thumbmark.esm.js');
		getThumbmark = module.getThumbmark;
	} catch (error) {
		throw new Error(`the fingerprint library could not be loaded: ${error?.message ?? error}`);
	}

	if (typeof getThumbmark !== 'function') {
		throw new Error('the fingerprint library did not provide getThumbmark');
	}

	return withTimeout(getThumbmark({
		performance: true,
		timeout,
		// Nothing leaves the browser: no API key means no API call, and
		// these two keep the occasional diagnostic ping and the
		// server-directed beacon from going out.
		logging: false,
		collect_beacon: false,
	}), timeout, 'fingerprint');
}

/**
 * Reject if the promise takes too long.
 *
 * @param {Promise} promise
 * @param {number} ms
 * @param {string} what  for the error message
 */
function withTimeout(promise, ms, what) {
	return new Promise((resolve, reject) => {
		const timer = setTimeout(() => reject(new Error(`${what} timed out after ${ms} ms`)), ms);
		promise.then(
			(value) => { clearTimeout(timer); resolve(value); },
			(error) => { clearTimeout(timer); reject(error); },
		);
	});
}
