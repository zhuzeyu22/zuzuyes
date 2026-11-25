import React from 'react';
import { makeArray, mulberry32, DIST_OPTIONS, PALETTE } from '../utils.js';

const W = 720, H = 320, CAP = 560;
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

const PIVOT_OPTIONS = [
  { value: 'first', label: '首元素' },
  { value: 'last', label: '末元素' },
  { value: 'mid', label: '中点' },
  { value: 'random', label: '随机' },
];
const PIVOT_LABEL = { first: '首元素', last: '末元素', mid: '中点', random: '随机' };

export default {
  id: 'quick-sort',
  params: [
    { key: 'n', label: '元素个数', type: 'range', min: 8, max: 36, step: 1, default: 18 },
    { key: 'dist', label: '初始分布', type: 'select', default: 'random', options: DIST_OPTIONS },
    { key: 'seed', label: '随机种子', type: 'range', min: 1, max: 30, step: 1, default: 7 },
    { key: 'select', label: '基准选择', type: 'select', default: 'mid', options: PIVOT_OPTIONS },
    { key: 'detail', label: '逐次比较明细', type: 'toggle', default: true, hint: '关闭后只记录分区关键帧' },
  ],
  height: H,
  legend: [
    { color: L.primary, label: '当前分区' },
    { color: L.danger, label: '基准' },
    { color: L.series[5], label: '左区边界 i' },
    { color: L.warning, label: '扫描指针 j' },
    { color: L.success, label: '已归位' },
  ],
  hint: '选基准把区间划成左右两半并递归，基准选择策略直接决定分区形态与递归深度。',

  buildSteps(p) {
    const a = makeArray(p.n, p.dist, p.seed);
    const n = a.length;
    const rnd = mulberry32(p.seed * 7919 + 13);
    const steps = [];
    const active = [];
    const placed = [];
    let comparisons = 0, swaps = 0;
    const strategy = p.select || 'mid';
    const push = (note, extra = {}) => steps.push({
      arr: [...a], stack: active.map((s) => ({ ...s })), placed: [...placed],
      lo: -1, hi: -1, pivotIdx: -1, i: -1, j: -1,
      depth: active.length, done: false, note,
      metrics: { 比较次数: comparisons, 交换次数: swaps, 递归深度: active.length, 基准归位: placed.length },
      ...extra,
    });
    const swap = (x, y) => {
      if (x === y) return false;
      const t = a[x]; a[x] = a[y]; a[y] = t; swaps++;
      return true;
    };
    const choosePivot = (lo, hi) => {
      if (strategy === 'first') return lo;
      if (strategy === 'last') return hi;
      if (strategy === 'random') return lo + Math.floor(rnd() * (hi - lo + 1));
      return (lo + hi) >> 1;
    };
    function quickSort(lo, hi, depth) {
      if (lo > hi) return;
      active.push({ lo, hi, depth });
      push(`进入分区 [${lo}, ${hi}]，递归深度 ${depth}。`, { lo, hi, depth });
      if (lo >= hi) {
        if (lo === hi) placed.push(lo);
        push(`区间 [${lo}, ${hi}] 长度不超过 1，直接返回。`, { lo, hi, depth });
        active.pop();
        return;
      }
      const pi = choosePivot(lo, hi);
      const pv = a[pi];
      push(`选择基准 ${pv}（位置 ${pi}，策略：${PIVOT_LABEL[strategy] || '中点'}）。`, {
        lo, hi, pivotIdx: pi, i: lo, j: lo, depth,
      });
      if (pi !== hi) {
        swap(pi, hi);
        push(`把基准交换到末尾位置 ${hi}，准备 Lomuto 分区。`, {
          lo, hi, pivotIdx: hi, i: lo, j: lo, depth, swapped: true,
        });
      }
      let i = lo;
      for (let j = lo; j < hi; j++) {
        comparisons++;
        if (p.detail) {
          push(`扫描 a[${j}] = ${a[j]}，与基准 ${pv} 比较。`, {
            lo, hi, pivotIdx: hi, i, j, depth,
          });
        }
        if (a[j] <= pv) {
          const didSwap = swap(i, j);
          push(`${a[i]} 不大于基准，划入左区（位置 ${i}）。`, {
            lo, hi, pivotIdx: hi, i, j, depth, swapped: didSwap,
          });
          i++;
        } else {
          push(`${a[j]} 大于基准，留在右区。`, {
            lo, hi, pivotIdx: hi, i, j, depth,
          });
        }
      }
      swap(i, hi);
      placed.push(i);
      push(`基准 ${pv} 归位到下标 ${i}：左区 [${lo}, ${i - 1}]，右区 [${i + 1}, ${hi}]。`, {
        lo, hi, pivotIdx: i, i: -1, j: -1, depth, pivotPlaced: true,
      });
      quickSort(lo, i - 1, depth + 1);
      quickSort(i + 1, hi, depth + 1);
      active.pop();
    }
    push(`初始数组共 ${n} 个元素，基准策略：${PIVOT_LABEL[strategy] || '中点'}。`);
    quickSort(0, n - 1, 0);
    push('快速排序完成，整个数组有序。', {
      done: true, lo: -1, hi: -1, pivotIdx: -1, i: -1, j: -1,
    });
    return finalize(steps);
  },

  render(snap, p, c) {
    const arr = snap.arr || [];
    const n = arr.length;
    const top = 62, bottom = 262;
    const gap = 2, bw = (W - 48) / Math.max(1, n) - gap;
    const max = Math.max(100, ...arr);
    const lo = snap.lo ?? -1, hi = snap.hi ?? -1;
    const pivotIdx = snap.pivotIdx ?? -1;
    const i = snap.i ?? -1, j = snap.j ?? -1;
    const stack = snap.stack || [];
    const placed = snap.placed || [];
    const shownStack = stack.slice(0, 7);
    const bars = arr.map((v, k) => {
      const h = (v / max) * (bottom - top);
      const x = 24 + k * (bw + gap);
      let fill = c.primary;
      if (snap.done || placed.includes(k)) fill = c.success;
      if (k >= lo && k <= hi && !snap.done && !placed.includes(k)) fill = c.primary;
      if (k === i && i >= 0) fill = c.series[5];
      if (k === j && j >= 0) fill = c.warning;
      if (k === pivotIdx && pivotIdx >= 0) fill = c.danger;
      return (
        <g key={k}>
          <rect x={x} y={bottom - h} width={Math.max(1, bw)} height={h}
            rx={Math.min(3, bw / 3)} fill={fill} opacity={0.92} />
          {n <= 26 && (
            <text x={x + bw / 2} y={bottom - h - 5} textAnchor="middle" fontSize="9" fill={c.muted}>{v}</text>
          )}
        </g>
      );
    });
    return (
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} preserveAspectRatio="xMidYMid meet">
        <text x="24" y="18" fontSize="10" fill={c.muted}>递归栈（自外到内）</text>
        {shownStack.map((s, k) => (
          <g key={k}>
            <rect x={24 + k * 92} y="26" width="86" height="24" rx="3"
              fill={c.panel} stroke={c.border} strokeWidth="1" />
            <text x={24 + k * 92 + 43} y="42" textAnchor="middle" fontSize="10" fill={c.text}>
              [{s.lo},{s.hi}] 深{s.depth}
            </text>
          </g>
        ))}
        {stack.length > 7 && (
          <text x={24 + 7 * 92} y="42" fontSize="10" fill={c.muted}>…+{stack.length - 7}</text>
        )}
        {lo >= 0 && hi >= lo && !snap.done && (
          <rect x={24 + lo * (bw + gap)} y={top - 4}
            width={(hi - lo + 1) * (bw + gap)} height={bottom - top + 4}
            fill={c.panel} opacity={0.55} />
        )}
        <line x1="24" y1={bottom} x2={W - 24} y2={bottom} stroke={c.grid} strokeWidth="1" />
        {bars}
        {i >= 0 && i < n && (
          <text x={24 + i * (bw + gap) + bw / 2} y={bottom + 14} textAnchor="middle" fontSize="9" fill={c.series[5]}>i</text>
        )}
        {j >= 0 && j < n && (
          <text x={24 + j * (bw + gap) + bw / 2} y={bottom + 14} textAnchor="middle" fontSize="9" fill={c.warning}>j</text>
        )}
        {pivotIdx >= 0 && pivotIdx < n && (
          <text x={24 + pivotIdx * (bw + gap) + bw / 2} y={top - 8} textAnchor="middle" fontSize="9" fill={c.danger}>基准</text>
        )}
        <text x="24" y="302" fontSize="11" fill={c.muted}>
          {snap.done ? '全部有序' : (lo >= 0
            ? `当前分区 [${lo}, ${hi}] · 基准值 ${pivotIdx >= 0 ? arr[pivotIdx] : '待选'} · 递归深度 ${stack.length}`
            : '准备分区')}
        </text>
        <text x={W - 24} y="302" fontSize="11" textAnchor="end" fill={c.muted}>平均 O(n log n) · 最坏 O(n²) · 不稳定</text>
      </svg>
    );
  },
};
