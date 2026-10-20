// shared/crisis/contracts.js — pick contracts for a Crisis season (mutual exclusion by group).

/**
 * @param {{ support?: any[], optional?: any[] }} contracts
 * @param {string[]} selectedIds
 * @returns {{ ok: boolean, risk: number, selected: any[], error?: string }}
 */
export function resolveContractPick(contracts, selectedIds) {
  const support = Array.isArray(contracts && contracts.support) ? contracts.support : [];
  const optional = Array.isArray(contracts && contracts.optional) ? contracts.optional : [];
  const byId = new Map([...support, ...optional].map((c) => [c.id, c]));
  const ids = Array.isArray(selectedIds) ? [...new Set(selectedIds.filter((x) => typeof x === 'string'))] : [];
  /** @type {any[]} */
  const selected = [];
  const groups = new Map();
  let risk = 0;
  let usedSupport = false;

  for (const id of ids) {
    const c = byId.get(id);
    if (!c) return { ok: false, risk: 0, selected: [], error: `unknown contract ${id}` };
    const isSupport = support.some((s) => s.id === id);
    if (isSupport) {
      if (usedSupport) return { ok: false, risk: 0, selected: [], error: 'at most one support contract' };
      usedSupport = true;
    } else {
      const g = c.group || c.id;
      if (groups.has(g)) {
        return { ok: false, risk: 0, selected: [], error: `mutual exclusion: ${g}` };
      }
      groups.set(g, id);
    }
    selected.push(c);
    // Official: any support forces displayed risk to 0 for the run scoreboard style;
    // we still sum optional risk for UI, then zero if support present (fandom note).
    if (!isSupport) risk += Number(c.risk) || 0;
  }
  if (usedSupport) risk = 0;
  return { ok: true, risk, selected };
}
