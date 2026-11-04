# 国际象棋小游戏 · 整体交互与体验优化（审计 + 方案 + 设计规范）

> 审计日期：2026-11-02 · 视角：布局 / 交互 / 和谐 / 细节四维度
> 审计方式：对 `src/scenes/*.js`、`src/core/*`、`src/render/*`、`src/config.js`、`src/engine/*` 与 `V2_UX_SPEC.md`/`V2_VISUAL_SPEC.md`/`BRAND.md`/`ARCHITECTURE.md` 做只读代码级走查（三个并行审查 worker，结论已交叉验证）
> 已排除项（上期已修，不重复计）：安全区避让已落地、`TF` 字号 Token 化完成、`V2_VISUAL_SPEC §11` 对比度规范 + menu/academy 对比度已修、截图三问题已修

---

## 0. 现状评分总览（1–10）

| 维度 | 评分 | 一句话结论 |
|---|---|---|
| 布局合理性 | **7.0** | 安全区大体稳健，失分集中在 records 底边、setup 矮屏重叠、契约未全量消费 |
| 交互流畅性 | **7.0** | 按下/禁用/空状态反馈扎实，但缺场景转场、无音效、后台丢局、结算次操作弱可点 |
| 整体和谐度 | **8.5** | 金色悦己品牌高度统一、游戏化贯穿；失分在「锦囊囊」错词与提示术语混用 |
| 细节考究 | **8.0** | MOTION/状态双编码/空状态到位；失分在 Banner 安全区、tap 缺缓动、符号未令牌化、长按未用 |

**核心结论**：整体已达「可用且调性统一」，但存在 **1 个 Blocker 级逻辑锁死** 与一批 Major 级体验硬伤，集中在「转场/反馈/恢复/术语一致」四件高频感知点上。

---

## 1. 问题清单（按四维度，含严重度 · 文件:行）

### 1.1 布局合理性（Layout）
- **L1【Major】Banner 浮层未避让安全区**：`src/scenes/manager.js:286-304` 横幅停在 `y=0`，正压状态栏/右上胶囊/顶栏标题，刘海机型像 bug。
- **L2【Major】records 底边硬编码 `H-16`**：`src/scenes/records.js:132` 未读 `L.safe.bottom`，home-indicator 机型最底卡片热区被系统手势吞掉。
- **L3【Major】setup 黑棋提示与「开始对局」矮屏重叠**：`src/scenes/setup.js:243/247` 矮屏（H≲600）`hintY > startY`，提示压住主按钮。
- **L4【Minor】安全区契约使用不一致**：`menu.js:67`、`records.js:132`、`academy.js:125`、`gameplay.js:267`、`setup.js:77` 仍用 `H-12/H-16/H-84` 等硬编码 inset，未全量消费 `layout.js` 契约。
- **L5【Minor】对手牌将军徽章与吃子区右上重叠**：`src/scenes/gameplay.js:675/678` 被将军且有吃子时红徽章与吃子串在右区打架。

### 1.2 交互流畅性（Interaction）
- **I1【Major】场景切换无转场**：`src/scenes/manager.js:324-339` `_activate` 硬切；`config.js` 与 `manager.js` 已定义 `MO.transition(240)` 却零消费。
- **I2【Blocker】AI 模式执黑首手悔棋软锁**：`src/scenes/gameplay.js:1402-1432`（`:1409-1411`、`:1414`）。执黑→AI 走首手→悔棋→`state='IDLE'` 但未 `startAIThinking()`，玩家与 AI 均不再行动，对局永久卡死（且因无中途存档等于丢进度）。可复现：setup 选执黑→进对局→AI 走 1 手→点悔棋。
- **I3【Major】断点恢复触发过窄 + 无周期自动保存**：`game.js:141-168`、`gameplay.js:1444-1461 & 246-253`。`saveResumeSnapshot` 仅「确认离开」时写；`tryOfferResume` 仅 `wx.onShow` 且当前为 menu 时弹一次（`_resumeOffered` 一次性）。中途崩溃/被杀无快照，正常「返回菜单」也不提示续下。
- **I4【Major】结算卡第三行次操作无按钮底**：`src/scenes/gameplay.js:953-965`「查看棋谱/保存本局/‹悔棋继续」为纯彩色文字，同模态内主按钮有底、次操作无底，可点性不一致。
- **I5【Major】非法走子 / 未达成将杀无明确反馈**：`gameplay.js:1167-1168`、`endgame.js:1705-1706`。非法落点静默取消选中；残局走出「合法但不将杀」步无中途引导，直到 `moveCap`/终局才感知。
- **I6【Minor】恢复后 `startedAt` 重置致时长失真**：`gameplay.js:189` / `restoreFromMoves:227-243` 未回填原始开始时间。
- **I7【Minor】残局提示搜索期间开设置抽屉仍后台计算**：`gameplay.js:565-572` 模态未暂停 `hintSearch`，结果盖在模态下。
- **I8【Minor】教学多步课程「一步即标完成」**：`teaching.js:728-738` `correct()` 不论 `subIndex` 直接整课 `completed=true`，第 8 课第 1 子步（短易位）即整课完成，跳过吃过路兵/升变等关键练习。

### 1.3 整体和谐度（Harmony）
- **H1【Major】残局 HUD 错词「锦囊囊」+ 术语混用**：`endgame.js:980`/`1805` 写「锦囊囊」；`:1306` 失败卡称「教练提示」、别处称「锦囊提示」，破坏游戏化包装连贯性。
- **H2【Minor】教学图例与高亮语义色不对齐**：`teaching.js:35-39` legal/capture 同金仅 alpha 差；`:343-345` 图例用 ●/◎/◆ 符号，实际为同色块，「可走/可吃」初学者难辨。
- **H3【Minor】残局星级锚点偏移**：`endgame.js:1019` `drawStars(W/2 - stars*12,…)` 星宽≈21 却按 12 偏移，3 星时整体偏左。
- **H4【Major·已知缺口】音效资源缺失**：`audio.js:40-64` 依赖 `assets/audio/*.mp3`，仓库零 `.mp3`；`game.js:56` 静默降级。关键事件（落子/将军/胜负/提示）无声，反馈强度折半。

### 1.4 细节考究（Detail）
- **D1【Major】Banner 信息无形状编码**：`manager.js:296-302` 仅底色区分 success/danger/info，违反 BRAND §5「状态色+形状双编码」，色障者难分。
- **D2【Minor】触控反馈缺 tap 90ms 缓动**：`src/render/ui.js` `drawButton` pressed 为瞬时二态，未用 `MOTION.tap(90)` ease-out tween（无回弹）。
- **D3【Minor】符号字形绕过字体令牌**：`menu.js:142/171`、`setup.js:147/205`、`records.js:228`、`gameplay.js:908/979/1011`、`teaching.js:524` 用 `'bold NNpx sans-serif'` 硬编码 ✓/›/✕ 等，未走 `TF()`（或不声明为固定符号）。
- **D4【Minor】长按微交互未落地**：`manager.js:121` `TouchGuard` 已支持 `longPressMs` 但无场景使用。
- **D5【Minor】库存溢出转提示无「获得额外提示」横幅**：`endgame.js:558-562/1802-1806` `pendingHints` 被消费但无告知。
- **D6【Minor】`recordAttempt` 每次 startLevel 自增**：`endgame.js:565` 重打/下一阵都 +1，与 `totalClears` 失配。
- **D7【Minor】`restoreFromMoves` 中途非法 UCI 静默截断**：`gameplay.js:227-243` `findMoveByUci` 返回 null 即 `break`，恢复出不完整局面却置 `IDLE` 续下，可能错位。
- **D8【Minor】`moveCap` 与将杀判负时机语义需澄清**：`endgame.js:1746-1760` 超步且恰好将杀仍判胜（逻辑对，但与 §1.2 字面有出入）。
- **D9【Minor】多棋类引擎抽象无消费方**：`src/engine/*` 完整可用，但所有场景 `require('../core/game')`，无棋种选择入口。

---

## 2. 优化方案（优先级）

### P0 — 立即修（Blocker）
- **I2 AI 悔棋软锁**：`gameplay.js:1414` 收尾改为
  `if (this.mode==='ai' && this.game.turn===this.aiColor) this.startAIThinking(); else this.state='IDLE';`
  （不再依赖「history>0 才二次撤销」隐式条件）。补单测覆盖「执黑首手悔棋」。

### P1 — 高价值 Major（建议第一批）
- **I1 场景转场**：`manager.js _activate` 接入 240ms 遮罩/淡入淡出（复用 `MO.transition`），消除硬切。
- **L1 Banner 安全区**：`manager.js:286-304` 横幅起点下移 `L.navSafeTop` 之下，避开顶栏/胶囊。
- **L2 records 底边**：`records.js:132` `contentBottom = L.contentBottom`（统一 `H - safe.bottom - 16`）。
- **L3 setup 矮屏**：`setup.js:243/247` 把黑棋提示并入开始按钮上方固定净空，保证 `hintY + 行高 ≤ startY`。
- **H1 术语统一**：`endgame.js:980/1805`「锦囊囊」→「锦囊」；`:1306`「教练提示」→「锦囊提示」，以 `V2_UX_SPEC §1.4/§1.6` 为准。
- **I5 非法/未达成反馈**：非法落点给 1 次 shake + Banner「这步走不通」；残局 `ownMoves` 接近 `targetMoves` 时预警「再 N 手内要将杀」。
- **I3/M2 断点恢复 + 自动保存**：菜单 `enter`/`popScene` 主动 `tryOfferResume()`；每 N 步或 30s 写 `chess.resume.v1`；移除 `_resumeOffered` 一次性限制；`onHide` 节流写快照。
- **D1 Banner 形状编码**：success/danger/info/warning 加 ✓/!/i/⚠ 形状前缀，保持文字对比度。

### P2 — 中价值（第二批）
- **I4 结算次操作按钮化**：`gameplay.js:953-965` 渲染为 ghost/文字按钮（带按下态与热区底）。
- **L5 将军徽章避让**：`gameplay.js:675/678` 被将军时吃子区右界左移 52pt。
- **I8 教学完成判定**：`teaching.js` 维护 per-lesson 子步完成集合，全部通过才写 `completed[lesson]`。
- **H2 教学图例对齐**：capture 用独立语义色或更大 alpha 差，图例符号与实际高亮一致。

### P3 — 打磨（第三批）
- **D2** tap 90ms 缓动 · **D3** 符号字形令牌化/声明 · **D4** 长按（棋盘预览走法、列表删除）· **D5/D6** 提示横幅与统计修正 · **D7** 恢复校验 `done===length` 否则 clearResume · **D8** 语义澄清文案 · **H3** 星级居中 · **H4** 补齐 19 个音频资源（资源就绪前用可见脉冲兜底）· **D9** setup/menu 增加棋种选择入口或文档明确「当前仅国际象棋，多引擎预留」。

---

## 3. 设计规范（可执行的落地规则）

> 以下规则为强制契约，新代码与本次修复须遵守；可作为后续 Code Review 与测试门禁的验收点。

**R1 安全区契约（布局）**
- 所有场景顶/右 inset 一律消费 `layout.js` 的 `navSafeTop` / `navRightAvoid` / `contentTop` / `contentBottom`；**禁止**硬编码 `H-N`、`safe.top+N` 作为顶/底 inset（Banner 浮层同等适用）。
- 矮屏（H≲600）须把提示区/按钮纳入同一竖向预算，预留 ≥ 行高净空，禁止任何重叠。

**R2 转场与动效（交互/细节）**
- 所有场景切换必须消费 `MO.transition(240)` 做遮罩/淡入淡出，**禁止硬切**。
- 按钮 pressed 态用 `MOTION.tap(90ms)` ease-out 缩放/透明度 tween（**无回弹**）；符号字形（✓/›/✕ 等）纳入 `TF()` 令牌或显式声明为「不缩放固定符号」。
- 善用已具备的 `TouchGuard.longPressMs` 落地长按（棋盘走法预览、列表删除）。

**R3 反馈三要素（交互/细节）**
- 任何用户操作（落子 / 非法 / 胜负 / 提示 / 解锁 / 获得奖励）必须同时具备「视觉脉冲 + Banner/Toast（+ 资源就绪后音效）」中**至少两种**。
- 非法落点：shake + 文案「这步走不通」；残局 `ownMoves` 接近 `targetMoves`：预警「再 N 手内要将杀」。

**R4 容错（细节/逻辑）**
- 对局每 N 步或每 30s 写 `chess.resume.v1` 快照；`onHide` 节流写快照；菜单进入/回栈主动 `tryOfferResume()`。
- `restoreFromMoves` 须校验 `done===movesUci.length`，否则 `clearResume()` 拒绝恢复错位局面；禁止静默截断。
- `startedAt` 随快照持久化，`restoreFromMoves` 后回填，时长不得失真。

**R5 术语与文案一致性（和谐）**
- 统一口径：**锦囊 / 锦囊提示 / 妙招 / 技能**；**禁止「锦囊囊」「教练提示」等混用**（以 `V2_UX_SPEC §1.4/§1.6` 为权威）。
- 游戏化链条 式·招·阵·破阵·妙招·出师 全场景贯穿，禁止跳戏。

**R6 状态双编码（和谐/细节）**
- Banner / 徽章 / 状态必须「颜色 + 形状」双重编码（BRAND §5），满足色觉障碍可达性；文字对比度遵守 `V2_VISUAL_SPEC §11`。

**R7 信息层级（布局/和谐）**
- 三级一致：唯一 Primary（主操作） / Secondary（次级） / ghost 文字按钮（文本操作，须带底与热区）。**模态/结算内次操作必须成按钮**，不得裸文字。

**R8 多尺寸稳健（布局）**
- 列表/网格滚动与分页、棋盘真居中沿用 `layout.js` 断点；新场景不得引入新硬编码 inset。

---

## 4. 实施建议与回归门禁
- 建议按 P0→P1→P2→P3 分批实施，每批结束跑五套回归：`test.js`(9) / `test-integration.js`(59) / `test-engine.js`(62) / `test-endgame.js`(100) / `test-endgame-scene.js`(84) 全绿。
- P0 的 I2 必须补单测（执黑首手悔棋不软锁）；P1 的 I3 补「崩溃恢复 / 中途自动保存」单测；P2 的 I8 补「多步课程全子步通过才完成」单测。
- 视觉类（L1/D1/R6）修复后建议补一轮离屏渲染核对（沿用 `@napi-rs/canvas` 方案），确认无遮挡/重叠/对比度回归。
- 音效 H4 为资源缺口，排期补齐 19 个 ≤30KB 单声道 mp3；资源就绪前以可见脉冲兜底关键事件。
