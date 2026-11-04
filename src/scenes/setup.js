/**
 * S2 对局设置场景（第二轮审查 §6：3 个分组 + 1 个主按钮）
 * 结构：顶部导航 → 对局方式（标准/指导 分段）→ 棋力（简单/中等/困难 同一组容器）
 *       → 执棋（执白/执黑 分段 + 执黑提示）→ 吸底摘要 + 开始对局。
 *
 * 视觉与面板原语统一走 src/render/panels.js：组标题在容器外、组容器 surface1 圆角 16、
 * 组内行用弱分隔线、未选中不描边、选中态用 accentFade 底 + 右侧金点（≤2 信号），页面只保留
 * 一个实心金色主按钮。顶栏复用 src/render/topbar.js。
 *
 * 对局方式（V2_UX_SPEC §2.1 / §2.6）：
 *   标准 = 常规人机；指导 = AI 指导模式（coach:true，讲解每步，提示与悔棋不限次数）。
 *   切换模式不再静默改写用户已选难度（P1-07），说明行明确告知「沿用当前难度，可随时调整」。
 * 确认后 replace('gameplay')，避免「返回」退回设置页形成死循环（UX §1.3）。
 *
 * 响应式（Phase 1 / P0-01 / §6.5）：
 *   - compact（layout.isCompactH: H<620 或 isCompactW: W<340）垂直流式 + 内容驱动行高 +
 *     可滚动 + 吸底摘要/主按钮；难度行高按标题/说明实际行高计算，大字号分段转上下两行。
 *   - non-compact 保持原 375 基准坐标公式与几何不变，仅换成新的分组/选中态视觉与玩家语言文案。
 */
const GameContext = require('../context');
const M = require('./manager');
const { theme, TouchGuard, util, createTap } = M;
const C = theme.colors;
const TF = (k) => theme.font(k);
const rr = util.rr, inRect = util.inRect, drawBtn = util.drawButtonLocal;
const layout = require('../core/layout');
const topbar = require('../render/topbar');
const panels = require('../render/panels');

// 玩家语言：短行为描述，最多一行；不再暴露引擎实现信息（P1-06）
const DIFFICULTIES = [
  { key: 'easy', name: '简单', desc: '偶有疏漏', bars: 1 },
  { key: 'medium', name: '中等', desc: '攻守均衡', bars: 2 },
  { key: 'hard', name: '困难', desc: '步步紧逼', bars: 3 }
];

// 吸底摘要映射（必须来自 this.difficulty / this.color / this.style 实际值）
const DIFF_NAME = { easy: '简单', medium: '中等', hard: '困难' };
const COLOR_NAME = { w: '执白', b: '执黑' };
const STYLE_NAME = { standard: '标准', coach: '指导' };

// 安全图标（缺失时静默，图标必带文字标签，符合 C6）
const icons = (() => { try { return require('../render/icons'); } catch (e) { return null; } })();
function ico(ctx, name, x, y, size, color) {
  if (icons && typeof icons.drawIcon === 'function') {
    try { icons.drawIcon(ctx, name, x, y, size, color); return true; } catch (e) { /* noop */ }
  }
  return false;
}

class SetupScene {
  constructor() {
    this.guard = new TouchGuard();
    this.regions = [];
    this.pressed = null;
    this.tap = createTap(); // 统一按压状态 + 90ms 防穿透（Phase 3·12）
    this.difficulty = 'medium';
    this.color = 'w';
    this.style = 'standard';       // 'standard' | 'coach'
    this.screenWidth = 375;
    this.screenHeight = 667;
    this.sm = null;
    this.scrollY = 0;
    this.maxScroll = 0;
    this.contentHeight = 0;
    this.compact = false;
    this._vy = 0;            // 惯性滚动速度（第三轮：与阵图一致）
    this._lastScrollAt = 0;  // 滚动条短暂显示的计时基准（走查 P1）
  }

  enter(params = {}) {
    this.sm = params._sm || null;
    this.screenWidth = params.screenWidth || 375;
    this.screenHeight = params.screenHeight || 667;
    const last = params.prefill || GameContext.getLastConfig() || {};
    const settings = GameContext.getSettings();
    this.style = (last.style === 'coach' || last.coach) ? 'coach' : 'standard';
    this.difficulty = DIFFICULTIES.some(d => d.key === last.difficulty) ? last.difficulty
      : (this.style === 'coach' ? 'easy' : 'medium');
    this.color = (last.color === 'w' || last.color === 'b') ? last.color :
                 (settings.defaultColor === 'b' ? 'b' : 'w');
    this.regions = [];
    this.pressed = null;
    this.scrollY = 0;
    this.maxScroll = 0;
    this._vy = 0;
    this._lastScrollAt = 0;
    this.guard.reset();
    this.tap.clear();
  }

  exit() { this.regions = []; this.pressed = null; this.tap.clear(); this.scrollY = 0; this._vy = 0; }
  clearTouch() { this.guard.reset(); this.pressed = null; this.tap.clear(); this._vy = 0; }
  update() {
    // 惯性滚动（与阵图一致）：松手后按速度衰减，直到接近静止或撞到边界
    if (this.maxScroll > 0 && Math.abs(this._vy) > 0.5) {
      if (M.theme.reduceMotion) { this._vy = 0; return; } // 降级：直接吸附，不滑
      this.scrollY = Math.max(0, Math.min(this.maxScroll, this.scrollY - this._vy));
      if (this.scrollY <= 0 || this.scrollY >= this.maxScroll) this._vy = 0;
      else this._vy *= 0.93;
    } else {
      this._vy = 0;
    }
  }

  /**
   * 版面度量。non-compact 保持原 375 基准数值（坐标公式不变）；
   * compact 内容驱动垂直流式排布（虚拟坐标 + viewTop 偏移），overflow 交给滚动，
   * 主按钮与摘要始终吸底。
   * @param {number} navBottomIn drawTopBar 返回的顶栏底边
   */
  _metrics(W, H, navBottomIn) {
    const L = layout.get();
    const compact = !!(L.isCompactH || L.isCompactW);
    const gutter = 16;
    const cardW = W - gutter * 2;
    const startY = L.contentBottom - 52;   // 主按钮吸底（与 render 一致）
    const startH = 52;
    const navBottom = navBottomIn + 10;

    if (!compact) {
      const headerH = panels.lineHeight('caption') + 6;   // SectionHeader 占用高度
      const titleToPanel = 10;                            // 标题 → 组容器 10pt
      const groupGap = panels.GROUP_GAP;                  // 组间 24pt（统一节奏）
      const padIn = 6;                                    // 组内上下内边距
      const lhCap = panels.lineHeight('caption');
      const lhBody = panels.lineHeight('body');
      const rowH = Math.max(panels.MIN_TAP, lhBody + lhCap + 4);  // 棋力行高
      const segH = panels.MIN_TAP;                       // 2 选项组：单行分段高（375 一屏放下）

      // 组一「对局方式」：SectionHeader + GroupPanel（单行分段）
      const styleTitleY = navBottom + 6;
      const stylePanelY = styleTitleY + headerH + titleToPanel;
      const stylePanelH = padIn + segH + padIn;
      const styleSegY = stylePanelY + padIn;
      const styleNoteY = stylePanelY + stylePanelH + 4;

      // 组三「执棋」高度（含执黑提示），用于反推棋力组可用高度
      const colorHintH = lhCap;
      const colorPanelBaseH = padIn + segH + padIn;
      const colorPanelH = colorPanelBaseH + (this.color === 'b' ? (8 + colorHintH + padIn) : 0);
      const colorGroupH = headerH + titleToPanel + colorPanelH;

      // 吸底摘要 + 主按钮安全间距
      const summaryH = lhCap;
      const summaryY = startY - 8 - summaryH;
      const contentLimit = summaryY - 16;   // 内容可用底（≥12pt 安全间距之上）

      // 组二「棋力」3 行内容驱动高度
      const diffTitleY = stylePanelY + stylePanelH + groupGap;
      const diffPanelY = diffTitleY + headerH + titleToPanel;
      const diffGap = 0;
      const gap = diffGap;
      const avail = contentLimit - diffPanelY - groupGap - colorGroupH;
      let cardH = Math.max(panels.MIN_TAP, Math.min(68, Math.floor((avail - 2 * diffGap) / 3)));

      // 钳制：保证执棋组 / 执黑提示不侵入摘要 /「开始对局」按钮
      const colorBottomOf = (ch) => {
        const dpB = diffPanelY + 3 * ch + 2 * diffGap;
        return dpB + groupGap + headerH + titleToPanel + colorPanelH;
      };
      while (cardH > panels.MIN_TAP && colorBottomOf(cardH) > contentLimit) cardH--;

      const diffPanelH = 3 * cardH + 2 * diffGap;
      const diffPanelBottom = diffPanelY + diffPanelH;
      const colorSecY = diffPanelBottom + groupGap;
      const colorPanelY = colorSecY + headerH + titleToPanel;
      const colorSegY = colorPanelY + padIn;
      const hintY = colorPanelY + padIn + segH + 8;   // 仅执黑有意义

      // 375 基准单屏放下全部三组：不滚动、不渐隐、不出滚动条（既有交互保持不变）
      return {
        compact: false, gutter, cardW, gap, cardGap: gap, cardH, padIn,
        styleTitleY, stylePanelY, stylePanelH, styleRowH: rowH,
        styleSegY, styleSegH: segH, styleNoteY, styleNoteH: lhCap, styleStacked: false,
        diffTitleY, diffPanelY, diffPanelH, diffRowH: (3 * cardH + 2 * diffGap) / 3,
        colorSecY, colorPanelY, colorPanelH, colorRowH: rowH,
        colorSegY, colorSegH: segH, colorStacked: false, hintY, hintH: colorHintH,
        startY, startH, viewTop: 0, viewBottom: 0, contentHeight: 0, maxScroll: 0,
        showSummary: true, summaryY, summaryH
      };
    }

    // ---- compact：内容驱动垂直流式 + 吸底摘要（P0-01 / §6.5 / P1-08）----
    const gap = 10, cardGap = 8;
    const lhCap = panels.lineHeight('caption');
    const lhSub = panels.lineHeight('subtitle');
    const lhBody = panels.lineHeight('body');
    const stacked = (theme.fontScale || 1) >= 1.2;   // 1.25× 大字号：行转高
    const rowH = stacked ? Math.max(2 * panels.MIN_TAP, lhBody + lhCap + 24) : panels.MIN_TAP;

    const viewTop = navBottomIn + 6;
    const summaryH = lhCap;
    const summaryY = startY - 8 - summaryH;           // 摘要固定，底边距主按钮 8pt
    const viewBottom = summaryY - 14;                 // 内容底边距摘要 14pt（≥12pt 安全间距）

    const headerH = lhCap + 6;
    const titleToPanel = 10;
    const padIn = panels.GROUP_PAD;

    let v = 0;
    const vStyleTitle = v; v += headerH;
    const vStylePanel = v + titleToPanel;
    v = vStylePanel + padIn + 2 * rowH + padIn;
    v += panels.GROUP_GAP;                           // 组间距 24（统一节奏）

    const vDiffTitle = v; v += headerH;
    const vDiffPanel = v + titleToPanel;
    const diffRowH = Math.max(panels.MIN_TAP, lhSub + lhCap + 12);  // 标题 + 说明实际行高
    v = vDiffPanel + 3 * diffRowH;
    v += panels.GROUP_GAP;

    const vColorTitle = v; v += headerH;
    const vColorPanel = v + titleToPanel;
    const vColorRows = vColorPanel + padIn;
    v = vColorRows + 2 * rowH;
    let vHint = v;
    const hintH = ((theme.fontScale || 1) > 1.01 ? 2 : 1) * lhCap;  // 大字号提示折两行
    if (this.color === 'b') v = v + 8 + hintH + padIn;
    else v = v + padIn;
    v += 12;                                         // 底部留白
    const contentHeight = v;
    const maxScroll = Math.max(0, contentHeight - (viewBottom - viewTop));

    const colorPanelH = padIn + 2 * rowH + padIn + (this.color === 'b' ? (8 + hintH + padIn) : 0);

    return {
      compact: true, gutter, cardW, gap, cardGap, cardH: rowH, padIn,
      startY, startH, viewTop, viewBottom, contentHeight, maxScroll,
      showSummary: true, summaryY, summaryH,
      styleTitleY: viewTop + vStyleTitle, stylePanelY: viewTop + vStylePanel,
      stylePanelH: padIn + 2 * rowH + padIn, styleRowH: rowH,
      diffTitleY: viewTop + vDiffTitle, diffPanelY: viewTop + vDiffPanel,
      diffPanelH: 3 * diffRowH, diffRowH,
      colorSecY: viewTop + vColorTitle, colorPanelY: viewTop + vColorPanel,
      colorPanelH, colorRowH: rowH, hintY: viewTop + vHint, hintH
    };
  }

  render(ctx, W, H) {
    ctx.fillStyle = C.bgBase;
    ctx.fillRect(0, 0, W, H);
    this.regions = [];

    // ---- 顶部导航（三槽位，统一 TopBar）----
    const nav = topbar.drawTopBar(ctx, {
      title: '对局设置',
      fontKey: 'h1',
      back: { key: 'back', label: '返回', pressed: this.tap.isPressing('back', Date.now()) }
    });
    nav.regions.forEach(r => this.regions.push(r));

    const m = this._metrics(W, H, nav.bottom);
    this.compact = m.compact;
    this.maxScroll = m.maxScroll;
    this.scrollY = Math.max(0, Math.min(this.maxScroll, this.scrollY));
    this.contentHeight = m.contentHeight;

    // 顶部 1pt 金发丝线（固定，不随内容滚动）
    ctx.strokeStyle = C.accentLine; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(16, nav.bottom + 10); ctx.lineTo(W - 16, nav.bottom + 10); ctx.stroke();

    // 命中区注册：可滚动时按滚动偏移换算屏幕坐标，并裁掉视口外区域
    const sy = (y) => y - (m.maxScroll > 0 ? this.scrollY : 0);
    const addReg = (key, x, y, w, h) => {
      const ry = sy(y);
      if (m.maxScroll === 0 || (ry + h > m.viewTop + 2 && ry < m.viewBottom - 2)) {
        this.regions.push({ key, rect: { x, y: ry, w, h } });
      }
    };

    // ---- 可滚动内容 ----
    ctx.save();
    if (m.maxScroll > 0) {
      ctx.beginPath();
      ctx.rect(0, m.viewTop, W, Math.max(0, m.viewBottom - m.viewTop));
      ctx.clip();
      ctx.translate(0, -this.scrollY);
    }

    this._drawStyleGroup(ctx, m, addReg);
    this._drawDiffGroup(ctx, m, addReg);
    this._drawColorGroup(ctx, m, addReg);

    ctx.restore();

    // 滚动渐隐提示（可滚动时，顶部/底部淡出提示更多内容，含 320 首屏可发现性）
    if (this.maxScroll > 2) {
      if (this.scrollY > 2) this._fade(ctx, W, m.viewTop, true);
      if (this.scrollY < this.maxScroll - 2) this._fade(ctx, W, m.viewBottom, false);
      // 细滚动条（右缘 2px、滚动后短暂显示，不压卡片、不叠文字）
      this._scrollBar(ctx, W, m.viewTop, m.viewBottom);
    }

    // ---- 吸底摘要（固定视口、不随内容滚动）----
    if (m.showSummary) {
      const dn = DIFF_NAME[this.difficulty] || '中等';
      const cn = COLOR_NAME[this.color] || '执白';
      const sn = STYLE_NAME[this.style] || '标准';
      ctx.fillStyle = C.textSecondary; ctx.font = TF('caption');
      ctx.textAlign = 'center'; ctx.textBaseline = 'top';
      ctx.fillText(dn + ' · ' + cn + ' · ' + sn, W / 2, m.summaryY);
    }

    // ---- 开始对局 Primary（吸底，唯一实心金色主按钮）----
    // 文字由 drawBtn 居中绘制；图标整体居中地置于文字左侧，间距固定 10pt（≥8pt），消除写死偏移导致的重叠
    const btnPressed = this.tap.isPressing('start', Date.now());
    const iconName = this.style === 'coach' ? 'coach' : 'ai';
    const hasIcon = !!(icons && typeof icons.drawIcon === 'function');
    const iconS = 20, iconGap = 10;
    ctx.save();
    ctx.font = TF('button');
    const labelW = ctx.measureText('开始对局').width;
    ctx.restore();
    const cx = m.gutter + m.cardW / 2;
    const iconX = cx - labelW / 2 - iconGap - iconS;   // 图标紧贴文字左侧，间距 10pt
    drawBtn(ctx, m.gutter, m.startY, m.cardW, m.startH, '开始对局', 'primary', { pressed: btnPressed });
    if (hasIcon) ico(ctx, iconName, iconX, m.startY + (m.startH - iconS) / 2, iconS, C.textOnAccent);
    this.regions.push({ key: 'start', rect: { x: m.gutter, y: m.startY, w: m.cardW, h: m.startH } });
  }

  /** 分组一「对局方式」：GroupPanel；375 单行分段 / compact 两行式单选 */
  _drawStyleGroup(ctx, m, addReg) {
    const x = m.gutter;
    panels.drawSectionHeader(ctx, x, m.styleTitleY, '对局方式');
    panels.drawGroupPanel(ctx, x, m.stylePanelY, m.cardW, m.stylePanelH);

    if (!m.compact) {
      // 375 基准：单行分段，保证三组一屏可见（既有交互不变）
      const choices = [
        { label: '标准', value: 'standard' },
        { label: '指导', value: 'coach' }
      ];
      let pressedValue = null;
      for (const c of choices) {
        if (this.tap.isPressing('style:' + c.value, Date.now())) pressedValue = c.value;
      }
      const opts = { gap: 8, radius: panels.ROW_RADIUS, fontKey: 'body', pressedValue: pressedValue };
      const rects = panels.drawSegmented(ctx, x + m.padIn, m.styleSegY,
        m.cardW - m.padIn * 2, m.styleSegH, choices, this.style, opts);
      for (const r of rects) addReg('style:' + r.value, r.rect.x, r.rect.y, r.rect.w, r.rect.h);
      const note = this.style === 'coach' ? '沿用当前难度，可随时调整' : '标准对局，不打扰你专注落子';
      const lines = panels.wrapText(ctx, note, m.cardW, 'caption', 1);
      panels.drawLines(ctx, lines, x, m.styleNoteY,
        this.style === 'coach' ? C.accentSoft : C.textSecondary, 'caption');
      return;
    }

    const rowH = m.styleRowH;
    const top = m.stylePanelY + m.padIn;
    const rows = [
      { key: 'standard', title: '标准', sub: '安静对弈，不显示教练提示' },
      { key: 'coach', title: '指导', sub: 'AI 每步讲解，锦囊提示不限次' }
    ];
    for (let i = 0; i < rows.length; i++) {
      const s = rows[i];
      const ry = top + i * rowH;
      const selected = this.style === s.key;
      const pressed = this.tap.isPressing('style:' + s.key, Date.now());
      if (pressed) panels.drawPressed(ctx, x, ry, m.cardW, rowH, panels.ROW_RADIUS);
      panels.drawRadioRow(ctx, x, ry, m.cardW, rowH, {
        title: s.title, sub: s.sub, selected: selected, radius: panels.ROW_RADIUS
      });
      if (i < rows.length - 1) {
        panels.drawRowDivider(ctx, x + panels.GROUP_PAD, ry + rowH, m.cardW - panels.GROUP_PAD * 2);
      }
      addReg('style:' + s.key, x, ry, m.cardW, rowH);
    }
  }

  /** 分组二「棋力」：同一组容器 + 3 行 + 弱分隔线 + 统一选中态 */
  _drawDiffGroup(ctx, m, addReg) {
    const x = m.gutter;
    panels.drawSectionHeader(ctx, x, m.diffTitleY, '棋力');
    panels.drawGroupPanel(ctx, x, m.diffPanelY, m.cardW, m.diffPanelH);

    const textX = x + panels.GROUP_PAD;
    const lhSub = panels.lineHeight('subtitle');
    const lhCap = panels.lineHeight('caption');
    const checkReserve = 30;   // 为 drawSelection 右侧 ✓ 预留，避免与难度格重叠
    const barRight = x + m.cardW - panels.GROUP_PAD - checkReserve;
    const textW = Math.max(40, barRight - 8 - textX);

    for (let i = 0; i < DIFFICULTIES.length; i++) {
      const d = DIFFICULTIES[i];
      const rowY = m.diffPanelY + i * m.diffRowH;
      const selected = this.difficulty === d.key;

      if (selected) {
        panels.drawSelection(ctx, x, rowY, m.cardW, m.diffRowH, { radius: panels.ROW_RADIUS });
      }
      if (this.tap.isPressing('diff:' + d.key, Date.now())) {
        panels.drawPressed(ctx, x, rowY, m.cardW, m.diffRowH, panels.ROW_RADIUS);
      }

      // 名称（subtitle）+ 说明（caption，最多一行），按实际行高垂直居中
      const top = rowY + (m.diffRowH - (lhSub + lhCap)) / 2;
      panels.drawLines(ctx, [d.name], textX, top, C.textPrimary, 'subtitle');
      const descLines = panels.wrapText(ctx, d.desc, textW, 'caption', 1);
      panels.drawLines(ctx, descLines, textX, top + lhSub, C.textSecondary, 'caption');

      this._drawBars(ctx, d, barRight, rowY, m.diffRowH);

      if (i < DIFFICULTIES.length - 1) {
        panels.drawRowDivider(ctx, x + panels.GROUP_PAD, rowY + m.diffRowH,
          m.cardW - panels.GROUP_PAD * 2);
      }
      addReg('diff:' + d.key, x, rowY, m.cardW, m.diffRowH);
    }
  }

  /** 3 格信号格（自绘跨机型稳定；主动格用 accent，未亮 surface3） */
  _drawBars(ctx, d, barRight, rowY, rowH) {
    const barW = 5, gap = 3, total = 3 * barW + 2 * gap;
    const cy = rowY + rowH / 2;
    for (let b = 0; b < 3; b++) {
      const bh = 8 + b * 6;
      ctx.fillStyle = b < d.bars ? C.accent : C.surface3;
      rr(ctx, barRight - total + b * (barW + gap), cy - bh / 2, barW, bh, 1); ctx.fill();
    }
  }

  /** 分组三「执棋」：GroupPanel；375 单行分段 / compact 两行式单选 + 执黑提示 */
  _drawColorGroup(ctx, m, addReg) {
    const x = m.gutter;
    panels.drawSectionHeader(ctx, x, m.colorSecY, '执棋');
    panels.drawGroupPanel(ctx, x, m.colorPanelY, m.cardW, m.colorPanelH);

    if (!m.compact) {
      const choices = [
        { label: '执白 · 先手', value: 'w' },
        { label: '执黑 · AI 先手', value: 'b' }
      ];
      let pressedValue = null;
      if (this.tap.isPressing('color:w', Date.now())) pressedValue = 'w';
      if (this.tap.isPressing('color:b', Date.now())) pressedValue = 'b';
      const opts = { gap: 8, radius: panels.ROW_RADIUS, fontKey: 'body', pressedValue: pressedValue };
      const rects = panels.drawSegmented(ctx, x + m.padIn, m.colorSegY,
        m.cardW - m.padIn * 2, m.colorSegH, choices, this.color, opts);
      for (const r of rects) addReg('color:' + r.value, r.rect.x, r.rect.y, r.rect.w, r.rect.h);
    } else {
      const rowH = m.colorRowH;
      const top = m.colorPanelY + m.padIn;
      const rows = [
        { key: 'w', title: '执白 · 你先行', sub: '' },
        { key: 'b', title: '执黑 · AI 先行', sub: '' }
      ];
      for (let i = 0; i < rows.length; i++) {
        const c = rows[i];
        const ry = top + i * rowH;
        const selected = this.color === c.key;
        const pressed = this.tap.isPressing('color:' + c.key, Date.now());
        if (pressed) panels.drawPressed(ctx, x, ry, m.cardW, rowH, panels.ROW_RADIUS);
        panels.drawRadioRow(ctx, x, ry, m.cardW, rowH, {
          title: c.title, sub: c.sub, selected: selected, radius: panels.ROW_RADIUS
        });
        if (i < rows.length - 1) {
          panels.drawRowDivider(ctx, x + panels.GROUP_PAD, ry + rowH, m.cardW - panels.GROUP_PAD * 2);
        }
        addReg('color:' + c.key, x, ry, m.cardW, rowH);
      }
    }

    if (this.color === 'b') {
      ico(ctx, 'warning', x + panels.GROUP_PAD + 8, m.hintY + m.hintH / 2, 16, C.warning);
      const hintW = m.cardW - panels.GROUP_PAD * 2 - 26;
      const lines = panels.wrapText(ctx, '棋盘将翻转，白方先行',
        hintW, 'caption', m.compact ? 2 : 1);
      panels.drawLines(ctx, lines, x + panels.GROUP_PAD + 24, m.hintY, C.warning, 'caption');
    }
  }

  /** 视口上下沿渐隐（提示可滚动，与阵图一致 24pt） */
  _fade(ctx, W, y, topDown) {
    const h = 24;
    const g = ctx.createLinearGradient(0, y - (topDown ? 0 : h), 0, y + (topDown ? h : 0));
    g.addColorStop(0, topDown ? C.bgBase : 'rgba(16,21,27,0)');
    g.addColorStop(1, topDown ? 'rgba(16,21,27,0)' : C.bgBase);
    ctx.fillStyle = g;
    ctx.fillRect(0, topDown ? y : y - h, W, h);
  }

  /** 细滚动条：右缘 2px，滚动后 800ms 内短暂显示（alpha 0.25），不压卡片（走查 P1） */
  _scrollBar(ctx, W, top, bottom) {
    if (Date.now() - this._lastScrollAt > 800) return;
    const trackH = Math.max(1, bottom - top);
    const thumbH = Math.max(24, trackH * (trackH / (trackH + this.maxScroll)));
    const ratio = this.maxScroll > 0 ? this.scrollY / this.maxScroll : 0;
    const thumbY = top + ratio * (trackH - thumbH);
    ctx.save();
    ctx.globalAlpha = 0.25;
    ctx.fillStyle = C.textSecondary;
    rr(ctx, W - 8, thumbY, 2, thumbH, 1); ctx.fill();
    ctx.restore();
  }

  onTouchStart(x, y) {
    this.guard.down(x, y);
    this._vy = 0;            // 触碰即中止惯性滚动
    this.pressed = this._hit(x, y);
    if (this.pressed) this.tap.press(this.pressed, Date.now());
  }
  onTouchMove(x, y) {
    const mv = this.guard.move(x, y);
    if (mv && mv.moved) {
      this._vy = mv.stepY;   // 采样速度，供松手惯性滚动
      if (this.maxScroll > 0) {
        this.scrollY = Math.max(0, Math.min(this.maxScroll, this.scrollY - mv.stepY));
        this._lastScrollAt = Date.now();  // 滚动条显示计时（走查 P1）
      }
      if (this.pressed) this.tap.clear(this.pressed);
      this.pressed = null;
    }
  }
  onTouchEnd(x, y) {
    const e = this.guard.end(x, y);
    if (this.pressed) this.tap.clear(this.pressed);
    this.pressed = null;
    if (!e.valid) return;
    const key = this._hit(x, y);
    if (!key) return;
    if (!this.tap.guard(Date.now(), key)) return;
    GameContext.emit('tap', { key });
    this._activate(key);
  }

  _hit(x, y) {
    for (const r of this.regions) if (inRect(x, y, r.rect)) return r.key;
    return null;
  }

  _activate(key) {
    if (key === 'back') { GameContext.emit('navigate', { to: 'menu' }); GameContext.popScene(); return; }
    if (key.indexOf('style:') === 0) {
      const s = key.slice(6);
      if (s === this.style) return;
      // 切换模式保留用户当前难度，不再隐式改写（P1-07）
      this.style = s;
      return;
    }
    if (key.indexOf('diff:') === 0) { this.difficulty = key.slice(5); return; }
    if (key.indexOf('color:') === 0) { this.color = key.slice(6); return; }
    if (key === 'start') {
      const depth = theme.aiDepth[this.difficulty] || 3;
      const aiColor = this.color === 'w' ? 'b' : 'w';
      const coach = this.style === 'coach';
      // 记忆上次配置（写失败静默，不影响开局）
      GameContext.saveLastConfig({ difficulty: this.difficulty, color: this.color, style: this.style });
      GameContext.emit('navigate', { to: 'gameplay' });
      GameContext.replaceScene('gameplay', {
        mode: 'ai', coach: coach, aiDepth: depth, aiColor, playerColor: this.color
      });
    }
  }
}

module.exports = SetupScene;
