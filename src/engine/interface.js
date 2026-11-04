'use strict';
/**
 * 棋类引擎契约（多棋类抽象层）
 *
 * 任何棋种适配器（chess / xiangqi / gomoku / go ...）都必须实现下列
 * 方法与属性，经 registry.getGame(id) 返回的实例须满足此契约。
 * 本文件只导出「说明对象」作单一事实来源（文档式契约），无运行时逻辑。
 *
 * 坐标约定：
 *  - 格位统一为 (row, col) 二维数组坐标：move.from = [row, col]。
 *  - row 0 在顶部（黑方底线一侧），row 递增向下；col 0 在左。
 *  - square 网格落于格内（国际象棋），intersection 网格落于交叉点（象棋/围棋/五子棋）。
 *
 * 走法对象：
 *  - { from: [row, col], to: [row, col], promotion?: 'q'|'r'|'b'|'n' }
 *  - promotion 仅出现在有升变规则的棋种（国际象棋），一枚升变兵的 4 种升变
 *    是 4 条独立合法走法。
 */
module.exports = {
  name: 'GameEngineInterface',
  version: 1,

  // ---- 属性 ----
  properties: {
    cols: 'number 棋盘列数（国际象棋 8、象棋 9、五子棋/围棋 15/19）',
    rows: 'number 棋盘行数（国际象棋 8、象棋 10、五子棋/围棋 15/19）',
    gridType: "'square' | 'intersection' — 落子格内还是交叉点"
  },

  // ---- 方法（适配器必须实现）----
  methods: {
    init: {
      sig: 'init(fen: string|null) -> boolean',
      desc: '从 FEN（或棋种等价的局面串）重置为指定局面；fen 为空/缺省时重置为初始局面。解析失败返回 false 且不改动当前局面。'
    },
    getLegalMoves: {
      sig: 'getLegalMoves() -> Array<{from:[r,c], to:[r,c], promotion?}>',
      desc: '当前行棋方全部合法走法（已排除送将/禁手等非法）。升变的每种选择各占一条。'
    },
    applyMove: {
      sig: 'applyMove(move) -> boolean',
      desc: '执行一步合法走法（入参为契约走法对象）。非法返回 false 且局面不变。'
    },
    undo: {
      sig: 'undo() -> boolean',
      desc: '撤销最近一步。无可撤时返回 false。'
    },
    isGameOver: {
      sig: 'isGameOver() -> boolean',
      desc: '对局是否结束（将杀/逼和/超时判负/认输等任一终局态）。'
    },
    getWinner: {
      sig: "getWinner() -> 'w' | 'b' | null",
      desc: "胜方：'w' 白胜 / 'b' 黑胜 / null 和棋或未终局。"
    },
    toFen: {
      sig: 'toFen() -> string',
      desc: '导出当前局面串（国际象棋为标准 6 段 FEN），可被 init() 原样读回。'
    },
    clone: {
      sig: 'clone() -> Engine',
      desc: '深拷贝出独立引擎实例（局面与悔棋历史一致），供 AI 搜索/推演用。'
    },
    getPieceAt: {
      sig: "getPieceAt([r,c]) -> {type, color} | null",
      desc: "取格上棋子：type 为小写棋种字母（国际象棋 p/n/b/r/q/k，象棋/围棋可自定），color 为 'w'|'b'（围棋/五子棋可用 'w'|'b' 表示双方）。空位返回 null。"
    },
    moveToUci: {
      sig: "moveToUci(move) -> string",
      desc: "契约走法对象 → UCI 串。国际象棋 'e2e4'（列 a-h ↔ col 0-7，行 1-8 ↔ row 7-0，row 0=第 8 横线），升变加后缀 'e7e8q'。"
    },
    uciToMove: {
      sig: "uciToMove(str) -> move | null",
      desc: 'UCI 串 → 契约走法对象（纯语法解析，不做合法性校验）。格式非法返回 null。'
    }
  },

  // ---- 给实现者的提示 ----
  notes: [
    'applyMove/getLegalMoves 只走契约走法对象；适配器内部负责与本棋种引擎的走法格式互译。',
    'getWinner 只关心胜负归属，和棋与未终局都返回 null；是否终局用 isGameOver 判定。',
    'toFen/init 必须互逆：init(toFen()) 后局面与走法集合不变。',
    '国际象棋 UCI 坐标换算：row = 8 - 行号数字，col = 列字母 - \'a\'；即 e2 → [6,4]，a8 → [0,0]。'
  ]
};
