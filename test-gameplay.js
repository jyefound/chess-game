/**
 * 针对 P0-I2（AI 悔棋软锁）与 P1-I3（断点恢复一致性）的单元回归测试。
 * 直接实例化 GameplayScene，隔离 GameContext 副作用，验证：
 *   1) AI 执白先走、玩家（黑）在其首手前撤销 → 不再双向死锁（AI 被唤起思考）。
 *   2) 玩家执白常规两步后撤销 → 回到玩家走子（IDLE），不引入回归。
 *   3) 断点重放步数与快照不符 → 丢弃脏快照（clearResume），不残留脏态。
 *   4) 完整合法重放 → 不误触发 clearResume，且棋谱步数一致。
 * 运行：node test-gameplay.js
 */
'use strict';

// ---------- mock 微信环境（仅 storage / systemInfo，足够场景构造）----------
const storageMap = {};
global.wx = {
  getSystemInfoSync() { return { windowWidth: 375, windowHeight: 667, pixelRatio: 2 }; },
  setStorageSync(k, v) { storageMap[k] = v; },
  getStorageSync(k) { return Object.prototype.hasOwnProperty.call(storageMap, k) ? storageMap[k] : ''; },
  removeStorageSync(k) { delete storageMap[k]; }
};

const ChessGame = require('./src/core/game');
const { COLOR } = require('./src/core/constants');
const GameplayScene = require('./src/scenes/gameplay');
const GameContext = require('./src/context');

// 隔离 GameContext 副作用（模块单例，覆盖为 no-op + 计数）
GameContext.emit = function () {};
GameContext.closeModal = function () {};
GameContext.showBanner = function () {};
let clearedCount = 0;
GameContext.clearResume = function () { clearedCount++; };

let passed = 0, failed = 0;
const failures = [];
function ok(name, cond, detail) {
  if (cond) { passed++; console.log('  ✓ ' + name); }
  else { failed++; failures.push(name + (detail ? ' | ' + detail : '')); console.log('  ✗ ' + name + (detail ? ' | ' + detail : '')); }
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

console.log('\n============================================================');
console.log('游戏逻辑单测结果: ' + passed + ' 通过 / ' + failed + ' 失败');
if (failed) {
  console.log('失败项：\n - ' + failures.join('\n - '));
  process.exit(1);
}
console.log('ALL GREEN');
