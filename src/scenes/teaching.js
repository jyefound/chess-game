/**
 * S4 教学场景（10 课互动化）
 * 三态（补遗 §A）：READING 高亮全显 / TRY_PROMPT 隐藏全部高亮 / REVEAL 仅目标格脉冲金环。
 * 三级判定（UX §3.1.3）：GUIDE（不计错，静音）/ MISS（计错，抖动红环+错误音）/ CORRECT（金闪✓+横幅+上行音）。
 * 提示阶梯 H1 文字 → H2 缩范围 → H3 揭晓；missCount 1/2/3 自动触发，或主动点 💡；不限重试、永不锁定。
 * 互动原语：P1 点选起点→终点 / P2 仅点终点 / P3 仅点棋子，零拖拽。
 * C8 防泄题（最高优先级）：考核态 drawMiniBoard 的 highlights 传 []，且选中棋子绝不渲染合法走法点；
 *   READING 的静态高亮绑定课程，考核态显式覆盖为空。所有反馈高亮由本场景自绘，完全可控。
 * C2：教学页中间可滚动，顶部导航/底部按钮固定，要点不截断（修复原 if(pointsY<H-160)break 截断）。
 * C7：图例 Caption 13 / 去 emoji；关键信息用 secondary。
 * 先读再练（Phase 2-7）：READING 态底部主 CTA =「开始练习」（走 READING→TRY），
 *   作答中（TRY/SELECTED/MISS/PROMO）CTA 置灰不可跳步；OK/COMPLETED/REVEAL 后才切「下一式 →」。
 *   onBoardTap 首行 READING guard：未开始练习禁止落子（只做引导，不计错）。
 *   内容区底部渐隐 +「上滑阅读要点」提示，告知首屏下方还有讲解。
 */
const GameContext = require('../context');
const M = require('./manager');
const { theme, TouchGuard, util, createTap } = M;
const C = theme.colors, R = theme.radius, MO = theme.motion;
const TF = (k) => theme.font(k);
const rr = util.rr, inRect = util.inRect, drawBtn = util.drawButtonLocal, wrapLocal = util.wrapLocal;
const Board = require('../core/board');
const ChessGame = require('../core/game');
const boardRender = require('../render/board');
const { PIECE_SYMBOLS, PIECE_GLYPHS } = require('../core/constants');
const layout = require('../core/layout');
const topbar = require('../render/topbar');

// REVEAL 金环脉冲工具（终审 #4）：revealPulseAlpha(timeMs, startMs) 300ms×2 后收敛静态 .5
const anim = (() => { try { return require('../core/anim'); } catch (e) { return null; } })();

const icons = (() => { try { return require('../render/icons'); } catch (e) { return null; } })();
const piecesRender = require('../render/pieces');
function ico(ctx, name, x, y, size, color) {
  if (icons && typeof icons.drawIcon === 'function') {
    try { icons.drawIcon(ctx, name, x, y, size, color); return true; } catch (e) { /* noop */ }
  }
  return false;
}
function emptyBoard() { return Array.from({ length: 8 }, () => Array(8).fill(null)); }
function hlColor(kind) {
  if (kind === 'capture') return 'rgba(201,162,75,0.50)';
  if (kind === 'key') return 'rgba(217,106,106,0.45)';
  return 'rgba(201,162,75,0.30)'; // legal
}
// 便捷：把 [{row,col,kind}] 转成 drawMiniBoard 需要的 [{row,col,color}]
function toMiniHighlights(list) { return (list || []).map(h => ({ row: h.row, col: h.col, color: h.color || hlColor(h.kind) })); }

// ==================== 10 课数据 ====================
const LESSONS = [
  {
    title: '棋盘与棋子',
    keyPoints: ['棋盘 8×8 = 64 格', '双方各 16 子：1 王 1 后 2 车 2 象 2 马 8 兵', '竖线 a–h，横线 1–8', '白方在下、先行'],
    steps: [{
      desc: '国际象棋棋盘由 64 个深浅相间的格子组成（8×8）。双方各 16 个棋子：1 王、1 后、2 车、2 象、2 马、8 兵。\n开局摆法（从 a 到 h）：车、马、象、后、王、象、马、车；第二排全是兵。白方在下，黑方在上。',
      highlights: [{ row: 7, col: 3, kind: 'key' }],
      setup: (b) => { b.reset(); },
      interaction: { mode: 'P2', prompt: '点出白后开局所在的格子', accept: [[7, 3]],
        hint: ['记住「白后站白格」，她开局在底线、白王旁。', '看最下面一行，从 a 数起第 4 格。', '就是 d1，点它！'] }
    }]
  },
  {
    title: '兵的走法',
    keyPoints: ['兵直走斜吃', '起始位置可首次走两格', '不能后退', '到底线可升变'],
    steps: [{
      desc: '兵只能向前直走，每次一格；在起始位置第一次可选择走两格。兵斜前方一格吃子，不能直着吃，也不能后退。',
      highlights: [{ row: 3, col: 4, kind: 'legal' }, { row: 3, col: 3, kind: 'capture' }, { row: 3, col: 5, kind: 'capture' }],
      setup: (b) => { b.reset(); b.setPiece(4, 4, { type: 'p', color: 'w' }); b.setPiece(3, 3, { type: 'p', color: 'b' }); b.setPiece(3, 5, { type: 'p', color: 'b' }); },
      interaction: { mode: 'P1', from: [4, 4], prompt: '用白兵吃掉一个黑兵', accept: [[3, 3], [3, 5]],
        hint: ['兵是斜着吃的，看白兵 e4 的左前方与右前方。', '试试 d5 或 f5 的黑兵。', '点 d5 或 f5，吃掉黑兵！'] }
    }]
  },
  {
    title: '车的走法',
    keyPoints: ['车沿横、竖线走', '格数不限', '不能跳过其他棋子', '价值约 5 分'],
    steps: [{
      desc: '车沿横线或竖线走任意格数，不能跳过其他棋子。车善于控制开放线路，是威力强大的棋子。',
      highlights: [
        { row: 4, col: 0, kind: 'legal' }, { row: 4, col: 1, kind: 'legal' }, { row: 4, col: 2, kind: 'legal' }, { row: 4, col: 3, kind: 'legal' },
        { row: 4, col: 5, kind: 'legal' }, { row: 4, col: 6, kind: 'capture' },
        { row: 0, col: 4, kind: 'legal' }, { row: 1, col: 4, kind: 'legal' }, { row: 2, col: 4, kind: 'legal' }, { row: 3, col: 4, kind: 'legal' },
        { row: 5, col: 4, kind: 'legal' }, { row: 6, col: 4, kind: 'legal' }, { row: 7, col: 4, kind: 'legal' }
      ],
      setup: (b) => { b.grid = emptyBoard(); b.setPiece(4, 4, { type: 'r', color: 'w' }); b.setPiece(4, 6, { type: 'p', color: 'b' }); },
      interaction: { mode: 'P1', from: [4, 4], prompt: '用车吃掉黑兵', accept: [[4, 6]],
        hint: ['车走横线，黑兵就在同一横行。', '一路走到最右边，就能吃到它。', '试试 g4 的黑兵。'] }
    }]
  },
  {
    title: '马的走法',
    keyPoints: ['马走「日」字（L 形）', '唯一能跳子的棋子', '每步换色', '价值约 3 分'],
    steps: [{
      desc: '马走「日」字：先直走两格再横一格，或先横两格再直一格。马是唯一能跳过其他棋子的棋子，每步都会换格色。',
      highlights: [{ row: 2, col: 3, kind: 'capture' }, { row: 3, col: 2, kind: 'capture' },
        { row: 2, col: 5, kind: 'legal' }, { row: 3, col: 6, kind: 'legal' }, { row: 5, col: 2, kind: 'legal' },
        { row: 5, col: 6, kind: 'legal' }, { row: 6, col: 3, kind: 'legal' }, { row: 6, col: 5, kind: 'legal' }],
      setup: (b) => { b.grid = emptyBoard(); b.setPiece(4, 4, { type: 'n', color: 'w' }); b.setPiece(2, 3, { type: 'p', color: 'b' }); b.setPiece(3, 2, { type: 'p', color: 'b' }); },
      interaction: { mode: 'P1', from: [4, 4], prompt: '马能跳子。用马吃掉一个黑兵', accept: [[2, 3], [3, 2]],
        hint: ['马跳「日」字，找「两格加一格」外的黑兵。', '左上方 d6 和 c5，都能跳到。', '点 d6 或 c5 的黑兵！'] }
    }]
  },
  {
    title: '象的走法',
    keyPoints: ['象沿斜线走', '格数不限', '不能跳子', '同色格活动'],
    steps: [{
      desc: '象沿斜线走任意格数，不能跳过其他棋子。每个象只能在一种颜色的格子上活动，开局每方有一白格象与一黑格象。',
      highlights: [{ row: 2, col: 2, kind: 'capture' }, { row: 3, col: 3, kind: 'legal' }, { row: 5, col: 5, kind: 'legal' },
        { row: 3, col: 5, kind: 'legal' }, { row: 2, col: 6, kind: 'legal' }, { row: 5, col: 3, kind: 'legal' }, { row: 6, col: 2, kind: 'legal' }],
      setup: (b) => { b.grid = emptyBoard(); b.setPiece(4, 4, { type: 'b', color: 'w' }); b.setPiece(2, 2, { type: 'p', color: 'b' }); b.setPiece(6, 6, { type: 'p', color: 'w' }); },
      interaction: { mode: 'P1', from: [4, 4], prompt: '用象沿斜线吃掉黑兵', accept: [[2, 2]],
        hint: ['象走斜线，看白象的左上方。', '沿左上斜线一直走，能摸到 c6。', '试试 c6 的黑兵。'] }
    }]
  },
  {
    title: '后的走法',
    keyPoints: ['横、竖、斜都能走', '格数不限', '威力最大（约 9 分）', '不宜过早出动'],
    steps: [{
      desc: '后是最强的棋子，结合了车与象的走法：横、竖、斜都可走任意格数，不能跳子。通常开局不宜过早出动后，以免被小子追击。',
      highlights: (() => { const a = []; for (let i = 0; i < 8; i++) { if (i !== 4) { a.push({ row: 4, col: i, kind: 'legal' }); a.push({ row: i, col: 4, kind: 'legal' }); } } for (let i = 1; i < 8; i++) for (const [dr, dc] of [[-1,-1],[-1,1],[1,-1],[1,1]]) { const r = 4 + dr * i, c = 4 + dc * i; if (r >= 0 && r < 8 && c >= 0 && c < 8) a.push({ row: r, col: c, kind: 'legal' }); } return a; })(),
      setup: (b) => { b.grid = emptyBoard(); b.setPiece(4, 4, { type: 'q', color: 'w' }); },
      // P2：必须隐藏高亮，否则送分（考核态 highlights=[]）
      interaction: { mode: 'P2', prompt: '后沿斜线能走到棋盘角落。点出它能到达的角格（有 2 个，点一个即可）', accept: [[0, 0], [7, 7]],
        hint: ['后沿斜线走到棋盘边缘，会撞见角格。', 'a8 和 h1 两个角，都和后同一条斜线。', '点 a8（左上角）或 h1（右下角）！'] }
    }]
  },
  {
    title: '王的走法',
    keyPoints: ['王每次走一格', '不能送将', '王车易位（短/长）', '被将杀即输棋'],
    steps: [{
      desc: '王每次向任意方向走一格，且不能走到被对方攻击的格子（不能送将）。被将军时必须立即解将；无子可动且被将军即为将杀。',
      highlights: [{ row: 4, col: 0, kind: 'key' }, { row: 3, col: 3, kind: 'legal' }, { row: 3, col: 4, kind: 'legal' },
        { row: 3, col: 5, kind: 'legal' }, { row: 5, col: 3, kind: 'legal' }, { row: 5, col: 4, kind: 'legal' }, { row: 5, col: 5, kind: 'legal' }],
      // 题目成立所需的局面：白王 e4 被黑车 a4 沿横线将军；增设黑王 a8（原局面仅一白王，无将军）
      setup: (b) => { b.grid = emptyBoard(); b.setPiece(4, 4, { type: 'k', color: 'w' }); b.setPiece(4, 0, { type: 'r', color: 'b' }); b.setPiece(0, 0, { type: 'k', color: 'b' }); },
      interaction: { mode: 'P1', from: [4, 4], prompt: '白王正被将军！走一步让王脱离攻击', accept: [[3, 3], [3, 4], [3, 5], [5, 3], [5, 4], [5, 5]],
        hint: ['黑车在 a4 将军，王得离开这一横行。', '往上或往下走一格，就脱将了。', '试试 d5、e5、f5 或 d3、e3、f3。'] }
    }]
  },
  {
    title: '特殊规则',
    keyPoints: ['王车易位：一次动两子', '吃过路兵：仅限紧接一步', '升变：到底线换子', '升变通常选后'],
    // 3 套子局面：8a 短易位 / 8b 吃过路兵（注入 enPassantTarget）/ 8c 升变
    steps: [
      {
        desc: '【王车易位】王与车首次移动且中间无子、王不经过被攻击格时，可一步同时移动两子：短易位 O-O 王走两格到 g1，车跳到 f1。',
        highlights: [{ row: 7, col: 6, kind: 'key' }],
        setup: (b) => { b.grid = emptyBoard(); b.setPiece(7, 4, { type: 'k', color: 'w' }); b.setPiece(7, 0, { type: 'r', color: 'w' }); b.setPiece(7, 7, { type: 'r', color: 'w' }); b.setPiece(0, 4, { type: 'k', color: 'b' }); },
        interaction: { mode: 'P1', from: [7, 4], prompt: '短易位 O-O：把王走到 g1', accept: [[7, 6]],
          state: { castling: { wk: true, wq: true, bk: false, bq: false } },
          hint: ['短易位，就是王向王翼的车走两格。', '王从 e1 向右走两格。', '点 g1（王右边两格）。'] }
      },
      {
        desc: '【吃过路兵】对方兵首次一次走两格、正好路过我方兵的斜前方时，我方兵可立即斜吃到它「路过」的格子；过期作废。',
        highlights: [{ row: 2, col: 3, kind: 'capture' }],
        setup: (b) => { b.grid = emptyBoard(); b.setPiece(3, 4, { type: 'p', color: 'w' }); b.setPiece(3, 3, { type: 'p', color: 'b' }); b.setPiece(7, 4, { type: 'k', color: 'w' }); b.setPiece(0, 4, { type: 'k', color: 'b' }); },
        interaction: { mode: 'P1', from: [3, 4], prompt: '黑兵刚从 d7 双步到 d5，用白兵吃过路兵', accept: [[2, 3]],
          state: { enPassantTarget: { row: 2, col: 3 } },
          hint: ['黑兵刚跳到 d5，白兵能斜吃它路过的格子。', '目标不是 d5，是它身后的 d6。', '点 d6（黑兵背后那格）。'] }
      },
      {
        desc: '【兵升变】兵到达对方底线必须升变为后、车、象或马；绝大多数情况下升变为后（威力最大）。',
        highlights: [{ row: 0, col: 4, kind: 'key' }],
        setup: (b) => { b.grid = emptyBoard(); b.setPiece(1, 4, { type: 'p', color: 'w' }); b.setPiece(7, 4, { type: 'k', color: 'w' }); b.setPiece(0, 0, { type: 'k', color: 'b' }); },
        interaction: { mode: 'P1', from: [1, 4], prompt: '白兵冲到底线，并升变为后', accept: [[0, 4]], promotionAnswer: 'q',
          hint: ['白兵再走一格就到底线，该升变了。', '升变多选后（后），威力最大～', '点 e8，弹窗里选「后」。'] }
      }
    ]
  },
  {
    title: '胜负判定',
    keyPoints: ['将军：王被攻击', '将杀：无法解将则输', '逼和：无子可动则和', '50 回合 / 三次重复 / 子力不足则和'],
    steps: [{
      desc: '【将军】攻击对方的王，被将方须立即解将。【将杀】王被将且无法解除，被将杀方输棋。【逼和】无合法走法但王未被将，判和。此外 50 回合无吃子/走兵、三次重复局面、子力不足也判和。',
      highlights: [{ row: 0, col: 7, kind: 'key' }],
      setup: (b) => { b.grid = emptyBoard(); b.setPiece(0, 7, { type: 'k', color: 'b' }); b.setPiece(1, 6, { type: 'k', color: 'w' }); b.setPiece(2, 7, { type: 'r', color: 'w' }); },
      interaction: { mode: 'P3', prompt: '点出被将杀的那一方的王', accept: [[0, 7]],
        hint: ['白车封住 h 线，白王堵住退路，黑王没路了。', '被将杀的是角落里的黑王。', '点右上角的黑王 h8！'] }
    }]
  },
  {
    title: '基础战术',
    keyPoints: ['捉双：一子攻击两个目标', '钉住：不能轻易移动', '串击：一串只能保一个', '闪击：移子露出攻击'],
    steps: [{
      desc: '【捉双】一个棋子同时攻击两个目标，对方往往只能保一个。图中白马同时攻击黑后与黑车。掌握战术可帮你赢得子力优势。',
      highlights: [{ row: 3, col: 3, kind: 'key' }, { row: 1, col: 2, kind: 'capture' }, { row: 1, col: 4, kind: 'capture' }],
      setup: (b) => { b.grid = emptyBoard(); b.setPiece(3, 3, { type: 'n', color: 'w' }); b.setPiece(1, 2, { type: 'q', color: 'b' }); b.setPiece(1, 4, { type: 'r', color: 'b' }); b.setPiece(7, 4, { type: 'k', color: 'w' }); b.setPiece(0, 4, { type: 'k', color: 'b' }); },
      interaction: { mode: 'P3', prompt: '白马正在捉双。点出被同时攻击的两个大子之一', accept: [[1, 2], [1, 4]],
        hint: ['白马在 d5，看它「日」字能跳到谁。', '左上黑后 c7、右上黑车 e7，都跑不掉。', '点黑后 c7 或黑车 e7！'] }
    }]
  }
];

const PHASE = { READING: 'READING', TRY: 'TRY_PROMPT', SELECTED: 'TRY_SELECTED', MISS: 'FEEDBACK_MISS', OK: 'FEEDBACK_OK', REVEAL: 'REVEAL', COMPLETED: 'COMPLETED', PROMO: 'PROMO_PICK' };

class TeachingScene {
  constructor() {
    this.guard = new TouchGuard({ moveThreshold: 8 }); // 与滚动区分：>8pt 视为滚动
    this.currentLesson = 0;
    this.subIndex = 0;
    this.phase = PHASE.READING;
    this.completed = [];
    this.progress = null;
    this.missCount = 0;
    this.hintLevel = 0;   // 0 无 / 1 文字 / 2 缩范围 / 3 揭晓
    this.selected = null;
    this.legalTargets = [];
    this.assisted = false;
    this.guideText = '';
    this.guideT = 0;
    this.feedbackT = 0;
    this.animPhase = 0;   // 累计 dt，驱动脉冲/呼吸
    this.revealStart = 0; // 进入 REVEAL 时刻（animPhase，秒），脉冲相位锚点（终审 #4）
    this.startRingAt = 0; // 进入 TRY/SELECTED 时刻（秒），起点金环脉冲锚点
    this.scrollY = 0;
    this.maxScroll = 0;
    this.contentHeight = 0;
    this.pressed = null;
    this.tap = createTap(); // 统一按压状态 + 90ms 防穿透（Phase 3·12）
    this.regions = [];
    this.boardRect = null;
    this.promoRegions = [];
    this.screenWidth = 375;
    this.screenHeight = 667;
    this.sm = null;
    this.board = null;
    this.teachGame = null;
  }

  enter(params = {}) {
    this.sm = params._sm || null;
    this.screenWidth = params.screenWidth || 375;
    this.screenHeight = params.screenHeight || 667;
    const p = GameContext.getTutorialProgress();
    this.progress = p;
    this.completed = Array.isArray(p.completed) ? p.completed.slice(0, 10) : [];
    while (this.completed.length < 10) this.completed.push(false);
    this.currentLesson = (params.lesson != null) ? params.lesson : (p.lastLesson || 0);
    if (this.currentLesson < 0 || this.currentLesson >= LESSONS.length) this.currentLesson = 0;
    this.subIndex = 0;
    if (!params.resume) this.scrollY = 0;
    this.guard.reset();
    this.tap.clear();
    this.startStep(true);
  }
  exit() { this.regions = []; this.promoRegions = []; this.tap.clear(); }
  clearTouch() { this.guard.reset(); this.pressed = null; this.tap.clear(); }

  currentStep() { return LESSONS[this.currentLesson].steps[this.subIndex] || LESSONS[this.currentLesson].steps[0]; }
  interaction() { return this.currentStep().interaction; }
  completedCount() { return this.completed.filter(Boolean).length; }

  // 重建练习局面 + 交互状态
  startStep(isReading) {
    const step = this.currentStep();
    this.board = new Board();
    step.setup(this.board);
    // 用 ChessGame 计算 from 子的合法目标（内部用于 GUIDE/MISS 分类，绝不用于考核态渲染）
    this.teachGame = new ChessGame();
    this.teachGame.board = this.board;
    this.teachGame.turn = 'w';
    const st = this.interaction().state || {};
    this.teachGame.castling = st.castling || { wk: true, wq: true, bk: true, bq: true };
    this.teachGame.enPassantTarget = st.enPassantTarget || null;
    const it = this.interaction();
    this.legalTargets = it.from ? this.teachGame.getLegalMovesFor(it.from[0], it.from[1]).map(m => [m.toRow, m.toCol]) : [];
    this.phase = isReading ? PHASE.READING : PHASE.TRY;
    this.missCount = 0; this.hintLevel = 0; this.selected = null; this.assisted = false;
    this._wrongStart = 0;
    this.guideText = ''; this.guideT = 0; this.feedbackT = 0;
    this.promoRegions = [];
    if (!isReading) this.scrollY = Math.min(this.scrollY, this.maxScroll);
  }

  update(dt) {
    this.animPhase += dt;
    if (this.guideT > 0) { this.guideT -= dt; if (this.guideT <= 0) this.guideText = ''; }
    this.feedbackT += dt;
    const reduce = !!GameContext.getSettings().reduceMotion;
    if (this.phase === PHASE.OK) {
      if (this.feedbackT > (reduce ? 0.3 : 0.5)) this.phase = PHASE.COMPLETED;
    } else if (this.phase === PHASE.MISS) {
      if (this.feedbackT > (reduce ? 0.4 : 0.45)) {
        this.phase = this.hintLevel >= 3 ? PHASE.REVEAL : PHASE.TRY;
        if (this.phase === PHASE.REVEAL) this.revealStart = this.animPhase;
        this.selected = null;
      }
    }
  }

  // ==================== 渲染 ====================
  render(ctx, W, H) {
    ctx.fillStyle = C.bgBase; ctx.fillRect(0, 0, W, H);
    this.regions = [];
    const reduce = !!GameContext.getSettings().reduceMotion;

    // 安全区：顶栏起点 safeTop+8，底部按钮落在 contentBottom 内（V2_VISUAL_SPEC §4.3/§7.9）
    const L = layout.get();
    const progH = 6;
    // 统一三槽位顶栏：标题溢出会下沉第二行，先度量再排内容
    const navOpts = this._navOpts(ctx);
    const navM = topbar.measureTopBar(ctx, navOpts);
    const topNavBottom = navM.bottom + progH + 18; // 固定的顶部导航区结束
    const bottomNavY = L.contentBottom - 60; // 底栏按钮高 52 → 底边 = contentBottom - 8
    const contentTop = topNavBottom;
    const contentBottom = bottomNavY - 12;
    const viewportH = Math.max(0, contentBottom - contentTop);
    // 用上一帧内容高度钳制滚动
    this.maxScroll = Math.max(0, this.contentHeight - viewportH);
    if (this.scrollY > this.maxScroll) this.scrollY = this.maxScroll;
    if (this.scrollY < 0) this.scrollY = 0;

    const sy = (vY) => contentTop + vY - this.scrollY;
    const addRegion = (key, x, vY, w, h, extra) => {
      const y = sy(vY);
      if (y + h > contentTop && y < contentBottom) this.regions.push(Object.assign({ key, rect: { x, y, w, h } }, extra || {}));
    };

    ctx.save();
    ctx.beginPath(); ctx.rect(0, contentTop, W, viewportH); ctx.clip();
    let vY = 0;

    // Overline
    ctx.fillStyle = C.accent; ctx.font = TF('micro'); ctx.textAlign = 'left'; ctx.textBaseline = 'top';
    const steps = LESSONS[this.currentLesson].steps;
    const subTag = steps.length > 1 ? ` · 第 ${this.subIndex + 1} 招` : '';
    ctx.fillText(`第 ${this.currentLesson + 1} 式 · 共 ${LESSONS.length} 式${subTag}`, 16, sy(vY));
    vY += 20;
    // 标题
    ctx.fillStyle = C.textPrimary; ctx.font = TF('h1');
    ctx.fillText(`${this.currentLesson + 1}. ${LESSONS[this.currentLesson].title}`, 16, sy(vY));
    vY += 36;

    // 迷你棋盘（矮屏按可用视口高度收缩：保证首屏棋盘完整可见，且下方留出正文+渐隐+提示的空间）
    // 平板（isTablet）放宽宽度上限与单元格上限，让棋盘更饱满（横屏受 viewportH 自然收敛，居中不溢出）
    const boardCap = (L && L.isTablet) ? 360 : 304;
    const cellByW = Math.floor(Math.min(W - 64, boardCap) / 8);
    const cellByH = Math.floor((viewportH - vY - 44) / 8);
    const cellMax = (L && L.isTablet) ? 46 : 38;
    const cell = Math.max(24, Math.min(cellMax, cellByW, cellByH));
    const boardSize = cell * 8;
    const boardX = (W - boardSize) / 2;
    const boardVY = vY;
    const boardScreenY = sy(boardVY);
    this.boardRect = { x: boardX, y: boardScreenY, w: boardSize, h: boardSize };
    // 考核相关态：highlights 一律传空（C8 硬约束）
    const showReading = this.phase === PHASE.READING;
    const miniHighlights = showReading ? toMiniHighlights(this.currentStep().highlights) : [];
    // MISS 抖动：对棋盘做水平位移
    let shakeX = 0;
    if (this.phase === PHASE.MISS && !reduce && this.feedbackT < 0.36) {
      shakeX = Math.sin(this.feedbackT * 34) * 6 * (1 - this.feedbackT / 0.36);
    }
    ctx.save(); ctx.translate(shakeX, 0);
    boardRender.drawMiniBoard(ctx, this.board, boardX, boardScreenY, cell, miniHighlights);
    this.drawBoardOverlays(ctx, cell, boardX, boardScreenY, reduce);
    ctx.restore();
    vY += boardSize + 10;

    // 正文（READING 显示讲解；考核态显示当前题干解析）—— 上移到棋盘正下方，首屏即可见讲解
    const desc = this.currentStep().desc || '';
    ctx.font = TF('body');
    const descLines = wrapLocal(ctx, desc, W - 32);
    ctx.fillStyle = C.textPrimary; ctx.textAlign = 'left'; ctx.textBaseline = 'top';
    descLines.forEach((ln, i) => ctx.fillText(ln, 16, sy(vY + i * 24)));
    vY += descLines.length * 24 + 10;

    // 图例（Caption 13，去 emoji，C7）
    ctx.fillStyle = C.textSecondary; ctx.font = TF('caption'); ctx.textAlign = 'left'; ctx.textBaseline = 'top';
    const _ty = sy(vY); let _lx = 16;
    function _leg(style, label, color) {
      icons.drawBullet(ctx, _lx + 7, _ty + 7, 14, style, color);
      ctx.fillStyle = C.textSecondary; ctx.textAlign = 'left'; ctx.font = TF('caption');
      ctx.fillText(label, _lx + 16, _ty);
      _lx += 16 + ctx.measureText(label).width + 18;
    }
    // 图例改真实高亮色，建立「形状 + 颜色」映射（可走金 / 可吃红 / 破阵眼青玉）
    _leg('disc', '可走', C.accentSoft); _leg('ring', '可吃', C.danger); _leg('diamond', '破阵眼', C.hlHintJade);
    vY += 24;

    // 要点列表（完整渲染，不截断；C2）
    ctx.fillStyle = C.accent; ctx.font = TF('caption');
    icons.drawBullet(ctx, 22, sy(vY) + 7, 13, 'diamond', C.accent);
    ctx.fillStyle = C.accent; ctx.textAlign = 'left'; ctx.textBaseline = 'top'; ctx.font = TF('caption');
    ctx.fillText('本式要诀', 32, sy(vY)); vY += 22;
    for (const point of LESSONS[this.currentLesson].keyPoints) {
      ctx.font = TF('caption');
      const lines = wrapLocal(ctx, point, W - 48);
      const rh = 12 + lines.length * 20 + 8;
      ctx.fillStyle = C.surface2; rr(ctx, 16, sy(vY), W - 32, rh, R.sm); ctx.fill();
      ctx.fillStyle = C.accent; ctx.font = TF('captionB'); ctx.textAlign = 'left'; ctx.textBaseline = 'top';
      icons.drawBullet(ctx, 24, sy(vY) + 10, 12, 'diamond', C.accent);
      ctx.fillStyle = C.textPrimary; ctx.font = TF('caption');
      lines.forEach((ln, i) => ctx.fillText(ln, 44, sy(vY + 12 + i * 20)));
      vY += rh + 8;
    }
    vY += 8;

    // 试一试区 h96（C1/C2）
    const tryVY = vY;
    this.renderTryArea(ctx, W, 16, sy(tryVY), W - 32, 96, reduce, addRegion, tryVY);
    vY += 96 + 20;

    ctx.restore();
    this.contentHeight = vY;
    // 量完内容后用真实高度重算可滚动区间，保证首帧就能给出正确的渐隐/上滑提示
    this.maxScroll = Math.max(0, this.contentHeight - viewportH);
    if (this.scrollY > this.maxScroll) this.scrollY = this.maxScroll;
    if (this.scrollY < 0) this.scrollY = 0;

    // 顶部渐隐提示（可滚动）
    if (this.scrollY > 2) this.drawFade(ctx, W, contentTop, true);
    // 底部渐隐 +「上滑阅读要点」提示（READING 告知下方还有讲解；滚到底自动消失）
    const boardBottom = this.boardRect ? this.boardRect.y + this.boardRect.h : contentBottom;
    this.drawScrollHint(ctx, W, contentBottom, boardBottom);

    // 固定顶部导航
    this.renderTopNav(ctx, W, H, navM, progH);
    // 固定底部按钮
    this.renderBottomNav(ctx, W, H, bottomNavY);
    // 升变选择浮层（第 8c 课）
    if (this.phase === PHASE.PROMO) this.renderPromoPicker(ctx, W, H);
    // 通用确认模态（末课未完成练习）
    if (this.sm && this.sm.modal && this.sm.modal.isGeneric()) this.sm.modal.renderGeneric(ctx, W, H);
  }

  drawFade(ctx, W, y, topDown) {
    const g = ctx.createLinearGradient(0, y - (topDown ? 0 : 12), 0, y + (topDown ? 12 : 0));
    g.addColorStop(0, topDown ? C.bgBase : 'rgba(16,21,27,0)');
    g.addColorStop(1, topDown ? 'rgba(16,21,27,0)' : C.bgBase);
    ctx.fillStyle = g; ctx.fillRect(0, topDown ? y : y - 12, W, 12);
  }

  /**
   * 内容区底部渐隐 + 「上滑阅读要点」提示（文案 + 金色上箭头，落在渐隐的实底区，不与正文串字）。
   * 触发条件：下方仍有未显示内容（scrollY < maxScroll）。滚动超过 8pt 后只留渐隐，不再重复提示。
   */
  drawScrollHint(ctx, W, contentBottom, boardBottom) {
    if (this.maxScroll - this.scrollY <= 2) return;
    // 渐隐：上端透明 → 下端实底；高度不超过棋盘下沿到视口底的净空（矮屏不糊棋盘），
    // 最下 ~1/3 为实底，保证提示文字不与半透明正文串字。
    const gap = Math.max(0, contentBottom - (boardBottom || 0));
    const fadeH = Math.max(28, Math.min(44, gap));
    const g = ctx.createLinearGradient(0, contentBottom - fadeH, 0, contentBottom);
    g.addColorStop(0, 'rgba(16,21,27,0)');
    g.addColorStop(0.4, 'rgba(16,21,27,0.86)');
    g.addColorStop(0.62, C.bgBase);
    g.addColorStop(1, C.bgBase);
    ctx.save();
    ctx.fillStyle = g; ctx.fillRect(0, contentBottom - fadeH, W, fadeH);
    ctx.restore();
    if (this.scrollY > 8) return;

    const reduce = !!GameContext.getSettings().reduceMotion;
    const text = '上滑阅读要点';
    ctx.save();
    ctx.font = TF('caption');
    const tw = Math.ceil(ctx.measureText(text).width);
    const totalW = tw + 16;
    const sx = Math.round((W - totalW) / 2), cy = Math.round(contentBottom - 13);
    ctx.globalAlpha = reduce ? 1 : 0.86 + 0.14 * Math.abs(Math.sin(this.animPhase * 2.2));
    if (icons && typeof icons.drawChevron === 'function') icons.drawChevron(ctx, sx + 6, cy, 12, 'up', C.accent);
    ctx.fillStyle = C.textPrimary; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    ctx.fillText(text, sx + 14, cy + 1);
    ctx.restore();
  }

  cellCenter(row, col, cell, bx, by) { return { x: bx + col * cell + cell / 2, y: by + row * cell + cell / 2 }; }

  /** 双色描边环：先铺更粗的深色衬线（bgBase），再叠主色环。
   *  浅格靠深色衬线、深格靠亮色主环，双向保证环形标记在棋盘上 ≥3:1。 */
  _casedRing(ctx, x, y, r, lineW, alpha, color) {
    ctx.save();
    ctx.globalAlpha = alpha == null ? 1 : alpha;
    ctx.strokeStyle = C.bgBase; ctx.lineWidth = lineW + 3;
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.stroke();
    ctx.strokeStyle = color || C.accentSoft; ctx.lineWidth = lineW;
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.stroke();
    ctx.restore();
  }

  drawBoardOverlays(ctx, cell, bx, by, reduce) {
    const it = this.interaction();
    const isAssess = [PHASE.TRY, PHASE.SELECTED, PHASE.MISS, PHASE.OK, PHASE.REVEAL, PHASE.PROMO].indexOf(this.phase) >= 0;
    // 起点脉冲金环（题干给定，非答案）：P1 在考核态允许；锚定进入 TRY/SELECTED 时刻，600ms 后收敛静态 .5
    if (isAssess && it.from && this.hintLevel < 3) {
      const p = this.cellCenter(it.from[0], it.from[1], cell, bx, by);
      const elapsed = this.animPhase - (this.startRingAt || 0);
      const pulse = reduce ? 0.5
        : (elapsed < 0.6 ? (0.35 + 0.4 * Math.abs(Math.sin(Math.PI * elapsed / 0.3))) : 0.5);
      this._casedRing(ctx, p.x, p.y, cell * 0.42, Math.max(2, cell * 0.08), pulse, C.accentSoft);
    }
    // 选中框（仅选中态；绝不绘制合法走法点/环 —— C8 硬约束）
    if (this.selected && (this.phase === PHASE.SELECTED || this.phase === PHASE.MISS)) {
      const p = this.cellCenter(this.selected.row, this.selected.col, cell, bx, by);
      const rx0 = p.x - cell / 2 + 3, ry0 = p.y - cell / 2 + 3, rw0 = cell - 6;
      ctx.strokeStyle = C.bgBase; ctx.lineWidth = 5; rr(ctx, rx0, ry0, rw0, rw0, R.chip); ctx.stroke();
      ctx.strokeStyle = C.accentSoft; ctx.lineWidth = 2; rr(ctx, rx0, ry0, rw0, rw0, R.chip); ctx.stroke();
    }
    // H2 缩范围：目标所在行/列淡金（提示，不给精确答案）；REVEAL 只画目标格金环，范围高亮隐去
    if (this.hintLevel >= 2 && this.phase !== PHASE.COMPLETED && this.phase !== PHASE.OK && this.phase !== PHASE.REVEAL) {
      const rows = {}, cols = {};
      for (const a of it.accept) { rows[a[0]] = 1; cols[a[1]] = 1; }
      ctx.save(); ctx.fillStyle = 'rgba(201,162,75,0.10)';
      for (const r in rows) ctx.fillRect(bx, by + (+r) * cell, cell * 8, cell);
      for (const c in cols) ctx.fillRect(bx + (+c) * cell, by, cell, cell * 8);
      ctx.restore();
    }
    // REVEAL：仅目标格脉冲金环（金=揭晓，非将军红）；其余高亮一律隐去（补遗 A.2「其余仍隐藏」）
    if (this.phase === PHASE.REVEAL) {
      // 相位锚定进入 REVEAL 时刻：300ms×2（共 600ms）后收敛静态 .5（补遗 A.3 / 终审 #4）
      const elapsed = this.animPhase - (this.revealStart || 0);
      const pulse = reduce ? 0.5
        : (anim && typeof anim.revealPulseAlpha === 'function')
          ? anim.revealPulseAlpha(this.animPhase * 1000, (this.revealStart || 0) * 1000)
          : (elapsed < 0.6 ? (0.35 + 0.4 * Math.abs(Math.sin(Math.PI * elapsed / 0.3))) : 0.5);
      for (const a of it.accept) {
        const p = this.cellCenter(a[0], a[1], cell, bx, by);
        this._casedRing(ctx, p.x, p.y, cell * 0.42, Math.max(2, cell * 0.1), pulse, C.accentSoft);
      }
    }
    // MISS：错格红环（停留至下次操作或淡出）
    if (this.phase === PHASE.MISS && this.wrongCell) {
      const p = this.cellCenter(this.wrongCell.row, this.wrongCell.col, cell, bx, by);
      this._casedRing(ctx, p.x, p.y, cell * 0.42, 2, reduce ? 1 : Math.max(0, 1 - this.feedbackT / 0.8), C.danger);
    }
    // CORRECT：目标格金闪 + ✓
    if (this.phase === PHASE.OK || this.phase === PHASE.COMPLETED) {
      const target = this.correctCell || it.accept[0];
      if (target) {
        const p = this.cellCenter(target[0], target[1], cell, bx, by);
        const k = this.phase === PHASE.OK ? Math.max(0, 1 - this.feedbackT / 0.26) : 0;
        if (k > 0) { ctx.save(); ctx.fillStyle = C.accent; ctx.globalAlpha = 0.55 * k; ctx.beginPath(); ctx.arc(p.x, p.y, cell * 0.46, 0, Math.PI * 2); ctx.fill(); ctx.restore(); }
        // ✓ 先铺深色圆盘衬底再叠亮金对勾，保证浅格上 ≥3:1
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.save(); ctx.globalAlpha = 0.85; ctx.fillStyle = C.bgBase;
        ctx.beginPath(); ctx.arc(p.x, p.y, 15, 0, Math.PI * 2); ctx.fill(); ctx.restore();
        icons.drawCheck(ctx, p.x, p.y, 24, C.accentSoft);
      }
    }
  }

  renderTryArea(ctx, W, x, y, w, h, reduce, addRegion, tryVY) {
    const it = this.interaction();
    const reveal = this.phase === PHASE.REVEAL;
    // 框：讲解/考核虚线金框；揭晓实线金框（形态二次编码）
    ctx.save();
    if (reveal) { ctx.strokeStyle = C.accentDeep; ctx.lineWidth = 1; ctx.setLineDash([]); ctx.globalAlpha = 0.8; }
    else { ctx.strokeStyle = C.accentLine; ctx.lineWidth = 1.5; ctx.setLineDash([6, 4]); }
    rr(ctx, x, y, w, h, R.btn); ctx.stroke();
    ctx.restore();

    const stemX = x + 12, stemW = w - 24 - 44 - 12; // 263
    let stemText = it.prompt;
    let tag = '';
    if (this.phase === PHASE.READING) { stemText = '读完要点，点「开始练习」作答。任务：' + it.prompt; tag = ''; }
    else if (this.phase === PHASE.TRY || this.phase === PHASE.SELECTED) tag = '试炼中 · ';
    else if (this.phase === PHASE.MISS) stemText = '差一点！换个招式再试试～' + (this.hintLevel >= 1 && it.hint[0] ? ' ' + it.hint[0] : '');
    else if (this.phase === PHASE.OK) stemText = '漂亮，破阵成功！';
    else if (this.phase === PHASE.COMPLETED) stemText = this.completedCount() >= 10 ? '十式皆通 · 随时回来精进' : '此式已参透';
    else if (reveal) stemText = '看这步妙招，点它试试～';
    // H1 文字提示替换题干
    if (this.hintLevel === 1 && (this.phase === PHASE.TRY || this.phase === PHASE.SELECTED) && it.hint[0]) stemText = it.hint[0];
    if (this.guideText) stemText = this.guideText;

    ctx.font = TF('body');
    const lines = wrapLocal(ctx, tag + stemText, stemW);
    const shown = lines.slice(0, 3);
    ctx.textAlign = 'left'; ctx.textBaseline = 'top';
    const textH = shown.length * 24;
    const textTop = y + (h - textH) / 2;
    shown.forEach((ln, i) => {
      if (i === 0 && tag) {
        // 「试炼中」用 warning 色内联
        ctx.fillStyle = C.warning; const tw = ctx.measureText(tag).width;
        ctx.fillText(tag, stemX, textTop);
        ctx.fillStyle = C.textPrimary; ctx.fillText(ln.slice(tag.length), stemX + tw, textTop);
      } else {
        ctx.fillStyle = (this.phase === PHASE.OK || this.phase === PHASE.COMPLETED) ? C.success : C.textPrimary;
        ctx.fillText(ln, stemX, textTop + i * 24);
      }
    });

    // 右侧 44×44 按钮
    const btnX = x + w - 12 - 44, btnY = y + (h - 44) / 2;
    let btnKey = null, btnIcon = null, btnDisabled = false;
    if (this.phase === PHASE.READING) { btnKey = 'startTry'; btnIcon = 'play'; addRegion('startTry', x, tryVY, w, h); }
    else if (this.phase === PHASE.COMPLETED) {
      btnKey = 'retry'; btnIcon = 'refresh';
    } else if (this.phase === PHASE.REVEAL) {
      btnKey = 'retry'; btnIcon = 'refresh';
    } else if (this.phase === PHASE.OK) {
      btnDisabled = true; btnIcon = 'check';
    } else {
      btnKey = this.hintLevel >= 3 ? null : 'hint'; btnIcon = 'hint';
      btnDisabled = this.hintLevel >= 3;
    }
    if (btnKey || btnIcon) {
      ctx.fillStyle = (this.tap.isPressing(btnKey, Date.now()) && btnKey) ? C.accentFade : C.surface2;
      rr(ctx, btnX, btnY, 44, 44, R.sm); ctx.fill();
      ctx.strokeStyle = C.border; ctx.lineWidth = 1; rr(ctx, btnX + 0.5, btnY + 0.5, 43, 43, R.sm); ctx.stroke();
      const cc = btnDisabled ? C.disabledFg : C.textSecondary;
      if (btnIcon) ico(ctx, btnIcon, btnX + 22, btnY + 22, 24, cc);
      if (btnKey && !btnDisabled) addRegion(btnKey, btnX, btnY - y + tryVY, 44, 44);
    }
    // COMPLETED：额外「再试一式」文字入口
    if (this.phase === PHASE.COMPLETED) {
      ctx.fillStyle = C.accent; ctx.font = TF('caption'); ctx.textAlign = 'left'; ctx.textBaseline = 'top';
      ctx.fillText('再试一式', stemX, y + 64);
      addRegion('retry', stemX, tryVY + 60, 120, 28);
    }
  }

  /** 顶栏参数（render 与 renderTopNav 共用，保证两次度量完全一致） */
  _navOpts(ctx) {
    const text = `${this.currentLesson + 1}/${LESSONS.length} 式`;
    let rw = 52;
    try {
      ctx.save(); ctx.font = TF('caption');
      rw = Math.ceil(ctx.measureText(text).width) + 2;
      ctx.restore();
    } catch (e) { /* noop */ }
    return {
      title: '新手试炼',
      fontKey: 'h2',
      back: { key: 'back', label: '返回', pressed: this.tap.isPressing('back', Date.now()) },
      rightWidth: rw,
      drawRight: (c, rect) => {
        c.font = TF('caption'); c.fillStyle = C.textSecondary;
        c.textAlign = 'right'; c.textBaseline = 'middle';
        c.fillText(text, rect.x + rect.w, rect.y + rect.h / 2);
      }
    };
  }

  renderTopNav(ctx, W, H, navM, progH) {
    // 遮住内容滚动穿透到导航区
    ctx.fillStyle = C.bgBase; ctx.fillRect(0, 0, W, navM.bottom + progH + 14);
    const nav = topbar.drawTopBar(ctx, this._navOpts(ctx));
    nav.regions.forEach(r => this.regions.push(r));
    // 10 段分段进度条
    const barX = 16, barY = navM.bottom + 8, barW = W - 32, gap = 4;
    const segW = (barW - 9 * gap) / 10;
    for (let i = 0; i < 10; i++) {
      const sx = barX + i * (segW + gap);
      const done = this.completed[i];
      const cur = i === this.currentLesson;
      ctx.fillStyle = done ? C.accent : C.surface3;
      rr(ctx, sx, barY, segW, progH, 3); ctx.fill();
      if (!done && cur) { ctx.strokeStyle = C.borderStrong; ctx.lineWidth = 1; rr(ctx, sx + 0.5, barY + 0.5, segW - 1, progH - 1, 3); ctx.stroke(); }
    }
  }

  renderBottomNav(ctx, W, H, y) {
    ctx.fillStyle = C.bgElev; ctx.fillRect(0, y - 8, W, H - y + 8);
    const bw = (W - 60) / 2, bh = 52;
    const hasPrev = this.currentLesson > 0 || this.subIndex > 0;
    drawBtn(ctx, 15, y, bw, bh, '上一式', 'secondary', { pressed: this.tap.isPressing('prev', Date.now()), disabled: !hasPrev });
    this.regions.push({ key: 'prev', rect: { x: 15, y, w: bw, h: bh }, fixed: true, enabled: hasPrev });
    const steps = LESSONS[this.currentLesson].steps;
    const hasMoreSub = this.subIndex < steps.length - 1;
    const hasMoreLesson = this.currentLesson < LESSONS.length - 1;
    const nextText = hasMoreSub ? '下一招' : hasMoreLesson ? '下一式' : '出师';

    // 先读再练门控：READING →「开始练习」；作答中禁用；OK/COMPLETED/REVEAL 才解锁「下一式」
    const practicingDone = this.phase === PHASE.OK || this.phase === PHASE.COMPLETED || this.phase === PHASE.REVEAL;
    let ctaText, ctaKey = null, ctaDisabled = false, ctaVariant = 'primary';
    if (this.phase === PHASE.READING) { ctaText = '开始练习'; ctaKey = 'startTry'; }
    else if (practicingDone) { ctaText = nextText; ctaKey = 'next'; }
    else { ctaText = '先完成练习'; ctaDisabled = true; ctaVariant = 'secondary'; }

    const cx = 30 + bw;
    drawBtn(ctx, cx, y, bw, bh, ctaText, ctaVariant, { pressed: ctaKey && this.tap.isPressing(ctaKey, Date.now()), disabled: ctaDisabled });
    if (ctaKey) this.regions.push({ key: ctaKey, rect: { x: cx, y, w: bw, h: bh }, fixed: true, enabled: true });
  }

  // ==================== 输入 ====================
  onTouchStart(x, y) {
    this.guard.down(x, y);
    if (this.phase === PHASE.PROMO) {
      this.pressed = null;
      for (const r of this.promoRegions) { if (inRect(x, y, r.rect)) { this.pressed = r.key; break; } }
    } else {
      this.pressed = this._hit(x, y);
    }
    if (this.pressed) this.tap.press(this.pressed, Date.now());
  }
  onTouchMove(x, y) {
    const m = this.guard.move(x, y);
    if (m.moved) {
      this.scrollY = Math.max(0, Math.min(this.maxScroll, this.scrollY - m.stepY));
      if (this.pressed) this.tap.clear(this.pressed);
      this.pressed = null;
    }
  }
  onTouchEnd(x, y) {
    const e = this.guard.end(x, y);
    if (this.pressed) this.tap.clear(this.pressed);
    this.pressed = null;
    if (!e.valid) return; // 滚动不触发点击
    // 升变选择态优先处理（第 8c 课）：命中选项判定对错，点空白取消回考核
    if (this.phase === PHASE.PROMO) { this.handlePromoTap(x, y); return; }
    if (this.sm && this.sm.modal && this.sm.modal.isOpen() && this.sm.modal.isGeneric()) {
      if (!this.sm.modal.interactive()) return;
      const act = this.sm.modal.hitGeneric(x, y);
      if (act) this.sm.modal.resolveGeneric(act);
      return;
    }
    const hit = this._hit(x, y);
    if (hit) {
      if (!this.tap.guard(Date.now(), 'nav:' + hit)) return;
      GameContext.emit('tap');
      this.onAction(hit); return;
    }
    // 棋盘交互
    if (this.boardRect && inRect(x, y, this.boardRect)) this.onBoardTap(x, y);
  }

  _hit(x, y) {
    for (const r of this.regions) {
      if (r.enabled === false) continue;
      if (inRect(x, y, r.rect)) return r.key;
    }
    return null;
  }

  onAction(key) {
    if (key === 'back') { this.saveProgress(); GameContext.emit('navigate', { to: 'menu' }); GameContext.popScene(); }
    else if (key === 'prev') this.prevNav();
    else if (key === 'next') this.nextNav();
    else if (key === 'startTry') {
      // READING → TRY：唯一进入答题的入口（底部主 CTA / 「试一试」卡片共用）
      if (this.phase !== PHASE.READING) return;
      this.phase = PHASE.TRY; this.missCount = 0; this.hintLevel = 0; this.selected = null; this.assisted = false;
      this._wrongStart = 0; this.guideText = ''; this.guideT = 0;
      this.startRingAt = this.animPhase;
      if (this.scrollY > 40) this.scrollY = 0; // 开始练习后把棋盘拉回首屏
      GameContext.showBanner('开始练习 · 在棋盘上作答', 'info');
    }
    else if (key === 'hint') this.advanceHint();
    else if (key === 'retry') { this.startStep(false); }
  }

  prevNav() {
    if (this.subIndex > 0) { this.subIndex--; this.startStep(true); }
    else if (this.currentLesson > 0) { this.currentLesson--; this.subIndex = LESSONS[this.currentLesson].steps.length - 1; this.startStep(true); }
    this.scrollY = 0; this.saveProgress();
  }
  nextNav() {
    const steps = LESSONS[this.currentLesson].steps;
    if (this.subIndex < steps.length - 1) { this.subIndex++; this.startStep(true); this.scrollY = 0; this.saveProgress(); return; }
    if (this.currentLesson < LESSONS.length - 1) { this.currentLesson++; this.subIndex = 0; this.startStep(true); this.scrollY = 0; this.saveProgress(); return; }
    this.finishTeaching();
  }

  finishTeaching() {
    this.saveProgress();
    const left = 10 - this.completedCount();
    if (left > 0) {
      GameContext.openModal('confirm', {
        title: '暂别试炼？', message: `还有 ${left} 式没练完，确定先歇会儿？`,
        buttons: [{ label: '继续闯', action: 'cancel', variant: 'secondary' }, { label: '先歇会儿', action: 'confirm', variant: 'primary' }],
        onAction: (act) => { GameContext.closeModal(); if (act === 'confirm') { GameContext.emit('navigate', { to: 'menu' }); GameContext.popScene(); } }
      });
    } else {
      GameContext.emit('navigate', { to: 'menu' }); GameContext.popScene();
    }
  }

  advanceHint() {
    this.hintLevel = Math.min(3, this.hintLevel + 1);
    if (this.hintLevel >= 3) { this.phase = PHASE.REVEAL; this.revealStart = this.animPhase; this.selected = null; }
    else GameContext.emit('toggle');
  }

  boardPos(x, y) {
    const cell = this.boardRect.w / 8;
    const tol = 10;
    const bx = x - this.boardRect.x, by = y - this.boardRect.y;
    if (bx < -tol || by < -tol || bx > this.boardRect.w + tol || by > this.boardRect.h + tol) return null;
    const col = Math.floor(Math.max(0, Math.min(this.boardRect.w - 0.001, bx)) / cell);
    const row = Math.floor(Math.max(0, Math.min(this.boardRect.h - 0.001, by)) / cell);
    return { row, col };
  }
  inAccept(row, col) { return this.interaction().accept.some(a => a[0] === row && a[1] === col); }
  inLegal(row, col) { return this.legalTargets.some(a => a[0] === row && a[1] === col); }

  onBoardTap(x, y) {
    const it = this.interaction();
    // 先读再练：READING 态禁止落子（不计错、不泄题），只做引导
    if (this.phase === PHASE.READING) {
      this.guide('先点「开始练习」，再落子～');
      if (this.guard.allow('readingNudge', 1200)) GameContext.showBanner('先点下方「开始练习」，再落子', 'info');
      return;
    }
    // 升变选择态
    if (this.phase === PHASE.PROMO) return;
    if (this.phase === PHASE.COMPLETED || this.phase === PHASE.OK) return;

    const pos = this.boardPos(x, y);
    if (!pos) { this.guide('点棋盘里的格子试试～'); return; }
    const { row, col } = pos;

    if (it.mode === 'P1') {
      const from = it.from;
      if (!this.selected) {
        if (row === from[0] && col === from[1]) {
          this.selected = { row, col }; this.phase = PHASE.SELECTED; GameContext.emit('select');
        } else {
          // 点错起点 → GUIDE（不计错、静音）
          this.guide('先点一下要动的棋子～');
          // 连续 2 次自动升到 H2
          this._wrongStart = (this._wrongStart || 0) + 1;
          if (this._wrongStart >= 2 && this.hintLevel < 2) this.hintLevel = 2;
        }
        return;
      }
      // 已选起点
      if (row === this.selected.row && col === this.selected.col) { this.selected = null; this.phase = PHASE.TRY; return; }
      // 点己方其他棋子：允许改选（仅当就是题目起点，否则 GUIDE）
      const piece = this.board.getPiece(row, col);
      if (piece && piece.color === 'w' && !(row === from[0] && col === from[1])) { this.guide('这招得从那颗指定棋子起手～'); return; }
      if (this.inAccept(row, col)) {
        if (it.promotionAnswer) { this.phase = PHASE.PROMO; this.pendingTarget = { row, col }; GameContext.emit('select'); return; }
        this.correct(row, col); return;
      }
      if (this.inLegal(row, col)) { this.miss(row, col); return; }
      // 不合法终点 → GUIDE（不计错，保留选中）
      this.guide('这步走不通，换个落点～');
      return;
    } else {
      // P2 / P3：单次点格
      if (this.inAccept(row, col)) { this.correct(row, col); return; }
      this.miss(row, col);
    }
  }

  guide(text) { this.guideText = text; this.guideT = 1.6; /* 静音，不计错 */ }

  miss(row, col) {
    this.missCount++;
    this.wrongCell = { row, col };
    this.selected = null;
    this.phase = PHASE.MISS; this.feedbackT = 0;
    GameContext.emit('tutorialWrong');
    // MISS 1/2/3 自动升级提示
    this.hintLevel = Math.min(3, Math.max(this.hintLevel, this.missCount));
  }

  correct(row, col) {
    this.correctCell = [row, col];
    this.phase = PHASE.OK; this.feedbackT = 0;
    this.assisted = this.hintLevel >= 3;
    GameContext.emit('move');
    GameContext.emit('tutorialCorrect');
    // 点亮分段进度（答对即写，不硬锁跳读）
    this.completed[this.currentLesson] = true;
    this.saveProgress();
    GameContext.showBanner('漂亮！破阵成功！', 'success');
  }

  // 升变选择（第 8c 课）
  renderPromoPicker(ctx, W, H) {
    // 在棋盘中央浮出 4 个选项
    const cell = this.boardRect ? this.boardRect.w / 8 : 38;
    const opts = ['q', 'r', 'b', 'n'], size = Math.max(44, Math.min(56, cell));
    const gap = 12, totalW = opts.length * size + (opts.length - 1) * gap;
    const sx = (W - totalW) / 2, sy = (this.boardRect ? this.boardRect.y + this.boardRect.h / 2 : H / 2) - size / 2;
    ctx.fillStyle = C.overlay; ctx.fillRect(0, 0, W, H);
    this.promoRegions = [];
    for (let i = 0; i < opts.length; i++) {
      const px = sx + i * (size + gap);
      ctx.fillStyle = C.surface2; rr(ctx, px, sy, size, size, R.sm); ctx.fill();
      if (this.tap.isPressing('promo:' + opts[i], Date.now())) { ctx.strokeStyle = C.accent; ctx.lineWidth = 2; rr(ctx, px + 1, sy + 1, size - 2, size - 2, R.sm); ctx.stroke(); }
      ctx.fillStyle = C.textPrimary; ctx.font = `${Math.round(size * 0.7)}px serif`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      piecesRender.drawPiece(ctx, opts[i], 'w', px + size / 2, sy + size / 2, size * 0.82);
      this.promoRegions.push({ key: 'promo:' + opts[i], rect: { x: px, y: sy, w: size, h: size } });
    }
  }

  handlePromoTap(x, y) {
    for (const r of this.promoRegions) {
      if (inRect(x, y, r.rect)) {
        const pt = r.key.slice(6);
        const it = this.interaction();
        if (pt === it.promotionAnswer) this.correct(this.pendingTarget.row, this.pendingTarget.col);
        else { this.guide('升变多选后（后），威力最大～'); this.phase = PHASE.MISS; this.wrongCell = this.pendingTarget; this.feedbackT = 0; this.missCount++; GameContext.emit('tutorialWrong'); this.hintLevel = Math.min(3, Math.max(this.hintLevel, this.missCount)); }
        return;
      }
    }
    // 点空白取消升变选择回到考核
    this.phase = PHASE.TRY; this.selected = null;
  }

  saveProgress() {
    const p = {
      version: 1,
      completed: this.completed.slice(),
      lastLesson: this.currentLesson,
      updatedAt: Date.now()
    };
    this.progress = p;
    GameContext.saveTutorialProgress(p);
  }
}

module.exports = TeachingScene;
module.exports.LESSONS = LESSONS;
