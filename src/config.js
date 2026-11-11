/**
 * 全局配置 · 悦己品牌视觉系统 v2 · 三层架构
 *
 * 约定：微信小游戏原生 / Canvas 2D / 纯 JS(CommonJS) / 无 DOM·CSS·SVG / 无 eval / 无 window·document。
 *
 * 三层分离（BRAND.md §4 / §7，v2 任务 1）：
 *   BRAND 层    跨产品固定：冷墨底 / 黄铜强调 / 表面阶差 / 文字阶差 / 字号阶梯 / 圆角 / 动效基调
 *   SEMANTIC 层 跨产品固定：success/warning/danger/info/neutral 语义色含义与色值
 *   GAME 层     单棋种可变：棋盘深浅格 / 棋子色 / 皮肤名 / 格数（切棋种只换这一层映射表）
 *
 * 【向后兼容（关键门禁）】现有 7 场景重度依赖扁平导出，以下全部保持原样可用：
 *   COLORS(41 键含旧别名) / FONTS / RADIUS / MOTION / ELEVATION / BOARD /
 *   SPACING / LINE_HEIGHT / touchMin / gutter / BOARD_SIZE / AI_DEPTH /
 *   STORAGE_KEYS / LIMITS / DEFAULT_SETTINGS / LIGHT_COLORS / ACTIVE_THEME /
 *   getBoardMetrics / getFontScale
 *   COLORS 由「BRAND + SEMANTIC + 当前 GAME(chess)」合成，键值与 v1 完全一致（零改动）。
 *   新增：BRAND / SEMANTIC / GAME_SKINS / getGameSkin(gameId)。
 *
 * 权威来源：BRAND.md §4/§5/§7（冲突以此为准）；V2_VISUAL_SPEC.md §4/§5。
 */
'use strict';

// ===========================================================================
// BRAND 层 —— 跨产品固定（BRAND.md §4.2 / §2.2 / §3 / §6）
// 任何棋种不得改动其「角色定义」。此层色值/字号/圆角/动效基调全产品统一。
// ===========================================================================
const BRAND = {
  // 品牌常量色（不含语义色与棋种特色色）
  COLORS: {
    bgBase: '#10151B',
    bgElev: '#171E27',
    surface1: '#1F2833',
    surface2: '#28333F',
    surface3: '#33404E',
    border: '#3B4A5A',
    borderStrong: '#4E6072',
    accent: '#C9A24B',
    accentSoft: '#E0C078',
    accentDeep: '#8C6E2F',
    accentFade: 'rgba(201,162,75,.14)',
    accentLine: 'rgba(201,162,75,.22)',
    petrol: '#4C625D',
    petrolBright: '#6FB0A4',
    petrolDeep: '#33443F',
    boardFrame: '#2A2118',
    // 棋子描边 —— 跨棋种硬底线（BRAND.md §5「棋子描边」），GAME 层只能覆盖、不可丢弃。
    // 白棋描边 #2A2A28：白填充与浅格对比仅≈1.1:1，全靠描边保轮廓。
    // 黑棋金边 #C9A24B：本案签名细节；黑填充与深格对比≈2.5:1，靠金边区分。
    pieceWhiteStroke: '#2A2A28',
    pieceBlackStroke: '#C9A24B',
    textPrimary: '#EDE6D6',
    textSecondary: '#9AA7B4',
    textTertiary: '#6B7885',
    textOnAccent: '#1A1408',
    overlay: 'rgba(6,9,13,.66)',
    // 淡色与禁用前景（v2 增量，供 badge/淡底/禁用态使用）
    dangerFade: 'rgba(217,106,106,.16)',
    blackFade: 'rgba(0,0,0,.10)',
    neutralBadgeFade: 'rgba(154,167,180,.16)',
    successFade: 'rgba(111,185,143,.16)',
    infoFade: 'rgba(90,166,201,.16)',
    bgFade: 'rgba(16,21,27,.10)',
    disabledFg: '#7E8A96'              // 禁用态文字前景（surface 上 ≥3:1，替代 tertiary 落 surface）
  },
  // 字号阶梯（跨产品固定，pt，基准 375 宽）
  FONTS: {
    display: 'bold 44px serif',
    h1: 'bold 28px sans-serif',
    h2: 'bold 22px sans-serif',
    subtitle: '20px sans-serif',
    body: '16px sans-serif',
    caption: '13px sans-serif',
    micro: 'bold 11px sans-serif',
    san: '15px serif',
    button: 'bold 17px sans-serif',
    piece: 'serif',                 // 使用时需前缀 fontSize：`${size}px ${FONTS.piece}`
    coordinate: 'bold 11px sans-serif',
    watermark: '96px serif',           // 菜单背景水印 ♞（装饰，低透明度）
    emptyGlyph: '64px serif',          // 空状态大字形 ♟（装饰，低透明度）
    placeholder: '28px sans-serif',    // 未解锁卡占位「?」
    pieceGlyphMd: '18px serif',        // 头像内棋子字形
    pieceGlyphSm: '13px serif',        // 吃子区棋子字形
    // 粗体 / 特用字号变体（v2 增量，与上面命名一致）
    bodyB: 'bold 16px sans-serif',
    captionB: 'bold 13px sans-serif',
    subtitleB: 'bold 20px sans-serif',
    h2B: 'bold 22px sans-serif',
    microB: 'bold 11px sans-serif',
    check: 'bold 14px sans-serif'      // ✓ 勾选字形
  },
  LINE_HEIGHT: { display: 50, h1: 34, h2: 28, subtitle: 27, body: 24, caption: 19, micro: 14, san: 21 },
  SPACING: { xs: 4, sm: 8, md: 12, lg: 16, xl: 20, xxl: 24, xxxl: 32 },
  RADIUS: { chip: 4, sm: 8, btn: 12, card: 16, modal: 20, pill: 999 },
  MOTION: {
    tap: 90, recover: 120, select: 140,
    hint: 120, hintStagger: 20,
    move: 180, land: 90, capture: 160,
    lastMove: 120, checkPulse: 300,
    transition: 240, progress: 240,
    bannerIn: 200, bannerStay: 2000, bannerOut: 200,
    // fe-logic 场景层别名（v1 已落地，纯增量）
    bannerHold: 2000,      // == bannerStay
    replayStep: 800,       // 回放自动步进间隔
    replayStepReduce: 500, // reduceMotion 时回放步进间隔
    modalGuard: 200        // 弹窗防误触时长（C12）
  },
  ELEVATION: {
    e1: { color: 'rgba(0,0,0,.35)', blur: 8, offsetY: 2 },
    e2: { color: 'rgba(0,0,0,.50)', blur: 18, offsetY: 8 },
    hairline: 'rgba(201,162,75,.22)'
  },
  gutter: 16,
  touchMin: 44,
  // 克制边界（BRAND.md §6，供场景层/终审读取，非渲染硬依赖）
  RESTRAINT: {
    maxPrimaryPerScreen: 1,       // 单屏强调按钮 ≤1
    maxLoopAnimPerScreen: 1,      // 脉冲/呼吸循环动效 ≤1
    maxConcurrentAnim: 2,         // 同屏并发动效元素 ≤2
    redDotMaxPerPage: 2,          // 红点 ≤1–2
    allowLoopBgm: false,          // 禁循环 BGM
    allowBounce: false,           // 禁回弹
    allowConfetti: false          // 禁撒花彩带
  }
};

// ===========================================================================
// SEMANTIC 层 —— 功能语义色（BRAND.md §4.3，跨产品固定含义与色值）
// 五子棋不得把 success 用于「失败」，围棋不得把 danger 用于「胜利」。
// ===========================================================================
const SEMANTIC = {
  COLORS: {
    success: '#6FB98F',
    warning: '#E0A23C',
    danger: '#D96A6A',
    info: '#5AA6C9',
    neutralBadge: '#9AA7B4',

    // ---------------------------------------------------------------------
    // 棋盘六态语义色（Phase 2·5 重排）
    // 旧实现把「选中 / 可走 / 可吃 / 系统建议」全塞进黄铜 accent 系
    // （rgba(201,162,75,x)），四态只能靠透明度区分，小屏基本不可辨。
    // 本表按「色相 + 形状」双编码重排，黄铜退回去只做品牌装饰（发丝线/外框）。
    // 对比度护栏：棋盘两色 #EDE6D6(浅) / #4C625D(深) 均为中间明度，
    // 单一色相不可能同时达标，故每个标记都带一圈「自适应衬线」（见 *_Casing）：
    //   浅格用暗衬 → 象牙/青玉可辨；深格用亮衬 → 酒红可辨。
    // ---------------------------------------------------------------------
    hlSelectedRing: '#F5EEDA',              // 选中：象牙内环（inset ring，不做满格填充）
    hlSelectedCasing: 'rgba(26,20,14,.55)', // 象牙环在浅格的暗衬线（1.1:1 → ≥3:1）
    hlLegalDot: '#FBF6E8',                  // 合法空格：象牙实心小圆点
    hlCaptureRing: '#8E3B4E',               // 合法吃子：酒红空心环
    hlCaptureCasing: 'rgba(247,240,221,.45)', // 酒红环在深格的亮衬线（1.3:1 → ≥3:1）
    hlLastMove: 'rgba(224,192,120,.24)',    // 上一步：暖色半透明底（绘制在棋子之下，不遮挡）
    hlLastMoveEdge: 'rgba(240,214,150,.70)',// 上一步起点格竖条（形状编码，色弱兜底）
    hlHintJade: '#60C6AF',                  // 系统建议（教练/锦囊）：青玉，深格 3.3:1，禁金
    hlHintCasing: 'rgba(10,16,14,.45)',     // 青玉在浅格仅 1.8:1 → 暗衬线
    hlCheck: 'rgba(217,106,106,.75)',       // 将军：红色径向脉冲
    // 外框刻度带文字（木框深底 #2A2118 上 ≈7:1）
    coordBand: 'rgba(237,230,214,.72)',
    coordBandActive: '#F5EEDA',
    // 旧键保留（ui.js 图例、drawMiniBoard、drawBoardGeneric 仍在读），值改指新色板：
    hlSelected: 'rgba(245,238,218,.10)',    // 旧满格 tint → 收敛为极淡象牙底（仅通用棋盘兜底）
    hlLegal: '#FBF6E8',
    hlCapture: '#A9506A'
  },
  // 语义 → 形状编码提示（供渲染层双重编码，BRAND.md §5）
  SHAPE: {
    success: 'check', danger: 'ring', warning: 'label', info: 'badge', neutralBadge: 'badge',
    hlLastMove: 'warmTint', hlSelected: 'insetRingIvory', hlLegal: 'solidDotIvory',
    hlCapture: 'hollowRingWine', hlHint: 'dashedJadeArrow', hlCheck: 'radialPulse',
    reveal: 'goldRing'
  }
};

// ===========================================================================
// GAME 层 —— 单棋种特色层（BRAND.md §4.4 / V2_VISUAL_SPEC §5）
// 只允许改：board.light/dark、piece.*、skin.name、格数/落点/棋子样式。
// 首发 chess；其余棋种为「视觉占位」（规则不在本期实现），需过对比度门槛。
// ===========================================================================
const GAME_SKINS = {
  chess: {
    id: 'chess',
    skinName: '墨金棋院',
    grid: { cols: 8, rows: 8, type: 'square' },   // type: square(格心) | intersection(线交点) | lines
    coordMode: 'cell',
    coordLabel: function (row, col) { return 'abcdefgh'[col] + (8 - row); },
    boardLight: '#EDE6D6',
    boardDark: '#4C625D',
    coordOnLight: '#4C625D',
    coordOnDark: '#EDE6D6',
    pieceStyle: 'unicode',
    pieceSizeRatio: 0.70,          // 字体系数 = cell × ratio
    PIECE: {
      whiteFill: '#F7F1E3', whiteShade: '#DDD3BC', whiteStroke: '#2A2A28',
      blackFill: '#38434E', blackShade: '#10151B', blackStroke: '#C9A24B'
    }
  },
  xiangqi: {
    id: 'xiangqi', skinName: '楚河汉界',
    grid: { cols: 9, rows: 10, type: 'intersection' },
    coordMode: 'intersection', coordLabel: null,
    boardLight: '#F0E4CC', boardDark: '#8A6A3E',
    coordOnLight: '#8A6A3E', coordOnDark: '#F0E4CC',
    pieceStyle: 'disc-char', pieceSizeRatio: 0.62,   // 汉字圆子 cell×0.62
    // 圆子描边沿用品牌底线（红黑两色棋子均需深边保轮廓）；discStroke 为外圈金线质感。
    PIECE: {
      redFill: '#C0392B', blackFill: '#2A2A28',
      whiteStroke: '#2A2A28', blackStroke: '#C9A24B',
      discStroke: '#8C6E2F'
    }
  },
  gomoku: {
    id: 'gomoku', skinName: '黑白之间',
    grid: { cols: 15, rows: 15, type: 'intersection' },
    coordMode: 'intersection', coordLabel: null,
    boardLight: '#E7D9BC', boardDark: null,         // 无深格
    coordOnLight: '#4C625D', coordOnDark: '#EDE6D6',
    pieceStyle: 'stone', pieceRadiusRatio: 0.44,    // 圆子 半径=cell×0.44
    // 圆子描边：白子需深边保轮廓（浅木底上白子≈1.1:1），黑子沿用金边签名细节。
    PIECE: {
      blackFill: '#1A1A1A', whiteFill: '#F7F1E3',
      whiteStroke: '#2A2A28', blackStroke: '#C9A24B'
    }
  },
  go: {
    id: 'go', skinName: '云子松风',
    grid: { cols: 19, rows: 19, type: 'intersection' },
    coordMode: 'intersection', coordLabel: null,
    boardLight: '#E3C88F', boardDark: null,
    coordOnLight: '#4C625D', coordOnDark: '#EDE6D6',
    pieceStyle: 'stone', pieceRadiusRatio: 0.44,
    starPoints: [3, 9, 15],                          // 19 路星位行列索引
    PIECE: {
      blackFill: '#1A1A1A', whiteFill: '#F7F1E3',
      whiteStroke: '#2A2A28', blackStroke: '#C9A24B'
    }
  }
};

// GAME 层顶层导出（三层契约 BRAND/SEMANTIC/GAME 均可访问）：
// 以 gameId 为键的单棋种可变皮肤映射表，至少含 chess；GAME_SKINS 为同一对象的兼容别名。
const GAME = GAME_SKINS;

/** 当前启用的棋种（本期固定 chess）。切棋种只换 GAME 层映射表，渲染层不感知。 */
let ACTIVE_GAME = 'chess';

/**
 * 取棋种皮肤（默认 chess）。返回 GAME 层映射表（含 grid/色值/棋子样式），
 * 未登记 gameId 一律回退 chess，绝不返回 undefined 导致渲染崩溃。
 */
function getGameSkin(gameId) {
  return GAME[gameId] || GAME.chess;
}

/** 合成某棋种的完整色板（BRAND + SEMANTIC + GAME），供通用渲染器按棋种取色。 */
function getGameColors(gameId) {
  var skin = getGameSkin(gameId);
  var out = {};
  var k;
  for (k in BRAND.COLORS) if (BRAND.COLORS.hasOwnProperty(k)) out[k] = BRAND.COLORS[k];
  for (k in SEMANTIC.COLORS) if (SEMANTIC.COLORS.hasOwnProperty(k)) out[k] = SEMANTIC.COLORS[k];
  // GAME 层覆盖：棋盘深浅格 + 坐标色 + 棋子色（扁平键，等价现有 COLORS 命名）
  out.boardLight = skin.boardLight;
  out.boardDark = skin.boardDark;
  out.coordOnLight = skin.coordOnLight;
  out.coordOnDark = skin.coordOnDark;
  if (skin.PIECE) {
    if (skin.PIECE.whiteFill) out.pieceWhiteFill = skin.PIECE.whiteFill;
    if (skin.PIECE.whiteShade) out.pieceWhiteShade = skin.PIECE.whiteShade;
    if (skin.PIECE.blackFill) out.pieceBlackFill = skin.PIECE.blackFill;
    if (skin.PIECE.blackShade) out.pieceBlackShade = skin.PIECE.blackShade;
    // 棋子描边属「跨棋种可访问性底线」，已提升到 BRAND 层（不可被 GAME 丢弃）。
    // GAME 层若显式给出描边则允许覆盖（如中国象棋 disc-char 的深边），但缺省一律回落到 BRAND 常量，
    // 杜绝换棋种时 pieceWhiteStroke/pieceBlackStroke 变 undefined 导致棋子描边消失（VISUAL_AUDIT §8.2 硬底线）。
    out.pieceWhiteStroke = skin.PIECE.whiteStroke || BRAND.COLORS.pieceWhiteStroke;
    out.pieceBlackStroke = skin.PIECE.blackStroke || BRAND.COLORS.pieceBlackStroke;
  }
  return out;
}

// ===========================================================================
// 兼容扁平导出 —— 由「BRAND + SEMANTIC + chess GAME」合成
// 键值与 v1 逐字一致（终审门禁：COLORS 41 键、FONTS 键值零误差）。
// ===========================================================================
const COLORS = getGameColors('chess');

const FONTS = BRAND.FONTS;
const LINE_HEIGHT = BRAND.LINE_HEIGHT;
const SPACING = BRAND.SPACING;
const RADIUS = BRAND.RADIUS;
const MOTION = BRAND.MOTION;
const ELEVATION = BRAND.ELEVATION;
const gutter = BRAND.gutter;
const touchMin = BRAND.touchMin;

const BOARD_SIZE = 8;
const AI_DEPTH = { easy: 2, medium: 3, hard: 4 };

// 棋盘 §11.3 / 补遗 §B：系数 min(W*.92, H*.55)，真居中，坐标入格。
// 双套键名并存：widthRatio/heightRatio/frame（权威）；maxWidthRatio/maxHeightRatio/minCell（fe-logic 别名）。
const BOARD = {
  widthRatio: 0.92, heightRatio: 0.55, frame: 10,
  maxWidthRatio: 0.92, maxHeightRatio: 0.55, minCell: 38
};

// 浅色皮肤预留映射（§4.7；C9：本期不启用）。黄铜作浅皮肤文字色须换 accentDeep。
const LIGHT_COLORS = {
  bgBase: '#F3EFE6', bgElev: '#FFFFFF', surface1: '#FFFFFF', surface2: '#EAE4D8',
  surface3: '#DAD3C4', textPrimary: '#232A2E', textSecondary: '#5C666A',
  textTertiary: '#8A9296', accentText: '#8C6E2F', boardLight: '#FBF7EE', boardDark: '#8FA9A1'
};
const ACTIVE_THEME = 'dark';

// 存储键与容量（UX §3.3.2 / §8.1；v2 追加残局键 V2_UX_SPEC §1.8）
const STORAGE_KEYS = {
  settings: 'chess.settings.v1',
  tutorial: 'chess.tutorial.v1',
  lastConfig: 'chess.config.last.v1',
  recordsIndex: 'chess.records.index.v1',
  recordPrefix: 'chess.record.v1.',
  resume: 'chess.resume.v1',
  endgame: 'chess.endgame.v1',               // 残局闯关进度（v2 §1.8）
  endgameResume: 'chess.endgame.resume.v1',  // 残局断点快照（v2 §1.8，可选 P1）
  // 云端 KV 镜像 / 隐私（v3；字面值固定，其他 worker 依赖，禁止改名）
  privacy: 'chess.privacy.v1',
  profile: 'chess.profile.v1',
  syncMeta: 'chess.sync.meta.v1',
  syncQueue: 'chess.sync.queue.v1',
  // 远程房间：仅记录本地 seat/roomId 断点（room.js 直接 wx.setStorageSync，绝不经过 storage 写 hook）
  room: 'chess.room.v1',
  // 封存残局本地索引（大写 A → 不匹配 sync.js 的 KEY_RE → 天然不被云端镜像进 chess_records）
  roomArchive: 'chess.roomArchive.v1',
  // 房主建房前的局数草稿（大写 D → 不匹配 sync.js 的 KEY_RE → 天然不被云端镜像）
  roomDraft: 'chess.roomDraft.v1'
};
const LIMITS = { maxRecords: 50, maxPlies: 400, maxSkills: 8 };

// ---------------------------------------------------------------------------
// 云端 KV 镜像配置（v3 · 默认关闭）
// 仅在「部署开关 enabled=true 且填入 env」时整条云链路才激活；能力探测失败
// （如 Node 回归无 wx.cloud）同样静默降级，六套回归全绿。零云函数、零 npm，
// 只用 wx.cloud.database() 前端直连 + 集合安全规则（_openid 由平台注入）。
// ---------------------------------------------------------------------------
const CLOUD_CONFIG = {
  enabled: true,           // 部署开关；env 已填（freedom-land-d4gv0gs78c0dd7b2f），开启云端链路
  env: 'freedom-land-d4gv0gs78c0dd7b2f', // 云环境 ID（微信云开发，绑定 AppID wx5a78cb07bad9cf59）
  collections: { state: 'chess_state', records: 'chess_records', rooms: 'chess_rooms' },
  schemaVersion: 1,
  debounceMs: 600,
  maxRetries: 3,
  retryBaseMs: 1200,
  maxValueBytes: 64 * 1024,      // 单 key value 硬上限
  maxBatchBytes: 400 * 1024,     // 整批 < 前端 512KB 上限
  tombstoneDays: 90,
  pullOnShow: true
};

// ---------------------------------------------------------------------------
// 远程双人对弈 · 房间配置（v4 · 独立云端通道）
// 与 CLOUD_CONFIG 的 KV 镜像完全解耦：chess_rooms 集合走 room.js 独立读写，
// 不经过 storage 的 28 个 API / 写 hook / sync.js 的 pendingQueue。
// 房间码为 6 位数字，分享链接即凭证：10^6 组合 + expireAt 6h 过期 +
// idx_roomId 唯一索引 + rev CAS 保证好友对弈一致（好友邀请场景熵足够）。
// ---------------------------------------------------------------------------
const ROOM_CONFIG = {
  codeLen: 6,               // 房间码长度（6 位纯数字）
  codeAlphabet: '0123456789', // 6 位纯数字，供 Canvas 自绘数字键盘输入（保留前导零）
  seatLen: 16,
  pollIntervalMs: 2500,     // watch 兜底轮询间隔
  watchGuardMs: 8000,       // watch 静默超过此时长触发兜底轮询
  expireMs: 6 * 60 * 60 * 1000, // 房间 6h 过期
  maxMoves: 400,            // 与 LIMITS.maxPlies 对齐
  maxRetries: 3,            // CAS 冲突 / 房间码碰撞重试上限
  schemaVersion: 1,
  // ---- v5：退出仲裁 / 封存残局 / 多局比分 / 在线心跳 ----
  maxGamesDefault: 0,        // 房主未设置局数时 = 无限模式（0 表示不限）
  leaveTimeoutMs: 60000,     // 退出方轮到出棋后，未退出方可发起仲裁的等待时长（1 分钟）
  bothLeftKeepMs: 600000,    // 双方均退出后房间保留时长（10 分钟），超时自动解散
  archiveKeepMs: 604800000,  // 封存残局保留时长（7 天）
  presenceTimeoutMs: 45000,  // 心跳判定对方掉线的阈值（45s）
  presenceIntervalMs: 10000, // 本端心跳上报间隔（10s）
  nickMaxLen: 12             // 昵称最大长度（与 settings.js 的 cleanNickname 一致）
};

// ---------------------------------------------------------------------------
// 房间结算结果枚举（v5）
// 场景层判断胜负一律读本枚举，禁止在场景里裸写字符串。
// materialWhite/materialBlack = 按剩余兵力判定；abandoned = 双方均退出自动解散；
// archived = 封存残局（不判成绩）；resignWhite/resignBlack = 认输。
// ---------------------------------------------------------------------------
const ROOM_RESULT = {
  materialWhite: 'material_white_win',
  materialBlack: 'material_black_win',
  draw: 'draw',
  abandoned: 'abandoned',
  archived: 'archived',
  resignWhite: 'resign_white',
  resignBlack: 'resign_black'
};

const DEFAULT_SETTINGS = {
  version: 1,
  soundEnabled: true,
  reduceMotion: false,
  fontSize: 'standard',        // 'standard' | 'large'
  showLegalMoves: true,
  showCoordinates: true,
  defaultColor: 'w',
  defaultOrientation: 'white', // 'white' | 'black'
  skipSetup: false,
  autoSaveGame: true,
  autoPrune: false,
  theme: 'dark'
};

// ---------------------------------------------------------------------------
// 向下兼容别名（transitional）：旧场景仍可能引用旧键。全部映射到新值。
// ---------------------------------------------------------------------------
const _aliases = {
  bg: 'bgBase', panel: 'surface1', panelLight: 'surface2',
  buttonPrimary: 'accent', buttonSecondary: 'surface2',
  buttonDanger: 'danger', buttonSuccess: 'success',
  text: 'textPrimary', textDim: 'textSecondary', textDark: 'textOnAccent',
  whitePiece: 'pieceWhiteFill', blackPiece: 'pieceBlackFill',
  whitePieceStroke: 'pieceWhiteStroke', blackPieceStroke: 'pieceBlackStroke',
  highlight: 'hlLegal', lastMove: 'hlLastMove', check: 'hlCheck',
  selected: 'hlSelected', legalMove: 'hlLegal', legalCapture: 'hlCapture',
  coordinateLight: 'coordOnLight', coordinateDark: 'coordOnDark'
};
Object.keys(_aliases).forEach(function (k) {
  if (COLORS[k] === undefined) COLORS[k] = COLORS[_aliases[k]];
});
FONTS.title = FONTS.display;   // 旧字体键（新表已无）
FONTS.small = FONTS.caption;
FONTS.overline = FONTS.micro;  // manager.js FONT_FALLBACK 用到 overline

// ---------------------------------------------------------------------------
// 工具函数
// ---------------------------------------------------------------------------
/** 计算棋盘布局（补遗 §B 最终公式）。返回 cellSize/boardSize/boardX（真居中，无 +14）。 */
function getBoardMetrics(W, H) {
  const w = (typeof W === 'number' && W > 0) ? W : 375;
  const h = (typeof H === 'number' && H > 0) ? H : 667;
  const maxSize = Math.min(w * BOARD.widthRatio, h * BOARD.heightRatio);
  const cellSize = Math.max(24, Math.floor(maxSize / BOARD_SIZE));
  const boardSize = cellSize * BOARD_SIZE;
  const boardX = Math.floor((w - boardSize) / 2);
  return { cellSize: cellSize, boardSize: boardSize, boardX: boardX };
}

/** 系统字号缩放系数：ratio = clamp(fontSizeSetting/16, 1, 1.25)；无 wx 安全返回 1。 */
function getFontScale() {
  try {
    if (typeof wx !== 'undefined' && wx.getSystemInfoSync) {
      const s = wx.getSystemInfoSync().fontSizeSetting;
      if (typeof s === 'number' && s > 0) return Math.max(1, Math.min(1.25, s / 16));
    }
  } catch (e) { /* 静默降级 */ }
  return 1;
}

module.exports = {
  // v1 兼容扁平导出（关键门禁，全部保留）
  BOARD_SIZE: BOARD_SIZE,
  AI_DEPTH: AI_DEPTH,
  SPACING: SPACING,
  gutter: gutter,
  touchMin: touchMin,
  RADIUS: RADIUS,
  BOARD: BOARD,
  MOTION: MOTION,
  ELEVATION: ELEVATION,
  FONTS: FONTS,
  LINE_HEIGHT: LINE_HEIGHT,
  COLORS: COLORS,
  LIGHT_COLORS: LIGHT_COLORS,
  ACTIVE_THEME: ACTIVE_THEME,
  STORAGE_KEYS: STORAGE_KEYS,
  LIMITS: LIMITS,
  DEFAULT_SETTINGS: DEFAULT_SETTINGS,
  getBoardMetrics: getBoardMetrics,
  getFontScale: getFontScale,
  // v2 三层架构新增
  BRAND: BRAND,
  SEMANTIC: SEMANTIC,
  GAME: GAME,               // 三层契约顶层导出（以 gameId 为键的皮肤映射表）
  GAME_SKINS: GAME_SKINS,   // 同上对象（兼容别名）
  getGameSkin: getGameSkin,
  getGameColors: getGameColors,
  getActiveGame: function () { return ACTIVE_GAME; },
  setActiveGame: function (gameId) {
    if (typeof gameId === 'string' && GAME_SKINS[gameId]) ACTIVE_GAME = gameId;
    return ACTIVE_GAME;
  },
  // v3 云端 KV 镜像
  CLOUD_CONFIG: CLOUD_CONFIG,
  // v4 远程双人对弈 · 房间配置
  ROOM_CONFIG: ROOM_CONFIG,
  // v5 房间结算结果枚举（场景层禁止裸写字符串）
  ROOM_RESULT: ROOM_RESULT
};
