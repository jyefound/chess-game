/**
 * 同步层（v3 · 本地优先 + 云端 KV 镜像）
 *
 * 核心原则：storage.js 仍是唯一读写源，28 个 API 全部保持同步返回。云端只是
 * 「以本地 storage key 为逻辑 key 的 KV 镜像」。云失败永远不改变本地写入结果、
 * 不改变 ok/reason、不改变残局增量 API 的业务返回值。
 *
 *  - 启动时序：game.js 在 switchTo('menu') 后异步调 start()；本地渲染始终先读本地，
 *    pull 完成后再回填（applyRemote，抑制 hook 防回环），不阻塞主循环。
 *  - 授权门控：start()/flush() 必须先问 privacy.canSync()，未授权 → 零云调用。
 *    privacy.js 由另一 worker 提供，这里惰性 require + try/catch，取不到视为不授权。
 *  - 首次上云：先 pull → 逐 key mergeKey（字段级语义合并）→ applyRemote 回填
 *    → 再 push 合并结果；绝不 push 本地覆盖云端；云端无文档时才以本地为准创建。
 *  - mergeKey 是纯函数（不读 storage / 不碰 wx / 不改模块状态），供测试直接调。
 *
 * 云 KV 结构（与 cloud.js 约定）：每 key 一个 entry {value, rev, updatedAt, deleted}，
 * rev 单调整数，CAS = where({_openid, key, rev: expectedRev}).update()；updated:0
 * 视为冲突 → 重新 pull → 合并 → 重试（最多 CLOUD_CONFIG.maxRetries）。
 * opId 去重：pendingQueue 每项带 opId，云端 chess_state.keys.ops 存已处理 opId
 * （键名不含点号，避免 MongoDB 字段路径歧义；旧键兼容读取）。限量裁剪。
 */
'use strict';

var config = require('../config');
var storage = require('./storage');
var cloud = require('./cloud');
var room = require('./room');   // v4 远程房间独立通道（room.js 只 require config/cloud，不与本层循环）

var CLOUD = config.CLOUD_CONFIG;
var KEYS = config.STORAGE_KEYS;

var KEY_RE = /^chess\.[a-z.]+\.v1(\.[A-Za-z0-9_-]+)?$/;
var OPS_KEY = 'ops';                       // 云端 state doc 内键名：不含点号
var LEGACY_OPS_KEY = 'chess.sync.ops.v1'; // 旧键：兼容读取 + 防误当业务 key 同步
var OPS_LIMIT = 500;
var PENDING_LIMIT = 500;                  // pending 队列上限，超出保留最新
var BATCH_SIZE = 10;                      // _doFlush 每批并发上限，避免平台限流

// ---- 模块内部状态（顶层绝不触碰 wx / cloud；由 init()/start() 惰性驱动）----
var _inited = false;
var _state = 'idle';           // idle|syncing|pushing|error|disabled|denied
var _pending = [];             // [{opId, key, op:'set'|'remove', ts}]
var _ops = [];                 // 云端已处理 opId（镜像）
var _stateRev = null;          // chess_state 文档 rev（CAS 用）
var _remoteEntries = {};       // 上次 pull：key -> {value, rev, updatedAt, deleted}
var _lastPullAt = 0;
var _lastPushAt = 0;
var _lastError = null;
var _timer = null;             // debounce 定时器
var _flushPromise = null;      // flush 串行化
var _opSeq = 0;

function hasOwn(o, k) { return Object.prototype.hasOwnProperty.call(o, k); }
function _clone(o) { if (!o || typeof o !== 'object') return o; try { return JSON.parse(JSON.stringify(o)); } catch (e) { return o; } }
function _isPlainObj(o) {
  if (!o || typeof o !== 'object' || Array.isArray(o)) return false;
  var p = Object.getPrototypeOf(o);
  return p === Object.prototype || p === null;
}

// ---------------------------------------------------------------------------
// 纯函数工具：深度相等 / 时间戳 / 远端 entry 归一化
// ---------------------------------------------------------------------------
function _deepEq(a, b) {
  if (a === b) return true;
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') return false;
  var aa = Array.isArray(a), bb = Array.isArray(b);
  if (aa !== bb) return false;
  if (aa) {
    if (a.length !== b.length) return false;
    for (var i = 0; i < a.length; i++) if (!_deepEq(a[i], b[i])) return false;
    return true;
  }
  var ka = Object.keys(a), kb = Object.keys(b);
  if (ka.length !== kb.length) return false;
  for (var j = 0; j < ka.length; j++) {
    var k = ka[j];
    if (!hasOwn(b, k) || !_deepEq(a[k], b[k])) return false;
  }
  return true;
}

/** entry.updatedAt 可能是 number / Date / serverDate 占位对象；统一取毫秒。 */
function _entryTs(e) {
  if (!e || typeof e !== 'object') return 0;
  var t = e.updatedAt;
  if (typeof t === 'number' && isFinite(t)) return t;
  if (t && typeof t === 'object' && typeof t.getTime === 'function') {
    try { return t.getTime(); } catch (x) {}
  }
  return 0;
}
/**
 * LWW 时间戳：优先「记录自带 updatedAt」（storage 写入时落 Date.now()），
 * 否则回落到「服务端 entry 时间」（db.serverDate()）。两者皆无则 0。
 * A2：本地写入对象此前无 updatedAt，_ts 恒为 0，导致远端 serverDate 恒赢、
 * 本地新值被云端旧值覆盖；storage.saveSettings/saveLastConfig/saveResume 已补该字段。
 */
function _ts(v, entry) {
  var a = (_isPlainObj(v)) ? Number(v.updatedAt) : 0;
  if (isFinite(a) && a > 0) return a;
  var b = _entryTs(entry);
  return (isFinite(b) && b > 0) ? b : 0;
}

/**
 * 把 mergeKey 的第三参统一成 {value, deleted, ts}。
 * 兼容两种传法：① 规范 entry {value, rev, updatedAt, deleted}；② 裸值对象。
 * 判定依据：是否含 value/rev/deleted 特征键（残局裸值含 version/updatedAt，不含这些键）。
 */
function _asRemote(remoteEntry) {
  if (remoteEntry === null || remoteEntry === undefined) return { value: null, deleted: false, ts: 0 };
  if (typeof remoteEntry !== 'object') return { value: null, deleted: false, ts: 0 };
  var isEntry = hasOwn(remoteEntry, 'value') || hasOwn(remoteEntry, 'rev') || hasOwn(remoteEntry, 'deleted');
  if (isEntry) {
    var v = hasOwn(remoteEntry, 'value') ? remoteEntry.value : null;
    return { value: v, deleted: !!remoteEntry.deleted, ts: _ts(v, remoteEntry) };
  }
  return { value: remoteEntry, deleted: false, ts: _ts(remoteEntry, null) };
}

// ---------------------------------------------------------------------------
// 归一化（复刻 storage._normalizeEndgame 思路；storage.js 未导出，故在此复刻）
// 所有远端值先过默认值补齐 / 归一化再合并，脏值拒绝。
// ---------------------------------------------------------------------------
var DEFAULT_ENDGAME = {
  version: 1, unlockedLevel: 1, cleared: {}, skills: [],
  tipsCollected: [], pendingHints: 0,
  stats: { totalAttempts: 0, totalClears: 0 }, updatedAt: 0
};
function _posInt(v) { var n = Math.floor(Number(v)); return isFinite(n) && n > 0 ? n : 0; }

function _normEndgame(raw) {
  var out = _clone(DEFAULT_ENDGAME);
  if (!_isPlainObj(raw)) { out.version = 1; return out; }
  var ul = Math.floor(Number(raw.unlockedLevel));
  if (isFinite(ul) && ul >= 1) out.unlockedLevel = ul;

  if (_isPlainObj(raw.cleared)) {
    for (var ck in raw.cleared) {
      if (!hasOwn(raw.cleared, ck)) continue;
      var ce = raw.cleared[ck];
      if (!_isPlainObj(ce)) continue;                       // 脏值拒绝
      out.cleared[ck] = {
        stars: Math.max(0, Math.min(3, Math.floor(Number(ce.stars) || 0))),
        bestTimeMs: _posInt(ce.bestTimeMs),
        bestMoves: _posInt(ce.bestMoves),
        rewarded: !!ce.rewarded
      };
    }
  }
  if (Array.isArray(raw.skills)) {
    var seen = {};
    for (var i = 0; i < raw.skills.length; i++) {
      var it = raw.skills[i];
      if (!_isPlainObj(it) || typeof it.id !== 'string' || !it.id) continue;
      var ch = Math.floor(Number(it.charges));
      if (!isFinite(ch) || ch < 0) ch = 0;
      if (seen[it.id] !== undefined) out.skills[seen[it.id]].charges += ch;   // 按 id 聚合
      else { seen[it.id] = out.skills.length; out.skills.push({ id: it.id, charges: ch }); }
    }
  }
  if (Array.isArray(raw.tipsCollected)) {
    var tips = {};
    for (var t = 0; t < raw.tipsCollected.length; t++) {
      var tip = raw.tipsCollected[t];
      if (typeof tip === 'string' && tip && !tips[tip]) { tips[tip] = true; out.tipsCollected.push(tip); }
    }
  }
  var ph = Math.floor(Number(raw.pendingHints));
  if (isFinite(ph) && ph > 0) out.pendingHints = ph;
  if (_isPlainObj(raw.stats)) {
    out.stats.totalAttempts = _posInt(raw.stats.totalAttempts);
    out.stats.totalClears = _posInt(raw.stats.totalClears);
  }
  var up = Number(raw.updatedAt);
  if (isFinite(up) && up > 0) out.updatedAt = up;
  out.version = 1;
  return out;
}

/** skills >8 裁剪（聚合后确定性取前 8；不改 pendingHints，避免干扰局部 LWW）。 */
function _capSkills(arr) {
  var out = [];
  for (var i = 0; i < arr.length && out.length < 8; i++) {
    var it = arr[i];
    if (it && typeof it.id === 'string' && it.id) {
      var ch = Math.floor(Number(it.charges));
      if (!isFinite(ch) || ch < 0) ch = 0;
      out.push({ id: it.id, charges: ch });
    }
  }
  return out;
}
function _minPos(a, b) {
  if (a > 0 && b > 0) return Math.min(a, b);
  if (a > 0) return a;
  if (b > 0) return b;
  return 0;
}
/** 默认值补齐：settings 以 DEFAULT_SETTINGS 为底，其余保持对象。 */
function _fillDefaults(key, v) {
  if (!_isPlainObj(v)) return v;
  if (key === KEYS.settings && _isPlainObj(config.DEFAULT_SETTINGS)) {
    var out = _clone(config.DEFAULT_SETTINGS);
    for (var k in v) if (hasOwn(v, k)) out[k] = v[k];
    return out;
  }
  return _clone(v);
}

// ---------------------------------------------------------------------------
// 各 key 的字段级语义合并（全部纯函数）
// ---------------------------------------------------------------------------

/** chess.endgame.v1：单调字段取 max/min/并集/OR；skills+pendingHints 用局部 LWW。 */
function _mergeEndgame(localValue, rem) {
  var L = _normEndgame(localValue);
  var R = (!rem.deleted && _isPlainObj(rem.value)) ? _normEndgame(rem.value) : null;
  var out = _normEndgame(null);
  var ck, i;

  out.unlockedLevel = Math.max(L.unlockedLevel, R ? R.unlockedLevel : 0, 1);   // max

  var levels = {};
  for (ck in L.cleared) if (hasOwn(L.cleared, ck)) levels[ck] = true;
  if (R) for (ck in R.cleared) if (hasOwn(R.cleared, ck)) levels[ck] = true;
  var ZERO = { stars: 0, bestTimeMs: 0, bestMoves: 0, rewarded: false };
  for (ck in levels) {
    if (!hasOwn(levels, ck)) continue;
    var a = L.cleared[ck] || ZERO;
    var b = (R && R.cleared[ck]) || ZERO;
    out.cleared[ck] = {
      stars: Math.max(a.stars, b.stars),                       // max
      bestTimeMs: _minPos(a.bestTimeMs, b.bestTimeMs),        // min(>0)
      bestMoves: _minPos(a.bestMoves, b.bestMoves),           // min(>0)
      rewarded: !!(a.rewarded || b.rewarded)                  // OR
    };
  }

  var tipSeen = {};
  for (i = 0; i < L.tipsCollected.length; i++) { var t1 = L.tipsCollected[i]; if (!tipSeen[t1]) { tipSeen[t1] = true; out.tipsCollected.push(t1); } }
  if (R) for (i = 0; i < R.tipsCollected.length; i++) { var t2 = R.tipsCollected[i]; if (!tipSeen[t2]) { tipSeen[t2] = true; out.tipsCollected.push(t2); } }

  out.stats.totalAttempts = Math.max(L.stats.totalAttempts, R ? R.stats.totalAttempts : 0);
  out.stats.totalClears = Math.max(L.stats.totalClears, R ? R.stats.totalClears : 0);

  // 增减型字段：updatedAt 较新一侧「整体为准」的局部 LWW，并在返回里标记
  var lt = L.updatedAt, rt = R ? R.updatedAt : 0;
  var useRemote = !!R && (rt > lt);
  var src = useRemote ? R : L;
  out.skills = _capSkills(src.skills);
  out.pendingHints = src.pendingHints;

  out.updatedAt = Math.max(lt, rt, 0);
  out.version = 1;
  return {
    value: out,
    lww: { fields: ['skills', 'pendingHints'], side: useRemote ? 'remote' : 'local' }
  };
}

/**
 * chess.records.index.v1：ids 并集，按既有「最新在前」次序保留（storage 写入即维护该序，
 * 纯函数无逐局 endedAt/createdAt 上下文，故以保序并集近似倒序），满 50 裁剪最早局，
 * 并为被裁局生成 tombstone 记录（record key）。
 */
function _mergeRecordsIndex(localValue, rem) {
  var L = (_isPlainObj(localValue) && Array.isArray(localValue.ids)) ? localValue.ids.slice() : [];
  var R = (!rem.deleted && _isPlainObj(rem.value) && Array.isArray(rem.value.ids)) ? rem.value.ids.slice() : [];
  var seen = {}, ids = [], i, id;
  for (i = 0; i < L.length; i++) { id = L[i]; if (typeof id === 'string' && id && !seen[id]) { seen[id] = true; ids.push(id); } }
  for (i = 0; i < R.length; i++) { id = R[i]; if (typeof id === 'string' && id && !seen[id]) { seen[id] = true; ids.push(id); } }

  var max = (config.LIMITS && config.LIMITS.maxRecords) || 50;
  var tombstones = [];
  if (ids.length > max) {
    var dropped = ids.slice(max);          // 尾部 = 最早局
    ids = ids.slice(0, max);
    for (i = 0; i < dropped.length; i++) tombstones.push(KEYS.recordPrefix + dropped[i]);
  }
  var lts = _isPlainObj(localValue) ? (Number(localValue.updatedAt) || 0) : 0;
  var rts = (_isPlainObj(rem.value) ? (Number(rem.value.updatedAt) || 0) : 0) || rem.ts || 0;
  return { value: { version: 1, ids: ids, updatedAt: Math.max(lts, rts) }, tombstones: tombstones };
}

/** chess.record.v1.*：tombstone 优先（删除优先于更新），否则 updatedAt LWW。 */
function _mergeRecord(localValue, rem) {
  if (rem.deleted) return { value: null, deleted: true };
  var L = _isPlainObj(localValue) ? localValue : null;
  var R = _isPlainObj(rem.value) ? rem.value : null;
  if (!L && !R) return { value: null };
  if (!R) return { value: _clone(L) };
  if (!L) return { value: _clone(R) };
  var lt = _ts(L, null), rt = rem.ts || _ts(R, null);
  return { value: _clone(rt > lt ? R : L) };
}

/** settings/tutorial/lastConfig/resume/profile/endgameResume：updatedAt LWW（同刻本地优先）。
 *  A3：tombstone（rem.deleted）优先于本地陈旧值，返回删除标记让 mergeKey 传播，
 *  对齐 _mergeRecord 口径，避免其它设备把「删除云端数据」撤销。 */
function _mergeLWW(key, localValue, rem) {
  if (rem.deleted) return { value: null, deleted: true, changed: true };
  var L = _isPlainObj(localValue) ? _fillDefaults(key, localValue) : null;
  var R = _isPlainObj(rem.value) ? _fillDefaults(key, rem.value) : null;
  var value;
  if (!L && !R) value = null;
  else if (!R) value = _clone(L);
  else if (!L) value = _clone(R);
  else {
    var lt = _ts(localValue, null), rt = rem.ts || _ts(rem.value, null);
    value = _clone(rt > lt ? R : L);       // 严格 >，相等时本地优先
  }
  return { value: value, deleted: false, changed: !_deepEq(value, localValue === undefined ? null : localValue) };
}

/**
 * 纯函数：逐 key 语义合并。remoteEntry 为 {value, rev, updatedAt, deleted}（也兼容裸值）。
 * @returns {{value, changed, lww?, tombstones?, deleted?}}
 *   value    = 合并结果（null 表示应删除/无数据）
 *   changed  = 与 localValue 是否不同（决定是否需 applyRemote 回填）
 */
function mergeKey(key, localValue, remoteEntry) {
  var rem = _asRemote(remoteEntry);
  var hasLocal = localValue !== null && localValue !== undefined;
  var hasRemote = !rem.deleted && rem.value !== null && rem.value !== undefined;
  if (!hasLocal && !hasRemote) return { value: null, changed: false };  // 不凭空造数据

  var value = null;
  var extras = {};
  if (key === KEYS.endgame) {
    var e = _mergeEndgame(localValue, rem);
    value = e.value;
    extras.lww = e.lww;
  } else if (key === KEYS.recordsIndex) {
    var ix = _mergeRecordsIndex(localValue, rem);
    value = ix.value;
    if (ix.tombstones && ix.tombstones.length) extras.tombstones = ix.tombstones;
  } else if (typeof key === 'string' && KEYS.recordPrefix && key.indexOf(KEYS.recordPrefix) === 0) {
    var rec = _mergeRecord(localValue, rem);
    value = rec.value;
    if (rec.deleted) extras.deleted = true;
  } else {
    var lw = _mergeLWW(key, localValue, rem);
    value = lw.value;
    if (lw.deleted) extras.deleted = true;
  }

  var changed = !_deepEq(value, localValue === undefined ? null : localValue);
  var out = { value: value, changed: changed };
  for (var k in extras) if (hasOwn(extras, k)) out[k] = extras[k];
  return out;
}

// ---------------------------------------------------------------------------
// 同步范围：本地控制键不镜像
// ---------------------------------------------------------------------------
var LOCAL_ONLY = {};
(function () {
  LOCAL_ONLY[KEYS.syncMeta] = true;
  LOCAL_ONLY[KEYS.syncQueue] = true;
  LOCAL_ONLY[OPS_KEY] = true;
  LOCAL_ONLY[LEGACY_OPS_KEY] = true;   // 旧 ops 键：仍须排除，防止被当业务 key 同步
  LOCAL_ONLY[KEYS.privacy] = true;   // 隐私同意态属本地/平台授权，不跨设备镜像
})();
function _isSyncable(key) {
  return typeof key === 'string' && !LOCAL_ONLY[key] && KEY_RE.test(key);
}

/** 本地已有数据的 key 全集（storage 无枚举 API；固定键 + 从 recordsIndex 展开记录键）。 */
function _localKeys() {
  var out = [];
  var fixed = [
    KEYS.settings, KEYS.tutorial, KEYS.lastConfig, KEYS.recordsIndex,
    KEYS.resume, KEYS.endgame, KEYS.endgameResume, KEYS.profile
  ];
  var i;
  for (i = 0; i < fixed.length; i++) if (_isSyncable(fixed[i])) out.push(fixed[i]);
  try {
    var ri = storage._readJSON(KEYS.recordsIndex);
    if (ri.ok && _isPlainObj(ri.value) && Array.isArray(ri.value.ids)) {
      for (i = 0; i < ri.value.ids.length; i++) {
        var rk = KEYS.recordPrefix + ri.value.ids[i];
        if (_isSyncable(rk) && out.indexOf(rk) < 0) out.push(rk);
      }
    }
  } catch (e) {}
  return out;
}
function _readLocal(key) {
  try {
    var r = storage._readJSON(key);
    if (r.ok && r.value !== null && r.value !== undefined) return { exists: true, value: r.value };
  } catch (e) {}
  return { exists: false, value: null };
}
function _unionKeys(a, b) {
  var seen = {}, out = [];
  function add(k) { if (_isSyncable(k) && !seen[k]) { seen[k] = true; out.push(k); } }
  for (var i = 0; i < a.length; i++) add(a[i]);
  for (var j = 0; j < b.length; j++) add(b[j]);
  return out;
}

// ---------------------------------------------------------------------------
// privacy 惰性门控（模块不存在 / canSync 抛错 → 一律视为不授权，安全默认）
// ---------------------------------------------------------------------------
function _privacy() {
  try { return require('./privacy'); } catch (e) { return null; }
}
function _canSync() {
  var p = _privacy();
  if (!p || typeof p.canSync !== 'function') return false;
  try { return !!p.canSync(); } catch (e) { return false; }
}
function _privacyState() {
  var p = _privacy();
  if (!p || typeof p.getState !== 'function') return 'unknown';
  try { return p.getState(); } catch (e) { return 'unknown'; }
}

// ---------------------------------------------------------------------------
// 本地控制态（syncMeta / syncQueue）持久化：一律走 applyRemote（抑制 hook，不入镜像）
// ---------------------------------------------------------------------------
function _loadMeta() {
  try {
    var m = storage._readJSON(KEYS.syncMeta);
    if (m.ok && _isPlainObj(m.value)) {
      _lastPullAt = Number(m.value.lastPullAt) || 0;
      _lastPushAt = Number(m.value.lastPushAt) || 0;
      _stateRev = (typeof m.value.stateRev === 'number' && isFinite(m.value.stateRev)) ? m.value.stateRev : null;
      _ops = Array.isArray(m.value.ops) ? m.value.ops.slice(-OPS_LIMIT) : [];
    }
    var q = storage._readJSON(KEYS.syncQueue);
    if (q.ok && Array.isArray(q.value)) {
      _pending = q.value.filter(function (it) { return it && typeof it.key === 'string' && _isSyncable(it.key); }).slice();
    }
  } catch (e) {}
}
function _persistQueue() {
  try { storage.applyRemote(KEYS.syncQueue, 'set', _pending.slice()); } catch (e) {}
}
function _persistMeta() {
  try {
    storage.applyRemote(KEYS.syncMeta, 'set', {
      lastPullAt: _lastPullAt, lastPushAt: _lastPushAt,
      stateRev: _stateRev, ops: _ops.slice(-OPS_LIMIT),
      schemaVersion: CLOUD.schemaVersion
    });
  } catch (e) {}
}

// ---------------------------------------------------------------------------
// pendingQueue + 节流
// ---------------------------------------------------------------------------
function _newOpId() {
  _opSeq += 1;
  return Date.now().toString(36) + '.' + _opSeq.toString(36) + '.' + Math.random().toString(36).slice(2, 7);
}
function _addPending(key, op) {
  // A6：同 key 只保留最新一次写（flush 复读当前本地态，旧 op 已无意义），并限总长。
  _pending = _pending.filter(function (x) { return !x || x.key !== key; });
  _pending.push({ opId: _newOpId(), key: key, op: (op === 'remove' ? 'remove' : 'set'), ts: Date.now(), fails: 0 });
  if (_pending.length > PENDING_LIMIT) _pending = _pending.slice(-PENDING_LIMIT);  // 保留最新
}

/** storage 写 hook：供 storage.addWriteHook 注册；value 参数接受但不入队（flush 时复读当前本地态，更稳健）。 */
function noteWrite(key, op, value) {
  try {
    if (!_inited || !_isSyncable(key)) return;
    // A1：必须过授权门控，杜绝「先收集后补授权」与队列无限增长。
    if (!_canSync()) return;
    if (!cloud.isEnabled()) return;        // 默认关闭：不入队、不调度（Node 回归无定时器）
    _addPending(key, op);
    _persistQueue();
    _schedule();
  } catch (e) { /* hook 绝不抛 */ }
}

/** A1：设置页关闭云同步开关时调用，清空待同步队列与定时器，绝不补传历史数据。 */
function clearPending() {
  if (_timer) { try { clearTimeout(_timer); } catch (e) {} _timer = null; }
  _pending = [];
  _persistQueue();
}

function _schedule() {
  if (!cloud.isEnabled() || !_canSync()) return;
  if (_timer) { try { clearTimeout(_timer); } catch (e) {} }
  _timer = setTimeout(function () { _timer = null; flush(); }, CLOUD.debounceMs || 600);
}

// ---------------------------------------------------------------------------
// 云端 pull / state 文档 / opId 去重
// ---------------------------------------------------------------------------
function _pullRemoteEntries() {
  return cloud.listRecords().then(function (res) {
    if (!res.ok) return { ok: false, reason: res.reason, entries: {} };
    var map = {}, items = res.items || [], i, d, rev, prev;
    for (i = 0; i < items.length; i++) {
      d = items[i];
      if (!d || typeof d.key !== 'string' || !_isSyncable(d.key)) continue;
      rev = Number(d.rev) || 0;
      prev = map[d.key];
      if (!prev || rev >= (Number(prev.rev) || 0)) {   // 重复 key 取 rev 最大者
        map[d.key] = { value: d.value, rev: rev, updatedAt: d.updatedAt, deleted: !!d.deleted };
      }
    }
    return { ok: true, entries: map, reason: 'ok' };
  }).catch(function () { return { ok: false, reason: 'error', entries: {} }; });
}

function _pullState() {
  return cloud.getStateDoc().then(function (res) {
    if (!res.ok) return { ok: false, reason: res.reason };
    var d = res.data || null;
    _stateRev = d ? (Number(d.rev) || 0) : null;
    var keys = (d && d.keys && typeof d.keys === 'object') ? d.keys : {};
    // A6：新键不含点号；兼容读取迁移期云端残留的旧键，读不到则忽略（空数组）。
    var ops = Array.isArray(keys[OPS_KEY]) ? keys[OPS_KEY] : [];
    if (!ops.length && Array.isArray(keys[LEGACY_OPS_KEY])) ops = keys[LEGACY_OPS_KEY];
    _ops = ops.slice(-OPS_LIMIT);
    return { ok: true, reason: 'ok' };
  }).catch(function () { return { ok: false, reason: 'error' }; });
}

function _pushStateOps(newOpIds) {
  if (!newOpIds || !newOpIds.length) return Promise.resolve({ ok: true, reason: 'noop' });
  _ops = _ops.concat(newOpIds).slice(-OPS_LIMIT);
  function write(rev) {
    var keys = {};
    keys[OPS_KEY] = _ops;
    return cloud.putStateDoc({ keys: keys }, rev);
  }
  return write(_stateRev).then(function (r) {
    if (r.ok && r.updated > 0) { _stateRev = (typeof _stateRev === 'number' ? _stateRev : 0) + 1; return { ok: true, reason: 'ok' }; }
    // 冲突 / 文档不存在：重拉 state doc 再以新 rev 重试一次
    return _pullState().then(function () { return write(_stateRev); }).then(function (r2) {
      if (r2.ok && r2.updated > 0) _stateRev = (typeof _stateRev === 'number' ? _stateRev : 0) + 1;
      return { ok: !!r2.ok, reason: r2.reason };
    });
  }).catch(function () { return { ok: false, reason: 'error' }; });
}

// ---------------------------------------------------------------------------
// push：按 key 批量推 + rev CAS + 冲突重拉合并重试
// ---------------------------------------------------------------------------
function _pushKey(key, value, deleted, rev) {
  var attempts = 0;
  var maxR = CLOUD.maxRetries || 3;
  function attempt() {
    return cloud.putRecord(key, deleted ? null : value, rev, deleted).then(function (r) {
      if (r.ok && r.updated > 0) return { ok: true, reason: 'ok' };
      if (r.ok && r.updated === 0) {
        attempts += 1;
        if (attempts > maxR) return { ok: false, reason: 'conflict' };
        // 冲突 → 重新 pull → 逐 key merge → 回填 → 重试
        return _pullRemoteEntries().then(function (p) {
          if (!p.ok) return { ok: false, reason: p.reason };
          var rem = p.entries[key] || null;
          var local = _readLocal(key).value;
          var m = mergeKey(key, local, rem);
          if (m.changed) {
            if (m.value === null) storage.applyRemote(key, 'remove', null);
            else storage.applyRemote(key, 'set', m.value);
          }
          rev = rem ? rem.rev : null;
          value = m.value;
          deleted = (m.value === null);
          return attempt();
        });
      }
      return { ok: false, reason: r.reason };
    }).catch(function () { return { ok: false, reason: 'error' }; });
  }
  return attempt();
}

function _doFlush() {
  if (!_pending.length) return Promise.resolve({ ok: true, reason: 'empty' });
  _state = 'pushing';
  var batch = _pending.slice();
  var byKey = {}, order = [], i;
  for (i = 0; i < batch.length; i++) {
    var it = batch[i];
    if (!it || !_isSyncable(it.key)) continue;
    if (!byKey[it.key]) { byKey[it.key] = true; order.push(it.key); }
  }
  // opId 去重：跳过云端已处理的 opId
  var processed = {};
  for (i = 0; i < _ops.length; i++) processed[_ops[i]] = true;
  var opsToMark = [];
  for (i = 0; i < batch.length; i++) if (batch[i] && batch[i].opId && !processed[batch[i].opId]) opsToMark.push(batch[i].opId);

  return _pullRemoteEntries().then(function (pull) {
    if (!pull.ok) return { ok: false, reason: pull.reason };
    var revs = pull.entries, jobs = [];
    for (var j = 0; j < order.length; j++) {
      var key = order[j];
      var cur = _readLocal(key).value;                 // 复读当前本地态（天然合并 debounce 期间多次写）
      var deleted = (cur === null || cur === undefined);
      var rev = revs[key] ? revs[key].rev : null;       // 云端无该 key → add 创建
      jobs.push({ key: key, cur: cur, deleted: deleted, rev: rev });
    }
    // A6：分批串行，每批 ≤BATCH_SIZE 个 _pushKey 并发，避免 clearAllRecords 时 50+ 并发触发平台限流。
    var results = [];
    function runBatch(start) {
      if (start >= jobs.length) return Promise.resolve(results);
      var slice = jobs.slice(start, start + BATCH_SIZE);
      return Promise.all(slice.map(function (job) {
        return _pushKey(job.key, job.cur, job.deleted, job.rev);
      })).then(function (rs) {
        for (var k = 0; k < rs.length; k++) results.push(rs[k]);
        return runBatch(start + BATCH_SIZE);
      });
    }
    return runBatch(0).then(function (results) {
      var allOk = true, reason = 'ok';
      var permanentFail = {};                          // 客户端不可恢复的失败（超字节/脏值/非法键）
      for (var r = 0; r < results.length; r++) {
        if (!results[r].ok) {
          allOk = false;
          reason = results[r].reason;
          if (results[r].reason === 'too_large' || results[r].reason === 'invalid_value' || results[r].reason === 'invalid_key') {
            permanentFail[order[r]] = true;
          }
        }
      }
      return _pushStateOps(opsToMark).then(function () {
        // A6：超限/不可恢复 op 累计失败计数，达到 maxRetries 后移出队列，避免永久污染 pending。
        if (Object.keys(permanentFail).length) {
          var maxFail = CLOUD.maxRetries || 3;
          _pending = _pending.filter(function (x) {
            if (!x || !permanentFail[x.key]) return true;
            x.fails = (Number(x.fails) || 0) + 1;
            return x.fails < maxFail;
          });
          _persistQueue();
        }
        if (allOk) {
          var done = {};
          for (i = 0; i < batch.length; i++) if (batch[i] && batch[i].opId) done[batch[i].opId] = true;
          _pending = _pending.filter(function (x) { return !(x && x.opId && done[x.opId]); });
          _persistQueue();
          _lastPushAt = Date.now();
          _persistMeta();
          _state = 'idle';
          return { ok: true, reason: 'ok' };
        }
        _state = 'error';
        _lastError = reason;
        return { ok: false, reason: reason };           // 失败留队列下次重试
      });
    });
  }).catch(function () { return { ok: false, reason: 'error' }; });
}

function flush() {
  if (!_inited) init();
  if (!cloud.isEnabled()) return Promise.resolve({ ok: false, reason: 'disabled' });
  if (!_canSync()) { _state = 'denied'; return Promise.resolve({ ok: false, reason: 'not_authorized' }); }
  if (_flushPromise) return _flushPromise;             // 串行化，避免并发 flush
  _flushPromise = _doFlush().then(
    function (r) { _flushPromise = null; return r; },
    function () { _flushPromise = null; return { ok: false, reason: 'error' }; }
  );
  return _flushPromise;
}

// ---------------------------------------------------------------------------
// 启动：门控 → pull → 逐 key merge → applyRemote 回填 → push 合并结果
// ---------------------------------------------------------------------------
function start() {
  if (!_inited) init();
  if (!cloud.isEnabled()) { _state = 'disabled'; return Promise.resolve({ ok: false, reason: 'disabled' }); }
  if (!_canSync()) { _state = 'denied'; return Promise.resolve({ ok: false, reason: 'not_authorized' }); }
  _state = 'syncing';
  _lastError = null;

  return _pullState()
    .then(function () { return _pullRemoteEntries(); })
    .then(function (pull) {
      if (!pull.ok) return { ok: false, reason: pull.reason };
      _remoteEntries = pull.entries;
      _lastPullAt = Date.now();

      var keys = _unionKeys(_localKeys(), Object.keys(_remoteEntries));
      var tombstones = [];
      var merged = [];
      var i;
      // pass 1：逐 key 语义合并 + 回填本地（applyRemote 抑制 hook；残局走 saveEndgame）
      for (i = 0; i < keys.length; i++) {
        var key = keys[i];
        try {
          var local = _readLocal(key).value;
          var rem = _remoteEntries[key] || null;
          var m = mergeKey(key, local, rem);
          if (m.changed) {
            // A3：deleted tombstone 优先，本地删除并让 pass3 以 remove 传播，避免撤销其它设备的删除。
            if (m.deleted || m.value === null) storage.applyRemote(key, 'remove', null);
            else storage.applyRemote(key, 'set', m.value);
          }
          if (m.tombstones) tombstones = tombstones.concat(m.tombstones);
          // A4：入队条件同时看「合并结果与本地差异（changed）」与「与远端差异（push）」，
          // 兼顾「本地较新需推云端」与「首次上云需创建」，稳定态三者一致则零入队。
          var remDeleted = rem ? !!rem.deleted : false;
          var remVal = rem ? (rem.value === undefined ? null : rem.value) : null;
          var wantDeleted = !!m.deleted || m.value === null || m.value === undefined;
          var remoteDiff = wantDeleted
            ? (rem !== null && !remDeleted)
            : (rem === null || remDeleted || !_deepEq(m.value, remVal));
          merged.push({ key: key, value: m.value, changed: m.changed, deleted: !!m.deleted, push: remoteDiff });
        } catch (e) { /* 单 key 失败不影响其它 key */ }
      }
      // pass 2：被裁局 → 本地删除对应 record 文档（flush 复读即得到 null → 推 tombstone）
      var tombSet = {};
      for (i = 0; i < tombstones.length; i++) {
        tombSet[tombstones[i]] = true;
        try { storage.applyRemote(tombstones[i], 'remove', null); } catch (e) {}
      }
      // pass 3：仅把「本地已回填」或「与远端有差异」的合并结果入队
      //（A4：稳定态本地/远端/合并结果一致时零入队，避免每次冷启动全量 where().update()）。
      for (i = 0; i < merged.length; i++) {
        if (!merged[i].changed && !merged[i].push) continue;
        _addPending(merged[i].key, (merged[i].deleted || merged[i].value === null) ? 'remove' : 'set');
      }
      for (i = 0; i < tombstones.length; i++) {
        if (keys.indexOf(tombstones[i]) < 0) _addPending(tombstones[i], 'remove');
      }
      return flush();                                  // pull → merge → 回填 → push
    })
    .then(function (r) {
      if (_state !== 'error' && _state !== 'denied') _state = r.ok ? 'idle' : 'error';
      if (!r.ok) _lastError = r.reason;
      _persistMeta();
      _persistQueue();
      return r;
    })
    .catch(function (e) {
      _state = 'error';
      _lastError = String((e && e.message) || e);
      return { ok: false, reason: 'error' };
    });
}

// ---------------------------------------------------------------------------
// 状态 / 删除账号数据 / 生命周期
// ---------------------------------------------------------------------------
function status() {
  return {
    state: _state,
    pending: _pending.length,
    lastPullAt: _lastPullAt,
    lastPushAt: _lastPushAt,
    lastError: _lastError,
    cloudEnabled: cloud.isEnabled(),
    privacy: _privacyState()
  };
}

/** 用户主动删除云端数据：全量 tombstone + 清 syncMeta；保留本地业务数据。 */
function requestDeleteAll() {
  if (!cloud.isEnabled()) return Promise.resolve({ ok: false, reason: 'disabled' });
  if (!_canSync()) return Promise.resolve({ ok: false, reason: 'not_authorized' });
  return _pullRemoteEntries().then(function (pull) {
    var keys = pull.ok ? Object.keys(pull.entries) : [];
    var local = _localKeys();
    for (var j = 0; j < local.length; j++) if (keys.indexOf(local[j]) < 0) keys.push(local[j]);
    var tasks = [];
    for (var i = 0; i < keys.length; i++) tasks.push(cloud.markDeleted(keys[i]));
    // v4：删除云端数据也清掉当前用户创建的远程房间（chess_rooms 独立通道）。
    // room 不可用时静默跳过；deleteAllRooms 永远返回已决议 Promise、绝不抛/不 reject，
    // 这里再包一层 catch 兜底，绝不改变 requestDeleteAll 的返回值契约。
    try {
      if (room && typeof room.deleteAllRooms === 'function') {
        tasks.push(Promise.resolve(room.deleteAllRooms()).catch(function () { return null; }));
      }
    } catch (e) {}
    return Promise.all(tasks);
  }).then(function () {
    // A5：末尾物理删 chess_state 用户文档（同步元数据/opId），与「删除后无法恢复」承诺一致。
    return cloud.deleteStateDoc().then(function (dr) {
      _ops = [];
      _stateRev = null;
      _pending = [];
      _persistQueue();
      _lastPullAt = 0;
      _lastPushAt = 0;
      try { storage.applyRemote(KEYS.syncMeta, 'remove', null); } catch (e) {}   // 清 syncMeta
      _state = 'idle';
      if (!dr || !dr.ok) _lastError = 'state_cleanup_failed';
      return { ok: true, reason: 'ok' };
    });
  }).catch(function () { return { ok: false, reason: 'error' }; });
}

/** 注册 storage 写 hook + 读 syncMeta；幂等。由 game.js 在 start() 前间接调用。 */
function init() {
  if (_inited) return;
  _inited = true;
  try { storage.addWriteHook(noteWrite); } catch (e) {}
  _loadMeta();
}

/** 测试用：清内部状态与定时器、清已注册 hook。 */
function reset() {
  if (_timer) { try { clearTimeout(_timer); } catch (e) {} _timer = null; }
  try { storage.clearWriteHooks(); } catch (e) {}
  _inited = false;
  _state = 'idle';
  _pending = [];
  _ops = [];
  _stateRev = null;
  _remoteEntries = {};
  _lastPullAt = 0;
  _lastPushAt = 0;
  _lastError = null;
  _flushPromise = null;
  _opSeq = 0;
}

module.exports = {
  init: init,
  start: start,
  noteWrite: noteWrite,
  clearPending: clearPending,
  flush: flush,
  status: status,
  mergeKey: mergeKey,
  requestDeleteAll: requestDeleteAll,
  reset: reset
};
