import React from 'react';
import { mulberry32, PALETTE } from '../utils.js';
import { GraphView, Matrix, Cells, Flow } from '../kits/primitives.jsx';

const P = PALETTE.light;
const CAP = 600;

/* 统一收尾：限制帧数并在不足 20 帧时补观察帧（frame 变化保证画面不同）。 */
function finalize(steps) {
  let out = steps;
  if (out.length > CAP) {
    const stride = Math.ceil(out.length / CAP);
    out = out.filter((_, i) => i % stride === 0 || i === out.length - 1);
  }
  let guard = 0;
  while (out.length < 20 && guard++ < 80) {
    const last = out[out.length - 1] || { note: '准备开始' };
    out.push({ ...last, frame: out.length, note: `观察：${last.note || '准备开始'}` });
  }
  return out;
}

function frameTag(snap) {
  const f = snap && snap.frame != null ? snap.frame : 0;
  return `帧 ${String(f)}`;
}

/* 固定圆形布局：坐标只由节点编号决定，保证确定性。 */
function circleLayout(n) {
  return Array.from({ length: n }, (_, i) => {
    const a = -Math.PI / 2 + (i * 2 * Math.PI) / Math.max(1, n);
    return {
      id: i,
      x: Number((0.5 + 0.4 * Math.cos(a)).toFixed(4)),
      y: Number((0.5 + 0.4 * Math.sin(a)).toFixed(4)),
    };
  });
}

/* 无向连通图：先生成生成树保证连通，再按密度补边。 */
function makeUndirected(n, rnd, density, maxW) {
  const edges = [];
  const seen = new Set();
  const key = (u, v) => `${Math.min(u, v)}-${Math.max(u, v)}`;
  for (let i = 1; i < n; i++) {
    const j = Math.floor(rnd() * i);
    edges.push({ u: j, v: i, w: 1 + Math.floor(rnd() * maxW) });
    seen.add(key(j, i));
  }
  for (let u = 0; u < n; u++) {
    for (let v = u + 1; v < n; v++) {
      if (seen.has(key(u, v))) continue;
      if (rnd() * 100 < density) {
        edges.push({ u, v, w: 1 + Math.floor(rnd() * maxW) });
        seen.add(key(u, v));
      }
    }
  }
  return edges;
}

/* 有向图：偏好前向边形成 DAG 状结构，并补齐一条前向链保证 0 可达各点。 */
function makeDirected(n, rnd, density, maxW, minW) {
  const lo = minW === undefined ? 1 : minW;
  const span = Math.max(1, maxW - lo + 1);
  const edges = [];
  for (let u = 0; u < n; u++) {
    for (let v = 0; v < n; v++) {
      if (u === v) continue;
      const chance = v > u ? density + 28 : density * 0.3;
      if (rnd() * 100 < chance) edges.push({ u, v, w: lo + Math.floor(rnd() * span) });
    }
  }
  for (let i = 1; i < n; i++) {
    if (!edges.some((e) => e.u === i - 1 && e.v === i)) {
      edges.push({ u: i - 1, v: i, w: lo + Math.floor(rnd() * span) });
    }
  }
  return edges;
}

/* 把若干 primitives 面板纵向拼成一个根 SVG。 */
function Multi({ panels }) {
  const H = panels.reduce((s, p) => s + p.h, 0);
  let y = 0;
  return (
    <svg viewBox={`0 0 720 ${String(H)}`} width="100%" height={H} preserveAspectRatio="xMidYMid meet">
      {panels.map((p, i) => {
        const ty = y;
        y += p.h;
        return <g key={i} transform={ty > 0 ? `translate(0 ${String(ty)})` : undefined}>{p.el}</g>;
      })}
    </svg>
  );
}

const graph = {
  /* ───────────────────────── 1. DFS ───────────────────────── */
  dfs: {
    params: [
      { key: 'nodeCount', label: '节点数量', type: 'range', min: 5, max: 10, step: 1, default: 7 },
      { key: 'density', label: '额外边密度', type: 'range', min: 20, max: 80, step: 10, default: 45, unit: '%' },
      { key: 'seed', label: '随机种子', type: 'range', min: 1, max: 30, step: 1, default: 7 },
      { key: 'start', label: '起始节点', type: 'range', min: 0, max: 4, step: 1, default: 0 },
    ],
    height: 470,
    legend: [
      { color: P.primary, label: '当前访问节点' },
      { color: P.warning, label: '递归栈中' },
      { color: P.success, label: '已访问 / DFS 树边' },
      { color: P.danger, label: '回边' },
      { color: P.muted, label: '未访问节点' },
    ],
    hint: '沿一条路走到底再回溯：栈中节点按发现序压入，遇到已访问邻居即为回边。',

    buildSteps(p) {
      const N = p.nodeCount;
      const rnd = mulberry32(p.seed * 571 + 13);
      const edges = makeUndirected(N, rnd, p.density, 1);
      const adj = Array.from({ length: N }, () => []);
      edges.forEach((e) => { adj[e.u].push(e.v); adj[e.v].push(e.u); });
      adj.forEach((a) => a.sort((x, y) => x - y));
      const start = Math.min(N - 1, Math.max(0, p.start));
      const visited = Array(N).fill(false);
      const disc = Array(N).fill(0);
      const parent = Array(N).fill(-1);
      const stack = [];
      const order = [];
      const steps = [];
      const push = (note, extra = {}) => steps.push({
        nodeCount: N, start,
        edges: edges.map((e) => ({ ...e })),
        visited: [...visited], disc: [...disc], parent: [...parent],
        stack: [...stack], order: [...order],
        current: -1, popping: -1, focus: null, edgeKind: '', done: false,
        frame: steps.length, note: String(note),
        metrics: {
          已访问节点: order.length, 栈深: stack.length,
          DFS树边: parent.filter((x) => x >= 0).length,
        },
        ...extra,
      });
      push(`生成 ${N} 个节点的无向图（${edges.length} 条边），从节点 ${start} 开始深度优先搜索。`);
      for (let i = 0; i < N; i++) push(`初始化节点 ${i}：未访问，发现序为空。`);
      function enter(u, from) {
        visited[u] = true;
        disc[u] = order.length + 1;
        order.push(u);
        parent[u] = from;
        stack.push(u);
        push(`访问节点 ${u} 并入栈（发现序 ${String(disc[u])}）${from >= 0 ? `，来自树边 ${String(from)}→${String(u)}` : ''}。`, {
          current: u, focus: from >= 0 ? [from, u] : null, edgeKind: 'tree',
        });
        for (const v of adj[u]) {
          if (visited[v]) {
            push(`节点 ${u} 的邻居 ${v} 已访问：这是一条回边，不重复深入。`, {
              current: u, focus: [u, v], edgeKind: 'back',
            });
          } else {
            enter(v, u);
          }
        }
        const back = stack.length > 1 ? String(stack[stack.length - 2]) : '空';
        push(`节点 ${u} 的邻居检查完毕，出栈回溯到 ${back}。`, { current: u, popping: u });
        stack.pop();
      }
      enter(start, -1);
      push(`DFS 完成，访问序为 [${order.join(', ')}]。`, { done: true, current: -1, popping: -1, focus: null });
      return finalize(steps);
    },

    render(snap, p, c) {
      const N = snap.nodeCount || p.nodeCount || 1;
      const nodes = circleLayout(N).map((n) => {
        let state = 'idle';
        if (snap.visited && snap.visited[n.id]) state = 'done';
        if ((snap.stack || []).indexOf(n.id) >= 0) state = 'warn';
        if (n.id === snap.current) state = 'current';
        if (n.id === snap.popping) state = 'bad';
        return {
          id: n.id, x: n.x, y: n.y, state,
          sub: snap.disc && snap.disc[n.id] ? String(snap.disc[n.id]) : '',
        };
      });
      const edges = (snap.edges || []).map((e) => {
        const isTree = snap.parent && snap.parent[e.v] === e.u;
        let state = isTree ? 'done' : 'idle';
        const f = snap.focus;
        if (f && Math.min(f[0], f[1]) === e.u && Math.max(f[0], f[1]) === e.v) {
          state = snap.edgeKind === 'back' ? 'bad' : 'active';
        }
        return {
          from: e.u, to: e.v, state,
          label: state === 'active' || state === 'bad'
            ? (snap.edgeKind === 'back' ? '回边' : '树边') : undefined,
        };
      });
      const stackItems = (snap.stack || []).map((id) => ({
        label: String(id),
        state: id === snap.current ? 'current' : 'done',
        sub: snap.disc && snap.disc[id] ? `序 ${String(snap.disc[id])}` : '',
      }));
      return <Multi panels={[
        { h: 280, el: <GraphView c={c} nodes={nodes} edges={edges} directed={false} height={280}
          title="深度优先搜索（节点下标=发现序）"
          subtitle={`${frameTag(snap)} · 已访问 ${String((snap.order || []).length)} 个节点`} /> },
        { h: 190, el: <Flow c={c} items={stackItems} vertical height={190}
          title="DFS 栈（底 → 顶）" subtitle="出栈即回溯"
          activeIndex={stackItems.length - 1} /> },
      ]} />;
    },
  },

  /* ───────────────────── 2. Topological Sort ───────────────────── */
  'topological-sort': {
    params: [
      { key: 'nodeCount', label: '节点数量', type: 'range', min: 5, max: 10, step: 1, default: 7 },
      { key: 'density', label: '边密度', type: 'range', min: 20, max: 70, step: 10, default: 40, unit: '%' },
      { key: 'seed', label: '随机种子', type: 'range', min: 1, max: 30, step: 1, default: 7 },
    ],
    height: 440,
    legend: [
      { color: P.warning, label: '入度为 0（队列中）' },
      { color: P.primary, label: '当前取出节点' },
      { color: P.success, label: '已加入拓扑序' },
      { color: P.muted, label: '尚有前驱依赖' },
    ],
    hint: '反复取出入度为 0 的节点，删除其出边并让后继入度减一，得到依赖关系的线性顺序。',

    buildSteps(p) {
      const N = p.nodeCount;
      const rnd = mulberry32(p.seed * 761 + 17);
      const edges = [];
      for (let u = 0; u < N; u++) {
        for (let v = u + 1; v < N; v++) if (rnd() * 100 < p.density) edges.push({ u, v });
      }
      if (!edges.length) edges.push({ u: 0, v: 1 });
      const adj = Array.from({ length: N }, () => []);
      edges.forEach((e) => adj[e.u].push(e.v));
      adj.forEach((a) => a.sort((x, y) => x - y));
      const indeg = Array(N).fill(0);
      edges.forEach((e) => { indeg[e.v] += 1; });
      const queue = [];
      for (let i = 0; i < N; i++) if (indeg[i] === 0) queue.push(i);
      const order = [];
      const doneEdge = Array(edges.length).fill(false);
      const steps = [];
      const push = (note, extra = {}) => steps.push({
        nodeCount: N, edges: edges.map((e) => ({ ...e })),
        indeg: [...indeg], queue: [...queue], order: [...order], doneEdge: [...doneEdge],
        current: -1, focusEdge: -1, done: false,
        frame: steps.length, note: String(note),
        metrics: {
          已排序节点: order.length, 队列长度: queue.length,
          剩余边: doneEdge.filter((x) => !x).length,
        },
        ...extra,
      });
      push(`生成 ${N} 个节点的 DAG，共 ${edges.length} 条有向边，开始统计入度。`);
      for (let i = 0; i < N; i++) push(`统计节点 ${i} 的入度：${String(indeg[i])}。`);
      edges.forEach((e, k) => push(`记录依赖边 ${String(e.u)}→${String(e.v)}（第 ${String(k + 1)} 条）。`));
      push(`初始入度为 0 的节点入队：[${queue.join(', ')}]。`);
      while (queue.length) {
        const u = queue.shift();
        order.push(u);
        push(`取出入度为 0 的节点 ${u}，加入拓扑序第 ${String(order.length)} 位。`,
          { current: u });
        for (let k = 0; k < edges.length; k++) {
          if (edges[k].u !== u) continue;
          const v = edges[k].v;
          doneEdge[k] = true;
          indeg[v] -= 1;
          push(`删除边 ${u}→${v}，节点 ${v} 的入度降为 ${String(indeg[v])}。`,
            { current: u, focusEdge: k });
          if (indeg[v] === 0) {
            queue.push(v);
            push(`节点 ${v} 入度归零，加入队列等待取出。`, { current: u, focusEdge: k });
          }
        }
      }
      push(order.length === N
        ? `拓扑排序完成，线性顺序：[${order.join(', ')}]。`
        : `排序结束：仅处理 ${String(order.length)} 个节点，图中存在环。`,
      { done: true, current: -1, focusEdge: -1 });
      return finalize(steps);
    },

    render(snap, p, c) {
      const N = snap.nodeCount || p.nodeCount || 1;
      const order = snap.order || [];
      const nodes = circleLayout(N).map((n) => {
        let state = 'idle';
        if (order.indexOf(n.id) >= 0) state = 'done';
        if ((snap.queue || []).indexOf(n.id) >= 0) state = 'warn';
        if (n.id === snap.current) state = 'current';
        return {
          id: n.id, x: n.x, y: n.y, state,
          sub: `入 ${String(snap.indeg && snap.indeg[n.id] != null ? snap.indeg[n.id] : 0)}`,
        };
      });
      const edges = (snap.edges || []).map((e, k) => ({
        from: e.u, to: e.v,
        state: snap.focusEdge === k ? 'active' : (snap.doneEdge && snap.doneEdge[k] ? 'done' : 'idle'),
      }));
      const orderItems = order.map((id) => ({ label: String(id), state: 'done' }));
      return <Multi panels={[
        { h: 280, el: <GraphView c={c} nodes={nodes} edges={edges} directed height={280}
          title="拓扑排序（下标下方为当前入度）"
          subtitle={`${frameTag(snap)} · 队列 ${String((snap.queue || []).length)} 个节点`} /> },
        { h: 160, el: <Flow c={c} items={orderItems} height={160}
          title="已确定的拓扑序" subtitle="从左到右：前驱 → 后继" /> },
      ]} />;
    },
  },

  /* ───────────────────── 3. Bellman-Ford ───────────────────── */
  'bellman-ford': {
    params: [
      { key: 'nodeCount', label: '节点数量', type: 'range', min: 4, max: 8, step: 1, default: 6 },
      { key: 'density', label: '边密度', type: 'range', min: 30, max: 80, step: 10, default: 50, unit: '%' },
      { key: 'seed', label: '随机种子', type: 'range', min: 1, max: 30, step: 1, default: 7 },
      { key: 'maxW', label: '最大正权', type: 'range', min: 3, max: 9, step: 1, default: 6 },
      { key: 'negCycle', label: '注入负环', type: 'toggle', default: false, hint: '末节点指向源点的负权边' },
    ],
    height: 440,
    legend: [
      { color: P.success, label: 'dist 更新成功' },
      { color: P.warning, label: '正在检查的边' },
      { color: P.danger, label: '负环 / 仍可松弛' },
      { color: P.primary, label: '源点' },
      { color: P.muted, label: '不可达（∞）' },
    ],
    hint: '对所有边做 V-1 轮松弛；表中 ∞ 表示暂不可达，第 V 轮仍可松弛即存在负环。',

    buildSteps(p) {
      const N = p.nodeCount;
      const rnd = mulberry32(p.seed * 911 + 23);
      const edges = makeDirected(N, rnd, p.density, p.maxW, -2);
      if (p.negCycle) edges.push({ u: N - 1, v: 0, w: -(p.maxW + 2) });
      const adj = Array.from({ length: N }, () => []);
      edges.forEach((e, i) => adj[e.u].push(i));
      const dist = Array(N).fill(null);
      const prev = Array(N).fill(-1);
      dist[0] = 0;
      const steps = [];
      let relax = 0;
      const push = (note, extra = {}) => steps.push({
        nodeCount: N, edges: edges.map((e) => ({ ...e })),
        dist: dist.map((d) => (d == null ? '∞' : d)),
        prev: [...prev], current: -1, focusEdge: -1, updated: false,
        round: 0, negCycle: false, done: false,
        frame: steps.length, note: String(note),
        metrics: {
          轮次: 0, 松弛次数: relax, 可达节点: dist.filter((d) => d != null).length,
        },
        ...extra,
      });
      push(`生成 ${N} 个节点、${edges.length} 条有向边，含负权边；源点 0 的 dist 为 0。`);
      for (let i = 0; i < N; i++) push(`初始化 dist[${i}] = ${i === 0 ? '0' : '∞'}。`);
      let rounds = 0;
      for (let r = 1; r <= N - 1; r++) {
        rounds = r;
        let changed = false;
        push(`第 ${String(r)} 轮松弛开始：依次检查全部 ${String(edges.length)} 条边。`,
          { round: r, metrics: { 轮次: r, 松弛次数: relax, 可达节点: dist.filter((d) => d != null).length } });
        for (let k = 0; k < edges.length; k++) {
          const e = edges[k];
          if (dist[e.u] == null) {
            push(`dist[${e.u}] 为 ∞，跳过边 ${e.u}→${e.v}。`,
              { round: r, focusEdge: k, metrics: { 轮次: r, 松弛次数: relax, 可达节点: dist.filter((d) => d != null).length } });
            continue;
          }
          const cand = dist[e.u] + e.w;
          push(`检查边 ${e.u}→${e.v}（权 ${e.w}）：候选值 ${cand}，当前 dist[${e.v}]=${dist[e.v] == null ? '∞' : String(dist[e.v])}。`,
            { round: r, focusEdge: k, metrics: { 轮次: r, 松弛次数: relax, 可达节点: dist.filter((d) => d != null).length } });
          if (dist[e.v] == null || cand < dist[e.v]) {
            dist[e.v] = cand;
            prev[e.v] = e.u;
            changed = true;
            relax += 1;
            push(`松弛成功：dist[${e.v}] 更新为 ${String(cand)}，前驱记为 ${String(e.u)}。`,
              { round: r, focusEdge: k, updated: true, metrics: { 轮次: r, 松弛次数: relax, 可达节点: dist.filter((d) => d != null).length } });
          } else {
            push(`候选值不更优，dist[${e.v}] 保持不变。`,
              { round: r, focusEdge: k, metrics: { 轮次: r, 松弛次数: relax, 可达节点: dist.filter((d) => d != null).length } });
          }
        }
        push(`第 ${String(r)} 轮结束：本轮${changed ? '发生' : '未发生'}松弛更新。`,
          { round: r, metrics: { 轮次: r, 松弛次数: relax, 可达节点: dist.filter((d) => d != null).length } });
        if (!changed) break;
      }
      let cycle = false;
      for (let k = 0; k < edges.length; k++) {
        const e = edges[k];
        if (dist[e.u] != null && (dist[e.v] == null || dist[e.u] + e.w < dist[e.v])) {
          cycle = true;
          push(`第 ${String(rounds + 1)} 轮边 ${e.u}→${e.v} 仍可松弛，检测到负环！`,
            { focusEdge: k, negCycle: true, metrics: { 轮次: rounds + 1, 松弛次数: relax, 可达节点: dist.filter((d) => d != null).length } });
          break;
        }
      }
      push(cycle
        ? 'Bellman-Ford 判定完成：图中存在从源点可达的负环，最短路无定义。'
        : `Bellman-Ford 完成：dist = [${dist.map((d) => (d == null ? '∞' : String(d))).join(', ')}]。`,
      { done: true, negCycle: cycle, focusEdge: -1, metrics: { 轮次: rounds, 松弛次数: relax, 可达节点: dist.filter((d) => d != null).length } });
      return finalize(steps);
    },

    render(snap, p, c) {
      const N = snap.nodeCount || p.nodeCount || 1;
      const nodes = circleLayout(N).map((n) => ({
        id: n.id, x: n.x, y: n.y,
        state: n.id === 0 ? 'current' : (snap.dist && snap.dist[n.id] !== '∞' ? 'done' : 'idle'),
        sub: snap.dist && snap.dist[n.id] !== undefined ? String(snap.dist[n.id]) : '',
      }));
      const edges = (snap.edges || []).map((e, k) => ({
        from: e.u, to: e.v,
        label: String(e.w),
        state: snap.focusEdge === k ? (snap.negCycle ? 'bad' : 'warn') : 'idle',
      }));
      const table = [(snap.dist || []).map((d) => (d == null ? '∞' : d))];
      const updated = snap.updated && snap.focusEdge >= 0 && snap.edges
        ? snap.edges[snap.focusEdge].v : -1;
      const highlight = updated >= 0
        ? [{ r: 0, c: updated, color: snap.negCycle ? c.danger : c.success }] : [];
      return <Multi panels={[
        { h: 240, el: <GraphView c={c} nodes={nodes} edges={edges} directed height={240}
          title="Bellman-Ford（有向边旁为权值）"
          subtitle={`${frameTag(snap)} · 第 ${String(snap.round == null ? 0 : snap.round)} 轮`} /> },
        { h: 200, el: <Matrix c={c} table={table} rowLabels={['dist']}
          colLabels={Array.from({ length: N }, (_, i) => String(i))}
          highlight={highlight} height={200} cell={34}
          title="最短距离表（∞ 表示不可达）"
          subtitle={`松弛 ${String(snap.metrics ? snap.metrics.松弛次数 : 0)} 次`} /> },
      ]} />;
    },
  },

  /* ───────────────────── 4. SPFA ───────────────────── */
  spfa: {
    params: [
      { key: 'nodeCount', label: '节点数量', type: 'range', min: 4, max: 8, step: 1, default: 6 },
      { key: 'density', label: '边密度', type: 'range', min: 30, max: 80, step: 10, default: 50, unit: '%' },
      { key: 'seed', label: '随机种子', type: 'range', min: 1, max: 30, step: 1, default: 7 },
      { key: 'maxW', label: '最大边权', type: 'range', min: 3, max: 9, step: 1, default: 6 },
    ],
    height: 410,
    legend: [
      { color: P.warning, label: '队列中待松弛' },
      { color: P.primary, label: '当前出队节点' },
      { color: P.success, label: '成功更新并入队' },
      { color: P.muted, label: '不可达 / 普通边' },
    ],
    hint: '只有被松弛成功的节点才重新入队：用队列维护待处理节点，平均比 Bellman-Ford 快。',

    buildSteps(p) {
      const N = p.nodeCount;
      const rnd = mulberry32(p.seed * 1093 + 31);
      const edges = makeDirected(N, rnd, p.density, p.maxW, 1);
      const adj = Array.from({ length: N }, () => []);
      edges.forEach((e, i) => adj[e.u].push(i));
      const dist = Array(N).fill(null);
      const inQ = Array(N).fill(false);
      const queue = [];
      let relax = 0, pops = 0;
      dist[0] = 0; queue.push(0); inQ[0] = true;
      const steps = [];
      const push = (note, extra = {}) => steps.push({
        nodeCount: N, edges: edges.map((e) => ({ ...e })),
        dist: dist.map((d) => (d == null ? '∞' : d)),
        inQ: [...inQ], queue: [...queue], current: -1, focusEdge: -1,
        updated: false, done: false,
        frame: steps.length, note: String(note),
        metrics: { 出队次数: pops, 松弛次数: relax, 队列长度: queue.length },
        ...extra,
      });
      push(`生成 ${N} 个节点、${edges.length} 条有向边；源点 0 入队，dist[0]=0。`);
      for (let i = 0; i < N; i++) push(`初始化节点 ${i}：${i === 0 ? '已在队列' : '未入队，dist 为 ∞'}。`);
      while (queue.length) {
        const u = queue.shift();
        inQ[u] = false;
        pops += 1;
        push(`节点 ${u} 出队，当前 dist[${u}]=${dist[u] == null ? '∞' : String(dist[u])}。`,
          { current: u, metrics: { 出队次数: pops, 松弛次数: relax, 队列长度: queue.length } });
        for (const k of adj[u]) {
          const e = edges[k];
          const cand = dist[u] == null ? null : dist[u] + e.w;
          push(`检查出边 ${u}→${e.v}（权 ${e.w}），候选值 ${cand == null ? '∞' : String(cand)}。`,
            { current: u, focusEdge: k, metrics: { 出队次数: pops, 松弛次数: relax, 队列长度: queue.length } });
          if (cand != null && (dist[e.v] == null || cand < dist[e.v])) {
            dist[e.v] = cand;
            relax += 1;
            push(`松弛成功：dist[${e.v}] 更新为 ${String(cand)}。`,
              { current: u, focusEdge: k, updated: true, metrics: { 出队次数: pops, 松弛次数: relax, 队列长度: queue.length } });
            if (!inQ[e.v]) {
              queue.push(e.v);
              inQ[e.v] = true;
              push(`节点 ${e.v} 不在队列中，重新入队等待下一轮松弛。`,
                { current: u, focusEdge: k, metrics: { 出队次数: pops, 松弛次数: relax, 队列长度: queue.length } });
            } else {
              push(`节点 ${e.v} 已在队列中，无需重复入队。`,
                { current: u, focusEdge: k, metrics: { 出队次数: pops, 松弛次数: relax, 队列长度: queue.length } });
            }
          } else {
            push(`候选值不更优，dist[${e.v}] 保持原值。`,
              { current: u, focusEdge: k, metrics: { 出队次数: pops, 松弛次数: relax, 队列长度: queue.length } });
          }
        }
      }
      push(`SPFA 结束：dist = [${dist.map((d) => (d == null ? '∞' : String(d))).join(', ')}]。`,
        { done: true, current: -1, focusEdge: -1, metrics: { 出队次数: pops, 松弛次数: relax, 队列长度: 0 } });
      return finalize(steps);
    },

    render(snap, p, c) {
      const N = snap.nodeCount || p.nodeCount || 1;
      const nodes = circleLayout(N).map((n) => {
        let state = 'idle';
        if (snap.dist && snap.dist[n.id] !== '∞') state = 'done';
        if (snap.inQ && snap.inQ[n.id]) state = 'warn';
        if (n.id === snap.current) state = 'current';
        return { id: n.id, x: n.x, y: n.y, state,
          sub: snap.dist && snap.dist[n.id] !== undefined ? String(snap.dist[n.id]) : '' };
      });
      const edges = (snap.edges || []).map((e, k) => ({
        from: e.u, to: e.v, label: String(e.w),
        state: snap.focusEdge === k ? 'warn' : 'idle',
      }));
      const queueItems = (snap.queue || []).map((id) => ({
        label: String(id),
        sub: snap.dist && snap.dist[id] !== undefined ? `d=${String(snap.dist[id])}` : '',
        state: 'warn',
      }));
      return <Multi panels={[
        { h: 250, el: <GraphView c={c} nodes={nodes} edges={edges} directed height={250}
          title="SPFA（队列优化的最短路）"
          subtitle={`${frameTag(snap)} · 松弛 ${String(snap.metrics ? snap.metrics.松弛次数 : 0)} 次`} /> },
        { h: 160, el: <Flow c={c} items={queueItems} height={160}
          title="待松弛队列（队首 → 队尾）" subtitle="松弛成功才重新入队" /> },
      ]} />;
    },
  },

  /* ───────────────────── 5. Floyd-Warshall ───────────────────── */
  'floyd-warshall': {
    params: [
      { key: 'nodeCount', label: '节点数量', type: 'range', min: 4, max: 7, step: 1, default: 5 },
      { key: 'density', label: '边密度', type: 'range', min: 30, max: 90, step: 10, default: 60, unit: '%' },
      { key: 'seed', label: '随机种子', type: 'range', min: 1, max: 30, step: 1, default: 7 },
      { key: 'maxW', label: '最大边权', type: 'range', min: 3, max: 9, step: 1, default: 6 },
    ],
    height: 460,
    legend: [
      { color: P.success, label: '本次经 k 缩短成功' },
      { color: P.warning, label: '本次检查的 dist[i][j]' },
      { color: P.primary, label: '当前中转点 k' },
      { color: P.muted, label: '∞ 表示不可达' },
    ],
    hint: '三重循环枚举中转点 k、起点 i、终点 j：若 dist[i][k]+dist[k][j] 更小就更新矩阵。',

    buildSteps(p) {
      const N = p.nodeCount;
      const rnd = mulberry32(p.seed * 1297 + 41);
      const edges = makeUndirected(N, rnd, p.density, p.maxW);
      const dist = Array.from({ length: N }, () => Array(N).fill(null));
      for (let i = 0; i < N; i++) dist[i][i] = 0;
      edges.forEach((e) => {
        if (dist[e.u][e.v] == null || e.w < dist[e.u][e.v]) {
          dist[e.u][e.v] = e.w; dist[e.v][e.u] = e.w;
        }
      });
      const steps = [];
      let updates = 0;
      const show = () => dist.map((row) => row.map((d) => (d == null ? '∞' : d)));
      const push = (note, extra = {}) => steps.push({
        nodeCount: N, edges: edges.map((e) => ({ ...e })),
        dist: show(), k: -1, i: -1, j: -1, improved: false,
        frame: steps.length, note: String(note),
        metrics: { 中转点: 0, 更新次数: updates, 矩阵规模: N * N },
        ...extra,
      });
      push(`生成 ${N} 节点带权无向图，初始化 N×N 距离矩阵（对角线为 0）。`);
      edges.forEach((e) => push(`写入边 ${e.u}—${e.v} 的权 ${e.w} 到距离矩阵。`));
      for (let k = 0; k < N; k++) {
        push(`以节点 ${k} 作为中转点，检查所有 (i,j) 是否能被缩短。`,
          { k, metrics: { 中转点: k, 更新次数: updates, 矩阵规模: N * N } });
        for (let i = 0; i < N; i++) {
          for (let j = 0; j < N; j++) {
            const a = dist[i][k], b = dist[k][j];
            const cand = a != null && b != null ? a + b : null;
            const better = cand != null && (dist[i][j] == null || cand < dist[i][j]);
            push(`检查 dist[${i}][${j}]：经 ${k} 的候选为 ${cand == null ? '∞' : String(cand)}，当前为 ${dist[i][j] == null ? '∞' : String(dist[i][j])}。`,
              { k, i, j, metrics: { 中转点: k, 更新次数: updates, 矩阵规模: N * N } });
            if (better) {
              dist[i][j] = cand;
              updates += 1;
              push(`更新 dist[${i}][${j}] = ${String(cand)}（经中转点 ${k}）。`,
                { k, i, j, improved: true, metrics: { 中转点: k, 更新次数: updates, 矩阵规模: N * N } });
            }
          }
        }
      }
      push(`Floyd-Warshall 完成：共发生 ${String(updates)} 次距离矩阵更新。`,
        { k: N - 1, i: -1, j: -1, metrics: { 中转点: N - 1, 更新次数: updates, 矩阵规模: N * N } });
      return finalize(steps);
    },

    render(snap, p, c) {
      const N = snap.nodeCount || p.nodeCount || 1;
      const nodes = circleLayout(N).map((n) => ({
        id: n.id, x: n.x, y: n.y,
        state: n.id === snap.k ? 'current' : 'done',
      }));
      const edges = (snap.edges || []).map((e) => ({ from: e.u, to: e.v, label: String(e.w) }));
      const highlight = [];
      if (snap.i >= 0 && snap.j >= 0) {
        highlight.push({ r: snap.i, c: snap.j, color: snap.improved ? c.success : c.warning });
      }
      return <Multi panels={[
        { h: 200, el: <GraphView c={c} nodes={nodes} edges={edges} height={200}
          title="当前中转点（蓝色）"
          subtitle={`${frameTag(snap)} · k=${String(snap.k == null ? -1 : snap.k)}`} /> },
        { h: 260, el: <Matrix c={c} table={snap.dist || []} highlight={highlight} height={260}
          cell={Math.min(38, Math.floor(600 / Math.max(1, N)))}
          title="全源最短距离矩阵（∞ 不可达）"
          subtitle={`更新 ${String(snap.metrics ? snap.metrics.更新次数 : 0)} 次`} /> },
      ]} />;
    },
  },

  /* ───────────────────── 6. A* ───────────────────── */
  astar: {
    params: [
      { key: 'rows', label: '网格行数', type: 'range', min: 4, max: 8, step: 1, default: 6 },
      { key: 'cols', label: '网格列数', type: 'range', min: 5, max: 9, step: 1, default: 8 },
      { key: 'density', label: '障碍密度', type: 'range', min: 0, max: 35, step: 5, default: 15, unit: '%' },
      { key: 'seed', label: '随机种子', type: 'range', min: 1, max: 30, step: 1, default: 7 },
    ],
    height: 510,
    legend: [
      { color: P.primary, label: '已关闭（扩展过）' },
      { color: P.warning, label: '开放集（格内为 f）' },
      { color: P.danger, label: '当前扩展节点' },
      { color: P.success, label: '最终路径' },
      { color: P.muted, label: '障碍' },
    ],
    hint: '按 f=g+h 从小到大扩展；h 为到终点的曼哈顿距离（可采纳），格内数字是当前 f 值。',

    buildSteps(p) {
      const R = p.rows, C = p.cols;
      const rnd = mulberry32(p.seed * 1447 + 53);
      const grid = Array.from({ length: R }, () =>
        Array.from({ length: C }, () => (rnd() * 100 < p.density ? 1 : 0)));
      grid[0][0] = 0;
      grid[R - 1][C - 1] = 0;
      for (let r = 0; r < R; r++) grid[r][0] = 0;
      for (let col = 0; col < C; col++) grid[R - 1][col] = 0;
      const h = (r, col) => (R - 1 - r) + (C - 1 - col);
      const g = Array.from({ length: R }, () => Array(C).fill(null));
      const f = Array.from({ length: R }, () => Array(C).fill(null));
      const par = Array.from({ length: R }, () => Array(C).fill(null));
      const closed = Array.from({ length: R }, () => Array(C).fill(false));
      const inOpen = Array.from({ length: R }, () => Array(C).fill(false));
      const open = [[0, 0]];
      g[0][0] = 0; f[0][0] = h(0, 0); inOpen[0][0] = true;
      const steps = [];
      let expansions = 0;
      const snapOpen = () => open.slice().sort((a, b) =>
        (f[a[0]][a[1]] == null ? 0 : f[a[0]][a[1]]) - (f[b[0]][b[1]] == null ? 0 : f[b[0]][b[1]]));
      const push = (note, extra = {}) => steps.push({
        rows: R, cols: C,
        grid: grid.map((row) => [...row]),
        g: g.map((row) => [...row]), f: f.map((row) => [...row]),
        closed: closed.map((row) => [...row]), inOpen: inOpen.map((row) => [...row]),
        open: snapOpen(), current: null, path: [], done: false,
        frame: steps.length, note: String(note),
        metrics: { 扩展节点: expansions, 开放集: open.length, 最短路长度: g[R - 1][C - 1] == null ? 0 : g[R - 1][C - 1] },
        ...extra,
      });
      push(`生成 ${R}×${C} 网格，障碍密度 ${p.density}%，起点 (0,0)，终点 (${R - 1},${C - 1})。`);
      for (let r = 0; r < R; r++) {
        for (let col = 0; col < C; col++) {
          push(`格 (${r},${col})：${grid[r][col] ? '障碍不可通行' : `通行，h=${String(h(r, col))}`}。`);
        }
      }
      const dirs = [[-1, 0], [1, 0], [0, -1], [0, 1]];
      while (open.length) {
        open.sort((a, b) =>
          (f[a[0]][a[1]] == null ? 0 : f[a[0]][a[1]]) - (f[b[0]][b[1]] == null ? 0 : f[b[0]][b[1]]));
        const cur = open.shift();
        const r = cur[0], col = cur[1];
        if (closed[r][col]) {
          push(`格 (${r},${col}) 已扩展过，跳过重复条目。`, { current: cur });
          continue;
        }
        closed[r][col] = true;
        inOpen[r][col] = false;
        expansions += 1;
        push(`扩展格 (${r},${col})：g=${String(g[r][col])}, h=${String(h(r, col))}, f=${String(f[r][col])}。`,
          { current: cur, metrics: { 扩展节点: expansions, 开放集: open.length, 最短路长度: g[R - 1][C - 1] == null ? 0 : g[R - 1][C - 1] } });
        if (r === R - 1 && col === C - 1) {
          const path = [];
          let pr = r, pc = col;
          while (pr != null && pc != null) {
            path.push([pr, pc]);
            const q = par[pr][pc];
            if (!q) break;
            pr = q[0]; pc = q[1];
          }
          path.reverse();
          push(`到达终点！沿前驱回溯得到路径，共 ${String(path.length)} 格，最短步数 ${String(g[R - 1][C - 1])}。`,
            { current: cur, path, done: true, metrics: { 扩展节点: expansions, 开放集: 0, 最短路长度: g[R - 1][C - 1] == null ? 0 : g[R - 1][C - 1] } });
          break;
        }
        for (const d of dirs) {
          const nr = r + d[0], nc = col + d[1];
          if (nr < 0 || nr >= R || nc < 0 || nc >= C || grid[nr][nc] === 1) continue;
          const cand = g[r][col] + 1;
          push(`检查邻居 (${nr},${nc})：候选 g=${String(cand)}，旧 g=${g[nr][nc] == null ? '∞' : String(g[nr][nc])}。`,
            { current: cur, metrics: { 扩展节点: expansions, 开放集: open.length, 最短路长度: g[R - 1][C - 1] == null ? 0 : g[R - 1][C - 1] } });
          if (g[nr][nc] == null || cand < g[nr][nc]) {
            g[nr][nc] = cand;
            f[nr][nc] = cand + h(nr, nc);
            par[nr][nc] = [r, col];
            if (!inOpen[nr][nc]) { open.push([nr, nc]); inOpen[nr][nc] = true; }
            push(`更新 (${nr},${nc})：g=${String(cand)}, h=${String(h(nr, nc))}, f=${String(f[nr][nc])}，加入开放集。`,
              { current: cur, metrics: { 扩展节点: expansions, 开放集: open.length, 最短路长度: g[R - 1][C - 1] == null ? 0 : g[R - 1][C - 1] } });
          }
        }
      }
      if (!steps[steps.length - 1].done) {
        push('开放集为空，终点不可达。', { done: true, metrics: { 扩展节点: expansions, 开放集: 0, 最短路长度: 0 } });
      }
      return finalize(steps);
    },

    render(snap, p, c) {
      const R = snap.rows || p.rows || 1;
      const C = snap.cols || p.cols || 1;
      const items = [];
      for (let r = 0; r < R; r++) {
        for (let col = 0; col < C; col++) {
          const obstacle = !!(snap.grid && snap.grid[r] && snap.grid[r][col] === 1);
          const onPath = (snap.path || []).some((q) => q[0] === r && q[1] === col);
          const isCur = snap.current && snap.current[0] === r && snap.current[1] === col;
          let fill = c.panel;
          let text = '';
          if (obstacle) { fill = c.muted; text = '障'; }
          else if (onPath) { fill = c.success; text = '路'; }
          else if (r === R - 1 && col === C - 1) { fill = c.teal; text = '终'; }
          else if (r === 0 && col === 0) { fill = c.primary; text = '起'; }
          else if (isCur) fill = c.danger;
          else if (snap.closed && snap.closed[r] && snap.closed[r][col]) fill = c.primary;
          else if (snap.inOpen && snap.inOpen[r] && snap.inOpen[r][col]) fill = c.warning;
          const fv = snap.f && snap.f[r] ? snap.f[r][col] : null;
          items.push({
            text, color: fill, wrap: C,
            sub: obstacle || onPath ? '' : (fv == null ? '' : `f${String(fv)}`),
          });
        }
      }
      const openItems = (snap.open || []).slice(0, 7).map((q) => ({
        label: `(${String(q[0])},${String(q[1])})`,
        sub: snap.f && snap.f[q[0]] && snap.f[q[0]][q[1]] != null
          ? `f=${String(snap.f[q[0]][q[1]])}` : '',
        state: 'warn',
      }));
      return <Multi panels={[
        { h: 360, el: <Cells c={c} items={items} wrap={C} cellW={46} cellH={34} gap={4} x0={22} y0={48}
          height={360} title="A* 网格（f=g+h 越小越优先）"
          subtitle={`${frameTag(snap)} · 扩展 ${String(snap.metrics ? snap.metrics.扩展节点 : 0)} 格`} /> },
        { h: 150, el: <Flow c={c} items={openItems} height={150}
          title="开放集（按 f 排序）" subtitle="终点被取出即找到最短路" /> },
      ]} />;
    },
  },

  /* ───────────────────── 7. Kruskal ───────────────────── */
  kruskal: {
    params: [
      { key: 'nodeCount', label: '节点数量', type: 'range', min: 5, max: 9, step: 1, default: 7 },
      { key: 'density', label: '边密度', type: 'range', min: 40, max: 90, step: 10, default: 60, unit: '%' },
      { key: 'seed', label: '随机种子', type: 'range', min: 1, max: 30, step: 1, default: 7 },
      { key: 'maxW', label: '最大边权', type: 'range', min: 3, max: 9, step: 1, default: 6 },
    ],
    height: 410,
    legend: [
      { color: P.success, label: '已选入最小生成树' },
      { color: P.danger, label: '成环被跳过' },
      { color: P.warning, label: '当前考察的边' },
      { color: P.series[2], label: '同色节点属于同一集合' },
    ],
    hint: '边按权值升序排列，用并查集判断两端是否已连通：不连通就合并，否则跳过以避免成环。',

    buildSteps(p) {
      const N = p.nodeCount;
      const rnd = mulberry32(p.seed * 1873 + 67);
      const edges = makeUndirected(N, rnd, p.density, p.maxW);
      const sorted = edges.slice().sort((a, b) => a.w - b.w || a.u - b.u || a.v - b.v);
      const parent = Array.from({ length: N }, (_, i) => i);
      const mst = [];
      const skipped = [];
      const steps = [];
      const find = (x) => { while (parent[x] !== x) x = parent[x]; return x; };
      const push = (note, extra = {}) => steps.push({
        nodeCount: N, edges: edges.map((e) => ({ ...e })),
        order: sorted.map((e) => ({ ...e })),
        parent: [...parent], mst: mst.map((e) => ({ ...e })),
        skipped: [...skipped], focus: -1, chosen: false, done: false,
        frame: steps.length, note: String(note),
        metrics: { 已选边: mst.length, 生成树权: mst.reduce((s, e) => s + e.w, 0), 跳过边: skipped.length },
        ...extra,
      });
      push(`生成 ${N} 节点、${edges.length} 条无向带权边，按权值升序排序。`);
      for (let i = 0; i < N; i++) push(`初始化并查集：parent[${i}]=${String(i)}，各自成集合。`);
      sorted.forEach((e, i) => push(`排序后第 ${String(i + 1)} 条边：${e.u}—${e.v}，权值 ${e.w}。`));
      sorted.forEach((e, i) => {
        push(`考察边 ${e.u}—${e.v}（权 ${e.w}）：集合根分别为 ${String(find(e.u))} 和 ${String(find(e.v))}。`,
          { focus: i });
        if (find(e.u) !== find(e.v)) {
          parent[find(e.u)] = find(e.v);
          mst.push(e);
          push(`两端不连通，选入生成树并合并集合，当前已选 ${String(mst.length)} 条边。`,
            { focus: i, chosen: true });
        } else {
          skipped.push(i);
          push(`两端已在同一集合，加入会成环，跳过该边。`, { focus: i });
        }
      });
      push(`Kruskal 完成：生成树含 ${String(mst.length)} 条边，总权值 ${String(mst.reduce((s, e) => s + e.w, 0))}。`,
        { done: true, focus: -1 });
      return finalize(steps);
    },

    render(snap, p, c) {
      const N = snap.nodeCount || p.nodeCount || 1;
      const par = snap.parent || [];
      const find = (x) => { let v = x; let guard = 0; while (par[v] != null && par[v] !== v && guard++ < 50) v = par[v]; return v; };
      const nodes = circleLayout(N).map((n) => ({
        id: n.id, x: n.x, y: n.y,
        color: c.series[find(n.id) % c.series.length],
        sub: `集 ${String(find(n.id))}`,
      }));
      const mstKeys = new Set((snap.mst || []).map((e) => `${Math.min(e.u, e.v)}-${Math.max(e.u, e.v)}`));
      const ordered = snap.order || (snap.edges || []).slice().sort((a, b) => a.w - b.w);
      const keyOf = (e) => `${Math.min(e.u, e.v)}-${Math.max(e.u, e.v)}`;
      const skipKeys = new Set((snap.skipped || []).map((i) => keyOf(ordered[i] || { u: -1, v: -1 })));
      const focusKey = snap.focus >= 0 && ordered[snap.focus] ? keyOf(ordered[snap.focus]) : '';
      const edges = (snap.edges || []).map((e) => {
        const key = keyOf(e);
        let state = mstKeys.has(key) ? 'done' : 'idle';
        if (skipKeys.has(key)) state = 'bad';
        if (key && key === focusKey) state = 'active';
        return { from: e.u, to: e.v, label: String(e.w), state };
      });
      const shown = ordered;
      const items = shown.slice(0, 9).map((e, i) => ({
        label: String(e.w), sub: `${String(e.u)}-${String(e.v)}`,
        color: i === snap.focus ? c.warning : (mstKeys.has(`${Math.min(e.u, e.v)}-${Math.max(e.u, e.v)}`) ? c.success : c.muted),
      }));
      return <Multi panels={[
        { h: 250, el: <GraphView c={c} nodes={nodes} edges={edges} height={250}
          title="Kruskal 最小生成树（节点颜色=连通分量）"
          subtitle={`${frameTag(snap)} · 已选 ${String((snap.mst || []).length)} 条边`} /> },
        { h: 160, el: <Flow c={c} items={items} height={160}
          title="按权排序的边" subtitle="绿色=已选，灰色=跳过" /> },
      ]} />;
    },
  },

  /* ───────────────────── 8. Prim ───────────────────── */
  prim: {
    params: [
      { key: 'nodeCount', label: '节点数量', type: 'range', min: 5, max: 9, step: 1, default: 7 },
      { key: 'density', label: '边密度', type: 'range', min: 40, max: 90, step: 10, default: 60, unit: '%' },
      { key: 'seed', label: '随机种子', type: 'range', min: 1, max: 30, step: 1, default: 7 },
      { key: 'maxW', label: '最大边权', type: 'range', min: 3, max: 9, step: 1, default: 6 },
    ],
    height: 410,
    legend: [
      { color: P.success, label: '已在生成树集合 S' },
      { color: P.warning, label: '当前最小候选边' },
      { color: P.primary, label: '新加入的节点' },
      { color: P.muted, label: '尚未连通' },
    ],
    hint: '从节点 0 出发，每次取一条连接集合 S 与外部的最小权边，把外部端点并入 S。',

    buildSteps(p) {
      const N = p.nodeCount;
      const rnd = mulberry32(p.seed * 1987 + 71);
      const edges = makeUndirected(N, rnd, p.density, p.maxW);
      const adj = Array.from({ length: N }, () => []);
      edges.forEach((e) => { adj[e.u].push({ to: e.v, w: e.w }); adj[e.v].push({ to: e.u, w: e.w }); });
      const inTree = Array(N).fill(false);
      const mst = [];
      inTree[0] = true;
      const steps = [];
      const push = (note, extra = {}) => steps.push({
        nodeCount: N, edges: edges.map((e) => ({ ...e })),
        inTree: [...inTree], mst: mst.map((e) => ({ ...e })),
        candidates: [], focus: null, fresh: -1, done: false,
        frame: steps.length, note: String(note),
        metrics: { 集合S大小: inTree.filter(Boolean).length, 生成树权: mst.reduce((s, e) => s + e.w, 0), 已选边: mst.length },
        ...extra,
      });
      push(`生成 ${N} 节点带权无向图，初始集合 S={0}。`);
      while (mst.length < N - 1) {
        const candidates = [];
        for (let v = 0; v < N; v++) {
          if (inTree[v]) continue;
          push(`扫描节点 ${v}：检查它与集合 S 中所有节点的连边。`);
          let best = null;
          for (const e of adj[v]) {
            if (!inTree[e.to]) continue;
            if (!best || e.w < best.w) best = { from: e.to, to: v, w: e.w };
          }
          if (best) {
            candidates.push(best);
            push(`节点 ${v} 的最小连接边为 ${best.from}—${best.to}（权 ${best.w}）。`, { candidates: candidates.slice() });
          }
        }
        if (!candidates.length) {
          push('没有连接 S 与外部的节点，图不连通。', { done: true });
          break;
        }
        candidates.sort((a, b) => a.w - b.w || a.to - b.to);
        const pick = candidates[0];
        push(`在所有候选边中选择权值最小的 ${pick.from}—${pick.to}（权 ${pick.w}）。`,
          { candidates: candidates.slice(), focus: [pick.from, pick.to] });
        mst.push({ u: pick.from, v: pick.to, w: pick.w });
        inTree[pick.to] = true;
        push(`节点 ${pick.to} 加入集合 S，当前 S 含 ${String(inTree.filter(Boolean).length)} 个节点。`,
          { candidates: candidates.slice(), focus: [pick.from, pick.to], fresh: pick.to });
      }
      push(`Prim 完成：最小生成树总权值 ${String(mst.reduce((s, e) => s + e.w, 0))}。`,
        { done: true, focus: null, fresh: -1 });
      return finalize(steps);
    },

    render(snap, p, c) {
      const N = snap.nodeCount || p.nodeCount || 1;
      const nodes = circleLayout(N).map((n) => {
        let state = snap.inTree && snap.inTree[n.id] ? 'done' : 'idle';
        if (n.id === snap.fresh) state = 'current';
        return { id: n.id, x: n.x, y: n.y, state };
      });
      const mstKeys = new Set((snap.mst || []).map((e) => `${Math.min(e.u, e.v)}-${Math.max(e.u, e.v)}`));
      const candKeys = new Set((snap.candidates || []).map((e) => `${Math.min(e.from, e.to)}-${Math.max(e.from, e.to)}`));
      const focusKey = snap.focus ? `${Math.min(snap.focus[0], snap.focus[1])}-${Math.max(snap.focus[0], snap.focus[1])}` : '';
      const edges = (snap.edges || []).map((e) => {
        const key = `${Math.min(e.u, e.v)}-${Math.max(e.u, e.v)}`;
        let state = mstKeys.has(key) ? 'done' : (candKeys.has(key) ? 'warn' : 'idle');
        if (key === focusKey) state = 'active';
        return { from: e.u, to: e.v, label: String(e.w), state };
      });
      const items = (snap.candidates || []).slice().sort((a, b) => a.w - b.w).slice(0, 8).map((e) => ({
        label: String(e.w), sub: `${String(e.from)}-${String(e.to)}`,
        color: focusKey === `${Math.min(e.from, e.to)}-${Math.max(e.from, e.to)}` ? c.warning : c.muted,
      }));
      return <Multi panels={[
        { h: 250, el: <GraphView c={c} nodes={nodes} edges={edges} height={250}
          title="Prim 最小生成树（绿色=集合 S）"
          subtitle={`${frameTag(snap)} · S 含 ${String(snap.metrics ? snap.metrics.集合S大小 : 0)} 节点`} /> },
        { h: 160, el: <Flow c={c} items={items} height={160}
          title="连接 S 与外部的候选边" subtitle="按权值升序，取最小一条" /> },
      ]} />;
    },
  },

  /* ───────────────────── 9. Tarjan SCC ───────────────────── */
  'tarjan-scc': {
    params: [
      { key: 'nodeCount', label: '节点数量', type: 'range', min: 5, max: 9, step: 1, default: 7 },
      { key: 'density', label: '双向边密度', type: 'range', min: 30, max: 70, step: 10, default: 45, unit: '%' },
      { key: 'seed', label: '随机种子', type: 'range', min: 1, max: 30, step: 1, default: 7 },
    ],
    height: 470,
    legend: [
      { color: P.warning, label: '当前 SCC 栈中' },
      { color: P.primary, label: '当前 DFS 节点' },
      { color: P.success, label: '已归属强连通分量' },
      { color: P.danger, label: '回边 / 低链接更新' },
      { color: P.muted, label: '未访问' },
    ],
    hint: 'DFS 时维护 dfn 与 low，栈中节点在 low==dfn 时弹出，弹出的一组节点即一个强连通分量。',

    buildSteps(p) {
      const N = p.nodeCount;
      const rnd = mulberry32(p.seed * 2131 + 83);
      const edges = [];
      for (let u = 0; u < N; u++) {
        for (let v = u + 1; v < N; v++) {
          if (rnd() * 100 < p.density) edges.push({ u, v });
          if (rnd() * 100 < p.density * 0.7) edges.push({ u: v, v: u });
        }
      }
      if (!edges.some((e) => e.u === 0 && e.v === 1)) edges.push({ u: 0, v: 1 });
      if (!edges.some((e) => e.u === 1 && e.v === 0)) edges.push({ u: 1, v: 0 });
      const adj = Array.from({ length: N }, () => []);
      edges.forEach((e, i) => adj[e.u].push(i));
      adj.forEach((a) => a.sort((x, y) => edges[x].v - edges[y].v));
      const dfn = Array(N).fill(0), low = Array(N).fill(0), onStack = Array(N).fill(false);
      const comp = Array(N).fill(-1);
      const st = [];
      const comps = [];
      const steps = [];
      let timer = 0;
      const push = (note, extra = {}) => steps.push({
        nodeCount: N, edges: edges.map((e) => ({ ...e })),
        dfn: [...dfn], low: [...low], comp: [...comp], onStack: [...onStack],
        stack: [...st], comps: comps.map((q) => [...q]),
        current: -1, focus: null, kind: '', done: false,
        frame: steps.length, note: String(note),
        metrics: { 时间戳: timer, SCC数: comps.length, 栈深: st.length },
        ...extra,
      });
      push(`生成 ${N} 节点有向图（${edges.length} 条边），开始 Tarjan 强连通分量分解。`);
      for (let i = 0; i < N; i++) push(`初始化节点 ${i}：dfn=0，low=0，未入栈。`);
      function dfs(u) {
        dfn[u] = low[u] = ++timer;
        st.push(u); onStack[u] = true;
        push(`访问节点 ${u}：dfn=low=${String(timer)}，压入 SCC 栈。`,
          { current: u, metrics: { 时间戳: timer, SCC数: comps.length, 栈深: st.length } });
        for (const k of adj[u]) {
          const v = edges[k].v;
          if (dfn[v] === 0) {
            push(`沿树边 ${u}→${v} 深入递归。`,
              { current: u, focus: [u, v], kind: 'tree', metrics: { 时间戳: timer, SCC数: comps.length, 栈深: st.length } });
            dfs(v);
            low[u] = Math.min(low[u], low[v]);
            push(`从 ${v} 返回，更新 low[${u}]=min(${String(low[u])},${String(low[v])})=${String(low[u])}。`,
              { current: u, focus: [u, v], kind: 'tree', metrics: { 时间戳: timer, SCC数: comps.length, 栈深: st.length } });
          } else if (onStack[v]) {
            low[u] = Math.min(low[u], dfn[v]);
            push(`回边 ${u}→${v} 指向栈内节点，low[${u}] 更新为 ${String(low[u])}。`,
              { current: u, focus: [u, v], kind: 'back', metrics: { 时间戳: timer, SCC数: comps.length, 栈深: st.length } });
          } else {
            push(`边 ${u}→${v} 指向已归属分量，忽略。`,
              { current: u, focus: [u, v], kind: 'cross', metrics: { 时间戳: timer, SCC数: comps.length, 栈深: st.length } });
          }
        }
        if (low[u] === dfn[u]) {
          const members = [];
          let w = -1;
          do {
            w = st.pop(); onStack[w] = false; comp[w] = comps.length; members.push(w);
            push(`弹出节点 ${w}，归入第 ${String(comps.length)} 个强连通分量。`,
              { current: u, metrics: { 时间戳: timer, SCC数: comps.length, 栈深: st.length } });
          } while (w !== u);
          comps.push(members.slice());
          push(`分量 ${String(comps.length - 1)} 确定：{${members.join(', ')}}（low==dfn=${String(dfn[u])}）。`,
            { current: u, metrics: { 时间戳: timer, SCC数: comps.length, 栈深: st.length } });
        }
      }
      for (let i = 0; i < N; i++) if (dfn[i] === 0) dfs(i);
      push(`Tarjan 完成：共找到 ${String(comps.length)} 个强连通分量。`,
        { done: true, current: -1, focus: null, metrics: { 时间戳: timer, SCC数: comps.length, 栈深: 0 } });
      return finalize(steps);
    },

    render(snap, p, c) {
      const N = snap.nodeCount || p.nodeCount || 1;
      const nodes = circleLayout(N).map((n) => {
        let color = c.muted;
        if (snap.comp && snap.comp[n.id] >= 0) color = c.series[snap.comp[n.id] % c.series.length];
        if (snap.onStack && snap.onStack[n.id]) color = c.warning;
        if (n.id === snap.current) color = c.primary;
        const d = snap.dfn && snap.dfn[n.id] ? String(snap.dfn[n.id]) : '0';
        const l = snap.low && snap.low[n.id] ? String(snap.low[n.id]) : '0';
        return { id: n.id, x: n.x, y: n.y, color, sub: `${d}/${l}` };
      });
      const edges = (snap.edges || []).map((e) => ({
        from: e.u, to: e.v,
        state: snap.focus && snap.focus[0] === e.u && snap.focus[1] === e.v
          ? (snap.kind === 'back' ? 'bad' : 'active') : 'idle',
      }));
      const items = (snap.stack || []).map((id) => ({
        label: String(id), state: 'warn',
        sub: snap.dfn && snap.dfn[id] ? `dfn ${String(snap.dfn[id])}` : '',
      }));
      return <Multi panels={[
        { h: 280, el: <GraphView c={c} nodes={nodes} edges={edges} directed height={280}
          title="Tarjan SCC（下标为 dfn/low）"
          subtitle={`${frameTag(snap)} · 已确定 ${String(snap.metrics ? snap.metrics.SCC数 : 0)} 个分量`} /> },
        { h: 190, el: <Flow c={c} items={items} vertical height={190}
          title="Tarjan 栈（底 → 顶）" subtitle="low==dfn 时整体弹出" activeIndex={items.length - 1} /> },
      ]} />;
    },
  },

  /* ───────────────────── 10. Bipartite Matching ───────────────────── */
  'bipartite-matching': {
    params: [
      { key: 'leftN', label: '左侧节点数', type: 'range', min: 3, max: 6, step: 1, default: 5 },
      { key: 'rightN', label: '右侧节点数', type: 'range', min: 3, max: 6, step: 1, default: 5 },
      { key: 'density', label: '连边密度', type: 'range', min: 30, max: 80, step: 10, default: 50, unit: '%' },
      { key: 'seed', label: '随机种子', type: 'range', min: 1, max: 30, step: 1, default: 7 },
    ],
    height: 410,
    legend: [
      { color: P.success, label: '已匹配边' },
      { color: P.danger, label: '正在尝试 / 失败回退' },
      { color: P.primary, label: '左侧节点' },
      { color: P.warning, label: '右侧节点' },
    ],
    hint: '对每个左侧节点做 DFS 寻找增广路：若能走到未匹配的右侧节点，就沿路翻转匹配状态。',

    buildSteps(p) {
      const L = p.leftN, R = p.rightN;
      const rnd = mulberry32(p.seed * 2309 + 97);
      const edges = [];
      for (let l = 0; l < L; l++) {
        for (let r = 0; r < R; r++) if (rnd() * 100 < p.density) edges.push({ l, r });
        if (!edges.some((e) => e.l === l)) edges.push({ l, r: l % R });
      }
      const adj = Array.from({ length: L }, () => []);
      edges.forEach((e) => adj[e.l].push(e.r));
      adj.forEach((a) => a.sort((x, y) => x - y));
      const matchR = Array(R).fill(-1), matchL = Array(L).fill(-1);
      const seenR = Array(R).fill(false);
      const steps = [];
      const push = (note, extra = {}) => steps.push({
        leftN: L, rightN: R, edges: edges.map((e) => ({ ...e })),
        matchR: [...matchR], matchL: [...matchL], seenR: [...seenR],
        path: [], test: null, success: false, currentL: -1, done: false,
        frame: steps.length, note: String(note),
        metrics: { 匹配数: matchR.filter((x) => x >= 0).length, 已尝试右侧: seenR.filter(Boolean).length, 左侧总数: L },
        ...extra,
      });
      push(`生成二分图：左 ${String(L)} 点、右 ${String(R)} 点、${edges.length} 条边，开始匈牙利算法。`);
      for (let l = 0; l < L; l++) push(`初始化左侧节点 L${String(l)}：尚未匹配。`);
      for (let r = 0; r < R; r++) push(`初始化右侧节点 R${String(r)}：尚未匹配。`);
      function aug(l, path) {
        path.push(`L${String(l)}`);
        for (const r of adj[l]) {
          path.push(`R${String(r)}`);
          push(`从 L${String(l)} 尝试连向 R${String(r)}（本次已访问标记：${seenR[r] ? '是' : '否'}）。`,
            { path: path.slice(), test: [l, r], currentL: l });
          if (seenR[r]) { path.pop(); continue; }
          seenR[r] = true;
          const owner = matchR[r];
          if (owner === -1) {
            matchR[r] = l; matchL[l] = r;
            push(`R${String(r)} 空闲，匹配成功：L${String(l)}—R${String(r)}，增广路 ${path.join(' → ')}。`,
              { path: path.slice(), test: [l, r], currentL: l, success: true });
            return true;
          }
          push(`R${String(r)} 已匹配给 L${String(owner)}，尝试让它另寻匹配。`,
            { path: path.slice(), test: [l, r], currentL: l });
          if (aug(owner, path)) {
            matchR[r] = l; matchL[l] = r;
            push(`递归腾挪成功，重新匹配 L${String(l)}—R${String(r)}。`,
              { path: path.slice(), test: [l, r], currentL: l, success: true });
            return true;
          }
          push(`递归失败，L${String(l)} → R${String(r)} 这条分支回退。`,
            { path: path.slice(), test: [l, r], currentL: l });
          path.pop();
        }
        path.pop();
        return false;
      }
      for (let l = 0; l < L; l++) {
        seenR.fill(false);
        push(`为左侧节点 L${String(l)} 寻找增广路，重置右侧访问标记。`,
          { currentL: l });
        if (aug(l, [])) push(`L${String(l)} 找到增广路，匹配数增加到 ${String(matchR.filter((x) => x >= 0).length)}。`,
          { currentL: l });
        else push(`L${String(l)} 未找到增广路，保持原匹配。`, { currentL: l });
      }
      push(`二分图最大匹配完成：共 ${String(matchR.filter((x) => x >= 0).length)} 对。`,
        { done: true, currentL: -1, path: [] });
      return finalize(steps);
    },

    render(snap, p, c) {
      const L = snap.leftN || p.leftN || 1;
      const R = snap.rightN || p.rightN || 1;
      const yOf = (i, n) => n <= 1 ? 0.5 : 0.15 + (i * 0.7) / (n - 1);
      const nodes = [];
      for (let i = 0; i < L; i++) {
        const matched = snap.matchL && snap.matchL[i] >= 0;
        nodes.push({
          id: `L${String(i)}`, label: `L${String(i)}`, x: 0.1, y: yOf(i, L),
          color: matched ? c.success : c.primary,
          sub: matched ? `R${String(snap.matchL[i])}` : '未配',
        });
      }
      for (let j = 0; j < R; j++) {
        const matched = snap.matchR && snap.matchR[j] >= 0;
        nodes.push({
          id: `R${String(j)}`, label: `R${String(j)}`, x: 0.9, y: yOf(j, R),
          color: matched ? c.success : c.warning,
          sub: matched ? `L${String(snap.matchR[j])}` : '未配',
        });
      }
      const edges = (snap.edges || []).map((e) => {
        const matched = snap.matchR && snap.matchR[e.r] === e.l;
        const testing = snap.test && snap.test[0] === e.l && snap.test[1] === e.r;
        return {
          from: `L${String(e.l)}`, to: `R${String(e.r)}`,
          state: testing ? (snap.success ? 'done' : 'bad') : (matched ? 'done' : 'idle'),
        };
      });
      const pathItems = (snap.path || []).map((id) => ({
        label: id, state: snap.success ? 'done' : 'warn',
      }));
      return <Multi panels={[
        { h: 250, el: <GraphView c={c} nodes={nodes} edges={edges} height={250}
          title="二分图匹配（左列 L / 右列 R）"
          subtitle={`${frameTag(snap)} · 当前匹配 ${String(snap.metrics ? snap.metrics.匹配数 : 0)} 对`} /> },
        { h: 160, el: <Flow c={c} items={pathItems} height={160}
          title="当前增广路径" subtitle="L → R → L → … → 未匹配 R" /> },
      ]} />;
    },
  },

  /* ───────────────────── 11. Dinic Max Flow ───────────────────── */
  'max-flow-dinic': {
    params: [
      { key: 'nodeCount', label: '节点数量', type: 'range', min: 4, max: 7, step: 1, default: 6 },
      { key: 'density', label: '边密度', type: 'range', min: 40, max: 85, step: 5, default: 60, unit: '%' },
      { key: 'seed', label: '随机种子', type: 'range', min: 1, max: 30, step: 1, default: 7 },
      { key: 'capacity', label: '最大容量', type: 'range', min: 3, max: 10, step: 1, default: 6 },
    ],
    height: 410,
    legend: [
      { color: P.success, label: '已饱和边 / 割边' },
      { color: P.warning, label: '当前增广路径' },
      { color: P.primary, label: '源点与汇点' },
      { color: P.danger, label: '最小割边界' },
      { color: P.muted, label: '剩余容量' },
    ],
    hint: '每阶段先用 BFS 建分层图，再用 DFS 沿层次推阻塞流；结束后残余图可达集与其余节点之间就是最小割。',

    buildSteps(p) {
      const N = p.nodeCount;
      const rnd = mulberry32(p.seed * 2417 + 101);
      const base = [];
      for (let u = 0; u < N; u++) {
        for (let v = u + 1; v < N; v++) {
          if (rnd() * 100 < p.density) base.push({ u, v, cap: 1 + Math.floor(rnd() * p.capacity) });
        }
      }
      for (let i = 1; i < N; i++) {
        if (!base.some((e) => e.u === i - 1 && e.v === i)) {
          base.push({ u: i - 1, v: i, cap: 1 + Math.floor(rnd() * p.capacity) });
        }
      }
      const s = 0, t = N - 1;
      const E = [], adj = Array.from({ length: N }, () => []);
      const addEdge = (u, v, cap) => {
        const i = E.length;
        E.push({ u, v, cap, flow: 0, rev: i + 1 });
        E.push({ v, u, cap: 0, flow: 0, rev: i });
        adj[u].push(i); adj[v].push(i + 1);
      };
      base.forEach((e) => addEdge(e.u, e.v, e.cap));
      const level = Array(N).fill(-1);
      let total = 0, phases = 0, augCount = 0;
      const steps = [];
      const display = () => base.map((e, i) => ({ u: e.u, v: e.v, cap: e.cap, flow: E[2 * i].flow }));
      const push = (note, extra = {}) => steps.push({
        nodeCount: N, edges: display(), level: [...level],
        source: s, sink: t, path: [], cut: [], focus: -1, done: false,
        frame: steps.length, note: String(note),
        metrics: { 总流量: total, 分层轮次: phases, 增广次数: augCount },
        ...extra,
      });
      push(`生成 ${N} 节点容量网络，源点 ${String(s)}，汇点 ${String(t)}，共 ${String(base.length)} 条边。`);
      base.forEach((e, i) => push(`容量边 ${e.u}→${e.v} 的容量为 ${e.cap}（第 ${String(i + 1)} 条）。`));
      function bfs() {
        level.fill(-1);
        level[s] = 0;
        const q = [s];
        while (q.length) {
          const u = q.shift();
          for (const ei of adj[u]) {
            const e = E[ei];
            if (e.cap - e.flow > 0 && level[e.v] < 0) {
              level[e.v] = level[u] + 1;
              q.push(e.v);
            }
          }
        }
        return level[t] >= 0;
      }
      function dfs(u, limit, path) {
        if (u === t) return limit;
        for (const ei of adj[u]) {
          const e = E[ei], rv = E[e.rev];
          if (e.cap - e.flow > 0 && level[e.v] === level[u] + 1) {
            push(`沿分层边 ${u}→${e.v} 推进：剩余容量 ${String(e.cap - e.flow)}，当前上限 ${String(limit)}。`,
              { path: path.concat([e.v]), focus: Math.floor(ei / 2) });
            const got = dfs(e.v, Math.min(limit, e.cap - e.flow), path.concat([e.v]));
            if (got > 0) {
              e.flow += got; rv.flow -= got;
              push(`增广成功：流量 +${String(got)}，边 ${u}→${e.v} 的流量变为 ${String(e.flow)}/${String(e.cap)}。`,
                { path: path.concat([e.v]), focus: Math.floor(ei / 2) });
              return got;
            }
          }
        }
        return 0;
      }
      while (bfs()) {
        phases += 1;
        push(`第 ${String(phases)} 次 BFS 建立分层图：层次数组 [${level.join(', ')}]。`,
          { metrics: { 总流量: total, 分层轮次: phases, 增广次数: augCount } });
        for (let i = 0; i < N; i++) {
          push(`分层图中节点 ${i} 的层数 = ${String(level[i])}。`,
            { metrics: { 总流量: total, 分层轮次: phases, 增广次数: augCount } });
        }
        let pushed;
        do {
          pushed = dfs(s, p.capacity * N, [s]);
          if (pushed > 0) {
            total += pushed;
            augCount += 1;
            push(`第 ${String(augCount)} 次增广完成，累计最大流 ${String(total)}。`,
              { metrics: { 总流量: total, 分层轮次: phases, 增广次数: augCount } });
          }
        } while (pushed > 0);
        push(`第 ${String(phases)} 阶段阻塞流完成，当前总流量 ${String(total)}。`,
          { metrics: { 总流量: total, 分层轮次: phases, 增广次数: augCount } });
      }
      const seen = Array(N).fill(false);
      seen[s] = true;
      const q = [s];
      while (q.length) {
        const u = q.shift();
        for (const ei of adj[u]) {
          const e = E[ei];
          if (e.cap - e.flow > 0 && !seen[e.v]) { seen[e.v] = true; q.push(e.v); }
        }
      }
      const cut = [];
      base.forEach((e) => {
        if (seen[e.u] && !seen[e.v]) cut.push({ u: e.u, v: e.v, cap: e.cap });
      });
      const cutCap = cut.reduce((sum, e) => sum + e.cap, 0);
      cut.forEach((e) => push(`割边 ${e.u}→${e.v} 容量 ${e.cap}：从可达集跨向不可达集。`,
        { cut: cut.slice(), metrics: { 总流量: total, 分层轮次: phases, 增广次数: augCount } }));
      push(`Dinic 完成：最大流 ${String(total)}，最小割容量 ${String(cutCap)}，二者相等。`,
        { done: true, cut: cut.slice(), metrics: { 总流量: total, 分层轮次: phases, 增广次数: augCount } });
      return finalize(steps);
    },

    render(snap, p, c) {
      const N = snap.nodeCount || p.nodeCount || 1;
      const nodes = circleLayout(N).map((n) => ({
        id: n.id, x: n.x, y: n.y,
        state: n.id === snap.sink ? 'bad' : (n.id === snap.source ? 'current'
          : (snap.level && snap.level[n.id] >= 0 ? 'done' : 'idle')),
        sub: snap.level && snap.level[n.id] >= 0 ? `层 ${String(snap.level[n.id])}` : '',
      }));
      const cutKeys = new Set((snap.cut || []).map((e) => `${e.u}-${e.v}`));
      const edges = (snap.edges || []).map((e) => ({
        from: e.u, to: e.v,
        label: `${String(e.flow)}/${String(e.cap)}`,
        state: cutKeys.has(`${e.u}-${e.v}`) ? 'bad'
          : (e.flow >= e.cap ? 'done' : (snap.path && snap.path.length > 1 && snap.path.indexOf(e.u) >= 0 && snap.path.indexOf(e.v) >= 0 ? 'warn' : 'idle')),
      }));
      const pathItems = (snap.path || []).map((id) => ({
        label: String(id), state: id === snap.sink ? 'done' : 'warn',
      }));
      return <Multi panels={[
        { h: 250, el: <GraphView c={c} nodes={nodes} edges={edges} directed height={250}
          title="Dinic 最大流（边标为 流量/容量）"
          subtitle={`${frameTag(snap)} · 总流量 ${String(snap.metrics ? snap.metrics.总流量 : 0)}`} /> },
        { h: 160, el: <Flow c={c} items={pathItems} height={160}
          title="当前增广路径" subtitle="红色边为最终最小割" /> },
      ]} />;
    },
  },

  /* ───────────────────── 12. Graph Cut ───────────────────── */
  'graph-cut': {
    params: [
      { key: 'rows', label: '像素行数', type: 'range', min: 2, max: 4, step: 1, default: 3 },
      { key: 'cols', label: '像素列数', type: 'range', min: 2, max: 4, step: 1, default: 3 },
      { key: 'seed', label: '随机种子', type: 'range', min: 1, max: 30, step: 1, default: 7 },
      { key: 'weight', label: '容量强度', type: 'range', min: 2, max: 9, step: 1, default: 5 },
    ],
    height: 480,
    legend: [
      { color: P.primary, label: 'S 侧（前景）' },
      { color: P.warning, label: 'T 侧（背景）' },
      { color: P.danger, label: '最小割边界' },
      { color: P.muted, label: '未判定 / 普通边' },
    ],
    hint: '把像素建为节点，数据项接源/汇、相邻像素接相似边；最大流后的残余可达集给出最小割，即最优二分割。',

    buildSteps(p) {
      const R = p.rows, C = p.cols;
      const N = R * C, S = N, T = N + 1, V = N + 2;
      const rnd = mulberry32(p.seed * 2593 + 113);
      const E = [], adj = Array.from({ length: V }, () => []);
      const base = [];
      const addEdge = (u, v, cap) => {
        const i = E.length;
        E.push({ u, v, cap, flow: 0, rev: i + 1 });
        E.push({ v, u, cap: 0, flow: 0, rev: i });
        adj[u].push(i); adj[v].push(i + 1);
        base.push({ u, v, cap });
      };
      const unary = Array(N).fill(0);
      const costS = Array(N).fill(0), costT = Array(N).fill(0);
      for (let r = 0; r < R; r++) {
        for (let col = 0; col < C; col++) {
          const id = r * C + col;
          const bias = (r + col) % 2 === 0 ? p.weight : 0;
          const capS = 1 + Math.floor(rnd() * p.weight) + bias;
          const capT = 1 + Math.floor(rnd() * p.weight) + (bias ? 0 : p.weight);
          costS[id] = capS; costT[id] = capT;
          unary[id] = capS - capT;
          addEdge(S, id, capS);
          addEdge(id, T, capT);
        }
      }
      for (let r = 0; r < R; r++) {
        for (let col = 0; col < C; col++) {
          const id = r * C + col;
          if (r + 1 < R) {
            const w = 1 + Math.floor(rnd() * p.weight);
            addEdge(id, id + C, w); addEdge(id + C, id, w);
          }
          if (col + 1 < C) {
            const w = 1 + Math.floor(rnd() * p.weight);
            addEdge(id, id + 1, w); addEdge(id + 1, id, w);
          }
        }
      }
      const steps = [];
      let total = 0, augCount = 0;
      const showSide = () => {
        const seen = Array(V).fill(false); seen[S] = true;
        const q = [S];
        while (q.length) {
          const u = q.shift();
          for (const ei of adj[u]) {
            const e = E[ei];
            if (e.cap - e.flow > 0 && !seen[e.v]) { seen[e.v] = true; q.push(e.v); }
          }
        }
        return seen;
      };
      const push = (note, extra = {}) => steps.push({
        rows: R, cols: C, nodeCount: N,
        edges: base.map((e, i) => ({ u: e.u, v: e.v, cap: e.cap, flow: E[2 * i].flow })),
        side: showSide(), unary: [...unary],
        path: [], cut: [], focus: -1, done: false,
        frame: steps.length, note: String(note),
        metrics: { 最大流: total, 增广次数: augCount, 割边数: 0 },
        ...extra,
      });
      push(`构建 ${String(R)}×${String(C)} 像素容量图：${String(N)} 个像素节点 + 源点 S + 汇点 T。`);
      for (let id = 0; id < N; id++) push(`像素 ${String(id)} 的数据项：S→点 ${String(costS[id])}，点→T ${String(costT[id])}。`);
      for (let id = 0; id < N; id++) {
        if ((id + 1) % C !== 0 && id + 1 < N) push(`相邻像素 ${String(id)} 与 ${String(id + 1)} 之间加入双向相似边。`);
        if (id + C < N) push(`相邻像素 ${String(id)} 与 ${String(id + C)} 之间加入双向相似边。`);
      }
      while (true) {
        const par = Array(V).fill(-1);
        par[S] = -2;
        const q = [S];
        while (q.length && par[T] === -1) {
          const u = q.shift();
          for (const ei of adj[u]) {
            const e = E[ei];
            if (e.cap - e.flow > 0 && par[e.v] === -1) {
              par[e.v] = ei; q.push(e.v);
              push(`BFS 搜索到节点 ${String(e.v)}（来自 ${String(u)}，剩余 ${String(e.cap - e.flow)}）。`,
                { metrics: { 最大流: total, 增广次数: augCount, 割边数: 0 } });
              if (e.v === T) break;
            }
          }
        }
        if (par[T] === -1) break;
        const path = [T];
        let bottleneck = 1000000;
        for (let v = T; v !== S; v = E[par[v]].u) {
          bottleneck = Math.min(bottleneck, E[par[v]].cap - E[par[v]].flow);
          path.push(E[par[v]].u);
        }
        path.reverse();
        for (let v = T; v !== S; v = E[par[v]].u) {
          const e = E[par[v]];
          e.flow += bottleneck; E[e.rev].flow -= bottleneck;
        }
        total += bottleneck;
        augCount += 1;
        push(`增广路径 ${path.join(' → ')}，瓶颈 ${String(bottleneck)}，累计流量 ${String(total)}。`,
          { path: path.slice(), metrics: { 最大流: total, 增广次数: augCount, 割边数: 0 } });
      }
      const side = showSide();
      const cut = [];
      base.forEach((e) => {
        if (side[e.u] && !side[e.v]) cut.push({ u: e.u, v: e.v, cap: e.cap });
      });
      const cutCap = cut.reduce((s, e) => s + e.cap, 0);
      cut.forEach((e) => push(`割边 ${String(e.u)}—${String(e.v)} 容量 ${String(e.cap)}，跨越 S 侧与 T 侧。`,
        { cut: cut.slice(), metrics: { 最大流: total, 增广次数: augCount, 割边数: cut.length } }));
      push(`图割完成：最小割容量 ${String(cutCap)}，共 ${String(cut.length)} 条割边，得到最优二分割。`,
        { done: true, cut: cut.slice(), metrics: { 最大流: total, 增广次数: augCount, 割边数: cut.length } });
      return finalize(steps);
    },

    render(snap, p, c) {
      const R = snap.rows || p.rows || 1;
      const C = snap.cols || p.cols || 1;
      const N = snap.nodeCount || R * C;
      const S = N, T = N + 1;
      const side = snap.side || [];
      const items = [];
      for (let r = 0; r < R; r++) {
        for (let col = 0; col < C; col++) {
          const id = r * C + col;
          const inS = !!side[id];
          items.push({
            text: inS ? 'S' : 'T',
            color: inS ? c.primary : c.warning,
            sub: snap.unary && snap.unary[id] !== undefined ? `权 ${String(snap.unary[id])}` : '',
          });
        }
      }
      const cutKeys = new Set((snap.cut || []).map((e) => `${e.u}-${e.v}`));
      const px = (id) => {
        if (id === S) return 0.02;
        if (id === T) return 0.98;
        return 0.12 + ((id % C) + 0.5) * (0.76 / C);
      };
      const py = (id) => {
        if (id === S || id === T) return 0.5;
        return 0.14 + (Math.floor(id / C) + 0.5) * (0.72 / R);
      };
      const nodes = [];
      for (let id = 0; id < N; id++) {
        nodes.push({
          id: String(id), label: String(id), x: px(id), y: py(id),
          color: side[id] ? c.primary : c.warning,
        });
      }
      nodes.push({ id: 'S', label: 'S', x: px(S), y: py(S), color: c.success });
      nodes.push({ id: 'T', label: 'T', x: px(T), y: py(T), color: c.danger });
      const edges = (snap.edges || []).map((e) => ({
        from: String(e.u), to: String(e.v), label: String(e.cap),
        state: cutKeys.has(`${e.u}-${e.v}`) ? 'bad' : (e.flow > 0 ? 'done' : 'idle'),
      }));
      return <Multi panels={[
        { h: 220, el: <Cells c={c} items={items} wrap={C} cellW={44} cellH={34} gap={5} x0={22} y0={48}
          height={220} title="最小割分割结果（S 前景 / T 背景）"
          subtitle={`${frameTag(snap)} · 流量 ${String(snap.metrics ? snap.metrics.最大流 : 0)}`} /> },
        { h: 260, el: <GraphView c={c} nodes={nodes} edges={edges} directed height={260}
          title="容量网络与最小割边界（红色=割边）"
          subtitle={`割边 ${String(snap.metrics ? snap.metrics.割边数 : 0)} 条`} /> },
      ]} />;
    },
  },
};

export default graph;
