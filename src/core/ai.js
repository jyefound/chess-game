/**
 * AI 对手引擎
 * 极小极大搜索 + Alpha-Beta 剪枝 + 位置评估表
 */
const { PIECE, COLOR, PIECE_VALUES, PIECE_TABLES, KING_TABLE_MID, KING_TABLE_END } = require('./constants');
const movegen = require('./movegen');
const Board = require('./board');

/**
 * 评估局面分数（从白方视角）
 */
function evaluate(board) {
  let score = 0;
  let totalMaterial = 0;

  // 计算总子力判断是否进入残局
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const p = board.grid[r][c];
      if (p && p.type !== PIECE.KING) {
        totalMaterial += PIECE_VALUES[p.type];
      }
    }
  }
  const isEndgame = totalMaterial < 2500; // 简单残局判定

  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const p = board.grid[r][c];
      if (!p) continue;

      const value = PIECE_VALUES[p.type];
      let posBonus = 0;

      // 位置评估表
      if (p.type === PIECE.KING) {
        const table = isEndgame ? KING_TABLE_END : KING_TABLE_MID;
        posBonus = p.color === COLOR.WHITE ? table[r][c] : table[7 - r][c];
      } else {
        const table = PIECE_TABLES[p.type];
        posBonus = p.color === COLOR.WHITE ? table[r][c] : table[7 - r][c];
      }

      const total = value + posBonus;

      if (p.color === COLOR.WHITE) {
        score += total;
      } else {
        score -= total;
      }
    }
  }

  return score;
}

/**
 * Alpha-Beta 剪枝搜索
 * @returns {{score: number, move: object|null}}
 */
function alphaBeta(board, depth, alpha, beta, maximizing, state) {
  if (depth === 0) {
    return { score: evaluate(board), move: null };
  }

  const color = maximizing ? COLOR.WHITE : COLOR.BLACK;
  const moves = movegen.generateLegalMoves(board, color, state);

  // 无合法走法：将杀或逼和
  if (moves.length === 0) {
    if (movegen.isInCheck(board, color)) {
      // 被将杀：极大劣势
      return { score: maximizing ? -100000 + (10 - depth) : 100000 - (10 - depth), move: null };
    }
    return { score: 0, move: null }; // 逼和
  }

  // 走法排序（提升剪枝效率）
  moves.sort((a, b) => {
    const aScore = moveOrderingScore(board, a);
    const bScore = moveOrderingScore(board, b);
    return bScore - aScore;
  });

  let bestMove = moves[0];

  if (maximizing) {
    let maxEval = -Infinity;
    for (const move of moves) {
      const testBoard = board.clone();
      movegen.applyMoveToBoard(testBoard, move);
      const newState = updateState(state, move);
      const { score } = alphaBeta(testBoard, depth - 1, alpha, beta, false, newState);

      if (score > maxEval) {
        maxEval = score;
        bestMove = move;
      }
      alpha = Math.max(alpha, score);
      if (beta <= alpha) break;
    }
    return { score: maxEval, move: bestMove };
  } else {
    let minEval = Infinity;
    for (const move of moves) {
      const testBoard = board.clone();
      movegen.applyMoveToBoard(testBoard, move);
      const newState = updateState(state, move);
      const { score } = alphaBeta(testBoard, depth - 1, alpha, beta, true, newState);

      if (score < minEval) {
        minEval = score;
        bestMove = move;
      }
      beta = Math.min(beta, score);
      if (beta <= alpha) break;
    }
    return { score: minEval, move: bestMove };
  }
}

/**
 * 走法排序启发（吃子优先，升变次之）
 */
function moveOrderingScore(board, move) {
  let score = 0;

  // 吃子走法优先
  const target = board.getPiece(move.toRow, move.toCol);
  if (target) {
    score += PIECE_VALUES[target.type] * 10;
  }
  if (move.isEnPassant) {
    score += 800;
  }
  if (move.promotion) {
    score += PIECE_VALUES[move.promotion] * 5;
  }
  if (move.isCastling) {
    score += 300;
  }

  return score;
}

/**
 * 根据走法更新搜索用的状态
 */
function updateState(state, move) {
  const newCastling = { ...state.castling };
  const piece = null; // 需要从 move 中获取

  // 简化：直接复制，实际走法会在 applyMoveToBoard 中处理
  // 但为了搜索正确，需要更新易位权利和吃过路兵
  if (move.isDoublePush) {
    // 简化处理
    return {
      castling: newCastling,
      enPassantTarget: null
    };
  }

  return {
    castling: newCastling,
    enPassantTarget: null
  };
}

/**
 * AI 选择走法
 * @param {Board} board - 当前棋盘
 * @param {string} color - AI 方的颜色
 * @param {object} state - {castling, enPassantTarget}
 * @param {number} depth - 搜索深度
 * @returns {object|null} 最佳走法
 */
function findBestMove(board, color, state, depth) {
  const maximizing = color === COLOR.WHITE;
  const startTime = Date.now();
  const timeLimit = 5000; // 最多思考 5 秒

  // 迭代加深
  let bestMove = null;

  for (let d = 1; d <= depth; d++) {
    const result = alphaBeta(board, d, -Infinity, Infinity, maximizing, state);
    if (result.move) {
      bestMove = result.move;
    }

    // 超时则返回当前最佳
    if (Date.now() - startTime > timeLimit && d >= 2) {
      break;
    }
  }

  // 如果没有找到走法（理论上不应该），从合法走法中随机选一个
  if (!bestMove) {
    const moves = movegen.generateLegalMoves(board, color, state);
    if (moves.length > 0) {
      bestMove = moves[Math.floor(Math.random() * moves.length)];
    }
  }

  return bestMove;
}

// ==================== 分帧可步进搜索（C4） ====================
// 说明：findBestMove() 保留为同步实现，供 test.js 与兜底使用，行为不变。
// createSearch() 新增为「分帧可步进」搜索：gameplay.update() 每帧调用一次 step()，
// 每次 step() 只消耗一帧时间预算（默认 18ms）便把控制权交还渲染循环，UI 保持 ≥20fps，
// 从而消除深度 4 在 weak 机型上 1–5s 的同步假死。搜索用生成器实现「暂停/续跑」，
// 每完成一层迭代加深即提交当前最佳着法，全局时间预算到即用当前最佳。

const now = () => (typeof Date !== 'undefined' && Date.now) ? Date.now() : 0;

// 单帧默认切片（毫秒）。留足渲染余量，保证 ≥20fps（单帧 ≤50ms）。
const SEARCH_FRAME_MS = 18;

// 各深度的全局时间预算上限（困难深度由原 5s 压到合理值）。
function budgetForDepth(depth) {
  const table = { 1: 500, 2: 900, 3: 1600, 4: 2500 };
  return table[depth] || 1600;
}

/**
 * 搜索用状态推进（正确传播易位权与吃过路兵目标，优于同步版 updateState）。
 * move 走子前的棋盘为 boardBefore。
 */
function updateStateForSearch(state, move, boardBefore) {
  const castling = {
    wk: state.castling.wk, wq: state.castling.wq,
    bk: state.castling.bk, bq: state.castling.bq
  };
  const piece = boardBefore.getPiece(move.fromRow, move.fromCol);
  const isWhite = piece && piece.color === COLOR.WHITE;

  // 王移动：丧失双翼易位权
  if (piece && piece.type === PIECE.KING) {
    if (isWhite) { castling.wk = false; castling.wq = false; }
    else { castling.bk = false; castling.bq = false; }
  }
  // 车从原位移动：丧失对应翼
  if (piece && piece.type === PIECE.ROOK) {
    if (move.fromRow === 7 && move.fromCol === 0) castling.wq = false;
    if (move.fromRow === 7 && move.fromCol === 7) castling.wk = false;
    if (move.fromRow === 0 && move.fromCol === 0) castling.bq = false;
    if (move.fromRow === 0 && move.fromCol === 7) castling.bk = false;
  }
  // 车在角格被吃：同样丧失对应翼
  if (move.toRow === 7 && move.toCol === 0) castling.wq = false;
  if (move.toRow === 7 && move.toCol === 7) castling.wk = false;
  if (move.toRow === 0 && move.toCol === 0) castling.bq = false;
  if (move.toRow === 0 && move.toCol === 7) castling.bk = false;

  // 兵双步后设置吃过路兵目标
  let enPassantTarget = null;
  if (move.isDoublePush) {
    enPassantTarget = { row: isWhite ? move.toRow + 1 : move.toRow - 1, col: move.toCol };
  }

  return { castling, enPassantTarget };
}

/**
 * 生成器版 Alpha-Beta：进入每个节点计数，每 16 个节点协作式 yield 一次，
 * 让 createSearch.step() 能按帧预算暂停/续跑，且不需重做已完成的工作。
 */
function* alphaBetaGen(board, depth, alpha, beta, maximizing, state, ctrl) {
  ctrl.nodes++;
  if ((ctrl.nodes & 15) === 0) yield;

  if (depth === 0) {
    return { score: evaluate(board), move: null };
  }

  const color = maximizing ? COLOR.WHITE : COLOR.BLACK;
  const moves = movegen.generateLegalMoves(board, color, state);

  if (moves.length === 0) {
    if (movegen.isInCheck(board, color)) {
      return { score: maximizing ? -100000 + (10 - depth) : 100000 - (10 - depth), move: null };
    }
    return { score: 0, move: null };
  }

  moves.sort((a, b) => moveOrderingScore(board, b) - moveOrderingScore(board, a));
  let bestMove = moves[0];

  if (maximizing) {
    let maxEval = -Infinity;
    for (const move of moves) {
      const newState = updateStateForSearch(state, move, board);
      const testBoard = board.clone();
      movegen.applyMoveToBoard(testBoard, move);
      const { score } = yield* alphaBetaGen(testBoard, depth - 1, alpha, beta, false, newState, ctrl);
      if (score > maxEval) { maxEval = score; bestMove = move; }
      alpha = Math.max(alpha, score);
      if (beta <= alpha) break;
    }
    return { score: maxEval, move: bestMove };
  } else {
    let minEval = Infinity;
    for (const move of moves) {
      const newState = updateStateForSearch(state, move, board);
      const testBoard = board.clone();
      movegen.applyMoveToBoard(testBoard, move);
      const { score } = yield* alphaBetaGen(testBoard, depth - 1, alpha, beta, true, newState, ctrl);
      if (score < minEval) { minEval = score; bestMove = move; }
      beta = Math.min(beta, score);
      if (beta <= alpha) break;
    }
    return { score: minEval, move: bestMove };
  }
}

/**
 * 创建一个分帧可步进的搜索上下文。
 * @param {Board} board - 当前棋盘
 * @param {string} color - AI 方颜色
 * @param {object} state - {castling, enPassantTarget}
 * @param {number} maxDepth - 最大迭代深度
 * @param {number} timeBudgetMs - 全局时间预算（省略则按难度深度取默认）
 * @param {number} sliceMs - 每帧切片（省略则 18ms，保证 UI 流畅）
 * @returns {{step: function, done: boolean, ...}}
 *          step() → {done:boolean, bestMove:object|null, score:number}
 */
function createSearch(board, color, state, maxDepth, timeBudgetMs, sliceMs) {
  const maximizing = color === COLOR.WHITE;
  const maxDepthN = Math.max(1, maxDepth || 3);
  const budget = (typeof timeBudgetMs === 'number' && timeBudgetMs > 0)
    ? timeBudgetMs : budgetForDepth(maxDepthN);
  const slice = (typeof sliceMs === 'number' && sliceMs > 0) ? sliceMs : SEARCH_FRAME_MS;

  const ctx = {
    _board: board,
    _color: color,
    _state: state,
    _maximizing: maximizing,
    _maxDepth: maxDepthN,
    _budget: budget,
    _slice: slice,
    _startTime: now(),
    _currentDepth: 0,   // 已完成的最深迭代层
    _bestMove: null,
    _bestScore: 0,
    _gen: null,
    _ctrl: null,
    done: false
  };

  function startDepth(d) {
    ctx._ctrl = { nodes: 0 };
    ctx._gen = alphaBetaGen(ctx._board, d, -Infinity, Infinity, ctx._maximizing, ctx._state, ctx._ctrl);
  }

  function ensureFallback() {
    if (!ctx._bestMove) {
      try {
        const moves = movegen.generateLegalMoves(ctx._board, ctx._color, ctx._state);
        if (moves.length > 0) ctx._bestMove = moves[Math.floor(Math.random() * moves.length)];
      } catch (e) { /* 兜底静默 */ }
    }
  }

  function snapshot() {
    return { done: ctx.done, bestMove: ctx._bestMove, score: ctx._bestScore };
  }

  ctx.step = function () {
    if (ctx.done) { ensureFallback(); return snapshot(); }

    // 全局时间预算到 → 立即用当前最佳收尾
    if (now() - ctx._startTime >= ctx._budget) {
      ctx.done = true;
      ensureFallback();
      return snapshot();
    }

    // 若当前没有进行中的生成器，开启下一层迭代加深
    if (ctx._gen === null) {
      if (ctx._currentDepth >= ctx._maxDepth) {
        ctx.done = true;
        ensureFallback();
        return snapshot();
      }
      startDepth(ctx._currentDepth + 1);
    }

    const frameStart = now();
    try {
      // 在「单帧切片」与「全局预算」双约束下持续推进生成器
      while (now() - frameStart < ctx._slice && now() - ctx._startTime < ctx._budget) {
        const it = ctx._gen.next();
        if (it.done) {
          // 一层迭代完成：若返回了更优着法则提交
          const r = it.value;
          if (r && r.move) { ctx._bestMove = r.move; ctx._bestScore = r.score; }
          ctx._currentDepth++;
          ctx._gen = null;
          if (ctx._currentDepth >= ctx._maxDepth || now() - ctx._startTime >= ctx._budget) {
            ctx.done = true;
            break;
          }
          // 本帧仍有余量则立即开启下一层；否则留到下一帧
          startDepth(ctx._currentDepth + 1);
        }
        // 未 done：生成器 yield，循环继续推进
      }
    } catch (e) {
      // 生成器异常不阻塞交互：降级为当前最佳
      ctx.done = true;
      ctx._gen = null;
    }

    if (ctx.done) ensureFallback();
    return snapshot();
  };

  // 供同步兜底：一次性跑完剩余搜索（不切片）。
  ctx.finish = function () {
    const prevSlice = ctx._slice;
    ctx._slice = 1e9;
    let guard = 0;
    while (!ctx.done && guard++ < 100000) {
      ctx.step();
      if (guard >= 100000) ctx.done = true;
    }
    ctx._slice = prevSlice;
    ensureFallback();
    return snapshot();
  };

  return ctx;
}

module.exports = {
  evaluate,
  findBestMove,
  alphaBeta,
  createSearch,
  budgetForDepth
};
