/**
 * 残局闯关数据校验脚本（权威语义版）
 *
 * 依据 V2_UX_SPEC.md §1.6 / §1.7：
 *   targetMoves N = 己方（玩家）走子数；强制杀需在 N 步（≤ N 步）内完成
 *   moveCap = N * 2 + 3（双方合计半回合上限）
 *
 * 对 src/data/endgames.js 的 100 阵逐一验证：
 *   1. FEN 可被引擎解析、初始局面合法（双方各一王、非走棋方未被将军、双方有路可走）
 *   2. sideToMove 一方存在强制将杀线：min(己方步数) ≤ targetMoves（并与 theme 声明一致）
 *   3. sideToMove 的王没有被将死（不是「已输」局面）
 *   4. 数据字段完整（id/name/fen/sideToMove/targetMoves/moveCap/timeLimitSec/difficulty/theme/tipId/skillWeights/intro/coachHints）
 *   5. 数值表一致性（N / moveCap / 限时 / 难度 / tipId / 技能权重）
 *
 * 用法：node test-endgame.js（全绿退出码 0，否则 1）
 * 另导出校验与搜索工具，供数据调参脚本复用。
 */
'use strict';

const ChessGame = require('./src/core/game');
const Board = require('./src/core/board');
const movegen = require('./src/core/movegen');
const { COLOR, PIECE } = require('./src/core/constants');
const { ENDGAMES, TIPS, SKILLS } = require('./src/data/endgames');

const INF = 999;

const REQUIRED_FIELDS = [
  'id', 'name', 'fen', 'sideToMove', 'targetMoves', 'moveCap', 'timeLimitSec',
  'difficulty', 'theme', 'tipId', 'skillWeights', 'intro', 'coachHints'
];

// 数值一致性改为「规则校验」（见 checkSpecTable），不再硬编码逐阵表，适配 100 阵自动生成

const TIP_IDS = TIPS.map(t => t.id);
const SKILL_IDS = SKILLS.map(s => s.id);

// ---------------------------------------------------------------------------
// FEN 解析（game.js 无 FEN 入口，此处自包含；坐标约定同 src/core/board.js）
// ---------------------------------------------------------------------------

/** FEN → 局面数据；非法返回 { error } */
function parseFen(fen) {
  if (typeof fen !== 'string' || !fen.trim()) return { error: 'FEN 为空' };
  const parts = fen.trim().split(/\s+/);
  if (parts.length < 4) return { error: 'FEN 字段不足（至少 4 段）' };

  const ranks = parts[0].split('/');
  if (ranks.length !== 8) return { error: 'FEN 阵容必须 8 行' };

  const grid = Array.from({ length: 8 }, () => Array(8).fill(null));
  const kingPos = { w: null, b: null };
  for (let r = 0; r < 8; r++) {
    let c = 0;
    for (const ch of ranks[r]) {
      if (ch >= '1' && ch <= '8') { c += ch.charCodeAt(0) - 48; continue; }
      const type = ch.toLowerCase();
      if (!Object.values(PIECE).includes(type)) return { error: '非法棋子字符: ' + ch };
      if (c > 7) return { error: '第 ' + (8 - r) + ' 横线格数溢出' };
      const color = ch === type ? COLOR.BLACK : COLOR.WHITE;
      grid[r][c] = { type, color };
      if (type === PIECE.KING) {
        if (kingPos[color]) return { error: color + ' 方有多个王' };
        kingPos[color] = { row: r, col: c };
      }
      if (type === PIECE.PAWN && (r === 0 || r === 7)) return { error: '兵出现在第 1/8 横线' };
      c++;
    }
    if (c !== 8) return { error: '第 ' + (8 - r) + ' 横线格数不足' };
  }
  if (!kingPos.w || !kingPos.b) return { error: '缺少王' };

  const turn = parts[1];
  if (turn !== COLOR.WHITE && turn !== COLOR.BLACK) return { error: '非法走棋方: ' + turn };

  const castling = { wk: false, wq: false, bk: false, bq: false };
  const cst = parts[2];
  if (cst !== '-') {
    if (!/^[KQkq]+$/.test(cst)) return { error: '非法易位字段: ' + cst };
    if (cst.indexOf('K') >= 0) castling.wk = true;
    if (cst.indexOf('Q') >= 0) castling.wq = true;
    if (cst.indexOf('k') >= 0) castling.bk = true;
    if (cst.indexOf('q') >= 0) castling.bq = true;
  }

  let epTarget = null;
  if (parts[3] !== '-') {
    if (!/^[a-h][1-8]$/.test(parts[3])) return { error: '非法吃过路兵字段: ' + parts[3] };
    const sq = Board.fromAlgebraic(parts[3]);
    epTarget = { row: sq.row, col: sq.col };
  }

  const halfMoveClock = parts[4] !== undefined ? parseInt(parts[4], 10) : 0;
  const fullMoveNumber = parts[5] !== undefined ? parseInt(parts[5], 10) : 1;
  if (!Number.isInteger(halfMoveClock) || halfMoveClock < 0) return { error: '非法半回合计数' };
  if (!Number.isInteger(fullMoveNumber) || fullMoveNumber < 1) return { error: '非法全回合数' };

  return { grid, turn, castling, enPassantTarget: epTarget, halfMoveClock, fullMoveNumber };
}

/** FEN → 摆好局面的 ChessGame（引擎对象） */
function loadFen(fen) {
  const parsed = parseFen(fen);
  if (parsed.error) return { error: parsed.error };

  const game = new ChessGame();
  game.board.grid = parsed.grid;
  game.turn = parsed.turn;
  game.castling = parsed.castling;
  game.enPassantTarget = parsed.enPassantTarget;
  game.halfMoveClock = parsed.halfMoveClock;
  game.fullMoveNumber = parsed.fullMoveNumber;
  game.history = [];
  game.moveLog = [];
  game.uciLog = [];
  game.result = null;
  game.resultReason = '';
  game.startFen = fen;
  game.positionCounts = new Map();
  game.positionCounts.set(game.getPositionKey(), 1);
  return { game };
}

// ---------------------------------------------------------------------------
// 强制杀深度分析（depth = 己方走子数；带记忆化）
// ---------------------------------------------------------------------------

function opposite(color) {
  return color === COLOR.WHITE ? COLOR.BLACK : COLOR.WHITE;
}

/** movegen 走法 → UCI（同 game.js moveToUci 约定） */
function uciOf(move) {
  return Board.toAlgebraic(move.fromRow, move.fromCol) +
         Board.toAlgebraic(move.toRow, move.toCol) +
         (move.promotion || '');
}

/** 应用走法并推进规则状态（castling / en passant），返回新局面 */
function applyMove(board, state, move) {
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
      col: move.toCol
    };
  }
  if (piece && piece.type === PIECE.KING) {
    if (piece.color === COLOR.WHITE) { next.castling.wk = false; next.castling.wq = false; }
    else { next.castling.bk = false; next.castling.bq = false; }
  }
  if (piece && piece.type === PIECE.ROOK) {
    if (piece.color === COLOR.WHITE) {
      if (move.fromRow === 7 && move.fromCol === 0) next.castling.wq = false;
      if (move.fromRow === 7 && move.fromCol === 7) next.castling.wk = false;
    } else {
      if (move.fromRow === 0 && move.fromCol === 0) next.castling.bq = false;
      if (move.fromRow === 0 && move.fromCol === 7) next.castling.bk = false;
    }
  }
  if (move.toRow === 0 && move.toCol === 0) next.castling.bq = false;
  if (move.toRow === 0 && move.toCol === 7) next.castling.bk = false;
  if (move.toRow === 7 && move.toCol === 0) next.castling.wq = false;
  if (move.toRow === 7 && move.toCol === 7) next.castling.wk = false;

  movegen.applyMoveToBoard(board, move);
  return { board, state: next };
}

/** 局面键（含走棋方与吃过路兵目标），用于记忆化 */
function posKey(board, turn, state) {
  let s = turn + '|' +
    (state.enPassantTarget ? state.enPassantTarget.row + ',' + state.enPassantTarget.col : '-') + '|';
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const p = board.getPiece(r, c);
      s += p ? (p.color + p.type) : '.';
    }
  }
  return s;
}

/** 该方是否已被将死 */
function isMate(board, color, state) {
  return movegen.isInCheck(board, color) &&
         movegen.generateLegalMoves(board, color, state).length === 0;
}

/**
 * attacker 最少需走多少「己方步数」才能强制将死 defender（cap 步内不可行则返回 INF）
 */
function attackerDepth(board, state, attacker, cap, ctx) {
  const def = opposite(attacker);
  const key = 'A' + posKey(board, attacker, state) + '#' + cap;
  if (ctx.memo.has(key)) return ctx.memo.get(key);
  if (++ctx.nodes > ctx.limit) { ctx.aborted = true; return INF; }

  const moves = movegen.generateLegalMoves(board, attacker, state);
  if (moves.length === 0) { ctx.memo.set(key, INF); return INF; }

  let best = INF;
  for (const move of moves) {
    const nb = board.clone();
    const nx = applyMove(nb, state, move);
    let cand;
    if (isMate(nx.board, def, nx.state)) {
      cand = 1;
    } else if (cap <= 1) {
      continue;
    } else {
      const w = defenderWorst(nx.board, nx.state, attacker, cap - 1, ctx);
      if (ctx.aborted) return INF;
      cand = w >= INF ? INF : 1 + w;
    }
    if (cand < best) { best = cand; if (best === 1) break; }
  }
  ctx.memo.set(key, best);
  return best;
}

/** defender 最顽抗时的最大深度（存在一条应着能逃脱则视为不可强制） */
function defenderWorst(board, state, attacker, cap, ctx) {
  const def = opposite(attacker);
  const key = 'D' + posKey(board, def, state) + '#' + cap;
  if (ctx.memo.has(key)) return ctx.memo.get(key);
  if (++ctx.nodes > ctx.limit) { ctx.aborted = true; return INF; }

  const moves = movegen.generateLegalMoves(board, def, state);
  if (moves.length === 0) { ctx.memo.set(key, INF); return INF; }

  let worst = 0;
  for (const move of moves) {
    const nb = board.clone();
    const nx = applyMove(nb, state, move);
    const v = attackerDepth(nx.board, nx.state, attacker, cap, ctx);
    if (ctx.aborted) return INF;
    if (v >= INF) { ctx.memo.set(key, INF); return INF; }
    if (v > worst) worst = v;
  }
  ctx.memo.set(key, worst);
  return worst;
}

/**
 * 求强制杀（最小己方步数 + 一条杀棋线）
 * @param {number} cap 允许的己方步数上限
 * @param {number} [limit] 搜索节点上限（防止极端局面爆内存）
 * @returns {{depth: number, line: string[], aborted: boolean}} depth = -1 表示 cap 步内无强制杀
 */
function findMateLine(board, state, attacker, cap, limit) {
  const ctx = { memo: new Map(), nodes: 0, limit: limit || 3e6, aborted: false };
  const depth = attackerDepth(board, state, attacker, cap, ctx);
  if (ctx.aborted || depth >= INF) return { depth: -1, line: [], aborted: ctx.aborted };

  const line = [];
  let bd = board;
  let st = state;
  let turn = attacker;
  let remaining = cap;

  for (let step = 0; step < depth * 2 + 2; step++) {
    const moves = movegen.generateLegalMoves(bd, turn, st);
    if (moves.length === 0) break;

    if (turn === attacker) {
      let best = null;
      let bestScore = INF;
      for (const move of moves) {
        const nb = bd.clone();
        const nx = applyMove(nb, st, move);
        let score;
        if (isMate(nx.board, opposite(attacker), nx.state)) {
          score = 1;
        } else if (remaining <= 1) {
          continue;
        } else {
          const w = defenderWorst(nx.board, nx.state, attacker, remaining - 1, ctx);
          score = w >= INF ? INF : 1 + w;
        }
        if (score < bestScore) { bestScore = score; best = move; if (score === 1) break; }
      }
      if (!best) break;
      line.push(uciOf(best));
      const nb = bd.clone();
      const nx = applyMove(nb, st, best);
      bd = nx.board; st = nx.state; remaining -= 1; turn = opposite(attacker);
    } else {
      // defender 取最顽抗应着（使剩余深度最大）
      let best = null;
      let bestScore = -1;
      for (const move of moves) {
        const nb = bd.clone();
        const nx = applyMove(nb, st, move);
        const v = attackerDepth(nx.board, nx.state, attacker, remaining, ctx);
        if (v > bestScore) { bestScore = v; best = move; }
      }
      if (!best) break;
      line.push(uciOf(best));
      const nb = bd.clone();
      const nx = applyMove(nb, st, best);
      bd = nx.board; st = nx.state; turn = attacker;
    }
  }
  return { depth, line, aborted: false };
}

// ---------------------------------------------------------------------------
// 校验
// ---------------------------------------------------------------------------

/** 字段完整性（检查 4） */
function checkFields(eg) {
  const missing = REQUIRED_FIELDS.filter(f => eg[f] === undefined || eg[f] === null);
  if (missing.length) return { ok: false, detail: '缺字段: ' + missing.join(',') };

  const problems = [];
  if (!/^EG-\d{2,3}$/.test(eg.id)) problems.push('id 格式非 EG-NN');
  if (typeof eg.name !== 'string' || !eg.name.trim()) problems.push('name 为空');
  if (typeof eg.fen !== 'string' || !eg.fen.trim()) problems.push('fen 为空');
  if (eg.sideToMove !== 'w' && eg.sideToMove !== 'b') problems.push('sideToMove 非 w/b');
  if (!Number.isInteger(eg.targetMoves) || eg.targetMoves < 1) problems.push('targetMoves 非正整数');
  if (!Number.isInteger(eg.moveCap) || eg.moveCap < 1) problems.push('moveCap 非正整数');
  if (eg.moveCap !== eg.targetMoves * 2 + 3) problems.push('moveCap ≠ targetMoves*2+3');
  if (!Number.isInteger(eg.timeLimitSec) || eg.timeLimitSec <= 0) problems.push('timeLimitSec 非正整数');
  if (!Number.isInteger(eg.difficulty) || eg.difficulty < 1 || eg.difficulty > 5) problems.push('difficulty 超出 1-5');
  if (typeof eg.theme !== 'string' || !/^mate-in-\d+·.+/.test(eg.theme)) problems.push('theme 格式应为 mate-in-N·中文战术名');
  if (!TIP_IDS.includes(eg.tipId)) problems.push('tipId 不在妙招库: ' + eg.tipId);
  const w = eg.skillWeights;
  if (!w || typeof w !== 'object') problems.push('skillWeights 缺失');
  else {
    for (const k of ['common', 'rare', 'epic']) {
      if (!Number.isInteger(w[k]) || w[k] < 0) problems.push('skillWeights.' + k + ' 非法');
    }
    if (Number.isInteger(w.common) && Number.isInteger(w.rare) && Number.isInteger(w.epic) &&
        w.common + w.rare + w.epic !== 100) {
      problems.push('skillWeights 合计应为 100');
    }
  }
  if (typeof eg.intro !== 'string' || !eg.intro.trim()) problems.push('intro 为空');
  if (!Array.isArray(eg.coachHints) || eg.coachHints.length < 2 || eg.coachHints.length > 3 ||
      eg.coachHints.some(h => typeof h !== 'string' || !h.trim())) {
    problems.push('coachHints 需为 2-3 条非空字符串');
  }
  // FEN 走棋方与 sideToMove 一致
  const fenTurn = String(eg.fen).trim().split(/\s+/)[1];
  if (fenTurn !== eg.sideToMove) problems.push('FEN 走棋方 ' + fenTurn + ' ≠ sideToMove ' + eg.sideToMove);

  // theme 声明的步数与 targetMoves 一致
  const m = /^mate-in-(\d+)·/.exec(eg.theme);
  if (m && Number(m[1]) !== eg.targetMoves) {
    problems.push('theme 步数 ' + m[1] + ' ≠ targetMoves ' + eg.targetMoves);
  }

  return problems.length ? { ok: false, detail: problems.join('; ') } : { ok: true, detail: '' };
}

/**
 * 单阵综合校验
 * @returns {{id, name, results, depth, line}}
 */
function validateEndgame(eg) {
  const results = [];
  const push = (label, ok, detail) => results.push({ label, ok: !!ok, detail: detail || '' });

  // ---- 检查 4：字段完整 ----
  const fields = checkFields(eg);
  push('4.数据字段完整', fields.ok, fields.detail);

  // ---- 检查 1：FEN 解析 + 初始局面合法 ----
  let board = null;
  let state = null;
  let side = eg.sideToMove;
  const loaded = loadFen(eg.fen);
  if (loaded.error) {
    push('1.FEN 解析与局面合法', false, 'FEN 解析失败: ' + loaded.error);
  } else {
    const game = loaded.game;
    board = game.board;
    state = { castling: game.castling, enPassantTarget: game.enPassantTarget };
    side = game.turn;

    const problems = [];
    const opp = opposite(side);
    if (movegen.isInCheck(board, opp)) problems.push('非走棋方 (' + opp + ') 正被将军，局面非法');
    const sideMoves = movegen.generateLegalMoves(board, side, state);
    const oppMoves = movegen.generateLegalMoves(board, opp, state);
    if (sideMoves.length === 0) problems.push('sideToMove 无合法走法（已将死/逼和）');
    if (oppMoves.length === 0) problems.push('非走棋方无合法走法（开局即逼和，不可达）');
    push('1.FEN 解析与局面合法', problems.length === 0, problems.join('; '));
  }

  // ---- 检查 3：sideToMove 未被将死 ----
  if (board && state) {
    const inCheck = movegen.isInCheck(board, side);
    const anyMove = movegen.generateLegalMoves(board, side, state).length > 0;
    push('3.sideToMove 王未被将死', !(inCheck && !anyMove),
      inCheck && !anyMove ? 'sideToMove 已被将死' : (inCheck ? '被将军但有解着' : '未被将军'));
  } else {
    push('3.sideToMove 王未被将死', false, '局面未加载');
  }

  // ---- 检查 2：targetMoves 步内存在强制将杀 ----
  let depth = -1;
  let line = [];
  if (board && state) {
    const found = findMateLine(board, state, side, eg.targetMoves);
    depth = found.depth;
    line = found.line;
    push('2.强制将杀 ≤' + eg.targetMoves + ' 己方步', depth >= 1,
      depth >= 1 ? ('最短 ' + depth + ' 己方步') : 'targetMoves 内无强制杀');
    // theme 与实际深度一致（数据质量）
    const m = /^mate-in-(\d+)/.exec(eg.theme || '');
    if (m) {
      push('＋theme=' + eg.theme + ' 与实际深度一致', depth === Number(m[1]),
        depth === Number(m[1]) ? '实际 ' + depth : '实际 ' + depth + ' ≠ 标注 ' + m[1]);
    }
  } else {
    push('2.强制将杀 ≤' + eg.targetMoves + ' 己方步', false, '局面未加载');
  }

  return { id: eg.id, name: eg.name, results, depth, line };
}

/**
 * 数值表一致性（检查 5）—— 规则校验（适配 100 阵自动生成，不再逐阵比对硬编码表）
 *   · 总阵数 = 100
 *   · 难度沿关卡非递减（§1.7 递进）
 *   · 每阵按 targetMoves 推导的数值（限时 / 难度 / 技能权重）与 gen100.js 生成契约一致
 *   · 妙招库 15 条、技能表 7 条
 */
function checkSpecTable(endgames) {
  const problems = [];
  const N = endgames.length;
  if (N !== 100) problems.push('应为 100 阵，实际 ' + N);

  // 难度沿关卡非递减
  for (let i = 1; i < N; i++) {
    if (endgames[i].difficulty < endgames[i - 1].difficulty) {
      problems.push(endgames[i].id + ' 难度未递进（' + endgames[i].difficulty + ' < ' + endgames[i - 1].difficulty + '）');
    }
  }

  // 按 targetMoves 推导的契约值（与 gen100.js 生成规则一致）
  const TIME = { 1: 45, 2: 60, 3: 90, 4: 120 };
  const DIFF = { 1: 1, 2: 2, 3: 3, 4: 5 };
  const W = { 1: [100, 0, 0], 2: [70, 30, 0], 3: [45, 50, 5], 4: [20, 50, 30] };
  endgames.forEach(eg => {
    const d = eg.targetMoves;
    if (TIME[d] !== undefined && eg.timeLimitSec !== TIME[d]) {
      problems.push(eg.id + ' timeLimitSec=' + eg.timeLimitSec + ' 应为 ' + TIME[d]);
    }
    if (DIFF[d] !== undefined && eg.difficulty !== DIFF[d]) {
      problems.push(eg.id + ' difficulty=' + eg.difficulty + ' 应为 ' + DIFF[d]);
    }
    const w = eg.skillWeights || {};
    const exp = W[d];
    if (exp && (w.common !== exp[0] || w.rare !== exp[1] || w.epic !== exp[2])) {
      problems.push(eg.id + ' skillWeights=' + JSON.stringify(w) + ' 应为 ' + exp.join('/'));
    }
  });

  // 妙招库 / 技能库自检
  if (TIP_IDS.length !== 15) problems.push('妙招文案库应为 15 条，实际 ' + TIP_IDS.length);
  if (SKILL_IDS.length !== 7) problems.push('技能表应为 7 条，实际 ' + SKILL_IDS.length);
  return problems.length ? { ok: false, detail: problems.join('\n    ') } : { ok: true, detail: '' };
}

// ---------------------------------------------------------------------------
// 主流程
// ---------------------------------------------------------------------------

function main() {
  console.log('=== 残局数据校验 test-endgame.js（权威数值表版）===\n');

  let passCount = 0;
  ENDGAMES.forEach((eg) => {
    const report = validateEndgame(eg);
    const allOk = report.results.every(r => r.ok);
    if (allOk) passCount++;
    console.log('[' + report.id + '] ' + report.name +
      ' | theme=' + eg.theme + ' | difficulty=' + eg.difficulty +
      ' | side=' + eg.sideToMove + ' | targetMoves=' + eg.targetMoves + ' | moveCap=' + eg.moveCap);
    for (const r of report.results) {
      console.log('   ' + r.label + ': ' + (r.ok ? '✓' : '✗') + (r.detail ? '  (' + r.detail + ')' : ''));
    }
    if (report.line.length) console.log('   强制杀线 UCI: ' + report.line.join(' '));
    console.log('');
  });

  const spec = checkSpecTable(ENDGAMES);
  console.log('数值表一致性（N / moveCap / 限时 / 难度 / tipId / 技能权重 / 妙招技能库）: ' + (spec.ok ? '✓' : '✗'));
  if (!spec.ok) console.log('    ' + spec.detail);

  const total = ENDGAMES.length;
  const okAll = passCount === total && spec.ok;
  console.log('\n=== 结果: ' + passCount + '/' + total + ' 阵通过' + (spec.ok ? '，数值表一致' : '，数值表有偏差') + ' ===');
  console.log(okAll ? 'ALL GREEN' : 'FAILED');
  process.exitCode = okAll ? 0 : 1;
}

if (require.main === module) {
  main();
}

module.exports = {
  ENDGAMES,
  TIPS,
  SKILLS,
  parseFen,
  loadFen,
  findMateLine,
  attackerDepth,
  defenderWorst,
  isMate,
  validateEndgame,
  checkFields,
  checkSpecTable,
  opposite,
  uciOf
};
