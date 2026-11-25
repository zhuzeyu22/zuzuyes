import React from 'react';
import { clamp, mulberry32, softmax } from '../utils.js';
import { Frame, num } from '../kits/primitives.jsx';

/* 推荐系统交互演示配置：export default { [catalog id]: config }，config 内不含 id 字段。
 * 只依赖 React / utils / primitives；buildSteps 纯函数确定性；render 颜色只取 c.*。 */

const S = (v) => String(v === undefined || v === null ? '' : v);
const r2 = (v) => Math.round((Number.isFinite(v) ? v : 0) * 100) / 100;
const f2 = (v) => (Number.isFinite(v) ? v : 0).toFixed(2);
const n2 = (v, d = 0) => (Number.isFinite(v) ? v : d);

// 统一收口：保证 20~600 帧，并给每帧补 step / total
function cap(steps) {
  let out = Array.isArray(steps) && steps.length ? steps : [{ note: '暂无数据' }];
  if (out.length > 600) {
    const stride = Math.ceil(out.length / 600);
    out = out.filter((_, i) => i % stride === 0 || i === out.length - 1);
  }
  while (out.length < 20) {
    const last = out[out.length - 1] || { note: '准备中' };
    out = out.concat([{ ...last, note: S(last.note) + '（继续观察）' }]);
  }
  const total = out.length;
  return out.map((s, i) => ({ ...s, step: i, total }));
}

// 小矩阵行列式（高斯消元）
function det(mat) {
  const n = mat.length;
  if (!n) return 1;
  const a = mat.map((r) => r.slice());
  let d = 1;
  for (let col = 0; col < n; col++) {
    let piv = col;
    for (let r = col + 1; r < n; r++) if (Math.abs(a[r][col]) > Math.abs(a[piv][col])) piv = r;
    if (Math.abs(a[piv][col]) < 1e-12) return 0;
    if (piv !== col) { const tmp = a[piv]; a[piv] = a[col]; a[col] = tmp; d = -d; }
    const p = a[col][col];
    d *= p;
    for (let j = col; j < n; j++) a[col][j] /= p;
    for (let r = 0; r < n; r++) if (r !== col) {
      const f = a[r][col];
      if (f) for (let j = col; j < n; j++) a[r][j] -= f * a[col][j];
    }
  }
  return Number.isFinite(d) ? d : 0;
}

// 解 A x = b（A 可逆）
function solve(A, b) {
  const n = b.length;
  const m = A.map((row, i) => row.concat([b[i]]));
  for (let col = 0; col < n; col++) {
    let piv = col;
    for (let r = col + 1; r < n; r++) if (Math.abs(m[r][col]) > Math.abs(m[piv][col])) piv = r;
    if (piv !== col) { const tmp = m[piv]; m[piv] = m[col]; m[col] = tmp; }
    const p = m[col][col] || 1e-9;
    for (let j = col; j <= n; j++) m[col][j] /= p;
    for (let r = 0; r < n; r++) if (r !== col) {
      const f = m[r][col];
      if (f) for (let j = col; j <= n; j++) m[r][j] -= f * m[col][j];
    }
  }
  return m.map((row) => n2(row[n], 0));
}

// 绘图辅助（所有颜色由调用方传入 c.*）
function txt(x, y, v, fill, size = 10, anchor = 'start') {
  return <text x={x} y={y} fontSize={size} fill={fill} textAnchor={anchor}>{S(v)}</text>;
}
function bar(x, y, w, h, value, max, color, bg) {
  const f = Math.max(0, Math.min(1, n2(value, 0) / Math.max(1e-9, n2(max, 1))));
  return (
    <g>
      <rect x={x} y={y} width={w} height={h} rx="2" fill={bg} opacity="0.5" />
      <rect x={x} y={y} width={f * w} height={h} rx="2" fill={color} opacity="0.9" />
    </g>
  );
}
function progress(c, step, total) {
  const f = Math.max(0, Math.min(1, n2(step, 0) / Math.max(1, n2(total, 1))));
  return (
    <g>
      <rect x="20" y="342" width="680" height="3" rx="1.5" fill={c.grid} />
      <rect x="20" y="342" width={f * 680} height="3" rx="1.5" fill={c.primary} />
    </g>
  );
}
function curve(c, hist, x0, y0, w, h, color) {
  const arr = Array.isArray(hist) ? hist.map((v) => n2(v, 0)) : [];
  if (arr.length < 2) return null;
  const hi = Math.max(0.01, ...arr), lo = Math.min(0, ...arr);
  const span = Math.max(1e-9, hi - lo);
  const pts = arr.map((v, i) => `${x0 + (i / (arr.length - 1)) * w},${y0 + h - ((v - lo) / span) * h}`).join(' ');
  return (
    <g>
      <line x1={x0} y1={y0} x2={x0} y2={y0 + h} stroke={c.grid} strokeWidth="1" />
      <line x1={x0} y1={y0 + h} x2={x0 + w} y2={y0 + h} stroke={c.grid} strokeWidth="1" />
      <polyline points={pts} fill="none" stroke={color || c.primary} strokeWidth="1.8" />
      <circle cx={x0 + w} cy={y0 + h - ((arr[arr.length - 1] - lo) / span) * h} r="3" fill={c.warning} />
    </g>
  );
}

export default {
  // ── 1. 基于内容的推荐 ────────────────────────────────────────
  'content-based': {
    params: [
      { key: 'dim', label: '画像/属性维度', type: 'range', min: 3, max: 8, step: 1, default: 5 },
      { key: 'nItems', label: '候选物品数', type: 'range', min: 5, max: 8, step: 1, default: 6 },
      {
        key: 'metric', label: '相似度度量', type: 'select', default: 'cosine',
        options: [{ value: 'cosine', label: '余弦相似度' }, { value: 'dot', label: '点积' }],
      },
      { key: 'seed', label: '随机种子', type: 'range', min: 1, max: 30, step: 1, default: 7 },
    ],
    height: 360,
    legend: [
      { color: '#226AFF', label: '用户画像 / 物品属性' },
      { color: '#f5a524', label: '当前计算维度' },
      { color: '#12a06a', label: 'Top-N 推荐' },
    ],
    hint: '基于内容的推荐：把用户画像与物品属性表示成同维向量，逐维匹配相似度并排序，得到可解释的 Top-N。',
    buildSteps(p) {
      const rnd = mulberry32(n2(p.seed, 7));
      const d = Math.round(clamp(n2(p.dim, 5), 3, 8));
      const N = Math.round(clamp(n2(p.nItems, 6), 5, 8));
      const metric = p.metric === 'dot' ? 'dot' : 'cosine';
      const user = Array.from({ length: d }, () => Math.round(rnd() * 100) / 100);
      const items = Array.from({ length: N }, () =>
        Array.from({ length: d }, () => (rnd() < 0.78 ? Math.round(rnd() * 100) / 100 : 0)));
      const simOf = (vec) => {
        let dot = 0, nu = 0, nv = 0;
        for (let t = 0; t < d; t++) { dot += user[t] * vec[t]; nu += user[t] * user[t]; nv += vec[t] * vec[t]; }
        if (metric === 'dot') return dot;
        const den = Math.sqrt(nu) * Math.sqrt(nv);
        return den > 1e-9 ? dot / den : 0;
      };
      const sims = items.map(simOf);
      const order = items.map((_, i) => i).sort((a, b) => sims[b] - sims[a]);
      const steps = [];
      const push = (note, extra, metrics) => steps.push({
        d, N, metric, user: user.slice(), items: items.map((r) => r.slice()),
        sims: sims.slice(), order: order.slice(), note, metrics, ...extra,
      });
      push('初始化：用户画像与候选物品属性向量已就绪，尚未匹配。',
        { phase: 'init', curItem: -1, curDim: -1, reveal: 0 },
        { 候选数: N, 画像维度: d, 度量: metric });
      for (let i = 0; i < N; i++) {
        let acc = 0;
        for (let t = 0; t < d; t++) {
          acc += user[t] * items[i][t];
          push(`物品 I${i} · 第 ${t + 1}/${d} 维：u=${f2(user[t])} × a=${f2(items[i][t])}，累计 ${f2(acc)}。`,
            { phase: 'match', curItem: i, curDim: t, reveal: 0 },
            { 候选: 'I' + i, 维度: t + 1, 累计贡献: r2(acc), 相似度: r2(sims[i]) });
        }
      }
      for (let rank = 0; rank < Math.min(N, 5); rank++) {
        push(`排序揭示：第 ${rank + 1} 名 I${order[rank]}，相似度 ${f2(sims[order[rank]])}。`,
          { phase: 'rank', curItem: -1, curDim: -1, reveal: rank + 1 },
          { 已排序: rank + 1, 相似度: r2(sims[order[rank]]) });
      }
      push(`完成｜Top-3 推荐：${order.slice(0, 3).map((i) => 'I' + i + '(' + f2(sims[i]) + ')').join('、')}。`,
        { phase: 'done', curItem: -1, curDim: -1, reveal: N },
        { 召回率: r2(Math.min(3, N) / N), 最高相似度: r2(sims[order[0]]), 候选数: N });
      return cap(steps);
    },
    render(snap, p, c) {
      const d = Math.max(1, Math.floor(num(snap.d, 5)));
      const N = Math.max(1, Math.floor(num(snap.N, 6)));
      const user = Array.isArray(snap.user) ? snap.user : [];
      const items = Array.isArray(snap.items) ? snap.items : [];
      const sims = Array.isArray(snap.sims) ? snap.sims : [];
      const order = Array.isArray(snap.order) ? snap.order : [];
      const phase = S(snap.phase || 'init');
      const step = Math.floor(num(snap.step, 0)), total = Math.floor(num(snap.total, 1));
      const curItem = Math.floor(num(snap.curItem, -1)), curDim = Math.floor(num(snap.curDim, -1));
      const reveal = Math.floor(num(snap.reveal, 0));
      const metric = S(snap.metric || 'cosine');
      const maxSim = Math.max(0.01, ...sims.map((v) => Math.abs(n2(v, 0))));
      return (
        <Frame c={c} height={360} title={S('内容推荐 · 用户画像 × 物品属性')}
          subtitle={`${phase} · 第 ${step}/${total} 步`}>
          {txt(20, 44, '用户画像 u（' + d + ' 维）', c.muted, 10)}
          {user.slice(0, d).map((v, t) => (
            <g key={'u' + t}>
              {txt(20 + t * 24, 58, 'd' + t, c.muted, 8, 'middle')}
              {bar(20 + t * 24 - 8, 62, 16, 42, Math.abs(n2(v, 0)), 1, c.primary, c.panel2)}
              {txt(20 + t * 24, 116, f2(v), curDim === t ? c.warning : c.text, 8, 'middle')}
              {curDim === t && <rect x={20 + t * 24 - 9} y={61} width="18" height="44" rx="3"
                fill="none" stroke={c.warning} strokeWidth="1.4" />}
            </g>
          ))}
          {txt(190, 44, '物品属性矩阵（行=物品，列=维度）', c.muted, 10)}
          {items.slice(0, N).map((row, i) => (
            <g key={'i' + i}>
              {txt(186, 66 + i * 18, 'I' + i, curItem === i ? c.warning : c.muted, 9, 'end')}
              {row.slice(0, d).map((v, t) => {
                const active = curItem === i && curDim === t;
                const done = i < curItem || (i === curItem && t <= curDim);
                return (
                  <g key={'c' + t}>
                    <rect x={192 + t * 24} y={54 + i * 18} width="20" height="15" rx="2"
                      fill={active ? c.warning : c.primary}
                      opacity={active ? 0.9 : (done ? 0.18 + 0.6 * Math.abs(n2(v, 0)) : 0.08 + 0.3 * Math.abs(n2(v, 0)))}
                      stroke={active ? c.text : 'none'} strokeWidth={active ? 1.2 : 0} />
                    {txt(202 + t * 24, 65 + i * 18, f2(v), active ? c.bg : c.text, 8, 'middle')}
                  </g>
                );
              })}
            </g>
          ))}
          {txt(500, 44, '相似度 / Top-N', c.muted, 10)}
          {sims.slice(0, N).map((v, i) => {
            const rank = order.indexOf(i);
            const shown = phase === 'done' || phase === 'rank' || phase === 'match';
            const w = shown ? Math.max(0, n2(v, 0)) / maxSim : 0;
            return (
              <g key={'s' + i}>
                {txt(500, 66 + i * 24, 'I' + i, c.muted, 9)}
                {bar(528, 56 + i * 24, 110, 12, shown ? w : 0, 1,
                  rank >= 0 && rank < 3 ? c.success : c.primary, c.panel2)}
                {txt(646, 66 + i * 24, shown ? f2(v) : '—', c.text, 9)}
                {rank >= 0 && rank < Math.min(3, reveal || 3) &&
                  txt(668, 66 + i * 24, '★' + (rank + 1), c.success, 9)}
              </g>
            );
          })}
          <line x1="20" y1="306" x2="700" y2="306" stroke={c.grid} strokeWidth="1" />
          {txt(20, 322, metric === 'cosine' ? 'sim(u,a) = u·a / (‖u‖·‖a‖)' : 'sim(u,a) = u·a（点积）', c.muted, 10)}
          {txt(20, 336, 'Top-N：' + (phase === 'done' ? order.slice(0, 3).map((i) => 'I' + i).join('、') : '排序中…'), c.success, 10)}
          {progress(c, step, total)}
        </Frame>
      );
    },
  },

  // ── 2. ALS 交替最小二乘 ──────────────────────────────────────
  'svd-als': {
    params: [
      { key: 'k', label: '隐因子维度 k', type: 'range', min: 2, max: 6, step: 1, default: 3 },
      { key: 'iters', label: '交替轮数', type: 'range', min: 3, max: 8, step: 1, default: 5 },
      { key: 'lambda', label: '正则系数 λ', type: 'range', min: 0.01, max: 0.2, step: 0.01, default: 0.05 },
      { key: 'seed', label: '随机种子', type: 'range', min: 1, max: 30, step: 1, default: 7 },
    ],
    height: 360,
    legend: [
      { color: '#226AFF', label: '真实评分矩阵 R' },
      { color: '#7c5cff', label: '用户 / 物品隐因子' },
      { color: '#f5a524', label: '当前更新对象' },
      { color: '#12a06a', label: 'RMSE 下降曲线' },
    ],
    hint: 'ALS：固定物品隐因子求用户隐因子的闭式解，再交替反过来，观察 RMSE 逐轮下降。',
    buildSteps(p) {
      const rnd = mulberry32(n2(p.seed, 7));
      const k = Math.round(clamp(n2(p.k, 3), 2, 6));
      const T = Math.round(clamp(n2(p.iters, 5), 3, 8));
      const lam = clamp(n2(p.lambda, 0.05), 0.001, 0.5);
      const U = 4, I = 5;
      const R = Array.from({ length: U }, () =>
        Array.from({ length: I }, () => (rnd() < 0.72 ? 1 + Math.floor(rnd() * 5) : 0)));
      for (let u = 0; u < U; u++) if (!R[u].some((v) => v > 0)) R[u][u % I] = 3;
      for (let i = 0; i < I; i++) if (!R.some((row) => row[i] > 0)) R[i % U][i] = 3;
      let P = Array.from({ length: U }, () => Array.from({ length: k }, () => (rnd() - 0.5) * 0.6));
      let Q = Array.from({ length: I }, () => Array.from({ length: k }, () => (rnd() - 0.5) * 0.6));
      const rmse = () => {
        let s = 0, n = 0;
        for (let u = 0; u < U; u++) for (let i = 0; i < I; i++) if (R[u][i] > 0) {
          let d = 0;
          for (let t = 0; t < k; t++) d += P[u][t] * Q[i][t];
          s += (R[u][i] - d) ** 2; n++;
        }
        const v = Math.sqrt(s / Math.max(1, n));
        return Number.isFinite(v) ? v : 0;
      };
      const hist = [rmse()];
      const steps = [];
      const push = (note, extra, metrics) => steps.push({
        U, I, k, T, lam, R: R.map((r) => r.slice()),
        P: P.map((r) => r.slice()), Q: Q.map((r) => r.slice()),
        rmseHist: hist.slice(), note, metrics, ...extra,
      });
      push(`初始化：${U}×${I} 评分矩阵、k=${k} 隐因子，初始 RMSE=${f2(hist[0])}。`,
        { phase: 'init', focus: null, round: 0 },
        { 初始RMSE: r2(hist[0]), 隐因子维度: k, 轮数: T, 已评分格: R.flat().filter((v) => v > 0).length });
      for (let it = 1; it <= T; it++) {
        for (let u = 0; u < U; u++) {
          const A = Array.from({ length: k }, (_, a) => Array.from({ length: k }, (_, b) =>
            (a === b ? lam : 0) + Q.reduce((s, q, i) => (R[u][i] > 0 ? s + q[a] * q[b] : s), 0)));
          const b = Array.from({ length: k }, (_, a) =>
            Q.reduce((s, q, i) => (R[u][i] > 0 ? s + q[a] * R[u][i] : s), 0));
          P[u] = solve(A, b);
          hist.push(rmse());
          push(`第 ${it} 轮 · 固定 Q，闭式更新用户隐因子 p${u}；RMSE=${f2(hist[hist.length - 1])}。`,
            { phase: 'user', focus: { type: 'u', idx: u }, round: it },
            { 轮次: it, 当前RMSE: r2(hist[hist.length - 1]), 更新对象: '用户' + u });
        }
        for (let i = 0; i < I; i++) {
          const A = Array.from({ length: k }, (_, a) => Array.from({ length: k }, (_, b) =>
            (a === b ? lam : 0) + P.reduce((s, p, u) => (R[u][i] > 0 ? s + p[a] * p[b] : s), 0)));
          const b = Array.from({ length: k }, (_, a) =>
            P.reduce((s, p, u) => (R[u][i] > 0 ? s + p[a] * R[u][i] : s), 0));
          Q[i] = solve(A, b);
          hist.push(rmse());
          push(`第 ${it} 轮 · 固定 P，闭式更新物品隐因子 q${i}；RMSE=${f2(hist[hist.length - 1])}。`,
            { phase: 'item', focus: { type: 'i', idx: i }, round: it },
            { 轮次: it, 当前RMSE: r2(hist[hist.length - 1]), 更新对象: '物品' + i });
        }
      }
      push(`训练完成：${T} 轮交替更新，RMSE 从 ${f2(hist[0])} 降到 ${f2(hist[hist.length - 1])}。`,
        { phase: 'done', focus: null, round: T },
        { 最终RMSE: r2(hist[hist.length - 1]), 下降幅度: r2(hist[0] - hist[hist.length - 1]), 轮数: T });
      return cap(steps);
    },
    render(snap, p, c) {
      const R = Array.isArray(snap.R) ? snap.R : [];
      const P = Array.isArray(snap.P) ? snap.P : [];
      const Q = Array.isArray(snap.Q) ? snap.Q : [];
      const U = R.length, I = U ? (R[0] || []).length : 0;
      const k = Math.max(1, Math.floor(num(snap.k, 3)));
      const focus = snap.focus || null;
      const phase = S(snap.phase || 'init');
      const step = Math.floor(num(snap.step, 0)), total = Math.floor(num(snap.total, 1));
      const round = Math.floor(num(snap.round, 0));
      return (
        <Frame c={c} height={360}
          title={S('ALS 交替最小二乘 · k=' + k + ' · 第 ' + round + ' 轮')}
          subtitle={`${phase} · 第 ${step}/${total} 步`}>
          {txt(20, 44, '真实评分矩阵 R（U0 为目标用户）', c.muted, 10)}
          {R.map((row, u) => (
            <g key={'r' + u}>
              {txt(26, 66 + u * 24, 'U' + u, c.muted, 9, 'end')}
              {row.map((v, i) => {
                const hit = focus && ((focus.type === 'u' && focus.idx === u) || (focus.type === 'i' && focus.idx === i));
                return (
                  <g key={'c' + i}>
                    <rect x={32 + i * 30} y={54 + u * 24} width="26" height="20" rx="3"
                      fill={v > 0 ? c.primary : c.panel2} opacity={v > 0 ? 0.14 + 0.11 * v : 1}
                      stroke={hit ? c.warning : 'none'} strokeWidth={hit ? 1.5 : 0} />
                    {txt(45 + i * 30, 68 + u * 24, v > 0 ? String(v) : '·', v > 0 ? c.text : c.muted, 9, 'middle')}
                  </g>
                );
              })}
            </g>
          ))}
          {txt(220, 44, '用户隐因子 P（4×k）', c.muted, 10)}
          {P.map((row, u) => (
            <g key={'p' + u}>
              {txt(216, 66 + u * 24, 'p' + u, focus && focus.type === 'u' && focus.idx === u ? c.warning : c.muted, 9, 'end')}
              {row.slice(0, k).map((v, t) => {
                const hit = focus && focus.type === 'u' && focus.idx === u;
                return (
                  <g key={'pt' + t}>
                    <rect x={224 + t * 28} y={54 + u * 24} width="24" height="20" rx="2"
                      fill={hit ? c.warning : c.purple} opacity={hit ? 0.85 : 0.28 + 0.25 * Math.min(1, Math.abs(n2(v, 0)) * 2)} />
                    {txt(236 + t * 28, 68 + u * 24, f2(v), hit ? c.bg : c.text, 8, 'middle')}
                  </g>
                );
              })}
            </g>
          ))}
          {txt(400, 44, '物品隐因子 Q（5×k）', c.muted, 10)}
          {Q.map((row, i) => (
            <g key={'q' + i}>
              {txt(396, 66 + i * 24, 'q' + i, focus && focus.type === 'i' && focus.idx === i ? c.warning : c.muted, 9, 'end')}
              {row.slice(0, k).map((v, t) => {
                const hit = focus && focus.type === 'i' && focus.idx === i;
                return (
                  <g key={'qt' + t}>
                    <rect x={404 + t * 28} y={54 + i * 24} width="24" height="20" rx="2"
                      fill={hit ? c.warning : c.purple} opacity={hit ? 0.85 : 0.28 + 0.25 * Math.min(1, Math.abs(n2(v, 0)) * 2)} />
                    {txt(416 + t * 28, 68 + i * 24, f2(v), hit ? c.bg : c.text, 8, 'middle')}
                  </g>
                );
              })}
            </g>
          ))}
          {txt(588, 44, 'RMSE 下降', c.muted, 10)}
          {curve(c, snap.rmseHist, 590, 60, 100, 76, c.success)}
          {txt(590, 154, 'RMSE ' + (Array.isArray(snap.rmseHist) && snap.rmseHist.length
            ? f2(snap.rmseHist[snap.rmseHist.length - 1]) : '—'), c.text, 10)}
          <line x1="20" y1="182" x2="700" y2="182" stroke={c.grid} strokeWidth="1" />
          {txt(20, 200, '闭式解：固定 Q 时  (QᵀQ + λI)·pᵤ = Qᵀ·rᵤ；固定 P 时同理求 qᵢ。', c.text, 10)}
          {txt(20, 218, '每轮交替更新 U 个用户 + I 个物品，正则 λ 抑制过拟合，RMSE 单调下降。', c.muted, 10)}
          {txt(20, 244, '交替更新顺序', c.muted, 10)}
          {['初始化', '固定 Q → 更新 P', '固定 P → 更新 Q', '收敛'].map((label, i) => {
            const on = phase === 'init' ? i === 0 : phase === 'user' ? i === 1 : phase === 'item' ? i === 2 : i === 3;
            return (
              <g key={'ph' + i}>
                <rect x={20 + i * 172} y={254} width="152" height="30" rx="5"
                  fill={on ? c.primary : c.panel2} opacity={on ? 0.9 : 0.7} />
                {txt(96 + i * 172, 273, label, on ? c.bg : c.muted, 10, 'middle')}
              </g>
            );
          })}
          <line x1="20" y1="306" x2="700" y2="306" stroke={c.grid} strokeWidth="1" />
          {txt(20, 322, '预测 r̂ᵤᵢ = pᵤ · qᵢ；损失 = Σ(rᵤᵢ − r̂ᵤᵢ)² + λ(‖p‖²+‖q‖²)', c.muted, 10)}
          {txt(20, 336, '隐因子维度 k 越大表达力越强；λ 越小越贴合训练评分。', c.muted, 10)}
          {progress(c, step, total)}
        </Frame>
      );
    },
  },

  // ── 3. FM 因子分解机 ─────────────────────────────────────────
  'fm': {
    params: [
      { key: 'k', label: '隐向量维度 k', type: 'range', min: 2, max: 6, step: 1, default: 4 },
      { key: 'nFeat', label: '特征数', type: 'range', min: 4, max: 8, step: 1, default: 6 },
      { key: 'steps', label: '训练步数', type: 'range', min: 12, max: 30, step: 3, default: 18 },
      { key: 'seed', label: '随机种子', type: 'range', min: 1, max: 30, step: 1, default: 7 },
    ],
    height: 360,
    legend: [
      { color: '#226AFF', label: '特征隐向量 vᵢ' },
      { color: '#f5a524', label: '当前交叉对' },
      { color: '#12a06a', label: '二阶交叉贡献' },
      { color: '#e5484d', label: '损失曲线' },
    ],
    hint: 'FM 为每个特征学一个隐向量，用两两内积 <vᵢ,vⱼ> 显式建模二阶特征交叉。',
    buildSteps(p) {
      const rnd = mulberry32(n2(p.seed, 7));
      const k = Math.round(clamp(n2(p.k, 4), 2, 6));
      const d = Math.round(clamp(n2(p.nFeat, 6), 4, 8));
      const T = Math.round(clamp(n2(p.steps, 18), 12, 30));
      const x = Array.from({ length: d }, () => (rnd() < 0.5 ? 1 : 0));
      if (!x.some((v) => v > 0)) x[0] = 1;
      const w = Array.from({ length: d }, () => (rnd() - 0.5) * 0.4);
      const v = Array.from({ length: d }, () => Array.from({ length: k }, () => (rnd() - 0.5) * 0.4));
      const w0 = 0.1;
      const pairValue = (i, j) => {
        let s = 0;
        for (let t = 0; t < k; t++) s += v[i][t] * v[j][t];
        return s;
      };
      const pred = () => {
        let s = w0;
        for (let i = 0; i < d; i++) s += w[i] * x[i];
        for (let i = 0; i < d; i++) for (let j = i + 1; j < d; j++) s += pairValue(i, j) * x[i] * x[j];
        return s;
      };
      const pairMat = () => Array.from({ length: d }, (_, i) =>
        Array.from({ length: d }, (_, j) => (j > i ? pairValue(i, j) : 0)));
      const target = x.reduce((s, xi, i) => s + xi * (i % 2 ? 0.2 : 0.7), 0);
      const hist = [];
      const steps = [];
      const push = (note, extra, metrics) => steps.push({
        d, k, T, x: x.slice(), w: w.slice(), v: v.map((r) => r.slice()),
        pairMat: pairMat(), lossHist: hist.slice(), pred: pred(), target, note, metrics, ...extra,
      });
      push(`初始化：${d} 个特征（${x.filter((b) => b > 0).length} 个取值为 1），每个学 k=${k} 维隐向量。`,
        { phase: 'init', pair: null, reveal: 0 },
        { 特征数: d, 隐向量维度: k, 有效交叉对: x.reduce((s, xi, i) => s + xi * x.slice(i + 1).reduce((a, b) => a + b, 0), 0) });
      for (let i = 0; i < d; i++) {
        push(`一阶权重 w${i}=${f2(w[i])}，特征 f${i} 取值=${x[i]}，线性贡献=${f2(w[i] * x[i])}。`,
          { phase: 'init', pair: [i, Math.min(d - 1, i + 1)], reveal: 0 },
          { 特征: 'f' + i, 一阶权重: r2(w[i]), 线性贡献: r2(w[i] * x[i]) });
      }
      const pairs = [];
      for (let i = 0; i < d; i++) for (let j = i + 1; j < d; j++) if (x[i] && x[j]) pairs.push([i, j]);
      pairs.forEach(([i, j], idx) => {
        push(`交叉项 <v${i},v${j}> = ${f2(pairValue(i, j))}，x${i}·x${j}=1，贡献 ${f2(pairValue(i, j))}。`,
          { phase: 'cross', pair: [i, j], reveal: idx + 1 },
          { 交叉对: 'f' + i + '×f' + j, 内积: r2(pairValue(i, j)), 二阶贡献: r2(pairValue(i, j)) });
      });
      for (let step = 1; step <= T; step++) {
        const lr = 0.04;
        const e = pred() - target;
        for (let i = 0; i < d; i++) if (x[i]) w[i] -= lr * e * x[i];
        for (let i = 0; i < d; i++) for (let j = i + 1; j < d; j++) if (x[i] && x[j]) {
          for (let t = 0; t < k; t++) {
            const vi = v[i][t], vj = v[j][t];
            v[i][t] = vi - lr * e * vj;
            v[j][t] = vj - lr * e * vi;
          }
        }
        hist.push(0.5 * e * e);
        push(`训练第 ${step}/${T} 步：pred=${f2(pred())}，目标=${f2(target)}，损失=${f2(hist[hist.length - 1])}。`,
          { phase: 'train', pair: null, reveal: pairs.length },
          { 训练步: step, 预测CTR: r2(pred()), 损失: r2(hist[hist.length - 1]), 二阶贡献: r2(pred() - w0 - w.reduce((s, wi, i) => s + wi * x[i], 0)) });
        if (step % 3 === 0) {
          if (pairs.length) {
            const pr = pairs[step % pairs.length];
            push(`检查点：观察交叉 <v${pr[0]},v${pr[1]}> = ${f2(pairValue(pr[0], pr[1]))}，当前损失=${f2(hist[hist.length - 1])}。`,
              { phase: 'cross', pair: pr, reveal: pairs.length },
              { 交叉对: 'f' + pr[0] + '×f' + pr[1], 内积: r2(pairValue(pr[0], pr[1])), 检查点: step });
          } else {
            push(`检查点：当前无有效二阶交叉，pred=${f2(pred())}，损失=${f2(hist[hist.length - 1])}。`,
              { phase: 'train', pair: null, reveal: 0 },
              { 检查点: step, 预测CTR: r2(pred()), 交叉项数: 0 });
          }
        }
      }
      push(`完成｜FM 预测 CTR=${f2(pred())}，显式建模 ${pairs.length} 个二阶交叉项。`,
        { phase: 'done', pair: null, reveal: pairs.length },
        { 预测CTR: r2(pred()), 交叉项数: pairs.length, 最终损失: r2(hist.length ? hist[hist.length - 1] : 0) });
      return cap(steps);
    },
    render(snap, p, c) {
      const d = Math.max(1, Math.floor(num(snap.d, 6)));
      const k = Math.max(1, Math.floor(num(snap.k, 4)));
      const v = Array.isArray(snap.v) ? snap.v : [];
      const x = Array.isArray(snap.x) ? snap.x : [];
      const pm = Array.isArray(snap.pairMat) ? snap.pairMat : [];
      const lossHist = Array.isArray(snap.lossHist) ? snap.lossHist : [];
      const phase = S(snap.phase || 'init');
      const step = Math.floor(num(snap.step, 0)), total = Math.floor(num(snap.total, 1));
      const pair = Array.isArray(snap.pair) ? snap.pair : null;
      const pred = n2(snap.pred, 0), target = n2(snap.target, 0);
      const wArr = Array.isArray(snap.w) ? snap.w : [];
      const firstOrder = wArr.slice(0, d).reduce((s, ww, i) => s + n2(ww, 0) * n2(x[i], 0), 0);
      const secondOrder = pred - 0.1 - firstOrder;
      return (
        <Frame c={c} height={360} title={S('FM · 二阶特征交叉（k=' + k + '）')}
          subtitle={`${phase} · 第 ${step}/${total} 步`}>
          {txt(20, 44, '特征隐向量 vᵢ（' + d + '×' + k + '）', c.muted, 10)}
          {v.slice(0, d).map((row, i) => (
            <g key={'v' + i}>
              {txt(70, 66 + i * 22, 'f' + i + (x[i] ? '●' : '○'), pair && (pair[0] === i || pair[1] === i) ? c.warning : c.muted, 9, 'end')}
              {row.slice(0, k).map((val, t) => (
                <g key={'vt' + t}>
                  <rect x={78 + t * 26} y={54 + i * 22} width="22" height="18" rx="2"
                    fill={pair && (pair[0] === i || pair[1] === i) ? c.warning : c.primary}
                    opacity={pair && (pair[0] === i || pair[1] === i) ? 0.85 : 0.2 + 0.35 * Math.min(1, Math.abs(n2(val, 0)) * 2)} />
                  {txt(89 + t * 26, 67 + i * 22, f2(val), c.text, 8, 'middle')}
                </g>
              ))}
            </g>
          ))}
          {txt(270, 44, '交叉项矩阵 <vᵢ,vⱼ>（上三角）', c.muted, 10)}
          {pm.slice(0, d).map((row, i) => (
            <g key={'pm' + i}>
              {row.slice(0, d).map((val, j) => {
                const isCur = pair && pair[0] === i && pair[1] === j;
                if (j <= i) return null;
                return (
                  <g key={'pmc' + j}>
                    <rect x={272 + (j - 1) * 30} y={54 + i * 22} width="26" height="18" rx="2"
                      fill={isCur ? c.warning : c.success}
                      opacity={isCur ? 0.9 : 0.12 + 0.4 * Math.min(1, Math.abs(n2(val, 0)))} />
                    {txt(285 + (j - 1) * 30, 67 + i * 22, f2(val), isCur ? c.bg : c.text, 8, 'middle')}
                  </g>
                );
              })}
            </g>
          ))}
          {txt(500, 44, '预测分解', c.muted, 10)}
          {[['一阶 w·x', firstOrder, c.primary], ['二阶 Σ<vᵢ,vⱼ>', secondOrder, c.success], ['总预测 ŷ', pred, c.purple]].map((row, i) => (
            <g key={'pd' + i}>
              {txt(500, 68 + i * 28, row[0], c.muted, 9)}
              {bar(610, 58 + i * 28, 70, 12, Math.abs(n2(row[1], 0)), Math.max(1, Math.abs(pred), 1), row[2], c.panel2)}
              {txt(686, 68 + i * 28, f2(row[1]), c.text, 9, 'end')}
            </g>
          ))}
          {txt(500, 160, '目标 ' + f2(target) + ' · 损失曲线', c.muted, 10)}
          {curve(c, lossHist, 502, 176, 190, 76, c.danger)}
          <line x1="20" y1="286" x2="700" y2="286" stroke={c.grid} strokeWidth="1" />
          {txt(20, 304, 'ŷ = w₀ + Σᵢ wᵢxᵢ + Σᵢ<ⱼ <vᵢ,vⱼ> xᵢxⱼ；FM 用隐向量内积解决稀疏特征组合。', c.text, 10)}
          {txt(20, 322, '●=特征取 1，○=取 0；只有同时为 1 的一对才产生二阶贡献。', c.muted, 10)}
          {txt(20, 336, 'k 越大交叉表达力越强；训练步数越多损失越低。', c.muted, 10)}
          {progress(c, step, total)}
        </Frame>
      );
    },
  },

  // ── 4. FFM 域感知分解机 ──────────────────────────────────────
  'ffm': {
    params: [
      { key: 'k', label: '隐向量维度 k', type: 'range', min: 2, max: 6, step: 1, default: 4 },
      { key: 'fields', label: '特征域数', type: 'range', min: 2, max: 4, step: 1, default: 3 },
      { key: 'steps', label: '训练步数', type: 'range', min: 10, max: 26, step: 4, default: 18 },
      { key: 'seed', label: '随机种子', type: 'range', min: 1, max: 30, step: 1, default: 7 },
    ],
    height: 360,
    legend: [
      { color: '#226AFF', label: '特征在目标域的隐向量' },
      { color: '#f5a524', label: '当前域感知交叉' },
      { color: '#7c5cff', label: 'FM 共享向量（对比）' },
      { color: '#12a06a', label: '损失下降' },
    ],
    hint: 'FFM 为每个特征按“对方所属域”各学一套隐向量，交叉用 vᵢ→fⱼ · vⱼ→fᵢ，表达更细但参数更多。',
    buildSteps(p) {
      const rnd = mulberry32(n2(p.seed, 7));
      const k = Math.round(clamp(n2(p.k, 4), 2, 6));
      const F = Math.round(clamp(n2(p.fields, 3), 2, 4));
      const T = Math.round(clamp(n2(p.steps, 18), 10, 26));
      const d = 6;
      const x = Array.from({ length: d }, () => (rnd() < 0.55 ? 1 : 0));
      if (!x.some((b) => b > 0)) x[0] = 1;
      const field = Array.from({ length: d }, (_, i) => i % F);
      // vec[i][f] = 特征 i 面向域 f 的隐向量
      const vec = Array.from({ length: d }, () =>
        Array.from({ length: F }, () => Array.from({ length: k }, () => (rnd() - 0.5) * 0.4)));
      const fmVec = Array.from({ length: d }, () => Array.from({ length: k }, () => (rnd() - 0.5) * 0.4));
      const dot = (a, b) => { let s = 0; for (let t = 0; t < k; t++) s += a[t] * b[t]; return s; };
      const crossFFM = (i, j) => dot(vec[i][field[j]], vec[j][field[i]]);
      const crossFM = (i, j) => dot(fmVec[i], fmVec[j]);
      const pred = () => {
        let s = 0;
        for (let i = 0; i < d; i++) for (let j = i + 1; j < d; j++) if (x[i] && x[j]) s += crossFFM(i, j);
        return s;
      };
      const target = x.reduce((s, xi, i) => s + xi * (i % 2 ? 0.1 : 0.55), 0);
      const hist = [];
      const steps = [];
      const push = (note, extra, metrics) => steps.push({
        d, k, F, T, x: x.slice(), field: field.slice(),
        vec: vec.map((a) => a.map((b) => b.slice())),
        fmVec: fmVec.map((r) => r.slice()), lossHist: hist.slice(), pred: pred(), target, note, metrics, ...extra,
      });
      push(`初始化：${d} 个特征分入 ${F} 个域，每个特征对 ${F} 个域各有 k=${k} 维向量。`,
        { phase: 'init', pair: null, reveal: 0 },
        { 域数: F, 参数量: d * F * k, FM参数量: d * k, 交叉对: x.reduce((s, xi, i) => s + xi * x.slice(i + 1).reduce((a, b) => a + b, 0), 0) });
      for (let f = 0; f < F; f++) {
        push(`域 ${f}：每个特征准备一套面向域 ${f} 的 ${k} 维向量，共 ${d}×${k} 个参数。`,
          { phase: 'init', pair: [f % d, (f + 1) % d], reveal: 0 },
          { 域: f, 参数量: d * k, 域数: F });
      }
      const pairs = [];
      for (let i = 0; i < d; i++) for (let j = i + 1; j < d; j++) if (x[i] && x[j]) pairs.push([i, j]);
      pairs.forEach(([i, j], idx) => {
        push(`f${i}(域${field[i]})×f${j}(域${field[j]})：FFM=<v${i}→f${j},v${j}→f${i}>=${f2(crossFFM(i, j))}，FM=${f2(crossFM(i, j))}。`,
          { phase: 'cross', pair: [i, j], reveal: idx + 1 },
          { 交叉对: 'f' + i + '×f' + j, FFM内积: r2(crossFFM(i, j)), FM内积: r2(crossFM(i, j)) });
      });
      for (let step = 1; step <= T; step++) {
        const lr = 0.035, e = pred() - target;
        for (let i = 0; i < d; i++) for (let j = i + 1; j < d; j++) if (x[i] && x[j]) {
          const a = vec[i][field[j]], b = vec[j][field[i]];
          for (let t = 0; t < k; t++) {
            const av = a[t], bv = b[t];
            a[t] = av - lr * e * bv;
            b[t] = bv - lr * e * av;
          }
        }
        hist.push(0.5 * e * e);
        push(`训练第 ${step}/${T} 步：FFM 预测=${f2(pred())}，损失=${f2(hist[hist.length - 1])}。`,
          { phase: 'train', pair: null, reveal: pairs.length },
          { 训练步: step, 预测CTR: r2(pred()), 损失: r2(hist[hist.length - 1]), 参数量: d * F * k });
        if (step % 3 === 0 && pairs.length) {
          const pr = pairs[step % pairs.length];
          push(`检查点：域感知交叉 <v${pr[0]}→f${field[pr[1]]},v${pr[1]}→f${field[pr[0]]}> = ${f2(crossFFM(pr[0], pr[1]))}。`,
            { phase: 'cross', pair: pr, reveal: pairs.length },
            { 交叉对: 'f' + pr[0] + '×f' + pr[1], 内积: r2(crossFFM(pr[0], pr[1])), 检查点: step });
        }
      }
      push(`完成｜FFM 预测=${f2(pred())}，域感知交叉比 FM 多 ${d * F * k - d * k} 个参数。`,
        { phase: 'done', pair: null, reveal: pairs.length },
        { 预测CTR: r2(pred()), 参数量: d * F * k, FM参数量: d * k, 最终损失: r2(hist.length ? hist[hist.length - 1] : 0) });
      return cap(steps);
    },
    render(snap, p, c) {
      const d = Math.max(1, Math.floor(num(snap.d, 6)));
      const k = Math.max(1, Math.floor(num(snap.k, 4)));
      const F = Math.max(1, Math.floor(num(snap.F, 3)));
      const field = Array.isArray(snap.field) ? snap.field : [];
      const vec = Array.isArray(snap.vec) ? snap.vec : [];
      const x = Array.isArray(snap.x) ? snap.x : [];
      const lossHist = Array.isArray(snap.lossHist) ? snap.lossHist : [];
      const phase = S(snap.phase || 'init');
      const step = Math.floor(num(snap.step, 0)), total = Math.floor(num(snap.total, 1));
      const pair = Array.isArray(snap.pair) ? snap.pair : null;
      return (
        <Frame c={c} height={360} title={S('FFM · 域感知特征交叉（域=' + F + '）')}
          subtitle={`${phase} · 第 ${step}/${total} 步`}>
          {txt(20, 44, '每个特征面向各域的隐向量（行=特征，列=域）', c.muted, 10)}
          {vec.slice(0, d).map((perField, i) => (
            <g key={'f' + i}>
              {txt(112, 66 + i * 22, 'f' + i + '[域' + num(field[i], 0) + ']' + (x[i] ? '●' : '○'),
                pair && (pair[0] === i || pair[1] === i) ? c.warning : c.muted, 9, 'end')}
              {perField.slice(0, F).map((v, f) => (
                <g key={'ff' + f}>
                  <rect x={120 + f * 74} y={54 + i * 22} width="68" height="18" rx="2"
                    fill={pair && (pair[0] === i || pair[1] === i) ? c.warning : c.primary}
                    opacity={pair && (pair[0] === i || pair[1] === i) ? 0.7 : 0.14 + 0.4 * Math.min(1, Math.abs(n2(v[0], 0)) * 2)} />
                  {txt(154 + f * 74, 67 + i * 22, '域' + f, c.text, 8, 'middle')}
                </g>
              ))}
            </g>
          ))}
          {txt(410, 44, '交叉方向（目标域不同 → 用不同向量）', c.muted, 10)}
          {pair ? (
            <g>
              {txt(410, 70, 'f' + pair[0] + ' × f' + pair[1], c.text, 11)}
              {txt(410, 92, 'v(f' + pair[0] + '→域' + num(field[pair[1]], 0) + ') · v(f' + pair[1] + '→域' + num(field[pair[0]], 0) + ')', c.warning, 10)}
              {txt(410, 116, 'FM 对比：每个特征只有 1 套共享向量', c.muted, 10)}
              {txt(410, 138, 'FFM 参数量 = 特征数 × 域数 × k', c.success, 10)}
            </g>
          ) : txt(410, 70, '待选择交叉对…', c.muted, 10)}
          {txt(410, 176, '损失下降', c.muted, 10)}
          {curve(c, lossHist, 412, 190, 280, 76, c.success)}
          <line x1="20" y1="286" x2="700" y2="286" stroke={c.grid} strokeWidth="1" />
          {txt(20, 304, 'FFM 交叉：<vᵢ,fⱼ , vⱼ,fᵢ>，即 fᵢ 面向 fⱼ 所在域、fⱼ 面向 fᵢ 所在域的向量做内积。', c.text, 10)}
          {txt(20, 322, '域数 F 与维度 k 越大参数越多（' + d + '×' + F + '×' + k + '），拟合更细但更易过拟合。', c.muted, 10)}
          {txt(20, 336, '橙色高亮 = 当前交叉对所用的域感知向量。', c.muted, 10)}
          {progress(c, step, total)}
        </Frame>
      );
    },
  },

  // ── 5. Wide & Deep ────────────────────────────────────────────
  'wide-deep': {
    params: [
      { key: 'hidden', label: '隐层宽度', type: 'range', min: 4, max: 16, step: 2, default: 8 },
      { key: 'embDim', label: 'Embedding 维度', type: 'range', min: 2, max: 8, step: 1, default: 4 },
      { key: 'steps', label: '训练步数', type: 'range', min: 12, max: 30, step: 3, default: 18 },
      { key: 'seed', label: '随机种子', type: 'range', min: 1, max: 30, step: 1, default: 7 },
    ],
    height: 360,
    legend: [
      { color: '#226AFF', label: 'Wide 分支（记忆）' },
      { color: '#7c5cff', label: 'Deep 分支（泛化）' },
      { color: '#f5a524', label: '当前训练步' },
      { color: '#12a06a', label: '损失 / AUC' },
    ],
    hint: 'Wide & Deep：线性宽部记忆高频共现组合，深度分支用 embedding+MLP 泛化未见过组合，两者相加做预测。',
    buildSteps(p) {
      const rnd = mulberry32(n2(p.seed, 7));
      const hidden = Math.round(clamp(n2(p.hidden, 8), 4, 16));
      const dim = Math.round(clamp(n2(p.embDim, 4), 2, 8));
      const T = Math.round(clamp(n2(p.steps, 18), 12, 30));
      const nFeat = 8;
      const x = Array.from({ length: nFeat }, () => (rnd() < 0.5 ? 1 : 0));
      if (!x.some((b) => b > 0)) x[0] = 1;
      const cross = [x[0] * x[4], x[1] * x[5], x[2] * x[6], x[3] * x[7]];
      const wWide = Array.from({ length: nFeat + cross.length }, () => (rnd() - 0.5) * 0.4);
      const emb = Array.from({ length: nFeat }, () => Array.from({ length: dim }, () => (rnd() - 0.5) * 0.6));
      let wDeep = Array.from({ length: hidden }, () => (rnd() - 0.5) * 0.3);
      let wOut = (rnd() - 0.5) * 0.3;
      const target = x.reduce((s, xi, i) => s + xi * (i % 3 === 0 ? 0.6 : 0.2), 0);
      const sigmoid = (z) => 1 / (1 + Math.exp(-Math.max(-20, Math.min(20, z))));
      const wideOut = () => {
        const feat = x.concat(cross);
        return feat.reduce((s, fv, i) => s + wWide[i] * fv, 0);
      };
      const deepOut = () => {
        const pooled = Array.from({ length: dim }, (_, t) =>
          x.reduce((s, xi, i) => s + xi * emb[i][t], 0) / Math.max(1, x.filter((b) => b > 0).length));
        const act = wDeep.map((wd, h) => Math.tanh(wd * pooled[h % dim] * 2));
        return { act, logit: act.reduce((s, a) => s + a, 0) * wOut };
      };
      const pred = () => sigmoid(wideOut() + deepOut().logit);
      const hist = [];
      const steps = [];
      const push = (note, extra, metrics) => steps.push({
        nFeat, hidden, dim, x: x.slice(), cross: cross.slice(),
        wWide: wWide.slice(), wDeep: wDeep.slice(), wOut, emb: emb.map((r) => r.slice()),
        wideOut: wideOut(), deep: deepOut(), pred: pred(), lossHist: hist.slice(), note, metrics, ...extra,
      });
      push(`初始化：Wide 分支含 ${nFeat + cross.length} 维（含 ${cross.length} 个人工交叉），Deep 分支 ${dim}→${hidden}→1。`,
        { phase: 'init', active: -1 },
        { 隐层宽度: hidden, 向量维度: dim, 宽部特征: nFeat + cross.length });
      for (let i = 0; i < nFeat; i++) {
        push(`Wide 记忆特征 f${i}=${x[i]}，权重 w${i}=${f2(wWide[i])}，线性贡献=${f2(wWide[i] * x[i])}。`,
          { phase: 'init', active: i % hidden },
          { 宽部特征: 'f' + i, 取值: x[i], 权重: r2(wWide[i]) });
      }
      for (let h = 0; h < hidden; h++) {
        push(`Deep 隐层神经元 a${h}：w=${f2(wDeep[h])}，当前激活=${f2(deepOut().act[h])}。`,
          { phase: 'init', active: h },
          { 神经元: h, 权重: r2(wDeep[h]), 激活: r2(deepOut().act[h]) });
      }
      for (let step = 1; step <= T; step++) {
        const lr = 0.05, e = pred() - target;
        const feat = x.concat(cross);
        for (let i = 0; i < feat.length; i++) if (feat[i]) wWide[i] -= lr * e * feat[i];
        const pooled = Array.from({ length: dim }, (_, t) =>
          x.reduce((s, xi, i) => s + xi * emb[i][t], 0) / Math.max(1, x.filter((b) => b > 0).length));
        for (let h = 0; h < hidden; h++) wDeep[h] -= lr * e * Math.tanh(wDeep[h] * pooled[h % dim] * 2) * 0.5;
        wOut -= lr * e * deepOut().act.reduce((s, a) => s + a, 0);
        hist.push(-(target * Math.log(Math.max(1e-9, pred())) + (1 - target) * Math.log(Math.max(1e-9, 1 - pred()))));
        push(`训练第 ${step}/${T} 步：Wide=${f2(wideOut())}，Deep=${f2(deepOut().logit)}，CTR=${f2(pred())}，损失=${f2(hist[hist.length - 1])}。`,
          { phase: 'train', active: step % hidden },
          { 训练步: step, 宽部输出: r2(wideOut()), 深部输出: r2(deepOut().logit), 预测CTR: r2(pred()), 损失: r2(hist[hist.length - 1]) });
      }
      push(`完成｜Wide 记忆高频组合，Deep 泛化未见组合，CTR=${f2(pred())}。`,
        { phase: 'done', active: -1 },
        { 预测CTR: r2(pred()), 最终损失: r2(hist.length ? hist[hist.length - 1] : 0), 隐层宽度: hidden });
      return cap(steps);
    },
    render(snap, p, c) {
      const hidden = Math.max(1, Math.floor(num(snap.hidden, 8)));
      const dim = Math.max(1, Math.floor(num(snap.dim, 4)));
      const x = Array.isArray(snap.x) ? snap.x : [];
      const wWide = Array.isArray(snap.wWide) ? snap.wWide : [];
      const wDeep = Array.isArray(snap.wDeep) ? snap.wDeep : [];
      const act = snap.deep && Array.isArray(snap.deep.act) ? snap.deep.act : [];
      const lossHist = Array.isArray(snap.lossHist) ? snap.lossHist : [];
      const phase = S(snap.phase || 'init');
      const step = Math.floor(num(snap.step, 0)), total = Math.floor(num(snap.total, 1));
      const active = Math.floor(num(snap.active, -1));
      const wideOut = n2(snap.wideOut, 0), deepOut = snap.deep ? n2(snap.deep.logit, 0) : 0;
      const pred = n2(snap.pred, 0.5);
      return (
        <Frame c={c} height={360} title={S('Wide & Deep · 记忆 + 泛化')}
          subtitle={`${phase} · 第 ${step}/${total} 步`}>
          {txt(20, 44, '输入特征（●=1）', c.muted, 10)}
          {x.slice(0, 8).map((v, i) => (
            <g key={'x' + i}>
              <rect x={20 + i * 22} y={54} width="16" height="16" rx="3"
                fill={v ? c.primary : c.panel2} opacity={v ? 0.85 : 1} />
              {txt(28 + i * 22, 66, 'f' + i, v ? c.bg : c.muted, 8, 'middle')}
            </g>
          ))}
          {txt(20, 92, 'Wide 分支：线性权重（含 f0×f4 等交叉）', c.primary, 10)}
          {wWide.slice(0, 12).map((v, i) => (
            <g key={'ww' + i}>
              {bar(20 + i * 40, 102, 34, 12, Math.abs(n2(v, 0)), 0.5, c.primary, c.panel2)}
              {txt(37 + i * 40, 130, 'w' + i, c.muted, 8, 'middle')}
            </g>
          ))}
          {txt(20, 152, 'Deep 分支：Embedding(' + dim + ') → Dense(' + hidden + ') → 1', c.purple, 10)}
          {act.slice(0, hidden).map((v, h) => (
            <g key={'a' + h}>
              <rect x={20 + h * 22} y={164} width="16" height="16" rx="2"
                fill={c.purple} opacity={0.15 + 0.7 * Math.min(1, Math.abs(n2(v, 0)))}
                stroke={active === h ? c.warning : 'none'} strokeWidth={active === h ? 1.4 : 0} />
              {txt(28 + h * 22, 176, h, c.text, 8, 'middle')}
            </g>
          ))}
          {txt(300, 44, '双分支输出与合并', c.muted, 10)}
          {[['Wide（记忆）', wideOut, c.primary], ['Deep（泛化）', deepOut, c.purple], ['合并 logit', wideOut + deepOut, c.warning]].map((row, i) => (
            <g key={'o' + i}>
              {txt(300, 70 + i * 30, row[0], c.muted, 10)}
              {bar(400, 60 + i * 30, 130, 14, Math.abs(n2(row[1], 0)), Math.max(1, Math.abs(wideOut) + Math.abs(deepOut)), row[2], c.panel2)}
              {txt(540, 70 + i * 30, f2(row[1]), c.text, 10)}
            </g>
          ))}
          {txt(300, 172, '预测 CTR = σ(Wide + Deep) = ' + f2(pred), c.success, 11)}
          {txt(300, 196, '损失下降（交叉熵）', c.muted, 10)}
          {curve(c, lossHist, 302, 210, 390, 76, c.success)}
          <line x1="20" y1="306" x2="700" y2="306" stroke={c.grid} strokeWidth="1" />
          {txt(20, 322, 'σ(z)=1/(1+e⁻ᶻ)；p = σ(w_wide·x + w_deep·MLP(emb))', c.text, 10)}
          {txt(20, 336, 'Wide 记住高频共现，Deep 泛化稀疏/未见组合；训练步数越多拟合越好。', c.muted, 10)}
          {progress(c, step, total)}
        </Frame>
      );
    },
  },

  // ── 6. DeepFM ─────────────────────────────────────────────────
  'deepfm': {
    params: [
      { key: 'embDim', label: 'Embedding 维度', type: 'range', min: 2, max: 8, step: 1, default: 4 },
      { key: 'hidden', label: '隐层宽度', type: 'range', min: 4, max: 16, step: 2, default: 8 },
      { key: 'steps', label: '训练步数', type: 'range', min: 12, max: 30, step: 3, default: 18 },
      { key: 'seed', label: '随机种子', type: 'range', min: 1, max: 30, step: 1, default: 7 },
    ],
    height: 360,
    legend: [
      { color: '#226AFF', label: '共享 Embedding' },
      { color: '#12a06a', label: 'FM 低阶交叉' },
      { color: '#7c5cff', label: 'Deep 高阶交叉' },
      { color: '#f5a524', label: '当前交叉 / 损失' },
    ],
    hint: 'DeepFM 用 FM 替换 Wide 部分，FM 与 Deep 共享同一套 embedding，端到端同时学低阶与高阶交叉。',
    buildSteps(p) {
      const rnd = mulberry32(n2(p.seed, 7));
      const dim = Math.round(clamp(n2(p.embDim, 4), 2, 8));
      const hidden = Math.round(clamp(n2(p.hidden, 8), 4, 16));
      const T = Math.round(clamp(n2(p.steps, 18), 12, 30));
      const d = 6;
      const x = Array.from({ length: d }, () => (rnd() < 0.5 ? 1 : 0));
      if (!x.some((b) => b > 0)) x[0] = 1;
      const w0 = 0.1, w = Array.from({ length: d }, () => (rnd() - 0.5) * 0.3);
      const emb = Array.from({ length: d }, () => Array.from({ length: dim }, () => (rnd() - 0.5) * 0.5));
      let wDeep = Array.from({ length: hidden }, () => (rnd() - 0.5) * 0.3);
      let wOut = (rnd() - 0.5) * 0.3;
      const target = x.reduce((s, xi, i) => s + xi * (i % 2 ? 0.25 : 0.65), 0);
      const sigmoid = (z) => 1 / (1 + Math.exp(-Math.max(-20, Math.min(20, z))));
      const fmSecond = () => {
        let s = 0;
        for (let i = 0; i < d; i++) for (let j = i + 1; j < d; j++) if (x[i] && x[j]) {
          for (let t = 0; t < dim; t++) s += emb[i][t] * emb[j][t];
        }
        return s;
      };
      const fmFirst = () => w0 + w.reduce((s, wi, i) => s + wi * x[i], 0);
      const deepVec = () => {
        const pooled = Array.from({ length: dim }, (_, t) =>
          x.reduce((s, xi, i) => s + xi * emb[i][t], 0) / Math.max(1, x.filter((b) => b > 0).length));
        return wDeep.map((wd, h) => Math.tanh(wd * pooled[h % dim] * 2));
      };
      const deepOut = () => deepVec().reduce((s, a) => s + a, 0) * wOut;
      const pred = () => sigmoid(fmFirst() + fmSecond() + deepOut());
      const hist = [];
      const steps = [];
      const push = (note, extra, metrics) => steps.push({
        d, dim, hidden, x: x.slice(), w: w.slice(), emb: emb.map((r) => r.slice()),
        wDeep: wDeep.slice(), wOut, fmFirst: fmFirst(), fmSecond: fmSecond(),
        deep: deepOut(), deepVec: deepVec(), pred: pred(), lossHist: hist.slice(), note, metrics, ...extra,
      });
      push(`初始化：FM 与 Deep 共享 ${d}×${dim} 的 embedding；FM 学一阶+二阶，Deep 学高阶。`,
        { phase: 'init', active: -1, pair: null },
        { 向量维度: dim, 隐层宽度: hidden, 共享参数: d * dim });
      for (let i = 0; i < d; i++) {
        push(`共享 embedding 第 ${i} 行（f${i}）：v${i} = [${emb[i].slice(0, 4).map(f2).join(', ')}]，取值 x${i}=${x[i]}。`,
          { phase: 'init', active: -1, pair: [i, Math.min(d - 1, i + 1)] },
          { 特征: 'f' + i, 取值: x[i], 共享参数: dim });
      }
      const pairs = [];
      for (let i = 0; i < d; i++) for (let j = i + 1; j < d; j++) if (x[i] && x[j]) pairs.push([i, j]);
      pairs.forEach(([i, j], idx) => {
        let s = 0; for (let t = 0; t < dim; t++) s += emb[i][t] * emb[j][t];
        push(`FM 二阶交叉 <v${i},v${j}> = ${f2(s)}（与 Deep 共用同一 embedding）。`,
          { phase: 'cross', active: -1, pair: [i, j] },
          { 交叉对: 'f' + i + '×f' + j, 二阶内积: r2(s) });
      });
      for (let step = 1; step <= T; step++) {
        const lr = 0.04, e = pred() - target;
        for (let i = 0; i < d; i++) if (x[i]) w[i] -= lr * e * x[i];
        for (let i = 0; i < d; i++) for (let j = i + 1; j < d; j++) if (x[i] && x[j]) {
          for (let t = 0; t < dim; t++) {
            const a = emb[i][t], b = emb[j][t];
            emb[i][t] = a - lr * e * b; emb[j][t] = b - lr * e * a;
          }
        }
        const dv = deepVec();
        for (let h = 0; h < hidden; h++) wDeep[h] -= lr * e * dv[h] * 0.5;
        wOut -= lr * e * dv.reduce((s, a) => s + a, 0);
        hist.push(-(target * Math.log(Math.max(1e-9, pred())) + (1 - target) * Math.log(Math.max(1e-9, 1 - pred()))));
        push(`训练第 ${step}/${T} 步：FM=${f2(fmFirst() + fmSecond())}，Deep=${f2(deepOut())}，CTR=${f2(pred())}。`,
          { phase: 'train', active: step % hidden, pair: null },
          { 训练步: step, FM输出: r2(fmFirst() + fmSecond()), Deep输出: r2(deepOut()), 预测CTR: r2(pred()), 损失: r2(hist[hist.length - 1]) });
        if (step % 3 === 0 && pairs.length) {
          const pr = pairs[step % pairs.length];
          let s = 0; for (let t = 0; t < dim; t++) s += emb[pr[0]][t] * emb[pr[1]][t];
          push(`检查点：复用的共享向量交叉 <v${pr[0]},v${pr[1]}> = ${f2(s)}。`,
            { phase: 'cross', active: -1, pair: pr },
            { 交叉对: 'f' + pr[0] + '×f' + pr[1], 二阶内积: r2(s), 检查点: step });
        }
      }
      push(`完成｜DeepFM CTR=${f2(pred())}，共享 embedding 同时学低阶与高阶交叉。`,
        { phase: 'done', active: -1, pair: null },
        { 预测CTR: r2(pred()), 共享参数: d * dim, 最终损失: r2(hist.length ? hist[hist.length - 1] : 0) });
      return cap(steps);
    },
    render(snap, p, c) {
      const dim = Math.max(1, Math.floor(num(snap.dim, 4)));
      const d = Math.max(1, Math.floor(num(snap.d, 6)));
      const emb = Array.isArray(snap.emb) ? snap.emb : [];
      const x = Array.isArray(snap.x) ? snap.x : [];
      const dv = Array.isArray(snap.deepVec) ? snap.deepVec : [];
      const lossHist = Array.isArray(snap.lossHist) ? snap.lossHist : [];
      const phase = S(snap.phase || 'init');
      const step = Math.floor(num(snap.step, 0)), total = Math.floor(num(snap.total, 1));
      const pair = Array.isArray(snap.pair) ? snap.pair : null;
      const active = Math.floor(num(snap.active, -1));
      return (
        <Frame c={c} height={360} title={S('DeepFM · 共享 Embedding 的低阶+高阶交叉')}
          subtitle={`${phase} · 第 ${step}/${total} 步`}>
          {txt(20, 44, '共享 Embedding（' + d + '×' + dim + '）', c.muted, 10)}
          {emb.slice(0, d).map((row, i) => (
            <g key={'e' + i}>
              {txt(70, 66 + i * 20, 'f' + i + (x[i] ? '●' : '○'), pair && (pair[0] === i || pair[1] === i) ? c.warning : c.muted, 9, 'end')}
              {row.slice(0, dim).map((v, t) => (
                <g key={'et' + t}>
                  <rect x={78 + t * 24} y={54 + i * 20} width="20" height="16" rx="2"
                    fill={pair && (pair[0] === i || pair[1] === i) ? c.warning : c.primary}
                    opacity={pair && (pair[0] === i || pair[1] === i) ? 0.85 : 0.15 + 0.4 * Math.min(1, Math.abs(n2(v, 0)) * 2)} />
                  {txt(88 + t * 24, 66 + i * 20, f2(v), c.text, 8, 'middle')}
                </g>
              ))}
            </g>
          ))}
          {txt(250, 44, 'FM 部分（低阶）', c.success, 10)}
          {[['一阶 + 偏置', n2(snap.fmFirst, 0)], ['二阶 Σ<vᵢ,vⱼ>', n2(snap.fmSecond, 0)]].map((row, i) => (
            <g key={'fm' + i}>
              {txt(250, 70 + i * 26, row[0], c.muted, 9)}
              {bar(380, 60 + i * 26, 90, 12, Math.abs(n2(row[1], 0)), 2, c.success, c.panel2)}
              {txt(478, 70 + i * 26, f2(row[1]), c.text, 9)}
            </g>
          ))}
          {txt(250, 138, 'Deep 部分（高阶）', c.purple, 10)}
          {dv.map((v, h) => (
            <g key={'dv' + h}>
              <rect x={250 + h * 24} y={150} width="18" height="16" rx="2" fill={c.purple}
                opacity={0.15 + 0.7 * Math.min(1, Math.abs(v))}
                stroke={active === h ? c.warning : 'none'} strokeWidth={active === h ? 1.4 : 0} />
              {txt(259 + h * 24, 162, h, c.text, 8, 'middle')}
            </g>
          ))}
          {txt(250, 184, 'Deep 输出 = ' + f2(snap.deep), c.purple, 10)}
          {txt(520, 44, '合并预测 CTR', c.muted, 10)}
          {txt(520, 76, 'σ(FM + Deep) = ' + f2(snap.pred), c.success, 12)}
          {txt(520, 104, '损失下降', c.muted, 10)}
          {curve(c, lossHist, 522, 118, 170, 76, c.warning)}
          <line x1="20" y1="286" x2="700" y2="286" stroke={c.grid} strokeWidth="1" />
          {txt(20, 304, 'ŷ = σ(w₀ + Σwᵢxᵢ + Σ<vᵢ,vⱼ>xᵢxⱼ + Deep(concat(vᵢ)))', c.text, 10)}
          {txt(20, 322, 'FM 与 Deep 共享同一 embedding，无需分别做特征工程，端到端训练。', c.muted, 10)}
          {txt(20, 336, '橙色高亮 = 当前交叉所复用的共享向量。', c.muted, 10)}
          {progress(c, step, total)}
        </Frame>
      );
    },
  },

  // ── 7. DIN 兴趣网络 ──────────────────────────────────────────
  'din': {
    params: [
      { key: 'histLen', label: '历史行为长度', type: 'range', min: 4, max: 10, step: 1, default: 6 },
      { key: 'embDim', label: 'Embedding 维度', type: 'range', min: 2, max: 8, step: 1, default: 4 },
      {
        key: 'target', label: '目标物品', type: 'select', default: 'A',
        options: [{ value: 'A', label: '目标 A（数码）' }, { value: 'B', label: '目标 B（服饰）' }, { value: 'C', label: '目标 C（食品）' }],
      },
      { key: 'seed', label: '随机种子', type: 'range', min: 1, max: 30, step: 1, default: 7 },
    ],
    height: 360,
    legend: [
      { color: '#226AFF', label: '历史行为 embedding' },
      { color: '#f5a524', label: '目标物品 / 当前注意力' },
      { color: '#12a06a', label: '最高注意力权重' },
      { color: '#e5484d', label: '低权重历史' },
    ],
    hint: 'DIN 对目标物品与用户历史行为做注意力加权，得到随目标变化的动态兴趣表达，再预测点击率。',
    buildSteps(p) {
      const rnd = mulberry32(n2(p.seed, 7));
      const L = Math.round(clamp(n2(p.histLen, 6), 4, 10));
      const dim = Math.round(clamp(n2(p.embDim, 4), 2, 8));
      const targetKey = S(p.target || 'A');
      const targetScore = targetKey === 'A' ? 0.95 : targetKey === 'B' ? 0.25 : 0.6;
      const cat = [targetScore, 1 - targetScore, 0.5];
      const hist = Array.from({ length: L }, () => {
        const c = Math.floor(rnd() * 3);
        return { cat: c, vec: Array.from({ length: dim }, () => (rnd() - 0.5) * 1.2) };
      });
      const tVec = Array.from({ length: dim }, () => (rnd() - 0.5) * 1.2);
      const targetCat = targetKey === 'A' ? 0 : targetKey === 'B' ? 1 : 2;
      const score = (h) => {
        let s = 0;
        for (let t = 0; t < dim; t++) s += h.vec[t] * tVec[t];
        return s + (h.cat === targetCat ? 1.2 : 0);
      };
      const raw = hist.map(score);
      const att = softmax(raw, 0.6);
      const interest = Array.from({ length: dim }, (_, t) =>
        hist.reduce((s, h, i) => s + att[i] * h.vec[t], 0));
      let dot = 0; for (let t = 0; t < dim; t++) dot += interest[t] * tVec[t];
      const ctr = 1 / (1 + Math.exp(-Math.max(-20, Math.min(20, dot))));
      const entropy = -att.reduce((s, a) => s + (a > 1e-9 ? a * Math.log(a) : 0), 0);
      const steps = [];
      const push = (note, extra, metrics) => steps.push({
        L, dim, targetKey, hist: hist.map((h) => ({ cat: h.cat, vec: h.vec.slice() })),
        tVec: tVec.slice(), att: att.slice(), interest: interest.slice(), ctr, note, metrics, ...extra,
      });
      push(`初始化：用户历史 ${L} 条行为，目标物品 ${targetKey}（类别偏好），待计算注意力。`,
        { phase: 'init', cur: -1, reveal: 0 },
        { 历史长度: L, 向量维度: dim, 目标: targetKey });
      raw.forEach((s, i) => {
        let acc = 0;
        for (let t = 0; t < dim; t++) {
          const term = hist[i].vec[t] * tVec[t];
          acc += term;
          push(`历史 b${i} · 第 ${t + 1}/${dim} 维：b=${f2(hist[i].vec[t])} × target=${f2(tVec[t])} = ${f2(term)}，累计=${f2(acc)}。`,
            { phase: 'att', cur: i, reveal: i + 1, dimIdx: t },
            { 历史项: 'b' + i, 维度: t + 1, 累计相关分: r2(acc) });
        }
        const bonus = hist[i].cat === targetCat ? 1.2 : 0;
        push(`历史 b${i}（类${hist[i].cat}${bonus ? '，命中目标类别 +1.2' : ''}）相关分=${f2(s)}。`,
          { phase: 'att', cur: i, reveal: i + 1, dimIdx: -1 },
          { 历史项: 'b' + i, 相关分: r2(s), 类别加成: r2(bonus) });
        push(`历史 b${i} 经 softmax：注意力 att${i}=${f2(att[i])}。`,
          { phase: 'att', cur: i, reveal: i + 1, dimIdx: -2 },
          { 历史项: 'b' + i, 注意力: r2(att[i]) });
      });
      const best = att.indexOf(Math.max(...att));
      for (let t = 0; t < dim; t++) {
        const part = hist.reduce((s, h, i) => s + n2(att[i], 0) * n2(h.vec[t], 0), 0);
        push(`加权求和第 ${t + 1}/${dim} 维：interest[${t}] = Σ attᵢ·bᵢ[${t}] = ${f2(part)}。`,
          { phase: 'pool', cur: -1, reveal: L, dimIdx: t },
          { 维度: t + 1, 兴趣分量: r2(part) });
      }
      push(`聚合完成：兴趣向量 = Σ attᵢ·bᵢ，最高注意力为 b${best}（${f2(att[best])}）。`,
        { phase: 'pool', cur: -1, reveal: L, dimIdx: -1 },
        { 最高注意力项: 'b' + best, 最高权重: r2(att[best]), 注意力熵: r2(entropy) });
      push(`预测：interest·target = ${f2(dot)} → CTR = ${f2(ctr)}；目标不同则权重重排。`,
        { phase: 'done', cur: -1, reveal: L },
        { 预测CTR: r2(ctr), 注意力熵: r2(entropy), 历史长度: L });
      return cap(steps);
    },
    render(snap, p, c) {
      const L = Math.max(1, Math.floor(num(snap.L, 6)));
      const hist = Array.isArray(snap.hist) ? snap.hist : [];
      const att = Array.isArray(snap.att) ? snap.att : [];
      const interest = Array.isArray(snap.interest) ? snap.interest : [];
      const targetKey = S(snap.targetKey || 'A');
      const phase = S(snap.phase || 'init');
      const step = Math.floor(num(snap.step, 0)), total = Math.floor(num(snap.total, 1));
      const cur = Math.floor(num(snap.cur, -1));
      const reveal = Math.floor(num(snap.reveal, 0));
      const maxAtt = Math.max(0.01, ...att.map((v) => n2(v, 0)));
      const best = att.indexOf(Math.max(...att.map((v) => n2(v, 0))));
      return (
        <Frame c={c} height={360} title={S('DIN · 目标感知的兴趣注意力（目标 ' + targetKey + '）')}
          subtitle={`${phase} · 第 ${step}/${total} 步`}>
          {txt(20, 44, '用户历史行为序列（注意力权重）', c.muted, 10)}
          {hist.slice(0, L).map((h, i) => {
            const shown = phase === 'done' || phase === 'pool' || i < reveal;
            const w = shown ? n2(att[i], 0) / maxAtt : 0;
            const col = i === best && phase === 'done' ? c.success : (cur === i ? c.warning : c.primary);
            return (
              <g key={'h' + i}>
                {txt(54, 68 + i * 22, 'b' + i + '[类' + h.cat + ']', c.muted, 9, 'end')}
                {bar(62, 56 + i * 22, 150, 14, w, 1, col, c.panel2)}
                {txt(220, 68 + i * 22, shown ? f2(att[i]) : '—', c.text, 9)}
              </g>
            );
          })}
          {txt(270, 44, '目标物品 embedding', c.muted, 10)}
          {(Array.isArray(snap.tVec) ? snap.tVec : []).slice(0, 8).map((v, t) => (
            <g key={'tv' + t}>
              {bar(270, 54 + t * 20, 90, 14, Math.abs(n2(v, 0)), 1, c.warning, c.panel2)}
              {txt(368, 66 + t * 20, f2(v), c.text, 9)}
            </g>
          ))}
          {txt(430, 44, '动态兴趣向量（加权求和）', c.muted, 10)}
          {interest.slice(0, 8).map((v, t) => (
            <g key={'iv' + t}>
              {bar(430, 54 + t * 20, 100, 14, Math.abs(n2(v, 0)), 1, c.primary, c.panel2)}
              {txt(538, 66 + t * 20, f2(v), c.text, 9)}
            </g>
          ))}
          {txt(580, 44, '预测 CTR', c.muted, 10)}
          {txt(580, 80, f2(snap.ctr), c.success, 20)}
          {txt(580, 104, '最高注意力 b' + best, c.muted, 9)}
          <line x1="20" y1="286" x2="700" y2="286" stroke={c.grid} strokeWidth="1" />
          {txt(20, 304, 'attᵢ = softmax(score(bᵢ, target))，interest = Σ attᵢ·bᵢ，CTR = σ(interest·target)', c.text, 10)}
          {txt(20, 322, '目标不同 → 相关分重排 → 兴趣向量改变；注意力熵越小表示兴趣越集中。', c.muted, 10)}
          {txt(20, 336, '绿色=该目标下最相关的历史行为；橙色=正在计算的行为。', c.muted, 10)}
          {progress(c, step, total)}
        </Frame>
      );
    },
  },

  // ── 8. DSSM 语义匹配 ─────────────────────────────────────────
  'dssm': {
    params: [
      { key: 'dim', label: '语义向量维度', type: 'range', min: 2, max: 8, step: 1, default: 4 },
      { key: 'nDocs', label: '候选文档数', type: 'range', min: 4, max: 8, step: 1, default: 6 },
      { key: 'steps', label: '训练步数', type: 'range', min: 12, max: 30, step: 3, default: 18 },
      { key: 'seed', label: '随机种子', type: 'range', min: 1, max: 30, step: 1, default: 7 },
    ],
    height: 360,
    legend: [
      { color: '#226AFF', label: 'Query 语义向量' },
      { color: '#7c5cff', label: '文档语义向量' },
      { color: '#12a06a', label: '正样本（拉近）' },
      { color: '#e5484d', label: '负样本（推远）' },
    ],
    hint: 'DSSM 把查询与文档映射进同一语义空间，用余弦相似度打分，对比损失拉近正样本、推远负样本。',
    buildSteps(p) {
      const rnd = mulberry32(n2(p.seed, 7));
      const dim = Math.round(clamp(n2(p.dim, 4), 2, 8));
      const M = Math.round(clamp(n2(p.nDocs, 6), 4, 8));
      const T = Math.round(clamp(n2(p.steps, 18), 12, 30));
      const q = Array.from({ length: dim }, () => (rnd() - 0.5) * 0.8);
      const docs = Array.from({ length: M }, () => Array.from({ length: dim }, () => (rnd() - 0.5) * 0.8));
      const pos = 0;
      const dot = (a, b) => { let s = 0; for (let t = 0; t < dim; t++) s += a[t] * b[t]; return s; };
      const cos = (a, b) => {
        const na = Math.sqrt(dot(a, a)), nb = Math.sqrt(dot(b, b));
        return na > 1e-9 && nb > 1e-9 ? dot(a, b) / (na * nb) : 0;
      };
      const ranks = () => docs.map((d, i) => ({ i, s: cos(q, d) })).sort((a, b) => b.s - a.s);
      const hist = [];
      const steps = [];
      const push = (note, extra, metrics) => steps.push({
        dim, M, q: q.slice(), docs: docs.map((r) => r.slice()), pos,
        cosPos: cos(q, docs[pos]), ranks: ranks(), lossHist: hist.slice(), note, metrics, ...extra,
      });
      push(`初始化：Query 与 ${M} 篇文档映射到 ${dim} 维语义空间，尚未训练。`,
        { phase: 'init', stepIdx: 0 },
        { 向量维度: dim, 文档数: M, 初始余弦: r2(cos(q, docs[pos])) });
      for (let i = 0; i < M; i++) {
        push(`文档 D${i} 语义向量=[${docs[i].slice(0, 4).map(f2).join(', ')}]，与 Query 余弦=${f2(cos(q, docs[i]))}。`,
          { phase: 'init', stepIdx: 0, neg: i === 0 ? -1 : i },
          { 文档: 'D' + i, 余弦: r2(cos(q, docs[i])), 文档数: M });
      }
      for (let step = 1; step <= T; step++) {
        const lr = 0.05;
        const neg = 1 + (step % (M - 1));
        const cp = cos(q, docs[pos]), cn = cos(q, docs[neg]);
        const margin = 1 - cp + cn;
        const loss = Math.max(0, margin);
        if (loss > 0) {
          for (let t = 0; t < dim; t++) {
            q[t] += lr * docs[pos][t] - lr * docs[neg][t];
            docs[pos][t] += lr * q[t];
            docs[neg][t] -= lr * q[t];
          }
        }
        hist.push(loss);
        push(`第 ${step}/${T} 步：正样本余弦=${f2(cp)}，负样本=${f2(cn)}，margin 损失=${f2(loss)}。`,
          { phase: 'train', stepIdx: step, neg },
          { 训练步: step, 正样本余弦: r2(cos(q, docs[pos])), 负样本余弦: r2(cos(q, docs[neg])), 损失: r2(loss), '召回率@1': ranks()[0].i === pos ? 1 : 0 });
        if (step % 3 === 0) {
          push(`检查点：当前 Query 与各文档余弦排序 Top-1 = D${ranks()[0].i}。`,
            { phase: 'train', stepIdx: step, neg: ranks()[1] ? ranks()[1].i : -1 },
            { 检查点: step, '召回率@1': ranks()[0].i === pos ? 1 : 0, 文档数: M });
        }
      }
      push(`完成｜正样本余弦=${f2(cos(q, docs[pos]))}，Top-1=${'D' + ranks()[0].i}。`,
        { phase: 'done', stepIdx: T, neg: -1 },
        { 正样本余弦: r2(cos(q, docs[pos])), '召回率@1': ranks()[0].i === pos ? 1 : 0, 最终损失: r2(hist.length ? hist[hist.length - 1] : 0) });
      return cap(steps);
    },
    render(snap, p, c) {
      const dim = Math.max(1, Math.floor(num(snap.dim, 4)));
      const q = Array.isArray(snap.q) ? snap.q : [];
      const docs = Array.isArray(snap.docs) ? snap.docs : [];
      const ranks = Array.isArray(snap.ranks) ? snap.ranks : [];
      const lossHist = Array.isArray(snap.lossHist) ? snap.lossHist : [];
      const phase = S(snap.phase || 'init');
      const step = Math.floor(num(snap.step, 0)), total = Math.floor(num(snap.total, 1));
      const neg = Math.floor(num(snap.neg, -1));
      const maxAbs = Math.max(0.6, ...q.map((v) => Math.abs(n2(v, 0))),
        ...docs.flat().map((v) => Math.abs(n2(v, 0))));
      const proj = (vec) => ({
        x: 200 + (n2(vec[0], 0) / maxAbs) * 92,
        y: 110 - (n2(vec[1] || 0, 0) / maxAbs) * 66,
      });
      const qp = proj(q);
      return (
        <Frame c={c} height={360} title={S('DSSM · 双塔语义匹配（dim=' + dim + '）')}
          subtitle={`${phase} · 第 ${step}/${total} 步`}>
          {txt(20, 44, '语义空间（前两维投影）', c.muted, 10)}
          <rect x="108" y="44" width="184" height="132" rx="4" fill={c.panel} stroke={c.border} strokeWidth="1" />
          <line x1="200" y1="44" x2="200" y2="176" stroke={c.grid} strokeWidth="0.8" />
          <line x1="108" y1="110" x2="292" y2="110" stroke={c.grid} strokeWidth="0.8" />
          {docs.map((d, i) => {
            const dp = proj(d);
            const isPos = i === Number(snap.pos || 0), isNeg = i === neg;
            return (
              <g key={'d' + i}>
                <line x1={qp.x} y1={qp.y} x2={dp.x} y2={dp.y}
                  stroke={isPos ? c.success : isNeg ? c.danger : c.border}
                  strokeWidth={isPos || isNeg ? 1.6 : 0.7}
                  strokeDasharray={isNeg ? '3 3' : undefined} opacity={isPos || isNeg ? 0.9 : 0.5} />
                <circle cx={dp.x} cy={dp.y} r={isPos ? 6 : 4} fill={isPos ? c.success : isNeg ? c.danger : c.purple} />
                {txt(dp.x + 7, dp.y + 3, 'D' + i, c.text, 8)}
              </g>
            );
          })}
          <circle cx={qp.x} cy={qp.y} r="7" fill={c.primary} stroke={c.warning} strokeWidth="1.2" />
          {txt(qp.x + 9, qp.y - 6, 'Q', c.warning, 9)}
          {txt(312, 44, 'Query 塔 / Document 塔', c.muted, 10)}
          {['稀疏特征', 'Dense(' + dim + ')', 'tanh', '余弦打分'].map((label, i) => (
            <g key={'t' + i}>
              <rect x={312 + i * 92} y={60} width="80" height="34" rx="5" fill={i === 3 ? c.warning : c.panel2}
                stroke={c.border} strokeWidth="0.8" opacity="0.9" />
              {txt(352 + i * 92, 81, label, i === 3 ? c.bg : c.text, 9, 'middle')}
              {i < 3 && txt(400 + i * 92, 81, '→', c.accent, 12, 'middle')}
            </g>
          ))}
          {txt(312, 116, '正样本余弦 = ' + f2(snap.cosPos), c.success, 10)}
          {txt(312, 136, '损失下降（margin）', c.muted, 10)}
          {curve(c, lossHist, 314, 150, 380, 76, c.danger)}
          {txt(312, 246, '候选文档余弦排序', c.muted, 10)}
          {ranks.slice(0, 5).map((r, k) => (
            <g key={'rk' + k}>
              {txt(314, 266 + k * 14, 'D' + r.i, k === 0 ? c.success : c.text, 9)}
              {bar(344, 256 + k * 14, 200, 10, Math.max(0, n2(r.s, 0)), 1, k === 0 ? c.success : c.primary, c.panel2)}
              {txt(552, 266 + k * 14, f2(r.s), c.text, 9)}
            </g>
          ))}
          <line x1="20" y1="306" x2="700" y2="306" stroke={c.grid} strokeWidth="1" />
          {txt(20, 322, 'sim(Q,D) = cos(q,d) = q·d / (‖q‖‖d‖)；L = max(0, 1 − cos⁺ + cos⁻)', c.text, 10)}
          {txt(20, 336, '正样本拉近、负样本推远；训练后正样本排名上升到 Top-1。', c.muted, 10)}
          {progress(c, step, total)}
        </Frame>
      );
    },
  },

  // ── 9. GBDT + LR ──────────────────────────────────────────────
  'gbdt-lr': {
    params: [
      { key: 'trees', label: '树的数量', type: 'range', min: 2, max: 5, step: 1, default: 3 },
      { key: 'leaves', label: '每树叶节点数', type: 'range', min: 3, max: 6, step: 1, default: 4 },
      { key: 'samples', label: '样本数', type: 'range', min: 6, max: 12, step: 2, default: 8 },
      { key: 'seed', label: '随机种子', type: 'range', min: 1, max: 30, step: 1, default: 7 },
    ],
    height: 360,
    legend: [
      { color: '#226AFF', label: 'GBDT 树与分裂路径' },
      { color: '#f5a524', label: '当前样本落到的叶子' },
      { color: '#12a06a', label: '叶子 one-hot 拼接' },
      { color: '#7c5cff', label: 'LR 权重 / CTR' },
    ],
    hint: 'GBDT+LR：树模型自动做特征组合与分桶，样本落到各树的叶子编号拼成 one-hot，再交给 LR 线性加权。',
    buildSteps(p) {
      const rnd = mulberry32(n2(p.seed, 7));
      const T = Math.round(clamp(n2(p.trees, 3), 2, 5));
      const leaves = Math.round(clamp(n2(p.leaves, 4), 3, 6));
      const N = Math.round(clamp(n2(p.samples, 8), 6, 12));
      const feat = Array.from({ length: N }, () => [rnd(), rnd()]);
      // 每棵树：随机阈值切分产生 leaves 个叶子区间（按第一维分桶）
      const treeThresh = Array.from({ length: T }, () =>
        Array.from({ length: leaves - 1 }, () => 0.15 + rnd() * 0.7).sort((a, b) => a - b));
      const leafOf = (sample, t) => {
        let l = 0;
        for (const th of treeThresh[t]) if (sample[0] > th) l++;
        return Math.min(leaves - 1, l);
      };
      const dim = T * leaves;
      const w = Array.from({ length: dim }, () => (rnd() - 0.5) * 0.4);
      const sigmoid = (z) => 1 / (1 + Math.exp(-Math.max(-20, Math.min(20, z))));
      const leafVec = (s) => {
        const out = Array.from({ length: dim }, () => 0);
        for (let t = 0; t < T; t++) out[t * leaves + leafOf(feat[s], t)] = 1;
        return out;
      };
      const pred = (s) => {
        const lv = leafVec(s);
        return sigmoid(lv.reduce((acc, v, i) => acc + v * w[i], 0));
      };
      const target = (s) => (feat[s][0] > 0.5 ? 1 : 0);
      const hist = [];
      const steps = [];
      const push = (note, extra, metrics) => steps.push({
        T, leaves, N, dim, feat: feat.map((r) => r.slice()), treeThresh: treeThresh.map((r) => r.slice()),
        w: w.slice(), leafVec: leafVec(extra.sample != null ? extra.sample : 0),
        pred: pred(extra.sample != null ? extra.sample : 0), lossHist: hist.slice(), note, metrics, ...extra,
      });
      push(`初始化：${T} 棵树 × ${leaves} 叶 = ${dim} 维拼接特征，交给 LR 做 CTR 预测。`,
        { phase: 'init', sample: 0, tree: -1 },
        { 树数: T, 每树叶数: leaves, 拼接维度: dim, 样本数: N });
      for (let t = 0; t < T; t++) {
        push(`构建第 ${t + 1} 棵树：按特征阈值把样本分到 ${leaves} 个叶子。`,
          { phase: 'tree', sample: 0, tree: t },
          { 树序号: t + 1, 叶子数: leaves, 分裂阈值: treeThresh[t].length });
      }
      const shown = Math.min(N, 8);
      for (let s = 0; s < shown; s++) {
        for (let t = 0; t < T; t++) {
          const l = leafOf(feat[s], t);
          push(`样本 s${s}（x=${f2(feat[s][0])}）过树 ${t + 1} → 叶子 L${l}，拼接位 [${t * leaves + l}]=1。`,
            { phase: 'path', sample: s, tree: t, leaf: l },
            { 样本: 's' + s, 树序号: t + 1, 叶子: 'L' + l, 拼接维度: dim });
        }
      }
      for (let step = 1; step <= 8; step++) {
        const s = step % shown, lr = 0.05, e = pred(s) - target(s);
        const lv = leafVec(s);
        for (let i = 0; i < dim; i++) if (lv[i]) w[i] -= lr * e;
        hist.push(0.5 * e * e);
        push(`LR 训练第 ${step}/8 步：样本 s${s} 的 CTR=${f2(pred(s))}，损失=${f2(hist[hist.length - 1])}。`,
          { phase: 'lr', sample: s, tree: -1 },
          { 训练步: step, 预测CTR: r2(pred(s)), 损失: r2(hist[hist.length - 1]), 拼接维度: dim });
      }
      push(`完成｜叶子编号拼接成 ${dim} 维特征，LR 学到各叶子的线性权重，输出 CTR。`,
        { phase: 'done', sample: 0, tree: -1 },
        { 预测CTR: r2(pred(0)), 拼接维度: dim, 最终损失: r2(hist.length ? hist[hist.length - 1] : 0) });
      return cap(steps);
    },
    render(snap, p, c) {
      const T = Math.max(1, Math.floor(num(snap.T, 3)));
      const leaves = Math.max(1, Math.floor(num(snap.leaves, 4)));
      const dim = Math.max(1, Math.floor(num(snap.dim, 12)));
      const feat = Array.isArray(snap.feat) ? snap.feat : [];
      const thresholds = Array.isArray(snap.treeThresh) ? snap.treeThresh : [];
      const w = Array.isArray(snap.w) ? snap.w : [];
      const lv = Array.isArray(snap.leafVec) ? snap.leafVec : [];
      const lossHist = Array.isArray(snap.lossHist) ? snap.lossHist : [];
      const phase = S(snap.phase || 'init');
      const step = Math.floor(num(snap.step, 0)), total = Math.floor(num(snap.total, 1));
      const sample = Math.floor(num(snap.sample, 0)), tree = Math.floor(num(snap.tree, -1));
      const leaf = Math.floor(num(snap.leaf, -1));
      return (
        <Frame c={c} height={360} title={S('GBDT + LR · 叶子特征拼接')}
          subtitle={`${phase} · 第 ${step}/${total} 步`}>
          {txt(20, 44, 'GBDT 树集成（' + T + ' 棵，每棵 ' + leaves + ' 叶）', c.muted, 10)}
          {Array.from({ length: T }, (_, t) => {
            const on = tree === t;
            const ths = Array.isArray(thresholds[t]) ? thresholds[t] : [];
            return (
              <g key={'tr' + t}>
                <rect x={20 + t * 160} y={54} width="146" height="118" rx="5"
                  fill={c.panel} stroke={on ? c.warning : c.border} strokeWidth={on ? 1.8 : 0.8} />
                {txt(28 + t * 160, 70, '树 ' + (t + 1), on ? c.warning : c.text, 10)}
                {ths.slice(0, 4).map((th, k) => (
                  <g key={'th' + k}>
                    <line x1={28 + t * 160} y1={84 + k * 16} x2={158 + t * 160} y2={84 + k * 16}
                      stroke={c.grid} strokeWidth="1" />
                    {txt(30 + t * 160, 98 + k * 16, 'x>' + f2(th), c.muted, 8)}
                  </g>
                ))}
                {txt(28 + t * 160, 164, phase === 'path' && on ? '样本 s' + sample + ' → L' + leaf : '叶子 L0…L' + (leaves - 1),
                  on ? c.success : c.muted, 9)}
              </g>
            );
          })}
          {txt(20, 196, '叶子 one-hot 拼接向量（' + dim + ' 维）', c.muted, 10)}
          {lv.slice(0, dim).map((v, i) => (
            <g key={'lv' + i}>
              <rect x={20 + i * 15} y={208} width="12" height="20" rx="2"
                fill={v ? c.success : c.panel2} opacity={v ? 0.9 : 1}
                stroke={v ? c.text : 'none'} strokeWidth={v ? 0.8 : 0} />
              {dim <= 18 && txt(26 + i * 15, 240, String(i), c.muted, 7, 'middle')}
            </g>
          ))}
          {txt(320, 196, 'LR 权重（拼接位 → w）', c.muted, 10)}
          {w.slice(0, Math.min(dim, 14)).map((v, i) => (
            <g key={'lw' + i}>
              {bar(320 + (i % 7) * 50, 208 + Math.floor(i / 7) * 34, 42, 12,
                Math.abs(n2(v, 0)), 0.5, lv[i] ? c.purple : c.border, c.panel2)}
              {txt(341 + (i % 7) * 50, 236 + Math.floor(i / 7) * 34, 'w' + i, c.muted, 8, 'middle')}
            </g>
          ))}
          {txt(650, 196, 'CTR', c.muted, 10)}
          {txt(650, 232, f2(snap.pred), c.success, 16)}
          {txt(650, 256, '损失', c.muted, 9)}
          {txt(650, 274, lossHist.length ? f2(lossHist[lossHist.length - 1]) : '—', c.text, 10)}
          <line x1="20" y1="286" x2="700" y2="286" stroke={c.grid} strokeWidth="1" />
          {txt(20, 304, '样本 x → 各树叶子编号 one-hot → 拼接向量 → p = σ(w·onehot)', c.text, 10)}
          {txt(20, 322, 'GBDT 自动完成分桶与组合，LR 只学叶子权重；树数/叶数越多组合越细。', c.muted, 10)}
          {txt(20, 336, '橙色树 = 当前样本经过的树；绿色格 = 被置 1 的叶子拼接位。', c.muted, 10)}
          {progress(c, step, total)}
        </Frame>
      );
    },
  },

  // ── 10. SASRec 序列推荐 ──────────────────────────────────────
  'sasrec': {
    params: [
      { key: 'seqLen', label: '序列长度 L', type: 'range', min: 4, max: 10, step: 1, default: 6 },
      { key: 'heads', label: '注意力头数', type: 'range', min: 1, max: 4, step: 1, default: 2 },
      { key: 'embDim', label: 'Embedding 维度', type: 'range', min: 4, max: 16, step: 2, default: 8 },
      { key: 'topN', label: '推荐个数 Top-N', type: 'range', min: 3, max: 5, step: 1, default: 3 },
    ],
    height: 360,
    legend: [
      { color: '#226AFF', label: '行为序列 embedding + 位置编码' },
      { color: '#f5a524', label: '当前计算的注意力分数' },
      { color: '#12a06a', label: '下一项 Top-N 预测' },
      { color: '#7c5cff', label: '多头注意力' },
    ],
    hint: 'SASRec 用带因果掩码的自注意力建模用户行为序列，取最后一个位置的表示预测下一个可能交互的物品。',
    buildSteps(p) {
      const rnd = mulberry32(n2(p.seed, 11));
      const L = Math.round(clamp(n2(p.seqLen, 6), 4, 10));
      const H = Math.round(clamp(n2(p.heads, 2), 1, 4));
      const dim = Math.round(clamp(n2(p.embDim, 8), 4, 16));
      const topN = Math.round(clamp(n2(p.topN, 3), 3, 5));
      const seq = Array.from({ length: L }, () => Math.floor(rnd() * 10));
      const emb = Array.from({ length: 10 }, () => Array.from({ length: dim }, () => (rnd() - 0.5) * 0.8));
      const pos = Array.from({ length: L }, (_, i) => Array.from({ length: dim }, (_, t) =>
        Math.sin(i / Math.pow(100, (2 * Math.floor(t / 2)) / dim)) * 0.3));
      const qkv = Array.from({ length: L }, (_, i) =>
        Array.from({ length: dim }, (_, t) => n2(emb[seq[i]][t], 0) + n2(pos[i][t], 0)));
      const scale = Math.sqrt(Math.max(1, dim));
      const attFull = Array.from({ length: L }, () => Array.from({ length: L }, () => 0));
      for (let i = 0; i < L; i++) {
        const logits = Array.from({ length: L }, (_, j) =>
          j <= i ? qkv[i].reduce((s, v, t) => s + v * qkv[j][t], 0) / scale : -1e9);
        const prob = softmax(logits, 1);
        for (let j = 0; j <= i; j++) attFull[i][j] = prob[j];
      }
      const last = Array.from({ length: dim }, (_, t) =>
        attFull[L - 1].reduce((s, a, i) => s + a * n2(emb[seq[i]][t], 0), 0));
      const candScores = Array.from({ length: 10 }, (_, k) =>
        last.reduce((s, v, t) => s + v * emb[k][t], 0));
      const order = Array.from({ length: 10 }, (_, k) => k).sort((a, b) => candScores[b] - candScores[a]);
      const steps = [];
      const push = (note, extra, metrics) => steps.push({
        L, H, dim, topN, seq: seq.slice(), qkv: qkv.map((r) => r.slice()),
        attFull: attFull.map((r) => r.slice()), candScores: candScores.slice(), order: order.slice(),
        note, metrics, ...extra,
      });
      push(`初始化：行为序列长度 L=${L}，${H} 个注意力头，embedding 维度 ${dim}，因果掩码已就绪。`,
        { phase: 'init', cur: null, reveal: 0, posIdx: -1 },
        { 序列长度: L, 注意力头: H, 向量维度: dim, 候选数: 10 });
      for (let i = 0; i < L; i++) {
        push(`位置 ${i}：物品 I${seq[i]} 加上位置编码得到 Q/K/V（第 ${i + 1}/${L} 位）。`,
          { phase: 'pos', cur: null, reveal: i + 1, posIdx: i },
          { 位置: i + 1, 物品: 'I' + seq[i], 序列长度: L });
      }
      for (let i = 0; i < L; i++) for (let j = 0; j <= i; j++) {
        push(`自注意力 score(${i},${j}) = Q${i}·K${j}/√d = ${f2(attFull[i][j])}（j>i 被因果掩码屏蔽）。`,
          { phase: 'att', cur: [i, j], reveal: L, posIdx: i },
          { 查询位置: i, 键位置: j, 注意力: r2(attFull[i][j]), 注意力头: H });
      }
      for (let k = 0; k < 10; k++) {
        const rank = order.indexOf(k);
        push(`下一项候选 I${k}：与末位隐状态点积=${f2(candScores[k])}，当前排名 ${rank + 1}。`,
          { phase: 'predict', cur: null, reveal: k + 1, posIdx: L - 1 },
          { 候选: 'I' + k, 分数: r2(candScores[k]), 排名: rank + 1, 推荐个数: topN });
      }
      push(`完成｜下一项 Top-${topN}：${order.slice(0, topN).map((k) => 'I' + k).join('、')}。`,
        { phase: 'done', cur: null, reveal: 10, posIdx: L - 1 },
        { 下一项Top1: 'I' + order[0], 推荐个数: topN, 序列长度: L });
      return cap(steps);
    },
    render(snap, p, c) {
      const L = Math.max(1, Math.floor(num(snap.L, 6)));
      const seq = Array.isArray(snap.seq) ? snap.seq : [];
      const att = Array.isArray(snap.attFull) ? snap.attFull : [];
      const scores = Array.isArray(snap.candScores) ? snap.candScores : [];
      const order = Array.isArray(snap.order) ? snap.order : [];
      const phase = S(snap.phase || 'init');
      const step = Math.floor(num(snap.step, 0)), total = Math.floor(num(snap.total, 1));
      const cur = Array.isArray(snap.cur) ? snap.cur : null;
      const reveal = Math.floor(num(snap.reveal, 0));
      const posIdx = Math.floor(num(snap.posIdx, -1));
      const topN = Math.floor(num(snap.topN, 3));
      const maxScore = Math.max(0.01, ...scores.map((v) => Math.abs(n2(v, 0))));
      return (
        <Frame c={c} height={360}
          title={S('SASRec · 自注意力序列推荐（头=' + num(snap.H, 2) + '）')}
          subtitle={`${phase} · 第 ${step}/${total} 步`}>
          {txt(20, 44, '行为序列（物品 + 位置编码）', c.muted, 10)}
          {seq.slice(0, L).map((item, i) => (
            <g key={'s' + i}>
              <rect x={20 + i * 30} y={54} width="24" height="24" rx="3"
                fill={i === posIdx ? c.warning : c.primary}
                opacity={i === posIdx ? 0.95 : 0.35 + 0.5 * (i / Math.max(1, L - 1))} />
              {txt(32 + i * 30, 70, 'I' + item, i === posIdx ? c.bg : c.text, 8, 'middle')}
              {txt(32 + i * 30, 90, 'pos' + i, c.muted, 8, 'middle')}
            </g>
          ))}
          {txt(20, 116, '因果注意力矩阵（行=Query，列=Key）', c.muted, 10)}
          {att.slice(0, L).map((row, i) => (
            <g key={'ar' + i}>
              {txt(58, 134 + i * 17, String(i), c.muted, 8, 'end')}
              {row.slice(0, L).map((v, j) => {
                const masked = j > i;
                const isCur = cur && cur[0] === i && cur[1] === j;
                const shown = phase === 'done' || phase === 'predict' || phase === 'pos' || i < reveal;
                return (
                  <g key={'ac' + j}>
                    <rect x={64 + j * 18} y={122 + i * 17} width="15" height="14" rx="2"
                      fill={masked ? c.panel2 : c.purple}
                      opacity={isCur ? 0.95 : masked ? 0.5 : shown ? 0.15 + 0.7 * n2(v, 0) : 0.1} />
                    {isCur && <rect x={64 + j * 18} y={122 + i * 17} width="15" height="14" rx="2"
                      fill="none" stroke={c.warning} strokeWidth="1.2" />}
                  </g>
                );
              })}
            </g>
          ))}
          {txt(20, 240, '末位隐状态 → 下一项打分', c.muted, 10)}
          {txt(20, 258, 'h_last = Σⱼ att[L−1,j]·vⱼ；score(k) = h_last · emb(k)', c.text, 9)}
          {txt(300, 44, '下一项候选打分（Top-' + topN + ' 高亮）', c.muted, 10)}
          {scores.slice(0, 10).map((v, k) => {
            const rank = order.indexOf(k);
            const shown = phase === 'done' || k < reveal;
            return (
              <g key={'c' + k}>
                {txt(300, 68 + k * 22, 'I' + k, rank < topN ? c.success : c.muted, 9)}
                {bar(326, 58 + k * 22, 160, 12, shown ? Math.max(0, n2(v, 0)) / maxScore : 0, 1,
                  rank < topN ? c.success : c.primary, c.panel2)}
                {txt(494, 68 + k * 22, shown ? f2(v) : '—', c.text, 9)}
                {shown && rank < topN && txt(516, 68 + k * 22, '★' + (rank + 1), c.success, 9)}
              </g>
            );
          })}
          {txt(300, 296, '预测 Top-N：' + (phase === 'done' ? order.slice(0, topN).map((k) => 'I' + k).join('、') : '计算中…'), c.success, 10)}
          <line x1="20" y1="306" x2="700" y2="306" stroke={c.grid} strokeWidth="1" />
          {txt(20, 322, 'Attention(Q,K,V) = softmax(QKᵀ/√d + mask)·V，mask 屏蔽未来位置。', c.text, 10)}
          {txt(20, 336, '多头注意力从不同子空间建模；末位表示用于预测下一次交互。', c.muted, 10)}
          {progress(c, step, total)}
        </Frame>
      );
    },
  },

  // ── 11. 多路召回 ─────────────────────────────────────────────
  'multi-recall': {
    params: [
      { key: 'perChannel', label: '每路候选数', type: 'range', min: 3, max: 6, step: 1, default: 4 },
      {
        key: 'channels', label: '召回通道', type: 'select', default: 'cf+vec+hot+rule',
        options: [
          { value: 'cf+hot', label: '协同 + 热门' },
          { value: 'cf+vec+hot', label: '协同 + 向量 + 热门' },
          { value: 'cf+vec+hot+rule', label: '协同 + 向量 + 热门 + 规则' },
        ],
      },
      { key: 'dedup', label: '合并去重', type: 'toggle', default: true },
      { key: 'seed', label: '随机种子', type: 'range', min: 1, max: 30, step: 1, default: 7 },
    ],
    height: 360,
    legend: [
      { color: '#226AFF', label: '各路候选' },
      { color: '#f5a524', label: '当前处理候选 / 重复项' },
      { color: '#12a06a', label: '去重后最终候选' },
      { color: '#e5484d', label: '被去重丢弃' },
    ],
    hint: '多路召回：协同、向量、热门、规则等并行产出候选，再合并去重、按分数排序，兼顾覆盖率与去重。',
    buildSteps(p) {
      const rnd = mulberry32(n2(p.seed, 7));
      const per = Math.round(clamp(n2(p.perChannel, 4), 3, 6));
      const dedup = !!p.dedup;
      const channels = String(p.channels || 'cf+vec+hot+rule').split('+').filter(Boolean);
      const M = 10;
      const hotOrder = Array.from({ length: M }, (_, i) => i).sort(() => rnd() - 0.5);
      const vecScore = Array.from({ length: M }, () => rnd());
      const relevant = new Set([Math.floor(rnd() * M), Math.floor(rnd() * M), Math.floor(rnd() * M)]);
      const routes = channels.map((name) => {
        let cand;
        if (name === 'hot') cand = hotOrder.slice(0, per);
        else if (name === 'vec') cand = Array.from({ length: M }, (_, i) => i)
          .sort((a, b) => vecScore[b] - vecScore[a]).slice(0, per);
        else if (name === 'rule') cand = Array.from({ length: per }, () => Math.floor(rnd() * M));
        else cand = Array.from({ length: per }, () => Math.floor(rnd() * M));
        const uniq = [];
        cand.forEach((v) => { if (!uniq.includes(v)) uniq.push(v); });
        return { name, cand: uniq };
      });
      const merged = [];
      routes.forEach((route) => route.cand.forEach((id) => {
        if (!dedup || !merged.some((m) => m.id === id)) merged.push({ id, from: route.name });
      }));
      const finalOrder = merged.slice().sort((a, b) => vecScore[b] - vecScore[a]);
      const hits = [...new Set(merged.map((m) => m.id))].filter((id) => relevant.has(id)).length;
      const recall = hits / Math.max(1, relevant.size);
      const steps = [];
      const push = (note, extra, metrics) => steps.push({
        per, channels: channels.slice(), dedup, routes: routes.map((r) => ({ name: r.name, cand: r.cand.slice() })),
        merged: merged.slice(), finalOrder: finalOrder.slice(), relevant: Array.from(relevant), recall,
        note, metrics, ...extra,
      });
      push(`初始化：${channels.length} 路召回并行开启，每路最多 ${per} 个候选，物品池 ${M} 个。`,
        { phase: 'init', route: -1, cand: -1, reveal: 0 },
        { 召回路数: channels.length, 每路候选: per, 候选池: M });
      routes.forEach((route, ri) => {
        push(`通道 ${route.name} 召回 ${route.cand.length} 个候选：${route.cand.map((v) => 'I' + v).join('、')}。`,
          { phase: 'route', route: ri, cand: -1, reveal: 0 },
          { 通道: route.name, 候选数: route.cand.length, 召回路数: channels.length });
        route.cand.forEach((id, ci) => {
          const dup = merged.filter((m) => m.id === id).length > 1;
          push(`${route.name} → I${id}${dup ? '（重复候选）' : ''}。`,
            { phase: 'cand', route: ri, cand: ci, reveal: ci + 1, item: id },
            { 候选: 'I' + id, 来源: route.name, 重复: dup ? 1 : 0 });
        });
      });
      merged.forEach((m, i) => {
        push(`合并去重：第 ${i + 1}/${merged.length} 项 I${m.id}（来自 ${m.from}）${dedup ? '已去重' : '保留重复'}。`,
          { phase: 'merge', route: -1, cand: i, reveal: i + 1, item: m.id },
          { 合并项: i + 1, 去重后候选数: dedup ? new Set(merged.slice(0, i + 1).map((x) => x.id)).size : merged.length });
      });
      for (let k = 0; k < Math.min(6, finalOrder.length); k++) {
        push(`按向量分排序：第 ${k + 1} 名 I${finalOrder[k].id}（${f2(vecScore[finalOrder[k].id])}）。`,
          { phase: 'sort', route: -1, cand: k, reveal: k + 1, item: finalOrder[k].id },
          { 已排序: k + 1, 召回率: r2(recall), 候选数: merged.length });
      }
      push(`完成｜合并 ${merged.length} 个候选，去重后 ${new Set(merged.map((m) => m.id)).size} 个，召回率=${f2(recall)}。`,
        { phase: 'done', route: -1, cand: -1, reveal: merged.length },
        { 召回率: r2(recall), 候选数: new Set(merged.map((m) => m.id)).size, 召回路数: channels.length });
      return cap(steps);
    },
    render(snap, p, c) {
      const routes = Array.isArray(snap.routes) ? snap.routes : [];
      const merged = Array.isArray(snap.merged) ? snap.merged : [];
      const finalOrder = Array.isArray(snap.finalOrder) ? snap.finalOrder : [];
      const relevant = Array.isArray(snap.relevant) ? snap.relevant : [];
      const phase = S(snap.phase || 'init');
      const step = Math.floor(num(snap.step, 0)), total = Math.floor(num(snap.total, 1));
      const route = Math.floor(num(snap.route, -1)), cand = Math.floor(num(snap.cand, -1));
      const reveal = Math.floor(num(snap.reveal, 0));
      const item = Math.floor(num(snap.item, -1));
      return (
        <Frame c={c} height={360}
          title={S('多路召回 · ' + routes.length + ' 路并行合并去重')}
          subtitle={`${phase} · 第 ${step}/${total} 步`}>
          {txt(20, 44, '各路候选（橙色=当前路）', c.muted, 10)}
          {routes.map((r, ri) => (
            <g key={'r' + ri}>
              {txt(20, 68 + ri * 34, r.name, ri === route ? c.warning : c.muted, 9)}
              {r.cand.slice(0, 6).map((id, ci) => (
                <g key={'rc' + ci}>
                  <rect x={70 + ci * 26} y={56 + ri * 34} width="22" height="18" rx="3"
                    fill={ri === route ? c.warning : c.primary}
                    opacity={ri === route ? 0.9 : 0.3} />
                  {txt(81 + ci * 26, 69 + ri * 34, 'I' + id, ri === route ? c.bg : c.text, 8, 'middle')}
                </g>
              ))}
            </g>
          ))}
          {txt(20, 212, '合并去重候选（绿色=最终，红色=重复）', c.muted, 10)}
          {merged.slice(0, 24).map((m, i) => {
            const first = merged.findIndex((x) => x.id === m.id) === i;
            const dup = !snap.dedup || first;
            const shown = phase === 'done' || phase === 'sort' || i < reveal;
            return (
              <g key={'m' + i}>
                <rect x={20 + i * 28} y={224} width="24" height="22" rx="3"
                  fill={shown ? (dup ? c.success : c.danger) : c.panel2}
                  opacity={shown ? 0.85 : 0.5} />
                {txt(32 + i * 28, 239, 'I' + m.id, shown ? c.bg : c.muted, 8, 'middle')}
              </g>
            );
          })}
          {txt(20, 270, '去重后候选数：' + new Set(merged.map((m) => m.id)).size + '　原始候选数：' + merged.length, c.text, 10)}
          {txt(240, 44, '最终排序（按向量分）', c.muted, 10)}
          {finalOrder.slice(0, 6).map((m, k) => (
            <g key={'f' + k}>
              {txt(240, 70 + k * 26, k + 1 + '. I' + m.id,
                relevant.includes(m.id) ? c.success : c.text, 10)}
              {txt(340, 70 + k * 26, '来自 ' + m.from, c.muted, 9)}
            </g>
          ))}
          {txt(240, 246, '召回率 = 命中相关物品 / 相关物品总数', c.muted, 9)}
          {txt(240, 268, '召回率 = ' + f2(snap.recall), c.success, 14)}
          {txt(240, 288, '绿色标记 = 命中相关物品', c.muted, 9)}
          <line x1="20" y1="306" x2="700" y2="306" stroke={c.grid} strokeWidth="1" />
          {txt(20, 322, '多路并行召回 → 合并去重 → 按分数截断；多路互补提升覆盖率与召回率。', c.text, 10)}
          {txt(20, 336, '去重开关关闭时重复候选被保留，可对比覆盖率与候选数变化。', c.muted, 10)}
          {progress(c, step, total)}
        </Frame>
      );
    },
  },

  // ── 12. DPP 多样性重排 ───────────────────────────────────────
  'dpp-rerank': {
    params: [
      { key: 'nItems', label: '候选物品数', type: 'range', min: 6, max: 10, step: 1, default: 8 },
      { key: 'topK', label: '重排选出个数', type: 'range', min: 3, max: 6, step: 1, default: 4 },
      { key: 'diversity', label: '多样性权重', type: 'range', min: 0.1, max: 0.9, step: 0.1, default: 0.5 },
      { key: 'seed', label: '随机种子', type: 'range', min: 1, max: 30, step: 1, default: 7 },
    ],
    height: 360,
    legend: [
      { color: '#226AFF', label: 'DPP 核矩阵 L' },
      { color: '#f5a524', label: '当前边际增益' },
      { color: '#12a06a', label: '已选入子集' },
      { color: '#e5484d', label: '与已选高度相似' },
    ],
    hint: 'DPP 用核矩阵行列式衡量集合的整体质量与多样性，贪心每次选边际增益最大者，平衡相关性与多样性。',
    buildSteps(p) {
      const rnd = mulberry32(n2(p.seed, 7));
      const N = Math.round(clamp(n2(p.nItems, 8), 6, 10));
      const K = Math.round(clamp(n2(p.topK, 4), 3, 6));
      const div = clamp(n2(p.diversity, 0.5), 0.1, 0.9);
      const q = Array.from({ length: N }, () => 0.35 + rnd() * 0.65);
      const cat = Array.from({ length: N }, () => Math.floor(rnd() * 3));
      const S = Array.from({ length: N }, (_, i) => Array.from({ length: N }, (_, j) => {
        if (i === j) return 1;
        const base = cat[i] === cat[j] ? 0.82 : 0.22;
        return clamp(base + (rnd() - 0.5) * 0.12, 0, 1);
      }));
      const Lmat = Array.from({ length: N }, (_, i) => Array.from({ length: N }, (_, j) =>
        q[i] * q[j] * (1 - div * (1 - S[i][j]))));
      const subDet = (idx) => det(idx.map((i) => idx.map((j) => n2(Lmat[i][j], 0))));
      const chosen = [];
      let curDet = 1;
      const gains = () => Array.from({ length: N }, (_, i) => {
        if (chosen.includes(i)) return -1;
        const d = subDet(chosen.concat([i]));
        return d >= 0 ? d / Math.max(1e-9, curDet) : 0;
      });
      const steps = [];
      const push = (note, extra, metrics) => steps.push({
        N, K, div, q: q.slice(), cat: cat.slice(), S: S.map((r) => r.slice()),
        L: Lmat.map((r) => r.slice()), chosen: chosen.slice(),
        gains: gains(), det: curDet, note, metrics, ...extra,
      });
      push(`初始化：${N} 个候选、选 ${K} 个，多样性权重=${f2(div)}；核 L=diag(q)·S·diag(q)。`,
        { phase: 'init', cell: null, stepK: 0, pick: -1 },
        { 候选数: N, 选出数: K, 多样性: r2(div) });
      for (let i = 0; i < Math.min(N, 7); i++) for (let j = 0; j < Math.min(N, 7); j++) {
        push(`核矩阵 L[${i},${j}] = q${i}·q${j}·(1−${f2(div)}(1−S${i}${j})) = ${f2(Lmat[i][j])}。`,
          { phase: 'kernel', cell: [i, j], stepK: 0, pick: -1 },
          { 行: i, 列: j, 核值: r2(Lmat[i][j]), 相似度: r2(S[i][j]) });
      }
      for (let k = 0; k < K; k++) {
        const g = gains();
        const best = g.indexOf(Math.max(...g));
        chosen.push(best);
        const newDet = subDet(chosen);
        curDet = Number.isFinite(newDet) && newDet > 0 ? newDet : Math.max(1e-9, curDet);
        push(`第 ${k + 1}/${K} 轮：选 I${best}，边际增益=${f2(g[best])}，det 从 ${f2(curDet / Math.max(1e-9, g[best]))} 更新为 ${f2(curDet)}。`,
          { phase: 'select', cell: null, stepK: k + 1, pick: best },
          { 已选数: k + 1, 行列式: r2(curDet), 边际增益: r2(g[best]), 候选数: N });
      }
      const avgQ = chosen.reduce((s, i) => s + q[i], 0) / Math.max(1, chosen.length);
      const avgSim = chosen.length > 1
        ? chosen.slice(1).reduce((s, i, k) => s + chosen.slice(0, k + 1).reduce((a, j) => a + S[i][j], 0) / (k + 1), 0) / (chosen.length - 1)
        : 0;
      push(`完成｜选出 ${chosen.map((i) => 'I' + i).join('、')}，平均相关性=${f2(avgQ)}，平均相似度=${f2(avgSim)}。`,
        { phase: 'done', cell: null, stepK: K, pick: -1 },
        { 平均相关性: r2(avgQ), 平均相似度: r2(avgSim), 已选数: chosen.length });
      return cap(steps);
    },
    render(snap, p, c) {
      const N = Math.max(1, Math.floor(num(snap.N, 8)));
      const Lmat = Array.isArray(snap.L) ? snap.L : [];
      const gains = Array.isArray(snap.gains) ? snap.gains : [];
      const chosen = Array.isArray(snap.chosen) ? snap.chosen : [];
      const cat = Array.isArray(snap.cat) ? snap.cat : [];
      const phase = S(snap.phase || 'init');
      const step = Math.floor(num(snap.step, 0)), total = Math.floor(num(snap.total, 1));
      const cell = Array.isArray(snap.cell) ? snap.cell : null;
      const pick = Math.floor(num(snap.pick, -1));
      const stepK = Math.floor(num(snap.stepK, 0));
      const maxGain = Math.max(0.01, ...gains.map((v) => n2(v, 0)));
      return (
        <Frame c={c} height={360} title={S('DPP 重排 · 相关性与多样性权衡')}
          subtitle={`${phase} · 第 ${step}/${total} 步`}>
          {txt(20, 44, 'DPP 核矩阵 L（绿框=已选入）', c.muted, 10)}
          {Lmat.slice(0, N).map((row, i) => (
            <g key={'lr' + i}>
              {txt(38, 64 + i * 24, 'I' + i, chosen.includes(i) ? c.success : c.muted, 8, 'end')}
              {row.slice(0, N).map((v, j) => {
                const isCur = cell && cell[0] === i && cell[1] === j;
                const inChosen = chosen.includes(i) && chosen.includes(j);
                return (
                  <g key={'lc' + j}>
                    <rect x={44 + j * 24} y={52 + i * 24} width="20" height="19" rx="2"
                      fill={c.primary} opacity={isCur ? 0.95 : 0.08 + 0.55 * Math.min(1, Math.abs(n2(v, 0)))}
                      stroke={inChosen ? c.success : isCur ? c.warning : 'none'}
                      strokeWidth={inChosen || isCur ? 1.2 : 0} />
                    {N <= 8 && txt(54 + j * 24, 65 + i * 24, f2(v), isCur ? c.bg : c.text, 7, 'middle')}
                  </g>
                );
              })}
            </g>
          ))}
          {txt(250, 44, '边际增益 det(L_A∪i)/det(L_A)', c.muted, 10)}
          {gains.slice(0, N).map((v, i) => {
            const val = Math.max(0, n2(v, 0));
            return (
              <g key={'g' + i}>
                {txt(250, 68 + i * 22, 'I' + i + '[类' + num(cat[i], 0) + ']', c.muted, 9)}
                {bar(310, 58 + i * 22, 170, 12, val / maxGain, 1,
                  i === pick ? c.warning : chosen.includes(i) ? c.success : c.primary, c.panel2)}
                {txt(488, 68 + i * 22, f2(val), c.text, 9)}
              </g>
            );
          })}
          {txt(250, 290, '已选（' + stepK + '/' + num(snap.K, 4) + '）：' +
            (chosen.length ? chosen.map((i) => 'I' + i).join('、') : '尚未选择'), c.success, 10)}
          <line x1="20" y1="306" x2="700" y2="306" stroke={c.grid} strokeWidth="1" />
          {txt(20, 322, 'L = diag(q)·S·diag(q)，det(L_A) 同时奖励高相关 q 与低相似 S（多样性）。', c.text, 10)}
          {txt(20, 336, '贪心每轮选边际增益最大者；多样性权重越大，越倾向选不同类别的物品。', c.muted, 10)}
          {progress(c, step, total)}
        </Frame>
      );
    },
  },

  // ── 13. 学习排序 LTR ─────────────────────────────────────────
  'learning-to-rank': {
    params: [
      {
        key: 'method', label: '损失类型', type: 'select', default: 'pairwise',
        options: [
          { value: 'pointwise', label: 'Pointwise（点级）' },
          { value: 'pairwise', label: 'Pairwise（对级）' },
          { value: 'listwise', label: 'Listwise（列表级）' },
        ],
      },
      { key: 'nDocs', label: '文档数', type: 'range', min: 5, max: 10, step: 1, default: 7 },
      { key: 'epochs', label: '训练轮数', type: 'range', min: 4, max: 10, step: 1, default: 5 },
      { key: 'lr', label: '学习率', type: 'range', min: 0.01, max: 0.1, step: 0.01, default: 0.05 },
    ],
    height: 360,
    legend: [
      { color: '#226AFF', label: '文档相关性标签 / 得分' },
      { color: '#f5a524', label: '当前优化文档' },
      { color: '#12a06a', label: 'NDCG@3' },
      { color: '#e5484d', label: '损失下降' },
    ],
    hint: '学习排序按打分对象分点级、对级、列表级三类损失，直接优化排序质量并用 NDCG 评估。',
    buildSteps(p) {
      const rnd = mulberry32(n2(p.seed, 7));
      const M = Math.round(clamp(n2(p.nDocs, 7), 5, 10));
      const E = Math.round(clamp(n2(p.epochs, 5), 4, 10));
      const lr = clamp(n2(p.lr, 0.05), 0.01, 0.1);
      const method = S(p.method || 'pairwise');
      const feat = Array.from({ length: M }, () => [rnd(), rnd()]);
      const rel = Array.from({ length: M }, () => Math.floor(rnd() * 4));
      let w = [(rnd() - 0.5) * 0.3, (rnd() - 0.5) * 0.3];
      const score = (i) => w[0] * feat[i][0] + w[1] * feat[i][1];
      const dcg = (order) => order.slice(0, 3).reduce((s, i, k) => s + rel[i] / Math.log2(k + 2), 0);
      const ndcg = () => {
        const predOrder = Array.from({ length: M }, (_, i) => i).sort((a, b) => score(b) - score(a));
        const ideal = Array.from({ length: M }, (_, i) => i).sort((a, b) => rel[b] - rel[a]);
        return dcg(predOrder) / Math.max(1e-9, dcg(ideal));
      };
      const hist = [];
      const steps = [];
      const push = (note, extra, metrics) => steps.push({
        M, E, lr, method, feat: feat.map((r) => r.slice()), rel: rel.slice(), w: w.slice(),
        scores: Array.from({ length: M }, (_, i) => score(i)),
        order: Array.from({ length: M }, (_, i) => i).sort((a, b) => score(b) - score(a)),
        ndcg: ndcg(), lossHist: hist.slice(), note, metrics, ...extra,
      });
      push(`初始化：${M} 篇文档，损失类型=${method}，初始 NDCG@3=${f2(ndcg())}。`,
        { phase: 'init', cur: -1, ep: 0 },
        { 文档数: M, 轮数: E, 方法: method, NDCG: r2(ndcg()) });
      for (let ep = 1; ep <= E; ep++) {
        for (let i = 0; i < M; i++) {
          let loss = 0;
          if (method === 'pointwise') {
            const e = score(i) - rel[i];
            w[0] -= lr * e * feat[i][0]; w[1] -= lr * e * feat[i][1];
            loss = 0.5 * e * e;
          } else if (method === 'pairwise') {
            const j = (i + 1) % M;
            if (rel[i] !== rel[j]) {
              const s = rel[i] > rel[j] ? 1 : -1;
              const d = (score(i) - score(j)) * s;
              const g = -s / (1 + Math.exp(Math.max(-20, Math.min(20, d))));
              w[0] -= lr * g * (feat[i][0] - feat[j][0]);
              w[1] -= lr * g * (feat[i][1] - feat[j][1]);
              loss = Math.log(1 + Math.exp(-Math.max(-20, Math.min(20, d))));
            }
          } else {
            const ex = feat[i].map((v, t) => Math.exp(v * 2));
            const sm = ex[0] / (ex[0] + ex[1]);
            w[0] -= lr * (sm - rel[i] / 4) * feat[i][0];
            w[1] -= lr * (1 - sm - (1 - rel[i] / 4)) * feat[i][1];
            loss = -(rel[i] / 4) * Math.log(Math.max(1e-9, sm));
          }
          hist.push(loss);
          push(`第 ${ep}/${E} 轮 · 文档 d${i}（相关${rel[i]}）：score=${f2(score(i))}，损失=${f2(loss)}，NDCG=${f2(ndcg())}。`,
            { phase: 'train', cur: i, ep },
            { 轮次: ep, 文档: 'd' + i, 相关性: rel[i], 损失: r2(loss), NDCG: r2(ndcg()) });
        }
        push(`第 ${ep} 轮结束：NDCG@3=${f2(ndcg())}，w=[${f2(w[0])}, ${f2(w[1])}]。`,
          { phase: 'epoch', cur: -1, ep },
          { 轮次: ep, NDCG: r2(ndcg()), 损失: r2(hist.length ? hist[hist.length - 1] : 0) });
      }
      push(`完成｜${method} 损失训练 ${E} 轮，NDCG@3 从 ${f2(hist.length ? 0 : 0)} 提升到 ${f2(ndcg())}。`,
        { phase: 'done', cur: -1, ep: E },
        { NDCG: r2(ndcg()), 方法: method, 轮数: E });
      return cap(steps);
    },
    render(snap, p, c) {
      const M = Math.max(1, Math.floor(num(snap.M, 7)));
      const rel = Array.isArray(snap.rel) ? snap.rel : [];
      const scores = Array.isArray(snap.scores) ? snap.scores : [];
      const order = Array.isArray(snap.order) ? snap.order : [];
      const hist = Array.isArray(snap.lossHist) ? snap.lossHist : [];
      const method = S(snap.method || 'pairwise');
      const phase = S(snap.phase || 'init');
      const step = Math.floor(num(snap.step, 0)), total = Math.floor(num(snap.total, 1));
      const cur = Math.floor(num(snap.cur, -1));
      const maxScore = Math.max(0.01, ...scores.map((v) => Math.abs(n2(v, 0))));
      const formula = method === 'pointwise' ? 'L=(s−rel)²' : method === 'pairwise'
        ? 'L=log(1+e^{−(sᵢ−sⱼ)})' : 'L=−Σ yᵢ log softmax(sᵢ)';
      return (
        <Frame c={c} height={360} title={S('学习排序 LTR · ' + method)}
          subtitle={`${phase} · 第 ${step}/${total} 步`}>
          {txt(20, 44, '文档列表（相关性标签 → 当前得分）', c.muted, 10)}
          {Array.from({ length: M }, (_, i) => (
            <g key={'d' + i}>
              {txt(20, 68 + i * 22, 'd' + i + '(rel' + num(rel[i], 0) + ')',
                i === cur ? c.warning : c.muted, 9)}
              {bar(92, 58 + i * 22, 160, 12, Math.abs(n2(scores[i], 0)) / maxScore, 1,
                i === cur ? c.warning : c.primary, c.panel2)}
              {txt(260, 68 + i * 22, f2(scores[i]), c.text, 9)}
            </g>
          ))}
          {txt(300, 44, '排序结果（按得分降序）', c.muted, 10)}
          {order.slice(0, 6).map((i, k) => (
            <g key={'o' + k}>
              {txt(300, 70 + k * 26, (k + 1) + '. d' + i + ' rel' + num(rel[i], 0),
                k < 3 ? c.success : c.text, 10)}
            </g>
          ))}
          {txt(300, 248, 'NDCG@3 = ' + f2(snap.ndcg), c.success, 14)}
          {txt(520, 44, '损失下降（' + method + '）', c.muted, 10)}
          {curve(c, hist, 522, 60, 170, 76, c.danger)}
          {txt(520, 156, '优化目标：' + formula, c.text, 10)}
          {txt(520, 180, 'Pointwise：单文档打分回归/分类', c.muted, 9)}
          {txt(520, 198, 'Pairwise：比较文档对先后次序', c.muted, 9)}
          {txt(520, 216, 'Listwise：直接优化整个列表指标', c.muted, 9)}
          <line x1="20" y1="286" x2="700" y2="286" stroke={c.grid} strokeWidth="1" />
          {txt(20, 304, 'NDCG@3 = DCG@3 / IDCG@3，DCG@3 = Σ relᵢ / log₂(i+1)（i 从 1 计）。', c.text, 10)}
          {txt(20, 322, '损失类别决定梯度来源：点级看单文档、对级看文档对、列表级看整体排序。', c.muted, 10)}
          {txt(20, 336, '橙色 = 当前参与梯度计算的文档；绿色 = 当前 Top-3。', c.muted, 10)}
          {progress(c, step, total)}
        </Frame>
      );
    },
  },

  // ── 14. LambdaMART ───────────────────────────────────────────
  'lambdamart': {
    params: [
      { key: 'trees', label: '树的数量', type: 'range', min: 4, max: 10, step: 1, default: 6 },
      { key: 'leaves', label: '每树叶节点数', type: 'range', min: 3, max: 6, step: 1, default: 4 },
      { key: 'nDocs', label: '文档数', type: 'range', min: 5, max: 10, step: 1, default: 7 },
      { key: 'seed', label: '随机种子', type: 'range', min: 1, max: 30, step: 1, default: 7 },
    ],
    height: 360,
    legend: [
      { color: '#226AFF', label: '文档特征 / 相关性' },
      { color: '#f5a524', label: '当前 Lambda 梯度' },
      { color: '#12a06a', label: 'NDCG@3 上升' },
      { color: '#7c5cff', label: 'GBDT 回归树' },
    ],
    hint: 'LambdaMART 把 NDCG 的 pairwise 梯度近似为 lambda，再用 GBDT 拟合这些梯度，逐步提升排序 NDCG。',
    buildSteps(p) {
      const rnd = mulberry32(n2(p.seed, 7));
      const T = Math.round(clamp(n2(p.trees, 6), 4, 10));
      const leaves = Math.round(clamp(n2(p.leaves, 4), 3, 6));
      const M = Math.round(clamp(n2(p.nDocs, 7), 5, 10));
      const rel = Array.from({ length: M }, () => Math.floor(rnd() * 4));
      const feat = Array.from({ length: M }, () => rnd());
      const score = Array.from({ length: M }, () => 0);
      const dcgAt = (ord) => ord.slice(0, 3).reduce((s, i, k) => s + rel[i] / Math.log2(k + 2), 0);
      const ndcg = () => {
        const p = Array.from({ length: M }, (_, i) => i).sort((a, b) => score[b] - score[a]);
        const id = Array.from({ length: M }, (_, i) => i).sort((a, b) => rel[b] - rel[a]);
        return dcgAt(p) / Math.max(1e-9, dcgAt(id));
      };
      const lambdaOf = (i) => {
        let sum = 0;
        for (let j = 0; j < M; j++) {
          if (i === j || rel[i] === rel[j]) continue;
          const s = rel[i] > rel[j] ? 1 : -1;
          const delta = Math.abs(rel[i] - rel[j]) * Math.log2(Math.max(2, i + 2)) / Math.log2(Math.max(2, j + 2));
          const d = Math.max(-20, Math.min(20, score[i] - score[j]));
          sum += s * delta / (1 + Math.exp(d));
        }
        return sum;
      };
      const ndcgHist = [];
      const steps = [];
      const push = (note, extra, metrics) => steps.push({
        T, leaves, M, rel: rel.slice(), feat: feat.slice(), score: score.slice(),
        lambdas: Array.from({ length: M }, (_, i) => lambdaOf(i)),
        ndcg: ndcg(), ndcgHist: ndcgHist.slice(), note, metrics, ...extra,
      });
      push(`初始化：${M} 篇文档，用 ${T} 棵回归树拟合 NDCG 梯度（lambda）。`,
        { phase: 'init', cur: -1, tree: -1 },
        { 树数: T, 文档数: M, NDCG: r2(ndcg()), 叶子数: leaves });
      for (let t = 0; t < T; t++) {
        const lam = Array.from({ length: M }, (_, i) => lambdaOf(i));
        const order = Array.from({ length: M }, (_, i) => i).sort((a, b) => feat[a] - feat[b]);
        const leafOf = (i) => Math.min(leaves - 1, Math.floor(
          (feat[i] * leaves) % leaves));
        const leafVal = Array.from({ length: leaves }, () => 0);
        const leafCnt = Array.from({ length: leaves }, () => 0);
        order.forEach((i) => { const l = leafOf(i); leafVal[l] += lam[i]; leafCnt[l]++; });
        for (let l = 0; l < leaves; l++) leafVal[l] /= Math.max(1, leafCnt[l]);
        for (let i = 0; i < M; i++) {
          push(`树 ${t + 1} · 文档 d${i}（rel${rel[i]}）的 lambda=${f2(lam[i])}，落入叶子 L${leafOf(i)}。`,
            { phase: 'lambda', cur: i, tree: t, lambdas: lam.slice(), leafOf },
            { 树序号: t + 1, 文档: 'd' + i, Lambda: r2(lam[i]), 叶子: 'L' + leafOf(i) });
        }
        for (let i = 0; i < M; i++) score[i] += 0.12 * leafVal[leafOf(i)];
        ndcgHist.push(ndcg());
        push(`树 ${t + 1} 完成：用叶子均值更新 score，NDCG@3=${f2(ndcg())}。`,
          { phase: 'tree', cur: -1, tree: t, lambdas: lam.slice(), leafOf },
          { 树序号: t + 1, NDCG: r2(ndcg()), 叶子数: leaves });
      }
      push(`完成｜${T} 棵树后 NDCG@3=${f2(ndcg())}，pairwise 梯度被 lambda 近似并拟合。`,
        { phase: 'done', cur: -1, tree: T - 1, lambdas: Array.from({ length: M }, (_, i) => lambdaOf(i)) },
        { NDCG: r2(ndcg()), 树数: T, 文档数: M });
      return cap(steps);
    },
    render(snap, p, c) {
      const M = Math.max(1, Math.floor(num(snap.M, 7)));
      const rel = Array.isArray(snap.rel) ? snap.rel : [];
      const score = Array.isArray(snap.score) ? snap.score : [];
      const lam = Array.isArray(snap.lambdas) ? snap.lambdas : [];
      const ndcgHist = Array.isArray(snap.ndcgHist) ? snap.ndcgHist : [];
      const phase = S(snap.phase || 'init');
      const step = Math.floor(num(snap.step, 0)), total = Math.floor(num(snap.total, 1));
      const cur = Math.floor(num(snap.cur, -1)), tree = Math.floor(num(snap.tree, -1));
      const maxLam = Math.max(0.01, ...lam.map((v) => Math.abs(n2(v, 0))));
      const leafOf = snap.leafOf || {};
      return (
        <Frame c={c} height={360} title={S('LambdaMART · NDCG 梯度近似')}
          subtitle={`${phase} · 第 ${step}/${total} 步 · 树 ${tree + 1}`}>
          {txt(20, 44, '文档 Lambda 梯度（正=应上升，负=应下降）', c.muted, 10)}
          {Array.from({ length: M }, (_, i) => {
            const v = n2(lam[i], 0);
            return (
              <g key={'d' + i}>
                {txt(20, 68 + i * 22, 'd' + i + '(r' + num(rel[i], 0) + ')', i === cur ? c.warning : c.muted, 9)}
                <rect x={64} y={58 + i * 22} width="160" height="12" rx="2" fill={c.panel2} opacity="0.6" />
                <rect x={64 + (v >= 0 ? 80 : 80 - (Math.abs(v) / maxLam) * 80)} y={58 + i * 22}
                  width={(Math.abs(v) / maxLam) * 80} height="12" rx="2"
                  fill={v >= 0 ? c.success : c.danger} opacity="0.9" />
                {txt(232, 68 + i * 22, f2(v), c.text, 9)}
              </g>
            );
          })}
          {txt(280, 44, '当前回归树（按特征值分桶到叶子）', c.muted, 10)}
          <rect x="280" y="54" width="200" height="150" rx="5" fill={c.panel} stroke={c.border} strokeWidth="1" />
          {Array.from({ length: Math.min(6, num(snap.leaves, 4)) }, (_, l) => (
            <g key={'lf' + l}>
              <rect x={292 + l * 30} y={100} width="24" height="30" rx="3" fill={c.purple} opacity="0.3" />
              {txt(304 + l * 30, 119, 'L' + l, c.text, 8, 'middle')}
              {txt(304 + l * 30, 148, '' + (leafOf[l] == null ? '—' : 'd' + leafOf[l]), c.muted, 8, 'middle')}
            </g>
          ))}
          {txt(292, 82, 'tree ' + (tree + 1) + ' / ' + num(snap.T, 6), c.warning, 10)}
          {txt(292, 176, '叶子均值即拟合的 lambda', c.muted, 9)}
          {txt(520, 44, 'NDCG@3 上升曲线', c.muted, 10)}
          {curve(c, ndcgHist.slice(1), 522, 60, 170, 90, c.success)}
          {txt(520, 172, '当前 NDCG@3 = ' + f2(snap.ndcg), c.success, 11)}
          {txt(520, 198, 'λᵢ = Σⱼ sᵢⱼ·|ΔNDCGᵢⱼ| / (1+e^{sᵢⱼ(scoreᵢ−scoreⱼ)})', c.text, 9)}
          <line x1="20" y1="286" x2="700" y2="286" stroke={c.grid} strokeWidth="1" />
          {txt(20, 304, 'LambdaMART = LambdaRank 的 lambda 梯度 + GBDT 拟合；直接面向 NDCG 优化。', c.text, 10)}
          {txt(20, 322, '每棵树先算 lambda，再按特征分桶，叶子均值乘学习率加到 score 上。', c.muted, 10)}
          {txt(20, 336, '绿色 lambda = 该文档应被排前；红色 = 应被排后。', c.muted, 10)}
          {progress(c, step, total)}
        </Frame>
      );
    },
  },

  // ── 15. 冷启动策略 ───────────────────────────────────────────
  'cold-start': {
    params: [
      {
        key: 'stage', label: '冷启动场景', type: 'select', default: 'newUser',
        options: [
          { value: 'newUser', label: '新用户' },
          { value: 'newItem', label: '新物品' },
          { value: 'idleUser', label: '无行为用户' },
        ],
      },
      { key: 'activity', label: '已知行为数', type: 'range', min: 0, max: 10, step: 1, default: 2 },
      { key: 'topN', label: '推荐个数', type: 'range', min: 3, max: 6, step: 1, default: 4 },
      { key: 'seed', label: '随机种子', type: 'range', min: 1, max: 30, step: 1, default: 7 },
    ],
    height: 360,
    legend: [
      { color: '#226AFF', label: '当前策略阶段' },
      { color: '#f5a524', label: '切换阈值 / 试探流量' },
      { color: '#12a06a', label: '最终推荐候选' },
      { color: '#7c5cff', label: '后续阶段' },
    ],
    hint: '冷启动：新用户/新物品缺行为时，依次用热门、上下文、属性、试探流量补齐，行为足够后切到协同。',
    buildSteps(p) {
      const rnd = mulberry32(n2(p.seed, 7));
      const stage = S(p.stage || 'newUser');
      const activity = Math.round(clamp(n2(p.activity, 2), 0, 10));
      const topN = Math.round(clamp(n2(p.topN, 4), 3, 6));
      const chains = {
        newUser: ['热门兜底', '上下文推荐', '属性匹配', '试探探索', '协同过滤'],
        newItem: ['属性匹配', '内容相似', '试探流量', '协同扩散', '热门补充'],
        idleUser: ['热门兜底', '试探探索', '上下文推荐', '属性匹配', '协同过滤'],
      };
      const chain = chains[stage] || chains.newUser;
      const threshold = 5;
      const switchToCollab = activity >= threshold;
      const steps = [];
      const push = (note, extra, metrics) => steps.push({
        stage, activity, topN, chain: chain.slice(), threshold, switchToCollab,
        note, metrics, ...extra,
      });
      push(`初始化：场景=${stage}，已知行为数=${activity}，策略链含 ${chain.length} 个阶段。`,
        { phase: 'init', stageIdx: -1, cand: -1, reveal: 0 },
        { 行为数: activity, 阶段数: chain.length, 推荐个数: topN });
      chain.forEach((name, si) => {
        const isCollab = si === chain.length - 1;
        const usable = isCollab ? switchToCollab : true;
        const cands = Array.from({ length: topN }, () => Math.floor(rnd() * 10));
        push(`阶段 ${si + 1}｜${name}${isCollab ? (usable ? '（行为达标，启用）' : '（行为不足，暂不启用）') : ''}。`,
          { phase: 'strategy', stageIdx: si, cand: -1, reveal: 0, cands: cands.slice(), usable },
          { 阶段: si + 1, 策略: name, 行为数: activity, 候选数: cands.length });
        cands.forEach((id, ci) => {
          push(`  ${name} → 候选 I${id}（来源：${name}）。`,
            { phase: 'cand', stageIdx: si, cand: ci, reveal: ci + 1, cands: cands.slice(), usable },
            { 候选: 'I' + id, 来源: name, 推荐个数: topN });
        });
      });
      const finalStage = switchToCollab ? chain.length - 1 : chain.length - 2;
      push(`完成｜推荐策略落在「${chain[Math.max(0, finalStage)]}」，行为数 ${activity} ${switchToCollab ? '≥' : '<'} 阈值 ${threshold}。`,
        { phase: 'done', stageIdx: finalStage, cand: -1, reveal: topN },
        { 行为数: activity, 切换阈值: threshold, 推荐个数: topN, 覆盖率: r2(Math.min(1, (activity + 3) / (threshold + 3))) });
      return cap(steps);
    },
    render(snap, p, c) {
      const chain = Array.isArray(snap.chain) ? snap.chain : [];
      const activity = Math.floor(num(snap.activity, 0));
      const threshold = Math.floor(num(snap.threshold, 5));
      const stage = S(snap.stage || 'newUser');
      const phase = S(snap.phase || 'init');
      const step = Math.floor(num(snap.step, 0)), total = Math.floor(num(snap.total, 1));
      const stageIdx = Math.floor(num(snap.stageIdx, -1));
      const reveal = Math.floor(num(snap.reveal, 0));
      const cands = Array.isArray(snap.cands) ? snap.cands : [];
      const usable = !!snap.usable;
      const finalStage = !!snap.switchToCollab ? chain.length - 1 : chain.length - 2;
      return (
        <Frame c={c} height={360} title={S('冷启动策略切换 · ' + stage)}
          subtitle={`${phase} · 第 ${step}/${total} 步`}>
          {txt(20, 44, '策略链（橙色=当前，绿色=最终）', c.muted, 10)}
          {chain.map((name, i) => {
            const isFinal = i === finalStage;
            const on = i === stageIdx;
            const active = on || (phase === 'done' && isFinal);
            return (
              <g key={'st' + i}>
                <rect x={20} y={54 + i * 42} width="200" height="30" rx="5"
                  fill={active ? c.primary : c.panel2} opacity={active ? 0.9 : 0.7}
                  stroke={isFinal ? c.success : 'none'} strokeWidth={isFinal ? 1.6 : 0} />
                {txt(120, 73 + i * 42, (i + 1) + '. ' + name, active ? c.bg : c.muted, 10, 'middle')}
                {i < chain.length - 1 && <line x1="120" y1={84 + i * 42} x2="120" y2={96 + i * 42}
                  stroke={c.accent} strokeWidth="1.4" />}
              </g>
            );
          })}
          {txt(250, 44, '当前策略的候选（来源标注）', c.muted, 10)}
          {cands.slice(0, num(snap.topN, 4)).map((id, ci) => (
            <g key={'cd' + ci}>
              {ci < reveal && (
                <g>
                  <rect x={250 + ci * 68} y={58} width="60" height="34" rx="4" fill={c.success} opacity="0.85" />
                  {txt(280 + ci * 68, 79, 'I' + id, c.bg, 11, 'middle')}
                  {txt(280 + ci * 68, 106, chain[Math.max(0, stageIdx)], c.muted, 8, 'middle')}
                </g>
              )}
            </g>
          ))}
          {stageIdx >= 0 && !usable && (
            <g>
              <rect x={250} y={126} width="270" height="34" rx="4" fill={c.warning} opacity="0.25" />
              {txt(262, 148, '协同阶段行为不足 → 继续用属性/试探策略', c.warning, 10)}
            </g>
          )}
          {txt(250, 184, '行为数 / 切换阈值', c.muted, 10)}
          {bar(250, 196, 260, 16, Math.min(1, activity / Math.max(1, threshold)), 1, c.warning, c.panel2)}
          {txt(520, 209, activity + ' / ' + threshold, c.text, 10)}
          {txt(250, 238, activity >= threshold ? '行为达标：可切换到协同过滤' : '行为不足：以热门/属性/试探为主',
            activity >= threshold ? c.success : c.muted, 10)}
          {txt(250, 264, '覆盖率估计 = ' + f2(Math.min(1, (activity + 3) / (threshold + 3))), c.success, 11)}
          <line x1="20" y1="286" x2="700" y2="286" stroke={c.grid} strokeWidth="1" />
          {txt(20, 304, '冷启动链：热门兜底 → 上下文 → 属性匹配 → 试探流量 → 协同过滤。', c.text, 10)}
          {txt(20, 322, '行为数达到阈值后切换到协同；新物品则走属性 → 内容相似 → 试探 → 扩散。', c.muted, 10)}
          {txt(20, 336, '试探流量用少量曝光换取行为数据，逐步缓解冷启动。', c.muted, 10)}
          {progress(c, step, total)}
        </Frame>
      );
    },
  },

  // ── 16. 图推荐 ───────────────────────────────────────────────
  'graph-rec': {
    params: [
      { key: 'hops', label: '聚合跳数', type: 'range', min: 1, max: 3, step: 1, default: 2 },
      { key: 'neighbors', label: '采样邻居数', type: 'range', min: 3, max: 5, step: 1, default: 3 },
      { key: 'dim', label: 'Embedding 维度', type: 'range', min: 2, max: 8, step: 1, default: 4 },
      { key: 'seed', label: '随机种子', type: 'range', min: 1, max: 30, step: 1, default: 7 },
    ],
    height: 360,
    legend: [
      { color: '#226AFF', label: '用户节点' },
      { color: '#12a06a', label: '物品节点' },
      { color: '#f5a524', label: '当前聚合边 / 节点' },
      { color: '#7c5cff', label: '多跳邻域聚合' },
    ],
    hint: '图推荐在用户-物品二部图上做多跳邻域聚合（GraphSAGE 式），利用高阶连接为的用户召回候选物品。',
    buildSteps(p) {
      const rnd = mulberry32(n2(p.seed, 7));
      const hops = Math.round(clamp(n2(p.hops, 2), 1, 3));
      const nb = Math.round(clamp(n2(p.neighbors, 3), 3, 5));
      const dim = Math.round(clamp(n2(p.dim, 4), 2, 8));
      const U = 4, I = 6;
      const edges = [];
      for (let u = 0; u < U; u++) {
        const k = 2 + Math.floor(rnd() * 2);
        const picked = [];
        while (picked.length < k) {
          const i = Math.floor(rnd() * I);
          if (!picked.includes(i)) picked.push(i);
        }
        picked.forEach((i) => edges.push({ u, i }));
      }
      const embU = Array.from({ length: U }, () => Array.from({ length: dim }, () => (rnd() - 0.5) * 0.6));
      const embI = Array.from({ length: I }, () => Array.from({ length: dim }, () => (rnd() - 0.5) * 0.6));
      const neighborsOfU = (u) => edges.filter((e) => e.u === u).map((e) => e.i);
      const hU = embU.map((r) => r.slice());
      const hI = embI.map((r) => r.slice());
      const steps = [];
      const push = (note, extra, metrics) => steps.push({
        U, I, hops, nb, dim, edges: edges.map((e) => ({ ...e })),
        hU: hU.map((r) => r.slice()), hI: hI.map((r) => r.slice()),
        note, metrics, ...extra,
      });
      push(`初始化：二部图 ${U} 用户 × ${I} 物品，${edges.length} 条边，做 ${hops} 跳邻域聚合。`,
        { phase: 'init', edge: -1, hop: 0, node: -1, cand: -1 },
        { 用户数: U, 物品数: I, 边数: edges.length, 跳数: hops });
      edges.forEach((e, idx) => {
        push(`遍历边 U${e.u} — I${e.i}（第 ${idx + 1}/${edges.length} 条）。`,
          { phase: 'edge', edge: idx, hop: 0, node: -1, cand: -1 },
          { 边序号: idx + 1, 用户: 'U' + e.u, 物品: 'I' + e.i, 边数: edges.length });
      });
      let frontier = neighborsOfU(0).slice(0, nb);
      for (let hop = 1; hop <= hops; hop++) {
        const next = [];
        frontier.forEach((node, ni) => {
          const isItem = hop % 2 === 1;
          const vec = isItem ? hI[node] : hU[node];
          for (let t = 0; t < Math.min(dim, 4); t++) {
            push(`第 ${hop} 跳 · 节点 ${isItem ? 'I' + node : 'U' + node} 的第 ${t + 1} 维 = ${f2(vec[t])}，参与 MEAN 聚合。`,
              { phase: 'agg', edge: -1, hop, node, dim: t },
              { 跳数: hop, 节点: (isItem ? 'I' : 'U') + node, 维度: t + 1, 邻居数: frontier.length });
          }
          if (hop < hops) {
            if (isItem) edges.filter((e) => e.i === node).forEach((e) => { if (!next.includes(e.u)) next.push(e.u); });
            else neighborsOfU(node).forEach((i) => { if (!next.includes(i)) next.push(i); });
          }
          push(`第 ${hop} 跳 · 聚合节点 ${isItem ? 'I' + node : 'U' + node} 完成（共 ${frontier.length} 个邻居）。`,
            { phase: 'aggDone', edge: -1, hop, node, dim: -1 },
            { 跳数: hop, 聚合邻居数: frontier.length });
        });
        // 更新 U0 表示（简化 mean）
        const mean = Array.from({ length: dim }, (_, t) =>
          frontier.reduce((s, node) => s + n2((hop % 2 === 1 ? hI[node] : hU[node])[t], 0), 0) / Math.max(1, frontier.length));
        for (let t = 0; t < dim; t++) hU[0][t] = 0.5 * hU[0][t] + 0.5 * mean[t];
        frontier = next.length ? next.slice(0, nb) : neighborsOfU(0).slice(0, nb);
      }
      const candScore = Array.from({ length: I }, (_, i) =>
        hI[i].reduce((s, v, t) => s + v * hU[0][t], 0));
      const order = Array.from({ length: I }, (_, i) => i).sort((a, b) => candScore[b] - candScore[a]);
      candScore.forEach((v, i) => {
        push(`候选 I${i} 与 U0 聚合表示点积 = ${f2(v)}。`,
          { phase: 'score', edge: -1, hop: hops, node: -1, cand: i },
          { 候选: 'I' + i, 分数: r2(v), 跳数: hops });
      });
      push(`完成｜${hops} 跳邻域聚合后，U0 的 Top-3 候选：${order.slice(0, 3).map((i) => 'I' + i).join('、')}。`,
        { phase: 'done', edge: -1, hop: hops, node: -1, cand: -1 },
        { '召回率@3': r2(3 / I), 候选数: I, 跳数: hops });
      return cap(steps);
    },
    render(snap, p, c) {
      const U = Math.max(1, Math.floor(num(snap.U, 4)));
      const I = Math.max(1, Math.floor(num(snap.I, 6)));
      const edges = Array.isArray(snap.edges) ? snap.edges : [];
      const hU = Array.isArray(snap.hU) ? snap.hU : [];
      const hI = Array.isArray(snap.hI) ? snap.hI : [];
      const phase = S(snap.phase || 'init');
      const step = Math.floor(num(snap.step, 0)), total = Math.floor(num(snap.total, 1));
      const edgeIdx = Math.floor(num(snap.edge, -1));
      const hop = Math.floor(num(snap.hop, 0));
      const node = Math.floor(num(snap.node, -1));
      const cand = Math.floor(num(snap.cand, -1));
      const dimIdx = Math.floor(num(snap.dim, -1));
      const uPos = (u) => ({ x: 90, y: 70 + u * 52 });
      const iPos = (i) => ({ x: 300, y: 60 + i * 38 });
      const candScore = hI.map((vec, i) =>
        (Array.isArray(vec) ? vec : []).reduce((s, v, t) => s + n2(v, 0) * n2((hU[0] || [])[t], 0), 0));
      const order = candScore.map((v, i) => ({ v, i })).sort((a, b) => b.v - a.v);
      return (
        <Frame c={c} height={360} title={S('图推荐 · 二部图多跳邻域聚合（' + hop + ' 跳）')}
          subtitle={`${phase} · 第 ${step}/${total} 步`}>
          {txt(20, 44, '用户-物品二部图（橙色=当前边/节点）', c.muted, 10)}
          {edges.map((e, ei) => {
            const a = uPos(e.u), b = iPos(e.i);
            const on = ei === edgeIdx;
            return <line key={'e' + ei} x1={a.x} y1={a.y} x2={b.x} y2={b.y}
              stroke={on ? c.warning : c.grid} strokeWidth={on ? 2.4 : 1} opacity={on ? 1 : 0.7} />;
          })}
          {Array.from({ length: U }, (_, u) => {
            const p = uPos(u);
            const on = node === u && hop % 2 === 0;
            return (
              <g key={'u' + u}>
                <circle cx={p.x} cy={p.y} r={u === 0 ? 15 : 12} fill={on ? c.warning : c.primary}
                  opacity={on ? 1 : 0.85} stroke={u === 0 ? c.text : 'none'} strokeWidth={u === 0 ? 1.4 : 0} />
                {txt(p.x, p.y + 3, 'U' + u, c.bg, 10, 'middle')}
              </g>
            );
          })}
          {Array.from({ length: I }, (_, i) => {
            const p = iPos(i);
            const on = node === i && hop % 2 === 1;
            return (
              <g key={'i' + i}>
                <circle cx={p.x} cy={p.y} r="11" fill={on ? c.warning : c.success} opacity={on ? 1 : 0.85} />
                {txt(p.x, p.y + 3, 'I' + i, c.bg, 10, 'middle')}
              </g>
            );
          })}
          {txt(360, 44, '邻域聚合层级（MEAN → 线性）', c.muted, 10)}
          {Array.from({ length: Math.max(1, hop) }, (_, h) => (
            <g key={'h' + h}>
              <rect x={360 + h * 100} y={60} width="86" height="120" rx="5" fill={c.panel}
                stroke={h === hop - 1 ? c.warning : c.border} strokeWidth={h === hop - 1 ? 1.6 : 0.8} />
              {txt(403 + h * 100, 78, '第 ' + (h + 1) + ' 跳', h === hop - 1 ? c.warning : c.text, 10, 'middle')}
              {(hU[0] || []).slice(0, 4).map((v, t) => (
                <g key={'hv' + t}>
                  {bar(370 + h * 100, 88 + t * 20, 66, 12, Math.abs(n2(v, 0)), 1, c.purple, c.panel2)}
                </g>
              ))}
              {txt(403 + h * 100, 172, 'h_U0', c.muted, 9, 'middle')}
            </g>
          ))}
          {txt(360, 204, '聚合：h = σ(W · MEAN(h(neighbors)))', c.text, 10)}
          {txt(360, 226, '候选打分：score(i) = h_U0 · h_Ii', c.muted, 10)}
          {txt(20, 246, '候选物品得分', c.muted, 10)}
          {order.map((o, k) => (
            <g key={'cs' + k}>
              {txt(20, 266 + k * 11, 'I' + o.i, k < 3 ? c.success : c.muted, 8)}
              {bar(48, 257 + k * 11, 120, 8, Math.max(0, o.v) / Math.max(0.01, Math.abs(order[0].v)), 1,
                k < 3 ? c.success : c.primary, c.panel2)}
            </g>
          ))}
          <line x1="20" y1="306" x2="700" y2="306" stroke={c.grid} strokeWidth="1" />
          {txt(20, 322, '多跳邻域聚合利用高阶连接：1 跳看直接交互物品，2 跳看相似用户的其他偏好。', c.text, 10)}
          {txt(20, 336, '橙色边=当前遍历；橙色节点=当前聚合节点；绿色=候选物品。', c.muted, 10)}
          {progress(c, step, total)}
        </Frame>
      );
    },
  },

  // ── 17. 会话推荐 ─────────────────────────────────────────────
  'session-rec': {
    params: [
      { key: 'sessionLen', label: '会话长度', type: 'range', min: 3, max: 8, step: 1, default: 5 },
      { key: 'embDim', label: 'Embedding 维度', type: 'range', min: 4, max: 12, step: 2, default: 8 },
      { key: 'topN', label: '推荐个数', type: 'range', min: 3, max: 5, step: 1, default: 3 },
      { key: 'seed', label: '随机种子', type: 'range', min: 1, max: 30, step: 1, default: 7 },
    ],
    height: 360,
    legend: [
      { color: '#226AFF', label: '会话内点击物品' },
      { color: '#f5a524', label: '当前隐状态更新' },
      { color: '#12a06a', label: '下一项 Top-N' },
      { color: '#7c5cff', label: '隐状态维度轨迹' },
    ],
    hint: '会话推荐没有长期画像，只用当前匿名会话的短序列（GRU/注意力）预测下一步点击。',
    buildSteps(p) {
      const rnd = mulberry32(n2(p.seed, 7));
      const L = Math.round(clamp(n2(p.sessionLen, 5), 3, 8));
      const dim = Math.round(clamp(n2(p.embDim, 8), 4, 12));
      const topN = Math.round(clamp(n2(p.topN, 3), 3, 5));
      const seq = Array.from({ length: L }, () => Math.floor(rnd() * 10));
      const emb = Array.from({ length: 10 }, () => Array.from({ length: dim }, () => (rnd() - 0.5) * 0.9));
      const h = Array.from({ length: dim }, () => 0);
      const hHist = [h.slice()];
      const steps = [];
      const push = (note, extra, metrics) => steps.push({
        L, dim, topN, seq: seq.slice(), hHist: hHist.map((r) => r.slice()),
        note, metrics, ...extra,
      });
      push(`初始化：匿名会话长度 ${L}，隐状态维度 ${dim}，只用会话内序列预测下一项。`,
        { phase: 'init', pos: -1, dimIdx: -1, cand: -1 },
        { 会话长度: L, 隐状态维度: dim, 候选数: 10 });
      for (let pos = 0; pos < L; pos++) {
        for (let t = 0; t < Math.min(dim, 4); t++) {
          h[t] = Math.tanh(0.6 * h[t] + 0.4 * n2(emb[seq[pos]][t], 0));
          hHist.push(h.slice());
          push(`步 ${pos + 1}/${L} · 点击 I${seq[pos]}：h[${t}] ← tanh(0.6·h[${t}] + 0.4·e[${t}]) = ${f2(h[t])}。`,
            { phase: 'gru', pos, dimIdx: t, cand: -1 },
            { 位置: pos + 1, 物品: 'I' + seq[pos], 维度: t + 1, 隐状态: r2(h[t]) });
        }
        push(`步 ${pos + 1} 完成：隐状态 h 已融合前 ${pos + 1} 次点击。`,
          { phase: 'posDone', pos, dimIdx: -1, cand: -1 },
          { 位置: pos + 1, 会话长度: L });
      }
      const score = Array.from({ length: 10 }, (_, k) =>
        h.reduce((s, v, t) => s + v * emb[k][t], 0));
      const order = Array.from({ length: 10 }, (_, k) => k).sort((a, b) => score[b] - score[a]);
      score.forEach((v, k) => {
        push(`下一项候选 I${k}：h·e${k} = ${f2(v)}，当前排名 ${order.indexOf(k) + 1}。`,
          { phase: 'predict', pos: L - 1, dimIdx: -1, cand: k, candScores: score.slice() },
          { 候选: 'I' + k, 分数: r2(v), 排名: order.indexOf(k) + 1 });
      });
      push(`完成｜下一项 Top-${topN}：${order.slice(0, topN).map((k) => 'I' + k).join('、')}。`,
        { phase: 'done', pos: L - 1, dimIdx: -1, cand: -1, candScores: score.slice() },
        { 下一项Top1: 'I' + order[0], 推荐个数: topN, 会话长度: L });
      return cap(steps);
    },
    render(snap, p, c) {
      const L = Math.max(1, Math.floor(num(snap.L, 5)));
      const seq = Array.isArray(snap.seq) ? snap.seq : [];
      const hHist = Array.isArray(snap.hHist) ? snap.hHist : [];
      const phase = S(snap.phase || 'init');
      const step = Math.floor(num(snap.step, 0)), total = Math.floor(num(snap.total, 1));
      const pos = Math.floor(num(snap.pos, -1)), dimIdx = Math.floor(num(snap.dimIdx, -1));
      const topN = Math.floor(num(snap.topN, 3));
      const h = hHist.length ? hHist[hHist.length - 1] : [];
      const candScore = (Array.isArray(snap.candScores) ? snap.candScores : []);
      return (
        <Frame c={c} height={360} title={S('会话推荐 · 短序列下一项预测')}
          subtitle={`${phase} · 第 ${step}/${total} 步`}>
          {txt(20, 44, '匿名会话序列（点击顺序）', c.muted, 10)}
          {seq.slice(0, L).map((item, i) => (
            <g key={'s' + i}>
              <rect x={20 + i * 34} y={54} width="28" height="26" rx="4"
                fill={i === pos ? c.warning : c.primary} opacity={i === pos ? 0.95 : 0.4 + 0.5 * (i / Math.max(1, L - 1))} />
              {txt(34 + i * 34, 71, 'I' + item, i === pos ? c.bg : c.text, 9, 'middle')}
              {i < L - 1 && txt(53 + i * 34, 71, '→', c.accent, 10, 'middle')}
            </g>
          ))}
          {txt(20, 108, '隐状态 h（当前）', c.muted, 10)}
          {h.slice(0, 10).map((v, t) => (
            <g key={'h' + t}>
              {bar(20 + t * 24, 120, 18, 36, Math.abs(n2(v, 0)), 1,
                t === dimIdx ? c.warning : c.purple, c.panel2)}
              {txt(29 + t * 24, 168, String(t), c.muted, 8, 'middle')}
            </g>
          ))}
          {txt(20, 194, '隐状态维度轨迹（前 4 维）', c.muted, 10)}
          {Array.from({ length: 4 }, (_, t) => (
            <polyline key={'tr' + t}
              points={hHist.map((vec, k) => `${20 + (k / Math.max(1, hHist.length - 1)) * 200},${290 - ((n2((vec || [])[t], 0) + 1) / 2) * 80}`).join(' ')}
              fill="none" stroke={c.series[t % c.series.length]} strokeWidth="1.5" />
          ))}
          {txt(260, 44, '下一项预测（基于会话末态）', c.muted, 10)}
          {(phase === 'done' || phase === 'predict') ? (
            Array.from({ length: 10 }, (_, k) => {
              const s = n2(candScore[k], 0);
              return (
                <g key={'c' + k}>
                  {txt(260, 68 + k * 22, 'I' + k, c.text, 9)}
                  {bar(290, 58 + k * 22, 150, 12, Math.abs(s), 1, c.primary, c.panel2)}
                  {txt(448, 68 + k * 22, f2(s), c.text, 9)}
                </g>
              );
            })
          ) : txt(260, 68, '会话尚未结束，隐状态逐步融合点击…', c.muted, 10)}
          {txt(500, 44, '会话序列特点', c.muted, 10)}
          {txt(500, 72, '· 无长期用户画像', c.text, 10)}
          {txt(500, 94, '· 只用当前会话短序列', c.text, 10)}
          {txt(500, 116, '· GRU 递推：hₜ=tanh(Wh·[hₜ₋₁,eₜ])', c.text, 10)}
          {txt(500, 150, '隐状态维度 = ' + num(snap.dim, 8), c.purple, 10)}
          {txt(500, 172, '推荐个数 Top-' + topN, c.success, 10)}
          <line x1="20" y1="306" x2="700" y2="306" stroke={c.grid} strokeWidth="1" />
          {txt(20, 322, '会话推荐适合匿名/短时场景：只用会话内物品 embedding 递推隐状态，再预测下一点击。', c.text, 10)}
          {txt(20, 336, '橙色=当前点击；彩色曲线=隐状态各维随会话推进的演变。', c.muted, 10)}
          {progress(c, step, total)}
        </Frame>
      );
    },
  },

  // ── 18. 联邦推荐 ─────────────────────────────────────────────
  'federated-rec': {
    params: [
      { key: 'clients', label: '客户端数', type: 'range', min: 4, max: 8, step: 1, default: 5 },
      { key: 'rounds', label: '通信轮次', type: 'range', min: 4, max: 10, step: 1, default: 5 },
      { key: 'localSteps', label: '本地训练步数', type: 'range', min: 2, max: 4, step: 1, default: 3 },
      { key: 'seed', label: '随机种子', type: 'range', min: 1, max: 30, step: 1, default: 7 },
    ],
    height: 360,
    legend: [
      { color: '#226AFF', label: '全局模型参数' },
      { color: '#f5a524', label: '当前本地训练 / 上传' },
      { color: '#12a06a', label: '服务端 FedAvg 聚合' },
      { color: '#7c5cff', label: '客户端本地数据（不出端）' },
    ],
    hint: '联邦推荐：数据不出端，各客户端本地训练后只上传模型更新，服务端 FedAvg 聚合，多轮通信联合优化。',
    buildSteps(p) {
      const rnd = mulberry32(n2(p.seed, 7));
      const C = Math.round(clamp(n2(p.clients, 5), 4, 8));
      const R = Math.round(clamp(n2(p.rounds, 5), 4, 10));
      const S = Math.round(clamp(n2(p.localSteps, 3), 2, 4));
      const dim = 4;
      let globalW = Array.from({ length: dim }, () => (rnd() - 0.5) * 0.4);
      const clientData = Array.from({ length: C }, () => ({
        n: 3 + Math.floor(rnd() * 5),
        x: Array.from({ length: 3 }, () => Array.from({ length: dim }, () => (rnd() - 0.5))),
        y: Array.from({ length: 3 }, () => (rnd() < 0.5 ? 0 : 1)),
      }));
      const lossOf = (w, client) => {
        let s = 0;
        client.x.forEach((x, i) => {
          let d = 0; for (let t = 0; t < dim; t++) d += w[t] * x[t];
          const e = client.y[i] - 1 / (1 + Math.exp(-Math.max(-20, Math.min(20, d))));
          s += e * e;
        });
        return s / Math.max(1, client.x.length);
      };
      const globalLoss = () => clientData.reduce((s, cl) => s + lossOf(globalW, cl), 0) / Math.max(1, C);
      const hist = [globalLoss()];
      const steps = [];
      const push = (note, extra, metrics) => steps.push({
        C, R, S, dim, globalW: globalW.slice(), clientN: clientData.map((cl) => cl.n),
        lossHist: hist.slice(), note, metrics, ...extra,
      });
      push(`初始化：${C} 个客户端、${R} 轮通信、每轮 ${S} 步本地训练；数据留在本地。`,
        { phase: 'init', round: 0, client: -1, localStep: -1 },
        { 客户端数: C, 通信轮次: R, 本地步数: S, 全局损失: r2(globalLoss()) });
      for (let round = 1; round <= R; round++) {
        push(`第 ${round}/${R} 轮：服务端广播全局模型 w 给所有客户端。`,
          { phase: 'broadcast', round, client: -1, localStep: -1 },
          { 通信轮次: round, 客户端数: C, 全局损失: r2(globalLoss()) });
        const deltas = [];
        for (let ci = 0; ci < C; ci++) {
          const cl = clientData[ci];
          const wLocal = globalW.slice();
          for (let st = 1; st <= S; st++) {
            cl.x.forEach((x, i) => {
              let d = 0; for (let t = 0; t < dim; t++) d += wLocal[t] * x[t];
              const p = 1 / (1 + Math.exp(-Math.max(-20, Math.min(20, d))));
              const e = p - cl.y[i];
              for (let t = 0; t < dim; t++) wLocal[t] -= 0.05 * e * x[t];
            });
            push(`第 ${round} 轮 · 客户端 C${ci} 本地训练第 ${st}/${S} 步（数据 ${cl.n} 条不出端）。`,
              { phase: 'local', round, client: ci, localStep: st },
              { 通信轮次: round, 客户端: 'C' + ci, 本地步: st, 本地损失: r2(lossOf(wLocal, cl)) });
          }
          deltas.push({ ci, w: wLocal, n: cl.n });
          push(`客户端 C${ci} 上传模型更新 Δw（不上传原始数据）。`,
            { phase: 'upload', round, client: ci, localStep: S },
            { 通信轮次: round, 客户端: 'C' + ci, 上传: '仅模型更新' });
        }
        const totalN = deltas.reduce((s, d) => s + d.n, 0);
        globalW = globalW.map((_, t) =>
          deltas.reduce((s, d) => s + (d.n / Math.max(1, totalN)) * d.w[t], 0));
        hist.push(globalLoss());
        push(`第 ${round} 轮完成：FedAvg 按样本量加权聚合 ${C} 个客户端更新，全局损失=${f2(hist[hist.length - 1])}。`,
          { phase: 'aggregate', round, client: -1, localStep: -1 },
          { 通信轮次: round, 全局损失: r2(hist[hist.length - 1]), 参与客户端: C });
      }
      push(`完成｜${R} 轮联邦训练，全局损失 ${f2(hist[0])} → ${f2(hist[hist.length - 1])}，原始数据始终不出端。`,
        { phase: 'done', round: R, client: -1, localStep: -1 },
        { 全局损失: r2(hist[hist.length - 1]), 下降幅度: r2(hist[0] - hist[hist.length - 1]), 通信轮次: R });
      return cap(steps);
    },
    render(snap, p, c) {
      const C = Math.max(1, Math.floor(num(snap.C, 5)));
      const globalW = Array.isArray(snap.globalW) ? snap.globalW : [];
      const clientN = Array.isArray(snap.clientN) ? snap.clientN : [];
      const hist = Array.isArray(snap.lossHist) ? snap.lossHist : [];
      const phase = S(snap.phase || 'init');
      const step = Math.floor(num(snap.step, 0)), total = Math.floor(num(snap.total, 1));
      const round = Math.floor(num(snap.round, 0)), client = Math.floor(num(snap.client, -1));
      const localStep = Math.floor(num(snap.localStep, -1));
      return (
        <Frame c={c} height={360}
          title={S('联邦推荐 · 本地训练 + FedAvg 聚合（第 ' + round + ' 轮）')}
          subtitle={`${phase} · 第 ${step}/${total} 步`}>
          {txt(20, 44, '客户端（数据不出端，仅上传模型更新）', c.muted, 10)}
          {Array.from({ length: C }, (_, ci) => {
            const col = ci % 4, row = Math.floor(ci / 4);
            const on = ci === client;
            const up = phase === 'upload' && on;
            return (
              <g key={'cl' + ci}>
                <rect x={20 + col * 90} y={54 + row * 52} width="80" height="42" rx="5"
                  fill={up ? c.warning : on ? c.primary : c.panel2}
                  opacity={on ? 0.9 : 0.75} stroke={up ? c.text : 'none'} strokeWidth={up ? 1.4 : 0} />
                {txt(60 + col * 90, 72, 'C' + ci, on ? c.bg : c.text, 10, 'middle')}
                {txt(60 + col * 90, 88, 'n=' + num(clientN[ci], 0), on ? c.bg : c.muted, 8, 'middle')}
                {up && txt(60 + col * 90, 110, '↑Δw', c.warning, 9, 'middle')}
              </g>
            );
          })}
          {txt(390, 44, '服务端全局模型 w（FedAvg 聚合后）', c.muted, 10)}
          {globalW.map((v, t) => (
            <g key={'gw' + t}>
              {txt(390, 70 + t * 24, 'w' + t, c.muted, 9)}
              {bar(420, 60 + t * 24, 130, 12, Math.abs(n2(v, 0)), 0.5, c.primary, c.panel2)}
              {txt(558, 70 + t * 24, f2(v), c.text, 9)}
            </g>
          ))}
          {txt(390, 176, phase === 'aggregate' ? '正在按样本量加权聚合…' : '等待各客户端上传 Δw…',
            phase === 'aggregate' ? c.success : c.muted, 10)}
          {txt(20, 186, '当前阶段：' + phase + (localStep >= 0 ? '（本地步 ' + localStep + '）' : ''), c.warning, 10)}
          {txt(20, 212, '全局损失下降（每轮一次聚合）', c.muted, 10)}
          {curve(c, hist, 22, 226, 300, 76, c.success)}
          {txt(350, 212, '隐私约束', c.muted, 10)}
          {txt(350, 236, '· 原始数据永不离开客户端', c.text, 10)}
          {txt(350, 258, '· 只上传梯度 / 模型更新', c.text, 10)}
          {txt(350, 280, '· 可按样本量加权聚合', c.text, 10)}
          <line x1="20" y1="306" x2="700" y2="306" stroke={c.grid} strokeWidth="1" />
          {txt(20, 322, 'FedAvg：w ← Σₖ (nₖ / Σnₖ) · wₖ；每轮广播 → 本地训练 → 上传 → 聚合。', c.text, 10)}
          {txt(20, 336, '通信轮次与本地步数越多，全局模型收敛越好，但通信成本更高。', c.muted, 10)}
          {progress(c, step, total)}
        </Frame>
      );
    },
  },
};
