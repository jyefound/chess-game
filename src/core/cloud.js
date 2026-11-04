/**
 * 云端 KV 镜像 · 前端直连层（v3）
 *
 * 技术选型（主理人拍板）：云开发 database() 前端直连 + 集合安全规则，零云函数、零 npm。
 *  _openid 由平台自动注入且不可伪造，安全规则在服务端强制隔离；私有通道无需 request
 *  合法域名 / 备案 / TLS 证书。所有查询 where 必带 _openid:'{openid}'。
 *
 * 铁律：
 *  - 顶层不得在 require 时触碰云能力 SDK，能力探测后惰性 init（Node 回归无该 SDK 全绿）。
 *  - 所有异步方法在「不可用」时返回已决议的 {ok:false, reason:'unavailable'}；
 *    绝不抛异常、绝不返回 rejected Promise（每条链末端都有 .catch）。
 *  - 禁止 doc().set()（安全规则下会失败）；创建走 collection.add()，更新一律 where().update()。
 *  - 丢弃客户端传入的 _openid / _id；key 白名单、值消毒、拒绝云指令对象、字节上限；
 *    updatedAt 用 db.serverDate()（服务端时间），不用客户端时间。
 *  - 前端 get 一次 20 条上限 → 必须分页。写入前检查 maxValueBytes / maxBatchBytes。
 *
 * 集合模型（与 sync.js 约定一致）：
 *  chess_records : 每「本地 storage key」一个文档 = {_openid, key, value, rev, updatedAt,
 *                  deleted, schemaVersion}；rev 单调整数，CAS = where({_openid,key,rev}).update()。
 *  chess_state   : 每用户一个文档 = {_openid, rev, updatedAt, schemaVersion, keys:{...}}；
 *                  keys.ops 存已处理 opId（键名不含点号，见 sync.js）。CAS = where({_openid,rev}).update()。
 */
'use strict';

var config = require('../config');
var CLOUD = config.CLOUD_CONFIG;

// 内部惰性状态 —— 均为普通变量声明，顶层绝不触碰云能力 SDK
var _db = null;        // 缓存 database() 实例
var _inited = false;   // 云能力 init 是否已调用（幂等）

var KEY_RE = /^chess\.[a-z.]+\.v1(\.[A-Za-z0-9_-]+)?$/;
function hasOwn(o, k) { return Object.prototype.hasOwnProperty.call(o, k); }

// ---------------------------------------------------------------------------
// 能力探测 / 初始化
// ---------------------------------------------------------------------------
function hasCloud() {
  return (typeof wx !== 'undefined' && !!wx.cloud && typeof wx.cloud.init === 'function');
}

function isEnabled() {
  return !!(CLOUD.enabled && CLOUD.env && hasCloud());
}

/** 调用云能力 init({env, traceUser:false})；幂等；可重复调用；绝不抛。 */
function init(opts) {
  if (!hasCloud()) return { ok: false, reason: 'unavailable' };
  if (_inited) return { ok: true, reason: 'already' };
  var env = (opts && typeof opts.env === 'string' && opts.env) ? opts.env : CLOUD.env;
  try {
    wx.cloud.init({ env: env, traceUser: false });
    _inited = true;
    return { ok: true, reason: 'ok' };
  } catch (e) {
    return { ok: false, reason: 'init_failed' };
  }
}

/** 惰性就绪：确保 init 完成且拿到 db；任何异常都吞掉并返回 false。 */
function _ready() {
  if (!isEnabled()) return false;
  try {
    if (!_inited) {
      var r = init();
      if (!r.ok) return false;
    }
    if (!_db) _db = wx.cloud.database();
    return !!_db;
  } catch (e) {
    return false;
  }
}

function _dbOrNull() {
  return _ready() ? _db : null;
}

/** 不可用时统一返回「已决议」对象（精确 shape，绝不含 data/items 等额外键）。 */
function _fail() {
  return Promise.resolve({ ok: false, reason: 'unavailable' });
}

function _errReason(e) {
  var s = '';
  try { s = String((e && (e.errMsg || e.message || e.errCode)) || ''); } catch (x) {}
  if (/timeout/i.test(s)) return 'timeout';
  if (/permission|denied|auth|forbidden/i.test(s)) return 'denied';
  if (/network|offline|fail/i.test(s)) return 'network';
  return 'error';
}

// ---------------------------------------------------------------------------
// 值消毒 / 字节上限 / key 白名单
// ---------------------------------------------------------------------------
/** UTF-8 字节长度（小游戏无 Buffer，手写计数）。 */
function _byteLen(s) {
  var n = 0;
  for (var i = 0; i < s.length; i++) {
    var c = s.charCodeAt(i);
    if (c < 0x80) n += 1;
    else if (c < 0x800) n += 2;
    else if (c >= 0xD800 && c <= 0xDBFF && i + 1 < s.length) { n += 4; i++; }
    else n += 3;
  }
  return n;
}

/** key 白名单：chess.<lower/dot>.v1[.<id>]，且总长 ≤128（两段无长度上限的兜底）。 */
function _validKey(key) {
  return typeof key === 'string' && key.length <= 128 && KEY_RE.test(key);
}

/**
 * 深度净化：产出干净副本。
 *  - 丢弃 _openid / _id / $ 前缀键（客户端注入 / 疑似指令键）。
 *  - 拒绝非普通对象（Date / RegExp / 云指令对象 _.gt() 等自定义原型实例）、
 *    function / undefined / symbol / NaN / Infinity。
 *  - 拒绝过深嵌套（防环 / 爆栈）。
 */
function _clean(v, depth) {
  if (v === null) return { ok: true, value: null };
  if (depth > 24) return { ok: false };
  var t = typeof v;
  if (t === 'string' || t === 'boolean') return { ok: true, value: v };
  if (t === 'number') return isFinite(v) ? { ok: true, value: v } : { ok: false };
  if (t !== 'object') return { ok: false };
  var proto;
  try { proto = Object.getPrototypeOf(v); } catch (e) { return { ok: false }; }
  if (Array.isArray(v)) {
    var arr = [];
    for (var i = 0; i < v.length; i++) {
      var c = _clean(v[i], depth + 1);
      if (!c.ok) return { ok: false };
      arr.push(c.value);
    }
    return { ok: true, value: arr };
  }
  if (proto !== Object.prototype && proto !== null) return { ok: false };
  var out = {};
  for (var k in v) {
    if (!hasOwn(v, k)) continue;
    if (k === '_openid' || k === '_id' || k.charAt(0) === '$') continue;
    var cc = _clean(v[k], depth + 1);
    if (!cc.ok) return { ok: false };
    out[k] = cc.value;
  }
  return { ok: true, value: out };
}

function _sanitizeValue(value) {
  var c = _clean(value, 0);
  if (!c.ok) return { ok: false, reason: 'invalid_value' };
  var str;
  try { str = JSON.stringify(c.value); } catch (e) { return { ok: false, reason: 'invalid_value' }; }
  if (typeof str !== 'string') return { ok: false, reason: 'invalid_value' };
  if (_byteLen(str) > CLOUD.maxValueBytes) return { ok: false, reason: 'too_large' };
  return { ok: true, value: c.value, reason: 'ok' };
}

function _sanitizePatch(patch) {
  var c = _clean(patch, 0);
  if (!c.ok) return null;
  var str;
  try { str = JSON.stringify(c.value); } catch (e) { return null; }
  if (_byteLen(str) > CLOUD.maxBatchBytes) return null;
  return c.value;
}

/** 服务端时间；绝不回退到客户端时间（mock 无 serverDate 时返回 null，写入仍成功）。 */
function _sd(db) {
  try { return db.serverDate(); } catch (e) { return null; }
}

function serverDate() {
  var db = _dbOrNull();
  if (!db) return null;
  try { return db.serverDate(); } catch (e) { return null; }
}

// ---------------------------------------------------------------------------
// chess_state（单文档：sync 元数据 / 已处理 opId），doc 级 rev CAS
// ---------------------------------------------------------------------------
function getStateDoc() {
  var db = _dbOrNull();
  if (!db) return _fail();
  return Promise.resolve().then(function () {
    var col = db.collection(CLOUD.collections.state);
    return col.where({ _openid: '{openid}' }).limit(1).get();
  }).then(function (res) {
    var data = (res && res.data && res.data.length) ? res.data[0] : null;
    return { ok: true, data: data, reason: 'ok' };
  }).catch(function (e) {
    return { ok: false, data: null, reason: _errReason(e) };
  });
}

function putStateDoc(patch, expectedRev) {
  var db = _dbOrNull();
  if (!db) return _fail();
  var p = _sanitizePatch(patch);
  if (!p) return Promise.resolve({ ok: false, data: null, reason: 'invalid_patch', updated: 0 });
  return Promise.resolve().then(function () {
    var col = db.collection(CLOUD.collections.state);
    p.updatedAt = _sd(db);
    p.schemaVersion = CLOUD.schemaVersion;
    if (typeof expectedRev === 'number' && isFinite(expectedRev) && expectedRev >= 0) {
      p.rev = expectedRev + 1;
      return col.where({ _openid: '{openid}', rev: expectedRev }).update({ data: p })
        .then(function (r) {
          var up = (r && r.stats) ? r.stats.updated : 0;
          return { ok: true, data: p, reason: 'ok', updated: up };
        });
    }
    p.rev = 1;
    return col.add({ data: p }).then(function () {
      return { ok: true, data: p, reason: 'ok', updated: 1 };
    });
  }).catch(function (e) {
    return { ok: false, data: null, reason: _errReason(e), updated: 0 };
  });
}

// ---------------------------------------------------------------------------
// chess_records（每 key 一文档，KV 镜像），per-key rev CAS + 分页
// ---------------------------------------------------------------------------
function listRecords() {
  var db = _dbOrNull();
  if (!db) return _fail();
  var PAGE = 20;
  return Promise.resolve().then(function () {
    var col = db.collection(CLOUD.collections.records);
    var all = [];
    function page(skip) {
      return col.where({ _openid: '{openid}' }).skip(skip).limit(PAGE).get()
        .then(function (res) {
          var batch = (res && res.data) ? res.data : [];
          for (var i = 0; i < batch.length; i++) all.push(batch[i]);
          if (batch.length === PAGE) return page(skip + PAGE);
          return { ok: true, items: all, reason: 'ok' };
        });
    }
    return page(0);
  }).catch(function (e) {
    return { ok: false, items: [], reason: _errReason(e) };
  });
}

function putRecord(key, value, rev, deleted) {
  var db = _dbOrNull();
  if (!db) return _fail();
  if (!_validKey(key)) return Promise.resolve({ ok: false, reason: 'invalid_key', updated: 0 });
  var sv = _sanitizeValue(value);
  if (!sv.ok) return Promise.resolve({ ok: false, reason: sv.reason, updated: 0 });
  return Promise.resolve().then(function () {
    var col = db.collection(CLOUD.collections.records);
    var entry = {
      key: key,
      value: sv.value,
      updatedAt: _sd(db),
      deleted: !!deleted,
      schemaVersion: CLOUD.schemaVersion
    };
    if (typeof rev === 'number' && isFinite(rev) && rev >= 0) {
      entry.rev = rev + 1;
      return col.where({ _openid: '{openid}', key: key, rev: rev }).update({ data: entry })
        .then(function (r) {
          var up = (r && r.stats) ? r.stats.updated : 0;
          return { ok: true, reason: 'ok', updated: up };
        });
    }
    entry.rev = 1;
    return col.add({ data: entry }).then(function () {
      return { ok: true, reason: 'ok', updated: 1 };
    });
  }).catch(function (e) {
    return { ok: false, reason: _errReason(e), updated: 0 };
  });
}

/** tombstone：标记 deleted，不物理删（先读当前 rev 再 CAS 写）。 */
function markDeleted(key) {
  var db = _dbOrNull();
  if (!db) return _fail();
  if (!_validKey(key)) return Promise.resolve({ ok: false, reason: 'invalid_key' });
  return Promise.resolve().then(function () {
    var col = db.collection(CLOUD.collections.records);
    return col.where({ _openid: '{openid}', key: key }).limit(1).get();
  }).then(function (res) {
    var doc = (res && res.data && res.data.length) ? res.data[0] : null;
    // A5：tombstone 绝不携带明文（与 sync.js flush 删除路径 value=null 一致）；
    // 否则「删除云端数据」后云端仍残留昵称/棋谱/设置等完整明文。
    if (doc) return putRecord(key, null, doc.rev, true);
    return putRecord(key, null, null, true);   // 不存在则新建 tombstone
  }).then(function (r) {
    return { ok: !!r.ok, reason: r.reason };
  }).catch(function (e) {
    return { ok: false, reason: _errReason(e) };
  });
}

/** 物理删除：仅 GC / 用户主动删除账号数据。 */
function deleteRecordDoc(key) {
  var db = _dbOrNull();
  if (!db) return _fail();
  if (!_validKey(key)) return Promise.resolve({ ok: false, reason: 'invalid_key' });
  return Promise.resolve().then(function () {
    var col = db.collection(CLOUD.collections.records);
    return col.where({ _openid: '{openid}', key: key }).remove();
  }).then(function () {
    return { ok: true, reason: 'ok' };
  }).catch(function (e) {
    return { ok: false, reason: _errReason(e) };
  });
}

/** 物理删除当前用户的 chess_state 文档（用户主动删除账号数据，清空同步元数据/opId）。 */
function deleteStateDoc() {
  var db = _dbOrNull();
  if (!db) return _fail();
  return Promise.resolve().then(function () {
    var col = db.collection(CLOUD.collections.state);
    return col.where({ _openid: '{openid}' }).remove();
  }).then(function () {
    return { ok: true, reason: 'ok' };
  }).catch(function (e) {
    return { ok: false, reason: _errReason(e) };
  });
}

function reset() {
  _db = null;
  _inited = false;
}

module.exports = {
  hasCloud: hasCloud,
  isEnabled: isEnabled,
  init: init,
  getStateDoc: getStateDoc,
  putStateDoc: putStateDoc,
  listRecords: listRecords,
  putRecord: putRecord,
  markDeleted: markDeleted,
  deleteRecordDoc: deleteRecordDoc,
  deleteStateDoc: deleteStateDoc,
  serverDate: serverDate,
  reset: reset
};
