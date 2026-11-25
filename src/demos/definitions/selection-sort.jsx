import React from 'react';
import { makeArray, DIST_OPTIONS, PALETTE } from '../utils.js';

const W = 720, H = 300, CAP = 560;
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
  id: 'selection-sort',
  params: [
    { key: 'n', label: '元素个数', type: 'range', min: 6, max: 40, step: 1, default: 16 },
    { key: 'dist', label: '初始分布', type: 'select', default: 'random', options: DIST_OPTIONS },
    { key: 'seed', label: '随机种子', type: 'range', min: 1, max: 30, step: 1, default: 7 },
    { key: 'detail', label: '逐次比较明细', type: 'toggle', default: true, hint: '关闭后每轮只记录关键帧' },
  ],
  height: H,
  legend: [
    { color: L.primary, label: '待排序' },
    { color: L.series[5], label: '扫描指针' },
    { color: L.series[4], label: '当前最小值' },
    { color: L.danger, label: '发生交换' },
    { color: L.success, label: '已就位' },
  ],
  hint: '每轮在未排序区选出最小值，与区间首元素交换，逐步把已就位区向右扩展。',

  buildSteps(p) {
    const a = makeArray(p.n, p.dist, p.seed);
    const n = a.length;
    const steps = [];
    let comparisons = 0, swaps = 0, sortedFrom = 0;
    const push = (note, extra = {}) => steps.push({
      arr: [...a], minIdx: -1, scan: -1, compare: [], sortedFrom,
      swapped: false, done: false, note,
      metrics: { 比较次数: comparisons, 交换次数: swaps, 已就位: sortedFrom },
      ...extra,
    });
    push(`初始数组共 ${n} 个元素，从位置 0 开始选择排序。`, {});
    for (let i = 0; i < n - 1; i++) {
      let minIdx = i;
      push(`第 ${i + 1} 轮：在未排序区 [${i}, ${n - 1}] 找最小值，暂定位置 ${i}。`, { minIdx, sortedFrom: i });
      for (let j = i + 1; j < n; j++) {
        comparisons++;
        if (p.detail) {
          push(`扫描位置 ${j}：值 ${a[j]} 与当前最小 ${a[minIdx]} 比较。`, {
            minIdx, scan: j, compare: [minIdx, j], sortedFrom: i,
          });
        }
        if (a[j] < a[minIdx]) {
          minIdx = j;
          push(`发现更小值 ${a[j]}，更新最小值位置为 ${j}。`, {
            minIdx, scan: j, compare: [minIdx, j], sortedFrom: i,
          });
        }
      }
      push(`本轮最小值为 ${a[minIdx]}（位置 ${minIdx}），目标位置 ${i}。`, {
        minIdx, scan: -1, compare: [minIdx, i], sortedFrom: i,
      });
      if (minIdx !== i) {
        const t = a[i]; a[i] = a[minIdx]; a[minIdx] = t;
        swaps++;
        push(`交换位置 ${i} 与 ${minIdx}，最小值归位。`, {
          minIdx: i, scan: -1, compare: [i, minIdx], sortedFrom: i, swapped: true,
        });
      } else {
        push(`最小值已在目标位置，无需交换。`, {
          minIdx: i, scan: -1, compare: [i], sortedFrom: i,
        });
      }
      sortedFrom = i + 1;
      push(`位置 ${i} 已就位，已就位区扩展为 [0, ${i}]。`, {
        minIdx: -1, scan: -1, compare: [], sortedFrom,
      });
    }
    sortedFrom = n;
    push('排序完成，整个数组有序。', { minIdx: -1, scan: -1, compare: [], sortedFrom, done: true });
    return finalize(steps);
  },

  render(snap, p, c) {
    const arr = snap.arr || [];
    const n = arr.length;
    const top = 30, bottom = 260;
    const gap = 2, bw = (W - 48) / Math.max(1, n) - gap;
    const max = Math.max(100, ...arr);
    const compare = snap.compare || [];
    const sortedFrom = snap.sortedFrom ?? 0;
    const minIdx = snap.minIdx ?? -1;
    const scan = snap.scan ?? -1;
    const bars = arr.map((v, i) => {
      const h = (v / max) * (bottom - top);
      const x = 24 + i * (bw + gap);
      let fill = c.primary;
      if (snap.done || i < sortedFrom) fill = c.success;
      if (compare.includes(i)) fill = snap.swapped ? c.danger : c.warning;
      if (i === scan) fill = c.series[5];
      if (i === minIdx) fill = c.series[4];
      return (
        <g key={i}>
          <rect x={x} y={bottom - h} width={Math.max(1, bw)} height={h}
            rx={Math.min(3, bw / 3)} fill={fill} opacity={0.92} />
          {n <= 26 && (
            <text x={x + bw / 2} y={bottom - h - 5} textAnchor="middle" fontSize="9" fill={c.muted}>{v}</text>
          )}
          {i === minIdx && (
            <text x={x + bw / 2} y={top - 10} textAnchor="middle" fontSize="9" fill={c.series[4]}>最小</text>
          )}
        </g>
      );
    });
    return (
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} preserveAspectRatio="xMidYMid meet">
        <line x1="24" y1={bottom} x2={W - 24} y2={bottom} stroke={c.grid} strokeWidth="1" />
        {bars}
        <text x="24" y="284" fontSize="11" fill={c.muted}>
          {snap.done ? '全部有序' : (sortedFrom > 0
            ? `已就位 [0, ${sortedFrom - 1}] · 未排序 [${sortedFrom}, ${Math.max(0, n - 1)}]`
            : `尚未就位 · 全区间 [0, ${Math.max(0, n - 1)}]`)}
        </text>
        <text x={W - 24} y="284" fontSize="11" textAnchor="end" fill={c.muted}>时间 O(n²) · 空间 O(1) · 不稳定</text>
      </svg>
    );
  },
};
