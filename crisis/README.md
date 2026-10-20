# 危机合约（独立玩法）

非商业同人复刻：明日方舟「危机合约」模式。与卫戍协议（`server/sim`）**不共用**对战引擎；连上本仓库服务器即可单人游玩，**不可联机对战**。

## 已定规则（玩家）

1. **不可联机**；连接服务器后可自己打（同源 `/crisis/`，无需房间 / WebSocket 对局）。
2. **干员默认满练**：满级、满潜能、满专精、满技能等级、满信赖；每位干员可自行改：精英阶段（精 0 / 1 / 2）、潜能、等级、选用技能与专精度。
3. **从第一期做起**：先做 **危机合约 β**（行动地点：切尔诺伯格 · 59 区废墟），再扩后续期数。
4. **全员满仓**：所有玩家拥有全部干员，任意期任意出战；**不**按历史上线日期锁干员。

## 目录

| 路径 | 用途 |
|---|---|
| `crisis/README.md` | 本说明 |
| `shared/crisis/` | 练度、合约、期数 |
| `shared/crisis/sim/` | **独立塔防引擎**（确定性 tick，不依赖 `server/sim`） |
| `shared/crisisBridge.js` | 标题页入口路径 |
| `public/crisis/` | 大厅 + Canvas 战场 |
| `tools/crisis-roster.mjs` | 满仓名单 |
| `tools/crisis-stage.mjs` | 打包 β 关卡 / 敌我数值 → `public/crisis/data/` |
| `test/crisis/` | 单测 |

## 怎么开

1. （首次）生成数据：
   ```bash
   node tools/crisis-roster.mjs
   node tools/crisis-stage.mjs
   ```
2. 启动卫戍服务器，打开 `http://<主机>:<端口>/crisis/`，或标题页选「危机合约」。
3. 选合约 → 编队 → **开始行动** → 点选手牌再点格子部署（右键撤退）。

## 战斗引擎现状（β 垂直切片）

已接通：官方 `level_rune_01-03` 地图与路线（底左原点换算）、费用回复、部署/撤退、阻挡、普攻物/法伤、合约数值乘区、胜负判定。

**美术（复用卫戍素材）：**
- 干员 / 敌人：**Pixi Spine**，与场地共用卫戍 `Camera`；β 六种敌人 Spine 可从 Ark-Models 拉齐（`node tools/crisis-enemy-spines.mjs`）
- 场地：卫戍 **`BoardScene`**（官方棋盘贴图 / 光照 / 门框），Crisis 地图嵌进 19×21 字形格。官方 `level_rune*` 场景包仍未入库

根因说明见 [`public/crisis/ANALYSIS.md`](../public/crisis/ANALYSIS.md)。

**跨模式共享（干员 / 敌人 Spine·技能图标·FX 只入库一次）：** 见 [`docs/shared-presentation.md`](../docs/shared-presentation.md)。新模式应接 UnitPresenter / CombatFx，而不是再复制一套 `spineLayer`。

尚未做或不完整：完整技能语义、官方弹道 AB（程序化 CombatFx 已接）、官方 CC 场景网格、`spineLayer` → UnitPresenter（P1）。
