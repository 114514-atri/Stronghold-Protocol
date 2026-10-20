import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseMap, expandRoute, fromBottomLeft } from '../../shared/crisis/sim/map.js';
import { createBattle } from '../../shared/crisis/sim/battle.js';
import { computeDamage, tileAccepts } from '../../shared/crisis/sim/stats.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const STAGE = path.join(ROOT, 'public/crisis/data/stages/level_rune_01-03.json');
const ENEMIES = path.join(ROOT, 'public/crisis/data/enemies.json');
const OPS = path.join(ROOT, 'public/crisis/data/battle-ops.json');
const TOKENS = path.join(ROOT, 'public/crisis/data/deploy-tokens.json');

const hasPacks = fs.existsSync(STAGE) && fs.existsSync(ENEMIES) && fs.existsSync(OPS);
const hasTokens = hasPacks && fs.existsSync(TOKENS);

describe('crisis map coords', { skip: !hasPacks }, () => {
  const stage = JSON.parse(fs.readFileSync(STAGE, 'utf8'));
  const map = parseMap(stage);

  it('converts bottom-left route start to red portal, end to blue', () => {
    const route = map.routes[1];
    const start = fromBottomLeft(route.startPosition, map.rows);
    const end = fromBottomLeft(route.endPosition, map.rows);
    assert.equal(map.grid[start.r][start.c].isStart, true);
    assert.equal(map.grid[end.r][end.c].isEnd, true);
  });

  it('expands route 1 from red to blue without looping back', () => {
    const ex = expandRoute(map, 1);
    assert.ok(ex && ex.cells.length > 5);
    assert.equal(ex.cells[0].r, 1);
    assert.equal(ex.cells[0].c, 0);
    const last = ex.cells[ex.cells.length - 1];
    assert.equal(last.r, map.blue.r);
    assert.equal(last.c, map.blue.c);
    // Must not visit blue in the middle then leave and return.
    const blueHits = ex.cells.filter((p) => p.r === map.blue.r && p.c === map.blue.c);
    assert.equal(blueHits.length, 1);
  });
});

describe('crisis combat math', () => {
  it('physical damage floors at 5% atk', () => {
    assert.equal(computeDamage('physical', 100, { def: 1000, res: 0 }), 5);
    assert.equal(computeDamage('physical', 100, { def: 20, res: 0 }), 80);
  });
  it('arts damage scales with res', () => {
    assert.equal(computeDamage('arts', 100, { def: 0, res: 50 }), 50);
  });
  it('ALL position accepts melee and ranged tiles', () => {
    assert.equal(tileAccepts('ALL', 'MELEE'), true);
    assert.equal(tileAccepts('ALL', 'RANGED'), true);
    assert.equal(tileAccepts('ALL', 'NONE'), false);
    assert.equal(tileAccepts('MELEE', 'RANGED'), false);
  });
});

describe('crisis battle slice', { skip: !hasPacks }, () => {
  const stage = JSON.parse(fs.readFileSync(STAGE, 'utf8'));
  const enemies = JSON.parse(fs.readFileSync(ENEMIES, 'utf8')).enemies;
  const operators = JSON.parse(fs.readFileSync(OPS, 'utf8')).operators;

  it('spawns from red and does not instantly leak on tick 1', () => {
    const b = createBattle({
      stage,
      enemies,
      operators,
      squad: [{ id: 'char_103_angel', loadout: { elite: 2, level: 90, potential: 5, skillIndex: 1, specialize: 3, trust: 200 } }],
      contractIds: [],
      seasonContracts: { support: [], optional: [] },
    });
    // Advance past first spawn (~3s)
    const snap = b.step(40);
    assert.ok(snap.spawned >= 1);
    assert.equal(snap.leaked, 0);
    assert.ok(snap.enemies.length >= 1);
    const e = snap.enemies[0];
    // Still near top-left red, not on blue
    assert.ok(e.y < 5, `enemy y=${e.y} should not be near blue yet`);
  });

  it('allows deploy after cost regenerates', () => {
    const b = createBattle({
      stage,
      enemies,
      operators,
      squad: [{ id: 'char_103_angel', loadout: { elite: 2, level: 90, potential: 5, skillIndex: 1, specialize: 3, trust: 200 } }],
      contractIds: [],
      seasonContracts: { support: [], optional: [] },
    });
    // Wait for DP (exusiai cost 14, start 10, +1/s)
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
    const res = b.deploy('char_103_angel', cell.r, cell.c, 1);
    assert.equal(res.ok, true, res.error);
    assert.equal(b.snapshot().units.length, 1);
  });

  it('supports retreat and skill cast on a deployed unit', () => {
    const b = createBattle({
      stage,
      enemies,
      operators,
      squad: [{ id: 'char_103_angel', loadout: { elite: 2, level: 90, potential: 5, skillIndex: 1, specialize: 3, trust: 200 } }],
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
    const u = b.snapshot().units[0];
    assert.equal(u.maxSp, 35);
    assert.equal(u.sp, 25);
    // Charge remaining SP (+1/s)
    for (let i = 0; i < 120; i++) b.tick();
    const ready = b.snapshot().units[0];
    assert.equal(ready.skillReady, true);
    assert.equal(b.castSkill(ready.id).ok, true);
    assert.equal(b.snapshot().units[0].skillOn, true);
    assert.equal(b.retreat(ready.id).ok, true);
    const after = b.snapshot().units;
    assert.equal(after.filter((x) => x.alive).length, 0);
    assert.ok(after.some((x) => x.dying), 'retreat keeps a brief Die linger');
  });

  it('marks walking enemies moving, wait/block as idle', () => {
    const b = createBattle({
      stage,
      enemies,
      operators,
      squad: [{ id: 'char_103_angel', loadout: { elite: 2, level: 90, potential: 5, skillIndex: 1, specialize: 3, trust: 200 } }],
      contractIds: [],
      seasonContracts: { support: [], optional: [] },
    });
    let walking = null;
    for (let i = 0; i < 200 && !walking; i++) {
      const snap = b.tick();
      walking = (snap.enemies || []).find((e) => e.alive && e.moving);
    }
    assert.ok(walking, 'a spawned enemy should report moving while on the path');

    const map = parseMap(stage);
    let waitRoute = -1;
    let waitSec = 0;
    for (let i = 0; i < map.routes.length; i++) {
      const ex = expandRoute(map, i);
      const w = (ex?.waits || []).find((x) => x.seconds >= 0.5);
      if (w) { waitRoute = i; waitSec = w.seconds; break; }
    }
    if (waitRoute >= 0 && waitSec >= 0.5) {
      let sawIdleWait = false;
      let prev = new Map();
      const ticks = Math.min(800, Math.ceil((waitSec + 8) / 0.1) + 40);
      for (let i = 0; i < ticks; i++) {
        const snap = b.tick();
        for (const e of snap.enemies || []) {
          if (!e.alive) continue;
          const p = prev.get(e.id);
          if (p && Math.abs(e.x - p.x) < 1e-6 && Math.abs(e.y - p.y) < 1e-6) {
            if (e.moving === false) sawIdleWait = true;
          }
          prev.set(e.id, { x: e.x, y: e.y });
        }
      }
      assert.equal(sawIdleWait, true, `route ${waitRoute} has a ${waitSec}s wait; standing enemies must not be moving`);
    }
  });

  it('stores 4-dir facing like 卫戍 (UP/RIGHT/DOWN/LEFT)', () => {
    const mk = () => createBattle({
      stage,
      enemies,
      operators,
      squad: [{ id: 'char_103_angel', loadout: { elite: 2, level: 90, potential: 5, skillIndex: 1, specialize: 3, trust: 200 } }],
      contractIds: [],
      seasonContracts: { support: [], optional: [] },
    });
    const rangedCell = (b) => {
      const snap0 = b.snapshot();
      for (let r = 0; r < snap0.map.rows; r++) {
        for (let c = 0; c < snap0.map.cols; c++) {
          if (snap0.map.cells[r][c].buildableType === 'RANGED') return { r, c };
        }
      }
      return null;
    };
    {
      const b = mk();
      b.step(50);
      const cell = rangedCell(b);
      assert.ok(cell);
      assert.equal(b.deploy('char_103_angel', cell.r, cell.c, 'UP').ok, true);
      const u = b.snapshot().units[0];
      assert.equal(u.dir, 'UP');
      assert.equal(u.face, 1); // hSign(UP) = +1
    }
    {
      const b = mk();
      b.step(50);
      const cell = rangedCell(b);
      assert.ok(cell);
      assert.equal(b.deploy('char_103_angel', cell.r, cell.c, 'LEFT').ok, true);
      const u = b.snapshot().units[0];
      assert.equal(u.dir, 'LEFT');
      assert.equal(u.face, -1);
    }
  });
});

describe('crisis hand-placeable tokens', { skip: !hasTokens }, () => {
  const stage = JSON.parse(fs.readFileSync(STAGE, 'utf8'));
  const enemies = JSON.parse(fs.readFileSync(ENEMIES, 'utf8')).enemies;
  const operators = JSON.parse(fs.readFileSync(OPS, 'utf8')).operators;
  const tokPack = JSON.parse(fs.readFileSync(TOKENS, 'utf8'));
  const tokens = tokPack.tokens;
  const tokenByOwner = tokPack.byOwner;

  function findTile(snap, buildable) {
    for (let r = 0; r < snap.map.rows; r++) {
      for (let c = 0; c < snap.map.cols; c++) {
        if (snap.map.cells[r][c].buildableType === buildable) return { r, c };
      }
    }
    return null;
  }

  function mkWang() {
    return createBattle({
      stage,
      enemies,
      operators,
      tokens,
      tokenByOwner,
      squad: [{ id: 'char_2027_wang', loadout: { elite: 2, level: 90, potential: 5, skillIndex: 0, specialize: 3, trust: 200 } }],
      contractIds: [],
      seasonContracts: { support: [], optional: [] },
    });
  }

  it('grants 望 棋子 to hand on deploy and places on melee or ranged', () => {
    assert.ok(operators.char_2027_wang, 'wang in battle-ops');
    assert.ok(tokens.token_10064_wang_stone1, 'wang stone packed');
    const b = mkWang();
    for (let i = 0; i < 80 && b.snapshot().cost < 12; i++) b.tick();
    const high = findTile(b.snapshot(), 'RANGED');
    assert.ok(high);
    const dep = b.deploy('char_2027_wang', high.r, high.c, 'RIGHT');
    assert.equal(dep.ok, true, dep.error);
    const hand = b.snapshot().hand;
    const stone = hand.find((h) => h.id === 'token_10064_wang_stone1');
    assert.ok(stone, '棋子 appears in hand after 望 deploys');
    assert.equal(stone.kind, 'token');
    assert.equal(stone.position, 'ALL');
    assert.ok(stone.copies >= 1);
    assert.equal(stone.ready, true);

    // Place one on melee (ALL) — find a free melee tile
    const melee = findTile(b.snapshot(), 'MELEE');
    assert.ok(melee);
    for (let i = 0; i < 40 && b.snapshot().cost < stone.cost; i++) b.tick();
    const res = b.deploy('token_10064_wang_stone1', melee.r, melee.c, 'UP');
    assert.equal(res.ok, true, res.error);
    const u = b.snapshot().units.find((x) => x.opId === 'token_10064_wang_stone1' && x.alive);
    assert.ok(u);
    assert.equal(u.kind, 'token');
    assert.equal(u.ownerId, 'char_2027_wang');
  });

  it('refuses token deploy when owner is off the field', () => {
    const b = mkWang();
    for (let i = 0; i < 80 && b.snapshot().cost < 12; i++) b.tick();
    const high = findTile(b.snapshot(), 'RANGED');
    assert.equal(b.deploy('char_2027_wang', high.r, high.c, 'RIGHT').ok, true);
    const wang = b.snapshot().units.find((u) => u.opId === 'char_2027_wang');
    assert.ok(wang);
    assert.equal(b.retreat(wang.id).ok, true);
    const melee = findTile(b.snapshot(), 'MELEE');
    for (let i = 0; i < 40 && b.snapshot().cost < 10; i++) b.tick();
    const res = b.deploy('token_10064_wang_stone1', melee.r, melee.c, 'UP');
    assert.equal(res.ok, false);
    assert.equal(res.error, 'owner down');
  });

  it('grants only 令\'s selected-skill dragon', () => {
    assert.ok(operators.char_2023_ling);
    const b = createBattle({
      stage,
      enemies,
      operators,
      tokens,
      tokenByOwner,
      squad: [{ id: 'char_2023_ling', loadout: { elite: 2, level: 90, potential: 5, skillIndex: 1, specialize: 3, trust: 200 } }],
      contractIds: [],
      seasonContracts: { support: [], optional: [] },
    });
    for (let i = 0; i < 80 && b.snapshot().cost < 12; i++) b.tick();
    const tile = findTile(b.snapshot(), 'RANGED');
    assert.ok(tile);
    const dep = b.deploy('char_2023_ling', tile.r, tile.c, 'RIGHT');
    assert.equal(dep.ok, true, dep.error);
    const ids = b.snapshot().hand.filter((h) => h.kind === 'token').map((h) => h.id).sort();
    assert.deepEqual(ids, ['token_10020_ling_soul2']);
  });
});
