/**
 * 三套全局主题。主题只覆盖语义 Token，不改变棋局规则/存档/交互行为。
 * 儿童主题采用柔和低刺激色彩，并保持文字、棋子与棋盘格的清晰对比。
 */
const PALETTES = {
  light: {
    bgBase:'#F4F2EC',bgElev:'#FFFFFF',surface1:'#FFFFFF',surface2:'#ECEAE3',surface3:'#DDDCD3',
    border:'#D7D8D1',borderStrong:'#B9BDB6',accent:'#8C7650',accentSoft:'#B49B70',accentDeep:'#6F5A38',
    accentFade:'rgba(140,118,80,0.13)',accentLine:'rgba(140,118,80,0.22)',petrol:'#617D78',petrolBright:'#789A92',petrolDeep:'#405C57',
    boardLight:'#F4EEDC',boardDark:'#91AAA2',boardFrame:'#D8D1C2',coordOnLight:'#526C65',coordOnDark:'#F5F7F2',
    pieceWhiteFill:'#FFFDF6',pieceWhiteShade:'#E7E1D2',pieceWhiteStroke:'#454640',pieceBlackFill:'#465650',pieceBlackShade:'#263832',pieceBlackStroke:'#F5E9C9',
    success:'#43866A',warning:'#A8752E',danger:'#B94E52',info:'#477E9B',neutralBadge:'#74817D',
    textPrimary:'#28312F',textSecondary:'#59645F',textTertiary:'#78827D',textOnAccent:'#FFFFFF',overlay:'rgba(28,35,32,0.48)',
    hlLastMove:'rgba(188,157,94,0.30)',hlSelected:'rgba(98,132,119,0.20)',hlLegal:'#F8FFF7',hlCapture:'#B94E62',hlCheck:'rgba(185,78,82,0.62)',
    hlSelectedRing:'#496D61',hlSelectedCasing:'rgba(255,255,255,0.72)',hlLegalDot:'#FFFFFF',hlCaptureRing:'#A83E55',hlCaptureCasing:'rgba(255,255,255,0.78)',
    hlLastMoveEdge:'rgba(143,111,54,0.80)',hlHintJade:'#438F7A',hlHintCasing:'rgba(255,255,255,0.72)',
    coordBand:'rgba(244,238,220,0.88)',coordBandActive:'#FFFFFF',dangerFade:'rgba(185,78,82,0.12)',blackFade:'rgba(30,42,38,0.08)',
    neutralBadgeFade:'rgba(116,129,125,0.13)',successFade:'rgba(67,134,106,0.13)',infoFade:'rgba(71,126,155,0.13)',bgFade:'rgba(40,49,47,0.06)',disabledFg:'#9BA39F'
  },
  kids: {
    bgBase:'#F1F7FF',bgElev:'#FFFFFF',surface1:'#FFFFFF',surface2:'#E8F1FF',surface3:'#D9E8FA',
    border:'#C9D9EE',borderStrong:'#A9C2E1',accent:'#E6A83E',accentSoft:'#F3C96D',accentDeep:'#A66D1B',
    accentFade:'rgba(230,168,62,0.18)',accentLine:'rgba(230,168,62,0.30)',petrol:'#5A91B8',petrolBright:'#80B5D8',petrolDeep:'#3F6F98',
    boardLight:'#FFF4D9',boardDark:'#8BB9D5',boardFrame:'#D5E6F5',coordOnLight:'#537A9B',coordOnDark:'#FFFFFF',
    pieceWhiteFill:'#FFFFFF',pieceWhiteShade:'#E6F0FC',pieceWhiteStroke:'#42617F',pieceBlackFill:'#536E9B',pieceBlackShade:'#344D79',pieceBlackStroke:'#FFFFFF',
    success:'#4D9B79',warning:'#B7792A',danger:'#D45E69',info:'#4A8EB8',neutralBadge:'#6F88A5',
    textPrimary:'#263B58',textSecondary:'#536B89',textTertiary:'#788DA8',textOnAccent:'#4C3511',overlay:'rgba(35,55,83,0.48)',
    hlLastMove:'rgba(245,191,91,0.38)',hlSelected:'rgba(91,151,207,0.22)',hlLegal:'#FFFFFF',hlCapture:'#D85B78',hlCheck:'rgba(212,94,105,0.66)',
    hlSelectedRing:'#397CB6',hlSelectedCasing:'rgba(255,255,255,0.82)',hlLegalDot:'#FFFFFF',hlCaptureRing:'#C8496B',hlCaptureCasing:'rgba(255,255,255,0.84)',
    hlLastMoveEdge:'rgba(211,145,45,0.82)',hlHintJade:'#42A88E',hlHintCasing:'rgba(255,255,255,0.82)',
    coordBand:'rgba(232,241,255,0.90)',coordBandActive:'#FFFFFF',dangerFade:'rgba(212,94,105,0.13)',blackFade:'rgba(38,59,88,0.07)',
    neutralBadgeFade:'rgba(111,136,165,0.13)',successFade:'rgba(77,155,121,0.13)',infoFade:'rgba(74,142,184,0.13)',bgFade:'rgba(38,59,88,0.06)',disabledFg:'#A0B0C3'
  }
};
function getPalette(id){return PALETTES[id]||null;}
module.exports={PALETTES,getPalette};
