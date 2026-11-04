'use strict';
/**
 * 候选局面精细校验：复盘杀线，逐手判定将军/被将/吃子，并打印棋盘
 * 用法：node tools/inspect-candidate.js "<fen>" [n]
 */
const Board = require('../src/core/board');
const movegen = require('../src/core/movegen');
const { COLOR } = require('../src/core/constants');
const { loadFen, findMateLine } = require('../test-endgame');

const fen = process.argv[2];
const n = parseInt(process.argv[3] || '0', 10);

const loaded = loadFen(fen);
if (loaded.error) { console.log('解析失败: ' + loaded.error); process.exit(1); }
const game = loaded.game;
let board = game.board;
let state = { castling: game.castling, enPassantTarget: game.enPassantTarget };
let turn = game.turn;

function dump(b) {
  const rows = [];
  for (let r = 0; r < 8; r++) {
    const row = [];
    for (let c = 0; c < 8; c++) {
      const p = b.getPiece(r, c);
      row.push(p ? (p.color === COLOR.WHITE ? p.type.toUpperCase() : p.type) : '.');
    }
    rows.push((8 - r) + '  ' + row.join(' '));
  }
  return rows.join('\n');
}

console.log('初始局面 ' + fen);
console.log(dump(board));
console.log('白方被将军=' + movegen.isInCheck(board, COLOR.WHITE) +
  ' 黑方被将军=' + movegen.isInCheck(board, COLOR.BLACK));
console.log('');

if (n > 0) {
  const found = findMateLine(board, state, COLOR.WHITE, n);
  console.log('最短强制杀 = ' + found.depth + ' 己方步  (cap=' + n + ')');
  console.log('杀线: ' + found.line.join(' '));
  console.log('');
}

const line = process.argv[4] ? process.argv[4].split(' ') : null;
if (line) {
  line.forEach((uci, i) => {
    const moves = movegen.generateLegalMoves(board, turn, state);
    const from = Board.fromAlgebraic(uci.slice(0, 2));
    const to = Board.fromAlgebraic(uci.slice(2, 4));
    const promo = uci.length > 4 ? uci[4] : null;
    const mv = moves.find(m => m.fromRow === from.row && m.fromCol === from.col &&
      m.toRow === to.row && m.toCol === to.col && (m.promotion || null) === promo);
    if (!mv) { console.log('第 ' + (i + 1) + ' 手 ' + uci + ' 非法'); return; }
    const piece = board.getPiece(mv.fromRow, mv.fromCol);
    const tgt = board.getPiece(mv.toRow, mv.toCol);
    // 应用
    const piece2 = board.getPiece(mv.fromRow, mv.fromCol);
    const next = {
      castling: { ...state.castling },
      enPassantTarget: null
    };
    if (mv.isDoublePush && piece2) next.enPassantTarget = { row: piece2.color === COLOR.WHITE ? mv.toRow + 1 : mv.toRow - 1, col: mv.toCol };
    if (piece2 && piece2.type === 'k') {
      if (piece2.color === COLOR.WHITE) { next.castling.wk = false; next.castling.wq = false; }
      else { next.castling.bk = false; next.castling.bq = false; }
    }
    if (piece2 && piece2.type === 'r') {
      if (piece2.color === COLOR.WHITE) {
        if (mv.fromRow === 7 && mv.fromCol === 0) next.castling.wq = false;
        if (mv.fromRow === 7 && mv.fromCol === 7) next.castling.wk = false;
      } else {
        if (mv.fromRow === 0 && mv.fromCol === 0) next.castling.bq = false;
        if (mv.fromRow === 0 && mv.fromCol === 7) next.castling.bk = false;
      }
    }
    if (mv.toRow === 0 && mv.toCol === 0) next.castling.bq = false;
    if (mv.toRow === 0 && mv.toCol === 7) next.castling.bk = false;
    if (mv.toRow === 7 && mv.toCol === 0) next.castling.wq = false;
    if (mv.toRow === 7 && mv.toCol === 7) next.castling.wk = false;
    movegen.applyMoveToBoard(board, mv);
    state = next;
    const wCheck = movegen.isInCheck(board, COLOR.WHITE);
    const bCheck = movegen.isInCheck(board, COLOR.BLACK);
    const bMoves = movegen.generateLegalMoves(board, COLOR.BLACK, state).length;
    const wMoves = movegen.generateLegalMoves(board, COLOR.WHITE, state).length;
    console.log('第 ' + (i + 1) + ' 手 ' + uci +
      ' [' + (turn === 'w' ? '白' : '黑') + ' ' + piece2.type +
      (tgt ? '×' + tgt.type : '') + (mv.promotion ? '=' + mv.promotion : '') + ']' +
      ' → 黑被将军=' + bCheck + ' 白被将军=' + wCheck +
      ' 黑合法着=' + bMoves + ' 白合法着=' + wMoves +
      (bCheck && bMoves === 0 ? '  ← 将死' : ''));
    console.log(dump(board));
    turn = turn === 'w' ? 'b' : 'w';
  });
}
