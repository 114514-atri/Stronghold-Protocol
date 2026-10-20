// shared/crisis/seasons.js — Crisis Contract season registry (classic first).

/** @typedef {{ id: string, name: string, order: number, mapId: string, mapName: string, dataUrl: string, playable: boolean }} CrisisSeasonMeta */

/** First season to implement: Contingency Contract β (切尔诺伯格 59区废墟). */
export const FIRST_SEASON_ID = 'cc-beta';

/** @type {CrisisSeasonMeta[]} */
export const SEASONS = [
  {
    id: 'cc-beta',
    name: '危机合约β',
    order: 0,
    mapId: 'level_rune_01-03',
    mapName: '切尔诺伯格 · 59区废墟',
    dataUrl: '/crisis/data/seasons/cc-beta.json',
    stageUrl: '/crisis/data/stages/level_rune_01-03.json',
    playable: true,
  },
  // Later: 荒芜行动 (rune_season_0_1) … — listed for UI but not yet playable.
  {
    id: 'cc-0',
    name: '荒芜行动',
    order: 1,
    mapId: '',
    mapName: '',
    dataUrl: '',
    playable: false,
  },
];

/** @param {string} id */
export function seasonById(id) {
  return SEASONS.find((s) => s.id === id) || null;
}

export function firstPlayableSeason() {
  return SEASONS.find((s) => s.playable) || SEASONS[0];
}
