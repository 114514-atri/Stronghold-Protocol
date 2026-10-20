// public/crisis/spineLayer.js — Pixi Spine overlay projected with the same Camera as board3d.
// Plays Move / Idle / Attack / Die / skill clips from battle snapshot pulses.

import { ensurePixi } from '../js/render/app/pixi.js';
import { assets } from '../js/assets.js';
import { SpineActor } from '../js/render/spine.js';
import { UNIT } from '../js/render/style.js';
import { createCombatFx } from '../js/render/present/combatFx.js';
import { resolveEnemySpine } from '../js/render/present/enemyAlias.js';
import { crisisAvatarUrl, crisisEnemyIconUrl } from './art.js';
import { simToWorld, tileHeight } from './view.js';
import { hSign, normDir } from '/sim/dir.js';

/** Match 卫戍 UnitView scale; Crisis board already frames denser maps via camera. */
const CRISIS_SCALE = { enemy: 1, op: 1 };

/**
 * @param {HTMLElement} host
 * @param {{
 *   cam: import('../js/render/projection.js').Camera,
 *   map: { rows: number, cols: number, cells: any[][] },
 *   width: number,
 *   height: number,
 * }} opts
 */
export async function createSpineLayer(host, opts) {
  await ensurePixi();
  await assets.ready();
  try { await assets.local(); } catch { /* */ }

  const PIXI = globalThis.PIXI;
  let W = opts.width;
  let H = opts.height;
  const app = new PIXI.Application({
    width: W,
    height: H,
    backgroundAlpha: 0,
    antialias: true,
    resolution: Math.min(2, window.devicePixelRatio || 1),
    autoDensity: true,
  });
  const view = app.view || app.canvas;
  view.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;pointer-events:none;z-index:2';
  host.appendChild(view);

  const world = new PIXI.Container();
  app.stage.addChild(world);

  /** @type {Map<string, any>} */
  const nodes = new Map();
  const scratch = { x: 0, y: 0, s: 0, depth: 0 };
  let cam = opts.cam;
  let map = opts.map;
  let speedMul = 1;
  /** Facing / drag preview standing on a tile (卫戍 holdPiece). */
  let ghost = /** @type {{ opId: string, r: number, c: number, dir: string }|null} */ (null);
  const GHOST_KEY = 'ghost:deploy';

  const combatFx = createCombatFx({
    P: PIXI,
    stage: app.stage,
    cam: () => cam,
    heightAt: (r, c) => tileHeight(map.cells[r]?.[c]),
    toWorld: (x, yMap) => simToWorld(x, yMap, map.rows),
    screenSize: () => ({ width: W, height: H }),
    timeScale: () => speedMul,
  });
  // Ground FX under units; additive / text above.
  app.stage.setChildIndex(combatFx.layers.groundFx, 0);
  app.stage.addChildAt(world, 1);
  // createCombatFx already added other layers after groundFx; ensure world sits between ground and fx.

  function setCam(next) { cam = next; }

  async function ensureNode(key, kind, assetId) {
    let n = nodes.get(key);
    if (n) return n;
    const root = new PIXI.Container();
    world.addChild(root);
    n = {
      kind, id: assetId, actor: null, sprite: null, entry: null, root, loading: true,
      lastSkillOn: false, lastX: null, lastY: null, atkFired: false, died: false, fade: 1,
      skipDeploy: key === GHOST_KEY,
    };
    nodes.set(key, n);

    let entry = null;
    if (kind === 'enemy') {
      const resolved = resolveEnemySpine(assetId, (id) => assets.spineEntry(id));
      entry = resolved?.entry || null;
    } else {
      entry = assets.spineEntry(assetId);
    }

    if (entry) {
      try {
        const data = await assets.spine.acquire(entry);
        if (!nodes.has(key)) {
          assets.spine.release(entry);
          return null;
        }
        const actor = new SpineActor(data, entry);
        actor.clipPerAttack = kind === 'enemy';
        actor.setBase('idle');
        if (kind === 'op' && !n.skipDeploy) {
          try { actor.deploy(); } catch { /* */ }
        }
        n.actor = actor;
        n.entry = entry;
        root.addChild(actor.spine);
        n.loading = false;
        return n;
      } catch (err) {
        console.warn('[crisis spine]', assetId, err);
        try { assets.spine.release(entry); } catch { /* */ }
        n.entry = null;
      }
    }

    const url = kind === 'enemy' ? crisisEnemyIconUrl(assetId) : crisisAvatarUrl(assetId, { e2: true });
    const img = url ? await assets.image(url) : null;
    if (img && nodes.has(key)) {
      const tex = PIXI.Texture.from(img);
      const sp = new PIXI.Sprite(tex);
      sp.anchor.set(0.5, 0.9);
      n.sprite = sp;
      root.addChild(sp);
    }
    n.loading = false;
    return n;
  }

  function placeNode(n, worldX, worldY, z, face = 1) {
    cam.project(worldX, worldY, z, scratch);
    n.root.x = scratch.x;
    n.root.y = scratch.y;
    n.root.zIndex = Math.round(scratch.y);
    n.root.alpha = n.fade;
    const k = n.kind === 'enemy' ? CRISIS_SCALE.enemy : CRISIS_SCALE.op;
    const sc = scratch.s * UNIT.modelScale * k;
    const flip = face < 0 ? -1 : 1;
    if (n.actor) n.actor.spine.scale.set(sc * flip, sc);
    if (n.sprite) {
      const base = Math.max(28, scratch.s * 0.55);
      const s = base / Math.max(n.sprite.texture.width, n.sprite.texture.height, 1);
      n.sprite.scale.set(s * flip, s);
    }
  }

  /**
   * @param {any} n
   * @param {any} ent
   * @param {'op'|'enemy'} kind
   * @param {number} dt
   */
  function driveActor(n, ent, kind, dt) {
    const a = n.actor;
    if (!a) {
      if (ent.dying) n.fade = Math.max(0, n.fade - dt * 1.4);
      return;
    }

    if (ent.dying || ent.alive === false) {
      if (!n.died) {
        try { a.die(); } catch { /* */ }
        n.died = true;
      }
      a.update(dt);
      n.fade = Math.max(0, n.fade - dt * 1.15);
      n.root.alpha = n.fade;
      return;
    }

    if (kind === 'op') {
      const on = !!ent.skillOn;
      if (on !== n.lastSkillOn) {
        try { a.setSkill(on); } catch { /* */ }
        n.lastSkillOn = on;
      }
    }

    if (ent.atkPulse) {
      if (!n.atkFired) {
        try { a.attack(ent.atkInterval || 1, kind === 'enemy'); } catch { /* */ }
        n.atkFired = true;
      }
    } else {
      n.atkFired = false;
      // Do not call setBase while Start (deploy) / skill clips play — that was cutting the land-in anim.
      if (a.mode === 'base') {
        if (kind === 'enemy') {
          const moving = ent.moving != null ? !!ent.moving : !ent.blocked;
          a.setBase(moving ? 'move' : 'idle');
        } else {
          a.setBase('idle');
        }
      }
    }
    a.update(dt);
  }

  /**
   * @param {{ units: any[], enemies: any[] }} snap
   * @param {number} dt
   */
  function sync(snap, dt) {
    const live = new Set();
    const rows = map.rows;
    const step = Math.max(0, Math.min(0.1, dt || 0));

    for (const u of snap.units || []) {
      const key = `op:${u.id}`;
      live.add(key);
      const cell = map.cells[u.r]?.[u.c];
      const z = tileHeight(cell) + 0.02;
      // unitPos is (c+0.5,r+0.5); simToWorld maps that onto board integer centres.
      const w = simToWorld(u.c + 0.5, u.r + 0.5, rows);
      const n = nodes.get(key);
      if (!n) {
        void ensureNode(key, 'op', u.opId).then((node) => {
          if (node) {
            placeNode(node, w.x, w.y, z, u.face || 1);
            driveActor(node, u, 'op', 0);
          }
        });
      } else if (!n.loading) {
        placeNode(n, w.x, w.y, z, u.face || 1);
        driveActor(n, u, 'op', step);
      }
    }

    // Deploy / facing ghost (holdPiece) — idle on the tile, flips with preview dir.
    if (ghost) {
      live.add(GHOST_KEY);
      const cell = map.cells[ghost.r]?.[ghost.c];
      const z = tileHeight(cell) + 0.08;
      const w = simToWorld(ghost.c + 0.5, ghost.r + 0.5, rows);
      const face = hSign(ghost.dir);
      let n = nodes.get(GHOST_KEY);
      if (!n || n.id !== ghost.opId) {
        if (n) {
          world.removeChild(n.root);
          if (n.entry) { try { assets.spine.release(n.entry); } catch { /* */ } }
          n.root.destroy({ children: true });
          nodes.delete(GHOST_KEY);
        }
        void ensureNode(GHOST_KEY, 'op', ghost.opId).then((node) => {
          if (!node || !ghost) return;
          if (node.actor) {
            try { node.actor.setBase('idle'); } catch { /* */ }
          }
          placeNode(node, w.x, w.y, z, face);
          node.root.alpha = 0.92;
        });
      } else if (!n.loading) {
        placeNode(n, w.x, w.y, z, face);
        n.root.alpha = 0.92;
        if (n.actor && n.actor.mode === 'base') {
          try { n.actor.setBase('idle'); } catch { /* */ }
        }
        if (n.actor) n.actor.update(step);
      }
    }

    for (const e of snap.enemies || []) {
      const key = `en:${e.id}`;
      live.add(key);
      const mr = Math.floor(e.y);
      const mc = Math.floor(e.x);
      const cell = map.cells[mr]?.[mc];
      const z = tileHeight(cell) + 0.02;
      const w = simToWorld(e.x, e.y, rows);
      let face = e.face || 1;
      const n = nodes.get(key);
      if (n && n.lastX != null && Math.abs(e.x - n.lastX) > 1e-4) {
        face = e.x >= n.lastX ? 1 : -1;
      }
      if (n) { n.lastX = e.x; n.lastY = e.y; }
      if (!n) {
        void ensureNode(key, 'enemy', e.key).then((node) => {
          if (node) {
            node.lastX = e.x;
            node.lastY = e.y;
            placeNode(node, w.x, w.y, z, face);
            driveActor(node, { ...e, face }, 'enemy', 0);
          }
        });
      } else if (!n.loading) {
        placeNode(n, w.x, w.y, z, face);
        driveActor(n, { ...e, face }, 'enemy', step);
      }
    }

    for (const [key, n] of nodes) {
      if (live.has(key)) continue;
      world.removeChild(n.root);
      if (n.entry) {
        try { assets.spine.release(n.entry); } catch { /* */ }
      }
      n.root.destroy({ children: true });
      nodes.delete(key);
    }

    world.sortableChildren = true;
    world.sortChildren();
    combatFx.syncProxies({
      ...snap,
      enemies: (snap.enemies || []).map((e) => {
        // Prefer interpolated poses when caller already remapped x/y.
        return e;
      }),
      map,
    });
  }

  /** @param {any[]} events */
  function pushEvents(events) {
    combatFx.push(events);
  }

  function setSpeed(mul) {
    speedMul = Math.max(0.25, Number(mul) || 1);
  }

  function resize(nw, nh, nextCam, nextMap) {
    W = nw; H = nh;
    if (nextCam) cam = nextCam;
    if (nextMap) map = nextMap;
    app.renderer.resize(nw, nh);
    combatFx.resize();
  }

  function destroy() {
    combatFx.destroy();
    for (const [, n] of nodes) {
      if (n.entry) {
        try { assets.spine.release(n.entry); } catch { /* */ }
      }
    }
    nodes.clear();
    app.destroy(true, { children: true, texture: false, baseTexture: false });
    if (view.parentNode) view.parentNode.removeChild(view);
  }

  // Re-order: groundFx → world → fxNormal → fxAdd → text → screen
  try {
    const st = app.stage;
    st.removeChild(world);
    st.removeChild(combatFx.layers.groundFx);
    st.removeChild(combatFx.layers.fxNormal);
    st.removeChild(combatFx.layers.fxAdd);
    st.removeChild(combatFx.layers.text);
    st.removeChild(combatFx.layers.screen);
    st.addChild(combatFx.layers.groundFx);
    st.addChild(world);
    st.addChild(combatFx.layers.fxNormal);
    st.addChild(combatFx.layers.fxAdd);
    st.addChild(combatFx.layers.text);
    st.addChild(combatFx.layers.screen);
  } catch { /* */ }

  /**
   * Pin a preview operator on a tile while dragging / choosing facing (卫戍 holdPiece).
   * @param {string|null} opId
   * @param {number} [r]
   * @param {number} [c]
   * @param {string} [dir]
   */
  function setDeployGhost(opId, r, c, dir) {
    if (!opId || !Number.isInteger(r) || !Number.isInteger(c)) {
      ghost = null;
      return;
    }
    ghost = { opId, r, c, dir: normDir(dir || 'RIGHT') };
  }

  function setGhostDir(dir) {
    if (ghost) ghost.dir = normDir(dir || ghost.dir);
  }

  function clearDeployGhost() {
    ghost = null;
  }

  /** Hit flash from CombatFx proxies → Spine/sprite tint (official battle feedback). */
  function applyHitFlash() {
    for (const [key, n] of nodes) {
      const p = combatFx.proxies.get(key);
      const flash = p?.flash || 0;
      const tint = flash > 0.04 ? 0xffb0b0 : 0xffffff;
      if (n.actor?.spine) n.actor.spine.tint = tint;
      if (n.sprite) n.sprite.tint = tint;
    }
  }

  return {
    sync,
    pushEvents,
    setSpeed,
    setCam,
    setDeployGhost,
    setGhostDir,
    clearDeployGhost,
    resize,
    destroy,
    view,
    updateFx: (dt) => {
      combatFx.update(dt);
      applyHitFlash();
    },
  };
}
