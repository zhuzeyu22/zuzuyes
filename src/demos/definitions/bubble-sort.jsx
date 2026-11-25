import React from 'react';
import { makeArray, DIST_OPTIONS, clamp } from '../utils.js';

const W = 720;

export default {
  id: 'bubble-sort',
  params: [
    { key: 'n', label: '元素个数', type: 'range', min: 6, max: 48, step: 1, default: 18 },
    { key: 'dist', label: '初始分布', type: 'select', default: 'random', options: DIST_OPTIONS },
    { key: 'seed', label: '随机种子', type: 'range', min: 1, max: 30, step: 1, default: 7 },
    { key: 'earlyStop', label: '提前终止优化', type: 'toggle', default: true, hint: '某轮无交换则立即结束' },
  ],
  height: 300,
  legend: [
    { color: '#226AFF', label: '待排序' },
    { color: '#f5a524', label: '正在比较' },
    { color: '#e5484d', label: '发生交换' },
    { color: '#12a06a', label: '已就位' },
  ],
  hint: '相邻两两比较，大的往后「冒泡」，每轮把当前最大值送到末尾。',

  buildSteps(p) {
    const a = makeArray(p.n, p.dist, p.seed);
    const steps = [];
    let comparisons = 0, swaps = 0, sortedFrom = a.length;
    const push = (note, extra = {}) => steps.push({
      arr: [...a], comparisons, swaps, sortedFrom, note,
      metrics: { 比较次数: comparisons, 交换次数: swaps, 已就位: a.length - sortedFrom },
      ...extra,
    });

    push('初始数组：从左到右扫描相邻元素。', { compare: [] });
    for (let i = 0; i < a.length - 1; i++) {
      let swapped = false;
      for (let j = 0; j < a.length - 1 - i; j++) {
        comparisons++;
        push(`比较第 ${j + 1} 与第 ${j + 2} 个元素：${a[j]} ${a[j] > a[j + 1] ? '>' : '≤'} ${a[j + 1]}`, { compare: [j, j + 1] });
        if (a[j] > a[j + 1]) {
          [a[j], a[j + 1]] = [a[j + 1], a[j]];
          swaps++; swapped = true;
          push('逆序，交换二者。', { compare: [j, j + 1], swapped: true });
        }
      }
      sortedFrom = a.length - 1 - i;
      push(`第 ${i + 1} 轮结束，最大值 ${a[sortedFrom]} 已就位。`, { compare: [] });
      if (p.earlyStop && !swapped) {
        for (let k = 0; k < sortedFrom; k++) { /* 剩余部分已有序 */ }
        sortedFrom = 0;
        push('本轮没有发生交换，说明整体已有序，提前终止。', { compare: [] });
        break;
      }
    }
    sortedFrom = 0;
    push('排序完成。', { compare: [], done: true, metrics: { 比较次数: comparisons, 交换次数: swaps, 已就位: a.length } });
    if (steps.length > 900) {
      const stride = Math.ceil(steps.length / 900);
      return steps.filter((_, i) => i % stride === 0 || i === steps.length - 1);
    }
    return steps;
  },

  render(snap, p, c) {
    const arr = snap.arr || [];
    const H = 300, top = 20, bottom = 270;
    const gap = 2, bw = (W - 40) / Math.max(1, arr.length) - gap;
    const max = Math.max(100, ...arr);
    const compare = snap.compare || [];
    return (
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} preserveAspectRatio="xMidYMid meet">
        <line x1="20" y1={bottom} x2={W - 20} y2={bottom} stroke={c.grid} strokeWidth="1" />
        {arr.map((v, i) => {
          const h = (v / max) * (bottom - top);
          const x = 20 + i * (bw + gap);
          let fill = c.primary;
          if (snap.done || i >= (snap.sortedFrom ?? arr.length)) fill = c.success;
          if (compare.includes(i)) fill = snap.swapped ? c.danger : c.warning;
          return (
            <g key={i}>
              <rect x={x} y={bottom - h} width={Math.max(1, bw)} height={h} rx={Math.min(3, bw / 3)} fill={fill} opacity={0.92} />
              {arr.length <= 26 && <text x={x + bw / 2} y={bottom - h - 5} textAnchor="middle" fontSize="9" fill={c.muted}>{v}</text>}
            </g>
          );
        })}
        <text x="20" y="290" fontSize="11" fill={c.muted}>
          {snap.done ? '全部有序' : `待排序区间 [0, ${Math.max(0, (snap.sortedFrom ?? arr.length) - 1)}]`}
        </text>
        <text x={W - 20} y="290" fontSize="11" textAnchor="end" fill={c.muted}>
          平均/最坏 O(n²) · 最好 O(n) · 空间 O(1) · 稳定
        </text>
      </svg>
    );
  },
};
