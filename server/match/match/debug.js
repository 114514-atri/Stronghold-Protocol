// server/match/match/debug.js — Match methods: the solo-only practice modifier (`g.debug`).
// Co-op always refuses it. Installed on Match.prototype by server/match/Match.js.

import { PHASE, ERR, BOND_LAYER_CAP } from '../../../shared/constants.js';
import { DEBUG_OPS } from '../../../shared/protocol.js';
import { msg, dn } from '../../../shared/i18n.js';
import { OK, fail } from './common.js';

const PREP_PHASES = new Set([PHASE.ROUND_START, PHASE.SP_DRAFT, PHASE.PREP]);

export class MatchDebug {
  /**
   * Solo practice modifier (`g.debug { op, n?, bondId? }`): local independent simulation only.
   * Co-op → `WRONG_PHASE 'solo only'`. Economy / shop / bond-layer ops need a prep-side phase and a living seat that
   * is not ready; `setLp` may run any time the seat is alive. Bond ops: `addLayers` / `setLayers` (盟约层数).
   */
  applyDebug(ps, op, n, bondId, chessId) {
    if (!this.isSolo) return fail(ERR.WRONG_PHASE, 'solo only');
    if (!ps || !ps.alive) return fail(ERR.ELIMINATED);
    if (typeof op !== 'string' || !DEBUG_OPS.has(op)) return fail(ERR.BAD_MSG, 'unknown debug op');

    if (op === 'setLp') return this._debugSetLp(ps, n);

    if (!PREP_PHASES.has(this.phase)) return fail(ERR.WRONG_PHASE, 'prep only');
    if (this.phase === PHASE.PREP && ps.ready) return fail(ERR.WRONG_PHASE, 'ready');

    switch (op) {
      case 'addFunds': return this._debugAddFunds(ps, n);
      case 'setFunds': return this._debugSetFunds(ps, n);
      case 'freeRefresh': return this._debugFreeRefresh(ps, n);
      case 'maxShop': return this._debugMaxShop(ps);
      case 'addDeployCap': return this._debugAddDeployCap(ps, n);
      case 'rerollShop': return this._debugRerollShop(ps);
      case 'addLayers': return this._debugAddLayers(ps, bondId, n);
      case 'setLayers': return this._debugSetLayers(ps, bondId, n);
      case 'noEquipLimit': return this._debugNoEquipLimit(ps);
      case 'unlockMaxOps': return this._debugUnlockMaxOps(ps);
      case 'grantChess': return this._debugGrantChess(ps, chessId);
      default: return fail(ERR.BAD_MSG, 'unknown debug op');
    }
  }

  _debugAddFunds(ps, n) {
    const amount = clampInt(n, 1, 9999, 50);
    ps.addFunds(amount, { reason: 'debug' });
    this.toast(ps, 'info', msg('调试：资金 +{n}', { n: amount }));
    return OK;
  }

  _debugSetFunds(ps, n) {
    const target = clampInt(n, 0, 9999, 99);
    const delta = target - ps.funds;
    if (delta !== 0) ps.addFunds(delta, { reason: 'debug' });
    else ps.dirty();
    this.toast(ps, 'info', msg('调试：资金设为 {n}', { n: target }));
    return OK;
  }

  _debugSetLp(ps, n) {
    const start = Number.isFinite(ps.bandId ? this.gd.startLp(ps.bandId) : NaN) ? this.gd.startLp(ps.bandId) : 30;
    const target = clampInt(n, 1, 999, start);
    if (ps.lp !== target) {
      ps.lp = target;
      ps.dirty();
      this.markPublic();
    }
    this.toast(ps, 'info', msg('调试：目标生命值设为 {n}', { n: target }));
    return OK;
  }

  _debugFreeRefresh(ps, n) {
    const amount = clampInt(n, 1, 99, 3);
    ps.shop.freeRefreshes += amount;
    ps.dirty();
    this.toast(ps, 'info', msg('调试：免费刷新 +{n}', { n: amount }));
    return OK;
  }

  _debugMaxShop(ps) {
    const max = this.gd.maxShopLevel;
    if (ps.shop.level >= max) {
      this.toast(ps, 'info', '调试：调度中心已满级');
      return OK;
    }
    while (ps.shop.level < max) {
      ps.shop.level++;
      ps._openLevelSlots();
      this.dispatch(ps, 'onLevelUp', { level: ps.shop.level, price: 0 });
    }
    ps.shop.upgradePrice = 0;
    this.tickerFor('SHOP_LEVEL', [ps.name, String(ps.shop.level)], { playerId: ps.playerId, param: String(ps.shop.level) });
    ps.dirty();
    this.markPublic();
    this.toast(ps, 'info', msg('调试：调度中心升至 {n} 级', { n: ps.shop.level }));
    return OK;
  }

  _debugAddDeployCap(ps, n) {
    const amount = clampInt(n, 1, 8, 1);
    ps.deployCapBonus += amount;
    ps.dirty();
    this.toast(ps, 'info', msg('调试：部署上限 +{n}（当前 {cap}）', { n: amount, cap: ps.deployCap }));
    return OK;
  }

  _debugRerollShop(ps) {
    ps.shop.frozen = false;
    ps.rollShop({ keepFrozen: false });
    ps.dirty();
    this.toast(ps, 'info', '调试：已免费重摇商店');
    return OK;
  }

  /**
   * Add bond layers. With `bondId`: that bond. Without: every bond the seat currently owns members of
   * (`ps.bonds[id].count > 0`). Default +10.
   */
  _debugAddLayers(ps, bondId, n) {
    const amount = clampInt(n, 1, BOND_LAYER_CAP, 10);
    const ids = this._debugBondTargets(ps, bondId);
    if (!ids) return fail(ERR.BAD_TARGET, bondId ? 'unknown bond' : 'no owned bonds');
    let touched = 0;
    for (const id of ids) {
      if (ps.addLayers(id, amount, { requireActive: false, reason: 'debug' }) > 0) touched++;
    }
    if (ids.length === 1) {
      const name = this.gd.bond(ids[0])?.name || ids[0];
      this.toast(ps, 'info', msg('调试：{bond} 层数 +{n}（现 {layers}）', {
        bond: dn(name), n: amount, layers: ps.layers[ids[0]] || 0,
      }));
    } else {
      this.toast(ps, 'info', msg('调试：{count} 个盟约各 +{n} 层', { count: touched || ids.length, n: amount }));
    }
    this.markPublic();
    return OK;
  }

  /**
   * Set a bond's layers to `n` (0…999). `bondId` required.
   */
  _debugSetLayers(ps, bondId, n) {
    if (typeof bondId !== 'string' || !this.gd.bond(bondId)) return fail(ERR.BAD_TARGET, 'unknown bond');
    const target = clampInt(n, 0, BOND_LAYER_CAP, 30);
    const before = ps.layers[bondId] || 0;
    if (before !== target) {
      ps.layers[bondId] = target;
      ps.recompute();
      this.dispatch(ps, 'onLayers', { bondId, from: before, to: target, reason: 'debug' });
      if (PREP_PHASES.has(this.phase) && target > before) {
        this.sendTo(ps.playerId, { t: 'm.layer', playerId: ps.playerId, bondId, add: target - before });
      }
      ps.dirty();
      this.markPublic();
    }
    const name = this.gd.bond(bondId)?.name || bondId;
    this.toast(ps, 'info', msg('调试：{bond} 层数设为 {n}', { bond: dn(name), n: target }));
    return OK;
  }

  /** One known bond, or every bond with members on this seat. null when nothing applies. */
  _debugBondTargets(ps, bondId) {
    if (typeof bondId === 'string' && bondId) {
      return this.gd.bond(bondId) ? [bondId] : null;
    }
    const owned = [];
    for (const [id, b] of Object.entries(ps.bonds || {})) {
      if (b && (b.count > 0 || (ps.layers[id] || 0) > 0) && this.gd.bond(id)) owned.push(id);
    }
    return owned.length ? owned : null;
  }

  /** Raise this seat's equip slots to 16 for the rest of the match (official is 2). */
  _debugNoEquipLimit(ps) {
    const cap = 16;
    if (ps.debugEquipCap === cap) {
      this.toast(ps, 'info', msg('调试：装备上限已是 {n}', { n: cap }));
      return OK;
    }
    ps.debugEquipCap = cap;
    ps.dirty();
    this.toast(ps, 'info', msg('调试：干员装备上限改为 {n}', { n: cap }));
    return OK;
  }

  /**
   * Grant one elite (精锐) of every max-tier visible shop operator into hand / temp.
   * Uses fromPool:false so the shared pool is untouched.
   */
  _debugUnlockMaxOps(ps) {
    const bases = this.gd.visibleChess || [];
    let maxTier = 1;
    for (const id of bases) {
      const t = this.gd.tierOf(id);
      if (Number.isInteger(t) && t > maxTier) maxTier = t;
    }
    const ids = [];
    for (const base of bases) {
      if (this.gd.tierOf(base) !== maxTier) continue;
      const golden = this.gd.goldenIdOf(base);
      if (golden && this.gd.chess(golden)) ids.push(golden);
    }
    let got = 0;
    for (const id of ids) {
      const p = ps.acquireChess(id, { source: 'debug', fromPool: false });
      if (p) got++;
    }
    ps.dirty();
    this.toast(ps, 'info', msg('调试：已发放 {got}/{total} 名 {tier} 阶精锐', { got, total: ids.length, tier: maxTier }));
    return OK;
  }

  /** Free-buy one roster chess (base or elite) into hand / temp. */
  _debugGrantChess(ps, chessId) {
    if (typeof chessId !== 'string' || !chessId) return fail(ERR.BAD_TARGET, 'chessId required');
    const rec = this.gd.chess(chessId);
    if (!rec || rec.isDiy) return fail(ERR.BAD_TARGET, 'unknown chess');
    // Only the shipped roster: visible shop chess, or their elites (not hidden / DIY bodies).
    const base = this.gd.baseIdOf(chessId);
    const baseRec = this.gd.chess(base);
    if (!baseRec || !baseRec.visible || baseRec.isHidden || baseRec.isDiy) return fail(ERR.BAD_TARGET, 'not in roster');
    const p = ps.acquireChess(chessId, { source: 'debug', fromPool: false });
    if (!p) return fail(ERR.BAD_TARGET, 'could not grant');
    this.toast(ps, 'info', msg('调试：获得 {name}', { name: dn(rec.name || chessId) }));
    return OK;
  }
}

/** Integer in [lo, hi]; missing / non-integer → fallback. */
function clampInt(n, lo, hi, fallback) {
  if (!Number.isInteger(n)) return fallback;
  return Math.min(hi, Math.max(lo, n));
}
