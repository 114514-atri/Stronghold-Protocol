import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  defaultLoadout, normalizeLoadout, maxElite, maxLevelForElite,
} from '../../shared/crisis/loadout.js';
import { resolveContractPick } from '../../shared/crisis/contracts.js';
import { FIRST_SEASON_ID, firstPlayableSeason, SEASONS } from '../../shared/crisis/seasons.js';
import { CRISIS_PATH, crisisFromHealth } from '../../shared/crisisBridge.js';

describe('crisis loadout', () => {
  const sixStar = {
    phases: [{ maxLevel: 50 }, { maxLevel: 80 }, { maxLevel: 90 }],
    skills: [{ skillId: 'a' }, { skillId: 'b' }, { skillId: 'c' }],
    maxPotentialLevel: 5,
  };

  it('defaults to max elite, level, potential, specialize, trust', () => {
    const lo = defaultLoadout(sixStar);
    assert.equal(lo.elite, 2);
    assert.equal(lo.level, 90);
    assert.equal(lo.potential, 5);
    assert.equal(lo.specialize, 3);
    assert.equal(lo.trust, 200);
    assert.equal(lo.skillIndex, 1);
  });

  it('clamps elite and level when player lowers training', () => {
    const lo = normalizeLoadout({ elite: 0, level: 999, potential: 99, skillIndex: 9, specialize: 9, trust: 999 }, sixStar);
    assert.equal(lo.elite, 0);
    assert.equal(lo.level, 50);
    assert.equal(lo.potential, 5);
    assert.equal(lo.skillIndex, 2);
    assert.equal(lo.specialize, 3);
    assert.equal(lo.trust, 200);
  });

  it('respects characters without E2', () => {
    const robot = { phases: [{ maxLevel: 30 }], skills: [], maxPotentialLevel: 5 };
    assert.equal(maxElite(robot.phases), 0);
    assert.equal(maxLevelForElite(robot.phases, 0), 30);
    const lo = defaultLoadout(robot);
    assert.equal(lo.elite, 0);
    assert.equal(lo.level, 30);
    assert.equal(lo.specialize, 0);
  });
});

describe('crisis contracts', () => {
  const contracts = {
    support: [{ id: 'sup', name: '支援', risk: 0 }],
    optional: [
      { id: 'a1', group: 'a', level: 1, risk: 1 },
      { id: 'a2', group: 'a', level: 2, risk: 2 },
      { id: 'b1', group: 'b', level: 1, risk: 1 },
    ],
  };

  it('rejects mutual exclusion in the same group', () => {
    const r = resolveContractPick(contracts, ['a1', 'a2']);
    assert.equal(r.ok, false);
  });

  it('zeros risk when a support contract is taken', () => {
    const r = resolveContractPick(contracts, ['sup', 'b1']);
    assert.equal(r.ok, true);
    assert.equal(r.risk, 0);
  });

  it('sums optional risk without support', () => {
    const r = resolveContractPick(contracts, ['a2', 'b1']);
    assert.equal(r.ok, true);
    assert.equal(r.risk, 3);
  });
});

describe('crisis seasons bridge', () => {
  it('starts from Contingency Contract β', () => {
    assert.equal(FIRST_SEASON_ID, 'cc-beta');
    assert.equal(firstPlayableSeason().id, 'cc-beta');
    assert.ok(SEASONS.some((s) => s.id === 'cc-beta' && s.playable));
  });

  it('exposes /crisis/ on healthz', () => {
    assert.equal(CRISIS_PATH, '/crisis/');
    const c = crisisFromHealth({ crisis: { path: '/crisis/', ready: true } });
    assert.deepEqual(c, { path: '/crisis/', ready: true });
  });
});
