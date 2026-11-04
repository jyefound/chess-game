'use strict';
/**
 * 搜索薄封装：直接转发 src/core/ai.js 的分帧搜索生成器。
 *
 * createSearch(board, color, state, maxDepth, timeBudgetMs, sliceMs) →
 *   { step(), finish(), done, bestMove, ... }（见 core/ai.js）。
 * 各棋种适配器/场景统一从这里取搜索，便于日后按棋种分派不同实现。
 */
module.exports = require('../core/ai');
