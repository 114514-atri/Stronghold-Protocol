// shared/crisis/sim/stats.js — operator / enemy combat stats for Crisis TD.

/**
 * @param {{ level: number, data: Record<string, number> }[]} frames
 * @param {number} level
 */
export function interpolateFrames(frames, level) {
  if (!Array.isArray(frames) || !frames.length) return null;
  if (frames.length === 1) return { ...frames[0].data };
  const lo = frames[0];
  const hi = frames[frames.length - 1];
  const l0 = lo.level;
  const l1 = hi.level;
  const t = l1 === l0 ? 1 : Math.max(0, Math.min(1, (level - l0) / (l1 - l0)));
  /** @type {Record<string, number>} */
  const out = {};
  for (const k of Object.keys(lo.data)) {
    const a = lo.data[k];
    const b = hi.data[k];
    out[k] = typeof a === 'number' && typeof b === 'number' ? a + (b - a) * t : /** @type {any} */ (b);
  }
  return out;
}

/**
 * Resolve the skill level row for a loadout.
 * Crisis defaults assume skill rank 7 + specialize 0..3 → levels[6..9].
 * @param {any} op battle-ops entry
 * @param {{ skillIndex?: number, specialize?: number }} loadout
 */
export function resolveSkillLevel(op, loadout) {
  const skills = Array.isArray(op?.skills) ? op.skills : [];
  if (!skills.length) return null;
  const idx = Math.max(0, Math.min(skills.length - 1, loadout.skillIndex | 0));
  const slot = skills[idx];
  const levels = slot?.levels || [];
  if (!levels.length) return null;
  // specialize 0 → L7 (index 6); 1/2/3 → M1/M2/M3. Clamp to available rows.
  const specialize = Math.max(0, Math.min(3, loadout.specialize | 0));
  const li = Math.min(levels.length - 1, Math.max(0, 6 + specialize));
  const lv = levels[li];
  // Official: duration -1 = toggle / permanent while on; 0 = instant volley; >0 = timed.
  const rawDur = Number(lv.duration);
  const duration = Number.isFinite(rawDur) ? rawDur : 0;
  return {
    skillId: slot.skillId,
    skillIndex: idx,
    levelIndex: li,
    name: lv.name || slot.skillId,
    skillType: lv.skillType || 'MANUAL',
    spType: lv.spType || 'INCREASE_WITH_TIME',
    spCost: Math.max(0, Number(lv.spCost) || 0),
    initSp: Math.max(0, Number(lv.initSp) || 0),
    increment: Math.max(0, Number(lv.increment) || 1),
    duration,
    rangeId: lv.rangeId || null,
    bb: lv.bb && typeof lv.bb === 'object' ? { ...lv.bb } : {},
  };
}

/**
 * Apply a slim blackboard onto combat numbers while a skill is active.
 * @param {{ atk: number, attackSpeed: number, baseAttackTime: number, def: number }} base
 * @param {Record<string, number>} bb
 */
export function applySkillBlackboard(base, bb) {
  const b = bb || {};
  let atk = base.atk;
  let attackSpeed = base.attackSpeed;
  let baseAttackTime = base.baseAttackTime;
  let def = base.def;
  let atkMul = 1;
  if (typeof b.atk === 'number') atk += b.atk;
  const scale = b['attack@atk_scale'] ?? b.atk_scale;
  if (typeof scale === 'number' && scale > 0) atkMul *= scale;
  if (typeof b.attack_speed === 'number') attackSpeed += b.attack_speed;
  if (typeof b.base_attack_time === 'number') baseAttackTime = Math.max(0.1, baseAttackTime + b.base_attack_time);
  if (typeof b.def === 'number') def += b.def;
  if (typeof b.def_scale === 'number' && b.def_scale > 0) def *= b.def_scale;
  const times = b['attack@times'] ?? b.times;
  return {
    atk: Math.round(atk * atkMul),
    attackSpeed,
    baseAttackTime,
    def: Math.round(def),
    /** Extra hits per attack while skill is on ([ASSUMED] multi-hit as atkMul bonus if times>1). */
    hitTimes: typeof times === 'number' && times > 1 ? Math.floor(times) : 1,
    healScale: typeof b.heal_scale === 'number' && b.heal_scale > 0 ? b.heal_scale : 1,
    hpRegen: typeof b.hp_recovery_per_sec === 'number' ? b.hp_recovery_per_sec : 0,
  };
}

/**
 * Pick the highest unlocked candidate per talent slot for this loadout.
 * @param {any} op
 * @param {{ elite?: number, level?: number, potential?: number }} loadout
 * @returns {{ name: string, bb: Record<string, number> }[]}
 */
export function resolveTalents(op, loadout) {
  const elite = Math.max(0, loadout?.elite | 0);
  const level = Math.max(1, loadout?.level | 0);
  const pot = Math.max(0, Math.min(5, loadout?.potential | 0));
  const out = [];
  for (const tal of op?.talents || []) {
    let best = null;
    for (const c of tal.candidates || []) {
      if ((c.elite | 0) > elite) continue;
      if ((c.level | 0) > level) continue;
      if ((c.potential | 0) > pot) continue;
      if (!best
        || (c.elite | 0) > (best.elite | 0)
        || ((c.elite | 0) === (best.elite | 0) && (c.potential | 0) > (best.potential | 0))
        || ((c.elite | 0) === (best.elite | 0) && (c.potential | 0) === (best.potential | 0) && (c.level | 0) > (best.level | 0))) {
        best = c;
      }
    }
    if (best) out.push({ name: best.name || '', bb: best.bb && typeof best.bb === 'object' ? { ...best.bb } : {} });
  }
  return out;
}

/**
 * Apply unlocked passive talent blackboards onto base combat numbers.
 * Ratio keys (0 &lt; v &lt; 2, except attack_speed/cost/respawn_time): multiply. Else flat add.
 * @param {{ maxHp: number, atk: number, def: number, res: number, cost: number, attackSpeed: number, respawnTime: number }} stats
 * @param {{ bb: Record<string, number> }[]} talents
 */
export function applyTalentBlackboards(stats, talents) {
  let maxHp = stats.maxHp;
  let atk = stats.atk;
  let def = stats.def;
  let res = stats.res;
  let cost = stats.cost;
  let attackSpeed = stats.attackSpeed;
  let respawnTime = stats.respawnTime;
  for (const tal of talents || []) {
    const b = tal.bb || {};
    if (typeof b.max_hp === 'number') {
      maxHp = b.max_hp > 0 && b.max_hp < 2 ? maxHp * (1 + b.max_hp) : maxHp + b.max_hp;
    }
    if (typeof b.atk === 'number') {
      atk = b.atk > 0 && b.atk < 2 ? atk * (1 + b.atk) : atk + b.atk;
    }
    if (typeof b.def === 'number') {
      def = b.def > 0 && b.def < 2 ? def * (1 + b.def) : def + b.def;
    }
    if (typeof b.magic_resistance === 'number') res += b.magic_resistance;
    if (typeof b.attack_speed === 'number') attackSpeed += b.attack_speed;
    if (typeof b.cost === 'number') cost = Math.max(0, cost + b.cost);
    if (typeof b.respawn_time === 'number') respawnTime = Math.max(0, respawnTime + b.respawn_time);
  }
  stats.maxHp = Math.round(maxHp);
  stats.atk = Math.round(atk);
  stats.def = Math.round(def);
  stats.res = Math.round(res);
  stats.cost = Math.round(cost);
  stats.attackSpeed = attackSpeed;
  stats.respawnTime = respawnTime;
  return stats;
}

/**
 * @param {any} op battle-ops entry
 * @param {{ elite: number, level: number, skillIndex?: number, specialize?: number, potential?: number }} loadout
 */
export function operatorCombatStats(op, loadout) {
  const phases = op.phases || [];
  const elite = Math.max(0, Math.min(phases.length - 1, loadout.elite | 0));
  const phase = phases[elite];
  const lv = Math.max(1, Math.min(phase.maxLevel || 1, loadout.level | 0));
  const raw = interpolateFrames(phase.frames, lv);
  if (!raw) throw new Error(`no frames for ${op.id}`);
  const skill = resolveSkillLevel(op, loadout);
  // Base attack range from phase; skill.rangeId only while skill is active (陈 S2 等).
  const baseRangeId = phase.rangeId;
  const skillRangeId = skill?.rangeId || null;
  const baseRange = (baseRangeId && op.ranges && op.ranges[baseRangeId]) || { grids: [{ row: 0, col: 0 }] };
  const skillRange = (skillRangeId && op.ranges && op.ranges[skillRangeId]) || null;
  const stats = {
    maxHp: Math.round(raw.maxHp),
    atk: Math.round(raw.atk),
    def: Math.round(raw.def),
    res: Math.round(raw.magicResistance || 0),
    cost: Math.round(raw.cost),
    blockCnt: Math.round(raw.blockCnt || 0),
    attackSpeed: raw.attackSpeed || 100,
    baseAttackTime: raw.baseAttackTime || 1,
    respawnTime: raw.respawnTime || 60,
    rangeGrids: baseRange.grids || [],
    skillRangeGrids: skillRange?.grids || null,
    position: op.position === 'RANGED' ? 'RANGED' : op.position === 'ALL' ? 'ALL' : 'MELEE',
    profession: op.profession,
    name: op.name,
    damageType: damageTypeOf(op.profession),
    skill,
  };
  // Tokens / traps have no operator talents; skip empty.
  if (Array.isArray(op.talents) && op.talents.length) {
    applyTalentBlackboards(stats, resolveTalents(op, loadout));
  }
  return stats;
}

/**
 * Whether a unit with this placement class may stand on a tile.
 * `ALL` = 望's 棋子 (PRTS 部署位置「全部位」; tools/build-data.mjs TOKEN_POSITION_CORRECTIONS).
 * @param {string} position MELEE | RANGED | ALL
 * @param {string} buildableType MELEE | RANGED | ALL | NONE
 */
export function tileAccepts(position, buildableType) {
  if (!buildableType || buildableType === 'NONE') return false;
  if (buildableType === 'ALL') return true;
  if (position === 'ALL') return buildableType === 'MELEE' || buildableType === 'RANGED';
  const need = position === 'RANGED' ? 'RANGED' : 'MELEE';
  return buildableType === need;
}

/**
 * Hand copies / field cap for a Crisis token at the owner's elite.
 * @param {{ count?: number, deployLimit?: number, countByElite?: Record<string|number, number>, deployByElite?: Record<string|number, number> }} ownerMeta
 * @param {{ elite?: number }} loadout
 */
export function resolveTokenStock(ownerMeta, loadout) {
  const elite = Math.max(0, loadout?.elite | 0);
  const count = ownerMeta?.countByElite?.[elite]
    ?? ownerMeta?.countByElite?.[String(elite)]
    ?? ownerMeta?.count
    ?? 1;
  const fieldMax = ownerMeta?.deployByElite?.[elite]
    ?? ownerMeta?.deployByElite?.[String(elite)]
    ?? ownerMeta?.deployLimit
    ?? count;
  return {
    copies: Math.max(1, Math.round(Number(count) || 1)),
    fieldMax: Math.max(1, Math.round(Number(fieldMax) || 1)),
  };
}

/** @param {string} profession */
function damageTypeOf(profession) {
  // [ASSUMED] slice: casters + supporters deal arts; everyone else physical. Medics do not attack.
  if (profession === 'CASTER' || profession === 'SUPPORT') return 'arts';
  if (profession === 'MEDIC') return 'heal';
  return 'physical';
}

/**
 * Physical / arts damage (official-style floors).
 * @param {'physical'|'arts'|'heal'} type
 * @param {number} atk
 * @param {{ def: number, res: number }} target
 */
export function computeDamage(type, atk, target) {
  if (type === 'heal') return Math.max(0, Math.round(atk));
  if (type === 'arts') {
    const res = Math.max(0, Math.min(100, target.res || 0));
    return Math.max(0, Math.round(atk * (1 - res / 100)));
  }
  const def = target.def || 0;
  return Math.max(Math.round(atk * 0.05), Math.round(atk - def));
}
