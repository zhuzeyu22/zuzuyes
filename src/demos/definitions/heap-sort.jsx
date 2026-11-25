import React from 'react';
import { makeArray, DIST_OPTIONS, PALETTE } from '../utils.js';

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
  id: 'heap-sort',
  params: [
    { key: 'n', label: '元素个数', type: 'range', min: 7, max: 31, step: 1, default: 15 },
    { key: 'dist', label: '初始分布', type: 'select', default: 'random', options: DIST_OPTIONS },
    { key: 'seed', label: '随机种子', type: 'range', min: 1, max: 30, step: 1, default: 7 },
    { key: 'detail', label: '记录下沉比较', type: 'toggle', default: true, hint: '关闭后只记录交换与关键帧' },
  ],
  height: H,
  legend: [
    { color: L.primary, label: '堆内节点' },
    { color: L.warning, label: '下沉比较' },
    { color: L.danger, label: '交换的两个节点' },
    { color: L.success, label: '已就位（升序后缀）' },
  ],
  hint: '把数组看成完全二叉树，先建大顶堆，再反复把堆顶最大值换到末尾并向下调整。',

  buildSteps(p) {
    const a = makeArray(p.n, p.dist, p.seed);
    const n = a.length;
    const steps = [];
    let comparisons = 0, swaps = 0;
    let heapSize = n, sortedFrom = n, phase = 'build';
    const push = (note, extra = {}) => steps.push({
      arr: [...a], n, heapSize, sortedFrom, phase,
      swapPair: [], comparePair: [], active: -1, done: false, note,
      metrics: { 比较次数: comparisons, 交换次数: swaps, 已就位: n - sortedFrom },
      ...extra,
    });
    const swap = (x, y) => { const t = a[x]; a[x] = a[y]; a[y] = t; swaps++; };
    function siftDown(root, size) {
      let cur = root;
      while (true) {
        const l = 2 * cur + 1, r = 2 * cur + 2;
        let largest = cur;
        if (l < size) {
          comparisons++;
          if (p.detail) {
            push(`比较节点 ${cur}（${a[cur]}）与左孩子 ${l}（${a[l]}）。`, {
              active: cur, comparePair: [cur, l], swapPair: [],
            });
          }
          if (a[l] > a[largest]) largest = l;
        }
        if (r < size) {
          comparisons++;
          if (p.detail) {
            push(`比较节点 ${largest}（${a[largest]}）与右孩子 ${r}（${a[r]}）。`, {
              active: cur, comparePair: [largest, r], swapPair: [],
            });
          }
          if (a[r] > a[largest]) largest = r;
        }
        if (largest === cur) {
          push(`节点 ${cur} 已满足堆性质，本次下沉结束。`, {
            active: cur, comparePair: [], swapPair: [],
          });
          break;
        }
        const bigVal = a[largest], smallVal = a[cur];
        swap(cur, largest);
        push(`交换节点 ${cur}（${smallVal}）与 ${largest}（${bigVal}），继续向下调整。`, {
          active: largest, comparePair: [], swapPair: [cur, largest],
        });
        cur = largest;
      }
    }
    push(`初始数组共 ${n} 个元素，准备建立大顶堆。`);
    for (let i = Math.floor(n / 2) - 1; i >= 0; i--) {
      push(`建堆：从最后一个非叶节点 ${i} 开始下沉调整。`, {
        active: i, comparePair: [], swapPair: [],
      });
      siftDown(i, n);
    }
    push('大顶堆建立完成，堆顶为全局最大值。', {
      active: 0, comparePair: [], swapPair: [],
    });
    phase = 'sort';
    for (let end = n - 1; end > 0; end--) {
      const topVal = a[0];
      swap(0, end);
      heapSize = end;
      sortedFrom = end;
      push(`把堆顶最大值 ${topVal} 与末尾位置 ${end} 交换，${topVal} 已就位。`, {
        active: 0, comparePair: [], swapPair: [0, end],
      });
      siftDown(0, end);
    }
    sortedFrom = 0; heapSize = 0; phase = 'done';
    push('堆排序完成，整个数组升序有序。', {
      done: true, active: -1, comparePair: [], swapPair: [],
    });
    return finalize(steps);
  },

  render(snap, p, c) {
    const arr = snap.arr || [];
    const n = snap.n || arr.length || 1;
    const heapSize = snap.heapSize ?? n;
    const sortedFrom = snap.sortedFrom ?? n;
    const swapPair = snap.swapPair || [];
    const comparePair = snap.comparePair || [];
    const active = snap.active ?? -1;
    const ax = 24, atop = 46, abottom = 280, aw = 316;
    const agap = 1, abw = aw / Math.max(1, n) - agap;
    const amax = Math.max(100, ...arr);
    const arrBars = arr.map((v, i) => {
      const h = (v / amax) * (abottom - atop);
      const x = ax + i * (abw + agap);
      let fill = c.primary;
      if (i >= heapSize) fill = c.success;
      if (comparePair.includes(i)) fill = c.warning;
      if (swapPair.includes(i)) fill = c.danger;
      return (
        <g key={i}>
          <rect x={x} y={abottom - h} width={Math.max(1, abw)} height={h}
            rx={Math.min(2, abw / 3)} fill={fill} opacity={0.92} />
        </g>
      );
    });
    const px = 360, pw = 330;
    const levelCount = Math.max(1, Math.ceil(Math.log2(n + 1)));
    const nodeR = n <= 15 ? 12 : 9;
    const levelGap = levelCount > 1 ? Math.min(52, 200 / (levelCount - 1)) : 0;
    const treeTop = 66;
    const pos = (idx) => {
      const d = Math.floor(Math.log2(idx + 1));
      const cnt = Math.pow(2, d);
      const within = idx - (cnt - 1);
      return { x: px + (within + 0.5) * (pw / cnt), y: treeTop + d * levelGap };
    };
    const edges = [];
    for (let i = 1; i < heapSize; i++) {
      const parent = (i - 1) >> 1;
      const a1 = pos(parent), a2 = pos(i);
      edges.push(
        <line key={`e${i}`} x1={a1.x} y1={a1.y} x2={a2.x} y2={a2.y}
          stroke={c.border} strokeWidth="1" />
      );
    }
    const nodes = [];
    for (let i = 0; i < heapSize; i++) {
      const pp = pos(i);
      let col = c.primary;
      if (i === active) col = c.warning;
      if (comparePair.includes(i)) col = c.warning;
      if (swapPair.includes(i)) col = c.danger;
      nodes.push(
        <g key={`n${i}`}>
          <circle cx={pp.x} cy={pp.y} r={nodeR} fill={c.panel}
            stroke={col} strokeWidth={swapPair.includes(i) ? 2.5 : 1.4} />
          <text x={pp.x} y={pp.y + 3} textAnchor="middle"
            fontSize="9" fill={col}>{arr[i]}</text>
        </g>
      );
    }
    return (
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} preserveAspectRatio="xMidYMid meet">
        <text x={ax} y="30" fontSize="11" fill={c.muted}>数组视角</text>
        <text x={px} y="30" fontSize="11" fill={c.muted}>二叉树堆结构</text>
        <rect x={ax} y={atop} width={Math.max(0, heapSize * (abw + agap))} height={abottom - atop}
          fill={c.panel} opacity={0.5} />
        <line x1={ax} y1={abottom} x2={ax + aw} y2={abottom} stroke={c.grid} strokeWidth="1" />
        {arrBars}
        {edges}
        {nodes}
        <text x={px} y={H - 46} fontSize="10" fill={c.muted}>
          {`堆大小 ${heapSize} · 已就位 ${n - heapSize} 个 · ${snap.phase === 'build' ? '建堆阶段' : '排序阶段'}`}
        </text>
        <text x="24" y="322" fontSize="11" fill={c.muted}>
          {snap.done ? '全部有序' : `堆顶 ${arr[0] ?? '-'} · 交换 ${swapPair.length ? `${swapPair[0]}↔${swapPair[1]}` : '无'}`}
        </text>
        <text x={W - 24} y="322" fontSize="11" textAnchor="end" fill={c.muted}>时间 O(n log n) · 空间 O(1) · 不稳定</text>
      </svg>
    );
  },
};
