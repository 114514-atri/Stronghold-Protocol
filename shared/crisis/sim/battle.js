// shared/crisis/sim/battle.js — deterministic Crisis Contract TD battle (vertical slice).
// No Math.random, no clocks. Tick with fixed dt. Independent from server/sim combat rules,
// but facing uses the same 4-dir model as 卫戍 (`server/sim/dir.js`) so placement / range
// orientation match Stronghold.

import { parseMap, expandRoute } from './map.js';
import { operatorCombatStats, computeDamage, applySkillBlackboard, tileAccepts, resolveTokenStock } from './stats.js';
import { applyContracts, blockedTileToRowCol } from './runes.js';
// Browser resolves this to /server/sim/dir.js (aliased to /sim/ in static.js). Node resolves on disk.
import { normDir, rotateOffset, dirFromDelta, hSign, DEFAULT_DIR } from '../../../server/sim/dir.js';

const DT = 0.1; // seconds per tick
/** How long a corpse stays for Die clip / fade ([ASSUMED]). */
const DIE_LINGER = 0.85;
/** Hit lands this fraction into the attack interval so Spine wind-up can play ([ASSUMED]). */
const HIT_FRAC = 0.4;

/**
 * @param {{
 *   stage: any,
 *   enemies: Record<string, any>,
 *   operators: Record<string, any>,
 *   tokens?: Record<string, any>,
 *   tokenByOwner?: Record<string, string[]>,
 *   squad: { id: string, loadout: any }[],
 *   borrow?: { id: string, loadout: any }|null,
 *   contractIds: string[],
 *   seasonContracts: any,
 * }} cfg
 */
export function createBattle(cfg) {
  const map = parseMap(cfg.stage);
  const runes = applyContracts(cfg.contractIds || [], cfg.seasonContracts);
  const opt = map.options;
  let life = runes.lifePointOverride != null ? runes.lifePointOverride : (opt.maxLifePoint ?? 2);
  let cost = opt.initialCost ?? 10;
  const maxCost = opt.maxCost ?? 99;
  const costInterval = (opt.costIncreaseTime ?? 1) / Math.max(1e-6, runes.costRegenMul);
  let costAcc = 0;
  const deployLimit = runes.deployLimitOverride ?? (opt.characterLimit ?? 9);
  const tokenTable = cfg.tokens && typeof cfg.tokens === 'object' ? cfg.tokens : {};
  const tokenByOwner = cfg.tokenByOwner && typeof cfg.tokenByOwner === 'object' ? cfg.tokenByOwner : {};

  // Block tiles from terrain contracts.
  for (const bt of runes.blockedTiles) {
    const { r, c } = blockedTileToRowCol(bt, map.rows);
    if (r >= 0 && c >= 0 && r < map.rows && c < map.cols) {
      map.grid[r][c].buildableType = 'NONE';
      map.grid[r][c].blockedByContract = true;
    }
  }

  /** Pre-expand routes */
  const routeCache = new Map();
  for (let i = 0; i < map.routes.length; i++) {
    const ex = expandRoute(map, i);
    if (ex) routeCache.set(i, ex);
  }

  /** Schedule SPAWN actions → list of { t, key, routeIndex } */
  const schedule = buildSpawnSchedule(map.waves);
  let schedPtr = 0;
  let totalSpawned = 0;
  let totalToSpawn = schedule.length;
  let killed = 0;
  let leaked = 0;

  /** @type {any[]} */
  const enemies = [];
  /** @type {any[]} */
  const units = [];
  /** @type {Map<string, { readyAt: number, stats: any, loadout: any }>} */
  const hand = new Map();

  /**
   * Add an operator to the battle hand.
   * @param {{ id: string, loadout: any }} s
   * @param {{ borrow?: boolean }} [meta]
   */
  function addToHand(s, meta = {}) {
    if (!s?.id || hand.has(s.id)) return false;
    const op = cfg.operators[s.id];
    if (!op) return false;
    if (runes.bannedProfessions.has(op.profession)) return false;
    const stats = operatorCombatStats(op, s.loadout || {});
    stats.maxHp = Math.round(stats.maxHp * runes.allyHpMul);
    stats.atk = Math.round(stats.atk * runes.allyAtkMul);
    stats.def = Math.round(stats.def * runes.allyDefMul);
    stats.attackSpeed += runes.allyAspdAdd;
    let dp = stats.cost;
    const mul = runes.costMulProfession[op.profession];
    if (mul) dp = Math.min(99, Math.round(dp * mul));
    stats.deployCost = dp;
    hand.set(s.id, {
      readyAt: 0, stats, loadout: s.loadout, opId: s.id, name: op.name,
      borrow: !!meta.borrow,
    });
    return true;
  }

  /**
   * Whether this owner's packed token is available for the chosen loadout
   * (character tokenKey / talent at elite / selected skill overrideTokenKey).
   * @param {any} meta
   * @param {string} ownerId
   * @param {{ elite?: number, skillIndex?: number }} loadout
   */
  function tokenUnlocked(meta, ownerId, loadout) {
    if (!meta) return false;
    const sources = Array.isArray(meta.sources) ? meta.sources : [];
    const elite = Math.max(0, loadout?.elite | 0);
    if (sources.includes('tokenKey')) return true;
    if (sources.includes('talent')) {
      const minE = meta.talentMinElite == null ? 0 : (meta.talentMinElite | 0);
      if (elite >= minE) return true;
    }
    if (sources.includes('skill')) {
      const skills = cfg.operators[ownerId]?.skills || [];
      const sid = skills[loadout?.skillIndex | 0]?.skillId;
      const ids = Array.isArray(meta.skillIds) ? meta.skillIds : [];
      if (sid && ids.includes(sid)) return true;
    }
    return false;
  }

  function applyAllyRuneMuls(stats) {
    stats.maxHp = Math.round(stats.maxHp * runes.allyHpMul);
    stats.atk = Math.round(stats.atk * runes.allyAtkMul);
    stats.def = Math.round(stats.def * runes.allyDefMul);
    stats.attackSpeed += runes.allyAspdAdd;
    return stats;
  }

  /**
   * Put unlocked hand-placeable TOKEN/TRAP cards in the hand (official: in the cost bar with the squad).
   * Ready only while the owner is on the field. Idempotent per token id.
   * @param {string} ownerId
   * @param {any} loadout
   */
  function grantTokensFor(ownerId, loadout) {
    const list = tokenByOwner[ownerId];
    if (!Array.isArray(list) || !list.length) return;
    for (const tid of list) {
      if (hand.has(tid)) continue;
      const tok = tokenTable[tid];
      const meta = tok?.owners?.[ownerId];
      if (!tok || !meta || !tokenUnlocked(meta, ownerId, loadout)) continue;
      const stock = resolveTokenStock(meta, loadout);
      const stats = applyAllyRuneMuls(operatorCombatStats(tok, loadout || {}));
      let dp = stats.cost;
      const mul = runes.costMulProfession[tok.profession];
      if (mul) dp = Math.min(99, Math.round(dp * mul));
      stats.deployCost = dp;
      hand.set(tid, {
        kind: 'token',
        ownerId,
        copies: stock.copies,
        fieldMax: stock.fieldMax,
        coolUntil: [],
        readyAt: 0,
        stats,
        loadout: loadout || {},
        opId: tid,
        name: tok.name,
        borrow: false,
      });
    }
  }

  /** Drop finished per-copy redeploy timers on a token hand card. */
  function pruneTokenCool(h) {
    if (!h?.coolUntil) return;
    h.coolUntil = h.coolUntil.filter((t) => t > time);
  }

  /** How many copies of a token card can still be placed. */
  function tokenAvailable(h) {
    if (!h || h.kind !== 'token') return 0;
    pruneTokenCool(h);
    const onField = units.filter((u) => u.alive && u.opId === h.opId).length;
    const cooling = (h.coolUntil || []).length;
    return Math.max(0, (h.copies | 0) - onField - cooling);
  }

  // Main squad respects 隐秘行动 squadSizeCap; the 13th "friend / borrow" slot never does.
  // Tokens join the hand with the squad (ready only while owner is on field) — do not count toward squadSizeCap.
  let squadOps = 0;
  for (const s of cfg.squad || []) {
    if (runes.squadSizeCap != null && squadOps >= runes.squadSizeCap) break;
    if (addToHand(s)) {
      squadOps += 1;
      grantTokensFor(s.id, s.loadout);
    }
  }
  if (cfg.borrow?.id) {
    if (addToHand(cfg.borrow, { borrow: true })) grantTokensFor(cfg.borrow.id, cfg.borrow.loadout);
  }

  let time = 0;
  /** @type {'running'|'won'|'lost'} */
  let status = 'running';
  let nextEnemyId = 1;
  let nextUnitId = 1;
  /** @type {{ hitAt: number, kind: string, fromId: number, targetId: number, dmg: number, fromX?: number, fromY?: number, toX?: number, toY?: number, dmgType?: string }[]} */
  const pendingHits = [];
  /** One-tick visual events drained by snapshot(). */
  /** @type {any[]} */
  let events = [];

  function emit(ev) {
    events.push(ev);
  }

  function unitPos(u) {
    return { x: u.c + 0.5, y: u.r + 0.5 };
  }

  function tick() {
    if (status !== 'running') return snapshot();
    // Events accumulate until drainEvents() (卫戍 b.ev pattern).
    time += DT;

    // DP regen
    costAcc += DT;
    while (costAcc >= costInterval) {
      costAcc -= costInterval;
      if (cost < maxCost) cost += 1;
    }

    // Resolve delayed hits (aligned with attack wind-up)
    resolveHits();

    // Spawns
    while (schedPtr < schedule.length && schedule[schedPtr].t <= time + 1e-9) {
      const sp = schedule[schedPtr++];
      spawnEnemy(sp.key, sp.routeIndex);
    }

    // Move enemies / waits
    for (const e of enemies) {
      if (!e.alive) continue;
      stepEnemy(e);
    }

    // Blocking & combat
    assignBlocks();
    for (const u of units) {
      if (!u.alive) continue;
      stepUnitAttack(u);
    }
    for (const e of enemies) {
      if (!e.alive) continue;
      stepEnemyAttack(e);
    }

    // Mark newly dead → linger for Die clip
    for (const e of enemies) {
      if (e.alive && e.hp <= 0) killEnemy(e);
    }
    for (const u of units) {
      if (u.alive && u.hp <= 0) killUnit(u, false);
    }

    // Drop finished corpses
    for (const e of enemies) {
      if (!e.alive && e.dying && time >= e.dieUntil) e.dying = false;
    }
    for (const u of units) {
      if (!u.alive && u.dying && time >= u.dieUntil) u.dying = false;
    }

    // Win / lose (corpses may still linger)
    if (life <= 0) status = 'lost';
    else if (schedPtr >= schedule.length && enemies.every((e) => !e.alive) && totalSpawned >= totalToSpawn) {
      status = 'won';
    }

    return snapshot();
  }

  function killEnemy(e) {
    if (!e.alive) return;
    e.alive = false;
    e.dying = true;
    e.dieUntil = time + DIE_LINGER;
    e.diePulse = true;
    e.atkPulse = false;
    killed += 1;
    releaseBlock(e);
    emit({ type: 'die', who: 'enemy', id: e.id, x: e.x, y: e.y, key: e.key });
    // Drop pending hits from/to this enemy
    for (let i = pendingHits.length - 1; i >= 0; i--) {
      const h = pendingHits[i];
      if ((h.kind === 'enemy' && h.fromId === e.id) || (h.kind === 'unit' && h.targetId === e.id)) {
        pendingHits.splice(i, 1);
      }
    }
  }

  function killUnit(u, retreated) {
    if (!u.alive) return;
    u.alive = false;
    u.dying = true;
    u.dieUntil = time + (retreated ? 0.55 : DIE_LINGER);
    u.diePulse = true;
    u.atkPulse = false;
    u.skillOn = false;
    u.hp = 0;
    const p = unitPos(u);
    emit({ type: 'die', who: 'op', id: u.id, x: p.x, y: p.y, opId: u.opId, retreated: !!retreated });
    const h = hand.get(u.opId);
    if (h) {
      if (h.kind === 'token') {
        h.coolUntil = h.coolUntil || [];
        h.coolUntil.push(time + (h.stats.respawnTime || 25));
      } else {
        h.readyAt = time + h.stats.respawnTime;
      }
    }
    for (const e of enemies) {
      if (e.blockerId === u.id) { e.blockerId = null; e.blocked = false; }
    }
    for (let i = pendingHits.length - 1; i >= 0; i--) {
      const hit = pendingHits[i];
      if ((hit.kind === 'unit' && hit.fromId === u.id) || (hit.kind === 'enemy' && hit.targetId === u.id)) {
        pendingHits.splice(i, 1);
      }
    }
  }

  function resolveHits() {
    for (let i = pendingHits.length - 1; i >= 0; i--) {
      const hit = pendingHits[i];
      if (hit.hitAt > time + 1e-9) continue;
      pendingHits.splice(i, 1);
      if (hit.kind === 'heal') {
        const from = units.find((u) => u.id === hit.fromId);
        const target = units.find((u) => u.id === hit.targetId && u.alive);
        if (target) {
          target.hp = Math.min(target.maxHp, target.hp + hit.dmg);
          const p = unitPos(target);
          const fp = from ? unitPos(from) : p;
          emit({
            type: 'hit', kind: 'heal', dmg: hit.dmg,
            fromId: hit.fromId, targetId: hit.targetId, fromWho: 'op', toWho: 'op',
            x: p.x, y: p.y, fromX: fp.x, fromY: fp.y, toX: p.x, toY: p.y,
          });
        }
      } else if (hit.kind === 'unit') {
        const from = units.find((u) => u.id === hit.fromId);
        const target = enemies.find((e) => e.id === hit.targetId && e.alive);
        if (target) {
          target.hp -= hit.dmg;
          const fp = from ? unitPos(from) : { x: target.x, y: target.y };
          emit({
            type: 'hit', kind: hit.dmgType || from?.stats?.damageType || 'physical', dmg: hit.dmg,
            fromId: hit.fromId, targetId: hit.targetId, fromWho: 'op', toWho: 'enemy',
            x: target.x, y: target.y, fromX: fp.x, fromY: fp.y, toX: target.x, toY: target.y,
          });
        }
      } else {
        const from = enemies.find((e) => e.id === hit.fromId);
        const target = units.find((u) => u.id === hit.targetId && u.alive);
        if (target) {
          target.hp -= hit.dmg;
          if (target.skill?.spType === 'INCREASE_WHEN_TAKEN_DAMAGE') {
            gainSp(target, target.skill.increment || 1, 'hurt');
          }
          const p = unitPos(target);
          emit({
            type: 'hit', kind: 'physical', dmg: hit.dmg,
            fromId: hit.fromId, targetId: hit.targetId, fromWho: 'enemy', toWho: 'op',
            x: p.x, y: p.y, fromX: from?.x ?? p.x, fromY: from?.y ?? p.y, toX: p.x, toY: p.y,
          });
        }
      }
    }
  }

  /** Visual projectile kind for FxSystem (subset of 卫戍 PROJ keys). */
  function projKindOf(st) {
    if (!st) return 'none';
    if (st.damageType === 'heal') return 'orb';
    if (st.profession === 'SNIPER') return 'arrow';
    if (st.profession === 'CASTER' || st.profession === 'SUPPORT') return 'orb';
    if (st.position === 'RANGED') return 'bolt';
    return 'none';
  }

  function queueHit(kind, fromId, targetId, dmg, interval, meta = {}) {
    const delay = Math.max(DT, (interval || 1) * HIT_FRAC);
    pendingHits.push({
      hitAt: time + delay, kind, fromId, targetId, dmg,
      fromX: meta.fromX, fromY: meta.fromY, toX: meta.toX, toY: meta.toY, dmgType: meta.dmgType,
    });
  }

  function spawnEnemy(key, routeIndex) {
    const base = cfg.enemies[key];
    if (!base) return;
    const route = routeCache.get(routeIndex);
    if (!route || !route.cells.length) return;
    let hp = Math.round(base.maxHp * runes.enemyHpMul);
    let atk = Math.round(base.atk * runes.enemyAtkMul);
    let def = Math.round(base.def * runes.enemyDefMul);
    let move = base.moveSpeed * runes.enemyMoveMul;
    // Blade / armed contracts (β)
    if (key.includes('reveng')) {
      if (runes._obj_blade_3) {
        def = Math.round(def * 3); hp = Math.round(hp * 2.2); atk = Math.round(atk * 1.8);
      } else if (runes._obj_blade_2) {
        def = Math.round(def * 2); hp = Math.round(hp * 1.8);
      }
    }
    if (key.includes('haxe')) {
      if (runes._obj_armed_3) {
        hp = Math.round(hp * 2.5); atk = Math.round(atk * 1.8); /* res bump ignored in slice beyond */
      } else if (runes._obj_armed_2) {
        hp = Math.round(hp * 1.8); atk = Math.round(atk * 1.4);
      }
    }
    const start = route.cells[0];
    enemies.push({
      id: nextEnemyId++,
      key,
      name: base.name,
      alive: true,
      hp,
      maxHp: hp,
      atk,
      def,
      res: base.res || 0,
      moveSpeed: move,
      baseAttackTime: base.baseAttackTime || 2,
      atkCd: 0,
      routeIndex,
      cells: route.cells,
      waits: route.waits,
      cellIndex: 0,
      progress: 0, // 0..1 toward next cell
      waitLeft: 0,
      x: start.c + 0.5,
      y: start.r + 0.5,
      face: 1,
      atkPulse: false,
      atkInterval: base.baseAttackTime || 2,
      blocked: false,
      blockerId: null,
    });
    totalSpawned += 1;
  }

  function stepEnemy(e) {
    e.atkPulse = false;
    if (e.waitLeft > 0) {
      e.waitLeft -= DT;
      return;
    }
    if (e.blocked) return;
    const cells = e.cells;
    if (e.cellIndex >= cells.length - 1) {
      // Reached end → leak
      leak(e);
      return;
    }
    const speed = e.moveSpeed; // tiles / sec
    e.progress += speed * DT;
    while (e.progress >= 1 && e.cellIndex < cells.length - 1) {
      e.progress -= 1;
      e.cellIndex += 1;
      // Wait checkpoints after arriving at a cell
      for (const w of e.waits) {
        if (w.afterIndex === e.cellIndex && w.seconds > 0) {
          e.waitLeft = w.seconds;
          e.progress = 0;
          break;
        }
      }
      if (e.waitLeft > 0) break;
      if (e.cellIndex >= cells.length - 1) {
        leak(e);
        return;
      }
    }
    const a = cells[e.cellIndex];
    const b = cells[Math.min(e.cellIndex + 1, cells.length - 1)];
    const t = e.progress;
    const nx = a.c + 0.5 + (b.c - a.c) * t;
    const ny = a.r + 0.5 + (b.r - a.r) * t;
    const dx = nx - e.x;
    if (Math.abs(dx) > 1e-4) e.face = dx >= 0 ? 1 : -1;
    e.x = nx;
    e.y = ny;
    // Leak if standing on blue
    const tr = Math.floor(e.y);
    const tc = Math.floor(e.x);
    if (map.grid[tr]?.[tc]?.isEnd) leak(e);
  }

  function leak(e) {
    if (!e.alive) return;
    e.alive = false;
    life -= 1;
    leaked += 1;
    releaseBlock(e);
  }

  function releaseBlock(e) {
    if (e.blockerId != null) {
      const u = units.find((x) => x.id === e.blockerId);
      if (u) u.blocking = u.blocking.filter((id) => id !== e.id);
    }
    e.blockerId = null;
    e.blocked = false;
  }

  function assignBlocks() {
    for (const u of units) {
      if (!u.alive || u.stats.position !== 'MELEE' || u.stats.blockCnt <= 0) continue;
      u.blocking = u.blocking || [];
      // Drop dead
      u.blocking = u.blocking.filter((id) => {
        const e = enemies.find((x) => x.id === id);
        return e && e.alive;
      });
      while (u.blocking.length < u.stats.blockCnt) {
        const cand = enemies.find((e) => {
          if (!e.alive || e.blocked) return false;
          const dr = e.y - (u.r + 0.5);
          const dc = e.x - (u.c + 0.5);
          return dr * dr + dc * dc <= 0.72 * 0.72;
        });
        if (!cand) break;
        cand.blocked = true;
        cand.blockerId = u.id;
        u.blocking.push(cand.id);
      }
    }
  }

  function attackInterval(stats, aspdOverride, batOverride) {
    const aspd = Math.max(10, aspdOverride ?? stats.attackSpeed ?? 100);
    const bat = batOverride ?? stats.baseAttackTime ?? 1;
    return bat * 100 / aspd;
  }

  /** Live combat numbers (skill blackboard applied while skill is on). */
  function combatOf(u) {
    const st = u.stats;
    if (!u.skillOn || !u.skill?.bb) {
      return {
        atk: st.atk, attackSpeed: st.attackSpeed, baseAttackTime: st.baseAttackTime,
        def: st.def, hitTimes: 1, healScale: 1, hpRegen: 0,
      };
    }
    return applySkillBlackboard(st, u.skill.bb);
  }

  function gainSp(u, amount, reason) {
    if (!u.alive || u.skillOn) return;
    if (!(u.maxSp > 0)) return;
    // During skill, SP usually does not charge (official).
    u.sp = Math.min(u.maxSp, u.sp + amount);
    void reason;
  }

  function tryAutoSkill(u) {
    const sk = u.skill;
    if (!sk || sk.skillType !== 'AUTO' || sk.skillType === 'PASSIVE') return;
    if (u.skillOn || u.sp < u.maxSp) return;
    if (sk.duration > 0 || sk.duration < 0) activateSkill(u);
    else {
      // Instant AUTO (e.g. 三重矢): next attack(s) get the blackboard; spend SP now.
      u.sp = 0;
      u.instantHitsLeft = Math.max(1, applySkillBlackboard(u.stats, sk.bb).hitTimes);
      u.instantBb = sk.bb;
    }
  }

  function activateSkill(u) {
    const sk = u.skill;
    if (!sk) return false;
    if (u.skillOn) return false;
    if (u.sp < u.maxSp) return false;
    u.sp = 0;
    const p = unitPos(u);
    emit({ type: 'skill', id: u.id, opId: u.opId, name: sk.name, x: p.x, y: p.y, duration: sk.duration });
    if (sk.duration < 0) {
      // Toggle / permanent (官方 duration = -1)
      u.skillOn = true;
      u.skillLeft = Infinity;
      return true;
    }
    if (sk.duration > 0) {
      u.skillOn = true;
      u.skillLeft = sk.duration;
      return true;
    }
    // Instant MANUAL: one empowered volley
    u.instantHitsLeft = Math.max(1, applySkillBlackboard(u.stats, sk.bb).hitTimes);
    u.instantBb = sk.bb;
    return true;
  }

  function stepUnitAttack(u) {
    u.atkPulse = false;
    u.diePulse = false;
    const sk = u.skill;

    // Skill duration / regen (Infinity = toggle / permanent; never expires by timer)
    if (u.skillOn) {
      const live = combatOf(u);
      if (live.hpRegen > 0) u.hp = Math.min(u.maxHp, u.hp + live.hpRegen * DT);
      if (Number.isFinite(u.skillLeft)) {
        u.skillLeft -= DT;
        if (u.skillLeft <= 0) {
          u.skillOn = false;
          u.skillLeft = 0;
        }
      }
    } else if (sk && sk.spType === 'INCREASE_WITH_TIME' && u.sp < u.maxSp) {
      gainSp(u, (sk.increment || 1) * DT, 'time');
    }

    tryAutoSkill(u);

    u.atkCd -= DT;
    if (u.atkCd > 0) return;

    const st = u.stats;
    const usingInstant = (u.instantHitsLeft | 0) > 0;
    const live = usingInstant && u.instantBb
      ? applySkillBlackboard(st, u.instantBb)
      : combatOf(u);
    const iv = attackInterval(st, live.attackSpeed, live.baseAttackTime);

    if (st.damageType === 'heal') {
      let best = null;
      let bestRatio = 2;
      for (const o of units) {
        if (!o.alive || o.id === u.id) continue;
        if (!inRange(u, o.r + 0.5, o.c + 0.5)) continue;
        const ratio = o.hp / o.maxHp;
        if (ratio < bestRatio) { bestRatio = ratio; best = o; }
      }
      if (best && best.hp < best.maxHp) {
        const heal = Math.round(computeDamage('heal', live.atk, best) * live.healScale);
        pendingHits.push({
          hitAt: time + Math.max(DT, iv * HIT_FRAC),
          kind: 'heal',
          fromId: u.id,
          targetId: best.id,
          dmg: heal,
        });
        u.atkCd = iv;
        u.atkPulse = true;
        u.atkInterval = iv;
        const fp = unitPos(u);
        const tp = unitPos(best);
        emit({
          type: 'atk', fromId: u.id, targetId: best.id, fromWho: 'op', toWho: 'op',
          projKind: 'orb', dmgType: 'heal',
          fromX: fp.x, fromY: fp.y, toX: tp.x, toY: tp.y,
        });
        if (usingInstant) u.instantHitsLeft -= 1;
        else if (sk?.spType === 'INCREASE_WHEN_ATTACK') gainSp(u, sk.increment || 1, 'attack');
      }
      return;
    }

    let target = null;
    if (u.blocking?.length) {
      target = enemies.find((e) => e.id === u.blocking[0] && e.alive) || null;
    }
    if (!target) {
      let bestD = Infinity;
      for (const e of enemies) {
        if (!e.alive) continue;
        if (!inRange(u, e.x, e.y)) continue;
        const d = (e.x - (u.c + 0.5)) ** 2 + (e.y - (u.r + 0.5)) ** 2;
        if (d < bestD) { bestD = d; target = e; }
      }
    }
    if (!target) return;
    // Face the target with the same 4-dir rule as 卫戍 (dominant axis).
    const dRow = Math.floor(target.y) - u.r;
    const dCol = Math.floor(target.x) - u.c;
    if (dRow !== 0 || dCol !== 0) u.dir = dirFromDelta(dRow, dCol, u.dir || DEFAULT_DIR);

    // Multi-hit: queue several delayed hits ([ASSUMED] same target, staggered slightly)
    const hits = Math.max(1, live.hitTimes | 0);
    const dmgType = st.damageType || 'physical';
    const pk = projKindOf(st);
    for (let i = 0; i < hits; i++) {
      const dmg = computeDamage(dmgType, live.atk, target);
      const delay = Math.max(DT, iv * HIT_FRAC) + i * Math.min(0.08, iv * 0.1);
      pendingHits.push({
        hitAt: time + delay, kind: 'unit', fromId: u.id, targetId: target.id, dmg, dmgType,
      });
    }
    u.atkCd = iv;
    u.atkPulse = true;
    u.atkInterval = iv;
    const fp = unitPos(u);
    emit({
      type: 'atk', fromId: u.id, targetId: target.id, fromWho: 'op', toWho: 'enemy',
      projKind: pk, dmgType,
      fromX: fp.x, fromY: fp.y, toX: target.x, toY: target.y,
    });
    if (usingInstant) {
      u.instantHitsLeft -= 1;
      if (u.instantHitsLeft <= 0) u.instantBb = null;
    } else if (sk?.spType === 'INCREASE_WHEN_ATTACK') {
      gainSp(u, sk.increment || 1, 'attack');
    }
  }

  function stepEnemyAttack(e) {
    e.atkPulse = false;
    e.diePulse = false;
    if (!e.blocked || e.blockerId == null) return;
    e.atkCd -= DT;
    if (e.atkCd > 0) return;
    const u = units.find((x) => x.id === e.blockerId && x.alive);
    if (!u) return;
    const dx = (u.c + 0.5) - e.x;
    if (Math.abs(dx) > 0.05) e.face = dx >= 0 ? 1 : -1;
    const iv = e.baseAttackTime || 2;
    const dmg = computeDamage('physical', e.atk, u.stats);
    const tp = unitPos(u);
    queueHit('enemy', e.id, u.id, dmg, iv, { fromX: e.x, fromY: e.y, toX: tp.x, toY: tp.y, dmgType: 'physical' });
    e.atkCd = iv;
    e.atkPulse = true;
    e.atkInterval = iv;
    emit({
      type: 'atk', fromId: e.id, targetId: u.id, fromWho: 'enemy', toWho: 'op',
      projKind: 'none', dmgType: 'physical',
      fromX: e.x, fromY: e.y, toX: tp.x, toY: tp.y,
    });
  }

  function liveRangeGrids(u) {
    const useSkill = !!u.skillOn || (u.instantHitsLeft | 0) > 0;
    if (useSkill && u.stats.skillRangeGrids?.length) return u.stats.skillRangeGrids;
    return u.stats.rangeGrids || [{ row: 0, col: 0 }];
  }

  function inRange(u, x, y) {
    const grids = liveRangeGrids(u);
    const dir = normDir(u.dir);
    const er = Math.floor(y);
    const ec = Math.floor(x);
    for (const g of grids) {
      // dir.js assumes row 0 = bottom; Crisis map row 0 = top → flip row delta.
      const [dr, dc] = rotateOffset(g.row | 0, g.col | 0, dir);
      if (u.r - dr === er && u.c + dc === ec) return true;
    }
    // Also: same tile always
    if (Math.floor(y) === u.r && Math.floor(x) === u.c) return true;
    return false;
  }

  /**
   * @param {string} opId
   * @param {number} r
   * @param {number} c
   * @param {string|1|-1} [facing] 卫戍四向名，或旧 ±1（→ RIGHT / ← LEFT）
   */
  function deploy(opId, r, c, facing = DEFAULT_DIR) {
    if (status !== 'running') return { ok: false, error: 'not running' };
    const h = hand.get(opId);
    if (!h) return { ok: false, error: 'not in squad' };
    const isToken = h.kind === 'token';
    if (!isToken && time < h.readyAt) return { ok: false, error: 'redeploying' };
    // Crisis TD: summons occupy the same characterLimit as operators.
    if (units.filter((u) => u.alive).length >= deployLimit) return { ok: false, error: 'deploy limit' };
    if (!map.grid[r]?.[c]) return { ok: false, error: 'oob' };
    const cell = map.grid[r][c];
    if (!tileAccepts(h.stats.position, cell.buildableType)) {
      const need = h.stats.position === 'RANGED' ? 'RANGED' : h.stats.position === 'ALL' ? 'ALL' : 'MELEE';
      return { ok: false, error: `need ${need} tile` };
    }
    if (units.some((u) => u.alive && u.r === r && u.c === c)) return { ok: false, error: 'occupied' };
    if (cost < h.stats.deployCost) return { ok: false, error: 'cost' };

    if (isToken) {
      if (!units.some((u) => u.alive && u.opId === h.ownerId && u.kind !== 'token')) {
        return { ok: false, error: 'owner down' };
      }
      const onField = units.filter((u) => u.alive && u.opId === opId).length;
      if (onField >= (h.fieldMax || h.copies || 1)) return { ok: false, error: 'token cap' };
      if (tokenAvailable(h) <= 0) return { ok: false, error: 'token cap' };
    }

    cost -= h.stats.deployCost;
    if (!isToken) h.readyAt = Infinity; // until retreat/death sets timer
    let dir = normDir(facing, DEFAULT_DIR);
    // If caller passed junk / default and blue is known, face toward the objective like before.
    if (facing == null && map.blue) {
      dir = dirFromDelta(0, map.blue.c - c, DEFAULT_DIR);
    }
    const sk = h.stats.skill || null;
    const maxSp = sk ? Math.max(0, sk.spCost) : 0;
    const initSp = sk ? Math.min(maxSp, Math.max(0, sk.initSp)) : 0;
    const uid = nextUnitId++;
    units.push({
      id: uid,
      opId,
      kind: isToken ? 'token' : 'op',
      ownerId: isToken ? h.ownerId : null,
      name: h.name,
      alive: true,
      r,
      c,
      dir,
      hp: h.stats.maxHp,
      maxHp: h.stats.maxHp,
      stats: h.stats,
      skill: sk,
      atkCd: 0.1,
      atkPulse: false,
      atkInterval: attackInterval(h.stats),
      blocking: [],
      sp: initSp,
      maxSp,
      skillOn: false,
      skillLeft: 0,
      instantHitsLeft: 0,
      instantBb: null,
    });
    if (!isToken) grantTokensFor(opId, h.loadout);
    emit({
      type: 'deploy', who: 'op', id: uid, opId,
      x: c + 0.5, y: r + 0.5,
    });
    return { ok: true };
  }

  function retreat(unitId) {
    const u = units.find((x) => x.id === unitId && x.alive);
    if (!u) return { ok: false };
    const h = hand.get(u.opId);
    // Refund half cost [ASSUMED]
    if (h) cost = Math.min(maxCost, cost + Math.floor(h.stats.deployCost / 2));
    killUnit(u, true);
    return { ok: true };
  }

  /**
   * Manual skill cast (official MANUAL skills). AUTO skills fire themselves.
   * @param {number} unitId
   */
  function castSkill(unitId) {
    const u = units.find((x) => x.id === unitId && x.alive);
    if (!u) return { ok: false, error: 'gone' };
    if (!u.skill || u.skill.skillType === 'PASSIVE') return { ok: false, error: 'no skill' };
    if (u.skill.skillType === 'AUTO') return { ok: false, error: 'auto' };
    // Manual toggle-off for permanent skills (duration < 0)
    if (u.skillOn && u.skill.duration < 0) {
      u.skillOn = false;
      u.skillLeft = 0;
      const p = unitPos(u);
      emit({ type: 'skill', id: u.id, opId: u.opId, name: u.skill.name, x: p.x, y: p.y, duration: 0, off: true });
      return { ok: true };
    }
    if (u.skillOn || (u.instantHitsLeft | 0) > 0) return { ok: false, error: 'active' };
    if (u.sp < u.maxSp) return { ok: false, error: 'sp' };
    if (!activateSkill(u)) return { ok: false, error: 'sp' };
    return { ok: true };
  }

  function enemyMoving(e) {
    if (!e.alive || e.dying) return false;
    if (e.blocked) return false;
    if (e.waitLeft > 0) return false;
    return true;
  }

  function snapEnemy(e) {
    return {
      id: e.id, key: e.key, name: e.name, x: e.x, y: e.y, hp: Math.max(0, e.hp), maxHp: e.maxHp,
      blocked: e.blocked, moving: enemyMoving(e), face: e.face || 1, alive: !!e.alive, dying: !!e.dying,
      atkPulse: !!e.atkPulse, atkInterval: e.atkInterval || e.baseAttackTime || 2,
      diePulse: !!e.diePulse,
    };
  }

  function snapUnit(u) {
    const sk = u.skill;
    const busy = !!u.skillOn || (u.instantHitsLeft | 0) > 0;
    const toggleOff = !!u.skillOn && sk?.duration < 0 && sk?.skillType === 'MANUAL';
    return {
      id: u.id, opId: u.opId, name: u.name, r: u.r, c: u.c,
      kind: u.kind === 'token' ? 'token' : 'op',
      ownerId: u.ownerId || null,
      dir: normDir(u.dir),
      face: hSign(u.dir), // sprite flip; same as 卫戍 hSign(dir)
      hp: Math.max(0, u.hp), maxHp: u.maxHp,
      position: u.stats.position,
      profession: u.stats.profession || null,
      rangeGrids: liveRangeGrids(u),
      sp: Math.floor(u.sp), maxSp: u.maxSp, skillOn: !!u.skillOn,
      skillReady: !!u.alive && ((toggleOff) || (!busy && u.maxSp > 0 && u.sp >= u.maxSp && sk?.skillType === 'MANUAL')),
      skillId: sk?.skillId || null,
      skillName: sk?.name || null,
      skillType: sk?.skillType || null,
      skillToggle: !!toggleOff,
      atkPulse: !!u.atkPulse, atkInterval: u.atkInterval || attackInterval(u.stats),
      diePulse: !!u.diePulse, alive: !!u.alive, dying: !!u.dying,
    };
  }

  function snapHandEntry(id, h) {
    const position = h.stats.position;
    const base = {
      id, name: h.name, cost: h.stats.deployCost,
      position,
      profession: h.stats.profession,
      rangeGrids: h.stats.rangeGrids || [{ row: 0, col: 0 }],
      borrow: !!h.borrow,
    };
    if (h.kind === 'token') {
      const available = tokenAvailable(h);
      const ownerAlive = units.some((u) => u.alive && u.opId === h.ownerId && u.kind !== 'token');
      const nextCool = (h.coolUntil || []).length
        ? Math.min(...h.coolUntil)
        : 0;
      return {
        ...base,
        kind: 'token',
        ownerId: h.ownerId,
        copies: h.copies | 0,
        fieldMax: h.fieldMax || h.copies || 1,
        available,
        readyAt: 0,
        ready: available > 0 && ownerAlive,
        cdLeft: available > 0 || !nextCool ? 0 : Math.max(0, Math.ceil(nextCool - time)),
      };
    }
    return {
      ...base,
      kind: 'op',
      readyAt: h.readyAt,
      ready: time >= h.readyAt && !units.some((u) => u.alive && u.opId === id),
      cdLeft: Math.max(0, Math.ceil(h.readyAt - time)),
    };
  }

  function snapshot() {
    // Clear one-frame die pulses after they're observed once via snapshot (next tick resets anyway)
    return {
      time: Math.round(time * 10) / 10,
      status,
      life,
      cost,
      maxCost,
      deployLimit,
      killed,
      leaked,
      spawned: totalSpawned,
      remaining: schedule.length - schedPtr,
      enemies: enemies.filter((e) => e.alive || e.dying).map(snapEnemy),
      units: units.filter((u) => u.alive || u.dying).map(snapUnit),
      hand: [...hand.entries()].map(([id, h]) => snapHandEntry(id, h)),
      map: {
        rows: map.rows,
        cols: map.cols,
        cells: map.grid.map((row) => row.map((cell) => ({
          tileKey: cell.tileKey,
          buildableType: cell.buildableType,
          heightType: cell.heightType,
          blockedByContract: !!cell.blockedByContract,
        }))),
      },
    };
  }

  function drainEvents() {
    const out = events;
    events = [];
    return out;
  }

  return {
    DT,
    tick,
    deploy,
    retreat,
    castSkill,
    snapshot,
    drainEvents,
    /** Run N ticks (for tests / fast-forward). */
    step(n = 1) {
      let snap = snapshot();
      for (let i = 0; i < n && status === 'running'; i++) snap = tick();
      return snap;
    },
  };
}

/**
 * Flatten waves into absolute spawn times.
 * Fragment timing in official data: each fragment has preDelay; actions have preDelay from fragment start.
 * [ASSUMED] single wave / fragments run sequentially; fragment preDelay stacks.
 */
function buildSpawnSchedule(waves) {
  /** @type {{ t: number, key: string, routeIndex: number }[]} */
  const out = [];
  let tWave = 0;
  for (const wave of waves || []) {
    let tFrag = tWave;
    for (const frag of wave.fragments || []) {
      const fragPre = Number(frag.preDelay) || 0;
      tFrag += fragPre;
      for (const a of frag.actions || []) {
        if (a.actionType !== 'SPAWN') continue;
        const count = Math.max(1, a.count | 0);
        const pre = Number(a.preDelay) || 0;
        const iv = Number(a.interval) || 1;
        for (let i = 0; i < count; i++) {
          out.push({
            t: tFrag + pre + i * iv,
            key: a.key,
            routeIndex: a.routeIndex | 0,
          });
        }
      }
      // Advance fragment cursor by max action end [ASSUMED]
      let fragEnd = 0;
      for (const a of frag.actions || []) {
        if (a.actionType !== 'SPAWN') continue;
        const count = Math.max(1, a.count | 0);
        const pre = Number(a.preDelay) || 0;
        const iv = Number(a.interval) || 1;
        fragEnd = Math.max(fragEnd, pre + Math.max(0, count - 1) * iv);
      }
      tFrag += fragEnd;
    }
    tWave = tFrag;
  }
  out.sort((a, b) => a.t - b.t);
  return out;
}

export { DT };
