/**
 * 对比度审计脚本（无外部依赖）
 * 依据 WCAG 2.1 sRGB 相对亮度公式：
 *   L = 0.2126*R + 0.7152*G + 0.0722*B  (R,G,B 为 sRGB 线性化分量)
 *   CR = (L1 + 0.05) / (L2 + 0.05)，L1 为较亮者
 * 支持 rgba 透明度：将颜色按其 alpha 与给定不透明底色合成后再算。
 */
'use strict';

function hexToRgb(hex) {
  let h = String(hex).trim().replace('#', '');
  if (h.length === 3) h = h.split('').map(c => c + c).join('');
  const n = parseInt(h, 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

function parseColor(c) {
  if (typeof c === 'string' && c[0] === '#') return { ...hexToRgb(c), a: 1 };
  const m = /rgba?\(([^)]+)\)/.exec(String(c));
  if (m) {
    const p = m[1].split(',').map(s => parseFloat(s.trim()));
    return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 };
  }
  throw new Error('unsupported color: ' + c);
}

// 由 hex + alpha 构造 rgba 字符串
function rgbaStr(hex, a) {
  const { r, g, b } = hexToRgb(hex);
  return `rgba(${r},${g},${b},${a})`;
}

// 将带 alpha 的颜色合成到不透明底色上（用于：透明装饰色 / globalAlpha 作用的文字）
function composite(fg, backdrop) {
  const f = parseColor(fg), b = parseColor(backdrop);
  const a = f.a == null ? 1 : f.a;
  return {
    r: Math.round(f.r * a + b.r * (1 - a)),
    g: Math.round(f.g * a + b.g * (1 - a)),
    b: Math.round(f.b * a + b.b * (1 - a)),
    a: 1
  };
}

function toHex(c) {
  const x = n => ('0' + Math.round(n).toString(16)).slice(-2);
  return '#' + x(c.r) + x(c.g) + x(c.b);
}

function channel(v) {
  v /= 255;
  return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
}
function luminance(c) {
  const rgb = (typeof c === 'string') ? parseColor(c) : c;
  const r = channel(rgb.r), g = channel(rgb.g), b = channel(rgb.b);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function contrast(fg, bg) {
  // 若 fg/bg 带 alpha，则需给出底色。这里统一：若 fg 带 alpha，先与 bg 合成
  const fgc = parseColor(fg);
  let effFg = fg, effBg = bg;
  if (fgc.a != null && fgc.a < 1) {
    effFg = toHex(composite(fg, bg));
  }
  const l1 = luminance(effFg), l2 = luminance(effBg);
  const hi = Math.max(l1, l2), lo = Math.min(l1, l2);
  return (hi + 0.05) / (lo + 0.05);
}
function ratio(c) { return Math.round(c * 100) / 100; }

// ============================ 调色板（来自 src/config.js BRAND.COLORS + SEMANTIC）============================
const BRAND = {
  bgBase: '#10151B', bgElev: '#171E27', surface1: '#1F2833', surface2: '#28333F', surface3: '#33404E',
  border: '#3B4A5A', borderStrong: '#4E6072',
  accent: '#C9A24B', accentSoft: '#E0C078', accentDeep: '#8C6E2F',
  accentFade: 'rgba(201,162,75,.14)', accentLine: 'rgba(201,162,75,.22)',
  petrol: '#4C625D', petrolBright: '#6FB0A4', petrolDeep: '#33443F', boardFrame: '#2A2118',
  pieceWhiteStroke: '#2A2A28', pieceBlackStroke: '#C9A24B',
  textPrimary: '#EDE6D6', textSecondary: '#9AA7B4', textTertiary: '#6B7885', textOnAccent: '#1A1408',
  overlay: 'rgba(6,9,13,.66)'
};
const SEM = {
  success: '#6FB98F', warning: '#E0A23C', danger: '#D96A6A', info: '#5AA6C9', neutralBadge: '#9AA7B4'
};

// 语义色作为「填充背景」时，其上文字（bgBase 深字）的对比度
function bannerContrast(semColor) { return contrast(BRAND.bgBase, semColor); }

function row(label, fg, bg, threshold, note) {
  const cr = ratio(contrast(fg, bg));
  const ok = cr >= threshold;
  return { label, fg, bg, cr, threshold, ok, note: note || '' };
}

const results = [];
const SURFACES = ['bgBase', 'bgElev', 'surface1', 'surface2', 'surface3'];

// ---- 文字阶梯在各级表面上的对比度（正常文本 4.5 / 大文本·UI 3）----
function auditText(token, normalTh) {
  for (const s of SURFACES) {
    results.push(row(`${token} on ${s}`, BRAND[token], BRAND[s], normalTh, normalTh === 4.5 ? '正常文本 AA' : 'UI/装饰 3:1'));
  }
}

auditText('textPrimary', 4.5);
auditText('textSecondary', 4.5);
auditText('textTertiary', 3);   // tertiary 仅作 UI/装饰级，最低 3:1

// ---- textOnAccent on accent 填充 ----
results.push(row('textOnAccent on accent', BRAND.textOnAccent, BRAND.accent, 4.5, '强调按钮文字 AA'));

// ---- 语义色：作为文字（on bgBase / surface1）以及作为填充背景（bgBase 深字）----
for (const k of ['success', 'warning', 'danger', 'info']) {
  results.push(row(`sem.${k} as text on bgBase`, SEM[k], BRAND.bgBase, 4.5, '语义文字 AA'));
  results.push(row(`sem.${k} as text on surface1`, SEM[k], BRAND.surface1, 4.5, '语义文字 AA'));
  results.push(row(`bgBase on sem.${k} (banner)`, BRAND.bgBase, SEM[k], 4.5, '横幅深字 AA'));
}

// ---- UI 组件：border / borderStrong 在表面上的边界可见度（UI 3:1）----
for (const b of ['border', 'borderStrong']) {
  for (const s of ['surface1', 'surface2', 'surface3']) {
    results.push(row(`${b} on ${s}`, BRAND[b], BRAND[s], 3, 'UI 边界 3:1'));
  }
}
// accent 线/淡在深底上的 UI 可见度（accentLine 作边界，accentFade 作填充提示）
results.push(row('accentLine on bgBase', BRAND.accentLine, BRAND.bgBase, 3, 'UI 发丝线 3:1'));
results.push(row('accentLine on surface1', BRAND.accentLine, BRAND.surface1, 3, 'UI 发丝线 3:1'));

// ---- 徽章：accentSoft 在 surface3 上的文字对比度（badge 文字，正常文本 4.5，至少 UI 3）----
results.push(row('accentSoft on surface3 (badge)', BRAND.accentSoft, BRAND.surface3, 4.5, '徽章文字 AA'));
results.push(row('textPrimary on surface3 (badge)', BRAND.textPrimary, BRAND.surface3, 4.5, '徽章文字 AA'));

// ============================ 场景级实际用法（menu / academy）============================
// menu.js: L125 版本号 textTertiary on bgBase（globalAlpha 1）
results.push(row('menu 版本号 tertiary on bgBase', BRAND.textTertiary, BRAND.bgBase, 4.5, '版本号应达正常文本 AA → 实际不达标'));
// menu.js: _mainBtn chevron › textSecondary on surface2（次级按钮底）
results.push(row('menu chevron secondary on surface2', BRAND.textSecondary, BRAND.surface2, 3, 'UI 箭头 3:1'));
// academy.js: _tipCard 未收集「破阵解锁」tertiary on (alpha.5 surface2 合成)
const tipCardBg = toHex(composite(rgbaStr(BRAND.surface2, 0.5), BRAND.bgBase));
results.push(row('academy 破阵解锁 tertiary @α.5 surface2', BRAND.textTertiary, tipCardBg, 4.5, '未收集卡 caption → 经 α.5 衰减后更难'));
// academy.js: game card α.4 surface3 上的 textPrimary 棋种名
const gameCardBg = toHex(composite(rgbaStr(BRAND.surface3, 0.4), BRAND.bgBase));
results.push(row('academy 棋种名 textPrimary @α.4 surface3', BRAND.textPrimary, gameCardBg, 3, '占位卡名 UI 3:1'));
// academy.js: game card α.4 surface3 上的 textSecondary 图标
results.push(row('academy 棋种图标 secondary @α.4 surface3', BRAND.textSecondary, gameCardBg, 3, '占位卡图标 UI 3:1'));
// academy.js: 「即将开放」textSecondary on bgBase（右侧标注）
results.push(row('academy 即将开放 secondary on bgBase', BRAND.textSecondary, BRAND.bgBase, 4.5, '右侧标注正常文本 AA'));

// ============================ 输出 ============================
const failed = results.filter(r => !r.ok);
console.log('=== 对比度审计表（WCAG 2.1 sRGB）===');
console.log('token/用法'.padEnd(42), '比值'.padStart(7), '阈值'.padStart(6), '达标');
for (const r of results) {
  console.log(
    r.label.padEnd(40),
    String(r.cr).padStart(7),
    String(r.threshold).padStart(6),
    r.ok ? '  PASS' : '  FAIL  ← ' + r.note
  );
}
console.log('\n达标数:', results.length - failed.length, '/', results.length);
console.log('不达标项:', failed.length);
for (const r of failed) console.log('  -', r.label, r.cr + ':1', '(需 ' + r.threshold + ':1)');
console.log('\n派生合成底(供参考): tipCardBg=' + tipCardBg + '  gameCardBg=' + gameCardBg);

// ============================ 修复后校验（场景级修复，未改 BRAND 基值）============================
console.log('\n=== 修复后校验（仅换色/调 alpha，BRAND.COLORS 基值零改动）===');
const fixResults = [
  row('menu 版本号 secondary→bgBase (修复后)', BRAND.textSecondary, BRAND.bgBase, 4.5, '原 tertiary 4.06 → 7.48'),
  row('academy 破阵解锁 secondary→α.5 surface2 (修复后)', BRAND.textSecondary, tipCardBg, 4.5, '原 tertiary 3.47 → ≈5.92'),
  row('academy 「?」 secondary→α.5 surface2 (修复后)', BRAND.textSecondary, tipCardBg, 3, '占位大字(large) UI 3:1'),
  row('academy 新手试炼箭头 textOnAccent→accent (修复后)', BRAND.textOnAccent, BRAND.accent, 4.5, '原 textSecondary 1.12 → 7.63'),
  row('academy 棋种名 textPrimary@1.0→α.4 card (修复后)', BRAND.textPrimary, gameCardBg, 4.5, '原 @0.4 ≈3.38 → 8.51'),
  row('academy 棋种图标 secondary@1.0→α.4 card (修复后)', BRAND.textSecondary, gameCardBg, 3, '原 @0.4 ≈2.28 → 6.23')
];
for (const r of fixResults) {
  console.log(' ', (r.ok ? 'PASS ' : 'FAIL ') + r.label.padEnd(46), String(r.cr).padStart(7), ' (', r.note, ')');
}
