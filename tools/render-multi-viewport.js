/**
 * 多视口 / 多模式离屏渲染脚本（不纳入正式测试套件，不修改任何 app 源文件）
 *
 * 目标：在 tools/render-shots.js 的基础上，参数化视口与系统字号，对关键场景出图。
 *   - 矮窄屏 320×568：teaching / records / setup / endgame / gameplay / menu / endgameMap，后缀 -320
 *   - 大字号模式：视口仍 375×667，wx.getSystemInfoSync().fontSizeSetting = 20（使 getFontScale 返回 1.25），
 *     teaching / records / settings / setup / endgameMap / menu，后缀 -large
 *   - 交叉矩阵 320×568 + 1.25×（第二轮审查 P2-04）：MODE=320-large，
 *     覆盖 settings / setup / endgameMap / menu / records 三页全状态，后缀 -320-large
 *   - SHOT_BOTTOM=1：渲染前把场景 scrollY 推到底并额外渲染一帧，用于复核 setup / endgameMap 底部
 *     （吸底 CTA、执黑提示、折叠汇总行）而不产生空白截图。
 *
 * 设计原则（与 render-shots.js 完全一致，仅复制、不加依赖）：
 *  - 复制 render-shots.js 的 global.wx mock、字体 remap（sans-serif→Heiti SC、serif→Songti SC、
 *    棋子用 Apple Symbols）、SceneManager 装配与各场景 driver 逻辑。
 *  - 通过环境变量 / 命令行参数传入 W / H / fontSizeSetting（见下方 MODE 与 SHOT_* 说明）。
 *  - 每个场景的 driver 与 render-shots.js 保持一致的装配方式，确保能真正渲染出图。
 *  - 末尾打印「X 成功 / Y 失败」与每场景输出路径。
 *
 * 运行：
 *   node tools/render-multi-viewport.js                 # 默认 large 模式
 *   MODE=320 node tools/render-multi-viewport.js        # 矮窄屏 320×568
 *   MODE=large node tools/render-multi-viewport.js      # 大字号（等价默认）
 *   MODE=320-large node tools/render-multi-viewport.js  # 320×568 + 1.25× 交叉矩阵
 *   MODE=320-large SHOT_BOTTOM=1 SHOT_SUFFIX=-320-large-bottom \
 *     node tools/render-multi-viewport.js               # 同上但滚到底部
 *   SHOT_W=320 SHOT_H=568 SHOT_FONT=0 SHOT_SUFFIX=-320 \
 *     SHOT_SCENES=teaching,records,setup,endgame,gameplay,menu,endgameMap \
 *     node tools/render-multi-viewport.js               # 完全自定义
 *
 * 关于「大字号」的真实生效路径（重要，见最终汇报）：
 *   src/config.js 的 getFontScale() 在 app 中并无任何调用方，因此仅靠 wx.fontSizeSetting=20 并不会让
 *   当前 app 真正放大字号。真正控制字号的杠杆是 src/scenes/manager.js 的 M.theme.fontScale（由
 *   theme.font(key) 在 body/h1/h2/subtitle/caption/san 上施加 ×scale，micro/button/coordinate 不变），
 *   通常由 GameContext.applySettings({fontSize:'large'}) 设为 1.125。
 *   本脚本为忠实复现「fontSizeSetting=20 → getFontScale 返回 1.25」的诉求，在 harness 侧同时：
 *     (a) 把 wx.getSystemInfoSync().fontSizeSetting 设为 20（与要求一致）；
 *     (b) 直接调用 M.theme.setFontScale(clamp(fontSizeSetting/16, 1, 1.25)) (=1.25) 驱动真实缩放杠杆，
 *   从而让 -large 出图能反映放大后的版式，用于溢出/碰撞分析。此操作仅发生在 harness 内，未改任何 src。
 */
'use strict';

const fs = require('fs');
const path = require('path');

const PROJ = '/Users/mia/Documents/miniGame/chess-game';

// ===========================================================================
// 参数解析：MODE 预设 + SHOT_* 逐项覆盖
// ===========================================================================
const MODE = (process.env.MODE || 'large').toLowerCase();

// 预设：每个模式给定 W/H/fontSizeSetting/文件名后缀/出图场景集
const PRESETS = {
  '320': {
    W: 320, H: 568, font: 0, suffix: '-320',
    scenes: ['teaching', 'records', 'setup', 'endgame', 'gameplay', 'menu', 'endgameMap']
  },
  'large': {
    W: 375, H: 667, font: 20, suffix: '-large',
    scenes: ['teaching', 'records', 'settings', 'setup', 'endgameMap', 'menu']
  },
  // P2-04：此前 large 只覆盖 375 宽、且不含 setup / endgameMap 底部；补交叉矩阵
  '320-large': {
    W: 320, H: 568, font: 20, suffix: '-320-large',
    scenes: ['settings', 'setup', 'endgameMap', 'menu', 'records']
  }
};
const preset = PRESETS[MODE] || PRESETS['large'];

const W = parseInt(process.env.SHOT_W, 10) || preset.W;
const H = parseInt(process.env.SHOT_H, 10) || preset.H;
const FONT_SETTING = (process.env.SHOT_FONT != null && process.env.SHOT_FONT !== '')
  ? parseInt(process.env.SHOT_FONT, 10) : preset.font;
const SUFFIX = (process.env.SHOT_SUFFIX != null) ? process.env.SHOT_SUFFIX : preset.suffix;
let SCENES_WANTED = preset.scenes.slice();
if (process.env.SHOT_SCENES) {
  SCENES_WANTED = process.env.SHOT_SCENES.split(',').map(s => s.trim()).filter(Boolean);
}
const BOTTOM = process.env.SHOT_BOTTOM === '1'; // 滚到底部并二次渲染（复核吸底 CTA / 折叠汇总）

const DPR = 2;
// 真实生效的字号缩放系数：getFontScale 公式 clamp(fontSizeSetting/16, 1, 1.25)
const TARGET_SCALE = FONT_SETTING > 0
  ? Math.max(1, Math.min(1.25, FONT_SETTING / 16))
  : 1;

console.log('[harness] MODE=' + MODE + '  W=' + W + ' H=' + H +
  '  fontSizeSetting=' + (FONT_SETTING > 0 ? FONT_SETTING : '(none)') +
  '  fontScale=' + TARGET_SCALE + '  suffix=' + SUFFIX);
console.log('[harness] scenes: ' + SCENES_WANTED.join(', '));

// ===========================================================================
// canvas 模块解析（与 render-shots.js 一致：优先 tools/vendor，回退 /tmp）
// ===========================================================================
const CANVAS_CANDIDATES = [
  path.join(PROJ, 'tools/vendor/node_modules/@napi-rs/canvas'),
  '/tmp/canvas-shots/node_modules/@napi-rs/canvas'
];
let createCanvas, CANVAS_MODULE;
for (const cand of CANVAS_CANDIDATES) {
  try {
    ({ createCanvas } = require(cand));
    CANVAS_MODULE = cand;
    break;
  } catch (e) { /* try next */ }
}
if (!createCanvas) {
  console.error('FATAL: @napi-rs/canvas 未安装。请先任选其一安装：\n' +
    '  mkdir -p tools/vendor/node_modules && cp -R <含 @napi-rs 的 node_modules>/@napi-rs tools/vendor/node_modules/\n' +
    '  或：cd /tmp/canvas-shots && npm install @napi-rs/canvas');
  process.exit(2);
}
console.log('[harness] canvas module:', CANVAS_MODULE);

const OUT = path.join(PROJ, 'review-shots');
fs.mkdirSync(OUT, { recursive: true });

// ===========================================================================
// wx mock（贴近真机）—— 与 render-shots.js 一致；large 模式附加 fontSizeSetting
// ===========================================================================
const storageMap = {};
global.wx = {
  getSystemInfoSync: () => {
    const info = {
      windowWidth: W, windowHeight: H, pixelRatio: DPR, statusBarHeight: 20,
      safeArea: { top: 20, bottom: H - 20, left: 0, right: W, width: W, height: H - 20 }
    };
    if (FONT_SETTING > 0) info.fontSizeSetting = FONT_SETTING;
    return info;
  },
  getMenuButtonBoundingClientRect: () => ({
    x: W - 7 - 87, y: 20, width: 87, height: 32, top: 20, right: W - 7, bottom: 52
  }),
  createCanvas: (w, h) => {
    const c = createCanvas(w || W, h || H);
    applyFontRemap(c.getContext('2d'));
    return c;
  },
  setStorageSync: (k, v) => { storageMap[k] = v; },
  getStorageSync: (k) => (Object.prototype.hasOwnProperty.call(storageMap, k) ? storageMap[k] : ''),
  removeStorageSync: (k) => { delete storageMap[k]; },
  createInnerAudioContext: () => ({
    src: '', volume: 1, play() {}, stop() {}, destroy() {},
    onError() {}, onCanplay() {}, onEnded() {}, onStop() {}
  }),
  setClipboardData: () => {},
  onTouchStart() {}, onTouchEnd() {}, onTouchMove() {}, onTouchCancel() {},
  onHide() {}, onShow() {}, requestAnimationFrame() {}
};

// ===========================================================================
// 字体 remap（与 render-shots.js 完全一致）
// ===========================================================================
function applyFontRemap(ctx) {
  const proto = Object.getPrototypeOf(ctx);
  const fontDesc = Object.getOwnPropertyDescriptor(proto, 'font');
  if (!fontDesc) return ctx;
  Object.defineProperty(ctx, 'font', {
    configurable: true,
    get() { return fontDesc.get.call(this); },
    set(v) {
      if (typeof v === 'string') {
        v = v.replace(/sans-serif/g, 'Heiti SC').replace(/serif/g, 'Songti SC');
      }
      fontDesc.set.call(this, v);
    }
  });
  return ctx;
}

function newCtx() {
  const canvas = createCanvas(W * DPR, H * DPR);
  const ctx = canvas.getContext('2d');
  ctx.scale(DPR, DPR); // 逻辑坐标 W×H
  return applyFontRemap(ctx);
}

// ===========================================================================
// 装配（与 render-shots.js 一致）
// ===========================================================================
const SceneManager = require(path.join(PROJ, 'src/scenes/manager'));
const GameContext = require(path.join(PROJ, 'src/context'));
const storage = require(path.join(PROJ, 'src/core/storage'));
const config = require(path.join(PROJ, 'src/config'));

// 棋子用 Unicode 字形；Apple Symbols 在本机可正常渲染国际象棋字形
if (config && config.FONTS) {
  config.FONTS.piece = 'Apple Symbols';
  if (config.FONTS.pieceGlyphMd) config.FONTS.pieceGlyphMd = '18px Apple Symbols';
  if (config.FONTS.pieceGlyphSm) config.FONTS.pieceGlyphSm = '13px Apple Symbols';
}

// 真正驱动放大的杠杆：M.theme.fontScale（getFontScale 在 app 中无调用方，这里 harness 侧施加）
SceneManager.theme.setFontScale(TARGET_SCALE);

// 预置棋谱（含一局「负」以验证 danger 徽章；一局胜、一局和）
function preseedRecords() {
  const base = {
    mode: 'ai', opponent: 'Stockfish 中级', startedAt: Date.now() - 86400000,
    durationMs: 125000, movesUci: ['e2e4', 'e7e5', 'g1f3', 'b8c6', 'f1b5', 'a7a6'],
    sanLog: ['e4', 'e5', 'Nf3', 'Nc6', 'Bb5', 'a6'], plies: 6
  };
  storage.saveRecord(Object.assign({}, base, { id: 'seed-win', outcome: 'win', result: 'win' }));
  storage.saveRecord(Object.assign({}, base, { id: 'seed-loss', outcome: 'loss', result: 'loss', durationMs: 98000 }));
  storage.saveRecord(Object.assign({}, base, { id: 'seed-draw', outcome: 'draw', result: 'draw', durationMs: 200000 }));
}

function makeSM(ctx) { return new SceneManager(ctx, W, H); }

function defaultEnter(scene, sm) {
  scene.enter({ screenWidth: W, screenHeight: H, _sm: sm });
}

// ===========================================================================
// 场景 driver 表（与 render-shots.js 一致；新增 endgame）
// ===========================================================================
const DRIVERS = {
  menu: {
    file: 'src/scenes/menu', label: '主菜单',
    driver: (scene, sm) => {
      storage.saveEndgame({ unlockedLevel: 12, cleared: {
        1: { stars: 3, bestTimeMs: 12300 }, 2: { stars: 2, bestTimeMs: 20900 },
        3: { stars: 1, bestTimeMs: 31500 }, 4: { stars: 3, bestTimeMs: 8800 },
        5: { stars: 2, bestTimeMs: 14200 }, 6: { stars: 3, bestTimeMs: 9900 }
      } });
      defaultEnter(scene, sm);
    }
  },
  settings: {
    file: 'src/scenes/settings', label: '设置',
    driver: (scene, sm) => defaultEnter(scene, sm)
  },
  endgameMap: {
    file: 'src/scenes/endgameMap', label: '阵图(残局关卡)',
    driver: (scene, sm) => {
      storage.saveEndgame({ unlockedLevel: 6, cleared: {
        1: { stars: 3, bestTimeMs: 12300 }, 2: { stars: 2, bestTimeMs: 20900 },
        3: { stars: 1, bestTimeMs: 31500 }, 4: { stars: 3, bestTimeMs: 8800 },
        5: { stars: 2, bestTimeMs: 14200 }
      } });
      defaultEnter(scene, sm);
    }
  },
  setup: {
    file: 'src/scenes/setup', label: '开局设置',
    driver: (scene, sm) => defaultEnter(scene, sm)
  },
  teaching: {
    file: 'src/scenes/teaching', label: '教学',
    driver: (scene, sm) => defaultEnter(scene, sm)
  },
  records: {
    file: 'src/scenes/records', label: '棋谱',
    driver: (scene, sm) => defaultEnter(scene, sm)
  },
  gameplay: {
    file: 'src/scenes/gameplay', label: '对局(棋盘)',
    driver: (scene, sm) => {
      scene.enter({ mode: 'ai', coach: false, aiDepth: 2, aiColor: 'b', playerColor: 'w', _sm: sm });
      try { scene.update(0.016); scene.update(0.016); } catch (e) {}
    }
  },
  endgame: {
    file: 'src/scenes/endgame', label: '残局(对局)',
    driver: (scene, sm) => {
      scene.enter({ screenWidth: W, screenHeight: H, level: 1, _sm: sm });
      try { scene.update(0.016); } catch (e) {}
    }
  }
};

// ===========================================================================
// 渲染循环
// ===========================================================================
preseedRecords();
let okCount = 0, failCount = 0;
const fails = [];
const produced = [];

for (const name of SCENES_WANTED) {
  const spec = DRIVERS[name];
  if (!spec) {
    failCount++;
    fails.push(name + ': (未定义 driver)');
    console.error('  ✗ ' + name + ': 未定义 driver');
    continue;
  }
  let ctx, sm, scene;
  try {
    ctx = newCtx();
    sm = makeSM(ctx);
    GameContext.set({ canvas: ctx.canvas, ctx, screenWidth: W, screenHeight: H, sceneManager: sm });
    const SceneClass = require(path.join(PROJ, spec.file));
    scene = new SceneClass();
    if (spec.driver) spec.driver(scene, sm);
    else defaultEnter(scene, sm);
    // SHOT_BOTTOM=1：先推到「超出上限」渲染一帧让场景钳制 scrollY，再正式出图，
    // 避免一帧全裁空白（与 tools/render-shots.js 的 endgameMap-fold 同一处理）。
    if (BOTTOM && scene && typeof scene.scrollY === 'number') {
      scene.scrollY = 1e9;
      scene.render(ctx, W, H);
    }
    scene.render(ctx, W, H);
    const file = path.join(OUT, name + SUFFIX + '.png');
    fs.writeFileSync(file, ctx.canvas.toBuffer('image/png'));
    produced.push(path.relative(PROJ, file));
    console.log('  ✓ ' + spec.label + ' (' + name + SUFFIX + ') -> ' + path.relative(PROJ, file));
    okCount++;
  } catch (e) {
    failCount++;
    fails.push(name + ': ' + (e && e.stack ? e.stack.split('\n').slice(0, 3).join(' | ') : (e && e.message)));
    console.error('  ✗ ' + spec.label + ' (' + name + SUFFIX + '): ' + (e && e.message));
  }
}

console.log('\n=== 渲染完成: ' + okCount + ' 成功 / ' + failCount + ' 失败 ===');
if (produced.length) {
  console.log('输出文件:');
  produced.forEach(p => console.log('  - ' + p));
}
if (fails.length) console.log('失败项:\n  - ' + fails.join('\n  - '));
process.exit(failCount ? 1 : 0);
