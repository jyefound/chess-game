'use strict';
/**
 * 离线音效生成器（构建工具，不属于游戏运行时）。
 *
 * 约束：不获取外部素材、不新增 npm 依赖。仅用 Node 内置 fs + 手工构造 WAV(PCM16) 头，
 * 为 src/core/audio.js 的 RES 表 22 个键生成极短 WAV 音效（不同频率/时长/包络的纯音或双音），
 * 写入 src/assets/audio/*.wav。单文件小巧（≤~15KB）。
 *
 * 运行：node tools/gen-audio.js
 */
var fs = require('fs');
var path = require('path');

var SR = 16000;            // 采样率（16kHz，足够短音效，体积更小）
var OUT_DIR = path.join(__dirname, '..', 'src', 'assets', 'audio');

// 包络：每段做 5ms attack + 10ms release，避免爆音/咔哒。
function buildSamples(segs) {
  var out = [];
  segs.forEach(function (seg) {
    var dur = seg.dur;
    var vol = (typeof seg.vol === 'number') ? seg.vol : 1;
    var freqs = Array.isArray(seg.f) ? seg.f : [seg.f];
    var n = Math.max(1, Math.floor(SR * dur));
    var attack = Math.min(Math.floor(SR * 0.005), Math.floor(n / 4));
    var release = Math.min(Math.floor(SR * 0.010), Math.floor(n / 4));
    for (var i = 0; i < n; i++) {
      var t = i / SR;
      var s = 0;
      for (var k = 0; k < freqs.length; k++) {
        var ph = 2 * Math.PI * freqs[k] * t;
        var v;
        if (seg.type === 'square') v = Math.sin(ph) >= 0 ? 1 : -1;
        else if (seg.type === 'noise') v = Math.random() * 2 - 1;
        else v = Math.sin(ph);            // sine
        s += v;
      }
      s /= freqs.length;                  // 多音叠加归一
      var env = 1;
      if (i < attack) env = i / attack;
      else if (i > n - release) env = (n - i) / release;
      out.push(s * vol * env);
    }
  });
  return out;
}

function encodeWav(samples) {
  var numSamples = samples.length;
  var dataSize = numSamples * 2;          // 16-bit mono
  var buf = Buffer.alloc(44 + dataSize);
  buf.write('RIFF', 0, 'ascii');
  buf.writeUInt32LE(36 + dataSize, 4);
  buf.write('WAVE', 8, 'ascii');
  buf.write('fmt ', 12, 'ascii');
  buf.writeUInt32LE(16, 16);              // fmt chunk size
  buf.writeUInt16LE(1, 20);               // PCM
  buf.writeUInt16LE(1, 22);               // mono
  buf.writeUInt32LE(SR, 24);
  buf.writeUInt32LE(SR * 2, 28);          // byteRate = SR * channels * bytes
  buf.writeUInt16LE(2, 32);               // blockAlign = channels * bytes
  buf.writeUInt16LE(16, 34);              // bitsPerSample
  buf.write('data', 36, 'ascii');
  buf.writeUInt32LE(dataSize, 40);
  var off = 44;
  for (var i = 0; i < numSamples; i++) {
    var v = Math.max(-1, Math.min(1, samples[i]));
    buf.writeInt16LE(Math.round(v * 32767), off);
    off += 2;
  }
  return buf;
}

// 22 条音效规格（键名与 audio.js RES 表一一对应）
var SPECS = {
  tap:             [{ f: 1200, dur: 0.04, vol: 0.5 }],
  select:          [{ f: 900,  dur: 0.05, vol: 0.6 }],
  move:            [{ f: 520,  dur: 0.08, vol: 0.8 }],            // 落子
  capture:         [{ f: 720, dur: 0.02, vol: 0.7 }, { f: 340, dur: 0.10, vol: 0.9 }], // 吃子：低沉冲击
  check:           [{ f: 880, dur: 0.07, vol: 0.7 }, { f: 1100, dur: 0.08, vol: 0.7 }], // 将军：双音警示
  win:             [{ f: 523, dur: 0.10, vol: 0.8 }, { f: 659, dur: 0.10, vol: 0.8 }, { f: 784, dur: 0.10, vol: 0.8 }, { f: 1047, dur: 0.12, vol: 0.8 }], // 上行琶音
  lose:            [{ f: 392, dur: 0.12, vol: 0.7 }, { f: 330, dur: 0.12, vol: 0.7 }, { f: 262, dur: 0.14, vol: 0.7 }], // 下行
  draw:            [{ f: 440, dur: 0.18, vol: 0.7 }],
  tutorialCorrect: [{ f: 660, dur: 0.06, vol: 0.7 }, { f: 990, dur: 0.08, vol: 0.7 }], // 上行两音
  tutorialWrong:   [{ f: 200, dur: 0.12, vol: 0.6, type: 'square' }],                  // 低沉方波
  undo:            [{ f: 550, dur: 0.05, vol: 0.6 }, { f: 440, dur: 0.05, vol: 0.6 }], // 下行
  saveRecord:      [{ f: 700, dur: 0.06, vol: 0.7 }],
  uiError:         [{ f: 250, dur: 0.12, vol: 0.6, type: 'square' }],                  // 非法/错误：短促方波
  hint:            [{ f: 1320, dur: 0.06, vol: 0.5 }],                                  // 轻叮
  coachSay:        [{ f: 500, dur: 0.08, vol: 0.4 }],
  coachPraise:     [{ f: 784, dur: 0.06, vol: 0.6 }, { f: 1047, dur: 0.08, vol: 0.6 }], // 清脆上行
  coachWarn:       [{ f: 660, dur: 0.06, vol: 0.5 }, { f: 440, dur: 0.08, vol: 0.5 }],  // 柔和下行
  skillUse:        [{ f: 1000, dur: 0.05, vol: 0.6 }, { f: 400, dur: 0.06, vol: 0.6 }], // 短促嗖（下行）
  skillGet:        [{ f: [523, 659], dur: 0.15, vol: 0.6 }],                            // 上行小和弦
  levelClear:      [{ f: 523, dur: 0.12, vol: 0.7 }, { f: 659, dur: 0.12, vol: 0.7 }, { f: 784, dur: 0.14, vol: 0.7 }], // 上行和弦
  levelFail:       [{ f: 392, dur: 0.10, vol: 0.5 }, { f: 330, dur: 0.10, vol: 0.5 }, { f: 262, dur: 0.12, vol: 0.5 }], // 柔和下行（非刺耳）
  timerWarn:       [{ f: 900, dur: 0.10, vol: 0.6 }]                                    // 单次轻警示
};

function main() {
  if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });
  var keys = Object.keys(SPECS);
  var manifest = [];
  keys.forEach(function (key) {
    var samples = buildSamples(SPECS[key]);
    var buf = encodeWav(samples);
    var file = path.join(OUT_DIR, key + '.wav');
    fs.writeFileSync(file, buf);
    var durMs = Math.round(samples.length / SR * 1000);
    manifest.push({ key: key, file: 'src/assets/audio/' + key + '.wav', bytes: buf.length, durMs: durMs });
  });
  // 资产清单（供人工核对）
  var lines = ['# assets/audio 资产清单（由 tools/gen-audio.js 生成）',
    '', '| 文件名 | 对应音效 | 时长(ms) | 大小(bytes) |',
    '|---|---|---|---|'];
  manifest.forEach(function (m) {
    lines.push('| ' + m.key + '.wav | ' + m.key + ' | ' + m.durMs + ' | ' + m.bytes + ' |');
  });
  fs.writeFileSync(path.join(OUT_DIR, 'MANIFEST.md'), lines.join('\n') + '\n');
  console.log('Generated ' + manifest.length + ' wav files into ' + OUT_DIR);
  manifest.forEach(function (m) { console.log('  ' + m.key + '.wav  ' + m.durMs + 'ms  ' + m.bytes + 'B'); });
}

main();
