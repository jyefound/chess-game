# 墨金棋院 · 国际象棋（chess-game）

> 一款主打「悦己」体验的**微信小游戏**，单机国际象棋。墨金极简界面，纯净无广告，内置 AI 指导、实时提示与经典残局闯关。

「安静地，把一件爱好做到好用。」—— 这是整个产品的视觉与体验最高准绳。

---

## ✨ 特性

- **悦己体验**：墨金极简界面（冷墨底 + 单一黄铜暖强调 + 器物感棋盘），广告植入极度克制，绝不打断体验。
- **AI 智能指导与实时提示**：分帧 alpha-beta 搜索，UI 不卡顿；残局提示优先最短强制杀求解，超时回落评分搜索。
- **100 阵经典残局闯关**：从基础杀法到精妙终局，含妙招图鉴、星级评定与 7 种随身技能系统。
- **多棋类可扩展架构**：国际象棋全量接入；中国象棋 / 五子棋 / 围棋已预留引擎适配器与皮肤占位，按 `GameEngine` 契约即可扩展。
- **本地优先 + 可选云端同步**：云端 KV 镜像默认关闭，需授权并开同步才联网；拒绝授权即纯本地模式，玩法不受影响。
- **自适应与克制**：多视口自适应布局、音效克制、状态颜色+形状双重编码、`reduceMotion` 降级开关真实生效。

## 🧰 技术栈

- **微信小游戏原生** / Canvas 2D 渲染
- **纯 JavaScript（CommonJS）**，无构建链、无 npm、无 DOM/CSS/SVG
- 品牌视觉系统「墨金棋院」：冷墨 `#10151B` / 黄铜 `#C9A24B` / 象牙 `#EDE6D6` / 青玉 `#4C625D`
- 隐私授权接入（`wx.requirePrivacyAuthorize`），符合微信提审要求

## 📁 目录结构

```
chess-game/
├── game.js / game.json          # 小游戏入口与全局配置（竖屏、超时）
├── project.config.json          # 微信开发者工具项目配置
├── src/
│   ├── core/                    # 核心：规则引擎、AI 搜索、存储、云端同步、隐私
│   ├── engine/                  # 多棋类抽象层（registry / 适配器 / search）
│   │   ├── chess/               #   国际象棋适配器（已实现，范式参考）
│   │   └── xiangqi|gomoku|go/   #   中国象棋/五子棋/围棋占位
│   ├── scenes/                  # 场景栈：menu/setup/gameplay/teaching/academy/endgame…
│   ├── render/                  # 棋盘 / 棋子 / 自适应布局渲染
│   ├── data/                    # 残局库（100 阵）/ 妙招 / 技能数据
│   ├── assets/                  # 音频（22 个 wav）/ 图标
│   ├── config.js                # 品牌常量层 + 功能语义层 + 单棋种特色层
│   └── context.js               # 全局 GameContext（导航/事件/布局）
├── tools/                       # 图标生成、发布自检、渲染回归等脚本
├── test*.js                     # Node 回归测试（六套 + 云端）
└── BRAND.md / ARCHITECTURE.md   # 品牌视觉系统 / 多棋类架构说明
```

> 仓库内的 `*.md`（BRAND / 规格 / 审计文档）与 `tools/`、`test*.js`、`review-shots/` 均已被 `packOptions.ignore` 排除出代码包，不影响小游戏运行。

## 🚀 本地运行

1. 用 **微信开发者工具** 打开本仓库根目录（识别 `project.config.json`）。
2. 编译目标选「小游戏」，即可在模拟器运行，**无需任何依赖安装**。
3. iOS / Android 真机预览请通过开发者工具「真机调试」。

## 🧪 测试（回归门禁）

| 命令 | 覆盖 |
|---|---|
| `node test.js` / `test-integration.js` / `test-engine.js` / `test-endgame.js` / `test-endgame-scene.js` / `test-gameplay.js` | 规则 / 场景 / 引擎契约 / 残局数值 / 玩法（六套 **327/0**） |
| `node test-cloud.js` / `test-sync.js` / `test-recovery.js` | 云端能力探测 / 同步合并 / 端到端清缓存恢复（**374** 断言） |
| `node tools/publish-check.js` | 发布前只读自检（配置 / 集合名 / 禁用 API 等） |

所有测试在 Node 环境纯函数执行，无需微信运行时。

## 📦 打包与上架

- 微信开发者工具「上传」即出代码包；主包约 **0.97MB**（远低于 4MB 上限），无需分包 / CDN。
- 隐私授权已在 `game.js` 启动流程接入；上架材料、资质结论与时间线见 **`WECHAT_PUBLISH_GUIDE.md`**。
- 隐私政策可托管版见 **`PRIVACY_POLICY.md`**；云端部署与权限清单见 **`CLOUD_DEPLOY.md`**。

## 🎨 品牌与合规

- 品牌视觉系统（权威约束）：**`BRAND.md`**
- 多棋类扩展架构（接入说明）：**`ARCHITECTURE.md`**
- 命名禁用「大师 / 王者 / 争霸」等竞技压迫词；音效、动效、红点、广告均有硬上限（见 BRAND §6「克制原则」）。

## 📄 许可证

见仓库根目录 **`LICENSE`**。

---

*墨金棋院 · 国际象棋 —— 落子之间，与自己从容对谈。*
