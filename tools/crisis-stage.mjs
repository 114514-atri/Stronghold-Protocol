#!/usr/bin/env node
// tools/crisis-stage.mjs — pack Crisis β stage + slim enemy/operator battle stats into public/crisis/data/.
// Needs .cache/gamedata excel + levels/obt/rune/level_rune_01-03.json (downloads stage if missing).

import fs from 'node:fs';
import path from 'node:path';
import https from 'node:https';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CACHE = path.join(ROOT, '.cache', 'gamedata');
const STAGE_REL = path.join('levels', 'obt', 'rune', 'level_rune_01-03.json');
const STAGE_SRC = path.join(CACHE, STAGE_REL);
const OUT = path.join(ROOT, 'public', 'crisis', 'data');

const STAGE_URLS = [
  'https://cdn.jsdelivr.net/gh/Kengxxiao/ArknightsGameData@master/zh_CN/gamedata/levels/obt/rune/level_rune_01-03.json',
  'https://raw.githubusercontent.com/Kengxxiao/ArknightsGameData/master/zh_CN/gamedata/levels/obt/rune/level_rune_01-03.json',
];

function get(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        get(res.headers.location).then(resolve, reject);
        return;
      }
      if (res.statusCode !== 200) {
        reject(new Error(`HTTP ${res.statusCode} ${url}`));
        res.resume();
        return;
      }
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks)));
    }).on('error', reject);
  });
}

async function ensureStage() {
  if (fs.existsSync(STAGE_SRC) && fs.statSync(STAGE_SRC).size > 5000) return;
  fs.mkdirSync(path.dirname(STAGE_SRC), { recursive: true });
  let lastErr;
  for (const url of STAGE_URLS) {
    try {
      const buf = await get(url);
      if (buf.length < 5000) throw new Error('too small');
      fs.writeFileSync(STAGE_SRC, buf);
      console.log(`downloaded stage (${buf.length} B) from ${url}`);
      return;
    } catch (e) {
      lastErr = e;
      console.warn(`stage fetch failed: ${url}: ${e.message}`);
    }
  }
  throw lastErr || new Error('could not download stage');
}

function mv(obj, key, fallback = 0) {
  const n = obj && obj[key];
  if (n && typeof n === 'object' && 'm_value' in n) return Number(n.m_value) || fallback;
  if (typeof n === 'number') return n;
  return fallback;
}

function enemyStats(entry) {
  const d = entry?.Value?.[0]?.enemyData;
  if (!d) return null;
  const a = d.attributes || {};
  return {
    name: d.name?.m_value || entry.Key,
    maxHp: mv(a, 'maxHp', 1),
    atk: mv(a, 'atk', 0),
    def: mv(a, 'def', 0),
    res: mv(a, 'magicResistance', 0),
    moveSpeed: mv(a, 'moveSpeed', 1),
    baseAttackTime: mv(a, 'baseAttackTime', 1),
    atkRange: mv(a, 'rangeRadius', 0),
    massLevel: mv(a, 'massLevel', 0),
  };
}

function interpolateFrames(frames, level) {
  if (!Array.isArray(frames) || !frames.length) return null;
  if (frames.length === 1) return { ...frames[0].data };
  const lo = frames[0];
  const hi = frames[frames.length - 1];
  const l0 = lo.level;
  const l1 = hi.level;
  const t = l1 === l0 ? 1 : Math.max(0, Math.min(1, (level - l0) / (l1 - l0)));
  const out = {};
  for (const k of Object.keys(lo.data)) {
    const a = lo.data[k];
    const b = hi.data[k];
    if (typeof a === 'number' && typeof b === 'number') out[k] = a + (b - a) * t;
    else out[k] = b;
  }
  return out;
}

function tierOf(rarity) {
  const m = String(rarity || '').match(/TIER_(\d+)/i);
  return m ? Number(m[1]) : 0;
}

const ICON_URLS = [
  (id) => `https://cdn.jsdelivr.net/gh/yuanyan3060/ArknightsGameResource@main/enemy/${id}.png`,
  (id) => `https://raw.githubusercontent.com/yuanyan3060/ArknightsGameResource/main/enemy/${id}.png`,
];

/** Download missing enemy icons into public/assets/enemy/icon/ (same layout as 卫戍协议). */
async function ensureEnemyIcons(ids) {
  const dir = path.join(ROOT, 'public', 'assets', 'enemy', 'icon');
  fs.mkdirSync(dir, { recursive: true });
  for (const id of ids) {
    const dest = path.join(dir, `${id}.png`);
    if (fs.existsSync(dest) && fs.statSync(dest).size > 500) continue;
    let ok = false;
    for (const make of ICON_URLS) {
      try {
        const buf = await get(make(id));
        if (buf.length < 500) continue;
        fs.writeFileSync(dest, buf);
        console.log(`enemy icon ${id} (${buf.length} B)`);
        ok = true;
        break;
      } catch {
        /* try next mirror */
      }
    }
    if (!ok) console.warn(`enemy icon missing: ${id}`);
  }
}

/** Same correction as tools/build-data.mjs TOKEN_POSITION_CORRECTIONS (PRTS 棋子 全部位). */
const TOKEN_POSITION_CORRECTIONS = Object.freeze({
  token_10064_wang_stone1: 'ALL',
});

/** Official unlockCondition.phase is `"PHASE_0"` … `"PHASE_2"` (not a bare int). */
function elitePhase(p) {
  if (typeof p === 'number' && Number.isFinite(p)) return Math.max(0, Math.min(2, p | 0));
  if (typeof p === 'string') {
    const m = /^PHASE_(\d+)$/i.exec(p);
    if (m) return Math.max(0, Math.min(2, Number(m[1])));
  }
  return 0;
}

function bbMap(list) {
  /** @type {Record<string, number>} */
  const out = {};
  for (const e of list || []) {
    if (e && typeof e.key === 'string' && typeof e.value === 'number') out[e.key] = e.value;
  }
  return out;
}

function packTokenPhases(row) {
  return (row.phases || []).map((p) => ({
    maxLevel: p.maxLevel,
    rangeId: p.rangeId || null,
    frames: (p.attributesKeyFrames || []).map((f) => ({
      level: f.level,
      data: {
        maxHp: f.data.maxHp,
        atk: f.data.atk,
        def: f.data.def,
        magicResistance: f.data.magicResistance,
        cost: f.data.cost,
        blockCnt: f.data.blockCnt,
        moveSpeed: f.data.moveSpeed,
        attackSpeed: f.data.attackSpeed,
        baseAttackTime: f.data.baseAttackTime,
        respawnTime: f.data.respawnTime,
        maxDeployCount: f.data.maxDeployCount,
        maxDeckStackCnt: f.data.maxDeckStackCnt,
      },
    })),
  }));
}

function lastAttr(row) {
  const phases = row.phases || [];
  const p = phases[phases.length - 1];
  const frames = p?.attributesKeyFrames || [];
  return frames[frames.length - 1]?.data || {};
}

/**
 * Hand-placeable TOKEN/TRAP after the owner deploys (PRTS 附属召唤物加入手牌区).
 * Produced by character tokenKey, a talent tokenKey, or a skill overrideTokenKey — not display-only.
 */
function packDeployTokens(charTable, rangeTable, skillTable) {
  /** @type {Record<string, any>} */
  const tokens = {};
  /** @type {Record<string, string[]>} */
  const byOwner = {};

  for (const [id, row] of Object.entries(charTable)) {
    if (!id.startsWith('char_') || !row || row.isNotObtainable) continue;
    if (!row.profession || row.profession === 'TOKEN' || row.profession === 'TRAP') continue;

    /** @type {Map<string, { sources: Set<string>, skillIds: Set<string>, talentMinElite: number|null, countByElite: Record<number, number>, deployByElite: Record<number, number> }>} */
    const found = new Map();
    const add = (tokenId, source, extra = {}) => {
      if (!tokenId || typeof tokenId !== 'string') return;
      const tokRow = charTable[tokenId];
      if (!tokRow || (tokRow.profession !== 'TOKEN' && tokRow.profession !== 'TRAP')) return;
      let rec = found.get(tokenId);
      if (!rec) {
        rec = { sources: new Set(), skillIds: new Set(), talentMinElite: null, countByElite: {}, deployByElite: {} };
        found.set(tokenId, rec);
      }
      rec.sources.add(source);
      if (typeof extra.skillId === 'string') rec.skillIds.add(extra.skillId);
      if (typeof extra.talentElite === 'number') {
        rec.talentMinElite = rec.talentMinElite == null
          ? extra.talentElite
          : Math.min(rec.talentMinElite, extra.talentElite);
      }
    };

    if (row.tokenKey) add(row.tokenKey, 'tokenKey');
    for (const tal of row.talents || []) {
      for (const c of tal.candidates || []) {
        if (!c?.tokenKey) continue;
        const elite = elitePhase(c.unlockCondition?.phase);
        add(c.tokenKey, 'talent', { talentElite: elite });
        const bb = bbMap(c.blackboard);
        const cnt = bb.cnt ?? bb.max_deck_stack_cnt;
        const cap = bb.max_deploy_count ?? bb.cnt;
        if (cnt != null) {
          const prev = found.get(c.tokenKey);
          const old = prev.countByElite[elite];
          if (old == null || cnt > old) prev.countByElite[elite] = cnt;
        }
        if (cap != null) {
          const prev = found.get(c.tokenKey);
          const old = prev.deployByElite[elite];
          if (old == null || cap > old) prev.deployByElite[elite] = cap;
        }
      }
    }
    for (const s of row.skills || []) {
      if (s?.overrideTokenKey) add(s.overrideTokenKey, 'skill', { skillId: s.skillId });
    }

    // Summoner stack talents with `cnt` but no tokenKey (令 挑灯问梦) apply to every skill/tokenKey summon.
    /** @type {Record<number, number>} */
    const stackCntByElite = {};
    for (const tal of row.talents || []) {
      for (const c of tal.candidates || []) {
        if (c?.tokenKey) continue;
        const bb = bbMap(c.blackboard);
        const cnt = bb.cnt ?? bb.max_deck_stack_cnt;
        if (cnt == null) continue;
        const elite = elitePhase(c.unlockCondition?.phase);
        const old = stackCntByElite[elite];
        if (old == null || cnt > old) stackCntByElite[elite] = cnt;
      }
    }
    if (Object.keys(stackCntByElite).length) {
      for (const rec of found.values()) {
        for (const [e, cnt] of Object.entries(stackCntByElite)) {
          const elite = Number(e);
          const old = rec.countByElite[elite];
          if (old == null || cnt > old) rec.countByElite[elite] = cnt;
          const oldD = rec.deployByElite[elite];
          if (oldD == null || cnt > oldD) rec.deployByElite[elite] = cnt;
        }
      }
    }

    for (const [tokenId, rec] of found) {
      if (!rec.sources.has('tokenKey') && !rec.sources.has('talent') && !rec.sources.has('skill')) continue;
      const tokRow = charTable[tokenId];
      if (!tokens[tokenId]) {
        const phases = packTokenPhases(tokRow);
        const rangeIds = [...new Set(phases.map((p) => p.rangeId).filter(Boolean))];
        /** @type {Record<string, any>} */
        const ranges = {};
        for (const rid of rangeIds) {
          const rg = rangeTable[rid];
          if (rg) ranges[rid] = { grids: rg.grids || [] };
        }
        const skills = packSkills(tokRow.skills, skillTable, ranges, rangeTable);
        const attr = lastAttr(tokRow);
        tokens[tokenId] = {
          id: tokenId,
          name: tokRow.name || tokenId,
          profession: tokRow.profession,
          position: TOKEN_POSITION_CORRECTIONS[tokenId] || tokRow.position || 'MELEE',
          phases,
          ranges,
          skills,
          defaultCount: Math.max(1, attr.maxDeckStackCnt || attr.maxDeployCount || 1),
          defaultDeployLimit: Math.max(1, attr.maxDeployCount || attr.maxDeckStackCnt || 1),
          owners: {},
        };
      }
      const countByElite = { ...rec.countByElite };
      const deployByElite = { ...rec.deployByElite };
      // Carry lower-elite counts forward when a later phase omits cnt.
      let lastC = tokens[tokenId].defaultCount;
      let lastD = tokens[tokenId].defaultDeployLimit;
      for (let e = 0; e <= 2; e++) {
        if (countByElite[e] != null) lastC = countByElite[e];
        else countByElite[e] = lastC;
        if (deployByElite[e] != null) lastD = deployByElite[e];
        else deployByElite[e] = lastD;
      }
      tokens[tokenId].owners[id] = {
        count: countByElite[2] ?? tokens[tokenId].defaultCount,
        deployLimit: deployByElite[2] ?? tokens[tokenId].defaultDeployLimit,
        countByElite,
        deployByElite,
        sources: [...rec.sources].sort(),
        skillIds: [...rec.skillIds].sort(),
        talentMinElite: rec.talentMinElite,
      };
      if (!byOwner[id]) byOwner[id] = [];
      if (!byOwner[id].includes(tokenId)) byOwner[id].push(tokenId);
    }
  }

  const body = {
    source: 'character_table.json',
    rule: 'hand-placeable TOKEN/TRAP after owner deploy (tokenKey / talent / skill override)',
    count: Object.keys(tokens).length,
    owners: Object.keys(byOwner).length,
    tokens,
    byOwner,
  };
  fs.writeFileSync(path.join(OUT, 'deploy-tokens.json'), `${JSON.stringify(body)}\n`);
  console.log(`wrote deploy-tokens.json (${body.count} tokens, ${body.owners} owners)`);
}

async function main() {
  const excel = path.join(CACHE, 'excel');
  if (process.argv.includes('--tokens-only')) {
    const charTable = JSON.parse(fs.readFileSync(path.join(excel, 'character_table.json'), 'utf8'));
    const rangeTable = JSON.parse(fs.readFileSync(path.join(excel, 'range_table.json'), 'utf8'));
    const skillTable = JSON.parse(fs.readFileSync(path.join(excel, 'skill_table.json'), 'utf8'));
    fs.mkdirSync(OUT, { recursive: true });
    packDeployTokens(charTable, rangeTable, skillTable);
    return;
  }

  await ensureStage();
  const stage = JSON.parse(fs.readFileSync(STAGE_SRC, 'utf8'));
  fs.mkdirSync(path.join(OUT, 'stages'), { recursive: true });
  fs.writeFileSync(path.join(OUT, 'stages', 'level_rune_01-03.json'), `${JSON.stringify(stage)}\n`);

  const enemyDb = JSON.parse(fs.readFileSync(path.join(CACHE, 'levels', 'enemydata', 'enemy_database.json'), 'utf8'));
  const byKey = new Map(enemyDb.enemies.map((e) => [e.Key, e]));
  const enemyIds = [...new Set((stage.enemyDbRefs || []).map((r) => r.id))];
  /** @type {Record<string, any>} */
  const enemies = {};
  for (const id of enemyIds) {
    const st = enemyStats(byKey.get(id));
    if (!st) throw new Error(`missing enemy ${id}`);
    enemies[id] = st;
  }
  fs.writeFileSync(path.join(OUT, 'enemies.json'), `${JSON.stringify({ count: enemyIds.length, enemies }, null, 2)}\n`);
  await ensureEnemyIcons(enemyIds);

  const charTable = JSON.parse(fs.readFileSync(path.join(CACHE, 'excel', 'character_table.json'), 'utf8'));
  const rangeTable = JSON.parse(fs.readFileSync(path.join(CACHE, 'excel', 'range_table.json'), 'utf8'));
  const skillTable = JSON.parse(fs.readFileSync(path.join(CACHE, 'excel', 'skill_table.json'), 'utf8'));
  /** @type {Record<string, any>} */
  const ops = {};
  for (const [id, row] of Object.entries(charTable)) {
    if (!id.startsWith('char_') || !row || row.isNotObtainable) continue;
    if (!row.profession || row.profession === 'TOKEN' || row.profession === 'TRAP') continue;
    const phases = (row.phases || []).map((p) => ({
      maxLevel: p.maxLevel,
      rangeId: p.rangeId || null,
      // Store only level-1 and max frames; client interpolates.
      frames: (p.attributesKeyFrames || []).map((f) => ({ level: f.level, data: {
        maxHp: f.data.maxHp,
        atk: f.data.atk,
        def: f.data.def,
        magicResistance: f.data.magicResistance,
        cost: f.data.cost,
        blockCnt: f.data.blockCnt,
        moveSpeed: f.data.moveSpeed,
        attackSpeed: f.data.attackSpeed,
        baseAttackTime: f.data.baseAttackTime,
        respawnTime: f.data.respawnTime,
      } })),
    }));
    const rangeIds = [...new Set(phases.map((p) => p.rangeId).filter(Boolean))];
    /** @type {Record<string, any>} */
    const ranges = {};
    for (const rid of rangeIds) {
      const rg = rangeTable[rid];
      if (rg) ranges[rid] = { grids: rg.grids || [] };
    }
    // Also pull skill-override ranges into the pack.
    const skills = packSkills(row.skills, skillTable, ranges, rangeTable);
    ops[id] = {
      id,
      name: row.name,
      rarity: tierOf(row.rarity),
      profession: row.profession,
      position: row.position, // MELEE | RANGED
      phases,
      ranges,
      skills,
      talents: packTalents(row.talents),
      maxPotentialLevel: row.maxPotentialLevel ?? 5,
    };
    // touch interpolate to validate
    const last = phases[phases.length - 1];
    if (last?.frames?.length) interpolateFrames(last.frames, last.maxLevel);
  }
  fs.writeFileSync(path.join(OUT, 'battle-ops.json'), `${JSON.stringify({ count: Object.keys(ops).length, operators: ops })}\n`);
  packDeployTokens(charTable, rangeTable, skillTable);
  console.log(`wrote stage + ${enemyIds.length} enemies + ${Object.keys(ops).length} operators → ${OUT}`);
}

/** Blackboard keys the Crisis TD slice understands (atk / aspd / bat / def scales). */
const BB_KEEP = new Set([
  'atk', 'atk_scale', 'attack@atk_scale', 'attack_speed', 'base_attack_time',
  'def', 'def_scale', 'times', 'attack@times', 'hp_recovery_per_sec', 'heal_scale',
]);

/** Passive talent keys applied at deploy (ratios &lt; 2 → multiply; else flat add). Skip attack@ / stacks. */
const TALENT_BB_KEEP = new Set([
  'atk', 'max_hp', 'def', 'magic_resistance', 'attack_speed', 'cost', 'respawn_time',
]);

/**
 * Slim talent rows for Crisis: one candidate list per talent slot (potential / elite unlocks).
 * @param {any[]} talents
 */
function packTalents(talents) {
  const out = [];
  for (const tal of talents || []) {
    const cands = [];
    for (const c of tal.candidates || []) {
      if (!c) continue;
      /** @type {Record<string, number>} */
      const bb = {};
      for (const e of c.blackboard || []) {
        if (!e || typeof e.key !== 'string' || !TALENT_BB_KEEP.has(e.key)) continue;
        if (typeof e.value === 'number' && Number.isFinite(e.value)) bb[e.key] = e.value;
      }
      // Keep slot even with empty bb so unlock gating stays accurate for future keys.
      cands.push({
        name: c.name || '',
        elite: elitePhase(c.unlockCondition?.phase),
        level: Math.max(1, c.unlockCondition?.level | 0 || 1),
        potential: Math.max(0, c.requiredPotentialRank | 0),
        bb,
      });
    }
    if (cands.length) out.push({ candidates: cands });
  }
  return out;
}

/**
 * Slim skill rows from skill_table for Crisis battle (SP / duration / cast type / useful blackboard).
 * @param {any[]} charSkills
 * @param {Record<string, any>} skillTable
 * @param {Record<string, any>} ranges
 * @param {Record<string, any>} rangeTable
 */
function packSkills(charSkills, skillTable, ranges, rangeTable) {
  const out = [];
  for (const slot of charSkills || []) {
    const skillId = slot?.skillId;
    if (typeof skillId !== 'string') continue;
    const row = skillTable[skillId];
    if (!row?.levels?.length) continue;
    const levels = row.levels.map((lv) => {
      const sp = lv.spData || {};
      /** @type {Record<string, number>} */
      const bb = {};
      for (const entry of lv.blackboard || []) {
        if (!entry || !BB_KEEP.has(entry.key)) continue;
        if (typeof entry.value === 'number' && Number.isFinite(entry.value)) bb[entry.key] = entry.value;
      }
      if (lv.rangeId && rangeTable[lv.rangeId] && !ranges[lv.rangeId]) {
        ranges[lv.rangeId] = { grids: rangeTable[lv.rangeId].grids || [] };
      }
      return {
        name: lv.name || skillId,
        skillType: lv.skillType || 'MANUAL',
        spType: sp.spType || 'INCREASE_WITH_TIME',
        spCost: Number(sp.spCost) || 0,
        initSp: Number(sp.initSp) || 0,
        increment: Number(sp.increment) || 1,
        duration: Number(lv.duration) || 0,
        rangeId: lv.rangeId || null,
        bb,
      };
    });
    out.push({ skillId, levels });
  }
  return out;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
