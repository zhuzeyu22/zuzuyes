import React from 'react';
import { clamp, mulberry32 } from '../utils.js';
import { Frame, fmt } from '../kits/primitives.jsx';

const SIZE = 12;
const H = 360;
const LABELS = ['数字 0', '数字 1', '字母 T'];
const PATTERNS = {
  zero: [
    '............',
    '..########..',
    '.##......##.',
    '.##......##.',
    '.##......##.',
    '.##......##.',
    '.##......##.',
    '.##......##.',
    '.##......##.',
    '.##......##.',
    '..########..',
    '............',
  ],
  one: [
    '............',
    '.....##.....',
    '....###.....',
    '.....##.....',
    '.....##.....',
    '.....##.....',
    '.....##.....',
    '.....##.....',
    '.....##.....',
    '.....##.....',
    '..########..',
    '............',
  ],
  tee: [
    '............',
    '############',
    '############',
    '.....##.....',
    '.....##.....',
    '.....##.....',
    '.....##.....',
    '.....##.....',
    '.....##.....',
    '.....##.....',
    '.....##.....',
    '............',
  ],
};
const KERNELS = [
  { name: '角点/轮廓', w: [[0, -1, 0], [-1, 4, -1], [0, -1, 0]] },
  { name: '竖向边缘', w: [[-1, 0, 1], [-2, 0, 2], [-1, 0, 1]] },
  { name: '横向边缘', w: [[-1, -2, -1], [0, 0, 0], [1, 2, 1]] },
];
function shapeStats(map) {
  const n = map.length;
  let top = 0, centerCol = 0, border = 0, nTop = 0, nCenter = 0, nBorder = 0;
  for (let r = 0; r < n; r++) {
    for (let col = 0; col < n; col++) {
      const v = map[r][col];
      if (r < Math.ceil(n * 0.34)) { top += v; nTop++; }
      if (Math.abs(col - (n - 1) / 2) <= 0.75) { centerCol += v; nCenter++; }
      if (r >= n * 0.3 && r <= n * 0.72 && (col === 1 || col === n - 2)) { border += v; nBorder++; }
    }
  }
  return {
    top: top / Math.max(1, nTop),
    centerCol: centerCol / Math.max(1, nCenter),
    border: border / Math.max(1, nBorder),
  };
}

function makeInput(key, noise) {
  const rnd = mulberry32(key === 'one' ? 114 : key === 'tee' ? 728 : 503);
  return PATTERNS[key].map((row) => [...row].map((ch) => {
    const base = ch === '#' ? 0.92 : 0.06;
    return clamp(base + (rnd() - 0.5) * noise, 0, 1);
  }));
}

function conv2d(map, kernel) {
  const n = map.length;
  const out = Array.from({ length: n }, () => Array.from({ length: n }, () => 0));
  for (let r = 0; r < n; r++) {
    for (let col = 0; col < n; col++) {
      let sum = 0;
      for (let i = -1; i <= 1; i++) {
        for (let j = -1; j <= 1; j++) {
          const rr = r + i, cc = col + j;
          const px = (rr < 0 || cc < 0 || rr >= n || cc >= n) ? 0 : map[rr][cc];
          sum += px * kernel[i + 1][j + 1];
        }
      }
      out[r][col] = sum;
    }
  }
  return out;
}

function relu(map) { return map.map((row) => row.map((v) => Math.max(0, v))); }

function maxpool(map) {
  const out = [];
  for (let r = 0; r + 1 < map.length; r += 2) {
    const row = [];
    for (let col = 0; col + 1 < map.length; col += 2) {
      row.push(Math.max(map[r][col], map[r][col + 1], map[r + 1][col], map[r + 1][col + 1]));
    }
    out.push(row);
  }
  return out;
}

function softmax(logits) {
  const m = Math.max(...logits);
  const ex = logits.map((v) => Math.exp(v - m));
  const s = ex.reduce((a, b) => a + b, 0);
  return ex.map((v) => v / s);
}

export default {
  id: 'image-cnn',
  params: [
    { key: 'digit', label: '输入图像', type: 'select', default: 'zero', options: [
      { value: 'zero', label: '手写数字 0（带噪声）' },
      { value: 'one', label: '手写数字 1（带噪声）' },
      { value: 'tee', label: '字母 T（带噪声）' },
    ] },
    { key: 'layers', label: '卷积块层数', type: 'range', min: 1, max: 3, step: 1, default: 2, hint: '每个块 = 卷积 + ReLU + 2×2 最大池化' },
    { key: 'noise', label: '像素噪声', type: 'range', min: 0, max: 40, step: 5, default: 15, unit: '%' },
  ],
  height: H,
  legend: [
    { label: '输入像素', color: '#226AFF' },
    { label: '正激活', color: '#12a06a' },
    { label: '负激活', color: '#e5484d' },
    { label: '当前扫描行', color: '#f5a524' },
  ],
  hint: '用一张 12×12 的带噪字符图，逐层观察「卷积提特征 → ReLU 去负 → 池化压缩 → 全连接分类」的完整链路。',

  buildSteps(p) {
    const key = PATTERNS[p.digit] ? p.digit : 'zero';
    const layers = clamp(Math.round(Number(p.layers) || 2), 1, 3);
    const noise = clamp(Number(p.noise) || 0, 0, 40) / 100;
    const input = makeInput(key, noise);

    const steps = [];
    let current = input;
    const push = (o) => steps.push({
      digit: key, layers, label: LABELS[Object.keys(PATTERNS).indexOf(key)],
      stageMaps: [], stage: 'intro', layer: 0, scanRow: -1,
      inputMap: input, outputMap: [], probs: [0.34, 0.33, 0.33],
      ...o,
      metrics: {
        卷积块: o.layer || 0,
        特征图尺寸: `${current.length}×${current.length}`,
        像素数: current.length * current.length,
        ...(o.metrics || {}),
      },
    });

    push({ note: `输入是一张 12×12 灰度字符图（${LABELS[Object.keys(PATTERNS).indexOf(key)]}），叠加 ${Math.round(noise * 100)}% 随机噪声，模拟真实扫描件。`, metrics: { 特征图尺寸: '12×12', 像素数: 144 } });
    push({ note: `准备堆叠 ${layers} 个卷积块。每个块用 3×3 卷积核提取局部纹理，再用 ReLU 与 2×2 最大池化压缩尺寸。` });

    for (let li = 0; li < layers; li++) {
      const kernel = KERNELS[li % KERNELS.length];
      const conv = conv2d(current, kernel.w);
      push({
        stage: 'conv', layer: li + 1, kernel, inputMap: current, outputMap: conv,
        note: `第 ${li + 1} 层卷积：用「${kernel.name}」3×3 核对 ${current.length}×${current.length} 特征图逐行扫描，同一个核在所有位置共享权重。`,
      });
      for (let r = 0; r < current.length; r++) {
        push({
          stage: 'conv', layer: li + 1, kernel, inputMap: current, outputMap: conv, scanRow: r,
          note: `扫描第 ${r + 1}/${current.length} 行：3×3 窗口与 9 个权重对应相乘求和，写入输出图同一位置。`,
          metrics: { 扫描行: r + 1 },
        });
      }
      const act = relu(conv);
      push({
        stage: 'relu', layer: li + 1, inputMap: conv, outputMap: act,
        note: `ReLU：把 ${act.flat().filter((v) => v <= 0).length} 个非正响应置 0，只保留对当前纹理有正向证据的区域。`,
      });
      current = maxpool(act);
      push({
        stage: 'pool', layer: li + 1, inputMap: act, outputMap: current,
        note: `2×2 最大池化：每 4 个像素取最大值，特征图从 ${act.length}×${act.length} 缩到 ${current.length}×${current.length}，带来轻微平移不变性。`,
      });
    }

    const flat = current.flat();
    push({ stage: 'flatten', layer: layers, inputMap: current, outputMap: current,
      note: `展平：把最后的 ${current.length}×${current.length} 特征图拉直成 ${flat.length} 维向量，交给全连接层做分类。`,
      metrics: { 特征图尺寸: `${current.length}×${current.length}`, 展平维度: flat.length } });

    const st = shapeStats(input);
    const logits = [
      3.0 * st.border - 1.2 * st.centerCol - 0.6 * st.top,
      3.0 * st.centerCol - 1.5 * st.border - 2.5 * st.top + 0.2,
      7.0 * st.top - 1.2 * st.centerCol - 1.0 * st.border - 0.3,
    ];
    push({ stage: 'dense', layer: layers, inputMap: current, outputMap: current, logits,
      note: `全连接层：把 ${flat.length} 维特征汇总成「外圈/中轴/顶部」三类结构证据，再映射成 3 个类别分数。`,
      metrics: { 展平维度: flat.length, 顶部强度: Number(st.top.toFixed(2)), 中轴强度: Number(st.centerCol.toFixed(2)) } });

    const probs = softmax(logits);
    const best = probs.indexOf(Math.max(...probs));
    push({ stage: 'softmax', layer: layers, inputMap: current, outputMap: current, logits, probs,
      note: `Softmax 把分数转成概率：0 → ${fmt(probs[0] * 100, 1)}%，1 → ${fmt(probs[1] * 100, 1)}%，T → ${fmt(probs[2] * 100, 1)}%。`,
      metrics: { 预测类别: LABELS[best] } });
    push({ stage: 'done', layer: layers, inputMap: current, outputMap: current, logits, probs,
      note: `分类完成：预测为「${LABELS[best]}」。拖动层数看深层特征图如何逐级压缩，切换图像看同一网络对不同字符的响应。`,
      metrics: { 预测类别: LABELS[best], 置信度: `${fmt(Math.max(...probs) * 100, 1)}%` } });
    return steps;
  },

  render(snap, p, c) {
    const input = snap.inputMap || [];
    const output = snap.outputMap || [];
    const kernel = snap.kernel;
    const probs = snap.probs || [0.34, 0.33, 0.33];
    const stage = snap.stage || 'intro';
    const scanRow = Number(snap.scanRow ?? -1);
    const layer = Number(snap.layer || 0);
    const nIn = input.length || SIZE;
    const nOut = output.length || 1;
    const inCell = 156 / nIn;
    const outCell = Math.min(26, 156 / nOut);

    const pixels = (map, x, y, cell, mode) => map.map((row, r) => row.map((v, col) => {
      const val = Number(v) || 0;
      const mag = clamp(Math.abs(val), 0, 1);
      let fill = c.panel2;
      if (mode === 'input') fill = c.primary;
      else if (mode === 'feature') fill = val >= 0 ? c.success : c.danger;
      const opacity = mode === 'input' ? 0.08 + 0.9 * mag : 0.12 + 0.85 * mag;
      const scanned = mode === 'feature' && stage === 'conv' && r === scanRow;
      return (
        <g key={`${mode}-${r}-${col}`}>
          <rect x={x + col * cell} y={y + r * cell} width={Math.max(1, cell - 1)} height={Math.max(1, cell - 1)}
            rx="1" fill={scanned ? c.warning : fill} opacity={scanned ? 0.95 : opacity} />
          {map.length <= 8 && cell >= 12
            ? <text x={x + col * cell + cell / 2} y={y + r * cell + cell / 2 + 2} fontSize="7"
                textAnchor="middle" fill={c.bg}>{fmt(val, 1)}</text>
            : null}
        </g>
      );
    }));

    const stageNames = ['输入', ...Array.from({ length: Number(snap.layers || 2) }, (_, i) => `C${i + 1}`), '展平', '分类'];
    const stageIndex = stage === 'intro' ? 0 : stage === 'flatten' ? stageNames.length - 2 : stage === 'dense' || stage === 'softmax' || stage === 'done' ? stageNames.length - 1 : Math.min(stageNames.length - 2, layer);
    const boxes = stageNames.map((name, i) => {
      const x = 24 + i * 86;
      const on = i === stageIndex;
      return (
        <g key={`stage-${i}`}>
          <rect x={x} y="32" width="74" height="24" rx="5" fill={on ? c.primary : c.panel2} opacity={on ? 0.95 : 0.8} />
          <text x={x + 37} y="48" fontSize="10" textAnchor="middle" fill={on ? c.bg : c.muted} fontWeight="600">{name}</text>
          {i < stageNames.length - 1 ? <path d={`M${x + 76},44 l7,-3 l0,6 z`} fill={c.accent} /> : null}
        </g>
      );
    });

    return (
      <Frame c={c} height={H} title="多层 CNN · 从图像到分类"
        subtitle={`${String(snap.label || '输入图像')} · ${String(snap.layers || 2)} 个卷积块 · 当前 ${String(stage)}`}>
        {boxes}
        <text x="24" y="76" fontSize="10" fill={c.muted}>输入图像 12×12</text>
        <text x="204" y="76" fontSize="10" fill={c.muted}>当前特征图 {nOut}×{nOut}</text>
        <text x="382" y="76" fontSize="10" fill={c.muted}>卷积核 3×3</text>
        {pixels(input, 24, 84, inCell, 'input')}
        {pixels(output, 204, 84, outCell, 'feature')}
        {kernel ? (
          <g>
            {kernel.w.map((row, r) => row.map((v, col) => (
              <g key={`k-${r}-${col}`}>
                <rect x={382 + col * 30} y={84 + r * 30} width="28" height="28" rx="3"
                  fill={v >= 0 ? c.success : c.danger} opacity={0.12 + 0.8 * clamp(Math.abs(v) / 4, 0, 1)} />
                <text x={382 + col * 30 + 14} y={84 + r * 30 + 18} fontSize="9" textAnchor="middle" fill={c.text}>{fmt(v, 1)}</text>
              </g>
            )))}
            <text x="382" y="182" fontSize="9" fill={c.muted}>{String(kernel.name)} · 权值共享</text>
          </g>
        ) : (
          <text x="382" y="100" fontSize="10" fill={c.muted}>{stage === 'done' ? '特征已送入分类器' : '等待卷积阶段'}</text>
        )}
        <text x="500" y="76" fontSize="10" fill={c.muted}>类别概率</text>
        {probs.map((v, i) => {
          const pv = clamp(Number(v) || 0, 0, 1);
          const y = 92 + i * 44;
          return (
            <g key={`p-${i}`}>
              <text x="500" y={y + 10} fontSize="10" fill={c.muted}>{String(LABELS[i])}</text>
              <rect x="560" y={y} width="132" height="14" rx="4" fill={c.panel2} />
              <rect x="560" y={y} width={132 * pv} height="14" rx="4" fill={c.series[i % c.series.length]} opacity="0.9" />
              <text x="700" y={y + 11} fontSize="9" textAnchor="end" fill={c.text}>{fmt(pv * 100, 1)}%</text>
            </g>
          );
        })}
        <text x="24" y={H - 14} fontSize="10" fill={c.muted}>
          {stage === 'conv' ? `正在扫描第 ${scanRow + 1} 行 · 局部感受野 3×3` : `阶段：${String(stage)} · 尺寸 ${nIn}×${nIn} → ${nOut}×${nOut}`}
        </text>
      </Frame>
    );
  },
};
