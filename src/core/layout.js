/**
 * 安全区 / 自适应布局度量（V2_VISUAL_SPEC §4 · 需求5）
 *
 * 数据源：wx.getSystemInfoSync().safeArea（top/right/bottom/left）+ wx.getMenuButtonBoundingClientRect()（右上胶囊）。
 * 无 wx 环境（Node 测试）安全降级为默认 375×667、safeTop=20、safeBottom=20、dpr=2。
 *
 * 规则（§4.3/§4.4）：
 *  - safeTop = max(状态栏高, safeArea.top)；safeBottom = H − safeArea.bottom（含 home indicator）。
 *  - contentTop = safeTop + 16；contentBottom = H − safeBottom − 16。
 *  - y < safeTop 的灵动岛/状态栏区只放背景不放交互；home indicator 区留白 ≥ safeBottom。
 *  - boardY 用内容区垂直居中动态算（不再写死 H*0.16）：
 *      availH = contentH − topReserveH − bottomBarH
 *      maxBoard = min(W*0.92, availH*0.62, H*0.55)
 *      cellSize = max(minCell, floor(maxBoard / cols))
 *      boardX = (W − boardSize)/2（真居中）；boardY 垂直居中于可用带。
 *  - 断点：紧凑 W<360 / 矮屏 H<620（isCompactH）/ 窄屏 W<340（isCompactW）/
 *          基准 360–414 / 平板 W>414 或 min(W,H)≥600 / 横屏 W>H。
 *  - 胶囊避让：capsuleRect 原样暴露，场景层据此把右上动作放到胶囊左缘以左或下移。
 *
 * 导出：init(sysInfo) 与 get()；另附 computeBoard(reserves, cols) 供场景按实际信息栏高度重算棋盘。
 * 纯 JS，无 DOM/CSS/SVG/eval；所有 wx 调用 try/catch 包裹。
 */
'use strict';

var config = require('../config');

// 默认降级值（无 wx / Node 测试）
var DEFAULT = { W: 375, H: 667, dpr: 2, safeTop: 20, safeRight: 0, safeBottom: 20, safeLeft: 0 };
var GUTTER_PAD = 16;          // contentTop/Bottom 相对安全区的内边距（§4.3）
var _layout = null;            // 单例度量
var _rawSys = null;            // 原始 sysInfo 快照（诊断用）

function _num(v, def) {
  return (typeof v === 'number' && isFinite(v) && v >= 0) ? v : def;
}

/** 读取安全区；老基础库无 safeArea 时降级。 */
function _readSafe(sys, W, H) {
  var statusBar = _num(sys && sys.statusBarHeight, DEFAULT.safeTop);
  var sa = sys && sys.safeArea;
  var top, bottom, left, right;
  if (sa && typeof sa === 'object') {
    // safeArea: {left, top, right, bottom, width, height}（right/bottom 为坐标值）
    top = Math.max(statusBar, _num(sa.top, statusBar));
    bottom = Math.max(0, H - _num(sa.bottom, H));
    left = Math.max(0, _num(sa.left, 0));
    right = Math.max(0, W - _num(sa.right, W));
  } else {
    // 老基础库兜底：状态栏高 + 固定底部 20
    top = statusBar || DEFAULT.safeTop;
    bottom = DEFAULT.safeBottom;
    left = 0;
    right = 0;
  }
  // 钳制到合理范围，避免异常机型数值击穿内容区
  top = Math.min(Math.max(top, 0), Math.floor(H * 0.25));
  bottom = Math.min(Math.max(bottom, 0), Math.floor(H * 0.25));
  left = Math.min(left, Math.floor(W * 0.15));
  right = Math.min(right, Math.floor(W * 0.15));
  return { top: top, right: right, bottom: bottom, left: left };
}

/** 读取右上胶囊矩形；无该 API 时给一个安全的占位。 */
function _readCapsule(W, safeTop) {
  try {
    if (typeof wx !== 'undefined' && typeof wx.getMenuButtonBoundingClientRect === 'function') {
      var r = wx.getMenuButtonBoundingClientRect();
      if (r && typeof r === 'object') {
        return {
          x: _num(r.left, r.x), y: _num(r.top, r.y),
          w: Math.max(0, _num(r.width, 0)), h: Math.max(0, _num(r.height, 0)),
          right: _num(r.right, _num(r.left, 0) + _num(r.width, 0)),
          bottom: _num(r.bottom, _num(r.top, 0) + _num(r.height, 0))
        };
      }
    }
  } catch (e) { /* 静默降级 */ }
  // 占位：右上角区域，供场景避让（微信标准胶囊约 87×32，右距 7）
  var cw = 87, ch = 32, right = 7;
  return { x: W - right - cw, y: safeTop, w: cw, h: ch, right: W - right, bottom: safeTop + ch };
}

/**
 * 计算棋盘度量（§4.4）。
 * @param {object} L        布局（含 W/H/contentTop/contentBottom/isCompact/isTablet）
 * @param {object} reserves  {topReserveH, bottomBarH} 顶/底预留高度
 * @param {number} cols     列数（默认 8）
 * @param {number} rows     行数（默认 8，用于纵向 boardSize = cell*rows）
 */
function computeBoard(L, reserves, cols, rows) {
  reserves = reserves || {};
  var n = Math.max(2, cols || 8);
  var m = Math.max(2, rows || 8);
  var topReserveH = Math.max(0, _num(reserves.topReserveH, 0));
  var bottomBarH = Math.max(0, _num(reserves.bottomBarH, 0));

  var contentH = L.contentBottom - L.contentTop;
  var availH = Math.max(0, contentH - topReserveH - bottomBarH);

  // 大屏放宽棋盘上限到 W*0.68（§4.5）；紧凑系数收紧到 0.90
  var widthRatio = L.isTablet ? 0.68 : (L.isCompact ? 0.90 : 0.92);
  var maxBoardW = L.W * widthRatio;
  var maxBoardH = availH * 0.62;
  var maxBoardCap = L.H * 0.55;
  var maxBoard = Math.min(maxBoardW, maxBoardH, maxBoardCap);
  // 若预留后 availH 太小（异常/紧凑），至少回退到「内容区无预留」口径，保证棋盘可用
  if (maxBoard < n * 24) {
    maxBoard = Math.min(maxBoardW, contentH * 0.62, maxBoardCap);
  }

  var minCell = config.BOARD.minCell || 38;
  var cellSize = Math.max(24, Math.floor(maxBoard / n));
  // minCell 为「下限钳制」：仅在算出的 cell 明显偏小且空间允许时抬到 minCell
  if (cellSize < minCell && maxBoardW >= minCell * n && contentH * 0.62 >= minCell * n) {
    cellSize = Math.min(minCell, Math.floor(maxBoardW / n));
  }
  var boardW = cellSize * n;
  var boardH = cellSize * m;
  var boardX = Math.floor((L.W - boardW) / 2);

  // boardY 垂直居中于「可用带」：[contentTop+topReserveH, contentBottom-bottomBarH]
  var bandTop = L.contentTop + topReserveH;
  var bandBottom = L.contentBottom - bottomBarH;
  var bandH = bandBottom - bandTop;
  var boardY = bandTop + Math.max(0, Math.floor((bandH - boardH) / 2));
  // 防溢出钳制
  var minY = bandTop;
  var maxY = Math.max(bandTop, bandBottom - boardH);
  if (boardY < minY) boardY = minY;
  if (boardY > maxY) boardY = maxY;

  return { cellSize: cellSize, boardSize: boardW, boardWidth: boardW, boardHeight: boardH,
           boardX: boardX, boardY: boardY, cols: n, rows: m };
}

/**
 * 构建完整 Layout。
 * @param {object} sysInfo 可选，wx.getSystemInfoSync() 的结果；不传则内部尝试读取，无 wx 用默认值。
 */
function build(sysInfo) {
  var sys = sysInfo;
  if (!sys) {
    try {
      if (typeof wx !== 'undefined' && typeof wx.getSystemInfoSync === 'function') {
        sys = wx.getSystemInfoSync();
      }
    } catch (e) { sys = null; }
  }
  sys = sys || {};
  _rawSys = sys;

  var W = _num(sys.windowWidth, sys.screenWidth) || DEFAULT.W;
  var H = _num(sys.windowHeight, sys.screenHeight) || DEFAULT.H;
  var dpr = (typeof sys.pixelRatio === 'number' && sys.pixelRatio > 0) ? sys.pixelRatio : DEFAULT.dpr;

  var safe = _readSafe(sys, W, H);
  var gutter = config.gutter || 16;

  var contentTop = safe.top + GUTTER_PAD;
  var contentBottom = H - safe.bottom - GUTTER_PAD;
  if (contentBottom < contentTop) contentBottom = contentTop; // 极矮屏保护
  var contentLeft = safe.left + gutter;
  var contentRight = W - safe.right - gutter;
  if (contentRight < contentLeft) { contentLeft = gutter; contentRight = W - gutter; }
  var contentW = Math.max(0, contentRight - contentLeft);
  var contentH = Math.max(0, contentBottom - contentTop);

  var isCompact = W < 360;
  // 矮屏 / 窄屏断点（供场景做垂直重排；isCompact 只看宽度，320×568 同时命中两者）
  var isCompactH = H < 620;
  var isCompactW = W < 340;
  var isTablet = (W > 414) || (Math.min(W, H) >= 600);
  var isLandscape = W > H;
  // scale：大屏放大棋盘但字号阶梯不变（V2_VISUAL_SPEC §4.2）。1 基准，平板略放大棋盘。
  var scale = isTablet ? 1.12 : (isCompact ? 0.95 : 1);

  // 胶囊避让派生安全区：所有场景的顶栏起点在胶囊下缘之下、右侧状态左移至胶囊左缘之左。
  var capsule = _readCapsule(W, safe.top);
  var navSafeTop = Math.max(contentTop, capsule.bottom + 8);
  var navRightAvoid = Math.max(contentLeft, capsule.x - 8);

  var L = {
    W: W, H: H, dpr: dpr,
    safe: { top: safe.top, right: safe.right, bottom: safe.bottom, left: safe.left },
    contentTop: contentTop, contentBottom: contentBottom,
    contentLeft: contentLeft, contentRight: contentRight,
    contentW: contentW, contentH: contentH,
    gutter: gutter,
    isCompact: isCompact, isCompactH: isCompactH, isCompactW: isCompactW,
    isTablet: isTablet, isLandscape: isLandscape,
    scale: scale,
    navSafeTop: navSafeTop, navRightAvoid: navRightAvoid,
    capsule: capsule,
    board: null // 下面计算
  };
  L.board = computeBoard(L, { topReserveH: 0, bottomBarH: 0 }, 8, 8);
  return L;
}

/**
 * 初始化布局度量。应在 game.js 入口（拿到 sysInfo 后）调用一次。
 * @param {object} sysInfo 可选；不传内部自取。
 * @returns {object} Layout
 */
function init(sysInfo) {
  _layout = build(sysInfo);
  return _layout;
}

/**
 * 取当前布局度量。未 init 时懒初始化（安全降级），保证任意时刻调用不崩。
 * @returns {object} Layout
 */
function get() {
  if (!_layout) _layout = build(null);
  return _layout;
}

/**
 * 按场景实际预留重算棋盘度量（需求5 动态 boardY）。
 * 例如 gameplay：topReserveH=选手牌高(56)+间距，bottomBarH=工具栏高(84)。
 * @param {object} reserves {topReserveH, bottomBarH}
 * @param {number} cols 列数（默认取当前 board.cols）
 * @param {number} rows 行数（默认取当前 board.rows）
 * @returns {object} board 度量
 */
function computeFor(reserves, cols, rows) {
  var L = get();
  var b = computeBoard(L, reserves, cols || (L.board && L.board.cols) || 8,
                                     rows || (L.board && L.board.rows) || 8);
  return b;
}

/** 诊断：返回原始 sysInfo 快照（可能为空）。 */
function getRawSystemInfo() { return _rawSys; }

/** 测试用：重置单例。 */
function reset() { _layout = null; _rawSys = null; }

module.exports = {
  init: init,
  get: get,
  computeBoard: computeBoard,
  computeFor: computeFor,
  getRawSystemInfo: getRawSystemInfo,
  reset: reset
};
