// public/crisis/view.js — shared perspective camera + coord map for Crisis board / Spine.
// World space matches 卫戍 Camera: x=col, y=row with row 0 = BOTTOM (near camera).
// Crisis stage JSON / sim use row 0 = TOP → convert with toWorldRow.

import { Camera, fitCamera } from '../js/render/projection.js';
import { TILE_H } from '../js/render/style.js';

/**
 * @param {{ rows: number, cols: number }} map
 * @param {{ width: number, height: number }} viewport
 */
export function createCrisisCamera(map, viewport) {
  // Frame the whole classic TD map with official-ish 30° pitch (same Camera as 卫戍 BoardScene).
  // Extra padding clears the overlay HUD: top LP/capsule, right COST, bottom hand strip.
  return fitCamera(
    { r0: 0, r1: map.rows - 1, c0: 0, c1: map.cols - 1 },
    {
      width: viewport.width,
      height: viewport.height,
      padding: { top: 88, bottom: 148, left: 28, right: 72 },
    },
    { tilt: 30, dist: 16, margin: 0.7, headroom: 1.55, maxTilePx: 96 },
  );
}

/** Crisis map-row (0=top) → world row (0=bottom). */
export function toWorldRow(mapRow, rows) {
  return (rows - 1) - mapRow;
}

/** World row → crisis map-row. */
export function toMapRow(worldRow, rows) {
  return (rows - 1) - worldRow;
}

/**
 * Continuous sim position → Camera / BoardScene world.
 * Sim & official routes put tile centres at (col+0.5, row+0.5); the board mesh and
 * Camera treat integer (col, worldRow) as the centre (see board3d/layout.js ±0.5).
 * @param {number} x sim col (centre of a tile is *.5)
 * @param {number} yMap sim map-row top-origin (centre *.5)
 * @param {number} rows
 */
export function simToWorld(x, yMap, rows) {
  return { x: x - 0.5, y: toWorldRow(yMap - 0.5, rows) };
}

/**
 * Tile top height — must match BoardScene / TILE_H so Spine feet sit on the mesh.
 * @param {{ heightType?: string, tileKey?: string }} cell
 */
export function tileHeight(cell) {
  if (!cell) return 0;
  if (cell.tileKey === 'tile_forbidden') return TILE_H.forbid;
  if (cell.tileKey === 'tile_wall' || cell.tileKey === 'tile_bigforce') return TILE_H.wall;
  if (cell.heightType === 'HIGHLAND') return TILE_H.wall;
  return 0;
}

export { Camera };
