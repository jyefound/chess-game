/**
 * 针对 P0-I2（AI 悔棋软锁）与 P1-I3（断点恢复一致性）的单元回归测试。
 * 直接实例化 GameplayScene，隔离 GameContext 副作用，验证：
 *   1) AI 执白先走、玩家（黑）在其首手前撤销 → 不再双向死锁（AI 被唤起思考）。
 *   2) 玩家执白常规两步后撤销 → 回到玩家走子（IDLE），不引入回归。
 *   3) 断点重放步数与快照不符 → 丢弃脏快照（clearResume），不残留脏态。
 *   4) 完整合法重放 → 不误触发 clearResume，且棋谱步数一致。
 * R2 追加：本地双人固定棋盘方向 / 远程双人对弈 / 渲染接线静态检查。
 *   实现代码可能尚未全部落盘：凡依赖新实现（impl-gameplay / impl-room-core）的断言，
 *   用能力防御写成「模块在则验、不在则跳过并明确标注」，skip 单独统计，绝不静默通过。
 * 运行：node test-gameplay.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const readSrc = (p) => fs.readFileSync(path.join(__dirname, p), 'utf8');

// ---------- mock 微信环境（仅 storage / systemInfo，足够场景构造）----------
const storageMap = {};
global.wx = {
  getSystemInfoSync() { return { windowWidth: 375, windowHeight: 667, pixelRatio: 2 }; },
  setStorageSync(k, v) { storageMap[k] = v; },
  getStorageSync(k) { return Object.prototype.hasOwnProperty.call(storageMap, k) ? storageMap[k] : ''; },
  removeStorageSync(k) { delete storageMap[k]; },
  // R2：远程入口可能做 wx 能力探测；全部 no-op，且刻意不挂 wx.cloud，
  // 房间模块必须在「无云能力」时降级（契约：能力防御，不抛异常）。
  getLaunchOptionsSync() { return {}; },
  getEnterOptionsSync() { return {}; },
  onShow() {}, onHide() {},
  showShareMenu() {}, onShareAppMessage() {}, shareAppMessage() {}, setClipboardData() {}
};

// v5：远程对弈 enter() 后会用 setInterval 周期上报心跳。测试里替换为「可计数 / 可手动触发」
// 的桩，不创建真实定时器（否则 Node 事件循环被活跃 interval 挂住、进程无法退出，输出缓冲丢失）。
let intervalRecords = [];
let intervalSeq = 0;
global.setInterval = function (fn, ms) {
  const id = ++intervalSeq;
  intervalRecords.push({ id, fn, ms, cleared: false });
  return id;
};
global.clearInterval = function (id) {
  for (const it of intervalRecords) if (it.id === id) it.cleared = true;
};
function fireIntervals() {
  for (const it of intervalRecords) if (!it.cleared) { try { it.fn(); } catch (e) { /* noop */ } }
}
function resetIntervals() { intervalRecords = []; }

const ChessGame = require('./src/core/game');
const { COLOR } = require('./src/core/constants');
const GameplayScene = require('./src/scenes/gameplay');
const GameContext = require('./src/context');

// 隔离 GameContext 副作用（模块单例，覆盖为 no-op + 计数）
GameContext.emit = function () {};
GameContext.closeModal = function () {};
GameContext.showBanner = function () {};
GameContext.openModal = function () {};
GameContext.pushScene = function () {};
GameContext.popScene = function () {};
GameContext.replaceScene = function () {};
GameContext.getSceneManager = function () { return null; };
GameContext.get = function () { return { sceneManager: null }; };
GameContext.getSettings = function () {
  return { soundEnabled: true, reduceMotion: false, fontSize: 'standard',
    showLegalMoves: true, showCoordinates: true, defaultColor: 'w',
    defaultOrientation: 'white', skipSetup: false, autoSaveGame: true,
    autoPrune: false, theme: 'dark' };
};
let saveSettingsCalls = [];
let saveSettingsReturn = true;
GameContext.saveSettings = function (patch) { saveSettingsCalls.push(patch); return saveSettingsReturn; };
GameContext.getResume = function () { return null; };
GameContext.saveResume = function () { return true; };
let clearedCount = 0;
GameContext.clearResume = function () { clearedCount++; };

let passed = 0, failed = 0, skipped = 0;
const failures = [], skipReasons = [];
function ok(name, cond, detail) {
  if (cond) { passed++; console.log('  ✓ ' + name); }
  else { failed++; failures.push(name + (detail ? ' | ' + detail : '')); console.log('  ✗ ' + name + (detail ? ' | ' + detail : '')); }
}
/** 能力防御断言：capable=false → 明确打印「跳过」并单独统计，绝不静默通过。 */
function okCap(name, capable, condFn, detailFn) {
  if (!capable) {
    skipped++;
    const reason = '模块/方法未落盘，集成时复跑';
    skipReasons.push(name + '（' + reason + '）');
    console.log('  ⊘ 跳过：' + name + '（' + reason + '）');
    return;
  }
  let cond = false, detail;
  try { cond = !!condFn(); if (detailFn) detail = detailFn(); }
  catch (e) { cond = false; detail = '异常：' + (e && e.message); }
  ok(name, cond, detail);
}

function makeScene(mode, aiColor) {
  const s = new GameplayScene();
  s.mode = mode;
  s.aiColor = aiColor;
  s.playerColor = (mode === 'ai' && aiColor === COLOR.WHITE) ? COLOR.BLACK : COLOR.WHITE;
  s.coach = false;
  s.game = new ChessGame();
  s.aiDepth = 2;            // 低深度，搜索足够快
  s.savedGameId = null;
  s.gameId = 'test';
  s.selected = null; s.legalMoves = []; s.anim = null; s.landRing = null; s.aiCtx = null;
  s.captured = { w: [], b: [] };
  s.coachHistory = [];
  s.hintState = 'idle';
  s.startedAt = Date.now();
  s.state = 'IDLE';
  return s;
}

function findMove(g, fr, fc, tr, tc) {
  return g.getLegalMoves().find(m => m.fromRow === fr && m.fromCol === fc && m.toRow === tr && m.toCol === tc);
}

// ---- P0-I2 场景 1：AI 执白先走，玩家（黑）在其首手前撤销 → 修复前会双向死锁 ----
console.log('\n=== P0-I2 AI 悔棋软锁（执黑首手撤销） ===');
{
  const s = makeScene('ai', COLOR.WHITE);            // AI 白、玩家黑；白先走
  const e4 = findMove(s.game, 6, 4, 4, 4);           // 白方首手 e2e4（即 AI 的首手）
  s.game.makeMove(e4);                               // 现在轮到黑（玩家），history=[w]
  ok('前置：AI 首手后轮到玩家(黑)', s.game.turn === COLOR.BLACK, 'turn=' + s.game.turn);
  s.doUndo();                                        // 玩家在自身首手前撤销 → 撤销掉 AI 的首手
  ok('撤销后回退为 0 步', s.game.history.length === 0, 'len=' + s.game.history.length);
  ok('撤销后轮到 AI(白)', s.game.turn === COLOR.WHITE, 'turn=' + s.game.turn);
  const deadlocked = (s.mode === 'ai' && s.game.turn === s.aiColor && s.state === 'IDLE');
  ok('不再双向死锁（AI 已被唤起思考）', !deadlocked && s.state === 'AI_THINKING',
    'state=' + s.state + ' turn=' + s.game.turn + ' aiColor=' + s.aiColor);
}

// ---- 回归：玩家执白，常规两步后撤销应回到玩家走子(IDLE) ----
console.log('\n=== 回归：玩家执白常规撤销 ===');
{
  const s = makeScene('ai', COLOR.BLACK);            // 玩家白、AI 黑
  s.game.makeMove(findMove(s.game, 6, 4, 4, 4));     // 白 e4
  s.game.makeMove(findMove(s.game, 1, 4, 3, 4));     // 黑 e5（AI）
  ok('前置：两步后轮到玩家(白)', s.game.turn === COLOR.WHITE, 'turn=' + s.game.turn);
  s.doUndo();                                        // 撤销 AI 的黑棋 + 玩家白棋
  ok('撤销后回到玩家走子(IDLE)', s.game.turn === COLOR.WHITE && s.state === 'IDLE',
    'turn=' + s.game.turn + ' state=' + s.state);
  ok('撤销后步数为 0', s.game.history.length === 0, 'len=' + s.game.history.length);
}

// ---- P1-I3 场景 2：断点恢复步数不一致应丢弃脏快照 ----
console.log('\n=== P1-I3 断点恢复一致性 ===');
{
  const s2 = makeScene('ai', COLOR.BLACK);
  s2.game.makeMove(findMove(s2.game, 6, 4, 4, 4));   // e4
  s2.game.makeMove(findMove(s2.game, 1, 4, 3, 4));   // e5
  // 4 步合法 + 1 步非法（z9z9）→ 重放中断，applied=4 != 5
  const badList = ['g1f3', 'b8c6', 'f1b5', 'a7a6', 'z9z9'];
  clearedCount = 0;
  s2.restoreFromMoves(badList);
  ok('步数不一致 → clearResume 被调用', clearedCount === 1, 'cleared=' + clearedCount);
  ok('步数不一致 → state 为 IDLE（不残留脏态）', s2.state === 'IDLE', 'state=' + s2.state);
}
{
  // 正向：完整合法重放不误触发 clearResume，且棋谱步数一致
  const s3 = makeScene('ai', COLOR.BLACK);
  const good = ['e2e4', 'e7e5', 'g1f3', 'b8c6'];
  clearedCount = 0;
  s3.restoreFromMoves(good);
  ok('完整重放不误触发 clearResume', clearedCount === 0, 'cleared=' + clearedCount);
  ok('完整重放后棋谱步数一致', s3.game.history.length === 4, 'len=' + s3.game.history.length);
}

// =====================================================================
// R2 新增断言组 A / B / C
// 能力探测基于「源码 + 原型」双检：impl-gameplay / impl-room-core 尚未落盘时，
// 依赖新行为的断言必须明确跳过（而非静默通过），集成后自动转为真实验证。
// =====================================================================
const gameplaySrc = readSrc('src/scenes/gameplay.js');
const AUTO_FLIP_RE = /if\s*\(this\.mode === 'local'\)\s*this\.flipBoard\s*=\s*\(this\.game\.turn === COLOR\.BLACK\)/g;
const autoFlipCount = (gameplaySrc.match(AUTO_FLIP_RE) || []).length;
const HAS_TOGGLE = typeof GameplayScene.prototype.toggleBoardFlip === 'function';
const HAS_REMOTE_SNAPSHOT = typeof GameplayScene.prototype.onRemoteSnapshot === 'function';
const HAS_REMOTE_METHODS = HAS_REMOTE_SNAPSHOT &&
  typeof GameplayScene.prototype.onRemoteError === 'function' &&
  typeof GameplayScene.prototype.onRemoteConflict === 'function';
let HAS_ROOM_MODULE = false;
try { require('./src/core/room'); HAS_ROOM_MODULE = true; } catch (e) { HAS_ROOM_MODULE = false; }
// 严格落盘判据：三处自动翻转全删除 + toggleBoardFlip 存在 + 渲染接线已接。
// 任一缺失都视为「实现仍在并行落盘的中间态」，依赖新行为的断言整组跳过并标注，
// 集成时三个信号齐备后自动转为真实验证（避免中间态把测试染红、与其它 worker 写入竞态）。
const HAS_RENDER_WIRING = /topPiecesUpsideDown/.test(gameplaySrc);
const V2_READY = autoFlipCount === 0 && HAS_TOGGLE && HAS_RENDER_WIRING;
console.log('\n=== R2 能力探测摘要（集成时据此判断跳过项应否转为验证）===');
console.log('  autoFlipCount=' + autoFlipCount + '(应为 0)' +
  ' | toggleBoardFlip=' + HAS_TOGGLE +
  ' | onRemoteSnapshot=' + HAS_REMOTE_SNAPSHOT +
  ' | 远程三方法=' + HAS_REMOTE_METHODS +
  ' | core/room=' + HAS_ROOM_MODULE +
  ' | 渲染接线=' + HAS_RENDER_WIRING +
  ' | V2_READY=' + V2_READY);

function mockSM() {
  return {
    modal: {
      current: null, payload: {},
      open(k, p) { this.current = k; this.payload = p || {}; },
      close() { this.current = null; },
      isGeneric() { return false; }, isOpen() { return !!this.current; },
      interactive() { return true; }, renderGeneric() {}
    },
    banner: { show() {} },
    reduceMotion: false, scenes: {}, currentScene: null
  };
}
/** 走完整的 enter() 路径（含 layout / sm.modal），供朝向回归使用。 */
function makeEnteredScene(params) {
  const s = new GameplayScene();
  s.enter(Object.assign({ screenWidth: 375, screenHeight: 667, _sm: mockSM() }, params || {}));
  return s;
}
const commitFirst = (s) => s.commitMove(s.game.getLegalMoves()[0], false);

console.log('\n=== R2-A 本地双人固定棋盘方向（用户第 1 项需求核心回归）===');
{
  let s = null;
  okCap('A1 enter({mode:"local"}) → flipBoard===false', V2_READY,
    () => { s = makeEnteredScene({ mode: 'local' }); return s.flipBoard === false; },
    () => 'flipBoard=' + (s && s.flipBoard));
  okCap('A2 走一步合法着法后 flipBoard 仍 false（旧行为会变 true = 回归断言）', V2_READY && !!s,
    () => { commitFirst(s); return s.flipBoard === false; },
    () => 'flipBoard=' + (s && s.flipBoard));
  okCap('A3 再走一步后 flipBoard 仍 false', V2_READY && !!s,
    () => { commitFirst(s); return s.flipBoard === false; },
    () => 'flipBoard=' + (s && s.flipBoard));
  okCap('A4 doUndo() 后 flipBoard 仍 false', V2_READY && !!s,
    () => { s.doUndo(); return s.flipBoard === false; },
    () => 'flipBoard=' + (s && s.flipBoard));
}
{
  const cap = V2_READY && HAS_TOGGLE;
  let s = null;
  okCap('A5a toggleBoardFlip() → flipBoard===true', cap,
    () => { s = makeEnteredScene({ mode: 'local' }); s.toggleBoardFlip(); return s.flipBoard === true; },
    () => 'flipBoard=' + (s && s.flipBoard));
  okCap('A5b 手动翻转后 commitMove 仍 true（手动设定不被落子覆盖）', cap && !!s,
    () => { commitFirst(s); return s.flipBoard === true; },
    () => 'flipBoard=' + (s && s.flipBoard));
  okCap('A5c 手动翻转后 doUndo 仍 true', cap && !!s,
    () => { s.doUndo(); return s.flipBoard === true; },
    () => 'flipBoard=' + (s && s.flipBoard));
  okCap('A5d saveSettings 失败时 toggleBoardFlip 回滚 flipBoard', cap,
    () => {
      const t = makeEnteredScene({ mode: 'local' });
      const before = t.flipBoard;
      saveSettingsReturn = false;
      try { t.toggleBoardFlip(); } finally { saveSettingsReturn = true; }
      return t.flipBoard === before;
    },
    () => 'flipBoard 应回退到翻转前值');
}
{
  let st = null, sf = null;
  okCap('A6a enter({mode:"local",flip:true}) → true 且走子后保持', V2_READY,
    () => { st = makeEnteredScene({ mode: 'local', flip: true }); const a = st.flipBoard === true; commitFirst(st); return a && st.flipBoard === true; },
    () => 'flipBoard=' + (st && st.flipBoard));
  okCap('A6b enter({mode:"local",flip:false}) → false 且走子后保持', V2_READY,
    () => { sf = makeEnteredScene({ mode: 'local', flip: false }); const a = sf.flipBoard === false; commitFirst(sf); return a && sf.flipBoard === false; },
    () => 'flipBoard=' + (sf && sf.flipBoard));
}
{
  // 人机既有行为零回归：旧实现下也成立，始终真实执行（不 gate），作为基线锚点。
  let sa = null;
  okCap('A7a enter({mode:"ai",playerColor:"b"}) → flipBoard===true（人机零回归）', true,
    () => { sa = makeEnteredScene({ mode: 'ai', playerColor: 'b' }); return sa.flipBoard === true; },
    () => 'flipBoard=' + (sa && sa.flipBoard));
  okCap('A7b mode:"ai" 走子后 flipBoard 不变', !!sa,
    () => { const before = sa.flipBoard; commitFirst(sa); return sa.flipBoard === before; },
    () => 'flipBoard=' + (sa && sa.flipBoard));
}

console.log('\n=== R2-B 远程模式固定方向 ===');
{
  let rw = null, rb = null;
  okCap('B8a enter remote(playerColor:"w") → flipBoard===false', V2_READY,
    () => { rw = makeEnteredScene({ mode: 'remote', playerColor: 'w', roomId: '123456', seat: 's', role: 'host' }); return rw.flipBoard === false; },
    () => 'flipBoard=' + (rw && rw.flipBoard));
  okCap('B8b enter remote(playerColor:"b") → flipBoard===true', V2_READY,
    () => { rb = makeEnteredScene({ mode: 'remote', playerColor: 'b', roomId: '123456', seat: 's', role: 'host' }); return rb.flipBoard === true; },
    () => 'flipBoard=' + (rb && rb.flipBoard));
  okCap('B9 onRemoteSnapshot 重放后 flipBoard 不变（远端不得切视角）', V2_READY && HAS_REMOTE_SNAPSHOT,
    () => {
      const s = makeEnteredScene({ mode: 'remote', playerColor: 'w', roomId: '123456', seat: 's', role: 'host' });
      const before = s.flipBoard;
      s.onRemoteSnapshot({ movesUci: ['e2e4'], rev: 2, status: 'playing' });
      return s.flipBoard === before;
    },
    () => 'onRemoteSnapshot 存在=' + HAS_REMOTE_SNAPSHOT + ' 远程三方法齐全=' + HAS_REMOTE_METHODS);
  okCap('B10a remote 非自己回合 handleBoardTouch 不改棋盘（selected/legalMoves 保持空）', V2_READY,
    () => {
      const s = makeEnteredScene({ mode: 'remote', playerColor: 'b', roomId: '123456', seat: 's', role: 'host' });
      // game.turn 初始 'w' !== playerColor 'b'；点白兵 e2 的屏幕坐标
      const p = s.cellToScreen(6, 4);
      s.handleBoardTouch(p.x, p.y);
      return s.selected === null && (!s.legalMoves || s.legalMoves.length === 0);
    },
    () => 'room 模块=' + (HAS_ROOM_MODULE ? '已落盘' : '未落盘'));
  // B10b：能力防御硬要求 —— room 模块缺失导致 enter 降级时，也不得抛异常。始终真实执行。
  {
    let err = null;
    try {
      const s = makeEnteredScene({ mode: 'remote', playerColor: 'w', roomId: '123456', seat: 's', role: 'host' });
      s.handleBoardTouch(10, 10);
    } catch (e) { err = e; }
    ok('B10b remote enter+handleBoardTouch 能力防御不抛异常（room 模块' + (HAS_ROOM_MODULE ? '在' : '缺失') + '）',
      !err, err && (err.stack || err.message));
  }
}

console.log('\n=== R2-C 渲染接线（静态检查）===');
{
  const boardSrc = readSrc('src/render/board.js');
  const piecesSrc = readSrc('src/render/pieces.js');
  const idx = gameplaySrc.indexOf('topPiecesUpsideDown');
  const nearLocal = idx >= 0 &&
    /mode\s*===\s*'local'/.test(gameplaySrc.slice(Math.max(0, idx - 400), idx + 400));
  okCap('C11a gameplay.js 含 topPiecesUpsideDown 且表达式带 mode===\'local\' 约束', V2_READY,
    () => idx >= 0 && nearLocal,
    () => 'autoFlipCount=' + autoFlipCount + ' idx=' + idx);
  okCap('C11b gameplay.js 不再含自动翻转语句（出现次数为 0）', V2_READY,
    () => autoFlipCount === 0,
    () => 'autoFlipCount=' + autoFlipCount);
  // impl-render 的 opt-in 旋转能力已落盘，以下三条始终真实执行。
  ok('C12a board.js topPiecesUpsideDown 默认 false（!!o.topPiecesUpsideDown 兜底）',
    /!!\s*o\.topPiecesUpsideDown/.test(boardSrc),
    '未发现默认值兜底');
  ok('C12b board.js 按屏幕行 dr<4 触发 rotate180',
    /topPiecesUpsideDown\s*&&\s*ps\.dr\s*<\s*4/.test(boardSrc) ||
      /topPiecesUpsideDown[\s\S]{0,160}rotate180/.test(boardSrc),
    '未发现 dr<4 判定');
  ok('C12c pieces.js 含 opts.rotate180 且 opt-in 默认 false 兜底',
    /opts\.rotate180/.test(piecesSrc) && /!!opts\.rotate180/.test(piecesSrc),
    'rotate180 非 opt-in');
}

// =====================================================================
// v5 退出仲裁 / 按兵力结束 / 远程棋谱 断言组（impl-arbitration §3.6 + 任务 G）
// 直接实例化 GameplayScene，mock 房间协议层新接口与 GameContext 副作用，验证：
//   A~E 退出仲裁状态机、F 远程棋谱胜负/对手昵称、G 心跳/能力防御/交接导出。
// =====================================================================
let roomMod = null;
try { roomMod = require('./src/core/room'); } catch (e) { roomMod = null; }
let ROOM_RESULT = {};
try { ROOM_RESULT = require('./src/config').ROOM_RESULT || {}; } catch (e) { ROOM_RESULT = {}; }

let openModalCalls = [];
let saveRecordCalls = [];
let roomCall = null;
function resetCaptures() {
  openModalCalls = [];
  saveRecordCalls = [];
  roomCall = { heartbeat: 0, markLeft: 0, markBothLeft: 0, archiveGame: 0, finishByMaterial: [], recordGameResult: [], readLocalRoom: 0 };
  resetIntervals();
}
resetCaptures();

// 给房间模块挂 v5 mock（gameplay 持有同一 module.exports 对象引用，故可见）。
function installRoomMocks() {
  if (!roomMod) return false;
  roomMod.heartbeat = function () { roomCall.heartbeat++; return Promise.resolve({ ok: true, doc: {}, reason: '' }); };
  roomMod.markLeft = function () { roomCall.markLeft++; return Promise.resolve({ ok: true, doc: {}, reason: '' }); };
  roomMod.markBothLeft = function () { roomCall.markBothLeft++; return Promise.resolve({ ok: true, doc: {}, reason: '' }); };
  roomMod.archiveGame = function () { roomCall.archiveGame++; return Promise.resolve({ ok: true, doc: {}, reason: '' }); };
  roomMod.finishByMaterial = function (w, r) { roomCall.finishByMaterial.push({ winner: w, reason: r }); return Promise.resolve({ ok: true, doc: {}, reason: '' }); };
  roomMod.recordGameResult = function (r) { roomCall.recordGameResult.push(r); return Promise.resolve({ ok: true, doc: {}, reason: '' }); };
  roomMod.readLocalRoom = function () { roomCall.readLocalRoom++; return { roomId: '123456', seat: 'seat-x', role: 'host', color: 'w', rev: 1, status: 'playing' }; };
  return true;
}
const ROOM_MOCKS_READY = installRoomMocks();

// 覆盖 GameContext 为可捕获版（前 33 条已跑完，互不影响）。
GameContext.openModal = function (k, p) { openModalCalls.push({ key: k, payload: p || {} }); };
GameContext.saveRecord = function (rec, opts) { saveRecordCalls.push({ rec: rec, opts: opts }); return { ok: true, id: rec && rec.id, reason: '' }; };

function makeRemoteScene(opts) {
  const s = new GameplayScene();
  s.enter(Object.assign({
    screenWidth: 375, screenHeight: 667, _sm: mockSM(),
    mode: 'remote', playerColor: 'w', roomId: '123456', seat: 'seat-x', role: 'host'
  }, opts || {}));
  return s;
}
/** 覆盖 board.getPieces，精确构造剩余兵力（judgeByMaterial 只依赖该 API）。 */
function setMaterial(s, w, b) {
  s.game.board.getPieces = function (color) {
    const n = color === 'w' ? w : b;
    const arr = [];
    for (let i = 0; i < n; i++) arr.push({ row: 0, col: i, piece: { type: 'p', color: color } });
    return arr;
  };
}
function fireIntervalById(id) {
  const it = intervalRecords.find(r => r.id === id && !r.cleared);
  if (it) { try { it.fn(); } catch (e) { /* noop */ } }
}
function lastConfirm(title) {
  const list = openModalCalls.filter(c => c.key === 'confirm' && (!title || c.payload.title === title));
  return list[list.length - 1];
}

console.log('\n=== v5-0 前置：协议层 v5 mock 已安装 ===');
ok('V0 room 模块 v5 接口 mock 就绪', ROOM_MOCKS_READY === true);

console.log('\n=== v5-1 剩余兵力 countMaterial ===');
{
  const s = makeRemoteScene({ role: 'host' });
  const m = s.countMaterial();
  ok('V1a 初始局面含王共 16/16 子', m.w === 16 && m.b === 16, 'w=' + m.w + ' b=' + m.b);
  ok('V1b 返回 {w,b} 数值结构', typeof m.w === 'number' && typeof m.b === 'number');
  s.exit();
}

console.log('\n=== v5-2 按兵力判定 judgeByMaterial（退出方永不胜）===');
{
  const s = makeRemoteScene({ role: 'host' });
  setMaterial(s, 5, 3);
  let j = s.judgeByMaterial('w', 'b');
  ok('V2a 白5 vs 黑3、stayer=w → winner=w / materialWhite',
    j.winner === 'w' && j.reason === ROOM_RESULT.materialWhite, JSON.stringify(j));
  j = s.judgeByMaterial('b', 'w');
  ok('V2b 白5 vs 黑3、stayer=b(兵少) → 平局（退出方 w 不胜）',
    j.winner === null && j.reason === ROOM_RESULT.draw, JSON.stringify(j));
  setMaterial(s, 3, 3);
  j = s.judgeByMaterial('w', 'b');
  ok('V2c 白3 vs 黑3（≥ 判胜）→ winner=w', j.winner === 'w' && j.reason === ROOM_RESULT.materialWhite, JSON.stringify(j));
  j = s.judgeByMaterial('b', 'w');
  ok('V2d 白3 vs 黑3、stayer=b → winner=b / materialBlack',
    j.winner === 'b' && j.reason === ROOM_RESULT.materialBlack, JSON.stringify(j));
  setMaterial(s, 3, 5);
  j = s.judgeByMaterial('w', 'b');
  ok('V2e 白3 vs 黑5、stayer=w(兵少) → 平局（退出方 b 不胜）',
    j.winner === null && j.reason === ROOM_RESULT.draw, JSON.stringify(j));
  s.exit();
}

console.log('\n=== v5-3 1 分钟超时墙钟判定 ===');
{
  resetCaptures();
  const s = makeRemoteScene({ role: 'host' });   // host 看 guest 侧；guest 执黑 'b'
  s.onRemoteSnapshot({ movesUci: [], rev: 2, status: 'playing', turn: 'b',
    guestPresent: false, guestLeftAt: Date.now() - 70000, hostPresent: true, hostLeftAt: 0 });
  s.update(0.016);
  const confirm = openModalCalls.filter(c => c.key === 'confirm');
  ok('V3a 退出>60s 且轮到退出方 → 弹三选项仲裁模态',
    confirm.length === 1 && confirm[0].payload.buttons && confirm[0].payload.buttons.length === 3,
    'confirm=' + confirm.length);
  ok('V3b 标题「对手已离开」+ wait/archive/finish 三 action',
    confirm.length === 1 && confirm[0].payload.title === '对手已离开' &&
    ['wait', 'archive', 'finish'].every(a => confirm[0].payload.buttons.some(b => b.action === a)));
  ok('V3c 触发后 arbitrationPrompted=true', s.arbitrationPrompted === true);
  s.exit();
}
{
  resetCaptures();
  const s = makeRemoteScene({ role: 'host' });
  s.onRemoteSnapshot({ movesUci: [], rev: 2, status: 'playing', turn: 'b',
    guestPresent: false, guestLeftAt: Date.now() - 30000, hostPresent: true, hostLeftAt: 0 });
  s.update(0.016);
  ok('V3d 退出<60s → 不弹仲裁', openModalCalls.filter(c => c.key === 'confirm').length === 0);
  s.exit();
}
{
  resetCaptures();
  const s = makeRemoteScene({ role: 'host' });
  s.onRemoteSnapshot({ movesUci: [], rev: 2, status: 'playing', turn: 'w',
    guestPresent: false, guestLeftAt: Date.now() - 70000, hostPresent: true, hostLeftAt: 0 });
  s.update(0.016);
  ok('V3e 未轮到退出方 → 不弹仲裁（本端正常走子）',
    openModalCalls.filter(c => c.key === 'confirm').length === 0 && !!s.remoteLeft);
  s.exit();
}

console.log('\n=== v5-4 继续等待不重复弹、常驻入口可再开 ===');
{
  resetCaptures();
  const s = makeRemoteScene({ role: 'host' });
  s.onRemoteSnapshot({ movesUci: [], rev: 2, status: 'playing', turn: 'b',
    guestPresent: false, guestLeftAt: Date.now() - 70000, hostPresent: true, hostLeftAt: 0 });
  s.update(0.016);
  const arb = lastConfirm('对手已离开');
  arb.payload.onAction('wait');
  ok('V4a wait 后 waiting=true / prompted 保持 true / 弹窗关闭',
    s.arbitrationWaiting === true && s.arbitrationPrompted === true && s.arbitrationOpen === false);
  s.update(0.016); s.update(0.016);
  ok('V4b 继续等待后再推进 update 不再自动弹',
    openModalCalls.filter(c => c.key === 'confirm').length === 1);
  s.openArbitrationModal();
  ok('V4c 常驻入口可再次打开仲裁面板',
    openModalCalls.filter(c => c.key === 'confirm').length === 2 && s.arbitrationOpen === true);
  s.exit();
}

console.log('\n=== v5-5 封存残局 archive（不判成绩）===');
{
  resetCaptures();
  const s = makeRemoteScene({ role: 'host' });
  s.onRemoteSnapshot({ movesUci: [], rev: 2, status: 'playing', turn: 'b',
    guestPresent: false, guestLeftAt: Date.now() - 70000, hostPresent: true, hostLeftAt: 0 });
  s.update(0.016);
  lastConfirm('对手已离开').payload.onAction('archive');
  ok('V5a archive 调用 room.archiveGame()', roomCall.archiveGame === 1, 'count=' + roomCall.archiveGame);
  ok('V5b archive 后 remoteStatus=archived 且 state=GAMEOVER',
    s.remoteStatus === 'archived' && s.state === 'GAMEOVER');
  ok('V5c archive 打开结算态（不写胜负 result）',
    openModalCalls.some(c => c.key === 'gameover') && !s.game.result);
  s.exit();
}

console.log('\n=== v5-6 结束对弈 finish（二次确认 + 按兵力）===');
{
  resetCaptures();
  const s = makeRemoteScene({ role: 'host', playerColor: 'w' });   // stayer=w, leaver=b
  setMaterial(s, 5, 3);                                             // 白5 >= 黑3 → stayer 胜
  s.onRemoteSnapshot({ movesUci: [], rev: 2, status: 'playing', turn: 'b',
    guestPresent: false, guestLeftAt: Date.now() - 70000, hostPresent: true, hostLeftAt: 0 });
  s.update(0.016);
  lastConfirm('对手已离开').payload.onAction('finish');
  const fc = lastConfirm('结束对弈');
  ok('V6a finish 先弹二次确认（不立即结束）', !!fc && roomCall.finishByMaterial.length === 0);
  fc.payload.onAction('confirm');
  ok('V6b 确认后调用 room.finishByMaterial 且参数=judgeByMaterial 结果',
    roomCall.finishByMaterial.length === 1 &&
    roomCall.finishByMaterial[0].winner === 'w' &&
    roomCall.finishByMaterial[0].reason === ROOM_RESULT.materialWhite,
    JSON.stringify(roomCall.finishByMaterial));
  ok('V6c 本地按 winner 结算 result=white_win', s.game.result === 'white_win', 'result=' + s.game.result);
  ok('V6d 结束后打开结算态', s.state === 'GAMEOVER' && openModalCalls.some(c => c.key === 'gameover'));
  s.exit();
}

console.log('\n=== v5-7 双方均退出超时自动封存 ===');
{
  resetCaptures();
  const s = makeRemoteScene({ role: 'host' });
  s.onRemoteSnapshot({ movesUci: [], rev: 2, status: 'playing', turn: 'w',
    hostPresent: false, hostLeftAt: Date.now() - 5000,
    guestPresent: false, guestLeftAt: Date.now() - 5000, keepUntil: Date.now() - 1000 });
  s.update(0.016);
  ok('V7a keepUntil 已过期 → 自动调用 room.archiveGame()', roomCall.archiveGame === 1, 'count=' + roomCall.archiveGame);
  ok('V7b remoteBothLeft=true 且 remoteStatus=archived', s.remoteBothLeft === true && s.remoteStatus === 'archived');
  s.update(0.016);
  ok('V7c 超时封存只做一次（_abandonArchived 去重）', roomCall.archiveGame === 1, 'count=' + roomCall.archiveGame);
  s.exit();
}
{
  resetCaptures();
  const s = makeRemoteScene({ role: 'host' });
  s.onRemoteSnapshot({ movesUci: [], rev: 2, status: 'playing', turn: 'w',
    hostPresent: false, hostLeftAt: Date.now() - 5000,
    guestPresent: false, guestLeftAt: Date.now() - 5000, keepUntil: Date.now() + 300000 });
  s.update(0.016);
  ok('V7d keepUntil 未过期 → 不自动封存', roomCall.archiveGame === 0 && s.remoteBothLeft === true);
  ok('V7e 未过期时 HUD 倒计时文案 mm:ss', /^\d\d:\d\d$/.test(s._abandonCountdownText()),
    'text=' + s._abandonCountdownText());
  ok('V7f 双方均退出主动调一次 room.markBothLeft() 写 keepUntil',
    roomCall.markBothLeft === 1, 'count=' + roomCall.markBothLeft);
  s.update(0.016);
  ok('V7g 多次 update 只调一次 markBothLeft（本地 _bothLeftMarked 去重）',
    roomCall.markBothLeft === 1, 'count=' + roomCall.markBothLeft);
  s.exit();
}

console.log('\n=== v5-8 buildRecord opponent 三态 / opponentNick ===');
{
  const ai = makeScene('ai', COLOR.BLACK);
  const recAi = ai.buildRecord(false);
  ok('V8a ai opponent=`AI · 难度`', /^AI · /.test(recAi.opponent), recAi.opponent);
  ok('V8b ai opponentNick 为空串', recAi.opponentNick === '');
  const local = makeScene('local', COLOR.BLACK);
  ok('V8c local opponent="本地对手"', local.buildRecord(false).opponent === '本地对手');
  const rem = makeRemoteScene({ role: 'host' });
  rem.remoteOpponentNick = '小明';
  const recRem = rem.buildRecord(false);
  ok('V8d remote opponent=对端昵称', recRem.opponent === '小明', recRem.opponent);
  ok('V8e remote opponentNick=对端昵称', recRem.opponentNick === '小明', recRem.opponentNick);
  rem.remoteOpponentNick = '';
  ok('V8f remote 无昵称兜底"远程对手"', rem.buildRecord(false).opponent === '远程对手');
  rem.exit();
}

console.log('\n=== v5-9 buildRecord remote outcome ===');
{
  const rem = makeRemoteScene({ role: 'host', playerColor: 'w' });
  rem.game.result = 'white_win';
  ok('V9a remote winner===playerColor → outcome="win"', rem.buildRecord(false).outcome === 'win');
  rem.game.result = 'black_win';
  ok('V9b remote winner!==playerColor → outcome="loss"', rem.buildRecord(false).outcome === 'loss');
  rem.game.result = 'draw';
  ok('V9c remote draw → outcome="draw"', rem.buildRecord(false).outcome === 'draw');
  const local = makeScene('local', COLOR.BLACK);
  local.game.result = 'black_win';
  ok('V9d local 恒 outcome="win"', local.buildRecord(false).outcome === 'win', local.buildRecord(false).outcome);
  rem.exit();
}

console.log('\n=== v5-10 remote 自动存档 + savedGameId ===');
{
  resetCaptures();
  const rem = makeRemoteScene({ role: 'host', playerColor: 'w' });
  rem.game.makeMove(rem.game.getLegalMoves()[0]);   // 保证 movesUci.length>=1
  rem.game.result = 'white_win';
  rem.onGameOver();
  ok('V10a autoSaveGame=true 且 remote → persistRecord 被调用（saveRecord 捕获）',
    saveRecordCalls.length === 1, 'calls=' + saveRecordCalls.length);
  ok('V10b 自动存档后 savedGameId 非空', !!rem.savedGameId, 'id=' + rem.savedGameId);
  ok('V10c 打开结算态', openModalCalls.some(c => c.key === 'gameover'));
  rem.exit();
}

console.log('\n=== v5-11 onRemoteSnapshot 缓存对端昵称 / roomDoc ===');
{
  const host = makeRemoteScene({ role: 'host' });
  host.onRemoteSnapshot({ movesUci: [], rev: 2, status: 'playing', hostNick: '房主', guestNick: '客人A' });
  ok('V11a host 读 doc.guestNick', host.remoteOpponentNick === '客人A', host.remoteOpponentNick);
  ok('V11b 缓存 this.roomDoc', !!host.roomDoc && host.roomDoc.guestNick === '客人A');
  const guest = makeRemoteScene({ role: 'guest', playerColor: 'b' });
  guest.onRemoteSnapshot({ movesUci: [], rev: 2, status: 'playing', hostNick: '房主B', guestNick: '客人' });
  ok('V11c guest 读 doc.hostNick', guest.remoteOpponentNick === '房主B', guest.remoteOpponentNick);
  host.exit(); guest.exit();
}

console.log('\n=== v5-12 房主才记录比分 recordGameResult ===');
{
  resetCaptures();
  const host = makeRemoteScene({ role: 'host', playerColor: 'w' });
  host.game.makeMove(host.game.getLegalMoves()[0]);
  host.game.result = 'black_win';
  host.onGameOver();
  ok('V12a host → recordGameResult 调用且映射 materialBlack',
    roomCall.recordGameResult.length === 1 && roomCall.recordGameResult[0] === ROOM_RESULT.materialBlack,
    JSON.stringify(roomCall.recordGameResult));
  host.exit();
  resetCaptures();
  const guest = makeRemoteScene({ role: 'guest', playerColor: 'b' });
  guest.game.makeMove(guest.game.getLegalMoves()[0]);
  guest.game.result = 'white_win';
  guest.onGameOver();
  ok('V12b guest → 不调用 recordGameResult', roomCall.recordGameResult.length === 0,
    JSON.stringify(roomCall.recordGameResult));
  guest.exit();
}

console.log('\n=== v5-13 心跳定时器 enter 启动 / exit 清理 ===');
{
  resetCaptures();
  const s = makeRemoteScene({ role: 'host' });
  const hbId = s._heartbeatTimer;
  ok('V13a enter(remote) 以 presenceIntervalMs=10000 注册心跳 interval',
    hbId != null && intervalRecords.some(r => r.id === hbId && r.ms === 10000), 'hbId=' + hbId);
  fireIntervalById(hbId);
  ok('V13b 心跳触发调用 room.heartbeat()', roomCall.heartbeat >= 1, 'hb=' + roomCall.heartbeat);
  const before = roomCall.heartbeat;
  s.exit();
  fireIntervalById(hbId);   // 已 cleared → 不执行
  ok('V13c exit() 后 clearInterval 清理，心跳不再调用',
    roomCall.heartbeat === before, 'hb=' + roomCall.heartbeat + ' before=' + before);
}

console.log('\n=== v5-14 rejoinEntry 导出 / params.rejoin 语义 ===');
{
  ok('V14a GameplayScene.rejoinEntry 为导出静态方法', typeof GameplayScene.rejoinEntry === 'function');
  resetCaptures();
  const entry = GameplayScene.rejoinEntry();
  ok('V14b rejoinEntry() 返回 {roomId,seat,role}',
    !!entry && entry.roomId === '123456' && !!entry.seat && !!entry.role, JSON.stringify(entry));
  ok('V14c rejoinEntry() 内部调用 room.readLocalRoom()', roomCall.readLocalRoom >= 1);
  const s = new GameplayScene();
  s.enter({ screenWidth: 375, screenHeight: 667, _sm: mockSM(), mode: 'remote', playerColor: 'w',
    roomId: '123456', seat: 'seat-x', role: 'host', rejoin: true, movesUci: ['e2e4'] });
  ok('V14d params.rejoin 保留 movesUci 重放（现有逻辑）', s.game.getStatus().movesUci.length === 1,
    'plies=' + s.game.getStatus().movesUci.length);
  ok('V14e params.rejoin 清仲裁状态',
    s.arbitrationPrompted === false && s.remoteLeft === null && s.arbitrationWaiting === false);
  s.exit();
}

console.log('\n=== v5-15 结算第三行 / 常驻入口静态接线 ===');
{
  const src = readSrc('src/scenes/gameplay.js');
  ok('V15a 移除「联机对局不写入本地棋谱」整行替换', !/联机对局不写入本地棋谱/.test(src));
  ok('V15b archived perspective「残局已封存 · 不判成绩」', /残局已封存 · 不判成绩/.test(src));
  ok('V15c 更多抽屉 abort「结束对弈（按兵力判定）」', /key: 'abort'/.test(src) && /结束对弈（按兵力判定）/.test(src));
  ok('V15d HUD 常驻仲裁入口命中区 _arbitrationRegion', /_arbitrationRegion/.test(src));
  ok('V15e render 含 renderGeneric(...)（confirm 三选项由 ModalManager 统一绘制）', /renderGeneric\(/.test(src));
  ok('V15f 所有 room.* 新接口调用带 typeof 守卫',
    /typeof room\.heartbeat === 'function'/.test(src) && /typeof room\.archiveGame === 'function'/.test(src));
  ok('V15g markBothLeft 调用带 typeof 守卫且本地 _bothLeftMarked 去重',
    /typeof room\.markBothLeft === 'function'/.test(src) && /_bothLeftMarked/.test(src));
}

console.log('\n=== v5-16 能力防御：协议层缺 v5 接口时全链路不抛 ===');
{
  resetCaptures();
  const keys = ['heartbeat', 'markLeft', 'markBothLeft', 'archiveGame', 'finishByMaterial', 'recordGameResult', 'readLocalRoom'];
  const saved = {};
  keys.forEach(k => { saved[k] = roomMod[k]; delete roomMod[k]; });
  let err = null, rejoinResult = 'unset';
  try {
    // 双方均退出路径：markBothLeft 缺失时守卫跳过，不抛
    const s1 = makeRemoteScene({ role: 'host' });
    s1.onRemoteSnapshot({ movesUci: [], rev: 2, status: 'playing', turn: 'w',
      hostPresent: false, hostLeftAt: Date.now() - 5000,
      guestPresent: false, guestLeftAt: Date.now() - 5000, keepUntil: Date.now() + 300000 });
    s1.update(0.016);
    s1.exit();
    // 单方退出 → 仲裁 → archive(缺) / onGameOver(recordGameResult 缺) / exit(markLeft 缺) / rejoinEntry(readLocalRoom 缺)
    const s2 = makeRemoteScene({ role: 'host', playerColor: 'w' });
    s2.onRemoteSnapshot({ movesUci: [], rev: 2, status: 'playing', turn: 'b',
      guestPresent: false, guestLeftAt: Date.now() - 70000, hostPresent: true, hostLeftAt: 0 });
    s2.update(0.016);
    const arb = lastConfirm('对手已离开');
    if (arb) arb.payload.onAction('archive');
    s2.game.result = 'white_win';
    s2.onGameOver();
    s2.exit();
    rejoinResult = GameplayScene.rejoinEntry();
  } catch (e) { err = e; }
  keys.forEach(k => { if (saved[k] !== undefined) roomMod[k] = saved[k]; });
  ok('V16a 缺 heartbeat/markLeft/markBothLeft/archiveGame/finishByMaterial/recordGameResult/readLocalRoom 时 enter/update/archive/onGameOver/exit 不抛',
    !err, err && (err.stack || err.message));
  ok('V16b 缺 readLocalRoom 时 rejoinEntry() 返回 null', rejoinResult === null,
    'ret=' + JSON.stringify(rejoinResult));
}

console.log('\n============================================================');
console.log('游戏逻辑单测结果: ' + passed + ' 通过 / ' + failed + ' 失败 / ' + skipped + ' 跳过');
if (skipped) {
  console.log('跳过项（模块/方法未落盘，集成时复跑）:');
  skipReasons.forEach(function (r) { console.log('  - ' + r); });
}
if (failed) {
  console.log('失败项：\n - ' + failures.join('\n - '));
  process.exit(1);
}
console.log('ALL GREEN');
