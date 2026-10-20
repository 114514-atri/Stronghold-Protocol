#!/usr/bin/env node
// tools/crisis-enemy-spines.mjs — download Crisis β enemy Spines from Ark-Models and write proper
// data/assets.json spine entries (resolveRoles: move is {begin,loop,end}, not a bare string).
//
//   node tools/crisis-enemy-spines.mjs

import fs from 'node:fs';
import path from 'node:path';
import https from 'node:https';
import { fileURLToPath } from 'node:url';
import { parseSkel } from './assets/skel.mjs';
import { resolveRoles } from './assets/anim-roles.mjs';
import { atlasInfo, normalizeAtlas } from './assets/atlas.mjs';
import { pngSize } from './assets/formats.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'public', 'assets', 'spine', 'enemy');
const ASSETS = path.join(ROOT, 'data', 'assets.json');
const MODELS = path.join(ROOT, '.cache', 'ark-models', 'models_data.json');

const IDS = [
  'enemy_1015_litamr',
  'enemy_1035_haxe',
  'enemy_1023_jmage_2',
  'enemy_1025_reveng_2',
  'enemy_1023_jmage',
  'enemy_1025_reveng',
  'enemy_1006_shield',
];

const MIRRORS = [
  (folder, file) => `https://cdn.jsdelivr.net/gh/isHarryh/Ark-Models@main/models_enemies/${folder}/${file}`,
  (folder, file) => `https://raw.githubusercontent.com/isHarryh/Ark-Models/main/models_enemies/${folder}/${file}`,
];

function get(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'stronghold-crisis-spines' } }, (res) => {
      if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        get(res.headers.location).then(resolve, reject);
        return;
      }
      if (res.statusCode !== 200) {
        reject(new Error(`HTTP ${res.statusCode} ${url}`));
        res.resume();
        return;
      }
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks)));
    }).on('error', reject);
  });
}

function folderOf(assetId) {
  return assetId.replace(/^enemy_/, '');
}

async function downloadOne(assetId, assetList) {
  const folder = folderOf(assetId);
  const destDir = path.join(OUT, assetId);
  fs.mkdirSync(destDir, { recursive: true });
  for (const file of Object.values(assetList || {})) {
    const dest = path.join(destDir, file);
    if (fs.existsSync(dest) && fs.statSync(dest).size > 100) {
      console.log(`  skip ${assetId}/${file}`);
      continue;
    }
    let lastErr = null;
    let ok = false;
    for (const make of MIRRORS) {
      const url = make(folder, file);
      try {
        const body = await get(url);
        if (body.length < 50) {
          lastErr = new Error(`too small ${body.length}`);
          continue;
        }
        fs.writeFileSync(dest, body);
        console.log(`  got ${assetId}/${file} (${body.length} B)`);
        ok = true;
        break;
      } catch (e) {
        lastErr = e;
      }
    }
    if (!ok) throw lastErr || new Error(`failed ${assetId}/${file}`);
  }
  return destDir;
}

/** Build a full Spine entry from files already on disk (same shape as fetch-assets processModels). */
function spineEntryFromDisk(assetId) {
  const dir = path.join(OUT, assetId);
  const stem = assetId;
  const skelPath = path.join(dir, `${stem}.skel`);
  const atlasPath = path.join(dir, `${stem}.atlas`);
  if (!fs.existsSync(skelPath) || !fs.existsSync(atlasPath)) {
    throw new Error(`missing skel/atlas in ${dir}`);
  }
  const atlasText = fs.readFileSync(atlasPath, 'utf8');
  const sizes = new Map();
  for (const page of atlasInfo(atlasText).pages) {
    const pngPath = path.join(dir, page);
    if (!fs.existsSync(pngPath)) throw new Error(`missing page ${page}`);
    const sz = pngSize(fs.readFileSync(pngPath));
    if (!sz) throw new Error(`invalid page ${page}`);
    sizes.set(page, sz);
  }
  const norm = normalizeAtlas(atlasText, { pageSize: (p) => sizes.get(p) || null, pma: true });
  if (norm.missingSize.length) throw new Error(`cannot size pages ${norm.missingSize.join(',')}`);
  // Write normalized atlas so pixi-spine gets size:/pma: like other enemies.
  if (norm.text !== atlasText) fs.writeFileSync(atlasPath, norm.text);
  const info = atlasInfo(norm.text);
  const sk = parseSkel(fs.readFileSync(skelPath), info.regions);
  if (!sk.animations.length) throw new Error('skeleton has no animations');
  const roles = resolveRoles(sk.animations, {
    skillIndices: [0],
    numberedSkills: true,
    durations: sk.durations,
  });
  const base = `/assets/spine/enemy/${assetId}`;
  return {
    skel: `${base}/${stem}.skel`,
    atlas: `${base}/${stem}.atlas`,
    textures: info.pages.map((p) => `${base}/${p}`),
    pma: true,
    anims: roles,
    animations: sk.durations,
    events: sk.events,
    hits: sk.hits,
    bounds: sk.bounds,
  };
}

async function main() {
  if (!fs.existsSync(MODELS)) {
    console.error(`missing ${MODELS} — download models_data.json first`);
    process.exit(1);
  }
  const models = JSON.parse(fs.readFileSync(MODELS, 'utf8'));
  const assets = JSON.parse(fs.readFileSync(ASSETS, 'utf8'));
  if (!assets.enemies) assets.enemies = {};

  for (const id of IDS) {
    const key = folderOf(id);
    const meta = models.data?.[key];
    console.log(id);
    if (meta?.assetList) {
      try {
        await downloadOne(id, meta.assetList);
      } catch (e) {
        console.warn(`  download FAIL ${e.message}`);
      }
    } else {
      console.warn(`  no Ark-Models entry (key ${key}) — using disk if present`);
    }
    try {
      const entry = spineEntryFromDisk(id);
      if (!assets.enemies[id]) assets.enemies[id] = {};
      if (!assets.enemies[id].icon) {
        assets.enemies[id].icon = `/assets/enemy/icon/${id}.png`;
      }
      assets.enemies[id].spine = entry;
      delete assets.enemies[id].spineAliasOf;
      console.log(`  roles move=${JSON.stringify(entry.anims.move)} idle=${entry.anims.idle}`);
    } catch (e) {
      console.warn(`  meta FAIL ${e.message}`);
    }
  }

  fs.writeFileSync(ASSETS, JSON.stringify(assets));
  console.log('patched data/assets.json enemy spines');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
