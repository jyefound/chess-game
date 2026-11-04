'use strict';
/**
 * 围棋适配器（占位，待实现）
 *
 * 契约参数（见 ../interface.js）：
 *   cols = 19, rows = 19（可选 9/13 路），gridType = 'intersection'（落子于交叉点）
 *   坐标 (row, col)：row 0 在顶部，col 0 在左。
 *   UCI 记谱建议 'aa'~'ss'（列字母 + 行字母）+ 'pass'，实现时定稿。
 *
 * 待实现：init / getLegalMoves（含虚着 pass）/ applyMove（落子+提子）/ undo /
 *   isGameOver（双方 pass 终局 + 数目）/ getWinner / toFen / clone /
 *   getPieceAt / moveToUci / uciToMove（含打劫/禁入点校验）。
 */
function createGoEngine() {
  throw new Error('not-implemented: go');
}

module.exports = { createGoEngine: createGoEngine };
