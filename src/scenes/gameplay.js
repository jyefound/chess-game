/**
 * S3 对局场景（人机 / 双人）
 * 状态机（UX §2.1）：IDLE → SELECTED → ANIMATING → PROMOTION / GAMEOVER / AI_THINKING
 * 输入（UX §2.5）：动作在 onTouchEnd 同目标确认（位移≤12pt、时长≤500ms、输入锁、250ms 去重）；
 *   onTouchStart 仅置按下态 + 落子前目标预览。
 * C4：AI 用 createSearch/step 分帧搜索，update() 每帧 step 一次，UI ≥20fps，时间预算到即用当前最佳。
 * C1：移除 boardX 的 +14，真居中；cellSize = floor(min(W*0.92, H*0.55)/8)（附竖向安全退让）。
 * C8：合法走法渲染受设置 showLegalMoves 显式门控（对局非考核态，教学在 teaching.js 单独防泄题）。
 * C10：工具栏「保存进度」/ 结算自动存档 Banner「结算已自动存档」，同 gameId 去重。
 * C12：升变 M1 可 ✕ / 点遮罩取消回 SELECTED；结算 M2 禁遮罩关闭。
 * Phase 2·6 HUD 减负：上下两张 56pt 玩家卡 + 顶栏冗余 → 一条 44pt 细 HUD（头像/执子/吃子/用时，
 *   难度只在顶栏出现一次）；常驻主操作收敛为 悔棋 / 锦囊提示 / 更多，设置与保存进度移入「更多」浮层
 *   （复用原 openModal('settingsDrawer') 与 manualSave()，不改玩法/计时/吃子统计逻辑）。
 *
 * V2 §2 指导模式（coach:true）+ 锦囊提示（跨模式通用，残局场景可复用 requestHint）：
 *   - 指导模式：棋盘下方教练气泡条（不遮挡棋盘与工具栏），AI 每步讲解 + 玩家每步点评（好棋/失误/错失）。
 *   - 锦囊提示：工具栏「锦囊提示」→ createSearch 分帧搜索 → 起点金环 + 终点金点 + [采纳一步]/[忽略]。
 *   - 消耗：常规人机 3 次/局（用完置灰）；指导模式无限免费。
 */
const GameContext = require('../context');
const M = require('./manager');
const { theme, TouchGuard, util, createTap } = M;
const C = theme.colors, R = theme.radius, MO = theme.motion;
const TF = (k) => theme.font(k);
const rr = util.rr, inRect = util.inRect, drawBtn = util.drawButtonLocal;
const ChessGame = require('../core/game');
const { COLOR, PIECE_NAMES } = require('../core/constants');
const { createSearch, budgetForDepth, evaluate } = require('../core/ai');
const movegen = require('../core/movegen');
const layoutMod = require('../core/layout');
const boardRender = require('../render/board');
const piecesRender = require('../render/pieces');
const SettingsModule = require('./settings');

// 远程双人对弈房间模块：由并行 worker 实现，Node 回归时可能尚未落盘 / 无 wx.cloud，
// 故防御式引入；所有调用点一律以 `room && typeof room.xxx === 'function'` 守卫，绝不因此抛异常。
let room = null;
try { room = require('../core/room'); } catch (e) { room = null; }

// 房间配置 / 结算结果枚举：统一读 config（场景层禁止裸写结果字符串）。
// config.ROOM_CONFIG / config.ROOM_RESULT 由 config worker 落盘；缺失时用等价兜底常量，
// 保证「协议层未就绪」时场景依旧可判定、可降级，绝不抛异常。
let CONFIG = {};
try { CONFIG = require('../config'); } catch (e) { CONFIG = {}; }
const ROOM_CFG = CONFIG.ROOM_CONFIG || {};
const ROOM_RESULT = Object.assign({
  materialWhite: 'material_white_win', materialBlack: 'material_black_win',
  draw: 'draw', abandoned: 'abandoned', archived: 'archived',
  resignWhite: 'resign_white', resignBlack: 'resign_black'
}, CONFIG.ROOM_RESULT || {});

// ==================== V2 §2 指导模式 / 提示功能常量 ====================
// 提示分帧搜索：预算（easy/medium/hard）与教练固定值（§2.2）
const HINT_BUDGET = { easy: 1200, medium: 1800, hard: 2500 };
const HINT_BUDGET_COACH = 1800;
const HINT_SLICE_MS = 18;
// 常规人机每局提示次数（§2.3：锦囊提示 3→0，用完置灰）
const HINT_MAX_STANDARD = 3;
// 点评分类阈值（§2.5）：delta_player ≥ +80 好棋 / ≤ -120 失误 / 其余寻常
const COACH_GOOD = 80;
const COACH_BAD = -120;
// 「明显更优着」判定阈值（浅搜增益，单位同 evaluate）
const COACH_MISS = 150;
// 教练气泡单条展示时长（秒）
const COACH_MSG_DWELL = 3.2;
// 教练气泡条高度（棋盘下方一条，不遮挡棋盘与工具栏）
const COACH_BAND_H = 44;
// 底部信息带「内容底 → 工具栏分隔线」的最小间距：band 变矮后内容不再顶到分隔线
const BAND_BOTTOM_GAP = 8;
// 提示面板尺寸（建议 + 采纳/忽略）
const HINT_PANEL_MAX_W = 340;
const HINT_PANEL_H = 88;
const HINT_PANEL_H_SEARCH = 56;
// 结算小结推荐妙招（V2_UX_SPEC §1.6 妙招文案库精选）
const COACH_TIPS = {
  tip_01: '车沉底线，王被自己的兵困住，就是绝杀。',
  tip_06: '连续将军，别给对手一点喘息。',
  tip_11: '王也要参战——残局里它可是主力。',
  tip_12: '算不准时，先找将军、吃子、威胁这三类着法。'
};

const icons = (() => { try { return require('../render/icons'); } catch (e) { return null; } })();
function ico(ctx, name, x, y, size, color) {
  if (icons && typeof icons.drawIcon === 'function') {
    try { icons.drawIcon(ctx, name, x, y, size, color); return true; } catch (e) { /* noop */ }
  }
  return false;
}
const anim = (() => {
  try { return require('../core/anim'); } catch (e) { return null; }
})();
function updateTweens(dt) { if (anim && typeof anim.updateTweens === 'function') { try { anim.updateTweens(dt); } catch (e) { /* noop */ } } }
function easeInOut(t) { if (anim && typeof anim.easeInOut === 'function') { try { return anim.easeInOut(t); } catch (e) {} } return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2; }
function easeOut(t) { if (anim && typeof anim.easeOut === 'function') { try { return anim.easeOut(t); } catch (e) {} } return 1 - Math.pow(1 - t, 3); }

function genGameId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}
function reasonText(reason) {
  return ({
    checkmate: '将杀', stalemate: '逼和（无子可动）', fifty_moves: '50 回合规则',
    insufficient_material: '子力不足', threefold: '三次重复局面', resign: '认输'
  })[reason] || '';
}

/** 文本超出宽度时截断并加省略号（气泡条单行显示用）。 */
function fitText(ctx, text, maxWidth) {
  const s = String(text == null ? '' : text);
  if (!ctx || typeof ctx.measureText !== 'function') return s;
  if (ctx.measureText(s).width <= maxWidth) return s;
  let out = s;
  while (out.length > 1 && ctx.measureText(out + '…').width > maxWidth) out = out.slice(0, -1);
  return out + '…';
}

/**
 * 生成某走法的 SAN（不落子，只读）。
 * 复用 ChessGame.generateSAN（同一套消歧与将军/将杀标记逻辑）；
 * 调用前提：board / game 处于「该走法尚未落子」的局面。
 */
function sanOfMove(game, board, move) {
  try {
    const piece = board.getPiece(move.fromRow, move.fromCol);
    let captured = null;
    if (move.isEnPassant) {
      const r = move.toRow + (piece && piece.color === COLOR.WHITE ? 1 : -1);
      captured = board.getPiece(r, move.toCol);
    } else {
      captured = board.getPiece(move.toRow, move.toCol);
    }
    return game.generateSAN(move, piece, captured);
  } catch (e) {
    return '';
  }
}

class GameplayScene {
  constructor() {
    this.guard = new TouchGuard();
    this.tap = createTap(); // 统一按压状态 + 90ms 防穿透（Phase 3·12）
    this.game = null;
    this.mode = 'ai';
    this.aiColor = COLOR.BLACK;
    this.playerColor = COLOR.WHITE;
    this.aiDepth = 3;
    this.state = 'IDLE';
    this.selected = null;
    this.legalMoves = [];
    this.lastMove = null;
    this.flipBoard = false;
    this.aiCtx = null;
    this.thinkPhase = 0;   // 累计 dt（秒），驱动呼吸条 / 思考点
    this.timeMs = 0;       // 累计毫秒，传给 drawBoard options.time（脉冲相位，C4）
    this.thinkLead = 0;
    this.anim = null;      // {move, pieceType, pieceColor, t, dur, wasCapture}
    this.landRing = null;  // {row,col,t,dur}
    this.promotionMoves = [];
    this.captured = { w: [], b: [] };
    this.gameId = null;
    this.startedAt = 0;
    this.savedGameId = null;
    this.autoSavedThisResult = false;
    this.pendingRecord = null;
    this.pendingIsAuto = false;
    this.pendingOldest = null;
    this.pressed = null;
    this.pressedCell = null;
    this.shakeUntil = 0;     // 非法落点反馈：棋盘左右轻颤的截止时间戳（ms）
    // ===== 远程双人对弈（mode:'remote'）状态 =====
    this.roomId = ''; this.roomSeat = ''; this.roomRole = '';
    this.remoteRev = 0; this.remoteStatus = 'playing';
    this.applyingRemote = false; this.roomConfig = {};
    // ===== 远程退出仲裁 / 结束判定 / 棋谱（v5.1）状态 =====
    this.roomDoc = null;              // 最新房间快照（供 update 墙钟判定 / 昵称读取）
    this.remoteOpponentNick = '';     // 对端昵称（host 读 guestNick / guest 读 hostNick）
    this.remoteLeft = null;           // {role:'host'|'guest', color:'w'|'b', at, waitingSince} 对端退出信息
    this.remoteBothLeft = false;      // 双方均退出
    this.arbitrationOpen = false;     // 仲裁弹窗是否已开（防重复弹）
    this.arbitrationPrompted = false; // 1 分钟超时是否已提示过（同一轮只提示一次）
    this.arbitrationWaiting = false;  // 用户已选「继续等待」
    this.remoteAbandonDeadline = 0;   // 双方均退出时的 keepUntil
    this._heartbeatTimer = null;      // 在线心跳 setInterval 句柄
    this._arbitrationRegion = null;   // HUD「对手已离开 · 处理」命中区
    this._abandonArchived = false;    // 双方均退出超时封存只做一次
    this._bothLeftMarked = false;     // 双方均退出时本端已调过 room.markBothLeft()（避免每帧重复写）
    this._prevOppLeft = false;        // 对端上一帧的退出态（边沿检测，用于重置 arbitrationPrompted）
    this._archivedShown = false;      // archived 快照只呈现一次结算态
    this._abandonedShown = false;     // abandoned 快照只提示一次
    this.toolbarRegions = [];
    this.backRegion = null;
    this.modalRegions = [];
    this.settingsScrollY = 0;
    this.settingsMaxScroll = 0;
    this.settingsPanel = null;
    this.screenWidth = 375;
    this.screenHeight = 667;
    this.sm = null;

    // ===== V2 §2 指导模式（coach）/ 锦囊提示（hint）=====
    this.coach = false;                 // 指导模式（setup 传 coach:true）
    this.coachQueue = [];               // 气泡消息队列 [{text, sound}]
    this.coachBubble = null;            // 当前气泡 {text, sound}
    this.coachAge = 0;                  // 当前气泡已展示时长（秒）
    this.coachHistory = [];             // 玩家每步点评记录 {ply, kind, delta}
    this.coachStats = { good: 0, bad: 0, miss: 0 };
    this.coachSummary = '';             // 结算小结文案
    this.hintState = 'idle';            // idle | searching | shown | adopted | ignored
    this.hintLeft = HINT_MAX_STANDARD;  // 常规人机剩余提示次数（指导模式无限）
    this.hintSearch = null;             // createSearch 上下文（分帧搜索）
    this.hintMove = null;               // 当前建议走法
    this.hintSan = '';                  // 建议走法 SAN
    this.hintRegions = [];              // 建议面板按钮区域
  }

  enter(params = {}) {
    this.sm = params._sm || null;
    this.screenWidth = params.screenWidth || 375;
    this.screenHeight = params.screenHeight || 667;
    this.game = new ChessGame();
    this.mode = params.mode || 'ai';
    this.coach = !!(params.coach || params.style === 'coach');
    this.aiDepth = params.aiDepth || (this.coach ? theme.aiDepth.easy : theme.aiDepth.medium);
    this.aiColor = params.aiColor || COLOR.BLACK;
    // 执子色：远程由房间分配（params.playerColor）；人机保持原反推逻辑；本地双人默认白方先行。
    // 保留 params.playerColor 最高优先，确保 ai / local 既有行为零回归。
    this.playerColor = (this.mode === 'ai')
      ? (params.playerColor || (this.aiColor === COLOR.WHITE ? COLOR.BLACK : COLOR.WHITE))
      : (params.playerColor || COLOR.WHITE);
    // 默认朝向：人机 / 远程各自「执黑则翻转」（远程各自固定看自己执棋色在屏幕底部）；
    // 本地双人全程固定，默认读持久化的 defaultOrientation（'white' → 白在屏幕下方 = false）。
    // params.flip 保留最高优先级，供断点 / 未来扩展使用。
    let defaultFlip = false;
    if (this.mode === 'ai' || this.mode === 'remote') {
      defaultFlip = (this.playerColor === COLOR.BLACK);
    } else {
      let orient = 'white';
      try {
        const s = GameContext.getSettings();
        if (s && s.defaultOrientation === 'black') orient = 'black';
      } catch (e) { orient = 'white'; }
      defaultFlip = (orient === 'black');
    }
    this.flipBoard = params.flip != null ? !!params.flip : defaultFlip;
    this.state = 'IDLE';
    this.selected = null; this.legalMoves = []; this.lastMove = null;
    this.aiCtx = null; this.thinkPhase = 0; this.thinkLead = 0;
    this.anim = null; this.landRing = null; this.promotionMoves = [];
    this.captured = { w: [], b: [] };
    this.gameId = genGameId();
    this.startedAt = Date.now();
    this.savedGameId = null; this.autoSavedThisResult = false;
    this.pendingRecord = null; this.pendingOldest = null;
    this.pressed = null; this.pressedCell = null;
    this.toolbarRegions = []; this.modalRegions = [];
    this.settingsScrollY = 0; this.settingsMaxScroll = 0;
    this.timeMs = 0;
    // 退出仲裁 / 心跳 / 远程快照缓存：每次进入都重置，避免沿用上一局的退出态或泄漏定时器。
    if (this._heartbeatTimer) {
      try { clearInterval(this._heartbeatTimer); } catch (e) { /* noop */ }
    }
    this._heartbeatTimer = null;
    this.roomDoc = null;
    this.remoteOpponentNick = '';
    this.remoteLeft = null;
    this.remoteBothLeft = false;
    this.arbitrationOpen = false;
    this.arbitrationPrompted = false;
    this.arbitrationWaiting = false;
    this.remoteAbandonDeadline = 0;
    this._arbitrationRegion = null;
    this._abandonArchived = false;
    this._bothLeftMarked = false;
    this._prevOppLeft = false;
    this._archivedShown = false;
    this._abandonedShown = false;
    // 指导模式：点评统计归零 + 开局气泡（教练陪练中）
    this.coachQueue = [];
    this.coachBubble = null;
    this.coachAge = 0;
    this.coachHistory = [];
    this.coachStats = { good: 0, bad: 0, miss: 0 };
    this.coachSummary = '';
    this.hintState = 'idle';
    this.hintLeft = this.coach ? Infinity : HINT_MAX_STANDARD;
    this.hintSearch = null;
    this.hintMove = null;
    this.hintSan = '';
    this.hintRegions = [];
    this.guard.reset();
    this.layout();

    // 本地双人棋盘方向全程固定：不随落子 / 回合 / 悔棋翻转；
    // 仅用户在「更多」抽屉手动调转时改变（并持久化到 defaultOrientation）。
    // 远程双人对弈同样固定视角（各自设备单视角），由 flipBoard 初始化一次后不再变动。

    // ===== 远程双人对弈（mode:'remote'）初始化 =====
    this.roomId = ''; this.roomSeat = ''; this.roomRole = '';
    this.remoteRev = 0; this.remoteStatus = 'playing';
    this.applyingRemote = false;
    if (this.mode === 'remote') {
      this.roomId = params.roomId || '';
      this.roomSeat = params.seat || '';
      this.roomRole = params.role || '';
      this.remoteStatus = 'playing';
      // v5 重新加入（params.rejoin）：不重置房间态，初始着法沿用下方 params.movesUci /
      // room.getState().movesUci 的现有重放逻辑（:319-322 已覆盖，勿重复造）；
      // 仅确保退出仲裁相关状态为干净态，让重新加入后按最新快照重新判定。
      if (params.rejoin) {
        this.remoteLeft = null;
        this.remoteBothLeft = false;
        this.arbitrationOpen = false;
        this.arbitrationPrompted = false;
        this.arbitrationWaiting = false;
        this.remoteAbandonDeadline = 0;
      }
      // aiColor 保持默认，但现有 AI 触发点全部带 mode==='ai' 门控，远程不会触发任何 AI 分支。
      // 防御式读取房间配置（由并行 worker 落盘，可能尚未就绪 → 空对象兜底）。
      let RC = {};
      try { const config = require('../config'); RC = config.ROOM_CONFIG || {}; } catch (e) { RC = {}; }
      this.roomConfig = RC;
      // 同步读一次房间本地权威态，作为 remoteRev 的展示 / 调试初值。
      // 导航契约不传 rev，joinRoom 后房间 rev=1、createRoom 后 rev=0；room 模块的
      // _deliver 按 rev 去重会丢弃 guest 的初始快照，不能依赖异步快照补齐。
      // 注意：pushMove 的 CAS 期望值在 pushRemoteMove() 里另取 room.getState().rev（唯一权威源），
      // this.remoteRev 仅作展示，不作 CAS 入参。
      let rs = null;
      if (room && typeof room.getState === 'function') {
        try { rs = room.getState(); } catch (e) { rs = null; }
      }
      let initialRev = 0;
      if (rs && typeof rs.rev === 'number' && rs.rev >= 0) initialRev = rs.rev;
      this.remoteRev = initialRev;
      // 首帧快照可能迟到：先从房间本地权威态取一次对端昵称（host 读 guestNick / guest 读 hostNick）。
      if (rs) {
        const nick = this.roomRole === 'host' ? rs.guestNick : rs.hostNick;
        this.remoteOpponentNick = (typeof nick === 'string' && nick) ? nick : '';
      }
      // 初始着法：导航 params 优先，房间本地态兜底（断线重进）；复用 UCI 重放重建局面。
      let initialMoves = Array.isArray(params.movesUci) ? params.movesUci : [];
      if (!initialMoves.length && rs && Array.isArray(rs.movesUci) && rs.movesUci.length) initialMoves = rs.movesUci;
      if (initialMoves.length) this.restoreFromMoves(initialMoves);
      // 订阅房间快照；返回 false 不弹错，交由 room 模块内建轮询兜底。
      if (room && typeof room.watchRoom === 'function') {
        try {
          room.watchRoom(this.roomId, {
            onSnapshot: (doc) => this.onRemoteSnapshot(doc),
            onError: (reason) => this.onRemoteError(reason)
          });
        } catch (e) { /* 订阅失败由轮询兜底，不崩溃 */ }
      }
      let available = false;
      try { available = !!(room && typeof room.isAvailable === 'function' && room.isAvailable()); }
      catch (e) { available = false; }
      if (!available) {
        try { GameContext.showBanner('联机能力不可用，已转为本地查看', 'danger'); } catch (e) { /* noop */ }
      }
      // v5 在线心跳：进入 remote 对局后周期性上报 present/onlineAt。定时器句柄存 _heartbeatTimer，
      // 由 enter() 开头与 exit() 统一 clearInterval 清理，绝不泄漏；协议层未提供 heartbeat 时不启动。
      if (room && typeof room.heartbeat === 'function') {
        const hbMs = (typeof ROOM_CFG.presenceIntervalMs === 'number' && ROOM_CFG.presenceIntervalMs > 0)
          ? ROOM_CFG.presenceIntervalMs : 10000;
        this._heartbeatTimer = setInterval(() => {
          if (room && typeof room.heartbeat === 'function') {
            try {
              const p = room.heartbeat();
              if (p && typeof p.catch === 'function') p.catch(() => { /* noop */ });
            } catch (e) { /* noop */ }
          }
        }, hbMs);
      }
    }

    // P2 断点恢复：重放 UCI 列表并重建 lastMove / captured（远程走上方房间重放，不用个人断点）。
    if (this.mode !== 'remote' && Array.isArray(params.resumeMoves) && params.resumeMoves.length) {
      this.restoreFromMoves(params.resumeMoves);
    } else if (this.mode === 'ai' && this.game.turn === this.aiColor) {
      // 玩家选黑：AI 执白先手，进入后自动触发（现有代码缺失）
      this.startAIThinking();
    }
    if (this.coach && !(Array.isArray(params.resumeMoves) && params.resumeMoves.length)) {
      // 开局：一句开场白（教练身份 = AI 一方）
      const mine = this.aiColor === COLOR.WHITE ? '白' : '黑';
      this.sayCoach(`这局我执${mine}，慢慢来，先看清中心。`, 'coachSay');
    }
  }
  exit() {
    this.toolbarRegions = []; this.modalRegions = []; this.aiCtx = null;
    // v5：清理在线心跳定时器（enter 会再启一个，若不清理会泄漏并重复上报）。
    if (this._heartbeatTimer) {
      try { clearInterval(this._heartbeatTimer); } catch (e) { /* noop */ }
      this._heartbeatTimer = null;
    }
    if (this.mode !== 'remote') return;
    // 远程对弈：停止订阅；房间状态由 room 场景管理，finished 房间不应在此被删除（不调 leaveRoom）。
    if (room && typeof room.stopWatch === 'function') {
      try { room.stopWatch(); } catch (e) { /* noop */ }
    }
    // v5：标记本方退出（present=false + leftAt=now），保留席位供「重新加入」。
    // 退出对局 ≠ 离开房间：markLeft 不清 room 模块的本地权威态（协议层负责），
    // 玩家回菜单后 readLocalRoom()/rejoinEntry() 仍能读回 {roomId,seat,role}。
    // fire-and-forget：不 await、不阻塞退出流程；协议层未落盘时由守卫降级。
    if (room && typeof room.markLeft === 'function') {
      try {
        const p = room.markLeft();
        if (p && typeof p.catch === 'function') p.catch(() => { /* noop */ });
      } catch (e) { /* noop */ }
    }
  }

  /** 从 UCI 列表重建局面（断点恢复）；跨步直接重放，不做动画。 */
  restoreFromMoves(uciList) {
    let applied = 0;
    for (const uci of uciList) {
      const move = this.game.findMoveByUci(uci);
      if (!move) break;
      const moverColor = this.game.turn;
      const capturedBefore = move.isEnPassant
        ? this.game.board.getPiece(moverColor === COLOR.WHITE ? move.toRow + 1 : move.toRow - 1, move.toCol)
        : this.game.board.getPiece(move.toRow, move.toCol);
      if (!this.game.makeMove(move)) break;
      if (capturedBefore) this.captured[moverColor].push(capturedBefore.type);
      this.lastMove = { fromRow: move.fromRow, fromCol: move.fromCol, toRow: move.toRow, toCol: move.toCol };
      applied++;
    }
    // P1-I3：若恢复步数与快照不符（如规则版本更新使旧快照失效），丢弃断点，避免脏状态被反复重放。
    if (applied !== uciList.length) { if (this.mode !== 'remote') GameContext.clearResume(); this.state = 'IDLE'; return; }
    const st = this.game.getStatus();
    if (st.result) { this.onGameOver(); return; }
    if (this.mode === 'ai' && st.turn === this.aiColor) this.startAIThinking();
    else this.state = 'IDLE';
  }

  /** 保存断点快照（供 onShow M7 询问）；仅进行中且不设自动存档依赖时写。 */
  saveResumeSnapshot() {
    // 远程对弈不写个人断点（两端状态以房间文档为准，避免污染个人进度同步）。
    if (this.mode === 'remote') return;
    const st = this.game.getStatus();
    if (st.result || st.movesUci.length < 1) return;
    GameContext.saveResume({
      mode: this.mode, aiDepth: this.aiDepth, aiColor: this.aiColor, playerColor: this.playerColor,
      movesUci: st.movesUci, startedAt: this.startedAt, gameId: this.gameId
    });
  }
  clearTouch() { this.guard.reset(); this.pressed = null; this.pressedCell = null; this.tap.clear(); }

  layout() {
    const W = this.screenWidth, H = this.screenHeight;
    // 顶部整体下移，避让微信右上胶囊：navSafeTop = max(contentTop, capsule.bottom+8)
    // （由 layout 模块提供；未初始化时回退到 contentTop，保证不覆盖系统按钮）。
    const LM = layoutMod.get();
    // 极端矮屏（H<620，如手机横屏 812×375）已有 compactV 矮屏收敛档，不再按平板布局处理，
    // 否则「棋盘+信息带」整体居中会把信息带推过工具栏分隔线。
    const isTablet = !!(LM && (LM.isTablet || LM.isLandscape)) && !(LM && LM.isCompactH);
    // 矮屏（layout.js:170 isCompactH，H<620 命中 320×568）：间距与信息带预留双档收敛，
    // 保证增大留白后竖向安全退让不把棋盘从 33 压到 32。全部为最终值，不做增量叠加。
    const compactV = !!(LM && LM.isCompactH);
    const hudGap = compactV ? 8 : 10;      // 顶栏↔HUD 最终留白
    const boardGap = compactV ? 12 : 16;   // HUD↔棋盘 最终间距（木框 frame=10 抵消）
    const bandGap = compactV ? 14 : 18;    // 棋盘↔信息带 最终间距
    const top = (LM && typeof LM.navSafeTop === 'number') ? LM.navSafeTop
      : (LM && typeof LM.contentTop === 'number' ? LM.contentTop : 8),
      navH = 40, hudH = 44;
    // Phase 2·6：上下两张 56pt 玩家卡合并为「一条细 HUD」（头像/执子/吃子/用时），
    // 顶栏只留返回 + 模式标题（难度仅此处出现一次），让出的纵向空间全部给棋盘。
    this.topNav = { y: top, h: navH };
    const hudY = top + navH + hudGap;
    const boardTop = hudY + hudH + boardGap;
    // P2：工具栏锚定安全区底 contentBottom（预留 home indicator），不再固定 H-84 侵入底部安全区
    const contentBottomY = (LM && typeof LM.contentBottom === 'number') ? LM.contentBottom : H - 20;
    const toolbarH = 64;
    const toolbarY = contentBottomY - toolbarH;
    // C1：优先用 config.getBoardMetrics(W,H)（已实现 min(W*.92,H*.55) + 真居中，无 +14）；
    // 再对超矮屏做竖向安全退让，保证 HUD + SAN/教练/提示带 + toolbar 不被挤掉。
    const sanMinH = compactV ? 28 : 32;
    const maxBoardByHeight = toolbarY - 10 - sanMinH - boardTop;
    let metrics = null;
    try { const config = require('../config'); if (config && typeof config.getBoardMetrics === 'function') metrics = config.getBoardMetrics(W, H); } catch (e) { /* noop */ }
    let cell = metrics ? metrics.cellSize
      : Math.floor(Math.min(W * (theme.board.maxWidthRatio || 0.92), H * (theme.board.maxHeightRatio || 0.55)) / 8);
    // 竖向安全退让：若棋盘高于可用高度则进一步缩小 cell（不引入水平偏移）
    const maxCellByHeight = Math.floor(Math.max(maxBoardByHeight, 0) / 8);
    if (maxCellByHeight > 0) cell = Math.min(cell, maxCellByHeight);
    cell = Math.max(20, cell);  // P2：矮屏允许更小棋盘，避免 HUD/工具栏重叠与信息带被挤没
    const boardSize = cell * 8;
    this.cellSize = cell;
    this.boardSize = boardSize;
    // boardX 始终按最终 cell 计算真居中（metrics 的 boardX 仅在未做竖向缩小时才等价）
    this.boardX = Math.floor((W - boardSize) / 2); // 真居中（已移除 +14）
    // 横条与棋盘木框左右对齐：board.js 的木质外框 frame=10，从 boardX-10 画到 boardX+boardSize+10
    const frame = 10;
    const railW0 = boardSize + 2 * frame;
    // 宽屏：横条再收一道上限，避免被拉到近 1000pt；基线（非 tablet）保持与木框等宽
    const railCap = isTablet ? Math.round(Math.min(W * 0.68, 720)) : Infinity;
    const finalRailW = Math.min(railW0, railCap);
    const railX = Math.floor((W - finalRailW) / 2); // 非 tablet 时等价于 boardX - frame
    this.hudBar = { x: railX, y: hudY, w: finalRailW, h: hudH };
    // 宽屏：把「棋盘 + 信息带」作为整体在 [boardTop, toolbarY] 可用区内垂直居中，
    // 信息带收敛到内容实际高度，消除棋盘下方大片留白；375/320 下 boardY 恒等于 boardTop。
    const infoH = 64;
    let boardY = boardTop;
    if (isTablet) {
      const blockH = boardSize + bandGap + infoH;
      const freeH = Math.max(0, toolbarY - boardTop - blockH);
      boardY = boardTop + Math.floor(freeH / 2);
    }
    this.boardY = boardY;
    const boardBottom = boardY + boardSize;
    // 底部信息带：棋盘下方、工具栏上方（SAN / 教练气泡 / 提示面板共用，互斥显示）
    const bandY = boardBottom + bandGap;
    // 防御：任何视口下信息带都不得越过工具栏顶部分隔线（freeH=0 的矮屏自动退化为 0）。
    const availBandH = Math.max(0, toolbarY - bandY);
    const bandH = isTablet ? Math.min(infoH, availBandH) : availBandH;
    this.sanArea = { x: railX, y: bandY, w: finalRailW, h: bandH };
    // 教练气泡条：指导模式占用同一条带（不遮挡棋盘与工具栏）；标准模式显示 SAN 记谱
    this.coachBand = this.coach ? { x: railX, y: bandY, w: finalRailW, h: bandH } : null;
    this.toolbarY = toolbarY;
    // 宽屏：工具栏按钮列收敛到与横条同宽并居中（背景/分隔线仍全宽）；基线 barX=0 / barW=W
    const barW = isTablet ? Math.min(W, finalRailW) : W;
    this._toolbarBarW = barW;
    this._toolbarBarX = isTablet ? Math.floor((W - barW) / 2) : 0;
  }

  difficultyName() { return ({ 2: '简单', 3: '中等', 4: '困难' })[this.aiDepth] || '中等'; }
  difficultyKey() { return ({ 2: 'easy', 3: 'medium', 4: 'hard' })[this.aiDepth] || 'medium'; }

  // ==================== V2 §2.5 教练气泡（指导模式） ====================
  /**
   * 投递一条教练消息。
   * @param {string} text 文案（已填好实际值）
   * @param {string} sound 'coachSay' | 'coachPraise' | 'coachWarn'
   * @param {number} priority 数值越大越优先；高优先级会插播并把当前气泡放回队尾
   */
  sayCoach(text, sound, priority) {
    if (!this.coach) return;
    // 教练气泡是「最新语境提示」的即时播报：新事件一律替换为当前气泡并重置停留计时，
    // 保证玩家读到的是与当前局面最相关的那一句（旧提示已过时，不再回放，避免堆积）。
    this.coachBubble = { text: String(text || ''), sound: sound || 'coachSay', priority: priority || 0, t: 0 };
    this.coachAge = 0;
    this.playCoachSound(this.coachBubble.sound);
  }
  nextCoachBubble() {
    const m = this.coachQueue.shift();
    this.coachBubble = m || null;
    if (m) this.playCoachSound(m.sound);
  }
  playCoachSound(sound) {
    if (sound === 'coachPraise') GameContext.emit('coachPraise');
    else if (sound === 'coachWarn') GameContext.emit('coachWarn');
    else GameContext.emit('coachSay');
  }
  /** 教练气泡文案颜色（语义色 + 形状双编码的辅助） */
  coachToneColor(sound) {
    if (sound === 'coachPraise') return C.success;
    if (sound === 'coachWarn') return C.warning;
    return C.accentSoft;
  }

  /**
   * 局面评估差值（玩家视角）：白方取原值、黑方取反。
   * @param {number} before 走子前的 evaluate(board)
   * @param {number} after 走子后的 evaluate(board)
   */
  coachDelta(before, after) {
    const raw = after - before;
    return this.playerColor === COLOR.WHITE ? raw : -raw;
  }

  /**
   * 浅搜（1 层穷举 + evaluate）找出当前局面下 color 方的最佳着法。
   * 用于「错失良机」判定与悔棋后给替代建议（§2.4 / §2.5）。
   * @param {string} color 'w' | 'b'
   * @param {number} sign 视角符号：白 +1 / 黑 -1
   * @returns {{move:object, san:string, gain:number, score:number}|null}
   *          gain = 该着法带来的评估增益（玩家视角）；score = 走完之后局面的评估（玩家视角）
   */
  bestAlternative(color, sign) {
    if (!this.game) return null;
    const state = { castling: this.game.castling, enPassantTarget: this.game.enPassantTarget };
    let legal = [];
    try { legal = movegen.generateLegalMoves(this.game.board, color, state); } catch (e) { return null; }
    if (!legal.length) return null;
    const base = evaluate(this.game.board) * sign;
    let bestMove = null, bestScore = -Infinity;
    for (const m of legal) {
      const b = this.game.board.clone();
      try { movegen.applyMoveToBoard(b, m); } catch (e) { continue; }
      const sc = evaluate(b) * sign;
      if (sc > bestScore) { bestScore = sc; bestMove = m; }
    }
    if (!bestMove) return null;
    return {
      move: bestMove,
      san: sanOfMove(this.game, this.game.board, bestMove),
      gain: bestScore - base,
      score: bestScore
    };
  }

  /**
   * 玩家落子后的点评分类（§2.5 阈值：+80 好棋 / -120 失误 / 其余寻常 / 明显更优着 → 错失）。
   * @param {number} before 走子前评估（白视角）
   * @param {number} after 走子后评估（白视角）
   * @param {string} san 本步 SAN
   * @param {{gain:number}|null} alt 最佳替代着法的增益（玩家视角）
   */
  classifyCoach(before, after, san, alt) {
    const delta = this.coachDelta(before, after);
    if (delta >= COACH_GOOD) {
      return { kind: 'good', delta: delta, text: `漂亮！${san} 这步很扎实。`, sound: 'coachPraise' };
    }
    if (delta <= COACH_BAD) {
      return { kind: 'bad', delta: delta, text: `${san} 之后有点危险，要不要悔棋重走？`, sound: 'coachWarn' };
    }
    // 错失良机：存在明显更优的着法（增益差 > 阈值）
    if (alt && (alt.gain - delta) > COACH_MISS) {
      return { kind: 'miss', delta: delta, text: '其实还有更狠的一手——要不要看看建议？', sound: 'coachSay' };
    }
    return { kind: 'normal', delta: delta, text: `${san} 可以，继续观察。`, sound: 'coachSay' };
  }

  /** 统计好棋 / 失误 / 错失计数（依据点评历史重算，悔棋后自动同步） */
  updateCoachStats() {
    const st = { good: 0, bad: 0, miss: 0 };
    for (const r of this.coachHistory) {
      if (r.kind === 'good') st.good++;
      else if (r.kind === 'bad') st.bad++;
      else if (r.kind === 'miss') st.miss++;
    }
    this.coachStats = st;
    return st;
  }

  /** 结算小结文案（§2.5 模板：好棋 / 失误 / 关键回合 / 建议复习的妙招） */
  coachSummaryText() {
    const st = this.updateCoachStats();
    let turn = 1;
    let worst = null;
    for (const r of this.coachHistory) {
      if (!worst || r.delta < worst.delta) worst = r;
    }
    if (worst) turn = Math.max(1, Math.ceil(worst.ply / 2));
    const tipKeys = Object.keys(COACH_TIPS);
    const tip = COACH_TIPS[tipKeys[(st.good + st.bad + st.miss) % tipKeys.length]] || '';
    return `本局好棋 ${st.good} 步、失误 ${st.bad} 步。关键在第 ${turn} 回合，建议去残局闯关练练「${tip}」。`;
  }

  /** 悔棋后重新点评该决策点（§2.4）：给一条替代建议 */
  coachRevisitAfterUndo() {
    if (!this.coach) return;
    const color = this.game.turn;
    const sign = color === COLOR.WHITE ? 1 : -1;
    const alt = this.bestAlternative(color, sign);
    if (alt && alt.san) {
      this.sayCoach(`这里其实有更好的选择——试试 ${alt.san}？`, 'coachSay', 1);
    } else {
      this.sayCoach('回到上一步，重新想想这一步。', 'coachSay', 1);
    }
  }

  // ==================== V2 §2.2 / §2.3 锦囊提示 ====================
  /**
   * 发起一次提示搜索（可复用方法：残局场景亦可调用）。
   * @param {object} opts {board, turn, state, maxDepth, timeBudgetMs, sliceMs}
   * @param {function} onResult (result) => void，result = {done, bestMove, score}
   * @returns {object|null} 搜索上下文（供外部驱动 step），失败返回 null
   */
  requestHint(opts, onResult) {
    const o = opts || {};
    const game = this.game;
    if (!game) return null;
    // 搜索在棋盘快照上进行：玩家可在搜索期间继续操作，不会污染结果
    let board = o.board || game.board;
    if (!o.board) { try { board = game.board.clone(); } catch (e) { board = game.board; } }
    const turn = o.turn || game.turn;
    const state = o.state || { castling: game.castling, enPassantTarget: game.enPassantTarget };
    const maxDepth = o.maxDepth != null ? o.maxDepth : Math.min((this.aiDepth || 3) + 1, 4);
    const budget = o.timeBudgetMs != null ? o.timeBudgetMs
      : (this.coach ? HINT_BUDGET_COACH : (HINT_BUDGET[this.difficultyKey()] || HINT_BUDGET.medium));
    const slice = o.sliceMs != null ? o.sliceMs : HINT_SLICE_MS;
    let ctx = null;
    try {
      ctx = createSearch(board, turn, state, maxDepth, budget, slice);
    } catch (e) {
      ctx = null;
    }
    this.hintSearch = ctx ? { ctx, onResult: typeof onResult === 'function' ? onResult : null } : null;
    if (ctx) this.hintState = 'searching';
    return this.hintSearch ? this.hintSearch.ctx : null;
  }

  /** 工具栏「锦囊提示」入口：检查机会 → 消耗 → 分帧搜索 */
  startHint() {
    if (this.hintState === 'searching') return;
    if (this.state === 'GAMEOVER' || this.state === 'ANIMATING' || this.state === 'AI_THINKING') return;
    if (this.mode === 'ai' && this.game.turn !== this.playerColor) return;   // 只在玩家回合给建议
    if (!this.coach && this.hintLeft <= 0) {
      GameContext.showBanner('锦囊提示已用完', 'warning');
      return;
    }
    if (!this.coach) this.hintLeft -= 1;      // 常规人机每局 3 次
    this.hintState = 'searching';
    this.hintMove = null;
    this.hintSan = '';
    this.requestHint({}, (res) => this.onHintResult(res));
  }

  /** 搜索结束回调：出建议 / 降级 */
  onHintResult(res) {
    this.hintSearch = null;
    if (!res || !res.done || !res.bestMove) {
      this.hintState = 'idle';
      if (!this.coach && this.hintLeft < HINT_MAX_STANDARD) this.hintLeft += 1;  // 失败退还
      this.sayCoach('这一步有点难，先按你的想法走', 'coachSay', 1);
      GameContext.showBanner('这一步有点难，先按你的想法走', 'info');
      return;
    }
    const mv = res.bestMove;
    this.hintMove = mv;
    this.hintSan = sanOfMove(this.game, this.game.board, mv);
    this.hintState = 'shown';
    GameContext.emit('hint');
  }

  /** [采纳一步]：以玩家身份走这步 */
  adoptHint() {
    if (this.hintState !== 'shown' || !this.hintMove) return;
    const mv = this.hintMove;
    // 局面可能已变化（悔棋 / 对手已走），重新在当前合法着法里匹配
    let legal = [];
    try { legal = this.game.getLegalMoves(); } catch (e) { legal = []; }
    const match = legal.find(m =>
      m.fromRow === mv.fromRow && m.fromCol === mv.fromCol &&
      m.toRow === mv.toRow && m.toCol === mv.toCol &&
      (m.promotion || null) === (mv.promotion || null));
    this.hintState = 'adopted';
    this.cancelHint();
    if (match) this.commitMove(match, false);
    else { this.hintState = 'idle'; this.sayCoach('这步已经不合适了，重新看看。', 'coachSay', 1); }
  }

  /** [忽略]：清高亮 */
  ignoreHint() {
    this.hintState = 'ignored';
    this.cancelHint();
  }

  /** 取消进行中的搜索并清空建议（不改变 hintState） */
  cancelHint() {
    this.hintSearch = null;
    this.hintMove = null;
    this.hintSan = '';
    this.hintRegions = [];
  }

  // ==================== 更新 / 状态推进 ====================
  update(dt) {
    // game.js 传入的 dt 单位为秒；动画/棋盘脉冲统一用毫秒（对齐 config.MOTION）。
    const dtMs = dt * 1000;
    this.timeMs += dtMs;
    updateTweens(dtMs);
    this.thinkPhase += dt;
    if (this.landRing) { this.landRing.t += dt; if (this.landRing.t >= this.landRing.dur) this.landRing = null; }

    if (this.state === 'ANIMATING') {
      if (this.anim) {
        this.anim.t += dt;
        if (this.anim.t >= this.anim.dur) this.onAnimEnd();
      } else this.onAnimEnd();
    } else if (this.state === 'AI_THINKING') {
      if (this.thinkLead > 0) this.thinkLead -= dt;
      else {
        if (!this.aiCtx) {
          const state = { castling: this.game.castling, enPassantTarget: this.game.enPassantTarget };
          this.aiCtx = createSearch(this.game.board, this.aiColor, state, this.aiDepth, budgetForDepth(this.aiDepth));
        }
        const r = this.aiCtx.step();
        if (r && r.done) {
          this.aiCtx = null;
          if (r.bestMove) this.commitMove(r.bestMove, true);
          else this.state = 'IDLE';
        }
      }
    }

    // V2 §2.2 提示搜索：每帧 step 一次（分帧，不阻塞对局）
    if (this.hintSearch) {
      const r = this.hintSearch.ctx.step();
      if (r && r.done) {
        const cb = this.hintSearch.onResult;
        this.hintSearch = null;
        if (cb) cb(r);
      }
    }

    // 教练气泡：停留 COACH_MSG_DWELL 后切下一条
    if (this.coachBubble) {
      this.coachAge += dt;
      if (this.coachAge >= COACH_MSG_DWELL) {
        this.coachBubble = null;
        this.coachAge = 0;
        if (this.coachQueue.length) this.nextCoachBubble();
      }
    }

    // v5 远程退出仲裁：用墙钟判定（update 的帧累加切后台即停，不能用于云端退出计时）。
    this._updateArbitration();
  }

  // ==================== 渲染 ====================
  render(ctx, W, H) {
    if (this.screenWidth !== W || this.screenHeight !== H) {
      this.screenWidth = W; this.screenHeight = H; this.layout();
    }
    ctx.fillStyle = C.bgBase; ctx.fillRect(0, 0, W, H);
    this.toolbarRegions = [];
    this.modalRegions = [];
    const settings = GameContext.getSettings();
    const reduce = !!settings.reduceMotion;

    this.renderTopNav(ctx, W);
    this.renderHud(ctx, reduce);
    this.renderBoard(ctx, settings, reduce);
    this.renderInfoStrip(ctx, W);
    this.renderToolbar(ctx, W, H);

    // 场景专属模态（通用 confirm/storageError 由 renderGeneric 绘制）
    const mc = this.sm && this.sm.modal ? this.sm.modal.current : null;
    if (mc === 'promotion') this.renderPromotion(ctx, W, H);
    else if (mc === 'gameover') this.renderGameOver(ctx, W, H);
    else if (mc === 'more') this.renderMoreDrawer(ctx, W, H);
    else if (mc === 'settingsDrawer') this.renderSettingsDrawer(ctx, W, H);
    if (this.sm && this.sm.modal && this.sm.modal.isGeneric()) this.sm.modal.renderGeneric(ctx, W, H);
  }

  /**
   * 顶栏：返回 + 模式标题。
   * 难度只在标题出现一次（Phase 2·6 减负：原「人机对战 · 中等」+ AI 卡「AI · 中等」重复表达）。
   */
  renderTopNav(ctx, W) {
    const n = this.topNav;
    const bw = 84, bh = 36, by = n.y + (n.h - bh) / 2;
    drawBtn(ctx, 12, by, bw, bh, '返回', 'ghost', { pressed: this.tap.isPressing('back', Date.now()) });
    // 命中区保持 ≥44 高（视觉 36，透明外扩）
    this.backRegion = { x: 12, y: n.y + (n.h - 44) / 2, w: bw, h: 44 };
    ctx.fillStyle = C.textSecondary; ctx.font = TF('caption');
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    const label = this.mode === 'ai' ? `人机对战 · ${this.difficultyName()}`
      : this.mode === 'remote' ? `远程对弈 · 执${this.playerColor === COLOR.WHITE ? '白' : '黑'}`
      : '双人对弈';
    ctx.fillText(label, W / 2, n.y + n.h / 2);
  }

  /** 用时 mm:ss（纯呈现：由 startedAt 推导，不新增计时状态、不影响玩法） */
  elapsedText() {
    if (!this.startedAt) return '00:00';
    const sec = Math.max(0, Math.floor((Date.now() - this.startedAt) / 1000));
    const mm = Math.floor(sec / 60), ss = sec % 60;
    return (mm < 10 ? '0' + mm : '' + mm) + ':' + (ss < 10 ? '0' + ss : '' + ss);
  }

  // ==================== 单条 HUD（Phase 2·6） ====================
  /**
   * 一条 44pt 细 HUD 取代原上下两张 56pt 玩家卡：
   *   [AI 头像 · 执黑 / 吃子 2]  [用时 12:34]  [吃子 1 / 执白 · 你 头像]
   * 左=对手、右=自己（身份固定，不随翻转互换）；当前行棋方头像描金边 + 名称高亮。
   */
  renderHud(ctx, reduce) {
    const bar = this.hudBar;
    if (!bar) return;
    const st = this.game.getStatus();
    ctx.save();
    ctx.fillStyle = C.surface1;
    rr(ctx, bar.x, bar.y, bar.w, bar.h, R.btn); ctx.fill();
    ctx.strokeStyle = C.border; ctx.lineWidth = 1;
    rr(ctx, bar.x + 0.5, bar.y + 0.5, bar.w - 1, bar.h - 1, R.btn); ctx.stroke();

    // 左右两块等宽，中间留给计时（窄屏也保证 ≥72pt 不挤压，两侧各留 12pt 与中缝隔开）
    const centerW = 72;
    const sideW = (bar.w - centerW) / 2 - 12;
    const aiMode = this.mode === 'ai';
    const topColor = this.flipBoard ? COLOR.WHITE : COLOR.BLACK;
    const bottomColor = this.flipBoard ? COLOR.BLACK : COLOR.WHITE;
    const oppColor = aiMode ? this.aiColor : topColor;
    const myColor = aiMode ? this.playerColor : bottomColor;
    this.renderHudSide(ctx, oppColor, bar.x + 10, bar.y, sideW, false, reduce);
    this.renderHudSide(ctx, myColor, bar.x + bar.w - 10 - sideW, bar.y, sideW, true, reduce);

    // 中缝计时（将军时中缝文案切换为红色「将军」，与棋盘王位脉冲双编码）
    const cx = bar.x + bar.w / 2;
    ctx.strokeStyle = C.accentLine; ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(cx - centerW / 2, bar.y + 11); ctx.lineTo(cx - centerW / 2, bar.y + bar.h - 11);
    ctx.moveTo(cx + centerW / 2, bar.y + 11); ctx.lineTo(cx + centerW / 2, bar.y + bar.h - 11);
    ctx.stroke();
    const inCheck = !!(st.inCheck && !st.result);
    const yourTurn = this.mode === 'remote' && st.turn === this.playerColor;
    const bothLeft = this.mode === 'remote' && this.remoteBothLeft;
    const oppLeft = this.mode === 'remote' && this.remoteLeft;
    // v5：对端退出 → 中缝改为可点击的常驻仲裁入口；双方均退出 → 显示房间保留倒计时。
    const midLabel = inCheck ? '将军'
      : bothLeft ? '双方已离开'
      : oppLeft ? (this.arbitrationWaiting ? '等待中 · 处理' : '对手已离开 · 处理')
      : this.mode === 'remote' ? (yourTurn ? '轮到你' : '等待对手')
      : '用时';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillStyle = inCheck ? C.danger : (yourTurn ? C.accent : C.disabledFg); ctx.font = TF('micro');
    ctx.fillText(fitText(ctx, midLabel, centerW - 4), cx, bar.y + 15);
    const subLabel = bothLeft ? ('保留 ' + this._abandonCountdownText()) : this.elapsedText();
    ctx.fillStyle = inCheck ? C.danger : C.textSecondary; ctx.font = TF('san');
    ctx.fillText(fitText(ctx, subLabel, centerW - 4), cx, bar.y + 31);
    // 常驻仲裁入口命中区：对端退出（且非双方均退出）时中缝可点击再次打开仲裁面板。
    this._arbitrationRegion = (oppLeft && !bothLeft)
      ? { x: cx - centerW / 2, y: bar.y, w: centerW, h: bar.h } : null;
    ctx.restore();
  }

  /** HUD 单侧：头像 + 「名字 · 执子」+ 吃子数 + 当前行棋 / AI 思考反馈 */
  renderHudSide(ctx, color, x, y, w, alignRight, reduce) {
    const bar = this.hudBar;
    const active = !!this.game && this.game.turn === color;
    const isAI = this.mode === 'ai' && color === this.aiColor;
    const thinking = isAI && this.state === 'AI_THINKING';
    const avX = alignRight ? x + w - 13 : x + 13;
    const avY = y + bar.h / 2;
    ctx.save();
    // 头像（执子色）；当前行棋方描金边
    ctx.fillStyle = color === COLOR.WHITE ? C.pieceWhiteFill : C.pieceBlackFill;
    ctx.beginPath(); ctx.arc(avX, avY, 13, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = active ? C.accent : (color === COLOR.WHITE ? C.pieceWhiteStroke : C.pieceBlackStroke);
    ctx.lineWidth = active ? 2 : 1.5; ctx.stroke();
    piecesRender.drawPiece(ctx, 'k', color === COLOR.WHITE ? 'b' : 'w', avX, avY, 22);

    const tx = alignRight ? x + w - 34 : x + 34;
    const tw = Math.max(20, w - 34);
    ctx.textAlign = alignRight ? 'right' : 'left';
    ctx.textBaseline = 'middle';
    // 第一行：名字 · 执子（难度不在卡内重复，统一由顶栏标题表达）
    const name = this.mode === 'ai' ? (isAI ? 'AI' : '你') : (color === COLOR.WHITE ? '白方' : '黑方');
    let line1 = name + ' · ' + (color === COLOR.WHITE ? '执白' : '执黑');
    if (thinking) {
      const dots = reduce ? '…' : '.'.repeat(Math.floor(this.thinkPhase / 0.4) % 4);
      line1 = `AI 思考中${dots}`;
    }
    ctx.fillStyle = active ? C.accent : C.textSecondary;
    ctx.font = TF('caption');
    ctx.fillText(fitText(ctx, line1, tw), tx, y + 15);
    // 第二行：吃子数（0 时弱化，避免空行看起来像缺失）
    const caps = this.captured[color] || [];
    ctx.fillStyle = caps.length ? C.textSecondary : C.disabledFg;
    ctx.font = TF('micro');
    ctx.fillText(`吃子 ${caps.length}`, tx, y + 31);

    // AI 思考呼吸条（1.6s 循环，累计 dt 驱动；贴 HUD 底边 2pt）
    if (thinking) {
      const period = (MO.aiBreath || 1600) / 1000;
      const phase = reduce ? 0.5 : (0.5 - 0.5 * Math.cos(2 * Math.PI * (this.thinkPhase % period) / period));
      ctx.fillStyle = C.accent;
      ctx.globalAlpha = 0.3 + 0.7 * phase;
      const pad = 13;  // 与头像 x+13 同一水平基准
      const full = w - 2 * pad;
      const bw2 = full * (0.25 + 0.75 * phase);
      const bx = alignRight ? x + w - pad - bw2 : x + pad;
      rr(ctx, bx, y + bar.h - 3, bw2, 2, 1); ctx.fill();
    }
    ctx.restore();
  }

  renderBoard(ctx, settings, reduce) {
    // P1-I5：非法落点反馈——棋盘整体左右轻颤（仅视觉位移，不影响触控坐标判读）
    let _shakeX = 0;
    if (this.shakeUntil && Date.now() < this.shakeUntil) {
      const _k = (this.shakeUntil - Date.now()) / 320;
      _shakeX = Math.sin(Date.now() / 18) * 6 * _k;
    }
    ctx.save();
    if (_shakeX) ctx.translate(_shakeX, 0);
    const st = this.game.getStatus();
    // 目标格棋子抑制交给 drawBoard 的 options.skipPiece（避免每帧 clone 整个棋盘）
    const boardToDraw = this.game.board;
    const legalMoves = settings.showLegalMoves ? this.legalMoves : [];
    // 落子动画期间：让 drawBoard 跳过目标格棋子（skipPiece），由场景层画飞行棋子，避免重影
    const skipPiece = (this.state === 'ANIMATING' && this.anim && !this.anim.move.isCastling)
      ? { row: this.anim.move.toRow, col: this.anim.move.toCol } : null;
    boardRender.drawBoard(ctx, boardToDraw, {
      x: this.boardX, y: this.boardY, cellSize: this.cellSize,
      selected: this.selected,
      legalMoves: legalMoves,
      lastMove: this.lastMove,
      checkPos: st.inCheck ? this.game.board.findKing(this.game.turn) : null,
      flip: this.flipBoard,
      topPiecesUpsideDown: this.mode === 'local', // 仅本地双人：屏幕上半区棋子旋转 180° 朝上
      showCoordinates: !!settings.showCoordinates,
      time: this.timeMs,             // 累计毫秒，驱动脉冲相位（C4）
      reduceMotion: reduce,
      skipPiece: skipPiece
    });

    // 移动中的棋子叠加（直线插值，ease-in-out，不做弹跳/抛物线）
    if (this.state === 'ANIMATING' && this.anim && !this.anim.move.isCastling) {
      const t = this.anim.dur > 0 ? easeInOut(Math.min(1, this.anim.t / this.anim.dur)) : 1;
      const from = this.cellToScreen(this.anim.move.fromRow, this.anim.move.fromCol);
      const to = this.cellToScreen(this.anim.move.toRow, this.anim.move.toCol);
      const px = from.x + (to.x - from.x) * t, py = from.y + (to.y - from.y) * t;
      // 按目标格屏幕位置判定上半区（固定判定，跨中线时不闪烁突变）；仅本地双人旋转。
      const flyOpts = { rotate180: this.mode === 'local' && to.y < this.boardY + this.boardSize / 2 };
      piecesRender.drawPieceWithShadow(ctx, this.anim.pieceType, this.anim.pieceColor, px, py, this.cellSize, flyOpts);
    }
    // 落定尘埃环
    if (this.landRing) {
      const p = this.cellToScreen(this.landRing.row, this.landRing.col);
      const k = this.landRing.dur > 0 ? Math.min(1, this.landRing.t / this.landRing.dur) : 1;
      ctx.save(); ctx.globalAlpha = 0.6 * (1 - k);
      ctx.strokeStyle = C.accent; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(p.x, p.y, this.cellSize * (0.34 + 0.16 * k), 0, Math.PI * 2); ctx.stroke();
      ctx.restore();
    }
    // 落子前目标预览（C1 触控补偿）：按下未抬起时显示半透明落位 + 金内环
    if (this.pressedCell && this.selected) {
      const p = this.cellToScreen(this.pressedCell.row, this.pressedCell.col);
      const piece = this.game.board.getPiece(this.selected.row, this.selected.col);
      if (piece) {
        ctx.save(); ctx.globalAlpha = 0.5;
        // 按预览格屏幕位置判定上半区；保持原有 alpha 与阴影行为，仅叠加 rotate180。
        const previewOpts = { rotate180: this.mode === 'local' && p.y < this.boardY + this.boardSize / 2 };
        piecesRender.drawPieceWithShadow(ctx, piece.type, piece.color, p.x, p.y, this.cellSize, previewOpts);
        ctx.restore();
      }
      ctx.strokeStyle = C.hlSelectedRing; ctx.lineWidth = 2;
      const s = this.cellSize;
      rr(ctx, p.x - s / 2 + 3, p.y - s / 2 + 3, s - 6, s - 6, 4); ctx.stroke();
    }
    // V2 §2.2 提示高亮：起点金环 + 终点金点（叠在棋盘之上）
    this.renderHintHighlight(ctx);
    ctx.restore();
  }

  renderSAN(ctx, W) {
    if (!this.sanArea || this.sanArea.h < 12) return;
    const log = this.game.moveLog;
    ctx.fillStyle = C.textSecondary; ctx.font = TF('san');
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    const recent = log.slice(-6).join('  ');
    ctx.fillText(recent || '白方先行', W / 2, this.sanArea.y + Math.max(12, (this.sanArea.h - BAND_BOTTOM_GAP) / 2));
  }

  // ==================== V2 §2 教练气泡条 / 锦囊提示面板 ====================
  /**
   * 底部信息带：指导模式 = 教练气泡；标准模式 = SAN 记谱。
   * 提示面板（建议 + 采纳/忽略）与「推演中…」在两种模式下都占用这条带。
   */
  renderInfoStrip(ctx, W) {
    if (this.hintState === 'searching' || this.hintState === 'shown') {
      this.renderHintStrip(ctx);
      return;
    }
    if (this.coach) { this.renderCoachBubble(ctx); return; }
    this.renderSAN(ctx, W);
  }

  /** 教练气泡条（指导模式专用） */
  renderCoachBubble(ctx) {
    const band = this.coachBand;
    if (!band || band.h < 18) return;
    // 极矮屏：信息带略低于 22pt 时仍保底画出一行的气泡，避免教练提示完全不可见（§4-b）
    const h = Math.max(18, Math.min(band.h - BAND_BOTTOM_GAP, COACH_BAND_H, band.h - 2));
    const msg = this.coachBubble;
    const tone = msg ? this.coachToneColor(msg.sound) : C.disabledFg;
    ctx.save();
    ctx.fillStyle = C.surface1;
    rr(ctx, band.x, band.y, band.w, h, R.btn); ctx.fill();
    // 左侧教练图标（形状编码：说话中 = 亮金，静默 = 灰）
    ico(ctx, 'coach', band.x + 18, band.y + h / 2, 17, tone);
    // 文案
    const text = msg ? msg.text : '教练陪练中';
    const tx = band.x + 34;
    const tw = band.w - 34 - 12;
    ctx.fillStyle = msg ? C.textPrimary : C.disabledFg;
    ctx.font = TF('caption');
    ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    ctx.fillText(fitText(ctx, text, tw), tx, band.y + h / 2);
    ctx.restore();
  }

  /** 提示信息带：「推演中…」/ 建议面板（建议：SAN + 采纳一步 / 忽略） */
  renderHintStrip(ctx) {
    const band = this.coach ? this.coachBand : this.sanArea;
    if (!band || band.h < 18) return;
    // P1-L4：占满整条信息带（不再压到 44 上限），按钮视觉高与命中高均 ≥44
    const h = Math.max(18, Math.min(band.h - BAND_BOTTOM_GAP, 56));
    const y = band.y;
    ctx.save();
    ctx.fillStyle = C.surface1;
    rr(ctx, band.x, y, band.w, h, R.btn); ctx.fill();
    ctx.strokeStyle = C.accentLine; ctx.lineWidth = 1;
    rr(ctx, band.x + 0.5, y + 0.5, band.w - 1, h - 1, R.btn); ctx.stroke();
    this.hintRegions = [];
    if (this.hintState === 'searching') {
      // 推演中…
      ico(ctx, 'hint', band.x + 18, y + h / 2, 17, C.hlHintJade);
      const dots = '.'.repeat(1 + (Math.floor(this.timeMs / 260) % 3));
      ctx.fillStyle = C.textSecondary; ctx.font = TF('caption');
      ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
      ctx.fillText(`推演中${dots}`, band.x + 34, y + h / 2);
      ctx.restore();
      return;
    }
    // 建议面板
    ico(ctx, 'hint', band.x + 18, y + h / 2, 17, C.hlHintJade);
    const label = `建议：${this.hintSan || '—'}`;
    ctx.fillStyle = C.textPrimary; ctx.font = TF('caption');
    ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    // P1-L4：按钮视觉高 ≥44（band 更矮时取 band 高，命中区再透明外扩到 44）
    const BTN_MIN = 44;
    const btnW = 72, gap = 8, btnH = Math.min(BTN_MIN, h);
    const by = y + (h - btnH) / 2;
    const adoptX = band.x + band.w - 12 - btnW - gap - 52;
    const ignoreX = band.x + band.w - 12 - 52;
    const tw = Math.max(20, adoptX - (band.x + 34) - 8);
    ctx.fillText(fitText(ctx, label, tw), band.x + 34, y + h / 2);
    // [采纳一步] [忽略]
    drawBtn(ctx, adoptX, by, btnW, btnH, '采纳一步', 'primary', { pressed: this.tap.isPressing('hint:adopt', Date.now()) });
    drawBtn(ctx, ignoreX, by, 52, btnH, '忽略', 'secondary', { pressed: this.tap.isPressing('hint:ignore', Date.now()) });
    const hitH = Math.max(BTN_MIN, btnH), hitY = by - (hitH - btnH) / 2;
    this.hintRegions.push({ key: 'hint:adopt', rect: { x: adoptX, y: hitY, w: btnW, h: hitH } });
    this.hintRegions.push({ key: 'hint:ignore', rect: { x: ignoreX, y: hitY, w: 52, h: hitH } });
    ctx.restore();
  }

  /**
   * 提示高亮（Phase 2·5）：青玉虚线内框 + 青玉虚线箭头 + 终点青玉虚线环。
   * 与棋盘其余五态靠「色相 + 形状」双区分：
   *   选中=象牙实线内环 / 可走=象牙实点 / 可吃=酒红空心环 / 上一步=暖色底 / 将军=红色脉冲
   *   系统建议=青玉虚线（无实线、无金色，避免与"选中""揭晓金环"混淆）。
   * 浅格上青玉仅 1.8:1，故虚线先打一圈暗衬线再叠青玉（≥3:1 视觉分离）。
   */
  renderHintHighlight(ctx) {
    if (this.hintState !== 'shown' || !this.hintMove) return;
    const mv = this.hintMove;
    const from = this.cellToScreen(mv.fromRow, mv.fromCol);
    const to = this.cellToScreen(mv.toRow, mv.toCol);
    const cs = this.cellSize;
    const jade = C.hlHintJade;
    // 呼吸 0.62–1.0（累计时间驱动，与 C4 一致）
    const pulse = 0.62 + 0.38 * (0.5 + 0.5 * Math.sin(this.timeMs / 320));
    const lw = Math.max(2, cs * 0.055);
    const dash = [Math.max(4, cs * 0.22), Math.max(3, cs * 0.14)];
    const ang = Math.atan2(to.y - from.y, to.x - from.x);
    const rEnd = cs * 0.30;                       // 箭头尖端停在终点环外侧
    const ex = to.x - Math.cos(ang) * rEnd;
    const ey = to.y - Math.sin(ang) * rEnd;
    // 起点侧：从"起点格边缘"起笔，避免虚线压过棋子字形
    const sx = from.x + Math.cos(ang) * cs * 0.46;
    const sy = from.y + Math.sin(ang) * cs * 0.46;
    const inset = 1.5, box = cs - inset * 2;
    ctx.save();
    ctx.globalAlpha = pulse;
    ctx.lineCap = 'round';
    // 两遍：暗衬线（更粗的虚线）→ 青玉虚线，几何完全重合
    const passes = [
      { color: C.hlHintCasing, w: lw + 1.8 },
      { color: jade, w: lw }
    ];
    for (let p = 0; p < passes.length; p++) {
      ctx.strokeStyle = passes[p].color;
      ctx.lineWidth = passes[p].w;
      if (ctx.setLineDash) ctx.setLineDash(dash);
      // 起点：沿格边内缩的虚线框（"从这里走"）
      rr(ctx, from.x - cs / 2 + inset, from.y - cs / 2 + inset, box, box, 5); ctx.stroke();
      // 虚线箭头（"走到这里"）
      ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(ex, ey); ctx.stroke();
      // 终点：虚线环（"落点"）
      ctx.beginPath(); ctx.arc(to.x, to.y, cs * 0.34, 0, Math.PI * 2); ctx.stroke();
    }
    if (ctx.setLineDash) ctx.setLineDash([]);
    // 箭头头部：实心三角（形状编码，缩略/色弱也读得出方向）
    const ah = Math.max(7, cs * 0.20);
    ctx.fillStyle = jade;
    ctx.beginPath();
    ctx.moveTo(ex, ey);
    ctx.lineTo(ex - Math.cos(ang - 0.42) * ah, ey - Math.sin(ang - 0.42) * ah);
    ctx.lineTo(ex - Math.cos(ang + 0.42) * ah, ey - Math.sin(ang + 0.42) * ah);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  renderToolbar(ctx, W, H) {
    const y = this.toolbarY, h = 64;
    ctx.fillStyle = C.bgElev; ctx.fillRect(0, y, W, h);  // P2：仅填充工具栏自身高度，不再延伸至 home indicator
    ctx.strokeStyle = C.border; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(0, y + 0.5); ctx.lineTo(W, y + 0.5); ctx.stroke();
    // Phase 2·6：常驻主操作收敛为 3 项（设置/保存进度移入「更多」浮层）
    const items = [
      { key: 'undo', label: '悔棋', icon: 'undo' },
      { key: 'hint', label: this.coach ? '锦囊提示 ∞' : `锦囊提示 ${this.hintLeft}`, icon: 'hint' },
      { key: 'more', label: '更多', icon: 'more' }
    ];
    const barW = (typeof this._toolbarBarW === 'number') ? this._toolbarBarW : W;
    const barX = (typeof this._toolbarBarX === 'number') ? this._toolbarBarX : 0;
    const cw = barW / items.length;
    const canUndo = this.game.history.length > 0 &&
      ['IDLE', 'SELECTED', 'GAMEOVER'].indexOf(this.state) >= 0 &&
      this.mode !== 'remote';   // 联机对局禁止单方悔棋（两端一致）
    const busy = ['ANIMATING', 'AI_THINKING', 'PROMOTION'].indexOf(this.state) >= 0;
    // 锦囊提示：常规人机每局 3 次（用完置灰）；指导模式无限免费
    const hintUsable = !busy && this.state !== 'GAMEOVER' &&
      (this.mode !== 'ai' || this.game.turn === this.playerColor) &&
      (this.coach || this.hintLeft > 0);
    // D：结算模态期间触摸已全转给 handleModalTap（遮罩拦截），工具栏虽可见却点不了；
    // 仅渲染层统一弱态，消除视觉误导。不改 canUndo / hintUsable / busy / toolbarRegions。
    const modalGameover = !!(this.sm && this.sm.modal && this.sm.modal.current === 'gameover');
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      const rx = barX + i * cw;
      const disabled = (it.key === 'undo' && !canUndo) || (it.key === 'hint' && !hintUsable);
      ctx.save(); ctx.globalAlpha = (disabled || modalGameover) ? 0.35 : 1;
      util.drawTapHighlight(ctx, rx + 10, y + 2, cw - 20, h - 4, this.tap.isPressing('tb:' + it.key, Date.now()), R.sm);
      const iconY = y + 24, labelY = y + 46;
      const col = disabled ? C.disabledFg : (this.tap.isPressing('tb:' + it.key, Date.now()) ? C.accent : C.textSecondary);
      ico(ctx, it.icon, rx + cw / 2, iconY, 24, col);
      ctx.fillStyle = col; ctx.font = TF('micro'); ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(fitText(ctx, it.label, cw - 8), rx + cw / 2, labelY);
      ctx.restore();
      this.toolbarRegions.push({ key: it.key, rect: { x: rx, y, w: cw, h }, disabled });
    }
  }

  // ==================== 模态渲染 ====================
  renderPromotion(ctx, W, H) {
    ctx.fillStyle = C.overlay; ctx.fillRect(0, 0, W, H);
    const dw = Math.min(W * 0.9, 340), dh = 148;
    const dx = (W - dw) / 2, dy = (H - dh) / 2;
    util.withShadow(ctx, theme.elevation.e2, () => { ctx.fillStyle = C.surface1; rr(ctx, dx, dy, dw, dh, R.modal); ctx.fill(); });
    ctx.strokeStyle = C.accentLine; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(dx + 16, dy + 1); ctx.lineTo(dx + dw - 16, dy + 1); ctx.stroke();
    ctx.fillStyle = C.textPrimary; ctx.font = TF('h2'); ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    ctx.fillText('选择升变棋子', W / 2, dy + 16);
    this.modalRegions = [];
    // 右上 ✕（44×44）
    const cw = 44, cx = dx + dw - 8 - cw, cy = dy + 2;
    ctx.fillStyle = C.textSecondary; ctx.font = TF('subtitleB'); ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    icons.drawClose(ctx, cx + cw / 2, cy + cw / 2, 20, C.textSecondary);
    this.modalRegions.push({ key: 'close', rect: { x: cx, y: cy, w: cw, h: cw } });
    // 4 个选项格
    const pieces = ['q', 'r', 'b', 'n'], size = 56, gap = 16;
    const totalW = pieces.length * size + (pieces.length - 1) * gap;
    const sx = (W - totalW) / 2, sy = dy + 56;
    const color = this.game.turn;
    for (let i = 0; i < pieces.length; i++) {
      const px = sx + i * (size + gap);
      const on = this.tap.isPressing('promo:' + pieces[i], Date.now());
      ctx.fillStyle = C.surface2; rr(ctx, px, sy, size, size, 10); ctx.fill();
      if (on) { ctx.strokeStyle = C.accent; ctx.lineWidth = 2; rr(ctx, px + 1, sy + 1, size - 2, size - 2, 10); ctx.stroke(); }
      piecesRender.drawPieceWithShadow(ctx, pieces[i], color, px + size / 2, sy + size / 2, size);
      this.modalRegions.push({ key: 'promo:' + pieces[i], rect: { x: px, y: sy, w: size, h: size } });
    }
  }

  renderGameOver(ctx, W, H) {
    // 遮罩在 transform 之前，保证任意缩放下都全屏覆盖、无漏光
    ctx.fillStyle = C.overlay; ctx.fillRect(0, 0, W, H);
    // E：iPad / 折叠宽屏以屏幕中心为 pivot 做局部等比缩放，卡片 / 字号 / 按钮 / 间距整体放大；
    // 所有绘制坐标仍用 W/H 设计坐标，缩放由 transform 统一完成。矮屏 / 紧凑屏排除（s===1）。
    const LM = layoutMod.get();
    // 短边 >= 600 才算真正的平板/折叠展开：layout.js 的 W>414 会把 430×932 这类大屏手机
    // 误判为平板，等比放大后卡片占屏 94.9%、左右仅剩 11pt，反而破坏既有手机尺寸的显示效果。
    const isTablet = !!(LM && (LM.isTablet || LM.isLandscape)) && !(LM && LM.isCompactH)
      && Math.min(W, H) >= 600;
    const s = isTablet ? Math.min(1.45, Math.max(1.20, Math.min(W / 700, H / 700)), (H * 0.62) / 268) : 1;
    ctx.save();
    if (s !== 1) { ctx.translate(W / 2, H / 2); ctx.scale(s, s); ctx.translate(-W / 2, -H / 2); }
    const p = (this.sm && this.sm.modal && this.sm.modal.payload) || {};
    const dw = Math.min(W * 0.88, 340), dh = 268;
    const dx = (W - dw) / 2, dy = (H - dh) / 2 - 10;
    util.withShadow(ctx, theme.elevation.e2, () => { ctx.fillStyle = C.surface1; rr(ctx, dx, dy, dw, dh, R.modal); ctx.fill(); });
    ctx.strokeStyle = C.accentLine; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(dx + 16, dy + 1); ctx.lineTo(dx + dw - 16, dy + 1); ctx.stroke();
    const r = this.game.result, reason = this.game.resultReason;
    let title = '和棋';
    if (r === 'white_win') title = '白方获胜！';
    else if (r === 'black_win') title = '黑方获胜！';
    // C1：和局标题改用最重的 textPrimary，避免与 13px 文字按钮同色造成「结果像禁用」的层级倒挂
    const accColor = r === 'draw' ? C.textPrimary : (p.outcome === 'loss' ? C.danger : C.success);
    ctx.fillStyle = accColor; ctx.font = TF('h1'); ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    ctx.fillText(title, W / 2, dy + 26);
    // C2：本地双人 outcome 恒为 win、无「你」这个人称，中性表述避免与「黑方获胜！」自相矛盾。
    // 远程对弈与 ai 一致按 outcome 显示「你赢了 / 你输了 / 平局」，两端基于同一 result 得到一致文案。
    // v5：封存残局不判成绩，perspective 固定为「残局已封存 · 不判成绩」。
    const perspective = this.remoteStatus === 'archived' ? '残局已封存 · 不判成绩'
      : this.mode === 'local' && r !== 'draw' ? '本局结束'
      : p.outcome === 'win' ? '你赢了' : p.outcome === 'loss' ? '你输了' : '平局';
    ctx.fillStyle = C.textPrimary; ctx.font = TF('subtitle');
    ctx.fillText(perspective, W / 2, dy + 62);
    const rt = reasonText(reason);
    if (rt) { ctx.fillStyle = C.textSecondary; ctx.font = TF('caption'); ctx.fillText(rt, W / 2, dy + 94); }
    this.modalRegions = [];
    // E5：命中区统一在屏幕坐标注册；s===1 时逐值恒等，缩放时按 pivot 换算
    const pushRegion = (key, x, y, w, h) => {
      this.modalRegions.push({
        key,
        rect: s === 1 ? { x, y, w, h } : {
          x: W / 2 + (x - W / 2) * s,
          y: H / 2 + (y - H / 2) * s,
          w: w * s,
          h: h * s
        }
      });
    };
    const pad = 20, gap = 12, bw = (dw - pad * 2 - gap) / 2, bh = 48;
    const by = dy + 126;
    drawBtn(ctx, dx + pad, by, bw, bh, '再来一局', 'primary', { pressed: this.tap.isPressing('again', Date.now()) });
    drawBtn(ctx, dx + pad + bw + gap, by, bw, bh, '返回菜单', 'secondary', { pressed: this.tap.isPressing('menu', Date.now()) });
    pushRegion('again', dx + pad, by, bw, bh);
    pushRegion('menu', dx + pad + bw + gap, by, bw, bh);
    // 第三行：查看棋谱 / 保存本局 + 悔棋继续（文字按钮；A 删除与首字重叠的 chevron）。
    // v5.1：远程对弈同样写入本地棋谱，恢复「查看棋谱 / 保存本局」两个入口；
    // 仅「悔棋继续」在 remote 下隐藏（doUndo 对 remote 直接 return，避免死链）。
    const ly = by + bh + 24;   // 主按钮底 by+48 → 第三行命中顶 by+60，间隔 12pt，消除误触
    const off = 64;
    const rxL = W / 2 - off - 55, rxR = W / 2 + off - 55, ry = ly - 12, rw = 110, rh = 44;
    ctx.font = TF('caption'); ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    if (this.savedGameId) {
      const on = this.tap.isPressing('view', Date.now());
      util.drawTapHighlight(ctx, rxL, ry, rw, rh, on, R.sm);
      ctx.fillStyle = on ? C.accent : C.textPrimary; ctx.fillText('查看棋谱', W / 2 - off, ly + 10);
      pushRegion('view', rxL, ry, rw, rh);
    } else {
      // 自动保存被关闭或失败时，提供手动「保存本局」兜底
      const on = this.tap.isPressing('save', Date.now());
      util.drawTapHighlight(ctx, rxL, ry, rw, rh, on, R.sm);
      ctx.fillStyle = on ? C.accent : C.textPrimary; ctx.fillText('保存本局', W / 2 - off, ly + 10);
      pushRegion('save', rxL, ry, rw, rh);
    }
    if (this.mode !== 'remote') {
      const undoOn = this.tap.isPressing('undo', Date.now());
      util.drawTapHighlight(ctx, rxR, ry, rw, rh, undoOn, R.sm);
      ctx.fillStyle = undoOn ? C.accent : C.textPrimary; ctx.fillText('悔棋继续', W / 2 + off, ly + 10);
      pushRegion('undo', rxR, ry, rw, rh);
    }
    ctx.restore();
  }

  renderMoreDrawer(ctx, W, H) {
    ctx.fillStyle = C.overlay; ctx.fillRect(0, 0, W, H);
    // P2：底部抽屉预留 home indicator（L.safe.bottom），不再贴底到 H
    const _lm = layoutMod.get();
    const _safeB = (_lm && _lm.safe && typeof _lm.safe.bottom === 'number') ? _lm.safe.bottom : 20;
    const _navTop = (_lm && typeof _lm.navSafeTop === 'number') ? _lm.navSafeTop : 28;
    // Phase 2·6：设置 / 保存进度收进本浮层（常驻工具栏只留 悔棋 / 提示 / 更多）
    const busy = ['ANIMATING', 'AI_THINKING', 'PROMOTION'].indexOf(this.state) >= 0;
    const items = [
      { key: 'settings', label: '设置' },
      { key: 'save', label: '保存进度', disabled: busy },
      { key: 'flip', label: `翻转棋盘（当前${this.flipBoard ? '已翻转' : '未翻转'}·本局保持）` },
      { key: 'rules', label: '基本规则' },
      { key: 'copy', label: '复制棋谱' },
      { key: 'resign', label: '认输', danger: true },
      { key: 'menu', label: '返回菜单' }
    ];
    // 远程对弈：房间协议暂无认输同步能力，隐藏单方认输以免两端结束态不一致；
    // v5：补「结束对弈（按兵力判定）」常驻入口，走二次确认 + judgeByMaterial 流程。
    if (this.mode === 'remote') {
      for (let i = items.length - 1; i >= 0; i--) if (items[i].key === 'resign') items.splice(i, 1);
      items.splice(items.length - 1, 0, { key: 'abort', label: '结束对弈（按兵力判定）', danger: true });
    }
    const rowH = 44, gap = 6, rx = 24, rw = W - 48;
    const sh = 74 + items.length * (rowH + gap) + 6;
    const sy = Math.max(_navTop + 8, H - sh - _safeB);
    util.withShadow(ctx, theme.elevation.e2, () => { ctx.fillStyle = C.surface1; rr(ctx, 8, sy, W - 16, sh, R.modal); ctx.fill(); });
    ctx.fillStyle = C.textPrimary; ctx.font = TF('h2'); ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    ctx.fillText('更多', 24, sy + 26);
    ctx.fillStyle = C.textSecondary; ctx.font = TF('caption');
    ctx.fillText('对局设置与操作', 24, sy + 52);
    this.modalRegions = [];
    // 右上关闭 ✕
    const cw = 44, cx = W - 16 - 8 - cw, cy = sy + 6;
    ctx.fillStyle = C.textSecondary; ctx.font = TF('subtitleB'); ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    icons.drawClose(ctx, cx + cw / 2, cy + cw / 2, 20, C.textSecondary);
    this.modalRegions.push({ key: 'close', rect: { x: cx, y: cy, w: cw, h: cw } });
    let iy = sy + 68;
    for (const it of items) {
      ctx.save();
      ctx.globalAlpha = it.disabled ? 0.35 : 1;
      ctx.fillStyle = it.danger ? 'rgba(217,106,106,0.10)' : C.surface2;
      rr(ctx, rx, iy, rw, rowH, R.sm); ctx.fill();
      ctx.fillStyle = it.danger ? C.danger : C.textPrimary; ctx.font = TF('body');
      ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
      ctx.fillText(it.label, rx + 14, iy + rowH / 2);
      if (this.tap.isPressing(it.key, Date.now())) { ctx.fillStyle = 'rgba(0,0,0,0.08)'; rr(ctx, rx, iy, rw, rowH, R.sm); ctx.fill(); }
      ctx.restore();
      this.modalRegions.push({ key: it.key, rect: { x: rx, y: iy, w: rw, h: rowH }, disabled: !!it.disabled });
      iy += rowH + gap;
    }
  }

  renderSettingsDrawer(ctx, W, H) {
    ctx.fillStyle = C.overlay; ctx.fillRect(0, 0, W, H);
    // P2：顶边改用 navSafeTop 避让胶囊；底边预留 home indicator
    const _lm = layoutMod.get();
    const _safeB = (_lm && _lm.safe && typeof _lm.safe.bottom === 'number') ? _lm.safe.bottom : 20;
    const _navTop = (_lm && typeof _lm.navSafeTop === 'number') ? _lm.navSafeTop : 28;
    const sy = _navTop + 8;
    const sh = H - sy - _safeB - 8;
    util.withShadow(ctx, theme.elevation.e2, () => { ctx.fillStyle = C.surface1; rr(ctx, 12, sy, W - 24, sh, R.modal); ctx.fill(); });
    ctx.fillStyle = C.textPrimary; ctx.font = TF('h2'); ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    ctx.fillText('设置', 28, sy + 26);
    this.modalRegions = [];
    const cw = 44, cx = W - 24 - 8 - cw, cy = sy + 6;
    ctx.fillStyle = C.textSecondary; ctx.font = TF('subtitleB'); ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    icons.drawClose(ctx, cx + cw / 2, cy + cw / 2, 20, C.textSecondary);
    this.modalRegions.push({ key: 'close', rect: { x: cx, y: cy, w: cw, h: cw } });
    const px = 20, py = sy + 50, pw = W - 40, ph = sh - 62;
    this.settingsPanel = { x: px, y: py, w: pw, h: ph };
    const settings = GameContext.getSettings();
    // P1-10：把抽屉内按下的行 key（去掉 'set:' 前缀）交给共享面板绘制 90ms 按压态
    let pressedKey = null;
    if (this.pressed && this.pressed.indexOf('set:') === 0) pressedKey = this.pressed.slice(4);
    const out = SettingsModule.renderSettingsPanel(ctx, px, py, pw, ph, this.settingsScrollY, settings, {
      pressedKey: pressedKey,
      viewportW: W
    });
    this.settingsMaxScroll = Math.max(0, out.contentHeight - ph);
    if (this.settingsScrollY > this.settingsMaxScroll) this.settingsScrollY = this.settingsMaxScroll;
    for (const r of out.regions) this.modalRegions.push({ key: 'set:' + r.key, choice: r.choice, kind: r.kind, rect: r.rect });
  }

  // ==================== 输入 ====================
  onTouchStart(x, y) {
    this.guard.down(x, y);
    this.pressed = this._hitAny(x, y);
    this.pressedCell = null;
    if (this.pressed) this.tap.press(this.pressed, Date.now());
    // 落子前目标预览
    if ((this.state === 'SELECTED') && !(this.sm && this.sm.modal && this.sm.modal.isOpen())) {
      const pos = this.screenToBoard(x, y);
      if (pos && this.legalMoves.some(m => m.toRow === pos.row && m.toCol === pos.col)) this.pressedCell = pos;
    }
  }
  onTouchMove(x, y) {
    const m = this.guard.move(x, y);
    if (m.moved) { if (this.pressed) this.tap.clear(this.pressed); this.pressed = null; this.pressedCell = null; }
    if (this.sm && this.sm.modal && this.sm.modal.current === 'settingsDrawer' && this.settingsPanel && inRect(x, y, this.settingsPanel)) {
      this.settingsScrollY = Math.max(0, Math.min(this.settingsMaxScroll, this.settingsScrollY - m.stepY));
    }
  }
  onTouchEnd(x, y) {
    const e = this.guard.end(x, y);
    this.pressed = null; this.pressedCell = null;
    if (!e.valid) return;

    if (this.sm && this.sm.modal && this.sm.modal.isOpen()) {
      if (!this.sm.modal.interactive()) return; // 模态 200ms 防穿透（modal 独立机制，非按钮防穿透）
      if (this.sm.modal.isGeneric()) {
        const act = this.sm.modal.hitGeneric(x, y);
        if (act) this.sm.modal.resolveGeneric(act);
        return;
      }
      this.handleModalTap(x, y);
      return;
    }

    if (!this.tap.guard(Date.now())) return; // 90ms 全局防穿透（Phase 3·12 统一）
    GameContext.emit('tap');
    // v5 常驻仲裁入口（HUD 中缝「对手已离开 · 处理」）：点击再次打开三选项面板。
    if (this._arbitrationRegion && inRect(x, y, this._arbitrationRegion)) {
      if (!this.tap.guard(Date.now(), 'arbitration')) return;
      this.openArbitrationModal(); return;
    }
    // 返回
    if (this.backRegion && inRect(x, y, this.backRegion)) {
      if (!this.tap.guard(Date.now(), 'back')) return;
      this.requestLeave(); return;
    }
    // 工具栏
    for (const b of this.toolbarRegions) {
      if (inRect(x, y, b.rect)) {
        if (b.disabled) return;
        if (!this.tap.guard(Date.now(), 'tb:' + b.key)) return;
        this.onToolbar(b.key); return;
      }
    }
    // 提示面板按钮（采纳一步 / 忽略）
    for (const r of this.hintRegions) {
      if (inRect(x, y, r.rect)) {
        if (!this.tap.guard(Date.now(), 'hint:' + r.key)) return;
        GameContext.emit('tap');
        if (r.key === 'hint:adopt') this.adoptHint();
        else this.ignoreHint();
        return;
      }
    }
    this.handleBoardTouch(x, y);
  }

  _hitAny(x, y) {
    if (this.sm && this.sm.modal && this.sm.modal.isOpen()) {
      for (const r of this.modalRegions) { if (r.disabled) continue; if (inRect(x, y, r.rect)) return r.key; }
      return null;
    }
    if (this.backRegion && inRect(x, y, this.backRegion)) return 'back';
    for (const b of this.toolbarRegions) if (inRect(x, y, b.rect) && !b.disabled) return 'tb:' + b.key;
    for (const r of this.hintRegions) if (inRect(x, y, r.rect)) return r.key;
    return null;
  }

  handleModalTap(x, y) {
    const mc = this.sm.modal.current;
    for (const r of this.modalRegions) {
      if (r.disabled) continue;
      if (inRect(x, y, r.rect)) { this.onModalAction(mc, r); return; }
    }
    // 未命中：遮罩点击策略
    if (mc === 'promotion') { this.cancelPromotion(); }
    else if (mc === 'more' || mc === 'settingsDrawer') { GameContext.closeModal(); }
    // gameover：遮罩点击拦截，无响应
  }

  onModalAction(mc, r) {
    if (!this.tap.guard(Date.now(), 'modal:' + mc + ':' + r.key)) return;
    GameContext.emit('tap');
    if (mc === 'promotion') {
      if (r.key === 'close') { this.cancelPromotion(); return; }
      if (r.key.indexOf('promo:') === 0) {
        const pt = r.key.slice(6);
        const move = this.promotionMoves.find(m => m.promotion === pt);
        if (move) this.commitMove(move, false);
      }
      return;
    }
    if (mc === 'gameover') {
      if (r.key === 'again') { GameContext.closeModal(); GameContext.emit('navigate', { to: 'setup' }); this.restartToSetup(); }
      else if (r.key === 'menu') { GameContext.closeModal(); GameContext.emit('navigate', { to: 'menu' }); GameContext.popToRoot(); }
      else if (r.key === 'view' && this.savedGameId) { GameContext.closeModal(); GameContext.pushScene('replay', { id: this.savedGameId, from: 'gameover' }); }
      else if (r.key === 'save') { this.manualSave(() => this.openGameOver()); }
      else if (r.key === 'undo') { this.undoFromGameOver(); }
      return;
    }
    if (mc === 'more') {
      if (r.key === 'close') { GameContext.closeModal(); return; }
      // 设置 / 保存进度：调用原有 action（不新增逻辑，仅改入口）
      if (r.key === 'settings') { GameContext.closeModal(); GameContext.openModal('settingsDrawer', {}); return; }
      if (r.key === 'save') { GameContext.closeModal(); this.manualSave(); return; }
      if (r.key === 'flip') { this.toggleBoardFlip(); }
      else if (r.key === 'rules') { this.openRules(); }
      else if (r.key === 'copy') { this.copyRecord(); GameContext.closeModal(); }
      else if (r.key === 'menu') { GameContext.closeModal(); this.requestLeave(); }
      else if (r.key === 'resign') { this.confirmResign(); }
      else if (r.key === 'abort') { this.confirmFinishByMaterial(); }  // 内部先 close 再弹二次确认
      return;
    }
    if (mc === 'settingsDrawer') {
      if (r.key === 'close') { GameContext.closeModal(); return; }
      if (r.key.indexOf('set:') === 0) {
        const key = r.key.slice(4);
        const res = SettingsModule.applySettingKey(key, GameContext.getSettings(), r.choice);
        if (res.patch) {
          const ok = GameContext.saveSettings(res.patch);
          if (ok === false) GameContext.showBanner('设置未保存，请重试', 'danger');
          if (res.sound) GameContext.emit('toggle');
        }
        if (res.action === 'confirmClear') this.confirmClearAll();
        else if (res.action === 'confirmAutoPrune') this.confirmAutoPrune();
        else if (res.action === 'toast') GameContext.showBanner(res.message, 'info');
        // 账号与隐私新 action（toggleCloudSync/openProfile/openPrivacy/deleteCloudData）
        // 与设置页共用 settings.js 的同一分发入口，保证对局抽屉点击有响应。
        else SettingsModule.runAccountAction(res.action);
      }
      return;
    }
  }

  // ==================== 棋盘交互 ====================
  handleBoardTouch(x, y) {
    if (this.state !== 'IDLE' && this.state !== 'SELECTED') return; // 输入锁
    if (this.mode === 'ai' && this.game.turn === this.aiColor) return;
    // 远程对弈：只在自己回合、房间未结束时允许落子（不允许替对手走）。
    if (this.mode === 'remote' && this.remoteStatus === 'finished') return;
    if (this.mode === 'remote' && this.game.turn !== this.playerColor) {
      try { GameContext.showBanner('等待对手落子', 'info'); } catch (e) { /* noop */ }
      return;
    }
    const pos = this.screenToBoard(x, y);
    if (!pos) { this.selected = null; this.legalMoves = []; this.state = 'IDLE'; return; }
    const { row, col } = pos;
    const piece = this.game.board.getPiece(row, col);
    if (this.selected) {
      if (this.selected.row === row && this.selected.col === col) { // 点同一子取消
        this.selected = null; this.legalMoves = []; this.state = 'IDLE'; return;
      }
      const move = this.legalMoves.find(m => m.toRow === row && m.toCol === col);
      if (move) {
        const promos = this.legalMoves.filter(m => m.toRow === row && m.toCol === col && m.promotion);
        if (promos.length > 1) { this.openPromotion(promos); return; }
        this.commitMove(move, false); return;
      }
      if (piece && piece.color === this.game.turn) { this.selectPiece(row, col); return; }
      // P1-I5：点选了非本方可落子的格子——轻颤棋盘 + 文案提示，给出明确负反馈（不再静默取消）
      this.shakeUntil = Date.now() + 320;
      if (GameContext.showBanner) GameContext.showBanner('这步走不通', 'warning');
      this.selected = null; this.legalMoves = []; this.state = 'IDLE'; return;
    } else if (piece && piece.color === this.game.turn) {
      this.selectPiece(row, col);
    }
  }

  selectPiece(row, col) {
    this.selected = { row, col };
    this.legalMoves = this.game.getLegalMovesFor(row, col);
    this.state = 'SELECTED';
    GameContext.emit('select');
  }

  openPromotion(promos) {
    this.promotionMoves = promos;
    this.state = 'PROMOTION';
    GameContext.openModal('promotion', {});
  }
  cancelPromotion() {
    GameContext.closeModal();
    this.promotionMoves = [];
    this.state = 'SELECTED'; // 保留 selected + legalMoves（C12 无缝回退）
  }

  commitMove(move, byAI) {
    const moverColor = this.game.turn;
    const piece = this.game.board.getPiece(move.fromRow, move.fromCol);
    const capturedBefore = move.isEnPassant
      ? this.game.board.getPiece(moverColor === COLOR.WHITE ? move.toRow + 1 : move.toRow - 1, move.toCol)
      : this.game.board.getPiece(move.toRow, move.toCol);
    const wasCapture = !!capturedBefore || !!move.isEnPassant;
    // 指导模式：走子前先记录评估基线与「更优着法」（用于点评与错失判定）
    let coachPre = null;
    if (this.coach && this.mode === 'ai') {
      const sign = moverColor === COLOR.WHITE ? 1 : -1;
      coachPre = {
        evalBefore: evaluate(this.game.board),
        alt: this.bestAlternative(moverColor, sign)
      };
    }
    const ok = this.game.makeMove(move);
    if (!ok) { this.state = (this.mode === 'ai' && this.game.turn === this.aiColor) ? 'AI_THINKING' : 'IDLE'; return; }
    this.lastMove = { fromRow: move.fromRow, fromCol: move.fromCol, toRow: move.toRow, toCol: move.toCol };
    this.selected = null; this.legalMoves = [];
    // 本地双人 / 远程方向全程固定：走子后不再按 sideToMove 翻转（仅「更多」抽屉手动调转）。
    // 远程对弈：把刚落的一步异步推到房间，不 await、不阻塞 UI、不改本地已落子的棋盘。
    if (this.mode === 'remote') this.pushRemoteMove();
    if (this.sm.modal.current === 'promotion') this.sm.modal.close();
    if (capturedBefore) this.captured[moverColor].push(capturedBefore.type);
    if (wasCapture) GameContext.emit('capture'); else GameContext.emit('move');
    const st = this.game.getStatus();
    if (st.inCheck && !st.result) GameContext.emit('check');
    const reduce = !!GameContext.getSettings().reduceMotion;
    this.state = 'ANIMATING';
    this.anim = {
      move: { fromRow: move.fromRow, fromCol: move.fromCol, toRow: move.toRow, toCol: move.toCol, isCastling: move.isCastling },
      pieceType: piece ? piece.type : 'p', pieceColor: moverColor,
      t: 0, dur: (reduce || move.isCastling) ? 0 : (MO.move || 180) / 1000, wasCapture
    };
    this.landRing = { row: move.toRow, col: move.toCol, t: 0, dur: (reduce ? 45 : (MO.land || 90)) / 1000 };
    // 提示面板在局面变化后失效（搜索结果已过期）
    if (this.hintState === 'searching' || this.hintState === 'shown') {
      this.hintState = 'idle';
      this.cancelHint();
    }
    if (coachPre) this.coachAfterMove(moverColor, byAI, coachPre, capturedBefore);
  }

  /**
   * 指导模式落子后的讲解 / 点评（§2.5 模板）。
   */
  coachAfterMove(moverColor, byAI, pre, capturedBefore) {
    const st = this.game.getStatus();
    const san = (this.game.moveLog[this.game.moveLog.length - 1]) || '';
    if (byAI) {
      // AI 讲解：将军 > 吃子 > 出子
      if (st.inCheck && !st.result) {
        this.sayCoach(`将军 ${san}，先解将再想别的。`, 'coachSay', 1);
      } else if (capturedBefore) {
        const name = PIECE_NAMES[capturedBefore.type] || '子';
        this.sayCoach(`我吃掉了你的 ${name}，注意这里。`, 'coachSay', 1);
      } else {
        this.sayCoach(`我走 ${san}，先出动子力占住中心。`, 'coachSay', 1);
      }
      // 玩家被将军 → 立即提醒（优先级更高，插播）
      if (st.inCheck && !st.result && st.turn === this.playerColor) {
        this.sayCoach('你的王被将军了，优先应将。', 'coachWarn', 3);
      }
      return;
    }
    // 玩家落子后点评：评估变化分类（好棋 / 寻常 / 失误 / 错失）
    const evalAfter = evaluate(this.game.board);
    const r = this.classifyCoach(pre.evalBefore, evalAfter, san, pre.alt);
    this.coachHistory.push({ ply: this.game.moveLog.length, kind: r.kind, delta: r.delta, san: san });
    this.updateCoachStats();
    this.sayCoach(r.text, r.sound, r.kind === 'good' ? 2 : 1);
  }

  /** 清空提示面板（局面变化 / 采纳 / 忽略） */

  onAnimEnd() {
    this.anim = null;
    const st = this.game.getStatus();
    if (st.result) { this.onGameOver(); return; }
    if (this.mode === 'ai' && st.turn === this.aiColor) { this.startAIThinking(); return; }
    this.state = 'IDLE';
  }

  startAIThinking() {
    this.state = 'AI_THINKING';
    this.thinkPhase = 0; this.thinkLead = 0.3; this.aiCtx = null;
    GameContext.emit('aiThink', {});
  }

  // ==================== 结算 / 存档 ====================
  onGameOver() {
    this.state = 'GAMEOVER';
    this.selected = null; this.legalMoves = [];
    // 对局已结束：清除断点快照（远程对局不写个人断点，也不清其它模式的断点，隔离个人进度通道）
    if (this.mode !== 'remote' && GameContext.clearResume) GameContext.clearResume();
    const st = this.game.getStatus();
    const winner = st.result === 'white_win' ? 'w' : st.result === 'black_win' ? 'b' : null;
    let outcome = 'draw';
    if (st.result && st.result !== 'draw') {
      // 人机 / 远程按自己执棋色判定胜负；本地双人恒为 win（共享屏、无人称，中性文案）。
      outcome = this.mode === 'local' ? 'win' : (winner === this.playerColor ? 'win' : 'loss');
    }
    this._lastOutcome = outcome;
    GameContext.emit('win', { outcome });
    const settings = GameContext.getSettings();
    // 自动存档：失败/满额时不弹阻塞模态（避免被随后打开的结算 M2 关掉），改用 Banner +「保存本局」兜底。
    // v5.1：远程对弈同样写入本地棋谱（对手昵称/模式三态由 buildRecord 提供），两端可各自留存；
    // 远程仍不写「个人断点快照」（saveResumeSnapshot 对 remote 直接 return），个人进度通道保持隔离。
    // persistRecord() 成功时会设置 this.savedGameId，供结算模态「查看棋谱」入口使用。
    if (settings.autoSaveGame && st.movesUci.length >= 1 && !this.autoSavedThisResult) {
      this.autoSavedThisResult = true;
      const status = this.persistRecord(this.buildRecord(true));
      if (status === 'saved') GameContext.showBanner('结算已自动存档', 'success');
      else if (status === 'full') GameContext.showBanner('棋谱已满，请手动保存', 'warning');
      else { GameContext.emit('uiError'); GameContext.showBanner('自动保存失败，请手动保存', 'danger'); }
    }
    // v5：房主按本局结果记录一局比分。result 用 ROOM_RESULT 标签（正常将杀也复用 material* 标签）；
    // 协议层用 gamesPlayed CAS 保证幂等（重复调用返回 already_recorded），故本地不加去重标记。
    if (this.mode === 'remote' && this.roomRole === 'host') {
      const rr = st.result === 'white_win' ? ROOM_RESULT.materialWhite
        : st.result === 'black_win' ? ROOM_RESULT.materialBlack : ROOM_RESULT.draw;
      if (room && typeof room.recordGameResult === 'function') {
        try {
          const p = room.recordGameResult(rr);
          if (p && typeof p.catch === 'function') p.catch(() => { /* noop */ });
        } catch (e) { /* 协议层未就绪：降级，不抛 */ }
      }
    }
    this.openGameOver();
  }

  openGameOver() {
    GameContext.openModal('gameover', {
      outcome: this._lastOutcome || 'draw',
      savedGameId: this.savedGameId,
      autoSave: GameContext.getSettings().autoSaveGame
    });
  }

  buildRecord(final) {
    const st = this.game.getStatus();
    const plies = st.movesUci.length;
    const winner = st.result === 'white_win' ? 'w' : st.result === 'black_win' ? 'b' : null;
    let outcome = 'ongoing';
    if (st.result === 'draw') outcome = 'draw';
    // local 恒 win（共享屏、无人称）；ai / remote 按自己执棋色判胜负（与 onGameOver 的 outcome 一致）。
    else if (winner) outcome = this.mode === 'local' ? 'win' : (winner === this.playerColor ? 'win' : 'loss');
    const nowTs = Date.now();
    const opponent = this.mode === 'ai' ? `AI · ${this.difficultyName()}`
      : this.mode === 'local' ? '本地对手'
      : (this.remoteOpponentNick || '远程对手');
    return {
      id: this.gameId, version: 1, mode: this.mode,
      difficulty: this.mode === 'ai' ? this.difficultyKey() : null,
      playerColor: this.playerColor,
      opponent,
      opponentNick: this.mode === 'remote' ? (this.remoteOpponentNick || '') : '',
      result: st.result, resultReason: st.resultReason || null,
      outcome, startedAt: this.startedAt, endedAt: final ? nowTs : null,
      durationMs: nowTs - this.startedAt, plies, fullMoves: Math.ceil(plies / 2),
      movesUci: st.movesUci, sanLog: st.moveLog, startFen: null,
      createdAt: this.startedAt, updatedAt: nowTs
    };
  }

  /**
   * 持久化一条记录（不做阻塞弹窗，交由调用方决定）。
   * @returns {'saved'|'full'|'error'}
   */
  persistRecord(rec, opts) {
    // storage.saveRecord 返回 {ok, reason, rebuilt, pruned, truncated}；满额/写入失败由 storage
    // 内部按 autoPrune / force 处理。此处仅做结果归一化与附带信息提示。
    const res = GameContext.saveRecord(rec, opts);
    if (res && res.ok) {
      this.savedGameId = res.id || rec.id;
      GameContext.emit('saveRecord');
      if (res.rebuilt) GameContext.showBanner('棋谱索引已重建', 'info');
      else if (res.pruned) GameContext.showBanner('已覆盖最早一局', 'info');
      else if (res.truncated) GameContext.showBanner('超过 400 半步，已截断保存', 'warning');
      return 'saved';
    }
    if (res && res.reason === 'full') return 'full';
    GameContext.emit('uiError');
    return 'error';
  }

  /**
   * 手动保存（工具栏 / 结算「保存本局」）。满额 / 写失败弹出二次确认 / M6，
   * 处理完成后可选回调 after（结算态用于重新打开 M2）。
   */
  manualSave(after) {
    if (this.state === 'AI_THINKING') return;
    const rec = this.buildRecord(false);
    const status = this.persistRecord(rec);
    if (status === 'saved') {
      GameContext.showBanner('进度已保存', 'success');
      if (after) after();
    } else if (status === 'full') {
      GameContext.openModal('confirm', {
        title: '棋谱已满', message: '棋谱已满 (50/50)，保存将删除最早的一局，是否继续？',
        buttons: [{ label: '取消', action: 'cancel', variant: 'secondary' }, { label: '继续保存', action: 'confirm', variant: 'primary' }],
        onAction: (act) => {
          GameContext.closeModal();
          // force:true 交 storage 删除最早一局后强制写入，避免场景手动删 + 再存的竞争
          if (act === 'confirm' && this.persistRecord(rec, { force: true }) === 'saved') {
            GameContext.showBanner('进度已保存', 'success');
          }
          if (after) after();
        }
      });
    } else { // error
      GameContext.emit('uiError');
      GameContext.openModal('storageError', {
        title: '保存失败', message: '存储空间可能已满，请清理后重试。', maskClosable: true,
        buttons: [{ label: '重试', action: 'retry', variant: 'primary' }, { label: '取消', action: 'cancel', variant: 'secondary' }],
        onAction: (act) => {
          GameContext.closeModal();
          if (act === 'retry' && this.persistRecord(rec) === 'saved') GameContext.showBanner('进度已保存', 'success');
          if (after) after();
        }
      });
    }
  }

  // ==================== 工具栏动作 ====================
  onToolbar(key) {
    if (key === 'undo') this.doUndo();
    else if (key === 'hint') this.startHint();
    else if (key === 'more') GameContext.openModal('more', {});
  }

  doUndo() {
    // 联机对局禁止单方悔棋，保证两端状态一致。
    if (this.mode === 'remote') return;
    if (this.game.history.length === 0) return;
    const wasOver = this.state === 'GAMEOVER';
    // 指导模式：悔棋前记下被撤销的决策点评（用于重算统计）
    const dropped = this.coach ? this.coachHistory.length : 0;
    this.game.undoMove();
    // 人机模式再撤一步（AI）；仅当撤销后轮到 AI 且仍有历史时才撤第二步（修正 history.length===1 边界）
    if (this.mode === 'ai' && this.game.history.length > 0 && this.game.turn === this.aiColor) {
      this.game.undoMove();
    }
    this.lastMove = null; this.selected = null; this.legalMoves = [];
    this.anim = null; this.landRing = null; this.aiCtx = null;
    // 本地双人 / 远程方向全程固定：悔棋后不再按 sideToMove 翻转。
    // P0-I2 悔棋软锁修复：悔棋后若轮到 AI（如玩家在 AI 首手前撤销、或撤销后恰好轮到 AI），
    // 必须重新唤起 AI 思考，否则 handleBoardTouch 会因 turn===aiColor 直接 return，造成双向死锁。
    if (this.mode === 'ai' && this.game.turn === this.aiColor) this.startAIThinking();
    else this.state = 'IDLE';
    this.hintState = 'idle';
    this.cancelHint();
    GameContext.emit('undo');
    // 指导模式：撤销后重算该决策点的点评（§2.4）+ 重新点评
    if (this.coach) {
      // 撤销掉的最后一条点评作废（按 ply 判定：该步已不在棋谱中）
      const plyNow = this.game.moveLog.length;
      this.coachHistory = this.coachHistory.filter(r => r.ply <= plyNow);
      this.updateCoachStats();
      this.coachRevisitAfterUndo();
    }
    // 从结算悔棋：关闭 M2，本局记录标记为「进行中」并保留
    if (wasOver && this.savedGameId) {
      this.autoSavedThisResult = false;
      this.persistRecord(this.buildRecord(false));
    }
    GameContext.closeModal();
  }

  undoFromGameOver() {
    GameContext.closeModal();
    this.doUndo();
  }

  restartToSetup() {
    GameContext.replaceScene('setup', { prefill: { difficulty: this.difficultyKey(), color: this.playerColor } });
  }

  requestLeave() {
    const plies = this.game.getMovesUci().length;
    if (plies >= 1 && !this.game.result && !this.savedGameId) {
      GameContext.openModal('confirm', {
        title: '离开对局', message: '离开将暂存进度，下次可从断点继续；若已手动保存则棋谱保留。',
        buttons: [{ label: '继续对局', action: 'cancel', variant: 'secondary' }, { label: '离开', action: 'confirm', variant: 'danger' }],
        onAction: (act) => {
          GameContext.closeModal();
          if (act === 'confirm') {
            this.saveResumeSnapshot(); // 暂存断点供 onShow M7 询问
            GameContext.emit('navigate', { to: 'menu' }); GameContext.popScene();
          }
        }
      });
    } else {
      GameContext.emit('navigate', { to: 'menu' });
      GameContext.popScene();
    }
  }

  confirmResign() {
    // 远程对弈不支持单方认输（房间协议无 resign 同步能力，避免两端结束态不一致）。
    if (this.mode === 'remote') return;
    GameContext.closeModal();
    GameContext.openModal('confirm', {
      title: '确定认输？', message: '认输后本局将判负，棋谱按设置自动保存。',
      buttons: [{ label: '取消', action: 'cancel', variant: 'secondary' }, { label: '认输', action: 'confirm', variant: 'danger' }],
      onAction: (act) => {
        GameContext.closeModal();
        if (act === 'confirm') {
          const winner = this.mode === 'ai' ? this.aiColor : (this.game.turn === COLOR.WHITE ? COLOR.BLACK : COLOR.WHITE);
          this.game.result = winner === COLOR.WHITE ? 'white_win' : 'black_win';
          this.game.resultReason = 'resign';
          this.onGameOver();
        }
      }
    });
  }

  openRules() {
    GameContext.openModal('confirm', {
      title: '基本规则', height: 220,
      message: '白先黑后。兵直走斜吃、到底线升变；车走横竖、象走斜线、后横竖斜、马走「日」、王每次一格。王车易位与吃过路兵为特殊走法。将死对方王即获胜；逼和、50 回合、三次重复、子力不足为和棋。',
      buttons: [{ label: '知道了', action: 'ok', variant: 'primary' }],
      onAction: () => GameContext.closeModal()
    });
  }

  copyRecord() {
    const san = this.game.moveLog.join(' ');
    try { if (typeof wx !== 'undefined' && wx.setClipboardData) wx.setClipboardData({ data: san || '（暂无着法）' }); } catch (e) { /* noop */ }
    GameContext.showBanner('棋谱已复制到剪贴板', 'success');
  }

  confirmClearAll() {
    const n = GameContext.listRecords().length;
    const msg = n > 0 ? ('删除本机 ' + n + ' 局棋谱？此操作不可恢复。') : '本机暂无棋谱';
    GameContext.openModal('confirm', {
      title: '清空所有棋谱', message: msg,
      buttons: [{ label: '取消', action: 'cancel', variant: 'secondary' }, { label: '清空', action: 'confirm', variant: 'danger' }],
      onAction: (act) => {
        GameContext.closeModal();
        if (act === 'confirm') {
          const okc = GameContext.clearAllRecords();
          GameContext.showBanner(okc === false ? '清空失败' : '已清空所有棋谱', okc === false ? 'danger' : 'success');
        }
      }
    });
  }

  // P1-12：自动覆盖开启前二次确认。当前处于 settingsDrawer 模态中，先 closeModal 再 openModal。
  confirmAutoPrune() {
    GameContext.closeModal();
    GameContext.openModal('confirm', {
      title: '开启自动覆盖？',
      message: '棋谱满 50 局时，每次新增会永久删除本机最早一局，且不可恢复。是否开启？',
      buttons: [{ label: '取消', action: 'cancel', variant: 'secondary' }, { label: '开启', action: 'confirm', variant: 'danger' }],
      onAction: (act) => {
        GameContext.closeModal();
        if (act === 'confirm') {
          const ok = GameContext.saveSettings({ autoPrune: true });
          if (ok === false) GameContext.showBanner('设置未保存，请重试', 'danger');
        }
      }
    });
  }

  // ==================== 远程双人对弈（mode:'remote'） / 手动朝向 ====================

  /**
   * 手动翻转棋盘（「更多」抽屉入口）。
   * 本地 / 人机：把朝向持久化到 defaultOrientation（跨对局 / 跨重启保持），失败时回滚并提示。
   * 远程：仅改内存，不写设置（两端视角独立，且不应改变下次本地双人的默认朝向）。
   */
  toggleBoardFlip() {
    const prev = this.flipBoard;
    this.flipBoard = !this.flipBoard;
    if (this.mode !== 'remote') {
      let ok = true;
      try { ok = GameContext.saveSettings({ defaultOrientation: this.flipBoard ? 'black' : 'white' }); }
      catch (e) { ok = false; }
      if (ok === false) {
        this.flipBoard = prev;   // 设置未落盘 → 回滚朝向，避免视觉与持久化不一致
        try { GameContext.showBanner('方向设置未保存', 'danger'); } catch (e) { /* noop */ }
      }
    }
    GameContext.closeModal();
  }

  /**
   * 把本地最新一步异步推到房间；失败 / 版本冲突时拉取最新文档对齐。
   * 不 await、不阻塞 UI、不改变本地已落子的棋盘。replay 期间（applyingRemote）跳过以抑制回环。
   */
  pushRemoteMove() {
    if (this.applyingRemote) return;   // 远端重放期间不回推（抑制回环）
    if (!room || typeof room.pushMove !== 'function') return;
    let st0;
    try { st0 = this.game.getStatus(); } catch (e) { return; }
    const uci = st0.movesUci[st0.movesUci.length - 1];
    if (!uci) return;
    const result = st0.result || null;   // 与 getStatus().result 语义一致：null / 'white_win' / 'black_win' / 'draw'
    // expectedRev 一律取房间模块状态（唯一权威 rev 源）：joinRoom 后 rev=1、createRoom 后 rev=0，
    // 且 room 内部 rev 会随每次成功 pushMove / watch 去重投递递增。this.remoteRev 仅作展示，不作 CAS 入参。
    let rv = null;
    try { rv = (room && typeof room.getState === 'function') ? room.getState() : null; } catch (e) { rv = null; }
    const expectedRev = (rv && typeof rv.rev === 'number') ? rv.rev : 0;
    let p;
    try { p = room.pushMove(uci, expectedRev, result); } catch (e) { this.onRemoteConflict(); return; }
    if (!p || typeof p.then !== 'function') return;   // 防御：非 Promise 返回
    p.then((r) => {
      if (r && r.ok && r.updated) {
        if (r.doc && typeof r.doc.rev === 'number') this.remoteRev = r.doc.rev;
      } else {
        this.onRemoteConflict();
      }
    }).catch(() => this.onRemoteConflict());
  }

  /** 推送冲突 / 失败：用 room.pollOnce() 走同一套去重投递，自动回调 onRemoteSnapshot 对齐。 */
  onRemoteConflict() {
    if (!room || typeof room.pollOnce !== 'function') return;
    try {
      const p = room.pollOnce();
      if (p && typeof p.catch === 'function') p.catch(() => {});
    } catch (e) { /* watchRoom 兜底 */ }
  }

  /**
   * 房间快照对齐（watchRoom 回调 / 冲突修复共用）。
   * 仅当远端着法更长才重放（避免本地刚落的子被回退、避免回环）；重放期间不推云、不动 flipBoard。
   * 结束态复用 onGameOver()（依赖本地 getStatus().result，两端同一份 movesUci → 一致结果）。
   */
  onRemoteSnapshot(doc) {
    if (!doc || !Array.isArray(doc.movesUci)) return;
    // ===== v5：缓存最新快照 / 对端昵称 / 退出边沿 / 封存解散态 =====
    this.roomDoc = doc;   // 供 update 的墙钟仲裁判定、对端昵称读取使用
    // 对端昵称：host 读 guestNick / guest 读 hostNick；能力防御 + 兜底空串。
    const nick = this.roomRole === 'host' ? doc.guestNick : doc.hostNick;
    if (typeof nick === 'string' && nick) this.remoteOpponentNick = nick;
    // 对端退出状态由「未退出」变「退出」时，重置 prompted 允许新一轮 1 分钟提示。
    const opp = this._opponentLeftInfo(doc);
    if (opp.left && this._prevOppLeft === false) this.arbitrationPrompted = false;
    this._prevOppLeft = opp.left;
    if (doc.status === 'archived' && !this._archivedShown) {
      this._archivedShown = true;
      this.remoteStatus = 'archived';
      try { GameContext.showBanner('残局已封存', 'info'); } catch (e) { /* noop */ }
      // 封存残局不判成绩：以结算态呈现「残局已封存 · 不判成绩」（perspective 由 remoteStatus 决定）。
      if (this.state !== 'GAMEOVER') {
        this.state = 'GAMEOVER'; this._lastOutcome = 'draw'; this.openGameOver();
      }
    } else if (doc.status === 'abandoned' && !this._abandonedShown) {
      this._abandonedShown = true;
      try { GameContext.showBanner('房间已解散', 'info'); } catch (e) { /* noop */ }
    }
    // ===== 以下为原有逻辑（全量重放 / 结束态对齐），保持不变 =====
    this.remoteStatus = doc.status || 'playing';
    if (typeof doc.rev === 'number') this.remoteRev = doc.rev;
    if (doc.movesUci.length > this.game.getStatus().movesUci.length) {
      this.applyingRemote = true;
      try {
        // 房间 movesUci 是「完整历史」；restoreFromMoves 从初始局面整体重放，
        // 故先复位 game / 吃子 / lastMove，避免在当前残局上重复重放导致首步即非法中断。
        this.game = new ChessGame();
        this.captured = { w: [], b: [] };
        this.lastMove = null;
        this.restoreFromMoves(doc.movesUci);
      } finally {
        this.applyingRemote = false;
      }
      // 远端落子不播放本地飞行动画 / 不残留选中态；重放中不改动 flipBoard（远程固定视角）。
      this.anim = null; this.landRing = null;
      this.selected = null; this.legalMoves = [];
      if (this.state !== 'GAMEOVER') this.state = 'IDLE';
    }
    // 结束态：两端基于同一 result 显示一致结束文案；房间 result 优先对齐到引擎后再结算。
    if ((doc.status === 'finished' || doc.result) && this.state !== 'GAMEOVER') {
      const st = this.game.getStatus();
      if (!st.result && doc.result && typeof doc.result === 'string') {
        this.game.result = doc.result;
        if (doc.resultReason) this.game.resultReason = doc.resultReason;
      }
      this.onGameOver();
    }
  }

  /** 连接 / 监听错误：提示 + 轮询兜底，不崩溃。 */
  onRemoteError(reason) {
    const RC = this.roomConfig || {};   // enter 已用 config.ROOM_CONFIG || {} 兜底
    const msg = (typeof RC.offlineText === 'string' && RC.offlineText) ? RC.offlineText : '连接中断，正在重连…';
    try { GameContext.showBanner(msg, 'danger'); } catch (e) { /* noop */ }
    if (room && typeof room.pollOnce === 'function') {
      try {
        const p = room.pollOnce();
        if (p && typeof p.catch === 'function') p.catch(() => { /* noop */ });
      } catch (e) { /* noop */ }
    }
  }

  // ==================== v5 远程退出仲裁 / 按兵力结束 ====================

  /** 由本端角色推导对端退出信息：host 看 guest 侧、guest 看 host 侧；host 恒执白、guest 恒执黑。 */
  _opponentLeftInfo(doc) {
    const d = doc || {};
    const amHost = this.roomRole === 'host';
    const presentKey = amHost ? 'guestPresent' : 'hostPresent';
    const leftAtKey = amHost ? 'guestLeftAt' : 'hostLeftAt';
    const leftAt = (typeof d[leftAtKey] === 'number') ? d[leftAtKey] : 0;
    return {
      role: amHost ? 'guest' : 'host',
      color: amHost ? 'b' : 'w',
      leftAt,
      left: d[presentKey] === false && leftAt > 0
    };
  }

  /**
   * v5 远程退出仲裁状态机（每帧在 update() 调用，仅 remote 且未 GAMEOVER 生效）。
   * 超时一律用墙钟 Date.now()：项目 update(dt) 的帧累加在切后台即停，而「对手已退出」
   * 这一事实只存在于云端快照 roomDoc，本机后台不该停表。
   */
  _updateArbitration() {
    if (this.mode !== 'remote' || this.state === 'GAMEOVER') return;
    const doc = this.roomDoc;
    if (!doc) return;
    // 双方均退出判定：协议层 markLeft() 只写本侧 present/leftAt，不自动检测「两端都退出」，
    // 故本端必须主动调一次 room.markBothLeft() 写出 keepUntil，作为 10 分钟倒计时的起点。
    // 协议层已保证幂等（keepUntil 已存在返回 already_recorded），两端都调无副作用；
    // 本地再加 _bothLeftMarked 去重，避免每帧都发云端 CAS。
    const bothGone = doc.hostPresent === false && doc.guestPresent === false;
    if (bothGone) {
      this.remoteBothLeft = true;
      if (!this._bothLeftMarked) {
        this._bothLeftMarked = true;
        if (room && typeof room.markBothLeft === 'function') {
          try {
            const p = room.markBothLeft();
            if (p && typeof p.catch === 'function') p.catch(() => { /* noop */ });
          } catch (e) { /* 协议层未就绪：降级，不抛 */ }
        }
      }
      // keepUntil 由 markBothLeft 写入后经快照回传才有值；未回传前 HUD 仍显示「双方已离开」。
      const keepUntil = (typeof doc.keepUntil === 'number' && doc.keepUntil > 0) ? doc.keepUntil : 0;
      if (keepUntil) {
        this.remoteAbandonDeadline = keepUntil;
        if (Date.now() > keepUntil && !this._abandonArchived) {
          this._abandonArchived = true;
          this._archiveRemote(false);
        }
      }
      return;
    }
    const opp = this._opponentLeftInfo(doc);
    if (!opp.left) { this.remoteLeft = null; return; }
    this.remoteLeft = { role: opp.role, color: opp.color, at: opp.leftAt, waitingSince: opp.leftAt };
    // 「轮到退出方出棋」：doc.turn（'w'/'b'）映射到退出方执棋色。turn 只用于判断该谁走，不用于胜负归属。
    const turnColor = doc.turn === 'w' || doc.turn === 'white' ? 'w'
      : (doc.turn === 'b' || doc.turn === 'black' ? 'b' : null);
    const leaverToMove = !!turnColor && turnColor === opp.color;
    const timeout = (typeof ROOM_CFG.leaveTimeoutMs === 'number' && ROOM_CFG.leaveTimeoutMs > 0)
      ? ROOM_CFG.leaveTimeoutMs : 60000;
    const elapsed = Date.now() - opp.leftAt;
    // 仅在「轮到退出方 + 超过 1 分钟 + 本轮未提示过 + 弹窗未开」时自动弹仲裁面板。
    if (leaverToMove && elapsed >= timeout && !this.arbitrationPrompted && !this.arbitrationOpen) {
      this.arbitrationPrompted = true;
      this.openArbitrationModal();
    }
  }

  /** 剩余兵力统计：返回双方存活棋子数（含王；升变兵按 1 个棋子计，不区分兵种）。 */
  countMaterial() {
    const board = this.game && this.game.board;
    if (!board || typeof board.getPieces !== 'function') return { w: 0, b: 0 };
    return { w: board.getPieces('w').length, b: board.getPieces('b').length };
  }

  /**
   * 按剩余兵力判定结束对弈：未退出方兵力 >= 退出方 → 未退出方胜，否则平局。
   * 退出方永不可能是 winner（规则的直接推论）。
   * @param {string} stayerColor 未退出方执棋色 'w'|'b'
   * @param {string} leaverColor 退出方执棋色 'w'|'b'
   * @returns {{winner:string|null, reason:string}}
   */
  judgeByMaterial(stayerColor, leaverColor) {
    const m = this.countMaterial();
    const stayer = m[stayerColor] || 0;
    const leaver = m[leaverColor] || 0;
    if (stayer >= leaver) {
      const reason = stayerColor === 'w' ? ROOM_RESULT.materialWhite : ROOM_RESULT.materialBlack;
      return { winner: stayerColor, reason };
    }
    return { winner: null, reason: ROOM_RESULT.draw };
  }

  /** 把云端结算结果写进本地引擎状态（result 为引擎语义 white_win|black_win|draw），供 onGameOver() 复用。 */
  applyRemoteEndResult(result, resultReason) {
    if (!this.game) return;
    if (result && typeof result === 'string') this.game.result = result;
    if (resultReason) this.game.resultReason = resultReason;
  }

  /** 三选项仲裁面板（通用 confirm 模态，由 ModalManager 统一绘制 3 按钮）；超时自动弹 / 常驻入口再开共用。 */
  openArbitrationModal() {
    if (this.mode !== 'remote') return;
    this.arbitrationOpen = true;
    const self = this;
    GameContext.openModal('confirm', {
      title: '对手已离开',
      // 文案刻意压在两行内：375 宽度下再长会把句末「。」挤成孤行（实拍复核发现）。
      message: '对手已离开超过 1 分钟。可继续等待、封存残局，或按剩余兵力结束本局。',
      buttons: [
        { label: '继续等待', action: 'wait', variant: 'primary' },
        { label: '封存残局', action: 'archive', variant: 'secondary' },
        { label: '结束对弈', action: 'finish', variant: 'danger' }
      ],
      onAction: (act) => self.onArbitrationAction(act)
    });
  }

  /** 仲裁面板三个 action 的分发（resolveGeneric 不会自动关闭，此处统一 closeModal）。 */
  onArbitrationAction(act) {
    GameContext.closeModal();
    this.arbitrationOpen = false;
    if (act === 'wait') {
      // 继续等待：不限时；保持 prompted=true 不再自动弹，但常驻入口仍可随时再开。
      this.arbitrationPrompted = true;
      this.arbitrationWaiting = true;
      return;
    }
    if (act === 'archive') { this._archiveRemote(true); return; }
    if (act === 'finish') { this.confirmFinishByMaterial(); }
  }

  /** 封存残局（不判成绩）。云端写 fire-and-forget，本地立即切封存态，协议层未落盘也能降级。 */
  _archiveRemote(withBanner) {
    if (room && typeof room.archiveGame === 'function') {
      try {
        const p = room.archiveGame();
        if (p && typeof p.catch === 'function') p.catch(() => { /* noop */ });
      } catch (e) { /* noop */ }
    }
    this._onArchived(withBanner);
  }
  _onArchived(withBanner) {
    this.remoteStatus = 'archived';
    this._archivedShown = true;   // 避免随后 archived 快照重复弹「残局已封存」
    this.arbitrationPrompted = true;
    this.arbitrationWaiting = false;
    this.arbitrationOpen = false;
    if (withBanner) { try { GameContext.showBanner('残局已封存', 'info'); } catch (e) { /* noop */ } }
    // 结算模态以「残局已封存 · 不判成绩」呈现（不写胜负 result、不调 onGameOver 判成绩）。
    if (this.state !== 'GAMEOVER') {
      this.state = 'GAMEOVER';
      this._lastOutcome = 'draw';
      this.openGameOver();
    }
  }

  /** 「结束对弈」二次确认 → 按剩余兵力判定 → 云端结束 → 本地结算。 */
  confirmFinishByMaterial() {
    const self = this;
    GameContext.closeModal();
    GameContext.openModal('confirm', {
      title: '结束对弈',
      message: '将按剩余兵力自动判定：未退出方兵力不少于退出方即判胜，否则判平局，退出方不会被判胜。确定结束？',
      buttons: [
        { label: '取消', action: 'cancel', variant: 'secondary' },
        { label: '确认结束', action: 'confirm', variant: 'danger' }
      ],
      onAction: (act) => {
        GameContext.closeModal();
        if (act === 'confirm') self.finishByMaterialNow();
      }
    });
  }
  finishByMaterialNow() {
    const opp = this._opponentLeftInfo(this.roomDoc || {});
    const stayerColor = opp.color === 'w' ? 'b' : 'w';
    const j = this.judgeByMaterial(stayerColor, opp.color);
    if (room && typeof room.finishByMaterial === 'function') {
      try {
        const p = room.finishByMaterial(j.winner, j.reason);
        if (p && typeof p.catch === 'function') p.catch(() => { /* noop */ });
      } catch (e) { /* noop */ }
    }
    // 本地结算：把 winner 映射回引擎语义 result（协议层同样会把 winner 映射成 doc.result）。
    const result = j.winner === 'w' ? 'white_win' : j.winner === 'b' ? 'black_win' : 'draw';
    this.applyRemoteEndResult(result, j.reason);
    this.onGameOver();
  }

  /** 双方均退出时房间保留倒计时 mm:ss（基于 keepUntil 墙钟）。 */
  _abandonCountdownText() {
    if (!this.remoteAbandonDeadline) return '--:--';
    const sec = Math.max(0, Math.floor((this.remoteAbandonDeadline - Date.now()) / 1000));
    const mm = Math.floor(sec / 60), ss = sec % 60;
    return (mm < 10 ? '0' + mm : '' + mm) + ':' + (ss < 10 ? '0' + ss : '' + ss);
  }

  // ==================== 坐标换算 ====================
  cellToScreen(row, col) {
    const drawR = this.flipBoard ? 7 - row : row;
    const drawC = this.flipBoard ? 7 - col : col;
    return {
      x: this.boardX + drawC * this.cellSize + this.cellSize / 2,
      y: this.boardY + drawR * this.cellSize + this.cellSize / 2
    };
  }
  screenToBoard(x, y) {
    const tol = 12; // 触控补偿：棋盘外 12pt 内吸附到边缘格
    const bx = x - this.boardX, by = y - this.boardY;
    const bs = this.boardSize;
    if (bx < -tol || by < -tol || bx > bs + tol || by > bs + tol) return null;
    const cx = Math.max(0, Math.min(bs - 0.001, bx));
    const cy = Math.max(0, Math.min(bs - 0.001, by));
    let col = Math.floor(cx / this.cellSize);
    let row = Math.floor(cy / this.cellSize);
    if (this.flipBoard) { row = 7 - row; col = 7 - col; }
    return { row, col };
  }
}

/**
 * v5：退出方「重新加入」兜底入口（房间场景优先用 room.readLocalRoom()）。
 * 读房间模块本地权威态，返回 {roomId, seat, role, color, rev, status} 或 null；
 * 协议层未就绪 / 无本地房间 / 读取抛异常时返回 null，绝不抛异常。
 * 房间场景调用 room.rejoinRoom(roomId, seat) 完成复占后，导航 gameplay 时带 params.rejoin=true。
 */
GameplayScene.rejoinEntry = function () {
  if (!room || typeof room.readLocalRoom !== 'function') return null;
  try {
    const r = room.readLocalRoom();
    if (!r || !r.roomId) return null;
    return r;
  } catch (e) { return null; }
};

module.exports = GameplayScene;
