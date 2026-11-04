'use strict';
/**
 * 残局局面程序化生成器（EG-05 ~ EG-09）
 *
 * 目标：为每个残局阵找到「最短强制杀（己方步数）恰好 = 目标 N」且初始合法的局面，
 *      并尽量贴合该阵的战术主题（弃子引离 / 连将 / 升变 / 闷宫 / 牵制闪击）。
 *
 * 用法：
 *   node tools/gen-endgames.js              # 依次跑 EG-05 ~ EG-09，各 60 秒
 *   node tools/gen-endgames.js EG-05 120    # 只跑 EG-05，采样 120 秒
 *   node tools/gen-endgames.js EG-05 30 --no-dump   # 不落 JSON
 *
 * 依赖：复用 test-endgame.js 导出的 loadFen / findMateLine（同一套走法生成与搜索语义）
 */

const Board = require('../src/core/board');
const movegen = require('../src/core/movegen');
const { COLOR, PIECE_VALUES } = require('../src/core/constants');
const { loadFen, findMateLine } = require('../test-endgame');

const fs = require('fs');
const path = require('path');

// ---------------------------------------------------------------------------
// 工具
// ---------------------------------------------------------------------------

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hashSeed(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function emptyGrid() {
  return Array.from({ length: 8 }, () => Array(8).fill(null));
}

function cloneGrid(g) {
  const out = new Array(8);
  for (let r = 0; r < 8; r++) {
    out[r] = new Array(8);
    for (let c = 0; c < 8; c++) {
      const p = g[r][c];
      out[r][c] = p ? { type: p.type, color: p.color } : null;
    }
  }
  return out;
}

function boardOf(g) {
  const b = new Board();
  b.grid = cloneGrid(g);
  return b;
}

function freshState() {
  return {
    castling: { wk: false, wq: false, bk: false, bq: false },
    enPassantTarget: null
  };
}

/** grid → FEN（白先，无易位无吃过路兵） */
function gridToFen(g) {
  const ranks = [];
  for (let r = 0; r < 8; r++) {
    let s = '';
    let empty = 0;
    for (let c = 0; c < 8; c++) {
      const p = g[r][c];
      if (!p) { empty++; continue; }
      if (empty) { s += empty; empty = 0; }
      s += p.color === COLOR.WHITE ? p.type.toUpperCase() : p.type;
    }
    if (empty) s += empty;
    ranks.push(s);
  }
  return ranks.join('/') + ' w - - 0 1';
}

function printBoard(g) {
  const out = [];
  for (let r = 0; r < 8; r++) {
    const row = [];
    for (let c = 0; c < 8; c++) {
      const p = g[r][c];
      row.push(p ? (p.color === COLOR.WHITE ? p.type.toUpperCase() : p.type) : '.');
    }
    out.push((8 - r) + '  ' + row.join(' '));
  }
  out.push('   a b c d e f g h');
  return out.join('\n');
}

/** 应用走法并推进 state（与 test-endgame.js 同语义） */
function applyMoveState(board, state, move) {
  const piece = board.getPiece(move.fromRow, move.fromCol);
  const next = {
    castling: {
      wk: state.castling.wk, wq: state.castling.wq,
      bk: state.castling.bk, bq: state.castling.bq
    },
    enPassantTarget: null
  };
  if (move.isDoublePush && piece) {
    next.enPassantTarget = {
      row: piece.color === COLOR.WHITE ? move.toRow + 1 : move.toRow - 1,
      col: move.toCol
    };
  }
  if (piece && piece.type === 'k') {
    if (piece.color === COLOR.WHITE) { next.castling.wk = false; next.castling.wq = false; }
    else { next.castling.bk = false; next.castling.bq = false; }
  }
  if (piece && piece.type === 'r') {
    if (piece.color === COLOR.WHITE) {
      if (move.fromRow === 7 && move.fromCol === 0) next.castling.wq = false;
      if (move.fromRow === 7 && move.fromCol === 7) next.castling.wk = false;
    } else {
      if (move.fromRow === 0 && move.fromCol === 0) next.castling.bq = false;
      if (move.fromRow === 0 && move.fromCol === 7) next.castling.bk = false;
    }
  }
  if (move.toRow === 0 && move.toCol === 0) next.castling.bq = false;
  if (move.toRow === 0 && move.toCol === 7) next.castling.bk = false;
  if (move.toRow === 7 && move.toCol === 0) next.castling.wq = false;
  if (move.toRow === 7 && move.toCol === 7) next.castling.wk = false;
  movegen.applyMoveToBoard(board, move);
  return next;
}

function matchMove(moves, uci) {
  const from = Board.fromAlgebraic(uci.slice(0, 2));
  const to = Board.fromAlgebraic(uci.slice(2, 4));
  const promo = uci.length > 4 ? uci[4] : null;
  for (const m of moves) {
    if (m.fromRow === from.row && m.fromCol === from.col &&
        m.toRow === to.row && m.toCol === to.col &&
        (m.promotion || null) === promo) return m;
  }
  return null;
}

function materialValue(g, color) {
  let v = 0;
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const p = g[r][c];
      if (p && p.color === color && p.type !== 'k') v += PIECE_VALUES[p.type] || 0;
    }
  }
  return v;
}

// ---------------------------------------------------------------------------
// 主题判定（对一条完整杀线做复盘）
// ---------------------------------------------------------------------------

/** 复盘杀线，返回每步的详细信息 + 每步之后的局面快照 */
function replayLine(grid, line) {
  let g = cloneGrid(grid);
  let st = freshState();
  let turn = 'w';
  const steps = [];
  const snaps = [];

  for (const uci of line) {
    const board = boardOf(g);
    const moves = movegen.generateLegalMoves(board, turn, st);
    const m = matchMove(moves, uci);
    if (!m) return null;
    const piece = board.getPiece(m.fromRow, m.fromCol);
    const target = board.getPiece(m.toRow, m.toCol);
    st = applyMoveState(board, st, m);
    g = board.grid;
    const b = boardOf(g);
    steps.push({
      side: turn,
      uci,
      from: { row: m.fromRow, col: m.fromCol },
      to: { row: m.toRow, col: m.toCol },
      movedType: piece ? piece.type : null,
      captured: target ? target.type : null,
      promotion: m.promotion || null,
      blackInCheck: movegen.isInCheck(b, COLOR.BLACK),
      whiteInCheck: movegen.isInCheck(b, COLOR.WHITE)
    });
    snaps.push(cloneGrid(g));
    turn = turn === 'w' ? 'b' : 'w';
  }
  return { steps, snaps };
}

/**
 * 闪击检测：白方两个以上重子在同一瞬间同时攻击黑王所在格
 * 典型形态：后/车/象同时指向黑王，黑王无处可逃
 */
function doubleAttackCount(grid) {
  const b = boardOf(grid);
  const kp = b.findKing(COLOR.BLACK);
  if (!kp) return 0;
  let n = 0;
  for (const { piece } of b.getPieces(COLOR.WHITE)) {
    if (piece.type === 'k') continue;
    if (movegen.isSquareAttacked(b, kp.row, kp.col, COLOR.WHITE)) n++;
  }
  return n;
}

/**
 * 闪击（叉击）检测：白方两子同时攻击同一个黑子（或黑王）
 * 返回被同时攻击的黑子数量
 */
function forkTargets(grid) {
  const b = boardOf(grid);
  const blacks = b.getPieces(COLOR.BLACK);
  const whites = b.getPieces(COLOR.WHITE).filter(w => w.piece.type !== 'k');
  if (whites.length < 2) return 0;
  let forks = 0;
  for (const { row, col, piece } of blacks) {
    let attackers = 0;
    for (const w of whites) {
      if (w.row === row && w.col === col) continue;
      const nb = b.clone();
      const fake = { fromRow: w.row, fromCol: w.col, toRow: row, toCol: col };
      movegen.applyMoveToBoard(nb, fake);
      if (movegen.isSquareAttacked(nb, row, col, COLOR.WHITE)) attackers++;
    }
    if (attackers >= 2) forks++;
  }
  return forks;
}

/** 某黑子（非王）是否被绝对牵制（移动它会暴露黑王） */
function hasPinnedBlackPiece(grid) {
  const b = boardOf(grid);
  const st = freshState();
  const pseudo = movegen.generatePseudoLegalMoves(b, COLOR.BLACK, st);
  for (const m of pseudo) {
    const mover = b.getPiece(m.fromRow, m.fromCol);
    if (!mover || mover.type === 'k') continue; // 只看非王棋子被牵制
    const nb = b.clone();
    movegen.applyMoveToBoard(nb, m);
    const kp = nb.findKing(COLOR.BLACK);
    if (!kp) continue;
    if (movegen.isSquareAttacked(nb, kp.row, kp.col, COLOR.WHITE)) return true;
  }
  return false;
}

/** 黑王被自家子堵住的邻格数量 */
function smotherCount(grid) {
  const b = boardOf(grid);
  const kp = b.findKing(COLOR.BLACK);
  if (!kp) return 0;
  let n = 0;
  for (let dr = -1; dr <= 1; dr++) {
    for (let dc = -1; dc <= 1; dc++) {
      if (dr === 0 && dc === 0) continue;
      const r = kp.row + dr, c = kp.col + dc;
      if (r < 0 || r > 7 || c < 0 || c > 7) continue;
      const p = b.getPiece(r, c);
      if (p && p.color === COLOR.BLACK && p.type !== 'k') n++;
    }
  }
  return n;
}

/**
 * 真·闷杀判定：终局黑王被将、无合法着，且所有可用逃格都被「自家子」占住
 * 返回 { blockedByOwn, coveredByWhite, whiteAdjacent, mate }
 */
function smotherAnalysis(grid) {
  const b = boardOf(grid);
  const kp = b.findKing(COLOR.BLACK);
  if (!kp) return null;
  const inCheck = movegen.isInCheck(b, COLOR.BLACK);
  const legal = movegen.generateLegalMoves(b, COLOR.BLACK, freshState()).length;
  let blockedByOwn = 0, coveredByWhite = 0, whiteAdjacent = 0, openEscape = 0;
  for (let dr = -1; dr <= 1; dr++) {
    for (let dc = -1; dc <= 1; dc++) {
      if (dr === 0 && dc === 0) continue;
      const r = kp.row + dr, c = kp.col + dc;
      if (r < 0 || r > 7 || c < 0 || c > 7) continue;
      const p = b.getPiece(r, c);
      if (p && p.color === COLOR.BLACK && p.type !== 'k') { blockedByOwn++; continue; }
      if (p && p.color === COLOR.WHITE) {
        whiteAdjacent++;
        if (movegen.isSquareAttacked(b, r, c, COLOR.WHITE)) coveredByWhite++;
        continue;
      }
      // 空格：被白方控制 → 白方覆盖；否则是真正逃格
      if (movegen.isSquareAttacked(b, r, c, COLOR.WHITE)) coveredByWhite++;
      else openEscape++;
    }
  }
  return { blockedByOwn, coveredByWhite, whiteAdjacent, openEscape, inCheck, mate: inCheck && legal === 0 };
}

/** 主题检查：返回 { ok, detail, score } */
function checkTheme(id, grid, line, replay) {
  const steps = replay.steps;
  const whiteSteps = steps.filter(s => s.side === 'w');
  const detail = [];

  if (id === 'EG-05') {
    // 弃子引离：首着是弃子（黑方被迫吃掉被送出的子 / 首着后该子被打吃）
    // 偏好：引离的是黑方「护王的兵」，最终以「车沉底线」收官
    const first = whiteSteps[0];
    const reply = steps[1];
    const taken = reply && reply.side === 'b' && reply.captured &&
      reply.to.row === first.to.row && reply.to.col === first.to.col;
    let enPrise = false;
    if (replay.snaps[0]) {
      const b = boardOf(replay.snaps[0]);
      enPrise = movegen.isSquareAttacked(b, first.to.row, first.to.col, COLOR.BLACK);
    }
    const ok = !!(taken || enPrise);
    // 附加特征
    const deflectedType = reply && reply.side === 'b' && reply.captured ? reply.captured : null;
    const lastUci = whiteSteps[whiteSteps.length - 1].uci;
    const rookToBack = /^[a-h][1-8][a-h]8$/.test(lastUci);
    const rookMovedLast = whiteSteps[whiteSteps.length - 1].movedType === 'r';
    // 「引离护王的兵」：被引开的黑子必须是兵，且黑王与该兵相邻
    let pawnGuard = false;
    if (deflectedType === 'p') {
      const b0 = boardOf(grid);
      const kp = b0.findKing(COLOR.BLACK);
      const pawnSq = reply.to;
      if (kp && kingDistance(kp, pawnSq) <= 1) pawnGuard = true;
    }
    detail.push('弃子=' + (taken ? '黑方应着吃掉被送子' : (enPrise ? '首着后被黑打吃' : '无')) +
      ' 被引离子=' + (deflectedType || '无') +
      ' 引离护王兵=' + pawnGuard +
      ' 末着沉车底线=' + (rookMovedLast && rookToBack));
    return {
      ok,
      detail: detail.join(' '),
      score: (taken ? 3 : (enPrise ? 1 : 0)) +
        (pawnGuard ? 5 : 0) +
        (rookMovedLast && rookToBack ? 3 : 0)
    };
  }

  if (id === 'EG-06') {
    // 连将成杀：杀线中连续将军 ≥ 2 次
    const checks = whiteSteps.filter(s => s.blackInCheck).length;
    let consecutive = 0, best = 0;
    for (const s of whiteSteps) {
      if (s.blackInCheck) { consecutive++; best = Math.max(best, consecutive); }
      else consecutive = 0;
    }
    const ok = checks >= 2;
    detail.push('白方将军次数=' + checks + ' 最长连续=' + best);
    return { ok, detail: detail.join(' '), score: checks };
  }

  if (id === 'EG-07') {
    // 升变奇兵：杀线中含兵升变
    const promo = steps.filter(s => s.promotion);
    const ok = promo.length > 0;
    detail.push('升变=' + (promo.length ? promo.map(s => s.uci).join(',') : '无'));
    return { ok, detail: detail.join(' '), score: promo.length ? 2 : 0 };
  }

  if (id === 'EG-08') {
    // 闷宫绝杀：终局黑王被自家子堵住逃生格（真·闷杀：自家子占住逃格）
    const finalGrid = replay.snaps[replay.snaps.length - 1] || grid;
    const preGrid = replay.snaps[replay.snaps.length - 2] || grid;
    const fin = smotherAnalysis(finalGrid) || {};
    const pre = smotherAnalysis(preGrid) || {};
    const ok = !!fin.mate && fin.blockedByOwn >= 1 && fin.openEscape === 0 && pre.blockedByOwn >= 1;
    detail.push('终局闷杀=' + !!fin.mate +
      ' 自家子堵=' + fin.blockedByOwn +
      ' 白覆盖=' + fin.coveredByWhite +
      ' 真逃格=' + fin.openEscape +
      ' 杀前自家子堵=' + pre.blockedByOwn);
    return { ok, detail: detail.join(' '), score: (fin.blockedByOwn || 0) * 3 + (fin.openEscape === 0 ? 2 : 0) };
  }

  if (id === 'EG-09') {
    // 牵制闪击：首着制造牵制（安静着），随后闪击将军
    const first = whiteSteps[0];
    const pinnedBefore = hasPinnedBlackPiece(grid);
    const pinned = hasPinnedBlackPiece(replay.snaps[0] || grid);
    const secondCheck = whiteSteps[1] ? whiteSteps[1].blackInCheck : false;
    const firstIsQuiet = !first.blackInCheck;
    const newPin = pinned && !pinnedBefore;
    const da = replay.snaps[1] ? doubleAttackCount(replay.snaps[1]) : 0;
    const forks = replay.snaps[1] ? forkTargets(replay.snaps[1]) : 0;
    const ok = newPin && secondCheck && firstIsQuiet && (da >= 2 || forks >= 1);
    detail.push('首着前有牵制=' + pinnedBefore +
      ' 首着后有牵制=' + pinned +
      ' 新增牵制=' + newPin +
      ' 首着安静=' + firstIsQuiet +
      ' 第二着闪击将军=' + secondCheck +
      ' 双子攻王=' + da + ' 叉击目标数=' + forks);
    return {
      ok,
      detail: detail.join(' '),
      score: (newPin ? 3 : 0) + (firstIsQuiet ? 2 : 0) + (secondCheck ? 2 : 0) +
        (da >= 2 ? 2 : 0) + (forks >= 1 ? 2 : 0)
    };
  }

  if (id === 'EG-03') {
    // 双车错：白方双车分占两条不同横线（错开），杀线中两车都参与
    const rookRanks = [];
    let rookCount = 0;
    for (let r = 0; r < 8; r++) {
      for (let c = 0; c < 8; c++) {
        const p = grid[r][c];
        if (p && p.color === COLOR.WHITE && p.type === 'r') { rookCount++; rookRanks.push(r); }
      }
    }
    const distinctRanks = new Set(rookRanks).size;
    const bothUsed = whiteSteps.filter(s => s.movedType === 'r').length >= 2;
    const ok = rookCount === 2 && distinctRanks === 2 && bothUsed;
    detail.push('双车=' + (rookCount === 2) +
      ' 分占横线数=' + distinctRanks +
      ' 杀线用车手数=' + whiteSteps.filter(s => s.movedType === 'r').length);
    return {
      ok,
      detail: detail.join(' '),
      score: (rookCount === 2 ? 2 : 0) + (distinctRanks === 2 ? 4 : 0) + (bothUsed ? 2 : 0)
    };
  }

  if (id === 'EG-04') {
    // 马后抽将：杀线中马参与并将军
    const knightSteps = whiteSteps.filter(s => s.movedType === 'n');
    const knightChecks = knightSteps.filter(s => s.blackInCheck);
    const ok = knightChecks.length >= 1;
    detail.push('杀线中马着法=' + knightSteps.length + ' 其中将军=' + knightChecks.length);
    return { ok, detail: detail.join(' '), score: knightChecks.length * 2 + knightSteps.length };
  }

  return { ok: true, detail: '', score: 0 };
}

// ---------------------------------------------------------------------------
// 采样
// ---------------------------------------------------------------------------

const ZONES = {
  corner: (r, c) => (r === 0 || r === 7) && (c === 0 || c === 7),
  edge: (r, c) => r === 0 || r === 7 || c === 0 || c === 7,
  top3: (r, c) => r <= 2,
  top4: (r, c) => r <= 3,
  any: () => true
};

function pickSquare(rng, occupied, predicate) {
  for (let t = 0; t < 400; t++) {
    const r = Math.floor(rng() * 8);
    const c = Math.floor(rng() * 8);
    if (occupied.has(r * 8 + c)) continue;
    if (predicate && !predicate(r, c)) continue;
    return { row: r, col: c };
  }
  return null;
}

function kingDistance(a, b) {
  return Math.max(Math.abs(a.row - b.row), Math.abs(a.col - b.col));
}

/**
 * 闷宫原型采样：黑王在角，黑方自己的子堵住逃生格（马/兵/车卡位），
 * 白方用重子（后/车/象）远程闷杀。
 */
function sampleSmother(rng, cfg) {
  const g = emptyGrid();
  const occ = new Set();
  const mark = (r, c) => occ.add(r * 8 + c);

  const corners = [{ row: 0, col: 0 }, { row: 0, col: 7 }, { row: 7, col: 0 }, { row: 7, col: 7 }];
  const bk = corners[Math.floor(rng() * corners.length)];
  g[bk.row][bk.col] = { type: 'k', color: COLOR.BLACK };
  mark(bk.row, bk.col);

  // 黑王在角上的 3 个逃生格
  const escape = [];
  for (let dr = -1; dr <= 1; dr++) {
    for (let dc = -1; dc <= 1; dc++) {
      if (dr === 0 && dc === 0) continue;
      const r = bk.row + dr, c = bk.col + dc;
      if (r < 0 || r > 7 || c < 0 || c > 7) continue;
      escape.push({ row: r, col: c });
    }
  }

  const blockTypes = ['n', 'n', 'p', 'p', 'r', 'b'];
  const nBlock = 1 + (rng() < 0.75 ? 1 : 0);
  const shuffled = escape.slice().sort(() => rng() - 0.5);
  let placedBlock = 0;
  for (const sq of shuffled) {
    if (placedBlock >= nBlock) break;
    let type = blockTypes[Math.floor(rng() * blockTypes.length)];
    if (type === 'p' && (sq.row === 0 || sq.row === 7)) type = 'n';
    g[sq.row][sq.col] = { type, color: COLOR.BLACK };
    mark(sq.row, sq.col);
    placedBlock++;
  }
  if (placedBlock === 0) return null;

  const wk = pickSquare(rng, occ, (r, c) => kingDistance({ row: r, col: c }, bk) >= 2);
  if (!wk) return null;
  g[wk.row][wk.col] = { type: 'k', color: COLOR.WHITE };
  mark(wk.row, wk.col);

  const heavy = ['q', 'q', 'r', 'r', 'b'];
  const ht = heavy[Math.floor(rng() * heavy.length)];
  const hs = pickSquare(rng, occ, (r, c) => kingDistance({ row: r, col: c }, bk) > 1);
  if (!hs) return null;
  g[hs.row][hs.col] = { type: ht, color: COLOR.WHITE };
  mark(hs.row, hs.col);

  if (rng() < 0.5) {
    const extra = ['n', 'b', 'r', 'p'][Math.floor(rng() * 4)];
    const es = pickSquare(rng, occ, (r, c) => {
      if (extra === 'p' && (r === 0 || r === 7)) return false;
      if (kingDistance({ row: r, col: c }, bk) <= 1) return false;
      if (kingDistance({ row: r, col: c }, wk) <= 1) return false;
      return true;
    });
    if (es) {
      g[es.row][es.col] = { type: extra, color: COLOR.WHITE };
      mark(es.row, es.col);
    }
  }

  return { grid: g, blackKing: bk, whiteKing: wk };
}

/**
 * 弃子引离原型：黑王在角/边，被自己的黑兵护住；
 * 白方以一枚子做诱饵引开护王的兵（或引开护王的子），最后车沉底线收官。
 */
function sampleDecoy(rng, cfg) {
  const g = emptyGrid();
  const occ = new Set();
  const mark = (r, c) => occ.add(r * 8 + c);

  // 黑王在边线，靠一个黑兵护住
  const bkCandidates = [];
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      if (r === 0 || r === 7 || c === 0 || c === 7) bkCandidates.push({ row: r, col: c });
    }
  }
  const bk = bkCandidates[Math.floor(rng() * bkCandidates.length)];
  g[bk.row][bk.col] = { type: 'k', color: COLOR.BLACK };
  mark(bk.row, bk.col);

  // 护王的黑兵：紧邻黑王且在王的前方（row 方向）
  const dirs = [[-1, 0], [1, 0], [0, -1], [0, 1]];
  const d = dirs[Math.floor(rng() * dirs.length)];
  const pr = bk.row + d[0], pc = bk.col + d[1];
  if (pr < 1 || pr > 6) return null;
  g[pr][pc] = { type: 'p', color: COLOR.BLACK };
  mark(pr, pc);

  const wk = pickSquare(rng, occ, (r, c) => kingDistance({ row: r, col: c }, bk) >= 2);
  if (!wk) return null;
  g[wk.row][wk.col] = { type: 'k', color: COLOR.WHITE };
  mark(wk.row, wk.col);

  // 白方：车（沉底线）+ 诱饵子（后/马/象）
  const rookSq = pickSquare(rng, occ, (r, c) => kingDistance({ row: r, col: c }, bk) > 1);
  if (!rookSq) return null;
  g[rookSq.row][rookSq.col] = { type: 'r', color: COLOR.WHITE };
  mark(rookSq.row, rookSq.col);

  const bait = ['q', 'n', 'b', 'q'][Math.floor(rng() * 4)];
  const baitSq = pickSquare(rng, occ, (r, c) => {
    if (kingDistance({ row: r, col: c }, bk) <= 1) return false;
    if (kingDistance({ row: r, col: c }, wk) <= 1) return false;
    return true;
  });
  if (!baitSq) return null;
  g[baitSq.row][baitSq.col] = { type: bait, color: COLOR.WHITE };
  mark(baitSq.row, baitSq.col);

  // 可选：黑方另一个子
  if (rng() < 0.5) {
    const bt = ['n', 'r', 'b', 'p'][Math.floor(rng() * 4)];
    const bs = pickSquare(rng, occ, (r, c) => {
      if (bt === 'p' && (r === 0 || r === 7)) return false;
      if (kingDistance({ row: r, col: c }, wk) <= 1) return false;
      return true;
    });
    if (bs) {
      g[bs.row][bs.col] = { type: bt, color: COLOR.BLACK };
      mark(bs.row, bs.col);
    }
  }

  return { grid: g, blackKing: bk, whiteKing: wk };
}

/**
 * 牵制闪击原型：黑王紧邻一枚黑子（车/马）；
 * 白方一枚重子（后/车/象）在一步之内可「钉住」这枚黑子形成牵制，
 * 另一枚重子负责闪击将军。
 */
function samplePin(rng, cfg) {
  const g = emptyGrid();
  const occ = new Set();
  const mark = (r, c) => occ.add(r * 8 + c);

  // 黑王在边线上
  const edges = [];
  for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) {
    if (r === 0 || r === 7 || c === 0 || c === 7) edges.push({ row: r, col: c });
  }
  const bk = edges[Math.floor(rng() * edges.length)];
  g[bk.row][bk.col] = { type: 'k', color: COLOR.BLACK };
  mark(bk.row, bk.col);

  // 黑子的位置：与黑王同行/同列且相邻（可被沿该线牵制）
  const alongRow = rng() < 0.5;
  const step = rng() < 0.5 ? 1 : -1;
  const sh = alongRow ? 0 : step;
  const sw = alongRow ? step : 0;
  const sr = bk.row + sh, sc = bk.col + sw;
  if (sr < 0 || sr > 7 || sc < 0 || sc > 7) return null;
  const shieldType = ['r', 'n', 'b', 'q'][Math.floor(rng() * 4)];
  g[sr][sc] = { type: shieldType, color: COLOR.BLACK };
  mark(sr, sc);

  const wk = pickSquare(rng, occ, (r, c) => kingDistance({ row: r, col: c }, bk) >= 2);
  if (!wk) return null;
  g[wk.row][wk.col] = { type: 'k', color: COLOR.WHITE };
  mark(wk.row, wk.col);

  // 白方两枚重子：牵制者 + 闪击者
  const pinner = ['b', 'q', 'r'][Math.floor(rng() * 3)];
  const ps = pickSquare(rng, occ, (r, c) => {
    if (kingDistance({ row: r, col: c }, bk) <= 1) return false;
    if (kingDistance({ row: r, col: c }, wk) <= 1) return false;
    return true;
  });
  if (!ps) return null;
  g[ps.row][ps.col] = { type: pinner, color: COLOR.WHITE };
  mark(ps.row, ps.col);

  const striker = ['q', 'r', 'q'][Math.floor(rng() * 3)];
  const ss = pickSquare(rng, occ, (r, c) => {
    if (kingDistance({ row: r, col: c }, bk) <= 1) return false;
    if (kingDistance({ row: r, col: c }, wk) <= 1) return false;
    return true;
  });
  if (!ss) return null;
  g[ss.row][ss.col] = { type: striker, color: COLOR.WHITE };
  mark(ss.row, ss.col);

  // 可选第三方子
  if (rng() < 0.4) {
    const t = ['n', 'b', 'r', 'p'][Math.floor(rng() * 4)];
    const es = pickSquare(rng, occ, (r, c) => {
      if (t === 'p' && (r === 0 || r === 7)) return false;
      if (kingDistance({ row: r, col: c }, bk) <= 1) return false;
      if (kingDistance({ row: r, col: c }, wk) <= 1) return false;
      return true;
    });
    if (es) {
      g[es.row][es.col] = { type: t, color: COLOR.WHITE };
      mark(es.row, es.col);
    }
  }

  return { grid: g, blackKing: bk, whiteKing: wk };
}

/**
 * 采样一个局面
 * cfg: { whiteSets, blackExtras, bkZones, adjacentBlack, pawnRanks, archetype }
 */
function samplePosition(rng, cfg) {
  if (cfg.archetype === 'smother') return sampleSmother(rng, cfg);
  if (cfg.archetype === 'decoy') return sampleDecoy(rng, cfg);
  if (cfg.archetype === 'pin') return samplePin(rng, cfg);
  const g = emptyGrid();
  const occ = new Set();
  const mark = (r, c) => occ.add(r * 8 + c);

  // 黑王
  const zone = ZONES[cfg.bkZones[Math.floor(rng() * cfg.bkZones.length)]];
  const bk = pickSquare(rng, occ, zone);
  if (!bk) return null;
  g[bk.row][bk.col] = { type: 'k', color: COLOR.BLACK };
  mark(bk.row, bk.col);

  // 白王（离黑王至少 2 格）
  const wk = pickSquare(rng, occ, (r, c) => kingDistance({ row: r, col: c }, bk) >= 2);
  if (!wk) return null;
  g[wk.row][wk.col] = { type: 'k', color: COLOR.WHITE };
  mark(wk.row, wk.col);

  // 黑方额外子
  const extras = cfg.blackExtras[Math.floor(rng() * cfg.blackExtras.length)];
  const placedBlack = [];
  for (let i = 0; i < extras.length; i++) {
    const type = extras[i];
    let sq = null;
    if (cfg.adjacentBlack && i === 0) {
      // 贴着黑王放，制造闷宫条件
      sq = pickSquare(rng, occ, (r, c) => {
        if (type === 'p' && (r === 0 || r === 7)) return false;
        return kingDistance({ row: r, col: c }, bk) === 1;
      });
    }
    if (!sq) {
      sq = pickSquare(rng, occ, (r, c) => {
        if (type === 'p' && (r === 0 || r === 7)) return false;
        if (kingDistance({ row: r, col: c }, wk) <= 1) return false;
        return true;
      });
    }
    if (!sq) return null;
    g[sq.row][sq.col] = { type, color: COLOR.BLACK };
    mark(sq.row, sq.col);
    placedBlack.push({ type, sq });
  }

  // 白方子（'k' 代表已在上面放好的白王，跳过）
  const ws = cfg.whiteSets[Math.floor(rng() * cfg.whiteSets.length)];
  for (let i = 0; i < ws.length; i++) {
    const type = ws[i];
    if (type === 'k') continue;
    let sq = null;
    if (type === 'p' && cfg.pawnRanks) {
      const ranks = cfg.pawnRanks;
      sq = pickSquare(rng, occ, (r, c) => {
        if (!ranks.includes(r)) return false;
        if (kingDistance({ row: r, col: c }, bk) <= 1) return false;
        return true;
      });
    }
    if (!sq) {
      sq = pickSquare(rng, occ, (r, c) => {
        if (type === 'p' && (r === 0 || r === 7)) return false;
        if (kingDistance({ row: r, col: c }, bk) <= 1) return false;
        if (kingDistance({ row: r, col: c }, wk) <= 1) return false;
        return true;
      });
    }
    if (!sq) return null;
    g[sq.row][sq.col] = { type, color: COLOR.WHITE };
    mark(sq.row, sq.col);
  }

  return { grid: g, blackKing: bk, whiteKing: wk };
}

/** 与 test-endgame.js 一致的合法性检查 */
function isLegalPosition(grid) {
  const b = boardOf(grid);
  const st = freshState();
  if (movegen.isInCheck(b, COLOR.BLACK)) return false;         // 非走棋方被将军 → 非法
  if (movegen.generateLegalMoves(b, COLOR.WHITE, st).length === 0) return false;
  if (movegen.generateLegalMoves(b, COLOR.BLACK, st).length === 0) return false; // 开局逼和
  return true;
}

/** 用 FEN 复核：确保与校验脚本结论一致 */
function verifyByFen(fen, n) {
  const loaded = loadFen(fen);
  if (loaded.error) return { ok: false, reason: 'parse: ' + loaded.error };
  const game = loaded.game;
  const b = game.board;
  const st = { castling: game.castling, enPassantTarget: game.enPassantTarget };
  if (movegen.isInCheck(b, COLOR.BLACK)) return { ok: false, reason: '黑方被将军' };
  if (movegen.generateLegalMoves(b, COLOR.WHITE, st).length === 0) return { ok: false, reason: '白方无着' };
  if (movegen.generateLegalMoves(b, COLOR.BLACK, st).length === 0) return { ok: false, reason: '黑方逼和' };
  const found = findMateLine(b, st, COLOR.WHITE, n);
  if (found.depth !== n) return { ok: false, reason: 'depth=' + found.depth + ' aborted=' + found.aborted };
  return { ok: true, depth: found.depth, line: found.line };
}

// ---------------------------------------------------------------------------
// 每阵配置
// ---------------------------------------------------------------------------

const CONFIGS = {
  'EG-03': {
    n: 2,
    whiteSets: [['k', 'r', 'r']],
    blackExtras: [[], ['p'], ['p', 'p'], ['n'], ['b'], ['r']],
    bkZones: ['any', 'any', 'edge', 'corner', 'top4'],
    adjacentBlack: false
  },
  'EG-04': {
    n: 2,
    whiteSets: [['k', 'r', 'n'], ['k', 'n', 'n'], ['k', 'r', 'n', 'p'], ['k', 'q', 'n']],
    blackExtras: [['p', 'p', 'p'], ['p', 'p'], ['n'], ['p'], ['b']],
    bkZones: ['corner', 'corner', 'edge', 'top3'],
    adjacentBlack: false
  },
  'EG-05': {
    n: 2,
    archetype: 'decoy',
    whiteSets: [['k', 'r', 'q'], ['k', 'r', 'n'], ['k', 'r', 'b'], ['k', 'r', 'p']],
    blackExtras: [['p'], ['p', 'p'], ['n'], ['p', 'n'], ['r'], ['b']],
    bkZones: ['corner', 'corner', 'edge', 'top3'],
    adjacentBlack: false
  },
  'EG-06': {
    n: 3,
    whiteSets: [['k', 'q', 'r'], ['k', 'q', 'r'], ['k', 'q', 'r'], ['k', 'q', 'n'], ['k', 'r', 'r']],
    blackExtras: [[], ['p'], ['p', 'p'], ['n'], ['b'], ['r'], ['p', 'n'], ['b', 'p']],
    bkZones: ['any', 'any', 'edge', 'top4', 'corner'],
    adjacentBlack: false
  },
  'EG-07': {
    n: 3,
    whiteSets: [['k', 'p', 'q'], ['k', 'p', 'r'], ['k', 'p', 'n'], ['k', 'p', 'b'], ['k', 'p', 'p', 'q'], ['k', 'p', 'q', 'r']],
    blackExtras: [[], ['p'], ['p', 'p'], ['n'], ['r'], ['b'], ['p', 'n']],
    bkZones: ['any', 'any', 'edge', 'top4'],
    pawnRanks: [1, 2, 3],
    adjacentBlack: false
  },
  'EG-08': {
    n: 3,
    archetype: 'smother',
    whiteSets: [['k', 'q'], ['k', 'q', 'n'], ['k', 'r', 'q'], ['k', 'q', 'b'], ['k', 'q', 'r']],
    blackExtras: [['p', 'p'], ['n', 'p'], ['r', 'p'], ['b', 'p'], ['n', 'n'], ['p', 'p', 'p'], ['r', 'r']],
    bkZones: ['corner', 'corner', 'edge', 'top3'],
    adjacentBlack: true
  },
  'EG-09': {
    n: 3,
    archetype: 'pin',
    whiteSets: [['k', 'q', 'b'], ['k', 'q', 'r'], ['k', 'q', 'n'], ['k', 'r', 'b'], ['k', 'q', 'q']],
    blackExtras: [['p'], ['n'], ['r'], ['b'], ['p', 'p'], ['n', 'p'], ['r', 'n'], ['q']],
    bkZones: ['any', 'any', 'edge', 'top4'],
    adjacentBlack: false
  }
};

// ---------------------------------------------------------------------------
// 主循环
// ---------------------------------------------------------------------------

function searchFor(id, seconds) {
  const cfg = CONFIGS[id];
  const rng = mulberry32(hashSeed(id + ':' + cfg.n));
  const deadline = Date.now() + seconds * 1000;
  const hits = [];
  let sampled = 0;
  let legalCount = 0;

  while (Date.now() < deadline) {
    sampled++;
    const pos = samplePosition(rng, cfg);
    if (!pos) continue;
    if (!isLegalPosition(pos.grid)) continue;
    legalCount++;

    const b = boardOf(pos.grid);
    const st = freshState();
    const found = findMateLine(b, st, COLOR.WHITE, cfg.n);
    if (found.depth !== cfg.n) continue;

    const fen = gridToFen(pos.grid);
    const replay = replayLine(pos.grid, found.line);
    if (!replay) continue;
    const theme = checkTheme(id, pos.grid, found.line, replay);
    const wMat = materialValue(pos.grid, COLOR.WHITE);
    const bMat = materialValue(pos.grid, COLOR.BLACK);

    hits.push({
      id,
      n: cfg.n,
      fen,
      depth: found.depth,
      line: found.line.slice(),
      themeOk: theme.ok,
      themeDetail: theme.detail,
      themeScore: theme.score,
      whiteMaterial: wMat,
      blackMaterial: bMat,
      blackKing: Board.toAlgebraic(pos.blackKing.row, pos.blackKing.col),
      whiteKing: Board.toAlgebraic(pos.whiteKing.row, pos.whiteKing.col),
      board: printBoard(pos.grid)
    });
  }

  // 主题优先 → 白方子力优势 → 子力差
  hits.sort((a, b2) =>
    (b2.themeOk - a.themeOk) ||
    (b2.themeScore - a.themeScore) ||
    ((b2.whiteMaterial - b2.blackMaterial) - (a.whiteMaterial - a.blackMaterial)) ||
    (b2.whiteMaterial - a.whiteMaterial)
  );
  return { hits, sampled, legalCount };
}

function main() {
  const argv = process.argv.slice(2);
  const only = argv.find(a => /^EG-\d{2}$/.test(a));
  const secArg = argv.find(a => /^\d+$/.test(a));
  const seconds = secArg ? parseInt(secArg, 10) : 60;
  const doDump = !argv.includes('--no-dump');
  const ids = only ? [only] : ['EG-05', 'EG-06', 'EG-07', 'EG-08', 'EG-09'];

  const all = {};
  for (const id of ids) {
    const t0 = Date.now();
    const res = searchFor(id, seconds);
    all[id] = res.hits;
    const good = res.hits.filter(h => h.themeOk);
    console.log('[' + id + '] 目标 ' + CONFIGS[id].n + ' 步 | 采样 ' + res.sampled +
      ' 合法 ' + res.legalCount + ' 命中 ' + res.hits.length + ' 主题命中 ' + good.length +
      ' | 用时 ' + ((Date.now() - t0) / 1000).toFixed(1) + 's');
    for (const h of res.hits.slice(0, 8)) {
      const verify = verifyByFen(h.fen, h.n);
      console.log('   ' + (h.themeOk ? '★' : ' ') + ' ' + h.fen +
        ' | 主题: ' + h.themeDetail +
        ' | 杀线: ' + h.line.join(' ') +
        ' | 子力 w' + h.whiteMaterial + '/b' + h.blackMaterial +
        ' | FEN复核: ' + (verify.ok ? 'OK depth=' + verify.depth : '✗ ' + verify.reason));
    }
    console.log('');
    all[id] = res.hits;
  }

  if (doDump) {
    const out = path.join(__dirname, 'endgame-candidates.json');
    let merged = {};
    if (fs.existsSync(out)) {
      try { merged = JSON.parse(fs.readFileSync(out, 'utf8')); } catch (e) { merged = {}; }
    }
    for (const id of ids) merged[id] = all[id];
    fs.writeFileSync(out, JSON.stringify(merged, null, 2));
    console.log('候选已写入 ' + out);
  }
}

if (require.main === module) main();

module.exports = { searchFor, gridToFen, verifyByFen, CONFIGS };
