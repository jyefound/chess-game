'use strict';
/**
 * 中国象棋适配器（占位，待实现）
 *
 * 契约参数（见 ../interface.js）：
 *   cols = 9, rows = 10, gridType = 'intersection'（落子于交叉点）
 *   坐标 (row, col)：row 0 在顶部（黑方底线），col 0 在左。
 *   UCI 记谱建议 'a0a1' 风格（列 a-i ↔ col 0-8，行 0-9 ↔ row 9-0），实现时定稿。
 *
 * 待实现：init / getLegalMoves / applyMove / undo / isGameOver / getWinner /
 *   toFen / clone / getPieceAt / moveToUci / uciToMove
 * （帅仕相马车炮兵 + 九宫/河界/将帅对脸规则）。
 */
function createXiangqiEngine() {
  throw new Error('not-implemented: xiangqi');
}

module.exports = { createXiangqiEngine: createXiangqiEngine };
