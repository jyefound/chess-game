/**
 * 云端 KV 镜像层（src/core/cloud.js）离线测试 · v3
 *
 * 纯 Node / CommonJS，无 DOM / eval / npm，零云端资源。用内存版云数据库 mock 模拟
 * 微信平台约束：_openid 平台注入、where 必带 _openid:'{openid}'、get 一次 20 条、
 * add 拒绝客户端 _openid/_id、add/update 超 512KB 报错、隐私 / 键盘能力探测。
 *
 * 运行：
 *   node test-cloud.js                          # 默认 both：两种模式一次跑完
 *   CHESS_CLOUD_MODE=no-cloud node test-cloud.js # 仅「完全不挂 wx.cloud/隐私接口」降级模式
 *   CHESS_CLOUD_MODE=full     node test-cloud.js # 仅「完整 mock + 故障注入」模式
 *
 * 本文件同时导出 createWxMock() 供 test-sync.js 复用；作为模块被 require 时零副作用
 * （测试主体包在 require.main === module 内）。
 */
'use strict';

var config = require('./src/config');

// ===========================================================================
// 可复用 wx mock 工厂
// ===========================================================================
var FIXED_OPENID = 'test_openid_fixed';

function createWxMock(opts) {
  opts = opts || {};
  var storageMap = {};
  var store = {};                       // collection name -> docs[]
  var docSeq = 0;
  var lastEnv = null;
  var serverClock = 1700000000000;

  function hasOwn(o, k) { return Object.prototype.hasOwnProperty.call(o, k); }
  function permErr() {
    var e = new Error('database permission denied');
    e.errMsg = 'database permission denied';
    return e;
  }
  /** 平台约束：add/update 文档超 512KB 报错（按序列化长度近似）；cloudAddTooLarge 为故障注入开关。 */
  function tooLarge(o) {
    try { return JSON.stringify(o).length > 512 * 1024; } catch (e) { return false; }
  }

  var flags = {
    cloudInitThrows: false, cloudGetFails: false, cloudAddTooLarge: false,
    cloudPermissionDenied: false, cloudUpdateZero: false,
    needAuthorization: false, authorizeSuccess: true
  };
  var calls = {
    init: 0, database: 0, serverDate: 0, where: 0, whereNoOpenid: 0, whereArgs: [],
    get: 0, getPages: [], add: 0, addRejectedClientId: 0, addInjected: 0,
    update: 0, remove: 0, count: 0,
    privacySetting: 0, requireAuthorize: 0, openContract: 0
  };

  /** where 条件匹配：_openid:'{openid}' 视作平台对当前用户 openid 的占位符解析。 */
  function match(d, w) {
    if (!w) return true;
    for (var k in w) if (hasOwn(w, k)) {
      var v = w[k];
      if (k === '_openid') { if (d._openid !== FIXED_OPENID) return false; continue; }
      if (JSON.stringify(d[k]) !== JSON.stringify(v)) return false;
    }
    return true;
  }

  function makeServerDate() {
    serverClock += 1;
    var t = serverClock;
    return { __serverDate: true, t: t, getTime: function () { return t; } };
  }

  function collection(name) {
    var docs = store[name] || (store[name] = []);
    var _where = null, _skip = 0, _limit = null;
    var api = {};
    api.where = function (w) {
      calls.where++;
      calls.whereArgs.push(w);   // 严格探针：记录原始 where 条件，供断言 _openid 字面量
      _where = w || {};
      if (!w || w._openid === undefined) calls.whereNoOpenid++;
      return api;
    };
    api.orderBy = function () { return api; };
    api.skip = function (n) { _skip = n | 0; return api; };
    api.limit = function (n) { _limit = n; return api; };
    api.get = function () {
      calls.get++;
      var w = _where, sk = _skip, lim0 = _limit;   // 快照：分页链式复用同一 api 也安全
      return new Promise(function (res, rej) {
        if (flags.cloudGetFails) return rej(new Error('get fail: network error'));
        if (flags.cloudPermissionDenied) return rej(permErr());
        if (!w || w._openid === undefined) return rej(permErr());  // 平台：缺 _openid 拒绝
        var list = docs.filter(function (d) { return match(d, w); });
        var lim = Math.min(lim0 == null ? 20 : lim0, 20);           // get 一次最多 20 条
        var page = list.slice(sk, sk + lim);
        calls.getPages.push(page.length);
        // 不深拷贝：保留 serverDate 对象的 getTime()，供 sync 的 LWW 时间戳使用。
        res({ data: page });
      });
    };
    api.add = function (arg) {
      calls.add++;
      var data = (arg && arg.data) || {};
      return new Promise(function (res, rej) {
        if (flags.cloudAddTooLarge || tooLarge(data)) return rej(new Error('add fail: document exceeds 512KB limit'));
        if (flags.cloudPermissionDenied) return rej(permErr());
        // 平台：拒绝客户端显式传 _openid / _id
        if (hasOwn(data, '_openid') || hasOwn(data, '_id')) {
          calls.addRejectedClientId++;
          return rej(new Error('add fail: client must not set _openid/_id'));
        }
        var doc = {};                                                // 浅拷贝保留 serverDate 引用
        for (var k in data) if (hasOwn(data, k)) doc[k] = data[k];
        doc._openid = FIXED_OPENID;                                  // 平台注入，不可伪造
        doc._id = 'doc_' + (++docSeq);
        calls.addInjected++;
        docs.push(doc);
        res({ _id: doc._id });
      });
    };
    api.update = function (arg) {
      calls.update++;
      var w = _where;
      var data = (arg && arg.data) || {};
      return new Promise(function (res, rej) {
        if (flags.cloudPermissionDenied) return rej(permErr());
        if (!w || w._openid === undefined) return rej(permErr());
        if (tooLarge(data)) return rej(new Error('update fail: document exceeds 512KB limit'));
        if (flags.cloudUpdateZero) return res({ stats: { updated: 0 } });  // CAS 冲突注入
        var hits = docs.filter(function (d) { return match(d, w); });
        hits.forEach(function (d) { for (var k in data) if (hasOwn(data, k)) d[k] = data[k]; });
        res({ stats: { updated: hits.length } });
      });
    };
    api.remove = function () {
      calls.remove++;
      var w = _where;
      return new Promise(function (res, rej) {
        if (flags.cloudPermissionDenied) return rej(permErr());
        if (!w || w._openid === undefined) return rej(permErr());
        var hits = docs.filter(function (d) { return match(d, w); });
        var n = 0;
        hits.forEach(function (d) { var i = docs.indexOf(d); if (i >= 0) { docs.splice(i, 1); n++; } });
        res({ stats: { removed: n } });
      });
    };
    api.count = function () {
      calls.count++;
      return Promise.resolve({ total: docs.filter(function (d) { return match(d, _where); }).length });
    };
    return api;
  }

  var wx = {
    getStorageSync: function (k) { return hasOwn(storageMap, k) ? storageMap[k] : ''; },
    setStorageSync: function (k, v) { storageMap[k] = v; },
    removeStorageSync: function (k) { delete storageMap[k]; },
    clearStorageSync: function () { for (var k in storageMap) delete storageMap[k]; },
    getSystemInfoSync: function () { return { windowWidth: 375, windowHeight: 667, pixelRatio: 2, fontSizeSetting: 16 }; },
    showToast: function () {}, hideToast: function () {},
    showModal: function (o) { if (o && o.success) o.success({ confirm: true }); },
    getLaunchOptionsSync: function () { return {}; }
  };

  var cloudPresent = opts.cloud !== false;
  var privacyApiPresent = opts.privacyApi !== false;
  var keyboardPresent = !!opts.keyboard;

  if (cloudPresent) {
    wx.cloud = {
      init: function (o) {
        calls.init++;
        lastEnv = (o && o.env) || null;
        if (flags.cloudInitThrows) throw new Error('cloud init failed');
      },
      database: function () {
        calls.database++;
        return {
          serverDate: function () { calls.serverDate++; return makeServerDate(); },
          collection: collection
        };
      }
    };
  }
  if (privacyApiPresent) {
    wx.getPrivacySetting = function (o) {
      calls.privacySetting++;
      o && o.success && o.success({ needAuthorization: !!flags.needAuthorization });
    };
    wx.requirePrivacyAuthorize = function (o) {
      calls.requireAuthorize++;
      if (flags.authorizeSuccess) { o && o.success && o.success({}); }
      else { o && o.fail && o.fail({}); }
    };
    wx.openPrivacyContract = function (o) {
      calls.openContract++;
      o && o.success && o.success({});
    };
  }
  if (keyboardPresent) {
    wx.showKeyboard = function () {}; wx.onKeyboardInput = function () {};
    wx.onKeyboardConfirm = function () {}; wx.offKeyboardInput = function () {};
    wx.offKeyboardConfirm = function () {}; wx.hideKeyboard = function () {};
  }

  var ctl = {
    FIXED_OPENID: FIXED_OPENID,
    wx: wx, storageMap: storageMap, store: store, flags: flags, calls: calls,
    cloudPresent: cloudPresent, privacyApiPresent: privacyApiPresent, keyboardPresent: keyboardPresent,
    get env() { return lastEnv; },
    docs: function (name) { return store[name] || (store[name] = []); },
    seed: function (name, arr) {
      var docs = ctl.docs(name);
      arr.forEach(function (d) {
        var doc = {};
        for (var k in d) if (hasOwn(d, k)) doc[k] = d[k];
        if (doc._openid === undefined) doc._openid = FIXED_OPENID;
        if (doc._id === undefined) doc._id = 'seed_' + (++docSeq);
        docs.push(doc);
      });
      return docs;
    },
    resetCalls: function () {
      for (var k in calls) if (hasOwn(calls, k)) {
        if (Array.isArray(calls[k])) calls[k] = [];
        else if (typeof calls[k] === 'number') calls[k] = 0;
      }
    },
    clearStore: function () { for (var k in store) if (hasOwn(store, k)) delete store[k]; }
  };
  return { wx: wx, ctl: ctl };
}

module.exports = { createWxMock: createWxMock, FIXED_OPENID: FIXED_OPENID };

// ===========================================================================
// 测试主体（仅 node test-cloud.js 时执行）
// ===========================================================================
var passed = 0, failed = 0, failures = [];
function ok(name, cond, detail) {
  if (cond) { passed++; console.log('  ✓ ' + name); }
  else {
    failed++;
    failures.push(name + (detail ? ' | ' + detail : ''));
    console.log('  ✗ ' + name + (detail ? ' | ' + detail : ''));
  }
}
function section(t) { console.log('\n=== ' + t + ' ==='); }

var cloud = require('./src/core/cloud');
var KEYS = config.STORAGE_KEYS;

function restoreConfig() {
  config.CLOUD_CONFIG.enabled = false;
  config.CLOUD_CONFIG.env = '';
  cloud.reset();
}

/** 无云时 6 个异步方法：Promise / 不抛不 reject / 精确 {ok:false,reason:'unavailable'}。 */
async function checkUnavailable(label) {
  var methods = [
    ['getStateDoc', []],
    ['putStateDoc', [{ keys: {} }, null]],
    ['listRecords', []],
    ['putRecord', [KEYS.settings, { a: 1 }]],
    ['markDeleted', [KEYS.settings]],
    ['deleteRecordDoc', [KEYS.settings]]
  ];
  for (var i = 0; i < methods.length; i++) {
    var m = methods[i][0], args = methods[i][1];
    var r = null, isPromise = false, threw = false;
    try {
      var p = cloud[m].apply(null, args);
      isPromise = !!(p && typeof p.then === 'function');
      r = await p;
    } catch (e) { threw = true; r = e; }
    ok(label + ' · ' + m + ' 返回 Promise', isPromise, 'isPromise=' + isPromise);
    ok(label + ' · ' + m + ' 不抛 / 不 reject', !threw,
      threw ? String((r && (r.message || r.errMsg)) || r) : '');
    ok(label + ' · ' + m + ' = {ok:false,reason:unavailable}',
      !!r && r.ok === false && r.reason === 'unavailable' && Object.keys(r).length === 2,
      JSON.stringify(r));
  }
}

// ---------------------------------------------------------------------------
// 模式一：完全不挂 wx.cloud / 隐私接口（默认降级本地）
// ---------------------------------------------------------------------------
async function modeNoCloud() {
  section('模式一：完全不挂 wx.cloud / 隐私接口（默认降级本地）');
  var m = createWxMock({ cloud: false, privacyApi: false, keyboard: false });
  global.wx = m.wx;
  restoreConfig();

  ok('mock 未挂 wx.cloud', typeof global.wx.cloud === 'undefined');
  ok('mock 未挂隐私接口', typeof global.wx.getPrivacySetting === 'undefined' &&
    typeof global.wx.requirePrivacyAuthorize === 'undefined');
  ok('hasCloud() === false', cloud.hasCloud() === false);
  ok('isEnabled() === false', cloud.isEnabled() === false);
  var ir = cloud.init();
  ok('init() = {ok:false,reason:unavailable}',
    !!ir && ir.ok === false && ir.reason === 'unavailable', JSON.stringify(ir));
  ok('serverDate() === null', cloud.serverDate() === null);
  await checkUnavailable('无云');
  ok('无云零云调用(init/database/get/add 全 0)',
    m.ctl.calls.init === 0 && m.ctl.calls.database === 0 &&
    m.ctl.calls.get === 0 && m.ctl.calls.add === 0, JSON.stringify(m.ctl.calls));
}

// ---------------------------------------------------------------------------
// 模式二：完整 mock + 故障注入
// ---------------------------------------------------------------------------
async function modeFull() {
  section('模式二 · 启停门控：enabled=false / env="" 零云调用');
  var m = createWxMock({ cloud: true, privacyApi: true, keyboard: true });
  var ctl = m.ctl;
  global.wx = m.wx;
  restoreConfig();

  config.CLOUD_CONFIG.enabled = false;
  config.CLOUD_CONFIG.env = 'test-env';
  cloud.reset(); ctl.resetCalls();
  ok('enabled=false → isEnabled()===false', cloud.isEnabled() === false);
  var r = await cloud.listRecords();
  ok('enabled=false → {ok:false,reason:unavailable}',
    !!r && r.ok === false && r.reason === 'unavailable', JSON.stringify(r));
  ok('enabled=false 零云调用(init/database/get/add 全 0)',
    ctl.calls.init === 0 && ctl.calls.database === 0 && ctl.calls.get === 0 && ctl.calls.add === 0,
    JSON.stringify(ctl.calls));

  config.CLOUD_CONFIG.enabled = true;
  config.CLOUD_CONFIG.env = '';
  cloud.reset(); ctl.resetCalls();
  ok('env="" → isEnabled()===false', cloud.isEnabled() === false);
  var r0 = await cloud.getStateDoc();
  ok('env="" → {ok:false,reason:unavailable}', !!r0 && r0.ok === false);
  ok('env="" 零云调用(init/database 全 0)', ctl.calls.init === 0 && ctl.calls.database === 0);

  // --- 启用 ---
  section('模式二 · 启用后：init / serverDate / where 约束');
  config.CLOUD_CONFIG.enabled = true;
  config.CLOUD_CONFIG.env = 'test-env-001';
  cloud.reset(); ctl.resetCalls(); ctl.clearStore();
  ok('启用后 hasCloud()===true', cloud.hasCloud() === true);
  ok('启用后 isEnabled()===true', cloud.isEnabled() === true);
  var i1 = cloud.init();
  ok('init() = {ok:true,reason:ok}', !!i1 && i1.ok === true && i1.reason === 'ok', JSON.stringify(i1));
  ok('init 记录 env', ctl.env === 'test-env-001', 'env=' + ctl.env);
  var i2 = cloud.init();
  ok('init() 幂等 → reason:already', !!i2 && i2.ok === true && i2.reason === 'already', JSON.stringify(i2));
  var sd = cloud.serverDate();
  ok('serverDate() 返回服务端时间对象',
    !!sd && sd.__serverDate === true && typeof sd.getTime === 'function');
  ok('serverDate() 可比较(getTime 为数字)', !!sd && typeof sd.getTime() === 'number');

  cloud.reset(); ctl.resetCalls();
  await cloud.listRecords();
  ok('listRecords 的 where 均带 _openid',
    ctl.calls.where > 0 && ctl.calls.whereNoOpenid === 0,
    'where=' + ctl.calls.where + ' noOpenid=' + ctl.calls.whereNoOpenid);
  var col = global.wx.cloud.database().collection('chess_records');
  var denied = false;
  try { await col.where({ key: KEYS.settings }).get(); } catch (e) {
    denied = /permission denied/i.test(String((e && (e.errMsg || e.message)) || ''));
  }
  ok('平台约束：where 缺 _openid → permission denied', denied);

  // --- add 注入 / 客户端字段消毒 ---
  section('模式二 · add 注入 _openid / key·value 消毒 / 服务端时间');
  cloud.reset(); ctl.resetCalls(); ctl.clearStore();
  var pr = await cloud.putRecord(KEYS.settings, { theme: 'dark', _openid: 'hacker', _id: 'fake' });
  ok('putRecord ok (add, updated=1)', !!pr && pr.ok === true && pr.updated === 1, JSON.stringify(pr));
  var docs = ctl.docs('chess_records');
  var doc = docs[docs.length - 1];
  ok('add 自动注入 _openid', !!doc && doc._openid === ctl.FIXED_OPENID, JSON.stringify(doc && doc._openid));
  ok('客户端 value._openid 被消毒丢弃', !!doc && !!doc.value && doc.value._openid === undefined);
  ok('客户端 value._id 被消毒丢弃', !!doc && !!doc.value && doc.value._id === undefined);
  ok('entry.updatedAt 用 db.serverDate()',
    !!doc && !!doc.updatedAt && doc.updatedAt.__serverDate === true && typeof doc.updatedAt.getTime === 'function');
  ok('entry.key 完整保留', !!doc && doc.key === KEYS.settings);
  var col2 = global.wx.cloud.database().collection('chess_records');
  var rejected = false;
  try { await col2.add({ data: { _openid: 'evil', key: KEYS.settings } }); } catch (e) { rejected = true; }
  ok('平台约束：add 显式传 _openid/_id 被拒', rejected && ctl.calls.addRejectedClientId > 0);

  // --- putStateDoc 消毒 + CAS ---
  section('模式二 · putStateDoc 消毒 / rev CAS');
  cloud.reset(); ctl.resetCalls(); ctl.clearStore();
  var ps = await cloud.putStateDoc({ _openid: 'hacker', _id: 'fake', keys: { a: 1 } });
  ok('putStateDoc ok (add, updated=1)', !!ps && ps.ok === true && ps.updated === 1, JSON.stringify(ps));
  var sdocs = ctl.docs('chess_state');
  var sdoc = sdocs[sdocs.length - 1];
  ok('state doc 注入平台 _openid', !!sdoc && sdoc._openid === ctl.FIXED_OPENID);
  ok('state doc 不含伪造 _openid/_id', !!sdoc && sdoc._openid !== 'hacker' && sdoc._id !== 'fake');
  ok('state doc rev=1 / schemaVersion 正确',
    !!sdoc && sdoc.rev === 1 && sdoc.schemaVersion === config.CLOUD_CONFIG.schemaVersion);
  ok('state doc.updatedAt 用 serverDate', !!sdoc && !!sdoc.updatedAt && sdoc.updatedAt.__serverDate === true);
  var ps2 = await cloud.putStateDoc({ keys: { b: 2 } }, 1);
  ok('putStateDoc CAS(expectedRev=1) updated>0', !!ps2 && ps2.ok === true && ps2.updated === 1, JSON.stringify(ps2));
  ok('CAS 后 state doc rev=2', ctl.docs('chess_state')[0].rev === 2);

  // --- 非法 key ---
  var b1 = await cloud.putRecord('BAD_KEY', { a: 1 });
  ok('非法 key 被拒 invalid_key', !!b1 && b1.ok === false && b1.reason === 'invalid_key', JSON.stringify(b1));
  var b2 = await cloud.putRecord('chess.UPPER.v1', { a: 1 });
  ok('大写字母 key 被拒 invalid_key', !!b2 && b2.ok === false && b2.reason === 'invalid_key');
  var b3 = await cloud.markDeleted('bad');
  ok('markDeleted 非法 key 被拒', !!b3 && b3.ok === false && b3.reason === 'invalid_key');

  // --- 命令对象 / 脏值 ---
  section('模式二 · 命令对象 / 脏值 / 字节上限');
  function Cmd() { this.$gt = 5; }
  var b4 = await cloud.putRecord(KEYS.settings, new Cmd());
  ok('命令对象(自定义原型)被拒 invalid_value', !!b4 && b4.ok === false && b4.reason === 'invalid_value', JSON.stringify(b4));
  var b5 = await cloud.putRecord(KEYS.settings, new Date());
  ok('Date 实例被拒 invalid_value', !!b5 && b5.ok === false && b5.reason === 'invalid_value');
  var b6 = await cloud.putRecord(KEYS.settings, { $set: { x: 1 }, keep: 7 });
  ok('$ 前缀键被消毒丢弃(不误拒)', !!b6 && b6.ok === true, JSON.stringify(b6));
  var b7 = await cloud.putRecord(KEYS.settings, { blob: new Array(70000).join('x') });
  ok('超长 value(>64KB) 被拒 too_large', !!b7 && b7.ok === false && b7.reason === 'too_large', JSON.stringify(b7));

  // --- listRecords 分页 ---
  section('模式二 · listRecords() >20 条分页');
  cloud.reset(); ctl.resetCalls(); ctl.clearStore();
  var seed = [];
  for (var i = 0; i < 45; i++) {
    (function (n) {
      seed.push({
        key: KEYS.recordPrefix + 'r' + n, value: { i: n }, rev: 1, deleted: false,
        updatedAt: { __serverDate: true, t: 1000 + n, getTime: function () { return 1000 + n; } }
      });
    })(i);
  }
  ctl.seed('chess_records', seed);
  var lr = await cloud.listRecords();
  ok('listRecords 返回 ok:true', !!lr && lr.ok === true);
  ok('listRecords 分页取回全部 45 条', !!lr && lr.items.length === 45, 'len=' + (lr && lr.items.length));
  ok('listRecords 触发分页(>=3 次 get)', ctl.calls.get >= 3, 'get=' + ctl.calls.get);
  ok('每次 get 均 <=20 条',
    ctl.calls.getPages.every(function (n) { return n <= 20; }), JSON.stringify(ctl.calls.getPages));

  // --- markDeleted tombstone ---
  section('模式二 · markDeleted 写 tombstone 而非物理删');
  cloud.reset(); ctl.resetCalls(); ctl.clearStore();
  await cloud.putRecord(KEYS.tutorial, { completed: [1] });
  var before = ctl.docs('chess_records').length;
  var del = await cloud.markDeleted(KEYS.tutorial);
  ok('markDeleted ok', !!del && del.ok === true, JSON.stringify(del));
  ok('markDeleted 非物理删(文档仍在)', ctl.docs('chess_records').length === before,
    'before=' + before + ' after=' + ctl.docs('chess_records').length);
  ok('markDeleted 写 deleted:true tombstone', ctl.docs('chess_records')[0].deleted === true);
  ok('markDeleted 未调用 remove', ctl.calls.remove === 0);
  var dd = await cloud.deleteRecordDoc(KEYS.tutorial);
  ok('deleteRecordDoc ok (物理删)', !!dd && dd.ok === true);
  ok('deleteRecordDoc 后文档被移除', ctl.docs('chess_records').length === before - 1);

  // --- getStateDoc ---
  cloud.reset(); ctl.resetCalls(); ctl.clearStore();
  var gs0 = await cloud.getStateDoc();
  ok('getStateDoc 空集合 → data:null',
    !!gs0 && gs0.ok === true && gs0.data === null && gs0.reason === 'ok', JSON.stringify(gs0));
  ctl.seed('chess_state', [{ rev: 3, keys: { 'chess.sync.ops.v1': ['a', 'b'] } }]);
  var gs1 = await cloud.getStateDoc();
  ok('getStateDoc 读到 rev=3 文档', !!gs1 && gs1.ok === true && !!gs1.data && gs1.data.rev === 3);

  // --- 故障注入：四种都返回 {ok:false} 且不抛 ---
  section('模式二 · 故障注入（init 抛错 / get 失败 / add 超 512KB / permission denied）');
  cloud.reset(); ctl.resetCalls(); ctl.flags.cloudInitThrows = true;
  var t1 = false, ir1 = null;
  try { ir1 = cloud.init(); } catch (e) { t1 = true; }
  ok('init 抛错不向外抛', !t1);
  ok('init 抛错 → {ok:false,reason:init_failed}',
    !!ir1 && ir1.ok === false && ir1.reason === 'init_failed', JSON.stringify(ir1));
  var f1 = await cloud.listRecords();
  ok('init 失败后异步方法仍 {ok:false} 不抛', !!f1 && f1.ok === false, JSON.stringify(f1));
  ctl.flags.cloudInitThrows = false;

  cloud.reset(); ctl.resetCalls(); ctl.flags.cloudGetFails = true;
  var t2 = false, f2 = null, f2b = null;
  try { f2 = await cloud.listRecords(); f2b = await cloud.getStateDoc(); } catch (e) { t2 = true; }
  ok('get 失败不抛', !t2);
  ok('get 失败 listRecords → {ok:false}', !!f2 && f2.ok === false, JSON.stringify(f2));
  ok('get 失败 getStateDoc → {ok:false}', !!f2b && f2b.ok === false);
  ctl.flags.cloudGetFails = false;

  cloud.reset(); ctl.resetCalls(); ctl.flags.cloudAddTooLarge = true;
  var t3 = false, f3 = null, f3b = null;
  try { f3 = await cloud.putRecord(KEYS.settings, { a: 1 }); f3b = await cloud.putStateDoc({ keys: { a: 1 } }); }
  catch (e) { t3 = true; }
  ok('add 超 512KB 不抛', !t3);
  ok('add 超 512KB putRecord → {ok:false}', !!f3 && f3.ok === false, JSON.stringify(f3));
  ok('add 超 512KB putStateDoc → {ok:false}', !!f3b && f3b.ok === false);
  ctl.flags.cloudAddTooLarge = false;

  cloud.reset(); ctl.resetCalls(); ctl.flags.cloudPermissionDenied = true;
  var t4 = false, f4 = {};
  try {
    f4.list = await cloud.listRecords();
    f4.get = await cloud.getStateDoc();
    f4.put = await cloud.putRecord(KEYS.settings, { a: 1 });
    f4.state = await cloud.putStateDoc({ keys: { a: 1 } });
    f4.mark = await cloud.markDeleted(KEYS.settings);
  } catch (e) { t4 = true; }
  ok('permission denied 四种方法均不抛', !t4);
  ok('permission denied listRecords → reason:denied',
    !!f4.list && f4.list.ok === false && f4.list.reason === 'denied', JSON.stringify(f4.list));
  ok('permission denied getStateDoc → {ok:false}', !!f4.get && f4.get.ok === false && f4.get.reason === 'denied');
  ok('permission denied putRecord → {ok:false}', !!f4.put && f4.put.ok === false && f4.put.reason === 'denied');
  ok('permission denied putStateDoc → {ok:false}', !!f4.state && f4.state.ok === false && f4.state.reason === 'denied');
  ok('permission denied markDeleted → {ok:false}', !!f4.mark && f4.mark.ok === false);
  ctl.flags.cloudPermissionDenied = false;

  // -------------------------------------------------------------------------
  // 本轮红线断言（spec A）：tombstone 无明文 / deleteStateDoc 物理删 /
  // _validKey 长度上限 / where 的 _openid 恰为字面量 '{openid}'。
  // 全部基于 createWxMock 的严格 where 探针（calls.whereArgs），不改 test-integration.js。
  // -------------------------------------------------------------------------
  section('模式二 · 红线：markDeleted 清空 value，tombstone 不留明文');
  cloud.reset(); ctl.resetCalls(); ctl.clearStore();
  var SECRET_NICK = '墨金棋童-SECRET-NICK-7788';
  var SECRET_MOVE = 'SENSITIVE-MOVE-MARKER-8899';
  await cloud.putRecord(KEYS.settings, {
    theme: 'dark', nickname: SECRET_NICK,
    record: { movesUci: [SECRET_MOVE, 'e2e4'], sanLog: ['e4'] }
  });
  var beforeDel = ctl.docs('chess_records').filter(function (d) { return d.key === KEYS.settings; });
  ok('markDeleted 前云端文档确实含昵称/棋谱明文',
    beforeDel.length === 1 && JSON.stringify(beforeDel[0]).indexOf(SECRET_NICK) >= 0 &&
    JSON.stringify(beforeDel[0]).indexOf(SECRET_MOVE) >= 0, JSON.stringify(beforeDel));
  var delR = await cloud.markDeleted(KEYS.settings);
  ok('markDeleted ok', !!delR && delR.ok === true, JSON.stringify(delR));
  var tomb = ctl.docs('chess_records').filter(function (d) { return d.key === KEYS.settings; });
  ok('markDeleted 后仍是同一份文档(逻辑删)', tomb.length === 1, 'len=' + tomb.length);
  ok('tombstone value === null（或字段不存在）',
    !!tomb[0] && (tomb[0].value === null || !Object.prototype.hasOwnProperty.call(tomb[0], 'value')),
    JSON.stringify(tomb[0] && tomb[0].value));
  ok('tombstone deleted === true', !!tomb[0] && tomb[0].deleted === true);
  var tombJson = JSON.stringify(tomb[0]);
  ok('tombstone 不含昵称明文', tombJson.indexOf(SECRET_NICK) < 0, tombJson);
  ok('tombstone 不含棋谱明文', tombJson.indexOf(SECRET_MOVE) < 0, tombJson);

  section('模式二 · 红线：deleteStateDoc 物理删 chess_state');
  cloud.reset(); ctl.resetCalls(); ctl.clearStore();
  var stateSeed = await cloud.putStateDoc({ keys: { hello: 'world' } });
  ok('putStateDoc 建立 chess_state 文档', !!stateSeed && stateSeed.ok === true &&
    ctl.docs('chess_state').length === 1, JSON.stringify(stateSeed));
  ctl.resetCalls();
  var dsR = await cloud.deleteStateDoc();
  ok('deleteStateDoc 返回 {ok:true,reason:ok}',
    !!dsR && dsR.ok === true && dsR.reason === 'ok', JSON.stringify(dsR));
  ok('deleteStateDoc 物理删后 chess_state 文档数 0', ctl.docs('chess_state').length === 0,
    'len=' + ctl.docs('chess_state').length);
  ok('deleteStateDoc 触发 remove', ctl.calls.remove > 0, 'remove=' + ctl.calls.remove);
  ok('deleteStateDoc 的 where 带 _openid 字面量 {openid}',
    ctl.calls.whereArgs.length > 0 && ctl.calls.whereArgs.every(function (w) {
      return !!w && w._openid === '{openid}';
    }), JSON.stringify(ctl.calls.whereArgs));

  section('模式二 · 红线：所有 where 的 _openid 恰为字面量 {openid}');
  cloud.reset(); ctl.resetCalls(); ctl.clearStore();
  await cloud.listRecords();
  await cloud.getStateDoc();
  await cloud.putRecord(KEYS.settings, { a: 1 });
  await cloud.putStateDoc({ keys: { a: 1 } });
  await cloud.markDeleted(KEYS.settings);
  await cloud.deleteRecordDoc(KEYS.settings);
  await cloud.deleteStateDoc();
  ok('全部 where 调用均带 _openid 且值恰为字面量 {openid}',
    ctl.calls.whereArgs.length > 0 && ctl.calls.whereArgs.every(function (w) {
      return !!w && w._openid === '{openid}';
    }), JSON.stringify(ctl.calls.whereArgs));
  ok('全部 where 调用无缺 _openid', ctl.calls.whereNoOpenid === 0,
    'whereNoOpenid=' + ctl.calls.whereNoOpenid);

  section('模式二 · 红线：_validKey 长度上限 128');
  cloud.reset(); ctl.resetCalls(); ctl.clearStore();
  var k128 = KEYS.recordPrefix + new Array(113).join('a');   // 16 + 112 = 128
  var k129 = KEYS.recordPrefix + new Array(114).join('a');   // 16 + 113 = 129
  ok('128 字符 key 构造正确', k128.length === 128, 'len=' + k128.length);
  ok('129 字符 key 构造正确', k129.length === 129, 'len=' + k129.length);
  var r128 = await cloud.putRecord(k128, { a: 1 });
  ok('128 字符 key 被接受', !!r128 && r128.ok === true, '实际结果=' + JSON.stringify(r128));
  var r129 = await cloud.putRecord(k129, { a: 1 });
  ok('129 字符 key 被拒 invalid_key',
    !!r129 && r129.ok === false && r129.reason === 'invalid_key',
    '实际原因=' + JSON.stringify(r129));

  // --- reset 干净 ---
  section('模式二 · reset() 后状态干净');
  cloud.reset(); ctl.resetCalls();
  var rr = cloud.init();
  ok('reset 后 init() 重新可执行(非 already)', !!rr && rr.ok === true && rr.reason === 'ok', JSON.stringify(rr));
  restoreConfig();
  ok('恢复默认配置 enabled=false / env=""',
    config.CLOUD_CONFIG.enabled === false && config.CLOUD_CONFIG.env === '');

  // --- 本轮红线：deleteStateDoc 不可用时已决议、不 reject（此时 enabled=false）---
  section('模式二 · 红线：deleteStateDoc 不可用时返回已决议 unavailable');
  var duR = null, duThrew = false, duPromise = false;
  try {
    var duP = cloud.deleteStateDoc();
    duPromise = !!(duP && typeof duP.then === 'function');
    duR = await duP;
  } catch (e) { duThrew = true; duR = e; }
  ok('deleteStateDoc 不可用时返回 Promise', duPromise);
  ok('deleteStateDoc 不可用时不抛 / 不 reject', !duThrew);
  ok('deleteStateDoc 不可用 = {ok:false,reason:unavailable}',
    !!duR && duR.ok === false && duR.reason === 'unavailable' && Object.keys(duR).length === 2,
    JSON.stringify(duR));
}

var MODE = process.env.CHESS_CLOUD_MODE || 'both';
async function main() {
  console.log('云端 KV 镜像层离线测试 · mode=' + MODE);
  if (MODE === 'both' || MODE === 'no-cloud') await modeNoCloud();
  if (MODE === 'both' || MODE === 'full') await modeFull();
  console.log('\n============================================================');
  console.log('test-cloud 结果: ' + passed + ' 通过 / ' + failed + ' 失败');
  if (failures.length) { console.log('失败项:'); failures.forEach(function (f) { console.log('  - ' + f); }); }
  console.log('============================================================');
  process.exit(failed === 0 ? 0 : 1);
}

if (require.main === module) {
  main().catch(function (e) {
    console.error('test-cloud 异常:', e && (e.stack || e.message || e));
    process.exit(1);
  });
}
