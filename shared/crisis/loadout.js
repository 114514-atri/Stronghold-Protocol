// shared/crisis/loadout.js — per-operator training for Crisis Contract (solo).
// Defaults: max elite / level / potential / skill rank / specialize / trust.
// Player may lower elite (0/1/2), potential, level, pick skill slot and mastery.

/** @typedef {{ elite: 0|1|2, level: number, potential: number, skillIndex: number, specialize: number, trust: number }} CrisisLoadout */

export const TRUST_MAX = 200;
export const POTENTIAL_MAX = 5; // official maxPotentialLevel (0..5 → 潜能 1..6)
export const SPECIALIZE_MAX = 3;
export const SKILL_RANK_MAX = 7; // display rank; specialize stacks on top for E2 skill 2/3

/**
 * Max level for a given elite phase from character phases[].maxLevel.
 * @param {{ maxLevel?: number }[] | null | undefined} phases
 * @param {0|1|2} elite
 */
export function maxLevelForElite(phases, elite) {
  const e = clampInt(elite, 0, 2);
  const list = Array.isArray(phases) ? phases : [];
  const row = list[e] || list[list.length - 1];
  const n = row && Number(row.maxLevel);
  return Number.isFinite(n) && n > 0 ? n : defaultMaxLevel(e);
}

/** Fallback when phases missing (6★-style caps). */
export function defaultMaxLevel(elite) {
  if (elite >= 2) return 90;
  if (elite >= 1) return 80;
  return 50;
}

/**
 * Highest elite phase this character can take.
 * @param {{ maxLevel?: number }[] | null | undefined} phases
 */
export function maxElite(phases) {
  const n = Array.isArray(phases) ? phases.length : 0;
  if (n <= 0) return 0;
  return /** @type {0|1|2} */ (Math.min(2, n - 1));
}

/**
 * Default loadout: full potential, full trust, highest elite + level, first skill at max specialize when available.
 * @param {{ phases?: { maxLevel?: number }[], skills?: any[], maxPotentialLevel?: number }} char
 * @returns {CrisisLoadout}
 */
export function defaultLoadout(char) {
  const phases = char && char.phases;
  const elite = maxElite(phases);
  const potCap = clampInt(char && char.maxPotentialLevel, 0, POTENTIAL_MAX);
  const skills = Array.isArray(char && char.skills) ? char.skills : [];
  const skillIndex = skills.length > 0 ? Math.min(skills.length - 1, skills.length === 1 ? 0 : 1) : 0;
  // Prefer skill 2 when present (index 1), else last / only skill.
  const prefer = skills.length >= 2 ? 1 : (skills.length >= 1 ? 0 : 0);
  return {
    elite,
    level: maxLevelForElite(phases, elite),
    potential: potCap,
    skillIndex: prefer,
    specialize: skills.length > 0 ? SPECIALIZE_MAX : 0,
    trust: TRUST_MAX,
  };
}

/**
 * Clamp a player-edited loadout to legal ranges for this character.
 * @param {Partial<CrisisLoadout>} raw
 * @param {{ phases?: { maxLevel?: number }[], skills?: any[], maxPotentialLevel?: number }} char
 * @returns {CrisisLoadout}
 */
export function normalizeLoadout(raw, char) {
  const base = defaultLoadout(char);
  const phases = char && char.phases;
  const eliteCap = maxElite(phases);
  const elite = /** @type {0|1|2} */ (clampInt(raw && raw.elite != null ? raw.elite : base.elite, 0, eliteCap));
  const potCap = clampInt(char && char.maxPotentialLevel, 0, POTENTIAL_MAX);
  const skills = Array.isArray(char && char.skills) ? char.skills : [];
  const skillCap = Math.max(0, skills.length - 1);
  const skillIndex = skills.length ? clampInt(raw && raw.skillIndex != null ? raw.skillIndex : base.skillIndex, 0, skillCap) : 0;
  const specialize = skills.length
    ? clampInt(raw && raw.specialize != null ? raw.specialize : base.specialize, 0, SPECIALIZE_MAX)
    : 0;
  const levelMax = maxLevelForElite(phases, elite);
  const level = clampInt(raw && raw.level != null ? raw.level : levelMax, 1, levelMax);
  return {
    elite,
    level,
    potential: clampInt(raw && raw.potential != null ? raw.potential : base.potential, 0, potCap),
    skillIndex,
    specialize,
    trust: clampInt(raw && raw.trust != null ? raw.trust : base.trust, 0, TRUST_MAX),
  };
}

/**
 * @param {unknown} v
 * @param {number} lo
 * @param {number} hi
 */
function clampInt(v, lo, hi) {
  const n = Number(v);
  if (!Number.isFinite(n)) return lo;
  return Math.max(lo, Math.min(hi, Math.trunc(n)));
}
