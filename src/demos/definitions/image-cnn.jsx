import React from 'react';
import { clamp, mulberry32, softmax } from '../utils.js';
import { Frame, fmt } from '../kits/primitives.jsx';
import { PHOTOS } from '../photos/cat-cnn-photos.js';
import { ONE, TWO } from '../photos/image-cnn-weights.js';

// 多层 CNN 图像识别：真实照片输入，完整前向链路。
// 第 1 块：4 个 3×3 核逐行扫描 16×16 → ReLU → 2×2 最大池化 → 8×8×4。
// 第 2 块：4 个 3×3 核跨通道加权汇合 → ReLU → 8×8×4，展平成 256 维。
// 分类头 softmax 回归权重，由真实照片带噪变体的特征图离线训练得到。
// 卷积核为固定教学示例；真实 CNN 的滤波器由数据学出。

const N = 16;
const S = 8;
const H = 470;
const CLASSES = ['小猫', '小狗', '背景'];
const SUBJECTS = {
  cat: { label: '小猫照片', source: 'Pexels · 6346677', seed: 31 },
  dog: { label: '小狗照片', source: 'Unsplash · 1543466835', seed: 47 },
  leaf: { label: '叶片照片', source: 'Pexels · 691043', seed: 59 },
};
const KERNELS = [
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
const relu = (m) => m.map((row) => row.map((v) => Math.max(0, v)));
const norm = (m, scale) => m.map((row) => row.map((v) => clamp(v / scale, 0, 1)));
function pool(m) {
  const out = [];
  for (let r = 0; r + 1 < m.length; r += 2) {
    const row = [];
    for (let c = 0; c + 1 < m.length; c += 2) {
      row.push(Math.max(m[r][c], m[r][c + 1], m[r + 1][c], m[r + 1][c + 1]));
    }
    out.push(row);
  }
  return out;
}
function l1Of(grid) { return KERNELS.map((k) => norm(relu(conv(grid, k.w)), 4)); }
function l2Of(grid) {
  const pooled = l1Of(grid).map(pool);
  return K2.map((k, oc) => {
    let acc = pooled[0].map((row) => row.map(() => 0));
    for (let ch = 0; ch < 4; ch++) {
      const cv = conv(pooled[ch], k);
      acc = acc.map((row, r) => row.map((v, j) => v + W2[oc][ch] * cv[r][j]));
    }
    return norm(relu(acc), 3);
  });
}
function forward(grid, layers) {
  const l1 = l1Of(grid);
  const pooled = l1.map(pool);
  const l2 = l2Of(grid);
  const flat = (layers >= 2 ? l2 : pooled).flat(2);
  const head = layers >= 2 ? TWO : ONE;
  const z = flat.map((v, i) => (v - head.MEAN[i]) / (head.STD[i] || 1));
  const logits = [0, 1, 2].map((k) => head.B[k] + z.reduce((a, v, i) => a + v * head.W[i][k], 0));
  return { l1, pooled, l2, flat, z, logits, probs: softmax(logits) };
}
function partialConv(map, k, rows) {
  const full = conv(map, k);
  return full.map((row, r) => (r <= rows ? row : row.map(() => 0)));
}
function wrapLines(s, width = 60) {
  const str = String(s || '');
  const out = [];
  for (let i = 0; i < str.length; i += width) out.push(str.slice(i, i + width));
  return out.slice(0, 2);
}

export default {
  id: 'image-cnn',
  params: [
    { key: 'subject', label: '输入照片', type: 'select', default: 'cat', options: [
      { value: 'cat', label: '小猫（真实照片）' },
      { value: 'dog', label: '小狗（真实照片）' },
      { value: 'leaf', label: '叶片（真实照片）' },
    ] },
    { key: 'layers', label: '卷积块层数', type: 'range', min: 1, max: 2, step: 1, default: 2, hint: '每个块 = 3×3 卷积 + ReLU + 2×2 最大池化' },
    { key: 'kernel', label: '聚焦卷积核', type: 'range', min: 1, max: 4, step: 1, default: 1 },
    { key: 'noise', label: '拍摄噪声', type: 'range', min: 0, max: 30, step: 5, default: 6, unit: '%' },
  ],
  height: H,
  legend: [
    { label: '真实照片', color: '#226AFF' },
    { label: '正激活', color: '#12a06a' },
    { label: '负激活', color: '#e5484d' },
    { label: '扫描行', color: '#f5a524' },
  ],
  hint: '用真实照片走完多层 CNN 前向链路：卷积核逐行扫描 → ReLU → 池化 → 跨通道汇合 → 展平 → 全连接分类头。分类头权重由真实照片特征图训练得到。',

  buildSteps(p) {
    const subject = SUBJECTS[p.subject] ? p.subject : 'cat';
    const layers = clamp(Math.round(Number(p.layers) || 2), 1, 2);
    const focus = clamp(Math.round(Number(p.kernel) || 1), 1, 4) - 1;
    const noise = clamp(Number(p.noise) || 0, 0, 30) / 100;
    const rnd = mulberry32(SUBJECTS[subject].seed);
    const grid = PHOTOS[subject].grid.map((row) => row.map((v) => clamp(v + (rnd() - 0.5) * noise, 0, 1)));

    const fwd = forward(grid, layers);
    const best = fwd.probs.indexOf(Math.max(...fwd.probs));
    const steps = [];
    const push = (o) => steps.push({
      subject, layers, focus, noise, grid, label: SUBJECTS[subject].label,
      l1: fwd.l1, pooled: fwd.pooled, l2: fwd.l2, flat: fwd.flat, z: fwd.z,
      logits: fwd.logits, probs: fwd.probs,
      stage: 'intro', layer: 0, scanRow: -1, kernel: null, probsVisible: false,
      ...o,
      metrics: {
        卷积块: o.layer || 0,
        展平维度: o.stage === 'flatten' || o.stage === 'dense' || o.stage === 'softmax' || o.stage === 'done' ? 256 : 0,
        ...(o.metrics || {}),
      },
    });

    push({ note: `输入是${SUBJECTS[subject].label}（${SUBJECTS[subject].source}），下采样成 16×16 灰度网格，叠加 ${Math.round(noise * 100)}% 拍摄噪声。接下来走完整前向链路。`,
      metrics: { 特征图尺寸: '16×16' } });

    // 第 1 块：4 个核逐个扫描、ReLU、池化。
    for (let k = 0; k < 4; k++) {
      const kernel = KERNELS[k];
      push({ stage: 'kernel', layer: 1, focus: k, kernel: kernel.w, kernelName: kernel.name,
        note: `第 1 块「${kernel.name}」核：3×3 窗口从左上逐行扫描 16×16 像素，9 个权重与局部像素相乘求和；同一核在所有位置共享权重。`,
        metrics: { 扫描行: 0 } });
      for (let r = 0; r < N; r++) {
        push({ stage: 'conv', layer: 1, focus: k, kernel: kernel.w, kernelName: kernel.name, scanRow: r,
          note: `扫描第 ${r + 1}/${N} 行：点积写入输出特征图同一位置，得到 ${kernel.name} 响应。`,
          metrics: { 扫描行: r + 1 } });
      }
      push({ stage: 'relu', layer: 1, focus: k, kernel: kernel.w, kernelName: kernel.name,
        note: `ReLU：把 ${conv(grid, kernel.w).flat().filter((v) => v <= 0).length} 个非正响应置 0，只保留正向证据。` });
      push({ stage: 'pool', layer: 1, focus: k, kernel: kernel.w, kernelName: kernel.name,
        note: '2×2 最大池化：16×16 → 8×8，缩小一半并获得轻微平移不变性。' });
    }
    push({ stage: 'layer-summary', layer: 1, focus: 3,
      note: '第 1 块 4 个核完成，得到 4 张 8×8 边缘图：水平、垂直、斜向、角点。此时还没有类别概念。' });

    if (layers >= 2) {
      for (let k = 0; k < 4; k++) {
        push({ stage: 'kernel', layer: 2, focus: k, kernel: K2[k], kernelName: `汇合核 ${k + 1}`,
          note: `第 2 块「汇合核 ${k + 1}」：对 4 张边缘图分别做 3×3 卷积，再按一组通道权重加权求和，组合出更高级的纹理响应。`,
          metrics: { 扫描行: 0 } });
        for (let r = 0; r < S; r++) {
          push({ stage: 'conv', layer: 2, focus: k, kernel: K2[k], kernelName: `汇合核 ${k + 1}`, scanRow: r,
            note: `扫描第 ${r + 1}/${S} 行：跨 4 个通道的加权汇合写入第 ${k + 1} 张纹理图。`,
            metrics: { 扫描行: r + 1 } });
        }
        push({ stage: 'relu', layer: 2, focus: k, kernel: K2[k],
          note: 'ReLU 后再归一化：只留正向纹理证据，数值压到 [0,1] 供分类头使用。' });
      }
      push({ stage: 'layer-summary', layer: 2, focus: 3,
        note: '第 2 块完成，得到 4 张 8×8 纹理图。它们将被展平，送给全连接分类头。' });
    }

    push({ stage: 'flatten', layer: layers, focus: 3,
      note: `展平：把 ${layers === 2 ? '4 张 8×8' : '第 1 块的特征'} 拉直成 ${fwd.flat.length} 维向量，每个位置是一个局部响应强度。`,
      metrics: { 展平维度: fwd.flat.length } });
    push({ stage: 'dense', layer: layers, focus: 3,
      note: `全连接头：这 ${fwd.flat.length} 维特征先标准化，再与训练得到的权重逐项相乘求和，得到 3 个类别分数。`,
      metrics: { 展平维度: fwd.flat.length } });
    push({ stage: 'softmax', layer: layers, focus: 3, probsVisible: true,
      note: `Softmax 转概率：小猫 ${fmt(fwd.probs[0] * 100, 1)}%、小狗 ${fmt(fwd.probs[1] * 100, 1)}%、背景 ${fmt(fwd.probs[2] * 100, 1)}%。`,
      metrics: { 预测类别: CLASSES[best] } });
    push({ stage: 'done', layer: layers, focus: 3, probsVisible: true,
      note: `识别完成：判定为「${CLASSES[best]}」。整条链路只用卷积特征 —— 分类头没有看过原图像素的手工统计。`,
      metrics: { 预测类别: CLASSES[best], 置信度: `${fmt(Math.max(...fwd.probs) * 100, 1)}%` } });
    return steps;
  },

  render(snap, p, c) {
    const subject = SUBJECTS[snap.subject] ? snap.subject : 'cat';
    const info = SUBJECTS[subject];
    const photo = PHOTOS[subject];
    const grid = Array.isArray(snap.grid) ? snap.grid : photo.grid;
    const pooled = Array.isArray(snap.pooled) ? snap.pooled : [];
    const l2 = Array.isArray(snap.l2) ? snap.l2 : [];
    const z = Array.isArray(snap.z) ? snap.z : [];
    const logits = Array.isArray(snap.logits) ? snap.logits : [0, 0, 0];
    const probs = Array.isArray(snap.probs) ? snap.probs : [0.34, 0.33, 0.33];
    const stage = snap.stage || 'intro';
    const layer = Number(snap.layer || 0);
    const scanRow = Number(snap.scanRow ?? -1);
    const kernel = Array.isArray(snap.kernel) ? snap.kernel : null;
    const kernelName = String(snap.kernelName || '');
    const focus = clamp(Number(snap.focus) || 0, 0, 3);
    const visible = !!snap.probsVisible;

    const cell = 4.5, ix = 100, iy = 88;
    const pixels = grid.map((row, r) => row.map((v, col) => (
      <rect key={`px-${r}-${col}`} x={ix + col * cell} y={iy + r * cell} width={cell - 0.6} height={cell - 0.6}
        fill={c.primary} opacity={0.04 + 0.9 * clamp(Number(v) || 0, 0, 1)} />
    )));

    const sourceMaps = layer >= 2 ? l2 : pooled;
    const shown = sourceMaps[focus] || sourceMaps[0] || [];
    const unit = 11;
    const featCells = Array.from({ length: S }, (_, r) => Array.from({ length: S }, (_, col) => {
      let v = clamp(Number(shown[r]?.[col]) || 0, 0, 1);
      if (stage === 'conv' && r > scanRow) v = 0;
      return (
        <rect key={`f-${r}-${col}`} x={196 + col * unit} y={88 + r * unit} width={unit - 1} height={unit - 1}
          rx="1" fill={c.success} opacity={0.05 + 0.92 * v} />
      );
    }));

    const vecCell = 5;
    const vec = z.slice(0, 256).map((raw, i) => {
      const r = Math.floor(i / 16), col = i % 16;
      const val = clamp((Number(raw) || 0) / 4, -1, 1);
      return (
        <rect key={`v-${i}`} x={304 + col * vecCell} y={88 + r * vecCell} width={vecCell - 0.6} height={vecCell - 0.6}
          rx="0.8" fill={val >= 0 ? c.success : c.danger} opacity={0.08 + 0.9 * Math.abs(val)} />
      );
    });

    const stageNames = ['输入', ...Array.from({ length: Number(snap.layers || 2) }, (_, i) => `C${i + 1}`), '展平', '分类'];
    const stageIndex = stage === 'intro' ? 0 : stage === 'flatten' ? stageNames.length - 2
      : stage === 'dense' || stage === 'softmax' || stage === 'done' ? stageNames.length - 1
        : Math.min(stageNames.length - 2, layer);
    const boxes = stageNames.map((name, i) => {
      const x = 20 + i * 140;
      const on = i === stageIndex;
      return (
        <g key={`st-${i}`}>
          <rect x={x} y="32" width="126" height="24" rx="5" fill={on ? c.primary : c.panel2} opacity={on ? 0.95 : 0.8} />
          <text x={x + 63} y="48" fontSize="10" textAnchor="middle" fill={on ? c.bg : c.muted} fontWeight="600">{String(name)}</text>
          {i < stageNames.length - 1 ? <path d={`M${x + 128},44 l7,-3 l0,6 z`} fill={c.accent} /> : null}
        </g>
      );
    });

    const classBars = CLASSES.map((name, i) => {
      const v = clamp(Number(probs[i]) || 0, 0, 1);
      const y = 100 + i * 52;
      const lg = Number(logits[i]) || 0;
      return (
        <g key={`cls-${i}`}>
          <text x="384" y={y + 10} fontSize="10" fill={c.muted}>{String(name)}</text>
          <text x="700" y={y + 10} fontSize="9" textAnchor="end" fill={c.muted}>{`分数 ${fmt(lg, 2)}`}</text>
          <rect x="384" y={y + 16} width="316" height="14" rx="4" fill={c.panel2} />
          {visible ? <rect x="384" y={y + 16} width={316 * v} height="14" rx="4" fill={c.series[i % c.series.length]} opacity="0.92" /> : null}
          {visible ? <text x="700" y={y + 27} fontSize="9" textAnchor="end" fill={c.text}>{fmt(v * 100, 1)}%</text> : null}
        </g>
      );
    });

    const noteLines = wrapLines(snap.note, 60);
    return (
      <Frame c={c} height={H} title="多层 CNN · 真实照片图像识别"
        subtitle={`${String(info.label)} · ${String(snap.layers || 2)} 个卷积块 · 当前 ${String(stage)}`}>
        {boxes}
        <text x="20" y="76" fontSize="10" fill={c.muted}>真实照片（{String(info.source)}）</text>
        <image href={photo.dataUrl} x="20" y="88" width="72" height="72" preserveAspectRatio="xMidYMid slice" />
        <text x="100" y="76" fontSize="10" fill={c.muted}>16×16 灰度输入</text>
        {pixels}
        <text x="196" y="76" fontSize="10" fill={c.muted}>{layer >= 2 ? '纹理特征图 8×8' : '边缘特征图 8×8'}</text>
        {featCells}
        <text x="304" y="76" fontSize="10" fill={c.muted}>展平向量 256 维</text>
        {vec}
        {kernel ? (
          <g>
            <text x="20" y="182" fontSize="9" fill={c.muted}>{`${String(kernelName)} · 3×3`}</text>
            {kernel.map((row, r) => row.map((v, col) => (
              <g key={`k-${r}-${col}`}>
                <rect x={20 + col * 22} y={190 + r * 22} width="20" height="20" rx="2"
                  fill={v >= 0 ? c.success : c.danger} opacity={0.12 + 0.75 * clamp(Math.abs(Number(v)) / 4, 0, 1)} />
                <text x={30 + col * 22} y={204 + r * 22} fontSize="8" textAnchor="middle" fill={c.text}>{fmt(v, 1)}</text>
              </g>
            )))}
            <text x="20" y="268" fontSize="9" fill={c.muted}>
              {stage === 'conv' ? `正在扫描第 ${scanRow + 1} 行` : '核在整张图上共享权重'}
            </text>
          </g>
        ) : null}
        <text x="384" y="76" fontSize="10" fill={c.muted}>分类头 · Softmax 概率</text>
        {classBars}
        <line x1="20" y1="346" x2="700" y2="346" stroke={c.grid} />
        {noteLines.map((ln, i) => (
          <text key={`n-${i}`} x="20" y={366 + i * 16} fontSize="10" fill={c.text}>{String(ln)}</text>
        ))}
        <text x="20" y="458" fontSize="9" fill={c.muted}>
          {`真实照片来自免费图库；卷积核为固定教学示例，分类头权重由真实照片特征图训练得到。`}
        </text>
      </Frame>
    );
  },
};
