import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { cellToGlyph, stageFromCrisisMap, crisisBoardArea } from '../../public/crisis/stageFromMap.js';
import { toWorldRow } from '../../public/crisis/view.js';

describe('crisis stageFromMap', () => {
  it('maps CC tileKeys to board glyphs', () => {
    assert.equal(cellToGlyph({ tileKey: 'tile_road' }), 'r');
    assert.equal(cellToGlyph({ tileKey: 'tile_floor' }), 'f');
    assert.equal(cellToGlyph({ tileKey: 'tile_wall' }), 'h');
    assert.equal(cellToGlyph({ tileKey: 'tile_start' }), 'S');
    assert.equal(cellToGlyph({ tileKey: 'tile_end' }), 'E');
    assert.equal(cellToGlyph({ tileKey: 'tile_infection' }), 'i');
    assert.equal(cellToGlyph({ tileKey: 'tile_bigforce' }), 'h');
    assert.equal(cellToGlyph({ tileKey: 'tile_forbidden' }), '#');
  });

  it('embeds flipped crisis map into 19×21 stage rows', () => {
    const map = {
      rows: 3,
      cols: 4,
      cells: [
        [{ tileKey: 'tile_forbidden' }, { tileKey: 'tile_forbidden' }, { tileKey: 'tile_forbidden' }, { tileKey: 'tile_forbidden' }],
        [{ tileKey: 'tile_start' }, { tileKey: 'tile_road' }, { tileKey: 'tile_wall' }, { tileKey: 'tile_end' }],
        [{ tileKey: 'tile_forbidden' }, { tileKey: 'tile_forbidden' }, { tileKey: 'tile_forbidden' }, { tileKey: 'tile_forbidden' }],
      ],
    };
    const st = stageFromCrisisMap(map, { id: 't' });
    assert.equal(st.rows.length, 19);
    assert.equal(st.rows[0].length, 21);
    // map row 1 → world row toWorldRow(1,3)=1
    assert.equal(toWorldRow(1, 3), 1);
    assert.equal(st.rows[1].slice(0, 4), 'SrhE');
    assert.equal(st.rows[0].slice(0, 4), '####');
    const area = crisisBoardArea(map);
    assert.deepEqual(area, [{ r0: 0, r1: 2, c0: 0, c1: 3 }]);
  });
});
