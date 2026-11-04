/**
 * 阵图折叠卡专用：用「高屏」系统参数让布局把整张网格算进视口，
 * 一次渲染出底部「待解锁 X 阵」汇总折叠卡（绕开滚动钳制）。
 * 真实设备仍是 375×667，此脚本仅为截图取证。
 */
'use strict';
const fs = require('fs');
const path = require('path');

const PROJ = '/Users/mia/Documents/miniGame/chess-game';
const CANVAS_CANDIDATES = [
  path.join(PROJ, 'tools/vendor/node_modules/@napi-rs/canvas'),
  '/tmp/canvas-shots/node_modules/@napi-rs/canvas'
];
let createCanvas, CANVAS_MODULE;
for (const cand of CANVAS_CANDIDATES) {
  try { ({ createCanvas } = require(cand)); CANVAS_MODULE = cand; break; } catch (e) { /* try next */ }
}
if (!createCanvas) {
  console.error('FATAL: @napi-rs/canvas 未安装（vendor 与 /tmp 均无）。');
  process.exit(2);
}
console.log('[harness] canvas module:', CANVAS_MODULE);

const OUT = path.join(PROJ, 'review-shots');
fs.mkdirSync(OUT, { recursive: true });

const W = 375, H = 667, DPR = 2;
const TALL = 1500; // 假装屏幕更高，使整张网格进入视口

const storageMap = {};
global.wx = {
  getSystemInfoSync: () => ({
    windowWidth: W, windowHeight: TALL, pixelRatio: DPR, statusBarHeight: 20,
    safeArea: { top: 20, bottom: TALL - 20, left: 0, right: W, width: W, height: TALL - 20 }
  }),
  getMenuButtonBoundingClientRect: () => ({ x: W - 7 - 87, y: 20, width: 87, height: 32, top: 20, right: W - 7, bottom: 52 }),
  createCanvas: (w, h) => { const c = createCanvas(w || W, h || H); applyFontRemap(c.getContext('2d')); return c; },
  setStorageSync: (k, v) => { storageMap[k] = v; },
  getStorageSync: (k) => (Object.prototype.hasOwnProperty.call(storageMap, k) ? storageMap[k] : ''),
  removeStorageSync: (k) => { delete storageMap[k]; },
  createInnerAudioContext: () => ({ play() {}, stop() {}, destroy() {}, onError() {}, onCanplay() {}, onEnded() {}, onStop() {} }),
  setClipboardData: () => {}, onTouchStart() {}, onTouchEnd() {}, onTouchMove() {}, onTouchCancel() {}, onHide() {}, onShow() {}, requestAnimationFrame() {}
};

function applyFontRemap(ctx) {
  const proto = Object.getPrototypeOf(ctx);
  const fd = Object.getOwnPropertyDescriptor(proto, 'font');
  if (!fd) return ctx;
  Object.defineProperty(ctx, 'font', {
    configurable: true,
    get() { return fd.get.call(this); },
    set(v) { if (typeof v === 'string') v = v.replace(/sans-serif/g, 'Heiti SC').replace(/serif/g, 'Songti SC'); fd.set.call(this, v); }
  });
  return ctx;
}

const SceneManager = require(path.join(PROJ, 'src/scenes/manager'));
const GameContext = require(path.join(PROJ, 'src/context'));
const storage = require(path.join(PROJ, 'src/core/storage'));
const config = require(path.join(PROJ, 'src/config'));
if (config && config.FONTS) {
  config.FONTS.piece = 'Apple Symbols';
  if (config.FONTS.pieceGlyphMd) config.FONTS.pieceGlyphMd = '18px Apple Symbols';
  if (config.FONTS.pieceGlyphSm) config.FONTS.pieceGlyphSm = '13px Apple Symbols';
}

const canvas = createCanvas(W * DPR, H * DPR);
const ctx = applyFontRemap(canvas.getContext('2d'));
ctx.scale(DPR, DPR);

storage.saveEndgame({ unlockedLevel: 6, cleared: {
  1: { stars: 3, bestTimeMs: 12300 }, 2: { stars: 2, bestTimeMs: 20900 },
  3: { stars: 1, bestTimeMs: 31500 }, 4: { stars: 3, bestTimeMs: 8800 }, 5: { stars: 2, bestTimeMs: 14200 }
} });
const sm = new SceneManager(ctx, W, H);
GameContext.set({ canvas: ctx.canvas, ctx, screenWidth: W, screenHeight: H, sceneManager: sm });
const EndgameMapScene = require(path.join(PROJ, 'src/scenes/endgameMap'));
const scene = new EndgameMapScene();
scene.enter({ screenWidth: W, screenHeight: H, _sm: sm });
// 第一次渲染只为算出 maxScroll
scene.render(ctx, W, H);
// 滚动到底部并清屏重绘，露出折叠卡（正常 667 视口下的底部）
scene.scrollY = scene.maxScroll;
ctx.clearRect(0, 0, W, H);
scene.render(ctx, W, H);
const file = path.join(OUT, 'endgameMap-fold.png');
fs.writeFileSync(file, canvas.toBuffer('image/png'));
console.log('✓ endgameMap-fold (scrolled) maxScroll=' + scene.maxScroll + ' -> ' + file);

