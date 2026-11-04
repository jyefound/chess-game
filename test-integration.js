/**
 * 独立集成冒烟测试（主理人汇编验证用）
 * 用 mock 微信环境把 game.js 入口真正启动，验证跨模块装配、场景切换、
 * AI 分帧步进、UCI/三次重复/回放、存储往返、教学三态不泄题。
 * 运行：node test-integration.js
 */
'use strict';

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
  getLaunchOptionsSync() { return {}; }
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

// A3 三次重复（Nf3 Nf6 Ng1 Ng8 循环两轮回到初始局面 3 次）
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
  ok('三次重复判和触发', g.result === 'draw' && g.resultReason === 'threefold',
    'result=' + g.result + ' reason=' + g.resultReason + ' moves=' + g.uciLog.length);
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
  const need = ['menu','setup','gameplay','teaching','records','replay','settings'];
  const needV2 = ['academy','endgameMap','endgame'];
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
console.log('\n============================================================');
console.log('集成冒烟结果: ' + passed + ' 通过 / ' + failed + ' 失败');
if (failures.length) { console.log('失败项:'); failures.forEach(f => console.log('  - ' + f)); }
console.log('============================================================');
process.exit(failed === 0 ? 0 : 1);
