// public/crisis/board3d.js — Crisis TD board via 卫戍 BoardScene (official MT_autochess materials + lighting).
// No official level_rune* scene pack in local-extract; procedural tiles from the Crisis map glyphs.
// World coords match view.js (x=col, y=toWorldRow(mapRow)).

import { loadThree, loadBoardPack, webgl2Available } from '../js/render/board3d/load.js';
import { BoardScene } from '../js/render/board3d/scene.js';
import { assets } from '../js/assets.js';
import { stageFromCrisisMap, crisisBoardArea } from './stageFromMap.js';

/**
 * @param {HTMLElement} host
 * @param {{ map: { rows: number, cols: number, cells: any[][] }, cam: import('../js/render/projection.js').Camera, width: number, height: number }} opts
 */
export async function createBoard3d(host, opts) {
  if (!webgl2Available(true)) return null;
  await assets.ready();
  try { await assets.local(); } catch { /* */ }

  const THREE = await loadThree();
  if (!THREE) return null;
  const pack = await loadBoardPack(assets);
  if (!pack) return null;

  const { map } = opts;
  let cam = opts.cam;
  let W = opts.width;
  let H = opts.height;

  try {
    if (getComputedStyle(host).position === 'static') host.style.position = 'relative';
  } catch { /* */ }

  const canvas = document.createElement('canvas');
  canvas.setAttribute('aria-hidden', 'true');
  canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;pointer-events:none;z-index:0';
  host.insertBefore(canvas, host.firstChild);

  const board = new BoardScene(THREE, pack, {
    canvas,
    antialias: (globalThis.devicePixelRatio || 1) < 2,
    shadows: true,
  });
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  board.resize(W, H, dpr);

  const area = crisisBoardArea(map);
  board.setArea(area);
  board.setStage(stageFromCrisisMap(map, { id: 'crisis_td' }));
  board.setFocus({
    r0: area[0].r0,
    r1: area[0].r1,
    c0: area[0].c0,
    c1: area[0].c1,
  });

  let t0 = typeof performance !== 'undefined' ? performance.now() / 1000 : 0;

  function render() {
    const t = typeof performance !== 'undefined' ? performance.now() / 1000 : t0;
    if (!t0) t0 = t;
    board.render(cam, t);
  }

  function resize(nw, nh) {
    W = nw;
    H = nh;
    board.resize(nw, nh, Math.min(2, window.devicePixelRatio || 1));
  }

  function setCam(next) { cam = next; }

  function destroy() {
    board.destroy();
    if (canvas.parentNode) canvas.parentNode.removeChild(canvas);
  }

  render();
  return { render, resize, setCam, destroy, canvas, board };
}
