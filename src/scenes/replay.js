/**
 * S6 棋谱回放场景（视觉 §8.7 / UX §3.3.6 / 补遗 §E C11）
 *
 * - 只读棋盘：点棋盘不产生走子；只响应控制条与记谱网格。
 * - 从 record.movesUci 重放：core/game.js replayToPly(n, uciList)，跨 >1 步不做动画。
 * - 记谱网格：2 列（回合数 + 白方 SAN + 黑方 SAN），行高 34；点某着直接跳到该着之后；
 *   命中用「最近行中心」判定（C11 硬约束，勿简单扩 5pt 造成相邻行重叠）。
 * - 控制条底部 84pt，5 等分 44×44：⏮ 首步 / ◀ 上一步 / ▶ 播放·暂停 / 下一步 ▶ / ⏭ 末步。
 * - 自动播放 800ms/步（reduceMotion 500ms），到末步自动暂停；播放中点「上一步/跳转」自动暂停。
 * - 单步前/后改用 motion.move 180ms 轻量位移；reduceMotion 不做动画。
 * - 当前步金色 accent 文字 + 2pt 左竖条；跳转后棋盘同步 lastMove 高亮。
 * - 返回：pop() → S5（保留滚动位置）；从结算进入时返回也回 S5（路径一致，UX §3.3.6 决策）。
 */
const GameContext = require('../context');
const M = require('./manager');
const { theme, TouchGuard, util, createTap } = M;
const C = theme.colors, R = theme.radius, MO = theme.motion;
const TF = (k) => theme.font(k);
const rr = util.rr, inRect = util.inRect, drawBtn = util.drawButtonLocal;
const layout = require('../core/layout');
const topbar = require('../render/topbar');
const { opponentLabel, modeLabel } = require('../data/recordLabels');
const ChessGame = require('../core/game');
const Board = require('../core/board');
const boardRender = require('../render/board');
const piecesRender = require('../render/pieces');

const anim = (() => { try { return require('../core/anim'); } catch (e) { return null; } })();
function easeInOut(t) { if (anim && anim.easeInOut) { try { return anim.easeInOut(t); } catch (e) {} } return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2; }
function updateTweens(dtMs) { if (anim && typeof anim.updateTweens === 'function') { try { anim.updateTweens(dtMs); } catch (e) {} } }

const icons = (() => { try { return require('../render/icons'); } catch (e) { return null; } })();
function ico(ctx, name, x, y, size, color) {
  if (icons && typeof icons.drawIcon === 'function') {
    try { icons.drawIcon(ctx, name, x, y, size, color); return true; } catch (e) { /* noop */ }
  }
  return false;
}

function pad2(n) { return n < 10 ? '0' + n : '' + n; }
function fmtDate(ts) {
  if (typeof ts !== 'number' || !isFinite(ts) || ts <= 0) return '—';
  const d = new Date(ts);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}
function fmtDuration(ms) {
  if (typeof ms !== 'number' || !isFinite(ms) || ms < 0) return '00:00';
  const total = Math.floor(ms / 1000);
  return `${pad2(Math.floor(total / 60))}:${pad2(total % 60)}`;
}
function outcomeBadge(rec) {
  let oc = rec.outcome;
  if (!oc) oc = !rec.result ? 'ongoing' : (rec.result === 'draw' ? 'draw' : 'win');
  const map = {
    win: { label: '胜', color: C.success }, loss: { label: '负', color: C.danger },
    draw: { label: '和', color: C.neutralBadge }, ongoing: { label: '进行中', color: C.info }
  };
  return map[oc] || map.draw;
}
function uciToMove(uci) {
  if (!uci || uci.length < 4) return null;
  const from = Board.fromAlgebraic(uci.slice(0, 2));
  const to = Board.fromAlgebraic(uci.slice(2, 4));
  if (from.col < 0 || to.col < 0) return null;
  return { fromRow: from.row, fromCol: from.col, toRow: to.row, toCol: to.col };
}

class ReplayScene {
  constructor() {
    this.guard = new TouchGuard({ moveThreshold: 12 });
    this.regions = [];
    this.pressed = null;
    this.tap = createTap(); // 统一按压状态 + 90ms 防穿透（Phase 3·12）
    this.record = null;
    this.uciList = [];
    this.sanList = [];
    this.game = new ChessGame();
    this.cursor = 0;        // 已重放步数（0=初始局面）
    this.playing = false;
    this.playAccum = 0;     // 累计毫秒，驱动自动步进
    this.timeMs = 0;        // 累计毫秒，传给 drawBoard options.time（脉冲相位）
    this.animMove = null;   // {fromRow,fromCol,toRow,toCol,pieceType,pieceColor,t,dur}
    this.gridScrollY = 0;
    this.gridMaxScroll = 0;
    this.gridContentHeight = 0;
    this.gridTop = 0;
    this.gridBottom = 0;
    this.rowHeight = 34;
    this.screenWidth = 375;
    this.screenHeight = 667;
    this.from = 'records';
    this.sm = null;
  }

  enter(params = {}) {
    this.sm = params._sm || null;
    this.screenWidth = params.screenWidth || 375;
    this.screenHeight = params.screenHeight || 667;
    this.from = params.from || 'records';
    this.regions = [];
    this.pressed = null;
    this.playing = false;
    this.playAccum = 0;
    this.animMove = null;
    this.cursor = 0;
    if (!params.resume) this.gridScrollY = 0;
    this.guard.reset();
    this.tap.clear();

    const rec = params.record || (params.id ? GameContext.getRecord(params.id) : null);
    if (!rec) {
      this.record = null;
      this.uciList = [];
      this.sanList = [];
      // 棋谱载入失败：返回上一场景 + Banner 提示（Banner 在返回之后，避免被 _activate 的 banner.clear() 清掉）
      GameContext.emit('uiError');
      this._activate('back');
      GameContext.showBanner('棋谱载入失败', 'danger');
      return;
    }
    this.record = rec;
    this.uciList = Array.isArray(rec.movesUci) ? rec.movesUci.slice() : [];
    this.sanList = Array.isArray(rec.sanLog) ? rec.sanLog.slice() : [];
    this._rebuildTo(0, false);
  }

  exit() { this.regions = []; this.pressed = null; this.tap.clear(); this.playing = false; this.animMove = null; }
  clearTouch() { this.guard.reset(); this.pressed = null; this.tap.clear(); }

  total() { return this.uciList.length; }

  _rebuildTo(n, animate) {
    const target = Math.max(0, Math.min(n, this.total()));
    const prev = this.cursor;
    const done = this.game.replayToPly(target, this.uciList);
    this.cursor = done;
    // 单步前进（且非跨步）时做一次轻量位移动画；跨步/后退/reduceMotion 不做
    const reduce = !!GameContext.getSettings().reduceMotion;
    if (animate && !reduce && target === prev + 1 && target >= 1) {
      const mv = uciToMove(this.uciList[target - 1]);
      if (mv) {
        // 取动画开始时的棋子（此时已在目标格；飞行棋子用目标格棋子类型/颜色）
        const piece = this.game.board.getPiece(mv.toRow, mv.toCol);
        this.animMove = {
          fromRow: mv.fromRow, fromCol: mv.fromCol, toRow: mv.toRow, toCol: mv.toCol,
          pieceType: piece ? piece.type : 'p', pieceColor: piece ? piece.color : 'w',
          t: 0, dur: (MO.move || 180) / 1000
        };
      }
    } else {
      this.animMove = null;
    }
    this._autoScrollGrid();
  }

  _autoScrollGrid() {
    // 让「当前步」所在行在记谱网格中居中，上下各露出若干行上下文（§4-a）
    const rows = Math.ceil(this.total() / 2);
    const curRow = this.cursor > 0 ? Math.floor((this.cursor - 1) / 2) : 0;
    const viewportH = Math.max(0, this.gridBottom - this.gridTop);
    const contentH = rows * this.rowHeight;
    const maxScroll = Math.max(0, contentH - viewportH);
    // 当前行中心对齐视口中心；边界处钳制到 [0, maxScroll]，首/尾步仍能露出相邻 2 行
    const target = curRow * this.rowHeight + this.rowHeight / 2 - viewportH / 2;
    this.gridScrollY = rows === 0 ? 0 : Math.max(0, Math.min(target, maxScroll));
  }

  update(dt) {
    const dtMs = dt * 1000;
    this.timeMs += dtMs;
    updateTweens(dtMs);
    if (this.animMove) {
      this.animMove.t += dt;
      if (this.animMove.t >= this.animMove.dur) this.animMove = null;
    }
    if (this.playing && this.record) {
      const reduce = !!GameContext.getSettings().reduceMotion;
      const stepMs = reduce ? (MO.replayStepReduce || 500) : (MO.replayStep || 800);
      this.playAccum += dtMs;
      if (this.playAccum >= stepMs) {
        this.playAccum = 0;
        if (this.cursor < this.total()) this._rebuildTo(this.cursor + 1, true);
        if (this.cursor >= this.total()) { this.playing = false; }
      }
    }
  }

  render(ctx, W, H) {
    ctx.fillStyle = C.bgBase; ctx.fillRect(0, 0, W, H);
    this.regions = [];

    const L = layout.get();
    // 统一三槽位顶栏（标题下沉时高度自增，后续全部用 bottom）
    const nav = topbar.drawTopBar(ctx, {
      title: '棋谱回放', fontKey: 'h1',
      back: { key: 'back', label: '返回', pressed: this.tap.isPressing('back', Date.now()) }
    });
    nav.regions.forEach(r => this.regions.push(r));
    const navBottom = nav.bottom;
    ctx.strokeStyle = C.accentLine; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(16, navBottom + 8); ctx.lineTo(W - 16, navBottom + 8); ctx.stroke();

    if (!this.record) {
      ctx.fillStyle = C.textSecondary; ctx.font = TF('body');
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('无法读取此棋谱', W / 2, H / 2);
      return;
    }

    const flip = this.record.playerColor === 'b';

    // ---- 元信息卡 ----
    const metaY = navBottom + 16, metaH = 52, metaX = 16, metaW = W - 32;
    ctx.fillStyle = C.surface1; rr(ctx, metaX, metaY, metaW, metaH, R.btn); ctx.fill();
    ctx.strokeStyle = C.border; ctx.lineWidth = 1;
    rr(ctx, metaX + 0.5, metaY + 0.5, metaW - 1, metaH - 1, R.btn); ctx.stroke();
    // 结果徽章先算宽度，供行1/行2 预留右侧空间（徽章保持实底语义色，不动）
    const badge = outcomeBadge(this.record);
    ctx.font = TF('micro');
    const bw = ctx.measureText(badge.label).width + 20;
    const bx = metaX + metaW - 12 - bw, by = metaY + metaH / 2 - 11;
    const textMaxW = Math.max(0, bx - (metaX + 14) - 8);
    // 行1：对手名（远程为对端昵称；缺失时 opponentLabel 按 mode 回落），截断到徽章左侧
    const opponent = opponentLabel(this.record);
    ctx.fillStyle = C.textPrimary; ctx.font = TF('subtitle');
    ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    this._ellipsis(ctx, opponent, metaX + 14, metaY + 18, textMaxW);
    // 行2：模式标签 · 日期 · 步数 · 时长（与 records.js 列表卡片样式一致）
    // 模式标签 micro 粗体小字 + textSecondary（不用 accent 黄铜），其余 caption + textSecondary，
    // 模式段完整可见，其余段 _ellipsis 截断，防止文字压到右侧结果徽章。
    const total = this.total();
    const modeTxt = modeLabel(this.record.mode);
    ctx.font = TF('micro');
    const modeW = ctx.measureText(modeTxt).width;
    ctx.fillStyle = C.textSecondary;
    ctx.fillText(modeTxt, metaX + 14, metaY + 38);
    ctx.font = TF('caption');
    const meta = ` · ${fmtDate(this.record.startedAt)} · ${total} 步 · ${fmtDuration(this.record.durationMs)}`;
    this._ellipsis(ctx, meta, metaX + 14 + modeW, metaY + 38, Math.max(0, textMaxW - modeW));
    // 结果徽章（右，语义色实底 + textOnAccent 深字 ≥5.4:1，统一胜/和/负/进行中）
    ctx.fillStyle = badge.color; rr(ctx, bx, by, bw, 22, 999); ctx.fill();
    ctx.fillStyle = C.textOnAccent; ctx.font = TF('micro');
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(badge.label, bx + bw / 2, by + 11);

    // ---- 棋盘（只读，用 getBoardMetrics 真居中）----
    // Phase4·复盘棋盘放大：26px 格可读性吃亏。压缩进度条/记谱网格预留、上移 boardY，
    // 把 cell 从 26 提到 ~33（board 264px），并保证记谱网格仍有 ≥2 行可视、可滚动。
    const ctrlH = 76;
    const ctrlTop = L.contentBottom - ctrlH;   // 控制条底边锚定安全区 contentBottom，避开 home indicator
    // 执黑方位预览：玩家执黑时棋盘已翻转，在元信息卡与棋盘之间预留一行标签位说明方位（§4-c）
    const orientH = flip ? 24 : 0;
    const boardY = metaY + metaH + 8 + orientH;
    let metrics = null;
    try { const config = require('../config'); if (config && config.getBoardMetrics) metrics = config.getBoardMetrics(W, H); } catch (e) { /* noop */ }
    // 竖向可用 = ctrlTop - grid 最小可视(64) - 进度条(32) - boardY - 余量(8)
    const gridMinH = 64, progH = 32;
    const availForBoard = ctrlTop - gridMinH - progH - boardY - 8;
    let cell = metrics ? metrics.cellSize : Math.floor(Math.min(W * 0.92, H * 0.55) / 8);
    const maxCellByHeight = Math.floor(Math.max(availForBoard, 0) / 8);
    if (maxCellByHeight > 0) cell = Math.min(cell, maxCellByHeight);
    cell = Math.max(26, cell);
    const boardSize = cell * 8;
    const boardX = Math.floor((W - boardSize) / 2);
    this._layout = { boardX, boardY, cell };

    const st = this.game.getStatus();
    const lastUci = this.cursor > 0 ? this.uciList[this.cursor - 1] : null;
    const lastMove = lastUci ? uciToMove(lastUci) : null;
    const skipPiece = this.animMove ? { row: this.animMove.toRow, col: this.animMove.toCol } : null;
    boardRender.drawBoard(ctx, this.game.board, {
      x: boardX, y: boardY, cellSize: cell,
      selected: null, legalMoves: [], lastMove,
      checkPos: null, flip,
      showCoordinates: !!GameContext.getSettings().showCoordinates,
      time: this.timeMs, reduceMotion: !!GameContext.getSettings().reduceMotion,
      skipPiece
    });
    // 执黑方位预览：玩家执黑时棋盘已翻转，在元信息卡与棋盘之间的预留位画出方位标签（§4-c）
    if (flip) {
      const tag = '执黑 · 棋盘已翻转';
      ctx.font = TF('micro');
      const tw = ctx.measureText(tag).width + 16;
      const ty = metaY + metaH + 6;
      const tx = boardX + boardSize - tw;
      ctx.fillStyle = C.accentFade; rr(ctx, tx, ty, tw, 18, R.pill); ctx.fill();
      ctx.strokeStyle = C.accentLine; ctx.lineWidth = 1;
      rr(ctx, tx + 0.5, ty + 0.5, tw - 1, 17, R.pill); ctx.stroke();
      ctx.fillStyle = C.accentSoft; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
      ctx.fillText(tag, tx + 8, ty + 9);
    }
    // 飞行动画棋子
    if (this.animMove) {
      const a = this.animMove;
      const t = a.dur > 0 ? easeInOut(Math.min(1, a.t / a.dur)) : 1;
      const from = this._cellScreen(a.fromRow, a.fromCol, flip);
      const to = this._cellScreen(a.toRow, a.toCol, flip);
      const px = from.x + (to.x - from.x) * t, py = from.y + (to.y - from.y) * t;
      piecesRender.drawPieceWithShadow(ctx, a.pieceType, a.pieceColor, px, py, cell);
    }

    // ---- 进度指示 ----
    const progY = boardY + boardSize + 8;
    ctx.fillStyle = C.textSecondary; ctx.font = TF('caption');
    ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    ctx.fillText(`第 ${this.cursor} / ${total} 步`, 16, progY + 10);
    // 细进度条 240ms 插值（简化：直接按比例绘制，宽度由 cursor 决定）
    const barX = 16, barY = progY + 24, barW = W - 32, barH = 4;
    ctx.fillStyle = C.surface3; rr(ctx, barX, barY, barW, barH, 2); ctx.fill();
    const ratio = total > 0 ? this.cursor / total : 0;
    if (ratio > 0) { ctx.fillStyle = C.accent; rr(ctx, barX, barY, barW * ratio, barH, 2); ctx.fill(); }

    // ---- 记谱网格（行高 34，最近中心命中 C11）----
    // 进度行随棋盘放大收紧为 32（原 40），为放大的棋盘让出纵向空间
    this.gridTop = progY + 32;
    this.gridBottom = ctrlTop - 8;
    this._renderMoveGrid(ctx, W);

    // ---- 控制条（底部 84pt，5 等分）----
    this._renderControls(ctx, W, ctrlTop, ctrlH);
  }

  _cellScreen(row, col, flip) {
    const { boardX, boardY, cell } = this._layout;
    const dr = flip ? 7 - row : row, dc = flip ? 7 - col : col;
    return { x: boardX + dc * cell + cell / 2, y: boardY + dr * cell + cell / 2 };
  }

  _renderMoveGrid(ctx, W) {
    const rows = Math.ceil(this.total() / 2);
    const viewportH = Math.max(0, this.gridBottom - this.gridTop);
    ctx.save();
    ctx.beginPath(); ctx.rect(0, this.gridTop, W, viewportH); ctx.clip();
    const gx = 16, gw = W - 32;
    const numW = 28, cellW = (gw - numW) / 2;
    for (let r = 0; r < rows; r++) {
      const y = this.gridTop + r * this.rowHeight - this.gridScrollY;
      if (y + this.rowHeight < this.gridTop || y > this.gridBottom) continue;
      // 交替行底
      ctx.fillStyle = r % 2 === 0 ? C.surface1 : 'rgba(255,255,255,0.02)';
      ctx.fillRect(gx, y, gw, this.rowHeight);
      // 回合数
      ctx.fillStyle = C.textSecondary; ctx.font = TF('caption');
      ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
      ctx.fillText(`${r + 1}.`, gx + 6, y + this.rowHeight / 2);
      // 白方 SAN（ply 2r）/ 黑方 SAN（ply 2r+1）
      const plyW = 2 * r, plyB = 2 * r + 1;
      this._sanCell(ctx, gx + numW, y, cellW, this.rowHeight, plyW);
      this._sanCell(ctx, gx + numW + cellW, y, cellW, this.rowHeight, plyB);
    }
    ctx.restore();
    this.gridContentHeight = rows * this.rowHeight;
    this.gridMaxScroll = Math.max(0, this.gridContentHeight - viewportH);
    if (this.gridScrollY > this.gridMaxScroll) this.gridScrollY = this.gridMaxScroll;
    if (this.gridScrollY < 0) this.gridScrollY = 0;
  }

  _sanCell(ctx, x, y, w, h, ply) {
    if (ply >= this.total()) return;
    const san = this.sanList[ply] || '';
    const isCurrent = this.cursor === ply + 1; // 当前步 = 刚走到这一着之后
    if (isCurrent) {
      ctx.fillStyle = C.accentFade; ctx.fillRect(x, y, w, h);
      ctx.fillStyle = C.accent; ctx.fillRect(x, y + 3, 2, h - 6); // 2pt 左竖条
    }
    ctx.fillStyle = isCurrent ? C.accent : C.textPrimary; ctx.font = TF('san');
    ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    ctx.fillText(san, x + 10, y + h / 2);
  }

  _renderControls(ctx, W, top, h) {
    ctx.fillStyle = C.bgElev; ctx.fillRect(0, top, W, h);
    ctx.strokeStyle = C.accentLine; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(0, top + 0.5); ctx.lineTo(W, top + 0.5); ctx.stroke();
    const keys = [
      { key: 'first', icon: 'first', label: '首步' },
      { key: 'prev', icon: 'chevronLeft', label: '上一步' },
      { key: 'play', icon: this.playing ? 'pause' : 'play', label: this.playing ? '暂停' : '播放' },
      { key: 'next', icon: 'chevronRight', label: '下一步' },
      { key: 'last', icon: 'last', label: '末步' }
    ];
    const slotW = W / 5;
    const atStart = this.cursor <= 0;
    const atEnd = this.cursor >= this.total();
    const hasMoves = this.total() > 0;
    for (let i = 0; i < keys.length; i++) {
      const it = keys[i];
      const cx = slotW * i + slotW / 2, cy = top + h / 2;
      // 播放键在末步不禁用（点击会从初始重播）；无棋谱时控制键全禁用
      let disabled = false;
      if (!hasMoves) disabled = true;
      else if (it.key === 'first' || it.key === 'prev') disabled = atStart;
      else if (it.key === 'next' || it.key === 'last') disabled = atEnd;
      else if (it.key === 'play') disabled = false;
      const col = disabled ? C.disabledFg : (this.tap.isPressing(it.key, Date.now()) ? C.accent : C.textSecondary);
      ctx.save(); ctx.globalAlpha = disabled ? 0.35 : 1;
      ico(ctx, it.icon, cx, cy - 8, 26, col);
      ctx.fillStyle = col; ctx.font = TF('micro'); ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(it.label, cx, cy + 20);
      ctx.restore();
      // 44×44 热区（居中于槽位）
      this.regions.push({ key: it.key, disabled, rect: { x: cx - 22, y: top + h / 2 - 22, w: 44, h: 44 } });
    }
  }

  _alpha(hex, a) {
    if (typeof hex !== 'string') return `rgba(154,167,180,${a})`;
    if (hex.charAt(0) !== '#') return hex;
    const r = parseInt(hex.slice(1, 3), 16), g = parseInt(hex.slice(3, 5), 16), b = parseInt(hex.slice(5, 7), 16);
    return `rgba(${r},${g},${b},${a})`;
  }

  // 文本按最大宽度截断（与 records.js 一致），用于行1 对手名 / 行2 元信息防溢出
  _ellipsis(ctx, text, x, y, maxW) {
    let t = String(text || '');
    if (ctx.measureText(t).width <= maxW) { ctx.fillText(t, x, y); return; }
    while (t.length > 1 && ctx.measureText(t + '…').width > maxW) t = t.slice(0, -1);
    ctx.fillText(t + '…', x, y);
  }

  onTouchStart(x, y) {
    this.guard.down(x, y);
    this._inGrid = (y >= this.gridTop && y <= this.gridBottom);
    this.pressed = this._hit(x, y);
    if (this.pressed) this.tap.press(this.pressed, Date.now());
  }
  onTouchMove(x, y) {
    const m = this.guard.move(x, y);
    if (m.moved) {
      if (this._inGrid) this.gridScrollY = Math.max(0, Math.min(this.gridMaxScroll, this.gridScrollY - m.stepY));
      if (this.pressed) this.tap.clear(this.pressed);
      this.pressed = null;
    }
  }
  onTouchEnd(x, y) {
    const e = this.guard.end(x, y);
    if (this.pressed) this.tap.clear(this.pressed);
    this.pressed = null;
    if (!e.valid) return;
    // 控制条 / 返回按钮：矩形命中
    const key = this._hit(x, y);
    if (key) {
      if (!this.tap.guard(Date.now(), key)) return;
      GameContext.emit('tap', { key });
      this._activate(key);
      return;
    }
    // 记谱网格：最近行中心 + 白/黑列判定（C11）
    if (this._inGrid && x >= 16 && x <= this.screenWidth - 16 && y >= this.gridTop && y <= this.gridBottom) {
      this._hitMoveRow(x, y);
    }
    // 棋盘只读：点击不产生走子（无操作）
  }

  _hit(x, y) {
    for (const r of this.regions) { if (!r.disabled && inRect(x, y, r.rect)) return r.key; }
    return null;
  }

  _hitMoveRow(x, y) {
    const rows = Math.ceil(this.total() / 2);
    if (rows <= 0) return;
    // 最近行中心（Voronoi 归属，C11）
    const relY = y - this.gridTop + this.gridScrollY;
    let row = Math.round((relY - this.rowHeight / 2) / this.rowHeight);
    row = Math.max(0, Math.min(rows - 1, row));
    // 白/黑列：以 numW 之后的列中线阈值判定
    const gw = this.screenWidth - 32, numW = 28, cellW = (gw - numW) / 2;
    const localX = x - 16 - numW;
    const ply = localX < cellW ? 2 * row : 2 * row + 1;
    const target = Math.min(ply + 1, this.total());
    if (target < 0) return;
    this.playing = false; // 跳转自动暂停
    GameContext.emit('tap', { key: 'jump' });
    this._rebuildTo(target, false); // 跨步/直接跳转不做位移
  }

  _activate(key) {
    if (key === 'back') {
      GameContext.emit('navigate', { to: 'records' });
      if (this.from === 'gameover') {
        // 从结算 M2 进入：pop 回 gameplay 会软锁（结算模态已关但 state 仍 GAMEOVER）。
        // 决策：直接回 S5（路径一致）——回根菜单后再压入 records。
        GameContext.popToRoot();
        GameContext.pushScene('records', { from: 'menu' });
      } else {
        // 从 S5 进入：pop 回 S5（保留其滚动位置，靠 resume 语义）
        GameContext.popScene();
      }
      return;
    }
    if (key === 'first') { this.playing = false; this.playAccum = 0; this._rebuildTo(0, false); }
    else if (key === 'prev') { this.playing = false; this.playAccum = 0; this._rebuildTo(this.cursor - 1, false); }
    else if (key === 'next') { this.playing = false; this.playAccum = 0; this._rebuildTo(this.cursor + 1, true); }
    else if (key === 'last') { this.playing = false; this.playAccum = 0; this._rebuildTo(this.total(), false); }
    else if (key === 'play') {
      if (this.cursor >= this.total() && !this.playing) { this._rebuildTo(0, false); } // 末步重播
      this.playing = !this.playing;
      this.playAccum = 0;
    }
  }
}

module.exports = ReplayScene;
