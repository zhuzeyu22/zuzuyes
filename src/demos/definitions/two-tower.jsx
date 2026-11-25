import React from 'react';
import { mulberry32, clamp, softmax } from '../utils.js';

const W = 720;
const r2 = (v) => Math.round((Number.isFinite(v) ? v : 0) * 100) / 100;
const f2 = (v) => (Number.isFinite(v) ? v : 0).toFixed(2);

export default {
  id: 'two-tower',
  params: [
    { key: 'dim', label: 'embedding 维度', type: 'range', min: 2, max: 8, step: 1, default: 4 },
    { key: 'temp', label: '温度 τ', type: 'range', min: 0.05, max: 1, step: 0.05, default: 0.2, hint: 'softmax 温度，越小分布越尖锐' },
    { key: 'nNeg', label: '负样本数', type: 'range', min: 1, max: 5, step: 1, default: 3 },
    { key: 'steps', label: '训练步数', type: 'range', min: 20, max: 120, step: 10, default: 60 },
    { key: 'seed', label: '随机种子', type: 'range', min: 1, max: 30, step: 1, default: 7 },
    { key: 'hardNeg', label: '难负样本挖掘', type: 'toggle', default: false, hint: '改为挑当前打分最高的非正样本物品' },
  ],
  height: 370,
  legend: [
    { color: '#226AFF', label: '用户 embedding（方块）' },
    { color: '#12a06a', label: '正样本 / 拉近箭头' },
    { color: '#e5484d', label: '负样本 / 推远箭头' },
    { color: '#f5a524', label: '目标用户 U0 / 当前损失' },
  ],
  hint: '双塔把用户与物品分别映射为 embedding，用 softmax 对比损失拉近正样本、推远负样本，观察 U0 的召回 Top-3 随训练变化。',

  buildSteps(p) {
    const rnd = mulberry32(p.seed);
    const U = 4, I = 6;
    const dim = clamp(Math.round(p.dim), 2, 8);
    const temp = clamp(Number(p.temp) || 0.2, 0.05, 2);
    const nNeg = clamp(Math.round(p.nNeg), 1, 5);
    const T = clamp(Math.round(p.steps), 20, 120);
    const hardNeg = !!p.hardNeg;
    const lr = 0.08;

    // 真实兴趣 / 属性（2D）用来定义每个用户的正样本
    const gu = Array.from({ length: U }, () => [rnd() * 2 - 1, rnd() * 2 - 1]);
    const gi = Array.from({ length: I }, () => [rnd() * 2 - 1, rnd() * 2 - 1]);
    const posPool = Array.from({ length: U }, (_, u) => {
      const arr = Array.from({ length: I }, (_, i) => ({ i, s: gu[u][0] * gi[i][0] + gu[u][1] * gi[i][1] }));
      arr.sort((a, b) => b.s - a.s);
      return arr.slice(0, Math.min(2, I)).map((o) => o.i);
    });

    const eu = Array.from({ length: U }, () => Array.from({ length: dim }, () => (rnd() - 0.5) * 0.5));
    const ei = Array.from({ length: I }, () => Array.from({ length: dim }, () => (rnd() - 0.5) * 0.5));

    const dot = (a, b) => {
      let s = 0;
      for (let d = 0; d < dim; d++) s += (a[d] || 0) * (b[d] || 0);
      return s;
    };
    const recallTop = () => {
      const arr = Array.from({ length: I }, (_, i) => ({ i, score: dot(eu[0], ei[i]) }));
      arr.sort((a, b) => b.score - a.score);
      return arr.slice(0, 3);
    };
    const pickNegs = (u, pos, cnt) => {
      let pool = [];
      for (let i = 0; i < I; i++) if (i !== pos && !posPool[u].includes(i)) pool.push(i);
      if (pool.length === 0) for (let i = 0; i < I; i++) if (i !== pos) pool.push(i);
      if (hardNeg) {
        pool.sort((a, b) => dot(eu[u], ei[b]) - dot(eu[u], ei[a]));
      } else {
        for (let t = pool.length - 1; t > 0; t--) {
          const j = Math.floor(rnd() * (t + 1));
          [pool[t], pool[j]] = [pool[j], pool[t]];
        }
      }
      return pool.slice(0, Math.min(cnt, Math.max(1, pool.length)));
    };

    const steps = [];
    const lossHistory = [];
    const snapOf = (note, extra, metrics) => steps.push({
      U, I, dim, temp, nNeg, T, hardNeg, lr, posPool,
      eu: eu.map((r) => r.slice()), ei: ei.map((r) => r.slice()),
      lossHistory: lossHistory.slice(), note, metrics, ...extra,
    });

    snapOf(`初始化：${U} 个用户、${I} 个物品的 ${dim} 维 embedding；每个用户有 ${posPool[0].length} 个正样本，尚未训练。`,
      { cur: null, topK: recallTop(), step: 0 },
      { 用户数: U, 物品数: I, 向量维度: dim, 温度τ: r2(temp) });

    for (let step = 1; step <= T; step++) {
      const u = (step - 1) % U;
      const pos = posPool[u][Math.floor(rnd() * posPool[u].length)];
      const negs = pickNegs(u, pos, nNeg);
      const items = [pos, ...negs];
      const y = [1, ...negs.map(() => 0)];
      const logits = items.map((it) => dot(eu[u], ei[it]));
      const prob = softmax(logits, temp);
      const loss = -Math.log(Math.max(1e-9, prob[0] || 0));
      const g = prob.map((pr, idx) => (pr - y[idx]) / temp);

      const euOld = eu[u].slice();
      const dU = new Array(dim).fill(0);
      items.forEach((it, idx) => {
        for (let d = 0; d < dim; d++) dU[d] += g[idx] * ei[it][d];
      });
      items.forEach((it, idx) => {
        for (let d = 0; d < dim; d++) ei[it][d] -= lr * g[idx] * euOld[d];
      });
      for (let d = 0; d < dim; d++) eu[u][d] -= lr * dU[d];

      lossHistory.push(loss);
      const topK = recallTop();
      snapOf(
        `第 ${step}/${T} 步 · U${u}：正样本 I${pos}，负样本 ${negs.map((i) => 'I' + i).join('、') || '无'}；p(正)=${f2(prob[0])}、loss=${f2(loss)}，正样本拉近、负样本推远。`,
        { cur: { u, pos, negs, items, y, logits, prob, loss }, topK, step },
        { 训练步: step, 温度τ: r2(temp), 负样本数: negs.length, 当前损失: r2(loss), 正样本概率: r2(prob[0]), 召回Top1: 'I' + topK[0].i },
      );
    }

    const finalLoss = lossHistory.length ? lossHistory[lossHistory.length - 1] : 0;
    const firstLoss = lossHistory.length ? lossHistory[0] : 0;
    snapOf(`训练完成：loss ${f2(firstLoss)} → ${f2(finalLoss)}；U0 召回 Top-3 = ${recallTop().map((o) => 'I' + o.i).join('、')}。`,
      { cur: null, topK: recallTop(), step: T, done: true },
      { 最终损失: r2(finalLoss), 初始损失: r2(firstLoss), 训练步数: T, 向量维度: dim });

    return steps;
  },

  render(snap, p, c) {
    const H = 370;
    const U = 4, I = 6;
    const eu = Array.isArray(snap.eu) ? snap.eu : [];
    const ei = Array.isArray(snap.ei) ? snap.ei : [];
    const cur = snap.cur || null;
    const items = cur ? cur.items : [];
    const topK = Array.isArray(snap.topK) ? snap.topK : [];
    const lh = Array.isArray(snap.lossHistory) ? snap.lossHistory : [];
    const temp = snap.temp ?? 0.2, dim = snap.dim ?? 4, nNeg = snap.nNeg ?? 3;
    const hardNeg = !!snap.hardNeg;

    const vec = (a) => (Array.isArray(a) ? a : []);
    const coords = [];
    for (let u = 0; u < U; u++) { const a = vec(eu[u]); coords.push(a[0] || 0, a[1] || 0); }
    for (let i = 0; i < I; i++) { const a = vec(ei[i]); coords.push(a[0] || 0, a[1] || 0); }
    const maxAbs = Math.max(1.2, ...coords.map((x) => Math.abs(x)));
    const proj = (a) => {
      const v = vec(a);
      return { x: 360 + ((v[0] || 0) / maxAbs) * 100, y: 154 - ((v[1] || 0) / maxAbs) * 88 };
    };

    const arrow = (x1, y1, x2, y2, color, pushFar, key) => {
      const dx = x2 - x1, dy = y2 - y1;
      const len = Math.hypot(dx, dy) || 1;
      const ux = dx / len, uy = dy / len;
      const ex = pushFar ? x2 + ux * 15 : x2, ey = pushFar ? y2 + uy * 15 : y2;
      const px = -uy, py = ux, s = 5;
      const tip = `${ex + ux * s},${ey + uy * s}`;
      const p1 = `${ex - ux * s + px * s * 0.6},${ey - uy * s + py * s * 0.6}`;
      const p2 = `${ex - ux * s - px * s * 0.6},${ey - uy * s - py * s * 0.6}`;
      return (
        <g key={key}>
          <line x1={x1} y1={y1} x2={ex} y2={ey} stroke={color} strokeWidth="1.2"
            strokeDasharray={pushFar ? '4 3' : undefined} />
          <polygon points={`${tip} ${p1} ${p2}`} fill={color} />
        </g>
      );
    };

    const maxL = Math.max(0.5, ...lh);

    return (
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} preserveAspectRatio="xMidYMid meet">
        <text x="20" y="16" fontSize="11" fill={c.text}>
          双塔召回 · softmax 对比学习 · 第 {snap.step || 0}/{snap.T || 0} 步 · {hardNeg ? '难负样本' : '随机负样本'}
        </text>
        <text x="20" y="32" fontSize="10" fill={c.muted}>双塔结构</text>
        <text x="225" y="32" fontSize="10" fill={c.muted}>二维 embedding 空间（前两维投影）</text>
        <text x="505" y="32" fontSize="10" fill={c.muted}>对 U0 的召回 Top-3</text>

        {/* 左：双塔结构 */}
        <rect x="24" y="46" width="70" height="152" rx="6" fill={c.panel} stroke={c.border} strokeWidth="1" />
        <rect x="126" y="46" width="70" height="152" rx="6" fill={c.panel} stroke={c.border} strokeWidth="1" />
        <text x="59" y="60" textAnchor="middle" fontSize="9" fill={c.primary}>用户塔</text>
        <text x="161" y="60" textAnchor="middle" fontSize="9" fill={c.purple}>物品塔</text>
        {[0, 1, 2].map((k) => (
          <g key={'tower' + k}>
            <rect x="30" y={68 + k * 44} width="58" height="30" rx="3" fill={c.panel2} stroke={c.border} strokeWidth="0.6" />
            <rect x="132" y={68 + k * 44} width="58" height="30" rx="3" fill={c.panel2} stroke={c.border} strokeWidth="0.6" />
            <text x="59" y={87 + k * 44} textAnchor="middle" fontSize="9" fill={c.text}>
              {['one-hot(U)', `Dense(${dim})`, `Emb(${dim})`][k]}
            </text>
            <text x="161" y={87 + k * 44} textAnchor="middle" fontSize="9" fill={c.text}>
              {['one-hot(I)', `Dense(${dim})`, `Emb(${dim})`][k]}
            </text>
          </g>
        ))}
        <line x1="94" y1="122" x2="126" y2="122" stroke={c.accent} strokeWidth="1" />
        <text x="110" y="116" textAnchor="middle" fontSize="9" fill={c.accent}>·</text>
        <text x="110" y="136" textAnchor="middle" fontSize="9" fill={c.muted}>dot/τ</text>
        <text x="20" y="214" fontSize="10" fill={c.text}>当前训练样本</text>
        {cur ? (
          <text x="20" y="230" fontSize="9" fill={c.muted}>
            U{cur.u} · 正 I{cur.pos} · 负 {cur.negs.map((i) => 'I' + i).join(',') || '无'}
          </text>
        ) : (
          <text x="20" y="230" fontSize="9" fill={c.muted}>尚未开始训练（初始 / 结束状态）</text>
        )}
        <text x="20" y="246" fontSize="9" fill={c.muted}>
          softmax 概率 p(item|u) · {cur ? 'loss=' + f2(cur.loss) : 'loss=—'}
        </text>
        {items.map((it, t) => {
          const pr = cur.prob[t] || 0;
          const y = 258 + t * 13;
          const isPos = t === 0;
          return (
            <g key={'pb' + t}>
              <text x="20" y={y + 8} fontSize="9" fill={c.text}>{isPos ? 'I' + it + '+' : 'I' + it}</text>
              <rect x="60" y={y} width="96" height="9" rx="2" fill={c.panel2} />
              <rect x="60" y={y} width={Math.max(0, Math.min(1, pr)) * 96} height="9" rx="2"
                fill={isPos ? c.success : c.danger} opacity="0.85" />
              <text x="160" y={y + 8} fontSize="9" fill={c.text}>{f2(pr)}</text>
            </g>
          );
        })}

        {/* 中：2D embedding 空间 */}
        <rect x="228" y="44" width="265" height="220" rx="4" fill={c.panel} stroke={c.border} strokeWidth="1" />
        {[0.25, 0.5, 0.75].map((f) => (
          <g key={'g' + f}>
            <line x1={228 + f * 265} y1="44" x2={228 + f * 265} y2="264" stroke={c.grid} strokeWidth="0.6" strokeDasharray="3 3" />
            <line x1="228" y1={44 + f * 220} x2="493" y2={44 + f * 220} stroke={c.grid} strokeWidth="0.6" strokeDasharray="3 3" />
          </g>
        ))}
        <line x1="360" y1="44" x2="360" y2="264" stroke={c.grid} strokeWidth="0.8" />
        <line x1="228" y1="154" x2="493" y2="154" stroke={c.grid} strokeWidth="0.8" />

        {/* 梯度方向箭头 */}
        {cur && (() => {
          const u0 = proj(eu[cur.u]);
          const out = [];
          const pp = proj(ei[cur.pos]);
          out.push(arrow(u0.x, u0.y, pp.x, pp.y, c.success, false, 'pos'));
          cur.negs.forEach((ni, t) => {
            const np = proj(ei[ni]);
            out.push(arrow(u0.x, u0.y, np.x, np.y, c.danger, true, 'neg' + t));
          });
          return <g>{out}</g>;
        })()}

        {/* 用户方块 */}
        {Array.from({ length: U }, (_, u) => {
          const q = proj(eu[u]);
          return (
            <g key={'eu' + u}>
              <rect x={q.x - 4} y={q.y - 4} width="8" height="8" rx="1"
                fill={c.series[u % c.series.length]}
                stroke={u === 0 ? c.warning : 'none'} strokeWidth={u === 0 ? 1.5 : 0} />
              <text x={q.x + 6} y={q.y - 4} fontSize="9" fill={c.text}>U{u}</text>
            </g>
          );
        })}
        {/* 物品圆点 */}
        {Array.from({ length: I }, (_, i) => {
          const q = proj(ei[i]);
          const isPos = cur && i === cur.pos;
          const isNeg = cur && cur.negs.includes(i);
          return (
            <g key={'ei' + i}>
              <circle cx={q.x} cy={q.y} r="5" fill={isPos ? c.success : (isNeg ? c.danger : c.accent)}
                stroke={isPos || isNeg ? c.text : 'none'} strokeWidth={isPos || isNeg ? 0.8 : 0} />
              <text x={q.x + 7} y={q.y + 3} fontSize="9" fill={c.text}>I{i}</text>
            </g>
          );
        })}
        <text x="230" y="280" fontSize="9" fill={c.muted}>■ 用户　● 物品　绿色=拉近正样本　红色虚线=推远负样本</text>
        <text x="230" y="296" fontSize="9" fill={c.muted}>坐标为 embedding 前两维投影；箭头方向即本步梯度作用方向。</text>

        {/* 右：召回 Top-3 */}
        {topK.length === 0 ? (
          <text x="505" y="56" fontSize="10" fill={c.muted}>（暂无召回结果）</text>
        ) : topK.map((o, t) => {
          const y = 52 + t * 28;
          return (
            <g key={'tk' + t}>
              <text x="505" y={y + 10} fontSize="10" fill={t === 0 ? c.success : c.text}>{t + 1}. I{o.i}</text>
              <rect x="560" y={y + 2} width="110" height="10" rx="2" fill={c.panel2} />
              <rect x="560" y={y + 2} width={clamp((o.score + 1) / 2, 0, 1) * 110} height="10" rx="2"
                fill={t === 0 ? c.success : c.primary} opacity="0.85" />
              <text x="674" y={y + 10} fontSize="9" fill={c.text}>{f2(o.score)}</text>
            </g>
          );
        })}
        <text x="505" y="140" fontSize="9" fill={c.muted}>训练损失曲线 (−log p正)</text>
        <line x1="505" y1="250" x2="695" y2="250" stroke={c.grid} strokeWidth="1" />
        <line x1="505" y1="150" x2="505" y2="250" stroke={c.grid} strokeWidth="1" />
        {lh.length > 1 && (
          <polyline
            points={lh.map((v, t) => `${505 + (t / (lh.length - 1)) * 190},${250 - (clamp(v, 0, maxL) / maxL) * 96}`).join(' ')}
            fill="none" stroke={c.primary} strokeWidth="1.5" />
        )}
        {lh.length > 0 && (
          <circle cx={505 + ((lh.length - 1) / Math.max(1, lh.length - 1)) * 190}
            cy={250 - (clamp(lh[lh.length - 1], 0, maxL) / maxL) * 96} r="2.8" fill={c.warning} />
        )}
        <text x="505" y="266" fontSize="9" fill={c.muted}>维度={dim} · 温度τ={f2(temp)} · 负样本={nNeg}</text>
        <text x="505" y="282" fontSize="9" fill={c.muted}>p_i = softmax(e_u·e_i / τ)，L = −log p(正样本)</text>
        <text x="505" y="298" fontSize="9" fill={c.muted}>τ 越小梯度越尖锐；负样本越多、步数越多，排序越稳定。</text>

        <line x1="20" y1="332" x2={W - 20} y2="332" stroke={c.grid} strokeWidth="1" />
        <text x="20" y="348" fontSize="9" fill={c.muted}>
          梯度：g_i = (p_i − y_i)/τ；e_u ← e_u − lr·Σ g_i·e_i，e_i ← e_i − lr·g_i·e_u（正样本 y=1，负样本 y=0）。
        </text>
        <text x="20" y="364" fontSize="9" fill={c.muted}>
          用户塔与物品塔各自输出 embedding，线上用近邻检索召回；本演示真实逐步更新并给出 U0 的 Top-3。
        </text>
      </svg>
    );
  },
};
