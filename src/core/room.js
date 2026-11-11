/**
 * 远程双人对弈 · 独立云端房间原语（v4）
 *
 * 【独立通道 · 铁律】本模块是 chess_rooms 集合的唯一读写方，与 v3 的「个人进度
 * 云端 KV 镜像」完全解耦：
 *  - 绝不经过 storage.js 的 28 个 API、绝不触发 storage 写 hook（noteWrite）、
 *    绝不进入 sync.js 的 pendingQueue / mergeKey / applyRemote。
 *  - 原因：sync.js 的 _isSyncable() 用 KEY_RE=/^chess\.[a-z.]+\.v1.../ 白名单，
 *    任何经 storage 写 hook 的 chess.* 键都会被当「个人进度」镜像进 chess_records。
 *    房间数据若被镜像，既污染个人进度、又会把对弈棋谱跨设备错乱回放。
 *  - 本地态只存闭包内存（_local/_movesUci/_roomId），绝不依赖 storage 模块。
 *    config.STORAGE_KEYS.room 仅作为「本地 seat/roomId 断点」的字面约定保留，
 *    本实现不写盘也不读盘（见文末报告取舍说明）。
 *
 * 【与 cloud.js 的刻意差异】cloud.js 的 where 一律硬带 _openid:'{openid}'（私有
 * 通道）；本集合安全规则是 read:true + update:true + create/delete 限 _openid，
 * 且 host 与 guest 是**两个不同 openid**，必须跨 openid 读写同一房间文档，故本模块
 * 所有 where() 查询都**不硬加 _openid**（刻意如此）。仅删除类操作（deleteAllRooms /
 * leaveRoom 的清房）带 _openid:'{openid}'，因为 delete 规则限定「仅创建者可删」。
 *
 * 【平台约束】微信云开发 database() 前端直连；_openid/_id 由平台在 add() 时注入，
 * 客户端绝不显式写它们；前端 .doc(id).update() 在 CUSTOM 规则下会被拒，一律用
 * where(...).update()；.watch() 需基础库 ≥2.9.2（项目 3.0.0）。所有 wx.* 调用都做
 * typeof==='function' 能力探测 + try/catch，Node 环境零异常。
 *
 * 【房间码】6 位数字字符串（保留前导零，genRoomCode 取自 codeAlphabet='0123456789'）。
 * 房间码即分享链接凭证：房主建房后把 roomId 放进 query.room 分享，好友凭码加入；
 * 场景层用 Canvas 2D 自绘 0-9 数字键盘输入，不依赖 wx 键盘 API。
 *
 * 【安全取舍】安全规则 update:true 意味着无云函数时无法在服务端校验走子合法性。
 * 一致性靠：6 位数字 roomId（10^6 组合，防误入）+ expireAt 6h 过期 +
 * idx_roomId 唯一索引 + rev CAS（防并发覆盖）+ seat 应用层识别
 * （lastSeat / guestSeat 区分双方）。好友邀请场景熵足够、可接受。
 *
 * 【reason 枚举】unavailable / invalid_room / not_found / expired / full / conflict /
 * invalid / invalid_uci / invalid_rev / too_many_moves / no_room / denied /
 * network / timeout / error / already_recorded / ok
 *
 * 【房间文档字段（chess_rooms v5，所有场景层按此对齐）】
 *  _id, _openid(host, 平台注入),
 *  roomId, hostSeat, guestSeat(''|string), hostColor('w'|'b'),
 *  status('waiting'|'playing'|'finished'|'archived'|'abandoned'),
 *  movesUci([] of UCI string), turn('w'|'b'), rev(int), lastSeat(''),
 *  result(null|'white_win'|'black_win'|'draw'|'resign_white'|'resign_black'),
 *    ↑ 永远保持引擎语义：gameplay.onRemoteSnapshot 直接把 doc.result 塞进引擎判胜负。
 *  resultReason('')  → 用 config.ROOM_RESULT.* 表达仲裁原因（material_white_win 等），
 *    ↑ 绝不把 result 字符串本身塞进 resultReason（v4 的既有 bug，v5 已修）。
 *  hostNick(''), guestNick(''),            // 双方各自自填昵称（≤ROOM.nickMaxLen）
 *  maxGames(0=无限), gameIndex(1), gamesPlayed(0),
 *  hostScore(0), guestScore(0),           // 本房间累计胜局（draw 不计）
 *  hostPresent(bool), guestPresent(bool), // 在线状态（心跳维护）
 *  hostLeftAt(0), guestLeftAt(0),         // 退出时刻 epoch ms，0=从未退出
 *  hostOnlineAt(0), guestOnlineAt(0),     // 最后心跳时刻
 *  archived(false), archivedMovesUci([]), archivedAt(0), archivedBy(''|'host'|'guest'),
 *  keepUntil(0),                          // 双方均退出后的房间保留截止时刻
 *  schemaVersion(1), createdAt, updatedAt(db.serverDate()), expireAt(number, ms epoch)
 *
 * 【v5 契约要点】所有新增字段必须在 createRoom 的 add() 里一次写入（joinRoom 的 CAS
 * 硬带 rev:0，事后 update 会让好友永远加不进）；任何写入都必须递增 rev（_deliver 按
 * doc.rev > _local.rev 去重，不递增则对端收不到）；markLeft 不清 _local（退出对局≠离开房间）。
 *
 * 【绝不 throw】所有导出函数返回 Promise 或同步值，绝不抛异常；wx 不存在时全部
 * 静默降级返回 {ok:false, reason:'unavailable'}（同步探测类返回 false/空对象）。
 */
'use strict';

var config = require('../config');
var cloud = require('./cloud');

var CLOUD = config.CLOUD_CONFIG;
var ROOM = config.ROOM_CONFIG;
var ROOM_COL = CLOUD.collections.rooms;
var KEYS = config.STORAGE_KEYS;

function hasOwn(o, k) { return Object.prototype.hasOwnProperty.call(o, k); }

// v5 房间结算枚举（场景层判断胜负读它；config 未就绪时用等价兜底，绝不抛异常）。
var RESULT = config.ROOM_RESULT || {
  materialWhite: 'material_white_win', materialBlack: 'material_black_win',
  draw: 'draw', abandoned: 'abandoned', archived: 'archived',
  resignWhite: 'resign_white', resignBlack: 'resign_black'
};

/** 昵称清洗：去控制字符 + trim + 裁到 ROOM.nickMaxLen（与 settings.js 同规则，不 require 场景层）。 */
function _cleanNick(v) {
  var s = (typeof v === 'string') ? v : '';
  s = s.replace(/[\u0000-\u001f\u007f]/g, '').trim();
  var max = ROOM.nickMaxLen || 12;
  if (s.length > max) s = s.slice(0, max);
  return s;
}

/** 文档浅拷贝（数组切片），避免把云端快照直接暴露给场景层后被反向篡改。 */
function _copyDoc(doc) {
  var out = {};
  if (!doc) return out;
  for (var k in doc) if (hasOwn(doc, k)) {
    out[k] = Array.isArray(doc[k]) ? doc[k].slice() : doc[k];
  }
  return out;
}

/** 本端在房间文档里的字段前缀（'host'|'guest'）；未入房返回 ''。 */
function _sideOf() {
  if (!_local) return '';
  if (_local.role === 'host' || _local.role === 'guest') return _local.role;
  return '';
}

// ---- 模块内部状态（顶层绝不触碰 wx / 云能力 SDK；由 init() 惰性驱动）----
var _db = null;            // 缓存 wx.cloud.database() 实例
var _inited = false;       // init 是否已跑（幂等）
var _watcher = null;       // .watch() 返回的句柄（含 close()）
var _pollTimer = null;     // setInterval 句柄：watch 兜底轮询
var _lastWatchAt = 0;      // 最近一次 watch/轮询事件时间戳（watchGuardMs 用）
var _handlers = null;      // {onSnapshot(doc), onError(reason)}
var _savedHandlers = null; // onBackground 时保留，供 onForeground 恢复
var _local = _emptyLocal();// {roomId, seat, role, color, rev, status}
var _movesUci = [];        // 最近一次快照的棋谱（供 getState）
var _roomId = '';          // 当前订阅/操作的房间码（跨 onBackground 保留）
var _paused = false;       // onHide 后置 true，onShow 恢复
var _closed = true;        // 当前是否无活动订阅
var _latestDoc = null;     // v5：最近一次 _deliver 收到的完整文档（供 getState 读扩展字段）

function _emptyLocal() {
  return { roomId: '', seat: '', role: '', color: '', rev: -1, status: '' };
}

// ---------------------------------------------------------------------------
// 能力探测 / 初始化
// ---------------------------------------------------------------------------
/** cloud.isEnabled() 且 wx.cloud.database 可用 -> boolean。 */
function isAvailable() {
  try {
    return !!(cloud.isEnabled() &&
      typeof wx !== 'undefined' && !!wx.cloud &&
      typeof wx.cloud.database === 'function');
  } catch (e) { return false; }
}

/** 调用 cloud.init({})（复用唯一 init 点，幂等）后惰性拿 db；返回 boolean。 */
function init() {
  if (!isAvailable()) return false;
  try {
    if (!_inited) {
      cloud.init({});
      _inited = true;
    }
    if (!_db) _db = wx.cloud.database();
    return !!_db;
  } catch (e) { return false; }
}

/** 惰性就绪并取集合；任何异常吞掉返回 null。 */
function _col() {
  if (!init()) return null;
  try { return _db.collection(ROOM_COL); } catch (e) { return null; }
}

/** 不可用时统一返回「已决议」对象（精确 shape，绝不含额外键）。 */
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

/** 服务端时间；mock/异常时返回 null（写入仍成功）。 */
function _sd() {
  try { if (_db && typeof _db.serverDate === 'function') return _db.serverDate(); } catch (e) {}
  return null;
}

/** 直接 wx 内存断点写入（能力防御，绝不经过 storage.js 写 hook）。 */
function _persistLocal() {
  try {
    if (typeof wx !== 'undefined' && typeof wx.setStorageSync === 'function') {
      wx.setStorageSync(KEYS.room, {
        roomId: _local.roomId, seat: _local.seat, role: _local.role,
        color: _local.color, rev: _local.rev, status: _local.status
      });
    }
  } catch (e) {}
}

// ---------------------------------------------------------------------------
// 随机码
// ---------------------------------------------------------------------------
function _randStr(len, randFn) {
  var r = (typeof randFn === 'function') ? randFn : Math.random;
  var A = ROOM.codeAlphabet, s = '';
  for (var i = 0; i < len; i++) {
    var v;
    try { v = r(); } catch (e) { v = 0; }
    if (typeof v !== 'number' || !isFinite(v)) v = 0;
    if (v < 0) v = 0;
    if (v >= 1) v = 0.999999999;
    s += A.charAt(Math.floor(v * A.length));
  }
  return s;
}

/** ROOM_CONFIG.codeLen 位纯数字房间码（逐字符拼接，保留前导零）；randFn 可选（测试注入确定性）。 */
function genRoomCode(randFn) { return _randStr(ROOM.codeLen, randFn); }
/** ROOM_CONFIG.seatLen 位随机座位串；randFn 可选。 */
function genSeat(randFn) { return _randStr(ROOM.seatLen, randFn); }

// ---------------------------------------------------------------------------
// 快照投递（watch / poll 共用，按 rev 去重）
// ---------------------------------------------------------------------------
function _extractDoc(snapshot) {
  if (!snapshot) return null;
  if (snapshot.docs && snapshot.docs.length) return snapshot.docs[0];
  if (snapshot.docChanges && snapshot.docChanges.length) {
    for (var i = 0; i < snapshot.docChanges.length; i++) {
      var c = snapshot.docChanges[i];
      if (c && c.doc) return c.doc;
    }
  }
  return null;
}

/**
 * 投递一个房间快照：仅在 doc.rev > 已知 rev 时回调 onSnapshot（去重、不重复重放）。
 * 无论是否回调都刷新 _movesUci（供 getState）并更新 _lastWatchAt。
 */
function _deliver(doc) {
  if (!doc) return;
  _lastWatchAt = Date.now();
  if (Array.isArray(doc.movesUci)) _movesUci = doc.movesUci.slice();
  _latestDoc = _copyDoc(doc);   // v5：getState() 从这里取昵称/比分/在线态等扩展字段
  var cur = (_local && typeof _local.rev === 'number') ? _local.rev : -1;
  var r = (typeof doc.rev === 'number') ? doc.rev : cur;
  if (r > cur) {
    if (!_local) _local = _emptyLocal();
    _local.rev = r;
    if (doc.status) _local.status = doc.status;
    if (!_local.roomId) _local.roomId = doc.roomId || _roomId || '';
    if (_handlers && typeof _handlers.onSnapshot === 'function') {
      try { _handlers.onSnapshot(doc); } catch (e) {}
    }
  }
}

// ---------------------------------------------------------------------------
// 房间读写
// ---------------------------------------------------------------------------
/**
 * 创建房间。opts:{hostColor:'w'|'b'}（可选 randFn 供测试注入）。
 * -> Promise<{ok, roomId, seat, doc, reason}>
 * add() 唯一索引 roomId 碰撞时换码重试至多 ROOM_CONFIG.maxRetries 次。
 * 绝不显式写 _openid / _id（平台注入）。
 */
function createRoom(opts) {
  var col = _col();
  if (!col) return _fail();
  var hostColor = (opts && (opts.hostColor === 'w' || opts.hostColor === 'b')) ? opts.hostColor : 'w';
  var randFn = opts && opts.randFn;
  var hostNick = _cleanNick(opts && opts.hostNick);
  var maxGames = (opts && typeof opts.maxGames === 'number' && isFinite(opts.maxGames) && opts.maxGames >= 0)
    ? Math.floor(opts.maxGames) : (ROOM.maxGamesDefault || 0);
  var seed = (opts && Array.isArray(opts.seedMovesUci)) ? opts.seedMovesUci.slice() : [];
  var attempts = 0;

  function attempt() {
    var roomId = genRoomCode(randFn);
    var hostSeat = genSeat(randFn);
    var now = Date.now();
    // ⚠ 所有 v5 新字段必须在 add() 里一次写入：joinRoom 的 CAS 硬带 rev:0，
    //    任何事后 update 都会让 rev 变成 1，好友将永远加不进房间。
    var doc = {
      roomId: roomId,
      hostSeat: hostSeat,
      guestSeat: '',
      hostColor: hostColor,
      status: 'waiting',
      movesUci: seed.slice(),            // 续局：封存残局的着法快照作为初始局面
      turn: (seed.length % 2 === 0) ? 'w' : 'b',  // 按着法数推算，仲裁判断「轮到谁」依赖它
      rev: 0,
      lastSeat: '',
      result: null,
      resultReason: '',
      // ---- v5：昵称 / 局数比分 / 在线态 / 封存 ----
      hostNick: hostNick, guestNick: '',
      maxGames: maxGames, gameIndex: 1, gamesPlayed: 0,
      hostScore: 0, guestScore: 0,
      hostPresent: true, guestPresent: false,
      hostLeftAt: 0, guestLeftAt: 0,
      hostOnlineAt: now, guestOnlineAt: 0,
      archived: false, archivedMovesUci: [], archivedAt: 0, archivedBy: '',
      keepUntil: 0,
      schemaVersion: ROOM.schemaVersion,
      createdAt: _sd(),
      updatedAt: _sd(),
      expireAt: now + ROOM.expireMs
    };
    return Promise.resolve().then(function () {
      return col.add({ data: doc });
    }).then(function () {
      _local = { roomId: roomId, seat: hostSeat, role: 'host', color: hostColor, rev: 0, status: 'waiting' };
      _roomId = roomId;
      _movesUci = seed.slice();
      _latestDoc = _copyDoc(doc);
      _paused = false;
      _closed = false;
      _persistLocal();
      return { ok: true, roomId: roomId, seat: hostSeat, doc: _copyDoc(doc), reason: 'ok' };
    }).catch(function (e) {
      attempts++;
      if (attempts <= (ROOM.maxRetries || 3)) return attempt(); // 换码重试
      return { ok: false, roomId: '', seat: '', doc: null, reason: _errReason(e) };
    });
  }
  return attempt();
}

/**
 * 加入房间。-> Promise<{ok, seat, color, doc, reason}>
 * 入口先校验 roomId 为 6 位纯数字（非 /^[0-9]{6}$/ 直接返回 invalid_room 且不发云端请求）；
 * 读房（不硬加 _openid）→ 校验 expireAt / guestSeat / status → CAS 占座
 * where({roomId, status:'waiting', rev:0, guestSeat:''}).update()，必须 updated===1。
 */
function joinRoom(roomId, opts) {
  var col = _col();
  if (!col) return _fail();
  var guestNick = _cleanNick(opts && opts.nick);
  var joinNow = Date.now();
  // 入口格式校验：房间码是 6 位纯数字字符串（分享链接 query.room / 自绘数字键盘输入）。
  // 非法码立即返回，绝不调用 where()/get()，即不发起任何云端请求。
  if (typeof roomId !== 'string' || !/^[0-9]{6}$/.test(roomId)) {
    return Promise.resolve({ ok: false, seat: '', color: '', doc: null, reason: 'invalid_room' });
  }
  var guestSeat = genSeat();
  // 读房用 where({roomId})：status/rev/guestSeat 的原子约束放在 CAS update 的 where 里，
  // 避免「读到后、写入前」房间被他人抢占的竞态（读宽、写窄）。
  return Promise.resolve().then(function () {
    return col.where({ roomId: roomId }).limit(1).get();
  }).then(function (res) {
    var doc = (res && res.data && res.data.length) ? res.data[0] : null;
    if (!doc) return { ok: false, reason: 'not_found' };
    if (typeof doc.expireAt === 'number' && doc.expireAt <= Date.now()) {
      return { ok: false, reason: 'expired' };
    }
    if (doc.guestSeat || doc.status !== 'waiting' || doc.rev !== 0) {
      return { ok: false, reason: 'full' };
    }
    return Promise.resolve().then(function () {
      // CAS where 与 rev:1 判定完全不变；新增字段只放在 data 里，不进 where。
      return col.where({ roomId: roomId, status: 'waiting', rev: 0, guestSeat: '' })
        .update({ data: {
          guestSeat: guestSeat, status: 'playing', rev: 1, updatedAt: _sd(),
          guestNick: guestNick, guestPresent: true, guestOnlineAt: joinNow
        } });
    }).then(function (r) {
      var up = (r && r.stats) ? r.stats.updated : 0;
      if (up !== 1) return { ok: false, reason: up === 0 ? 'conflict' : 'full' };
      var color = (doc.hostColor === 'w') ? 'b' : 'w';
      _local = { roomId: roomId, seat: guestSeat, role: 'guest', color: color, rev: 1, status: 'playing' };
      _roomId = roomId;
      _movesUci = Array.isArray(doc.movesUci) ? doc.movesUci.slice() : [];
      _paused = false;
      _closed = false;
      _persistLocal();
      var full = {};
      for (var k in doc) if (hasOwn(doc, k)) full[k] = doc[k];
      full.guestSeat = guestSeat; full.status = 'playing'; full.rev = 1;
      full.guestNick = guestNick; full.guestPresent = true; full.guestOnlineAt = joinNow;
      _latestDoc = _copyDoc(full);
      return { ok: true, seat: guestSeat, color: color, doc: full, reason: 'ok' };
    });
  }).catch(function (e) {
    return { ok: false, reason: _errReason(e) };
  });
}

/** 读房。-> Promise<{ok, doc, reason}>（where 不硬加 _openid，跨 openid 可读）。 */
function getRoom(roomId) {
  var col = _col();
  if (!col) return _fail();
  if (typeof roomId !== 'string' || !roomId) return Promise.resolve({ ok: false, doc: null, reason: 'invalid' });
  return Promise.resolve().then(function () {
    return col.where({ roomId: roomId }).limit(1).get();
  }).then(function (res) {
    var doc = (res && res.data && res.data.length) ? res.data[0] : null;
    if (!doc) return { ok: false, doc: null, reason: 'not_found' };
    return { ok: true, doc: doc, reason: 'ok' };
  }).catch(function (e) {
    return { ok: false, doc: null, reason: _errReason(e) };
  });
}

/**
 * 落子（CAS）。-> Promise<{ok, updated, doc, reason}>
 * 信任云端 doc 的 movesUci 作为基底（不信任本地缓存）；where({rev: expectedRev,
 * status:'playing'}).update() 保证并发只有一方成功；result 非空时置 finished，
 * result===null 时不覆盖已有 result。绝不写 _openid / _id。
 */
function pushMove(uci, expectedRev, result, reason) {
  var col = _col();
  if (!col) return _fail();
  var L = _local;
  var rid = _roomId || (L && L.roomId) || '';
  var seat = L ? L.seat : '';
  if (!rid) return Promise.resolve({ ok: false, updated: 0, doc: null, reason: 'no_room' });
  if (typeof uci !== 'string' || !/^[a-h][1-8][a-h][1-8][qrbn]?$/.test(uci)) {
    return Promise.resolve({ ok: false, updated: 0, doc: null, reason: 'invalid_uci' });
  }
  if (typeof expectedRev !== 'number' || !isFinite(expectedRev) || expectedRev < 0) {
    return Promise.resolve({ ok: false, updated: 0, doc: null, reason: 'invalid_rev' });
  }
  var res = (typeof result === 'string' && result) ? result : null;
  return Promise.resolve().then(function () {
    return getRoom(rid);
  }).then(function (gr) {
    if (!gr.ok || !gr.doc) return { ok: false, updated: 0, doc: null, reason: gr.reason || 'not_found' };
    var doc = gr.doc;
    var base = Array.isArray(doc.movesUci) ? doc.movesUci.slice() : [];
    if (base.length >= ROOM.maxMoves) {
      return { ok: false, updated: 0, doc: null, reason: 'too_many_moves' };
    }
    var moves = base.concat([uci]);
    var curTurn = (doc.turn === 'b') ? 'b' : 'w';
    var nextTurn = (curTurn === 'w') ? 'b' : 'w';
    var status = res ? 'finished' : (doc.status || 'playing');
    var outResult = res || doc.result || null;          // null 不覆盖已有 result
    // v5 修复：只在显式传入 reason 时覆盖，否则保留既有 resultReason。
    // v4 这里把 result 字符串本身塞进了 resultReason，仲裁原因永远读不到。
    var outReason = (typeof reason === 'string' && reason) ? reason : (doc.resultReason || '');
    var patch = {
      movesUci: moves,
      turn: nextTurn,
      rev: expectedRev + 1,
      lastSeat: seat,
      result: outResult,
      status: status,
      resultReason: outReason,
      updatedAt: _sd()
    };
    return Promise.resolve().then(function () {
      return col.where({ roomId: rid, rev: expectedRev, status: 'playing' })
        .update({ data: patch });
    }).then(function (r) {
      var up = (r && r.stats) ? r.stats.updated : 0;
      if (!up) return { ok: false, updated: 0, doc: null, reason: 'conflict' };
      if (L) { L.rev = expectedRev + 1; L.status = status; }
      _movesUci = moves.slice();
      _persistLocal();
      var full = {};
      for (var k in doc) if (hasOwn(doc, k)) full[k] = doc[k];
      for (var k2 in patch) if (hasOwn(patch, k2)) full[k2] = patch[k2];
      return { ok: true, updated: up, doc: full, reason: 'ok' };
    });
  }).catch(function (e) {
    return { ok: false, updated: 0, doc: null, reason: _errReason(e) };
  });
}

// ---------------------------------------------------------------------------
// v5：退出仲裁 / 封存残局 / 多局比分 / 在线心跳
// 所有写入统一走 _casPatch：读房 -> where({roomId, rev, ...}).update(patch + rev+1)。
// _deliver 按 doc.rev > _local.rev 去重，不递增 rev 对端就收不到，故无一例外。
// ---------------------------------------------------------------------------

/**
 * 通用 CAS 写入。whereExtra 可为对象或 function(doc)->对象；
 * buildPatch(doc)->对象，返回 null 表示「已是目标态」⇒ 不写、返回 already_recorded（幂等）。
 * alreadyOk=true 时，CAS 竞争失败（updated===0）也返回 ok:true/'already_recorded'，
 * 用于两端同时收到结束快照时的比分去重。绝不 throw，无 wx 返回 unavailable。
 */
function _casPatch(whereExtra, buildPatch, alreadyOk) {
  var col = _col();
  if (!col) return _fail();
  var rid = _roomId || (_local && _local.roomId) || '';
  if (!rid) return Promise.resolve({ ok: false, doc: null, reason: 'no_room' });
  return Promise.resolve().then(function () {
    return col.where({ roomId: rid }).limit(1).get();
  }).then(function (res) {
    var doc = (res && res.data && res.data.length) ? res.data[0] : null;
    if (!doc) return { ok: false, doc: null, reason: 'not_found' };
    var curRev = (typeof doc.rev === 'number') ? doc.rev : 0;
    var patch;
    try { patch = buildPatch(doc); }
    catch (e) { return { ok: false, doc: null, reason: 'error' }; }
    if (patch === null) {
      return { ok: true, doc: _copyDoc(doc), reason: 'already_recorded' };
    }
    patch = patch || {};
    var where = { roomId: rid, rev: curRev };
    var ex = (typeof whereExtra === 'function') ? whereExtra(doc) : whereExtra;
    if (ex) for (var k in ex) if (hasOwn(ex, k)) where[k] = ex[k];
    patch.rev = curRev + 1;
    patch.updatedAt = _sd();
    return Promise.resolve().then(function () {
      return col.where(where).update({ data: patch });
    }).then(function (r) {
      var up = (r && r.stats) ? r.stats.updated : 0;
      if (!up) {
        return { ok: !!alreadyOk, doc: null,
                 reason: alreadyOk ? 'already_recorded' : 'conflict' };
      }
      var full = _copyDoc(doc);
      for (var k2 in patch) if (hasOwn(patch, k2)) full[k2] = patch[k2];
      _latestDoc = full;
      if (Array.isArray(full.movesUci)) _movesUci = full.movesUci.slice();
      if (_local) {
        _local.rev = curRev + 1;
        if (full.status) _local.status = full.status;
      }
      _persistLocal();
      return { ok: true, doc: full, reason: 'ok' };
    });
  }).catch(function (e) {
    return { ok: false, doc: null, reason: _errReason(e) };
  });
}

/** 心跳：写本侧 present=true + onlineAt，rev+1。房主与好友各写自己那侧。 */
function heartbeat() {
  var side = _sideOf();
  if (!side) return Promise.resolve({ ok: false, doc: null, reason: 'no_room' });
  return _casPatch(null, function () {
    var p = {};
    p[side + 'Present'] = true;
    p[side + 'OnlineAt'] = Date.now();
    return p;
  });
}

/** 标记本方退出：present=false + leftAt=now，rev+1。**不清 _local**：
 *  退出对局 ≠ 离开房间，readLocalRoom() 仍要能读回 seat 供「重新加入」。 */
function markLeft() {
  var side = _sideOf();
  if (!side) return Promise.resolve({ ok: false, doc: null, reason: 'no_room' });
  return _casPatch(null, function () {
    var p = {};
    p[side + 'Present'] = false;
    p[side + 'LeftAt'] = Date.now();
    return p;
  });
}

/** 双方均退出：标记 keepUntil=now+bothLeftKeepMs，rev+1（已标记则幂等不写）。 */
function markBothLeft() {
  return _casPatch(null, function (doc) {
    if (doc.keepUntil) return null;
    return { keepUntil: Date.now() + (ROOM.bothLeftKeepMs || 600000) };
  });
}

/** 重新加入：凭 seat 复占已开局的房（不能走 joinRoom，它 CAS 硬带 rev:0）。
 *  -> Promise<{ok, role, color, doc, reason}>；错误 seat → conflict 且不改文档。 */
function rejoinRoom(roomId, seat) {
  var col = _col();
  if (!col) return Promise.resolve({ ok: false, role: '', color: '', doc: null, reason: 'unavailable' });
  if (typeof roomId !== 'string' || !/^[0-9]{6}$/.test(roomId)) {
    return Promise.resolve({ ok: false, role: '', color: '', doc: null, reason: 'invalid_room' });
  }
  if (typeof seat !== 'string' || !seat) {
    return Promise.resolve({ ok: false, role: '', color: '', doc: null, reason: 'invalid' });
  }
  return Promise.resolve().then(function () {
    return col.where({ roomId: roomId }).limit(1).get();
  }).then(function (res) {
    var doc = (res && res.data && res.data.length) ? res.data[0] : null;
    if (!doc) return { ok: false, role: '', color: '', doc: null, reason: 'not_found' };
    var role = (doc.hostSeat === seat) ? 'host' : (doc.guestSeat === seat) ? 'guest' : '';
    if (!role) return { ok: false, role: '', color: '', doc: null, reason: 'conflict' };
    if (doc.status === 'abandoned') {
      return { ok: false, role: '', color: '', doc: null, reason: 'expired' };
    }
    var curRev = (typeof doc.rev === 'number') ? doc.rev : 0;
    var patch = {};
    patch[role + 'Present'] = true;
    patch[role + 'LeftAt'] = 0;
    patch[role + 'OnlineAt'] = Date.now();
    patch.rev = curRev + 1;
    patch.updatedAt = _sd();
    if (doc.keepUntil) patch.keepUntil = 0;   // 重新加入后取消解散倒计时
    var where = { roomId: roomId, rev: curRev };
    where[role + 'Seat'] = seat;
    return Promise.resolve().then(function () {
      return col.where(where).update({ data: patch });
    }).then(function (r) {
      var up = (r && r.stats) ? r.stats.updated : 0;
      if (!up) return { ok: false, role: '', color: '', doc: null, reason: 'conflict' };
      var full = _copyDoc(doc);
      for (var k in patch) if (hasOwn(patch, k)) full[k] = patch[k];
      var color = (role === 'host') ? (doc.hostColor || 'w')
                                   : (doc.hostColor === 'w' ? 'b' : 'w');
      _local = { roomId: roomId, seat: seat, role: role, color: color,
                 rev: curRev + 1, status: full.status || 'playing' };
      _roomId = roomId;
      _movesUci = Array.isArray(full.movesUci) ? full.movesUci.slice() : [];
      _latestDoc = full;
      _paused = false; _closed = false;
      _persistLocal();
      return { ok: true, role: role, color: color, doc: full, reason: 'ok' };
    });
  }).catch(function (e) {
    return { ok: false, role: '', color: '', doc: null, reason: _errReason(e) };
  });
}

/** 房主设局数（仅 waiting 阶段；0=无限模式）。非房主 → denied。 */
function setMaxGames(maxGames) {
  if (!_local || _local.role !== 'host') {
    return Promise.resolve({ ok: false, doc: null, reason: 'denied' });
  }
  var n = (typeof maxGames === 'number' && isFinite(maxGames) && maxGames >= 0)
    ? Math.floor(maxGames) : (ROOM.maxGamesDefault || 0);
  return _casPatch({ status: 'waiting' }, function () { return { maxGames: n }; });
}

/** 记录一局结束：gamesPlayed/gameIndex/比分递增。
 *  where 带 gamesPlayed 作幂等键 ⇒ 两端同时收到结束快照也只会记一局。
 *  draw 不计比分；hostColor 不为 'w' 时按实际执棋色反推归属。 */
function recordGameResult(result) {
  return _casPatch(
    function (doc) {
      return { gamesPlayed: (typeof doc.gamesPlayed === 'number') ? doc.gamesPlayed : 0 };
    },
    function (doc) {
      var played = (typeof doc.gamesPlayed === 'number') ? doc.gamesPlayed : 0;
      var hs = (typeof doc.hostScore === 'number') ? doc.hostScore : 0;
      var gs = (typeof doc.guestScore === 'number') ? doc.guestScore : 0;
      var hc = (doc.hostColor === 'b') ? 'b' : 'w';
      var whiteWin = (result === RESULT.materialWhite || result === 'white_win');
      var blackWin = (result === RESULT.materialBlack || result === 'black_win');
      var hostWon = (whiteWin && hc === 'w') || (blackWin && hc === 'b');
      var guestWon = (whiteWin && hc === 'b') || (blackWin && hc === 'w');
      if (hostWon) hs++;
      else if (guestWon) gs++;
      return { gamesPlayed: played + 1, gameIndex: played + 2,
               hostScore: hs, guestScore: gs };
    },
    true
  );
}

/** 封存残局：不判成绩（不写 result），写完整着法快照 + status='archived'。 */
function archiveGame() {
  return _casPatch(null, function (doc) {
    if (doc.archived) return null;   // 幂等：已封存不重复写
    return {
      archived: true,
      archivedMovesUci: Array.isArray(doc.movesUci) ? doc.movesUci.slice() : [],
      archivedAt: Date.now(),
      archivedBy: _sideOf() || 'host',
      status: 'archived'
    };
  });
}

/** 结束对弈（按兵力判定）：winnerColor ∈ 'w'|'b'|null → 引擎语义 doc.result；
 *  reason 是 ROOM_RESULT.*。CAS where **不带 status**（封存/结束后仍能写入）。 */
function finishByMaterial(winnerColor, reason) {
  var result = (winnerColor === 'w') ? 'white_win'
             : (winnerColor === 'b') ? 'black_win' : 'draw';
  return _casPatch(null, function () {
    return {
      result: result,
      resultReason: (typeof reason === 'string' && reason) ? reason : RESULT.draw,
      status: 'finished'
    };
  });
}

/** 查本人作为房主创建过的封存残局（items 必带 movesUci，供「继续残局」重放）。
 *  where 用 _openid:'{openid}' 占位，云端安全规则 read:true 下只命中自己建的房。 */
function listArchivedRooms() {
  var col = _col();
  if (!col) return Promise.resolve({ ok: false, items: [], reason: 'unavailable' });
  return Promise.resolve().then(function () {
    return col.where({ _openid: '{openid}', archived: true }).get();
  }).then(function (res) {
    var rows = (res && res.data) ? res.data : [];
    var items = [];
    for (var i = 0; i < rows.length; i++) {
      var d = rows[i] || {};
      var mv = Array.isArray(d.archivedMovesUci) ? d.archivedMovesUci.slice() : [];
      items.push({
        roomId: d.roomId || '',
        archivedAt: (typeof d.archivedAt === 'number') ? d.archivedAt : 0,
        movesCount: mv.length,
        hostNick: d.hostNick || '', guestNick: d.guestNick || '',
        movesUci: mv,
        hostColor: d.hostColor || 'w',
        maxGames: (typeof d.maxGames === 'number') ? d.maxGames : 0,
        gameIndex: (typeof d.gameIndex === 'number') ? d.gameIndex : 1,
        gamesPlayed: (typeof d.gamesPlayed === 'number') ? d.gamesPlayed : 0,
        hostScore: (typeof d.hostScore === 'number') ? d.hostScore : 0,
        guestScore: (typeof d.guestScore === 'number') ? d.guestScore : 0
      });
    }
    // 本地离线索引：键名含大写 A ⇒ 不匹配 sync.js 的 KEY_RE ⇒ 天然不被镜像进 chess_records。
    try {
      if (typeof wx !== 'undefined' && typeof wx.setStorageSync === 'function') {
        wx.setStorageSync(KEYS.roomArchive, { version: 1, items: items });
      }
    } catch (e) {}
    return { ok: true, items: items, reason: 'ok' };
  }).catch(function (e) {
    return { ok: false, items: [], reason: _errReason(e) };
  });
}

/**
 * 补判「双方均退出且已过 10 分钟保留期」的房间：自动解散 + 自动封存残局，不判成绩。
 *
 * 【平台约束】本项目零云函数、纯 wx.cloud 前端直连，没有任何服务端定时器。两端都退出
 * 且都不再打开小程序时，没有任何代码能在超时那一刻执行。故由任一端之后重新进入房间页
 * 时调用本函数做**最终一致性兜底**：按 keepUntil 补判，把过期房补封存并置
 * status='abandoned'。用户可感知结果一致（回来时看到房间已解散、残局已封存），
 * 只是执行时刻延后到「有人回来」。这是该架构下的固有限制，不可通过客户端消除。
 *
 * 只扫自己作为房主创建的房（_openid 占位，最多前端 get 一次 20 条，好友邀请场景足够）；
 * CAS where 带 archived:false + rev ⇒ 幂等，多端重复扫不会重复封存。
 * -> Promise<{ok, swept, reason}>
 */
function sweepAbandoned() {
  var col = _col();
  if (!col) return Promise.resolve({ ok: false, swept: 0, reason: 'unavailable' });
  var now = Date.now();
  return Promise.resolve().then(function () {
    return col.where({ _openid: '{openid}', archived: false }).get();
  }).then(function (res) {
    var rows = (res && res.data) ? res.data : [];
    var expired = [];
    for (var i = 0; i < rows.length; i++) {
      var d = rows[i] || {};
      if (typeof d.keepUntil === 'number' && d.keepUntil > 0 && d.keepUntil <= now) {
        expired.push(d);
      }
    }
    if (!expired.length) return { ok: true, swept: 0, reason: 'ok' };
    var chain = Promise.resolve(0);
    expired.forEach(function (d) {
      chain = chain.then(function (n) {
        var curRev = (typeof d.rev === 'number') ? d.rev : 0;
        // 不写 result / resultReason：不判成绩；archivedBy 保持原值（系统补判非人为操作）。
        var patch = {
          archived: true,
          archivedMovesUci: Array.isArray(d.movesUci) ? d.movesUci.slice() : [],
          archivedAt: now,
          status: 'abandoned',
          rev: curRev + 1,
          updatedAt: _sd()
        };
        return Promise.resolve().then(function () {
          return col.where({ roomId: d.roomId, rev: curRev, archived: false })
            .update({ data: patch });
        }).then(function (r) {
          var up = (r && r.stats) ? r.stats.updated : 0;
          return n + (up ? 1 : 0);
        }).catch(function () { return n; });
      });
    });
    return chain.then(function (n) { return { ok: true, swept: n, reason: 'ok' }; });
  }).catch(function (e) {
    return { ok: false, swept: 0, reason: _errReason(e) };
  });
}

/** 读回本地 seat/roomId 断点（_persistLocal 只写不读，这里是配套读回）；
 *  直连 wx.getStorageSync，绝不依赖 storage 模块（独立通道铁律）。 */
function readLocalRoom() {
  try {
    if (typeof wx === 'undefined' || typeof wx.getStorageSync !== 'function') return null;
    var v = wx.getStorageSync(KEYS.room);
    if (!v || typeof v !== 'object' || !v.roomId || !v.seat) return null;
    return {
      roomId: String(v.roomId), seat: String(v.seat),
      role: String(v.role || ''), color: String(v.color || ''),
      rev: (typeof v.rev === 'number') ? v.rev : -1,
      status: String(v.status || '')
    };
  } catch (e) { return null; }
}

// ---------------------------------------------------------------------------
// 实时订阅 + 轮询兜底
// ---------------------------------------------------------------------------
function _closeWatcher() {
  if (_watcher) {
    try { if (typeof _watcher.close === 'function') _watcher.close(); } catch (e) {}
    _watcher = null;
  }
}
function _stopPoll() {
  if (_pollTimer) {
    try { clearInterval(_pollTimer); } catch (e) {}
    _pollTimer = null;
  }
}
function _startPoll() {
  _stopPoll();
  try {
    _pollTimer = setInterval(function () {
      if (_closed) return;
      // 轮询是两端一致的硬保险：watch 可能不可用、被冻结或静默超过 watchGuardMs，
      // 但每 pollIntervalMs 必然拉一次；_lastWatchAt 记录静默时长供诊断。
      pollOnce().catch(function () {});
    }, ROOM.pollIntervalMs);
    // Node 回归：避免轮询定时器阻止进程退出（小游戏端 setInterval 返回数值，天然跳过）
    if (_pollTimer && typeof _pollTimer.unref === 'function') _pollTimer.unref();
  } catch (e) { _pollTimer = null; }
}

/**
 * 订阅房间。handlers:{onSnapshot(doc), onError(reason)} -> boolean（是否成功订阅）。
 * 优先 .watch() 实时推送；同时无条件启动轮询兜底。watch 不可用/非函数时不失败，
 * 仅靠轮询继续工作（能力防御，Node / 旧基础库零异常）。
 */
function watchRoom(roomId, handlers) {
  if (!roomId || !isAvailable()) return false;
  var col = _col();
  if (!col) return false;
  _roomId = roomId;
  _handlers = handlers || {};
  _closed = false;
  _paused = false;
  if (!_local) _local = _emptyLocal();
  if (!_local.roomId) _local.roomId = roomId;
  _startPoll();                         // 硬保险：先启轮询
  try {
    var q = col.where({ roomId: roomId });
    if (q && typeof q.watch === 'function') {
      _watcher = q.watch({
        onChange: function (snapshot) {
          if (_closed) return;
          _deliver(_extractDoc(snapshot));
        },
        onError: function (e) {
          if (_closed) return;
          _lastWatchAt = Date.now();
          if (_handlers && typeof _handlers.onError === 'function') {
            try { _handlers.onError(_errReason(e)); } catch (x) {}
          }
        }
      });
    }
  } catch (e) { _watcher = null; }      // watch 不可用不失败，轮询继续
  return true;
}

/** 主动拉一次并（按 rev 去重）回调 onSnapshot。-> Promise<{ok, doc, reason}> */
function pollOnce() {
  var col = _col();
  if (!col) return _fail();
  var rid = _roomId || (_local && _local.roomId) || '';
  if (!rid) return Promise.resolve({ ok: false, doc: null, reason: 'no_room' });
  return Promise.resolve().then(function () {
    return col.where({ roomId: rid }).limit(1).get();
  }).then(function (res) {
    var doc = (res && res.data && res.data.length) ? res.data[0] : null;
    if (!doc) return { ok: false, doc: null, reason: 'not_found' };
    _lastWatchAt = Date.now();
    _deliver(doc);
    return { ok: true, doc: doc, reason: 'ok' };
  }).catch(function (e) {
    return { ok: false, doc: null, reason: _errReason(e) };
  });
}

/** 关 watch + 清轮询定时器 + 清 handlers。 */
function stopWatch() {
  _closeWatcher();
  _stopPoll();
  _handlers = null;
  _closed = true;
}

/** onShow：若曾 onHide 且仍有房间，则重建 watch + 立即 pollOnce。 */
function onForeground() {
  if (!_paused) return;
  _paused = false;
  if (!_roomId) return;
  if (_savedHandlers) _handlers = _savedHandlers;
  watchRoom(_roomId, _handlers || {});
  pollOnce().catch(function () {});
}

/** onHide：停订阅但保留 _local / _roomId / _handlers（供 onForeground 恢复）。 */
function onBackground() {
  _paused = true;
  _savedHandlers = _handlers;
  stopWatch();
}

/** 状态浅拷贝：v4 的 7 字段 + v5 扩展字段。
 *  扩展字段从 _latestDoc 读：场景层首次进入可能还没收到 watch 快照，
 *  靠这里拿对端昵称、比分与仲裁初值（缺失一律回落等价默认值，绝不抛异常）。 */
function getState() {
  var d = _latestDoc || {};
  function num(k, def) { return (typeof d[k] === 'number') ? d[k] : def; }
  function str(k) { return (typeof d[k] === 'string') ? d[k] : ''; }
  function bool(k, def) { return (typeof d[k] === 'boolean') ? d[k] : def; }
  return {
    roomId: _local ? _local.roomId : '',
    seat: _local ? _local.seat : '',
    role: _local ? _local.role : '',
    color: _local ? _local.color : '',
    rev: _local ? _local.rev : -1,
    status: _local ? _local.status : '',
    movesUci: _movesUci ? _movesUci.slice() : [],
    hostNick: str('hostNick'), guestNick: str('guestNick'),
    maxGames: num('maxGames', ROOM.maxGamesDefault || 0),
    gameIndex: num('gameIndex', 1), gamesPlayed: num('gamesPlayed', 0),
    hostScore: num('hostScore', 0), guestScore: num('guestScore', 0),
    hostPresent: bool('hostPresent', false), guestPresent: bool('guestPresent', false),
    hostLeftAt: num('hostLeftAt', 0), guestLeftAt: num('guestLeftAt', 0),
    keepUntil: num('keepUntil', 0), archived: bool('archived', false),
    turn: str('turn') || 'w', result: d.result || null
  };
}

/** 离开房间：stopWatch + 清本地态；host 且 waiting 时删空房（guest 不删）。 */
function leaveRoom() {
  var wasEmptyHost = _local && _local.role === 'host' && _local.status === 'waiting';
  var rid = _roomId || (_local && _local.roomId) || '';
  stopWatch();
  _local = _emptyLocal();
  _roomId = '';
  _movesUci = [];
  _paused = false;
  if (!wasEmptyHost || !rid) return;
  try {
    var col = _col();
    if (!col) return;
    Promise.resolve().then(function () {
      return col.where({ roomId: rid, _openid: '{openid}' }).remove();
    }).catch(function () {});   // 清房 best-effort，绝不 throw / 不阻塞
  } catch (e) {}
}

/** 删当前用户创建的所有房间（供 sync.requestDeleteAll 调用）。-> Promise<{ok, removed, reason}> */
function deleteAllRooms() {
  var col = _col();
  if (!col) return Promise.resolve({ ok: false, removed: 0, reason: 'unavailable' });
  return Promise.resolve().then(function () {
    return col.where({ _openid: '{openid}' }).remove();
  }).then(function (r) {
    var n = (r && r.stats) ? r.stats.removed : 0;
    return { ok: true, removed: n, reason: 'ok' };
  }).catch(function (e) {
    return { ok: false, removed: 0, reason: _errReason(e) };
  });
}

/** 清全部状态，供测试。 */
function reset() {
  stopWatch();
  _local = _emptyLocal();
  _movesUci = [];
  _roomId = '';
  _lastWatchAt = 0;
  _latestDoc = null;
  _handlers = null;
  _savedHandlers = null;
  _paused = false;
  _closed = true;
  _db = null;
  _inited = false;
}

module.exports = {
  isAvailable: isAvailable,
  init: init,
  genRoomCode: genRoomCode,
  genSeat: genSeat,
  createRoom: createRoom,
  joinRoom: joinRoom,
  getRoom: getRoom,
  pushMove: pushMove,
  watchRoom: watchRoom,
  stopWatch: stopWatch,
  pollOnce: pollOnce,
  onForeground: onForeground,
  onBackground: onBackground,
  getState: getState,
  leaveRoom: leaveRoom,
  deleteAllRooms: deleteAllRooms,
  reset: reset,
  // ---- v5：退出仲裁 / 封存残局 / 多局比分 / 在线心跳 ----
  heartbeat: heartbeat,
  markLeft: markLeft,
  markBothLeft: markBothLeft,
  rejoinRoom: rejoinRoom,
  setMaxGames: setMaxGames,
  recordGameResult: recordGameResult,
  archiveGame: archiveGame,
  finishByMaterial: finishByMaterial,
  listArchivedRooms: listArchivedRooms,
  sweepAbandoned: sweepAbandoned,
  readLocalRoom: readLocalRoom
};
