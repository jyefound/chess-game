/**
 * S8 锦囊阁 hub 场景（V2_UX_SPEC §3.2 / V2_VISUAL_SPEC §7.5 V-5 + §7.10 V-10）
 *
 * 四块内容（自上而下）：
 *  1) 妙招图鉴：动态读取 TIPS 导出（当前 15 张）两列网格；已收集显示妙招名+摘要（金边卡），
 *     未收集显示「?」灰卡 +「破阵解锁」。文案源 src/data/endgames.js 的 TIPS 导出，
 *     try/catch 兜底：数据未就绪时显示「图鉴数据载入中」，不崩。
 *  2) 新手试炼入口：大按钮 → teaching（文案「新 手 试 炼 · 第 N 式」，沿用续学进度）
 *  3) 规则速查：静态走子规则简表（纯文本卡）
 *  4) 更多棋种占位：xiangqi/gomoku/go 三张灰卡 +「即将开放」徽章（需求 4 预留，V-10 置灰）
 *
 * 顶部「锦囊阁」+「← 返回」（回 menu）；内容区可滚动（TouchGuard 8pt 区分滚动/点击）。
 */
const GameContext = require('../context');
const M = require('./manager');
const { theme, TouchGuard, util, createTap } = M;
const C = theme.colors, R = theme.radius;
const TF = (k) => theme.font(k);
const rr = util.rr, inRect = util.inRect, drawBtn = util.drawButtonLocal, wrapLocal = util.wrapLocal;
const layout = require('../core/layout');
const topbar = require('../render/topbar');
const storage = require('../core/storage');

const icons = (() => { try { return require('../render/icons'); } catch (e) { return null; } })();
function ico(ctx, name, x, y, size, color) {
  if (icons && typeof icons.drawIcon === 'function') {
    try { icons.drawIcon(ctx, name, x, y, size, color); return true; } catch (e) { /* noop */ }
  }
  return false;
}

// 妙招文案源（data-endgames 产出中，取不到就降级占位，绝不崩）
const TIPS = (() => {
  try {
    const d = require('../data/endgames');
    return (d && d.TIPS) ? d.TIPS : null;
  } catch (e) { return null; }
})();

// 妙招 id 列表直接由 TIPS 导出，数据扩量（10→100 + 15 条妙招）后自动适配
const TIP_IDS = (TIPS && Array.isArray(TIPS)) ? TIPS.map(t => (t && t.id) || '').filter(Boolean) : [];

/** 取一条妙招：兼容 {id,name,text} 数组与 {tip_01:{name,text}} 映射两种形态 */
function tipInfo(id) {
  if (!TIPS) return null;
  try {
    if (Array.isArray(TIPS)) {
      for (const t of TIPS) if (t && t.id === id) return t;
      return null;
    }
    const t = TIPS[id];
    if (!t) return null;
    if (typeof t === 'string') return { id: id, name: id, text: t };
    return t;
  } catch (e) { return null; }
}

// V-5 详情态：棋种占位卡的名称与说明
const GAME_DETAIL = {
  xiangqi: { name: '中国象棋', body: '楚河汉界，车马炮士象。该棋种正在开发中，敬请期待。' },
  gomoku: { name: '五子棋', body: '连珠成五即胜。该棋种正在开发中，敬请期待。' },
  go: { name: '围棋', body: '围地争目，气尽提子。该棋种正在开发中，敬请期待。' }
};

const RULES = [
  '兵：直走斜吃，首步可选两格，抵达底线升变',
  '马：走「日」字，唯一可跳子的棋子',
  '象：沿斜线走，不能跳子，只走同色格',
  '车：沿横竖线走，格数不限，不能跳子',
  '后：横竖斜皆可，威力最大（约 9 分）',
  '王：每次一格，不能送将；被将杀即输',
  '特殊：王车易位、吃过路兵、兵升变',
  '胜负：将杀者胜；逼和/50 回合/三次重复判和'
];

class AcademyScene {
  constructor() {
    this.guard = new TouchGuard({ moveThreshold: 8 });
    this.regions = [];
    this.pressed = null;
    this.tap = createTap(); // 统一按压状态 + 90ms 防穿透（Phase 3·12）
    this.scrollY = 0;
    this.maxScroll = 0;
    this.contentHeight = 0;
    this.screenWidth = 375;
    this.screenHeight = 667;
    this.from = 'menu';
    this.sm = null;
    this.tipsCollected = [];
    this.tipCount = 0;
    this.tipDetail = null;   // V-5 妙招/棋种详情态：{title, body}
    this.lessonIndex = 0;
    this.lessonLabel = 1;
  }

  enter(params = {}) {
    this.sm = params._sm || null;
    this.screenWidth = params.screenWidth || 375;
    this.screenHeight = params.screenHeight || 667;
    this.from = params.from || 'menu';
    this.regions = [];
    this.pressed = null;
    this.tipDetail = null;
    if (!params.resume) this.scrollY = 0;
    this.guard.reset();
    this.tap.clear();
    // 图鉴收集 + 新手试炼续学位置（从存档重算，enter / 云回填 onDataChanged 共用）
    this._refreshProgress();
  }

  /** 从存档重算图鉴收集与试炼续学缓存（enter / 云回填 onDataChanged 共用）。 */
  _refreshProgress() {
    let collected = [];
    try {
      const eg = storage.loadEndgame();
      if (eg && Array.isArray(eg.tipsCollected)) collected = eg.tipsCollected.slice();
    } catch (e) { collected = []; }
    this.tipsCollected = collected;
    let n = 0;
    for (const id of TIP_IDS) if (collected.indexOf(id) >= 0) n++;
    this.tipCount = n;
    // 新手试炼续学位置：下一节未完成式；全部完成回到最后一式（复习）
    const prog = GameContext.getTutorialProgress();
    const done = Array.isArray(prog && prog.completed) ? prog.completed : [];
    let next = 0;
    while (next < 10 && done[next]) next++;
    if (next >= 10) next = Math.max(0, Math.min(9, (prog && prog.lastLesson) || 0));
    this.lessonIndex = next;
    this.lessonLabel = next + 1;
  }

  /** 云回填后刷新缓存字段；不重置滚动 / 按压态 / 详情态。 */
  onDataChanged() {
    try { this._refreshProgress(); } catch (e) { /* 静默，无 wx 环境也安全 */ }
  }

  exit() { this.regions = []; this.pressed = null; this.tap.clear(); }
  clearTouch() { this.guard.reset(); this.pressed = null; this.tap.clear(); }
  update() {}

  render(ctx, W, H) {
    ctx.fillStyle = C.bgBase; ctx.fillRect(0, 0, W, H);
    this.regions = [];
    const L = layout.get();
    // 统一三槽位顶栏；标题下沉时高度变大，内容区起点必须用实测 bottom
    const navOpts = {
      title: '锦囊阁', fontKey: 'h2',
      back: { key: 'back', label: '返回', pressed: this.tap.isPressing('back', Date.now()) }
    };
    const navM = topbar.measureTopBar(ctx, navOpts);
    const contentTop = navM.bottom + 10;
    const contentBottom = Math.min(L.contentBottom, H - 12);
    const viewportH = Math.max(0, contentBottom - contentTop);
    this.maxScroll = Math.max(0, this.contentHeight - viewportH);
    if (this.scrollY > this.maxScroll) this.scrollY = this.maxScroll;
    if (this.scrollY < 0) this.scrollY = 0;
    const sy = (vY) => contentTop + vY - this.scrollY;
    const addRegion = (key, x, vY, w, h) => {
      const y = sy(vY);
      if (y + h > contentTop && y < contentBottom) this.regions.push({ key, rect: { x, y, w, h } });
    };

    // ---- 固定顶栏：返回 + 标题（先遮罩，再绘顶栏，避免内容滚动穿透）----
    ctx.fillStyle = C.bgBase; ctx.fillRect(0, 0, W, contentTop - 6);
    const nav = topbar.drawTopBar(ctx, navOpts);
    nav.regions.forEach(r => this.regions.push(r));
    ctx.strokeStyle = C.accentLine; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(16, contentTop - 6.5); ctx.lineTo(W - 16, contentTop - 6.5); ctx.stroke();

    // ---- 可滚动内容 ----
    ctx.save();
    ctx.beginPath(); ctx.rect(0, contentTop, W, viewportH); ctx.clip();
    const gutter = 16, contentW = W - gutter * 2;
    let vY = 0;

    // ① 新手试炼入口（hub 主 CTA，置于首屏可见）
    const teachH = 56;
    drawBtn(ctx, gutter, sy(vY), contentW, teachH, '', 'primary', { pressed: this.tap.isPressing('teaching', Date.now()) });
    ico(ctx, 'teach', gutter + 40, sy(vY) + teachH / 2, 26, C.textOnAccent);
    ctx.fillStyle = C.textOnAccent; ctx.font = TF('button');
    ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    ctx.fillText(`新手试炼 · 第 ${this.lessonLabel} 式`, gutter + 70, sy(vY) + teachH / 2 + 1);
    // 右簇箭头：落在 accent 主按钮填充上，须用 textOnAccent（7.63:1），不可用 textSecondary（1.12:1 几乎不可见）
    ctx.fillStyle = C.textOnAccent;
    ctx.font = TF('h2B'); ctx.textAlign = 'right';
    icons.drawChevron(ctx, gutter + contentW - 24, sy(vY) + teachH / 2, 22, 'right', C.textOnAccent);
    addRegion('teaching', gutter, vY, contentW, teachH);
    vY += teachH + 22;

    // ② 妙招图鉴
    ctx.fillStyle = C.accent; ctx.font = TF('caption');
    ctx.textAlign = 'left'; ctx.textBaseline = 'top';
    icons.drawBullet(ctx, gutter + 6, sy(vY) + 7, 13, 'diamond', C.accent);
    ctx.fillStyle = C.accent; ctx.textAlign = 'left'; ctx.textBaseline = 'top';
    ctx.fillText('妙招图鉴', gutter + 16, sy(vY));
    ctx.fillStyle = C.textSecondary; ctx.textAlign = 'right';
    // 分母从数据层派生，妙招库已由 12 条扩到 TIP_IDS.length 条
    ctx.fillText(`已收集 ${this.tipCount}/${TIP_IDS.length}`, W - gutter, sy(vY));
    vY += 24;
    const cardW = (contentW - 12) / 2, cardH = 100, cardGap = 12;
    for (let i = 0; i < TIP_IDS.length; i++) {
      const id = TIP_IDS[i];
      const col = i % 2, row = Math.floor(i / 2);
      const cx = gutter + col * (cardW + cardGap);
      const cy = vY + row * (cardH + cardGap);
      this._tipCard(ctx, id, cx, sy(cy), cardW, cardH);
      // V-5：妙招卡可点进详情态（命中区 ≥44）
      addRegion('tip:' + id, cx, cy, cardW, cardH);
    }
    vY += Math.ceil(TIP_IDS.length / 2) * (cardH + cardGap) + 6;

    // ③ 规则速查
    ctx.fillStyle = C.accent; ctx.font = TF('caption');
    ctx.textAlign = 'left'; ctx.textBaseline = 'top';
    icons.drawBullet(ctx, gutter + 6, sy(vY) + 7, 13, 'diamond', C.accent);
    ctx.fillStyle = C.accent; ctx.textAlign = 'left'; ctx.textBaseline = 'top';
    ctx.fillText('规则速查', gutter + 16, sy(vY));
    vY += 24;
    const rulesH = 24 + RULES.length * 22 + 12;
    ctx.fillStyle = C.surface1; rr(ctx, gutter, sy(vY), contentW, rulesH, R.card); ctx.fill();
    ctx.strokeStyle = C.border; ctx.lineWidth = 1;
    rr(ctx, gutter + 0.5, sy(vY) + 0.5, contentW - 1, rulesH - 1, R.card); ctx.stroke();
    ctx.fillStyle = C.textSecondary; ctx.font = TF('caption');
    RULES.forEach((line, i) => ctx.fillText(line, gutter + 14, sy(vY) + 12 + i * 22));
    vY += rulesH + 20;

    // ④ 更多棋种占位（V-10：整卡 α.4 置灰，徽章用 neutral 非 accent）
    ctx.fillStyle = C.accent; ctx.font = TF('caption');
    ctx.textAlign = 'left'; ctx.textBaseline = 'top';
    icons.drawBullet(ctx, gutter + 6, sy(vY) + 7, 13, 'diamond', C.accent);
    ctx.fillStyle = C.accent; ctx.textAlign = 'left'; ctx.textBaseline = 'top';
    ctx.fillText('更多棋种', gutter + 16, sy(vY));
    ctx.fillStyle = C.textSecondary; ctx.textAlign = 'right';
    ctx.fillText('即将开放', W - gutter, sy(vY));
    vY += 24;
    const games = [
      { key: 'xiangqi', name: '中国象棋' },
      { key: 'gomoku', name: '五子棋' },
      { key: 'go', name: '围棋' }
    ];
    const gW = (contentW - 32) / 3, gH = 96;
    // 卡体整体置灰 α.4；「即将开放」徽章必须画在 α.4 作用域之外，
    // 否则文字对比度会掉到 ≈2.9:1（V-10 视觉终审必修）。
    // 卡体 α.4 置灰（保留「即将开放」占位观感）；图标+棋种名另以全不透明度绘制于卡体之上，
    // 否则随 α.4 衰减后文字≈2.9:1 不达标（与下方「即将开放」徽章同处理：徽章已在 α.4 作用域之外）。
    ctx.save();
    ctx.globalAlpha = 0.4;
    games.forEach((g, i) => {
      const gx = gutter + i * (gW + 16);
      const gy = sy(vY);
      ctx.fillStyle = C.surface3; rr(ctx, gx, gy, gW, gH, R.sm); ctx.fill();
      // V-5：棋种占位卡也可点，进详情态说明「即将开放」
      addRegion('tip:game:' + g.key, gx, vY, gW, gH);
    });
    ctx.restore();
    games.forEach((g, i) => {
      const gx = gutter + i * (gW + 16);
      const gy = sy(vY);
      ico(ctx, g.key, gx + gW / 2, gy + 28, 26, C.textSecondary);
      ctx.fillStyle = C.textPrimary; ctx.font = TF('caption');
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(g.name, gx + gW / 2, gy + 52);
    });
    // 徽章：深底 surface3 + accentSoft 字，bh=22，全不透明度绘制
    games.forEach((g, i) => {
      const gx = gutter + i * (gW + 16);
      const gy = sy(vY);
      ctx.save();
      ctx.font = TF('micro');
      const bw = ctx.measureText('即将开放').width + 14, bh = 22;
      const bx = gx + (gW - bw) / 2, by = gy + gH - 34;
      ctx.fillStyle = C.surface3; rr(ctx, bx, by, bw, bh, 999); ctx.fill();
      ctx.fillStyle = C.accentSoft; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('即将开放', bx + bw / 2, by + bh / 2);
      ctx.restore();
    });
    vY += gH + 16;

    ctx.restore();
    this.contentHeight = vY;

    // 顶部/底部渐隐提示（可滚动）
    if (this.scrollY > 2) this._fade(ctx, W, contentTop, true);
    if (this.scrollY < this.maxScroll - 2) this._fade(ctx, W, contentBottom, false);

    // V-5 详情态：全屏遮罩 + 卡片（最后绘制，层级最上；200ms 防穿透由 tap.guard 统一接管）
    if (this.tipDetail) this._renderTipDetail(ctx, W, H, contentTop, contentBottom);
  }

  _renderTipDetail(ctx, W, H, contentTop, contentBottom) {
    // 模态期间底层命中区全部失效，仅注册「关闭」全屏命中区
    this.regions = [];
    ctx.fillStyle = C.overlay; ctx.fillRect(0, 0, W, H);
    const dw = Math.min(W - 48, 320), dh = 208;
    const dx = (W - dw) / 2, dy = (H - dh) / 2;
    util.withShadow(ctx, theme.elevation.e2, () => { ctx.fillStyle = C.surface1; rr(ctx, dx, dy, dw, dh, R.card); ctx.fill(); });
    ctx.strokeStyle = C.accentLine; ctx.lineWidth = 1;
    rr(ctx, dx + 0.5, dy + 0.5, dw - 1, dh - 1, R.card); ctx.stroke();

    const d = this.tipDetail;
    ico(ctx, 'spark', dx + 24, dy + 30, 20, C.accent);
    ctx.fillStyle = C.textPrimary; ctx.font = TF('subtitleB');
    ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    ctx.fillText(d.title, dx + 42, dy + 30);

    ctx.fillStyle = C.textSecondary; ctx.font = TF('body');
    ctx.textAlign = 'left'; ctx.textBaseline = 'top';
    const lines = wrapLocal(ctx, d.body, dw - 40);
    lines.slice(0, 4).forEach((ln, i) => ctx.fillText(ln, dx + 20, dy + 62 + i * 24));

    ctx.fillStyle = C.accent; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.font = TF('bodyB');
    ctx.fillText('知道了', dx + dw / 2, dy + dh - 34);
    // 关闭按钮命中区 ≥44×44，另保留整屏点击关闭
    const cw = 96, ch = 44, cx = dx + (dw - cw) / 2, cy = dy + dh - 34 - ch / 2;
    this.regions.push({ key: 'tipClose', rect: { x: cx, y: cy, w: cw, h: ch } });
    ctx.fillStyle = C.disabledFg; ctx.font = TF('caption');
    ctx.fillText('轻点任意处关闭', dx + dw / 2, dy + dh - 10);
  }

  _fade(ctx, W, y, topDown) {
    const g = ctx.createLinearGradient(0, y - (topDown ? 0 : 12), 0, y + (topDown ? 12 : 0));
    g.addColorStop(0, topDown ? C.bgBase : 'rgba(16,21,27,0)');
    g.addColorStop(1, topDown ? 'rgba(16,21,27,0)' : C.bgBase);
    ctx.fillStyle = g; ctx.fillRect(0, topDown ? y : y - 12, W, 12);
  }

  /** 妙招卡：已收集=金边卡+名+摘要；未收集=灰卡+「?」+破阵解锁 */
  _tipCard(ctx, id, x, y, w, h) {
    const got = this.tipsCollected.indexOf(id) >= 0;
    if (!got) {
      ctx.save();
      ctx.globalAlpha = 0.5;
      ctx.fillStyle = C.surface2; rr(ctx, x, y, w, h, R.sm); ctx.fill();
      ctx.restore();
      ctx.fillStyle = C.textSecondary; ctx.font = TF('placeholder');
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('?', x + w / 2, y + h / 2 - 10);
      // 「破阵解锁」为信息性 caption：tertiary 在 α.5 surface2 合成底上仅 3.47:1（低于 AA 4.5），升 secondary 达 5.9:1
      ctx.fillStyle = C.textSecondary; ctx.font = TF('caption');
      ctx.fillText('破阵解锁', x + w / 2, y + h / 2 + 18);
      return;
    }
    const info = tipInfo(id);
    ctx.fillStyle = C.surface1; rr(ctx, x, y, w, h, R.sm); ctx.fill();
    ctx.strokeStyle = C.accentLine; ctx.lineWidth = 1;
    rr(ctx, x + 0.5, y + 0.5, w - 1, h - 1, R.sm); ctx.stroke();
    ico(ctx, 'spark', x + 18, y + 16, 16, C.accent);
    // 标题用可读文案，不直接暴露 tip_backrank 这类数据 id
    const seq = TIP_IDS.indexOf(id) + 1;
    const name = (info && (info.name || info.title)) || ('妙招 · ' + seq);
    ctx.fillStyle = C.textPrimary; ctx.font = TF('bodyB');
    ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    ctx.fillText(name, x + 34, y + 17);
    // 摘要用 Body16 secondary（视觉终审必修），行距 20，最多 2 行给底部徽章留位
    const body = (info && (info.text || info.desc || info.summary)) || '图鉴数据载入中';
    ctx.fillStyle = C.textSecondary; ctx.font = TF('body');
    ctx.textAlign = 'left'; ctx.textBaseline = 'top';
    const lines = wrapLocal(ctx, body, w - 24).slice(0, 2);
    lines.forEach((ln, i) => ctx.fillText(ln, x + 12, y + 34 + i * 20));
    // 关联战术 Badge（V-5）：深底 + accentSoft，保证对比度
    const tactic = info && info.tactic;
    if (tactic) {
      ctx.save();
      ctx.font = TF('micro');
      const _txt = tactic;
      const bw = ctx.measureText(_txt).width + 26, bh = 18;
      const bx = x + 12, by = y + h - bh - 8;
      ctx.fillStyle = C.surface3; rr(ctx, bx, by, bw, bh, 999); ctx.fill();
      ctx.fillStyle = C.accentSoft; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
      icons.drawBullet(ctx, bx + 8, by + bh / 2, 12, 'diamond', C.accentSoft);
      ctx.fillText(_txt, bx + 16, by + bh / 2);
      ctx.restore();
    }
  }

  onTouchStart(x, y) {
    this.guard.down(x, y);
    this.pressed = this._hit(x, y);
    if (this.pressed) this.tap.press(this.pressed, Date.now());
  }

  onTouchMove(x, y) {
    const m = this.guard.move(x, y);
    if (m.moved) {
      this.scrollY = Math.max(0, Math.min(this.maxScroll, this.scrollY - m.stepY));
      if (this.pressed) this.tap.clear(this.pressed);
      this.pressed = null;
    }
  }

  onTouchEnd(x, y) {
    const e = this.guard.end(x, y);
    if (this.pressed) this.tap.clear(this.pressed);
    this.pressed = null;
    if (!e.valid) return;
    // V-5 详情态：模态期间任意有效点击均关闭，90ms 防穿透避免误触
    if (this.tipDetail) {
      if (!this.tap.guard(Date.now(), 'tipClose')) return;
      this.tipDetail = null;
      GameContext.emit('tap', { key: 'tipClose' });
      return;
    }
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
    if (key === 'back') {
      GameContext.emit('navigate', { to: 'menu' });
      GameContext.popScene();
    } else if (key === 'teaching') {
      GameContext.emit('navigate', { to: 'teaching' });
      GameContext.pushScene('teaching', { lesson: this.lessonIndex });
    } else if (key.indexOf('tip:game:') === 0) {
      // 棋种占位卡详情
      const g = GAME_DETAIL[key.slice(9)];
      this.tipDetail = g ? { title: g.name + ' · 即将开放', body: g.body }
                         : { title: '更多棋种', body: '该棋种正在开发中，敬请期待。' };
    } else if (key.indexOf('tip:') === 0) {
      // 妙招卡详情（已收集显示招法，未收集显示解锁提示）
      const id = key.slice(4);
      const got = this.tipsCollected.indexOf(id) >= 0;
      const info = tipInfo(id);
      const seq = TIP_IDS.indexOf(id) + 1;
      const name = (info && (info.name || info.title)) || ('妙招 · ' + seq);
      this.tipDetail = got
        ? { title: name, body: (info && (info.text || info.desc || info.summary)) || '图鉴数据载入中' }
        : { title: name, body: '尚未收集：在残局闯关中达成条件即可解锁此妙招，届时这里会显示完整招法。' };
    }
  }
}

module.exports = AcademyScene;
