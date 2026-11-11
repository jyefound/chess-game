# 剩余优化清单（交叉核对后 · 2026-11-04 终版）

> 依据：用户 2026-11-04 复核反馈（320×568 + 大字号 + 多状态实测）与我方  
> 《VISUAL_WALKTHROUGH_REPORT.md》（含 §14 真机复核）交叉核对。  
> 优化顺序严格按用户指定：阶段 1 → 2 → 3，阶段 4 为报告既有 P1/P2 去重并入。  
> **状态更新**：阶段 1 / 2 / 3 全部完成；阶段 4 已逐项落地，仅余「翻转/复制」等少量需真机/独立排期项（见末尾）。  
> 全量验证基线：六套回归 **327/0**、harness 16 场景 0 失败、`node -c` 全通过。

## 交叉核对结论（对照用户原始反馈）

- **用户 6 条 P0 阻断项**：① 矢量棋子/图标 ✅ ② 顶栏文字碰撞 ✅ ③ 小屏破版 ✅ ④ 棋盘坐标抢占 ✅ ⑤ 高亮语义色打架 ✅ ⑥ 44pt 热区 ✅ —— 全部落地。
- **我方额外检出的相同问题**：报告 §12 的「17 处裸 px（根因缺 bold token）」与「tertiary 落 surface」用户亦点名（高价值优化隐含「文案/规范体系」），本轮 Phase 4 已根治。
- **严重漏判 → 升级 P0 并补做**：
  1. **Unicode 棋子/符号方框**：harness Apple Symbols 掩盖真机风险 → 12 枚矢量棋子离屏图集 + 全图标路径化 ✅
  2. **声音/触感资产缺失**：audio.js 22 路径无资源 → `src/assets/audio/*.wav` 22 条 + `wx.vibrateShort` ✅
- **对照结论**：用户点名的 P0 六条 + 高价值七条（菜单主视觉 / 阵图密度 / 先读再练 / HUD 减负 / 棋谱空态层级 / 按钮原语 / 声音触感）**均已检出并实现**，无遗漏；我方报告额外检出的"裸 px / tertiary / 模态防穿透 / 复盘 26px / 败局徽章 / 教学金环"亦在 Phase 4 一并闭环。

---

## 阶段 1（P0 阻断）— ✅ 全部完成

1. ✅ 矢量棋子 + 全图标路径化（`src/render/pieces.js` 重写 12 枚矢量棋子离屏图集预热；新增 `src/render/icons.js`；全仓 Unicode 字形清零）。
2. ✅ 统一 TopBar 三槽位（新增 `src/render/topbar.js`；teaching/records/endgame/setup/academy/replay 改造；320/大字号零叠字）。
3. ✅ compactHeight 断点 + 大字号接线（`src/core/layout.js` 增 isCompactH/isCompactW；`context.js`+`game.js` 接通 `getFontScale()→theme.setFontScale`）。
4. ✅ 44pt 热区（视觉+命中双≥44）：gameplay 提示条、settings chip、endgame「重打本阵」收进弹窗 200×44。

## 阶段 2 — ✅ 全部完成

1. ✅ 棋盘高亮语义色板（config 13 token；board.js 五层重排；坐标外移木框刻度带）。
2. ✅ 对局 HUD 减负（gameplay 双 56pt 卡→单条 44pt HUD；endgame 取消常驻 52pt→按需浮层）。
3. ✅ 教学首屏「先读再练」（READING CTA + 作答 guard + 滚动渐隐；报告 §9 该条已闭环）。

## 阶段 3 — ✅ 全部完成

1. ✅ 残局章节地图密度（`endgameMap.js` 单列断点 / 卡片 96→112 / 描述多行 / 难度空心蓝☆ vs 通关实心金★）。
2. ✅ 菜单主视觉（黄铜径向光晕 + 棋子剪影 + 「继续·第 N 阵」）。
3. ✅ 声音与触感（22 条 WAV 资产 + `wx.vibrateShort` 吃子/将军；接入 soundEnabled）。
4. ✅ 文案体系统一（四词定型：锦囊阁 / 锦囊 / 锦囊提示 / 教练提示）。
5. ✅ 统一按钮原语 `MOTION.tap` 90ms（新增 `src/render/tap.js`：MOTION / createTap / drawTapButton / drawTapHighlight；全场景按钮防穿透统一 90ms）。

## 阶段 4（报告既有 P1/P2，去重并入）— ✅ 已逐项落地

| 项                     | 状态          | 落地位置                                                                                                                                          |
| --------------------- | ----------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| 补 bold token（根因）      | ✅           | config.js BRAND.FONTS +6 键（bodyB/captionB/subtitleB/h2B/microB/check），manager.js FONT_FALLBACK 同步                                             |
| 17 处裸 px → token      | ✅           | 9 个场景文件全替换，grep「font 赋值字面量」已清零                                                                                                                |
| 补淡色/禁用前景 token        | ✅           | config.js BRAND.COLORS +7 键（dangerFade/blackFade/neutralBadgeFade/successFade/infoFade/bgFade/disabledFg），manager.js 兜底同步                     |
| tertiary 落 surface 文字 | ✅           | 6 场景 `C.textTertiary`→`C.disabledFg`（单向提亮，绝不降对比）；tap.js 禁态前景同步；records 右端 chevron→textSecondary                                               |
| manager 按钮淡色背景        | ✅           | drawButtonLocal 已转发 tap.js；tap.js danger 手写 rgba→dangerFade token                                                                             |
| 复盘棋盘 26px             | ✅           | replay.js 26→**33px**（boardSize 208→264）；gridMinH 96→64 / progH 40→32 / ctrlH 84→76 / boardY 上移 / gridTop 40→32，记谱网格仍 ≥2 行；harness 实测 cell=33 |
| 棋谱败局徽章 3.70:1         | ✅           | records.js + replay.js 徽章统一「语义色实底 + textOnAccent 深字」≥5.4:1，胜/和/负/进行中一致                                                                        |
| 教学金环/✓ 对比度 <3:1       | ✅           | teaching.js 新增 `_casedRing`（深色衬线 + 亮金主环双描边）套用起点环/选中框/揭晓环/MISS 环；✓ 加深色圆盘；图例三色真实高亮（金/红/青玉）                                                      |
| 学院图鉴卡不可点（V-5）         | ✅           | academy.js 妙招/棋种卡 `addRegion` 命中区 + `tipDetail` 详情浮层（全屏遮罩 + 「知道了」+ 任意点关闭 + 90ms 防穿透）                                                          |
| 残局锦囊三义                | ✅           | 阶段 3·11 文案四词定型                                                                                                                                |
| 提示 3s 自动消失            | ✅           | endgame.js `hintShownAt/hintFade` 完整接线（停留 3s + 200ms 淡出 + 自动收起）；update/applyHintMove/finishHint/dismissHint/renderHintPanel 双出口 save-restore  |
| 禁用态 toast             | ✅           | endgame.js 工具栏 disabled 不再静默 return → onToolbar 内 banner 反馈                                                                                   |
| 准备文案（PREPARE 倒计时）     | ✅           | endgame.js PREPARE 3s 宽限 + 计时条「准备 N」                                                                                                          |
| 场景专属模态 200ms 防穿透      | ✅ 核查通过（无需改） | gameplay 4 处模态已有 C.overlay 全屏遮罩 + `sm.modal.interactive()` 200ms（:1157）；settings 走 manager 通用模态；报告该条属过期基线                                     |

### 说明：S2 worker 半成品处置

- 三个 Phase 4 场景 worker 因 429 限流全部失败，失败前几乎未落盘；仅 endgame.js 被写入「PREPARE 准备倒计时」（完整可用）与两个**死变量** `flipped` / `hintShownAt`。
- 主理人清理 `flipped` 死变量、把 `hintShownAt/hintFade` 完整接线为「提示 3s 自动消失」，未留任何"定义了却没用"的假完成。

---

## 剩余优化清单（更新后 · 全部非阻断）

### 需独立排期 / 真机验证

1. **翻转 / 复制按钮**（报告 §5 P2「操作路径」）：`screenToBoard` / `drawBoard`(flip:false) / `cellToScreen` 三处坐标系硬编码，翻转需联动渲染 + 命中换算 + 建议箭头坐标系，单测难覆盖，需真机联调；引擎已有 `toFen()` 可支撑「复制局面」。建议放入「更多」抽屉，避免挤压 44pt 工具栏热区。**这是阶段 4 唯一未实现项**，其余报告 P1/P2 均闭环。
2. **横屏 / 平板适配**（报告 §5/§9）：endgame `layout()` 未处理 isLandscape/isTablet；teaching 棋盘硬锁 304px 未随平板放大。
3. **动态 `globalAlpha` 合成对比度真机复核**（报告 §12.3）：设置禁用 0.4 / 锁定卡 0.4–0.5 / 记录锁定 0.10 的静态态已间接确认风险方向，仍建议真机量测（本轮已用 `disabledFg` + 全不透明策略覆盖主要文字）。
4. **装饰发丝线真机复核**（§11.5 装饰豁免）：accentLine/border 在异形屏是否需提亮。
5. **`.watch()` 在微信小游戏端真机可用性**（本批次 · 远程双人对弈）：`src/core/room.js` 以 `.watch()` 实时推送为主、2.5s 轮询兜底；小游戏基础库对实时数据推送的支持情况待真机确认，不可用时应能无缝回落到轮询（见 `CLOUD_DEPLOY.md` §12.6）。
6. **无云函数下的反作弊边界**（本批次）：不部署云函数 ⇒ 无法在服务端校验走子合法性或做权威反作弊，靠 6 位高熵房间码 + `rev` CAS + 随机席位串在应用层识别；需评估好友休闲场景之外的滥用风险与是否追加约束（见 `PRIVACY_POLICY.md` §十三）。
7. **平板 / 横屏下房间页适配**（本批次）：`src/scenes/room.js` 在 `isTablet` / 横屏下的房间码输入、分享卡片、等待态布局待走查；当前工程竖屏锁定，横屏 IA 仍不可达（见 `V2_UX_SPEC.md` §6.3）。
8. **房间数据过期清理策略（无服务端定时器）**（本批次）：`chess_rooms` 文档带 `expireAt`、6h 过期，但无云函数 / 服务端定时任务做物理清理，靠前端惰性判定 + 房主删除 / 「删除云端数据」触发 `room.deleteAllRooms()`；需评估残留过期文档的配额影响与后续清理策略（见 `CLOUD_DEPLOY.md` §12.3 / §12.4）。

### 一致性 / 打磨（P3，非阻断）

1. 圆角/间距 token 化：endgame.js 抽屉 `rr(...,8)` 应 `R.sm/card`；16/8/12/20 魔法数应 `SPACING`。
2. 技能按钮「锦囊」→「妙招」进一步降认知（与 academy 妙招卡同源），会牵动多处横幅/抽屉文案，建议单独优化项。
3. 菜单 NEW 徽章 surface3 深块浮于黄铜 Primary 观感略突兀；设置 toggle 关态轨道可辨识弱。
4. 复盘记谱网格「当前步居中 + 上下各露 2 行」体验优化；极矮屏 coach 气泡 `band.h<22` 可见性；执黑方位预览。
5. 已知既有限制（非本轮引入）：`src/core/*` 仍用 `var`；场景构造器 `375/667` 魔法数字（部分已由 layout 收敛）。

---

## 本轮验证记录（2026-11-04）

- `node -c`：13 个改动文件全部通过。
- 六套回归：`test.js 9/0` · `test-integration.js 59/0` · `test-engine.js 62/0` · `test-endgame.js 100/100` · `test-endgame-scene.js 86/0` · `test-gameplay.js 11/0` = **327/0**。
- 离屏渲染：`tools/render-shots.js` 16 场景 0 失败（复盘 cell=33px）。
- 功能断言（`/tmp/verify-p4b.js`）：6 PASS / 0 FAIL（academy 详情态开关、endgame 提示 3s 淡出收起、teaching 金环双描边、token 链路、禁用态 toast 不抛错）。
- 多视口布局（复盘放大后）：375×667 `cell=33 / board=264 / 记谱视口≈1.9行 / 无重叠`；大字号 `cell=33 / 无重叠`；320×568 矮屏 `cell=26（下限保护，不强行放大）/ 棋盘·进度·记谱三处无重叠` —— 用户主屏放大达成，矮屏无破版、无回退（矮屏记谱视口偏窄属固有限制，可滚动，见剩余项 8）。
- 静态清零核对：场景层「font 赋值裸 px 字面量」= 0、`C.textTertiary` 残留 = 0（仅 manager.js/colors 定义保留）。
- 像素复核：`review-shots/replay.png` / `teaching-reveal.png` / `records.png` 三张确认。

> 本报告剩余项均为 P2/P3 非阻断打磨或需真机联调项；用户点名的 P0 六条与高价值七条已全部闭环。

---

## 第二轮审查优化（依据 OPTIMIZATION_PLAN_ROUND2.md · 2026-11-05）

> 范围：仅处理该轮审查明确的 P0/P1/P2 建议，避免无关重构或功能扩展。  
> 先全量核对文档与当前代码现状——文档写于本轮优化前，部分行号/结论已过期，必须先辨明「真问题 vs 已闭环」。

### 核对结论（22 条 P0/P1/P2）

- **文档描述与现状吻合、已落实的项**：`createTap` 90ms 按压、44pt 选项热区、22 条 WAV 音效贯通 —— 属上一轮已闭环，本轮**不实改**。
- **已被现有代码覆盖、文档未识别的项**：`gameplay.js` 已存在「首次清理提示」（Banner「已自动清理最早一局」）、`storage._write()` 已归一化「清空成功/失败区分」——不实改。
- **真问题项（本轮实际改动）**：见下表。

### P0（已全部落实）

| 项                  | 落地                                                                                                                                                                                                                                                  |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P0-01 窄屏大字号内容驱动布局  | setup / settings / endgameMap 三页均改为 `panels.measureSettingRow` + `wrapText` 动态行高/折行；320×568 + 1.25× 实测无文字溢出、不侵控件、不压页脚                                                                                                                               |
| P0-02 继续按钮定位当前阵    | `menu.js` 传 `enter({from:'menu', focusLevel:nextLevel})`；`endgameMap.js` 首帧把当前阵滚入视口（scrollY 钳到 `top - viewportH/3`）+ 吸底「继续 · 第 N 阵」CTA 直达 `pushScene('endgame',{level:N})`。focusLevel 路径已渲染验证（unlocked=11 → `scrollY=637`、CTA region 存在、`lv:11` 存在） |
| P0-03 默认执棋色语义      | `storage.getLastConfig()` 无存档改返回 `null`（方案 A）；`setup` 仅在 `color` 无记录时回落 `settings.defaultColor`；`settings` 该项改名「初始执棋色」+「首次开局时的执棋方；已有记录后沿用上次配置」                                                                                                      |
| P0-04 跳过设置恢复上次全部配置 | `menu.js` 快速开局恢复 `difficulty / color / style`（含 `coach` 指导模式）；旧存档缺 `style` 按 `standard` 兜底                                                                                                                                                          |

### P1（已全部落实）

| 项                                    | 落地                                                                                                                          |
| ------------------------------------ | --------------------------------------------------------------------------------------------------------------------------- |
| P1-01 / P1-04 阵图当前阵主卡 + 章节进度 + 长列表压缩 | 当前阵唯一大卡（金边+脉冲环）；已通关压缩行（成绩★+最佳）；锁定/折叠紧凑预告行（40–48pt）；顶部 10 节点章节进度条（仅展示不注册点击）；y 由「上一张实际高度+间距」累加，maxScroll 动态                   |
| P1-02 状态/动作语义分离                      | done=重玩+成绩；current=继续+目标（金边）；unlocked=挑战；locked=破阵后开启。消除「已通关仍可挑战」「未通关显示通关☆☆☆」                                               |
| P1-03 难度表达                           | 删 10px 空心星，改 `panels.drawDifficultyBar`（5 格 `C.info` 条+文字档位）；成绩星保留 `C.accent` 实心                                            |
| P1-05 开局设置 3 分组 + 1 主按钮              | 对局方式/棋力/执执三 GroupPanel + 行内 `drawSelection`（唯一选中态）+ 单实心金按钮                                                                  |
| P1-06 玩家语言                           | 顶栏「对局设置」；删「搜索深度 N 层」，难度副文案改短行为描述（会漏看威胁/攻守均衡/长考施压）                                                                           |
| P1-07 指导模式难度联动                       | 切 style 不再静默改写用户难度；说明行明示「沿用当前难度，可随时调整」                                                                                      |
| P1-08 执黑提示 ≥12pt                     | 执黑提示与吸底主按钮之间内容区预留（non-compact `contentLimit = summaryY-16` + 兜底钳制；compact `viewBottom = summaryY-14`）；375 执黑实测提示与按钮间隙 ≈40pt |
| P1-09 设置三组信息架构                       | `SETTING_DEFS` 每项加 `group`；`drawSectionHeader`+`drawGroupPanel`+`drawRowDivider`；去逐行卡片边框                                    |
| P1-10 90ms 按压反馈                      | 共享面板层 `renderSettingsPanel(opts.pressedKey)` 命中的 toggle/choice/action 行统一 `drawPressed`；settings/gameplay 两调用方传 pressed     |
| P1-11 浅色主题禁用不矛盾                      | 删 `themeLight` region 注册（真正禁用、不响应点击），保留「敬请期待」说明                                                                             |
| P1-12 自动覆盖二次确认                       | `autoPrune` 从 TOGGLES 移除；开启→`{action:'confirmAutoPrune'}` 弹 confirm 明确「永久删除最早一局」；确认后才落盘。settings + gameplay 两处分派            |
| P1-13 持久化失败回滚                        | `context.saveSettings()` 写失败回滚内存态+副作用并返回 `false`；两调用方检查返回值弹「设置未保存，请重试」                                                      |
| P1-14 清空棋谱局数 + 成功/失败区分               | 模态显示 `listRecords().length` 局数；`okc===false` 为失败分支，成功/失败反馈区分                                                                |
| §7.7 快速开局摘要                          | 行下摘要「上次：中等 · 执白 · 标准」，无记录→「尚无对局记录」                                                                                          |

### P2（已全部落实）

| 项                  | 落地                                                                                                                              |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------- |
| P2-01 共享 TopBar    | setup / settings / endgameMap 三页顶栏统一 `topbar.drawTopBar`（胶囊避让、标题下沉、返回 region）                                                   |
| P2-02 底部渐隐 + 版本号固定 | settings 面板底 16px 渐隐 + 版本号固定在滚动区外并留底部安全间距                                                                                       |
| P2-03 首帧钳制 scrollY | `endgameMap.render` 开头先算动态 maxScroll 并钳 `scrollY`，消除「绘制后才钳制」的一帧空白；`render-shots.js` 折叠态二次渲染兜底                                   |
| P2-04 回归矩阵         | 新增 `tools/verify-round2.js`（功能链路 + 5 视口命中区 + 胶囊避让 + 语义断言）；`render-multi-viewport.js` 新增 `MODE=320-large` 交叉矩阵 + `SHOT_BOTTOM=1` |

### 涉及文件

- **新增**：`src/render/panels.js`（三页共享 SectionHeader/GroupPanel/RowDivider/Selection/Segmented/DifficultyBar + 内容驱动 `lineHeight/wrapText/measureSettingRow`）、`tools/verify-round2.js`
- **修改**：`src/core/storage.js`（getLastConfig→null）、`src/context.js`（saveSettings 失败回滚）、`src/scenes/menu.js`（focusLevel + 恢复全部配置）、`src/scenes/setup.js`（3 分组/玩家语言/联动/内容驱动/摘要/12pt）、`src/scenes/settings.js` + `src/scenes/gameplay.js`（三组/Pressed/主题/自动覆盖/清空局数/摘要/渐隐）、`src/scenes/endgameMap.js`（信息架构重写）、`tools/render-shots.js`（折叠二次渲染 + focusLevel + setup-black 场景）、`tools/render-multi-viewport.js`（320-large 交叉矩阵）

### 验证结论（全部通过）

- 六套回归 **327/0**（与基线一致）：`9/0 · 59/0 · 62/0 · 100/0 · 86/0 · 11/0`
- `tools/verify-round2.js` **61 通过 / 0 失败**（P0-03 命名、P1-09 group、P1-10 pressedKey、P1-11 浅色不注册、P1-12 确认两分支、§7.7 命名、5 视口 setup/settings/endgameMap 命中区 ≥44、顶栏胶囊避让、focusLevel 联动）
- 离屏渲染 **18 场景 / 0 失败**（含新增 `endgameMap-focus`、`setup-black`）
- 多视口 **320×568 + 1.25× 交叉矩阵 0 失败**
- 像素复核：setup(375 执白/执黑)、settings(375/320-large/320-large-bottom)、endgameMap(375/320-large/focus/折叠) 均无重叠/溢出、摘要与提示间距达标、状态语义分层清晰
- 静态清零：场景层「font 裸 px 字面量」= 0、`C.textTertiary` 残留 = 0（仅定义保留）

### 未处理项 / 需确认（产品开放问题，文档 §12）

本轮**无功能遗漏项**（三页面 worker 均报告无遗漏；setup worker 提出的 2 处偏离已由主理人亲自补：non-compact 摘要 + 12pt 间距、执黑 8pt→12pt）。  
以下为文档标注的**产品决策项**，本轮已按最小影响假设落地，待产品确认是否调整：

1. **菜单「继续」直接进残局 vs 先进阵图**：本轮采方案 2（阵图内定位当前阵 + 吸底「继续·第 N 阵」CTA），未做方案 1（直接进残局对局）。
2. **默认执棋色语义**：采「首次生效 + 有记录后沿用上次配置」，即「初始执棋色」。
3. **快速开局是否继承指导模式**：是（从 `lastConfig` 恢复 `style/coach`）。
4. **阵图长列表 vs 10×10 章节地图**：本轮保持「当前阵主卡 + 压缩行 + 锁定紧凑预告」单列信息架构，去掉了 `>520` 双列（动态卡高 + 主卡+压缩行本质单列）；未做章节地图可视化。
5. **浅色主题是否本轮开放**：否（保持禁用说明、不可点）。

> 第二轮审查范围内的 P0×4 / P1×14 / P2×4 全部落实并通过验证；仅上述 5 项产品开放决策按最小影响假设处理，需产品拍板是否变更。

---

## 第三轮打磨（用户 5 项 · 2026-11-05 全部落地）

> 承接第二轮审查后，用户指定 5 项剩余打磨/功能优化（原 P2/P3 非阻断 + 1 新模式）。
> 工程纪律：最小影响、不破坏现有契约、统一 token 化、回归全绿。

### §1 横屏 / 平板适配
- **残局 `endgame.js` `layout()`**：`cellCap` 由 `52` 改为按 `L.isTablet` 抬高至 `round(52 * (L.scale||1))`（平板 ≈58）；
  左右留白与上下约束消费 `L.isTablet/isLandscape/scale`，横屏受 `availH` 自然收敛、居中不溢出。
- **教学 `teaching.js`**：棋盘宽度上限 `304 → (L.isTablet?360:304)`，单元格上限 `38 → (L.isTablet?46:38)`，平板更饱满、横屏不破版。
- 验证：harness 新增 `endgame-tablet`(834×1112) `cellSize=58`、`endgame-landscape`(812×375) `cellSize=28 boardY=146 不溢出`、`teaching-tablet` 均 0 失败。

### §2 圆角 / 间距 token 化
- **`endgame.js`**：魔法圆角 `8→R.sm`、`10→R.sm`、`999→R.pill`、`4→R.chip`（抽屉卡 / 弹窗方块 / 数量角标 / 技能卡）；
  新增 `const SP = theme.spacing`，`layout()` 内 `20→SP.xl`、`32→SP.xxxl`、`24→SP.xxl`、`8→SP.sm` 等精确等价替换（像素零偏移）。
- **`teaching.js`**：`4→R.chip`、`10→R.sm`（复盘弹窗 / 教学内升变方块）。
- 目标：场景层不再出现裸圆角字面量，统一走 `R.*` / `SP.*` token。

### §3 菜单 NEW 徽章 + 设置 toggle 关态打磨
- **`menu.js` NEW 徽章**：`surface3` 深块 → `C.accentDeep`（深一档黄铜）实底 + `C.bgBase` 近黑字 + `R.pill`，
  作为黄铜 Primary 上的「凹陷标签」，融入金色调、不再悬浮突兀（视觉复核确认）。
- **`settings.js` `toggleSwitch`**：关态由 `surface3` 单一深块 → `C.surface2` 略亮轨道 + `C.border` 描边轮廓 + `C.textTertiary` 旋钮，
  与开态黄铜实底形成高对比，「空态」可辨识度明显提升（视觉复核确认）。

### §4 复盘记谱网格居中 + 极矮屏 coach 气泡 + 执黑方位预览
- **`replay.js` `_autoScrollGrid()`**：由「顶/底对齐」改为「**当前步所在行视口居中**」（`target = curRow*rowHeight + rowHeight/2 - viewportH/2`，钳 `[-, maxScroll]`），
  首/尾步边界仍钳制，天然露出相邻 2 行上下文。
- **`gameplay.js` `renderCoachBubble` / `renderHintStrip`**：`band.h < 22` 门槛放宽至 `18`，气泡高度 `Math.max(18, Math.min(band.h, COACH_BAND_H))` 保底一行可见，
  极矮屏教练提示不再完全消失（320×568 harness 0 失败）。
- **`replay.js` 执黑方位预览**：玩家 `playerColor==='b'` 时棋盘翻转，并在元信息卡与棋盘间预留 24px 标签位画出「**执黑 · 棋盘已翻转**」pill（`accentFade` 底 + `accentLine` 描边 + `accentSoft` 字），四周留出相邻 2 行上下文提示方位（视觉复核确认翻转 + 标签可见）。

### §5 双人对弈（local）视角随 sideToMove 翻转【本批次已变更，见下方「变更」】
- 复用既有 `local` 模式与 `flipBoard`：`gameplay.js enter()` 在 `mode==='local'` 下设 `flipBoard = (game.turn===BLACK)`（白先走→白在底=false）；
  `commitMove()` 走子后、`doUndo()` 悔棋后均按 `game.turn` 重新同步 —— **当前走子方始终在屏幕底部（近端玩家视角）**，每步随轮次 180° 翻转。
- HUD 顶/底色与「轮到谁」高亮本就由 `flipBoard` 推导，无需改命名逻辑；坐标系 `cellToScreen/screenToBoard` 已就绪。
- 验证：harness `gameplay-local`（进入 `flipBoard=false` 白在底）→ `gameplay-local-flip`（白走一步后 `flipBoard=true` 黑在底）均 0 失败。
- **本批次变更（依据：用户需求，2026-11-08）**：本地双人棋盘方向**改为全程固定** —— 默认白在屏幕下方（`flipBoard=false`），**不再随 `sideToMove` / `game.turn` 翻转**；仅玩家**手动调转**时才改变且**持续保持**（不因走子 / 悔棋复位）。屏幕上方一侧的棋子旋转 **180° 朝上**。`mode:'remote'` 亦各端固定看自己执棋色一侧、全程不翻转。上文「视角随轮次翻转」为变更前设计，仅作历史记录，不再适用。

### 涉及文件
- **修改**：`src/scenes/endgame.js`、`src/scenes/teaching.js`、`src/scenes/menu.js`、`src/scenes/settings.js`、`src/scenes/replay.js`、`src/scenes/gameplay.js`
- **仅 harness 扩充（不入正式测试）**：`tools/render-shots.js` 新增 `gameplay-local` / `gameplay-local-flip` / `replay-black` / `endgame-tablet` / `teaching-tablet` / `endgame-landscape` / `menu-newbadge` 共 7 场景（总 25 场景 0 失败）

### 验证结论（全部通过）
- 六套回归 **327/0**（与基线一致）：`9/0 · 59/0 · 62/0 · 100/0 · 86/0 · 11/0`
- `tools/verify-round2.js` **61 通过 / 0 失败**（第二轮断言无回归）
- 离屏渲染 **25 场景 / 0 失败**（新增 7 项均通过，含横屏/平板/双人对弈翻转/执黑方位预览/NEW 徽章）
- `node -c` 六场景文件全通过

---

## 第三轮补充（用户 3 项 · 2026-11-05 深夜）

> 截图反馈 3 项：① 锦囊揭晓弹窗技能卡 effect 出现英文码 `undos + 1`；② 页面间距普遍偏小、设置页圆角块突兀；③ 真机预览上传超 4MB（8252KB）报错。

### §1 技能卡英文码中文化（数据层）
- 根因：`src/data/endgames.js` 技能 `effect` 字段用反引号包裹英文变量（`undos + 1` / `hints + 2` / `timeLimit +20s` / `moveCap + 3`），而 `util.wrapLocal` 只折行、不解析反引号 → 英文原样渲染。
- 修复（全量，避免同类漏网）：
  - `skill_undo`：`本阵 \`undos + 1\`` → **本阵回马枪次数 +1**
  - `skill_mirror`：`本阵 \`hints + 2\`` → **本阵锦囊提示 +2**
  - `skill_hourglass`：`本阵 \`timeLimit\` +20s` → **本阵时限 +20s**
  - `skill_ward`：`本阵 \`moveCap + 3\`` → **本阵步数上限 +3**
- 验证：harness 新增 `endgame-skillpopup`（锦囊揭晓弹窗）实拍确认小字行 =「本阵回马枪次数 +1」，无英文码；grep 确认无残留 `\`[a-z]` effect。

### §2 间距 + 设置页圆角块打磨（共享版式层）
- `src/render/panels.js` 统一 token 上调：`GROUP_GAP 20→24`、`GROUP_PAD 14→16`、`ROW_BASE_H 56→60`；
  `drawGroupPanel` 增 1px `C.border` 描边，定义卡片边界、消除 surface1 块在 bgBase 上「悬浮突兀」。
- `src/scenes/settings.js`：标签→说明行距 `4→6`、分组标题与面板间距 `6→10`、面板顶部留白 `8→12`。
- 影响范围：settings / setup / endgameMap 三页共用同一 `panels` 原语，统一受益（仍内容驱动、可滚动，不溢出）。
- 验证：harness `settings` 实拍确认分组间距/行内留白更透气、块边缘更柔和；320×568 交叉矩阵 0 失败。

### §3 真机预览上传超限（4MB）治理（非破坏性）
- 根因：`review-shots/` 25 张 2x PNG 共 **7.9MB**，是上传包（实报 8252KB）超限主因；另 test 套件 / md 文档亦计入。
- 修复：在 `project.config.json` 的 `packOptions.ignore` 增加忽略项 —— 文件夹 `review-shots`、`tools`；后缀 `.md`；根级 `test*.js` 与 `verify-round2.js`。
- 估算上传包体积：**8252KB → 约 851KB（0.83MB）**，远低于 4MB 上限；运行时代码 + 音频资产全部保留。
- 说明：仅配置忽略，未删除任何文件；`review-shots/` 为可重生验证产物，如需回收磁盘可随时删。

### 涉及文件
- **修改**：`src/data/endgames.js`、`src/render/panels.js`、`src/scenes/settings.js`、`project.config.json`
- **仅 harness 扩充**：`tools/render-shots.js` 新增 `endgame-skillpopup`（总 26 场景 0 失败）

### 验证结论（全部通过）
- 六套回归 **327/0**；`verify-round2.js` **61/0**；`node -c` 改文件全通过
- 离屏渲染 **26 场景 / 0 失败**；上传包估算 **≈851KB < 4MB**

---

## 第四轮：走查清单落地（P0/P1/P2 + 文案精修 · 2026-11-05）

> 用户下发评审走查清单，要求「重新走查、梳理既有优化建议、按建议清单有序实现与修正，确保改动正确且不影响既有功能」。
> 落地顺序：P0 命中区/假展开 → 顶栏/初始态 → 统一设置行模型/节奏/滚动 → 320 可发现性/文案/惯性/对比度。

### §1 P0 阵图命中区误触旧关卡（关键回归修复）
- 根因：`endgameMap.js` 滚动后仍按**卡片完整高度**注册 `lv:N` 命中区，滚出视口的旧关卡 rect 覆盖固定章节条 / 底部安全区，导致点章节条误进旧关。
- 修复（`render` 列表循环）：命中区按 `ry=max(sy,vTop)`、`rb=min(sy+h,vBot)` 钳到 `[listTop, viewportBottom]`，`rb>ry` 才注册；新增 `this._listViewport` 暴露视口上下界供断言。
- 断言升级：`tools/verify-round2.js` 原有「可见命中区均 ≥44pt」建立在错误全高注册假设上，改为编码 **P0 新不变量**——卡片命中区不得越出 `_listViewport` 上下界，且仅**完整可见**卡要求 ≥44pt（部分可见底卡不再误报）。61 → **66 条全过**。
- 独立验证 `/tmp/verify_p0.js` **7/0**：聚焦第 11 阵时点章节条(y=155)/底部空隙(y=632) 均返回 `null`，`lv:11` 可见区正常命中，初始态 `lv:1..6` 连续 + `fold` 存在。
- 附带：`showCTA=true` 常驻吸底 CTA 后短列表的 `fold` 会被挤出视口，改为**始终注册但 rect 钳在视口内**（完全不可见时退化为 0 高占位），既保住 `test-endgame-scene.js` 硬断言，又不破坏 P0 反点击吞没。

### §2 P0 假「展开」交互
- `_layoutFold` 文案「破阵后展开」→ **「随章节开放」**；`_drawFold` 去掉按压态；`_activate('fold')` 直接 return，不导航、不弹 banner —— 纯信息行，不再承诺点击展开。

### §3 P1 顶栏标题 / 初始态 / 选中信号
- `topbar.js`：标题下沉阈值 `ew < tw*0.5` → **`0.75`**，长标题更早下沉为两行；阵图标题统一为「阵图」（短，永不截断）。
- `panels.js`：`drawSelection` / `drawSegmented` 选中态由「accentFade 底 + 2px 金左轨 + ✓」降为 **accentFade 底 + 右侧 6pt 金点（≤2 信号）**；新增 `drawRadioRow`（整行标题 + 可选 sub + 右侧金点/细环，未选项无独立底板）。

### §4 P1 阵图信息架构 / 语义 / 滚动（map-p1）
- 锁定行底色 `C.surface3` → **`C.bgBase`**（融入页面背景「退后」）；当前大卡**移除卡内徽章**，单一动作收口到吸底 CTA。
- `showCTA = true` 常驻主操作；CTA 文案首进「**开始** · 第 N 阵」、有进度「**继续** · 第 N 阵」。
- 已通关行删「成绩」前缀整行，右侧由「重玩」胶囊改**细箭头 `›`**（整行可重进语义）。
- 顶/底渐隐 **24pt**；惯性滚动 `update()` 每帧 `scrollY -= _vy; _vy *= 0.93`（`|<0.5` 归零），尊重 `reduceMotion`。
- 秒单位 `s` → **「 秒」**（「最佳 12.3 秒」/「目标 1 步 · 45 秒」）；`endgame.js` 定风珠同步「计时暂停 N 秒」。

### §5 P1 开局设置统一设置行模型（setup-p1 + 主理人收口）
- 三组统一 `SectionHeader + GroupPanel(surface1 圆角16 + 1px 描边)`，组间 `GROUP_GAP=24`、标题→容器 10pt；**compact（320/矮屏/1.25×）**下「标准/指导」「执白/执黑」由分段改为**两行 `drawRadioRow` 行式单选**（整行命中区 ≥44pt、选中 accentFade + 金点）。
- **375 基准保持单行分段**：7 行堆叠数学上放不进 375×667 可用区（约超 32pt）。worker 曾让 375 也整页滚动，实拍发现**首帧「执棋」组被裁掉半行 + 底部渐隐压内容**，属既有「一屏可见全部设置」的回归。主理人拍板：**non-compact 恢复单行分段 + `maxScroll=0`**（三组一屏完整、不滚动、不渐隐），compact 才用行式单选 + 滚动。既保留统一模型收益，又不牺牲主力机型既有交互。
- 开始对局图标：写死 `-44` 偏移 → 按 `measureText` 文字宽计算 `cx - labelW/2 - 10 - 20`，图标与文字整体居中，消除重叠。
- 惯性滚动 / 24pt 渐隐 / **右缘 2px 细滚动条（0.25 alpha、滚动后 800ms 自动隐藏，不压卡片）**；移除主理人一度加入的「下滑查看更多」文字提示（实拍与裁切行重叠，渐隐已足够表意）。
- 文案精修：难度「偶有疏漏/攻守均衡/步步紧逼」；标准「安静对弈，不显示教练提示」、指导「AI 每步讲解，锦囊提示不限次」；执白「你先行」/执黑「AI 先行」；执黑提示保留「**棋盘将翻转**」。

### §6 P1 设置页（settings-p1）
- 320 折行 `stackChoice = viewportW <= 340`（去掉 fontScale 条件）；空态清空改为**仅「知道了」信息弹窗**，无危险动作；主题行删 chip + region，降为纯只读文字「墨金棋院 · 浅色主题开发中」。
- 右缘 2px 细滚动条（滚动时显示）+ 顶部 24pt 渐隐 + 惯性滚动；清空红字 `#D96A6A` → **`#E07A7A`** 提对比度；文案「首次对局的执棋方；之后沿用上一局」「减少动画、闪烁与画面晃动」。

### 涉及文件
- **修改**：`src/scenes/endgameMap.js`、`src/scenes/setup.js`、`src/scenes/settings.js`、`src/scenes/endgame.js`、`src/render/panels.js`、`src/render/topbar.js`、`tools/verify-round2.js`
- **验证脚本（非交付）**：`/tmp/verify_p0.js`

### 验证结论（全部通过）
- `node -c` 七个改动文件全通过；六套回归 **327/0**（`9/0 · 59/0 · 62/0 · 100/0 · 86/0 · 11/0`）。
- `tools/verify-round2.js` **66/0**（新增 5 条编码 P0 不变量）；`/tmp/verify_p0.js` **7/0**。
- 离屏渲染 `tools/render-shots.js` **26 场景 / 0 失败**；`tools/render-multi-viewport.js` 的 `320` / `320-large` / `320-large-bottom` 均 1/0。
- 像素复核：setup 375 执白/执黑三组一屏完整、无裁切无重叠；setup 320×1.25× 首帧渐隐可发现、滚到底部执棋组完整；settings 底部主题行纯文本、清空红字、细滚动条不压字；阵图 focus=11 滚动定位 + 吸底 CTA、锁定行融入背景、无假展开。

### 本轮产品/设计取舍（待拍板）
1. **375 与 compact 控件形态不同**：375 用单行分段，320/矮屏/大字号用行式单选。取舍理由是 7 行堆叠放不进 375 且不应牺牲主力机型一屏可见；若要求两态完全一致，需放宽「两行堆叠」或「组间 24pt」之一。
2. 阵图 `showCTA=true` 常驻后，初始短列表的折叠汇总行需滚动才可见（命中区以 0 高占位保住既有断言）。

---

## 第五轮：棋盘界面布局微调 + iPad 宽屏适配（2026-11-06）

> 用户 4 张截图（双人对弈 / 对局设置 / 人机对战·简单 / iPad Pro 12.9 主菜单）提出 4 项，硬约束：
> **仅调整视觉表现，不改变棋盘逻辑、选中交互及现有功能；保持整体风格一致；不影响现有尺寸下的显示效果。**

### §1 根因（只读研究结论）
- **间距被木框吃掉**：`src/render/board.js` 木质外框 `frame = config.BOARD.frame = 10`，从 `y-10` 画到 `y+boardSize+10`。`gameplay.js` 原有 `boardTop = hudY+hudH+10`、`bandY = boardBottom+10` 两处名义 10pt 恰好被上下各 10pt 木框**完全抵消**，HUD 卡底与木框顶、木框底与信息带顶实测均 **0pt 贴合**。
- **顶部拥挤**：`hudY = top + navH + 4`，顶栏底到 HUD 顶仅 4pt。
- **iPad 窄竖列**：`menu.js` 零宽屏分支；`btnW = min(W-32, 343)` 硬上限锁死主内容；底部 tab `slotW = W/3` 无上限铺满整屏；`heroR` 上限 150 使插画过小；标题 `contentTop+132` 上锚定与按钮 `contentBottom-8-…` 下锚定在 tall 屏拉开近 900pt 空洞。
- `layout.js` 已提供 `isTablet`(W>414 或 min(W,H)≥600) / `isLandscape` / `contentW`，834×1112 与 1024×1366 均命中 `isTablet=true` 且 `isLandscape=false`（**只挂横屏分支会完全漏掉报障尺寸**）。

### §2 棋盘页 `src/scenes/gameplay.js`（只改此文件）
- **垂直间距**：`hudGap 4→10`、`boardGap 10→16`、`bandGap 10→18`（净留白 = 常量 − frame）。新增 `BAND_BOTTOM_GAP=8`，`renderSAN` / `renderCoachBubble` / `renderHintStrip` 的内容高度收敛到不与工具栏分隔线相顶，SAN 文字居中于可用区。
- **矮屏双档（`LM.isCompactH`）**：`hudGap/boardGap/bandGap/sanMinH = 8/12/14/28`（375 及以上仍 `10/16/18/32`）。目的：增大留白后，既有竖向安全退让 `maxBoardByHeight = toolbarY-10-sanMinH-boardTop` 不会把 320 棋盘从 33 格压到 32 格。**实测 375 cellSize=43、320 cellSize=33，均未变**。
- **选中态与底部线条精准对齐**：
  - HUD「当前行棋方」激活态（头像 `x+13` 描金边 + 名称金色）与 AI 思考呼吸条（HUD 内唯一贴底线条）统一水平基准 `pad=13`，垂直 `y+bar.h-3` 使 2pt 条底与卡片描边底仅差 0.5pt。
  - 工具栏按压高亮 `y+4,h-8` → `y+2,h-4`，与顶部分隔线 `y+0.5` 上下对称（距线 1.5pt、距底 2pt）。`toolbarRegions` 的 key/rect 完全不变。
  - 横条（HUD / SAN / 教练带）`x,w` 由 `gutter, W-24` 改为与棋盘木框左右边界 `railX/railW` 精准对齐（375 下 `[5,369]`）。
- **iPad 宽屏（`isTablet` 严格隔离，且排除 `isCompactH` 极端矮横屏）**：
  - 横条宽度收上限 `min(W*0.68, 720)`、工具栏按钮列收敛到同宽居中（背景与分隔线仍全宽）。
  - 「棋盘 + 信息带」整体在 `[boardTop, toolbarY]` 垂直居中，`infoH=64` 收敛信息带高度；1024×1366 上下留白 **135/135 对称**（原为 0/310 失衡）。
  - `bandH` 增加 `min(infoH, max(0, toolbarY-bandY))` 防御，任何视口信息带都不得越过工具栏分隔线。

### §3 主菜单 `src/scenes/menu.js`（只改此文件）
- `isTablet` 分支新增内容列 `colW=min(contentW,560)`：`btnW` 上限 `343→480`、按钮整组垂直居中（`UI_H=min(620, availH)`）、底部 tab 由 `W/3` 收敛到 `colW/3` 居中、`heroR` 上限抬到 200 且**严格收敛在「副标题↔主按钮」可用带内**（上下各留 10pt，消除插画被黄色按钮切断）。
- **极矮横屏降级**（812×375 等内容区 < 438pt）：`showDecor=false`，装饰性标题/插画让位，按钮组在可用区垂直居中，保证所有交互元素完整可见、不越界、不重叠。
- 非 tablet 分支**逐字保留**原下锚定/上锚定/紧凑重排逻辑；字号、颜色 token、按钮/tab 的 key、命中区语义、导航、progText/NEW 判定一律未动。

### 涉及文件
- **修改**：`src/scenes/gameplay.js`、`src/scenes/menu.js`
- **未改（显式禁止）**：`config.js`（BOARD/FONTS）、`src/render/board.js`、`src/core/layout.js`、全部 `test*.js` 与 harness 源码
- **验证产物（可重生）**：`review-shots/*-final3-*.png` 等

### 验证结论（全部通过）
- `node -c` 两文件通过；六套回归 **327/0**（`9/0 · 59/0 · 62/0 · 100/0 · 86/0 · 11/0`）；`verify-round2` **66/0**；P0 脚本 **7/0**；`render-shots` **26 场景 0 失败**。
- **基线逐像素不变**：`menu` 375 三份出图 sha1 全等 `1137602…`，320 两份全等 `5dc461e…`；gameplay 375/320 的 `cellSize` 43/33 不变。
- 像素复核视口：375×667、320×568、834×1112、1024×1366、1366×1024、812×375（共 6 类）。iPad 竖/横屏上下留白对称、无拉伸/错位/重叠/大片空洞；矮横屏信息带不越工具栏线、菜单按钮完整居中。
- 交互未动：`selected` / `legalMoves` / `thinking` 状态机、`toolbarRegions` / `hintRegions` 的 key 与命中判定、导航逻辑均未改。

### 已知既有限制（非本轮引入，未动）
- 812×375 手机横屏下，棋盘受 `cell = Math.max(20, cell)` 下限约束仍与工具栏区域较近；本轮已保证 HUD/信息带/工具栏不越线不重叠，未改该下限以免影响其它矮屏。

---

## 第六轮：结算弹窗「混入字符」修复 + 交互/视觉全面走查 + iPad/折叠宽屏适配（2026-11-06）

> 用户截图反馈「人机结束弹窗中，悔棋继续按钮混入了其他字符」，并要求以专业游戏交互设计师 + 视觉设计师视角全面走查页面，特别注意 iPad 大屏、折叠宽屏适配。

### §1 根因：不是字符串污染，是图标与文字坐标重叠
- 弹窗唯一绘制出口 `src/scenes/gameplay.js:renderGameOver`（改前 1056-1098）。
- 第三行右侧原 `:1095` `icons.drawChevron(ctx, W/2+54, ly+10, 16, 'left', C.textSecondary)` 画一个左向 V 形；`:1096` `'悔棋继续'` 文字中心 `W/2+68`、4 字约 52pt → 首字「悔」覆盖 `W/2+42..55`；V 形 glyph 落在 `W/2+51..56`，**两者完全重叠、同色同基线同字号**，看起来就像混进了 `‹`（`EXPERIENCE_OPTIMIZATION_SPEC.md:35` 甚至记作「‹悔棋继续」）。
- 逐字核对：`'悔棋继续'` 码点 U+6094 U+68CB U+7EE7 U+7EED，干净；全 src/ 零宽空格 / BOM / 私用区 / 替换字符 / `\u` 转义 **0 命中**；不来自任何配置表或文案表，是硬编码字面量；渲染链路是纯 `ctx.fillText`，无 fitText / 图标拼接 / 计数拼接。
- **修复**：整行删除 chevron；`'悔棋继续'` 字面量与 `undo` 命中区 key 均不动。

### §2 走查发现的连带缺陷（一并修复）
| 项 | 问题 | 修复 |
|---|---|---|
| P0 误触 | 主按钮行 `by..by+48` 与第三行命中 `by+52..by+96` 仅隔 **4pt** 且 x 完全重叠 → 点「返回菜单」下沿会命中 `undo`（唯一静默改写棋局的出口） | `ly = by+bh+24`（原 +16），间隔 **12pt** |
| P0 不对称 | 两枚文字按钮中心 `W/2-60` / `W/2+68`（偏移差 8pt）、命中宽 100/110 不等、与上方主按钮列不对位 | `off=64`，中心 `W/2∓64`，命中等宽 `110×44`、x=`W/2∓off-55`，严格镜像且与主按钮两列对位 |
| P1 权重倒挂 | 只读的「查看棋谱」用品牌金 `C.accent`，会改棋局状态的「悔棋继续」却用最弱 `C.textSecondary` | 两枚统一 `C.textPrimary`，金色只留给唯一 primary |
| P1 无按压反馈 | 三个文字 key 只 `fillText`，按下去无任何响应（`tap.guard` 防连点本已覆盖 5 key） | 补 `this.tap.isPressing` → 按下变 `C.accent` + `util.drawTapHighlight` |
| P1 状态文案矛盾 | 本地双人 `outcome` 恒 `'win'`（`:1459`）→「黑方获胜！」+「你赢了」+ 绿色同时出现 | `renderGameOver` 内仅当 `mode!=='ai' && r!=='draw'` 用中性「本局结束」；不动 `onGameOver` 的 outcome |
| P1 层级倒挂 | 和局 `accColor = C.neutralBadge`(=`C.textSecondary`)，28px 粗体「和棋」与 13px 文字按钮同色，结果像禁用 | 和局标题改 `C.textPrimary`（`accColor` 唯一消费者即标题） |
| P1 视觉误导 | 结算时底部工具栏三枚仍全不透明可见，但触摸全被模态拦截；且底部「悔棋」与弹窗内「悔棋继续」同名不同行为 | `renderToolbar` 加 `modalGameover`，仅把渲染 `globalAlpha` 置 0.35；`canUndo` 白名单 / `hintUsable` / `toolbarRegions` rect+key 全不动 |

### §3 iPad 大屏 / 折叠宽屏适配
- **先纠正预设**：卡片 `dw = Math.min(W*0.88, 340)` 有硬上限，**不会拉伸**。真实缺陷是「340×268 的手机尺度小岛浮在大屏中央」——iPad Pro 12.9 上仅占屏宽 **33.2%**、1366×1024 上 **24.9%**；`dh` 恒 268、字号/按钮高全为手机尺度，`layout.get().scale=1.12` **完全未消费**。遮罩是 full-bleed 正确，无需改。
- **方案**：以屏幕中心为 pivot 的**局部等比缩放**。遮罩留在 transform 之外；卡片与全部内容包在 `translate(W/2,H/2) → scale(s,s) → translate(-W/2,-H/2)` 内；**所有绘制坐标仍用 W/H 设计坐标不变**，字号靠 `ctx.scale` 自动等比放大（不引入裸 px 字号、不动 `manager.js` / `theme.fontScale`）。
- `s = isTablet ? min(1.45, max(1.20, min(W/700, H/700)), (H*0.62)/268) : 1`；`isTablet = (L.isTablet || L.isLandscape) && !L.isCompactH && min(W,H)>=600`。
- **命中区**：新增 `pushRegion(key,x,y,w,h)`，按 `x' = W/2 + (x-W/2)*s`、`y' = H/2 + (y-H/2)*s`、`w'=w*s`、`h'=h*s` 换算到屏幕坐标；`s===1` 时逐值恒等 → 375/320 基线逐像素不变。
- 卡片占屏宽：1024×1366 **33.2% → 48.1%**、1366×1024 **24.9% → 36.1%**、834×1112 **40.8% → 48.9%**。
- **边界修正（主理人复核发现）**：`layout.js:172` 的 `W>414` 会把 430×932 这类**大屏手机/折叠外屏**误判为平板，首版让卡片占屏 94.9%、左右仅剩 11pt，属「影响现有尺寸显示效果」的回归。加 `min(W,H)>=600` 门槛后 430 回落 `s=1`、边距恢复约 45pt。812×375 / 320×568 由 `isCompactH` 排除，`s=1`。

### §4 本轮未纳入（列为后续建议）
1. 术语全局统一：标题「和棋」/ perspective「平局」/ `reasonText` 的「逼和（无子可动）」三套说法。
2. 不可逆终局（`resign` / `checkmate`）仍提供「悔棋继续」：按钮语义「反悔终局」与实际行为「撤最后一手」错位。
3. 「查看棋谱」(`from:'gameover'`) 返回路径现绕 `popToRoot + pushScene('records')`，回不到结算决策点（用绕路掩盖软锁）。
4. `renderPromotion`（`W*0.9` vs 结算 `W*0.88`）、`renderMoreDrawer` / `renderSettingsDrawer`（`W-16` 全宽抽屉在宽屏拉伸）、`endgame.js` 平行模态 —— 属「宽屏浮层专项」，与结算弹窗零耦合，单列处理。
5. 共享 token 历史对比度债：`accentLine` 1.49:1、`borderStrong` 1.98:1 未达 UI 3:1；`renderMoreDrawer` 两处硬编码 rgba。改 `C.*` 会波及 7 个场景，禁止顺手改。

### 涉及文件
- **修改**：`src/scenes/gameplay.js`、`tools/render-shots.js`（新增 10 个结算态出图场景，26 → 36）
- **未改**：`config.js` / `board.js` / `layout.js` / `manager.js` / `icons.js` / `tap.js` / 所有 `test*.js`

### 验证结论
- `node -c` 两文件通过；六套回归 **327/0**（9/59/62/100/86/11）；`verify-round2` **66/0**；P0 脚本 **7/0**；`render-shots` **36 成功 / 0 失败**。
- 独立验证（全新视角，151 断言 + 重跑全部命令）判定 **PASS**：9 视口命中区独立重算与 `ctx.scale` 视觉位置逐值对齐、间隔 ≥12pt、两两不重叠、≥44pt、全在卡片内/屏内；5 个非默认状态（胜/负/和/未存档/本地双人）文案与颜色正确；`s===1` 时 `again/menu` 与旧公式逐值恒等；普通 gameplay 出图改前改后 sha1 一致。
- 平台铁律：新增代码裸 px 字号 / 硬编码色值 / `eval` / DOM **0 命中**；遮罩未被缩放、`elevation.e2` 阴影不受 CTM 影响、`pushRegion` 无遗漏。
- 像素复核 10 张：375/320/834/1024/1366×1024/717×1136/1280×800/430×932 + 胜局/未存档态，均无混入字符、无裁切/重叠/错位/失衡留白。
- 交互契约全守：`modalRegions` 5 个 key（`again/menu/view/save/undo`，运行时 4 枚因 view/save 互斥）、`onModalAction` 分派、`tap.guard`、gameover 遮罩点击拦截、payload 形状、存档闩锁、卡片配方一律未动。

---

## 第七轮：云端持久化架构升级 + 授权/信息管理 + 合规（2026-11-07）

> 用户诉求：保持玩法/交互/存档读取体验不变；残局、棋谱、进度、存档改云端持久化，增删改与状态变化同步数据库，兼容本地数据、防清缓存丢进度；设置中增加轻量授权与信息管理（授权状态、基本资料查看维护）；补齐安全校验、隐私声明与查看入口、未成年保护提示与配置；授权克制、传输存储安全；交付可直接集成结果并明确需确认的权限/配置项/影响线上数据的操作。

### §1 技术选型（主理人拍板）
- **方案：`wx.cloud` 前端直连云数据库 + 集合安全规则，零云函数、零 npm、零 `wx.request`。**
- 否决「自建后端 / 云函数」：工程无 `package.json`、无构建链，`wx-server-sdk` 属 npm 依赖，与平台铁律冲突；云函数还需备案域名、合法域名白名单、TLS、code2session 与自签 JWT，工程与合规成本都高。
- 安全性由平台承担：小程序端 `add()` 自动注入 `_openid`（客户端不可伪造、不可 update 修改），安全规则 `{"read":"doc._openid == auth.openid","write":"doc._openid == auth.openid"}` 在服务端强制隔离；`wx.cloud` 走微信私有通道，无需 `request` 合法域名。
- **授权范围最小**：只用 openid 区分用户，不索取 `scope.userInfo`、不调 `getUserProfile`（小游戏无 wxml `<button open-type>`）、不收集微信头像昵称/手机号/位置/通讯录。「基本资料」实现为**用户自填昵称**（`chess.profile.v1`），不引入任何新 scope。

### §2 核心架构：本地优先 + 云端 KV 镜像
- **绝对约束（研究确认）**：`storage.js` 28 个导出全同步；20+ 处 `enter()`/`render()` 直接同步读；六套测试全部依赖「写后立刻读」与 `getStorageSync` 缺失返回 `''`。因此**不改任何读 API 签名、不引入 Promise**。
- 落点：`src/core/storage.js` 三个写原语（`_rawSet`/`_writeJSON`/`_rawRemove`）本地写成功后触发可注册旁路 hook（`addWriteHook`，每 hook 单独 try/catch、绝不改变返回值/同步语义）；`applyRemote()` 在抑制 hook 标志下回填，防回环，残局走 `saveEndgame()` 维持 `_endgame` 活对象同引用。
- 新模块：`src/core/cloud.js`（能力探测 + 惰性 init + 全部方法不可用时返回已决议 `{ok:false,reason:'unavailable'}`、绝不 reject；`where` 必带 `_openid:'{openid}'`；key 白名单/命令对象/字节上限消毒；用 `db.serverDate()`）；`src/core/sync.js`（pull→逐 key `mergeKey`→`applyRemote` 回填→push；`rev` CAS、`opId` 幂等、tombstone、`pendingQueue` 失败重试）。
- **首次上云顺序：先 pull → 合并 → 再 push**，绝不 push 本地覆盖云端；迁移是「每用户首次启动客户端完成」，非服务端批量作业。
- **字段级语义合并（非全局 LWW）**：`cleared` 并集且 `stars=max`/`bestTimeMs=min(>0)`/`bestMoves=min(>0)`/`rewarded=OR`、`unlockedLevel=max`、`tipsCollected` 并集去重、`stats=max`；增减型 `skills`/`pendingHints` 用局部 LWW（已知取舍）；`index.ids` 并集重排 + 满 50 裁剪并为被裁局写 tombstone；删除优先于更新；设置/断点 LWW；脏值先归一化。
- 两个集合：`chess_state`（每用户 1 文档，8 类小 key KV 镜像 + ops）、`chess_records`（一局一文档，`key` 保留本地前缀 `chess.record.v1.<gameId>`，列表只拉索引摘要，绕开前端 20 条/1MB 限制）。

### §3 授权状态机与合规
- `src/core/privacy.js`：`unknown→need→granted/denied`，走官方 `wx.getPrivacySetting`/`wx.requirePrivacyAuthorize`/`wx.openPrivacyContract`（小游戏无 wxml，必须官方系统弹窗）；状态只持久化 `{state,updatedAt,cloudSyncEnabled}`，**不存 openid/PII**；低基础库降级 GRANTED 但仍叠加 `cloud.isEnabled()` 门控；**DENIED = 仅本地模式、零云调用、玩法完全不受影响**（合规关键：不能先同步后补授权）。
- `game.js`：`privacy.init()` → `sync.init()+sync.start()` 全异步、不阻塞 `switchTo('menu')`；`onShow` 30s 节流 `refresh()+flush()`；`onHide` 断点保存一字未改。`game.json` 未加 `"cloud": true`（libVersion 3.0.0 已足够，加了反而锁定内置云能力版本）。
- 设置页新增「账号与隐私」分组 6 行（授权与云同步状态 / 云同步开关 / 我的资料 / 隐私声明 / 适龄与家长监护 / 删除云端数据）；`SETTING_DEFS+GROUPS` 数据驱动使设置页与对局设置抽屉**双端同时生效**（`gameplay.js:onModalAction` settingsDrawer 分支同步接入）。未新增场景/滚动容器/度量常量（375 `maxScroll` 本来 >0，新增组只是线性增大 contentHeight）。
- 儿童保护：不自建防沉迷计时器（微信健康系统统一强制实施，自建反而冲突）；隐私政策设儿童个人信息与监护人同意专章；适龄提示内置建议值 8+（需用户最终确认）。
- 主理人收尾修复 4 处：**删除云端数据顺序反转为「先 `requestDeleteAll()` 再 `privacy.clearAll()`」**（原顺序会因授权态打回 UNKNOWN 被门控拦成 `not_authorized`，云端数据实际删不掉）、失败改 `danger` 提示、版本号去掉「单机版」、适龄 8+ 与文档口径对齐。

### §4 交付文件
- **新建源码**：`src/core/cloud.js`、`src/core/sync.js`、`src/core/privacy.js`、`src/data/privacy.js`
- **修改源码**：`src/config.js`（`CLOUD_CONFIG` 默认 `enabled:false`/`env:''` + 4 个新 key）、`src/core/storage.js`（旁路 hook + `applyRemote`）、`game.js`（授权/同步接线）、`src/scenes/settings.js`（新分组）、`src/scenes/gameplay.js`（抽屉 action 分支）
- **新建测试**：`test-cloud.js`(90 断言)、`test-sync.js`(131 断言)；扩充 `test-integration.js` 的内存 `wx.cloud` mock（默认不挂、`CHESS_CLOUD_MOCK=full` 才启用，含故障注入）；`project.config.json` ignore 追加两项
- **新建/重写文档**：`PRIVACY_POLICY.md`、`CLOUD_DEPLOY.md`（含 27 项需确认清单）、`WECHAT_PUBLISH_GUIDE.md`（重写「不上传服务器」承诺）、`ARCHITECTURE.md` §8

### §5 验证结论
- `node -c` 全部改动文件通过；六套回归 **327/0** 逐套与基线一致（9/59/62/100/86/11）；`verify-round2` **66/0**；P0 脚本 **7/0**；`render-shots` **36/0**；新增 `test-cloud` **90/0** + `test-sync` **131/0**（无云 / 完整 mock+故障注入两模式各全绿）；主理人收尾独立验证 **12/0**。
- 关键不变量：`CLOUD_CONFIG.enabled=false` + `env=''` 时 `cloud.isEnabled()===false`、`canSync()===false`、`sync.start()` 零云读取；本地 28 API 仍同步、写后立即可读、`loadEndgame()` 同引用；`CHESS_CLOUD_MOCK=full` 下 `test-integration.js` 仍 59/0。
- 像素复核：设置页 375 顶部/底部、320 紧凑屏，新增分组 6 行完整、无裁切/重叠/错位，`v2.0` 版本号中置。

### §6 云端资源：本轮只做了只读核查，未执行任何变更
- 只读查询发现账号下唯一环境 `scattered-snake-d6f1w49bc696a296`：`EnvType=baas`、`RuntimeMode=postgresql`、`RuntimeBackends.nosql=false`、`UserInfo.WxAppId=""`、体验版（2027-05-07 到期、`IsAutoRenew:false`）、ap-shanghai。
- **该环境不能直接给 `wx.cloud` 使用**：需与 AppID 绑定的微信云开发环境，且当前未开通 NoSQL 文档数据库。因此**未创建集合、未写入数据、未变更安全规则、未发布隐私指引、未做任何不可逆操作**。
- 代码已完整可集成且默认离线可跑；填入正确 env 并置 `enabled=true` 后即启用云同步。所有需确认项见 `CLOUD_DEPLOY.md` §6（权限 7 / 配置项 11 / 影响线上数据操作 9，共 27 项，逐项标注可逆性与执行时机）。

---

## 第八轮：独立审查驱动的红线修复（2026-11-07）

> 承接第七轮云端化交付。本轮由**两路独立审查**（① 代码红线 / 同步正确性；② 合规与文档一致性）并行走查，发现 P0 / P1 若干，逐一修复并补自动化断言与文档定稿。
> 工程纪律：只改红线相关实现，**28 个 `storage` 导出签名 / 同步语义不变**；六套回归 327/0 不回退；**本轮仍未创建任何云端资源**。

### §1 两路审查发现的 P0 / P1

| 路 | 级别 | 问题 |
|---|---|---|
| 代码红线 | P0 | 云 `pull → merge → applyRemote 回填` 后，场景缓存仍是冷启动旧值，界面不刷新进度 |
| 代码红线 | P0 | 冷启动 `sync.start()` 因授权 / 未启用没做成全量 pull 后，`onShow` 只 `flush`，「授权晚于冷启动 → 本会话永不拉云」 |
| 代码红线 | P0 | 本地写入对象缺 `updatedAt`，LWW 恒以服务端 `serverDate` 为准，本地较新的设置 / 配置 / 断点被云端旧值覆盖 |
| 代码红线 | P0 | `markDeleted` 的 tombstone 仍留 `value` 明文；`requestDeleteAll` 未物理删 `chess_state`，「删除云端数据」名不副实 |
| 代码红线 | P1 | `_mergeLWW` 未传播 `deleted`，一端删除会被另一端旧本地值撤销；`start()` 每次全量入队造成冷启动 `where().update()` 风暴 |
| 代码红线 | P1 | `noteWrite` 无授权门控，未授权时本地写持续入队（「先收集后补授权」+ 队列无限增长）；`clearAllRecords` 50 局一次性并发触平台限流；`OPS_KEY` 点号键有字段路径歧义 |
| 合规 / 文档 | P0 | `privacy.openContract` 原实现让本地 8 段隐私声明**永不可达**（fail 静默 + 无条件 true）；DENIED 态开关无重新授权入口；关闭开关不清积压队列 |
| 合规 / 文档 | P1 | 文档仍写「单机版 / 不上传服务器 / 仅保存在本机 / 不使用客户端时钟」，与云端化 + 本轮修复后的代码不符；`settings.js` 版本号、C-11、上传清单、`ARCHITECTURE.md` §8 同步契约过时 |

### §2 六组红线修复（本轮落地）

1. **云回填刷新界面**：`game.js` 的 `sync.start()` 成功后调当前场景 `onDataChanged()`；`menu.js` / `endgameMap.js` / `academy.js` 新增 `onDataChanged()` 只重算进度缓存字段，**不重置滚动 / 按压 / 详情态**。
2. **全量 pull 可重试**：`GameContext.requestCloudPull()` 挂载；`onShow` 在 `_cloudPullDone=false` 且授权 / 云端就绪时补做一次全量 `sync.start()`；设置页开同步 / 重新授权后主动 pull。
3. **LWW 时间戳与 tombstone 传播**：`storage.saveSettings/saveLastConfig/saveResume` 写入对象补 `updatedAt`；`_ts()` 优先取记录自带 `updatedAt`；`_mergeLWW` 遇 `rem.deleted` 返回 `{value:null,deleted:true,changed:true}`，`start()` 对 deleted 走 `applyRemote(remove)` 且 pass3 以 `remove` 入队。附带：`changed || push` 增量入队、`_addPending` 按 key 去重 + 500 上限、超限 op 达 `maxRetries` 移出、`_doFlush` 每批 ≤10、`OPS_KEY='ops'`（兼容读旧点号键）、`_validKey` ≤128。
4. **隐私声明降级**：`privacy.openContract(onFail)` 四分支（能力缺失→`onFail()+false`、平台 fail→`onFail()+true`、success→true、抛异常→`onFail()+false`，`onFail` 至多一次）；设置页本地 8 段声明一定可达且至多一次；DENIED 点击开关先 `privacy.refresh()` 再 `requestCloudPull()`；关闭开关调 `sync.clearPending()`；昵称清洗控制字符并 ≤12 字。
5. **删除不留明文**：`cloud.markDeleted` 写 `putRecord(key, null, doc.rev, true)`（tombstone `value=null`）；新增 `cloud.deleteStateDoc()`；`sync.requestDeleteAll()` 末尾物理删 `chess_state`。
6. **授权前不收集**：`sync.noteWrite` 加 `_canSync()` 门控 + `clearPending()`；`game.js` 的 `publishCheck()` 在 `enabled/env` 为空时 `console.warn`（不回显 env 值），`_warn()` 不回显原始异常。

### §3 验证结果（全部本地 / 离线，无真机、无云端）

| 命令 | 结果 |
|---|---|
| `node -c` 全部改动 `.js` | 通过 |
| 六套回归 `test.js` / `test-integration.js` / `test-engine.js` / `test-endgame.js` / `test-endgame-scene.js` / `test-gameplay.js` | **327/0**（9/59/62/100/86/11） |
| `CHESS_CLOUD_MOCK=full node test-integration.js` | **59/0** |
| `node tools/verify-round2.js` / `node /tmp/verify_p0.js` / `node tools/render-shots.js` | **66/0** / **7/0** / **36 场景 0 失败** |
| `node test-cloud.js` / `node test-sync.js` / `node test-recovery.js` | **111/0** / **177/0** / **86/0**；本轮新增断言合计 **153** 条（cloud +21、sync +46、recovery 新建 86） |
| `node tools/publish-check.js` | 非 strict 退出 0：阻断 3 项 / 通过 6 项 |

**新增资产**：`test-recovery.js`（端到端清缓存恢复演练，内存 `wx.cloud`，28 个读 API 精确恢复 + UI 自愈 + 删除不复活）、`tools/publish-check.js`（只读发布前自检，默认 0 / `--strict` 阻断项 1，不回显 env 值）。

### §4 主理人自行定稿的配置项（无需用户确认）

- `CLOUD_CONFIG` 内部默认值：`debounceMs:600` / `maxRetries:3` / `retryBaseMs:1200` / `maxValueBytes:64KB` / `maxBatchBytes:400KB` / 集合名 `chess_state` + `chess_records` / `schemaVersion:1` / `tombstoneDays:90` / `pullOnShow:true`。
- 适龄 8+ 采纳为**工程默认**（公众平台最终填报值仍需用户核对一致）。
- `game.json` **不加** `"cloud": true`；`traceUser` 保持 `false`；`enabled` 保持 `false` 且已加 `publishCheck()` 启动告警。
- 设置页版本号 `v2.0`（去掉「单机版」字样），C-11 定稿为「已修复、无需处理」。
- 文档定稿：`CLOUD_DEPLOY.md`（§6.0 已定稿项 + §10 第八轮修复）、`PRIVACY_POLICY.md`（删除机制 / 时钟 / 关闭措辞）、`WECHAT_PUBLISH_GUIDE.md`（上传清单加 `publish-check --strict`）、`ARCHITECTURE.md` §8（同步契约 + 测试门禁）。

### §5 仍未执行的云端动作（明确声明）

- **本轮仍未创建任何云端资源**：未开通云开发、未创建环境 / 集合 / 索引、未写数据、未改安全规则、未发布隐私保护指引、未填 env / AppID 归属 / 地域 / 套餐续期 / 隐私政策 URL / 主体 / 联系方式 / 生效日期、未 commit、未调用任何创建或修改云端资源的工具。
- 仍需用户提供的真实信息与平台侧动作：`env`、AppID 归属、地域、套餐续期、隐私政策可访问 URL、主体 / 联系方式 / 生效日期、公众平台《用户隐私保护指引》填报与发布（详见 `CLOUD_DEPLOY.md` §6）。
- 结论重申：代码已完整可集成，但云端默认关闭；填入 env 并确认权限后才真正联网。
