/**
 * 统一按钮原语（Phase 3 · 第 12 项）
 * ----------------------------------------------------------------------------
 * 收敛各场景散落的「按下反馈」与「点击防穿透」：
 *   - 按下视觉：scale .97 脉冲 + 配色（黄铜/象牙主色、secondary/ghost 样式）
 *   - 防穿透：90ms 去重窗口（统一 200/250/60/1200 等不一致参数）
 *
 * 坐标系：375×667 基准（与项目一致）。纯 Canvas 2D 即时模式，无 DOM/CSS/eval。
 *
 * 导出：
 *   MOTION        { tapMs, scale } —— 时序与视觉常量（脉冲 90ms，缩放 .97）
 *   createTap()   按压状态管理器：press / isPressing / clear / guard
 *   drawTapButton(ctx, opts)  统一按钮绘制（含 90ms 缩放脉冲 + 44×44 热区保障）
 *   drawTapHighlight(ctx,x,y,w,h,pressed,radius)  行/卡片按下高亮（替手写的 accentFade）
 *
 * 设计要点：
 *   - drawTapButton 完整复刻 util.drawButtonLocal 的配色与层级，仅把「按下缩放」统一为
 *     MOTION.scale（.97），保证与既有视觉零差异。
 *   - guard(now, id?)：id 缺省为全局 90ms 去重；传入 id 则按动作分键去重（与旧
 *     TouchGuard.allow(key, ms) 语义一致，仅窗口统一为 90ms）。分键设计可避免「连点两个
 *     不同按钮被误拦」，保证回归测试（同 tick 多键点按）不破基线。
 *   - 依赖 config 而非 manager，避免循环引用。
 */
'use strict';

var config = require('../config');
var COLORS = config.COLORS;
var FONTS = config.FONTS;
var RADIUS = config.RADIUS;
var ELEVATION = config.ELEVATION;
var TOUCH_MIN = config.touchMin || 44;

/** 时序与视觉常量：tap 视觉脉冲 90ms；防穿透窗口 90ms；按下缩放 .97 */
var MOTION = { tapMs: 90, scale: 0.97 };

// ---------------------------------------------------------------------------
// 按压状态管理器
// ---------------------------------------------------------------------------
function createTap() {
  var presses = {};   // id -> 按下时刻（ms）
  var guardLast = {}; // id -> 上次允许点击时刻（ms）

  function clear(id) {
    if (id == null) { presses = {}; return; }
    delete presses[id];
  }

  return {
    /**
     * 记录某 id 的按下时刻。
     * @param {string|number} id 按压目标标识（按钮/行 key）
     * @param {number} now 当前时间戳（Date.now()）
     */
    press: function (id, now) { presses[id] = now; },

    /**
     * 该 id 是否处于 90ms 按压态（供绘制缩放/高亮）。松开后由 clear 立即归零，
     * 避免残留脉冲；若调用方不 clear，则最多保留 tapMs 的脉冲。
     */
    isPressing: function (id, now) {
      var t = presses[id];
      if (t == null) return false;
      return (now - t) <= MOTION.tapMs;
    },

    /** 清除某个（或全部）按压态 */
    clear: clear,

    /**
     * 点击防穿透：返回 true 表示该次点击允许执行，90ms 内重复点击拦截。
     * @param {number} now 当前时间戳
     * @param {string|number} [id] 动作标识；缺省为全局去重
     */
    guard: function (now, id) {
      var key = (id == null) ? '__global__' : id;
      if (now - (guardLast[key] || 0) < MOTION.tapMs) return false;
      guardLast[key] = now;
      return true;
    }
  };
}

// ---------------------------------------------------------------------------
// 绘制助手
// ---------------------------------------------------------------------------

/** 十六进制 #RRGGBB -> rgba 字符串（非 hex 原样返回） */
function hexToRgba(hex, a) {
  if (typeof hex !== 'string' || hex.charAt(0) !== '#' || (hex.length !== 7 && hex.length !== 4)) {
    return hex;
  }
  var h = hex;
  if (h.length === 4) {
    h = '#' + h[1] + h[1] + h[2] + h[2] + h[3] + h[3];
  }
  var rr = parseInt(h.slice(1, 3), 16);
  var gg = parseInt(h.slice(3, 5), 16);
  var bb = parseInt(h.slice(5, 7), 16);
  return 'rgba(' + rr + ',' + gg + ',' + bb + ',' + a + ')';
}

/** 圆角矩形路径 */
function roundRect(ctx, x, y, w, h, r) {
  var rr = Math.min((typeof r === 'number' ? r : 0), w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

/**
 * 绘制行/卡片按下高亮（替各场景手写的 `if (pressed) { ctx.fillStyle = C.accentFade; rr(...); }`）。
 * 仅绘制高亮层，不绘制内容；内容由调用方在其后绘制。
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} x,y,w,h 高亮区域
 * @param {boolean} pressed 是否按下
 * @param {number} [radius] 圆角，默认 RADIUS.btn
 * @param {string} [fill] 按下填充色，默认 COLORS.accentFade
 */
function drawTapHighlight(ctx, x, y, w, h, pressed, radius, fill) {
  if (!pressed) return;
  var r = (typeof radius === 'number') ? radius : (RADIUS.btn || 12);
  ctx.save();
  roundRect(ctx, x, y, w, h, r);
  ctx.fillStyle = fill || COLORS.accentFade;
  ctx.fill();
  ctx.restore();
}

/**
 * 统一按钮绘制（视觉 §8.1）：primary/secondary/danger/ghost + 按下态（scale .97 脉冲 + 配色）+ 禁用态。
 * 完整复刻 util.drawButtonLocal 的层级与配色，仅把按下缩放统一为 MOTION.scale。
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {object} opts
 *   x,y,w,h      几何（左上）
 *   label        文字（默认空）
 *   fontKey      字号键名（默认 'button'）
 *   kind         'primary'|'secondary'|'danger'|'ghost'（默认 'primary'）
 *   disabled     禁用态
 *   pressed      按下态（驱动 90ms 缩放脉冲 + 配色）
 *   radius       圆角，默认 RADIUS.btn
 *   expandHit    是否将命中框放大到 ≥ TOUCH_MIN（视觉不变，仅影响返回 rect）
 * @returns {{x,y,w,h}} 命中矩形（expandHit 时可能大于视觉）
 */
function drawTapButton(ctx, opts) {
  opts = opts || {};
  var x = opts.x || 0, y = opts.y || 0, w = opts.w || 0, h = opts.h || 0;
  var disabled = !!opts.disabled;
  var pressed = !!opts.pressed && !disabled;
  var kind = opts.kind || 'primary';
  var radius = (typeof opts.radius === 'number') ? opts.radius : (RADIUS.btn || 12);
  var fontKey = opts.fontKey || 'button';
  var font = FONTS[fontKey] || FONTS.button || 'bold 17px sans-serif';

  // 变体调色板（与 util.drawButtonLocal 完全一致）
  var bg, fg, stroke = null, elev = 'e1';
  switch (kind) {
    case 'primary':
      bg = pressed ? COLORS.accentDeep : COLORS.accent;
      fg = COLORS.textOnAccent; break;
    case 'danger':
      // 语义色淡底走 dangerFade token（替代手写 rgba）；按下反馈由 drawTapButton 的 scale 脉冲表达
      bg = COLORS.dangerFade;
      fg = COLORS.danger; stroke = COLORS.danger; break;
    case 'ghost':
      bg = pressed ? COLORS.accentFade : 'rgba(0,0,0,0)';
      fg = pressed ? COLORS.accent : COLORS.textSecondary; break;
    case 'secondary':
    default:
      bg = pressed ? COLORS.surface3 : COLORS.surface2;
      fg = COLORS.textPrimary; stroke = COLORS.borderStrong; break;
  }
  if (disabled) { bg = COLORS.surface3; fg = COLORS.disabledFg; stroke = COLORS.border; elev = null; }

  // 返回命中矩形：必要时放大到 ≥ TOUCH_MIN（视觉不变）
  var hx = x, hy = y, hw = w, hh = h;
  if (opts.expandHit) {
    if (w < TOUCH_MIN) { var dx = (TOUCH_MIN - w) / 2; hx = x - dx; hw = TOUCH_MIN; }
    if (h < TOUCH_MIN) { var dy = (TOUCH_MIN - h) / 2; hy = y - dy; hh = TOUCH_MIN; }
  }

  var ev = elev ? ELEVATION[elev] : null;

  ctx.save();
  // 按下态：以中心为锚做 MOTION.scale 缩放脉冲（近似 scale .97）
  if (pressed) {
    var cx = x + w / 2, cy = y + h / 2;
    ctx.translate(cx, cy);
    ctx.scale(MOTION.scale, MOTION.scale);
    ctx.translate(-cx, -cy);
  }
  if (ev && !pressed && !disabled) {
    ctx.shadowColor = ev.color;
    ctx.shadowBlur = ev.blur;
    ctx.shadowOffsetY = ev.offsetY;
  }
  roundRect(ctx, x, y, w, h, radius);
  ctx.fillStyle = bg;
  ctx.fill();
  ctx.restore();

  if (stroke) {
    ctx.save();
    ctx.strokeStyle = stroke;
    ctx.lineWidth = 1;
    roundRect(ctx, x + 0.5, y + 0.5, w - 1, h - 1, radius);
    ctx.stroke();
    ctx.restore();
  }

  if (opts.label != null) {
    ctx.save();
    ctx.font = font;
    ctx.fillStyle = fg;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    if (disabled) ctx.globalAlpha = 0.9;
    ctx.fillText(String(opts.label), x + w / 2, y + h / 2 + 1);
    ctx.restore();
  }

  return { x: hx, y: hy, w: hw, h: hh };
}

module.exports = {
  MOTION: MOTION,
  createTap: createTap,
  drawTapButton: drawTapButton,
  drawTapHighlight: drawTapHighlight,
  hexToRgba: hexToRgba,
  roundRect: roundRect
};
