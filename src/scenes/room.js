/**
 * S-Room 远程双人对弈 · 房间入口与交互场景（墨金棋院 · Ink & Brass）
 * ----------------------------------------------------------------------------
 * 相位状态机 this.phase：
 *   'hub'      来自菜单的默认页：说明 + 「发起邀请」/「加入房间」+ 返回。
 *   'hosting'  建房/等待：大号 6 位房间码 + 邀请/复制 + 等待状态 + 取消；
 *              订阅 watchRoom，好友加入（status='playing' 且 guestSeat 非空）后进入对局。
 *   'joining'  加入：自绘 6 格数字键盘（0-9 + 删除 + 确认），确认后 joinRoom 进入对局。
 *   'error'    异常/联机能力不可用：友好提示 + 返回菜单。
 *
 * 平台约束：微信小游戏纯 CommonJS + Canvas 2D 即时模式，无 DOM/CSS/HTML/SVG/eval/
 * window/document/fetch/XMLHttpRequest。深色底 + 黄铜强调，颜色一律 C.*、字号一律 TF()，
 * 安全区一律 core/layout.get()。所有渲染在 render(ctx) 每帧重绘。
 *
 * 重要：src/core/room.js 由并行 worker 实现，可能尚未落盘。此处一律防御式 require，
 * 所有 room.* 调用经 callRoom/callRoomSync 守卫（模块缺失/云不可用/抛异常均降级、不崩），
 * 且 Promise 调用一律带 .catch()。onForeground/onBackground 由 game.js 生命周期统一驱动，
 * 本场景不重复接线。
 */
'use strict';

const GameContext = require('../context');
const M = require('./manager');
const { theme, TouchGuard, util, createTap } = M;
const C = theme.colors, R = theme.radius;
const TF = (k) => theme.font(k);
const rr = util.rr, inRect = util.inRect, drawBtn = util.drawButtonLocal;
const layout = require('../core/layout');
const panels = require('../render/panels');
const topbar = require('../render/topbar');
const config = require('../config');
const RC = config.ROOM_CONFIG || {};

// 房间云原语（impl-room-core 交付；缺失时静默降级，绝不影响本地双人）
let room = null;
try { room = require('../core/room'); } catch (e) { room = null; }

// 图标（可选，缺失静默；图标一律配文字标签）
const icons = (() => { try { return require('../render/icons'); } catch (e) { return null; } })();
function ico(ctx, name, cx, cy, size, color) {
  if (icons && typeof icons.drawIcon === 'function') {
    try { icons.drawIcon(ctx, name, cx, cy, size, color); return true; } catch (e) { /* noop */ }
  }
  return false;
}

const CODE_LEN = 6;
const HUB_DESC = (RC && typeof RC.hubDesc === 'string' && RC.hubDesc) ||
  '与好友各用一台设备对弈，全程不共用同一屏幕';

function isRoomCode(v) {
  return typeof v === 'string' && /^\d{6}$/.test(v);
}

const REASON_TEXT = {
  unavailable: '联机能力暂不可用，请检查网络与云同步设置',
  invalid_room: '房间码格式不正确，请输入 6 位数字',
  not_found: '房间不存在或已解散，请核对房间码',
  expired: '房间已过期或已解散，请重新开始一局',
  full: '房间已满，请加入其他房间',
  conflict: '房间状态冲突，可能已结束，请重新开始',
  error: '网络异常，请稍后重试',
  not_authorized: '尚未完成授权，请在设置中开启云同步',
  disabled: '云同步未启用，请在设置中开启',
  invalid: '无法重新加入，请重新开始',
  denied: '仅房主可调整本房间局数'
};
function reasonText(reason) {
  return REASON_TEXT[reason] || '操作未成功，请重试';
}

// ---- v5.1：局数选择 / 本机昵称 / 封存残局格式化 ----
// 草稿与昵称一律 wx.getStorageSync/setStorageSync 直读直写，绝不 require storage.js /
// settings.js（否则触发 storage 写 hook，把房间键镜像进 chess_records）。
const DRAFT_KEY = 'chess.roomDraft.v1';
const PROFILE_KEY = 'chess.profile.v1';
const GAME_CHOICES = [
  { value: 0, label: '不限' },
  { value: 1, label: '1 局' },
  { value: 3, label: '3 局' },
  { value: 5, label: '5 局' },
  { value: 10, label: '10 局' }
];
const GAME_VALUES = GAME_CHOICES.map(function (c) { return c.value; });

function wxGet(key) {
  try {
    if (typeof wx !== 'undefined' && typeof wx.getStorageSync === 'function') return wx.getStorageSync(key);
  } catch (e) { /* 静默降级 */ }
  return '';
}
function wxSet(key, val) {
  try {
    if (typeof wx !== 'undefined' && typeof wx.setStorageSync === 'function') wx.setStorageSync(key, val);
  } catch (e) { /* 静默降级 */ }
}

/** 本机昵称：直读 chess.profile.v1（{nickname,updatedAt}），裁到 nickMaxLen，解析失败回落空串。 */
function localNick() {
  const maxLen = (RC && typeof RC.nickMaxLen === 'number') ? RC.nickMaxLen : 12;
  const raw = wxGet(PROFILE_KEY);
  let nick = '';
  if (raw && typeof raw === 'object') {
    if (typeof raw.nickname === 'string') nick = raw.nickname;
  } else if (typeof raw === 'string' && raw) {
    try {
      const obj = JSON.parse(raw);
      if (obj && typeof obj === 'object' && typeof obj.nickname === 'string') nick = obj.nickname;
      else if (typeof obj === 'string') nick = obj;
      else nick = raw;
    } catch (e) { nick = raw; }
  }
  nick = String(nick || '').replace(/\s+/g, ' ').trim();
  return nick.length > maxLen ? nick.slice(0, maxLen) : nick;
}

/** 局数草稿：兼容 {maxGames} / 数字 / JSON 字符串；非法值回落 ROOM_CONFIG.maxGamesDefault。 */
function readDraft() {
  const def = (RC && typeof RC.maxGamesDefault === 'number') ? RC.maxGamesDefault : 0;
  let raw = wxGet(DRAFT_KEY);
  if (raw && typeof raw === 'string') {
    try { raw = JSON.parse(raw); } catch (e) { raw = null; }
  }
  let v = def;
  if (raw && typeof raw === 'object' && typeof raw.maxGames === 'number') v = raw.maxGames;
  else if (typeof raw === 'number') v = raw;
  return GAME_VALUES.indexOf(v) >= 0 ? v : def;
}
function writeDraft(n) { wxSet(DRAFT_KEY, { maxGames: n, updatedAt: Date.now() }); }

/** 封存时间 → MM/DD HH:mm；无有效时间戳返回 '—'。 */
function fmtArchiveTime(ts) {
  const t = Number(ts);
  if (!isFinite(t) || t <= 0) return '—';
  const d = new Date(t);
  const p2 = function (n) { return n < 10 ? '0' + n : '' + n; };
  return p2(d.getMonth() + 1) + '/' + p2(d.getDate()) + ' ' + p2(d.getHours()) + ':' + p2(d.getMinutes());
}

/** keepUntil 剩余秒 → mm:ss（双方退出保留倒计时）。 */
function fmtKeep(ts) {
  const t = Number(ts);
  const left = isFinite(t) ? Math.max(0, Math.floor((t - Date.now()) / 1000)) : 0;
  const p2 = function (n) { return n < 10 ? '0' + n : '' + n; };
  return p2(Math.floor(left / 60)) + ':' + p2(left % 60);
}

/** 同步 room.* 调用守卫：模块缺失 / 函数缺失 / 抛异常一律返回 null，绝不外泄异常。 */
function callRoomSync(name, args) {
  try {
    if (!room || typeof room[name] !== 'function') return null;
    return room[name].apply(room, args || []);
  } catch (e) { return null; }
}

/** 异步 room.* 调用：恒返回 Promise；缺失归一为 {ok:false,reason:'unavailable'}。 */
function callRoom(name, args) {
  return Promise.resolve().then(function () {
    if (!room || typeof room[name] !== 'function') return { ok: false, reason: 'unavailable' };
    return room[name].apply(room, args || []);
  });
}

class RoomScene {
  constructor() {
    this.guard = new TouchGuard();
    this.regions = [];
    this.pressed = null;
    this.tap = createTap();               // 90ms 防穿透 + 按压态
    this.sm = null;
    this.screenWidth = 375;
    this.screenHeight = 667;

    this.phase = 'hub';
    this.from = 'menu';
    this.joinCode = '';                   // 分享卡片带入的房间码
    this.code = '';                       // 加入页当前输入
    this.roomId = '';
    this.seat = '';
    this.role = '';
    this.hostColor = 'w';
    this.status = '';
    this.errMsg = '';
    this.busy = false;
    this.available = false;

    this._inited = false;
    this._gen = 0;                        // 异步回调代次，防止离开场景后旧回调触发导航
    this._navDone = false;
    this._waiting = false;                // 是否仍是 waiting 房（决定 exit/取消是否 leaveRoom）
    this._watchActive = false;
    this._lastPoll = 0;
    this._t = 0;

    // ---- v5.1：局数 / 封存残局 / 重新加入 / 房间文档快照 ----
    this.maxGames = readDraft();          // 0 = 无限模式
    this.seedMovesUci = [];               // 「继续残局」注入的初始着法
    this.archivedRooms = [];              // listArchivedRooms() 结果
    this.archiveIndex = 0;                // 当前选中的封存残局
    this.rejoinTarget = null;             // {roomId, seat, role} | null
    this.roomDoc = null;                  // create / join / watch 拿到的云端文档
    this._archiveSwept = false;           // 超时补封存已尝试（防同一实例重复 CAS）
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

    this._gen++;
    this._navDone = false;
    this._waiting = false;
    this._watchActive = false;
    this.busy = false;
    this.errMsg = '';
    this.status = '';
    this.roomId = '';
    this.seat = '';
    this.code = '';
    this._t = 0;
    this.maxGames = readDraft();
    this.seedMovesUci = [];
    this.archivedRooms = [];
    this.archiveIndex = 0;
    this.rejoinTarget = null;
    this.roomDoc = null;

    this.available = this._probeAvailable();
    this.joinCode = isRoomCode(params.joinCode) ? params.joinCode : '';

    // 工具/截图用：显式指定相位，不触发任何云调用（正常导航不会传 phase）。
    if (params.phase) {
      this.phase = (params.phase === 'hosting' || params.phase === 'joining' || params.phase === 'error')
        ? params.phase : 'hub';
      if (params.roomId) this.roomId = params.roomId;
      if (params.code) this.code = params.code;
      if (this.phase === 'joining' && this.joinCode) this.code = this.joinCode;
      this.status = this.phase === 'hosting' ? '等待好友加入…' : '';
      return;
    }

    // 分享卡片带入合法 6 位房间码：预填并自动触发一次 joinRoom
    if (this.joinCode) {
      this.code = this.joinCode;
      this.phase = 'joining';
      this._confirmJoin(true);
    } else {
      this.phase = 'hub';
    }

    // hub 进入时异步拉封存残局；并探测「重新加入」目标（全部经 callRoom 守卫，
    // 协议层尚未落盘时静默降级，不显示入口、不抛异常）。phase 工具钩子不触云。
    if (this.phase === 'hub') this._loadArchived();
    this._resolveRejoin();
    this._sweepExpiredArchive();   // 两端都已离开对局时补一次超时封存（守卫 + catch + 幂等）
  }

  exit() {
    this._gen++;
    this._watchActive = false;
    callRoomSync('stopWatch');
    // 仍是 waiting 房（未开局）才删除，避免刚进入对局时把房间删掉
    if (this._waiting) {
      callRoomSync('leaveRoom');
      this._waiting = false;
    }
    this.regions = [];
    this.pressed = null;
    this.tap.clear();
  }

  clearTouch() { this.guard.reset(); this.pressed = null; this.tap.clear(); }

  /** 云回填 / 授权态变化后重新探测可用性；只刷新缓存字段，不 re-enter。 */
  onDataChanged() {
    try { this.available = this._probeAvailable(); } catch (e) { /* 静默 */ }
  }

  update(dt) {
    this._t = (this._t || 0) + (dt || 0);
    // watchRoom 不可用或实时通道未覆盖时，以低频 pull 兜底（前台 onForeground 亦会驱动）
    if (this.phase === 'hosting' && this._waiting && !this._navDone) {
      const nowMs = Date.now();
      if (nowMs - (this._lastPoll || 0) > 1500) {
        this._lastPoll = nowMs;
        callRoomSync('pollOnce');
      }
    }
  }

  // ==================== 能力探测 / 内部动作 ====================
  _probeAvailable() {
    if (room && !this._inited) {
      this._inited = true;
      try { if (typeof room.init === 'function') room.init(); } catch (e) { /* 静默 */ }
    }
    try {
      return !!(room && typeof room.isAvailable === 'function' && room.isAvailable());
    } catch (e) { return false; }
  }

  _toast(msg, type) {
    try {
      if (GameContext && typeof GameContext.showBanner === 'function') GameContext.showBanner(msg, type || 'info');
    } catch (e) { /* 无 SceneManager 时静默 */ }
  }

  _showUnavailable() {
    this.errMsg = reasonText('unavailable');
    this._watchActive = false;
    callRoomSync('stopWatch');
    this.phase = 'error';
  }

  _failRoom(reason) {
    this.errMsg = reasonText(reason);
    this._watchActive = false;
    callRoomSync('stopWatch');
    this.phase = 'error';
  }

  /** 统一进入远程对局；先关掉等待态，保证 exit() 不会误删已开局的房间。 */
  _enterGame(params) {
    if (this._navDone) return;
    this._navDone = true;
    this._waiting = false;
    this._watchActive = false;
    GameContext.emit('navigate', { to: 'gameplay' });
    GameContext.replaceScene('gameplay', params);
  }

  /**
   * 回主菜单（error 相位「返回菜单」按钮 / 非 versus 入口的兜底）。
   * - from !== 'versus'（menu 直达 / 分享冷启动）：维持原状 emit + popScene，落点都是 menu；
   * - from === 'versus'：栈为 [menu, versus, room]，popScene 只会退回 versus，
   *   而按钮语义是「返回菜单」，故用 popToRoot 直接落到菜单根场景。
   */
  _goMenu() {
    GameContext.emit('navigate', { to: 'menu' });
    if (this.from === 'versus') { GameContext.popToRoot(); return; }
    GameContext.popScene();
  }

  /**
   * hub 相位的顶栏返回。
   * from==='versus'（由对局方式页进入）→ emit(navigate vers) + popScene 回选择页
   *（场景栈 [menu, versus, room]，pop 后栈顶即 versus）；
   * 其余入口（分享冷启动 [room] / menu 直达）→ 回主菜单（维持原状）。
   */
  _backFromHub() {
    if (this.from === 'versus') {
      GameContext.emit('navigate', { to: 'versus' });
      GameContext.popScene();
      return;
    }
    this._goMenu();
  }

  _cancelToHub() {
    this._gen++;
    this._watchActive = false;
    callRoomSync('stopWatch');
    if (this._waiting) { callRoomSync('leaveRoom'); this._waiting = false; }
    this.busy = false;
    this.errMsg = '';
    this.status = '';
    this.roomId = '';
    this.seat = '';
    this.code = '';
    this.phase = 'hub';
  }

  /** hub 进入时异步拉封存残局；协议层未落盘 / 云异常一律静默降级为空数组。
   *  先做一次 sweepAbandoned()：零云函数无服务端定时器，「双方均退出保留 10 分钟，
   *  超时自动解散并封存」由任一端重新进入房间页时补判（最终一致性兜底，协议层幂等）。 */
  _loadArchived() {
    const self = this;
    const gen = this._gen;
    return callRoom('sweepAbandoned', []).then(function () {
      return callRoom('listArchivedRooms', []);
    }).then(function (res) {
      if (self._gen !== gen) return;
      self.archivedRooms = (res && res.ok && Array.isArray(res.items)) ? res.items : [];
      if (self.archiveIndex >= self.archivedRooms.length) self.archiveIndex = 0;
    }).catch(function () {
      if (self._gen !== gen) return;
      self.archivedRooms = [];
    });
  }

  /**
   * 兜底：两端都已 popScene 离开对局时，gameplay 不再按 keepUntil 判定超时封存，
   * 房间页按云端文档补一次超时判定并调 archiveGame()，避免封存挂起导致「继续残局」拿不到数据。
   * 仅「本机有房间断点 + 双方均退出 + keepUntil 已过期 + 未封存」时触发；协议层幂等。
   * phase 工具钩子（截图）不调用，绝不触云。
   */
  _sweepExpiredArchive() {
    if (this._archiveSwept) return;
    const local = callRoomSync('readLocalRoom', []);
    if (!local || !local.roomId || !local.seat) return;
    const self = this;
    const gen = this._gen;
    callRoom('getRoom', [local.roomId]).then(function (res) {
      if (self._gen !== gen || self._archiveSwept) return;
      const doc = (res && res.ok && res.doc) ? res.doc : null;
      if (!doc || doc.archived) return;
      const bothGone = doc.hostPresent === false && doc.guestPresent === false;
      const keepUntil = Number(doc.keepUntil) || 0;
      if (!bothGone || keepUntil <= 0 || Date.now() <= keepUntil) return;
      self._archiveSwept = true;
      callRoom('archiveGame', []).then(function (r) {
        if (self._gen !== gen) return;
        if (r && r.ok) self._loadArchived();   // 封存成功后刷新 hub 封存残局列表
        else self._archiveSwept = false;        // 失败允许下次重试
      }).catch(function () { self._archiveSwept = false; });
    }).catch(function () { /* 静默降级 */ });
  }

  /** 退出方「重新加入」目标：首选 room.readLocalRoom()，GameplayScene.rejoinEntry() 兜底。 */
  _resolveRejoin() {
    let t = null;
    const local = callRoomSync('readLocalRoom', []);
    if (local && local.roomId && local.seat) {
      t = { roomId: String(local.roomId), seat: String(local.seat),
        role: local.role === 'guest' ? 'guest' : 'host' };
    }
    if (!t) {
      // 懒 require，避免顶层循环依赖；静态方法尚未落盘时 typeof 防御，绝不抛异常。
      try {
        const G = require('./gameplay');
        if (G && typeof G.rejoinEntry === 'function') {
          const e = G.rejoinEntry();
          if (e && e.roomId && e.seat) {
            t = { roomId: String(e.roomId), seat: String(e.seat),
              role: e.role === 'guest' ? 'guest' : 'host' };
          }
        }
      } catch (err) { /* 并行 worker 未落盘：静默 */ }
    }
    this.rejoinTarget = t;
  }

  /** confirm 正文：列出封存残局（房间码/手数/对手昵称/封存时间），选中条用 ▶ 标记。 */
  _archiveMessage() {
    const list = this.archivedRooms || [];
    const lines = [];
    const max = Math.min(list.length, 3);
    for (let i = 0; i < max; i++) {
      const it = list[i] || {};
      const mark = i === this.archiveIndex ? '▶' : '·';
      const code = it.roomId || '——';
      const moves = (typeof it.movesCount === 'number') ? it.movesCount
        : (Array.isArray(it.movesUci) ? it.movesUci.length : 0);
      const opp = String(it.guestNick || it.hostNick || '好友').slice(0, 5);
      lines.push(mark + code + ' ' + moves + '手 ' + opp + ' ' + fmtArchiveTime(it.archivedAt));
    }
    if (list.length > max) lines.push('…另有 ' + (list.length - max) + ' 局');
    lines.push('「继续残局」将载入第 ' + (this.archiveIndex + 1) + ' 局');
    return lines.join('\n');
  }

  _openConfirm(payload) {
    if (this.sm && this.sm.modal && typeof this.sm.modal.open === 'function') {
      this.sm.modal.open('confirm', payload);
      if (typeof this.clearTouch === 'function') this.clearTouch();
      return true;
    }
    if (GameContext && typeof GameContext.openModal === 'function') {
      try { GameContext.openModal('confirm', payload); return true; } catch (e) { /* noop */ }
    }
    return false;
  }

  /** 点「查看」：通用 confirm 模态列出封存残局；多条时加「换一局」在模态内切换选中。 */
  _openArchiveModal() {
    const list = this.archivedRooms || [];
    if (!list.length) return;
    const self = this;
    // 多条时增加「换一局」在模态内循环切换选中（重新 open 刷新 ▶ 标记）；
    // 单条时保持规格的三个按钮。按钮文案完整，横排 4 枚在 330pt 面板内不裁切。
    const buttons = list.length > 1
      ? [
          { label: '换一局', action: 'next', variant: 'ghost' },
          { label: '继续残局', action: 'resume', variant: 'primary' },
          { label: '重新开始', action: 'restart', variant: 'secondary' },
          { label: '取消', action: 'cancel', variant: 'ghost' }
        ]
      : [
          { label: '继续残局', action: 'resume', variant: 'primary' },
          { label: '重新开始', action: 'restart', variant: 'secondary' },
          { label: '取消', action: 'cancel', variant: 'ghost' }
        ];
    const ok = this._openConfirm({
      title: '封存残局 · 共 ' + list.length + ' 局',
      message: this._archiveMessage(),
      height: 300,
      buttons: buttons,
      onAction: function (act, m) {
        if (act === 'next') {
          self.archiveIndex = (self.archiveIndex + 1) % list.length;
          m.close();
          self._openArchiveModal();
        } else if (act === 'resume') { m.close(); self._resumeArchived(); }
        else if (act === 'restart') { m.close(); self.seedMovesUci = []; self._startHosting(); }
        else if (act === 'cancel') { m.close(); }
      }
    });
    // 无 SceneManager（离线测试等）：直接以选中条续局，保证入口不空响应。
    if (!ok) this._resumeArchived();
  }

  /** 「继续残局」：把选中条的 movesUci 存为 seed，走正常建房（createRoom 带 seedMovesUci）。 */
  _resumeArchived() {
    const list = this.archivedRooms || [];
    const item = list[this.archiveIndex] || list[0];
    this.seedMovesUci = (item && Array.isArray(item.movesUci)) ? item.movesUci.slice() : [];
    this._startHosting();
  }

  /** 退出方重新加入：云端复占 → 导航 gameplay(rejoin:true)，保留房间已有着法。 */
  _rejoinRoom() {
    const t = this.rejoinTarget;
    if (!t || this.busy) return;
    if (!this._probeAvailable()) { this._toast(reasonText('unavailable'), 'warning'); return; }
    this.busy = true;
    const self = this;
    const gen = ++this._gen;
    callRoom('rejoinRoom', [t.roomId, t.seat]).then(function (res) {
      if (self._gen !== gen) return;
      self.busy = false;
      if (!res || !res.ok) { self._toast(reasonText(res && res.reason), 'warning'); return; }
      const role = (res.role === 'guest' || t.role === 'guest') ? 'guest' : 'host';
      const doc = res.doc || {};
      self.roomDoc = doc;
      self._enterGame({
        mode: 'remote', roomId: t.roomId, seat: t.seat, role: role,
        playerColor: role === 'host' ? 'w' : 'b', hostColor: 'w', rejoin: true,
        movesUci: Array.isArray(doc.movesUci) ? doc.movesUci : []
      });
    }).catch(function () {
      if (self._gen !== gen) return;
      self.busy = false;
      self._toast(reasonText('error'), 'warning');
    });
  }

  /** 房间状态文案（archived / abandoned / 双方退出保留倒计时）；doc 可由 getState 兜底传入。 */
  _roomStatusLine(doc) {
    const d = doc || this.roomDoc;
    if (!d || !d.status) return '';   // 无真实房间文档（截图 phase 钩子）时不显示降级噪音
    if (d.status === 'archived') return '本局已封存残局';
    if (d.status === 'abandoned') return '房间已解散';
    if (d.hostPresent === false && d.guestPresent === false && Number(d.keepUntil) > 0) {
      return '双方已离开，房间保留 ' + fmtKeep(d.keepUntil);
    }
    return '';
  }

  /** hosting/joining 的「局数 + 比分」一行文案；doc 可由 getState 兜底传入。 */
  _gamesInfo(doc) {
    const d = doc || this.roomDoc || {};
    const maxGames = (typeof d.maxGames === 'number') ? d.maxGames : this.maxGames;
    const hs = (typeof d.hostScore === 'number') ? d.hostScore : 0;
    const gs = (typeof d.guestScore === 'number') ? d.guestScore : 0;
    const gi = (typeof d.gameIndex === 'number') ? d.gameIndex : 0;
    if (maxGames > 0) {
      return '本房间 ' + maxGames + ' 局 · 第 ' + Math.min(gi + 1, maxGames) + ' 局 · 比分 ' + hs + ' : ' + gs;
    }
    return '无限局 · 比分 ' + hs + ' : ' + gs;
  }

  _startHosting() {
    if (!this._probeAvailable()) { this._showUnavailable(); return; }
    this.phase = 'hosting';
    this.errMsg = '';
    this.busy = true;
    this.status = '正在创建房间…';
    this._gen++;
    const gen = this._gen;
    const self = this;
    // v5.1：4 个 opts 全部交给协议层；seedMovesUci 为「继续残局」的初始着法（重开时为 []）。
    const opts = {
      hostColor: 'w',
      hostNick: localNick(),
      maxGames: this.maxGames,
      seedMovesUci: this.seedMovesUci || []
    };
    callRoom('createRoom', [opts]).then(function (res) {
      if (self._gen !== gen || self.phase !== 'hosting') return;
      self.busy = false;
      if (!res || !res.ok) { self._failRoom(res && res.reason); return; }
      self.roomId = res.roomId || '';
      self.seat = res.seat || '';
      self.hostColor = 'w';
      self.role = 'host';
      self._waiting = true;
      self.status = '等待好友加入…';
      self.roomDoc = res.doc || null;
      if (res.doc && Array.isArray(res.doc.movesUci)) self.seedMovesUci = res.doc.movesUci.slice();
      self._watch(self.roomId, gen);
    }).catch(function () {
      if (self._gen !== gen || self.phase !== 'hosting') return;
      self.busy = false;
      self._failRoom('error');
    });
  }

  _watch(roomId, gen) {
    const self = this;
    this._watchActive = true;
    const ok = callRoomSync('watchRoom', [roomId, {
      onSnapshot: function (doc) {
        if (!self._watchActive || self._navDone) return;
        if (self._gen !== gen || self.phase !== 'hosting') return;
        // v5.1：缓存文档供 hosting 渲染局数/比分/双方退出状态。
        if (doc) {
          self.roomDoc = doc;
          if (Array.isArray(doc.movesUci)) self.seedMovesUci = doc.movesUci.slice();
        }
        if (doc && doc.status === 'playing' && doc.guestSeat) {
          // 房主：执白先行，hostColor 固定 'w'；带云端初始着法（续局）进对局。
          self._enterGame({
            mode: 'remote', roomId: roomId, seat: self.seat,
            role: 'host', playerColor: 'w', hostColor: 'w',
            movesUci: (doc && Array.isArray(doc.movesUci)) ? doc.movesUci : (self.seedMovesUci || [])
          });
        }
      },
      onError: function () {
        if (!self._watchActive) return;
        if (self._gen !== gen || self.phase !== 'hosting') return;
        self.status = '等待好友加入…（同步重试中）';
      }
    }]);
    if (ok === false) this.status = '等待好友加入…';
  }

  _confirmJoin(auto) {
    if (this.busy) return;
    const code = this.code || '';
    if (!isRoomCode(code)) {
      this.errMsg = auto ? '' : reasonText('invalid_room');
      return;
    }
    if (!this._probeAvailable()) {
      this.errMsg = reasonText('unavailable');
      return;
    }
    this.busy = true;
    this.errMsg = '';
    this.status = '正在加入房间…';
    this._gen++;
    const gen = this._gen;
    const self = this;
    // v5.1：第二参写 guestNick；返回的 doc.movesUci 含续局初始着法。
    callRoom('joinRoom', [code, { nick: localNick() }]).then(function (res) {
      if (self._gen !== gen || self.phase !== 'joining') return;
      self.busy = false;
      self.status = '';
      if (!res || !res.ok) {
        self.errMsg = reasonText(res && res.reason);
        return;
      }
      // 好友：执 joinRoom 返回的 color（约定为 'b'），房主执白
      const color = (res.color === 'w' || res.color === 'b') ? res.color : 'b';
      const seat = res.seat || '';
      const doc = (res && res.doc) || {};
      self.roomId = code;
      self.seat = seat;
      self.role = 'guest';
      self.roomDoc = res.doc || null;
      self._enterGame({
        mode: 'remote', roomId: code, seat: seat,
        role: 'guest', playerColor: color, hostColor: 'w',
        movesUci: Array.isArray(doc.movesUci) ? doc.movesUci : []
      });
    }).catch(function () {
      if (self._gen !== gen || self.phase !== 'joining') return;
      self.busy = false;
      self.status = '';
      self.errMsg = reasonText('error');
    });
  }

  _share() {
    const code = this.roomId || '';
    if (!code) { this._toast('房间尚未创建成功，请稍候', 'warning'); return; }
    if (typeof wx !== 'undefined' && typeof wx.shareAppMessage === 'function') {
      try {
        wx.shareAppMessage({ title: '来下一局！房间码 ' + code, query: 'room=' + code });
        return;
      } catch (e) {
        this._toast('分享未成功，可复制房间码发给好友', 'warning');
        return;
      }
    }
    this._toast('当前环境不支持分享，可复制房间码发给好友', 'info');
  }

  _copy() {
    const code = this.roomId || '';
    if (!code) { this._toast('房间尚未创建成功，请稍候', 'warning'); return; }
    let done = false;
    if (typeof wx !== 'undefined' && typeof wx.setClipboardData === 'function') {
      try { wx.setClipboardData({ data: code }); done = true; } catch (e) { done = false; }
    }
    this._toast(done ? '房间码已复制' : '复制不可用，请手动记下房间码', done ? 'success' : 'info');
  }

  // ==================== 渲染 ====================
  _title() {
    if (this.phase === 'hosting') return '等待好友加入';
    if (this.phase === 'joining') return '加入房间';
    return '邀请好友加入';
  }

  render(ctx, W, H) {
    ctx.fillStyle = C.bgBase; ctx.fillRect(0, 0, W, H);
    this.regions = [];
    const L = layout.get();
    const contentBottom = Math.min(L.contentBottom, H - 12);

    // 共享顶栏（三槽位、胶囊避让、底部金发丝线）
    const nav = topbar.drawTopBar(ctx, {
      W: W,
      title: this._title(), fontKey: 'h1',
      back: { key: 'back', label: '返回', pressed: this.tap.isPressing('back', Date.now()) },
      divider: true
    });
    for (const r of nav.regions) this.regions.push(Object.assign({ fixed: true }, r));

    if (this.phase === 'hub') this._renderHub(ctx, W, H, nav, contentBottom, L);
    else if (this.phase === 'hosting') this._renderHosting(ctx, W, H, nav, contentBottom, L);
    else if (this.phase === 'joining') this._renderJoining(ctx, W, H, nav, contentBottom, L);
    else this._renderError(ctx, W, H, nav, contentBottom, L);

    // 通用模态（若其它逻辑打开了 confirm/resume 等，最上层绘制）
    if (this.sm && this.sm.modal && this.sm.modal.isOpen() && this.sm.modal.isGeneric()) {
      this.sm.modal.renderGeneric(ctx, W, H);
    }
  }

  /** 6 格房间码：filled=true 用黄铜强调（房主展示），否则用主文字色（加入输入回显）。 */
  _drawCodeBoxes(ctx, x, y, w, h, code, filled) {
    const gap = 8;
    const boxW = (w - 32 - gap * (CODE_LEN - 1)) / CODE_LEN;
    for (let i = 0; i < CODE_LEN; i++) {
      const bx = x + 16 + i * (boxW + gap);
      ctx.save();
      ctx.fillStyle = C.surface2;
      rr(ctx, bx, y, boxW, h, R.sm); ctx.fill();
      ctx.strokeStyle = filled ? C.accent : C.border;
      ctx.lineWidth = 1;
      rr(ctx, bx + 0.5, y + 0.5, boxW - 1, h - 1, R.sm); ctx.stroke();
      const ch = code[i] || '';
      ctx.fillStyle = ch ? (filled ? C.accentSoft : C.textPrimary) : C.textTertiary;
      ctx.font = TF('display');
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(ch || '·', bx + boxW / 2, y + h / 2 + 1);
      ctx.restore();
    }
  }

  _centerLines(ctx, text, cx, topY, maxW, fontKey, color, maxLines) {
    const lines = panels.wrapText(ctx, text, maxW, fontKey, maxLines || 0);
    ctx.save();
    ctx.fillStyle = color; ctx.font = TF(fontKey);
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    const lh = panels.lineHeight(fontKey);
    for (let i = 0; i < lines.length; i++) ctx.fillText(lines[i], cx, topY + i * lh);
    ctx.restore();
    return lines.length * lh;
  }

  _renderHub(ctx, W, H, nav, contentBottom, L) {
    const padX = 16;
    const cardW = W - padX * 2;
    // 320×568 命中 isCompactH / isCompactW：主卡、间距、按钮高度一并收紧，
    // 保证「局数 2 行 + 重新加入 + 封存入口 + 两个主 CTA + 脚注」都不越 contentBottom。
    const compact = !!(L.isCompactH || L.isCompactW);
    const gap = compact ? 8 : 16;
    const btnH = compact ? 44 : 52;
    let y = nav.bottom + (compact ? 10 : 24);

    const cardH = compact ? 100 : 172;
    panels.drawGroupPanel(ctx, padX, y, cardW, cardH);
    ico(ctx, 'twoPlayers', W / 2, y + cardH * 0.26, compact ? 28 : 44, C.accent);
    ctx.save();
    ctx.fillStyle = C.textPrimary; ctx.font = TF('h2');
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('邀请好友加入', W / 2, y + cardH * 0.55);
    ctx.restore();
    this._centerLines(ctx, HUB_DESC, W / 2, y + cardH * 0.74, cardW - 48, 'caption', C.textSecondary, 2);
    y += cardH;

    // 紧凑屏把「联机不可用」并入底部脚注，避免占用两行把主 CTA 挤出 contentBottom。
    if (!this.available && !compact) {
      this._centerLines(ctx, reasonText('unavailable'), W / 2, y + gap,
        cardW - 24, 'caption', C.warning, 2);
      y += gap + panels.lineHeight('caption') * 2;
    }

    // 局数选择（不限 / 1 / 3 / 5 / 10 局）：窄屏 cardW<320 自动换成两行，绝不硬裁切。
    y += gap;
    ctx.save();
    ctx.fillStyle = C.textSecondary; ctx.font = TF('caption');
    ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    ctx.fillText('本房间局数', padX, y + 10);
    ctx.restore();
    y += compact ? 24 : 26;

    const segGap = compact ? 6 : 8;
    const rows = (cardW < 320) ? [GAME_CHOICES.slice(0, 3), GAME_CHOICES.slice(3)] : [GAME_CHOICES];
    let pressedVal;
    if (this.pressed && this.pressed.indexOf('games:') === 0) pressedVal = Number(this.pressed.slice(6));
    for (let ri = 0; ri < rows.length; ri++) {
      const segs = panels.drawSegmented(ctx, padX, y, cardW, 44, rows[ri], this.maxGames,
        { gap: segGap, pressedValue: pressedVal });
      for (let s = 0; s < segs.length; s++) {
        this.regions.push({ key: 'games:' + segs[s].value, rect: segs[s].rect });
      }
      y += 44 + (ri < rows.length - 1 ? segGap : 0);
    }

    // 可选行：重新加入 / 封存残局（并存时并排半宽，各占 44pt 热区）。
    const hasRejoin = !!this.rejoinTarget;
    const hasArchive = !!(this.archivedRooms && this.archivedRooms.length);
    if (hasRejoin || hasArchive) {
      y += gap;
      const optH = 44;
      const halfGap = 10;
      const halfW = (cardW - halfGap) / 2;
      if (hasRejoin && hasArchive) {
        drawBtn(ctx, padX, y, halfW, optH, '重新加入', 'secondary',
          { pressed: this.tap.isPressing('rejoin', Date.now()) });
        this.regions.push({ key: 'rejoin', rect: { x: padX, y: y, w: halfW, h: optH } });
        drawBtn(ctx, padX + halfW + halfGap, y, halfW, optH, '封存残局 · 查看', 'ghost',
          { pressed: this.tap.isPressing('archiveView', Date.now()) });
        this.regions.push({ key: 'archiveView', rect: { x: padX + halfW + halfGap, y: y, w: halfW, h: optH } });
      } else if (hasRejoin) {
        drawBtn(ctx, padX, y, cardW, optH, '重新加入 · 房间 ' + (this.rejoinTarget.roomId || ''), 'secondary',
          { pressed: this.tap.isPressing('rejoin', Date.now()) });
        this.regions.push({ key: 'rejoin', rect: { x: padX, y: y, w: cardW, h: optH } });
      } else {
        drawBtn(ctx, padX, y, cardW, optH, '你有 ' + this.archivedRooms.length + ' 个封存残局 · 查看', 'ghost',
          { pressed: this.tap.isPressing('archiveView', Date.now()) });
        this.regions.push({ key: 'archiveView', rect: { x: padX, y: y, w: cardW, h: optH } });
      }
      y += optH;
    }

    y += gap;
    drawBtn(ctx, padX, y, cardW, btnH, '发起邀请', 'primary',
      { pressed: this.tap.isPressing('host', Date.now()) });
    this.regions.push({ key: 'host', rect: { x: padX, y: y, w: cardW, h: btnH } });
    y += btnH + (compact ? 8 : 14);
    drawBtn(ctx, padX, y, cardW, btnH, '加入房间', 'secondary',
      { pressed: this.tap.isPressing('joinEntry', Date.now()) });
    this.regions.push({ key: 'joinEntry', rect: { x: padX, y: y, w: cardW, h: btnH } });

    // 底部脚注（避开 home indicator）；紧凑屏且联机不可用时改显示降级提示（零额外占位）。
    const footWarn = !this.available && compact;
    ctx.save();
    ctx.fillStyle = footWarn ? C.warning : C.textTertiary; ctx.font = TF('micro');
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(footWarn ? reasonText('unavailable') : '房主执白先行 · 好友执黑',
      W / 2, contentBottom - 12);
    ctx.restore();
  }

  _renderHosting(ctx, W, H, nav, contentBottom, L) {
    const padX = 16;
    const cardW = W - padX * 2;
    const top = nav.bottom + 20;
    // v5.1：hosting 以 roomDoc 为主、getState() 兜底（watch/poll 尚未回调时也能读
    // maxGames / gameIndex / hostScore / guestScore / hostPresent / guestPresent / keepUntil）。
    const state = callRoomSync('getState', []);
    const viewDoc = Object.assign({}, state || {}, this.roomDoc || {});

    ctx.save();
    ctx.fillStyle = C.textSecondary; ctx.font = TF('caption');
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('把下面的房间码告诉好友，好友输入后即可开局', W / 2, top + 10);
    ctx.restore();

    const codeY = top + 34;
    const codeH = 104;
    panels.drawGroupPanel(ctx, padX, codeY, cardW, codeH);
    this._drawCodeBoxes(ctx, padX, codeY + (codeH - 64) / 2, cardW, 64, this.roomId || '', true);

    // 局数 + 比分（doc.maxGames / gameIndex / hostScore / guestScore）
    const infoY = codeY + codeH + 16;
    ctx.save();
    ctx.fillStyle = C.accentSoft; ctx.font = TF('caption');
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(this._gamesInfo(viewDoc), W / 2, infoY);
    ctx.restore();

    // 等待状态（三点呼吸动画，update(dt) 驱动 _t；创建中/同步重试时显示原始状态文案）
    const statusY = infoY + 26;
    const dots = ['.', '..', '...'][Math.floor((this._t || 0) * 2) % 3];
    const isDefaultWait = !this.status || this.status === '等待好友加入…';
    const statusText = (this.busy || !isDefaultWait) ? (this.status || '等待好友加入…')
      : ('等待好友加入' + dots);
    ctx.save();
    ctx.fillStyle = C.textSecondary; ctx.font = TF('body');
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(statusText, W / 2, statusY);
    ctx.restore();

    // 封存 / 解散 / 双方退出保留倒计时（archived|abandoned|bothLeft）
    const statusLine = this._roomStatusLine(viewDoc);
    let bY = statusY + 34;
    if (statusLine) {
      ctx.save();
      ctx.fillStyle = C.warning; ctx.font = TF('caption');
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(statusLine, W / 2, statusY + 24);
      ctx.restore();
      bY = statusY + 44;
    }

    const gap = 10;
    const bw = (cardW - gap) / 2;
    drawBtn(ctx, padX, bY, bw, 50, '邀请好友', 'primary',
      { pressed: this.tap.isPressing('share', Date.now()) });
    this.regions.push({ key: 'share', rect: { x: padX, y: bY, w: bw, h: 50 } });

    drawBtn(ctx, padX + bw + gap, bY, bw, 50, '复制房间码', 'secondary',
      { pressed: this.tap.isPressing('copy', Date.now()) });
    this.regions.push({ key: 'copy', rect: { x: padX + bw + gap, y: bY, w: bw, h: 50 } });

    const cY = bY + 50 + 14;
    drawBtn(ctx, padX, cY, cardW, 46, '取消', 'ghost',
      { pressed: this.tap.isPressing('cancel', Date.now()) });
    this.regions.push({ key: 'cancel', rect: { x: padX, y: cY, w: cardW, h: 46 } });
  }

  _renderJoining(ctx, W, H, nav, contentBottom, L) {
    const padX = 16;
    const cardW = W - padX * 2;
    const top = nav.bottom + 16;

    ctx.save();
    ctx.fillStyle = C.textSecondary; ctx.font = TF('caption');
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('输入好友分享的 6 位房间码', W / 2, top + 8);
    ctx.restore();

    const boxY = top + 30;
    const boxH = 62;
    this._drawCodeBoxes(ctx, padX, boxY, cardW, boxH, this.code || '', false);

    // 错误 / 房间状态提示行：复用同一行显示 archived/abandoned/双方退出，
    // 不额外占用垂直空间，保证 320 窄屏 3×4 键盘仍不越 contentBottom。
    const infoY = boxY + boxH + 14;
    const statusLine = this._roomStatusLine();
    const infoText = statusLine || this.errMsg || (this.busy ? '正在加入房间…' : '房间码由 6 位数字组成');
    ctx.save();
    ctx.fillStyle = this.errMsg ? C.danger : (statusLine ? C.warning : C.textTertiary);
    ctx.font = TF('caption');
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(infoText, W / 2, infoY);
    ctx.restore();

    // 全宽「确认加入」CTA
    const ctaY = infoY + 20;
    const ctaH = 46;
    drawBtn(ctx, padX, ctaY, cardW, ctaH, this.busy ? '加入中…' : '确认加入', 'primary', {
      pressed: this.tap.isPressing('join', Date.now()),
      disabled: this.busy || !isRoomCode(this.code)
    });
    this.regions.push({ key: 'join', rect: { x: padX, y: ctaY, w: cardW, h: ctaH } });

    // 自绘 3×4 数字键盘：0-9 + 删除 + 确认（不用 wx.showKeyboard）
    const kpTop = ctaY + ctaH + 14;
    const availH = contentBottom - 8 - kpTop;
    const kgap = 8;
    const keyH = Math.max(34, Math.min(54, (availH - kgap * 3) / 4));
    const colW = (cardW - kgap * 2) / 3;
    const KEYS = [['1', '2', '3'], ['4', '5', '6'], ['7', '8', '9'], ['del', '0', 'confirm']];
    for (let r = 0; r < 4; r++) {
      for (let c = 0; c < 3; c++) {
        const kx = padX + c * (colW + kgap);
        const ky = kpTop + r * (keyH + kgap);
        const k = KEYS[r][c];
        if (k === 'del') {
          drawBtn(ctx, kx, ky, colW, keyH, '删除', 'ghost',
            { pressed: this.tap.isPressing('del', Date.now()) });
          this.regions.push({ key: 'del', rect: { x: kx, y: ky, w: colW, h: keyH } });
        } else if (k === 'confirm') {
          drawBtn(ctx, kx, ky, colW, keyH, '确认', 'secondary', {
            pressed: this.tap.isPressing('joinKey', Date.now()),
            disabled: this.busy || !isRoomCode(this.code)
          });
          this.regions.push({ key: 'join', rect: { x: kx, y: ky, w: colW, h: keyH } });
        } else {
          drawBtn(ctx, kx, ky, colW, keyH, k, 'secondary',
            { pressed: this.tap.isPressing('d' + k, Date.now()) });
          this.regions.push({ key: 'd' + k, rect: { x: kx, y: ky, w: colW, h: keyH } });
        }
      }
    }
  }

  _renderError(ctx, W, H, nav, contentBottom, L) {
    const padX = 16;
    const cardW = W - padX * 2;
    const top = nav.bottom + 32;
    const cardH = 176;

    panels.drawGroupPanel(ctx, padX, top, cardW, cardH);
    ico(ctx, 'warning', W / 2, top + 46, 40, C.warning);
    ctx.save();
    ctx.fillStyle = C.textPrimary; ctx.font = TF('h2');
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('暂时无法开始', W / 2, top + 92);
    ctx.restore();
    this._centerLines(ctx, this.errMsg || reasonText('unavailable'), W / 2, top + 122,
      cardW - 40, 'caption', C.textSecondary, 3);

    const bY = top + cardH + 28;
    drawBtn(ctx, padX, bY, cardW, 50, '返回菜单', 'primary',
      { pressed: this.tap.isPressing('toMenu', Date.now()) });
    this.regions.push({ key: 'toMenu', rect: { x: padX, y: bY, w: cardW, h: 50 } });
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
    // 通用 confirm 模态（封存残局选择）优先处理；200ms 防穿透由 modal.interactive() 提供。
    if (this.sm && this.sm.modal && this.sm.modal.isOpen() && this.sm.modal.isGeneric()) {
      if (!this.sm.modal.interactive()) return;
      const act = this.sm.modal.hitGeneric(x, y);
      if (act) this.sm.modal.resolveGeneric(act);
      return;
    }
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
    if (key === 'back') {
      if (this.phase === 'hub') this._backFromHub();
      else this._cancelToHub();
      return;
    }
    if (this.phase === 'hub') {
      if (key === 'host') {
        if (!this._probeAvailable()) { this._showUnavailable(); return; }
        this._startHosting();
      } else if (key === 'joinEntry') {
        if (!this._probeAvailable()) { this._showUnavailable(); return; }
        this._gen++;
        this.code = '';
        this.errMsg = '';
        this.busy = false;
        this.phase = 'joining';
      } else if (key === 'rejoin') {
        this._rejoinRoom();
      } else if (key === 'archiveView') {
        this.archiveIndex = 0;
        this._openArchiveModal();
      } else if (key && key.indexOf('games:') === 0) {
        const n = Number(key.slice(6));
        if (GAME_VALUES.indexOf(n) >= 0) {
          this.maxGames = n;
          writeDraft(n);          // wx.setStorageSync 直写，绝不经过 storage 写 hook
        }
      }
      return;
    }
    if (this.phase === 'hosting') {
      if (key === 'share') this._share();
      else if (key === 'copy') this._copy();
      else if (key === 'cancel') this._cancelToHub();
      return;
    }
    if (this.phase === 'joining') {
      if (key === 'del') { this.code = this.code.slice(0, -1); this.errMsg = ''; return; }
      if (key === 'join') { this._confirmJoin(false); return; }
      if (key && key.charAt(0) === 'd' && key.length === 2 && /[0-9]/.test(key.charAt(1))) {
        if (this.code.length < CODE_LEN) { this.code += key.charAt(1); this.errMsg = ''; }
        return;
      }
      return;
    }
    if (this.phase === 'error') {
      if (key === 'toMenu') this._goMenu();
      return;
    }
  }
}

module.exports = RoomScene;
