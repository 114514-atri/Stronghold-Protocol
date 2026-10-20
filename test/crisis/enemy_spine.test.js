import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { resolveEnemySpine, CRISIS_ENEMY_SPINE_ALIAS, ENEMY_SPINE_ALIAS } from '../../public/js/render/present/enemyAlias.js';
import { CRISIS_ENEMY_SPINE_ALIAS as crisisReexport } from '../../public/crisis/enemySpine.js';

describe('crisis enemy spine resolve', () => {
  it('aliases reveng_2 and jmage_2', () => {
    assert.equal(ENEMY_SPINE_ALIAS.enemy_1025_reveng_2, 'enemy_1025_reveng');
    assert.equal(CRISIS_ENEMY_SPINE_ALIAS.enemy_1023_jmage_2, 'enemy_1023_jmage');
    assert.equal(crisisReexport, ENEMY_SPINE_ALIAS);
  });

  it('returns base entry when only base has spine', () => {
    const catalog = {
      enemy_1025_reveng: { skel: '/assets/spine/enemy/enemy_1025_reveng/x.skel' },
    };
    const r = resolveEnemySpine('enemy_1025_reveng_2', (id) => catalog[id] || null);
    assert.ok(r);
    assert.equal(r.resolvedId, 'enemy_1025_reveng');
    assert.equal(r.entry.skel, catalog.enemy_1025_reveng.skel);
  });

  it('returns null when catalog has no entry', () => {
    const r = resolveEnemySpine('enemy_1015_litamr', () => null);
    assert.equal(r, null);
  });

  it('prefers own litamr skel when catalog has it', () => {
    const catalog = {
      enemy_1015_litamr: { skel: '/assets/spine/enemy/enemy_1015_litamr/enemy_1015_litamr.skel' },
    };
    const r = resolveEnemySpine('enemy_1015_litamr', (id) => catalog[id] || null);
    assert.ok(r);
    assert.equal(r.resolvedId, 'enemy_1015_litamr');
  });
});

