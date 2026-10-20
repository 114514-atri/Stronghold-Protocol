// shared/crisis/sim/map.js — parse official level mapData for Crisis TD.
// Official route/checkpoint row uses bottom-left origin; mapData.map[0] is the top row.

const WALK = new Set([
  'tile_road', 'tile_floor', 'tile_start', 'tile_end', 'tile_infection', 'tile_bigforce',
]);

/**
 * @param {any} stage official level JSON
 */
export function parseMap(stage) {
  const md = stage.mapData;
  const map = md.map;
  const tiles = md.tiles;
  const rows = map.length;
  const cols = map[0].length;
  /** @type {any[][]} */
  const grid = [];
  /** @type {{ r: number, c: number } | null} */
  let blue = null;
  /** @type {{ r: number, c: number }[]} */
  const reds = [];
  for (let r = 0; r < rows; r++) {
    grid[r] = [];
    for (let c = 0; c < cols; c++) {
      const tile = tiles[map[r][c]];
      const cell = {
        tileKey: tile.tileKey,
        heightType: tile.heightType,
        buildableType: tile.buildableType, // NONE | MELEE | RANGED
        walkable: WALK.has(tile.tileKey),
        isEnd: tile.tileKey === 'tile_end',
        isStart: tile.tileKey === 'tile_start',
        isInfection: tile.tileKey === 'tile_infection',
        isForbidden: tile.tileKey === 'tile_forbidden' || tile.tileKey === 'tile_wall',
      };
      grid[r][c] = cell;
      if (cell.isEnd) blue = { r, c };
      if (cell.isStart) reds.push({ r, c });
    }
  }
  return {
    rows,
    cols,
    grid,
    blue,
    reds,
    options: stage.options || {},
    routes: stage.routes || [],
    waves: stage.waves || [],
  };
}

/**
 * Convert a bottom-left origin {row,col} (official routes) to map-array {r,c} (row 0 = top).
 * @param {{ row: number, col: number }} pos
 * @param {number} rows
 */
export function fromBottomLeft(pos, rows) {
  return { r: (rows - 1) - (pos.row | 0), c: pos.col | 0 };
}

/**
 * Nearest walkable cell (BFS). Returns `p` if already walkable.
 * @param {ReturnType<typeof parseMap>} map
 * @param {{ r: number, c: number }} p
 */
export function snapWalkable(map, p) {
  if (inBounds(map, p) && map.grid[p.r][p.c].walkable) return p;
  const key = (r, c) => r * map.cols + c;
  const q = [p];
  const seen = new Set([key(p.r, p.c)]);
  const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  while (q.length) {
    const cur = q.shift();
    for (const [dr, dc] of dirs) {
      const nr = cur.r + dr;
      const nc = cur.c + dc;
      if (!inBounds(map, { r: nr, c: nc })) continue;
      const k = key(nr, nc);
      if (seen.has(k)) continue;
      seen.add(k);
      if (map.grid[nr][nc].walkable) return { r: nr, c: nc };
      q.push({ r: nr, c: nc });
    }
  }
  return p;
}

/**
 * BFS 4-neighbour path on walkable tiles. Returns list of {r,c} inclusive, or null.
 * @param {ReturnType<typeof parseMap>} map
 * @param {{ r: number, c: number }} from
 * @param {{ r: number, c: number }} to
 */
export function findPath(map, from, to) {
  const a = snapWalkable(map, from);
  const b = snapWalkable(map, to);
  if (!inBounds(map, a) || !inBounds(map, b)) return null;
  if (!map.grid[a.r][a.c].walkable || !map.grid[b.r][b.c].walkable) return null;
  if (a.r === b.r && a.c === b.c) return [a];
  const key = (r, c) => r * map.cols + c;
  const prev = new Map();
  const q = [a];
  prev.set(key(a.r, a.c), null);
  const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  while (q.length) {
    const cur = q.shift();
    for (const [dr, dc] of dirs) {
      const nr = cur.r + dr;
      const nc = cur.c + dc;
      if (!inBounds(map, { r: nr, c: nc })) continue;
      if (!map.grid[nr][nc].walkable) continue;
      const k = key(nr, nc);
      if (prev.has(k)) continue;
      prev.set(k, cur);
      if (nr === b.r && nc === b.c) {
        const path = [{ r: nr, c: nc }];
        let p = cur;
        while (p) {
          path.push(p);
          p = prev.get(key(p.r, p.c));
        }
        path.reverse();
        return path;
      }
      q.push({ r: nr, c: nc });
    }
  }
  return null;
}

/**
 * Expand an official route into a sequence of waypoints + waits.
 * @param {ReturnType<typeof parseMap>} map
 * @param {number} routeIndex
 * @returns {{ cells: { r: number, c: number }[], waits: { afterIndex: number, seconds: number }[] } | null}
 */
export function expandRoute(map, routeIndex) {
  const route = map.routes[routeIndex];
  if (!route || !route.startPosition) return null;
  const bl = (pos) => snapWalkable(map, fromBottomLeft(pos, map.rows));

  /** @type {{ r: number, c: number }[]} */
  const goals = [bl(route.startPosition)];
  /** @type {{ afterIndex: number, seconds: number }[]} */
  const waits = [];
  const cps = Array.isArray(route.checkpoints) ? route.checkpoints : [];
  for (const cp of cps) {
    if (cp.type === 'MOVE' && cp.position) {
      goals.push(bl(cp.position));
    } else if (cp.type === 'WAIT_FOR_SECONDS' || cp.type === 'WAIT_CURRENT_FRAGMENT_TIME') {
      waits.push({ afterIndex: goals.length - 1, seconds: Number(cp.time) || 0 });
    }
  }
  if (route.endPosition) {
    const e = bl(route.endPosition);
    const last = goals[goals.length - 1];
    if (!last || last.r !== e.r || last.c !== e.c) goals.push(e);
  }

  /** @type {{ r: number, c: number }[]} */
  const cells = [];
  for (let i = 0; i < goals.length; i++) {
    const g = goals[i];
    if (!cells.length) {
      cells.push(g);
      continue;
    }
    const prev = cells[cells.length - 1];
    const seg = findPath(map, prev, g);
    if (!seg || seg.length < 1) {
      cells.push(g);
      continue;
    }
    for (let j = 1; j < seg.length; j++) cells.push(seg[j]);
  }

  const goalCellIndex = [];
  let gi = 0;
  for (let i = 0; i < cells.length; i++) {
    const g = goals[gi];
    if (g && cells[i].r === g.r && cells[i].c === g.c) {
      goalCellIndex[gi] = i;
      gi += 1;
      if (gi >= goals.length) break;
    }
  }
  const waitAt = waits.map((w) => ({
    afterIndex: goalCellIndex[w.afterIndex] ?? w.afterIndex,
    seconds: w.seconds,
  }));
  return { cells, waits: waitAt };
}

function inBounds(map, p) {
  return p.r >= 0 && p.c >= 0 && p.r < map.rows && p.c < map.cols;
}
