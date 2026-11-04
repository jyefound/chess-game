'use strict';
/**
 * 残局生成 / 校验辅助工具
 * - 纯数据层 build：用 movegen 真实搜索「强制将杀」距离
 * - 用法：node tools/gen_endgame.js gen    -> 随机生成各难度阵并输出 FEN+距离
 *        node tools/gen_endgame.js check   -> 校验 tools/eg_candidates.json 中的 FEN
 */
const ChessGame = require('../src/core/game');
const Board = require('../src/core/board');
const movegen = require('../src/core/movegen');
const { PIECE, COLOR } = require('../src/core/constants');

const PIECE_BY_CHAR = { p: 'p', n: 'n', b: 'b', r: 'r', q: 'q', k: 'k' };

function applyFen(game, fen) {
  const parts = fen.trim().split(/\s+/);
  const placement = parts[0];
  const turn = parts[1] || 'w';
  const castling = parts[2] || '-';
  const ep = parts[3] || '-';
  game.reset();
  game.board.reset();
  const rows = placement.split('/');
  for (let r = 0; r < 8; r++) {
    const rowStr = rows[r];
    let c = 0;
    for (let i = 0; i < rowStr.length; i++) {
      const ch = rowStr[i];
      if (ch >= '1' && ch <= '9') { c += parseInt(ch, 10); continue; }
      const lower = ch.toLowerCase();
      const type = PIECE_BY_CHAR[lower];
      const color = (ch === lower) ? 'b' : 'w';
      game.board.setPiece(r, c, { type, color });
      c++;
    }
  }
  game.turn = turn;
  game.castling = {
    wk: castling.indexOf('K') >= 0,
    wq: castling.indexOf('Q') >= 0,
    bk: castling.indexOf('k') >= 0,
    bq: castling.indexOf('q') >= 0
  };
  if (ep && ep !== '-') {
    const sq = Board.fromAlgebraic(ep);
    game.enPassantTarget = { row: sq.row, col: sq.col };
  } else {
    game.enPassantTarget = null;
  }
  game.halfMoveClock = parseInt(parts[4] || '0', 10);
  game.fullMoveNumber = parseInt(parts[5] || '1', 10);
  game.result = null;
  game.resultReason = '';
}

function isCheckmated(game) {
  const moves = game.getLegalMoves();
  if (moves.length !== 0) return false;
  return movegen.isInCheck(game.board, game.turn);
}
function isStalemated(game) {
  const moves = game.getLegalMoves();
  if (moves.length !== 0) return false;
  return !movegen.isInCheck(game.board, game.turn);
}

// 强制将杀搜索：返回 attacker 将杀对手所需最少半步数（含对手着法），无强制杀返回 Infinity
function searchMate(game, attacker, maxPlies) {
  const turn = game.turn;
  const moves = game.getLegalMoves();
  if (moves.length === 0) {
    if (turn !== attacker && isCheckmated(game)) return 0; // 对手已被将杀
    return Infinity; // 逼和或无子可动且非杀
  }
  if (maxPlies <= 0) return Infinity;

  if (turn === attacker) {
    let best = Infinity;
    for (const m of moves) {
      game.makeMove(m);
      const r = searchMate(game, attacker, maxPlies - 1);
      game.undoMove();
      if (r !== Infinity) best = Math.min(best, 1 + r);
    }
    return best;
  } else {
    let worst = -1;
    for (const m of moves) {
      game.makeMove(m);
      const r = searchMate(game, attacker, maxPlies - 1);
      game.undoMove();
      if (r === Infinity) return Infinity; // 对手找到逃逸
      worst = Math.max(worst, 1 + r);
    }
    return worst === -1 ? Infinity : worst;
  }
}

// 随机挑一个棋子符号
function randPiece(allow) {
  return allow[Math.floor(Math.random() * allow.length)];
}

function tryRandom(targetDist) {
  const game = new ChessGame();
  game.reset();
  game.board.reset();
  // 黑王：边/角
  const bkSquares = [
    [0, 0], [0, 7], [7, 0], [7, 7], [0, 4], [7, 4], [3, 0], [4, 7], [0, 2], [7, 5]
  ];
  const [bkr, bkc] = bkSquares[Math.floor(Math.random() * bkSquares.length)];
  game.board.setPiece(bkr, bkc, { type: 'k', color: 'b' });

  // 白王：远离黑王，且不贴身
  let placed = false;
  for (let tries = 0; tries < 40 && !placed; tries++) {
    const r = Math.floor(Math.random() * 8);
    const c = Math.floor(Math.random() * 8);
    if (r === bkr && c === bkc) continue;
    const dr = Math.abs(r - bkr), dc = Math.abs(c - bkc);
    if (dr + dc <= 2) continue; // 不贴身
    game.board.setPiece(r, c, { type: 'k', color: 'w' });
    placed = true;
  }
  if (!placed) return null;

  // 攻方：1~2 子（后/车/马/象）
  const attackers = Math.random() < 0.5 ? ['q'] : (Math.random() < 0.7 ? ['r', 'r'] : ['q', 'r']);
  for (const a of attackers) {
    for (let tries = 0; tries < 30; tries++) {
      const r = Math.floor(Math.random() * 8);
      const c = Math.floor(Math.random() * 8);
      const occ = game.board.getPiece(r, c);
      if (occ) continue;
      game.board.setPiece(r, c, { type: a, color: 'w' });
      break;
    }
  }

  game.turn = 'w';
  game.castling = { wk: false, wq: false, bk: false, bq: false };
  game.enPassantTarget = null;
  game.halfMoveClock = 0;
  game.fullMoveNumber = 1;
  game.result = null;
  game.resultReason = '';

  // 初始不能已将杀/逼和，且白方起手不能已将杀（即黑王未被将军）
  if (isCheckmated(game) || isStalemated(game)) return null;
  if (movegen.isInCheck(game.board, 'b')) return null; // 白先手但黑王已被将军=非法

  const d = searchMate(game, 'w', 9);
  if (d !== targetDist) return null;

  // 序列化为 FEN
  let placement = '';
  for (let r = 0; r < 8; r++) {
    let empty = 0;
    let rowStr = '';
    for (let c = 0; c < 8; c++) {
      const p = game.board.getPiece(r, c);
      if (!p) { empty++; continue; }
      if (empty) { rowStr += empty; empty = 0; }
      const ch = p.type;
      rowStr += (p.color === 'w') ? ch.toUpperCase() : ch;
    }
    if (empty) rowStr += empty;
    placement += (r === 0 ? '' : '/') + rowStr;
  }
  const fen = placement + ' w - - 0 1';
  return { fen, dist: d };
}

function gen() {
  const want = {};
  // 目标分布：2×mate-in-1(1), 3×mate-in-2(3), 3×mate-in-3(5), 1×mate-in-4(7), 1×mate-in-5(9)
  const targets = [1, 1, 3, 3, 3, 5, 5, 5, 7, 9];
  const found = [];
  const byDist = {};
  let iter = 0;
  while (found.length < targets.length && iter < 400000) {
    iter++;
    const t = targets[found.length];
    const res = tryRandom(t);
    if (!res) continue;
    if (byDist[res.dist]) continue; // 每个距离只取一个候选用于调试展示
    byDist[res.dist] = res;
    found.push(res);
    process.stdout.write(`# found dist=${res.dist} fen=${res.fen}\n`);
  }
  process.stdout.write(`\niterations=${iter} found=${found.length}\n`);
  if (found.length) {
    require('fs').writeFileSync(__dirname + '/eg_candidates.json', JSON.stringify(found, null, 2));
  }
}

function check() {
  const list = require('./eg_candidates.json');
  for (const item of list) {
    const game = new ChessGame();
    applyFen(game, item.fen);
    const initBad = isCheckmated(game) || isStalemated(game);
    const d = searchMate(game, 'w', 9);
    process.stdout.write(`fen=${item.fen} initMated=${initBad} forcedMateDist=${d}\n`);
  }
}

const mode = process.argv[2] || 'gen';
if (mode === 'gen') gen();
else if (mode === 'check') check();
else console.log('usage: node tools/gen_endgame.js [gen|check]');
