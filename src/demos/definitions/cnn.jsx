import React from 'react';
import { clamp, mulberry32 } from '../utils.js';

const H = 360;
const N = 7;
const K = 3;
const KERNELS = {
  edge: { name: '边缘检测', w: [[-1, -1, -1], [-1, 8, -1], [-1, -1, -1]] },
  blur: { name: '均值模糊', w: [[1, 1, 1], [1, 1, 1], [1, 1, 1]].map((r) => r.map((v) => v / 9)) },
  sharpen: { name: '锐化', w: [[0, -1, 0], [-1, 5, -1], [0, -1, 0]] },
};

function makeInput() {
  const rnd = mulberry32(20260721);
  const base = Array.from({ length: N }, (_, r) => Array.from({ length: N }, (_, col) => {
    const d = Math.hypot(r - 3, col - 3);
    const circle = d > 1.9 && d < 2.8 ? 0.55 : 0;
    const line = Math.abs(r - col) <= 0.25 ? 0.35 : 0;
    return clamp(0.08 + circle + line + (rnd() - 0.5) * 0.12, 0, 1);
  }));
  return base;
}
const INPUT = makeInput();
const fmt = (v) => Number(v).toFixed(2);

export default {
  id: 'cnn',
  params: [
    { key: 'kernel', label: '卷积核', type: 'select', default: 'edge', options: [
      { value: 'edge', label: '边缘检测' }, { value: 'blur', label: '均值模糊' }, { value: 'sharpen', label: '锐化' },
    ] },
    { key: 'stride', label: '步长 stride', type: 'range', min: 1, max: 2, step: 1, default: 1 },
    { key: 'padding', label: '补零 padding=1', type: 'toggle', default: false, hint: '保留边缘信息，输出尺寸更大' },
  ],
  height: H,
  legend: [
    { label: '当前感受野' }, { label: '已计算输出' }, { label: '补零区域' }, { label: '高激活' },
  ],
  hint: '卷积 = 局部感受野与卷积核逐元素相乘求和；步长决定滑动间隔，补零决定边缘是否被保留。',

  buildSteps(p) {
    const kernelKey = KERNELS[p.kernel] ? p.kernel : 'edge';
    const kernel = KERNELS[kernelKey].w;
    const stride = clamp(Math.round(Number(p.stride) || 1), 1, 2);
    const pad = p.padding ? 1 : 0;
    const size = N + 2 * pad;
    const padded = Array.from({ length: size }, (_, r) => Array.from({ length: size }, (_, col) => {
      const ir = r - pad, ic = col - pad;
      return (ir < 0 || ic < 0 || ir >= N || ic >= N) ? 0 : INPUT[ir][ic];
    }));
    const outSize = Math.floor((size - K) / stride) + 1;
    const output = Array.from({ length: outSize }, () => Array.from({ length: outSize }, () => 0));

    const common = {
      input: INPUT, padded, kernel, kernelName: KERNELS[kernelKey].name,
      stride, pad, size, outSize, output: output.map((r) => r.slice()),
      orow: -1, ocol: -1, cur: [], dot: 0,
      metrics: { 输出尺寸: `${outSize}×${outSize}`, 步长: stride, 补零: pad ? '1 圈' : '无', 已计算: 0 },
    };
    const steps = [{ ...common, note: `输入 ${N}×${N} 灰度图，卷积核 ${K}×${K}（${KERNELS[kernelKey].name}），准备按步长 ${stride} 滑动。`, phase: 'init' }];
    steps.push({ ...common, note: `卷积核共 ${K * K} 个权重，每个窗口做逐元素相乘再求和，得到一个输出像素。`, phase: 'kernel' });

    let count = 0;
    for (let r = 0; r < outSize; r++) {
      for (let col = 0; col < outSize; col++) {
        const sr = r * stride, sc = col * stride;
        const window = Array.from({ length: K }, (_, i) => Array.from({ length: K }, (_, j) => padded[sr + i][sc + j]));
        let dot = 0;
        for (let i = 0; i < K; i++) for (let j = 0; j < K; j++) dot += window[i][j] * kernel[i][j];
        output[r][col] = dot;
        count++;
        steps.push({
          ...common,
          output: output.map((row) => row.slice()),
          orow: r, ocol: col, cur: window, dot,
          phase: 'slide',
          note: `窗口 (${r}, ${col})：9 个像素 × 对应权重求和 = ${fmt(dot)}，写入输出第 ${r + 1} 行第 ${col + 1} 列。`,
          metrics: { 输出尺寸: `${outSize}×${outSize}`, 步长: stride, 补零: pad ? '1 圈' : '无', 已计算: `${count}/${outSize * outSize}`, 当前值: fmt(dot) },
        });
      }
    }
    steps.push({
      ...common, output: output.map((row) => row.slice()), orow: -1, ocol: -1, phase: 'done',
      note: `扫描完成：${N}×${N} 输入 → ${outSize}×${outSize} 特征图。试试切换卷积核或打开补零。`,
      metrics: { 输出尺寸: `${outSize}×${outSize}`, 步长: stride, 补零: pad ? '1 圈' : '无', 已计算: `${count}/${outSize * outSize}` },
    });
    return steps;
  },

  render(snap, p, c) {
    const padded = snap.padded || [];
    const input = snap.input || [];
    const kernel = snap.kernel || [];
    const output = snap.output || [];
    const size = snap.size || N;
    const outSize = snap.outSize || 1;
    const pad = snap.pad || 0;
    const stride = snap.stride || 1;
    const orow = snap.orow ?? -1;
    const ocol = snap.ocol ?? -1;
    const inCell = Math.min(28, 190 / size);
    const outCell = Math.min(28, 180 / outSize);
    const ix = 36, iy = 62, kx = 280, ky = 78, ox = 480, oy = 70;
    const heat = (v) => {
      const a = clamp(Math.abs(v), 0, 1);
      return c.series[v < 0 ? 1 : 0];
    };

    const inputCells = padded.map((row, r) => row.map((v, col) => {
      const isPad = r < pad || col < pad || r >= pad + N || col >= pad + N;
      const inWindow = orow >= 0 && r >= orow * stride && r < orow * stride + K
        && col >= ocol * stride && col < ocol * stride + K;
      return (
        <g key={`i-${r}-${col}`}>
          <rect x={ix + col * inCell} y={iy + r * inCell} width={inCell - 2} height={inCell - 2} rx="3"
            fill={isPad ? c.panel : v > 0.55 ? c.primary : v > 0.25 ? c.series[5] : c.panel2}
            fillOpacity={isPad ? 0.35 : isPad ? 0.2 : 0.25 + v * 0.7}
            stroke={inWindow ? c.warning : c.border} strokeWidth={inWindow ? 2 : 0.8}
            strokeDasharray={isPad ? '2 2' : undefined} />
          {!isPad && <text x={ix + col * inCell + (inCell - 2) / 2} y={iy + r * inCell + (inCell - 2) / 2 + 3}
            textAnchor="middle" fontSize="9" fill={v > 0.55 ? c.bg : c.text}>{fmt(v)}</text>}
        </g>
      );
    }));

    const kernelCells = kernel.map((row, r) => row.map((v, col) => (
      <g key={`k-${r}-${col}`}>
        <rect x={kx + col * 30} y={ky + r * 30} width="28" height="28" rx="4"
          fill={v >= 0 ? c.panel : c.panel2} stroke={v >= 0 ? c.primary : c.danger} strokeWidth="1.2" />
        <text x={kx + col * 30 + 14} y={ky + r * 30 + 18} textAnchor="middle" fontSize="10"
          fill={v >= 0 ? c.primary : c.danger}>{fmt(v)}</text>
      </g>
    )));

    const outputCells = output.map((row, r) => row.map((v, col) => {
      const active = r === orow && col === ocol;
      return (
        <g key={`o-${r}-${col}`}>
          <rect x={ox + col * outCell} y={oy + r * outCell} width={outCell - 2} height={outCell - 2} rx="3"
            fill={heat(v)} fillOpacity={clamp(Math.abs(v), 0.08, 0.9)}
            stroke={active ? c.warning : c.border} strokeWidth={active ? 2 : 0.8} />
          <text x={ox + col * outCell + (outCell - 2) / 2} y={oy + r * outCell + (outCell - 2) / 2 + 3}
            textAnchor="middle" fontSize="9" fill={Math.abs(v) > 0.5 ? c.bg : c.text}>{fmt(v)}</text>
        </g>
      );
    }));

    const inputLabel = pad ? `补零后 ${size}×${size}` : `原始输入 ${N}×${N}`;

    return (
      <svg viewBox="0 0 720 360" width="100%" role="img" aria-label="卷积神经网络滑动窗口计算">
        <text x={ix} y="30" fontSize="12" fill={c.muted}>{inputLabel}</text>
        <text x={kx} y="30" fontSize="12" fill={c.muted}>卷积核 {K}×{K}</text>
        <text x={ox} y="30" fontSize="12" fill={c.muted}>输出特征图 {outSize}×{outSize}</text>
        {inputCells}
        {kernelCells}
        {outputCells}
        <text x={kx} y="196" fontSize="11" fill={c.text}>{snap.kernelName || '卷积核'}</text>
        <text x={kx} y="214" fontSize="11" fill={c.muted}>stride = {stride} · padding = {pad}</text>
        <rect x="36" y="292" width="650" height="48" rx="10" fill={c.panel} stroke={c.border} />
        <text x="50" y="312" fontSize="11" fill={c.muted}>当前窗口</text>
        <text x="50" y="331" fontSize="12" fill={c.text}>
          {orow >= 0 ? `位置 (${orow}, ${ocol}) · 9 次乘加 · 点积 = ${fmt(snap.dot || 0)}` : '点击播放，观察窗口从左上角开始逐格滑动'}
        </text>
        <text x="500" y="312" fontSize="11" fill={c.muted}>输出公式</text>
        <text x="500" y="331" fontSize="11" fill={c.text}>O[i,j] = Σ Σ Input · Kernel</text>
      </svg>
    );
  },
};
