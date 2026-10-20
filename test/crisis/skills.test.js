import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveSkillLevel, applySkillBlackboard, operatorCombatStats } from '../../shared/crisis/sim/stats.js';
import { defaultLoadout } from '../../shared/crisis/loadout.js';
import { createBattle } from '../../shared/crisis/sim/battle.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const OPS = path.join(ROOT, 'public/crisis/data/battle-ops.json');
const STAGE = path.join(ROOT, 'public/crisis/data/stages/level_rune_01-03.json');
const ENEMIES = path.join(ROOT, 'public/crisis/data/enemies.json');
const has = fs.existsSync(OPS) && fs.existsSync(STAGE);

describe('crisis skill pack', { skip: !has }, () => {
  const operators = JSON.parse(fs.readFileSync(OPS, 'utf8')).operators;
  const angel = operators.char_103_angel;

  it('packs Exusiai skills with official SP rows', () => {
    assert.ok(angel.skills?.length >= 3);
    const s2 = angel.skills[1];
    assert.equal(s2.skillId, 'skchr_angel_2');
    const m3 = s2.levels[9];
    assert.equal(m3.spType, 'INCREASE_WITH_TIME');
    assert.equal(m3.skillType, 'MANUAL');
    assert.equal(m3.spCost, 35);
    assert.equal(m3.initSp, 25);
    assert.equal(m3.duration, 15);
    assert.ok(m3.bb['attack@atk_scale'] >= 1);
  });

  it('resolveSkillLevel uses specialize → M3', () => {
    const lo = defaultLoadout(angel);
    assert.equal(lo.skillIndex, 1);
    assert.equal(lo.specialize, 3);
    const sk = resolveSkillLevel(angel, lo);
    assert.equal(sk.spCost, 35);
    assert.equal(sk.initSp, 25);
    assert.equal(sk.duration, 15);
  });

  it('applySkillBlackboard scales atk and aspd', () => {
    const out = applySkillBlackboard(
      { atk: 100, attackSpeed: 100, baseAttackTime: 1, def: 50 },
      { 'attack@atk_scale': 1.25, attack_speed: 30, base_attack_time: -0.1 },
    );
    assert.equal(out.atk, 125);
    assert.equal(out.attackSpeed, 130);
    assert.ok(Math.abs(out.baseAttackTime - 0.9) < 1e-9);
  });

  it('deploy starts at official initSp; manual cast opens duration skill', () => {
    const stage = JSON.parse(fs.readFileSync(STAGE, 'utf8'));
    const enemies = JSON.parse(fs.readFileSync(ENEMIES, 'utf8')).enemies;
    const lo = defaultLoadout(angel);
    const b = createBattle({
      stage, enemies, operators,
      squad: [{ id: 'char_103_angel', loadout: lo }],
      contractIds: [],
      seasonContracts: { support: [], optional: [] },
    });
    b.step(50);
    const snap0 = b.snapshot();
    let cell = null;
    for (let r = 0; r < snap0.map.rows; r++) {
      for (let c = 0; c < snap0.map.cols; c++) {
        if (snap0.map.cells[r][c].buildableType === 'RANGED') { cell = { r, c }; break; }
      }
      if (cell) break;
    }
    assert.ok(cell);
    assert.equal(b.deploy('char_103_angel', cell.r, cell.c, 1).ok, true);
    const u0 = b.snapshot().units[0];
    assert.equal(u0.sp, 25);
    assert.equal(u0.maxSp, 35);
    // Charge remaining 10 SP at +1/s
    for (let i = 0; i < 110; i++) b.tick();
    const ready = b.snapshot().units[0];
    assert.equal(ready.skillReady, true);
    assert.equal(b.castSkill(ready.id).ok, true);
    const on = b.snapshot().units[0];
    assert.equal(on.skillOn, true);
    assert.equal(on.sp, 0);
  });

  it('preserves duration -1 as toggle skill (not clamped to instant)', () => {
    const chiave = operators.char_349_chiave;
    assert.ok(chiave);
    // 贾维 S2: MANUAL + INCREASE_WITH_TIME + duration -1
    const sk = resolveSkillLevel(chiave, { skillIndex: 1, specialize: 3 });
    assert.equal(sk.duration, -1);
    assert.equal(sk.skillType, 'MANUAL');
    assert.equal(sk.spType, 'INCREASE_WITH_TIME');
    const stage = JSON.parse(fs.readFileSync(STAGE, 'utf8'));
    const enemies = JSON.parse(fs.readFileSync(ENEMIES, 'utf8')).enemies;
    const b = createBattle({
      stage, enemies, operators,
      squad: [{ id: 'char_349_chiave', loadout: { elite: 2, level: 80, skillIndex: 1, specialize: 3 } }],
      contractIds: [],
      seasonContracts: { support: [], optional: [] },
    });
    for (let i = 0; i < 300 && b.snapshot().cost < 13; i++) b.tick();
    const snap0 = b.snapshot();
    let cell = null;
    for (let r = 0; r < snap0.map.rows; r++) {
      for (let c = 0; c < snap0.map.cols; c++) {
        const t = snap0.map.cells[r][c].buildableType;
        if (t === 'MELEE' || t === 'ALL') { cell = { r, c }; break; }
      }
      if (cell) break;
    }
    assert.ok(cell);
    assert.equal(b.deploy('char_349_chiave', cell.r, cell.c, 'RIGHT').ok, true);
    // initSp 35 → need ~10s more
    for (let i = 0; i < 120; i++) b.tick();
    const ready = b.snapshot().units[0];
    assert.equal(ready.skillReady, true);
    assert.equal(b.castSkill(ready.id).ok, true);
    const on = b.snapshot().units[0];
    assert.equal(on.skillOn, true);
    assert.equal(on.skillToggle, true);
    for (let i = 0; i < 200; i++) b.tick();
    assert.equal(b.snapshot().units[0].skillOn, true);
    assert.equal(b.castSkill(on.id).ok, true);
    assert.equal(b.snapshot().units[0].skillOn, false);
  });

  it('uses base range until skill is on; skill rangeId applies while active', () => {
    const chen = operators.char_010_chen;
    assert.ok(chen);
    const lo = { elite: 2, level: 80, skillIndex: 1, specialize: 3 };
    const st = operatorCombatStats(chen, lo);
    assert.ok(st.rangeGrids?.length);
    assert.ok(st.skillRangeGrids?.length);
    assert.notEqual(JSON.stringify(st.rangeGrids), JSON.stringify(st.skillRangeGrids));
    const stage = JSON.parse(fs.readFileSync(STAGE, 'utf8'));
    const enemies = JSON.parse(fs.readFileSync(ENEMIES, 'utf8')).enemies;
    const b = createBattle({
      stage, enemies, operators,
      squad: [{ id: 'char_010_chen', loadout: lo }],
      contractIds: [],
      seasonContracts: { support: [], optional: [] },
    });
    for (let i = 0; i < 600 && b.snapshot().cost < 23; i++) b.tick();
    const snap0 = b.snapshot();
    assert.ok(snap0.cost >= 23, `cost ${snap0.cost}`);
    let cell = null;
    for (let r = 0; r < snap0.map.rows; r++) {
      for (let c = 0; c < snap0.map.cols; c++) {
        if (snap0.map.cells[r][c].buildableType === 'MELEE' || snap0.map.cells[r][c].buildableType === 'ALL') {
          cell = { r, c }; break;
        }
      }
      if (cell) break;
    }
    assert.ok(cell);
    assert.equal(b.deploy('char_010_chen', cell.r, cell.c, 'RIGHT').ok, true);
    const idle = b.snapshot().units[0];
    assert.deepEqual(idle.rangeGrids, st.rangeGrids);
    // Chen S2: INCREASE_WITH_TIME; charge then cast — range expands for the instant volley
    for (let i = 0; i < 1200; i++) b.tick();
    const ready = b.snapshot().units[0];
    assert.equal(ready.skillReady, true, `sp ${ready.sp}/${ready.maxSp}`);
    assert.equal(b.castSkill(ready.id).ok, true);
    const volley = b.snapshot().units[0];
    assert.deepEqual(volley.rangeGrids, st.skillRangeGrids);
  });
});
