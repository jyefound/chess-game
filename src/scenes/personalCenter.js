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
const BADGE_DEFS = [
  { id:'first-game', title:'初次交锋', desc:'完成第一局对弈', metric:'total', target:1, tier:'bronze', note:'迈出第一步，棋路从此展开' },
  { id:'regular', title:'常来棋友', desc:'累计完成 10 局对弈', metric:'total', target:10, tier:'silver', note:'每一次落子，都是新的积累' },
  { id:'collector', title:'棋谱收藏家', desc:'累计完成 25 局对弈', metric:'total', target:25, tier:'gold', note:'把思考与精彩时刻留在棋谱里' },
  { id:'endgame-start', title:'残局初探', desc:'成功解开第一道残局', metric:'cleared', target:1, tier:'jade', note:'看见局势中的第一道突破口' },
  { id:'endgame-walker', title:'残局行者', desc:'成功解开 5 道残局', metric:'cleared', target:5, tier:'sapphire', note:'在变化中寻找更好的答案' },
  { id:'endgame-scholar', title:'残局研习者', desc:'成功解开 10 道残局', metric:'cleared', target:10, tier:'amethyst', note:'耐心与洞察，沉淀成真正的棋力' }
];
function badgeList(s) {
  return BADGE_DEFS.map(d => {
    const value = Number(s[d.metric]) || 0;
    return Object.assign({}, d, { value, earned: value >= d.target, progress: Math.min(1, value / d.target) });
  });
}
function nextBadge(s) {
  const list = badgeList(s);
  for (let i = 0; i < list.length; i++) if (!list[i].earned) return list[i];
  return null;
}
const MEDAL_TONES = {
  bronze:['#F0C58A','#B9783F','#8D542D'],
  silver:['#E5EDF5','#AAB9C9','#687F98'],
  gold:['#FFE6A0','#D8A13D','#98651F'],
  jade:['#B8E6D5','#59A98D','#34745F'],
  sapphire:['#C5DDFB','#709BD2','#456B9F'],
  amethyst:['#DED1F7','#9B83CA','#67529A']
};
function drawMedal(ctx, cx, cy, size, tier, earned) {
  const tone = MEDAL_TONES[tier] || MEDAL_TONES.gold;
  const a = earned ? tone[0] : '#D9DEE4', b = earned ? tone[1] : '#AEB7C1', c = earned ? tone[2] : '#7E8995';
  ctx.save();
  // 双层绶带
  ctx.beginPath(); ctx.moveTo(cx-size*.28,cy+size*.22); ctx.lineTo(cx-size*.34,cy+size*.58);
  ctx.lineTo(cx-size*.08,cy+size*.47); ctx.lineTo(cx,cy+size*.66); ctx.lineTo(cx+size*.08,cy+size*.47);
  ctx.lineTo(cx+size*.34,cy+size*.58); ctx.lineTo(cx+size*.28,cy+size*.22); ctx.closePath();
  ctx.fillStyle = earned ? c : '#9BA5AF'; ctx.fill();
  ctx.beginPath(); ctx.moveTo(cx-size*.12,cy+size*.25); ctx.lineTo(cx,cy+size*.55); ctx.lineTo(cx+size*.12,cy+size*.25); ctx.closePath();
  ctx.fillStyle = earned ? b : '#C4CBD2'; ctx.fill();
  // 金属外缘与内圈
  ctx.shadowColor = earned ? 'rgba(31,42,54,0.22)' : 'rgba(31,42,54,0.08)';
  ctx.shadowBlur = earned ? 7 : 2; ctx.shadowOffsetY = 2;
  ctx.beginPath(); ctx.arc(cx,cy,size*.34,0,Math.PI*2);
  let g = ctx.createLinearGradient(cx-size*.32,cy-size*.32,cx+size*.32,cy+size*.32);
  g.addColorStop(0,a); g.addColorStop(.52,b); g.addColorStop(1,c);
  ctx.fillStyle = g; ctx.fill();
  ctx.shadowColor = 'transparent'; ctx.shadowBlur = 0; ctx.shadowOffsetY = 0;
  ctx.lineWidth = Math.max(1,size*.025); ctx.strokeStyle = earned ? a : '#EEF1F4'; ctx.stroke();
  ctx.beginPath(); ctx.arc(cx,cy,size*.275,0,Math.PI*2);
  ctx.fillStyle = earned ? 'rgba(255,255,255,0.16)' : 'rgba(255,255,255,0.28)'; ctx.fill();
  ctx.strokeStyle = earned ? 'rgba(255,255,255,0.72)' : '#F4F6F8'; ctx.lineWidth = 1.2; ctx.stroke();
  // 中央浮雕星章
  const outer=size*.17, inner=size*.075;
  ctx.beginPath();
  for(let i=0;i<10;i++){const ang=-Math.PI/2+i*Math.PI/5,rad=i%2?inner:outer,x=cx+Math.cos(ang)*rad,y=cy+Math.sin(ang)*rad;if(i===0)ctx.moveTo(x,y);else ctx.lineTo(x,y);}
  ctx.closePath(); ctx.fillStyle = earned ? '#FFF9E9' : '#E8EDF1'; ctx.fill();
  ctx.strokeStyle = earned ? 'rgba(104,76,34,0.28)' : '#AAB3BD'; ctx.lineWidth = .8; ctx.stroke();
  if (earned) {
    ctx.fillStyle = '#FFF7D6';
    [[-.42,-.26],[.43,-.2],[.38,.34]].forEach(p=>{ctx.beginPath();ctx.arc(cx+size*p[0],cy+size*p[1],Math.max(1,size*.022),0,Math.PI*2);ctx.fill();});
  } else {
    ctx.fillStyle = '#7E8995'; ctx.font = 'bold '+Math.max(9,size*.18)+'px sans-serif'; ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText('?',cx,cy+1);
  }
  ctx.restore();
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
    // 个人资料主卡：头像徽章、昵称、当前称号与明确的编辑入口
    rr(ctx, x, y, cw, 112, R.card || 16); ctx.fillStyle = C.surface1; ctx.fill();
    ctx.strokeStyle = C.border; ctx.lineWidth = 1; rr(ctx, x + .5, y + .5, cw - 1, 111, R.card || 16); ctx.stroke();
    ctx.save(); ctx.shadowColor = 'rgba(20,30,40,0.12)'; ctx.shadowBlur = 10; ctx.shadowOffsetY = 3;
    ctx.beginPath(); ctx.arc(x + 48, y + 48, 29, 0, Math.PI * 2); ctx.fillStyle = C.accentFade; ctx.fill();
    ctx.restore();
    ctx.beginPath(); ctx.arc(x + 48, y + 48, 25, 0, Math.PI * 2); ctx.strokeStyle = C.accentSoft; ctx.lineWidth = 1.5; ctx.stroke();
    icons.drawIcon(ctx, 'user', x + 48, y + 48, 25, C.accent);
    ctx.fillStyle = C.textPrimary; ctx.font = TF('subtitleB'); ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    ctx.fillText(p.nickname || '棋友', x + 88, y + 34);
    ctx.fillStyle = C.textSecondary; ctx.font = TF('caption'); ctx.fillText('个人资料 · 自填昵称', x + 88, y + 57);
    const titleLabel = currentTitle(s);
    const chipW = Math.min(142, Math.max(82, titleLabel.length * 13 + 26));
    rr(ctx, x + 86, y + 75, chipW, 24, R.pill || 12); ctx.fillStyle = C.accentFade; ctx.fill();
    icons.drawIcon(ctx, 'star', x + 99, y + 87, 12, C.accent);
    ctx.fillStyle = C.accent; ctx.font = TF('micro'); ctx.textAlign = 'left'; ctx.fillText(titleLabel, x + 110, y + 88);
    this._smallAction(ctx, x + cw - 70, y + 76, 56, 26, '编辑');
    this.regions.push({ key: 'editProfile', rect: { x: x + cw - 78, y: y + 67, w: 72, h: 40 } });

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
    this._sectionTitle(ctx, '荣誉殿堂', x, y);
    const badgeItems = badgeList(s), earnedCount = badgeItems.filter(b => b.earned).length;
    const activeTitle = currentTitle(s), next = nextBadge(s);
    y += 28;
    // 当前称号展示柜：大尺寸主徽章与下一阶段进度
    rr(ctx, x, y, cw, 104, R.card || 16); ctx.fillStyle = C.surface1; ctx.fill();
    ctx.strokeStyle = C.border; ctx.lineWidth = 1; rr(ctx, x + .5, y + .5, cw - 1, 103, R.card || 16); ctx.stroke();
    drawMedal(ctx, x + 52, y + 47, 66, earnedCount ? 'gold' : 'silver', earnedCount > 0);
    ctx.fillStyle = C.accent; ctx.font = TF('micro'); ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    ctx.fillText('当前称号', x + 100, y + 24);
    ctx.fillStyle = C.textPrimary; ctx.font = TF('subtitleB'); ctx.fillText(activeTitle, x + 100, y + 46);
    ctx.fillStyle = C.textSecondary; ctx.font = TF('micro'); ctx.fillText(earnedCount + ' / ' + badgeItems.length + ' 枚徽章已点亮', x + 100, y + 66);
    if (next) {
      const pw = Math.max(70, cw - 124), px = x + 100, py = y + 82;
      rr(ctx, px, py, pw, 5, 3); ctx.fillStyle = C.surface2; ctx.fill();
      rr(ctx, px, py, pw * next.progress, 5, 3); ctx.fillStyle = C.accent; ctx.fill();
    } else {
      ctx.fillStyle = C.success; ctx.font = TF('micro'); ctx.fillText('全部荣誉已集齐', x + 100, y + 84);
    }
    y += 116;
    ctx.fillStyle = C.textSecondary; ctx.font = TF('caption'); ctx.textAlign = 'left'; ctx.fillText('徽章收藏', x, y + 8);
    ctx.textAlign = 'right'; ctx.fillText('点击徽章查看详情', x + cw, y + 8);
    y += 24;
    const badgeGap = 10, badgeW = (cw - badgeGap) / 2, badgeH = 122;
    for (let i = 0; i < badgeItems.length; i++) {
      const b = badgeItems[i], col = i % 2, row = Math.floor(i / 2);
      const bx = x + col * (badgeW + badgeGap), by = y + row * (badgeH + 10);
      rr(ctx, bx, by, badgeW, badgeH, R.card || 14);
      ctx.fillStyle = b.earned ? C.surface1 : C.surface2; ctx.fill();
      ctx.strokeStyle = b.earned ? C.accentLine : C.border; ctx.lineWidth = b.earned ? 1.2 : 1;
      rr(ctx, bx + .5, by + .5, badgeW - 1, badgeH - 1, R.card || 14); ctx.stroke();
      drawMedal(ctx, bx + badgeW / 2, by + 36, 48, b.tier, b.earned);
      ctx.fillStyle = b.earned ? C.textPrimary : C.textSecondary; ctx.font = TF('captionB');
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(b.title, bx + badgeW / 2, by + 75);
      ctx.fillStyle = C.textSecondary; ctx.font = TF('micro'); ctx.fillText(b.desc, bx + badgeW / 2, by + 94);
      ctx.fillStyle = b.earned ? C.success : C.textTertiary; ctx.font = TF('micro');
      ctx.fillText(b.earned ? '✦ 已获得' : (b.value + ' / ' + b.target), bx + badgeW / 2, by + 111);
      this.regions.push({ key: 'badge:' + b.id, rect: { x: bx, y: by, w: badgeW, h: badgeH } });
    }
    y += Math.ceil(badgeItems.length / 2) * (badgeH + 10) - 10;
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
    else if (key.indexOf('badge:') === 0) this._showBadgeDetail(key.slice(6));
    else if (key === 'editProfile') this._editNickname();
    else if (key === 'records') { GameContext.emit('navigate', { to: 'records' }); GameContext.pushScene('records', { from: 'personal' }); }
    else if (key === 'settings') { GameContext.emit('navigate', { to: 'settings' }); GameContext.pushScene('settings', { from: 'personal' }); }
  }
  _showBadgeDetail(id) {
    const b = badgeList(stats()).filter(item => item.id === id)[0];
    if (!b) return;
    const message = b.earned
      ? b.note + '\n\n解锁条件：' + b.desc + '\n当前进度：' + b.value + ' / ' + b.target
      : b.note + '\n\n解锁条件：' + b.desc + '\n当前进度：' + b.value + ' / ' + b.target + '\n再接再厉，下一枚徽章正在等你。';
    GameContext.openModal('confirm', {
      title: b.title + (b.earned ? ' · 已获得' : ' · 未解锁'),
      height: 230, message,
      buttons: [{ label: '知道了', action: 'cancel', variant: 'primary' }],
      onAction: function () { GameContext.closeModal(); }
    });
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
module.exports.badgeList = badgeList;
module.exports.nextBadge = nextBadge;
