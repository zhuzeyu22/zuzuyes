import React from 'react';
import { mulberry32, PALETTE } from '../utils.js';

const W = 720, H = 340, CAP = 560;
const L = PALETTE.light;

function finalize(steps, cap = CAP) {
  let out = steps;
  if (out.length > cap) {
    const stride = Math.ceil(out.length / cap);
    out = out.filter((_, i) => i % stride === 0 || i === steps.length - 1);
  }
  let guard = 0;
  while (out.length < 20 && guard++ < 40) {
    const first = out[0] || {};
    out.splice(1, 0, { ...first, note: `准备：${first.note || '即将开始'}` });
  }
  return out;
}

export default {
  id: 'dijkstra',
  params: [
    { key: 'nodeCount', label: '节点数量', type: 'range', min: 5, max: 9, step: 1, default: 7 },
    { key: 'density', label: '边密度', type: 'range', min: 30, max: 90, step: 10, default: 60, unit: '%' },
    { key: 'seed', label: '随机种子', type: 'range', min: 1, max: 30, step: 1, default: 7 },
    { key: 'directed', label: '有向图', type: 'toggle', default: false, hint: '开启后边带方向' },
  ],
  height: H,
  legend: [
    { color: L.primary, label: '未确定节点 / 源点' },
    { color: L.warning, label: '当前松弛节点' },
    { color: L.danger, label: '正在松弛的边' },
    { color: L.success, label: '已确定集合 / 最短路树' },
    { color: L.muted, label: '普通边与权值' },
  ],
  hint: '每次从未确定集合中取距离最小的节点，对其出边做松弛，逐步生成源点的最短路径树。',

  buildSteps(p) {
    const N = p.nodeCount;
    const rnd = mulberry32(p.seed * 317 + 5);
    const edges = [];
    for (let u = 0; u < N; u++) {
      for (let v = u + 1; v < N; v++) {
        if (rnd() * 100 < p.density) edges.push({ u, v, w: 1 + Math.floor(rnd() * 9) });
        if (p.directed && rnd() * 100 < p.density) edges.push({ u: v, v: u, w: 1 + Math.floor(rnd() * 9) });
      }
    }
    if (!edges.some((e) => e.u === 0)) edges.push({ u: 0, v: 1 % N, w: 3 });
    const adj = Array.from({ length: N }, () => []);
    edges.forEach((e) => adj[e.u].push({ to: e.v, w: e.w }));
    const INF = Number.POSITIVE_INFINITY;
    const dist = Array(N).fill(INF); dist[0] = 0;
    const prev = Array(N).fill(-1);
    const visited = Array(N).fill(false);
    const steps = [];
    let relaxations = 0, curD = 0;
    const push = (note, extra = {}) => steps.push({
      nodeCount: N, directed: !!p.directed, edges: edges.map((e) => ({ ...e })),
      dist: dist.map((d) => (Number.isFinite(d) ? d : null)),
      prev: [...prev], visited: [...visited],
      current: -1, relaxEdge: null, done: false, note,
      metrics: {
        已确定节点: visited.filter(Boolean).length, 松弛尝试: relaxations,
        当前距离: curD, 最短路树边: prev.filter((x) => x >= 0).length,
      },
      ...extra,
    });
    push(`生成 ${N} 个节点、${edges.length} 条${p.directed ? '有向' : '无向'}带权边，源点为节点 0。`);
    for (let s = 0; s < N; s++) {
      let u = -1, best = INF;
      for (let i = 0; i < N; i++) {
        if (!visited[i] && dist[i] < best) { best = dist[i]; u = i; }
      }
      if (u < 0) break;
      visited[u] = true;
      curD = dist[u];
      push(`确定节点 ${u}，其最短距离 ${curD}，加入已确定集合。`, { current: u });
      for (const e of adj[u]) {
        if (visited[e.to]) continue;
        relaxations++;
        const cand = dist[u] + e.w;
        const old = dist[e.to];
        push(`松弛边 ${u}→${e.to}（权 ${e.w}）：候选 ${cand}，原为 ${Number.isFinite(old) ? old : '∞'}。`, {
          current: u, relaxEdge: [u, e.to],
        });
        if (cand < old) {
          dist[e.to] = cand;
          prev[e.to] = u;
          push(`更新成功：dist[${e.to}] = ${cand}，前驱设为 ${u}。`, {
            current: u, relaxEdge: [u, e.to],
          });
        } else {
          push(`候选不更优，dist[${e.to}] 保持不变。`, {
            current: u, relaxEdge: [u, e.to],
          });
        }
      }
    }
    push(`最短路计算完成：dist = [${dist.map((d) => (Number.isFinite(d) ? d : '∞')).join(', ')}]。`, {
      done: true, current: -1, relaxEdge: null,
    });
    return finalize(steps);
  },

  render(snap, p, c) {
    const N = snap.nodeCount || p.nodeCount || 1;
    const edges = snap.edges || [];
    const dist = snap.dist || [];
    const prev = snap.prev || [];
    const visited = snap.visited || [];
    const current = snap.current ?? -1;
    const relaxEdge = snap.relaxEdge || null;
    const directed = snap.directed ?? p.directed ?? false;
    const pos = (i) => {
      const a = -Math.PI / 2 + (i * 2 * Math.PI) / Math.max(1, N);
      return { x: 200 + 118 * Math.cos(a), y: 178 + 118 * Math.sin(a) };
    };
    const edgeEls = edges.map((e, k) => {
      const a1 = pos(e.u), b1 = pos(e.v);
      const isTree = prev[e.v] === e.u;
      const isRelax = relaxEdge && relaxEdge[0] === e.u && relaxEdge[1] === e.v;
      let col = c.muted, sw = 1;
      if (isTree) { col = c.success; sw = 2; }
      if (isRelax) { col = c.danger; sw = 2.8; }
      const mx = (a1.x + b1.x) / 2, my = (a1.y + b1.y) / 2;
      const dx = b1.x - a1.x, dy = b1.y - a1.y;
      const len = Math.hypot(dx, dy) || 1;
      const ux = dx / len, uy = dy / len, perpX = -uy, perpY = ux;
      const tipX = mx + ux * 8, tipY = my + uy * 8;
      const arrow = `${tipX},${tipY} ${tipX - ux * 8 + perpX * 3.5},${tipY - uy * 8 + perpY * 3.5} ${tipX - ux * 8 - perpX * 3.5},${tipY - uy * 8 - perpY * 3.5}`;
      return (
        <g key={k}>
          <line x1={a1.x} y1={a1.y} x2={b1.x} y2={b1.y} stroke={col} strokeWidth={sw} opacity={0.85} />
          {directed && <polygon points={arrow} fill={col} />}
          <rect x={mx - 10} y={my - 8} width="20" height="14" rx="2"
            fill={c.panel} stroke={c.border} strokeWidth="0.6" />
          <text x={mx} y={my + 2} textAnchor="middle" fontSize="9" fill={c.text}>{e.w}</text>
        </g>
      );
    });
    const nodeEls = Array.from({ length: N }, (_, i) => {
      const pp = pos(i);
      let col = c.primary;
      if (visited[i]) col = c.success;
      if (i === current) col = c.warning;
      if (i === 0) col = c.primary;
      return (
        <g key={i}>
          <circle cx={pp.x} cy={pp.y} r="15" fill={c.panel}
            stroke={col} strokeWidth={i === current ? 2.6 : 1.6} />
          <text x={pp.x} y={pp.y + 4} textAnchor="middle" fontSize="11" fill={col}>{i}</text>
        </g>
      );
    });
    const tx = 400, ty = 56;
    return (
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} preserveAspectRatio="xMidYMid meet">
        <text x="24" y="30" fontSize="11" fill={c.muted}>带权图（边旁数字为权值{directed ? '，箭头表示方向' : ''}）</text>
        <text x={tx} y={ty - 16} fontSize="11" fill={c.muted}>距离表（∞ 表示暂不可达）</text>
        {edgeEls}
        {nodeEls}
        {Array.from({ length: N }, (_, i) => {
          const y = ty + i * 28;
          const isCur = i === current;
          const dv = dist[i];
          return (
            <g key={`d${i}`}>
              <rect x={tx} y={y} width={W - tx - 24} height="24" rx="3"
                fill={c.panel} stroke={isCur ? c.warning : c.border} strokeWidth={isCur ? 1.8 : 1} />
              <text x={tx + 10} y={y + 16} fontSize="11" fill={c.text}>节点 {i}</text>
              <text x={tx + 110} y={y + 16} fontSize="11" fill={c.text}>dist = {dv === null || dv === undefined ? '∞' : dv}</text>
              <text x={tx + 220} y={y + 16} fontSize="10" fill={visited[i] ? c.success : c.muted}>
                {visited[i] ? '已确定' : '未确定'}
              </text>
            </g>
          );
        })}
        <text x="24" y={H - 14} fontSize="11" fill={c.muted}>
          {snap.done
            ? '最短路计算完成'
            : `当前松弛节点 ${current >= 0 ? current : '—'} · 松弛边 ${relaxEdge ? `${relaxEdge[0]}→${relaxEdge[1]}` : '无'}`}
        </text>
        <text x={W - 24} y={H - 14} fontSize="11" textAnchor="end" fill={c.muted}>时间 O((V+E)log V) · 要求非负权</text>
      </svg>
    );
  },
};
