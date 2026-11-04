'use strict';
/**
 * 三页共享的版式原语（第二轮审查 §3.4 / §8）
 *
 * 目标：把「内容驱动度量 + 分组容器 + 行 + 选中态 + 分段控件 + 难度条」
 * 收敛到同一处，供 setup.js / settings.js / endgameMap.js 复用，保证
 * §10.4「三页使用同一 SectionHeader、圆角、行高、分隔线与选中态」。
 *
 * 平台约束：微信小游戏纯 CommonJS + Canvas 2D，无 DOM / CSS / eval。
 * 所有行高、折行都基于 ctx.measureText 与 theme.font(key) 的实际字号计算，
 * 不再用固定 18px 行距 / 固定 44、60、112 卡高硬扛 1.25× 大字号。
 */
const M = require('../scenes/manager');
const theme = M.theme;
const util = M.util;
const C = theme.colors;
const TF = (k) => theme.font(k);
const rr = util.rr;

let icons = null;
try { icons = require('./icons'); } catch (e) { icons = null; }

// ---- 统一视觉 token（§3.1 / §3.3 / 第三轮间距优化）----
const GROUP_GAP = 24;      // 分组间距（20→24：分组之间更透气）
const GROUP_PAD = 16;      // 组内左右内边距（14→16：标签/控件离边更舒展）
const GROUP_RADIUS = 16;   // 分组容器圆角
const ROW_RADIUS = 10;     // 行 / 分段控件圆角
const MIN_TAP = 44;        // 命中下限
const ROW_BASE_H = 60;     // 简单设置行基准高（56→60：行内上下更透气）
const SELECT_TRACK = 2;    // 选中态左侧金色轨宽

function fontPx(font) {
  const m = /(\d+(?:\.\d+)?)px/.exec(font || '');
  return m ? parseFloat(m[1]) : 16;
}

/** 内容驱动行距：跟随 theme.font(key) 缩放后的实际字号 */
function lineHeight(key) {
  return Math.ceil(fontPx(TF(key)) + 6);
}

/** 按可用宽度折行；maxLines>0 时末行追加省略号 */
function wrapText(ctx, text, maxW, fontKey, maxLines) {
  const s = String(text == null ? '' : text);
  ctx.save();
  ctx.font = TF(fontKey);
  let lines = util.wrapLocal(ctx, s, Math.max(1, maxW));
  if (maxLines > 0 && lines.length > maxLines) {
    lines = lines.slice(0, maxLines);
    let last = lines[maxLines - 1];
    while (last.length > 0 && ctx.measureText(last + '…').width > maxW) last = last.slice(0, -1);
    lines[maxLines - 1] = last + '…';
  }
  ctx.restore();
  return lines;
}

/** 绘制多行文本（top baseline），返回占用高度 */
function drawLines(ctx, lines, x, y, color, fontKey) {
  const lh = lineHeight(fontKey);
  ctx.save();
  ctx.fillStyle = color;
  ctx.font = TF(fontKey);
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  for (let i = 0; i < lines.length; i++) ctx.fillText(lines[i], x, y + i * lh);
  ctx.restore();
  return lines.length * lh;
}

/** 组标题（容器外）+ 金色短线；返回占用高度 */
function drawSectionHeader(ctx, x, y, title, opts) {
  opts = opts || {};
  ctx.save();
  ctx.fillStyle = C.accent;
  rr(ctx, x, y + 3, 3, 14, 2); ctx.fill();
  ctx.fillStyle = opts.color || C.textSecondary;
  ctx.font = TF(opts.fontKey || 'caption');
  ctx.textAlign = 'left'; ctx.textBaseline = 'top';
  ctx.fillText(String(title == null ? '' : title), x + 10, y);
  if (opts.trailing) {
    ctx.fillStyle = C.disabledFg;
    ctx.textAlign = 'right';
    ctx.fillText(String(opts.trailing), x + (opts.width || 0), y);
  }
  ctx.restore();
  return lineHeight(opts.fontKey || 'caption') + 6;
}

/** 分组容器：surface1 + 圆角 16，1px 描边界定边界（避免在 bgBase 上「悬浮突兀」） */
function drawGroupPanel(ctx, x, y, w, h) {
  ctx.save();
  ctx.fillStyle = C.surface1;
  rr(ctx, x, y, w, h, GROUP_RADIUS); ctx.fill();
  ctx.strokeStyle = C.border; ctx.lineWidth = 1;
  rr(ctx, x + 0.5, y + 0.5, w - 1, h - 1, GROUP_RADIUS); ctx.stroke();
  ctx.restore();
}

/** 组内弱分隔线 */
function drawRowDivider(ctx, x, y, w) {
  ctx.save();
  ctx.strokeStyle = C.border; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(x, y + 0.5); ctx.lineTo(x + w, y + 0.5); ctx.stroke();
  ctx.restore();
}

/**
 * 选中态表达（≤2 信号）：accentFade 底 + 右侧 6pt 金色圆点。
 * 取消金色左轨与 ✓，统一为「行式单选」视觉语言（§5 走查 P1）。
 */
function drawSelection(ctx, x, y, w, h, opts) {
  opts = opts || {};
  ctx.save();
  ctx.fillStyle = C.accentFade;
  rr(ctx, x, y, w, h, opts.radius == null ? ROW_RADIUS : opts.radius); ctx.fill();
  const dotR = 3; // 直径 6pt
  ctx.fillStyle = C.accent;
  ctx.beginPath();
  ctx.arc(x + w - (opts.pad == null ? 14 : opts.pad), y + h / 2, dotR, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

/** 按压反馈：90ms accentFade / 淡色底，由共享面板消费 pressedKey（§3.2 / P1-10） */
function drawPressed(ctx, x, y, w, h, radius) {
  ctx.save();
  ctx.fillStyle = C.accentFade;
  rr(ctx, x, y, w, h, radius == null ? ROW_RADIUS : radius); ctx.fill();
  ctx.restore();
}

/**
 * 分段控件：单容器、未选中无边框、选中走 drawSelection。
 * @returns {Array} choices 对应的命中区（屏幕坐标，调用方自行加滚动偏移）
 */
function drawSegmented(ctx, x, y, w, h, choices, activeValue, opts) {
  opts = opts || {};
  const gap = opts.gap == null ? 0 : opts.gap;
  const n = choices.length;
  const cw = (w - gap * (n - 1)) / n;
  const regions = [];
  for (let i = 0; i < n; i++) {
    const cx = x + i * (cw + gap);
    const active = choices[i].value === activeValue;
    ctx.save();
    ctx.fillStyle = active ? C.accentFade : C.surface2;
    rr(ctx, cx, y, cw, h, opts.radius == null ? ROW_RADIUS : opts.radius); ctx.fill();
    if (active) {
      // 选中：右侧 6pt 金点（与行式单选一致，≤2 信号）
      ctx.fillStyle = C.accent;
      ctx.beginPath(); ctx.arc(cx + cw - 14, y + h / 2, 3, 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();
    if (opts.pressedValue === choices[i].value) drawPressed(ctx, cx, y, cw, h, opts.radius);
    ctx.save();
    ctx.fillStyle = active ? C.textPrimary : C.textSecondary;
    ctx.font = TF(opts.fontKey || 'body');
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    const label = String(choices[i].label == null ? '' : choices[i].label);
    const maxLabelW = cw - (active ? 20 : 8);
    let text = label;
    if (ctx.measureText(text).width > maxLabelW) {
      while (text.length > 1 && ctx.measureText(text + '…').width > maxLabelW) text = text.slice(0, -1);
      text += '…';
    }
    ctx.fillText(text, cx + cw / 2 - (active ? 6 : 0), y + h / 2);
    ctx.restore();
    regions.push({ value: choices[i].value, rect: { x: cx, y: y, w: cw, h: h } });
  }
  return regions;
}

const DIFFICULTY_LABELS = ['入门', '进阶', '熟练', '精深', '宗师'];

/**
 * 行式单选：整行 = 左侧标题（+ 可选第二行说明）+ 右侧 6pt 金点（选中）/ 细环（未选）。
 * 未选项不加独立圆角底板（仅靠分隔线区隔）；选中项用 accentFade 底（≤2 信号）。
 * 调用方按整行 rect 注册命中区。返回 void。
 */
function drawRadioRow(ctx, x, y, w, h, opts) {
  opts = opts || {};
  const pad = opts.pad == null ? GROUP_PAD : opts.pad;
  const selected = !!opts.selected;
  const sub = opts.sub == null ? '' : String(opts.sub);
  const hasSub = sub.length > 0;
  ctx.save();
  if (selected) {
    ctx.fillStyle = C.accentFade;
    rr(ctx, x, y, w, h, opts.radius == null ? ROW_RADIUS : opts.radius); ctx.fill();
  }
  ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
  const tx = x + pad;
  if (hasSub) {
    ctx.fillStyle = selected ? C.textPrimary : C.textPrimary;
    ctx.font = TF(opts.titleKey || 'body');
    ctx.fillText(opts.title == null ? '' : String(opts.title), tx, y + h / 2 - 9);
    ctx.fillStyle = C.textSecondary; ctx.font = TF('caption');
    ctx.fillText(sub, tx, y + h / 2 + 9);
  } else {
    ctx.fillStyle = selected ? C.textPrimary : C.textPrimary;
    ctx.font = TF(opts.titleKey || 'body');
    ctx.fillText(opts.title == null ? '' : String(opts.title), tx, y + h / 2);
  }
  const cx = x + w - pad - 3, cy = y + h / 2;
  if (selected) {
    ctx.fillStyle = C.accent;
    ctx.beginPath(); ctx.arc(cx, cy, 3, 0, Math.PI * 2); ctx.fill();
  } else {
    ctx.strokeStyle = C.border; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.arc(cx, cy, 3, 0, Math.PI * 2); ctx.stroke();
  }
  ctx.restore();
}

/**
 * 难度条：5 格实心/空心矩形 + 文字档位（替代 10px 空心星，P1-03）。
 * 难度用 C.info，通关成绩星用 C.accent，颜色与形状双编码。
 * @returns {number} 占用宽度
 */
function drawDifficultyBar(ctx, x, y, level, opts) {
  opts = opts || {};
  const lv = Math.max(1, Math.min(5, level || 1));
  const barW = opts.barW || 7, barH = opts.barH || 9, gap = opts.gap || 3;
  const barsW = 5 * barW + 4 * gap;
  for (let i = 0; i < 5; i++) {
    ctx.fillStyle = i < lv ? C.info : C.surface3;
    rr(ctx, x + i * (barW + gap), y - barH / 2, barW, barH, 2); ctx.fill();
  }
  let used = barsW;
  if (opts.label !== false) {
    ctx.save();
    ctx.fillStyle = C.textSecondary;
    ctx.font = TF(opts.fontKey || 'caption');
    ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    const lbl = '· ' + DIFFICULTY_LABELS[lv - 1];
    const lblW = ctx.measureText(lbl).width;
    ctx.fillText(lbl, x + barsW + 5, y);
    ctx.restore();
    used += 5 + lblW;
  }
  return used;
}

/**
 * 设置行内容驱动度量（P0-01）。先算右侧控件宽，再求可用文字宽，说明自动折行并增高行高。
 * @returns {{h, textW, labelLines, hintLines, lhBody, lhCap, stacked, controlY}}
 */
function measureSettingRow(ctx, w, label, hint, controlW, opts) {
  opts = opts || {};
  const pad = opts.pad == null ? GROUP_PAD : opts.pad;
  const stacked = !!opts.stacked;                 // 320 大字号：标签/说明在上、控件在下
  const textW = stacked ? (w - pad * 2) : Math.max(40, w - pad * 2 - controlW - 8);
  const labelLines = wrapText(ctx, label, textW, 'body', 2);
  const hintLines = hint ? wrapText(ctx, hint, textW, 'caption', opts.maxHintLines || 3) : [];
  const lhBody = lineHeight('body');
  const lhCap = lineHeight('caption');
  const textH = labelLines.length * lhBody + (hintLines.length ? 4 + hintLines.length * lhCap : 0);
  const controlH = stacked ? Math.max(MIN_TAP, opts.controlH || 44) : 0;
  const h = Math.max(MIN_TAP, opts.minH || ROW_BASE_H,
                     textH + (stacked ? 20 + controlH + 8 : 20));
  return {
    h: h, textW: textW, labelLines: labelLines, hintLines: hintLines,
    lhBody: lhBody, lhCap: lhCap, stacked: stacked,
    controlY: stacked ? (h - 8 - controlH) : (h - Math.max(MIN_TAP, opts.controlH || 44)) / 2
  };
}

module.exports = {
  // token
  GROUP_GAP: GROUP_GAP, GROUP_PAD: GROUP_PAD, GROUP_RADIUS: GROUP_RADIUS,
  ROW_RADIUS: ROW_RADIUS, MIN_TAP: MIN_TAP, ROW_BASE_H: ROW_BASE_H,
  SELECT_TRACK: SELECT_TRACK, DIFFICULTY_LABELS: DIFFICULTY_LABELS,
  // 度量
  fontPx: fontPx, lineHeight: lineHeight, wrapText: wrapText, drawLines: drawLines,
  measureSettingRow: measureSettingRow,
  // 绘制
  drawSectionHeader: drawSectionHeader, drawGroupPanel: drawGroupPanel,
  drawRowDivider: drawRowDivider, drawSelection: drawSelection,
  drawPressed: drawPressed, drawSegmented: drawSegmented, drawRadioRow: drawRadioRow,
  drawDifficultyBar: drawDifficultyBar
};
