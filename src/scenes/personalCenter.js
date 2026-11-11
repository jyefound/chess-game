/**
 * S9 个人中心：资料、对局数据与轻量荣誉。
 * 所有统计只从本地棋谱与残局存档派生；不创建账号、不读取微信个人资料。
 */
'use strict';
const GameContext = require('../context');
const M = require('./manager');
const { theme, TouchGuard, util, createTap } = M;
const C = theme.colors, R = theme.radius;
const TF = (k) => theme.font(k);
const rr = util.rr, inRect = util.inRect;
const layout = require('../core/layout');
const storage = require('../core/storage');
const settings = require('./settings');
const topbar = require('../render/topbar');
const icons = require('../render/icons');

function profile() {
  try { return settings.readProfile(); } catch (e) { return { nickname: '', updatedAt: 0 }; }
}
function stats() {
  let records = [], endgame = {};
  try { records = storage.listRecords() || []; } catch (e) {}
  try { endgame = storage.loadEndgame() || {}; } catch (e) {}
  const finished = records.filter(r => r && (r.endedAt || (r.outcome && r.outcome !== 'ongoing') || (r.result && r.result !== 'ongoing')));
  const wins = finished.filter(r => r.outcome === 'win').length;
  const draws = finished.filter(r => r.outcome === 'draw' || r.result === 'draw').length;
  const losses = finished.filter(r => r.outcome === 'loss').length;
  const cleared = endgame.cleared && typeof endgame.cleared === 'object'
    ? Object.keys(endgame.cleared).filter(k => endgame.cleared[k]).length : 0;
  return { total: finished.length, wins, draws, losses, cleared, records: records.length };
}
function honors(s) {
  const out = [];
  if (s.total >= 1) out.push('初次交锋');
  if (s.total >= 10) out.push('常来棋友');
  if (s.total >= 25) out.push('棋谱收藏家');
  if (s.cleared >= 1) out.push('残局初探');
  if (s.cleared >= 5) out.push('残局行者');
  if (s.cleared >= 10) out.push('残局研习者');
  return out;
}
function currentTitle(s) {
  if (s.cleared >= 10) return '残局研习者';
  if (s.total >= 25) return '棋谱收藏家';
  if (s.cleared >= 5) return '残局行者';
  if (s.total >= 10) return '常来棋友';
  if (s.cleared >= 1) return '残局初探';
  if (s.total >= 1) return '初次交锋';
  return '静心学棋';
}
class PersonalCenterScene {
  constructor() {
    this.guard = new TouchGuard({ moveThreshold: 10 });
    this.tap = createTap(); this.regions = []; this.pressed = null; this.sm = null;
    this.screenWidth = 375; this.screenHeight = 667; this.scrollY = 0; this.maxScroll = 0;
    this.contentTop = 0; this.contentBottom = 0; this._kb = null;
  }
  enter(params = {}) {
    this.sm = params._sm || null; this.screenWidth = params.screenWidth || 375;
    this.screenHeight = params.screenHeight || 667; this.regions = []; this.pressed = null;
    this.guard.reset(); this.tap.clear(); if (!params.resume) this.scrollY = 0;
  }
  exit() { this._keyboardCleanup(false); this.regions = []; this.tap.clear(); }
  clearTouch() { this.guard.reset(); this.pressed = null; this.tap.clear(); }
  update() {}
  _keyboardCleanup(hide) {
    if (!this._kb) return;
    try { wx.offKeyboardInput(this._kb.input); } catch (e) {}
    try { wx.offKeyboardConfirm(this._kb.confirm); } catch (e) {}
    if (hide) { try { wx.hideKeyboard({}); } catch (e) {} }
    this._kb = null;
  }
  _editNickname() {
    if (typeof wx === 'undefined' || !wx.showKeyboard || !wx.onKeyboardInput || !wx.onKeyboardConfirm ||
        !wx.offKeyboardInput || !wx.offKeyboardConfirm) {
      GameContext.showBanner('当前环境暂不支持编辑昵称', 'info'); return;
    }
    this._keyboardCleanup(true);
    const old = profile().nickname || '';
    const input = () => {};
    const confirm = (res) => {
      const name = settings.cleanNickname(res && res.value);
      this._keyboardCleanup(true);
      const ok = settings.writeProfile(name);
      GameContext.showBanner(ok ? '昵称已保存' : '保存失败，请重试', ok ? 'success' : 'danger');
    };
    this._kb = { input, confirm };
    try {
      wx.onKeyboardInput(input); wx.onKeyboardConfirm(confirm);
      wx.showKeyboard({ defaultValue: old, maxLength: 12, multiple: false, confirmHold: false, confirmType: 'done' });
    } catch (e) {
      this._keyboardCleanup(true); GameContext.showBanner('无法打开输入键盘，请稍后重试', 'info');
    }
  }
  render(ctx, W, H) {
    ctx.fillStyle = C.bgBase; ctx.fillRect(0, 0, W, H); this.regions = [];
    const L = layout.get();
    this._nav = topbar.drawTopBar(ctx, {
      title: '个人中心', fontKey: 'h1',
      back: { key: 'back', label: '返回', pressed: this.tap.isPressing('back', Date.now()) }
    });
    this._nav.regions.forEach(r => this.regions.push(r));
    const top = this._nav.bottom + 14, bottom = Math.min(L.contentBottom || H - 18, H - 16);
    this.contentTop = top; this.contentBottom = bottom;
    const s = stats(), p = profile(), x = 16, cw = W - 32;
    ctx.save(); ctx.beginPath(); ctx.rect(0, top, W, Math.max(0, bottom - top)); ctx.clip();
    let y = top + 8 - this.scrollY;
    rr(ctx, x, y, cw, 104, R.card || 16); ctx.fillStyle = C.surface1; ctx.fill();
    ctx.strokeStyle = C.border; ctx.lineWidth = 1; rr(ctx, x + .5, y + .5, cw - 1, 103, R.card || 16); ctx.stroke();
    ctx.fillStyle = C.accentFade; ctx.beginPath(); ctx.arc(x + 48, y + 50, 27, 0, Math.PI * 2); ctx.fill();
    icons.drawIcon(ctx, 'twoPlayers', x + 48, y + 50, 25, C.accent);
    ctx.fillStyle = C.textPrimary; ctx.font = TF('subtitleB'); ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    ctx.fillText(p.nickname || '棋友', x + 88, y + 34);
    ctx.fillStyle = C.textSecondary; ctx.font = TF('caption');
    ctx.fillText('个人资料 · 自填昵称', x + 88, y + 58);
    this._smallAction(ctx, x + cw - 74, y + 74, 58, 28, '编辑');
    this.regions.push({ key: 'editProfile', rect: { x: x + cw - 82, y: y + 62, w: 74, h: 40 } });
    y += 118;
    this._sectionTitle(ctx, '对弈概览', x, y); y += 28;
    const gap = 10, cellW = (cw - gap) / 2, cellH = 68;
    const metrics = [['完成对局', String(s.total)], ['胜 / 和 / 负', s.wins + ' / ' + s.draws + ' / ' + s.losses],
      ['已存棋谱', String(s.records)], ['已解残局', String(s.cleared)]];
    for (let i = 0; i < metrics.length; i++) {
      const col = i % 2, row = Math.floor(i / 2), bx = x + col * (cellW + gap), by = y + row * (cellH + 9);
      rr(ctx, bx, by, cellW, cellH, R.card || 14); ctx.fillStyle = C.surface1; ctx.fill();
      ctx.fillStyle = C.textSecondary; ctx.font = TF('caption'); ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
      ctx.fillText(metrics[i][0], bx + 13, by + 22);
      ctx.fillStyle = C.textPrimary; ctx.font = TF('h2'); ctx.fillText(metrics[i][1], bx + 13, by + 48);
    }
    y += cellH * 2 + 25;
    this._sectionTitle(ctx, '我的头衔', x, y); y += 28;
    const earned = honors(s), title = currentTitle(s);
    rr(ctx, x, y, cw, 76, R.card || 14); ctx.fillStyle = C.surface1; ctx.fill();
    icons.drawIcon(ctx, 'star', x + 28, y + 37, 24, C.accent);
    ctx.fillStyle = C.accent; ctx.font = TF('micro'); ctx.textAlign = 'left'; ctx.fillText('当前称号', x + 52, y + 25);
    ctx.fillStyle = C.textPrimary; ctx.font = TF('subtitleB'); ctx.fillText(title, x + 52, y + 51);
    ctx.fillStyle = C.textSecondary; ctx.font = TF('micro'); ctx.textAlign = 'right';
    ctx.fillText(earned.length + ' 项荣誉', x + cw - 14, y + 39);
    y += 88;
    const badges = [
      ['初次交锋', '完成第一局对弈', s.total >= 1], ['常来棋友', '累计完成 10 局对弈', s.total >= 10],
      ['棋谱收藏家', '累计完成 25 局对弈', s.total >= 25], ['残局初探', '成功解开第一道残局', s.cleared >= 1],
      ['残局行者', '成功解开 5 道残局', s.cleared >= 5], ['残局研习者', '成功解开 10 道残局', s.cleared >= 10]
    ];
    for (let i = 0; i < badges.length; i++) {
      const b = badges[i], bh = 48;
      rr(ctx, x, y, cw, bh, R.card || 12); ctx.fillStyle = C.surface1; ctx.fill();
      icons.drawIcon(ctx, 'star', x + 23, y + 24, 17, b[2] ? C.accent : C.textTertiary);
      ctx.fillStyle = b[2] ? C.textPrimary : C.textTertiary; ctx.font = TF('caption'); ctx.textAlign = 'left';
      ctx.fillText(b[0], x + 44, y + 19);
      ctx.fillStyle = C.textSecondary; ctx.font = TF('micro'); ctx.fillText(b[1], x + 44, y + 36);
      ctx.textAlign = 'right'; ctx.fillStyle = b[2] ? C.success : C.textTertiary;
      ctx.fillText(b[2] ? '已获得' : '待解锁', x + cw - 12, y + 27);
      y += 54;
    }
    y += 8; this._sectionTitle(ctx, '常用功能', x, y); y += 28;
    this._navRow(ctx, x, y, cw, 54, 'records', '对战历史', '查看与复盘已保存的对局', 'records'); y += 62;
    this._navRow(ctx, x, y, cw, 54, 'settings', '设置', '音效、棋盘、显示与隐私选项', 'settings'); y += 62;
    y += 10; this.contentHeight = y + this.scrollY - top + 16;
    this.maxScroll = Math.max(0, this.contentHeight - (bottom - top));
    ctx.restore();
    if (this.maxScroll > 0) {
      const trackH = bottom - top, thumbH = Math.max(28, trackH * trackH / this.contentHeight);
      const thumbY = top + (trackH - thumbH) * (this.scrollY / this.maxScroll);
      ctx.fillStyle = C.textTertiary; ctx.globalAlpha = .55; rr(ctx, W - 4, thumbY, 2, thumbH, 2); ctx.fill(); ctx.globalAlpha = 1;
    }
  }
  _sectionTitle(ctx, label, x, y) {
    ctx.fillStyle = C.textPrimary; ctx.font = TF('subtitleB'); ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    ctx.fillText(label, x, y + 10);
  }
  _smallAction(ctx, x, y, w, h, label) {
    rr(ctx, x, y, w, h, R.btn); ctx.fillStyle = C.accentFade; ctx.fill();
    ctx.fillStyle = C.accent; ctx.font = TF('micro'); ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(label, x + w / 2, y + h / 2);
  }
  _navRow(ctx, x, y, w, h, key, title, hint, icon) {
    rr(ctx, x, y, w, h, R.card || 12); ctx.fillStyle = C.surface1; ctx.fill();
    icons.drawIcon(ctx, icon, x + 24, y + h / 2, 21, C.accent);
    ctx.fillStyle = C.textPrimary; ctx.font = TF('subtitle'); ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    ctx.fillText(title, x + 46, y + 20);
    ctx.fillStyle = C.textSecondary; ctx.font = TF('micro'); ctx.fillText(hint, x + 46, y + 39);
    icons.drawChevron(ctx, x + w - 18, y + h / 2, 16, 'right', C.textSecondary);
    this.regions.push({ key, rect: { x, y, w, h } });
  }
  onTouchStart(x, y) { this.guard.down(x, y); this.pressed = this._hit(x, y); if (this.pressed) this.tap.press(this.pressed, Date.now()); }
  onTouchMove(x, y) {
    const m = this.guard.move(x, y);
    if (m.moved) { this.scrollY = Math.max(0, Math.min(this.maxScroll, this.scrollY - m.stepY)); if (this.pressed) this.tap.clear(this.pressed); this.pressed = null; }
  }
  onTouchEnd(x, y) {
    const e = this.guard.end(x, y); if (this.pressed) this.tap.clear(this.pressed); this.pressed = null;
    if (!e.valid) return;
    if (this.sm && this.sm.modal && this.sm.modal.isGeneric()) {
      if (!this.sm.modal.interactive()) return;
      const act = this.sm.modal.hitGeneric(x, y); if (act) this.sm.modal.resolveGeneric(act); return;
    }
    const key = this._hit(x, y); if (!key || !this.tap.guard(Date.now(), key)) return;
    if (key === 'back') { GameContext.emit('navigate', { to: 'menu' }); GameContext.popScene(); }
    else if (key === 'editProfile') this._editNickname();
    else if (key === 'records') { GameContext.emit('navigate', { to: 'records' }); GameContext.pushScene('records', { from: 'personal' }); }
    else if (key === 'settings') { GameContext.emit('navigate', { to: 'settings' }); GameContext.pushScene('settings', { from: 'personal' }); }
  }
  _hit(x, y) {
    for (let i = this.regions.length - 1; i >= 0; i--) {
      const r = this.regions[i], fixed = r.fixed === true;
      if ((!fixed && (y < this.contentTop || y > this.contentBottom)) || (fixed && y > this.contentTop)) continue;
      if (inRect(x, y, r.rect)) return r.key;
    }
    return null;
  }
}
module.exports = PersonalCenterScene;
module.exports.stats = stats;
module.exports.honors = honors;
module.exports.currentTitle = currentTitle;
