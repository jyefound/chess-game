/**
 * UI 组件绘制（视觉 §8）
 *
 * 保持签名：drawButton / drawPanel / drawText / drawOverlay / roundRect / wrapText / isPointInRect。
 * 新增：drawButton options.variant('primary'|'secondary'|'danger'|'ghost')、disabled、pressed；
 *       旧 color/textColor 仍兼容（迁移期过渡）。
 * 额外导出可选助手（对应 §8.4/§8.5/§8.8、C7）：
 *       drawIconButton / drawBadge / drawProgressBar / drawSegmentedProgress / drawLegendChip。
 *
 * 底线：黄铜 accent 仅用于填充/描边，禁止作浅皮肤文字色；状态一律颜色 + 形状双重编码。
 */
'use strict';

var config = require('../config');
var icons = require('./icons');
var drawIcon = icons.drawIcon;
var C = config.COLORS;
var F = config.FONTS;
var R = config.RADIUS;
var E = config.ELEVATION;

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

/** 绘制圆角矩形路径（不自动填充/描边，保持旧行为） */
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
 * 绘制按钮（视觉 §8.1）
 * @returns {{x,y,w,h}} 命中矩形（不变，供 isPointInRect）
 */
function drawButton(ctx, x, y, w, h, text, options) {
  options = options || {};
  var disabled = !!options.disabled;
  var pressed = !!options.pressed && !disabled;
  var radius = (typeof options.borderRadius === 'number') ? options.borderRadius : R.btn;
  var font = options.font || F.button;

  // 变体调色板
  var PALETTE = {
    primary:   { fill: C.accent, fillPressed: C.accentDeep, text: C.textOnAccent, border: null, borderPressed: null, gloss: true, elev: 'e1' },
    secondary: { fill: C.surface2, fillPressed: C.surface3, text: C.textPrimary, border: C.border, borderPressed: C.accentDeep, gloss: false, elev: 'e1' },
    danger:    { fill: 'transparent', fillPressed: 'rgba(217,106,106,.14)', text: C.danger, border: C.danger, borderPressed: C.danger, gloss: false, elev: 'none' },
    ghost:     { fill: 'transparent', fillPressed: C.accentFade, text: C.textSecondary, border: null, borderPressed: null, gloss: false, elev: 'none' }
  };
  var variant = options.variant;
  var v = PALETTE[variant] || PALETTE.primary;
  var fill = v.fill, fillPressed = v.fillPressed, textColor = v.text;
  var border = v.border, borderPressed = v.borderPressed, gloss = v.gloss, elev = v.elev;

  // 旧接口兼容：传了 color 且未指定 variant → 自定义填充
  if (options.color) {
    fill = options.color;
    fillPressed = options.color;
    textColor = options.textColor || (options.color === C.accent ? C.textOnAccent : C.textPrimary);
    if (!variant) { elev = 'e1'; gloss = (options.color === C.accent); }
  }
  if (options.textColor) textColor = options.textColor;

  // 禁用态统一覆盖
  if (disabled) {
    fill = C.surface3;
    textColor = C.textTertiary;
    border = variant === 'danger' ? hexToRgba(C.danger, 0.3) : C.border;
    gloss = false; elev = 'none';
  }

  // 按下态：换填充 + 降阴影 + 轻微内缩（近似 scale .98）
  var curFill = pressed ? fillPressed : fill;
  var curBorder = pressed ? (borderPressed || border) : border;
  var dx = pressed ? 1 : 0, dy = pressed ? 1 : 0;
  var dw = pressed ? -2 : 0, dh = pressed ? -2 : 0;

  ctx.save();
  if (elev !== 'none' && !pressed && !disabled) {
    var ev = E[elev];
    ctx.shadowColor = ev.color;
    ctx.shadowBlur = ev.blur;
    ctx.shadowOffsetY = ev.offsetY;
  }
  roundRect(ctx, x + dx, y + dy, w + dw, h + dh, radius);
  ctx.fillStyle = curFill;
  ctx.fill();
  ctx.restore();

  // 描边
  if (curBorder) {
    ctx.save();
    ctx.strokeStyle = curBorder;
    ctx.lineWidth = 1;
    roundRect(ctx, x + 0.5, y + 0.5, w - 1, h - 1, radius);
    ctx.stroke();
    ctx.restore();
  }

  // 顶部 1pt 金色光泽（primary）
  if (gloss && !pressed && !disabled) {
    ctx.save();
    roundRect(ctx, x, y, w, h, radius);
    ctx.clip();
    ctx.fillStyle = C.accentSoft;
    ctx.globalAlpha = 0.45;
    ctx.fillRect(x, y, w, 1.5);
    ctx.restore();
  }

  // 文字
  ctx.save();
  ctx.font = font;
  ctx.fillStyle = textColor;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  if (disabled) ctx.globalAlpha = 0.9;
  ctx.fillText(String(text), x + w / 2, y + h / 2);
  ctx.restore();

  return { x: x, y: y, w: w, h: h };
}

/**
 * 绘制面板/卡片（视觉 §8.2 / §7.2）
 * options: {color, borderRadius, alpha, shadow(旧 boolean), elevation:'e1'|'e2'|'none', hairline, border}
 */
function drawPanel(ctx, x, y, w, h, options) {
  options = options || {};
  var color = options.color || C.surface1;
  var radius = (typeof options.borderRadius === 'number') ? options.borderRadius : R.card;
  var alpha = (typeof options.alpha === 'number') ? options.alpha : 1;
  var hairline = options.hairline !== false;
  var elev = options.elevation || (options.shadow === false ? 'none' : 'e1');

  ctx.save();
  ctx.globalAlpha = alpha;
  if (elev !== 'none') {
    var ev = E[elev];
    ctx.shadowColor = ev.color;
    ctx.shadowBlur = ev.blur;
    ctx.shadowOffsetY = ev.offsetY;
  }
  roundRect(ctx, x, y, w, h, radius);
  ctx.fillStyle = color;
  ctx.fill();
  ctx.restore();

  // 质感：主表面顶部 1pt 金色发丝线
  if (hairline) {
    ctx.save();
    ctx.globalAlpha = alpha;
    roundRect(ctx, x, y, w, h, radius);
    ctx.clip();
    ctx.strokeStyle = E.hairline;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x + radius, y + 0.5);
    ctx.lineTo(x + w - radius, y + 0.5);
    ctx.stroke();
    ctx.restore();
  }

  if (options.border) {
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = options.border;
    ctx.lineWidth = 1;
    roundRect(ctx, x + 0.5, y + 0.5, w - 1, h - 1, radius);
    ctx.stroke();
    ctx.restore();
  }
  return { x: x, y: y, w: w, h: h };
}

/**
 * 绘制文本（支持自动换行 / 多行）
 * @returns {number} 实际绘制行数（供布局计算）
 */
function drawText(ctx, text, x, y, options) {
  options = options || {};
  var font = options.font || F.body;
  var color = options.color || C.textPrimary;
  var align = options.align || 'left';
  var baseline = options.baseline || 'top';
  var maxWidth = options.maxWidth || 0;
  var lineHeight = options.lineHeight || config.LINE_HEIGHT.body;
  var maxLines = options.maxLines || 0;
  var str = (text === undefined || text === null) ? '' : String(text);

  ctx.save();
  ctx.font = font;
  ctx.fillStyle = color;
  ctx.textAlign = align;
  ctx.textBaseline = baseline;

  var lines;
  if (maxWidth > 0) {
    lines = wrapText(ctx, str, maxWidth);
  } else {
    lines = str.split('\n');
  }
  if (maxLines > 0 && lines.length > maxLines) {
    lines = lines.slice(0, maxLines);
    var last = lines[lines.length - 1];
    if (last && last.length > 0) lines[lines.length - 1] = last.slice(0, Math.max(0, last.length - 1)) + '…';
  }
  for (var i = 0; i < lines.length; i++) {
    ctx.fillText(lines[i], x, y + i * lineHeight);
  }
  ctx.restore();
  return lines.length;
}

/** 文本自动换行（按字符包裹，兼容 CJK；先按 \n 分段） */
function wrapText(ctx, text, maxWidth) {
  var lines = [];
  if (!text) return lines;
  var str = String(text);
  var paragraphs = str.split('\n');
  for (var p = 0; p < paragraphs.length; p++) {
    var para = paragraphs[p];
    if (para === '') { lines.push(''); continue; }
    var line = '';
    for (var i = 0; i < para.length; i++) {
      var ch = para.charAt(i);
      var test = line + ch;
      if (maxWidth > 0 && ctx.measureText(test).width > maxWidth && line !== '') {
        lines.push(line);
        line = ch;
      } else {
        line = test;
      }
    }
    if (line !== '') lines.push(line);
  }
  return lines;
}

/** 从 rgba token 抽出色值分量（用于遮罩 token 化） */
function _rgbaBase(token) {
  var m = /rgba?\(([^)]+)\)/.exec(token || '');
  if (!m) return '6,9,13';
  var parts = m[1].split(',');
  return parts.slice(0, 3).map(function (s) { return s.trim(); }).join(',');
}

/**
 * 绘制对话框背景遮罩（视觉 §8.2）：颜色取自 COLORS.overlay token。
 * 全屏遮罩为「压暗层」，本身不带 elevation 投影（投影属于抬升表面，见 §7.2）；
 * ELEVATION 已内置在 drawPanel / drawButton 中，场景层无需直接引用。
 */
function drawOverlay(ctx, width, height, alpha) {
  var a = (typeof alpha === 'number') ? alpha : 0.66;
  ctx.save();
  ctx.fillStyle = 'rgba(' + _rgbaBase(C.overlay) + ',' + a + ')';
  ctx.fillRect(0, 0, width, height);
  ctx.restore();
}

/** 判断点是否在矩形区域内 */
function isPointInRect(px, py, rect) {
  if (!rect) return false;
  return px >= rect.x && px <= rect.x + rect.w &&
         py >= rect.y && py <= rect.y + rect.h;
}

// ---------------------------------------------------------------------------
// 可选助手（对应视觉规范的复合组件，供 scenes 直接复用；均为纯绘制，无状态）
// ---------------------------------------------------------------------------

/**
 * Ghost 图标按钮（视觉 §8.1/§8.4）：44×44 热区，24pt 单色图标，可带 11px 文字标签（§6.4）。
 * (cx, cy) = 中心。返回命中矩形。
 */
function drawIconButton(ctx, cx, cy, iconName, options) {
  options = options || {};
  var size = options.size || config.touchMin;
  var iconSize = options.iconSize || 24;
  var disabled = !!options.disabled;
  var pressed = !!options.pressed && !disabled;
  var active = !!options.active;
  var color = disabled ? C.textTertiary : ((pressed || active) ? C.accent : C.textSecondary);

  ctx.save();
  if (disabled) ctx.globalAlpha = 0.4;
  if (pressed && !disabled) {
    roundRect(ctx, cx - size / 2, cy - size / 2, size, size, R.sm);
    ctx.fillStyle = C.accentFade;
    ctx.fill();
  }
  ctx.restore();

  drawIcon(ctx, iconName, cx, cy, iconSize, color);

  if (options.label) {
    drawText(ctx, options.label, cx, cy + size / 2 + 1, {
      font: F.caption,
      color: disabled ? C.textTertiary : (active ? C.accent : C.textSecondary),
      align: 'center', baseline: 'top'
    });
  }
  return { x: cx - size / 2, y: cy - size / 2, w: size, h: size };
}

/**
 * 语义徽章（视觉 §8.8）：胶囊 h22 / padding10 / r999 / Micro11 bold，底=语义色14%、字=语义色。
 * (x,y)=左上。semantic: 'brass'|'success'|'danger'|'neutral'|'info'|'warning'。
 */
function drawBadge(ctx, x, y, text, options) {
  options = options || {};
  var map = {
    brass: C.accent, success: C.success, danger: C.danger,
    neutral: C.neutralBadge, info: C.info, warning: C.warning
  };
  var col = options.color || map[options.semantic] || C.accent;
  var h = options.height || 22;
  ctx.save();
  ctx.font = F.micro;
  var tw = ctx.measureText(String(text)).width;
  ctx.restore();
  var w = tw + (options.padding != null ? options.padding * 2 : 20);

  roundRect(ctx, x, y, w, h, R.pill);
  ctx.fillStyle = hexToRgba(col, 0.14);
  ctx.fill();
  ctx.save();
  ctx.font = F.micro;
  ctx.fillStyle = col;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(String(text), x + w / 2, y + h / 2);
  ctx.restore();
  return { x: x, y: y, w: w, h: h };
}

/**
 * 连续进度条（视觉 §8.8）：轨 h6 r3 surface3；填充 accent→accentSoft 水平渐变。
 * progress 0..1。
 */
function drawProgressBar(ctx, x, y, w, h, progress, options) {
  options = options || {};
  var hh = h || 6;
  roundRect(ctx, x, y, w, hh, hh / 2);
  ctx.fillStyle = options.trackColor || C.surface3;
  ctx.fill();
  var p = Math.max(0, Math.min(1, progress || 0));
  var fw = p * w;
  if (fw > 0.5) {
    var g = ctx.createLinearGradient(x, y, x + Math.max(fw, 1), y);
    g.addColorStop(0, C.accent);
    g.addColorStop(1, C.accentSoft);
    roundRect(ctx, x, y, fw, hh, hh / 2);
    ctx.fillStyle = g;
    ctx.fill();
  }
  return { x: x, y: y, w: w, h: hh };
}

/**
 * 分段进度（视觉 §8.5 教学 10 课）：每段 r3 h6，间距 4。
 * completed[i]=true → 实心金；i===current → 金 + 外发光脉冲（C4 累计 time 驱动）；
 * 未完成 → surface3 + 1pt border（§6.3 双重编码）。
 */
function drawSegmentedProgress(ctx, x, y, w, segments, current, completed, options) {
  options = options || {};
  var n = segments || 10;
  var gap = options.gap != null ? options.gap : 4;
  var h = options.height || 6;
  var segW = (w - (n - 1) * gap) / n;
  var reduce = !!options.reduceMotion;
  for (var i = 0; i < n; i++) {
    var sx = x + i * (segW + gap);
    var done = !!(completed && completed[i]);
    var isCur = (i === current);
    if (done || isCur) {
      ctx.save();
      if (isCur && !reduce) {
        var ph = 0.5 - 0.5 * Math.cos(2 * Math.PI * ((options.time || 0) % 600) / 600);
        ctx.shadowColor = C.accent;
        ctx.shadowBlur = 3 + 5 * ph;
      }
      roundRect(ctx, sx, y, segW, h, 3);
      ctx.fillStyle = C.accent;
      ctx.fill();
      ctx.restore();
    } else {
      roundRect(ctx, sx, y, segW, h, 3);
      ctx.fillStyle = C.surface3;
      ctx.fill();
      ctx.save();
      ctx.strokeStyle = C.border;
      ctx.lineWidth = 1;
      roundRect(ctx, sx + 0.5, y + 0.5, segW - 1, h - 1, 3);
      ctx.stroke();
      ctx.restore();
    }
  }
  return { x: x, y: y, w: w, h: h };
}

/**
 * 几何图例胶囊（C7：Caption 13 / 去 emoji / h26）。
 * kind: 'move'(金实心点) | 'capture'(金环) | 'key'(红环)。(x,y)=左上。
 */
function drawLegendChip(ctx, x, y, kind, label, options) {
  options = options || {};
  var h = options.height || 26;
  var marker = 10, padL = 8, padR = 10, gap = 6;
  ctx.save();
  ctx.font = F.caption;
  var tw = ctx.measureText(String(label)).width;
  ctx.restore();
  var w = padL + marker + gap + tw + padR;

  roundRect(ctx, x, y, w, h, R.sm);
  ctx.fillStyle = options.background || C.surface2;
  ctx.fill();

  var mx = x + padL + marker / 2, my = y + h / 2;
  ctx.save();
  if (kind === 'move') {
    // 与棋盘一致：合法空格=象牙实点
    ctx.fillStyle = C.hlLegalDot || C.hlLegal;
    ctx.beginPath(); ctx.arc(mx, my, marker / 2, 0, Math.PI * 2); ctx.fill();
  } else if (kind === 'key') {
    ctx.strokeStyle = C.danger; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(mx, my, marker / 2 - 1, 0, Math.PI * 2); ctx.stroke();
  } else { // capture
    // 与棋盘一致：合法吃子=酒红空心环
    ctx.strokeStyle = C.hlCaptureRing || C.accent; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(mx, my, marker / 2 - 1, 0, Math.PI * 2); ctx.stroke();
  }
  ctx.restore();

  drawText(ctx, label, x + padL + marker + gap, my, {
    font: F.caption, color: options.textColor || C.textSecondary,
    align: 'left', baseline: 'middle'
  });
  return { x: x, y: y, w: w, h: h };
}

module.exports = {
  drawButton: drawButton,
  drawPanel: drawPanel,
  drawText: drawText,
  drawOverlay: drawOverlay,
  roundRect: roundRect,
  wrapText: wrapText,
  isPointInRect: isPointInRect,
  // 可选助手
  drawIconButton: drawIconButton,
  drawBadge: drawBadge,
  drawProgressBar: drawProgressBar,
  drawSegmentedProgress: drawSegmentedProgress,
  drawLegendChip: drawLegendChip,
  hexToRgba: hexToRgba
};
