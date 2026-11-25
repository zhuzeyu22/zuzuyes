import React from 'react';
import { clamp, mulberry32, softmax } from '../utils.js';
import { Frame, fmt } from '../kits/primitives.jsx';

// 小猫图像的分层特征演示。
// 说明：真实 CNN 的卷积核是数据学出来的；这里用固定的「手工核 + 模板匹配」
// 复现同一套层级机制（像素 → 边缘 → 纹理 → 部件 → 整体），让每一层节点的
// 偏好与感受野可以被逐帧观察，而不是把它伪装成训练好的模型。

const N = 16;
const M = 8;
const H = 430;
const CLASSES = ['小猫', '小狗', '背景 / 其他'];
const SUBJECTS = {
  cat: {
    label: '小猫正面照', seed: 9031,
    rows: [
      '..##........##..',
      '.####......####.',
      '#####......#####',
      '################',
      '###++######++###',
      '##+oo##++##oo+##',
      '##+oo##++##oo+##',
      '################',
      '#####++##++#####',
      '######+oo+######',
      '.####++oo++####.',
      '..############..',
      '...###++++###...',
      '....########....',
      '................',
      '................',
    ],
  },
  dog: {
    label: '小狗正面照', seed: 4427,
    rows: [
      '................',
      '...##########...',
      '..##++++++++##..',
      '.###........###.',
      '.##+oo####oo+##.',
      '.##+oo####oo+##.',
      '.##############.',
      '.#####++++#####.',
      '.######++######.',
      '.#######oo######',
      '..#####++#####..',
      '...##########...',
      '....########....',
      '.....######.....',
      '................',
      '................',
    ],
  },
  leaf: {
    label: '一片叶子（干扰项）', seed: 7717,
    rows: [
      '................',
      '.......##.......',
      '.....#####......',
      '....#######.....',
      '...##++#####....',
      '..##+++#####....',
      '..####+#####....',
      '.#####+######...',
      '.######+#####...',
      '..#####+####....',
      '..####+++###....',
      '...####+###.....',
      '....#####.......',
      '......##........',
      '................',
      '................',
    ],
  },
};
const VALUE = { '#': 0.86, '+': 0.46, o: 0.03, '.': 0.05 };

const L1_KERNELS = [
  { name: '水平边缘', note: '对上下明暗跳变敏感，勾出耳朵上沿与脸颊轮廓。', w: [[-1, -2, -1], [0, 0, 0], [1, 2, 1]] },
  { name: '垂直边缘', note: '对左右明暗跳变敏感，勾出脸的两侧边界。', w: [[-1, 0, 1], [-2, 0, 2], [-1, 0, 1]] },
  { name: '斜向边缘', note: '对 45° 方向的亮度变化敏感，正好匹配尖耳朵的斜边。', w: [[0, 1, 2], [-1, 0, 1], [-2, -1, 0]] },
  { name: '角点 / 斑点', note: '中心正、四周负，在拐角和局部亮块处响应最强。', w: [[0, -1, 0], [-1, 4, -1], [0, -1, 0]] },
];
const L2_NAMES = ['毛纹密度', '耳廓斜纹', '暗斑（眼/鼻）', '轮廓拐点'];
const L3_TEMPLATES = [
  { name: '左耳', note: '比较上方偏左的亮三角与旁边的暗背景，匹配猫耳的尖角。', center: [1, 1] },
  { name: '右耳', note: '与左耳左右镜像；两只耳朵同时点亮才更像猫。', center: [1, 6] },
  { name: '双眼', note: '两侧亮、中间暗，对应眼睛与鼻梁的对比；这是猫狗共有的特征。', center: [1, 4] },
  { name: '鼻口', note: '鼻梁亮、鼻头暗，对应鼻子与嘴周的明暗结构。', center: [4, 4] },
];
const DOG_EAR = { name: '垂耳', note: '小狗耳朵贴在头部两侧：上方角落暗、侧脸中段亮。', center: [2, 1] };
const LAYERS = [
  { name: '① 边缘层', sub: '3×3 感受野', channels: L1_KERNELS.map((k) => ({ name: k.name, note: k.note })) },
  { name: '② 纹理层', sub: '5×5 感受野', channels: L2_NAMES.map((name) => ({ name, note: `由上一层局部汇合而来，开始出现「${name}」这种重复结构。` })) },
  { name: '③ 部件层', sub: '9×9 感受野', channels: L3_TEMPLATES.map((t) => ({ name: t.name, note: t.note })) },
  { name: '④ 整体层', sub: '整张图', channels: [
    { name: '猫脸综合', note: '把耳朵、眼睛、鼻口的证据汇总；单一节点不再只代表一条边。' },
    { name: '左耳 + 右耳', note: '两只耳朵的证据叠加，位置容忍度比上一层更高。' },
    { name: '双眼 + 鼻口', note: '面部中央证据叠加，即使轻微左右移动也能保持响应。' },
    { name: '非猫证据', note: '垂耳、叶片轮廓等其他结构的响应，与猫脸证据竞争。' },
  ] },
];

function makeInput(key, noise, occlude) {
  const conf = SUBJECTS[key] || SUBJECTS.cat;
  const rnd = mulberry32(conf.seed);
  const map = conf.rows.map((row) => [...row].map((ch) => clamp((VALUE[ch] ?? 0.05) + (rnd() - 0.5) * noise / 100, 0, 1)));
  // 用中性灰覆盖，而不是涂黑，避免「遮挡」反而制造新的暗斑特征。
  const zones = occlude === 'eye' ? [[2, 7, 3, 6], [2, 7, 9, 12]]
    : occlude === 'ear' ? [[0, 3, 2, 5]] : [];
  for (const [r0, r1, c0, c1] of zones) {
    for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) map[r][c] = 0.46;
  }
  return { map, zones };
}

function conv(map, kernel) {
  const n = map.length;
  const out = Array.from({ length: n }, () => Array(n).fill(0));
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) {
    let s = 0;
    for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) {
      const rr = r + i, cc = c + j;
      s += (rr < 0 || cc < 0 || rr >= n || cc >= n ? 0 : map[rr][cc]) * kernel[i + 1][j + 1];
    }
    out[r][c] = s;
  }
  return out;
}

function absMap(map, scale) { return map.map((row) => row.map((v) => clamp(Math.abs(v) / scale, 0, 1))); }

function downMax(map) {
  const out = [];
  for (let r = 0; r < map.length; r += 2) {
    const row = [];
    for (let c = 0; c < map.length; c += 2) {
      row.push(Math.max(map[r][c], map[r][c + 1] ?? 0, map[r + 1]?.[c] ?? 0, map[r + 1]?.[c + 1] ?? 0));
    }
    out.push(row);
  }
  return out;
}

function downAvg(map) {
  const out = [];
  for (let r = 0; r < map.length; r += 2) {
    const row = [];
    for (let c = 0; c < map.length; c += 2) {
      row.push((map[r][c] + (map[r][c + 1] ?? 0) + (map[r + 1]?.[c] ?? 0) + (map[r + 1]?.[c + 1] ?? 0)) / 4);
    }
    out.push(row);
  }
  return out;
}

function avg(...xs) { return xs.reduce((a, b) => a + b, 0) / xs.length; }

// 部件节点的响应图：在它偏好的位置形成峰值，峰值高度由对比度证据决定。
function blob(center, strength, spread = 1.35) {
  const [cr, cc] = center;
  return Array.from({ length: M }, (_, r) => Array.from({ length: M }, (_, c) => {
    const d2 = (r - cr) ** 2 + (c - cc) ** 2;
    return clamp(strength * Math.exp(-d2 / (2 * spread * spread)), 0, 1);
  }));
}

function combine(maps, weights) {
  return maps[0].map((row, r) => row.map((_, c) => clamp(maps.reduce((s, m, i) => s + weights[i] * m[r][c], 0), 0, 1)));
}

function maxOf(map) { return map.flat().reduce((a, b) => Math.max(a, b), 0); }

function peakOf(map, scale) {
  let best = 0, br = 0, bc = 0;
  map.forEach((row, r) => row.forEach((v, c) => {
    if (v > best) { best = v; br = r; bc = c; }
  }));
  return { r: br * scale, c: bc * scale, value: best };
}

export default {
  id: 'cat-cnn-features',
  params: [
    { key: 'subject', label: '输入图像', type: 'select', default: 'cat', options: [
      { value: 'cat', label: '小猫' },
      { value: 'dog', label: '小狗（对照）' },
      { value: 'leaf', label: '叶子（干扰项）' },
    ] },
    { key: 'layer', label: '聚焦层', type: 'range', min: 1, max: 4, step: 1, default: 3, hint: '边缘 → 纹理 → 部件 → 整体' },
    { key: 'channel', label: '聚焦节点', type: 'range', min: 1, max: 4, step: 1, default: 1 },
    { key: 'occlude', label: '遮挡部位', type: 'select', default: 'none', options: [
      { value: 'none', label: '无遮挡' },
      { value: 'eye', label: '遮住双眼' },
      { value: 'ear', label: '遮住左耳' },
    ] },
    { key: 'noise', label: '拍摄噪声', type: 'range', min: 0, max: 30, step: 5, default: 8, unit: '%' },
  ],
  height: H,
  legend: [
    { label: '输入亮度', color: '#226AFF' },
    { label: '特征响应', color: '#12a06a' },
    { label: '当前节点', color: '#f5a524' },
    { label: '感受野 / 遮挡', color: '#e5484d' },
  ],
  hint: '同一张小猫图，浅层节点只认边缘，中层认纹理，深层才认耳朵、眼睛与整张猫脸。切换输入或遮挡部位，看证据如何逐层塌陷。',

  buildSteps(p) {
    const subject = SUBJECTS[p.subject] ? p.subject : 'cat';
    const occlude = ['none', 'eye', 'ear'].includes(p.occlude) ? p.occlude : 'none';
    const focusLayer = clamp(Math.round(Number(p.layer) || 3), 1, 4);
    const focusChannel = clamp(Math.round(Number(p.channel) || 1), 1, 4) - 1;
    const noise = clamp(Number(p.noise) || 0, 0, 30);
    const { map: input, zones } = makeInput(subject, noise, occlude);

    const l1 = L1_KERNELS.map((k) => absMap(conv(input, k.w), 4));
    const pooled = l1.map(downMax);
    const grid = downAvg(input);
    const dark = grid.map((row) => row.map((v) => clamp((0.55 - v) * 2.2, 0, 1)));
    const l2 = [
      combine([pooled[1], pooled[0]], [0.62, 0.38]),
      pooled[2],
      dark,
      pooled[3],
    ];
    const contrast = (a, b) => clamp((a - b + 0.05) * 1.8, 0, 1);
    const scores = [
      contrast(avg(grid[1][1], grid[1][2], grid[0][1]), avg(grid[1][3], grid[0][3])),
      contrast(avg(grid[1][6], grid[1][5], grid[0][6]), avg(grid[1][4], grid[0][4])),
      contrast(avg(grid[1][1], grid[1][6]), avg(grid[1][3], grid[1][4])),
      contrast(avg(grid[3][3], grid[3][4]), avg(grid[4][3], grid[4][4])),
    ];
    const dogScore = clamp((avg(grid[2][1], grid[3][1]) - avg(grid[0][1], grid[0][6]) + 0.05) * 1.6, 0, 1);
    const l3 = L3_TEMPLATES.map((t, i) => blob(t.center, scores[i]));
    const dogEar = blob(DOG_EAR.center, dogScore);
    const ear = Math.min(scores[0], scores[1]);
    const leafness = clamp(1 - Math.max(scores[0], scores[2], scores[3]), 0, 1);
    const logits = [
      3.0 * ear + 1.4 * scores[2] + 1.2 * scores[3] + 0.8 - 0.4 * leafness,
      5.0 * dogScore * clamp(scores[2] + 0.2, 0, 1) + 1.2 * scores[2] + 0.8 * scores[3] - 1.6 * ear - 0.5,
      4.0 * leafness + 0.6 * (1 - scores[2]) - 0.7 - 0.5 * dogScore,
    ];
    const probs = softmax(logits);
    const l4 = [
      combine(l3, [0.3, 0.3, 0.2, 0.2]),
      combine([l3[0], l3[1]], [0.5, 0.5]),
      combine([l3[2], l3[3]], [0.5, 0.5]),
      combine([dogEar, dark], [0.7, 0.3]),
    ];
    const maps = [l1, l2, l3, l4];

    const steps = [];
    const push = (o) => {
      const reveal = o.reveal || [4, 4, 4, 4];
      const fl = clamp(o.focusLayer || 1, 1, 4);
      const ch = clamp((o.focusChannel || 1) - 1, 0, 3);
      const shown = maps[fl - 1][ch] || maps[0][0];
      const peak = peakOf(shown, fl === 1 ? 1 : 2);
      const rf = [3, 5, 9, 16][fl - 1];
      steps.push({
        subject, occlude, focusLayer: fl, focusChannel: ch + 1, reveal, peak, rf,
        input, zones, maps, scores, dogScore, probs,
        stage: o.stage || 'intro', probsVisible: !!o.probsVisible,
        ...o,
        metrics: {
          聚焦层: fl,
          感受野边长: rf,
          节点峰值: Number(peak.value.toFixed(3)),
          猫证据: Number(ear.toFixed(3)),
          猫概率: Number(probs[0].toFixed(3)),
          ...(o.metrics || {}),
        },
      });
    };

    push({
      note: `输入一张 16×16 的${SUBJECTS[subject].label}。先别急着看结论：网络的浅层节点只会在局部响应，它们并不知道「猫」是什么。`,
      reveal: [0, 0, 0, 0], focusLayer: 1, stage: 'intro',
      metrics: { 聚焦层: 0, 感受野边长: 0, 节点峰值: 0, 猫证据: Number(ear.toFixed(3)) },
    });

    for (let li = 0; li < 4; li++) {
      for (let k = 0; k < 4; k++) {
        const reveal = [0, 0, 0, 0];
        for (let j = 0; j <= li; j++) reveal[j] = 4;
        reveal[li] = k + 1;
        const ch = LAYERS[li].channels[k];
        const peak = peakOf(maps[li][k], li === 0 ? 1 : 2);
        push({
          stage: `L${li + 1}`, focusLayer: li + 1, focusChannel: k + 1, reveal,
          note: li === 0
            ? `第 1 层节点「${ch.name}」：3×3 核扫过整张图，${ch.note}此时峰值落在 (${peak.r}, ${peak.c})。`
            : li === 1
              ? `第 2 层节点「${ch.name}」：汇合上一层局部响应，感受野扩大到约 5×5；${ch.note}`
              : li === 2
                ? `第 3 层节点「${ch.name}」：${ch.note}峰值 ${fmt(peak.value * 100, 1)}%，说明这里出现了对应的部件。`
                : `第 4 层节点「${ch.name}」：${ch.note}`,
          metrics: { 节点峰值: Number(peak.value.toFixed(3)), 激活位置: peak.r * 16 + peak.c },
        });
      }
    }

    push({
      stage: 'summary', focusLayer, focusChannel: focusChannel + 1, probsVisible: false,
      note: `层级已经建好：浅层响应局部明暗，中层汇合成纹理，深层才出现「耳朵 / 眼睛 / 鼻口」这类部件节点。现在聚焦第 ${focusLayer} 层的「${LAYERS[focusLayer - 1].channels[focusChannel].name}」节点，看它到底被图像的哪一块点亮。`,
    });

    for (let k = 0; k < 4; k++) {
      push({
        stage: 'focus', focusLayer, focusChannel: k + 1,
        note: `放大第 ${focusLayer} 层的 ${k + 1}/4 个节点：红色虚框是它能「看到」的输入区域；越深的层，框越大、语义越抽象。`,
      });
    }

    const best = probs.indexOf(Math.max(...probs));
    push({
      stage: 'classify', focusLayer: 4, focusChannel: focusChannel + 1, probsVisible: true,
      note: `分类头汇总证据：左耳 ${fmt(scores[0] * 100, 0)}% + 右耳 ${fmt(scores[1] * 100, 0)}% + 双眼 ${fmt(scores[2] * 100, 0)}% + 鼻口 ${fmt(scores[3] * 100, 0)}%，垂耳 ${fmt(dogScore * 100, 0)}%。`,
    });
    push({
      stage: 'done', focusLayer: 4, focusChannel: focusChannel + 1, probsVisible: true,
      note: occlude === 'none'
        ? `判定为「${CLASSES[best]}」（${fmt(probs[best] * 100, 1)}%）。注意：单个浅层节点只代表一条边，是逐层组合才让深层节点获得「猫脸」含义。`
        : `${occlude === 'eye' ? '遮住双眼' : '遮住左耳'}后，对应部件节点响应下降，猫的概率从完整图的高置信度降到 ${fmt(probs[0] * 100, 1)}%——这就是层级证据的依赖关系。`,
    });
    return steps;
  },

  render(snap, p, c) {
    const focusLayer = clamp(Number(snap.focusLayer) || 1, 1, 4);
    const focusChannel = clamp(Number(snap.focusChannel) || 1, 1, 4) - 1;
    const reveal = Array.isArray(snap.reveal) ? snap.reveal : [4, 4, 4, 4];
    const input = Array.isArray(snap.input) ? snap.input : [];
    const maps = Array.isArray(snap.maps) ? snap.maps : [];
    const zones = Array.isArray(snap.zones) ? snap.zones : [];
    const peak = snap.peak || { r: 0, c: 0, value: 0 };
    const rf = clamp(Number(snap.rf) || 3, 1, N);
    const probs = Array.isArray(snap.probs) ? snap.probs : [0.34, 0.33, 0.33];
    const meta = LAYERS[focusLayer - 1];
    const channel = meta.channels[focusChannel];
    const cell = 9;
    const ix = 24, iy = 86;

    const heat = (map, x, y, unit, color, idx, active) => {
      const arr = Array.isArray(map) ? map : [];
      return (
        <g key={`heat-${idx}`}>
          <rect x={x - 3} y={y - 3} width={M * unit + 6} height={M * unit + 6} rx="4"
            fill={active ? c.warning : c.panel2} opacity={active ? 0.16 : 0.5} />
          {arr.map((row, r) => row.map((v, col) => (
            <rect key={`${r}-${col}`} x={x + col * unit} y={y + r * unit} width={Math.max(1, unit - 1)} height={Math.max(1, unit - 1)}
              rx="1" fill={color} opacity={0.08 + 0.88 * clamp(Number(v) || 0, 0, 1)} />
          )))}
          <text x={x} y={y + M * unit + 13} fontSize="9" fill={active ? c.warning : c.muted}>{String(channel && active ? channel.name : LAYERS[focusLayer - 1].channels[idx]?.name || '')}</text>
        </g>
      );
    };

    const pipeline = LAYERS.map((layer, i) => {
      const x = 24 + i * 172;
      const on = focusLayer === i + 1;
      return (
        <g key={`pipe-${i}`}>
          <rect x={x} y="36" width="152" height="26" rx="5" fill={on ? c.primary : c.panel2} opacity={on ? 0.94 : 0.8} />
          <text x={x + 8} y="53" fontSize="10" fill={on ? c.bg : c.text} fontWeight="600">{String(layer.name)}</text>
          <text x={x + 144} y="53" fontSize="9" textAnchor="end" fill={on ? c.bg : c.muted}>{String(layer.sub)}</text>
          {i < 3 ? <path d={`M${x + 154},49 l7,-4 l0,8 z`} fill={c.accent} /> : null}
        </g>
      );
    });

    const pixels = input.map((row, r) => row.map((v, col) => (
      <rect key={`px-${r}-${col}`} x={ix + col * cell} y={iy + r * cell} width={cell - 1} height={cell - 1}
        rx="1" fill={c.primary} opacity={0.05 + 0.9 * clamp(Number(v) || 0, 0, 1)} />
    )));
    const half = Math.floor(rf / 2);
    const rfRect = reveal[focusLayer - 1] > 0 ? (
      <rect x={ix + clamp(peak.c - half, 0, N - rf) * cell} y={iy + clamp(peak.r - half, 0, N - rf) * cell}
        width={rf * cell - 1} height={rf * cell - 1} rx="2" fill="none" stroke={c.danger} strokeWidth="1.6" strokeDasharray="3 2" />
    ) : null;
    const occlusions = zones.map(([r0, r1, c0, c1], i) => (
      <rect key={`occ-${i}`} x={ix + c0 * cell} y={iy + r0 * cell} width={(c1 - c0 + 1) * cell} height={(r1 - r0 + 1) * cell}
        fill="none" stroke={c.danger} strokeWidth="1.4" strokeDasharray="4 3" opacity="0.9" />
    ));

    const currentMaps = maps[focusLayer - 1] || [];
    const gallery = currentMaps.map((m, i) => heat(m, 198 + (i % 2) * 86, 88 + Math.floor(i / 2) * 96, 8,
      c.success, i, i === focusChannel && reveal[focusLayer - 1] > i));

    const bars = meta.channels.map((ch, i) => {
      const m = currentMaps[i] || [];
      const val = maxOf(m);
      const y = 96 + i * 36;
      const on = i === focusChannel;
      return (
        <g key={`bar-${i}`}>
          <text x="394" y={y} fontSize="10" fill={on ? c.warning : c.muted}>{String(ch.name)}</text>
          <rect x="472" y={y - 9} width="150" height="12" rx="4" fill={c.panel2} />
          <rect x="472" y={y - 9} width={150 * val} height="12" rx="4" fill={on ? c.warning : c.series[i % c.series.length]} opacity="0.9" />
          <text x="700" y={y + 1} fontSize="9" textAnchor="end" fill={c.text}>{fmt(val * 100, 0)}%</text>
        </g>
      );
    });

    const classBars = CLASSES.map((name, i) => {
      const v = clamp(Number(probs[i]) || 0, 0, 1);
      const y = 288 + i * 30;
      return (
        <g key={`cls-${i}`}>
          <text x="394" y={y + 9} fontSize="10" fill={c.muted}>{String(name)}</text>
          <rect x="472" y={y} width="150" height="12" rx="4" fill={c.panel2} />
          <rect x="472" y={y} width={150 * v} height="12" rx="4" fill={c.series[i % c.series.length]} opacity="0.92" />
          <text x="700" y={y + 10} fontSize="9" textAnchor="end" fill={c.text}>{fmt(v * 100, 1)}%</text>
        </g>
      );
    });

    return (
      <Frame c={c} height={H} title="小猫图像 · 多层 CNN 的节点各看什么"
        subtitle={`${String(SUBJECTS[snap.subject]?.label || '小猫')} · 聚焦第 ${focusLayer} 层 · ${String(channel?.name || '')}`}>
        {pipeline}
        <text x="24" y="77" fontSize="10" fill={c.muted}>输入图像 16×16（虚框 = 当前节点感受野）</text>
        {pixels}
        {rfRect}
        {occlusions}
        <text x="198" y="77" fontSize="10" fill={c.muted}>当前层 4 个节点的响应图</text>
        {gallery}
        <text x="394" y="77" fontSize="10" fill={c.muted}>节点响应强度</text>
        {bars}
        <text x="394" y="270" fontSize="10" fill={c.muted}>分类头（逐层证据汇总后）</text>
        {snap.probsVisible ? classBars : (
          <text x="394" y="300" fontSize="10" fill={c.muted}>等待深层证据汇总…</text>
        )}
        <line x1="24" y1="386" x2="700" y2="386" stroke={c.grid} />
        <text x="24" y="404" fontSize="10" fill={c.text}>{String(snap.note || '')}</text>
        <text x="24" y="422" fontSize="9" fill={c.muted}>
          {`说明：这里的卷积核与部件模板是固定的教学示例；真实网络由数据学出滤波器，但同样呈现「边缘 → 纹理 → 部件 → 整体」的层级。`}
        </text>
      </Frame>
    );
  },
};
