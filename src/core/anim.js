/**
 * 动画引擎 · 累计 dt 驱动（C4）
 *
 * 设计要点：
 *  - 所有相位/补间用「累计时间」推进，不使用帧计数——AI 分帧期间帧率波动也不会忽快忽慢。
 *  - 时间单位统一为「毫秒」（对齐 config.MOTION）。updateTweens 接收毫秒；
 *    若调用方误传秒（<1），防御性 ×1000。场景建议显式 `dtMs = dt*1000` 并累加成 timeMs。
 *  - reduceMotion：时长 ×0.5，并禁用 pulse / shake / shimmer（只影响视觉，不影响音效）。
 *  - 纯 JS，无 wx / DOM / eval，可在 Node 下单测。
 */
'use strict';

var _reduceMotion = false;
var _tweens = [];

// ---- 缓动函数 ----
/** ease-out cubic：短促、无回弹，符合「克制」基调 */
function easeOut(t) {
  t = clamp01(t);
  return 1 - Math.pow(1 - t, 3);
}
/** ease-in cubic */
function easeIn(t) {
  t = clamp01(t);
  return t * t * t;
}
/** ease-in-out cubic：仅用于落子位移 */
function easeInOut(t) {
  t = clamp01(t);
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

function lerp(a, b, t) { return a + (b - a) * t; }
function clamp01(v) { return v < 0 ? 0 : (v > 1 ? 1 : v); }

// ---- reduceMotion ----
function setReduceMotion(bool) { _reduceMotion = !!bool; }
function getReduceMotion() { return _reduceMotion; }
/** 视觉降级总开关的语义别名：是否禁用脉冲/抖动/光泽 */
function isMotionReduced() { return _reduceMotion; }
/** 生效时长：reduceMotion 时 ×0.5（补遗 A.4.6 / UX §5.2） */
function effectiveDuration(ms) {
  var d = (typeof ms === 'number' && ms > 0) ? ms : 0;
  return _reduceMotion ? d * 0.5 : d;
}

// ---- 补间 ----
/**
 * 对数值或「各字段为数值的对象」插值。
 */
function _interpolate(from, to, t) {
  if (typeof from === 'number') {
    return lerp(from, typeof to === 'number' ? to : from, t);
  }
  if (from && typeof from === 'object') {
    var out = {};
    for (var k in from) {
      if (!Object.prototype.hasOwnProperty.call(from, k)) continue;
      var a = from[k];
      var b = (to && typeof to[k] === 'number') ? to[k] : a;
      out[k] = typeof a === 'number' ? lerp(a, b, t) : a;
    }
    return out;
  }
  return to;
}

/**
 * 创建并注册一个补间。
 * @param {object} opt
 *   - from, to : number | {number...}
 *   - duration : 毫秒（会被 effectiveDuration 处理）
 *   - ease     : 缓动函数，默认 easeOut
 *   - onUpdate(value, t) : 每帧回调，value 为插值结果，t 为 0..1 原始进度
 *   - onComplete()       : 结束回调（仅一次）
 * @returns {object} tween 句柄，含 cancel()。
 */
function createTween(opt) {
  opt = opt || {};
  var tw = {
    from: opt.from !== undefined ? opt.from : 0,
    to: opt.to !== undefined ? opt.to : 1,
    duration: Math.max(1, effectiveDuration(opt.duration || 200)),
    ease: typeof opt.ease === 'function' ? opt.ease : easeOut,
    onUpdate: opt.onUpdate,
    onComplete: opt.onComplete,
    elapsed: 0,
    done: false,
    cancelled: false,
    cancel: function () { this.cancelled = true; this.done = true; }
  };
  // low-end 保护：并发补间过多时，最早的补间直接判定完成（改为瞬时，UX §5.3）
  if (_tweens.length >= 2) {
    var oldest = _tweens.shift();
    try {
      if (oldest && oldest.onUpdate) oldest.onUpdate(_interpolate(oldest.from, oldest.to, 1), 1);
      if (oldest && oldest.onComplete) oldest.onComplete();
    } catch (e) { /* 静默 */ }
  }
  _tweens.push(tw);
  return tw;
}

/**
 * 推进所有补间。
 * @param {number} dtMs 毫秒增量（累计 dt）。传入 <1 视为「秒」自动 ×1000。
 */
function updateTweens(dtMs) {
  var dt = (typeof dtMs === 'number' && dtMs > 0) ? dtMs : 0;
  if (dt > 0 && dt < 1) dt = dt * 1000; // 防御：调用方传的是秒
  for (var i = _tweens.length - 1; i >= 0; i--) {
    var tw = _tweens[i];
    if (tw.cancelled) { _tweens.splice(i, 1); continue; }
    tw.elapsed += dt;
    var t = clamp01(tw.elapsed / tw.duration);
    var e = tw.ease(t);
    var val = _interpolate(tw.from, tw.to, e);
    if (tw.onUpdate) {
      try { tw.onUpdate(val, t); } catch (err) { /* 静默 */ }
    }
    if (t >= 1) {
      tw.done = true;
      _tweens.splice(i, 1);
      if (tw.onComplete) {
        try { tw.onComplete(); } catch (err2) { /* 静默 */ }
      }
    }
  }
}

/** 清空所有补间（场景切换 / onHide 用） */
function clearTweens() {
  _tweens.length = 0;
}
function getTweenCount() { return _tweens.length; }

// ---- 视觉降级辅助：脉冲 / 抖动（供 board.js 与场景复用） ----
/**
 * 归一化脉冲因子 0..1（基于累计时间，非帧计数）。
 * reduceMotion 时返回常量 0.5（静态），供调用方映射成 alpha。
 * @param {number} timeMs 累计毫秒
 * @param {number} periodMs 周期，默认 600（补遗 A.3 揭晓/将军脉冲 300×2）
 */
function pulse01(timeMs, periodMs) {
  if (_reduceMotion) return 0.5;
  var tm = (typeof timeMs === 'number') ? timeMs : 0;
  var p = (typeof periodMs === 'number' && periodMs > 0) ? periodMs : 600;
  return 0.5 - 0.5 * Math.cos(2 * Math.PI * (tm % p) / p); // 0→1→0
}

/**
 * 揭晓金环 / 将军红脉冲的 alpha：.35↔.75 振荡；
 * 若传入 startMs 且超过 2 个周期（600ms），收敛为静态 .5（补遗 A.3）。
 * reduceMotion 时恒返回 .5。
 */
function revealPulseAlpha(timeMs, startMs) {
  if (_reduceMotion) return 0.5;
  if (typeof startMs !== 'number') return 0.35 + 0.4 * pulse01(timeMs, 300);
  var elapsed = timeMs - startMs;
  if (elapsed >= 600) return 0.5;
  return 0.35 + 0.4 * pulse01(elapsed, 300);
}

/**
 * 教学错误水平抖动位移：±amplitude，线性，共 2 次（180ms×2=360ms）。
 * reduceMotion 时恒返回 0（禁用抖动，UX §5.2）。
 */
function shakeOffset(timeMs, startMs, amplitude) {
  if (_reduceMotion) return 0;
  var amp = (typeof amplitude === 'number') ? amplitude : 6;
  var tm = (typeof timeMs === 'number') ? timeMs : 0;
  var st = (typeof startMs === 'number') ? startMs : 0;
  var elapsed = tm - st;
  if (elapsed < 0 || elapsed >= 360) return 0;
  // 每 90ms 换向一次，2 个完整来回
  var seg = Math.floor(elapsed / 90) % 4;
  return (seg === 0 || seg === 3) ? -amp : amp;
}

module.exports = {
  easeOut: easeOut,
  easeIn: easeIn,
  easeInOut: easeInOut,
  lerp: lerp,
  clamp01: clamp01,
  createTween: createTween,
  updateTweens: updateTweens,
  clearTweens: clearTweens,
  getTweenCount: getTweenCount,
  setReduceMotion: setReduceMotion,
  getReduceMotion: getReduceMotion,
  isMotionReduced: isMotionReduced,
  effectiveDuration: effectiveDuration,
  pulse01: pulse01,
  revealPulseAlpha: revealPulseAlpha,
  shakeOffset: shakeOffset
};
