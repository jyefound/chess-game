/**
 * 隐私授权状态机 · 云同步前置门控（v3）
 *
 * 合规硬要求：云同步只能在「用户已授权 且 云端可用」后发生，绝不「先同步、后补授权」。
 * sync.js 的 start()/flush() 会惰性 require('./privacy') 并调用 canSync()；取不到本模块、
 * 或 canSync() 为 false 时一律零云调用（不 pull / 不 push / 不 init 追踪）。
 *
 * 微信小游戏无 wxml 组件系统（<button open-type> 不可用），授权一律走官方
 * wx.getPrivacySetting → wx.requirePrivacyAuthorize 系统弹窗；openContract 走
 * wx.openPrivacyContract。不弹任何自定义授权 UI，不收集 / 存储任何个人信息。
 *
 * 状态机：UNKNOWN → NEED → GRANTED / DENIED；refresh() 可重复进入 NEED
 * （用户删除小程序会清空微信侧授权、公众平台新增收集类型也会重新需要）。
 *
 * 基础库降级：无 wx / 无 getPrivacySetting / 无 requirePrivacyAuthorize
 * （旧基础库、Node 回归）→ 视为 GRANTED（无隐私检查机制，等同放行），但 canSync()
 * 仍叠加 cloud.isEnabled() 门控 —— 没配 env 时永远不同步。这是六套 Node 回归全绿的关键。
 *
 * 持久化 STORAGE_KEYS.privacy 内容「只允许」{state, updatedAt, cloudSyncEnabled}，
 * 绝不含 openid / 头像 / 昵称 / 任何个人信息。顶层不调用任何 wx 接口。
 */
'use strict';

var config = require('../config');
var storage = require('./storage');
var cloud = require('./cloud');

var KEYS = config.STORAGE_KEYS;

var STATE = {
  UNKNOWN: 'unknown',
  NEED: 'need',
  GRANTED: 'granted',
  DENIED: 'denied'
};

// 用户可控的云同步总开关默认值。选「默认开」= 授权且云端可用即同步，用户可在设置页随时关闭。
// 安全性：canSync() 已叠加 cloud.isEnabled() 硬门控，默认开不会在云端未配置时产生任何云调用。
var DEFAULT_CLOUD_SYNC_ENABLED = true;

// ---- 模块内部状态（顶层绝不触碰 wx）----
var _state = STATE.UNKNOWN;
var _cloudSyncEnabled = DEFAULT_CLOUD_SYNC_ENABLED;
var _loaded = false;

function _validState(s) {
  return s === STATE.UNKNOWN || s === STATE.NEED || s === STATE.GRANTED || s === STATE.DENIED;
}

/** 隐私接口能力探测（惰性、每次实时判断，便于测试在 require 后替换 wx mock）。 */
function _hasPrivacyApi() {
  return (typeof wx !== 'undefined' &&
          typeof wx.getPrivacySetting === 'function' &&
          typeof wx.requirePrivacyAuthorize === 'function');
}

/**
 * 惰性加载持久化态（仅首次）。无 wx 环境静默降级；读损坏按默认处理。
 * 关键：无隐私接口且无有效持久化态时，基础库降级为 GRANTED —— 保证
 * 「require 后直接 getState()/canSync()」在 Node 回归里也表现正确（不依赖 init 先跑）。
 */
function _load() {
  if (_loaded) return;
  _loaded = true;
  var persisted = false;
  try {
    var r = storage._readJSON(KEYS.privacy);
    if (r && r.ok && r.value && typeof r.value === 'object' && !Array.isArray(r.value)) {
      if (_validState(r.value.state)) { _state = r.value.state; persisted = true; }
      if (typeof r.value.cloudSyncEnabled === 'boolean') _cloudSyncEnabled = r.value.cloudSyncEnabled;
    }
  } catch (e) { /* 静默降级 */ }
  if (!persisted && !_hasPrivacyApi() && _state === STATE.UNKNOWN) {
    _state = STATE.GRANTED;   // 旧基础库 / Node：等同放行
  }
}

/** 持久化：内容「只允许」这三个键，绝不写入任何个人信息。try/catch 静默降级。 */
function _persist() {
  try {
    storage._writeJSON(KEYS.privacy, {
      state: _state,
      updatedAt: Date.now(),
      cloudSyncEnabled: _cloudSyncEnabled
    });
  } catch (e) { /* 静默降级 */ }
}

function _setState(s) {
  _state = s;
  _persist();
}

/** 删除本地隐私态（控制键，走 storage 内部 API，兼容无 wx 的内存回退）。 */
function _removePersisted() {
  try { storage._rawRemove(KEYS.privacy); } catch (e) { /* 静默降级 */ }
}

/**
 * 查询微信侧授权态并按需拉起官方弹窗，返回 Promise<state>。
 *  - needAuthorization === false → GRANTED
 *  - === true → 先置 NEED，再 requirePrivacyAuthorize：success→GRANTED / fail→DENIED
 *  - 查询失败 / 弹窗异常 → NEED 或 DENIED（均为不可同步的安全默认，可 refresh 重试）
 *  - 无隐私接口（基础库降级）→ GRANTED，立即决议（不依赖任何 wx 回调，Node 回归全绿关键）
 */
function _query() {
  _load();
  return new Promise(function (resolve) {
    var settled = false;
    function finish(s) {
      if (settled) return;
      settled = true;
      _setState(s);
      resolve(_state);
    }
    if (!_hasPrivacyApi()) {
      finish(STATE.GRANTED);            // 基础库降级：无检查机制，等同放行
      return;
    }
    try {
      wx.getPrivacySetting({
        success: function (res) {
          if (!(res && res.needAuthorization)) { finish(STATE.GRANTED); return; }
          _setState(STATE.NEED);        // 记录「需要授权」中间态（可重复进入）
          try {
            wx.requirePrivacyAuthorize({
              success: function () { finish(STATE.GRANTED); },
              fail: function () { finish(STATE.DENIED); }
            });
          } catch (e) { finish(STATE.DENIED); }   // 弹窗异常 → 安全默认拒绝
        },
        fail: function () { finish(STATE.NEED); }  // 无法确认 → NEED（零云调用，可重试）
      });
    } catch (e) {
      finish(STATE.NEED);
    }
  });
}

/** 冷启动：查询授权态 → 持久化 → 决议。不弹自定义 UI、不阻断调用方。 */
function init() {
  return _query();
}

/** onShow / 设置页「重新授权」：重新查询并按需弹窗（支持 GRANTED→NEED→... 重入）。 */
function refresh() {
  return _query();
}

function getState() {
  _load();
  return _state;
}

/**
 * 云同步唯一门控：state===GRANTED && 用户开关 && cloud.isEnabled()。
 * DENIED / NEED / UNKNOWN 一律 false（零云调用）；cloud 未配置 env 时也永远 false。
 */
function canSync() {
  _load();
  try {
    if (_state !== STATE.GRANTED) return false;
    if (!_cloudSyncEnabled) return false;
    return !!cloud.isEnabled();
  } catch (e) { return false; }
}

function isCloudSyncEnabled() {
  _load();
  return !!_cloudSyncEnabled;
}

/** 用户可控开关，持久化；返回设置后的布尔值。 */
function setCloudSyncEnabled(v) {
  _load();
  _cloudSyncEnabled = !!v;
  _persist();
  return _cloudSyncEnabled;
}

/**
 * 打开隐私保护指引（官方页面）。可选 onFail 回调：能力缺失 / 平台侧 fail / 抛异常时调用，
 * 供调用方回退到「本地 8 段通用隐私声明」弹窗（官方要求先发布指引，未发布时
 * openPrivacyContract 走 fail；此前空 fail 回调 + 无条件 return true 会让降级弹窗永不可达）。
 * 返回值语义：true = 已向官方接口发起（success 或异步 fail 均如此）；false = 能力缺失或未发起。
 * 全程 try/catch；onFail 自身再包 try/catch，其抛错绝不影响主流程；notified 去重至多触发一次。
 */
function openContract(onFail) {
  var notified = false;
  function safeFail() {
    if (notified) return;
    notified = true;
    if (typeof onFail === 'function') {
      try { onFail(); } catch (e) { /* 回调抛错不影响主流程 */ }
    }
  }
  try {
    if (typeof wx === 'undefined' || typeof wx.openPrivacyContract !== 'function') {
      safeFail();
      return false;
    }
    wx.openPrivacyContract({
      success: function () {},
      fail: function () { safeFail(); }   // 平台侧失败（含未发布指引）→ 触发本地降级弹窗
    });
    return true;
  } catch (e) {
    safeFail();
    return false;
  }
}

/**
 * 用户撤回授权 / 删除数据：重置为 UNKNOWN、关闭同步、删除本地隐私态。
 * 之后可再次 init()/refresh() 重入状态机。绝不触碰云端资源。
 * @returns {boolean} 是否成功
 */
function clearAll() {
  try {
    _state = STATE.UNKNOWN;
    _cloudSyncEnabled = false;
    _loaded = true;
    _removePersisted();
    return true;
  } catch (e) { return false; }
}

/** 测试用：清内存态 + 删除本地隐私态，回到未初始化（可重新 init）。 */
function reset() {
  _state = STATE.UNKNOWN;
  _cloudSyncEnabled = DEFAULT_CLOUD_SYNC_ENABLED;
  _loaded = false;
  _removePersisted();
}

module.exports = {
  STATE: STATE,
  init: init,
  getState: getState,
  refresh: refresh,
  canSync: canSync,
  isCloudSyncEnabled: isCloudSyncEnabled,
  setCloudSyncEnabled: setCloudSyncEnabled,
  openContract: openContract,
  clearAll: clearAll,
  reset: reset
};
