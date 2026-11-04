/**
 * 残局闯关数据（100 阵）+ 妙招文案库 + 技能定义表
 *
 * 由 tools/gen100.js 生成：每阵均经 test-endgame.js 的 findMateLine 验证，
 * 存在 targetMoves 步内的「强制将杀」（depth 与 theme 标注一致）。
 * 主题取自经典杀法名录（底线杀 / 闷宫 / 阿拉伯 / 双车错 / 升变 / 双象 / 象马 …）。
 *
 * 字段：id/name/fen/sideToMove/targetMoves/moveCap/timeLimitSec/difficulty/
 *       theme/tipId/skillWeights/intro/coachHints
 */
'use strict';

const ENDGAMES = [
  {
    "id": "EG-01",
    "name": "车沉底线",
    "fen": "6k1/5ppp/8/8/1R6/1K6/8/8 w - - 0 1",
    "sideToMove": "w",
    "targetMoves": 1,
    "moveCap": 5,
    "timeLimitSec": 45,
    "difficulty": 1,
    "theme": "mate-in-1·底线杀",
    "tipId": "tip_backrank",
    "skillWeights": {
      "common": 100,
      "rare": 0,
      "epic": 0
    },
    "intro": "黑王被自己的兵困在底线，一车沉底就是绝杀。",
    "coachHints": [
      "车走到第 8 横线就是绝杀",
      "先数一遍黑王还能往哪走"
    ]
  },
  {
    "id": "EG-02",
    "name": "后贴金身",
    "fen": "k7/8/2K5/8/1Q6/8/8/8 w - - 0 1",
    "sideToMove": "w",
    "targetMoves": 1,
    "moveCap": 5,
    "timeLimitSec": 45,
    "difficulty": 1,
    "theme": "mate-in-1·贴身闷杀",
    "tipId": "tip_queenmate",
    "skillWeights": {
      "common": 100,
      "rare": 0,
      "epic": 0
    },
    "intro": "后贴住敌王、自有王来护，闷杀就此成局。",
    "coachHints": [
      "把后送到能贴住黑王的位置",
      "别忘了白王要护住这枚后"
    ]
  },
  {
    "id": "EG-03",
    "name": "双车合围",
    "fen": "8/8/8/k1K4R/8/7R/8/8 w - - 0 1",
    "sideToMove": "w",
    "targetMoves": 1,
    "moveCap": 5,
    "timeLimitSec": 45,
    "difficulty": 1,
    "theme": "mate-in-1·双车错",
    "tipId": "tip_tworooks",
    "skillWeights": {
      "common": 100,
      "rare": 0,
      "epic": 0
    },
    "intro": "双车错开两条横线，一层层把黑王逼到边角。",
    "coachHints": [
      "先用一车占住一条横线",
      "两车错开，黑王无处可钻"
    ]
  },
  {
    "id": "EG-04",
    "name": "单车擒王",
    "fen": "8/8/8/2R5/8/6K1/8/7k w - - 0 1",
    "sideToMove": "w",
    "targetMoves": 1,
    "moveCap": 5,
    "timeLimitSec": 45,
    "difficulty": 1,
    "theme": "mate-in-1·车王逼宫",
    "tipId": "tip_rookking",
    "skillWeights": {
      "common": 100,
      "rare": 0,
      "epic": 0
    },
    "intro": "单车配王，把黑王一步步赶向边线。",
    "coachHints": [
      "白王要跟着推进，别离太远",
      "先把黑王赶到边线"
    ]
  },
  {
    "id": "EG-05",
    "name": "闷宫绝杀",
    "fen": "k7/pn3K2/8/8/6Q1/8/8/8 w - - 0 1",
    "sideToMove": "w",
    "targetMoves": 1,
    "moveCap": 5,
    "timeLimitSec": 45,
    "difficulty": 1,
    "theme": "mate-in-1·闷宫绝杀",
    "tipId": "tip_smother",
    "skillWeights": {
      "common": 100,
      "rare": 0,
      "epic": 0
    },
    "intro": "黑王被自己的子闷住，一记闷宫就够了。",
    "coachHints": [
      "数清黑王身边还剩几个空位",
      "把子塞进唯一的空位就是闷杀"
    ]
  },
  {
    "id": "EG-06",
    "name": "弃子引离",
    "fen": "K7/8/1R6/8/8/kp4Q1/8/8 w - - 0 1",
    "sideToMove": "w",
    "targetMoves": 1,
    "moveCap": 5,
    "timeLimitSec": 45,
    "difficulty": 1,
    "theme": "mate-in-1·弃子引离",
    "tipId": "tip_decoy",
    "skillWeights": {
      "common": 100,
      "rare": 0,
      "epic": 0
    },
    "intro": "弃一个子把护王的兵引开，底线就空了。",
    "coachHints": [
      "先想清楚哪枚子是可以不要的",
      "引开护王之子后再动手"
    ]
  },
  {
    "id": "EG-07",
    "name": "牵制闪击",
    "fen": "6K1/8/8/k7/n7/8/4Q3/1Q6 w - - 0 1",
    "sideToMove": "w",
    "targetMoves": 1,
    "moveCap": 5,
    "timeLimitSec": 45,
    "difficulty": 1,
    "theme": "mate-in-1·牵制闪击",
    "tipId": "tip_pin",
    "skillWeights": {
      "common": 100,
      "rare": 0,
      "epic": 0
    },
    "intro": "牵住对方的子再闪击，暴露的火力才是杀招。",
    "coachHints": [
      "先牵制，再算闪击的落点",
      "白王别脱离防线"
    ]
  },
  {
    "id": "EG-08",
    "name": "马跃金钩",
    "fen": "7k/8/8/6N1/4Q3/8/4K3/8 w - - 0 1",
    "sideToMove": "w",
    "targetMoves": 1,
    "moveCap": 5,
    "timeLimitSec": 45,
    "difficulty": 1,
    "theme": "mate-in-1·马后炮",
    "tipId": "tip_knightqueen",
    "skillWeights": {
      "common": 100,
      "rare": 0,
      "epic": 0
    },
    "intro": "马跳金钩直取将位，顺手还能抽走黑方的子。",
    "coachHints": [
      "马有两个落点能将军，先挑能抽子的",
      "马一离开，注意黑王逃格"
    ]
  },
  {
    "id": "EG-09",
    "name": "阿拉伯杀",
    "fen": "6k1/8/2N3K1/8/8/8/8/4R3 w - - 0 1",
    "sideToMove": "w",
    "targetMoves": 1,
    "moveCap": 5,
    "timeLimitSec": 45,
    "difficulty": 1,
    "theme": "mate-in-1·车马合杀",
    "tipId": "tip_rookknight",
    "skillWeights": {
      "common": 100,
      "rare": 0,
      "epic": 0
    },
    "intro": "车马联手，把黑王封死在边线角落。",
    "coachHints": [
      "马先占住黑王的逃格",
      "车再沿边线将军"
    ]
  },
  {
    "id": "EG-10",
    "name": "双象绞杀",
    "fen": "4B2K/8/7k/8/8/8/5B2/8 w - - 0 1",
    "sideToMove": "w",
    "targetMoves": 1,
    "moveCap": 5,
    "timeLimitSec": 45,
    "difficulty": 1,
    "theme": "mate-in-1·双象锁王",
    "tipId": "tip_doublebishop",
    "skillWeights": {
      "common": 100,
      "rare": 0,
      "epic": 0
    },
    "intro": "双象交叉斜线，黑王被锁进囚笼。",
    "coachHints": [
      "双象要走不同色斜线",
      "先把黑王逼到边角"
    ]
  },
  {
    "id": "EG-11",
    "name": "象马合杀",
    "fen": "8/5K2/5N1k/8/8/8/8/6B1 w - - 0 1",
    "sideToMove": "w",
    "targetMoves": 1,
    "moveCap": 5,
    "timeLimitSec": 45,
    "difficulty": 1,
    "theme": "mate-in-1·象马合杀",
    "tipId": "tip_bishopknight",
    "skillWeights": {
      "common": 100,
      "rare": 0,
      "epic": 0
    },
    "intro": "象与马配合，把黑王逼入绝境。",
    "coachHints": [
      "象控一种色格，马补另一种",
      "先把黑王逼到角落"
    ]
  },
  {
    "id": "EG-12",
    "name": "升变奇兵",
    "fen": "3k4/6P1/2K5/5Q2/8/8/8/8 w - - 0 1",
    "sideToMove": "w",
    "targetMoves": 1,
    "moveCap": 5,
    "timeLimitSec": 45,
    "difficulty": 1,
    "theme": "mate-in-1·升变奇兵",
    "tipId": "tip_promotion",
    "skillWeights": {
      "common": 100,
      "rare": 0,
      "epic": 0
    },
    "intro": "小兵冲到底线升变，成了压垮黑王的那根稻草。",
    "coachHints": [
      "先看兵能不能冲到第 8 横线",
      "升变不只是变后，变车也能杀"
    ]
  },
  {
    "id": "EG-13",
    "name": "后防空虚",
    "fen": "4k3/1ppp4/5K2/8/7R/8/8/8 w - - 0 1",
    "sideToMove": "w",
    "targetMoves": 1,
    "moveCap": 5,
    "timeLimitSec": 45,
    "difficulty": 1,
    "theme": "mate-in-1·底线杀",
    "tipId": "tip_backrank",
    "skillWeights": {
      "common": 100,
      "rare": 0,
      "epic": 0
    },
    "intro": "兵墙挡住退路，车走到第八横线便无可逃。",
    "coachHints": [
      "底线被兵封死，直接沉车",
      "注意黑王唯一的逃格"
    ]
  },
  {
    "id": "EG-14",
    "name": "贴身一将",
    "fen": "k7/8/1K6/8/8/8/8/4Q3 w - - 0 1",
    "sideToMove": "w",
    "targetMoves": 1,
    "moveCap": 5,
    "timeLimitSec": 45,
    "difficulty": 1,
    "theme": "mate-in-1·贴身闷杀",
    "tipId": "tip_queenmate",
    "skillWeights": {
      "common": 100,
      "rare": 0,
      "epic": 0
    },
    "intro": "把后送到能贴住黑王的位置，白王护住命门。",
    "coachHints": [
      "后将军时白王要能护住它",
      "黑王逃格全被封死才行"
    ]
  },
  {
    "id": "EG-15",
    "name": "两翼齐飞",
    "fen": "8/8/8/8/3R1R2/7K/8/7k w - - 0 1",
    "sideToMove": "w",
    "targetMoves": 1,
    "moveCap": 5,
    "timeLimitSec": 45,
    "difficulty": 1,
    "theme": "mate-in-1·双车错",
    "tipId": "tip_tworooks",
    "skillWeights": {
      "common": 100,
      "rare": 0,
      "epic": 0
    },
    "intro": "两车交替推进，黑王无处可钻。",
    "coachHints": [
      "一车控线另一车将军",
      "把黑王逼到边线再收网"
    ]
  },
  {
    "id": "EG-16",
    "name": "车王合击",
    "fen": "8/8/8/2R5/8/4K3/8/4k3 w - - 0 1",
    "sideToMove": "w",
    "targetMoves": 1,
    "moveCap": 5,
    "timeLimitSec": 45,
    "difficulty": 1,
    "theme": "mate-in-1·车王逼宫",
    "tipId": "tip_rookking",
    "skillWeights": {
      "common": 100,
      "rare": 0,
      "epic": 0
    },
    "intro": "白王压上，车切角收网。",
    "coachHints": [
      "车控制横线，王封退路",
      "逼到角落再将军"
    ]
  },
  {
    "id": "EG-17",
    "name": "金钩困王",
    "fen": "8/8/8/8/3K4/8/6nn/2Q2N1k w - - 0 1",
    "sideToMove": "w",
    "targetMoves": 1,
    "moveCap": 5,
    "timeLimitSec": 45,
    "difficulty": 1,
    "theme": "mate-in-1·闷宫绝杀",
    "tipId": "tip_smother",
    "skillWeights": {
      "common": 100,
      "rare": 0,
      "epic": 0
    },
    "intro": "四周都是自家棋子，黑王动弹不得。",
    "coachHints": [
      "黑王被自家子堵死",
      "重子远程一击即杀"
    ]
  },
  {
    "id": "EG-18",
    "name": "诱敌深入",
    "fen": "8/8/8/1R5K/8/k7/p4Q2/8 w - - 0 1",
    "sideToMove": "w",
    "targetMoves": 1,
    "moveCap": 5,
    "timeLimitSec": 45,
    "difficulty": 1,
    "theme": "mate-in-1·弃子引离",
    "tipId": "tip_decoy",
    "skillWeights": {
      "common": 100,
      "rare": 0,
      "epic": 0
    },
    "intro": "先想清楚哪枚子是可以不要的。",
    "coachHints": [
      "用诱饵换开防线",
      "沉车底线收尾"
    ]
  },
  {
    "id": "EG-19",
    "name": "钉住破绽",
    "fen": "8/3R4/8/8/5K2/6rk/8/1Q6 w - - 0 1",
    "sideToMove": "w",
    "targetMoves": 1,
    "moveCap": 5,
    "timeLimitSec": 45,
    "difficulty": 1,
    "theme": "mate-in-1·牵制闪击",
    "tipId": "tip_pin",
    "skillWeights": {
      "common": 100,
      "rare": 0,
      "epic": 0
    },
    "intro": "先钉住，再算闪击的落点。",
    "coachHints": [
      "一子定住敌子",
      "另一子趁机将军"
    ]
  },
  {
    "id": "EG-20",
    "name": "马后抽将",
    "fen": "8/5K2/8/8/8/8/6Q1/k2N4 w - - 0 1",
    "sideToMove": "w",
    "targetMoves": 1,
    "moveCap": 5,
    "timeLimitSec": 45,
    "difficulty": 1,
    "theme": "mate-in-1·马后炮",
    "tipId": "tip_knightqueen",
    "skillWeights": {
      "common": 100,
      "rare": 0,
      "epic": 0
    },
    "intro": "马与后呼应，一步将军一步抽子。",
    "coachHints": [
      "马将军的同时后控制退路",
      "两步之内收网"
    ]
  },
  {
    "id": "EG-21",
    "name": "安娜斯塔西娅",
    "fen": "8/8/2N5/8/4R3/8/k1K5/8 w - - 0 1",
    "sideToMove": "w",
    "targetMoves": 1,
    "moveCap": 5,
    "timeLimitSec": 45,
    "difficulty": 1,
    "theme": "mate-in-1·车马合杀",
    "tipId": "tip_rookknight",
    "skillWeights": {
      "common": 100,
      "rare": 0,
      "epic": 0
    },
    "intro": "马控逃格，车一锤定音。",
    "coachHints": [
      "车马各司其职",
      "把王逼到角上最稳"
    ]
  },
  {
    "id": "EG-22",
    "name": "斜线囚笼",
    "fen": "8/8/8/8/8/k5B1/8/1K1B4 w - - 0 1",
    "sideToMove": "w",
    "targetMoves": 1,
    "moveCap": 5,
    "timeLimitSec": 45,
    "difficulty": 1,
    "theme": "mate-in-1·双象锁王",
    "tipId": "tip_doublebishop",
    "skillWeights": {
      "common": 100,
      "rare": 0,
      "epic": 0
    },
    "intro": "一象控线，一象封角，王插翅难飞。",
    "coachHints": [
      "一象封退路一象将军",
      "斜线交叉即是牢笼"
    ]
  },
  {
    "id": "EG-23",
    "name": "小兵封王",
    "fen": "8/7P/k1K5/8/8/8/3Q4/8 w - - 0 1",
    "sideToMove": "w",
    "targetMoves": 1,
    "moveCap": 5,
    "timeLimitSec": 45,
    "difficulty": 1,
    "theme": "mate-in-1·升变奇兵",
    "tipId": "tip_promotion",
    "skillWeights": {
      "common": 100,
      "rare": 0,
      "epic": 0
    },
    "intro": "兵也能是杀招，升变即定局。",
    "coachHints": [
      "兵护住升变路",
      "升变后立刻将军"
    ]
  },
  {
    "id": "EG-24",
    "name": "一步绝杀",
    "fen": "5k2/4ppp1/8/8/8/6K1/7R/8 w - - 0 1",
    "sideToMove": "w",
    "targetMoves": 1,
    "moveCap": 5,
    "timeLimitSec": 45,
    "difficulty": 1,
    "theme": "mate-in-1·底线杀",
    "tipId": "tip_backrank",
    "skillWeights": {
      "common": 100,
      "rare": 0,
      "epic": 0
    },
    "intro": "别给黑王半点喘息，车直落底线。",
    "coachHints": [
      "把车送到能将军的横线",
      "白王要护住这枚车"
    ]
  },
  {
    "id": "EG-25",
    "name": "王护重子",
    "fen": "8/5Q2/8/8/8/1K6/8/k7 w - - 0 1",
    "sideToMove": "w",
    "targetMoves": 1,
    "moveCap": 5,
    "timeLimitSec": 45,
    "difficulty": 1,
    "theme": "mate-in-1·贴身闷杀",
    "tipId": "tip_queenmate",
    "skillWeights": {
      "common": 100,
      "rare": 0,
      "epic": 0
    },
    "intro": "近身将军，黑王连一步都挪不动。",
    "coachHints": [
      "把后送到能贴住黑王的位置",
      "别忘了白王要护住这枚后"
    ]
  },
  {
    "id": "EG-26",
    "name": "车错杀",
    "fen": "3k4/8/3K4/4R3/8/8/R7/8 w - - 0 1",
    "sideToMove": "w",
    "targetMoves": 1,
    "moveCap": 5,
    "timeLimitSec": 45,
    "difficulty": 1,
    "theme": "mate-in-1·双车错",
    "tipId": "tip_tworooks",
    "skillWeights": {
      "common": 100,
      "rare": 0,
      "epic": 0
    },
    "intro": "一车控线，一车收网，配合无间。",
    "coachHints": [
      "先用一车占住一条横线",
      "两车错开，黑王无处可钻"
    ]
  },
  {
    "id": "EG-27",
    "name": "切角逼杀",
    "fen": "8/8/3R4/8/8/k1K5/8/8 w - - 0 1",
    "sideToMove": "w",
    "targetMoves": 1,
    "moveCap": 5,
    "timeLimitSec": 45,
    "difficulty": 1,
    "theme": "mate-in-1·车王逼宫",
    "tipId": "tip_rookking",
    "skillWeights": {
      "common": 100,
      "rare": 0,
      "epic": 0
    },
    "intro": "王车协作，黑王插翅难飞。",
    "coachHints": [
      "白王要跟着推进，别离太远",
      "先把黑王赶到边线"
    ]
  },
  {
    "id": "EG-28",
    "name": "自锁杀",
    "fen": "8/6P1/6Q1/8/8/8/p7/kb4K1 w - - 0 1",
    "sideToMove": "w",
    "targetMoves": 1,
    "moveCap": 5,
    "timeLimitSec": 45,
    "difficulty": 1,
    "theme": "mate-in-1·闷宫绝杀",
    "tipId": "tip_smother",
    "skillWeights": {
      "common": 100,
      "rare": 0,
      "epic": 0
    },
    "intro": "看似有子，实则全成了牢笼。",
    "coachHints": [
      "数清黑王身边还剩几个空位",
      "把子塞进唯一的空位就是闷杀"
    ]
  },
  {
    "id": "EG-29",
    "name": "弃子引离",
    "fen": "Q7/7K/1R6/8/8/8/3p4/3k4 w - - 0 1",
    "sideToMove": "w",
    "targetMoves": 2,
    "moveCap": 7,
    "timeLimitSec": 60,
    "difficulty": 2,
    "theme": "mate-in-2·弃子引离",
    "tipId": "tip_decoy",
    "skillWeights": {
      "common": 70,
      "rare": 30,
      "epic": 0
    },
    "intro": "弃一个子把护王的兵引开，底线就空了。",
    "coachHints": [
      "先想清楚哪枚子是可以不要的",
      "引开护王之子后再动手"
    ]
  },
  {
    "id": "EG-30",
    "name": "牵制闪击",
    "fen": "8/Q7/6K1/8/8/5Rbk/8/8 w - - 0 1",
    "sideToMove": "w",
    "targetMoves": 2,
    "moveCap": 7,
    "timeLimitSec": 60,
    "difficulty": 2,
    "theme": "mate-in-2·牵制闪击",
    "tipId": "tip_pin",
    "skillWeights": {
      "common": 70,
      "rare": 30,
      "epic": 0
    },
    "intro": "牵住对方的子再闪击，暴露的火力才是杀招。",
    "coachHints": [
      "先牵制，再算闪击的落点",
      "白王别脱离防线"
    ]
  },
  {
    "id": "EG-31",
    "name": "马跃金钩",
    "fen": "4K2k/8/8/3Q4/8/8/7N/8 w - - 0 1",
    "sideToMove": "w",
    "targetMoves": 2,
    "moveCap": 7,
    "timeLimitSec": 60,
    "difficulty": 2,
    "theme": "mate-in-2·马后炮",
    "tipId": "tip_knightqueen",
    "skillWeights": {
      "common": 70,
      "rare": 30,
      "epic": 0
    },
    "intro": "马跳金钩直取将位，顺手还能抽走黑方的子。",
    "coachHints": [
      "马有两个落点能将军，先挑能抽子的",
      "马一离开，注意黑王逃格"
    ]
  },
  {
    "id": "EG-32",
    "name": "阿拉伯杀",
    "fen": "8/8/8/8/7N/3R1K2/8/4k3 w - - 0 1",
    "sideToMove": "w",
    "targetMoves": 2,
    "moveCap": 7,
    "timeLimitSec": 60,
    "difficulty": 2,
    "theme": "mate-in-2·车马合杀",
    "tipId": "tip_rookknight",
    "skillWeights": {
      "common": 70,
      "rare": 30,
      "epic": 0
    },
    "intro": "车马联手，把黑王封死在边线角落。",
    "coachHints": [
      "马先占住黑王的逃格",
      "车再沿边线将军"
    ]
  },
  {
    "id": "EG-33",
    "name": "双象绞杀",
    "fen": "8/8/8/8/8/6KB/8/B6k w - - 0 1",
    "sideToMove": "w",
    "targetMoves": 2,
    "moveCap": 7,
    "timeLimitSec": 60,
    "difficulty": 2,
    "theme": "mate-in-2·双象锁王",
    "tipId": "tip_doublebishop",
    "skillWeights": {
      "common": 70,
      "rare": 30,
      "epic": 0
    },
    "intro": "双象交叉斜线，黑王被锁进囚笼。",
    "coachHints": [
      "双象要走不同色斜线",
      "先把黑王逼到边角"
    ]
  },
  {
    "id": "EG-34",
    "name": "象马合杀",
    "fen": "2B5/k1K5/8/N7/8/8/8/8 w - - 0 1",
    "sideToMove": "w",
    "targetMoves": 2,
    "moveCap": 7,
    "timeLimitSec": 60,
    "difficulty": 2,
    "theme": "mate-in-2·象马合杀",
    "tipId": "tip_bishopknight",
    "skillWeights": {
      "common": 70,
      "rare": 30,
      "epic": 0
    },
    "intro": "象与马配合，把黑王逼入绝境。",
    "coachHints": [
      "象控一种色格，马补另一种",
      "先把黑王逼到角落"
    ]
  },
  {
    "id": "EG-35",
    "name": "升变奇兵",
    "fen": "8/6P1/8/7K/8/1Q6/7k/8 w - - 0 1",
    "sideToMove": "w",
    "targetMoves": 2,
    "moveCap": 7,
    "timeLimitSec": 60,
    "difficulty": 2,
    "theme": "mate-in-2·升变奇兵",
    "tipId": "tip_promotion",
    "skillWeights": {
      "common": 70,
      "rare": 30,
      "epic": 0
    },
    "intro": "小兵冲到底线升变，成了压垮黑王的那根稻草。",
    "coachHints": [
      "先看兵能不能冲到第 8 横线",
      "升变不只是变后，变车也能杀"
    ]
  },
  {
    "id": "EG-36",
    "name": "车沉底线",
    "fen": "1k6/3ppp2/8/K7/8/6R1/8/8 w - - 0 1",
    "sideToMove": "w",
    "targetMoves": 2,
    "moveCap": 7,
    "timeLimitSec": 60,
    "difficulty": 2,
    "theme": "mate-in-2·底线杀",
    "tipId": "tip_backrank",
    "skillWeights": {
      "common": 70,
      "rare": 30,
      "epic": 0
    },
    "intro": "黑王被自己的兵困在底线，一车沉底就是绝杀。",
    "coachHints": [
      "车走到第 8 横线就是绝杀",
      "先数一遍黑王还能往哪走"
    ]
  },
  {
    "id": "EG-37",
    "name": "后贴金身",
    "fen": "8/8/8/8/1Q4K1/8/8/7k w - - 0 1",
    "sideToMove": "w",
    "targetMoves": 2,
    "moveCap": 7,
    "timeLimitSec": 60,
    "difficulty": 2,
    "theme": "mate-in-2·贴身闷杀",
    "tipId": "tip_queenmate",
    "skillWeights": {
      "common": 70,
      "rare": 30,
      "epic": 0
    },
    "intro": "后贴住敌王、自有王来护，闷杀就此成局。",
    "coachHints": [
      "把后送到能贴住黑王的位置",
      "别忘了白王要护住这枚后"
    ]
  },
  {
    "id": "EG-38",
    "name": "双车合围",
    "fen": "8/8/8/8/8/R7/6R1/1k4K1 w - - 0 1",
    "sideToMove": "w",
    "targetMoves": 2,
    "moveCap": 7,
    "timeLimitSec": 60,
    "difficulty": 2,
    "theme": "mate-in-2·双车错",
    "tipId": "tip_tworooks",
    "skillWeights": {
      "common": 70,
      "rare": 30,
      "epic": 0
    },
    "intro": "双车错开两条横线，一层层把黑王逼到边角。",
    "coachHints": [
      "先用一车占住一条横线",
      "两车错开，黑王无处可钻"
    ]
  },
  {
    "id": "EG-39",
    "name": "单车擒王",
    "fen": "8/8/8/7R/K7/8/8/k7 w - - 0 1",
    "sideToMove": "w",
    "targetMoves": 2,
    "moveCap": 7,
    "timeLimitSec": 60,
    "difficulty": 2,
    "theme": "mate-in-2·车王逼宫",
    "tipId": "tip_rookking",
    "skillWeights": {
      "common": 70,
      "rare": 30,
      "epic": 0
    },
    "intro": "单车配王，把黑王一步步赶向边线。",
    "coachHints": [
      "白王要跟着推进，别离太远",
      "先把黑王赶到边线"
    ]
  },
  {
    "id": "EG-40",
    "name": "闷宫绝杀",
    "fen": "8/8/K7/8/7Q/8/pb6/k7 w - - 0 1",
    "sideToMove": "w",
    "targetMoves": 2,
    "moveCap": 7,
    "timeLimitSec": 60,
    "difficulty": 2,
    "theme": "mate-in-2·闷宫绝杀",
    "tipId": "tip_smother",
    "skillWeights": {
      "common": 70,
      "rare": 30,
      "epic": 0
    },
    "intro": "黑王被自己的子闷住，一记闷宫就够了。",
    "coachHints": [
      "数清黑王身边还剩几个空位",
      "把子塞进唯一的空位就是闷杀"
    ]
  },
  {
    "id": "EG-41",
    "name": "诱敌深入",
    "fen": "3K4/k7/p2R4/6Q1/8/8/8/8 w - - 0 1",
    "sideToMove": "w",
    "targetMoves": 2,
    "moveCap": 7,
    "timeLimitSec": 60,
    "difficulty": 2,
    "theme": "mate-in-2·弃子引离",
    "tipId": "tip_decoy",
    "skillWeights": {
      "common": 70,
      "rare": 30,
      "epic": 0
    },
    "intro": "先想清楚哪枚子是可以不要的。",
    "coachHints": [
      "用诱饵换开防线",
      "沉车底线收尾"
    ]
  },
  {
    "id": "EG-42",
    "name": "钉住破绽",
    "fen": "r7/k7/5Q2/5Q2/8/8/8/2K5 w - - 0 1",
    "sideToMove": "w",
    "targetMoves": 2,
    "moveCap": 7,
    "timeLimitSec": 60,
    "difficulty": 2,
    "theme": "mate-in-2·牵制闪击",
    "tipId": "tip_pin",
    "skillWeights": {
      "common": 70,
      "rare": 30,
      "epic": 0
    },
    "intro": "先钉住，再算闪击的落点。",
    "coachHints": [
      "一子定住敌子",
      "另一子趁机将军"
    ]
  },
  {
    "id": "EG-43",
    "name": "马后抽将",
    "fen": "8/8/8/8/8/k7/2K3QN/8 w - - 0 1",
    "sideToMove": "w",
    "targetMoves": 2,
    "moveCap": 7,
    "timeLimitSec": 60,
    "difficulty": 2,
    "theme": "mate-in-2·马后炮",
    "tipId": "tip_knightqueen",
    "skillWeights": {
      "common": 70,
      "rare": 30,
      "epic": 0
    },
    "intro": "马与后呼应，一步将军一步抽子。",
    "coachHints": [
      "马将军的同时后控制退路",
      "两步之内收网"
    ]
  },
  {
    "id": "EG-44",
    "name": "安娜斯塔西娅",
    "fen": "8/8/8/8/8/2K5/6R1/3k2N1 w - - 0 1",
    "sideToMove": "w",
    "targetMoves": 2,
    "moveCap": 7,
    "timeLimitSec": 60,
    "difficulty": 2,
    "theme": "mate-in-2·车马合杀",
    "tipId": "tip_rookknight",
    "skillWeights": {
      "common": 70,
      "rare": 30,
      "epic": 0
    },
    "intro": "马控逃格，车一锤定音。",
    "coachHints": [
      "车马各司其职",
      "把王逼到角上最稳"
    ]
  },
  {
    "id": "EG-45",
    "name": "斜线囚笼",
    "fen": "6k1/8/B6K/2B5/8/8/8/8 w - - 0 1",
    "sideToMove": "w",
    "targetMoves": 2,
    "moveCap": 7,
    "timeLimitSec": 60,
    "difficulty": 2,
    "theme": "mate-in-2·双象锁王",
    "tipId": "tip_doublebishop",
    "skillWeights": {
      "common": 70,
      "rare": 30,
      "epic": 0
    },
    "intro": "一象控线，一象封角，王插翅难飞。",
    "coachHints": [
      "一象封退路一象将军",
      "斜线交叉即是牢笼"
    ]
  },
  {
    "id": "EG-46",
    "name": "小兵封王",
    "fen": "6k1/P7/3K4/8/8/7Q/8/8 w - - 0 1",
    "sideToMove": "w",
    "targetMoves": 2,
    "moveCap": 7,
    "timeLimitSec": 60,
    "difficulty": 2,
    "theme": "mate-in-2·升变奇兵",
    "tipId": "tip_promotion",
    "skillWeights": {
      "common": 70,
      "rare": 30,
      "epic": 0
    },
    "intro": "兵也能是杀招，升变即定局。",
    "coachHints": [
      "兵护住升变路",
      "升变后立刻将军"
    ]
  },
  {
    "id": "EG-47",
    "name": "后防空虚",
    "fen": "1k6/3ppp2/7R/K7/8/8/8/8 w - - 0 1",
    "sideToMove": "w",
    "targetMoves": 2,
    "moveCap": 7,
    "timeLimitSec": 60,
    "difficulty": 2,
    "theme": "mate-in-2·底线杀",
    "tipId": "tip_backrank",
    "skillWeights": {
      "common": 70,
      "rare": 30,
      "epic": 0
    },
    "intro": "兵墙挡住退路，车走到第八横线便无可逃。",
    "coachHints": [
      "底线被兵封死，直接沉车",
      "注意黑王唯一的逃格"
    ]
  },
  {
    "id": "EG-48",
    "name": "贴身一将",
    "fen": "7k/3Q4/8/7K/8/8/8/8 w - - 0 1",
    "sideToMove": "w",
    "targetMoves": 2,
    "moveCap": 7,
    "timeLimitSec": 60,
    "difficulty": 2,
    "theme": "mate-in-2·贴身闷杀",
    "tipId": "tip_queenmate",
    "skillWeights": {
      "common": 70,
      "rare": 30,
      "epic": 0
    },
    "intro": "把后送到能贴住黑王的位置，白王护住命门。",
    "coachHints": [
      "后将军时白王要能护住它",
      "黑王逃格全被封死才行"
    ]
  },
  {
    "id": "EG-49",
    "name": "两翼齐飞",
    "fen": "4k3/8/3K3R/8/8/8/8/1R6 w - - 0 1",
    "sideToMove": "w",
    "targetMoves": 2,
    "moveCap": 7,
    "timeLimitSec": 60,
    "difficulty": 2,
    "theme": "mate-in-2·双车错",
    "tipId": "tip_tworooks",
    "skillWeights": {
      "common": 70,
      "rare": 30,
      "epic": 0
    },
    "intro": "两车交替推进，黑王无处可钻。",
    "coachHints": [
      "一车控线另一车将军",
      "把黑王逼到边线再收网"
    ]
  },
  {
    "id": "EG-50",
    "name": "车王合击",
    "fen": "3k4/8/4K3/8/8/8/5R2/8 w - - 0 1",
    "sideToMove": "w",
    "targetMoves": 2,
    "moveCap": 7,
    "timeLimitSec": 60,
    "difficulty": 2,
    "theme": "mate-in-2·车王逼宫",
    "tipId": "tip_rookking",
    "skillWeights": {
      "common": 70,
      "rare": 30,
      "epic": 0
    },
    "intro": "白王压上，车切角收网。",
    "coachHints": [
      "车控制横线，王封退路",
      "逼到角落再将军"
    ]
  },
  {
    "id": "EG-51",
    "name": "金钩困王",
    "fen": "8/8/8/1R6/7K/4Q3/6p1/6nk w - - 0 1",
    "sideToMove": "w",
    "targetMoves": 2,
    "moveCap": 7,
    "timeLimitSec": 60,
    "difficulty": 2,
    "theme": "mate-in-2·闷宫绝杀",
    "tipId": "tip_smother",
    "skillWeights": {
      "common": 70,
      "rare": 30,
      "epic": 0
    },
    "intro": "四周都是自家棋子，黑王动弹不得。",
    "coachHints": [
      "黑王被自家子堵死",
      "重子远程一击即杀"
    ]
  },
  {
    "id": "EG-52",
    "name": "调虎离山",
    "fen": "3k4/3p4/2Q5/8/3p2K1/8/5R2/8 w - - 0 1",
    "sideToMove": "w",
    "targetMoves": 2,
    "moveCap": 7,
    "timeLimitSec": 60,
    "difficulty": 2,
    "theme": "mate-in-2·弃子引离",
    "tipId": "tip_decoy",
    "skillWeights": {
      "common": 70,
      "rare": 30,
      "epic": 0
    },
    "intro": "引开护子，再沉车底线。",
    "coachHints": [
      "先想清楚哪枚子是可以不要的",
      "引开护王之子后再动手"
    ]
  },
  {
    "id": "EG-53",
    "name": "一线牵杀",
    "fen": "5K2/7k/Q6n/2R5/8/8/8/8 w - - 0 1",
    "sideToMove": "w",
    "targetMoves": 2,
    "moveCap": 7,
    "timeLimitSec": 60,
    "difficulty": 2,
    "theme": "mate-in-2·牵制闪击",
    "tipId": "tip_pin",
    "skillWeights": {
      "common": 70,
      "rare": 30,
      "epic": 0
    },
    "intro": "表面安静，实则已锁死逃路。",
    "coachHints": [
      "先牵制，再算闪击的落点",
      "白王别脱离防线"
    ]
  },
  {
    "id": "EG-54",
    "name": "金钩将军",
    "fen": "8/8/8/8/7k/5K2/8/Q2N4 w - - 0 1",
    "sideToMove": "w",
    "targetMoves": 2,
    "moveCap": 7,
    "timeLimitSec": 60,
    "difficulty": 2,
    "theme": "mate-in-2·马后炮",
    "tipId": "tip_knightqueen",
    "skillWeights": {
      "common": 70,
      "rare": 30,
      "epic": 0
    },
    "intro": "金钩一拐，黑王应声倒下。",
    "coachHints": [
      "马有两个落点能将军，先挑能抽子的",
      "马一离开，注意黑王逃格"
    ]
  },
  {
    "id": "EG-55",
    "name": "角落杀",
    "fen": "7k/8/8/7K/8/8/4R3/4N3 w - - 0 1",
    "sideToMove": "w",
    "targetMoves": 2,
    "moveCap": 7,
    "timeLimitSec": 60,
    "difficulty": 2,
    "theme": "mate-in-2·车马合杀",
    "tipId": "tip_rookknight",
    "skillWeights": {
      "common": 70,
      "rare": 30,
      "epic": 0
    },
    "intro": "经典的车马配合，专破王翼。",
    "coachHints": [
      "马先占住黑王的逃格",
      "车再沿边线将军"
    ]
  },
  {
    "id": "EG-56",
    "name": "象翼合围",
    "fen": "7k/8/6KB/1B6/8/8/8/8 w - - 0 1",
    "sideToMove": "w",
    "targetMoves": 2,
    "moveCap": 7,
    "timeLimitSec": 60,
    "difficulty": 2,
    "theme": "mate-in-2·双象锁王",
    "tipId": "tip_doublebishop",
    "skillWeights": {
      "common": 70,
      "rare": 30,
      "epic": 0
    },
    "intro": "双翼齐飞，杀机藏在斜线里。",
    "coachHints": [
      "双象要走不同色斜线",
      "先把黑王逼到边角"
    ]
  },
  {
    "id": "EG-57",
    "name": "一步登天",
    "fen": "8/7P/8/8/5K2/8/1Q6/3k4 w - - 0 1",
    "sideToMove": "w",
    "targetMoves": 2,
    "moveCap": 7,
    "timeLimitSec": 60,
    "difficulty": 2,
    "theme": "mate-in-2·升变奇兵",
    "tipId": "tip_promotion",
    "skillWeights": {
      "common": 70,
      "rare": 30,
      "epic": 0
    },
    "intro": "先让兵冲到第七横线，再图后手。",
    "coachHints": [
      "先看兵能不能冲到第 8 横线",
      "升变不只是变后，变车也能杀"
    ]
  },
  {
    "id": "EG-58",
    "name": "一步绝杀",
    "fen": "1k6/3ppp1R/8/1K6/8/8/8/8 w - - 0 1",
    "sideToMove": "w",
    "targetMoves": 2,
    "moveCap": 7,
    "timeLimitSec": 60,
    "difficulty": 2,
    "theme": "mate-in-2·底线杀",
    "tipId": "tip_backrank",
    "skillWeights": {
      "common": 70,
      "rare": 30,
      "epic": 0
    },
    "intro": "别给黑王半点喘息，车直落底线。",
    "coachHints": [
      "把车送到能将军的横线",
      "白王要护住这枚车"
    ]
  },
  {
    "id": "EG-59",
    "name": "王护重子",
    "fen": "8/8/8/8/5K2/8/3Q4/7k w - - 0 1",
    "sideToMove": "w",
    "targetMoves": 2,
    "moveCap": 7,
    "timeLimitSec": 60,
    "difficulty": 2,
    "theme": "mate-in-2·贴身闷杀",
    "tipId": "tip_queenmate",
    "skillWeights": {
      "common": 70,
      "rare": 30,
      "epic": 0
    },
    "intro": "近身将军，黑王连一步都挪不动。",
    "coachHints": [
      "把后送到能贴住黑王的位置",
      "别忘了白王要护住这枚后"
    ]
  },
  {
    "id": "EG-60",
    "name": "车错杀",
    "fen": "8/8/4R3/3R4/8/8/8/K4k2 w - - 0 1",
    "sideToMove": "w",
    "targetMoves": 2,
    "moveCap": 7,
    "timeLimitSec": 60,
    "difficulty": 2,
    "theme": "mate-in-2·双车错",
    "tipId": "tip_tworooks",
    "skillWeights": {
      "common": 70,
      "rare": 30,
      "epic": 0
    },
    "intro": "一车控线，一车收网，配合无间。",
    "coachHints": [
      "先用一车占住一条横线",
      "两车错开，黑王无处可钻"
    ]
  },
  {
    "id": "EG-61",
    "name": "单车擒王",
    "fen": "8/8/8/8/8/k2K4/8/6R1 w - - 0 1",
    "sideToMove": "w",
    "targetMoves": 3,
    "moveCap": 9,
    "timeLimitSec": 90,
    "difficulty": 3,
    "theme": "mate-in-3·车王逼宫",
    "tipId": "tip_rookking",
    "skillWeights": {
      "common": 45,
      "rare": 50,
      "epic": 5
    },
    "intro": "单车配王，把黑王一步步赶向边线。",
    "coachHints": [
      "白王要跟着推进，别离太远",
      "先把黑王赶到边线"
    ]
  },
  {
    "id": "EG-62",
    "name": "闷宫绝杀",
    "fen": "kb6/n4Q2/3B4/8/7K/8/8/8 w - - 0 1",
    "sideToMove": "w",
    "targetMoves": 3,
    "moveCap": 9,
    "timeLimitSec": 90,
    "difficulty": 3,
    "theme": "mate-in-3·闷宫绝杀",
    "tipId": "tip_smother",
    "skillWeights": {
      "common": 45,
      "rare": 50,
      "epic": 5
    },
    "intro": "黑王被自己的子闷住，一记闷宫就够了。",
    "coachHints": [
      "数清黑王身边还剩几个空位",
      "把子塞进唯一的空位就是闷杀"
    ]
  },
  {
    "id": "EG-63",
    "name": "弃子引离",
    "fen": "8/K5pk/8/8/8/8/4Q3/5R2 w - - 0 1",
    "sideToMove": "w",
    "targetMoves": 3,
    "moveCap": 9,
    "timeLimitSec": 90,
    "difficulty": 3,
    "theme": "mate-in-3·弃子引离",
    "tipId": "tip_decoy",
    "skillWeights": {
      "common": 45,
      "rare": 50,
      "epic": 5
    },
    "intro": "弃一个子把护王的兵引开，底线就空了。",
    "coachHints": [
      "先想清楚哪枚子是可以不要的",
      "引开护王之子后再动手"
    ]
  },
  {
    "id": "EG-64",
    "name": "牵制闪击",
    "fen": "5k2/1Q3n2/8/7K/3B4/8/8/8 w - - 0 1",
    "sideToMove": "w",
    "targetMoves": 3,
    "moveCap": 9,
    "timeLimitSec": 90,
    "difficulty": 3,
    "theme": "mate-in-3·牵制闪击",
    "tipId": "tip_pin",
    "skillWeights": {
      "common": 45,
      "rare": 50,
      "epic": 5
    },
    "intro": "牵住对方的子再闪击，暴露的火力才是杀招。",
    "coachHints": [
      "先牵制，再算闪击的落点",
      "白王别脱离防线"
    ]
  },
  {
    "id": "EG-65",
    "name": "马跃金钩",
    "fen": "8/8/k5N1/8/8/1Q6/6K1/8 w - - 0 1",
    "sideToMove": "w",
    "targetMoves": 3,
    "moveCap": 9,
    "timeLimitSec": 90,
    "difficulty": 3,
    "theme": "mate-in-3·马后炮",
    "tipId": "tip_knightqueen",
    "skillWeights": {
      "common": 45,
      "rare": 50,
      "epic": 5
    },
    "intro": "马跳金钩直取将位，顺手还能抽走黑方的子。",
    "coachHints": [
      "马有两个落点能将军，先挑能抽子的",
      "马一离开，注意黑王逃格"
    ]
  },
  {
    "id": "EG-66",
    "name": "阿拉伯杀",
    "fen": "6k1/8/8/6K1/1N6/3R4/8/8 w - - 0 1",
    "sideToMove": "w",
    "targetMoves": 3,
    "moveCap": 9,
    "timeLimitSec": 90,
    "difficulty": 3,
    "theme": "mate-in-3·车马合杀",
    "tipId": "tip_rookknight",
    "skillWeights": {
      "common": 45,
      "rare": 50,
      "epic": 5
    },
    "intro": "车马联手，把黑王封死在边线角落。",
    "coachHints": [
      "马先占住黑王的逃格",
      "车再沿边线将军"
    ]
  },
  {
    "id": "EG-67",
    "name": "双象绞杀",
    "fen": "k1K5/8/7B/5B2/8/8/8/8 w - - 0 1",
    "sideToMove": "w",
    "targetMoves": 3,
    "moveCap": 9,
    "timeLimitSec": 90,
    "difficulty": 3,
    "theme": "mate-in-3·双象锁王",
    "tipId": "tip_doublebishop",
    "skillWeights": {
      "common": 45,
      "rare": 50,
      "epic": 5
    },
    "intro": "双象交叉斜线，黑王被锁进囚笼。",
    "coachHints": [
      "双象要走不同色斜线",
      "先把黑王逼到边角"
    ]
  },
  {
    "id": "EG-68",
    "name": "象马合杀",
    "fen": "8/8/8/1N6/K7/8/3B4/k7 w - - 0 1",
    "sideToMove": "w",
    "targetMoves": 3,
    "moveCap": 9,
    "timeLimitSec": 90,
    "difficulty": 3,
    "theme": "mate-in-3·象马合杀",
    "tipId": "tip_bishopknight",
    "skillWeights": {
      "common": 45,
      "rare": 50,
      "epic": 5
    },
    "intro": "象与马配合，把黑王逼入绝境。",
    "coachHints": [
      "象控一种色格，马补另一种",
      "先把黑王逼到角落"
    ]
  },
  {
    "id": "EG-69",
    "name": "升变奇兵",
    "fen": "8/6P1/4K3/8/4Q3/k7/8/8 w - - 0 1",
    "sideToMove": "w",
    "targetMoves": 3,
    "moveCap": 9,
    "timeLimitSec": 90,
    "difficulty": 3,
    "theme": "mate-in-3·升变奇兵",
    "tipId": "tip_promotion",
    "skillWeights": {
      "common": 45,
      "rare": 50,
      "epic": 5
    },
    "intro": "小兵冲到底线升变，成了压垮黑王的那根稻草。",
    "coachHints": [
      "先看兵能不能冲到第 8 横线",
      "升变不只是变后，变车也能杀"
    ]
  },
  {
    "id": "EG-70",
    "name": "车沉底线",
    "fen": "6k1/3ppp2/8/7K/8/8/8/R7 w - - 0 1",
    "sideToMove": "w",
    "targetMoves": 3,
    "moveCap": 9,
    "timeLimitSec": 90,
    "difficulty": 3,
    "theme": "mate-in-3·底线杀",
    "tipId": "tip_backrank",
    "skillWeights": {
      "common": 45,
      "rare": 50,
      "epic": 5
    },
    "intro": "黑王被自己的兵困在底线，一车沉底就是绝杀。",
    "coachHints": [
      "车走到第 8 横线就是绝杀",
      "先数一遍黑王还能往哪走"
    ]
  },
  {
    "id": "EG-71",
    "name": "后贴金身",
    "fen": "7k/8/8/4K3/8/8/8/3Q4 w - - 0 1",
    "sideToMove": "w",
    "targetMoves": 3,
    "moveCap": 9,
    "timeLimitSec": 90,
    "difficulty": 3,
    "theme": "mate-in-3·贴身闷杀",
    "tipId": "tip_queenmate",
    "skillWeights": {
      "common": 45,
      "rare": 50,
      "epic": 5
    },
    "intro": "后贴住敌王、自有王来护，闷杀就此成局。",
    "coachHints": [
      "把后送到能贴住黑王的位置",
      "别忘了白王要护住这枚后"
    ]
  },
  {
    "id": "EG-72",
    "name": "双车合围",
    "fen": "1k6/8/8/8/7R/2K5/8/7R w - - 0 1",
    "sideToMove": "w",
    "targetMoves": 3,
    "moveCap": 9,
    "timeLimitSec": 90,
    "difficulty": 3,
    "theme": "mate-in-3·双车错",
    "tipId": "tip_tworooks",
    "skillWeights": {
      "common": 45,
      "rare": 50,
      "epic": 5
    },
    "intro": "双车错开两条横线，一层层把黑王逼到边角。",
    "coachHints": [
      "先用一车占住一条横线",
      "两车错开，黑王无处可钻"
    ]
  },
  {
    "id": "EG-73",
    "name": "车王合击",
    "fen": "2k5/8/8/3K4/8/3R4/8/8 w - - 0 1",
    "sideToMove": "w",
    "targetMoves": 3,
    "moveCap": 9,
    "timeLimitSec": 90,
    "difficulty": 3,
    "theme": "mate-in-3·车王逼宫",
    "tipId": "tip_rookking",
    "skillWeights": {
      "common": 45,
      "rare": 50,
      "epic": 5
    },
    "intro": "白王压上，车切角收网。",
    "coachHints": [
      "车控制横线，王封退路",
      "逼到角落再将军"
    ]
  },
  {
    "id": "EG-74",
    "name": "金钩困王",
    "fen": "kn6/p4B2/8/Q7/7K/8/8/8 w - - 0 1",
    "sideToMove": "w",
    "targetMoves": 3,
    "moveCap": 9,
    "timeLimitSec": 90,
    "difficulty": 3,
    "theme": "mate-in-3·闷宫绝杀",
    "tipId": "tip_smother",
    "skillWeights": {
      "common": 45,
      "rare": 50,
      "epic": 5
    },
    "intro": "四周都是自家棋子，黑王动弹不得。",
    "coachHints": [
      "黑王被自家子堵死",
      "重子远程一击即杀"
    ]
  },
  {
    "id": "EG-75",
    "name": "诱敌深入",
    "fen": "2R5/2Q1K3/8/8/8/8/kp6/8 w - - 0 1",
    "sideToMove": "w",
    "targetMoves": 3,
    "moveCap": 9,
    "timeLimitSec": 90,
    "difficulty": 3,
    "theme": "mate-in-3·弃子引离",
    "tipId": "tip_decoy",
    "skillWeights": {
      "common": 45,
      "rare": 50,
      "epic": 5
    },
    "intro": "先想清楚哪枚子是可以不要的。",
    "coachHints": [
      "用诱饵换开防线",
      "沉车底线收尾"
    ]
  },
  {
    "id": "EG-76",
    "name": "钉住破绽",
    "fen": "8/7K/k7/r6Q/8/8/8/2Q5 w - - 0 1",
    "sideToMove": "w",
    "targetMoves": 3,
    "moveCap": 9,
    "timeLimitSec": 90,
    "difficulty": 3,
    "theme": "mate-in-3·牵制闪击",
    "tipId": "tip_pin",
    "skillWeights": {
      "common": 45,
      "rare": 50,
      "epic": 5
    },
    "intro": "先钉住，再算闪击的落点。",
    "coachHints": [
      "一子定住敌子",
      "另一子趁机将军"
    ]
  },
  {
    "id": "EG-77",
    "name": "马后抽将",
    "fen": "8/8/8/4K3/8/7k/3N4/3Q4 w - - 0 1",
    "sideToMove": "w",
    "targetMoves": 3,
    "moveCap": 9,
    "timeLimitSec": 90,
    "difficulty": 3,
    "theme": "mate-in-3·马后炮",
    "tipId": "tip_knightqueen",
    "skillWeights": {
      "common": 45,
      "rare": 50,
      "epic": 5
    },
    "intro": "马与后呼应，一步将军一步抽子。",
    "coachHints": [
      "马将军的同时后控制退路",
      "两步之内收网"
    ]
  },
  {
    "id": "EG-78",
    "name": "安娜斯塔西娅",
    "fen": "8/8/3K4/k7/8/5R2/8/3N4 w - - 0 1",
    "sideToMove": "w",
    "targetMoves": 3,
    "moveCap": 9,
    "timeLimitSec": 90,
    "difficulty": 3,
    "theme": "mate-in-3·车马合杀",
    "tipId": "tip_rookknight",
    "skillWeights": {
      "common": 45,
      "rare": 50,
      "epic": 5
    },
    "intro": "马控逃格，车一锤定音。",
    "coachHints": [
      "车马各司其职",
      "把王逼到角上最稳"
    ]
  },
  {
    "id": "EG-79",
    "name": "斜线囚笼",
    "fen": "8/1B6/3B4/8/8/3K4/8/k7 w - - 0 1",
    "sideToMove": "w",
    "targetMoves": 3,
    "moveCap": 9,
    "timeLimitSec": 90,
    "difficulty": 3,
    "theme": "mate-in-3·双象锁王",
    "tipId": "tip_doublebishop",
    "skillWeights": {
      "common": 45,
      "rare": 50,
      "epic": 5
    },
    "intro": "一象控线，一象封角，王插翅难飞。",
    "coachHints": [
      "一象封退路一象将军",
      "斜线交叉即是牢笼"
    ]
  },
  {
    "id": "EG-80",
    "name": "异色围杀",
    "fen": "8/8/8/8/N7/8/k7/2BK4 w - - 0 1",
    "sideToMove": "w",
    "targetMoves": 3,
    "moveCap": 9,
    "timeLimitSec": 90,
    "difficulty": 3,
    "theme": "mate-in-3·象马合杀",
    "tipId": "tip_bishopknight",
    "skillWeights": {
      "common": 45,
      "rare": 50,
      "epic": 5
    },
    "intro": "短兵相接的残局，算清每一步。",
    "coachHints": [
      "王要上前助阵",
      "算准将军次序"
    ]
  },
  {
    "id": "EG-81",
    "name": "小兵封王",
    "fen": "3K4/2P5/8/7Q/8/8/8/6k1 w - - 0 1",
    "sideToMove": "w",
    "targetMoves": 3,
    "moveCap": 9,
    "timeLimitSec": 90,
    "difficulty": 3,
    "theme": "mate-in-3·升变奇兵",
    "tipId": "tip_promotion",
    "skillWeights": {
      "common": 45,
      "rare": 50,
      "epic": 5
    },
    "intro": "兵也能是杀招，升变即定局。",
    "coachHints": [
      "兵护住升变路",
      "升变后立刻将军"
    ]
  },
  {
    "id": "EG-82",
    "name": "后防空虚",
    "fen": "6k1/3ppp2/8/6K1/8/8/8/1R6 w - - 0 1",
    "sideToMove": "w",
    "targetMoves": 3,
    "moveCap": 9,
    "timeLimitSec": 90,
    "difficulty": 3,
    "theme": "mate-in-3·底线杀",
    "tipId": "tip_backrank",
    "skillWeights": {
      "common": 45,
      "rare": 50,
      "epic": 5
    },
    "intro": "兵墙挡住退路，车走到第八横线便无可逃。",
    "coachHints": [
      "底线被兵封死，直接沉车",
      "注意黑王唯一的逃格"
    ]
  },
  {
    "id": "EG-83",
    "name": "贴身一将",
    "fen": "6k1/8/4K3/8/2Q5/8/8/8 w - - 0 1",
    "sideToMove": "w",
    "targetMoves": 3,
    "moveCap": 9,
    "timeLimitSec": 90,
    "difficulty": 3,
    "theme": "mate-in-3·贴身闷杀",
    "tipId": "tip_queenmate",
    "skillWeights": {
      "common": 45,
      "rare": 50,
      "epic": 5
    },
    "intro": "把后送到能贴住黑王的位置，白王护住命门。",
    "coachHints": [
      "后将军时白王要能护住它",
      "黑王逃格全被封死才行"
    ]
  },
  {
    "id": "EG-84",
    "name": "两翼齐飞",
    "fen": "3k4/8/2R5/8/8/8/K1R5/8 w - - 0 1",
    "sideToMove": "w",
    "targetMoves": 3,
    "moveCap": 9,
    "timeLimitSec": 90,
    "difficulty": 3,
    "theme": "mate-in-3·双车错",
    "tipId": "tip_tworooks",
    "skillWeights": {
      "common": 45,
      "rare": 50,
      "epic": 5
    },
    "intro": "两车交替推进，黑王无处可钻。",
    "coachHints": [
      "一车控线另一车将军",
      "把黑王逼到边线再收网"
    ]
  },
  {
    "id": "EG-85",
    "name": "切角逼杀",
    "fen": "8/7k/4K3/8/8/8/8/6R1 w - - 0 1",
    "sideToMove": "w",
    "targetMoves": 3,
    "moveCap": 9,
    "timeLimitSec": 90,
    "difficulty": 3,
    "theme": "mate-in-3·车王逼宫",
    "tipId": "tip_rookking",
    "skillWeights": {
      "common": 45,
      "rare": 50,
      "epic": 5
    },
    "intro": "王车协作，黑王插翅难飞。",
    "coachHints": [
      "白王要跟着推进，别离太远",
      "先把黑王赶到边线"
    ]
  },
  {
    "id": "EG-86",
    "name": "闷宫绝杀",
    "fen": "3R1K1k/6p1/8/8/8/8/8/8 w - - 0 1",
    "sideToMove": "w",
    "targetMoves": 4,
    "moveCap": 11,
    "timeLimitSec": 120,
    "difficulty": 5,
    "theme": "mate-in-4·闷宫绝杀",
    "tipId": "tip_smother",
    "skillWeights": {
      "common": 20,
      "rare": 50,
      "epic": 30
    },
    "intro": "黑王被自己的子闷住，一记闷宫就够了。",
    "coachHints": [
      "数清黑王身边还剩几个空位",
      "把子塞进唯一的空位就是闷杀"
    ]
  },
  {
    "id": "EG-87",
    "name": "弃子引离",
    "fen": "1k6/1p6/8/8/3R1r2/1Q6/8/7K w - - 0 1",
    "sideToMove": "w",
    "targetMoves": 4,
    "moveCap": 11,
    "timeLimitSec": 120,
    "difficulty": 5,
    "theme": "mate-in-4·弃子引离",
    "tipId": "tip_decoy",
    "skillWeights": {
      "common": 20,
      "rare": 50,
      "epic": 30
    },
    "intro": "弃一个子把护王的兵引开，底线就空了。",
    "coachHints": [
      "先想清楚哪枚子是可以不要的",
      "引开护王之子后再动手"
    ]
  },
  {
    "id": "EG-88",
    "name": "牵制闪击",
    "fen": "8/8/4R3/8/8/Q3K1bk/8/8 w - - 0 1",
    "sideToMove": "w",
    "targetMoves": 4,
    "moveCap": 11,
    "timeLimitSec": 120,
    "difficulty": 5,
    "theme": "mate-in-4·牵制闪击",
    "tipId": "tip_pin",
    "skillWeights": {
      "common": 20,
      "rare": 50,
      "epic": 30
    },
    "intro": "牵住对方的子再闪击，暴露的火力才是杀招。",
    "coachHints": [
      "先牵制，再算闪击的落点",
      "白王别脱离防线"
    ]
  },
  {
    "id": "EG-89",
    "name": "马跃金钩",
    "fen": "5k2/8/8/8/7K/7Q/8/6N1 w - - 0 1",
    "sideToMove": "w",
    "targetMoves": 4,
    "moveCap": 11,
    "timeLimitSec": 120,
    "difficulty": 5,
    "theme": "mate-in-4·马后炮",
    "tipId": "tip_knightqueen",
    "skillWeights": {
      "common": 20,
      "rare": 50,
      "epic": 30
    },
    "intro": "马跳金钩直取将位，顺手还能抽走黑方的子。",
    "coachHints": [
      "马有两个落点能将军，先挑能抽子的",
      "马一离开，注意黑王逃格"
    ]
  },
  {
    "id": "EG-90",
    "name": "阿拉伯杀",
    "fen": "8/8/R7/6N1/3K4/8/8/4k3 w - - 0 1",
    "sideToMove": "w",
    "targetMoves": 4,
    "moveCap": 11,
    "timeLimitSec": 120,
    "difficulty": 5,
    "theme": "mate-in-4·车马合杀",
    "tipId": "tip_rookknight",
    "skillWeights": {
      "common": 20,
      "rare": 50,
      "epic": 30
    },
    "intro": "车马联手，把黑王封死在边线角落。",
    "coachHints": [
      "马先占住黑王的逃格",
      "车再沿边线将军"
    ]
  },
  {
    "id": "EG-91",
    "name": "双象绞杀",
    "fen": "1B4k1/3B4/6K1/8/8/8/8/8 w - - 0 1",
    "sideToMove": "w",
    "targetMoves": 4,
    "moveCap": 11,
    "timeLimitSec": 120,
    "difficulty": 5,
    "theme": "mate-in-4·双象锁王",
    "tipId": "tip_doublebishop",
    "skillWeights": {
      "common": 20,
      "rare": 50,
      "epic": 30
    },
    "intro": "双象交叉斜线，黑王被锁进囚笼。",
    "coachHints": [
      "双象要走不同色斜线",
      "先把黑王逼到边角"
    ]
  },
  {
    "id": "EG-92",
    "name": "象马合杀",
    "fen": "1k6/4N3/8/K7/8/8/4B3/8 w - - 0 1",
    "sideToMove": "w",
    "targetMoves": 4,
    "moveCap": 11,
    "timeLimitSec": 120,
    "difficulty": 5,
    "theme": "mate-in-4·象马合杀",
    "tipId": "tip_bishopknight",
    "skillWeights": {
      "common": 20,
      "rare": 50,
      "epic": 30
    },
    "intro": "象与马配合，把黑王逼入绝境。",
    "coachHints": [
      "象控一种色格，马补另一种",
      "先把黑王逼到角落"
    ]
  },
  {
    "id": "EG-93",
    "name": "升变奇兵",
    "fen": "4k3/6KP/8/8/7Q/8/8/8 w - - 0 1",
    "sideToMove": "w",
    "targetMoves": 4,
    "moveCap": 11,
    "timeLimitSec": 120,
    "difficulty": 5,
    "theme": "mate-in-4·升变奇兵",
    "tipId": "tip_promotion",
    "skillWeights": {
      "common": 20,
      "rare": 50,
      "epic": 30
    },
    "intro": "小兵冲到底线升变，成了压垮黑王的那根稻草。",
    "coachHints": [
      "先看兵能不能冲到第 8 横线",
      "升变不只是变后，变车也能杀"
    ]
  },
  {
    "id": "EG-94",
    "name": "后贴金身",
    "fen": "8/8/8/5K2/8/8/6Q1/k7 w - - 0 1",
    "sideToMove": "w",
    "targetMoves": 4,
    "moveCap": 11,
    "timeLimitSec": 120,
    "difficulty": 5,
    "theme": "mate-in-4·贴身闷杀",
    "tipId": "tip_queenmate",
    "skillWeights": {
      "common": 20,
      "rare": 50,
      "epic": 30
    },
    "intro": "后贴住敌王、自有王来护，闷杀就此成局。",
    "coachHints": [
      "把后送到能贴住黑王的位置",
      "别忘了白王要护住这枚后"
    ]
  },
  {
    "id": "EG-95",
    "name": "双车合围",
    "fen": "8/8/8/8/4R3/6K1/k7/2R5 w - - 0 1",
    "sideToMove": "w",
    "targetMoves": 4,
    "moveCap": 11,
    "timeLimitSec": 120,
    "difficulty": 5,
    "theme": "mate-in-4·双车错",
    "tipId": "tip_tworooks",
    "skillWeights": {
      "common": 20,
      "rare": 50,
      "epic": 30
    },
    "intro": "双车错开两条横线，一层层把黑王逼到边角。",
    "coachHints": [
      "先用一车占住一条横线",
      "两车错开，黑王无处可钻"
    ]
  },
  {
    "id": "EG-96",
    "name": "单车擒王",
    "fen": "8/8/7R/8/8/8/8/1k1K4 w - - 0 1",
    "sideToMove": "w",
    "targetMoves": 4,
    "moveCap": 11,
    "timeLimitSec": 120,
    "difficulty": 5,
    "theme": "mate-in-4·车王逼宫",
    "tipId": "tip_rookking",
    "skillWeights": {
      "common": 20,
      "rare": 50,
      "epic": 30
    },
    "intro": "单车配王，把黑王一步步赶向边线。",
    "coachHints": [
      "白王要跟着推进，别离太远",
      "先把黑王赶到边线"
    ]
  },
  {
    "id": "EG-97",
    "name": "金钩困王",
    "fen": "5B2/8/N7/8/8/8/8/knK5 w - - 0 1",
    "sideToMove": "w",
    "targetMoves": 4,
    "moveCap": 11,
    "timeLimitSec": 120,
    "difficulty": 5,
    "theme": "mate-in-4·闷宫绝杀",
    "tipId": "tip_smother",
    "skillWeights": {
      "common": 20,
      "rare": 50,
      "epic": 30
    },
    "intro": "四周都是自家棋子，黑王动弹不得。",
    "coachHints": [
      "黑王被自家子堵死",
      "重子远程一击即杀"
    ]
  },
  {
    "id": "EG-98",
    "name": "诱敌深入",
    "fen": "2k5/2p2R2/7K/8/8/n7/8/Q7 w - - 0 1",
    "sideToMove": "w",
    "targetMoves": 4,
    "moveCap": 11,
    "timeLimitSec": 120,
    "difficulty": 5,
    "theme": "mate-in-4·弃子引离",
    "tipId": "tip_decoy",
    "skillWeights": {
      "common": 20,
      "rare": 50,
      "epic": 30
    },
    "intro": "先想清楚哪枚子是可以不要的。",
    "coachHints": [
      "用诱饵换开防线",
      "沉车底线收尾"
    ]
  },
  {
    "id": "EG-99",
    "name": "钉住破绽",
    "fen": "3Q1R2/8/8/6bk/8/6K1/8/8 w - - 0 1",
    "sideToMove": "w",
    "targetMoves": 4,
    "moveCap": 11,
    "timeLimitSec": 120,
    "difficulty": 5,
    "theme": "mate-in-4·牵制闪击",
    "tipId": "tip_pin",
    "skillWeights": {
      "common": 20,
      "rare": 50,
      "epic": 30
    },
    "intro": "先钉住，再算闪击的落点。",
    "coachHints": [
      "一子定住敌子",
      "另一子趁机将军"
    ]
  },
  {
    "id": "EG-100",
    "name": "马后抽将",
    "fen": "8/8/3KN3/8/8/8/7k/1Q6 w - - 0 1",
    "sideToMove": "w",
    "targetMoves": 4,
    "moveCap": 11,
    "timeLimitSec": 120,
    "difficulty": 5,
    "theme": "mate-in-4·马后炮",
    "tipId": "tip_knightqueen",
    "skillWeights": {
      "common": 20,
      "rare": 50,
      "epic": 30
    },
    "intro": "马与后呼应，一步将军一步抽子。",
    "coachHints": [
      "马将军的同时后控制退路",
      "两步之内收网"
    ]
  }
];

const TIPS = [
  {
    "id": "tip_backrank",
    "text": "黑王被自己的兵困在底线，一车沉底就是绝杀。",
    "tactic": "底线杀"
  },
  {
    "id": "tip_queenmate",
    "text": "后贴住敌王、自有王来护，闷杀就此成局。",
    "tactic": "贴身闷杀"
  },
  {
    "id": "tip_tworooks",
    "text": "双车错开两条横线，一层层把黑王逼到边角。",
    "tactic": "双车错"
  },
  {
    "id": "tip_rookking",
    "text": "单车配王，把黑王一步步赶向边线。",
    "tactic": "车王逼宫"
  },
  {
    "id": "tip_smother",
    "text": "黑王被自己的子闷住，一记闷宫就够了。",
    "tactic": "闷宫绝杀"
  },
  {
    "id": "tip_decoy",
    "text": "弃一个子把护王的兵引开，底线就空了。",
    "tactic": "弃子引离"
  },
  {
    "id": "tip_pin",
    "text": "牵住对方的子再闪击，暴露的火力才是杀招。",
    "tactic": "牵制闪击"
  },
  {
    "id": "tip_knightqueen",
    "text": "马跳金钩直取将位，顺手还能抽走黑方的子。",
    "tactic": "马后炮"
  },
  {
    "id": "tip_rookknight",
    "text": "车马联手，把黑王封死在边线角落。",
    "tactic": "车马合杀"
  },
  {
    "id": "tip_doublebishop",
    "text": "双象交叉斜线，黑王被锁进囚笼。",
    "tactic": "双象锁王"
  },
  {
    "id": "tip_bishopknight",
    "text": "象与马配合，把黑王逼入绝境。",
    "tactic": "象马合杀"
  },
  {
    "id": "tip_promotion",
    "text": "小兵冲到底线升变，成了压垮黑王的那根稻草。",
    "tactic": "升变奇兵"
  },
  {
    "id": "tip_forced",
    "text": "先看清对手唯一的应手，再落子。",
    "tactic": "强迫着法"
  },
  {
    "id": "tip_king",
    "text": "王也要参战——残局里它可是主力。",
    "tactic": "王的使用"
  },
  {
    "id": "tip_general",
    "text": "算不准时，先找将军、吃子、威胁这三类着法。",
    "tactic": "通用思路"
  }
];

const SKILLS = [
  {
    "id": "skill_hourglass",
    "name": "沙漏",
    "rarity": "普通",
    "type": "即时",
    "effect": "本阵时限 +20s（超时态激活则回补 20s 到计时）",
    "timing": "计时中/超时态",
    "maxPerLevel": 1
  },
  {
    "id": "skill_mirror",
    "name": "明镜",
    "rarity": "普通",
    "type": "即时",
    "effect": "本阵锦囊提示 +2",
    "timing": "轮到玩家时",
    "maxPerLevel": 1
  },
  {
    "id": "skill_undo",
    "name": "回马枪",
    "rarity": "普通",
    "type": "即时",
    "effect": "本阵回马枪次数 +1",
    "timing": "轮到玩家时",
    "maxPerLevel": 1
  },
  {
    "id": "skill_scout",
    "name": "探马",
    "rarity": "稀有",
    "type": "即时",
    "effect": "本阵开局自动高亮“最佳首步”起止格（不耗提示）",
    "timing": "本阵第 1 步前",
    "maxPerLevel": 1
  },
  {
    "id": "skill_freeze",
    "name": "定风珠",
    "rarity": "稀有",
    "type": "即时",
    "effect": "暂停计时 30s（期间玩家正常操作）",
    "timing": "计时中",
    "maxPerLevel": 1
  },
  {
    "id": "skill_master",
    "name": "妙手",
    "rarity": "史诗",
    "type": "即时",
    "effect": "AI 代替你走 1 步当前最佳着（不耗提示/悔棋）",
    "timing": "轮到玩家时",
    "maxPerLevel": 1
  },
  {
    "id": "skill_ward",
    "name": "护身",
    "rarity": "史诗",
    "type": "装备(整阵)",
    "effect": "本阵步数上限 +3，且获得 1 次“免失败”（超步数不判负一次）",
    "timing": "开局前装备",
    "maxPerLevel": 1
  }
];

module.exports = { ENDGAMES, TIPS, SKILLS };
