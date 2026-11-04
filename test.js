/**
 * 核心逻辑测试
 */
const ChessGame = require('./src/core/game');
const { COLOR } = require('./src/core/constants');
const { findBestMove } = require('./src/core/ai');

console.log('=== 国际象棋引擎测试 ===\n');

// 测试1：初始局面合法走法数量
const game = new ChessGame();
const moves = game.getLegalMoves();
console.log('1. 初始合法走法数:', moves.length, moves.length === 20 ? '✓' : '✗ (应为20)');

// 测试2：走一步 e4
const e4 = moves.find(m => m.fromRow === 6 && m.fromCol === 4 && m.toRow === 4 && m.toCol === 4);
console.log('2. e4 走法:', e4 ? '✓' : '✗');
game.makeMove(e4);
console.log('3. 走 e4 后轮到:', game.turn === COLOR.BLACK ? '黑方 ✓' : '✗');

// 测试3：走 e5, Nf3
const moves2 = game.getLegalMoves();
const e5 = moves2.find(m => m.fromRow === 1 && m.fromCol === 4 && m.toRow === 3 && m.toCol === 4);
game.makeMove(e5);

const moves3 = game.getLegalMoves();
const nf3 = moves3.find(m => m.fromRow === 7 && m.fromCol === 6 && m.toRow === 5 && m.toCol === 5);
game.makeMove(nf3);
console.log('4. 走 Nf3 后轮到:', game.turn === COLOR.BLACK ? '黑方 ✓' : '✗');

// 测试4：悔棋
game.undoMove();
console.log('5. 悔棋后轮到:', game.turn === COLOR.WHITE ? '白方 ✓' : '✗');

// 测试5：将杀检测（愚人将杀）
const g2 = new ChessGame();
const foolsmate = [
  [6, 5, 4, 5], // f3
  [1, 4, 3, 4], // e5
  [6, 6, 4, 6], // g4
  [0, 3, 4, 7]  // Qh4#
];
let allMovesFound = true;
for (const [fr, fc, tr, tc] of foolsmate) {
  const ms = g2.getLegalMoves();
  const m = ms.find(mv => mv.fromRow === fr && mv.fromCol === fc && mv.toRow === tr && mv.toCol === tc);
  if (m) {
    g2.makeMove(m);
  } else {
    console.log('6. ✗ 找不到走法', fr, fc, '->', tr, tc);
    allMovesFound = false;
    break;
  }
}
if (allMovesFound) {
  console.log('6. 将杀结果:', g2.result === 'black_win' ? '黑方将杀获胜 ✓' : '✗ ' + g2.result + ' ' + g2.resultReason);
  console.log('   SAN 记谱:', g2.moveLog.join(' '));
}

// 测试6：AI 走法
const g3 = new ChessGame();
const state = { castling: g3.castling, enPassantTarget: g3.enPassantTarget };
const aiMove = findBestMove(g3.board, COLOR.WHITE, state, 2);
console.log('7. AI 走法:', aiMove ? '✓' : '✗');

// 测试7：易位（意大利开局后短易位）
const g4 = new ChessGame();
const setupMoves = [[6,4,4,4],[1,4,3,4],[7,6,5,5],[0,1,2,2],[7,5,4,2],[0,6,2,5]];
for (const [fr,fc,tr,tc] of setupMoves) {
  const ms = g4.getLegalMoves();
  const m = ms.find(mv => mv.fromRow===fr && mv.fromCol===fc && mv.toRow===tr && mv.toCol===tc);
  if (m) g4.makeMove(m);
}
const ms = g4.getLegalMoves();
const castleMove = ms.find(mv => mv.isCastling && mv.castlingSide === 'king');
console.log('8. 王翼易位:', castleMove ? '✓ 可用' : '✗ 不可用');

// 测试8：升变
const g5 = new ChessGame();
g5.board.grid = Array.from({length: 8}, () => Array(8).fill(null));
g5.board.setPiece(1, 0, { type: 'p', color: 'w' });
g5.board.setPiece(7, 4, { type: 'k', color: 'w' });
g5.board.setPiece(0, 4, { type: 'k', color: 'b' });
const promoMoves = g5.getLegalMoves().filter(m => m.promotion);
console.log('9. 升变走法数:', promoMoves.length, promoMoves.length === 4 ? '✓ (后/车/象/马)' : '✗');

console.log('\n=== 测试完成 ===');
