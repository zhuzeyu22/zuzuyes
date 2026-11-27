import React from 'react';
import { mulberry32, clamp } from '../utils.js';
import { datasetParam, regressionPoints, dataLabel } from '../datasets/adapter.js';

const W = 720, H = 320;
const PX0 = 46, PX1 = 410, PY0 = 34, PY1 = 262;
const CX0 = 452, CX1 = 694, CY0 = 50, CY1 = 200;

function gauss(rnd) {
  const u = Math.max(1e-9, rnd()), v = rnd();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}
function truth(x) { return Math.sin(3.1 * x) + 0.35 * x; }
function poly(x, w, scale) {
  let s = 0;
  for (let j = 0; j < w.length; j++) s += (w[j] || 0) * Math.pow(x, j) / (scale[j] || 1);
  return Number.isFinite(s) ? s : 0;
}
// 高斯-约当消元(部分主元)解 Ax=b，奇异列跳过，返回有限系数
function solve(A, b) {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let col = 0; col < n; col++) {
    let piv = col;
    for (let r = col + 1; r < n; r++) if (Math.abs(M[r][col]) > Math.abs(M[piv][col])) piv = r;
    if (Math.abs(M[piv][col]) < 1e-10) continue;
    [M[col], M[piv]] = [M[piv], M[col]];
    const pv = M[col][col];
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const f = M[r][col] / pv;
      if (!Number.isFinite(f)) continue;
      for (let k = col; k <= n; k++) M[r][k] -= f * M[col][k];
    }
  }
  return M.map((row, i) => {
    const d = row[i];
    const w = Math.abs(d) < 1e-12 ? 0 : row[n] / d;
    return Number.isFinite(w) ? w : 0;
  });
}

export default {
  id: 'linear-regression',
  params: [
    datasetParam('diabetes', ['diabetes']),
    { key: 'degree', label: '多项式阶数', type: 'range', min: 1, max: 9, step: 1, default: 3, hint: '阶数过高易过拟合' },
    { key: 'noise', label: '噪声强度', type: 'range', min: 0, max: 0.6, step: 0.02, default: 0.18 },
    { key: 'n', label: '样本数', type: 'range', min: 12, max: 100, step: 1, default: 40 },
    { key: 'seed', label: '随机种子', type: 'range', min: 1, max: 40, step: 1, default: 6 },
    { key: 'iters', label: '迭代轮数', type: 'range', min: 24, max: 160, step: 1, default: 70 },
    { key: 'ridge', label: '岭正则(抑制过拟合)', type: 'toggle', default: false },
  ],
  height: H,
  legend: [
    { label: '训练样本' }, { label: '测试样本' }, { label: '当前拟合' },
    { label: '正规方程解' }, { label: '真实函数' },
  ],
  hint: '用正规方程(自实现高斯消元)求闭式解作参考，再用梯度下降逐轮逼近；高阶+小样本会明显过拟合。',

  buildSteps(p) {
    const rnd = mulberry32((Number(p.seed) || 6) >>> 0);
    const n = clamp(Math.round(Number(p.n) || 40), 8, 140);
    const deg = clamp(Math.round(Number(p.degree) || 3), 1, 9);
    const noise = clamp(Number(p.noise) || 0, 0, 1);
    const iters = clamp(Math.round(Number(p.iters) || 70), 1, 400);
    const lam = p.ridge ? 0.08 : 1e-6;

    const real = regressionPoints(p, 'diabetes', () => [], 2);
    const useReal = real.length > 0;
    const m = useReal ? real.length : n;
    const xs = [], ys = [];
    if (useReal) {
      for (const q of real) { xs.push(q.x * 2 - 1 + (rnd() - 0.5) * 0.004); ys.push(q.y); }
    } else {
      for (let i = 0; i < n; i++) {
        const x = clamp(-1 + (2 * (i + 0.5)) / n + (rnd() - 0.5) * 0.02, -1.05, 1.05);
        xs.push(x);
        ys.push(truth(x) + noise * gauss(rnd));
      }
    }
    const source = dataLabel(p, 'diabetes');
    const order = Array.from({ length: m }, (_, i) => i);
    for (let i = m - 1; i > 0; i--) {
      const j = Math.floor(rnd() * (i + 1));
      [order[i], order[j]] = [order[j], order[i]];
    }
    const nTr = Math.max(8, Math.round(m * 0.7));
    const train = order.slice(0, nTr).map((i) => ({ x: xs[i], y: ys[i] }));
    const test = order.slice(nTr).map((i) => ({ x: xs[i], y: ys[i] }));

    const d = deg + 1;
    const scale = [];
    for (let j = 0; j < d; j++) {
      let s = 0;
      for (const q of train) s += Math.pow(q.x, j) ** 2;
      scale.push(Math.sqrt(s / Math.max(1, train.length)) + 0.1);
    }
    const PHI = train.map((q) => Array.from({ length: d }, (_, j) => Math.pow(q.x, j) / scale[j]));

    const A = Array.from({ length: d }, () => new Array(d).fill(0));
    const bb = new Array(d).fill(0);
    for (let i = 0; i < PHI.length; i++) {
      for (let j = 0; j < d; j++) {
        bb[j] += (PHI[i][j] * train[i].y) / PHI.length;
        for (let k = 0; k < d; k++) A[j][k] += (PHI[i][j] * PHI[i][k]) / PHI.length;
      }
    }
    for (let j = 0; j < d; j++) A[j][j] += j === 0 ? 1e-8 : lam;
    const wOpt = solve(A, bb);

    const mse = (pts, w) => {
      let s = 0;
      for (const q of pts) { const e = poly(q.x, w, scale) - q.y; s += e * e; }
      return s / Math.max(1, pts.length);
    };
    const optTr = mse(train, wOpt), optTe = mse(test, wOpt);
    const safe = (v) => (Number.isFinite(v) ? Math.min(1e6, Math.max(0, v)) : 0);

    let w = new Array(d).fill(0);
    const lrGD = 0.15;
    const histTr = [], histTe = [];
    const steps = [];
    const push = (note, t) => {
      const tr = mse(train, w), te = mse(test, w);
      histTr.push(Math.min(tr, 50)); histTe.push(Math.min(te, 50));
      steps.push({
        w: [...w], scale, wOpt, degree: deg, train, test,
        histTr: histTr.slice(), histTe: histTe.slice(), optTr: Math.min(optTr, 50),
        useReal,
        note: `${note} 数据来源：${source}。`,
        metrics: { 阶数: deg, 迭代: t, 训练误差: safe(tr), 测试误差: safe(te), 最优误差: safe(optTr) },
      });
    };
    push(`正规方程闭式解：最优训练误差 ${optTr.toFixed(3)}、测试误差 ${optTe.toFixed(3)}；从 w=0 起做梯度下降。`, 0);
    for (let t = 1; t <= iters; t++) {
      const grad = new Array(d).fill(0);
      for (let i = 0; i < PHI.length; i++) {
        const e = poly(train[i].x, w, scale) - train[i].y;
        for (let j = 0; j < d; j++) grad[j] += (PHI[i][j] * e) / PHI.length;
      }
      for (let j = 0; j < d; j++) {
        grad[j] += j === 0 ? 0 : lam * w[j];
        const nw = (w[j] || 0) - lrGD * grad[j];
        w[j] = Number.isFinite(nw) ? clamp(nw, -1e5, 1e5) : 0;
      }
      push(`第 ${t} 轮：更新多项式系数，训练误差 ${mse(train, w).toFixed(3)}，测试误差 ${mse(test, w).toFixed(3)}。`, t);
    }
    if (steps.length > 400) {
      const stride = Math.ceil(steps.length / 400);
      return steps.filter((_, i) => i % stride === 0 || i === steps.length - 1);
    }
    return steps;
  },

  render(snap, p, c) {
    const train = snap.train || [], test = snap.test || [];
    const w = snap.w || [], scale = snap.scale || [], wOpt = snap.wOpt || [];
    const deg = snap.degree ?? 3;
    const histTr = snap.histTr || [], histTe = snap.histTe || [];
    const optTr = snap.optTr ?? 0;
    const allY = [...train, ...test].map((q) => q.y);
    let yLo = Math.min(-1.6, ...allY, -1.6) - 0.2;
    let yHi = Math.max(1.6, ...allY, 1.6) + 0.2;
    yLo = clamp(yLo, -4, -1.4); yHi = clamp(yHi, 1.4, 4);
    const sx = (x) => PX0 + ((x + 1.05) / 2.1) * (PX1 - PX0);
    const sy = (y) => PY1 - ((clamp(y, yLo - 1, yHi + 1) - yLo) / (yHi - yLo)) * (PY1 - PY0);
    const grid = Array.from({ length: 101 }, (_, i) => -1.05 + (2.1 * i) / 100);
    const pathOf = (fn) => grid.map((x, i) =>
      `${i === 0 ? 'M' : 'L'}${sx(x).toFixed(1)},${sy(clamp(fn(x), yLo - 1, yHi + 1)).toFixed(1)}`).join(' ');
    const dCur = pathOf((x) => poly(x, w, scale));
    const dOpt = pathOf((x) => poly(x, wOpt, scale));
    const dTruth = pathOf(truth);
    const pt = (q, color, r, key) => (
      <circle key={key} cx={sx(q.x)} cy={sy(clamp(q.y, yLo - 1, yHi + 1))} r={r} fill={color} opacity={0.85} />
    );
    const hiE = Math.max(0.2, Math.min(8, Math.max(histTr[0] || 0, histTe[0] || 0, optTr) * 1.4));
    const hx = (i) => CX0 + (i / Math.max(1, histTr.length - 1)) * (CX1 - CX0);
    const hy = (v) => CY1 - (clamp(v, 0, hiE) / hiE) * (CY1 - CY0);
    const dTr = histTr.map((v, i) => `${i === 0 ? 'M' : 'L'}${hx(i).toFixed(1)},${hy(v).toFixed(1)}`).join(' ');
    const dTe = histTe.map((v, i) => `${i === 0 ? 'M' : 'L'}${hx(i).toFixed(1)},${hy(v).toFixed(1)}`).join(' ');
    const overfit = deg >= 6 && histTe.length > 0 &&
      histTe[histTe.length - 1] > (histTr[histTr.length - 1] || 0) * 1.6 + 0.05;
    return (
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} preserveAspectRatio="xMidYMid meet">
        <defs><clipPath id="lr-clip"><rect x={PX0} y={PY0} width={PX1 - PX0} height={PY1 - PY0} /></clipPath></defs>
        <rect x={PX0} y={PY0} width={PX1 - PX0} height={PY1 - PY0} fill={c.panel} stroke={c.border} />
        <g clipPath="url(#lr-clip)">
          <line x1={PX0} y1={sy(0)} x2={PX1} y2={sy(0)} stroke={c.grid} />
          {!snap.useReal && <path d={dTruth} fill="none" stroke={c.muted} strokeWidth="1.5" strokeDasharray="4 3" />}
          <path d={dOpt} fill="none" stroke={c.purple} strokeWidth="2" strokeDasharray="5 3" />
          <path d={dCur} fill="none" stroke={c.primary} strokeWidth="2.4" />
          {train.map((q, i) => pt(q, c.series[0], 3, `tr${i}`))}
          {test.map((q, i) => pt(q, c.series[1], 3.4, `te${i}`))}
        </g>
        <text x={PX0} y={PY0 - 8} fontSize="11" fill={c.muted}>多项式拟合：样本 + 拟合曲线</text>
        <text x={PX0} y={PY1 + 16} fontSize="10" fill={c.muted}>x ∈ [-1, 1]，阶数 {deg}</text>
        <text x={PX1} y={PY1 + 16} fontSize="10" textAnchor="end" fill={overfit ? c.danger : c.muted}>
          {overfit ? '高阶 + 小样本 → 过拟合' : snap.useReal ? '紫虚线=闭式解 · BMI→疾病进展' : '紫虚线=闭式解，灰虚线=真实函数'}
        </text>
        <text x={CX0} y={CY0 - 14} fontSize="11" fill={c.muted}>训练 / 测试误差</text>
        <rect x={CX0} y={CY0} width={CX1 - CX0} height={CY1 - CY0} fill={c.panel} stroke={c.border} />
        <line x1={CX0} y1={CY1} x2={CX1} y2={CY1} stroke={c.grid} />
        <line x1={CX0} y1={CY0} x2={CX0} y2={CY1} stroke={c.grid} />
        <line x1={CX0} y1={hy(optTr)} x2={CX1} y2={hy(optTr)} stroke={c.purple} strokeDasharray="4 3" strokeWidth="1" />
        <path d={dTr} fill="none" stroke={c.primary} strokeWidth="2" />
        <path d={dTe} fill="none" stroke={c.danger} strokeWidth="2" />
        <text x={CX0} y={CY0 + 12} fontSize="9" fill={c.muted}>误差</text>
        <text x={CX0} y={CY1 + 16} fontSize="10" fill={c.muted}>蓝=训练</text>
        <text x={(CX0 + CX1) / 2} y={CY1 + 16} fontSize="10" textAnchor="middle" fill={c.muted}>红=测试</text>
        <text x={CX1} y={CY1 + 16} fontSize="10" textAnchor="end" fill={c.muted}>紫虚线=最优</text>
        <text x="20" y={H - 12} fontSize="11" fill={c.text}>{snap.note || '拖动进度条查看拟合过程'}</text>
      </svg>
    );
  },
};
