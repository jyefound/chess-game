/**
 * S7 设置场景
 * 同时导出可复用的 renderSettingsPanel() 与 applySettingKey()，供对局的 M3 设置抽屉复用。
 *
 * 第二轮（OPTIMIZATION_PLAN_ROUND2 §7）：三组信息架构、内容驱动行高（≥44pt 命中）、
 * 共享面板层 90ms 按压、三套可切换主题、自动覆盖开启确认、清空局数，
 * 保存失败提示、共享 TopBar、底部渐隐与版本号、快速开局配置摘要。
 */
const GameContext = require('../context');
const M = require('./manager');
const { theme, TouchGuard, util, createTap } = M;
const C = theme.colors, R = theme.radius;
const TF = (k) => theme.font(k);
const rr = util.rr, inRect = util.inRect;
const layoutMod = require('../core/layout');
const panels = require('../render/panels');
const topbar = require('../render/topbar');
const config = require('../config');
const storage = require('../core/storage');
const privacy = require('../core/privacy');
const sync = require('../core/sync');
const cloud = require('../core/cloud');
const PRIVACY = require('../data/privacy');

// 10 项设置（UX §Q4）+ group 归组（§7.1）
const SETTING_DEFS = [
  { key: 'soundEnabled', group: 'display', type: 'toggle', label: '音效', hint: '操作、落子与将军提示音' },
  { key: 'reduceMotion', group: 'display', type: 'toggle', label: '减弱动效', hint: '减少动画、闪烁与画面晃动' },
  { key: 'fontSize', group: 'display', type: 'choice', label: '字号', hint: '正文与标题的显示大小',
    choices: [{ label: '标准', value: 'standard' }, { label: '大', value: 'large' }], valueOf: (s) => s.fontSize || 'standard' },
  { key: 'theme', group: 'display', type: 'choice', label: '主题', hint: '一 墨金 · 二 素雅 · 三 童趣',
    choices: [{ label: '主题一', value: 'dark' }, { label: '主题二', value: 'light' }, { label: '主题三', value: 'kids' }],
    valueOf: (s) => s.theme || 'dark' },
  { key: 'showLegalMoves', group: 'board', type: 'toggle', label: '显示合法走法', hint: '选中棋子后显示可走位置' },
  { key: 'showCoordinates', group: 'board', type: 'toggle', label: '显示坐标', hint: '棋盘边格显示 a–h / 1–8' },
  { key: 'defaultColor', group: 'board', type: 'choice', label: '初始执棋色', hint: '首次对局的执棋方；之后沿用上一局',
    choices: [{ label: '白', value: 'w' }, { label: '黑', value: 'b' }], valueOf: (s) => s.defaultColor || 'w' },
  { key: 'skipSetup', group: 'board', type: 'toggle', label: '人机对战快速开局', hint: '跳过对局设置，沿用上次全部配置' },
  { key: 'autoSaveGame', group: 'records', type: 'toggle', label: '结算自动保存', hint: '对局结束自动存档到棋谱' },
  { key: 'autoPrune', group: 'records', type: 'toggle', label: '自动覆盖最早棋谱', hint: '棋谱满 50 局时，每次新增会永久删除本机最早一局' },
  { key: 'clearAll', group: 'records', type: 'action', label: '清空所有棋谱', hint: '删除本机保存的全部对局', danger: true },
  // —— 账号与隐私（v3）：只读 info 行不注册 region、不产生 patch，避免污染既有设置 ——
  { key: 'authStatus', group: 'account', type: 'info', label: '授权与云同步', hint: '当前授权与云同步状态' },
  { key: 'cloudSync', group: 'account', type: 'toggle', label: '云同步', hint: '关闭后本次不再上传；云端已有副本可在下方删除' },
  { key: 'privacyPolicy', group: 'account', type: 'action', label: '隐私声明', hint: '查看完整声明' },
  { key: 'minorProtection', group: 'account', type: 'info', label: '适龄与家长监护', hint: PRIVACY.AGE_HINT },
  { key: 'deleteCloudData', group: 'account', type: 'action', label: '删除云端数据', hint: '需二次确认', danger: true }
];

// 三组信息架构（§7.1）：组标题画在容器外，组内行连续排列。
// '__summary__' = 快速开局配置摘要；theme = 三套主题选择。
const GROUPS = [
  { id: 'board', title: '对局与棋盘', keys: ['defaultColor', 'showLegalMoves', 'showCoordinates', 'skipSetup', '__summary__'] },
  { id: 'display', title: '显示与反馈', keys: ['soundEnabled', 'reduceMotion', 'fontSize', 'theme'] },
  { id: 'records', title: '棋谱', keys: ['autoSaveGame', 'autoPrune', 'clearAll'] },
  { id: 'account', title: '账号与隐私', keys: ['authStatus', 'cloudSync', 'privacyPolicy', 'minorProtection', 'deleteCloudData'] }
];

const BOTTOM_PAD = 12; // 滚动内容底部内边距（P2-02）

/** #RRGGBB -> rgba(r,g,b,a)；非 hex 回退到 bgBase 近似值 */
function fadeColor(hex, a) {
  const m = /^#?([0-9a-fA-F]{6})$/.exec(String(hex == null ? '' : hex).trim());
  if (!m) return 'rgba(16,21,27,' + a + ')';
  const n = parseInt(m[1], 16);
  return 'rgba(' + ((n >> 16) & 255) + ',' + ((n >> 8) & 255) + ',' + (n & 255) + ',' + a + ')';
}

/** §7.7 快速开局摘要：数据来自 getLastConfig()，无存档必须容错 */
function lastConfigSummary() {
  let last = null;
  try { last = GameContext.getLastConfig(); } catch (e) { last = null; }
  if (!last || typeof last !== 'object') return '上次：尚无对局记录';
  const diffMap = { easy: '简单', medium: '中等', hard: '困难' };
  const colorMap = { w: '执白', b: '执黑' };
  const styleMap = { coach: '指导', standard: '标准' };
  const d = diffMap[last.difficulty] || '中等';
  const c = colorMap[last.color] || '执白';
  const s = styleMap[last.style] || '标准';
  return '上次：' + d + ' · ' + c + ' · ' + s;
}

/**
 * 根据点击的设置项 key 生成补丁 / 动作。
 * @returns {{patch?:object, action?:string, message?:string, sound?:string}}
 */
function applySettingKey(key, settings, choice) {
  // autoPrune 不在 TOGGLES 中：开启需先确认（P1-12），关闭直接补丁。
  const TOGGLES = ['soundEnabled', 'reduceMotion', 'showLegalMoves', 'showCoordinates', 'skipSetup', 'autoSaveGame'];
  if (TOGGLES.indexOf(key) >= 0) return { patch: { [key]: !settings[key] }, sound: 'toggle' };
  if (key === 'autoPrune') {
    if (settings.autoPrune) return { patch: { autoPrune: false }, sound: 'toggle' };
    return { action: 'confirmAutoPrune' };
  }
  if (key === 'fontSize') {
    const v = (choice === undefined) ? (settings.fontSize === 'large' ? 'standard' : 'large') : choice;
    return { patch: { fontSize: v }, sound: 'toggle' };
  }
  if (key === 'defaultColor') {
    const v = (choice === undefined) ? (settings.defaultColor === 'b' ? 'w' : 'b') : choice;
    return { patch: { defaultColor: v }, sound: 'toggle' };
  }
  if (key === 'clearAll') return { action: 'confirmClear' };
  if (key === 'theme') {
    const v = choice || 'dark';
    return { patch: { theme: ['dark', 'light', 'kids'].indexOf(v) >= 0 ? v : 'dark' }, sound: 'toggle' };
  }
  // —— 账号与隐私：只返回 action，绝不产生 patch（不污染既有 DEFAULT_SETTINGS）——
  // authStatus / minorProtection 为只读 info 行，不注册 region，走到此处返回 {}。
  if (key === 'cloudSync') return { action: 'toggleCloudSync' };
  if (key === 'profile') return { action: 'openProfile' };
  if (key === 'privacyPolicy') return { action: 'openPrivacy' };
  if (key === 'deleteCloudData') return { action: 'deleteCloudData' };
  return {};
}

// ==================== 账号与隐私：状态计算 + 动作分发 + 弹窗 ====================
// 这些函数同时供 SettingsScene._apply 与 gameplay.js 的 settingsDrawer 分支通过
// runAccountAction(res.action) 调用，保证「设置页」与「对局抽屉」双端一致。

/** 云端是否可用（env 已配置 + wx.cloud 就绪）。任一异常一律视为不可用。 */
function cloudAvailable() {
  try { return !!cloud.isEnabled(); } catch (e) { return false; }
}

/** cloudSync 开关当前值：用户开关 且 云端可用，二者缺一即显示关闭。 */
function cloudToggleValue() {
  try { return !!(privacy.isCloudSyncEnabled() && cloud.isEnabled()); } catch (e) { return false; }
}

/**
 * 授权状态行动态文案：按隐私状态 → 云端可用/用户开关 → 同步状态映射 CLOUD_STATUS。
 * 每次渲染实时读取（不缓存），保证 privacy.getState() 变化后文案随之变化。
 */
function authStatusHint() {
  const S = PRIVACY.CLOUD_STATUS;
  let st = null, ss = null, enabled = false, syncEnabled = true;
  try { st = privacy.getState(); } catch (e) { /* 静默降级 */ }
  try { ss = sync.status(); } catch (e) { /* 静默降级 */ }
  try { enabled = !!cloud.isEnabled(); } catch (e) { enabled = false; }
  try { syncEnabled = privacy.isCloudSyncEnabled(); } catch (e) { syncEnabled = true; }
  const STATE = privacy.STATE || {};
  if (st === STATE.DENIED || st === 'denied') return S.denied;
  if (st === STATE.NEED || st === 'need' || st === STATE.UNKNOWN || st === 'unknown') return S.unauthorized;
  // GRANTED（或无隐私接口时的放行态）：再看云端与同步
  if (!enabled || !syncEnabled) return S.off;
  if (ss && ss.lastError) return S.error;
  if (ss && (ss.state === 'syncing' || ss.state === 'pushing' || ss.pending > 0)) return S.syncing;
  return S.synced;
}

// ---- 基本资料：用户自填昵称，存 STORAGE_KEYS.profile = {nickname, updatedAt} ----
/** 昵称统一清洗：去控制字符/换行、去掉首尾空白、截断到 12 字。输入回显与落盘共用。 */
function cleanNickname(v) {
  return String(v || '').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 12);
}
function readProfile() {
  try {
    const r = storage._readJSON(config.STORAGE_KEYS.profile);
    if (r && r.ok && r.value && typeof r.value === 'object') {
      return {
        nickname: typeof r.value.nickname === 'string' ? r.value.nickname : '',
        updatedAt: r.value.updatedAt || 0
      };
    }
  } catch (e) { /* 静默降级 */ }
  return { nickname: '', updatedAt: 0 };
}
function writeProfile(nickname) {
  try {
    return !!storage._writeJSON(config.STORAGE_KEYS.profile, {
      nickname: cleanNickname(nickname), updatedAt: Date.now()
    });
  } catch (e) { return false; }
}
function profileMessage(nickname, extra) {
  return PRIVACY.PROFILE_TIPS + '\n昵称：' + (nickname || '（未设置）') + (extra ? '\n' + extra : '');
}

// ---- 键盘能力探测 / 监听清理（小游戏无 <input>，绝不泄漏监听）----
function keyboardAvailable() {
  return (typeof wx !== 'undefined' &&
    typeof wx.showKeyboard === 'function' &&
    typeof wx.onKeyboardInput === 'function' &&
    typeof wx.onKeyboardConfirm === 'function' &&
    typeof wx.offKeyboardInput === 'function' &&
    typeof wx.offKeyboardConfirm === 'function');
}
let _kbSession = null;
function keyboardCleanup() {
  if (!_kbSession) return;
  try { if (typeof wx !== 'undefined' && wx.offKeyboardInput) wx.offKeyboardInput(_kbSession.onInput); } catch (e) { /* 静默 */ }
  try { if (typeof wx !== 'undefined' && wx.offKeyboardConfirm) wx.offKeyboardConfirm(_kbSession.onConfirm); } catch (e) { /* 静默 */ }
  try { if (typeof wx !== 'undefined' && wx.hideKeyboard) wx.hideKeyboard({}); } catch (e) { /* 静默 */ }
  _kbSession = null;
}

/** 资料弹窗：通用 confirm 模态，查看当前昵称 + 修改/清除；能力缺失退化为只读提示。 */
function openProfileModal() {
  keyboardCleanup();
  const payload = {
    title: '我的资料', height: 260,
    message: profileMessage(readProfile().nickname),
    buttons: [
      { label: '修改昵称', action: 'edit', variant: 'primary' },
      { label: '清除昵称', action: 'clear', variant: 'secondary' },
      { label: '关闭', action: 'cancel', variant: 'secondary' }
    ],
    onAction: function (act) {
      if (act === 'cancel') { keyboardCleanup(); GameContext.closeModal(); return; }
      if (act === 'clear') {
        keyboardCleanup();
        const ok = writeProfile('');
        GameContext.showBanner(ok ? '昵称已清除' : '清除失败，请重试', ok ? 'success' : 'danger');
        payload.message = profileMessage('');
        return;
      }
      if (act === 'edit') { startNicknameEdit(payload); }
    }
  };
  GameContext.openModal('confirm', payload);
}

/** 拉起系统键盘，实时把输入写回模态正文（自绘输入行），确认后落盘。 */
function startNicknameEdit(payload) {
  const current = readProfile().nickname;
  const setMsg = function (nick, extra) { if (payload) payload.message = profileMessage(nick, extra); };
  if (!keyboardAvailable()) {
    setMsg(current, '当前环境暂不支持编辑，仅可查看');
    GameContext.showBanner('当前环境暂不支持编辑，仅可查看', 'info');
    return;
  }
  keyboardCleanup();
  const onInput = function (res) {
    const v = (res && typeof res.value === 'string') ? res.value : '';
    setMsg(cleanNickname(v), '输入中 · 最多 12 字');
  };
  const onConfirm = function (res) {
    const v = (res && typeof res.value === 'string') ? res.value : '';
    const nick = cleanNickname(v);
    const ok = writeProfile(nick);
    keyboardCleanup();
    GameContext.showBanner(ok ? '昵称已保存' : '保存失败，请重试', ok ? 'success' : 'danger');
    setMsg(nick, '');
  };
  _kbSession = { onInput: onInput, onConfirm: onConfirm };
  try {
    wx.onKeyboardInput(onInput);
    wx.onKeyboardConfirm(onConfirm);
    wx.showKeyboard({ defaultValue: current, maxLength: 12, multiple: false, confirmHold: false, confirmType: 'done' });
    setMsg(current, '输入中 · 最多 12 字');
  } catch (e) {
    keyboardCleanup();
    setMsg(current, '当前环境暂不支持编辑，仅可查看');
  }
}

/** 本地 8 段声明：POLICY_SECTIONS 逐段单按钮通用模态（保持既有逐段逻辑不变）。 */
function showPrivacySections() {
  const sections = PRIVACY.POLICY_SECTIONS;
  function showSection(i) {
    const sec = sections[i];
    const last = (i === sections.length - 1);
    GameContext.openModal('confirm', {
      title: PRIVACY.POLICY_TITLE + '（' + (i + 1) + '/' + sections.length + '）',
      height: 260,
      message: sec.heading + '\n' + sec.body,
      buttons: [
        { label: last ? '完成' : '下一段', action: 'next', variant: 'primary' },
        { label: '关闭', action: 'cancel', variant: 'secondary' }
      ],
      onAction: function (act) {
        if (act === 'cancel') { GameContext.closeModal(); return; }
        if (act === 'next') { if (last) GameContext.closeModal(); else showSection(i + 1); }
      }
    });
  }
  if (sections.length) showSection(0);
}

/**
 * 隐私声明：优先官方隐私指引。
 * 新版 openContract(onFail)：能力缺失 / 平台 fail（未发布指引时必然 fail）/ 抛异常 → onFail；
 * fail 时返回 true（=已向官方发起），故不能再用 `if (opened) return` 判降级，否则本地
 * 8 段永远不可达。onFail 与 !opened 可能同时触发（能力缺失分支），用局部 flag 保证至多一次。
 */
function openPrivacyModal() {
  keyboardCleanup();
  var shown = false;
  var showLocal = function () {
    if (shown) return;
    shown = true;
    showPrivacySections();
  };
  var opened = false;
  try { opened = privacy.openContract(showLocal); } catch (e) { opened = false; }
  if (!opened) showLocal();
}

/** 删除云端数据：危险二次确认 → 先 requestDeleteAll（需授权态仍有效）→ 再撤回授权。 */
function confirmDeleteCloudData() {
  keyboardCleanup();
  GameContext.openModal('confirm', {
    title: '删除云端数据',
    message: PRIVACY.DELETE_DATA_CONFIRM,
    buttons: [
      { label: '取消', action: 'cancel', variant: 'secondary' },
      { label: '删除', action: 'confirm', variant: 'danger' }
    ],
    onAction: function (act) {
      GameContext.closeModal();
      if (act !== 'confirm') return;
      // 顺序不可颠倒：requestDeleteAll 受 privacy.canSync() 门控，先 clearAll 会把它拦成 not_authorized
      Promise.resolve()
        .then(function () { return sync.requestDeleteAll(); })
        .catch(function () { return { ok: false, reason: 'error' }; })
        .then(function (r) {
          try { privacy.clearAll(); } catch (e) { /* 静默 */ }
          var ok = !!(r && r.ok);
          GameContext.showBanner(
            ok ? '云端数据已删除，授权已撤回；本地数据仍保留，可在设置中单独清空棋谱'
               : '未能删除云端数据（可能未授权或网络不可用）；授权已撤回，可稍后重试',
            ok ? 'success' : 'danger'
          );
        });
    }
  });
}

/**
 * cloudSync 开关：
 *  - 未授权态（denied/need/unknown）→ 先 refresh() 拉起官方隐私弹窗重新授权，决议 granted
 *    后再开启开关并主动 requestCloudPull()（C2）；异步进行，不卡 UI、无 loading。
 *  - 已授权态 → 按原逻辑切换（云端未配置时只提示、绝不改动任何本地设置）；
 *    关闭分支顺带 clearPending()，清掉关闭前积压的待补传队列（C3）。
 */
function toggleCloudSync() {
  var st = null;
  try { st = privacy.getState(); } catch (e) { st = null; }
  var STATE = privacy.STATE || {};
  var unauthorized = (st === STATE.DENIED || st === 'denied' ||
                      st === STATE.NEED || st === 'need' ||
                      st === STATE.UNKNOWN || st === 'unknown');
  if (unauthorized) {
    var p;
    try { p = Promise.resolve(privacy.refresh()); }
    catch (e) { p = Promise.resolve(null); }
    if (p && typeof p.then === 'function') {
      p.then(function (res) {
        if (res === STATE.GRANTED || res === 'granted') {
          try { privacy.setCloudSyncEnabled(true); } catch (e) { /* 静默 */ }
          GameContext.showBanner('云同步已开启', 'success');
          try {
            if (GameContext && typeof GameContext.requestCloudPull === 'function') GameContext.requestCloudPull();
          } catch (e) { /* 静默 */ }
        } else {
          GameContext.showBanner(res === STATE.DENIED || res === 'denied'
            ? '未授权，云同步未开启' : '授权未完成，可稍后重试', 'info');
        }
      }, function () {
        GameContext.showBanner('授权未完成，可稍后重试', 'info');
      });
    }
    return;
  }
  // 已授权态：沿用原逻辑（云端未配置 → 只提示，绝不改动任何本地设置）。
  if (!cloudAvailable()) { GameContext.showBanner('云端未配置', 'info'); return; }
  let cur = false;
  try { cur = privacy.isCloudSyncEnabled(); } catch (e) { /* 静默 */ }
  let next = cur;
  try { next = privacy.setCloudSyncEnabled(!cur); } catch (e) { next = cur; }
  if (!next) {
    // C3：关闭后不再上传，且清掉关闭前积压的 pending，避免重新开启后被补传。
    try { if (sync && typeof sync.clearPending === 'function') sync.clearPending(); } catch (e) { /* 静默 */ }
  }
  GameContext.showBanner(next ? '云同步已开启' : '云同步已关闭，本次不再上传', next ? 'success' : 'info');
}

/** 新 action 统一分发（settings 场景与 gameplay 抽屉共用）。 */
function runAccountAction(action) {
  if (action === 'toggleCloudSync') { toggleCloudSync(); return; }
  if (action === 'openProfile') { openProfileModal(); return; }
  if (action === 'openPrivacy') { openPrivacyModal(); return; }
  if (action === 'deleteCloudData') { confirmDeleteCloudData(); return; }
}

/** 右侧控件宽度：toggle 开关 44 / choice 分段 / action 箭头 */
function controlWidthFor(def) {
  if (def.type === 'info') return 0;   // 只读行无右侧控件
  if (def.type === 'toggle') return 44;
  if (def.type === 'choice') {
    const n = (def.choices || []).length;
    return n * 54 + Math.max(0, n - 1) * 6;
  }
  if (def.type === 'action') return 20;
  return 0;
}

/** 开关（沿用既有视觉，接收 ctx）；disabled 走 C.disabledFg 不可用态 */
function toggleSwitch(ctx, cx, cy2, on, disabled) {
  const sw = 44, sh = 24, sx = cx - sw, sy = cy2 - sh / 2;
  if (disabled) {
    ctx.save();
    ctx.fillStyle = C.surface2; rr(ctx, sx, sy, sw, sh, R.pill); ctx.fill();
    ctx.strokeStyle = C.disabledFg; ctx.lineWidth = 1;
    rr(ctx, sx + 0.5, sy + 0.5, sw - 1, sh - 1, R.pill); ctx.stroke();
    ctx.fillStyle = C.disabledFg;
    ctx.beginPath(); ctx.arc(sx + 12, sy + sh / 2, 9, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
    return;
  }
  if (on) {
    // 开：黄铜实底 + 近黑旋钮（已有语义）
    ctx.fillStyle = C.accent; rr(ctx, sx, sy, sw, sh, R.pill); ctx.fill();
    ctx.fillStyle = C.textOnAccent;
  } else {
    // 关：略亮轨道 + 描边轮廓，明确「空态」，与开态高对比（§3-b）
    ctx.fillStyle = C.surface2; rr(ctx, sx, sy, sw, sh, R.pill); ctx.fill();
    ctx.strokeStyle = C.border; ctx.lineWidth = 1;
    rr(ctx, sx + 0.5, sy + 0.5, sw - 1, sh - 1, R.pill); ctx.stroke();
    ctx.fillStyle = C.textTertiary;
  }
  ctx.beginPath(); ctx.arc(on ? sx + sw - 12 : sx + 12, sy + sh / 2, 9, 0, Math.PI * 2); ctx.fill();
}

/**
/**
 * 只读信息行（type:'info'）：复用主题行思路，label + hint 用 drawLines 绘制，
 * 不画右侧控件、不注册任何 region，因此点击无响应、也不产生 patch。
 */
function drawInfoRow(ctx, r, x, cy, PAD) {
  const m = r.m;
  let ty = cy + 10;
  const lh = panels.drawLines(ctx, m.labelLines, x + PAD, ty, C.textPrimary, 'body');
  ty += lh + 4;
  if (m.hintLines.length) panels.drawLines(ctx, m.hintLines, x + PAD, ty, C.textSecondary, 'caption');
}

/** 绘制单行（含按压反馈、标签/说明、右侧控件、region 注册） */
function drawRow(ctx, r, x, cy, w, rh, screenY, visible, scrollY, settings, pressedKey, regions, PAD) {
  if (r.type === 'summary') {
    ctx.save();
    ctx.fillStyle = C.textSecondary; ctx.font = TF('caption');
    ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    ctx.fillText(r.text, x + PAD, cy + rh / 2);
    ctx.restore();
    return;
  }
  if (r.type === 'theme') {
    drawThemeRow(ctx, r, x, cy, rh, screenY, visible, scrollY, regions, PAD, w);
    return;
  }

  const def = r.def, m = r.m;
  if (def.type === 'info') { drawInfoRow(ctx, r, x, cy, PAD); return; }
  const textX = x + PAD, rightX = x + w - PAD;
  const pressed = (pressedKey === def.key);

  // P1-10：命中的 toggle/choice/action 行统一调用共享 90ms 按压层；
  // P1-09：危险行再叠一层淡红底，与危险语义一致。
  if (pressed) {
    panels.drawPressed(ctx, x, cy, w, rh, 0);
    if (def.type === 'action' && def.danger) {
      ctx.save(); ctx.fillStyle = C.dangerFade;
      rr(ctx, x, cy, w, rh, 0); ctx.fill(); ctx.restore();
    }
  }

  // 标签 / 说明：宽度已由 measureSettingRow 扣掉右侧控件，自动折行、绝不侵入控件
  let ty = cy + 10;
  // 危险 action 用语义色 C.danger，其余一律主文字色（全走 token，不复制存量硬编码色值）。
  const labelColor = (def.type === 'action' && def.danger) ? C.danger : C.textPrimary;
  const lh = panels.drawLines(ctx, m.labelLines, textX, ty, labelColor, 'body');
  ty += lh + 6;
  if (m.hintLines.length) panels.drawLines(ctx, m.hintLines, textX, ty, C.textSecondary, 'caption');

  if (def.type === 'toggle') {
    // cloudSync 等动态行用渲染时算好的 r.value / r.disabled；其余沿用 settings[def.key]。
    const on = (r.value !== undefined) ? !!r.value : !!settings[def.key];
    toggleSwitch(ctx, rightX, cy + rh / 2, on, !!r.disabled);
    if (visible) regions.push({ key: def.key, kind: 'toggle', rect: { x: x, y: screenY, w: w, h: rh } });
  } else if (def.type === 'choice') {
    const cur = def.valueOf(settings);
    const segH = Math.max(panels.MIN_TAP, 44);
    const segW = r.stacked ? (w - PAD * 2) : r.controlW;
    const segX = r.stacked ? (x + PAD) : (rightX - segW);
    const segY = cy + m.controlY;
    const segRegions = panels.drawSegmented(ctx, segX, segY, segW, segH, def.choices, cur, {
      gap: 6, radius: panels.ROW_RADIUS, fontKey: 'caption', check: true
    });
    for (const sr of segRegions) {
      const sy = sr.rect.y - scrollY;
      if (visible) regions.push({ key: def.key, kind: 'choice', choice: sr.value,
        rect: { x: sr.rect.x, y: sy, w: sr.rect.w, h: sr.rect.h } });
    }
  } else if (def.type === 'action') {
    ctx.save();
    ctx.fillStyle = C.textSecondary; ctx.font = TF('body');
    ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
    ctx.fillText('›', rightX, cy + rh / 2);
    ctx.restore();
    if (visible) regions.push({ key: def.key, kind: 'action', rect: { x: x, y: screenY, w: w, h: rh } });
  }
}

/**
 * 绘制可滚动设置面板（自裁剪 + 内容上移 scrollY）。
 * 第 1~7 参数含义不变；第 8 参数 opts 可选：{ pressedKey, viewportW }。
 * @returns {{regions:Array, contentHeight:number}}
 * region: {key, kind:'toggle'|'choice'|'action'|'theme', choice?, rect:{x,y,w,h}}（rect 为屏幕坐标）
 */
function renderSettingsPanel(ctx, x, y, w, h, scrollY, settings, opts) {
  opts = opts || {};
  const pressedKey = opts.pressedKey || null;
  const viewportW = (typeof opts.viewportW === 'number') ? opts.viewportW : (w + 32);
  // P0-01：320 窄屏 + 大字号时，choice 行改为「标签/说明在上、分段控件在下」
  const stackChoice = viewportW <= 340;
  const PAD = panels.GROUP_PAD;
  const regions = [];
  const defByKey = {};
  for (const d of SETTING_DEFS) defByKey[d.key] = d;

  ctx.save();
  ctx.beginPath(); rr(ctx, x, y, w, h, R.card); ctx.clip();
  ctx.translate(0, -scrollY);

  let ry = y + 12;

  for (const group of GROUPS) {
    ry += panels.drawSectionHeader(ctx, x, ry, group.title, { color: C.textSecondary }) + 10;

    // 先度量组内各行高度（内容驱动，跟随 theme.font 缩放）
    const rows = [];
    for (const key of group.keys) {
      if (key === '__summary__') {
        rows.push({ type: 'summary', text: lastConfigSummary(),
          h: Math.max(panels.MIN_TAP, panels.lineHeight('caption') + 12) });
        continue;
      }
      const def = defByKey[key];
      if (!def) continue;
      const controlW = controlWidthFor(def);
      const stacked = (def.type === 'choice') && stackChoice;
      // authStatus 文案每帧由 privacy/sync/cloud 现算（不改函数签名）。
      const hint = (def.key === 'authStatus') ? authStatusHint() : def.hint;
      const m = panels.measureSettingRow(ctx, w, def.label, hint, controlW, {
        stacked: stacked,
        controlH: stacked ? 44 : (def.type === 'choice' ? 44 : 24),
        maxHintLines: 3
      });
      const row = { type: 'def', def: def, m: m, h: m.h, controlW: controlW, stacked: stacked };
      // cloudSync：值来自 privacy.isCloudSyncEnabled() 且叠加 cloud.isEnabled()；云端未配置显示不可用。
      if (def.key === 'cloudSync') {
        row.value = cloudToggleValue();
        row.disabled = !cloudAvailable();
      }
      rows.push(row);
    }

    let groupH = 0;
    for (const r of rows) groupH += r.h;

    panels.drawGroupPanel(ctx, x, ry, w, groupH);
    ctx.save();
    ctx.beginPath(); rr(ctx, x, ry, w, groupH, panels.GROUP_RADIUS); ctx.clip();

    let cy = ry;
    for (let ri = 0; ri < rows.length; ri++) {
      const r = rows[ri];
      const rh = r.h;
      const screenY = cy - scrollY;
      const visible = screenY + rh > y && screenY < y + h;
      // 组内弱分隔线（摘要行紧跟上一项，不额外插线）
      if (ri < rows.length - 1 && rows[ri + 1].type !== 'summary') {
        panels.drawRowDivider(ctx, x + PAD, cy + rh, w - PAD * 2);
      }
      drawRow(ctx, r, x, cy, w, rh, screenY, visible, scrollY, settings, pressedKey, regions, PAD);
      cy += rh;
    }
    ctx.restore();
    ry += groupH + panels.GROUP_GAP;
  }

  const contentHeight = (ry - y) - panels.GROUP_GAP + BOTTOM_PAD;
  ctx.restore();
  return { regions: regions, contentHeight: contentHeight };
}

class SettingsScene {
  constructor() {
    this.guard = new TouchGuard({ moveThreshold: 8 });
    this.regions = [];
    this.scrollY = 0;
    this.maxScroll = 0;
    this.pressed = null;
    this.tap = createTap();
    this.from = 'menu';
    this.screenWidth = 375;
    this.screenHeight = 667;
    this.panel = null;
    this.sm = null;
    this._vy = 0;            // 滚动速度（惯性）
    this._lastScrollAt = 0;  // 最近一次滚动时刻（用于滚动条显隐）
    this._inertia = false;   // 是否处于惯性滚动
  }

  enter(params = {}) {
    this.sm = params._sm || null;
    this.from = params.from || 'menu';
    this.screenWidth = params.screenWidth || 375;
    this.screenHeight = params.screenHeight || 667;
    this.regions = [];
    this.pressed = null;
    // 不主动重置 scrollY：切换字号后保持当前位置稳定（P0-01）
    if (!params.resume) this.scrollY = 0;
    this.guard.reset();
    this.tap.clear();
    this._vy = 0;
    this._lastScrollAt = 0;
    this._inertia = false;
  }
  exit() { this.regions = []; this.pressed = null; this.tap.clear(); }
  clearTouch() { this.guard.reset(); this.pressed = null; this.tap.clear(); }
  update(dt) {
    if (!this._inertia || this.maxScroll <= 0) return;
    const clamped = Math.max(0, Math.min(this.maxScroll, this.scrollY - this._vy));
    this.scrollY = clamped;
    this._lastScrollAt = Date.now();
    this._vy *= 0.93;
    if (Math.abs(this._vy) < 0.5) { this._inertia = false; this._vy = 0; }
  }

  render(ctx, W, H) {
    ctx.fillStyle = C.bgBase; ctx.fillRect(0, 0, W, H);
    this.regions = [];
    const L = layoutMod.get();
    const contentBottom = (L && typeof L.contentBottom === 'number') ? L.contentBottom : H - 36;

    // P2-01：共享 TopBar（三槽位、胶囊避让、大字号标题下沉）
    const nav = topbar.drawTopBar(ctx, {
      W: W,
      title: '设置', fontKey: 'h1',
      back: { key: 'back', label: '返回', pressed: this.tap.isPressing('back', Date.now()) },
      divider: true
    });
    // topbar 的 back region 标 panelHit:false，_panelKey 不会误判为面板行
    for (const r of nav.regions) this.regions.push(Object.assign({ panelHit: false }, r));

    const px = 16, py = nav.bottom + 12, pw = W - 32;
    const verH = 28; // 版本号高度（滚动区外，兼避让 home indicator）
    const ph = contentBottom - py - verH;
    this.panel = { x: px, y: py, w: pw, h: ph };
    const settings = GameContext.getSettings();
    const out = renderSettingsPanel(ctx, px, py, pw, ph, this.scrollY, settings, {
      pressedKey: this.pressed,
      viewportW: W
    });
    this.maxScroll = Math.max(0, out.contentHeight - ph);
    if (this.scrollY > this.maxScroll) this.scrollY = this.maxScroll;
    for (const r of out.regions) this.regions.push(Object.assign({ panelHit: true }, r));

    // P2-02：底部 16px 渐隐（透明 → 背景色），遮住被截断的行
    const fade = ctx.createLinearGradient(0, py + ph - 16, 0, py + ph);
    fade.addColorStop(0, fadeColor(C.bgBase, 0));
    fade.addColorStop(1, C.bgBase);
    ctx.save();
    ctx.fillStyle = fade;
    ctx.fillRect(px, py + ph - 16, pw, 16);
    ctx.restore();

    // 顶部 24px 渐隐（背景色不透明 → 透明），遮住面板顶部被截断的行
    const fadeTop = ctx.createLinearGradient(0, py, 0, py + 24);
    fadeTop.addColorStop(0, C.bgBase);
    fadeTop.addColorStop(1, fadeColor(C.bgBase, 0));
    ctx.save();
    ctx.fillStyle = fadeTop;
    ctx.fillRect(px, py, pw, 24);
    ctx.restore();

    // 右侧细滚动指示：贴屏幕右缘、更细，仅滚动时短暂显示
    if (this.maxScroll > 0 && this._lastScrollAt && (Date.now() - this._lastScrollAt < 800)) {
      const trackH = ph - 16, ratio = ph / out.contentHeight;
      const thumbH = Math.max(24, trackH * ratio);
      const t = this.scrollY / this.maxScroll;
      const thumbY = py + 8 + (trackH - thumbH) * t;
      ctx.save();
      ctx.fillStyle = C.accent; ctx.globalAlpha = 0.25;
      rr(ctx, W - 8, thumbY, 2, thumbH, 1); ctx.fill();
      ctx.restore();
    }

    // 版本号：固定在滚动区外，留底部安全间距，避免与截断行连成一张卡
    ctx.fillStyle = C.textSecondary; ctx.font = TF('micro');
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('v2.0', W / 2, contentBottom - verH / 2);

    // 账号与隐私弹窗（资料 / 声明 / 删除确认）复用通用 confirm 模态；
    // 与 gameplay/teaching/menu 等场景一致，由当前场景负责绘制通用模态。
    if (this.sm && this.sm.modal && this.sm.modal.isOpen() && this.sm.modal.isGeneric()) {
      this.sm.modal.renderGeneric(ctx, W, H);
    }
  }

  onTouchStart(x, y) {
    this.guard.down(x, y);
    // 通用模态打开时不注册面板按压态（仍保留 guard.down 供 onTouchEnd 判定有效点击）
    if (this.sm && this.sm.modal && this.sm.modal.isOpen() && this.sm.modal.isGeneric()) return;
    this._vy = 0;
    this._inertia = false;
    this.pressed = this._panelKey(x, y);
    if (this.pressed) this.tap.press(this.pressed, Date.now());
    else {
      // 顶栏返回不是 panelHit，单独记录按压态供 drawTopBar 使用
      const b = this.regions.find(r => r.key === 'back' && inRect(x, y, r.rect));
      if (b) this.tap.press('back', Date.now());
    }
  }
  onTouchMove(x, y) {
    const m = this.guard.move(x, y);
    if (m.moved && this.panel && inRect(x, y, this.panel)) {
      this.scrollY = Math.max(0, Math.min(this.maxScroll, this.scrollY - m.stepY));
      this._vy = m.stepY;
      this._lastScrollAt = Date.now();
      this._inertia = false;
      if (this.pressed) this.tap.clear(this.pressed);
      this.pressed = null;
    }
  }
  onTouchEnd(x, y) {
    const e = this.guard.end(x, y);
    if (this.pressed) this.tap.clear(this.pressed);
    this.tap.clear('back');
    this.pressed = null;
    // 松手时若仍有明显滚动速度，且未开启「减弱动效」，启动惯性滚动；否则直接吸附
    if (!M.theme.reduceMotion && Math.abs(this._vy) > 2) this._inertia = true;
    else { this._inertia = false; this._vy = 0; }
    if (!e.valid) return;
    // 通用 confirm 模态：命中按钮交给 ModalManager 解析（与 gameplay.js 同款处理），
    // 200ms 防穿透由 interactive() 保证；遮罩点击一律不关闭。
    if (this.sm && this.sm.modal && this.sm.modal.isOpen() && this.sm.modal.isGeneric()) {
      if (!this.sm.modal.interactive()) return;
      const act = this.sm.modal.hitGeneric(x, y);
      if (act) this.sm.modal.resolveGeneric(act);
      return;
    }
    // 顶部返回（面板外）
    for (const r of this.regions) {
      if (r.key === 'back' && inRect(x, y, r.rect)) {
        if (!this.tap.guard(Date.now(), 'back')) return;
        GameContext.emit('tap'); GameContext.emit('navigate', { to: this.from });
        GameContext.popScene(); return;
      }
    }
    if (!this.panel || !inRect(x, y, this.panel)) return;
    const key = this._panelKey(x, y);
    if (!key) return;
    // 命中具体 region：choice 行需取被点中选项的 value（而非第一个选项）
    const region = this.regions.find(r2 => r2.panelHit && r2.key === key && inRect(x, y, r2.rect));
    if (!this.tap.guard(Date.now(), 'set:' + key)) return;
    this._apply(key, region);
  }

  _panelKey(x, y) {
    for (const r of this.regions) if (r.panelHit && inRect(x, y, r.rect)) return r.key;
    return null;
  }

  _apply(key, region) {
    let choice;
    if (region && region.kind === 'choice') choice = region.choice;
    const res = applySettingKey(key, GameContext.getSettings(), choice);
    if (res.patch) {
      const ok = GameContext.saveSettings(res.patch);
      if (ok === false) GameContext.showBanner('设置未保存，请重试', 'danger');
      if (res.sound) GameContext.emit('toggle');
    }
    if (res.action === 'confirmClear') {
      const n = GameContext.listRecords().length;
      if (n === 0) {
        // 空态：仅信息提示，不出现危险操作（无「清空」按钮、无清空动作）
        GameContext.openModal('confirm', {
          title: '清空所有棋谱', message: '本机暂无棋谱',
          buttons: [{ label: '知道了', action: 'cancel', variant: 'secondary' }],
          onAction: () => {}
        });
        return;
      }
      const msg = '删除本机 ' + n + ' 局棋谱？此操作不可恢复。';
      GameContext.openModal('confirm', {
        title: '清空所有棋谱', message: msg,
        buttons: [{ label: '取消', action: 'cancel', variant: 'secondary' }, { label: '清空', action: 'confirm', variant: 'danger' }],
        onAction: (act) => {
          GameContext.closeModal();
          if (act === 'confirm') {
            const okc = GameContext.clearAllRecords();
            GameContext.showBanner(okc === false ? '清空失败' : '已清空所有棋谱', okc === false ? 'danger' : 'success');
            GameContext.emit(okc === false ? 'uiError' : 'saveRecord');
          }
        }
      });
    } else if (res.action === 'confirmAutoPrune') {
      GameContext.openModal('confirm', {
        title: '开启自动覆盖？',
        message: '棋谱满 50 局时，每次新增会永久删除本机最早一局，且不可恢复。是否开启？',
        buttons: [{ label: '取消', action: 'cancel', variant: 'secondary' }, { label: '开启', action: 'confirm', variant: 'danger' }],
        onAction: (act) => {
          GameContext.closeModal();
          if (act === 'confirm') {
            const ok = GameContext.saveSettings({ autoPrune: true });
            if (ok === false) GameContext.showBanner('设置未保存，请重试', 'danger');
          }
        }
      });
    } else if (res.action === 'toast') {
      GameContext.showBanner(res.message, 'info');
    } else {
      // 账号与隐私新 action 统一分发（与 gameplay.js 抽屉分支共用同一入口）。
      runAccountAction(res.action);
    }
  }
}

module.exports = SettingsScene;
module.exports.SettingsScene = SettingsScene;
module.exports.renderSettingsPanel = renderSettingsPanel;
module.exports.applySettingKey = applySettingKey;
module.exports.SETTING_DEFS = SETTING_DEFS;
module.exports.GROUPS = GROUPS;
// 账号与隐私：供 gameplay.js settingsDrawer 分支分发，及回归脚本断言动态状态文案。
module.exports.runAccountAction = runAccountAction;
module.exports.authStatusHint = authStatusHint;
// 基本资料昵称读写（供 gameplay 记录远程对端昵称 / 棋谱链路复用，仅导出不改实现）
module.exports.readProfile = readProfile;
module.exports.cleanNickname = cleanNickname;
module.exports.writeProfile = writeProfile;
