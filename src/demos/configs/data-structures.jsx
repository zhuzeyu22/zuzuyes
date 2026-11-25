import React from 'react';
import { mulberry32, makeArray, PALETTE } from '../utils.js';
import {
  Frame, Bars, Cells, Matrix, Curves, GraphView, Scatter, Flow,
  Timeline, TextPanel, Radial, HeatBars, stateColor, num, fmt,
} from '../kits/primitives.jsx';

const H = 320;
const L = PALETTE.light;

// 统一收尾：保证帧数落在 20~600，且首帧前补的帧不会挤掉中间的有效画面。
function finalize(steps, cap = 600) {
  let out = steps;
  if (out.length > cap) {
    const stride = Math.ceil(out.length / cap);
    out = out.filter((_, i) => i % stride === 0 || i === steps.length - 1);
    if (out.length > cap) out = out.slice(-cap);
  }
  let guard = 0;
  while (out.length < 20 && guard++ < 80) {
    const first = out[0] || { note: '准备开始' };
    out.splice(1, 0, { ...first, note: `准备：${first.note || '即将开始'}` });
  }
  return out;
}

// 二叉树布局：按中序序号铺开 x，按深度铺开 y，供 GraphView 直接使用。
function treeGraph(root) {
  const list = [];
  (function collect(n, depth) {
    if (!n) return;
    collect(n.left, depth + 1);
    list.push({ n, depth });
    collect(n.right, depth + 1);
  })(root, 0);
  const total = Math.max(1, list.length);
  const nodes = list.map((it, i) => ({
    id: String(it.n.key),
    x: total === 1 ? 0.5 : 0.06 + (0.88 * i) / (total - 1),
    y: 0.12 + it.depth * 0.18,
    label: String(it.n.label === undefined ? it.n.key : it.n.label),
    sub: it.n.sub === undefined ? undefined : String(it.n.sub),
    state: it.n.state || 'idle',
    color: it.n.color,
    r: it.n.r || 13,
  }));
  const edges = [];
  list.forEach((it) => {
    [it.n.left, it.n.right].forEach((k) => {
      if (k) edges.push({
        from: String(it.n.key), to: String(k.key),
        state: (it.n.state === 'active' || k.state === 'active') ? 'active' : 'idle',
      });
    });
  });
  return { nodes, edges };
}

function cloneTree(n) {
  if (!n) return null;
  return {
    key: n.key, label: n.label, state: n.state, color: n.color, sub: n.sub,
    height: n.height, left: cloneTree(n.left), right: cloneTree(n.right),
  };
}

// B 树：每个节点是一组键，children 为子节点数组。
function bTreeGraph(root) {
  const list = [];
  (function walk(n, d) {
    if (!n) return;
    list.push({ n, d });
    (n.children || []).forEach((ch) => { if (ch) walk(ch, d + 1); });
  })(root, 0);
  const total = Math.max(1, list.length);
  const idOf = new Map();
  list.forEach((it, i) => idOf.set(it.n, `b${i}`));
  const nodes = list.map((it, i) => ({
    id: idOf.get(it.n),
    x: total === 1 ? 0.5 : 0.06 + (0.88 * i) / (total - 1),
    y: 0.14 + it.d * 0.22,
    label: (it.n.keys || []).map((k) => String(k)).join(' | '),
    sub: `${(it.n.keys || []).length} 键`,
    state: it.n.state || 'idle',
    color: it.n.color,
    r: 18,
  }));
  const edges = [];
  list.forEach((it) => {
    (it.n.children || []).forEach((ch) => {
      if (ch) edges.push({ from: idOf.get(it.n), to: idOf.get(ch), state: 'idle' });
    });
  });
  return { nodes, edges };
}

// Trie：节点以字符为标签，路径字符串作为稳定 id。
function trieGraph(root) {
  const list = [];
  (function walk(n, d) {
    if (!n) return;
    list.push({ n, d });
    Object.keys(n.children || {}).forEach((ch) => walk(n.children[ch], d + 1));
  })(root, 0);
  const total = Math.max(1, list.length);
  const idOf = new Map();
  list.forEach((it, i) => idOf.set(it.n, `t${i}`));
  const nodes = list.map((it, i) => ({
    id: idOf.get(it.n),
    x: total === 1 ? 0.5 : 0.04 + (0.92 * i) / (total - 1),
    y: 0.1 + it.d * 0.17,
    label: String(it.n.ch === undefined ? '根' : it.n.ch),
    sub: it.n.terminal ? '词尾' : undefined,
    state: it.n.state || 'idle',
    r: 12,
  }));
  const edges = [];
  list.forEach((it) => {
    Object.keys(it.n.children || {}).forEach((ch) => {
      const kid = it.n.children[ch];
      edges.push({
        from: idOf.get(it.n), to: idOf.get(kid),
        state: kid.state === 'active' ? 'active' : 'idle',
        label: ch,
      });
    });
  });
  return { nodes, edges };
}

export default {
  // ---------------------------------------------------------------- 动态数组
  'array-list': {
    params: [
      { key: 'initCap', label: '初始容量', type: 'range', min: 2, max: 6, step: 1, default: 4 },
      { key: 'addCount', label: '追加元素数', type: 'range', min: 8, max: 18, step: 1, default: 12 },
      { key: 'factor', label: '扩容倍数', type: 'select', default: '2',
        options: [{ value: '2', label: '2 倍' }, { value: '1.5', label: '1.5 倍' }] },
      { key: 'seed', label: '随机种子', type: 'range', min: 1, max: 30, step: 1, default: 7 },
    ],
    height: H,
    legend: [
      { color: L.primary, label: '有效元素' },
      { color: L.success, label: '新写入位置' },
      { color: L.warning, label: '扩容搬迁中' },
      { color: L.muted, label: '空闲容量' },
    ],
    hint: '向连续数组尾部追加：容量耗尽时申请更大的 backing array，逐个复制旧元素，再写入新值；均摊每次追加 O(1)。',

    buildSteps(p) {
      const cap0 = p.initCap;
      const N = p.addCount;
      const fac = Number(p.factor) || 2;
      const rnd = mulberry32((p.seed || 7) * 131 + 17);
      const vals = Array.from({ length: N }, () => 10 + Math.floor(rnd() * 90));
      let cap = cap0;
      let arr = new Array(cap).fill(null);
      let size = 0, growths = 0, copies = 0;
      const steps = [];
      const snap = (note, extra = {}) => steps.push({
        arr: arr.map((v) => (v === null ? null : { v })),
        capacity: cap, size, growths, copies,
        active: -1, phase: 'append', note,
        metrics: { 元素数: size, 容量: cap, 扩容次数: growths, 复制次数: copies },
        ...extra,
      });
      snap(`初始化容量 ${cap} 的空数组，准备追加 ${N} 个元素。`);
      for (let i = 0; i < N; i++) {
        const v = vals[i];
        if (size === cap) {
          const oldCap = cap;
          cap = Math.max(size + 1, Math.floor(cap * fac));
          growths++;
          snap(`数组已满（容量 ${oldCap}），申请新容量 ${cap}，开始搬迁。`, { phase: 'resize', oldCap });
          const old = arr.slice();
          const next = new Array(cap).fill(null);
          for (let k = 0; k < size; k++) {
            next[k] = old[k];
            arr = next.slice();
            copies++;
            snap(`复制旧下标 ${k} 的元素 ${String(old[k])} 到新数组下标 ${k}。`, { phase: 'copy', active: k });
          }
          arr = next;
          snap(`搬迁完成，旧数组被释放，容量变为 ${cap}。`, { phase: 'resize' });
        }
        arr[size] = v;
        snap(`追加元素 ${v} 到下标 ${size}，元素数变为 ${size + 1}。`, { phase: 'append', active: size });
        size++;
      }
      for (let t = 0; t < 6; t++) {
        const idx = Math.floor(rnd() * size);
        snap(`按索引随机访问 arr[${idx}]，连续内存可直接定位到元素 ${String(arr[idx] && arr[idx].v)}。`, { phase: 'get', active: idx });
      }
      snap(`追加结束：${String(size)} 个元素，容量 ${String(cap)}，扩容 ${String(growths)} 次，复制 ${String(copies)} 次。`, { phase: 'done', active: -1 });
      return finalize(steps);
    },

    render(snap, p, c) {
      const arr = Array.isArray(snap.arr) ? snap.arr : [];
      const cap = Math.max(1, num(snap.capacity, p.initCap || 4));
      const size = num(snap.size, 0);
      const active = num(snap.active, -1);
      const phase = String(snap.phase || 'append');
      const cw = Math.min(44, 660 / cap);
      const x0 = 30;
      const slots = [];
      for (let i = 0; i < cap; i++) {
        const filled = i < size && arr[i] != null;
        const x = x0 + i * cw;
        let col = filled ? c.primary : c.border;
        if (i === active) col = phase === 'copy' ? c.warning : c.success;
        slots.push(
          <g key={`s${i}`}>
            <rect x={x} y="96" width={cw - 3} height="46" rx="3"
              fill={filled ? col : c.panel} opacity={filled ? 0.85 : 0.55}
              stroke={col} strokeWidth={i === active ? 2.2 : 1} />
            <text x={x + (cw - 3) / 2} y="124" textAnchor="middle"
              fontSize={cw < 26 ? 8 : 10} fill={filled ? c.bg : c.muted}>
              {String(filled ? arr[i].v : '—')}
            </text>
            <text x={x + (cw - 3) / 2} y={96 + 46 + 14} textAnchor="middle" fontSize="9" fill={c.muted}>
              {String(i)}
            </text>
          </g>
        );
      }
      const fillRatio = Math.min(1, size / cap);
      return (
        <Frame c={c} height={H} title="动态数组：追加、扩容与复制"
          subtitle={`size ${String(size)} / capacity ${String(cap)} · 扩容 ${String(snap.growths || 0)} 次`}>
          <text x="30" y="48" fontSize="11" fill={c.muted}>占用率</text>
          <rect x="92" y="38" width="420" height="14" rx="4" fill={c.panel} stroke={c.border} />
          <rect x="92" y="38" width={Math.max(1, 420 * fillRatio)} height="14" rx="4" fill={c.primary} opacity="0.85" />
          <text x="524" y="49" fontSize="10" fill={c.muted}>{`${String(size)} / ${String(cap)}`}</text>
          <text x="30" y="82" fontSize="11" fill={c.muted}>backing array（格子下标）</text>
          {slots}
          <text x="30" y="184" fontSize="11" fill={c.muted}>
            {phase === 'copy' || phase === 'resize'
              ? `搬迁中：把旧数组元素复制到容量为 ${String(cap)} 的新数组`
              : (phase === 'get' ? '随机访问：按下标一次定位，O(1)' : '尾部追加：若容量不足则先扩容')}
          </text>
          <text x="30" y="208" fontSize="11" fill={c.text}>
            {`累计复制 ${String(snap.copies || 0)} 次 · 均摊追加 O(1) · 访问 O(1)`}
          </text>
        </Frame>
      );
    },
  },

  // ---------------------------------------------------------------- 链表
  'linked-list': {
    params: [
      { key: 'ops', label: '操作次数', type: 'range', min: 6, max: 14, step: 1, default: 10 },
      { key: 'seed', label: '随机种子', type: 'range', min: 1, max: 30, step: 1, default: 7 },
      { key: 'mode', label: '主要操作', type: 'select', default: 'mixed',
        options: [{ value: 'mixed', label: '混合' }, { value: 'insert', label: '偏插入' }, { value: 'delete', label: '偏删除' }] },
    ],
    height: H,
    legend: [
      { color: L.primary, label: '普通节点' },
      { color: L.success, label: '头节点 head' },
      { color: L.warning, label: '当前遍历/插入位置' },
    ],
    hint: '节点靠 next 指针串联：表头插入 O(1)，按位置查找需从头沿指针遍历，删除时把前驱的 next 接到后继。',

    buildSteps(p) {
      const N = p.ops;
      const rnd = mulberry32((p.seed || 7) * 97 + 13);
      const mode = String(p.mode || 'mixed');
      let list = [];
      const steps = [];
      const snap = (note, extra = {}) => {
        const active = num(extra.active, -1);
        const nodes = list.map((v, i) => ({
          id: String(i), x: list.length <= 1 ? 0.5 : 0.08 + (0.84 * i) / (list.length - 1),
          y: 0.5, label: String(v), r: 14,
          state: i === active ? 'active' : (i === 0 ? 'done' : 'idle'),
          sub: i === 0 ? 'head' : (i === list.length - 1 ? 'tail' : ''),
        }));
        const edges = [];
        for (let i = 0; i < list.length - 1; i++) {
          edges.push({ from: String(i), to: String(i + 1), label: 'next', state: i + 1 === active ? 'active' : 'idle' });
        }
        steps.push({
          list: [...list], nodes, edges, head: 0, tail: list.length - 1, active,
          note, metrics: { 节点数: list.length, head: 0, tail: list.length - 1 },
          ...extra,
        });
      };
      snap('初始化空链表，head 与 tail 均为空。', { active: -1 });
      for (let t = 0; t < N; t++) {
        const v = 10 + Math.floor(rnd() * 90);
        let op = t % 3;
        if (mode === 'insert') op = t % 2;
        if (mode === 'delete') op = (list.length > 2) ? 2 : 0;
        if (op === 0) {
          snap(`表头插入 ${v}：先让新节点 next 指向原 head。`, { active: 0 });
          list.unshift(v);
          snap(`head 指向新节点 ${v}，链表长度为 ${String(list.length)}。`, { active: 0 });
        } else if (op === 1) {
          snap(`尾部插入 ${v}：从 head 沿 next 指针遍历到末尾。`, { active: 0 });
          for (let i = 0; i < list.length; i++) snap(`沿指针访问节点 ${String(list[i])}（下标 ${String(i)}）。`, { active: i });
          list.push(v);
          snap(`原尾节点 next 指向 ${v}，tail 更新为下标 ${String(list.length - 1)}。`, { active: list.length - 1 });
        } else {
          const idx = 1 + Math.floor(rnd() * Math.max(1, list.length - 1));
          snap(`删除下标 ${String(idx)} 的节点：从头遍历寻找前驱。`, { active: 0 });
          for (let i = 0; i <= idx && i < list.length; i++) snap(`比较节点 ${String(list[i])}，继续沿 next 前进。`, { active: i });
          const removed = list.splice(idx, 1)[0];
          snap(`摘除节点 ${String(removed)}，前驱 next 改接后继。`, { active: Math.min(idx, list.length - 1) });
        }
      }
      snap(`链表操作结束：共 ${String(list.length)} 个节点。`, { active: -1 });
      return finalize(steps);
    },

    render(snap, p, c) {
      return (
        <GraphView c={c} nodes={snap.nodes || []} edges={snap.edges || []} height={H} directed
          title="链表：next 指针与 head/tail 移动"
          subtitle={`head→${String(snap.head || 0)} · tail→${String(snap.tail || 0)} · 节点 ${String((snap.list || []).length)}`} />
      );
    },
  },

  // ---------------------------------------------------------------- 栈
  stack: {
    params: [
      { key: 'pushCount', label: '入栈次数', type: 'range', min: 8, max: 16, step: 1, default: 12 },
      { key: 'popCount', label: '出栈次数', type: 'range', min: 4, max: 8, step: 1, default: 6 },
      { key: 'seed', label: '随机种子', type: 'range', min: 1, max: 30, step: 1, default: 7 },
    ],
    height: H,
    legend: [
      { color: L.primary, label: '栈内元素' },
      { color: L.warning, label: '栈顶 top' },
      { color: L.danger, label: '刚弹出的元素' },
    ],
    hint: '栈遵守后进先出（LIFO）：入栈把元素压到 top，出栈只能从 top 弹出，常用于函数调用与括号匹配。',

    buildSteps(p) {
      const P = p.pushCount, Q = p.popCount;
      const rnd = mulberry32((p.seed || 7) * 59 + 29);
      const stack = [];
      const steps = [];
      let pushes = 0, pops = 0;
      const snap = (note, extra = {}) => {
        const items = stack.slice().reverse().map((v, i) => ({
          label: String(v), sub: i === 0 ? 'top' : (i === stack.length - 1 ? 'bottom' : ''),
          state: i === 0 ? 'warning' : 'primary',
        }));
        steps.push({
          stack: [...stack], items, activeIndex: 0, pushes, pops, note,
          metrics: { 栈深度: stack.length, 入栈: pushes, 出栈: pops, 栈顶: stack.length ? stack[stack.length - 1] : 0 },
          ...extra,
        });
      };
      snap('初始化空栈，top = -1。', { items: [], activeIndex: -1 });
      for (let i = 0; i < P; i++) {
        const v = 10 + Math.floor(rnd() * 90);
        snap(`准备入栈 ${v}：top 将上移一格。`, { phase: 'before' });
        stack.push(v); pushes++;
        snap(`元素 ${v} 入栈，成为新的栈顶，深度 ${String(stack.length)}。`, { phase: 'push' });
      }
      for (let i = 0; i < Q; i++) {
        const v = stack[stack.length - 1];
        snap(`准备出栈：当前栈顶是 ${String(v)}。`, { phase: 'before' });
        stack.pop(); pops++;
        snap(`弹出 ${String(v)}，top 下移，深度 ${String(stack.length)}。`, { phase: 'pop' });
      }
      snap(`操作结束：入栈 ${String(pushes)} 次，出栈 ${String(pops)} 次。`);
      return finalize(steps);
    },

    render(snap, p, c) {
      return (
        <Flow c={c} vertical items={snap.items || []} activeIndex={num(snap.activeIndex, -1)} height={H}
          title="栈：后进先出（LIFO）" subtitle={`深度 ${String((snap.stack || []).length)} · 入栈 ${String(snap.pushes || 0)} · 出栈 ${String(snap.pops || 0)}`} />
      );
    },
  },

  // ---------------------------------------------------------------- 队列
  queue: {
    params: [
      { key: 'enq', label: '入队次数', type: 'range', min: 6, max: 14, step: 1, default: 10 },
      { key: 'deq', label: '出队次数', type: 'range', min: 4, max: 10, step: 1, default: 6 },
      { key: 'seed', label: '随机种子', type: 'range', min: 1, max: 30, step: 1, default: 7 },
    ],
    height: H,
    legend: [
      { color: L.primary, label: '队列元素' },
      { color: L.success, label: '队头 head' },
      { color: L.warning, label: '刚入队元素' },
    ],
    hint: '队列遵守先进先出（FIFO）：新元素从队尾入队，出队总从队头取走，是 BFS 与任务缓冲的基础。',

    buildSteps(p) {
      const A = p.enq, B = p.deq;
      const rnd = mulberry32((p.seed || 7) * 71 + 41);
      const q = [];
      const steps = [];
      let enqCount = 0, deqCount = 0;
      const snap = (note, extra = {}) => {
        const items = q.map((v, i) => ({
          label: String(v), sub: i === 0 ? 'head' : (i === q.length - 1 ? 'tail' : ''),
          state: i === 0 ? 'done' : 'primary',
        }));
        steps.push({
          queue: [...q], items, head: 0, tail: Math.max(0, q.length - 1),
          enqCount, deqCount, note,
          metrics: { 队列长度: q.length, 入队: enqCount, 出队: deqCount, 队头: q.length ? q[0] : 0 },
          ...extra,
        });
      };
      snap('初始化空队列，head = tail = 0。', { items: [], activeIndex: -1 });
      for (let i = 0; i < A; i++) {
        const v = 10 + Math.floor(rnd() * 90);
        snap(`元素 ${v} 准备从队尾入队。`, { phase: 'before' });
        q.push(v); enqCount++;
        snap(`${v} 入队，tail 后移到下标 ${String(q.length - 1)}。`, { phase: 'enqueue', activeIndex: q.length - 1 });
      }
      for (let i = 0; i < B; i++) {
        const v = q[0];
        snap(`准备出队：队头元素为 ${String(v)}。`, { phase: 'before', activeIndex: 0 });
        q.shift(); deqCount++;
        snap(`队头 ${String(v)} 出队，head 后移，队列长度 ${String(q.length)}。`, { phase: 'dequeue' });
      }
      snap(`操作结束：入队 ${String(enqCount)} 次，出队 ${String(deqCount)} 次。`);
      return finalize(steps);
    },

    render(snap, p, c) {
      const items = snap.items || [];
      return (
        <Flow c={c} items={items} activeIndex={num(snap.activeIndex, -1)} height={H}
          title="队列：先进先出（FIFO）"
          subtitle={`长度 ${String((snap.queue || []).length)} · head→${String(snap.head || 0)} · tail→${String(snap.tail || 0)}`} />
      );
    },
  },

  // ---------------------------------------------------------------- 双端队列
  deque: {
    params: [
      { key: 'ops', label: '操作次数', type: 'range', min: 8, max: 16, step: 1, default: 12 },
      { key: 'seed', label: '随机种子', type: 'range', min: 1, max: 30, step: 1, default: 7 },
      { key: 'window', label: '保留最近元素数', type: 'range', min: 3, max: 8, step: 1, default: 5 },
    ],
    height: H,
    legend: [
      { color: L.primary, label: '队列元素' },
      { color: L.success, label: 'front 端' },
      { color: L.warning, label: 'back 端' },
      { color: L.danger, label: '被弹出的元素' },
    ],
    hint: '双端队列两端都能进出：pushFront / pushBack / popFront / popBack，滑动窗口单调队列就建立在它之上。',

    buildSteps(p) {
      const N = p.ops, win = p.window;
      const rnd = mulberry32((p.seed || 7) * 83 + 53);
      const dq = [];
      const steps = [];
      const snap = (note, extra = {}) => {
        const items = dq.map((v, i) => ({
          label: String(v), sub: i === 0 ? 'front' : (i === dq.length - 1 ? 'back' : ''),
          state: i === 0 ? 'done' : (i === dq.length - 1 ? 'warning' : 'primary'),
        }));
        steps.push({
          deque: [...dq], items, front: 0, back: Math.max(0, dq.length - 1),
          note, metrics: { 元素数: dq.length, front: 0, back: Math.max(0, dq.length - 1) },
          ...extra,
        });
      };
      snap('初始化空双端队列。', { items: [], activeIndex: -1 });
      for (let t = 0; t < N; t++) {
        const v = 10 + Math.floor(rnd() * 90);
        let op = t % 4;
        // 元素很少时把出队改为入队，避免窗口提前清空导致画面重复。
        if ((op === 2 || op === 3) && dq.length <= 2) op = t % 2;
        if (op === 0) {
          snap(`pushFront(${v})：新元素将占据 front 端。`, { phase: 'choose' });
          dq.unshift(v);
          snap(`${v} 从前端入队，front 指向下标 0。`, { phase: 'pushFront', activeIndex: 0 });
        } else if (op === 1) {
          snap(`pushBack(${v})：新元素将占据 back 端。`, { phase: 'choose' });
          dq.push(v);
          snap(`${v} 从后端入队，back 移到下标 ${String(dq.length - 1)}。`, { phase: 'pushBack', activeIndex: dq.length - 1 });
        } else if (op === 2) {
          const out = dq.shift();
          snap(`popFront()：从前端弹出 ${String(out)}，front 右移。`, { phase: 'popFront', activeIndex: -1 });
        } else {
          const out = dq.pop();
          snap(`popBack()：从后端弹出 ${String(out)}，back 左移。`, { phase: 'popBack', activeIndex: -1 });
        }
        while (dq.length > win) {
          const old = dq.shift();
          snap(`维持滑动窗口容量 ${String(win)}：淘汰过期的 ${String(old)}。`, { phase: 'trim' });
        }
      }
      const finalItems = dq.map((v, i) => ({
        label: String(v), sub: i === 0 ? 'front' : (i === dq.length - 1 ? 'back' : ''),
        state: i === 0 ? 'done' : (i === dq.length - 1 ? 'warning' : 'primary'),
      }));
      finalItems.push({ label: 'END', sub: '完成', state: 'success' });
      snap(`操作结束：窗口内保留 ${String(dq.length)} 个元素。`, { items: finalItems, activeIndex: finalItems.length - 1 });
      return finalize(steps);
    },

    render(snap, p, c) {
      const items = snap.items || [];
      return (
        <Flow c={c} items={items} activeIndex={num(snap.activeIndex, -1)} height={H}
          title="双端队列：两端进出与滑动窗口"
          subtitle={`front→${String(snap.front || 0)} · back→${String(snap.back || 0)} · 元素 ${String((snap.deque || []).length)}`} />
      );
    },
  },

  // ---------------------------------------------------------------- 二叉堆
  'binary-heap': {
    params: [
      { key: 'insertCount', label: '插入次数', type: 'range', min: 6, max: 14, step: 1, default: 10 },
      { key: 'extractCount', label: '删除堆顶次数', type: 'range', min: 2, max: 6, step: 1, default: 4 },
      { key: 'seed', label: '随机种子', type: 'range', min: 1, max: 30, step: 1, default: 7 },
    ],
    height: H,
    legend: [
      { color: L.primary, label: '堆节点' },
      { color: L.success, label: '堆顶 / 根' },
      { color: L.warning, label: '当前比较与移动路径' },
    ],
    hint: '二叉堆用数组表示完全二叉树：插入时从末尾上浮，删除堆顶时把末尾放到根再下沉，始终维持父节点 ≥ 子节点。',

    buildSteps(p) {
      const N = p.insertCount, E = p.extractCount;
      const rnd = mulberry32((p.seed || 7) * 101 + 61);
      const heap = [];
      const steps = [];
      let swaps = 0;
      const snap = (note, extra = {}) => {
        const path = extra.path || [];
        const build = (i) => {
          if (i >= heap.length) return null;
          const n = {
            key: i, label: String(heap[i]), sub: `下标${String(i)}`,
            state: path.indexOf(i) >= 0 ? 'active' : (i === 0 ? 'done' : 'idle'),
          };
          n.left = build(2 * i + 1);
          n.right = build(2 * i + 2);
          return n;
        };
        const g = treeGraph(build(0));
        steps.push({
          heap: [...heap], nodes: g.nodes, edges: g.edges, path: [...path], swaps,
          note, metrics: { 堆大小: heap.length, 堆顶: heap.length ? heap[0] : 0, 交换次数: swaps },
          ...extra,
        });
      };
      snap('初始化空堆。', { path: [] });
      for (let i = 0; i < N; i++) {
        const v = 10 + Math.floor(rnd() * 90);
        heap.push(v);
        let cur = heap.length - 1;
        snap(`插入 ${v} 到数组末尾（下标 ${String(cur)}），开始上浮。`, { path: [cur] });
        while (cur > 0) {
          const par = (cur - 1) >> 1;
          snap(`比较 ${String(heap[cur])} 与父节点 ${String(heap[par])}。`, { path: [cur, par] });
          if (heap[cur] <= heap[par]) break;
          const tmp = heap[cur]; heap[cur] = heap[par]; heap[par] = tmp;
          swaps++;
          snap(`父节点较小，上浮：交换下标 ${String(cur)} 与 ${String(par)}。`, { path: [cur, par] });
          cur = par;
        }
      }
      for (let t = 0; t < E; t++) {
        if (!heap.length) break;
        const top = heap[0];
        snap(`取出堆顶 ${String(top)}（最大元素）。`, { path: [0] });
        const last = heap.pop();
        if (heap.length) {
          heap[0] = last;
          let cur = 0;
          snap(`把末尾元素 ${String(last)} 放到根，开始下沉。`, { path: [0] });
          while (true) {
            let big = cur;
            const l = 2 * cur + 1, r = 2 * cur + 2;
            if (l < heap.length && heap[l] > heap[big]) big = l;
            if (r < heap.length && heap[r] > heap[big]) big = r;
            snap(`在下标 ${String(cur)} 的子节点中选出较大者下标 ${String(big)}。`, { path: [cur, big] });
            if (big === cur) break;
            const tmp = heap[cur]; heap[cur] = heap[big]; heap[big] = tmp;
            swaps++;
            snap(`子节点更大，下沉：交换下标 ${String(cur)} 与 ${String(big)}。`, { path: [cur, big] });
            cur = big;
          }
        }
      }
      snap(`堆操作结束：剩余 ${String(heap.length)} 个元素，堆顶 ${String(heap[0] || 0)}。`);
      return finalize(steps);
    },

    render(snap, p, c) {
      return (
        <GraphView c={c} nodes={snap.nodes || []} edges={snap.edges || []} height={H} directed
          title="二叉堆：上浮 / 下沉维护堆序"
          subtitle={`大小 ${String((snap.heap || []).length)} · 堆顶 ${String((snap.heap || [])[0] || 0)} · 交换 ${String(snap.swaps || 0)}`} />
      );
    },
  },

  // ---------------------------------------------------------------- 二叉搜索树
  bst: {
    params: [
      { key: 'insertCount', label: '插入节点数', type: 'range', min: 6, max: 14, step: 1, default: 10 },
      { key: 'queryCount', label: '查询次数', type: 'range', min: 2, max: 5, step: 1, default: 3 },
      { key: 'dist', label: '插入顺序', type: 'select', default: 'random',
        options: [{ value: 'random', label: '随机' }, { value: 'nearly', label: '近乎有序' }] },
      { key: 'seed', label: '随机种子', type: 'range', min: 1, max: 30, step: 1, default: 7 },
    ],
    height: H,
    legend: [
      { color: L.primary, label: '树节点' },
      { color: L.warning, label: '当前比较路径' },
      { color: L.success, label: '命中 / 新插入节点' },
    ],
    hint: 'BST 保证左子树 < 根 < 右子树：插入与查询都沿比较路径下降；若退化成链，查找会从 O(log n) 跌到 O(n)。',

    buildSteps(p) {
      const N = p.insertCount, Q = p.queryCount;
      const rnd = mulberry32((p.seed || 7) * 109 + 67);
      let keys = Array.from({ length: N }, () => 10 + Math.floor(rnd() * 90));
      if (p.dist === 'nearly') keys = keys.map((v, i) => 10 + i * 7 + (i % 3));
      let root = null;
      const steps = [];
      const paint = (n, active) => {
        if (!n) return null;
        return {
          key: n.key, label: String(n.key),
          state: active.indexOf(n.key) >= 0 ? 'active' : 'idle',
          left: paint(n.left, active), right: paint(n.right, active),
        };
      };
      const snap = (note, extra = {}) => {
        const active = extra.active || [];
        const g = treeGraph(paint(root, active));
        steps.push({
          nodes: g.nodes, edges: g.edges, active: [...active],
          size: count(root), depth: depth(root), note,
          metrics: { 节点数: count(root), 树高: depth(root), 比较路径长: active.length },
          ...extra,
        });
      };
      function count(n) { return n ? 1 + count(n.left) + count(n.right) : 0; }
      function depth(n) { return n ? 1 + Math.max(depth(n.left), depth(n.right)) : 0; }
      snap('初始化空 BST。', { active: [] });
      const insert = (n, key, path) => {
        if (!n) return { key, left: null, right: null };
        path.push(n.key);
        snap(`插入 ${key}：与节点 ${n.key} 比较，向${key < n.key ? '左' : '右'}子树下降。`, { active: [...path] });
        if (key < n.key) n.left = insert(n.left, key, path);
        else if (key > n.key) n.right = insert(n.right, key, path);
        return n;
      };
      for (const key of keys) {
        root = insert(root, key, []);
        snap(`键 ${key} 已作为新叶子插入，树高 ${String(depth(root))}。`, { active: [key], inserted: key });
      }
      for (let t = 0; t < Q; t++) {
        const key = keys[Math.floor(rnd() * keys.length)] + (t === Q - 1 ? 1 : 0);
        const path = [];
        let cur = root;
        snap(`查询键 ${key}：从根开始比较。`, { active: [] });
        while (cur) {
          path.push(cur.key);
          snap(`${key} 与 ${cur.key} 比较，沿${key < cur.key ? '左' : '右'}分支继续。`, { active: [...path] });
          if (key === cur.key) break;
          cur = key < cur.key ? cur.left : cur.right;
        }
        snap(key === cur?.key ? `查询命中 ${key}，路径长度 ${String(path.length)}。` : `查询失败：键 ${key} 不在树中。`, { active: [...path] });
      }
      snap(`BST 演示结束：共 ${String(count(root))} 个节点，树高 ${String(depth(root))}。`);
      return finalize(steps);
    },

    render(snap, p, c) {
      return (
        <GraphView c={c} nodes={snap.nodes || []} edges={snap.edges || []} height={H} directed
          title="二叉搜索树：比较路径与插入"
          subtitle={`节点 ${String(snap.size || 0)} · 树高 ${String(snap.depth || 0)} · 路径 ${String((snap.active || []).length)}`} />
      );
    },
  },

  // ---------------------------------------------------------------- AVL 树
  'avl-tree': {
    params: [
      { key: 'insertCount', label: '插入节点数', type: 'range', min: 6, max: 14, step: 1, default: 10 },
      { key: 'seed', label: '随机种子', type: 'range', min: 1, max: 30, step: 1, default: 7 },
      { key: 'showBf', label: '标注平衡因子', type: 'toggle', default: true },
    ],
    height: H,
    legend: [
      { color: L.primary, label: '普通节点' },
      { color: L.warning, label: '插入/旋转路径' },
      { color: L.success, label: '再平衡后的根' },
    ],
    hint: 'AVL 树要求任意节点左右子树高度差 ≤ 1；插入后沿路更新高度，发现失衡时按 LL/LR/RR/RL 四种情形旋转。',

    buildSteps(p) {
      const N = p.insertCount;
      const rnd = mulberry32((p.seed || 7) * 127 + 73);
      const keys = Array.from({ length: N }, () => 10 + Math.floor(rnd() * 90));
      let root = null;
      let rotations = 0;
      const steps = [];
      const h = (n) => (n ? n.height : 0);
      const bf = (n) => h(n.left) - h(n.right);
      const size = (n) => (n ? 1 + size(n.left) + size(n.right) : 0);
      const clone = (n) => (n ? { key: n.key, height: n.height, left: clone(n.left), right: clone(n.right) } : null);
      const rotRight = (y) => {
        const x = y.left;
        y.left = x.right; x.right = y;
        y.height = 1 + Math.max(h(y.left), h(y.right));
        x.height = 1 + Math.max(h(x.left), h(x.right));
        rotations++;
        return x;
      };
      const rotLeft = (x) => {
        const y = x.right;
        x.right = y.left; y.left = x;
        x.height = 1 + Math.max(h(x.left), h(x.right));
        y.height = 1 + Math.max(h(y.left), h(y.right));
        rotations++;
        return y;
      };
      const snap = (note, active = []) => {
        const tree = clone(root);
        const paint = (n) => {
          if (!n) return;
          n.label = String(n.key);
          n.sub = p.showBf ? `BF ${String(bf(n))}` : undefined;
          n.state = active.indexOf(n.key) >= 0 ? 'active' : (n === tree ? 'done' : 'idle');
          paint(n.left); paint(n.right);
        };
        paint(tree);
        const g = treeGraph(tree);
        steps.push({
          nodes: g.nodes, edges: g.edges, height: h(root), size: size(root), rotations,
          note, metrics: { 节点数: size(root), 树高: h(root), 旋转次数: rotations },
        });
      };
      snap('初始化空 AVL 树。');
      const insert = (n, key, path) => {
        if (!n) return { key, height: 1, left: null, right: null };
        path.push(n.key);
        snap(`比较 ${key} 与 ${n.key}，沿${key < n.key ? '左' : '右'}子树下降。`, [...path]);
        if (key < n.key) n.left = insert(n.left, key, path);
        else if (key > n.key) n.right = insert(n.right, key, path);
        else return n;
        n.height = 1 + Math.max(h(n.left), h(n.right));
        const b = bf(n);
        if (b > 1) {
          if (key < n.left.key) {
            snap(`节点 ${n.key} 左子树过高（BF=${String(b)}），LL 型：右旋。`, [...path, n.left.key]);
            return rotRight(n);
          }
          if (key > n.left.key) {
            snap(`节点 ${n.key} 出现 LR 型失衡，先对子节点左旋。`, [...path, n.left.key]);
            n.left = rotLeft(n.left);
            snap('子节点左旋完成，再对当前节点右旋完成再平衡。', [...path]);
            return rotRight(n);
          }
        }
        if (b < -1) {
          if (key > n.right.key) {
            snap(`节点 ${n.key} 右子树过高（BF=${String(b)}），RR 型：左旋。`, [...path, n.right.key]);
            return rotLeft(n);
          }
          if (key < n.right.key) {
            snap(`节点 ${n.key} 出现 RL 型失衡，先对子节点右旋。`, [...path, n.right.key]);
            n.right = rotRight(n.right);
            snap('子节点右旋完成，再对当前节点左旋完成再平衡。', [...path]);
            return rotLeft(n);
          }
        }
        return n;
      };
      for (const key of keys) {
        root = insert(root, key, []);
        snap(`插入 ${key} 完成，AVL 树高 ${String(h(root))}，旋转累计 ${String(rotations)} 次。`, []);
      }
      snap(`演示结束：${String(size(root))} 个节点，树高 ${String(h(root))}，旋转 ${String(rotations)} 次。`);
      return finalize(steps);
    },

    render(snap, p, c) {
      return (
        <GraphView c={c} nodes={snap.nodes || []} edges={snap.edges || []} height={H} directed
          title="AVL 树：插入与再平衡旋转"
          subtitle={`节点 ${String(snap.size || 0)} · 树高 ${String(snap.height || 0)} · 旋转 ${String(snap.rotations || 0)}`} />
      );
    },
  },

  // ---------------------------------------------------------------- 红黑树
  'red-black-tree': {
    params: [
      { key: 'insertCount', label: '插入节点数', type: 'range', min: 6, max: 14, step: 1, default: 10 },
      { key: 'seed', label: '随机种子', type: 'range', min: 1, max: 30, step: 1, default: 7 },
      { key: 'detail', label: '显示修复细节', type: 'toggle', default: true },
    ],
    height: H,
    legend: [
      { color: L.danger, label: '红色节点' },
      { color: L.text, label: '黑色节点' },
      { color: L.warning, label: '当前修复路径' },
    ],
    hint: '红黑树用颜色约束保证最长路径不超过最短路径两倍：插入红色节点后通过变色与旋转修复，根节点始终为黑。',

    buildSteps(p) {
      const N = p.insertCount;
      const rnd = mulberry32((p.seed || 7) * 149 + 89);
      const keys = Array.from({ length: N }, () => 10 + Math.floor(rnd() * 90));
      const NIL = { key: null, color: 'B', left: null, right: null, parent: null, isNil: true };
      let root = NIL;
      let rotations = 0, recolor = 0;
      const steps = [];
      const snap = (note, activeKey = null) => {
        const build = (n) => {
          if (!n || n.isNil) return null;
          const out = {
            key: n.key, label: String(n.key), sub: n.color === 'R' ? 'R' : 'B',
            state: n.key === activeKey ? 'active' : (n === root ? 'done' : 'idle'),
          };
          out.left = build(n.left);
          out.right = build(n.right);
          return out;
        };
        const g = treeGraph(build(root));
        steps.push({
          nodes: g.nodes, edges: g.edges, rotations, recolor,
          note, metrics: { 节点数: size(root), 黑高: blackHeight(root), 旋转次数: rotations, 变色次数: recolor },
        });
      };
      const size = (n) => (!n || n.isNil ? 0 : 1 + size(n.left) + size(n.right));
      const blackHeight = (n) => (!n || n.isNil ? 1 : 1 + Math.min(blackHeight(n.left), blackHeight(n.right)));
      const leftRotate = (x) => {
        const y = x.right;
        x.right = y.left;
        if (!y.left.isNil) y.left.parent = x;
        y.parent = x.parent;
        if (x.parent === NIL) root = y;
        else if (x === x.parent.left) x.parent.left = y;
        else x.parent.right = y;
        y.left = x; x.parent = y;
        rotations++;
        snap(`以 ${String(x.key)} 为轴左旋，${String(y.key)} 上移为新子树根。`);
      };
      const rightRotate = (y) => {
        const x = y.left;
        y.left = x.right;
        if (!x.right.isNil) x.right.parent = y;
        x.parent = y.parent;
        if (y.parent === NIL) root = x;
        else if (y === y.parent.right) y.parent.right = x;
        else y.parent.left = x;
        x.right = y; y.parent = x;
        rotations++;
        snap(`以 ${String(y.key)} 为轴右旋，${String(x.key)} 上移为新子树根。`);
      };
      const fix = (z) => {
        while (z.parent.color === 'R') {
          const gp = z.parent.parent;
          if (z.parent === gp.left) {
            const y = gp.right;
            if (y.color === 'R') {
              z.parent.color = 'B'; y.color = 'B'; gp.color = 'R'; recolor += 3;
              if (p.detail) snap(`叔叔 ${String(y.key)} 为红：父叔变黑、祖父变红，问题向上转移。`, z.key);
              z = gp;
            } else {
              if (z === z.parent.right) { z = z.parent; leftRotate(z); }
              z.parent.color = 'B'; z.parent.parent.color = 'R'; recolor += 2;
              if (p.detail) snap('叔叔为黑且呈折线：先变色，再右旋祖父完成修复。', z.key);
              rightRotate(z.parent.parent);
            }
          } else {
            const y = gp.left;
            if (y.color === 'R') {
              z.parent.color = 'B'; y.color = 'B'; gp.color = 'R'; recolor += 3;
              if (p.detail) snap(`叔叔 ${String(y.key)} 为红：父叔变黑、祖父变红，继续向上。`, z.key);
              z = gp;
            } else {
              if (z === z.parent.left) { z = z.parent; rightRotate(z); }
              z.parent.color = 'B'; z.parent.parent.color = 'R'; recolor += 2;
              if (p.detail) snap('叔叔为黑且呈折线：先变色，再左旋祖父完成修复。', z.key);
              leftRotate(z.parent.parent);
            }
          }
        }
        root.color = 'B';
        snap('根节点置为黑色，红黑性质恢复。');
      };
      snap('初始化空红黑树（NIL 视为黑色哨兵）。');
      for (const key of keys) {
        const z = { key, color: 'R', left: NIL, right: NIL, parent: NIL };
        let x = root, y = NIL;
        while (x !== NIL) {
          y = x;
          snap(`插入 ${key}：与 ${String(x.key)} 比较，向${key < x.key ? '左' : '右'}子树下降。`, key);
          x = key < x.key ? x.left : x.right;
        }
        z.parent = y;
        if (y === NIL) root = z;
        else if (key < y.key) y.left = z;
        else y.right = z;
        snap(`红色新节点 ${key} 已挂入，开始修复红红冲突。`, key);
        fix(z);
      }
      snap(`演示结束：${String(size(root))} 个节点，旋转 ${String(rotations)} 次，变色 ${String(recolor)} 次。`);
      return finalize(steps);
    },

    render(snap, p, c) {
      const nodes = (snap.nodes || []).map((n) => ({
        ...n,
        color: n.sub === 'R' ? c.danger : c.text,
        sub: String(n.sub || ''),
      }));
      return (
        <GraphView c={c} nodes={nodes} edges={snap.edges || []} height={H} directed
          title="红黑树：插入、变色与旋转"
          subtitle={`节点 ${String((snap.nodes || []).length)} · 旋转 ${String(snap.rotations || 0)} · 变色 ${String(snap.recolor || 0)}`} />
      );
    },
  },

  // ---------------------------------------------------------------- B 树
  'b-tree': {
    params: [
      { key: 'insertCount', label: '插入键数', type: 'range', min: 6, max: 14, step: 1, default: 10 },
      { key: 'queryCount', label: '查询次数', type: 'range', min: 2, max: 4, step: 1, default: 2 },
      { key: 'seed', label: '随机种子', type: 'range', min: 1, max: 30, step: 1, default: 7 },
    ],
    height: H,
    legend: [
      { color: L.primary, label: 'B 树节点（多键）' },
      { color: L.warning, label: '分裂 / 查询路径' },
      { color: L.success, label: '上提的中间键' },
    ],
    hint: 'B 树是多路平衡树：节点可存多个键，键数超限就把中间键上提并分裂，用更矮的树高减少磁盘 IO。',

    buildSteps(p) {
      const N = p.insertCount, Q = p.queryCount;
      const rnd = mulberry32((p.seed || 7) * 163 + 97);
      const keys = Array.from({ length: N }, () => 10 + Math.floor(rnd() * 90));
      const t = 2; // 最小度数，最多 2t-1 = 3 个键
      let root = { keys: [], children: [], leaf: true };
      let splits = 0;
      const steps = [];
      const clone = (n) => (n ? {
        keys: [...n.keys], leaf: n.leaf, state: n.state,
        children: (n.children || []).map(clone),
      } : null);
      const countKeys = (n) => (n ? n.keys.length + (n.children || []).reduce((s, ch) => s + countKeys(ch), 0) : 0);
      const treeHeight = (n) => (n ? 1 + Math.max(0, ...(n.children || []).map(treeHeight)) : 0);
      const snap = (note, activeKeys = []) => {
        const tree = clone(root);
        const paint = (n) => {
          if (!n) return;
          n.state = n.keys.some((k) => activeKeys.indexOf(k) >= 0) ? 'active' : 'idle';
          (n.children || []).forEach(paint);
        };
        paint(tree);
        const g = bTreeGraph(tree);
        steps.push({
          nodes: g.nodes, edges: g.edges, splits,
          note, metrics: { 键总数: countKeys(root), 树高: treeHeight(root), 分裂次数: splits },
        });
      };
      const splitChild = (parent, i) => {
        const y = parent.children[i];
        const z = { keys: y.keys.slice(t), children: y.children.slice(t), leaf: y.leaf };
        const mid = y.keys[t - 1];
        y.keys = y.keys.slice(0, t - 1);
        y.children = y.children.slice(0, t);
        parent.keys.splice(i, 0, mid);
        parent.children.splice(i + 1, 0, z);
        splits++;
        snap(`节点键数达到上限，键 ${String(mid)} 上提父节点，原节点分裂为二。`);
      };
      const insertNonFull = (node, key) => {
        let i = node.keys.length - 1;
        if (node.leaf) {
          while (i >= 0 && key < node.keys[i]) i--;
          if (i >= 0 && key === node.keys[i]) return;
          node.keys.splice(i + 1, 0, key);
          snap(`键 ${String(key)} 插入叶子节点的第 ${String(i + 2)} 个位置。`);
          return;
        }
        while (i >= 0 && key < node.keys[i]) i--;
        if (i >= 0 && key === node.keys[i]) return;
        if (i < 0) i = 0;
        snap(`内部节点比较键 ${String(key)}，进入第 ${String(i + 2)} 个子树。`);
        if (node.children[i].keys.length === 2 * t - 1) {
          snap(`子树已满（${String(2 * t - 1)} 键），先分裂再下降。`);
          splitChild(node, i);
          if (key > node.keys[i]) i++;
        }
        insertNonFull(node.children[i], key);
      };
      snap(`初始化 B 树（最小度数 ${String(t)}，节点最多 ${String(2 * t - 1)} 键）。`);
      for (const key of keys) {
        if (root.keys.length === 2 * t - 1) {
          const nr = { keys: [], children: [root], leaf: false };
          root = nr;
          snap('根节点已满，创建新根并分裂旧根。');
          splitChild(root, 0);
        }
        insertNonFull(root, key);
      }
      for (let qi = 0; qi < Q; qi++) {
        const key = keys[Math.floor(rnd() * keys.length)];
        let node = root;
        snap(`查询键 ${String(key)}：从根开始。`);
        while (node) {
          let i = 0;
          while (i < node.keys.length && key > node.keys[i]) i++;
          if (i < node.keys.length && key === node.keys[i]) {
            snap(`在节点中命中键 ${String(key)}，查询成功。`, [key]);
            break;
          }
          if (node.leaf) {
            snap(`键 ${String(key)} 不在叶子节点中，查询失败。`, node.keys.slice());
            break;
          }
          snap(`键 ${String(key)} 大于第 ${String(i)} 个分隔键，下降到第 ${String(i + 1)} 个子树。`, node.keys.slice());
          node = node.children[i];
        }
      }
      snap(`演示结束：${String(countKeys(root))} 个键，树高 ${String(treeHeight(root))}，分裂 ${String(splits)} 次。`);
      return finalize(steps);
    },

    render(snap, p, c) {
      return (
        <GraphView c={c} nodes={snap.nodes || []} edges={snap.edges || []} height={H}
          title="B 树：多键节点与分裂上提"
          subtitle={`键数 ${String((snap.nodes || []).reduce((s, n) => s + (String(n.label || '').split('|').length), 0))} · 分裂 ${String(snap.splits || 0)}`} />
      );
    },
  },

  // ---------------------------------------------------------------- 并查集
  'union-find': {
    params: [
      { key: 'n', label: '元素个数', type: 'range', min: 6, max: 12, step: 1, default: 9 },
      { key: 'ops', label: '操作次数', type: 'range', min: 8, max: 14, step: 1, default: 11 },
      { key: 'seed', label: '随机种子', type: 'range', min: 1, max: 30, step: 1, default: 7 },
    ],
    height: H,
    legend: [
      { color: L.success, label: '集合根（root）' },
      { color: L.primary, label: '普通节点' },
      { color: L.warning, label: 'find 路径 / 压缩中' },
    ],
    hint: '并查集用 parent 数组表示森林：find 沿父指针找根并做路径压缩，union 按秩把小树挂到大树下，近似 O(1)。',

    buildSteps(p) {
      const n = p.n, OPS = p.ops;
      const rnd = mulberry32((p.seed || 7) * 173 + 101);
      const parent = Array.from({ length: n }, (_, i) => i);
      const rank = new Array(n).fill(0);
      const steps = [];
      const snap = (note, extra = {}) => {
        const path = extra.path || [];
        const depthOf = (i) => {
          let d = 0, x = i;
          while (parent[x] !== x && d < 24) { x = parent[x]; d++; }
          return d;
        };
        const nodes = Array.from({ length: n }, (_, i) => ({
          id: String(i), label: String(i),
          x: n === 1 ? 0.5 : 0.06 + (0.88 * i) / (n - 1),
          y: 0.16 + depthOf(i) * 0.2,
          sub: parent[i] === i ? `根 r${String(rank[i])}` : `p=${String(parent[i])}`,
          state: path.indexOf(i) >= 0 ? 'active' : (parent[i] === i ? 'done' : 'idle'),
          r: 12,
        }));
        const edges = [];
        for (let i = 0; i < n; i++) {
          if (parent[i] !== i) edges.push({
            from: String(i), to: String(parent[i]),
            state: path.indexOf(i) >= 0 ? 'active' : 'idle',
            label: 'parent',
          });
        }
        const roots = new Set(parent.map((v, i) => (v === i ? i : -1)).filter((v) => v >= 0));
        steps.push({
          nodes, edges, parent: [...parent], rank: [...rank], path: [...path],
          note, metrics: { 元素数: n, 连通分量数: roots.size, 路径长度: path.length },
          ...extra,
        });
      };
      const find = (x) => {
        const path = [];
        let cur = x;
        while (parent[cur] !== cur) {
          path.push(cur);
          snap(`find(${String(x)})：从 ${String(cur)} 跳到父节点 ${String(parent[cur])}。`, { path: [...path] });
          cur = parent[cur];
        }
        const root = cur;
        snap(`find(${String(x)})：找到根 ${String(root)}。`, { path: [...path, root] });
        for (const k of path) {
          parent[k] = root;
          snap(`路径压缩：parent[${String(k)}] 直接指向根 ${String(root)}。`);
        }
        return root;
      };
      snap('初始化：每个元素各自成集合，parent[i] = i。');
      let unions = 0, finds = 0;
      for (let t = 0; t < OPS; t++) {
        const a = Math.floor(rnd() * n), b = Math.floor(rnd() * n);
        if (t % 3 === 2) {
          finds++;
          find(a);
          snap(`查询 ${String(a)} 与 ${String(b)} 是否同组：再 find(${String(b)})。`);
          find(b);
        } else {
          let ra = find(a), rb = find(b);
          if (ra === rb) {
            snap(`${String(a)} 与 ${String(b)} 已在同一集合，union 不做改动。`);
          } else {
            if (rank[ra] < rank[rb]) { const tmp = ra; ra = rb; rb = tmp; }
            parent[rb] = ra;
            if (rank[ra] === rank[rb]) rank[ra]++;
            unions++;
            snap(`union(${String(a)},${String(b)})：按秩把根 ${String(rb)} 挂到 ${String(ra)} 下。`);
          }
        }
      }
      snap(`操作结束：${String(unions)} 次合并，${String(finds)} 次 find，路径压缩完成。`,
        { path: Array.from({ length: n }, (_, i) => i) });
      return finalize(steps);
    },

    render(snap, p, c) {
      return (
        <GraphView c={c} nodes={snap.nodes || []} edges={snap.edges || []} height={H} directed
          title="并查集：find 路径压缩与按秩 union"
          subtitle={`元素 ${String((snap.parent || []).length)} · 连通分量 ${String(snap.metrics ? snap.metrics['连通分量数'] : 0)} · 路径 ${String((snap.path || []).length)}`} />
      );
    },
  },

  // ---------------------------------------------------------------- Trie
  trie: {
    params: [
      { key: 'wordCount', label: '插入单词数', type: 'range', min: 3, max: 6, step: 1, default: 4 },
      { key: 'prefixLen', label: '前缀查询长度', type: 'range', min: 2, max: 4, step: 1, default: 3 },
      { key: 'seed', label: '随机种子', type: 'range', min: 1, max: 30, step: 1, default: 7 },
    ],
    height: H,
    legend: [
      { color: L.primary, label: '字符节点' },
      { color: L.warning, label: '当前前缀路径' },
      { color: L.success, label: '单词结尾标记' },
    ],
    hint: 'Trie 把公共前缀合并为同一条路径：插入按字符逐层建节点，前缀查询只需沿字符路径走一遍，复杂度 O(L)。',

    buildSteps(p) {
      const W = p.wordCount, PL = p.prefixLen;
      const rnd = mulberry32((p.seed || 7) * 181 + 113);
      const pool = ['to', 'tea', 'ted', 'ten', 'in', 'inn', 'integer', 'car', 'cat', 'care', 'dog', 'door', 'data', 'deep'];
      const words = [];
      for (let i = 0; i < W; i++) words.push(pool[Math.floor(rnd() * pool.length)]);
      const root = { ch: '根', children: {}, terminal: false };
      const steps = [];
      const clone = (n, active) => ({
        ch: n.ch, terminal: n.terminal,
        state: active.indexOf(n) >= 0 ? 'active' : (n.terminal ? 'done' : 'idle'),
        children: Object.fromEntries(Object.entries(n.children).map(([k, v]) => [k, clone(v, active)])),
      });
      const snap = (note, active = []) => {
        const g = trieGraph(clone(root, active));
        steps.push({
          nodes: g.nodes, edges: g.edges, words: [...words], prefixLen: PL,
          note, metrics: { 单词数: words.length, 节点数: g.nodes.length, 路径长: active.length },
        });
      };
      snap('初始化 Trie 根节点。');
      for (const word of words) {
        let node = root;
        const active = [root];
        snap(`插入单词 ${word}，从根节点开始逐字符建路径。`, active);
        for (const ch of word) {
          if (!node.children[ch]) {
            node.children[ch] = { ch, children: {}, terminal: false };
            snap(`字符 ${ch} 不存在，新建字符节点 ${ch}。`);
          } else {
            snap(`字符 ${ch} 已存在，复用公共前缀节点。`);
          }
          node = node.children[ch];
          active.push(node);
          snap(`沿前缀走到字符节点 ${ch}。`);
        }
        node.terminal = true;
        snap(`单词 ${word} 插入完成，标记末尾节点为词尾。`, [node]);
      }
      for (let q = 0; q < 2; q++) {
        const prefix = words[q % words.length].slice(0, PL);
        let node = root;
        const active = [root];
        snap(`查询前缀 ${prefix}：从根节点出发。`);
        let ok = true;
        for (const ch of prefix) {
          if (!node.children[ch]) { ok = false; break; }
          node = node.children[ch];
          active.push(node);
          snap(`匹配字符 ${ch}，沿前缀路径前进。`);
        }
        snap(ok ? `前缀 ${prefix} 存在，可用它做自动补全。` : `前缀 ${prefix} 不存在，路径中断。`);
      }
      snap(`演示结束：插入 ${String(words.length)} 个单词，共享公共前缀。`);
      return finalize(steps);
    },

    render(snap, p, c) {
      return (
        <GraphView c={c} nodes={snap.nodes || []} edges={snap.edges || []} height={H}
          title="Trie：公共前缀路径与词尾标记"
          subtitle={`单词 ${String((snap.words || []).length)} · 节点 ${String((snap.nodes || []).length)} · 前缀长 ${String(snap.prefixLen || 0)}`} />
      );
    },
  },

  // ---------------------------------------------------------------- 跳表
  'skip-list': {
    params: [
      { key: 'insertCount', label: '插入键数', type: 'range', min: 6, max: 12, step: 1, default: 9 },
      { key: 'maxLevel', label: '索引层数', type: 'range', min: 3, max: 5, step: 1, default: 4 },
      { key: 'queryCount', label: '查询次数', type: 'range', min: 2, max: 4, step: 1, default: 3 },
      { key: 'seed', label: '随机种子', type: 'range', min: 1, max: 30, step: 1, default: 7 },
    ],
    height: H,
    legend: [
      { color: L.primary, label: '底层有序链表' },
      { color: L.success, label: '上层索引塔' },
      { color: L.warning, label: '当前搜索路径' },
    ],
    hint: '跳表在有序链表之上叠加多层随机索引：搜索自顶层向右、逐层下降，期望 O(log n)；Redis ZSET 即基于此。',

    buildSteps(p) {
      const N = p.insertCount, ML = p.maxLevel, Q = p.queryCount;
      const rnd = mulberry32((p.seed || 7) * 191 + 131);
      const levels = Array.from({ length: ML }, () => []);
      const steps = [];
      const makeGraph = (path = []) => {
        const order = levels[0];
        const rank = new Map(order.map((k, i) => [k, i]));
        const nodes = [], edges = [];
        for (let lv = ML - 1; lv >= 0; lv--) {
          const y = 0.12 + 0.19 * (ML - 1 - lv);
          const hdr = `H@${lv}`;
          nodes.push({ id: hdr, x: 0.03, y, label: 'H', sub: `L${String(lv)}`, state: 'done', r: 10 });
          const row = levels[lv];
          row.forEach((k, idx) => {
            const id = `${k}@${lv}`;
            nodes.push({
              id, x: 0.12 + 0.82 * ((rank.get(k) + 1) / (order.length + 2)),
              y, label: String(k), sub: `L${String(lv)}`,
              state: path.indexOf(id) >= 0 ? 'active' : (lv > 0 ? 'done' : 'idle'), r: 11,
            });
            const prev = idx === 0 ? hdr : `${row[idx - 1]}@${lv}`;
            edges.push({ from: prev, to: id, state: path.indexOf(id) >= 0 ? 'active' : 'idle' });
          });
        }
        for (let lv = 0; lv < ML - 1; lv++) {
          levels[lv + 1].forEach((k) => {
            if (levels[lv].indexOf(k) >= 0) {
              edges.push({ from: `${k}@${lv + 1}`, to: `${k}@${lv}`, state: 'idle', dashed: true });
            }
          });
        }
        return { nodes, edges };
      };
      const snap = (note, extra = {}) => {
        const path = extra.path || [];
        const g = makeGraph(path);
        steps.push({
          nodes: g.nodes, edges: g.edges, levels: levels.map((r) => [...r]), path: [...path],
          note, metrics: { 元素数: levels[0].length, 索引节点: g.nodes.length - ML, 路径长: path.length },
          ...extra,
        });
      };
      const searchPath = (v, record) => {
        const path = [`H@${ML - 1}`];
        for (let lv = ML - 1; lv >= 0; lv--) {
          const row = levels[lv];
          let idx = -1;
          while (idx + 1 < row.length && row[idx + 1] < v) idx++;
          if (idx >= 0) path.push(`${row[idx]}@${lv}`);
          if (record) snap(`第 ${String(lv)} 层：向右走到不超过 ${String(v)} 的最大节点，然后下降。`, { path: [...path], searchKey: v });
        }
        return path;
      };
      snap(`初始化 ${String(ML)} 层空跳表，只有每层头结点 H。`);
      for (let i = 0; i < N; i++) {
        const v = 10 + Math.floor(rnd() * 90);
        const path = searchPath(v, true);
        let pos = 0;
        while (pos < levels[0].length && levels[0][pos] < v) pos++;
        levels[0].splice(pos, 0, v);
        snap(`在第 0 层有序链表中插入 ${String(v)}。`, { path: [...path, `${v}@0`], searchKey: v });
        let lv = 1;
        while (lv < ML && rnd() < 0.5) {
          let p = 0;
          while (p < levels[lv].length && levels[lv][p] < v) p++;
          levels[lv].splice(p, 0, v);
          snap(`抛硬币命中：把 ${String(v)} 提升到第 ${String(lv)} 层索引。`, { path: [...path, `${v}@${lv}`], searchKey: v });
          lv++;
        }
      }
      for (let q = 0; q < Q; q++) {
        const v = levels[0][Math.floor(rnd() * levels[0].length)];
        const path = searchPath(v, true);
        snap(`查询 ${String(v)}：沿高亮路径逐层下降，命中底层节点。`, { path, searchKey: v, hit: true });
      }
      snap(`演示结束：${String(levels[0].length)} 个元素，最高索引层 ${String(levels.findIndex((r, i) => i > 0 && r.length === 0) === -1 ? ML - 1 : ML - 2)}。`);
      return finalize(steps);
    },

    render(snap, p, c) {
      return (
        <GraphView c={c} nodes={snap.nodes || []} edges={snap.edges || []} height={H}
          title="跳表：多层索引指针与搜索路径"
          subtitle={`元素 ${String((snap.levels || [])[0]?.length || 0)} · 路径长 ${String((snap.path || []).length)} · 层数 ${String((snap.levels || []).length)}`} />
      );
    },
  },

  // ---------------------------------------------------------------- 布隆过滤器
  'bloom-filter': {
    params: [
      { key: 'bits', label: '位数组长度', type: 'range', min: 16, max: 32, step: 2, default: 24 },
      { key: 'hashes', label: '哈希函数个数', type: 'range', min: 2, max: 4, step: 1, default: 3 },
      { key: 'inserts', label: '插入元素数', type: 'range', min: 6, max: 12, step: 1, default: 8 },
      { key: 'seed', label: '随机种子', type: 'range', min: 1, max: 30, step: 1, default: 7 },
    ],
    height: H,
    legend: [
      { color: L.primary, label: '已置位的 bit' },
      { color: L.warning, label: '当前哈希命中位' },
      { color: L.border, label: '未置位的 bit' },
      { color: L.success, label: '查询：可能存在' },
      { color: L.danger, label: '查询：一定不存在' },
    ],
    hint: '布隆过滤器用 k 个哈希把元素映射到位数组：插入时置 1；查询若任一位为 0 则一定不存在，全为 1 则「可能存在」。',

    buildSteps(p) {
      const m = p.bits, k = p.hashes, INS = p.inserts;
      const rnd = mulberry32((p.seed || 7) * 197 + 149);
      const bit = new Array(m).fill(0);
      const steps = [];
      const snap = (note, extra = {}) => steps.push({
        bits: [...bit], m, k,
        checked: extra.checked || [], current: extra.current || [], result: extra.result || '',
        note, metrics: { 已置位: bit.reduce((s, v) => s + v, 0), 位数组长: m, 哈希个数: k },
        ...extra,
      });
      const idxs = (v) => {
        const h1 = (v * 73 + 17) % m;
        const h2 = (v * 151 + 7) % m;
        const out = [];
        for (let i = 0; i < k; i++) out.push((h1 + i * h2) % m);
        return out;
      };
      snap(`初始化 ${String(m)} 位全 0 的位数组，使用 ${String(k)} 个哈希函数。`);
      const values = Array.from({ length: INS }, () => 10 + Math.floor(rnd() * 90));
      for (const v of values) {
        const ix = idxs(v);
        snap(`插入元素 ${String(v)}：哈希得到位置 ${ix.map(String).join('、')}。`, { current: [...ix] });
        ix.forEach((pos, j) => {
          bit[pos] = 1;
          snap(`第 ${String(j + 1)} 个哈希命中位 ${String(pos)}，置为 1。`, { checked: ix.slice(0, j + 1), current: [...ix] });
        });
      }
      for (let q = 0; q < 3; q++) {
        const present = q < 2;
        const v = present ? values[Math.floor(rnd() * values.length)] : 7;
        const ix = idxs(v);
        snap(`查询元素 ${String(v)}：计算 ${String(k)} 个哈希位置 ${ix.map(String).join('、')}。`, { current: [...ix] });
        let isMaybe = true;
        ix.forEach((pos, j) => {
          if (bit[pos] === 0) isMaybe = false;
          snap(`检查位 ${String(pos)}：值为 ${String(bit[pos])}。`, { checked: ix.slice(0, j + 1), current: [...ix] });
        });
        snap(isMaybe
          ? `所有位均为 1：${String(v)}「可能存在」（存在误判可能）。`
          : `发现值为 0 的位：${String(v)}「一定不存在」，无漏判。`,
        { result: isMaybe ? 'maybe' : 'no', checked: [...ix], current: [...ix] });
      }
      snap(`演示结束：${String(bit.reduce((s, v2) => s + v2, 0))} 个 bit 被置位，占用 ${String(Math.round((bit.reduce((s, v2) => s + v2, 0) / m) * 100))}%。`);
      return finalize(steps);
    },

    render(snap, p, c) {
      const bits = snap.bits || [];
      const m = Math.max(1, num(snap.m, p.bits || 24));
      const checked = snap.checked || [];
      const current = snap.current || [];
      const cols = Math.min(12, m);
      const cw = Math.min(46, 660 / cols);
      const cells = bits.map((v, i) => {
        const col = i % cols, row = Math.floor(i / cols);
        const x = 28 + col * cw, y = 64 + row * 40;
        let col2 = v ? c.primary : c.border;
        if (checked.indexOf(i) >= 0) col2 = c.warning;
        else if (current.indexOf(i) >= 0 && v) col2 = c.success;
        return (
          <g key={`b${i}`}>
            <rect x={x} y={y} width={cw - 4} height="32" rx="3" fill={col2} opacity={v ? 0.9 : 0.35} />
            <text x={x + (cw - 4) / 2} y={y + 21} textAnchor="middle" fontSize="11" fill={c.bg}>{String(v)}</text>
            <text x={x + (cw - 4) / 2} y={y + 44} textAnchor="middle" fontSize="8" fill={c.muted}>{String(i)}</text>
          </g>
        );
      });
      const result = String(snap.result || '');
      return (
        <Frame c={c} height={H} title="布隆过滤器：多哈希置位与判定"
          subtitle={`位数组 ${String(m)} bit · 哈希 ${String(snap.k || p.hashes)} 个 · 已置位 ${String(bits.reduce((s, v) => s + v, 0))}`}>
          <text x="28" y="50" fontSize="11" fill={c.muted}>位数组（黄色=当前哈希命中，蓝色=已置位）</text>
          {cells}
          <text x="28" y="220" fontSize="12" fill={result === 'no' ? c.danger : (result === 'maybe' ? c.success : c.text)}>
            {result === 'no' ? '判定：一定不存在（有位为 0）'
              : (result === 'maybe' ? '判定：可能存在（全部位为 1）' : '插入 / 查询进行中')}
          </text>
          <text x="28" y="244" fontSize="11" fill={c.muted}>
            {`哈希位置：${current.map(String).join(' → ') || '—'} · 检查进度：${checked.map(String).join(' → ') || '—'}`}
          </text>
        </Frame>
      );
    },
  },

  // ---------------------------------------------------------------- 线段树
  'segment-tree': {
    params: [
      { key: 'n', label: '数组长度', type: 'range', min: 8, max: 16, step: 2, default: 12 },
      { key: 'rangeSize', label: '查询区间长度', type: 'range', min: 2, max: 6, step: 1, default: 4 },
      { key: 'seed', label: '随机种子', type: 'range', min: 1, max: 30, step: 1, default: 7 },
    ],
    height: H,
    legend: [
      { color: L.primary, label: '区间和节点' },
      { color: L.warning, label: '当前访问节点' },
      { color: L.success, label: '已构建 / 命中区间' },
    ],
    hint: '线段树把数组拆成区间树：每个节点存一段区间的聚合值，区间查询与单点修改都只走 O(log n) 条路径。',

    buildSteps(p) {
      const n = p.n, RS = p.rangeSize;
      const arr = makeArray(n, 'random', p.seed || 7);
      let root = null;
      const steps = [];
      const build = (l, r) => {
        const node = { key: `${l}-${r}`, l, r, sum: 0, left: null, right: null };
        if (l === r) node.sum = arr[l];
        else {
          const mid = (l + r) >> 1;
          node.left = build(l, mid);
          node.right = build(mid + 1, r);
          node.sum = node.left.sum + node.right.sum;
        }
        return node;
      };
      root = build(0, n - 1);
      const clone = (nd, states) => {
        if (!nd) return null;
        const out = {
          key: nd.key, label: String(nd.sum), sub: `[${String(nd.l)},${String(nd.r)}]`,
          state: states[nd.key] || 'idle',
        };
        out.left = clone(nd.left, states);
        out.right = clone(nd.right, states);
        return out;
      };
      const snap = (note, activeKeys = [], doneKeys = [], extra = {}) => {
        const states = {};
        doneKeys.forEach((k) => { states[k] = 'done'; });
        activeKeys.forEach((k) => { states[k] = 'active'; });
        const g = treeGraph(clone(root, states));
        steps.push({
          nodes: g.nodes, edges: g.edges, arr: [...arr], activeKeys: [...activeKeys],
          note, metrics: { 数组长度: n, 访问节点: activeKeys.length, 已构建节点: doneKeys.length, 根区间和: root.sum },
          ...extra,
        });
      };
      const order = [];
      (function collect(nd) { if (!nd) return; order.push(nd); collect(nd.left); collect(nd.right); })(root);
      const built = [];
      snap('开始构建线段树：每个节点保存一段区间的和。', [], []);
      for (const nd of order) {
        built.push(nd.key);
        const rest = built.slice(0, -1);
        snap(`构建节点 [${String(nd.l)},${String(nd.r)}]，区间和 = ${String(nd.sum)}。`, [nd.key], rest);
      }
      const L = Math.floor((n - RS) / 2), R = Math.min(n - 1, L + RS - 1);
      const query = (nd, ql, qr, path) => {
        if (!nd || qr < nd.l || nd.r < ql) return 0;
        path.push(nd.key);
        snap(`查询 [${String(ql)},${String(qr)}]：访问节点 [${String(nd.l)},${String(nd.r)}]。`, [...path], built);
        if (ql <= nd.l && nd.r <= qr) {
          snap(`节点 [${String(nd.l)},${String(nd.r)}] 被区间完全覆盖，直接用它的和 ${String(nd.sum)}。`, [...path], built);
          return nd.sum;
        }
        return query(nd.left, ql, qr, path) + query(nd.right, ql, qr, path);
      };
      const total = query(root, L, R, []);
      snap(`区间 [${String(L)},${String(R)}] 查询完成，和为 ${String(total)}。`, [], built, { queryResult: total });
      const idx = Math.floor(n / 3);
      const delta = 10 + Math.floor((p.seed || 7) % 7);
      const update = (nd, path) => {
        path.push(nd.key);
        if (nd.l === nd.r) {
          nd.sum += delta;
          snap(`单点更新：叶子 [${String(nd.l)},${String(nd.l)}] 增加 ${String(delta)}，新值 ${String(nd.sum)}。`, [...path], built);
          return;
        }
        if (idx <= nd.left.r) update(nd.left, path);
        else update(nd.right, path);
        const before = nd.sum;
        nd.sum = nd.left.sum + nd.right.sum;
        snap(`回溯更新节点 [${String(nd.l)},${String(nd.r)}]：${String(before)} → ${String(nd.sum)}。`, [...path], built);
      };
      update(root, []);
      snap(`演示结束：单点更新后根区间和为 ${String(root.sum)}。`);
      return finalize(steps);
    },

    render(snap, p, c) {
      return (
        <GraphView c={c} nodes={snap.nodes || []} edges={snap.edges || []} height={H}
          title="线段树：区间查询与单点更新"
          subtitle={`长度 ${String((snap.arr || []).length)} · 访问 ${String((snap.activeKeys || []).length)} 节点 · 根和 ${String(snap.metrics ? snap.metrics['根区间和'] : 0)}`} />
      );
    },
  },

  // ---------------------------------------------------------------- 树状数组
  'fenwick-tree': {
    params: [
      { key: 'n', label: '数组长度', type: 'range', min: 8, max: 16, step: 2, default: 12 },
      { key: 'updates', label: '单点更新次数', type: 'range', min: 3, max: 6, step: 1, default: 4 },
      { key: 'seed', label: '随机种子', type: 'range', min: 1, max: 30, step: 1, default: 7 },
    ],
    height: H,
    legend: [
      { color: L.primary, label: '原数组 a[i]' },
      { color: L.success, label: '树状数组 tree[i]' },
      { color: L.warning, label: '当前 lowbit 跳转' },
    ],
    hint: '树状数组用 lowbit(i)=i&-i 划分覆盖区间：单点更新沿 i+=lowbit(i) 向上走，前缀和沿 i-=lowbit(i) 向下累加。',

    buildSteps(p) {
      const n = p.n, U = p.updates;
      const rnd = mulberry32((p.seed || 7) * 211 + 157);
      const arr = makeArray(n, 'random', (p.seed || 7) + 1);
      const bit = new Array(n + 1).fill(0);
      const steps = [];
      const snap = (note, extra = {}) => steps.push({
        arr: [...arr], bit: [...bit], active: extra.active || [],
        note, metrics: { 数组长度: n, 非零树节点: bit.filter((v) => v !== 0).length, 更新次数: U },
        ...extra,
      });
      snap(`初始化长度 ${String(n)} 的数组与全 0 的树状数组。`);
      for (let i = 1; i <= n; i++) {
        bit[i] += arr[i - 1];
        const j = i + (i & -i);
        if (j <= n) bit[j] += arr[i - 1];
        snap(`建树 i=${String(i)}：tree[${String(i)}]+=${String(arr[i - 1])}，lowbit=${String(i & -i)}${j <= n ? `，传播到 tree[${String(j)}]` : ''}。`);
      }
      for (let t = 0; t < U; t++) {
        const idx = 1 + Math.floor(rnd() * n);
        const delta = 1 + Math.floor(rnd() * 9);
        snap(`单点更新：a[${String(idx - 1)}] 增加 ${String(delta)}。`, { active: [] });
        for (let j = idx; j <= n; j += j & -j) {
          bit[j] += delta;
          snap(`沿 i+=lowbit 更新 tree[${String(j)}]，新值 ${String(bit[j])}。`, { active: [j] });
        }
      }
      for (let q = 0; q < 2; q++) {
        const k = q === 0 ? n : 1 + Math.floor(rnd() * n);
        let sum = 0;
        snap(`查询前缀和 prefix(${String(k)})：从 i=${String(k)} 开始累加。`);
        for (let j = k; j > 0; j -= j & -j) {
          sum += bit[j];
          snap(`累加 tree[${String(j)}]=${String(bit[j])}，当前和 ${String(sum)}，下一个 i=${String(j - (j & -j))}。`, { active: [j], prefixSum: sum });
        }
        snap(`前缀和 [1..${String(k)}] = ${String(sum)}。`, { active: [], prefixSum: sum });
      }
      snap(`演示结束：完成 ${String(U)} 次单点更新与 2 次前缀查询。`);
      return finalize(steps);
    },

    render(snap, p, c) {
      const arr = snap.arr || [];
      const bit = snap.bit || [];
      const active = snap.active || [];
      const n = Math.max(1, arr.length);
      const cw = Math.min(40, 660 / n);
      const cells = arr.map((v, i) => {
        const x = 26 + i * cw;
        const isAct = active.indexOf(i + 1) >= 0;
        return (
          <g key={`a${i}`}>
            <rect x={x} y="66" width={cw - 3} height="36" rx="3" fill={c.primary} opacity={isAct ? 0.95 : 0.72} />
            <text x={x + (cw - 3) / 2} y="89" textAnchor="middle" fontSize="10" fill={c.bg}>{String(v)}</text>
            <text x={x + (cw - 3) / 2} y="112" textAnchor="middle" fontSize="8" fill={c.muted}>{String(i)}</text>
            <rect x={x} y="142" width={cw - 3} height="36" rx="3" fill={isAct ? c.warning : c.success} opacity="0.85" />
            <text x={x + (cw - 3) / 2} y="165" textAnchor="middle" fontSize="10" fill={c.bg}>{String(bit[i + 1] || 0)}</text>
            <text x={x + (cw - 3) / 2} y="188" textAnchor="middle" fontSize="8" fill={c.muted}>{String(i + 1)}</text>
          </g>
        );
      });
      return (
        <Frame c={c} height={H} title="树状数组：lowbit 更新与前缀查询"
          subtitle={`n=${String(n)} · 更新 ${String(snap.metrics ? snap.metrics['更新次数'] : 0)} 次`}>
          <text x="26" y="52" fontSize="11" fill={c.muted}>原数组 a[i]（下标 0 起）</text>
          {cells}
          <text x="26" y="210" fontSize="11" fill={c.muted}>tree[i]（1 起，黄色为当前 lowbit 跳转节点）</text>
          <text x="26" y="238" fontSize="12" fill={c.text}>
            {snap.prefixSum === undefined ? '单点更新：i += lowbit(i)，逐级向上累加'
              : `当前前缀和 = ${String(snap.prefixSum)} · 查询沿 i -= lowbit(i) 回退`}
          </text>
        </Frame>
      );
    },
  },

  // ---------------------------------------------------------------- 后缀数组
  'suffix-array': {
    params: [
      { key: 'len', label: '字符串长度', type: 'range', min: 6, max: 10, step: 1, default: 8 },
      { key: 'seed', label: '随机种子', type: 'range', min: 1, max: 30, step: 1, default: 7 },
      { key: 'showLcp', label: '显示相邻 LCP', type: 'toggle', default: true },
    ],
    height: H,
    legend: [
      { color: L.primary, label: '已排定后缀' },
      { color: L.warning, label: '正在比较的后缀' },
      { color: L.success, label: '本轮确定位置' },
    ],
    hint: '后缀数组把所有后缀按字典序排序：排序后相同前缀的后缀相邻，配合高度数组 LCP 可快速解决子串匹配与重复统计。',

    buildSteps(p) {
      const len = p.len;
      const rnd = mulberry32((p.seed || 7) * 223 + 173);
      const letters = 'abcd';
      let s = '';
      for (let i = 0; i < len - 1; i++) s += letters[Math.floor(rnd() * letters.length)];
      s += '$'; // 唯一最小哨兵，保证后缀互不相同
      const suffixes = Array.from({ length: s.length }, (_, i) => ({ i, text: s.slice(i) }));
      const steps = [];
      const snap = (note, extra = {}) => steps.push({
        s, order: suffixes.map((o) => ({ ...o })),
        comparing: extra.comparing || [], fixed: extra.fixed || 0,
        note, metrics: { 后缀数: s.length, 已排定: extra.fixed || 0, 比较次数: compareCount },
        ...extra,
      });
      let compareCount = 0;
      snap(`生成字符串 ${s}（含哨兵 $），共有 ${String(s.length)} 个后缀待排序。`);
      // 插入排序：逐次把 suffixes[k] 插入到已排好序的前缀中，记录每次字典序比较。
      for (let k = 1; k < suffixes.length; k++) {
        const cur = suffixes[k];
        let j = k - 1;
        snap(`取第 ${String(k + 1)} 个后缀 ${cur.text}，插入前面的有序区。`);
        while (j >= 0) {
          compareCount++;
          const a = suffixes[j].text, b = cur.text;
          snap(`比较 ${a} 与 ${b}（第 ${String(compareCount)} 次）。`, { comparing: [j, j + 1], fixed: k });
          const less = a < b;
          if (less) break;
          suffixes[j + 1] = suffixes[j];
          snap(`${b} 字典序更小，${a} 后移一位。`, { comparing: [j, j + 1], fixed: k });
          j--;
        }
        suffixes[j + 1] = cur;
        snap(`插入 ${cur.text} 到位置 ${String(j + 1)}，前 ${String(k + 1)} 个后缀已有序。`, { fixed: k + 1 });
      }
      const lcp = (a, b) => {
        let i = 0;
        while (i < a.length && i < b.length && a[i] === b[i]) i++;
        return i;
      };
      for (let i = 0; i < suffixes.length - 1; i++) {
        if (p.showLcp) snap(`相邻后缀 ${suffixes[i].text} 与 ${suffixes[i + 1].text} 的 LCP = ${String(lcp(suffixes[i].text, suffixes[i + 1].text))}。`, { comparing: [i, i + 1], fixed: suffixes.length });
      }
      snap(`排序完成：后缀数组为 ${suffixes.map((o) => String(o.i)).join(', ')}。`);
      return finalize(steps);
    },

    render(snap, p, c) {
      const order = snap.order || [];
      const comparing = snap.comparing || [];
      const fixed = num(snap.fixed, 0);
      const rowH = Math.min(24, (H - 96) / Math.max(1, order.length));
      const rows = order.map((o, i) => {
        const y = 56 + i * rowH;
        let col = i < fixed ? c.primary : c.border;
        if (comparing.indexOf(i) >= 0) col = c.warning;
        else if (i < fixed && i === fixed - 1) col = c.success;
        return (
          <g key={`s${i}`}>
            <rect x="24" y={y} width="672" height={Math.max(3, rowH - 3)} rx="2" fill={col} opacity={comparing.indexOf(i) >= 0 ? 0.9 : 0.35} />
            <text x="36" y={y + rowH / 2 + 2} fontSize="11" fill={c.text}>{String(o.text)}</text>
            <text x="360" y={y + rowH / 2 + 2} fontSize="10" textAnchor="middle" fill={c.muted}>{`起始 ${String(o.i)}`}</text>
            <text x="686" y={y + rowH / 2 + 2} fontSize="10" textAnchor="end" fill={c.muted}>{`排名 ${String(i)}`}</text>
          </g>
        );
      });
      return (
        <Frame c={c} height={H} title="后缀数组：字典序排序与 LCP"
          subtitle={`字符串 ${String(snap.s || '')} · 已排定 ${String(fixed)} / ${String(order.length)}`}>
          <text x="24" y="46" fontSize="11" fill={c.muted}>所有后缀按字典序排列（黄色=正在比较）</text>
          {rows}
          <text x="24" y={H - 12} fontSize="11" fill={c.muted}>
            {`比较 ${String(snap.metrics ? snap.metrics['比较次数'] : 0)} 次 · 相同前缀的后缀在数组中相邻`}
          </text>
        </Frame>
      );
    },
  },

  // ---------------------------------------------------------------- 一致性哈希
  'consistent-hashing': {
    params: [
      { key: 'nodes', label: '真实节点数', type: 'range', min: 2, max: 5, step: 1, default: 3 },
      { key: 'vnode', label: '每节点虚拟节点', type: 'range', min: 2, max: 4, step: 1, default: 3 },
      { key: 'keys', label: '数据键数', type: 'range', min: 6, max: 12, step: 1, default: 8 },
      { key: 'seed', label: '随机种子', type: 'range', min: 1, max: 30, step: 1, default: 7 },
    ],
    height: H,
    legend: [
      { color: L.primary, label: '真实节点' },
      { color: L.series[4], label: '虚拟节点' },
      { color: L.success, label: '已归属数据键' },
      { color: L.warning, label: '迁移中的数据键' },
    ],
    hint: '一致性哈希把节点和键映射到同一个环：键顺时针找到首个节点；扩容只迁移新增节点与后继之间的少量键，虚拟节点让分布更均匀。',

    buildSteps(p) {
      const NODE = p.nodes, VN = p.vnode, K = p.keys;
      const rnd = mulberry32((p.seed || 7) * 233 + 191);
      const hash = (str) => {
        let x = 2166136261;
        for (let i = 0; i < str.length; i++) { x ^= str.charCodeAt(i); x = Math.imul(x, 16777619); }
        return (x >>> 0) / 4294967296;
      };
      const ring = [];
      const steps = [];
      const snap = (note, extra = {}) => steps.push({
        ring: ring.map((r) => ({ ...r })), keys: (extra.keysState || []).map((k) => ({ ...k })),
        phase: extra.phase || 'build', note,
        metrics: { 真实节点: NODE, 虚拟节点: ring.length, 数据键: K, 迁移键数: (extra.keysState || []).filter((k) => k.moved).length },
        ...extra,
      });
      const addNode = (node) => {
        for (let v = 0; v < VN; v++) {
          const pos = hash(`n${node}-v${v}`);
          ring.push({ pos, node, vn: v });
          snap(`节点 ${String(node)} 的虚拟节点 v${String(v)} 落到环上位置 ${pos.toFixed(3)}。`, { phase: 'ring' });
        }
        ring.sort((a, b) => a.pos - b.pos);
      };
      const ownerOf = (pos) => {
        for (const r of ring) if (r.pos >= pos) return r.node;
        return ring.length ? ring[0].node : 0;
      };
      snap(`初始化哈希环：${String(NODE)} 个真实节点，每个 ${String(VN)} 个虚拟节点。`);
      for (let nd = 0; nd < NODE; nd++) addNode(nd);
      const keyList = [];
      for (let i = 0; i < K; i++) {
        const pos = hash(`key${i}`);
        const owner = ownerOf(pos);
        keyList.push({ id: i, pos, owner, moved: false });
        snap(`数据键 k${String(i)} 哈希到 ${pos.toFixed(3)}，顺时针归属节点 ${String(owner)}。`, { phase: 'assign', keysState: keyList });
        snap(`确认 k${String(i)} → 节点 ${String(owner)} 的映射写入路由表。`, { phase: 'assign', keysState: keyList });
      }
      const before = keyList.map((k) => k.owner);
      const newNode = NODE;
      addNode(newNode);
      snap(`扩容：新增节点 ${String(newNode)} 及其 ${String(VN)} 个虚拟节点加入环。`, { phase: 'grow', keysState: keyList });
      let moved = 0;
      for (const k of keyList) {
        const now = ownerOf(k.pos);
        if (now !== k.owner) {
          k.owner = now; k.moved = true; moved++;
          snap(`键 k${String(k.id)} 从节点 ${String(before[k.id])} 迁移到新节点 ${String(now)}。`, { phase: 'migrate', keysState: keyList });
        }
      }
      snap(`扩容完成：仅 ${String(moved)} / ${String(K)} 个键迁移，其余键位置不变。`);
      return finalize(steps);
    },

    render(snap, p, c) {
      const ring = snap.ring || [];
      const keys = snap.keys || [];
      const cx = 360, cy = 162, r = 108;
      const xy = (pos, radius) => {
        const a = pos * Math.PI * 2 - Math.PI / 2;
        return { x: cx + radius * Math.cos(a), y: cy + radius * Math.sin(a) };
      };
      const vnodes = ring.map((it, i) => {
        const q = xy(it.pos, r);
        return (
          <g key={`v${i}`}>
            <circle cx={q.x} cy={q.y} r="3.6" fill={c.series[it.node % c.series.length]} opacity="0.9" />
          </g>
        );
      });
      const seen = new Set();
      const realNodes = ring.filter((it) => {
        if (seen.has(it.node)) return false;
        seen.add(it.node);
        return true;
      }).map((it, i) => {
        const q = xy(it.pos, r + 20);
        const inner = xy(it.pos, r);
        return (
          <g key={`n${i}`}>
            <line x1={cx} y1={cy} x2={inner.x} y2={inner.y} stroke={c.border} strokeWidth="1" />
            <circle cx={inner.x} cy={inner.y} r="7" fill={c.series[it.node % c.series.length]} />
            <text x={q.x} y={q.y + 3} fontSize="10" textAnchor="middle" fill={c.text}>{`N${String(it.node)}`}</text>
          </g>
        );
      });
      const keyEls = keys.map((k, i) => {
        const q = xy(k.pos, r - 12);
        const own = ring.find((it) => it.node === k.owner);
        const o = own ? xy(own.pos, r) : { x: cx, y: cy };
        const col = k.moved ? c.warning : c.success;
        return (
          <g key={`k${i}`}>
            <line x1={q.x} y1={q.y} x2={o.x} y2={o.y} stroke={col} strokeWidth="1" opacity="0.55" />
            <circle cx={q.x} cy={q.y} r="3.2" fill={col} />
          </g>
        );
      });
      const phase = String(snap.phase || 'build');
      return (
        <Frame c={c} height={H} title="一致性哈希：虚拟节点与环上迁移"
          subtitle={`真实节点 ${String(p.nodes)} · 虚拟节点 ${String(ring.length)} · 键 ${String(keys.length)}`}>
          <circle cx={cx} cy={cy} r={r} fill="none" stroke={c.border} strokeWidth="1.5" />
          <circle cx={cx} cy={cy} r={r - 12} fill="none" stroke={c.grid} strokeWidth="1" strokeDasharray="3 4" />
          {vnodes}
          {realNodes}
          {keyEls}
          <text x="24" y="42" fontSize="11" fill={c.muted}>环上位置按哈希值 0~1 排列（外圈=真实节点，小点=虚拟节点，内点=数据键）</text>
          <text x="24" y={H - 14} fontSize="11" fill={c.text}>
            {phase === 'migrate' ? '扩容迁移：仅移动受影响区间的键'
              : (phase === 'grow' ? '新增节点入环，重新计算键归属'
                : (phase === 'assign' ? '数据键顺时针寻找首个节点' : '构建哈希环与虚拟节点'))}
          </text>
          <text x="696" y={H - 14} fontSize="11" textAnchor="end" fill={c.muted}>
            {`迁移 ${String(keys.filter((k) => k.moved).length)} / ${String(keys.length)} 键`}
          </text>
        </Frame>
      );
    },
  },
};
