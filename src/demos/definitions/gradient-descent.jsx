import React from 'react';
import { clamp } from '../utils.js';

const W = 720, H = 320;
const PX0 = 44, PX1 = 408, PY0 = 34, PY1 = 268;
const CX0 = 452, CX1 = 694, CY0 = 62, CY1 = 210;
const A = 1.0, B = 12.0; // 病态二次损失 L(w)=0.5*(A*w1^2 + B*w2^2)

function loss(w1, w2) { return 0.5 * (A * w1 * w1 + B * w2 * w2); }

export default {
  id: 'gradient-descent',
  params: [
    { key: 'lr', label: '学习率', type: 'range', min: 0.01, max: 1.2, step: 0.01, default: 0.14, hint: '过大易越过谷底甚至发散' },
    { key: 'iters', label: '迭代次数', type: 'range', min: 20, max: 180, step: 1, default: 60 },
    { key: 'x0', label: '初始点 w₁', type: 'range', min: -4, max: 4, step: 0.1, default: 3.6 },
    { key: 'momentum', label: '启用动量', type: 'toggle', default: false, hint: 'β=0.9 累积历史梯度' },
  ],
  height: H,
  legend: [
    { label: '损失等高线' }, { label: '参数更新轨迹' },
    { label: '当前参数点' }, { label: '损失收敛曲线' },
  ],
  hint: '在扁长椭圆(病态条件数)的二次损失上做梯度下降，观察学习率与动量如何影响收敛或发散。',

  buildSteps(p) {
    const lr = clamp(Number(p.lr) || 0.14, 0.001, 3);
    const iters = clamp(Math.round(Number(p.iters) || 60), 1, 400);
    const x0 = clamp(Number(p.x0) || 0, -6, 6);
    const useM = !!p.momentum;
    const beta = 0.9;
    let w1 = x0, w2 = 3.2;
    let v1 = 0, v2 = 0;
    let diverged = false;
    const startLoss = loss(w1, w2);
    const cap = startLoss * 60 + 200;
    const path = [{ w1, w2 }];
    const hist = [startLoss];
    const steps = [];
    const safe = (v) => (Number.isFinite(v) ? v : 0);
    const push = (note, extra = {}) => steps.push({
      w1: safe(w1), w2: safe(w2), path: path.slice(), hist: hist.slice(),
      diverged, lr, note,
      metrics: { 学习率: lr, 迭代: steps.length, 损失: safe(Math.min(loss(w1, w2), cap)), 是否发散: diverged ? 1 : 0 },
      ...extra,
    });

    push(`初始参数 w=(${w1.toFixed(2)}, ${w2.toFixed(2)})，损失 ${startLoss.toFixed(2)}；椭圆越扁收敛越慢。`);
    for (let t = 1; t <= iters; t++) {
      const g1 = A * w1, g2 = B * w2;
      if (useM) {
        v1 = beta * v1 - lr * g1;
        v2 = beta * v2 - lr * g2;
        w1 += v1; w2 += v2;
      } else {
        w1 -= lr * g1; w2 -= lr * g2;
      }
      if (!Number.isFinite(w1) || !Number.isFinite(w2) || Math.abs(w1) > 1e4 || Math.abs(w2) > 1e4) {
        w1 = clamp(Number.isFinite(w1) ? w1 : (w1 > 0 ? 1e4 : -1e4), -1e4, 1e4);
        w2 = clamp(Number.isFinite(w2) ? w2 : (w2 > 0 ? 1e4 : -1e4), -1e4, 1e4);
        diverged = true;
      }
      const L = loss(w1, w2);
      if (L > cap) diverged = true;
      path.push({ w1, w2 });
      hist.push(Math.min(L, cap));
      const gm = Math.hypot(g1, g2);
      push(
        `第 ${t} 步：梯度=(${g1.toFixed(2)}, ${g2.toFixed(2)})，更新后 w=(${w1.toFixed(2)}, ${w2.toFixed(2)})，损失 ${Number.isFinite(L) ? L.toFixed(2) : '溢出'}${diverged ? '，已发散' : ''}。`,
        { grad: [safe(g1), safe(g2)], gradMag: safe(gm) }
      );
    }
    if (steps.length > 400) {
      const stride = Math.ceil(steps.length / 400);
      return steps.filter((_, i) => i % stride === 0 || i === steps.length - 1);
    }
    return steps;
  },

  render(snap, p, c) {
    const path = snap.path || [];
    const hist = snap.hist || [];
    const diverged = !!snap.diverged;
    const curW1 = snap.w1 ?? 0, curW2 = snap.w2 ?? 0;
    const R = 5;
    const cw = (v) => clamp(Number.isFinite(v) ? v : 0, -R, R);
    const sx = (w1) => PX0 + ((w1 + R) / (2 * R)) * (PX1 - PX0);
    const sy = (w2) => PY1 - ((w2 + R) / (2 * R)) * (PY1 - PY0);
    const centerX = sx(0), centerY = sy(0);
    const levels = [1, 4, 9, 16, 25, 40, 60];
    const ellipses = levels.map((L) => ({
      L,
      rx: (Math.sqrt(2 * L / A) / (2 * R)) * (PX1 - PX0),
      ry: (Math.sqrt(2 * L / B) / (2 * R)) * (PY1 - PY0),
    }));
    const dPath = path.map((q, i) => `${i === 0 ? 'M' : 'L'}${sx(cw(q.w1)).toFixed(1)},${sy(cw(q.w2)).toFixed(1)}`).join(' ');
    const maxH = Math.max(1e-6, ...hist);
    const hi = Math.max(maxH, 1e-6);
    const hx = (i) => CX0 + (i / Math.max(1, hist.length - 1)) * (CX1 - CX0);
    const hy = (v) => CY1 - (clamp(v, 0, hi) / hi) * (CY1 - CY0);
    const dHist = hist.map((v, i) => `${i === 0 ? 'M' : 'L'}${hx(i).toFixed(1)},${hy(v).toFixed(1)}`).join(' ');
    const lineColor = diverged ? c.danger : c.primary;
    return (
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} preserveAspectRatio="xMidYMid meet">
        <defs>
          <clipPath id="gd-clip"><rect x={PX0} y={PY0} width={PX1 - PX0} height={PY1 - PY0} /></clipPath>
        </defs>
        <rect x={PX0} y={PY0} width={PX1 - PX0} height={PY1 - PY0} fill={c.panel} stroke={c.border} />
        <g clipPath="url(#gd-clip)">
          <line x1={sx(-R)} y1={centerY} x2={sx(R)} y2={centerY} stroke={c.grid} strokeWidth="1" />
          <line x1={centerX} y1={sy(-R)} x2={centerX} y2={sy(R)} stroke={c.grid} strokeWidth="1" />
          {ellipses.map((e, i) => (
            <ellipse key={i} cx={centerX} cy={centerY} rx={e.rx} ry={e.ry}
              fill="none" stroke={i % 2 === 0 ? c.grid : c.border} strokeWidth="1" />
          ))}
          <circle cx={centerX} cy={centerY} r="3" fill={c.success} />
          {path.length > 1 && <path d={dPath} fill="none" stroke={lineColor} strokeWidth="2" strokeLinejoin="round" opacity={0.9} />}
          {path.map((q, i) => (
            <circle key={i} cx={sx(cw(q.w1))} cy={sy(cw(q.w2))} r="1.6" fill={lineColor} opacity={0.55} />
          ))}
          <circle cx={sx(cw(curW1))} cy={sy(cw(curW2))} r="5" fill={diverged ? c.danger : c.warning} stroke={c.bg} strokeWidth="1.5" />
        </g>
        <text x={PX0} y={PY0 - 8} fontSize="11" fill={c.muted}>参数平面：损失等高线 + 更新轨迹</text>
        <text x={PX0} y={PY1 + 16} fontSize="10" fill={c.muted}>w₁ →</text>
        <text x={PX1} y={PY1 + 16} fontSize="10" textAnchor="end" fill={c.muted}>w₂ ↑　最小点 (0,0)</text>
        <text x={CX0} y={CY0 - 14} fontSize="11" fill={c.muted}>损失随迭代</text>
        <rect x={CX0} y={CY0} width={CX1 - CX0} height={CY1 - CY0} fill={c.panel} stroke={c.border} />
        <line x1={CX0} y1={CY1} x2={CX1} y2={CY1} stroke={c.grid} />
        <line x1={CX0} y1={CY0} x2={CX0} y2={CY1} stroke={c.grid} />
        {hist.length > 1 && <path d={dHist} fill="none" stroke={lineColor} strokeWidth="2" />}
        <text x={(CX0 + CX1) / 2} y={CY1 + 16} fontSize="10" textAnchor="middle" fill={c.muted}>迭代步数 →</text>
        <text x={CX0} y={CY1 + 30} fontSize="10" fill={c.muted}>峰值 {Number.isFinite(maxH) ? maxH.toFixed(1) : '—'}</text>
        <text x={CX1} y={CY1 + 30} fontSize="10" textAnchor="end" fill={diverged ? c.danger : c.success}>
          {diverged ? '参数发散，损失爆炸' : '损失下降，逼近极小值'}
        </text>
        <text x="20" y={H - 12} fontSize="11" fill={c.text}>{snap.note || '拖动进度条查看每一步参数更新'}</text>
      </svg>
    );
  },
};
