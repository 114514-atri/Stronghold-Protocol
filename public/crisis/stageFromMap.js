// public/crisis/stageFromMap.js — pack a Crisis TD map into a 卫戍 BoardScene stage (19×21 glyph grid).
// BoardScene / layout.js always classify 19×21; we embed the Crisis map at world (c, toWorldRow(r))
// so Camera / Spine keep using the same coords as view.js.

import { TILEKEY_GLYPH } from '../js/render/style.js';
import { ROWS as BOARD_ROWS, COLS as BOARD_COLS } from '../js/render/board3d/layout.js';
import { toWorldRow } from './view.js';

/** Extra tileKeys used by Contingency Contract levels (not in autochess legend). */
const EXTRA_GLYPH = Object.freeze({
  tile_bigforce: 'h',
  tile_grass: 'r',
  tile_hole: '#',
});

/**
 * @param {{ tileKey?: string, heightType?: string }} cell
 * @returns {string} stage glyph
 */
export function cellToGlyph(cell) {
  if (!cell) return '#';
  const key = cell.tileKey || '';
  if (TILEKEY_GLYPH[key]) return TILEKEY_GLYPH[key];
  if (EXTRA_GLYPH[key]) return EXTRA_GLYPH[key];
  if (cell.heightType === 'HIGHLAND') return 'h';
  return 'r';
}

/**
 * Build a `data/stages.json`-shaped stage for BoardScene.setStage.
 * Crisis map-row 0 (top of JSON) sits at the far edge (high world y); blue/end near the camera.
 *
 * @param {{ rows: number, cols: number, cells: any[][] }} map crisis battle snapshot map
 * @param {{ id?: string }} [opts]
 */
export function stageFromCrisisMap(map, opts = {}) {
  const rows = map?.rows | 0;
  const cols = map?.cols | 0;
  const cells = map?.cells || [];
  const lines = [];
  for (let r = 0; r < BOARD_ROWS; r++) lines.push('#'.repeat(BOARD_COLS));

  for (let mr = 0; mr < rows; mr++) {
    const wy = toWorldRow(mr, rows);
    if (wy < 0 || wy >= BOARD_ROWS) continue;
    const rowCells = cells[mr] || [];
    let line = lines[wy].split('');
    for (let c = 0; c < cols && c < BOARD_COLS; c++) {
      line[c] = cellToGlyph(rowCells[c]);
    }
    lines[wy] = line.join('');
  }

  return {
    id: opts.id || 'crisis_td',
    name: opts.id || 'crisis',
    size: [BOARD_ROWS, BOARD_COLS],
    rows: lines,
    tiles: {},
    devices: [],
    config: {},
  };
}

/**
 * Inclusive tile rect covering the embedded Crisis map (for setArea / setFocus).
 * @param {{ rows: number, cols: number }} map
 */
export function crisisBoardArea(map) {
  const rows = map?.rows | 0;
  const cols = map?.cols | 0;
  if (rows <= 0 || cols <= 0) {
    return [{ r0: 0, r1: BOARD_ROWS - 1, c0: 0, c1: BOARD_COLS - 1 }];
  }
  return [{ r0: 0, r1: rows - 1, c0: 0, c1: cols - 1 }];
}
