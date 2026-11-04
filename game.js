/**
 * 国际象棋微信小游戏 - 入口文件（墨金棋院 · Ink & Brass）
 * 支持：基础教学(S4) / 人机对战(S2→S3) / 双人对弈(S3) / 棋谱(S5) / 回放(S6) / 设置(S7)
 *
 * 职责：
 *  - 创建主 Canvas + 高清适配（dpr）。
 *  - audio.init() 订阅事件总线（幂等）；读设置后应用 setEnabled / setReduceMotion / 字号。
 *  - 注册全部场景，SceneManager 管理场景栈 / 模态 / Banner / 触摸防误触。
 *  - 主循环：clear → update(dt秒) → render；触摸事件分发给 SceneManager。
 *  - wx.onHide 停止音效；wx.onShow 触发断点恢复（P2，resume）。
 */
const SceneManager = require('./src/scenes/manager');
const MenuScene = require('./src/scenes/menu');
const SetupScene = require('./src/scenes/setup');
const GameplayScene = require('./src/scenes/gameplay');
const TeachingScene = require('./src/scenes/teaching');
const RecordsScene = require('./src/scenes/records');
const ReplayScene = require('./src/scenes/replay');
const SettingsScene = require('./src/scenes/settings');
const AcademyScene = require('./src/scenes/academy');
const EndgameMapScene = require('./src/scenes/endgameMap');
const EndgameScene = require('./src/scenes/endgame');
const GameContext = require('./src/context');
const config = require('./src/config');

// ---- 可选模块（fe-render 交付；缺失时静默降级，不崩）----
function lazyRequire(path) { try { return require(path); } catch (e) { return null; } }
const audio = lazyRequire('./src/core/audio');
const anim = lazyRequire('./src/core/anim');
const layout = lazyRequire('./src/core/layout');

// ---- 隐私授权状态机 + 云同步接线（v3；均为可选模块，缺失时静默降级）----
// 三者均不在模块加载期触碰 wx / 云能力：privacy/cloud 的能力探测全部惰性（函数内），
// sync 经 privacy.canSync() 门控，cloud 由 sync/privacy 间接引入。加载期零云调用。
const privacy = lazyRequire('./src/core/privacy');
const cloud = lazyRequire('./src/core/cloud');
const sync = lazyRequire('./src/core/sync');

// ---- 创建主画布（微信小游戏第一次调用返回主 Canvas）----
const canvas = wx.createCanvas();
const ctx = canvas.getContext('2d');

// ---- 屏幕尺寸 + 高清适配 ----
const sysInfo = wx.getSystemInfoSync();
const screenWidth = sysInfo.windowWidth;
const screenHeight = sysInfo.windowHeight;
const dpr = sysInfo.pixelRatio || 1;
canvas.width = Math.round(screenWidth * dpr);
canvas.height = Math.round(screenHeight * dpr);
ctx.scale(dpr, dpr);

// ---- 安全区布局度量（fe-render layout.js；缺失时懒初始化兜底）----
if (layout && typeof layout.init === 'function') { try { layout.init(sysInfo); } catch (e) { /* noop */ } }

// ---- 游戏主对象 + 全局上下文 ----
const gameInstance = {
  canvas, ctx,
  screenWidth, screenHeight,
  sceneManager: null
};
GameContext.set(gameInstance);
// 设置页开启云同步开关 / 重新授权后的主动 pull 接线点（requestCloudPull 为函数声明，提升可用）。
GameContext.requestCloudPull = requestCloudPull;

// ---- 音频：入口 init() 一次（订阅事件总线 + 预加载池）----
if (audio && typeof audio.init === 'function') { try { audio.init(); } catch (e) { /* 静默降级 */ } }

// ---- 场景管理器 + 注册全部场景 ----
const sceneManager = new SceneManager(ctx, screenWidth, screenHeight);
gameInstance.sceneManager = sceneManager;
sceneManager.register('menu', new MenuScene());
sceneManager.register('setup', new SetupScene());
sceneManager.register('gameplay', new GameplayScene());
sceneManager.register('teaching', new TeachingScene());
sceneManager.register('records', new RecordsScene());
sceneManager.register('replay', new ReplayScene());
sceneManager.register('settings', new SettingsScene());
sceneManager.register('academy', new AcademyScene());
sceneManager.register('endgameMap', new EndgameMapScene());
sceneManager.register('endgame', new EndgameScene());

// ---- 读设置并应用副作用（setEnabled / setReduceMotion / 字号 / SceneManager.reduceMotion）----
GameContext.loadSettings();

// ---- 系统字号接入：wx.fontSizeSetting 真正驱动 theme.font（与设置项取较大值，只升不降）----
// theme.setFontScale 只影响 body/h1/h2/subtitle/caption/san；micro/button/coordinate 保持不变。
if (config && typeof config.getFontScale === 'function') {
  try {
    const sysScale = config.getFontScale();
    if (sysScale > (SceneManager.theme.fontScale || 1)) SceneManager.theme.setFontScale(sysScale);
  } catch (e) { /* 静默降级 */ }
}

// ---- 隐私授权 + 云同步启动接线（微信官方 wx.requirePrivacyAuthorize 系统弹窗）----
// 合规硬要求：云同步只能在「用户已授权(privacy.canSync) 且云端可用(cloud.isEnabled)」后发生，
// 绝不「先同步、后补授权」。privacy.init() 异步、不 await、不阻塞下方 switchTo('menu')；
// sync.init()/sync.start() 严格排在 privacy.init() 决议之后（.then 里）。
// 小游戏无 wxml 组件系统，授权一律用微信官方系统弹窗，不弹自定义授权 UI。
function _warn(tag, err) {
  // 只打 tag + 归一化短串，绝不回显原始异常对象（可能夹带 openid/昵称/env/value）。
  try { console.warn(tag, String((err && err.message) || 'unknown').slice(0, 80)); } catch (e) {}
}

// onShow 轻量触发节流：避免冷启动 / 频繁前后台切换每次都触发 refresh + flush。
let lastCloudSyncAt = 0;
const CLOUD_SYNC_MIN_GAP_MS = 30 * 1000;

// 是否已做过一次全量 pull 尝试。not_authorized / disabled 时保持 false，
// 待授权或云端配置就绪后由 onShow / 设置页补做，避免「授权晚于冷启动 → 本会话永不拉云」。
var _cloudPullDone = false;

/** 云回填后通知当前场景刷新缓存的进度字段；只调 onDataChanged，不 re-enter / 不 switchTo。 */
function notifySceneDataChanged() {
  try {
    var sc = sceneManager && sceneManager.currentScene;
    if (sc && typeof sc.onDataChanged === 'function') sc.onDataChanged();
  } catch (e) { /* 静默 */ }
}

/** 设置页开启云同步开关 / 重新授权后的主动 pull：canSync 门控 + 一次全量 pull + 成功后刷新场景。 */
function requestCloudPull() {
  try {
    if (!privacy || typeof privacy.canSync !== 'function' || !privacy.canSync()) return;  // DENIED/未启用 → 零云调用
    if (!sync || typeof sync.start !== 'function') return;
    let r = null;
    try { r = sync.start(); } catch (e) { _warn('[sync.start]', e); return; }
    if (r && typeof r.then === 'function') {
      r.then(function (res) {
        var reason = res && res.reason;
        if (reason !== 'not_authorized' && reason !== 'disabled') _cloudPullDone = true;
        if (res && res.ok) notifySceneDataChanged();
      }, function (e) { _warn('[sync.start]', e); });
    } else {
      _cloudPullDone = true;   // 非 Promise 防御：按已尝试处理
    }
  } catch (e) { _warn('[requestCloudPull]', e); }
}

/** 冷启动首次同步：注册写 hook + 首次 pull→merge→回填→flush（仅在授权决议后调用）。 */
function kickoffCloudSync() {
  lastCloudSyncAt = Date.now();     // 抑制紧随其后的冷启动 onShow 重复触发
  if (!sync || typeof sync.init !== 'function' || typeof sync.start !== 'function') return;
  try { sync.init(); } catch (e) { _warn('[sync.init]', e); }
  let r = null;
  try { r = sync.start(); } catch (e) { _warn('[sync.start]', e); return; }
  if (r && typeof r.then === 'function') {
    r.then(function (res) {
      var reason = res && res.reason;
      // 非「未授权/未启用」都算已尝试过 pull，避免 onShow 无限重试；这两类保持 false 以便后续补做。
      if (reason !== 'not_authorized' && reason !== 'disabled') _cloudPullDone = true;
      if (res && res.ok) notifySceneDataChanged();   // 云回填 → 刷新当前场景进度缓存
    }, function (e) { _warn('[sync.start]', e); });
  } else {
    _cloudPullDone = true;   // 非 Promise 防御：按已尝试处理
  }
}

/**
 * 冷启动隐私授权接线：privacy.init()（内部完成 getPrivacySetting → 按需 requirePrivacyAuthorize
 * → 持久化），决议后再 kickoffCloudSync()。任何异常仅 console.warn，静默降级、不阻断菜单。
 * 保留 typeof wx 防御 / try/catch 降级范式（能力探测下沉到 privacy.js 内部按调用实时判断）。
 */
function setupPrivacyAuthorization() {
  if (!privacy || typeof privacy.init !== 'function') return;   // 可选模块缺失 → 静默降级
  let p = null;
  try { p = privacy.init(); }
  catch (e) { _warn('[privacy.init]', e); return; }             // 异常 → 不启动云同步（安全默认）
  if (p && typeof p.then === 'function') {
    p.then(kickoffCloudSync, function (e) { _warn('[privacy.init]', e); });
  } else {
    kickoffCloudSync();                                         // 防御：非 Promise 也按已决议处理
  }
}
setupPrivacyAuthorization();

// 发布安全自检：仅打印布尔状态，绝不回显 env 值；不阻断启动、不影响 Node 回归。
(function publishCheck() {
  try {
    var c = config.CLOUD_CONFIG || {};
    if (!c.enabled || !c.env) {
      console.warn('[publish-check] 云同步未启用：CLOUD_CONFIG.enabled/env 为空，发布后用户换设备或清缓存将丢失进度；上线前需填 env 并置 enabled=true（见 CLOUD_DEPLOY.md §6）');
    }
  } catch (e) { /* 静默 */ }
})();

/**
 * onShow 云同步：仅在 pullOnShow 为真、且节流窗口已过时，先 privacy.refresh() 重新查询授权态。
 * 若冷启动的全量 pull 因未授权/未启用未完成，且此刻授权已 granted、云端可用，则补做一次
 * sync.start()（全量 pull→merge→回填）并通知当前场景刷新；否则只 sync.flush() 推送挂起本地写。
 * 一律排在 refresh 决议之后，绝不「先同步后授权」；30s 节流保持不变。
 */
function maybeCloudSyncOnShow() {
  if (!config || !config.CLOUD_CONFIG || !config.CLOUD_CONFIG.pullOnShow) return;
  const now = Date.now();
  if (now - lastCloudSyncAt < CLOUD_SYNC_MIN_GAP_MS) return;    // 节流（保持不破坏）
  lastCloudSyncAt = now;
  if (!privacy || typeof privacy.refresh !== 'function') return;
  const doSync = function () {
    // 冷启动 start() 若因「授权未决议 / 云端未启用」未做成，授权或配置就绪后在此补做一次全量 pull；
    // 否则维持既有路径：只 flush 挂起的本地写（纯 push）。
    var needPull = false;
    try {
      needPull = !_cloudPullDone &&
        cloud && typeof cloud.isEnabled === 'function' && !!cloud.isEnabled() &&
        privacy && typeof privacy.getState === 'function' && privacy.getState() === 'granted';
    } catch (e) { needPull = false; }
    if (needPull && sync && typeof sync.start === 'function') {
      let r = null;
      try { r = sync.start(); } catch (e) { _warn('[sync.start]', e); return; }
      if (r && typeof r.then === 'function') {
        r.then(function (res) {
          var reason = res && res.reason;
          if (reason !== 'not_authorized' && reason !== 'disabled') _cloudPullDone = true;
          if (res && res.ok) notifySceneDataChanged();
        }, function (e) { _warn('[sync.start]', e); });
      } else {
        _cloudPullDone = true;
      }
      return;
    }
    if (!sync || typeof sync.flush !== 'function') return;
    let f = null;
    try { f = sync.flush(); } catch (e) { _warn('[sync.flush]', e); return; }
    if (f && typeof f.catch === 'function') f.catch(function (e) { _warn('[sync.flush]', e); });
  };
  let p = null;
  try { p = privacy.refresh(); }
  catch (e) { _warn('[privacy.refresh]', e); return; }
  if (p && typeof p.then === 'function') {
    p.then(doSync, function (e) { _warn('[privacy.refresh]', e); });
  } else {
    doSync();
  }
}

// ---- 启动主菜单 ----
sceneManager.switchTo('menu');

// ==================== 游戏主循环 ====================
let lastTime = Date.now();
function gameLoop() {
  const now = Date.now();
  // dt 单位为「秒」；场景内部按需 dt*1000 转毫秒驱动动画/脉冲（对齐 config.MOTION）
  let dt = (now - lastTime) / 1000;
  lastTime = now;
  if (dt < 0) dt = 0;
  if (dt > 0.1) dt = 0.1; // 切后台回来后避免一次性大步进

  ctx.clearRect(0, 0, screenWidth, screenHeight);
  sceneManager.update(dt);
  sceneManager.render();
  requestAnimationFrame(gameLoop);
}

// ==================== 触摸事件（分发给 SceneManager，含模态/Banner）====================
wx.onTouchStart(function (e) {
  const t = e.touches[0] || e.changedTouches[0];
  if (t) sceneManager.onTouchStart(t.clientX, t.clientY);
});
wx.onTouchMove(function (e) {
  const t = e.touches[0] || e.changedTouches[0];
  if (t) sceneManager.onTouchMove(t.clientX, t.clientY);
});
wx.onTouchEnd(function (e) {
  const t = e.changedTouches[0];
  if (t) sceneManager.onTouchEnd(t.clientX, t.clientY);
});
if (typeof wx.onTouchCancel === 'function') {
  wx.onTouchCancel(function (e) {
    // 取消手势：清除当前场景按下态，避免残留高亮
    if (sceneManager.currentScene && sceneManager.currentScene.clearTouch) {
      try { sceneManager.currentScene.clearTouch(); } catch (err) { /* noop */ }
    }
  });
}

// ==================== 生命周期 ====================
if (typeof wx.onHide === 'function') {
  wx.onHide(function () {
    if (audio && typeof audio.stopAll === 'function') { try { audio.stopAll(); } catch (e) {} }
    if (anim && typeof anim.clearTweens === 'function') { try { anim.clearTweens(); } catch (e) {} }
    // 暂停回放自动播放（避免后台继续步进）
    if (sceneManager.currentSceneName === 'replay' && sceneManager.currentScene) {
      sceneManager.currentScene.playing = false;
    }
    // P1-I3：进入后台前为进行中的对局补写断点快照（onHide 单发，天然节流，不写每帧）
    const _cs = sceneManager.currentScene;
    if (sceneManager.currentSceneName === 'gameplay' && _cs && typeof _cs.saveResumeSnapshot === 'function') {
      try { _cs.saveResumeSnapshot(); } catch (e) {}
    }
  });
}
if (typeof wx.onShow === 'function') {
  wx.onShow(function () {
    lastTime = Date.now(); // 重置时间基准，避免回到前台 dt 突增
    // P2 断点恢复：若有 resume 快照且当前在菜单，弹 M7 询问（stretch）
    tryOfferResume();
    // 云同步（节流；不重复 sync.init；授权就绪且首次 pull 未完成时补做全量 pull）
    maybeCloudSyncOnShow();
  });
}

/**
 * 断点恢复（P2）：读 chess.resume.v1，若存在且当前在菜单，弹通用 resume 模态。
 * 继续 → replace('gameplay') 并重放 UCI；放弃 → clearResume。
 * 采用低频轮询标记，避免每次 onShow 重复弹出。
 */
// P1-I3：断点恢复改为「可重复询问」——放弃（丢弃断点）或继续后不再被一次性标记阻塞，
// 这样从任意菜单进入（menu.enter 主动调用）都能再次弹出 M7。
function tryOfferResume() {
  if (sceneManager.currentSceneName !== 'menu') return;
  const snap = GameContext.getResume && GameContext.getResume();
  if (!snap || !snap.mode) return;
  GameContext.openModal('resume', {
    title: '继续上一局？', message: '检测到未完成的对局，是否继续？',
    maskClosable: false,
    buttons: [
      { label: '放弃', action: 'discard', variant: 'secondary' },
      { label: '继续', action: 'confirm', variant: 'primary' }
    ],
    onAction: (act) => {
      GameContext.closeModal();
      if (act === 'confirm') {
        GameContext.emit('navigate', { to: 'gameplay' });
        GameContext.replaceScene('gameplay', {
          mode: snap.mode, aiDepth: snap.aiDepth, aiColor: snap.aiColor,
          playerColor: snap.playerColor, resumeMoves: Array.isArray(snap.movesUci) ? snap.movesUci : []
        });
      } else {
        if (GameContext.clearResume) GameContext.clearResume();
      }
    }
  });
}
// 暴露给 menu.enter 主动调用（菜单返回时触发断点询问）
if (GameContext && typeof GameContext === 'object') GameContext.tryOfferResume = tryOfferResume;

// 启动游戏循环
requestAnimationFrame(gameLoop);
