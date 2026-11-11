/**
 * S1 主菜单场景（V2_UX_SPEC §3.1 / V2_VISUAL_SPEC §7.8 V-8）
 * - 安全区布局：core/layout.js（contentTop/contentBottom 避开灵动岛/home indicator）
 * - 唯一 Primary：动态标签 —— 有进度时「继续 · 第 N 阵」（N=最大已破+1=unlockedLevel，钳到 TOTAL），无进度时「残局闯关」；+「NEW」徽章（已破 0/TOTAL 时显示）+「已破 N/TOTAL」进度
 *   N = storage.loadEndgame().unlockedLevel（未破时=1，已破 k 阵时为 k+1）；TOTAL = ENDGAMES.length（残局总数）
 * - Secondary：人机对战（→ setup，skipSetup 直连）/ 双人对弈（→ versus 对局方式页：默认本地双人，次级入口「邀请好友加入」→ room）
 * - 次级行（图标+文字 44×52 热区）：锦囊阁(→academy) / 棋谱(→records) / 设置(→settings)；音效开关已并入「设置」页（SETTING_DEFS 首项）
 * - 基础教学降级进锦囊阁 hub（S8 academy），不再一级并列（C-5）
 * - 主视觉取代启动页：黄铜径向光晕 + 矢量棋子残局剪影构图（低透明度，drawPiece 离屏绘制），弱化纯标题启动页感；去 emoji，图标一律 drawIcon（必带文字标签，C6）
 * - 输入（UX §2.5）：onTouchEnd 同目标确认，位移≤12pt、时长≤500ms、250ms 去重。
 */
const GameContext = require('../context');
const M = require('./manager');
const { theme, TouchGuard, util, createTap } = M;
const C = theme.colors, R = theme.radius;
const TF = (k) => theme.font(k);
const rr = util.rr, inRect = util.inRect, drawBtn = util.drawButtonLocal;
const layout = require('../core/layout');
const storage = require('../core/storage');
const { ENDGAMES } = require('../data/endgames');

// 安全图标：缺失时静默，图标必配文字标签（C6）
const icons = (() => { try { return require('../render/icons'); } catch (e) { return null; } })();
const piecesRender = require('../render/pieces');
function ico(ctx, name, x, y, size, color) {
  if (icons && typeof icons.drawIcon === 'function') {
    try { icons.drawIcon(ctx, name, x, y, size, color); return true; } catch (e) { /* noop */ }
  }
  return false;
}

class MenuScene {
  constructor() {
    this.guard = new TouchGuard();
    this.regions = [];
    this.pressed = null;
    this.tap = createTap(); // 统一按压状态 + 90ms 防穿透（Phase 3·12）
    this.screenWidth = 375;
    this.screenHeight = 667;
    this.cleared = 0; // 已破阵数 0..TOTAL
    this.sm = null;
  }

  enter(params = {}) {
    this.sm = params._sm || null;
    this.screenWidth = params.screenWidth || 375;
    this.screenHeight = params.screenHeight || 667;
    this.regions = [];
    this.pressed = null;
    this.guard.reset();
    this.tap.clear();
    // 已破阵数 = unlockedLevel - 1（V2_UX_SPEC §3.1 进度口径），读档失败按 0 显示
    this._refreshProgress();
    // P1-I3：返回菜单时主动询问断点恢复（M7），覆盖「正常返回菜单」等 onShow 之外的进入路径
    if (GameContext.tryOfferResume) { try { GameContext.tryOfferResume(); } catch (e) {} }
  }

  /** 从残局存档重算进度缓存字段（enter / 云回填 onDataChanged 共用）。 */
  _refreshProgress() {
    let cleared = 0;
    try {
      const eg = storage.loadEndgame();
      cleared = Math.max(0, Math.min((ENDGAMES && ENDGAMES.length) || 100, (eg && eg.unlockedLevel ? eg.unlockedLevel : 1) - 1));
    } catch (e) { cleared = 0; }
    this.cleared = cleared;
    // 「继续 · 第 N 阵」语义：N = 最大已破+1 = unlockedLevel（钳到 TOTAL）；仅当确有进度且未全破时显示
    this.total = (ENDGAMES && ENDGAMES.length) || 100;
    this.nextLevel = Math.min(cleared + 1, this.total);
    this.hasProgress = cleared > 0 && this.nextLevel <= this.total;
  }

  /** 云回填后刷新进度缓存；只重算进度字段，不重置按压态 / 不重新 tryOfferResume。 */
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
    const contentTop = L.contentTop;
    const contentBottom = Math.min(L.contentBottom, H - 12);

    // 平板/宽屏：内容列收敛 + 整块垂直居中（仅视觉几何，命中区 key/语义与导航不变）
    const isTablet = !!(L && (L.isTablet || L.isLandscape));
    const colW = isTablet ? Math.min(L.contentW, 560) : W;
    const colX = isTablet ? Math.floor((W - colW) / 2) : 0;

    // ---- 按钮组几何（先算，供标题组上锚定避让）----
    const btnW = isTablet ? Math.min(colW, 480) : Math.min(W - 32, 343);
    const btnX = isTablet ? Math.floor((W - btnW) / 2) : (W - btnW) / 2;
    const priH = 56, secH = 56, gap = 14, rowH = 52, rowGap = 24;
    let rowY, sec2Y, sec1Y, priY;
    let titleY, ruleY, subtitleY, heroCy, heroR;
    let showDecor = true;   // 装饰性标题/插画：极矮横屏空间不足时让位，避免被推出屏幕
    if (isTablet) {
      // 平板：整块垂直居中于内容区，消除上下留白失衡；标题/按钮相对间距固定，不重叠
      const availH = contentBottom - contentTop;
      const UI_H = Math.min(620, availH);
      const blockTop = contentTop + Math.max(0, Math.round((availH - UI_H) / 2));
      rowY  = blockTop + UI_H - rowH;
      sec2Y = rowY - rowGap - secH;
      sec1Y = sec2Y - (gap - 2) - secH;
      priY  = sec1Y - gap - priH;
      // 标题区 108pt + 按钮/tab 块 270pt + 插画至少 60pt 才放得下完整装饰
      const btnBlockH = priH + gap + secH + (gap - 2) + secH + rowGap + rowH;
      if (UI_H >= 108 + btnBlockH + 60) {
        titleY = blockTop + 44; ruleY = titleY + 46; subtitleY = titleY + 64;
        heroCy = (subtitleY + priY) / 2;
        // 插画严格收敛在「副标题 ↔ 主按钮」可用带内（上下各留 10pt），避免宽屏放大后被按钮切断
        heroR  = Math.max(40, Math.min((priY - subtitleY) / 2 - 10, 200));
      } else {
        // 内容区过矮（如手机横屏 812×375）：装饰元素让位，按钮组在可用区垂直居中，
        // 保证所有交互元素完整可见、互不重叠、不越 contentBottom。
        showDecor = false;
        const btnTop = contentTop + Math.max(0, Math.round((availH - btnBlockH) / 2));
        priY  = btnTop;
        sec1Y = priY + priH + gap;
        sec2Y = sec1Y + secH + (gap - 2);
        rowY  = sec2Y + secH + rowGap;
      }
    } else {
      // 非平板：原下锚定 + 上锚定逻辑逐字保留，坐标逐像素不变
      rowY = contentBottom - 8 - rowH;
      sec2Y = rowY - rowGap - secH;
      sec1Y = sec2Y - (gap - 2) - secH;
      priY = sec1Y - gap - priH;

      // ---- 标题组（contentTop 上锚定）----
      // 矮屏/紧凑屏时按钮组下锚定会压缩标题带。常规态沿用 contentTop+132/178/196；
      // 空间不足时改为自 priY 反向排布并预留 20pt 净空，
      // 保证副标题/分隔线绝不与唯一 Primary（黄铜按钮）重叠（视觉终审必修 #1）。
      const titleBand = priY - contentTop;
      if (titleBand >= 232) {
        titleY = contentTop + 132;
        ruleY = contentTop + 178;
        subtitleY = contentTop + 196;
      } else {
        subtitleY = priY - 20;
        ruleY = subtitleY - 18;
        titleY = Math.max(contentTop + 28, ruleY - 46);
      }
      // ---- 主视觉（取代单一水印）：黄铜径向光晕 + 矢量棋子残局剪影构图，作为背景主视觉 ----
      if (titleBand >= 232) {
        // 常规屏：置于副标题与主按钮之间的留白带
        heroCy = (subtitleY + priY) / 2;
        heroR = Math.min((priY - subtitleY) / 2 + 46, 150);
      } else {
        // 紧凑屏：置于标题区与按钮之间的上半区，作为背景主视觉（标题/按钮绘制于其上）
        heroCy = contentTop + (priY - contentTop) * 0.42;
        heroR = Math.max(56, (priY - contentTop) * 0.46);
      }
    }
    // 装饰层：正常视口全绘；极矮横屏（showDecor=false）让位给按钮组，避免标题被推出屏幕
    if (showDecor) {
      this._heroVisual(ctx, W, W / 2, heroCy, heroR);
      ctx.fillStyle = C.textPrimary; ctx.font = TF('display');
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('国际象棋', W / 2, titleY);
      ctx.strokeStyle = C.accent; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(W / 2 - 20, ruleY); ctx.lineTo(W / 2 + 20, ruleY); ctx.stroke();
      ctx.fillStyle = C.textSecondary; ctx.font = TF('micro');
      ctx.fillText('C H E S S   A T E L I E R', W / 2, subtitleY);
    }

    // 残局闯关（唯一 Primary，黄铜填充）：图标 + 标题 + [NEW] 徽章 + 「已破 N/TOTAL」+ ›
    this._endgameBtn(ctx, btnX, priY, btnW, priH);
    // 人机对战（Secondary）
    this._mainBtn(ctx, btnX, sec1Y, btnW, secH, 'ai', '人机对战', 'ai');
    // 双人对弈（Secondary，单入口）：进入后在对局方式页选择本地双人 / 邀请好友加入
    this._mainBtn(ctx, btnX, sec2Y, btnW, secH, 'versus', '双人对弈', 'twoPlayers');

    // ---- 次级行：锦囊阁 / 棋谱 / 设置（图标必带标签，C6）----
    // 音效开关已并入「设置」页（SETTING_DEFS 首项），首屏不再单列，层级更清晰。
    const tabSpan = isTablet ? colW : W;
    const tabX0   = isTablet ? colX : 0;
    const slotW   = tabSpan / 3;
    this._rowBtn(ctx, tabX0 + slotW * 0.5, rowY + rowH / 2, 'academy', '锦囊阁', 'academy');
    this._rowBtn(ctx, tabX0 + slotW * 1.5, rowY + rowH / 2, 'records', '棋谱', 'records');
    this._rowBtn(ctx, tabX0 + slotW * 2.5, rowY + rowH / 2, 'personalCenter', '个人中心', 'user');
    // 版本号已移至「设置」页底部（settings.js），首屏不再展示，避免信息过载。

    // ---- 通用模态（P2 断点恢复 M7 等，最上层绘制）----
    if (this.sm && this.sm.modal && this.sm.modal.isGeneric()) this.sm.modal.renderGeneric(ctx, W, H);
  }

  /** 主视觉：黄铜径向光晕 + 矢量棋子残局剪影构图（低透明度，作为背景主视觉，弱化纯标题启动页感） */
  _heroVisual(ctx, W, cx, cy, radius) {
    // 黄铜径向光晕（中心暖金 → 透明），建立真正的游戏主视觉氛围
    ctx.save();
    const g = ctx.createRadialGradient(cx, cy, radius * 0.08, cx, cy, radius);
    g.addColorStop(0, 'rgba(201,162,75,0.18)');
    g.addColorStop(0.45, 'rgba(201,162,75,0.07)');
    g.addColorStop(1, 'rgba(201,162,75,0)');
    ctx.fillStyle = g;
    ctx.fillRect(cx - radius, cy - radius, radius * 2, radius * 2);
    ctx.restore();
    // 残局剪影：中央焦点「后(白)」+ 左黑王 + 右白马 + 左下黑兵 + 右上白象，低透明度叠出层次
    const big = radius * 0.92;
    piecesRender.drawPiece(ctx, 'q', 'w', cx, cy, big, { alpha: 0.20 });
    piecesRender.drawPiece(ctx, 'k', 'b', cx - big * 0.60, cy + big * 0.16, big * 0.50, { alpha: 0.15 });
    piecesRender.drawPiece(ctx, 'n', 'w', cx + big * 0.64, cy + big * 0.14, big * 0.46, { alpha: 0.14 });
    piecesRender.drawPiece(ctx, 'p', 'b', cx + big * 0.30, cy + big * 0.34, big * 0.34, { alpha: 0.11 });
    piecesRender.drawPiece(ctx, 'b', 'w', cx - big * 0.34, cy + big * 0.30, big * 0.30, { alpha: 0.11 });
  }

  /** 残局闯关 Primary：黄铜填充 + 左 map 图标 + 右 [NEW] 徽章 + 「已破 N/TOTAL」进度 */
  _endgameBtn(ctx, x, y, w, h) {
    drawBtn(ctx, x, y, w, h, '', 'primary', { pressed: this.tap.isPressing('endgame', Date.now()) });
    ico(ctx, 'map', x + 40, y + h / 2, 26, C.textOnAccent);
    ctx.fillStyle = C.textOnAccent; ctx.font = TF('button');
    ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    // 有进度时改为「继续 · 第 N 阵」（N=最大已破+1，带回流）；无进度时仍「残局闯关」
    const priLabel = this.hasProgress ? ('继续 · 第 ' + this.nextLevel + ' 阵') : '残局闯关';
    const priLabelW = ctx.measureText(priLabel).width;
    ctx.fillText(priLabel, x + 70, y + h / 2 + 1);
    // 右簇：› + 「已破 N/TOTAL」+（0 破时）NEW 徽章
    const chevronX = x + w - 18;
    ctx.font = TF('h2'); ctx.textAlign = 'right';
    icons.drawChevron(ctx, chevronX - 11, y + h / 2, 22, 'right', C.textOnAccent);
    ctx.font = TF('caption');
    const total = (ENDGAMES && ENDGAMES.length) || 100;
    // 窄屏下「继续 · 第 N 阵」较长，进度文案自动降级（去「已破」前缀）或省略，避免与主标签碰撞
    let progText = `已破 ${this.cleared}/${total}`;
    let progW = ctx.measureText(progText).width;
    const labelRight = x + 70 + priLabelW;
    if (chevronX - 16 - progW < labelRight + 4) {
      progText = `${this.cleared}/${total}`;
      progW = ctx.measureText(progText).width;
      if (chevronX - 16 - progW < labelRight + 4) progText = ''; // 仍溢出则省略进度文案
    }
    if (progText) ctx.fillText(progText, chevronX - 16, y + h / 2 + 1);
    if (this.cleared <= 0) {
      // 「NEW」徽章：用深一档黄铜（accentDeep）实底 + 近黑字，作为黄铜 Primary 上的「凹陷标签」，
      // 融入金色调而不再用 surface3 深块悬浮，观感更协调（§3-a）。
      ctx.font = TF('micro');
      const bw = ctx.measureText('NEW').width + 18;
      const bx = chevronX - 16 - progW - 10 - bw, by = y + h / 2 - 11;
      ctx.save();
      ctx.fillStyle = C.accentDeep; rr(ctx, bx, by, bw, 22, R.pill); ctx.fill();
      ctx.fillStyle = C.bgBase; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('NEW', bx + bw / 2, by + 11);
      ctx.restore();
    }
    this.regions.push({ key: 'endgame', rect: { x, y, w, h } });
  }

  /** 一级 Secondary 按钮：左金图标 + 文字 + › */
  _mainBtn(ctx, x, y, w, h, key, label, iconName) {
    drawBtn(ctx, x, y, w, h, '', 'secondary', { pressed: this.tap.isPressing(key, Date.now()) });
    ico(ctx, iconName, x + 40, y + h / 2, 24, C.accent);
    ctx.fillStyle = C.textPrimary; ctx.font = TF('button');
    ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    ctx.fillText(label, x + 68, y + h / 2 + 1);
    ctx.fillStyle = C.textSecondary;
    ctx.font = TF('h2'); ctx.textAlign = 'right';
    icons.drawChevron(ctx, x + w - 29, y + h / 2, 22, 'right', C.accent);
    this.regions.push({ key, rect: { x, y, w, h } });
  }

  /** 次级行图标+文字小按钮（44×52 热区，图标必带标签） */
  _rowBtn(ctx, cx, cy, key, label, iconName) {
    const w = 72, h = 52;
    const x = cx - w / 2, y = cy - h / 2;
    const regionKey = key;
    const col = this.tap.isPressing(regionKey, Date.now()) ? C.accent : C.textSecondary;
    ctx.save(); ctx.globalAlpha = 1;
    ico(ctx, iconName, cx, cy - 10, 22, col);
    ctx.fillStyle = col; ctx.font = TF('caption');
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(label, cx, cy + 14);
    ctx.restore();
    this.regions.push({ key: regionKey, rect: { x, y, w, h } });
  }

  onTouchStart(x, y) {
    this.guard.down(x, y);
    this.pressed = this._hit(x, y);
    if (this.pressed) this.tap.press(this.pressed, Date.now());
  }
  onTouchMove(x, y) { this.guard.move(x, y); if (this.guard.moved) { if (this.pressed) this.tap.clear(this.pressed); this.pressed = null; } }
  onTouchEnd(x, y) {
    const e = this.guard.end(x, y);
    if (this.pressed) this.tap.clear(this.pressed);
    this.pressed = null;
    if (!e.valid) return;
    // 通用模态（如 P2 断点恢复 M7）优先处理
    if (this.sm && this.sm.modal && this.sm.modal.isOpen() && this.sm.modal.isGeneric()) {
      if (!this.sm.modal.interactive()) return;
      const act = this.sm.modal.hitGeneric(x, y);
      if (act) this.sm.modal.resolveGeneric(act);
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
    if (key === 'endgame') {
      GameContext.emit('navigate', { to: 'endgameMap' });
      // P0-02：主按钮承诺「继续 · 第 N 阵」，把当前应挑战阵号交给阵图，
      // 由阵图首帧滚入视口 + 吸底「继续第 N 阵」CTA，一个动作即可进入。
      const mapParams = { from: 'menu' };
      if (this.hasProgress) mapParams.focusLevel = this.nextLevel;
      GameContext.pushScene('endgameMap', mapParams);
    } else if (key === 'ai') {
      const s = GameContext.getSettings();
      GameContext.emit('navigate', { to: s.skipSetup ? 'gameplay' : 'setup' });
      if (s.skipSetup) {
        // P0-04：跳过设置要恢复上次「全部」配置——难度 / 执棋色 / 对局方式（指导模式）。
        // 旧存档缺 style 时按 standard 兜底。
        // P0-03：getLastConfig() 无存档返回 null，此时才回落到设置页的「初始执棋色」。
        const last = GameContext.getLastConfig() || {};
        const diffKey = last.difficulty || 'medium';
        const depth = theme.aiDepth[diffKey] || 3;
        const color = (last.color === 'w' || last.color === 'b')
          ? last.color : (s.defaultColor === 'b' ? 'b' : 'w');
        const aiColor = color === 'w' ? 'b' : 'w';
        const coach = (last.style === 'coach' || last.coach === true);
        GameContext.pushScene('gameplay', {
          mode: 'ai', coach: coach, style: last.style || (coach ? 'coach' : 'standard'),
          aiDepth: depth, aiColor, playerColor: color
        });
      } else {
        GameContext.pushScene('setup', {});
      }
    } else if (key === 'versus') {
      // 双人对弈：进入对局方式页（默认本地双人，可选邀请好友加入）
      GameContext.emit('navigate', { to: 'versus' });
      GameContext.pushScene('versus', { from: 'menu' });
    } else if (key === 'academy') {
      GameContext.emit('navigate', { to: 'academy' });
      GameContext.pushScene('academy', { from: 'menu' });
    } else if (key === 'personalCenter') {
      GameContext.emit('navigate', { to: 'personalCenter' });
      GameContext.pushScene('personalCenter', { from: 'menu' });
    } else if (key === 'records') {
      GameContext.emit('navigate', { to: 'records' });
      GameContext.pushScene('records', {});
    }
  }
}

module.exports = MenuScene;
