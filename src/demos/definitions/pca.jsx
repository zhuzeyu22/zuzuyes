import React from 'react';
import { mulberry32, clamp } from '../utils.js';

const W = 720, H = 320;
const PX0 = 46, PX1 = 410, PY0 = 34, PY1 = 262;
const CX0 = 452, CX1 = 694, CY0 = 50, CY1 = 200;
const STEPS = 72;

function gauss(rnd) {
  const u = Math.max(1e-9, rnd()), v = rnd();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}
function arrow(x0, y0, x1, y1, color, width) {
  const ang = Math.atan2(y1 - y0, x1 - x0);
  const a1 = ang + 2.6, a2 = ang - 2.6, len = 7;
  const p1x = x1 + len * Math.cos(a1), p1y = y1 + len * Math.sin(a1);
  const p2x = x1 + len * Math.cos(a2), p2y = y1 + len * Math.sin(a2);
  return (
    <g>
      <line x1={x0} y1={y0} x2={x1} y2={y1} stroke={color} strokeWidth={width} />
      <polygon points={`${x1},${y1} ${p1x},${p1y} ${p2x},${p2y}`} fill={color} />
    </g>
  );
}

export default {
  id: 'pca',
  params: [
    { key: 'angle', label: '数据旋转角(°)', type: 'range', min: 0, max: 180, step: 5, default: 35 },
    { key: 'ratio', label: '主轴/次轴方差比', type: 'range', min: 1, max: 12, step: 0.5, default: 5 },
    { key: 'n', label: '样本数', type: 'range', min: 20, max: 220, step: 1, default: 90 },
    { key: 'keep', label: '保留成分数', type: 'select', default: '1', options: [
      { value: '1', label: '仅第一主成分(1D)' },
      { value: '2', label: '保留两个成分(2D)' },
    ] },
    { key: 'seed', label: '随机种子', type: 'range', min: 1, max: 40, step: 1, default: 4 },
  ],
  height: H,
  legend: [
    { label: '样本点云' }, { label: '当前扫描方向 / 第一主成分' },
    { label: '投影重构点' }, { label: '第二主成分' }, { label: '重构误差曲线' },
  ],
  hint: '逐角度扫描一维投影方向，真实计算投影-重构误差，误差最小处即第一主成分；协方差特征向量给出主轴。',

  buildSteps(p) {
    const n = clamp(Math.round(Number(p.n) || 90), 20, 220);
    const angle = clamp(Number(p.angle) || 0, 0, 180);
    const ratio = clamp(Number(p.ratio) || 5, 1, 15);
    const keep = String(p.keep) === '2' ? 2 : 1;
    const seed = (Number(p.seed) || 4) >>> 0;
    const rnd = mulberry32(seed);
    const s1 = Math.sqrt(ratio) * 0.55, s2 = 0.55;
    const a = (angle * Math.PI) / 180, ca = Math.cos(a), sa = Math.sin(a);
    const raw = [];
    for (let i = 0; i < n; i++) {
      const u = gauss(rnd) * s1, v = gauss(rnd) * s2;
      raw.push({ x: clamp(u * ca - v * sa, -2, 2), y: clamp(u * sa + v * ca, -2, 2) });
    }
    let mx = 0, my = 0;
    for (const q of raw) { mx += q.x; my += q.y; }
    mx /= n; my /= n;
    const pts = raw.map((q) => ({ x: q.x - mx, y: q.y - my }));
    let cxx = 0, cxy = 0, cyy = 0;
    for (const q of pts) { cxx += q.x * q.x; cxy += q.x * q.y; cyy += q.y * q.y; }
    cxx /= n; cxy /= n; cyy /= n;
    const tr = cxx + cyy, det = cxx * cyy - cxy * cxy;
    const disc = Math.sqrt(Math.max(0, (tr * tr) / 4 - det));
    const l1 = Math.max(0, tr / 2 + disc), l2 = Math.max(0, tr / 2 - disc);
    let e1x = cxy, e1y = l1 - cxx;
    if (Math.hypot(e1x, e1y) < 1e-9) { e1x = l1 - cyy; e1y = cxy; }
    if (Math.hypot(e1x, e1y) < 1e-9) { e1x = 1; e1y = 0; }
    const en = Math.hypot(e1x, e1y) || 1;
    e1x /= en; e1y /= en;
    const e1 = [e1x, e1y], e2 = [-e1y, e1x];
    const thetaOpt = Math.atan2(e1y, e1x);
    const errAt = (theta) => {
      const ux = -Math.sin(theta), uy = Math.cos(theta);
      let s = 0;
      for (const q of pts) { const d = q.x * ux + q.y * uy; s += d * d; }
      return s;
    };
    const errCurve = Array.from({ length: STEPS + 1 }, (_, i) => errAt((Math.PI * i) / STEPS));
    const minErr = Math.min(...errCurve), maxErr = Math.max(...errCurve);
    const lamSum = l1 + l2 + 1e-9;
    const safe = (v) => (Number.isFinite(v) ? v : 0);
    const frames = [];
    for (let s = 0; s <= STEPS; s++) {
      const theta = (Math.PI * s) / STEPS;
      const err = errAt(theta);
      const final = s === STEPS;
      const proj = pts.map((q) => {
        const t = q.x * Math.cos(theta) + q.y * Math.sin(theta);
        return { x: t * Math.cos(theta), y: t * Math.sin(theta), ox: q.x, oy: q.y };
      });
      const finalErr = keep === 2 ? 0 : minErr;
      const deg = Number(((theta * 180) / Math.PI).toFixed(1));
      const note = final
        ? `确定第一主成分方向 ${Number(((thetaOpt * 180) / Math.PI).toFixed(1))}°，解释方差 ${((l1 / lamSum) * 100).toFixed(1)}%；保留 ${keep} 个成分，最终重构误差 ${finalErr.toFixed(2)}。`
        : `扫描方向 θ=${deg}°：一维投影重构误差 ${err.toFixed(2)}（最小可达 ${minErr.toFixed(2)}）。`;
      frames.push({
        pts, proj, theta, thetaOpt, e1, e2, l1, l2, keep, lamSum,
        errCurve, minErr, maxErr, sIndex: s, final,
        note,
        metrics: {
          扫描角: deg, 重构误差: safe(final && keep === 2 ? 0 : err),
          解释方差比: safe(l1 / lamSum), 保留成分: keep,
        },
      });
    }
    return frames;
  },

  render(snap, p, c) {
    const pts = snap.pts || [];
    const proj = snap.proj || [];
    const e1 = snap.e1 || [1, 0], e2 = snap.e2 || [0, 1];
    const errCurve = snap.errCurve || [];
    const sIndex = snap.sIndex ?? 0;
    const final = !!snap.final;
    const keep = snap.keep ?? 1;
    const theta = snap.theta ?? 0;
    const l1 = snap.l1 ?? 0, l2 = snap.l2 ?? 0;
    const minErr = snap.minErr ?? 0, maxErr = snap.maxErr ?? 1;
    const cx = (PX0 + PX1) / 2, cy = (PY0 + PY1) / 2;
    const sx = (x) => PX0 + ((x + 2) / 4) * (PX1 - PX0);
    const sy = (y) => PY1 - ((y + 2) / 4) * (PY1 - PY0);
    const sc = (PX1 - PX0) / 4;
    const L1 = clamp(Math.sqrt(l1) * sc * 1.6, 12, 150);
    const L2 = clamp(Math.sqrt(l2) * sc * 1.6, 8, 150);
    const ux = Math.cos(theta), uy = Math.sin(theta);
    const ex = (i) => CX0 + (i / STEPS) * (CX1 - CX0);
    const ey = (v) => CY1 - ((clamp(v, 0, maxErr + 1e-6)) / (maxErr + 1e-6)) * (CY1 - CY0);
    const dErr = errCurve.map((v, i) => `${i === 0 ? 'M' : 'L'}${ex(i).toFixed(1)},${ey(v).toFixed(1)}`).join(' ');
    return (
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} preserveAspectRatio="xMidYMid meet">
        <defs><clipPath id="pca-clip"><rect x={PX0} y={PY0} width={PX1 - PX0} height={PY1 - PY0} /></clipPath></defs>
        <rect x={PX0} y={PY0} width={PX1 - PX0} height={PY1 - PY0} fill={c.panel} stroke={c.border} />
        <g clipPath="url(#pca-clip)">
          <line x1={PX0} y1={cy} x2={PX1} y2={cy} stroke={c.grid} />
          <line x1={cx} y1={PY0} x2={cx} y2={PY1} stroke={c.grid} />
          {arrow(cx, cy, cx + e1[0] * L1, cy - e1[1] * L1, c.primary, final ? 2.4 : 1.2)}
          {final && keep === 2 && arrow(cx, cy, cx + e2[0] * L2, cy - e2[1] * L2, c.teal, 2)}
          {!final && arrow(cx, cy, cx + ux * 110, cy - uy * 110, c.warning, 1.8)}
          {proj.map((q, i) => (
            <g key={i}>
              <line x1={sx(q.ox)} y1={sy(q.oy)} x2={sx(q.x)} y2={sy(q.y)} stroke={c.grid} strokeWidth="0.7" opacity={0.6} />
              <circle cx={sx(q.x)} cy={sy(q.y)} r="1.6" fill={c.primary} opacity={0.8} />
            </g>
          ))}
          {pts.map((q, i) => (
            <circle key={`o${i}`} cx={sx(q.x)} cy={sy(q.y)} r="2" fill={c.muted} opacity={0.55} />
          ))}
        </g>
        <text x={PX0} y={PY0 - 8} fontSize="11" fill={c.muted}>散点云 + 协方差主轴 + 投影重构</text>
        <text x={PX0} y={PY1 + 16} fontSize="10" fill={c.muted}>λ₁={l1.toFixed(2)}　λ₂={l2.toFixed(2)}</text>
        <text x={PX1} y={PY1 + 16} fontSize="10" textAnchor="end" fill={c.muted}>
          {final ? '蓝=第一主成分　青=第二主成分' : '黄箭头=当前扫描方向'}
        </text>
        <text x={CX0} y={CY0 - 14} fontSize="11" fill={c.muted}>一维投影重构误差</text>
        <rect x={CX0} y={CY0} width={CX1 - CX0} height={CY1 - CY0} fill={c.panel} stroke={c.border} />
        <line x1={CX0} y1={CY1} x2={CX1} y2={CY1} stroke={c.grid} />
        <line x1={CX0} y1={ey(minErr)} x2={CX1} y2={ey(minErr)} stroke={c.success} strokeDasharray="4 3" strokeWidth="1" />
        <line x1={ex(sIndex)} y1={CY0} x2={ex(sIndex)} y2={CY1} stroke={c.warning} strokeWidth="1.4" />
        <path d={dErr} fill="none" stroke={c.danger} strokeWidth="2" />
        <text x={CX0} y={CY0 + 12} fontSize="9" fill={c.muted}>误差</text>
        <text x={CX1} y={CY0 + 12} fontSize="9" textAnchor="end" fill={c.muted}>绿虚线=最小值 λ₂·n</text>
        <text x={(CX0 + CX1) / 2} y={CY1 + 16} fontSize="10" textAnchor="middle" fill={c.muted}>扫描角 0° → 180°</text>
        <text x="20" y={H - 12} fontSize="11" fill={c.text}>{snap.note || '拖动进度条查看主成分搜索'}</text>
      </svg>
    );
  },
};
