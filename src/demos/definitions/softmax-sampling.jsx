import React from 'react';
import { mulberry32, clamp, softmax } from '../utils.js';

const W = 720;
const H = 340;
const VOCAB = ['的', '是', '我', '爱', '学', '算', '法', '模型', '数据', '语言'];
const STRATEGY = { greedy: '贪婪', temperature: 'Temperature', topk: 'Top-k', topp: 'Top-p' };
const SHAPE = { uniform: '均匀分布', spiky: '尖峰分布', longtail: '长尾分布', bimodal: '双峰分布' };

function finalize(steps) {
  if (steps.length > 300) {
    const stride = Math.ceil(steps.length / 300);
    return steps.filter((_, i) => i % stride === 0 || i === steps.length - 1);
  }
  const out = steps.slice();
  const last = out[out.length - 1] || { note: '完成', metrics: {} };
  while (out.length < 15) out.push({ ...last, note: '保持最终状态：' + (last.note || '') });
  return out;
}

export default {
  id: 'softmax-sampling',
  params: [
    { key: 'temperature', label: '温度 T', type: 'range', min: 0.1, max: 2, step: 0.1, default: 1 },
    { key: 'topK', label: 'top_k', type: 'range', min: 1, max: 10, step: 1, default: 5 },
    { key: 'topP', label: 'top_p', type: 'range', min: 0, max: 1, step: 0.05, default: 0.9 },
    { key: 'strategy', label: '采样策略', type: 'select', default: 'topk', options: [
      { value: 'greedy', label: '贪婪 (Greedy)' }, { value: 'temperature', label: 'Temperature' },
      { value: 'topk', label: 'Top-k' }, { value: 'topp', label: 'Top-p (核采样)' },
    ] },
    { key: 'distShape', label: 'logits 分布', type: 'select', default: 'longtail', options: [
      { value: 'uniform', label: '均匀分布' }, { value: 'spiky', label: '尖峰分布' },
      { value: 'longtail', label: '长尾分布' }, { value: 'bimodal', label: '双峰分布' },
    ] },
  ],
  height: H,
  legend: [
    { label: '原始 logits' }, { label: '被过滤候选' },
    { label: '归一化概率' }, { label: '采样命中' },
  ],
  hint: '解码采样：logits 除以温度、按策略过滤、softmax 归一化，再按累积概率抽一个 token。',

  buildSteps(p) {
    const V = VOCAB.length;
    const T = clamp(Number(p.temperature) || 1, 0.1, 2);
    const topK = clamp(Math.round(Number(p.topK) || 5), 1, V);
    const topP = clamp(Number(p.topP) || 0.9, 0, 1);
    const strategy = STRATEGY[p.strategy] ? p.strategy : 'topk';
    const shape = SHAPE[p.distShape] ? p.distShape : 'longtail';
    const shapeIdx = ['uniform', 'spiky', 'longtail', 'bimodal'].indexOf(shape);
    const stratIdx = ['greedy', 'temperature', 'topk', 'topp'].indexOf(strategy);

    const rnd = mulberry32(31001 + shapeIdx * 97);
    let logits;
    if (shape === 'uniform') logits = Array.from({ length: V }, () => 1 + rnd() * 0.4);
    else if (shape === 'spiky') logits = Array.from({ length: V }, (_, i) => (i === 2 ? 6 : 0.4) + rnd() * 0.4);
    else if (shape === 'longtail') logits = Array.from({ length: V }, (_, i) => 5 * Math.exp(-i * 0.45) + rnd() * 0.3);
    else logits = Array.from({ length: V }, (_, i) => (i === 1 || i === 7 ? 4.5 : 0.5) + rnd() * 0.4);

    const baseProbs = softmax(logits, T);
    const kept = new Array(V).fill(true);
    if (strategy === 'greedy') {
      const arg = logits.indexOf(Math.max(...logits));
      for (let i = 0; i < V; i++) kept[i] = (i === arg);
    } else if (strategy === 'topk') {
      const order = logits.map((_, i) => i).sort((a, b) => logits[b] - logits[a]);
      const set = new Set(order.slice(0, topK));
      for (let i = 0; i < V; i++) kept[i] = set.has(i);
    } else if (strategy === 'topp') {
      const order = baseProbs.map((_, i) => i).sort((a, b) => baseProbs[b] - baseProbs[a]);
      let cum = 0;
      const set = new Set();
      for (const i of order) { set.add(i); cum += baseProbs[i]; if (cum >= topP) break; }
      if (!set.size) set.add(order[0]);
      for (let i = 0; i < V; i++) kept[i] = set.has(i);
    }
    const filtered = logits.map((z, i) => (kept[i] ? z : -Infinity));
    const probs = softmax(filtered, T);
    const entropy = -probs.reduce((s, pr) => s + (pr > 0 ? pr * Math.log(pr + 1e-12) : 0), 0);
    const maxProb = Math.max(...probs);
    const keptCount = kept.filter(Boolean).length;

    const cumProbs = [];
    let acc = 0;
    for (let i = 0; i < V; i++) { acc += probs[i]; cumProbs.push(acc); }
    const useed = 71001 + Math.round(T * 10) * 13 + topK * 17 + Math.round(topP * 100) * 7
      + stratIdx * 101 + shapeIdx * 37;
    const u = mulberry32(useed)();
    let sampled = V - 1;
    for (let i = 0; i < V; i++) { if (u <= cumProbs[i]) { sampled = i; break; } }

    const minL = Math.min(...logits), maxL = Math.max(...logits);
    const steps = [];
    const push = (note, phase, extra = {}) => steps.push({
      vocab: VOCAB, logits, baseProbs, kept, filtered, probs, cumProbs,
      u, sampled, entropy, maxProb, keptCount, strategy, T, topK, topP, shape,
      minL, maxL, phase, visibleCount: V, visibleFilter: V, visibleProbs: V, hitIdx: -1,
      note,
      metrics: {
        策略: STRATEGY[strategy],
        温度: T,
        候选数: keptCount,
        被过滤数: V - keptCount,
        最大概率: Number(maxProb.toFixed(3)),
        熵: Number(entropy.toFixed(3)),
        采样结果: VOCAB[sampled],
      },
      ...extra,
    });

    for (let i = 0; i < V; i++) {
      push(`原始 logits：token「${VOCAB[i]}」得分 ${logits[i].toFixed(2)}，分布形状为${SHAPE[shape]}。`,
        'logits', { visibleCount: i + 1 });
    }
    push(`温度缩放：logits / T（T=${T}），${T < 1 ? '分布变尖、大者更突出' : (T > 1 ? '分布变平、概率更均匀' : '温度不改变形状')}；下图为全词表基础概率。`,
      'base');
    for (let i = 0; i < V; i++) {
      push(`按${STRATEGY[strategy]}策略判断「${VOCAB[i]}」：${kept[i] ? '保留为候选' : '被过滤（置灰）'}。`,
        'filter', { visibleFilter: i + 1 });
    }
    for (let i = 0; i < V; i++) {
      push(`归一化概率：p(「${VOCAB[i]}」) = ${probs[i].toFixed(3)}，被过滤项概率为 0。`,
        'probs', { visibleProbs: i + 1, visibleFilter: V });
    }
    push(`累积分布：掷随机数 u = ${u.toFixed(3)}，沿累积概率找到第一个 ≥ u 的 token。`,
      'cum', { visibleFilter: V, visibleProbs: V });
    push(`命中：采样结果是「${VOCAB[sampled]}」，其概率 ${probs[sampled].toFixed(3)}。`,
      'sample', { visibleFilter: V, visibleProbs: V, hitIdx: sampled });
    push(`完成：${STRATEGY[strategy]} 下候选 ${keptCount}/${V}，熵 ${entropy.toFixed(3)}，输出「${VOCAB[sampled]}」。`,
      'done', { visibleFilter: V, visibleProbs: V, hitIdx: sampled });
    return finalize(steps);
  },

  render(snap, p, c) {
    const vocab = snap.vocab || [];
    const logits = snap.logits || [];
    const baseProbs = snap.baseProbs || [];
    const probs = snap.probs || [];
    const kept = snap.kept || [];
    const cumProbs = snap.cumProbs || [];
    const phase = snap.phase || 'logits';
    const V = vocab.length || 10;
    const visCount = snap.visibleCount ?? V;
    const visFilter = snap.visibleFilter ?? V;
    const visProbs = snap.visibleProbs ?? V;
    const hitIdx = snap.hitIdx ?? -1;
    const T = snap.T || 1;
    const minL = snap.minL ?? 0, maxL = snap.maxL ?? 1;
    const u = snap.u ?? 0;
    const sampled = snap.sampled ?? 0;

    const bw = 62, gap = 68;
    const bx = (i) => 20 + i * gap;
    const topBase = 160, botBase = 300;

    const upper = [];
    upper.push(<text key="ut" x={20} y={48} fontSize="11" fill={c.text}>原始 logits（灰 = 被过滤的候选）</text>);
    const filterActive = ['filter', 'probs', 'cum', 'sample', 'done'].includes(phase);
    for (let i = 0; i < V; i++) {
      if (i >= visCount && phase === 'logits') continue;
      const v = logits[i] || 0;
      const h = 8 + ((v - minL) / (maxL - minL + 1e-6)) * 84;
      const filtered = filterActive && i < visFilter && kept[i] === false;
      upper.push(<g key={`u${i}`}>
        <rect x={bx(i)} y={topBase - h} width={bw} height={h} rx={2}
          fill={filtered ? c.muted : c.primary} opacity={filtered ? 0.28 : 0.72} />
        <text x={bx(i) + bw / 2} y={topBase - h - 4} textAnchor="middle" fontSize="9"
          fill={filtered ? c.muted : c.text}>{v.toFixed(1)}</text>
        <text x={bx(i) + bw / 2} y={topBase + 13} textAnchor="middle" fontSize="10" fill={c.text}>{vocab[i]}</text>
        {filtered && <text x={bx(i) + bw / 2} y={topBase + 25} textAnchor="middle" fontSize="9" fill={c.muted}>过滤</text>}
      </g>);
    }

    const showP = phase === 'base' ? baseProbs : probs;
    const dispMax = Math.max(1e-6, ...(showP.length ? showP : [1]));
    const lower = [];
    lower.push(<text key="lt" x={20} y={196} fontSize="11" fill={c.text}>
      {phase === 'base' ? '温度缩放后的全词表概率' : '过滤后归一化概率（绿 = 采样命中）'}
    </text>);
    for (let i = 0; i < V; i++) {
      if (i >= visProbs && phase === 'probs') continue;
      const pr = showP[i] || 0;
      const h = (pr / dispMax) * 88;
      if (h < 0.5) continue;
      const hit = (phase === 'sample' || phase === 'done') && i === hitIdx;
      lower.push(<g key={`l${i}`}>
        <rect x={bx(i)} y={botBase - h} width={bw} height={h} rx={2}
          fill={hit ? c.success : c.primary} opacity={hit ? 0.95 : 0.68} />
        <text x={bx(i) + bw / 2} y={botBase - h - 4} textAnchor="middle" fontSize="9" fill={c.text}>
          {pr.toFixed(2)}
        </text>
        {hit && <text x={bx(i) + bw / 2} y={botBase + 13} textAnchor="middle" fontSize="9" fill={c.success}>采样</text>}
      </g>);
    }

    const cumG = [];
    if (['cum', 'sample', 'done'].includes(phase)) {
      const pts = cumProbs.map((cp, i) => `${(bx(i) + bw / 2).toFixed(1)},${(botBase - cp * 88).toFixed(1)}`).join(' ');
      cumG.push(<polyline key="pl" points={pts} fill="none" stroke={c.warning} strokeWidth="1.4" />);
      const uy = botBase - u * 88;
      cumG.push(<line key="ul" x1={20} y1={uy} x2={700} y2={uy}
        stroke={c.danger} strokeWidth="1" strokeDasharray="4 3" />);
      cumG.push(<text key="ut2" x={700} y={uy - 3} textAnchor="end" fontSize="9" fill={c.danger}>
        {`u=${u.toFixed(3)}`}
      </text>);
    }

    const sname = STRATEGY[snap.strategy] || '';
    const shname = SHAPE[snap.shape] || '';
    const head1 = `策略 ${sname} · T=${T} · top_k=${snap.topK} · top_p=${snap.topP} · 分布 ${shname}`;
    const head2 = `熵 H=${(snap.entropy || 0).toFixed(3)} · 最大概率 ${(snap.maxProb || 0).toFixed(3)}`
      + ` · 候选 ${snap.keptCount ?? V}/${V} · ${T < 1 ? '温度低 → 分布变尖' : (T > 1 ? '温度高 → 分布变平' : '温度为 1')}`;

    return (
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} preserveAspectRatio="xMidYMid meet">
        <text x={20} y={18} fontSize="10" fill={c.text}>{head1}</text>
        <text x={20} y={33} fontSize="10" fill={c.muted}>{head2}</text>
        {upper}
        <line x1={20} y1={topBase} x2={700} y2={topBase} stroke={c.grid} strokeWidth="1" />
        {lower}
        {cumG}
        <line x1={20} y1={botBase} x2={700} y2={botBase} stroke={c.grid} strokeWidth="1" />
        {(phase === 'sample' || phase === 'done') && <text x={20} y={326} fontSize="11" fill={c.success}>
          {`采样结果 → 「${vocab[sampled] || ''}」（累积概率命中）`}
        </text>}
        {phase === 'cum' && <text x={20} y={326} fontSize="10" fill={c.muted}>
          虚线为随机数 u，折线为累积概率，命中点是折线首次高于虚线的位置
        </text>}
      </svg>
    );
  },
};
