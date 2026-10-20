#!/usr/bin/env node
// tools/crisis-roster.mjs — build public/crisis/data/roster.json from official character_table.
// Requires .cache/gamedata/excel/character_table.json (setup / plugin table download).

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(ROOT, '.cache', 'gamedata', 'excel', 'character_table.json');
const OUT = path.join(ROOT, 'public', 'crisis', 'data', 'roster.json');

const PROF_LABEL = {
  PIONEER: '先锋',
  WARRIOR: '近卫',
  TANK: '重装',
  SNIPER: '狙击',
  CASTER: '术师',
  MEDIC: '医疗',
  SUPPORT: '辅助',
  SPECIAL: '特种',
};

function tierOf(rarity) {
  if (typeof rarity === 'number') return rarity + 1; // some dumps use 0..5
  const m = String(rarity || '').match(/TIER_(\d+)/i);
  return m ? Number(m[1]) : 0;
}

function main() {
  if (!fs.existsSync(SRC)) {
    console.error(`missing ${SRC}\nRun setup or download character_table first.`);
    process.exit(1);
  }
  const table = JSON.parse(fs.readFileSync(SRC, 'utf8'));
  /** @type {any[]} */
  const ops = [];
  for (const [id, row] of Object.entries(table)) {
    if (!id.startsWith('char_') || !row || typeof row !== 'object') continue;
    if (row.isNotObtainable) continue;
    const profession = row.profession;
    if (!PROF_LABEL[profession]) continue;
    const phases = Array.isArray(row.phases)
      ? row.phases.map((p) => ({ maxLevel: p && p.maxLevel }))
      : [];
    const skills = Array.isArray(row.skills)
      ? row.skills.map((s, i) => ({
        index: i,
        skillId: s && (s.skillId || s.skill_id) || null,
      }))
      : [];
    ops.push({
      id,
      name: row.name || id,
      appellation: row.appellation || '',
      rarity: tierOf(row.rarity),
      profession,
      professionName: PROF_LABEL[profession],
      phases,
      skills,
      maxPotentialLevel: Number.isFinite(row.maxPotentialLevel) ? row.maxPotentialLevel : 5,
    });
  }
  ops.sort((a, b) => (b.rarity - a.rarity) || a.name.localeCompare(b.name, 'zh'));
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  const body = {
    generatedAt: new Date().toISOString(),
    source: 'character_table.json',
    rule: 'full warehouse — every obtainable operator; no release-date lock',
    count: ops.length,
    operators: ops,
  };
  fs.writeFileSync(OUT, `${JSON.stringify(body)}\n`);
  console.log(`wrote ${OUT} (${ops.length} operators)`);
}

main();
