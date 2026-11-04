/**
 * 真机级离屏渲染脚本（不纳入正式测试套件）
 * 用途：用 @napi-rs/canvas 在 Node 端真实绘制 Canvas2D，对 VISUAL_WALKTHROUGH_REPORT.md
 *       中【需真机复核】项做像素级确认（对比度 / 间距 / 层级 / 断点）。
 *
 * 设计：
 *  - global.wx 注入贴近真机的 getSystemInfoSync / getMenuButtonBoundingClientRect / storage / audio；
 *    createCanvas 返回真实 @napi-rs/canvas（供 pieces.js 等离屏缓存使用）。
 *  - 750×1334 真实画布，ctx.scale(2,2) 以 375×667 逻辑坐标绘制，输出 2x 高清 PNG。
 *  - Proxy 包装 ctx.font：sans-serif→PingFang SC、serif→Songti SC，保证中文渲染。
 *  - 每个场景用 driver 驱动到代表性状态后 render；单场景失败不影响其余。
 *
 * 运行：node tools/render-shots.js
 * 依赖：@napi-rs/canvas 优先取 tools/vendor/node_modules（随项目持久化），
 *       否则回退 /tmp/canvas-shots（隔离环境）。两者均无则给出安装提示。
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

const W = 375, H = 667, DPR = 2;

// 当前视口（可被单场景 spec.vp 覆盖，用于 320×568 紧凑屏复核）
let VW = W, VH = H;

// ---------------- wx mock（贴近真机）----------------
const storageMap = {};
global.wx = {
  getSystemInfoSync: () => ({
    windowWidth: VW, windowHeight: VH, pixelRatio: DPR, statusBarHeight: 20,
    safeArea: { top: 20, bottom: VH - 20, left: 0, right: VW, width: VW, height: VH - 20 }
  }),
  getMenuButtonBoundingClientRect: () => ({
    x: VW - 7 - 87, y: 20, width: 87, height: 32, top: 20, right: VW - 7, bottom: 52
  }),
  createCanvas: (w, h) => {
    const c = createCanvas(w || VW, h || VH);
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

// ---------------- 真实 ctx（2x + 字体替换）----------------
// 注意：不能用 Proxy 包原生 ctx——原生方法（fillRect/save/...）需要正确的 this 绑定，
// 经 Proxy 调用会报 Illegal invocation。仅用 defineProperty 拦截 font 一处即可。
// 离屏 canvas（棋子缓存等，经 wx.createCanvas 创建）也必须加同样的 remap，否则其上中文/字形缺字。
function applyFontRemap(ctx) {
  const proto = Object.getPrototypeOf(ctx);
  const fontDesc = Object.getOwnPropertyDescriptor(proto, 'font');
  if (!fontDesc) return ctx;
  Object.defineProperty(ctx, 'font', {
    configurable: true,
    get() { return fontDesc.get.call(this); },
    set(v) {
      if (typeof v === 'string') {
        // @napi-rs/canvas 的 CoreText 匹配认不出 PingFang SC，但 Heiti SC（黑体，sans）
        // 与 Songti SC（宋体，serif）可正常出中文；棋子字形用 Hiragino Sans（含国际象棋 Unicode）。
        v = v.replace(/sans-serif/g, 'Heiti SC').replace(/serif/g, 'Songti SC');
      }
      fontDesc.set.call(this, v);
    }
  });
  return ctx;
}

function newCtx(w, h) {
  const canvas = createCanvas((w || VW) * DPR, (h || VH) * DPR);
  const ctx = canvas.getContext('2d');
  ctx.scale(DPR, DPR); // 逻辑坐标
  return applyFontRemap(ctx);
}

const SceneManager = require(path.join(PROJ, 'src/scenes/manager'));
const GameContext = require(path.join(PROJ, 'src/context'));
const storage = require(path.join(PROJ, 'src/core/storage'));
const config = require(path.join(PROJ, 'src/config'));
const layoutMod = require(path.join(PROJ, 'src/core/layout'));
// 棋子用 Unicode 字形绘制。@napi-rs/canvas 下能正确渲染国际象棋字形的字体是
// Apple Symbols / STIX Two Math / Arial Unicode MS / Menlo；默认 serif 与中文黑体均无该字形（显示 ☒）。
// 选 Apple Symbols（系统符号字体，白/黑棋子均全）。同时覆盖头像/吃子区的小棋子字形。
if (config && config.FONTS) {
  config.FONTS.piece = 'Apple Symbols';
  if (config.FONTS.pieceGlyphMd) config.FONTS.pieceGlyphMd = '18px Apple Symbols';
  if (config.FONTS.pieceGlyphSm) config.FONTS.pieceGlyphSm = '13px Apple Symbols';
}

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

function makeSM(ctx) { return new SceneManager(ctx, VW, VH); }

// 默认 enter 参数
function defaultEnter(scene, sm) {
  scene.enter({ screenWidth: VW, screenHeight: VH, _sm: sm });
}

// 人机对战结算弹窗（gameover）driver 工厂。
// 结算由 gameplay.js:650 在 sm.modal.current === 'gameover' 时调用 renderGameOver() 绘制，
// 该函数只读 sm.modal.payload.outcome / game.result / game.resultReason / savedGameId，
// 因此无需走 onGameOver()（会 emit/自动存档/清断点，出图噪音大），直接喂值即可。
// 注意：enter() 会重置 state='IDLE'、savedGameId=null 并 new ChessGame()（result=null），
// 故以下所有赋值必须在 enter() 之后，否则会被覆盖。_sm 必须传入，renderGameOver 经 this.sm 读模态。
function gameoverDriver(opts) {
  opts = opts || {};
  return (scene, sm) => {
    scene.enter({ mode: 'ai', coach: false, aiDepth: 2, aiColor: 'b', playerColor: 'w',
      screenWidth: VW, screenHeight: VH, _sm: sm });
    scene.game.result = opts.result || 'draw';
    scene.game.resultReason = opts.reason || 'threefold';
    scene.savedGameId = opts.savedGameId !== undefined ? opts.savedGameId : 'seed-draw';
    scene.state = 'GAMEOVER';
    sm.modal.current = 'gameover';
    sm.modal.payload = { outcome: opts.outcome || 'draw' };
  };
}

// ---------------- 场景驱动表 ----------------
const SCENES = [
  {
    name: 'menu', file: 'src/scenes/menu', label: '主菜单',
    driver: (scene, sm) => {
      storage.saveEndgame({ unlockedLevel: 12, cleared: {
        1: { stars: 3, bestTimeMs: 12300 }, 2: { stars: 2, bestTimeMs: 20900 },
        3: { stars: 1, bestTimeMs: 31500 }, 4: { stars: 3, bestTimeMs: 8800 },
        5: { stars: 2, bestTimeMs: 14200 }, 6: { stars: 3, bestTimeMs: 9900 }
      } });
      defaultEnter(scene, sm);
    }
  },
  {
    // NEW 徽章复核：首关未通关（cleared<=0）应在该残局行显示 NEW 标签
    name: 'menu-newbadge', file: 'src/scenes/menu', label: '主菜单(NEW徽章)',
    driver: (scene, sm) => {
      storage.saveEndgame({ unlockedLevel: 1, cleared: {} });
      defaultEnter(scene, sm);
    }
  },
  {
    name: 'settings', file: 'src/scenes/settings', label: '设置',
    driver: (scene, sm) => defaultEnter(scene, sm)
  },
  {
    name: 'endgameMap', file: 'src/scenes/endgameMap', label: '阵图(残局关卡)',
    driver: (scene, sm) => {
      storage.saveEndgame({ unlockedLevel: 6, cleared: {
        1: { stars: 3, bestTimeMs: 12300 }, 2: { stars: 2, bestTimeMs: 20900 },
        3: { stars: 1, bestTimeMs: 31500 }, 4: { stars: 3, bestTimeMs: 8800 },
        5: { stars: 2, bestTimeMs: 14200 }
      } });
      defaultEnter(scene, sm);
    }
  },
  { name: 'academy', file: 'src/scenes/academy', label: '锦囊阁', driver: defaultEnter },
  { name: 'setup', file: 'src/scenes/setup', label: '开局设置', driver: defaultEnter },
  {
    // P0-03 / P1-08：执黑时底部「棋盘将翻转…」提示与吸底按钮的 ≥12pt 间距（375 非 compact）
    name: 'setup-black', file: 'src/scenes/setup', label: '开局设置(执黑)',
    driver: (scene, sm) => {
      GameContext.saveSettings({ defaultColor: 'b' });
      scene.enter({ screenWidth: VW, screenHeight: VH, _sm: sm });
    },
    after: () => { try { GameContext.saveSettings({ defaultColor: 'w' }); } catch (e) {} }
  },
  { name: 'teaching', file: 'src/scenes/teaching', label: '教学', driver: defaultEnter },
  { name: 'records', file: 'src/scenes/records', label: '棋谱', driver: defaultEnter },
  {
    name: 'replay', file: 'src/scenes/replay', label: '复盘',
    driver: (scene, sm) => { scene.enter({ id: 'seed-loss', _sm: sm }); },
    after: (ctx, scene) => {
      const lay = scene._layout || {};
      console.log('  · 复盘棋盘 cell=' + lay.cell + 'px  boardSize=' + (lay.cell * 8) + 'px  (报告称 26px 实为 floor 下限)');
    }
  },
  {
    name: 'endgameMap-fold', file: 'src/scenes/endgameMap', label: '阵图(折叠卡)',
    // P2-03：scrollY=1e9 会让「绘制后才钳制」的实现出现一帧全裁空白。
    // 生产侧已在 render 开头钳制；harness 侧再渲染两帧，确保任何实现都不会出空白图。
    twoPass: true,
    driver: (scene, sm) => {
      storage.saveEndgame({ unlockedLevel: 6, cleared: {
        1: { stars: 3, bestTimeMs: 12300 }, 2: { stars: 2, bestTimeMs: 20900 },
        3: { stars: 1, bestTimeMs: 31500 }, 4: { stars: 3, bestTimeMs: 8800 },
        5: { stars: 2, bestTimeMs: 14200 }
      } });
      defaultEnter(scene, sm);
      scene.scrollY = 1e9; // 由场景在 render 内钳到 maxScroll，露出底部折叠卡
    }
  },
  {
    // P0-02：菜单「继续 · 第 N 阵」传 focusLevel，阵图首帧把当前阵滚入视口 + 吸底 CTA 直达。
    name: 'endgameMap-focus', file: 'src/scenes/endgameMap', label: '阵图(菜单「继续」定位)',
    driver: (scene, sm) => {
      storage.saveEndgame({ unlockedLevel: 11, cleared: {
        1: { stars: 3, bestTimeMs: 12300 }, 2: { stars: 2, bestTimeMs: 20900 },
        3: { stars: 1, bestTimeMs: 31500 }, 4: { stars: 3, bestTimeMs: 8800 },
        5: { stars: 2, bestTimeMs: 14200 }, 6: { stars: 3, bestTimeMs: 9900 },
        7: { stars: 1, bestTimeMs: 15000 }, 8: { stars: 2, bestTimeMs: 17000 },
        9: { stars: 3, bestTimeMs: 7600 }, 10: { stars: 2, bestTimeMs: 12100 }
      } });
      scene.enter({ from: 'menu', focusLevel: 11, screenWidth: VW, screenHeight: VH, _sm: sm });
    },
    after: (ctx, scene) => {
      console.log('  · 菜单「继续」focusLevel=11 → scrollY=' + scene.scrollY +
        '  吸底CTA(continue)=' + (scene.regions || []).some(r => r.key === 'continue') +
        '  lv:11=' + (scene.regions || []).some(r => r.key === 'lv:11'));
    }
  },
  {
    name: 'teaching-reveal', file: 'src/scenes/teaching', label: '教学(金环/✓)',
    driver: (scene, sm) => {
      scene.enter({ screenWidth: W, screenHeight: H, _sm: sm });
      // 进入 REVEAL：在 accept 格（白后 d1）绘制金环，用于复核金环/✓ 对比度
      scene.phase = 'REVEAL'; scene.revealStart = 0; scene.animPhase = 10;
    }
  },
  {
    name: 'gameplay', file: 'src/scenes/gameplay', label: '对局(棋盘)',
    driver: (scene, sm) => {
      scene.enter({ mode: 'ai', coach: false, aiDepth: 2, aiColor: 'b', playerColor: 'w', screenWidth: VW, screenHeight: VH, _sm: sm });
      try { scene.update(0.016); scene.update(0.016); } catch (e) {}
    }
  },
  {
    // 紧凑屏复核（320×568）：坐标刻度带应自动降级为仅 a–h，且不与棋子/走法点重叠
    name: 'gameplay-320', file: 'src/scenes/gameplay', label: '对局(320×568 紧凑屏)',
    vp: { W: 320, H: 568 },
    driver: (scene, sm) => {
      scene.enter({ mode: 'ai', coach: false, aiDepth: 2, aiColor: 'b', playerColor: 'w', screenWidth: VW, screenHeight: VH, _sm: sm });
      try {
        // 选中 e2 兵 → 同时出现象牙内环 + 象牙走法点，便于检查刻度带与标记是否互压
        scene.selected = { row: 6, col: 4 };
        scene.legalMoves = [
          { fromRow: 6, fromCol: 4, toRow: 4, toCol: 4 },
          { fromRow: 6, fromCol: 4, toRow: 5, toCol: 4 }
        ];
        scene.update(0.016);
      } catch (e) {}
    }
  },
  {
    name: 'gameplay-hint', file: 'src/scenes/gameplay', label: '对局(提示高亮)',
    driver: (scene, sm) => {
      scene.enter({ mode: 'ai', coach: false, aiDepth: 2, aiColor: 'b', playerColor: 'w', screenWidth: VW, screenHeight: VH, _sm: sm });
      try {
        // 先选中后中心兵，让「象牙内环/点」与「青玉虚线箭头」同屏可比
        scene.selected = { row: 6, col: 4 };
        scene.legalMoves = [
          { fromRow: 6, fromCol: 4, toRow: 4, toCol: 4 },
          { fromRow: 6, fromCol: 4, toRow: 5, toCol: 4 }
        ];
        if (typeof scene.startHint === 'function') {
          scene.startHint();
          for (let i = 0; i < 600 && scene.hintState === 'searching'; i++) scene.update(0.05);
        }
      } catch (e) {}
    }
  },
  {
    name: 'endgame', file: 'src/scenes/endgame', label: '残局(对局 · 无建议浮层)',
    driver: (scene, sm) => {
      scene.enter({ screenWidth: VW, screenHeight: VH, level: 1, _sm: sm });
      try { scene.update(0.016); } catch (e) {}
    }
  },
  {
    // Phase 2·6 复核：建议面板为「按需浮层」，覆盖棋盘下沿但不占常驻空间
    name: 'endgame-hint', file: 'src/scenes/endgame', label: '残局(建议浮层)',
    driver: (scene, sm) => {
      scene.enter({ screenWidth: VW, screenHeight: VH, level: 1, _sm: sm });
      try {
        const moves = scene.game.getLegalMoves();
        if (moves && moves.length) {
          scene.hintMove = moves[0];
          scene.hintSan = 'Qh7#';
        }
        scene.update(0.016);
      } catch (e) {}
    }
  },
  {
    // 双人对弈：进入即白先走，白在底部（flipBoard=false）
    name: 'gameplay-local', file: 'src/scenes/gameplay', label: '双人对弈(进入·白在底)',
    driver: (scene, sm) => {
      scene.enter({ mode: 'local', screenWidth: VW, screenHeight: VH, _sm: sm });
      try { scene.update(0.016); } catch (e) {}
    },
    after: (ctx, scene) => console.log('  · 进入 flipBoard=' + scene.flipBoard + ' (白先走→白在底=false)')
  },
  {
    // 双人对弈：白走一步后 sideToMove 切换，黑翻到屏幕底部（flipBoard=true）—— 当前走子方始终在近端
    name: 'gameplay-local-flip', file: 'src/scenes/gameplay', label: '双人对弈(走子后·黑在底)',
    driver: (scene, sm) => {
      scene.enter({ mode: 'local', screenWidth: VW, screenHeight: VH, _sm: sm });
      // 白先走：直接取当前 sideToMove 的第一步合法着（getLegalMoves 返回即白方着）
      const lm = scene.game.getLegalMoves()[0];
      scene.commitMove(lm, false);
      try { scene.update(0.016); } catch (e) {}
    },
    after: (ctx, scene) => console.log('  · 白走一步后 flipBoard=' + scene.flipBoard + ' (黑轮走→黑在底=true)')
  },
  {
    // 复盘：玩家执黑，棋盘应翻转并显示「执黑·棋盘已翻转」方位标签
    name: 'replay-black', file: 'src/scenes/replay', label: '复盘(执黑·已翻转)',
    driver: (scene, sm) => {
      const rec = {
        id: 'seed-black', mode: 'ai', opponent: 'Stockfish 中级', playerColor: 'b',
        startedAt: Date.now() - 86400000, durationMs: 98000, outcome: 'loss', result: 'loss',
        movesUci: ['e2e4', 'e7e5', 'g1f3', 'b8c6', 'f1b5', 'a7a6'],
        sanLog: ['e4', 'e5', 'Nf3', 'Nc6', 'Bb5', 'a6'], plies: 6
      };
      scene.enter({ record: rec, screenWidth: VW, screenHeight: VH, _sm: sm });
      try { scene._rebuildTo(4, false); } catch (e) {}
    },
    after: (ctx, scene) => console.log('  · 执黑 flip=' + (scene.record && scene.record.playerColor === 'b') + ' cursor=' + scene.cursor + ' (方位标签应可见)')
  },
  {
    // 平板（834×1112）：残局单元格上限抬高，棋盘更饱满
    name: 'endgame-tablet', file: 'src/scenes/endgame', label: '残局(平板 834×1112)',
    vp: { W: 834, H: 1112 },
    driver: (scene, sm) => {
      scene.enter({ screenWidth: VW, screenHeight: VH, level: 1, _sm: sm });
      try { scene.update(0.016); } catch (e) {}
    },
    after: (ctx, scene) => console.log('  · 平板 cellSize=' + scene.cellSize + ' (基线 375 上限≈52)')
  },
  {
    name: 'teaching-tablet', file: 'src/scenes/teaching', label: '教学(平板 834×1112)',
    vp: { W: 834, H: 1112 },
    driver: (scene, sm) => {
      scene.enter({ screenWidth: VW, screenHeight: VH, _sm: sm });
      scene.update(0.016);
    }
  },
  {
    // 横屏（812×375）：棋盘受高度收敛、居中不溢出
    name: 'endgame-landscape', file: 'src/scenes/endgame', label: '残局(横屏 812×375)',
    vp: { W: 812, H: 375 },
    driver: (scene, sm) => {
      scene.enter({ screenWidth: VW, screenHeight: VH, level: 1, _sm: sm });
      try { scene.update(0.016); } catch (e) {}
    },
    after: (ctx, scene) => console.log('  · 横屏 cellSize=' + scene.cellSize + ' boardY=' + scene.boardY + ' (不溢出)')
  },
  {
    // 结算弹窗·技能卡：验证 effect 文案已中文化（本阵回马枪次数 +1），无英文码
    name: 'endgame-skillpopup', file: 'src/scenes/endgame', label: '残局(结算·技能卡)',
    driver: (scene, sm) => {
      scene.enter({ screenWidth: VW, screenHeight: VH, level: 1, _sm: sm });
      const data = require(path.join(PROJ, 'src/data/endgames'));
      const sk = (data.SKILLS || data.skills || []).find(s => s.id === 'skill_undo') || { id: 'skill_undo', name: '回马枪', rarity: '普通', effect: '本阵回马枪次数 +1' };
      sm.modal.current = 'reveal';
      sm.modal.payload = {
        title: '漂亮，破阵！', tier: undefined, stars: 3, timeMs: 62000, ownMoves: 5, overtime: false,
        tip: { tactic: '回马枪', text: '假撤真进，回马一枪封喉。' },
        skill: sk
      };
      try { scene.update(0.016); } catch (e) {}
    },
    after: (ctx, scene) => console.log('  · 技能 effect="' + ((scene.sm.modal.payload && scene.sm.modal.payload.skill && scene.sm.modal.payload.skill.effect) || '') + '" (应无英文码)')
  },
  // ===== 人机对战结算弹窗（gameover）复核：多视口 + 状态矩阵 =====
  {
    name: 'gameover-375', file: 'src/scenes/gameplay', label: '结算(375 基线·和棋)',
    vp: { W: 375, H: 667 }, driver: gameoverDriver()
  },
  {
    name: 'gameover-320', file: 'src/scenes/gameplay', label: '结算(320 紧凑·和棋)',
    vp: { W: 320, H: 568 }, driver: gameoverDriver()
  },
  {
    name: 'gameover-ipad-834', file: 'src/scenes/gameplay', label: '结算(iPad Air 834 竖)',
    vp: { W: 834, H: 1112 }, driver: gameoverDriver()
  },
  {
    name: 'gameover-ipad-1024', file: 'src/scenes/gameplay', label: '结算(iPad Pro 1024 竖)',
    vp: { W: 1024, H: 1366 }, driver: gameoverDriver()
  },
  {
    name: 'gameover-ipad-land', file: 'src/scenes/gameplay', label: '结算(iPad 1366 横)',
    vp: { W: 1366, H: 1024 }, driver: gameoverDriver()
  },
  {
    name: 'gameover-fold-717', file: 'src/scenes/gameplay', label: '结算(折叠窄高 717)',
    vp: { W: 717, H: 1136 }, driver: gameoverDriver()
  },
  {
    name: 'gameover-fold-wide', file: 'src/scenes/gameplay', label: '结算(折叠宽屏 1280)',
    vp: { W: 1280, H: 800 }, driver: gameoverDriver()
  },
  {
    name: 'gameover-win', file: 'src/scenes/gameplay', label: '结算(胜利态·你赢了)',
    vp: { W: 375, H: 667 },
    driver: gameoverDriver({ result: 'white_win', reason: 'checkmate', outcome: 'win', savedGameId: 'seed-win' })
  },
  {
    name: 'gameover-save', file: 'src/scenes/gameplay', label: '结算(未存档·保存本局)',
    vp: { W: 375, H: 667 },
    driver: gameoverDriver({ savedGameId: null })
  },
  {
    // 430 > 414 → layout.js:172 进入 isTablet 分支，复核大屏手机误入平板缩放(s≥1.20)的尺度
    name: 'gameover-430', file: 'src/scenes/gameplay', label: '结算(430 平板边界)',
    vp: { W: 430, H: 932 }, driver: gameoverDriver()
  }
];

// 注：以下为六态诊断图 custom 场景（保留原结构，单独追加）
const SCENES2 = [
  {
    // 六态诊断图（直接驱动 render/board.js，不依赖场景）：选中/可走/可吃/上一步/将军 同屏
    name: 'board-semantics', label: '棋盘六态语义诊断', custom: true,
    render: (ctx) => {
      const Board = require(path.join(PROJ, 'src/core/board'));
      const boardRender = require(path.join(PROJ, 'src/render/board'));
      const b = new Board();
      for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) b.removePiece(r, c);
      b.setPiece(4, 4, { type: 'n', color: 'w' });   // 选中：e4 白马
      b.setPiece(3, 6, { type: 'p', color: 'b' });   // 可吃：g5 黑兵
      b.setPiece(0, 7, { type: 'k', color: 'b' });   // 将军：h8 黑王
      const cell = 40, bx = (VW - cell * 8) / 2, by = 120;
      ctx.fillStyle = '#10151B'; ctx.fillRect(0, 0, VW, VH);
      ctx.fillStyle = '#EDE6D6'; ctx.font = 'bold 18px sans-serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('棋盘六态语义（Phase 2·5）', VW / 2, 56);
      boardRender.drawBoard(ctx, b, {
        x: bx, y: by, cellSize: cell,
        selected: { row: 4, col: 4 },
        legalMoves: [
          { toRow: 2, toCol: 3 }, { toRow: 2, toCol: 5 }, { toRow: 5, toCol: 3 },
          { toRow: 3, toCol: 6, isCapture: true }
        ],
        lastMove: { fromRow: 7, fromCol: 1, toRow: 5, toCol: 2 },
        checkPos: { row: 0, col: 7 },
        showCoordinates: true, isCompact: false, time: 900, reduceMotion: true
      });
      const lines = [
        '象牙内环=选中 · 象牙实点=可走 · 酒红环=可吃',
        '暖底+竖条=上一步 · 红色脉冲=将军',
        '青玉虚线箭头=系统建议（见 gameplay-hint）',
        '坐标已在木框刻度带，格内无文字'
      ];
      ctx.font = '13px sans-serif'; ctx.fillStyle = '#9AA7B4'; ctx.textAlign = 'center';
      lines.forEach((t, i) => ctx.fillText(t, VW / 2, by + cell * 8 + 36 + i * 22));
    }
  }
];

// ---------------- 渲染循环 ----------------
preseedRecords();
let okCount = 0, failCount = 0;
const fails = [];

for (const spec of SCENES.concat(SCENES2)) {
  let ctx, sm, scene;
  try {
    // 单场景视口（缺省 375×667）；切换后重建 layout 单例，保证 isCompactW/H 与真机一致
    VW = (spec.vp && spec.vp.W) || W;
    VH = (spec.vp && spec.vp.H) || H;
    layoutMod.init({ windowWidth: VW, windowHeight: VH, pixelRatio: DPR, statusBarHeight: 20,
      safeArea: { top: 20, bottom: VH - 20, left: 0, right: VW, width: VW, height: VH - 20 } });
    ctx = newCtx(VW, VH);
    sm = makeSM(ctx);
    GameContext.set({ canvas: ctx.canvas, ctx, screenWidth: VW, screenHeight: VH, sceneManager: sm });
    if (spec.custom) {
      spec.render(ctx, VW, VH);
    } else {
      const SceneClass = require(path.join(PROJ, spec.file));
      scene = new SceneClass();
      if (spec.driver) spec.driver(scene, sm);
      else defaultEnter(scene, sm);
      scene.render(ctx, VW, VH);
      if (spec.twoPass) scene.render(ctx, VW, VH); // 第二帧使用钳制后的 scrollY
    }
    if (spec.after && scene) spec.after(ctx, scene);
    const file = path.join(OUT, spec.name + '.png');
    fs.writeFileSync(file, ctx.canvas.toBuffer('image/png'));
    console.log('  ✓ ' + spec.label + ' (' + spec.name + ') -> ' + path.relative(PROJ, file));
    okCount++;
  } catch (e) {
    failCount++;
    fails.push(spec.name + ': ' + (e && e.message));
    console.error('  ✗ ' + spec.label + ' (' + spec.name + '): ' + (e && e.message));
  }
}

console.log('\n=== 渲染完成: ' + okCount + ' 成功 / ' + failCount + ' 失败 ===');
if (fails.length) console.log('失败项:\n  - ' + fails.join('\n  - '));
process.exit(failCount ? 1 : 0);
