/**
 * 棋盘渲染（视觉 §6.1 + 补遗 §A/§B）
 *
 * 绘制顺序（重要，决定叠压正确性）：
 *   外框阴影 → 外框 → 格子底色/釉面 → 上一步 → 选中 → 将军 → 合法标记 → 坐标 → 棋子
 *
 * 补遗硬约束：
 *  - C1：坐标画在「外框刻度带」（frame 内侧），棋盘真居中，格子内不再出现任何坐标，
 *        彻底避免与棋子 / 走法点 / 吃子环重叠；紧凑屏（layout.isCompactW|isCompactH）
 *        自动降级为仅保留 a–h 一组（刻度带挤不下时也不回退到格内）。
 *  - C8 防泄题（最高优先级）：
 *      options.hideHighlights=true  → 压制 legalMoves 标记、lastMove、checkPos 高亮，
 *                                      但「保留选中象牙内环」（A.4.2 考核态选中棋子仍给框）。
 *      options.revealTarget={row,col} → 仅该格绘制金色脉冲环（金≠将军红），不受 hideHighlights 影响。
 *    drawMiniBoard 的 highlights 传 [] 即考核态（不绘制任何高亮）。
 *  - C4：所有脉冲相位用累计时间 options.time（毫秒）驱动，非帧计数；不传时回退 Date.now()（实时相位）。
 *
 * 六态语义（Phase 2·5，config.SEMANTIC.COLORS）：
 *   选中 = 象牙内环 · 合法空格 = 象牙实心点 · 合法吃子 = 酒红空心环 ·
 *   上一步 = 暖色半透明底 · 系统建议 = 青玉虚线+箭头（场景层绘制）· 将军 = 红色脉冲。
 *   棋盘两色均为中间明度，故每个标记按格明暗补一圈「自适应衬线」保证 ≥3:1（见 _casingFor）。
 *
 * 附加能力（供场景层做 B.5 触控补偿 / 落子动画）：
 *  - options.preview   {row,col,type,color,alpha} 落子前目标预览（半透明棋子 + 象牙内环）
 *  - options.skipPiece {row,col}                   跳过该格棋子，供场景层画飞行棋子
 *  - options.activeSquare {row,col}                对应行/列刻度加粗提亮
 *  - options.isCompact                             覆盖紧凑屏判定（缺省读 layout 单例）
 *  - options.topPiecesUpsideDown:boolean          屏幕上半区棋子旋转 180°（本地双人专用，默认 false）
 */
'use strict';

var config = require('../config');
var anim = require('../core/anim');
var layout = require('../core/layout');
var pieces = require('./pieces');
var drawPieceWithShadow = pieces.drawPieceWithShadow;
var C = config.COLORS;
var TAU = Math.PI * 2;

// 局部圆角矩形路径（避免与 ui.js 强耦合）
function _roundRect(ctx, x, y, w, h, r) {
  var rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

/** 逻辑坐标 -> 屏幕行列 */
function _toScreen(row, col, flip) {
  return { dr: flip ? 7 - row : row, dc: flip ? 7 - col : col };
}

/** 该屏幕格是否浅色（flip 不改变奇偶，故用屏幕行列即可） */
function _isLight(dr, dc) { return (dr + dc) % 2 === 0; }

/**
 * 标记衬线：棋盘深浅两色都是中间明度，单一色相不可能同时 ≥3:1。
 * 象牙/青玉在浅格对比不足 → 浅格补暗衬；酒红在深格对比不足 → 深格补亮衬。
 * @param {'ivory'|'jade'|'wine'} tone 标记主色相
 * @returns {string|null} 衬线色，null 表示该格底色上主色已达标、无需衬线
 */
function _casingFor(tone, dr, dc) {
  var light = _isLight(dr, dc);
  if (tone === 'wine') return light ? null : C.hlCaptureCasing;
  return light ? C.hlSelectedCasing : null;
}

/** 空心环（合法吃子）：r=cell×0.40, lw=cell×0.085，深格先打亮衬线再叠酒红 */
function _markRing(ctx, cx, cy, cell, tone, dr, dc, color, rRatio) {
  var r = cell * (rRatio || 0.40);
  var lw = Math.max(1.6, cell * 0.085);
  ctx.save();
  var casing = _casingFor(tone, dr, dc);
  if (casing) {
    // 衬线只比主色粗 1.6pt → 每侧 0.8pt 细边，避免"白圈盖住酒红"
    ctx.strokeStyle = casing;
    ctx.lineWidth = lw + 1.2;
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, TAU); ctx.stroke();
  }
  ctx.strokeStyle = color;
  ctx.lineWidth = lw;
  ctx.beginPath(); ctx.arc(cx, cy, r, 0, TAU); ctx.stroke();
  ctx.restore();
}

/** 实心点（合法空格）：r=cell×0.135，浅格先打暗衬线再叠象牙点 */
function _markDot(ctx, cx, cy, cell, tone, dr, dc, color) {
  var r = cell * 0.145;
  ctx.save();
  var casing = _casingFor(tone, dr, dc);
  if (casing) {
    ctx.strokeStyle = casing;
    ctx.globalAlpha = 0.7;   // 点的衬线再淡一点，避免浅格上被读成"空心圈"
    ctx.lineWidth = 1.0;
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, TAU); ctx.stroke();
  }
  ctx.fillStyle = color;
  ctx.beginPath(); ctx.arc(cx, cy, r, 0, TAU); ctx.fill();
  ctx.restore();
}

/** 金色环（揭晓 / 目标共用几何）：r=cell×0.42, lw=cell×0.1 */
function _goldRing(ctx, cx, cy, cell, color, alpha) {
  ctx.save();
  ctx.strokeStyle = color;
  if (typeof alpha === 'number') ctx.globalAlpha = Math.max(0, Math.min(1, alpha));
  ctx.lineWidth = cell * 0.1;
  ctx.beginPath();
  ctx.arc(cx, cy, cell * 0.42, 0, TAU);
  ctx.stroke();
  ctx.restore();
}

/** 紧凑屏判定（窄 <340 或矮 <620）：刻度带只保留 a–h 一组 */
function _isCompactLayout() {
  try {
    var L = layout.get();
    return !!(L && (L.isCompactW || L.isCompactH));
  } catch (e) { return false; }
}

/**
 * 刻度带字号：木框带只有 frame(10pt) 宽，直接套 FONTS.coordinate(11px) 会顶满整带、
 * 下缘压住内金发丝线。这里只按带宽等比收敛字号（字族/字重仍取 theme.font.coordinate，
 * 不新增/不改动任何字体 token）；frame=10 时为 9px bold。
 */
function _coordFont(frame) {
  var t = config.FONTS.coordinate || 'bold 11px sans-serif';
  var px = Math.max(8, Math.round(frame * 0.8));
  return /(\d+(\.\d+)?)px/.test(t) ? t.replace(/(\d+(\.\d+)?)px/, px + 'px') : (px + 'px ' + t);
}

/**
 * 外框刻度带：rank 画在左侧木框带（textAlign right，贴棋盘内缘），
 * file 画在上侧木框带（居中）。
 * @param {'none'|'both'|'rank'|'file'} mode
 */
function _drawCoordBand(ctx, x, y, cell, frame, flip, activeSquare, mode) {
  if (mode === 'none') return;
  // 木框带只有 frame(10pt) 宽：标签贴带外侧居中，并与棋盘内缘留 2.5pt，
  // 避免压到内金发丝线（否则小屏会看着像"字压在棋盘上"）。
  var edgeGap = 2;
  var baseY = y - Math.max(3, frame * 0.30);   // 基线：字底离棋盘内缘 ≥3pt，不压内金发丝线
  var activeDR = -1, activeDC = -1;
  if (activeSquare) {
    var as = _toScreen(activeSquare.row, activeSquare.col, flip);
    activeDR = as.dr; activeDC = as.dc;
  }
  ctx.save();
  ctx.font = _coordFont(frame);
  ctx.textBaseline = 'alphabetic';
  if (mode === 'both' || mode === 'rank') {
    ctx.textAlign = 'right';
    for (var dr = 0; dr < 8; dr++) {
      var rankChar = flip ? String(dr + 1) : String(8 - dr);
      ctx.fillStyle = (dr === activeDR) ? C.coordBandActive : C.coordBand;
      ctx.fillText(rankChar, x - edgeGap, y + dr * cell + cell / 2 + 3);
    }
  }
  if (mode === 'both' || mode === 'file') {
    ctx.textAlign = 'center';
    for (var dc = 0; dc < 8; dc++) {
      var fileChar = flip ? 'abcdefgh'[7 - dc] : 'abcdefgh'[dc];
      ctx.fillStyle = (dc === activeDC) ? C.coordBandActive : C.coordBand;
      ctx.fillText(fileChar, x + dc * cell + cell / 2, baseY);
    }
  }
  ctx.restore();
}

/**
 * 绘制完整棋盘
 * @param {CanvasRenderingContext2D} ctx
 * @param {Board} board 棋盘对象（需 getPiece(row,col)）
 * @param {object} options 见文件头说明
 */
function drawBoard(ctx, board, options) {
  options = options || {};
  var o = options;
  var x = o.x || 0;
  var y = o.y || 0;
  var cell = (typeof o.cellSize === 'number' && o.cellSize > 0) ? o.cellSize : 50;
  var flip = !!o.flip;
  // 本地双人：屏幕上半区棋子旋转 180°（按屏幕行 dr 判定，与 flip / piece.color 无关），默认 false。
  var topPiecesUpsideDown = !!o.topPiecesUpsideDown;
  var showCoordinates = o.showCoordinates !== false;
  var hideHighlights = !!o.hideHighlights;
  // hideHighlights 默认按补遗 A.4.2「保留选中象牙内环、只压制走法点」；
  // 场景层若选择「完全自绘选中环」（fe-logic 教学页方案），传 suppressSelectedFrame:true，
  // 则连选中环一并交给 drawBoard 不画，避免与场景自绘叠加成双环。
  var suppressSelectedFrame = !!o.suppressSelectedFrame;
  var selected = o.selected || null;
  var legalMoves = o.legalMoves || [];
  var lastMove = o.lastMove || null;
  var checkPos = o.checkPos || null;
  var revealTarget = o.revealTarget || null;
  var preview = o.preview || null;
  var skipPiece = o.skipPiece || null;
  var activeSquare = o.activeSquare || null;
  var time = (typeof o.time === 'number' && isFinite(o.time)) ? o.time : Date.now();
  var reduce = (typeof o.reduceMotion === 'boolean') ? o.reduceMotion : anim.getReduceMotion();

  var boardSize = cell * 8;
  var frame = config.BOARD.frame;
  // 坐标刻度模式：紧凑屏（窄/矮）只保留 a–h 一组，避免小屏木框带拥挤；
  // options.isCompact 可显式覆盖（离屏渲染 / 测试用），缺省读 layout 单例。
  var compact = (typeof o.isCompact === 'boolean') ? o.isCompact : _isCompactLayout();
  var coordMode = !showCoordinates ? 'none' : (compact ? 'file' : 'both');

  ctx.save();

  // ---- 1. 外框阴影 + 2. 木质外框（§6.1） ----
  var outerX = x - frame, outerY = y - frame;
  var outerW = boardSize + 2 * frame;
  var e2 = config.ELEVATION.e2;
  ctx.save();
  ctx.shadowColor = e2.color;
  ctx.shadowBlur = e2.blur;
  ctx.shadowOffsetY = e2.offsetY;
  var wood = ctx.createLinearGradient(outerX, outerY, outerX + outerW, outerY + outerW);
  wood.addColorStop(0, '#3A2E22');
  wood.addColorStop(1, C.boardFrame);
  ctx.fillStyle = wood;
  _roundRect(ctx, outerX, outerY, outerW, outerW, 6);
  ctx.fill();
  ctx.restore();

  // 金色内发丝线（内缩，accentDeep α.8）
  ctx.save();
  ctx.strokeStyle = C.accentDeep;
  ctx.globalAlpha = 0.8;
  ctx.lineWidth = 1;
  _roundRect(ctx, x - 2, y - 2, boardSize + 4, boardSize + 4, 5);
  ctx.stroke();
  ctx.restore();

  // 内层暗边（把棋盘「嵌」进框里）
  ctx.save();
  ctx.strokeStyle = '#0B0F13';
  ctx.lineWidth = 1;
  ctx.strokeRect(x - 0.5, y - 0.5, boardSize + 1, boardSize + 1);
  ctx.restore();

  // ---- 3. 格子底色 ----
  for (var r = 0; r < 8; r++) {
    for (var c = 0; c < 8; c++) {
      var s = _toScreen(r, c, flip);
      var px = x + s.dc * cell;
      var py = y + s.dr * cell;
      ctx.fillStyle = _isLight(s.dr, s.dc) ? C.boardLight : C.boardDark;
      ctx.fillRect(px, py, cell, cell);
    }
  }
  // 釉面：整盘一层极淡线性渐变（等价逐格釉面，但只 1 个渐变对象，性能更优，§6.1）
  var glaze = ctx.createLinearGradient(0, y, 0, y + boardSize);
  glaze.addColorStop(0, 'rgba(255,255,255,.05)');
  glaze.addColorStop(1, 'rgba(0,0,0,.04)');
  ctx.fillStyle = glaze;
  ctx.fillRect(x, y, boardSize, boardSize);

  // ---- 4. 上一步高亮（hideHighlights 时压制） ----
  if (!hideHighlights && lastMove) {
    var lmFrom = _toScreen(lastMove.fromRow, lastMove.fromCol, flip);
    var lmTo = _toScreen(lastMove.toRow, lastMove.toCol, flip);
    ctx.save();
    ctx.fillStyle = C.hlLastMove;
    ctx.fillRect(x + lmFrom.dc * cell, y + lmFrom.dr * cell, cell, cell);
    ctx.fillRect(x + lmTo.dc * cell, y + lmTo.dr * cell, cell, cell);
    // 起始格 4pt 左侧竖条（形状编码，色弱兜底 §4.5；暖色系，不用黄铜以免与"建议"混）
    ctx.fillStyle = C.hlLastMoveEdge;
    ctx.fillRect(x + lmFrom.dc * cell, y + lmFrom.dr * cell, 4, cell);
    ctx.restore();
  }

  // ---- 5. 选中高亮：象牙内环（不做满格填充，避免糊住棋子与格色） ----
  // hideHighlights 只压制"递信息"的层；选中是用户自己的操作结果，内环默认保留（补遗 A.4.2）。
  if (selected && !suppressSelectedFrame) {
    var sel = _toScreen(selected.row, selected.col, flip);
    var selX = x + sel.dc * cell, selY = y + sel.dr * cell;
    var selCasing = _casingFor('ivory', sel.dr, sel.dc);
    ctx.save();
    if (selCasing) {
      ctx.strokeStyle = selCasing;
      ctx.lineWidth = 3.6;   // 仅比主环粗 1.6pt → 每侧 0.8pt 细边，环仍读到"象牙"
      _roundRect(ctx, selX + 3, selY + 3, cell - 6, cell - 6, config.RADIUS.chip);
      ctx.stroke();
    }
    ctx.strokeStyle = C.hlSelectedRing;
    ctx.lineWidth = 2;
    _roundRect(ctx, selX + 3, selY + 3, cell - 6, cell - 6, config.RADIUS.chip);
    ctx.stroke();
    ctx.restore();
  }

  // ---- 6. 将军高亮（红色径向脉冲 + 红环；hideHighlights 时压制） ----
  if (!hideHighlights && checkPos) {
    var ck = _toScreen(checkPos.row, checkPos.col, flip);
    var ccx = x + ck.dc * cell + cell / 2;
    var ccy = y + ck.dr * cell + cell / 2;
    var cAlpha = reduce ? 0.5 : (0.35 + 0.4 * anim.pulse01(time, 300));
    var rg = ctx.createRadialGradient(ccx, ccy, cell * 0.1, ccx, ccy, cell * 0.62);
    rg.addColorStop(0, hexToRgbaSafe(C.danger, cAlpha));
    rg.addColorStop(1, hexToRgbaSafe(C.danger, 0));
    ctx.save();
    ctx.fillStyle = rg;
    ctx.fillRect(x + ck.dc * cell, y + ck.dr * cell, cell, cell);
    // 脉冲环：让"将军"在静态截图里也能被认出（径向渐变单独看偏弱）
    ctx.strokeStyle = hexToRgbaSafe(C.danger, reduce ? 0.75 : (0.55 + 0.35 * anim.pulse01(time, 300)));
    ctx.lineWidth = Math.max(1.5, cell * 0.05);
    ctx.beginPath(); ctx.arc(ccx, ccy, cell * 0.40, 0, TAU); ctx.stroke();
    ctx.restore();
  }

  // ---- 7. 合法走法标记（hideHighlights 时一律不画，防泄题核心） ----
  if (!hideHighlights && legalMoves.length > 0) {
    for (var i = 0; i < legalMoves.length; i++) {
      var m = legalMoves[i];
      var ms = _toScreen(m.toRow, m.toCol, flip);
      var mcx = x + ms.dc * cell + cell / 2;
      var mcy = y + ms.dr * cell + cell / 2;
      var target = (board && board.getPiece) ? board.getPiece(m.toRow, m.toCol) : null;
      var isCapture = !!target || !!m.isCapture || !!m.capture || !!m.isEnPassant;
      if (isCapture) {
        // 吃子：酒红空心环（不填充，保留被吃子可见）
        _markRing(ctx, mcx, mcy, cell, 'wine', ms.dr, ms.dc, C.hlCaptureRing);
      } else {
        // 空格：象牙实心点
        _markDot(ctx, mcx, mcy, cell, 'ivory', ms.dr, ms.dc, C.hlLegalDot);
      }
    }
  }

  // ---- 揭晓金环（独立于三级反馈；REVEAL 态仅此一处；金≠将军红；不受 hideHighlights 影响） ----
  if (revealTarget) {
    var rv = _toScreen(revealTarget.row, revealTarget.col, flip);
    var rvx = x + rv.dc * cell + cell / 2;
    var rvy = y + rv.dr * cell + cell / 2;
    var rAlpha = reduce ? 0.5 : anim.revealPulseAlpha(time, o.revealStart);
    _goldRing(ctx, rvx, rvy, cell, C.accent, rAlpha);
  }

  // ---- 8. 坐标：外移到木框刻度带（格内不再出现任何文字，永不与棋子/走法点重叠） ----
  _drawCoordBand(ctx, x, y, cell, frame, flip, activeSquare, coordMode);

  // ---- 9. 棋子 ----
  if (board && board.getPiece) {
    for (var pr = 0; pr < 8; pr++) {
      for (var pc = 0; pc < 8; pc++) {
        if (skipPiece && skipPiece.row === pr && skipPiece.col === pc) continue;
        var piece = board.getPiece(pr, pc);
        if (!piece) continue;
        var ps = _toScreen(pr, pc, flip);
        var pcx = x + ps.dc * cell + cell / 2;
        var pcy = y + ps.dr * cell + cell / 2;
        var isSelected = !!selected && selected.row === pr && selected.col === pc;
        // 考核态不放大/发光，仅正常绘制；选中象牙内环已在第 5 步绘制
        var glow = isSelected && !hideHighlights;
        // 按「屏幕行」判定：dr 0..3 为屏幕上半区；flip 翻转后同一子会换到另一侧，旋转随之改变。
        var pieceOpts = { selected: glow };
        if (topPiecesUpsideDown && ps.dr < 4) pieceOpts.rotate180 = true;
        drawPieceWithShadow(ctx, piece.type, piece.color, pcx, pcy, cell, pieceOpts);
      }
    }
  }

  // ---- 落子前目标预览（B.5 触控补偿）：半透明棋子 + 象牙内环 ----
  if (preview) {
    var pv = _toScreen(preview.row, preview.col, flip);
    var pvx = x + pv.dc * cell, pvy = y + pv.dr * cell;
    ctx.save();
    ctx.strokeStyle = C.hlSelectedRing;
    ctx.lineWidth = 2;
    _roundRect(ctx, pvx + 2, pvy + 2, cell - 4, cell - 4, config.RADIUS.chip);
    ctx.stroke();
    ctx.restore();
    if (preview.type) {
      // preview 也在棋盘上，旋转判定与棋子循环一致（按屏幕行 dr）。
      var previewOpts = { alpha: typeof preview.alpha === 'number' ? preview.alpha : 0.5 };
      if (topPiecesUpsideDown && pv.dr < 4) previewOpts.rotate180 = true;
      drawPieceWithShadow(ctx, preview.type, preview.color || 'w',
        pvx + cell / 2, pvy + cell / 2, cell, previewOpts);
    }
  }

  ctx.restore();
}

// ===========================================================================
// 通用棋盘渲染（V2_VISUAL_SPEC §5 多棋类可插拔契约）
// ---------------------------------------------------------------------------
// drawBoardGeneric(ctx, state, opts) 支持可变行列 + 两种网格（square 格心 / intersection|lines 线交点）
// + 三种棋子样式（unicode 符号 / disc-char 汉字圆子 / stone 黑白圆子）。
// 与 drawBoard 共享同一套「品牌高亮语义 + 形状编码」色值，切棋种只换 gameSkin。
// 现有 drawBoard / drawMiniBoard 保持原实现不变，作为国际象棋兼容高效路径。
// ===========================================================================

/** 通用取子：兼容 getPiece(r,c) / cells[]（扁平） / grid[][]（二维） */
function _pieceAt(state, r, c, cols) {
  if (!state) return null;
  if (typeof state.getPiece === 'function') {
    try { return state.getPiece(r, c); } catch (e) { return null; }
  }
  if (Array.isArray(state.cells)) return state.cells[r * cols + c] || null;
  if (Array.isArray(state.grid)) return (state.grid[r] && state.grid[r][c]) || null;
  return null;
}

/** 归一化棋子：返回 {type, side, char, white}；兼容 {type,color} 与 {kind,side} */
function _normPiece(p) {
  if (!p) return null;
  var type = p.type || p.kind || 'p';
  var side = p.color || p.side || 'w';
  var white = (side === 'w' || side === 'white' || side === 'red' || side === 'r');
  return { type: type, side: side, char: p.char || p.label || null, white: white };
}

/** 逻辑坐标 -> 屏幕格（通用 cols/rows） */
function _gScreen(row, col, flip, rows, cols) {
  return { dr: flip ? (rows - 1 - row) : row, dc: flip ? (cols - 1 - col) : col };
}

/** 通用几何：把逻辑 (row,col) 映射到屏幕中心 cx,cy 与一个 cell 盒 rect（供高亮 tint） */
function _gGeom(row, col, opts, rows, cols) {
  var cell = opts.cellSize;
  var s = _gScreen(row, col, opts.flip, rows, cols);
  if (opts.pointMode) {
    var cx = opts.ox + s.dc * cell;
    var cy = opts.oy + s.dr * cell;
    return { cx: cx, cy: cy, rx: cx - cell / 2, ry: cy - cell / 2 };
  }
  var rx = opts.x + s.dc * cell;
  var ry = opts.y + s.dr * cell;
  return { cx: rx + cell / 2, cy: ry + cell / 2, rx: rx, ry: ry };
}

/** 棋子样式：unicode（复用现有 drawPieceWithShadow，含描边底线） */
function _drawUnicodePiece(ctx, p, cx, cy, cell, opts) {
  // 国际象棋沿用现有渲染（白描边#2A2A28 / 黑金边#C9A24B 不可省）
  drawPieceWithShadow(ctx, p.type, p.white ? 'w' : 'b', cx, cy, cell, { selected: !!opts.pieceSelected });
}

/** 棋子样式：disc-char（中国象棋圆形汉字子） */
function _drawDiscChar(ctx, p, cx, cy, cell, skin) {
  var P = skin && skin.PIECE ? skin.PIECE : {};
  var fill = p.white ? (P.redFill || '#C0392B') : (P.blackFill || '#2A2A28');
  var stroke = P.discStroke || C.accentDeep;
  var r = cell * 0.42;
  ctx.save();
  // 底投影
  ctx.shadowColor = 'rgba(0,0,0,.35)';
  ctx.shadowBlur = cell * 0.12;
  ctx.shadowOffsetY = cell * 0.045;
  ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fillStyle = fill; ctx.fill();
  ctx.shadowColor = 'transparent'; ctx.shadowBlur = 0; ctx.shadowOffsetY = 0;
  // 双层描边（器物感）：外深边 + 内金线
  ctx.lineWidth = Math.max(1.5, cell * 0.035); ctx.strokeStyle = stroke; ctx.stroke();
  ctx.beginPath(); ctx.arc(cx, cy, r * 0.82, 0, Math.PI * 2);
  ctx.lineWidth = 1; ctx.strokeStyle = C.accentSoft; ctx.globalAlpha = 0.7; ctx.stroke();
  ctx.globalAlpha = 1;
  // 汉字
  var ch = p.char || (config.PIECE_NAMES_BY_KIND && config.PIECE_NAMES_BY_KIND[p.type]) || p.type;
  var fs = cell * ((skin && skin.pieceSizeRatio) || 0.62);
  ctx.font = 'bold ' + fs + 'px serif';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillStyle = C.textPrimary;
  ctx.fillText(String(ch), cx, cy + fs * 0.02);
  ctx.restore();
}

/** 棋子样式：stone（五子棋/围棋黑白圆子，径向渐变高光，描边保轮廓） */
function _drawStone(ctx, p, cx, cy, cell, skin) {
  var P = skin && skin.PIECE ? skin.PIECE : {};
  var r = cell * ((skin && skin.pieceRadiusRatio) || 0.44);
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,.30)';
  ctx.shadowBlur = cell * 0.10;
  ctx.shadowOffsetY = cell * 0.05;
  var g = ctx.createRadialGradient(cx - r * 0.3, cy - r * 0.35, r * 0.1, cx, cy, r);
  if (p.white) {
    g.addColorStop(0, '#FFFFFF');
    g.addColorStop(0.6, P.whiteFill || '#F7F1E3');
    g.addColorStop(1, '#CBBFA6');
  } else {
    g.addColorStop(0, '#5A6672');
    g.addColorStop(0.55, P.blackFill || '#1A1A1A');
    g.addColorStop(1, '#050708');
  }
  ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fillStyle = g; ctx.fill();
  ctx.shadowColor = 'transparent'; ctx.shadowBlur = 0; ctx.shadowOffsetY = 0;
  // 细描边：白子在浅木底需保轮廓（可访问性底线精神）
  ctx.lineWidth = Math.max(1, cell * 0.02);
  ctx.strokeStyle = p.white ? 'rgba(42,42,40,.55)' : C.accent;
  ctx.globalAlpha = p.white ? 0.55 : 0.85;
  ctx.stroke();
  ctx.restore();
}

/**
 * 通用棋盘绘制（多棋类可插拔，V2_VISUAL_SPEC §5）
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {object} state 局面：支持
 *    - getPiece(row,col) 方法（现有 Board），或
 *    - cells: Array<rows*cols>（Piece|null），或
 *    - grid: Piece[rows][cols]
 *    Piece 兼容 {type,color}（chess）或 {kind,side,char}（新棋种）。
 * @param {object} opts
 *   - x, y, cellSize             几何（square 模式 x/y 为棋盘左上角；交点模式自动内缩 pad）
 *   - grid:{cols,rows,type}      type: 'square' | 'intersection' | 'lines'；默认 8×8 square
 *   - gameSkin                    config.getGameSkin(gameId) 的返回；缺省用 chess
 *   - pieceStyle                  'unicode'|'disc-char'|'stone'；缺省取 gameSkin.pieceStyle
 *   - flip, showCoordinates, coordLabel(row,col,cols,rows)
 *   - hideHighlights, suppressSelectedFrame, selected{row,col}, legalMoves[{toRow,toCol,isCapture}],
 *     lastMove{fromRow,fromCol,toRow,toCol}, checkPos{row,col}, revealTarget{row,col}, revealStart,
 *     preview{row,col,type,color,alpha}, skipPiece{row,col}, activeSquare{row,col},
 *     time(ms), reduceMotion
 *   - starPoints: number[]       交点模式星位行列索引（围棋）
 *   - frame                       外框宽（默认取 config.BOARD.frame）
 */
function drawBoardGeneric(ctx, state, opts) {
  if (!ctx) return;
  opts = opts || {};
  var skin = opts.gameSkin || config.getGameSkin(opts.gameId) || config.getGameSkin();
  var grid = opts.grid || skin.grid || { cols: 8, rows: 8, type: 'square' };
  var cols = Math.max(2, grid.cols || 8);
  var rows = Math.max(2, grid.rows || 8);
  var gridType = grid.type || 'square';
  var pointMode = (gridType === 'intersection' || gridType === 'lines');
  var cell = (typeof opts.cellSize === 'number' && opts.cellSize > 0) ? opts.cellSize : 40;
  var flip = !!opts.flip;
  var showCoordinates = opts.showCoordinates !== false && !pointMode; // 交点棋种默认不画坐标
  var hideHighlights = !!opts.hideHighlights;
  var suppressSelectedFrame = !!opts.suppressSelectedFrame;
  var selected = opts.selected || null;
  var legalMoves = opts.legalMoves || [];
  var lastMove = opts.lastMove || null;
  var checkPos = opts.checkPos || null;
  var revealTarget = opts.revealTarget || null;
  var preview = opts.preview || null;
  var skipPiece = opts.skipPiece || null;
  var activeSquare = opts.activeSquare || null;
  var reduce = (typeof opts.reduceMotion === 'boolean') ? opts.reduceMotion : anim.getReduceMotion();
  var time = (typeof opts.time === 'number' && isFinite(opts.time)) ? opts.time : Date.now();
  var frame = (typeof opts.frame === 'number') ? opts.frame : config.BOARD.frame;

  var boardLight = skin.boardLight || C.boardLight;
  var boardDark = skin.boardDark || C.boardDark;
  var pieceStyle = opts.pieceStyle || skin.pieceStyle || 'unicode';

  // 交点模式：内缩半格 pad，保证边缘棋子不被裁切
  var pad = pointMode ? cell / 2 : 0;
  var ox = pad ? (opts.x + pad) : opts.x;
  var oy = pad ? (opts.y + pad) : opts.y;
  opts.ox = ox; opts.oy = oy; opts.pointMode = pointMode;

  var contentW = pointMode ? (cols - 1) * cell : cols * cell;
  var contentH = pointMode ? (rows - 1) * cell : rows * cell;
  var boardX = pointMode ? (opts.x) : opts.x;
  var boardY = pointMode ? (opts.y) : opts.y;
  // 外框覆盖整个「格区 + pad」
  var frameW = (pointMode ? contentW + cell : contentW);
  var frameH = (pointMode ? contentH + cell : contentH);

  ctx.save();

  // ---- 外框（阴影 + 木质渐变 + 金发丝线），与 drawBoard 同视觉语言 ----
  var outerX = boardX - frame, outerY = boardY - frame;
  var outerW = frameW + 2 * frame, outerH = frameH + 2 * frame;
  var e2 = config.ELEVATION.e2;
  ctx.save();
  ctx.shadowColor = e2.color; ctx.shadowBlur = e2.blur; ctx.shadowOffsetY = e2.offsetY;
  var wood = ctx.createLinearGradient(outerX, outerY, outerX + outerW, outerY + outerH);
  wood.addColorStop(0, '#3A2E22'); wood.addColorStop(1, C.boardFrame);
  ctx.fillStyle = wood;
  _roundRect(ctx, outerX, outerY, outerW, outerH, 6);
  ctx.fill();
  ctx.restore();

  ctx.save();
  ctx.strokeStyle = C.accentDeep; ctx.globalAlpha = 0.8; ctx.lineWidth = 1;
  _roundRect(ctx, boardX - 2, boardY - 2, frameW + 4, frameH + 4, 5);
  ctx.stroke();
  ctx.restore();

  // ---- 格底 ----
  var r, c, gx, gy;
  if (!pointMode) {
    for (r = 0; r < rows; r++) {
      for (c = 0; c < cols; c++) {
        var sc = _gScreen(r, c, flip, rows, cols);
        gx = boardX + sc.dc * cell; gy = boardY + sc.dr * cell;
        ctx.fillStyle = ((sc.dr + sc.dc) % 2 === 0) ? boardLight : boardDark;
        ctx.fillRect(gx, gy, cell, cell);
      }
    }
    // 釉面
    var glaze = ctx.createLinearGradient(0, boardY, 0, boardY + contentH);
    glaze.addColorStop(0, 'rgba(255,255,255,.05)');
    glaze.addColorStop(1, 'rgba(0,0,0,.04)');
    ctx.fillStyle = glaze; ctx.fillRect(boardX, boardY, contentW, contentH);
  } else {
    // 交点/线格：实心底 + 网格线
    ctx.fillStyle = boardLight;
    ctx.fillRect(boardX, boardY, frameW, frameH);
    ctx.save();
    ctx.strokeStyle = hexToRgbaSafe(boardDark || C.coordOnLight, 0.55);
    ctx.lineWidth = 1;
    for (c = 0; c < cols; c++) {
      gx = ox + c * cell;
      ctx.beginPath(); ctx.moveTo(gx + 0.5, oy); ctx.lineTo(gx + 0.5, oy + contentH); ctx.stroke();
    }
    for (r = 0; r < rows; r++) {
      gy = oy + r * cell;
      ctx.beginPath(); ctx.moveTo(ox, gy + 0.5); ctx.lineTo(ox + contentW, gy + 0.5); ctx.stroke();
    }
    ctx.restore();
    // 星位（围棋）
    var stars = opts.starPoints || skin.starPoints;
    if (stars && stars.length) {
      ctx.save(); ctx.fillStyle = C.accentDeep;
      for (var si = 0; si < stars.length; si++) {
        for (var sj = 0; sj < stars.length; sj++) {
          var sr = stars[si], scol = stars[sj];
          if (sr >= 0 && sr < rows && scol >= 0 && scol < cols) {
            var sg = _gGeom(sr, scol, opts, rows, cols);
            ctx.beginPath(); ctx.arc(sg.cx, sg.cy, 3, 0, Math.PI * 2); ctx.fill();
          }
        }
      }
      ctx.restore();
    }
  }

  // ---- 高亮层（与 drawBoard 同形状编码；hideHighlights 一律压制泄题层） ----
  if (!hideHighlights && lastMove) {
    var lf = _gGeom(lastMove.fromRow, lastMove.fromCol, opts, rows, cols);
    var lt = _gGeom(lastMove.toRow, lastMove.toCol, opts, rows, cols);
    ctx.save(); ctx.fillStyle = C.hlLastMove;
    ctx.fillRect(lf.rx, lf.ry, cell, cell);
    ctx.fillRect(lt.rx, lt.ry, cell, cell);
    ctx.fillStyle = C.accentSoft; ctx.globalAlpha = 0.6;
    ctx.fillRect(lf.rx, lf.ry, 4, cell); // 起始格左竖条
    ctx.restore();
  }

  if (selected && !suppressSelectedFrame) {
    var sg2 = _gGeom(selected.row, selected.col, opts, rows, cols);
    var sg2s = _gScreen(selected.row, selected.col, flip, rows, cols);
    // 与 drawBoard 同语义：象牙内环 + 浅格暗衬线（不做满格填充）
    ctx.save();
    if (!hideHighlights) {
      var gCasing = _casingFor('ivory', sg2s.dr, sg2s.dc);
      if (gCasing) {
        ctx.strokeStyle = gCasing; ctx.lineWidth = 3.6;
        _roundRect(ctx, sg2.rx + 3, sg2.ry + 3, cell - 6, cell - 6, config.RADIUS.chip); ctx.stroke();
      }
    }
    ctx.strokeStyle = C.hlSelectedRing; ctx.lineWidth = 2;
    _roundRect(ctx, sg2.rx + 3, sg2.ry + 3, cell - 6, cell - 6, config.RADIUS.chip); ctx.stroke();
    ctx.restore();
  }

  if (!hideHighlights && checkPos) {
    var cg = _gGeom(checkPos.row, checkPos.col, opts, rows, cols);
    var cAlpha = reduce ? 0.5 : (0.35 + 0.4 * anim.pulse01(time, 300));
    var rg = ctx.createRadialGradient(cg.cx, cg.cy, cell * 0.1, cg.cx, cg.cy, cell * 0.62);
    rg.addColorStop(0, hexToRgbaSafe(C.danger, cAlpha));
    rg.addColorStop(1, hexToRgbaSafe(C.danger, 0));
    ctx.save();
    ctx.fillStyle = rg; ctx.fillRect(cg.rx, cg.ry, cell, cell);
    ctx.strokeStyle = hexToRgbaSafe(C.danger, reduce ? 0.75 : (0.55 + 0.35 * anim.pulse01(time, 300)));
    ctx.lineWidth = Math.max(1.5, cell * 0.05);
    ctx.beginPath(); ctx.arc(cg.cx, cg.cy, cell * 0.40, 0, TAU); ctx.stroke();
    ctx.restore();
  }

  if (!hideHighlights && legalMoves.length) {
    for (var i = 0; i < legalMoves.length; i++) {
      var m = legalMoves[i];
      var mg = _gGeom(m.toRow, m.toCol, opts, rows, cols);
      var mgs = _gScreen(m.toRow, m.toCol, flip, rows, cols);
      var target = _pieceAt(state, m.toRow, m.toCol, cols);
      var isCapture = !!target || !!m.isCapture || !!m.capture || !!m.isEnPassant;
      if (isCapture) _markRing(ctx, mg.cx, mg.cy, cell, 'wine', mgs.dr, mgs.dc, C.hlCaptureRing);
      else _markDot(ctx, mg.cx, mg.cy, cell, 'ivory', mgs.dr, mgs.dc, C.hlLegalDot);
    }
  }

  // 揭晓金环（不受 hideHighlights 影响，REVEAL 仅此一处，金≠将军红）
  if (revealTarget) {
    var rv = _gGeom(revealTarget.row, revealTarget.col, opts, rows, cols);
    var rAlpha = reduce ? 0.5 : anim.revealPulseAlpha(time, opts.revealStart);
    _goldRing(ctx, rv.cx, rv.cy, cell, C.accent, rAlpha);
  }

  // ---- 坐标（square 模式，画入外框刻度带：rank 左带 / file 上带，不下探格内） ----
  if (showCoordinates) {
    var aDR = activeSquare ? _gScreen(activeSquare.row, activeSquare.col, flip, rows, cols).dr : -1;
    var aDC = activeSquare ? _gScreen(activeSquare.row, activeSquare.col, flip, rows, cols).dc : -1;
    var cpad = Math.max(2.5, frame * 0.25);
    var cbase = boardY - Math.max(3, frame * 0.30);
    ctx.save(); ctx.font = _coordFont(frame);
    ctx.textAlign = 'right'; ctx.textBaseline = 'alphabetic';
    for (var dr = 0; dr < rows; dr++) {
      var logicalRow = flip ? (rows - 1 - dr) : dr;
      ctx.fillStyle = (dr === aDR) ? C.coordBandActive : C.coordBand;
      ctx.fillText(String(rows - logicalRow), boardX - cpad, boardY + dr * cell + cell / 2 + 3);
    }
    ctx.textAlign = 'center';
    for (var dc = 0; dc < cols; dc++) {
      var logicalCol = flip ? (cols - 1 - dc) : dc;
      ctx.fillStyle = (dc === aDC) ? C.coordBandActive : C.coordBand;
      ctx.fillText('abcdefghijklmnop'[logicalCol], boardX + dc * cell + cell / 2, cbase);
    }
    ctx.restore();
  }

  // ---- 棋子 ----
  for (var pr = 0; pr < rows; pr++) {
    for (var pc = 0; pc < cols; pc++) {
      if (skipPiece && skipPiece.row === pr && skipPiece.col === pc) continue;
      var raw = _pieceAt(state, pr, pc, cols);
      if (!raw) continue;
      var np = _normPiece(raw);
      var pg = _gGeom(pr, pc, opts, rows, cols);
      var isSel = !!selected && selected.row === pr && selected.col === pc;
      opts.pieceSelected = isSel && !hideHighlights;
      if (pieceStyle === 'disc-char') {
        _drawDiscChar(ctx, np, pg.cx, pg.cy, cell, skin);
      } else if (pieceStyle === 'stone') {
        _drawStone(ctx, np, pg.cx, pg.cy, cell, skin);
      } else {
        _drawUnicodePiece(ctx, np, pg.cx, pg.cy, cell, opts);
      }
    }
  }
  opts.pieceSelected = false;

  // ---- 落子预览 ----
  if (preview) {
    var pvg = _gGeom(preview.row, preview.col, opts, rows, cols);
    ctx.save(); ctx.strokeStyle = C.hlSelectedRing; ctx.lineWidth = 2;
    _roundRect(ctx, pvg.rx + 2, pvg.ry + 2, cell - 4, cell - 4, config.RADIUS.chip); ctx.stroke();
    ctx.restore();
    if (preview.type || preview.kind) {
      var npv = _normPiece({ type: preview.type || preview.kind, color: preview.color || preview.side });
      ctx.save(); ctx.globalAlpha = (typeof preview.alpha === 'number') ? preview.alpha : 0.5;
      if (pieceStyle === 'disc-char') _drawDiscChar(ctx, npv, pvg.cx, pvg.cy, cell, skin);
      else if (pieceStyle === 'stone') _drawStone(ctx, npv, pvg.cx, pvg.cy, cell, skin);
      else _drawUnicodePiece(ctx, npv, pvg.cx, pvg.cy, cell, opts);
      ctx.restore();
    }
  }

  ctx.restore();
}

/** 内部：把 hex/任意色转 rgba（失败原样返回），仅通用棋盘用 */
function hexToRgbaSafe(color, alpha) {
  if (typeof color !== 'string') return color;
  if (color.charAt(0) === '#') {
    var h = color.length === 4
      ? '#' + color[1] + color[1] + color[2] + color[2] + color[3] + color[3]
      : color;
    if (h.length === 7) {
      var rr = parseInt(h.slice(1, 3), 16), gg = parseInt(h.slice(3, 5), 16), bb = parseInt(h.slice(5, 7), 16);
      if (!isNaN(rr) && !isNaN(gg) && !isNaN(bb)) return 'rgba(' + rr + ',' + gg + ',' + bb + ',' + alpha + ')';
    }
  }
  return color;
}

/**
 * 绘制教学迷你棋盘（签名不变）
 * @param {object[]} highlights 每项 {row,col,color?} 或 {row,col,kind:'move'|'capture'|'key'|'target'}
 *   传 [] 即考核态（不绘制任何高亮，防泄题）。
 */
function drawMiniBoard(ctx, board, x, y, cellSize, highlights) {
  if (!ctx) return;
  var cell = (typeof cellSize === 'number' && cellSize > 0) ? cellSize : 38;
  var boardSize = cell * 8;
  var frame = 8; // §8.5 迷你棋盘外框按 6.1 缩放（框宽 8pt）

  ctx.save();

  // 外框（木质渐变 + 金色发丝线，缩放版）
  var outerW = boardSize + 2 * frame;
  var e2 = config.ELEVATION.e2;
  ctx.save();
  ctx.shadowColor = e2.color;
  ctx.shadowBlur = Math.max(6, e2.blur * 0.6);
  ctx.shadowOffsetY = Math.max(2, e2.offsetY * 0.6);
  var wood = ctx.createLinearGradient(x - frame, y - frame, x - frame + outerW, y - frame + outerW);
  wood.addColorStop(0, '#3A2E22');
  wood.addColorStop(1, C.boardFrame);
  ctx.fillStyle = wood;
  _roundRect(ctx, x - frame, y - frame, outerW, outerW, 5);
  ctx.fill();
  ctx.restore();

  ctx.save();
  ctx.strokeStyle = C.accentDeep;
  ctx.globalAlpha = 0.8;
  ctx.lineWidth = 1;
  _roundRect(ctx, x - 1.5, y - 1.5, boardSize + 3, boardSize + 3, 4);
  ctx.stroke();
  ctx.restore();

  var hls = highlights || [];
  for (var r = 0; r < 8; r++) {
    for (var c = 0; c < 8; c++) {
      var px = x + c * cell;
      var py = y + r * cell;
      ctx.fillStyle = _isLight(r, c) ? C.boardLight : C.boardDark;
      ctx.fillRect(px, py, cell, cell);

      // 高亮（几何标记，去 emoji）
      for (var i = 0; i < hls.length; i++) {
        var h = hls[i];
        if (h.row !== r || h.col !== c) continue;
        var cx = px + cell / 2, cy = py + cell / 2;
        if (h.kind === 'move') {
          _markDot(ctx, cx, cy, cell, 'ivory', r, c, C.hlLegalDot);
        } else if (h.kind === 'capture') {
          _markRing(ctx, cx, cy, cell, 'wine', r, c, C.hlCaptureRing);
        } else if (h.kind === 'target') {
          _goldRing(ctx, cx, cy, cell, C.accent, undefined);
        } else if (h.kind === 'key') {
          ctx.save();
          ctx.strokeStyle = C.danger;
          ctx.lineWidth = cell * 0.1;
          ctx.beginPath(); ctx.arc(cx, cy, cell * 0.42, 0, Math.PI * 2); ctx.stroke();
          ctx.restore();
        } else {
          // 兼容旧 {color} 覆盖层
          ctx.save();
          ctx.fillStyle = h.color || C.hlLegalDot;
          ctx.fillRect(px, py, cell, cell);
          ctx.restore();
        }
      }

      var piece = (board && board.getPiece) ? board.getPiece(r, c) : null;
      if (piece) {
        drawPieceWithShadow(ctx, piece.type, piece.color, px + cell / 2, py + cell / 2, cell);
      }
    }
  }

  ctx.restore();
}

module.exports = {
  drawBoard: drawBoard,
  drawMiniBoard: drawMiniBoard,
  drawBoardGeneric: drawBoardGeneric
};
