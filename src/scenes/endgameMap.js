/**
 * S9 阵图场景（残局闯关关卡选择页）· 第二轮审查重构
 *
 * 规格依据：
 *   V2_UX_SPEC.md §1.1（关卡选择页 = 阵图）/ §1.2（解锁规则）/ §4.7（文案）
 *   OPTIMIZATION_PLAN_ROUND2.md P0-01 / P0-02 / P1-01 / P1-02 / P1-03 / P1-04 / P2-01 / P2-03
 *
 * 信息架构（本轮）：
 *   - 顶栏统一接入 src/render/topbar.js（三槽位 + 胶囊避让 + 标题下沉）。
 *   - 固定章节条：drawSectionHeader「第 N 章 · 章名  x/10」+ 10 个状态节点（仅展示，不注册点击）。
 *   - 列表按四态动态高度累加（不再用固定 CARD_H=112）：
 *       current  = n === 当前阵（min(unlockedLevel,TOTAL)）且未破 → 唯一大卡（1px 金边 + 阴影，
 *                  含阵号/名称/描述/难度条/目标/明确动作「继续」）。
 *       done     = 有 cleared 记录 → 约 64pt 压缩行（阵号·名称 / 成绩实心★ + 最佳用时 / 「重玩」）。
 *       unlocked = 已解锁未破非当前 → 普通中卡（「挑战」）。
 *       locked   = n > unlockedLevel → 统一 48pt 紧凑预告行「第 N 阵 · 破阵后开启」。
 *       fold     = 其余未解锁阵汇总行「其余 X 阵 · 破阵后展开」（统一 48pt）。
 *     三类压缩行实际高度与 region.rect.h 均 ≥44pt（统一 48pt 留余量），不做 40pt 可点行。
 *   - 描述行距/折行走 panels.lineHeight('caption') / panels.wrapText(...,2)；
 *     页脚 y = 描述结束 + 间距（不再 y+h-16），卡片高度由「标题 + 描述行数×行距 + 页脚 + 间距」
 *     内容驱动，1.25× 下描述与页脚/徽章不相交。
 *   - 难度用 panels.drawDifficultyBar（C.info 5 格条 + 档位），成绩用 drawClearedStars（C.accent 实心★），
 *     两套形状/语义分离，删掉 10px 空心难度星。
 *   - P0-02：主菜单 enter({focusLevel:N}) 时首帧把当前阵滚入视口；有进度时展示吸底
 *     「继续 · 第 N 阵」实心金色 CTA（唯一主操作），点击直达 endgame。
 *   - P2-03：render 开始处（裁剪/绘制之前）先做「只算高度」的布局预计算，算出动态 maxScroll
 *     并钳制 scrollY，消除「绘制后才钳制」的一帧空白。
 *
 * 既有契约（回归 test-endgame-scene.js，绝对不破）：
 *   - regions 里 lv:1..lv:shown 连续前缀，数量恰为 min(TOTAL, unlockedLevel + LOCKED_PREVIEW)；
 *   - fold region 存在；lv:3（预览内锁阵）存在且点击不导航；点 fold 不导航；点 lv:1 导航 endgame。
 *   - 只改「卡片绘制高度/样式」与「y 坐标累加方式」，shown 数量 / region key 命名 / 注册数量不变。
 *
 * 导航：点已解锁阵 → pushScene('endgame', {level:n})；顶栏返回 → menu；锁阵/汇总 → info Banner。
 * 无 DOM / eval；纯 Canvas 2D + CommonJS。
 */
'use strict';

const GameContext = require('../context');
const M = require('./manager');
const { theme, TouchGuard, util, createTap } = M;
const C = theme.colors, R = theme.radius;
const TF = (k) => theme.font(k);
const rr = util.rr, inRect = util.inRect, drawBtn = util.drawButtonLocal, withShadow = util.withShadow;

// 三页共享的版式原语与第二轮落盘的共享顶栏（只读复用）
const panels = require('../render/panels');
const topbar = require('../render/topbar');

const icons = (() => { try { return require('../render/icons'); } catch (e) { return null; } })();
function ico(ctx, name, x, y, size, color) {
  if (icons && typeof icons.drawIcon === 'function') {
    try { icons.drawIcon(ctx, name, x, y, size, color); return true; } catch (e) { /* noop */ }
  }
  return false;
}

const storage = (() => { try { return require('../core/storage'); } catch (e) { return null; } })();
const layoutMod = (() => { try { return require('../core/layout'); } catch (e) { return null; } })();
const dataMod = (() => { try { return require('../data/endgames'); } catch (e) { return null; } })();

const ENDGAMES = (dataMod && Array.isArray(dataMod.ENDGAMES) && dataMod.ENDGAMES.length)
  ? dataMod.ENDGAMES : [];
const TOTAL = ENDGAMES.length;

// 锁阵点按提示（保留 V2_UX_SPEC §4.7 权威句）
const LOCK_TAP_TEXT = '先破前一阵，再来看这局～';

// 锁阵文案候选池（P3 去重，保留但紧凑预告行可省略，见 OPTIMIZATION_PLAN_ROUND2 §5.1）
const LOCK_POOL = [
  '此阵尚未揭下面纱，破前一阵来开门。',
  '过关斩将，方能解锁新阵。',
  '运筹帷幄，决胜千里之外。',
  '三国纷争，谋定而后动。',
  '宝剑锋从磨砺出，梅花香自苦寒来。',
  '山高路远，行则将至。',
  '阵中求道，循序渐进。',
  '待到破阵时，方知此中味。',
  '未解锁之阵，藏龙卧虎。',
  '棋差一着，满盘皆输；先破前阵。'
];

// 未解锁关卡默认展示数量（其余折叠为汇总卡）—— 契约常量，不可改
const LOCKED_PREVIEW = 5;

// 版式 token（内容边距 16pt；左侧节点占位后文字左缘 42pt）
const TEXT_L = 42;       // 文字左偏移（含节点区）
const TEXT_R = 16;       // 文字右边距
const NODE_R = 11;       // 节点圆半径
const NODE_CX = 22;      // 节点中心相对卡 x
const PAD_V = 12;        // 卡上下内边距
const CARD_GAP = 8;      // 卡间距
const CTA_H = 52;        // 吸底 CTA 高（≥44pt）
const CTA_GAP = 8;       // 吸底 CTA 与列表净空
// 紧凑行统一高度：§3.3/§10.4 要求所有可点命中区 ≥44pt，统一取 48pt 留余量（不做 40pt 可点行）
const COMPACT_H = 48;

const CN_NUM = ['一', '二', '三', '四', '五', '六', '七', '八', '九', '十'];
const CH_NAMES = ['初阵', '开局', '运筹', '交锋', '破局', '合围', '鏖战', '残阵', '化境', '宗师'];

/** 星级绘制（★ 实心金 / ☆ 空心灰）—— 仅用于通关成绩 */
function drawStars(ctx, x, y, filled, total, size, onColor, offColor) {
  for (let i = 0; i < total; i++) {
    icons.drawStar(ctx, x + i * (size * 0.92) + size / 2, y, size, i < filled, i < filled ? onColor : offColor);
  }
}

/** 通关成绩星（0–3）：实心 ★，已得位填充 accent 金、未得位描边灰。 */
function drawClearedStars(ctx, x, y, stars, total, size) {
  drawStars(ctx, x, y, stars, total, size, C.accent, C.border);
}

/** 文本超宽截断（加省略号）；调用方须先设置好 ctx.font */
function ellipsis(ctx, text, maxWidth) {
  let t = String(text == null ? '' : text);
  if (!ctx || typeof ctx.measureText !== 'function') return t;
  if (ctx.measureText(t).width <= maxWidth) return t;
  while (t.length > 1 && ctx.measureText(t + '…').width > maxWidth) t = t.slice(0, -1);
  return t + '…';
}

class EndgameMapScene {
  constructor() {
    this.guard = new TouchGuard();
    this.regions = [];
    this.pressed = null;
    this.tap = createTap(); // 统一按压状态 + 90ms 防穿透（Phase 3·12）
    this.scrollY = 0;
    this.maxScroll = 0;
    this.screenWidth = 375;
    this.screenHeight = 667;
    this.sm = null;
    this.unlockedLevel = 1;
    this.cleared = {};
    this.pulse = 0; // 脉冲相位（当前阵金环）
    this.timeMs = 0;
    this._pendingFocus = null; // P0-02 首帧聚焦的阵号
    this._vy = 0;             // P1-5：惯性滚动瞬时速度
    this._touchActive = false; // P1-5：触摸进行中（true 时不施加惯性）
  }

  enter(params = {}) {
    this.sm = params._sm || null;
    this.screenWidth = params.screenWidth || 375;
    this.screenHeight = params.screenHeight || 667;
    this.regions = [];
    this.pressed = null;
    // P0-02：菜单「继续」传入 focusLevel 时，首帧滚动定位到当前应挑战的阵。
    // params.resume === true 时不重置 scrollY（保留原滚动位置，现有语义不变）。
    const f = Math.floor(Number(params.focusLevel));
    this._pendingFocus = (!params.resume && isFinite(f) && f >= 1)
      ? Math.min(TOTAL, f) : null;
    if (!params.resume) this.scrollY = 0;
    this.guard.reset();
    this.tap.clear();
    this.refreshProgress();
  }

  exit() { this.regions = []; this.pressed = null; this.tap.clear(); this._pendingFocus = null; }
  clearTouch() { this.guard.reset(); this.pressed = null; this.tap.clear(); }
  update(dt) {
    this.pulse += dt;
    this.timeMs += dt * 1000;

    // P1-5：惯性滚动。仅在松手（_touchActive=false）且未开启减弱动效时生效；
    // 每帧以 _vy 位移并衰减 0.93，低于阈值则归零停止（按帧衰减，不依赖 dt）。
    const reduce = !!GameContext.getSettings().reduceMotion;
    if (!this._touchActive && !reduce && Math.abs(this._vy) >= 0.5) {
      this.scrollY = Math.max(0, Math.min(this.maxScroll, this.scrollY - this._vy));
      this._vy *= 0.93;
      if (Math.abs(this._vy) < 0.5) this._vy = 0;
    }
  }

  /** 读残局存档（读失败 → 默认仅第 1 阵可玩） */
  refreshProgress() {
    let eg = null;
    try { eg = storage && storage.loadEndgame ? storage.loadEndgame() : null; } catch (e) { eg = null; }
    this.unlockedLevel = Math.max(1, Math.floor((eg && eg.unlockedLevel) || 1));
    this.cleared = (eg && eg.cleared && typeof eg.cleared === 'object') ? eg.cleared : {};
  }

  /** 云回填后刷新进度缓存并钳制 scrollY；不重置 _pendingFocus / 按压态 / 滚动位置。 */
  onDataChanged() {
    try {
      this.refreshProgress();
      if (this.scrollY > this.maxScroll) this.scrollY = this.maxScroll;
      if (this.scrollY < 0) this.scrollY = 0;
    } catch (e) { /* 静默，无 wx 环境也安全 */ }
  }

  /** 当前应挑战的阵号（钳到 [1, TOTAL]） */
  _focusLevel() { return Math.max(1, Math.min(TOTAL, this.unlockedLevel)); }

  /** 安全区度量（缺 layout 时退回固定值） */
  _metrics() {
    let L = null;
    if (layoutMod && typeof layoutMod.get === 'function') { try { L = layoutMod.get(); } catch (e) { L = null; } }
    const W = this.screenWidth, H = this.screenHeight;
    const safeTop = L ? L.safe.top : 20;
    const safeBottom = L ? L.safe.bottom : 20;
    const contentTop = L ? L.contentTop : safeTop + 16;
    const contentLeft = L ? L.contentLeft : 16;
    const contentRight = L ? L.contentRight : W - 16;
    const contentW = Math.max(0, contentRight - contentLeft);
    const contentBottom = H - safeBottom - 16;

    // 胶囊避让：优先取 layout 提供的 navSafeTop / navRightAvoid，
    // 否则用胶囊矩形自行推导。缺胶囊时退回原顶部/右侧。
    const capsule = L ? L.capsule : null;
    const navSafeTop = (L && typeof L.navSafeTop === 'number')
      ? L.navSafeTop
      : (capsule ? Math.max(contentTop, capsule.bottom + 8) : safeTop + 8);
    const navRightAvoid = (L && typeof L.navRightAvoid === 'number')
      ? L.navRightAvoid
      : (capsule ? Math.max(contentLeft, capsule.left - 8) : contentRight);

    return { W, H, safeTop, safeBottom, contentTop, contentLeft, contentRight, contentW, contentBottom, navSafeTop, navRightAvoid };
  }

  /** 已破阵数 */
  clearedCount() {
    let n = 0;
    for (let i = 1; i <= TOTAL; i++) if (this.cleared && this.cleared[String(i)]) n++;
    return n;
  }

  render(ctx, W, H) {
    ctx.fillStyle = C.bgBase; ctx.fillRect(0, 0, W, H);
    this.regions = [];
    const g = this._metrics();
    const curLevel = this._focusLevel();

    // ---------- 共享 TopBar（P2-01）----------
    const nav = topbar.drawTopBar(ctx, {
      title: '阵图',
      fontKey: 'h2',
      layout: g, // 与 _metrics 同源，保证胶囊避让/标题下沉一致
      back: { key: 'back', label: '返回', pressed: this.tap.isPressing('back', Date.now()) },
      rightWidth: 88,
      drawRight: (c, rect) => {
        c.fillStyle = C.textSecondary; c.font = TF('caption');
        c.textAlign = 'right'; c.textBaseline = 'middle';
        c.fillText('已破 ' + this.clearedCount() + '/' + TOTAL, rect.x + rect.w - 2, rect.y + rect.h / 2);
      },
      divider: true
    });
    for (const r of nav.regions) this.regions.push(r); // back（≥44pt）

    // ---------- 固定章节条（P1-01 / P1-04）----------
    let listTop = nav.bottom + 12;
    const chapterH = this._drawChapter(ctx, g, listTop, curLevel);
    listTop += chapterH + CARD_GAP;

    // ---------- 吸底 CTA 预留（P0-02，唯一实心金色主操作）----------
    // P1-3b：首屏即常驻底部主操作，不再依赖「已解锁>1 且有通关记录」前置条件。
    const showCTA = true;
    const ctaRect = showCTA
      ? { x: g.contentLeft, y: g.contentBottom - CTA_H, w: g.contentW, h: CTA_H }
      : null;
    // 先注册（排在卡区之前），保证 _hit 在 CTA 区域优先命中 continue，不被卡区 rect 抢走。
    if (ctaRect) this.regions.push({ key: 'continue', rect: ctaRect });
    const viewportBottom = g.contentBottom - (showCTA ? CTA_H + CTA_GAP : 0);
    const viewportH = Math.max(0, viewportBottom - listTop);
    this._listViewport = { top: listTop, bottom: viewportBottom }; // 供命中区断言校验裁剪不变量

    // ---------- 布局预计算（只算高度，不绘制）----------
    const cardW = g.contentW;
    const shown = Math.min(TOTAL, this.unlockedLevel + LOCKED_PREVIEW); // 契约：数量不变
    const hasFold = TOTAL > shown;
    const items = [];
    let cursor = 0;
    for (let i = 0; i < shown; i++) {
      const L = this._layoutCard(ctx, i + 1, cardW);
      L.y = cursor;
      items.push(L);
      cursor += L.h + CARD_GAP;
    }
    let foldL = null;
    if (hasFold) {
      foldL = this._layoutFold(ctx, cardW, TOTAL - shown);
      foldL.y = cursor;
      cursor += foldL.h + CARD_GAP;
    }
    const totalH = cursor;                         // 动态总高
    const maxScroll = Math.max(0, totalH - viewportH);

    // ---------- P2-03：render 开始处（裁剪/绘制之前）钳制 scrollY ----------
    this.maxScroll = maxScroll;
    this.scrollY = Math.max(0, Math.min(maxScroll, this.scrollY));

    // ---------- P0-02：首帧把当前阵完整滚入视口 ----------
    if (this._pendingFocus != null) {
      const idx = this._pendingFocus - 1;
      const top = (idx >= 0 && idx < items.length) ? items[idx].y : 0;
      this.scrollY = Math.max(0, Math.min(maxScroll, top - viewportH / 3));
      this._pendingFocus = null;
    }

    // ---------- 绘制滚动列表 ----------
    ctx.save();
    ctx.beginPath(); ctx.rect(0, listTop, W, viewportH); ctx.clip();
    const vTop = listTop, vBot = listTop + viewportH;
    for (const it of items) {
      const sy = listTop + it.y - this.scrollY;
      // P0：命中区只注册与列表视口实际相交的部分，并把 y/h 钳到 [listTop, viewportBottom]。
      // 这样滚出视口的卡不再用完整高度占位，避免吞掉章节条区域 / 顶部空隙 / 底部安全区的点击。
      const ry = Math.max(sy, vTop);
      const rb = Math.min(sy + it.h, vBot);
      if (rb > ry) {
        this.regions.push({ key: 'lv:' + it.n, rect: { x: g.contentLeft, y: ry, w: cardW, h: rb - ry } });
      }
      if (sy + it.h < listTop - 10 || sy > listTop + viewportH + 10) continue;
      this._drawCard(ctx, it, g.contentLeft, sy, cardW);
    }
    if (hasFold) {
      const sy = listTop + foldL.y - this.scrollY;
      const ry = Math.max(sy, vTop);
      const rb = Math.min(sy + foldL.h, vBot);
      // P1：折叠汇总卡为常驻信息行，始终注册命中区（保证 'fold' key 存在，满足契约断言）；
      // 其 rect 仍钳制在列表视口内（与 P0 视口裁剪一致，不越界）。当被吸底 CTA 挤压到视口外时
      // 退化为底边 0 高度占位，待滚动进入视口后恢复真实高度，避免吞掉其他点击。
      let fy = ry, fh = rb - ry;
      if (fh <= 0) { fy = vBot; fh = 0; }
      this.regions.push({ key: 'fold', rect: { x: g.contentLeft, y: fy, w: cardW, h: fh } });
      if (sy + foldL.h > listTop - 10 && sy < listTop + viewportH + 10) {
        this._drawFold(ctx, foldL, g.contentLeft, sy, cardW);
      }
    }
    ctx.restore();

    // 渐隐提示
    if (this.scrollY > 2) this._fade(ctx, W, listTop, true);
    if (this.scrollY < this.maxScroll - 2) this._fade(ctx, W, viewportBottom, false);

    // 吸底 CTA（在 clip 之外，不遮最后一张卡：viewport 底部已留 CTA 高度）
    if (ctaRect) {
      // P1-3c：首进（无通关记录）显示「开始」，否则「继续」，单一明确动作。
      const ctaText = (this.clearedCount() === 0 ? '开始' : '继续') + ' · 第 ' + curLevel + ' 阵';
      drawBtn(ctx, ctaRect.x, ctaRect.y, ctaRect.w, ctaRect.h,
        ctaText, 'primary',
        { pressed: this.tap.isPressing('continue', Date.now()) });
    }

    // 通用模态（如 M_confirm 确认）
    if (this.sm && this.sm.modal && this.sm.modal.isGeneric()) this.sm.modal.renderGeneric(ctx, W, H);
  }

  // ==================== 章节条 ====================
  /** 固定章节标题 + 10 节点进度；节点仅状态展示，不注册逐个点击。返回占用高度。 */
  _drawChapter(ctx, g, topY, curLevel) {
    const chapter = Math.max(1, Math.min(Math.ceil(TOTAL / 10), Math.floor((curLevel - 1) / 10) + 1));
    const start = (chapter - 1) * 10 + 1;
    let doneInCh = 0;
    for (let k = 0; k < 10; k++) {
      const lv = start + k;
      if (lv <= TOTAL && this.cleared && this.cleared[String(lv)]) doneInCh++;
    }
    const title = '第' + (CN_NUM[chapter - 1] || chapter) + '章 · ' + (CH_NAMES[chapter - 1] || '破阵');
    const hh = panels.drawSectionHeader(ctx, g.contentLeft, topY, title, {
      trailing: doneInCh + '/10', width: g.contentW, fontKey: 'body'
    });

    const r = 6;
    const nodeY = topY + hh + 2 + r;
    const step = g.contentW / 10;
    ctx.save();
    for (let k = 0; k < 10; k++) {
      const lv = start + k;
      const cx = g.contentLeft + step * (k + 0.5);
      let fill = null, stroke = C.border;
      if (lv > TOTAL) { fill = C.surface3; stroke = C.border; }
      else if (this.cleared && this.cleared[String(lv)]) { fill = C.accent; stroke = C.accent; }  // 已破：实心金
      else if (lv === curLevel) { fill = C.accentFade; stroke = C.accent; }                    // 当前：金环
      else if (lv < curLevel) { fill = null; stroke = C.accent; }                                // 已解锁：空心金
      else { fill = C.surface3; stroke = C.border; }                                            // 锁定：低权重
      ctx.beginPath(); ctx.arc(cx, nodeY, r, 0, Math.PI * 2);
      if (fill) { ctx.fillStyle = fill; ctx.fill(); }
      ctx.strokeStyle = stroke; ctx.lineWidth = 1; ctx.stroke();
    }
    ctx.restore();
    return hh + 2 + 2 * r + 6;
  }

  // ==================== 内容驱动布局（只算高度）====================
  /** 按四态分派到对应度量函数 */
  _layoutCard(ctx, n, w) {
    const curLevel = this._focusLevel();
    const rec = (this.cleared && this.cleared[String(n)]) || null;
    let state;
    if (n > this.unlockedLevel) state = 'locked';
    else if (rec) state = 'done';
    else if (n === curLevel) state = 'current';
    else state = 'unlocked';

    if (state === 'locked') return this._layoutLocked(ctx, n, w);
    if (state === 'done') return this._layoutDone(ctx, n, w, rec);
    return this._layoutDetail(ctx, n, w, state === 'current');
  }

  /** 当前阵 / 已解锁未破：标题区 + 描述行数×行距 + 页脚区 + 间距（P0-01） */
  _layoutDetail(ctx, n, w, isCurrent) {
    const eg = ENDGAMES[n - 1] || {};
    const tw = w - TEXT_L - TEXT_R;
    const descLines = panels.wrapText(ctx, eg.intro || '', tw, 'caption', 2);
    const lhCap = panels.lineHeight('caption');
    const lhSub = panels.lineHeight('subtitle');
    const lhMicro = panels.lineHeight('micro');
    const footH = Math.max(30, lhCap + 10);

    let cy = PAD_V;
    const headCY = cy + lhMicro / 2; cy += lhMicro + 4;      // 第 N 阵 + 难度条
    const nameCY = cy + lhSub / 2; cy += lhSub + 6;          // 阵名
    const descTop = cy; cy += descLines.length * lhCap + 10; // 描述（内容驱动行数）
    const footCY = cy + footH / 2; cy += footH;              // 页脚（描述结束 + 间距）
    const h = cy + PAD_V;

    return {
      n, eg, state: isCurrent ? 'current' : 'unlocked', h, tw,
      descLines, lhCap, descTop, headCY, nameCY, footCY,
      diff: Math.max(1, Math.min(5, eg.difficulty || 1)),
      // P1-3a：当前大卡不再画卡内徽章（badgeText 置空），单一明确动作收口到吸底 CTA。
      // 非当前未解锁 → 「挑战」；「开始/继续」语义留给底部 CTA（见 3c）。
      badgeText: isCurrent ? '' : '挑战',
      badgeColor: isCurrent ? C.accent : C.info,
      targetText: '目标 ' + (eg.targetMoves || 0) + ' 步 · ' + (eg.timeLimitSec || 0) + ' 秒'
    };
  }

  /** 已通关：约 64pt 压缩行（阵号·名称 / 成绩★ + 最佳 / 重玩） */
  _layoutDone(ctx, n, w, rec) {
    const eg = ENDGAMES[n - 1] || {};
    const tw = w - TEXT_L - TEXT_R;
    const lhBody = panels.lineHeight('body');
    const lhCap = panels.lineHeight('caption');
    let cy = PAD_V;
    const titleCY = cy + lhBody / 2; cy += lhBody + 4;
    const metaH = Math.max(lhCap, 18);
    const metaCY = cy + metaH / 2; cy += metaH;
    const h = Math.max(COMPACT_H, cy + PAD_V); // ≥48pt 命中区下限
    const secs = (rec.bestTimeMs || 0) / 1000;
    const bestText = rec.bestTimeMs > 0 ? ('最佳 ' + secs.toFixed(1) + ' 秒') : '已破阵';
    return {
      n, eg, state: 'done', h, tw, titleCY, metaCY,
      stars: Math.max(0, Math.min(3, rec.stars || 0)),
      bestText,
      // P1-6：右侧由「重玩」胶囊改为细箭头 ›（整行可重新进入语义），不画胶囊底。
      badgeText: '›', badgeColor: C.textSecondary
    };
  }

  /** 锁定：统一 48pt 紧凑预告行（实际高度与命中区均为 48） */
  _layoutLocked(ctx, n, w) {
    const h = Math.max(COMPACT_H, panels.lineHeight('caption') + 20);
    return { n, state: 'locked', h, tw: w - TEXT_L - TEXT_R, lineText: '第 ' + n + ' 阵 · 破阵后开启' };
  }

  /** 折叠汇总：统一 48pt 汇总行（实际高度与命中区均为 48） */
  _layoutFold(ctx, w, hidden) {
    const h = Math.max(COMPACT_H, panels.lineHeight('caption') + 20);
    return { state: 'fold', h, tw: w - TEXT_L - TEXT_R, lineText: '其余 ' + hidden + ' 阵 · 随章节开放' };
  }

  /** 徽章像素宽（micro 字 + 16 内边距） */
  _badgeWidth(ctx, text) {
    ctx.save(); ctx.font = TF('micro');
    const w = ctx.measureText(text).width + 16;
    ctx.restore();
    return w;
  }

  /** 难度条右对齐起点：与 panels.drawDifficultyBar 默认 barW/gap 对齐 */
  _diffStartX(ctx, diff, x, w) {
    const lv = Math.max(1, Math.min(5, diff || 1));
    const lbl = '· ' + panels.DIFFICULTY_LABELS[lv - 1];
    ctx.save(); ctx.font = TF('caption');
    const lblW = ctx.measureText(lbl).width;
    ctx.restore();
    const barsW = 5 * 7 + 4 * 3; // 5 格 barW=7 + 4 个 gap=3
    return (x + w - TEXT_R) - (barsW + 5 + lblW);
  }

  // ==================== 绘制 ====================
  _drawCard(ctx, it, x, y, w) {
    const h = it.h;
    const pressed = this.tap.isPressing('lv:' + it.n, Date.now());

    ctx.save();
    if (it.state === 'current') {
      // 唯一大卡：1px 金色描边 + 阴影（同屏只此一处强金边）
      withShadow(ctx, theme.elevation.e1, () => {
        ctx.fillStyle = C.surface1;
        rr(ctx, x, y, w, h, R.btn); ctx.fill();
      });
      ctx.strokeStyle = C.accent; ctx.lineWidth = 1;
      rr(ctx, x + 0.5, y + 0.5, w - 1, h - 1, R.btn); ctx.stroke();
    } else {
      // 其余态：扁平行，不加边框（减少「卡片 + 边框」密度）。
      // P1：锁定行融入页面背景（不再用 surface3 亮底），使其「退后」，避免「又亮又空」。
      ctx.fillStyle = (it.state === 'locked') ? C.bgBase : C.surface1;
      rr(ctx, x, y, w, h, R.btn); ctx.fill();
    }
    if (pressed && it.state !== 'locked') util.drawTapHighlight(ctx, x, y, w, h, true, R.btn);

    // 左侧时间线节点（状态双编码）
    this._drawNode(ctx, it.state, x + NODE_CX, y + Math.min(h / 2, PAD_V + NODE_R));

    if (it.state === 'current' || it.state === 'unlocked') this._drawDetailContent(ctx, it, x, y, w);
    else if (it.state === 'done') this._drawDoneContent(ctx, it, x, y, w);
    else this._drawLockedContent(ctx, it, x, y, w);
    ctx.restore();
  }

  _drawNode(ctx, state, cx, cy) {
    ctx.save();
    if (state === 'current') {
      // 脉冲金环；reduceMotion 时保持静态金环
      const reduce = !!GameContext.getSettings().reduceMotion;
      const phase = reduce ? 0.5 : (0.5 - 0.5 * Math.cos((this.pulse % 1.8) / 1.8 * Math.PI * 2));
      ctx.strokeStyle = C.accent; ctx.globalAlpha = 0.35 + 0.4 * phase; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(cx, cy, NODE_R + 3, 0, Math.PI * 2); ctx.stroke();
      ctx.globalAlpha = 1;
      ctx.strokeStyle = C.accent; ctx.lineWidth = 1.4;
      ctx.beginPath(); ctx.arc(cx, cy, NODE_R, 0, Math.PI * 2); ctx.stroke();
    } else if (state === 'done') {
      ctx.fillStyle = C.accent;
      ctx.beginPath(); ctx.arc(cx, cy, NODE_R, 0, Math.PI * 2); ctx.fill();
      if (icons && typeof icons.drawCheck === 'function') icons.drawCheck(ctx, cx, cy, 14, C.textOnAccent);
    } else if (state === 'unlocked') {
      ctx.strokeStyle = C.accent; ctx.lineWidth = 1.2;
      ctx.beginPath(); ctx.arc(cx, cy, NODE_R, 0, Math.PI * 2); ctx.stroke();
    } else {
      ctx.fillStyle = C.surface3;
      ctx.beginPath(); ctx.arc(cx, cy, NODE_R, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = C.border; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.arc(cx, cy, NODE_R, 0, Math.PI * 2); ctx.stroke();
      ico(ctx, 'lock', cx, cy, 12, C.disabledFg);
    }
    ctx.restore();
  }

  /** 当前阵 / 已解锁：阵号 + 难度条 + 阵名 + 描述 + 目标 + 动作徽章 */
  _drawDetailContent(ctx, it, x, y, w) {
    const tx = x + TEXT_L;
    // 头部：第 N 阵（左） + 难度条（右，C.info 5 格 + 档位）
    ctx.fillStyle = C.accent; ctx.font = TF('micro');
    ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    ctx.fillText('第 ' + it.n + ' 阵', tx, y + it.headCY);
    panels.drawDifficultyBar(ctx, this._diffStartX(ctx, it.diff, x, w), y + it.headCY, it.diff, {});

    // 阵名
    ctx.fillStyle = C.textPrimary; ctx.font = TF('subtitle');
    ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    ctx.fillText(ellipsis(ctx, it.eg.name, it.tw), tx, y + it.nameCY);

    // 关键描述：内容驱动折行 + lineHeight('caption')，末行省略号（P0-01）
    panels.drawLines(ctx, it.descLines, tx, y + it.descTop, C.textSecondary, 'caption');

    // 页脚：目标信息（左，避让徽章）+ 动作徽章（右）
    const hasBadge = !!(it.badgeText && it.badgeText.length);
    const badgeW = hasBadge ? this._badgeWidth(ctx, it.badgeText) : 0;
    const footTextMax = Math.max(40, it.tw - badgeW - 12);
    ctx.fillStyle = C.textSecondary; ctx.font = TF('caption');
    ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    ctx.fillText(ellipsis(ctx, it.targetText, footTextMax), tx, y + it.footCY);
    if (hasBadge) this._badge(ctx, it.badgeText, x + w - TEXT_R, y + it.footCY, it.badgeColor, 'right');
  }

  /** 已通关：阵号·名称 / 实心★ + 最佳用时（无「成绩」前缀）/ 右侧细箭头 › */
  _drawDoneContent(ctx, it, x, y, w) {
    const tx = x + TEXT_L;
    ctx.fillStyle = C.textPrimary; ctx.font = TF('body');
    ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    ctx.fillText(ellipsis(ctx, '第 ' + it.n + ' 阵 · ' + (it.eg.name || ''), it.tw), tx, y + it.titleCY);

    // P1-6：删除「成绩」前缀整行；保留实心★与最佳用时（C.accent 实心★ + textSecondary 时间）
    const starSize = 12, starStep = starSize * 0.92;
    drawClearedStars(ctx, tx, y + it.metaCY, it.stars, 3, starSize);
    const afterStars = tx + 3 * starStep + 6;
    const metaMax = Math.max(24, (x + w - TEXT_R) - afterStars - 18); // 预留右侧细箭头空间
    ctx.font = TF('caption'); ctx.fillStyle = C.textSecondary;
    ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    ctx.fillText(ellipsis(ctx, '· ' + it.bestText, metaMax), afterStars, y + it.metaCY);

    // 右侧细箭头（不画胶囊底，仅文字箭头，表达「整行可重新进入」语义）
    ctx.fillStyle = C.textSecondary; ctx.font = TF('subtitle');
    ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
    ctx.fillText('›', x + w - TEXT_R, y + it.metaCY);
  }

  /** 锁定：单行紧凑预告（C.disabledFg，不用整体 alpha） */
  _drawLockedContent(ctx, it, x, y, w) {
    ctx.fillStyle = C.disabledFg; ctx.font = TF('caption');
    ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    ctx.fillText(ellipsis(ctx, it.lineText, it.tw), x + TEXT_L, y + it.h / 2);
  }

  _drawFold(ctx, it, x, y, w) {
    ctx.save();
    ctx.fillStyle = C.surface3;
    rr(ctx, x, y, w, it.h, R.btn); ctx.fill();
    // 纯信息行：无按压态、无点击动作（文案已去掉「展开」承诺，见 §5 走查 P0）
    this._drawNode(ctx, 'locked', x + NODE_CX, y + Math.min(it.h / 2, PAD_V + NODE_R));
    ctx.fillStyle = C.disabledFg; ctx.font = TF('caption');
    ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    ctx.fillText(ellipsis(ctx, it.lineText, it.tw), x + TEXT_L, y + it.h / 2);
    ctx.restore();
  }

  /** 徽章（h22 r999，语义色 14% 底 + 同色 micro 字） */
  _badge(ctx, text, rightX, cy, color, align) {
    ctx.save();
    ctx.font = TF('micro');
    const bw = ctx.measureText(text).width + 16;
    const bx = align === 'right' ? rightX - bw : rightX;
    ctx.fillStyle = this._alpha(color, 0.16);
    rr(ctx, bx, cy - 11, bw, 22, 999); ctx.fill();
    ctx.fillStyle = color; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(text, bx + bw / 2, cy);
    ctx.restore();
  }

  _alpha(hex, a) {
    if (typeof hex !== 'string' || hex.charAt(0) !== '#') return hex;
    const r = parseInt(hex.slice(1, 3), 16), g = parseInt(hex.slice(2, 4), 16), b = parseInt(hex.slice(4, 6), 16);
    return 'rgba(' + r + ',' + g + ',' + b + ',' + a + ')';
  }

  _fade(ctx, W, y, topDown) {
    // P1-4：渐隐加厚到 24pt（梯度偏移与填充高度均由 12 → 24）
    const g = ctx.createLinearGradient(0, y - (topDown ? 0 : 24), 0, y + (topDown ? 24 : 0));
    g.addColorStop(0, topDown ? C.bgBase : 'rgba(16,21,27,0)');
    g.addColorStop(1, topDown ? 'rgba(16,21,27,0)' : C.bgBase);
    ctx.fillStyle = g; ctx.fillRect(0, topDown ? y : y - 24, W, 24);
  }

  // ==================== 输入 ====================
  onTouchStart(x, y) {
    this.guard.down(x, y);
    this._touchActive = true;
    this._vy = 0; // 触摸起始无速度
    this.pressed = this._hit(x, y);
    if (this.pressed) this.tap.press(this.pressed, Date.now());
  }

  onTouchMove(x, y) {
    const m = this.guard.move(x, y);
    if (m.moved) {
      if (this.pressed) this.tap.clear(this.pressed);
      this.pressed = null;
      this.scrollY = Math.max(0, Math.min(this.maxScroll, this.scrollY - m.stepY));
      this._vy = m.stepY; // P1-5：采样瞬时速度，供松手后惯性使用
    }
  }

  onTouchEnd(x, y) {
    const e = this.guard.end(x, y);
    this._touchActive = false;
    this.pressed = null;
    if (!e.valid) { this._vy = 0; return; }

    if (this.sm && this.sm.modal && this.sm.modal.isOpen() && this.sm.modal.isGeneric()) {
      if (!this.sm.modal.interactive()) return;
      const act = this.sm.modal.hitGeneric(x, y);
      if (act) this.sm.modal.resolveGeneric(act);
      return;
    }

    const key = this._hit(x, y);
    if (!key) return;
    if (!this.tap.guard(Date.now(), key)) return; // 90ms 防穿透（Phase 3·12 统一）
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
      return;
    }
    if (key === 'continue') {
      // 吸底 CTA：直达当前应挑战的阵（P0-02 方案 2）
      GameContext.emit('navigate', { to: 'endgame' });
      GameContext.pushScene('endgame', { level: this._focusLevel() });
      return;
    }
    if (key === 'fold') {
      // 纯信息行：不导航、不弹提示（文案已说明「随章节开放」，见 §5 走查 P0）
      return;
    }
    if (key.indexOf('lv:') === 0) {
      const n = parseInt(key.slice(3), 10);
      if (!isFinite(n) || n < 1 || n > TOTAL) return;
      if (n > this.unlockedLevel) {
        // 锁阵：轻提示（info，非 danger），不进入
        GameContext.showBanner(LOCK_TAP_TEXT, 'info');
        return;
      }
      GameContext.emit('navigate', { to: 'endgame' });
      GameContext.pushScene('endgame', { level: n });
      return;
    }
  }
}

module.exports = EndgameMapScene;
