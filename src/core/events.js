/**
 * 轻量事件总线 · 音画 1:1 同步的纽带
 *
 * 视觉侧在状态变化处 `emit(name, payload)`，音频侧（audio.js）订阅同名事件。
 * 事件名固定，禁止 eval / 字符串拼函数名。所有监听回调以 try/catch 包裹，
 * 单个监听器异常不影响其它监听器与游戏主流程。
 *
 * 事件名（UX §4.1/§4.2 + V2_UX_SPEC §8.10）：
 *   v1: tap / select / move / capture / check / win / tutorialCorrect / tutorialWrong
 *       undo / saveRecord / uiError / toggle / navigate / aiThink
 *   v2: hint / coachSay / coachPraise / coachWarn / skillUse / skillGet /
 *       levelClear / levelFail / timerWarn
 *
 * 说明：on/emit 本身不限名（任意字符串均可，便于扩展）；EVENT_NAMES 仅为「白名单文档 +
 * 自检」用途，audio.init() 订阅这批事件。新事件请同时登记到 EVENT_NAMES 与 audio EVENT_TO_RES。
 */
'use strict';

// 事件名白名单（文档 + 自检；音频侧订阅此批）。纯数组，无 eval。
var EVENT_NAMES = [
  'tap', 'select', 'move', 'capture', 'check', 'win', 'tutorialCorrect', 'tutorialWrong',
  'undo', 'saveRecord', 'uiError', 'toggle', 'navigate', 'aiThink',
  'hint', 'coachSay', 'coachPraise', 'coachWarn', 'skillUse', 'skillGet',
  'levelClear', 'levelFail', 'timerWarn'
];

// name -> Array<fn>；普通对象字面量，无 eval
var _listeners = {};

/**
 * 订阅事件。
 * @returns {function} 取消订阅函数（便于一次性解绑）
 */
function on(name, fn) {
  if (typeof name !== 'string' || typeof fn !== 'function') return function () {};
  if (!_listeners[name]) _listeners[name] = [];
  _listeners[name].push(fn);
  return function () { off(name, fn); };
}

/**
 * 取消订阅。不传 fn 则清空该事件所有监听。
 */
function off(name, fn) {
  if (typeof name !== 'string') return;
  if (typeof fn !== 'function') {
    delete _listeners[name];
    return;
  }
  var arr = _listeners[name];
  if (!arr) return;
  var i = arr.indexOf(fn);
  if (i >= 0) arr.splice(i, 1);
  if (arr.length === 0) delete _listeners[name];
}

/**
 * 发布事件。用快照遍历，允许回调内增删监听；逐个 try/catch 隔离。
 */
function emit(name, payload) {
  if (typeof name !== 'string') return;
  var arr = _listeners[name];
  if (!arr || arr.length === 0) return;
  var snap = arr.slice();
  for (var i = 0; i < snap.length; i++) {
    try {
      snap[i](payload);
    } catch (e) {
      // 静默：不让音频或某个监听拖垮主流程；可在宿主环境按需 console.warn
    }
  }
}

/** 一次性订阅 */
function once(name, fn) {
  var wrapper = function (p) {
    off(name, wrapper);
    fn(p);
  };
  return on(name, wrapper);
}

/** 清空所有监听（测试 / 场景重置用） */
function clear() {
  _listeners = {};
}

/** 调试：返回某事件监听数量 */
function listenerCount(name) {
  return _listeners[name] ? _listeners[name].length : 0;
}

/** 是否在白名单内（供场景层自检 / 兜底；不在白名单仍可 emit，仅提示） */
function isKnown(name) {
  return EVENT_NAMES.indexOf(name) >= 0;
}
function getEventNames() {
  return EVENT_NAMES.slice();
}

module.exports = {
  on: on,
  off: off,
  emit: emit,
  once: once,
  clear: clear,
  listenerCount: listenerCount,
  EVENT_NAMES: EVENT_NAMES,
  isKnown: isKnown,
  getEventNames: getEventNames
};
