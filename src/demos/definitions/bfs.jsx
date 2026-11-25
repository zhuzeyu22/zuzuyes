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

const DIRS4 = [[-1, 0], [1, 0], [0, -1], [0, 1]];
const DIRS8 = [[-1, 0], [1, 0], [0, -1], [0, 1], [-1, -1], [-1, 1], [1, -1], [1, 1]];

export default {
  id: 'bfs',
  params: [
    { key: 'rows', label: '网格行数', type: 'range', min: 4, max: 10, step: 1, default: 6 },
    { key: 'cols', label: '网格列数', type: 'range', min: 4, max: 14, step: 1, default: 10 },
    { key: 'density', label: '障碍密度', type: 'range', min: 0, max: 45, step: 5, default: 20, unit: '%' },
    { key: 'seed', label: '随机种子', type: 'range', min: 1, max: 30, step: 1, default: 7 },
    { key: 'eight', label: '八方向扩散', type: 'toggle', default: false, hint: '开启后包含对角邻居' },
  ],
  height: H,
  legend: [
    { color: L.panel, label: '未访问空格' },
    { color: L.muted, label: '障碍' },
    { color: L.series[4], label: '队列中' },
    { color: L.warning, label: '当前出队' },
    { color: L.primary, label: '已访问（按层着色）' },
  ],
  hint: '从左上角出发用队列按层扩散，逐格标出最短距离，障碍不可通过。',

  buildSteps(p) {
    const rows = p.rows, cols = p.cols;
    const rnd = mulberry32(p.seed * 613 + 11);
    const grid = Array.from({ length: rows }, () =>
      Array.from({ length: cols }, () => (rnd() * 100 < p.density ? 1 : 0)));
    grid[0][0] = 0;
    const dist = Array.from({ length: rows }, () => Array(cols).fill(-1));
    const dirs = p.eight ? DIRS8 : DIRS4;
    const queue = [];
    let head = 0, visited = 0, maxDist = 0, curDist = 0;
    dist[0][0] = 0;
    queue.push([0, 0]);
    const steps = [];
    const push = (note, extra = {}) => steps.push({
      grid: grid.map((r) => [...r]), dist: dist.map((r) => [...r]),
      rows, cols, queue: queue.slice(head).map((q) => [...q]),
      current: null, newly: null, done: false, note,
      metrics: { 已访问格子: visited, 队列长度: queue.length - head, 当前距离: curDist, 最远距离: maxDist },
      ...extra,
    });
    push(`生成 ${rows}×${cols} 网格，障碍密度 ${p.density}%，起点设在 (0,0)。`);
    while (head < queue.length) {
      const cell = queue[head++];
      const r = cell[0], col = cell[1];
      visited++;
      curDist = dist[r][col];
      maxDist = Math.max(maxDist, curDist);
      push(`出队 (${r},${col})，距离 ${curDist}，检查 ${dirs.length} 个方向的邻居。`, {
        current: [r, col],
      });
      for (const d of dirs) {
        const nr = r + d[0], nc = col + d[1];
        if (nr < 0 || nr >= rows || nc < 0 || nc >= cols) continue;
        if (grid[nr][nc] === 1 || dist[nr][nc] !== -1) continue;
        dist[nr][nc] = curDist + 1;
        queue.push([nr, nc]);
        push(`发现可通行格 (${nr},${nc})，标记距离 ${dist[nr][nc]} 并入队。`, {
          current: [r, col], newly: [nr, nc],
        });
      }
    }
    push(`BFS 完成：共访问 ${visited} 个格子，最远距离 ${maxDist}。`, {
      done: true, current: null, newly: null,
    });
    return finalize(steps);
  },

  render(snap, p, c) {
    const rows = snap.rows || p.rows || 1;
    const cols = snap.cols || p.cols || 1;
    const grid = snap.grid || [];
    const dist = snap.dist || [];
    const queue = snap.queue || [];
    const current = snap.current || null;
    const newly = snap.newly || null;
    const cell = Math.min(30, (W - 48) / Math.max(1, cols), (H - 120) / Math.max(1, rows));
    const gx = 24, gy = 32;
    const cells = [];
    for (let r = 0; r < rows; r++) {
      for (let col = 0; col < cols; col++) {
        const x = gx + col * cell, y = gy + r * cell;
        const obstacle = !!(grid[r] && grid[r][col] === 1);
        const d = (dist[r] && dist[r][col] !== undefined) ? dist[r][col] : -1;
        const inQueue = queue.some((q) => q[0] === r && q[1] === col);
        const isCur = current && current[0] === r && current[1] === col;
        const isNew = newly && newly[0] === r && newly[1] === col;
        let stroke = c.border, sw = 1;
        if (!obstacle && d >= 0) { stroke = c.series[d % c.series.length]; sw = 1.8; }
        if (inQueue) { stroke = c.series[4]; sw = 2; }
        if (isNew) { stroke = c.success; sw = 2.4; }
        if (isCur) { stroke = c.warning; sw = 2.8; }
        cells.push(
          <g key={`${r}-${col}`}>
            <rect x={x} y={y} width={cell - 2} height={cell - 2} rx="2"
              fill={obstacle ? c.muted : c.panel} stroke={stroke} strokeWidth={sw} />
            {!obstacle && d >= 0 && (
              <text x={x + (cell - 2) / 2} y={y + (cell - 2) / 2 + 3}
                textAnchor="middle" fontSize="10" fill={c.text}>{d}</text>
            )}
          </g>
        );
      }
    }
    const qy = H - 70;
    const shown = queue.slice(0, 14);
    const qBoxW = Math.min(48, (W - 130) / 14);
    return (
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} preserveAspectRatio="xMidYMid meet">
        <text x="24" y="18" fontSize="11" fill={c.muted}>网格 BFS 层序遍历 · 格内数字为最短距离</text>
        <text x={W - 24} y="18" textAnchor="end" fontSize="10" fill={c.muted}>
          {`已访问 ${snap.metrics ? snap.metrics.已访问格子 : 0} 格 · 队列 ${queue.length} 格`}
        </text>
        {cells}
        <text x="24" y={qy - 8} fontSize="10" fill={c.muted}>队列（队首 → 队尾）</text>
        {shown.map((q, k) => (
          <g key={k}>
            <rect x={100 + k * qBoxW} y={qy} width={qBoxW - 3} height="22" rx="2"
              fill={c.panel} stroke={c.series[4]} strokeWidth="1" />
            <text x={100 + k * qBoxW + (qBoxW - 3) / 2} y={qy + 15}
              textAnchor="middle" fontSize="9" fill={c.text}>{`(${q[0]},${q[1]})`}</text>
          </g>
        ))}
        {queue.length > 14 && (
          <text x={100 + 14 * qBoxW} y={qy + 15} fontSize="9" fill={c.muted}>+{queue.length - 14}</text>
        )}
        <text x="24" y={H - 14} fontSize="11" fill={c.muted}>
          {snap.done
            ? '遍历完成，所有可达格子已标记距离'
            : `当前出队 ${current ? `(${current[0]},${current[1]})` : '—'} · 距离 ${snap.metrics ? snap.metrics.当前距离 : 0}`}
        </text>
        <text x={W - 24} y={H - 14} fontSize="11" textAnchor="end" fill={c.muted}>时间 O(V+E) · 空间 O(V) · 最短步数</text>
      </svg>
    );
  },
};
