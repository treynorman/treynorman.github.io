/**
 * geo.js — IP geolocation.
 *
 * The lookup is the one from `references/ip-location.html`: ask ipwho.is for
 * the caller's own record, and fall back to ipapi.co when that endpoint is
 * down or answers with `success: false`. Both endpoints send permissive
 * CORS headers, so this works from a plain static server.
 *
 * The two endpoints disagree about field names, so each logical field lists
 * the spellings to try; see GEO.fields in config.js.
 */

import { GEO } from './config.js';

/** The location, once it has been looked up. */
let geoPromise = null;

async function lookup(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error('HTTP ' + response.status);
  return response.json();
}

/**
 * Read a possibly nested field, e.g. "connection.org".
 */
function dig(source, path) {
  return path.split('.').reduce((value, key) => {
    if (value === undefined || value === null) return undefined;
    return value[key];
  }, source);
}

/**
 * Look up the caller's location.
 *
 * The result is remembered, so the app only ever makes one request however
 * many things ask for the location.
 *
 * @returns {Promise<{country: string, region: string, city: string, org: string, ip: string}>}
 */
export function fetchGeo() {
	if (!geoPromise) {
		geoPromise = lookupLocation().catch((error) => {
			// A failure is not remembered, so a later caller can try again.
			geoPromise = null;
			throw error;
		});
	}
	return geoPromise;
}

/**
 * Ask ipwho.is, and fall back to ipapi.co.
 */
async function lookupLocation() {
	let data;
	try {
		data = await lookup(GEO.primary);
		if (data.success === false) throw new Error('lookup failed');
	} catch (error) {
		console.warn('[combo] primary geolocation failed, falling back:', error.message);
		data = await lookup(GEO.fallback);
	}

	const pick = (paths) => {
		for (const path of paths) {
			const value = dig(data, path);
			if (value !== undefined && value !== null && value !== '') return String(value);
		}
		return GEO.fallbackValue;
	};

	return {
		country: pick(GEO.fields.country),
		region: pick(GEO.fields.region),
		city: pick(GEO.fields.city),
		org: pick(GEO.fields.org),
		ip: pick(GEO.fields.ip),
	};
}

/**
 * Fill a template with geolocation values.
 *
 * `{city}`, `{region}`, `{org}`, `{country}` and `{ip}` are substituted.
 * An unknown tag is left alone, so a typo in a template is visible in the
 * spoken output instead of silently vanishing.
 */
export function renderTemplate(template, values) {
  return String(template).replace(/\{(\w+)\}/g, (match, tag) => {
    const value = values[tag];
    if (value === undefined || value === null || value === '') return match;
    return String(value);
  });
}
