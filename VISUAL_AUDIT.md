# 视觉一致性终审报告（Visual Consistency Audit）

> 视觉设计架构师 / Phase 3 落地后终审 · 「只审不改」
> 范围：`src/config.js`、`src/render/*`、7 场景（menu/setup/gameplay/teaching/records/replay/settings）+ manager/anim/ai/board/pieces/icons。
> 基准：`VISUAL_DIRECTION.md` §8/§11 + `VISUAL_ADDENDUM.md` §A/§B/§J。
> 结论：**整体通过**，三条可访问性底线守住、防泄题双保险成立、REVEAL 金环已画出、彩色 emoji 已清零；发现 **1 项中优先级需修（REVEAL 脉冲相位）+ 2 项低优先级建议**。菜单/教学即将在 v2 重构，已在 §8 标注哪些结论会变、哪些是长期底线。

---

## 0. 终审结论总表

| # | 审查项 | 结论 | 严重度 | 归属 |
|---|---|---|---|---|
| 1 | Token 消费正确性 | ✅ 通过 | — | — |
| 2 | 三条可访问性底线 | ✅ 通过 | — | — |
| 2b | 关键信息未用 tertiary | ✅ 通过 | — | — |
| 3 | 防泄题双保险（TRY_PROMPT） | ✅ 通过 | — | — |
| 4 | REVEAL 目标格脉冲金环 | ⚠️ 金环已画出但脉冲相位偏差 | **中** | fe-logic（teaching.js） |
| 5 | 组件状态与规范一致性 | ✅ 通过 | — | — |
| 6 | emoji 清零 | ⚠️ 主路径清零，1 处兜底符号越界 | 低 | fe-logic（replay.js） |
| 7 | C1 棋盘真居中布局 | ✅ 通过 | — | — |
| — | 补充：主题置灰/难度 A 案 | ✅ 通过 | 建议 | — |

> **放行意见**：无阻断性硬伤，Phase 3 可进入交付汇编。建议将「#4 REVEAL 相位」作为交付前的小修（视觉侧可自行修正，见 §4），#6 兜底符号可列入下迭代清理。若工期极紧，二者均不阻断上线。

---

## 1. Token 消费正确性 —— ✅ 通过

### 1.1 抽查结论
| 文件 | 消费方式 | 结论 |
|---|---|---|
| `render/pieces.js` | `var C = config.COLORS` + `config.FONTS.piece` | ✅ 描边/渐变/投影全取 Token |
| `render/board.js` | `config.COLORS` / `config.BOARD.frame` / `config.RADIUS.chip` / `config.ELEVATION.e2` / `config.FONTS.coordinate` | ✅ |
| `render/ui.js` | `config.COLORS/FONTS/RADIUS/ELEVATION/LINE_HEIGHT/touchMin`，变体 PALETTE 全 Token | ✅ |
| `render/icons.js` | `config.COLORS.textSecondary` 作默认色 | ✅ |
| `manager.js` | `theme` = `Object.assign(FALLBACK, config.*)` —— config 覆盖兜底 | ✅ config 为单一真相源 |
| 7 scenes | 统一 `theme.colors/fonts/radius/motion`（= config 映射） | ✅ |

### 1.2 关于「硬编码色值」的说明（非缺陷）
grep 命中的 `#hex`/`rgba(...)` 分三类，**均非旧值回退**：
1. **Token 定义处**：`config.js` 全部色值、`manager.js` 的 `COLOR_FALLBACK`（作为 config 缺失时的兜底，值与 config 一致，且被 config 覆盖）——合理。
2. **局部派生的透明叠加**：如 `board.js` 木质渐变 `#3A2E22`→`#2A2118`、内层暗边 `#0B0F13`、釉面 `rgba(255,255,255,.05)`、将军径向 `rgba(217,106,106,α)`；`ui.js` danger 按下 `rgba(217,106,106,.14)`；各场景 `rgba(217,106,106,.10)` 危险项底、`rgba(0,0,0,.10)` 按下遮罩、`rgba(255,255,255,.02)` 交替行——这些是**基于语义色的透明派生**，属可接受的局部魔数，非独立色板。
3. **半透明工具函数**：`_alpha()`/`hexToRgba()` 动态派生——合理。

### 1.3 旧键别名
- `config.js` §175–191 保留 `_aliases`（bg/panel/buttonPrimary/whitePiece…）映射到新键，`FONTS.title/small` 补全——**仅为迁移期兼容，未发现场景层误用旧键渲染**（场景统一走 `theme`/语义新键）。✅
- 建议（低）：v2 重构时删除 `_aliases` 段，避免长期双键并存造成维护歧义。

---

## 2. 三条可访问性底线 —— ✅ 通过（最高优先级）

| 底线 | 校验路径 | 结论 |
|---|---|---|
| 白棋描边 `#2A2A28` | `config.pieceWhiteStroke` → `pieces.js:110` `strokeStyle = white ? C.pieceWhiteStroke : C.pieceBlackStroke`，lineWidth=size×0.035 | ✅ 所有 drawPiece/drawPieceWithShadow 路径（含缓存与飞行棋子）均保留 |
| 黑棋金边 `#C9A24B` | `config.pieceBlackStroke = #C9A24B` → 同上 else 分支，lineWidth=size×0.022 | ✅ 保留 |
| 黄铜禁作浅皮肤文字色 | `config.ACTIVE_THEME='dark'`（本期固定深色）；`LIGHT_COLORS.accentText='#8C6E2F'` 已预留浅皮肤文字替代；`config.js:128` 有显式警告注释；`settings.js` 浅色项为 disabled 置灰不可选 | ✅ 未违规（浅皮肤本期未启用） |

### 2b. 关键信息未用 tertiary —— ✅ 通过
- `textTertiary #6B7885`（≈3.2:1）仅用于：版本号（menu）、禁用文字、装饰 chevron、占位/空态水印副文——均在 §D 白名单内。
- 棋谱日期/步数/结果、题干、要点、选手牌名称等**关键信息**实际用 `textSecondary #9AA7B4`（≈7.2:1）或 `textPrimary`。抽查 `records.js` 行2、`replay.js` 记谱行均达标。✅

---

## 3. 防泄题双保险（补遗 §A.4）—— ✅ 通过

| 检查点 | 代码证据 | 结论 |
|---|---|---|
| 场景层考核态 highlights 传空 | `teaching.js:320-321` `showReading = phase===READING; miniHighlights = showReading ? toMiniHighlights(...) : []` | ✅ 非 READING 一律 `[]` |
| 未触发选中走法渲染 | `drawBoardOverlays` (teaching.js:393-446) **全程不绘制 legalMoves 点/环**；选中态仅画「选中金框」(line 404-408) | ✅ 走法点零绘制 |
| 渲染层 hideHighlights/suppressSelectedFrame | `board.js:85-89` 两开关齐备：`hideHighlights` 压制 lastMove/选中 tint/将军/合法点；`suppressSelectedFrame` 决定是否画选中环；`board.js:207` 合法走法受 hideHighlights 门控 | ✅ A.4.2 机制成形 |
| 起点金环语义正确 | `teaching.js:396-402` 起点脉冲金环注释「题干给定，非答案」，仅 hintLevel<3 显示 | ✅ 非答案泄露 |
| legalTargets 仅内部判定 | `teaching.js:251` 计算 legalTargets，`inLegal()` 仅用于 MISS/GUIDE 分类，注释明确「绝不用于考核态渲染」 | ✅ |

> 双保险成立：即便场景忘了传空，`board.js` 的 hideHighlights 也能兜底；反之 fe-logic 走 drawMiniBoard([])+自绘路径同样不泄题。

---

## 4. REVEAL 态专项 —— ⚠️ 需修（中优先级）

### 4.1 金环「是否画出」—— ✅ 通过（team-lead 专项必查点）
- `teaching.js:418-427`（`drawBoardOverlays` 内 REVEAL 分支）：对 `it.accept` 每个目标格画 `C.accent` 金色环，`lineWidth = max(2, cell*0.1)`，半径 `cell*0.42`。
- **确认**：金环确实被画出；未被选中环顶替（选中框在 line 404 仅 SELECTED/MISS 态，REVEAL 不进）；未漏画；用金色 `#C9A24B` 非将军红。✅

### 4.2 脉冲相位偏差 —— ⚠️ 需修
- **问题**：`teaching.js:420-421`
  ```
  const t = this.animPhase % 3;
  const pulse = (t < 0.6 && !reduce) ? (0.35 + 0.4 * Math.abs(Math.sin(Math.PI * t / 0.3))) : 0.5;
  ```
  相位取自**全局累计 `animPhase % 3`**，与「进入 REVEAL 的时刻」无关。补遗 §A.3 定义 REVEAL 金环为「alpha .35↔.75，**300ms×2（共 600ms）后收敛为静态 .5**」；且 `anim.js:156-162` 已提供 `revealPulseAlpha(timeMs, startMs)`（传入 startMs，超过 600ms 返回静态 .5）正是为此设计——**但教学路径未调用它**。
  - 后果①：金环每 3 秒循环脉冲一次，而非「揭晓后脉冲 2 次即静态」——与 §A.3 节奏不符，且循环动效违反 BRAND 克制边界「循环动效最多 1 处」。
  - 后果②：相位不锚定进入时刻，进入 REVEAL 时可能恰好落在静态段，前 0.6s 看不到脉冲。
- **建议改法**（交给 fe-logic，或视觉侧自行修正，请 team-lead 指示）：
  1. 进入 REVEAL 时记录 `this.revealStart = this.animPhase`（`advanceHint()`/`update()` MISS→REVEAL 处各记一次）；
  2. 脉冲改用现成工具：`const pulse = reduce ? 0.5 : anim.revealPulseAlpha(this.animPhase*1000, this.revealStart*1000)`（或直接按 `elapsed = this.animPhase - this.revealStart`，`elapsed<0.6` 时脉冲，否则 0.5）；
  3. 这样 600ms 后收敛静态 .5，符合 §A.3 与克制边界。
- **替代说明**：`board.js:239` 的 `revealTarget` 路径已正确使用 `anim.revealPulseAlpha(time, o.revealStart)`——说明修复范式已存在，教学自绘路径对齐即可。

> 严重度「中」：不影响防泄题、不影响金环可见性，仅动效节奏规范偏差。**非阻断**。

---

## 5. 组件状态与规范一致性 —— ✅ 通过

| 组件 | 证据 | 结论 |
|---|---|---|
| 按钮 variant（primary/secondary/danger/ghost） | `ui.js:61-66` PALETTE 四态齐全 + 禁用/按下态；`manager.js:251-258` drawButtonLocal 同步四态 | ✅ |
| 面板顶部金发丝线 | `ui.js:166-179` drawPanel hairline；`manager.js:200-202` 模态顶部 accent.line | ✅ |
| 选手牌活动态 3pt 金竖条 + 弱金底 | `gameplay.js:277-283` active → accentFade 底 + 3×金竖条 | ✅ |
| 教学分段进度条 | `teaching.js:528-538` 10 段、已完成金实/当前描边/未完成 surface.3 | ✅ |
| 图例改几何无 emoji | `teaching.js:335` 用「● ○ ○」几何字符 + Caption13；`ui.js:423-456` drawLegendChip 几何绘制 | ✅ |
| 升变弹窗右上 ✕ | `gameplay.js:435-439` 44×44 ✕ + 点遮罩/关闭逻辑 | ✅ |
| 置灰「即将推出」主题项 | `settings.js:134-157` α.4 + surface.3 + neutral 徽章 + 拦截 | ✅ |
| C3 难度采纳 A 卡案 | `setup.js:81-125` 纵排 cardH68 卡式 + 右上金✓ + 左侧信号格；未实现 B 分段（执棋色分段 segH48 是另一控件，非难度） | ✅ A 采纳、B 未做 |
| C4 动效累计 dt 驱动 | `anim.js` 全程累计时间；`gameplay.js:347` time=timeMs；呼吸条 `thinkPhase%period` | ✅ 未用帧计数 |

---

## 6. emoji 清零 —— ⚠️ 主路径通过，1 处兜底越界（低优先级）

### 6.1 彩色 emoji —— ✅ 已清零
全项目 grep（U+1F300–1FAFF / 2600–26FF / 2700–27BF）命中的均为**安全符号或棋子符号**，无被禁彩色 emoji（🎓🤖👥⚪⚫⚠🟢🔴📌）作为界面图标：
- `✓`(U+2713)、`✕`、`☆`、`♚♛♜♝♞♟`、`‹ ›`、`⋯`、水印 `♞`/`♟` —— 均为 §9 白名单或棋子符号（合理）。
- 图标一律 `drawIcon` 路径或安全 Unicode，注释中的 💡/🎓 等仅为文字说明，非渲染。✅

### 6.2 白名单外兜底符号 —— ⚠️ 建议清理（低）
- **问题**：`replay.js:359` 兜底分支
  ```
  ctx.fillText(({ first:'⏮', prev:'◀', play:this.playing?'❚❚':'▶', next:'▶', last:'⏭' })[it.key], cx, cy-8);
  ```
  `⏮ ⏭ ◀ ▶ ❚❚` 均**不在 §9 安全 Unicode 白名单**（白名单含 ▷ 不含 ▶；不含 ⏮⏭◀❚❚）。
- **缓解**：该分支仅在 `ico()` 返回 false（icons 模块加载失败）时触发；正常走 `drawIcon(first/chevronLeft/pause/play/chevronRight/last)`（`replay.js:335-341` 已全部映射到路径图标）。故**正常路径不受影响**。
- **建议改法**（低优先级，下迭代清理）：将兜底符号换成白名单内的等价物或纯文字，如 `first:'‹‹' / prev:'‹' / play:'▷' / pause:'‖' / next:'›' / last:'››'`；或兜底时直接省略图标仅保留文字标签（replay 控件本就 `label` 必带，符合 C6 读屏兜底）。
- 严重度「低」：非主路径、有文字标签兜底、跨机型风险被 icons 路径覆盖。**非阻断**。

---

## 7. C1 棋盘真居中布局 —— ✅ 通过

| 检查点 | 证据 | 结论 |
|---|---|---|
| 无 +14 偏移 | `gameplay.js:177-178` `boardX = Math.floor((W - boardSize)/2)` 「真居中（已移除 +14）」；`config.getBoardMetrics:208` 同式 | ✅ |
| 系数 min(W*.92, H*.55) | `config.js:29-32` BOARD.widthRatio .92 / heightRatio .55；`getBoardMetrics:205` 用之 | ✅ 与补遗 §B.4 一致 |
| 矮屏回落逻辑 | `getBoardMetrics:206` `Math.max(24, floor(maxSize/8))`；`gameplay.js:168-175` metrics + 竖向缩小时重算 | ✅ 有下限保护 |
| 坐标画入边格 | `board.js:243-269` rank 画左列格左上（内缩 3pt）、file 画底行格右下，含 activeSquare 提亮（浅格用 accentDeep 保对比） | ✅ 不挤出屏外 |
| 触控补偿 | `gameplay.js:556-560` 落子前目标预览 + `board.js:289-304` preview + 悔棋常驻 | ✅ B.5 三补偿成形 |

> 注：`getBoardMetrics` 仅返回 boardX/cell，boardY 仍由场景按纵向布局决定（补遗 §B.4 已说明）——v2 将在 layout.js 统一（见 V2_SPEC §4）。当前实现符合 v1 规范。

---

## 8. v2 重构影响标注（哪些会变 / 哪些是长期底线）

### 8.1 v2 重构后**会变化**的终审项（需在 Phase 3 落地后复审）
| 项 | 变化原因 |
|---|---|
| menu 布局（§5 主按钮结构） | 教学降为次级入口、残局闯关升一级、加安全区（BRAND/V2_SPEC） |
| teaching 术语/进度/图标（§3/§5/§6） | 去课程化文案、进度节点化、REVEAL 相位修复（本文 #4） |
| gameplay 工具栏项数/boardY（§5/§7） | 增「提示」按钮、AI 指导气泡、建议走法高亮、layout.js 安全区 |
| board 高亮（§3/§7） | 新增 info 建议走法高亮、gameSkin 插拔 |
| emoji 兜底（§6） | replay 兜底符号建议清理 |

### 8.2 **长期不变**的硬底线（任何棋种/皮肤/迭代都不得破）
1. 白棋描边 `#2A2A28`、黑棋金边 `#C9A24B` 不可省（BRAND §5）。
2. 黄铜 `#C9A24B` 禁作浅色皮肤文字色，浅皮肤用 `accentText #8C6E2F`（BRAND §5）。
3. 关键信息禁用 `tertiary #6B7885`（3.2:1），须用 secondary 及以上。
4. 状态颜色 + 形状双重编码（色弱兜底）。
5. 触控目标 ≥44×44（不足用透明热区/最近中心判定）。
6. 防泄题：考核态不渲染任何合法走法/答案高亮（A.4）。
7. REVEAL 金环用金色、非将军红、且脉冲收敛静态（A.3）。
8. 界面图标禁彩色 emoji（§9）；加新图标优先入 `icons.js` 路径层。
9. 品牌常量层（冷墨底/黄铜/语义色/字号阶梯/圆角）不被单棋种覆盖（BRAND §7）。
10. 克制四边界：广告/动效/声音/红点（BRAND §6）；同屏循环动效 ≤1 处。

---

## 9. 交付建议
- **可放行**：无阻断硬伤，三条底线守住，Phase 3 可进入汇编交付。
- **建议交付前小修**（视觉侧可自行修正，请 team-lead 指示）：本文 **#4 REVEAL 脉冲相位**（约 3 行改动，范式已存在于 anim.js/board.js）。
- **列入下迭代**（不阻断）：#6 replay 兜底符号清理；§1.3 删除 config 旧键别名段。
- **v2 复审点**：菜单/教学/工具栏/多棋类 gameSkin 落地后，按 §8.2 十条硬底线复审。

---

*视觉设计架构师 · Phase 3 视觉一致性终审 · 结论：整体通过，1 中 2 低建议项，均非阻断*
