import React from 'react';
import { mulberry32, clamp } from '../utils.js';

const W = 720;
const r2 = (v) => Math.round((Number.isFinite(v) ? v : 0) * 100) / 100;
const f2 = (v) => (Number.isFinite(v) ? v : 0).toFixed(2);

export default {
  id: 'user-item-cf',
  params: [
    {
      key: 'method', label: '协同过滤方法', type: 'select', default: 'UserCF',
      options: [
        { value: 'UserCF', label: 'UserCF（找相似用户）' },
        { value: 'ItemCF', label: 'ItemCF（找相似物品）' },
      ],
    },
    { key: 'k', label: '邻居数 k', type: 'range', min: 1, max: 6, step: 1, default: 3, hint: '参与加权平均的最相似邻居个数' },
    { key: 'nUsers', label: '用户数', type: 'range', min: 4, max: 8, step: 1, default: 5 },
    { key: 'nItems', label: '物品数', type: 'range', min: 5, max: 9, step: 1, default: 6 },
    { key: 'seed', label: '随机种子', type: 'range', min: 1, max: 30, step: 1, default: 7 },
  ],
  height: 340,
  legend: [
    { color: '#226AFF', label: '评分 / 相似度热力' },
    { color: '#f5a524', label: '目标用户 / 当前计算' },
    { color: '#12a06a', label: '未评分候选 / Top-N 推荐' },
  ],
  hint: '协同过滤：计算相似度 → 找邻居 → 加权平均邻居评分 → 给目标用户未评分物品打分并排序推荐。',

  buildSteps(p) {
    const rnd = mulberry32(p.seed);
    const U = clamp(Math.round(p.nUsers), 4, 8);
    const I = clamp(Math.round(p.nItems), 5, 9);
    const method = p.method === 'ItemCF' ? 'ItemCF' : 'UserCF';

    // 评分矩阵：1~5 分，0 表示未评分
    const R = Array.from({ length: U }, () =>
      Array.from({ length: I }, () => (rnd() < 0.62 ? 1 + Math.floor(rnd() * 5) : 0)));
    R[0][0] = 1 + Math.floor(rnd() * 5);
    R[0][1] = 1 + Math.floor(rnd() * 5);
    R[0][I - 1] = 0;
    R[0][I - 2] = 0;

    const means = Array.from({ length: U }, (_, u) => {
      let s = 0, n = 0;
      for (let i = 0; i < I; i++) if (R[u][i] > 0) { s += R[u][i]; n++; }
      return n ? s / n : 0;
    });
    const cosine = (a, b) => {
      let dot = 0, na = 0, nb = 0;
      for (let t = 0; t < a.length; t++) { dot += a[t] * b[t]; na += a[t] * a[t]; nb += b[t] * b[t]; }
      const d = Math.sqrt(na) * Math.sqrt(nb);
      return d > 1e-9 ? dot / d : 0;
    };

    let N, sim, simLabel;
    if (method === 'UserCF') {
      N = U; simLabel = '用户';
      sim = Array.from({ length: U }, (_, u) =>
        Array.from({ length: U }, (_, v) => (u === v ? 1 : cosine(R[u], R[v]))));
    } else {
      const cols = Array.from({ length: I }, (_, i) => Array.from({ length: U }, (_, u) => R[u][i]));
      N = I; simLabel = '物品';
      sim = Array.from({ length: I }, (_, i) =>
        Array.from({ length: I }, (_, j) => (i === j ? 1 : cosine(cols[i], cols[j]))));
    }
    const K = clamp(Math.round(p.k), 1, Math.max(1, N - 1));

    const cands = [];
    for (let i = 0; i < I; i++) if (R[0][i] === 0) cands.push(i);

    // 相似度矩阵的非对角单元格（按顺序逐步展示，最多 22 步）
    const cells = [];
    for (let a = 0; a < N; a++) for (let b = 0; b < N; b++) if (a !== b) cells.push([a, b]);
    const simOrder = cells.slice(0, 22);

    // 每个候选物品的邻居（含相似度与评分），用于加权平均
    const candInfo = cands.map((ci) => {
      let nb;
      if (method === 'UserCF') {
        const arr = [];
        for (let v = 1; v < U; v++)
          if (R[v][ci] > 0 && sim[0][v] > 0)
            arr.push({ idx: v, s: sim[0][v], rating: R[v][ci], meanV: means[v] });
        arr.sort((x, y) => y.s - x.s);
        nb = arr.slice(0, K).map((o) => ({ ...o, label: 'U' + o.idx }));
      } else {
        const arr = [];
        for (let j = 0; j < I; j++)
          if (j !== ci && R[0][j] > 0 && sim[ci][j] > 0)
            arr.push({ idx: j, s: sim[ci][j], rating: R[0][j] });
        arr.sort((x, y) => y.s - x.s);
        nb = arr.slice(0, K).map((o) => ({ ...o, label: 'I' + o.idx }));
      }
      return { ci, nb };
    });

    const accVal = (info, upto) => {
      const mu = means[0];
      let num = 0, den = 0;
      for (let t = 0; t < upto && t < info.nb.length; t++) {
        const o = info.nb[t];
        num += method === 'UserCF' ? o.s * (o.rating - o.meanV) : o.s * o.rating;
        den += Math.abs(o.s);
      }
      let val = mu;
      if (den >= 1e-9) val = method === 'UserCF' ? mu + num / den : num / den;
      return { num, den, pred: clamp(Number.isFinite(val) ? val : mu, 1, 5) };
    };

    const steps = [];
    const preds = {};
    const base = { R, sim, N, simLabel, method, U, I, K, cands, means, candInfo, simOrder };
    const push = (note, phase, metrics, extra) => steps.push({
      ...base, phase, preds: { ...preds }, metrics, note, ...extra,
    });
    const common = { 方法: method, 邻居数: K, 候选数: cands.length };

    push(`评分矩阵已生成：${U} 个用户 × ${I} 个物品，空白格表示未评分。`, 'init',
      { ...common, 用户数: U, 物品数: I }, { simDone: 0 });
    push(`目标设为用户 U0，其未评分物品共 ${cands.length} 个：${cands.map((i) => 'I' + i).join('、')}，将逐一预测打分。`, 'init',
      { ...common, 目标用户: 'U0' }, { simDone: 0 });

    let done = 0;
    for (const [a, b] of simOrder) {
      done++;
      push(`计算${simLabel}相似度 sim(${a},${b}) = ${f2(sim[a][b])}（共评评分向量的余弦相似度）。`, 'sim',
        { ...common, 相似度: r2(sim[a][b]), 已算格数: done },
        { simDone: done, simCell: [a, b] });
    }
    const fullDone = done;
    const withSim = (extra) => ({ simDone: fullDone, ...extra });

    for (const info of candInfo) {
      const ci = info.ci;
      const nbList = info.nb.map((o) => `${o.label}:${f2(o.s)}`).join('、') || '无（相似度均≤0）';
      push(`候选 I${ci}｜找邻居：按相似度取前 ${K} 个 → ${nbList}。`, 'neighbors',
        { ...common, 候选: 'I' + ci, 邻居数: info.nb.length, 最高相似度: r2(info.nb.length ? info.nb[0].s : 0) },
        withSim({ curCand: ci }));
      for (let t = 1; t <= info.nb.length; t++) {
        const v = accVal(info, t);
        const o = info.nb[t - 1];
        const term = method === 'UserCF' ? `${f2(o.s)}×(${o.rating}-${f2(o.meanV)})` : `${f2(o.s)}×${o.rating}`;
        push(`候选 I${ci}｜加权平均累加 ${term}：分子=${f2(v.num)}、分母=${f2(v.den)}，当前预测≈${f2(v.pred)}。`, 'accum',
          { ...common, 候选: 'I' + ci, 分子: r2(v.num), 分母: r2(v.den), 当前预测: r2(v.pred) },
          withSim({ curCand: ci, accIdx: t }));
      }
      const full = accVal(info, info.nb.length);
      preds[ci] = full.pred;
      push(`候选 I${ci}｜得预测分 pred(U0,I${ci}) = ${f2(full.pred)}，写入打分表。`, 'record',
        { ...common, 候选: 'I' + ci, 预测分: r2(full.pred) },
        withSim({ curCand: ci }));
    }

    const sorted = cands.slice().sort((x, y) => (preds[y] ?? 0) - (preds[x] ?? 0));
    for (let t = 1; t <= sorted.length; t++) {
      const last = sorted[t - 1];
      push(`按预测分降序排序：第 ${t} 名为 I${last}（${f2(preds[last])}）。`, 'sort',
        { ...common, 已排序: t, 当前最高分: r2(preds[last]) },
        withSim({ sortedReveal: t, sorted }));
    }
    const rec = sorted.slice(0, Math.min(3, sorted.length));
    push(`完成｜Top-${rec.length} 推荐：${rec.map((i, t) => `${t + 1}.I${i}(${f2(preds[i])})`).join('  ')}。`, 'topn',
      { ...common, 推荐数: rec.length, 最高预测分: r2(preds[rec[0]] || 0) },
      withSim({ sortedReveal: sorted.length, sorted, topN: rec }));
    push(`小结：${method === 'UserCF' ? 'UserCF 用相似用户的评分偏差加权' : 'ItemCF 用相似物品的历史评分加权'}；k 越大越平滑，种子不同评分与推荐都会变。`, 'end',
      { ...common, 推荐数: rec.length },
      withSim({ sortedReveal: sorted.length, sorted, topN: rec }));

    return steps;
  },

  render(snap, p, c) {
    const H = 340;
    const R = Array.isArray(snap.R) ? snap.R : [];
    const sim = Array.isArray(snap.sim) ? snap.sim : [];
    const cands = Array.isArray(snap.cands) ? snap.cands : [];
    const U = R.length, I = U ? (R[0] || []).length : 0, N = sim.length;
    const method = snap.method || 'UserCF';
    const phase = snap.phase || 'init';
    const preds = snap.preds || {};
    const simOrder = Array.isArray(snap.simOrder) ? snap.simOrder : [];
    const simDone = snap.simDone ?? simOrder.length;
    const shown = new Set(simOrder.slice(0, simDone).map(([a, b]) => a + '-' + b));
    const simCell = snap.simCell || null;
    const curCand = snap.curCand;
    const sorted = Array.isArray(snap.sorted) ? snap.sorted : [];
    const sortedReveal = snap.sortedReveal ?? 0;
    const topN = Array.isArray(snap.topN) ? snap.topN : [];
    const candInfo = Array.isArray(snap.candInfo) ? snap.candInfo : [];
    const K = snap.K || 1;

    const cw = 228 / Math.max(1, I), ch = 22, mx = 28, my = 46;
    const sw = 170 / Math.max(1, N), sh = 20, sx = 282, sy = 46;
    const rx = 478;

    const phaseText = {
      init: '准备：观察评分矩阵与目标用户',
      sim: '阶段一：逐格计算相似度矩阵',
      neighbors: '阶段二：为候选物品找 k 个最相似邻居',
      accum: '阶段三：加权平均，逐项累加邻居贡献',
      record: '阶段三：预测分写入打分表',
      sort: '阶段四：按预测分降序排序',
      topn: '阶段五：取 Top-N 生成推荐',
      end: '演示完成',
    }[phase] || '协同过滤演示';
    const curInfo = (curCand == null) ? null : candInfo.find((o) => o.ci === curCand);

    return (
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} preserveAspectRatio="xMidYMid meet">
        <text x="20" y="16" fontSize="11" fill={c.text}>协同过滤 · {method} · {phaseText}</text>
        <text x={mx} y="34" fontSize="10" fill={c.muted}>用户-物品评分矩阵（U0 为目标）</text>
        <text x={sx} y="34" fontSize="10" fill={c.muted}>相似度矩阵 sim(a,b)</text>
        <text x={rx} y="34" fontSize="10" fill={c.muted}>预测打分 / Top-N 推荐</text>

        {/* 评分矩阵热力图 */}
        {I > 0 && Array.from({ length: I }, (_, i) => (
          <text key={'ch' + i} x={mx + (i + 0.5) * cw} y="42" textAnchor="middle" fontSize="9"
            fill={cands.includes(i) ? c.success : c.muted}>I{i}</text>
        ))}
        {R.map((row, u) => (
          <g key={'u' + u}>
            <text x={mx - 6} y={my + (u + 0.5) * ch + 3} textAnchor="end" fontSize="9"
              fill={u === 0 ? c.warning : c.muted}>U{u}</text>
            {(row || []).map((v, i) => {
              const x = mx + i * cw, y = my + u * ch;
              const lit = v > 0;
              return (
                <g key={i}>
                  <rect x={x + 1} y={y + 1} width={Math.max(1, cw - 2)} height={ch - 2} rx="2"
                    fill={lit ? c.primary : c.panel2} opacity={lit ? 0.10 + 0.09 * v : 1}
                    stroke={u === 0 ? c.warning : 'none'} strokeWidth={u === 0 ? 0.8 : 0} />
                  <text x={x + cw / 2} y={y + ch / 2 + 3} textAnchor="middle" fontSize="9"
                    fill={lit ? c.text : c.muted}>{lit ? v : '·'}</text>
                </g>
              );
            })}
          </g>
        ))}

        {/* 相似度矩阵 */}
        {sim.map((row, a) => (
          <g key={'sa' + a}>
            <text x={sx - 5} y={sy + (a + 0.5) * sh + 3} textAnchor="end" fontSize="9" fill={c.muted}>{a}</text>
            {(row || []).map((v, b) => {
              const x = sx + b * sw, y = sy + a * sh;
              const isShown = a === b || (phase !== 'sim' && phase !== 'init') || shown.has(a + '-' + b);
              const val = isShown ? v : 0;
              const isCur = simCell && simCell[0] === a && simCell[1] === b;
              return (
                <g key={b}>
                  <rect x={x + 1} y={y + 1} width={Math.max(1, sw - 2)} height={sh - 2} rx="2"
                    fill={a === b ? c.muted : (val >= 0 ? c.primary : c.danger)}
                    opacity={a === b ? 0.22 : Math.min(0.6, Math.abs(val) * 0.55)}
                    stroke={isCur ? c.warning : 'none'} strokeWidth={isCur ? 1.5 : 0} />
                  {sw >= 17 && (
                    <text x={x + sw / 2} y={y + sh / 2 + 3} textAnchor="middle" fontSize="9" fill={c.text}>
                      {isShown ? (a === b ? '1' : f2(val)) : '?'}
                    </text>
                  )}
                </g>
              );
            })}
          </g>
        ))}

        {/* 预测打分条形 */}
        {cands.map((ci, t) => {
          const y = 46 + t * 22;
          const sc = preds[ci];
          const has = typeof sc === 'number';
          const rank = topN.indexOf(ci);
          const barW = has ? Math.max(0, (sc - 1) / 4) * 148 : 0;
          return (
            <g key={'p' + ci}>
              <text x={rx} y={y + 11} fontSize="10" fill={c.muted}>I{ci}</text>
              <rect x={rx + 34} y={y + 2} width="148" height="12" rx="2" fill={c.panel2} />
              {has && <rect x={rx + 34} y={y + 2} width={barW} height="12" rx="2"
                fill={rank >= 0 ? c.success : c.primary} opacity="0.85" />}
              <text x={rx + 188} y={y + 11} fontSize="10" fill={c.text}>{has ? f2(sc) : '—'}</text>
              {rank >= 0 && <text x={rx + 218} y={y + 11} fontSize="10" fill={c.success}>★{rank + 1}</text>}
            </g>
          );
        })}

        {/* 右下：排序 / 推荐结果 */}
        {(phase === 'sort' || phase === 'topn' || phase === 'end') && sorted.length > 0 && (
          <g>
            <text x={rx} y="208" fontSize="10" fill={c.muted}>按预测分降序：</text>
            {sorted.slice(0, Math.max(1, sortedReveal)).map((ci, t) => (
              <text key={'s' + ci} x={rx} y={222 + t * 14} fontSize="10"
                fill={t < topN.length ? c.success : c.text}>
                {t + 1}. I{ci} · {typeof preds[ci] === 'number' ? f2(preds[ci]) : '—'}{t < topN.length ? ' ← 推荐' : ''}
              </text>
            ))}
          </g>
        )}

        {/* 左中：阶段说明与邻居明细 */}
        <text x="20" y="246" fontSize="11" fill={c.warning}>{phaseText}</text>
        {(phase === 'neighbors' || phase === 'accum') && curInfo && (
          <g>
            <text x="20" y="260" fontSize="10" fill={c.text}>候选 I{curCand} 的邻居（sim / 评分）：</text>
            {curInfo.nb.length === 0
              ? <text x="20" y="280" fontSize="10" fill={c.muted}>无正相似度邻居 → 预测回退到用户均值</text>
              : curInfo.nb.slice(0, 6).map((o, t) => (
                <text key={t} x={20 + (t % 3) * 88} y={276 + Math.floor(t / 3) * 16} fontSize="9" fill={c.text}>
                  {o.label} s{f2(o.s)} r{o.rating}
                </text>
              ))}
            {phase === 'accum' && (
              <text x="20" y="300" fontSize="9" fill={c.muted}>
                已累加 {snap.accIdx || 0}/{curInfo.nb.length} 项，分子 / 分母见指标栏
              </text>
            )}
          </g>
        )}
        {phase === 'sim' && (
          <text x="20" y="266" fontSize="10" fill={c.muted}>
            橙色描边格为正在计算的 sim 值；空白格尚未计算。
          </text>
        )}
        {phase === 'init' && (
          <g>
            <text x="20" y="266" fontSize="10" fill={c.muted}>绿色列标题 = U0 未评分的候选物品；</text>
            <text x="20" y="282" fontSize="10" fill={c.muted}>热力越深表示评分越高（1~5 分）。</text>
          </g>
        )}
        {(phase === 'sort' || phase === 'topn' || phase === 'end') && (
          <g>
            <text x="20" y="266" fontSize="10" fill={c.muted}>预测分截断到 [1,5]，按分数降序取前 3 个</text>
            <text x="20" y="282" fontSize="10" fill={c.muted}>作为最终 Top-N 推荐（绿色标注）。</text>
          </g>
        )}

        {/* 中栏：公式 */}
        <text x={sx} y="246" fontSize="10" fill={c.muted}>预测公式</text>
        {method === 'UserCF' ? (
          <g>
            <text x={sx} y="264" fontSize="9" fill={c.text}>pred(U0,i) = mean(U0)</text>
            <text x={sx} y="280" fontSize="9" fill={c.text}> + Σ sim(0,v)·(R[v][i]−mean(v)) / Σ|sim|</text>
          </g>
        ) : (
          <g>
            <text x={sx} y="264" fontSize="9" fill={c.text}>pred(U0,i) =</text>
            <text x={sx} y="280" fontSize="9" fill={c.text}> Σ sim(i,j)·R[0][j] / Σ|sim(i,j)|</text>
          </g>
        )}
        <text x={sx} y="298" fontSize="9" fill={c.muted}>sim = 共评向量余弦相似度（−1~1）</text>

        {/* 底部固定说明 */}
        <line x1="20" y1="308" x2={W - 20} y2="308" stroke={c.grid} strokeWidth="1" />
        <text x="20" y="324" fontSize="10" fill={c.muted}>
          流程：找邻居 → 加权平均 → 排序 → Top-N；改方法 / k / 规模 / 种子都会真实改变打分与推荐。
        </text>
      </svg>
    );
  },
};
