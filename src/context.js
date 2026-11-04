/**
 * 全局游戏上下文（微信小游戏无 getApp()，用此模块共享状态与服务）
 * 提供：场景栈导航、模态/Banner、设置读写与副作用应用、事件转发。
 *
 * 说明：storage/audio/anim/events 由 fe-render 并行交付，此处按需 lazy require + try/catch，
 * 保证任一模块暂缺时游戏逻辑不崩溃（降级为内存态 / 静默）。
 */
const M = require('./scenes/manager');

const DEFAULT_SETTINGS = {
  soundEnabled: true,       // 音效开关（默认开）
  reduceMotion: false,      // 减弱动效（默认关）
  fontSize: 'standard',     // 字号：'standard' | 'large'（对齐 config.DEFAULT_SETTINGS）
  showLegalMoves: true,     // 显示合法走法（默认开）
  showCoordinates: true,    // 显示坐标（默认开）
  defaultColor: 'w',        // 默认执棋色（白）
  skipSetup: false,         // 跳过开局设置（默认关）
  autoSaveGame: true,       // 结算自动保存（默认开）
  autoPrune: false,         // 满额自动清理
  theme: 'dark'             // 本期仅 dark；light 置灰「即将推出」
};

function lazyRequire(path) {
  try { return require(path); } catch (e) { return null; }
}

const GameContext = {
  gameInstance: null,
  _settings: null,

  set(instance) { this.gameInstance = instance; },
  get() { return this.gameInstance; },
  getSceneManager() { return this.gameInstance ? this.gameInstance.sceneManager : null; },
  theme: M.theme,

  // ---------- 导航（场景栈）----------
  switchScene(name, params) { const sm = this.getSceneManager(); if (sm) sm.switchTo(name, params); },
  pushScene(name, params) { const sm = this.getSceneManager(); if (sm) sm.push(name, params); },
  popScene() { const sm = this.getSceneManager(); if (sm) sm.pop(); },
  popToRoot() { const sm = this.getSceneManager(); if (sm) sm.popToRoot(); },
  replaceScene(name, params) { const sm = this.getSceneManager(); if (sm) sm.replace(name, params); },

  // ---------- 模态 / Banner ----------
  modal() { const sm = this.getSceneManager(); return sm ? sm.modal : null; },
  banner() { const sm = this.getSceneManager(); return sm ? sm.banner : null; },
  openModal(key, payload) {
    const sm = this.getSceneManager();
    if (!sm) return;
    sm.modal.open(key, payload);
    // 打开模态即清除当前场景按下态，避免同一次手势穿透到新出现的按钮
    if (sm.currentScene && sm.currentScene.clearTouch) {
      try { sm.currentScene.clearTouch(); } catch (e) { /* noop */ }
    }
  },
  closeModal() { const sm = this.getSceneManager(); if (sm) sm.modal.close(); },
  showBanner(text, type) { const sm = this.getSceneManager(); if (sm) sm.banner.show(text, type); },

  // ---------- 事件（只 emit，不直接碰 audio）----------
  emit(name, payload) {
    const events = lazyRequire('./core/events');
    if (events && typeof events.emit === 'function') {
      try { events.emit(name, payload); } catch (e) { /* 音效降级静默 */ }
    }
  },

  // ---------- 设置 ----------
  getSettings() {
    if (!this._settings) {
      let loaded = null;
      // 优先以 config.DEFAULT_SETTINGS 为权威默认，再叠加 storage 读回值
      let base = DEFAULT_SETTINGS;
      try { const config = require('./config'); if (config && config.DEFAULT_SETTINGS) base = config.DEFAULT_SETTINGS; } catch (e) { /* noop */ }
      const storage = lazyRequire('./core/storage');
      if (storage && typeof storage.getSettings === 'function') {
        try { loaded = storage.getSettings(); } catch (e) { loaded = null; }
      }
      this._settings = Object.assign({}, base, DEFAULT_SETTINGS, (loaded && typeof loaded === 'object') ? loaded : {});
    }
    return this._settings;
  },

  /**
   * 合并补丁、持久化、应用副作用（第二轮审查 P1-13）。
   * 持久化失败时**回滚内存态并恢复副作用**，避免开关停在「已开启」但磁盘未写入的假状态；
   * 返回 boolean 供设置页 / 对局抽屉给出 danger Banner。
   */
  saveSettings(patch) {
    const prev = Object.assign({}, this.getSettings());
    const next = Object.assign({}, prev, patch || {});
    this._settings = next;
    const storage = lazyRequire('./core/storage');
    let failed = false;
    if (storage && typeof storage.saveSettings === 'function') {
      try {
        const r = storage.saveSettings(next);
        if (r === false || (r && typeof r === 'object' && r.ok === false)) failed = true;
      } catch (e) { failed = true; }
    }
    if (failed) {
      this._settings = prev;          // 回滚：内存态与磁盘保持一致
      this.applySettings(prev);       // 同时恢复字号 / 音效 / 动效等副作用
      return false;
    }
    this.applySettings(next);
    return true;
  },

  /** 应用设置到 audio / anim / 主题字号 / Banner / 场景，并同步 SceneManager.reduceMotion */
  applySettings(settings) {
    const s = settings || this.getSettings();
    const audio = lazyRequire('./core/audio');
    if (audio && typeof audio.setEnabled === 'function') { try { audio.setEnabled(!!s.soundEnabled); } catch (e) { /* noop */ } }
    const anim = lazyRequire('./core/anim');
    if (anim && typeof anim.setReduceMotion === 'function') { try { anim.setReduceMotion(!!s.reduceMotion); } catch (e) { /* noop */ } }
    // 字号：设置项「大」(1.125) 与系统字号缩放（wx.fontSizeSetting → clamp(fs/16,1,1.25)）取较大值，
    // 让系统「大字号」真正驱动 theme.font（此前 getFontScale 在 src 内无调用方）。
    const config = lazyRequire('./config');
    const sysScale = (config && typeof config.getFontScale === 'function') ? config.getFontScale() : 1;
    const prefScale = s.fontSize === 'large' ? 1.125 : (s.fontLarge ? 1.125 : 1);
    M.theme.setFontScale(Math.max(prefScale, sysScale));
    const sm = this.getSceneManager();
    if (sm) {
      sm.reduceMotion = !!s.reduceMotion;
      if (sm.banner) sm.banner.reduceMotion = !!s.reduceMotion;
    }
  },

  /** 启动加载：读设置 + 应用（game.js 入口调用） */
  loadSettings() {
    const s = this.getSettings();
    this.applySettings(s);
    return s;
  },

  // ---------- 存储（统一 try/catch + 安全默认值）----------
  _storage() { return lazyRequire('./core/storage'); },
  // 读：返回值，缺失/异常/空则回退到 fallback
  _call(fn, fallback) {
    const st = this._storage();
    if (!st || typeof st[fn] !== 'function') return fallback;
    try { const r = st[fn].apply(st, Array.prototype.slice.call(arguments, 2)); return r == null ? fallback : r; }
    catch (e) { return fallback; }
  },
  // 写：storage 统一返回 {ok:boolean,...}；兼容旧实现返回 undefined / false。
  // 归一化：函数缺失或抛异常 → false；显式 false 或 {ok:false} → false；其余 → true。
  _write(fn) {
    const st = this._storage();
    if (!st || typeof st[fn] !== 'function') return false;
    try {
      const r = st[fn].apply(st, Array.prototype.slice.call(arguments, 1));
      if (r === false) return false;
      if (r && typeof r === 'object' && 'ok' in r) return r.ok !== false;
      return true; // undefined / 其它真值：视为成功（兼容旧实现）
    } catch (e) { return false; }
  },
  listRecords() { const r = this._call('listRecords', []); return Array.isArray(r) ? r : []; },
  getRecord(id) { return this._call('getRecord', null, id); },
  // saveRecord 需要区分 reason（full / write_failed）与附带信息（rebuilt/pruned/truncated），
  // 直接返回 storage 的完整结果对象；函数缺失/异常时合成一个统一失败对象。
  saveRecord(rec, opts) {
    const st = this._storage();
    if (!st || typeof st.saveRecord !== 'function') return { ok: false, reason: 'write_failed' };
    try {
      const r = st.saveRecord(rec, opts || undefined);
      if (r && typeof r === 'object') return r;
      return { ok: r !== false };
    } catch (e) { return { ok: false, reason: 'write_failed' }; }
  },
  deleteRecord(id) { return this._write('deleteRecord', id); },
  clearAllRecords() { return this._write('clearAllRecords'); },
  getTutorialProgress() {
    const r = this._call('getTutorialProgress', null);
    return (r && Array.isArray(r.completed)) ? r : { version: 1, completed: [], lastLesson: 0 };
  },
  saveTutorialProgress(p) { return this._write('saveTutorialProgress', p); },
  getLastConfig() { return this._call('getLastConfig', null); },
  saveLastConfig(c) { return this._write('saveLastConfig', c); },
  saveResume(r) { return this._write('saveResume', r); },
  getResume() { return this._call('getResume', null); },
  clearResume() { return this._write('clearResume'); }
};

module.exports = GameContext;
