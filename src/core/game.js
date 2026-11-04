/**
 * 对局状态管理
 * 管理回合、走子历史、特殊规则状态、胜负判定
 */
const { COLOR, PIECE } = require('./constants');
const Board = require('./board');
const movegen = require('./movegen');

// 标准初始局面 FEN（预留自定义开局：非标准开局时 record.startFen 记录实际 FEN）
const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

class ChessGame {
  constructor() {
    this.board = new Board();
    this.reset();
  }

  /**
   * 重置对局
   */
  reset() {
    this.board.reset();
    this.turn = COLOR.WHITE;
    this.castling = { wk: true, wq: true, bk: true, bq: true };
    this.enPassantTarget = null; // {row, col} 或 null
    this.halfMoveClock = 0;
    this.fullMoveNumber = 1;
    this.history = [];       // 走子历史（用于撤销）
    this.moveLog = [];       // SAN 记谱历史
    this.uciLog = [];        // UCI 记谱历史（与 moveLog 平行，回放真值来源）
    this.startFen = START_FEN; // 起始局面 FEN 常量
    this.result = null;      // null | 'white_win' | 'black_win' | 'draw' | 'stalemate' | 'threefold' | 'fifty_moves'
    this.resultReason = '';

    // 三次重复局面：以「局面特征码」为 key 的出现次数表。
    // 初始局面计 1 次；每次 makeMove 累计新局面，undoMove 回退。
    this.positionCounts = new Map();
    this.positionCounts.set(this.getPositionKey(), 1);
  }

  /**
   * 获取当前走棋方的所有合法走法
   */
  getLegalMoves() {
    return movegen.generateLegalMoves(this.board, this.turn, {
      castling: this.castling,
      enPassantTarget: this.enPassantTarget
    });
  }

  /**
   * 获取指定格子上的棋子的合法走法
   */
  getLegalMovesFor(row, col) {
    return this.getLegalMoves().filter(m => m.fromRow === row && m.fromCol === col);
  }

  /**
   * 执行一步走法
   * @returns {boolean} 是否成功
   */
  makeMove(move) {
    const piece = this.board.getPiece(move.fromRow, move.fromCol);
    if (!piece || piece.color !== this.turn) return false;

    // 验证是否合法
    const legalMoves = this.getLegalMoves();
    const match = legalMoves.find(m =>
      m.fromRow === move.fromRow && m.fromCol === move.fromCol &&
      m.toRow === move.toRow && m.toCol === move.toCol &&
      (m.promotion || null) === (move.promotion || null)
    );
    if (!match) return false;

    // 保存撤销信息
    const undoInfo = {
      move: match,
      castling: { ...this.castling },
      enPassantTarget: this.enPassantTarget ? { ...this.enPassantTarget } : null,
      halfMoveClock: this.halfMoveClock,
      capturedPiece: this.board.getPiece(match.toRow, match.toCol),
      capturedEnPassant: null
    };

    // 如果是吃过路兵，记录被吃的兵
    if (match.isEnPassant) {
      const capturedPawnRow = piece.color === COLOR.WHITE ? match.toRow + 1 : match.toRow - 1;
      undoInfo.capturedEnPassant = {
        row: capturedPawnRow,
        col: match.toCol,
        piece: this.board.getPiece(capturedPawnRow, match.toCol)
      };
    }

    // 记录易位信息
    if (match.isCastling) {
      undoInfo.castlingSide = match.castlingSide;
    }

    // 在修改棋盘前记录吃子信息（用于 SAN 生成）
    const capturedForSAN = match.isEnPassant
      ? this.board.getPiece(piece.color === COLOR.WHITE ? match.toRow + 1 : match.toRow - 1, match.toCol)
      : this.board.getPiece(match.toRow, match.toCol);

    // 更新易位权利
    if (piece.type === PIECE.KING) {
      if (piece.color === COLOR.WHITE) {
        this.castling.wk = false;
        this.castling.wq = false;
      } else {
        this.castling.bk = false;
        this.castling.bq = false;
      }
    }
    if (piece.type === PIECE.ROOK) {
      if (piece.color === COLOR.WHITE) {
        if (match.fromRow === 7 && match.fromCol === 0) this.castling.wq = false;
        if (match.fromRow === 7 && match.fromCol === 7) this.castling.wk = false;
      } else {
        if (match.fromRow === 0 && match.fromCol === 0) this.castling.bq = false;
        if (match.fromRow === 0 && match.fromCol === 7) this.castling.bk = false;
      }
    }
    // 车被吃掉也取消易位权利
    if (match.toRow === 0 && match.toCol === 0) this.castling.bq = false;
    if (match.toRow === 0 && match.toCol === 7) this.castling.bk = false;
    if (match.toRow === 7 && match.toCol === 0) this.castling.wq = false;
    if (match.toRow === 7 && match.toCol === 7) this.castling.wk = false;

    // 更新吃过路兵目标
    if (match.isDoublePush) {
      const epRow = piece.color === COLOR.WHITE ? match.toRow + 1 : match.toRow - 1;
      this.enPassantTarget = { row: epRow, col: match.toCol };
    } else {
      this.enPassantTarget = null;
    }

    // 更新半步计数
    if (piece.type === PIECE.PAWN || undoInfo.capturedPiece || undoInfo.capturedEnPassant) {
      this.halfMoveClock = 0;
    } else {
      this.halfMoveClock++;
    }

    // 应用走法到棋盘
    movegen.applyMoveToBoard(this.board, match);

    // 生成 SAN 记谱
    const san = this.generateSAN(match, piece, capturedForSAN);

    // 生成 UCI 记谱：起始格 + 目标格 + 升变后缀（小写）。
    // 易位记王的两格移动（如 e1g1），吃过路兵记实际落点（如 e5d6），均无需特判。
    const uci = this.moveToUci(match);

    // 保存历史
    this.history.push(undoInfo);
    this.moveLog.push(san);
    this.uciLog.push(uci);

    // 更新回合
    if (this.turn === COLOR.BLACK) {
      this.fullMoveNumber++;
    }
    this.turn = movegen.oppositeColor(this.turn);

    // 累计当前局面（已翻转回合、含最新 castling / ep）出现次数，供三次重复判定
    const posKey = this.getPositionKey();
    this.positionCounts.set(posKey, (this.positionCounts.get(posKey) || 0) + 1);

    // 检查游戏结果
    this.checkGameResult();

    return true;
  }

  /**
   * 走法对象 → UCI 字符串
   */
  moveToUci(move) {
    return Board.toAlgebraic(move.fromRow, move.fromCol) +
           Board.toAlgebraic(move.toRow, move.toCol) +
           (move.promotion || '');
  }

  /**
   * 获取 UCI 记谱历史（回放真值来源）
   */
  getMovesUci() {
    return [...this.uciLog];
  }

  /**
   * 在当前合法走法中查找与给定 UCI 匹配的走法对象
   * @param {string} uci - 如 'e2e4' / 'e7e8q' / 'e1g1'
   * @returns {object|null} 匹配的合法走法（含 promotion / isCastling 等标志）
   */
  findMoveByUci(uci) {
    if (!uci || uci.length < 4) return null;
    const from = Board.fromAlgebraic(uci.slice(0, 2));
    const to = Board.fromAlgebraic(uci.slice(2, 4));
    const promo = uci.length >= 5 ? uci[4] : null;
    if (from.col < 0 || to.col < 0) return null;
    return this.getLegalMoves().find(m =>
      m.fromRow === from.row && m.fromCol === from.col &&
      m.toRow === to.row && m.toCol === to.col &&
      (m.promotion || null) === (promo || null)
    ) || null;
  }

  /**
   * 用 UCI 字符串走一步（供回放重放，含升变匹配）
   * @returns {boolean} 是否成功
   */
  makeMoveByUci(uci) {
    const move = this.findMoveByUci(uci);
    if (!move) return false;
    return this.makeMove(move);
  }

  /**
   * 从 UCI 列表重放到指定步数（0 = 初始局面）。用于回放跳转（跨步不做动画）。
   * 会重置对局并按序重放前 n 步。
   * @param {number} n - 目标半回合数
   * @param {string[]} uciList - 可选外部着法列表（回放页传入 record.movesUci）；
   *                             不传则用本局自身的 uciLog。
   * @returns {number} 实际成功重放的步数
   */
  replayToPly(n, uciList) {
    const source = uciList || this.getMovesUci();
    const target = Math.max(0, Math.min(n, source.length));
    const list = source.slice(0, target);
    this.reset();
    let done = 0;
    for (const uci of list) {
      if (this.makeMoveByUci(uci)) done++;
      else break;
    }
    return done;
  }

  /**
   * 撤销一步
   */
  undoMove() {
    if (this.history.length === 0) return false;

    // 记录「撤销前所在局面」的特征码，撤销完成后将其出现次数 -1。
    // （makeMove 时累计的是落子后的新局面，故撤销即撤销那一次累计）
    const keyBeingLeft = this.getPositionKey();

    const undo = this.history.pop();
    this.moveLog.pop();
    if (this.uciLog.length) this.uciLog.pop();

    const move = undo.move;

    // 还原棋子位置
    const piece = this.board.getPiece(move.toRow, move.toCol);
    // 处理升变还原
    if (move.promotion) {
      this.board.setPiece(move.fromRow, move.fromCol, { type: PIECE.PAWN, color: piece.color });
    } else {
      this.board.setPiece(move.fromRow, move.fromCol, piece);
    }
    this.board.removePiece(move.toRow, move.toCol);

    // 还原被吃掉的棋子
    if (undo.capturedEnPassant) {
      this.board.setPiece(undo.capturedEnPassant.row, undo.capturedEnPassant.col, undo.capturedEnPassant.piece);
    } else if (undo.capturedPiece) {
      this.board.setPiece(move.toRow, move.toCol, undo.capturedPiece);
    }

    // 还原易位的车
    if (move.isCastling) {
      const homeRow = piece.color === COLOR.WHITE ? 7 : 0;
      if (undo.castlingSide === 'king') {
        this.board.movePiece(homeRow, 5, homeRow, 7);
      } else {
        this.board.movePiece(homeRow, 3, homeRow, 0);
      }
    }

    // 还原状态
    this.castling = undo.castling;
    this.enPassantTarget = undo.enPassantTarget;
    this.halfMoveClock = undo.halfMoveClock;

    // 还原回合
    this.turn = movegen.oppositeColor(this.turn);
    if (this.turn === COLOR.BLACK) {
      this.fullMoveNumber--;
    }

    // 修正边界：回退「被撤销那一步所产生的局面」计数，避免三次重复累计残留。
    // history.length===1 时只撤销一次也能正确回退到初始局面（初始计数保持 1）。
    const cnt = this.positionCounts.get(keyBeingLeft) || 0;
    if (cnt <= 1) {
      this.positionCounts.delete(keyBeingLeft);
    } else {
      this.positionCounts.set(keyBeingLeft, cnt - 1);
    }

    this.result = null;
    this.resultReason = '';

    return true;
  }

  /**
   * 检查游戏结果
   */
  checkGameResult() {
    const legalMoves = this.getLegalMoves();
    const inCheck = movegen.isInCheck(this.board, this.turn);

    if (legalMoves.length === 0) {
      if (inCheck) {
        // 将杀
        this.result = this.turn === COLOR.WHITE ? 'black_win' : 'white_win';
        this.resultReason = 'checkmate';
      } else {
        // 逼和
        this.result = 'draw';
        this.resultReason = 'stalemate';
      }
      return;
    }

    // 50 回合规则
    if (this.halfMoveClock >= 100) {
      this.result = 'draw';
      this.resultReason = 'fifty_moves';
      return;
    }

    // 子力不足和棋
    if (this.isInsufficientMaterial()) {
      this.result = 'draw';
      this.resultReason = 'insufficient_material';
      return;
    }

    // 三次重复局面（简化版：基于走子历史长度检查）
    if (this.isThreefoldRepetition()) {
      this.result = 'draw';
      this.resultReason = 'threefold';
    }
  }

  /**
   * 子力不足和棋判定
   */
  isInsufficientMaterial() {
    const whitePieces = this.board.getPieces(COLOR.WHITE);
    const blackPieces = this.board.getPieces(COLOR.BLACK);

    // 只有王
    if (whitePieces.length <= 1 && blackPieces.length <= 1) return true;

    // 王 + 单马/单象 vs 王
    const hasExtra = (pieces) => {
      const nonKing = pieces.filter(p => p.piece.type !== PIECE.KING);
      return nonKing;
    };

    const whiteNonKing = hasExtra(whitePieces);
    const blackNonKing = hasExtra(blackPieces);

    if (whiteNonKing.length === 0 && blackNonKing.length === 0) return true;

    // 一方只有一个马或一个象
    const isSingleMinor = (nonKing) => {
      return nonKing.length === 1 &&
        (nonKing[0].piece.type === PIECE.KNIGHT || nonKing[0].piece.type === PIECE.BISHOP);
    };

    if ((isSingleMinor(whiteNonKing) && blackNonKing.length === 0) ||
        (isSingleMinor(blackNonKing) && whiteNonKing.length === 0)) {
      return true;
    }

    return false;
  }

  /**
   * 三次重复局面判定
   * 依据 positionCounts：局面特征码（含落子方 / 易位权 / 吃过路兵目标）累计出现 ≥3 次即判和。
   * checkGameResult() 在每次 makeMove 累计后调用，此处只需读取当前局面计数。
   */
  isThreefoldRepetition() {
    const key = this.getPositionKey();
    return (this.positionCounts.get(key) || 0) >= 3;
  }

  /**
   * 获取局面特征码（用于重复判定）
   */
  getPositionKey() {
    let key = '';
    for (let r = 0; r < 8; r++) {
      for (let c = 0; c < 8; c++) {
        const p = this.board.getPiece(r, c);
        key += p ? p.color + p.type : '--';
      }
    }
    key += this.turn;
    key += (this.castling.wk ? 'K' : '') + (this.castling.wq ? 'Q' : '') +
           (this.castling.bk ? 'k' : '') + (this.castling.bq ? 'q' : '');
    key += this.enPassantTarget ? this.enPassantTarget.row + ',' + this.enPassantTarget.col : '-';
    return key;
  }

  /**
   * 生成 SAN（标准代数记谱）
   */
  generateSAN(move, piece, capturedPiece) {
    if (move.isCastling) {
      return move.castlingSide === 'king' ? 'O-O' : 'O-O-O';
    }

    let san = '';
    const isCapture = !!capturedPiece || move.isEnPassant;

    if (piece.type === PIECE.PAWN) {
      if (isCapture) {
        san += 'abcdefgh'[move.fromCol] + 'x';
      }
      san += Board.toAlgebraic(move.toRow, move.toCol);
      if (move.promotion) {
        san += '=' + move.promotion.toUpperCase();
      }
    } else {
      san += piece.type.toUpperCase();

      // 歧义消解（简化版）
      const legalMoves = this.getLegalMoves();
      const sameTypeMoves = legalMoves.filter(m =>
        m.toRow === move.toRow && m.toCol === move.toCol &&
        m.fromRow !== move.fromRow && m.fromCol !== move.fromCol
      );
      const samePiece = this.board.getPieces(piece.color).filter(p =>
        p.piece.type === piece.type &&
        !(p.row === move.fromRow && p.col === move.fromCol)
      );

      if (sameTypeMoves.length > 0) {
        const sameFile = sameTypeMoves.some(m => m.fromCol === move.fromCol);
        const sameRank = sameTypeMoves.some(m => m.fromRow === move.fromRow);
        if (!sameFile) {
          san += 'abcdefgh'[move.fromCol];
        } else if (!sameRank) {
          san += (8 - move.fromRow).toString();
        } else {
          san += Board.toAlgebraic(move.fromRow, move.fromCol);
        }
      }

      if (isCapture) san += 'x';
      san += Board.toAlgebraic(move.toRow, move.toCol);
    }

    // 检查/将杀标记
    const testBoard = this.board.clone();
    movegen.applyMoveToBoard(testBoard, move);
    const opponentColor = movegen.oppositeColor(piece.color);
    const opponentLegal = movegen.generateLegalMoves(testBoard, opponentColor, {
      castling: this.castling,
      enPassantTarget: move.isDoublePush ? {
        row: piece.color === COLOR.WHITE ? move.toRow + 1 : move.toRow - 1,
        col: move.toCol
      } : null
    });

    if (movegen.isInCheck(testBoard, opponentColor)) {
      san += opponentLegal.length === 0 ? '#' : '+';
    }

    return san;
  }

  /**
   * 获取当前局面信息
   */
  getStatus() {
    return {
      turn: this.turn,
      result: this.result,
      resultReason: this.resultReason,
      moveNumber: this.fullMoveNumber,
      inCheck: movegen.isInCheck(this.board, this.turn),
      moveLog: [...this.moveLog],
      movesUci: [...this.uciLog],
      halfMoveClock: this.halfMoveClock,
      canUndo: this.history.length > 0
    };
  }
}

module.exports = ChessGame;
