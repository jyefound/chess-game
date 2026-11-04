'use strict';
/**
 * 五子棋适配器（占位，待实现）
 *
 * 契约参数（见 ../interface.js）：
 *   cols = 15, rows = 15, gridType = 'intersection'（落子于交叉点）
 *   坐标 (row, col)：row 0 在顶部，col 0 在左；落子即定，无移动。
 *   UCI 记谱建议 'h8h8' 单点风格或短格式，实现时定稿。
 *
 * 待实现：init / getLegalMoves（空点全列或按启发式排序）/ applyMove（无 undo 亦可）/
 *   isGameOver（五连/长连/禁手）/ getWinner / toFen / clone / getPieceAt /
 *   moveToUci / uciToMove。
 */
function createGomokuEngine() {
  throw new Error('not-implemented: gomoku');
}

module.exports = { createGomokuEngine: createGomokuEngine };
