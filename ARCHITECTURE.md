# ARCHITECTURE.md — 多棋类扩展架构（接入说明）

> 面向后续开发者：如何理解并扩展本项目的多棋类引擎抽象层。
> 对应代码：`src/engine/`（V2_UX_SPEC §5 的落地子集）。**以本文档与
> `src/engine/interface.js` 的实际契约为准**；§5.2 中的 meta/State 纯函数
> 契约是目标态，未全量落地，勿按它写代码。
>
> 相关文件：
> | 文件 | 职责 |
> |---|---|
> | `src/engine/interface.js` | GameEngine 契约（文档式说明对象，单一事实来源） |
> | `src/engine/registry.js` | 棋种注册表 registerGame / getGame / listGames / hasGame |
> | `src/engine/chess/index.js` | 国际象棋适配器 `createChessEngine()`（已实现，范式参考） |
> | `src/engine/search.js` | 搜索薄封装（转发 `src/core/ai.js` 的分帧搜索） |
> | `src/engine/xiangqi/index.js` 等 | 中国象棋/五子棋/围棋占位（抛 not-implemented） |
> | `src/core/game.js` / `movegen.js` / `board.js` | 国际象棋核心（被适配器包装，**零改动**） |
> | `src/core/storage.js` | 持久化（含残局存档，见 §6） |
>
> 测试门禁（引擎抽象层落地时的历史基线，逐套数值见 §7 第 7 步）：`node test.js`（9 项）+
> `node test-integration.js`（59 项）+ `node test-engine.js`（62 项，含契约/registry/storage 验收）+
> `node test-endgame.js`（残局库数值表校验，当前 100 阵）+
> `node test-endgame-scene.js`（残局场景，84 项，已纳入硬门禁）。
> 历史：`test-endgame-scene.js` 曾因数据层扩容（10→100 阵、12→15 妙招、EG-01 杀着
> 由 Ra1-a8 改为 Rb4-b8、tipId 语义化）导致 6 条断言写死旧值而失败；
> 已改为动态求解杀着 + 数量/id 唯一性从数据层派生（见 §7 第 7 步）。
>
> **测试口径沿革（历史记录，2026-11-07，不代表当前）**：引擎抽象层落地时六套 Node 回归
> **327/0**（`test.js 9` · `test-integration.js 59` · `test-engine.js 62` ·
> `test-endgame.js 100` · `test-endgame-scene.js 86` · `test-gameplay.js 11`），
> 云端 `test-cloud.js 111/0` + `test-sync.js 177/0` + `test-recovery.js 86/0` = **374 断言**，
> 另有 `tools/verify-round2.js 66/0`、`tools/render-shots.js 36 场景 0 失败`。
> 以上均为**各轮历史基线**，此处保留仅供沿革追溯，不得作为当前口径引用。
> **当前全量口径见 §8.9 与 `README.md`「测试（回归门禁）」**：十套 Node 回归（含远程房间协议 v5）、
> `tools/verify-round2.js 81/0`、`tools/render-shots.js` 47 成功 / 0 失败 / 0 跳过。

---

## 1. GameEngine 契约总览（src/engine/interface.js）

任何棋种适配器经 `registry.getGame(id)` 返回的实例必须满足：

**属性**

| 属性 | 类型 | 说明 |
|---|---|---|
| `cols` | number | 棋盘列数 |
| `rows` | number | 棋盘行数 |
| `gridType` | `'square' \| 'intersection'` | 落子格内（国际象棋）还是交叉点（象棋/五子棋/围棋） |

**方法（11 个）**

| 方法 | 签名 | 说明 |
|---|---|---|
| `init` | `init(fen) → boolean` | 从 FEN（或棋种等价局面串）重置；空参=初始局面；非法返回 false 且不改动当前局面 |
| `getLegalMoves` | `getLegalMoves() → Move[]` | 当前行棋方全部合法走法 |
| `applyMove` | `applyMove(move) → boolean` | 执行一步；非法返回 false 且局面不变 |
| `undo` | `undo() → boolean` | 撤销一步；无可撤返回 false |
| `isGameOver` | `isGameOver() → boolean` | 是否终局 |
| `getWinner` | `getWinner() → 'w' \| 'b' \| null` | 胜方；和棋/未终局为 null |
| `toFen` | `toFen() → string` | 导出局面串，可被 `init()` 原样读回 |
| `clone` | `clone() → Engine` | 深拷贝独立实例（含悔棋历史），供 AI 推演 |
| `getPieceAt` | `getPieceAt([r,c]) → {type, color} \| null` | 取格上棋子；type 小写字母、color `'w'\|'b'` |
| `moveToUci` | `moveToUci(move) → string` | 契约走法 → UCI 串 |
| `uciToMove` | `uciToMove(str) → Move \| null` | UCI 串 → 契约走法（纯语法解析，不校验合法性） |

**走法对象 Move**

```js
{ from: [row, col], to: [row, col], promotion?: 'q'|'r'|'b'|'n' }
```

- `promotion` 仅出现在有升变规则的棋种（国际象棋）；一枚升变兵的 4 种选择是 **4 条独立合法走法**。
- gomoku/go 落子无 `from` 的兼容形态（§5.2 目标态）暂未启用，当前契约要求 from/to 齐备。

**坐标约定（全局统一）**

- 格位 = `(row, col)` 二维数组坐标，**row 0 在顶部**（黑方底线一侧）、row 递增向下，col 0 在左。
- 国际象棋 UCI ↔ 坐标换算：列 `a-h` ↔ col 0-7，行 `1-8` ↔ row 7-0。
  即 `e2 → [6,4]`、`a8 → [0,0]`、`h1 → [7,7]`。
- `toFen`/`init` 必须互逆；`getWinner` 只关心胜负归属，是否终局用 `isGameOver` 判。

---

## 2. registry 注册流程（src/engine/registry.js）

```js
var registry = require('./src/engine/registry');

registry.registerGame(id, adapterFactory);  // 注册：adapterFactory() → 引擎实例
registry.getGame(id);   // 每次调 factory() 返回全新实例；未注册返回 null
registry.listGames();   // 已注册 id 数组
registry.hasGame(id);   // 是否已注册
```

- **内置注册**：模块加载时已 `registerGame('chess', require('./chess').createChessEngine)`，
  所以 `require('registry')` 后 `getGame('chess')` 直接可取。
- **占位约定**：`xiangqi/gomoku/go` 的工厂（`createXiangqiEngine` 等）调用即抛
  `Error('not-implemented: <id>')`，且**故意不注册**——注册了会在 getGame 时炸。
  实现完成后在 registry.js 加一行注册即可上线。
- `registerGame` 校验入参（id 非空字符串、factory 为函数），不合法返回 false。
- 新实例语义：每次 getGame 都是独立引擎（独立局面/历史），互不干扰。

---

## 3. 国际象棋适配器范式（src/engine/chess/index.js）

**核心思路：翻译层包装，零改动现有模块。** `core/game.js`（ChessGame）、
`core/board.js`、`core/movegen.js` 一行未改，适配器只做格式互译与能力补齐。

```
attachEngine(game)   ← 围绕一个 ChessGame 实例组装契约引擎（闭包持有 game）
createChessEngine()  = attachEngine(new ChessGame())   ← 对外工厂
engine.clone()       = attachEngine(cloneGame(game))   ← 深拷贝后再组装
```

**走法对象互译**（movegen 内部格式 ↔ 契约格式）

```
movegen:  { fromRow, fromCol, toRow, toCol, promotion?,
            isDoublePush, isEnPassant, isCastling, castlingSide }   ← 特殊标志不出适配器
契约:     { from: [r,c], to: [r,c], promotion? }
```

- `getLegalMoves()` 把内部走法映射为契约走法（丢弃特殊标志）。
- `applyMove()` 反向翻译后调 `game.makeMove()`——makeMove 自己按
  from/to/promotion 匹配合法走法并带上正确标志，所以传「裸走法」也安全。
- `moveToUci`/`uciToMove` 是纯语法互转（不查合法性）；易位记王两格（`e1g1`）、
  吃过路兵记实际落点（`e5d6`），无需特判。

**适配器补齐的能力**（core/game.js 没有，实现在适配器内）：

- `init(fen)` / `toFen()`：六段标准 FEN 读写（局面/行棋方/易位权/吃过路兵/半步/全步）。
  吃过路兵目标格 = 双步被跳过的格（与 game.js 内部状态一致，往返保真）。
- `clone()`：拷贝棋盘（Board.clone）+ 悔棋历史（JSON 深拷贝）+ 三次重复计数
  （positionCounts Map）+ 回合/易位/EP/半步/全步/result。
- `isGameOver()`/`getWinner()`：若 `game.result` 为空则惰性补调 `checkGameResult()`，
  因此**合成残局「起始即终局」的 FEN 也能正确判定**（残局闯关必需）。
- result 映射：`white_win → 'w'`、`black_win → 'b'`、draw/和棋类 → `null`。

**适配器边界（重要取舍）**

适配器**只暴露 §1 的 11 个契约方法与 3 个属性**，不暴露底层 `ChessGame` 实例、
`board`、`state`、`uciLog/moveLog` 等 core 级对象。因此：

- **场景层多棋种抽象**走适配器（按 `cols/rows/gridType` 泛化棋盘、走法、记谱接口）；
- **需要 core 级对象的场合**（AI 搜索要真实 `Board` 实例、残局要 SAN/UCI 平行记谱数组）
  直接用 `core/game.js` + `core/ai.js`，**不走适配器**——两种路径行为等价
  （适配器内部就是包着 core 实现），不是两套逻辑。
- 适配器也不提供 FEN→Board 的构造器：需要按 FEN 直接建 core `Board` 的场景
  （如残局开局）需自行解析 FEN，或用 `engine.init(fen)` 后另建 core 实例。
  典型现状：残局场景用 ~25 行 FEN 解析 + core `ChessGame/movegen`，
  引擎适配器只服务于跨棋种统一的抽象层。

---

## 4. gridType 差异（square / intersection / lines）

| 棋种 | cols × rows | gridType | 落点 | 占位/实现 |
|---|---|---|---|---|
| 国际象棋 chess | 8 × 8 | `square` | 格内 | 已实现 `src/engine/chess/index.js` |
| 中国象棋 xiangqi | 9 × 10 | `intersection` | 交叉点 | 占位 `src/engine/xiangqi/index.js` |
| 五子棋 gomoku | 15 × 15 | `intersection` | 交叉点 | 占位 `src/engine/gomoku/index.js` |
| 围棋 go | 19 × 19（可选 9/13） | `intersection` | 交叉点 | 占位 `src/engine/go/index.js` |

- 坐标语义不变：`(row, col)`、row 0 在顶；差异只在**子落格内还是交叉点**。
- 渲染侧由 `src/render/board.js` 的 `drawBoardGeneric` 处理 **3 种** `grid.type`：
  `square`（双循环画深浅格，落格心）、`intersection` 与 `lines`（实心底 + 网格线，
  落线交点，自动内缩 `cell/2` 防裁边）。后两者共用 `pointMode` 分支，
  `intersection` 额外支持 `opts.starPoints`（围棋星位，见 `config.GAME_SKINS.go.starPoints`）。
  棋子样式由 `opts.pieceStyle`（缺省取 skin）注入：`unicode` / `disc-char` / `stone`；
  后两种绘制函数在 `board.js` 内部（`_drawDiscChar` / `_drawStone`），
  `src/render/pieces.js` 只负责 chess 的 `drawPiece*`。详见 §7 第 6 步 (d)。
- 皮肤侧现状：`config.GAME_SKINS` 已登记 4 个棋种，网格固定为
  chess 8×8 / xiangqi 9×10 / gomoku 15×15 / go 19×19，
  go 另带 `starPoints: [3,9,15]`。表中「可选 9/13 路」只是 go 占位文件
  头部注释里的待定选项，**尚未落地**，接入时以 `getGameSkin(id).grid` 为准。
- 各占位文件头部注释已写明本棋种的 cols/rows/gridType 与待实现清单，
  实现时从占位文件起步即可。

---

## 5. 搜索注入点（src/engine/search.js）

```js
var search = require('./src/engine/search');   // = require('../core/ai')
var ctx = search.createSearch(board, color, state, maxDepth, timeBudgetMs, sliceMs);
```

- **薄封装**：`search.js` 直接 `module.exports = require('../core/ai')`，
  转发 `createSearch / findBestMove / evaluate / alphaBeta / budgetForDepth`。
  将来按棋种分派不同 thinker 时只改这一层，调用方不动。
- **参数**（当前为国际象棋 core 对象，见 `core/ai.js`）：
  - `board`：core `Board` 实例；`state`：`{castling, enPassantTarget}`；
  - `color`：**AI 执棋方**（`'w'`/`'b'`）；
  - `maxDepth`：迭代加深上限（残局提示用 `min(关难度深度, 3)`，预算 1200ms，见 V2_UX_SPEC §2）；
  - `timeBudgetMs`：全局时间预算（省略按 `budgetForDepth(depth)` 取默认）；
  - `sliceMs`：每帧切片（默认 18ms，保证 UI 不卡）。
- **分帧生成器用法**：`ctx.step()` 每帧调用一次（按 sliceMs 预算推进），
  返回 `{done, bestMove, score}`；内部 `alphaBetaGen` 每 16 节点协作式 yield。
  `ctx.finish()` 一次性跑完剩余搜索（同步兜底）。未 done 前 `ctx.bestMove`
  是当前最优点（可先展示再等深化）。
- **maximizing 与执棋色关系**：`evaluate` 固定从**白方视角**计分
  （白加黑减），因此 `maximizing = (color === COLOR.WHITE)`——
  AI 执白最大化白方分数，执黑则最小化它。搜索不假设「玩家永远执白」。
  ⚠️ 该评估是国际象棋专用；其他棋种接入时需按 V2_UX_SPEC §5.3 注入
  自己的 generateMoves/evaluate/thinker（围棋分支因子大，alpha-beta 不适用，
  本期只留接口不实现围棋 AI）。
- **与适配器的关系**：`createSearch` 目前吃 core 层对象（`game.board` 等），
  场景可从 `ChessGame` 实例取 board/state 喂给它；适配器实例不直接暴露 board。
- **两条等价路径**：`src/engine/search.js` 是 `core/ai.js` 的转发层，
  「搜索统一从 search.js 取」是接入新棋种时的约定；而**当前 chess 的残局/提示
  场景因需要真实 `Board` 实例，直接调 `core/ai.js` 的 createSearch**——
  两者是同一份实现、行为等价，不是两套搜索。
- **残局提示的实际调用链**（`src/scenes/endgame.js`）：先用场景内的「最短强制杀」
  求解器 `createMateSolver`；超时或无解才回落
  `createSearch(board, COLOR.WHITE, state, min(难度,3), 1200, 18)`；仍无结果降级为
  文案提示。因此本节的 `createSearch` 是**回落路径**，不是提示的唯一来源。

---

## 6. storage 命名空间（src/core/storage.js + src/config.js）

### 6.1 键命名空间约定（V2_UX_SPEC §5.4 步骤 7）

- 现有键一律 `chess.*` 前缀（保留兼容旧数据）；**新增棋种用自己的前缀**：
  `xiangqi.*` / `gomoku.*` / `go.*`，互不踩踏。
- **新增棋种 = 新增一整套 `<gameId>.*` 键族**（设置/教学/棋谱/断点/进度），
  进度类键用 `<gameId>.endgame.v1` 形态（chess 的是 `chess.endgame.v1`）；
  **勿复用 `chess.*` 前缀**，否则两棋种进度互相污染。
- 棋谱记录键为 `chess.record.v1.<recordId>`（`STORAGE_KEYS.recordPrefix` =
  `'chess.record.v1.'`）。⚠️ 这里的 `<recordId>` 是**单局棋谱 id**，不是棋种 id；
  `storage.getRecord(gameId)` / `deleteRecord(gameId)` 的形参虽叫 `gameId`，
  实际传的也是棋谱 id。多棋种接入时勿把两者混为一谈：键族应组织为
  `<棋种>.record.v1.<recordId>`，并在 record 对象内补一个真正的 `gameId` 字段
  （`'chess'`/`'xiangqi'`/…）用于列表筛选；记谱字段经 `notation` 可插拔
  （chess=SAN/UCI、xiangqi=ICCS、gomoku/go=坐标）。
- 键名统一登记在 `src/config.js` 的 `STORAGE_KEYS`，勿在业务代码里写裸字符串：

```
chess.settings.v1 / chess.tutorial.v1 / chess.config.last.v1 /
chess.records.index.v1 / chess.record.v1.<recordId> / chess.resume.v1 /
chess.endgame.v1 / chess.endgame.resume.v1
```

### 6.2 残局存档 chess.endgame.v1 结构摘要（权威规格 V2_UX_SPEC §1.8）

```jsonc
{
  "version": 1,
  "unlockedLevel": 4,        // 已解锁到第几阵（1-based 数字）
  "cleared": {               // 每阵最佳成绩，key=阵号数字字符串
    "1": { "stars": 3, "bestTimeMs": 12000, "bestMoves": 1, "rewarded": true }
  },
  "skills": [ { "id": "skill_mirror", "charges": 2 } ],   // 随身技能库（≤8）
  "tipsCollected": ["tip_01"],   // 妙招图鉴（去重）
  "pendingHints": 0,         // 库存溢出转化的提示数
  "stats": { "totalAttempts": 0, "totalClears": 0 },
  "updatedAt": 0
}
```

- 技能 id 全名 7 种：`skill_hourglass / skill_mirror / skill_undo`（普通）、
  `skill_scout / skill_freeze`（稀有）、`skill_master / skill_ward`（史诗）。
  **提示/悔棋次数不入库**（每阵重置，属会话态）。
- API（除 `loadEndgame` 为读外，其余写入类 API 均 write-through，写入自动更新 `updatedAt`）：
  `loadEndgame / saveEndgame / addSkill / useSkill / unlockLevel / setCleared /
   collectTip / addPendingHints / consumePendingHints / recordAttempt / recordClear`。
- **活对象注意**：`loadEndgame()` 同引用返回当前存档对象，增减类 API 原地改并
  立即落盘；场景若手改返回对象又调了其他 mutator，mutator 会先按存储重读再改，
  **未 save 的手改会被冲掉**——要么改完立刻 `saveEndgame(d)`，要么只走 mutator。
- 读损坏 → 返回默认结构、**不覆盖坏数据**（读不写回）；`skills` 超 8 条时
  按 `_skillOrderness` 取「最普通的一个」转 `pendingHints+1` 并移除，
  排序键 = 稀有度升序 → charges 升序 → `SKILL_RANK` 规范表顺序；
  未知 id 一律视为最特殊（最后才被转出）。

---

## 7. 新棋种接入 checklist

1. **实现契约**：从 `src/engine/<id>/index.js` 占位文件起步，导出
   `create<Id>Engine()`，实现 §1 的 11 方法 + cols/rows/gridType。
   格位一律 `(row, col)`、row 0 在顶；`toFen`/`init` 互逆；`clone` 含悔棋历史。
2. **注册**：`src/engine/registry.js` 加一行
   `registerGame('<id>', require('./<id>').create<Id>Engine);`。
3. **记谱**：实现 `moveToUci`/`uciToMove`（xiangqi 建议 ICCS `a0a1` 风格、
   gomoku/go 坐标短格式，定稿前先对齐场景侧）。
   注：chess 场景目前优先用 `core/game.js` 现成能力（`moveLog` 的 SAN 与
   `uciLog` 的 UCI 平行数组，天然满足记谱网格+回放真值），适配器的记谱契约
   主要服务于**跨棋种统一**。
4. **搜索**：`search.js` 取 `createSearch`。chess/xiangqi/gomoku 可走
   alpha-beta + 评估注入（§5.3）；**围棋需替代 thinker（MCTS 等），本期不实现**。
5. **存档命名空间**：新键用 `<id>.*` 前缀登记进 `config.STORAGE_KEYS`，
   记录加 `gameId` 字段（§6.1）。
6. **场景接入**：把新棋种接进现有场景栈（本期仅 chess 全量接入，其余为接入指引）。
   核心原则：**场景层按 `rows/cols/gridType` 泛化，不写死 8×8**；引擎实例经
   `registry.getGame(gameId)` 取（或按 §3 的取舍直接用 `core/game.js`）。

   **(a) 场景文件清单**（现有 10 个，位于 `src/scenes/`）

   | 场景 | 注册名 | 新棋种接入点 | 说明 |
   |---|---|---|---|
   | `menu.js` | `menu` | 改入口 | V-8：唯一 Primary=残局闯关，Secondary=人机/双人，次级行 4 项 |
   | `setup.js` | `setup` | 改参数 | 难度 / 执棋色 / 先后手，按棋种注入选项 |
   | `gameplay.js` | `gameplay` | 改引擎来源 | 人机 / 双人对弈主场景，AI 指导与提示也在此 |
   | `teaching.js` | `teaching` | 按棋种新增 | C8 防泄题：TRY_PROMPT/SELECTED/REVEAL 一律 `drawMiniBoard([])` |
   | `academy.js` | `academy` | 改数据源 | 锦囊阁 hub：妙招图鉴 / 新手试炼 / 规则速查 / 更多棋种占位（V-10） |
   | `endgameMap.js` | `endgameMap` | 按棋种新增 | 阵图卡 4 态（V-1），进度读 `<id>.endgame.v1` |
   | `endgame.js` | `endgame` | 按棋种新增 | S10 HUD / 步数 / 7 技能 / 提示 / 结算，需「强制杀」类求解器 |
   | `records.js`、`replay.js` | `records`、`replay` | 记谱适配 | SAN/UCI 平行数组 → `notation` 可插拔 |
   | `settings.js` | `settings` | 一般无需改 | 品牌层设置跨棋种共用 |

   新棋种通常**不必新建整套场景**，而是让 `gameplay` / `endgameMap` / `endgame`
   按 `gameId` 分支；确需独立玩法（如围棋数目、提子）再新增文件。

   **(b) 注册流程**（`game.js` 入口，已成为统一范式）

   ```js
   const XxxScene = require('./src/scenes/xxx');   // 顶部 require
   // ...
   sceneManager.register('xxx', new XxxScene());    // 与 menu/setup/… 并列注册
   ```

   已按此注册的 v2 场景：`academy` / `endgameMap` / `endgame`（共 10 个注册名）。
   导航统一走 `GameContext.pushScene(name, params)` / `popScene()` /
   `replaceScene()` / `switchScene()`（分别转发 `SceneManager.push/pop/replace/switchTo`），
   切换前先 `GameContext.emit('navigate', { to: name })` 供音效与埋点订阅；
   `_activate()` 给 `enter(params)` 注入 `screenWidth` / `screenHeight` / `_sm`，
   `pop()` 回上一场景额外带 `resume:true`（用于保留滚动位置等）。
   `layout.init(sysInfo)` 已在 `game.js` 调用一次，场景只需 `layout.get()`；
   渲染一律以 `L.contentTop/contentBottom/contentLeft/contentRight` 为可用带，
   `L.isTablet` 时 `academy` / `endgameMap` 走两列（V-9）；顶栏另取
   `L.navSafeTop` / `L.navRightAvoid` 避让微信胶囊。棋盘度量统一用
   `layout.computeFor({topReserveH, bottomBarH}, cols, rows)`，返回
   `{cellSize, boardSize, boardWidth, boardHeight, boardX, boardY, cols, rows}`
   （超矮屏内部会自动退让；注意字段是 `boardX/boardY/cellSize`，不是 `x/y/cell`）。

   **(c) 菜单入口扩展**（V2 §3 IA / V-8）

   - `menu.js` 现状：唯一 Primary = 残局闯关 → `endgameMap`；
     Secondary = 人机对战 / 双人对弈；次级行 4 项 = 锦囊阁 / 棋谱 / 设置 / 音效。
   - 进度分母**必须从数据层派生**：`const total = (ENDGAMES && ENDGAMES.length) || 100;`
     （`menu.js` 已如此，勿回退成硬编码 `/10` 或写死 `/100`；当前 `ENDGAMES.length=100`）。
   - 棋种切换入口建议置于次级行或「更多棋种」区（`academy.js` 已有
     xiangqi / gomoku / go 置灰「即将开放」占位，V-10）：上线一个棋种即把对应项
     由置灰改为可点，并调 `config.setActiveGame(id)`；渲染取
     `config.getGameSkin(id)`——**未登记 id 一律回退 chess，绝不返回 undefined**，
     因此新增棋种务必先在 `config.GAME_SKINS` 登记皮肤。

   **(d) 棋盘渲染接入点**（`src/render/board.js`）

   ```js
   const skin = config.getGameSkin('xiangqi');
   // → { grid:{cols:9,rows:10,type:'intersection'}, pieceStyle:'disc-char',
   //     pieceSizeRatio, PIECE:{redFill,blackFill,discStroke,...} }
   const b = layout.computeFor({ topReserveH, bottomBarH }, skin.grid.cols, skin.grid.rows);
   render.drawBoardGeneric(ctx, stateForDraw, {
     x: b.boardX, y: b.boardY, cellSize: b.cellSize,
     grid: skin.grid, gameSkin: skin, starPoints: skin.starPoints,
     coordLabel: skin.coordLabel, flip, showCoordinates,
     selected, legalMoves, lastMove, checkPos,
     time: dtMs, reduceMotion
   });
   ```

   - `grid.type` 三态：`square`（格心）/ `intersection`（线交点 + 星位）/
     `lines`（线交点）。后两者 `pad = cell/2`，**触摸命中必须同步加这个偏移**，
     否则点选会错半格；`drawBoardGeneric` 会把实际原点写回 `opts.ox/oy`
     与 `opts.pointMode`，命中逻辑直接复用这两个值。
   - `state` 支持三种形态：`{getPiece(row,col)}`（core `Board`）、
     `{cells:Array}`、`{grid:Piece[][]}`。契约引擎只暴露 `getPieceAt([r,c])`，
     包一层 `{ getPiece: (r,c) => engine.getPieceAt([r,c]) }` 即可接入。
   - 棋子适配点：`drawBoardGeneric` 内部按 `pieceStyle` 分派
     `_drawDiscChar`（汉字圆子，取 `PIECE.redFill/blackFill/discStroke`）与
     `_drawStone`（黑白圆子，取 `PIECE.*Fill/*Stroke`、`pieceRadiusRatio`）；
     `src/render/pieces.js` 仅导出 `drawPiece` / `drawPieceWithShadow` /
     `clearPieceCache`，**只服务 chess unicode 棋子**，新棋种不要往里加分支。
     Piece 对象由 `_normPiece` 兼容 `{type,color}`（chess）或 `{kind,side}`
     并归一为 `{type,side,char,white}`；`disc-char` 用 `white` 判红/黑填充。`char` 缺省时先尝试可选的
     `config.PIECE_NAMES_BY_KIND[type]`（当前 config 尚未登记该表），
     再回退 `p.type`，所以中国象棋棋子应显式带 `char`（汉字）。

   **(e) 存档命名空间**（§6.1）

   - 新棋种一律用 `<gameId>.*` 键族并登记进 `config.STORAGE_KEYS`，
     **勿复用 `chess.*`**（两棋种进度会互相污染）；进度键形态 `<id>.endgame.v1`。
   - **写存档只走 mutator**（`unlockLevel` / `setCleared` / `collectTip` /
     `addSkill` / `useSkill` / `addPendingHints` / `consumePendingHints` /
     `recordAttempt` / `recordClear`），不要手改 `loadEndgame()` 返回对象后
     指望某个 mutator 顺手落盘；确需批量改结构，改完立刻 `saveEndgame(d)` 显式落盘
     （`loadEndgame()` 是活对象，mutator 会按存储重读，未 save 的手改会被冲掉）。
   - 数据层当前规模：`ENDGAMES.length = 100`、`TIPS.length = 15`、`SKILLS.length = 7`
     （`src/data/endgames.js`）。场景侧任何「总数」显示与测试断言都从
     `ENDGAMES.length` / `TIPS.length` 派生，勿写死。

   **(f) 记谱与 AI 的等价路径**

   - 记谱：chess 场景优先用 `core/game.js` 现成能力（`moveLog` 的 SAN 与
     `uciLog` 的 UCI 平行数组，天然是回放真值）；适配器的
     `moveToUci` / `uciToMove` 主要服务于**跨棋种统一**。两条路径不冲突，
     新棋种建议实现契约方法并让 `replay` 走 `notation` 适配层。
   - 搜索：`src/engine/search.js` 是 `core/ai.js` 的转发层（同一份实现），
     chess 的残局/提示因需真实 `Board` 实例直接调 `core/ai.js` 的 `createSearch`，
     **行为等价，不是两套搜索**。新棋种按 §5.3 注入自己的
     generateMoves / evaluate / thinker；**围棋分支因子大，alpha-beta 不适用，
     需替代 thinker（MCTS 等），本期只留接口不实现围棋 AI**。
   - 残局提示链路：最短强制杀求解器优先 → 超时/无解回落 `createSearch`
     （`min(难度,3)` / 1200ms / 18ms）→ 再降级文案。新棋种若无「强制杀」概念，
     需自定义等价的提示生成器，不可直接照搬求解器。

7. **回归门禁**（引擎抽象层落地时的历史基线；**当前全量口径见文首「测试口径更新」与 §8.9**）

   | 命令 | 基线 | 覆盖 |
   |---|---|---|
   | `node test.js` | 9 项检查 | core 规则 / 将杀 / 易位 / 升变 / AI |
   | `node test-integration.js` | **96/0** | 场景栈 / 输入防误触 / 教学防泄题 / 存储返回值；含 `versus` 单入口与 room 场景 |
   | `node test-engine.js` | **62/0** | 契约 / registry / 适配器 / 残局存档 API |
   | `node test-endgame.js` | **100/100 阵** | 强制杀可达性 + 数值表一致性（FEN、目标步数、moveCap、tipId、技能权重） |
   | `node test-endgame-scene.js` | **86/0** | S9 阵图 + S10 状态机 / 软计时 / 机会经济 / 技能 / 星级 / 奖励写入 / 模态流程 |
| `node test-gameplay.js` | **98/0** | 玩法 / 固定朝向 / 远程视角 / 退出仲裁 / 兵力判定 / 心跳 / 棋谱三态 |
| `node test-room.js` | **153/0** | 远程对局房间协议 v5 / 分享 query 冷 / 热启动 / `.watch()` + 2.5s 轮询 / `movesUci` + `rev` CAS / 退出仲裁 / 封存续局闭环 / `sweepAbandoned()` 超时兜底 / 6h 过期 / 删除清理 |

   **写测试的两条硬约束**（曾踩过坑）：残局库已扩到 100 阵、妙招 15 条，
   ① 数量断言一律从 `ENDGAMES.length` / `TIPS.length` 派生（或断言「≥初始规模 + id 唯一」），
   勿写死 10 / 12；② 杀着、tipId 一律动态取（用 `registry.getGame('chess').init(fen)`
   + `clone().applyMove()` 求一步杀 UCI，再 `game.findMoveByUci(uci)` 映射回场景走法；
   tipId 从 `ENDGAMES[i].tipId` 读），勿硬编码 from/to 行列或 `tip_01`。
   渲染侧回归要求：换棋种后 chess 走 `drawBoardGeneric` 的 `square` 分支，
   画面与旧版 `drawBoard` **不得有差异**。

---

## 8. 云端持久化与同步（v3 · 本地优先 + 云端 KV 镜像）

> **本轮代码已完整可集成，但云端默认关闭；填入 env 并确认权限后才真正联网。**
> `src/config.js` 的 `CLOUD_CONFIG.enabled = false`、`env = ''`；未授权 / 未配置 / 云端不可用时整条链路**零云调用、静默降级本地**。
> 部署步骤、配额、环境核查结论与「需确认清单」见 `CLOUD_DEPLOY.md`；可托管隐私政策见 `PRIVACY_POLICY.md`；上架合规见 `WECHAT_PUBLISH_GUIDE.md`。

### 8.1 技术选型与铁律

- **选型**：`wx.cloud` 前端直连云数据库 + **集合安全规则**。理由：工程无 npm / 构建链；`_openid` 由平台自动注入、**不可伪造**，安全规则在服务端强制隔离；`wx.cloud` 走微信私有通道，**不需要 request 合法域名 / 备案域名 / TLS 证书 / `code2session`**。
- **零云函数、零 npm、零 `wx.request`**；不引入 `wx.login` / `wx.getUserProfile` / `scope.userInfo`。
- **本地优先**：`src/core/storage.js` 仍是**唯一读写源**，28 个既有导出（25 个业务 API + 3 个内部工具）的签名 / 返回值 / **同步语义一字不改**；云端只是「以本地 storage key 为逻辑 key」的 KV 镜像。云失败**静默降级本地，不改变任何 `ok` / `reason` / 业务返回值**。
- **默认关闭**：仅在 `CLOUD_CONFIG.enabled:true` ∧ 填入 `env` ∧ `wx.cloud` 能力存在 ∧ 用户已授权并开启同步时才联网。
- 平台铁律不变：纯 JS / CommonJS / Canvas 2D，无 DOM / eval / npm；所有 `.md` 被 `packOptions.ignore` 排除出代码包。

### 8.2 分层图（文本版，★ = 授权门控位置）

```
┌ 场景层  src/scenes/*（settings.js「账号与隐私」分组；对局内设置抽屉复用同一入口）
│    只调用 storage 的 28 个同步 API；不直接碰云、不感知云失败
│
├ 存储层  src/core/storage.js  ★唯一读写源★（wx.*StorageSync；无 wx 时回退内存 Map）
│    ├ addWriteHook(noteWrite)   本地写成功后仅登记 {opId,key,op,ts} 到 pendingQueue
│    └ applyRemote(k,op,v)       pull 回填时抑制 hook，防止「回填→再入队」回环
│
├ 同步层  src/core/sync.js       纯函数 mergeKey + start/flush/noteWrite/status/requestDeleteAll
│    └ ★授权门控 privacy.canSync()★ ← 唯一闸门：state=granted ∧ 用户开关 ∧ cloud.isEnabled()
│                                      缺一即零云调用（不 pull / 不 push / 不 init 追踪）
├ 隐私层  src/core/privacy.js    unknown → need → granted / denied
│                                 官方 wx.getPrivacySetting / wx.requirePrivacyAuthorize / wx.openPrivacyContract
├ 云层    src/core/cloud.js      wx.cloud.init({env, traceUser:false}) → wx.cloud.database()
│                                 值消毒 / key 白名单 / 字节上限 / db.serverDate() / 禁用 doc().set()
├ 配置层  src/config.js          CLOUD_CONFIG（enabled:false / env:'' / collections / schemaVersion /
│                                 debounceMs:600 / maxRetries:3 / retryBaseMs:1200 /
│                                 maxValueBytes:64KB / maxBatchBytes:400KB / tombstoneDays:90 / pullOnShow:true）
└ 云端（微信云开发 · 腾讯云境内 · 微信私有通道）
     ├ chess_state    每用户 1 文档（doc 级 rev CAS + keys.ops opId；不含点号，兼容读旧点号键）
     └ chess_records  每「本地 storage key」1 文档（per-key rev CAS + tombstone，value 清空为 null）
      两集合安全规则均在服务端强制：doc._openid == auth.openid
```

**启动接线**（`game.js`）：`switchTo('menu')` 先渲染本地 → `privacy.init()` 异步决议（不 `await`、不阻塞）→ `.then` 内 `sync.init()` + `sync.start()`；`sync.start()` 成功后调当前场景 `onDataChanged()` 刷新进度缓存；`GameContext.requestCloudPull()` 已挂载；`publishCheck()` 在 `enabled/env` 为空时 `console.warn`（不回显 env 值）。`onShow` 在 `_cloudPullDone=false` 且授权 / 云端就绪时**补做一次全量 `sync.start()`**，否则仅 `privacy.refresh()` + `sync.flush()`。**绝不「先同步、后补授权」**。

### 8.3 模块职责

| 模块 | 职责 |
|---|---|
| `src/config.js` | `CLOUD_CONFIG`（开关 / env / 集合名 / `schemaVersion` / 节流 / 重试 / 字节上限 / `tombstoneDays`）；`STORAGE_KEYS` 新增 `privacy` / `profile` / `syncMeta` / `syncQueue` |
| `src/core/cloud.js` | 前端直连层：能力探测与惰性 `init`、值消毒、key 白名单（长度 ≤128）、字节上限、`db.serverDate()`、`getStateDoc/putStateDoc`、`listRecords`（20 条分页）、`putRecord`（per-key rev CAS）、`markDeleted`（**写 `value:null` 的 tombstone，不留明文**）、`deleteRecordDoc`、`deleteStateDoc`（物理删 `chess_state`） |
| `src/core/sync.js` | 同步与合并：`mergeKey` 纯函数、`start`（pull→merge→回填→push，**仅 `changed || push(与远端差异)` 入队**）、`flush`（**每批 ≤10 并发**）、`noteWrite`（写 hook，**过 `_canSync()` 门控**）、`clearPending`（清队列 / 定时器）、`status`、`requestDeleteAll`（末尾物理删 `chess_state`）、`pendingQueue`（按 key 去重 + 500 上限、超限 op 达 `maxRetries` 移出）、`OPS_KEY='ops'` 与 `opId` 去重 |
| `src/core/privacy.js` | 授权状态机 + **唯一门控 `canSync()`**；`openContract(onFail)`（能力缺失 / 平台 fail / 抛异常 → `onFail`，至多一次）；持久化 `chess.privacy.v1` 仅含 `{state, updatedAt, cloudSyncEnabled}`，**绝不含个人信息** |
| `src/core/storage.js` | 唯一读写源；`saveSettings` / `saveLastConfig` / `saveResume` 写入对象补 `updatedAt`（LWW 时间戳）；新增 `addWriteHook` / `clearWriteHooks` / `applyRemote` 三个增量导出，**28 个既有导出签名 / 同步语义不变** |
| `src/scenes/settings.js` + `src/data/privacy.js` | 「账号与隐私」分组；隐私声明 fail / 接口缺失时本地 8 段声明一定可达且至多一次；DENIED 点击开关先 `refresh()` 再 `requestCloudPull()`；关闭开关调 `sync.clearPending()`；昵称清洗控制字符并 ≤12 字；文案为纯常量 |
| `game.js` | 启动 / `onShow` 接线；`sync.start()` 成功后 `notifySceneDataChanged()`；`publishCheck()` 启动告警；模块加载期零云调用 |

### 8.4 两集合结构与安全规则

**`chess_state`**（每用户 1 文档）：

```jsonc
{
  "_openid": "<平台自动注入>",
  "rev": 1,                       // 单调整数，doc 级 CAS = where({_openid, rev}).update()
  "updatedAt": "<db.serverDate()>",
  "schemaVersion": 1,
  "keys": {
    "ops": ["<已处理 opId>"]                 // 键名不含点号（OPS_KEY='ops'）；上限 500，失败重试去重；兼容读迁移期旧点号键 chess.sync.ops.v1
  }
}
```

**`chess_records`**（每「本地 storage key」1 文档，`key` 保留本地前缀）：

```jsonc
{
  "_openid": "<平台自动注入>",
  "key": "chess.record.v1.<gameId>",   // 或 chess.settings.v1 / chess.endgame.v1 / …
  "value": { /* 该 key 的本地值，经消毒 */ },
  "rev": 1,                            // per-key CAS = where({_openid, key, rev}).update()
  "updatedAt": "<db.serverDate()>",
  "deleted": false,                    // true = tombstone（逻辑删除）
  "schemaVersion": 1
}
```

**安全规则**（两集合相同，服务端强制）：

```json
{
  "read": "doc._openid == auth.openid",
  "write": "doc._openid == auth.openid"
}
```

**查询 / 写入约定**：所有 `where` 必带 `_openid: '{openid}'`；**禁用 `doc().set()`**（该规则下会失败），创建走 `collection.add()`、更新一律 `where().update()`；丢弃客户端传入的 `_openid` / `_id` / `$` 前缀键；写入时间戳用服务端 `db.serverDate()`，而 LWW 合并判定**综合「记录自带 `updatedAt`」与「服务端 `db.serverDate()`」**（优先记录自带字段）；单 key ≤ `maxValueBytes`(64KB)、整批 ≤ `maxBatchBytes`(400KB，< 前端 512KB)。

### 8.5 同步契约

| 机制 | 实现 |
|---|---|
| `rev` CAS | 每次写带 `expectedRev`，`where({_openid, key, rev}).update()`；`stats.updated === 0` 视为冲突 → 重新 pull → 逐 key merge → 回填 → 重试（≤ `maxRetries:3`） |
| 授权门控 `noteWrite` | 写 hook 先过 `_canSync()`（`granted` ∧ 用户开关 ∧ `cloud.isEnabled()`）与 `cloud.isEnabled()` 双门控；未授权 / 未启用**不入队、不调度**，杜绝「先收集后补授权」与队列无限增长 |
| `clearPending` | 设置页关闭云同步开关时调用：清空 `_pending` 与 debounce 定时器并持久化空队列，**绝不补传历史数据** |
| `opId` 幂等 | `pendingQueue` 每项带 `opId`；云端 `chess_state.keys.ops` 存已处理 `opId`（`OPS_KEY='ops'`，键名不含点号；上限 500，裁剪；兼容读旧点号键 `chess.sync.ops.v1`），跳过重复项 |
| `pendingQueue` 增量与失败重试 | `_addPending` **按 key 去重** + `PENDING_LIMIT=500`（超限保留最新）；写 hook 仅登记 `{opId, key, op, ts}`，不携带 value；`flush` 时复读当前本地态（天然合并 debounce 期间的多次写）；失败留队列，下次 `onShow` / 写操作 / 冷启动重试；**不可恢复失败（超字节 / 脏值 / 非法键）累计达 `maxRetries` 后移出队列**，本地值不变；落本地 `chess.sync.queue.v1` |
| 增量入队（`start`） | pass3 **仅对 `changed`（合并结果与本地差异）或 `push`（与远端差异）的 key 入队**；稳定态本地 / 远端 / 合并结果三者一致时**零入队**，避免每次冷启动全量 `where().update()` |
| 分批 `flush` | `_doFlush` 每批 **≤10** 个 `_pushKey` 并发（`BATCH_SIZE=10`），避免 `clearAllRecords` 时 50+ 并发触发平台限流；`_flushPromise` 串行化 |
| LWW `deleted` 传播 | `_mergeLWW` 遇 `rem.deleted` 返回 `{value:null, deleted:true, changed:true}`；`start()` 对 deleted 走 `applyRemote(key,'remove')` 且 pass3 **以 `remove` 入队**，杜绝「一端删除被另一端旧本地值撤销」 |
| tombstone | 删除 = `deleted:true` **逻辑删除**，且 `markDeleted()` 把 `value` 清空为 `null`（**不留任何明文**）；`mergeKey` 中 **tombstone 优先**（删除优先于更新）；满 50 裁剪 `index.ids` 时为被裁局生成 tombstone；`requestDeleteAll()` 末尾 `deleteStateDoc()` **物理删 `chess_state`**，`deleteRecordDoc()` 物理删单条 |
| `updatedAt` 字段 | `storage.saveSettings/saveLastConfig/saveResume` 写入对象补 `updatedAt = Date.now()`；`sync._ts()` 优先取记录自带 `updatedAt`，否则回落服务端 entry (`db.serverDate()`) 时间戳——修掉「本地新值被云端旧值覆盖」 |
| 节流 / 串行 | `debounceMs:600` 合流；`flush` 用 `_flushPromise` 串行化，避免并发 |

**字段级语义合并表**（`mergeKey`，纯函数，不读 storage / 不碰 wx / 不改模块状态）：

| key / 类型 | 合并策略 |
|---|---|
| `chess.endgame.v1` | `unlockedLevel`、`cleared[*].stars`、`stats.totalAttempts/totalClears` 取 **max**；`cleared[*].bestTimeMs/bestMoves` 取 **min(>0)**；`cleared[*].rewarded` 取 **OR**；`tipsCollected` 取**并集去重**；`skills`（按 id 聚合、>8 确定性裁剪）与 `pendingHints` 用**局部 LWW**（`updatedAt` 较新一侧整体为准）；`updatedAt = max` |
| `chess.records.index.v1` | `ids` **并集、按「最新在前」保序**（纯函数无逐局 `endedAt` 上下文，以保序并集近似倒序）、**满 50 裁剪最早局**并生成 tombstone；`updatedAt = max` |
| `chess.record.v1.<id>` | **tombstone 优先**；否则 `updatedAt` **LWW**（严格 `>`，同刻本地优先） |
| `settings` / `tutorial` / `lastConfig` / `resume` / `profile` / `endgameResume` | `updatedAt` **LWW**（严格 `>`，同刻本地优先）；`settings` 以 `DEFAULT_SETTINGS` 补齐默认值 |
| 本地控制键 `chess.privacy.v1` / `chess.sync.meta.v1` / `chess.sync.queue.v1` / `chess.sync.ops.v1`（旧 ops 键）/ `ops`（新 ops 键） | **不镜像**（`LOCAL_ONLY`）；隐私同意态不跨设备；ops 键仅作为 `chess_state.keys` 内部字段，不当业务 key 同步 |

合并前所有远端值先经默认值补齐 / 归一化（复刻 `storage._normalizeEndgame` 思路）再合并，脏值拒绝；`mergeKey` 返回 `{value, changed, lww?, tombstones?, deleted?}`，`changed` 决定是否 `applyRemote` 回填。

### 8.6 授权门控与降级矩阵

`canSync()` = `state === granted` ∧ 用户云同步开关 ∧ `cloud.isEnabled()`。授权走官方接口；**拒绝授权 = 仅本地模式，零云调用，玩法不受影响**。

| 授权态 | `CLOUD_CONFIG` | `wx.cloud` | `canSync()` | 行为 |
|---|---|---|---|---|
| `unknown` / `need` | 任意 | 任意 | false | 仅本地、零云调用；`need` 可重复进入，等待授权决议 |
| `denied` | 已配 | 可用 | false | **仅本地模式、零云调用、玩法不受影响**；设置页可重新授权 |
| `granted` | `enabled:false` 或 `env:''` | — | false | **默认关闭：仅本地、零云调用**（六套 Node 回归即此形态） |
| `granted` | `enabled:true` + env | 不可用（能力缺失 / 旧基础库 / init 失败） | false | 静默降级本地、零云调用 |
| `granted`，用户关闭云同步开关 | 已配 | 可用 | false | 仅本地、零云调用，可随时开启 |
| `granted` + 开关开 | `enabled:true` + env | 可用 | **true** | `pull → merge → push`；云失败静默降级本地，**不改变任何返回值** |

补充：基础库降级（无 `getPrivacySetting` / `requirePrivacyAuthorize`）时 `privacy.js` 视为 `GRANTED`，但 `canSync()` 仍叠加 `cloud.isEnabled()`，因此**未配 env 时永远不同步**——这是六套 Node 回归全绿的关键。

### 8.7 首次上云与清缓存 / 换设备恢复流程

1. 冷启动：`game.js` 先 `switchTo('menu')` 渲染本地数据（不阻塞主循环）→ `privacy.init()` 异步决议。
2. 授权通过后 `.then` 内 `sync.init()`（注册写 hook、读 `syncMeta`）+ `sync.start()`。
3. `start()`：`_pullState()`（取 `rev` 与已处理 `opId`）→ `_pullRemoteEntries()`（`listRecords` 按 20 条/页翻页）→ `keys = union(本地键全集, 远端键)`。
4. **逐 key `mergeKey`**（字段级语义合并）→ `changed` 时 `storage.applyRemote()` 回填本地（**抑制 hook 防回环**）；残局数据恢复正常存储路径。
5. 满 50 裁剪产生的 tombstone → 本地删除对应 record 文档（`flush` 复读即得到 `null` → 推 tombstone）。
6. **把「合并结果」入队**（`_addPending`），随后 `flush()` 统一 push；**绝不 push 原始本地值覆盖云端**；云端无该 key 时才以合并结果 `add()` 创建。
7. `onShow` 默认只做 `privacy.refresh()` + `sync.flush()`；若冷启动的全量 pull 因未授权 / 未启用未完成（`_cloudPullDone=false`），此刻授权、云端就绪则**补做一次全量 `sync.start()`** 并通知场景刷新，之后置 `_cloudPullDone=true`，不重复。

**清缓存 / 换设备恢复**：本地为空时，`mergeKey` 的 `hasLocal=false, hasRemote=true` → 直接以远端值为结果回填 → 进度 / 棋谱 / 设置恢复；随后 push 合并结果。**不会用本地空数据覆盖云端**。

### 8.8 失败与重试

- `cloud.js` 不可用时所有异步方法返回**已决议** `{ok:false, reason:'unavailable'}`，**绝不抛异常、绝不返回 rejected Promise**（每条链末端都有 `.catch`）。
- 云失败**静默降级本地**：不改变 `storage` 的 `ok` / `reason` / 残局增量 API 的业务返回值；无报错弹窗、不阻塞主循环。
- 错误归一为 `timeout` / `denied` / `network` / `error`；`updated:0` 冲突走「重拉 → 合并 → 重试」，超过 `maxRetries:3` 返回 `conflict`。
- 失败操作留在 `pendingQueue`（本地持久化 `chess.sync.queue.v1`），由 `onShow` / 下次写 / 下次冷启动重试；`_flushPromise` 保证串行。
- `syncMeta`（`lastPullAt` / `lastPushAt` / `stateRev` / `ops`）落本地，供 CAS 与去重恢复。

### 8.9 测试门禁（当前全量口径，2026-11-10）

> 本节为**当前**口径；逐套命令与数字同时维护在 `README.md`「测试（回归门禁）」。§8.1 上方注记与 `REMAINING_OPTIMIZATION.md` 中的 `327/0` 等均为历史基线。

| 命令 | 结果 | 覆盖 |
|---|---|---|
| `node test.js` | 9 项检查 | 规则 / 将杀 / 易位 / 升变 / AI |
| `node test-integration.js` | **96/0** | 场景栈 / 导航 / 输入防误触 / 存储返回值；含 `versus` 单入口与 room 场景 |
| `node test-engine.js` | **62/0** | 契约 / registry / 适配器 / 残局存档 API |
| `node test-endgame.js` | **100/100 阵** | 强制杀可达性 + 数值表一致性 |
| `node test-endgame-scene.js` | **86/0** | S9 阵图 + S10 状态机 / 软计时 / 机会经济 / 技能 / 星级 / 模态流程 |
| `node test-gameplay.js` | **98/0** | 玩法 / 固定朝向 / 远程视角 / 退出仲裁 / 兵力判定 / 心跳 / 棋谱三态 / `rejoinEntry` |
| `node test-room.js` | **153/0** | 远程房间协议 v5 / 6 位数字码 / `rev` CAS / 心跳在线态 / 退出与双方退出 / 封存续局端到端闭环 / `sweepAbandoned()` 最终一致性兜底 / 6h 过期 |
| `node test-cloud.js` | **111/0** | `cloud.js` 能力探测 / `init` / 值消毒 / 字节上限 / tombstone 无明文 / `deleteStateDoc` 物理删 / 故障注入 |
| `node test-sync.js` | **177/0** | `mergeKey` 字段级语义 / CAS 冲突重拉 / `opId` 去重 / tombstone / pendingQueue / 授权门控 / `requestDeleteAll` |
| `node test-recovery.js` | **86/0** | 端到端清缓存恢复：设备 A 造进度推云 → 清缓存 → 设备 B 重加载 `start()` → 28 个读 API 精确恢复 → 场景自愈 → 删除不复活 |
| `node tools/verify-round2.js` | **81/0** | 第二轮审查自动断言（功能链路 + 多视口命中区 + 胶囊避让 + 语义） |
| `node tools/render-shots.js` | **47 成功 / 0 失败 / 0 跳过** | 离线真渲染出图与视觉回归（含 375 / 320 两档仲裁模态） |
| `node tools/publish-check.js` | 默认 rc=0（阻断 1 / 通过 8）；`--strict` rc=1 | 只读发布前自检：配置 / 集合名 / 【待填】/ 过时文案 / 禁用 API；唯一阻断项为 `PRIVACY_POLICY.md` 6 处【待填】，属上线前须由运营方填实的真实信息，**不得编造或放宽检查绕过** |

十套 Node 回归在纯 Node 环境执行，无需微信运行时；无 `wx.cloud` 时能力探测静默降级，故与云端配置开关无关、始终全绿（云端当前已开启，见 §8.12）。所有 `.md` / `test*.js` / `tools` / `review-shots/` 均被 `packOptions.ignore` 排除出代码包。

### 8.10 已知取舍

1. **增减型字段局部 LWW**：`skills` / `pendingHints` 采用「`updatedAt` 较新一侧整体为准」而非严格 CRDT 计数；多端并发各自消耗 / 获取技能时可能以较新一侧为准，存在少量丢失。
2. **`stats` 取 max 可能低估**：`totalAttempts` / `totalClears` 两端各自累加后取 `max`（而非求和），会低于真实总次数。
3. **tombstone GC 未启用**：`tombstoneDays: 90` 已配置但**本版本不启用定时物理清理**，墓碑记录不会自动物理删除；墓碑本身 `deleted:true` + `value:null`，**不含任何游戏明文**。物理删除发生在用户主动删除（`requestDeleteAll` 全量写墓碑并**末尾 `deleteStateDoc()` 物理删 `chess_state`**，`deleteRecordDoc` 物理删单条）或未来启用 GC。**删除小程序不会自动清云端数据**，需用户先主动删除云端数据。
4. `index.ids` 并集按保序近似「最新在前」，纯函数无逐局 `endedAt` / `createdAt` 上下文。
5. **隐私同意态不跨设备镜像**（`LOCAL_ONLY`），换设备后需重新授权；这是合规设计而非缺陷。
6. `mergeKey` 中 tombstone 优先 = **删除优先于更新**，多端「一端删、一端改」时以删除为准。

### 8.11 与部署 / 合规文档的关系

| 文档 | 内容 |
|---|---|
| `CLOUD_DEPLOY.md` | 架构图、前置条件、可复制操作清单（集合名 / 安全规则 JSON / 索引 / 初始化片段 / 验收自查）、配额限制、**27 项需确认清单（§6.0 已定稿项）**、环境核查结论、风险分级、**§10 第八轮红线修复** |
| `PRIVACY_POLICY.md` | 完整可托管隐私政策（收集范围、境内存储、儿童专章、防沉迷、用户权利、拒绝授权仅本地模式等） |
| `WECHAT_PUBLISH_GUIDE.md` | 上架材料、资质结论、时间线（含云开发 / 集合 / 安全规则 / 隐私指引 / 适龄 / 备案前置节点） |

### 8.12 远程双人对弈（chess_rooms · 本批次新增）

> 云端集合 / 规则 / 索引已由 MCP 直连落地并回读校验；`test-room.js`（153/0）已纳入十套回归全绿。合规与待办见 `PRIVACY_POLICY.md` §十三 / §十四、`CLOUD_DEPLOY.md` §12、`WECHAT_PUBLISH_GUIDE.md`。

**新增文件（目录树补充）**

| 文件 | 职责 |
|---|---|
| `src/core/room.js` | 房间独立通道（`chess_rooms` v5）：`wx.cloud.database()`（含 `.watch()`）、`movesUci` 权威着法日志、`rev` 版本号 CAS、2.5s 轮询兜底、6h 过期惰性判定、`deleteAllRooms()`；v5 新增双方自填昵称 / 局数比分 / 在线心跳 / 退出仲裁 / 封存残局续局 / 双方退出兜底补判（`sweepAbandoned()`） |
| `src/scenes/room.js` | 房间场景 `room`：建房 / 6 位数字房间码 / `wx.shareAppMessage` 分享卡片 / 手动输码加入 / 等待与加入失败态；`from==='versus'` 时 hub 相位「返回」回选择页，否则回菜单 |
| `src/scenes/versus.js` | 对局方式选择页 `versus`（注册名 `versus`）：主卡「本地双人」→ `replaceScene('gameplay',{mode:'local'})`；次卡「邀请好友加入」→ `pushScene('room',{from:'versus'})` |
| `test-room.js` | 远程对局房间协议 v5 离线 / 集成验收（**153/0，已纳入十套回归**；含封存续局端到端闭环与 `sweepAbandoned()` 超时兜底） |

**云端集合与规则**

`chess_rooms`（一房间 1 文档），安全规则 `{"read":true,"create":"doc._openid == auth.openid","update":true,"delete":"doc._openid == auth.openid"}`；索引 `_id_` / `_openid_1` / `idx_roomId`（唯一）/ `idx_status_expireAt`（status,expireAt），MCP 回读已确认。与个人进度两集合（`chess_state` / `chess_records`，规则不变、存量数据不受影响）并列但**用途分离**；§8.1–§8.11 中「两集合」均指个人进度链路。

**双通道同步**

```
.watch() 实时推送（主）+ 2.5s 轮询兜底（断线 / 小游戏端能力缺失时补齐）
movesUci（权威着法日志，各端自行回放）+ rev 版本号 CAS（并发写抑制）
房间 6h 过期（expireAt）；无服务端定时清理，靠前端惰性判定 + 房主 / 删除云端数据清理
```

`read:true` 是跨 `openid` 用 `.watch()` 实时监听房间文档的硬性前提；好友加入后，同一房间内双方各自可见对方的 `_openid` 标识、对局着法 / 结果，以及**双方各自自填的昵称**。**房间文档含双方用户自填昵称**（`hostNick` / `guestNick`，建房 / 加入时本人输入，≤12 字、去控制字符，非微信昵称；仅用于房间内展示与棋谱里显示对手，可见范围仅同一房间内双方，随房间过期 / 删除清除）；**仍不含微信头像、微信昵称、手机号、位置、通讯录**。`seat` 为随机串而非 `openid` 明文。

**房间文档字段（`chess_rooms` v5，`src/core/room.js` 的 `createRoom()` 在 `add()` 里一次性写入）**

| 分组 | 字段 |
|---|---|
| 基础 | `_id` / `_openid`（房主，**平台在 `add()` 时注入**、客户端绝不显式写）、`roomId`、`hostSeat` / `guestSeat`（随机席位串）、`hostColor`、`status`（`waiting` / `playing` / `finished` / `archived` / `abandoned`）、`movesUci`、`turn`、`rev`、`lastSeat`、`result` / `resultReason`、`schemaVersion`、`createdAt` / `updatedAt` / `expireAt` |
| 双方自填昵称 | `hostNick` / `guestNick`（≤12 字、去控制字符，`joinRoom(code,{nick})` 写入 `guestNick`） |
| 局数与比分 | `maxGames`（0=不限）、`gameIndex`、`gamesPlayed`、`hostScore`、`guestScore`（平局不计） |
| 在线态 | `hostPresent` / `guestPresent`、`hostLeftAt` / `guestLeftAt`、`hostOnlineAt` / `guestOnlineAt`（心跳维护，判断对方是否退出） |
| 封存与保留 | `archived` / `archivedMovesUci`（完整着法快照）/ `archivedAt` / `archivedBy`、`keepUntil`（双方均退出后的保留截止） |

**未变的既有机制**：`rev` 版本号 CAS（`where({roomId, rev}).update()` 防并发覆盖）、`_openid` 平台注入、`idx_roomId` 唯一索引、`expireAt` 6 小时过期（前端惰性判定、无服务端定时清理）均保持原样；安全规则与 4 个索引见 §8.12 上文与 `CLOUD_DEPLOY.md` §12.1 / §12.2。

**v5 协议层能力（`src/core/room.js` 的 v5 新增导出）**：`heartbeat()` / `markLeft()` / `markBothLeft()` / `rejoinRoom()` / `setMaxGames()` / `recordGameResult()` / `archiveGame()` / `finishByMaterial()` / `listArchivedRooms()` / `sweepAbandoned()` / `readLocalRoom()` 等。退出仲裁：一方退出写 `present=false + leftAt` 且席位保留供重新加入；轮到退出方出棋超 `leaveTimeoutMs`（60s 墙钟）后未退出方可选继续等待 / 封存残局 / 结束对弈，结束按剩余兵力判定（退出方永不可被判胜）；双方均退出保留 `bothLeftKeepMs`（10 分钟）后自动解散并封存残局、不判成绩；封存残局 `archiveKeepMs`（设计 7 天，前端惰性判定）供房主 `createRoom({seedMovesUci})` 续局，`listArchivedRooms()` 按 `_openid` 仅查本人房主创建的封存房。棋谱侧：`src/data/recordLabels.js` 统一 `MODE_LABEL = {ai:'人机对战', local:'本地双人', remote:'远程对弈'}`，列表与回放页显示模式标签；远程棋谱 `opponent` 为对端自填昵称（回落「远程对手」）并带 `opponentNick`，远程对局也写入本地棋谱（存本机 `chess.record.v1.*`，经个人进度云同步镜像到 `chess_records`）。完整合规披露见 `PRIVACY_POLICY.md` §十三 / §十四。

**零云函数、无服务端定时器（最终一致性边界）**：项目不部署云函数，云端没有定时任务，双方均退出后 `keepUntil`（10 分钟）到期**不会在精确时刻**自动解散。任一端重新进入房间页时，`src/scenes/room.js` 的 `_loadArchived()` 先调用 `room.sweepAbandoned()` 按 `keepUntil` 补判超时房（CAS 写 `archived=true` / `archivedMovesUci=movesUci` / `archivedAt` / `status='abandoned'` / `rev+1`，**不写 `result` / `resultReason`，即不判成绩**），再 `listArchivedRooms()` 拉取封存列表；`sweepAbandoned()` 幂等，重复扫描不二次封存。两端均退出且无人回来时，补判延后到有人回来或 6h 过期惰性判定为止。协议侧断言见 `test-room.js` §24。

**信息架构 / 场景跳转（§5 IA 补充）**

```
menu ──「双人对弈」(单入口, key:'versus', 图标 twoPlayers)──► versus（对局方式选择页）
   ├─(本地双人 主卡·默认)──► gameplay(mode:'local')   棋盘方向全程固定
   └─(邀请好友加入 次卡)──► room ──(建房/分享/输码加入成功)──► gameplay(mode:'remote')
   分享卡片 query: room=xxxxxx ─► 冷启动 getLaunchOptionsSync / getEnterOptionsSync ─┐
   热启动 wx.onShow(res.query) ─────────────────────────────────────────────────────┤
                                                                                    ▼
                                      直接进 room（不经 versus）→ gameplay(mode:'remote')  双机各用自己设备、不共用屏幕
```

分享链接冷 / 热启动**直达 `room`**（不经选择页）。导航语义（两条返回路径不同）：`versus` → 本地双人用 `replaceScene('gameplay',{mode:'local'})`（过渡页不进栈）；`versus` → 邀请好友加入用 `pushScene('room',{from:'versus'})`；`versus` 顶栏返回 `popScene()` 回主菜单；`room`（hub 相位，`from==='versus'`）返回为 `emit('navigate',{to:'versus'})` + `popScene()` → **回选择页**，`room`（`from==='menu'`）返回为 `emit('navigate',{to:'menu'})` + `popScene()` → **回主菜单**。

各端固定看自己执棋色一侧、全程不随回合翻转；本地双人棋盘方向亦改为**全程固定**（默认白在屏幕下方，仅手动调转且持续保持），上方一侧棋子旋转 180° 朝上。

**为何独立通道、不与个人进度同步混用**

`room.js` 直连 `wx.cloud.database()`，**不经过** `sync.js` 的个人进度同步，也不经过 `storage.js` 的 `addWriteHook` 写 hook 与 `KEY_RE` 键名白名单。若房间写入误走写 hook，会被登记进 `pendingQueue`、经 `mergeKey` 合并并 `applyRemote` 回填本地，**污染棋谱 / 设置 / 残局进度等个人存档**，甚至把对局着法镜像成 `chess_records` 文档。`sync.requestDeleteAll()` 仅在末尾调用 `room.deleteAllRooms()` 清理本人房间，除此之外两条链路零交叉；删除链路的二次确认文案已同步说明会删除本人房间。

**避坑清单（本批次补充）**

- `read:true` 与 `.watch()` 跨 `openid` 是绑定关系：要实时监听他人创建的房间，读规则就不能是「仅本人可读」；可见范围必须靠高熵房间码（6 位数字、`10^6` 组合、分享链接即凭证）收敛，并在隐私文本中如实披露。
- **前端查询条件必须是安全规则的子集**：`chess_state` / `chess_records` 下所有 `where` 必带 `_openid`；本集合 `read` / `update` 为 `true`，故该约定**不适用于 `chess_rooms`**（但仍以 `roomId` + `rev` 条件更新，不用 `doc(id).update()` / `doc().set()`）。
- 房间码高熵要求：6 位数字是下限，分享链接即凭证；无云函数 ⇒ 无法在服务端校验走子合法性或做权威反作弊，靠房间码 + `rev` CAS + 席位串在应用层识别（好友休闲对弈取舍，见 `PRIVACY_POLICY.md` §十三）。

> §8.1–§8.11 描述个人进度同步链路（v3 云端化交付轮次的历史口径，当时云端默认关闭、未创建云端资源）；**2026-11-08 起的最新云端状态**（`CLOUD_CONFIG.enabled:true`、`env` 已填、三个集合与安全规则 / 索引已落地并经 MCP 回读校验）见 §8.12 与 `CLOUD_DEPLOY.md` §11 / §12。本批次新增的远程对局为独立通道，不改变 §8.1–§8.11 所述个人进度同步逻辑。

