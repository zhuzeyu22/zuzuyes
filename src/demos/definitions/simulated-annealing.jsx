import React from 'react';
import { mulberry32, clamp } from '../utils.js';

const W = 720, H = 320;
const PX0 = 46, PX1 = 410, PY0 = 34, PY1 = 262;
const CX0 = 452, CX1 = 694;
const TY0 = 50, TY1 = 118, BY0 = 140, BY1 = 208;
const LO = -1, HI = 4;
const MAX_FRAMES = 240;

function obj(x) {
  return Math.sin(3.2 * x) * 0.7 + Math.cos(7.3 * x) * 0.25
    + 0.9 * Math.exp(-2 * (x - 2.2) ** 2) - 0.06 * (x - 1) ** 2;
}

export default {
  id: 'simulated-annealing',
  params: [
    { key: 'T0', label: '初始温度', type: 'range', min: 1, max: 50, step: 1, default: 20 },
    { key: 'cool', label: '降温系数', type: 'range', min: 0.8, max: 0.99, step: 0.01, default: 0.92 },
    { key: 'itersPerT', label: '每温迭代数', type: 'range', min: 5, max: 40, step: 1, default: 12 },
    { key: 'seed', label: '随机种子', type: 'range', min: 1, max: 40, step: 1, default: 11 },
    { key: 'greedy', label: '退化为爬山(只接受更优)', type: 'toggle', default: false },
  ],
  height: H,
  legend: [
    { label: '目标函数曲线' }, { label: '当前解' }, { label: '候选解' },
    { label: '历史最优' }, { label: '温度 / 最优值曲线' },
  ],
  hint: '高温时以概率 exp(Δf/T) 接受劣解以跳出局部最优，随温度下降逐渐收敛到全局最大值附近。',

  buildSteps(p) {
    const T0 = clamp(Number(p.T0) || 20, 0.1, 100);
    const cool = clamp(Number(p.cool) || 0.92, 0.5, 0.999);
    const itersPerT = clamp(Math.round(Number(p.itersPerT) || 12), 1, 60);
    const greedy = !!p.greedy;
    const seed = (Number(p.seed) || 11) >>> 0;
    const rnd = mulberry32(seed);
    const curvePts = Array.from({ length: 241 }, (_, i) => {
      const x = LO + ((HI - LO) * i) / 240;
      return { x, y: obj(x) };
    });
    let gmaxX = curvePts[0].x, gmaxY = curvePts[0].y;
    let yLo = curvePts[0].y, yHi = curvePts[0].y;
    for (const q of curvePts) {
      if (q.y > gmaxY) { gmaxY = q.y; gmaxX = q.x; }
      if (q.y < yLo) yLo = q.y;
      if (q.y > yHi) yHi = q.y;
    }
    yLo -= 0.25; yHi += 0.25;
    let x = LO + (HI - LO) * rnd();
    let T = T0;
    let best = x, bestV = obj(x);
    const tempHist = [], bestHist = [], frames = [];
    const safe = (v) => (Number.isFinite(v) ? v : 0);
    const push = (note, extra = {}) => frames.push({
      x, best, T, T0, greedy, curvePts, gmaxX, gmaxY, yLo, yHi,
      tempHist: tempHist.slice(), bestHist: bestHist.slice(),
      candidate: extra.candidate ?? x, candV: extra.candV ?? obj(x),
      accepted: extra.accepted ?? false, prob: extra.prob ?? 1,
      note,
      metrics: {
        温度: safe(T), 当前目标值: safe(obj(x)), 历史最优: safe(bestV),
        接受概率: safe(extra.prob ?? 1), 是否接受: extra.accepted ? 1 : 0,
      },
    });
    push(`初始温度 T=${T0.toFixed(1)}，随机起点 x=${x.toFixed(2)}；${greedy ? '爬山模式：拒绝一切劣解' : '允许以概率接受劣解'}。`);
    const maxStages = Math.ceil(MAX_FRAMES / itersPerT) + 1;
    for (let stage = 0; stage < maxStages && T > 0.002; stage++) {
      for (let it = 0; it < itersPerT; it++) {
        if (frames.length >= MAX_FRAMES) break;
        const step = 0.4 + T * 0.04;
        const candidate = clamp(x + (rnd() - 0.5) * 2 * step, LO, HI);
        const delta = obj(candidate) - obj(x);
        let prob, accepted;
        if (delta > 0) { prob = 1; accepted = true; }
        else {
          prob = greedy ? 0 : Math.exp(delta / Math.max(T, 1e-6));
          accepted = rnd() < prob;
        }
        if (accepted) x = candidate;
        const fx = obj(x);
        if (fx > bestV) { best = x; bestV = fx; }
        tempHist.push(T); bestHist.push(bestV);
        push(
          `T=${T.toFixed(2)}：候选 x=${candidate.toFixed(2)}，Δf=${delta.toFixed(3)}，接受概率 ${prob.toFixed(3)}，${accepted ? '接受' : '拒绝'}；历史最优 ${bestV.toFixed(3)}。`,
          { candidate, candV: obj(candidate), accepted, prob }
        );
      }
      T *= cool;
    }
    push(`退火结束：全局最大约 f(${gmaxX.toFixed(2)})=${gmaxY.toFixed(3)}，算法历史最优 ${bestV.toFixed(3)}。`);
    return frames;
  },

  render(snap, p, c) {
    const curvePts = snap.curvePts || [];
    const tempHist = snap.tempHist || [], bestHist = snap.bestHist || [];
    const x = snap.x ?? 0, best = snap.best ?? 0, T = snap.T ?? 0;
    const candidate = snap.candidate ?? x, candV = snap.candV ?? 0;
    const accepted = !!snap.accepted;
    const gmaxX = snap.gmaxX ?? 0, gmaxY = snap.gmaxY ?? 0;
    const yLo = snap.yLo ?? -1, yHi = snap.yHi ?? 2;
    const T0 = snap.T0 ?? 20;
    const sx = (v) => PX0 + ((v - LO) / (HI - LO)) * (PX1 - PX0);
    const sy = (v) => PY1 - ((clamp(v, yLo, yHi) - yLo) / Math.max(1e-6, yHi - yLo)) * (PY1 - PY0);
    const dCurve = curvePts.map((q, i) => `${i === 0 ? 'M' : 'L'}${sx(q.x).toFixed(1)},${sy(q.y).toFixed(1)}`).join(' ');
    const dArea = curvePts.length > 1
      ? `${dCurve} L${sx(HI).toFixed(1)},${PY1} L${sx(LO).toFixed(1)},${PY1} Z`
      : '';
    const tx = (i) => CX0 + (i / Math.max(1, tempHist.length - 1)) * (CX1 - CX0);
    const ty = (v) => TY1 - (clamp(v, 0, T0 + 1e-6) / (T0 + 1e-6)) * (TY1 - TY0);
    const by = (v) => BY1 - ((clamp(v, yLo, yHi) - yLo) / Math.max(1e-6, yHi - yLo)) * (BY1 - BY0);
    const dT = tempHist.map((v, i) => `${i === 0 ? 'M' : 'L'}${tx(i).toFixed(1)},${ty(v).toFixed(1)}`).join(' ');
    const dB = bestHist.map((v, i) => `${i === 0 ? 'M' : 'L'}${tx(i).toFixed(1)},${by(v).toFixed(1)}`).join(' ');
    return (
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} preserveAspectRatio="xMidYMid meet">
        <defs><clipPath id="sa-clip"><rect x={PX0} y={PY0} width={PX1 - PX0} height={PY1 - PY0} /></clipPath></defs>
        <rect x={PX0} y={PY0} width={PX1 - PX0} height={PY1 - PY0} fill={c.panel} stroke={c.border} />
        <g clipPath="url(#sa-clip)">
          <path d={dArea} fill={c.primary} opacity={0.08} />
          <line x1={PX0} y1={sy(0)} x2={PX1} y2={sy(0)} stroke={c.grid} />
          <path d={dCurve} fill="none" stroke={c.primary} strokeWidth="2" />
          <line x1={sx(gmaxX)} y1={PY0} x2={sx(gmaxX)} y2={PY1} stroke={c.purple} strokeDasharray="4 3" strokeWidth="1" />
          <line x1={sx(x)} y1={sy(obj(x))} x2={sx(candidate)} y2={sy(candV)} stroke={c.muted} strokeWidth="1.2" strokeDasharray="3 2" />
          <circle cx={sx(candidate)} cy={sy(candV)} r="4" fill={c.warning} />
          <circle cx={sx(best)} cy={sy(obj(best))} r="5" fill="none" stroke={c.success} strokeWidth="2" />
          <circle cx={sx(x)} cy={sy(obj(x))} r="5" fill={c.danger} stroke={c.bg} strokeWidth="1.2" />
          <text x={sx(gmaxX) + 4} y={PY0 + 12} fontSize="9" fill={c.muted}>全局最大</text>
        </g>
        <text x={PX0} y={PY0 - 8} fontSize="11" fill={c.muted}>多峰目标函数：当前解 / 候选解 / 历史最优</text>
        <text x={PX0} y={PY1 + 16} fontSize="10" fill={c.muted}>红=当前解　黄=候选解　绿圈=历史最优</text>
        <text x={PX1} y={PY1 + 16} fontSize="10" textAnchor="end" fill={accepted ? c.success : c.muted}>
          T={T.toFixed(2)}　{accepted ? '接受候选' : '拒绝候选'}
        </text>
        <text x={CX0} y={TY0 - 14} fontSize="11" fill={c.muted}>温度下降曲线</text>
        <rect x={CX0} y={TY0} width={CX1 - CX0} height={TY1 - TY0} fill={c.panel} stroke={c.border} />
        <path d={dT} fill="none" stroke={c.warning} strokeWidth="2" />
        <text x={CX1} y={TY0 + 12} fontSize="9" textAnchor="end" fill={c.muted}>T={T.toFixed(2)}</text>
        <text x={CX0} y={BY0 - 6} fontSize="11" fill={c.muted}>历史最优目标值</text>
        <rect x={CX0} y={BY0} width={CX1 - CX0} height={BY1 - BY0} fill={c.panel} stroke={c.border} />
        <line x1={CX0} y1={by(gmaxY)} x2={CX1} y2={by(gmaxY)} stroke={c.purple} strokeDasharray="4 3" strokeWidth="1" />
        <path d={dB} fill="none" stroke={c.success} strokeWidth="2" />
        <text x={CX1} y={BY0 + 12} fontSize="9" textAnchor="end" fill={c.muted}>紫虚线=全局最大</text>
        <text x="20" y={H - 12} fontSize="11" fill={c.text}>{snap.note || '拖动进度条查看退火搜索'}</text>
      </svg>
    );
  },
};
