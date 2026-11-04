/**
 * 走法生成与规则引擎
 * 处理所有棋子走法、特殊规则（易位/吃过路兵/升变）、将军与将杀判定
 */
const { PIECE, COLOR } = require('./constants');
const Board = require('./board');

// 方向向量
const KNIGHT_DELTAS = [
  [-2, -1], [-2, 1], [-1, -2], [-1, 2],
  [1, -2], [1, 2], [2, -1], [2, 1]
];

const KING_DELTAS = [
  [-1, -1], [-1, 0], [-1, 1],
  [0, -1],           [0, 1],
  [1, -1],  [1, 0],  [1, 1]
];

const BISHOP_DIRS = [[-1, -1], [-1, 1], [1, -1], [1, 1]];
const ROOK_DIRS = [[-1, 0], [1, 0], [0, -1], [0, 1]];

/**
 * 生成某方的伪合法走法（不排除送将）
 */
function generatePseudoLegalMoves(board, color, state) {
  const moves = [];
  const pieces = board.getPieces(color);

  for (const { row, col, piece } of pieces) {
    switch (piece.type) {
      case PIECE.PAWN:
        generatePawnMoves(board, row, col, color, state, moves);
        break;
      case PIECE.KNIGHT:
        generatePieceMoves(board, row, col, color, KNIGHT_DELTAS, false, moves);
        break;
      case PIECE.BISHOP:
        generatePieceMoves(board, row, col, color, BISHOP_DIRS, true, moves);
        break;
      case PIECE.ROOK:
        generatePieceMoves(board, row, col, color, ROOK_DIRS, true, moves);
        break;
      case PIECE.QUEEN:
        generatePieceMoves(board, row, col, color, BISHOP_DIRS.concat(ROOK_DIRS), true, moves);
        break;
      case PIECE.KING:
        generatePieceMoves(board, row, col, color, KING_DELTAS, false, moves);
        generateCastlingMoves(board, row, col, color, state, moves);
        break;
    }
  }

  return moves;
}

/**
 * 兵的走法（含吃过路兵、升变）
 */
function generatePawnMoves(board, row, col, color, state, moves) {
  const direction = color === COLOR.WHITE ? -1 : 1;
  const startRow = color === COLOR.WHITE ? 6 : 1;
  const promotionRow = color === COLOR.WHITE ? 0 : 7;

  // 前进一步
  const r1 = row + direction;
  if (Board.inBounds(r1, col) && !board.getPiece(r1, col)) {
    if (r1 === promotionRow) {
      // 升变
      for (const promo of ['q', 'r', 'b', 'n']) {
        moves.push({ fromRow: row, fromCol: col, toRow: r1, toCol: col, promotion: promo });
      }
    } else {
      moves.push({ fromRow: row, fromCol: col, toRow: r1, toCol: col });

      // 前进两步
      const r2 = row + direction * 2;
      if (row === startRow && !board.getPiece(r2, col)) {
        moves.push({ fromRow: row, fromCol: col, toRow: r2, toCol: col, isDoublePush: true });
      }
    }
  }

  // 斜吃
  for (const dc of [-1, 1]) {
    const nc = col + dc;
    if (!Board.inBounds(r1, nc)) continue;

    const target = board.getPiece(r1, nc);
    if (target && target.color !== color) {
      if (r1 === promotionRow) {
        for (const promo of ['q', 'r', 'b', 'n']) {
          moves.push({ fromRow: row, fromCol: col, toRow: r1, toCol: nc, promotion: promo });
        }
      } else {
        moves.push({ fromRow: row, fromCol: col, toRow: r1, toCol: nc });
      }
    }

    // 吃过路兵
    if (state.enPassantTarget &&
        state.enPassantTarget.row === r1 &&
        state.enPassantTarget.col === nc) {
      moves.push({
        fromRow: row, fromCol: col,
        toRow: r1, toCol: nc,
        isEnPassant: true
      });
    }
  }
}

/**
 * 通用棋子走法（马/象/车/后/王）
 */
function generatePieceMoves(board, row, col, color, directions, sliding, moves) {
  for (const [dr, dc] of directions) {
    let r = row + dr;
    let c = col + dc;

    while (Board.inBounds(r, c)) {
      const target = board.getPiece(r, c);

      if (!target) {
        moves.push({ fromRow: row, fromCol: col, toRow: r, toCol: c });
      } else {
        if (target.color !== color) {
          moves.push({ fromRow: row, fromCol: col, toRow: r, toCol: c });
        }
        break; // 无论敌我，滑动棋子到此为止
      }

      if (!sliding) break;
      r += dr;
      c += dc;
    }
  }
}

/**
 * 王车易位
 */
function generateCastlingMoves(board, row, col, color, state, moves) {
  const isWhite = color === COLOR.WHITE;
  const homeRow = isWhite ? 7 : 0;

  // 王必须在原位
  if (row !== homeRow || col !== 4) return;

  // 王不在将军中
  if (isSquareAttacked(board, homeRow, 4, oppositeColor(color))) return;

  // 王翼易位（短易位）
  const kingSideRight = isWhite ? state.castling.wk : state.castling.bk;
  if (kingSideRight) {
    // f, g 列无子
    if (!board.getPiece(homeRow, 5) && !board.getPiece(homeRow, 6)) {
      // 车在原位
      const rook = board.getPiece(homeRow, 7);
      if (rook && rook.type === PIECE.ROOK && rook.color === color) {
        // 王经过的格子不被攻击
        if (!isSquareAttacked(board, homeRow, 5, oppositeColor(color)) &&
            !isSquareAttacked(board, homeRow, 6, oppositeColor(color))) {
          moves.push({ fromRow: row, fromCol: col, toRow: homeRow, toCol: 6, isCastling: true, castlingSide: 'king' });
        }
      }
    }
  }

  // 后翼易位（长易位）
  const queenSideRight = isWhite ? state.castling.wq : state.castling.bq;
  if (queenSideRight) {
    // b, c, d 列无子
    if (!board.getPiece(homeRow, 3) && !board.getPiece(homeRow, 2) && !board.getPiece(homeRow, 1)) {
      const rook = board.getPiece(homeRow, 0);
      if (rook && rook.type === PIECE.ROOK && rook.color === color) {
        if (!isSquareAttacked(board, homeRow, 3, oppositeColor(color)) &&
            !isSquareAttacked(board, homeRow, 2, oppositeColor(color))) {
          moves.push({ fromRow: row, fromCol: col, toRow: homeRow, toCol: 2, isCastling: true, castlingSide: 'queen' });
        }
      }
    }
  }
}

/**
 * 判断指定格子是否被指定颜色攻击
 */
function isSquareAttacked(board, row, col, byColor) {
  const pieces = board.getPieces(byColor);

  for (const { row: r, col: c, piece } of pieces) {
    switch (piece.type) {
      case PIECE.PAWN: {
        const dir = byColor === COLOR.WHITE ? -1 : 1;
        if (r + dir === row && Math.abs(c - col) === 1) return true;
        break;
      }
      case PIECE.KNIGHT: {
        for (const [dr, dc] of KNIGHT_DELTAS) {
          if (r + dr === row && c + dc === col) return true;
        }
        break;
      }
      case PIECE.KING: {
        for (const [dr, dc] of KING_DELTAS) {
          if (r + dr === row && c + dc === col) return true;
        }
        break;
      }
      case PIECE.BISHOP: {
        if (isSlidingAttack(board, r, c, row, col, BISHOP_DIRS)) return true;
        break;
      }
      case PIECE.ROOK: {
        if (isSlidingAttack(board, r, c, row, col, ROOK_DIRS)) return true;
        break;
      }
      case PIECE.QUEEN: {
        if (isSlidingAttack(board, r, c, row, col, BISHOP_DIRS.concat(ROOK_DIRS))) return true;
        break;
      }
    }
  }

  return false;
}

/**
 * 滑动棋子攻击判定
 */
function isSlidingAttack(board, fromR, fromC, toR, toC, directions) {
  for (const [dr, dc] of directions) {
    let r = fromR + dr;
    let c = fromC + dc;

    while (Board.inBounds(r, c)) {
      if (r === toR && c === toC) return true;
      if (board.getPiece(r, c)) break;
      r += dr;
      c += dc;
    }
  }
  return false;
}

/**
 * 获取指定颜色的合法走法（排除送将）
 */
function generateLegalMoves(board, color, state) {
  const pseudoMoves = generatePseudoLegalMoves(board, color, state);
  const legalMoves = [];

  for (const move of pseudoMoves) {
    // 尝试走这步
    const testBoard = board.clone();
    applyMoveToBoard(testBoard, move);

    // 检查己方王是否被将军
    const kingPos = testBoard.findKing(color);
    if (!kingPos || !isSquareAttacked(testBoard, kingPos.row, kingPos.col, oppositeColor(color))) {
      legalMoves.push(move);
    }
  }

  return legalMoves;
}

/**
 * 将走法应用到棋盘上（仅更新棋盘，不更新 state）
 */
function applyMoveToBoard(board, move) {
  const piece = board.getPiece(move.fromRow, move.fromCol);
  if (!piece) return;

  // 吃过路兵：移除被吃掉的兵
  if (move.isEnPassant) {
    const capturedPawnRow = piece.color === COLOR.WHITE ? move.toRow + 1 : move.toRow - 1;
    board.removePiece(capturedPawnRow, move.toCol);
  }

  // 易位：移动车
  if (move.isCastling) {
    const homeRow = piece.color === COLOR.WHITE ? 7 : 0;
    if (move.castlingSide === 'king') {
      board.movePiece(homeRow, 7, homeRow, 5);
    } else {
      board.movePiece(homeRow, 0, homeRow, 3);
    }
  }

  // 移动棋子
  board.movePiece(move.fromRow, move.fromCol, move.toRow, move.toCol);

  // 升变
  if (move.promotion) {
    board.setPiece(move.toRow, move.toCol, { type: move.promotion, color: piece.color });
  }
}

/**
 * 检查某方是否被将军
 */
function isInCheck(board, color) {
  const kingPos = board.findKing(color);
  if (!kingPos) return false;
  return isSquareAttacked(board, kingPos.row, kingPos.col, oppositeColor(color));
}

/**
 * 获取对方颜色
 */
function oppositeColor(color) {
  return color === COLOR.WHITE ? COLOR.BLACK : COLOR.WHITE;
}

module.exports = {
  generatePseudoLegalMoves,
  generateLegalMoves,
  applyMoveToBoard,
  isSquareAttacked,
  isInCheck,
  oppositeColor
};
