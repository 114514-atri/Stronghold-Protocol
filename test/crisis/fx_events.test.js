// Crisis battle events for CombatFxBridge (atk / hit / skill / die / deploy).
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createBattle } from '../../shared/crisis/sim/battle.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const STAGE = path.join(ROOT, 'public/crisis/data/stages/level_rune_01-03.json');
const ENEMIES = path.join(ROOT, 'public/crisis/data/enemies.json');
const OPS = path.join(ROOT, 'public/crisis/data/battle-ops.json');
const hasPacks = fs.existsSync(STAGE) && fs.existsSync(ENEMIES) && fs.existsSync(OPS);

describe('crisis fx events', { skip: !hasPacks }, () => {
  const stage = JSON.parse(fs.readFileSync(STAGE, 'utf8'));
  const enemies = JSON.parse(fs.readFileSync(ENEMIES, 'utf8')).enemies;
  const operators = JSON.parse(fs.readFileSync(OPS, 'utf8')).operators;

  it('emits deploy + drains via drainEvents', () => {
    const b = createBattle({
      stage,
      enemies,
      operators,
      squad: [{ id: 'char_103_angel', loadout: { elite: 2, level: 90, potential: 5, skillIndex: 1, specialize: 3, trust: 200 } }],
      contractIds: [],
      seasonContracts: { support: [], optional: [] },
    });
    b.step(50);
    let cell = null;
    const snap0 = b.snapshot();
    for (let r = 0; r < snap0.map.rows && !cell; r++) {
      for (let c = 0; c < snap0.map.cols; c++) {
        if (snap0.map.cells[r][c].buildableType === 'RANGED') { cell = { r, c }; break; }
      }
    }
    assert.ok(cell);
    assert.equal(b.deploy('char_103_angel', cell.r, cell.c, 'RIGHT').ok, true);
    const ev = b.drainEvents();
    assert.ok(ev.some((e) => e.type === 'deploy' && e.opId === 'char_103_angel'));
    assert.equal(b.drainEvents().length, 0);
  });

  it('emits atk then hit when an operator fires', () => {
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
    for (let r = 0; r < snap0.map.rows && !cell; r++) {
      for (let c = 0; c < snap0.map.cols; c++) {
        if (snap0.map.cells[r][c].buildableType === 'RANGED') { cell = { r, c }; break; }
      }
    }
    assert.ok(cell);
    assert.equal(b.deploy('char_103_angel', cell.r, cell.c, 'RIGHT').ok, true);
    b.drainEvents();
    /** @type {any[]} */
    const bag = [];
    for (let i = 0; i < 400; i++) {
      b.tick();
      bag.push(...b.drainEvents());
      if (bag.some((e) => e.type === 'hit')) break;
    }
    assert.ok(bag.some((e) => e.type === 'atk'), 'expected atk');
    assert.ok(bag.some((e) => e.type === 'hit'), 'expected hit');
    const atk = bag.find((e) => e.type === 'atk' && e.fromWho === 'op');
    if (atk) assert.ok(atk.projKind === 'arrow' || atk.projKind === 'bolt' || atk.projKind === 'orb' || atk.projKind === 'none');
  });
});
