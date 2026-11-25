import React from 'react';
import { mulberry32, clamp } from '../utils.js';

const W = 720, H = 320;
const PX0 = 46, PX1 = 276, PY0 = 34, PY1 = 264;
const CX0 = 320, CX1 = 694;
const A_Y0 = 50, A_Y1 = 150;
const B_Y0 = 172, B_Y1 = 262;

export default {
  id: 'monte-carlo-pi',
  params: [
    { key: 'n', label: '采样点数', type: 'range', min: 50, max: 5000, step: 50, default: 1200 },
    { key: 'seed', label: '随机种子', type: 'range', min: 1, max: 40, step: 1, default: 7 },
    { key: 'stratified', label: '分层采样', type: 'toggle', default: false, hint: '把单位方格分块，每格投一点，降低方差' },
  ],
  height: H,
  legend: [
    { label: '四分之一圆内点' }, { label: '圆外点' },
    { label: 'π 估计收敛' }, { label: '真实 π(参考线)' }, { label: '误差收敛' },
  ],
  hint: '在单位正方形随机投点，π̂=4×(落在四分之一圆内的比例)；分层采样可显著降低估计方差。',

  buildSteps(p) {
    const N = clamp(Math.round(Number(p.n) || 1200), 10, 6000);
    const seed = (Number(p.seed) || 7) >>> 0;
    const stratified = !!p.stratified;
    const rnd = mulberry32(seed);
    const grid = Math.ceil(Math.sqrt(N));
    const pts = [];
    const cum = [0];
    for (let i = 0; i < N; i++) {
      let u, v;
      if (stratified) {
        const gx = i % grid, gy = Math.floor(i / grid);
        u = (gx + rnd()) / grid;
        v = (gy + rnd()) / grid;
      } else {
        u = rnd(); v = rnd();
      }
      u = clamp(u, 0, 1); v = clamp(v, 0, 1);
      const inside = u * u + v * v <= 1 ? 1 : 0;
      pts.push({ u, v, inside });
      cum.push(cum[i] + inside);
    }
    const STEPS = clamp(Math.round(N / 10), 24, 180);
    const piHist = [], errHist = [], frames = [];
    for (let s = 1; s <= STEPS; s++) {
      const count = Math.max(1, Math.floor((N * s) / STEPS));
      const ins = cum[count];
      const piEst = (4 * ins) / count;
      const err = Math.abs(piEst - Math.PI);
      piHist.push(piEst); errHist.push(err);
      const note = `已投 ${count} 点，圆内 ${ins} 个：π̂ = 4×${ins}/${count} = ${piEst.toFixed(4)}，绝对误差 ${err.toFixed(4)}${stratified ? '（分层采样）' : ''}。`;
      frames.push({
        count, ins, piEst, err, pts, N, STEPS, sIndex: s, stratified,
        piHist: piHist.slice(), errHist: errHist.slice(),
        note,
        metrics: {
          采样点: count, 圆内点: ins,
          π估计: Number(piEst.toFixed(4)), 绝对误差: Number(err.toFixed(4)),
        },
      });
    }
    return frames;
  },

  render(snap, p, c) {
    const pts = snap.pts || [];
    const count = snap.count ?? 0;
    const piHist = snap.piHist || [], errHist = snap.errHist || [];
    const STEPS = snap.STEPS ?? 24;
    const piEst = snap.piEst ?? 0;
    const err = snap.err ?? 0;
    const R = PX1 - PX0;
    const sx = (u) => PX0 + u * R;
    const sy = (v) => PY1 - v * (PY1 - PY0);
    const arc = Array.from({ length: 41 }, (_, i) => {
      const a = (Math.PI / 2) * (i / 40);
      return { x: Math.cos(a), y: Math.sin(a) };
    });
    const dArc = arc.map((q, i) => `${i === 0 ? 'M' : 'L'}${sx(q.x).toFixed(1)},${sy(q.y).toFixed(1)}`).join(' ');
    let dIn = '', dOut = '';
    const stride = count > 1800 ? Math.ceil(count / 1800) : 1;
    for (let i = 0; i < Math.min(count, pts.length); i += stride) {
      const q = pts[i];
      const seg = `M${sx(q.u).toFixed(1)} ${sy(q.v).toFixed(1)}h1.8v1.8h-1.8z`;
      if (q.inside) dIn += seg; else dOut += seg;
    }
    const px = (i) => CX0 + (i / Math.max(1, STEPS - 1)) * (CX1 - CX0);
    const py = (v) => A_Y1 - ((clamp(v, 2.6, 3.7) - 2.6) / 1.1) * (A_Y1 - A_Y0);
    const maxE = Math.max(1e-4, ...errHist);
    const by = (v) => B_Y1 - (clamp(v, 0, maxE) / maxE) * (B_Y1 - B_Y0);
    const dPi = piHist.map((v, i) => `${i === 0 ? 'M' : 'L'}${px(i).toFixed(1)},${py(v).toFixed(1)}`).join(' ');
    const dErr = errHist.map((v, i) => `${i === 0 ? 'M' : 'L'}${px(i).toFixed(1)},${by(v).toFixed(1)}`).join(' ');
    return (
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} preserveAspectRatio="xMidYMid meet">
        <defs><clipPath id="mc-clip"><rect x={PX0} y={PY0} width={R} height={PY1 - PY0} /></clipPath></defs>
        <rect x={PX0} y={PY0} width={R} height={PY1 - PY0} fill={c.panel} stroke={c.border} />
        <g clipPath="url(#mc-clip)">
          <path d={dArc} fill="none" stroke={c.text} strokeWidth="1.6" />
          <path d={dIn} fill={c.series[0]} opacity={0.85} />
          <path d={dOut} fill={c.series[1]} opacity={0.8} />
        </g>
        <line x1={PX0} y1={PY1} x2={PX1} y2={PY1} stroke={c.grid} />
        <line x1={PX0} y1={PY0} x2={PX0} y2={PY1} stroke={c.grid} />
        <text x={PX0} y={PY0 - 8} fontSize="11" fill={c.muted}>四分之一圆与随机投点</text>
        <text x={PX0} y={PY1 + 16} fontSize="10" fill={c.muted}>蓝=圆内　红=圆外</text>
        <text x={PX1} y={PY1 + 16} fontSize="10" textAnchor="end" fill={c.muted}>u²+v²≤1</text>
        <text x={CX0} y={A_Y0 - 14} fontSize="11" fill={c.muted}>π 估计值收敛（参考 π={Math.PI.toFixed(4)}）</text>
        <rect x={CX0} y={A_Y0} width={CX1 - CX0} height={A_Y1 - A_Y0} fill={c.panel} stroke={c.border} />
        <line x1={CX0} y1={py(Math.PI)} x2={CX1} y2={py(Math.PI)} stroke={c.purple} strokeDasharray="4 3" strokeWidth="1" />
        <path d={dPi} fill="none" stroke={c.primary} strokeWidth="2" />
        <text x={CX1} y={A_Y0 + 12} fontSize="9" textAnchor="end" fill={c.muted}>π̂={piEst.toFixed(4)}</text>
        <text x={CX0} y={B_Y0 - 6} fontSize="11" fill={c.muted}>绝对误差收敛</text>
        <rect x={CX0} y={B_Y0} width={CX1 - CX0} height={B_Y1 - B_Y0} fill={c.panel} stroke={c.border} />
        <path d={dErr} fill="none" stroke={c.danger} strokeWidth="2" />
        <text x={CX1} y={B_Y0 + 12} fontSize="9" textAnchor="end" fill={c.muted}>误差={err.toFixed(4)}</text>
        <text x={(CX0 + CX1) / 2} y={B_Y1 + 16} fontSize="10" textAnchor="middle" fill={c.muted}>采样点数 →</text>
        <text x="20" y={H - 12} fontSize="11" fill={c.text}>{snap.note || '拖动进度条查看 π 估计收敛'}</text>
      </svg>
    );
  },
};
