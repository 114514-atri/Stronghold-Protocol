// Solo practice modifier (`g.debug`): independent simulation only; co-op always refused.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ERR, PHASE, BOND_LAYER_CAP } from '../../shared/constants.js';
import { validateC2S, DEBUG_OPS } from '../../shared/protocol.js';
import { makeMatch } from './harness.js';

test('g.debug protocol accepts the closed op set', () => {
  for (const op of DEBUG_OPS) {
    assert.equal(validateC2S({ t: 'g.debug', op }), null, op);
    assert.equal(validateC2S({ t: 'g.debug', op, n: 50 }), null, `${op}+n`);
  }
  assert.match(validateC2S({ t: 'g.debug', op: 'hack' }) || '', /bad field op/);
  assert.match(validateC2S({ t: 'g.debug', op: 'addFunds', n: 1.5 }) || '', /bad field n/);
});

test('g.debug is refused in co-op', () => {
  const h = makeMatch({ mode: 'coop', difficulty: 'FUNNY', humans: 1, bots: 1, seed: 11, fake: true }).start();
  h.toPrep(1);
  assert.equal(h.m.handle('p_0', { t: 'g.debug', op: 'addFunds', n: 50 }).error, ERR.WRONG_PHASE);
  assert.equal(h.ps('p_0').funds, 4, 'co-op funds unchanged');
  h.m.dispose();
});

test('g.debug addFunds / setFunds / freeRefresh / maxShop / addDeployCap / rerollShop in solo prep', () => {
  const h = makeMatch({ mode: 'solo', difficulty: 'FUNNY', humans: 1, seed: 12, fake: true }).start();
  h.toPrep(1);
  const m = h.m;
  const ps = h.ps('p_0');
  const funds0 = ps.funds;

  assert.deepEqual(m.handle('p_0', { t: 'g.debug', op: 'addFunds', n: 50 }), { ok: true });
  assert.equal(ps.funds, funds0 + 50);

  assert.deepEqual(m.handle('p_0', { t: 'g.debug', op: 'setFunds', n: 99 }), { ok: true });
  assert.equal(ps.funds, 99);

  assert.deepEqual(m.handle('p_0', { t: 'g.debug', op: 'freeRefresh', n: 3 }), { ok: true });
  assert.equal(ps.shop.freeRefreshes, 3);

  const beforeSlots = ps.shop.slots.map((s) => s && s.id);
  assert.deepEqual(m.handle('p_0', { t: 'g.debug', op: 'rerollShop' }), { ok: true });
  // A free reroll may keep some ids by chance; just require the call succeeded and slots exist.
  assert.equal(ps.shop.slots.length, beforeSlots.length);

  assert.deepEqual(m.handle('p_0', { t: 'g.debug', op: 'maxShop' }), { ok: true });
  assert.equal(ps.shop.level, m.gd.maxShopLevel);
  assert.equal(ps.shop.upgradePrice, 0);

  const cap0 = ps.deployCap;
  assert.deepEqual(m.handle('p_0', { t: 'g.debug', op: 'addDeployCap', n: 1 }), { ok: true });
  assert.equal(ps.deployCap, cap0 + 1);

  m.dispose();
});

test('g.debug setLp works outside prep; shop ops need prep and refuse when ready', () => {
  const h = makeMatch({ mode: 'solo', difficulty: 'FUNNY', humans: 1, seed: 13, fake: true }).start();
  h.toPrep(1);
  const m = h.m;
  const ps = h.ps('p_0');
  const start = m.gd.startLp(ps.bandId);
  ps.lp = 1;
  assert.deepEqual(m.handle('p_0', { t: 'g.debug', op: 'setLp' }), { ok: true });
  assert.equal(ps.lp, start);

  assert.deepEqual(m.handle('p_0', { t: 'g.ready', ready: true }), { ok: true });
  assert.equal(m.handle('p_0', { t: 'g.debug', op: 'addFunds', n: 10 }).error, ERR.WRONG_PHASE);

  // Leave prep so shop ops are refused, but setLp still works while alive.
  assert.ok(h.drive(() => m.phase === PHASE.COMBAT && m.round === 1, { ready: true }));
  assert.equal(m.handle('p_0', { t: 'g.debug', op: 'addFunds', n: 10 }).error, ERR.WRONG_PHASE);
  ps.lp = 2;
  assert.deepEqual(m.handle('p_0', { t: 'g.debug', op: 'setLp', n: 7 }), { ok: true });
  assert.equal(ps.lp, 7);

  m.dispose();
});

test('g.debug addLayers / setLayers change bond layers (阵营系数)', () => {
  const h = makeMatch({ mode: 'solo', difficulty: 'FUNNY', humans: 1, seed: 14, fake: true }).start();
  h.toPrep(1);
  const m = h.m;
  const ps = h.ps('p_0');
  // Named bond: no board members needed (layers persist without activation).
  assert.ok(m.gd.bond('yanShip'), '炎');
  assert.ok(m.gd.bond('swiftShip'), '迅捷');

  assert.deepEqual(m.handle('p_0', { t: 'g.debug', op: 'setLayers', n: 30, bondId: 'yanShip' }), { ok: true });
  assert.equal(ps.layers.yanShip, 30);

  assert.deepEqual(m.handle('p_0', { t: 'g.debug', op: 'addLayers', n: 10, bondId: 'yanShip' }), { ok: true });
  assert.equal(ps.layers.yanShip, 40);

  // Without bondId: every bond that already has members or layers.
  assert.deepEqual(m.handle('p_0', { t: 'g.debug', op: 'setLayers', n: 5, bondId: 'swiftShip' }), { ok: true });
  assert.deepEqual(m.handle('p_0', { t: 'g.debug', op: 'addLayers', n: 5 }), { ok: true }, 'all owned/layered bonds');
  assert.equal(ps.layers.yanShip, 45);
  assert.equal(ps.layers.swiftShip, 10);

  assert.deepEqual(m.handle('p_0', { t: 'g.debug', op: 'setLayers', n: BOND_LAYER_CAP, bondId: 'yanShip' }), { ok: true });
  assert.equal(ps.layers.yanShip, BOND_LAYER_CAP);
  assert.deepEqual(m.handle('p_0', { t: 'g.debug', op: 'addLayers', n: 10, bondId: 'yanShip' }), { ok: true });
  assert.equal(ps.layers.yanShip, BOND_LAYER_CAP, 'cap holds');

  assert.equal(m.handle('p_0', { t: 'g.debug', op: 'setLayers', n: 10 }).error, ERR.BAD_TARGET);
  assert.equal(m.handle('p_0', { t: 'g.debug', op: 'setLayers', n: 10, bondId: 'no_such_bond' }).error, ERR.BAD_TARGET);

  m.dispose();
});

test('g.debug noEquipLimit raises equipCap; grantChess and unlockMaxOps fill the hand', () => {
  const h = makeMatch({ mode: 'solo', difficulty: 'FUNNY', humans: 1, seed: 15, fake: true }).start();
  h.toPrep(1);
  const m = h.m;
  const ps = h.ps('p_0');

  assert.equal(ps.equipCap, m.gd.equipPerChess);
  assert.deepEqual(m.handle('p_0', { t: 'g.debug', op: 'noEquipLimit' }), { ok: true });
  assert.equal(ps.equipCap, 16);
  assert.equal(ps.privateView().equipCap, 16);

  const bases = m.gd.visibleChess || [];
  assert.ok(bases.length >= 1, 'roster');
  const base = bases[0];
  const before = ps.hand.filter((p) => p && p.kind === 'chess').length
    + ps.temp.filter((p) => p && p.kind === 'chess').length;
  assert.deepEqual(m.handle('p_0', { t: 'g.debug', op: 'grantChess', chessId: base }), { ok: true });
  const after = ps.hand.filter((p) => p && p.kind === 'chess').length
    + ps.temp.filter((p) => p && p.kind === 'chess').length;
  assert.equal(after, before + 1);
  assert.equal(m.handle('p_0', { t: 'g.debug', op: 'grantChess', chessId: 'not_a_chess' }).error, ERR.BAD_TARGET);
  assert.equal(m.handle('p_0', { t: 'g.debug', op: 'grantChess' }).error, ERR.BAD_TARGET);

  let maxTier = 1;
  for (const id of bases) {
    const t = m.gd.tierOf(id);
    if (Number.isInteger(t) && t > maxTier) maxTier = t;
  }
  const expected = bases.filter((id) => m.gd.tierOf(id) === maxTier && m.gd.goldenIdOf(id)).length;
  const hand0 = countOwned(ps);
  assert.deepEqual(m.handle('p_0', { t: 'g.debug', op: 'unlockMaxOps' }), { ok: true });
  assert.ok(countOwned(ps) >= hand0 + Math.min(1, expected), 'at least one max-tier elite when any exist');

  m.dispose();
});

function countOwned(ps) {
  const onBoard = [...ps.board.values()].filter((p) => p && p.kind === 'chess').length;
  return onBoard
    + ps.hand.filter((p) => p && p.kind === 'chess').length
    + ps.temp.filter((p) => p && p.kind === 'chess').length;
}
