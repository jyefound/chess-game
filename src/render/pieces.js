/**
 * 棋子绘制 · 全矢量路径版（Phase 1 / P0）
 *
 * 背景：旧版用系统 Unicode 棋子字形（♔♕♖♗♘♙♚♛♜♝♞♟）绘制，在 Android / 微信 /
 * 缺字形环境下会渲染成方框(tofu)，属发布阻断级缺陷。本文件改为 Canvas2D 路径自绘
 * 12 枚棋子（白♔♕♖♗♘♙、黑对应），彻底消除对系统字形的依赖。
 *
 * 视觉语言（对齐品牌「墨金棋院」/ BRAND.md / V2_VISUAL_SPEC.md）：
 *  - 白子：象牙色上亮下暗渐变填充（#F7F1E3→#DDD3BC）+ 深墨描边（#2A2A28，lw≈3.5），
 *    浅格上白填充对比仅≈1.1:1，全靠描边保轮廓（品牌可访问性底线）。
 *  - 黑子：墨底上亮下暗渐变填充（#38434E→#10151B）+ 黄铜描边（#C9A24B，lw≈3），
 *    签名细节；墨底与深格对比≈2.5:1，靠金边区分。
 *
 * 性能：6 型 ×2 色 = 12 枚，每枚按 size(整数化)×DPR 在离屏 canvas 预渲染并缓存，
 * 主循环只 drawImage。离屏用 wx.createCanvas（微信首次返回主画布、之后返回离屏）；
 * 探测不到离屏能力时自动回退逐帧直绘。DPR 取自 wx.getSystemInfoSync().pixelRatio（默认 2）。
 *
 * 调用签名与旧版完全兼容：drawPiece(ctx,type,color,x,y,size,opts?)、
 * drawPieceWithShadow(ctx,type,color,x,y,size,opts?)、clearPieceCache()。
 * 调用方已 scale（无需关心 DPR 缩放绘制）；离屏图集按 DPR 预渲染。
 */

'use strict';

var config = require('../config');
var constants = require('../core/constants');
var COLOR = constants.COLOR;
var C = config.COLORS;

// ---- 离屏缓存 ----
var _dpr = null;
var _cache = {};        // key -> offscreen canvas（干净棋子，透明背景，无投影）
var _cacheOrder = [];   // 简易 LRU 顺序
var _CACHE_MAX = 48;
var _cacheAvailable = null; // null=未探测 / true / false

function _getDpr() {
  if (_dpr !== null) return _dpr;
  try {
    if (typeof wx !== 'undefined' && wx.getSystemInfoSync) {
      _dpr = wx.getSystemInfoSync().pixelRatio || 2;
    } else {
      _dpr = 2;
    }
  } catch (e) { _dpr = 2; }
  return _dpr;
}

function _probeCache() {
  if (_cacheAvailable !== null) return _cacheAvailable;
  try {
    // 微信小游戏：首次 wx.createCanvas() 返回主画布，后续调用返回离屏画布
    if (typeof wx !== 'undefined' && typeof wx.createCanvas === 'function') {
      _cacheAvailable = true;
    } else {
      _cacheAvailable = false;
    }
  } catch (e) { _cacheAvailable = false; }
  return _cacheAvailable;
}

// ===========================================================================
// 矢量棋子路径（局部坐标 0..100，中心约 (50,50)，底约 y=90）
// 每个绘制函数只负责「描边+填充」「已被外部设置好」的图元；调用方先设好渐变填充与描边。
// ===========================================================================
function _disc(ctx, x, y, r) {
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
}
function _rrect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
}
function _poly(ctx, pts) {
  ctx.beginPath();
  ctx.moveTo(pts[0][0], pts[0][1]);
  for (var i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
}
// 通用底座（所有棋子共享，保证视觉一致）
function _pedestal(ctx) {
  _rrect(ctx, 26, 60, 48, 30, 7);   // 主体至底座
  _rrect(ctx, 23, 84, 54, 10, 5);    // 底座足
}

// ---- 兵 Pawn ----
function _p_pawn(ctx) {
  _disc(ctx, 50, 27, 13);                       // 头
  _poly(ctx, [[40, 42], [60, 42], [65, 62], [35, 62]]); // 颈/身
  _pedestal(ctx);
}
// ---- 车 Rook ----
function _p_rook(ctx) {
  _rrect(ctx, 30, 30, 40, 56, 4);              // 主体
  _rrect(ctx, 27, 20, 11, 13, 2);              // 左垛
  _rrect(ctx, 45, 20, 10, 13, 2);              // 中垛
  _rrect(ctx, 62, 20, 11, 13, 2);              // 右垛
  _rrect(ctx, 24, 82, 52, 10, 5);              // 底座足
}
// ---- 马 Knight（朝左的程式化马头）----
function _p_knight(ctx) {
  _poly(ctx, [
    [30, 88], [26, 76], [32, 60], [40, 46],    // 后颈
    [34, 34], [28, 28], [38, 22], [48, 28],     // 耳/额
    [60, 22], [70, 32],                          // 鼻梁至马嘴
    [66, 42], [54, 46],                          // 嘴/下颌
    [58, 58], [50, 70], [56, 80], [66, 82], [72, 90] // 喉至前足
  ]);
  _rrect(ctx, 24, 84, 56, 9, 4);                // 底座足
}
// ---- 象 Bishop ----
function _p_bishop(ctx) {
  _disc(ctx, 50, 18, 6);                        // 顶珠
  _poly(ctx, [[50, 24], [64, 46], [56, 60], [44, 60], [36, 46]]); // 帽
  _rrect(ctx, 40, 58, 20, 8, 3);                // 领
  _rrect(ctx, 30, 64, 40, 22, 6);               // 身
  _rrect(ctx, 24, 84, 52, 9, 4);                // 足
  // 帽上裂口（品牌象特征），用描边色画一竖缝
  ctx.save();
  ctx.lineWidth = Math.max(1.5, ctx.lineWidth * 0.7);
  ctx.beginPath();
  ctx.moveTo(50, 30);
  ctx.lineTo(50, 44);
  ctx.stroke();
  ctx.restore();
}
// ---- 后 Queen ----
function _p_queen(ctx) {
  _disc(ctx, 50, 22, 6);                        // 中尖
  _disc(ctx, 31, 31, 5.5);                      // 左尖
  _disc(ctx, 69, 31, 5.5);                      // 右尖
  _disc(ctx, 40, 33, 4.5);
  _disc(ctx, 60, 33, 4.5);
  _poly(ctx, [[34, 35], [66, 35], [60, 52], [40, 52]]); // 冠带
  _rrect(ctx, 36, 50, 28, 12, 4);               // 颈
  _rrect(ctx, 30, 62, 40, 22, 6);               // 身
  _rrect(ctx, 24, 84, 52, 9, 4);                // 足
}
// ---- 王 King ----
function _p_king(ctx) {
  _rrect(ctx, 46, 8, 8, 16, 2);                 // 十字竖
  _rrect(ctx, 39, 14, 22, 7, 2);                // 十字横
  _poly(ctx, [[40, 24], [60, 24], [64, 40], [36, 40]]); // 冠
  _rrect(ctx, 34, 38, 32, 14, 4);               // 颈
  _rrect(ctx, 30, 62, 40, 22, 6);               // 身
  _rrect(ctx, 24, 84, 52, 9, 4);                // 足
}

var PIECES = {
  p: _p_pawn, r: _p_rook, n: _p_knight, b: _p_bishop, q: _p_queen, k: _p_king
};

// 在 (cx,cy) 居中、边长 size 的逻辑坐标内绘制一枚棋子（已按 DPR 处理或无缩放）。
function _paintPiece(ctx, type, color, cx, cy, size) {
  var white = (color === COLOR.WHITE);
  ctx.save();
  ctx.translate(cx - size / 2, cy - size / 2);
  ctx.scale(size / 100, size / 100);
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';

  var g = ctx.createLinearGradient(0, 8, 0, 92);
  if (white) {
    g.addColorStop(0, C.pieceWhiteFill);
    g.addColorStop(1, C.pieceWhiteShade);
    ctx.fillStyle = g;
    ctx.strokeStyle = C.pieceWhiteStroke;
    ctx.lineWidth = 4.5;
  } else {
    g.addColorStop(0, C.pieceBlackFill);
    g.addColorStop(1, C.pieceBlackShade);
    ctx.fillStyle = g;
    ctx.strokeStyle = C.pieceBlackStroke;
    ctx.lineWidth = 3;
  }

  var fn = PIECES[type];
  if (fn) fn(ctx, white);
  ctx.restore();
}

// 取得（或构建）干净棋子的离屏 canvas 缓存；失败/不支持返回 null。
function _getPieceCanvas(type, color, size) {
  if (!_probeCache()) return null;
  var dpr = _getDpr();
  var sq = Math.max(1, Math.round(size));
  var key = type + '|' + color + '|' + sq + '|' + dpr;
  if (_cache[key]) {
    var idx = _cacheOrder.indexOf(key);
    if (idx >= 0) { _cacheOrder.splice(idx, 1); _cacheOrder.push(key); }
    return _cache[key];
  }
  var canvas = null;
  try {
    canvas = wx.createCanvas();
    var px = Math.max(1, Math.ceil(sq * dpr));
    canvas.width = px;
    canvas.height = px;
    var cctx = canvas.getContext('2d');
    cctx.scale(dpr, dpr);
    _paintPiece(cctx, type, color, sq / 2, sq / 2, sq);
  } catch (e) {
    _cacheAvailable = false;
    return null;
  }
  _cache[key] = canvas;
  _cacheOrder.push(key);
  while (_cacheOrder.length > _CACHE_MAX) {
    var old = _cacheOrder.shift();
    delete _cache[old];
  }
  return canvas;
}

// 通用绘制入口：优先缓存 drawImage，失败直绘。
// opts: { shadow:boolean, selected:boolean, scale:number, alpha:number }
function _draw(ctx, type, color, x, y, size, opts) {
  if (!PIECES[type]) return;
  opts = opts || {};
  var scale = (typeof opts.scale === 'number' && opts.scale > 0) ? opts.scale : 1;
  var alpha = (typeof opts.alpha === 'number') ? opts.alpha : 1;

  ctx.save();
  if (alpha !== 1) ctx.globalAlpha = Math.max(0, Math.min(1, alpha));
  if (scale !== 1) {
    ctx.translate(x, y);
    ctx.scale(scale, scale);
    ctx.translate(-x, -y);
  }

  var canvas = _getPieceCanvas(type, color, size);
  if (canvas) {
    if (opts.shadow) {
      // 选中光晕改用象牙（与棋盘象牙内环同族），黄铜只留给品牌装饰
      ctx.shadowColor = opts.selected ? (C.hlSelectedRing || C.accent) : 'rgba(0,0,0,.35)';
      ctx.shadowBlur = opts.selected ? size * 0.35 : size * 0.12;
      ctx.shadowOffsetY = opts.selected ? 0 : size * 0.045;
    }
    ctx.drawImage(canvas, x - size / 2, y - size / 2, size, size);
  } else {
    _paintPiece(ctx, type, color, x, y, size);
  }

  ctx.restore();
}

/**
 * 绘制单个棋子（无投影）。
 * @param {string} type  棋子类型 k/q/r/b/n/p
 * @param {string} color 棋子颜色 'w'/'b'
 * @param {number} x,y   中心坐标
 * @param {number} size  格子大小
 * @param {object} opts  可选 {scale, alpha}
 */
function drawPiece(ctx, type, color, x, y, size, opts) {
  opts = opts || {};
  _draw(ctx, type, color, x, y, size, {
    shadow: false,
    scale: opts.scale,
    alpha: opts.alpha
  });
}

/**
 * 绘制棋子（带投影，视觉 §6.2）。
 * @param {object} opts 可选 {selected, scale, alpha}
 *   selected=true 时叠加金色光晕并 scale 1.06（§6.2 选中态 / §10）。
 */
function drawPieceWithShadow(ctx, type, color, x, y, size, opts) {
  opts = opts || {};
  _draw(ctx, type, color, x, y, size, {
    shadow: true,
    selected: !!opts.selected,
    scale: opts.selected ? (opts.scale || 1.06) : opts.scale,
    alpha: opts.alpha
  });
}

/** 清空棋子缓存（换肤 / 尺寸变化时可选调用） */
function clearPieceCache() {
  _cache = {};
  _cacheOrder = [];
  _cacheAvailable = null;
  _dpr = null;
}

/**
 * 预热离屏图集：对给定尺寸预渲染全部 12 枚棋子（仅探测到离屏能力时有效）。
 * @param {number[]} sizes  需要预热的边长（px，逻辑坐标）
 */
function prewarm(sizes) {
  if (!_probeCache()) return;
  var types = ['k', 'q', 'r', 'b', 'n', 'p'];
  var colors = [COLOR.WHITE, COLOR.BLACK];
  sizes = sizes || [40, 48, 56];
  for (var s = 0; s < sizes.length; s++) {
    for (var t = 0; t < types.length; t++) {
      for (var c = 0; c < colors.length; c++) {
        _getPieceCanvas(types[t], colors[c], sizes[s]);
      }
    }
  }
}

module.exports = {
  drawPiece: drawPiece,
  drawPieceWithShadow: drawPieceWithShadow,
  clearPieceCache: clearPieceCache,
  prewarm: prewarm
};
