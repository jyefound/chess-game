/**
 * 发布前自检（零依赖 Node 脚本，只读，不改任何文件）
 *
 * 运行：
 *   node tools/publish-check.js            # 列出阻断项 / 通过项，退出码恒为 0（不阻断本地开发）
 *   node tools/publish-check.js --strict   # 若存在阻断项则退出码 1（用于发布流水线）
 *
 * 检查范围：
 *  - CLOUD_CONFIG.enabled / env / collections / schemaVersion
 *  - 两集合名 chess_state / chess_records
 *  - PRIVACY_POLICY.md 是否仍含【待填】
 *  - WECHAT_PUBLISH_GUIDE.md 是否残留「不上传服务器 / 纯单机 / 无后端」
 *  - src/scenes/settings.js 是否仍含「单机版」
 *  - game.js 是否含 publishCheck 启动告警
 *  - src/ 是否引入 wx.request / wx.login / getUserProfile / scope.userInfo 调用或声明
 *
 * 安全：不打印 env 值本身，只回显「空 / 已配置」；全程 fs 只读，不写任何文件。
 */
'use strict';

var fs = require('fs');
var path = require('path');
var ROOT = path.join(__dirname, '..');
var STRICT = process.argv.indexOf('--strict') >= 0;

function read(rel) {
  try { return fs.readFileSync(path.join(ROOT, rel), 'utf8'); } catch (e) { return null; }
}
function walkJs(dir, out) {
  var items;
  try { items = fs.readdirSync(dir); } catch (e) { return; }
  for (var i = 0; i < items.length; i++) {
    var p = path.join(dir, items[i]);
    var st;
    try { st = fs.statSync(p); } catch (e) { continue; }
    if (st.isDirectory()) walkJs(p, out);
    else if (/\.js$/.test(items[i])) out.push(p);
  }
}

var C;
try { C = require('../src/config').CLOUD_CONFIG || {}; } catch (e) { C = {}; }

var checks = [];
function add(label, pass, detail) {
  checks.push({ label: label, pass: !!pass, detail: detail || '' });
}

// ---- 配置开关（阻断项：发布前必须由用户提供真实信息 / 置位）----
add('CLOUD_CONFIG.enabled 已置位为 true（上线前需打开云同步）',
  C.enabled === true, '当前 ' + String(C.enabled));
add('CLOUD_CONFIG.env 已填入 env ID（值不回显）',
  !!C.env, C.env ? '已配置（不回显值）' : '为空');
add('两集合名与代码强约定一致（chess_state / chess_records）',
  !!C.collections && C.collections.state === 'chess_state' &&
  C.collections.records === 'chess_records',
  C.collections ? C.collections.state + ' / ' + C.collections.records : '缺失');
add('schemaVersion 已配置',
  typeof C.schemaVersion === 'number' && isFinite(C.schemaVersion) && C.schemaVersion >= 1,
  '=' + String(C.schemaVersion));

// ---- 合规文档 / 展示文案 ----
var policy = read('PRIVACY_POLICY.md');
var todo = policy ? (policy.match(/【待填/g) || []).length : -1;
add('PRIVACY_POLICY.md 全部【待填】已填实（联系方式 / 生效日期 / 主体 / 政策 URL）',
  policy !== null && todo === 0,
  policy === null ? '文件不可读' : '当前 ' + todo + ' 处');

var guide = read('WECHAT_PUBLISH_GUIDE.md');
add('WECHAT_PUBLISH_GUIDE.md 无「不上传服务器 / 纯单机 / 无后端」过时措辞',
  guide !== null && !/不上传服务器|纯单机|无后端/.test(guide),
  guide === null ? '文件不可读' : '');

var settings = read('src/scenes/settings.js');
add('src/scenes/settings.js 无「单机版」字样',
  settings !== null && settings.indexOf('单机版') < 0,
  settings === null ? '文件不可读' : '');

var game = read('game.js');
add('game.js 含 publishCheck 启动告警',
  game !== null && game.indexOf('publishCheck') >= 0,
  game === null ? '文件不可读' : '');

// ---- 平台铁律：src/ 禁用 API ----
// 只认「调用 / scope 声明」形态，不把合规文案里的否定提及（如「不索取 scope.userInfo」）
// 误判为调用。字面提及单独统计，仅作信息展示。
var jsFiles = [];
walkJs(path.join(ROOT, 'src'), jsFiles);
var CALL_PATTERNS = [
  ['wx.request', /\bwx\.request\s*\(/],
  ['wx.login', /\bwx\.login\s*\(/],
  ['getUserProfile', /\bgetUserProfile\s*\(/],
  ['scope.userInfo 声明', /scope\s*:\s*['"]scope\.userInfo['"]/]
];
var LITERALS = ['wx.request', 'wx.login', 'getUserProfile', 'scope.userInfo'];
var callHits = [], literalHits = [];
jsFiles.forEach(function (f) {
  var txt = fs.readFileSync(f, 'utf8');
  var rel = path.relative(ROOT, f);
  CALL_PATTERNS.forEach(function (p) { if (p[1].test(txt)) callHits.push(p[0] + '@' + rel); });
  LITERALS.forEach(function (s) { if (txt.indexOf(s) >= 0) literalHits.push(s + '@' + rel); });
});
add('src/ 未引入 wx.request / wx.login / getUserProfile / scope.userInfo 调用或声明',
  callHits.length === 0,
  callHits.length ? callHits.join(', ') : '扫描 ' + jsFiles.length + ' 个 .js 文件');

// ---- 输出 ----
var blockers = checks.filter(function (c) { return !c.pass; });
var passers = checks.filter(function (c) { return c.pass; });

console.log('=== 发布前自检 · publish-check（只读，不改文件）===');
console.log('CLOUD_CONFIG.enabled : ' + String(C.enabled));
console.log('CLOUD_CONFIG.env     : ' + (C.env ? '已配置（不回显值）' : '空'));
console.log('collections          : ' + (C.collections ? C.collections.state + ' / ' + C.collections.records : '缺失'));
console.log('schemaVersion        : ' + String(C.schemaVersion));

console.log('\n--- 阻断项（发布前必须处理；默认不阻断本地开发）---');
if (!blockers.length) console.log('  （无）');
blockers.forEach(function (c) {
  console.log('  ✗ ' + c.label + (c.detail ? ' | ' + c.detail : ''));
});

console.log('\n--- 通过项 ---');
passers.forEach(function (c) {
  console.log('  ✓ ' + c.label + (c.detail ? ' | ' + c.detail : ''));
});
if (literalHits.length && !callHits.length) {
  console.log('    注：src/ 中另有 ' + literalHits.length + ' 处字面提及（合规文案，如「不索取 scope.userInfo」），按调用形态检查不计入：');
  var uniq = {};
  literalHits.forEach(function (h) { uniq[h] = true; });
  Object.keys(uniq).forEach(function (h) { console.log('      - ' + h); });
}

console.log('\n============================================================');
console.log('阻断项 ' + blockers.length + ' 项 / 通过项 ' + passers.length + ' 项');
console.log(STRICT
  ? '--strict：' + (blockers.length ? '存在阻断项，退出码 1' : '无阻断项，退出码 0')
  : '默认模式：退出码 0（不阻断本地开发）；发布流水线请加 --strict');
console.log('============================================================');
process.exit(STRICT && blockers.length ? 1 : 0);
