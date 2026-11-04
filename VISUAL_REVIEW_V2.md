# v2 视觉一致性终审报告（Visual Consistency Audit v2）

> 视觉架构师 · v2 迭代视觉一致性终审 · **只审不改**
> 审查对象：`src/scenes/menu.js`、`src/scenes/academy.js`、`src/scenes/teaching.js`、`src/scenes/replay.js`、`src/scenes/setup.js`、`src/config.js`、`src/render/icons.js`、`src/core/layout.js`
> 权威依据（按优先级）：`VISUAL_AUDIT.md` §8.2 十条长期硬底线 → `BRAND.md`（悦己 + 克制四边界）→ `V2_VISUAL_SPEC.md` §7 玩法容器 V-1~V-10 / §8 图标清单 / §4 安全区契约 → `V2_UX_SPEC.md` §3.1 菜单 IA / §4 文案替换表
> 审查方式：逐文件读码 + 数值复算（对比度用 WCAG 相对亮度公式实算；排版碰撞用 `layout.get()` 度量在 4 种机型上复算坐标）
> 结论：**整体不达标**。发现 **4 项高优先级必修（其中 1 项为肉眼可见的排版硬伤）+ 17 项中优先级 + 6 项低优先级**。三条可访问性底线（棋子描边 / 黄铜禁作浅皮文字色 / 关键信息禁用 tertiary）中，前两条守住，第三条在 5 处被破。REVEAL 相位问题已闭环修复。

---

## 0. 结论总表

| # | 审查项 | 结论 | 严重度 | 归属 |
|---|---|---|---|---|
| 1 | §8.2 十条硬底线逐条核对 | ❌ **7 条通过 / 2 条违规 / 1 条存疑** | **高** | 多文件 |
| 2 | Token 一致性（新界面走 config 语义 Token） | ⚠️ 色值基本达标，**8 处硬编码字号绕过阶梯** | 中 | menu/academy/teaching/setup |
| 3 | 黄铜语义（禁作浅皮文字色 / 双描边） | ✅ 双描边在位；⚠️ 选中态用 accentSoft 作标签色跌破 7.2 | 中 | setup |
| 4 | 关键信息对比度 ≥7.2:1 | ❌ **11 处低于阈值**，含次级按钮文字、NEW 徽章、进度文案、锦囊计数 | **中～高** | menu/academy/setup/replay |
| 5 | 动效克制（循环动效 ≤1 + REVEAL 收敛） | ✅ REVEAL 已修（600ms 收敛静态）；⚠️ 起点金环仍 1.2s 无限循环 | 中 | teaching |
| 6 | 安全区（layout.get() contentTop/Bottom） | ❌ **menu/academy ✓，setup/replay/teaching ✗ 全未接入 layout.js** | **高** | setup/replay/teaching |
| 7 | 图标一致性（权威枚举 / 无自造路径） | ✅ 全部调用名存在、无自造路径；⚠️ 清单口径需 team-lead 收口 | 低 | icons.js |
| 8 | 容器规范（V-8 / V-5 / V-10 尺寸圆角描边） | ⚠️ Primary h68≠h56、徽章 h18≠h22、缺关联战术 Badge / 关联阵 | 中 | menu/academy |
| 9 | 信息层级（单屏 1 个 Primary / 次级行等权） | ✅ 唯一 Primary 与次级行等权均成立 | — | 全体 |
| 10 | 文案与视觉一致性（术语统一 / 去课程腔） | ✅ 术语全站统一；⚠️ 注释残留 + 版本号 v1.1 口径 | 低 | teaching/menu |

> **放行意见**：**不建议直接上线**。高优先级 4 项中有 2 项是「首屏即可见」的视觉缺陷（menu 副标题压按钮、setup/replay/teaching 顶底元素被灵动岛/home indicator 遮挡），必须在交付前修完。中优先级 17 项建议至少修完 1~10 项（对比度 + 字号 Token），其余可列入下迭代。

---

## 1. 硬底线核对表（VISUAL_AUDIT §8.2 十条）

| 编号 | 底线 | 结论 | 证据 |
|---|---|---|---|
| 1 | 白棋描边 `#2A2A28`、黑棋金边 `#C9A24B` 不可省 | ✅ **通过** | `config.js:146` `whiteStroke:'#2A2A28'`、`config.js:147` `blackStroke:'#C9A24B'`（GAME 层 chess skin）；`render/pieces.js:110` `strokeStyle = white ? C.pieceWhiteStroke : C.pieceBlackStroke`；`scenes/gameplay.js` 两处同源引用。`getGameColors()`（`config.js:207-214`）把 skin.PIECE 的描边键映射回扁平 `COLORS`，链路完整。**风险见违规清单 #21**（gomoku/go skin 无描边字段）。 |
| 2 | 黄铜 `#C9A24B` 禁作浅色皮肤文字色，浅皮用 `accentText #8C6E2F` | ✅ **通过** | `config.js:249` `ACTIVE_THEME='dark'`（本期锁定深皮）；`config.js:247` `LIGHT_COLORS.accentText='#8C6E2F'` 已预留。全部 5 个场景渲染均未在浅底（boardLight `#EDE6D6` / surface1/2/3）上用 `C.accent` 作文字色——`academy.js:176` 棋种占位用 `C.neutralBadge`、`teaching.js:352/359` 金色文字底为 `bgBase`/`surface2` 暗底。⚠️ 唯一相关问题：`setup.js:138/195` 选中态标签用 `accentSoft #E0C078` 于 `accentFade` 底（浅金调底），实测 5.73:1 → 见必查项 3。 |
| 3 | 关键信息禁用 `tertiary #6B7885`（3.2:1），须用 secondary 及以上 | ❌ **违规** | `setup.js:154` 标准模式说明 `this.style==='coach' ? C.accentSoft : C.textTertiary` —— 标准档（默认档！）说明文字落到 tertiary，实测 **4.06:1**。另有 `academy.js:177` 棋种占位、`academy.js:220/222` 未解锁卡、`replay.js:357` 禁用控件、`menu.js:113` 版本号共 5 处用 tertiary，但**均落在 V-10/V-5/VISUAL_AUDIT §2b 已授权的白名单内**（置灰占位 / 空态副文 / 禁用文字 / 版本号）→ 不计入违规。 |
| 4 | 状态颜色 + 形状双重编码（色弱兜底） | ✅ **通过** | `setup.js:146` 风格选中右上 `✓` 16px 金；`setup.js:202-204` 难度选中右上 `✓` 18px 金 + 2pt accent 描边；`setup.js:188-189` 难度左侧 1/2/3 格信号格（形状=高度）；`menu.js:143-145` NEW 徽章 info 色 + 文字；`academy.js:180-183` 即将开放徽章 neutral + 文字；`replay.js:52-53` 胜/负/和/进行中四态「胜」「负」「和」三字本身即形状编码。`teaching.js:434` REVEAL 空心圆环 vs `teaching.js:412` 选中圆角矩形框 vs `teaching.js:406` 起点脉冲圆环——REVEAL 态下 `hintLevel>=3` 使起点环不渲染（`teaching.js:402`），二者**互斥不共屏**，语义不混淆。 |
| 5 | 触控目标 ≥44×44 | ✅ **通过** | `menu.js:166` 次级行热区 72×52；`menu.js:148/161` 主按钮 h68/h56；`academy.js:112` 返回 88×44、`_renderTipCard` h76、`_renderEntryCard` h64、`academy.js:167` 占位卡 h96；`setup.js:81` 风格分段 h44、`setup.js:96` 颜色分段 h48、`setup.js:89` 难度卡 h≥46、`setup.js:244` 开始按钮 h52；`teaching.js:499/519` 右侧按钮 44×44；`replay.js:368` 控制键 44×44。全部 ≥44。 |
| 6 | 防泄题：考核态不渲染任何合法走法/答案高亮 | ✅ **通过** | `teaching.js:326` `const showReading = this.phase === PHASE.READING; const miniHighlights = showReading ? toMiniHighlights(...) : []`——非 READING 一律空数组；`teaching.js:398-455` `drawBoardOverlays` 全程无 `legalMoves` 绘制分支，选中态仅画圆角矩形「选中金框」（:412）；`teaching.js:255` `legalTargets` 仅用于 `inLegal()` 的 GUIDE/MISS 分类，不进渲染路径。双重保险与 v1 一致，未被 v2 文案改动破坏。 |
| 7 | REVEAL 金环用金色、非将军红、且脉冲收敛静态 | ✅ **通过（已修复）** | `teaching.js:424-435`：改用 `anim.revealPulseAlpha(this.animPhase*1000, this.revealStart*1000)`，`revealStart` 在 `teaching.js:273`（MISS→REVEAL）与 `teaching.js:649`（advanceHint 至 level 3）两处锚定。`anim.js:156-162` 实现在 elapsed≥600ms 时返回静态 `0.5`，`pulse01(elapsed,300)` 给出 .35↔.75 两次脉冲。**单位换算正确**：`animPhase` 为秒（`game.js:79` dt=秒 → `teaching.js:264`），传入前 ×1000 转为毫秒，与 `anim.revealPulseAlpha` 的 ms 契约一致。fallback 分支（`teaching.js:430`）同样按 `elapsed<0.6` 收敛。金色 `C.accent`、非 danger 红。**v1 终审 #4 中优先级问题已闭环。** |
| 8 | 界面图标禁彩色 emoji；加新图标优先入 `icons.js` 路径层 | ⚠️ **违规（低）** | 无任何彩色 emoji（U+1F300–1FAFF / 2600–27BF）——全量扫描 5 场景仅命中白名单几何符号与棋子符号。**但 3 处白名单外 Unicode**：`teaching.js:501` `▶`(U+25B6，白名单只有 `▷`)、`teaching.js:503/505` `↻`(U+21BB，白名单只有 `↶`/`↷`)、`replay.js:362` `‖`(U+2016)。另 `teaching.js:340` `◎`(U+25CE) 不在 `VISUAL_DIRECTION §9` 白名单（但系 UX §4.2 权威文案指定）。所有图标调用均走 `icons.drawIcon` 路径层，无自造路径。 |
| 9 | 品牌常量层（冷墨底/黄铜/语义色/字号阶梯/圆角）不被单棋种覆盖 | ⚠️ **存疑** | `config.js:27-99` BRAND 层完整独立，`config.js:105-125` SEMANTIC 层语义含义固定（success/warning/danger/info/neutral），`config.js:132-178` GAME 层只覆盖 boardLight/Dark、坐标色、棋子样式、格数——**未越界改 BRAND 色值** ✓。`config.js:90-98` `RESTRAINT` 显式固化克制边界（maxPrimaryPerScreen:1 / maxLoopAnimPerScreen:1 / allowBounce:false / allowConfetti:false）。**存疑点**：`GAME_SKINS.gomoku/go`（`config.js:159-177`）的 `PIECE` 无 `whiteStroke/blackStroke` 字段，若将来 `setActiveGame('gomoku')` 后调 `getGameColors()`，`out.pieceWhiteStroke` 将不被覆盖 → 描边丢失，触碰底线 #1。本期仅 chess，不构成现行违规。 |
| 10 | 克制四边界（广告/动效/声音/红点）；同屏循环动效 ≤1 处 | ✅ **通过（1 处循环，合规）** | 无任何广告位/激励视频代码（`showBanner` 全为自有 toast）。`BRAND.RESTRAINT.allowBgm/allowConfetti/allowBounce` 均为 false 且代码无回弹/撒花（`anim.js:18-25` 全部 ease-out / ease-in，无弹性）。无红点（`gameplay.js` 无红点绘制）。**循环动效计数**：menu 0 处、academy 0 处、setup 0 处、replay 0 处（自动步进属状态推进非动效）、teaching **1 处**（`teaching.js:404` 起点脉冲金环，1.2s 周期）——恰好 ≤1，**达标**。REVEAL 金环已不循环（见 #7）。教学内其余动效均为有限次：MISS 抖动 360ms（`anim.js:174` 收敛）、OK 金闪 0.26s（`teaching.js:449`）。 |

**小结**：10 条中 **7 通过（#1 #2 #4 #5 #6 #7 #10）、2 违规（#3 setup 说明文字用 tertiary、#8 三处白名单外 Unicode）、1 存疑（#9 换棋种时描边可能丢失）**。硬底线 #3/#8 的违规均为局部可定点修复，不涉及架构改动。

---

## 2. 违规清单

> 严重度定义：**高** = 首屏可见 / 影响可用性，必须修完才上线；**中** = 明确偏离规范但不影响主流程，建议上线前修；**低** = 规范内部张力或维护性问题，可列入下迭代。

| # | 文件:行号 | 现象 | 违反哪条 | 建议改法 | 严重度 |
|---|---|---|---|---|---|
| **1** | `scenes/menu.js:84` | 副标题 `C H E S S   A T E L I E R` 固定锚在 `contentBottom - 268`，而按钮组从底部上锚——**副标题直接落在「残局闯关」黄铜按钮内部**。按 `layout.get()` 度量在 4 机型复算全部碰撞：iPhone SE(375×667) 副标题 y=363 落在按钮 341–409 内；iPhone 14(390×844) y=526 落在 504–572；iPhone 14 Pro(393×852) y=534 落在 512–580；iPhone X(375×812) y=494 落在 472–540。 | V2_VISUAL_SPEC §7.8 V-8 菜单骨架（标题组 → 按钮组顺序与间距） | 副标题改为锚定标题组：`contentTop + 178`（下划线）+ 间距 → `contentTop + 196` 附近；或与标题组整体作为一个上锚块（title 132 / hairline 178 / subtitle 196）计算，不要用 `contentBottom` 反推。 | **高** |
| **2** | `scenes/setup.js:75`、`:244` | 全文件**未引入 `core/layout.js`**（grep 无 `layout`）。顶部导航固定 `top = 16`，底部「开始对局」固定 `startY = H - 80`（按钮底边 = H−28）。在 iPhone 14 Pro（safeTop 59 / safeBottom 34）上：返回按钮被灵动岛遮挡；「开始对局」底边落入 home indicator 区（H−34…H）。 | V2_VISUAL_SPEC §4.3 灵动岛避开 / home indicator 留白；§7.0 场景顶栏起点 `y = safeTop + 8` | `const L = layout.get(); const top = L.safe.top + 8;` 底按钮改 `startY = L.contentBottom - startH`；并在 `_metrics()` 中把 `H - 80` 换成 `L.contentBottom` 口径。 | **高** |
| **3** | `scenes/replay.js:188`、`:226-227` | 同样**未引入 `core/layout.js`**。`top = 16` 顶栏固定；`ctrlH = 84; ctrlTop = H - ctrlH` → 控制条整体覆盖屏幕底部 84pt，**5 个控制键的文字（cy+20 = H−22）直接落在 home indicator 上**，图标（cy−8 = H−50）也在指示条区。 | 同上 §4.3 home indicator 留白 ≥ safeBottom | `const L = layout.get();` 顶栏 `L.safe.top + 8`；控制条改 `ctrlTop = L.contentBottom`（即 H − safeBottom − 16），并相应上调棋盘/记谱区（`gridBottom = ctrlTop - 8` 已相对化，只需改 ctrlTop）。 | **高** |
| **4** | `scenes/teaching.js:285`、`:287` | 同样**未引入 `core/layout.js`**。① 顶栏 `top = 16` 固定 —— 在 iPhone 14 Pro（safeTop 59）上返回按钮 y=16–60 **完全落在灵动岛区域内**，被遮挡。② `bottomNavY = H - 72 - 20` 固定留白 20，底部「上一式/下一式」按钮（h52）底边在 iPhone 14 Pro 上为 **H−40 = 812**，超出规范 `contentBottom`（= H−safeBottom−16 = 802）**10pt**，未留足 `safeBottom + 16`（虽未压到 home indicator 本体，但安全余量不足 16pt，与 §4.3 契约不符）。 | 同上 §4.3 灵动岛避开 / home indicator 留白 ≥ safeBottom | `const L = layout.get(); const top = L.safe.top + 8;` 底按钮改 `bottomNavY = L.contentBottom - 8`（底部按钮区顶）；并把 `bottomNavY` 与 `contentBottom` 的 12pt 间距改为相对 `L.contentBottom` 计算。 | **高** |
| 5 | `scenes/setup.js:154` | 标准模式说明文字（默认档）用 `C.textTertiary`，实测 **4.06:1**。同位置指导档用 `accentSoft`（10.46:1）——同一句式两个档位对比度相差 2.6 倍，默认档反而最弱。 | §8.2 #3 关键信息禁用 tertiary；VISUAL_AUDIT §2b | 统一用 `C.textSecondary`（bgBase 上 7.48:1）或 `C.accentSoft`（10.46:1）。 | 中 |
| 6 | `scenes/setup.js:138`、`:195` | 选中态标签用 `C.accentSoft #E0C078` 落在 `accentFade`（14% 金）底上：风格分段实测 **5.73:1**、难度卡实测 ≈5.5:1，低于 7.2。且选中态比未选中态（`textPrimary` 10.33:1）更弱，层级倒挂。 | §8.2 #3 / 必查项 4 关键信息 ≥7.2 | 选中态标签改 `C.textPrimary`（11.98:1 on surface1），金色语义由 **2pt accent 描边 + 右上 ✓** 承担（形状双编码已在），标签不必再染金。 | 中 |
| 7 | `scenes/menu.js:131-134` | 「已破 N/10」进度文案用 `C.textOnAccent` 但叠加 `globalAlpha = 0.9`，实测 **6.52:1**（去掉 alpha 后的 `textOnAccent` on accent 为 7.63:1，达标）。 | 必查项 4 进度文案 ≥7.2 | 删除 `globalAlpha = 0.9`（或改 1.0）。注意右侧 `›` 与徽章簇仍需保持同一 alpha 逻辑。 | 中 |
| 8 | `scenes/menu.js:141-146` | NEW 徽章：`C.info` 实底 × alpha 0.85 叠在黄铜按钮上 → 实际底色 `#6BA5B6`，配 `textOnAccent` 实测 **6.70:1**。同时**偏离 §7.0 徽章基元**（规范：语义色 14% 底 + 同色 Micro11 bold）——若按规范实装（info 14% 底 + info 字）在黄铜上更不可读（info on accent 仅 1.13:1），规范此处存在内在张力。 | 必查项 4（NEW 徽章 ≥7.2）；V2_VISUAL_SPEC §7.0 徽章基元 | 二选一并同时更新规范：① 徽章改为**深底**（`surface3`/`bgElev`）+ `accentSoft` 字（高对比，且金色仍读作「强调」）；② 或保留 info 实底但字色改近黑（`#0B0F13`）以拉到 7.2 以上。同时把「NEW」徽章底改为**不透明**（去 0.85 alpha）以免随按钮底色漂移。 | 中 |
| 9 | `scenes/menu.js:169-174` | 次级行 4 项（锦囊阁/棋谱/设置/音效）图标与文字常态叠 `globalAlpha = 0.9`，`textSecondary` 实测降至 **6.24:1**（满 alpha 为 7.48:1）。这是主导航项，屬关键信息。 | 必查项 4 次级按钮文字 ≥7.2；§8.2 #3 | 常态去掉 0.9（按压态再用 accent 即可表达状态），或常态用 `textPrimary`。 | 中 |
| 10 | `scenes/menu.js:88` | Primary（残局闯关）`priH = 68`，V-8 规定 w343 **h56** r12（人机/双人 h56 已符）。 | V2_VISUAL_SPEC §7.8 V-8 容器尺寸 | 二选一：① 改 56 并把 NEW + 进度压进单行右簇（需 4 字宽度校验）；② 保留 68 但**更新 V-8 规范**并注明「因含 NEW 徽章 + 进度文案」。当前状态下属规范与实现不一致，须收口。 | 中 |
| 11 | `scenes/menu.js:84` | `C.textSecondary` 满 alpha 在 `bgBase` 上 7.48:1 ✓，但**若按 #1 修复后副标题位置改变**，需复核其底色。 | — | 修 #1 时一并实测。 | 低 |
| 12 | `scenes/academy.js:214-215` | 已收集卡摘要用 `TF('caption')`（13px），V-5 明确要求 **Body16 secondary（截断 1 行）**；且 `textSecondary` 在 `surface1` 上实测仅 **6.07:1**。 | V2_VISUAL_SPEC §7.5 V-5 摘要规格；必查项 4 | 摘要改 `TF('body')`；并考虑把 `textSecondary` 在卡片面上的实际对比度作为系统性项处理（见 #20）。 | 中 |
| 13 | `scenes/academy.js:208-215` | 已收集卡缺 V-5 规定的**关联战术 Badge**（info/warning 语义 + 战术标签）。当前只在详情模态（`academy.js:261-263`）里有 Badge，图鉴列表态缺失 → 12 张卡视觉上完全同质（只有 spark 图标 + 名称），失去「战术归类」的可扫读性。 | V2_VISUAL_SPEC §7.5 V-5 已收集态四要素 | 卡内加一个 info/warning 14% 底 + 同色 Micro11 徽章（复用 `academy.js:261` 的写法），置于卡片右上。 | 中 |
| 14 | `scenes/academy.js:245-268` | 妙招详情模态缺 V-5 要求的**关联阵**（如「第 3 阵·双车合围」Caption13）。 | V2_VISUAL_SPEC §7.5 V-5 详情态 | 在战术 Badge 下方加一行 `Caption13` textSecondary；数据可从 `src/data/endgames.js` 的 `tipId → ENDGAMES` 反查。 | 中 |
| 15 | `scenes/academy.js:180-183` | 即将开放徽章 `bw=62, bh=18`，V-10 规定 **h22**；且整卡 `globalAlpha=0.4`（`academy.js:173`）之下再叠 16% 底 → 徽章文字实测 ≈2.9:1，**肉眼几乎不可读**。另 `academy.js:176` 棋种图标用 `C.neutralBadge`，V-10 要求 tertiary 灰。 | V2_VISUAL_SPEC §7.10 V-10 徽章规格 | 徽章移出 `globalAlpha 0.4` 作用域单独绘制（α≥0.85）+ bh 改 22；图标色改 `C.textTertiary`。 | 中 |
| 16 | `scenes/replay.js:220-223` | 结果徽章：`badge.color` @14% 底 + 同色 Micro11 字，在 `surface1` 上实测 success **6.39:1** / danger **4.41:1** / neutral **6.07:1**，全部低于 7.2；且 danger 用于「负」在「悦己·不施压」基调下偏重（作为**结果指示**尚可接受，但 4.41:1 本身不合格）。 | 必查项 4 关键信息 ≥7.2 | 徽章字改 `textPrimary`（11.98:1），语义色仅作底色/左侧竖条；或字色用语义色但底改为 `surface1` 满色 + 14% 徽章只做装饰条。 | 中 |
| 17 | `scenes/replay.js:362` | 兜底符号改用 `‹‹ ‹ ▷ ‖ › ››`，其中 **`‖`(U+2016) 不在安全 Unicode 白名单**（白名单：← → ↑ ↓ ↕ ↶ ↷ ✓ ✕ ‹ › ⋯ • ◆ ★ ☆ ▷）。v1 终审 §6.2 的建议里含 `‖`，但该建议本身未核对白名单原文。 | VISUAL_DIRECTION §9 安全 Unicode 白名单 | `‖` 换成 `▮▮`（U+25AE U+25AE，制表符替代）或直接用 `⏸`… 仍非白名单 → 推荐兜底改为 **`‖` → `‖` 不行，改用 `▪▪`** 亦不在白名单；最稳妥：**兜底时省略图标仅保留文字标签**（replay 控件本就 `label` 必带，满足 C6 读屏兜底）。 | 中 |
| 18 | `scenes/teaching.js:501`、`:503`、`:505` | 三处使用白名单外符号：`▶`(U+25B6，白名单仅 `▷`)、`↻`(U+21BB，白名单仅 `↶`/`↷`)。`▶` 用作「开始试炼」按钮字形、`↻` 用作「再试一式」。 | VISUAL_DIRECTION §9 白名单 | `▶` → `▷`（白名单内，且 `icons.js:385` GLYPHS.play 已是 `▷`，可直接改用 `ico(ctx,'play',...)` 路径图标）；`↻` → `↶`（白名单内）或复用 `icons.js` 的 `undo` 字形 `↶`。 | 中 |
| 19 | `scenes/teaching.js:404` | 起点脉冲金环为 **1.2s 无限循环**（`0.35 + 0.4*(0.5-0.5*cos(2π*(animPhase%1.2)/1.2))`），不收敛静态。它是教学屏唯一的循环动效（计数仍合规），但作为首屏最显眼的持续动画，与 §7.0「单次高亮脉冲 300ms×2 后收敛静态」基调有落差。 | BRAND §6.2 克制边界 + V2_VISUAL_SPEC §7.0 动画基调 | 起点环改为进入 `TRY/SELECTED` 时锚定、600ms 后收敛静态 .5（与 REVEAL 同一范式）；或保留循环但把周期拉长到 ≥2.4s 并降峰值到 .55 以弱化存在感。 | 中 |
| 20 | `scenes/academy.js:214`、`:235`；`scenes/setup.js:197`；`scenes/teaching.js:359` | **系统性对比度缺口**：`textSecondary #9AA7B4` 在 `bgBase` 上 7.48:1 达标，但落到卡片面 `surface1 #1F2833` 只有 **6.07:1**、`surface2 #28333F` 更低。凡「关键信息用 secondary 且绘制在卡片上」处均不达 7.2。 | 必查项 4 关键信息 ≥7.2；BRAND 文字阶差 | 三选一：① 把 `textSecondary` 提亮到 ≥7.6:1（对 surface1），如 `#A8B4C0`；② 卡片内次级信息改用 `textPrimary`；③ 明确「卡片面 secondary 豁免 7.2、底线 4.5」并写入 VISUAL_AUDIT §2b 补充白名单（需 team-lead 拍板）。当前状态属**规范与 Token 未对齐**，必须收口一次。 | 中 |
| 21 | `config.js:159-177` | `GAME_SKINS.gomoku/go` 的 `PIECE` 无 `whiteStroke/blackStroke`。`getGameColors()`（`config.js:207-214`）仅在 `skin.PIECE.whiteStroke` 存在时覆盖扁平键，而 BRAND.COLORS 层并无 `pieceWhiteStroke` 键 → 切到 gomoku/go 时 `out.pieceWhiteStroke` 为 `undefined`，棋子描边彻底丢失。 | §8.2 #1（描边不可省）；§8.2 #9（品牌常量层不被单棋种覆盖） | 在 `GAME_SKINS` 四个 skin 的 `PIECE` 中统一补 `whiteStroke:'#2A2A28'` / `blackStroke:'#C9A24B'`（或把这两个键提到 BRAND 层由 GAME 继承）。本期虽不切棋种，但 `getGameSkin` 已对外暴露，属低成本预防。 | 中 |
| 22 | `scenes/menu.js:72`、`:128`、`:159`；`scenes/academy.js:237`；`scenes/teaching.js:359`、`:518`；`scenes/setup.js:144`、`:202` | **8 处硬编码字号绕过 BRAND 阶梯**：`'bold 22px sans-serif'`（=h2 值但未走 Token）、`'bold 20px sans-serif'`（=subtitle 值）、`'bold 13px sans-serif'`（非阶梯值）、`'bold 16px sans-serif'`（=body 值）、`'bold 18px sans-serif'`（非阶梯值）。 | BRAND §3/§7 字号阶梯为品牌常量层；必查项 2 Token 一致性 | 全部改为 `TF('h2')` / `TF('subtitle')` / `TF('body')` 等既有键；确需非阶梯值（如 18px 金 ✓、16px 勾）的两处（`setup.js:144/202`）在 `BRAND.FONTS` 增加命名键（如 `checkMark:'bold 18px sans-serif'`）而非内联字面量。 | 中 |
| 23 | `scenes/menu.js:113` | 版本号 `v1.1 · 单机版` —— 项目已进入 v2（多层 Token / 残局闯关 / 锦囊阁），版本口径未同步。 | 文案与视觉一致性 | 改为 `v2.0 · 单机版`（或由 `config.VERSION` 单一来源驱动）。 | 低 |
| 24 | `scenes/menu.js:113` | 版本号绘制在 `contentBottom + 6`（baseline middle），文字下沿 ≈ `H − safeBottom − 4.5`；§4.3 要求「版本号下沿 = H − safeBottom − 8」。虽仍在安全区内但越过规范线。 | V2_VISUAL_SPEC §4.3 home indicator 留白 | 改绘在 `contentBottom - 6`（即 ≤ H − safeBottom − 22），或按规范公式定位。 | 低 |
| 25 | `scenes/academy.js:167` | 占位卡宽 `(contentW - 24) / 3`（375 屏 = 106.3），V-10 规定 `(contentW − 32) / 3`（≈103.7），且卡片间距用 12 而规范间距 16。 | V2_VISUAL_SPEC §7.10 V-10 尺寸 | 统一为 `(contentW - 32) / 3` + 间距 16。 | 低 |
| 26 | `scenes/teaching.js:5`、`:8`、`:242`、`:324`、`:586`；`scenes/academy.js:9` | 源码注释残留课程腔与占位符（`10 课互动化`、`考核态`、`重建练习局面`、`题目成立所需`、`升变选择态`…）。注释不渲染，但影响后续维护者按「课/考核」心智继续加词。 | 必查项 10 去课程腔（精神层面） | 注释统一为「式 / 试炼 / 破阵」词表（`10 式`、`试炼态`、`重建试炼局面`），与 UX §4 文案词表对齐。 | 低 |
| 27 | `render/icons.js` 全文 vs task 清单 | **命名口径不一致**：team-lead 清单含 `chess/practice/puzzle/tutorial/sound/gear/trophy/scroll/bulb` 共 9 个名在 `icons.js` 中**不存在**；而 `icons.js` 实际提供 38 路径 + 8 字形 + 15 别名 = **61 个可用名**，与 V2_VISUAL_SPEC §8 权威枚举（20 个）完全对齐（缺失 0 个）。代码**未调用**任何缺失名，故无实际缺陷，但两份清单并存会让后续场景调用错名。 | 必查项 7 图标一致性 | 以 **V2_VISUAL_SPEC §8 权威枚举**为唯一口径（该表已由主理人定案为「权威图标枚举」），在 `icons.js` 头部注释里补一行映射说明（`sound→soundOn/soundOff`、`gear→settings`、`bulb→hint`、`tutorial→teach`），避免二次踩坑。 | 低 |
| 28 | `scenes/academy.js:272-273`；`scenes/teaching.js:391-392`；`scenes/replay.js:302`；`scenes/setup.js:135/180/228`；`scenes/academy.js:181`；`scenes/teaching.js:35/37/418` | 局部硬编码 rgba：`'rgba(16,21,27,0)'`（bgBase 的透明派生，重复 4 处）、`'rgba(154,167,180,0.16)'`、`'rgba(255,255,255,0.02)'`、`'rgba(0,0,0,0.10)'`、`'rgba(201,162,75,0.50/0.45/0.30/0.10)'`。按 VISUAL_AUDIT §1.2 第 2 类（基于语义色的透明派生）属**可接受**，但 rgba(16,21,27,…) 重复 4 处且与 `C.bgBase` 脱钩，改 Token 后会漂移。 | 必查项 2 Token 一致性（低风险） | 优先把 `rgba(16,21,27,0)` 改为由 `C.bgBase` 派生的工具函数（`util.hexToRgba(C.bgBase, 0)` 已有等价能力），其余按 §1.2 判为可接受，不再追改。 | 低 |

> 上表共 **28 项**：高 4 / 中 17 / 低 7。

---

## 3. 必查项逐条结论

### 3.1 Token 一致性（新界面是否全走 config 语义 Token）
- **色值**：✅ 全部新场景的填充/描边/文字色均取自 `theme.colors`（= config `COLORS`），无「旧值回退」型硬编码（`manager.js` 的 `COLOR_FALLBACK` 仍被 config 覆盖，单一真相源成立）。
- **字号**：❌ **8 处绕过阶梯**（违规 #22），其中 `setup.js:144/202` 的 16px/18px 为非阶梯值。
- **圆角/间距/阴影**：✅ 统一走 `R.btn / R.sm / R.modal / R.pill`、`theme.elevation.e1/e2`、`withShadow()`。
- **硬编码 hex 全量**：仅 `config.js`（Token 定义处）、`manager.js`（兜底，被覆盖）、以及 #28 里的透明派生 rgba。无「独立色板」型硬编码。

### 3.2 黄铜语义
- **白棋描边 `#2A2A28`**：`config.js:146` ✅ 在位。
- **黑棋金边 `#C9A24B`**：`config.js:147` ✅ 在位。
- **黄铜禁作浅皮文字色**：✅ 无违规（本期深皮锁定）。
- **新问题**：`setup.js:138/195` 用 `accentSoft` 作选中态标签色落在 14% 金底上（5.73:1 / ≈5.5:1），既低于对比度阈值，也造成「选中比未选中更弱」的层级倒挂（违规 #6）。这属于**黄铜被误用为浅色调底上的文字色**的近亲问题，应一并收口。

### 3.3 对比度（关键信息 ≥7.2:1）
**低于阈值处（实算）**：

| 位置 | 元素 | 实测 | 目标 |
|---|---|---|---|
| `setup.js:154` | 标准模式说明（tertiary / bgBase） | **4.06** | 7.2 |
| `setup.js:138` | 风格选中标签（accentSoft / accentFade） | **5.73** | 7.2 |
| `setup.js:195` | 难度选中名（accentSoft / accentFade） | **≈5.5** | 7.2 |
| `menu.js:132-134` | 「已破 N/10」（textOnAccent@.9 / accent） | **6.52** | 7.2 |
| `menu.js:143-145` | NEW 徽章（textOnAccent / info@.85 叠 accent） | **6.70** | 7.2 |
| `menu.js:169-174` | 次级行 4 项文字（textSecondary@.9 / bgBase） | **6.24** | 7.2 |
| `academy.js:214-215` | 已收集卡摘要（textSecondary / surface1） | **6.07** | 7.2 |
| `academy.js:235` | 入口卡副标题（textSecondary / surface1） | **6.07** | 7.2 |
| `academy.js:176-183` | 即将开放徽章（neutralBadge / α.4×16% 叠底） | **≈2.9** | 7.2 |
| `replay.js:221-223` | 结果徽章 danger（danger / surface1） | **4.41** | 7.2 |
| `replay.js:221-223` | 结果徽章 success / neutral | **6.39 / 6.07** | 7.2 |
| `teaching.js:359` | 要诀行 `◆` 金色（accent / surface2） | **5.35** | 7.2 |
| 全局 | `textSecondary` 落 `surface1`（多处） | **6.07** | 7.2 |
| 全局 | `accent` 落 `boardLight #EDE6D6`（棋盘浅格上的金环/金点） | **1.93** | 图形 ≥3 |

> **「锦囊计数」专项**：`academy.js:139` 「妙招图鉴 · 已收集 N/12」用 `textSecondary` 满 alpha 在 `bgBase` 上 **7.48:1** ✅ **达标**（这是唯一一处真正的「锦囊/图鉴计数」）。`menu.js` 的「已破 N/10」不达标（6.52，见上）。

### 3.4 动效克制
- **REVEAL 金环**：✅ 已从「无限循环脉冲」改为 **600ms 收敛静态 .5**（`teaching.js:424-435` + `anim.js:156-162`），相位锚定在 `revealStart`（两处入口均已记录），`reduceMotion` 时恒 0.5。**v1 终审 #4 完全闭环。**
- **同屏循环动效计数**：menu 0 / academy 0 / setup 0 / replay 0 / teaching **1**（起点脉冲金环）→ **≤1 达标**（但见违规 #19 的节奏建议）。
- **无回弹**：✅ `anim.js` 仅 ease-out/ease-in/ease-in-out。
- **无撒花 / 无循环 BGM / 无红点**：✅。

### 3.5 安全区
| 场景 | 用 layout.get()？ | contentTop / contentBottom？ | 结论 |
|---|---|---|---|
| `menu.js` | ✅ `:64` `layout.get()` | ✅ `:65-66` `contentTop` / `min(contentBottom, H-12)` | ✅ 达标（版本号位置微偏，见 #24） |
| `academy.js` | ✅ `:93` `layout.get()` | ⚠️ 用 `L.safe.top + 8` / `H − safe.bottom − 8`（自算，未用 `contentTop/contentBottom`） | ✅ 达标（与 §7.0 顶栏起点一致；底部比 §4.3 少 8pt 留白，可接受） |
| `setup.js` | ❌ 未引入 | ❌ 固定 `top=16` / `H-80` | ❌ **违规 #2（高）**：iPhone 14 Pro 上返回键落在灵动岛区（safeTop 59）、「开始对局」底边 H−28 压 home indicator |
| `replay.js` | ❌ 未引入 | ❌ 固定 `top=16` / `H-84` | ❌ **违规 #3（高）**：返回键落灵动岛区、控制条整条覆盖底部 84pt，控件文字落 H−22 压 home indicator |
| `teaching.js` | ❌ 未引入 | ❌ 固定 `top=16` / `H-92` | ❌ **违规 #4（高）**：返回键落灵动岛区、底部按钮超 contentBottom 10pt |
| `core/layout.js` | — | ✅ 契约完整：W/H/dpr/safe/contentTop/ContentBottom/contentLeft/Right/contentW/H/gutter/isCompact/isTablet/isLandscape/scale/board + `capsule`；`contentTop = safeTop+16`、`contentBottom = H−safeBottom−16`（§4.3 ✓）；`_readSafe` 钳制在 `H*0.25` 内防击穿 ✓；`game.js:45` 已 `layout.init(sysInfo)` ✓ | ✅ 基础设施本身合格，**问题在 3 个场景未消费** |

### 3.6 图标一致性
- **调用名全部存在**：menu(`map`/`ai`/`twoPlayers`/`academy`/`records`/`settings`/`soundOn`/`soundOff`)、academy(`spark`/`teach`/`book`/`xiangqi`/`gomoku`/`go`)、setup(`coach`/`ai`)、replay(`first`/`chevronLeft`/`chevronRight`/`last`/`play`/`pause`) → `icons.hasIcon()` 全为 true。
- **无自造路径**：✅ 5 场景均走 `icons.drawIcon`（`icons.js:412-419`），未知名静默不绘制。
- **权威枚举完整**：V2_VISUAL_SPEC §8 的 20 个名（`hint lock ward book clock undo coach xiangqi gomoku go spark academy map hourglass mirror scout freeze master timer endgame`）在 `icons.js` 中 **缺失 0 个**；技能 7 项按 §8 裁决用简洁名（`hourglass/mirror/scout/freeze/master/ward` + 复用 `undo`）已由 `icons.js:369-374` 别名实现 ✅。
- **口径分歧**：见违规 #27（team-lead 清单 vs §8 权威枚举），**代码侧无缺陷，需口径收口**。

### 3.7 容器规范（V-8 / V-5 / V-10）
| 容器 | 规范 | 实现 | 结论 |
|---|---|---|---|
| V-8 残局闯关 Primary | w343 h56 r12，accent 填充 + textOnAccent 深字 + e1 + 顶部 accent.soft 光泽 + 左 map 图标 + 右 NEW 徽章 + 「已破 N/10」Caption13 | w343 ✓ / **h68 ✗** / r12 ✓ / accent 填充 ✓ / 深字 ✓ / e1 ✓ / 光泽 ✓（`ui.js:118-126` gloss）/ map ✓ / NEW ✓ / 进度 Caption13 ✓ | ⚠️ 违规 #10 |
| V-8 人机 / 双人 | w343 h56 r12，surface.2 + 1pt border.strong + text.primary + 金色左图标 | h56 ✓ / r12 ✓ / `ui.js:63` secondary = surface2 + borderStrong ✓ / textPrimary ✓ / 金图标 `C.accent` ✓ | ✅ 达标 |
| V-8 次级行 | 4 项 × 44×44 热区，图标+标签 Caption13 | 72×52 ✓（≥44）/ 22px 图标 ✓ / `TF('caption')` ✓ | ✅ 达标（仅对比度见 #9） |
| V-5 已收集卡 | surface.1 + r12 + 1pt accent.line + 左 spark 金图标 + 妙招名 H2 22 text.primary + 摘要 Body16 secondary（1 行）+ 关联战术 Badge | surface.1 ✓ / R.btn=12 ✓ / accentLine 1pt ✓ / spark ✓ / `TF('h2')`+textPrimary ✓ / **摘要 Caption13 ✗** / **Badge 缺失 ✗** | ⚠️ 违规 #12 #13 |
| V-5 未解锁卡 | surface.3 + α.5 + H1 28「?」tertiary +「闯过对应阵解锁」Caption13 tertiary | ✓ 全对（`academy.js:217-223`） | ✅ 达标 |
| V-5 详情模态 | Modal w340 r20 surface.1 + e2 + 顶部金线 + 妙招名 H1 28 accent + 正文 Body16 text.primary + 战术 Badge + 关联阵 Caption13 + [知道了 Secondary] | w=min(W*.88,340) ✓ / R.modal=20 ✓ / e2 ✓ / 金线 ✓ / H1 accent ✓ / Body16 primary ✓ / Badge ✓ / **关联阵 ✗** / 知道了 secondary ✓ | ⚠️ 违规 #14 |
| V-10 棋种占位 | w=(contentW−32)/3 h96 r12，surface.3 + 整卡 α.4 + 中性灰图标 + neutral「即将开放」h22（非 accent 金）+ 拦截 toast | h96 ✓ / r12 ✓ / α.4 ✓ / 图标 neutralBadge（规范要 tertiary）△ / **h18 ✗** / neutral 色 ✓（非金 ✓）/ toast ✓（`academy.js:366` info） | ⚠️ 违规 #15 #25 |
| V-8 hub 顺序 | 妙招图鉴 → 新手试炼 → 规则速查 → 更多棋种置灰 | `academy.js:136-187` 完全一致 ✓ | ✅ 达标 |

### 3.8 信息层级
- **单屏唯一 Primary**：menu 仅「残局闯关」为 `variant:'primary'`（`menu.js:121`），人机/双人走 `secondary`（`:153`），次级行为纯图标文字 → ✅ 符合 BRAND「单屏 ≤1 强调按钮」。
- **setup 单屏 Primary**：仅「开始对局」（`setup.js:245`）；风格/难度/颜色三组均为描边卡 + 金 ✓ 形状标记 → ✅ 单一强调。
- **academy**：无 Primary（仅「知道了」secondary）→ ✅ 克制。
- **teaching**：仅底部「下一式」primary（`teaching.js:561`），右侧 44 按钮 surface2 → ✅。
- **次级行 4 项视觉等权**：`_rowBtn` 同一实现（`menu.js:165-177`），同尺寸、同字号、同色（仅按压变 accent）→ ✅ 等权。**但**常态 alpha 0.9 使其与 Primary 的对比差距被压平（见 #9），建议修。
- **教学 23 条文案与 BRAND「悦己」**：✅ 通读全部命中「招式看清了，来破这一阵！」「差一点！换个招式再试试～」「漂亮，破阵成功！」「此式已参透 ✓」「十式皆通 ✓ · 随时回来精进」「看这步妙招，点它试试～」——无施压、无催促语气。

### 3.9 文案与视觉一致性
- **术语全站统一** ✅：`阵`（残局闯关 / 第 N 阵 / 破阵眼 / 破阵成功）、`锦囊`（妙计 / 提示）、`回马枪`（V2_UX §1.1 命名）、`新手试炼`（teaching 顶栏 `teaching.js:535` + academy 入口 `academy.js:158`）、`式`（上一式 / 下一式 / 第 N 式 / 十式皆通）——**六个术语在 menu/academy/teaching/setup/replay 五处口径一致，无混用**。
- **UX §4 权威文案落地率 100%** ✅（脚本逐条比对 `V2_UX_SPEC.md` §4.1–§4.6 共 23 条关键字符串，**缺失 0 条**）：`招式看清了，来破这一阵！` / `试炼中 · ` / `差一点！换个招式再试试～` / `漂亮，破阵成功！` / `此式已参透 ✓` / `十式皆通 ✓ · 随时回来精进` / `看这步妙招，点它试试～` / `新手试炼` / `← 上一式` / `下一招 →` / `下一式 →` / `出师 ✓` / `暂别试炼？` / `还有 N 式没练完，确定先歇会儿？` / `继续闯` / `先歇会儿` / `再试一式` / `● 可走　◎ 可吃　◆ 破阵眼` / `◆ 本式要诀` / `第 N 式 · 共 10 式` / `点棋盘里的格子试试～` / `先点一下要动的棋子～` / `这招得从那颗指定棋子起手～` / `这步走不通，换个落点～` / `升变多选后（♛），威力最大～` / `漂亮！破阵成功！`（banner）。**文案游戏化这一项完全达标，无需返工。**
- **残留课程腔（渲染层）**：✅ **零残留**。「课 / 题 / 考核 / 练习 / 学习 / 答对 / 检验」仅出现在源码注释（#26）与 UX §4.5 权威文案原文「还有 N 式没练完」中（后者系规范指定，不算残留）。
- **图例几何符号**：`teaching.js:340`「● 可走　◎ 可吃　◆ 破阵眼」与 UX §4.2 权威文案逐字一致 ✓；无彩色 emoji ✓。
- **版本口径**：❌ `menu.js:113` 仍为 `v1.1`（#23）。
- **setup 文案**：`标准 / 指导`（`setup.js:25-26`）与 UX §2.1 术语一致 ✓；副标题「只管对弈 / 边下边讲」口语化无课程腔 ✓；`setup.js:240`「棋盘将翻转，你执黑，白方由 AI 先走」信息完整 ✓。
- **academy 文案**：「十式招法，从零到破阵」（`academy.js:158`）✓；「这个棋种正在准备中～」（`:366`）非 danger 非促销 ✓。

---

## 4. 整体判断

**v2 视觉未达可上线水准。**

- **必修项数量**：**4 项高优先级**（另 17 项中优先级、7 项低优先级）。若把「上线前必须清零」的口径定为「高 + 中」，则为 **21 项**；若口径为「高 + 影响可读性的中」，则为 **13 项**（#1~#9、#11、#12、#16、#17、#18）。
- **最关键 3 条**：
  1. **`menu.js:84` 副标题与残局闯关按钮重叠** —— 4 种机型实测全部碰撞，副标题被黄铜按钮吞掉。这是首屏可见的硬伤，且 v2 刚把「残局闯关」立为唯一 Primary，反而把副标题压在了它身上。**必须改锚定方式**（副标题属标题组，应上锚 `contentTop`，不可用 `contentBottom` 反推）。
  2. **`setup.js` / `replay.js` / `teaching.js` 三场景完全未接入 `core/layout.js`** —— 灵动岛机型（safeTop 59）返回键被灵动岛遮挡；`setup` 的「开始对局」按钮底边 = H−28（实测压 home indicator）、`replay` 的控制条整条覆盖底部 84pt（控件文字落在 H−22，压住 home indicator）、`teaching` 底部按钮超出 contentBottom 10pt。基础设施（`layout.js` + `game.js:45` 的 `layout.init`）已就绪且合格，是三个场景各自没消费；这是**成本最低、收益最高**的一处修复。
  3. **关键信息对比度普遍跌破 7.2:1** —— 次级导航文字 6.24、NEW 徽章 6.70、进度文案 6.52、卡片上的 secondary 6.07、结果徽章 danger 4.41、setup 说明 4.06，共 11 处。§8.2 #3 已明令「关键信息禁用 tertiary」，setup 默认档说明直接踩线。**建议一次性把 `textSecondary` 对卡片面的实际对比度问题（#20）与各处 alpha 折损（#7/#9）一起收口**，避免逐点返工。

- **已达标、可放心保留的部分**：
  - **REVEAL 金环相位问题已彻底闭环**（600ms 收敛静态 .5 + `revealStart` 双入口锚定 + ms 单位换算正确 + reduceMotion 兼容）——v1 终审唯一的中优先级必修项已解决。
  - **三条可访问性底线**：棋子双描边在位且链路完整 ✅、黄铜未作浅皮文字色 ✅、关键信息 tertiary 用法仅 1 处越线（其余 5 处均在规范授权白名单内）✅。
  - **防泄题双保险未被 v2 改动破坏** ✅。
  - **图标体系零缺陷**：61 个可用名、V2 §8 权威枚举 20/20 全在、所有调用可解析、无自造路径、无彩色 emoji ✅。
  - **信息层级与单屏唯一 Primary**：menu / setup / academy / teaching 四屏全部达标 ✅。
  - **文案游戏化彻底**：23 条权威文案逐条落地，六术语全站统一，渲染层零课程腔残留 ✅。
  - **layout.js 基础设施本身完全合格**（契约字段齐全、§4.3 公式正确、safe 钳制防击穿、已全局 init）✅。

- **放行建议**：修完 **#1~#9**（4 高 + 5 中）即可进入上线候选；#10~#21（中）建议同批修完以免二次返工；#22~#28 可列入下迭代。

---

*视觉设计架构师 · v2 视觉一致性终审 · 结论：整体不达标 · 4 高 / 17 中 / 7 低 · 无代码改动*
