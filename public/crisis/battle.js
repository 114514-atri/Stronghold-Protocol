// public/crisis/battle.js — Crisis TD view using 卫戍协议 operator/enemy art.

import { createBattle } from '../../shared/crisis/sim/battle.js';
import { tileAccepts } from '../../shared/crisis/sim/stats.js';
import { resolveContractPick } from '../../shared/crisis/contracts.js';
import {
  loadCrisisArt, crisisAvatarUrl, crisisPortraitUrl, crisisEnemyIconUrl, crisisUiUrl,
  loadImage, peekImage, prefetchImages,
} from './art.js';
import { createSpineLayer } from './spineLayer.js';
import { createBoard3d } from './board3d.js';
import { createCrisisCamera, toMapRow, toWorldRow, tileHeight, simToWorld } from './view.js';
import { DIR_VEC, normDir, rotateOffset, DEFAULT_DIR } from '/sim/dir.js';
import { openFacingOverlay } from './facingOverlay.js';
import { assets } from '../js/assets.js';
import { audio, installAudio } from '../js/audio.js';

const PROF_LABEL = Object.freeze({
  PIONEER: '先锋', WARRIOR: '近卫', GUARD: '近卫', SNIPER: '狙击',
  TANK: '重装', DEFENDER: '重装', CASTER: '术师', MEDIC: '医疗',
  SUPPORT: '辅助', SPECIAL: '特种',
});

/**
 * @param {HTMLElement} root
 * @param {{
 *   stage: any,
 *   enemies: Record<string, any>,
 *   operators: Record<string, any>,
 *   tokens?: Record<string, any>,
 *   tokenByOwner?: Record<string, string[]>,
 *   squad: { id: string, loadout: any }[],
 *   borrow?: { id: string, loadout: any }|null,
 *   contractIds: string[],
 *   seasonContracts: any,
 *   seasonName: string,
 *   onExit: () => void,
 * }} opts
 */
export async function mountBattle(root, opts) {
  await loadCrisisArt();
  try { await assets.ready(); } catch { /* */ }
  try { await assets.local(); } catch { /* */ }
  try { installAudio({ getManifest: () => assets.manifest }); } catch { /* */ }
  const battle = createBattle({
    ...opts,
    borrow: opts.borrow || null,
  });
  let snap = battle.snapshot();
  let selectedOp = null;
  /** @type {number|null} */
  let selectedUnitId = null;
  let speed = 1;
  let paused = false;
  let raf = 0;
  let acc = 0;
  let lastTs = 0;
  let handSig = '';
  let unitPanelSig = '';
  let underframeSig = '';
  /** @type {{ r: number, c: number } | null} */
  let hoverCell = null;
  /** @type {string|null} pending deploy after drag */
  let pendingDeployOp = null;
  /** @type {{ r: number, c: number } | null} */
  let pendingTile = null;
  /** @type {string|null} live facing preview while wheel open */
  let facingPreview = null;
  let facingOpen = false;
  /** Enemy visual positions for smooth Spine (id → {x,y}). */
  const enemyVis = new Map();
  /** @type {HTMLElement|null} */
  let dragGhost = null;
  /** @type {string|null} */
  let dragOpId = null;
  let lastLife = snap.life;
  let lastStatus = snap.status;
  let endPanelSig = '';
  const trial = resolveContractPick(opts.seasonContracts || {}, opts.contractIds || []);
  const riskLabel = trial.ok ? trial.risk : 0;
  const riskChips = (trial.selected || []).slice(0, 8).map((c) => ({
    id: c.id,
    name: c.name || c.id,
    risk: c.risk | 0,
    support: !!(opts.seasonContracts?.support || []).some((s) => s.id === c.id),
  }));

  const boardBgUrl = crisisUiUrl('hudPanel/bg_board') || crisisUiUrl('hudPanel/bg_battle');
  const uiPause = crisisUiUrl('battleUi/btn_pause') || '';
  const uiSpeed1 = crisisUiUrl('battleUi/btn_speed_1x') || '';
  const uiSpeed2 = crisisUiUrl('battleUi/btn_speed_2x') || '';
  const uiSkillReady = crisisUiUrl('battleUi/skill_ready') || '';
  const uiRangeStand = crisisUiUrl('battleUi/attack_range_stand') || '';
  const uiRangeAtk = crisisUiUrl('battleUi/attack_range_attack') || '';
  const uiHpBack = crisisUiUrl('battleUi/slider_hp_back') || '';
  const uiHpFill = crisisUiUrl('battleUi/slider_hp_fill') || '';
  const uiSettleWin = crisisUiUrl('settle/settlemen_personal_success') || '';
  const uiSettleLose = crisisUiUrl('settle/settlemen_personal_fail') || '';
  const uiMissBg = crisisUiUrl('hudPanel/bg_miss_enemy') || '';
  const uiBattleIcon = crisisUiUrl('hudPanel/icon_battle') || '';
  const enemyUrls = Object.keys(opts.enemies || {}).map((id) => crisisEnemyIconUrl(id));
  const opUrls = (opts.squad || []).map((s) => {
    const lo = s.loadout || {};
    return crisisAvatarUrl(s.id, { e2: (lo.elite | 0) >= 2 });
  });
  await prefetchImages([
    boardBgUrl, uiPause, uiSpeed1, uiSpeed2, uiSkillReady, uiRangeStand, uiRangeAtk,
    uiHpBack, uiHpFill, uiSettleWin, uiSettleLose, uiMissBg, uiBattleIcon,
    ...enemyUrls, ...opUrls,
  ].filter(Boolean));

  const hpIcon = crisisUiUrl('hudPanel/icon_hp') || '';
  document.documentElement.classList.add('cc-bat-lock');
  document.body.classList.add('cc-bat-lock');

  root.innerHTML = `
    <div class="cc-bat">
      <div class="cc-bat__stage" id="batStage">
        <canvas id="batCanvas"></canvas>
        <canvas id="batBars"></canvas>
        <div class="cc-bat__overlay" id="batHud">
          <header class="cc-bat__top">
            <button type="button" class="cc-btn ghost cc-bat__back" id="batExit">← 整备</button>
            <div class="cc-bat__title" title="${escapeAttr(opts.seasonName || '危机合约')}">${escape(opts.seasonName || '危机合约')}</div>
            <div class="cc-bat__top-right">
              <button type="button" class="cc-bat__iconbtn" id="batPause" title="暂停">
                ${uiPause ? `<img alt="" src="${escapeAttr(uiPause)}"/>` : '<span>❚❚</span>'}
              </button>
              <button type="button" class="cc-bat__iconbtn" id="batSpeed" title="倍速" data-speed="1">
                ${uiSpeed1 ? `<img alt="" id="batSpeedImg" src="${escapeAttr(uiSpeed1)}"/>` : '<span id="batSpeedTxt">×1</span>'}
              </button>
            </div>
          </header>
          <div class="cc-bat__lp" id="batLp" title="蓝门生命值">
            ${hpIcon ? `<img class="cc-bat__lp-icon" alt="" src="${escapeAttr(hpIcon)}"/>` : '<span class="cc-bat__lp-glyph">◆</span>'}
            <b class="cc-bat__lp-val" id="batLife">—</b>
            <span class="cc-bat__lp-label">LIFE</span>
          </div>
          <div class="cc-bat__capsule" id="batCapsule" title="击杀 / 漏敌 / 剩余敌人"
            style="${uiMissBg ? `background-image:url('${escapeAttr(uiMissBg)}')` : ''}">
            ${uiBattleIcon ? `<img class="cc-bat__cap-icon" alt="" src="${escapeAttr(uiBattleIcon)}"/>` : ''}
            <span id="batKill">0</span><span class="cc-bat__cap-sep">/</span><span id="batRemain">0</span>
            <span class="cc-bat__cap-sub" id="batLeak">漏 0</span>
          </div>
          <div class="cc-bat__time" id="batTime">0.0s</div>
          <div class="cc-bat__dp" id="batDp" title="部署费用">
            <span class="cc-bat__dp-label">COST</span>
            <b class="cc-bat__dp-val" id="batCost">—</b>
            <span class="cc-bat__dp-max" id="batCostMax">/99</span>
          </div>
          <div class="cc-bat__risk" id="batRisk" title="本场合约风险（CrisisV2 评分条语义）">
            <span class="cc-bat__risk-label">RISK</span>
            <b class="cc-bat__risk-val" id="batRiskVal">${riskLabel}</b>
            <div class="cc-bat__risk-chips" id="batRiskChips"></div>
          </div>
          <div id="batUnderframe" class="cc-uframe" hidden></div>
          <aside id="batUnitPanel" class="cc-dpanel" hidden></aside>
          <div id="batStatus" class="cc-bat__status" hidden></div>
          <div id="batEnd" class="cc-bat__end" hidden></div>
          <p class="cc-bat__hint" id="batHint">点选或拖底栏干员到格子 · 选朝向部署 · 点场上干员可撤退/开技能</p>
          <div id="batHand" class="cc-bat__hand" role="list"></div>
        </div>
      </div>
    </div>
  `;

  // Contract chips (official CrisisV2 rune strip — names only, no sprite hub yet)
  {
    const chipHost = root.querySelector('#batRiskChips');
    if (chipHost) {
      if (!riskChips.length) {
        chipHost.innerHTML = '<span class="cc-bat__risk-empty">无合约</span>';
      } else {
        chipHost.innerHTML = riskChips.map((c) => (
          `<span class="cc-bat__risk-chip${c.support ? ' is-support' : ''}" title="${escapeAttr(c.name)}">${c.support ? '支援' : `R${c.risk}`}</span>`
        )).join('');
      }
    }
  }

  const stageEl = root.querySelector('#batStage');
  const canvas = root.querySelector('#batCanvas');
  const barsCanvas = root.querySelector('#batBars');
  const ctx = canvas.getContext('2d');
  const barsCtx = barsCanvas.getContext('2d');

  function layoutStage() {
    const w = Math.max(480, Math.floor(stageEl.clientWidth || window.innerWidth));
    const h = Math.max(320, Math.floor(stageEl.clientHeight || window.innerHeight));
    // Ground overlays under Spine (z=1); HP/SP bars above Spine (z=3). Spine is z=2.
    canvas.width = w;
    canvas.height = h;
    canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;z-index:1;background:transparent;touch-action:none';
    barsCanvas.width = w;
    barsCanvas.height = h;
    barsCanvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;z-index:3;background:transparent;pointer-events:none';
    return { w, h };
  }

  let { w: stageW, h: stageH } = layoutStage();
  let cam = createCrisisCamera(snap.map, { width: stageW, height: stageH });
  const proj = { x: 0, y: 0, s: 0, depth: 0 };
  const unp = { x: 0, y: 0 };

  const setStatusSafe = (msg) => {
    const el = root.querySelector('#batHint');
    if (el && msg) el.textContent = msg;
  };

  const unlockPage = () => {
    document.documentElement.classList.remove('cc-bat-lock');
    document.body.classList.remove('cc-bat-lock');
  };
  /** @type {Awaited<ReturnType<typeof createBoard3d>>} */
  let board3d = null;
  /** @type {Awaited<ReturnType<typeof createSpineLayer>>} */
  let spines = null;
  try {
    board3d = await createBoard3d(stageEl, { map: snap.map, cam, width: stageW, height: stageH });
  } catch (err) {
    console.warn('[crisis] board3d unavailable', err);
  }
  try {
    spines = await createSpineLayer(stageEl, { cam, map: snap.map, width: stageW, height: stageH });
  } catch (err) {
    console.warn('[crisis] spine layer unavailable', err);
    setStatusSafe('Spine 层加载失败，回退头像图标');
  }

  root.querySelector('#batExit').addEventListener('click', () => {
    cancelAnimationFrame(raf);
    window.removeEventListener('resize', onResize);
    spines?.destroy();
    board3d?.destroy();
    clearDragGhost();
    unlockPage();
    opts.onExit();
  });
  root.querySelector('#batPause').addEventListener('click', () => {
    paused = !paused;
    const btn = root.querySelector('#batPause');
    btn.classList.toggle('is-paused', paused);
    btn.title = paused ? '继续' : '暂停';
    if (!uiPause) btn.textContent = paused ? '▶' : '❚❚';
  });
  root.querySelector('#batSpeed').addEventListener('click', () => {
    speed = speed === 1 ? 2 : 1; // match 卫戍：1× / 2×
    const btn = root.querySelector('#batSpeed');
    btn.dataset.speed = String(speed);
    btn.title = `倍速 ×${speed}`;
    const img = root.querySelector('#batSpeedImg');
    if (img) img.src = speed === 2 ? (uiSpeed2 || uiSpeed1) : (uiSpeed1 || uiSpeed2);
    const txt = root.querySelector('#batSpeedTxt');
    if (txt) txt.textContent = `×${speed}`;
  });

  function onResize() {
    const laid = layoutStage();
    stageW = laid.w;
    stageH = laid.h;
    cam = createCrisisCamera(snap.map, { width: stageW, height: stageH });
    board3d?.resize?.(stageW, stageH);
    if (board3d && typeof board3d.setCam === 'function') board3d.setCam(cam);
    spines?.resize?.(stageW, stageH, cam, snap.map);
    spines?.setCam?.(cam);
    draw();
    board3d?.render();
  }
  window.addEventListener('resize', onResize);

  canvas.addEventListener('pointermove', (ev) => {
    if (facingOpen || dragOpId) return;
    const cell = pickCell(ev);
    hoverCell = cell.r >= 0 ? cell : null;
  });
  canvas.addEventListener('pointerleave', () => {
    if (!dragOpId) hoverCell = null;
  });

  // Field click: pick nearest unit by screen distance, or deploy selected hand op onto a tile.
  canvas.addEventListener('pointerup', (ev) => {
    if (facingOpen || dragOpId || ev.button === 2) return;
    // Ignore if this was the end of a hand-card press that didn't drag (handled on the card).
    if (handPress) return;
    const near = pickUnitAt(ev.clientX, ev.clientY);
    if (near) {
      selectedUnitId = near.id;
      selectedOp = null;
      setHint(`已选 ${near.name}：可撤退或开技能`);
      renderHand(true);
      renderUnitPanel(true);
      draw();
      return;
    }
    const { r, c } = pickCell(ev);
    if (r < 0) {
      if (selectedOp) {
        selectedOp = null;
        setHint('已取消选中干员');
        renderHand(true);
      } else {
        selectedUnitId = null;
        renderUnitPanel(true);
      }
      draw();
      return;
    }
    const onTile = snap.units.find((x) => x.alive !== false && x.r === r && x.c === c && !x.dying);
    if (onTile) {
      selectedUnitId = onTile.id;
      selectedOp = null;
      setHint(`已选 ${onTile.name}：可撤退或开技能`);
      renderHand(true);
      renderUnitPanel(true);
      draw();
      return;
    }
    if (selectedOp && snap.status === 'running') {
      beginFacingDeploy(selectedOp, r, c);
      return;
    }
    selectedUnitId = null;
    renderUnitPanel(true);
    draw();
  });

  canvas.addEventListener('contextmenu', (ev) => {
    ev.preventDefault();
    if (facingOpen) return;
    const near = pickUnitAt(ev.clientX, ev.clientY);
    if (near) {
      doRetreat(near.id);
      return;
    }
    const { r, c } = pickCell(ev);
    const u = snap.units.find((x) => x.alive !== false && !x.dying && x.r === r && x.c === c);
    if (u) doRetreat(u.id);
  });

  /** @type {{ id: string, x: number, y: number, pointerId: number }|null} */
  let handPress = null;
  const DRAG_THRESH = 10;

  function clearDragGhost() {
    dragGhost?.remove();
    dragGhost = null;
    dragOpId = null;
    hoverCell = null;
  }

  function beginHandPress(opId, ev) {
    if (facingOpen || snap.status !== 'running') return;
    const h = snap.hand.find((x) => x.id === opId);
    if (!h?.ready) return;
    handPress = { id: opId, x: ev.clientX, y: ev.clientY, pointerId: ev.pointerId };
    window.addEventListener('pointermove', onHandPressMove);
    window.addEventListener('pointerup', onHandPressUp, { once: true });
    window.addEventListener('pointercancel', onHandPressUp, { once: true });
  }

  function onHandPressMove(ev) {
    if (!handPress) return;
    const dx = ev.clientX - handPress.x;
    const dy = ev.clientY - handPress.y;
    if (Math.hypot(dx, dy) < DRAG_THRESH) return;
    const opId = handPress.id;
    handPress = null;
    window.removeEventListener('pointermove', onHandPressMove);
    beginDrag(opId, ev);
  }

  function onHandPressUp(ev) {
    window.removeEventListener('pointermove', onHandPressMove);
    const press = handPress;
    handPress = null;
    if (!press) return;
    // Click = select for click-to-tile deploy (卫戍式点选).
    if (selectedOp === press.id) {
      selectedOp = null;
      setHint('已取消选中');
    } else {
      selectedOp = press.id;
      selectedUnitId = null;
      const h = snap.hand.find((x) => x.id === press.id);
      setHint(h
        ? `已选 ${h.name}：再点战场格子部署，或拖到格子`
        : '再点战场格子部署');
    }
    renderHand(true);
    renderUnitPanel(true);
    draw();
  }

  function beginDrag(opId, ev) {
    if (facingOpen || snap.status !== 'running') return;
    const h = snap.hand.find((x) => x.id === opId);
    if (!h?.ready) return;
    dragOpId = opId;
    selectedOp = opId;
    selectedUnitId = null;
    const elite = eliteOf(opId);
    const url = crisisPortraitUrl(opId, { e2: elite >= 2 }) || crisisAvatarUrl(opId, { e2: elite >= 2 });
    dragGhost = document.createElement('div');
    dragGhost.className = 'cc-bat__ghost cc-bat__ghost--lift';
    dragGhost.innerHTML = `<img alt="" draggable="false" src="${escapeAttr(url)}"/>`;
    document.body.appendChild(dragGhost);
    moveDragGhost(ev.clientX, ev.clientY);
    renderHand(true);
    renderUnitPanel(true);
    setHint(`拖到${posLabel(h.position)}格子 · 松手选朝向`);
    window.addEventListener('pointermove', onDragMove);
    window.addEventListener('pointerup', onDragEnd, { once: true });
  }

  function moveDragGhost(x, y) {
    if (!dragGhost) return;
    // Feet under the pointer (卫戍 DRAG_HOLD).
    dragGhost.style.left = `${x}px`;
    dragGhost.style.top = `${y}px`;
  }

  function tileLegalFor(opId, r, c) {
    const h = snap.hand.find((x) => x.id === opId);
    if (!h || r < 0 || c < 0) return false;
    const cell = snap.map.cells[r]?.[c];
    if (!cell) return false;
    if (!tileAccepts(h.position, cell.buildableType)) return false;
    if (snap.units.some((u) => u.alive !== false && !u.dying && u.r === r && u.c === c)) return false;
    return true;
  }

  function onDragMove(ev) {
    if (!dragOpId) return;
    moveDragGhost(ev.clientX, ev.clientY);
    const cell = pickCell(ev);
    hoverCell = cell.r >= 0 ? cell : null;
    if (hoverCell && tileLegalFor(dragOpId, hoverCell.r, hoverCell.c)) {
      // Stand on the tile like official deploy drag; dim the finger ghost.
      spines?.setDeployGhost?.(dragOpId, hoverCell.r, hoverCell.c, defaultDeployDir(hoverCell.c));
      spines?.sync?.(spineSnap(), 0);
      if (dragGhost) dragGhost.classList.add('is-docked');
    } else {
      spines?.clearDeployGhost?.();
      spines?.sync?.(spineSnap(), 0);
      if (dragGhost) dragGhost.classList.remove('is-docked');
    }
    draw();
  }

  function onDragEnd(ev) {
    window.removeEventListener('pointermove', onDragMove);
    const opId = dragOpId;
    const cell = pickCell(ev);
    clearDragGhost();
    if (!opId || cell.r < 0 || !tileLegalFor(opId, cell.r, cell.c)) {
      spines?.clearDeployGhost?.();
      selectedOp = null;
      renderHand(true);
      setHint('从底栏拖干员到格子部署');
      draw();
      return;
    }
    // Keep spine ghost on the tile into the facing step (卫戍 holdPiece).
    beginFacingDeploy(opId, cell.r, cell.c);
  }

  /** Default facing toward blue gate when dropping without a swipe preference. */
  function defaultDeployDir(c) {
    const blueC = snap.map.cells
      .flatMap((row) => row.map((cell, cc) => (cell.tileKey === 'tile_end' ? cc : -1)))
      .find((x) => x >= 0);
    if (typeof blueC === 'number' && c > blueC) return 'LEFT';
    return DEFAULT_DIR;
  }

  function tileScreenClient(r, c) {
    const cell = snap.map.cells[r]?.[c];
    if (!cell) return null;
    const wy = toWorldRow(r, snap.map.rows);
    const z = tileHeight(cell);
    cam.project(c, wy, z, proj);
    const rect = canvas.getBoundingClientRect();
    const sx = rect.left + (proj.x / canvas.width) * rect.width;
    const sy = rect.top + (proj.y / canvas.height) * rect.height;
    const s = (proj.s / canvas.width) * rect.width;
    return { x: sx, y: sy, s };
  }

  function beginFacingDeploy(opId, r, c) {
    const h = snap.hand.find((x) => x.id === opId);
    if (!h?.ready) {
      setHint('干员未就绪');
      return;
    }
    const centre = tileScreenClient(r, c);
    if (!centre) {
      setHint('无效格子');
      return;
    }
    pendingDeployOp = opId;
    pendingTile = { r, c };
    facingPreview = defaultDeployDir(c);
    facingOpen = true;
    selectedOp = opId;
    hoverCell = { r, c };
    spines?.setDeployGhost?.(opId, r, c, facingPreview);
    spines?.sync?.(spineSnap(), 0);
    draw();
    setHint('拖出中心选朝向 · 松手部署 · 松在中心 / Esc 取消');
    openFacingOverlay({
      host: document.body,
      centre,
      defaultDir: facingPreview,
      onPreview: (dir) => {
        facingPreview = dir || defaultDeployDir(c);
        spines?.setGhostDir?.(facingPreview);
        spines?.sync?.(spineSnap(), 0);
        draw();
      },
      onCommit: (dir) => {
        facingOpen = false;
        const d = dir || defaultDeployDir(c);
        spines?.clearDeployGhost?.();
        commitDeploy(opId, r, c, d);
      },
      onCancel: () => {
        facingOpen = false;
        pendingDeployOp = null;
        pendingTile = null;
        facingPreview = null;
        spines?.clearDeployGhost?.();
        spines?.sync?.(spineSnap(), 0);
        hoverCell = null;
        setHint(selectedOp ? '再点格子部署，或重新拖放' : '已取消部署');
        renderHand(true);
        draw();
      },
    });
  }

  /** Drain sim events after proxies exist (sync → push → update). */
  function flushFx() {
    const ev = battle.drainEvents?.() || [];
    if (!ev.length || !spines) return;
    spines.sync?.(spineSnap(), 0);
    spines.pushEvents?.(ev);
    flushBattleSfx(ev);
  }

  function shakeStage() {
    const stage = root.querySelector('#batStage');
    if (!stage) return;
    stage.classList.remove('is-reject');
    void stage.offsetWidth;
    stage.classList.add('is-reject');
    window.setTimeout(() => stage.classList.remove('is-reject'), 380);
  }

  function commitDeploy(opId, r, c, dir) {
    const res = battle.deploy(opId, r, c, dir);
    snap = battle.snapshot();
    pendingDeployOp = null;
    pendingTile = null;
    facingPreview = null;
    if (!res.ok) {
      const msg = res.error === 'cost' ? `费用不足（当前 ${snap.cost}）`
        : res.error === 'occupied' ? '格子已被占用'
        : res.error === 'owner down' ? '召唤者未在场，无法部署'
        : res.error === 'token cap' ? '召唤物数量已满或冷却中'
        : res.error === 'deploy limit' ? '部署位已满'
        : res.error?.startsWith?.('need') ? '部署位类型不符'
        : `部署失败：${res.error}`;
      setHint(msg);
      shakeStage();
    } else {
      setHint('已部署');
      selectedOp = null;
      selectedUnitId = null;
      flushFx();
    }
    renderHand(true);
    renderUnitPanel(true);
    draw();
  }

  function doRetreat(unitId) {
    const res = battle.retreat(unitId);
    snap = battle.snapshot();
    if (res.ok) {
      if (selectedUnitId === unitId) selectedUnitId = null;
      setHint('已撤退（返还一半费用，进入再部署）');
      flushFx();
    }
    renderHand(true);
    renderUnitPanel(true);
    draw();
  }

  function doSkill(unitId) {
    const res = battle.castSkill(unitId);
    snap = battle.snapshot();
    if (!res.ok) {
      setHint(res.error === 'sp' ? '技力不足' : res.error === 'active' ? '技能已开启' : '无法释放');
    } else {
      setHint('技能已开启');
      flushFx();
    }
    renderUnitPanel(true);
    draw();
  }

  function eliteOf(opId) {
    const hand = snap.hand.find((h) => h.id === opId);
    if (hand?.kind === 'token' && hand.ownerId) {
      return opts.squad.find((s) => s.id === hand.ownerId)?.loadout?.elite
        ?? (opts.borrow?.id === hand.ownerId ? opts.borrow.loadout?.elite : null)
        ?? 2;
    }
    return opts.squad.find((s) => s.id === opId)?.loadout?.elite
      ?? (opts.borrow?.id === opId ? opts.borrow.loadout?.elite : null)
      ?? 2;
  }

  function posLabel(position) {
    if (position === 'RANGED') return '高台';
    if (position === 'ALL') return '全部位';
    return '地面';
  }

  function renderUnderframe(force = false) {
    const host = root.querySelector('#batUnderframe');
    const u = selectedUnitId != null
      ? snap.units.find((x) => x.id === selectedUnitId && x.alive !== false && !x.dying)
      : null;
    const sig = u
      ? `${u.id}:${u.r},${u.c}:${u.skillReady ? 1 : 0}:${u.skillOn ? 1 : 0}:${u.skillToggle ? 1 : 0}:${u.skillId || ''}:${facingOpen ? 1 : 0}`
      : '';
    if (!force && sig === underframeSig) return;
    underframeSig = sig;
    if (!u || facingOpen) {
      host.hidden = true;
      host.replaceChildren();
      return;
    }
    const centre = tileScreenClient(u.r, u.c);
    if (!centre) {
      host.hidden = true;
      host.replaceChildren();
      return;
    }
    const half = Math.max(36, centre.s * 1.05);
    host.hidden = false;
    host.style.cssText = [
      `position:fixed`,
      `left:${centre.x}px`,
      `top:${centre.y}px`,
      `width:${half * 2}px`,
      `height:${half * 2}px`,
      `transform:translate(-50%,-50%)`,
      `z-index:12`,
      `pointer-events:none`,
    ].join(';');
    const canSkill = u.skillType === 'MANUAL' && u.maxSp > 0;
    const skIcon = u.skillId ? (assets.skillIcon?.(u.skillId) || '') : '';
    const skTitle = u.skillToggle ? '关闭技能' : u.skillReady ? '开技能' : u.skillOn ? '技能中' : '技力不足';
    const skLabel = u.skillToggle ? '关闭' : u.skillOn ? '技能中' : '技能';
    host.innerHTML = `
      <svg class="cc-uframe__dia" viewBox="-110 -110 220 220" aria-hidden="true">
        <path class="cc-uframe__outer" d="M0 -100 L100 0 L0 100 L-100 0 Z" />
        <path class="cc-uframe__corner" d="M-100 0 L-86 -14 M-100 0 L-86 14 M100 0 L86 -14 M100 0 L86 14 M0 -100 L-14 -86 M0 -100 L14 -86 M0 100 L-14 86 M0 100 L14 86" />
      </svg>
      <button type="button" class="cc-uframe__btn cc-uframe__btn--retreat" id="batUfRetreat" title="撤退">
        <span class="cc-uframe__glyph" aria-hidden="true">↩</span>
        <span class="cc-uframe__label">撤退</span>
      </button>
      ${canSkill ? `
      <button type="button" class="cc-uframe__btn cc-uframe__btn--skill${u.skillReady ? ' is-ready' : ''}${u.skillOn ? ' is-on' : ''}"
        id="batUfSkill" title="${escapeAttr(skTitle)}" ${u.skillReady ? '' : 'disabled'}>
        <span class="cc-uframe__plate" aria-hidden="true">
          ${skIcon ? `<img src="${escapeAttr(skIcon)}" alt=""/>` : '技'}
          ${u.skillReady && !u.skillToggle && uiSkillReady ? `<img class="cc-uframe__ready" src="${escapeAttr(uiSkillReady)}" alt=""/>` : ''}
        </span>
        <span class="cc-uframe__label">${escape(skLabel)}</span>
      </button>` : ''}
    `;
    host.querySelector('#batUfRetreat')?.addEventListener('click', (ev) => {
      ev.stopPropagation();
      doRetreat(u.id);
    });
    host.querySelector('#batUfSkill')?.addEventListener('click', (ev) => {
      ev.stopPropagation();
      doSkill(u.id);
    });
  }

  function renderUnitPanel(force = false) {
    const panel = root.querySelector('#batUnitPanel');
    const u = selectedUnitId != null
      ? snap.units.find((x) => x.id === selectedUnitId && x.alive !== false && !x.dying)
      : null;
    if (selectedUnitId != null && !u) selectedUnitId = null;
    const sig = u ? `${u.id}:${u.sp}:${u.skillOn}:${u.hp}:${u.skillReady ? 1 : 0}` : '';
    if (!force && sig === unitPanelSig) return;
    unitPanelSig = sig;
    if (!u) {
      panel.hidden = true;
      panel.replaceChildren();
      renderUnderframe(true);
      return;
    }
    panel.hidden = false;
    const elite = eliteOf(u.opId);
    const portrait = crisisPortraitUrl(u.opId, { e2: elite >= 2 });
    const hpPct = Math.max(0, Math.min(100, Math.round((u.hp / Math.max(1, u.maxHp)) * 100)));
    const spPct = u.maxSp > 0 ? Math.max(0, Math.min(100, Math.round((u.sp / u.maxSp) * 100))) : 0;
    const prof = u.kind === 'token'
      ? (u.profession === 'TRAP' ? '装置' : '召唤')
      : (PROF_LABEL[u.profession] || u.profession || '');
    const pos = posLabel(u.position);
    const skType = u.skillType === 'AUTO' ? '自动' : u.skillType === 'MANUAL' ? '手动' : '';
    panel.innerHTML = `
      <button type="button" class="cc-dpanel__close" id="batPanelClose" aria-label="关闭">✕</button>
      <div class="cc-dpanel__scroll">
        <div class="cc-dhead">
          <div class="cc-dhead__art"><img alt="" src="${escapeAttr(portrait)}" onerror="this.style.visibility='hidden'"/></div>
          <div class="cc-dhead__info">
            <div class="cc-dhead__chips">
              ${elite >= 2 ? '<span class="cc-dtag-elite">精二</span>' : elite >= 1 ? '<span class="cc-dtag-elite">精一</span>' : ''}
              <span class="cc-dtag-pos">${escape(pos)}</span>
            </div>
            <div class="cc-dhead__name">${escape(u.name)}</div>
            <div class="cc-dhead__class">${escape(prof)}${prof && skType ? ' · ' : ''}${escape(skType)}</div>
            <div class="cc-dhp" title="生命"><i style="width:${hpPct}%"></i><span>${u.hp}/${u.maxHp}</span></div>
            <div class="cc-dsp${u.skillOn ? ' is-active' : u.skillReady ? ' is-ready' : ''}" title="技力">
              <i style="width:${spPct}%"></i>
              <span>SP ${u.sp}/${u.maxSp}${u.skillOn ? ' · 开启' : ''}</span>
            </div>
          </div>
        </div>
        <div class="cc-dskill">
          <div class="cc-dskill__name">${u.skillName ? escape(u.skillName) : '无技能'}</div>
          <div class="cc-dskill__meta">${u.skillToggle ? '点击关闭' : u.skillReady ? '可开启' : u.skillOn ? '技能持续中' : u.skillType === 'AUTO' ? '自动触发' : '蓄力中'}</div>
        </div>
        <div class="cc-dpanel__actions">
          <button type="button" class="cc-btn cc-btn--skill" id="batSkill" ${u.skillReady ? '' : 'disabled'}>${u.skillToggle ? '关闭技能' : '开技能'}</button>
          <button type="button" class="cc-btn danger" id="batRetreat">撤退</button>
        </div>
      </div>
    `;
    panel.querySelector('#batPanelClose')?.addEventListener('click', () => {
      selectedUnitId = null;
      renderUnitPanel(true);
      draw();
    });
    panel.querySelector('#batSkill')?.addEventListener('click', () => doSkill(u.id));
    panel.querySelector('#batRetreat')?.addEventListener('click', () => doRetreat(u.id));
    renderUnderframe(true);
  }

  function pickCell(ev) {
    const rect = canvas.getBoundingClientRect();
    const sx = (ev.clientX - rect.left) * (canvas.width / rect.width);
    const sy = (ev.clientY - rect.top) * (canvas.height / rect.height);
    // Unproject onto ground plane z=0, then snap to nearest tile.
    if (!cam.unproject(sx, sy, 0, unp)) return { r: -1, c: -1 };
    const c = Math.round(unp.x);
    const worldR = Math.round(unp.y);
    const r = toMapRow(worldR, snap.map.rows);
    if (r < 0 || c < 0 || r >= snap.map.rows || c >= snap.map.cols) return { r: -1, c: -1 };
    return { r, c };
  }

  /** Nearest living operator by screen proximity (spines sit on tile centres). */
  function pickUnitAt(clientX, clientY) {
    let best = null;
    let bestD = 42;
    for (const u of snap.units || []) {
      if (u.alive === false || u.dying) continue;
      const sc = tileScreenClient(u.r, u.c);
      if (!sc) continue;
      const d = Math.hypot(clientX - sc.x, clientY - sc.y);
      if (d < bestD) {
        bestD = d;
        best = u;
      }
    }
    return best;
  }

  function setHint(msg) {
    root.querySelector('#batHint').textContent = msg;
  }

  function opAvatar(id) {
    const elite = opts.squad.find((s) => s.id === id)?.loadout?.elite
      ?? (opts.borrow?.id === id ? opts.borrow.loadout?.elite : null)
      ?? 2;
    const url = crisisAvatarUrl(id, { e2: elite >= 2 });
    void loadImage(url);
    return peekImage(url);
  }

  function enemyIcon(key) {
    const url = crisisEnemyIconUrl(key);
    void loadImage(url);
    return peekImage(url);
  }

  function renderHand(force = false) {
    const costNow = snap.cost | 0;
    const sig = `${selectedOp}|${dragOpId}|${snap.status}|${costNow}|${snap.hand.map((h) => `${h.id}:${h.kind || 'op'}:${h.ready ? 1 : 0}:${h.cdLeft|0}:${h.cost}:${h.available ?? ''}`).join(',')}`;
    if (!force && sig === handSig) return;
    handSig = sig;
    const box = root.querySelector('#batHand');
    box.replaceChildren();
    for (const h of snap.hand) {
      const btn = document.createElement('button');
      btn.type = 'button';
      const isToken = h.kind === 'token';
      const afford = h.ready && costNow >= (h.cost | 0);
      const broke = h.ready && costNow < (h.cost | 0);
      btn.className = [
        'cc-bat__card',
        selectedOp === h.id || dragOpId === h.id ? 'is-on' : '',
        h.ready ? '' : 'is-cd',
        broke ? 'is-broke' : '',
        afford ? 'is-afford' : '',
        h.borrow ? 'is-borrow' : '',
        isToken ? 'is-token' : '',
      ].filter(Boolean).join(' ');
      btn.setAttribute('role', 'listitem');
      const elite = eliteOf(h.id);
      const url = crisisAvatarUrl(h.id, { e2: !isToken && elite >= 2 });
      const prof = isToken
        ? (h.profession === 'TRAP' ? '装置' : '召唤')
        : (PROF_LABEL[h.profession] || '');
      const pos = posLabel(h.position);
      const cd = !h.ready && h.cdLeft > 0 ? `${h.cdLeft}s` : '';
      const stack = isToken && Number.isFinite(h.available)
        ? `<em class="cc-bat__stack" title="可部署 / 手牌上限">${h.available}/${h.copies | 0}</em>`
        : '';
      btn.innerHTML = `
        <span class="cc-bat__card-cost${broke ? ' is-broke' : ''}" title="部署费用">${h.cost}</span>
        ${h.borrow ? '<em class="cc-bat__borrow">助</em>' : ''}
        ${isToken ? '<em class="cc-bat__tok">召</em>' : ''}
        ${stack}
        <span class="cc-bat__card-art"><img alt="" draggable="false" src="${escapeAttr(url)}" onerror="this.style.visibility='hidden'"/></span>
        <span class="cc-bat__card-meta">
          <b>${escape(h.name)}</b>
          <span>${escape(prof || pos)}${cd ? ` · ${cd}` : ''}${broke ? ' · 费用不足' : ''}${!h.ready && isToken && !cd ? ' · 召唤者未在场' : ''}</span>
        </span>
        ${cd ? `<span class="cc-bat__card-cd">${cd}</span>` : ''}
      `;
      // Allow select when ready but broke (show tip); block deploy via commitDeploy
      btn.disabled = !h.ready || snap.status !== 'running' || facingOpen;
      btn.title = !h.ready
        ? (isToken
          ? `${h.name} · ${cd ? `冷却 ${cd}` : '需召唤者在场'}`
          : `${h.name} · 再部署 ${cd || '…'}`)
        : broke
          ? `${h.name} · 需要 ${h.cost} 费（当前 ${costNow}）`
          : `${h.name} · ${h.cost}费 · ${pos} · 点选或拖放到格子`;
      btn.addEventListener('pointerdown', (ev) => {
        if (btn.disabled) return;
        if (broke) {
          setHint(`费用不足：${h.name} 需要 ${h.cost}（当前 ${costNow}）`);
          shakeStage();
          return;
        }
        ev.preventDefault();
        try { btn.setPointerCapture(ev.pointerId); } catch { /* */ }
        beginHandPress(h.id, ev);
      });
      box.appendChild(btn);
    }
  }

  function fillTile(r, c, fill, stroke, lineW = 2) {
    const cell = snap.map.cells[r]?.[c];
    if (!cell) return;
    const wy = toWorldRow(r, snap.map.rows);
    const z = tileHeight(cell);
    const corners = [
      [c - 0.45, wy - 0.45], [c + 0.45, wy - 0.45],
      [c + 0.45, wy + 0.45], [c - 0.45, wy + 0.45],
    ].map(([x, y]) => {
      cam.project(x, y, z, proj);
      return { x: proj.x, y: proj.y };
    });
    ctx.beginPath();
    ctx.moveTo(corners[0].x, corners[0].y);
    for (let i = 1; i < 4; i++) ctx.lineTo(corners[i].x, corners[i].y);
    ctx.closePath();
    if (fill) { ctx.fillStyle = fill; ctx.fill(); }
    if (stroke) {
      ctx.strokeStyle = stroke;
      ctx.lineWidth = lineW;
      ctx.stroke();
      ctx.lineWidth = 1;
    }
  }

  /** Official battleUi/attack_range_* diamond over a tile (fallback: fillTile). */
  function paintRangeTile(r, c, kind) {
    const cell = snap.map.cells[r]?.[c];
    if (!cell) return;
    const url = kind === 'stand' ? uiRangeStand : uiRangeAtk;
    const img = url ? peekImage(url) : null;
    const wy = toWorldRow(r, snap.map.rows);
    const z = tileHeight(cell) + 0.01;
    cam.project(c, wy, z, proj);
    if (img) {
      const s = Math.max(22, proj.s * 0.95);
      ctx.save();
      ctx.globalAlpha = kind === 'stand' ? 0.88 : 0.78;
      ctx.drawImage(img, proj.x - s / 2, proj.y - s * 0.55, s, s * 0.72);
      ctx.restore();
      return;
    }
    fillTile(
      r, c,
      kind === 'stand' ? 'rgba(80,200,140,0.22)' : 'rgba(255,200,80,0.18)',
      kind === 'stand' ? 'rgba(100,255,180,0.9)' : 'rgba(255,210,100,0.55)',
      1.5,
    );
  }

  function drawRange(anchorR, anchorC, facing, grids, fill, stroke, kind = 'atk') {
    const dir = normDir(facing);
    for (const g of grids || []) {
      // dir.js: row 0 = bottom; Crisis map: row 0 = top → flip row.
      const [dr, dc] = rotateOffset(g.row | 0, g.col | 0, dir);
      const rr = anchorR - dr;
      const cc = anchorC + dc;
      if (rr < 0 || cc < 0 || rr >= snap.map.rows || cc >= snap.map.cols) continue;
      if (uiRangeStand || uiRangeAtk) paintRangeTile(rr, cc, kind === 'stand' ? 'stand' : 'atk');
      else fillTile(rr, cc, fill, stroke, 1.5);
    }
  }

  function drawFaceChevron(r, c, facing) {
    const cell = snap.map.cells[r]?.[c];
    if (!cell) return;
    const dir = normDir(facing);
    // DIR_VEC is bottom-origin (+row = toward screen top = +world Y). World already matches.
    const [dRow, dCol] = DIR_VEC[dir] || DIR_VEC.RIGHT;
    const wy = toWorldRow(r, snap.map.rows);
    const z = tileHeight(cell) + 0.05;
    cam.project(c + dCol * 0.38, wy + dRow * 0.38, z, proj);
    const tip = { x: proj.x, y: proj.y };
    const baseX = c + dCol * 0.05;
    const baseY = wy + dRow * 0.05;
    const orthoR = dCol !== 0 ? 0.18 : 0;
    const orthoC = dRow !== 0 ? 0.18 : 0;
    cam.project(baseX - orthoC, baseY - orthoR, z, proj);
    const p0 = { x: proj.x, y: proj.y };
    cam.project(baseX + orthoC, baseY + orthoR, z, proj);
    const p1 = { x: proj.x, y: proj.y };
    ctx.beginPath();
    ctx.moveTo(tip.x, tip.y);
    ctx.lineTo(p0.x, p0.y);
    ctx.lineTo(p1.x, p1.y);
    ctx.closePath();
    ctx.fillStyle = 'rgba(255, 220, 120, 0.9)';
    ctx.fill();
  }

  function draw() {
    const m = snap.map;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    barsCtx.clearRect(0, 0, barsCanvas.width, barsCanvas.height);

    if (!board3d) {
      const bg = boardBgUrl ? peekImage(boardBgUrl) : null;
      if (bg) {
        ctx.globalAlpha = 0.55;
        ctx.drawImage(bg, 0, 0, canvas.width, canvas.height);
        ctx.globalAlpha = 1;
      } else {
        ctx.fillStyle = '#0a1016';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
      }
    }

    // Deployable tiles (while dragging / facing) — under Spine
    const deployOp = pendingDeployOp || dragOpId || selectedOp;
    if (deployOp) {
      const h = snap.hand.find((x0) => x0.id === deployOp);
      const occupied = new Set(snap.units.filter((u) => u.alive !== false && !u.dying).map((u) => `${u.r},${u.c}`));
      for (let r = 0; r < m.rows; r++) {
        for (let c = 0; c < m.cols; c++) {
          const cell = m.cells[r][c];
          if (!tileAccepts(h?.position, cell.buildableType)) continue;
          const busy = occupied.has(`${r},${c}`);
          fillTile(
            r, c,
            busy ? 'rgba(180,40,40,0.28)' : 'rgba(61,139,253,0.2)',
            busy ? 'rgba(255,120,120,0.9)' : 'rgba(120,180,255,0.95)',
          );
        }
      }
      const ghost = pendingTile || hoverCell;
      if (ghost && h?.rangeGrids) {
        const dir = facingPreview || defaultDeployDir(ghost.c);
        paintRangeTile(ghost.r, ghost.c, 'stand');
        drawRange(ghost.r, ghost.c, dir, h.rangeGrids, 'rgba(255,200,80,0.18)', 'rgba(255,210,100,0.55)', 'atk');
        drawFaceChevron(ghost.r, ghost.c, dir);
      }
    }

    // Selected field unit: tile ring + attack range (ground)
    const sel = selectedUnitId != null
      ? snap.units.find((x) => x.id === selectedUnitId && (x.alive !== false) && !x.dying)
      : null;
    if (sel) {
      paintRangeTile(sel.r, sel.c, 'stand');
      const facing = sel.dir || (sel.face === -1 ? 'LEFT' : 'RIGHT');
      drawRange(sel.r, sel.c, facing, sel.rangeGrids, 'rgba(255,200,80,0.16)', 'rgba(255,210,100,0.5)', 'atk');
      drawFaceChevron(sel.r, sel.c, facing);
    }

    const useSpine = !!spines;
    for (const u of snap.units) {
      const cell = m.cells[u.r]?.[u.c];
      const w = simToWorld(u.c, u.r, m.rows);
      cam.project(w.x, w.y, tileHeight(cell) + 0.02, proj);
      if (!useSpine && !u.dying) {
        const size = Math.max(28, proj.s * 0.7);
        const img = opAvatar(u.opId);
        ctx.save();
        roundClip(ctx, proj.x - size / 2, proj.y - size * 0.9, size, size, 6);
        if (img) ctx.drawImage(img, proj.x - size / 2, proj.y - size * 0.9, size, size);
        else {
          ctx.fillStyle = '#3fa66b';
          ctx.fillRect(proj.x - size / 2, proj.y - size * 0.9, size, size);
        }
        ctx.restore();
      }
      if (u.dying) continue;
      // Bars above Spine (batBars) — official slider_hp_* when present
      const bw = Math.max(28, proj.s * 0.72);
      const bx = proj.x - bw / 2;
      const by = proj.y - proj.s * 1.05;
      const hpRatio = u.maxHp ? u.hp / u.maxHp : 0;
      drawHpBar(barsCtx, bx, by, bw, hpRatio, 6);
      if (u.maxSp > 0) {
        const spReady = u.skillReady && !u.skillToggle;
        drawUnitBar(barsCtx, bx, by + 8, bw, u.sp / u.maxSp, spReady ? '#ffe066' : '#6fd3ff', 3);
      }
      if (u.skillReady && !u.skillToggle && uiSkillReady) {
        const badge = peekImage(uiSkillReady);
        if (badge) {
          const bs = Math.max(18, proj.s * 0.38);
          barsCtx.drawImage(badge, proj.x - bs / 2, by - bs - 2, bs, bs);
        }
      }
      if (selectedUnitId === u.id) {
        barsCtx.beginPath();
        barsCtx.arc(proj.x, proj.y - proj.s * 0.12, proj.s * 0.3, 0, Math.PI * 2);
        barsCtx.strokeStyle = 'rgba(100,255,180,0.9)';
        barsCtx.lineWidth = 2.5;
        barsCtx.stroke();
        barsCtx.lineWidth = 1;
      }
    }
    for (const e of snap.enemies) {
      if (e.dying) continue;
      const vis = enemyVis.get(e.id) || e;
      const mr = Math.floor(vis.y);
      const mc = Math.floor(vis.x);
      const cell = m.cells[mr]?.[mc];
      const w = simToWorld(vis.x, vis.y, m.rows);
      cam.project(w.x, w.y, tileHeight(cell) + 0.02, proj);
      if (!useSpine) {
        const size = Math.max(24, proj.s * 0.55);
        const img = enemyIcon(e.key);
        ctx.save();
        ctx.beginPath();
        ctx.arc(proj.x, proj.y - size * 0.2, size / 2, 0, Math.PI * 2);
        ctx.closePath();
        ctx.clip();
        if (img) ctx.drawImage(img, proj.x - size / 2, proj.y - size * 0.7, size, size);
        else {
          ctx.fillStyle = '#d4a017';
          ctx.fillRect(proj.x - size / 2, proj.y - size * 0.7, size, size);
        }
        ctx.restore();
      }
      const er = e.maxHp ? e.hp / e.maxHp : 1;
      if (er < 0.999) {
        const bw = Math.max(22, proj.s * 0.55);
        drawHpBar(barsCtx, proj.x - bw / 2, proj.y - proj.s * 0.92, bw, er, 5, true);
      }
    }
  }

  /** Official battleUi slider, else flat bar. */
  function drawHpBar(g, x, y, w, ratio, h = 5, enemy = false) {
    const r = Math.max(0, Math.min(1, ratio));
    const back = uiHpBack ? peekImage(uiHpBack) : null;
    const fill = uiHpFill ? peekImage(uiHpFill) : null;
    if (back && fill) {
      g.drawImage(back, x - 1, y - 1, w + 2, h + 2);
      if (r > 0.01) {
        g.save();
        g.beginPath();
        g.rect(x, y, w * r, h);
        g.clip();
        if (enemy) g.filter = 'hue-rotate(-50deg) saturate(1.4)';
        g.drawImage(fill, x - 1, y - 1, w + 2, h + 2);
        g.restore();
      }
      return;
    }
    drawUnitBar(g, x, y, w, r, enemy ? '#ff4b3e' : (r < 0.3 ? '#e8c547' : '#5fe07a'), h);
  }

  /** 卫戍风格血条：深底 + 描边 + 实心填充 */
  function drawUnitBar(g, x, y, w, ratio, color, h = 4) {
    const r = Math.max(0, Math.min(1, ratio));
    g.fillStyle = 'rgba(0,0,0,0.72)';
    g.fillRect(x - 1, y - 1, w + 2, h + 2);
    g.strokeStyle = 'rgba(255,255,255,0.18)';
    g.strokeRect(x - 0.5, y - 0.5, w + 1, h + 1);
    g.fillStyle = color;
    g.fillRect(x, y, w * r, h);
  }

  /** Light battle cues (reuse 卫戍 audio bank when unlocked; silent no-op otherwise). */
  function playBattleCue(ev) {
    try {
      if (ev.type === 'deploy' && ev.opId) {
        audio.deployCue?.({ def: ev.opId, kind: 'op' }, ev.id ?? ev.opId);
        return;
      }
      if (ev.type === 'skill' && !ev.off) {
        if (ev.opId) audio.unit?.(ev.opId, 'skill', ev.id ?? ev.opId);
        else audio.sfx?.('skillReady');
        return;
      }
      if (ev.type === 'hit' || ev.type === 'atk') {
        const id = ev.fromWho === 'enemy' ? ev.fromId : (ev.opId || ev.fromId);
        if (ev.fromWho === 'op' && typeof ev.fromId === 'number') {
          const u = snap.units.find((x) => x.id === ev.fromId);
          if (u?.opId) audio.unit?.(u.opId, 'attack', ev.fromId);
        } else if (ev.fromWho === 'enemy') {
          audio.unit?.(String(ev.key || ev.fromId), 'attack', ev.fromId);
        }
        void id;
        return;
      }
      if (ev.type === 'die') {
        if (ev.who === 'op' && ev.opId) audio.unit?.(ev.opId, 'die', ev.id);
        else if (ev.key) audio.unit?.(ev.key, 'die', ev.id);
      }
    } catch { /* audio optional in /crisis/ */ }
  }

  function flushBattleSfx(events) {
    for (const ev of events || []) playBattleCue(ev);
  }

  function renderEndPanel(force = false) {
    const host = root.querySelector('#batEnd');
    if (!host) return;
    const done = snap.status === 'won' || snap.status === 'lost';
    const sig = done ? `${snap.status}:${snap.killed}:${snap.leaked}:${snap.life}:${riskLabel}` : '';
    if (!force && sig === endPanelSig) return;
    endPanelSig = sig;
    if (!done) {
      host.hidden = true;
      host.replaceChildren();
      return;
    }
    const ok = snap.status === 'won';
    const banner = ok ? uiSettleWin : uiSettleLose;
    host.hidden = false;
    host.innerHTML = `
      <div class="cc-bat__end-card${ok ? ' is-win' : ' is-lose'}">
        ${banner ? `<img class="cc-bat__end-banner" alt="" src="${escapeAttr(banner)}"/>` : ''}
        <div class="cc-bat__end-kicker">${ok ? 'MISSION COMPLETE' : 'MISSION FAILED'}</div>
        <div class="cc-bat__end-title">${ok ? '行动成功' : '行动失败'}</div>
        <div class="cc-bat__end-sub">${ok ? '蓝门守住' : '蓝门失守'} · 风险 ${riskLabel}</div>
        <dl class="cc-bat__end-stats">
          <div><dt>风险</dt><dd>${riskLabel}</dd></div>
          <div><dt>击杀</dt><dd>${snap.killed | 0}</dd></div>
          <div><dt>漏敌</dt><dd>${snap.leaked | 0}</dd></div>
          <div><dt>剩余生命</dt><dd>${snap.life | 0}</dd></div>
          <div><dt>用时</dt><dd>${snap.time.toFixed(1)}s</dd></div>
        </dl>
        <div class="cc-bat__end-actions">
          <button type="button" class="cc-btn" id="batEndExit">返回整备</button>
        </div>
      </div>
    `;
    host.querySelector('#batEndExit')?.addEventListener('click', () => {
      root.querySelector('#batExit')?.click();
    });
  }

  function hud() {
    const lifeEl = root.querySelector('#batLife');
    const lpBox = root.querySelector('#batLp');
    lifeEl.textContent = String(snap.life);
    lpBox.classList.toggle('is-danger', snap.life <= 2);
    if (snap.life < lastLife) {
      lpBox.classList.remove('is-leak');
      void lpBox.offsetWidth;
      lpBox.classList.add('is-leak');
      window.setTimeout(() => lpBox.classList.remove('is-leak'), 520);
    }
    lastLife = snap.life;

    const cost = snap.cost | 0;
    root.querySelector('#batCost').textContent = String(cost);
    root.querySelector('#batCostMax').textContent = `/${snap.maxCost | 0}`;
    // Glow when at least one ready hand card is affordable (battle_cost_panel feel)
    const canAfford = (snap.hand || []).some((h) => h.ready && cost >= (h.cost | 0));
    root.querySelector('#batDp')?.classList.toggle('is-ready', canAfford && snap.status === 'running');

    root.querySelector('#batKill').textContent = String(snap.killed | 0);
    root.querySelector('#batRemain').textContent = String(snap.remaining | 0);
    root.querySelector('#batLeak').textContent = `漏 ${snap.leaked | 0}`;
    root.querySelector('#batTime').textContent = `${snap.time.toFixed(1)}s`;
    const riskVal = root.querySelector('#batRiskVal');
    if (riskVal) riskVal.textContent = String(riskLabel);

    if (snap.status !== lastStatus) {
      lastStatus = snap.status;
      renderEndPanel(true);
    } else {
      renderEndPanel();
    }
  }

  function smoothEnemies(dt) {
    const live = new Set();
    const k = Math.min(1, dt * 14 * Math.max(1, speed));
    for (const e of snap.enemies || []) {
      live.add(e.id);
      const prev = enemyVis.get(e.id);
      if (!prev) {
        enemyVis.set(e.id, { x: e.x, y: e.y });
        continue;
      }
      prev.x += (e.x - prev.x) * k;
      prev.y += (e.y - prev.y) * k;
    }
    for (const id of enemyVis.keys()) {
      if (!live.has(id)) enemyVis.delete(id);
    }
  }

  function spineSnap() {
    if (!enemyVis.size) return snap;
    return {
      ...snap,
      enemies: (snap.enemies || []).map((e) => {
        const v = enemyVis.get(e.id);
        return v ? { ...e, x: v.x, y: v.y } : e;
      }),
    };
  }

  function frame(ts) {
    raf = requestAnimationFrame(frame);
    if (!lastTs) lastTs = ts;
    const dt = Math.min(0.05, (ts - lastTs) / 1000);
    lastTs = ts;
    const fxBucket = [];
    if (!paused && !facingOpen && snap.status === 'running') {
      acc += dt * speed;
      while (acc >= battle.DT) {
        acc -= battle.DT;
        snap = battle.tick();
        const ev = battle.drainEvents?.() || [];
        if (ev.length) fxBucket.push(...ev);
        if (snap.status !== 'running') break;
      }
    }
    smoothEnemies(dt);
    hud();
    renderHand();
    renderUnitPanel();
    renderUnderframe();
    draw();
    board3d?.render();
    // Advance Spine + FxSystem on battle clock (×speed) like 卫戍.
    // Proxies must exist before pushEvents (CombatFxBridge sync → push → update).
    const spineDt = (paused || facingOpen) ? 0 : dt * speed;
    spines?.setSpeed?.(speed);
    spines?.sync(spineSnap(), spineDt);
    if (fxBucket.length) {
      spines?.pushEvents?.(fxBucket);
      flushBattleSfx(fxBucket);
    }
    spines?.updateFx?.(spineDt);
  }

  renderHand(true);
  renderUnitPanel(true);
  renderUnderframe(true);
  draw();
  hud();
  board3d?.render();
  spines?.sync(snap, 0);
  spines?.pushEvents?.(battle.drainEvents?.() || []);
  raf = requestAnimationFrame(frame);

  return () => {
    cancelAnimationFrame(raf);
    window.removeEventListener('resize', onResize);
    spines?.destroy();
    board3d?.destroy();
    clearDragGhost();
    unlockPage();
  };
}

function drawTile(ctx, x, y, cell, cellData) {
  const pad = 1;
  const w = cell - pad;
  const h = cell - pad;
  const highland = cellData.heightType === 'HIGHLAND';
  // Palette closer to classic Arknights tilemap (ground dirt / highland stone).
  let fill = '#141a22';
  switch (cellData.tileKey) {
    case 'tile_forbidden':
      fill = '#0a0e14';
      break;
    case 'tile_wall':
      fill = '#5c6674';
      break;
    case 'tile_road':
    case 'tile_floor':
      fill = highland ? '#6e7886' : '#8a7348';
      break;
    case 'tile_start':
      fill = '#9a3a42';
      break;
    case 'tile_end':
      fill = '#2f6fad';
      break;
    case 'tile_infection':
      fill = '#8a6a22';
      break;
    case 'tile_bigforce':
      fill = '#3d6b48';
      break;
    default:
      break;
  }
  ctx.fillStyle = fill;
  ctx.fillRect(x, y, w, h);
  // Subtle top edge for highland platforms
  if (highland && cellData.tileKey !== 'tile_forbidden') {
    ctx.fillStyle = 'rgba(255,255,255,0.12)';
    ctx.fillRect(x, y, w, 3);
  }
  if (cellData.buildableType === 'MELEE') {
    ctx.strokeStyle = 'rgba(210,190,120,0.35)';
    ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
  } else if (cellData.buildableType === 'RANGED') {
    ctx.strokeStyle = 'rgba(160,190,230,0.45)';
    ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
  }
  if (cellData.tileKey === 'tile_start' || cellData.tileKey === 'tile_end') {
    const isRed = cellData.tileKey === 'tile_start';
    ctx.fillStyle = isRed ? 'rgba(255,70,70,0.55)' : 'rgba(70,160,255,0.55)';
    ctx.beginPath();
    ctx.arc(x + w / 2, y + h / 2, w * 0.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.font = `bold ${Math.max(10, w * 0.28)}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(isRed ? '敌' : '我', x + w / 2, y + h / 2);
    ctx.textAlign = 'start';
    ctx.textBaseline = 'alphabetic';
  }
}

function roundClip(ctx, x, y, w, h, r) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
  ctx.clip();
}

function escape(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function escapeAttr(s) {
  return escape(s).replace(/"/g, '&quot;');
}
