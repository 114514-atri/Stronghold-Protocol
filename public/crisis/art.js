// public/crisis/art.js — thin HTML helpers over the 卫戍 assets singleton (docs/shared-presentation.md P0).
// URL resolution lives in public/js/assets.js; this file only adds <img> fallbacks and elite-icon suffix strip.

import { assets } from '../js/assets.js';

export async function loadCrisisArt() {
  try { await assets.ready(); } catch { /* lobby still paints with path fallbacks */ }
  return assets.manifest || {};
}

/**
 * @param {string} charId
 * @param {{ e2?: boolean }} [opts]
 */
export function crisisAvatarUrl(charId, opts) {
  return assets.avatar(charId, opts) || `/assets/char/avatar/${charId}.png`;
}

/**
 * Half-body portrait for detail panel (E2 when available).
 * @param {string} charId
 * @param {{ e2?: boolean }} [opts]
 */
export function crisisPortraitUrl(charId, opts) {
  return assets.portrait(charId, opts)
    || assets.avatar(charId, opts)
    || `/assets/char/portrait/${charId}_1.png`;
}

/** @param {string} enemyId */
export function crisisEnemyIconUrl(enemyId) {
  const direct = assets.enemyIcon(enemyId);
  if (direct) return direct;
  const base = String(enemyId || '').replace(/_[23]$/, '');
  if (base && base !== enemyId) {
    const u = assets.enemyIcon(base);
    if (u) return u;
  }
  return `/assets/enemy/icon/${enemyId}.png`;
}

/** @param {string} key ui group/key */
export function crisisUiUrl(key) {
  return assets.ui(key) || null;
}

/**
 * @param {string|null|undefined} url
 * @returns {Promise<HTMLImageElement|null>}
 */
export function loadImage(url) {
  return assets.image(url);
}

export function peekImage(url) {
  if (!url) return undefined;
  return assets.imageNow(url) || undefined;
}

/** @param {string[]} urls */
export async function prefetchImages(urls) {
  await assets.preload(urls || []);
}
