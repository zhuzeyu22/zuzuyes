import React from 'react';
import { mulberry32, clamp } from '../utils.js';

const W = 720, H = 320;
const PX0 = 46, PX1 = 402, PY0 = 34, PY1 = 264;
const CX0 = 446, CX1 = 694, CY0 = 54, CY1 = 204;
const GX = 20, GY = 15;

function gauss(rnd) {
  const u = Math.max(1e-9, rnd()), v = rnd();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}
function sigmoid(z) { return 1 / (1 + Math.exp(-clamp(z, -30, 30))); }

function genData(dist, n, seed) {
  const rnd = mulberry32(seed >>> 0);
  const pts = [];
  const half = Math.floor(n / 2);
  for (let i = 0; i < n; i++) {
    let x, y, label;
    if (dist === 'ring') {
      const ang = rnd() * 2 * Math.PI;
      const inner = i < half;
      const r = inner ? 0.35 * Math.sqrt(rnd()) : 0.72 + 0.25 * rnd();
      x = r * Math.cos(ang) + gauss(rnd) * 0.05;
      y = r * Math.sin(ang) + gauss(rnd) * 0.05;
      label = inner ? 1 : 0;
    } else if (dist === 'overlap') {
      label = i < half ? 1 : 0;
      x = (label ? 0.35 : -0.35) + gauss(rnd) * 0.6;
      y = gauss(rnd) * 0.6;
    } else {
      label = i < half ? 1 : 0;
      x = (label ? 0.7 : -0.7) + gauss(rnd) * 0.32;
      y = (label ? 0.6 : -0.6) + gauss(rnd) * 0.32;
    }
    pts.push({ x: clamp(x, -1.6, 1.6), y: clamp(y, -1.6, 1.6), label });
  }
  return pts;
}

export default {
  id: 'logistic-regression',
  params: [
    { key: 'reg', label: '正则强度', type: 'range', min: 0, max: 1, step: 0.01, default: 0.05 },
    { key: 'iters', label: '迭代轮数', type: 'range', min: 20, max: 200, step: 1, default: 60 },
    { key: 'dist', label: '数据分布', type: 'select', default: 'linear', options: [
      { value: 'linear', label: '线性可分' },
      { value: 'ring', label: '环形(非线性)' },
      { value: 'overlap', label: '交叠难分' },
    ] },
    { key: 'n', label: '样本数', type: 'range', min: 40, max: 160, step: 1, default: 80 },
    { key: 'seed', label: '随机种子', type: 'range', min: 1, max: 40, step: 1, default: 9 },
  ],
  height: H,
  legend: [
    { label: '类别 A / 高概率区' }, { label: '类别 B / 低概率区' },
    { label: '线性决策边界' }, { label: '损失与准确率' },
  ],
  hint: '线性逻辑回归用梯度下降最小化交叉熵；环形分布会暴露线性决策边界的局限。',

  buildSteps(p) {
    const n = clamp(Math.round(Number(p.n) || 80), 20, 200);
    const iters = clamp(Math.round(Number(p.iters) || 60), 1, 400);
    const reg = clamp(Number(p.reg) || 0, 0, 2);
    const dist = p.dist || 'linear';
    const seed = (Number(p.seed) || 9) >>> 0;
    const pts = genData(dist, n, seed);
    const lr = 0.6;
    let w = [0, 0, 0];
    const lossHist = [], accHist = [];
    const steps = [];
    const safe = (v) => (Number.isFinite(v) ? Math.min(1e6, Math.max(0, v)) : 0);
    const push = (note, t) => {
      let L = 0, correct = 0;
      for (const q of pts) {
        const p1 = sigmoid(w[0] + w[1] * q.x + w[2] * q.y);
        const pc = clamp(p1, 1e-9, 1);
        L += -(q.label * Math.log(pc) + (1 - q.label) * Math.log(1 - pc));
        if ((p1 >= 0.5 ? 1 : 0) === q.label) correct += 1;
      }
      L = L / pts.length + 0.5 * reg * (w[1] * w[1] + w[2] * w[2]);
      const acc = correct / pts.length;
      lossHist.push(Math.min(L, 20)); accHist.push(acc);
      steps.push({
        w: [...w], pts, dist, reg, lossHist: lossHist.slice(), accHist: accHist.slice(),
        note,
        metrics: { 迭代: t, 损失: safe(L), 训练准确率: acc, 正则强度: reg },
      });
    };
    push('初始 w=0，决策边界未定义，正类概率全为 0.5；开始梯度下降。', 0);
    for (let t = 1; t <= iters; t++) {
      const g = [0, 0, 0];
      for (const q of pts) {
        const p1 = sigmoid(w[0] + w[1] * q.x + w[2] * q.y);
        const e = p1 - q.label;
        g[0] += e; g[1] += e * q.x; g[2] += e * q.y;
      }
      for (let j = 0; j < 3; j++) g[j] /= pts.length;
      g[1] += reg * w[1]; g[2] += reg * w[2];
      const nw = w.map((v, j) => v - lr * g[j]);
      w = nw.map((v) => (Number.isFinite(v) ? clamp(v, -50, 50) : 0));
      push(`第 ${t} 轮：更新权重 w=(${w.map((v) => v.toFixed(2)).join(', ')})，交叉熵损失 ${(lossHist[lossHist.length - 1] || 0).toFixed(3)}。`, t);
    }
    if (steps.length > 400) {
      const stride = Math.ceil(steps.length / 400);
      return steps.filter((_, i) => i % stride === 0 || i === steps.length - 1);
    }
    return steps;
  },

  render(snap, p, c) {
    const w = snap.w || [];
    const w0 = w[0] || 0, w1 = w[1] || 0, w2 = w[2] || 0;
    const pts = snap.pts || [];
    const lossHist = snap.lossHist || [], accHist = snap.accHist || [];
    const dist = snap.dist || 'linear';
    const distName = dist === 'ring' ? '环形(非线性)' : dist === 'overlap' ? '交叠难分' : '线性可分';
    const sx = (x) => PX0 + ((x + 1.6) / 3.2) * (PX1 - PX0);
    const sy = (y) => PY1 - ((y + 1.6) / 3.2) * (PY1 - PY0);
    const cw = (PX1 - PX0) / GX, ch = (PY1 - PY0) / GY;
    const cells = [];
    for (let gx = 0; gx < GX; gx++) {
      for (let gy = 0; gy < GY; gy++) {
        const xd = -1.6 + (3.2 * (gx + 0.5)) / GX;
        const yd = 1.6 - (3.2 * (gy + 0.5)) / GY;
        const pr = sigmoid(w0 + w1 * xd + w2 * yd);
        cells.push({ x: PX0 + gx * cw, y: PY0 + gy * ch, pr });
      }
    }
    let boundary = null;
    if (Math.abs(w2) > 1e-6) {
      const ya = clamp(-(w0 + w1 * -1.6) / w2, -3, 3);
      const yb = clamp(-(w0 + w1 * 1.6) / w2, -3, 3);
      boundary = <line x1={sx(-1.6)} y1={sy(ya)} x2={sx(1.6)} y2={sy(yb)} stroke={c.text} strokeWidth="2" />;
    } else if (Math.abs(w1) > 1e-6) {
      const xv = clamp(-w0 / w1, -3, 3);
      boundary = <line x1={sx(xv)} y1={PY0} x2={sx(xv)} y2={PY1} stroke={c.text} strokeWidth="2" />;
    }
    const maxL = Math.max(0.1, ...lossHist, 1e-6);
    const hx = (i) => CX0 + (i / Math.max(1, lossHist.length - 1)) * (CX1 - CX0);
    const ly = (v) => CY1 - (clamp(v, 0, maxL) / maxL) * (CY1 - CY0);
    const ay = (v) => CY1 - clamp(v, 0, 1) * (CY1 - CY0);
    const dLoss = lossHist.map((v, i) => `${i === 0 ? 'M' : 'L'}${hx(i).toFixed(1)},${ly(v).toFixed(1)}`).join(' ');
    const dAcc = accHist.map((v, i) => `${i === 0 ? 'M' : 'L'}${hx(i).toFixed(1)},${ay(v).toFixed(1)}`).join(' ');
    return (
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} preserveAspectRatio="xMidYMid meet">
        <defs><clipPath id="lg-clip"><rect x={PX0} y={PY0} width={PX1 - PX0} height={PY1 - PY0} /></clipPath></defs>
        <rect x={PX0} y={PY0} width={PX1 - PX0} height={PY1 - PY0} fill={c.panel} stroke={c.border} />
        <g clipPath="url(#lg-clip)">
          {cells.map((cell, i) => (
            <rect key={i} x={cell.x} y={cell.y} width={cw + 0.5} height={ch + 0.5}
              fill={cell.pr >= 0.5 ? c.series[0] : c.series[1]}
              opacity={0.05 + Math.abs(cell.pr - 0.5) * 0.5} />
          ))}
          {boundary}
          {pts.map((q, i) => (
            <circle key={i} cx={sx(q.x)} cy={sy(q.y)} r="3"
              fill={q.label === 1 ? c.series[0] : c.series[1]}
              stroke={c.bg} strokeWidth="0.8" />
          ))}
        </g>
        <text x={PX0} y={PY0 - 8} fontSize="11" fill={c.muted}>概率热力背景 + 决策边界（{distName}）</text>
        <text x={PX0} y={PY1 + 16} fontSize="10" fill={c.muted}>特征平面 (x₁, x₂)</text>
        <text x={PX1} y={PY1 + 16} fontSize="10" textAnchor="end" fill={c.muted}>深色线 w·x+b=0</text>
        <text x={CX0} y={CY0 - 14} fontSize="11" fill={c.muted}>损失 / 准确率收敛</text>
        <rect x={CX0} y={CY0} width={CX1 - CX0} height={CY1 - CY0} fill={c.panel} stroke={c.border} />
        <line x1={CX0} y1={CY1} x2={CX1} y2={CY1} stroke={c.grid} />
        <line x1={CX0} y1={CY0} x2={CX0} y2={CY1} stroke={c.grid} />
        <path d={dLoss} fill="none" stroke={c.primary} strokeWidth="2" />
        <path d={dAcc} fill="none" stroke={c.success} strokeWidth="2" strokeDasharray="4 3" />
        <text x={CX0} y={CY0 + 12} fontSize="9" fill={c.muted}>蓝=交叉熵</text>
        <text x={CX1} y={CY0 + 12} fontSize="9" textAnchor="end" fill={c.muted}>绿虚线=准确率</text>
        <text x={(CX0 + CX1) / 2} y={CY1 + 16} fontSize="10" textAnchor="middle" fill={c.muted}>迭代轮数 →</text>
        <text x="20" y={H - 12} fontSize="11" fill={c.text}>{snap.note || '拖动进度条查看决策边界演化'}</text>
      </svg>
    );
  },
};
