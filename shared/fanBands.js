// Fan remake strategies (同人策略) — not in the official tables. Numbers reuse the existing band
// buff keys so meta.js / battle.js need no new handlers. Icons use operator avatars (`avatarCharId`).
// Merged into data/bands.json by tools/build-data.mjs. [ASSUMED]

/** @typedef {{ bandId: string, sortId: number, name: string, iconId: string, avatarCharId: string,
 *   modeTypeList: string[], totalHp: number, effectId: string, effectName: string, desc: string,
 *   descRaw: string, buffs: { key: string, bb: object, bbStr: object }[], params: object,
 *   victorCount: number, rewardModulus: number, unlockDesc: string|null, fan: true }} FanBand */

/** @type {readonly FanBand[]} */
export const FAN_BANDS = Object.freeze([
  {
    bandId: 'band_svrash',
    sortId: 41,
    name: '银灰',
    iconId: 'icon_svrash',
    avatarCharId: 'char_172_svrash',
    modeTypeList: ['SINGLE', 'MULTI'],
    totalHp: 26,
    effectId: 'aceffect_band_fan_svrash',
    effectName: '战术指挥',
    desc: '【战术指挥】我方干员每次部署后再部署时间减少40%',
    descRaw: '【战术指挥】我方干员每次部署后再部署时间减少40%',
    buffs: [{
      key: 'env_gbuff_new_with_verify',
      bb: { respawn_time: -0.4, value: 0 },
      bbStr: { key: 'act1autochess_band16_buff' },
    }],
    params: { respawn_time: -0.4, value: 0, key: 'act1autochess_band16_buff' },
    victorCount: 3,
    rewardModulus: 1,
    unlockDesc: null,
    fan: true,
  },
  {
    bandId: 'band_angel',
    sortId: 42,
    name: '能天使',
    iconId: 'icon_angel',
    avatarCharId: 'char_103_angel',
    modeTypeList: ['SINGLE', 'MULTI'],
    totalHp: 24,
    effectId: 'aceffect_band_fan_angel',
    effectName: '快速装填',
    desc: '【快速装填】每使用15资金，获得一名不高于当前调度中心等级的随机干员',
    descRaw: '【快速装填】每使用15资金，获得一名不高于当前调度中心等级的随机干员',
    buffs: [{
      key: 'band_coin_cost_gain_random_char_by_shop_level',
      bb: { coin_cnt: 15, count: 1 },
      bbStr: {},
    }],
    params: { coin_cnt: 15, count: 1 },
    victorCount: 3,
    rewardModulus: 1,
    unlockDesc: null,
    fan: true,
  },
  {
    bandId: 'band_mudrok',
    sortId: 43,
    name: '泥岩',
    iconId: 'icon_mudrok',
    avatarCharId: 'char_311_mudrok',
    modeTypeList: ['SINGLE', 'MULTI'],
    totalHp: 36,
    effectId: 'aceffect_band_fan_mudrok',
    effectName: '磐石壁垒',
    desc: '【磐石壁垒】初始目标生命值为36点；战斗开始时，使最右边的所有我方单位获得效果：每次攻击时有35%的概率获得1层护盾（最多1层）',
    descRaw: '【磐石壁垒】初始目标生命值为36点；战斗开始时，使最右边的所有我方单位获得效果：每次攻击时有35%的概率获得1层护盾（最多1层）',
    buffs: [{
      key: 'env_gbuff_new_with_verify',
      bb: { prob: 0.35 },
      bbStr: { key: 'act1autochess_band17_buff' },
    }],
    params: { prob: 0.35, key: 'act1autochess_band17_buff' },
    victorCount: 3,
    rewardModulus: 1,
    unlockDesc: null,
    fan: true,
  },
  {
    bandId: 'band_surtr',
    sortId: 44,
    name: '史尔特尔',
    iconId: 'icon_surtr',
    avatarCharId: 'char_350_surtr',
    modeTypeList: ['SINGLE', 'MULTI'],
    totalHp: 22,
    effectId: 'aceffect_band_fan_surtr',
    effectName: '熔火之心',
    desc: '【熔火之心】我方干员被击倒时，场上剩余我方单位攻击力+25%（最大150%，持续至该干员被击倒或战斗结束）',
    descRaw: '【熔火之心】我方干员被击倒时，场上剩余我方单位攻击力+25%（最大150%，持续至该干员被击倒或战斗结束）',
    buffs: [{
      key: 'env_gbuff_new_with_verify',
      bb: { atk: 0.25, max_stack_cnt: 6 },
      bbStr: { key: 'act1autochess_band15_buff' },
    }],
    params: { atk: 0.25, max_stack_cnt: 6, key: 'act1autochess_band15_buff' },
    victorCount: 3,
    rewardModulus: 1,
    unlockDesc: null,
    fan: true,
  },
]);

/** bandId → operator charId for the strategy portrait (operator avatar). */
export const FAN_BAND_AVATAR = Object.freeze(
  Object.fromEntries(FAN_BANDS.map((b) => [b.bandId, b.avatarCharId])),
);

export const FAN_BAND_COUNT = FAN_BANDS.length;
export const OFFICIAL_BAND_COUNT = 40;
export const TOTAL_BAND_COUNT = OFFICIAL_BAND_COUNT + FAN_BAND_COUNT;
