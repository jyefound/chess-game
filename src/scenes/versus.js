/**
 * S-Versus 双人对弈 · 对局方式选择页（墨金棋院 · Ink & Brass）
 * ----------------------------------------------------------------------------
 * 层级关系（用户最新 IA 要求）：
 *   主菜单只保留一个「双人对弈」入口 → 本页 → 本页提供两个动作：
 *     · 本地双人（默认 / 推荐动作，主卡 + 黄铜主按钮）→ gameplay(local)
 *     · 邀请好友加入（次级入口，次卡 + secondary 按钮）→ room（发起邀请 / 加入房间）
 *
 * 本页是**新的一层过渡页**，不是配置页：不含任何设置项、不做任何云调用、不做授权检查
 * （远程能力探测留在 room.js 的 _probeAvailable() / _showUnavailable() 降级里）。
 *
 * 视觉规范：
 *   - 颜色一律 C.* token、字号一律 TF(k) token（禁止裸 hex / rgba / 裸 px 字号）；
 *   - 安全区一律 layout.get()（contentLeft / contentRight / contentBottom / navSafeTop）；
 *   - 两张卡片按内容驱动高度（panels.wrapText / panels.lineHeight 实测折行），
 *     320×568 窄屏下逐级降级（内边距 → 说明行 → 图标尺寸），**不硬裁切**；
 *   - 命中区热区 ≥ 44pt。
 *
 * 平台约束：微信小游戏纯 CommonJS + Canvas 2D 即时模式，无 DOM/CSS/HTML/SVG/eval/
 * window/document/fetch/XMLHttpRequest。所有渲染在 render(ctx) 每帧重绘。
 */
'use strict';

const GameContext = require('../context');
const M = require('./manager');
const { theme, TouchGuard, util, createTap } = M;
const C = theme.colors, R = theme.radius;
const TF = (k) => theme.font(k);
const inRect = util.inRect, drawBtn = util.drawButtonLocal;
const layout = require('../core/layout');
const panels = require('../render/panels');
const topbar = require('../render/topbar');

// 图标（可选，缺失静默；图标一律配文字标签，C6）
const icons = (() => { try { return require('../render/icons'); } catch (e) { return null; } })();
function ico(ctx, name, cx, cy, size, color) {
  if (icons && typeof icons.drawIcon === 'function') {
    try { icons.drawIcon(ctx, name, cx, cy, size, color); return true; } catch (e) { /* noop */ }
  }
  return false;
}

// ---- 本页内容（文案唯一来源，改这里即可）----
const LOCAL_CARD = {
  key: 'local',
  icon: 'twoPlayers',
  title: '本地双人',
  sub: '同一台屏幕，两人轮流走棋',
  note: '棋盘方向全程固定，双方各占上下两侧',
  btn: '开始对局',
  badge: '默认'
};

const REMOTE_CARD = {
  key: 'remote',
  icon: 'copy',
  title: '邀请好友加入',
  sub: '好友用自己的设备远程加入同一局',
  btn: '发起邀请 / 加入房间',
  badge: ''
};

const FOOTER_TEXT = '远程对局需双方均在同一小程序内，好友通过分享卡片或房间码加入';

// 自适应档位：从宽松到紧凑，逐级缩小内边距 / 图标 / 间距 / 说明行数，保证 320×568 不越界。
// 最后一档（hideFooter）为极矮屏（横屏手机）兜底：隐藏底部脚注换取两张卡片的容身空间。
const LEVELS = [
  { cardPad: 16, iconS: 34, gapCard: 16, btnH: 52, noteMax: 2, gapTitleSub: 6, gapNote: 6, gapBtn: 14, titleGap: 10, hideFooter: false },
  { cardPad: 14, iconS: 30, gapCard: 12, btnH: 48, noteMax: 2, gapTitleSub: 5, gapNote: 5, gapBtn: 12, titleGap: 9, hideFooter: false },
  { cardPad: 12, iconS: 26, gapCard: 10, btnH: 46, noteMax: 1, gapTitleSub: 4, gapNote: 4, gapBtn: 10, titleGap: 8, hideFooter: false },
  { cardPad: 10, iconS: 24, gapCard: 8, btnH: 44, noteMax: 0, gapTitleSub: 4, gapNote: 0, gapBtn: 8, titleGap: 8, hideFooter: false },
  { cardPad: 6, iconS: 20, gapCard: 8, btnH: 44, noteMax: 0, gapTitleSub: 2, gapNote: 0, gapBtn: 5, titleGap: 6, hideFooter: true }
];

class VersusScene {
  constructor() {
    this.guard = new TouchGuard();
    this.regions = [];
    this.pressed = null;
    this.tap = createTap();          // 统一按压状态 + 90ms 防穿透
    this.sm = null;
    this.from = 'menu';
    this.screenWidth = 375;
    this.screenHeight = 667;
    this.geo = null;                 // 最近一次布局结果（render 用）
  }

  // ==================== 生命周期 ====================
  enter(params = {}) {
    this.sm = params._sm || null;
    this.from = params.from || 'menu';
    this.screenWidth = params.screenWidth || 375;
    this.screenHeight = params.screenHeight || 667;
    this.regions = [];
    this.pressed = null;
    this.guard.reset();
    this.tap.clear();
  }

  exit() { this.regions = []; this.pressed = null; this.tap.clear(); }
  clearTouch() { this.guard.reset(); this.pressed = null; this.tap.clear(); }
  update() {}

  // ==================== 布局（内容驱动 + 窄屏自适应）====================
  /**
   * 按当前档位计算完整几何（含实测折行结果）。纯计算，不绘制。
   * @param {object} ctx
   * @param {number} W
   * @param {number} navBottom 顶栏底边
   * @param {number} contentBottom 安全区内容底边
   * @param {object} lv 档位参数
   */
  _compute(ctx, W, navBottom, contentBottom, lv, mode) {
    const L = layout.get();
    // 安全区宽度必须夹到实际画布宽度内：layout 单例可能与当前渲染尺寸不同步
    // （例如 320 宽画布仍持有 375 的 layout），若直接用 L.contentRight 折行，
    // 脚注会按更宽的宽度排成一行、居中后左右溢出屏幕（首末字被裁切）。
    const colLeft = Math.max(0, Math.min(L.contentLeft, W - 80));
    const colRight = Math.min(W, Math.max(L.contentRight, colLeft + 80));
    const availW = Math.max(120, colRight - colLeft);
    const row = (mode === 'row');
    // 宽屏（平板 / 横屏）内容列收敛居中，避免超宽卡片行距被拉散（与 menu 平板分支同思路）
    // row 模式（横屏/极矮屏）：两张卡片左右并排，各占一半宽，纵向只占一张卡的高度。
    const cardW = row
      ? Math.max(120, Math.floor((availW - lv.gapCard) / 2))
      : Math.min(availW, 520);
    const cardXs = row ? [colLeft, colLeft + cardW + lv.gapCard] : [Math.floor((W - cardW) / 2)];
    const lhH2 = panels.lineHeight('h2');
    const lhCap = panels.lineHeight('caption');
    const lhMicro = panels.lineHeight('micro');

    const indent = lv.iconS + lv.titleGap;
    const innerW = cardW - lv.cardPad * 2;
    const textX = cardXs[0] + lv.cardPad + indent;
    const textW = Math.max(60, innerW - indent);

    const build = (def, isPrimary) => {
      const subLines = panels.wrapText(ctx, def.sub, textW, 'caption', 2);
      // note 为空（如次卡无说明行）时不要占任何高度：wrapText('') 会返回 ['']（长度 1），需显式置空
      const hasNote = !!(def.note && def.note.length);
      const noteLines = (hasNote && lv.noteMax > 0)
        ? panels.wrapText(ctx, def.note, textW, 'caption', lv.noteMax)
        : [];
      const headerH = Math.max(lv.iconS, lhH2);
      const subH = subLines.length * lhCap;
      const noteH = noteLines.length ? noteLines.length * lhCap : 0;
      const h = lv.cardPad + headerH + lv.gapTitleSub + subH +
        (noteH ? lv.gapNote + noteH : 0) + lv.gapBtn + lv.btnH + lv.cardPad;
      return {
        def: def, isPrimary: isPrimary,
        h: h, headerH: headerH, lhCap: lhCap,
        subLines: subLines, noteLines: noteLines,
        titleY: lv.cardPad + headerH / 2,          // 相对卡片顶部
        subY: lv.cardPad + headerH + lv.gapTitleSub, // 相对卡片顶部（首行基线用 top + i*lh + lh/2）
        noteY: lv.cardPad + headerH + lv.gapTitleSub + subH + (noteH ? lv.gapNote : 0),
        btnY: lv.cardPad + headerH + lv.gapTitleSub + subH + (noteH ? lv.gapNote + noteH : 0) + lv.gapBtn,
        btnH: lv.btnH
      };
    };

    const c1 = build(LOCAL_CARD, true);
    const c2 = build(REMOTE_CARD, false);

    // 底部脚注：按**安全区内容列宽**折行（不是卡片宽 —— 卡片宽在宽屏被收敛到 520，
    // 而脚注必须贴着内容列并保证不超出 contentRight），最多 3 行，超出则省略号收敛。
    const footW = availW;
    const footLines = lv.hideFooter ? [] : panels.wrapText(ctx, FOOTER_TEXT, footW, 'micro', 3);
    const footH = footLines.length * lhMicro;
    const footTop = contentBottom - footH;
    const footCx = colLeft + availW / 2;   // 脚注居中基准 = 内容列中心（非屏幕中心）

    // 卡片组占位：顶栏下 14pt 起；底部脚注上方留 10pt。
    // 有余量时整组在 [顶栏底, 脚注顶] 内垂直居中，避免底部大片空白。
    const baseTop = navBottom + 14;
    // availH 已扣除脚注高度（footTop）与间距 → 脚注高度天然计入布局预算：
    // 脚注多占一行，卡片可用高度就少一行，_plan() 会据此选更紧凑的档位。
    const availH = Math.max(0, footTop - 10 - baseTop);
    // row 模式：两卡并排，总高取较高者；stack 模式：两卡叠放，总高相加。
    const totalH = row ? Math.max(c1.h, c2.h) : c1.h + lv.gapCard + c2.h;
    // 硬钳制：卡片组底边绝不允许压到脚注顶（含居中偏移后的最终位置）。
    // 否则会出现「卡片放得下但脚注被挤到卡片底下 / 溢出屏幕」。
    const maxTop = Math.max(baseTop, footTop - 10 - totalH);
    const cardsTop = Math.min(baseTop + Math.max(0, Math.floor((availH - totalH) / 2)), maxTop);

    return {
      lv: lv, mode: mode || 'stack',
      cardX: cardXs[0], cardXs: cardXs, cardW: cardW,
      indent: indent, textX: textX, textW: textW,
      innerW: innerW, lhCap: lhCap, lhMicro: lhMicro,
      colLeft: colLeft, colRight: colRight, availW: availW,
      c1: c1, c2: c2, cardsTop: cardsTop, totalH: totalH,
      gapCard: lv.gapCard, cardPad: lv.cardPad, iconS: lv.iconS,
      footLines: footLines, footH: footH, footTop: footTop, footW: footW, footCx: footCx,
      availH: availH
    };
  }

  /**
   * 选档：优先宽松档，放不下则逐级降级。
   * 全部档位在 stack（上下叠放）模式下都放不下时 → 改用 row（左右并排）模式重试：
   * 横屏/极矮屏纵向空间不足时，并排比继续压缩更可读。
   */
  _plan(ctx, W, navBottom, contentBottom) {
    let last = null;
    for (let i = 0; i < LEVELS.length; i++) {
      const g = this._compute(ctx, W, navBottom, contentBottom, LEVELS[i], 'stack');
      if (!last) last = g;
      if (g.totalH <= g.availH) return g;
      last = g;
    }
    // stack 模式全部放不下 → row 模式（两卡并排，纵向只占一张卡高）
    for (let i = 0; i < LEVELS.length; i++) {
      const g = this._compute(ctx, W, navBottom, contentBottom, LEVELS[i], 'row');
      if (g.totalH <= g.availH) return g;
      last = g;
    }
    return last;
  }

  // ==================== 渲染 ====================
  render(ctx, W, H) {
    ctx.fillStyle = C.bgBase; ctx.fillRect(0, 0, W, H);
    this.regions = [];

    const L = layout.get();
    const contentBottom = Math.min(L.contentBottom, H - 12);

    // 共享顶栏（返回 / 标题 / 金发丝线）
    const nav = topbar.drawTopBar(ctx, {
      W: W,
      title: '双人对弈', fontKey: 'h1',
      back: { key: 'back', label: '返回', pressed: this.tap.isPressing('back', Date.now()) },
      divider: true
    });
    for (const r of nav.regions) this.regions.push(Object.assign({ fixed: true }, r));

    const g = this._plan(ctx, W, nav.bottom, contentBottom);
    this.geo = g;

    if (g.mode === 'row') {
      // 横屏 / 极矮屏：两张卡片左右并排，纵向只占一张卡的高度
      this._drawCard(ctx, g, g.c1, g.cardsTop, true, g.cardXs[0]);
      this._drawCard(ctx, g, g.c2, g.cardsTop, false, g.cardXs[1]);
    } else {
      this._drawCard(ctx, g, g.c1, g.cardsTop, true, g.cardX);
      this._drawCard(ctx, g, g.c2, g.cardsTop + g.c1.h + g.gapCard, false, g.cardX);
    }

    // 底部脚注（微字，避开 home indicator）
    // 逐行居中于**内容列中心** g.footCx（非屏幕中心）：折行宽度已按内容列宽收敛，
    // 每行宽度 ≤ contentRight-contentLeft，故左右边界必然落在安全区内。
    ctx.save();
    ctx.fillStyle = C.textTertiary; ctx.font = TF('micro');
    ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    for (let i = 0; i < g.footLines.length; i++) {
      ctx.fillText(g.footLines[i], g.footCx, g.footTop + i * g.lhMicro);
    }
    ctx.restore();

    // 通用模态（若其它逻辑打开了 confirm/resume 等，最上层绘制）
    if (this.sm && this.sm.modal && this.sm.modal.isOpen() && this.sm.modal.isGeneric()) {
      this.sm.modal.renderGeneric(ctx, W, H);
    }
  }

  /**
   * 画一张卡片（主卡带黄铜强调描边 + 默认徽章；次卡普通描边）。
   * @param {number} xIn 卡片左边界（row 模式下两卡 x 不同）
   */
  _drawCard(ctx, g, c, y, isPrimary, xIn) {
    const x = (xIn == null ? g.cardX : xIn), w = g.cardW, h = c.h;
    const textX = x + g.cardPad + g.indent;   // row 模式下每列的文本左边界不同
    panels.drawGroupPanel(ctx, x, y, w, h);

    // 层级强调：主卡用黄铜描边（次卡保持默认 border 描边）
    if (isPrimary) {
      ctx.save();
      ctx.strokeStyle = C.accent; ctx.lineWidth = 1.5;
      ctx.beginPath();
      const r = panels.GROUP_RADIUS;
      ctx.moveTo(x + r, y + 0.75);
      ctx.arcTo(x + w - 0.75, y + 0.75, x + w - 0.75, y + h - 0.75, r);
      ctx.arcTo(x + w - 0.75, y + h - 0.75, x + 0.75, y + h - 0.75, r);
      ctx.arcTo(x + 0.75, y + h - 0.75, x + 0.75, y + 0.75, r);
      ctx.arcTo(x + 0.75, y + 0.75, x + w - 0.75, y + 0.75, r);
      ctx.closePath();
      ctx.stroke();
      ctx.restore();
    }

    // 图标（必带文字标签，C6）
    const iconCx = x + g.cardPad + g.iconS / 2;
    const iconCy = y + c.titleY;
    ico(ctx, c.def.icon, iconCx, iconCy, g.iconS, isPrimary ? C.accent : C.textSecondary);

    // 标题
    ctx.save();
    ctx.fillStyle = C.textPrimary; ctx.font = TF('h2');
    ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    ctx.fillText(c.def.title, textX, y + c.titleY);
    ctx.restore();

    // 徽章（主卡「默认」）
    if (c.def.badge) {
      ctx.save();
      ctx.font = TF('micro');
      const bw = Math.ceil(ctx.measureText(c.def.badge).width) + 14;
      const bh = 20;
      const bx = x + w - g.cardPad - bw;
      const by = y + c.titleY - bh / 2;
      ctx.fillStyle = C.accentFade;
      ctx.beginPath();
      ctx.moveTo(bx + 10, by);
      ctx.arcTo(bx + bw, by, bx + bw, by + bh, 10);
      ctx.arcTo(bx + bw, by + bh, bx, by + bh, 10);
      ctx.arcTo(bx, by + bh, bx, by, 10);
      ctx.arcTo(bx, by, bx + bw, by, 10);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = C.accent; ctx.font = TF('micro');
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(c.def.badge, bx + bw / 2, by + bh / 2 + 1);
      ctx.restore();
    }

    // 副标题（caption / textSecondary）
    ctx.save();
    ctx.fillStyle = C.textSecondary; ctx.font = TF('caption');
    ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    for (let i = 0; i < c.subLines.length; i++) {
      ctx.fillText(c.subLines[i], textX, y + c.subY + i * g.lhCap + g.lhCap / 2);
    }
    ctx.restore();

    // 说明行（caption / textTertiary，主卡说明棋盘方向固定）
    if (c.noteLines.length) {
      ctx.save();
      ctx.fillStyle = C.textTertiary; ctx.font = TF('caption');
      ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
      for (let i = 0; i < c.noteLines.length; i++) {
        ctx.fillText(c.noteLines[i], textX, y + c.noteY + i * g.lhCap + g.lhCap / 2);
      }
      ctx.restore();
    }

    // 按钮：主卡黄铜实心（默认动作），次卡 secondary（层级明显更低）
    const btnX = x + g.cardPad;
    const btnW = g.innerW;
    const btnY = y + c.btnY;
    drawBtn(ctx, btnX, btnY, btnW, c.btnH, c.def.btn, isPrimary ? 'primary' : 'secondary',
      { pressed: this.tap.isPressing(c.def.key, Date.now()) });
    this.regions.push({ key: c.def.key, rect: { x: btnX, y: btnY, w: btnW, h: c.btnH } });
  }

  // ==================== 触摸分发 ====================
  onTouchStart(x, y) {
    this.guard.down(x, y);
    this.pressed = this._hit(x, y);
    if (this.pressed) this.tap.press(this.pressed, Date.now());
  }

  onTouchMove(x, y) {
    this.guard.move(x, y);
    if (this.guard.moved) { if (this.pressed) this.tap.clear(this.pressed); this.pressed = null; }
  }

  onTouchEnd(x, y) {
    const e = this.guard.end(x, y);
    if (this.pressed) this.tap.clear(this.pressed);
    this.pressed = null;
    if (!e.valid) return;
    const key = this._hit(x, y);
    if (!key) return;
    if (!this.tap.guard(Date.now(), key)) return;   // 90ms 防穿透
    GameContext.emit('tap', { key });
    this._activate(key);
  }

  _hit(x, y) {
    for (const r of this.regions) if (inRect(x, y, r.rect)) return r.key;
    return null;
  }

  _activate(key) {
    if (key === 'local') {
      // 本地双人：默认动作。replaceScene（不 push）——本页是过渡页，开始对局后不应再回到它
      GameContext.emit('navigate', { to: 'gameplay' });
      GameContext.replaceScene('gameplay', { mode: 'local' });
    } else if (key === 'remote') {
      // 远程双人对弈：进入房间场景（发起邀请 / 加入房间），由 room 负责云能力探测
      GameContext.emit('navigate', { to: 'room' });
      GameContext.pushScene('room', { from: 'versus' });
    } else if (key === 'back') {
      // 顶栏返回：回主菜单
      GameContext.popScene();
    }
  }
}

module.exports = VersusScene;
