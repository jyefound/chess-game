# CLOUD_DEPLOY.md — 云端化部署指南与「需确认清单」

> **文档定位**：本文件是云端化升级的部署 / 审核交付材料，不进入小游戏代码包（`project.config.json` 的 `packOptions.ignore` 已排除 `*.md`）。
> **本轮结论**：**云端链路已接线并默认开启**（`CLOUD_CONFIG.enabled:true`，`env:freedom-land-d4gv0gs78c0dd7b2f`，环境名 `freedom-land`，绑定 AppID `wx5a78cb07bad9cf59`）。真机 / 体验版首次启动在用户授权后自动 `pull → merge → push`；**集合 / 安全规则 / 隐私指引未建时整条云链路静默降级本地，玩法与成绩不受影响**（详见 §6.0 已提供项）。`WECHAT_PUBLISH_GUIDE.md` / `ARCHITECTURE.md` / 本文件其余章节仍按「发布前需建集合 + 安全规则 + 发布隐私指引」的完整流程执行。
> **本轮红线**：**未创建任何云端资源、未写入任何数据、未变更任何配置或安全规则、未发布任何指引、未 commit、未调用任何创建或修改云端资源的工具。**
> 配套文档：`PRIVACY_POLICY.md`（可托管隐私政策）、`WECHAT_PUBLISH_GUIDE.md`（上架材料）、`ARCHITECTURE.md`（技术架构）。

---

## 0. 本轮结论速览

| 项目 | 结论 |
|---|---|
| 代码状态 | 云端链路（config / cloud / sync / privacy / storage hook / 设置页 UI / game.js 接线）已完整实现并可集成；第八轮红线修复后回归 `test-cloud.js` 111/0、`test-sync.js` 177/0、端到端 `test-recovery.js` 86/0，另有只读自检 `tools/publish-check.js` |
| 云端状态 | **已开启待建资源**：`CLOUD_CONFIG.enabled:true`、`env:freedom-land-d4gv0gs78c0dd7b2f`；需建集合 + 安全规则 + 发布隐私指引后真机才真正持久化（缺资源时静默降级本地） |
| 现有云环境 | 账号下仅 1 个腾讯云通用 baas / PostgreSQL 体验版环境，**不能直接给 `wx.cloud` 使用**（详见 §1） |
| 本轮云端动作 | **零 —— 本轮未执行任何云端变更**（只读查询了 1 个现有环境；未创建集合、未写数据、未改规则、未发布指引） |
| 待用户确认 | **共 27 项**：权限 7 项、配置项 11 项、可能影响线上数据的操作 9 项（详见 §6） |
| 下一步 | 用户逐项确认 → 按 §3 前置条件、§4 操作清单执行 → 按 §4.5 验收 |

---

## 1. 环境核查结论（只读查询，2026-11-07）—— 本轮最重要的「需确认」依据

**只读查询**了你腾讯云账号下的 CloudBase 环境，结果如下（**未做任何变更**）：

| 字段 | 值 |
|---|---|
| 环境数量 | **唯一 1 个** |
| `EnvId` | `scattered-snake-d6f1w49bc696a296` |
| `Alias` | `scattered-snake` |
| `Region` | `ap-shanghai` |
| `EnvType` | `baas` |
| `PackageName` | 体验版（`baas_trial`） |
| `Status` | `NORMAL` |
| 创建时间 | 2026-11-07 |
| `ExpireTime` | **2027-05-07** |
| `IsAutoRenew` | **false**（未开启自动续费） |
| `RuntimeMode` | `postgresql` |
| `RuntimeBackends` | `{ postgresql: true, nosql: false, mysql: false }` |
| `Databases` | `[]`（空） |
| `UserInfo.WxAppId` | **`""`（空）** |
| `EnvChannel` | `qc_console` |
| `Source` | `qcloud` |

### 结论：该环境不能直接给微信小游戏 `wx.cloud` 使用

- `wx.cloud.init({ env })` 需要的是**与 AppID 绑定的微信云开发环境**（通过腾讯云控制台 / 微信开发者工具开通的「微信云开发」），而当前环境是**腾讯云侧的通用 baas / PostgreSQL 环境**；
- `UserInfo.WxAppId` 为空，**未绑定微信 AppID**；
- `RuntimeBackends.nosql = false`、`Databases = []`，**未开通 NoSQL 文档数据库**，而本方案依赖 `wx.cloud.database()` 的文档集合与安全规则。

因此：**本轮没有创建任何集合、没有写入任何数据、没有变更安全规则**。请勿把 `scattered-snake-d6f1w49bc696a296` 直接填入 `CLOUD_CONFIG.env`。

### AppID 归属待核实

`project.config.json` 的 `appid` 字段为 `wx893c72a58e544bb3`（需求单记为 `:44`，实际文件中位于 `:46`，**行号以文件为准**）。该 AppID 与上述腾讯云账号 / 待开通的微信云开发环境的**绑定关系尚未核实**，属于 §6.2 的确认项；未核实前不得开通或绑定环境。

> 体验版到期（2027-05-07）且 `IsAutoRenew:false` 是后续「进度不丢失」承诺的主要风险来源，见 §5、§8。

---

## 2. 架构图（文本版）与授权门控位置

```
┌ 场景层  src/scenes/*（settings.js「账号与隐私」分组；对局内设置抽屉复用同一入口）
│    只调用 storage 的 28 个同步 API；不直接碰云、不感知云失败
│
├ 存储层  src/core/storage.js  ★唯一读写源★（wx.*StorageSync；无 wx 时回退内存 Map）
│    ├ addWriteHook(noteWrite)   本地写成功后仅登记 {opId,key,op,ts} 到 pendingQueue
│    └ applyRemote(k,op,v)       pull 回填时抑制 hook，防止「回填→再入队」回环
│
├ 同步层  src/core/sync.js       纯函数 mergeKey + start/flush/noteWrite/status/requestDeleteAll
│    └ ★授权门控 privacy.canSync()★  ← 唯一闸门：state=granted ∧ 用户开关 ∧ cloud.isEnabled()
│                                      缺一即零云调用（不 pull / 不 push / 不 init 追踪）
├ 隐私层  src/core/privacy.js    unknown → need → granted / denied
│                                 官方 wx.getPrivacySetting / wx.requirePrivacyAuthorize / wx.openPrivacyContract
├ 云层    src/core/cloud.js      wx.cloud.init({env, traceUser:false}) → wx.cloud.database()
│                                 值消毒 / key 白名单 / 字节上限 / db.serverDate() / 禁用 doc().set()
├ 配置层  src/config.js          CLOUD_CONFIG（enabled:false / env:'' / collections / schemaVersion /
│                                 debounce / retries / 字节上限 / tombstoneDays:90）
└ 云端（微信云开发 · 腾讯云境内 · 微信私有通道，零云函数 / 零 npm / 零 wx.request）
     ├ chess_state    每用户 1 文档：{_openid, rev, updatedAt, schemaVersion, keys:{...}}
     │                  keys.ops = 已处理 opId（键名不含点号，上限 500，兼容读旧点号键）；doc 级 rev CAS
     └ chess_records  每「本地 storage key」1 文档：{_openid, key, value, rev, updatedAt,
                        deleted, schemaVersion}；key 保留本地前缀 chess.record.v1.<gameId>；per-key rev CAS
      两集合安全规则均在服务端强制：doc._openid == auth.openid
```

**启动接线**（`game.js`）：`switchTo('menu')` 先渲染本地 → `privacy.init()` 异步决议（不 await、不阻塞）→ `.then` 内 `sync.init()` + `sync.start()`；`sync.start()` 成功后调当前场景 `onDataChanged()` 刷新进度缓存；`GameContext.requestCloudPull()` 已挂载，供设置页开同步 / 重新授权后主动 pull。`onShow` 在 `_cloudPullDone=false` 且授权、云端就绪时**补做一次全量 `sync.start()`（pull→merge→回填→push）**，否则仅 `privacy.refresh()` + `sync.flush()`；发布安全自检 `publishCheck()` 在 `enabled/env` 为空时 `console.warn`（不回显 env 值）。绝不「先同步、后补授权」。

**门控位置说明**：授权门控位于「存储层写 hook → 同步层」之间及 `sync.start()/flush()` 入口；未授权或云端未配置时，`noteWrite` 不入队、不调度，`start/flush` 直接返回 `{ok:false, reason:'not_authorized'|'disabled'}`，**零云调用**。

---

## 3. 前置条件（按顺序，全部属于「需确认后执行」）

| # | 前置条件 | 说明 / 输出 |
|---|---|---|
| 1 | **开通微信云开发 / CloudBase** | 在微信开发者工具或腾讯云控制台开通「微信云开发」，得到**与 AppID 绑定**的环境；不要用 §1 的 baas/PG 环境 |
| 2 | **确认 AppID 与腾讯云账号的绑定关系** | 核实 `wx893c72a58e544bb3` 归属；环境必须绑定该 AppID |
| 3 | **确定地域并创建 / 选用环境，拿到 env ID** | 地域**不可逆**，须与隐私指引「存储地区」、备案信息一致 |
| 4 | **填入 `src/config.js` 的 `CLOUD_CONFIG`** | 置 `env = '<env ID>'`、`enabled = true`；其余字段保持默认（见 §4.4） |
| 5 | **创建两个集合** | `chess_state`、`chess_records`（见 §4.1） |
| 6 | **配置集合安全规则** | 两集合均设为「仅创建者可读写」的完整 JSON（见 §4.2） |
| 7 | **创建索引** | 见 §4.3 建议（非必须，但 CAS / 分页强烈建议） |
| 8 | **发布《用户隐私保护指引》** | 微信公众平台填写并**发布**；官方隐私授权弹窗依赖它才真实生效；新增 / 修改收集类型会触发旧用户重新授权 |
| 9 | **填适龄分级、联系方式、隐私政策 URL** | 托管 `PRIVACY_POLICY.md` 为可访问 URL；填实政策中所有【待填】项；值见 §6.2，**本轮未编造任何具体值** |
| 10 | **小程序备案（工信部备案）** | 2024 起强制；存储地区 / 主体信息须与云开发环境一致 |
| 11 | **软著 / 备案 / 提审信息** | 见 `WECHAT_PUBLISH_GUIDE.md` |

> 仍无 `wx.request`、仍无 `wx.login`、仍无内购 / 支付 → **主体（微信个人号免费发布）与「无需版号」结论不变**。云端化不引入自建后端、不新增服务器域名白名单（`wx.cloud` 走微信私有通道，无需 request 合法域名 / 备案域名 / TLS 证书 / `code2session`）。

---

## 4. 可直接复制的操作清单

### 4.1 集合名

| 集合 | 用途 | 文档粒度 |
|---|---|---|
| `chess_state` | 同步元数据（doc 级 `rev` CAS）+ `keys.ops` 已处理 `opId`（不含点号，兼容读旧点号键） | **每用户 1 文档** |
| `chess_records` | 本地游戏数据的 KV 镜像 + tombstone | **每「本地 storage key」1 文档**；`key` 保留本地前缀，如 `chess.record.v1.<gameId>` |

集合数上限 100，本方案仅用 2 个。

### 4.2 安全规则（完整 JSON，两个集合各粘贴一份）

在「云开发控制台 → 数据库 → 集合 → 权限设置 → 自定义安全规则」粘贴。`chess_state`：

```json
{
  "read": "doc._openid == auth.openid",
  "write": "doc._openid == auth.openid"
}
```

`chess_records`：

```json
{
  "read": "doc._openid == auth.openid",
  "write": "doc._openid == auth.openid"
}
```

汇总视图（便于核对）：

```json
{
  "chess_state":   { "read": "doc._openid == auth.openid", "write": "doc._openid == auth.openid" },
  "chess_records": { "read": "doc._openid == auth.openid", "write": "doc._openid == auth.openid" }
}
```

**必须同时遵守的代码侧约定**（已在 `src/core/cloud.js` 实现，部署时勿改）：

- 所有查询 `where` 必带 `_openid: '{openid}'`；`_openid` 由平台自动注入、客户端不可伪造，隔离在服务端强制生效。
- **禁用 `doc().set()`**（在该安全规则下会失败）；创建走 `collection.add()`，更新一律 `where({_openid, key, rev}).update()`。
- 写入值消毒：丢弃客户端传入的 `_openid` / `_id` / `$` 前缀键，拒绝云指令对象、非普通对象、`NaN` / `Infinity`、过深嵌套；`key` 白名单 `^chess\.[a-z.]+\.v1(\.[A-Za-z0-9_-]+)?$`。
- 写入时间戳用服务端 `db.serverDate()`；LWW 合并判定**综合「记录自带 `updatedAt`（storage 写入时落 `Date.now()`）」与「服务端 `db.serverDate()`」**（优先记录自带字段，缺失才回落服务端 entry 时间），不再单纯依赖服务端时钟导致本地新值被云端旧值覆盖。

### 4.3 索引建议

| 集合 | 建议索引 | 服务的查询 |
|---|---|---|
| `chess_records` | `_openid` + `key`（复合） | `putRecord` 的 CAS：`where({_openid, key, rev}).update()` |
| `chess_records` | `_openid` + `updatedAt`（复合） | 按时间排序 / 50 局裁剪 / 分页辅助 |
| `chess_records` | `_openid` | `listRecords` 分页：`where({_openid}).skip(n).limit(20).get()` |
| `chess_state` | `_openid` | `where({_openid}).limit(1).get()` 与 `where({_openid, rev}).update()` |

### 4.4 `wx.cloud.init` 初始化片段（**仅供核对，勿重复添加**）

以下代码**已在 `src/core/cloud.js` 的 `init()` 内实现**，部署者不需要在游戏里再写一遍，只需填 `CLOUD_CONFIG`：

```js
// src/core/cloud.js（已实现，节选）
wx.cloud.init({
  env: '<填入 CLOUD_CONFIG.env 的 env ID>',
  traceUser: false          // 默认关闭，是否允许开启见 §6.1
});
const db = wx.cloud.database();
```

`src/config.js` 中需要修改的**仅两处**（本轮保持默认值，未改动）：

```js
const CLOUD_CONFIG = {
  enabled: true,                          // ✅ 已置 true（2026-11-07 用户直供 env）
  env: 'freedom-land-d4gv0gs78c0dd7b2f',  // ✅ 已填入（环境名 freedom-land）
  collections: { state: 'chess_state', records: 'chess_records' },
  schemaVersion: 1,
  debounceMs: 600,
  maxRetries: 3,
  retryBaseMs: 1200,
  maxValueBytes: 64 * 1024,
  maxBatchBytes: 400 * 1024,   // < 前端 512KB 上限
  tombstoneDays: 90,
  pullOnShow: true
};
```

> `game.json` 本轮**不加** `"cloud": true`（是否启用见 §6.2）。`traceUser` 保持 `false`。

### 4.5 验收自查步骤

| # | 场景 | 操作 | 期望结果 |
|---|---|---|---|
| 1 | 默认关闭 | `enabled:false` / `env:''` 下冷启动 | 六套回归 `327/0` 全绿；云开发控制台无该 openid 的读写、**无文档创建**；设置页显示云同步关闭状态（「关闭后本次不再上传；云端已有副本可删除」）；`publishCheck()` 启动告警 |
| 2 | 换设备 / 清缓存恢复 | A 设备授权 + 开同步 → 玩到第 4 阵、存若干棋谱 → B 设备（或清缓存后）用同一微信账号进入 | 冷启动 `pull → 逐 key merge → applyRemote 回填 → push`；进度 / 棋谱 / 设置恢复；**不会用本地空数据覆盖云端** |
| 3 | 多端冲突合并 | 两设备离线各改不同字段（一端解锁关卡、一端收集妙招 / 存棋谱），先后上线 | 单调字段 max / min(>0) / OR / 并集生效；`index.ids` 并集重排、满 50 裁剪；增减型字段按局部 LWW；`rev` CAS 冲突自动重拉合并重试（≤3 次） |
| 4 | **拒绝授权零云调用** | 在官方隐私弹窗点「拒绝」 | 状态 `denied`；设置页显示「已拒绝授权 · 仅本地模式，可重新开启」；**零云调用**（不 pull / 不 push / 不 init 追踪）；玩法与成绩完全不受影响；可在设置页重新授权 |
| 5 | 云失败静默降级 | 断网 / 环境不可用 / 权限被拒 | 本地 28 个 API 的 `ok` / `reason` / 业务返回值**一字不变**；无报错弹窗、不阻塞主循环；失败操作留在 `pendingQueue`，下次 `onShow` / 写操作 / 冷启动重试 |
| 6 | 50 局分页 | 造 >20 条 `chess_records` 文档 | `listRecords()` 自动 `skip + limit(20)` 翻页取全（50 局 + 8 个固定键 ≈ 3 页），不丢记录 |
| 7 | 删除云端数据 | 设置 → 账号与隐私 → 删除云端数据 → 二次确认 | 云端全量 tombstone（`value` 清空为 `null`，不留明文）+ 物理删 `chess_state` 同步元数据、撤回授权、同步停止；**本地棋谱与设置保留**；单用户不可逆 |
| 8 | 真机 | iOS + Android 各一款走完整流程 | 无卡顿 / 无授权弹窗异常 / 无 `wx.request` 域名报错 |

---

## 5. 配额与限制

| 平台限制（部署前基线） | 影响 | 工程对策 | 配置位置 |
|---|---|---|---|
| 前端 `get` **20 条/次** | 一次取不全 50 局棋谱 | `listRecords()` 用 `skip + limit(20)` 自动分页 | `src/core/cloud.js` `PAGE = 20` |
| 单次 / 单文档写入 **≤512KB** | 大棋谱写失败 | `maxValueBytes = 64KB`（单 key）、`maxBatchBytes = 400KB`（整批 <512KB）；超限直接拒绝 | `src/config.js` |
| **QPS 30** | 高频写触发限流 | `debounceMs = 600` 合流；`flush` 用 `_flushPromise` 串行化且每批并发 ≤10；`pullOnShow` 默认仅 flush，冷启动全量 pull 未完成时首次 `onShow` 补做一次（可重试，不重复） | `src/config.js` / `src/core/sync.js` |
| 日读 **5 万** / 日写 **3 万** | 全量轮询会耗尽 | 只镜像 8 类小 key + 增量 `pendingQueue`；不做服务端批量作业 | `src/core/sync.js` |
| 集合数 **100** | — | 仅 2 个集合 | `src/config.js` |
| 本地棋谱上限 **50 局** | 多端并集后超限 | `index.ids` 并集重排、满 50 裁剪最早局并为被裁局生成 tombstone | `src/core/sync.js` |
| 体验版 `baas_trial` **2027-05-07 到期**、`IsAutoRenew:false` | 到期 / 配额耗尽 → 云同步不可用 | **需在到期前续费 / 升配**；本地始终可用，但「换设备 / 清缓存恢复」承诺失效 | 见 §1、§6.2、§8 |

> 配额数值为部署前基线，可能随平台政策调整，**上线前请在云开发控制台复核**（列入 §6.2 套餐确认项）。「进度不丢失」承诺依赖：套餐有效 ∧ 配额充足 ∧ 安全规则未被误改 ∧ 用户未主动删除云端数据。

**其他已知限制**：`tombstoneDays: 90` 已配置，但**本版本未启用 tombstone GC**，墓碑记录不会自动物理清理；物理删除发生在「用户主动删除（`requestDeleteAll()` 末尾物理删 `chess_state` 同步元数据、`deleteRecordDoc()` 物理删单条）/ 未来启用 GC」。墓碑本身只保留 `deleted:true` + `value:null`，**不含任何游戏明文**。见 `ARCHITECTURE.md`「已知取舍」。

---

## 6. 需用户确认清单（核心交付物）

> **共 27 项**：权限 **7** 项（§6.1）、配置项 **11** 项（§6.2）、可能影响线上数据的操作 **9** 项（§6.3）。
> 同一动作可能同时出现在「权限」与「可能影响线上数据的操作」中：前者问「是否允许做」，后者问「做了会动到什么数据」。
> **未确认前一律不得执行**；本轮已全部保持「未执行」。

### 6.0 本轮已定稿项（主理人自行定稿，无需用户确认 · 第八轮 2026-11-07）

以下为工程内部默认值 / 展示文案，属主理人可自行定稿范围，本轮**已定稿**，不再列入「待用户确认」：

| 定稿项 | 定稿值 | 对应确认项 |
|---|---|---|
| `CLOUD_CONFIG` 内部默认值 | `debounceMs:600` / `maxRetries:3` / `retryBaseMs:1200` / `maxValueBytes:64KB` / `maxBatchBytes:400KB` / `collections:{chess_state,chess_records}` / `schemaVersion:1` / `tombstoneDays:90` / `pullOnShow:true`（见 §4.4） | §4.4、C-05 |
| 适龄分级（工程默认） | `适龄提示：8+（建议 8 周岁以上）` 采纳为工程默认；**最终填报值仍须与公众平台一致并由你核对** | C-07 |
| `game.json "cloud": true` | **不加**（云能力由 JS 侧 `wx.cloud.init` 驱动） | C-10 |
| `traceUser` | 保持 `false`（不产生新增日志类数据） | P-06 |
| `CLOUD_CONFIG.enabled` / 启动告警 | 保持 `enabled:false`；`game.js` 已加 `publishCheck()` 启动告警（`enabled/env` 为空时 `console.warn`，**不回显 env 值**） | C-01（仅开关态） |
| 设置页版本号 | `v2.0`（已去「单机版」字样，`src/scenes/settings.js`） | C-11 |

> **本批次已提供（2026-11-07，用户直供）**：
> - **C-01** `CLOUD_CONFIG.env` = `freedom-land-d4gv0gs78c0dd7b2f`（环境名 `freedom-land`）；已写入 `src/config.js` 并将 `enabled` 置 `true`，`--strict` 对应两项已通过。
> - **C-02** AppID = `wx5a78cb07bad9cf59`，与 `project.config.json` 现有 `appid` 一致，且即为此云环境的绑定 AppID（`_openid` 体系 / 官方授权弹窗可用）。**无 AppID 归属冲突，未改动 `project.config.json`。**
> - 腾讯云主账户 ID `100054792884` 已记录（仅供你核对账号归属，代码未引用）。
>
> **仍需用户提供真实信息 / 平台侧确认的项（尚未执行）**：地域(C-03)、套餐续期(C-04)、隐私政策可访问 URL(C-06)、主体 / 联系方式 / 生效日期(C-08)、公众平台《用户隐私保护指引》填报与发布(C-09 / O-06)，以及 §6.1 权限项与 §6.3 云端操作项（**创建集合 / 安全规则 / 隐私指引发布等结构性云端动作仍待你明确授权**；本批次未创建任何云端资源）。

### 6.1 权限（7 项）

| 编号 | 事项 | 为什么需要 | 可逆性 | 是否影响线上数据 | 未确认前是否可执行 | 建议执行时机 |
|---|---|---|---|---|---|---|
| P-01 | 开通微信云开发 / CloudBase 能力 | `wx.cloud.init` 依赖与 AppID 绑定的微信云开发环境；§1 现有 baas/PG 环境不可用 | 可逆（能力可停用，已有环境清理需另评估） | 否（能力开通本身不产生用户数据） | **否** | 首发版本发布前 |
| P-02 | 创建 / 选用云开发环境（拿到 env ID） | `CLOUD_CONFIG.env` 需要真实 env ID；地域在创建时确定 | 新建可逆；**删除环境不可逆** | 否（新建为空） | **否** | 首发前，与 P-01 同批 |
| P-03 | 创建集合 `chess_state` / `chess_records` | 两集合是云端持久化载体 | 创建可逆（空集合可删）；**删除集合不可逆** | 否（新增、不影响存量；当前无线上数据） | **否** | 首发前，环境就绪后 |
| P-04 | 设定 / 变更集合安全规则 | 服务端强制 `_openid` 隔离，是数据安全的根 | 可改回，但**变更期间全量用户读写行为改变**；上线后须灰度 + 回滚预案 | **是（影响全量用户读写：过松→越权可读，过紧→全员写失败）** | **否** | 首发前一次性设定；上线后仅灰度 |
| P-05 | 是否允许部署云函数 | 确认技术边界；**本方案不需要（零云函数、零 npm、零 `wx.request`）** | 不适用 | 否 | **否**（建议明确答复「不部署」） | 首发前一次性确认，默认「否」 |
| P-06 | `traceUser`（`wx.cloud.init` 参数，默认关闭） | 开启会把用户访问记录写入云开发日志，属于新增的用户行为记录，需隐私指引覆盖 | 可改回配置 | 否（但产生新的日志类数据，属合规项） | **已定稿（本轮）**：保持 `false` | 已定稿，无需执行 |
| P-07 | **是否授权我们代为执行上述云端操作** | 所有结构性与权限性云端操作均需账号所有者授权；本轮明确**未代执行** | 授权可撤回 | 间接（是其余所有项的前置） | **否**（此项未确认前，其余项一律不动） | **最先确认**（其余 26 项的前置） |

### 6.2 配置项（11 项）

| 编号 | 事项 | 为什么需要 | 可逆性 | 是否影响线上数据 | 未确认前是否可执行 | 建议执行时机 |
|---|---|---|---|---|---|---|
| C-01 | `CLOUD_CONFIG.env`（env ID） | 决定 `wx.cloud.init` 连到哪个环境 | 可改配置（改后需重新提审 / 冷启动生效） | 间接（填错 → 全员写失败或写到错误环境） | **否**（保持 `''`） | 首发前，与 P-01/P-02 同批 |
| C-02 | AppID 与腾讯云账号绑定关系（`wx893c72a58e544bb3` 归属） | 云开发环境必须绑定 AppID；`_openid` 体系与授权弹窗依赖它 | 绑定关系变更需平台侧操作，**可能不可逆** | **是（绑错 → 授权弹窗失效、`_openid` 隔离失效）** | **否** | **最先确认** |
| C-03 | **地域（region，不可逆）** | 隐私政策「存储地区」、备案、《用户隐私保护指引》须与之一致 | **不可逆**（环境创建后不可更改） | **是（数据存放地，合规硬约束）** | **否** | 创建环境时**一次性决定** |
| C-04 | 套餐 / 配额与续期 | 体验版 `baas_trial` 到期 2027-05-07、`IsAutoRenew:false`；到期或配额耗尽 → 云同步不可用 | 升配可逆、降配可能受限；**到期未续 → 服务中断，可续费恢复，但环境若被释放则不可逆** | **间接（可用性；极端情况影响数据保留）** | **否** | 首发前定套餐；到期前续费 / 升配 |
| C-05 | 集合名与 `schemaVersion`（`chess_state` / `chess_records` / `1`），及 `CLOUD_CONFIG` 内部默认值 | 代码与云端强约定；改名需同步改代码 | 改名 = 改代码 + 重建集合，**对已有数据视为不可逆** | **是（`schemaVersion` 变更涉及全量文档兼容）** | **已定稿（本轮）**：保持现值（见 §6.0） | 已定稿，上线后不轻改 |
| C-06 | 隐私政策可访问 URL | 公众平台《用户隐私保护指引》必填；设置页「隐私声明」优先打开官方指引 | 可改（改后需重新发布指引） | 否（影响审核与入口可达性） | **否**（保持待填） | 首发前提审前 |
| C-07 | 适龄分级 | 公众平台必填、未成年人保护合规；**工程内 `src/data/privacy.js` 已内置 `适龄提示：8+（建议 8 周岁以上）`**（依据：纯棋类、无内购、无社交、无暴力内容）。工程默认已定稿为 8+；**最终填报值仍须你与公众平台核对一致**，若不同需同步修改该常量、`PRIVACY_POLICY.md` 与设置页提示 | 可改（需重新提审 / 审核） | 否（合规项） | **工程默认已定稿（本轮，8+）**；公众平台填报值仍需你核实 | 首发前提审前核对填报值 |
| C-08 | 客服 / 举报联系方式 | `PRIVACY_POLICY.md` 与 `src/data/privacy.js` 均为占位 | 可改（改后需同步更新政策文本与发布指引） | 否 | **否**（保持占位，**不编造具体值**） | 上线前填实 |
| C-09 | 隐私指引中的**存储期限 / 通知方式 / 存储地区 / 第三方 SDK 文本** | 公众平台指引需逐项填写，且必须与 `PRIVACY_POLICY.md` 一致 | 可改，**但「修改并发布指引」会影响审核并触发旧用户重新授权**（见 O-06） | 否（数据本身），但影响审核与授权态 | **否** | 首发前提审前，与政策文本一并定稿 |
| C-10 | `game.json "cloud": true` 是否启用 | 部分云能力声明项；本轮**默认不加**，云能力由 JS 侧 `wx.cloud.init` 驱动 | 可加（需重新提审） | 否 | **已定稿（本轮）**：保持不加 | 已定稿，真机复核即可 |
| C-11 | 设置页版本号「单机版」文案 | **已修复，无需处理**：`src/scenes/settings.js:709` 现为 `v2.0`，已不含「单机版」字样，与「本地 + 云端双份存储」一致 | 可逆（纯展示） | 否 | **已定稿（本轮）** | 无需执行 |

### 6.3 可能影响线上数据的操作（9 项）

| 编号 | 事项 | 为什么需要 | 可逆性 | 是否影响线上数据 | 未确认前是否可执行 | 建议执行时机 |
|---|---|---|---|---|---|---|
| O-01 | 创建集合 | 建立云端 KV 镜像载体 | 可逆（空集合可删）；**删除集合不可逆** | **否（新增、不影响存量）** | **否** | 首发前（此时线上数据为空，试错成本最低） |
| O-02 | 写入 / 覆盖用户文档 | 同步链路 `putRecord` / `putStateDoc` 的正常写入 | **部分可逆**：`rev` CAS + 字段级合并保证不丢单调进展；单文档可被后续写覆盖，**无法无损回滚到任意历史版本** | **是（单用户文档内容）** | **否** | 仅在用户授权 ∧ 开启同步 ∧ 云端可用后，由客户端自动发生 |
| O-03 | 批量迁移本地数据上云 | 让旧用户进度不丢失；**本设计为「每用户首次启动客户端 `pull → merge → push」，非服务端批量作业** | 无服务端作业、不产生全量一次性覆盖；单用户可撤回 / 删除云端数据 | **是（但按用户各自触发、各自一份，非全量同时写入）** | **否**（且本方案**不含**服务端批量作业，勿额外添加） | 随版本发布，按用户自然触发 |
| O-04 | 变更安全规则 | 隔离策略调整 | 可改回，**必须灰度 + 回滚预案** | **是（影响全量用户读写）** | **否** | 首发前一次性设定；上线后仅灰度 |
| O-05 | 删除 / 重建集合 | 结构重建 | **不可逆** | **是（全量用户数据丢失）** | **严禁** | 原则上永不；仅首发前空集合可重建 |
| O-06 | 修改并发布《用户隐私保护指引》 | 合规文本更新 | 可再改再发，**但每次发布会影响审核并触发旧用户重新授权（`needAuthorization` 重新为真）** | 否（数据本身），**但影响审核与旧用户重新授权、进而影响同步可用性** | **否** | 首发前发布；上线后变更需评估重新授权影响 |
| O-07 | 清空 / 回滚 / tombstone GC / 环境删除 | 数据清理 | **不可逆**（`tombstoneDays:90` 已配置但**本版本未启用 GC**；环境删除不可逆） | **是（全量或大范围删除）** | **严禁** | 原则上永不 |
| O-08 | 付费套餐变更 | 容量 / 配额 / 续期 | 升配可逆、降配可能受限；**到期未续 → 服务中断，可续费恢复但环境释放则不可逆** | **间接（可用性与容量，极端情况影响数据保留）** | **否** | 首发前定套餐；到期前续费 |
| O-09 | 用户主动删除云端数据（**单用户不可逆**） | 用户权利；设置页「账号与隐私 → 删除云端数据」二次确认 → 撤回授权 + 全量 tombstone | **单用户不可逆**（云端副本删除后无法恢复；**本地业务数据保留**） | **是（单用户）** | 不适用（**由用户本人在 UI 触发，无需我们代执行**） | 随时（用户自主） |

### 6.4 汇总

| 分类 | 项数 | 其中「不可逆」或「影响全量」 | 未确认前可执行 |
|---|---|---|---|
| 权限 | 7 | P-04 影响全量；P-02/P-03 删除不可逆 | **0 项** |
| 配置项 | 11 | C-03 地域不可逆；C-02/C-05 影响全量 | **0 项** |
| 可能影响线上数据的操作 | 9 | O-05 / O-07 不可逆；O-04 / O-06 影响全量 | **0 项**（O-09 为用户自主，不适用） |
| **合计** | **27** | — | **本轮全部未执行** |

> 其中「本轮已定稿」项见 §6.0（`CLOUD_CONFIG` 内部默认值、适龄 8+ 工程默认、`game.json` 不加 `"cloud": true`、`traceUser:false`、保持 `enabled:false` 且已加 `publishCheck()`、设置页版本号 `v2.0`）；这些无需用户确认，但仍**未执行任何云端动作**。其余需要真实信息 / 平台侧动作的项一律保持「未执行」。

---

## 7. 本轮已执行与未执行

**已执行（均为只读 / 本地）**

- **只读查询了 1 个现有环境**（结果见 §1），未做任何变更；
- 只读核对了工程内 4 个交付文档与 `src/config.js`、`src/core/{cloud,sync,privacy,storage}.js`、`src/scenes/settings.js`、`src/data/privacy.js`、`game.js`、`project.config.json`、`game.json` 的事实；
- 本地运行 `node test-cloud.js`（111/0）、`node test-sync.js`（177/0）、端到端 `node test-recovery.js`（86/0）与只读自检 `node tools/publish-check.js`（**纯本地 mock / 只读，不联网、不触云、不改文件**）；
- 撰写 / 修订本轮 4 个 `.md` 交付文件。

**未执行（明确声明）**

- **未创建任何云端资源**：未开通云开发、未创建环境、未创建集合、未创建索引、未部署云函数；
- **未写入任何数据**：未创建 / 覆盖任何用户文档，未执行任何批量迁移；
- **未变更任何配置或安全规则**：`CLOUD_CONFIG` 仍为 `enabled:false` / `env:''`，`game.json` 未加 `"cloud": true`；云端化交付轮次未改任何 `src/**` 代码（第八轮红线修复改动了 `src/**`，但属本地代码修复，见 §10，**仍未触任何云端资源**）；
- **未发布任何隐私保护指引**、未填适龄分级 / 联系方式 / 隐私政策 URL、未做备案；
- **未 commit**、未调用任何会创建或修改云端资源的工具。

> 结论重申：**本轮未执行任何云端变更**（未创建资源、未写数据、未改配置 / 安全规则、未发布指引、未 commit）；**本轮代码已完整可集成，但云端默认关闭；填入 env 并确认权限后才真正联网。**

---

## 8. 风险分级与执行时机建议

### 8.1 当前状态：工程尚未发布

软著未申请、小程序备案未办、隐私政策未托管、**无线上用户、无云端数据**。因此：

- **结构性操作（创建环境 / 集合 / 索引、安全规则、地域、套餐、隐私指引发布、适龄分级、备案）建议在首个版本发布前一次性完成**——此时「线上数据为空」，误操作不造成用户损失，试错成本最低。
- 地域（C-03）、AppID 绑定（C-02）属于**不可逆 / 影响全量**项，必须在创建环境之前最先确认。

### 8.2 上线后允许白名单（仅此三类）

1. **新增集合**（新增、不影响存量）；
2. **新增可选字段**（向后兼容，不改 `schemaVersion`、不动既有键）；
3. **用户主动触发的单用户删除**（O-09，二次确认，单用户不可逆）。

### 8.3 上线后需灰度 + 回滚预案

- **安全规则变更**（O-04 / P-04）：影响全量用户读写，必须先小流量验证再全量；
- **隐私保护指引修改并发布**（O-06 / C-09）：影响审核并触发旧用户重新授权，需评估同步中断窗口。

### 8.4 原则上禁止

删除 / 重建集合（O-05）、清空 / 回滚 / tombstone GC 启用 / 环境删除（O-07）、付费套餐降级或到期不续（O-08 / C-04）、服务端批量覆盖写（O-03 明确不含）。

### 8.5 「进度不丢失」承诺的依赖链

`体验版未到期（2027-05-07，IsAutoRenew:false）` ∧ `配额充足` ∧ `安全规则未被误改` ∧ `用户未主动删除云端数据` → 换设备 / 清缓存后进度可恢复。任一环节失效，本地数据仍完整、玩法不受影响，但**跨设备恢复失效**。需在到期前完成续期确认（C-04）。

---

## 9. 附录：文档关系与工程对应

| 文档 | 职责 |
|---|---|
| `PRIVACY_POLICY.md` | 完整可托管隐私政策（本轮新建） |
| `CLOUD_DEPLOY.md` | 本文件：部署指南 + 需确认清单 + 环境核查结论（本轮新建） |
| `WECHAT_PUBLISH_GUIDE.md` | 上架材料清单，已重写与云端化冲突的承诺（本轮修改） |
| `ARCHITECTURE.md` | 技术架构，已追加「云端持久化与同步」章节（本轮修改） |

| 工程实现 | 位置 |
|---|---|
| 配置开关 | `src/config.js` → `CLOUD_CONFIG` / `STORAGE_KEYS` |
| 前端直连 | `src/core/cloud.js`（`wx.cloud.init` / `database()` / CAS / 消毒 / `serverDate`） |
| 同步与合并 | `src/core/sync.js`（`mergeKey` / `start` / `flush` / `pendingQueue` / `requestDeleteAll`） |
| 授权门控 | `src/core/privacy.js`（`canSync` 为唯一闸门） |
| 唯一读写源 | `src/core/storage.js`（28 个既有 API 契约不变 + 写 hook / `applyRemote`） |
| 合规 UI | `src/scenes/settings.js`「账号与隐私」分组（对局内设置抽屉复用）+ `src/data/privacy.js` 文案 |
| 启动接线 | `game.js`（`privacy.init()` → `sync.start()` → `onDataChanged()`；`onShow` → `refresh + flush`，未 pull 时补做全量 `sync.start()`；`publishCheck()` 启动告警；`GameContext.requestCloudPull()`） |

**平台铁律**：微信小游戏纯 JS / CommonJS / Canvas 2D，无 DOM / eval / npm；零云函数、零 `wx.request`。所有 `.md` 已被 `packOptions.ignore` 排除出代码包，仅作为交付 / 审核材料。

---

## 10. 第八轮修复（独立审查驱动的红线修复 · 2026-11-07）

> 两路独立审查（代码红线 + 合规 / 文档一致性）发现 P0 / P1 若干，本轮逐一修复，并补自动化断言与文档定稿。
> **本轮仍未创建任何云端资源**：未开通云开发、未创建环境 / 集合 / 索引、未写数据、未改安全规则、未发布指引、未填任何真实联系方式 / env、未 commit、未调用任何创建或修改云端资源的工具。所有改动均为本地代码 / 测试 / 文档。

### 10.1 六组红线修复

| # | 红线 | 修复要点（落地位置） |
|---|---|---|
| 1 | **云回填刷新界面** | `game.js` 的 `sync.start()` 成功后调当前场景 `onDataChanged()`；`menu.js` / `endgameMap.js` / `academy.js` 新增 `onDataChanged()` 只重算进度缓存字段，不重置滚动 / 按压 / 详情态。解决「pull 回填了本地数据，但场景缓存仍是冷启动旧值」的界面不刷新。 |
| 2 | **全量 pull 可重试** | `GameContext.requestCloudPull()` 挂载；`onShow` 在 `_cloudPullDone=false` 且授权、云端就绪时补做一次全量 `sync.start()`；冷启动因未授权 / 未启用没做成 pull 的，授权或配置就绪后可补做，避免「授权晚于冷启动 → 本会话永不拉云」。 |
| 3 | **LWW 时间戳与 tombstone 传播** | `storage.saveSettings/saveLastConfig/saveResume` 写入对象补 `updatedAt`（`Date.now()`），`sync._ts()` 优先取记录自带 `updatedAt`，修掉「本地新值被云端旧值覆盖」；`_mergeLWW` 遇 `rem.deleted` 返回 `{value:null,deleted:true,changed:true}`，`start()` 对 deleted 走 `applyRemote(remove)` 且 pass3 以 `remove` 入队，杜绝「一端删除被另一端旧值撤销」。28 个导出签名 / 同步语义不变。 |
| 4 | **隐私声明降级** | `privacy.openContract(onFail)`：能力缺失→`onFail()+false`、平台 fail→`onFail()+true`、success→true、抛异常→`onFail()+false`，`onFail` 至多一次；设置页 fail / 接口缺失时本地 8 段隐私声明一定可达且至多一次；DENIED 点击开关先 `privacy.refresh()` 再 `requestCloudPull()`；关闭开关调 `sync.clearPending()`；昵称清洗控制字符并 ≤12 字。 |
| 5 | **删除不留明文** | `cloud.markDeleted()` 写 `putRecord(key, null, doc.rev, true)`（tombstone 的 `value=null`，不留昵称 / 棋谱 / 设置明文）；新增 `cloud.deleteStateDoc()` 物理删 `chess_state`；`sync.requestDeleteAll()` 末尾物理删同步元数据。符合用户删除权。 |
| 6 | **授权前不收集** | `sync.noteWrite` 加 `_canSync()` 门控（未授权 / 未启用零入队、零调度），新增 `sync.clearPending()` 清队列与定时器；`game.js` 的 `publishCheck()` 在 `enabled/env` 为空时 `console.warn`（不回显 env 值），`_warn()` 不回显原始异常（防夹带 openid / 昵称 / env）。 |

**同步健壮性（并入第 3 组）**：`start()` 仅对 `changed || push(与远端差异)` 的 key 入队（稳定态零入队）、`_addPending` 按 key 去重 + 500 上限、超限 / 不可恢复 op 达 `maxRetries` 移出队列、`_doFlush` 每批 ≤10 个 Promise、`OPS_KEY='ops'`（不含点号，兼容读旧点号键）、`cloud._validKey` 加 key 长度 ≤128。

### 10.2 新增验证资产

| 文件 | 职责 | 结果 |
|---|---|---|
| `test-cloud.js`（追加） | tombstone 无明文、`deleteStateDoc` 物理删 / 不可用已决议、`_validKey` 128/129、严格 mock 断言 `where._openid === '{openid}'` | 111/0 |
| `test-sync.js`（追加） | 门控 / `clearPending` / `updatedAt` LWW / tombstone 跨设备 / 稳定态零入队 / `requestDeleteAll` / 超限 op / 50 局分批并发 ≤10 / `OPS_KEY` 兼容 / `openContract` 四分支 | 177/0 |
| `test-recovery.js`（新建） | **端到端清缓存恢复演练**：设备 A 造真实进度推云 → 清缓存 → 设备 B 清 `require.cache` 重新加载后 `start()` → 28 个读 API 精确恢复 → 场景 `onDataChanged()` 自愈 → 删除不复活；全程内存 `wx.cloud`，零真机 / 零云端 | 86/0 |
| `tools/publish-check.js`（新建） | 只读发布前自检：配置 / 集合名 / 【待填】/ 过时文案 / 单机版 / `publishCheck` / `src/` 禁用 API；默认退出 0，`--strict` 阻断项退出 1；不回显 env 值 | 非 strict 0（阻断 3 项 / 通过 6 项） |

### 10.3 本轮自行定稿与仍需用户提供的信息

- **已由主理人定稿**（见 §6.0）：`CLOUD_CONFIG` 内部默认值、适龄 8+ 工程默认、`game.json` 不加 `"cloud": true`、`traceUser:false`、已加 `publishCheck()`、设置页版本号 `v2.0`。
- **已由用户提供（2026-11-08）**：`env` = `freedom-land-d4gv0gs78c0dd7b2f`（C-01）、AppID = `wx5a78cb07bad9cf59`（C-02，与 `project.config.json` 一致且即为此云环境绑定 AppID）；`CLOUD_CONFIG.enabled` 已置 `true`、`env` 已填。
- **仍需用户提供真实信息 / 平台侧动作**：地域(C-03)、套餐续期(C-04)、隐私政策可访问 URL(C-06)、主体 / 联系方式 / 生效日期(C-08)、公众平台《用户隐私保护指引》填报与发布(C-09 / O-06)。注：创建集合 / 安全规则 / 索引等结构性云端动作已于 2026-11-08 全部完成（详见 §11.4），其中集合+规则+`_openid` 单字段索引由你在微信云开发控制台执行、两个复合索引由 MCP 补齐，无需你再操作；仅隐私指引发布与备案仍需你侧完成。
- 结论重申：第八轮未创建任何云端资源；2026-11-08 代码侧已接线（`enabled:true` + `env` 已填），但集合 / 安全规则尚未创建。

---

## 11. 微信云开发环境 provisioning 实操（freedom-land · 2026-11-08）

### 11.1 平台边界说明（为什么不能由 CloudBase baas MCP / CLI 建集合）
- `freedom-land-d4gv0gs78c0dd7b2f` 是**微信云开发**环境（绑定 AppID `wx5a78cb07bad9cf59`），由微信侧管理，其 NoSQL 数据库**不在**腾讯云 CloudBase baas 的 `DescribeEnvs` 可见范围内。
- 当前账号（主账户 `100054792884`）在 CloudBase baas 侧**唯一可见环境**是 `scattered-snake-d6f1w49bc696a296`（baas / PostgreSQL / `nosql=false` / `WxAppId=""`），**不能用于 `wx.cloud`**，也不能承载本项目集合。
- 实测：跨 `ap-shanghai / ap-guangzhou / ap-singapore` 列表均只返回 `scattered-snake`；`queryEnv(info, freedom-land)` 报 `env not found in list`；对 `freedom-land` 的 NoSQL 操作报 `No permission` / `env not found`。`set_env` 仅能「按 ID 幽灵绑定」，真实 DB 操作失败。
- **因此**：集合、安全规则、索引必须在**微信云开发控制台**（微信开发者工具 → 云开发，或 mp 平台云开发）创建；CloudBase baas MCP 无法触达 `freedom-land`。

> **2026-11-08 后续 · 账号重新绑定后已可直连**：你重新绑定 CloudBase 账号后，MCP `auth(status)` 返回 `current_env_id: freedom-land-d4gv0gs78c0dd7b2f` / `env_status: READY`，`queryEnv(list)` 已能列出 `freedom-land`（`EnvType=baas` / `Region=ap-shanghai` / `PackageName=个人版` / `IsDefault=true`）。**结论反转**：该环境现在可由 MCP 直接管理。实测 `readNoSqlDatabaseStructure(listCollections/describeCollection)`、`writeNoSqlDatabaseStructure(updateCollection+CreateIndexes)`、`queryPermissions/getResourcePermission` 均成功。本批次实际落地：你在控制台完成集合+规则+`chess_state`/`chess_records` 的 `_openid` 单字段索引；MCP 补齐 `chess_records` 的两个复合索引（`idx_openid_key`、`idx_openid_updatedAt`）。§11.4 见最终核对结果。

### 11.2 操作清单（约 2 分钟，需你手动执行）
1. 微信开发者工具用 AppID `wx5a78cb07bad9cf59` 打开本项目 → 顶部「云开发」→ 确认当前环境为 `freedom-land`（环境名 `freedom-land`）。
2. 左侧「数据库」→ 「集合名称」→ **+ 新建集合**：
   - `chess_state`
   - `chess_records`
3. 逐个集合 → 「权限设置」→ 选「自定义安全规则」→ 清空默认 → 粘贴并保存：
   ```json
   {
     "read": "doc._openid == auth.openid",
     "write": "doc._openid == auth.openid"
   }
   ```
   （等价预设：部分控制台提供「仅创建者可读写」；但直接粘贴上面两段式表达式最稳妥，与 `src/core/cloud.js` 的 `where({_openid:'{openid}'})` 强制服务端隔离一致。）
4. （**可选 · 性能优化，跳过不影响同步功能**）建索引：进入集合 → 「索引管理」→「新建索引」，在「索引字段」按下方 JSON 填写：
   - `chess_records` 复合索引 A：`{"_openid":1,"key":1}`（支撑 CAS `where({_openid,key,rev})`）
   - `chess_records` 复合索引 B：`{"_openid":1,"updatedAt":1}`（支撑分页 / 排序）
   - `chess_state` 单字段：`{"_openid":1}`（若控制台提示已存在系统默认 `_openid` 索引，跳过此项即可）
   索引名称自定义（如 `idx_openid_key`），「是否唯一」选**否**。
   - **已于 2026-11-08 落地**：`chess_state` 的 `_openid` 单字段索引由控制台创建；`chess_records` 的两个复合索引由 MCP `updateCollection+CreateIndexes` 补齐（`idx_openid_key`、`idx_openid_updatedAt`，均为非唯一）。`describeCollection` 回读确认 `chess_records` 共 4 个索引（`_id_` / `_openid_1` / `idx_openid_key` / `idx_openid_updatedAt`）、`chess_state` 共 2 个（`_id_` / `_openid_1`）。
5. 验证：体验版 / 真机进入游戏 → 设置「账号与隐私」开云同步并授权 → 玩一局、存棋谱 → 清缓存重进（或换设备同微信账号）→ 进度 / 棋谱 / 设置恢复。

### 11.3 手动验收清单（真机 / 模拟器，本环境无法代验）
- [ ] 冷启动无 `wx.cloud.init` 报错；设置页显示云同步「已开启」。
- [ ] 授权后 `sync.start()` 走 `pull → merge → applyRemote → push`，进度栏从云端回填（menu / 阵图 / 锦囊阁 `onDataChanged()` 自愈）。
- [ ] 造 ≥21 条 `chess_records` 验分页（`listRecords` 自动 `skip + limit(20)`）。
- [ ] 清缓存 / 换设备恢复：本地空数据不覆盖云端。
- [ ] 拒绝授权：状态 `denied`、零云调用、玩法不受影响。
- [ ] 删除云端数据：tombstone（`value=null` 无明文）+ 物理删 `chess_state`，本地保留。

### 11.4 当前完成态（2026-11-08 · 已全量落地）
- **代码侧**：云端链路完整可集成，`CLOUD_CONFIG.enabled:true`、`env:'freedom-land-d4gv0gs78c0dd7b2f'`。
- **平台侧（freedom-land 环境）**：
  - 集合 `chess_state` / `chess_records` 均已存在（控制台创建）。
  - 两集合安全规则均为 `CUSTOM`：`{"read":"doc._openid == auth.openid","write":"doc._openid == auth.openid"}`（与 `src/core/cloud.js` 的 `where({_openid:'{openid}'})` 服务端隔离一致；`MCP getResourcePermission` 回读已确认）。
  - 索引：`chess_state` = `_id_` + `_openid_1`（单字段，已覆盖主查询）；`chess_records` = `_id_` + `_openid_1` + `idx_openid_key`（`_openid,key`）+ `idx_openid_updatedAt`（`_openid,updatedAt`）。复合索引由 MCP 补齐，回读确认。
  - **关于 create 规则告警**：`getResourcePermission` 返回的 `createRuleDocWarning` 是 CloudBase-baas 通用提示（`create` 时 `doc.*` 不可用）。本环境是**微信云开发**，`auth.openid`/`_openid` 身份模型以 `write` 整段（含 create）判定，且平台在写入前自动注入 `_openid`，故该告警对微信云开发不适用，规则保持原样即可。
- **测试侧**：9 套回归全绿（test 9 / integration 59 / engine 62 / endgame 100 / endgame-scene 86 / gameplay 11 / cloud 111 / sync 177 / recovery 86）；本批次重跑 cloud 111 / sync 177 / recovery 86 / test 9 全绿；`publish-check` 默认退出 0。
- **待补（按你要求延后）**：提审材料 —— `PRIVACY_POLICY.md`【待填】、`WECHAT_PUBLISH_GUIDE.md` 公众平台《用户隐私保护指引》填报与发布、备案。
- `--strict` 当前 1 项阻断：`PRIVACY_POLICY.md` 6 处【待填】（已按你要求延后，非代码/环境阻断项）。
