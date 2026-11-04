/**
 * S10 残局对局场景（残局闯关 · 独立场景，零改动 gameplay.js）
 *
 * 规格依据：
 *   V2_UX_SPEC.md §1.2（阵结构 / moveCap / 失败判定）/ §1.3（软计时）/ §1.4（机会 3+1）
 *                §1.5（星级与结算卡）/ §1.6（7 类技能 + 锦囊奖励）/ §1.7（数值表）
 *                §1.8（存档结构）/ §1.9（状态机）/ §2.2（提示分帧搜索）
 *                §3.3（模态清单）/ §4.7（残局文案）
 *   V2_VISUAL_SPEC.md §7.1（V-1 阵图）/ §7.2（V-2 关内 HUD）/ §7.3（V-3 结算与揭晓）
 *                     §7.4（V-4 技能 7 图标 + 稀有度双编码）/ §7.6（V-6 提示建议）
 *
 * 状态机（§1.9）：
 *   enter → PREPARE(3s 宽限) → PLAYING(TIMED | OVERTIME)
 *        ↘ ANIMATING（走子动画）→ BLACK_THINKING（黑方应手，计时暂停）
 *        ↘ HINT_SEARCHING（锦囊提示分帧搜索，计时暂停）
 *        ↘ PROMOTION（升变选择）→ RESULT / FAIL（模态）
 *
 * 计时（§1.3 软计时）：
 *   - 每阵独立 timeLimitSec；3 秒准备宽限（HUD「准备… 3→2→1」）。
 *   - update(dt) 内按 !paused 累加「有效毫秒」，不用墙钟差值（后台大跳变不会计入）。
 *   - 暂停：①后台（无帧即不累加）②任意模态/抽屉打开 ③黑方/提示搜索思考中 ④定风珠 30s。
 *   - ≤10s 临界：琥珀 + timerWarn 单次；归零 → 超时态（砖红静态条 + 从容文案），不判负、可继续。
 *
 * 胜负（§1.2 / §1.5）：
 *   - 破阵：玩家（白）将死黑王（result==='white_win' && resultReason==='checkmate'）。
 *   - 失败：己方走子数 > moveCap / 玩家被将杀 / 无法达成目标的和棋 / 主动放弃。
 *   - 星级（§1.5 权威）：
 *       ⭐⭐⭐ 用时 ≤ 限时 且 己方走子数 ≤ 目标步数 且 未使用任何提示/悔棋/技能
 *       ⭐⭐   用时 ≤ 限时（允许用提示/悔棋，或步数略超目标但未逼近 moveCap）
 *       ⭐    超时态达成，或步数逼近 moveCap
 *
 * 奖励（§1.6 / §1.7）：
 *   - 限时内破阵：unlockLevel(n+1) + setCleared(n,{stars,bestTimeMs,bestMoves,rewarded:true})
 *                 + collectTip(tipId) + 按 skillWeights{common,rare,epic} 抽 1 技能 addSkill
 *                 → 锦囊揭晓模态（妙招文案 + 技能名，音效 skillGet）。
 *   - 超时破阵：unlockLevel(n+1) + setCleared(n,{...rewarded:false})，仅解锁不赠技能（文案鼓励）。
 *
 * 机会（§1.4，每阵重置、不入库）：hints=3（锦囊提示）/ undos=1（回马枪，撤 2 步回玩家决策点）。
 * 技能（§1.6）：随身锦囊每阵最多激活 2 个；每个技能每阵至多 1 次；技能跨关累积、库存上限 8。
 */
'use strict';

const GameContext = require('../context');
const M = require('./manager');
const { theme, TouchGuard, util, createTap } = M;
const C = theme.colors, R = theme.radius, MO = theme.motion, SP = theme.spacing;
const TF = (k) => theme.font(k);
const rr = util.rr, inRect = util.inRect, drawBtn = util.drawButtonLocal, withShadow = util.withShadow;

const ChessGame = require('../core/game');
const { COLOR } = require('../core/constants');
const { createSearch, evaluate } = require('../core/ai');
const movegen = require('../core/movegen');
const boardRender = require('../render/board');
const piecesRender = require('../render/pieces');
const layoutMod = require('../core/layout');
const topbar = require('../render/topbar');
const storageMod = require('../core/storage');
const dataMod = require('../data/endgames');

const icons = (() => { try { return require('../render/icons'); } catch (e) { return null; } })();
function ico(ctx, name, x, y, size, color) {
  if (icons && typeof icons.drawIcon === 'function') {
    try { icons.drawIcon(ctx, name, x, y, size, color); return true; } catch (e) { /* noop */ }
  }
  return false;
}
const anim = (() => { try { return require('../core/anim'); } catch (e) { return null; } })();
function easeInOut(t) {
  if (anim && typeof anim.easeInOut === 'function') { try { return anim.easeInOut(t); } catch (e) { /* noop */ } }
  return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
}

const ENDGAMES = (dataMod && Array.isArray(dataMod.ENDGAMES)) ? dataMod.ENDGAMES : [];
const TIPS = (dataMod && Array.isArray(dataMod.TIPS)) ? dataMod.TIPS : [];
const SKILLS = (dataMod && Array.isArray(dataMod.SKILLS)) ? dataMod.SKILLS : [];

// ==================== 场景常量 ====================
const PREPARE_MS = 3000;          // 准备宽限 3s（§1.3）
const HINT_HOLD_MS = 3000;        // 提示面板停留 3s（§7.6 自动消失）
const HINT_FADE_MS = 200;         // 提示面板淡出 200ms
const HINT_MAX = 3;               // 每阵锦囊提示次数（§1.4）
const UNDO_MAX = 1;               // 每阵回马枪次数（§1.4）
const HINT_BUDGET_MS = 1200;      // 提示搜索全局预算（§2.2 残局 1200ms）
const HINT_SLICE_MS = 18;         // 分帧切片（§2.2）
const HINT_MIN_DEPTH = 2;         // 提示至少 2 层：depth1 的评估只看子力，无法识别将杀
const HINT_SOLVER_MS = 2200;      // 强制杀求解预算（帧内分片，不阻塞 UI；求解期间计时暂停）
const BLACK_BUDGET_MS = 500;      // 黑方应手搜索预算（求解器超时后的回落路径）
const BLACK_SLICE_MS = 16;
const BLACK_MAX_DEPTH = 2;        // 回落路径的搜索深度（残局子力少，2 层足够）
const BLACK_SOLVER_MS = 1200;     // 黑方「最顽抗防守」求解预算
const MAX_ACTIVATE_SKILLS = 2;    // 每阵最多激活 2 个技能（§1.6）
const FREEZE_MS = 30000;          // 定风珠暂停计时 30s（§1.6）
const WARN_MS = 10000;            // 临界提示阈值（§1.3）
const TIMER_WARN_MAX = 2;         // timerWarn 全程累计 ≤2 次（V2_VISUAL_SPEC §7.2）
const SKILL_SEARCH_MS = 300;      // 技能（探马/妙手）单次同步搜索预算
const MATE_INF = 999;             // 强制杀深度「无穷」标记

/**
 * 超时破阵时是否仍收录妙招文案。
 * V2_UX_SPEC §1.5 结算卡「通关（超时）」行明确写「妙招文案入图鉴（展示『知道了』），不赠技能」，
 * 故超时仍 collectTip（妙招是知识卡，不是奖励）；若需严格「仅解锁 + 成绩」，改本常量即可（仅一行）。
 */
const TIP_ON_OVERTIME = true;

// ==================== 工具 ====================
/** FEN → ChessGame（core/game.js 无 FEN 入口，此处自包含；坐标同 core/board.js） */
function loadFenGame(fen) {
  const parts = String(fen || '').trim().split(/\s+/);
  if (parts.length < 4) return null;
  const ranks = parts[0].split('/');
  if (ranks.length !== 8) return null;
  const grid = Array.from({ length: 8 }, () => Array(8).fill(null));
  for (let r = 0; r < 8; r++) {
    let c = 0;
    for (const ch of ranks[r]) {
      if (ch >= '1' && ch <= '8') { c += ch.charCodeAt(0) - 48; continue; }
      const type = ch.toLowerCase();
      if (c > 7) return null;
      grid[r][c] = { type: type, color: ch === type ? COLOR.BLACK : COLOR.WHITE };
      c++;
    }
    if (c !== 8) return null;
  }
  const game = new ChessGame();
  game.board.grid = grid;
  game.turn = parts[1] === 'b' ? COLOR.BLACK : COLOR.WHITE;
  const cst = parts[2] || '-';
  game.castling = {
    wk: cst.indexOf('K') >= 0, wq: cst.indexOf('Q') >= 0,
    bk: cst.indexOf('k') >= 0, bq: cst.indexOf('q') >= 0
  };
  game.enPassantTarget = (parts[3] && parts[3] !== '-')
    ? { row: 8 - parseInt(parts[3][1], 10), col: 'abcdefgh'.indexOf(parts[3][0]) }
    : null;
  game.halfMoveClock = parseInt(parts[4], 10) || 0;
  game.fullMoveNumber = parseInt(parts[5], 10) || 1;
  game.history = [];
  game.moveLog = [];
  game.uciLog = [];
  game.result = null;
  game.resultReason = '';
  game.startFen = fen;
  game.positionCounts = new Map();
  game.positionCounts.set(game.getPositionKey(), 1);
  return game;
}

/** 生成某走法的 SAN（不落子） */
function sanOfMove(game, board, move) {
  try {
    const piece = board.getPiece(move.fromRow, move.fromCol);
    let captured = null;
    if (move.isEnPassant) {
      const r = move.toRow + (piece && piece.color === COLOR.WHITE ? 1 : -1);
      captured = board.getPiece(r, move.toCol);
    } else {
      captured = board.getPiece(move.toRow, move.toCol);
    }
    return game.generateSAN(move, piece, captured);
  } catch (e) { return ''; }
}

function fmtClock(ms) {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(total / 60), s = total % 60;
  return (m < 10 ? '0' : '') + m + ':' + (s < 10 ? '0' : '') + s;
}

/** 星级绘制（★ 实心金 / ☆ 空心灰） */
function drawStars(ctx, x, y, filled, total, size, onColor, offColor) {
  for (let i = 0; i < total; i++) {
    icons.drawStar(ctx, x + i * (size * 0.95) + size / 2, y, size, i < filled, i < filled ? onColor : offColor);
  }
}

/** 稀有度 → 颜色（V-4 色 + 形状双编码：普通● / 稀有◆ / 史诗✦） */
function rarityStyle(rarity) {
  const r = String(rarity || '');
  if (r.indexOf('史诗') >= 0) return { color: C.accent, badge: '✦', shape: 'epic', name: '史诗' };
  if (r.indexOf('稀有') >= 0) return { color: C.info, badge: '◆', shape: 'rare', name: '稀有' };
  return { color: C.neutralBadge, badge: '●', shape: 'common', name: '普通' };
}

/** 按 skillWeights 抽 1 个技能 */
function drawSkillByWeight(weights) {
  const w = weights || { common: 0, rare: 0, epic: 0 };
  const pools = {
    common: SKILLS.filter(s => s.rarity === '普通'),
    rare: SKILLS.filter(s => s.rarity === '稀有'),
    epic: SKILLS.filter(s => s.rarity === '史诗')
  };
  const entries = [
    { w: Math.max(0, w.common || 0), pool: pools.common },
    { w: Math.max(0, w.rare || 0), pool: pools.rare },
    { w: Math.max(0, w.epic || 0), pool: pools.epic }
  ].filter(e => e.w > 0 && e.pool.length > 0);
  if (!entries.length) return null;
  const total = entries.reduce((s, e) => s + e.w, 0);
  let r = Math.random() * total;
  for (const e of entries) {
    r -= e.w;
    if (r <= 0) return e.pool[Math.floor(Math.random() * e.pool.length)];
  }
  return entries[0].pool[0];
}

/** 文本超宽截断 */
function ellipsis(ctx, text, maxWidth) {
  let t = String(text == null ? '' : text);
  if (!ctx || typeof ctx.measureText !== 'function') return t;
  if (ctx.measureText(t).width <= maxWidth) return t;
  while (t.length > 1 && ctx.measureText(t + '…').width > maxWidth) t = t.slice(0, -1);
  return t + '…';
}

// ==================== 强制杀求解器（提示用 · 帧内分片）====================
/**
 * 残局提示需要给出「能破阵的那一步」。ai.evaluate 只算子力，浅层 alpha-beta 看不见将杀，
 * 因此这里自包含一个「最短强制杀深度」求解器（attackerDepth / defenderWorst 递归 + 记忆化），
 * 用生成器实现帧内分片：每 64 个节点 yield 一次，update() 每帧 step() 一次，UI 不阻塞。
 * 算法与 test-endgame.js 的校验器同源（同一套「攻方最少步数 / 守方最顽抗」定义）。
 */
function matePosKey(board, turn, state, cap, tag) {
  let s = tag + turn + cap + '|';
  if (state.enPassantTarget) s += state.enPassantTarget.row + ',' + state.enPassantTarget.col; else s += '-';
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const p = board.getPiece(r, c);
      s += p ? (p.color + p.type) : '.';
    }
  }
  return s;
}

function mateApplyMove(board, state, move) {
  const piece = board.getPiece(move.fromRow, move.fromCol);
  const next = {
    castling: {
      wk: state.castling.wk, wq: state.castling.wq,
      bk: state.castling.bk, bq: state.castling.bq
    },
    enPassantTarget: null
  };
  if (move.isDoublePush && piece) {
    next.enPassantTarget = {
      row: piece.color === COLOR.WHITE ? move.toRow + 1 : move.toRow - 1,
      col: move.fromCol
    };
  }
  if (piece && piece.type === 'k') {
    if (piece.color === COLOR.WHITE) { next.castling.wk = false; next.castling.wq = false; }
    else { next.castling.bk = false; next.castling.bq = false; }
  }
  if (piece && piece.type === 'r') {
    if (move.fromRow === 7 && move.fromCol === 0) next.castling.wq = false;
    if (move.fromRow === 7 && move.fromCol === 7) next.castling.wk = false;
    if (move.fromRow === 0 && move.fromCol === 0) next.castling.bq = false;
    if (move.fromRow === 0 && move.fromCol === 7) next.castling.bk = false;
  }
  if (move.toRow === 0 && move.toCol === 0) next.castling.bq = false;
  if (move.toRow === 0 && move.toCol === 7) next.castling.bk = false;
  if (move.toRow === 7 && move.toCol === 0) next.castling.wq = false;
  if (move.toRow === 7 && move.toCol === 7) next.castling.wk = false;
  movegen.applyMoveToBoard(board, move);
  return next;
}

function mateIsMated(board, color, state) {
  return movegen.isInCheck(board, color) &&
    movegen.generateLegalMoves(board, color, state).length === 0;
}

/** 攻方最少还需几步能强制将死（INF = cap 内无解） */
function* mateAttackerDepth(board, state, attacker, cap, ctx) {
  const key = matePosKey(board, attacker, state, cap, 'A');
  if (ctx.memo.has(key)) return ctx.memo.get(key);
  if (ctx.nodes > ctx.limit) { ctx.aborted = true; return MATE_INF; }
  ctx.nodes++;
  if ((ctx.nodes & 63) === 0) yield;

  const defender = attacker === COLOR.WHITE ? COLOR.BLACK : COLOR.WHITE;
  const moves = movegen.generateLegalMoves(board, attacker, state);
  if (!moves.length) { ctx.memo.set(key, MATE_INF); return MATE_INF; }

  let best = MATE_INF;
  for (const move of moves) {
    const nb = board.clone();
    const ns = mateApplyMove(nb, state, move);
    let cand;
    if (mateIsMated(nb, defender, ns)) cand = 1;
    else if (cap <= 1) continue;
    else {
      const w = yield* mateDefenderWorst(nb, ns, attacker, cap - 1, ctx);
      if (ctx.aborted) return MATE_INF;
      cand = w >= MATE_INF ? MATE_INF : 1 + w;
    }
    if (cand < best) { best = cand; if (best === 1) break; }
  }
  ctx.memo.set(key, best);
  return best;
}

/** 守方最顽抗时，攻方还需要的步数（守方取对玩家最不利的一手） */
function* mateDefenderWorst(board, state, attacker, cap, ctx) {
  const key = matePosKey(board, attacker, state, cap, 'D');
  if (ctx.memo.has(key)) return ctx.memo.get(key);
  if (ctx.nodes > ctx.limit) { ctx.aborted = true; return MATE_INF; }
  ctx.nodes++;
  if ((ctx.nodes & 63) === 0) yield;

  const defender = attacker === COLOR.WHITE ? COLOR.BLACK : COLOR.WHITE;
  const moves = movegen.generateLegalMoves(board, defender, state);
  // 守方无着可走 = 逼和（和棋），不是白方取胜 → 视为「无法破阵」
  if (!moves.length) { ctx.memo.set(key, MATE_INF); return MATE_INF; }
  let worst = 0;
  for (const move of moves) {
    const nb = board.clone();
    const ns = mateApplyMove(nb, state, move);
    const v = yield* mateAttackerDepth(nb, ns, attacker, cap, ctx);
    if (ctx.aborted) return MATE_INF;
    if (v >= MATE_INF) { ctx.memo.set(key, MATE_INF); return MATE_INF; }
    if (v > worst) worst = v;
  }
  ctx.memo.set(key, worst);
  return worst;
}

/**
 * 找出攻方「能保证破阵」的首步（与 test-endgame.js 校验器同源同语义）。
 * 先用 attackerDepth 求出「白方最少还需几步能强制将死」，再挑出达成该深度的那一手。
 */
function* mateBestMove(board, state, attacker, cap, ctx) {
  const depth = yield* mateAttackerDepth(board, state, attacker, cap, ctx);
  if (ctx.aborted || depth >= MATE_INF || depth < 1) return null;
  const defender = attacker === COLOR.WHITE ? COLOR.BLACK : COLOR.WHITE;
  const moves = movegen.generateLegalMoves(board, attacker, state);
  for (const move of moves) {
    const nb = board.clone();
    const ns = mateApplyMove(nb, state, move);
    let score;
    if (mateIsMated(nb, defender, ns)) score = 1;
    else if (depth <= 1) continue;
    else {
      const w = yield* mateDefenderWorst(nb, ns, attacker, depth - 1, ctx);
      if (ctx.aborted) return null;
      score = w >= MATE_INF ? MATE_INF : 1 + w;
    }
    if (score === depth) return move;
  }
  return null;
}

/**
 * 黑方「最顽抗」的一手：选那手让白方后续强制杀深度最大（= 拖得最久）的棋。
 * 这是残局题的正确防守语义 —— 与 test-endgame.js 的 defenderWorst 同源，
 * 保证「N 步将杀」在黑方最优防守下依然成立（残局数据就是按此校验的）。
 * 若所有应手都让白方在窗口内无解（玩家已走错），退而求其次：按局面评估挑对白方最不利的一手。
 */
function* mateBestDefense(board, state, cap, ctx) {
  const moves = movegen.generateLegalMoves(board, COLOR.BLACK, state);
  let best = null, bestScore = -Infinity;
  for (const move of moves) {
    const nb = board.clone();
    const ns = mateApplyMove(nb, state, move);
    const d = yield* mateAttackerDepth(nb, ns, COLOR.WHITE, cap, ctx);
    if (ctx.aborted) return best;
    // score 越大对黑方越有利：能拖（有限深度）优先于拖出窗口（INF）
    const score = d >= MATE_INF ? -1000 - evaluate(nb) : d * 1000 + evaluate(nb);
    if (score > bestScore) { bestScore = score; best = move; }
  }
  return best;
}

/**
 * 帧内分片的强制杀求解器。
 * step() 在单帧时间预算内推进生成器（保证 UI ≥20fps），返回 { done, move, aborted }。
 * @param {string} mode 'attack' 求白方破阵首步 | 'defend' 求黑方最顽抗应手
 */
function createMateSolver(board, state, attacker, cap, budgetMs, mode) {
  const ctx = { memo: new Map(), nodes: 0, limit: 400000, aborted: false };
  const deadline = Date.now() + (budgetMs || HINT_SOLVER_MS);
  const gen = (mode === 'defend')
    ? mateBestDefense(board, state, cap, ctx)
    : mateBestMove(board, state, attacker, cap, ctx);
  let done = false, result = null, aborted = false;
  const SLICE_MS = 10; // 单帧最多推进 10ms 的搜索，保证 UI 流畅
  return {
    step() {
      if (done) return { done: true, move: result, aborted: aborted };
      const frameStart = Date.now();
      try {
        while (Date.now() - frameStart < SLICE_MS) {
          const t = gen.next();
          if (t.done) {
            done = true;
            result = t.value || null;
            aborted = ctx.aborted || Date.now() > deadline;
            if (aborted) result = null;
            return { done: true, move: result, aborted: aborted };
          }
          if (Date.now() > deadline) {
            done = true; aborted = true;
            return { done: true, move: null, aborted: true };
          }
        }
      } catch (e) {
        done = true; aborted = true;
        return { done: true, move: null, aborted: true };
      }
      return { done: false, move: null, aborted: false };
    }
  };
}

class EndgameScene {
  constructor() {
    this.guard = new TouchGuard();
    this.tap = createTap(); // 统一按压状态 + 90ms 防穿透（Phase 3·12）
    this.sm = null;
    this.screenWidth = 375;
    this.screenHeight = 667;

    this.level = 1;
    this.eg = null;                 // 当前阵数据
    this.game = null;

    // 计时
    this.state = 'PREPARE';
    this.prepareLeftMs = PREPARE_MS;
    this.limitMs = 0;               // 本阵限时（含沙漏加成）
    this.elapsedMs = 0;             // 已用有效毫秒
    this.freezeLeftMs = 0;          // 定风珠剩余暂停
    this.timerWarnCount = 0;
    this.warnedCritical = false;
    this.warnedOvertime = false;

    // 机会（每阵重置）
    this.hints = HINT_MAX;
    this.undos = UNDO_MAX;
    this.ownMoves = 0;              // 己方（玩家）走子数
    this.usedHelper = false;        // 是否用过提示/悔棋/技能（影响 ⭐⭐⭐）

    // 技能
    this.activatedCount = 0;        // 本阵已激活技能数（≤2）
    this.activatedIds = {};         // 本阵已激活的技能 id（每技能至多 1 次）
    this.wardEquipped = false;
    this.wardFreeFail = false;      // 护身：1 次免失败
    this.moveCapBonus = 0;          // 护身装备：moveCap +3
    this.wardExtraCap = 0;          // 护身免失败后额外放宽的步数

    // 交互
    this.selected = null;
    this.legalMoves = [];
    this.lastMove = null;
    this.pressed = null;
    this.pressedCell = null;
    this.uiRegions = [];            // HUD 命中区（顶栏/工具栏/机会条）
    this.modalRegions = [];         // 模态/抽屉命中区
    this.hintRegions = [];          // 建议面板命中区
    this.skillScrollY = 0;
    this.skillMaxScroll = 0;

    // 提示搜索
    this.hintPhase = 'idle';        // idle | solver | ai
    this.hintSolver = null;
    this.hintSearch = null;
    this.hintMove = null;
    this.hintSan = '';
    this.hintFailed = false;
    this.hintShownAt = -1;          // 提示面板显示时刻（this.timeMs），用于 3s 自动消失
    this.hintFade = 1;              // 提示面板淡出 alpha（1→0，200ms）

    // 探马高亮
    this.scoutMove = null;

    // 动画
    this.anim = null;
    this.landRing = null;
    this.promotionMoves = [];

    // 黑方应手
    this.blackSearch = null;
    this.blackSolver = null;

    this.timeMs = 0;
    this.boardX = 0; this.boardY = 0; this.cellSize = 40; this.boardSize = 320;
    this.contentLeft = 16; this.contentRight = 359; this.contentW = 343;
    this.resultPayload = null;
  }

  // ==================== 进入 / 退出 ====================
  enter(params = {}) {
    this.sm = params._sm || null;
    this.screenWidth = params.screenWidth || 375;
    this.screenHeight = params.screenHeight || 667;
    this.guard.reset();
    this.uiRegions = []; this.modalRegions = []; this.hintRegions = [];
    this.level = Math.max(1, Math.min(ENDGAMES.length || 1, parseInt(params.level, 10) || 1));
    this.eg = ENDGAMES[this.level - 1] || null;
    this.startLevel();
    this.layout();
    // 入场引言（§1.7 intro）
    if (this.eg && this.eg.intro) GameContext.showBanner(this.eg.intro, 'info');
  }

  exit() {
    this.uiRegions = []; this.modalRegions = []; this.hintRegions = [];
    this.hintSolver = null;
    this.hintSearch = null;
    this.blackSearch = null;
    this.blackSolver = null;
    this.game = null;
  }

  clearTouch() { this.guard.reset(); this.pressed = null; this.pressedCell = null; this.tap.clear(); }

  /** 起一局：重置局面 + 机会 + 计时 + 技能态（§1.4 每阵重置） */
  startLevel() {
    const eg = this.eg;
    this.game = eg ? loadFenGame(eg.fen) : new ChessGame();
    this.state = 'PREPARE';
    this.prepareLeftMs = PREPARE_MS;
    this.limitMs = ((eg && eg.timeLimitSec) || 45) * 1000;
    this.elapsedMs = 0;
    this.freezeLeftMs = 0;
    this.timerWarnCount = 0;
    this.warnedCritical = false;
    this.warnedOvertime = false;

    this.hints = HINT_MAX;
    this.undos = UNDO_MAX;
    this.ownMoves = 0;
    this.usedHelper = false;

    this.activatedCount = 0;
    this.activatedIds = {};
    this.wardEquipped = false;
    this.wardFreeFail = false;
    this.wardExtraCap = 0;

    this.selected = null;
    this.legalMoves = [];
    this.lastMove = null;
    this.anim = null;
    this.landRing = null;
    this.promotionMoves = [];
    this.hintPhase = 'idle';
    this.hintSolver = null;
    this.hintSearch = null;
    this.hintMove = null;
    this.hintSan = '';
    this.hintFailed = false;
    this.hintShownAt = -1;
    this.hintFade = 1;
    this.blackSearch = null;
    this.blackSolver = null;
    this.scoutMove = null;

    // 库存溢出转化的提示：下次入场生效（§1.8）
    try {
      const egd = storageMod && storageMod.loadEndgame ? storageMod.loadEndgame() : null;
      const pending = egd && egd.pendingHints > 0 ? egd.pendingHints : 0;
      if (pending > 0 && storageMod.consumePendingHints(pending)) this.hints += pending;
    } catch (e) { /* 存档不可用则不补提示 */ }

    // 尝试统计
    try { if (storageMod && storageMod.recordAttempt) storageMod.recordAttempt(); } catch (e) { /* noop */ }
  }

  // ==================== 布局 ====================
  /** 顶栏标题文案（layout 与 render 共用，保证两次度量完全一致） */
  _navTitleText() {
    return '第 ' + this.level + ' 阵' + (this.eg ? ' · ' + this.eg.name : '');
  }

  /** 右槽固定宽：计时最坏样本「88:88」+ 时钟图标，避免每帧宽度抖动 */
  _navClockW(ctx) {
    let w = 60;
    if (ctx && ctx.measureText) {
      try {
        ctx.save(); ctx.font = TF('caption');
        w = Math.ceil(ctx.measureText('88:88').width) + 26;
        ctx.restore();
      } catch (e) { /* noop */ }
    }
    return w;
  }

  /** 顶栏高度：320/大字号下标题可能下沉到第二行，必须提前算进布局 */
  _measureNavH(L, W, safeTop) {
    const ctx = (this.sm && this.sm.ctx) || null;
    if (!ctx || !ctx.measureText) return 44;
    try {
      const m = topbar.measureTopBar(ctx, {
        layout: L, W: W, y: (L ? L.navSafeTop : safeTop + 8),
        title: this._navTitleText(), fontKey: 'subtitle',
        rightWidth: this._navClockW(ctx)
      });
      return m.height;
    } catch (e) { return 44; }
  }

  layout() {
    const W = this.screenWidth, H = this.screenHeight;
    let L = null;
    try { L = layoutMod && layoutMod.get ? layoutMod.get() : null; } catch (e) { L = null; }
    const safeTop = L ? L.safe.top : 20;
    const safeBottom = L ? L.safe.bottom : 20;
    const contentLeft = L ? L.contentLeft : 16;
    const contentRight = L ? L.contentRight : W - 16;
    const contentW = Math.max(0, contentRight - contentLeft);
    const contentBottom = H - safeBottom - 16;

    this.safeTop = safeTop; this.safeBottom = safeBottom;
    this.contentLeft = contentLeft; this.contentRight = contentRight; this.contentW = contentW;

    const navH = this._measureNavH(L, W, safeTop);
    this.nav = { x: contentLeft, y: (L ? L.navSafeTop : safeTop + 8), w: contentW, h: navH };
    this.targetRow = { x: contentLeft, y: this.nav.y + navH + 6, w: contentW, h: 18 };
    this.timerBar = { x: contentLeft, y: this.targetRow.y + SP.xl, w: contentW, h: 6 };

    // 底部三行：机会条 h32 + SAN 行 h20 + 工具栏 h58。
    // Phase 2·6：取消建议面板的常驻 52pt 预留 —— 建议面板改为「按需浮层」（覆盖棋盘下沿），
    // 无建议时不占位，让出的纵向空间全部给棋盘。
    const toolbarH = 58, sanH = SP.xl, oppH = SP.xxxl;
    const bottomTop = contentBottom - (toolbarH + sanH + oppH);
    this.oppRow = { x: contentLeft, y: bottomTop, w: contentW, h: oppH };
    this.sanRow = { x: contentLeft, y: this.oppRow.y + oppH, w: contentW, h: sanH };
    this.toolbar = { x: 0, y: this.sanRow.y + sanH, w: W, h: toolbarH };
    // 建议浮层高度（仅渲染时使用，不参与布局计算）
    this.hintFloatH = 52;

    const boardTop = this.timerBar.y + this.timerBar.h + 10;
    const availH = Math.max(60, this.oppRow.y - SP.sm - boardTop);
    // 棋盘最大宽：左右各留 24pt 呼吸（英雄棋盘比正文栏 gutter 略宽，放大后仍居中）。
    // 横屏受 availH 自然收敛，居中不溢出；平板（isTablet/scale≈1.12）抬高单元格上限让棋盘更饱满。
    const cellCap = (L && L.isTablet) ? Math.round(52 * (L.scale || 1)) : 52;
    let cell = Math.floor(Math.min(W - SP.xxl, availH) / 8);
    cell = Math.max(28, Math.min(cell, cellCap));
    this.cellSize = cell;
    this.boardSize = cell * 8;
    this.boardX = Math.floor((W - this.boardSize) / 2);
    this.boardY = boardTop + Math.max(0, Math.floor((availH - this.boardSize) / 2));
  }

  // ==================== 查询 ====================
  isOvertime() { return this.elapsedMs > this.limitMs; }
  remainingMs() { return Math.max(0, this.limitMs - this.elapsedMs); }
  /** 本阵有效步数上限（含护身装备 +3 与免失败放宽） */
  moveCap() { return ((this.eg && this.eg.moveCap) || 5) + this.moveCapBonus + this.wardExtraCap; }
  targetMoves() { return (this.eg && this.eg.targetMoves) || 1; }
  isPlayerTurn() { return !!(this.game && this.game.turn === COLOR.WHITE); }
  modalOpen() { return !!(this.sm && this.sm.modal && this.sm.modal.isOpen()); }
  /** 计时是否暂停（§1.3） */
  isPaused() {
    if (this.state === 'PREPARE') return true;
    if (this.modalOpen()) return true;
    if (this.state === 'HINT_SEARCHING' || this.state === 'BLACK_THINKING') return true;
    if (this.freezeLeftMs > 0) return true;
    return false;
  }

  // ==================== 更新 ====================
  update(dt) {
    const dtMs = dt * 1000;
    this.timeMs += dtMs;
    if (this.landRing) { this.landRing.t += dt; if (this.landRing.t >= this.landRing.dur) this.landRing = null; }

    // 准备宽限（§1.3）
    if (this.state === 'PREPARE') {
      this.prepareLeftMs -= dtMs;
      if (this.prepareLeftMs <= 0) { this.prepareLeftMs = 0; this.state = 'PLAYING'; }
    }

    // 提示面板自动消失（§7.6）：停留 3s 后 200ms 淡出，结束即收起
    if (this.hintShownAt >= 0 && (this.hintMove || this.hintFailed)) {
      const held = this.timeMs - this.hintShownAt;
      if (held >= HINT_HOLD_MS + HINT_FADE_MS) {
        this.dismissHint();
      } else if (held > HINT_HOLD_MS) {
        this.hintFade = Math.max(0, 1 - (held - HINT_HOLD_MS) / HINT_FADE_MS);
      }
    }

    // 定风珠：暂停计时 30s
    if (this.freezeLeftMs > 0) {
      this.freezeLeftMs -= dtMs;
      if (this.freezeLeftMs < 0) this.freezeLeftMs = 0;
    }

    // 有效毫秒累加（软计时；后台无帧即不累加）
    if ((this.state === 'PLAYING' || this.state === 'ANIMATING') && !this.isPaused()) {
      this.elapsedMs += dtMs;
      if (!this.warnedCritical && !this.isOvertime() && this.remainingMs() <= WARN_MS) {
        this.warnedCritical = true;
        this.emitTimerWarn();
      }
      if (!this.warnedOvertime && this.isOvertime()) {
        this.warnedOvertime = true;
        this.emitTimerWarn();
      }
    }

    if (this.state === 'ANIMATING') {
      if (this.anim) {
        this.anim.t += dt;
        if (this.anim.t >= this.anim.dur) this.onAnimEnd();
      } else this.onAnimEnd();
    } else if (this.state === 'HINT_SEARCHING') {
      this.stepHintSearch();
    } else if (this.state === 'BLACK_THINKING') {
      this.stepBlackSearch();
    }
  }

  emitTimerWarn() {
    if (this.timerWarnCount >= TIMER_WARN_MAX) return;
    this.timerWarnCount++;
    GameContext.emit('timerWarn', { enabled: true });
  }

  // ==================== 渲染 ====================
  render(ctx, W, H) {
    if (this.screenWidth !== W || this.screenHeight !== H) {
      this.screenWidth = W; this.screenHeight = H; this.layout();
    }
    ctx.fillStyle = C.bgBase; ctx.fillRect(0, 0, W, H);
    this.uiRegions = []; this.modalRegions = []; this.hintRegions = [];
    const settings = GameContext.getSettings();
    const reduce = !!settings.reduceMotion;

    this.renderTopNav(ctx, W);
    this.renderTargetRow(ctx, W);
    this.renderTimerBar(ctx, W);
    this.renderBoard(ctx, settings, reduce);
    this.renderOppRow(ctx, W);
    this.renderSAN(ctx, W);
    this.renderToolbar(ctx, W, H);
    this.renderHintPanel(ctx, W);

    // 场景专属模态（L1 互斥，由场景自绘）
    const mc = this.sm && this.sm.modal ? this.sm.modal.current : null;
    if (mc === 'result') this.renderResult(ctx, W, H);
    else if (mc === 'fail') this.renderFail(ctx, W, H);
    else if (mc === 'reveal') this.renderReveal(ctx, W, H);
    else if (mc === 'promotion') this.renderPromotion(ctx, W, H);
    else if (mc === 'skillDrawer') this.renderSkillDrawer(ctx, W, H);
    else if (mc === 'more') this.renderMoreDrawer(ctx, W, H);
    if (this.sm && this.sm.modal && this.sm.modal.isGeneric()) this.sm.modal.renderGeneric(ctx, W, H);
  }

  renderTopNav(ctx, W) {
    const nav = topbar.drawTopBar(ctx, {
      title: this._navTitleText(),
      fontKey: 'subtitle',
      y: this.nav.y,
      back: { key: 'back', label: '阵图', pressed: this.tap.isPressing('back', Date.now()) },
      rightWidth: this._navClockW(ctx),
      drawRight: (c, rect) => {
        let clockText, clockColor;
        if (this.state === 'PREPARE') {
          clockText = '准备 ' + Math.ceil(this.prepareLeftMs / 1000);
          clockColor = C.textSecondary;
        } else if (this.isOvertime()) {
          clockText = '已超时';
          clockColor = C.textSecondary;
        } else {
          clockText = fmtClock(this.remainingMs());
          clockColor = this.remainingMs() <= WARN_MS ? C.warning : C.textSecondary;
        }
        const cy = rect.y + rect.h / 2;
        c.font = TF('caption'); c.textAlign = 'right'; c.textBaseline = 'middle';
        const tw = c.measureText(clockText).width;
        c.fillStyle = clockColor;
        c.fillText(clockText, rect.x + rect.w, cy);
        ico(c, 'clock', rect.x + rect.w - tw - 10, cy, 15, clockColor);
      }
    });
    nav.regions.forEach(r => this.uiRegions.push(r));

    ctx.strokeStyle = C.accentLine; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(this.nav.x, this.nav.y + this.nav.h + 4); ctx.lineTo(this.nav.x + this.nav.w, this.nav.y + this.nav.h + 4); ctx.stroke();
  }

  renderTargetRow(ctx, W) {
    const row = this.targetRow;
    ctx.font = TF('caption'); ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    ctx.fillStyle = C.textSecondary;
    const target = '目标：' + this.targetMoves() + ' 步将杀';
    ctx.fillText(target, row.x, row.y + row.h / 2);
    // 目标进度小点
    const dotX = row.x + ctx.measureText(target).width + 10;
    for (let i = 0; i < this.targetMoves(); i++) {
      ctx.fillStyle = i < this.ownMoves ? C.accent : C.border;
      ctx.beginPath(); ctx.arc(dotX + i * 9, row.y + row.h / 2, 3, 0, Math.PI * 2); ctx.fill();
    }

    ctx.textAlign = 'right';
    ctx.fillStyle = C.textSecondary;
    ctx.fillText('第 ' + this.ownMoves + ' 手 / ' + this.moveCap() + ' 手', row.x + row.w, row.y + row.h / 2);
  }

  renderTimerBar(ctx, W) {
    const bar = this.timerBar;
    ctx.fillStyle = C.surface3;
    rr(ctx, bar.x, bar.y, bar.w, bar.h, bar.h / 2); ctx.fill();

    const ratio = this.limitMs > 0 ? Math.max(0, Math.min(1, this.remainingMs() / this.limitMs)) : 0;
    const overtime = this.isOvertime();

    if (overtime) {
      // 超时态：砖红满条（静态不闪；V2_VISUAL_SPEC §7.2 / D-6）
      ctx.fillStyle = C.danger;
      rr(ctx, bar.x, bar.y, bar.w, bar.h, bar.h / 2); ctx.fill();
    } else if (ratio > 0) {
      const g = ctx.createLinearGradient(bar.x, 0, bar.x + bar.w, 0);
      g.addColorStop(0, C.accent);
      g.addColorStop(1, C.accentSoft);
      ctx.fillStyle = this.remainingMs() <= WARN_MS ? C.warning : g;
      rr(ctx, bar.x, bar.y, Math.max(bar.h, bar.w * ratio), bar.h, bar.h / 2); ctx.fill();
    }

    // 超时文案（从容、不施压）
    if (overtime) {
      ctx.fillStyle = C.textSecondary; ctx.font = TF('caption');
      ctx.textAlign = 'center'; ctx.textBaseline = 'top';
      ctx.fillText('已超时 · 仍可破阵，本阵通关暂不赠锦囊。', W / 2, bar.y + bar.h + 3);
    } else if (this.freezeLeftMs > 0) {
      ctx.fillStyle = C.info; ctx.font = TF('caption');
      ctx.textAlign = 'center'; ctx.textBaseline = 'top';
      ctx.fillText('定风珠：计时暂停 ' + Math.ceil(this.freezeLeftMs / 1000) + ' 秒', W / 2, bar.y + bar.h + 3);
    }
  }

  renderBoard(ctx, settings, reduce) {
    if (!this.game) return;
    const st = this.game.getStatus();
    const skipPiece = (this.state === 'ANIMATING' && this.anim && !this.anim.move.isCastling)
      ? { row: this.anim.move.toRow, col: this.anim.move.toCol } : null;

    boardRender.drawBoard(ctx, this.game.board, {
      x: this.boardX, y: this.boardY, cellSize: this.cellSize,
      selected: this.selected,
      legalMoves: settings.showLegalMoves ? this.legalMoves : [],
      lastMove: this.lastMove,
      checkPos: st.inCheck ? this.game.board.findKing(this.game.turn) : null,
      flip: false,
      showCoordinates: !!settings.showCoordinates,
      time: this.timeMs,
      reduceMotion: reduce,
      skipPiece: skipPiece
    });

    // 走子动画（直线插值，无弹跳）
    if (this.state === 'ANIMATING' && this.anim && !this.anim.move.isCastling) {
      const t = this.anim.dur > 0 ? easeInOut(Math.min(1, this.anim.t / this.anim.dur)) : 1;
      const from = this.cellToScreen(this.anim.move.fromRow, this.anim.move.fromCol);
      const to = this.cellToScreen(this.anim.move.toRow, this.anim.move.toCol);
      const px = from.x + (to.x - from.x) * t, py = from.y + (to.y - from.y) * t;
      piecesRender.drawPieceWithShadow(ctx, this.anim.pieceType, this.anim.pieceColor, px, py, this.cellSize);
    }
    if (this.landRing) {
      const p = this.cellToScreen(this.landRing.row, this.landRing.col);
      const k = this.landRing.dur > 0 ? Math.min(1, this.landRing.t / this.landRing.dur) : 1;
      ctx.save(); ctx.globalAlpha = 0.6 * (1 - k);
      ctx.strokeStyle = C.accent; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(p.x, p.y, this.cellSize * (0.34 + 0.16 * k), 0, Math.PI * 2); ctx.stroke();
      ctx.restore();
    }
    // 落子前目标预览
    if (this.pressedCell && this.selected) {
      const p = this.cellToScreen(this.pressedCell.row, this.pressedCell.col);
      const piece = this.game.board.getPiece(this.selected.row, this.selected.col);
      if (piece) {
        ctx.save(); ctx.globalAlpha = 0.5;
        piecesRender.drawPieceWithShadow(ctx, piece.type, piece.color, p.x, p.y, this.cellSize);
        ctx.restore();
      }
    }

    // 提示建议高亮（V-6：起点金环 + 终点 info 蓝点 + 虚线箭头）
    if (this.hintMove) this.renderHintOverlay(ctx);
    // 探马：最佳首步高亮（金环 + 金点）
    if (this.scoutMove) this.renderScoutOverlay(ctx);
    // 搜索中遮罩
    if (this.state === 'HINT_SEARCHING') this.renderSearching(ctx);
  }

  /** 「推演中…」静态文案（克制，不做旋转 loading） */
  renderSearching(ctx) {
    const cx = this.boardX + this.boardSize / 2;
    const cy = this.boardY + this.boardSize / 2;
    ctx.save();
    ctx.fillStyle = C.overlay; ctx.fillRect(this.boardX, this.boardY, this.boardSize, this.boardSize);
    ctx.fillStyle = C.textSecondary; ctx.font = TF('body');
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('推演中…', cx, cy);
    ctx.restore();
  }

  renderHintOverlay(ctx) {
    const from = this.cellToScreen(this.hintMove.fromRow, this.hintMove.fromCol);
    const to = this.cellToScreen(this.hintMove.toRow, this.hintMove.toCol);
    const cell = this.cellSize;
    // Phase 2·5：系统建议统一青玉虚线（青玉=建议，酒红=可吃，象牙=选中/可走，红=将军）
    const jade = C.hlHintJade;
    ctx.save();
    ctx.strokeStyle = jade; ctx.lineWidth = cell * 0.1;
    ctx.beginPath(); ctx.arc(from.x, from.y, cell * 0.42, 0, Math.PI * 2); ctx.stroke();
    ctx.fillStyle = jade;
    ctx.beginPath(); ctx.arc(to.x, to.y, cell * 0.16, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = jade; ctx.lineWidth = 1.5;
    if (ctx.setLineDash) ctx.setLineDash([4, 3]);
    ctx.beginPath(); ctx.moveTo(from.x, from.y); ctx.lineTo(to.x, to.y); ctx.stroke();
    if (ctx.setLineDash) ctx.setLineDash([]);
    const ang = Math.atan2(to.y - from.y, to.x - from.x);
    const ax = to.x - Math.cos(ang) * cell * 0.28, ay = to.y - Math.sin(ang) * cell * 0.28;
    ctx.fillStyle = jade;
    ctx.beginPath();
    ctx.moveTo(ax + Math.cos(ang) * 7, ay + Math.sin(ang) * 7);
    ctx.lineTo(ax + Math.cos(ang + 2.5) * 7, ay + Math.sin(ang + 2.5) * 7);
    ctx.lineTo(ax + Math.cos(ang - 2.5) * 7, ay + Math.sin(ang - 2.5) * 7);
    ctx.closePath(); ctx.fill();
    ctx.restore();
  }

  renderScoutOverlay(ctx) {
    const from = this.cellToScreen(this.scoutMove.fromRow, this.scoutMove.fromCol);
    const to = this.cellToScreen(this.scoutMove.toRow, this.scoutMove.toCol);
    const cell = this.cellSize;
    // 探马同属「系统建议」语义 → 青玉（虚线环，与提示箭头区分）
    const jade = C.hlHintJade;
    ctx.save();
    ctx.strokeStyle = jade; ctx.lineWidth = cell * 0.09;
    if (ctx.setLineDash) ctx.setLineDash([4, 3]);
    ctx.beginPath(); ctx.arc(from.x, from.y, cell * 0.42, 0, Math.PI * 2); ctx.stroke();
    ctx.beginPath(); ctx.arc(to.x, to.y, cell * 0.30, 0, Math.PI * 2); ctx.stroke();
    if (ctx.setLineDash) ctx.setLineDash([]);
    ctx.restore();
  }

  /**
   * 建议走法面板（V-6 / Phase 2·6）：按需浮层，非模态、不占常驻布局。
   * 只在 point「锦囊提示」返回建议（或建议降级）时浮出，贴在机会条上沿、
   * 覆盖棋盘下沿；点「采纳一步 / 忽略 / 知道了」或走子后即收，平时棋盘可用全部纵向空间。
   */
  renderHintPanel(ctx, W) {
    if (!this.hintMove && !this.hintFailed) return;
    if (this.hintFade <= 0) return;
    ctx.save();
    if (this.hintFade < 1) ctx.globalAlpha = this.hintFade;
    const ph = this.hintFloatH || 52;
    const pw = Math.min(this.contentW, 336);
    const px = (W - pw) / 2;
    // 浮层锚定在机会条上沿（覆盖棋盘下沿 8pt 间隙 + 部分棋盘），不参与任何布局计算
    const py = this.oppRow.y - 8 - ph;
    this.hintPanelRect = { x: px, y: py, w: pw, h: ph };
    // e2 阴影 + 1px 边线，明确「浮在棋盘之上」的层级
    withShadow(ctx, theme.elevation.e2, () => { ctx.fillStyle = C.surface1; rr(ctx, px, py, pw, ph, R.btn); ctx.fill(); });
    ctx.strokeStyle = C.accentLine; ctx.lineWidth = 1;
    rr(ctx, px + 0.5, py + 0.5, pw - 1, ph - 1, R.btn); ctx.stroke();
    ctx.fillStyle = C.hlHintJade; rr(ctx, px, py + 6, 3, ph - 12, 2); ctx.fill();

    if (this.hintFailed) {
      // 降级文案（§2.2 第 6 步）+ 「知道了」收起
      ctx.fillStyle = C.textSecondary; ctx.font = TF('caption');
      ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
      ctx.fillText(ellipsis(ctx, '这一步有点难，先按你的想法走', pw - 90), px + 14, py + ph / 2);
      ctx.fillStyle = C.accent; ctx.textAlign = 'center';
      ctx.fillText('知道了', px + pw - 34, py + ph / 2);
      this.hintRegions.push({ key: 'hintIgnore', rect: { x: px + pw - 66, y: py + (ph - 44) / 2, w: 62, h: 44 } });
      ctx.restore();
      return;
    }

    ctx.fillStyle = C.textSecondary; ctx.font = TF('caption');
    ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    ctx.fillText('建议', px + 12, py + ph / 2);
    ctx.fillStyle = C.accent; ctx.font = TF('san');
    ctx.fillText(this.hintSan || '', px + 44, py + ph / 2);

    // P1-L4：按钮视觉/命中高 ≥44
    const bw = 92, bh = 44;
    const by = py + (ph - bh) / 2;
    drawBtn(ctx, px + pw - bw - 58, by, bw, bh, '采纳一步', 'secondary', { pressed: this.tap.isPressing('hintAdopt', Date.now()) });
    this.hintRegions.push({ key: 'hintAdopt', rect: { x: px + pw - bw - 58, y: by, w: bw, h: bh } });
    ctx.fillStyle = C.accent; ctx.font = TF('caption');
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('忽略', px + pw - 26, py + ph / 2);
    this.hintRegions.push({ key: 'hintIgnore', rect: { x: px + pw - 50, y: by, w: 48, h: bh } });
    ctx.restore();
  }

  renderOppRow(ctx, W) {
    const row = this.oppRow;
    const cy = row.y + row.h / 2;
    // 锦囊点（warning 琥珀实心 / 已用空心）
    ico(ctx, 'hint', row.x + 12, cy, 16, this.hints > 0 ? C.warning : C.disabledFg);
    ctx.fillStyle = this.hints > 0 ? C.textSecondary : C.disabledFg;
    ctx.font = TF('caption'); ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    ctx.fillText('锦囊提示', row.x + 26, cy);
    let dx = row.x + 26 + ctx.measureText('锦囊提示').width + 8;
    for (let i = 0; i < HINT_MAX; i++) {
      if (i < this.hints) { ctx.fillStyle = C.warning; ctx.beginPath(); ctx.arc(dx, cy, 5, 0, Math.PI * 2); ctx.fill(); }
      else { ctx.strokeStyle = C.border; ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(dx, cy, 5, 0, Math.PI * 2); ctx.stroke(); }
      dx += 13;
    }
    // 回马枪点（accent 金实心）
    const ux = dx + 10;
    ctx.fillStyle = C.textOnAccent; ctx.font = TF('bodyB');
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    icons.drawUndo(ctx, ux + 8, cy + 1, 18, C.textOnAccent);
    ctx.fillStyle = this.undos > 0 ? C.textSecondary : C.disabledFg;
    ctx.font = TF('caption'); ctx.textAlign = 'left';
    ctx.fillText('回马枪', ux + 20, cy);
    let rx = ux + 20 + ctx.measureText('回马枪').width + 8;
    for (let i = 0; i < UNDO_MAX; i++) {
      if (i < this.undos) { ctx.fillStyle = C.accent; ctx.beginPath(); ctx.arc(rx, cy, 5, 0, Math.PI * 2); ctx.fill(); }
      else { ctx.strokeStyle = C.border; ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(rx, cy, 5, 0, Math.PI * 2); ctx.stroke(); }
      rx += 13;
    }

    // 技能抽屉入口「锦囊 ▾」：视觉 88×30，命中区透明外扩到 44 高（所在行仅 32 高）
    const bw = 88, bh = 30;
    const bx = row.x + row.w - bw, by = cy - bh / 2;
    drawBtn(ctx, bx, by, bw, bh, '锦囊 ▾', 'secondary', { pressed: this.tap.isPressing('skills', Date.now()) });
    this.uiRegions.push({ key: 'skills', rect: { x: bx, y: cy - 16, w: bw, h: 44 } });
  }

  renderSAN(ctx, W) {
    const row = this.sanRow;
    ctx.fillStyle = C.textSecondary; ctx.font = TF('san');
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    const log = this.game ? this.game.moveLog.slice(-6).join('  ') : '';
    ctx.fillText(log || '白方先行', row.x + row.w / 2, row.y + row.h / 2);
  }

  renderToolbar(ctx, W, H) {
    const tb = this.toolbar;
    ctx.fillStyle = C.bgElev; ctx.fillRect(0, tb.y, W, tb.h);
    ctx.strokeStyle = C.border; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(0, tb.y + 0.5); ctx.lineTo(W, tb.y + 0.5); ctx.stroke();

    const items = [
      { key: 'undo', label: '回马枪', icon: 'undo' },
      { key: 'hint', label: '锦囊提示', icon: 'hint' },
      { key: 'skills', label: '锦囊', icon: 'academy' },
      { key: 'more', label: '更多', icon: 'more' }
    ];
    const cw = W / items.length;
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      const rx = i * cw;
      const disabled = (it.key === 'undo' && (this.undos <= 0 || !this.canUndo())) ||
                       (it.key === 'hint' && (this.hints <= 0 || !this.isPlayerTurn() || this.state !== 'PLAYING'));
      ctx.save();
      ctx.globalAlpha = disabled ? 0.35 : 1;
      util.drawTapHighlight(ctx, rx + 6, tb.y + 4, cw - 12, tb.h - 8, this.tap.isPressing('tb:' + it.key, Date.now()), R.sm);
      const col = disabled ? C.disabledFg : (this.tap.isPressing('tb:' + it.key, Date.now()) ? C.accent : C.textSecondary);
      ico(ctx, it.icon, rx + cw / 2, tb.y + 20, 22, col);
      ctx.fillStyle = col; ctx.font = TF('micro'); ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(it.label, rx + cw / 2, tb.y + 41);
      ctx.restore();
      this.uiRegions.push({ key: 'tb:' + it.key, rect: { x: rx, y: tb.y, w: cw, h: tb.h }, disabled: disabled });
    }
  }

  // ==================== 模态：结算 ====================
  renderResult(ctx, W, H) {
    const p = (this.sm && this.sm.modal && this.sm.modal.payload) || {};
    ctx.fillStyle = C.overlay; ctx.fillRect(0, 0, W, H);
    const dw = Math.min(W * 0.88, 340);
    // P1-L4：弹窗高 306 → 330，容纳「重打本阵」44 高按钮且底边落在弹窗内
    const dh = 330;
    const dx = (W - dw) / 2, dy = (H - dh) / 2 - 16;
    withShadow(ctx, theme.elevation.e2, () => { ctx.fillStyle = C.surface1; rr(ctx, dx, dy, dw, dh, R.modal); ctx.fill(); });
    ctx.strokeStyle = C.accentLine; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(dx + 16, dy + 1); ctx.lineTo(dx + dw - 16, dy + 1); ctx.stroke();

    const title = p.title || '漂亮，破阵！';
    const accent = p.tier === 'overtime' ? C.warning : C.success;
    ctx.fillStyle = accent; ctx.font = TF('h1');
    ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    ctx.fillText(ellipsis(ctx, title, dw - 32), W / 2, dy + 22);

    // 星级
    drawStars(ctx, W / 2 - (p.stars || 0) * 12, dy + 68, p.stars || 0, 3, 22, C.accent, C.border);

    // 副行：用时 / 步数
    ctx.fillStyle = C.textSecondary; ctx.font = TF('caption');
    ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    ctx.fillText('用时 ' + fmtClock(p.timeMs || 0) + ' · ' + (p.ownMoves || 0) + ' 手破阵', W / 2, dy + 104);

    // 妙招文案
    const tip = p.tip;
    if (tip) {
      ctx.fillStyle = C.surface2; rr(ctx, dx + 20, dy + 128, dw - 40, 62, R.sm); ctx.fill();
      ctx.fillStyle = C.textPrimary; ctx.font = TF('body');
      ctx.textAlign = 'left'; ctx.textBaseline = 'top';
      ctx.fillText('【' + (tip.tactic || '妙招') + '】', dx + 32, dy + 136);
      ctx.fillStyle = C.textSecondary; ctx.font = TF('caption');
      const lines = util.wrapLocal(ctx, tip.text || '', dw - 64);
      for (let i = 0; i < Math.min(2, lines.length); i++) ctx.fillText(lines[i], dx + 32, dy + 156 + i * 18);
    }

    // 奖励说明
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.font = TF('caption');
    if (p.tier === 'overtime') {
      ctx.fillStyle = C.warning;
      ctx.fillText('破阵成功，可惜超时，奖励飞了', W / 2, dy + 204);
    } else if (p.skill) {
      ctx.fillStyle = C.success; ctx.font = TF('body');
      const _skText = '附赠技能：' + p.skill.name + '（' + (p.skill.rarity || '') + '）';
      const _skW = ctx.measureText(_skText).width;
      const _skStart = W / 2 - _skW / 2;
      ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
      icons.drawSpark(ctx, _skStart - 12, dy + 204, 16, C.success);
      ctx.fillText(_skText, _skStart, dy + 204);
    }

    // 按钮：自弹窗底向上排布 —— 底 8 + 44（重打本阵）+ 8 + 46（主/次按钮行）
    const pad = 20, gap = 12, bh = 46;
    const by = dy + dh - 106;
    const bw = (dw - pad * 2 - gap) / 2;
    const primaryLabel = p.hasNext ? '下一阵' : '回到阵图';
    const primaryKey = p.hasNext ? 'next' : 'finish';
    drawBtn(ctx, dx + pad, by, bw, bh, primaryLabel, 'primary', { pressed: this.tap.isPressing(primaryKey, Date.now()) });
    this.modalRegions.push({ key: primaryKey, rect: { x: dx + pad, y: by, w: bw, h: bh } });
    drawBtn(ctx, dx + pad + bw + gap, by, bw, bh, '回阵图', 'secondary', { pressed: this.tap.isPressing('map', Date.now()) });
    this.modalRegions.push({ key: 'map', rect: { x: dx + pad + bw + gap, y: by, w: bw, h: bh } });

    // 第三行：重打本阵（视觉与命中均 44 高；底边 = 弹窗底 − 8）
    const againH = 44, againW = Math.min(200, dw - pad * 2);
    const againX = (W - againW) / 2, againY = dy + dh - 8 - againH;
    drawBtn(ctx, againX, againY, againW, againH, '重打本阵', 'secondary', { pressed: this.tap.isPressing('again', Date.now()) });
    this.modalRegions.push({ key: 'again', rect: { x: againX, y: againY, w: againW, h: againH } });
  }

  // ==================== 模态：失败 ====================
  renderFail(ctx, W, H) {
    const p = (this.sm && this.sm.modal && this.sm.modal.payload) || {};
    ctx.fillStyle = C.overlay; ctx.fillRect(0, 0, W, H);
    const dw = Math.min(W * 0.88, 340);
    // P1-L4：236 → 270，「返回阵图」升为 44 高按钮并落在弹窗内
    const dh = 270;
    const dx = (W - dw) / 2, dy = (H - dh) / 2 - 10;
    withShadow(ctx, theme.elevation.e2, () => { ctx.fillStyle = C.surface1; rr(ctx, dx, dy, dw, dh, R.modal); ctx.fill(); });
    ctx.strokeStyle = C.accentLine; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(dx + 16, dy + 1); ctx.lineTo(dx + dw - 16, dy + 1); ctx.stroke();

    // 失败标题用中性 info（禁 danger 红字，§7.3）
    ctx.fillStyle = C.info; ctx.font = TF('h2');
    ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    ctx.fillText('这一阵有点意思，再想想～', W / 2, dy + 24);

    ctx.fillStyle = C.textSecondary; ctx.font = TF('body');
    const sub = p.sub || '换个思路再来一次，这阵不急。';
    const lines = util.wrapLocal(ctx, sub, dw - 48);
    for (let i = 0; i < Math.min(3, lines.length); i++) {
      ctx.fillText(lines[i], W / 2, dy + 64 + i * 24);
    }

    const pad = 20, gap = 10, bh = 46;
    const bw = (dw - pad * 2 - gap) / 2;
    const by = dy + dh - 106;
    drawBtn(ctx, dx + pad, by, bw, bh, '再试一次', 'primary', { pressed: this.tap.isPressing('retry', Date.now()) });
    this.modalRegions.push({ key: 'retry', rect: { x: dx + pad, y: by, w: bw, h: bh } });
    drawBtn(ctx, dx + pad + bw + gap, by, bw, bh, '看看教练提示', 'secondary', { pressed: this.tap.isPressing('tip', Date.now()) });
    this.modalRegions.push({ key: 'tip', rect: { x: dx + pad + bw + gap, y: by, w: bw, h: bh } });

    // 「返回阵图」：44 高按钮，底边 = 弹窗底 − 8
    const mapH = 44, mapW = Math.min(200, dw - pad * 2);
    const mapX = (W - mapW) / 2, mapY = dy + dh - 8 - mapH;
    drawBtn(ctx, mapX, mapY, mapW, mapH, '返回阵图', 'secondary', { pressed: this.tap.isPressing('map', Date.now()) });
    this.modalRegions.push({ key: 'map', rect: { x: mapX, y: mapY, w: mapW, h: mapH } });
  }

  // ==================== 模态：锦囊揭晓 ====================
  renderReveal(ctx, W, H) {
    const p = (this.sm && this.sm.modal && this.sm.modal.payload) || {};
    ctx.fillStyle = C.overlay; ctx.fillRect(0, 0, W, H);
    const dw = Math.min(W * 0.88, 340);
    const dh = 310;
    const dx = (W - dw) / 2, dy = (H - dh) / 2 - 16;
    withShadow(ctx, theme.elevation.e2, () => { ctx.fillStyle = C.surface1; rr(ctx, dx, dy, dw, dh, R.modal); ctx.fill(); });
    ctx.strokeStyle = C.accentLine; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(dx + 16, dy + 1); ctx.lineTo(dx + dw - 16, dy + 1); ctx.stroke();

    ico(ctx, 'spark', W / 2, dy + 32, 22, C.accent);
    ctx.fillStyle = C.accent; ctx.font = TF('h2');
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(p.overtime ? '妙招已收录' : '叮！获得锦囊妙计', W / 2, dy + 60);

    const tip = p.tip;
    if (tip) {
      ctx.fillStyle = C.surface2; rr(ctx, dx + 20, dy + 86, dw - 40, 76, R.sm); ctx.fill();
      ctx.fillStyle = C.textPrimary; ctx.font = TF('subtitle');
      ctx.textAlign = 'left'; ctx.textBaseline = 'top';
      ctx.fillText('【' + (tip.tactic || '妙招') + '】', dx + 32, dy + 94);
      ctx.fillStyle = C.textSecondary; ctx.font = TF('body');
      const lines = util.wrapLocal(ctx, tip.text || '', dw - 64);
      for (let i = 0; i < Math.min(3, lines.length); i++) ctx.fillText(lines[i], dx + 32, dy + 118 + i * 22);
    }

    // 附赠技能卡（稀有度双编码）
    const sk = p.skill;
    if (sk) {
      const st = rarityStyle(sk.rarity);
      const cy = dy + 176;
      ctx.fillStyle = C.surface2; rr(ctx, dx + 20, cy, dw - 40, 54, R.sm); ctx.fill();
      ctx.strokeStyle = st.color; ctx.lineWidth = sk.rarity === '史诗' ? 2 : 1;
      rr(ctx, dx + 20.5, cy + 0.5, dw - 41, 53, R.sm); ctx.stroke();
      ico(ctx, this.skillIcon(sk.id), dx + 48, cy + 27, 26, st.color);
      ctx.fillStyle = C.textPrimary; ctx.font = TF('body');
      ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
      ctx.fillText(sk.name, dx + 68, cy + 20);
      ctx.fillStyle = C.textSecondary; ctx.font = TF('caption');
      const eff = util.wrapLocal(ctx, sk.effect || '', dw - 150);
      ctx.fillText(eff[0] || '', dx + 68, cy + 40);
      ctx.fillStyle = st.color; ctx.font = TF('micro');
      ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
      const _nameW = ctx.measureText(st.name).width;
      ctx.fillText(st.name, dx + dw - 34, cy + 27);
      const _fn = st.shape === 'epic' ? icons.drawSpark
                : st.shape === 'rare' ? function (c, x, y, s, col) { icons.drawBullet(c, x, y, s, 'diamond', col); }
                : function (c, x, y, s, col) { icons.drawBullet(c, x, y, s, 'disc', col); };
      _fn(ctx, dx + dw - 34 - _nameW - 8, cy + 27, 12, st.color);
    }

    const bw = 160, bh = 46;
    const bx = (W - bw) / 2, by = dy + dh - 20 - bh;
    drawBtn(ctx, bx, by, bw, bh, p.overtime ? '知道了' : '收下，继续闯', 'primary', { pressed: this.tap.isPressing('accept', Date.now()) });
    this.modalRegions.push({ key: 'accept', rect: { x: bx, y: by, w: bw, h: bh } });
  }

  // ==================== 模态：升变 ====================
  renderPromotion(ctx, W, H) {
    ctx.fillStyle = C.overlay; ctx.fillRect(0, 0, W, H);
    const dw = Math.min(W * 0.9, 340), dh = 148;
    const dx = (W - dw) / 2, dy = (H - dh) / 2;
    withShadow(ctx, theme.elevation.e2, () => { ctx.fillStyle = C.surface1; rr(ctx, dx, dy, dw, dh, R.modal); ctx.fill(); });
    ctx.strokeStyle = C.accentLine; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(dx + 16, dy + 1); ctx.lineTo(dx + dw - 16, dy + 1); ctx.stroke();
    ctx.fillStyle = C.textPrimary; ctx.font = TF('h2');
    ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    ctx.fillText('选择升变棋子', W / 2, dy + 16);

    const pieces = ['q', 'r', 'b', 'n'], size = 56, gap = 16;
    const totalW = pieces.length * size + (pieces.length - 1) * gap;
    const sx = (W - totalW) / 2, sy = dy + 56;
    for (let i = 0; i < pieces.length; i++) {
      const px = sx + i * (size + gap);
      const on = this.tap.isPressing('promo:' + pieces[i], Date.now());
      ctx.fillStyle = C.surface2; rr(ctx, px, sy, size, size, R.sm); ctx.fill();
      if (on) { ctx.strokeStyle = C.accent; ctx.lineWidth = 2; rr(ctx, px + 1, sy + 1, size - 2, size - 2, R.sm); ctx.stroke(); }
      piecesRender.drawPieceWithShadow(ctx, pieces[i], COLOR.WHITE, px + size / 2, sy + size / 2, size);
      this.modalRegions.push({ key: 'promo:' + pieces[i], rect: { x: px, y: sy, w: size, h: size } });
    }
  }

  // ==================== 抽屉：随身锦囊 ====================
  skillIcon(id) {
    return ({
      skill_hourglass: 'hourglass', skill_mirror: 'mirror', skill_undo: 'undo',
      skill_scout: 'scout', skill_freeze: 'freeze', skill_master: 'master', skill_ward: 'ward'
    })[id] || 'spark';
  }

  renderSkillDrawer(ctx, W, H) {
    ctx.fillStyle = C.overlay; ctx.fillRect(0, 0, W, H);
    // P2：底部抽屉预留 home indicator（L.safe.bottom）
    const _safeB = (layoutMod.get() && layoutMod.get().safe && typeof layoutMod.get().safe.bottom === 'number') ? layoutMod.get().safe.bottom : 20;
    const dh = Math.min(H - 80 - _safeB, 360);
    const dy = H - dh - _safeB;
    withShadow(ctx, theme.elevation.e2, () => { ctx.fillStyle = C.surface1; rr(ctx, 8, dy, W - 16, dh, R.modal); ctx.fill(); });
    ctx.fillStyle = C.surface3; rr(ctx, W / 2 - 20, dy + 8, 40, 4, 2); ctx.fill();

    ctx.fillStyle = C.textPrimary; ctx.font = TF('h2');
    ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    ctx.fillText('随身锦囊', 24, dy + 34);
    ctx.fillStyle = C.textSecondary; ctx.font = TF('caption');
    ctx.textAlign = 'right';
    // P2：右对齐标题左移到 W-72，给右侧 ✕ 留足间距，避免文字贴住关闭键
    ctx.fillText('本阵已激活 ' + this.activatedCount + '/' + MAX_ACTIVATE_SKILLS, W - 72, dy + 34);
    ctx.fillStyle = C.textSecondary; ctx.font = TF('subtitleB');
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    icons.drawClose(ctx, W - 30, dy + 34, 20, C.textSecondary);
    this.modalRegions.push({ key: 'closeSkills', rect: { x: W - 54, y: dy + 12, w: 44, h: 44 } });

    const inventory = this.getInventory();
    const listTop = dy + 58;
    const listH = dh - 58 - 16;

    if (!inventory.length) {
      ctx.fillStyle = C.disabledFg; ctx.font = TF('body');
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('还没有锦囊，先去破阵攒一个吧～', W / 2, listTop + 40);
      return;
    }

    ctx.save();
    ctx.beginPath(); ctx.rect(0, listTop, W, listH); ctx.clip();
    const cardW = 104, cardH = 120, gap = 12, cols = 3;
    const startX = (W - (cols * cardW + (cols - 1) * gap)) / 2;
    for (let i = 0; i < inventory.length; i++) {
      const entry = inventory[i];
      const sk = SKILLS.find(s => s.id === entry.id);
      if (!sk) continue;
      const col = i % cols, row = Math.floor(i / cols);
      const x = startX + col * (cardW + gap);
      const y = listTop + row * (cardH + gap) - this.skillScrollY;
      if (y + cardH < listTop - 10 || y > listTop + listH + 10) continue;
      this._renderSkillCard(ctx, sk, entry, x, y, cardW, cardH);
    }
    ctx.restore();

    const rows = Math.ceil(inventory.length / cols);
    this.skillMaxScroll = Math.max(0, rows * (cardH + gap) - listH + 8);
    if (this.skillScrollY > this.skillMaxScroll) this.skillScrollY = this.skillMaxScroll;
    if (this.skillScrollY < 0) this.skillScrollY = 0;
  }

  _renderSkillCard(ctx, sk, entry, x, y, w, h) {
    const st = rarityStyle(sk.rarity);
    const usable = this.skillUsable(sk);
    const pressed = this.tap.isPressing('sk:' + sk.id, Date.now());
    ctx.save();
    if (!usable) ctx.globalAlpha = 0.4;

    ctx.fillStyle = sk.rarity === '史诗' ? C.accentFade : C.surface2;
    rr(ctx, x, y, w, h, R.sm); ctx.fill();
    ctx.strokeStyle = st.color; ctx.lineWidth = sk.rarity === '史诗' ? 2 : 1;
    if (st.shape === 'rare') {
      ctx.beginPath();
      ctx.moveTo(x + 8, y); ctx.lineTo(x + w, y); ctx.lineTo(x + w, y + h - 8);
      ctx.lineTo(x + w - 8, y + h); ctx.lineTo(x, y + h); ctx.lineTo(x, y + 8);
      ctx.closePath(); ctx.stroke();
    } else if (st.shape === 'epic') {
      ctx.beginPath();
      const c = 8;
      ctx.moveTo(x + c, y); ctx.lineTo(x + w - c, y); ctx.lineTo(x + w, y + c);
      ctx.lineTo(x + w, y + h - c); ctx.lineTo(x + w - c, y + h); ctx.lineTo(x + c, y + h);
      ctx.lineTo(x, y + h - c); ctx.lineTo(x, y + c); ctx.closePath(); ctx.stroke();
    } else {
      rr(ctx, x + 0.5, y + 0.5, w - 1, h - 1, R.sm); ctx.stroke();
    }
    if (pressed) { ctx.fillStyle = C.accentFade; rr(ctx, x, y, w, h, R.sm); ctx.fill(); }

    ico(ctx, this.skillIcon(sk.id), x + w / 2, y + 34, 30, st.color);
    ctx.fillStyle = C.textPrimary; ctx.font = TF('caption');
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(sk.name, x + w / 2, y + 62);
    ctx.fillStyle = st.color; ctx.font = TF('micro');
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    const _nameW2 = ctx.measureText(st.name).width;
    const _gW = 12 + 6 + _nameW2;
    const _startX = x + w / 2 - _gW / 2;
    const _fn2 = st.shape === 'epic' ? icons.drawSpark
               : st.shape === 'rare' ? function (c, px, py, s, col) { icons.drawBullet(c, px, py, s, 'diamond', col); }
               : function (c, px, py, s, col) { icons.drawBullet(c, px, py, s, 'disc', col); };
    _fn2(ctx, _startX + 6, y + 78, 12, st.color);
    ctx.fillText(st.name, _startX + 18, y + 78);
    // 数量角标
    const cnt = '×' + entry.charges;
    ctx.font = TF('micro');
    const cw = ctx.measureText(cnt).width + 12;
    ctx.fillStyle = C.bgElev; rr(ctx, x + w - cw - 4, y + 4, cw, 18, R.pill); ctx.fill();
    ctx.fillStyle = C.accentSoft;
    ctx.fillText(cnt, x + w - cw / 2 - 4, y + 13);
    // 不可用原因
    const why = this.skillReason(sk);
    if (why) {
      ctx.fillStyle = C.disabledFg; ctx.font = TF('micro');
      ctx.fillText(why, x + w / 2, y + h - 16);
    }
    ctx.restore();

    this.modalRegions.push({ key: 'sk:' + sk.id, rect: { x, y, w, h }, disabled: !usable });
  }

  // ==================== 抽屉：更多 ====================
  renderMoreDrawer(ctx, W, H) {
    ctx.fillStyle = C.overlay; ctx.fillRect(0, 0, W, H);
    // P2：底部抽屉预留 home indicator（L.safe.bottom）
    const _safeB = (layoutMod.get() && layoutMod.get().safe && typeof layoutMod.get().safe.bottom === 'number') ? layoutMod.get().safe.bottom : 20;
    const sh = 220, sy = H - sh - _safeB;
    withShadow(ctx, theme.elevation.e2, () => { ctx.fillStyle = C.surface1; rr(ctx, 8, sy, W - 16, sh, R.modal); ctx.fill(); });
    ctx.fillStyle = C.textPrimary; ctx.font = TF('h2');
    ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    ctx.fillText('更多操作', 24, sy + 26);
    ctx.fillStyle = C.textSecondary; ctx.font = TF('subtitleB');
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    icons.drawClose(ctx, W - 30, sy + 26, 20, C.textSecondary);
    this.modalRegions.push({ key: 'closeMore', rect: { x: W - 54, y: sy + 4, w: 44, h: 44 } });

    const items = [
      { key: 'hint2', label: '看教练提示' },
      { key: 'giveup', label: '放弃本阵', danger: true }
    ];
    const rowH = 44, gap = 6, rx = 24, rw = W - 48;
    let iy = sy + 58;
    for (const it of items) {
      ctx.fillStyle = it.danger ? 'rgba(217,106,106,0.10)' : C.surface2;
      rr(ctx, rx, iy, rw, rowH, R.sm); ctx.fill();
      ctx.fillStyle = it.danger ? C.danger : C.textPrimary; ctx.font = TF('body');
      ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
      ctx.fillText(it.label, rx + 14, iy + rowH / 2);
      if (this.tap.isPressing(it.key, Date.now())) { ctx.fillStyle = 'rgba(0,0,0,0.08)'; rr(ctx, rx, iy, rw, rowH, R.sm); ctx.fill(); }
      this.modalRegions.push({ key: it.key, rect: { x: rx, y: iy, w: rw, h: rowH } });
      iy += rowH + gap;
    }
  }

  // ==================== 坐标换算 ====================
  cellToScreen(row, col) {
    return {
      x: this.boardX + col * this.cellSize + this.cellSize / 2,
      y: this.boardY + row * this.cellSize + this.cellSize / 2
    };
  }
  screenToBoard(x, y) {
    const tol = 12;
    const bx = x - this.boardX, by = y - this.boardY;
    const bs = this.boardSize;
    if (bx < -tol || by < -tol || bx > bs + tol || by > bs + tol) return null;
    const cx = Math.max(0, Math.min(bs - 0.001, bx));
    const cy = Math.max(0, Math.min(bs - 0.001, by));
    return { row: Math.floor(cy / this.cellSize), col: Math.floor(cx / this.cellSize) };
  }

  // ==================== 输入 ====================
  onTouchStart(x, y) {
    this.guard.down(x, y);
    this.pressed = this._hitAny(x, y);
    this.pressedCell = null;
    if (this.pressed) this.tap.press(this.pressed, Date.now());
    if (this.state === 'PLAYING' && this.selected && !this.modalOpen()) {
      const pos = this.screenToBoard(x, y);
      if (pos && this.legalMoves.some(m => m.toRow === pos.row && m.toCol === pos.col)) this.pressedCell = pos;
    }
  }

  onTouchMove(x, y) {
    const m = this.guard.move(x, y);
    if (m.moved) { if (this.pressed) this.tap.clear(this.pressed); this.pressed = null; this.pressedCell = null; }
    if (this.skillDrawerOpen() && m.stepY) {
      this.skillScrollY = Math.max(0, Math.min(this.skillMaxScroll, this.skillScrollY - m.stepY));
    }
  }

  onTouchEnd(x, y) {
    const e = this.guard.end(x, y);
    this.pressed = null; this.pressedCell = null;
    if (!e.valid) return;

    // 通用模态优先（confirm / storageError / resume）
    if (this.sm && this.sm.modal && this.sm.modal.isOpen() && this.sm.modal.isGeneric()) {
      if (!this.sm.modal.interactive()) return; // 模态 200ms 防穿透（modal 独立机制，非按钮防穿透）
      const act = this.sm.modal.hitGeneric(x, y);
      if (act) this.sm.modal.resolveGeneric(act);
      return;
    }

    // 场景模态 / 抽屉（L1 互斥，由 ModalManager 统一管理）
    if (this.modalOpen()) {
      if (this.sm.modal.isGeneric()) {
        if (!this.sm.modal.interactive()) return;
        const act = this.sm.modal.hitGeneric(x, y);
        if (act) this.sm.modal.resolveGeneric(act);
        return;
      }
      if (!this.sm.modal.interactive()) return;
      if (!this.tap.guard(Date.now(), 'modal')) return; // 90ms 防穿透（Phase 3·12 统一）
      GameContext.emit('tap', {});
      this.handleOverlayTap(x, y);
      return;
    }

    if (!this.tap.guard(Date.now())) return; // 90ms 全局防穿透（Phase 3·12 统一）
    GameContext.emit('tap', {});

    // 建议面板（浮层，不拦截棋盘）
    for (const r of this.hintRegions) {
      if (!inRect(x, y, r.rect)) continue;
      if (!this.tap.guard(Date.now(), 'hint:' + r.key)) return;
      if (r.key === 'hintAdopt') this.adoptHint();
      else this.dismissHint();
      return;
    }

    // 顶栏返回
    for (const r of this.uiRegions) {
      if (r.key !== 'back' || !inRect(x, y, r.rect)) continue;
      if (!this.tap.guard(Date.now(), 'back')) return;
      this.requestLeave();
      return;
    }
    // 工具栏
    for (const r of this.uiRegions) {
      if (r.key.indexOf('tb:') !== 0 || !inRect(x, y, r.rect)) continue;
      // 禁用态不再静默 return：交给 onToolbar 内的 banner 反馈（§7.2 禁用 toast）
      if (!this.tap.guard(Date.now(), 'tb:' + r.key)) return;
      this.onToolbar(r.key.slice(3));
      return;
    }
    // 机会条技能入口
    for (const r of this.uiRegions) {
      if (r.key !== 'skills' || !inRect(x, y, r.rect)) continue;
      if (!this.tap.guard(Date.now(), 'skills')) return;
      this.toggleSkillDrawer();
      return;
    }
    this.handleBoardTouch(x, y);
  }

  _hitAny(x, y) {
    // 模态/抽屉打开时只响应浮层自身（底层 HUD 不响应）
    if (this.modalOpen()) {
      for (const r of this.modalRegions) { if (!r.disabled && inRect(x, y, r.rect)) return r.key; }
      return null;
    }
    for (const r of this.hintRegions) { if (inRect(x, y, r.rect)) return r.key; }
    for (const r of this.uiRegions) { if (!r.disabled && inRect(x, y, r.rect)) return r.key; }
    return null;
  }

  handleOverlayTap(x, y) {
    const mc = this.sm && this.sm.modal ? this.sm.modal.current : null;
    if (mc === 'result') {
      for (const r of this.modalRegions) {
        if (!inRect(x, y, r.rect)) continue;
        if (r.key === 'next') { this.onResultNext(); return; }
        if (r.key === 'finish') { this.onResultFinish(); return; }
        if (r.key === 'again') { this.onResultAgain(); return; }
        if (r.key === 'map') { this.backToMap(); return; }
      }
      return;
    }
    if (mc === 'fail') {
      for (const r of this.modalRegions) {
        if (!inRect(x, y, r.rect)) continue;
        if (r.key === 'retry') { this.onRetry(); return; }
        if (r.key === 'tip') { this.showCoachHints(); return; }
        if (r.key === 'map') { this.backToMap(); return; }
      }
      return;
    }
    if (mc === 'reveal') {
      for (const r of this.modalRegions) {
        if (!inRect(x, y, r.rect)) continue;
        if (r.key === 'accept') { this.onRevealAccept(); return; }
      }
      return;
    }
    if (mc === 'promotion') {
      for (const r of this.modalRegions) {
        if (!inRect(x, y, r.rect)) continue;
        if (r.key.indexOf('promo:') === 0) {
          const pt = r.key.slice(6);
          const mv = this.promotionMoves.find(m => m.promotion === pt);
          GameContext.closeModal();
          this.promotionMoves = [];
          this.state = 'PLAYING';
          if (mv) this.commitMove(mv, false);
          return;
        }
      }
      GameContext.closeModal();
      this.promotionMoves = [];
      this.state = 'PLAYING';
      return;
    }
    if (mc === 'skillDrawer') {
      for (const r of this.modalRegions) {
        if (!inRect(x, y, r.rect)) continue;
        if (r.key === 'closeSkills') { GameContext.closeModal(); return; }
        if (r.key.indexOf('sk:') === 0) { this.activateSkill(r.key.slice(3)); return; }
      }
      GameContext.closeModal(); // 点空白关闭
      return;
    }
    if (mc === 'more') {
      for (const r of this.modalRegions) {
        if (!inRect(x, y, r.rect)) continue;
        if (r.key === 'closeMore') { GameContext.closeModal(); return; }
        if (r.key === 'hint2') { GameContext.closeModal(); this.showCoachHints(); return; }
        if (r.key === 'giveup') { GameContext.closeModal(); this.confirmGiveUp(); return; }
      }
      GameContext.closeModal();
      return;
    }
  }

  // ==================== 工具栏动作 ====================
  onToolbar(key) {
    if (key === 'undo') this.doUndo();
    else if (key === 'hint') this.requestHint();
    else if (key === 'skills') this.toggleSkillDrawer();
    else if (key === 'more') GameContext.openModal('more', {});
  }

  toggleSkillDrawer() {
    if (this.skillDrawerOpen()) { GameContext.closeModal(); return; }
    this.skillScrollY = 0;
    GameContext.openModal('skillDrawer', {});
  }

  /** 技能抽屉是否打开（走 ModalManager 的 L1 互斥） */
  skillDrawerOpen() {
    return !!(this.sm && this.sm.modal && this.sm.modal.current === 'skillDrawer');
  }

  canUndo() {
    return !!(this.game && this.game.history.length > 0 &&
      (this.state === 'PLAYING' || this.state === 'SELECTED'));
  }

  /** 回马枪：撤 2 步回到玩家决策点（§1.4 / §1.9 E5） */
  doUndo() {
    if (this.undos <= 0) {
      GameContext.showBanner('回马枪用完啦，这一手得自己拿主意～', 'info');
      return;
    }
    if (!this.canUndo()) {
      GameContext.showBanner('还不到能悔棋的时候', 'info');
      return;
    }
    const before = this.game.history.length;
    // 撤「黑方应手 + 玩家上一手」= 2 步，回到玩家的决策点
    if (this.game.history.length >= 2) {
      this.game.undoMove();
      this.game.undoMove();
    } else if (this.game.history.length === 1) {
      this.game.undoMove();
    }
    if (this.game.history.length === before) return;
    this.undos--;
    this.usedHelper = true;
    const undone = before - this.game.history.length;
    this.ownMoves = Math.max(0, this.ownMoves - Math.ceil(undone / 2));
    this.selected = null; this.legalMoves = [];
    this.lastMove = null; this.anim = null; this.landRing = null;
    this.hintMove = null; this.hintSan = ''; this.hintFailed = false;
    this.state = 'PLAYING';
    GameContext.emit('undo', {});
    GameContext.showBanner('回马枪：回到上一个决策点', 'info');
  }

  /**
   * 锦囊提示：分帧搜索（§2.2）
   * ① 优先用「最短强制杀」求解器给出真正能破阵的那一步（浅层 alpha-beta 只算子力，看不见将杀）；
   * ② 求解器超时/无解 → 回落 ai.createSearch（min(难度,3)、预算 1200ms、切片 18ms）；
   * ③ 仍无结果 → 降级文案「这一步有点难，先按你的想法走」。
   */
  requestHint() {
    if (this.hints <= 0) {
      GameContext.showBanner('锦囊提示用完啦，靠自己试试～', 'info');
      return;
    }
    if (this.state !== 'PLAYING' || !this.isPlayerTurn()) {
      GameContext.showBanner('等黑方应完这一手再说', 'info');
      return;
    }
    this.hints--;
    this.usedHelper = true;
    this.hintFailed = false;
    this.hintMove = null;
    this.hintSan = '';
    const state = { castling: this.game.castling, enPassantTarget: this.game.enPassantTarget };
    // 剩余可用的白方步数：目标步数 − 已走手数（提示要给出「还能破阵」的那一步）
    const cap = Math.max(1, this.targetMoves() - this.ownMoves);
    this.hintSolver = createMateSolver(this.game.board, state, COLOR.WHITE, cap, HINT_SOLVER_MS);
    this.hintPhase = 'solver';
    this.state = 'HINT_SEARCHING';
  }

  stepHintSearch() {
    if (this.hintPhase === 'solver') {
      if (!this.hintSolver) { this.hintPhase = 'ai'; return; }
      const r = this.hintSolver.step();
      if (!r || !r.done) return;
      this.hintSolver = null;
      if (r.move) { this.applyHintMove(r.move); return; }
      // ① 无强制杀 → 回落 ai.createSearch
      const state = { castling: this.game.castling, enPassantTarget: this.game.enPassantTarget };
      const depth = Math.max(HINT_MIN_DEPTH, Math.min(3, (this.eg && this.eg.difficulty) || 1));
      this.hintSearch = createSearch(this.game.board, COLOR.WHITE, state, depth, HINT_BUDGET_MS, HINT_SLICE_MS);
      this.hintPhase = 'ai';
      return;
    }
    if (this.hintPhase === 'ai') {
      if (!this.hintSearch) { this.finishHint(null); return; }
      const r = this.hintSearch.step();
      if (!r || !r.done) return;
      this.hintSearch = null;
      if (r.bestMove) this.applyHintMove(r.bestMove);
      else this.finishHint(null);
    }
  }

  applyHintMove(move) {
    this.hintMove = move;
    this.hintSan = sanOfMove(this.game, this.game.board, move);
    this.hintPhase = 'idle';
    this.state = 'PLAYING';
    this.hintShownAt = this.timeMs;  // 3s 自动消失计时起点
    this.hintFade = 1;
    GameContext.emit('hint', {});
  }

  finishHint(fallbackMove) {
    this.hintPhase = 'idle';
    this.state = 'PLAYING';
    if (fallbackMove) { this.applyHintMove(fallbackMove); return; }
    this.hintFailed = true;
    this.hintShownAt = this.timeMs;
    this.hintFade = 1;
  }

  /** 采纳建议走法 */
  adoptHint() {
    if (!this.hintMove) return;
    const mv = this.hintMove;
    this.hintMove = null;
    this.hintSan = '';
    this.hintFailed = false;
    this.commitMove(mv, false);
  }

  /** 忽略建议 / 自动消失 */
  dismissHint() {
    this.hintMove = null;
    this.hintSan = '';
    this.hintFailed = false;
    this.hintShownAt = -1;
    this.hintFade = 1;
  }

  /**
   * 黑方应手。
   * 残局题语义：黑方要「最顽抗」（拖得最久），这样「N 步将杀」在最优防守下依然成立
   * —— 残局数据正是按此语义校验的。若求解器超时，则回落普通 alpha-beta（createSearch）。
   */
  startBlackThinking() {
    if (!this.game || this.game.turn !== COLOR.BLACK) return;
    const state = { castling: this.game.castling, enPassantTarget: this.game.enPassantTarget };
    // 白方剩余可用手数（黑方要在窗口内把白方的强制杀深度拖到最大）
    const cap = Math.max(1, this.targetMoves() - this.ownMoves);
    this.blackSolver = createMateSolver(this.game.board, state, COLOR.BLACK, cap, BLACK_SOLVER_MS, 'defend');
    this.blackSearch = null;
    this.state = 'BLACK_THINKING';
  }

  stepBlackSearch() {
    // ① 优先走「最顽抗防守」求解器
    if (this.blackSolver) {
      const r = this.blackSolver.step();
      if (!r || !r.done) return;
      this.blackSolver = null;
      if (r.move) { this.commitMove(r.move, true); return; }
      // 求解失败 → 回落普通 alpha-beta
    }
    if (!this.blackSearch) {
      const state = { castling: this.game.castling, enPassantTarget: this.game.enPassantTarget };
      this.blackSearch = createSearch(this.game.board, COLOR.BLACK, state, BLACK_MAX_DEPTH, BLACK_BUDGET_MS, BLACK_SLICE_MS);
    }
    const r = this.blackSearch.step();
    if (!r || !r.done) return;
    this.blackSearch = null;
    if (!r.bestMove) {
      const st = this.game.getStatus();
      if (st.result) this.onGameEnd(st);
      else this.state = 'PLAYING';
      return;
    }
    this.commitMove(r.bestMove, true);
  }

  // ==================== 走子 ====================
  handleBoardTouch(x, y) {
    if (this.state !== 'PLAYING' && this.state !== 'SELECTED') return;
    if (!this.isPlayerTurn()) return;
    const pos = this.screenToBoard(x, y);
    if (!pos) { this.selected = null; this.legalMoves = []; this.state = 'PLAYING'; return; }
    const { row, col } = pos;
    const piece = this.game.board.getPiece(row, col);
    if (this.selected) {
      if (this.selected.row === row && this.selected.col === col) {
        this.selected = null; this.legalMoves = []; this.state = 'PLAYING'; return;
      }
      const mv = this.legalMoves.find(m => m.toRow === row && m.toCol === col);
      if (mv) {
        const promos = this.legalMoves.filter(m => m.toRow === row && m.toCol === col && m.promotion);
        if (promos.length > 1) {
          this.promotionMoves = promos;
          this.state = 'PROMOTION';
          GameContext.openModal('promotion', {});
          return;
        }
        this.commitMove(mv, false);
        return;
      }
      if (piece && piece.color === this.game.turn) { this.selectPiece(row, col); return; }
      this.selected = null; this.legalMoves = []; this.state = 'PLAYING'; return;
    }
    if (piece && piece.color === this.game.turn) this.selectPiece(row, col);
  }

  selectPiece(row, col) {
    this.selected = { row, col };
    this.legalMoves = this.game.getLegalMovesFor(row, col);
    this.state = 'SELECTED';
    GameContext.emit('select', {});
  }

  commitMove(move, byBlack) {
    if (!this.game || !move) return;
    const moverColor = this.game.turn;
    const piece = this.game.board.getPiece(move.fromRow, move.fromCol);
    const capturedBefore = move.isEnPassant
      ? this.game.board.getPiece(moverColor === COLOR.WHITE ? move.toRow + 1 : move.toRow - 1, move.toCol)
      : this.game.board.getPiece(move.toRow, move.toCol);
    const ok = this.game.makeMove(move);
    if (!ok) { this.state = 'PLAYING'; return; }
    this.lastMove = { fromRow: move.fromRow, fromCol: move.fromCol, toRow: move.toRow, toCol: move.toCol };
    this.selected = null; this.legalMoves = [];
    this.hintMove = null; this.hintSan = ''; this.hintFailed = false;
    if (capturedBefore) GameContext.emit('capture', {}); else GameContext.emit('move', {});
    const st = this.game.getStatus();
    if (st.inCheck && !st.result) GameContext.emit('check', {});
    if (moverColor === COLOR.WHITE) this.ownMoves++;
    this.lastMoverWasPlayer = (moverColor === COLOR.WHITE);

    const reduce = !!GameContext.getSettings().reduceMotion;
    this.state = 'ANIMATING';
    this.anim = {
      move: { fromRow: move.fromRow, fromCol: move.fromCol, toRow: move.toRow, toCol: move.toCol, isCastling: move.isCastling },
      pieceType: piece ? piece.type : 'p', pieceColor: moverColor,
      t: 0, dur: (reduce || move.isCastling) ? 0 : (MO.move || 180) / 1000
    };
    this.landRing = { row: move.toRow, col: move.toCol, t: 0, dur: (reduce ? 45 : (MO.land || 90)) / 1000 };
  }

  onAnimEnd() {
    this.anim = null;
    const st = this.game.getStatus();
    if (st.result) { this.onGameEnd(st); return; }
    if (this.game.turn === COLOR.BLACK) {
      // 玩家刚走完：先判超步数（§1.2 ②）
      if (this.lastMoverWasPlayer && this.checkMoveCap()) {
        this.onFail({ result: 'draw', resultReason: 'movecap' });
        return;
      }
      // P1-I5：残局临近目标步数预警——玩家走完一手后，若与目标将杀仅差 1~2 手，给出明确进度反馈
      if (this.lastMoverWasPlayer) {
        const remain = this.targetMoves() - this.ownMoves;
        if (remain >= 1 && remain <= 2) {
          GameContext.showBanner(remain === 1 ? '再走 1 手即可将杀！' : '再走 2 手内将杀', 'success');
        }
      }
      this.startBlackThinking();
      return;
    }
    this.state = 'PLAYING';
  }

  // ==================== 终局 ====================
  onGameEnd(st) {
    const status = st || (this.game ? this.game.getStatus() : { result: null });
    if (status.result === 'white_win' && status.resultReason === 'checkmate') {
      this.onClear();
      return;
    }
    // 其余终局（玩家被将杀 / 逼和 / 子力不足 / 三次重复 / 50 回合）→ 未破阵
    this.onFail(status);
  }

  /** 破阵（§1.5 星级 + §1.6 奖励） */
  onClear() {
    this.state = 'RESULT';
    this.hintMove = null;
    this.hintFailed = false;
    const overtime = this.isOvertime();
    const stars = this.computeStars(overtime);
    const tip = TIPS.find(t => t.id === (this.eg && this.eg.tipId)) || null;

    // 存档写入（§1.5 / §1.8）
    try {
      if (storageMod && storageMod.unlockLevel) storageMod.unlockLevel(this.level + 1);
      if (storageMod && storageMod.setCleared) {
        storageMod.setCleared(this.level, {
          stars: stars, bestTimeMs: Math.round(this.elapsedMs), bestMoves: this.ownMoves, rewarded: !overtime
        });
      }
      if (storageMod && storageMod.collectTip) {
        if (!overtime || TIP_ON_OVERTIME) storageMod.collectTip(this.eg.tipId);
      }
      if (storageMod && storageMod.recordClear) storageMod.recordClear();
    } catch (e) { /* 存档失败不阻塞结算 */ }

    // 限时内 → 抽 1 锦囊技能（§1.6 / §1.7 权重）
    let skill = null;
    if (!overtime) {
      const picked = drawSkillByWeight(this.eg && this.eg.skillWeights);
      if (picked) {
        skill = picked;
        const before = this.getPendingHints();
        try { if (storageMod && storageMod.addSkill) storageMod.addSkill(picked.id, 1); } catch (e) { /* noop */ }
        if (this.getPendingHints() > before) {
          GameContext.showBanner('锦囊满了，多出的换成 1 次锦囊提示给你备着～', 'info');
        }
      }
    }

    GameContext.emit('levelClear', { tier: overtime ? 'overtime' : 'clear' });

    const payload = {
      tier: overtime ? 'overtime' : 'clear',
      overtime: overtime,
      stars: stars,
      timeMs: Math.round(this.elapsedMs),
      ownMoves: this.ownMoves,
      tip: tip,
      skill: skill,
      hasNext: this.level < (ENDGAMES.length || 100),
      title: this.level >= (ENDGAMES.length || 100) ? '百阵皆破，出师了！'
        : (overtime ? '过关！再快一点就有锦囊了～' : '漂亮，破阵！')
    };
    this.resultPayload = payload;
    this.revealEndsMap = !payload.hasNext;
    GameContext.openModal('result', payload);
  }

  /**
   * 星级（§1.5 权威）：
   *   ⭐⭐⭐ 用时 ≤ 限时 且 己方走子数 ≤ 目标步数 且 未使用任何提示/悔棋/技能
   *   ⭐⭐   用时 ≤ 限时（用提示/悔棋或步数略超目标，但未逼近 moveCap）
   *   ⭐    超时态达成，或步数逼近 moveCap
   */
  computeStars(overtime) {
    if (overtime) return 1;                        // 超时态达成 → 通关（⭐）
    const cap = this.moveCap();
    if (this.ownMoves >= cap - 1) return 1;        // 步数接近 moveCap → 通关（⭐）
    if (this.ownMoves <= this.targetMoves() && !this.usedHelper) return 3;  // 完美（⭐⭐⭐）
    return 2;                                      // 良好（⭐⭐）
  }

  getPendingHints() {
    try {
      const egd = storageMod && storageMod.loadEndgame ? storageMod.loadEndgame() : null;
      return egd && egd.pendingHints > 0 ? egd.pendingHints : 0;
    } catch (e) { return 0; }
  }

  /** 未破阵（§1.2 失败判定） */
  onFail(status) {
    this.state = 'FAIL';
    this.hintMove = null;
    this.hintFailed = false;
    let sub = '换个思路再来一次，这阵不急。';
    const reason = status && status.resultReason;
    if (reason === 'checkmate') sub = '王被围住了，先护王再想杀招。';
    else if (reason === 'stalemate') sub = '黑王无处可走了，这步再想想别的杀法。';
    else if (reason === 'insufficient_material') sub = '子力不够形成杀招了，重开一局试试。';
    else if (reason === 'threefold') sub = '同一局面绕了几圈，换个走法吧。';
    else if (reason === 'fifty_moves') sub = '回合用得有点多，抓紧点节奏。';
    else if (reason === 'movecap') sub = '步数用满了，这一手再想想别的杀法。';
    else if (reason === 'resign') sub = '没关系，这一阵先放一放，等会儿再来。';
    GameContext.emit('levelFail', {});
    GameContext.openModal('fail', { sub: sub });
  }

  // ==================== 结算按钮 ====================
  onResultNext() {
    GameContext.closeModal();
    // 有奖励（技能 / 妙招）时先弹锦囊揭晓卡，收下后再进下一阵（§1.5 / §3.3 M_pouchReveal）
    if (this.resultPayload && (this.resultPayload.skill || this.resultPayload.tip)) {
      GameContext.openModal('reveal', this.resultPayload);
      if (this.resultPayload.skill) GameContext.emit('skillGet', {});
      return;
    }
    this.gotoLevel(this.level + 1);
  }

  onResultFinish() {
    GameContext.closeModal();
    if (this.resultPayload && (this.resultPayload.skill || this.resultPayload.tip)) {
      GameContext.openModal('reveal', this.resultPayload);
      if (this.resultPayload.skill) GameContext.emit('skillGet', {});
      this.revealEndsMap = true;
      return;
    }
    this.backToMap();
  }

  onResultAgain() {
    GameContext.closeModal();
    this.startLevel();
  }

  onRevealAccept() {
    GameContext.closeModal();
    if (this.revealEndsMap) { this.revealEndsMap = false; this.backToMap(); return; }
    this.gotoLevel(this.level + 1);
  }

  gotoLevel(n) {
    if (n > (ENDGAMES.length || 100)) { this.backToMap(); return; }
    this.level = n;
    this.eg = ENDGAMES[this.level - 1] || this.eg;
    this.startLevel();
  }

  onRetry() {
    GameContext.closeModal();
    this.startLevel();
  }

  backToMap() {
    GameContext.closeModal();
    GameContext.emit('navigate', { to: 'endgameMap' });
    GameContext.popScene();
  }

  requestLeave() {
    if (this.state === 'RESULT' || this.state === 'FAIL') { this.backToMap(); return; }
    if (this.ownMoves > 0) {
      GameContext.openModal('confirm', {
        title: '离开本阵？', message: '这一阵还没破，离开后机会会重置，下次再挑战～',
        buttons: [{ label: '继续破阵', action: 'cancel', variant: 'secondary' }, { label: '离开', action: 'confirm', variant: 'danger' }],
        onAction: (act) => {
          GameContext.closeModal();
          if (act === 'confirm') this.backToMap();
        }
      });
    } else {
      this.backToMap();
    }
  }

  confirmGiveUp() {
    GameContext.openModal('confirm', {
      title: '放弃本阵？', message: '放弃这一阵不扣任何东西，随时可以再来。',
      buttons: [{ label: '再想想', action: 'cancel', variant: 'secondary' }, { label: '放弃', action: 'confirm', variant: 'danger' }],
      onAction: (act) => {
        GameContext.closeModal();
        if (act === 'confirm') this.onFail({ result: 'draw', resultReason: 'resign' });
      }
    });
  }

  /** 教练提示（ENDGAMES.coachHints）：走通用模态（confirm），关闭后回到失败卡 */
  showCoachHints() {
    const hints = (this.eg && this.eg.coachHints) || [];
    const text = hints.length ? hints.map((h, i) => (i + 1) + '. ' + h).join('\n') : '这一阵暂时没有教练提示，慢慢想。';
    const back = this.sm && this.sm.modal ? this.sm.modal.payload : null;
    GameContext.openModal('confirm', {
      title: '教练提示', height: 200, message: text,
      buttons: [{ label: '知道了', action: 'ok', variant: 'primary' }],
      onAction: () => {
        GameContext.closeModal();
        // 通用模态会顶掉失败卡 → 关掉后把失败卡重新挂回
        if (back && back.sub) GameContext.openModal('fail', back);
      }
    });
  }

  // ==================== 技能 ====================
  getInventory() {
    let eg = null;
    try { eg = storageMod && storageMod.loadEndgame ? storageMod.loadEndgame() : null; } catch (e) { eg = null; }
    const list = (eg && Array.isArray(eg.skills)) ? eg.skills : [];
    const out = [];
    for (const entry of list) {
      if (!entry || !entry.id) continue;
      if (!SKILLS.some(s => s.id === entry.id)) continue;
      if (entry.charges <= 0) continue;
      out.push({ id: entry.id, charges: entry.charges });
    }
    return out;
  }

  /** 技能是否可用（时机 + 每阵上限） */
  skillUsable(sk) {
    if (!sk) return false;
    if (this.activatedCount >= MAX_ACTIVATE_SKILLS) return false;
    if (this.activatedIds[sk.id]) return false;
    if ((sk.id === 'skill_scout' || sk.id === 'skill_ward') && this.ownMoves > 0) return false;
    if (sk.id === 'skill_freeze' && this.isOvertime()) return false;
    if ((sk.id === 'skill_master' || sk.id === 'skill_mirror' || sk.id === 'skill_undo') && !this.isPlayerTurn()) return false;
    return true;
  }

  skillReason(sk) {
    if (this.activatedCount >= MAX_ACTIVATE_SKILLS) return '本阵已用满';
    if (this.activatedIds[sk.id]) return '本阵已用';
    if ((sk.id === 'skill_scout' || sk.id === 'skill_ward') && this.ownMoves > 0) return '开局前装备';
    if (sk.id === 'skill_freeze' && this.isOvertime()) return '超时后无效';
    if ((sk.id === 'skill_master' || sk.id === 'skill_mirror' || sk.id === 'skill_undo') && !this.isPlayerTurn()) return '轮到你时可用';
    return '';
  }

  activateSkill(id) {
    const sk = SKILLS.find(s => s.id === id);
    if (!sk) return;
    if (!this.skillUsable(sk)) {
      GameContext.showBanner(this.skillReason(sk) || '现在用不了这个锦囊', 'info');
      return;
    }
    // 扣库存（技能跨关累积、关内消耗；失败不返还，§1.4）
    let ok = false;
    try { ok = storageMod && storageMod.useSkill ? storageMod.useSkill(id) : false; } catch (e) { ok = false; }
    if (!ok) {
      GameContext.showBanner('这个锦囊已经用完了', 'info');
      return;
    }
    this.activatedCount++;
    this.activatedIds[id] = true;
    this.usedHelper = true;
    GameContext.emit('skillUse', { id: id });

    switch (id) {
      case 'skill_hourglass':
        // 本阵时限 +20s（超时态激活则回补 20s 到计时）
        this.limitMs += 20000;
        GameContext.showBanner('沙漏：本阵时限 +20s', 'success');
        break;
      case 'skill_mirror':
        this.hints += 2;
        GameContext.showBanner('明镜：本阵锦囊提示 +2', 'success');
        break;
      case 'skill_undo':
        this.undos += 1;
        GameContext.showBanner('回马枪：本阵多一次回马', 'success');
        break;
      case 'skill_scout': {
        const mv = this.searchBestWhiteMove(2);
        if (mv) {
          this.scoutMove = mv;
          GameContext.showBanner('探马：为你标出了最佳首步', 'success');
        } else {
          GameContext.showBanner('探马：这步先看不清，慢慢来', 'info');
        }
        break;
      }
      case 'skill_freeze':
        this.freezeLeftMs = FREEZE_MS;
        GameContext.showBanner('定风珠：计时暂停 30s', 'success');
        break;
      case 'skill_master': {
        const mv = this.searchBestWhiteMove(Math.max(1, Math.min(3, (this.eg && this.eg.difficulty) || 1)));
        if (mv) {
          GameContext.showBanner('妙手：这一手替你走', 'success');
          GameContext.closeModal();
          this.commitMove(mv, false);
        } else {
          GameContext.showBanner('妙手：这一手先看不出名堂', 'info');
        }
        break;
      }
      case 'skill_ward':
        // 装备(整阵)：本阵 moveCap +3，且获得 1 次「免失败」
        this.wardEquipped = true;
        this.wardFreeFail = true;
        this.moveCapBonus = 3;
        GameContext.showBanner('护身：本阵步数上限 +3，并获一次免失败', 'success');
        break;
      default:
        break;
    }
  }

  /** 同步搜一步最佳着（技能用；预算内完成，避免长阻塞） */
  searchBestWhiteMove(depth) {
    try {
      const state = { castling: this.game.castling, enPassantTarget: this.game.enPassantTarget };
      const s = createSearch(this.game.board, COLOR.WHITE, state, Math.max(1, depth), SKILL_SEARCH_MS, 16);
      const r = s.finish();
      return r.bestMove || null;
    } catch (e) { return null; }
  }

  // ==================== 超步数判定（§1.2 ②）====================
  /** @returns {boolean} true = 未破阵失败 */
  checkMoveCap() {
    if (this.ownMoves <= this.moveCap()) return false;
    if (this.wardEquipped && this.wardFreeFail) {
      // 护身：免失败一次 —— 把当前步数设为新上限，再多走一步才会判负
      this.wardFreeFail = false;
      const base = ((this.eg && this.eg.moveCap) || 5) + this.moveCapBonus;
      this.wardExtraCap = Math.max(0, this.ownMoves - base);
      GameContext.showBanner('护身挡了一次，还能再走一步', 'info');
      return false;
    }
    return true;
  }
}

module.exports = EndgameScene;
