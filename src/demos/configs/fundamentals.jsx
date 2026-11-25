import React from 'react';
import { mulberry32, makeArray, makePoints, clamp, DIST_OPTIONS } from '../utils.js';
import { Frame, Bars, Cells, Matrix, Curves, GraphView, Scatter, Flow, Timeline, TextPanel, Radial, HeatBars, num, fmt } from '../kits/primitives.jsx';

// 帧数上限与补帧：保证首帧、末帧始终保留，且任意边界参数下都有 20 帧以上。
function finish(steps) {
  let out = steps;
  if (out.length > 600) {
    const stride = Math.ceil(out.length / 600);
    out = out.filter((_, i) => i % stride === 0 || i === out.length - 1);
    if (out.length > 600) out = out.slice(0, 599).concat(out[out.length - 1]);
  }
  let guard = 0;
  while (out.length < 20 && guard++ < 80) {
    const first = out[0] || { note: '准备' };
    out.splice(1, 0, { ...first, note: `准备步骤 ${out.length + 1}：${first.note}`, warm: out.length });
  }
  return out;
}

function shuffledLetters(rnd, len, pool) {
  return Array.from({ length: len }, () => pool[Math.floor(rnd() * pool.length)]);
}

export default {
  'shell-sort': {
    params: [
      { key: 'n', label: '元素个数', type: 'range', min: 8, max: 36, step: 1, default: 16 },
      { key: 'dist', label: '初始分布', type: 'select', default: 'random', options: DIST_OPTIONS },
      { key: 'seed', label: '随机种子', type: 'range', min: 1, max: 30, step: 1, default: 7 },
      { key: 'gaps', label: '间隔序列', type: 'select', default: 'knuth',
        options: [{ value: 'knuth', label: 'Knuth：1,4,13…' }, { value: 'half', label: '折半：n/2,n/4…' }] },
    ],
    height: 320,
    legend: [
      { color: '#226AFF', label: '分组内元素（同色=同组）' },
      { color: '#f5a524', label: '正在比较' },
      { color: '#e5484d', label: '元素后移' },
      { color: '#12a06a', label: '完成' },
    ],
    hint: '间隔 g 把下标模 g 相同的元素分成一组，每组做插入排序；g 逐步缩小到 1。',
    buildSteps(p) {
      const a = makeArray(p.n, p.dist, p.seed);
      const seq = [];
      if (p.gaps === 'half') {
        for (let g = Math.floor(a.length / 2); g >= 1; g = Math.floor(g / 2)) seq.push(g);
      } else {
        let g = 1;
        while (g < a.length) { seq.push(g); g = g * 3 + 1; }
        seq.reverse();
      }
      if (!seq.length) seq.push(1);
      const steps = [];
      let cmp = 0, moves = 0, curGap = seq[0];
      const push = (note, extra = {}) => steps.push({
        arr: [...a], seq: [...seq], gap: curGap, pass: Math.max(0, seq.indexOf(curGap)),
        focus: [], shifted: [], done: false, note,
        metrics: { 比较次数: cmp, 移动次数: moves, 当前间隔: curGap },
        ...extra,
      });
      push(`初始数组 ${a.length} 个元素；间隔序列 ${seq.join(' → ')}。`);
      for (const g of seq) {
        curGap = g;
        push(`第 ${seq.indexOf(g) + 1} 轮：间隔 ${g}，下标模 ${g} 相同者为一组。`);
        for (let i = g; i < a.length; i++) {
          const tmp = a[i];
          let j = i;
          push(`处理下标 ${i}（第 ${i % g} 组），待插入值 ${tmp}。`, { focus: [i, i - g] });
          while (j >= g) {
            cmp++;
            push(`组间比较 a[${j - g}]=${a[j - g]} 与 ${tmp}。`, { focus: [j, j - g] });
            if (a[j - g] <= tmp) break;
            a[j] = a[j - g]; moves++; j -= g;
            push(`a[${j + g}] 后移到 a[${j}]，空位前移。`, { focus: [j, j + g], shifted: [j] });
          }
          a[j] = tmp; moves++;
          push(`把 ${tmp} 写入下标 ${j}，本组局部有序。`, { focus: [j] });
        }
        push(`间隔 ${g} 的所有分组插入完成。`);
      }
      push(`排序完成：比较 ${cmp} 次，移动 ${moves} 次。`, { done: true, gap: 1, focus: [] });
      return finish(steps);
    },
    render(snap, p, c) {
      const arr = snap.arr || [];
      const seq = snap.seq || [];
      const gap = Math.max(1, num(snap.gap, 1));
      const focus = snap.focus || [];
      const shifted = snap.shifted || [];
      const colors = {}, highlight = {}, marks = {};
      if (snap.done) {
        arr.forEach((_, i) => { highlight[i] = 'done'; });
      } else {
        if (gap > 1) arr.forEach((_, i) => { colors[i] = c.series[(i % gap) % c.series.length]; });
        shifted.forEach((i) => { highlight[i] = 'warn'; colors[i] = undefined; });
        focus.forEach((i, k) => { highlight[i] = k === 0 ? 'current' : 'compare'; colors[i] = undefined; });
      }
      if (arr.length <= 20) arr.forEach((_, i) => { marks[i] = String(i % gap); });
      return (
        <Bars c={c} height={320} values={arr} colors={colors} highlight={highlight} marks={marks}
          title="希尔排序 · 分组插入" subtitle={String(`gap=${gap} · 轮次 ${num(snap.pass, 0) + 1} · 序列 ${seq.join(',')}`)}
          baselineLabel={String(snap.done ? '全部有序' : `比较 ${num(snap.metrics && snap.metrics['比较次数'])} 次 · 移动 ${num(snap.metrics && snap.metrics['移动次数'])} 次 · 色块=分组`)} />
      );
    },
  },

  'counting-sort': {
    params: [
      { key: 'n', label: '元素个数', type: 'range', min: 8, max: 18, step: 1, default: 14 },
      { key: 'k', label: '值域大小（0..k-1）', type: 'range', min: 6, max: 14, step: 1, default: 10 },
      { key: 'seed', label: '随机种子', type: 'range', min: 1, max: 30, step: 1, default: 7 },
    ],
    height: 320,
    legend: [
      { color: '#226AFF', label: '原始数组' },
      { color: '#f5a524', label: '计数 / 累加' },
      { color: '#12a06a', label: '输出数组' },
      { color: '#e5484d', label: '当前位置' },
    ],
    hint: '先统计每个值出现次数，再做前缀和得到每个值的终止位置，最后从右向左稳定地输出。',
    buildSteps(p) {
      const rnd = mulberry32(p.seed * 31 + 5);
      const arr = Array.from({ length: p.n }, () => Math.floor(rnd() * p.k));
      const cnt = Array(p.k).fill(0);
      const out = Array(p.n).fill(null);
      const steps = [];
      let phase = 'count', ci = -1, cj = -1, oi = -1, placed = 0;
      const push = (note, extra = {}) => steps.push({
        arr: [...arr], cnt: [...cnt], out: [...out], phase, ci, cj, oi, placed, done: false, note,
        metrics: { 已计数: ci + 1, 已累加: cj + 1, 已输出: placed, 值域: p.k },
        ...extra,
      });
      push(`生成 ${p.n} 个 [0,${p.k - 1}] 的整数，计数数组长度 ${p.k}。`);
      for (let i = 0; i < arr.length; i++) {
        ci = i; phase = 'count';
        const v = arr[i]; cnt[v]++;
        push(`读入 arr[${i}]=${v}，count[${v}] 增加到 ${cnt[v]}。`);
      }
      phase = 'prefix'; cj = 0;
      let acc = 0;
      for (let j = 0; j < cnt.length; j++) {
        acc += cnt[j]; cnt[j] = acc; cj = j;
        push(`前缀和：count[${j}]=${acc}，表示值 ${j} 的最后一个输出位置为下标 ${acc - 1}。`);
      }
      phase = 'output';
      for (let i = arr.length - 1; i >= 0; i--) {
        const v = arr[i];
        const pos = --cnt[v];
        out[pos] = v; oi = i; placed++;
        push(`从右向左取 arr[${i}]=${v}，放入输出下标 ${pos}（count[${v}] 减 1，保证稳定）。`);
      }
      push(`稳定输出完成，共 ${placed} 个元素。`, { done: true, phase: 'done', ci: -1, cj: -1, oi: -1 });
      return finish(steps);
    },
    render(snap, p, c) {
      const arr = snap.arr || [], cnt = snap.cnt || [], out = snap.out || [];
      const wrap = Math.max(arr.length, cnt.length, 4);
      const items = [];
      arr.forEach((v, i) => items.push({
        text: String(v), sub: String(i),
        color: snap.done || snap.oi === i && snap.phase === 'output' ? c.success : (snap.ci === i && snap.phase === 'count' ? c.danger : c.primary),
      }));
      cnt.forEach((v, j) => items.push({
        text: String(v), sub: `值${j}`,
        color: snap.cj === j && snap.phase === 'prefix' ? c.warning : (snap.phase === 'output' && snap.oi >= 0 && arr[snap.oi] === j ? c.danger : c.purple),
      }));
      out.forEach((v, i) => items.push({
        text: v === null ? '·' : String(v), sub: String(i),
        color: v === null ? c.border : c.success,
      }));
      return (
        <Cells c={c} height={320} items={items} wrap={wrap} cellW={30} cellH={32} gap={4}
          title="计数排序 · 原数组 / 计数 / 输出" subtitle={String(`阶段 ${String(snap.phase || 'count')} · 已输出 ${num(snap.placed)}`)} />
      );
    },
  },

  'radix-sort': {
    params: [
      { key: 'n', label: '元素个数', type: 'range', min: 8, max: 18, step: 1, default: 12 },
      { key: 'digits', label: '位数', type: 'range', min: 2, max: 4, step: 1, default: 3 },
      { key: 'seed', label: '随机种子', type: 'range', min: 1, max: 30, step: 1, default: 7 },
    ],
    height: 400,
    legend: [
      { color: '#f5a524', label: '当前桶' },
      { color: '#226AFF', label: '数组元素' },
      { color: '#12a06a', label: '排序完成' },
      { color: '#7c5cff', label: '桶（0~9）' },
    ],
    hint: '从个位到高位，每轮按当前位把元素分进 0~9 号桶，再按桶号顺序稳定拼接。',
    buildSteps(p) {
      const rnd = mulberry32(p.seed * 37 + 11);
      const limit = Math.pow(10, p.digits);
      const arr = Array.from({ length: p.n }, () => Math.floor(rnd() * limit));
      const steps = [];
      let pass = 0, ci = -1, cb = -1, cmp = 0;
      const push = (note, extra = {}) => steps.push({
        arr: [...arr], buckets: (extra.buckets || []).map((b) => [...b]), pass, ci, cb, done: false, note,
        metrics: { 当前位: pass + 1, 已分配: ci + 1, 桶数: 10, 分配次数: cmp },
        ...extra,
      });
      push(`初始数组（${p.digits} 位数，共 ${p.n} 个），从个位开始分配。`);
      for (pass = 0; pass < p.digits; pass++) {
        const factor = Math.pow(10, pass);
        const buckets = Array.from({ length: 10 }, () => []);
        push(`第 ${pass + 1} 轮：取第 ${pass + 1} 位（10^${pass} 位）分桶。`, { buckets });
        for (let i = 0; i < arr.length; i++) {
          const d = Math.floor(arr[i] / factor) % 10;
          buckets[d].push(arr[i]); cmp++; ci = i; cb = d;
          push(`arr[${i}]=${arr[i]} 的第 ${pass + 1} 位是 ${d}，放入 ${d} 号桶。`, { buckets });
        }
        const next = [];
        for (let b = 0; b < buckets.length; b++) {
          cb = b;
          push(`顺序取出 ${b} 号桶的 ${buckets[b].length} 个元素。`, { buckets });
          for (const v of buckets[b]) next.push(v);
        }
        arr.splice(0, arr.length, ...next);
        push(`第 ${pass + 1} 轮拼接完成：${arr.join(', ')}。`, { buckets, ci: -1, cb: -1 });
      }
      push(`基数排序完成，比较/分配 ${cmp} 次。`, { done: true, pass: p.digits, buckets: Array.from({ length: 10 }, () => []) });
      return finish(steps);
    },
    render(snap, p, c) {
      const arr = snap.arr || [], buckets = snap.buckets || [];
      const items = [];
      for (let b = 0; b < 10; b++) {
        const list = buckets[b] || [];
        items.push({
          text: list.length ? list.join(',').slice(0, 11) : '空',
          sub: `桶${b}(${list.length})`,
          color: snap.cb === b ? c.warning : (list.length ? c.purple : c.border),
        });
      }
      arr.forEach((v, i) => items.push({
        text: String(v), sub: String(i),
        color: snap.done ? c.success : (snap.ci === i ? c.danger : c.primary),
      }));
      return (
        <Cells c={c} height={400} items={items} wrap={10} cellW={56} cellH={38} gap={5}
          title="基数排序 · 0~9 号桶 / 当前数组" subtitle={String(snap.done ? '排序完成' : `第 ${num(snap.pass, 0) + 1} 位分配 · 当前桶 ${num(snap.cb, -1) < 0 ? '-' : String(num(snap.cb))}`)} />
      );
    },
  },

  'bucket-sort': {
    params: [
      { key: 'n', label: '元素个数', type: 'range', min: 8, max: 20, step: 1, default: 14 },
      { key: 'buckets', label: '桶数量', type: 'range', min: 3, max: 8, step: 1, default: 5 },
      { key: 'dist', label: '数据分布', type: 'select', default: 'uniform',
        options: [{ value: 'uniform', label: '均匀分布' }, { value: 'clustered', label: '聚集分布' }] },
      { key: 'seed', label: '随机种子', type: 'range', min: 1, max: 30, step: 1, default: 7 },
    ],
    height: 340,
    legend: [
      { color: '#226AFF', label: '桶内元素' },
      { color: '#f5a524', label: '当前桶' },
      { color: '#e5484d', label: '桶边界' },
      { color: '#12a06a', label: '已完成' },
    ],
    hint: '按数值比例把 [0,100) 映射到 k 个桶，桶内用插入排序，再按桶号从小到大拼接。',
    buildSteps(p) {
      const rnd = mulberry32(p.seed * 17 + 3);
      const arr = Array.from({ length: p.n }, () => p.dist === 'clustered'
        ? clamp(45 + (rnd() - 0.5) * 28 + (rnd() < 0.35 ? 35 : 0), 0, 99.99)
        : rnd() * 100);
      const k = p.buckets;
      const buckets = Array.from({ length: k }, () => []);
      const steps = [];
      let phase = 'boundary', ci = -1, bi = -1, cmp = 0;
      const push = (note, extra = {}) => steps.push({
        arr: [...arr], buckets: buckets.map((b) => b.slice()), k, phase, ci, bi, done: false, note,
        metrics: { 桶数: k, 已分配: ci + 1, 桶内比较: cmp },
        ...extra,
      });
      push(`生成 ${p.n} 个 [0,100) 的数，划分 ${k} 个桶，每桶宽度 ${fmt(100 / k, 2)}。`);
      for (let b = 0; b < k; b++) {
        bi = b;
        push(`桶 ${b} 覆盖区间 [${fmt(b * 100 / k, 1)}, ${fmt((b + 1) * 100 / k, 1)})。`);
      }
      phase = 'distribute';
      for (let i = 0; i < arr.length; i++) {
        const b = clamp(Math.floor(arr[i] / 100 * k), 0, k - 1);
        buckets[b].push({ v: arr[i], i }); ci = i; bi = b;
        push(`${fmt(arr[i], 1)} 落入 ${b} 号桶。`);
      }
      phase = 'sort';
      for (let b = 0; b < k; b++) {
        bi = b;
        push(`桶 ${b} 内有 ${buckets[b].length} 个元素，开始插入排序。`);
        for (let i = 1; i < buckets[b].length; i++) {
          const cur = buckets[b][i]; let j = i - 1;
          cmp++;
          push(`桶 ${b}：比较 ${fmt(cur.v, 1)} 与 ${fmt(buckets[b][j].v, 1)}。`);
          while (j >= 0 && buckets[b][j].v > cur.v) {
            buckets[b][j + 1] = buckets[b][j]; j--; cmp++;
          }
          buckets[b][j + 1] = cur;
          push(`桶 ${b}：把 ${fmt(cur.v, 1)} 插入到位置 ${j + 1}。`);
        }
      }
      phase = 'concat';
      const sorted = [];
      for (let b = 0; b < k; b++) {
        bi = b;
        for (const it of buckets[b]) {
          sorted.push(it.v); ci = it.i;
          push(`拼接 ${b} 号桶：输出 ${fmt(it.v, 1)}。`);
        }
      }
      push(`桶排序完成，共输出 ${sorted.length} 个数。`, { done: true, phase: 'done', ci: -1, bi: -1, arr: sorted });
      return finish(steps);
    },
    render(snap, p, c) {
      const arr = snap.arr || [], buckets = snap.buckets || [], k = Math.max(1, num(snap.k, 5));
      const phase = String(snap.phase || 'boundary');
      const points = [];
      arr.forEach((v, i) => {
        const b = clamp(Math.floor(v / 100 * k), 0, k - 1);
        const inBucket = buckets[b] || [];
        const sortedIndex = inBucket.findIndex((it) => it.i === i);
        points.push({
          x: num(v), y: snap.done ? 0.6 : b + 0.6 + (i % 3) * 0.07,
          r: snap.ci === i && !snap.done ? 6 : 4,
          color: snap.done ? c.success : (snap.bi === b ? c.warning : c.series[b % c.series.length]),
        });
      });
      const centers = [];
      for (let b = 0; b <= k; b++) centers.push({ x: b * 100 / k, y: -0.2, label: `${b}`, color: c.danger });
      return (
        <Scatter c={c} height={340} points={points} centers={centers}
          bounds={{ xmin: -5, xmax: 105, ymin: -0.6, ymax: k + 1.1 }}
          title="桶排序 · 数据分布与桶边界" subtitle={String(`阶段 ${phase} · 当前桶 ${num(snap.bi, -1) < 0 ? '-' : String(num(snap.bi))} · 比较 ${num(snap.metrics && snap.metrics['桶内比较'])}`)} />
      );
    },
  },

  'tim-sort': {
    params: [
      { key: 'n', label: '元素个数', type: 'range', min: 12, max: 32, step: 1, default: 20 },
      { key: 'minRun', label: '最小 run 长度', type: 'range', min: 4, max: 8, step: 1, default: 5 },
      { key: 'dist', label: '初始分布', type: 'select', default: 'random', options: DIST_OPTIONS },
      { key: 'seed', label: '随机种子', type: 'range', min: 1, max: 30, step: 1, default: 7 },
    ],
    height: 320,
    legend: [
      { color: '#226AFF', label: '自然 run（同色=同一段）' },
      { color: '#f5a524', label: '正在归并' },
      { color: '#0ea5a5', label: '正在补齐 run' },
      { color: '#12a06a', label: '归并完成' },
    ],
    hint: '先识别天然有序段（run），下降段反转、过短段用插入排序补齐，再按栈规则两两归并。',
    buildSteps(p) {
      const a = makeArray(p.n, p.dist, p.seed);
      const steps = [];
      let phase = 'detect', cmp = 0, moves = 0;
      let runs = [], cur = [], focus = [], extend = -1;
      const runOf = () => {
        const owner = Array(a.length).fill(-1);
        runs.forEach((r, idx) => { for (let i = r[0]; i < r[1]; i++) owner[i] = idx; });
        return owner;
      };
      const push = (note, extra = {}) => steps.push({
        arr: [...a], runs: runs.map((r) => [...r]), owner: runOf(), phase,
        focus: [...focus], extend, done: false, note,
        metrics: { run段数: runs.length, 比较次数: cmp, 移动次数: moves },
        ...extra,
      });
      push(`初始数组 ${a.length} 个；先识别自然有序段，最小 run=${p.minRun}。`);
      let i = 0;
      while (i < a.length) {
        const lo = i;
        if (i + 1 >= a.length) { runs.push([lo, a.length]); break; }
        const desc = a[i] > a[i + 1];
        i++;
        while (i < a.length && (desc ? a[i - 1] >= a[i] : a[i - 1] <= a[i])) {
          cmp++;
          focus = [i - 1, i];
          push(`第 ${desc ? '下降' : '上升'} run 从 ${lo} 扩展到下标 ${i}。`);
          i++;
        }
        if (desc) {
          for (let l = lo, r = i - 1; l < r; l++, r--) { const t = a[l]; a[l] = a[r]; a[r] = t; moves++; }
          push(`下降 run [${lo},${i - 1}] 已反转为升序。`);
        }
        runs.push([lo, i]);
        push(`识别到 run [${lo},${i - 1}]，长度 ${i - lo}。`);
      }
      phase = 'extend';
      for (let r = 0; r < runs.length; r++) {
        while (runs[r][1] - runs[r][0] < p.minRun && runs[r][1] < a.length) {
          const hi = runs[r][1];
          const v = a[hi];
          let lo = runs[r][0], h = hi;
          while (lo < h) {
            const mid = (lo + h) >> 1; cmp++;
            focus = [mid, hi];
            push(`补齐 run ${r}：在 [${runs[r][0]},${hi - 1}] 中二分定位 ${v}，比较下标 ${mid}。`);
            if (a[mid] <= v) lo = mid + 1; else h = mid;
          }
          for (let k = hi; k > lo; k--) { a[k] = a[k - 1]; moves++; }
          a[lo] = v; moves++;
          const oldEnd = runs[r][1];
          runs[r][1] = hi + 1; extend = hi;
          if (r + 1 < runs.length && runs[r + 1][0] === oldEnd) {
            runs[r + 1][0] = oldEnd + 1;
            if (runs[r + 1][0] >= runs[r + 1][1]) runs.splice(r + 1, 1);
          }
          push(`把 ${v} 插入位置 ${lo}，run ${r} 长度变为 ${runs[r][1] - runs[r][0]}。`);
        }
      }
      phase = 'merge';
      while (runs.length > 1) {
        const L = runs[0], R = runs[1];
        const tmp = [];
        let x = L[0], y = R[0];
        push(`归并 run [${L[0]},${L[1] - 1}] 与 [${R[0]},${R[1] - 1}]。`);
        while (x < L[1] && y < R[1]) {
          cmp++; focus = [x, y];
          push(`比较 a[${x}]=${a[x]} 与 a[${y}]=${a[y]}，取较小者。`);
          if (a[x] <= a[y]) tmp.push(a[x++]); else tmp.push(a[y++]);
        }
        while (x < L[1]) tmp.push(a[x++]);
        while (y < R[1]) tmp.push(a[y++]);
        for (let k = 0; k < tmp.length; k++) { a[L[0] + k] = tmp[k]; moves++; }
        runs.splice(0, 2, [L[0], R[1]]);
        focus = [];
        push(`归并完成：区间 [${L[0]},${R[1] - 1}] 有序，剩余 ${runs.length} 个 run。`);
      }
      push(`TimSort 完成：比较 ${cmp} 次，移动 ${moves} 次。`, { done: true, phase: 'done', focus: [] });
      return finish(steps);
    },
    render(snap, p, c) {
      const arr = snap.arr || [], owner = snap.owner || [], focus = snap.focus || [];
      const colors = {}, highlight = {}, marks = {};
      arr.forEach((_, i) => {
        const g = num(owner[i], 0);
        colors[i] = c.series[g % c.series.length];
      });
      focus.forEach((i) => { highlight[i] = 'warn'; });
      if (snap.done) arr.forEach((_, i) => { highlight[i] = 'done'; });
      if (arr.length <= 20) arr.forEach((_, i) => { marks[i] = String(num(owner[i], 0)); });
      return (
        <Bars c={c} height={320} values={arr} colors={colors} highlight={highlight} marks={marks}
          title="TimSort · 自然 run 与归并" subtitle={String(`阶段 ${String(snap.phase || 'detect')} · run 数 ${(snap.runs || []).length}`)}
          baselineLabel={String(snap.done ? '全部有序' : `比较 ${num(snap.metrics && snap.metrics['比较次数'])} 次 · 移动 ${num(snap.metrics && snap.metrics['移动次数'])} 次`)} />
      );
    },
  },

  'linear-search': {
    params: [
      { key: 'n', label: '元素个数', type: 'range', min: 10, max: 24, step: 1, default: 14 },
      { key: 'target', label: '目标值', type: 'range', min: 1, max: 100, step: 1, default: 42 },
      { key: 'dist', label: '初始分布', type: 'select', default: 'random', options: DIST_OPTIONS },
      { key: 'seed', label: '随机种子', type: 'range', min: 1, max: 30, step: 1, default: 7 },
    ],
    height: 320,
    legend: [
      { color: '#f5a524', label: '正在比较' },
      { color: '#7D87AB', label: '已扫描' },
      { color: '#12a06a', label: '命中目标' },
      { color: '#226AFF', label: '未扫描' },
    ],
    hint: '不要求有序，从下标 0 逐个比较；演示中继续扫描以找出所有等于目标值的位置。',
    buildSteps(p) {
      const arr = makeArray(p.n, p.dist, p.seed);
      const steps = [];
      let cmp = 0; const hits = [];
      const push = (note, extra = {}) => steps.push({
        arr: [...arr], target: p.target, i: -1, hits: [...hits], cmp, done: false, note,
        metrics: { 比较次数: cmp, 命中数: hits.length, 数组长度: arr.length },
        ...extra,
      });
      push(`无序数组长度 ${arr.length}，目标值 ${p.target}，从下标 0 开始。`);
      for (let i = 0; i < arr.length; i++) {
        push(`准备扫描下标 ${i}，此前已比较 ${cmp} 次。`, { i });
        cmp++;
        if (arr[i] === p.target) {
          hits.push(i);
          push(`arr[${i}]=${arr[i]} 命中目标 ${p.target}，记录下标 ${i}。`, { i, hit: true });
        } else {
          push(`arr[${i}]=${arr[i]} ≠ ${p.target}，继续向后。`, { i });
        }
      }
      push(`扫描结束：比较 ${cmp} 次，命中 ${hits.length} 处（${hits.length ? hits.join(', ') : '无'}）。`, { done: true, i: -1 });
      return finish(steps);
    },
    render(snap, p, c) {
      const arr = snap.arr || [], hits = snap.hits || [], target = num(snap.target, 0), i = num(snap.i, -1);
      const highlight = {}, marks = {};
      arr.forEach((_, k) => { marks[k] = String(k); });
      if (snap.done) {
        hits.forEach((k) => { highlight[k] = 'hit'; });
      } else {
        for (let k = 0; k < i; k++) highlight[k] = 'muted';
        if (i >= 0 && i < arr.length) highlight[i] = hits.includes(i) ? 'hit' : 'current';
      }
      return (
        <Bars c={c} height={320} values={arr} highlight={highlight} marks={marks}
          title="顺序查找 · 逐元素比较" subtitle={String(`目标 ${target} · 比较 ${num(snap.cmp)} 次 · 命中 ${hits.length} 处`)}
          baselineLabel={String(snap.done ? `查找结束：命中 ${hits.length} 处` : (i >= 0 ? `正在比较下标 ${i}` : '等待开始'))} />
      );
    },
  },

  'interpolation-search': {
    params: [
      { key: 'n', label: '元素个数', type: 'range', min: 10, max: 30, step: 1, default: 20 },
      { key: 'target', label: '目标值', type: 'range', min: 1, max: 100, step: 1, default: 55 },
      { key: 'seed', label: '随机种子', type: 'range', min: 1, max: 30, step: 1, default: 7 },
    ],
    height: 320,
    legend: [
      { color: '#f5a524', label: '插值估算位置' },
      { color: '#7D87AB', label: '已排除区间' },
      { color: '#12a06a', label: '命中' },
      { color: '#226AFF', label: '当前搜索区间' },
    ],
    hint: '在近似均匀的有序数组上，用目标值相对两端的比例估算下标，而不是简单取中点。',
    buildSteps(p) {
      const step = Math.max(1, Math.floor(96 / Math.max(1, p.n - 1)));
      const arr = Array.from({ length: p.n }, (_, i) => 2 + i * step);
      const steps = [];
      let lo = 0, hi = arr.length - 1, cmp = 0, probe = -1, found = -1, lo0 = lo, hi0 = hi;
      const push = (note, extra = {}) => steps.push({
        arr: [...arr], target: p.target, lo, hi, lo0, hi0, probe, found, cmp, done: false, note,
        metrics: { 比较次数: cmp, 区间左: lo, 区间右: hi, 估算下标: probe < 0 ? 0 : probe },
        ...extra,
      });
      for (let i = 0; i < arr.length; i++) {
        lo0 = i; hi0 = i;
        push(`构造均匀有序数组：写入 arr[${i}]=${arr[i]}。`);
      }
      lo0 = 0; hi0 = arr.length - 1;
      push(`开始插值查找，初始区间 [0, ${hi}]，目标 ${p.target}。`);
      while (lo <= hi && found < 0) {
        const aLo = arr[lo], aHi = arr[hi];
        let pos = lo;
        if (aHi !== aLo) pos = lo + Math.floor((p.target - aLo) * (hi - lo) / (aHi - aLo));
        pos = clamp(pos, lo, hi);
        probe = pos;
        push(`估算：pos = ${lo} + (${p.target}-${aLo})×(${hi}-${lo})/(${aHi}-${aLo}) = ${pos}。`);
        cmp++;
        if (arr[pos] === p.target) {
          found = pos;
          push(`arr[${pos}]=${arr[pos]} 正好等于 ${p.target}，命中。`);
          break;
        }
        push(`arr[${pos}]=${arr[pos]} ${arr[pos] < p.target ? '<' : '>'} ${p.target}，` +
          (arr[pos] < p.target ? `左端移到 ${pos + 1}。` : `右端移到 ${pos - 1}。`));
        if (arr[pos] < p.target) lo = pos + 1; else hi = pos - 1;
        push(`新区间 [${lo}, ${hi}]，宽度 ${Math.max(0, hi - lo + 1)}。`);
      }
      push(found >= 0
        ? `查找完成：在下标 ${found} 找到 ${p.target}，比较 ${cmp} 次。`
        : `查找完成：${p.target} 不在数组中，比较 ${cmp} 次。`, { done: true, probe: -1 });
      return finish(steps);
    },
    render(snap, p, c) {
      const arr = snap.arr || [], lo = num(snap.lo, 0), hi = num(snap.hi, arr.length - 1);
      const probe = num(snap.probe, -1), found = num(snap.found, -1);
      const highlight = {}, marks = {};
      arr.forEach((_, i) => { if (arr.length <= 20) marks[i] = String(i); });
      if (snap.done) {
        if (found >= 0) highlight[found] = 'hit';
      } else {
        for (let i = 0; i < arr.length; i++) {
          if (i < lo || i > hi) highlight[i] = 'muted';
          else if (i === probe) highlight[i] = 'warn';
        }
      }
      return (
        <Bars c={c} height={320} values={arr} highlight={highlight} marks={marks}
          title="插值查找 · 按值比例定位" subtitle={String(snap.done ? `目标 ${num(snap.target)} · 结束` : `目标 ${num(snap.target)} · 区间 [${lo},${hi}] · 估算 ${probe < 0 ? '-' : probe}`)}
          baselineLabel={String(`比较 ${num(snap.cmp)} 次 · 均匀分布时平均 O(log log n)`)} />
      );
    },
  },

  'kmp': {
    params: [
      { key: 'textLen', label: '文本长度', type: 'range', min: 10, max: 18, step: 1, default: 14 },
      { key: 'patLen', label: '模式串长度', type: 'range', min: 3, max: 6, step: 1, default: 4 },
      { key: 'seed', label: '随机种子', type: 'range', min: 1, max: 30, step: 1, default: 7 },
      { key: 'showLPS', label: '显示前缀表', type: 'toggle', default: true, hint: '开启时在第三行显示 lps 值' },
    ],
    height: 340,
    legend: [
      { color: '#f5a524', label: '文本指针 i / 模式指针 j' },
      { color: '#12a06a', label: '已匹配前缀' },
      { color: '#e5484d', label: '失配' },
      { color: '#7c5cff', label: '前缀表 lps' },
    ],
    hint: '先算 lps（最长相同真前后缀），匹配失配时模式串指针 j 回退到 lps[j-1]，文本指针 i 永不回退。',
    buildSteps(p) {
      const rnd = mulberry32(p.seed * 13 + 7);
      const text = shuffledLetters(rnd, p.textLen, ['a', 'b', 'c']);
      const start = Math.floor(rnd() * (text.length - p.patLen + 1));
      const pat = text.slice(start, start + p.patLen);
      const lps = Array(pat.length).fill(0);
      const steps = [];
      let i = -1, j = -1, phase = 'lps', cmp = 0; const hits = [];
      const push = (note, extra = {}) => steps.push({
        text: [...text], pat: [...pat], lps: [...lps], i, j, phase, cmp, hits: [...hits], done: false, note,
        metrics: { 比较次数: cmp, 模式长度: pat.length, 命中数: hits.length },
        ...extra,
      });
      push(`文本 ${text.join('')}，模式 ${pat.join('')}；先构造前缀表 lps。`);
      let k = 0;
      for (i = 1; i < pat.length; i++) {
        while (k > 0 && pat[i] !== pat[k]) {
          cmp++; j = k;
          push(`构造 lps：pat[${i}]=${pat[i]} ≠ pat[${k}]=${pat[k]}，k 回退到 lps[${k - 1}]=${lps[k - 1]}。`);
          k = lps[k - 1];
        }
        cmp++;
        if (pat[i] === pat[k]) {
          k++;
          push(`构造 lps：pat[${i}] 与 pat[${k - 1}] 相同，k=${k}。`);
        } else {
          push(`构造 lps：pat[${i}] 无更长相同前后缀。`);
        }
        lps[i] = k;
        push(`写入 lps[${i}]=${k}。`);
      }
      i = 0; j = 0; phase = 'search';
      push(`前缀表 ${lps.join(',')} 构造完成，开始扫描文本。`);
      while (i < text.length) {
        cmp++;
        if (text[i] === pat[j]) {
          push(`text[${i}]=${text[i]} 与 pat[${j}]=${pat[j]} 匹配，i、j 同时前进。`);
          i++; j++;
          if (j === pat.length) {
            hits.push(i - j);
            push(`完整匹配，起始下标 ${i - j}；j 回退到 lps[${j - 1}]=${lps[j - 1]}。`, { hit: true });
            j = lps[j - 1];
          }
        } else if (j > 0) {
          const old = j; j = lps[j - 1];
          push(`失配：text[${i}]=${text[i]} ≠ pat[${old}]=${pat[old]}，j 回退 ${old}→${j}，i 保持 ${i}。`);
        } else {
          push(`失配且 j=0：text[${i}]=${text[i]} ≠ pat[0]，i 前进。`);
          i++;
        }
      }
      push(`KMP 结束：比较 ${cmp} 次，命中 ${hits.length} 处。`, { done: true, i: -1, j: -1 });
      return finish(steps);
    },
    render(snap, p, c) {
      const text = snap.text || [], pat = snap.pat || [], lps = snap.lps || [];
      const i = num(snap.i, -1), j = num(snap.j, -1), hits = snap.hits || [];
      const items = [];
      text.forEach((ch, k) => items.push({
        text: String(ch), sub: String(k),
        color: snap.done ? (hits.some((h) => k >= h && k < h + pat.length) ? c.success : c.accent)
          : (k === i ? c.warning : (k < i ? c.teal : c.primary)),
      }));
      pat.forEach((ch, k) => items.push({
        text: String(ch), sub: String(lps[k] === undefined ? 0 : lps[k]),
        color: snap.done ? c.success : (k === j ? c.danger : (k < j ? c.success : c.purple)),
      }));
      if (p.showLPS) lps.forEach((v, k) => items.push({ text: String(v), sub: `lps[${k}]`, color: c.purple }));
      return (
        <Cells c={c} height={340} items={items} wrap={Math.max(text.length, 1)} cellW={30} cellH={32} gap={4}
          title="KMP · 文本 / 模式 / 前缀表" subtitle={String(snap.done ? `命中 ${hits.length} 处` : `${String(snap.phase || 'lps')} · i=${i} j=${j} · 模式下标下方为 lps`)} />
      );
    },
  },

  'rabin-karp': {
    params: [
      { key: 'textLen', label: '文本长度', type: 'range', min: 10, max: 18, step: 1, default: 14 },
      { key: 'patLen', label: '模式串长度', type: 'range', min: 3, max: 5, step: 1, default: 4 },
      { key: 'seed', label: '随机种子', type: 'range', min: 1, max: 30, step: 1, default: 7 },
    ],
    height: 340,
    legend: [
      { color: '#f5a524', label: '当前哈希窗口' },
      { color: '#12a06a', label: '哈希相等并验证' },
      { color: '#e5484d', label: '哈希不等' },
      { color: '#7c5cff', label: '模式串' },
    ],
    hint: '用滚动哈希在 O(1) 时间更新窗口值，哈希相等才逐字符验证，能有效处理多模式匹配。',
    buildSteps(p) {
      const rnd = mulberry32(p.seed * 19 + 23);
      const text = shuffledLetters(rnd, p.textLen, ['a', 'b', 'c', 'd']);
      const start = Math.floor(rnd() * (text.length - p.patLen + 1));
      const pat = text.slice(start, start + p.patLen);
      const MOD = 997, BASE = 26;
      const code = (ch) => ch.charCodeAt(0) - 96;
      let ph = 0, wh = 0;
      const steps = [];
      let pos = -1, vi = -1, cmp = 0; const hits = [];
      const push = (note, extra = {}) => steps.push({
        text: [...text], pat: [...pat], pos, vi, ph, wh, cmp, hits: [...hits], done: false, note,
        metrics: { 模式哈希: ph, 窗口哈希: wh, 哈希比较: cmp, 命中数: hits.length },
        ...extra,
      });
      push(`文本 ${text.join('')}，模式 ${pat.join('')}；MOD=${MOD}, BASE=${BASE}。`);
      for (let k = 0; k < pat.length; k++) {
        ph = (ph * BASE + code(pat[k])) % MOD;
        push(`计算模式哈希：h = (上一轮 h × ${BASE} + ${code(pat[k])}) mod ${MOD} = ${ph}。`);
      }
      let high = 1;
      for (let k = 1; k < pat.length; k++) high = high * BASE % MOD;
      for (let k = 0; k < pat.length; k++) wh = (wh * BASE + code(text[k])) % MOD;
      push(`首窗口 [0,${pat.length - 1}] 哈希 ${wh}；最高位权重 ${high}。`);
      for (pos = 0; pos <= text.length - pat.length; pos++) {
        cmp++;
        if (wh === ph) {
          let ok = true;
          for (let k = 0; k < pat.length; k++) {
            vi = k;
            push(`窗口 [${pos},${pos + pat.length - 1}] 哈希相等，验证 text[${pos + k}]=${text[pos + k]} 与 pat[${k}]=${pat[k]}。`);
            if (text[pos + k] !== pat[k]) { ok = false; break; }
          }
          if (ok) {
            hits.push(pos);
            push(`验证通过：模式在下标 ${pos} 处命中。`);
          } else {
            push(`哈希冲突：验证失败，继续滑动。`);
          }
        } else {
          push(`窗口 [${pos},${pos + pat.length - 1}] 哈希 ${wh} ≠ ${ph}，直接跳过。`);
        }
        if (pos < text.length - pat.length) {
          wh = ((wh - code(text[pos]) * high) * BASE + code(text[pos + pat.length])) % MOD;
          wh = ((wh % MOD) + MOD) % MOD;
          push(`滚动更新：去掉 ${text[pos]}，加入 ${text[pos + pat.length]}，新哈希 ${wh}。`);
        }
      }
      push(`Rabin-Karp 结束：哈希比较 ${cmp} 次，命中 ${hits.length} 处。`, { done: true, pos: -1, vi: -1 });
      return finish(steps);
    },
    render(snap, p, c) {
      const text = snap.text || [], pat = snap.pat || [], hits = snap.hits || [];
      const pos = num(snap.pos, -1), m = pat.length;
      const items = [];
      text.forEach((ch, k) => {
        const inWin = pos >= 0 && k >= pos && k < pos + m;
        const hit = hits.some((h) => k >= h && k < h + m);
        items.push({
          text: String(ch), sub: String(k),
          color: snap.done ? (hit ? c.success : c.accent) : (inWin ? c.warning : (k < pos ? c.teal : c.primary)),
        });
      });
      pat.forEach((ch, k) => items.push({
        text: String(ch), sub: String(k),
        color: snap.done ? c.success : (k === num(snap.vi, -1) ? c.danger : c.purple),
      }));
      return (
        <Cells c={c} height={340} items={items} wrap={Math.max(text.length, 1)} cellW={30} cellH={32} gap={4}
          title="Rabin-Karp · 滚动哈希窗口" subtitle={String(snap.done ? `命中 ${hits.length} 处` : `窗口 ${pos < 0 ? '-' : pos} · 模式哈希 ${num(snap.ph)} · 窗口哈希 ${num(snap.wh)}`)} />
      );
    },
  },

  'boyer-moore': {
    params: [
      { key: 'textLen', label: '文本长度', type: 'range', min: 12, max: 20, step: 1, default: 16 },
      { key: 'patLen', label: '模式串长度', type: 'range', min: 3, max: 6, step: 1, default: 4 },
      { key: 'seed', label: '随机种子', type: 'range', min: 1, max: 30, step: 1, default: 7 },
      { key: 'rule', label: '跳转规则', type: 'select', default: 'both',
        options: [{ value: 'bad', label: '仅坏字符' }, { value: 'both', label: '坏字符+好后缀' }] },
    ],
    height: 340,
    legend: [
      { color: '#f5a524', label: '当前对齐位置' },
      { color: '#e5484d', label: '失配字符（右起比较）' },
      { color: '#12a06a', label: '已匹配后缀' },
      { color: '#7c5cff', label: '模式串' },
    ],
    hint: '从模式串右端向左比较；失配时用坏字符（与好后缀）规则决定跳过距离，跳得越远越快。',
    buildSteps(p) {
      const rnd = mulberry32(p.seed * 23 + 31);
      const text = shuffledLetters(rnd, p.textLen, ['a', 'b', 'c', 'd']);
      const start = Math.floor(rnd() * (text.length - p.patLen + 1));
      const pat = text.slice(start, start + p.patLen);
      const m = pat.length;
      const code = (ch) => ch.charCodeAt(0) - 96;
      const bad = Array(27).fill(-1);
      for (let k = 0; k < m; k++) bad[code(pat[k])] = k;
      const goodSuffix = () => {
        const gs = Array(m).fill(m);
        gs[0] = 0;
        for (let l = 1; l < m; l++) {
          const suf = pat.slice(m - l).join('');
          let sh = m;
          for (let s = m - l - 1; s >= 0; s--) {
            if (pat.slice(s, s + l).join('') === suf) { sh = m - l + s; break; }
          }
          if (sh === m) {
            for (let k = l - 1; k >= 1; k--) {
              if (pat.slice(0, k).join('') === pat.slice(m - k).join('')) { sh = m - k; break; }
            }
          }
          gs[l] = sh;
        }
        return gs;
      };
      const gs = goodSuffix();
      const steps = [];
      let pos = -1, j = -1, cmp = 0, shiftCount = 0; const hits = [];
      const push = (note, extra = {}) => steps.push({
        text: [...text], pat: [...pat], pos, j, cmp, shiftCount, bad: [...bad], gs: [...gs],
        hits: [...hits], done: false, note,
        metrics: { 字符比较: cmp, 跳转次数: shiftCount, 当前对齐: pos < 0 ? 0 : pos, 命中数: hits.length },
        ...extra,
      });
      push(`文本 ${text.join('')}，模式 ${pat.join('')}；构建坏字符表（右起位置）。`);
      for (let k = 0; k < m; k++) push(`坏字符表：${pat[k]} 最后出现在模式下标 ${bad[code(pat[k])]}。`);
      if (p.rule === 'both') for (let l = 1; l < m; l++) push(`好后缀表：长度 ${l} 的后缀失配时跳 ${gs[l]}。`);
      let s = 0;
      while (s <= text.length - m) {
        pos = s;
        j = m - 1;
        push(`模式对齐到文本下标 ${s}，从右端 pat[${m - 1}] 开始比较。`);
        while (j >= 0) {
          cmp++;
          if (text[s + j] === pat[j]) {
            push(`text[${s + j}]=${text[s + j]} 与 pat[${j}]=${pat[j]} 相同，向左继续。`, { j });
            j--;
          } else {
            push(`失配：text[${s + j}]=${text[s + j]} ≠ pat[${j}]=${pat[j]}。`, { j });
            break;
          }
        }
        if (j < 0) {
          hits.push(s);
          push(`完整匹配！模式出现在文本下标 ${s}。`, { j: -1, hit: true });
          s += 1; shiftCount++;
          continue;
        }
        const ch = text[s + j];
        const badShift = j - bad[code(ch)];
        const goodShift = p.rule === 'both' && j < m - 1 ? gs[m - 1 - j] : 0;
        const sh = Math.max(1, badShift, goodShift);
        push(`坏字符 ${ch} 建议跳 ${badShift}；${p.rule === 'both' ? `好后缀建议 ${goodShift}；` : ''}取最大 ${sh}，对齐位置 ${s} → ${s + sh}。`);
        s += sh; shiftCount++;
      }
      push(`Boyer-Moore 结束：字符比较 ${cmp} 次，跳转 ${shiftCount} 次，命中 ${hits.length} 处。`, { done: true, pos: -1, j: -1 });
      return finish(steps);
    },
    render(snap, p, c) {
      const text = snap.text || [], pat = snap.pat || [], hits = snap.hits || [];
      const pos = num(snap.pos, -1), j = num(snap.j, -1), m = pat.length;
      const total = Math.max(text.length, pos + m);
      const items = [];
      for (let k = 0; k < total; k++) {
        const inWin = pos >= 0 && k >= pos && k < pos + m;
        const pj = inWin ? k - pos : -1;
        const hit = hits.some((h) => k >= h && k < h + m);
        items.push({
          text: k < text.length ? String(text[k]) : '·',
          sub: inWin ? String(pat[pj]) : String(k),
          color: snap.done ? (hit ? c.success : c.accent)
            : (k === pos + j && j >= 0 ? c.danger : (inWin && pj > j ? c.success : (inWin ? c.warning : c.primary))),
        });
      }
      pat.forEach((ch, k) => items.push({ text: String(ch), sub: String(k), color: k === j ? c.danger : c.purple }));
      return (
        <Cells c={c} height={340} items={items} wrap={Math.max(total, 1)} cellW={30} cellH={32} gap={4}
          title="Boyer-Moore · 右起比较与跳转" subtitle={String(snap.done ? `命中 ${hits.length} 处 · 比较 ${num(snap.cmp)} 次` : `对齐 ${pos < 0 ? '-' : pos} · 比较指针 j=${j} · 跳转 ${num(snap.shiftCount)} 次`)} />
      );
    },
  },

  'manacher': {
    params: [
      { key: 'n', label: '字符串长度', type: 'range', min: 10, max: 18, step: 1, default: 13 },
      { key: 'seed', label: '随机种子', type: 'range', min: 1, max: 30, step: 1, default: 7 },
      { key: 'alphabet', label: '字符集大小', type: 'select', default: '3',
        options: [{ value: '2', label: 'a-b（长回文多）' }, { value: '3', label: 'a-c' }] },
    ],
    height: 360,
    legend: [
      { color: '#f5a524', label: '当前中心 i' },
      { color: '#7c5cff', label: '镜像点' },
      { color: '#0ea5a5', label: '当前回文半径覆盖' },
      { color: '#12a06a', label: '最长回文' },
    ],
    hint: '把原串插入分隔符，利用已知回文的对称性让半径从镜像下界开始扩展，总扩展次数线性。',
    buildSteps(p) {
      const rnd = mulberry32(p.seed * 41 + 17);
      const pool = p.alphabet === '2' ? ['a', 'b'] : ['a', 'b', 'c'];
      const s = shuffledLetters(rnd, p.n, pool);
      const t = ['^'];
      for (const ch of s) { t.push('#'); t.push(ch); }
      t.push('#'); t.push('$');
      const rad = Array(t.length).fill(0);
      const steps = [];
      let center = 0, right = 0, i = -1, k = 0, best = 0, bestI = 0, expand = 0;
      const push = (note, extra = {}) => steps.push({
        t: [...t], rad: [...rad], center, right, i, k, best, bestI, done: false, note,
        metrics: { 中心: i < 0 ? 0 : i, 右边界: right, 当前半径: k, 最长半径: best, 扩展次数: expand },
        ...extra,
      });
      push(`原串 ${s.join('')}；插入分隔符后长度 ${t.length}，开始逐个中心计算半径。`);
      for (i = 1; i < t.length - 1; i++) {
        const mirror = 2 * center - i;
        k = i < right && mirror >= 0 && mirror < rad.length ? Math.min(rad[mirror], right - i) : 0;
        push(`中心 i=${i}（字符 ${t[i]}），镜像 ${mirror}，半径下界 ${k}。`);
        while (i + k + 1 < t.length && i - k - 1 >= 0 && t[i + k + 1] === t[i - k - 1]) {
          k++; expand++;
          push(`向外扩展：t[${i + k}]=${t[i + k]} 与 t[${i - k}]=${t[i - k]} 相同，半径 ${k}。`);
        }
        rad[i] = k;
        if (k > best) { best = k; bestI = i; }
        push(`写入 rad[${i}]=${k}；当前最长半径 ${best}（中心 ${bestI}）。`);
        if (i + k > right) {
          center = i; right = i + k;
          push(`i+rad=${i + k} 超过右边界，更新 center=${center}, right=${right}。`);
        }
      }
      push(`Manacher 结束：最长回文半径 ${best}，对应原串长度 ${best}。`, { done: true, i: -1, k: 0 });
      return finish(steps);
    },
    render(snap, p, c) {
      const t = snap.t || [], rad = snap.rad || [];
      const i = num(snap.i, -1), right = num(snap.right, 0), center = num(snap.center, 0);
      const best = num(snap.best, 0), bestI = num(snap.bestI, 0);
      const mirror = 2 * center - i;
      const items = t.map((ch, k) => {
        const r = num(rad[k], 0);
        const inSpan = i >= 0 && Math.abs(k - i) <= r;
        const inBest = best > 0 && Math.abs(k - bestI) <= best;
        let color = c.primary;
        if (inBest) color = c.success;
        else if (inSpan) color = c.teal;
        else if (k === mirror && i >= 0) color = c.purple;
        if (k === i && i >= 0) color = c.warning;
        return { text: String(ch), sub: r > 0 ? String(r) : '·', color };
      });
      return (
        <Cells c={c} height={360} items={items} wrap={Math.max(t.length, 1)} cellW={26} cellH={32} gap={3}
          title="Manacher · 变换串与回文半径" subtitle={String(snap.done ? `最长回文长度 ${best}` : `i=${i} · center=${center} · right=${right} · 最长半径 ${best}（格下方为半径）`)} />
      );
    },
  },

  'trie-match': {
    params: [
      { key: 'patternCount', label: '模式数量', type: 'range', min: 3, max: 6, step: 1, default: 4 },
      { key: 'patternLen', label: '模式长度', type: 'range', min: 3, max: 5, step: 1, default: 3 },
      { key: 'textLen', label: '文本长度', type: 'range', min: 12, max: 20, step: 1, default: 15 },
      { key: 'seed', label: '随机种子', type: 'range', min: 1, max: 30, step: 1, default: 7 },
    ],
    height: 360,
    legend: [
      { color: '#f5a524', label: '当前访问路径' },
      { color: '#12a06a', label: '模式结尾节点' },
      { color: '#226AFF', label: '普通节点' },
      { color: '#e5484d', label: '命中' },
    ],
    hint: '把所有模式插入一棵前缀树，扫描文本时沿字符边走；走到结尾节点即输出一次匹配。',
    buildSteps(p) {
      const rnd = mulberry32(p.seed * 29 + 43);
      const pats = Array.from({ length: p.patternCount }, () => shuffledLetters(rnd, p.patternLen, ['a', 'b', 'c']).join(''));
      const text = shuffledLetters(rnd, p.textLen, ['a', 'b', 'c']);
      const nodes = [{ id: 0, ch: '根', parent: -1, children: {}, terminal: -1, depth: 0 }];
      let nextId = 1;
      const steps = [];
      let path = [0], pos = -1, hits = [], phase = 'build';
      const push = (note, extra = {}) => steps.push({
        nodes: nodes.map((n) => ({ ...n, children: { ...n.children } })),
        pats: [...pats], text: [...text], path: [...path], pos, hits: [...hits], phase, done: false, note,
        metrics: { 节点数: nodes.length, 模式数: pats.length, 命中数: hits.length, 文本位置: pos < 0 ? 0 : pos },
        ...extra,
      });
      push(`文本 ${text.join('')}；模式集合 [${pats.join(', ')}]，开始插入 Trie。`);
      pats.forEach((pat, pi) => {
        let cur = 0; path = [0];
        push(`插入模式 ${pi + 1}：${pat}。`);
        for (const ch of pat) {
          if (nodes[cur].children[ch] === undefined) {
            nodes.push({ id: nextId, ch, parent: cur, children: {}, terminal: -1, depth: nodes[cur].depth + 1 });
            nodes[cur].children[ch] = nextId++;
          }
          cur = nodes[cur].children[ch];
          path.push(cur);
          push(`沿字符 ${ch} 到节点 ${cur}（深度 ${nodes[cur].depth}）。`);
        }
        nodes[cur].terminal = pi;
        push(`节点 ${cur} 标记为模式 ${pi + 1} 的结尾。`);
      });
      phase = 'search'; path = [0]; pos = -1;
      push(`Trie 构建完成，共 ${nodes.length} 个节点；开始从左到右扫描文本。`);
      for (pos = 0; pos < text.length; pos++) {
        let cur = 0, step = 0; path = [0];
        push(`扫描文本下标 ${pos}，字符 ${text[pos]}，从根出发。`);
        while (pos + step < text.length && nodes[cur].children[text[pos + step]] !== undefined) {
          const ch = text[pos + step];
          cur = nodes[cur].children[ch]; path.push(cur); step++;
          push(`匹配文本位置 ${pos + step - 1} 的字符 ${ch}，进入节点 ${cur}。`);
          if (nodes[cur].terminal >= 0) {
            hits.push({ pos, pattern: nodes[cur].terminal });
            push(`节点 ${cur} 是模式 ${nodes[cur].terminal + 1} 的结尾：在下标 ${pos} 命中。`, { hit: true });
          }
        }
        if (path.length === 1) push(`字符 ${text[pos]} 无对应边，本位置结束。`);
      }
      push(`Trie 匹配结束：共 ${hits.length} 次命中。`, { done: true, pos: -1, path: [] });
      return finish(steps);
    },
    render(snap, p, c) {
      const nodes = snap.nodes || [], path = snap.path || [], hits = snap.hits || [];
      const byId = new Map(nodes.map((n) => [num(n.id), n]));
      const roots = nodes.filter((n) => num(n.parent) < 0);
      const maxDepth = Math.max(1, ...nodes.map((n) => num(n.depth)));
      const leafCount = Math.max(1, nodes.filter((n) => Object.keys(n.children || {}).length === 0).length);
      const posMap = new Map();
      let rank = 0;
      const walk = (id) => {
        const n = byId.get(id);
        if (!n) return 0;
        const kids = Object.keys(n.children || {}).sort().map((ch) => byId.get(n.children[ch])).filter(Boolean);
        let x;
        if (!kids.length) { x = leafCount > 1 ? rank / (leafCount - 1) : 0.5; rank++; }
        else {
          const xs = kids.map((kid) => walk(num(kid.id)));
          x = (Math.min(...xs) + Math.max(...xs)) / 2;
        }
        posMap.set(num(id), { x, y: num(n.depth) / maxDepth });
        return x;
      };
      roots.forEach((r) => walk(num(r.id)));
      const gvNodes = nodes.map((n) => {
        const id = num(n.id);
        const hitHere = hits.some((h) => path.includes(id) && n.terminal >= 0);
        return {
          id: String(id), label: String(n.ch), sub: n.terminal >= 0 ? String(`模式${num(n.terminal) + 1}`) : undefined,
          x: (posMap.get(id) || { x: 0.5 }).x, y: (posMap.get(id) || { y: 0 }).y,
          state: hitHere ? 'hit' : (path.includes(id) ? 'current' : (n.terminal >= 0 ? 'done' : 'idle')),
          r: 12,
        };
      });
      const gvEdges = [];
      nodes.forEach((n) => {
        if (num(n.parent) >= 0) gvEdges.push({
          from: String(n.parent), to: String(n.id), label: String(n.ch),
          state: path.includes(num(n.id)) && path.includes(num(n.parent)) ? 'active' : 'idle',
        });
      });
      return (
        <GraphView c={c} height={360} nodes={gvNodes} edges={gvEdges} directed
          title="Trie · 多模式前缀树" subtitle={String(snap.done ? `命中 ${hits.length} 次` : `阶段 ${String(snap.phase || 'build')} · 文本位置 ${num(snap.pos, -1) < 0 ? '-' : num(snap.pos)} · 命中 ${hits.length}`)} />
      );
    },
  },

  'fibonacci-recursion': {
    params: [
      { key: 'n', label: '计算第 n 项', type: 'range', min: 6, max: 12, step: 1, default: 10 },
      { key: 'memo', label: '启用记忆化', type: 'toggle', default: true, hint: '关闭后重复子问题会被反复计算' },
      { key: 'order', label: '递归展开顺序', type: 'select', default: 'asc',
        options: [{ value: 'asc', label: '先算 fib(n-1)' }, { value: 'desc', label: '先算 fib(n-2)' }] },
    ],
    height: 300,
    legend: [
      { color: '#f5a524', label: '当前调用' },
      { color: '#0ea5a5', label: '命中缓存' },
      { color: '#12a06a', label: '新算出并写入' },
      { color: '#226AFF', label: '已算好' },
    ],
    hint: '朴素递归会指数级重复计算；记忆化把每个 fib(k) 只算一次，直接降到 O(n)。',
    buildSteps(p) {
      const view = Array(p.n + 1).fill(null);
      const steps = [];
      let calls = 0, hits = 0, depth = 0, k = -1, mark = '';
      const push = (note, extra = {}) => steps.push({
        view: [...view], n: p.n, calls, hits, k, depth, mark, done: false, note,
        metrics: { 调用次数: calls, 缓存命中: hits, 已算子问题: view.filter((v) => v !== null).length },
        ...extra,
      });
      push(`目标 fib(${p.n})；${p.memo ? '启用' : '未启用'}记忆化，缓存表长度 ${p.n + 1}。`);
      const fib = (x, d) => {
        calls++; k = x; depth = d; mark = 'call';
        push(`调用 fib(${x})（第 ${d} 层递归）。`);
        if (p.memo && view[x] !== null) {
          hits++; mark = 'hit';
          push(`命中缓存：fib(${x})=${view[x]}，直接返回。`);
          return view[x];
        }
        if (x <= 1) {
          view[x] = x; mark = 'write';
          push(`边界条件：fib(${x})=${x}，写入缓存。`);
          return x;
        }
        const first = p.order === 'asc' ? x - 1 : x - 2;
        const second = p.order === 'asc' ? x - 2 : x - 1;
        const a = fib(first, d + 1);
        const b = fib(second, d + 1);
        view[x] = a + b; k = x; depth = d; mark = 'write';
        push(`合并：fib(${x})=fib(${first})+fib(${second})=${a}+${b}=${a + b}。`);
        return view[x];
      };
      const result = fib(p.n, 0);
      push(`计算完成：fib(${p.n})=${result}，共调用 ${calls} 次、命中缓存 ${hits} 次。`, { done: true, mark: 'done' });
      return finish(steps);
    },
    render(snap, p, c) {
      const view = snap.view || [], k = num(snap.k, -1), mark = String(snap.mark || 'call');
      const items = view.map((v, idx) => ({
        text: v === null ? '·' : String(v), sub: `fib(${idx})`,
        color: snap.done ? c.success
          : (idx === k ? (mark === 'hit' ? c.teal : (mark === 'write' ? c.success : c.warning))
            : (v === null ? c.border : c.primary)),
      }));
      return (
        <Cells c={c} height={300} items={items} wrap={Math.max(view.length, 1)} cellW={44} cellH={38} gap={5}
          title="递归与记忆化 · fib(n) 子问题表" subtitle={String(snap.done ? `fib(${num(snap.n)})=${num(view[view.length - 1])}` : `调用 ${num(snap.calls)} 次 · 命中 ${num(snap.hits)} 次 · 当前 fib(${k})`)} />
      );
    },
  },

  'karatsuba': {
    params: [
      { key: 'digits', label: '数字位数', type: 'range', min: 3, max: 4, step: 1, default: 3 },
      { key: 'seed', label: '随机种子', type: 'range', min: 1, max: 30, step: 1, default: 7 },
      { key: 'detail', label: '逐层展开', type: 'toggle', default: true, hint: '关闭后只在合并时记录结果' },
    ],
    height: 360,
    legend: [
      { color: '#226AFF', label: '递归入口' },
      { color: '#f5a524', label: '拆分 / 组合' },
      { color: '#12a06a', label: '小规模直接乘' },
      { color: '#7c5cff', label: '不同递归层' },
    ],
    hint: '把 x、y 各拆成高低两半，用 3 次半规模乘法（z2、z0、(x1+x0)(y1+y0)）代替 4 次。',
    buildSteps(p) {
      const rnd = mulberry32(p.seed * 53 + 7);
      const make = () => {
        let s = String(1 + Math.floor(rnd() * 9));
        while (s.length < p.digits) s += String(Math.floor(rnd() * 10));
        return Number(s);
      };
      const a = make(), b = make();
      const lines = [];
      const steps = [];
      let level = 0, calls = 0, leaves = 0;
      const push = (note, extra = {}) => steps.push({
        lines: lines.slice(-12), a, b, level, calls, leaves, done: false, note,
        metrics: { 递归调用: calls, 直接乘法: leaves, 当前层: level, 结果: 0 },
        ...extra,
      });
      push(`计算 ${a} × ${b}：核对值 ${a * b}；低于两位时直接相乘。`);
      const mul = (x, y, d) => {
        calls++; level = d;
        if (p.detail || d === 0) {
          lines.push(`${'  '.repeat(d)}调用 mul(${x}, ${y}) 层${d}`);
          push(`进入层 ${d}：计算 ${x} × ${y}。`);
        }
        if (x < 10 || y < 10) {
          const val = x * y; leaves++;
          lines.push(`${'  '.repeat(d)}直接 ${x}×${y}=${val}`);
          push(`小规模直接乘：${x} × ${y} = ${val}。`);
          return val;
        }
        const len = Math.max(String(x).length, String(y).length);
        const m = Math.max(1, Math.floor(len / 2));
        const pw = Math.pow(10, m);
        const x1 = Math.floor(x / pw), x0 = x % pw;
        const y1 = Math.floor(y / pw), y0 = y % pw;
        lines.push(`${'  '.repeat(d)}拆分 ${x}=${x1}·10^${m}+${x0}, ${y}=${y1}·10^${m}+${y0}`);
        push(`层 ${d} 拆分：${x}=${x1}·10^${m}+${x0}，${y}=${y1}·10^${m}+${y0}。`);
        const z2 = mul(x1, y1, d + 1);
        const z0 = mul(x0, y0, d + 1);
        const zMid = mul(x1 + x0, y1 + y0, d + 1);
        const z1 = zMid - z2 - z0;
        const res = z2 * Math.pow(10, 2 * m) + z1 * pw + z0;
        lines.push(`${'  '.repeat(d)}组合 z2=${z2}, z0=${z0}, z1=${zMid}-${z2}-${z0}=${z1} → ${res}`);
        push(`层 ${d} 组合：z2=${z2}, z0=${z0}, (x1+x0)(y1+y0)=${zMid}，故 z1=${z1}，合并得 ${res}。`);
        return res;
      };
      const result = mul(a, b, 0);
      push(`Karatsuba 完成：${a} × ${b} = ${result}，共 ${calls} 次调用、${leaves} 次直接乘。`, {
        done: true, metrics: { 递归调用: calls, 直接乘法: leaves, 当前层: 0, 结果: result },
      });
      return finish(steps);
    },
    render(snap, p, c) {
      const lines = snap.lines || [];
      const shown = lines.slice(-11).map((ln, i) => ({
        text: String(ln), color: c.series[i % c.series.length],
      }));
      return (
        <TextPanel c={c} height={360} lines={shown} fontSize={11}
          title="Karatsuba · 递归展开日志" subtitle={String(snap.done ? `结果 ${num(snap.metrics && snap.metrics['结果'])}` : `层 ${num(snap.level)} · 调用 ${num(snap.calls)} 次 · 直接乘 ${num(snap.leaves)} 次`)} />
      );
    },
  },

  'closest-pair': {
    params: [
      { key: 'n', label: '点数', type: 'range', min: 8, max: 18, step: 1, default: 12 },
      { key: 'seed', label: '随机种子', type: 'range', min: 1, max: 30, step: 1, default: 7 },
      { key: 'strip', label: '显示中线带检查', type: 'toggle', default: true, hint: '关闭后仍计算，但不逐对展示带内候选' },
    ],
    height: 340,
    legend: [
      { color: '#226AFF', label: '左半区' },
      { color: '#e5484d', label: '右半区 / 当前对' },
      { color: '#f5a524', label: '中线带内候选' },
      { color: '#12a06a', label: '当前最近点对' },
    ],
    hint: '按 x 排序后分治：左右各自求最近距离，再只检查中线附近宽度 d 的窄带中的少量点对。',
    buildSteps(p) {
      const pts = makePoints(p.n, p.seed);
      pts.sort((u, v) => u.x - v.x);
      const steps = [];
      let bestD = 1e9, bestPair = [-1, -1], cmp = 0, depth = 0, curPair = [-1, -1];
      const dist = (u, v) => Math.hypot(u.x - v.x, u.y - v.y);
      const push = (note, extra = {}) => steps.push({
        pts: pts.map((q) => ({ ...q })), bestD, bestPair: [...bestPair], curPair: [...curPair],
        cmp, depth, done: false, note,
        metrics: { 距离比较: cmp, 当前最近距离: bestD > 1e8 ? 0 : bestD, 递归深度: depth, 点数: pts.length },
        ...extra,
      });
      push(`${p.n} 个点，先按 x 坐标排序：${pts.map((q) => fmt(q.x, 1)).join(', ')}。`);
      pts.forEach((q, i) => push(`排序后第 ${i} 个点 (${fmt(q.x, 2)}, ${fmt(q.y, 2)})。`));
      const check = (i, j) => {
        curPair = [i, j]; cmp++;
        const d = dist(pts[i], pts[j]);
        if (d < bestD) { bestD = d; bestPair = [i, j]; push(`点对 (${i},${j}) 距离 ${fmt(d, 3)}，刷新最近距离。`); }
        else push(`点对 (${i},${j}) 距离 ${fmt(d, 3)}，不优于 ${fmt(bestD, 3)}。`);
      };
      const solve = (lo, hi, d) => {
        if (hi - lo <= 0) return;
        depth = d;
        if (hi - lo <= 3) {
          push(`子区间 [${lo},${hi - 1}] 点数 ≤4，直接暴力枚举点对。`);
          for (let i = lo; i < hi; i++) for (let j = i + 1; j < hi; j++) check(i, j);
          return;
        }
        const mid = (lo + hi) >> 1, midX = pts[mid].x;
        push(`子区间 [${lo},${hi - 1}] 以 x=${fmt(midX, 2)} 分成 [${lo},${mid - 1}] 与 [${mid},${hi - 1}]。`);
        solve(lo, mid, d + 1); solve(mid, hi, d + 1);
        push(`合并：左右最近距离为 ${fmt(bestD, 3)}，检查中线带 |x-${fmt(midX, 2)}| < d 的点。`);
        const strip = [];
        for (let i = lo; i < hi; i++) {
          if (Math.abs(pts[i].x - midX) < bestD) {
            strip.push(i);
            if (p.strip) push(`点 ${i} 落入中线带，带内共 ${strip.length} 点。`);
          }
        }
        strip.sort((u, v) => pts[u].y - pts[v].y);
        for (let a = 0; a < strip.length; a++) {
          for (let bb = a + 1; bb < strip.length && pts[strip[bb]].y - pts[strip[a]].y < bestD; bb++) {
            check(strip[a], strip[bb]);
          }
        }
      };
      solve(0, pts.length, 0);
      push(`最近点对为 (${bestPair[0]},${bestPair[1]})，距离 ${fmt(bestD, 3)}，共比较 ${cmp} 次。`, { done: true });
      return finish(steps);
    },
    render(snap, p, c) {
      const pts = snap.pts || [], cur = snap.curPair || [], best = snap.bestPair || [];
      const midX = pts.length ? num(pts[Math.floor(pts.length / 2)].x) : 0;
      const d = num(snap.bestD, 1);
      const points = pts.map((q, i) => ({
        x: num(q.x), y: num(q.y), r: cur.includes(i) ? 6 : 4,
        color: snap.done && best.includes(i) ? c.success
          : (cur.includes(i) ? c.danger : (Math.abs(num(q.x) - midX) < d ? c.warning : c.primary)),
      }));
      const centers = [];
      if (best.length === 2 && pts[best[0]] && pts[best[1]]) {
        centers.push({ x: num(pts[best[0]].x), y: num(pts[best[0]].y), label: `d=${fmt(d, 2)}`, color: c.success });
        centers.push({ x: num(pts[best[1]].x), y: num(pts[best[1]].y), label: '最近点', color: c.success });
      }
      return (
        <Scatter c={c} height={340} points={points} centers={centers}
          bounds={{ xmin: -1.3, xmax: 1.3, ymin: -1.3, ymax: 1.3 }}
          title="最近点对 · 分治与中线带" subtitle={String(snap.done ? `最近距离 ${fmt(d, 3)} · 比较 ${num(snap.cmp)} 次` : `深度 ${num(snap.depth)} · 比较 ${num(snap.cmp)} 次 · 当前距离 ${fmt(d, 3)}`)} />
      );
    },
  },

  'activity-selection': {
    params: [
      { key: 'n', label: '活动数量', type: 'range', min: 8, max: 14, step: 1, default: 10 },
      { key: 'seed', label: '随机种子', type: 'range', min: 1, max: 30, step: 1, default: 7 },
      { key: 'showSort', label: '显示排序过程', type: 'toggle', default: true, hint: '开启时逐步展示按结束时间排序' },
    ],
    height: 320,
    legend: [
      { color: '#12a06a', label: '已选中活动' },
      { color: '#7D87AB', label: '跳过（时间冲突）' },
      { color: '#f5a524', label: '正在判断' },
      { color: '#226AFF', label: '待判断' },
    ],
    hint: '按结束时间升序排序后，每次选择开始时间不早于上一个已选活动结束时间的活动。',
    buildSteps(p) {
      const rnd = mulberry32(p.seed * 61 + 19);
      const acts = Array.from({ length: p.n }, (_, i) => {
        const s = Math.floor(rnd() * 20);
        return { i, s, e: s + 1 + Math.floor(rnd() * 6) };
      });
      const steps = [];
      let order = acts.map((a) => a.i), sel = [], cur = -1, checked = 0, lastEnd = -1;
      const push = (note, extra = {}) => steps.push({
        acts: acts.map((a) => ({ ...a })), order: [...order], sel: [...sel], cur, checked, lastEnd, done: false, note,
        metrics: { 已选活动: sel.length, 兼容判断: checked, 上一个结束: lastEnd < 0 ? 0 : lastEnd },
        ...extra,
      });
      push(`生成 ${p.n} 个活动，按结束时间升序排序后贪心选择。`);
      acts.forEach((a) => push(`活动 ${a.i + 1}：起 ${a.s}，止 ${a.e}，时长 ${a.e - a.s}。`));
      if (p.showSort) {
        for (let i = 0; i < order.length - 1; i++) {
          for (let j = 0; j < order.length - 1 - i; j++) {
            if (acts[order[j]].e > acts[order[j + 1]].e) {
              const t = order[j]; order[j] = order[j + 1]; order[j + 1] = t;
              push(`排序：活动 ${order[j] + 1} 与 ${order[j + 1] + 1} 结束时间逆序，交换。`);
            }
          }
        }
      } else {
        order.sort((u, v) => acts[u].e - acts[v].e || u - v);
        push(`排序结果（按结束时间）：${order.map((i) => i + 1).join(' → ')}。`);
      }
      push(`开始贪心扫描，上一个结束时间 ${lastEnd}。`);
      for (const idx of order) {
        const a = acts[idx]; cur = idx; checked++;
        if (a.s >= lastEnd) {
          sel.push(idx); lastEnd = a.e;
          push(`活动 ${idx + 1} 起 ${a.s} ≥ 上次结束 ${lastEnd - (a.e - a.s)}，选中；新结束 ${lastEnd}。`);
        } else {
          push(`活动 ${idx + 1} 起 ${a.s} < 上次结束 ${lastEnd}，冲突，跳过。`);
        }
      }
      push(`活动选择完成：最多安排 ${sel.length} 个不冲突活动，判断 ${checked} 次。`, { done: true, cur: -1 });
      return finish(steps);
    },
    render(snap, p, c) {
      const acts = snap.acts || [], order = snap.order || [], sel = snap.sel || [];
      const cur = num(snap.cur, -1);
      const bars = order.map((idx) => {
        const a = acts[idx] || { s: 0, e: 1 };
        return {
          label: `活动${num(idx) + 1}`, start: num(a.s), end: num(a.e),
          color: snap.done ? (sel.includes(idx) ? c.success : c.border)
            : (cur === idx ? c.warning : (sel.includes(idx) ? c.success : c.accent)),
          note: sel.includes(idx) ? '已选' : (cur === idx ? '判断中' : '跳过'),
        };
      });
      const maxE = acts.reduce((m, a) => Math.max(m, num(a.e)), 1);
      return (
        <Timeline c={c} height={320} bars={bars} max={maxE}
          title="活动选择 · 按结束时间贪心" subtitle={String(snap.done ? `选中 ${sel.length} 个活动` : `已选 ${sel.length} · 判断 ${num(snap.checked)} 次 · 上一个结束 ${num(snap.lastEnd) < 0 ? '-' : num(snap.lastEnd)}`)} />
      );
    },
  },

  'fractional-knapsack': {
    params: [
      { key: 'items', label: '物品数量', type: 'range', min: 5, max: 10, step: 1, default: 7 },
      { key: 'capacity', label: '背包容量', type: 'range', min: 10, max: 30, step: 1, default: 18 },
      { key: 'seed', label: '随机种子', type: 'range', min: 1, max: 30, step: 1, default: 7 },
    ],
    height: 320,
    legend: [
      { color: '#12a06a', label: '整件装入' },
      { color: '#f5a524', label: '部分装入' },
      { color: '#7D87AB', label: '未装入' },
      { color: '#226AFF', label: '单位价值比排序' },
    ],
    hint: '先按单位价值 v/w 降序排序，再依次整件装；装不下时按比例切分最后一件。',
    buildSteps(p) {
      const rnd = mulberry32(p.seed * 67 + 29);
      const items = Array.from({ length: p.items }, (_, i) => ({
        i, w: 1 + Math.floor(rnd() * 8), v: 1 + Math.floor(rnd() * 20), ratio: 0,
      }));
      items.forEach((it) => { it.ratio = it.v / it.w; });
      const steps = [];
      let order = items.map((it) => it.i), cur = -1, remain = p.capacity, value = 0;
      const take = Array(p.items).fill(0);
      const push = (note, extra = {}) => steps.push({
        items: items.map((it) => ({ ...it })), order: [...order], take: [...take],
        cur, remain, value, done: false, note,
        metrics: { 剩余容量: remain, 累计价值: value, 已装件数: take.filter((x) => x > 0).length },
        ...extra,
      });
      push(`生成 ${p.items} 件物品，背包容量 ${p.capacity}；先计算单位价值比 v/w。`);
      items.forEach((it) => push(`物品 ${it.i + 1}：重 ${it.w}，值 ${it.v}，单位价值 ${fmt(it.ratio, 2)}。`));
      for (let i = 0; i < order.length - 1; i++) {
        for (let j = 0; j < order.length - 1 - i; j++) {
          if (items[order[j]].ratio < items[order[j + 1]].ratio) {
            const t = order[j]; order[j] = order[j + 1]; order[j + 1] = t;
            push(`排序：物品 ${order[j] + 1} 单位价值低于 ${order[j + 1] + 1}，交换。`);
          }
        }
      }
      push(`按 v/w 降序：${order.map((i) => i + 1).join(' → ')}；开始装填。`);
      for (const idx of order) {
        const it = items[idx]; cur = idx;
        if (remain <= 0) { push(`背包已满，物品 ${idx + 1} 跳过。`); continue; }
        if (remain >= it.w) {
          take[idx] = it.w; remain -= it.w; value += it.v;
          push(`整件装入物品 ${idx + 1}：用容量 ${it.w}，价值 +${it.v}，剩余 ${remain}。`);
        } else {
          take[idx] = remain; value += remain * it.ratio;
          push(`仅装物品 ${idx + 1} 的 ${fmt(remain, 1)}/${it.w}：价值 +${fmt(remain * it.ratio, 1)}，背包装满。`);
          remain = 0;
        }
      }
      push(`部分背包完成：总价值 ${fmt(value, 2)}，剩余容量 ${fmt(remain, 1)}。`, { done: true, cur: -1 });
      return finish(steps);
    },
    render(snap, p, c) {
      const items = snap.items || [], order = snap.order || [], take = snap.take || [];
      const cur = num(snap.cur, -1), cap = Math.max(1, p.capacity);
      let cum = 0;
      const bars = order.map((idx) => {
        const it = items[idx] || { i: idx, w: 1 };
        const t = num(take[idx], 0);
        const bar = {
          label: `物${num(idx) + 1}`, start: cum, end: cum + t,
          color: snap.done ? (t >= num(it.w) ? c.success : (t > 0 ? c.warning : c.border))
            : (cur === idx ? c.warning : (t > 0 ? c.success : c.accent)),
          note: t > 0 ? fmt(t, 1) : '-',
        };
        cum += t;
        return bar;
      });
      return (
        <Timeline c={c} height={320} bars={bars} max={cap}
          title="部分背包 · 按单位价值装填" subtitle={String(snap.done ? `总价值 ${fmt(num(snap.value), 2)} · 容量 ${cap}` : `剩余 ${fmt(num(snap.remain), 1)} · 累计价值 ${fmt(num(snap.value), 2)}`)} />
      );
    },
  },

  'huffman-coding': {
    params: [
      { key: 'symbols', label: '符号数量', type: 'range', min: 5, max: 8, step: 1, default: 6 },
      { key: 'seed', label: '随机种子', type: 'range', min: 1, max: 30, step: 1, default: 7 },
      { key: 'showCodes', label: '显示编码分配', type: 'toggle', default: true, hint: '开启时逐个叶子展示 0/1 编码' },
    ],
    height: 380,
    legend: [
      { color: '#226AFF', label: '叶节点（符号）' },
      { color: '#f5a524', label: '新合并节点' },
      { color: '#12a06a', label: '已分配编码' },
      { color: '#e5484d', label: '刚取出的两个最小节点' },
    ],
    hint: '每次取频次最小的两棵树合并成新树，直到只剩一棵；左枝记 0、右枝记 1 得到最优前缀码。',
    buildSteps(p) {
      const rnd = mulberry32(p.seed * 71 + 37);
      const nodes = [];
      for (let i = 0; i < p.symbols; i++) {
        nodes.push({ id: i, weight: 1 + Math.floor(rnd() * 30), ch: String.fromCharCode(97 + i), left: -1, right: -1, code: '' });
      }
      let queue = nodes.map((n) => n.id);
      const steps = [];
      let lastPair = [], active = -1, codesDone = 0;
      const push = (note, extra = {}) => steps.push({
        nodes: nodes.map((n) => ({ ...n })), queue: [...queue], lastPair: [...lastPair], active, codesDone, done: false, note,
        metrics: { 节点数: nodes.length, 待合并: queue.length, 已分配编码: codesDone },
        ...extra,
      });
      push(`${p.symbols} 个符号及其频次：${nodes.map((n) => `${n.ch}:${n.weight}`).join(' ')}。`);
      nodes.forEach((n) => push(`初始化叶节点 ${n.ch}，频次 ${n.weight}。`));
      while (queue.length > 1) {
        queue.sort((x, y) => nodes[x].weight - nodes[y].weight || x - y);
        const a = queue.shift(), b = queue.shift();
        lastPair = [a, b];
        push(`取出两个最小节点 ${nodes[a].ch}(${nodes[a].weight}) 与 ${nodes[b].ch}(${nodes[b].weight})。`);
        const id = nodes.length;
        nodes.push({ id, weight: nodes[a].weight + nodes[b].weight, ch: '+', left: a, right: b, code: '' });
        active = id;
        push(`合并为新节点 ${id}，频次 ${nodes[id].weight} = ${nodes[a].weight}+${nodes[b].weight}。`);
        queue.push(id);
        push(`新节点 ${id} 入队，队列剩 ${queue.length} 棵树。`);
      }
      const root = queue[0];
      push(`只剩根节点 ${root}，频次 ${nodes[root].weight}，开始分配 0/1 编码。`);
      const assign = (id, code, d) => {
        if (id < 0) return;
        nodes[id].code = code; active = id;
        if (nodes[id].left < 0) {
          codesDone++;
          if (p.showCodes) push(`叶节点 ${nodes[id].ch} 的编码为 ${code || '（空）'}（路径长度 ${d}）。`);
        } else {
          push(`节点 ${id} 走左枝记 0、右枝记 1。`);
          assign(nodes[id].left, code + '0', d + 1);
          assign(nodes[id].right, code + '1', d + 1);
        }
      };
      assign(root, '', 0);
      const total = nodes.filter((n) => n.left < 0).reduce((s, n) => s + n.weight * n.code.length, 0);
      push(`哈夫曼编码完成：带权路径长度 ${total}。`, { done: true, active: -1, lastPair: [] });
      return finish(steps);
    },
    render(snap, p, c) {
      const nodes = snap.nodes || [], lastPair = snap.lastPair || [], active = num(snap.active, -1);
      const byId = new Map(nodes.map((n) => [num(n.id), n]));
      const childIds = new Set();
      nodes.forEach((n) => { if (num(n.left) >= 0) childIds.add(num(n.left)); if (num(n.right) >= 0) childIds.add(num(n.right)); });
      const roots = nodes.filter((n) => !childIds.has(num(n.id)));
      const leaves = nodes.filter((n) => num(n.left) < 0).length || 1;
      let rank = 0;
      const posMap = new Map();
      const maxDepth = Math.max(1, ...nodes.map((n) => String(n.code || '').length));
      const walk = (id, depth) => {
        const n = byId.get(id);
        if (!n) return 0.5;
        const l = num(n.left), r = num(n.right);
        let x;
        if (l < 0 && r < 0) { x = leaves > 1 ? rank / (leaves - 1) : 0.5; rank++; }
        else { const xl = walk(l, depth + 1), xr = walk(r, depth + 1); x = (xl + xr) / 2; }
        posMap.set(num(id), { x, y: depth / maxDepth });
        return x;
      };
      roots.forEach((r) => walk(num(r.id), 0));
      const gvNodes = nodes.map((n) => {
        const id = num(n.id);
        return {
          id: String(id), label: String(n.ch), sub: n.code ? String(`码${n.code}`) : undefined,
          x: (posMap.get(id) || { x: 0.5 }).x, y: (posMap.get(id) || { y: 0 }).y, r: 13,
          state: snap.done ? 'done' : (lastPair.includes(id) ? 'bad' : (id === active ? 'warn' : (num(n.left) < 0 ? 'current' : 'idle'))),
        };
      });
      const gvEdges = [];
      nodes.forEach((n) => {
        [num(n.left), num(n.right)].forEach((kid, k) => {
          if (kid >= 0) gvEdges.push({ from: String(n.id), to: String(kid), label: k === 0 ? '0' : '1', state: 'active' });
        });
      });
      return (
        <GraphView c={c} height={380} nodes={gvNodes} edges={gvEdges} directed
          title="哈夫曼编码 · 合并树与 0/1 路径" subtitle={String(snap.done ? `已分配 ${num(snap.codesDone)} 个编码` : `待合并 ${num(snap.queue && snap.queue.length)} 棵 · 已分配 ${num(snap.codesDone)}`)} />
      );
    },
  },

  'lcs': {
    params: [
      { key: 'lenA', label: '序列 A 长度', type: 'range', min: 6, max: 11, step: 1, default: 8 },
      { key: 'lenB', label: '序列 B 长度', type: 'range', min: 6, max: 11, step: 1, default: 8 },
      { key: 'seed', label: '随机种子', type: 'range', min: 1, max: 30, step: 1, default: 7 },
      { key: 'detail', label: '显示单元格推导', type: 'toggle', default: true, hint: '关闭后每格只写入结果' },
    ],
    height: 340,
    legend: [
      { color: '#226AFF', label: '已填充 DP 值' },
      { color: '#f5a524', label: '当前单元格' },
      { color: '#12a06a', label: '回溯路径（公共子序列）' },
      { color: '#7D87AB', label: '尚未计算' },
    ],
    hint: '两串末尾相同则取左上角加 1，否则取上方与左方的较大值；再从右下角回溯出子序列。',
    buildSteps(p) {
      const rnd = mulberry32(p.seed * 73 + 11);
      const A = shuffledLetters(rnd, p.lenA, ['A', 'C', 'G', 'T']);
      const B = shuffledLetters(rnd, p.lenB, ['A', 'C', 'G', 'T']);
      const m = A.length, n = B.length;
      const full = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));
      for (let i = 1; i <= m; i++) {
        for (let j = 1; j <= n; j++) {
          full[i][j] = A[i - 1] === B[j - 1] ? full[i - 1][j - 1] + 1 : Math.max(full[i - 1][j], full[i][j - 1]);
        }
      }
      const dp = Array.from({ length: m + 1 }, () => Array(n + 1).fill(undefined));
      for (let j = 0; j <= n; j++) dp[0][j] = 0;
      for (let i = 0; i <= m; i++) dp[i][0] = 0;
      const steps = [];
      let filled = 0, ci = -1, cj = -1;
      const push = (note, extra = {}) => steps.push({
        A: [...A], B: [...B], dp: dp.map((r) => [...r]), ci, cj, filled,
        path: [], result: '', done: false, note,
        metrics: { 已填单元格: filled, 最长公共子序列长度: full[m][n], 表格行数: m + 1, 表格列数: n + 1 },
        ...extra,
      });
      push(`A=${A.join('')}，B=${B.join('')}；DP 表 ${m + 1}×${n + 1}，首行首列填 0。`);
      for (let i = 1; i <= m; i++) {
        for (let j = 1; j <= n; j++) {
          ci = i; cj = j;
          if (p.detail) {
            push(`单元格 [${i},${j}]：A[${i - 1}]=${A[i - 1]}，B[${j - 1}]=${B[j - 1]}，${A[i - 1] === B[j - 1] ? '相同，取左上+1' : `不同，取 max(${full[i - 1][j]}, ${full[i][j - 1]})`}。`);
          }
          dp[i][j] = full[i][j]; filled++;
          push(`写入 dp[${i}][${j}]=${full[i][j]}。`);
        }
      }
      const path = [];
      let i = m, j = n, seq = [];
      push(`填表完成，LCS 长度 ${full[m][n]}；从右下角回溯。`);
      while (i > 0 && j > 0) {
        if (A[i - 1] === B[j - 1]) {
          seq.unshift(A[i - 1]); path.push({ r: i, c: j }); i--; j--;
          push(`A[${i}]=B[${j}]=${A[i]} 相同，加入子序列并斜向上移。`);
        } else if (full[i - 1][j] >= full[i][j - 1]) {
          path.push({ r: i, c: j }); i--;
          push(`上方 ${full[i + 1][j]} ≥ 左方 ${full[i][j + 1]}，向上移动。`);
        } else {
          path.push({ r: i, c: j }); j--;
          push(`左方 ${full[i][j + 1]} 更大，向左移动。`);
        }
      }
      push(`回溯完成：最长公共子序列为 ${seq.join('') || '（空）'}，长度 ${full[m][n]}。`, {
        done: true, path: [...path], result: seq.join(''), ci: -1, cj: -1,
      });
      return finish(steps);
    },
    render(snap, p, c) {
      const dp = snap.dp || [], A = snap.A || [], B = snap.B || [], path = snap.path || [];
      const highlight = [];
      if (num(snap.ci, -1) >= 0) highlight.push({ r: num(snap.ci), c: num(snap.cj), color: c.warning });
      if (snap.done) path.forEach((q) => highlight.push({ r: num(q.r), c: num(q.c), color: c.success }));
      return (
        <Matrix c={c} height={340} table={dp} path={snap.done ? path : []} highlight={highlight}
          rowLabels={['∅', ...A.map(String)]} colLabels={['∅', ...B.map(String)]}
          title="LCS · 二维 DP 表与回溯" subtitle={String(snap.done ? `LCS=${String(snap.result || '')} · 长度 ${num(snap.metrics && snap.metrics['最长公共子序列长度'])}` : `已填 ${num(snap.filled)} 格 · 当前 [${num(snap.ci)},${num(snap.cj)}]`)} />
      );
    },
  },

  'lis': {
    params: [
      { key: 'n', label: '元素个数', type: 'range', min: 8, max: 18, step: 1, default: 12 },
      { key: 'seed', label: '随机种子', type: 'range', min: 1, max: 30, step: 1, default: 7 },
      { key: 'method', label: '解法', type: 'select', default: 'tails',
        options: [{ value: 'tails', label: '贪心+二分 O(n log n)' }, { value: 'dp', label: '二维思想的一维 DP O(n²)' }] },
    ],
    height: 320,
    legend: [
      { color: '#226AFF', label: '原数组' },
      { color: '#f5a524', label: '当前处理元素' },
      { color: '#12a06a', label: 'tails / dp 值' },
      { color: '#0ea5a5', label: '被替换位置' },
    ],
    hint: 'tails[k] 保存长度为 k+1 的递增子序列的最小结尾；用二分找到替换位置，数组始终有序。',
    buildSteps(p) {
      const arr = makeArray(p.n, 'random', p.seed);
      const steps = [];
      let pos = -1, cmp = 0, replaced = -1;
      const push = (note, extra = {}) => steps.push({
        arr: [...arr], tails: (snapTails || []).slice(), dp: (snapDp || []).slice(),
        pos, cmp, replaced, done: false, note,
        metrics: { 比较次数: cmp, 已处理: pos + 1, 'LIS 长度': (snapTails || []).length },
        ...extra,
      });
      let snapTails = null, snapDp = null;
      push(`数组 ${arr.join(', ')}；采用${p.method === 'tails' ? ' tails+二分' : '一维 DP'}解法。`);
      if (p.method === 'tails') {
        snapTails = [];
        push('tails 为空，开始从左到右处理每个元素。');
        for (pos = 0; pos < arr.length; pos++) {
          const x = arr[pos]; replaced = -1;
          push(`处理 arr[${pos}]=${x}，当前 tails=[${snapTails.join(',')}]。`);
          let lo = 0, hi = snapTails.length;
          while (lo < hi) {
            const mid = (lo + hi) >> 1; cmp++; replaced = mid;
            push(`二分：tails[${mid}]=${snapTails[mid]} ${snapTails[mid] < x ? '<' : '≥'} ${x}，${snapTails[mid] < x ? '右半' : '左半'}继续。`);
            if (snapTails[mid] < x) lo = mid + 1; else hi = mid;
          }
          if (lo === snapTails.length) {
            snapTails.push(x);
            push(`追加 ${x} 到 tails 末尾，LIS 长度变为 ${snapTails.length}。`);
          } else {
            snapTails[lo] = x;
            push(`用 ${x} 替换 tails[${lo}]（更小结尾更有利）。`);
          }
        }
      } else {
        snapDp = Array(arr.length).fill(undefined);
        let best = 0;
        for (pos = 0; pos < arr.length; pos++) {
          let val = 1;
          snapDp[pos] = val;
          push(`dp[${pos}] 初始为 1（只有 arr[${pos}]=${arr[pos]} 自己）。`);
          for (let j = 0; j < pos; j++) {
            cmp++; replaced = j;
            push(`比较 arr[${j}]=${arr[j]} ${arr[j] < arr[pos] ? '<' : '≥'} arr[${pos}]=${arr[pos]}，dp[${j}]=${snapDp[j]}。`);
            if (arr[j] < arr[pos] && snapDp[j] + 1 > val) {
              val = snapDp[j] + 1; snapDp[pos] = val;
              push(`更新 dp[${pos}]=${val}。`);
            }
          }
          best = Math.max(best, val);
          push(`dp[${pos}]=${val} 确定，当前最长 ${best}。`);
        }
      }
      push(`LIS 完成：长度 ${p.method === 'tails' ? snapTails.length : Math.max(...snapDp.map((v) => num(v, 0)))}，比较 ${cmp} 次。`, { done: true, pos: -1 });
      return finish(steps);
    },
    render(snap, p, c) {
      const arr = snap.arr || [], tails = snap.tails || [], dp = snap.dp || [];
      const pos = num(snap.pos, -1), replaced = num(snap.replaced, -1);
      const items = arr.map((v, i) => ({
        text: String(v), sub: String(i),
        color: snap.done ? c.success : (i === pos ? c.warning : (i === replaced ? c.teal : c.primary)),
      }));
      const extra = tails.length ? tails : dp;
      extra.forEach((v, i) => items.push({
        text: v === undefined ? '·' : String(v), sub: tails.length ? `tail${i}` : `dp${i}`,
        color: (tails.length ? c.success : c.purple),
      }));
      return (
        <Cells c={c} height={320} items={items} wrap={Math.max(arr.length, 1)} cellW={30} cellH={32} gap={4}
          title="LIS · 原数组 / tails（或 dp）" subtitle={String(snap.done ? `LIS 长度 ${tails.length || Math.max(...dp.map((v) => num(v, 0)))}` : `处理下标 ${pos} · 比较 ${num(snap.cmp)} 次 · 第二行为${tails.length ? 'tails' : 'dp'}`)} />
      );
    },
  },

  'edit-distance': {
    params: [
      { key: 'lenA', label: '串 A 长度', type: 'range', min: 6, max: 11, step: 1, default: 8 },
      { key: 'lenB', label: '串 B 长度', type: 'range', min: 6, max: 11, step: 1, default: 8 },
      { key: 'seed', label: '随机种子', type: 'range', min: 1, max: 30, step: 1, default: 7 },
      { key: 'allowReplace', label: '允许替换算 1 步', type: 'toggle', default: true, hint: '关闭后替换视为删+插，代价 2' },
    ],
    height: 340,
    legend: [
      { color: '#226AFF', label: '已填充 DP 值' },
      { color: '#f5a524', label: '当前单元格' },
      { color: '#12a06a', label: '回溯路径' },
      { color: '#7D87AB', label: '尚未计算' },
    ],
    hint: 'dp[i][j] 是 A 前 i 字符变成 B 前 j 字符的最小代价，取删除、插入、替换三种转移的最小值。',
    buildSteps(p) {
      const rnd = mulberry32(p.seed * 79 + 13);
      const A = shuffledLetters(rnd, p.lenA, ['a', 'b', 'c', 'd']);
      const B = shuffledLetters(rnd, p.lenB, ['a', 'b', 'c', 'd']);
      const m = A.length, n = B.length;
      const repCost = (i, j) => A[i - 1] === B[j - 1] ? 0 : (p.allowReplace ? 1 : 2);
      const full = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));
      for (let i = 0; i <= m; i++) full[i][0] = i;
      for (let j = 0; j <= n; j++) full[0][j] = j;
      for (let i = 1; i <= m; i++) {
        for (let j = 1; j <= n; j++) {
          full[i][j] = Math.min(full[i - 1][j] + 1, full[i][j - 1] + 1, full[i - 1][j - 1] + repCost(i, j));
        }
      }
      const dp = Array.from({ length: m + 1 }, () => Array(n + 1).fill(undefined));
      for (let i = 0; i <= m; i++) dp[i][0] = i;
      for (let j = 0; j <= n; j++) dp[0][j] = j;
      const steps = [];
      let ci = -1, cj = -1, filled = 0;
      const push = (note, extra = {}) => steps.push({
        A: [...A], B: [...B], dp: dp.map((r) => [...r]), ci, cj, filled,
        path: [], ops: [], result: '', done: false, note,
        metrics: { 已填单元格: filled, 编辑距离: full[m][n], 表格行数: m + 1, 表格列数: n + 1 },
        ...extra,
      });
      push(`A=${A.join('')}，B=${B.join('')}；首行首列初始化为 0..n / 0..m。`);
      for (let i = 1; i <= m; i++) {
        for (let j = 1; j <= n; j++) {
          ci = i; cj = j;
          const del = full[i - 1][j] + 1, ins = full[i][j - 1] + 1, rep = full[i - 1][j - 1] + repCost(i, j);
          push(`单元格 [${i},${j}]：删除=${del}，插入=${ins}，替换=${rep}，取最小。`);
          dp[i][j] = full[i][j]; filled++;
          push(`写入 dp[${i}][${j}]=${full[i][j]}。`);
        }
      }
      const path = [], ops = [];
      let i = m, j = n;
      push(`填表完成，编辑距离 ${full[m][n]}；开始回溯操作序列。`);
      while (i > 0 || j > 0) {
        path.push({ r: i, c: j });
        if (i > 0 && j > 0 && full[i][j] === full[i - 1][j - 1] + repCost(i, j)) {
          ops.unshift(A[i - 1] === B[j - 1] ? `保留 ${A[i - 1]}` : `替换 ${A[i - 1]}→${B[j - 1]}`);
          i--; j--;
          push(`回溯：${ops[0]}，斜向上移。`);
        } else if (i > 0 && full[i][j] === full[i - 1][j] + 1) {
          ops.unshift(`删除 ${A[i - 1]}`); i--;
          push(`回溯：删除 ${A[i - 1]}，向上移动。`);
        } else {
          ops.unshift(`插入 ${B[j - 1]}`); j--;
          push(`回溯：插入 ${B[j - 1]}，向左移动。`);
        }
      }
      push(`编辑距离 ${full[m][n]}；操作：${ops.join(' / ') || '无需修改'}。`, {
        done: true, path: [...path], ops: [...ops], result: ops.join(' / '), ci: -1, cj: -1,
      });
      return finish(steps);
    },
    render(snap, p, c) {
      const dp = snap.dp || [], A = snap.A || [], B = snap.B || [], path = snap.path || [];
      const highlight = [];
      if (num(snap.ci, -1) >= 0) highlight.push({ r: num(snap.ci), c: num(snap.cj), color: c.warning });
      if (snap.done) path.forEach((q) => highlight.push({ r: num(q.r), c: num(q.c), color: c.success }));
      return (
        <Matrix c={c} height={340} table={dp} path={snap.done ? path : []} highlight={highlight}
          rowLabels={['∅', ...A.map(String)]} colLabels={['∅', ...B.map(String)]}
          title="编辑距离 · DP 表与操作回溯" subtitle={String(snap.done ? `距离 ${num(snap.metrics && snap.metrics['编辑距离'])} · ${String(snap.result || '')}` : `已填 ${num(snap.filled)} 格 · 当前 [${num(snap.ci)},${num(snap.cj)}]`)} />
      );
    },
  },

  'coin-change': {
    params: [
      { key: 'amount', label: '目标金额', type: 'range', min: 10, max: 30, step: 1, default: 20 },
      { key: 'coins', label: '硬币面额', type: 'select', default: 'us',
        options: [
          { value: 'us', label: '1,5,10,25' },
          { value: 'odd', label: '1,3,5' },
          { value: 'even', label: '2,5,7' },
        ] },
      { key: 'mode', label: '求解目标', type: 'select', default: 'min',
        options: [{ value: 'min', label: '最少硬币数' }, { value: 'ways', label: '组合方案数' }] },
    ],
    height: 320,
    legend: [
      { color: '#226AFF', label: 'DP 值（最少枚数 / 方案数）' },
      { color: '#f5a524', label: '当前金额' },
      { color: '#12a06a', label: '凑出目标的方案' },
      { color: '#7D87AB', label: '不可达（显示为 0）' },
    ],
    hint: '完全背包：外层枚举硬币、内层升序枚举金额；最少硬币取 min，组合数则做累加且硬币必须在外层。',
    buildSteps(p) {
      const sets = { us: [1, 5, 10, 25], odd: [1, 3, 5], even: [2, 5, 7] };
      const cs = sets[p.coins] || sets.us;
      const INF = 1e9;
      const dp = Array(p.amount + 1).fill(p.mode === 'min' ? INF : 0);
      dp[0] = p.mode === 'min' ? 0 : 1;
      const steps = [];
      let coin = -1, amt = -1, cur = 0;
      const push = (note, extra = {}) => steps.push({
        dp: [...dp], coins: [...cs], coin, amt, mode: p.mode, amount: p.amount, chosen: [], done: false, note,
        metrics: { 当前硬币: coin < 0 ? 0 : coin, 当前金额: amt < 0 ? 0 : amt, 目标值: dp[p.amount] >= INF ? 0 : dp[p.amount] },
        ...extra,
      });
      push(`目标 ${p.amount}，硬币 [${cs.join(',')}]，模式 ${p.mode === 'min' ? '最少硬币数' : '组合方案数'}。`);
      push(`初始化 dp[0]=${p.mode === 'min' ? 0 : 1}，其余为 ${p.mode === 'min' ? 'INF（不可达）' : '0'}。`);
      for (const c of cs) {
        coin = c;
        push(`处理硬币 ${c}，金额从小到大枚举（保证完全背包）。`);
        for (let a = c; a <= p.amount; a++) {
          amt = a;
          if (p.mode === 'min') {
            const cand = dp[a - c] + 1;
            const next = Math.min(dp[a], cand);
            push(`dp[${a}]: min(原 ${dp[a] >= INF ? 'INF' : dp[a]}, dp[${a - c}]+1=${cand}) → ${next}。`);
            dp[a] = next;
          } else {
            dp[a] += dp[a - c];
            push(`dp[${a}] += dp[${a - c}]=${dp[a - c]} → ${dp[a]}。`);
          }
        }
      }
      const chosen = [];
      if (p.mode === 'min' && dp[p.amount] < INF) {
        let rem = p.amount;
        push(`最少硬币数 ${dp[p.amount]}，从 dp[${p.amount}] 回溯具体方案。`);
        for (let k = cs.length - 1; k >= 0 && rem > 0; k--) {
          const c = cs[k];
          while (rem >= c && dp[rem] === dp[rem - c] + 1) { chosen.push(c); rem -= c; }
        }
        push(`凑齐方案：${chosen.join(' + ') || '无'}。`);
      }
      push(`零钱兑换结束：${p.mode === 'min' ? `最少 ${dp[p.amount] >= INF ? 0 : dp[p.amount]} 枚` : `共 ${dp[p.amount]} 种组合`}。`, {
        done: true, chosen: [...chosen], coin: -1, amt: -1,
      });
      return finish(steps);
    },
    render(snap, p, c) {
      const dp = snap.dp || [], cs = snap.coins || [], chosen = snap.chosen || [];
      const amt = num(snap.amt, -1);
      const values = dp.map((v) => (num(v, 0) >= 1e8 ? 0 : num(v, 0)));
      const highlight = {};
      if (!snap.done && amt >= 0 && amt < values.length) highlight[amt] = 'warn';
      if (snap.done && chosen.length) highlight[values.length - 1] = 'hit';
      const marks = {};
      for (let i = 0; i < values.length; i += 5) marks[i] = String(i);
      return (
        <Bars c={c} height={320} values={values} highlight={highlight} marks={marks}
          title="零钱兑换 · 完全背包 DP" subtitle={String(snap.done ? (snap.mode === 'min' ? `最少 ${num(dp[dp.length - 1])} 枚 · ${chosen.join('+') || '-'}` : `组合数 ${num(dp[dp.length - 1])}`) : `硬币 ${num(snap.coin) < 0 ? '-' : num(snap.coin)} · 金额 ${amt < 0 ? '-' : amt} · ${snap.mode === 'min' ? '取最小' : '累加方案'}`)}
          baselineLabel="横轴=金额；柱高=最少枚数或组合数，0 表示不可达 / 起始" />
      );
    },
  },

  'matrix-chain': {
    params: [
      { key: 'count', label: '矩阵个数', type: 'range', min: 4, max: 6, step: 1, default: 5 },
      { key: 'seed', label: '随机种子', type: 'range', min: 1, max: 30, step: 1, default: 7 },
      { key: 'detail', label: '显示每个分割点', type: 'toggle', default: true, hint: '关闭后只记录每个区间的最优值' },
    ],
    height: 340,
    legend: [
      { color: '#226AFF', label: '已算出的最小代价' },
      { color: '#f5a524', label: '当前分割点 k' },
      { color: '#12a06a', label: '最优加括号回溯路径' },
      { color: '#7D87AB', label: '尚未计算' },
    ],
    hint: '按链长递增枚举区间 [i,j]，对每个分割点 k 计算左代价+右代价+三者相乘的标量次数，取最小。',
    buildSteps(p) {
      const rnd = mulberry32(p.seed * 83 + 5);
      const dims = Array.from({ length: p.count + 1 }, () => 1 + Math.floor(rnd() * 9));
      const n = p.count;
      const m = Array.from({ length: n + 1 }, () => Array(n + 1).fill(undefined));
      const split = Array.from({ length: n + 1 }, () => Array(n + 1).fill(-1));
      for (let i = 1; i <= n; i++) m[i][i] = 0;
      const steps = [];
      let ci = -1, cj = -1, ck = -1, filled = 0;
      const push = (note, extra = {}) => steps.push({
        dims: [...dims], m: m.map((r) => [...r]), split: split.map((r) => [...r]),
        ci, cj, ck, filled, expr: '', path: [], done: false, note,
        metrics: { 已填区间: filled, 最小标量乘次数: m[n][n] === undefined ? 0 : m[n][n], 矩阵数: n },
        ...extra,
      });
      push(`矩阵链维度 p=[${dims.join(', ')}]，共 ${n} 个矩阵；单矩阵代价为 0。`);
      for (let L = 2; L <= n; L++) {
        for (let i = 1; i + L - 1 <= n; i++) {
          const j = i + L - 1;
          ci = i; cj = j;
          let best = 1e15, bestK = -1;
          push(`区间 M${i}..M${j}（链长 ${L}），枚举分割点。`);
          for (let k = i; k < j; k++) {
            ck = k;
            const cost = num(m[i][k], 0) + num(m[k + 1][j], 0) + dims[i - 1] * dims[k] * dims[j];
            if (p.detail) push(`分割 k=${k}：左 ${num(m[i][k], 0)} + 右 ${num(m[k + 1][j], 0)} + ${dims[i - 1]}×${dims[k]}×${dims[j]} = ${cost}。`);
            if (cost < best) { best = cost; bestK = k; }
          }
          m[i][j] = best; split[i][j] = bestK; filled++; ck = -1;
          push(`区间 [${i},${j}] 最优：k=${bestK}，最小代价 ${best}。`);
        }
      }
      const path = [];
      const build = (i, j) => {
        if (i === j) return `M${i}`;
        const k = split[i][j];
        path.push({ r: i, c: j });
        push(`回溯区间 [${i},${j}]：在 k=${k} 处断开。`);
        return `(${build(i, k)} × ${build(k + 1, j)})`;
      };
      const expr = build(1, n);
      push(`最优加括号方案 ${expr}，最小标量乘次数 ${m[1][n]}。`, { done: true, expr, path: [...path], ci: -1, cj: -1 });
      return finish(steps);
    },
    render(snap, p, c) {
      const m = snap.m || [], dims = snap.dims || [], path = snap.path || [];
      const highlight = [];
      if (num(snap.ci, -1) >= 0) highlight.push({ r: num(snap.ci), c: num(snap.cj), color: c.warning });
      if (num(snap.ck, -1) >= 0) highlight.push({ r: num(snap.ci), c: num(snap.ck), color: c.teal });
      if (snap.done) path.forEach((q) => highlight.push({ r: num(q.r), c: num(q.c), color: c.success }));
      return (
        <Matrix c={c} height={340} table={m} path={snap.done ? path : []} highlight={highlight}
          rowLabels={dims.map((_, i) => (i === 0 ? '∅' : `M${i}`))}
          colLabels={dims.map((_, i) => (i === 0 ? '∅' : `M${i}`))}
          title="矩阵链乘法 · 区间 DP 表" subtitle={String(snap.done ? String(snap.expr || '') : `已填 ${num(snap.filled)} 区间 · 当前 [${num(snap.ci)},${num(snap.cj)}] · 维度 [${dims.join(',')}]`)} />
      );
    },
  },

  'permutation': {
    params: [
      { key: 'n', label: '元素个数', type: 'range', min: 4, max: 6, step: 1, default: 4 },
      { key: 'method', label: '枚举方式', type: 'select', default: 'swap',
        options: [{ value: 'swap', label: '原地交换' }, { value: 'used', label: '标记已用' }] },
      { key: 'showBack', label: '展示回溯', type: 'toggle', default: true, hint: '关闭后只保留选择帧与结果帧' },
    ],
    height: 320,
    legend: [
      { color: '#12a06a', label: '已固定的前缀' },
      { color: '#f5a524', label: '当前选中的数' },
      { color: '#226AFF', label: '待枚举' },
      { color: '#e5484d', label: '回溯撤销' },
    ],
    hint: '递归固定第 pos 位，让后面的每个元素轮流交换到该位；回到上一层时撤销交换，保证不重不漏。',
    buildSteps(p) {
      const arr = Array.from({ length: p.n }, (_, i) => i + 1);
      const steps = [];
      let solutions = 0, pos = -1, mark = '', path = [];
      const push = (note, extra = {}) => steps.push({
        arr: [...arr], method: p.method, n: p.n, pos, path: [...path], solutions, mark, done: false, note,
        metrics: { 已生成排列: solutions, 当前层: pos < 0 ? 0 : pos, 元素个数: p.n },
        ...extra,
      });
      push(`对 ${arr.join(', ')} 生成全排列，共 ${p.n}! = ${Array.from({ length: p.n }, (_, i) => i + 1).reduce((a, b) => a * b, 1)} 种。`);
      if (p.method === 'swap') {
        const dfs = (d) => {
          pos = d;
          if (d === arr.length) {
            solutions++; path = arr.slice(); mark = 'solution';
            push(`生成一个完整排列：${arr.join(', ')}（第 ${solutions} 个）。`);
            return;
          }
          for (let i = d; i < arr.length; i++) {
            const t = arr[d]; arr[d] = arr[i]; arr[i] = t;
            mark = 'choose'; path = arr.slice(0, d + 1);
            push(`第 ${d + 1} 位选择原下标 ${i} 的元素 ${arr[d]}，交换到位置 ${d}。`);
            dfs(d + 1);
            arr[i] = arr[d]; arr[d] = t;
            if (p.showBack) { mark = 'back'; push(`撤销交换，恢复第 ${d + 1} 位为 ${arr[d]}，尝试下一个元素。`); }
          }
        };
        dfs(0);
      } else {
        const used = Array(p.n).fill(false);
        const chosenNums = [];
        const dfs = () => {
          pos = chosenNums.length;
          if (chosenNums.length === p.n) {
            solutions++; path = chosenNums.slice(); mark = 'solution';
            push(`生成一个完整排列：${chosenNums.join(', ')}（第 ${solutions} 个）。`);
            return;
          }
          for (let i = 0; i < p.n; i++) {
            if (used[i]) continue;
            used[i] = true; chosenNums.push(arr[i]);
            mark = 'choose'; path = chosenNums.slice();
            push(`第 ${pos + 1} 位选择 ${arr[i]}，标记已用。`);
            dfs();
            chosenNums.pop(); used[i] = false;
            if (p.showBack) { mark = 'back'; push(`撤销 ${arr[i]} 的已用标记，回溯到第 ${pos + 1} 位。`); }
          }
        };
        dfs();
      }
      push(`全排列完成，共 ${solutions} 种。`, { done: true, pos: -1, mark: 'done' });
      return finish(steps);
    },
    render(snap, p, c) {
      const arr = snap.arr || [], path = snap.path || [], pos = num(snap.pos, -1);
      const items = arr.map((v, i) => ({
        text: String(v), sub: String(i),
        color: snap.done ? c.success
          : (snap.method === 'used' ? (path.includes(v) ? c.success : (i === pos ? c.warning : c.primary))
            : (i < pos ? c.success : (i === pos ? c.warning : c.primary))),
      }));
      return (
        <Cells c={c} height={320} items={items} wrap={Math.max(arr.length, 1)} cellW={46} cellH={38} gap={5}
          title="全排列 · 回溯搜索树" subtitle={String(snap.done ? `共 ${num(snap.solutions)} 种排列` : `第 ${num(snap.solutions)} 个方案 · 层 ${pos} · ${String(snap.mark || 'choose')} · 前缀 [${path.join(',')}]`)} />
      );
    },
  },

  'subset-sum': {
    params: [
      { key: 'n', label: '元素个数', type: 'range', min: 6, max: 12, step: 1, default: 9 },
      { key: 'target', label: '目标和', type: 'range', min: 10, max: 40, step: 1, default: 25 },
      { key: 'seed', label: '随机种子', type: 'range', min: 1, max: 30, step: 1, default: 7 },
      { key: 'prune', label: '启用前缀和剪枝', type: 'toggle', default: true, hint: '超过目标或剩余全选也不够时立即回退' },
    ],
    height: 320,
    legend: [
      { color: '#12a06a', label: '选中' },
      { color: '#7D87AB', label: '不选' },
      { color: '#f5a524', label: '正在决策' },
      { color: '#e5484d', label: '剪枝' },
    ],
    hint: '每个元素做「选 / 不选」二叉决策；用后缀和判断剩余全选是否够，避免无谓展开。',
    buildSteps(p) {
      const rnd = mulberry32(p.seed * 89 + 41);
      const arr = Array.from({ length: p.n }, () => 1 + Math.floor(rnd() * 15));
      const suffix = Array(p.n + 1).fill(0);
      for (let i = p.n - 1; i >= 0; i--) suffix[i] = suffix[i + 1] + arr[i];
      const steps = [];
      let pos = -1, sum = 0, mark = '', sel = Array(p.n).fill(0), nodes = 0, prunes = 0;
      let solution = null;
      const push = (note, extra = {}) => steps.push({
        arr: [...arr], sel: [...sel], suffix: [...suffix], pos, sum, mark, nodes, prunes,
        solution: solution ? [...solution] : null, done: false, note,
        metrics: { 搜索节点: nodes, 剪枝次数: prunes, 当前和: sum, 目标和: p.target },
        ...extra,
      });
      push(`数组 [${arr.join(',')}]，目标和 ${p.target}，总和 ${suffix[0]}；自上而下枚举选或不选。`);
      arr.forEach((v, i) => push(`元素 ${i + 1}=${v}，其后缀和（含它）为 ${suffix[i]}。`));
      const dfs = (d, s) => {
        nodes++; pos = d; sum = s;
        if (s === p.target) {
          solution = sel.slice(); mark = 'hit';
          push(`找到可行子集，和恰好为 ${p.target}：${sel.map((v, i) => v ? arr[i] : null).filter((v) => v !== null).join(' + ')}。`);
          return true;
        }
        if (d === arr.length) { mark = 'fail'; push(`已到末尾但和为 ${s}，此分支失败。`); return false; }
        if (p.prune && s > p.target) { prunes++; mark = 'prune'; push(`当前和 ${s} 已超过目标 ${p.target}，剪枝。`); return false; }
        if (p.prune && s + suffix[d] < p.target) { prunes++; mark = 'prune'; push(`剩余元素全选也只有 ${s + suffix[d]} < ${p.target}，剪枝。`); return false; }
        sel[d] = 1; mark = 'choose';
        push(`第 ${d + 1} 个元素 ${arr[d]}：先尝试选中，和变为 ${s + arr[d]}。`);
        if (dfs(d + 1, s + arr[d])) return true;
        sel[d] = 0; mark = 'skip';
        push(`撤销选中 ${arr[d]}，改试不选，和仍为 ${s}。`);
        if (dfs(d + 1, s)) return true;
        return false;
      };
      const ok = dfs(0, 0);
      push(ok
        ? `子集和求解成功：找到和为 ${p.target} 的子集，搜索 ${nodes} 个节点、剪枝 ${prunes} 次。`
        : `子集和求解结束：不存在和为 ${p.target} 的子集，搜索 ${nodes} 个节点。`, { done: true, pos: -1 });
      return finish(steps);
    },
    render(snap, p, c) {
      const arr = snap.arr || [], sel = snap.sel || [], solution = snap.solution || [];
      const pos = num(snap.pos, -1), mark = String(snap.mark || 'choose');
      const items = arr.map((v, i) => ({
        text: String(v), sub: String(i),
        color: snap.done && solution.length ? (solution[i] ? c.success : c.border)
          : (i === pos ? (mark === 'prune' ? c.danger : c.warning) : (sel[i] ? c.success : c.accent)),
      }));
      return (
        <Cells c={c} height={320} items={items} wrap={Math.max(arr.length, 1)} cellW={40} cellH={36} gap={5}
          title="子集和 · 选/不选决策树" subtitle={String(snap.done ? `目标和 ${num(p.target)} · 节点 ${num(snap.nodes)} · 剪枝 ${num(snap.prunes)}` : `当前和 ${num(snap.sum)} / ${num(p.target)} · 节点 ${num(snap.nodes)} · 剪枝 ${num(snap.prunes)}`)} />
      );
    },
  },

  'sudoku-solver': {
    params: [
      { key: 'preset', label: '题目难度', type: 'select', default: 'medium',
        options: [{ value: 'easy', label: '简单（挖空 32）' }, { value: 'medium', label: '中等（挖空 42）' }, { value: 'hard', label: '困难（挖空 52）' }] },
      { key: 'seed', label: '随机种子', type: 'range', min: 1, max: 30, step: 1, default: 7 },
      { key: 'showCandidates', label: '显示候选数', type: 'toggle', default: true, hint: '在当前格下方显示候选数字' },
    ],
    height: 400,
    legend: [
      { color: '#7D87AB', label: '题目给定' },
      { color: '#12a06a', label: '求解填入' },
      { color: '#f5a524', label: '当前格 / 候选' },
      { color: '#e5484d', label: '冲突回退' },
    ],
    hint: '每次选择候选数最少的空格（MRV）填入，行/列/宫三重约束传播；走不通就回退换数。',
    buildSteps(p) {
      const rnd = mulberry32(p.seed * 97 + 53);
      const side = 9, base = 3;
      const map = [0, 1, 2, 3, 4, 5, 6, 7, 8];
      for (let i = 8; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); const t = map[i]; map[i] = map[j]; map[j] = t; }
      const solved = Array.from({ length: side }, (_, r) => Array.from({ length: side }, (_, col) =>
        map[(base * (r % base) + Math.floor(r / base) + col) % side] + 1));
      const blanks = p.preset === 'easy' ? 32 : (p.preset === 'hard' ? 52 : 42);
      const grid = solved.map((row) => [...row]);
      let removed = 0;
      while (removed < blanks) {
        const r = Math.floor(rnd() * side), col = Math.floor(rnd() * side);
        if (grid[r][col] !== 0) { grid[r][col] = 0; removed++; }
      }
      const puzzle = grid.map((row) => [...row]);
      const steps = [];
      let attempts = 0, backtracks = 0, cur = [-1, -1], mark = '';
      let candidates = [];
      const push = (note, extra = {}) => steps.push({
        grid: grid.map((row) => [...row]), puzzle: puzzle.map((row) => [...row]),
        cur: [...cur], candidates: [...candidates], attempts, backtracks, blanks: removed, done: false, note,
        metrics: { 尝试次数: attempts, 回溯次数: backtracks, 已填格数: grid.flat().filter((v) => v > 0).length, 空格数: removed },
        ...extra,
      });
      push(`数独 ${side}×${side}，挖空 ${removed} 格；采用候选最少优先（MRV）+ 回溯。`);
      const okAt = (r, col, v) => {
        for (let k = 0; k < side; k++) if (grid[r][k] === v || grid[k][col] === v) return false;
        const br = Math.floor(r / base) * base, bc = Math.floor(col / base) * base;
        for (let dr = 0; dr < base; dr++) for (let dc = 0; dc < base; dc++) if (grid[br + dr][bc + dc] === v) return false;
        return true;
      };
      const candAt = (r, col) => {
        const out = [];
        for (let v = 1; v <= side; v++) if (okAt(r, col, v)) out.push(v);
        return out;
      };
      const dfs = () => {
        if (steps.length >= 560) return false;
        let bestR = -1, bestC = -1, best = null;
        for (let r = 0; r < side; r++) {
          for (let col = 0; col < side; col++) {
            if (grid[r][col] !== 0) continue;
            const cs = candAt(r, col);
            if (cs.length === 0) return false;
            if (best === null || cs.length < best.length) { best = cs; bestR = r; bestC = col; }
          }
        }
        if (best === null) return true;
        cur = [bestR, bestC]; candidates = best; mark = 'candidate';
        push(`第 ${bestR + 1} 行第 ${bestC + 1} 列候选最少：${best.join('/')}。`);
        for (const v of best) {
          attempts++;
          grid[bestR][bestC] = v; mark = 'place';
          push(`尝试在第 ${bestR + 1} 行第 ${bestC + 1} 列填入 ${v}。`);
          if (dfs()) return true;
          grid[bestR][bestC] = 0; backtracks++; mark = 'back';
          push(`填 ${v} 导致后续无解，撤销并回退。`);
          if (steps.length >= 560) return false;
        }
        return false;
      };
      const ok = dfs();
      push(ok ? `数独求解完成，共尝试 ${attempts} 次、回退 ${backtracks} 次。`
        : `求解中断：达到演示帧数上限，已尝试 ${attempts} 次。`, { done: true, cur: [-1, -1] });
      return finish(steps);
    },
    render(snap, p, c) {
      const grid = snap.grid || [], puzzle = snap.puzzle || [], cur = snap.cur || [];
      const cr = num(cur[0], -1), cc = num(cur[1], -1);
      const cand = snap.candidates || [];
      const items = [];
      for (let r = 0; r < 9; r++) {
        for (let col = 0; col < 9; col++) {
          const v = num((grid[r] || [])[col], 0);
          const given = num((puzzle[r] || [])[col], 0) > 0;
          const isCur = r === cr && col === cc;
          items.push({
            text: v > 0 ? String(v) : '·',
            sub: isCur && p.showCandidates && cand.length ? cand.join('') : '',
            color: snap.done ? c.success : (isCur ? c.warning : (given ? c.accent : (v > 0 ? c.success : c.border))),
          });
        }
      }
      return (
        <Cells c={c} height={400} items={items} wrap={9} cellW={60} cellH={32} gap={4} x0={30} y0={52}
          title="数独求解 · MRV 与回溯" subtitle={String(snap.done ? `尝试 ${num(snap.attempts)} 次 · 回退 ${num(snap.backtracks)} 次` : `尝试 ${num(snap.attempts)} · 回退 ${num(snap.backtracks)} · 当前 (${cr + 1},${cc + 1})`)} />
      );
    },
  },
};
