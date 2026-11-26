import React from 'react';
import { clamp, mulberry32, softmax } from '../utils.js';
import { Frame, fmt } from '../kits/primitives.jsx';
import { PHOTOS } from '../photos/cat-cnn-photos.js';

// 真实照片上的多层 CNN：完整展示 卷积扫描 → ReLU → 池化 → 跨层汇合 → 部件匹配 → 分类。
// 输入来自 Unsplash / Pexels 免费图库，离线嵌入为 16×16 灰度网格 + 64×64 缩略图。
// 卷积核与部件模板是固定的教学示例；真实网络的滤波器从数据中学得。

const N = 16;
const S = 8;
const H = 470;
const CLASSES = ['小猫', '小狗', '背景 / 其他'];
const SUBJECTS = {
  cat: { label: '真实小猫照片', source: 'Pexels · 6346677', seed: 31 },
  dog: { label: '真实小狗照片', source: 'Unsplash · 1543466835', seed: 47 },
  leaf: { label: '真实叶片照片', source: 'Pexels · 691043', seed: 59 },
};

const K1 = [
  { name: '水平边缘', w: [[-1, -2, -1], [0, 0, 0], [1, 2, 1]] },
  { name: '垂直边缘', w: [[-1, 0, 1], [-2, 0, 2], [-1, 0, 1]] },
  { name: '斜向边缘', w: [[0, 1, 2], [-1, 0, 1], [-2, -1, 0]] },
  { name: '角点响应', w: [[0, -1, 0], [-1, 4, -1], [0, -1, 0]] },
];
const W2 = [
  [1, 0.6, 0.3, 0.2],
  [0.3, 0.2, 1, 0.5],
  [0.2, 0.5, 0.4, 1],
  [0.6, 0.3, 0.5, 0.4],
];
const K2 = [
  [[0, 1, 0], [1, -4, 1], [0, 1, 0]],
  [[-1, 0, 1], [-1, 0, 1], [-1, 0, 1]],
  [[1, 1, 1], [0, 0, 0], [-1, -1, -1]],
  [[0, -1, 0], [-1, 4, -1], [0, -1, 0]],
];
const PARTS = [
  { name: '左耳', r: 2, c: 2, note: '从猫照 L2 特征中取左耳附近的 3×3 模板，在整张特征图上滑动匹配。' },
  { name: '右耳', r: 1, c: 5, note: '右耳模板与左耳镜像，只在猫照上同时出现高响应。' },
  { name: '双眼', r: 4, c: 5, note: '眼部模板包含暗瞳孔与亮眼白，猫狗都有，但位置不同。' },
  { name: '鼻口', r: 5, c: 5, note: '鼻口模板匹配鼻梁亮、鼻头暗的结构，进一步确认猫脸。' },
];
const LAYERS = [
  { name: '① 边缘层', sub: '3×3 感受野', channels: K1.map((k) => ({ name: k.name, note: `3×3 核逐行扫描像素，提取${k.name}。` })) },
  { name: '② 纹理层', sub: '5×5 感受野', channels: [
    { name: '纹理 A', note: '在池化后的 4 张边缘图上再做 3×3 卷积，跨通道加权汇合。' },
    { name: '纹理 B', note: '同一批边缘图，另一组通道权重，响应不同的局部组合。' },
    { name: '纹理 C', note: '第三组权重，开始出现条纹与块状的重复结构。' },
    { name: '纹理 D', note: '第四组权重，保留角点与斑块的汇合响应。' },
  ] },
  { name: '③ 部件层', sub: '9×9 感受野', channels: PARTS.map((p) => ({ name: p.name, note: p.note })) },
  { name: '④ 整体层', sub: '整张图', channels: [
    { name: '猫脸证据', note: '四个部件节点的响应汇合成「猫脸」证据。' },
    { name: '部件一致性', note: '耳朵、眼睛、鼻口同时在场时才强，单一部件不足以判定。' },
    { name: '垂耳证据', note: '小狗的垂耳模板，与猫耳竞争。' },
    { name: '背景证据', note: '与叶片原型的相似度，作为背景判定依据。' },
  ] },
];

function conv(map, k) {
  const n = map.length;
  const out = [];
  for (let r = 0; r < n; r++) {
    const row = [];
    for (let c = 0; c < n; c++) {
      let s = 0;
      for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) {
        const rr = r + i, cc = c + j;
        s += (rr < 0 || cc < 0 || rr >= n || cc >= n ? 0 : map[rr][cc]) * k[i + 1][j + 1];
      }
      row.push(s);
    }
    out.push(row);
  }
  return out;
}
const reluOf = (m) => m.map((row) => row.map((v) => Math.max(0, v)));
function normalize(m, scale) { return m.map((row) => row.map((v) => clamp(v / scale, 0, 1))); }
function downMax(m) {
  const out = [];
  for (let r = 0; r < m.length; r += 2) {
    const row = [];
    for (let c = 0; c < m.length; c += 2) row.push(Math.max(m[r][c], m[r][c + 1], m[r + 1][c], m[r + 1][c + 1]));
    out.push(row);
  }
  return out;
}
function downMax8(m) {
  if (m.length === S) return m;
  const out = [];
  for (let r = 0; r < N; r += 2) {
    const row = [];
    for (let c = 0; c < N; c += 2) row.push(Math.max(m[r][c], m[r][c + 1], m[r + 1][c], m[r + 1][c + 1]));
    out.push(row);
  }
  return out;
}
function l1Of(grid) { return K1.map((k) => normalize(reluOf(conv(grid, k.w)), 4)); }
function l2Of(grid) {
  const pooled = l1Of(grid).map(downMax);
  return K2.map((k, oc) => {
    let acc = pooled[0].map((row) => row.map(() => 0));
    for (let ch = 0; ch < 4; ch++) {
      const c = conv(pooled[ch], k);
      acc = acc.map((row, r) => row.map((v, j) => v + W2[oc][ch] * c[r][j]));
    }
    return normalize(reluOf(acc), 3);
  });
}
function patch(maps, r, c) {
  return maps.map((m) => [0, 1, 2].map((dr) => [0, 1, 2].map((dc) => m[r + dr][c + dc])));
}
function centered(t) {
  const vals = t.flat(Infinity);
  const mu = vals.reduce((a, b) => a + b, 0) / Math.max(1, vals.length);
  return t.map((ch) => ch.map((row) => row.map((v) => v - mu)));
}
function ncc(t, p) {
  const tc = centered(t);
  const vals = p.flat(Infinity);
  const mu = vals.reduce((a, b) => a + b, 0) / Math.max(1, vals.length);
  let dot = 0, nt = 0, np = 0;
  for (let ch = 0; ch < 4; ch++) for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) {
    const pv = p[ch][r][c] - mu;
    dot += tc[ch][r][c] * pv; nt += tc[ch][r][c] ** 2; np += pv ** 2;
  }
  return clamp(dot / Math.sqrt(Math.max(1e-9, nt * np)), 0, 1);
}
function scoreMap(maps, template) {
  const out = Array.from({ length: S }, () => Array(S).fill(0));
  for (let r = 0; r <= S - 3; r++) for (let c = 0; c <= S - 3; c++) out[r][c] = ncc(template, patch(maps, r, c));
  return out;
}
function cosine(a, b) {
  const x = a.flat(), y = b.flat();
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < x.length; i++) { dot += x[i] * y[i]; na += x[i] ** 2; nb += y[i] ** 2; }
  return clamp(dot / Math.sqrt(Math.max(1e-9, na * nb)), 0, 1);
}
function avg(...xs) { return xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length); }
function maxOf(m) { return (Array.isArray(m) ? m.flat() : []).reduce((a, b) => Math.max(a, Number(b) || 0), 0); }
function blob(strength, center = [4, 4], spread = 1.6) {
  return Array.from({ length: S }, (_, r) => Array.from({ length: S }, (_, c) =>
    clamp(strength * Math.exp(-(((r - center[0]) ** 2 + (c - center[1]) ** 2) / (2 * spread * spread))), 0, 1)));
}
function peakOf(map, scale) {
  let best = 0, br = 0, bc = 0;
  (Array.isArray(map) ? map : []).forEach((row, r) => row.forEach((v, c) => {
    if (v > best) { best = v; br = r; bc = c; }
  }));
  return { r: br * scale, c: bc * scale, value: best };
}
function revealAt(layer, count) {
  const a = [0, 0, 0, 0];
  for (let j = 0; j < layer - 1; j++) a[j] = 4;
  a[layer - 1] = count;
  return a;
}
function wrapLines(s, width = 54) {
  const str = String(s || '');
  const out = [];
  for (let i = 0; i < str.length; i += width) out.push(str.slice(i, i + width));
  return out.slice(0, 2);
}

const CAT_L2 = l2Of(PHOTOS.cat.grid);
const DOG_L2 = l2Of(PHOTOS.dog.grid);
const PART_TEMPLATES = PARTS.map((p) => patch(CAT_L2, p.r, p.c));
const DOG_TEMPLATE = patch(DOG_L2, 2, 2);

export default {
  id: 'cat-cnn-features',
  params: [
    { key: 'subject', label: '输入照片', type: 'select', default: 'cat', options: [
      { value: 'cat', label: '小猫（真实照片）' },
      { value: 'dog', label: '小狗（对照）' },
      { value: 'leaf', label: '叶片（干扰项）' },
    ] },
    { key: 'layer', label: '聚焦层', type: 'range', min: 1, max: 4, step: 1, default: 3, hint: '边缘 → 纹理 → 部件 → 整体' },
    { key: 'channel', label: '聚焦节点', type: 'range', min: 1, max: 4, step: 1, default: 1 },
    { key: 'occlude', label: '遮挡部位', type: 'select', default: 'none', options: [
      { value: 'none', label: '无遮挡' },
      { value: 'eye', label: '遮住双眼' },
      { value: 'ear', label: '遮住左耳' },
    ] },
    { key: 'noise', label: '拍摄噪声', type: 'range', min: 0, max: 30, step: 5, default: 6, unit: '%' },
  ],
  height: H,
  legend: [
    { label: '真实照片', color: '#226AFF' },
    { label: '特征响应', color: '#12a06a' },
    { label: '当前节点', color: '#f5a524' },
    { label: '扫描 / 感受野', color: '#e5484d' },
  ],
  hint: '用真实照片走完每一步：卷积核逐行扫描、ReLU、池化、跨通道汇合、部件模板匹配，直到分类头。切换照片或遮挡部位，看特征如何在节点中逐级涌现。',

  buildSteps(p) {
    const subject = SUBJECTS[p.subject] ? p.subject : 'cat';
    const occlude = ['none', 'eye', 'ear'].includes(p.occlude) ? p.occlude : 'none';
    const focusLayer = clamp(Math.round(Number(p.layer) || 3), 1, 4);
    const focusChannel = clamp(Math.round(Number(p.channel) || 1), 1, 4) - 1;
    const noise = clamp(Number(p.noise) || 0, 0, 30) / 100;
    const rnd = mulberry32(SUBJECTS[subject].seed);
    const grid = PHOTOS[subject].grid.map((row) => row.map((v) => clamp(v + (rnd() - 0.5) * noise, 0, 1)));
    const zones = occlude === 'eye' ? [[5, 8, 4, 6], [5, 8, 9, 12]]
      : occlude === 'ear' ? [[0, 5, 1, 7]] : [];
    for (const [r0, r1, c0, c1] of zones) {
      for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) grid[r][c] = 0.46;
    }

    const l1 = l1Of(grid);
    const pooled = l1.map(downMax);
    const l2 = l2Of(grid);
    const partMaps = PART_TEMPLATES.map((t) => scoreMap(l2, t));
    const dogMap = scoreMap(l2, DOG_TEMPLATE);
    const scores = partMaps.map(maxOf);
    const dogScore = maxOf(dogMap);
    const sims = ['cat', 'dog', 'leaf'].map((k) => cosine(grid, PHOTOS[k].grid));
    const catEvidence = avg(...scores);
    const logits = [
      4.0 * catEvidence + 2.0 * sims[0] - 1.2 * dogScore,
      4.0 * dogScore + 2.0 * sims[1] - 1.2 * catEvidence,
      4.0 * sims[2] + 0.8 * (1 - Math.max(catEvidence, dogScore)) - 0.8,
    ];
    const probs = softmax(logits);
    const l4 = [
      blob(catEvidence),
      blob(avg(...partMaps.map((m) => maxOf(m) ** 2))),
      dogMap,
      blob(sims[2]),
    ];
    const maps = [l1, l2, partMaps, l4];

    const steps = [];
    const push = (o) => {
      const fl = clamp(o.focusLayer || 1, 1, 4);
      const ch = clamp((o.focusChannel || 1) - 1, 0, 3);
      const shown = (maps[fl - 1] || maps[0])[ch] || maps[0][0];
      const peak = peakOf(shown, fl === 1 ? 1 : 2);
      const rf = [3, 5, 9, 16][fl - 1];
      steps.push({
        subject, occlude, grid, zones, maps, scores, dogScore, sims, probs,
        focusLayer: fl, focusChannel: ch + 1,
        reveal: o.reveal || [4, 4, 4, 4],
        partial: o.partial || null,
        kernel: o.kernel || null,
        scanRow: Number.isFinite(o.scanRow) ? o.scanRow : -1,
        stage: o.stage || 'intro',
        probsVisible: !!o.probsVisible,
        ...o,
        metrics: {
          聚焦层: fl,
          感受野边长: rf,
          节点峰值: Number(peak.value.toFixed(3)),
          猫证据: Number(catEvidence.toFixed(3)),
          猫概率: Number(probs[0].toFixed(3)),
          ...(o.metrics || {}),
        },
      });
    };

    push({
      stage: 'intro', focusLayer: 1, reveal: [0, 0, 0, 0],
      note: `输入是${SUBJECTS[subject].label}（${SUBJECTS[subject].source}），下采样成 16×16 灰度网格。接下来逐层看节点如何从像素里提取特征。`,
    });

    for (let li = 0; li < 2; li++) {
      const size = li === 0 ? N : S;
      for (let k = 0; k < 4; k++) {
        const kernel = li === 0 ? K1[k].w : K2[k];
        push({
          stage: `L${li + 1}-kernel`, focusLayer: li + 1, focusChannel: k + 1,
          reveal: revealAt(li + 1, k + 1), kernel,
          note: li === 0
            ? `第 1 层「${K1[k].name}」节点：3×3 核从左上开始逐行扫描 16×16 像素，每次 9 个权重与局部像素相乘求和。`
            : `第 2 层「${LAYERS[1].channels[k].name}」节点：输入已是池化后的 4 张 8×8 边缘图，用另一组 3×3 核跨通道加权汇合。`,
        });
        for (let r = 0; r < size; r++) {
          push({
            stage: 'scan', focusLayer: li + 1, focusChannel: k + 1,
            reveal: revealAt(li + 1, k + 1), kernel, scanRow: r,
            partial: { layer: li + 1, channel: k, rows: r + 1 },
            note: `扫描第 ${r + 1}/${size} 行：窗口滑过每个位置，把点积写入输出特征图同一位置；同一核在所有位置共享权重。`,
            metrics: { 扫描行: r + 1 },
          });
        }
        push({
          stage: 'relu', focusLayer: li + 1, focusChannel: k + 1,
          reveal: revealAt(li + 1, k + 1),
          note: 'ReLU：把所有负响应置零，只保留对当前纹理有正向证据的区域，让特征更稀疏。',
        });
        push({
          stage: 'pool', focusLayer: li + 1, focusChannel: k + 1,
          reveal: revealAt(li + 1, k + 1),
          note: li === 0
            ? '2×2 最大池化：16×16 → 8×8，特征图缩小一半，并获得轻微平移容忍。'
            : '第 2 层输出保持 8×8 供部件模板匹配（教学简化）；真实网络会继续池化以扩大感受野。',
        });
      }
      push({
        stage: 'layer-summary', focusLayer: li + 1, reveal: revealAt(li + 1, 4),
        note: `第 ${li + 1} 层 4 个节点全部生成：${LAYERS[li].channels.map((c) => c.name).join('、')}。它们仍只描述局部纹理，还没有「猫」的概念。`,
      });
    }

    for (let k = 0; k < PARTS.length; k++) {
      push({
        stage: 'L3-template', focusLayer: 3, focusChannel: k + 1,
        reveal: revealAt(3, k + 1),
        note: `第 3 层「${PARTS[k].name}」节点：${PARTS[k].note}`,
      });
      for (let r = 0; r <= S - 3; r++) {
        push({
          stage: 'match-scan', focusLayer: 3, focusChannel: k + 1,
          reveal: revealAt(3, k + 1), scanRow: r,
          partial: { layer: 3, channel: k, rows: r + 1 },
          note: `模板在第 ${r + 1}/6 行位置与前一层特征图做归一化互相关；匹配越好，响应图该位置越亮。`,
          metrics: { 匹配行: r + 1 },
        });
      }
      push({
        stage: 'part-peak', focusLayer: 3, focusChannel: k + 1, reveal: revealAt(3, k + 1),
        note: `「${PARTS[k].name}」节点峰值 ${fmt(scores[k] * 100, 1)}% —— 特征第一次在节点里有了部件含义。`,
      });
    }

    for (let k = 0; k < 4; k++) {
      push({
        stage: 'L4', focusLayer: 4, focusChannel: k + 1, reveal: revealAt(4, 4),
        note: `第 4 层「${LAYERS[3].channels[k].name}」：${LAYERS[3].channels[k].note}`,
      });
    }
    const best = probs.indexOf(Math.max(...probs));
    push({
      stage: 'classify', focusLayer: 4, probsVisible: true,
      note: `分类头汇总：猫证据 ${fmt(catEvidence * 100, 1)}%，垂耳证据 ${fmt(dogScore * 100, 1)}%，叶片相似度 ${fmt(sims[2] * 100, 1)}%。`,
    });
    push({
      stage: 'done', focusLayer: 4, probsVisible: true,
      note: occlude === 'none'
        ? `判定为「${CLASSES[best]}」（${fmt(probs[best] * 100, 1)}%）。注意：浅层节点只代表一条边，部件与猫脸是逐层组合后涌现的。`
        : `${occlude === 'eye' ? '遮住双眼' : '遮住左耳'}后，对应部件节点响应下降，猫的证据降到 ${fmt(catEvidence * 100, 1)}% —— 这就是层级证据的依赖关系。`,
    });
    return steps;
  },

  render(snap, p, c) {
    const subject = SUBJECTS[snap.subject] ? snap.subject : 'cat';
    const info = SUBJECTS[subject];
    const photo = PHOTOS[subject];
    const focusLayer = clamp(Number(snap.focusLayer) || 1, 1, 4);
    const focusChannel = clamp(Number(snap.focusChannel) || 1, 1, 4) - 1;
    const reveal = Array.isArray(snap.reveal) ? snap.reveal : [4, 4, 4, 4];
    const grid = Array.isArray(snap.grid) ? snap.grid : photo.grid;
    const maps = Array.isArray(snap.maps) ? snap.maps : [];
    const zones = Array.isArray(snap.zones) ? snap.zones : [];
    const partial = snap.partial || null;
    const scanRow = Number(snap.scanRow ?? -1);
    const kernel = Array.isArray(snap.kernel) ? snap.kernel : null;
    const probs = Array.isArray(snap.probs) ? snap.probs : [0.34, 0.33, 0.33];
    const scores = Array.isArray(snap.scores) ? snap.scores : [0, 0, 0, 0];
    const meta = LAYERS[focusLayer - 1];
    const channel = meta.channels[focusChannel];
    const peak = peakOf(((maps[focusLayer - 1] || [])[focusChannel] || []), focusLayer === 1 ? 1 : 2);
    const rf = [3, 5, 9, 16][focusLayer - 1];
    const cell = 4.5, ix = 100, iy = 88;

    const heat = (m, x, y, unit, color, idx) => {
      let arr = downMax8(Array.isArray(m) ? m : []);
      if (partial && partial.layer === focusLayer && partial.channel === idx) {
        arr = arr.map((row, r) => r < Number(partial.rows) ? row : row.map(() => 0));
      }
      const on = idx === focusChannel && reveal[focusLayer - 1] > idx;
      return (
        <g key={`heat-${idx}`}>
          <rect x={x - 3} y={y - 3} width={S * unit + 6} height={S * unit + 6} rx="4"
            fill={on ? c.warning : c.panel2} opacity={on ? 0.18 : 0.45} />
          {arr.map((row, r) => row.map((v, col) => (
            <rect key={`${r}-${col}`} x={x + col * unit} y={y + r * unit} width={Math.max(1, unit - 1)} height={Math.max(1, unit - 1)}
              rx="1" fill={on ? c.warning : color} opacity={0.07 + 0.9 * clamp(Number(v) || 0, 0, 1)} />
          )))}
          <text x={x} y={y + S * unit + 13} fontSize="9" fill={on ? c.warning : c.muted}>
            {String(meta.channels[idx]?.name || '')}
          </text>
        </g>
      );
    };

    const pipeline = LAYERS.map((layer, i) => {
      const x = 20 + i * 172;
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

    const pixels = grid.map((row, r) => row.map((v, col) => (
      <rect key={`px-${r}-${col}`} x={ix + col * cell} y={iy + r * cell} width={cell - 0.6} height={cell - 0.6}
        fill={c.primary} opacity={0.04 + 0.9 * clamp(Number(v) || 0, 0, 1)} />
    )));
    const half = Math.floor(rf / 2);
    const rfRect = reveal[focusLayer - 1] > 0 ? (
      <rect x={ix + clamp(peak.c - half, 0, N - rf) * cell} y={iy + clamp(peak.r - half, 0, N - rf) * cell}
        width={rf * cell - 0.6} height={rf * cell - 0.6} rx="2" fill="none" stroke={c.danger} strokeWidth="1.4" strokeDasharray="3 2" />
    ) : null;
    const occlusions = zones.map(([r0, r1, c0, c1], i) => (
      <rect key={`occ-${i}`} x={ix + c0 * cell} y={iy + r0 * cell} width={(c1 - c0 + 1) * cell} height={(r1 - r0 + 1) * cell}
        fill="none" stroke={c.danger} strokeWidth="1.2" strokeDasharray="3 2" />
    ));

    const current = maps[focusLayer - 1] || [];
    const gallery = current.map((m, i) => heat(m, 196 + (i % 2) * 88, 92 + Math.floor(i / 2) * 92, 8, c.success, i));

    const bars = meta.channels.map((ch, i) => {
      const val = i < 4 ? maxOf(current[i]) : 0;
      const y = 102 + i * 32;
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
      const y = 254 + i * 26;
      return (
        <g key={`cls-${i}`}>
          <text x="394" y={y + 9} fontSize="10" fill={c.muted}>{String(name)}</text>
          <rect x="472" y={y} width="150" height="12" rx="4" fill={c.panel2} />
          <rect x="472" y={y} width={150 * v} height="12" rx="4" fill={c.series[i % c.series.length]} opacity="0.92" />
          <text x="700" y={y + 10} fontSize="9" textAnchor="end" fill={c.text}>{fmt(v * 100, 1)}%</text>
        </g>
      );
    });

    const nodeX = [410, 470, 530, 590];
    const emergence = (
      <g>
        <text x="394" y="344" fontSize="10" fill={c.muted}>特征涌现路径</text>
        {nodeX.map((x, i) => (
          <g key={`node-${i}`}>
            {i < 3 ? <line x1={x + 8} y1="370" x2={nodeX[i + 1] - 8} y2="370" stroke={focusLayer >= i + 2 ? c.success : c.border} strokeWidth="1.5" /> : null}
            <circle cx={x} cy="370" r={focusLayer === i + 1 ? 7 : 5}
              fill={focusLayer === i + 1 ? c.warning : (focusLayer > i + 1 ? c.success : c.panel2)} />
            <text x={x} y="387" fontSize="8" textAnchor="middle" fill={c.muted}>{['像素', '边缘', '纹理', '部件/判定'][i]}</text>
          </g>
        ))}
      </g>
    );

    const noteLines = wrapLines(snap.note, 58);
    return (
      <Frame c={c} height={H} title="真实照片 · 多层 CNN 的特征涌现"
        subtitle={`${String(info.label)} · 聚焦第 ${focusLayer} 层 · ${String(channel?.name || '')}`}>
        {pipeline}
        <text x="20" y="77" fontSize="10" fill={c.muted}>真实照片</text>
        <image href={photo.dataUrl} x="20" y="88" width="72" height="72" preserveAspectRatio="xMidYMid slice" />
        <text x="100" y="77" fontSize="10" fill={c.muted}>16×16 灰度（虚框 = 感受野）</text>
        {pixels}
        {rfRect}
        {occlusions}
        <text x="100" y="166" fontSize="9" fill={c.muted}>{String(info.source)}</text>
        <text x="100" y="182" fontSize="9" fill={c.muted}>{`遮挡：${String(snap.occlude === 'eye' ? '双眼' : snap.occlude === 'ear' ? '左耳' : '无')}`}</text>
        {kernel ? (
          <g>
            <text x="20" y="210" fontSize="9" fill={c.muted}>当前卷积核 3×3</text>
            {kernel.map((row, r) => row.map((v, col) => (
              <g key={`k-${r}-${col}`}>
                <rect x={20 + col * 22} y={218 + r * 22} width="20" height="20" rx="2"
                  fill={v >= 0 ? c.success : c.danger} opacity={0.12 + 0.75 * clamp(Math.abs(Number(v)) / 4, 0, 1)} />
                <text x={30 + col * 22} y={232 + r * 22} fontSize="8" textAnchor="middle" fill={c.text}>{fmt(v, 1)}</text>
              </g>
            )))}
            <text x="20" y="296" fontSize="9" fill={c.muted}>
              {scanRow >= 0 ? `正在扫描第 ${scanRow + 1} 行` : '核在整张图上共享权重'}
            </text>
          </g>
        ) : (
          <text x="20" y="220" fontSize="9" fill={c.muted}>{focusLayer >= 3 ? '使用部件模板做匹配' : '准备卷积…'}</text>
        )}
        <text x="196" y="77" fontSize="10" fill={c.muted}>当前层 4 个节点响应图</text>
        {gallery}
        <text x="394" y="77" fontSize="10" fill={c.muted}>节点响应强度</text>
        {bars}
        <text x="394" y="238" fontSize="10" fill={c.muted}>分类头</text>
        {snap.probsVisible ? classBars : (
          <text x="394" y="270" fontSize="10" fill={c.muted}>等待深层证据汇总…</text>
        )}
        {emergence}
        <line x1="20" y1="404" x2="700" y2="404" stroke={c.grid} />
        {noteLines.map((ln, i) => (
          <text key={`note-${i}`} x="20" y={422 + i * 16} fontSize="10" fill={c.text}>{String(ln)}</text>
        ))}
        <text x="20" y="462" fontSize="9" fill={c.muted}>
          {`真实照片来自免费图库；卷积核与模板为固定教学示例，真实网络由数据学出滤波器。`}
        </text>
      </Frame>
    );
  },
};
