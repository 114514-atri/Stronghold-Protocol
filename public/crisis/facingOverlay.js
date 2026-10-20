// public/crisis/facingOverlay.js — 卫戍 FacingWheel 的无 Preact 移植（几何 / 文案 / 松手规则一致）。
// Swipe past dead-zone → commit; release in centre / Esc / ✕ → cancel. Click chevron → commit that dir.

import { DIRS, DEAD_ZONE_TILES, DIR_LABEL, dirFromDelta, dirFromKey, normDir } from '../js/ui/facing.js';

/** Chevron centre (viewBox units) + rotation — same as FacingWheel. */
const CHEV = { UP: [0, -64, -90], RIGHT: [64, 0, 0], DOWN: [0, 64, 90], LEFT: [-64, 0, 180] };

/**
 * @param {{
 *   host: HTMLElement,
 *   centre: { x: number, y: number, s: number },
 *   defaultDir?: string,
 *   onPreview?: (dir: string|null) => void,
 *   onCommit: (dir: string) => void,
 *   onCancel: () => void,
 * }} opts
 */
export function openFacingOverlay(opts) {
  const { host, centre, onPreview, onCommit, onCancel } = opts;
  const fallbackDir = normDir(opts.defaultDir || 'RIGHT');
  const s = Math.max(28, centre.s || 40);
  const dead = s * DEAD_ZONE_TILES;
  const half = s * 1.5;
  const box = half * 2;

  const root = document.createElement('div');
  root.className = 'cc-facing';
  root.tabIndex = -1;
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-label', '选择朝向');
  root.style.cssText = 'position:fixed;inset:0;z-index:40;cursor:crosshair;touch-action:none;outline:none;';

  const dia = document.createElement('div');
  dia.className = 'cc-facing__dia';
  dia.style.cssText = `position:fixed;left:${centre.x}px;top:${centre.y}px;width:${box}px;height:${box}px;transform:translate(-50%,-50%);pointer-events:none;`;

  const dz = DEAD_ZONE_TILES / 1.5 * 100;
  let chevSvg = '';
  for (const d of DIRS) {
    const [x, y, rot] = CHEV[d];
    chevSvg += `<g class="cc-facing__chev" data-dir="${d}" transform="translate(${x} ${y}) rotate(${rot})">`
      + `<path d="M-9 -15 L3 0 L-9 15 L-3 15 L9 0 L-3 -15 Z"/></g>`;
  }
  dia.innerHTML = `
    <svg class="cc-facing__svg" viewBox="-110 -110 220 220" aria-hidden="true">
      <path class="cc-facing__outer" d="M0 -100 L100 0 L0 100 L-100 0 Z" />
      <path class="cc-facing__quad" data-quad="UP" d="M0 -100 L50 -50 L0 0 L-50 -50 Z" />
      <path class="cc-facing__quad" data-quad="RIGHT" d="M100 0 L50 50 L0 0 L50 -50 Z" />
      <path class="cc-facing__quad" data-quad="DOWN" d="M0 100 L-50 50 L0 0 L50 50 Z" />
      <path class="cc-facing__quad" data-quad="LEFT" d="M-100 0 L-50 -50 L0 0 L-50 50 Z" />
      <path class="cc-facing__inner" d="M0 ${-dz} L${dz} 0 L0 ${dz} L${-dz} 0 Z" />
      ${chevSvg}
    </svg>`;

  const cancelBtn = document.createElement('button');
  cancelBtn.type = 'button';
  cancelBtn.className = 'cc-facing__cancel';
  cancelBtn.innerHTML = '<span class="cc-facing__x">✕</span><span>点击取消</span>';
  cancelBtn.setAttribute('aria-label', '点击取消');

  const tips = document.createElement('div');
  tips.className = 'cc-facing__tip';
  tips.hidden = true;
  tips.setAttribute('role', 'status');
  tips.textContent = '拖回中心区域取消';

  dia.appendChild(cancelBtn);
  dia.appendChild(tips);
  root.appendChild(dia);

  /** Clickable hits over chevrons */
  const hits = {};
  for (const d of DIRS) {
    const el = document.createElement('button');
    el.type = 'button';
    el.className = 'cc-facing__hit';
    el.dataset.dir = d;
    el.setAttribute('aria-label', DIR_LABEL[d] || d);
    const off = {
      UP: [0, -half * 0.64],
      RIGHT: [half * 0.64, 0],
      DOWN: [0, half * 0.64],
      LEFT: [-half * 0.64, 0],
    }[d];
    el.style.cssText = `position:fixed;left:${centre.x + off[0]}px;top:${centre.y + off[1]}px;`;
    hits[d] = el;
    root.appendChild(el);
  }

  host.appendChild(root);
  try { root.focus({ preventScroll: true }); } catch { /* */ }

  /** @type {string|null} */
  let preview = null;
  let tracking = false;
  let originX = centre.x;
  let originY = centre.y;

  function paint() {
    for (const d of DIRS) {
      const on = preview === d;
      dia.querySelector(`.cc-facing__chev[data-dir="${d}"]`)?.classList.toggle('is-on', on);
      dia.querySelector(`.cc-facing__quad[data-quad="${d}"]`)?.classList.toggle('is-on', on);
      hits[d].classList.toggle('is-on', on);
    }
    tips.hidden = !(tracking && preview);
    root.classList.toggle('is-pressed', tracking);
    if (preview) root.dataset.dir = preview.toLowerCase();
    else delete root.dataset.dir;
  }

  function setPreview(dir) {
    const d = dir ? normDir(dir) : null;
    if (d === preview) return;
    preview = d;
    paint();
    onPreview?.(d);
  }

  function cleanup() {
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
    window.removeEventListener('keydown', onKey, true);
    root.remove();
  }

  function finishCommit(dir) {
    const d = dir || preview || fallbackDir;
    cleanup();
    onCommit(d);
  }

  function finishCancel() {
    cleanup();
    onCancel();
  }

  function choose(clientX, clientY) {
    return dirFromDelta(clientX - centre.x, clientY - centre.y, dead);
  }

  function insideDiamond(clientX, clientY) {
    return Math.abs(clientX - centre.x) + Math.abs(clientY - centre.y) <= half * 1.18;
  }

  function onMove(ev) {
    if (!tracking) return;
    setPreview(choose(ev.clientX, ev.clientY));
  }

  function onUp(ev) {
    if (!tracking) return;
    tracking = false;
    root.classList.remove('is-pressed');
    const d = choose(ev.clientX, ev.clientY);
    // Official: release in dead-zone cancels; outside commits.
    if (d) finishCommit(d);
    else finishCancel();
  }

  function onKey(ev) {
    if (ev.key === 'Escape') {
      ev.preventDefault();
      ev.stopImmediatePropagation();
      finishCancel();
      return;
    }
    const d = dirFromKey(ev.key);
    if (d) {
      ev.preventDefault();
      ev.stopImmediatePropagation();
      setPreview(d);
      return;
    }
    if (ev.key === 'Enter') {
      ev.preventDefault();
      ev.stopImmediatePropagation();
      if (preview) finishCommit(preview);
    }
  }

  for (const d of DIRS) {
    hits[d].addEventListener('pointerdown', (ev) => {
      ev.stopPropagation();
      finishCommit(d);
    });
  }

  root.addEventListener('pointerdown', (ev) => {
    if (ev.button != null && ev.button !== 0) { ev.preventDefault(); return; }
    if (ev.target === cancelBtn || cancelBtn.contains(/** @type {Node} */ (ev.target))) return;
    if (/** @type {HTMLElement} */ (ev.target).classList?.contains('cc-facing__hit')) return;
    ev.preventDefault();
    if (!insideDiamond(ev.clientX, ev.clientY)) {
      finishCancel();
      return;
    }
    tracking = true;
    originX = centre.x;
    originY = centre.y;
    try { root.setPointerCapture(ev.pointerId); } catch { /* */ }
    setPreview(choose(ev.clientX, ev.clientY));
  });

  cancelBtn.addEventListener('pointerdown', (ev) => ev.stopPropagation());
  cancelBtn.addEventListener('click', (ev) => {
    ev.stopPropagation();
    finishCancel();
  });
  root.addEventListener('contextmenu', (ev) => {
    ev.preventDefault();
    finishCancel();
  });

  // Defer so the deploy-drag pointerup does not instantly cancel/commit.
  requestAnimationFrame(() => {
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  });
  window.addEventListener('keydown', onKey, true);

  // Seed range preview with default facing (model ghost already faces this); commit still needs a swipe / chevron.
  setPreview(fallbackDir);

  return { close: finishCancel };
}
