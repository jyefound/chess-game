/**
 * 音效引擎 · InnerAudioContext（UX §4）
 *
 * 设计要点：
 *  - 订阅 events.js 的同名事件，音画 1:1；事件分发用「对象字面量映射表」，禁止 eval / 拼函数名。
 *  - 预加载池：init() 时对每种资源创建 InnerAudioContext，赋 src 触发预加载；
 *    onCanplay 标记 ready，onError 标记 failed 并静默跳过，绝不阻塞交互。
 *  - obeyMuteSwitch = true 尊重系统静音键；应用内 soundEnabled 为独立开关，二者取「与」。
 *  - 80ms 去重（各事件可配 dedupe 窗口）；播放前 stop() 再 play()；活跃实例软上限 3。
 *  - reduceMotion 不砍音效：音效时长/音量不受 reduceMotion 影响，仅受 setEnabled 控制。
 *  - 资源缺失 / 加载失败一律静默降级，不报错、不影响功能（assets/audio/*.wav 已补齐，正常播放）。
 *
 * 资源现状（Phase 3 第 10 项已补齐）：assets/audio/*.wav 由 tools/gen-audio.js
 *   离线手工构造（Node 内置 fs + WAV/PCM16 头，无外部素材、无 npm 依赖）。
 *   16kHz 单声道 16-bit，单文件≤~14KB。22 条 RES 路径均已落地，src 不再 onError 静默。
 *   v1: tap / select / move / capture / check / win / lose / draw /
 *       tutorial_correct / tutorial_wrong / undo / save / error
 *   v2: hint / coach_say / coach_praise / coach_warn / skill_use / skill_get /
 *       level_clear / level_fail / timer_warn
 *   （navigate / toggle 复用 tap 降音量；levelPass(超时通关)复用 level_clear 降音量，无需单独文件）
 *
 * v2 音画 1:1 映射见 V2_UX_SPEC §8.10：
 *   hint 轻叮 / coachSay 极轻柔和 / coachPraise 清脆上行两音 / coachWarn 柔和下行两音 /
 *   skillUse 短促嗖 / skillGet 上行小和弦 / levelClear 上行和弦(payload 完美/通关) /
 *   levelFail 柔和下行(非刺耳) / timerWarn 单次轻警示(可关)。
 *   全部受 soundEnabled + obeyMuteSwitch 控制；reduceMotion 不砍音效；资源缺失静默降级。
 *
 * D-5（team-lead 拍板）：timerWarn 为「单次触发」——进入 ≤10s 预警区间只响一次，
 *   防止场景层每帧 emit 造成连续催促音（违反 BRAND §6.3 不喧闹）。
 *   闩锁实现：_timerWarnFired；新回合调 resetTimerWarn() 重新武装；payload.force===true 可强制重响。
 *   非循环：InnerAudioContext 不设 loop，单次 play 即止。
 *   仍受 soundEnabled + 系统静音(obeyMuteSwitch) 双重控制；reduceMotion 不影响音效。
 *
 * D-6（team-lead 拍板）：超时计时条可用 danger 砖红但「静态不闪」——属场景层 HUD 视觉，
 *   音频侧无对应事件（不新增催促音），故本模块不涉及。
 */
'use strict';

var events = require('./events');

// 资源表：res -> {src, vol, dedupe(ms)}
var RES = {
  tap:             { src: 'assets/audio/tap.wav',              vol: 0.25, dedupe: 80  },
  select:          { src: 'assets/audio/select.wav',           vol: 0.35, dedupe: 80  },
  move:            { src: 'assets/audio/move.wav',             vol: 0.70, dedupe: 80  },
  capture:         { src: 'assets/audio/capture.wav',          vol: 0.85, dedupe: 80  },
  check:           { src: 'assets/audio/check.wav',            vol: 0.70, dedupe: 200 },
  win:             { src: 'assets/audio/win.wav',              vol: 0.80, dedupe: 300 },
  lose:            { src: 'assets/audio/lose.wav',             vol: 0.70, dedupe: 300 },
  draw:            { src: 'assets/audio/draw.wav',             vol: 0.60, dedupe: 300 },
  tutorialCorrect: { src: 'assets/audio/tutorial_correct.wav', vol: 0.60, dedupe: 200 },
  tutorialWrong:   { src: 'assets/audio/tutorial_wrong.wav',   vol: 0.45, dedupe: 200 },
  undo:            { src: 'assets/audio/undo.wav',             vol: 0.40, dedupe: 150 },
  saveRecord:      { src: 'assets/audio/save.wav',             vol: 0.50, dedupe: 200 },
  uiError:         { src: 'assets/audio/error.wav',            vol: 0.45, dedupe: 200 },
  // ---- v2 新增 9 事件对应资源（V2_UX_SPEC §8.10）----
  hint:            { src: 'assets/audio/hint.wav',             vol: 0.40, dedupe: 200 },
  coachSay:        { src: 'assets/audio/coach_say.wav',        vol: 0.30, dedupe: 300 },
  coachPraise:     { src: 'assets/audio/coach_praise.wav',     vol: 0.50, dedupe: 200 },
  coachWarn:       { src: 'assets/audio/coach_warn.wav',       vol: 0.40, dedupe: 200 },
  skillUse:        { src: 'assets/audio/skill_use.wav',        vol: 0.50, dedupe: 150 },
  skillGet:        { src: 'assets/audio/skill_get.wav',        vol: 0.60, dedupe: 300 },
  levelClear:      { src: 'assets/audio/level_clear.wav',      vol: 0.70, dedupe: 300 },
  levelFail:       { src: 'assets/audio/level_fail.wav',       vol: 0.40, dedupe: 300 },
  timerWarn:       { src: 'assets/audio/timer_warn.wav',       vol: 0.35, dedupe: 1000 }
};

// 事件 -> 资源映射（对象字面量，无 eval）。aiThink 静音 -> null。
var EVENT_TO_RES = {
  tap: 'tap',
  select: 'select',
  move: 'move',
  capture: 'capture',
  check: 'check',
  tutorialCorrect: 'tutorialCorrect',
  tutorialWrong: 'tutorialWrong',
  undo: 'undo',
  saveRecord: 'saveRecord',
  uiError: 'uiError',
  toggle: 'tap',      // 复用 tap 降音量
  navigate: 'tap',    // 复用 tap 降音量
  aiThink: null,      // 静音，无循环音
  // ---- v2 新增 9 事件 ----
  hint: 'hint',
  coachSay: 'coachSay',
  coachPraise: 'coachPraise',
  coachWarn: 'coachWarn',
  skillUse: 'skillUse',
  skillGet: 'skillGet',
  levelClear: 'levelClear',
  levelFail: 'levelFail',
  timerWarn: 'timerWarn'
};

// 运行时状态
var _enabled = true;         // 应用内音效开关（默认开，由 settings.soundEnabled 驱动）
var _inited = false;
var _available = false;      // wx.createInnerAudioContext 是否可用
var _pool = {};              // res -> InnerAudioContext
var _ready = {};             // res -> boolean
var _failed = {};            // res -> boolean
var _playing = {};           // res -> boolean
var _last = {};              // res -> 上次播放时间戳
var _active = 0;             // 活跃实例软计数
var _unsub = [];             // 订阅取消函数
var MAX_ACTIVE = 3;

// D-5：timerWarn「单次触发」闩锁 —— 进入 ≤10s 预警区间后只响一次，
// 防止场景层每帧 emit 造成连续催促音（违反 BRAND §6.3「不喧闹」）。
// 新一局/新关卡开始时调用 resetTimerWarn() 重新武装；payload.force===true 可强制重响。
var _timerWarnFired = false;

function _endHandler(res) {
  return function () {
    if (_playing[res]) { _playing[res] = false; }
    _active = Math.max(0, _active - 1);
  };
}

/**
 * D-7（team-lead 拍板）：触感反馈。仅「吃子 capture」与「将军 check」各触发一次极短震动，
 * 其余克制（不喧闹、不滥用）。无 wx 环境（Node）或 wx.vibrateShort 不存在时静默跳过。
 * 跟随音效总开关 _enabled：关闭音效时一并关闭触感。
 */
function _vibrate() {
  try {
    if (typeof wx !== 'undefined' && typeof wx.vibrateShort === 'function') {
      wx.vibrateShort({ type: 'medium' });
    }
  } catch (e) { /* 静默 */ }
}

/** 事件名 -> {res, vol?}；win 依 payload.outcome 区分胜负音色 */
function _resolve(name, payload) {
  if (name === 'win') {
    var o = payload && payload.outcome;
    if (o === 'loss' || o === 'lose') return { res: 'lose' };
    if (o === 'draw') return { res: 'draw' };
    return { res: 'win' };
  }
  // v2：timerWarn「可关」——payload.enabled===false 时静音（尊重场景层开关）
  if (name === 'timerWarn') {
    if (payload && payload.enabled === false) return null;
    // D-5 单次闩锁：已响过则静音（除非 force / resetTimerWarn 已重新武装）
    if (_timerWarnFired && !(payload && payload.force === true)) return null;
  }
  var res = EVENT_TO_RES[name];
  if (!res) return null;
  if (name === 'toggle' || name === 'navigate') return { res: res, vol: 0.20 };
  // v2：levelClear 依 payload 完美/通关 微调音量（超时通关=偏轻单音感，不喧闹）
  if (name === 'levelClear') {
    var t = payload && (payload.tier || payload.outcome);
    if (t === 'overtime' || t === '通关' || t === 'clear' || t === 'pass') return { res: res, vol: 0.55 };
  }
  return { res: res };
}

/** 播放某资源（含去重、静默降级、软并发上限） */
function _playRes(res, volOverride) {
  if (!_enabled || !_available) return;
  var cfg = RES[res];
  if (!cfg) return;

  var now = Date.now();
  var dedupe = (typeof cfg.dedupe === 'number') ? cfg.dedupe : 80;
  if (now - (_last[res] || 0) < dedupe) return;

  var a = _pool[res];
  // 未就绪 / 加载失败 → 静默跳过，且「不消耗去重槽」，就绪后仍可响应
  if (!a || _failed[res] || !_ready[res]) return;
  // 活跃实例软上限（已在播的本资源允许重触发，不额外占额）
  if (_active >= MAX_ACTIVE && !_playing[res]) return;

  _last[res] = now;
  try {
    a.volume = (typeof volOverride === 'number') ? volOverride : cfg.vol;
    a.stop();
    a.play();
    _playing[res] = true;
    _active++;
  } catch (e) {
    // 静默降级：任何播放异常都不影响游戏
  }
}

/** 统一事件入口（也对外导出，便于手动触发 / 测试） */
function onMotionEvent(name, payload) {
  var r = _resolve(name, payload);
  if (!r) return;                     // aiThink 等静音事件
  // D-7：吃子 / 将军 极短触感（音效开启且 wx 支持时）
  if ((name === 'capture' || name === 'check') && _enabled) _vibrate();
  _playRes(r.res, r.vol);
  // D-5：timerWarn 触发后上闩，后续同回合不再响（单次触发）
  if (name === 'timerWarn') _timerWarnFired = true;
}

/**
 * 重新武装 timerWarn（新一局/新关卡开始时调用）。
 * 配合 D-5 单次触发语义：进入 ≤10s 区间只响一次，跨回合才允许再响。
 */
function resetTimerWarn() {
  _timerWarnFired = false;
}
/** 查询 timerWarn 是否已触发（诊断用） */
function hasTimerWarnFired() { return _timerWarnFired; }

/**
 * 初始化：订阅事件 + 创建预加载池。可重复调用（幂等）。
 * 无 wx 环境（如 Node）时安全降级为「不可用」，不抛错。
 */
function init() {
  if (_inited) return;
  _inited = true;

  var names = ['tap', 'select', 'move', 'capture', 'check', 'win',
               'tutorialCorrect', 'tutorialWrong', 'undo', 'saveRecord',
               'uiError', 'toggle', 'navigate', 'aiThink',
               // v2 新增 9 事件
               'hint', 'coachSay', 'coachPraise', 'coachWarn', 'skillUse',
               'skillGet', 'levelClear', 'levelFail', 'timerWarn'];
  for (var i = 0; i < names.length; i++) {
    (function (n) {
      _unsub.push(events.on(n, function (p) { onMotionEvent(n, p); }));
    })(names[i]);
  }

  try {
    _available = (typeof wx !== 'undefined' && typeof wx.createInnerAudioContext === 'function');
  } catch (e) { _available = false; }

  if (!_available) {
    // 全量静默降级
    Object.keys(RES).forEach(function (res) { _failed[res] = true; });
    return;
  }

  Object.keys(RES).forEach(function (res) {
    try {
      var a = wx.createInnerAudioContext();
      a.obeyMuteSwitch = true;         // 尊重系统静音键
      a.src = RES[res].src;            // 触发预加载；src 缺失时 onError 会静默标记
      a.onCanplay(function () { _ready[res] = true; });
      a.onError(function () { _failed[res] = true; });
      a.onEnded(_endHandler(res));
      a.onStop(_endHandler(res));
      _pool[res] = a;
    } catch (e) {
      _failed[res] = true;
    }
  });
}

/** 应用内音效开关。关闭时立即停止所有播放。 */
function setEnabled(bool) {
  _enabled = !!bool;
  if (!_enabled) stopAll();
}
function isEnabled() { return _enabled; }

/** 停止所有（wx.onHide / 设置关闭时调用，UX §2.4） */
function stopAll() {
  Object.keys(_pool).forEach(function (res) {
    try { _pool[res].stop(); } catch (e) { /* 静默 */ }
    _playing[res] = false;
  });
  _active = 0;
}

/** 释放订阅与实例（测试 / 场景销毁用） */
function dispose() {
  _unsub.forEach(function (fn) { try { fn(); } catch (e) { /* 静默 */ } });
  _unsub = [];
  stopAll();
  Object.keys(_pool).forEach(function (res) {
    try { _pool[res].destroy(); } catch (e) { /* 静默 */ }
  });
  _pool = {}; _ready = {}; _failed = {}; _playing = {}; _last = {};
  _timerWarnFired = false;
  _inited = false;
}

module.exports = {
  init: init,
  setEnabled: setEnabled,
  isEnabled: isEnabled,
  stopAll: stopAll,
  onMotionEvent: onMotionEvent,
  resetTimerWarn: resetTimerWarn,     // D-5：新回合重新武装单次警示音
  hasTimerWarnFired: hasTimerWarnFired,
  dispose: dispose
};
