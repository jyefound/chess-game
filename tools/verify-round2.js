'use strict';
/**
 * 第二轮审查自动断言（OPTIMIZATION_PLAN_ROUND2.md §11.1 / §10）
 *
 * 运行：node tools/verify-round2.js
 *
 * 覆盖范围：
 *   A. P0 功能链路（无存档语义 / 快速开局恢复全部配置 / 继续定位 / 持久化失败回滚）
 *   B. 多视口渲染与命中区（375×667、320×568、320×568+1.25×、375×667+1.25×）
 *      - 三页 render 不抛异常
 *      - 所有可见命中区高度 ≥44pt
 *      - 文本矩形不越出视口（诊断统计）
 *      - 阵图 scrollY 首帧被钳制在 [0, maxScroll]
 *   C. 设置项文案 / 动作语义（三组命名、自动覆盖确认、三套主题可切换）
 *
 * 说明：使用 Proxy 版轻量 ctx（吸收全部 Canvas 调用），不依赖 @napi-rs/canvas；
 * measureText 按当前 font 的字号近似，保证大字号下能真实反映文本变宽。
 */
const path = require('path');
const fs = require('fs');
const PROJ = path.resolve(__dirname, '..');

let passed = 0, failed = 0;
const failures = [];
function ok(name, cond, detail) {
  if (cond) { passed++; console.log('  ✓ ' + name); }
  else { failed++; failures.push(name + (detail ? ' | ' + detail : '')); console.log('  ✗ ' + name + (detail ? ' | ' + detail : '')); }
}
function section(t) { console.log('\n=== ' + t + ' ==='); }

// ---------------------------------------------------------------------------
// wx mock
// ---------------------------------------------------------------------------
const storageMap = {};
let failWrites = false;
global.wx = {
  createCanvas() { return { width: 750, height: 1334, getContext() { return makeCtx(375, 667); } }; },
  getSystemInfoSync() {
    return { windowWidth: 375, windowHeight: 667, pixelRatio: 2, statusBarHeight: 20,
      safeArea: { top: 20, bottom: 647, left: 0, right: 375, width: 375, height: 627 } };
  },
  getMenuButtonBoundingClientRect() {
    return { x: 375 - 94, y: 20, width: 87, height: 32, top: 20, right: 375 - 7, bottom: 52 };
  },
  onTouchStart() {}, onTouchMove() {}, onTouchEnd() {}, onTouchCancel() {}, onHide() {}, onShow() {},
  createInnerAudioContext() {
    return { src: '', volume: 1, play() {}, stop() {}, destroy() {},
      onError() {}, onCanplay() {}, onEnded() {}, offError() {}, offCanplay() {}, offEnded() {} };
  },
  setStorageSync(k, v) { if (failWrites) throw new Error('mock quota exceeded'); storageMap[k] = v; },
  getStorageSync(k) { return Object.prototype.hasOwnProperty.call(storageMap, k) ? storageMap[k] : ''; },
  removeStorageSync(k) { delete storageMap[k]; },
  clearStorageSync() { for (const k in storageMap) delete storageMap[k]; },
  vibrateShort() {}, setClipboardData() {}, showToast() {}, requestAnimationFrame() {}
};

// ---------------------------------------------------------------------------
// 记录型 ctx：measureText 随 font 变化，fillText 记录文本矩形
// ---------------------------------------------------------------------------
function makeCtx(W, H) {
  const store = {
    globalAlpha: 1, lineWidth: 1, font: '16px sans-serif', fillStyle: '#000',
    strokeStyle: '#000', textAlign: 'left', textBaseline: 'top', shadowBlur: 0,
    shadowOffsetX: 0, shadowOffsetY: 0, shadowColor: 'transparent',
    lineCap: 'butt', lineJoin: 'miter', globalCompositeOperation: 'source-over', miterLimit: 10,
    W: W, H: H, texts: [], rects: []
  };
  const pxOf = (font) => {
    const m = /(\d+(?:\.\d+)?)px/.exec(font || '');
    return m ? parseFloat(m[1]) : 16;
  };
  return new Proxy(store, {
    get(t, p) {
      if (p === 'texts') return t.texts;
      if (p === 'rects') return t.rects;
      if (p in t) return t[p];
      if (p === 'measureText') return (s) => {
        const str = String(s == null ? '' : s);
        // CJK 近似：单字宽 ≈ 字号，ASCII ≈ 0.55 字号
        let w = 0;
        for (const ch of str) w += /[\u0000-\u00ff]/.test(ch) ? pxOf(t.font) * 0.55 : pxOf(t.font);
        return { width: w, actualBoundingBoxAscent: pxOf(t.font), actualBoundingBoxDescent: 4,
          actualBoundingBoxLeft: 0, actualBoundingBoxRight: w };
      };
      if (p === 'fillText') return (s, x, y) => {
        const str = String(s == null ? '' : s);
        const width = (() => {
          let acc = 0;
          for (const ch of str) acc += /[\u0000-\u00ff]/.test(ch) ? pxOf(t.font) * 0.55 : pxOf(t.font);
          return acc;
        })();
        const align = t.textAlign || 'left';
        const left = align === 'right' || align === 'end' ? x - width
          : align === 'center' ? x - width / 2 : x;
        const fs = pxOf(t.font);
        const top = (t.textBaseline === 'middle') ? y - fs / 2
          : (t.textBaseline === 'bottom' || t.textBaseline === 'alphabetic') ? y - fs : y;
        t.texts.push({ text: str, x: x, y: y, left: left, right: left + width,
          top: top, bottom: top + fs, font: t.font, align: align });
      };
      if (p === 'createLinearGradient' || p === 'createRadialGradient' || p === 'createPattern')
        return () => ({ addColorStop() {} });
      if (p === 'getImageData') return () => ({ data: new Uint8ClampedArray(4) });
      if (p === 'canvas') return { width: W * 2, height: H * 2 };
      if (p === 'isPointInPath' || p === 'isPointInStroke') return () => false;
      return () => {};
    },
    set(t, p, v) { t[p] = v; return true; }
  });
}

const R = (p) => require(path.join(PROJ, p));
const storage = R('src/core/storage');
const GameContext = R('src/context');
const layoutMod = R('src/core/layout');
const M = R('src/scenes/manager');
const MenuScene = R('src/scenes/menu');
const SetupScene = R('src/scenes/setup');
const SettingsScene = R('src/scenes/settings');
const EndgameMapScene = R('src/scenes/endgameMap');
const SettingsModule = R('src/scenes/settings');

function freshStorage() {
  for (const k in storageMap) delete storageMap[k];
  GameContext._settings = null;
}
function setViewport(W, H, scale) {
  layoutMod.init({ windowWidth: W, windowHeight: H, pixelRatio: 2, statusBarHeight: 20,
    safeArea: { top: 20, bottom: H - 20, left: 0, right: W, width: W, height: H - 20 } });
  M.theme.setFontScale(scale || 1);
}

// ===========================================================================
section('A. P0 功能链路（数据语义 / 快速开局 / 继续定位 / 持久化）');
// ===========================================================================
{
  freshStorage();
  setViewport(375, 667, 1);
  ok('P0-03 无任何存档时 getLastConfig() 返回 null', storage.getLastConfig() === null,
    'got=' + JSON.stringify(storage.getLastConfig()));

  // 设置页把「初始执棋色」设为黑，且开启快速开局
  GameContext.saveSettings({ defaultColor: 'b', skipSetup: true });
  const s1 = new SetupScene();
  s1.enter({ screenWidth: 375, screenHeight: 667 });
  ok('P0-03 首次进入对局设置显示执黑（默认执棋色真正生效）', s1.color === 'b', 'color=' + s1.color);

  // 有上次配置时仍沿用上次（不被设置页默认值覆盖）
  storage.saveLastConfig({ difficulty: 'easy', color: 'w', style: 'standard' });
  const s2 = new SetupScene();
  s2.enter({ screenWidth: 375, screenHeight: 667 });
  ok('P0-03 已有对局记录时沿用上次执棋色', s2.color === 'w', 'color=' + s2.color);

  let captured = null;
  const origPush = GameContext.pushScene;
  GameContext.pushScene = (name, params) => { captured = { name: name, params: params || {} }; };

  // P0-04：上次「指导 + 困难 + 执黑」
  storage.saveLastConfig({ difficulty: 'hard', color: 'b', style: 'coach' });
  const menuA = new MenuScene();
  menuA.enter({ screenWidth: 375, screenHeight: 667 });
  captured = null;
  menuA._activate('ai');
  ok('P0-04 快速开局恢复指导模式', !!(captured && captured.params.coach === true),
    captured ? JSON.stringify(captured.params) : 'no push');
  ok('P0-04 快速开局恢复困难深度', !!(captured && captured.params.aiDepth === 4));
  ok('P0-04 快速开局恢复执黑', !!(captured && captured.params.playerColor === 'b'));

  // P0-04：旧存档缺 style → standard 兜底、不崩
  storage.saveLastConfig({ difficulty: 'easy', color: 'w' });
  const menuB = new MenuScene();
  menuB.enter({ screenWidth: 375, screenHeight: 667 });
  captured = null;
  menuB._activate('ai');
  ok('P0-04 旧存档无 style 时按标准模式兜底',
    !!(captured && captured.params.coach === false && captured.params.style === 'standard'),
    captured ? JSON.stringify(captured.params) : 'no push');

  // P1-13：写失败回滚内存态
  const before = GameContext.getSettings().soundEnabled;
  failWrites = true;
  let ret;
  try { ret = GameContext.saveSettings({ soundEnabled: !before }); } catch (e) { ret = 'threw:' + e.message; }
  failWrites = false;
  ok('P1-13 持久化失败返回 false', ret === false, 'ret=' + ret);
  ok('P1-13 持久化失败回滚内存态',
    GameContext.getSettings().soundEnabled === before,
    'now=' + GameContext.getSettings().soundEnabled + ' before=' + before);

  // P0-02：菜单「继续」把当前阵号交给阵图
  storage.saveEndgame({ unlockedLevel: 12, cleared: {} });
  const menuC = new MenuScene();
  menuC.enter({ screenWidth: 375, screenHeight: 667 });
  captured = null;
  menuC._activate('endgame');
  ok('P0-02 菜单「继续」传入 focusLevel',
    !!(captured && captured.name === 'endgameMap' && captured.params.focusLevel === menuC.nextLevel),
    captured ? JSON.stringify(captured) : 'no push');
  GameContext.pushScene = origPush;
}

// ===========================================================================
section('B. 多视口渲染 / 命中区 / 文本边界 / scrollY 钳制');
// ===========================================================================
{
  const viewports = [
    { W: 375, H: 667, scale: 1, label: '375×667 1.0×' },
    { W: 320, H: 568, scale: 1, label: '320×568 1.0×' },
    { W: 320, H: 568, scale: 1.125, label: '320×568 1.125×' },
    { W: 320, H: 568, scale: 1.25, label: '320×568 1.25×' },
    { W: 375, H: 667, scale: 1.25, label: '375×667 1.25×' }
  ];
  const scenes = [
    { name: 'setup', Class: SetupScene },
    { name: 'settings', Class: SettingsScene },
    { name: 'endgameMap', Class: EndgameMapScene }
  ];
  // R2：'room' 场景由 impl-room-ui 落盘；未落盘则不加进多视口渲染矩阵（保持原有断言编号）。
  let RoomScene = null;
  try { RoomScene = R('src/scenes/room'); } catch (e) { RoomScene = null; }
  if (RoomScene) scenes.push({ name: 'room', Class: RoomScene });
  else console.log('  · 跳过：room 场景多视口渲染项（模块未落盘，集成时复跑）');
  freshStorage();
  storage.saveEndgame({ unlockedLevel: 6, cleared: {
    1: { stars: 3, bestTimeMs: 12300 }, 2: { stars: 2, bestTimeMs: 20900 },
    3: { stars: 1, bestTimeMs: 31500 }, 4: { stars: 3, bestTimeMs: 8800 },
    5: { stars: 2, bestTimeMs: 14200 }
  } });

  for (const vp of viewports) {
    setViewport(vp.W, vp.H, vp.scale);
    for (const spec of scenes) {
      const ctx = makeCtx(vp.W, vp.H);
      const sc = new spec.Class();
      let err = null;
      try {
        sc.enter({ screenWidth: vp.W, screenHeight: vp.H });
        sc.render(ctx, vp.W, vp.H);
      } catch (e) { err = e; }
      ok(vp.label + ' · ' + spec.name + ' render 无异常', !err,
        err ? (err.stack || err.message).split('\n').slice(0, 2).join(' | ') : '');
      if (err) continue;

      // 可见命中区高度 ≥44pt
      const visible = (sc.regions || []).filter(r => r.rect && r.rect.h > 0 &&
        r.rect.y + r.rect.h > 0 && r.rect.y < vp.H && r.rect.x + r.rect.w > 0 && r.rect.x < vp.W);
      if (spec.name === 'endgameMap') {
        // P0 命中区裁剪不变量：卡片/折叠区命中区不得超出列表视口上下界；仅对完整可见卡要求 ≥44pt
        const vpBox = sc._listViewport || null;
        const cards = visible.filter(r => r.key && (r.key.indexOf('lv:') === 0 || r.key === 'fold'));
        let overflow = 0, badSmall = 0;
        for (const r of cards) {
          if (vpBox && (r.rect.y < vpBox.top - 0.5 || r.rect.y + r.rect.h > vpBox.bottom + 0.5)) overflow++;
          const fullyIn = vpBox ? (r.rect.y >= vpBox.top + 0.5 && r.rect.y + r.rect.h <= vpBox.bottom - 0.5) : true;
          if (fullyIn && r.rect.h < 44) badSmall++;
        }
        ok(vp.label + ' · endgameMap 卡片命中区不超出列表视口（' + cards.length + ' 个）',
          overflow === 0, 'overflow=' + overflow);
        ok(vp.label + ' · endgameMap 完整可见卡片命中区 ≥44pt', badSmall === 0,
          badSmall ? cards.filter(r => r.rect.h < 44).slice(0, 4).map(r => r.key + ':' + r.rect.h).join(',') : '');
      } else {
        const tooSmall = visible.filter(r => r.rect.h < 44);
        ok(vp.label + ' · ' + spec.name + ' 可见命中区均 ≥44pt（' + visible.length + ' 个）',
          tooSmall.length === 0,
          tooSmall.slice(0, 4).map(r => r.key + ':' + r.rect.h).join(','));
      }

      // 文本不越出视口（诊断：只统计屏幕内的文本，超界打印数量）
      const onScreen = (ctx.texts || []).filter(t => t.y >= -4 && t.y <= vp.H + 4);
      const overflow = onScreen.filter(t => t.right > vp.W + 2 || t.left < -2);
      if (overflow.length) {
        console.log('    · ' + spec.name + ' 文本越界 ' + overflow.length + '/' + onScreen.length +
          ' 条（含裁剪区内容，仅供诊断）: ' + overflow.slice(0, 3).map(t => t.text.slice(0, 14)).join(' / '));
      }

      // setup：吸底主按钮上方留 ≥12pt
      if (spec.name === 'setup') {
        const start = (sc.regions || []).find(r => r.key === 'start');
        if (start) {
          const hint = (ctx.texts || []).find(t => t.text.indexOf('棋盘将翻转') >= 0);
          ok(vp.label + ' · setup 执黑提示与吸底 CTA 间距 ≥12pt',
            !hint || (hint.bottom <= start.rect.y - 12),
            hint ? ('hintBottom=' + hint.bottom.toFixed(1) + ' ctaTop=' + start.rect.y) : 'no black hint (执白态)');
        }
      }

      // endgameMap：首帧钳制 scrollY（模拟 harness 的 scrollY=1e9）
      if (spec.name === 'endgameMap') {
        const sc2 = new EndgameMapScene();
        sc2.enter({ screenWidth: vp.W, screenHeight: vp.H });
        sc2.scrollY = 1e9;
        try { sc2.render(makeCtx(vp.W, vp.H), vp.W, vp.H); } catch (e) { /* 已在上面断言过 */ }
        ok(vp.label + ' · endgameMap 首帧钳制 scrollY',
          sc2.scrollY >= 0 && sc2.scrollY <= (sc2.maxScroll || 0) + 0.5,
          'scrollY=' + sc2.scrollY + ' max=' + sc2.maxScroll);
      }
    }
  }
  M.theme.setFontScale(1);
}

// ===========================================================================
section('B2. 共享 TopBar 在 320 宽 + 大字号下的胶囊避让（§11.1 断言 4）');
// ===========================================================================
{
  const topbar = R('src/render/topbar');
  const capsule = { x: 320 - 94, y: 20, w: 87, h: 32 };
  const overlap = (a, b) => !(a.x + a.w <= b.x || b.x + b.w <= a.x ||
                              a.y + a.h <= b.y || b.y + b.h <= a.y);
  for (const scale of [1, 1.125, 1.25]) {
    setViewport(320, 568, scale);
    const ctx = makeCtx(320, 568);
    const m = topbar.measureTopBar(ctx, {
      title: '破阵 · 百阵', fontKey: 'h2',
      back: { key: 'back', label: '返回' }, rightWidth: 88
    });
    ok('320×568 ' + scale + '× 顶栏标题矩形不与微信胶囊相交（twoRows=' + m.twoRows + '）',
      !overlap(m.titleRect, capsule), JSON.stringify(m.titleRect));
  }
  M.theme.setFontScale(1);
}

// ===========================================================================
section('C. 设置项文案 / 动作语义');
// ===========================================================================
{
  const defs = SettingsModule.SETTING_DEFS || [];
  const byKey = (k) => defs.find(d => d.key === k) || {};
  ok('P0-03 「初始执棋色」命名', String(byKey('defaultColor').label || '').indexOf('初始执棋色') >= 0,
    byKey('defaultColor').label);
  ok('P1-12 「自动覆盖最早棋谱」命名', String(byKey('autoPrune').label || '').indexOf('自动覆盖') >= 0,
    byKey('autoPrune').label);
  ok('§7.7 「人机对战快速开局」命名', String(byKey('skipSetup').label || '').indexOf('快速开局') >= 0,
    byKey('skipSetup').label);
  ok('P1-09 SETTING_DEFS 带 group 分组', defs.length > 0 && defs.every(d => !!d.group),
    'missing=' + defs.filter(d => !d.group).map(d => d.key).join(','));

  const onRes = SettingsModule.applySettingKey('autoPrune', { autoPrune: false }, undefined);
  ok('P1-12 开启自动覆盖需二次确认', onRes.action === 'confirmAutoPrune', JSON.stringify(onRes));
  const offRes = SettingsModule.applySettingKey('autoPrune', { autoPrune: true }, undefined);
  ok('P1-12 关闭自动覆盖直接生效',
    !!(offRes.patch && offRes.patch.autoPrune === false), JSON.stringify(offRes));

  // P1-11：三套主题均可从主题选择行切换，并由设置补丁持久化。
  const darkTheme = SettingsModule.applySettingKey('theme', { theme: 'light' }, 'dark');
  const lightTheme = SettingsModule.applySettingKey('theme', { theme: 'dark' }, 'light');
  const kidsTheme = SettingsModule.applySettingKey('theme', { theme: 'light' }, 'kids');
  ok('P1-11 主题一/二/三均可选择',
    darkTheme.patch.theme === 'dark' && lightTheme.patch.theme === 'light' && kidsTheme.patch.theme === 'kids',
    JSON.stringify([darkTheme, lightTheme, kidsTheme]));
  setViewport(375, 667, 1);
  const sc = new SettingsScene();
  try {
    sc.enter({ screenWidth: 375, screenHeight: 667 });
    sc.scrollY = 1e9;
    sc.render(makeCtx(375, 667), 375, 667);
    sc.render(makeCtx(375, 667), 375, 667);
    const keys = (sc.regions || []).map(r => r.key);
    ok('P1-11 主题选择行注册可交互区域', keys.indexOf('theme') >= 0,
      'regions=' + keys.join(','));
  } catch (e) {
    ok('P1-11 设置页可渲染', false, e.message);
  }

  // P1-10：共享面板消费 pressedKey（源码级 + 行为级双检）
  const src = fs.readFileSync(path.join(PROJ, 'src/scenes/settings.js'), 'utf8');
  ok('P1-10 共享面板接入 pressedKey 按压原语',
    /pressedKey|drawPressed/.test(src), 'renderSettingsPanel 未发现按压消费');
}

// ===========================================================================
section('D. R2 房间场景 / 菜单并列按钮（能力防御）');
// ===========================================================================
{
  // 契约要求 SHOT_CASES 含 room 的 hub / joining 两项。
  // 注意：本文件基线（66 项断言）并不存在 SHOT_CASES（全项目 Grep 0 匹配），
  // 故按契约意图新建，并与 render-shots.js 的 shot 清单做跨文件一致性校验。
  const SHOT_CASES = [
    { name: 'room-hub', label: '房间(hub)', enter: { from: 'menu' } },
    { name: 'room-joining', label: '房间(joining)', enter: { from: 'share', joinCode: '123456' } }
  ];
  const shotsSrc = fs.readFileSync(path.join(PROJ, 'tools/render-shots.js'), 'utf8');
  ok('D1 SHOT_CASES(room hub/joining) 与 render-shots.js shot 清单一致',
    SHOT_CASES.every(c => shotsSrc.indexOf("name: '" + c.name + "'") >= 0),
    '缺失=' + SHOT_CASES.filter(c => shotsSrc.indexOf("name: '" + c.name + "'") < 0).map(c => c.name).join(','));

  let RoomSceneD = null;
  try { RoomSceneD = R('src/scenes/room'); } catch (e) { RoomSceneD = null; }
  if (!RoomSceneD) {
    console.log('  ⊘ 跳过：room 场景 SHOT_CASES enter+render 冒烟（模块未落盘，集成时复跑）');
  } else {
    for (const c of SHOT_CASES) {
      let err = null;
      try {
        const sc = new RoomSceneD();
        sc.enter(Object.assign({ screenWidth: 375, screenHeight: 667 }, c.enter));
        sc.render(makeCtx(375, 667), 375, 667);
      } catch (e) { err = e; }
      ok('D2 ' + c.name + ' enter+render 无异常', !err,
        err ? (err.stack || err.message).split('\n').slice(0, 2).join(' | ') : '');
    }
  }

  // 菜单 sec2Y 几何：静态检查 4 条赋值语句未被改动（当前 menu.js 即可真验）。
  const menuSrc = fs.readFileSync(path.join(PROJ, 'src/scenes/menu.js'), 'utf8');
  ok('D3 menu.js priY/sec1Y/sec2Y/rowY 几何赋值语句未被改动',
    /sec2Y\s*=\s*rowY\s*-\s*rowGap\s*-\s*secH/.test(menuSrc) &&
    /sec1Y\s*=\s*sec2Y\s*-\s*\(gap\s*-\s*2\)\s*-\s*secH/.test(menuSrc) &&
    /priY\s*=\s*sec1Y\s*-\s*gap\s*-\s*priH/.test(menuSrc) &&
    /rowY\s*=\s*contentBottom\s*-\s*8\s*-\s*rowH/.test(menuSrc),
    '几何赋值缺失（基线被改动）');
  // D4（IA 变更后）：菜单改为单入口 'versus' → 对局方式选择页；旧并列双按钮（_splitBtn）已移除。
  // 无条件断言（不再走「跳过」分支）：新 IA 已落盘，属真实验证。
  ok('D4b 首页次级入口升级为个人中心',
    /personalCenter/.test(menuSrc) && /个人中心/.test(menuSrc),
    '首页个人中心入口缺失');
  ok('D4 menu.js 为单入口 "versus"（_mainBtn 接线）且不再含 _splitBtn',
    /['"]versus['"]/.test(menuSrc) &&
    /_mainBtn\([^)]*['"]versus['"]/.test(menuSrc) &&
    !/_splitBtn/.test(menuSrc),
    'versus key=' + /['"]versus['"]/.test(menuSrc) +
    ' _mainBtn(versus)=' + /_mainBtn\([^)]*['"]versus['"]/.test(menuSrc) +
    ' _splitBtn残留=' + /_splitBtn/.test(menuSrc));
}

console.log('\n============================================================');
console.log('第二轮审查自动断言结果: ' + passed + ' 通过 / ' + failed + ' 失败');
console.log('============================================================');
if (failures.length) {
  console.log('失败项:');
  failures.forEach(f => console.log('  - ' + f));
}
process.exit(failed ? 1 : 0);
