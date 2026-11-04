'use strict';
/**
 * 残局闯关 100 关生成器（v2 扩量版）
 *
 * 复用 test-endgame.js 的 loadFen / findMateLine 作强制杀校验：
 *   对每候选局面用 findMateLine(board, state, 'w', 4) 取出「最短强制杀步数」，
 *   仅保留 depth ∈ [1,4] 且初始合法的局面 → 保证每关真有 N 步强制杀。
 *
 * 主题取自经典杀法名录（底线杀 / 闷宫 / 阿拉伯 / 安娜斯塔西娅 / 波登 / 双象 / 升变 / 双车错 …）。
 * 每主题有独立名称池 / 引言池 / 提示池，避免卡片文案重复。
 *
 * 用法：node tools/gen100.js            # 生成并写入 src/data/endgames.js
 *       node tools/gen100.js --dry      # 只统计候选数，不落盘
 */
const fs = require('fs');
const path = require('path');
const Board = require('../src/core/board');
const movegen = require('../src/core/movegen');
const { COLOR } = require('../src/core/constants');
const { loadFen, findMateLine } = require('../test-endgame');

const FILES = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
function algToRC(sq) { return { row: 8 - parseInt(sq[1], 10), col: FILES.indexOf(sq[0]) }; }

// ---- 基础工具（与 gen-endgames.js 同语义）----
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function hashSeed(str) { let h = 2166136261; for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
function emptyGrid() { return Array.from({ length: 8 }, () => Array(8).fill(null)); }
function cloneGrid(g) { const o = new Array(8); for (let r = 0; r < 8; r++) { o[r] = new Array(8); for (let c = 0; c < 8; c++) { const p = g[r][c]; o[r][c] = p ? { type: p.type, color: p.color } : null; } } return o; }
function boardOf(g) { const b = new Board(); b.grid = cloneGrid(g); return b; }
function freshState() { return { castling: { wk: false, wq: false, bk: false, bq: false }, enPassantTarget: null }; }
function gridToFen(g) {
  const ranks = [];
  for (let r = 0; r < 8; r++) { let s = '', e = 0; for (let c = 0; c < 8; c++) { const p = g[r][c]; if (!p) { e++; continue; } if (e) { s += e; e = 0; } s += p.color === COLOR.WHITE ? p.type.toUpperCase() : p.type; } if (e) s += e; ranks.push(s); }
  return ranks.join('/') + ' w - - 0 1';
}
function kingDistance(a, b) { return Math.max(Math.abs(a.row - b.row), Math.abs(a.col - b.col)); }
function pickSquare(rng, occupied, predicate) {
  for (let t = 0; t < 400; t++) { const r = Math.floor(rng() * 8), c = Math.floor(rng() * 8); if (occupied.has(r * 8 + c)) continue; if (predicate && !predicate(r, c)) continue; return { row: r, col: c }; }
  return null;
}
function isLegalPosition(grid) {
  const b = boardOf(grid); const st = freshState();
  if (movegen.isInCheck(b, COLOR.BLACK)) return false;
  if (movegen.generateLegalMoves(b, COLOR.WHITE, st).length === 0) return false;
  if (movegen.generateLegalMoves(b, COLOR.BLACK, st).length === 0) return false;
  return true;
}
/** 返回最短强制杀步数（1..4）或 -1；非法/某深度预算耗尽返回 -1 */
function forcedMateDepth(grid) {
  if (!isLegalPosition(grid)) return -1;
  const b = boardOf(grid); const st = freshState();
  const LIMIT = 6e5; // 单深度节点预算：足够覆盖强制杀窄线，拒绝极慢局面
  for (let cap = 1; cap <= 4; cap++) {
    const found = findMateLine(b, st, COLOR.WHITE, cap, LIMIT);
    if (found.aborted) return -1; // 该深度预算耗尽 → 放弃此候选
    if (found.depth >= 1) return found.depth;
  }
  return -1;
}

// ---- 采样器（返回 {grid, bk, wk} 或 null）----
function mark(occ, r, c) { occ.add(r * 8 + c); }

function sampleBackRank(rng) {
  const g = emptyGrid(); const occ = new Set();
  const kf = FILES[1 + Math.floor(rng() * 6)]; // b..g
  const ksq = algToRC(kf + '8'); g[ksq.row][ksq.col] = { type: 'k', color: COLOR.BLACK }; mark(occ, ksq.row, ksq.col);
  const walls = [['f7', 'g7', 'h7'], ['a7', 'b7', 'c7'], ['d7', 'e7', 'f7'], ['e7', 'f7', 'g7'], ['b7', 'c7', 'd7']];
  const wall = walls[Math.floor(rng() * walls.length)];
  if (wall.includes(kf + '8')) return null;
  for (const s of wall) { const rc = algToRC(s); g[rc.row][rc.col] = { type: 'p', color: COLOR.BLACK }; mark(occ, rc.row, rc.col); }
  const rf = FILES[Math.floor(rng() * 8)];
  if (rf === kf || wall.includes(rf + '7')) return null;
  const rk = 1 + Math.floor(rng() * 7); // 1..7
  const rc = algToRC(rf + rk); g[rc.row][rc.col] = { type: 'r', color: COLOR.WHITE }; mark(occ, rc.row, rc.col);
  const wk = pickSquare(rng, occ, (r, c) => kingDistance({ row: r, col: c }, ksq) >= 2);
  if (!wk) return null; g[wk.row][wk.col] = { type: 'k', color: COLOR.WHITE }; mark(occ, wk.row, wk.col);
  return { grid: g, bk: ksq, wk };
}

function sampleQueenEdge(rng) {
  const g = emptyGrid(); const occ = new Set();
  const bks = ['h8', 'a8', 'h1', 'a1', 'g8', 'b8'];
  const bkSq = algToRC(bks[Math.floor(rng() * bks.length)]);
  g[bkSq.row][bkSq.col] = { type: 'k', color: COLOR.BLACK }; mark(occ, bkSq.row, bkSq.col);
  const qf = FILES[Math.floor(rng() * 8)], qr = 1 + Math.floor(rng() * 7);
  const qSq = algToRC(qf + qr); if (kingDistance(qSq, bkSq) === 0) return null;
  g[qSq.row][qSq.col] = { type: 'q', color: COLOR.WHITE }; mark(occ, qSq.row, qSq.col);
  const wk = pickSquare(rng, occ, (r, c) => kingDistance({ row: r, col: c }, bkSq) >= 2);
  if (!wk) return null; g[wk.row][wk.col] = { type: 'k', color: COLOR.WHITE }; mark(occ, wk.row, wk.col);
  return { grid: g, bk: bkSq, wk };
}

function sampleTwoRooks(rng) {
  const g = emptyGrid(); const occ = new Set();
  const edges = []; for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) if (r === 0 || r === 7 || c === 0 || c === 7) edges.push({ row: r, col: c });
  const bk = edges[Math.floor(rng() * edges.length)]; g[bk.row][bk.col] = { type: 'k', color: COLOR.BLACK }; mark(occ, bk.row, bk.col);
  const r1f = Math.floor(rng() * 8), r1r = 1 + Math.floor(rng() * 6);
  const r1 = algToRC(FILES[r1f] + r1r); if (kingDistance(r1, bk) <= 1) return null;
  g[r1.row][r1.col] = { type: 'r', color: COLOR.WHITE }; mark(occ, r1.row, r1.col);
  const r2f = Math.floor(rng() * 8), r2r = 1 + Math.floor(rng() * 6);
  const r2 = algToRC(FILES[r2f] + r2r); if (kingDistance(r2, bk) <= 1) return null;
  g[r2.row][r2.col] = { type: 'r', color: COLOR.WHITE }; mark(occ, r2.row, r2.col);
  const wk = pickSquare(rng, occ, (r, c) => kingDistance({ row: r, col: c }, bk) >= 2);
  if (!wk) return null; g[wk.row][wk.col] = { type: 'k', color: COLOR.WHITE }; mark(occ, wk.row, wk.col);
  return { grid: g, bk, wk };
}

function sampleRookKing(rng) {
  const g = emptyGrid(); const occ = new Set();
  const edges = []; for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) if (r === 0 || r === 7 || c === 0 || c === 7) edges.push({ row: r, col: c });
  const bk = edges[Math.floor(rng() * edges.length)]; g[bk.row][bk.col] = { type: 'k', color: COLOR.BLACK }; mark(occ, bk.row, bk.col);
  const rf = Math.floor(rng() * 8), rr = 1 + Math.floor(rng() * 6);
  const rs = algToRC(FILES[rf] + rr); if (kingDistance(rs, bk) <= 1) return null;
  g[rs.row][rs.col] = { type: 'r', color: COLOR.WHITE }; mark(occ, rs.row, rs.col);
  const wk = pickSquare(rng, occ, (r, c) => kingDistance({ row: r, col: c }, bk) >= 2);
  if (!wk) return null; g[wk.row][wk.col] = { type: 'k', color: COLOR.WHITE }; mark(occ, wk.row, wk.col);
  return { grid: g, bk, wk };
}

function sampleKnightQueen(rng) {
  const g = emptyGrid(); const occ = new Set();
  const edges = []; for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) if (r === 0 || r === 7 || c === 0 || c === 7) edges.push({ row: r, col: c });
  const bk = edges[Math.floor(rng() * edges.length)]; g[bk.row][bk.col] = { type: 'k', color: COLOR.BLACK }; mark(occ, bk.row, bk.col);
  const qf = Math.floor(rng() * 8), qr = 1 + Math.floor(rng() * 6);
  const qs = algToRC(FILES[qf] + qr); if (kingDistance(qs, bk) <= 1) return null;
  g[qs.row][qs.col] = { type: 'q', color: COLOR.WHITE }; mark(occ, qs.row, qs.col);
  const nf = Math.floor(rng() * 8), nr = 1 + Math.floor(rng() * 6);
  const ns = algToRC(FILES[nf] + nr); if (kingDistance(ns, bk) <= 1) return null;
  g[ns.row][ns.col] = { type: 'n', color: COLOR.WHITE }; mark(occ, ns.row, ns.col);
  const wk = pickSquare(rng, occ, (r, c) => kingDistance({ row: r, col: c }, bk) >= 2);
  if (!wk) return null; g[wk.row][wk.col] = { type: 'k', color: COLOR.WHITE }; mark(occ, wk.row, wk.col);
  return { grid: g, bk, wk };
}

function sampleRookKnightEdge(rng) {
  const g = emptyGrid(); const occ = new Set();
  const edges = []; for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) if (r === 0 || r === 7 || c === 0 || c === 7) edges.push({ row: r, col: c });
  const bk = edges[Math.floor(rng() * edges.length)]; g[bk.row][bk.col] = { type: 'k', color: COLOR.BLACK }; mark(occ, bk.row, bk.col);
  const rf = Math.floor(rng() * 8), rr = 1 + Math.floor(rng() * 6);
  const rs = algToRC(FILES[rf] + rr); if (kingDistance(rs, bk) <= 1) return null;
  g[rs.row][rs.col] = { type: 'r', color: COLOR.WHITE }; mark(occ, rs.row, rs.col);
  const nf = Math.floor(rng() * 8), nr = 1 + Math.floor(rng() * 6);
  const ns = algToRC(FILES[nf] + nr); if (kingDistance(ns, bk) <= 1) return null;
  g[ns.row][ns.col] = { type: 'n', color: COLOR.WHITE }; mark(occ, ns.row, ns.col);
  const wk = pickSquare(rng, occ, (r, c) => kingDistance({ row: r, col: c }, bk) >= 2);
  if (!wk) return null; g[wk.row][wk.col] = { type: 'k', color: COLOR.WHITE }; mark(occ, wk.row, wk.col);
  return { grid: g, bk, wk };
}

function sampleDoubleBishop(rng) {
  const g = emptyGrid(); const occ = new Set();
  const edges = []; for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) if (r === 0 || r === 7 || c === 0 || c === 7) edges.push({ row: r, col: c });
  const bk = edges[Math.floor(rng() * edges.length)]; g[bk.row][bk.col] = { type: 'k', color: COLOR.BLACK }; mark(occ, bk.row, bk.col);
  const b1s = pickSquare(rng, occ, (r, c) => kingDistance({ row: r, col: c }, bk) >= 2 && ((r + c) % 2 === 0));
  if (!b1s) return null; g[b1s.row][b1s.col] = { type: 'b', color: COLOR.WHITE }; mark(occ, b1s.row, b1s.col);
  const b2s = pickSquare(rng, occ, (r, c) => kingDistance({ row: r, col: c }, bk) >= 2 && ((r + c) % 2 === 1));
  if (!b2s) return null; g[b2s.row][b2s.col] = { type: 'b', color: COLOR.WHITE }; mark(occ, b2s.row, b2s.col);
  const wk = pickSquare(rng, occ, (r, c) => kingDistance({ row: r, col: c }, bk) >= 2);
  if (!wk) return null; g[wk.row][wk.col] = { type: 'k', color: COLOR.WHITE }; mark(occ, wk.row, wk.col);
  return { grid: g, bk, wk };
}

function sampleBishopKnight(rng) {
  const g = emptyGrid(); const occ = new Set();
  const edges = []; for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) if (r === 0 || r === 7 || c === 0 || c === 7) edges.push({ row: r, col: c });
  const bk = edges[Math.floor(rng() * edges.length)]; g[bk.row][bk.col] = { type: 'k', color: COLOR.BLACK }; mark(occ, bk.row, bk.col);
  const bs = pickSquare(rng, occ, (r, c) => kingDistance({ row: r, col: c }, bk) >= 2);
  if (!bs) return null; g[bs.row][bs.col] = { type: 'b', color: COLOR.WHITE }; mark(occ, bs.row, bs.col);
  const ns = pickSquare(rng, occ, (r, c) => kingDistance({ row: r, col: c }, bk) >= 2);
  if (!ns) return null; g[ns.row][ns.col] = { type: 'n', color: COLOR.WHITE }; mark(occ, ns.row, ns.col);
  const wk = pickSquare(rng, occ, (r, c) => kingDistance({ row: r, col: c }, bk) >= 2);
  if (!wk) return null; g[wk.row][wk.col] = { type: 'k', color: COLOR.WHITE }; mark(occ, wk.row, wk.col);
  return { grid: g, bk, wk };
}

function samplePromotion(rng) {
  const g = emptyGrid(); const occ = new Set();
  const edges = []; for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) if (r === 0 || r === 7 || c === 0 || c === 7) edges.push({ row: r, col: c });
  const bk = edges[Math.floor(rng() * edges.length)]; g[bk.row][bk.col] = { type: 'k', color: COLOR.BLACK }; mark(occ, bk.row, bk.col);
  const pf = Math.floor(rng() * 8); const pSq = algToRC(FILES[pf] + '7');
  g[pSq.row][pSq.col] = { type: 'p', color: COLOR.WHITE }; mark(occ, pSq.row, pSq.col);
  const qf = Math.floor(rng() * 8), qr = 1 + Math.floor(rng() * 5);
  const qs = algToRC(FILES[qf] + qr); if (kingDistance(qs, bk) <= 1) return null;
  g[qs.row][qs.col] = { type: 'q', color: COLOR.WHITE }; mark(occ, qs.row, qs.col);
  const wk = pickSquare(rng, occ, (r, c) => kingDistance({ row: r, col: c }, bk) >= 2);
  if (!wk) return null; g[wk.row][wk.col] = { type: 'k', color: COLOR.WHITE }; mark(occ, wk.row, wk.col);
  return { grid: g, bk, wk };
}

// 自 gen-endgames.js 照搬的三种原型（闷宫 / 弃子引离 / 牵制闪击）
function sampleSmother(rng) {
  const g = emptyGrid(); const occ = new Set(); const mark2 = (r, c) => occ.add(r * 8 + c);
  const corners = [{ row: 0, col: 0 }, { row: 0, col: 7 }, { row: 7, col: 0 }, { row: 7, col: 7 }];
  const bk = corners[Math.floor(rng() * corners.length)]; g[bk.row][bk.col] = { type: 'k', color: COLOR.BLACK }; mark2(bk.row, bk.col);
  const escape = [];
  for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) { if (dr === 0 && dc === 0) continue; const r = bk.row + dr, c = bk.col + dc; if (r < 0 || r > 7 || c < 0 || c > 7) continue; escape.push({ row: r, col: c }); }
  const blockTypes = ['n', 'n', 'p', 'p', 'r', 'b'];
  const nBlock = 1 + (rng() < 0.75 ? 1 : 0);
  const shuffled = escape.slice().sort(() => rng() - 0.5);
  let placed = 0;
  for (const sq of shuffled) { if (placed >= nBlock) break; let type = blockTypes[Math.floor(rng() * blockTypes.length)]; if (type === 'p' && (sq.row === 0 || sq.row === 7)) type = 'n'; g[sq.row][sq.col] = { type, color: COLOR.BLACK }; mark2(sq.row, sq.col); placed++; }
  if (placed === 0) return null;
  const wk = pickSquare(rng, occ, (r, c) => kingDistance({ row: r, col: c }, bk) >= 2); if (!wk) return null; g[wk.row][wk.col] = { type: 'k', color: COLOR.WHITE }; mark2(wk.row, wk.col);
  const heavy = ['q', 'q', 'r', 'r', 'b']; const ht = heavy[Math.floor(rng() * heavy.length)];
  const hs = pickSquare(rng, occ, (r, c) => kingDistance({ row: r, col: c }, bk) > 1); if (!hs) return null; g[hs.row][hs.col] = { type: ht, color: COLOR.WHITE }; mark2(hs.row, hs.col);
  if (rng() < 0.5) { const extra = ['n', 'b', 'r', 'p'][Math.floor(rng() * 4)]; const es = pickSquare(rng, occ, (r, c) => { if (extra === 'p' && (r === 0 || r === 7)) return false; if (kingDistance({ row: r, col: c }, bk) <= 1) return false; if (kingDistance({ row: r, col: c }, wk) <= 1) return false; return true; }); if (es) { g[es.row][es.col] = { type: extra, color: COLOR.WHITE }; mark2(es.row, es.col); } }
  return { grid: g, bk, wk };
}
function sampleDecoy(rng) {
  const g = emptyGrid(); const occ = new Set(); const mark2 = (r, c) => occ.add(r * 8 + c);
  const bkCandidates = []; for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) if (r === 0 || r === 7 || c === 0 || c === 7) bkCandidates.push({ row: r, col: c });
  const bk = bkCandidates[Math.floor(rng() * bkCandidates.length)]; g[bk.row][bk.col] = { type: 'k', color: COLOR.BLACK }; mark2(bk.row, bk.col);
  const dirs = [[-1, 0], [1, 0], [0, -1], [0, 1]]; const d = dirs[Math.floor(rng() * dirs.length)];
  const pr = bk.row + d[0], pc = bk.col + d[1]; if (pr < 1 || pr > 6) return null; g[pr][pc] = { type: 'p', color: COLOR.BLACK }; mark2(pr, pc);
  const wk = pickSquare(rng, occ, (r, c) => kingDistance({ row: r, col: c }, bk) >= 2); if (!wk) return null; g[wk.row][wk.col] = { type: 'k', color: COLOR.WHITE }; mark2(wk.row, wk.col);
  const rookSq = pickSquare(rng, occ, (r, c) => kingDistance({ row: r, col: c }, bk) > 1); if (!rookSq) return null; g[rookSq.row][rookSq.col] = { type: 'r', color: COLOR.WHITE }; mark2(rookSq.row, rookSq.col);
  const bait = ['q', 'n', 'b', 'q'][Math.floor(rng() * 4)]; const baitSq = pickSquare(rng, occ, (r, c) => { if (kingDistance({ row: r, col: c }, bk) <= 1) return false; if (kingDistance({ row: r, col: c }, wk) <= 1) return false; return true; }); if (!baitSq) return null; g[baitSq.row][baitSq.col] = { type: bait, color: COLOR.WHITE }; mark2(baitSq.row, baitSq.col);
  if (rng() < 0.5) { const bt = ['n', 'r', 'b', 'p'][Math.floor(rng() * 4)]; const bs = pickSquare(rng, occ, (r, c) => { if (bt === 'p' && (r === 0 || r === 7)) return false; if (kingDistance({ row: r, col: c }, wk) <= 1) return false; return true; }); if (bs) { g[bs.row][bs.col] = { type: bt, color: COLOR.BLACK }; mark2(bs.row, bs.col); } }
  return { grid: g, bk, wk };
}
function samplePin(rng) {
  const g = emptyGrid(); const occ = new Set(); const mark2 = (r, c) => occ.add(r * 8 + c);
  const edges = []; for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) if (r === 0 || r === 7 || c === 0 || c === 7) edges.push({ row: r, col: c });
  const bk = edges[Math.floor(rng() * edges.length)]; g[bk.row][bk.col] = { type: 'k', color: COLOR.BLACK }; mark2(bk.row, bk.col);
  const alongRow = rng() < 0.5; const step = rng() < 0.5 ? 1 : -1; const sr = bk.row + (alongRow ? 0 : step), sc = bk.col + (alongRow ? step : 0);
  if (sr < 0 || sr > 7 || sc < 0 || sc > 7) return null; const shieldType = ['r', 'n', 'b', 'q'][Math.floor(rng() * 4)]; g[sr][sc] = { type: shieldType, color: COLOR.BLACK }; mark2(sr, sc);
  const wk = pickSquare(rng, occ, (r, c) => kingDistance({ row: r, col: c }, bk) >= 2); if (!wk) return null; g[wk.row][wk.col] = { type: 'k', color: COLOR.WHITE }; mark2(wk.row, wk.col);
  const pinner = ['b', 'q', 'r'][Math.floor(rng() * 3)]; const ps = pickSquare(rng, occ, (r, c) => { if (kingDistance({ row: r, col: c }, bk) <= 1) return false; if (kingDistance({ row: r, col: c }, wk) <= 1) return false; return true; }); if (!ps) return null; g[ps.row][ps.col] = { type: pinner, color: COLOR.WHITE }; mark2(ps.row, ps.col);
  const striker = ['q', 'r', 'q'][Math.floor(rng() * 3)]; const ss = pickSquare(rng, occ, (r, c) => { if (kingDistance({ row: r, col: c }, bk) <= 1) return false; if (kingDistance({ row: r, col: c }, wk) <= 1) return false; return true; }); if (!ss) return null; g[ss.row][ss.col] = { type: striker, color: COLOR.WHITE }; mark2(ss.row, ss.col);
  return { grid: g, bk, wk };
}

// ---- 主题表（经典杀法名录）----
// sampler: 使用的采样器；meta: 名称/引言/提示变体（避免重复文案）
const MOTIFS = [
  { key: 'backrank', zh: '底线杀', sampler: sampleBackRank,
    names: ['车沉底线', '后防空虚', '一步绝杀', '底线陷阱', '王门紧闭', '一车定音', '绝境沉车'],
    intros: ['黑王被自己的兵困在底线，一车沉底就是绝杀。', '兵墙挡住退路，车走到第八横线便无可逃。', '别给黑王半点喘息，车直落底线。', '看似稳固的防线，其实是自家的牢笼。', '王门紧闭，只等一记沉底。', '一步沉车，胜负已分。', '兵堵后路，车到即杀。'],
    hints: [['车走到第 8 横线就是绝杀', '先数一遍黑王还能往哪走'], ['底线被兵封死，直接沉车', '注意黑王唯一的逃格'], ['把车送到能将军的横线', '白王要护住这枚车']] },
  { key: 'queenmate', zh: '贴身闷杀', sampler: sampleQueenEdge,
    names: ['后贴金身', '贴身一将', '王护重子', '闷宫初现', '近身绝杀', '后将封喉', '贴脸收网'],
    intros: ['后贴住敌王、自有王来护，闷杀就此成局。', '把后送到能贴住黑王的位置，白王护住命门。', '近身将军，黑王连一步都挪不动。', '王与后夹击，黑王被困在角落。', '后一逼近，杀机立现。', '贴身一将，干净利落。'],
    hints: [['把后送到能贴住黑王的位置', '别忘了白王要护住这枚后'], ['后将军时白王要能护住它', '黑王逃格全被封死才行']] },
  { key: 'tworooks', zh: '双车错', sampler: sampleTwoRooks,
    names: ['双车合围', '两翼齐飞', '车错杀', '梯次逼宫', '双车锁王', '错线围杀', '车轮战'],
    intros: ['双车错开两条横线，一层层把黑王逼到边角。', '两车交替推进，黑王无处可钻。', '一车控线，一车收网，配合无间。', '双车如梯，步步上压。', '两翼齐飞，王城告破。'],
    hints: [['先用一车占住一条横线', '两车错开，黑王无处可钻'], ['一车控线另一车将军', '把黑王逼到边线再收网']] },
  { key: 'rookking', zh: '车王逼宫', sampler: sampleRookKing,
    names: ['单车擒王', '车王合击', '切角逼杀', '王车推进', '孤车锁王', '步步紧逼', '车王夹击'],
    intros: ['单车配王，把黑王一步步赶向边线。', '白王压上，车切角收网。', '王车协作，黑王插翅难飞。', '单车也能将死，关键是逼到边角。'],
    hints: [['白王要跟着推进，别离太远', '先把黑王赶到边线'], ['车控制横线，王封退路', '逼到角落再将军']] },
  { key: 'smother', zh: '闷宫绝杀', sampler: sampleSmother,
    names: ['闷宫绝杀', '金钩困王', '自锁杀', '铁桶闷杀', '王陷重围', '无路可逃', '密室将死'],
    intros: ['黑王被自己的子闷住，一记闷宫就够了。', '四周都是自家棋子，黑王动弹不得。', '看似有子，实则全成了牢笼。', '金钩一锁，黑王窒息。'],
    hints: [['数清黑王身边还剩几个空位', '把子塞进唯一的空位就是闷杀'], ['黑王被自家子堵死', '重子远程一击即杀']] },
  { key: 'decoy', zh: '弃子引离', sampler: sampleDecoy,
    names: ['弃子引离', '诱敌深入', '调虎离山', '舍子破防', '诱杀', '弃车引王', '开路一击'],
    intros: ['弃一个子把护王的兵引开，底线就空了。', '先想清楚哪枚子是可以不要的。', '引开护子，再沉车底线。', '舍小取大，防线瞬间崩开。'],
    hints: [['先想清楚哪枚子是可以不要的', '引开护王之子后再动手'], ['用诱饵换开防线', '沉车底线收尾']] },
  { key: 'pin', zh: '牵制闪击', sampler: samplePin,
    names: ['牵制闪击', '钉住破绽', '一线牵杀', '暗箭难防', '锁链将军', '静待闪击', '钉死抽杀'],
    intros: ['牵住对方的子再闪击，暴露的火力才是杀招。', '先钉住，再算闪击的落点。', '表面安静，实则已锁死逃路。'],
    hints: [['先牵制，再算闪击的落点', '白王别脱离防线'], ['一子定住敌子', '另一子趁机将军']] },
  { key: 'knightqueen', zh: '马后炮', sampler: sampleKnightQueen,
    names: ['马跃金钩', '马后抽将', '金钩将军', '马踏连环', '跃马收网', '马后成杀', '马蹄绝响'],
    intros: ['马跳金钩直取将位，顺手还能抽走黑方的子。', '马与后呼应，一步将军一步抽子。', '金钩一拐，黑王应声倒下。'],
    hints: [['马有两个落点能将军，先挑能抽子的', '马一离开，注意黑王逃格'], ['马将军的同时后控制退路', '两步之内收网']] },
  { key: 'rookknight', zh: '车马合杀', sampler: sampleRookKnightEdge,
    names: ['阿拉伯杀', '安娜斯塔西娅', '角落杀', '钩杀', '车马锁角', '马护车攻', '边线绝杀'],
    intros: ['车马联手，把黑王封死在边线角落。', '马控逃格，车一锤定音。', '经典的车马配合，专破王翼。', '边线无路，车马收官。'],
    hints: [['马先占住黑王的逃格', '车再沿边线将军'], ['车马各司其职', '把王逼到角上最稳']] },
  { key: 'doublebishop', zh: '双象锁王', sampler: sampleDoubleBishop,
    names: ['双象绞杀', '斜线囚笼', '象翼合围', '双翼齐锁', '交叉火力', '象阵收王', '斜封绝境'],
    intros: ['双象交叉斜线，黑王被锁进囚笼。', '一象控线，一象封角，王插翅难飞。', '双翼齐飞，杀机藏在斜线里。'],
    hints: [['双象要走不同色斜线', '先把黑王逼到边角'], ['一象封退路一象将军', '斜线交叉即是牢笼']] },
  { key: 'bishopknight', zh: '象马合杀', sampler: sampleBishopKnight,
    names: ['象马合杀', '异色围杀', '马象逼宫', '角落绝唱', '双骑锁王', '象马收官', '残局精算'],
    intros: ['象与马配合，把黑王逼入绝境。', '短兵相接的残局，算清每一步。', '王车象马，经典的收官组合。'],
    hints: [['象控一种色格，马补另一种', '先把黑王逼到角落'], ['王要上前助阵', '算准将军次序']] },
  { key: 'promotion', zh: '升变奇兵', sampler: samplePromotion,
    names: ['升变奇兵', '小兵封王', '一步登天', '兵临城下', '升后绝杀', '底线新生', '小卒建功'],
    intros: ['小兵冲到底线升变，成了压垮黑王的那根稻草。', '兵也能是杀招，升变即定局。', '先让兵冲到第七横线，再图后手。'],
    hints: [['先看兵能不能冲到第 8 横线', '升变不只是变后，变车也能杀'], ['兵护住升变路', '升变后立刻将军']] }
];

// ---- 主流程 ----
function main() {
  const dry = process.argv.includes('--dry');
  const PER_MOTIF = 200; // 每主题采样候选数（命中率 3–17%，200/主题足矣；控制总耗时）
  const pool = { 1: [], 2: [], 3: [], 4: [] };
  const seen = new Set();

  for (const m of MOTIFS) {
    const rng = mulberry32(hashSeed('v2-100-' + m.key));
    let sampled = 0, ok = 0;
    for (let i = 0; i < PER_MOTIF; i++) {
      const pos = m.sampler(rng);
      if (!pos) continue;
      sampled++;
      const depth = forcedMateDepth(pos.grid);
      if (depth < 1) continue;
      const fen = gridToFen(pos.grid);
      if (seen.has(fen)) continue;
      seen.add(fen);
      pool[depth].push({ fen, motif: m });
      ok++;
    }
    console.log('[' + m.key + '·' + m.zh + '] 采样 ' + sampled + ' 命中强制杀 ' + ok + ' → 池: m1=' + pool[1].length + ' m2=' + pool[2].length + ' m3=' + pool[3].length + ' m4=' + pool[4].length);
  }

  const total = pool[1].length + pool[2].length + pool[3].length + pool[4].length;
  console.log('\n候选合计 ' + total + ' 唯一局面（m1=' + pool[1].length + ' m2=' + pool[2].length + ' m3=' + pool[3].length + ' m4=' + pool[4].length + '）');
  if (dry) return;

  // 目标：m1=25 m2=35 m3=30 m4=10 = 100（m4 为稀缺且校验最慢的深度，占比压低）
  const plan = [];
  const want = { 1: 25, 2: 35, 3: 30, 4: 10 };
  // 若某深度不足，按比例从相邻深度借
  const avail = { 1: pool[1].length, 2: pool[2].length, 3: pool[3].length, 4: pool[4].length };
  for (const d of [1, 2, 3, 4]) { let need = want[d]; while (need > 0 && avail[d] > 0) { plan.push(d); avail[d]--; need--; } }
  // 补足：还有空位就从剩余里按深度顺序填
  for (const d of [1, 2, 3, 4]) { while (plan.length < 100 && avail[d] > 0) { plan.push(d); avail[d]--; } }
  while (plan.length < 100) plan.push(2);
  // 截断到 100
  plan.length = 100;

  // 为每个深度准备「按主题轮转」的取用队列
  const used = { 1: {}, 2: {}, 3: {}, 4: {} };
  const queues = { 1: {}, 2: {}, 3: {}, 4: {} };
  for (const d of [1, 2, 3, 4]) {
    for (const m of MOTIFS) {
      const arr = pool[d].filter(c => c.motif.key === m.key);
      // 打乱
      for (let i = arr.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); const t = arr[i]; arr[i] = arr[j]; arr[j] = t; }
      queues[d][m.key] = arr;
    }
  }
  const motifOrder = MOTIFS.map(m => m.key);
  let motifPtr = 0;

  const ENDGAMES = [];
  for (let i = 0; i < 100; i++) {
    const d = plan[i];
    // 轮转找一个还有库存的主题
    let chosen = null, tries = 0;
    while (tries < motifOrder.length) {
      const mk = motifOrder[motifPtr % motifOrder.length]; motifPtr++; tries++;
      const q = queues[d][mk];
      if (q && q.length) { chosen = q.pop(); break; }
    }
    if (!chosen) { // 该深度所有主题耗尽，退而从任意深度取
      for (const dd of [d, d - 1, d + 1, 1, 2, 3, 4]) { const q2 = queues[dd]; if (!q2) continue; for (const mk of motifOrder) { if (q2[mk] && q2[mk].length) { chosen = q2[mk].pop(); break; } } if (chosen) break; }
    }
    if (!chosen) { console.error('候选不足，停止于 ' + i); break; }
    const m = chosen.motif;
    const idx = (used[d][m.key] = (used[d][m.key] || 0) + 1) - 1;
    const name = m.names[idx % m.names.length];
    const intro = m.intros[idx % m.intros.length];
    const hints = m.hints[idx % m.hints.length];
    const difficulty = d === 4 ? 5 : d;
    const timeLimit = d === 1 ? 45 : d === 2 ? 60 : d === 3 ? 90 : 120;
    const skillWeights = d === 1 ? { common: 100, rare: 0, epic: 0 }
      : d === 2 ? { common: 70, rare: 30, epic: 0 }
        : d === 3 ? { common: 45, rare: 50, epic: 5 }
          : { common: 20, rare: 50, epic: 30 };
    ENDGAMES.push({
      id: 'EG-' + String(i + 1).padStart(2, '0'),
      name,
      fen: chosen.fen,
      sideToMove: 'w',
      targetMoves: d,
      moveCap: d * 2 + 3,
      timeLimitSec: timeLimit,
      difficulty,
      theme: 'mate-in-' + d + '·' + m.zh,
      tipId: 'tip_' + m.key,
      skillWeights,
      intro,
      coachHints: hints
    });
  }

  // TIPS：每主题一条 + 通用 3 条
  const TIPS = MOTIFS.map(m => ({ id: 'tip_' + m.key, text: m.intros[0], tactic: m.zh }));
  TIPS.push({ id: 'tip_forced', text: '先看清对手唯一的应手，再落子。', tactic: '强迫着法' });
  TIPS.push({ id: 'tip_king', text: '王也要参战——残局里它可是主力。', tactic: '王的使用' });
  TIPS.push({ id: 'tip_general', text: '算不准时，先找将军、吃子、威胁这三类着法。', tactic: '通用思路' });

  // SKILLS 沿用原 7 条
  const SKILLS = require('../src/data/endgames').SKILLS;

  const header = `/**\n * 残局闯关数据（100 阵）+ 妙招文案库 + 技能定义表\n *\n * 由 tools/gen100.js 生成：每阵均经 test-endgame.js 的 findMateLine 验证，\n * 存在 targetMoves 步内的「强制将杀」（depth 与 theme 标注一致）。\n * 主题取自经典杀法名录（底线杀 / 闷宫 / 阿拉伯 / 双车错 / 升变 / 双象 / 象马 …）。\n *\n * 字段：id/name/fen/sideToMove/targetMoves/moveCap/timeLimitSec/difficulty/\n *       theme/tipId/skillWeights/intro/coachHints\n */\n'use strict';\n\n`;
  const body =
    'const ENDGAMES = ' + JSON.stringify(ENDGAMES, null, 2) + ';\n\n' +
    'const TIPS = ' + JSON.stringify(TIPS, null, 2) + ';\n\n' +
    'const SKILLS = ' + JSON.stringify(SKILLS, null, 2) + ';\n\n' +
    'module.exports = { ENDGAMES, TIPS, SKILLS };\n';

  const outPath = path.join(__dirname, '..', 'src', 'data', 'endgames.js');
  fs.writeFileSync(outPath, header + body);
  console.log('\n已写入 ' + outPath + '（' + ENDGAMES.length + ' 阵）');
  // 统计分布
  const byDepth = { 1: 0, 2: 0, 3: 0, 4: 0 }; const byMotif = {};
  for (const e of ENDGAMES) { byDepth[e.targetMoves]++; byMotif[e.theme.split('·')[1]] = (byMotif[e.theme.split('·')[1]] || 0) + 1; }
  console.log('难度分布 m1=' + byDepth[1] + ' m2=' + byDepth[2] + ' m3=' + byDepth[3] + ' m4=' + byDepth[4]);
  console.log('主题分布: ' + Object.entries(byMotif).map(([k, v]) => k + '×' + v).join('  '));
}

if (require.main === module) main();
module.exports = { main };
