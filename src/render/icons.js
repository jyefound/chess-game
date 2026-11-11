/**
 * 单色线性图标 · 24×24 视框归一化（视觉 §9）
 *
 * 重要：本文件**全路径自绘**，不再依赖任何系统 Unicode 字形。旧版对 check/star/undo/
 * back/forward/flip/more/play 走「安全 Unicode 白名单」fillText 渲染，在 Android / 微信 /
 * 缺字形环境下会显示为方框(tofu)，属发布阻断级缺陷。现统一改为 Canvas2D 路径绘制，
 * 彻底消除对系统字形的依赖。
 *
 * 两套接口：
 *  1) drawIcon(ctx, name, x, y, size, color) —— 场景层既有调用入口（menu/academy/... 经 ico() 调用）。
 *  2) 独立函数（本次新增，供替换散落各处的 Unicode 字形）：
 *        drawCheck / drawChevron / drawArrow / drawLock / drawStar / drawCoach / drawDot
 *        drawClose / drawUndo / drawRefresh / drawInfo / drawWarning / drawBullet / drawSpark
 *     覆盖全仓出现的 ✓ ✕ ↶ ↻ ⓘ ⚠ › ‹ ★ ☆ ◆ ● ◎ ✦ ▶ 等符号。
 *
 * drawIcon(ctx, name, x, y, size, color)
 *   (x, y) = 图标「中心」；size = 方框边长（pt）。
 *   线宽统一 size/24*1.75，端点/拐角 round，单色（继承 color），无填充块面、无渐变、无 emoji。
 */

'use strict';

var config = require('../config');
var C = config.COLORS;

// 24 视框内的圆角矩形路径（arcTo 实现，跨机型稳定）
function _rr(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function _strokePoly(ctx, pts, close) {
  ctx.beginPath();
  ctx.moveTo(pts[0][0], pts[0][1]);
  for (var i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
  if (close) ctx.closePath();
  ctx.stroke();
}

// ---- 路径图标（在 0..24 局部坐标绘制） ----
var PATHS = {
  // 设置：圆 r5 + 8 齿 + 内圆 r2
  settings: function (c) {
    c.beginPath(); c.arc(12, 12, 5, 0, Math.PI * 2); c.stroke();
    c.beginPath(); c.arc(12, 12, 2, 0, Math.PI * 2); c.stroke();
    for (var i = 0; i < 8; i++) {
      var a = i * Math.PI / 4;
      _strokePoly(c, [[12 + Math.cos(a) * 6, 12 + Math.sin(a) * 6],
                      [12 + Math.cos(a) * 8.5, 12 + Math.sin(a) * 8.5]]);
    }
  },
  // 保存 / 存谱：软盘抽象（外框 + 顶部凹槽 + 底部方孔）
  save: function (c) {
    _rr(c, 3.5, 3.5, 17, 17, 2); c.stroke();
    _strokePoly(c, [[7, 3.5], [7, 9.5], [17, 9.5], [17, 3.5]]);
    _strokePoly(c, [[12, 4.5], [12, 7.5]]);
    _rr(c, 8, 13, 8, 7.5, 1); c.stroke();
  },
  // 难度：3 根递增竖条
  difficulty: function (c) {
    _strokePoly(c, [[5, 20], [5, 16]]);
    _strokePoly(c, [[12, 20], [12, 12]]);
    _strokePoly(c, [[19, 20], [19, 7]]);
  },
  // 音效开：喇叭梯形 + 2 道声波
  soundOn: function (c) {
    _strokePoly(c, [[4, 9.5], [8, 9.5], [12.5, 5.5], [12.5, 18.5], [8, 14.5], [4, 14.5]], true);
    c.beginPath(); c.arc(12.5, 12, 4, -0.9, 0.9); c.stroke();
    c.beginPath(); c.arc(12.5, 12, 7.5, -0.9, 0.9); c.stroke();
  },
  // 音效关：喇叭 + 45° 斜线（叉）
  soundOff: function (c) {
    _strokePoly(c, [[4, 9.5], [8, 9.5], [12.5, 5.5], [12.5, 18.5], [8, 14.5], [4, 14.5]], true);
    _strokePoly(c, [[15.5, 9], [21.5, 15]]);
    _strokePoly(c, [[21.5, 9], [15.5, 15]]);
  },
  // 教学：打开的书（2 页对称贝塞尔 + 中缝竖线）
  teach: function (c) {
    c.beginPath();
    c.moveTo(12, 7);
    c.quadraticCurveTo(7, 5, 3, 7);
    c.lineTo(3, 18);
    c.quadraticCurveTo(7, 16, 12, 18);
    c.lineTo(12, 7);
    c.moveTo(12, 7);
    c.quadraticCurveTo(17, 5, 21, 7);
    c.lineTo(21, 18);
    c.quadraticCurveTo(17, 16, 12, 18);
    c.stroke();
    _strokePoly(c, [[12, 7], [12, 18]]);
  },
  // 人机：芯片（圆角方 + 中心点 + 四周短引脚）
  ai: function (c) {
    _rr(c, 6, 6, 12, 12, 2); c.stroke();
    c.beginPath(); c.arc(12, 12, 2, 0, Math.PI * 2); c.stroke();
    var pins = [
      [9, 3, 9, 6], [12, 3, 12, 6], [15, 3, 15, 6],
      [9, 18, 9, 21], [12, 18, 12, 21], [15, 18, 15, 21],
      [3, 9, 6, 9], [3, 12, 6, 12], [3, 15, 6, 15],
      [18, 9, 21, 9], [18, 12, 21, 12], [18, 15, 21, 15]
    ];
    for (var i = 0; i < pins.length; i++) _strokePoly(c, [[pins[i][0], pins[i][1]], [pins[i][2], pins[i][3]]]);
  },
  // 双人：2 个圆（错位）+ 肩部弧线
  // 个人资料：头像轮廓（圆形头部 + 肩部弧线）
  user: function (c) {
    c.beginPath(); c.arc(12, 8, 3.5, 0, Math.PI * 2); c.stroke();
    c.beginPath(); c.moveTo(4, 20); c.quadraticCurveTo(4, 13, 12, 13); c.quadraticCurveTo(20, 13, 20, 20); c.stroke();
  },
  twoPlayers: function (c) {
    c.beginPath(); c.arc(9, 8, 3, 0, Math.PI * 2); c.stroke();
    c.beginPath(); c.arc(16, 8.5, 2.6, 0, Math.PI * 2); c.stroke();
    c.beginPath(); c.moveTo(3.5, 19); c.quadraticCurveTo(9, 13, 14.5, 19); c.stroke();
    c.beginPath(); c.moveTo(13, 19); c.quadraticCurveTo(16, 14.5, 20, 16.5); c.stroke();
  },
  // 关闭 X（✕）
  close: function (c) {
    _strokePoly(c, [[6, 6], [18, 18]]);
    _strokePoly(c, [[18, 6], [6, 18]]);
  },
  // 提示：灯泡（圆 + 底部短线 + 3 射线）
  hint: function (c) {
    c.beginPath(); c.arc(12, 10, 5.5, 0, Math.PI * 2); c.stroke();
    _strokePoly(c, [[9.5, 16], [14.5, 16]]);
    _strokePoly(c, [[10.5, 18.5], [13.5, 18.5]]);
    var rays = [[12, 1.5, 12, 3.5], [2.5, 5, 4.2, 6.2], [21.5, 5, 19.8, 6.2],
                [2, 10, 3.8, 10], [22, 10, 20.2, 10]];
    for (var i = 0; i < rays.length; i++) _strokePoly(c, [[rays[i][0], rays[i][1]], [rays[i][2], rays[i][3]]]);
  },
  // 旗帜：竖杆 + 三角旗面
  flag: function (c) {
    _strokePoly(c, [[6, 3], [6, 21]]);
    _strokePoly(c, [[6, 4], [18, 7], [6, 10.5]], true);
  },
  // 计时：圆 + 两根指针
  clock: function (c) {
    c.beginPath(); c.arc(12, 12, 8.5, 0, Math.PI * 2); c.stroke();
    _strokePoly(c, [[12, 12], [12, 7]]);
    _strokePoly(c, [[12, 12], [15.5, 13.5]]);
  },
  // 书：闭合书本（矩形 + 书脊）
  book: function (c) {
    c.beginPath();
    c.moveTo(5, 4); c.lineTo(17, 4);
    c.quadraticCurveTo(19, 4, 19, 6); c.lineTo(19, 19);
    c.quadraticCurveTo(19, 20.5, 17, 20.5); c.lineTo(5, 20.5);
    c.closePath(); c.stroke();
    _strokePoly(c, [[8, 4], [8, 20.5]]);
  },
  // 棋谱记录：文档 + 三行条目
  records: function (c) {
    _rr(c, 5, 3, 14, 18, 2); c.stroke();
    _strokePoly(c, [[8, 8], [16, 8]]);
    _strokePoly(c, [[8, 12], [16, 12]]);
    _strokePoly(c, [[8, 16], [13, 16]]);
  },
  // 暂停：两条竖杠
  pause: function (c) {
    _strokePoly(c, [[9, 5], [9, 19]]);
    _strokePoly(c, [[15, 5], [15, 19]]);
  },
  // 跳到起点 |◀
  first: function (c) {
    _strokePoly(c, [[6, 5], [6, 19]]);
    _strokePoly(c, [[18, 6], [10, 12], [18, 18]], true);
  },
  // 跳到终点 ▶|
  last: function (c) {
    _strokePoly(c, [[6, 6], [14, 12], [6, 18]], true);
    _strokePoly(c, [[18, 5], [18, 19]]);
  },
  // 左尖括号 ‹（路径版）
  chevronLeft: function (c) {
    _strokePoly(c, [[15, 5], [8, 12], [15, 19]]);
  },
  // 右尖括号 ›（路径版）
  chevronRight: function (c) {
    _strokePoly(c, [[9, 5], [16, 12], [9, 19]]);
  },
  // 上尖括号 ▴（路径版）
  chevronUp: function (c) {
    _strokePoly(c, [[5, 15], [12, 8], [19, 15]]);
  },
  // 下尖括号 ▾（路径版）
  chevronDown: function (c) {
    _strokePoly(c, [[5, 9], [12, 16], [19, 9]]);
  },
  // 复制：两个叠加圆角矩形
  copy: function (c) {
    _rr(c, 8, 8, 12, 12, 2); c.stroke();
    _strokePoly(c, [[16, 8], [16, 5], [5, 5], [5, 16], [8, 16]]);
  },

  // ================= v2 新增：技能图标 =================
  // 沙漏 skillHourglass：上下两三角 + 中间束腰 + 上下横杠
  skillHourglass: function (c) {
    _rr(c, 6, 3, 12, 2, 1); c.stroke();
    _rr(c, 6, 19, 12, 2, 1); c.stroke();
    _strokePoly(c, [[7, 5], [17, 5], [12, 12]], true);
    _strokePoly(c, [[7, 19], [17, 19], [12, 12]], true);
    _strokePoly(c, [[12, 14], [12, 16]]);
  },
  // 明镜 skillMirror：椭圆镜面 + 手柄 + 一道反光
  skillMirror: function (c) {
    c.beginPath(); c.ellipse(12, 9, 6, 7, 0, 0, Math.PI * 2); c.stroke();
    _strokePoly(c, [[12, 16], [12, 21]]);
    _strokePoly(c, [[9, 6], [11, 4]]);
  },
  // 回马枪 skillUndo：回旋箭头（区别于通用 undo，加一小马点）
  skillUndo: function (c) {
    c.beginPath(); c.arc(12, 12, 6, Math.PI * 0.15, Math.PI * 1.75); c.stroke();
    _strokePoly(c, [[6, 8], [6, 13], [11, 13]]); // 箭头端
    c.beginPath(); c.arc(12, 12, 1.2, 0, Math.PI * 2); c.fill(); // 马眼点
  },
  // 探马 skillScout：望远镜/眼睛 + 探射线
  skillScout: function (c) {
    c.beginPath(); c.moveTo(3, 12); c.quadraticCurveTo(12, 5, 21, 12);
    c.quadraticCurveTo(12, 19, 3, 12); c.stroke();
    c.beginPath(); c.arc(12, 12, 2.5, 0, Math.PI * 2); c.stroke();
  },
  // 定风珠 skillFreeze：六角雪花（3 轴 + 短枝）
  skillFreeze: function (c) {
    var axes = [[12, 3, 12, 21], [4.2, 7.5, 19.8, 16.5], [4.2, 16.5, 19.8, 7.5]];
    for (var i = 0; i < axes.length; i++) _strokePoly(c, [[axes[i][0], axes[i][1]], [axes[i][2], axes[i][3]]]);
    _strokePoly(c, [[9.5, 5.5], [12, 3], [14.5, 5.5]]);
    _strokePoly(c, [[9.5, 18.5], [12, 21], [14.5, 18.5]]);
  },
  // 妙手 skillMaster：四角星 spark + 一小卒底（绝妙一手）
  skillMaster: function (c) {
    c.beginPath();
    c.moveTo(12, 3); c.lineTo(13.6, 10.4); c.lineTo(21, 12);
    c.lineTo(13.6, 13.6); c.lineTo(12, 21); c.lineTo(10.4, 13.6);
    c.lineTo(3, 12); c.lineTo(10.4, 10.4); c.closePath(); c.stroke();
  },
  // 护身 skillShield：盾形 + 中线
  skillShield: function (c) {
    c.beginPath();
    c.moveTo(12, 3); c.lineTo(19, 5.5); c.lineTo(19, 12);
    c.quadraticCurveTo(19, 17.5, 12, 21);
    c.quadraticCurveTo(5, 17.5, 5, 12); c.lineTo(5, 5.5);
    c.closePath(); c.stroke();
    _strokePoly(c, [[12, 7], [12, 16]]);
  },

  // ================= v2 新增：场景/功能图标 =================
  // 教练 coach：气泡 + 内部声线
  coach: function (c) {
    c.beginPath();
    c.moveTo(4, 6); c.lineTo(20, 6); c.quadraticCurveTo(21, 6, 21, 7);
    c.lineTo(21, 15); c.quadraticCurveTo(21, 16, 20, 16);
    c.lineTo(10, 16); c.lineTo(6, 20); c.lineTo(6, 16); c.lineTo(4, 16);
    c.quadraticCurveTo(3, 16, 3, 15); c.lineTo(3, 7);
    c.quadraticCurveTo(3, 6, 4, 6); c.closePath(); c.stroke();
    _strokePoly(c, [[7, 10], [17, 10]]);
    _strokePoly(c, [[7, 13], [14, 13]]);
  },
  // 锦囊阁 academy：书 + 上方囊袋扎口
  academy: function (c) {
    c.beginPath(); c.moveTo(9, 8); c.lineTo(12, 4); c.lineTo(15, 8); c.stroke();
    c.beginPath();
    c.moveTo(6, 8); c.lineTo(18, 8);
    c.quadraticCurveTo(20, 8, 20.5, 11);
    c.lineTo(21, 19); c.quadraticCurveTo(21, 20.5, 19.5, 20.5);
    c.lineTo(4.5, 20.5); c.quadraticCurveTo(3, 20.5, 3, 19);
    c.lineTo(3.5, 11); c.quadraticCurveTo(4, 8, 6, 8); c.closePath(); c.stroke();
    _strokePoly(c, [[8.5, 12], [15.5, 12]]);
  },
  // 残局/阵 endgame：棋盘格 + 一枚突出棋子（破阵）
  endgame: function (c) {
    _rr(c, 4, 4, 16, 16, 1.5); c.stroke();
    _strokePoly(c, [[12, 4], [12, 20]]);
    _strokePoly(c, [[4, 12], [20, 12]]);
    c.beginPath(); c.arc(16, 8, 1.8, 0, Math.PI * 2); c.fill();
  },
  // 计时 timer：秒表（圆 + 顶部按钮 + 指针）
  timer: function (c) {
    c.beginPath(); c.arc(12, 13.5, 7.5, 0, Math.PI * 2); c.stroke();
    _rr(c, 10.5, 3, 3, 2.5, 0.8); c.stroke();
    _strokePoly(c, [[19, 5.5], [21, 4]]);
    _strokePoly(c, [[12, 13.5], [12, 9]]);
    _strokePoly(c, [[12, 13.5], [15, 15]]);
  },
  // 锁 lock：锁体 + 锁梁
  lock: function (c) {
    _rr(c, 5, 11, 14, 9, 2); c.stroke();
    c.beginPath(); c.arc(12, 10.5, 4, Math.PI, 0); c.stroke();
    c.beginPath(); c.arc(12, 15, 1.4, 0, Math.PI * 2); c.fill();
    _strokePoly(c, [[12, 15], [12, 17]]);
  },
  // 眼 eye（看一步/预演）：上下弧 + 瞳孔
  eye: function (c) {
    c.beginPath(); c.moveTo(3, 12); c.quadraticCurveTo(12, 5, 21, 12);
    c.quadraticCurveTo(12, 19, 3, 12); c.stroke();
    c.beginPath(); c.arc(12, 12, 2.5, 0, Math.PI * 2); c.stroke();
  },
  // 四角星 spark（妙招卡/教学入口/史诗稀有度）：中心 + 4 短射线
  spark: function (c) {
    _strokePoly(c, [[12, 3], [12, 8]]);
    _strokePoly(c, [[12, 16], [12, 21]]);
    _strokePoly(c, [[3, 12], [8, 12]]);
    _strokePoly(c, [[16, 12], [21, 12]]);
    c.beginPath(); c.arc(12, 12, 1.6, 0, Math.PI * 2); c.fill();
  },

  // ================= v2 权威新增：棋种/场景图标 =================
  // 中国象棋 xiangqi
  xiangqi: function (c) {
    _rr(c, 3, 3, 18, 18, 1); c.stroke();
    for (var i = 0; i < 5; i++) {
      var x = 4.5 + i * 3.75;
      _strokePoly(c, [[x, 5], [x, 11]]);
      _strokePoly(c, [[x, 13], [x, 19]]);
    }
    _strokePoly(c, [[4.5, 5], [19.5, 5]]);
    _strokePoly(c, [[4.5, 9], [19.5, 9]]);
    _strokePoly(c, [[4.5, 15], [19.5, 15]]);
    _strokePoly(c, [[4.5, 19], [19.5, 19]]);
    _strokePoly(c, [[7, 11.5], [10, 12.5]]);
    _strokePoly(c, [[14, 11.5], [17, 12.5]]);
  },
  // 五子棋 gomoku
  gomoku: function (c) {
    _rr(c, 3.5, 3.5, 17, 17, 1); c.stroke();
    for (var i = 1; i < 4; i++) {
      var p = 3.5 + i * 4.25;
      _strokePoly(c, [[p, 3.5], [p, 20.5]]);
      _strokePoly(c, [[3.5, p], [20.5, p]]);
    }
    var pts = [[7, 7], [9.7, 9.7], [12.4, 12.4], [15.1, 15.1], [17.8, 17.8]];
    for (var j = 0; j < pts.length; j++) {
      c.beginPath(); c.arc(pts[j][0], pts[j][1], 1.5, 0, Math.PI * 2); c.fill();
    }
  },
  // 围棋 go
  go: function (c) {
    _rr(c, 3.5, 3.5, 17, 17, 1); c.stroke();
    for (var i = 1; i < 4; i++) {
      var p = 3.5 + i * 4.25;
      _strokePoly(c, [[p, 3.5], [p, 20.5]]);
      _strokePoly(c, [[3.5, p], [20.5, p]]);
    }
    var stars = [[7.75, 7.75], [16.25, 7.75], [7.75, 16.25], [16.25, 16.25], [12, 12]];
    for (var s = 0; s < stars.length; s++) {
      c.beginPath(); c.arc(stars[s][0], stars[s][1], 0.9, 0, Math.PI * 2); c.fill();
    }
    c.beginPath(); c.arc(12, 7.75, 2.1, 0, Math.PI * 2); c.fill();
    c.beginPath(); c.arc(7.75, 12, 2.1, 0, Math.PI * 2); c.stroke();
  },
  // 阵图/路线 map：节点 + 连线（S 形闯关路线）
  map: function (c) {
    _strokePoly(c, [[5, 5], [19, 5], [19, 12], [5, 12], [5, 19], [19, 19]]);
    var nodes = [[5, 5], [19, 5], [19, 12], [5, 12], [5, 19], [19, 19]];
    for (var i = 0; i < nodes.length; i++) {
      c.beginPath();
      if (i < 2) { c.arc(nodes[i][0], nodes[i][1], 1.8, 0, Math.PI * 2); c.fill(); }
      else { c.arc(nodes[i][0], nodes[i][1], 1.8, 0, Math.PI * 2); c.stroke(); }
    }
    c.beginPath(); c.arc(19, 12, 3.2, 0, Math.PI * 2); c.stroke();
  },

  // ================= 本次新增：原 Unicode 白名单全部改路径 =================
  // 勾 ✓（替代 ✅/✓）
  check: function (c) {
    c.beginPath();
    c.moveTo(5, 12.5); c.lineTo(10.5, 18); c.lineTo(19, 6);
    c.stroke();
  },
  // 五角星 ☆（描边）/ ★ 由 drawStar(filled=true) 处理
  star: function (c) {
    _starPath(c, 12, 12, 9, 3.8, -Math.PI / 2);
    c.stroke();
  },
  // 回旋箭头 ↶（撤销）
  undo: function (c) {
    c.beginPath(); c.arc(12, 12, 6.5, Math.PI * 0.2, Math.PI * 1.8, false); c.stroke();
    c.beginPath();
    c.moveTo(6, 9); c.lineTo(6, 14.5); c.lineTo(11.5, 14.5);
    c.stroke();
  },
  // 顺时针回环 ↻（重试 / 再试一式）
  refresh: function (c) {
    c.beginPath(); c.arc(12, 12, 6.5, Math.PI * 1.2, Math.PI * 2.9, false); c.stroke();
    c.beginPath();
    c.moveTo(18, 14.5); c.lineTo(18, 9); c.lineTo(13, 9);
    c.stroke();
  },
  // 左箭头 ←（返回）
  back: function (c) {
    _strokePoly(c, [[19, 12], [5, 12]]);
    _strokePoly(c, [[10, 7], [5, 12], [10, 17]]);
  },
  // 右箭头 →
  forward: function (c) {
    _strokePoly(c, [[5, 12], [19, 12]]);
    _strokePoly(c, [[14, 7], [19, 12], [14, 17]]);
  },
  // 上下箭头 ↕（翻转）
  flip: function (c) {
    _strokePoly(c, [[12, 4], [12, 20]]);
    _strokePoly(c, [[7, 9], [12, 4], [17, 9]]);
    _strokePoly(c, [[7, 15], [12, 20], [17, 15]]);
  },
  // 省略号 ⋯（更多）
  more: function (c) {
    c.beginPath(); c.arc(6, 12, 1.4, 0, Math.PI * 2); c.fill();
    c.beginPath(); c.arc(12, 12, 1.4, 0, Math.PI * 2); c.fill();
    c.beginPath(); c.arc(18, 12, 1.4, 0, Math.PI * 2); c.fill();
  },
  // 播放三角 ▷
  play: function (c) {
    c.beginPath();
    c.moveTo(8, 6); c.lineTo(8, 18); c.lineTo(19, 12);
    c.closePath(); c.fill();
  },
  // 信息 ⓘ（i 在圈内）
  info: function (c) {
    c.beginPath(); c.arc(12, 12, 9, 0, Math.PI * 2); c.stroke();
    c.beginPath(); c.arc(12, 8.5, 1.2, 0, Math.PI * 2); c.fill();
    _strokePoly(c, [[12, 11], [12, 17]]);
  },
  // 警告 ⚠（三角 + 叹号）
  warning: function (c) {
    c.beginPath();
    c.moveTo(12, 4); c.lineTo(21, 19); c.lineTo(3, 19);
    c.closePath(); c.stroke();
    c.beginPath(); c.arc(12, 14, 1.2, 0, Math.PI * 2); c.fill();
    _strokePoly(c, [[12, 8], [12, 12]]);
  }
};

// 五角星路径（filled 决定填充/描边由调用方设置）
function _starPath(c, cx, cy, outer, inner, rot) {
  rot = (typeof rot === 'number') ? rot : -Math.PI / 2;
  c.beginPath();
  for (var i = 0; i < 10; i++) {
    var r = (i % 2 === 0) ? outer : inner;
    var a = rot + i * Math.PI / 5;
    var x = cx + Math.cos(a) * r;
    var y = cy + Math.sin(a) * r;
    if (i === 0) c.moveTo(x, y); else c.lineTo(x, y);
  }
  c.closePath();
}

// fe-logic 场景层命名别名（纯增量不删）
PATHS.teaching = PATHS.teach;
PATHS.local = PATHS.twoPlayers;
PATHS.pause2 = PATHS.pause;
PATHS.hourglass = PATHS.skillHourglass;
PATHS.mirror    = PATHS.skillMirror;
PATHS.scout     = PATHS.skillScout;
PATHS.freeze    = PATHS.skillFreeze;
PATHS.master    = PATHS.skillMaster;
PATHS.ward      = PATHS.skillShield;

// ---------------------------------------------------------------------------
// 通用包装：在 (x,y) 中心、size 边长内，以统一线宽/端点绘制 fn(ctx)
// ---------------------------------------------------------------------------
function _with(ctx, x, y, size, color, fn) {
  var s = (typeof size === 'number' && size > 0) ? size : 24;
  var col = color || C.textSecondary;
  ctx.save();
  ctx.translate(x - s / 2, y - s / 2);
  ctx.scale(s / 24, s / 24);
  ctx.strokeStyle = col;
  ctx.fillStyle = col;
  ctx.lineWidth = 1.75;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  fn(ctx);
  ctx.restore();
}

/**
 * 绘制图标（场景层入口）。
 * @param {CanvasRenderingContext2D} ctx
 * @param {string} name   见 PATHS 枚举
 * @param {number} x      中心 x
 * @param {number} y      中心 y
 * @param {number} size   方框边长（pt），默认 24
 * @param {string} color  单色，默认 textSecondary
 */
function drawIcon(ctx, name, x, y, size, color) {
  if (!ctx || !name) return;
  var fn = PATHS[name];
  if (fn) _with(ctx, x, y, size, color, fn);
  // 未知 name：静默不绘制（不抛错、不污染画布）
}

/** 是否支持该图标名（供场景判断是否回退到文字） */
function hasIcon(name) {
  return !!PATHS[name];
}

// ===========================================================================
// 独立图标函数（替换散落各处的 Unicode 字形）
// ===========================================================================

// 勾 ✓
function drawCheck(ctx, x, y, size, color) {
  _with(ctx, x, y, size, color, PATHS.check);
}

// 箭头/尖括号 › ‹ ▴ ▾，dir: 'up'|'down'|'left'|'right'
function drawChevron(ctx, x, y, size, dir, color) {
  var fn = PATHS.chevronRight;
  if (dir === 'left') fn = PATHS.chevronLeft;
  else if (dir === 'up') fn = PATHS.chevronUp;
  else if (dir === 'down') fn = PATHS.chevronDown;
  _with(ctx, x, y, size, color, fn);
}

// 直线箭头（提示/教学），size 为线宽与箭头尺度参考
function drawArrow(ctx, x1, y1, x2, y2, size, color) {
  if (!ctx) return;
  var col = color || C.textSecondary;
  var dx = x2 - x1, dy = y2 - y1;
  var len = Math.sqrt(dx * dx + dy * dy) || 1;
  var ux = dx / len, uy = dy / len;
  var px = -uy, py = ux; // 垂直
  var aw = (typeof size === 'number' && size > 0) ? size : 8; // 箭头半宽
  var head = Math.max(6, aw * 1.6);
  ctx.save();
  ctx.strokeStyle = col;
  ctx.fillStyle = col;
  ctx.lineWidth = Math.max(1.5, aw * 0.5);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2 - ux * head, y2 - uy * head); ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(x2, y2);
  ctx.lineTo(x2 - ux * head + px * aw, y2 - uy * head + py * aw);
  ctx.lineTo(x2 - ux * head - px * aw, y2 - uy * head - py * aw);
  ctx.closePath(); ctx.fill();
  ctx.restore();
}

// 锁 🔒
function drawLock(ctx, x, y, size, color) {
  _with(ctx, x, y, size, color, PATHS.lock);
}

// 五角星 ★/☆
function drawStar(ctx, x, y, size, filled, color) {
  var s = (typeof size === 'number' && size > 0) ? size : 24;
  var col = color || C.textSecondary;
  ctx.save();
  ctx.translate(x - s / 2, y - s / 2);
  ctx.scale(s / 24, s / 24);
  ctx.strokeStyle = col;
  ctx.fillStyle = col;
  ctx.lineWidth = 1.75;
  ctx.lineJoin = 'round';
  _starPath(ctx, 12, 12, 9.5, 4, -Math.PI / 2);
  if (filled) ctx.fill(); else ctx.stroke();
  ctx.restore();
}

// 教练符号（气泡）
function drawCoach(ctx, x, y, size, color) {
  _with(ctx, x, y, size, color, PATHS.coach);
}

// 实心圆点
function drawDot(ctx, x, y, r, color) {
  if (!ctx) return;
  var col = color || C.textSecondary;
  ctx.save();
  ctx.fillStyle = col;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

// 关闭 X（✕）
function drawClose(ctx, x, y, size, color) {
  _with(ctx, x, y, size, color, PATHS.close);
}

// 撤销回旋箭头（↶）
function drawUndo(ctx, x, y, size, color) {
  _with(ctx, x, y, size, color, PATHS.undo);
}

// 重试/顺时针回环（↻）
function drawRefresh(ctx, x, y, size, color) {
  _with(ctx, x, y, size, color, PATHS.refresh);
}

// 信息（ⓘ）
function drawInfo(ctx, x, y, size, color) {
  _with(ctx, x, y, size, color, PATHS.info);
}

// 警告（⚠）
function drawWarning(ctx, x, y, size, color) {
  _with(ctx, x, y, size, color, PATHS.warning);
}

// 稀有度/图例标记 ◆ ● ◎，style: 'diamond' | 'disc' | 'ring'
function drawBullet(ctx, x, y, size, style, color) {
  var s = (typeof size === 'number' && size > 0) ? size : 12;
  var col = color || C.textSecondary;
  ctx.save();
  ctx.translate(x - s / 2, y - s / 2);
  ctx.scale(s / 24, s / 24);
  ctx.strokeStyle = col;
  ctx.fillStyle = col;
  ctx.lineWidth = 2;
  ctx.lineJoin = 'round';
  if (style === 'disc') {
    ctx.beginPath(); ctx.arc(12, 12, 7, 0, Math.PI * 2); ctx.fill();
  } else if (style === 'ring') {
    ctx.beginPath(); ctx.arc(12, 12, 7, 0, Math.PI * 2); ctx.stroke();
  } else { // diamond ◆
    ctx.beginPath();
    ctx.moveTo(12, 3); ctx.lineTo(21, 12); ctx.lineTo(12, 21); ctx.lineTo(3, 12);
    ctx.closePath(); ctx.fill();
  }
  ctx.restore();
}

// 闪光四角星（✦，史诗稀有度等）
function drawSpark(ctx, x, y, size, color) {
  _with(ctx, x, y, size, color, PATHS.spark);
}

module.exports = {
  drawIcon: drawIcon,
  hasIcon: hasIcon,
  drawCheck: drawCheck,
  drawChevron: drawChevron,
  drawArrow: drawArrow,
  drawLock: drawLock,
  drawStar: drawStar,
  drawCoach: drawCoach,
  drawDot: drawDot,
  drawClose: drawClose,
  drawUndo: drawUndo,
  drawRefresh: drawRefresh,
  drawInfo: drawInfo,
  drawWarning: drawWarning,
  drawBullet: drawBullet,
  drawSpark: drawSpark
};
