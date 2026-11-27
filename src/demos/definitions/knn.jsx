import React from 'react';
import { mulberry32, clamp } from '../utils.js';
import { datasetParam, scatterPoints, dataLabel, dataNote } from '../datasets/adapter.js';

const W = 720, H = 320;
const PX0 = 46, PX1 = 410, PY0 = 34, PY1 = 264;
const CX0 = 452, CX1 = 694, CY0 = 54, CY1 = 204;
const GX = 26, GY = 18;

function gauss(rnd) {
  const u = Math.max(1e-9, rnd()), v = rnd();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}
function genData(n, seed) {
  const rnd = mulberry32(seed >>> 0);
  const centers = [[-0.75, -0.55], [0.8, -0.35], [0.05, 0.8]];
  const pts = [];
  for (let i = 0; i < n; i++) {
    const t = i % 3;
    pts.push({
      x: clamp(centers[t][0] + gauss(rnd) * 0.34, -1.5, 1.5),
      y: clamp(centers[t][1] + gauss(rnd) * 0.34, -1.5, 1.5),
      cls: t,
    });
  }
  return pts;
}
function vote(px, py, pts, k, weighted) {
  const ds = pts.map((q, i) => ({ i, d: (q.x - px) ** 2 + (q.y - py) ** 2, cls: q.cls }));
  ds.sort((a, b) => a.d - b.d);
  const kk = Math.min(k, ds.length);
  const scores = [0, 0, 0];
  for (let j = 0; j < kk; j++) {
    scores[ds[j].cls] += weighted ? 1 / (ds[j].d + 0.02) : 1;
  }
  let cls = 0;
  for (let t = 1; t < 3; t++) if (scores[t] > scores[cls]) cls = t;
  return { cls, neighbors: ds.slice(0, kk).map((o) => o.i), scores };
}

export default {
  id: 'knn',
  params: [
    datasetParam('iris', ['iris', 'wine', 'breast']),
    { key: 'k', label: '邻居数 k', type: 'range', min: 1, max: 15, step: 1, default: 5, hint: 'k 越小边界越碎' },
    { key: 'n', label: '样本数', type: 'range', min: 20, max: 140, step: 1, default: 60 },
    { key: 'seed', label: '随机种子', type: 'range', min: 1, max: 40, step: 1, default: 12 },
    { key: 'weighted', label: '距离加权投票', type: 'toggle', default: false, hint: '近邻权重 1/(d+ε)' },
  ],
  height: H,
  legend: [
    { label: '类别 A 决策区' }, { label: '类别 B 决策区' }, { label: '类别 C 决策区' },
    { label: '查询点与 k 近邻' },
  ],
  hint: '对平面网格逐格用最近 k 个训练点多数投票着色；末帧标出查询点与其最近的 k 个邻居连线。',

  buildSteps(p) {
    const n = clamp(Math.round(Number(p.n) || 60), 20, 140);
    const k = clamp(Math.round(Number(p.k) || 5), 1, 15);
    const weighted = !!p.weighted;
    const seed = (Number(p.seed) || 12) >>> 0;
    const pts = scatterPoints(p, 'iris', () => genData(n, seed), 2, 3);
    const source = dataLabel(p, 'iris');
    const kk = Math.min(k, pts.length);
    const qr = mulberry32((seed * 7 + 3) >>> 0);
    const query = { x: (qr() - 0.5) * 1.6, y: (qr() - 0.5) * 1.6 };
    const vq = vote(query.x, query.y, pts, kk, weighted);
    const cells = [];
    for (let gx = 0; gx < GX; gx++) {
      for (let gy = 0; gy < GY; gy++) {
        const x = -1.5 + (3 * (gx + 0.5)) / GX;
        const y = 1.5 - (3 * (gy + 0.5)) / GY;
        cells.push({ gx, gy, x, y, cls: vote(x, y, pts, kk, weighted).cls });
      }
    }
    const total = cells.length;
    const STEPS = 34;
    const steps = [];
    for (let s = 0; s <= STEPS; s++) {
      const count = Math.floor((total * s) / STEPS);
      const done = s === STEPS;
      const note = done
        ? `网格着色完成；查询点 (${query.x.toFixed(2)}, ${query.y.toFixed(2)}) 由 ${kk} 个最近邻居投票判为第 ${vq.cls + 1} 类。`
        : `已按 ${kk} 近邻${weighted ? '距离加权' : '多数'}投票着色 ${count}/${total} 个网格单元，决策区域逐步显现。`;
      steps.push({
        shown: cells.slice(0, count), pts, query, neighbors: vq.neighbors,
        voteScores: vq.scores, queryCls: vq.cls, kk, done, weighted,
        note: `${note} 数据来源：${source}。`,
        metrics: { 邻居数k: kk, 已着色: count, 网格总数: total, 查询预测: vq.cls + 1, 数据来源: source },
      });
    }
    return steps;
  },

  render(snap, p, c) {
    const shown = snap.shown || [];
    const pts = snap.pts || [];
    const query = snap.query || { x: 0, y: 0 };
    const neighbors = snap.neighbors || [];
    const scores = snap.voteScores || [];
    const done = !!snap.done;
    const queryCls = snap.queryCls ?? 0;
    const sx = (x) => PX0 + ((x + 1.5) / 3) * (PX1 - PX0);
    const sy = (y) => PY1 - ((y + 1.5) / 3) * (PY1 - PY0);
    const cw = (PX1 - PX0) / GX, ch = (PY1 - PY0) / GY;
    const qx = sx(query.x), qy = sy(query.y);
    const maxS = Math.max(1e-6, ...scores);
    return (
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} preserveAspectRatio="xMidYMid meet">
        <defs><clipPath id="knn-clip"><rect x={PX0} y={PY0} width={PX1 - PX0} height={PY1 - PY0} /></clipPath></defs>
        <rect x={PX0} y={PY0} width={PX1 - PX0} height={PY1 - PY0} fill={c.panel} stroke={c.border} />
        <g clipPath="url(#knn-clip)">
          {shown.map((cell, i) => (
            <rect key={i} x={PX0 + cell.gx * cw} y={PY0 + cell.gy * ch}
              width={cw + 0.4} height={ch + 0.4}
              fill={c.series[cell.cls % c.series.length]} opacity={0.22} />
          ))}
          {pts.map((q, i) => (
            <circle key={`t${i}`} cx={sx(q.x)} cy={sy(q.y)} r="2.6"
              fill={c.series[q.cls % c.series.length]} stroke={c.bg} strokeWidth="0.6" />
          ))}
          {done && neighbors.map((ni, i) => {
            const q = pts[ni];
            if (!q) return null;
            return (
              <g key={`n${i}`}>
                <line x1={qx} y1={qy} x2={sx(q.x)} y2={sy(q.y)} stroke={c.text} strokeWidth="1" strokeDasharray="3 2" opacity={0.65} />
                <circle cx={sx(q.x)} cy={sy(q.y)} r="4.2" fill="none" stroke={c.warning} strokeWidth="1.6" />
              </g>
            );
          })}
          <circle cx={qx} cy={qy} r={done ? 5.5 : 4} fill={c.warning} stroke={c.bg} strokeWidth="1.2" />
        </g>
        <text x={PX0} y={PY0 - 8} fontSize="11" fill={c.muted}>网格决策区域 + 查询点</text>
        <text x={PX0} y={PY1 + 16} fontSize="10" fill={c.muted}>逐格 k 近邻投票着色</text>
        <text x={PX1} y={PY1 + 16} fontSize="10" textAnchor="end" fill={c.muted}>黄点=待分类查询点</text>
        <text x={CX0} y={CY0 - 14} fontSize="11" fill={c.muted}>查询点类别得票</text>
        <rect x={CX0} y={CY0} width={CX1 - CX0} height={CY1 - CY0} fill={c.panel} stroke={c.border} />
        {[0, 1, 2].map((t) => {
          const bw = 40, bx = CX0 + 24 + t * 68;
          const h = ((scores[t] || 0) / maxS) * (CY1 - CY0 - 36);
          return (
            <g key={t}>
              <rect x={bx} y={CY1 - 20 - h} width={bw} height={Math.max(1, h)}
                fill={c.series[t % c.series.length]} opacity={0.85} />
              <text x={bx + bw / 2} y={CY1 - 6} fontSize="10" textAnchor="middle" fill={c.muted}>类{t + 1}</text>
              <text x={bx + bw / 2} y={CY1 - 24 - h} fontSize="9" textAnchor="middle" fill={c.muted}>
                {(scores[t] || 0).toFixed(1)}
              </text>
            </g>
          );
        })}
        <text x={CX0} y={CY0 + 12} fontSize="9" fill={c.muted}>投票得分</text>
        <text x={CX1} y={CY0 + 12} fontSize="9" textAnchor="end" fill={done ? c.success : c.muted}>
          {done ? `预测 → 第 ${queryCls + 1} 类` : '着色中…'}
        </text>
        <text x="20" y={H - 12} fontSize="11" fill={c.text}>{snap.note || '拖动进度条查看决策区域生成'}</text>
      </svg>
    );
  },
};
