/**
 * 持久化存储层（UX §3.3）
 *
 * 约定：微信小游戏持久化只用 wx.setStorageSync / getStorageSync / removeStorageSync。
 * 所有 wx 访问一律 try/catch 包裹；无 wx 环境（如 Node 语法检查/单测）回退内存 Map，绝不在模块加载时崩。
 *
 * 关键策略：
 *  - 读损坏（JSON 解析失败）→ 视为空/默认返回，且「不覆盖坏数据」（读操作绝不写入修复）。
 *  - 索引与记录分离：index.ids 倒序（最新在前），一局一 key，写入量小。
 *  - 上限：50 局；单局 400 半步（超出截断并标 truncated:true）。
 *  - 满额且未开 autoPrune：saveRecord 返回 {ok:false,reason:'full'}，交场景弹 M5 确认，
 *    确认后以 {force:true} 再存。写失败返回 {ok:false,reason:'write_failed'} → 弹 M6。
 *
 * Keys（config.STORAGE_KEYS）：
 *   chess.settings.v1 / chess.tutorial.v1 / chess.config.last.v1 /
 *   chess.records.index.v1 / chess.record.v1.<gameId> / chess.resume.v1 /
 *   chess.endgame.v1（残局闯关存档，下方「残局闯关」小节）
 */
'use strict';

var config = require('../config');
var KEYS = config.STORAGE_KEYS;
var LIMITS = config.LIMITS;
var MAX_RECORDS = LIMITS.maxRecords;   // 50
var MAX_PLIES = LIMITS.maxPlies;       // 400

// 无 wx 时的内存回退（保证 require 与基础调用可运行）
var _mem = {};

// ---- 写入旁路 hook（v3 云端镜像，仅极小增量）----
// _writeHooks     : 同步回调列表，由 sync.init() 反向注册（避免循环依赖）。
// _suppressHooks  : applyRemote 回填时置 true，彻底抑制 hook，防止回环。
// _skipRawHook    : 仅用于 _writeJSON 调用内层 _rawSet 时抑制其 hook，
//                   保证「一次 _writeJSON 恰好触发一次 hook」且回调拿到逻辑对象。
// _emit 对每个 hook 单独 try/catch 吞异常；绝不阻塞、绝不改写入返回值。
var _writeHooks = [];
var _suppressHooks = false;
var _skipRawHook = false;
function _emit(key, op, value) {
  if (_suppressHooks) return;
  var hooks = _writeHooks.slice();
  for (var i = 0; i < hooks.length; i++) {
    try { hooks[i](key, op, value); } catch (e) { /* 单个 hook 异常不影响写入与其它 hook */ }
  }
}

function _hasWx() {
  return (typeof wx !== 'undefined' &&
          typeof wx.getStorageSync === 'function' &&
          typeof wx.setStorageSync === 'function');
}

function _rawGet(key) {
  if (_hasWx()) {
    try { return wx.getStorageSync(key); } catch (e) { return undefined; }
  }
  return _mem[key];
}
function _rawSet(key, val) {
  var ok;
  if (_hasWx()) {
    try { wx.setStorageSync(key, val); ok = true; } catch (e) { ok = false; }
  } else {
    _mem[key] = val;
    ok = true;
  }
  // 本地写成功之后、return 之前触发（_writeJSON 借 _skipRawHook 抑制此处，改由自身触发一次）
  if (ok && !_skipRawHook) _emit(key, 'set', val);
  return ok;
}
function _rawRemove(key) {
  var ok;
  if (_hasWx()) {
    try { wx.removeStorageSync(key); ok = true; } catch (e) { ok = false; }
  } else {
    delete _mem[key];
    ok = true;
  }
  if (ok) _emit(key, 'remove', undefined);
  return ok;
}

/**
 * 读取 JSON。返回 {ok, value, corrupt}。
 * - 缺失/空字符串 → {ok:true, value:null}
 * - 合法字符串 → 解析后返回
 * - 已是对象（部分引擎直存对象）→ 直接返回
 * - JSON 解析失败 → {ok:false, corrupt:true, value:null}（调用方按需用默认值，不覆盖坏数据）
 */
function _readJSON(key) {
  var v = _rawGet(key);
  if (v === '' || v === undefined || v === null) return { ok: true, value: null, corrupt: false };
  if (typeof v === 'object') return { ok: true, value: v, corrupt: false };
  if (typeof v === 'string') {
    try { return { ok: true, value: JSON.parse(v), corrupt: false }; }
    catch (e) { return { ok: false, value: null, corrupt: true }; }
  }
  return { ok: false, value: null, corrupt: true };
}

/** 写入 JSON（统一 stringify，避免跨引擎对象/字符串不一致） */
function _writeJSON(key, obj) {
  var str;
  try { str = JSON.stringify(obj); } catch (e) { return false; }
  // 抑制内层 _rawSet 的 hook，改在此处以「逻辑对象 obj」触发恰好一次
  var prev = _skipRawHook;
  _skipRawHook = true;
  var ok;
  try { ok = _rawSet(key, str); } catch (e) { ok = false; }
  finally { _skipRawHook = prev; }
  if (ok) _emit(key, 'set', obj);
  return ok;
}

function _clone(o) {
  if (!o || typeof o !== 'object') return o;
  return JSON.parse(JSON.stringify(o));
}
function _merge(base, extra) {
  var out = _clone(base) || {};
  if (extra && typeof extra === 'object') {
    for (var k in extra) {
      if (Object.prototype.hasOwnProperty.call(extra, k)) out[k] = extra[k];
    }
  }
  return out;
}
function _genId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

// ---------------------------------------------------------------------------
// 设置 / 教学进度 / 上次配置
// ---------------------------------------------------------------------------
function getSettings() {
  var r = _readJSON(KEYS.settings);
  if (r.ok && r.value && typeof r.value === 'object') {
    return _merge(config.DEFAULT_SETTINGS, r.value);
  }
  // 缺失或损坏：返回默认副本（不写回，保护坏数据）
  return _clone(config.DEFAULT_SETTINGS);
}
function saveSettings(settings) {
  var merged = _merge(config.DEFAULT_SETTINGS, settings);
  merged.version = 1;
  if (!merged.updatedAt) merged.updatedAt = Date.now();   // A2：LWW 时间戳（缺才补，尊重显式传入）
  return { ok: _writeJSON(KEYS.settings, merged) };
}

var DEFAULT_TUTORIAL = { version: 1, completed: [], lastLesson: 0, updatedAt: 0 };
function getTutorialProgress() {
  var r = _readJSON(KEYS.tutorial);
  if (r.ok && r.value && typeof r.value === 'object' && Array.isArray(r.value.completed)) {
    return _merge(DEFAULT_TUTORIAL, r.value);
  }
  return _clone(DEFAULT_TUTORIAL);
}
function saveTutorialProgress(progress) {
  var merged = _merge(DEFAULT_TUTORIAL, progress);
  merged.version = 1;
  merged.updatedAt = Date.now();
  return { ok: _writeJSON(KEYS.tutorial, merged) };
}

var DEFAULT_CONFIG = { difficulty: 'medium', color: 'w' };
/**
 * 读取上次对局配置（第二轮审查 P0-03）。
 *
 * 语义修正：此前无存档也返回 {difficulty:'medium', color:'w'}，导致
 * settings.defaultColor（设置页「初始执棋色」）永远被这个假记录的 color:'w' 覆盖，
 * 用户把默认值改成执黑后首次进入开局设置仍显示执白。
 *
 * 现在：**无任何存档 / 存档损坏时返回 null**，由调用方回落到真正的默认值
 * （GameContext.getSettings().defaultColor）；有存档时仍合并 DEFAULT_CONFIG 补齐旧存档缺字段
 * （例如旧版没有 style 字段，快速开局按 standard 兜底）。
 */
function getLastConfig() {
  var r = _readJSON(KEYS.lastConfig);
  if (r.ok && r.value && typeof r.value === 'object') {
    return _merge(DEFAULT_CONFIG, r.value);
  }
  return null;
}
function saveLastConfig(cfg) {
  var merged = _merge(DEFAULT_CONFIG, cfg);
  if (!merged.updatedAt) merged.updatedAt = Date.now();   // A2：LWW 时间戳（缺才补）
  return { ok: _writeJSON(KEYS.lastConfig, merged) };
}

// ---------------------------------------------------------------------------
// 棋谱：索引 + 记录
// ---------------------------------------------------------------------------
/** 摘要字段（列表页用，倒序） */
function _toSummary(rec) {
  return {
    id: rec.id,
    version: rec.version || 1,
    mode: rec.mode || null,
    difficulty: rec.difficulty || null,
    playerColor: rec.playerColor || null,
    opponent: rec.opponent || null,
    result: rec.result || null,
    outcome: rec.outcome || null,
    startedAt: rec.startedAt || null,
    endedAt: rec.endedAt || null,
    durationMs: rec.durationMs || null,
    plies: rec.plies || (Array.isArray(rec.movesUci) ? rec.movesUci.length : 0),
    fullMoves: rec.fullMoves || null,
    truncated: !!rec.truncated,
    createdAt: rec.createdAt || null,
    updatedAt: rec.updatedAt || null
  };
}

function _readIndex() {
  var r = _readJSON(KEYS.recordsIndex);
  if (r.ok && r.value && typeof r.value === 'object' && Array.isArray(r.value.ids)) {
    return { index: r.value, corrupt: false };
  }
  // 缺失或损坏 → 视为空索引；corrupt 标记供 saveRecord 决定是否重建 + Banner
  return { index: { version: 1, ids: [], updatedAt: 0 }, corrupt: !r.ok };
}

/** 列表摘要数组（倒序，index.ids 已按最新在前维护）；跳过记录 key 缺失项 */
function listRecords() {
  var ri = _readIndex();
  var out = [];
  for (var i = 0; i < ri.index.ids.length; i++) {
    var id = ri.index.ids[i];
    var rr = _readJSON(KEYS.recordPrefix + id);
    if (rr.ok && rr.value && typeof rr.value === 'object') {
      out.push(_toSummary(rr.value));
    }
    // 缺失/损坏项跳过（不在此处删索引，遵循「读不覆盖坏数据」）
  }
  return out;
}

function getRecord(gameId) {
  if (!gameId) return null;
  var r = _readJSON(KEYS.recordPrefix + gameId);
  if (r.ok && r.value && typeof r.value === 'object') return r.value;
  return null;
}

/**
 * 保存记录（按 id 新增或覆盖）。
 * @param {object} record
 * @param {object} opts {force:boolean} 满额确认后 force=true 覆盖最早
 * @returns {{ok, id?, rebuilt?, truncated?, pruned?, reason?}}
 */
function saveRecord(record, opts) {
  opts = opts || {};
  if (!record || typeof record !== 'object') return { ok: false, reason: 'invalid' };

  var rec = _clone(record);
  rec.version = 1;
  if (!rec.id) rec.id = _genId();
  var now = Date.now();
  rec.updatedAt = now;
  if (!rec.createdAt) rec.createdAt = now;

  // 单局 400 半步上限：超出截断并标记
  var truncated = false;
  if (Array.isArray(rec.movesUci) && rec.movesUci.length > MAX_PLIES) {
    rec.movesUci = rec.movesUci.slice(0, MAX_PLIES);
    truncated = true;
  }
  if (Array.isArray(rec.sanLog) && rec.sanLog.length > MAX_PLIES) {
    rec.sanLog = rec.sanLog.slice(0, MAX_PLIES);
    truncated = true;
  }
  if (truncated) rec.truncated = true;

  var ri = _readIndex();
  var index = ri.index;
  var rebuilt = ri.corrupt;               // 索引损坏 → 本次写入重建
  var exists = index.ids.indexOf(rec.id) >= 0;
  var pruned = false;

  // 满额处理：仅「新增」时可能触发
  if (!exists && index.ids.length >= MAX_RECORDS) {
    var settings = getSettings();
    if (!settings.autoPrune && !opts.force) {
      // 交场景层二次确认（M5）；确认后 saveRecord(rec,{force:true})
      return { ok: false, reason: 'full', id: rec.id };
    }
    var oldest = index.ids[index.ids.length - 1];
    if (oldest) {
      _rawRemove(KEYS.recordPrefix + oldest);
      index.ids.pop();
      pruned = true;
    }
  }

  if (exists) {
    // 覆盖：移到最前（最近更新在前），不新增列表项
    var at = index.ids.indexOf(rec.id);
    if (at > 0) { index.ids.splice(at, 1); index.ids.unshift(rec.id); }
  } else {
    index.ids.unshift(rec.id); // 新增置顶（最新在前）
  }
  index.version = 1;
  index.updatedAt = now;

  var wroteRec = _writeJSON(KEYS.recordPrefix + rec.id, rec);
  var wroteIdx = _writeJSON(KEYS.recordsIndex, index);

  if (!wroteRec || !wroteIdx) {
    return { ok: false, reason: 'write_failed', id: rec.id, rebuilt: rebuilt };
  }
  return {
    ok: true,
    id: rec.id,
    rebuilt: rebuilt,      // 场景可据此提示「检测到旧数据异常，已重建索引」
    pruned: pruned,        // 场景可据此提示「已清理最早一局」
    truncated: truncated
  };
}

function deleteRecord(gameId) {
  if (!gameId) return { ok: false, reason: 'invalid' };
  var ri = _readIndex();
  var index = ri.index;
  var i = index.ids.indexOf(gameId);
  if (i >= 0) index.ids.splice(i, 1);
  _rawRemove(KEYS.recordPrefix + gameId);   // key 不存在也视为成功（降级）
  index.version = 1;
  index.updatedAt = Date.now();
  return { ok: _writeJSON(KEYS.recordsIndex, index) };
}

function clearAllRecords() {
  var ri = _readIndex();
  for (var i = 0; i < ri.index.ids.length; i++) {
    _rawRemove(KEYS.recordPrefix + ri.index.ids[i]);
  }
  return {
    ok: _writeJSON(KEYS.recordsIndex, { version: 1, ids: [], updatedAt: Date.now() })
  };
}

// ---------------------------------------------------------------------------
// 断点恢复（P1）
// ---------------------------------------------------------------------------
function saveResume(data) {
  if (!data || typeof data !== 'object') return { ok: false, reason: 'invalid' };
  var snap = _clone(data);
  snap.savedAt = Date.now();
  if (!snap.updatedAt) snap.updatedAt = Date.now();       // A2：LWW 时间戳（缺才补）
  return { ok: _writeJSON(KEYS.resume, snap) };
}
function getResume() {
  var r = _readJSON(KEYS.resume);
  if (r.ok && r.value && typeof r.value === 'object') return r.value;
  return null;
}
function clearResume() {
  return { ok: _rawRemove(KEYS.resume) };
}

// ---------------------------------------------------------------------------
// 残局闯关存档（chess.endgame.v1）
// ---------------------------------------------------------------------------
// 数据结构（DEFAULT_ENDGAME，权威规格 V2_UX_SPEC §1.8）：
//   { version: 1,
//     unlockedLevel: 1,        // 已解锁到第几阵（1-based 数字）
//     cleared: {},             // 每阵最佳成绩 { '1': {stars,bestTimeMs,bestMoves,rewarded} }
//     skills: [],              // 随身技能库(≤8) [{id:'skill_mirror', charges:2}]
//     tipsCollected: [],       // 妙招图鉴（去重）
//     pendingHints: 0,         // 库存溢出转化的提示数（下次入场生效）
//     stats: { totalAttempts: 0, totalClears: 0 },
//     updatedAt: 0
//   }
// 提示/悔棋次数不入库（每阵重置，属会话态）。技能 id 全名 7 种：
//   skill_hourglass / skill_mirror / skill_undo（普通）、
//   skill_scout / skill_freeze（稀有）、skill_master / skill_ward（史诗）。
// 语义：loadEndgame() 返回的结构即「当前活对象」——增减类 API 在其上原地修改
// 并立即写回存储（write-through）；显式 saveEndgame(data) 用于整体落盘。
// 任何写入自动更新 updatedAt = Date.now()。
// 读损坏沿用「读不覆盖坏数据」策略：返回默认结构，不写回修复。

var DEFAULT_ENDGAME = {
  version: 1,
  unlockedLevel: 1,
  cleared: {},
  skills: [],
  tipsCollected: [],
  pendingHints: 0,
  stats: { totalAttempts: 0, totalClears: 0 },
  updatedAt: 0
};

// 稀有度（0 普通 / 1 稀有 / 2 史诗）与规范表顺序，用于库存溢出时挑「最普通的一个」
var SKILL_RARITY = {
  skill_hourglass: 0, skill_mirror: 0, skill_undo: 0,
  skill_scout: 1, skill_freeze: 1,
  skill_master: 2, skill_ward: 2
};
var SKILL_RANK = {
  skill_hourglass: 0, skill_mirror: 1, skill_undo: 2,
  skill_scout: 3, skill_freeze: 4, skill_master: 5, skill_ward: 6
};

var _endgame = null; // 活对象缓存（loadEndgame 同引用返回，保证「读-改-存」往返一致）

function _posInt(v) {
  var n = Math.floor(Number(v));
  return isFinite(n) && n > 0 ? n : 0;
}

function _normalizeEndgame(raw) {
  var out = _clone(DEFAULT_ENDGAME);
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    var ul = Math.floor(Number(raw.unlockedLevel));
    if (isFinite(ul) && ul >= 1) out.unlockedLevel = ul;

    if (raw.cleared && typeof raw.cleared === 'object' && !Array.isArray(raw.cleared)) {
      for (var ck in raw.cleared) {
        if (!Object.prototype.hasOwnProperty.call(raw.cleared, ck)) continue;
        var ce = raw.cleared[ck];
        if (!ce || typeof ce !== 'object') continue;
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
        if (!it || typeof it !== 'object' || typeof it.id !== 'string' || !it.id) continue;
        var ch = Math.floor(Number(it.charges));
        if (!isFinite(ch) || ch < 0) ch = 0;
        if (seen[it.id] !== undefined) {
          out.skills[seen[it.id]].charges += ch;
        } else {
          seen[it.id] = out.skills.length;
          out.skills.push({ id: it.id, charges: ch });
        }
      }
    }

    if (Array.isArray(raw.tipsCollected)) {
      var tips = {};
      for (var t = 0; t < raw.tipsCollected.length; t++) {
        var tip = raw.tipsCollected[t];
        if (typeof tip === 'string' && tip && !tips[tip]) {
          tips[tip] = true;
          out.tipsCollected.push(tip);
        }
      }
    }

    var ph = Math.floor(Number(raw.pendingHints));
    if (isFinite(ph) && ph > 0) out.pendingHints = ph;

    if (raw.stats && typeof raw.stats === 'object' && !Array.isArray(raw.stats)) {
      out.stats.totalAttempts = _posInt(raw.stats.totalAttempts);
      out.stats.totalClears = _posInt(raw.stats.totalClears);
    }

    var up = Number(raw.updatedAt);
    if (isFinite(up) && up > 0) out.updatedAt = up;
  }
  out.version = 1;
  return out;
}

/** 把 src 的字段值覆盖进 dst（保持 dst 引用不变，供活对象更新） */
function _copyIntoEndgame(dst, src) {
  dst.version = 1;
  dst.unlockedLevel = src.unlockedLevel;
  dst.cleared = src.cleared;
  dst.skills = src.skills;
  dst.tipsCollected = src.tipsCollected;
  dst.pendingHints = src.pendingHints;
  dst.stats = src.stats;
  dst.updatedAt = src.updatedAt;
  return dst;
}

/** 写回存储（自动更新 updatedAt） */
function _persistEndgame() {
  _endgame.updatedAt = Date.now();
  return _writeJSON(KEYS.endgame, _endgame);
}

function _findSkill(eg, id) {
  for (var i = 0; i < eg.skills.length; i++) {
    if (eg.skills[i].id === id) return eg.skills[i];
  }
  return null;
}

/** 「普通程度」排序键：稀有度升序 → charges 升序 → 规范表顺序；未知 id 视为最特殊 */
function _skillOrderness(entry) {
  var r = SKILL_RARITY[entry.id];
  if (r === undefined) r = 99;
  var rank = SKILL_RANK[entry.id];
  if (rank === undefined) rank = 99;
  return r * 1e6 + Math.max(0, entry.charges) * 1e3 + rank;
}

/** 库存上限 8：超出时把「最普通的一个」转为 pendingHints+1 并从数组移除 */
function _trimSkills(eg) {
  while (eg.skills.length > 8) {
    var idx = 0;
    for (var i = 1; i < eg.skills.length; i++) {
      if (_skillOrderness(eg.skills[i]) < _skillOrderness(eg.skills[idx])) idx = i;
    }
    eg.skills.splice(idx, 1);
    eg.pendingHints += 1;
  }
}

/** 读取残局存档完整结构（缺失/损坏返回默认值）。返回活对象（同引用）。 */
function loadEndgame() {
  var r = _readJSON(KEYS.endgame);
  var fresh = _normalizeEndgame(r.ok ? r.value : null);
  if (!_endgame) {
    _endgame = fresh;
  } else {
    _copyIntoEndgame(_endgame, fresh);
  }
  return _endgame;
}

/** 整体保存残局存档（自动更新 updatedAt） */
function saveEndgame(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return { ok: false, reason: 'invalid' };
  var merged = _normalizeEndgame(data);
  merged.updatedAt = Date.now();
  var ok = _writeJSON(KEYS.endgame, merged);
  if (_endgame) _copyIntoEndgame(_endgame, merged);
  else _endgame = merged;
  return { ok: ok };
}

/**
 * 技能 charges 增加 n（省略 n 视为 +1；负数即扣减，结果钳到 ≥0，归零移除条目）。
 * 同 id 聚合到同一条目；超过 8 条时最普通的一个转 pendingHints+1 并移除。
 * @returns {number} 该技能新 charges（入参非法返回 false）
 */
function addSkill(id, n) {
  if (typeof id !== 'string' || !id) return false;
  if (typeof n !== 'number' || !isFinite(n)) n = 1;
  var eg = loadEndgame();
  var entry = _findSkill(eg, id);
  if (!entry) {
    entry = { id: id, charges: 0 };
    eg.skills.push(entry);
  }
  entry.charges = Math.max(0, entry.charges + Math.floor(n));
  if (entry.charges < 1) {
    var at = eg.skills.indexOf(entry);
    if (at >= 0) eg.skills.splice(at, 1);
    _persistEndgame();
    return 0;
  }
  _trimSkills(eg);
  _persistEndgame();
  return entry.charges;
}

/**
 * 消耗 1 charges。无条目或不足返回 false（不改动存档）；归零后条目移除。
 * @returns {boolean} 是否消耗成功
 */
function useSkill(id) {
  if (typeof id !== 'string' || !id) return false;
  var eg = loadEndgame();
  var entry = _findSkill(eg, id);
  if (!entry || entry.charges < 1) return false;
  entry.charges -= 1;
  if (entry.charges < 1) {
    var at = eg.skills.indexOf(entry);
    if (at >= 0) eg.skills.splice(at, 1);
  }
  _persistEndgame();
  return true;
}

/**
 * 解锁到第 n 阵：unlockedLevel = max(unlockedLevel, n)。
 * @returns {number} 新 unlockedLevel（入参非法返回 false）
 */
function unlockLevel(n) {
  var v = Math.floor(Number(n));
  if (!isFinite(v) || v < 1) return false;
  var eg = loadEndgame();
  if (v > eg.unlockedLevel) eg.unlockedLevel = v;
  _persistEndgame();
  return eg.unlockedLevel;
}

/**
 * 记录第 n 阵最佳成绩。
 * result：{stars(0-3), bestTimeMs(更小更新), bestMoves(更小更新), rewarded(置真保持)}。
 * @returns {boolean} 是否调用有效
 */
function setCleared(n, result) {
  var num = Math.floor(Number(n));
  if (!isFinite(num) || num < 1 || !result || typeof result !== 'object') return false;
  var eg = loadEndgame();
  var key = String(num);
  var old = eg.cleared[key] || { stars: 0, bestTimeMs: 0, bestMoves: 0, rewarded: false };
  var stars = Math.floor(Number(result.stars));
  var time = Number(result.bestTimeMs);
  var moves = Math.floor(Number(result.bestMoves));
  eg.cleared[key] = {
    stars: Math.max(old.stars, isFinite(stars) ? Math.max(0, Math.min(3, stars)) : 0),
    bestTimeMs: (function () {
      if (!isFinite(time) || time <= 0) return old.bestTimeMs;
      return old.bestTimeMs > 0 ? Math.min(old.bestTimeMs, time) : time;
    })(),
    bestMoves: (function () {
      if (!isFinite(moves) || moves <= 0) return old.bestMoves;
      return old.bestMoves > 0 ? Math.min(old.bestMoves, moves) : moves;
    })(),
    rewarded: old.rewarded || !!result.rewarded
  };
  _persistEndgame();
  return true;
}

/** 妙招图鉴收录（去重）。@returns {boolean} 是否新收录 */
function collectTip(tipId) {
  if (typeof tipId !== 'string' || !tipId) return false;
  var eg = loadEndgame();
  if (eg.tipsCollected.indexOf(tipId) >= 0) return false;
  eg.tipsCollected.push(tipId);
  _persistEndgame();
  return true;
}

/**
 * pendingHints 增加 n（省略 n 视为 +1；负数即扣减，结果钳到 ≥0）。
 * @returns {number} 新 pendingHints
 */
function addPendingHints(n) {
  if (typeof n !== 'number' || !isFinite(n)) n = 1;
  var eg = loadEndgame();
  eg.pendingHints = Math.max(0, eg.pendingHints + Math.floor(n));
  _persistEndgame();
  return eg.pendingHints;
}

/**
 * 消耗 pendingHints n 个（省略 n 视为 1）。不足返回 false（不改动存档）。
 * @returns {boolean} 是否消耗成功
 */
function consumePendingHints(n) {
  if (n === undefined || n === null) n = 1;
  if (typeof n !== 'number' || !isFinite(n) || n < 1) return false;
  var need = Math.floor(n);
  var eg = loadEndgame();
  if (eg.pendingHints < need) return false;
  eg.pendingHints -= need;
  _persistEndgame();
  return true;
}

/** stats.totalAttempts +1。@returns {number} 新值 */
function recordAttempt() {
  var eg = loadEndgame();
  eg.stats.totalAttempts += 1;
  _persistEndgame();
  return eg.stats.totalAttempts;
}

/** stats.totalClears +1。@returns {number} 新值 */
function recordClear() {
  var eg = loadEndgame();
  eg.stats.totalClears += 1;
  _persistEndgame();
  return eg.stats.totalClears;
}

// ---------------------------------------------------------------------------
// 写入旁路 hook（v3 云端镜像，仅极小增量；28 个既有 API 语义一字不改）
// ---------------------------------------------------------------------------
/** 注册写 hook。由 sync.init() 反向注册，storage 不 require cloud/sync（避免循环依赖）。 */
function addWriteHook(fn) {
  if (typeof fn === 'function') _writeHooks.push(fn);
}
/** 清空全部写 hook（测试用）。 */
function clearWriteHooks() {
  _writeHooks = [];
}
/**
 * 云端回填专用本地写：在 _suppressHooks=true 下执行，绝不触发任何 hook，防回环。
 *  - set  → 非残局走 _writeJSON；残局走 saveEndgame 以刷新 _endgame 活对象同引用。
 *  - remove → _rawRemove；残局同时清空活对象，避免下次 loadEndgame 读到陈旧引用。
 * value 为 null/undefined 的 set 一律按 remove 处理。
 */
function applyRemote(key, op, value) {
  var prev = _suppressHooks;
  _suppressHooks = true;
  var result = false;
  try {
    if (op === 'remove' || value === null || value === undefined) {
      result = _rawRemove(key);
      if (key === KEYS.endgame) _endgame = null;
    } else if (key === KEYS.endgame) {
      if (typeof value === 'object' && !Array.isArray(value)) {
        var r = saveEndgame(value);
        result = !!(r && r.ok);
      } else {
        result = _rawRemove(key);
        _endgame = null;
      }
    } else {
      result = _writeJSON(key, value);
    }
  } catch (e) {
    result = false;
  } finally {
    _suppressHooks = prev;
  }
  return result;
}

module.exports = {
  getSettings: getSettings,
  saveSettings: saveSettings,
  getTutorialProgress: getTutorialProgress,
  saveTutorialProgress: saveTutorialProgress,
  getLastConfig: getLastConfig,
  saveLastConfig: saveLastConfig,
  listRecords: listRecords,
  getRecord: getRecord,
  saveRecord: saveRecord,
  deleteRecord: deleteRecord,
  clearAllRecords: clearAllRecords,
  saveResume: saveResume,
  getResume: getResume,
  clearResume: clearResume,
  // 残局闯关存档（chess.endgame.v1，V2_UX_SPEC §1.8）
  loadEndgame: loadEndgame,
  saveEndgame: saveEndgame,
  addSkill: addSkill,
  useSkill: useSkill,
  unlockLevel: unlockLevel,
  setCleared: setCleared,
  collectTip: collectTip,
  addPendingHints: addPendingHints,
  consumePendingHints: consumePendingHints,
  recordAttempt: recordAttempt,
  recordClear: recordClear,
  // 内部工具导出（供测试/诊断，非场景必用）
  _readJSON: _readJSON,
  _writeJSON: _writeJSON,
  _rawRemove: _rawRemove,
  // v3 写入旁路 hook（云端镜像；28 个既有导出签名/返回/同步语义一字不改）
  addWriteHook: addWriteHook,
  clearWriteHooks: clearWriteHooks,
  applyRemote: applyRemote
};
