/**
 * 端到端「清缓存 / 换设备恢复」离线演练（本轮核心）
 *
 * 纯 Node / CommonJS，零云端资源、零真机依赖。用 test-cloud.js 导出的
 * createWxMock()（该模块以 require.main === module 保护，可安全 require）搭一份
 * **内存 wx.cloud + 内存 storage**，真实跑完整链路：
 *
 *   设备 A：用 storage 造真实进度 → sync.init() + flush() 推到云 → 断言云端确有这些 key/值
 *   清缓存：清空全部本地 storage（模拟清缓存 / 换设备）
 *   设备 B：清除 require.cache 重新加载 storage/sync/cloud（新进程语义） → sync.start()
 *           → pull → merge → applyRemote 回填 → 28 个读 API 逐项精确恢复
 *   场景自愈：mock 当前场景验证 pull 成功后 onDataChanged 被调用；真实调
 *           menu / endgameMap / academy 的 onDataChanged()，断言缓存字段从「无进度」刷新
 *   删除不复活：删除推 tombstone 后，另一台持旧本地值的设备 start() 仍读到 null
 *
 * 运行：node test-recovery.js
 * 输出：test-recovery 结果: N 通过 / 0 失败（失败时逐条列出）
 */
'use strict';

var path = require('path');
var fs = require('fs');
var ROOT = __dirname;
var createWxMock = require('./test-cloud.js').createWxMock;
var config = require('./src/config');     // 单一实例：不从 require.cache 清除，保证 CLOUD_CONFIG 共享
var KEYS = config.STORAGE_KEYS;

var API28 = [
  'getSettings', 'saveSettings', 'getTutorialProgress', 'saveTutorialProgress',
  'getLastConfig', 'saveLastConfig', 'listRecords', 'getRecord', 'saveRecord',
  'deleteRecord', 'clearAllRecords', 'saveResume', 'getResume', 'clearResume',
  'loadEndgame', 'saveEndgame', 'addSkill', 'useSkill', 'unlockLevel',
  'setCleared', 'collectTip', 'addPendingHints', 'consumePendingHints',
  'recordAttempt', 'recordClear', '_readJSON', '_writeJSON', '_rawRemove'
];

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

/** 规范化比较：递归排序对象键，消除键顺序差异，做「精确恢复」断言。 */
function canon(o) {
  if (o === null || o === undefined || typeof o !== 'object') return JSON.stringify(o);
  if (Array.isArray(o)) return '[' + o.map(canon).join(',') + ']';
  var keys = Object.keys(o).sort();
  return '{' + keys.map(function (k) { return JSON.stringify(k) + ':' + canon(o[k]); }).join(',') + '}';
}
function same(a, b) { return canon(a) === canon(b); }

// ---------------------------------------------------------------------------
// 内存 wx.cloud：设备 A / B / C 共享同一份云端 store（同一微信账号的同一份云副本），
// 本地 storage 则通过「清空 storageMap + 重新 require 模块」模拟不同设备 / 清缓存。
// ---------------------------------------------------------------------------
var m = createWxMock({ cloud: true, privacyApi: true, keyboard: true });
var ctl = m.ctl;
global.wx = m.wx;

config.CLOUD_CONFIG.enabled = true;
config.CLOUD_CONFIG.env = 'test-env-recovery';

function clearStorageMap() {
  for (var k in ctl.storageMap) {
    if (Object.prototype.hasOwnProperty.call(ctl.storageMap, k)) delete ctl.storageMap[k];
  }
}

/** 模拟新进程：清掉 src/ 下所有模块的 require.cache（保留 config.js）。
 *  保留 config.js 是为了让 CLOUD_CONFIG / STORAGE_KEYS 在所有设备里是同一对象。
 *  被清掉的模块（storage/cloud/privacy/sync 及场景链）下次 require 会拿到全新实例，
 *  同时清掉 storage 内部的 _endgame 活对象缓存，等价「换设备后首次加载」。 */
function purgeSrc() {
  var keep = require.resolve('./src/config');
  var prefix = path.join(ROOT, 'src') + path.sep;
  Object.keys(require.cache).forEach(function (p) {
    if (p === keep) return;
    if (p.indexOf(prefix) === 0) delete require.cache[p];
  });
}

function loadCore() {
  return {
    storage: require('./src/core/storage'),
    cloud: require('./src/core/cloud'),
    privacy: require('./src/core/privacy'),
    sync: require('./src/core/sync')
  };
}

async function grant(core) {
  core.privacy.reset();
  await core.privacy.init();   // getPrivacySetting → needAuthorization:false → GRANTED
  return core.privacy.getState();
}

function cloudDoc(key) {
  var list = ctl.docs('chess_records').filter(function (d) { return d.key === key; });
  return list.length ? list[list.length - 1] : null;
}

async function main() {
  // =========================================================================
  // 1) 设备 A：造真实进度并推到云
  // =========================================================================
  section('设备 A：用 storage 造真实进度（残局 / 棋谱 / 教学 / 配置 / 断点 / 昵称）');
  ctl.clearStore();
  clearStorageMap();
  purgeSrc();
  var A = loadCore();
  A.cloud.reset(); A.sync.reset(); A.privacy.reset();
  ok('设备 A 授权为 granted', (await grant(A)) === 'granted');
  A.sync.init();                    // 注册写 hook：之后的本地写自动入队

  var TIP_ID = 'tip_recovery_demo';
  try {
    var tipsMod = require('./src/data/endgames');
    if (tipsMod && Array.isArray(tipsMod.TIPS) && tipsMod.TIPS[0] && tipsMod.TIPS[0].id) {
      TIP_ID = tipsMod.TIPS[0].id;
    }
  } catch (e) { /* 数据层缺失时用兜底 id，不影响演练 */ }

  // 设置 / 教学 / 上次配置
  A.storage.saveSettings({ theme: 'ink', soundEnabled: false, defaultColor: 'b', fontSize: 'large' });
  A.storage.saveTutorialProgress({ completed: [true, true, true], lastLesson: 3 });
  A.storage.saveLastConfig({ difficulty: 'hard', color: 'b', style: 'coach' });

  // 3 条棋谱
  A.storage.saveRecord({ id: 'recAlpha', mode: 'ai', result: 'win', playerColor: 'w',
    difficulty: 'hard', movesUci: ['e2e4', 'e7e5', 'g1f3'], sanLog: ['e4', 'e5', 'Nf3'] });
  A.storage.saveRecord({ id: 'recBeta', mode: 'local', result: 'draw',
    movesUci: ['d2d4', 'd7d5'], sanLog: ['d4', 'd5'] });
  A.storage.saveRecord({ id: 'recGamma', mode: 'ai', result: 'loss',
    movesUci: ['c2c4'], sanLog: ['c4'] });

  // 400 步断点快照
  var moves400 = new Array(400).fill('e2e4');
  var san400 = new Array(400).fill('e4');
  A.storage.saveResume({ mode: 'ai', aiDepth: 3, playerColor: 'w',
    movesUci: moves400, sanLog: san400 });

  // 残局：解锁到第 6 阵 + 3 阵星级 + 技能 / 妙招 / 提示 / 统计
  A.storage.unlockLevel(6);
  A.storage.setCleared(1, { stars: 3, bestTimeMs: 12000, bestMoves: 8, rewarded: true });
  A.storage.setCleared(2, { stars: 2, bestTimeMs: 20000, bestMoves: 10, rewarded: false });
  A.storage.setCleared(3, { stars: 1, bestTimeMs: 30000, bestMoves: 12, rewarded: true });
  A.storage.addSkill('skill_mirror', 2);
  A.storage.collectTip(TIP_ID);
  A.storage.addPendingHints(3);
  A.storage.recordAttempt(); A.storage.recordAttempt(); A.storage.recordClear();

  // 用户自填昵称（profile 键）
  A.storage._writeJSON(KEYS.profile, { nickname: '墨金棋童', updatedAt: Date.now() });

  ok('设备 A 本地确有 3 条棋谱', A.storage.listRecords().length === 3);
  ok('设备 A 断点快照确为 400 步',
    !!A.storage.getResume() && A.storage.getResume().movesUci.length === 400);
  ok('设备 A 残局解锁到第 6 阵', A.storage.loadEndgame().unlockedLevel === 6);

  var flushA = await A.sync.flush();
  ok('设备 A flush() 推云成功', !!flushA && flushA.ok === true, JSON.stringify(flushA));
  ok('设备 A flush 后 pending 清空', A.sync.status().pending === 0);
  A.sync.reset();   // 清掉节流定时器，避免后续 await 期间自动 flush 干扰

  // 设备 A 造完后记一份期望值快照（供设备 B「精确恢复」逐项比对）
  var expected = {
    settings: A.storage.getSettings(),
    tutorial: A.storage.getTutorialProgress(),
    lastConfig: A.storage.getLastConfig(),
    records: A.storage.listRecords(),
    recAlpha: A.storage.getRecord('recAlpha'),
    recBeta: A.storage.getRecord('recBeta'),
    recGamma: A.storage.getRecord('recGamma'),
    resume: A.storage.getResume(),
    endgame: JSON.parse(JSON.stringify(A.storage.loadEndgame())),
    profile: A.storage._readJSON(KEYS.profile).value
  };

  // =========================================================================
  // 2) 断言云端确实有这些 key 与值
  // =========================================================================
  section('断言云端确实有这些 key 与值');
  var cloudKeys = [
    KEYS.settings, KEYS.tutorial, KEYS.lastConfig, KEYS.recordsIndex,
    KEYS.resume, KEYS.endgame, KEYS.profile,
    KEYS.recordPrefix + 'recAlpha', KEYS.recordPrefix + 'recBeta', KEYS.recordPrefix + 'recGamma'
  ];
  cloudKeys.forEach(function (k) {
    var d = cloudDoc(k);
    ok('云端含 key ' + k, !!d && d.deleted !== true && !!d.value,
      d ? JSON.stringify(d).slice(0, 160) : 'missing');
  });
  var cSettings = cloudDoc(KEYS.settings);
  ok('云端 settings.value.theme 正确', !!cSettings && cSettings.value.theme === 'ink');
  var cIndex = cloudDoc(KEYS.recordsIndex);
  ok('云端 recordsIndex 含 3 个 id', !!cIndex && !!cIndex.value &&
    cIndex.value.ids.length === 3, JSON.stringify(cIndex && cIndex.value));
  var cResume = cloudDoc(KEYS.resume);
  ok('云端 resume 400 步未丢', !!cResume && !!cResume.value &&
    cResume.value.movesUci.length === 400);
  var cEndgame = cloudDoc(KEYS.endgame);
  ok('云端 endgame.unlockedLevel=6 / cleared 3 阵', !!cEndgame && !!cEndgame.value &&
    cEndgame.value.unlockedLevel === 6 && Object.keys(cEndgame.value.cleared).length === 3);
  var cProfile = cloudDoc(KEYS.profile);
  ok('云端 profile 含昵称', !!cProfile && !!cProfile.value &&
    cProfile.value.nickname === '墨金棋童');

  // =========================================================================
  // 3) 清空所有本地 storage（模拟清缓存 / 换设备）
  // =========================================================================
  section('清缓存 / 换设备：清空全部本地 storage');
  clearStorageMap();
  // 用设备 A 的 storage 实例读，验证「本机已经什么都没有」
  ok('清缓存后 getLastConfig()===null', A.storage.getLastConfig() === null);
  ok('清缓存后 getResume()===null', A.storage.getResume() === null);
  ok('清缓存后 listRecords() 为空', A.storage.listRecords().length === 0);

  // =========================================================================
  // 4) 设备 B：重新 require（新进程语义）→ sync.start() 全量 pull→merge→回填
  // =========================================================================
  section('设备 B：清 require.cache 重新加载 storage/sync/cloud，sync.start() 全量 pull');
  purgeSrc();
  var B = loadCore();
  B.cloud.reset(); B.sync.reset(); B.privacy.reset();

  // 回填前（本地空）先构造三个真实场景，让缓存字段处于「无进度」态
  var MenuScene = require('./src/scenes/menu');
  var EndgameMapScene = require('./src/scenes/endgameMap');
  var AcademyScene = require('./src/scenes/academy');
  var menu = new MenuScene();
  var map = new EndgameMapScene();
  var academy = new AcademyScene();
  menu._refreshProgress();
  map.refreshProgress();
  academy._refreshProgress();
  ok('回填前 menu.cleared=0（无进度）', menu.cleared === 0, 'cleared=' + menu.cleared);
  ok('回填前 map.unlockedLevel=1（无进度）', map.unlockedLevel === 1);
  ok('回填前 academy.tipsCollected 为空（无进度）', academy.tipsCollected.length === 0);
  ok('回填前 academy.lessonIndex=0（无进度）', academy.lessonIndex === 0);
  ok('设备 B 回填前 getLastConfig()===null', B.storage.getLastConfig() === null);
  ok('设备 B 回填前 28 个 API 均为 function',
    API28.length === 28 && API28.every(function (k) { return typeof B.storage[k] === 'function'; }));

  ok('设备 B 授权为 granted', (await grant(B)) === 'granted');

  // game.js 接线静态核对（game.js 需 canvas/主循环，无法在 Node 直接执行，故静态验证接线存在）
  var gameSrc = fs.readFileSync(path.join(ROOT, 'game.js'), 'utf8');
  ok('game.js 含 notifySceneDataChanged / onDataChanged 接线',
    gameSrc.indexOf('notifySceneDataChanged') >= 0 && gameSrc.indexOf('onDataChanged') >= 0);
  ok('game.js 仅在 start 成功(res.ok)后通知场景',
    gameSrc.indexOf('if (res && res.ok) notifySceneDataChanged()') >= 0);
  ok('game.js 挂载 GameContext.requestCloudPull',
    gameSrc.indexOf('GameContext.requestCloudPull = requestCloudPull') >= 0);
  ok('game.js onShow 在 _cloudPullDone=false 时补做全量 pull',
    gameSrc.indexOf('_cloudPullDone') >= 0 && gameSrc.indexOf('sync.start()') >= 0);

  // 复刻 game.js:112-118 / 147-152 的接线语义：start() 成功后通知当前场景
  var sceneNotified = 0;
  var mockScene = { onDataChanged: function () { sceneNotified++; } };
  function wireScene(startPromise, scene) {
    return startPromise.then(function (res) {
      if (res && res.ok && scene && typeof scene.onDataChanged === 'function') scene.onDataChanged();
      return res;
    });
  }
  var startB = await wireScene(B.sync.start(), mockScene);
  ok('设备 B sync.start() 成功', !!startB && startB.ok === true, JSON.stringify(startB));
  ok('pull 成功后当前场景 onDataChanged 被调用',
    sceneNotified === 1, 'sceneNotified=' + sceneNotified);

  // =========================================================================
  // 5) 28 个读 API 逐项断言「所有数据精确恢复」
  // =========================================================================
  section('设备 B：28 个读 API 逐项断言所有数据精确恢复');
  ok('getSettings 精确恢复', same(B.storage.getSettings(), expected.settings),
    'got=' + JSON.stringify(B.storage.getSettings()));
  ok('getSettings.theme=ink / soundEnabled=false / defaultColor=b',
    B.storage.getSettings().theme === 'ink' &&
    B.storage.getSettings().soundEnabled === false &&
    B.storage.getSettings().defaultColor === 'b');
  ok('getTutorialProgress 精确恢复', same(B.storage.getTutorialProgress(), expected.tutorial));
  ok('getTutorialProgress.completed 3 项 / lastLesson=3',
    B.storage.getTutorialProgress().completed.length === 3 &&
    B.storage.getTutorialProgress().lastLesson === 3);
  ok('getLastConfig 精确恢复', same(B.storage.getLastConfig(), expected.lastConfig));
  ok('getLastConfig difficulty=hard / color=b / style=coach',
    !!B.storage.getLastConfig() && B.storage.getLastConfig().difficulty === 'hard' &&
    B.storage.getLastConfig().color === 'b' && B.storage.getLastConfig().style === 'coach');
  ok('listRecords 精确恢复 3 条', same(B.storage.listRecords(), expected.records));
  ok('listRecords 长度=3', B.storage.listRecords().length === 3);
  ok('getRecord(recAlpha) 精确恢复', same(B.storage.getRecord('recAlpha'), expected.recAlpha));
  ok('getRecord(recBeta) 精确恢复', same(B.storage.getRecord('recBeta'), expected.recBeta));
  ok('getRecord(recGamma) 精确恢复', same(B.storage.getRecord('recGamma'), expected.recGamma));
  ok('getRecord(recAlpha) result=win / movesUci 3 步',
    !!B.storage.getRecord('recAlpha') && B.storage.getRecord('recAlpha').result === 'win' &&
    B.storage.getRecord('recAlpha').movesUci.length === 3);
  ok('getResume 精确恢复', same(B.storage.getResume(), expected.resume));
  ok('getResume 400 步断点快照不丢',
    !!B.storage.getResume() && B.storage.getResume().movesUci.length === 400 &&
    B.storage.getResume().mode === 'ai');

  var egB = B.storage.loadEndgame();
  ok('loadEndgame().unlockedLevel=6', egB.unlockedLevel === 6, 'got=' + egB.unlockedLevel);
  ok('loadEndgame().cleared 含 3 阵', Object.keys(egB.cleared).length === 3,
    JSON.stringify(egB.cleared));
  ok('loadEndgame().cleared[1].stars=3 / bestMoves=8 / rewarded=true',
    !!egB.cleared['1'] && egB.cleared['1'].stars === 3 &&
    egB.cleared['1'].bestMoves === 8 && egB.cleared['1'].rewarded === true);
  ok('loadEndgame().cleared[2].stars=2 / cleared[3].stars=1',
    !!egB.cleared['2'] && egB.cleared['2'].stars === 2 &&
    !!egB.cleared['3'] && egB.cleared['3'].stars === 1);
  ok('loadEndgame().skills 恢复 skill_mirror charges=2',
    egB.skills.some(function (s) { return s.id === 'skill_mirror' && s.charges === 2; }),
    JSON.stringify(egB.skills));
  ok('loadEndgame().tipsCollected 恢复', egB.tipsCollected.indexOf(TIP_ID) >= 0,
    JSON.stringify(egB.tipsCollected));
  ok('loadEndgame().pendingHints=3', egB.pendingHints === 3, 'got=' + egB.pendingHints);
  ok('loadEndgame().stats totalAttempts=2 / totalClears=1',
    egB.stats.totalAttempts === 2 && egB.stats.totalClears === 1,
    JSON.stringify(egB.stats));
  ok('loadEndgame() 活对象同引用', B.storage.loadEndgame() === B.storage.loadEndgame());
  var profB = B.storage._readJSON(KEYS.profile);
  ok('_readJSON(profile) 昵称精确恢复', !!profB.ok && !!profB.value &&
    profB.value.nickname === '墨金棋童', JSON.stringify(profB.value));
  ok('设备 B start() 后 pending 清空', B.sync.status().pending === 0);

  // =========================================================================
  // 6a) 云回填后 UI 自愈：真实调 menu/endgameMap/academy 的 onDataChanged()
  // =========================================================================
  section('云回填后 UI 自愈：真实调用三个场景的 onDataChanged() 刷新缓存');
  ok('云已回填但场景缓存尚未通知前 menu.cleared 仍为 0', menu.cleared === 0);
  ok('云已回填但场景缓存尚未通知前 map.unlockedLevel 仍为 1', map.unlockedLevel === 1);

  // 给场景挂一些「不应被重置」的滚动 / 状态字段
  menu.pressed = 'keep-me';
  map.maxScroll = 200;   // 模拟已 render 过：onDataChanged 只钳制到合法范围，不应主动重置滚动
  map.scrollY = 50; map._pendingFocus = 7; map.pressed = 'keep-me';
  academy.scrollY = 30; academy.tipDetail = { id: 'keep' }; academy.pressed = 'keep-me';

  menu.onDataChanged();
  map.onDataChanged();
  academy.onDataChanged();

  ok('menu.onDataChanged 后 cleared 刷为云端值 5', menu.cleared === 5, 'cleared=' + menu.cleared);
  ok('menu.onDataChanged 后 hasProgress=true', menu.hasProgress === true);
  ok('menu.onDataChanged 不重置按压态', menu.pressed === 'keep-me');
  ok('map.onDataChanged 后 unlockedLevel 刷为 6', map.unlockedLevel === 6,
    'unlockedLevel=' + map.unlockedLevel);
  ok('map.onDataChanged 后 cleared 刷为云端 3 阵',
    Object.keys(map.cleared).length === 3, JSON.stringify(map.cleared));
  ok('map.onDataChanged 不重置滚动 / 焦点 / 按压态',
    map.scrollY === 50 && map._pendingFocus === 7 && map.pressed === 'keep-me',
    'scrollY=' + map.scrollY + ' focus=' + map._pendingFocus + ' pressed=' + map.pressed);
  ok('academy.onDataChanged 后 tipsCollected 刷为云端值',
    academy.tipsCollected.length > 0 && academy.tipsCollected.indexOf(TIP_ID) >= 0,
    JSON.stringify(academy.tipsCollected));
  ok('academy.onDataChanged 后 lessonIndex 刷为 3', academy.lessonIndex === 3,
    'lessonIndex=' + academy.lessonIndex);
  ok('academy.onDataChanged 不重置滚动 / 详情 / 按压态',
    academy.scrollY === 30 && !!academy.tipDetail && academy.pressed === 'keep-me');
  // 注意：此处保留 sync 的写 hook（start() 内 init() 注册的），供下方删除阶段自动入队；
  // 不调 sync.reset()，否则 deleteRecord / clearResume 不会触发 noteWrite。

  // =========================================================================
  // 6b) 删除不复活：设备 A' 删除推 tombstone，另一台持旧本地值也不复活
  // =========================================================================
  section('删除不复活：deleteRecord + clearResume 推 tombstone 后另一设备不复活');
  // 记录设备 B 本地「旧值」（删除前），用于稍后模拟另一台离线设备仍持有这些旧数据
  var oldRecRaw = ctl.storageMap[KEYS.recordPrefix + 'recAlpha'];
  var oldResumeRaw = ctl.storageMap[KEYS.resume];
  ok('删除前确有旧本地值', !!oldRecRaw && !!oldResumeRaw);

  // 设备 B 充当删除方：start() 已注册 hook，直接删并 flush
  B.storage.deleteRecord('recAlpha');
  B.storage.clearResume();
  var delFlush = await B.sync.flush();
  ok('删除方 flush 成功', !!delFlush && delFlush.ok === true, JSON.stringify(delFlush));
  B.sync.reset();

  var tombRec = cloudDoc(KEYS.recordPrefix + 'recAlpha');
  var tombResume = cloudDoc(KEYS.resume);
  ok('云端 recAlpha 已是 deleted:true / value:null', !!tombRec &&
    tombRec.deleted === true && tombRec.value === null, JSON.stringify(tombRec));
  ok('云端 resume 已是 deleted:true / value:null', !!tombResume &&
    tombResume.deleted === true && tombResume.value === null, JSON.stringify(tombResume));

  // 模拟「另一台离线设备」：本地仍留着删除前的旧值，尚未同步到删除
  ctl.storageMap[KEYS.recordPrefix + 'recAlpha'] = oldRecRaw;
  ctl.storageMap[KEYS.resume] = oldResumeRaw;

  purgeSrc();
  var C = loadCore();
  C.cloud.reset(); C.sync.reset(); C.privacy.reset();
  ok('设备 C 授权为 granted', (await grant(C)) === 'granted');
  ok('设备 C 本地持旧值（复活风险场景）',
    !!C.storage.getRecord('recAlpha') && !!C.storage.getResume());
  var startC = await C.sync.start();
  ok('设备 C sync.start() 成功', !!startC && startC.ok === true, JSON.stringify(startC));
  ok('设备 C start() 后 getRecord(recAlpha)===null', C.storage.getRecord('recAlpha') === null,
    JSON.stringify(C.storage.getRecord('recAlpha')));
  ok('设备 C start() 后 getResume()===null', C.storage.getResume() === null,
    JSON.stringify(C.storage.getResume()));
  var tombRec2 = cloudDoc(KEYS.recordPrefix + 'recAlpha');
  var tombResume2 = cloudDoc(KEYS.resume);
  ok('云端 recAlpha deleted 未被改回 false', !!tombRec2 && tombRec2.deleted === true);
  ok('云端 resume deleted 未被改回 false', !!tombResume2 && tombResume2.deleted === true);
  ok('tombstone 均 value===null（无明文）',
    !!tombRec2 && tombRec2.value === null && !!tombResume2 && tombResume2.value === null);
  var tombJson = JSON.stringify([tombRec2, tombResume2]);
  ok('tombstone 不含任何明文',
    tombJson.indexOf('recAlpha') >= 0 &&        // 仅 key 名保留，游戏内容不得残留
    tombJson.indexOf('e2e4') < 0 && tombJson.indexOf('墨金棋童') < 0 &&
    tombJson.indexOf('"mode"') < 0 && tombJson.indexOf('"movesUci"') < 0, tombJson);
  C.sync.reset();

  // 收尾：恢复默认配置，避免影响同进程其它调用
  config.CLOUD_CONFIG.enabled = false;
  config.CLOUD_CONFIG.env = '';
}

async function run() {
  console.log('端到端清缓存恢复演练 · test-recovery');
  await main();
  console.log('\n============================================================');
  console.log('test-recovery 结果: ' + passed + ' 通过 / ' + failed + ' 失败');
  if (failures.length) { console.log('失败项:'); failures.forEach(function (f) { console.log('  - ' + f); }); }
  console.log('============================================================');
  process.exit(failed === 0 ? 0 : 1);
}
run().catch(function (e) {
  console.error('test-recovery 异常:', e && (e.stack || e.message || e));
  console.log('\n============================================================');
  console.log('test-recovery 结果: ' + passed + ' 通过 / ' + (failed + 1) + ' 失败');
  console.log('============================================================');
  process.exit(1);
});
