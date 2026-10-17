// Solo practice modifier panel — only mounted in 独立模拟. Sends `g.debug`; the server refuses co-op.

import { useState, useMemo } from '../../vendor/hooks.module.js';
import { html, Modal, Button, Icon, TierChip } from './components.js';
import { UnitThumb } from './gameComponents.js';
import { t, N_ } from '../../../shared/i18n.js';
import { data } from '../data.js';
import { actions } from './gameActions.js';
import { rosterOf } from './loadoutModel.js';

const HINT = N_('仅独立模拟可用。同盟模拟中服务器会拒绝这些操作。改动只影响本机这一局。');
const LAYERS_HINT = N_('盟约层数（阵营系数）：可对任意盟约加减或设定层数，不必先激活。');
const ROSTER_HINT = N_('点击发放到整备区（手牌满则进临时区）。不消耗资金，不占用商店库存。');

/**
 * Floating practice panel for solo matches.
 * @param {{ open: boolean, onClose: () => void, priv: object|null }} props
 */
export function CheatPanel({ open, onClose, priv }) {
  const [busy, setBusy] = useState(null);
  const [query, setQuery] = useState('');
  // hooks must run every render (Modal unmounts via `open`, but the panel stays mounted)
  const roster = useMemo(() => filterCheatRoster(rosterOf(data.list('chess')), query), [query, data.locale()]);
  if (!open) return null;

  const funds = Number.isFinite(priv?.funds) ? priv.funds : '—';
  const lp = Number.isFinite(priv?.lp) ? priv.lp : '—';
  const shopLv = Number.isFinite(priv?.shop?.level) ? priv.shop.level : '—';
  const freeR = Number.isFinite(priv?.shop?.freeRefreshes) ? priv.shop.freeRefreshes : 0;
  const cap = Number.isFinite(priv?.deployCap) ? priv.deployCap : '—';
  const equipCap = Number.isInteger(priv?.equipCap) && priv.equipCap >= 1 ? priv.equipCap : 2;
  const bonds = listBonds(priv);
  const owned = bonds.filter((b) => b.count > 0 || b.layers > 0);

  const run = async (key, fields) => {
    if (busy) return;
    setBusy(key);
    try { await actions.debug(fields); }
    finally { setBusy(null); }
  };

  return html`
    <${Modal} open=${true} onClose=${onClose} title=${t('练习修改器')} micro="SOLO PRACTICE" tone="amber" width="8.2rem"
      actions=${html`<${Button} variant="ice" onClick=${onClose}>${t('关闭')}<//>`}>
      <p class="cheat__hint">${t(HINT)}</p>
      <div class="cheat__stats" aria-live="polite">
        <span>${t('资金')} <b class="num">${funds}</b></span>
        <span>${t('目标生命值')} <b class="num">${lp}</b></span>
        <span>${t('调度中心')} <b class="num">${shopLv}</b></span>
        <span>${t('免费刷新')} <b class="num">${freeR}</b></span>
        <span>${t('部署上限')} <b class="num">${cap}</b></span>
        <span>${t('装备上限')} <b class="num">${equipCap}</b></span>
      </div>
      <div class="cheat__grid">
        <${CheatBtn} busy=${busy} id="add50" label=${t('资金 +50')} onClick=${() => run('add50', { op: 'addFunds', n: 50 })} />
        <${CheatBtn} busy=${busy} id="add200" label=${t('资金 +200')} onClick=${() => run('add200', { op: 'addFunds', n: 200 })} />
        <${CheatBtn} busy=${busy} id="set99" label=${t('资金设为 99')} onClick=${() => run('set99', { op: 'setFunds', n: 99 })} />
        <${CheatBtn} busy=${busy} id="setLp" label=${t('回满目标生命')} onClick=${() => run('setLp', { op: 'setLp' })} />
        <${CheatBtn} busy=${busy} id="freeR" label=${t('免费刷新 +3')} onClick=${() => run('freeR', { op: 'freeRefresh', n: 3 })} />
        <${CheatBtn} busy=${busy} id="reroll" label=${t('免费重摇商店')} onClick=${() => run('reroll', { op: 'rerollShop' })} />
        <${CheatBtn} busy=${busy} id="maxShop" label=${t('调度中心满级')} onClick=${() => run('maxShop', { op: 'maxShop' })} />
        <${CheatBtn} busy=${busy} id="cap" label=${t('部署上限 +1')} onClick=${() => run('cap', { op: 'addDeployCap', n: 1 })} />
        <${CheatBtn} busy=${busy} id="noEquip" label=${t('干员无装备上限')} onClick=${() => run('noEquip', { op: 'noEquipLimit' })} />
        <${CheatBtn} busy=${busy} id="unlockMax" label=${t('解锁最高等级干员')} onClick=${() => run('unlockMax', { op: 'unlockMaxOps' })} />
      </div>

      <h3 class="cheat__sub">${t('自选干员（免费）')}</h3>
      <p class="cheat__hint cheat__hint--tight">${t(ROSTER_HINT)}</p>
      <input class="cheat__search" type="search" value=${query} placeholder=${t('搜索干员')}
        onInput=${(e) => setQuery(e.target.value)} />
      <ul class="cheat__roster">
        ${roster.length ? roster.map((c) => {
          const golden = c.goldenId ? data.lookup('chess', c.goldenId) : null;
          return html`
            <li key=${c.chessId} class="cheat__op">
              <${UnitThumb} kind="chess" id=${c.chessId} size="sm" tier=${c.tier} />
              <div class="cheat__op-meta">
                <b>${c.name}</b>
                <${TierChip} tier=${c.tier} size="sm" />
              </div>
              <div class="cheat__op-btns">
                <${CheatBtn} busy=${busy} id=${`g:${c.chessId}`} label=${t('普通')}
                  onClick=${() => run(`g:${c.chessId}`, { op: 'grantChess', chessId: c.chessId })} />
                ${golden ? html`<${CheatBtn} busy=${busy} id=${`g:${golden.chessId}`} label=${t('精锐')}
                  onClick=${() => run(`g:${golden.chessId}`, { op: 'grantChess', chessId: golden.chessId })} />` : null}
              </div>
            </li>`;
        }) : html`<li class="cheat__empty">${t('无匹配干员')}</li>`}
      </ul>

      <h3 class="cheat__sub">${t('盟约层数（阵营系数）')}</h3>
      <p class="cheat__hint cheat__hint--tight">${t(LAYERS_HINT)}</p>
      <div class="cheat__bond-actions">
        <${CheatBtn} busy=${busy} id="all+10" label=${t('已有盟约 +10')} disabled=${owned.length === 0}
          onClick=${() => run('all+10', { op: 'addLayers', n: 10 })} />
        <${CheatBtn} busy=${busy} id="all+50" label=${t('已有盟约 +50')} disabled=${owned.length === 0}
          onClick=${() => run('all+50', { op: 'addLayers', n: 50 })} />
      </div>
      <ul class="cheat__bonds">
        ${bonds.map((b) => html`
          <li key=${b.id} class=${`cheat__bond${b.active ? ' is-active' : ''}${b.off ? ' is-off' : ''}`}>
            <div class="cheat__bond-meta">
              <b>${b.name}</b>
              <span class="num">${t('{n} 层', { n: b.layers })}</span>
              ${b.active ? html`<span class="cheat__tag">${t('已激活')}</span>` : null}
              ${b.off ? html`<span class="cheat__tag cheat__tag--off">${t('本局禁用')}</span>` : null}
            </div>
            <div class="cheat__bond-btns">
              <${CheatBtn} busy=${busy} id=${`+10:${b.id}`} label="+10"
                onClick=${() => run(`+10:${b.id}`, { op: 'addLayers', n: 10, bondId: b.id })} />
              <${CheatBtn} busy=${busy} id=${`+50:${b.id}`} label="+50"
                onClick=${() => run(`+50:${b.id}`, { op: 'addLayers', n: 50, bondId: b.id })} />
              <${CheatBtn} busy=${busy} id=${`=30:${b.id}`} label=${t('设为 30')}
                onClick=${() => run(`=30:${b.id}`, { op: 'setLayers', n: 30, bondId: b.id })} />
              <${CheatBtn} busy=${busy} id=${`=99:${b.id}`} label=${t('设为 99')}
                onClick=${() => run(`=99:${b.id}`, { op: 'setLayers', n: 99, bondId: b.id })} />
            </div>
          </li>
        `)}
      </ul>
    <//>
  `;
}

function CheatBtn({ busy, id, label, onClick, disabled = false }) {
  return html`<${Button} size="sm" variant="amber" loading=${busy === id} disabled=${!!busy || disabled} onClick=${onClick}>${label}<//>`;
}

/** Every bond in the data tables, with live layers / active from the private view when present. */
function listBonds(priv) {
  const table = data.get('bonds') || {};
  const live = new Map((Array.isArray(priv?.bonds) ? priv.bonds : []).map((b) => [b.bondId, b]));
  return Object.keys(table)
    .filter((id) => table[id] && typeof table[id] === 'object')
    .map((id) => {
      const rec = table[id];
      const b = live.get(id);
      return {
        id,
        name: rec.name || id,
        layers: Number.isFinite(b?.layers) ? b.layers : 0,
        active: !!b?.active,
        count: Number.isFinite(b?.count) ? b.count : 0,
        off: !!b?.off,
        core: !!rec.isCore,
      };
    })
    .sort((a, b) => (b.core - a.core) || (b.active - a.active) || (b.layers - a.layers) || a.name.localeCompare(b.name, 'zh'));
}

/** Visible roster filtered by name / appellation / id substring. */
function filterCheatRoster(roster, query) {
  const q = String(query || '').trim().toLowerCase();
  if (!q) return roster;
  return roster.filter((c) => {
    const name = String(c.name || '').toLowerCase();
    const app = String(c.appellation || '').toLowerCase();
    const id = String(c.chessId || '').toLowerCase();
    return name.includes(q) || app.includes(q) || id.includes(q);
  });
}

/**
 * Corner toggle that only the game screen mounts in solo.
 * @param {{ open: boolean, onToggle: (v: boolean) => void }} props
 */
export function CheatToggle({ open, onToggle }) {
  return html`
    <button type="button" class=${`gm__gear gm__cheat${open ? ' is-on' : ''}`}
      aria-label=${t('练习修改器')} title=${t('练习修改器')} aria-expanded=${open}
      onKeyDown=${(e) => { if (e.key === ' ') e.stopPropagation(); }}
      onClick=${() => onToggle(!open)}>
      <${Icon} name="edit" />
    </button>
  `;
}
