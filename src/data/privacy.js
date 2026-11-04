/**
 * 账号与隐私 · 纯文案常量（v3）
 *
 * 本文件只放文本，不含任何色值 / 字号 / 圆角 / 平台接口：所有渲染一律由
 * settings.js 走 C.* / theme.font(k) / R.*。微信小游戏纯 CommonJS，
 * 顶层绝不触碰 wx / DOM / eval / 网络能力。
 *
 * 消费方：src/scenes/settings.js 的「账号与隐私」分组、授权状态行、资料弹窗、
 * 隐私声明分段弹窗、删除云端数据二次确认，以及对局内设置抽屉（复用同一模块）。
 */
'use strict';

// ---- 独立文案片段（先定义，供 POLICY_SECTIONS 拼接，避免文案漂移）----
const AGE_HINT = '适龄提示：8+（建议 8 周岁以上）';
const MINOR_NOTICE = '不满 14 周岁须监护人同意；家长可用腾讯成长守护、微信未成年人模式管理时长与消费。';
const PROFILE_TIPS = '基本资料仅包含你自行填写的昵称：不索取微信头像与昵称，可随时修改或清除。';
const DENY_HINT = '拒绝授权后本次不再上传、不影响玩法，可随时在设置中重新开启。';
const DELETE_DATA_CONFIRM = '将删除云端进度副本并撤回授权，此操作不可撤销；本地棋谱与设置仍保留，可在设置中单独清空棋谱。是否继续？';
const CONTACT_PLACEHOLDER = '客服/举报：邮箱与电话【需在上线前填实】。';
const VERSION_HINT = '本版本为云端 + 本地双份存储，云端副本可随时删除。';

const POLICY_TITLE = '隐私声明';

// 状态文案映射：授权状态行按 privacy.getState() / sync.status() / cloud.isEnabled() 取用。
const CLOUD_STATUS = {
  off: '云同步未开启 · 本次不再上传；云端已有副本可在下方删除',
  unauthorized: '等待隐私授权 · 授权后才会同步',
  denied: '已拒绝授权 · 仅本地模式，可重新开启',
  syncing: '正在同步…',
  synced: '已授权 · 云同步正常',
  error: '同步异常 · 将在下次自动重试'
};

// 8 段，逐段一个通用 confirm 模态。每段 heading 作小标题、body 作正文，
// 拼接后控制在通用模态 6 行折行上限内（不新增场景 / 不新增滚动容器）。
const POLICY_SECTIONS = [
  { heading: '一、收集的信息',
    body: '仅 openid + 本机游戏数据（设置/棋谱/进度）与自填昵称。不收集微信头像、昵称、手机号、位置、通讯录，不索取 scope.userInfo。' },
  { heading: '二、使用目的',
    body: '仅用于换设备或清缓存后恢复进度，不用于广告、画像、营销或自动化决策。' + DENY_HINT },
  { heading: '三、上传与存储',
    body: '授权并开启同步后，经腾讯云微信云开发存于境内，按 openid 隔离。' + VERSION_HINT },
  { heading: '四、第三方 SDK',
    body: '仅用微信官方基础库与云开发能力，未接入第三方统计/广告/推送 SDK，不向第三方共享信息。' },
  { heading: '五、存储期限',
    body: '本地数据保留至主动清除；云端数据在撤回授权或删除后按平台策略清理。删除小程序不会自动清云端，请先删除。' },
  { heading: '六、你的权利',
    body: '可随时查看/更正昵称、删除云端数据、撤回授权，均不影响玩法，并可随时重新开启同步。' },
  { heading: '七、儿童个人信息',
    body: AGE_HINT + '。' + MINOR_NOTICE },
  { heading: '八、联系我们',
    body: CONTACT_PLACEHOLDER + '查询、更正、删除或投诉举报，核实身份后合理期限内响应。' }
];

module.exports = {
  POLICY_TITLE: POLICY_TITLE,
  POLICY_SECTIONS: POLICY_SECTIONS,
  AGE_HINT: AGE_HINT,
  MINOR_NOTICE: MINOR_NOTICE,
  PROFILE_TIPS: PROFILE_TIPS,
  DENY_HINT: DENY_HINT,
  DELETE_DATA_CONFIRM: DELETE_DATA_CONFIRM,
  CONTACT_PLACEHOLDER: CONTACT_PLACEHOLDER,
  CLOUD_STATUS: CLOUD_STATUS,
  VERSION_HINT: VERSION_HINT
};
