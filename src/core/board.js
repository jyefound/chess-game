/**
 * 棋盘状态管理
 * 8x8 棋盘，board[row][col]
 * row 0 = 第8横线（黑方底线），row 7 = 第1横线（白方底线）
 * col 0 = a线，col 7 = h线
 */
const { PIECE, COLOR } = require('./constants');

class Board {
  constructor() {
    this.grid = [];
    this.reset();
  }

  /**
   * 重置为初始局面
   */
  reset() {
    this.grid = Array.from({ length: 8 }, () => Array(8).fill(null));

    // 黑方（上方）
    const backRank = ['r', 'n', 'b', 'q', 'k', 'b', 'n', 'r'];
    for (let c = 0; c < 8; c++) {
      this.grid[0][c] = { type: backRank[c], color: COLOR.BLACK };
      this.grid[1][c] = { type: PIECE.PAWN, color: COLOR.BLACK };
    }

    // 白方（下方）
    for (let c = 0; c < 8; c++) {
      this.grid[6][c] = { type: PIECE.PAWN, color: COLOR.WHITE };
      this.grid[7][c] = { type: backRank[c], color: COLOR.WHITE };
    }
  }

  /**
   * 获取指定位置的棋子
   */
  getPiece(row, col) {
    if (row < 0 || row > 7 || col < 0 || col > 7) return null;
    return this.grid[row][col];
  }

  /**
   * 放置棋子
   */
  setPiece(row, col, piece) {
    if (row < 0 || row > 7 || col < 0 || col > 7) return;
    this.grid[row][col] = piece;
  }

  /**
   * 移除棋子
   */
  removePiece(row, col) {
    if (row < 0 || row > 7 || col < 0 || col > 7) return null;
    const piece = this.grid[row][col];
    this.grid[row][col] = null;
    return piece;
  }

  /**
   * 移动棋子（不处理特殊规则，仅物理移动）
   */
  movePiece(fromRow, fromCol, toRow, toCol) {
    const piece = this.grid[fromRow][fromCol];
    this.grid[toRow][toCol] = piece;
    this.grid[fromRow][fromCol] = null;
  }

  /**
   * 找到指定颜色的王的位置
   */
  findKing(color) {
    for (let r = 0; r < 8; r++) {
      for (let c = 0; c < 8; c++) {
        const p = this.grid[r][c];
        if (p && p.type === PIECE.KING && p.color === color) {
          return { row: r, col: c };
        }
      }
    }
    return null;
  }

  /**
   * 克隆棋盘（用于 AI 搜索）
   */
  clone() {
    const newBoard = new Board();
    for (let r = 0; r < 8; r++) {
      for (let c = 0; c < 8; c++) {
        const p = this.grid[r][c];
        newBoard.grid[r][c] = p ? { type: p.type, color: p.color } : null;
      }
    }
    return newBoard;
  }

  /**
   * 获取所有指定颜色棋子的位置
   */
  getPieces(color) {
    const pieces = [];
    for (let r = 0; r < 8; r++) {
      for (let c = 0; c < 8; c++) {
        const p = this.grid[r][c];
        if (p && (!color || p.color === color)) {
          pieces.push({ row: r, col: c, piece: p });
        }
      }
    }
    return pieces;
  }

  /**
   * 判断位置是否在棋盘内
   */
  static inBounds(row, col) {
    return row >= 0 && row <= 7 && col >= 0 && col <= 7;
  }

  /**
   * 将坐标转为代数记谱（如 e4）
   */
  static toAlgebraic(row, col) {
    return 'abcdefgh'[col] + (8 - row);
  }

  /**
   * 将代数记谱转为坐标
   */
  static fromAlgebraic(str) {
    const col = 'abcdefgh'.indexOf(str[0]);
    const row = 8 - parseInt(str[1]);
    return { row, col };
  }
}

module.exports = Board;
