import React from 'react';
import { clamp } from '../utils.js';
import { Frame, fmt } from '../kits/primitives.jsx';

const H = 360;
const D = 8;
const SENTENCES = [
  { key: 'pos', text: '这家餐厅的味道很好，服务也很周到', label: '好评', bias: [0.9, -0.4, 0.2] },
  { key: 'neg', text: '电影情节拖沓，结局让人失望', label: '差评', bias: [-0.5, 1.0, 0.1] },
  { key: 'neu', text: '算法题不难，但是边界条件很多', label: '中性', bias: [-0.2, -0.5, 1.8] },
];
const LABELS = ['好评', '差评', '中性'];
const CLASS_W = [
  [1.2, -0.8, 0.6, -0.4, 0.9, -0.3, 0.5, 0.2],
  [-0.9, 1.1, -0.5, 0.8, -0.2, 0.6, -0.7, 0.4],
  [0.2, -0.1, 0.7, 0.3, -0.6, 0.9, 0.1, -0.4],
];

function embed(chars) {
  return chars.map((ch, i) => {
    const code = ch.codePointAt(0) || 0;
    return Array.from({ length: D }, (_, d) => {
      const a = Math.sin(code * 0.017 + d * 0.9 + i * 0.11);
      const b = Math.cos(code * 0.031 + d * 0.37);
      return Number((0.55 * a + 0.45 * b).toFixed(4));
    });
  });
}

function project(vecs, head) {
  const q = vecs.map((v) => v.map((x, d) => Number((0.9 * v[(d + head) % D] + 0.1 * x).toFixed(4))));
  const k = vecs.map((v) => v.map((x, d) => Number((0.8 * v[(d + head * 2) % D] - 0.05 * x).toFixed(4))));
  const value = vecs.map((v) => v.map((_, d) => Number(v[(d + head * 3) % D].toFixed(4))));
  return { q, k, v: value };
}

function attention(q, k, v) {
  const n = q.length;
  const scores = Array.from({ length: n }, () => Array.from({ length: n }, () => 0));
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      let s = 0;
      for (let d = 0; d < D; d++) s += q[i][d] * k[j][d];
      scores[i][j] = Number((s / Math.sqrt(D)).toFixed(4));
    }
  }
  const attn = scores.map((row) => {
    const m = Math.max(...row);
    const ex = row.map((s) => Math.exp(s - m));
    const sum = ex.reduce((a, b) => a + b, 0);
    return ex.map((e) => Number((e / sum).toFixed(4)));
  });
  const out = Array.from({ length: n }, () => Array.from({ length: D }, () => 0));
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      for (let d = 0; d < D; d++) out[i][d] += attn[i][j] * v[j][d];
    }
  }
  return { attn, out: out.map((row) => row.map((x) => Number(x.toFixed(4)))) };
}

function addNorm(old, attended) {
  const mixed = old.map((row, i) => row.map((v, d) => 0.5 * v + 0.5 * attended[i][d]));
  return mixed.map((row) => {
    const mean = row.reduce((a, b) => a + b, 0) / row.length;
    const varc = row.reduce((a, b) => a + (b - mean) * (b - mean), 0) / row.length;
    const sd = Math.sqrt(varc) + 1e-6;
    return row.map((v) => Number(((v - mean) / sd).toFixed(4)));
  });
}

function ffn(vecs) {
  return vecs.map((row) => row.map((v) => Number(Math.tanh(v * 1.15).toFixed(4))));
}

function softmax(v) {
  const m = Math.max(...v);
  const ex = v.map((x) => Math.exp(x - m));
  const s = ex.reduce((a, b) => a + b, 0);
  return ex.map((e) => Number((e / s).toFixed(4)));
}

export default {
  id: 'text-transformer',
  params: [
    { key: 'sentence', label: '输入文本', type: 'select', default: 'pos', options: SENTENCES.map((s) => ({ value: s.key, label: s.text })) },
    { key: 'layers', label: '堆叠 Block 层数', type: 'range', min: 1, max: 4, step: 1, default: 2 },
    { key: 'heads', label: '注意力头数', type: 'range', min: 1, max: 4, step: 1, default: 2 },
  ],
  height: H,
  legend: [
    { label: '当前 token', color: '#f5a524' },
    { label: '高注意力', color: '#226AFF' },
    { label: '弱注意力', color: '#e2e6f0' },
  ],
  hint: '同一句话逐层经过多头自注意力与前馈网络；观察每个字对其它字的关注如何随层数变化，最后汇聚成情感分类。',

  buildSteps(p) {
    const conf = SENTENCES.find((s) => s.key === p.sentence) || SENTENCES[0];
    const layers = clamp(Math.round(Number(p.layers) || 2), 1, 4);
    const heads = clamp(Math.round(Number(p.heads) || 2), 1, 4);
    const chars = Array.from(conf.text);
    let x = embed(chars);
    const steps = [];
    const push = (o) => steps.push({
      sentence: conf.key, text: conf.text, label: conf.label, chars, layers, heads,
      tokens: chars, vecs: x, layer: 0, head: 0, attn: [], row: -1,
      stage: 'intro', probs: [0.34, 0.33, 0.33],
      ...o,
      metrics: {
        Block层数: o.layer || 0,
        注意力头: o.head || 0,
        token数: chars.length,
        ...(o.metrics || {}),
      },
    });

    push({ note: `输入句子：「${conf.text}」。中文按字切成 ${chars.length} 个 token，每个 token 映射成 ${D} 维向量。`, metrics: { Block层数: 0, 注意力头: 0 } });
    push({ stage: 'embed', note: `词嵌入查表完成：得到 [1, ${chars.length}, ${D}] 的张量，接下来的每一层都保持这个形状。`,
      metrics: { Block层数: 0, 注意力头: 0, 张量维度: `${chars.length}×${D}` } });

    for (let li = 0; li < layers; li++) {
      push({ stage: 'proj', layer: li + 1,
        note: `第 ${li + 1}/${layers} 层：先把输入投影成 Q/K/V，每个头使用不同的子空间，关注不同的语法或语义关系。` });
      for (let hi = 0; hi < heads; hi++) {
        const { q, k, v } = project(x, hi);
        const res = attention(q, k, v);
        push({ stage: 'attn', layer: li + 1, head: hi + 1, attn: res.attn,
          note: `第 ${li + 1} 层 · 第 ${hi + 1}/${heads} 头：QKᵀ/√d 得到 ${chars.length}×${chars.length} 注意力矩阵，逐行 softmax 后作为加权权重。`,
          metrics: { Block层数: li + 1, 注意力头: hi + 1 } });
        for (let r = 0; r < Math.min(chars.length, 12); r++) {
          push({ stage: 'attn-row', layer: li + 1, head: hi + 1, attn: res.attn, row: r,
            note: `token「${chars[r]}」对全句打分：当前行最大值 ${fmt(Math.max(...res.attn[r]), 2)}，据此从其它 token 聚合信息。`,
            metrics: { Block层数: li + 1, 注意力头: hi + 1, 最大权重: Math.max(...res.attn[r]) } });
        }
        x = addNorm(x, res.out);
      }
      push({ stage: 'ffn', layer: li + 1,
        note: `残差相加 + 层归一化后进入 FFN：逐 token 做非线性变换，再残差相加输出本 Block 的结果。` });
      push({ stage: 'layer-done', layer: li + 1,
        note: `第 ${li + 1} 层结束：输出仍是 [1, ${chars.length}, ${D}]，可继续堆叠下一层继续抽象。` });
    }

    const pooled = Array.from({ length: D }, (_, d) =>
      Number((x.reduce((s, row) => s + row[d], 0) / x.length).toFixed(4)));
    push({ stage: 'pool', layer: layers, head: heads, vecs: x,
      note: `全局平均池化：把 ${chars.length} 个 token 的表示沿序列维取平均，得到整句的 ${D} 维摘要向量。`,
      metrics: { Block层数: layers, 注意力头: heads, 池化维度: D } });

    const logits = LABELS.map((_, i) => Number((
      pooled.reduce((s, v, d) => s + v * CLASS_W[i][d], 0) + conf.bias[i]
    ).toFixed(4)));
    push({ stage: 'classify', layer: layers, head: heads, vecs: x, logits,
      note: `分类头：用 3 组权重把句子摘要映射成「好评 / 差评 / 中性」三个分数。`,
      metrics: { Block层数: layers, 注意力头: heads } });

    const probs = softmax(logits);
    const best = probs.indexOf(Math.max(...probs));
    push({ stage: 'done', layer: layers, head: heads, vecs: x, logits, probs,
      note: `分类完成：好评 ${fmt(probs[0] * 100, 1)}%，差评 ${fmt(probs[1] * 100, 1)}%，中性 ${fmt(probs[2] * 100, 1)}%；预测为「${LABELS[best]}」。`,
      metrics: { Block层数: layers, 注意力头: heads, 预测: LABELS[best] } });
    return steps;
  },

  render(snap, p, c) {
    const chars = snap.chars || [];
    const attn = snap.attn || [];
    const probs = snap.probs || [0.34, 0.33, 0.33];
    const layers = Number(snap.layers || 2);
    const heads = Number(snap.heads || 2);
    const layer = Number(snap.layer || 0);
    const head = Number(snap.head || 0);
    const row = Number(snap.row ?? -1);
    const stage = snap.stage || 'intro';
    const n = chars.length || 1;
    const tokCell = Math.min(24, 640 / n);
    const tokX = 20;
    const heatCell = Math.min(10, 150 / n);
    const heatX = 190, heatY = 96;

    const tokens = chars.map((ch, i) => {
      const active = stage === 'attn-row' && i === row;
      return (
        <g key={`t-${i}`}>
          <rect x={tokX + i * (tokCell + 2)} y="64" width={tokCell} height={tokCell} rx="3"
            fill={active ? c.warning : (stage === 'embed' ? c.teal : c.panel2)} opacity={active ? 0.95 : 0.85} />
          <text x={tokX + i * (tokCell + 2) + tokCell / 2} y={64 + tokCell / 2 + 4}
            fontSize={tokCell >= 18 ? 11 : 9} textAnchor="middle"
            fill={active ? c.bg : c.text}>{String(ch)}</text>
        </g>
      );
    });

    const heat = attn.length ? attn.map((r, i) => r.map((v, j) => {
      const val = clamp(Number(v) || 0, 0, 1);
      return (
        <rect key={`a-${i}-${j}`} x={heatX + j * heatCell} y={heatY + i * heatCell}
          width={Math.max(2, heatCell - 0.6)} height={Math.max(2, heatCell - 0.6)}
          fill={c.primary} opacity={0.05 + 0.9 * val} />
      );
    })) : (
      <text x={heatX} y={heatY + 20} fontSize="10" fill={c.muted}>等待注意力计算…</text>
    );
    if (row >= 0 && attn.length) {
      heat.push(<rect key="row-mark" x={heatX - 2} y={heatY + row * heatCell - 1}
        width={n * heatCell + 3} height={Math.max(2, heatCell + 1)} fill="none" stroke={c.warning} strokeWidth="1.5" />);
    }

    const stack = Array.from({ length: layers }, (_, i) => {
      const on = layer === i + 1;
      return (
        <g key={`l-${i}`}>
          <rect x="20" y={116 + i * 30} width="130" height="24" rx="5"
            fill={on ? c.primary : c.panel2} opacity={on ? 0.95 : 0.75} />
          <text x="32" y={132 + i * 30} fontSize="10" fill={on ? c.bg : c.muted}>
            Block {i + 1} · {String(heads)} 头
          </text>
        </g>
      );
    });

    return (
      <Frame c={c} height={H} title="多层 Transformer · 中文文本理解"
        subtitle={`${String(snap.text || '')} · ${String(stage)}`}>
        <text x="20" y="52" fontSize="10" fill={c.muted}>输入 token（逐字切分）</text>
        {tokens}
        <text x="190" y="76" fontSize="10" fill={c.muted}>注意力矩阵 token × token</text>
        {heat}
        {stack}
        <text x="470" y="76" fontSize="10" fill={c.muted}>情感分类</text>
        {probs.map((v, i) => {
          const pv = clamp(Number(v) || 0, 0, 1);
          const y = 96 + i * 46;
          return (
            <g key={`p-${i}`}>
              <text x="470" y={y + 11} fontSize="10" fill={c.muted}>{String(LABELS[i])}</text>
              <rect x="522" y={y} width="170" height="16" rx="4" fill={c.panel2} />
              <rect x="522" y={y} width={170 * pv} height="16" rx="4"
                fill={c.series[i % c.series.length]} opacity="0.9" />
              <text x="700" y={y + 12} fontSize="9" textAnchor="end" fill={c.text}>{fmt(pv * 100, 1)}%</text>
            </g>
          );
        })}
        <text x="470" y="250" fontSize="10" fill={c.muted}>
          {stage === 'attn' || stage === 'attn-row' ? `第 ${layer} 层 · 第 ${head} 头` : `当前阶段：${String(stage)}`}
        </text>
        <text x="20" y={H - 14} fontSize="10" fill={c.muted}>
          {stage === 'done' ? '输出：句子级情感标签' : '每个 Block 都保持 [1, token 数, 维度] 形状，可继续堆叠'}
        </text>
      </Frame>
    );
  },
};
