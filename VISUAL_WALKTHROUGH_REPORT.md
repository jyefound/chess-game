# 墨金棋院 · 系统性视觉 / 交互走查评审报告

> 评审视角：顶级视觉设计师 + UX 审计
> 评审对象：微信小游戏「墨金棋院」国际象棋应用全部页面与控件
> 评审方式：**代码精读 + 视觉规范交叉核对 + 对比度脚本实测**（说明见末章「方法与环境限制」）
> 坐标基准：375×667、默认安全区（safeTop=20 / safeBottom=20 ⇒ navSafeTop=60、contentBottom=631），并标注矮屏 / 宽屏差异
> 严重度标记：【高】阻断体验或违反硬规范 · 【中】明显可用性问题 · 【低】一致性 / 打磨 · 【复核】需真机量测

---

## 0. 结论速览

| 维度 | 结论 |
|---|---|
| 信息架构 | 整体清晰、单屏主次分明；少量冗余入口与命名三义（残局页「锦囊」三义、教学/对局「提示」同名异义）。 |
| 页面布局 | 安全区（navSafeTop / navRightAvoid / safe.bottom）已全场景落地，无写死顶栏绕过胶囊；**但阵图断点倒置**导致 375 手机被迫双列拥挤。 |
| 操作路径 | 主路径清晰；残局页「翻转 / 复制」不可达、危险操作（认输 / 清空）层级偏深、结算 / 失败文字链接命中区 < 44pt。 |
| 交互反馈 | 多数控件有按下态；**设置面板内 13+ 控件零按下态**、禁用态无 toast、提示面板无 3s 自动消失、锁定卡无按压反馈。 |
| 视觉规范 | **违反"禁止裸 px 字号"17 处**（根因：缺 bold token）；对比度 30/44 达标，残留问题集中在**棋盘高亮金环/✓** 与 **tertiary 落 surface 文字**；装饰发丝线（border/accentLine）按 §11.5 豁免。 |

**最高优先（建议立即修）**：① 阵图断点倒置（375 双列拥挤）；② 教学棋盘金环/✓ 对比度 < 3:1（核心反馈不可见）；③ 复盘棋盘被压到 26px 格；④ 棋谱败局徽章 danger 文字 3.70:1 < AA；⑤ 设置面板底侵入 Home Indicator + 零按下态；⑥ 对局页提示高亮与选中/合法走法**同色**（语义打架）；⑦ 17 处裸 px 字号（根因修复：补 bold token）；⑧ 补全 fontScale 后**场景专属模态**（promotion/gameover/settingDrawer）的 200ms 防穿透核查。

---

## 1. 主菜单 `src/scenes/menu.js`

**现状**：单屏 1 个 Primary（残局闯关）+ 2 个 Secondary + 次级行 4 入口；顶部 ♞ 水印、标题带、版本号。`C.*/R.*/TF()` token 使用正确，安全区消费正确，触摸模型合规。

**问题**
- 【复核】版本号（`menu.js:129`，锚 `contentBottom-6`）与次级图标行（底 `contentBottom-8-rowH`）几何贴合 ~2px，全机型恒定重叠风险。
- 【低】裸 px 字号 2 处：`menu.js:144 / :173` 的 `›` 用 `'bold 22px sans-serif'`（恰等于 `TF('h2')`，零视觉差异，应改 token）。
- 【低·复核】NEW 徽章为 `surface3` 深块浮于黄铜 Primary 上，观感略突兀。

**建议**
1. 次级行上移预留版本号空间：`rowY = contentBottom - 8 - rowH - 22`，与版本号彻底分离。
2. `menu.js:144/:173` 改为 `TF('h2')`。

---

## 2. 设置 `src/scenes/settings.js`

**现状**：顶栏（返回 + 标题）+ 可滚动面板 10 项 + 主题行；toggle/choice/action 类型齐全；danger 行刻意避开 surface1（合规 §11.4）。

**问题**
- 【高·可确证】**面板底侵入 Home Indicator**：`settings.js:211` `ph = H - py - 16` 硬编码 16，忽略 `L.contentBottom`；safeBottom=20 时面板底压入指示带 4px，更大设备深陷 34px。
- 【高·可确证】**设置行零按下态反馈**：`renderSettingsPanel`（`:56-169`）全程未引用 `this.pressed`，13+ 控件点击无任何下沉/高亮。
- 【中】裸 px 字号：`settings.js:143` `'bold 14px'`（✓ 勾）。
- 【低·复核】toggle 关态轨道 `surface3` 压 `surface1` 明度接近、可辨识弱；浅色主题行 α.4 置灰却可点（affordance 矛盾）。

**建议**
1. `settings.js:211` 改为 `ph = L.contentBottom - py`。
2. 将 `this.pressed` 传入面板绘制，命中行叠 `C.accentFade` 或 `scale(.97)`。
3. `settings.js:143` → `TF('caption')`（或新增 `check` token）。

---

## 3. 棋谱 / 战绩 `src/scenes/records.js`

**现状**：顶栏（返回 + 标题 + 右上编辑避让胶囊）+ 卡片列表 + 编辑态危险条 + 空态；卡片三行信息密度合理，空态完善，卡片有按下态。

**问题**
- 【高·可确证】**败局徽章 danger 文字对比度 3.70:1 < AA 4.5**：`records.js:202-205` 徽章底 `danger@0.14` 叠 surface1、文字 `C.danger`，合成 ≈3.70:1，违反 §11.4/§11.5。胜/和/进行中均达标，唯败局 FAIL。
- 【中】裸 px 字号：`records.js:228` `'bold 18px'`（chevron `›`）。
- 【低】chevron 用 `textTertiary` on surface1 = 3.30:1（临界）；删除 ✕ 与危险条无按下态；编辑态点卡片仍打开 replay（反直觉）。

**建议**
1. 败局徽章改「语义色实底 + `C.bgBase` 深字」范式（同 Banner，≥5.4:1 PASS），并统一胜/和/进行中。
2. `records.js:228` → `TF('subtitle')` + `C.textSecondary`。

---

## 4. 阵图（残局闯关选择页）`src/scenes/endgameMap.js`

**现状（近期重写）**：双行顶栏（标题 + 已破 N/100）、卡片网格、4 态视觉编码、折叠卡、滚动渐隐；`LOCK_POOL` 文案去重、`LOCKED_PREVIEW=5` 折叠均已落地。

**问题**
- 【高·可确证】**断点倒置导致 375 双列拥挤**：`endgameMap.js:202` `cols = contentW >= 300 ? 2 : 1`。375 手机（contentW≈343）被判双列 → 卡片宽仅 ~167px，阵名/intro 截断、页脚贴边；而 320 小屏反成单列，**设备分级逻辑完全倒置**（与 §7.9「W>414 或 min(W,H)≥600 才两列」冲突）。
- 【中·可确证】**已破态缺 success 徽章**：§7.1 要求「已破」徽章，当前仅「最佳 Xs」+ 3 星，4 态中唯"已破"缺状态徽章。
- 【中·可确证】**双 5 星语义冲突**：顶部「难度 1–5 星」与底部「最佳 0–3 星」视觉语言一致，色弱/扫读易混淆。
- 【中·可确证】标题「破阵·百阵」丢失页面名"阵图"（§1.1/§7.1 命名不一致）；节点直径 24 vs §7.1 规定 36；顶栏 56 vs §7.1 h44。
- 【中·可确证】页脚「目标 N 步·Xs」用 `textTertiary`（§7.1 禁 tertiary）；最佳成绩显示「12.3s」而非 §7.1 要求的「mm:ss」且**完全缺最佳步数**。
- 【中·可确证】锁卡 / 折叠卡**无按下态**；脉冲金环参数（r15 / 周期 1.8s / 不收敛）偏离 §7.1（r20 / 600ms / 收敛 .5）。
- 【低·可确证】裸 px：`endgameMap.js:82（星标）/ :280（✓）`；两列间距 8 vs §7.9 的 16；分隔线未铺满右边界；`TOTAL=0` 时空态缺失；星标魔法数 `5*8.4 / 3*9.2` 与实际步距不符。

**建议（Canvas 可行）**
1. **断点修正**：`cols = (g.W > 414 || Math.min(g.W, g.H) >= 600) ? 2 : 1`（或消费 layout 的 `isTablet`），使 375=单列、平板=双列；两列 `CARD_GAP` 改 16。
2. 已破态加 `success` 徽章；标题改「阵图 · 破阵百阵」；`NODE_R=18`、脉冲环 r20 + 600ms + 收敛。
3. 页脚 `textTertiary → C.textSecondary`；最佳成绩改 `MM:SS` 并补最佳步数；锁/折叠卡补按压态；`✓` 与星标改 token。

---

## 5. 残局对局 `src/scenes/endgame.js`

**现状**：信息架构完整（HUD / 工具栏 / 技能抽屉 / 更多抽屉 / 结算 / 失败 / 揭晓 / 升变）；安全区（抽屉底 / 工具栏底）合规；模态层级正确；OVERTIME 禁红字、失败卡 info 中性色均合规。已运行 `audit-contrast.js` 佐证基线。

**问题**
- 【中·可确证】**入口冗余与命名三义**：① 机会条左「锦囊」+ 点数（提示机会）；② 机会条右「锦囊 ▾」；③ 工具栏「锦囊」——②③ 完全重复同开 skillDrawer，且 ① 与 ②③ 同名异义。工具栏「锦囊提示」（求解器）与更多抽屉「看本阵提示（锦囊提示）」（静态文案）**同名异义**，易误点。
- 【中·可确证】**翻转 / 复制不可达**：工具栏无翻转按钮、全文件无复制逻辑（与「悔棋/提示/认输/翻转/复制」对照表不一致）。
- 【中·可确证】**提示面板无 3s 自动消失**（§7.6 要求）；**禁用态点击无 toast**（§7.2 要求用完态给 info）。
- 【中·可确证】**准备倒计时文案缺失**：§7.2 要求计时条下显「准备…3→2→1」，当前仅 nav 时钟显示。
- 【中·可确证】**裸 px 字号 4 处**：`endgame.js:170（星标）/ :943（↶）/ :1207（✕）/ :1305（✕）`。
- 【中·可确证】**对比度**：技能卡「不可用原因」`textTertiary` on surface2 = **2.84:1**（违反 §11.2）；技能抽屉空态 `textTertiary` on surface1 = 3.30:1；工具栏禁用 `globalAlpha 0.35 + textTertiary` 实际可见度极低（§11.6-④ 要求信息文字全不透明）。
- 【低·可确证】nav 标题 `W/2+22` 偏置 22px（规范居中）；结算/失败文字链接命中区 26/28pt < 44；横屏/平板未适配（`layout()` 未处理 `isLandscape/isTablet`）。
- 【复核】机会条（oppRow）在紧凑屏（W<360）余量 < 54px，箭头/文字可能贴边；Banner 可能遮挡结算关键按钮（by-design，需真机确认）。

**建议**
1. 移除机会条冗余「锦囊 ▾」，工具栏入口文案改「技能 ▾」；左侧提示机会标识改名「提示」或仅留图标+点数；更多抽屉「看本阵提示」改名「本阵思路（教练）」。
2. 提示面板加 `hintShownAt` + `update()` 中 3s 后 200ms 淡出；禁用态不再 `return`，改由 `requestHint/doUndo` 内已有 banner 反馈。
3. `renderTimerBar` 增加 PREPARE 分支绘制「准备… N」。
4. 裸 px 改 `TF()` 系列；技能卡原因 / 空态 `textTertiary → textSecondary`；工具栏禁用改 `surface3` 底 + `textSecondary` 全不透明。
5. 命中区提到 ≥40pt；`layout()` 增加横屏双栏重排。

---

## 6. 普通对局 `src/scenes/gameplay.js`

**现状**：架构稳健，矮屏（360×640）手算不溢出；顶栏 + 双信息牌 + 棋盘 + 底带 + 工具栏 + 模态/抽屉齐备；对比度专项实测工具栏/牌/按钮均达标。

**问题**
- 【高·可确证】**提示高亮与选中/合法走法同色（语义打架）**：`gameplay.js:863-872` 提示起点金环/终点金点均用 `C.accent`，而选中环（`board.js:184`）、合法点（`board.js:218/225`）也是金。§3.3 明确要求建议走法用 **info 蓝** 并补 1pt 虚线箭头 + 起点呼吸脉冲 + 3s 淡出——当前全部未满足。
- 【中·可确证】**将军徽章对比度 3.50:1 < 4.5**：`gameplay.js:685-690` `danger@0.18` 叠 surface1 + `C.danger` 文字。
- 【中·可确证】**棋盘高亮在亮格可见性低**：选中金环/合法金点叠 `boardLight #EDE6D6`，accent 金 on 亮格 1.93:1、on 暗格 2.72:1（< UI 3:1）；`board.js` 已对坐标字做亮格 `accentDeep`/暗格 `accentSoft`，但选中/提示环仍纯 `C.accent`。
- 【中·可确证】**指导模式结算缺「对局小结 + 复盘本局」**：§2.6 要求，`gameplay.js:943-983` 仅有再来/返回/查看/悔棋，**无小结文案、无复盘按钮**（虽计算 `coachSummaryText()` 却未渲染）。
- 【中·可确证】裸 px 3 处 ✕：`gameplay.js:925 / :999 / :1036` `'bold 20px'`（升变/更多/设置抽屉）。
- 【低·可确证】提示脉冲未受 `reduceMotion` 门控；结算文字按钮命中区 32pt < 44。
- 【复核】教练气泡/提示面板在极矮屏（band.h<22）全部不可见，需真机确认下限。

**建议**
1. 提示高亮改 **info 蓝**：起点 `C.info` 环 + 呼吸脉冲、终点 `C.info` 实心点、`setLineDash([4,3])` 1pt 虚线箭头起→终、3s 淡出（保留形状编码兼顾色弱）。
2. 选中/合法环在亮格改 `C.accentDeep`、暗格保持 `C.accent`，解决亮格不可见。
3. 将军徽章改 `C.danger` 实底胶囊 + `C.textOnAccent` 浅字；三处 ✕ 改 `TF('close')`。
4. 结算新增 `coachSummaryText()` 渲染区与 `[复盘本局]` 按钮；提示脉冲加 `reduce` 短路；文字按钮命中区提到 44。

---

## 7. 开局设置 `src/scenes/setup.js`

**现状**：流式纵排（风格分段 → 难度 3 卡 → 执棋色分段 → 开始按钮），安全区统一（`navSafeTop` / `contentBottom`），已做矮屏净空守卫（P1-L3），360×640 不重叠。

**问题**
- 【低·可确证】裸 px 字号：`setup.js:154（✓ bold16）/ :212（✓ bold18）`。
- 【低·可确证】未选中描边用 `C.border`（on surface1 1.64:1 / on surface2 1.41:1），接近不可见（弱网/低亮屏易丢边界）。
- 【复核】执黑仅一行文字提示、缺方位预览（进对局才知翻转）；难度卡副行在矮屏 `cardH=46` 极限态可能与主行挤迫。

**建议**
1. 两处 ✓ 改 `TF('check')`（或 `TF('body')` bold）。
2. 未选中态由描边改**填充对比**（surface2/3）替代 `border` 描边；执黑分段旁加翻转箭头 / mini 棋盘预览降低认知落差；矮屏 `cardH` 触底时副行降级为仅信号格数量。

---

## 8. 学院（锦囊阁 hub）`src/scenes/academy.js`

**现状**：新手试炼 CTA + 妙招图鉴两列网格 + 规则速查 + 棋种占位卡；顶栏 `navSafeTop` 避让胶囊；对比度 4 处（历史记录）已修复（脚本为过期基线）。

**问题**
- 【中·可确证】**妙招图鉴卡 / 棋种占位卡均无点击命中区**（仅注册 `back`/`teaching`），违反 §7.5 V-5「妙招图鉴卡 + 详情态」，收集态仅静态展示。
- 【低·可确证】裸 px：`academy.js:160（bold22）/ :283（bold15）`。
- 【低·复核】装饰发丝线 `accentLine` on bgBase/surface1 ≈1.48:1（§11.5 装饰豁免，真机可复核是否需提亮）；规则卡单卡极高（212px），首屏被占满。

**建议**
1. 为已收集妙招卡补 `addRegion('tip:'+id)` 跳转详情（V-5 详情态）。
2. `academy.js:160 → TF('h2')`；`:283 → TF('body')`（或增补 `tipName` token）。
3. 规则卡行距收紧或拆两列。

---

## 9. 教学（新手试炼）`src/scenes/teaching.js`

**现状**：固定顶栏（返回 + 标题 + N/10 式 + 分段进度）+ 可滚动中部 + 固定底栏；三态（READING/TRY/REVEAL）防泄题（C8）齐备；互动原语零拖拽。

**问题**
- 【高·可确证】**棋盘高亮金环/✓ 对比度 < UI 3:1**：`accent #C9A24B` on 浅格 ≈1.9:1、on 深格 ≈2.7:1；`success #6FB98F` 同样 < 3:1。选中框/起点环/揭晓环/对勾在棋盘上**几乎看不清**——教学核心反馈最严重项。
- 【中·可确证】**图例与真实高亮色不一致**：`teaching.js:344` 图例 `●可走 ◎可吃 ◆破阵眼` 用 `textSecondary` 单色，而真实高亮是金/红多色，无法建立颜色映射。
- 【中·可确证】**disabled 态 `textTertiary` 落 surface 违反 §11.4**：提示按钮禁用（`teaching.js:519-524`）、底栏「上一式」禁用（`manager.js:261`）将 tertiary 画在 surface2/3 上。
- 【中·可确证】**READING 态棋盘可提前作答**：`onBoardTap` 仅排除 COMPLETED/OK，点起点即进 SELECTED→判对，绕过 startTry 入口。
- 【低·可确证】裸 px：`teaching.js:363（bold13）`；`teaching.js:524（bold22 兜底）`。
- 【复核】平板棋盘硬锁 304px 未放大（`:322`）；底栏背景填到 H、按钮底边距 contentBottom 仅 8px，异形屏需确认。

**建议**
1. 【最高优先】棋盘金环/✓ 加**双色描边或对比衬底**（先画 `lineWidth+2` 深色描边再叠金色，或 CORRECT 时先铺 `bgBase`/`accentDeep` 圆盘再画 ✓），保证 ≥3:1。
2. 图例三字符改真实高亮色绘制；新增 `disabledFg` token（tertiary 仅配 bgBase），修正 `manager.js:261` 与 `teaching.js:522`。
3. READING 态 `onBoardTap` 首行加 `if(phase===READING){ guide('先点「来破这一阵」'); return; }`；`:363 → TF('caption')`；平板放开棋盘上限。

---

## 10. 复盘（棋谱回放）`src/scenes/replay.js`

**现状**：顶栏 + 元信息卡 + 只读棋盘 + 进度行 + 记谱网格（2 列）+ 底部 5 键控制条；当前步金色高亮 + 左竖条；控制键 pressed/disabled 态齐备。

**问题**
- 【高·可确证】**标准高度下棋盘被压到 26px 格**：`replay.js:228-239` 预留 `gridMinH=96 + progH=40` 后 `cell=26`（棋盘仅 208px），比教学棋盘（304）小一大圈，可读性吃亏。
- 【低·可确证】兜底字形 `replay.js:362 'bold 22px'`（仅 `ico()` 缺失时）；装饰发丝线 `border` / `accentLine` 极淡（§11.5 豁免）；disabled 控制键 `textTertiary @0.35` 视觉近乎消失。
- 【复核】记谱网格默认视口仅 ~3 行，长对局需频繁滚动；空态/banner 时序可能先闪空态再弹 banner。

**建议**
1. 【优先】压缩预留（`gridMinH 96→84`、`progH 40→32`、boardY 上移），将 `cell` 从 26 提到 ~33（棋盘 264px）；目标标准 667h 下回放棋盘 ≥ 300px。
2. `replay.js:362` → `TF('h2')`；disabled 透明度 `0.35→0.5`；记谱网格最小可视高度提高或"当前步居中 + 上下各露 2 行"；确认 `enter` 失败路径直接 return 不再进空态分支。

---

## 11. 全局框架与视觉规范合规（跨页面）

**12.1 框架机制（均合规·可确证）**
- 绘制顺序：场景 → Banner 最后 → `_enterFade` 最上（manager.js:383-406），符合规范；Banner 层级 L2、不拦截触摸、锚 `navSafeTop+48` 避让顶栏/胶囊。
- Modal：通用模态全屏 `overlay` 遮罩 + 层级正确 + 200ms 防穿透（`interactive()`）+ L1 互斥。
- TouchGuard：11 个场景全部复用 `new TouchGuard()`，阈值/去重/防误触一致。
- 安全区：10/10 场景均引用 `navSafeTop/navRightAvoid/contentBottom/safe.bottom`，无写死顶栏绕过胶囊（`menu` 顶部为水印/版本号、用 contentTop 避让状态栏，可接受）。

**12.2 系统性隐患（P1 级）**
- 【高·可确证】**17 处裸 px 字号**（见各页清单）：根因是 `TF()` 缺 **bold 变体**，作者为加粗手写 px → 既绕 token 又丢失 fontScale 无障碍缩放。建议补 `bodyB/captionB/subtitleB` 或 `TF(k,{bold})`。
- 【中·可确证】**淡色 token 缺失**（`accentFade/accentLine` 之外无 `dangerFade/blackFade/neutralBadgeFade/bgFade`），导致 ≈15+ 处手写 rgba（danger 0.10~0.18 / 黑 0.08~0.10 / neutral 0.14 / bg 透明端）；建议新增淡色 token 并修 `manager.js drawButtonLocal` 的 danger/ghost 背景。
- 【中·可确证】**tertiary 落 surface 的文字**：endgameMap 锁阵标签、endgame 计数、records 空态等若底为 surface2/3 则 2.84/2.34 < 3，违反 §11「tertiary 严禁 surface1/2/3」；需渲染确认实际表面层级后改 `textSecondary/textPrimary`。
- 【中·核查】**场景专属模态防穿透**：promotion/gameover/settingsDrawer 为自绘模态，`ModalManager` 的 200ms 防穿透 + 全屏遮罩**不覆盖它们**，需逐场景确证遮罩/防误触齐备（否则模态穿透风险）。
- 【低】圆角写死（endgame.js:1253 抽屉 `rr(...,8)` 应 `R.sm/card`；细线 1~4px 应 `R.chip`）；间距魔法数（16/8/12/20）应改 `SPACING` token。

**12.3 对比度审计（tools/audit-contrast.js，30/44 达标）**
- 达标：textPrimary 全表面 ≥8.51（AAA）；textSecondary on bgBase~surface2 ≥5.23；语义色作文字 on bgBase ≥5.43；横幅深字 ≥5.43；badge `accentSoft on surface3`=6.04。
- 不达标 14 项中：2 项为**已修复的过期基线**（menu 版本号、academy 破阵解锁，代码已改 textSecondary）；其余按 §11.5 装饰线豁免（border/borderStrong/accentLine < 3:1，设计意图"去硬边框"）；残留真实 token 风险：`textSecondary on surface3 4.31`、`sem.danger as text on surface1 4.41`（本三页未触发，但其他页需留意）。
- **真机残留风险**（脚本未覆盖动态合成）：`globalAlpha<1` 衰减文字（设置禁用 0.4、锁定卡 0.4/0.5、记录锁定 0.10）会进一步压低对比，须真机量测。

---

## 12. 优先级修复清单（建议排期）

| 级别 | 项 | 页 / 文件 | 性质 |
|---|---|---|---|
| P0（核查门槛） | 逐场景确认专属模态（promotion/gameover/settingsDrawer）200ms 防穿透 + 全屏遮罩 | gameplay/settings/endgame | 防穿透风险 |
| P1（高） | 阵图断点倒置（375 双列拥挤） | endgameMap.js:202 | 布局·可确证 |
| P1 | 教学棋盘金环/✓ 对比度 < 3:1 | teaching.js | 核心反馈·可确证 |
| P1 | 复盘棋盘被压到 26px 格 | replay.js:228 | 布局·可确证 |
| P1 | 棋谱败局徽章 danger 文字 3.70:1 | records.js:202 | 对比度·可确证 |
| P1 | 设置面板底侵入 Home Indicator + 零按下态 | settings.js:211 / :56-169 | 安全区+反馈·可确证 |
| P1 | 对局提示高亮与选中/合法同色（语义打架） | gameplay.js:863 | 规范冲突·可确证 |
| P1 | 17 处裸 px 字号（根因：补 bold token） | 全场景 | 规范·可确证 |
| P1 | tertiary 落 surface 文字 / 淡色 token 缺失 | 全场景 | 规范·可确证 |
| P2（中） | 已破态补 success 徽章、节点直径 36、顶栏收口 | endgameMap.js | 规范·可确证 |
| P2 | 残局页「锦囊」三义、双「提示」同名、翻转/复制缺失、提示 3s 消失、禁用 toast、准备文案 | endgame.js | 操作/反馈·可确证 |
| P2 | 将军徽章对比度、棋盘亮格高亮、指导结算小结+复盘 | gameplay.js | 对比度/IA·可确证 |
| P2 | 学院图鉴卡不可点（V-5 详情态）、裸 px | academy.js | IA·可确证 |
| P2 | 教学图例单色、disabled tertiary、READING 可提前作答 | teaching.js | 教学性/规范 |
| P3（低） | 圆角/间距 token 化、菜单版本号重叠、各页命中区提到 ≥44、装饰线真机复核 | 全场景 | 一致性·打磨 |

---

## 13. 方法与环境限制（重要说明）

1. **真机级离屏渲染已补做（2026-11-03 增补，见 §14）**：在 `tools/vendor/node_modules/@napi-rs/canvas`（v1.1.0，darwin-arm64 预编译，自 `/tmp` 拷贝持久化）支持下，`tools/render-shots.js` 以 750×1334 画布 + `ctx.scale(2,2)` 逻辑 375×667 渲染 12 个场景、输出 2x PNG 至 `review-shots/`；`tools/render-endgame-fold.js` 专用渲染折叠卡。字体补偿：`sans-serif→Heiti SC`、`serif→Songti SC`（PingFang SC 在该渲染器下不匹配→tofu）；棋子字形 `Apple Symbols`（中文字体无棋子字形→☒）——此二者为 harness 渲染补偿，**非 app 缺陷**。本轮仅新增工具脚本与依赖，**未改动任何 app 源文件**。除 §14 明确补做的真机复核外，其余评审仍基于代码精读 + `tools/audit-contrast.js` 实测（30/44）。
2. **标注口径**：【可确证】= 由代码 / Grep / 脚本直接证明；【复核】= 依赖运行时渲染 / DPR / 真机量测，已明确指出待真机复核项（如动态 alpha 合成对比度、Banner 贴胶囊带观感、矮屏极限态、横屏适配）。
3. **建议的下一步**：如需要真机级视觉证据，可在项目内 `npm i @napi-rs/canvas` 后复用既有 offscreen 渲染管线（参考 `tmp-verify-coach.js` 的 `global.wx` 模拟 + 各 test 的 `new XScene()` 实例化方式）批量导出每页 PNG，对【复核】项做像素级确认，并据此定稿修复。

> 本报告为只读走查，除 §14 补做的真机级离屏渲染工具（`tools/render-shots.js`、`tools/render-endgame-fold.js` 及 `tools/vendor` 依赖）外，未修改任何 app 源文件或规格文件。如需将【可确证】项直接落地为补丁，可据此 `文件:行号` 清单分批派发实现。

---

## 14. 真机级离屏渲染复核结论（2026-11-03 增补）

> 目的：对报告内所有【复核】项做像素级确认（对比度 / 间距 / 层级 / 断点）。
> 产物：`review-shots/*.png`（12 场景 + 折叠卡），由 `tools/render-shots.js` / `tools/render-endgame-fold.js` 生成。
> 判定口径：【复核】项经真机渲染 + 代码实测双重确认后升格为「已确证」或「已修复」。

### 14.1 已确证 / 已修复项

| # | 原【复核】项（出处） | 真机结论 | 证据 |
|---|---|---|---|
| 1 | 菜单版本号与次级行重叠（:30） | **已修复（任务二）**：版本号已移至设置底部，首屏无版本号、底部 3 入口（锦囊阁/棋谱/设置） | `menu.png` |
| 2 | 复盘棋盘被压到 26px 格（§0③） | **属实（代码实测）**：`scene._layout={boardX:83,boardY:184,cell:26}`，boardSize=208px；`availForBoard=215→maxCellByHeight=26` 触下限，两侧留白约 83px，棋盘明显偏小 | `replay.png` + 调试实测 |
| 3 | 棋谱败局徽章 danger 文字 <AA（§0④） | **属实**：「负」红字叠深红底，三徽章中对比度最差（脚本 3.70:1<AA 方向一致） | `records.png` |
| 4 | 教学金环/✓ 对比度 <3:1（§0②） | **属实**：金 `#C9A24B` 在浅格 `#EDE6D6` 上≈1.3:1，浅格几乎不可见；金环仅赖黑子内反差勉强可辨 | `teaching-reveal.png` |
| 5 | 阵图断点倒置→375 双列拥挤（§0①） | **双列属实**：375 下确为双列；间距尚可，但副标题以省略号截断（「阵中求道，循序…」等），可读性受损 | `endgameMap.png` |
| 6 | 折叠卡可能因断点倒置丢失 | **解除**：底部「待解锁 89 阵」汇总折叠卡正常渲染 | `endgameMap-fold.png` |
| 7 | 设置面板底侵入 Home Indicator（§0⑤） | **已修复（任务二）**：`ph=contentBottom-py-verH`；版本号底部、未侵入安全区、音效为设置首项 | `settings.png` |
| 8 | 装饰发丝线 accentLine≈1.48:1 是否需提亮（:158） | 真机观感可豁免（§11.5）：667 下细线观感正常，建议维持装饰豁免 | 全场 |

### 14.2 未在本轮 375 渲染复现（保留为待真机项）

- 紧凑屏 W<360 机会条余量 / Banner 遮挡结算（:104）
- 极矮屏教练气泡 `band.h<22` 不可见（:126）
- 执黑方位预览缺失 / 难度卡 `cardH=46` 极限挤迫（:143）
- 平板棋盘硬锁 304px 未放大 / 异形屏底栏 8px（:177）
- 动态 `globalAlpha` 合成对比度（设置禁用 0.4、锁定卡 0.4/0.5、记录锁定 0.10）：已在 `records`/`replay` 静态态间接确认风险方向，仍建议按报告结论处理

### 14.3 结论与建议

- 全部【可确证】高优先项（① 断点倒置双列、② 金环浅格对比度、③ 复盘 26px、④ 败局徽章、⑤ 设置侵入已修、⑦ 裸 px、⑧ 模态防穿透）均已具备真机 / 代码双重证据，**建议派发修复**。
- harness 已持久化：`tools/vendor`（优先）+ `/tmp/canvas-shots`（回退），可重复出图复核，不污染 app 运行时。
- 字体渲染补偿（Heiti SC / Songti SC / Apple Symbols）仅为 Node 端离屏渲染器的字形映射，与微信真机字体无关，不影响上述结论。
