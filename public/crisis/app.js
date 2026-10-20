// public/crisis/app.js — solo Crisis Contract lobby (β first). No multiplayer.

import { SEASONS, firstPlayableSeason } from '../../shared/crisis/seasons.js';
import { defaultLoadout, normalizeLoadout, maxLevelForElite, maxElite } from '../../shared/crisis/loadout.js';
import { resolveContractPick } from '../../shared/crisis/contracts.js';
import { squadSizeCapOf } from '../../shared/crisis/sim/runes.js';
import { mountBattle } from './battle.js';
import { loadCrisisArt, crisisAvatarUrl, crisisUiUrl } from './art.js';

const SQUAD_CAP = 12;
const LS_KEY = 'sp.crisis.v2';

/** @type {{ seasonId: string, contracts: string[], squad: string[], borrowId: string|null, loadouts: Record<string, any>, editId: string|null, pickMode: 'squad'|'borrow' }} */
const state = {
  seasonId: firstPlayableSeason().id,
  contracts: [],
  squad: [],
  borrowId: null,
  loadouts: {},
  editId: null,
  pickMode: 'squad',
};

/** @type {any} */
let seasonData = null;
/** @type {any[]} */
let operators = [];
/** @type {Map<string, any>} */
const opById = new Map();

function $(id) {
  return document.getElementById(id);
}

function mainSquadCap() {
  if (!seasonData) return SQUAD_CAP;
  const cap = squadSizeCapOf(state.contracts, seasonData.contracts);
  return cap == null ? SQUAD_CAP : Math.min(SQUAD_CAP, cap);
}

function trimSquadToCap() {
  const cap = mainSquadCap();
  if (state.squad.length > cap) {
    state.squad = state.squad.slice(0, cap);
    return true;
  }
  return false;
}

function loadPersist() {
  try {
    const raw = localStorage.getItem(LS_KEY) || localStorage.getItem('sp.crisis.v1');
    if (!raw) return;
    const j = JSON.parse(raw);
    if (j && typeof j === 'object') {
      if (typeof j.seasonId === 'string') state.seasonId = j.seasonId;
      if (Array.isArray(j.contracts)) state.contracts = j.contracts;
      if (Array.isArray(j.squad)) state.squad = j.squad.slice(0, SQUAD_CAP);
      if (typeof j.borrowId === 'string' || j.borrowId === null) state.borrowId = j.borrowId;
      if (j.loadouts && typeof j.loadouts === 'object') state.loadouts = j.loadouts;
    }
  } catch { /* ignore */ }
}

function savePersist() {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify({
      seasonId: state.seasonId,
      contracts: state.contracts,
      squad: state.squad,
      borrowId: state.borrowId,
      loadouts: state.loadouts,
    }));
  } catch { /* ignore */ }
}

function loadoutOf(id) {
  const char = opById.get(id);
  if (!char) return null;
  return normalizeLoadout(state.loadouts[id] || defaultLoadout(char), char);
}

function setStatus(msg) {
  const el = $('statusLine');
  if (el) el.textContent = msg || '';
}

function uiBg(key, fallbackKeys = []) {
  return crisisUiUrl(key) || fallbackKeys.map((k) => crisisUiUrl(k)).find(Boolean) || '';
}

function rarityUrl(rarity) {
  const r = Math.max(0, Math.min(5, (rarity | 0) - 1));
  return crisisUiUrl(`charRaritySprite/rarity_${r}`)
    || crisisUiUrl(`rarity/rarity_${r}`)
    || '';
}

function renderSeasons() {
  const box = $('seasonList');
  box.replaceChildren();
  for (const s of SEASONS) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `cc-season${s.id === state.seasonId ? ' is-on' : ''}`;
    btn.textContent = s.playable ? s.name : `${s.name}（未开放）`;
    btn.disabled = !s.playable;
    btn.addEventListener('click', () => {
      state.seasonId = s.id;
      state.contracts = [];
      savePersist();
      void loadSeason();
    });
    box.appendChild(btn);
  }
}

async function loadSeason() {
  const meta = SEASONS.find((s) => s.id === state.seasonId) || firstPlayableSeason();
  setStatus('加载期数数据…');
  const res = await fetch(meta.dataUrl, { cache: 'no-cache' });
  if (!res.ok) throw new Error(`season ${meta.id}: HTTP ${res.status}`);
  seasonData = await res.json();
  $('mapPanel').hidden = false;
  $('contractPanel').hidden = false;
  $('squadPanel').hidden = false;
  $('mapTitle').textContent = `${seasonData.name} · ${seasonData.mapName}`;
  $('mapDesc').textContent = seasonData.desc || '';
  const st = seasonData.stage || {};
  $('mapStats').innerHTML = [
    ['部署上限', st.deployLimit],
    ['初始费用', st.costInitial],
    ['费用上限', st.costMax],
    ['目标生命', st.lifePoint],
    ['敌人', st.enemyCount],
  ].map(([k, v]) => `<span><small>${k}</small><b>${v ?? '—'}</b></span>`).join('');
  if (trimSquadToCap()) savePersist();
  renderContracts();
  renderSquad();
  renderOps();
  updateStart();
  setStatus(`已加载 ${seasonData.name} · 仓库 ${operators.length} 名干员`);
}

function renderContracts() {
  const supportBox = $('supportList');
  const optBox = $('optionalList');
  supportBox.replaceChildren();
  optBox.replaceChildren();
  const c = seasonData.contracts || {};
  const selected = new Set(state.contracts);

  for (const row of c.support || []) {
    supportBox.appendChild(contractBtn(row, selected, true));
  }

  /** @type {Map<string, any[]>} */
  const groups = new Map();
  for (const row of c.optional || []) {
    const g = row.group || row.id;
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g).push(row);
  }
  for (const [, rows] of groups) {
    rows.sort((a, b) => (a.level | 0) - (b.level | 0) || (a.risk | 0) - (b.risk | 0));
    const wrap = document.createElement('div');
    wrap.className = 'cc-cgroup';
    const title = document.createElement('div');
    title.className = 'cc-cgroup__title';
    const sample = rows[rows.length - 1];
    title.textContent = String(sample.name || '').replace(/\s*[IVXⅠⅡⅢ]+$/, '') || sample.group;
    wrap.appendChild(title);
    const rowEl = document.createElement('div');
    rowEl.className = 'cc-cgroup__row';
    for (const row of rows) rowEl.appendChild(contractBtn(row, selected, false));
    wrap.appendChild(rowEl);
    optBox.appendChild(wrap);
  }
  refreshRisk();
  if (trimSquadToCap()) {
    savePersist();
    renderSquad();
    renderOps();
  } else {
    renderSquad();
  }
}

function contractBtn(row, selected, isSupport) {
  const btn = document.createElement('button');
  btn.type = 'button';
  const lv = row.level | 0;
  btn.className = `cc-tag risk-${Math.min(3, Math.max(0, row.risk | 0))}${lv ? ` lv-${lv}` : ''}${selected.has(row.id) ? ' is-on' : ''}${isSupport ? ' is-support' : ''}`;
  btn.innerHTML = `
    <span class="cc-tag__risk">${isSupport ? '支援' : `R${row.risk ?? 0}`}</span>
    <span class="cc-tag__body">
      <strong>${escapeHtml(row.name)}</strong>
      <small>${escapeHtml(row.desc || '')}${row.note ? ` · ${escapeHtml(row.note)}` : ''}</small>
    </span>`;
  btn.addEventListener('click', () => {
    const next = new Set(state.contracts);
    if (next.has(row.id)) next.delete(row.id);
    else {
      if (isSupport) {
        for (const s of (seasonData.contracts.support || [])) next.delete(s.id);
      } else if (row.group) {
        for (const o of (seasonData.contracts.optional || [])) {
          if (o.group === row.group) next.delete(o.id);
        }
      }
      next.add(row.id);
    }
    const trial = resolveContractPick(seasonData.contracts, [...next]);
    if (!trial.ok) {
      setStatus(trial.error || '合约冲突');
      return;
    }
    state.contracts = [...next];
    savePersist();
    renderContracts();
    updateStart();
  });
  return btn;
}

function refreshRisk() {
  const trial = resolveContractPick(seasonData.contracts, state.contracts);
  const badge = $('riskBadge');
  const note = $('riskNote');
  const box = $('riskBox');
  const foot = $('footRisk');
  if (!trial.ok) {
    badge.textContent = '—';
    note.textContent = trial.error || '冲突';
    box?.classList.add('is-bad');
    box?.classList.remove('is-support');
    if (foot) foot.textContent = '风险 —';
    renderPicked([]);
    return;
  }
  box?.classList.remove('is-bad');
  const supportOn = trial.selected.some((c) => (seasonData.contracts.support || []).some((s) => s.id === c.id));
  const optionalRisk = trial.selected
    .filter((c) => !(seasonData.contracts.support || []).some((s) => s.id === c.id))
    .reduce((n, c) => n + (Number(c.risk) || 0), 0);
  badge.textContent = String(trial.risk);
  if (supportOn) {
    note.textContent = optionalRisk > 0 ? `支援生效 · 可选合计 ${optionalRisk}` : '支援生效';
    box?.classList.add('is-support');
  } else {
    note.textContent = trial.selected.length ? `${trial.selected.length} 项合约` : '未选合约';
    box?.classList.remove('is-support');
  }
  if (foot) {
    foot.textContent = supportOn
      ? `风险 0（支援）`
      : `风险 ${trial.risk}`;
  }
  renderPicked(trial.selected);
  const optCount = $('optionalCount');
  if (optCount) {
    const n = (seasonData.contracts.optional || []).length;
    const on = trial.selected.filter((c) => !(seasonData.contracts.support || []).some((s) => s.id === c.id)).length;
    optCount.textContent = on ? `已选 ${on} / ${n}` : `共 ${n}`;
  }
}

function renderPicked(selected) {
  const strip = $('pickedStrip');
  const list = $('pickedList');
  if (!strip || !list) return;
  if (!selected.length) {
    strip.hidden = true;
    list.replaceChildren();
    return;
  }
  strip.hidden = false;
  const supportIds = new Set((seasonData.contracts.support || []).map((s) => s.id));
  list.innerHTML = selected.map((c) => {
    const support = supportIds.has(c.id);
    return `<button type="button" class="cc-picked__chip${support ? ' is-support' : ''}" data-id="${escapeAttr(c.id)}" title="点击移除">
      <em>${support ? '支援' : `R${c.risk | 0}`}</em><span>${escapeHtml(c.name)}</span>
    </button>`;
  }).join('');
}

function ensureProfFilter() {
  const sel = $('opProf');
  if (sel.options.length > 1) return;
  const seen = new Map();
  for (const op of operators) {
    if (!seen.has(op.profession)) seen.set(op.profession, op.professionName || op.profession);
  }
  for (const [id, name] of [...seen.entries()].sort((a, b) => a[1].localeCompare(b[1], 'zh'))) {
    const o = document.createElement('option');
    o.value = id;
    o.textContent = name;
    sel.appendChild(o);
  }
}

function makeSquadCard(id, { borrow = false } = {}) {
  const op = opById.get(id);
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = `cc-chip${borrow ? ' is-borrow' : ''}`;
  const lo = loadoutOf(id);
  const url = crisisAvatarUrl(id, { e2: (lo?.elite ?? 2) >= 2 });
  const rar = rarityUrl(op?.rarity || 3);
  const frame = crisisUiUrl('prepReady/player_frame') || crisisUiUrl('shopCard/frame_outline') || '';
  btn.innerHTML = `
    <span class="cc-chip__frame" ${frame ? `style="background-image:url('${escapeAttr(frame)}')"` : ''}>
      <img class="cc-chip__av" alt="" src="${escapeAttr(url)}" onerror="this.remove()"/>
      ${rar ? `<img class="cc-chip__rar" alt="" src="${escapeAttr(rar)}"/>` : ''}
    </span>
    <span class="cc-chip__meta">
      ${borrow ? '<em class="cc-chip__tag">助战</em>' : ''}
      <b>${escapeHtml(op?.name || id)}</b>
      <small>精${lo?.elite ?? 0} · Lv${lo?.level ?? 1}</small>
    </span>`;
  btn.title = borrow
    ? '助战位 · 点击改练度；右键清空'
    : '点击调整练度；右键移出编队';
  btn.addEventListener('click', () => openLoadout(id));
  btn.addEventListener('contextmenu', (ev) => {
    ev.preventDefault();
    if (borrow) {
      state.borrowId = null;
    } else {
      state.squad = state.squad.filter((x) => x !== id);
    }
    savePersist();
    renderSquad();
    renderOps();
    updateStart();
  });
  return btn;
}

function renderSquad() {
  const box = $('squadSlots');
  box.replaceChildren();
  const cap = mainSquadCap();
  $('squadCount').textContent = `主队 ${state.squad.length}/${cap}${state.borrowId ? ' · 助战 1' : ' · 助战空'}`;
  $('squadCapHint').textContent = cap < SQUAD_CAP ? `（词条限制 ${cap}）` : `（上限 ${SQUAD_CAP}）`;

  for (const id of state.squad) box.appendChild(makeSquadCard(id));
  for (let i = state.squad.length; i < cap; i++) {
    const empty = document.createElement('div');
    empty.className = 'cc-chip cc-chip--empty';
    empty.textContent = `${i + 1}`;
    empty.title = '在下方仓库点击干员编入';
    empty.addEventListener('click', () => {
      state.pickMode = 'squad';
      syncPickMode();
      setStatus('请在仓库中选择干员编入主队');
    });
    box.appendChild(empty);
  }

  const borrowBtn = $('borrowSlot');
  borrowBtn.replaceChildren();
  borrowBtn.classList.toggle('is-filled', !!state.borrowId);
  borrowBtn.classList.toggle('is-picking', state.pickMode === 'borrow');
  if (state.borrowId && opById.has(state.borrowId)) {
    borrowBtn.appendChild(makeSquadCard(state.borrowId, { borrow: true }));
  } else {
    borrowBtn.innerHTML = '<span class="cc-borrow-slot__empty">+ 助战（第13位）</span>';
  }
}

function renderOps() {
  ensureProfFilter();
  const q = ($('opFilter').value || '').trim().toLowerCase();
  const prof = $('opProf').value;
  const box = $('opGrid');
  box.replaceChildren();
  const inSquad = new Set(state.squad);
  let shown = 0;
  for (const op of operators) {
    if (prof && op.profession !== prof) continue;
    if (q && !String(op.name).toLowerCase().includes(q) && !String(op.id).toLowerCase().includes(q)) continue;
    const btn = document.createElement('button');
    btn.type = 'button';
    const isBorrow = state.borrowId === op.id;
    btn.className = `cc-op${inSquad.has(op.id) ? ' is-in' : ''}${isBorrow ? ' is-borrow' : ''}`;
    const url = crisisAvatarUrl(op.id, { e2: true });
    const rar = rarityUrl(op.rarity || 3);
    btn.innerHTML = `
      <span class="cc-op__avwrap">
        <img class="cc-op__av" alt="" src="${escapeAttr(url)}" width="56" height="56" loading="lazy" onerror="this.classList.add('is-miss')"/>
        ${rar ? `<img class="cc-op__rar" alt="" src="${escapeAttr(rar)}"/>` : ''}
      </span>
      <span class="cc-op__meta">
        <span class="star">${'★'.repeat(op.rarity || 1)}</span>
        <b>${escapeHtml(op.name)}</b>
        <small>${escapeHtml(op.professionName || '')}${isBorrow ? ' · 助战' : ''}</small>
      </span>`;
    btn.addEventListener('click', () => pickOperator(op.id));
    box.appendChild(btn);
    shown += 1;
    if (shown >= 400) break;
  }
}

function ensureLoadout(id) {
  if (!state.loadouts[id]) {
    const char = opById.get(id);
    if (char) state.loadouts[id] = defaultLoadout(char);
  }
}

function pickOperator(id) {
  if (state.pickMode === 'borrow') {
    if (state.borrowId === id) state.borrowId = null;
    else {
      state.borrowId = id;
      ensureLoadout(id);
      // If they were only in main squad, keep them in squad too (official can have same? we allow both only if not same hand — battle dedupes)
    }
    savePersist();
    renderSquad();
    renderOps();
    updateStart();
    setStatus(state.borrowId ? `已设助战：${opById.get(id)?.name || id}` : '已清空助战位');
    return;
  }

  if (state.squad.includes(id)) {
    state.squad = state.squad.filter((x) => x !== id);
  } else {
    const cap = mainSquadCap();
    if (state.squad.length >= cap) {
      setStatus(`主编队最多 ${cap} 人${cap < SQUAD_CAP ? '（隐秘行动）' : ''}；助战请切到「选为助战」`);
      return;
    }
    state.squad.push(id);
    ensureLoadout(id);
  }
  savePersist();
  renderSquad();
  renderOps();
  updateStart();
}

function syncPickMode() {
  for (const btn of document.querySelectorAll('#pickMode .cc-pick')) {
    btn.classList.toggle('is-on', btn.getAttribute('data-mode') === state.pickMode);
  }
  $('borrowSlot')?.classList.toggle('is-picking', state.pickMode === 'borrow');
}

function openLoadout(id) {
  const char = opById.get(id);
  if (!char) return;
  state.editId = id;
  $('loadoutPanel').hidden = false;
  $('loadoutTitle').textContent = `${char.name} · 练度${state.borrowId === id ? '（助战）' : ''}`;
  const lo = loadoutOf(id);
  const form = $('loadoutForm');
  form.replaceChildren();

  const eliteCap = maxElite(char.phases);
  form.appendChild(fieldSelect('elite', '精英', lo.elite, [...Array(eliteCap + 1).keys()].map((e) => ({ value: e, label: `精 ${e}` }))));
  const lvMax = maxLevelForElite(char.phases, lo.elite);
  form.appendChild(fieldNumber('level', '等级', lo.level, 1, lvMax));
  form.appendChild(fieldNumber('potential', '潜能 (0–5)', lo.potential, 0, char.maxPotentialLevel ?? 5));
  const skillOpts = (char.skills || []).map((s, i) => ({ value: i, label: `技能 ${i + 1}${s.skillId ? ` (${s.skillId})` : ''}` }));
  if (!skillOpts.length) skillOpts.push({ value: 0, label: '无技能' });
  form.appendChild(fieldSelect('skillIndex', '选用技能', lo.skillIndex, skillOpts));
  form.appendChild(fieldNumber('specialize', '专精', lo.specialize, 0, 3));
  form.appendChild(fieldNumber('trust', '信赖', lo.trust, 0, 200));

  const apply = document.createElement('button');
  apply.type = 'button';
  apply.className = 'cc-btn primary';
  apply.textContent = '保存练度';
  apply.addEventListener('click', () => {
    const raw = Object.fromEntries(new FormData(form).entries());
    state.loadouts[id] = normalizeLoadout({
      elite: Number(raw.elite),
      level: Number(raw.level),
      potential: Number(raw.potential),
      skillIndex: Number(raw.skillIndex),
      specialize: Number(raw.specialize),
      trust: Number(raw.trust),
    }, char);
    savePersist();
    renderSquad();
    setStatus(`已保存 ${char.name} 练度`);
  });
  form.appendChild(apply);

  form.querySelector('[name=elite]')?.addEventListener('change', () => {
    const e = Number(form.elite.value);
    const max = maxLevelForElite(char.phases, e);
    const lv = form.querySelector('[name=level]');
    if (lv) {
      lv.max = String(max);
      if (Number(lv.value) > max) lv.value = String(max);
    }
  });
}

function fieldNumber(name, label, value, min, max) {
  const lab = document.createElement('label');
  lab.textContent = label;
  const input = document.createElement('input');
  input.type = 'number';
  input.name = name;
  input.min = String(min);
  input.max = String(max);
  input.value = String(value);
  lab.appendChild(input);
  return lab;
}

function fieldSelect(name, label, value, options) {
  const lab = document.createElement('label');
  lab.textContent = label;
  const sel = document.createElement('select');
  sel.name = name;
  for (const o of options) {
    const opt = document.createElement('option');
    opt.value = String(o.value);
    opt.textContent = o.label;
    if (Number(o.value) === Number(value)) opt.selected = true;
    sel.appendChild(opt);
  }
  lab.appendChild(sel);
  return lab;
}

function updateStart() {
  const btn = $('btnStart');
  const ok = (!!seasonData) && (state.squad.length > 0 || !!state.borrowId);
  btn.disabled = !ok;
  const foot = $('footSquad');
  if (foot) {
    const main = state.squad.length;
    const borrow = state.borrowId ? 1 : 0;
    foot.textContent = ok
      ? `编队 ${main}${borrow ? ' + 助战' : ''}`
      : '请编入干员';
  }
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function escapeAttr(s) {
  return escapeHtml(s);
}

async function loadRoster() {
  const res = await fetch('/crisis/data/roster.json', { cache: 'no-cache' });
  if (!res.ok) {
    setStatus('缺少干员仓库：请在仓库根目录执行 node tools/crisis-roster.mjs');
    operators = [];
    return;
  }
  const body = await res.json();
  operators = Array.isArray(body.operators) ? body.operators : [];
  opById.clear();
  for (const op of operators) opById.set(op.id, op);
  state.squad = state.squad.filter((id) => opById.has(id));
  if (state.borrowId && !opById.has(state.borrowId)) state.borrowId = null;
}

function wire() {
  $('btnClearContracts')?.addEventListener('click', () => {
    state.contracts = [];
    savePersist();
    renderContracts();
    updateStart();
    setStatus('已清空合约');
  });
  $('pickedList')?.addEventListener('click', (ev) => {
    const t = /** @type {HTMLElement} */ (ev.target).closest?.('[data-id]');
    if (!t) return;
    const id = t.getAttribute('data-id');
    if (!id) return;
    state.contracts = state.contracts.filter((x) => x !== id);
    savePersist();
    renderContracts();
    updateStart();
  });
  $('opFilter').addEventListener('input', () => renderOps());
  $('opProf').addEventListener('change', () => renderOps());
  $('btnFillMax').addEventListener('click', () => {
    const ids = [...state.squad];
    if (state.borrowId) ids.push(state.borrowId);
    for (const id of ids) {
      const char = opById.get(id);
      if (char) state.loadouts[id] = defaultLoadout(char);
    }
    savePersist();
    renderSquad();
    if (state.editId) openLoadout(state.editId);
    setStatus('编队与助战已全部满练');
  });
  $('btnStart').addEventListener('click', () => { void startBattle(); });
  $('pickMode').addEventListener('click', (ev) => {
    const t = /** @type {HTMLElement} */ (ev.target);
    const mode = t.getAttribute?.('data-mode');
    if (mode !== 'squad' && mode !== 'borrow') return;
    state.pickMode = mode;
    syncPickMode();
    setStatus(mode === 'borrow' ? '点击仓库干员设为第13位助战' : '点击仓库干员编入主队');
  });
  const borrowSlot = $('borrowSlot');
  const enterBorrowPick = () => {
    state.pickMode = 'borrow';
    syncPickMode();
    setStatus('点击仓库干员设为第13位助战');
  };
  borrowSlot.addEventListener('click', (ev) => {
    // Filled slot: child chip handles loadout / clear. Empty area enters pick mode.
    if (/** @type {HTMLElement} */ (ev.target).closest?.('.cc-chip')) return;
    enterBorrowPick();
  });
  borrowSlot.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter' || ev.key === ' ') {
      ev.preventDefault();
      enterBorrowPick();
    }
  });
}

async function startBattle() {
  if (!state.squad.length && !state.borrowId) {
    setStatus('请先编入干员或选择助战');
    return;
  }
  const meta = SEASONS.find((s) => s.id === state.seasonId) || firstPlayableSeason();
  const stageUrl = seasonData.stageUrl || meta.stageUrl || '/crisis/data/stages/level_rune_01-03.json';
  setStatus('加载战场数据…');
  try {
    const [stageRes, enemyRes, opRes, tokRes] = await Promise.all([
      fetch(stageUrl, { cache: 'no-cache' }),
      fetch('/crisis/data/enemies.json', { cache: 'no-cache' }),
      fetch('/crisis/data/battle-ops.json', { cache: 'no-cache' }),
      fetch('/crisis/data/deploy-tokens.json', { cache: 'no-cache' }),
    ]);
    if (!stageRes.ok) throw new Error('缺少关卡数据：请运行 node tools/crisis-stage.mjs');
    if (!enemyRes.ok || !opRes.ok) throw new Error('缺少战斗数值包：请运行 node tools/crisis-stage.mjs');
    const stage = await stageRes.json();
    const enemies = (await enemyRes.json()).enemies;
    const operators = (await opRes.json()).operators;
    // Optional until regenerate: missing pack ⇒ summoners cannot hand-place tokens.
    const tokPack = tokRes.ok ? await tokRes.json() : { tokens: {}, byOwner: {} };
    const lobby = $('app');
    const bat = $('battleRoot');
    lobby.hidden = true;
    bat.hidden = false;
    bat.replaceChildren();
    const squad = state.squad.map((id) => ({ id, loadout: loadoutOf(id) }));
    const borrow = state.borrowId
      ? { id: state.borrowId, loadout: loadoutOf(state.borrowId) }
      : null;
    await mountBattle(bat, {
      stage,
      enemies,
      operators,
      tokens: tokPack.tokens || {},
      tokenByOwner: tokPack.byOwner || {},
      squad,
      borrow,
      contractIds: state.contracts,
      seasonContracts: seasonData.contracts,
      seasonName: `${seasonData.name} · ${seasonData.mapName}`,
      onExit: () => {
        bat.hidden = true;
        bat.replaceChildren();
        lobby.hidden = false;
        setStatus('已返回整备');
      },
    });
    setStatus('');
  } catch (err) {
    console.error(err);
    setStatus(String(err && err.message ? err.message : err));
  }
}

function applyLobbyChrome() {
  const bg = uiBg('prepareBkg/bg', ['battleReady/bg_terrain', 'hudPanel/bg_board']);
  if (bg) document.body.style.setProperty('--cc-lobby-bg', `url("${bg}")`);
  const ring = uiBg('battleReady/bg_ring');
  if (ring) document.body.style.setProperty('--cc-lobby-ring', `url("${ring}")`);
}

async function main() {
  loadPersist();
  renderSeasons();
  wire();
  syncPickMode();
  await Promise.all([loadCrisisArt(), loadRoster()]);
  applyLobbyChrome();
  await loadSeason();
}

main().catch((err) => {
  console.error(err);
  setStatus(String(err && err.message ? err.message : err));
});
