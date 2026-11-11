/**
 * 场景管理器 + 共享基础设施
 * 管理场景切换（含场景栈）、触摸事件分发、模态层、Banner、防误触守卫、主题兜底。
 *
 * 触摸模型（UX §2.5 硬规则）：动作在 onTouchEnd 同目标确认执行；onTouchStart 只置按下态。
 * 场景应复用 TouchGuard：down/move/end 三段，end() 返回是否为有效点按。
 */
const config = require('../config');
const layoutMod = require('../core/layout');
const icons = require('../render/icons');
// 统一按钮原语（Phase 3·12）：MOTION / createTap / drawTapButton / drawTapHighlight
const tapMod = require('../render/tap');

const now = () => (typeof Date !== 'undefined' && Date.now) ? Date.now() : 0;

// ==================== 主题兜底（视觉 §11 / 补遗 §I）====================
// fe-render 会按语义 Token 重写 config.js。此处兜底保证：
// ① 即使 config 暂为旧版键名，场景仍用正确的「墨金棋院」新色板；
// ② 集成后 config 新键覆盖兜底值。渲染层与场景只读 theme，不感知皮肤实现细节。
const COLOR_FALLBACK = {
  bgBase: '#10151B', bgElev: '#171E27',
  surface1: '#1F2833', surface2: '#28333F', surface3: '#33404E',
  border: '#3B4A5A', borderStrong: '#4E6072',
  accent: '#C9A24B', accentSoft: '#E0C078', accentDeep: '#8C6E2F',
  accentFade: 'rgba(201,162,75,0.14)', accentLine: 'rgba(201,162,75,0.22)',
  petrol: '#4C625D', petrolBright: '#6FB0A4', petrolDeep: '#33443F',
  boardLight: '#EDE6D6', boardDark: '#4C625D', boardFrame: '#2A2118',
  coordOnLight: '#4C625D', coordOnDark: '#EDE6D6',
  pieceWhiteFill: '#F7F1E3', pieceWhiteShade: '#DDD3BC', pieceWhiteStroke: '#2A2A28',
  pieceBlackFill: '#38434E', pieceBlackShade: '#10151B', pieceBlackStroke: '#C9A24B',
  success: '#6FB98F', warning: '#E0A23C', danger: '#D96A6A', info: '#5AA6C9',
  neutralBadge: '#9AA7B4',
  textPrimary: '#EDE6D6', textSecondary: '#9AA7B4', textTertiary: '#6B7885',
  textOnAccent: '#1A1408', overlay: 'rgba(6,9,13,0.66)',
  hlLastMove: 'rgba(224,192,120,0.24)', hlSelected: 'rgba(245,238,218,0.10)',
  hlLegal: '#FBF6E8', hlCapture: '#A9506A', hlCheck: 'rgba(217,106,106,0.75)',
  hlSelectedRing: '#F5EEDA', hlSelectedCasing: 'rgba(26,20,14,0.55)',
  hlLegalDot: '#FBF6E8', hlCaptureRing: '#A9506A', hlCaptureCasing: 'rgba(247,240,221,0.72)',
  hlLastMoveEdge: 'rgba(240,214,150,0.70)',
  hlHintJade: '#60C6AF', hlHintCasing: 'rgba(10,16,14,0.45)',
  coordBand: 'rgba(237,230,214,0.72)', coordBandActive: '#F5EEDA',
  dangerFade: 'rgba(217,106,106,.16)', blackFade: 'rgba(0,0,0,.10)',
  neutralBadgeFade: 'rgba(154,167,180,.16)', successFade: 'rgba(111,185,143,.16)',
  infoFade: 'rgba(90,166,201,.16)', bgFade: 'rgba(16,21,27,.10)',
  disabledFg: '#7E8A96'
};

const FONT_FALLBACK = {
  display: 'bold 44px serif', h1: 'bold 28px sans-serif', h2: 'bold 22px sans-serif',
  subtitle: '20px sans-serif', body: '16px sans-serif', caption: '13px sans-serif',
  micro: 'bold 11px sans-serif', san: '15px serif', button: 'bold 17px sans-serif',
  coordinate: 'bold 11px sans-serif', piece: 'serif', overline: 'bold 11px sans-serif',
  watermark: '96px serif', emptyGlyph: '64px serif', placeholder: '28px sans-serif',
  pieceGlyphMd: '18px serif', pieceGlyphSm: '13px serif',
  bodyB: 'bold 16px sans-serif', captionB: 'bold 13px sans-serif',
  subtitleB: 'bold 20px sans-serif', h2B: 'bold 22px sans-serif',
  microB: 'bold 11px sans-serif', check: 'bold 14px sans-serif'
};

const RADIUS_FALLBACK = { chip: 4, sm: 8, btn: 12, card: 16, modal: 20, pill: 999 };
const MOTION_FALLBACK = {
  tap: 90, tapRecover: 120, select: 140, move: 180, land: 90, capture: 160,
  lastMove: 120, transition: 240, winCard: 320, bannerIn: 200, bannerHold: 2000,
  bannerOut: 200, aiDot: 400, aiBreath: 1600, replayStep: 800, replayStepReduce: 500,
  correct: 260, wrong: 180, guideBreath: 240, checkPulse: 300, revealPulse: 300,
  modalGuard: 200, progress: 240, missRingHold: 800
};
const ELEVATION_FALLBACK = {
  e0: null,
  e1: { color: 'rgba(0,0,0,0.35)', blur: 8, offsetY: 2 },
  e2: { color: 'rgba(0,0,0,0.50)', blur: 18, offsetY: 8 }
};

const theme = {
  colors: Object.assign({}, COLOR_FALLBACK, (config && config.COLORS) || {}),
  fonts: Object.assign({}, FONT_FALLBACK, (config && config.FONTS) || {}),
  radius: Object.assign({}, RADIUS_FALLBACK, (config && config.RADIUS) || {}),
  motion: Object.assign({}, MOTION_FALLBACK, (config && config.MOTION) || {}),
  elevation: Object.assign({}, ELEVATION_FALLBACK, (config && config.ELEVATION) || {}),
  spacing: Object.assign({ xs: 4, sm: 8, md: 12, lg: 16, xl: 20, xxl: 24, xxxl: 32 }, (config && config.SPACING) || {}),
  touchMin: (config && config.touchMin) || 44,
  gutter: (config && config.gutter) || 16,
  board: Object.assign({ maxWidthRatio: 0.92, maxHeightRatio: 0.55, minCell: 38 }, (config && config.BOARD) || {}),
  aiDepth: (config && config.AI_DEPTH) || { easy: 2, medium: 3, hard: 4 },
  // 字号缩放（设置项「标准/大」；大=×1.125，系统缩放上限 +25% 后取较大值）
  fontScale: 1,
  setFontScale(s) { this.fontScale = Math.max(1, Math.min(1.25, s || 1)); },
  font(key) {
    const base = this.fonts[key] || this.fonts.body;
    if (this.fontScale === 1) return base;
    // 仅缩放 body/h1/subtitle 等正文类；micro/button/coordinate 保持不变以免溢出
    if (!/^(body|h1|h2|subtitle|caption|san)$/.test(key)) return base;
    return base.replace(/(\d+(?:\.\d+)?)px/, (m, n) => Math.round(parseFloat(n) * this.fontScale) + 'px');
  }
};

// ==================== 轻量绘制助手（manager 自包含，减少集成依赖）====================
function rr(ctx, x, y, w, h, r) {
  r = Math.max(0, Math.min(r, Math.min(w, h) / 2));
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
function inRect(px, py, r) { return px >= r.x && px <= r.x + r.w && py >= r.y && py <= r.y + r.h; }
function wrapLocal(ctx, text, maxWidth) {
  const out = [];
  const paras = String(text == null ? '' : text).split('\n');
  for (const para of paras) {
    if (para === '') { out.push(''); continue; }
    let line = '';
    for (const ch of para) {
      const test = line + ch;
      if (ctx.measureText(test).width > maxWidth && line !== '') { out.push(line); line = ch; }
      else line = test;
    }
    if (line) out.push(line);
  }
  return out;
}
function withShadow(ctx, elev, fn) {
  ctx.save();
  if (elev) {
    ctx.shadowColor = elev.color || 'rgba(0,0,0,0.4)';
    ctx.shadowBlur = elev.blur || 8;
    ctx.shadowOffsetY = elev.offsetY || 2;
  }
  fn();
  ctx.restore();
}

// ==================== 防误触守卫（UX §2.5）====================
class TouchGuard {
  constructor(opts = {}) {
    this.moveThreshold = opts.moveThreshold != null ? opts.moveThreshold : 12; // 点按最大位移 ≤12pt
    this.longPressMs = opts.longPressMs || 500;                                // 长按 >500ms 取消
    this.debounceMs = opts.debounceMs || 250;                                  // 按钮去重 250ms
    this._lockUntil = 0;
    this._last = {};
    this.reset();
  }
  reset() { this.active = false; this.moved = false; this.sx = 0; this.sy = 0; this.st = 0; this.lx = 0; this.ly = 0; }
  down(x, y) { this.active = true; this.moved = false; this.sx = x; this.sy = y; this.st = now(); this.lx = x; this.ly = y; }
  move(x, y) {
    const stepY = y - this.ly, stepX = x - this.lx;
    this.lx = x; this.ly = y;
    if (!this.active) return { moved: false, dx: 0, dy: 0, stepX, stepY };
    const dx = x - this.sx, dy = y - this.sy;
    if (Math.sqrt(dx * dx + dy * dy) > this.moveThreshold) this.moved = true;
    return { moved: this.moved, dx, dy, stepX, stepY };
  }
  // 返回 {valid, x, y, dist, dur}
  end(x, y) {
    const dur = now() - this.st;
    const dx = x - this.sx, dy = y - this.sy;
    const dist = Math.sqrt(dx * dx + dy * dy);
    const valid = this.active && !this.moved && dist <= this.moveThreshold &&
                  dur <= this.longPressMs && !this.isLocked();
    this.active = false;
    return { valid, x, y, dist, dur };
  }
  lock(ms) { this._lockUntil = now() + (ms || 0); }
  isLocked() { return now() < this._lockUntil; }
  allow(action, ms) {
    const t = now(), gap = ms || this.debounceMs;
    if (t - (this._last[action] || 0) < gap) return false;
    this._last[action] = t;
    return true;
  }
}

// ==================== 模态管理（UX §2.3 层级）====================
// L1 互斥模态：同一时刻最多 1 个；打开后 200ms 内触摸一律忽略（防穿透）。
// 通用模态（confirm/storageError/resume）由 ModalManager 统一绘制与命中；
// 场景专属模态（promotion/gameover/settingsDrawer/more）由场景自绘。
const GENERIC_KEYS = { confirm: 1, storageError: 1, resume: 1 };

class ModalManager {
  constructor() { this.current = null; this.payload = null; this.openedAt = 0; this.guardMs = 200; this._regions = []; }
  isGeneric() { return !!GENERIC_KEYS[this.current]; }
  open(key, payload) {
    // 打开新 L1 前先关闭旧 L1，禁止叠加
    this.close();
    this.current = key;
    this.payload = payload || {};
    this.openedAt = now();
    this._regions = [];
  }
  close() { this.current = null; this.payload = null; this._regions = []; }
  isOpen() { return !!this.current; }
  interactive() { return !!this.current && now() - this.openedAt >= this.guardMs; }

  /**
   * 绘制通用模态（confirm / storageError / resume）。
   * payload: {title, message, height?, buttons:[{label,action,variant}], maskClosable?, onAction?}
   */
  renderGeneric(ctx, W, H) {
    if (!this.isGeneric()) return;
    const p = this.payload || {};
    const C = theme.colors, R = theme.radius, E = theme.elevation;
    const w = Math.min(W * 0.88, 340);
    // 预估高度：标题 + 正文行数 + 按钮
    ctx.save();
    ctx.font = theme.font('body');
    const msgLines = p.message ? wrapLocal(ctx, p.message, w - 44) : [];
    const h = p.height || Math.max(180, 96 + Math.min(msgLines.length, 6) * 24 + 60);
    const x = (W - w) / 2, y = (H - h) / 2 - 16;

    // 遮罩
    ctx.fillStyle = C.overlay;
    ctx.fillRect(0, 0, W, H);
    // 面板
    withShadow(ctx, E.e2, () => { ctx.fillStyle = C.surface1; rr(ctx, x, y, w, h, R.modal); ctx.fill(); });
    // 顶部 1pt 金发丝线
    ctx.strokeStyle = C.accentLine; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(x + 16, y + 1); ctx.lineTo(x + w - 16, y + 1); ctx.stroke();

    ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    ctx.fillStyle = C.textPrimary; ctx.font = theme.font('h2');
    ctx.fillText(p.title || '', W / 2, y + 22);
    ctx.fillStyle = C.textSecondary; ctx.font = theme.font('body');
    msgLines.slice(0, 6).forEach((ln, i) => ctx.fillText(ln, W / 2, y + 62 + i * 24));
    ctx.restore();

    // 按钮组
    const buttons = (p.buttons && p.buttons.length) ? p.buttons : [
      { label: '取消', action: 'cancel', variant: 'secondary' },
      { label: '确定', action: 'confirm', variant: 'primary' }
    ];
    const bh = 48, gap = 12, pad = 20;
    const bw = (w - pad * 2 - gap * (buttons.length - 1)) / buttons.length;
    const by = y + h - 20 - bh;
    this._regions = [];
    for (let i = 0; i < buttons.length; i++) {
      const bx = x + pad + i * (bw + gap);
      drawButtonLocal(ctx, bx, by, bw, bh, buttons[i].label, buttons[i].variant || 'secondary');
      this._regions.push({ rect: { x: bx, y: by, w: bw, h: bh }, action: buttons[i].action });
    }
  }

  hitGeneric(x, y) {
    if (!this.interactive()) return null; // 200ms 防穿透
    for (const r of this._regions) if (inRect(x, y, r.rect)) return r.action;
    const p = this.payload || {};
    // 遮罩点击：confirm/resume 拦截；storageError 可关
    if (p.maskClosable && this.current === 'storageError') return '__mask__';
    return null;
  }

  resolveGeneric(act) {
    if (act == null) return;
    const p = this.payload || {};
    if (p.onAction) p.onAction(act, this);
    else this.close();
  }
}

// 通用按钮绘制（自包含：primary/secondary/danger/ghost + 按下态 + 禁用态）
// 现统一转发到 render/tap.drawTapButton（按下缩放脉冲 = MOTION.scale .97，配色一致）。
function drawButtonLocal(ctx, x, y, w, h, text, variant, opts) {
  opts = opts || {};
  return tapMod.drawTapButton(ctx, {
    x: x, y: y, w: w, h: h,
    label: text,
    fontKey: 'button',
    kind: variant || 'primary',
    disabled: opts.disabled,
    pressed: opts.pressed,
    radius: (typeof opts.radius === 'number') ? opts.radius : undefined
  });
}

// ==================== Banner（UX §2.3 L2，不拦截触摸）====================
class BannerManager {
  constructor() { this.visible = false; this.text = ''; this.type = 'success'; this.shownAt = 0; this.reduceMotion = false; }
  show(text, type) { this.text = text || ''; this.type = type || 'success'; this.shownAt = now(); this.visible = true; }
  clear() { this.visible = false; }
  update() {
    if (!this.visible) return;
    const M = theme.motion;
    const inMs = this.reduceMotion ? 0 : M.bannerIn;
    const outMs = this.reduceMotion ? 0 : M.bannerOut;
    if (now() - this.shownAt >= inMs + M.bannerHold + outMs) this.visible = false;
  }
  render(ctx, W, H, safeTop) {
    if (!this.visible) return;
    const C = theme.colors, R = theme.radius, M = theme.motion;
    const elapsed = now() - this.shownAt;
    const inMs = this.reduceMotion ? 0 : M.bannerIn;
    const outMs = this.reduceMotion ? 0 : M.bannerOut;
    const h = 44, w = W - 16, x = 8;
    const restY = (typeof safeTop === 'number' && safeTop > 0) ? safeTop : 0; // 避让系统状态栏/胶囊（L1）
    let y = restY;
    if (elapsed < inMs) y = restY - h * (1 - (elapsed / inMs));
    else if (elapsed > inMs + M.bannerHold) y = restY - h * Math.min(1, (elapsed - inMs - M.bannerHold) / (outMs || 1));
    const bg = this.type === 'danger' ? C.danger : this.type === 'info' ? C.info :
               this.type === 'warning' ? C.warning : C.success;
    const shapeFn = this.type === 'danger' ? icons.drawClose
                  : this.type === 'info' ? icons.drawInfo
                  : this.type === 'warning' ? icons.drawWarning
                  : icons.drawCheck;
    ctx.save();
    withShadow(ctx, theme.elevation.e1, () => { ctx.fillStyle = bg; rr(ctx, x, y, w, h, R.sm); ctx.fill(); });
    ctx.fillStyle = C.bgBase; ctx.font = theme.font('body');
    const iconSize = 18, gap = 8;
    const tw = ctx.measureText(this.text).width;
    const totalW = iconSize + gap + tw;
    const startX = W / 2 - totalW / 2;
    shapeFn(ctx, startX + iconSize / 2, y + h / 2, iconSize, C.bgBase);
    ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    ctx.fillText(this.text, startX + iconSize + gap, y + h / 2);
    ctx.restore();
  }
}

// ==================== 场景管理器 ====================
class SceneManager {
  constructor(ctx, width, height) {
    this.ctx = ctx;
    this.width = width;
    this.height = height;
    this.scenes = {};
    this.currentScene = null;
    this.currentSceneName = '';
    this.stack = [];               // [{name, params}]
    this.modal = new ModalManager();
    this.banner = new BannerManager();
    this.reduceMotion = false;
    this._enterFade = null;
  }

  register(name, scene) { this.scenes[name] = scene; }

  _activate(name, params) {
    if (this.currentScene && this.currentScene.exit) {
      try { this.currentScene.exit(); } catch (e) { /* 隔离单个场景异常 */ }
    }
    this.currentScene = this.scenes[name] || null;
    this.currentSceneName = name;
    this.modal.close();
    this.banner.clear();
    if (this.currentScene && this.currentScene.enter) {
      const p = params || {};
      p.screenWidth = this.width;
      p.screenHeight = this.height;
      p._sm = this;
      this.currentScene.enter(p);
    }
    // 场景转场：进入新场景时播放一次淡入（消费 MO.transition，消除硬切；R2）
    const tdur = this.reduceMotion ? 0 : (theme.motion.transition || 0);
    this._enterFade = tdur > 0 ? { start: now(), dur: tdur } : null;
  }

  /** 切换场景（重置栈为单元素），保留原签名兼容 */
  switchTo(name, params = {}) {
    this.stack = [{ name, params }];
    this._activate(name, Object.assign({}, params, { resume: false }));
  }
  /** 压栈并切换 */
  push(name, params = {}) {
    this.stack.push({ name, params });
    this._activate(name, Object.assign({}, params, { resume: false }));
  }
  /** 出栈回到上一场景（带 resume 标记，供保留滚动位置等） */
  pop() {
    if (this.stack.length <= 1) { this.switchTo('menu'); return; }
    this.stack.pop();
    const top = this.stack[this.stack.length - 1];
    this._activate(top.name, Object.assign({}, top.params, { resume: true }));
  }
  /** 回到根场景 menu */
  popToRoot() { this.switchTo('menu'); }
  /** 替换栈顶（S2→S3 用，避免返回死循环） */
  replace(name, params = {}) {
    if (this.stack.length === 0) this.stack.push({ name, params });
    else this.stack[this.stack.length - 1] = { name, params };
    this._activate(name, Object.assign({}, params, { resume: false }));
  }

  update(dt) {
    this.banner.reduceMotion = this.reduceMotion;
    this.banner.update();
    if (this.currentScene && this.currentScene.update) {
      try { this.currentScene.update(dt); } catch (e) { /* 隔离 */ }
    }
  }

  render() {
    if (this.currentScene && this.currentScene.render) {
      try { this.currentScene.render(this.ctx, this.width, this.height); } catch (e) { /* 隔离 */ }
    }
    // Banner 最后绘制（L2 浮层，不拦截触摸，可盖在模态之上）
    const L = layoutMod.get();
    const navSafeTop = (L && typeof L.navSafeTop === 'number') ? L.navSafeTop
      : (L && L.safe && typeof L.safe.top === 'number') ? L.safe.top : 0;
    // P2：横幅锚定在「顶栏下方」（navSafeTop + 导航高 44 + 间距 4），不再遮挡返回/标题/计时；
    // 滑入起点 = restY - h = navSafeTop + 4，已避开状态栏/胶囊带（溢出修复）。
    this.banner.render(this.ctx, this.width, this.height, navSafeTop + 48);
    // 场景转场淡入遮罩（最上层，纯视觉，不影响逻辑；R2）
    if (this._enterFade) {
      const e = now() - this._enterFade.start;
      if (e >= this._enterFade.dur) this._enterFade = null;
      else {
        this.ctx.save();
        this.ctx.globalAlpha = 1 - e / this._enterFade.dur;
        this.ctx.fillStyle = theme.colors.bgBase;
        this.ctx.fillRect(0, 0, this.width, this.height);
        this.ctx.restore();
      }
    }
  }

  onTouchStart(x, y) {
    if (this.currentScene && this.currentScene.onTouchStart) {
      try { this.currentScene.onTouchStart(x, y); } catch (e) { /* 隔离 */ }
    }
  }
  onTouchMove(x, y) {
    if (this.currentScene && this.currentScene.onTouchMove) {
      try { this.currentScene.onTouchMove(x, y); } catch (e) { /* 隔离 */ }
    }
  }
  onTouchEnd(x, y) {
    if (this.currentScene && this.currentScene.onTouchEnd) {
      try { this.currentScene.onTouchEnd(x, y); } catch (e) { /* 隔离 */ }
    }
  }
}

module.exports = SceneManager;
module.exports.SceneManager = SceneManager;
module.exports.TouchGuard = TouchGuard;
// 统一按钮原语（Phase 3·12）：场景可 `const { createTap, util } = M;`
module.exports.createTap = tapMod.createTap;
module.exports.drawTapButton = tapMod.drawTapButton;
module.exports.drawTapHighlight = tapMod.drawTapHighlight;
module.exports.MOTION = tapMod.MOTION;
module.exports.ModalManager = ModalManager;
module.exports.BannerManager = BannerManager;
module.exports.theme = theme;
const BASE_THEME_COLORS = Object.assign({}, theme.colors);
function applyTheme(themeId) {
  let palettes = null;
  try { palettes = require('../core/themes'); } catch (e) { palettes = null; }
  const overrides = palettes && palettes.getPalette ? palettes.getPalette(themeId) : null;
  const keys = Object.keys(BASE_THEME_COLORS);
  for (let i = 0; i < keys.length; i++) {
    const k = keys[i];
    theme.colors[k] = overrides && overrides[k] ? overrides[k] : BASE_THEME_COLORS[k];
  }
  theme.active = (themeId === 'light' || themeId === 'kids') ? themeId : 'dark';
  return theme.active;
}
module.exports.applyTheme = applyTheme;
// 供场景自绘复用的小工具
module.exports.util = {
  rr, inRect, wrapLocal, withShadow, drawButtonLocal, now,
  // 统一按钮原语（Phase 3·12）
  createTap: tapMod.createTap,
  drawTapButton: tapMod.drawTapButton,
  drawTapHighlight: tapMod.drawTapHighlight,
  MOTION: tapMod.MOTION
};
