// 第13位助战：不受隐秘行动编队人数上限限制。
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createBattle } from '../../shared/crisis/sim/battle.js';
import { squadSizeCapOf } from '../../shared/crisis/sim/runes.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const STAGE = path.join(ROOT, 'public/crisis/data/stages/level_rune_01-03.json');
const ENEMIES = path.join(ROOT, 'public/crisis/data/enemies.json');
const OPS = path.join(ROOT, 'public/crisis/data/battle-ops.json');
const SEASON = path.join(ROOT, 'public/crisis/data/seasons/cc-beta.json');
const hasPacks = [STAGE, ENEMIES, OPS, SEASON].every((p) => fs.existsSync(p));

describe('crisis borrow slot', { skip: !hasPacks }, () => {
  const stage = JSON.parse(fs.readFileSync(STAGE, 'utf8'));
  const enemies = JSON.parse(fs.readFileSync(ENEMIES, 'utf8')).enemies;
  const operators = JSON.parse(fs.readFileSync(OPS, 'utf8')).operators;
  const season = JSON.parse(fs.readFileSync(SEASON, 'utf8'));

  it('squadSizeCapOf reads covert III as 4', () => {
    assert.equal(squadSizeCapOf(['obj_covert_3'], season.contracts), 4);
  });

  it('keeps borrow in hand under covert III', () => {
    const ids = Object.keys(operators).filter((id) => operators[id].profession !== 'TOKEN').slice(0, 8);
    assert.ok(ids.length >= 5);
    const squad = ids.slice(0, 4).map((id) => ({
      id,
      loadout: { elite: 2, level: 90, potential: 5, skillIndex: 0, specialize: 3, trust: 200 },
    }));
    const borrowId = ids[4];
    const b = createBattle({
      stage,
      enemies,
      operators,
      squad,
      borrow: {
        id: borrowId,
        loadout: { elite: 2, level: 90, potential: 5, skillIndex: 0, specialize: 3, trust: 200 },
      },
      contractIds: ['obj_covert_3'],
      seasonContracts: season.contracts,
    });
    const hand = b.snapshot().hand;
    assert.equal(hand.filter((h) => !h.borrow).length, 4);
    assert.ok(hand.some((h) => h.borrow && h.id === borrowId));
    assert.equal(hand.length, 5);
  });
});
