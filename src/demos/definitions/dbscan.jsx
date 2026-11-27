import React from 'react';
import { mulberry32, clamp } from '../utils.js';
import { datasetParam, scatterPoints, dataLabel } from '../datasets/adapter.js';

const W = 720, H = 320;
const PX0 = 46, PX1 = 410, PY0 = 34, PY1 = 264;
const CX0 = 452, CX1 = 694, CY0 = 54, CY1 = 204;

function gauss(rnd) {
  const u = Math.max(1e-9, rnd()), v = rnd();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}
function genData(n, shape, seed) {
  const rnd = mulberry32(seed >>> 0);
  const pts = [];
  const push = (x, y) => pts.push({ x: clamp(x, -1.5, 1.5), y: clamp(y, -1.5, 1.5) });
  if (shape === 'uniform') {
    for (let i = 0; i < n; i++) push((rnd() - 0.5) * 3, (rnd() - 0.5) * 3);
  } else if (shape === 'rings') {
    for (let i = 0; i < n; i++) {
      const ang = rnd() * 2 * Math.PI;
      const r = i % 2 === 0 ? 0.55 : 1.15;
      push((r + gauss(rnd) * 0.06) * Math.cos(ang), (r + gauss(rnd) * 0.06) * Math.sin(ang));
    }
    const extra = Math.round(n * 0.08);
    for (let i = 0; i < extra; i++) push((rnd() - 0.5) * 3, (rnd() - 0.5) * 3);
  } else {
    const centers = [[-0.8, -0.6], [0.85, -0.35], [0.05, 0.85]];
    for (let i = 0; i < n; i++) {
      const t = centers[i % 3];
      push(t[0] + gauss(rnd) * 0.24, t[1] + gauss(rnd) * 0.24);
    }
    const extra = Math.round(n * 0.12);
    for (let i = 0; i < extra; i++) push((rnd() - 0.5) * 3, (rnd() - 0.5) * 3);
  }
  return pts;
}

export default {
  id: 'dbscan',
  params: [
    datasetParam('iris', ['iris', 'wine']),
    { key: 'eps', label: '邻域半径 ε', type: 'range', min: 0.1, max: 0.6, step: 0.01, default: 0.28 },
    { key: 'minPts', label: '核心点最小邻居 MinPts', type: 'range', min: 2, max: 12, step: 1, default: 4 },
    { key: 'n', label: '样本数', type: 'range', min: 40, max: 160, step: 1, default: 90 },
    { key: 'seed', label: '随机种子', type: 'range', min: 1, max: 40, step: 1, default: 5 },
    { key: 'shape', label: '数据分布', type: 'select', default: 'blobs', options: [
      { value: 'blobs', label: '团状簇 + 噪声' },
      { value: 'rings', label: '双环 + 噪声' },
      { value: 'uniform', label: '均匀噪声' },
    ] },
    { key: 'showRadius', label: '显示 ε 邻域圈', type: 'toggle', default: true },
  ],
  height: H,
  legend: [
    { label: '核心点(实心)' }, { label: '边界点(空心)' }, { label: '噪声点(灰)' },
    { label: '当前扩展的 ε 邻域' },
  ],
  hint: '按点顺序扫描：邻域内点数≥MinPts 判为核心点并 BFS 扩展成簇，否则暂记噪声，三类逐点显现。',

  buildSteps(p) {
    const n = clamp(Math.round(Number(p.n) || 90), 40, 160);
    const eps = clamp(Number(p.eps) || 0.28, 0.02, 2);
    const minPts = clamp(Math.round(Number(p.minPts) || 4), 1, 30);
    const shape = p.shape || 'blobs';
    const seed = (Number(p.seed) || 5) >>> 0;
    const pts = scatterPoints(p, 'iris', () => genData(n, shape, seed), 2, 3);
    const source = dataLabel(p, 'iris');
    const m = pts.length;
    const eps2 = eps * eps;
    // 预计算距离平方矩阵与邻域计数（含自身）
    const d2 = Array.from({ length: m }, () => new Float64Array(m));
    const nbrCount = new Array(m).fill(0);
    for (let i = 0; i < m; i++) {
      for (let j = i; j < m; j++) {
        const dx = pts[i].x - pts[j].x, dy = pts[i].y - pts[j].y;
        const d = dx * dx + dy * dy;
        d2[i][j] = d; d2[j][i] = d;
      }
      for (let j = 0; j < m; j++) if (d2[i][j] <= eps2) nbrCount[i] += 1;
    }
    const nbrs = (i) => {
      const arr = [];
      for (let j = 0; j < m; j++) if (d2[i][j] <= eps2) arr.push(j);
      return arr;
    };
    const isCore = nbrCount.map((v) => v >= minPts);
    // -2 未访问, -1 噪声(临时), >=0 簇号
    const labels = new Array(m).fill(-2);
    const visited = new Array(m).fill(false);
    let clusterId = 0;
    const steps = [];
    const stats = () => {
      let core = 0, border = 0, noise = 0;
      const set = new Set();
      for (let i = 0; i < m; i++) {
        if (labels[i] >= 0) { set.add(labels[i]); if (isCore[i]) core += 1; else border += 1; }
        else if (labels[i] === -1) noise += 1;
      }
      return { core, border, noise, clusters: set.size };
    };
    const push = (note, cur, curNbrs) => {
      const st = stats();
      steps.push({
        labels: [...labels], pts, isCore, cur, curNbrs: curNbrs || [],
        eps, minPts, stats: st, note: `${note} 数据来源：${source}。`,
        metrics: { 邻域半径: eps, 最小邻居数: minPts, 核心点: st.core, 边界点: st.border, 噪声点: st.noise, 簇数: st.clusters },
      });
    };
    push(`初始：全部 ${m} 个点未访问；ε=${eps.toFixed(2)}，MinPts=${minPts}（邻域含自身）。`, -1, []);
    for (let i = 0; i < m; i++) {
      if (visited[i]) {
        push(`点 ${i} 已归入簇 ${labels[i] + 1}，跳过。`, i, []);
        continue;
      }
      visited[i] = true;
      const N = nbrs(i);
      if (N.length < minPts) {
        labels[i] = -1;
        push(`点 ${i} 的 ε 邻域仅 ${N.length} 个点(<MinPts)，暂记为噪声。`, i, N);
      } else {
        labels[i] = clusterId;
        const queue = N.filter((j) => j !== i);
        const inQ = new Set(queue);
        let qi = 0;
        while (qi < queue.length) {
          const j = queue[qi++];
          if (!visited[j]) {
            visited[j] = true;
            const Nj = nbrs(j);
            if (Nj.length >= minPts) {
              for (const k of Nj) if (!inQ.has(k)) { inQ.add(k); queue.push(k); }
            }
          }
          if (labels[j] === -2 || labels[j] === -1) labels[j] = clusterId;
        }
        let size = 0;
        for (let t = 0; t < m; t++) if (labels[t] === clusterId) size += 1;
        push(`点 ${i} 是核心点，BFS 扩展出第 ${clusterId + 1} 个簇（当前 ${size} 个点）。`, i, N);
        clusterId += 1;
      }
    }
    push(`扫描完成：核心点 ${stats().core}、边界点 ${stats().border}、噪声 ${stats().noise}，共 ${stats().clusters} 个簇。`, -1, []);
    return steps;
  },

  render(snap, p, c) {
    const pts = snap.pts || [];
    const labels = snap.labels || [];
    const isCore = snap.isCore || [];
    const cur = snap.cur ?? -1;
    const curNbrs = snap.curNbrs || [];
    const st = snap.stats || { core: 0, border: 0, noise: 0, clusters: 0 };
    const eps = snap.eps ?? 0.28;
    const showR = p.showRadius !== false;
    const sx = (x) => PX0 + ((x + 1.5) / 3) * (PX1 - PX0);
    const sy = (y) => PY1 - ((y + 1.5) / 3) * (PY1 - PY0);
    const rx = (eps / 3) * (PX1 - PX0), ry = (eps / 3) * (PY1 - PY0);
    const bars = [
      { label: '核心点', v: st.core, col: c.success },
      { label: '边界点', v: st.border, col: c.warning },
      { label: '噪声点', v: st.noise, col: c.muted },
    ];
    const maxV = Math.max(1, ...bars.map((b) => b.v));
    return (
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} preserveAspectRatio="xMidYMid meet">
        <defs><clipPath id="db-clip"><rect x={PX0} y={PY0} width={PX1 - PX0} height={PY1 - PY0} /></clipPath></defs>
        <rect x={PX0} y={PY0} width={PX1 - PX0} height={PY1 - PY0} fill={c.panel} stroke={c.border} />
        <g clipPath="url(#db-clip)">
          {curNbrs.map((j, i) => (
            <circle key={`n${i}`} cx={sx(pts[j].x)} cy={sy(pts[j].y)} r="5"
              fill="none" stroke={c.accent} strokeWidth="1" opacity={0.7} />
          ))}
          {showR && cur >= 0 && pts[cur] && (
            <ellipse cx={sx(pts[cur].x)} cy={sy(pts[cur].y)} rx={rx} ry={ry}
              fill="none" stroke={c.warning} strokeWidth="1.4" strokeDasharray="4 3" />
          )}
          {pts.map((q, i) => {
            const lb = labels[i] ?? -2;
            let fill = c.muted, r = 2.2, hollow = false;
            if (lb >= 0) {
              fill = c.series[lb % c.series.length];
              if (isCore[i]) r = 3.2; else { r = 3; hollow = true; }
            } else if (lb === -1) { fill = c.muted; r = 2; }
            return (
              <circle key={i} cx={sx(q.x)} cy={sy(q.y)} r={r}
                fill={hollow ? 'none' : fill} stroke={hollow ? fill : 'none'}
                strokeWidth={hollow ? 1.4 : 0} opacity={lb === -2 ? 0.45 : 0.92} />
            );
          })}
          {cur >= 0 && pts[cur] && (
            <circle cx={sx(pts[cur].x)} cy={sy(pts[cur].y)} r="6" fill="none" stroke={c.warning} strokeWidth="2" />
          )}
        </g>
        <text x={PX0} y={PY0 - 8} fontSize="11" fill={c.muted}>DBSCAN：逐点扩展与三类着色</text>
        <text x={PX0} y={PY1 + 16} fontSize="10" fill={c.muted}>黄圈=当前点的 ε 邻域</text>
        <text x={PX1} y={PY1 + 16} fontSize="10" textAnchor="end" fill={c.muted}>空心=边界点，灰=噪声</text>
        <text x={CX0} y={CY0 - 14} fontSize="11" fill={c.muted}>三类点统计</text>
        <rect x={CX0} y={CY0} width={CX1 - CX0} height={CY1 - CY0} fill={c.panel} stroke={c.border} />
        {bars.map((b, t) => {
          const bw = 42, bx = CX0 + 26 + t * 70;
          const h = (b.v / maxV) * (CY1 - CY0 - 38);
          return (
            <g key={t}>
              <rect x={bx} y={CY1 - 22 - h} width={bw} height={Math.max(1, h)} fill={b.col} opacity={0.85} />
              <text x={bx + bw / 2} y={CY1 - 8} fontSize="9" textAnchor="middle" fill={c.muted}>{b.label}</text>
              <text x={bx + bw / 2} y={CY1 - 26 - h} fontSize="9" textAnchor="middle" fill={c.muted}>{b.v}</text>
            </g>
          );
        })}
        <text x={CX0} y={CY0 + 12} fontSize="9" fill={c.muted}>已发现簇：{st.clusters}</text>
        <text x="20" y={H - 12} fontSize="11" fill={c.text}>{snap.note || '拖动进度条查看逐点扩展'}</text>
      </svg>
    );
  },
};
