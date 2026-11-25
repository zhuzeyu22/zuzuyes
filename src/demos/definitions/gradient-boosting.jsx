import React from 'react';
import { mulberry32, clamp } from '../utils.js';

const W = 720, H = 320;
const PX0 = 46, PX1 = 410, PY0 = 34, PY1 = 262;
const CX0 = 452, CX1 = 694, CY0 = 50, CY1 = 200;
const NG = 121;

function gauss(rnd) {
  const u = Math.max(1e-9, rnd()), v = rnd();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}
function truth(x) { return 1.3 * Math.sin(2.6 * x) + 0.45 * x; }

// 聚合一段残差：L2 用均值与平方误差，L1 用中位数与绝对误差
function agg(idx, r, loss) {
  const vals = idx.map((i) => r[i]);
  if (vals.length === 0) return { val: 0, err: 0 };
  if (loss === 'l1') {
    const s = vals.slice().sort((a, b) => a - b);
    const m = s[Math.floor(s.length / 2)] || 0;
    return { val: m, err: vals.reduce((a, v) => a + Math.abs(v - m), 0) };
  }
  const m = vals.reduce((a, v) => a + v, 0) / vals.length;
  return { val: m, err: vals.reduce((a, v) => a + (v - m) * (v - m), 0) };
}

// 深度受限的一维阶梯回归树：逐层贪心二分，返回 [{lo,hi,val}]
function fitTree(xs, r, depth, minSeg, loss) {
  let segs = [{ lo: -1.1, hi: 1.1, idx: xs.map((_, i) => i) }];
  for (let level = 0; level < depth; level++) {
    const next = [];
    for (const seg of segs) {
      if (seg.idx.length < 2 * minSeg) { next.push(seg); continue; }
      const sorted = seg.idx.slice().sort((a, b) => xs[a] - xs[b]);
      const cand = [];
      for (let k = 1; k <= 8; k++) {
        const pos = Math.floor((sorted.length * k) / 9);
        if (pos > 0 && pos < sorted.length) cand.push(xs[sorted[pos]]);
      }
      const base = agg(seg.idx, r, loss).err;
      let best = null;
      for (const thr of cand) {
        const L = seg.idx.filter((i) => xs[i] <= thr);
        const R = seg.idx.filter((i) => xs[i] > thr);
        if (L.length < minSeg || R.length < minSeg) continue;
        const gain = base - (agg(L, r, loss).err + agg(R, r, loss).err);
        if (gain > 1e-9 && (!best || gain > best.gain)) best = { thr, L, R, gain };
      }
      if (best) {
        next.push({ lo: seg.lo, hi: best.thr, idx: best.L }, { lo: best.thr, hi: seg.hi, idx: best.R });
      } else {
        next.push(seg);
      }
    }
    segs = next;
  }
  return segs.map((s) => ({ lo: s.lo, hi: s.hi, val: agg(s.idx, r, loss).val }));
}
function evalTree(segs, x) {
  for (const s of segs) if (x >= s.lo && x <= s.hi) return s.val;
  return 0;
}

export default {
  id: 'gradient-boosting',
  params: [
    { key: 'rounds', label: '弱学习器轮数', type: 'range', min: 20, max: 120, step: 1, default: 40 },
    { key: 'lr', label: '学习率(收缩)', type: 'range', min: 0.05, max: 1, step: 0.05, default: 0.3 },
    { key: 'depth', label: '树深度(阶梯段数)', type: 'range', min: 1, max: 4, step: 1, default: 2 },
    { key: 'noise', label: '噪声强度', type: 'range', min: 0, max: 0.6, step: 0.02, default: 0.15 },
    { key: 'seed', label: '随机种子', type: 'range', min: 1, max: 40, step: 1, default: 6 },
    { key: 'loss', label: '损失函数', type: 'select', default: 'l2', options: [
      { value: 'l2', label: '平方损失(MSE)' },
      { value: 'l1', label: '绝对损失(MAE)' },
    ] },
  ],
  height: H,
  legend: [
    { label: '回归样本' }, { label: '真实函数' }, { label: '当前集成预测' },
    { label: '本轮残差阶梯' }, { label: '训练误差收敛' },
  ],
  hint: '每轮用一棵深度受限的阶梯树拟合当前残差，再乘学习率累加进集成，逐轮逼近真实函数。',

  buildSteps(p) {
    const rnd = mulberry32((Number(p.seed) || 6) >>> 0);
    const rounds = clamp(Math.round(Number(p.rounds) || 40), 1, 400);
    const lr = clamp(Number(p.lr) || 0.3, 0.01, 2);
    const depth = clamp(Math.round(Number(p.depth) || 2), 1, 4);
    const noise = clamp(Number(p.noise) || 0, 0, 1);
    const loss = p.loss === 'l1' ? 'l1' : 'l2';
    const n = 56;
    const xs = Array.from({ length: n }, (_, i) => -1 + (2 * i) / (n - 1));
    const ys = xs.map((x) => truth(x) + noise * gauss(rnd));
    const xg = Array.from({ length: NG }, (_, i) => -1 + (2 * i) / (NG - 1));
    const F = new Array(n).fill(0);
    const predGrid = new Array(NG).fill(0);
    const lossHist = [];
    const steps = [];
    const errOf = () => {
      let s = 0;
      for (let i = 0; i < n; i++) {
        const e = F[i] - ys[i];
        s += loss === 'l1' ? Math.abs(e) : e * e;
      }
      return s / n;
    };
    const safe = (v) => (Number.isFinite(v) ? Math.min(1e6, Math.max(0, v)) : 0);
    const push = (note, m, segs) => {
      const e = errOf();
      lossHist.push(Math.min(e, 20));
      let meanR = 0;
      for (let i = 0; i < n; i++) meanR += Math.abs(ys[i] - F[i]);
      meanR /= n;
      steps.push({
        predS: [...F], predGrid: [...predGrid], segs, points: xs.map((x, i) => ({ x, y: ys[i] })),
        lossHist: lossHist.slice(), round: m, lr, depth, loss,
        note,
        metrics: { 轮次: m, 学习率: lr, 训练误差: safe(e), 残差均值: safe(meanR) },
      });
    };
    push('初始集成预测恒为 0，残差即样本标签；开始逐轮拟合残差。', 0, []);
    for (let m = 1; m <= rounds; m++) {
      const r = ys.map((y, i) => y - F[i]);
      const segs = fitTree(xs, r, depth, 3, loss);
      for (let i = 0; i < n; i++) F[i] += lr * evalTree(segs, xs[i]);
      for (let j = 0; j < NG; j++) predGrid[j] += lr * evalTree(segs, xg[j]);
      push(`第 ${m} 轮：拟合出 ${segs.length} 段残差阶梯，乘学习率 ${lr.toFixed(2)} 累加，训练误差 ${errOf().toFixed(3)}。`, m, segs);
    }
    if (steps.length > 400) {
      const stride = Math.ceil(steps.length / 400);
      return steps.filter((_, i) => i % stride === 0 || i === steps.length - 1);
    }
    return steps;
  },

  render(snap, p, c) {
    const points = snap.points || [];
    const predGrid = snap.predGrid || [];
    const predS = snap.predS || [];
    const segs = snap.segs || [];
    const lossHist = snap.lossHist || [];
    const yLo = -2.2, yHi = 2.2;
    const sx = (x) => PX0 + ((x + 1) / 2) * (PX1 - PX0);
    const sy = (y) => PY1 - ((clamp(y, yLo - 1, yHi + 1) - yLo) / (yHi - yLo)) * (PY1 - PY0);
    const xg = Array.from({ length: NG }, (_, i) => -1 + (2 * i) / (NG - 1));
    const dTruth = xg.map((x, i) => `${i === 0 ? 'M' : 'L'}${sx(x).toFixed(1)},${sy(truth(x)).toFixed(1)}`).join(' ');
    const dPred = predGrid.map((v, i) => `${i === 0 ? 'M' : 'L'}${sx(xg[i]).toFixed(1)},${sy(v).toFixed(1)}`).join(' ');
    // 本轮阶梯：把分段常数拼成路径
    let dStep = '';
    segs.forEach((s, k) => {
      const x0 = clamp(s.lo, -1, 1), x1 = clamp(s.hi, -1, 1);
      dStep += `${k === 0 ? 'M' : 'L'}${sx(x0).toFixed(1)},${sy(s.val).toFixed(1)} L${sx(x1).toFixed(1)},${sy(s.val).toFixed(1)} `;
    });
    const maxL = Math.max(0.05, ...lossHist, 1e-6);
    const hx = (i) => CX0 + (i / Math.max(1, lossHist.length - 1)) * (CX1 - CX0);
    const ly = (v) => CY1 - (clamp(v, 0, maxL) / maxL) * (CY1 - CY0);
    const dLoss = lossHist.map((v, i) => `${i === 0 ? 'M' : 'L'}${hx(i).toFixed(1)},${ly(v).toFixed(1)}`).join(' ');
    return (
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} preserveAspectRatio="xMidYMid meet">
        <defs><clipPath id="gb-clip"><rect x={PX0} y={PY0} width={PX1 - PX0} height={PY1 - PY0} /></clipPath></defs>
        <rect x={PX0} y={PY0} width={PX1 - PX0} height={PY1 - PY0} fill={c.panel} stroke={c.border} />
        <g clipPath="url(#gb-clip)">
          <line x1={PX0} y1={sy(0)} x2={PX1} y2={sy(0)} stroke={c.grid} />
          <path d={dTruth} fill="none" stroke={c.muted} strokeWidth="1.5" strokeDasharray="4 3" />
          {segs.length > 0 && <path d={dStep} fill="none" stroke={c.warning} strokeWidth="1.6" strokeDasharray="5 3" opacity={0.85} />}
          {points.map((q, i) => (
            <line key={`v${i}`} x1={sx(q.x)} y1={sy(predS[i] || 0)} x2={sx(q.x)} y2={sy(q.y)}
              stroke={c.grid} strokeWidth="1" />
          ))}
          <path d={dPred} fill="none" stroke={c.primary} strokeWidth="2.4" />
          {points.map((q, i) => (
            <circle key={`p${i}`} cx={sx(q.x)} cy={sy(q.y)} r="2.4" fill={c.muted} />
          ))}
        </g>
        <text x={PX0} y={PY0 - 8} fontSize="11" fill={c.muted}>一维回归：样本 + 集成预测 + 残差</text>
        <text x={PX0} y={PY1 + 16} fontSize="10" fill={c.muted}>灰虚线=真实函数　蓝=集成预测</text>
        <text x={PX1} y={PY1 + 16} fontSize="10" textAnchor="end" fill={c.muted}>黄虚线=本轮阶梯</text>
        <text x={CX0} y={CY0 - 14} fontSize="11" fill={c.muted}>训练误差收敛</text>
        <rect x={CX0} y={CY0} width={CX1 - CX0} height={CY1 - CY0} fill={c.panel} stroke={c.border} />
        <line x1={CX0} y1={CY1} x2={CX1} y2={CY1} stroke={c.grid} />
        <line x1={CX0} y1={CY0} x2={CX0} y2={CY1} stroke={c.grid} />
        <path d={dLoss} fill="none" stroke={c.danger} strokeWidth="2" />
        <text x={CX0} y={CY0 + 12} fontSize="9" fill={c.muted}>误差</text>
        <text x={(CX0 + CX1) / 2} y={CY1 + 16} fontSize="10" textAnchor="middle" fill={c.muted}>弱学习器轮数 →</text>
        <text x="20" y={H - 12} fontSize="11" fill={c.text}>{snap.note || '拖动进度条查看逐轮逼近'}</text>
      </svg>
    );
  },
};
