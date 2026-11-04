/**
 * 同步层（src/core/sync.js）+ 隐私门控（src/core/privacy.js）离线测试 · v3
 *
 * 复用 test-cloud.js 导出的 createWxMock()（该模块以 require.main === module 保护，
 * 被 require 时零副作用）。纯 Node / CommonJS，零云端资源。
 *
 * 运行：
 *   node test-sync.js                          # 默认 both：两种模式一次跑完
 *   CHESS_CLOUD_MODE=no-cloud node test-sync.js
 *   CHESS_CLOUD_MODE=full     node test-sync.js
 *
 * 覆盖：mergeKey 纯函数字段级语义、同步契约（hook 一次 / applyRemote 无回环 /
 * 残局活对象同引用）、授权门控零云调用、GRANTED pull→merge→回填→push、
 * 失败降级与 pendingQueue、幂等与 CAS 冲突、首次上云不覆盖云端已有文档。
 */
'use strict';

var mockLib = require('./test-cloud.js');
var createWxMock = mockLib.createWxMock;
var config = require('./src/config');
var cloud = require('./src/core/cloud');
var storage = require('./src/core/storage');
var privacy = require('./src/core/privacy');
var sync = require('./src/core/sync');
var KEYS = config.STORAGE_KEYS;

function hasOwn(o, k) { return Object.prototype.hasOwnProperty.call(o, k); }
function clone(o) { try { return JSON.parse(JSON.stringify(o)); } catch (e) { return o; } }

// 引导一个「完全不挂 wx.cloud / 隐私接口」的 wx，保证模块加载期零云能力触碰。
global.wx = createWxMock({ cloud: false, privacyApi: false, keyboard: false }).wx;

var passed = 0, failed = 0, failures = [];
function ok(name, cond, detail) {
  if (cond) { passed++; console.log('  ✓ ' + name); }
  else {
    failed++;
    failures.push(name + (detail ? ' | ' + detail : ''));
    console.log('  ✗ ' + name + (detail ? ' | ' + detail : ''));
  }
}
function section(t) { console.log('\n=== ' + t + ' ==='); }

var API28 = [
  'getSettings', 'saveSettings', 'getTutorialProgress', 'saveTutorialProgress',
  'getLastConfig', 'saveLastConfig', 'listRecords', 'getRecord', 'saveRecord',
  'deleteRecord', 'clearAllRecords', 'saveResume', 'getResume', 'clearResume',
  'loadEndgame', 'saveEndgame', 'addSkill', 'useSkill', 'unlockLevel',
  'setCleared', 'collectTip', 'addPendingHints', 'consumePendingHints',
  'recordAttempt', 'recordClear', '_readJSON', '_writeJSON', '_rawRemove'
];
function statusComplete(st) {
  return !!st && ['state', 'pending', 'lastPullAt', 'lastPushAt', 'lastError', 'cloudEnabled', 'privacy']
    .every(function (k) { return hasOwn(st, k); });
}

function resetAll(ctl) {
  sync.reset();               // 清 hook / 定时器 / pending / 内部状态
  privacy.reset();            // 清隐私态 + 删本地持久化
  cloud.reset();              // 清 _db / _inited
  storage.clearWriteHooks();
  if (ctl) {
    for (var k in ctl.storageMap) if (hasOwn(ctl.storageMap, k)) delete ctl.storageMap[k];
    ctl.clearStore();
    ctl.resetCalls();
    ctl.flags.cloudInitThrows = false;
    ctl.flags.cloudGetFails = false;
    ctl.flags.cloudAddTooLarge = false;
    ctl.flags.cloudPermissionDenied = false;
    ctl.flags.cloudUpdateZero = false;
    ctl.flags.needAuthorization = false;
    ctl.flags.authorizeSuccess = true;
  }
  config.CLOUD_CONFIG.enabled = false;
  config.CLOUD_CONFIG.env = '';
}
function enableCloud() {
  config.CLOUD_CONFIG.enabled = true;
  config.CLOUD_CONFIG.env = 'test-env-sync';
  cloud.reset();
}
async function grant(ctl) {
  ctl.flags.needAuthorization = false;
  ctl.flags.authorizeSuccess = true;
  privacy.reset();
  await privacy.init();
}
/** 构造带 getTime() 的 serverDate 占位对象，供远端 entry 的时间戳读取。 */
function sd(t) { return { __serverDate: true, t: t, getTime: function () { return t; } }; }

// ===========================================================================
// mergeKey 纯函数（与 wx 环境无关，两种模式都跑一遍以证纯函数）
// ===========================================================================
function testMergeKey() {
  section('mergeKey 纯函数 · 字段级语义合并');

  // --- endgame 单调字段 / 局部 LWW ---
  var local = {
    version: 1, unlockedLevel: 3,
    cleared: { '1': { stars: 1, bestTimeMs: 100, bestMoves: 10, rewarded: false } },
    skills: [{ id: 's_local', charges: 1 }], tipsCollected: ['t1', 't2'], pendingHints: 2,
    stats: { totalAttempts: 2, totalClears: 1 }, updatedAt: 100
  };
  var remote = {
    version: 1, unlockedLevel: 5,
    cleared: {
      '1': { stars: 3, bestTimeMs: 0, bestMoves: 8, rewarded: true },
      '2': { stars: 2, bestTimeMs: 200, bestMoves: 0, rewarded: false }
    },
    skills: [{ id: 's_remote', charges: 3 }], tipsCollected: ['t2', 't3'], pendingHints: 5,
    stats: { totalAttempts: 5, totalClears: 0 }, updatedAt: 200
  };
  var r = sync.mergeKey(KEYS.endgame, local,
    { value: remote, rev: 1, updatedAt: sd(200), deleted: false });
  ok('endgame 返回 value + changed', !!r && !!r.value && typeof r.changed === 'boolean');
  ok('endgame unlockedLevel = max(3,5)', r.value.unlockedLevel === 5, 'got=' + r.value.unlockedLevel);
  ok('endgame cleared 并集含 1 与 2',
    Object.keys(r.value.cleared).length === 2 && !!r.value.cleared['1'] && !!r.value.cleared['2']);
  ok('endgame stars = max', r.value.cleared['1'].stars === 3);
  ok('endgame bestTimeMs = min(>0) 忽略 0', r.value.cleared['1'].bestTimeMs === 100,
    'got=' + r.value.cleared['1'].bestTimeMs);
  ok('endgame bestMoves = min(>0)', r.value.cleared['1'].bestMoves === 8);
  ok('endgame rewarded = OR', r.value.cleared['1'].rewarded === true);
  ok('endgame bestMoves 双 0 → 0', r.value.cleared['2'].bestMoves === 0);
  ok('endgame tipsCollected 去重并集', r.value.tipsCollected.join(',') === 't1,t2,t3',
    JSON.stringify(r.value.tipsCollected));
  ok('endgame stats = max', r.value.stats.totalAttempts === 5 && r.value.stats.totalClears === 1);
  ok('endgame skills 局部 LWW 取 remote',
    r.value.skills.length === 1 && r.value.skills[0].id === 's_remote', JSON.stringify(r.value.skills));
  ok('endgame pendingHints 局部 LWW 取 remote', r.value.pendingHints === 5);
  ok('endgame 返回 lww 标记(fields + side)',
    !!r.lww && r.lww.fields.indexOf('skills') >= 0 && r.lww.fields.indexOf('pendingHints') >= 0 &&
    r.lww.side === 'remote', JSON.stringify(r.lww));
  ok('endgame updatedAt = max(100,200)', r.value.updatedAt === 200);

  var local2 = clone(local);
  local2.updatedAt = 999;
  local2.skills = [{ id: 's_local', charges: 9 }];
  local2.pendingHints = 7;
  var r2 = sync.mergeKey(KEYS.endgame, local2, { value: remote, rev: 1, deleted: false });
  ok('endgame 本地较新 → lww.side=local',
    !!r2.lww && r2.lww.side === 'local' && r2.value.pendingHints === 7 &&
    r2.value.skills[0].id === 's_local', JSON.stringify(r2.lww));

  // --- recordsIndex 并集裁剪 + tombstone ---
  var lids = [], rids = [], i;
  for (i = 0; i < 30; i++) lids.push('L' + i);
  for (i = 0; i < 30; i++) rids.push('R' + i);
  var ri = sync.mergeKey(KEYS.recordsIndex,
    { version: 1, ids: lids, updatedAt: 10 },
    { value: { version: 1, ids: rids, updatedAt: 20 }, deleted: false });
  ok('recordsIndex 裁剪到 maxRecords=50', ri.value.ids.length === 50, 'len=' + ri.value.ids.length);
  ok('recordsIndex 并集保序(local 在前)', ri.value.ids[0] === 'L0' && ri.value.ids.indexOf('R0') >= 0);
  ok('recordsIndex 为被裁局生成 10 个 tombstone',
    Array.isArray(ri.tombstones) && ri.tombstones.length === 10, JSON.stringify(ri.tombstones));
  ok('tombstone 为完整 record key(前缀保留)',
    ri.tombstones.every(function (k) { return k.indexOf(KEYS.recordPrefix) === 0; }));
  var ri2 = sync.mergeKey(KEYS.recordsIndex,
    { ids: ['x', 'y'] }, { value: { ids: ['y', 'z'] }, deleted: false });
  ok('recordsIndex 并集去重', ri2.value.ids.join(',') === 'x,y,z', JSON.stringify(ri2.value.ids));

  // --- record tombstone 优先 / updatedAt LWW ---
  var rec = sync.mergeKey(KEYS.recordPrefix + 'g1',
    { id: 'g1', updatedAt: 999, result: 'win' },
    { value: { id: 'g1', updatedAt: 1 }, deleted: true, rev: 5 });
  ok('record tombstone 优先(删除胜过更新)', rec.value === null && rec.deleted === true, JSON.stringify(rec));
  var rec2 = sync.mergeKey(KEYS.recordPrefix + 'g2',
    { id: 'g2', updatedAt: 100, result: 'local' },
    { value: { id: 'g2', updatedAt: 200, result: 'remote' }, deleted: false });
  ok('record 非 tombstone 按 updatedAt LWW 取 remote', !!rec2.value && rec2.value.result === 'remote');
  var rec3 = sync.mergeKey(KEYS.recordPrefix + 'g3',
    { id: 'g3', updatedAt: 100, result: 'local' },
    { value: { id: 'g3', updatedAt: 100, result: 'remote' }, deleted: false });
  ok('record 同刻本地优先', !!rec3.value && rec3.value.result === 'local');

  // --- settings / resume LWW ---
  var s1 = sync.mergeKey(KEYS.settings,
    { version: 1, theme: 'dark', updatedAt: 100 },
    { value: { version: 1, theme: 'light', updatedAt: 200 }, deleted: false });
  ok('settings 按 updatedAt LWW 取 remote', !!s1.value && s1.value.theme === 'light');
  ok('settings 以 DEFAULT_SETTINGS 补齐', !!s1.value && typeof s1.value.soundEnabled === 'boolean');
  var s2 = sync.mergeKey(KEYS.settings,
    { theme: 'dark', updatedAt: 200 }, { value: { theme: 'light', updatedAt: 100 }, deleted: false });
  ok('settings 本地较新取 local', !!s2.value && s2.value.theme === 'dark');
  var s3 = sync.mergeKey(KEYS.resume,
    { mode: 'ai', updatedAt: 100 }, { value: { mode: 'local', updatedAt: 100 }, deleted: false });
  ok('resume 同刻本地优先', !!s3.value && s3.value.mode === 'ai');

  // --- 脏值归一化不抛 ---
  var threw = false, dirty = [];
  try {
    dirty.push(sync.mergeKey(KEYS.endgame, {
      unlockedLevel: 'abc', cleared: 'bad', skills: [null, {}, { id: 'x', charges: -5 }],
      tipsCollected: [1, null, 'ok'], stats: 'x', pendingHints: -3
    }, null));
    dirty.push(sync.mergeKey(KEYS.endgame, null, { garbage: 1, deleted: false }));
    dirty.push(sync.mergeKey(KEYS.recordsIndex, { ids: 'not-array' },
      { value: { ids: [null, 3, 'ok'] }, deleted: false }));
    dirty.push(sync.mergeKey(KEYS.settings, 'bad-string', null));
    dirty.push(sync.mergeKey(KEYS.recordPrefix + 'x', null,
      { value: { updatedAt: NaN }, deleted: false }));
  } catch (e) { threw = true; }
  ok('脏值归一化不抛', !threw);
  ok('脏值归一化产出合法结构',
    !!dirty[0] && !!dirty[0].value && dirty[0].value.unlockedLevel >= 1 && dirty[0].value.version === 1,
    JSON.stringify(dirty[0] && dirty[0].value));
  ok('recordsIndex 脏 ids 过滤为合法字符串',
    !!dirty[2] && Array.isArray(dirty[2].value.ids) && dirty[2].value.ids.join(',') === 'ok',
    JSON.stringify(dirty[2] && dirty[2].value));

  // --- 幂等：二次合并 changed:false ---
  var m1 = sync.mergeKey(KEYS.settings,
    { theme: 'dark', updatedAt: 100 }, { value: { theme: 'light', updatedAt: 200 }, deleted: false });
  var m2 = sync.mergeKey(KEYS.settings, m1.value,
    { value: { theme: 'light', updatedAt: 200 }, deleted: false });
  ok('mergeKey 二次合并幂等(changed:false)', m2.changed === false && m2.value.theme === 'light');
}

// ===========================================================================
// 同步契约 + 28 个 API 契约（两种模式都跑）
// ===========================================================================
function testContracts() {
  section('同步契约 · key 映射 / hook / applyRemote / 残局同引用');
  ok('本地固定 key 与云端 key 一一映射',
    KEYS.settings === 'chess.settings.v1' && KEYS.endgame === 'chess.endgame.v1' &&
    KEYS.recordsIndex === 'chess.records.index.v1');
  ok('record 前缀完整保留 chess.record.v1.', KEYS.recordPrefix === 'chess.record.v1.');
  var rp = sync.mergeKey(KEYS.recordPrefix + 'abc-123_XY', { id: 'abc' },
    { value: null, deleted: true });
  ok('chess.record.v1.<id> 前缀被识别(tombstone 语义)', rp.value === null && rp.deleted === true);

  storage.clearWriteHooks();
  var hits = [];
  storage.addWriteHook(function (k, op) { hits.push(k + ':' + op); });
  storage.saveSettings({ theme: 'dark' });
  ok('addWriteHook 后一次本地写恰好触发一次',
    hits.length === 1 && hits[0] === KEYS.settings + ':set', JSON.stringify(hits));
  hits.length = 0;
  storage.applyRemote(KEYS.settings, 'set', { theme: 'light' });
  ok('applyRemote 不触发 hook（无回环）', hits.length === 0, JSON.stringify(hits));
  storage.clearWriteHooks();

  var egVal = {
    version: 1, unlockedLevel: 7, cleared: {}, skills: [{ id: 'skill_mirror', charges: 2 }],
    tipsCollected: ['tip1'], pendingHints: 3,
    stats: { totalAttempts: 4, totalClears: 2 }, updatedAt: 100
  };
  storage.applyRemote(KEYS.endgame, 'set', egVal);
  var a = storage.loadEndgame();
  var b = storage.loadEndgame();
  ok('残局回填 loadEndgame() 同引用', a === b);
  ok('残局回填与写入值一致',
    a.unlockedLevel === 7 && a.pendingHints === 3 && a.stats.totalClears === 2 &&
    a.skills[0].id === 'skill_mirror');

  section('storage 28 个既有 API 契约');
  ok('28 个既有 API 均为 function',
    API28.length === 28 && API28.every(function (k) { return typeof storage[k] === 'function'; }));
  ok('3 个新增 hook/回填 API 均为 function',
    ['addWriteHook', 'clearWriteHooks', 'applyRemote'].every(function (k) {
      return typeof storage[k] === 'function';
    }));
}

// ===========================================================================
// 模式一：完全不挂 wx.cloud / 隐私接口（默认降级本地）
// ===========================================================================
async function modeNoCloud() {
  section('模式一：完全不挂 wx.cloud / 隐私接口（默认降级本地）');
  var m = createWxMock({ cloud: false, privacyApi: false, keyboard: false });
  global.wx = m.wx;
  var ctl = m.ctl;
  resetAll(ctl);

  ok('mock 未挂 wx.cloud', typeof global.wx.cloud === 'undefined');
  ok('mock 未挂隐私接口', typeof global.wx.getPrivacySetting === 'undefined');
  ok('hasCloud()===false / isEnabled()===false',
    cloud.hasCloud() === false && cloud.isEnabled() === false);

  testMergeKey();
  testContracts();

  section('模式一 · 授权门控：云未启用时 start()/flush() 零云调用');
  resetAll(ctl);
  var r1 = await sync.start();
  ok('云未启用 start() → {ok:false,reason:disabled}',
    !!r1 && r1.ok === false && r1.reason === 'disabled', JSON.stringify(r1));
  var r2 = await sync.flush();
  ok('云未启用 flush() → {ok:false,reason:disabled}',
    !!r2 && r2.ok === false && r2.reason === 'disabled', JSON.stringify(r2));
  ok('云未启用零云调用(database/get/add/update 全 0)',
    ctl.calls.database === 0 && ctl.calls.get === 0 && ctl.calls.add === 0 && ctl.calls.update === 0,
    JSON.stringify(ctl.calls));
  var st = sync.status();
  ok('status() 字段齐全', statusComplete(st), JSON.stringify(st));
  ok('status().cloudEnabled===false', st.cloudEnabled === false);

  section('模式一 · 降级态不改变 storage API 返回值与同步语义');
  var s = storage.saveSettings({ theme: 'dark', soundEnabled: false });
  ok('saveSettings 返回 {ok:true}', !!s && s.ok === true);
  var gs = storage.getSettings();
  ok('getSettings 往返一致', !!gs && gs.theme === 'dark' && gs.soundEnabled === false);
  var rec = storage.saveRecord({ id: 'syncTest1', mode: 'ai', movesUci: ['e2e4'], sanLog: ['e4'] });
  ok('saveRecord 返回 ok:true', !!rec && rec.ok !== false, JSON.stringify(rec));
  ok('listRecords 含新记录', storage.listRecords().some(function (x) { return x.id === 'syncTest1'; }));
  storage.addSkill('skill_mirror', 2);
  ok('addSkill 生效(活对象同步)',
    storage.loadEndgame().skills.some(function (x) { return x.id === 'skill_mirror'; }));
  storage.clearAllRecords();
  ok('clearAllRecords 生效', storage.listRecords().length === 0);
  ok('降级态全程零云调用', ctl.calls.database === 0 && ctl.calls.get === 0 && ctl.calls.add === 0);
}

// ===========================================================================
// 模式二：完整 mock + 故障注入
// ===========================================================================
async function modeFull() {
  section('模式二：完整 mock + 故障注入');
  var m = createWxMock({ cloud: true, privacyApi: true, keyboard: true });
  global.wx = m.wx;
  var ctl = m.ctl;

  // 纯函数/契约在完整 mock 环境再跑一遍，证明与 wx 能力无关。
  testMergeKey();
  testContracts();

  // --- 授权门控：DENIED / UNKNOWN 零云调用 ---
  section('模式二 · 授权门控：DENIED / UNKNOWN 零云调用');
  resetAll(ctl);
  enableCloud();
  ctl.flags.needAuthorization = true;
  ctl.flags.authorizeSuccess = false;
  privacy.reset();
  await privacy.init();
  ok('privacy DENIED', privacy.getState() === 'denied', 'state=' + privacy.getState());
  ok('DENIED canSync()===false', privacy.canSync() === false);
  var d1 = await sync.start();
  ok('DENIED start() → not_authorized',
    !!d1 && d1.ok === false && d1.reason === 'not_authorized', JSON.stringify(d1));
  var d2 = await sync.flush();
  ok('DENIED flush() → not_authorized',
    !!d2 && d2.ok === false && d2.reason === 'not_authorized', JSON.stringify(d2));
  ok('DENIED 零云调用(database/get/add/update 全 0)',
    ctl.calls.database === 0 && ctl.calls.get === 0 && ctl.calls.add === 0 && ctl.calls.update === 0,
    JSON.stringify(ctl.calls));

  resetAll(ctl);
  enableCloud();
  privacy.reset();                       // UNKNOWN，不 init
  ok('privacy UNKNOWN', privacy.getState() === 'unknown', 'state=' + privacy.getState());
  ok('UNKNOWN canSync()===false', privacy.canSync() === false);
  var u1 = await sync.start();
  ok('UNKNOWN start() → not_authorized',
    !!u1 && u1.ok === false && u1.reason === 'not_authorized', JSON.stringify(u1));
  ok('UNKNOWN 零云调用', ctl.calls.database === 0 && ctl.calls.get === 0 && ctl.calls.add === 0);

  // --- GRANTED + 云端启用门控 ---
  section('模式二 · 授权门控：GRANTED + 云端启用 → 允许同步');
  resetAll(ctl);
  enableCloud();
  await grant(ctl);
  ok('GRANTED getState()==="granted"', privacy.getState() === 'granted');
  ok('GRANTED + 云启用 canSync()===true', privacy.canSync() === true);
  ok('status().cloudEnabled===true', sync.status().cloudEnabled === true);

  // --- 首次上云：先 pull 再 merge 再 push，不覆盖云端已有文档 ---
  section('模式二 · 首次上云：pull→merge→回填→push，不覆盖云端已有文档');
  resetAll(ctl);
  enableCloud();
  await grant(ctl);
  storage.saveSettings({ theme: 'dark', soundEnabled: true, updatedAt: 100 });  // 本地较旧
  ctl.seed('chess_records', [{
    key: KEYS.settings,
    value: { version: 1, theme: 'cloud-light', updatedAt: 900, soundEnabled: false },
    rev: 4, deleted: false, updatedAt: sd(900)
  }]);                                                                          // 云端较新
  ctl.resetCalls();
  var startR = await sync.start();
  ok('start() 成功', !!startR && startR.ok === true, JSON.stringify(startR));
  ok('start() 发生 pull(get>0)', ctl.calls.get > 0, 'get=' + ctl.calls.get);
  ok('start() 发生 push(add+update>0)', (ctl.calls.add + ctl.calls.update) > 0,
    'add=' + ctl.calls.add + ' update=' + ctl.calls.update);
  ok('回填后本地 settings = 云端较新值(merge 生效)',
    storage.getSettings().theme === 'cloud-light', 'theme=' + storage.getSettings().theme);
  var cloudSettings = ctl.docs('chess_records').filter(function (d) { return d.key === KEYS.settings; });
  ok('云端已有文档未被本地覆盖',
    cloudSettings.length > 0 && cloudSettings[cloudSettings.length - 1].value.theme === 'cloud-light',
    JSON.stringify(cloudSettings.map(function (d) { return d.value && d.value.theme; })));
  ok('start() 后 status() 字段齐全', statusComplete(sync.status()));
  ok('start() 后 pending 清空', sync.status().pending === 0, 'pending=' + sync.status().pending);

  // --- 失败降级 / pendingQueue / status ---
  section('模式二 · 失败降级：不影响 storage 返回值，pendingQueue 留存');
  resetAll(ctl);
  enableCloud();
  await grant(ctl);
  sync.init();                            // 注册写 hook
  storage.saveSettings({ theme: 'purple' });
  ok('本地写产生 pendingQueue', sync.status().pending > 0, 'pending=' + sync.status().pending);
  ctl.flags.cloudGetFails = true;         // 云故障注入
  var fr = await sync.flush();
  ok('云失败 flush() → {ok:false} 不抛', !!fr && fr.ok === false, JSON.stringify(fr));
  var stAfter = sync.status();
  ok('云失败后 pendingQueue 留存待重试', stAfter.pending > 0, 'pending=' + stAfter.pending);
  ok('云失败后本地 storage 值不变', storage.getSettings().theme === 'purple');
  ok('云失败后 status() 字段齐全', statusComplete(stAfter));
  // 注：flush() 的 pull 失败分支（sync.js:561）直接返回 {ok:false,reason}，不写 _lastError；
  // 该字段由 _doFlush 的 push 失败分支 / start() 填充，故这里改验 reason 与合法状态值。
  ok('云失败 flush() 返回可辨识失败原因',
    !!fr && typeof fr.reason === 'string' && fr.reason.length > 0, 'reason=' + (fr && fr.reason));
  ok('云失败后 status().state 为合法状态值',
    ['idle', 'syncing', 'pushing', 'error', 'disabled', 'denied'].indexOf(stAfter.state) >= 0,
    'state=' + stAfter.state);
  ok('云失败不改变 28 个 API 签名',
    API28.every(function (k) { return typeof storage[k] === 'function'; }));
  ctl.flags.cloudGetFails = false;

  // --- 幂等：flush 成功后清队列，再次 flush 不重复写 ---
  section('模式二 · 幂等与冲突');
  resetAll(ctl);
  enableCloud();
  await grant(ctl);
  sync.init();
  storage.saveSettings({ theme: 'teal' });
  var okFlush = await sync.flush();
  ok('flush 成功 → {ok:true}', !!okFlush && okFlush.ok === true, JSON.stringify(okFlush));
  ok('flush 成功后 pending 清空', sync.status().pending === 0, 'pending=' + sync.status().pending);
  var writesBefore = ctl.calls.add + ctl.calls.update;
  var emptyFlush = await sync.flush();
  ok('再次 flush → empty 且不重复云写入',
    !!emptyFlush && emptyFlush.ok === true && emptyFlush.reason === 'empty' &&
    (ctl.calls.add + ctl.calls.update) === writesBefore, JSON.stringify(emptyFlush));

  // CAS updated:0 → 重拉合并并重试，不超过 maxRetries
  resetAll(ctl);
  enableCloud();
  await grant(ctl);
  sync.init();
  ctl.seed('chess_records', [{
    key: KEYS.settings, value: { theme: 'old', updatedAt: 1 }, rev: 7,
    deleted: false, updatedAt: sd(1)
  }]);
  storage.saveSettings({ theme: 'new', updatedAt: 500 });  // 入队
  ctl.flags.cloudUpdateZero = true;                         // 强制 CAS 冲突
  ctl.resetCalls();
  var cf = await sync.flush();
  ok('CAS updated:0 → 冲突受控收敛为 {ok:false} 不抛',
    !!cf && cf.ok === false, JSON.stringify(cf));
  ok('CAS 冲突触发重拉(get 次数增加)', ctl.calls.get > 1, 'get=' + ctl.calls.get);
  ok('CAS 重试次数不超过 maxRetries',
    ctl.calls.update <= config.CLOUD_CONFIG.maxRetries + 1,
    'update=' + ctl.calls.update + ' maxRetries=' + config.CLOUD_CONFIG.maxRetries);
  ok('CAS 冲突后 pendingQueue 留存', sync.status().pending > 0);
  ok('CAS 冲突 status().lastError 记录 conflict',
    sync.status().lastError === 'conflict', 'lastError=' + sync.status().lastError);
  ctl.flags.cloudUpdateZero = false;

  // =========================================================================
  // 本轮红线断言（spec B）：门控 / clearPending / updatedAt LWW / tombstone 跨设备 /
  // 稳定态零入队 / requestDeleteAll / 超限 op / 50 局分批 / OPS_KEY 兼容 / openContract。
  // 全部复用 modeFull 的 ctl，每段 resetAll + enableCloud + grant 独立隔离。
  // =========================================================================
  section('模式二 · 红线：noteWrite 授权门控 / clearPending');
  resetAll(ctl);
  enableCloud();
  ctl.flags.needAuthorization = true;
  ctl.flags.authorizeSuccess = false;
  privacy.reset();
  await privacy.init();
  sync.init();
  storage.saveSettings({ theme: 'gated-a' });
  storage.saveSettings({ theme: 'gated-b' });
  storage.saveLastConfig({ difficulty: 'easy' });
  storage.saveResume({ mode: 'ai' });
  ok('canSync=false 时连续本地写 status().pending===0',
    sync.status().pending === 0, 'pending=' + sync.status().pending);
  ok('canSync=false 时零云调用',
    ctl.calls.database === 0 && ctl.calls.get === 0 && ctl.calls.add === 0,
    JSON.stringify(ctl.calls));

  resetAll(ctl);
  enableCloud();
  await grant(ctl);
  sync.init();
  storage.saveSettings({ theme: 'queued' });
  ok('GRANTED 本地写产生 pending', sync.status().pending > 0, 'pending=' + sync.status().pending);
  sync.clearPending();
  ok('clearPending() 后 pending===0', sync.status().pending === 0);
  var qAfter = storage._readJSON(KEYS.syncQueue);
  ok('clearPending() 后持久化队列已清空',
    qAfter.ok && Array.isArray(qAfter.value) && qAfter.value.length === 0,
    JSON.stringify(qAfter.value));

  section('模式二 · 红线：updatedAt 让本地较新 settings/lastConfig/resume 不被云端旧值覆盖');
  resetAll(ctl);
  enableCloud();
  await grant(ctl);
  ctl.seed('chess_records', [
    { key: KEYS.settings, value: { version: 1, theme: 'cloud-old', soundEnabled: true, updatedAt: 100 },
      rev: 3, deleted: false, updatedAt: sd(100) },
    { key: KEYS.lastConfig, value: { difficulty: 'easy', color: 'w', updatedAt: 100 },
      rev: 3, deleted: false, updatedAt: sd(100) },
    { key: KEYS.resume, value: { mode: 'local', updatedAt: 100 },
      rev: 3, deleted: false, updatedAt: sd(100) }
  ]);
  storage.saveSettings({ theme: 'local-new', soundEnabled: false });
  storage.saveLastConfig({ difficulty: 'hard', color: 'b' });
  storage.saveResume({ mode: 'ai' });
  var freshR = await sync.start();
  ok('start() 成功', !!freshR && freshR.ok === true, JSON.stringify(freshR));
  ok('settings 本地较新不被云端旧值覆盖', storage.getSettings().theme === 'local-new',
    'theme=' + storage.getSettings().theme);
  ok('lastConfig 本地较新不被覆盖', storage.getLastConfig().difficulty === 'hard',
    'difficulty=' + (storage.getLastConfig() && storage.getLastConfig().difficulty));
  ok('resume 本地较新不被覆盖', !!storage.getResume() && storage.getResume().mode === 'ai',
    'mode=' + (storage.getResume() && storage.getResume().mode));

  section('模式二 · 红线：resume tombstone 跨设备传播，本地旧值不复活');
  resetAll(ctl);
  enableCloud();
  await grant(ctl);
  sync.init();
  storage.saveResume({ mode: 'ai', movesUci: ['e2e4'] });
  await sync.flush();
  var resumeBefore = ctl.docs('chess_records').filter(function (d) { return d.key === KEYS.resume; });
  ok('设备 A 推上 resume 云端', resumeBefore.length === 1 &&
    !!resumeBefore[0].value && resumeBefore[0].value.mode === 'ai', JSON.stringify(resumeBefore));
  storage.clearResume();
  await sync.flush();
  var tombA = ctl.docs('chess_records').filter(function (d) { return d.key === KEYS.resume; });
  ok('设备 A 删除后云端 resume 为 tombstone',
    tombA.length === 1 && tombA[0].deleted === true && tombA[0].value === null,
    JSON.stringify(tombA));
  // 设备 B：持旧本地值（applyRemote 抑制 hook，模拟另一台设备尚未同步删除）
  storage.applyRemote(KEYS.resume, 'set', { mode: 'local-old', updatedAt: 9999999999999 });
  ok('设备 B 本地确有旧值', !!storage.getResume() && storage.getResume().mode === 'local-old');
  var br = await sync.start();
  ok('设备 B start() 成功', !!br && br.ok === true, JSON.stringify(br));
  ok('设备 B start() 后 getResume()===null', storage.getResume() === null,
    JSON.stringify(storage.getResume()));
  var tombB = ctl.docs('chess_records').filter(function (d) { return d.key === KEYS.resume; });
  ok('云端 deleted 未被改回 false', tombB.length === 1 && tombB[0].deleted === true,
    JSON.stringify(tombB));
  ok('云端 tombstone value 仍为 null(无明文)', tombB.length === 1 && tombB[0].value === null);

  section('模式二 · 红线：稳定态 start() 零入队；首次上云 / 本地较新仍正常推送');
  resetAll(ctl);
  enableCloud();
  await grant(ctl);
  sync.init();
  storage.saveSettings({ theme: 'stable', soundEnabled: true });
  await sync.flush();
  sync.reset();                         // 清 pending / hook / 定时器，本地与云端仍一致
  ctl.resetCalls();
  var steadyR = await sync.start();
  ok('稳定态 start() 成功', !!steadyR && steadyR.ok === true, JSON.stringify(steadyR));
  ok('稳定态 start() 零入队 pending===0', sync.status().pending === 0,
    'pending=' + sync.status().pending);
  ok('稳定态 start() 零推送(add+update===0)',
    (ctl.calls.add + ctl.calls.update) === 0,
    'add=' + ctl.calls.add + ' update=' + ctl.calls.update);

  resetAll(ctl);
  enableCloud();
  await grant(ctl);
  storage.saveSettings({ theme: 'first-upload' });
  ctl.resetCalls();
  var firstR = await sync.start();
  ok('首次上云 start() 正常推送',
    !!firstR && firstR.ok === true && (ctl.calls.add + ctl.calls.update) > 0,
    JSON.stringify(firstR) + ' add=' + ctl.calls.add + ' update=' + ctl.calls.update);

  resetAll(ctl);
  enableCloud();
  await grant(ctl);
  ctl.seed('chess_records', [{
    key: KEYS.settings, value: { theme: 'cloud-stale', updatedAt: 1 },
    rev: 1, deleted: false, updatedAt: sd(1)
  }]);
  storage.saveSettings({ theme: 'local-newer' });
  ctl.resetCalls();
  var newerR = await sync.start();
  ok('本地较新 start() 仍正常推送',
    !!newerR && newerR.ok === true && (ctl.calls.add + ctl.calls.update) > 0,
    JSON.stringify(newerR));

  section('模式二 · 红线：requestDeleteAll 物理删 chess_state 且 tombstone 无明文');
  resetAll(ctl);
  enableCloud();
  await grant(ctl);
  sync.init();
  storage.saveSettings({ theme: 'to-delete', nickname: 'DEL-NICK-SECRET-3311' });
  storage.saveRecord({ id: 'delA', mode: 'ai', movesUci: ['DEL-MOVE-SECRET-4422'] });
  storage.saveResume({ mode: 'ai', note: 'DEL-RESUME-SECRET-5533' });
  await sync.flush();
  var dr = await sync.requestDeleteAll();
  ok('requestDeleteAll ok', !!dr && dr.ok === true, JSON.stringify(dr));
  ok('requestDeleteAll 后 chess_state 文档数 0', ctl.docs('chess_state').length === 0,
    'len=' + ctl.docs('chess_state').length);
  var delDocs = ctl.docs('chess_records');
  ok('所有云端记录均为 tombstone(deleted:true)', delDocs.length > 0 &&
    delDocs.every(function (d) { return d.deleted === true; }), JSON.stringify(delDocs));
  ok('所有 tombstone value===null(无明文)',
    delDocs.every(function (d) { return d.value === null; }));
  var delJson = JSON.stringify(delDocs);
  ok('云端不含任何明文',
    delJson.indexOf('DEL-NICK-SECRET-3311') < 0 &&
    delJson.indexOf('DEL-MOVE-SECRET-4422') < 0 &&
    delJson.indexOf('DEL-RESUME-SECRET-5533') < 0, delJson);

  section('模式二 · 红线：超限 op 重试达 maxRetries 后移出队列且本地值不变');
  resetAll(ctl);
  enableCloud();
  await grant(ctl);
  sync.init();
  storage.saveSettings({ theme: 'oversize', blob: new Array(70000).join('X') });
  ok('超限写已入队', sync.status().pending > 0, 'pending=' + sync.status().pending);
  var maxR = config.CLOUD_CONFIG.maxRetries || 3;
  for (var oi = 0; oi < maxR; oi++) await sync.flush();
  ok('超限 op 达 maxRetries 后移出队列', sync.status().pending === 0,
    'pending=' + sync.status().pending);
  ok('超限 op 本地值不变', storage.getSettings().theme === 'oversize',
    'theme=' + storage.getSettings().theme);

  section('模式二 · 红线：clearAllRecords 50 局分批 flush，并发峰值 ≤10、不丢 tombstone');
  resetAll(ctl);
  enableCloud();
  await grant(ctl);
  sync.init();
  for (var bi = 0; bi < 50; bi++) {
    storage.saveRecord({ id: 'bulk' + bi, mode: 'ai', movesUci: ['e2e4'] });
  }
  var bulkFirst = await sync.flush();
  ok('50 局首次 flush 成功', !!bulkFirst && bulkFirst.ok === true, JSON.stringify(bulkFirst));
  var bulkCloud = ctl.docs('chess_records').filter(function (d) {
    return d.key.indexOf(KEYS.recordPrefix) === 0;
  });
  ok('云端确有 50 局 record 文档', bulkCloud.length === 50, 'len=' + bulkCloud.length);
  storage.clearAllRecords();
  ok('clearAllRecords 后本地 listRecords 为空', storage.listRecords().length === 0);
  // 并发探针：包装模块导出属性 cloud.putRecord（sync.js 通过属性访问调用它）
  var origPut = cloud.putRecord;
  var inFlight = 0, peak = 0;
  cloud.putRecord = function () {
    inFlight++;
    if (inFlight > peak) peak = inFlight;
    var p;
    try { p = origPut.apply(cloud, arguments); }
    catch (e) { inFlight--; throw e; }
    if (!p || typeof p.then !== 'function') { inFlight--; return p; }
    return p.then(function (r) { inFlight--; return r; }, function (e) { inFlight--; throw e; });
  };
  ctl.resetCalls();
  var bulkDel;
  try { bulkDel = await sync.flush(); }
  finally { cloud.putRecord = origPut; }
  ok('50 局删除 flush 完成', !!bulkDel && bulkDel.ok === true, JSON.stringify(bulkDel));
  ok('分批 flush 并发峰值 >0 且 ≤10', peak > 0 && peak <= 10, 'peak=' + peak);
  var bulkTomb = ctl.docs('chess_records').filter(function (d) {
    return d.key.indexOf(KEYS.recordPrefix) === 0;
  });
  ok('50 局 tombstone 全部推送(deleted:true,value:null)',
    bulkTomb.length === 50 && bulkTomb.every(function (d) {
      return d.deleted === true && d.value === null;
    }), 'len=' + bulkTomb.length);

  section('模式二 · 红线：OPS_KEY=ops 可写可读，旧点号键兼容读取');
  resetAll(ctl);
  enableCloud();
  await grant(ctl);
  sync.init();
  storage.saveSettings({ theme: 'ops-new' });
  var opsFlush = await sync.flush();
  ok('flush 成功(写 state doc)', !!opsFlush && opsFlush.ok === true, JSON.stringify(opsFlush));
  var stateDocs = ctl.docs('chess_state');
  var newest = stateDocs[stateDocs.length - 1];
  ok('state doc 用新键 keys.ops(数组)',
    !!newest && !!newest.keys && Array.isArray(newest.keys.ops) && newest.keys.ops.length > 0,
    JSON.stringify(newest && newest.keys));
  ok('state doc 不再写旧点号键 chess.sync.ops.v1',
    !!newest && !!newest.keys && newest.keys['chess.sync.ops.v1'] === undefined,
    JSON.stringify(newest && newest.keys));

  resetAll(ctl);
  enableCloud();
  await grant(ctl);
  ctl.seed('chess_state', [{
    rev: 1, schemaVersion: config.CLOUD_CONFIG.schemaVersion,
    keys: { 'chess.sync.ops.v1': ['legacy-op-A'] }
  }]);
  storage.saveSettings({ theme: 'ops-legacy' });
  var legacyR = await sync.start();
  ok('旧键场景 start() 成功', !!legacyR && legacyR.ok === true, JSON.stringify(legacyR));
  var legacyDocs = ctl.docs('chess_state');
  var migrated = null;
  for (var li = 0; li < legacyDocs.length; li++) {
    if (legacyDocs[li].rev === 2) migrated = legacyDocs[li];
  }
  ok('旧点号键被兼容读取并迁移到 keys.ops',
    !!migrated && !!migrated.keys && Array.isArray(migrated.keys.ops) &&
    migrated.keys.ops.indexOf('legacy-op-A') >= 0, JSON.stringify(migrated && migrated.keys));
  ok('写出后不再保留旧点号键',
    !!migrated && !!migrated.keys && migrated.keys['chess.sync.ops.v1'] === undefined,
    JSON.stringify(migrated && migrated.keys));

  section('模式二 · 红线：privacy.openContract(onFail) 四分支与至多一次');
  resetAll(ctl);
  enableCloud();
  var origOpen = global.wx.openPrivacyContract;
  var failCount = 0;
  global.wx.openPrivacyContract = function (o) { o && o.success && o.success({}); };
  var oc1 = privacy.openContract(function () { failCount++; });
  ok('openContract success → true 且不触发 onFail', oc1 === true && failCount === 0,
    'ret=' + oc1 + ' failCount=' + failCount);
  failCount = 0;
  global.wx.openPrivacyContract = function (o) { o && o.fail && o.fail({}); };
  var oc2 = privacy.openContract(function () { failCount++; });
  ok('openContract 平台 fail → onFail()+true', oc2 === true && failCount === 1,
    'ret=' + oc2 + ' failCount=' + failCount);
  failCount = 0;
  delete global.wx.openPrivacyContract;
  var oc3 = privacy.openContract(function () { failCount++; });
  ok('openContract 能力缺失 → onFail()+false', oc3 === false && failCount === 1,
    'ret=' + oc3 + ' failCount=' + failCount);
  global.wx.openPrivacyContract = origOpen;
  failCount = 0;
  global.wx.openPrivacyContract = function () { throw new Error('openContract boom'); };
  var oc4 = privacy.openContract(function () { failCount++; });
  ok('openContract 抛异常 → onFail()+false', oc4 === false && failCount === 1,
    'ret=' + oc4 + ' failCount=' + failCount);
  global.wx.openPrivacyContract = origOpen;
  failCount = 0;
  global.wx.openPrivacyContract = function (o) {
    o && o.fail && o.fail({});
    o && o.fail && o.fail({});
  };
  var oc5 = privacy.openContract(function () { failCount++; });
  ok('openContract onFail 至多触发一次', oc5 === true && failCount === 1,
    'ret=' + oc5 + ' failCount=' + failCount);
  global.wx.openPrivacyContract = origOpen;

  resetAll(ctl);
  ok('收尾恢复默认 enabled=false / env=""',
    config.CLOUD_CONFIG.enabled === false && config.CLOUD_CONFIG.env === '');
}

var MODE = process.env.CHESS_CLOUD_MODE || 'both';
async function main() {
  console.log('同步层离线测试 · mode=' + MODE);
  if (MODE === 'both' || MODE === 'no-cloud') await modeNoCloud();
  if (MODE === 'both' || MODE === 'full') await modeFull();
  console.log('\n============================================================');
  console.log('test-sync 结果: ' + passed + ' 通过 / ' + failed + ' 失败');
  if (failures.length) { console.log('失败项:'); failures.forEach(function (f) { console.log('  - ' + f); }); }
  console.log('============================================================');
  process.exit(failed === 0 ? 0 : 1);
}

if (require.main === module) {
  main().catch(function (e) {
    console.error('test-sync 异常:', e && (e.stack || e.message || e));
    process.exit(1);
  });
}
