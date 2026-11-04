'use strict';
/**
 * 国际象棋适配器（src/engine/interface.js 契约的翻译层）
 *
 * 零改动包装现有 src/core/game.js（ChessGame）+ src/core/movegen.js：
 * 把 movegen 内部走法 {fromRow,fromCol,toRow,toCol,promotion?} 翻译为契约走法
 * {from:[r,c],to:[r,c],promotion?}，并补齐契约要求的 FEN 读写 / clone / getPieceAt。
 *
 * 网格：cols=8, rows=8, gridType='square'。
 * UCI：'e2e4' / 'e7e8q'。列 a-h ↔ col 0-7；行 1-8 ↔ row 7-0（row 0 = 第 8 横线）。
 */
var ChessGame = require('../../core/game');
var Board = require('../../core/board');

// ---------------------------------------------------------------------------
// 走法格式互译
// ---------------------------------------------------------------------------
/** movegen 内部走法 → 契约走法 */
function toContractMove(m) {
  var out = { from: [m.fromRow, m.fromCol], to: [m.toRow, m.toCol] };
  if (m.promotion) out.promotion = m.promotion;
  return out;
}

/** 契约走法 → movegen 内部走法 */
function toInternalMove(m) {
  var out = { fromRow: m.from[0], fromCol: m.from[1], toRow: m.to[0], toCol: m.to[1] };
  if (m.promotion) out.promotion = m.promotion;
  return out;
}

// ---------------------------------------------------------------------------
// FEN 读写（game.js 无 FEN 解析，适配器自行实现；与 START_FEN 六段格式一致）
// ---------------------------------------------------------------------------
var PIECE_LETTERS = 'pnbrqk';

/** FEN → 局面数据；非法返回 null */
function parseFen(fen) {
  if (typeof fen !== 'string') return null;
  var parts = fen.trim().split(/\s+/);
  if (parts.length < 1) return null;

  var ranks = parts[0].split('/');
  if (ranks.length !== 8) return null;

  var grid = [];
  for (var r = 0; r < 8; r++) {
    var row = new Array(8).fill(null);
    var c = 0;
    for (var i = 0; i < ranks[r].length; i++) {
      var ch = ranks[r][i];
      if (ch >= '1' && ch <= '8') {
        c += ch.charCodeAt(0) - 48;
        continue;
      }
      var type = ch.toLowerCase();
      if (PIECE_LETTERS.indexOf(type) < 0) return null;
      if (c > 7) return null;
      row[c] = { type: type, color: ch === type ? 'b' : 'w' };
      c++;
    }
    if (c !== 8) return null;
    grid.push(row);
  }

  var turn = parts[1] === 'b' ? 'b' : 'w';
  var castling = { wk: false, wq: false, bk: false, bq: false };
  var cst = parts[2] || '-';
  if (cst.indexOf('K') >= 0) castling.wk = true;
  if (cst.indexOf('Q') >= 0) castling.wq = true;
  if (cst.indexOf('k') >= 0) castling.bk = true;
  if (cst.indexOf('q') >= 0) castling.bq = true;

  var ep = null;
  if (parts[3] && parts[3] !== '-') {
    var sq = Board.fromAlgebraic(parts[3]);
    if (!Board.inBounds(sq.row, sq.col)) return null;
    ep = { row: sq.row, col: sq.col };
  }

  var half = parseInt(parts[4], 10);
  var full = parseInt(parts[5], 10);
  return {
    grid: grid,
    turn: turn,
    castling: castling,
    enPassantTarget: ep,
    halfMoveClock: isFinite(half) && half >= 0 ? half : 0,
    fullMoveNumber: isFinite(full) && full >= 1 ? full : 1
  };
}

/** 当前局面数据 → FEN */
function buildFen(game) {
  var placement = [];
  for (var r = 0; r < 8; r++) {
    var line = '';
    var empty = 0;
    for (var c = 0; c < 8; c++) {
      var p = game.board.getPiece(r, c);
      if (!p) {
        empty++;
        continue;
      }
      if (empty) { line += empty; empty = 0; }
      line += p.color === 'w' ? p.type.toUpperCase() : p.type;
    }
    if (empty) line += empty;
    placement.push(line);
  }

  var cst = '';
  if (game.castling.wk) cst += 'K';
  if (game.castling.wq) cst += 'Q';
  if (game.castling.bk) cst += 'k';
  if (game.castling.bq) cst += 'q';

  var ep = game.enPassantTarget
    ? Board.toAlgebraic(game.enPassantTarget.row, game.enPassantTarget.col)
    : '-';

  return placement.join('/') + ' ' + game.turn + ' ' + (cst || '-') + ' ' + ep +
         ' ' + game.halfMoveClock + ' ' + game.fullMoveNumber;
}

// ---------------------------------------------------------------------------
// 状态深拷贝（clone 用）
// ---------------------------------------------------------------------------
function cloneGame(src) {
  var dst = new ChessGame();
  dst.board = src.board.clone();
  dst.turn = src.turn;
  dst.castling = { wk: src.castling.wk, wq: src.castling.wq, bk: src.castling.bk, bq: src.castling.bq };
  dst.enPassantTarget = src.enPassantTarget
    ? { row: src.enPassantTarget.row, col: src.enPassantTarget.col }
    : null;
  dst.halfMoveClock = src.halfMoveClock;
  dst.fullMoveNumber = src.fullMoveNumber;
  dst.history = JSON.parse(JSON.stringify(src.history));
  dst.moveLog = src.moveLog.slice();
  dst.uciLog = src.uciLog.slice();
  dst.startFen = src.startFen;
  dst.result = src.result;
  dst.resultReason = src.resultReason;
  dst.positionCounts = new Map(src.positionCounts);
  return dst;
}

// ---------------------------------------------------------------------------
// 引擎工厂
// ---------------------------------------------------------------------------
/** 围绕既有 ChessGame 状态组装契约引擎（createChessEngine / clone 共用） */
function attachEngine(game) {
  return {
    cols: 8,
    rows: 8,
    gridType: 'square',

    /** FEN → 局面；空参重置为初始局面；非法 FEN 返回 false */
    init: function (fen) {
      if (fen === undefined || fen === null || fen === '') {
        game.reset();
        return true;
      }
      var parsed = parseFen(fen);
      if (!parsed) return false;
      game.reset();
      game.board.grid = parsed.grid;
      game.turn = parsed.turn;
      game.castling = parsed.castling;
      game.enPassantTarget = parsed.enPassantTarget;
      game.halfMoveClock = parsed.halfMoveClock;
      game.fullMoveNumber = parsed.fullMoveNumber;
      game.history = [];
      game.moveLog = [];
      game.uciLog = [];
      game.result = null;
      game.resultReason = '';
      game.startFen = fen;
      game.positionCounts = new Map();
      game.positionCounts.set(game.getPositionKey(), 1);
      return true;
    },

    /** 当前合法走法 → 契约走法数组 */
    getLegalMoves: function () {
      return game.getLegalMoves().map(toContractMove);
    },

    /** 执行契约走法（内部经 makeMove 自校验合法性） */
    applyMove: function (move) {
      if (!move || !Array.isArray(move.from) || !Array.isArray(move.to)) return false;
      return game.makeMove(toInternalMove(move));
    },

    /** 撤销一步 */
    undo: function () {
      return game.undoMove();
    },

    /** 终局判定（含未经 makeMove 的合成残局起始即终局） */
    isGameOver: function () {
      if (!game.result) game.checkGameResult();
      return game.result !== null;
    },

    /** 胜方 'w'|'b'|null（和棋/未终局为 null） */
    getWinner: function () {
      if (!game.result) game.checkGameResult();
      if (game.result === 'white_win') return 'w';
      if (game.result === 'black_win') return 'b';
      return null;
    },

    /** 导出 FEN（六段标准格式） */
    toFen: function () {
      return buildFen(game);
    },

    /** 深拷贝独立实例（含悔棋历史） */
    clone: function () {
      return attachEngine(cloneGame(game));
    },

    /** 格上棋子 {type, color} | null */
    getPieceAt: function (rc) {
      if (!Array.isArray(rc)) return null;
      var p = game.board.getPiece(rc[0], rc[1]);
      return p ? { type: p.type, color: p.color } : null;
    },

    /** 契约走法 → UCI（如 'e2e4' / 'e7e8q' / 易位 'e1g1'） */
    moveToUci: function (move) {
      if (!move || !Array.isArray(move.from) || !Array.isArray(move.to)) return '';
      return Board.toAlgebraic(move.from[0], move.from[1]) +
             Board.toAlgebraic(move.to[0], move.to[1]) +
             (move.promotion || '');
    },

    /** UCI → 契约走法（纯语法解析，不校验合法性）；非法返回 null */
    uciToMove: function (str) {
      if (typeof str !== 'string' || str.length < 4) return null;
      var from = Board.fromAlgebraic(str.slice(0, 2));
      var to = Board.fromAlgebraic(str.slice(2, 4));
      if (!Board.inBounds(from.row, from.col) || !Board.inBounds(to.row, to.col)) return null;
      var out = { from: [from.row, from.col], to: [to.row, to.col] };
      if (str.length >= 5 && PIECE_LETTERS.indexOf(str[4]) >= 0) out.promotion = str[4];
      return out;
    }
  };
}

function createChessEngine() {
  return attachEngine(new ChessGame());
}

module.exports = { createChessEngine: createChessEngine };
