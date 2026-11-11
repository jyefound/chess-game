'use strict';
const assert = require('assert');
const center = require('./src/scenes/personalCenter');

assert.strictEqual(center.currentTitle({ total: 0, cleared: 0 }), '静心学棋');
assert.deepStrictEqual(center.honors({ total: 0, cleared: 0 }), []);
assert.strictEqual(center.currentTitle({ total: 1, cleared: 0 }), '初次交锋');
assert.ok(center.honors({ total: 1, cleared: 0 }).includes('初次交锋'));
assert.strictEqual(center.currentTitle({ total: 10, cleared: 0 }), '常来棋友');
assert.ok(center.honors({ total: 25, cleared: 0 }).includes('棋谱收藏家'));
assert.strictEqual(center.currentTitle({ total: 0, cleared: 5 }), '残局行者');
assert.strictEqual(center.currentTitle({ total: 25, cleared: 10 }), '残局研习者');
assert.ok(center.honors({ total: 10, cleared: 10 }).includes('残局研习者'));
console.log('个人中心头衔与荣誉门槛测试通过：9 项 / 0 失败');
