# 危机合约战场视觉 — 根因与进度（2026-10-20）

## 用户观感

- 场地仍像 2D 色块 / 与卫戍协议不像
- 部分敌人有 Spine，多数是圆形 2D 头像
- 「3D / Spine / 效果」整体像没做成

## 根因（已处理 / 仍在）

### 1. 所谓 3D 是正交俯视挤出 → 肉眼等于 2D — **已修**

曾用 Orthographic 俯视 + 纯色 Box。现已改为：

- 透视 `Camera`（30°）+ `syncThreeCamera`
- **复用卫戍 `BoardScene`**：官方 `MT_autochess` 贴图、光照、阴影、起终点门框、背景雾
- Crisis 地图经 `stageFromMap.js` 嵌进 19×21 字形网格（世界坐标与 Spine 共用 `toWorldRow`）

仍无官方 `level_rune*` 场景包（local-extract 只有 act1/act2 autochess），所以是「卫戍材质的 TD 棋盘」，不是原版 59 区模型。

### 2. β 期敌人缺 Spine — **已从 Ark-Models 补齐**

工具：`node tools/crisis-enemy-spines.mjs`（读 `.cache/ark-models/models_data.json`，并用 `resolveRoles` 写正式 anims）。

### 2b. Spine「只平移、没走路」— **已修（2026-10-20）**

根因：补模时把 `anims.move` 写成了字符串 `"Move"`，而 `SpineActor._baseName` 需要 `{ loop: "Move" }`，于是一直落回 Idle，看起来像立绘在滑。  
现已用 `parseSkel` + `resolveRoles` 重写 7 个 CC 敌人的 spine 元数据；`spineLayer` 接上 Move/攻击脉冲/朝向。

### 3. 高度与脚底不对齐 — **已修**

`view.tileHeight` 与 `TILE_H`（BoardScene 高台 0.42）对齐，避免 Spine 浮空/陷地。

### 4. 战场反馈 — **本轮补了一批**

- 攻击范围预览（选中干员 / 部署悬停）
- 场上 HP + SP 条、选中圈、再部署倒计时
- 死亡 / 撤退播 Die 再淡出（不再瞬删）
- 伤害延后到攻击前摇比例落点（与 Spine 对齐）

### 5. 技能表 — **已接官方 SP/时长/简易黑板（本轮）**

`tools/crisis-stage.mjs` 从 `skill_table` 打包进 `battle-ops.json`；战斗用真实 `spCost` / `initSp` / `spType` / `duration`，黑板理解 `atk_scale` / `attack_speed` / `base_attack_time` / `times` 等。AUTO 自动开，MANUAL 点侧栏。

### 6. 本轮继续打磨（2026-10-20）

- 敌人 Spine：**只有真正在走路时播 Move**（快照 `moving`；阻挡 / 路线 WAIT 播 Idle，不再原地踏步）

- 血条 / 选中圈改画在 Spine **上方**（`#batBars` z=3；地面范围仍 z=1）
- `duration: -1` 不再被夹成 0：永久/开关技能可手动关
- 技能 `rangeId` 只在技能开启 / 瞬发连击时生效（陈 S2 等）
- 脚下菱形技能钮用官方技能图标；战斗事件接卫戍 `audio`（部署/开技能/普攻/死亡）

### 6b. 对照官服 PC 客户端（`D:\桌面\明日方舟\Hypergryph Launcher\games\Arknights`）

**证据：**
- IL2CPP `global-metadata`：`CrisisV2BattleFinish*`、`Arts/UI/[UC]CrisisV2/*`、`battle_cost_panel`、`ON_CRISISV2_RESULT`
- Bundles：`battle/prefabs/[uc]projectiles.ab` / `[uc]skills.ab` / `effects/*`、`refs/fx/sharedbattle.ab`
- 本机 **未下载** `level_rune*` 场景包（`scenes/obt` 仅有 campaign/memory/roguelike）；地图贴图有 `arts/maps/map_battleground`、`map_chernobog_*`

**已对齐（网页侧近似）：**
- 结算卡（胜/负 + 风险/击杀/漏敌/生命/用时）← CrisisV2BattleFinish；接 `settle/settlemen_personal_*`
- HUD RISK 条 + 合约 chip ← CrisisV2 评分语义
- COST 可部署高亮 ← battle_cost_panel；手牌费用不足灰显
- 漏敌时 LIFE 脉冲；非法部署舞台抖动
- 受击 Spine 闪红（CombatFx.flash → tint）
- 官服图集：`battleUi/btn_pause|speed`、`attack_range_*`、`slider_hp_*`、`skill_ready`；胶囊 `hudPanel/bg_miss_enemy`
- **整备大厅：** RISK 大字表 + 支援归零说明；已选 chip 可点删 / 清空；底栏 CTA 与 status 分行（不再挤在「开始行动」旁）

**仍缺（需资源管线，非 JADX）：**
- 从官服 AB 抽 CrisisV2 RuneIcon / 结算 UI 图集进 `public/assets`
- 接官方 `[uc]projectiles` / `sharedbattle` 到 `OfficialFx`（卫戍已有管线）
- β 专用场景网格（客户端未缓存 `level_rune*`）

### 7. 仍缺 / 架构债

- 完整技能语义（召唤、位移、弹道、状态）
- 弹道 FX 深化（现有 CombatFxBridge 程序化弹道；官方 AB 未接）
- 官方 `level_rune*` 场景包
- **重复实现（部分收敛）：** `art.js` 已改为卫戍 `assets` 单例薄封装（P0）；敌人 Spine 别名在 `public/js/render/present/enemyAlias.js`。`spineLayer.js` 尚未抽到 UnitPresenter（P1）— 规划见 [`docs/shared-presentation.md`](../../docs/shared-presentation.md)

## 本地资源注意

- Spine 文件在 `public/assets/`（gitignore），需本机跑过 `crisis-enemy-spines` 或 `fetch-assets`
- 棋盘依赖 local board pack（与卫戍同一套）；没有 art 时 `board3d` 回退 2D
