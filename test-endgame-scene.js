/**
 * S9 阵图 + S10 残局对局 场景测试（v2 残局闯关）
 *
 * 覆盖：
 *   S9 阵图：阵卡渲染（已解锁全显；未解锁仅前 5 张 + 「待解锁」折叠卡）/ 解锁态（锁定·当前·已破）/ 星级与最佳用时 / 点击导航
 *   S10 对局：FEN 建局 / 软计时（准备宽限·临界·超时）/ 机会经济（锦囊·回马枪·技能）
 *             / 超步数失败 / 破阵奖励写入 / 星级三档 / 模态流程
 *
 * 注：关卡/妙招数量一律从 ENDGAMES.length / TIPS.length 派生；杀着用 findMateMove(sc,fen)
 *     （底层 findMateInOneUci 走 engineRegistry）动态求解、回马枪前置用 findNonMateMove
 *     构造；tipId 取 ENDGAMES[0].tipId。以适配数据层扩容（100 阵 / 15 妙招 / FEN 与
 *     tipId 语义化）。
 *
 * 运行：node test-endgame-scene.js
 */
'use strict';

let passed = 0, failed = 0;
const failures = [];
function ok(name, cond, detail) {
  if (cond) { passed++; console.log('  ✓ ' + name); }
  else { failed++; failures.push(name + (detail ? ' | ' + detail : '')); console.log('  ✗ ' + name + (detail ? ' | ' + detail : '')); }
}
function section(t) { console.log('\n=== ' + t + ' ==='); }

// ---------- mock 微信环境（内存存储）----------
const storageMap = {};
global.wx = {
  createCanvas() { return { width: 750, height: 1334, getContext() { return makeCtx(); } }; },
  getSystemInfoSync() { return { windowWidth: 375, windowHeight: 667, pixelRatio: 2 }; },
  setStorageSync(k, v) { storageMap[k] = v; },
  getStorageSync(k) { return Object.prototype.hasOwnProperty.call(storageMap, k) ? storageMap[k] : ''; },
  removeStorageSync(k) { delete storageMap[k]; },
  createInnerAudioContext() {
    return { src: '', volume: 1, play() {}, stop() {}, destroy() {},
      onError() {}, onCanplay() {}, onEnded() {} };
  }
};

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
      if (p === 'createLinearGradient' || p === 'createRadialGradient' || p === 'createPattern') {
        return () => ({ addColorStop() {} });
      }
      if (p === 'getImageData') return () => ({ data: new Uint8ClampedArray(4) });
      if (p === 'canvas') return { width: 750, height: 1334 };
      if (p === 'isPointInPath' || p === 'isPointInStroke') return () => false;
      return () => {};
    },
    set(t, p, v) { t[p] = v; return true; }
  });
}

// ---------- 被测模块 ----------
const storage = require('./src/core/storage');
const { ENDGAMES, TIPS, SKILLS } = require('./src/data/endgames');
const EndgameMapScene = require('./src/scenes/endgameMap');
const EndgameScene = require('./src/scenes/endgame');
const GameContext = require('./src/context');
const engineRegistry = require('./src/engine/registry');

function freshStorage() {
  Object.keys(storageMap).forEach(k => { delete storageMap[k]; });
  try { storage.loadEndgame(); } catch (e) { /* noop */ }
}

// ---------- 动态局面工具：残局库已扩到 ENDGAMES.length 阵，禁止硬编码杀着坐标 ----------
/**
 * 在指定 FEN 下求一条「一步将杀」的 UCI。
 * 数据层 FEN/杀着已多次调整（EG-01 从 Ra1-a8 改为 Rb4-b8），
 * 测试一律动态求解，不再写死 from/to 行列。
 */
function findMateInOneUci(fen) {
  const eng = engineRegistry.getGame('chess');
  if (!eng || !eng.init(fen)) return null;
  for (const m of eng.getLegalMoves()) {
    const probe = eng.clone();
    if (!probe.applyMove(m)) continue;
    if (probe.isGameOver() && probe.getWinner() === 'w') return eng.moveToUci(m);
  }
  return null;
}

/** UCI → 场景 core ChessGame 的合法走法对象（供 commitMove 使用）。 */
function findMateMove(sc, fen) {
  const uci = findMateInOneUci(fen);
  return uci ? sc.game.findMoveByUci(uci) : null;
}

/** 取一条「不会立刻将杀」的合法走法，用于制造对局历史（回马枪前置条件）。 */
function findNonMateMove(sc, fen) {
  const uci = findMateInOneUci(fen);
  const moves = sc.game.getLegalMoves();
  return moves.find(m => sc.game.moveToUci(m) !== uci) || moves[0] || null;
}

// =====================================================================
section('A. S9 阵图：结构 / 解锁态 / 成绩');
// =====================================================================
{
  const sc = new EndgameMapScene();
  sc.enter({ screenWidth: 375, screenHeight: 667 });
  const ctx = makeCtx();
  let err = null;
  try { sc.render(ctx, 375, 667); } catch (e) { err = e; }
  ok('阵图 render 无异常', !err, err && (err.stack || err.message));

  const cardRegions = sc.regions.filter(r => r.key.indexOf('lv:') === 0);
  // P3 展示规则：已解锁全显；未解锁仅展示前 LOCKED_PREVIEW(=5) 张，其余折叠为「待解锁」汇总卡。
  const shown = Math.min(ENDGAMES.length, sc.unlockedLevel + 5);
  ok('阵图渲染可见阵卡（lv:1..lv:shown 连续前缀且数量正确）',
    cardRegions.length === shown &&
    cardRegions.every((r, i) => r.key === 'lv:' + (i + 1)),
    'cards=' + cardRegions.length + ' shown=' + shown + ' total=' + ENDGAMES.length);
  ok('初始仅第 1 阵可玩', sc.unlockedLevel === 1, 'unlocked=' + sc.unlockedLevel);

  // P3：未解锁关卡折叠为「待解锁」汇总卡（其余不逐张渲染，避免 100 张灰卡刷屏）
  const foldRegion = sc.regions.find(r => r.key === 'fold');
  ok('存在「待解锁」折叠汇总卡', !!foldRegion, 'regions=' + sc.regions.length);

  // 拦截 pushScene，验证锁阵 / 折叠卡不导航、已解锁阵导航
  let navigated = false;
  const origPush = GameContext.pushScene;
  GameContext.pushScene = function () { navigated = true; };

  // 点预览内锁阵（第 3 阵，n>unlockedLevel）→ 不导航，出 info 提示
  const lockedRegion = sc.regions.find(r => r.key === 'lv:3');
  ok('预览内锁阵（第 3 阵）存在命中区', !!lockedRegion);
  if (lockedRegion) {
    sc.onTouchStart(lockedRegion.rect.x + 2, lockedRegion.rect.y + 2);
    sc.onTouchEnd(lockedRegion.rect.x + 2, lockedRegion.rect.y + 2);
  }
  ok('点锁阵不进入对局', !navigated);

  // 点折叠汇总卡 → 不导航（仅 info 提示）
  if (foldRegion) {
    sc.onTouchStart(foldRegion.rect.x + 2, foldRegion.rect.y + 2);
    sc.onTouchEnd(foldRegion.rect.x + 2, foldRegion.rect.y + 2);
  }
  ok('点折叠汇总卡不进入对局', !navigated);

  // 点已解锁阵 → 导航到 endgame
  const lv1 = sc.regions.find(r => r.key === 'lv:1');
  sc.onTouchStart(lv1.rect.x + 2, lv1.rect.y + 2);
  sc.onTouchEnd(lv1.rect.x + 2, lv1.rect.y + 2);
  GameContext.pushScene = origPush;
  ok('点已解锁阵进入 endgame 场景', navigated);
}

// 解锁推进 + 星级/最佳用时展示
{
  freshStorage();
  storage.unlockLevel(3);
  storage.setCleared(1, { stars: 3, bestTimeMs: 12300, bestMoves: 1, rewarded: true });
  storage.setCleared(2, { stars: 2, bestTimeMs: 38000, bestMoves: 2, rewarded: true });
  const sc = new EndgameMapScene();
  sc.enter({ screenWidth: 375, screenHeight: 667 });
  ok('已破阵数读取正确', sc.clearedCount() === 2, 'cleared=' + sc.clearedCount());
  ok('解锁进度读取正确', sc.unlockedLevel === 3, 'unlocked=' + sc.unlockedLevel);
  const ctx = makeCtx();
  let err = null;
  try { sc.render(ctx, 375, 667); } catch (e) { err = e; }
  ok('阵图（已破态）render 无异常', !err, err && (err.stack || err.message));
}

// =====================================================================
section('B. S10 对局：建局 / 状态机 / 软计时');
// =====================================================================
{
  const sc = new EndgameScene();
  sc.enter({ screenWidth: 375, screenHeight: 667, level: 1 });
  ok('第 1 阵载入正确', sc.eg && sc.eg.id === 'EG-01', sc.eg && sc.eg.id);
  ok('起始为 PREPARE 状态', sc.state === 'PREPARE', sc.state);
  ok('白方先行', sc.game && sc.game.turn === 'w');
  ok('准备宽限 3 秒', sc.prepareLeftMs === 3000, 'prepare=' + sc.prepareLeftMs);
  ok('每阵锦囊提示 3 次', sc.hints === 3, 'hints=' + sc.hints);
  ok('每阵回马枪 1 次', sc.undos === 1, 'undos=' + sc.undos);
  ok('限时取自关卡数据', sc.limitMs === ENDGAMES[0].timeLimitSec * 1000, 'limit=' + sc.limitMs);

  const ctx = makeCtx();
  let err = null;
  try { sc.render(ctx, 375, 667); } catch (e) { err = e; }
  ok('对局 render 无异常', !err, err && (err.stack || err.message));

  // 准备宽限内（推进 2.0s < 3s 宽限）：不计时，状态仍为 PREPARE
  for (let i = 0; i < 125; i++) sc.update(0.016);
  ok('宽限内状态仍为 PREPARE', sc.state === 'PREPARE', sc.state);
  ok('宽限期间未累计用时', sc.elapsedMs === 0, 'elapsed=' + sc.elapsedMs);

  // 宽限结束 → PLAYING，开始计时
  for (let i = 0; i < 100; i++) sc.update(0.016);
  ok('宽限结束进入 PLAYING', sc.state === 'PLAYING', sc.state);

  // 计时累计（1s）：从进入 PLAYING 时刻起算
  const t0 = sc.elapsedMs;
  for (let i = 0; i < 10; i++) sc.update(0.1);
  const delta = sc.elapsedMs - t0;
  ok('PLAYING 中累计有效毫秒', delta > 900 && delta < 1150, 'delta=' + delta);

  // 模态打开时暂停计时（用桩模态管理器，避免依赖全局实例）
  const before = sc.elapsedMs;
  sc.sm = { modal: { isOpen: () => true, current: 'confirm', isGeneric: () => true,
    interactive: () => true, hitGeneric: () => null, resolveGeneric: () => {}, renderGeneric: () => {} } };
  for (let i = 0; i < 10; i++) sc.update(0.1);
  ok('模态打开时计时暂停', sc.elapsedMs === before, 'before=' + before + ' now=' + sc.elapsedMs);
  sc.sm = null;
}

// 超时态：不判负，仍可继续
{
  const sc = new EndgameScene();
  sc.enter({ screenWidth: 375, screenHeight: 667, level: 1 });
  sc.state = 'PLAYING';
  sc.elapsedMs = sc.limitMs + 500;
  ok('超时判定成立', sc.isOvertime());
  ok('超时剩余时间不为负', sc.remainingMs() === 0);
  const ctx = makeCtx();
  let err = null;
  try { sc.render(ctx, 375, 667); } catch (e) { err = e; }
  ok('超时态 render 无异常', !err, err && (err.stack || err.message));
  // 超时不应直接判负：state 仍为 PLAYING
  ok('超时不判负（状态仍为 PLAYING）', sc.state === 'PLAYING', sc.state);
}

// =====================================================================
section('C. S10 机会经济：锦囊提示 / 回马枪 / 技能');
// =====================================================================
{
  const sc = new EndgameScene();
  sc.enter({ screenWidth: 375, screenHeight: 667, level: 1 });
  sc.state = 'PLAYING';
  const h0 = sc.hints;
  sc.requestHint();
  ok('消耗 1 锦囊', sc.hints === h0 - 1, 'hints=' + sc.hints);
  ok('进入提示搜索状态', sc.state === 'HINT_SEARCHING', sc.state);
  // 求解完成（帧内分片）
  let guard = 0;
  while (sc.state === 'HINT_SEARCHING' && guard++ < 4000) sc.stepHintSearch();
  ok('提示搜索完成', sc.state === 'PLAYING', sc.state);
  ok('给出建议走法', !!sc.hintMove, 'hint=' + (sc.hintMove && sc.hintMove.fromRow + ',' + sc.hintMove.fromCol));
  ok('给出 SAN 文本', typeof sc.hintSan === 'string' && sc.hintSan.length > 0, 'san=' + sc.hintSan);
  ok('用提示则不再给 ⭐⭐⭐', sc.usedHelper === true);

  // 锦囊用尽 → 置灰并提示
  sc.hints = 0;
  const hBefore = sc.hints;
  sc.requestHint();
  ok('锦囊为 0 时不再消耗', sc.hints === hBefore);

  // 回马枪：撤 2 步回玩家决策点
  const sc2 = new EndgameScene();
  sc2.enter({ screenWidth: 375, screenHeight: 667, level: 3 });
  sc2.state = 'PLAYING';
  // 走一步白棋 + 一步黑棋（模拟）；走法动态取，避免绑定具体 FEN 坐标
  const whiteMove = findNonMateMove(sc2, ENDGAMES[2].fen);
  if (whiteMove) {
    sc2.commitMove(whiteMove, false);
    sc2.anim = null;
    sc2.onAnimEnd();                       // 走完白方动画 → 黑方应手
    let g2 = 0;
    while (sc2.state === 'BLACK_THINKING' && g2++ < 3000) sc2.stepBlackSearch();
    sc2.anim = null;
    if (sc2.state === 'ANIMATING') sc2.onAnimEnd();  // 走完黑方动画 → 回到玩家决策点
  }
  const histLen = sc2.game.history.length;
  const movesBefore = sc2.ownMoves;
  const undoBefore = sc2.undos;
  if (histLen >= 2) {
    sc2.doUndo();
    ok('回马枪消耗 1 次', sc2.undos === undoBefore - 1, 'undos=' + sc2.undos);
    ok('回马枪撤回到玩家决策点', sc2.game.turn === 'w', 'turn=' + sc2.game.turn);
    ok('回马枪回退己方走子数', sc2.ownMoves < movesBefore || movesBefore === 0,
      'before=' + movesBefore + ' now=' + sc2.ownMoves);
  } else {
    ok('回马枪前置条件（对局已产生历史）', false, 'history=' + histLen);
  }
}

// 技能：激活上限 / 扣库存 / 效果
{
  freshStorage();
  storage.addSkill('skill_hourglass', 1);
  storage.addSkill('skill_mirror', 1);
  const sc = new EndgameScene();
  sc.enter({ screenWidth: 375, screenHeight: 667, level: 1 });
  sc.state = 'PLAYING';

  const limitBefore = sc.limitMs;
  sc.activateSkill('skill_hourglass');
  ok('沙漏：时限 +20s', sc.limitMs === limitBefore + 20000, 'limit=' + sc.limitMs);
  ok('沙漏：库存扣减', !storage.loadEndgame().skills.some(s => s.id === 'skill_hourglass'));
  ok('技能激活计数 +1', sc.activatedCount === 1);

  const hintsBefore = sc.hints;
  sc.activateSkill('skill_mirror');
  ok('明镜：锦囊提示 +2', sc.hints === hintsBefore + 2, 'hints=' + sc.hints);

  // 每阵最多 2 个
  storage.addSkill('skill_freeze', 1);
  sc.activateSkill('skill_freeze');
  ok('每阵最多激活 2 个技能', sc.activatedCount === 2 && sc.skillUsable({ id: 'skill_freeze' }) === false,
    'count=' + sc.activatedCount);

  // 护身：moveCap +3
  freshStorage();
  storage.addSkill('skill_ward', 1);
  const sc2 = new EndgameScene();
  sc2.enter({ screenWidth: 375, screenHeight: 667, level: 1 });
  const capBefore = sc2.moveCap();
  sc2.activateSkill('skill_ward');
  ok('护身：moveCap +3', sc2.moveCap() === capBefore + 3, 'cap=' + sc2.moveCap());
  ok('护身：获得一次免失败', sc2.wardFreeFail === true);
}

// =====================================================================
section('D. S10 胜负判定与奖励写入');
// =====================================================================
{
  freshStorage();
  const sc = new EndgameScene();
  sc.enter({ screenWidth: 375, screenHeight: 667, level: 1 });
  sc.state = 'PLAYING';
  // EG-01 一步杀（动态求解，不硬编码坐标）
  const mate = findMateMove(sc, ENDGAMES[0].fen);
  ok('EG-01 存在一步将杀', !!mate, 'uci=' + findMateInOneUci(ENDGAMES[0].fen));
  if (mate) {
    sc.commitMove(mate, false);
    sc.anim = null;
    sc.onAnimEnd();
    ok('破阵后进入 RESULT', sc.state === 'RESULT', sc.state);
    const egd = storage.loadEndgame();
    ok('已解锁下一阵', egd.unlockedLevel === 2, 'unlocked=' + egd.unlockedLevel);
    ok('写入本阵成绩', !!egd.cleared['1'], JSON.stringify(egd.cleared['1']));
    ok('限时内破阵 rewarded=true', egd.cleared['1'] && egd.cleared['1'].rewarded === true);
    ok('收录妙招', egd.tipsCollected.indexOf(ENDGAMES[0].tipId) >= 0,
      'tipId=' + ENDGAMES[0].tipId + ' collected=' + JSON.stringify(egd.tipsCollected));
    ok('发放 1 个技能', egd.skills.length === 1, JSON.stringify(egd.skills));
    ok('技能稀有度符合权重（EG-01 为普通 100%）', egd.skills.length > 0 &&
      SKILLS.find(s => s.id === egd.skills[0].id).rarity === '普通', JSON.stringify(egd.skills));
  }
}

// 超时破阵：仅解锁，不赠技能
{
  freshStorage();
  const sc = new EndgameScene();
  sc.enter({ screenWidth: 375, screenHeight: 667, level: 1 });
  sc.state = 'PLAYING';
  sc.elapsedMs = sc.limitMs + 1000; // 已是超时态
  const mate = findMateMove(sc, ENDGAMES[0].fen);
  if (mate) {
    sc.commitMove(mate, false);
    sc.anim = null;
    sc.onAnimEnd();
    const egd = storage.loadEndgame();
    ok('超时破阵：仍解锁下一阵', egd.unlockedLevel === 2);
    ok('超时破阵： rewarded=false', egd.cleared['1'] && egd.cleared['1'].rewarded === false);
    ok('超时破阵：不赠技能', egd.skills.length === 0, JSON.stringify(egd.skills));
    ok('超时破阵：星级为 1', egd.cleared['1'] && egd.cleared['1'].stars === 1, JSON.stringify(egd.cleared['1']));
  }
}

// 超步数失败
{
  freshStorage();
  const sc = new EndgameScene();
  sc.enter({ screenWidth: 375, screenHeight: 667, level: 1 });
  sc.state = 'PLAYING';
  sc.ownMoves = sc.moveCap() + 1;
  ok('超步数判定为失败', sc.checkMoveCap() === true);
  sc.onFail({ result: 'draw', resultReason: 'movecap' });
  ok('超步数进入 FAIL', sc.state === 'FAIL', sc.state);
  const egd = storage.loadEndgame();
  ok('失败不解锁下一阵', egd.unlockedLevel === 1, 'unlocked=' + egd.unlockedLevel);
  ok('失败不写成绩', !egd.cleared['1']);
}

// 星级三档
{
  const sc = new EndgameScene();
  sc.enter({ screenWidth: 375, screenHeight: 667, level: 1 });
  sc.usedHelper = false;
  sc.ownMoves = 1;
  ok('⭐⭐⭐：限时内 + 步数=目标 + 没用辅助', sc.computeStars(false) === 3, 'stars=' + sc.computeStars(false));
  sc.usedHelper = true;
  ok('⭐⭐：用了辅助降为 2 星', sc.computeStars(false) === 2, 'stars=' + sc.computeStars(false));
  sc.usedHelper = false;
  sc.ownMoves = sc.moveCap() - 1;
  ok('⭐：步数逼近 moveCap 降为 1 星', sc.computeStars(false) === 1, 'stars=' + sc.computeStars(false));
  sc.ownMoves = 1;
  ok('⭐：超时态为 1 星', sc.computeStars(true) === 1);
}

// =====================================================================
section('E. 模态流程（L1 互斥 / 结算→揭晓→下一阵 / 失败卡）');
// =====================================================================
{
  const SceneManager = require('./src/scenes/manager');
  const sm = new SceneManager(null, 375, 667);
  sm.register('endgame', new EndgameScene());
  // GameContext.openModal 走全局实例 → 挂上含 sceneManager 的实例
  GameContext.set({ canvas: null, ctx: null, screenWidth: 375, screenHeight: 667, sceneManager: sm });
  const sc = sm.scenes.endgame;

  // 破阵 → 结算卡
  sc.enter({ screenWidth: 375, screenHeight: 667, level: 1, _sm: sm });
  sc.state = 'PLAYING';
  const mate = findMateMove(sc, ENDGAMES[0].fen);
  sc.commitMove(mate, false); sc.anim = null; sc.onAnimEnd();
  ok('破阵 → 结算卡', sc.state === 'RESULT' && sm.modal.current === 'result', 'state=' + sc.state + ' modal=' + sm.modal.current);

  // 结算卡「下一阵」→ 锦囊揭晓卡 → 收下 → 下一阵
  sc.render(makeCtx(), 375, 667);
  const nextBtn = sc.modalRegions.find(r => r.key === 'next');
  ok('结算卡含「下一阵」按钮', !!nextBtn);
  if (nextBtn) {
    sc.handleOverlayTap(nextBtn.rect.x + 2, nextBtn.rect.y + 2);
    ok('结算卡 → 锦囊揭晓卡', sm.modal.current === 'reveal', 'modal=' + sm.modal.current);
    sc.render(makeCtx(), 375, 667);
    const accBtn = sc.modalRegions.find(r => r.key === 'accept');
    ok('揭晓卡含「收下」按钮', !!accBtn);
    if (accBtn) {
      sc.handleOverlayTap(accBtn.rect.x + 2, accBtn.rect.y + 2);
      ok('收下后模态关闭', sm.modal.current === null, 'modal=' + sm.modal.current);
      ok('进入第 2 阵', sc.level === 2, 'level=' + sc.level);
      ok('新阵重置为 PREPARE', sc.state === 'PREPARE', sc.state);
      ok('新阵机会重置 3+1', sc.hints === 3 && sc.undos === 1);
    }
  }

  // 失败卡 → 看看教练提示 → 关闭后失败卡恢复（L1 互斥下的回挂）
  sc.enter({ screenWidth: 375, screenHeight: 667, level: 1, _sm: sm });
  sc.state = 'PLAYING';
  sc.ownMoves = sc.moveCap() + 1;
  sc.onFail({ result: 'draw', resultReason: 'movecap' });
  ok('失败卡打开', sm.modal.current === 'fail');
  sc.render(makeCtx(), 375, 667);
  const tipBtn = sc.modalRegions.find(r => r.key === 'tip');
  ok('失败卡含「看看教练提示」按钮', !!tipBtn);
  if (tipBtn) {
    sc.handleOverlayTap(tipBtn.rect.x + 2, tipBtn.rect.y + 2);
    ok('教练提示打开', sm.modal.current === 'confirm', 'modal=' + sm.modal.current);
    sm.modal.resolveGeneric('ok');
    ok('关闭提示后失败卡恢复', sm.modal.current === 'fail', 'modal=' + sm.modal.current);
  }

  // 技能抽屉（L1 互斥）
  sc.enter({ screenWidth: 375, screenHeight: 667, level: 1, _sm: sm });
  sc.state = 'PLAYING';
  storage.addSkill('skill_hourglass', 1);
  sc.onToolbar('skills');
  ok('技能抽屉打开', sm.modal.current === 'skillDrawer', 'modal=' + sm.modal.current);
  sc.render(makeCtx(), 375, 667);
  const skBtn = sc.modalRegions.find(r => r.key === 'sk:skill_hourglass');
  ok('技能卡渲染', !!skBtn);
  if (skBtn) {
    const limBefore = sc.limitMs;
    sc.handleOverlayTap(skBtn.rect.x + 2, skBtn.rect.y + 2);
    ok('点击技能卡即生效', sc.limitMs === limBefore + 20000, 'limit=' + sc.limitMs);
    ok('抽屉保持打开（可继续激活）', sm.modal.current === 'skillDrawer');
  }
  sc.onToolbar('more');
  ok('更多抽屉顶掉技能抽屉（L1 互斥）', sm.modal.current === 'more', 'modal=' + sm.modal.current);
}

// =====================================================================
section('F. 残局数据自洽（' + ENDGAMES.length + ' 阵 FEN 与步数）');
// =====================================================================
{
  // 数量断言一律从数据层派生：残局库已从 10 阵扩到 ENDGAMES.length 阵，
  // 妙招库从 12 条扩到 TIPS.length 条，写死旧值会随数据迭代持续误报。
  // 改为断言「不低于初始规模 + id 唯一」，既随数据增长自适应，又保留校验强度。
  ok('残局数据规模 ≥10 且 id 唯一',
    ENDGAMES.length >= 10 && new Set(ENDGAMES.map(e => e.id)).size === ENDGAMES.length,
    'n=' + ENDGAMES.length);
  ok('妙招库规模 ≥12 且 id 唯一',
    TIPS.length >= 12 && new Set(TIPS.map(t => t.id)).size === TIPS.length,
    'n=' + TIPS.length);
  ok('技能表 7 条', SKILLS.length === 7);
  let allOk = true;
  ENDGAMES.forEach((eg, i) => {
    if (eg.moveCap !== eg.targetMoves * 2 + 3) allOk = false;
    if (i > 0 && eg.difficulty < ENDGAMES[i - 1].difficulty) allOk = false;
  });
  ok('moveCap = 目标步数×2+3 且难度递进', allOk);
}

// =====================================================================
console.log('\n============================================================');
console.log('残局场景测试结果: ' + passed + ' 通过 / ' + failed + ' 失败');
if (failures.length) { console.log('失败项:'); failures.forEach(f => console.log('  - ' + f)); }
console.log('============================================================');
process.exit(failed === 0 ? 0 : 1);
