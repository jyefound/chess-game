/**
 * S5 棋谱列表场景（视觉 §8.7 / UX §3.3.4–3.3.5）
 * - 卡片 w343 h88 r12：行1 对手/模式 + 结果徽章；行2 日期·步数·时长（text-secondary，C7）；
 *   行3 仅进行中 info 徽章「进行中」；右端 chevron（tertiary）。
 * - 结果徽章：胜=success / 负=danger / 和=neutral / 进行中=info（色+文字双重编码）。
 * - 空状态：居中 64px ♟ 水印 α.10 + 「还没有保存的棋谱」+ 文字按钮「去下一局」→ S1/S2。
 * - 滚动：onTouchMove 更新 scrollY；卡片点击位移 ≤12pt 才算 tap（滑动不触发）。
 * - 删除管理：显式「编辑」模式（不做左滑）：右上「编辑」→ 每卡左侧砖红 ✕ + 顶部「完成」「清空全部」；
 *   点 ✕ → M5 二次确认；「清空全部」→ Danger 二次确认。删失败仍移除 index + Banner（降级）。
 * - 点卡片 → push('replay',{id})；返回 pop() → S1；记录 key 缺失 → Banner「棋谱数据缺失」。
 */
const GameContext = require('../context');
const M = require('./manager');
const { theme, TouchGuard, util, createTap } = M;
const layoutMod = require('../core/layout');
const C = theme.colors, R = theme.radius;
const TF = (k) => theme.font(k);
const rr = util.rr, inRect = util.inRect, drawBtn = util.drawButtonLocal;
const topbar = require('../render/topbar');
const { opponentLabel, modeLabel } = require('../data/recordLabels');

const icons = (() => { try { return require('../render/icons'); } catch (e) { return null; } })();
const piecesRender = require('../render/pieces');
function ico(ctx, name, x, y, size, color) {
  if (icons && typeof icons.drawIcon === 'function') {
    try { icons.drawIcon(ctx, name, x, y, size, color); return true; } catch (e) { /* noop */ }
  }
  return false;
}

function pad2(n) { return n < 10 ? '0' + n : '' + n; }
function fmtDate(ts) {
  if (typeof ts !== 'number' || !isFinite(ts) || ts <= 0) return '—';
  const d = new Date(ts);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}
function fmtDuration(ms) {
  if (typeof ms !== 'number' || !isFinite(ms) || ms < 0) return '00:00';
  const total = Math.floor(ms / 1000);
  return `${pad2(Math.floor(total / 60))}:${pad2(total % 60)}`;
}
function outcomeBadge(rec) {
  // outcome: 'win'|'loss'|'draw'|'ongoing'（缺 outcome 时按 result 推断）
  let oc = rec.outcome;
  if (!oc) {
    if (!rec.result) oc = 'ongoing';
    else if (rec.result === 'draw') oc = 'draw';
    else oc = 'win'; // 双人模式默认按「结束」显示
  }
  const map = {
    win: { label: '胜', color: C.success },
    loss: { label: '负', color: C.danger },
    draw: { label: '和', color: C.neutralBadge },
    ongoing: { label: '进行中', color: C.info }
  };
  return map[oc] || map.draw;
}

class RecordsScene {
  constructor() {
    this.guard = new TouchGuard({ moveThreshold: 12 });
    this.regions = [];
    this.pressed = null;
    this.tap = createTap(); // 统一按压状态 + 90ms 防穿透（Phase 3·12）
    this.records = [];
    this.editing = false;
    this.scrollY = 0;
    this.maxScroll = 0;
    this.contentHeight = 0;
    this.contentTop = 0;
    this.contentBottom = 0;
    this.screenWidth = 375;
    this.screenHeight = 667;
    this.from = 'menu';
    this.sm = null;
  }

  enter(params = {}) {
    this.sm = params._sm || null;
    this.screenWidth = params.screenWidth || 375;
    this.screenHeight = params.screenHeight || 667;
    this.from = params.from || 'menu';
    this.regions = [];
    this.pressed = null;
    this.editing = false;
    if (!params.resume) this.scrollY = 0;
    this.guard.reset();
    this.tap.clear();
    this.reload();
  }
  exit() { this.regions = []; this.pressed = null; this.tap.clear(); }
  clearTouch() { this.guard.reset(); this.pressed = null; this.tap.clear(); }
  update() {}

  reload() {
    this.records = GameContext.listRecords();
  }

  render(ctx, W, H) {
    ctx.fillStyle = C.bgBase; ctx.fillRect(0, 0, W, H);
    this.regions = [];

    const L = layoutMod.get();
    // 统一三槽位顶栏：左返回 / 中标题 / 右「编辑·完成」；标题溢出自动省略或下沉第二行
    const nav = topbar.drawTopBar(ctx, {
      title: '棋谱',
      fontKey: 'h1',
      back: { key: 'back', label: '返回', pressed: this.tap.isPressing('back', Date.now()) },
      right: this.editing
        ? { key: 'doneEdit', label: '完成', pressed: this.tap.isPressing('doneEdit', Date.now()) }
        : (this.records.length > 0
            ? { key: 'edit', label: '编辑', pressed: this.tap.isPressing('edit', Date.now()) }
            : null)
    });
    nav.regions.forEach(r => this.regions.push(r));
    const navBottom = nav.bottom;
    ctx.strokeStyle = C.accentLine; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(16, navBottom + 8); ctx.lineTo(W - 16, navBottom + 8); ctx.stroke();

    // 编辑模式顶部「清空全部」Danger 条
    const listTop = navBottom + 16 + (this.editing && this.records.length ? 48 : 0);
    if (this.editing && this.records.length) {
      const cy = navBottom + 14;
      ctx.fillStyle = 'rgba(217,106,106,0.10)'; rr(ctx, 16, cy, W - 32, 40, R.sm); ctx.fill();
      ctx.strokeStyle = C.danger; ctx.lineWidth = 1; rr(ctx, 16.5, cy + 0.5, W - 33, 39, R.sm); ctx.stroke();
      ctx.fillStyle = C.danger; ctx.font = TF('body');
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(`清空全部 ${this.records.length} 局棋谱`, W / 2, cy + 20);
      this.regions.push({ key: 'clearAll', rect: { x: 16, y: cy, w: W - 32, h: 40 } });
    }

    this.contentTop = listTop;
    this.contentBottom = L.contentBottom;  // P1-L2：改用安全区口径，避让 home indicator
    const viewportH = Math.max(0, this.contentBottom - this.contentTop);

    if (this.records.length === 0) {
      this._renderEmpty(ctx, W, H, listTop, viewportH);
      this.contentHeight = viewportH;
      this.maxScroll = 0;
      return;
    }

    // 滚动裁剪
    ctx.save();
    ctx.beginPath(); ctx.rect(0, this.contentTop, W, viewportH); ctx.clip();
    const cardX = 16, cardW = W - 32, cardH = 88, gap = 12;
    let vY = 0;
    for (let i = 0; i < this.records.length; i++) {
      const rec = this.records[i];
      const screenY = this.contentTop + vY - this.scrollY;
      if (screenY + cardH > this.contentTop && screenY < this.contentBottom) {
        this._renderCard(ctx, rec, cardX, screenY, cardW, cardH, i);
      }
      vY += cardH + gap;
    }
    ctx.restore();
    this.contentHeight = vY;
    this.maxScroll = Math.max(0, this.contentHeight - viewportH);
    if (this.scrollY > this.maxScroll) this.scrollY = this.maxScroll;
    if (this.scrollY < 0) this.scrollY = 0;

    // 渐隐提示
    if (this.scrollY > 2) this._fade(ctx, W, this.contentTop, true);
    if (this.scrollY < this.maxScroll - 2) this._fade(ctx, W, this.contentBottom, false);
  }

  _renderCard(ctx, rec, x, y, w, h, index) {
    const delW = this.editing ? 44 : 0;
    const contentX = x + (this.editing ? delW + 8 : 0);
    const contentW = w - (this.editing ? delW + 8 : 0);

    // 删除 ✕（编辑模式，砖红，44×44 热区）
    if (this.editing) {
      const dx = x, dy = y + (h - 44) / 2;
      ctx.save();
      ctx.fillStyle = 'rgba(217,106,106,0.14)'; rr(ctx, dx, dy, 44, 44, R.sm); ctx.fill();
      ctx.strokeStyle = C.danger; ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(dx + 15, dy + 15); ctx.lineTo(dx + 29, dy + 29);
      ctx.moveTo(dx + 29, dy + 15); ctx.lineTo(dx + 15, dy + 29);
      ctx.stroke();
      ctx.restore();
      this.regions.push({ key: 'del:' + rec.id, rect: { x: dx, y: dy, w: 44, h: 44 } });
    }

    // 卡片底（surface1 + e1）
    util.withShadow(ctx, theme.elevation.e1, () => {
      ctx.fillStyle = C.surface1; rr(ctx, contentX, y, contentW, h, R.btn); ctx.fill();
    });
    ctx.strokeStyle = C.border; ctx.lineWidth = 1;
    rr(ctx, contentX + 0.5, y + 0.5, contentW - 1, h - 1, R.btn); ctx.stroke();
    if (this.tap.isPressing('open:' + rec.id, Date.now())) { util.drawTapHighlight(ctx, contentX, y, contentW, h, true, R.btn); }

    // 行1：对手/模式（Subtitle）+ 结果徽章
    ctx.fillStyle = C.textPrimary; ctx.font = TF('subtitle');
    ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    const opponent = opponentLabel(rec);
    // 徽章占右，标题留宽
    const badge = outcomeBadge(rec);
    ctx.font = TF('micro');
    const bw = ctx.measureText(badge.label).width + 20;
    const bx = contentX + contentW - 12 - bw, by = y + 14;
    // 语义色实底 + textOnAccent 深字（原 danger@.14 叠 surface1 的「负」仅 3.70:1，
    // 现统一胜/和/负/进行中为实底深字，≥5.4:1 PASS）
    ctx.fillStyle = badge.color; rr(ctx, bx, by, bw, 22, 999); ctx.fill();
    ctx.fillStyle = C.textOnAccent; ctx.font = TF('micro');
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(badge.label, bx + bw / 2, by + 11);
    // 标题（截断到徽章左侧）
    ctx.fillStyle = C.textPrimary; ctx.font = TF('subtitle');
    ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    const titleMaxW = bx - (contentX + 14) - 8;
    this._ellipsis(ctx, opponent, contentX + 14, y + 25, titleMaxW);

    // 行2：模式标签 · 日期 · 步数 · 时长
    // 模式标签用 micro 粗体小字 + textSecondary（不用 accent 黄铜，避免与结果徽章混淆），
    // 与 replay.js meta 卡样式一致；模式段完整可见，其余段用 _ellipsis 截断防止压到右端 chevron。
    const plies = rec.plies != null ? rec.plies : (Array.isArray(rec.movesUci) ? rec.movesUci.length : 0);
    const row2X = contentX + 14;
    const row2MaxW = contentW - 14 - 30;
    const modeTxt = modeLabel(rec.mode);
    ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    ctx.font = TF('micro');
    const modeW = ctx.measureText(modeTxt).width;
    ctx.fillStyle = C.textSecondary;
    ctx.fillText(modeTxt, row2X, y + 52);
    ctx.font = TF('caption');
    const meta = ` · ${fmtDate(rec.startedAt)} · ${plies} 步 · ${fmtDuration(rec.durationMs)}`;
    this._ellipsis(ctx, meta, row2X + modeW, y + 52, Math.max(0, row2MaxW - modeW));

    // 行3：进行中 info 徽章（仅 ongoing）
    if (badge.label === '进行中') {
      ctx.fillStyle = C.info; rr(ctx, contentX + 14, y + 64, 56, 18, 999); ctx.fill();
      ctx.fillStyle = C.textOnAccent; ctx.font = TF('micro');
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('进行中', contentX + 14 + 28, y + 73);
    }

    // 右端 chevron（secondary，surface1 上 3.30:1 临界 → 升 secondary 达 5.23:1）
    ctx.fillStyle = C.textSecondary; ctx.font = TF('subtitleB');
    ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
    icons.drawChevron(ctx, contentX + contentW - 18, y + h / 2 + 6, 18, 'right', C.textSecondary);

    // 卡片点击热区（编辑模式下点卡片仍打开，删除点 ✕）
    this.regions.push({ key: 'open:' + rec.id, rect: { x: contentX, y, w: contentW, h } });
  }

  _renderEmpty(ctx, W, H, top, viewportH) {
    const cy = top + viewportH / 2;
    ctx.save();
    ctx.globalAlpha = 0.10;
    ctx.fillStyle = C.textPrimary;
    piecesRender.drawPiece(ctx, 'p', 'w', W / 2, cy - 40, 64);
    ctx.restore();
    ctx.fillStyle = C.textSecondary; ctx.font = TF('body');
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('还没有保存的棋谱', W / 2, cy + 24);
    // 文字按钮「去下一局」→ S1（若来自人机则 S2）
    const bw = 140, bh = 44, bx = (W - bw) / 2, by = cy + 48;
    ctx.fillStyle = C.accentFade; rr(ctx, bx, by, bw, bh, R.btn); ctx.fill();
    ctx.fillStyle = C.accent; ctx.font = TF('body');
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('去下一局', W / 2, by + bh / 2);
    this.regions.push({ key: 'goPlay', rect: { x: bx, y: by, w: bw, h: bh } });
  }

  _fade(ctx, W, y, topDown) {
    const g = ctx.createLinearGradient(0, y - (topDown ? 0 : 12), 0, y + (topDown ? 12 : 0));
    g.addColorStop(0, topDown ? C.bgBase : 'rgba(16,21,27,0)');
    g.addColorStop(1, topDown ? 'rgba(16,21,27,0)' : C.bgBase);
    ctx.fillStyle = g; ctx.fillRect(0, topDown ? y : y - 12, W, 12);
  }

  _alpha(hex, a) {
    // 支持 #RRGGBB；rgba 原样返回（用于已是 rgba 的 token）
    if (typeof hex !== 'string') return `rgba(154,167,180,${a})`;
    if (hex.charAt(0) !== '#') return hex;
    const r = parseInt(hex.slice(1, 3), 16), g = parseInt(hex.slice(3, 5), 16), b = parseInt(hex.slice(5, 7), 16);
    return `rgba(${r},${g},${b},${a})`;
  }

  _ellipsis(ctx, text, x, y, maxW) {
    let t = String(text || '');
    if (ctx.measureText(t).width <= maxW) { ctx.fillText(t, x, y); return; }
    while (t.length > 1 && ctx.measureText(t + '…').width > maxW) t = t.slice(0, -1);
    ctx.fillText(t + '…', x, y);
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
    if (!e.valid) return; // 滑动不触发点击
    // 通用模态（confirm）优先
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
    if (key === 'back') {
      if (this.editing) { this.editing = false; return; }
      GameContext.emit('navigate', { to: 'menu' });
      GameContext.popScene();
      return;
    }
    if (key === 'edit') { this.editing = true; return; }
    if (key === 'doneEdit') { this.editing = false; return; }
    if (key === 'clearAll') { this._confirmClearAll(); return; }
    if (key === 'goPlay') {
      // 来自人机 → 直接 S2；否则回 S1
      GameContext.emit('navigate', { to: 'setup' });
      GameContext.popScene();
      return;
    }
    if (key.indexOf('del:') === 0) { this._confirmDelete(key.slice(4)); return; }
    if (key.indexOf('open:') === 0) { this._openReplay(key.slice(5)); return; }
  }

  _openReplay(id) {
    // 记录 key 缺失检测：getRecord 为空 → Banner + 从列表移除（由 storage 下次写入重建）
    const full = GameContext.getRecord(id);
    if (!full) {
      GameContext.showBanner('棋谱数据缺失', 'danger');
      GameContext.emit('uiError');
      this.reload();
      return;
    }
    GameContext.emit('navigate', { to: 'replay' });
    GameContext.pushScene('replay', { id, from: 'records' });
  }

  _confirmDelete(id) {
    GameContext.openModal('confirm', {
      title: '删除棋谱', message: '删除这局棋谱？此操作不可恢复。',
      buttons: [
        { label: '取消', action: 'cancel', variant: 'secondary' },
        { label: '删除', action: 'confirm', variant: 'danger' }
      ],
      onAction: (act) => {
        GameContext.closeModal();
        if (act !== 'confirm') return;
        // 降级：删除失败仍从 index 移除 + Banner（storage.deleteRecord 内部已保证移除 index）
        const ok = GameContext.deleteRecord(id);
        this.reload();
        GameContext.showBanner(ok === false ? '棋谱已移除（数据可能异常）' : '棋谱已删除', ok === false ? 'warning' : 'success');
        if (this.records.length === 0) this.editing = false;
        if (this.scrollY > this.maxScroll) this.scrollY = this.maxScroll;
      }
    });
  }

  _confirmClearAll() {
    const n = this.records.length;
    GameContext.openModal('confirm', {
      title: '清空全部棋谱', message: `删除全部 ${n} 局棋谱？此操作不可恢复。`,
      buttons: [
        { label: '取消', action: 'cancel', variant: 'secondary' },
        { label: '清空', action: 'confirm', variant: 'danger' }
      ],
      onAction: (act) => {
        GameContext.closeModal();
        if (act !== 'confirm') return;
        const ok = GameContext.clearAllRecords();
        this.reload();
        this.editing = false;
        this.scrollY = 0;
        GameContext.showBanner(ok === false ? '清空失败' : '已清空所有棋谱', ok === false ? 'danger' : 'success');
        GameContext.emit(ok === false ? 'uiError' : 'saveRecord');
      }
    });
  }
}

module.exports = RecordsScene;
