// server/match/match/speed.js — Match methods: 1× / 2× combat playback (g.speed).
// 1× is the match's base game speed (the forced 2×, or opts.combatSpeed). 2× is twice that.
// Co-op 1→2 waits until every human still in the match has agreed. 2→1 applies on any one click.
// Installed on Match.prototype by server/match/Match.js.

import { PHASE } from '../../../shared/constants.js';
import { OK } from './common.js';

const BATTLE = new Set([PHASE.COMBAT, PHASE.UNITE, PHASE.FINAL_ASSAULT, PHASE.HIDDEN_CORE]);

export class MatchSpeed {
  /** Humans still seated (bots agree by not voting; a seat that left is out). */
  _speedVoters() {
    return this.order.filter((p) => p && !p.isBot && !p.left).map((p) => p.playerId);
  }

  /**
   * g.speed { mul }: 2 records this human's agreement and applies once every human still in has agreed
   * (a solo seat applies at once). 1 drops the request and, if 2× is on, returns to the base speed immediately.
   */
  setSpeed(ps, mul) {
    const want = mul === 2 ? 2 : 1;
    if (want === 1) {
      this.speedAgreed.clear();
      if (this.speedMul !== 1) this._applySpeedMul(1);
      else this.markPublic();
      return OK;
    }
    if (this.speedMul === 2) return OK;
    this.speedAgreed.add(ps.playerId);
    if (this._speedUnanimous()) this._applySpeedMul(2);
    else this.markPublic();
    return OK;
  }

  /** A seat left: drop its vote; apply 2× when everyone still here already agreed. */
  _refreshSpeedVote() {
    const voters = new Set(this._speedVoters());
    for (const id of [...this.speedAgreed]) if (!voters.has(id)) this.speedAgreed.delete(id);
    if (this.speedMul === 1 && this._speedUnanimous()) this._applySpeedMul(2);
  }

  _speedUnanimous() {
    const voters = this._speedVoters();
    return voters.length > 0 && voters.every((id) => this.speedAgreed.has(id));
  }

  _applySpeedMul(mul) {
    const nextMul = mul === 2 ? 2 : 1;
    const next = this.baseGameSpeed * nextMul;
    if (next !== this.gameSpeed) this._shiftBattleClocks(this.gameSpeed, next);
    this.speedMul = nextMul;
    this.gameSpeed = next;
    this.speedAgreed.clear();
    if (!this.paused) this._rearmBattleTimers();
    this.markPublic();
  }

  /**
   * Keep the game-time already played, and the game-time still left on the HUD / overtime, when the playback
   * rate changes mid-battle. Prep deadlines stay on the wall clock.
   */
  _shiftBattleClocks(oldSpeed, newSpeed) {
    if (!(oldSpeed > 0) || !(newSpeed > 0) || oldSpeed === newSpeed) return;
    if (!BATTLE.has(this.phase)) return;
    const now = this._clockNow();
    const shiftOrigin = (at) => {
      if (!at) return at;
      const elapsed = Math.max(0, (now - at) / 1000) * oldSpeed;
      return now - Math.round((elapsed / newSpeed) * 1000);
    };
    const shiftRemain = (at) => {
      if (!at) return at;
      const remain = Math.max(0, (at - now) / 1000) * oldSpeed;
      return now + Math.round((remain / newSpeed) * 1000);
    };
    if (this.deadline) this.deadline = shiftRemain(this.deadline);
    if (this.overtimeAt) this.overtimeAt = shiftRemain(this.overtimeAt);
    if (this._bossStartAt != null) this._bossStartAt = shiftOrigin(this._bossStartAt);
    for (const f of this.fields) {
      if (!f || !f.cc || f.done) continue;
      f.startAt = shiftOrigin(f.startAt);
    }
  }

  _rearmBattleTimers() {
    if (!BATTLE.has(this.phase) || this.paused) return;
    for (const f of this.fields) {
      if (!f || !f.cc || f.done) continue;
      if (f.mode === 'client' && f.deadlineTimer) this._armDeadline(f);
      if (f.mode === 'server' && f.doneTimer) this._armRelease(f);
    }
  }
}
