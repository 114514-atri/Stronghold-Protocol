// shared/crisis/sim/runes.js — apply selected Contingency Contract effects onto a battle config.

/**
 * @param {string[]} selectedIds
 * @param {any} seasonContracts cc-beta.json contracts
 * @returns {{
 *   enemyHpMul: number,
 *   enemyAtkMul: number,
 *   enemyDefMul: number,
 *   enemyMoveMul: number,
 *   enemyRangeMul: number,
 *   lifePointOverride: number|null,
 *   squadSizeCap: number|null,
 *   costRegenMul: number,
 *   deployLimitOverride: number|null,
 *   bannedProfessions: Set<string>,
 *   blockedTiles: { r: number, c: number }[],
 *   allyHpMul: number,
 *   allyAtkMul: number,
 *   allyDefMul: number,
 *   allyAspdAdd: number,
 *   costMulProfession: Record<string, number>,
 * }}
 */
/** Squad-size cap from selected contract ids (null = no cap). Lobby uses this for the main 12 slots. */
export function squadSizeCapOf(selectedIds, seasonContracts) {
  return applyContracts(selectedIds, seasonContracts).squadSizeCap;
}

export function applyContracts(selectedIds, seasonContracts) {
  const out = {
    enemyHpMul: 1,
    enemyAtkMul: 1,
    enemyDefMul: 1,
    enemyMoveMul: 1,
    enemyRangeMul: 1,
    lifePointOverride: null,
    squadSizeCap: null,
    costRegenMul: 1,
    deployLimitOverride: null,
    bannedProfessions: new Set(),
    blockedTiles: [],
    allyHpMul: 1,
    allyAtkMul: 1,
    allyDefMul: 1,
    allyAspdAdd: 0,
    costMulProfession: {},
  };
  const all = [
    ...(seasonContracts?.support || []),
    ...(seasonContracts?.optional || []),
  ];
  const byId = new Map(all.map((c) => [c.id, c]));
  for (const id of selectedIds || []) {
    const c = byId.get(id);
    if (!c) continue;
    switch (c.id) {
      case 'jt_readiness':
        out.allyDefMul *= 1.5;
        out.allyHpMul *= 2;
        break;
      case 'jt_assault':
        out.allyAspdAdd += 100;
        break;
      case 'oz_activation_1': out.enemyHpMul *= 1.25; break;
      case 'oz_activation_2': out.enemyHpMul *= 1.6; break;
      case 'oz_activation_3': out.enemyHpMul *= 2.5; break;
      case 'oz_stimulus_1': out.enemyAtkMul *= 1.15; break;
      case 'oz_stimulus_2': out.enemyAtkMul *= 1.35; break;
      case 'oz_stimulus_3': out.enemyAtkMul *= 1.8; break;
      case 'anti_armor_1': out.enemyDefMul *= 1.5; break;
      case 'anti_mobility': out.enemyMoveMul *= 1.5; break;
      case 'anti_sniper_1': out.enemyRangeMul *= 1.5; break;
      case 'obj_last_line': out.lifePointOverride = 1; break;
      case 'obj_urgent':
        out.costMulProfession.CASTER = 3;
        out.costMulProfession.MEDIC = 3;
        break;
      case 'obj_deep_1': out.costRegenMul *= 0.75; break;
      case 'obj_deep_2': out.costRegenMul *= 0.5; break;
      case 'obj_covert_1': out.squadSizeCap = 10; break;
      case 'obj_covert_2': out.squadSizeCap = 7; break;
      case 'obj_covert_3': out.squadSizeCap = 4; break;
      case 'obj_dispatch_guard':
        out.bannedProfessions.add('WARRIOR');
        out.bannedProfessions.add('TANK');
        break;
      case 'obj_dispatch_caster':
        out.bannedProfessions.add('CASTER');
        out.bannedProfessions.add('MEDIC');
        break;
      case 'env_terrain_2':
      case 'env_terrain_3':
        for (const [y, x] of c.blockedTiles || []) {
          // PRTS: (Y,X) origin bottom-left. Stage JSON row 0 = top → row = (rows-1)-Y.
          out.blockedTiles.push({ y, x, fromBottomLeft: true });
        }
        break;
      case 'oz_erosion_3':
        out.allyHpMul *= 0.25;
        break;
      case 'obj_blade_2':
      case 'obj_blade_3':
      case 'obj_armed_2':
      case 'obj_armed_3':
        // Enemy-specific: applied in battle when matching id prefix.
        out[`_${c.id}`] = true;
        break;
      default:
        break;
    }
  }
  return out;
}

/**
 * @param {ReturnType<typeof applyContracts>} runes
 * @param {number} rows
 * @param {{ y: number, x: number, fromBottomLeft?: boolean }} tile
 */
export function blockedTileToRowCol(runesTile, rows) {
  if (runesTile.fromBottomLeft) {
    return { r: (rows - 1) - runesTile.y, c: runesTile.x };
  }
  return { r: runesTile.y, c: runesTile.x };
}
