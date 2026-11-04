/**
 * 引擎抽象层 + 残局存档验收测试
 * 运行：node test-engine.js
 *
 * 覆盖：registry 注册表 / chess 适配器契约全方法 / FEN 往返 / clone 独立性 /
 *      search 薄封装 / 三棋种占位 / storage 残局存档 API 往返。
 */
'use strict';

// mock wx 存储：storage 无 wx 时回退内存 Map；这里 mock 以便直接注入损坏原始值验证容错
const _wxStore = {};
global.wx = {
  getStorageSync(k) { return _wxStore[k]; },
  setStorageSync(k, v) { _wxStore[k] = v; },
  removeStorageSync(k) { delete _wxStore[k]; }
};

let passed = 0, failed = 0;
const failures = [];
function ok(name, cond, detail) {
  if (cond) { passed++; console.log('  ✓ ' + name); }
  else { failed++; failures.push(name + (detail ? ' | ' + detail : '')); console.log('  ✗ ' + name + (detail ? ' | ' + detail : '')); }
}
function section(t) { console.log('\n=== ' + t + ' ==='); }

// =====================================================================
section('registry 注册表');
const registry = require('./src/engine/registry');
ok('hasGame("chess")', registry.hasGame('chess') === true);
ok('listGames() 含 chess', registry.listGames().indexOf('chess') >= 0, JSON.stringify(registry.listGames()));
const eng = registry.getGame('chess');
ok('getGame("chess") 返回实例', !!eng && typeof eng.init === 'function');
ok('getGame 未注册返回 null', registry.getGame('nope') === null);
ok('registerGame 校验入参', registry.registerGame('', null) === false && registry.registerGame('x', 'y') === false);
ok('registerGame 自定义工厂', registry.registerGame('demo', function () { return { id: 'demo' }; }) === true &&
   registry.getGame('demo').id === 'demo');

// =====================================================================
section('chess 适配器 — 契约属性与全方法');
const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
const AFTER_E4 = 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1';
ok('cols/rows/gridType', eng.cols === 8 && eng.rows === 8 && eng.gridType === 'square');

ok('init(null) 重置初始局面', eng.init(null) === true && eng.toFen() === START_FEN);
const moves = eng.getLegalMoves();
ok('初始合法走法 20', moves.length === 20, 'got ' + moves.length);
ok('走法为契约格式 {from:[r,c],to:[r,c]}', moves.every(m =>
  Array.isArray(m.from) && m.from.length === 2 &&
  Array.isArray(m.to) && m.to.length === 2 &&
  typeof m.from[0] === 'number' && typeof m.to[1] === 'number'));

const e2e4 = moves.find(m => m.from[0] === 6 && m.from[1] === 4 && m.to[0] === 4 && m.to[1] === 4);
ok('e2e4 存在且无 promotion 字段', !!e2e4 && !('promotion' in e2e4));

const pE4 = eng.getPieceAt([6, 4]);
ok('getPieceAt([6,4]) 为白兵', pE4 && pE4.type === 'p' && pE4.color === 'w');
ok('getPieceAt([3,3]) 空位为 null', eng.getPieceAt([3, 3]) === null);
ok('getPieceAt 非法入参返回 null', eng.getPieceAt('xx') === null);

ok('uciToMove("e2e4")', JSON.stringify(eng.uciToMove('e2e4')) === JSON.stringify({ from: [6, 4], to: [4, 4] }));
ok('uciToMove("e7e8q") 含升变', (() => { const m = eng.uciToMove('e7e8q'); return m && m.from[0] === 1 && m.to[0] === 0 && m.promotion === 'q'; })());
ok('uciToMove 非法串返回 null', eng.uciToMove('zz') === null && eng.uciToMove('e') === null && eng.uciToMove(123) === null);
ok('moveToUci 往返 "e2e4"', eng.moveToUci(eng.uciToMove('e2e4')) === 'e2e4');
ok('moveToUci 往返 "e7e8q"', eng.moveToUci(eng.uciToMove('e7e8q')) === 'e7e8q');

ok('applyMove(e2e4) 成功', eng.applyMove(e2e4) === true);
ok('走 e2e4 后 toFen 正确', eng.toFen() === AFTER_E4, eng.toFen());
ok('undo() 恢复', eng.undo() === true && eng.toFen() === START_FEN);
ok('undo 后合法走法回 20', eng.getLegalMoves().length === 20);
ok('undo 空历史返回 false', eng.undo() === false);

// =====================================================================
section('chess 适配器 — clone / 终局 / 升变 / FEN 往返');
eng.init(null);
eng.applyMove(eng.uciToMove('e2e4'));
const eng2 = eng.clone();
ok('clone 局面一致', eng2.toFen() === AFTER_E4);
ok('clone 悔棋历史一致', eng2.undo() === true && eng2.toFen() === START_FEN && eng.toFen() === AFTER_E4);
eng2.applyMove(eng2.uciToMove('e2e4'));
eng2.applyMove(eng2.uciToMove('e7e5'));
ok('clone 走子不影响本体', eng.toFen() === AFTER_E4 && eng2.toFen() !== AFTER_E4);

// 愚人将杀：f3 e5 g4 Qh4#
const mate = registry.getGame('chess');
mate.init(null);
['f2f3', 'e7e5', 'g2g4', 'd8h4'].forEach(u => ok('  将杀序列 ' + u, mate.applyMove(mate.uciToMove(u)) === true));
ok('isGameOver() 将杀后为 true', mate.isGameOver() === true);
ok('getWinner() 黑胜 "b"', mate.getWinner() === 'b');
ok('初始 isGameOver 为 false / getWinner null', (() => { const g = registry.getGame('chess'); g.init(null); return g.isGameOver() === false && g.getWinner() === null; })());

// 升变走法
const promo = registry.getGame('chess');
promo.init('8/P6k/8/8/8/8/8/K7 w - - 0 1');
const promoMoves = promo.getLegalMoves().filter(m => m.promotion);
ok('升变 4 种（q/r/b/n）', promoMoves.length === 4 && promoMoves.map(m => m.promotion).sort().join('') === 'bnqr', promoMoves.map(m => m.promotion).join(','));

// FEN 往返（含吃过路兵 / 易位权）
const fenIn = 'r3k2r/ppp2ppp/8/3pP3/8/8/PPP2PPP/R3K2R w KQkq d6 0 3';
ok('init(fen) 成功', promo.init(fenIn) === true);
ok('toFen() 往返一致', promo.toFen() === fenIn, promo.toFen());
ok('init 非法 FEN 返回 false 且不破坏局面', promo.init('bad/fen') === false && promo.toFen() === fenIn);
ok('init() 空参回初始', promo.init() === true && promo.toFen() === START_FEN);

// =====================================================================
section('search 薄封装 + 占位棋种');
const search = require('./src/engine/search');
ok('search.createSearch 为函数（转发 core/ai）', typeof search.createSearch === 'function');
ok('search.findBestMove 为函数', typeof search.findBestMove === 'function');

const xiangqi = require('./src/engine/xiangqi');
const gomoku = require('./src/engine/gomoku');
const go = require('./src/engine/go');
ok('xiangqi 占位工厂存在', typeof xiangqi.createXiangqiEngine === 'function');
ok('xiangqi 调用抛 not-implemented', (() => { try { xiangqi.createXiangqiEngine(); return false; } catch (e) { return /not-implemented/.test(e.message); } })());
ok('gomoku 占位调用抛 not-implemented', (() => { try { gomoku.createGomokuEngine(); return false; } catch (e) { return /not-implemented/.test(e.message); } })());
ok('go 占位调用抛 not-implemented', (() => { try { go.createGoEngine(); return false; } catch (e) { return /not-implemented/.test(e.message); } })());

const contract = require('./src/engine/interface');
ok('interface 契约含全部方法', ['init', 'getLegalMoves', 'applyMove', 'undo', 'isGameOver',
  'getWinner', 'toFen', 'clone', 'getPieceAt', 'moveToUci', 'uciToMove']
  .every(k => !!contract.methods[k]));

// =====================================================================
section('storage 残局存档 API（§1.8 结构）');
const storage = require('./src/core/storage');
storage._rawRemove('chess.endgame.v1');

const d0 = storage.loadEndgame();
ok('loadEndgame 默认结构（§1.8）', d0.version === 1 && d0.unlockedLevel === 1 &&
   JSON.stringify(d0.cleared) === '{}' && JSON.stringify(d0.skills) === '[]' &&
   JSON.stringify(d0.tipsCollected) === '[]' && d0.pendingHints === 0 &&
   d0.stats.totalAttempts === 0 && d0.stats.totalClears === 0 && d0.updatedAt === 0,
   JSON.stringify(d0));

// 验收：loadEndgame 后 addSkill 再 save 再 load 值正确
const d1 = storage.loadEndgame();
storage.addSkill('skill_mirror', 2);
storage.saveEndgame(d1);
ok('addSkill(skill_mirror,2)+save+load 往返 charges=2', (() => {
  const s = storage.loadEndgame().skills.filter(x => x.id === 'skill_mirror')[0];
  return !!s && s.charges === 2;
})());

ok('addSkill 同 id 聚合 charges=3', storage.addSkill('skill_mirror', 1) === 3 &&
   storage.loadEndgame().skills.filter(x => x.id === 'skill_mirror').length === 1);

ok('useSkill 成功消耗 charges=2', storage.useSkill('skill_mirror') === true &&
   storage.loadEndgame().skills.filter(x => x.id === 'skill_mirror')[0].charges === 2);
ok('useSkill 归零移除条目、再用返回 false', (() => {
  storage.addSkill('skill_undo', 1);
  storage.useSkill('skill_undo');            // 1 → 0，条目移除
  const gone = !storage.loadEndgame().skills.some(x => x.id === 'skill_undo');
  return storage.useSkill('skill_undo') === false && gone;
})());

ok('unlockLevel 取 max 且 1-based 校验', (() => {
  storage.unlockLevel(3);
  const noBack = storage.unlockLevel(2) === 3;   // 不回退
  const forward = storage.unlockLevel(5) === 5;
  return noBack && forward && storage.loadEndgame().unlockedLevel === 5 && storage.unlockLevel(0) === false;
})());

ok('setCleared 更优值合并（星高/时间小/步数小/rewarded 保持）', (() => {
  storage.setCleared(1, { stars: 3, bestTimeMs: 12000, bestMoves: 1, rewarded: true });
  storage.setCleared(1, { stars: 2, bestTimeMs: 8000, bestMoves: 2, rewarded: false });
  const c = storage.loadEndgame().cleared['1'];
  return !!c && c.stars === 3 && c.bestTimeMs === 8000 && c.bestMoves === 1 && c.rewarded === true;
})());
ok('setCleared 非法入参返回 false', storage.setCleared(0, { stars: 1 }) === false &&
   storage.setCleared(2, null) === false);

ok('collectTip 去重收录', (() => {
  const first = storage.collectTip('tip_01');
  const dup = storage.collectTip('tip_01');
  return first === true && dup === false && storage.loadEndgame().tipsCollected.join() === 'tip_01';
})());

ok('pendingHints 增减（不足不变）', (() => {
  const added = storage.addPendingHints(3);
  const used = storage.consumePendingHints() === true;    // 3 → 2
  const fail = storage.consumePendingHints(5) === false;  // 不足，不变
  return added === 3 && used && fail && storage.loadEndgame().pendingHints === 2;
})());

ok('stats 递增', storage.recordAttempt() === 1 && storage.recordClear() === 1 &&
   storage.loadEndgame().stats.totalAttempts === 1 && storage.loadEndgame().stats.totalClears === 1);

ok('写入自动更新 updatedAt', storage.loadEndgame().updatedAt > 0);

ok('技能库上限 8：第 9 个转 pendingHints+1 并移除最普通的一个', (() => {
  storage._rawRemove('chess.endgame.v1');
  storage.loadEndgame();   // 刷回默认（活对象随存储重读）
  ['skill_hourglass', 'skill_mirror', 'skill_undo', 'skill_scout',
   'skill_freeze', 'skill_master', 'skill_ward', 'custom_a'].forEach(id => storage.addSkill(id, 1));
  const eight = storage.loadEndgame();
  const before = eight.skills.length === 8 && eight.pendingHints === 0;
  storage.addSkill('custom_b', 1);          // 第 9 条 → 超限
  const eg = storage.loadEndgame();
  // 最普通 = 普通稀有度 → charges 小 → 规范表序（skill_hourglass）
  return before && eg.skills.length === 8 && eg.pendingHints === 1 &&
         !eg.skills.some(x => x.id === 'skill_hourglass');
})());

ok('saveEndgame 整体保存往返（缺省键并默认）', (() => {
  storage.saveEndgame({
    version: 1, unlockedLevel: 9,
    cleared: { '9': { stars: 2, bestTimeMs: 30000, bestMoves: 3, rewarded: true } },
    skills: [{ id: 'skill_master', charges: 2 }], tipsCollected: ['tip_12'], pendingHints: 1
  });
  const d = storage.loadEndgame();
  return d.unlockedLevel === 9 && d.cleared['9'].bestTimeMs === 30000 &&
         d.skills.length === 1 && d.skills[0].charges === 2 &&
         d.tipsCollected.join() === 'tip_12' && d.pendingHints === 1 &&
         d.stats.totalAttempts === 0 && d.updatedAt > 0;   // stats 缺省并默认
})());
ok('saveEndgame 非法入参返回 invalid', storage.saveEndgame(null).ok === false &&
   storage.saveEndgame('x').reason === 'invalid');

ok('读损坏返回默认且不覆盖坏数据', (() => {
  wx.setStorageSync('chess.endgame.v1', '{corrupt!');   // 直写损坏原始值
  const d = storage.loadEndgame();
  const raw = storage._readJSON('chess.endgame.v1');
  return d.unlockedLevel === 1 && d.skills.length === 0 &&
         raw.corrupt === true;                          // 坏数据仍在，未被修复覆盖
})());

// =====================================================================
console.log('\n============================================================');
console.log('引擎抽象验收结果: ' + passed + ' 通过 / ' + failed + ' 失败');
if (failures.length) { console.log('失败项:'); failures.forEach(f => console.log('  - ' + f)); }
console.log('============================================================');
process.exit(failed === 0 ? 0 : 1);
