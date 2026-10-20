// shared/crisisBridge.js — title screen → independent 危机合约 solo UI (same origin, no matchmaking).

/** Path of the Crisis Contract lobby (served from public/crisis/). */
export const CRISIS_PATH = '/crisis/';

/**
 * Absolute URL of the crisis page for a browser on this Stronghold host.
 * @param {string} [origin] location.origin
 */
export function crisisPublicUrl(origin) {
  const base = typeof origin === 'string' && origin ? origin.replace(/\/$/, '') : '';
  return `${base}${CRISIS_PATH}`;
}

/**
 * @param {any} health /healthz body
 * @returns {{ path: string, ready: boolean } | null}
 */
export function crisisFromHealth(health) {
  const c = health && typeof health === 'object' ? health.crisis : null;
  if (!c || typeof c !== 'object') return null;
  const path = typeof c.path === 'string' && c.path ? c.path : CRISIS_PATH;
  return { path, ready: c.ready !== false };
}
