/**
 * 棋谱模式文案（mode → 人类可读标签）与对手名回落，供 records.js / replay.js 共用。
 * 避免两处各写一份三元导致文案漂移；尤其远程模式（mode:'remote'）缺 opponent 时
 * 旧三元会错显成「人机对战」。
 *
 * 远程对局（邀请好友加入）写入本地棋谱时，opponent 由 gameplay 侧填为对端昵称
 * （ai→`AI · 难度`，local→`本地对手`，remote→对端昵称或 `远程对手`）。
 * 本模块遵循：有 opponent 直接显示（昵称即可见），仅在缺失时按 mode 回落，
 * 且不二次改写 `本地对手` / `远程对手` 等既有值。
 */
const MODE_LABEL = { ai: '人机对战', local: '本地双人', remote: '远程对弈' };

function modeLabel(mode) { return MODE_LABEL[mode] || '对局'; }

function opponentLabel(rec) {
  if (rec && rec.opponent) return rec.opponent;
  const m = rec && rec.mode;
  if (m === 'local') return '本地对手';
  if (m === 'remote') return '远程对手';
  if (m === 'ai') return '人机对战';
  return '对局';
}

module.exports = { MODE_LABEL, modeLabel, opponentLabel };
