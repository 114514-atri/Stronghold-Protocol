// 1× / 2× combat playback (g.speed): 1× is the match's base speed, 2× is twice that.
// Solo applies at once. Co-op 1→2 waits for every human still in; any human returns 2× to 1× immediately.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PHASE, ERR } from '../../shared/constants.js';
import { validateC2S } from '../../shared/protocol.js';
import { RESULT_GRACE_MS } from '../../server/match/fields.js';
import { makeMatch } from './harness.js';

const pub = (h) => { h.m.flush(true); return h.lastBc('m.public'); };

test('protocol: g.speed { mul: 1|2 }', () => {
  assert.equal(validateC2S({ t: 'g.speed', mul: 1 }), null);
  assert.equal(validateC2S({ t: 'g.speed', mul: 2 }), null);
  assert.notEqual(validateC2S({ t: 'g.speed' }), null);
  assert.notEqual(validateC2S({ t: 'g.speed', mul: 3 }), null);
  assert.notEqual(validateC2S({ t: 'g.speed', mul: 1.5 }), null);
});

test('solo: one click goes 1× → 2× and back; the public speed is the absolute rate', () => {
  const h = makeMatch({ mode: 'solo', difficulty: 'FUNNY', humans: 1, seed: 8801, fake: true }).start();
  const m = h.m;
  assert.equal(m.speedMul, 1);
  assert.equal(m.gameSpeed, m.baseGameSpeed);
  assert.equal(pub(h).speedMul, 1);
  assert.equal(pub(h).speedVote, null);
  assert.deepEqual(m.handle('p_0', { t: 'g.speed', mul: 2 }), { ok: true });
  assert.equal(m.speedMul, 2);
  assert.equal(m.gameSpeed, m.baseGameSpeed * 2);
  assert.equal(pub(h).speedMul, 2);
  assert.equal(pub(h).speed, m.baseGameSpeed * 2);
  assert.deepEqual(m.handle('p_0', { t: 'g.speed', mul: 1 }), { ok: true });
  assert.equal(m.speedMul, 1);
  assert.equal(m.gameSpeed, m.baseGameSpeed);
  m.dispose();
});

test('co-op: 2× waits for every human; one click at 2× returns to 1×; a bot does not vote; leaving finishes a unanimous request', () => {
  const h = makeMatch({ mode: 'coop', difficulty: 'NORMAL', humans: 2, bots: 1, seed: 8802, fake: true }).start();
  const m = h.m;
  assert.deepEqual(m.handle('p_0', { t: 'g.speed', mul: 2 }), { ok: true });
  assert.equal(m.speedMul, 1, 'one human is not enough');
  assert.deepEqual(pub(h).speedVote.agreed, ['p_0']);
  assert.deepEqual(m.handle('p_0', { t: 'g.speed', mul: 2 }), { ok: true }, 'agreeing again changes nothing');
  assert.equal(m.speedMul, 1);
  assert.deepEqual(m.handle('p_1', { t: 'g.speed', mul: 2 }), { ok: true });
  assert.equal(m.speedMul, 2);
  assert.equal(pub(h).speedVote, null);
  assert.equal(m.gameSpeed, m.baseGameSpeed * 2);
  assert.deepEqual(m.handle('p_1', { t: 'g.speed', mul: 1 }), { ok: true });
  assert.equal(m.speedMul, 1, 'any human returns to 1× without a vote');
  assert.equal(m.gameSpeed, m.baseGameSpeed);
  assert.equal(pub(h).speedVote, null);

  assert.deepEqual(m.handle('p_0', { t: 'g.speed', mul: 2 }), { ok: true });
  m.onLeave('p_1');
  assert.equal(m.speedMul, 2, 'the human who left no longer has to agree');
  m.dispose();
});

test('a spectator cannot change the speed', () => {
  const h = makeMatch({ mode: 'coop', difficulty: 'NORMAL', humans: 1, bots: 1, spectators: ['s_0'], seed: 8803, fake: true }).start();
  assert.equal(h.m.handle('s_0', { t: 'g.speed', mul: 2 }).error, ERR.SPECTATOR);
  assert.equal(h.m.speedMul, 1);
  h.m.dispose();
});

test('switching speed during a battle keeps the game time already played and the time still left', () => {
  const h = makeMatch({ mode: 'solo', difficulty: 'FUNNY', humans: 1, seed: 8804, fake: true, clientCombat: true, clients: false, instant: false }).start();
  const m = h.m;
  assert.ok(h.drive(() => m.phase === PHASE.COMBAT));
  const f = m.fields[0];
  h.sched.advance(4000);
  const elapsed = m._fieldElapsed(f);
  const left = m.deadline - h.sched.now();
  const due = f.startAt + Math.round((f.spec.timeLimit / m.gameSpeed) * 1000) + RESULT_GRACE_MS;
  assert.deepEqual(m.handle('p_0', { t: 'g.speed', mul: 2 }), { ok: true });
  assert.ok(Math.abs(m._fieldElapsed(f) - elapsed) < 0.05, `elapsed stays (${m._fieldElapsed(f)} vs ${elapsed})`);
  const left2 = m.deadline - h.sched.now();
  assert.ok(Math.abs(left2 - left / 2) <= 2, `HUD time left halves (${left2} vs ${left / 2})`);
  const due2 = f.startAt + Math.round((f.spec.timeLimit / m.gameSpeed) * 1000) + RESULT_GRACE_MS;
  assert.ok(due2 < due, 'twice the speed, the takeover comes sooner');
  m.dispose();
});
