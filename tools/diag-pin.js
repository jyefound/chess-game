'use strict';
/**
 * 牵制诊断：给定 FEN 与首着，列出「哪些黑子因移动而暴露黑王」（=被牵制）
 * 用法：node tools/diag-pin.js "<fen>" "<first-uci>"
 */
const Board = require('../src/core/board');
const movegen = require('../src/core/movegen');
const { COLOR } = require('../src/core/constants');
const { loadFen } = require('../test-endgame');

const fen = process.argv[2];
const firstUci = process.argv[3];

const loaded = loadFen(fen);
if (loaded.error) { console.log('解析失败: ' + loaded.error); process.exit(1); }
let board = loaded.game.board;
let state = { castling: loaded.game.castling, enPassantTarget: loaded.game.enPassantTarget };

if (firstUci) {
  const moves = movegen.generateLegalMoves(board, COLOR.WHITE, state);
  const from = Board.fromAlgebraic(firstUci.slice(0, 2));
  const to = Board.fromAlgebraic(firstUci.slice(2, 4));
  const promo = firstUci.length > 4 ? firstUci[4] : null;
  const mv = moves.find(m => m.fromRow === from.row && m.fromCol === from.col &&
    m.toRow === to.row && m.toCol === to.col && (m.promotion || null) === promo);
  if (!mv) { console.log('首着非法'); process.exit(1); }
  movegen.applyMoveToBoard(board, mv);
  console.log('首着 ' + firstUci + ' 后：黑被将军=' + movegen.isInCheck(board, COLOR.BLACK));
}

const pseudo = movegen.generatePseudoLegalMoves(board, COLOR.BLACK, state);
const kp = board.findKing(COLOR.BLACK);
console.log('黑王位置 ' + Board.toAlgebraic(kp.row, kp.col));
const pinned = [];
for (const m of pseudo) {
  const mover = board.getPiece(m.fromRow, m.fromCol);
  if (!mover || mover.type === 'k') continue;
  const nb = board.clone();
  movegen.applyMoveToBoard(nb, m);
  const k2 = nb.findKing(COLOR.BLACK);
  if (!k2) continue;
  if (movegen.isSquareAttacked(nb, k2.row, k2.col, COLOR.WHITE)) {
    pinned.push(Board.toAlgebraic(m.fromRow, m.fromCol) + mover.type +
      '→' + Board.toAlgebraic(m.toRow, m.toCol));
  }
}
console.log('被牵制的黑子（移动即暴露黑王）: ' + (pinned.length ? pinned.join(', ') : '无'));
