/**
 * 国际象棋规则边界 / 对局机制回归
 * 运行：node test-mechanics.js
 */
'use strict';

const assert = require('assert');
const ChessGame = require('./src/core/game');
const { createChessEngine } = require('./src/engine/chess');

function play(game, uci) {
  const move = game.findMoveByUci(uci);
  assert.ok(move, '找不到合法走法：' + uci);
  assert.strictEqual(game.makeMove(move), true, '走子失败：' + uci);
}

// 1. 三次重复 / 五十回合是「可申请和棋」，不能自动结束。
const repetition = new ChessGame();
play(repetition, 'e2e4'); // e3 EP 标记存在，但黑方没有可吃过路兵的兵。
const initialAfterE4 = repetition.getPositionKey();
repetition.enPassantTarget = null;
assert.strictEqual(repetition.getPositionKey(), initialAfterE4,
  '无合法吃过路兵时，EP FEN 标记不得改变重复局面特征码');
repetition.enPassantTarget = { row: 5, col: 4 };
for (let cycle = 0; cycle < 2; cycle++) {
  ['g8f6', 'g1f3', 'f6g8', 'f3g1'].forEach(uci => play(repetition, uci));
}
assert.strictEqual(repetition.result, null, '第三次重复应等待玩家申请和棋');
assert.ok(repetition.getClaimableDrawReasons().includes('threefold'), '第三次重复应开放和棋申请');
assert.strictEqual(repetition.claimDraw('threefold'), true, '第三次重复应可成功申请和棋');
assert.strictEqual(repetition.result, 'draw');
assert.strictEqual(repetition.resultReason, 'threefold');

// 2. 五十回合可申请；七十五回合自动和棋。
const fifty = new ChessGame();
fifty.halfMoveClock = 99;
play(fifty, 'g1f3');
assert.strictEqual(fifty.result, null, '第 50 回合不应自动判和');
assert.deepStrictEqual(fifty.getClaimableDrawReasons(), ['fifty_moves']);
assert.strictEqual(fifty.claimDraw('fifty_moves'), true);
assert.strictEqual(fifty.resultReason, 'fifty_moves');

const seventyFive = new ChessGame();
seventyFive.halfMoveClock = 149;
play(seventyFive, 'g1f3');
assert.strictEqual(seventyFive.result, 'draw', '第 75 回合应自动和棋');
assert.strictEqual(seventyFive.resultReason, 'seventyfive_moves');

// 3. 第五次重复自动和棋。
const fivefold = new ChessGame();
for (let cycle = 0; cycle < 4; cycle++) {
  ['g1f3', 'g8f6', 'f3g1', 'f6g8'].forEach(uci => play(fivefold, uci));
}
assert.strictEqual(fivefold.result, 'draw');
assert.strictEqual(fivefold.resultReason, 'fivefold');

// 4. 只有合法 EP 吃子才影响重复局面判定。
const epGame = new ChessGame();
epGame.board.grid = Array.from({ length: 8 }, () => Array(8).fill(null));
epGame.board.setPiece(7, 4, { type: 'k', color: 'w' });
epGame.board.setPiece(0, 4, { type: 'k', color: 'b' });
epGame.board.setPiece(3, 4, { type: 'p', color: 'w' }); // e5
epGame.board.setPiece(3, 3, { type: 'p', color: 'b' }); // d5
epGame.turn = 'w';
epGame.enPassantTarget = { row: 2, col: 3 }; // d6
assert.ok(epGame.getLegalMoves().some(move => move.isEnPassant), '应存在合法 e5xd6 EP');
const withLegalEp = epGame.getPositionKey();
epGame.enPassantTarget = null;
assert.notStrictEqual(epGame.getPositionKey(), withLegalEp,
  '存在合法吃过路兵时，EP 目标格必须参与重复局面判定');

// 5. 同色格象残局为死局；异色格象残局不能直接判死局。
const deadPosition = createChessEngine();
assert.strictEqual(deadPosition.init('4kb2/8/8/8/8/8/8/2B1K3 w - - 0 1'), true);
assert.strictEqual(deadPosition.isGameOver(), true, '同色格象残局应判和');
assert.strictEqual(deadPosition.getWinner(), null);

const oppositeBishops = createChessEngine();
assert.strictEqual(oppositeBishops.init('4k1b1/8/8/8/8/8/8/2B1K3 w - - 0 1'), true);
assert.strictEqual(oppositeBishops.isGameOver(), false, '异色格象不能被简单认定为死局');

// 6. 终局后禁止继续走子；非法外部输入安全返回 false。
const finished = createChessEngine();
finished.init(null);
['f2f3', 'e7e5', 'g2g4', 'd8h4'].forEach(uci => {
  assert.strictEqual(finished.applyMove(finished.uciToMove(uci)), true);
});
assert.strictEqual(finished.isGameOver(), true);
const finalFen = finished.toFen();
assert.strictEqual(finished.applyMove(finished.uciToMove('a7a6')), false,
  '终局后不允许继续走子');
assert.strictEqual(finished.toFen(), finalFen, '终局后的非法操作不能改变棋盘');
assert.strictEqual(finished.applyMove(null), false);
const guarded = new ChessGame();
assert.strictEqual(guarded.makeMove(null), false);
assert.strictEqual(guarded.makeMove({ fromRow: -1, fromCol: 0, toRow: 0, toCol: 0 }), false);

// 7. 引擎适配器向 UI 暴露和棋申请 API。
const claimAdapter = createChessEngine();
assert.strictEqual(claimAdapter.init('4k3/8/8/8/8/8/8/4K2R w - - 99 1'), true);
assert.strictEqual(claimAdapter.applyMove(claimAdapter.uciToMove('h1h2')), true);
assert.deepStrictEqual(claimAdapter.getClaimableDrawReasons(), ['fifty_moves']);
assert.strictEqual(claimAdapter.canClaimDraw(), true);
assert.strictEqual(claimAdapter.claimDraw('fifty_moves'), true);
assert.strictEqual(claimAdapter.isGameOver(), true);

console.log('机制回归测试通过：和棋申请、自动和棋、重复局面、EP、死局、终局保护。');
