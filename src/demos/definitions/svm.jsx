import React from 'react';
import { mulberry32, clamp } from '../utils.js';

const W = 720, H = 320;
const PX0 = 46, PX1 = 410, PY0 = 34, PY1 = 264;
const CX0 = 452, CX1 = 694, CY0 = 54, CY1 = 204;
const GX = 28, GY = 20;
const D = 24;       // 随机傅里叶特征维度
const GAMMA = 2.0;

function gauss(rnd) {
  const u = Math.max(1e-9, rnd()), v = rnd();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}
function genData(n, overlap, seed) {
  const rnd = mulberry32(seed >>> 0);
  const pts = [];
  const sep = 1 - overlap * 0.8;
  for (let i = 0; i < n; i++) {
    const label = i % 2 === 0 ? -1 : 1;
    const x = label * sep * 0.6 + gauss(rnd) * (0.25 + overlap * 0.5);
    const y = label * 0.15 + gauss(rnd) * (0.25 + overlap * 0.5);
    pts.push({ x: clamp(x, -1.6, 1.6), y: clamp(y, -1.6, 1.6), label });
  }
  return pts;
}
function makeRFF(seed) {
  const rnd = mulberry32(seed >>> 0);
  const Wm = [], bv = [];
  for (let j = 0; j < D; j++) {
    Wm.push([gauss(rnd) * Math.sqrt(2 * GAMMA), gauss(rnd) * Math.sqrt(2 * GAMMA)]);
    bv.push(rnd() * 2 * Math.PI);
  }
  return { Wm, bv };
}
function phi(q, kernel, rff) {
  if (kernel === 'linear') return [q.x, q.y];
  if (!rff) return new Array(D).fill(0);
  const z = new Array(D);
  for (let j = 0; j < D; j++) {
    z[j] = Math.sqrt(2 / D) * Math.cos(rff.Wm[j][0] * q.x + rff.Wm[j][1] * q.y + rff.bv[j]);
  }
  return z;
}
function dot(a, b) {
  let s = 0;
  for (let j = 0; j < a.length; j++) s += (a[j] || 0) * (b[j] || 0);
  return s;
}

export default {
  id: 'svm',
  params: [
    { key: 'C', label: '惩罚系数 C', type: 'range', min: 0.1, max: 10, step: 0.1, default: 1, hint: '越大越不容忍误分' },
    { key: 'overlap', label: '类别重叠度', type: 'range', min: 0, max: 0.8, step: 0.02, default: 0.3 },
    { key: 'kernel', label: '核类型', type: 'select', default: 'linear', options: [
      { value: 'linear', label: '线性核' },
      { value: 'rbf', label: 'RBF 近似(随机特征)' },
    ] },
    { key: 'iters', label: '迭代轮数', type: 'range', min: 20, max: 200, step: 1, default: 80 },
    { key: 'n', label: '样本数', type: 'range', min: 40, max: 120, step: 1, default: 80 },
    { key: 'seed', label: '随机种子', type: 'range', min: 1, max: 40, step: 1, default: 3 },
  ],
  height: H,
  legend: [
    { label: '负类 / 决策区' }, { label: '正类 / 决策区' }, { label: '间隔带 |f|≤1' },
    { label: '支持向量(圈出)' }, { label: 'hinge 损失收敛' },
  ],
  hint: '软间隔 SVM 目标 0.5‖w‖²+C·hinge，用批量次梯度下降训练；RBF 近似用随机傅里叶特征得到非线性边界。',

  buildSteps(p) {
    const n = clamp(Math.round(Number(p.n) || 80), 40, 120);
    const C = clamp(Number(p.C) || 1, 0.01, 30);
    const overlap = clamp(Number(p.overlap) || 0, 0, 1);
    const kernel = p.kernel === 'rbf' ? 'rbf' : 'linear';
    const iters = clamp(Math.round(Number(p.iters) || 80), 1, 400);
    const seed = (Number(p.seed) || 3) >>> 0;
    const pts = genData(n, overlap, seed);
    const rff = makeRFF((seed * 17 + 11) >>> 0);
    const dim = kernel === 'linear' ? 2 : D;
    const PHI = pts.map((q) => phi(q, kernel, rff));
    const lr0 = 0.06;
    let w = new Array(dim).fill(0), b = 0;
    const hingeHist = [];
    const steps = [];
    const evalAll = () => {
      let h = 0, sv = 0;
      for (let i = 0; i < pts.length; i++) {
        const f = dot(w, PHI[i]) + b;
        const margin = pts[i].label * f;
        h += Math.max(0, 1 - margin);
        if (margin <= 1.02) sv += 1;
      }
      return { hinge: h / pts.length, sv };
    };
    const safe = (v) => (Number.isFinite(v) ? Math.min(1e6, Math.max(0, v)) : 0);
    const push = (note, t) => {
      const ev = evalAll();
      hingeHist.push(Math.min(ev.hinge, 20));
      let nrm = 0;
      for (const v of w) nrm += v * v;
      nrm = Math.sqrt(nrm);
      steps.push({
        model: { w: [...w], b, kernel, rff }, pts, C, kernel,
        hingeHist: hingeHist.slice(), t,
        note,
        metrics: {
          迭代: t, 惩罚系数C: C, hinge损失: safe(ev.hinge),
          支持向量: ev.sv, 间隔宽度: safe(2 / (nrm + 1e-6)),
        },
      });
    };
    push(`初始 w=0、b=0；核=${kernel === 'linear' ? '线性' : 'RBF 近似'}，C=${C.toFixed(1)}，开始次梯度下降。`, 0);
    for (let t = 1; t <= iters; t++) {
      const grad = new Array(dim).fill(0);
      let gb = 0;
      for (let i = 0; i < pts.length; i++) {
        const f = dot(w, PHI[i]) + b;
        if (pts[i].label * f < 1) {
          for (let j = 0; j < dim; j++) grad[j] -= (C / pts.length) * pts[i].label * PHI[i][j];
          gb -= (C / pts.length) * pts[i].label;
        }
      }
      const lr = lr0 / (1 + t * 0.01);
      for (let j = 0; j < dim; j++) {
        const nw = w[j] * (1 - lr) - lr * grad[j];
        w[j] = Number.isFinite(nw) ? clamp(nw, -50, 50) : 0;
      }
      b = clamp(b - lr * gb, -20, 20);
      const ev = evalAll();
      push(`第 ${t} 轮：更新 w、b，hinge 损失 ${ev.hinge.toFixed(3)}，落在间隔内的支持向量 ${ev.sv} 个。`, t);
    }
    if (steps.length > 400) {
      const stride = Math.ceil(steps.length / 400);
      return steps.filter((_, i) => i % stride === 0 || i === steps.length - 1);
    }
    return steps;
  },

  render(snap, p, c) {
    const pts = snap.pts || [];
    const hingeHist = snap.hingeHist || [];
    const model = snap.model || null;
    const kernel = snap.kernel || 'linear';
    const predict = (q) => {
      if (!model || !model.w) return 0;
      const f = phi(q, model.kernel, model.rff);
      let s = model.b || 0;
      for (let j = 0; j < f.length; j++) s += (model.w[j] || 0) * f[j];
      return Number.isFinite(s) ? s : 0;
    };
    const sx = (x) => PX0 + ((x + 1.6) / 3.2) * (PX1 - PX0);
    const sy = (y) => PY1 - ((y + 1.6) / 3.2) * (PY1 - PY0);
    const cw = (PX1 - PX0) / GX, ch = (PY1 - PY0) / GY;
    const cells = [];
    for (let gx = 0; gx < GX; gx++) {
      for (let gy = 0; gy < GY; gy++) {
        const xd = -1.6 + (3.2 * (gx + 0.5)) / GX;
        const yd = 1.6 - (3.2 * (gy + 0.5)) / GY;
        cells.push({ x: PX0 + gx * cw, y: PY0 + gy * ch, f: predict({ x: xd, y: yd }) });
      }
    }
    // 线性核：解析画超平面 w·x+b=0 与间隔边界 ±1
    let analytic = null;
    if (model && kernel === 'linear' && Math.abs(model.w[1] || 0) > 1e-6) {
      const w0 = model.w[0] || 0, w1 = model.w[1] || 0, bb = model.b || 0;
      const yAt = (x, k) => -(bb + w0 * x + k) / w1;
      analytic = (
        <g>
          <line x1={sx(-1.6)} y1={sy(clamp(yAt(-1.6, 1), -3, 3))} x2={sx(1.6)} y2={sy(clamp(yAt(1.6, 1), -3, 3))} stroke={c.muted} strokeWidth="1" strokeDasharray="4 3" />
          <line x1={sx(-1.6)} y1={sy(clamp(yAt(-1.6, -1), -3, 3))} x2={sx(1.6)} y2={sy(clamp(yAt(1.6, -1), -3, 3))} stroke={c.muted} strokeWidth="1" strokeDasharray="4 3" />
          <line x1={sx(-1.6)} y1={sy(clamp(yAt(-1.6, 0), -3, 3))} x2={sx(1.6)} y2={sy(clamp(yAt(1.6, 0), -3, 3))} stroke={c.text} strokeWidth="2" />
        </g>
      );
    }
    const maxH = Math.max(0.1, ...hingeHist, 1e-6);
    const hx = (i) => CX0 + (i / Math.max(1, hingeHist.length - 1)) * (CX1 - CX0);
    const hy = (v) => CY1 - (clamp(v, 0, maxH) / maxH) * (CY1 - CY0);
    const dHinge = hingeHist.map((v, i) => `${i === 0 ? 'M' : 'L'}${hx(i).toFixed(1)},${hy(v).toFixed(1)}`).join(' ');
    return (
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} preserveAspectRatio="xMidYMid meet">
        <defs><clipPath id="svm-clip"><rect x={PX0} y={PY0} width={PX1 - PX0} height={PY1 - PY0} /></clipPath></defs>
        <rect x={PX0} y={PY0} width={PX1 - PX0} height={PY1 - PY0} fill={c.panel} stroke={c.border} />
        <g clipPath="url(#svm-clip)">
          {cells.map((cell, i) => (
            <rect key={i} x={cell.x} y={cell.y} width={cw + 0.4} height={ch + 0.4}
              fill={Math.abs(cell.f) <= 1 ? c.accent : (cell.f > 1 ? c.series[1] : c.series[0])}
              opacity={Math.abs(cell.f) <= 1 ? 0.14 : 0.26} />
          ))}
          {analytic}
          {pts.map((q, i) => {
            const f = predict(q);
            const isSV = q.label * f <= 1.02;
            return (
              <g key={i}>
                {isSV && <circle cx={sx(q.x)} cy={sy(q.y)} r="5.5" fill="none" stroke={c.warning} strokeWidth="1.5" />}
                <circle cx={sx(q.x)} cy={sy(q.y)} r="2.9"
                  fill={q.label > 0 ? c.series[1] : c.series[0]} stroke={c.bg} strokeWidth="0.7" />
              </g>
            );
          })}
        </g>
        <text x={PX0} y={PY0 - 8} fontSize="11" fill={c.muted}>软间隔 SVM：决策区 + 间隔带 + 支持向量</text>
        <text x={PX0} y={PY1 + 16} fontSize="10" fill={c.muted}>核：{kernel === 'linear' ? '线性' : 'RBF 近似'}</text>
        <text x={PX1} y={PY1 + 16} fontSize="10" textAnchor="end" fill={c.muted}>黄圈=支持向量</text>
        <text x={CX0} y={CY0 - 14} fontSize="11" fill={c.muted}>hinge 损失收敛</text>
        <rect x={CX0} y={CY0} width={CX1 - CX0} height={CY1 - CY0} fill={c.panel} stroke={c.border} />
        <line x1={CX0} y1={CY1} x2={CX1} y2={CY1} stroke={c.grid} />
        <line x1={CX0} y1={CY0} x2={CX0} y2={CY1} stroke={c.grid} />
        <path d={dHinge} fill="none" stroke={c.danger} strokeWidth="2" />
        <text x={CX0} y={CY0 + 12} fontSize="9" fill={c.muted}>平均 hinge</text>
        <text x={CX1} y={CY0 + 12} fontSize="9" textAnchor="end" fill={c.muted}>C={(snap.C ?? 1).toFixed(1)}</text>
        <text x={(CX0 + CX1) / 2} y={CY1 + 16} fontSize="10" textAnchor="middle" fill={c.muted}>迭代轮数 →</text>
        <text x="20" y={H - 12} fontSize="11" fill={c.text}>{snap.note || '拖动进度条查看超平面演化'}</text>
      </svg>
    );
  },
};
