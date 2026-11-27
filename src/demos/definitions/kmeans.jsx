import React from 'react';
import { mulberry32, clamp } from '../utils.js';
import { datasetParam, scatterPoints, dataLabel } from '../datasets/adapter.js';

const W = 720, H = 320;
const PX0 = 46, PX1 = 410, PY0 = 34, PY1 = 264;
const CX0 = 452, CX1 = 694, CY0 = 54, CY1 = 204;
const S = 6; // 每轮分配阶段拆成 6 个子帧

function gauss(rnd) {
  const u = Math.max(1e-9, rnd()), v = rnd();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}
function genData(n, trueK, seed) {
  const rnd = mulberry32(seed >>> 0);
  const centers = Array.from({ length: trueK }, () => [(rnd() - 0.5) * 1.8, (rnd() - 0.5) * 1.8]);
  const pts = [];
  for (let i = 0; i < n; i++) {
    const t = centers[i % trueK];
    pts.push({
      x: clamp(t[0] + gauss(rnd) * 0.22, -1.5, 1.5),
      y: clamp(t[1] + gauss(rnd) * 0.22, -1.5, 1.5),
    });
  }
  return pts;
}
function nearest(centroids, q) {
  let best = 0, bd = Infinity;
  for (let j = 0; j < centroids.length; j++) {
    const d = (centroids[j][0] - q.x) ** 2 + (centroids[j][1] - q.y) ** 2;
    if (d < bd) { bd = d; best = j; }
  }
  return best;
}
function initCentroids(pts, k, init, rnd) {
  const out = [];
  if (init === 'farthest') {
    let first = Math.floor(rnd() * pts.length);
    out.push([pts[first].x, pts[first].y]);
    while (out.length < k) {
      let bi = 0, bd = -1;
      for (let i = 0; i < pts.length; i++) {
        let md = Infinity;
        for (const ce of out) md = Math.min(md, (ce[0] - pts[i].x) ** 2 + (ce[1] - pts[i].y) ** 2);
        if (md > bd) { bd = md; bi = i; }
      }
      out.push([pts[bi].x, pts[bi].y]);
    }
  } else {
    const used = new Set();
    while (out.length < k) {
      const i = Math.floor(rnd() * pts.length);
      if (!used.has(i)) { used.add(i); out.push([pts[i].x, pts[i].y]); }
      if (used.size >= pts.length) break;
    }
    while (out.length < k) out.push([0, 0]);
  }
  return out;
}

export default {
  id: 'kmeans',
  params: [
    datasetParam('iris', ['iris', 'wine']),
    { key: 'k', label: '簇数 k', type: 'range', min: 2, max: 6, step: 1, default: 3 },
    { key: 'n', label: '样本数', type: 'range', min: 20, max: 180, step: 1, default: 90 },
    { key: 'trueK', label: '真实簇数', type: 'range', min: 2, max: 6, step: 1, default: 3 },
    { key: 'seed', label: '随机种子', type: 'range', min: 1, max: 40, step: 1, default: 21 },
    { key: 'iters', label: '迭代轮数', type: 'range', min: 3, max: 14, step: 1, default: 6 },
    { key: 'init', label: '初始化方式', type: 'select', default: 'random', options: [
      { value: 'random', label: '随机取点' },
      { value: 'farthest', label: '最远点(k-means++)' },
    ] },
  ],
  height: H,
  legend: [
    { label: '各簇样本' }, { label: '质心(十字)' }, { label: '质心移动' },
    { label: '目标函数收敛' },
  ],
  hint: '交替执行「按最近质心分配」与「按簇均值更新质心」，逐步最小化簇内平方和(inertia)。',

  buildSteps(p) {
    const k = clamp(Math.round(Number(p.k) || 3), 2, 6);
    const n = clamp(Math.round(Number(p.n) || 90), 20, 180);
    const trueK = clamp(Math.round(Number(p.trueK) || 3), 2, 6);
    const iters = clamp(Math.round(Number(p.iters) || 6), 3, 14);
    const init = p.init || 'random';
    const seed = (Number(p.seed) || 21) >>> 0;
    const rnd = mulberry32(seed);
    const pts = scatterPoints(p, 'iris', () => genData(n, trueK, (seed * 13 + 5) >>> 0), 2, 3);
    const source = dataLabel(p, 'iris');
    let centroids = initCentroids(pts, k, init, rnd);
    const assign = new Array(n).fill(-1);
    const inertia = () => {
      let s = 0;
      for (let i = 0; i < n; i++) {
        if (assign[i] < 0) continue;
        const ce = centroids[assign[i]];
        s += (ce[0] - pts[i].x) ** 2 + (ce[1] - pts[i].y) ** 2;
      }
      return s;
    };
    for (let i = 0; i < n; i++) assign[i] = nearest(centroids, pts[i]);
    const hist = [inertia()];
    const steps = [];
    const safe = (v) => (Number.isFinite(v) ? v : 0);
    const push = (note, phase, round, batch, moved) => steps.push({
      centroids: centroids.map((ce) => [...ce]), assign: [...assign], pts,
      hist: hist.slice(), phase, round, batch, moved: moved || [],
      note: `${note} 数据来源：${source}。`,
      metrics: { 轮次: round, 簇数k: k, 目标函数: safe(inertia()), 已分配: assign.filter((a) => a >= 0).length },
    });
    push(`用「${init === 'farthest' ? '最远点' : '随机'}」初始化 ${k} 个质心，并完成首次分配，inertia=${hist[0].toFixed(1)}。`, '初始', 0, 0, []);
    for (let r = 1; r <= iters; r++) {
      const batch = Math.ceil(n / S);
      for (let b = 0; b < S; b++) {
        for (let i = b * batch; i < Math.min(n, (b + 1) * batch); i++) assign[i] = nearest(centroids, pts[i]);
        hist.push(inertia());
        push(`第 ${r} 轮·分配(${b + 1}/${S})：把一批样本归到最近质心，当前 inertia=${hist[hist.length - 1].toFixed(1)}。`, '分配', r, b + 1, []);
      }
      const old = centroids.map((ce) => [...ce]);
      const next = old.map((ce) => [ce[0], ce[1]]);
      const cnt = new Array(k).fill(0);
      const sum = Array.from({ length: k }, () => [0, 0]);
      for (let i = 0; i < n; i++) {
        if (assign[i] < 0) continue;
        const j = assign[i];
        cnt[j] += 1; sum[j][0] += pts[i].x; sum[j][1] += pts[i].y;
      }
      for (let j = 0; j < k; j++) {
        if (cnt[j] > 0) { next[j][0] = sum[j][0] / cnt[j]; next[j][1] = sum[j][1] / cnt[j]; }
      }
      centroids = next;
      hist.push(inertia());
      push(`第 ${r} 轮·更新：质心移到各簇均值${cnt.some((v) => v === 0) ? '（有空簇，保持原位）' : ''}，inertia=${hist[hist.length - 1].toFixed(1)}。`, '更新', r, 0, old);
    }
    push(`迭代结束，共 ${iters} 轮，最终 inertia=${hist[hist.length - 1].toFixed(1)}，质心趋于稳定。`, '完成', iters, 0, []);
    return steps;
  },

  render(snap, p, c) {
    const pts = snap.pts || [];
    const centroids = snap.centroids || [];
    const assign = snap.assign || [];
    const hist = snap.hist || [];
    const moved = snap.moved || [];
    const phase = snap.phase || '';
    const round = snap.round ?? 0;
    const sx = (x) => PX0 + ((x + 1.5) / 3) * (PX1 - PX0);
    const sy = (y) => PY1 - ((y + 1.5) / 3) * (PY1 - PY0);
    const maxH = Math.max(1e-6, ...hist);
    const hx = (i) => CX0 + (i / Math.max(1, hist.length - 1)) * (CX1 - CX0);
    const hy = (v) => CY1 - (clamp(v, 0, maxH) / maxH) * (CY1 - CY0);
    const dHist = hist.map((v, i) => `${i === 0 ? 'M' : 'L'}${hx(i).toFixed(1)},${hy(v).toFixed(1)}`).join(' ');
    return (
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} preserveAspectRatio="xMidYMid meet">
        <defs><clipPath id="km-clip"><rect x={PX0} y={PY0} width={PX1 - PX0} height={PY1 - PY0} /></clipPath></defs>
        <rect x={PX0} y={PY0} width={PX1 - PX0} height={PY1 - PY0} fill={c.panel} stroke={c.border} />
        <g clipPath="url(#km-clip)">
          {pts.map((q, i) => (
            <circle key={i} cx={sx(q.x)} cy={sy(q.y)} r="2.6"
              fill={assign[i] >= 0 ? c.series[assign[i] % c.series.length] : c.muted} opacity={0.82} />
          ))}
          {moved.map((m, j) => (
            <line key={`m${j}`} x1={sx(m[0])} y1={sy(m[1])}
              x2={sx(centroids[j] ? centroids[j][0] : m[0])} y2={sy(centroids[j] ? centroids[j][1] : m[1])}
              stroke={c.warning} strokeWidth="1.6" strokeDasharray="4 2" />
          ))}
          {centroids.map((ce, j) => (
            <g key={`c${j}`}>
              <line x1={sx(ce[0]) - 7} y1={sy(ce[1])} x2={sx(ce[0]) + 7} y2={sy(ce[1])} stroke={c.text} strokeWidth="1.8" />
              <line x1={sx(ce[0])} y1={sy(ce[1]) - 7} x2={sx(ce[0])} y2={sy(ce[1]) + 7} stroke={c.text} strokeWidth="1.8" />
              <circle cx={sx(ce[0])} cy={sy(ce[1])} r="3" fill={c.series[j % c.series.length]} stroke={c.bg} strokeWidth="1" />
              <text x={sx(ce[0]) + 9} y={sy(ce[1]) - 6} fontSize="9" fill={c.muted}>μ{j + 1}</text>
            </g>
          ))}
        </g>
        <text x={PX0} y={PY0 - 8} fontSize="11" fill={c.muted}>K-Means：散点按簇着色 + 质心</text>
        <text x={PX0} y={PY1 + 16} fontSize="10" fill={c.muted}>阶段：{phase || '初始化'}{round > 0 ? ` · 第 ${round} 轮` : ''}</text>
        <text x={PX1} y={PY1 + 16} fontSize="10" textAnchor="end" fill={c.muted}>黄虚线=质心移动</text>
        <text x={CX0} y={CY0 - 14} fontSize="11" fill={c.muted}>目标函数 inertia</text>
        <rect x={CX0} y={CY0} width={CX1 - CX0} height={CY1 - CY0} fill={c.panel} stroke={c.border} />
        <line x1={CX0} y1={CY1} x2={CX1} y2={CY1} stroke={c.grid} />
        <line x1={CX0} y1={CY0} x2={CX0} y2={CY1} stroke={c.grid} />
        {hist.length > 1 && <path d={dHist} fill="none" stroke={c.primary} strokeWidth="2" />}
        <text x={CX0} y={CY0 + 12} fontSize="9" fill={c.muted}>簇内平方和</text>
        <text x={(CX0 + CX1) / 2} y={CY1 + 16} fontSize="10" textAnchor="middle" fill={c.muted}>分配/更新步数 →</text>
        <text x="20" y={H - 12} fontSize="11" fill={c.text}>{snap.note || '拖动进度条查看质心迭代'}</text>
      </svg>
    );
  },
};
