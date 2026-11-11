/**
 * 远程双人对弈 · 房间原语（src/core/room.js）离线测试 · v4
 *
 * 纯 Node / CommonJS，无 DOM / eval / npm，零云端资源。本文件**自带独立 wx.cloud
 * mock**（不 require 其它测试文件），内存版 wx.cloud.database() 实现：
 *   collection().add/where().get/update/watch/remove + serverDate()（返回 new Date()），
 *   add() 自动注入 _openid / _id + roomId 唯一索引，where().update() 真实实现 rev 条件
 *   匹配并返回 stats.updated，watch() 实现 onChange 推送 + close()，所有方法返回 Promise。
 *   所有 DB 操作经 defer() 推迟到微任务，模拟真实异步云调用，使 rev CAS 并发可确定性复现。
 *
 * 运行： node test-room.js
 */
'use strict';

var config = require('./src/config');
var ROOM_CONFIG = config.ROOM_CONFIG;
var KEYS = config.STORAGE_KEYS;

function hasOwn(o, k) { return Object.prototype.hasOwnProperty.call(o, k); }

// ===========================================================================
// 独立 wx.cloud mock 工厂
// ===========================================================================
var FIXED_OPENID = 'room_test_openid_A';

/** 把一次 DB 操作推迟到微任务执行，返回 Promise（模拟真实异步云调用）。 */
function defer(fn) {
  return new Promise(function (res, rej) {
    Promise.resolve().then(function () {
      try { fn(res, rej); } catch (e) { rej(e); }
    });
  });
}

/** 文档快照：浅拷贝 + 数组切片，隔离后续写入（防止快照被后续 update 篡改）。 */
function snapDoc(d) {
  var o = {};
  for (var k in d) if (hasOwn(d, k)) {
    o[k] = Array.isArray(d[k]) ? d[k].slice() : d[k];
  }
  return o;
}

function createWxMock(opts) {
  opts = opts || {};
  var store = {};                 // collection name -> docs[]
  var watchers = [];             // {docs, where, onChange, onError, closed}
  var storageMap = {};
  var docSeq = 0;
  var CURRENT_OPENID = FIXED_OPENID;
  var flags = { noWatch: !!opts.noWatch, getFails: false, updateFails: false };
  var calls = {
    init: 0, database: 0, where: 0, get: 0, add: 0, addData: [], addRejectedClientId: 0,
    update: 0, updateData: [], remove: 0, watch: 0
  };

  /** where 条件匹配；_openid:'{openid}' 视作平台对当前用户 openid 的占位符。 */
  function match(d, w) {
    for (var k in w) if (hasOwn(w, k)) {
      var v = w[k];
      if (k === '_openid') {
        var expected = (v === '{openid}') ? CURRENT_OPENID : v;
        if (d._openid !== expected) return false;
        continue;
      }
      if (JSON.stringify(d[k]) !== JSON.stringify(v)) return false;
    }
    return true;
  }

  /** 任一写操作后向所有匹配的 watcher 广播 onChange。 */
  function broadcast() {
    watchers.forEach(function (w) {
      if (w.closed) return;
      try {
        var list = w.docs.filter(function (d) { return match(d, w.where); })
          .map(snapDoc);
        if (typeof w.onChange === 'function') w.onChange({ docs: list, docChanges: [] });
      } catch (e) {}
    });
  }

  function makeQuery(docs, w) {
    var _where = {};
    for (var k in w) if (hasOwn(w, k)) _where[k] = w[k];
    var _skip = 0, _limit = null;
    var q = {};
    q.where = function (w2) { for (var k2 in w2) if (hasOwn(w2, k2)) _where[k2] = w2[k2]; return q; };
    q.skip = function (n) { _skip = n | 0; return q; };
    q.limit = function (n) { _limit = n; return q; };
    q.orderBy = function () { return q; };
    q.get = function () {
      calls.get++;
      return defer(function (res, rej) {
        if (flags.getFails) return rej(new Error('get fail: network error'));
        var list = docs.filter(function (d) { return match(d, _where); });
        var lim = Math.min(_limit == null ? 20 : _limit, 20);  // 前端 get 一次 20 条上限
        res({ data: list.slice(_skip, _skip + lim).map(snapDoc) });
      });
    };
    q.update = function (arg) {
      calls.update++;
      var data = (arg && arg.data) || {};
      calls.updateData.push(data);
      return defer(function (res, rej) {
        if (flags.updateFails) return rej(new Error('update fail: network error'));
        var hits = docs.filter(function (d) { return match(d, _where); });
        hits.forEach(function (d) { for (var k in data) if (hasOwn(data, k)) d[k] = data[k]; });
        broadcast();
        res({ stats: { updated: hits.length } });
      });
    };
    q.remove = function () {
      calls.remove++;
      return defer(function (res) {
        var hits = docs.filter(function (d) { return match(d, _where); });
        var n = 0;
        hits.forEach(function (d) { var i = docs.indexOf(d); if (i >= 0) { docs.splice(i, 1); n++; } });
        broadcast();
        res({ stats: { removed: n } });
      });
    };
    q.count = function () {
      return defer(function (res) {
        res({ total: docs.filter(function (d) { return match(d, _where); }).length });
      });
    };
    // 能力开关：noWatch 时查询对象无 watch 方法，用于验证轮询兜底
    if (!flags.noWatch) {
      q.watch = function (o) {
        calls.watch++;
        var w = {
          docs: docs, where: _where,
          onChange: o && o.onChange, onError: o && o.onError, closed: false
        };
        watchers.push(w);
        return { close: function () { w.closed = true; } };
      };
    }
    return q;
  }

  function collection(name) {
    var docs = store[name] || (store[name] = []);
    var colApi = {};
    colApi.where = function (w) { calls.where++; return makeQuery(docs, w || {}); };
    colApi.get = function () { return makeQuery(docs, {}).get(); };
    colApi.add = function (arg) {
      calls.add++;
      var data = (arg && arg.data) || {};
      calls.addData.push(data);
      return defer(function (res, rej) {
        // 平台：拒绝客户端显式传 _openid / _id
        if (hasOwn(data, '_openid') || hasOwn(data, '_id')) {
          calls.addRejectedClientId++;
          return rej(new Error('add fail: client must not set _openid/_id'));
        }
        // roomId 唯一索引
        if (data.roomId) {
          for (var i = 0; i < docs.length; i++) {
            if (docs[i].roomId === data.roomId) return rej(new Error('add fail: duplicate roomId'));
          }
        }
        var doc = snapDoc(data);
        doc._openid = CURRENT_OPENID;    // 平台注入，不可伪造
        doc._id = 'doc_' + (++docSeq);
        docs.push(doc);
        broadcast();
        res({ _id: doc._id });
      });
    };
    return colApi;
  }

  var wx = {
    setStorageSync: function (k, v) { storageMap[k] = v; },
    getStorageSync: function (k) { return hasOwn(storageMap, k) ? storageMap[k] : ''; },
    removeStorageSync: function (k) { delete storageMap[k]; },
    cloud: {
      init: function () { calls.init++; },
      database: function () {
        calls.database++;
        return {
          serverDate: function () { return new Date(); },
          collection: collection
        };
      }
    }
  };

  var ctl = {
    FIXED_OPENID: FIXED_OPENID,
    wx: wx, store: store, watchers: watchers, flags: flags, calls: calls,
    docs: function (name) { return store[name] || (store[name] = []); }
  };
  return { wx: wx, ctl: ctl };
}

// ===========================================================================
// 测试框架
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

/** 通过清 require.cache 拿到一个全新的 room.js 实例（模拟另一台设备的独立进程）。 */
function freshRoom() {
  var p = require.resolve('./src/core/room');
  delete require.cache[p];
  return require('./src/core/room');
}

/** 装一套全新的 wx.cloud mock + 打开云配置 + 重置 cloud 单例状态。 */
function setupMock(opts) {
  var m = createWxMock(opts || {});
  global.wx = m.wx;
  config.CLOUD_CONFIG.enabled = true;
  config.CLOUD_CONFIG.env = 'test-env-room';
  try { require('./src/core/cloud').reset(); } catch (e) {}
  return m;
}

/** 固定序列 randFn 工厂：每次调用产出同一串，用于确定性断言。 */
function fixedSeq() {
  var v = [0.0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7], n = 0;
  return function () { return v[(n++) % v.length]; };
}

// ===========================================================================
// 测试主体
// ===========================================================================
async function main() {
  // -------------------------------------------------------------------------
  section('1. genRoomCode / genSeat 随机码契约');
  var r1 = freshRoom();
  var A = ROOM_CONFIG.codeAlphabet;
  ok('codeAlphabet 全为数字字符', /^[0-9]+$/.test(A), 'A=' + A);
  var c1 = r1.genRoomCode();
  ok('genRoomCode 长度 = 6', c1.length === 6, 'len=' + c1.length);
  ok('genRoomCode 输出 6 位纯数字 /^[0-9]{6}$/', /^[0-9]{6}$/.test(c1), 'code=' + c1);
  var det1 = r1.genRoomCode(fixedSeq());
  var det2 = r1.genRoomCode(fixedSeq());
  ok('注入确定性 randFn 可复现', det1 === det2 && det1.length === 6, det1 + '/' + det2);
  var zeroCode = r1.genRoomCode(function () { return 0; });
  var nineCode = r1.genRoomCode(function () { return 0.999999; });
  ok("genRoomCode(()=>0) === '000000'（保留前导零、不 parseInt）",
    zeroCode === '000000', 'got=' + zeroCode);
  ok("genRoomCode(()=>0.999999) === '999999'（上边界）",
    nineCode === '999999', 'got=' + nineCode);
  var bad = 0;
  for (var t1 = 0; t1 < 1000; t1++) {
    if (!/^[0-9]{6}$/.test(r1.genRoomCode())) bad++;
  }
  ok('1000 次均为 6 位纯数字', bad === 0, 'bad=' + bad);
  ok('genSeat 长度 = 16', r1.genSeat().length === 16, 'len=' + r1.genSeat().length);

  // -------------------------------------------------------------------------
  section('2. 无 wx 环境全降级');
  var r2 = freshRoom();
  r2.reset();
  var savedWx = global.wx;
  delete global.wx;
  ok('isAvailable() === false', r2.isAvailable() === false);
  var noWxMethods = [
    ['createRoom', [{ hostColor: 'w' }]],
    ['joinRoom', ['ABC234']],
    ['pushMove', ['e2e4', 0, null]],
    ['getRoom', ['ABC234']]
  ];
  for (var n2 = 0; n2 < noWxMethods.length; n2++) {
    var mn = noWxMethods[n2][0], args = noWxMethods[n2][1];
    var p2 = null, threw2 = false, res2 = null, err2 = null;
    try { p2 = r2[mn].apply(null, args); } catch (e) { threw2 = true; err2 = e; }
    ok('无 wx · ' + mn + ' 不抛异常', !threw2, threw2 ? String(err2) : '');
    try { res2 = await p2; } catch (e) { threw2 = true; res2 = e; }
    ok('无 wx · ' + mn + ' = {ok:false,reason:unavailable} 且不 reject',
      !threw2 && !!res2 && res2.ok === false && res2.reason === 'unavailable',
      JSON.stringify(res2));
  }
  var wr2 = null, wThrew2 = false;
  try { wr2 = r2.watchRoom('ABC234', { onSnapshot: function () {}, onError: function () {} }); }
  catch (e) { wThrew2 = true; }
  ok('无 wx · watchRoom 不抛异常', !wThrew2);
  ok('无 wx · watchRoom 返回 false', wr2 === false, 'wr=' + wr2);
  global.wx = savedWx;   // 恢复（undefined，后续 setupMock 会重挂）

  // -------------------------------------------------------------------------
  section('3. 完整两机对局一致性');
  var m3 = setupMock();
  var host3 = freshRoom();
  var guest3 = freshRoom();
  var cr3 = await host3.createRoom({ hostColor: 'w' });
  ok('host createRoom ok + 拿到 roomId/hostSeat',
    cr3.ok === true && !!cr3.roomId && !!cr3.seat, JSON.stringify(cr3));
  var rid3 = cr3.roomId;
  var st3h = host3.getState();
  ok('createRoom 本地态 host/w/waiting/rev0',
    st3h.role === 'host' && st3h.color === 'w' && st3h.status === 'waiting' && st3h.rev === 0,
    JSON.stringify(st3h));

  var jr3 = await guest3.joinRoom(rid3);
  ok('guest joinRoom ok + color=b',
    jr3.ok === true && jr3.color === 'b' && !!jr3.seat, JSON.stringify(jr3));
  var gr30 = await guest3.getRoom(rid3);
  ok('join 后房间 status=playing / rev=1',
    gr30.ok && gr30.doc.status === 'playing' && gr30.doc.rev === 1,
    JSON.stringify(gr30.doc && { s: gr30.doc.status, r: gr30.doc.rev }));
  ok('guestSeat 已写入', !!gr30.doc.guestSeat && gr30.doc.guestSeat === jr3.seat);

  var snaps3 = [], wOk3 = false, wThrew3 = false;
  try {
    wOk3 = host3.watchRoom(rid3, {
      onSnapshot: function (d) { snaps3.push(d); },
      onError: function () {}
    });
  } catch (e) { wThrew3 = true; }
  ok('host watchRoom 订阅成功且不抛', !wThrew3 && wOk3 === true, 'wOk=' + wOk3);

  var pm31 = await guest3.pushMove('e2e4', 1);
  ok('guest pushMove e2e4 -> ok/updated1',
    pm31.ok === true && pm31.updated === 1, JSON.stringify(pm31));
  var gr31 = await host3.getRoom(rid3);
  ok('e2e4 后 movesUci=[e2e4] / turn=b / rev=2',
    gr31.ok && JSON.stringify(gr31.doc.movesUci) === JSON.stringify(['e2e4']) &&
    gr31.doc.turn === 'b' && gr31.doc.rev === 2,
    JSON.stringify(gr31.doc && { m: gr31.doc.movesUci, t: gr31.doc.turn, r: gr31.doc.rev }));
  ok('host onSnapshot 收到 movesUci=[e2e4] / turn=b / rev=2',
    snaps3.some(function (d) {
      return d && JSON.stringify(d.movesUci) === JSON.stringify(['e2e4']) &&
        d.turn === 'b' && d.rev === 2;
    }), 'snaps=' + snaps3.length);

  var pm32 = await host3.pushMove('e7e5', 2);
  ok('e7e5 pushMove -> ok/updated1', pm32.ok === true && pm32.updated === 1, JSON.stringify(pm32));
  var gr32 = await host3.getRoom(rid3);
  ok('e7e5 后 movesUci=[e2e4,e7e5] / turn=w / rev=3',
    gr32.ok && JSON.stringify(gr32.doc.movesUci) === JSON.stringify(['e2e4', 'e7e5']) &&
    gr32.doc.turn === 'w' && gr32.doc.rev === 3,
    JSON.stringify(gr32.doc && { m: gr32.doc.movesUci, t: gr32.doc.turn, r: gr32.doc.rev }));
  ok('host onSnapshot 收到 movesUci=[e2e4,e7e5]',
    snaps3.some(function (d) {
      return d && JSON.stringify(d.movesUci) === JSON.stringify(['e2e4', 'e7e5']) &&
        d.turn === 'w' && d.rev === 3;
    }), 'snaps=' + snaps3.length);
  host3.stopWatch();

  // 两个独立 room 实例（reset + 重新 init 模拟两端）各自 pollOnce 后 getState 一致
  var endA = freshRoom();
  endA.init();
  endA.watchRoom(rid3, { onSnapshot: function () {}, onError: function () {} });
  await endA.pollOnce();
  var stA = endA.getState();
  endA.stopWatch();

  var endB = freshRoom();
  endB.init();
  endB.watchRoom(rid3, { onSnapshot: function () {}, onError: function () {} });
  await endB.pollOnce();
  var stB = endB.getState();
  endB.stopWatch();

  ok('两端各自 pollOnce 后 getState().movesUci 完全一致',
    JSON.stringify(stA.movesUci) === JSON.stringify(stB.movesUci) &&
    JSON.stringify(stA.movesUci) === JSON.stringify(['e2e4', 'e7e5']),
    'A=' + JSON.stringify(stA.movesUci) + ' B=' + JSON.stringify(stB.movesUci));

  // -------------------------------------------------------------------------
  section('4. rev CAS 冲突（相同 expectedRev 并发两次）');
  var m4 = setupMock();
  var r4 = freshRoom();
  var cr4 = await r4.createRoom({ hostColor: 'w', randFn: fixedSeq() });
  var rid4 = cr4.roomId;
  var d4 = m4.ctl.docs('chess_rooms')[0];
  d4.status = 'playing'; d4.rev = 2; d4.movesUci = ['e2e4']; d4.turn = 'b'; d4.guestSeat = 'G';
  var both4 = await Promise.all([
    r4.pushMove('d2d4', 2),
    r4.pushMove('d2d4', 2)
  ]);
  var ok4 = both4.filter(function (x) { return x.ok === true && x.updated === 1; }).length;
  var cf4 = both4.filter(function (x) { return x.ok === false && x.updated === 0 && x.reason === 'conflict'; }).length;
  ok('一次 updated=1 一次 updated=0/conflict', ok4 === 1 && cf4 === 1, JSON.stringify(both4));
  var gr4 = await r4.getRoom(rid4);
  ok('房间 movesUci 只 append 一次，不丢步不重复',
    gr4.ok && JSON.stringify(gr4.doc.movesUci) === JSON.stringify(['e2e4', 'd2d4']) && gr4.doc.rev === 3,
    JSON.stringify(gr4.doc && { m: gr4.doc.movesUci, r: gr4.doc.rev }));

  // -------------------------------------------------------------------------
  section('5. 过期房间');
  var m5 = setupMock();
  var h5 = freshRoom();
  var cr5 = await h5.createRoom({ hostColor: 'w', randFn: fixedSeq() });
  m5.ctl.docs('chess_rooms')[0].expireAt = Date.now() - 1000;
  var g5 = freshRoom();
  var jr5 = await g5.joinRoom(cr5.roomId);
  ok('expireAt < now 的房间 joinRoom -> {ok:false,reason:expired}',
    jr5.ok === false && jr5.reason === 'expired', JSON.stringify(jr5));

  // -------------------------------------------------------------------------
  section('6. 满房 / 重复加入');
  var m6 = setupMock();
  var h6 = freshRoom();
  var cr6 = await h6.createRoom({ hostColor: 'w' });
  var g6 = freshRoom();
  var j61 = await g6.joinRoom(cr6.roomId);
  ok('首次 join 成功', j61.ok === true, JSON.stringify(j61));
  var g6b = freshRoom();
  var j62 = await g6b.joinRoom(cr6.roomId);
  ok('status=playing 时再次 joinRoom -> full/conflict',
    j62.ok === false && (j62.reason === 'full' || j62.reason === 'conflict'), JSON.stringify(j62));
  var gr6 = await h6.getRoom(cr6.roomId);
  ok('guestSeat 不被覆盖 / status 仍 playing',
    gr6.ok && gr6.doc.guestSeat === j61.seat && gr6.doc.status === 'playing',
    JSON.stringify(gr6.doc && { g: gr6.doc.guestSeat, s: gr6.doc.status }));

  // -------------------------------------------------------------------------
  section('7. watch 不可用时轮询兜底');
  var m7 = setupMock({ noWatch: true });
  var h7 = freshRoom();
  var cr7 = await h7.createRoom({ hostColor: 'w' });
  var g7 = freshRoom();
  await g7.joinRoom(cr7.roomId);
  var snaps7 = [], wOk7 = false, wThrew7 = false;
  try {
    wOk7 = h7.watchRoom(cr7.roomId, {
      onSnapshot: function (d) { snaps7.push(d); },
      onError: function () {}
    });
  } catch (e) { wThrew7 = true; }
  ok('无 watch 方法时 watchRoom 不抛且仍返回 true', !wThrew7 && wOk7 === true, 'wOk=' + wOk7);
  ok('无 watch 方法时确实未注册 watcher', m7.ctl.calls.watch === 0, 'watch=' + m7.ctl.calls.watch);
  await g7.pushMove('e2e4', 1);
  var pr7 = await h7.pollOnce();
  ok('pollOnce 拉取成功', pr7.ok === true, JSON.stringify(pr7));
  ok('pollOnce 回调 onSnapshot 收到对方新落子',
    snaps7.some(function (d) { return d && JSON.stringify(d.movesUci) === JSON.stringify(['e2e4']); }),
    'snaps=' + snaps7.length);
  h7.stopWatch();

  // -------------------------------------------------------------------------
  section('8. 结束态（finished 后不可再落子）');
  var m8 = setupMock();
  var h8 = freshRoom();
  var cr8 = await h8.createRoom({ hostColor: 'w' });
  var g8 = freshRoom();
  await g8.joinRoom(cr8.roomId);
  var fin8 = await g8.pushMove('e2e4', 1, 'white_win');
  ok('带 result 的落子 ok', fin8.ok === true && fin8.updated === 1, JSON.stringify(fin8));
  var gr8 = await h8.getRoom(cr8.roomId);
  ok('结束态 status=finished / result=white_win',
    gr8.ok && gr8.doc.status === 'finished' && gr8.doc.result === 'white_win',
    JSON.stringify(gr8.doc && { s: gr8.doc.status, r: gr8.doc.result }));
  var after8 = await h8.pushMove('d2d4', 2);
  ok('结束后 pushMove（where status:playing 匹配 0）-> conflict',
    after8.ok === false && after8.reason === 'conflict', JSON.stringify(after8));
  var gr8b = await h8.getRoom(cr8.roomId);
  ok('已结束对局未被篡改',
    JSON.stringify(gr8b.doc.movesUci) === JSON.stringify(['e2e4']) && gr8b.doc.status === 'finished',
    JSON.stringify(gr8b.doc && { m: gr8b.doc.movesUci, s: gr8b.doc.status }));

  // -------------------------------------------------------------------------
  section('9. 非法 UCI 拒绝（不写云端）');
  var m9 = setupMock();
  var r9 = freshRoom();
  await r9.createRoom({ hostColor: 'w' });
  var upd9before = m9.ctl.calls.updateData.length;
  var a9 = await r9.pushMove('zz99', 0);
  var b9 = await r9.pushMove('e2e4e4', 0);
  ok("'zz99' 被拒绝", a9.ok === false, JSON.stringify(a9));
  ok("'e2e4e4' 被拒绝", b9.ok === false, JSON.stringify(b9));
  ok('非法 UCI 未触发 update', m9.ctl.calls.updateData.length === upd9before,
    'updates=' + (m9.ctl.calls.updateData.length - upd9before));

  var mLong = setupMock();
  var rLong = freshRoom();
  var longMoves = [];
  for (var i9 = 0; i9 < ROOM_CONFIG.maxMoves; i9++) longMoves.push('e2e4');
  mLong.ctl.docs('chess_rooms').push(snapDoc({
    _id: 'doc_long', _openid: FIXED_OPENID, roomId: 'LONGROOM',
    hostSeat: 'H', guestSeat: 'G', hostColor: 'w', status: 'playing',
    movesUci: longMoves, turn: 'w', rev: 5, lastSeat: '', result: null,
    resultReason: '', schemaVersion: 1, createdAt: 0, updatedAt: 0,
    expireAt: Date.now() + 100000
  }));
  rLong.watchRoom('LONGROOM', {});   // 设 _roomId
  var longUpdBefore = mLong.ctl.calls.updateData.length;
  var c9 = await rLong.pushMove('a2a3', 5);
  ok('超长 movesUci（>=maxMoves）被拒绝', c9.ok === false, JSON.stringify(c9));
  ok('超长 movesUci 未触发 update', mLong.ctl.calls.updateData.length === longUpdBefore);
  rLong.stopWatch();

  // -------------------------------------------------------------------------
  section('10. 不写 _openid / _id（平台注入，客户端不得伪造）');
  var m10 = setupMock();
  var h10 = freshRoom();
  var cr10 = await h10.createRoom({ hostColor: 'w' });
  var g10 = freshRoom();
  await g10.joinRoom(cr10.roomId);
  await g10.pushMove('e2e4', 1);
  var allData10 = m10.ctl.calls.addData.concat(m10.ctl.calls.updateData);
  var hasClientId10 = allData10.some(function (d) { return hasOwn(d, '_openid') || hasOwn(d, '_id'); });
  ok('所有 add/update 的 data 里没有 _openid / _id',
    !hasClientId10 && allData10.length > 0, 'n=' + allData10.length);
  ok('add 的确被 mock 注入了 _openid',
    m10.ctl.docs('chess_rooms')[0]._openid === FIXED_OPENID);

  // -------------------------------------------------------------------------
  section('11. config 契约');
  ok('CLOUD_CONFIG.collections.rooms === chess_rooms',
    config.CLOUD_CONFIG.collections.rooms === 'chess_rooms',
    JSON.stringify(config.CLOUD_CONFIG.collections));
  ok('STORAGE_KEYS.room === chess.room.v1', KEYS.room === 'chess.room.v1');
  var RC = config.ROOM_CONFIG;
  ok('ROOM_CONFIG 字段齐全且数值合理',
    !!RC && RC.codeLen === 6 && typeof RC.codeAlphabet === 'string' &&
    RC.codeAlphabet.length > 0 && RC.seatLen === 16 && RC.pollIntervalMs > 0 &&
    RC.watchGuardMs > 0 && RC.expireMs > 0 && RC.maxMoves > 0 &&
    RC.maxRetries > 0 && RC.schemaVersion === 1, JSON.stringify(RC));
  ok('codeAlphabet === 0123456789（6 位纯数字字母表）',
    RC.codeAlphabet === '0123456789', 'got=' + RC.codeAlphabet);

  // -------------------------------------------------------------------------
  section('12. deleteAllRooms 只删自己 _openid 的房间');
  var m12 = setupMock();
  var r12 = freshRoom();
  var c121 = await r12.createRoom({ hostColor: 'w' });
  var c122 = await r12.createRoom({ hostColor: 'b' });
  ok('host 建 2 房成功', c121.ok === true && c122.ok === true,
    JSON.stringify([c121.ok, c122.ok]));
  m12.ctl.docs('chess_rooms').push(snapDoc({
    _id: 'doc_other', _openid: 'other_openid_B', roomId: 'OTHERRM',
    hostSeat: 'X', guestSeat: '', hostColor: 'w', status: 'waiting',
    movesUci: [], turn: 'w', rev: 0, lastSeat: '', result: null,
    resultReason: '', schemaVersion: 1, createdAt: 0, updatedAt: 0,
    expireAt: Date.now() + 100000
  }));
  ok('删除前共 3 个房间文档', m12.ctl.docs('chess_rooms').length === 3,
    'len=' + m12.ctl.docs('chess_rooms').length);
  var del12 = await r12.deleteAllRooms();
  ok('deleteAllRooms -> ok / removed=2',
    del12.ok === true && del12.removed === 2, JSON.stringify(del12));
  var rest12 = m12.ctl.docs('chess_rooms');
  ok('仅剩 other_openid 的房间（未误删他人房）',
    rest12.length === 1 && rest12[0]._openid === 'other_openid_B',
    JSON.stringify(rest12));

  // -------------------------------------------------------------------------
  section('13. joinRoom 非法房间码入口拦截（不发起云端请求）');
  var m13 = setupMock();
  var r13 = freshRoom();
  var invalidCodes = ['ABC123', '12345', null];
  var invalidResults = [];
  for (var i13 = 0; i13 < invalidCodes.length; i13++) {
    invalidResults.push(await r13.joinRoom(invalidCodes[i13]));
  }
  ok("'ABC123' / '12345' / null 均返回 {ok:false, reason:invalid_room}",
    invalidResults.every(function (r) { return r && r.ok === false && r.reason === 'invalid_room'; }),
    JSON.stringify(invalidResults));
  ok('非法码返回完整 shape（seat/color/doc 齐备）',
    invalidResults.every(function (r) { return r.seat === '' && r.color === '' && r.doc === null; }),
    JSON.stringify(invalidResults[0]));
  ok('非法码未发起任何 where()/get() 云端请求',
    m13.ctl.calls.where === 0 && m13.ctl.calls.get === 0,
    'where=' + m13.ctl.calls.where + ' get=' + m13.ctl.calls.get);

  // =========================================================================
  // v5：退出仲裁 / 封存残局 / 多局比分 / 在线心跳
  // =========================================================================
  section('14. v5 createRoom：昵称 / 局数 / 续局初始着法一次性写入 add()');
  var m14 = setupMock();
  var r14 = freshRoom();
  var c14 = await r14.createRoom({
    hostColor: 'w', hostNick: ' 阿棋\u0001 ', maxGames: 3,
    seedMovesUci: ['e2e4', 'e7e5']
  });
  ok('createRoom 成功', c14.ok === true, JSON.stringify(c14.reason));
  ok('hostNick 清洗（去控制字符 + trim）', c14.doc.hostNick === '阿棋',
    'got=' + c14.doc.hostNick);
  ok('maxGames=3 写入', c14.doc.maxGames === 3, 'got=' + c14.doc.maxGames);
  ok('movesUci = seedMovesUci（续局初始局面）',
    JSON.stringify(c14.doc.movesUci) === JSON.stringify(['e2e4', 'e7e5']),
    JSON.stringify(c14.doc.movesUci));
  ok('偶数着法 ⇒ turn=w', c14.doc.turn === 'w');
  ok('rev 仍为 0 / status=waiting（好友仍可加入）',
    c14.doc.rev === 0 && c14.doc.status === 'waiting');
  var add14 = m14.ctl.calls.addData[0] || {};
  ok('add() data 不含 _openid/_id',
    !hasOwn(add14, '_openid') && !hasOwn(add14, '_id'));
  var v5Fields = ['hostNick', 'guestNick', 'maxGames', 'gameIndex', 'gamesPlayed',
    'hostScore', 'guestScore', 'hostPresent', 'guestPresent', 'hostLeftAt',
    'guestLeftAt', 'hostOnlineAt', 'guestOnlineAt', 'archived',
    'archivedMovesUci', 'archivedAt', 'archivedBy', 'keepUntil'];
  ok('18 个 v5 字段全在 add() 的 data 里（不许事后 update）',
    v5Fields.every(function (k) { return hasOwn(add14, k); }),
    v5Fields.filter(function (k) { return !hasOwn(add14, k); }).join(','));
  ok('hostPresent=true / guestPresent=false',
    add14.hostPresent === true && add14.guestPresent === false);
  var c14b = await r14.createRoom({ seedMovesUci: ['e2e4'] });
  ok('奇数着法 ⇒ turn=b（仲裁判断「轮到谁」依赖）', c14b.doc.turn === 'b');
  var c14c = await r14.createRoom({ hostNick: '1234567890123456' });
  ok('昵称裁到 nickMaxLen（12 字）', c14c.doc.hostNick.length === ROOM_CONFIG.nickMaxLen,
    'len=' + c14c.doc.hostNick.length);
  var c14d = await r14.createRoom({ hostColor: 'w' });
  ok('未设局数 ⇒ maxGamesDefault(0)=无限模式',
    c14d.doc.maxGames === ROOM_CONFIG.maxGamesDefault);

  // -------------------------------------------------------------------------
  section('15. v5 joinRoom(code,{nick})：昵称写入不破坏 rev:0 CAS');
  var m15 = setupMock();
  var r15 = freshRoom();
  var c15 = await r15.createRoom({ hostColor: 'w', hostNick: '房主',
    seedMovesUci: ['e2e4', 'e7e5'] });
  var j15 = await r15.joinRoom(c15.roomId, { nick: '好友' });
  ok('joinRoom 成功（证明 rev:0 的 CAS 未被新字段破坏）', j15.ok === true,
    JSON.stringify(j15.reason));
  var doc15 = m15.ctl.docs('chess_rooms')[0];
  ok('guestNick 写入云端文档', doc15.guestNick === '好友', 'got=' + doc15.guestNick);
  ok('guestPresent=true / guestOnlineAt>0',
    doc15.guestPresent === true && doc15.guestOnlineAt > 0);
  ok('加入后 rev=1', doc15.rev === 1);
  ok('返回 doc.movesUci 含续局着法（可透传给 gameplay 重放）',
    j15.doc && JSON.stringify(j15.doc.movesUci) === JSON.stringify(['e2e4', 'e7e5']));
  var upd15 = m15.ctl.calls.updateData.filter(function (d) {
    return hasOwn(d, 'guestNick');
  })[0];
  ok('CAS 的 update data 含 guestNick 且 rev=1',
    !!upd15 && upd15.guestNick === '好友' && upd15.rev === 1);

  // -------------------------------------------------------------------------
  section('16. v5 heartbeat / markLeft / markBothLeft / rejoinRoom');
  var m16 = setupMock();
  var r16 = freshRoom();
  var c16 = await r16.createRoom({ hostColor: 'w' });
  var h16 = await r16.heartbeat();
  ok('heartbeat 成功且 rev 递增', h16.ok === true && h16.doc.rev === 1,
    'rev=' + (h16.doc && h16.doc.rev));
  ok('heartbeat 写 hostPresent=true + hostOnlineAt>0',
    h16.doc.hostPresent === true && h16.doc.hostOnlineAt > 0);
  var l16 = await r16.markLeft();
  ok('markLeft 写 hostPresent=false + hostLeftAt>0',
    l16.ok === true && l16.doc.hostPresent === false && l16.doc.hostLeftAt > 0);
  ok('markLeft 不清 _local（readLocalRoom 仍能读回 seat）',
    !!r16.readLocalRoom() && r16.readLocalRoom().seat === c16.seat);
  var b16 = await r16.markBothLeft();
  ok('markBothLeft 写 keepUntil ≈ now + bothLeftKeepMs',
    b16.ok === true && b16.doc.keepUntil >= Date.now() + ROOM_CONFIG.bothLeftKeepMs - 2000,
    'keepUntil=' + (b16.doc && b16.doc.keepUntil));
  var b16b = await r16.markBothLeft();
  ok('markBothLeft 幂等（第二次 already_recorded，不重复写）',
    b16b.reason === 'already_recorded', 'reason=' + b16b.reason);
  var r16b = freshRoom();   // 模拟退出方重开进程，共享同一云端 store
  var rj16 = await r16b.rejoinRoom(c16.roomId, c16.seat);
  ok('凭正确 seat 复占成功（role=host）',
    rj16.ok === true && rj16.role === 'host', JSON.stringify(rj16.reason));
  ok('rejoin 清 hostLeftAt + hostPresent=true',
    rj16.doc.hostLeftAt === 0 && rj16.doc.hostPresent === true);
  ok('rejoin 取消 keepUntil 解散倒计时', rj16.doc.keepUntil === 0);
  var bad16 = await r16b.rejoinRoom(c16.roomId, 'WRONG_SEAT');
  ok('错误 seat → conflict 且不改文档',
    bad16.ok === false && bad16.reason === 'conflict');
  var bad16b = await r16b.rejoinRoom('ABC123', c16.seat);
  ok('非法房间码 → invalid_room',
    bad16b.ok === false && bad16b.reason === 'invalid_room');

  // -------------------------------------------------------------------------
  section('17. v5 setMaxGames / recordGameResult（比分 CAS 幂等）');
  var m17 = setupMock();
  var r17 = freshRoom();
  var c17 = await r17.createRoom({ hostColor: 'w', maxGames: 3 });
  var s17 = await r17.setMaxGames(5);
  ok('房主设局数成功且 rev 递增',
    s17.ok === true && s17.doc.maxGames === 5 && s17.doc.rev === 1);
  var g17 = await r17.recordGameResult(config.ROOM_RESULT.materialWhite);
  ok('白胜 → hostScore=1 / gamesPlayed=1 / gameIndex=2',
    g17.doc.hostScore === 1 && g17.doc.gamesPlayed === 1 && g17.doc.gameIndex === 2);
  var g17b = await r17.recordGameResult(config.ROOM_RESULT.draw);
  ok('平局不计比分但递增局数',
    g17b.doc.hostScore === 1 && g17b.doc.guestScore === 0 && g17b.doc.gamesPlayed === 2);
  var g17c = await r17.recordGameResult(config.ROOM_RESULT.materialBlack);
  ok('黑胜 → guestScore=1', g17c.doc.guestScore === 1);
  var before17 = m17.ctl.docs('chess_rooms')[0].gamesPlayed;
  var pair17 = await Promise.all([
    r17.recordGameResult(config.ROOM_RESULT.materialWhite),
    r17.recordGameResult(config.ROOM_RESULT.materialWhite)
  ]);
  var after17 = m17.ctl.docs('chess_rooms')[0].gamesPlayed;
  ok('两端并发记同一局只加一次（gamesPlayed CAS 幂等）',
    after17 === before17 + 1,
    'before=' + before17 + ' after=' + after17);
  ok('并发中恰有一次 already_recorded',
    pair17.filter(function (p) { return p.reason === 'already_recorded'; }).length === 1 &&
    pair17.filter(function (p) { return p.reason === 'ok'; }).length === 1,
    JSON.stringify(pair17.map(function (p) { return p.reason; })));

  // -------------------------------------------------------------------------
  section('18. v5 archiveGame / listArchivedRooms / finishByMaterial');
  var m18 = setupMock();
  var r18 = freshRoom();
  var c18 = await r18.createRoom({ hostColor: 'w', hostNick: '房主' });
  await r18.joinRoom(c18.roomId, { nick: '好友' });       // status=playing, rev=1
  await r18.pushMove('e2e4', 1, null);                    // rev=2
  await r18.pushMove('e7e5', 2, null);                    // rev=3
  var a18 = await r18.archiveGame();
  ok('archiveGame 成功 / status=archived',
    a18.ok === true && a18.doc.status === 'archived');
  ok('archivedMovesUci 等于当前完整着法快照',
    JSON.stringify(a18.doc.archivedMovesUci) === JSON.stringify(['e2e4', 'e7e5']),
    JSON.stringify(a18.doc.archivedMovesUci));
  ok('封存不判成绩（result 仍为 null）', a18.doc.result === null);
  ok('archivedBy / archivedAt 正确',
    a18.doc.archivedBy === 'guest' && a18.doc.archivedAt > 0);
  var a18b = await r18.archiveGame();
  ok('archiveGame 幂等（第二次 already_recorded）',
    a18b.reason === 'already_recorded');
  var L18 = await r18.listArchivedRooms();
  ok('listArchivedRooms 返回 1 条', L18.ok === true && L18.items.length === 1);
  ok('items[0].movesUci 带着法（「继续残局」重放的依据）',
    L18.items.length === 1 &&
    JSON.stringify(L18.items[0].movesUci) === JSON.stringify(['e2e4', 'e7e5']));
  ok('items 带双昵称 / 比分 / 局数字段',
    L18.items.length === 1 && L18.items[0].hostNick === '房主' &&
    L18.items[0].guestNick === '好友' && typeof L18.items[0].hostScore === 'number' &&
    typeof L18.items[0].maxGames === 'number');
  ok('本地离线索引 chess.roomArchive.v1 已写入',
    m18.wx.getStorageSync(KEYS.roomArchive).items.length === 1);
  m18.ctl.docs('chess_rooms').push(snapDoc({
    _id: 'doc_other18', _openid: 'other_openid_B', roomId: '999999',
    archived: true, archivedMovesUci: ['a2a3'], hostNick: '他人'
  }));
  var L18b = await r18.listArchivedRooms();
  ok('_openid 不匹配的他人封存房不返回', L18b.items.length === 1);
  var m18c = setupMock();
  var r18c = freshRoom();
  var c18c = await r18c.createRoom({ hostColor: 'w' });
  await r18c.joinRoom(c18c.roomId, { nick: 'X' });
  var f18 = await r18c.finishByMaterial('w', config.ROOM_RESULT.materialWhite);
  ok('finishByMaterial → doc.result=white_win（引擎语义）',
    f18.ok === true && f18.doc.result === 'white_win');
  ok('resultReason=ROOM_RESULT.materialWhite（不被 result 覆盖）',
    f18.doc.resultReason === config.ROOM_RESULT.materialWhite,
    'got=' + f18.doc.resultReason);
  ok('finishByMaterial → status=finished', f18.doc.status === 'finished');
  var f18b = await r18c.finishByMaterial(null, config.ROOM_RESULT.draw);
  ok('winnerColor=null → draw', f18b.doc.result === 'draw');

  // -------------------------------------------------------------------------
  section('19. v5 readLocalRoom / getState 扩展字段');
  var m19 = setupMock();
  var r19 = freshRoom();
  ok('无存档时 readLocalRoom() 返回 null', r19.readLocalRoom() === null);
  var c19 = await r19.createRoom({ hostColor: 'w', hostNick: '房主', maxGames: 5 });
  var lr19 = r19.readLocalRoom();
  ok('readLocalRoom 读回 roomId / seat / role',
    !!lr19 && lr19.roomId === c19.roomId && lr19.seat === c19.seat && lr19.role === 'host');
  var gs19 = r19.getState();
  ok('getState 带 hostNick / maxGames / movesUci',
    gs19.hostNick === '房主' && gs19.maxGames === 5 && Array.isArray(gs19.movesUci));
  ok('getState 带比分 / 在线态 / 仲裁字段',
    typeof gs19.hostScore === 'number' && typeof gs19.hostPresent === 'boolean' &&
    typeof gs19.keepUntil === 'number' && typeof gs19.archived === 'boolean');
  await r19.joinRoom(c19.roomId, { nick: '好友' });
  ok('加入后 getState.guestNick 可见（首帧快照迟到也不丢昵称）',
    r19.getState().guestNick === '好友');

  // -------------------------------------------------------------------------
  section('20. v5 config 契约与独立通道');
  var RC20 = config.ROOM_CONFIG;
  ok('ROOM_CONFIG 新字段数值合理',
    RC20.maxGamesDefault === 0 && RC20.leaveTimeoutMs === 60000 &&
    RC20.bothLeftKeepMs === 600000 && RC20.presenceIntervalMs === 10000 &&
    RC20.nickMaxLen === 12 && RC20.archiveKeepMs === 604800000);
  ok('ROOM_RESULT 导出齐全',
    ['materialWhite', 'materialBlack', 'draw', 'abandoned', 'archived',
      'resignWhite', 'resignBlack'].every(function (k) {
      return typeof config.ROOM_RESULT[k] === 'string';
    }));
  ok('STORAGE_KEYS.roomArchive / roomDraft 存在',
    KEYS.roomArchive === 'chess.roomArchive.v1' && KEYS.roomDraft === 'chess.roomDraft.v1');
  var KEY_RE20 = /^chess\.[a-z.]+\.v1(\.[A-Za-z0-9_-]+)?$/;
  ok('两个新键含大写字母 ⇒ 不匹配 sync.js KEY_RE ⇒ 不被云端镜像',
    !KEY_RE20.test(KEYS.roomArchive) && !KEY_RE20.test(KEYS.roomDraft));
  var src20 = require('fs').readFileSync(__dirname + '/src/core/room.js', 'utf8');
  ok('room.js 未 require storage.js（独立通道铁律）',
    !/^\s*var\s+\w+\s*=\s*require\(['"][^'"]*storage/.test(src20));

  // -------------------------------------------------------------------------
  section('21. v5 pushMove 的 resultReason 不再被 result 覆盖');
  var m21 = setupMock();
  var r21 = freshRoom();
  var c21 = await r21.createRoom({ hostColor: 'w' });
  await r21.joinRoom(c21.roomId, { nick: 'X' });
  var p21 = await r21.pushMove('e2e4', 1, 'draw');
  ok('result 非空但未传 reason ⇒ resultReason 保持空（v4 会被写成 "draw"）',
    p21.ok === true && p21.doc.resultReason === '',
    'got=' + (p21.doc && p21.doc.resultReason));
  var m21b = setupMock();
  var r21b = freshRoom();
  var c21b = await r21b.createRoom({ hostColor: 'w' });
  await r21b.joinRoom(c21b.roomId, { nick: 'X' });
  var p21b = await r21b.pushMove('e2e4', 1, 'white_win', config.ROOM_RESULT.materialWhite);
  ok('显式传 reason 才写入 resultReason，result 仍为引擎语义',
    p21b.ok === true && p21b.doc.resultReason === config.ROOM_RESULT.materialWhite &&
    p21b.doc.result === 'white_win');

  // -------------------------------------------------------------------------
  section('22. v5 端到端闭环：建房 → 对弈 → 封存 → 重开新房间续局 → 继续落子');
  var m22 = setupMock();
  var r22 = freshRoom();
  var c22 = await r22.createRoom({ hostColor: 'w', hostNick: '房主', maxGames: 3 });
  ok('① 建房成功（rev=0 / waiting）',
    c22.ok === true && c22.doc.rev === 0 && c22.doc.status === 'waiting');
  var j22 = await r22.joinRoom(c22.roomId, { nick: '好友' });
  ok('② 好友加入成功（rev=1 / playing）',
    j22.ok === true && j22.doc.rev === 1 && j22.doc.status === 'playing');
  await r22.pushMove('e2e4', 1, null);
  await r22.pushMove('e7e5', 2, null);
  await r22.pushMove('g1f3', 3, null);
  var a22 = await r22.archiveGame();
  ok('③ 走了 3 步后封存残局（不判成绩）',
    a22.ok === true && a22.doc.status === 'archived' && a22.doc.result === null &&
    a22.doc.archivedMovesUci.length === 3);
  var L22 = await r22.listArchivedRooms();
  ok('④ 房主查到 1 条历史封存残局',
    L22.ok === true && L22.items.length === 1);
  var seed22 = (L22.items[0] && L22.items[0].movesUci) || [];
  ok('⑤ 历史条目带着法快照（续局依据）',
    JSON.stringify(seed22) === JSON.stringify(['e2e4', 'e7e5', 'g1f3']),
    JSON.stringify(seed22));
  // 房主选「继续残局」：重开新房间，把封存着法作为 seedMovesUci
  var c22b = await r22.createRoom({ hostColor: 'w', hostNick: '房主',
    maxGames: 3, seedMovesUci: seed22 });
  ok('⑥ 新房初始局面 = 封存着法（真·续局，不是空棋盘）',
    JSON.stringify(c22b.doc.movesUci) === JSON.stringify(seed22),
    JSON.stringify(c22b.doc.movesUci));
  ok('⑦ 新房 turn 按 3 步奇偶推算 = b', c22b.doc.turn === 'b');
  ok('⑧ 新房 rev 仍 0（好友照样能加入）',
    c22b.doc.rev === 0 && c22b.doc.status === 'waiting');
  ok('⑨ 新旧房间码不同（是真重开，不是复用旧房）',
    c22b.roomId !== c22.roomId);
  var j22b = await r22.joinRoom(c22b.roomId, { nick: '好友' });
  ok('⑩ 好友成功加入续局房',
    j22b.ok === true && j22b.doc.status === 'playing');
  ok('⑪ 好友拿到的 doc.movesUci 含续局着法（两端局面一致）',
    JSON.stringify(j22b.doc.movesUci) === JSON.stringify(seed22));
  var p22 = await r22.pushMove('b8c6', 1, null);
  ok('⑫ 续局后可继续落子，着法在快照基础上累加到第 4 步',
    p22.ok === true && p22.doc.movesUci.length === 4 &&
    p22.doc.movesUci[3] === 'b8c6', JSON.stringify(p22.doc && p22.doc.movesUci));
  ok('⑬ 续局房与旧封存房互不干扰（旧房仍是 archived）',
    m22.ctl.docs('chess_rooms').filter(function (d) {
      return d.roomId === c22.roomId;
    })[0].status === 'archived');

  // -------------------------------------------------------------------------
  section('23. 棋谱模式标签与对手昵称（data/recordLabels 跨模块闭环）');
  var labels23 = require('./src/data/recordLabels');
  ok('MODE_LABEL 三态齐全',
    labels23.MODE_LABEL.ai === '人机对战' && labels23.MODE_LABEL.local === '本地双人' &&
    labels23.MODE_LABEL.remote === '远程对弈');
  ok('opponentLabel 优先返回 rec.opponent（远程昵称可见）',
    labels23.opponentLabel({ mode: 'remote', opponent: '阿棋' }) === '阿棋');
  ok('缺 opponent 时 remote 回落「远程对手」而非旧三元的「人机对战」',
    labels23.opponentLabel({ mode: 'remote' }) === '远程对手');
  ok('local 回落「本地对手」', labels23.opponentLabel({ mode: 'local' }) === '本地对手');
  ok('ai 回落「人机对战」', labels23.opponentLabel({ mode: 'ai' }) === '人机对战');
  ok('未知 mode 回落「对局」', labels23.opponentLabel({}) === '对局');
  ok('modeLabel 与 MODE_LABEL 一致',
    labels23.modeLabel('remote') === '远程对弈' && labels23.modeLabel('nope') === '对局');

  // -------------------------------------------------------------------------
  section('24. v5 sweepAbandoned：双方退出超时自动解散+封存（最终一致性兜底）');
  var m24 = setupMock();
  var r24 = freshRoom();
  var c24a = await r24.createRoom({ hostColor: 'w', hostNick: '房主' });
  await r24.joinRoom(c24a.roomId, { nick: '好友' });       // rev=1 / playing
  await r24.pushMove('e2e4', 1, null);                     // rev=2
  var b24 = await r24.markBothLeft();                      // rev=3 / keepUntil=now+10min
  ok('房 A 双方退出后写入 keepUntil',
    b24.ok === true && b24.doc.keepUntil > Date.now());
  var docA24 = m24.ctl.docs('chess_rooms').filter(function (d) {
    return d.roomId === c24a.roomId;
  })[0];
  docA24.keepUntil = Date.now() - 1000;   // 模拟 10 分钟已过去（测试不真等）
  // 房 B：同样双方退出，但保留期未过 → 不该被扫
  var c24b = await r24.createRoom({ hostColor: 'w' });
  await r24.markBothLeft();
  var sw24 = await r24.sweepAbandoned();
  ok('① sweep 只扫到 1 个过期房（swept=1）',
    sw24.ok === true && sw24.swept === 1, JSON.stringify(sw24));
  var A24 = m24.ctl.docs('chess_rooms').filter(function (d) {
    return d.roomId === c24a.roomId;
  })[0];
  var B24 = m24.ctl.docs('chess_rooms').filter(function (d) {
    return d.roomId === c24b.roomId;
  })[0];
  ok('② 过期房 status=abandoned + archived=true',
    A24.status === 'abandoned' && A24.archived === true,
    'status=' + A24.status + ' archived=' + A24.archived);
  ok('③ 自动封存不判成绩（result / resultReason 均未写）',
    A24.result === null && !A24.resultReason);
  ok('④ 自动封存保留完整着法快照',
    JSON.stringify(A24.archivedMovesUci) === JSON.stringify(['e2e4']),
    JSON.stringify(A24.archivedMovesUci));
  ok('⑤ 保留期未过的房 B 不受影响',
    B24.status !== 'abandoned' && B24.archived === false,
    'status=' + B24.status);
  var sw24b = await r24.sweepAbandoned();
  ok('⑥ 幂等：再扫一次 swept=0（不重复封存）',
    sw24b.ok === true && sw24b.swept === 0, JSON.stringify(sw24b));
  var L24 = await r24.listArchivedRooms();
  ok('⑦ 被自动封存的房出现在历史里（房主回来可续局）',
    L24.items.length === 1 && L24.items[0].roomId === c24a.roomId,
    JSON.stringify(L24.items.map(function (i) { return i.roomId; })));

  // -------------------------------------------------------------------------
  console.log('\n=== test-room 结果: ' + passed + ' 通过 / ' + failed + ' 失败 ===');
  if (failures.length) {
    console.log('失败明细：');
    failures.forEach(function (f) { console.log('  - ' + f); });
  }
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(function (e) {
  console.error('测试异常：', (e && e.stack) || e);
  process.exit(1);
});
