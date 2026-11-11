/**
 * 国际象棋核心冒烟测试
 * 运行：node test.js
 */
'use strict';

const assert = require('assert');
const ChessGame = require('./src/core/game');
const { COLOR } = require('./src/core/constants');
const { findBestMove } = require('./src/core/ai');

function play(game, uci) {
  const move = game.findMoveByUci(uci);
  assert.ok(move, '找不到合法走法：' + uci);
  assert.strictEqual(game.makeMove(move), true, '走子失败：' + uci);
}

const game = new ChessGame();
assert.strictEqual(game.getLegalMoves().length, 20, '初始局面应有 20 个合法走法');
play(game, 'e2e4');
assert.strictEqual(game.turn, COLOR.BLACK, 'e4 后应轮到黑方');
play(game, 'e7e5');
play(game, 'g1f3');
assert.strictEqual(game.turn, COLOR.BLACK, 'Nf3 后应轮到黑方');
assert.strictEqual(game.undoMove(), true, '悔棋应成功');
assert.strictEqual(game.turn, COLOR.WHITE, '撤销 Nf3 后应轮到白方');

const mate = new ChessGame();
['f2f3', 'e7e5', 'g2g4', 'd8h4'].forEach(uci => play(mate, uci));
assert.strictEqual(mate.result, 'black_win', '愚人将杀应判黑胜');
assert.strictEqual(mate.resultReason, 'checkmate', '终局原因为 checkmate');
assert.match(mate.moveLog[mate.moveLog.length - 1], /#$/, 'SAN 应包含将杀标记');

const aiGame = new ChessGame();
const aiMove = findBestMove(aiGame.board, COLOR.WHITE, {
  castling: aiGame.castling,
  enPassantTarget: aiGame.enPassantTarget
}, 2);
assert.ok(aiMove, 'AI 应能从初始局面找到走法');

const castleGame = new ChessGame();
['e2e4', 'e7e5', 'g1f3', 'b8c6', 'f1c4', 'g8f6'].forEach(uci => play(castleGame, uci));
assert.ok(castleGame.getLegalMoves().some(move => move.isCastling && move.castlingSide === 'king'),
  '意大利开局后应允许王翼易位');

const promotionGame = new ChessGame();
promotionGame.board.grid = Array.from({ length: 8 }, () => Array(8).fill(null));
promotionGame.board.setPiece(1, 0, { type: 'p', color: 'w' });
promotionGame.board.setPiece(7, 4, { type: 'k', color: 'w' });
promotionGame.board.setPiece(0, 4, { type: 'k', color: 'b' });
const promotions = promotionGame.getLegalMoves().filter(move => move.promotion);
assert.deepStrictEqual(promotions.map(move => move.promotion).sort(), ['b', 'n', 'q', 'r'],
  '升变应提供后、车、象、马四种选择');

console.log('核心冒烟测试通过：初始走法、回合、悔棋、将杀、AI、易位、升变。');
