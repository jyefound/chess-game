/**
 * 统一顶栏（三槽位：左=返回 / 中=标题 / 右=操作）
 *
 * 设计目标：在 320×568 与大字号（theme.fontScale≈1.25）下，标题不再与右侧操作叠字。
 *
 * 排布规则：
 *  1. 左槽固定 x=12、宽 88（沿用现有 ghost「返回」按钮）与 navSafeTop 对齐；
 *  2. 右槽右缘对齐 layout.navRightAvoid（避让微信胶囊）。ghost 文字按钮的**排版宽**取
 *     实测文字宽 + 内边距（视觉不变、更省横向空间，命中区即按钮本体，≥56×44）；
 *     填充型按钮用其命中宽；自定义右槽（计时等）由调用方传 rightWidth；
 *  3. 中槽 = [左槽右缘+gap, 右槽左缘-gap]；无右槽时右界放宽到 W-pad（此时右侧无内容）；
 *  4. 先 measureText 判断标题是否溢出：
 *       - 放得下 → 以屏幕中心为基准，必要时左右平移钳制在中槽内（375 下位置几乎不变）；
 *       - 溢出但中槽 ≥60px 且省略不超过 40% → ellipsize 后单行显示；
 *       - 中槽 <60px 或省略过度 → 标题下沉第二行（整行宽可用，仍 ellipsize），顶栏高度自适应增高。
 *
 * 返回 { y, height, bottom, twoRows, regions, leftRect, rightRect, titleRect, titleX, titleY }，
 * 调用方用 regions 注册命中区（已带 fixed:true），用 bottom 作为内容区起点。
 *
 * 纯 Canvas2D，无 DOM/CSS/eval；CommonJS。
 */
'use strict';

var layoutMod = require('../core/layout');
var M = require('../scenes/manager');
var theme = M.theme;
var drawBtn = M.util.drawButtonLocal;

var BACK_W = 88;      // 左槽按钮宽（与旧实现一致）
var MIN_MID = 60;     // 中槽窄于此值时标题下沉
var GAP = 8;          // 槽位间距
var PAD = 12;         // 左右外边距（沿用旧实现的 12）

function num(v, def) {
  return (typeof v === 'number' && isFinite(v)) ? v : def;
}

function fontSizeOf(font) {
  var m = /(\d+(?:\.\d+)?)px/.exec(font || '');
  return m ? parseFloat(m[1]) : 22;
}

/** 按像素宽截断并追加省略号（CJK 逐字，二分求最大可容纳字数） */
function ellipsize(ctx, text, maxW) {
  var s = (text == null) ? '' : String(text);
  if (maxW <= 0) return '';
  if (ctx.measureText(s).width <= maxW) return s;
  var lo = 0, hi = s.length - 1;
  while (lo < hi) {
    var mid = Math.ceil((lo + hi) / 2);
    if (ctx.measureText(s.slice(0, mid) + '…').width <= maxW) lo = mid;
    else hi = mid - 1;
  }
  return lo <= 0 ? '…' : s.slice(0, lo) + '…';
}

function measureWith(ctx, font, text) {
  ctx.font = font;
  return ctx.measureText(text).width;
}

/**
 * 只做度量不绘制（供场景在渲染内容前拿到顶栏高度）。
 * @param {object} ctx  Canvas2D
 * @param {object} opts 见 drawTopBar
 * @returns {object} 与 drawTopBar 相同的几何结果
 */
function measureTopBar(ctx, opts) {
  opts = opts || {};
  var L = opts.layout || layoutMod.get();
  var W = num(opts.W, L.W);
  var y = num(opts.y, L.navSafeTop);
  var slotH = num(opts.height, 44);
  var pad = num(opts.pad, PAD);
  var gap = num(opts.gap, GAP);
  var fontKey = opts.fontKey || 'h1';
  var font = opts.font || theme.font(fontKey);
  var contentLeft = num(opts.contentLeft, num(L.contentLeft, 16));

  // ---- 左槽 ----
  var leftRect = null;
  if (opts.back !== false) {
    var bw = num(opts.back && opts.back.width, BACK_W);
    leftRect = { x: pad, y: y, w: bw, h: slotH };
  }

  // ---- 右槽 ----
  var hasRight = !!(opts.right || typeof opts.drawRight === 'function' || opts.rightWidth > 0);
  // 有右内容时右缘对齐 navRightAvoid（避让胶囊）；无右内容时可用到屏幕右缘
  var rightEdge = num(opts.rightEdge, hasRight ? num(L.navRightAvoid, W - pad) : (W - pad));
  var rightRect = null;
  var rightSlotW = 0;
  if (opts.right) {
    var label = (opts.right.label == null) ? '' : String(opts.right.label);
    var rw = num(opts.right.width, 0);
    if (!rw) {
      if (opts.right.variant && opts.right.variant !== 'ghost') {
        rw = 88;
      } else {
        // ghost 文字按钮：按实测文字宽 + 内边距排版，避免 84/88 固定宽把中槽挤窄
        rw = Math.max(56, Math.ceil(measureWith(ctx, theme.font('button'), label)) + 24);
      }
    }
    rightSlotW = rw;
    // 视觉/命中区右缘仍对齐 navRightAvoid
    rightRect = { x: Math.round(rightEdge - rw), y: y, w: Math.round(rw), h: slotH };
  } else if (typeof opts.drawRight === 'function' || opts.rightWidth > 0) {
    rightSlotW = num(opts.rightWidth, 60);
    rightRect = { x: Math.round(rightEdge - rightSlotW), y: y, w: Math.round(rightSlotW), h: slotH };
  }

  // ---- 中槽 ----
  var midLeft = (leftRect ? leftRect.x + leftRect.w : pad) + gap;
  var midRight;
  if (rightRect) {
    midRight = rightRect.x - gap;
  } else {
    // 无右槽：右侧无内容，标题可用到屏幕右缘
    midRight = W - pad;
  }
  var midW = Math.max(0, midRight - midLeft);

  // ---- 标题 ----
  var title = (opts.title == null) ? '' : String(opts.title);
  ctx.save();
  var tw = measureWith(ctx, font, title);
  var text = title;
  var titleW = tw;
  var twoRows = false;
  // 大字号：标题放不下时直接下沉第二行，避免被截成「新手…」这种不可读形式
  var largeFont = (theme.fontScale || 1) > 1.01;
  if (tw > midW) {
    var ell = ellipsize(ctx, title, midW);
    var ew = ctx.measureText(ell).width;
    if (midW < MIN_MID || largeFont || ew < tw * 0.75) {
      twoRows = true; // 中槽过窄 / 大字号 / 可见比例低于约 75%：下沉两行，保留可读性（不截断标题）
    } else {
      text = ell;
      titleW = ew;
    }
  }
  ctx.restore();

  var fs = fontSizeOf(font);
  var lineH = Math.ceil(fs + 10);
  var height = slotH;
  var titleX, titleY;
  if (twoRows) {
    // 第二行在胶囊下方，可占满整行宽度，居中更接近视觉中心
    var rowRight = W - pad;
    var rowW = Math.max(0, rowRight - contentLeft);
    ctx.save();
    ctx.font = font;
    text = ellipsize(ctx, title, rowW);
    titleW = ctx.measureText(text).width;
    ctx.restore();
    titleX = contentLeft + rowW / 2;
    titleY = y + slotH + 4 + lineH / 2;
    height = slotH + 4 + lineH + 6;
  } else {
    // 默认屏幕居中；越界才钳制到中槽内（375 下与旧版视觉基本一致）
    titleX = W / 2;
    var hw = titleW / 2;
    if (titleX + hw > midRight) titleX = midRight - hw;
    if (titleX - hw < midLeft) titleX = midLeft + hw;
    titleY = y + slotH / 2;
  }

  var regions = [];
  if (leftRect) regions.push({ key: (opts.back && opts.back.key) || 'back', rect: leftRect, fixed: true });
  if (rightRect && opts.right) {
    regions.push({ key: opts.right.key || 'right', rect: rightRect, fixed: true, enabled: opts.right.disabled !== true });
  }

  return {
    y: y, height: height, bottom: y + height,
    twoRows: twoRows,
    font: font,
    titleText: text, titleX: titleX, titleY: titleY, titleWidth: titleW,
    titleRect: { x: titleX - titleW / 2, y: titleY - lineH / 2, w: titleW, h: lineH },
    leftRect: leftRect,
    rightRect: rightRect,
    rightSlotW: rightSlotW,
    midLeft: midLeft, midRight: midRight, midWidth: midW,
    regions: regions
  };
}

/**
 * 绘制统一顶栏。
 * @param {object} ctx
 * @param {object} opts
 *   title      {string} 标题
 *   fontKey    {string} 'h1'|'h2'|'subtitle'（默认 'h1'，跟随 theme.fontScale 缩放）
 *   y          {number} 顶栏顶部（默认 layout.navSafeTop）
 *   height     {number} 单行槽位高（默认 44）
 *   pad        {number} 左右外边距（默认 12）
 *   back       {object|false} { label:'返回', key:'back', pressed:bool, width:88 }；false 表示无返回
 *   right      {object} { label, key, pressed, disabled, width, variant }
 *   rightWidth {number} 自定义右槽宽（配合 drawRight）
 *   drawRight  {function(ctx, rect)} 自定义右槽绘制
 *   divider    {boolean} 是否画底部 1pt 金发丝线（默认 false）
 *   titleColor {string}
 * @returns {object} { height, bottom, regions, ... }
 */
function drawTopBar(ctx, opts) {
  opts = opts || {};
  var m = measureTopBar(ctx, opts);
  var C = theme.colors;

  // 左：返回
  if (m.leftRect) {
    drawBtn(ctx, m.leftRect.x, m.leftRect.y, m.leftRect.w, m.leftRect.h,
      (opts.back && opts.back.label) || '返回', 'ghost',
      { pressed: !!(opts.back && opts.back.pressed) });
  }

  // 右：操作
  if (m.rightRect) {
    if (opts.right) {
      drawBtn(ctx, m.rightRect.x, m.rightRect.y, m.rightRect.w, m.rightRect.h,
        opts.right.label, opts.right.variant || 'ghost',
        { pressed: !!opts.right.pressed, disabled: !!opts.right.disabled });
    } else if (typeof opts.drawRight === 'function') {
      ctx.save();
      opts.drawRight(ctx, m.rightRect);
      ctx.restore();
    }
  }

  // 中：标题
  ctx.save();
  ctx.font = m.font;
  ctx.fillStyle = opts.titleColor || (C && C.textPrimary) || '#EDE6D6';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(m.titleText, m.titleX, m.titleY);
  ctx.restore();

  // 底部分隔线
  if (opts.divider) {
    ctx.save();
    ctx.strokeStyle = opts.dividerColor || (C && C.accentLine) || 'rgba(201,162,75,0.22)';
    ctx.lineWidth = 1;
    var dx = num(opts.contentLeft, num((opts.layout || layoutMod.get()).contentLeft, 16));
    ctx.beginPath();
    ctx.moveTo(dx, m.bottom + 0.5);
    ctx.lineTo(num(opts.W, (opts.layout || layoutMod.get()).W) - dx, m.bottom + 0.5);
    ctx.stroke();
    ctx.restore();
  }

  return m;
}

module.exports = {
  drawTopBar: drawTopBar,
  measureTopBar: measureTopBar,
  ellipsize: ellipsize
};
