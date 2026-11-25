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
  id: 'insertion-sort',
  params: [
    { key: 'n', label: '元素个数', type: 'range', min: 6, max: 40, step: 1, default: 16 },
    { key: 'dist', label: '初始分布', type: 'select', default: 'random', options: DIST_OPTIONS },
    { key: 'seed', label: '随机种子', type: 'range', min: 1, max: 30, step: 1, default: 7 },
    { key: 'detail', label: '逐步展示后移', type: 'toggle', default: true, hint: '关闭后每轮只记录关键帧' },
  ],
  height: H,
  legend: [
    { color: L.series[2], label: '已排序前缀' },
    { color: L.warning, label: '抽出的元素' },
    { color: L.series[5], label: '逐位后移' },
    { color: L.danger, label: '空位 / 写回' },
    { color: L.success, label: '已完成' },
  ],
  hint: '把每个元素当作「抽出的牌」，在已排序前缀中从右往左比较并后移，找到位置后插入。',

  buildSteps(p) {
    const a = makeArray(p.n, p.dist, p.seed);
    const n = a.length;
    const steps = [];
    let comparisons = 0, shifts = 0, sortedEnd = 1;
    const push = (note, extra = {}) => steps.push({
      arr: [...a], keyVal: null, keyFrom: -1, hole: -1, sortedEnd,
      insertAt: -1, compare: [], shifting: false, done: false,
      note,
      metrics: { 比较次数: comparisons, 后移次数: shifts, 已排序前缀: sortedEnd },
      ...extra,
    });
    push(`初始数组共 ${n} 个元素，第一个元素单独视为已排序前缀。`);
    for (let i = 1; i < n; i++) {
      const key = a[i];
      let j = i - 1;
      sortedEnd = i;
      push(`抽出位置 ${i} 的元素 ${key}，在前缀 [0, ${i - 1}] 中寻找插入位置。`, {
        keyVal: key, keyFrom: i, hole: i, sortedEnd,
      });
      while (j >= 0) {
        comparisons++;
        push(`比较前缀元素 ${a[j]}（位置 ${j}）与抽出的 ${key}。`, {
          keyVal: key, keyFrom: i, hole: j + 1, sortedEnd, compare: [j, j + 1],
        });
        if (a[j] > key) {
          if (p.detail) {
            push(`${a[j]} 大于 ${key}，把它右移一位到位置 ${j + 1}。`, {
              keyVal: key, keyFrom: i, hole: j + 1, sortedEnd, compare: [j], shifting: true,
            });
          }
          a[j + 1] = a[j];
          shifts++;
          push(`后移完成：位置 ${j + 1} 现在是 ${a[j + 1]}，空位在 ${j}。`, {
            keyVal: key, keyFrom: i, hole: j, sortedEnd, compare: [j], shifting: true,
          });
          j--;
        } else {
          break;
        }
      }
      if (j >= 0) {
        push(`${a[j]} 不大于 ${key}，插入位置确定为 ${j + 1}。`, {
          keyVal: key, keyFrom: i, hole: j + 1, sortedEnd, compare: [j],
        });
      } else {
        push('已到数组开头，插入位置确定为 0。', {
          keyVal: key, keyFrom: i, hole: 0, sortedEnd,
        });
      }
      a[j + 1] = key;
      sortedEnd = i + 1;
      push(`把抽出的 ${key} 写回位置 ${j + 1}，前缀扩展为 [0, ${i}]。`, {
        keyVal: null, keyFrom: -1, hole: -1, sortedEnd, insertAt: j + 1,
      });
    }
    sortedEnd = n;
    push('插入排序完成，整个数组有序。', { done: true, sortedEnd, hole: -1, keyVal: null });
    return finalize(steps);
  },

  render(snap, p, c) {
    const arr = snap.arr || [];
    const n = arr.length;
    const top = 34, bottom = 260;
    const gap = 2, bw = (W - 48) / Math.max(1, n) - gap;
    const max = Math.max(100, ...arr);
    const sortedEnd = snap.sortedEnd ?? 0;
    const hole = snap.hole ?? -1;
    const compare = snap.compare || [];
    const keyVal = snap.keyVal;
    const insertAt = snap.insertAt ?? -1;
    const bars = arr.map((v, i) => {
      const h = (v / max) * (bottom - top);
      const x = 24 + i * (bw + gap);
      const isHole = i === hole;
      let fill = c.primary;
      if (snap.done) fill = c.success;
      else if (i < sortedEnd) fill = c.series[2];
      if (snap.shifting && compare.includes(i)) fill = c.series[5];
      if (i === insertAt && !snap.done) fill = c.success;
      return (
        <g key={i}>
          <rect x={x} y={bottom - h} width={Math.max(1, bw)} height={h}
            rx={Math.min(3, bw / 3)} fill={isHole ? c.panel : fill}
            stroke={isHole ? c.danger : 'none'} strokeWidth={isHole ? 1.5 : 0}
            strokeDasharray={isHole ? '3 2' : undefined} opacity={isHole ? 1 : 0.92} />
          {n <= 26 && !isHole && (
            <text x={x + bw / 2} y={bottom - h - 5} textAnchor="middle" fontSize="9" fill={c.muted}>{v}</text>
          )}
          {isHole && (
            <text x={x + bw / 2} y={bottom - 6} textAnchor="middle" fontSize="9" fill={c.danger}>空位</text>
          )}
        </g>
      );
    });
    const floatBar = keyVal !== null && keyVal !== undefined && hole >= 0;
    const floatX = floatBar ? 24 + hole * (bw + gap) : 24;
    const floatBottom = floatBar ? bottom - (keyVal / max) * (bottom - top) : bottom;
    return (
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} preserveAspectRatio="xMidYMid meet">
        <line x1="24" y1={bottom} x2={W - 24} y2={bottom} stroke={c.grid} strokeWidth="1" />
        {sortedEnd > 0 && sortedEnd < n && !snap.done && (
          <line x1={24 + (sortedEnd - 0.5) * (bw + gap)} y1={top - 6}
            x2={24 + (sortedEnd - 0.5) * (bw + gap)} y2={bottom}
            stroke={c.border} strokeWidth="1" strokeDasharray="4 3" />
        )}
        {bars}
        {floatBar && (
          <g>
            <rect x={floatX} y="10" width={Math.max(1, bw)} height="16" rx="2" fill={c.warning} />
            <text x={floatX + bw / 2} y="22" textAnchor="middle" fontSize="9" fill={c.text}>{keyVal}</text>
            <line x1={floatX + bw / 2} y1="26" x2={floatX + bw / 2} y2={floatBottom}
              stroke={c.warning} strokeWidth="1" strokeDasharray="2 2" />
          </g>
        )}
        <text x="24" y="284" fontSize="11" fill={c.muted}>
          {snap.done ? '全部有序' : `已排序前缀 [0, ${Math.max(0, sortedEnd - 1)}] · 抽出元素 ${floatBar ? keyVal : '无'}`}
        </text>
        <text x={W - 24} y="284" fontSize="11" textAnchor="end" fill={c.muted}>最好 O(n) · 最坏 O(n²) · 稳定</text>
      </svg>
    );
  },
};
