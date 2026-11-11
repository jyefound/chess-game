/**
 * 独立集成冒烟测试（主理人汇编验证用）
 * 用 mock 微信环境把 game.js 入口真正启动，验证跨模块装配、场景切换、
 * AI 分帧步进、UCI/三次重复/回放、存储往返、教学三态不泄题。
 * 运行：node test-integration.js
 */
'use strict';

const fs = require('fs');
const path = require('path');

let passed = 0, failed = 0;
const failures = [];
function ok(name, cond, detail) {
  if (cond) { passed++; console.log('  ✓ ' + name); }
  else { failed++; failures.push(name + (detail ? ' | ' + detail : '')); console.log('  ✗ ' + name + (detail ? ' | ' + detail : '')); }
}
function section(t) { console.log('\n=== ' + t + ' ==='); }

// ---------- mock 画布上下文（Proxy 吸收所有绘制调用）----------
function makeCtx() {
  const store = {};
  const defaults = {
    globalAlpha: 1, lineWidth: 1, font: '16px sans-serif', fillStyle: '#000',
    strokeStyle: '#000', textAlign: 'left', textBaseline: 'top', shadowBlur: 0,
    shadowOffsetX: 0, shadowOffsetY: 0, shadowColor: 'transparent',
    lineCap: 'butt', lineJoin: 'miter', globalCompositeOperation: 'source-over', miterLimit: 10
  };
  Object.assign(store, defaults);
  return new Proxy(store, {
    get(t, p) {
      if (p in t) return t[p];
      if (p === 'measureText') return (s) => {
        const w = String(s == null ? '' : s).length * 9;
        return { width: w, actualBoundingBoxAscent: 18, actualBoundingBoxDescent: 5,
          actualBoundingBoxLeft: 0, actualBoundingBoxRight: w };
      };
      if (p === 'createLinearGradient' || p === 'createRadialGradient' || p === 'createPattern')
        return () => ({ addColorStop() {} });
      if (p === 'getImageData') return () => ({ data: new Uint8ClampedArray(4) });
      if (p === 'canvas') return { width: 750, height: 1334 };
      if (p === 'isPointInPath' || p === 'isPointInStroke') return () => false;
      return () => {}; // 其余绘制方法 noop
    },
    set(t, p, v) { t[p] = v; return true; }
  });
}

// ---------- mock 微信环境 ----------
const storageMap = {};
const touchHandlers = {};
let launchOpts = {};   // R2：可由冷启动路由用例注入 query.room（默认 {} 保持既有冒烟语义）
let rafCb = null;

function makeAudio() {
  return {
    src: '', loop: false, volume: 1, obeyMuteSwitch: true,
    play() {}, pause() {}, stop() {}, destroy() {},
    onError() {}, onCanplay() {}, onEnded() {}, offError() {}, offCanplay() {}, offEnded() {}
  };
}

// ---------- v3 可选能力 mock（云数据库 / 隐私 / 键盘 / 故障注入）----------
// 为「云端持久化 + 隐私授权」架构提供可配置、可故障注入的 wx 能力 mock。
// 默认（CHESS_CLOUD_MOCK 未设为 full）**完全不挂** wx.cloud / 隐私接口 / 键盘接口，
// 即「默认降级本地」模式 —— 六套回归 59/0 基线运行时的形态，既有断言一字不受影响。
// 设 CHESS_CLOUD_MOCK=full 时整套能力挂上，用于验证「即便具备完整云能力，
// CLOUD_CONFIG.enabled=false 时 game.js 冷启动仍零云调用、装配不崩」。
const CLOUD_MOCK_ON = process.env.CHESS_CLOUD_MOCK === 'full';

function makeCloudMock() {
  const FIXED_OPENID = 'test_openid_fixed';
  const store = {};                 // collection name -> docs[]
  const calls = { init: 0, database: 0, get: 0, add: 0, update: 0, remove: 0, serverDate: 0, where: 0, addRejectedClientId: 0 };
  const flags = { cloudInitThrows: false, cloudGetFails: false, cloudAddTooLarge: false, cloudPermissionDenied: false };
  let docSeq = 0;
  let lastEnv = null;
  const hasOwn = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
  const tooLarge = (o) => { try { return JSON.stringify(o).length > 512 * 1024; } catch (e) { return false; } };
  const clone = (o) => { try { return JSON.parse(JSON.stringify(o)); } catch (e) { return o; } };
  const permErr = () => { const e = new Error('database permission denied'); e.errMsg = 'database permission denied'; return e; };
  function match(d, w) {
    for (const k in w) if (hasOwn(w, k)) {
      const v = w[k];
      // 微信平台把 where 的 '{openid}' 占位符替换成当前用户 openid；mock 用固定 openid 比对。
      if (k === '_openid') { if (d._openid !== FIXED_OPENID) return false; continue; }
      if (JSON.stringify(d[k]) !== JSON.stringify(v)) return false;
    }
    return true;
  }
  function collection(name) {
    const docs = store[name] || (store[name] = []);
    let _where = null, _skip = 0, _limit = null;
    const api = {
      where(w) { calls.where++; _where = w || {}; return api; },
      orderBy() { return api; },
      skip(n) { _skip = n | 0; return api; },
      limit(n) { _limit = n; return api; },
      get() {
        calls.get++;
        return new Promise((res, rej) => {
          if (flags.cloudGetFails) return rej(new Error('get fail: network error'));
          if (flags.cloudPermissionDenied) return rej(permErr());
          // 平台约束：where 未带 _openid:'{openid}' → database permission denied
          if (!_where || _where._openid === undefined) return rej(permErr());
          const list = docs.filter(d => match(d, _where));
          const lim = Math.min(_limit == null ? 20 : _limit, 20); // get 一次最多 20 条
          res({ data: list.slice(_skip, _skip + lim).map(clone) });
        });
      },
      add(arg) {
        calls.add++;
        const data = (arg && arg.data) || {};
        return new Promise((res, rej) => {
          // 平台约束：文档超 512KB 报错（cloudAddTooLarge 为故障注入开关）
          if (flags.cloudAddTooLarge || tooLarge(data)) return rej(new Error('add fail: document exceeds 512KB limit'));
          // 平台约束：拒绝客户端显式传 _openid / _id
          if (hasOwn(data, '_openid') || hasOwn(data, '_id')) { calls.addRejectedClientId++; return rej(new Error('add fail: client _openid/_id')); }
          const doc = clone(data);
          doc._openid = FIXED_OPENID;            // 平台注入，不可伪造
          doc._id = 'doc_' + (++docSeq);
          docs.push(doc);
          res({ _id: doc._id });
        });
      },
      update(arg) {
        calls.update++;
        const data = (arg && arg.data) || {};
        return new Promise((res, rej) => {
          if (flags.cloudPermissionDenied) return rej(permErr());
          if (!_where || _where._openid === undefined) return rej(permErr());
          if (tooLarge(data)) return rej(new Error('update fail: document exceeds 512KB limit'));
          const hits = docs.filter(d => match(d, _where));
          hits.forEach(d => { for (const k in data) if (hasOwn(data, k)) d[k] = clone(data[k]); });
          res({ stats: { updated: hits.length } });
        });
      },
      remove() {
        calls.remove++;
        return new Promise((res, rej) => {
          if (flags.cloudPermissionDenied) return rej(permErr());
          if (!_where || _where._openid === undefined) return rej(permErr());
          const hits = docs.filter(d => match(d, _where));
          let n = 0;
          hits.forEach(d => { const i = docs.indexOf(d); if (i >= 0) { docs.splice(i, 1); n++; } });
          res({ stats: { removed: n } });
        });
      },
      count() { return Promise.resolve({ total: docs.filter(d => match(d, _where || {})).length }); }
    };
    return api;
  }
  const cloud = {
    init(o) { calls.init++; lastEnv = (o && o.env) || null; if (flags.cloudInitThrows) throw new Error('cloud init failed'); },
    database() {
      calls.database++;
      return {
        serverDate() { calls.serverDate++; return { __serverDate: true, getTime() { return Date.now(); } }; },
        collection
      };
    }
  };
  return { cloud, flags, calls, store, FIXED_OPENID, get env() { return lastEnv; } };
}
const cloudMock = makeCloudMock();

function makePrivacyMock() {
  const flags = { needAuthorization: false, authorizeSuccess: true };
  const calls = { setting: 0, authorize: 0, contract: 0 };
  return {
    flags, calls,
    getPrivacySetting(o) { calls.setting++; o && o.success && o.success({ needAuthorization: !!flags.needAuthorization }); },
    requirePrivacyAuthorize(o) { calls.authorize++; if (flags.authorizeSuccess) { o && o.success && o.success({}); } else { o && o.fail && o.fail({}); } },
    openPrivacyContract(o) { calls.contract++; o && o.success && o.success({}); }
  };
}
const privacyMock = makePrivacyMock();

// 键盘接口（能力探测降级测试用；present 可切）
const keyboardFlags = { present: true };
const keyboardMock = {
  showKeyboard() {}, onKeyboardInput() {}, onKeyboardConfirm() {},
  offKeyboardInput() {}, offKeyboardConfirm() {}, hideKeyboard() {}
};

global.wx = {
  createCanvas() { return { width: 750, height: 1334, getContext() { return makeCtx(); } }; },
  getSystemInfoSync() { return { windowWidth: 375, windowHeight: 667, pixelRatio: 2 }; },
  onTouchStart(fn) { touchHandlers.start = fn; },
  onTouchMove(fn) { touchHandlers.move = fn; },
  onTouchEnd(fn) { touchHandlers.end = fn; },
  onTouchCancel(fn) { touchHandlers.cancel = fn; },
  onHide(fn) { touchHandlers.hide = fn; },
  onShow(fn) { touchHandlers.show = fn; },
  createInnerAudioContext() { return makeAudio(); },
  setStorageSync(k, v) { storageMap[k] = v; },
  getStorageSync(k) { return Object.prototype.hasOwnProperty.call(storageMap, k) ? storageMap[k] : ''; },
  removeStorageSync(k) { delete storageMap[k]; },
  clearStorageSync() { for (const k in storageMap) delete storageMap[k]; },
  showToast() {}, hideToast() {}, showModal(o) { if (o && o.success) o.success({ confirm: true }); },
  setKeepScreenOn() {}, triggerGC() {}, vibrateShort() {},
  getLaunchOptionsSync() { return launchOpts; },
  // R2 远程对弈入口 / 分享 / 房间所需 wx 能力（全部 no-op）。
  // 刻意不挂 wx.cloud：房间模块必须在「无云能力」时静默降级（契约：能力防御）。
  // onShow/onHide 保持原有 fn 签名（touchHandlers.show/hide），兼容生命周期冒烟；
  // onShareAppMessage 保存回调，供「默认分享卡返回值」断言直接调用。
  getEnterOptionsSync() { return {}; },
  onShareAppMessage(fn) { touchHandlers.share = fn; }, showShareMenu() {}, shareAppMessage() {},
  setClipboardData() {}
};
// 仅在 full 模式把可选能力追加到 global.wx（既有断言所依赖的属性一字未动）。
// 默认不挂 = 「完全不挂 wx.cloud 与隐私接口」模式，用于证明默认降级本地。
if (CLOUD_MOCK_ON) {
  Object.assign(global.wx, {
    cloud: cloudMock.cloud,
    getPrivacySetting: privacyMock.getPrivacySetting,
    requirePrivacyAuthorize: privacyMock.requirePrivacyAuthorize,
    openPrivacyContract: privacyMock.openPrivacyContract
  });
  if (keyboardFlags.present) Object.assign(global.wx, keyboardMock);
}
global.requestAnimationFrame = (fn) => { rafCb = fn; return 1; };
global.cancelAnimationFrame = () => {};

// =====================================================================
section('A. 纯逻辑集成（不启动入口）');

const ChessGame = require('./src/core/game');
const Board = require('./src/core/board');
const ai = require('./src/core/ai');
const movegen = require('./src/core/movegen');
const { COLOR } = require('./src/core/constants');

// A1 UCI 记谱
{
  const g = new ChessGame();
  const m = g.getLegalMoves().find(x => x.fromRow === 6 && x.fromCol === 4 && x.toRow === 4 && x.toCol === 4);
  g.makeMove(m); // e2e4
  ok('UCI 记录 e2e4', g.getMovesUci().join(',') === 'e2e4', 'got=' + g.getMovesUci());
  ok('startFen 常量存在', typeof g.startFen === 'string' && g.startFen.includes('rnbqkbnr'));
  ok('SAN 与 UCI 平行', g.moveLog.length === g.uciLog.length);
}

// A2 升变 UCI 带后缀
{
  const g = new ChessGame();
  g.board.grid = Array.from({ length: 8 }, () => Array(8).fill(null));
  g.board.setPiece(1, 0, { type: 'p', color: 'w' });
  g.board.setPiece(7, 4, { type: 'k', color: 'w' });
  g.board.setPiece(0, 4, { type: 'k', color: 'b' });
  const promo = g.getLegalMoves().find(x => x.promotion === 'q' && x.toRow === 0 && x.toCol === 0);
  if (promo) { g.makeMove(promo); ok('升变 UCI 后缀 a7a8q', g.getMovesUci()[0] === 'a7a8q', 'got=' + g.getMovesUci()); }
  else ok('升变 UCI 后缀 a7a8q', false, '未找到升变走法');
}

// A3 三次重复（Nf3 Nf6 Ng1 Ng8 循环两轮回到初始局面 3 次；需由行棋方申请和棋）
{
  const g = new ChessGame();
  const seq = [
    [7,6,5,5], [0,6,2,5], [5,5,7,6], [2,5,0,6], // 第一轮回初始
    [7,6,5,5], [0,6,2,5], [5,5,7,6], [2,5,0,6]  // 第二轮回初始
  ];
  let allOk = true;
  for (const [fr,fc,tr,tc] of seq) {
    const m = g.getLegalMoves().find(x => x.fromRow===fr && x.fromCol===fc && x.toRow===tr && x.toCol===tc);
    if (!m) { allOk = false; break; }
    g.makeMove(m);
  }
  ok('三次重复开放和棋申请但不自动结束',
    g.result === null && g.canClaimDraw() && g.getClaimableDrawReasons().includes('threefold'),
    'result=' + g.result + ' reason=' + g.resultReason + ' moves=' + g.uciLog.length);
  ok('三次重复可由行棋方申请和棋', g.claimDraw('threefold') === true &&
    g.result === 'draw' && g.resultReason === 'threefold');
  ok('三次重复走法执行完整', allOk);
}

// A4 悔棋回退 UCI 与 positionCounts
{
  const g = new ChessGame();
  const m = g.getLegalMoves().find(x => x.fromRow === 6 && x.fromCol === 4 && x.toRow === 4 && x.toCol === 4);
  g.makeMove(m);
  const before = g.getMovesUci().length;
  g.undoMove();
  ok('悔棋回退 UCI', g.getMovesUci().length === before - 1);
  ok('悔棋后无残留 result', g.result === null);
}

// A5 UCI 回放重建（正确 API：replayToPly(n, uciList)）
{
  const g = new ChessGame();
  const g1 = g.getLegalMoves().find(x => x.fromRow===6&&x.fromCol===4&&x.toRow===4&&x.toCol===4); g.makeMove(g1);
  const b1 = g.getLegalMoves().find(x => x.fromRow===1&&x.fromCol===4&&x.toRow===3&&x.toCol===4); g.makeMove(b1);
  const ucis = g.getMovesUci();
  const g2 = new ChessGame();
  let n = 0;
  if (typeof g2.replayToPly === 'function') n = g2.replayToPly(2, ucis);
  ok('replayToPly API 存在', typeof g2.replayToPly === 'function');
  ok('UCI 回放重建 2 步', n === 2 && g2.getMovesUci().join(',') === ucis.join(','), 'replayed=' + n);
}

// A6 AI 分帧 createSearch.step()
{
  const g = new ChessGame();
  const search = ai.createSearch(g.board, COLOR.BLACK, {
    castling: g.castling, enPassantTarget: g.enPassantTarget
  }, 3, 3000, 12);
  ok('createSearch 返回带 step', search && typeof search.step === 'function');
  let snap = null, steps = 0;
  while (steps < 2000) {
    snap = search.step();
    steps++;
    if (snap && snap.done) break;
  }
  ok('分帧搜索能收敛 done', !!(snap && snap.done), 'steps=' + steps);
  ok('分帧搜索产出合法 bestMove', !!(snap && snap.bestMove), 'bestMove=' + JSON.stringify(snap && snap.bestMove));
  ok('分帧步进 >1 帧（非同步一把梭）', steps > 1, 'steps=' + steps);
  // bestMove 必须属于「搜索方」的合法走法（此处搜索黑方，须用黑方生成而非 g.getLegalMoves()）
  if (snap && snap.bestMove) {
    const state = { castling: g.castling, enPassantTarget: g.enPassantTarget };
    const blackMoves = movegen.generateLegalMoves(g.board, COLOR.BLACK, state);
    const lm = blackMoves.some(m => m.fromRow===snap.bestMove.fromRow && m.fromCol===snap.bestMove.fromCol && m.toRow===snap.bestMove.toRow && m.toCol===snap.bestMove.toCol);
    ok('AI bestMove 是搜索方合法走法', lm, 'mate=' + JSON.stringify(snap.bestMove) + ' blackCnt=' + blackMoves.length);
  }
}

// A7 findBestMove 同步兜底仍可用
{
  const g = new ChessGame();
  const mv = ai.findBestMove(g.board, COLOR.WHITE, { castling: g.castling, enPassantTarget: null }, 2);
  ok('findBestMove 同步兜底可用', !!mv);
}

// A8 events 总线
{
  const events = require('./src/core/events');
  let got = null;
  const h = (p) => { got = p; };
  events.on('move', h);
  events.emit('move', { x: 42 });
  events.off('move', h);
  ok('events 收发', got && got.x === 42);
}

// A9 storage 往返 + 满额 + 写失败降级（mock wx 已注入）
{
  const storage = require('./src/core/storage');
  storage.clearAllRecords();
  const rec = { id: 'test001', mode: 'ai', result: 'white_win', movesUci: ['e2e4','e7e5'], sanLog: ['e4','e5'], plies: 2 };
  const r = storage.saveRecord(rec);
  ok('saveRecord 成功', r && r.ok !== false, JSON.stringify(r));
  const list = storage.listRecords();
  ok('listRecords 含保存项', list.some(x => x.id === 'test001'), 'count=' + list.length);
  const got = storage.getRecord('test001');
  ok('getRecord 往返', got && got.movesUci.join(',') === 'e2e4,e7e5');
  // 覆盖去重不新增
  storage.saveRecord(Object.assign({}, rec, { result: 'draw' }));
  ok('同 id 覆盖不重复', storage.listRecords().filter(x => x.id === 'test001').length === 1);
  storage.deleteRecord('test001');
  ok('deleteRecord 生效', !storage.listRecords().some(x => x.id === 'test001'));
  // 损坏数据读保护
  storageMap['chess.records.index.v1'] = '{bad json';
  const corrupted = storage.listRecords();
  ok('索引损坏安全降级为空数组', Array.isArray(corrupted) && corrupted.length === 0);
  ok('索引损坏不覆盖坏数据', storageMap['chess.records.index.v1'] === '{bad json');
  storage.clearAllRecords();
}

// A10 anim 累计 dt + reduceMotion
{
  const anim = require('./src/core/anim');
  anim.setReduceMotion(false);
  let v = 0, done = false;
  anim.createTween({ from: 0, to: 100, duration: 200, onUpdate: (x) => { v = x; }, onComplete: () => { done = true; } });
  anim.updateTweens(100); // ms
  const mid = v;
  anim.updateTweens(200);
  ok('anim 补间随 dt 推进', mid > 0 && mid < 100, 'mid=' + mid);
  ok('anim 补间可完成', done && v === 100, 'v=' + v);
  anim.setReduceMotion(true);
  ok('reduceMotion 开关生效', anim.getReduceMotion() === true);
  anim.setReduceMotion(false);
}

// =====================================================================
section('B. 入口装配 + 场景切换（mock 微信全环境启动 game.js）');

let GameContext, sceneManager, bootError = null;
try {
  require('./game.js');
  GameContext = require('./src/context');
  sceneManager = GameContext.get() && GameContext.get().sceneManager;
} catch (e) {
  bootError = e;
}
ok('入口 game.js 启动无异常', !bootError, bootError && (bootError.stack || bootError.message));
ok('GameContext 注入 gameInstance', !!(GameContext && GameContext.get()));
ok('sceneManager 已挂载', !!sceneManager);
ok('requestAnimationFrame 主循环已注册', typeof rafCb === 'function');
ok('触摸回调已注册(start/end)', typeof touchHandlers.start === 'function' && typeof touchHandlers.end === 'function');

if (sceneManager) {
  // R2：'room' 场景由 impl-room-ui 落盘。测试侧做能力防御的补偿注册：
  // 模块未落盘则打印跳过标注并从 need 剔除（保持原有 59 项断言编号不变）。
  let RoomScene = null;
  try { RoomScene = require('./src/scenes/room'); } catch (e) { RoomScene = null; }
  let roomRegistered = false;
  if (RoomScene && typeof sceneManager.register === 'function') {
    try {
      if (!sceneManager.scenes.room) sceneManager.register('room', new RoomScene());
      roomRegistered = !!sceneManager.scenes.room;
    } catch (e) { roomRegistered = false; }
  }
  // R3 IA 变更：主菜单改为单入口 'versus' → 新场景 src/scenes/versus.js。
  // 能力防御写法与 room 完全一致：模块未落盘则打印跳过标注并从 need 剔除（不产生空断言）。
  let VersusScene = null;
  try { VersusScene = require('./src/scenes/versus'); } catch (e) { VersusScene = null; }
  let versusRegistered = false;
  if (VersusScene && typeof sceneManager.register === 'function') {
    try {
      if (!sceneManager.scenes.versus) sceneManager.register('versus', new VersusScene());
      versusRegistered = !!sceneManager.scenes.versus;
    } catch (e) { versusRegistered = false; }
  }
  const need = ['menu','setup','gameplay','teaching','records','replay','settings'];
  const needV2 = ['academy','endgameMap','endgame'];
  if (roomRegistered) need.push('room');
  else console.log('  ⊘ 跳过：room 场景注册/冒烟（模块未落盘，集成时复跑）');
  if (versusRegistered) need.push('versus');
  else console.log('  ⊘ 跳过：versus 场景注册/冒烟（模块未落盘，集成时复跑）');
  for (const n of need) ok('场景已注册: ' + n, !!sceneManager.scenes[n]);
  for (const n of needV2) ok('场景已注册: ' + n, !!sceneManager.scenes[n]);
  ok('初始场景为 menu', sceneManager.currentSceneName === 'menu');

  // 手动跑一帧主循环（render menu）
  let loopErr = null;
  try { if (rafCb) rafCb(); } catch (e) { loopErr = e; }
  ok('主循环首帧 render(menu) 无异常', !loopErr, loopErr && (loopErr.stack || loopErr.message));

  // 逐场景切换 + update + render
  const enterParams = {
    menu: {}, setup: {}, teaching: {},
    gameplay: { mode: 'local' },
    settings: {}, records: {},
    academy: {},
    endgameMap: {},
    endgame: { level: 1 },
    room: { from: 'menu' },
    versus: { from: 'menu' },
    replay: { record: { id:'x', movesUci:['e2e4','e7e5'], sanLog:['e4','e5'], mode:'local', result:'ongoing', plies:2 } }
  };
  for (const n of need) {
    let err = null;
    try {
      sceneManager.switchTo(n, enterParams[n] || {});
      sceneManager.update(0.016);
      sceneManager.render();
    } catch (e) { err = e; }
    ok('场景 ' + n + ' switch+update+render 无异常', !err, err && (err.message));
  }
  for (const n of needV2) {
    let err = null;
    try {
      sceneManager.switchTo(n, enterParams[n] || {});
      sceneManager.update(0.016);
      sceneManager.render();
    } catch (e) { err = e; }
    ok('场景 ' + n + ' switch+update+render 无异常', !err, err && (err.message));
  }

  // R2：把「本地双人固定棋盘方向」回归也放进集成冒烟。
  // 严格落盘判据与 test-gameplay.js 一致：三处自动翻转清零 + toggleBoardFlip + 渲染接线；
  // 中间态整组跳过并标注，集成后自动转为真实断言。
  {
    const gpSrc = fs.readFileSync(path.join(__dirname, 'src/scenes/gameplay.js'), 'utf8');
    const wired = !/if\s*\(this\.mode === 'local'\)\s*this\.flipBoard\s*=/.test(gpSrc) &&
      /toggleBoardFlip/.test(gpSrc) && /topPiecesUpsideDown/.test(gpSrc);
    let sc = null, before = null, after = null, err = null;
    try {
      sceneManager.switchTo('gameplay', { mode: 'local' });
      sc = sceneManager.currentScene;
      before = sc && sc.flipBoard;
      if (sc && typeof sc.commitMove === 'function') {
        const lm = sc.game.getLegalMoves()[0];
        if (lm) sc.commitMove(lm, false);
      }
      after = sc && sc.flipBoard;
    } catch (e) { err = e; }
    if (wired) {
      ok('集成·本地双人 enter 后 flipBoard===false', !err && before === false,
        'before=' + before + (err ? ' err=' + err.message : ''));
      ok('集成·本地双人 commitMove 后 flipBoard 仍 false', !err && after === false,
        'after=' + after + (err ? ' err=' + err.message : ''));
    } else {
      console.log('  ⊘ 跳过：本地双人固定方向集成断言（impl-gameplay 未落盘，集成时复跑）' +
        ' 实测 enter=' + before + ' 走子后=' + after);
    }
  }

  // 场景栈 push/pop/replace
  let stackErr = null;
  try {
    sceneManager.switchTo('menu', {});
    sceneManager.push('setup', {});
    const afterPush = sceneManager.currentSceneName;
    sceneManager.pop();
    ok('场景栈 push→pop 回到 menu', afterPush === 'setup' && sceneManager.currentSceneName === 'menu',
      'push=' + afterPush + ' afterPop=' + sceneManager.currentSceneName);
  } catch (e) { stackErr = e; ok('场景栈 push→pop 回到 menu', false, stackErr.message); }

  // 触摸分发不崩
  let touchErr = null;
  try {
    sceneManager.switchTo('menu', {});
    touchHandlers.start && touchHandlers.start({ touches: [{ clientX: 180, clientY: 330 }], changedTouches: [] });
    touchHandlers.end && touchHandlers.end({ touches: [], changedTouches: [{ clientX: 180, clientY: 330 }] });
  } catch (e) { touchErr = e; }
  ok('触摸分发 onTouchStart/End 无异常', !touchErr, touchErr && touchErr.message);

  // 生命周期 onShow/onHide 不崩
  let lifeErr = null;
  try {
    touchHandlers.hide && touchHandlers.hide();
    touchHandlers.show && touchHandlers.show();
  } catch (e) { lifeErr = e; }
  ok('生命周期 onHide/onShow 无异常', !lifeErr, lifeErr && lifeErr.message);
}

// =====================================================================
section('C. 教学三态 · 防泄题');
{
  const TeachingScene = require('./src/scenes/teaching');
  const ts = new TeachingScene();
  let err = null;
  try {
    GameContext.set(GameContext.get()); // 确保上下文
    ts.enter({ screenWidth: 375, screenHeight: 667 });
    if (typeof ts.render === 'function') {
      const ctx = makeCtx();
      ts.render(ctx, 375, 667);
    }
  } catch (e) { err = e; }
  ok('教学场景 enter+render 无异常', !err, err && (err.stack || err.message));
  // 三态字段存在性检查（fe-logic 实现）
  const hasState = ('phase' in ts) || ('state' in ts) || ('mode' in ts) || ('lessonState' in ts);
  ok('教学含状态机字段', hasState, 'keys=' + Object.keys(ts).filter(k=>/phase|state|mode/i.test(k)).join(','));
}

// =====================================================================
// =====================================================================
// R2 · 房间码 6 位纯数字 端到端 round-trip + 房间路由/分享/菜单固化断言
// readRoomFromQuery / isRoomCode 未导出，故从源码原样提取函数体用 new Function
// 求值后调用，拿到「实际返回值」而非推断；并做静态检查确认它们被生产路径调用。
// =====================================================================
let finished = false;
function finish() {
  if (finished) return;
  finished = true;
  console.log('\n============================================================');
  console.log('集成冒烟结果: ' + passed + ' 通过 / ' + failed + ' 失败');
  if (failures.length) { console.log('失败项:'); failures.forEach(f => console.log('  - ' + f)); }
  console.log('============================================================');
  process.exit(failed === 0 ? 0 : 1);
}

section('D. R2 房间码 6 位纯数字 · 端到端 round-trip');
const configD = require('./src/config');
const roomD = require('./src/core/room');
const RoomSceneD = require('./src/scenes/room');
const MenuSceneD = require('./src/scenes/menu');
const gameSrcD = fs.readFileSync(path.join(__dirname, 'game.js'), 'utf8');
const roomSceneSrcD = fs.readFileSync(path.join(__dirname, 'src/scenes/room.js'), 'utf8');

/** 从源码原样提取具名函数体（大括号配对），用 new Function 求值返回函数本身。 */
function extractFn(src, name) {
  const start = src.indexOf('function ' + name + '(');
  if (start < 0) return null;
  const brace = src.indexOf('{', start);
  if (brace < 0) return null;
  let depth = 0;
  for (let i = brace; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (depth === 0) return src.slice(start, i + 1); }
  }
  return null;
}
let readRoomFromQuery = null, isRoomCode = null, extractErr = null;
try {
  const a = extractFn(gameSrcD, 'readRoomFromQuery');
  const b = extractFn(roomSceneSrcD, 'isRoomCode');
  if (a) readRoomFromQuery = new Function(a + '; return readRoomFromQuery;')();
  if (b) isRoomCode = new Function(b + '; return isRoomCode;')();
} catch (e) { extractErr = e; }
ok('D0 源码提取 readRoomFromQuery / isRoomCode 成功',
  !!readRoomFromQuery && !!isRoomCode && !extractErr,
  extractErr ? extractErr.message : ('read=' + !!readRoomFromQuery + ' isCode=' + !!isRoomCode));
if (!readRoomFromQuery) readRoomFromQuery = function () { return ''; };
if (!isRoomCode) isRoomCode = function () { return false; };
ok('D0b game.js 冷/热启动均经 readRoomFromQuery 路由（非死代码）',
  /routeShareQuery\(wx\.getLaunchOptionsSync\(\)\)/.test(gameSrcD) &&
  /routeShareQuery\(res\)/.test(gameSrcD), 'game.js 启动路由接线缺失');

const CODE = '482193';   // 全链路共用的同一个 6 位数字串
// ---- 段 1：config.codeAlphabet + genRoomCode（含前导零注入）----
const alphaD = configD.ROOM_CONFIG && configD.ROOM_CONFIG.codeAlphabet;
const genDefaultD = roomD.genRoomCode();
const genZeroD = roomD.genRoomCode(() => 0);
console.log('  · 段1 codeAlphabet=' + JSON.stringify(alphaD) +
  ' | genRoomCode()=' + JSON.stringify(genDefaultD) +
  ' | genRoomCode(()=>0)=' + JSON.stringify(genZeroD) + ' | 共用码=' + CODE);
ok('D1a ROOM_CONFIG.codeAlphabet === "0123456789"', alphaD === '0123456789', 'alpha=' + alphaD);
ok('D1b genRoomCode() 匹配 /^[0-9]{6}$/', /^[0-9]{6}$/.test(genDefaultD), 'gen=' + genDefaultD);
ok('D1c 注入 ()=>0 得 "000000"（保留前导零）', genZeroD === '000000', 'genZero=' + genZeroD);

// ---- 段 2：分享卡 query → game.js:readRoomFromQuery ----
const qValidD = readRoomFromQuery({ query: { room: CODE } });
const qBadD = ['ABC123', '12345', null, '12a456', '1234567']
  .map(v => readRoomFromQuery({ query: { room: v } }));
const qEmptyD = readRoomFromQuery({});
console.log('  · 段2 readRoomFromQuery 实际返回: 合法=' + JSON.stringify(qValidD) +
  ' | ABC123/12345/null/12a456/1234567=' + JSON.stringify(qBadD) +
  ' | 无query=' + JSON.stringify(qEmptyD));
ok('D2a 合法 6 位码被 readRoomFromQuery 原样返回', qValidD === CODE, 'got=' + qValidD);
ok('D2b 5 类非法 + 缺省输入一律返回空串',
  qBadD.every(v => v === '') && qEmptyD === '', JSON.stringify(qBadD) + ' empty=' + qEmptyD);

// ---- 段 3：isRoomCode + RoomScene.enter ----
const icValidD = isRoomCode(CODE);
const icBadD = ['ABC123', '12345', null, '12a456', '1234567'].map(v => isRoomCode(v));
const rsD = new RoomSceneD();
let enterErrD = null;
try { rsD.enter({ from: 'share', joinCode: CODE, screenWidth: 375, screenHeight: 667 }); }
catch (e) { enterErrD = e; }
console.log('  · 段3 isRoomCode(' + CODE + ')=' + icValidD +
  ' | 非法集=' + JSON.stringify(icBadD) +
  ' | enter 后 joinCode=' + JSON.stringify(rsD.joinCode) + ' phase=' + JSON.stringify(rsD.phase) +
  ' | err=' + (enterErrD ? enterErrD.message : 'null'));
ok('D3a isRoomCode(6 位数字) === true', icValidD === true, 'got=' + icValidD);
ok('D3b isRoomCode 拒绝全部非法输入', icBadD.every(v => v === false), JSON.stringify(icBadD));
ok('D3c enter({from:"share",joinCode}) → joinCode===CODE 且 phase==="joining"',
  !enterErrD && rsD.joinCode === CODE && rsD.phase === 'joining',
  'joinCode=' + rsD.joinCode + ' phase=' + rsD.phase + ' err=' + (enterErrD && enterErrD.message));

// =====================================================================
section('E. R2 房间路由 / 分享 / 菜单并列按钮（固化 impl-room-ui 交接）');
// =====================================================================
{
  // 真冷启动：重加载 game.js（此时未挂 wx.cloud，room 场景静默降级不触云）。
  launchOpts = { query: { room: CODE } };
  let reloadErr = null, sm2 = null;
  try {
    delete require.cache[require.resolve('./game.js')];
    require('./game.js');
    sm2 = GameContext.get() && GameContext.get().sceneManager;
  } catch (e) { reloadErr = e; }
  const curName = sm2 && sm2.currentSceneName;
  const curJoin = sm2 && sm2.currentScene && sm2.currentScene.joinCode;
  console.log('  · E1 冷启动实际: scene=' + curName + ' joinCode=' + JSON.stringify(curJoin) +
    ' err=' + (reloadErr ? reloadErr.message : 'null'));
  ok('E1 合法 query.room 冷启动路由到 room 且 joinCode===CODE',
    !reloadErr && curName === 'room' && curJoin === CODE,
    'scene=' + curName + ' joinCode=' + curJoin + ' err=' + (reloadErr && reloadErr.message));

  const beforeName = sm2 && sm2.currentSceneName;
  const beforeJoin = sm2 && sm2.currentScene && sm2.currentScene.joinCode;
  let showErr = null;
  try { touchHandlers.show && touchHandlers.show({ query: { room: 'ABC123' } }); }
  catch (e) { showErr = e; }
  ok('E2 非法 query.room 的 onShow 不改变路由',
    !showErr && sm2.currentSceneName === beforeName && sm2.currentScene.joinCode === beforeJoin,
    'scene=' + sm2.currentSceneName + ' joinCode=' + sm2.currentScene.joinCode);

  let switchCount = 0, dedupErr = null;
  if (sm2 && typeof sm2.switchTo === 'function') {
    const origSwitch = sm2.switchTo;
    sm2.switchTo = function (n, p) { switchCount++; return origSwitch.call(this, n, p); };
    try {
      touchHandlers.show && touchHandlers.show({ query: { room: CODE } });
      touchHandlers.show && touchHandlers.show({ query: { room: CODE } });
    } catch (e) { dedupErr = e; }
    sm2.switchTo = origSwitch;
  }
  console.log('  · E3 重复 onShow 同 code 的 switchTo 调用次数=' + switchCount);
  ok('E3 重复 onShow 同 code 不重进（switchTo 次数为 0）',
    !dedupErr && switchCount === 0, 'switchCount=' + switchCount + ' err=' + (dedupErr && dedupErr.message));

  const origGetState = roomD.getState;
  let card = null, cardEmpty = null;
  try {
    roomD.getState = function () { return Object.assign({}, origGetState(), { roomId: CODE }); };
    card = touchHandlers.share ? touchHandlers.share() : null;
    roomD.getState = function () { return Object.assign({}, origGetState(), { roomId: '' }); };
    cardEmpty = touchHandlers.share ? touchHandlers.share() : null;
  } catch (e) { /* 下方断言捕获 null */ }
  finally { roomD.getState = origGetState; }
  console.log('  · E4 分享卡实际返回: 有房=' + JSON.stringify(card) + ' | 无房=' + JSON.stringify(cardEmpty));
  ok('E4a 默认分享卡 query === "room=" + CODE',
    !!(card && card.query === 'room=' + CODE), JSON.stringify(card));
  ok('E4b 无房间时分享卡 query 为空串',
    !!(cardEmpty && cardEmpty.query === ''), JSON.stringify(cardEmpty));

  // E5（IA 变更：主菜单 sec2Y 由「本地双人 / 邀请好友加入」双按钮改为单入口 'versus'）
  const msD = new MenuSceneD();
  let menuErr = null;
  try {
    msD.enter({ screenWidth: 375, screenHeight: 667 });
    msD.render(makeCtx(), 375, 667);
  } catch (e) { menuErr = e; }
  const mKeys = (msD.regions || []).map(r => r.key);
  const vsReg = (msD.regions || []).find(r => r.key === 'versus');
  const vsCount = mKeys.filter(k => k === 'versus').length;
  console.log('  · E5 menu regions=' + JSON.stringify(mKeys) +
    ' | versus rect=' + JSON.stringify(vsReg && vsReg.rect));
  ok('E5a menu sec2Y 上仅存在一个 "versus" 命中区',
    !menuErr && vsCount === 1 && !!vsReg, 'keys=' + mKeys.join(',') + ' count=' + vsCount);
  ok('E5b menu regions 不再含 "local" / "remote"（已移入 versus 选择页）',
    !menuErr && mKeys.indexOf('local') < 0 && mKeys.indexOf('remote') < 0, 'keys=' + mKeys.join(','));
  ok('E5c "versus" 为整行命中区（x=16/w=343，非旧半宽 166.5）且 y/h 与旧 sec2Y 基线一致（491/56）',
    !menuErr && !!vsReg && vsReg.rect.x === 16 && vsReg.rect.w === 343 &&
    vsReg.rect.y === 491 && vsReg.rect.h === 56,
    'rect=' + JSON.stringify(vsReg && vsReg.rect));

  // E6（IA 变更：_activate('versus') → 进入对局方式选择页）
  const origPush = GameContext.pushScene;
  let captured = null, actErr = null;
  GameContext.pushScene = (n, p) => { captured = { n: n, p: p || {} }; };
  try {
    const ms2 = new MenuSceneD();
    ms2.enter({ screenWidth: 375, screenHeight: 667 });
    ms2._activate('versus');
  } catch (e) { actErr = e; }
  GameContext.pushScene = origPush;
  console.log('  · E6 _activate("versus") 实际 push=' + JSON.stringify(captured));
  ok('E6 _activate("versus") → pushScene("versus", {from:"menu"})',
    !actErr && !!captured && captured.n === 'versus' && captured.p.from === 'menu',
    JSON.stringify(captured) + ' err=' + (actErr && actErr.message));

  // ---- E7/E8/E9：versus 选择页（新 IA 过渡页）+ room 返回行为 ----
  let VersusSceneE = null;
  try { VersusSceneE = require('./src/scenes/versus'); } catch (e) { VersusSceneE = null; }
  ok('E7a versus 场景模块已落盘且已注册到场景表',
    !!VersusSceneE && !!(sm2 && sm2.scenes && sm2.scenes.versus),
    'module=' + !!VersusSceneE + ' registered=' + !!(sm2 && sm2.scenes && sm2.scenes.versus));
  if (!VersusSceneE) {
    console.log('  ⊘ 跳过：versus 场景断言组（模块未落盘，集成时复跑）');
  } else {
    let vsRegs = null, vsErr = null;
    try {
      const vs = new VersusSceneE();
      vs.enter({ from: 'menu', screenWidth: 375, screenHeight: 667 });
      vs.render(makeCtx(), 375, 667);
      vsRegs = (vs.regions || []).map(r => ({ key: r.key, rect: r.rect }));
    } catch (e) { vsErr = e; }
    const vKeys = vsRegs ? vsRegs.map(r => r.key) : [];
    const vLocal = vsRegs && vsRegs.find(r => r.key === 'local');
    const vRemote = vsRegs && vsRegs.find(r => r.key === 'remote');
    console.log('  · E7b versus(375) regions=' + JSON.stringify(vsRegs));
    ok('E7b versus enter+render 无异常且 regions 含 back / local / remote',
      !vsErr && vKeys.indexOf('back') >= 0 && vKeys.indexOf('local') >= 0 && vKeys.indexOf('remote') >= 0,
      'keys=' + vKeys.join(',') + ' err=' + (vsErr && vsErr.message));
    ok('E7c versus local / remote 热区高 ≥44pt（375 实测 52）',
      !vsErr && !!vLocal && !!vRemote && vLocal.rect.h >= 44 && vRemote.rect.h >= 44,
      'local.h=' + (vLocal && vLocal.rect.h) + ' remote.h=' + (vRemote && vRemote.rect.h));
    ok('E7d versus local 在 remote 之上且两者同宽同左对齐（375 实测 local y=297 / remote y=470）',
      !vsErr && !!vLocal && !!vRemote &&
      vLocal.rect.y + vLocal.rect.h <= vRemote.rect.y &&
      vLocal.rect.x === vRemote.rect.x && vLocal.rect.w === vRemote.rect.w,
      'local=' + JSON.stringify(vLocal && vLocal.rect) + ' remote=' + JSON.stringify(vRemote && vRemote.rect));

    // E8 导航三分支（replaceScene / pushScene / popScene 均打桩，捕获实际调用值）
    const origReplace = GameContext.replaceScene;
    const origPushV = GameContext.pushScene;
    const origPopV = GameContext.popScene;
    let repV = null, pusV = null, popV = 0, navErr = null;
    GameContext.replaceScene = (n, p) => { repV = { n: n, p: p || {} }; };
    GameContext.pushScene = (n, p) => { pusV = { n: n, p: p || {} }; };
    GameContext.popScene = () => { popV++; };
    try {
      const vs = new VersusSceneE();
      vs.enter({ from: 'menu', screenWidth: 375, screenHeight: 667 });
      vs.render(makeCtx(), 375, 667);
      vs._activate('local');
      vs._activate('remote');
      vs._activate('back');
    } catch (e) { navErr = e; }
    GameContext.replaceScene = origReplace;
    GameContext.pushScene = origPushV;
    GameContext.popScene = origPopV;
    console.log('  · E8 versus 导航实际: replace=' + JSON.stringify(repV) +
      ' push=' + JSON.stringify(pusV) + ' pop=' + popV);
    ok('E8a versus._activate("local") → replaceScene("gameplay",{mode:"local"})',
      !navErr && !!repV && repV.n === 'gameplay' && repV.p.mode === 'local', JSON.stringify(repV));
    ok('E8b versus._activate("remote") → pushScene("room",{from:"versus"})',
      !navErr && !!pusV && pusV.n === 'room' && pusV.p.from === 'versus', JSON.stringify(pusV));
    ok('E8c versus._activate("back") → popScene()',
      !navErr && popV === 1, 'pop=' + popV + ' err=' + (navErr && navErr.message));

    // E9 room 返回：from:'versus' 回选择页（popScene）；from:'menu' 维持回菜单
    const RoomSceneE = require('./src/scenes/room');
    const origPopR = GameContext.popScene;
    const origEmitR = GameContext.emit;
    let popR = 0, navR = '', popR2 = 0, navR2 = '', rErr = null;
    GameContext.popScene = () => { popR++; };
    GameContext.emit = (name, payload) => { if (name === 'navigate') navR = payload && payload.to; };
    try {
      const rs = new RoomSceneE();
      rs.enter({ from: 'versus', screenWidth: 375, screenHeight: 667 });
      rs.render(makeCtx(), 375, 667);
      rs._activate('back');
    } catch (e) { rErr = e; }
    GameContext.popScene = () => { popR2++; };
    GameContext.emit = (name, payload) => { if (name === 'navigate') navR2 = payload && payload.to; };
    try {
      const rs2 = new RoomSceneE();
      rs2.enter({ from: 'menu', screenWidth: 375, screenHeight: 667 });
      rs2.render(makeCtx(), 375, 667);
      rs2._activate('back');
    } catch (e) { rErr = rErr || e; }
    GameContext.popScene = origPopR;
    GameContext.emit = origEmitR;
    console.log('  · E9 room back 实际: from:versus → pop=' + popR + ' navigate.to=' + navR +
      ' | from:menu → pop=' + popR2 + ' navigate.to=' + navR2);
    ok('E9a room(from:"versus") hub 的 back → popScene() 且 navigate.to="versus"（回选择页）',
      !rErr && popR === 1 && navR === 'versus', 'pop=' + popR + ' to=' + navR);
    ok('E9b room(from:"menu") hub 的 back → popScene() 且 navigate.to="menu"（维持原状）',
      !rErr && popR2 === 1 && navR2 === 'menu', 'pop=' + popR2 + ' to=' + navR2);
  }
}

// =====================================================================
// D 段 4/5：joinRoom 端到端（自定义 waiting 房 cloud mock）→ 异步收集返回值
// =====================================================================
function makeRoomCloudMock(rid) {
  const calls = { where: 0, get: 0, update: 0, init: 0 };
  const doc = {
    _id: 'doc_room_1', _openid: 'host_openid', roomId: rid,
    hostSeat: 'hostseat1234567', guestSeat: '', hostColor: 'w',
    status: 'waiting', movesUci: [], turn: 'w', rev: 0, lastSeat: '',
    result: null, resultReason: '', schemaVersion: 1,
    createdAt: Date.now(), updatedAt: Date.now(), expireAt: Date.now() + 3600000
  };
  function collection(name) {
    // 只统计 chess_rooms 集合：其它异步云调用（sync/privacy 的 chess_state/chess_records）不混入
    const isRooms = name === 'chess_rooms';
    let _where = null;
    const api = {
      where(w) { if (isRooms) calls.where++; _where = w || {}; return api; },
      orderBy() { return api; }, limit() { return api; }, skip() { return api; },
      get() {
        if (isRooms) calls.get++;
        return Promise.resolve({ data: (_where && _where.roomId === rid) ? [Object.assign({}, doc)] : [] });
      },
      update(arg) {
        if (isRooms) calls.update++;
        const d = (arg && arg.data) || {};
        const casOk = !!(_where && _where.roomId === rid && _where.status === 'waiting' &&
          _where.rev === 0 && _where.guestSeat === '');
        if (casOk) { doc.guestSeat = d.guestSeat; doc.status = d.status; doc.rev = d.rev; }
        return Promise.resolve({ stats: { updated: casOk ? 1 : 0 } });
      },
      add() { return Promise.resolve({ _id: 'x' }); },
      remove() { return Promise.resolve({ stats: { removed: 0 } }); },
      count() { return Promise.resolve({ total: 0 }); }
    };
    return api;
  }
  return {
    calls: calls,
    cloud: {
      init() { calls.init++; },
      database() {
        return { serverDate() { return { getTime() { return Date.now(); } }; }, collection: collection };
      }
    }
  };
}

const rcm = makeRoomCloudMock(CODE);
global.wx.cloud = rcm.cloud;   // room.isAvailable() 需 wx.cloud.init + database
roomD.reset();
// 反例的前置校验是同步路径：紧邻前后取 where 计数，排除其它异步云调用干扰
const whereBeforeBad = rcm.calls.where;
const pBad = roomD.joinRoom('ABC123');
const whereAfterBad = rcm.calls.where;
let d4Done = false;
Promise.resolve(pBad)
  .then(function (bad) {
    console.log('  · 段5 joinRoom("ABC123") 实际返回=' + JSON.stringify(bad) +
      ' | where 调用次数(紧邻前/后)=' + whereBeforeBad + '/' + whereAfterBad);
    ok('D5 joinRoom("ABC123") → reason:"invalid_room" 且 where() 调用 0 次',
      !!(bad && bad.reason === 'invalid_room') && (whereAfterBad - whereBeforeBad) === 0,
      JSON.stringify(bad) + ' whereDelta=' + (whereAfterBad - whereBeforeBad));
    return roomD.joinRoom(CODE);
  })
  .then(function (good) {
    const reason = good && good.reason;
    console.log('  · 段4 joinRoom(CODE) 实际返回 reason=' + JSON.stringify(reason) +
      ' ok=' + (good && good.ok) + ' color=' + JSON.stringify(good && good.color) +
      ' | where/get/update=' + rcm.calls.where + '/' + rcm.calls.get + '/' + rcm.calls.update);
    ok('D4 joinRoom(CODE) 不因 invalid_room / not_found 失败',
      reason !== 'invalid_room' && reason !== 'not_found', 'reason=' + reason);
    ok('D4b 同一码加入 waiting 房成功（reason:"ok"）',
      !!(good && good.ok === true && reason === 'ok'), JSON.stringify(good));
    d4Done = true;
    delete global.wx.cloud;
    roomD.reset();
    finish();
  })
  .catch(function (e) {
    ok('D4/D5 joinRoom 异步链无异常', false, e && (e.stack || e.message));
    delete global.wx.cloud;
    finish();
  });
setTimeout(function () {
  if (!d4Done && !finished) {
    ok('D4/D5 joinRoom 异步链完成', false, '超时未完成');
    finish();
  }
}, 3000);
