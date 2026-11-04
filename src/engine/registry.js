'use strict';
/**
 * 棋类引擎注册表
 *
 * registerGame(id, adapterFactory) — 注册棋种：adapterFactory() 返回满足
 *   src/engine/interface.js 契约的引擎实例（每次 getGame 都是新实例）。
 * getGame(id)   — 取引擎实例（factory()）；未注册返回 null。
 * listGames()   — 已注册 id 数组。
 * hasGame(id)   — 是否已注册。
 *
 * 内置注册：'chess'（src/engine/chess/，已实现）。
 * xiangqi / gomoku / go 占位就绪后在此 registerGame 即可上线。
 */
var _games = Object.create(null);

function registerGame(id, adapterFactory) {
  if (typeof id !== 'string' || !id) return false;
  if (typeof adapterFactory !== 'function') return false;
  _games[id] = adapterFactory;
  return true;
}

function getGame(id) {
  var factory = _games[id];
  return factory ? factory() : null;
}

function listGames() {
  return Object.keys(_games);
}

function hasGame(id) {
  return !!_games[id];
}

// 内置棋种：国际象棋（适配器包装 src/core/movegen.js + game.js）
registerGame('chess', require('./chess').createChessEngine);

module.exports = {
  registerGame: registerGame,
  getGame: getGame,
  listGames: listGames,
  hasGame: hasGame
};
