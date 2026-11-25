import React from 'react';
import { mulberry32, clamp, softmax } from '../utils.js';

const W = 720;
const H = 340;

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

function matmul(A, B) {
  const m = A.length, k = (A[0] || []).length, n = (B[0] || []).length;
  const out = Array.from({ length: m }, () => new Array(n).fill(0));
  for (let i = 0; i < m; i++) {
    for (let t = 0; t < k; t++) {
      const a = A[i][t];
      if (!a) continue;
      for (let j = 0; j < n; j++) out[i][j] += a * ((B[t] && B[t][j]) || 0);
    }
  }
  return out;
}
function addM(A, B) {
  return A.map((r, i) => r.map((v, j) => v + ((B[i] && B[i][j]) || 0)));
}
function layerNorm(X) {
  return X.map((row) => {
    const m = row.reduce((a, b) => a + b, 0) / row.length;
    const v = row.reduce((a, b) => a + (b - m) * (b - m), 0) / row.length;
    const s = Math.sqrt(v) + 1e-5;
    return row.map((x) => (x - m) / s);
  });
}
function mhaForward(Xq, Xkv, Wq, Wk, Wv, Wo, heads, n, dModel) {
  const dk = dModel / heads;
  const Q = matmul(Xq, Wq), K = matmul(Xkv, Wk), V = matmul(Xkv, Wv);
  const Z = Array.from({ length: n }, () => new Array(dModel).fill(0));
  const attnHeads = [];
  for (let h = 0; h < heads; h++) {
    const sl = (r) => r.slice(h * dk, (h + 1) * dk);
    const Qh = Q.map(sl), Kh = K.map(sl), Vh = V.map(sl);
    const scores = Qh.map((qi) => Kh.map((kj) =>
      qi.reduce((s, v, t) => s + v * kj[t], 0) / Math.sqrt(dk)));
    const attn = scores.map((r) => softmax(r, 1));
    const oh = attn.map((row) => Array.from({ length: dk }, (_, t) =>
      row.reduce((s, w, j) => s + w * Vh[j][t], 0)));
    for (let i = 0; i < n; i++) for (let t = 0; t < dk; t++) Z[i][h * dk + t] = oh[i][t];
    attnHeads.push(attn);
  }
  return { out: matmul(Z, Wo), attnHeads };
}
function statsOf(T) {
  const f = T.flat();
  if (!f.length) return { mean: 0, std: 0, norm: 0 };
  const mean = f.reduce((a, b) => a + b, 0) / f.length;
  const varr = f.reduce((a, b) => a + (b - mean) * (b - mean), 0) / f.length;
  return { mean, std: Math.sqrt(varr), norm: Math.sqrt(f.reduce((a, b) => a + b * b, 0)) };
}

export default {
  id: 'transformer-block',
  params: [
    { key: 'seqLen', label: '序列长度', type: 'range', min: 2, max: 8, step: 1, default: 4 },
    { key: 'dModel', label: 'd_model', type: 'range', min: 8, max: 64, step: 8, default: 32 },
    { key: 'heads', label: '头数', type: 'select', default: '4', options: [
      { value: '1', label: '1 头' }, { value: '2', label: '2 头' },
      { value: '4', label: '4 头' }, { value: '8', label: '8 头' },
    ] },
    { key: 'crossAttn', label: '走 cross-attention', type: 'toggle', default: false },
  ],
  height: H,
  legend: [
    { label: '当前激活模块' }, { label: '张量激活值' },
    { label: '注意力权重' }, { label: '残差与归一化' },
  ],
  hint: 'Transformer Block：MHA → Add&Norm → FFN → Add&Norm，每步都标注张量形状 [batch, seq, d]。',

  buildSteps(p) {
    const n = clamp(Math.round(Number(p.seqLen) || 4), 2, 8);
    const dModel = clamp(Math.round(Number(p.dModel) || 32), 8, 64);
    const heads = clamp(Math.round(Number(p.heads) || 4), 1, 8);
    const cross = !!p.crossAttn;
    const dk = dModel / heads;

    const rnd = mulberry32(91001 + n * 31 + dModel * 7 + heads);
    const randMat = (r, co) => Array.from({ length: r }, () =>
      Array.from({ length: co }, () => (rnd() * 2 - 1) * 0.6));
    const X = randMat(n, dModel);
    const Wq = randMat(dModel, dModel), Wk = randMat(dModel, dModel);
    const Wv = randMat(dModel, dModel), Wo = randMat(dModel, dModel);
    const W1 = randMat(dModel, 4 * dModel), W2 = randMat(4 * dModel, dModel);
    const E = randMat(n, dModel);

    const mha = mhaForward(X, X, Wq, Wk, Wv, Wo, heads, n, dModel);
    const MHA_out = mha.out, attnHeads = mha.attnHeads;
    const Y1 = layerNorm(addM(X, MHA_out));
    let crossAttnHeads = [], crossOut = null, Y1b = Y1;
    if (cross) {
      const cr = mhaForward(Y1, E, Wq, Wk, Wv, Wo, heads, n, dModel);
      crossAttnHeads = cr.attnHeads;
      crossOut = cr.out;
      Y1b = layerNorm(addM(Y1, crossOut));
    }
    const Hpre = matmul(Y1b, W1);
    const Hact = Hpre.map((r) => r.map((v) => Math.max(0, v)));
    const F = matmul(Hact, W2);
    const Y2 = layerNorm(addM(Y1b, F));
    const paramCount = 4 * dModel * dModel + 2 * dModel * (4 * dModel);

    const norm = (M) => (M || []).map((r) => {
      const rr = r || [];
      return Array.from({ length: dModel }, (_, k) => rr[k] ?? 0);
    });
    const ffIdx = cross ? 5 : 3, an2Idx = ffIdx + 1, outIdx = ffIdx + 2;
    const modules = [
      { name: '输入嵌入 X', sub: `[1, ${n}, ${dModel}]` },
      { name: '多头自注意力 MHA', sub: `[1, ${heads}, ${n}, ${dk}]` },
      { name: 'Add & Norm ①', sub: `[1, ${n}, ${dModel}]` },
    ];
    if (cross) modules.push(
      { name: '交叉注意力 Cross-Attn', sub: 'Q←解码, K/V←编码' },
      { name: 'Add & Norm', sub: `[1, ${n}, ${dModel}]` });
    modules.push(
      { name: '前馈网络 FFN', sub: `[1, ${n}, ${4 * dModel}]` },
      { name: 'Add & Norm ②', sub: `[1, ${n}, ${dModel}]` },
      { name: '输出 Y', sub: `[1, ${n}, ${dModel}]` });

    const S = [];
    const add = (note, phase, o = {}) => S.push({
      note, phase, activeStage: 0, tensor: X, shapeLabel: `[1, ${n}, ${dModel}]`,
      attn: attnHeads[0], attnLabel: '头 1', head: 0, visibleTokens: n, cross,
      n, dModel, heads, dk, modules, ...o,
    });

    add('Transformer Block：输入先经多头自注意力，再做残差与层归一化。', 'intro');
    add(`输入 X 的形状为 [1, ${n}, ${dModel}]，共 ${n * dModel} 个激活值。`, 'input');
    for (let i = 0; i < n; i++) {
      add(`逐 token 装载输入：第 ${i + 1} 行（token ${i}）的 ${dModel} 维向量进入计算流。`,
        'embed', { visibleTokens: i + 1 });
    }
    add('MHA·投影：X 分别乘 W_Q / W_K / W_V 生成 Q、K、V，并按头切分。', 'mha-qkv',
      { activeStage: 1, shapeLabel: `[1, ${heads}, ${n}, ${dk}]`, tensor: X });
    for (let h = 0; h < heads; h++) {
      add(`MHA·头 ${h + 1}：计算 Q·Kᵀ/√d_k 与 softmax，得 ${n}×${n} 注意力权重。`, 'mha-attn',
        { activeStage: 1, head: h, attn: attnHeads[h], attnLabel: `头 ${h + 1}`,
          shapeLabel: `[1, ${heads}, ${n}, ${n}]` });
    }
    add('MHA·拼接：各头输出 concat 后乘 W_O，回到 d_model 维。', 'mha-concat',
      { activeStage: 1, tensor: MHA_out });
    add('Add&Norm①·残差：逐元素相加 X + MHA(X)。', 'addnorm1-res',
      { activeStage: 2, tensor: addM(X, MHA_out) });
    add('Add&Norm①·层归一化：每行减均值、除标准差，稳定激活分布。', 'addnorm1-norm',
      { activeStage: 2, tensor: Y1 });
    if (cross) {
      add('Cross-Attn·投影：Q 来自解码端，K/V 来自编码输出 E。', 'cross-qkv',
        { activeStage: 3, tensor: Y1 });
      for (let h = 0; h < heads; h++) {
        add(`Cross-Attn·头 ${h + 1}：解码 query 对编码 key 打分并 softmax。`, 'cross-attn',
          { activeStage: 3, head: h, attn: crossAttnHeads[h], attnLabel: `头 ${h + 1}` });
      }
      add('Cross-Attn·拼接：加权 V 后投影，注入编码端信息。', 'cross-concat',
        { activeStage: 3, tensor: crossOut || Y1 });
      add('Cross·残差：Y₁ + CrossAttn(Y₁)。', 'cross-res',
        { activeStage: 4, tensor: addM(Y1, crossOut || Y1) });
      add('Cross·层归一化：得到送入 FFN 的张量。', 'cross-norm',
        { activeStage: 4, tensor: Y1b });
    }
    add(`FFN·升维：乘 W₁ 把 d_model=${dModel} 扩展到 4·d_model=${4 * dModel}。`, 'ffn-up',
      { activeStage: ffIdx, tensor: Hpre, shapeLabel: `[1, ${n}, ${4 * dModel}]` });
    add('FFN·激活：ReLU 把负值置零，引入非线性。', 'ffn-act',
      { activeStage: ffIdx, tensor: Hact, shapeLabel: `[1, ${n}, ${4 * dModel}]` });
    add('FFN·降维：乘 W₂ 投影回 d_model 维。', 'ffn-down',
      { activeStage: ffIdx, tensor: F });
    add('Add&Norm②·残差：逐元素相加 FFN 输入与输出。', 'addnorm2-res',
      { activeStage: an2Idx, tensor: addM(Y1b, F) });
    add('Add&Norm②·层归一化：得到本 Block 的输出。', 'addnorm2-norm',
      { activeStage: an2Idx, tensor: Y2 });
    for (let i = 0; i < n; i++) {
      add(`输出：第 ${i + 1} 个 token 的 ${dModel} 维表示写出，形状保持 [1, ${n}, ${dModel}]。`, 'output',
        { activeStage: outIdx, tensor: Y2, visibleTokens: i + 1 });
    }
    add(`完成：一个 Block 含约 ${paramCount} 个可训练参数，输入输出形状一致，可堆叠 N 层。`, 'done',
      { activeStage: outIdx, tensor: Y2 });

    const steps = S.map((s) => {
      const tensor = norm(s.tensor);
      const st = statsOf(tensor);
      return {
        ...s, tensor,
        note: s.note,
        metrics: {
          序列长度: n,
          d_model: dModel,
          头数: heads,
          当前模块: s.modules[s.activeStage] ? s.modules[s.activeStage].name : '',
          张量形状: s.shapeLabel,
          均值: Number(st.mean.toFixed(3)),
          标准差: Number(st.std.toFixed(3)),
          参数量: paramCount,
        },
      };
    });
    return finalize(steps);
  },

  render(snap, p, c) {
    const n = snap.n || 2;
    const dModel = snap.dModel || 8;
    const modules = snap.modules || [];
    const activeStage = snap.activeStage ?? 0;
    const tensor = snap.tensor || [];
    const attn = snap.attn || [];
    const phase = snap.phase || 'intro';
    const visibleTokens = snap.visibleTokens ?? n;
    const shapeLabel = snap.shapeLabel || `[1, ${n}, ${dModel}]`;
    const st = (() => {
      const f = tensor.flat();
      if (!f.length) return { mean: 0, std: 0, norm: 0 };
      const m = f.reduce((a, b) => a + b, 0) / f.length;
      const v = f.reduce((a, b) => a + (b - m) * (b - m), 0) / f.length;
      return { mean: m, std: Math.sqrt(v), norm: Math.sqrt(f.reduce((a, b) => a + b * b, 0)) };
    })();

    const boxY = (i) => 30 + i * 38;
    const boxes = modules.map((m, i) => {
      const on = i === activeStage;
      return (<g key={`m${i}`}>
        <rect x={20} y={boxY(i)} width={220} height={32} rx={4}
          fill={on ? c.primary : c.panel2} opacity={on ? 0.24 : 0.45}
          stroke={on ? c.warning : c.border} strokeWidth={on ? 1.5 : 0.6} />
        <text x={28} y={boxY(i) + 14} fontSize="10" fill={on ? c.warning : c.text}>{m.name}</text>
        <text x={28} y={boxY(i) + 27} fontSize="9" fill={c.muted}>{m.sub}</text>
        {i < modules.length - 1 && <line x1={130} y1={boxY(i) + 32} x2={130} y2={boxY(i) + 38}
          stroke={c.grid} strokeWidth="1" />}
      </g>);
    });

    const heat = [];
    heat.push(<text key="ht" x={260} y={36} fontSize="11" fill={c.text}>当前张量激活值（行=token，列=维度）</text>);
    const cw = Math.min(14, 420 / dModel), ch = Math.min(18, 150 / n);
    for (let q = 0; q < n; q++) {
      for (let k = 0; k < dModel; k++) {
        const v = (tensor[q] || [])[k] || 0;
        const active = q < visibleTokens;
        heat.push(<rect key={`h${q}-${k}`} x={260 + k * cw} y={44 + q * ch}
          width={Math.max(1, cw - 0.8)} height={Math.max(1, ch - 0.8)} rx={0.6}
          fill={v >= 0 ? c.primary : c.danger}
          opacity={active ? 0.12 + 0.7 * Math.min(1, Math.abs(v)) : 0.12} />);
      }
    }
    heat.push(<text key="sl" x={260} y={196} fontSize="10" fill={c.warning}>形状 {shapeLabel}</text>);

    const attnG = [];
    attnG.push(<text key="at" x={260} y={216} fontSize="10" fill={c.text}>
      注意力权重 · {snap.attnLabel || '头 1'}
    </text>);
    const ac = Math.min(14, 92 / n);
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        const v = (attn[i] || [])[j] || 0;
        attnG.push(<rect key={`a${i}-${j}`} x={260 + j * ac} y={222 + i * ac}
          width={Math.max(1, ac - 1)} height={Math.max(1, ac - 1)} rx={1}
          fill={c.primary} opacity={0.1 + 0.85 * v} />);
      }
    }

    const phaseName = {
      intro: '总览', input: '输入', embed: '装载输入', 'mha-qkv': 'Q/K/V 投影',
      'mha-attn': '多头注意力', 'mha-concat': '拼接 W_O', 'addnorm1-res': '残差相加',
      'addnorm1-norm': '层归一化', 'cross-qkv': '交叉投影', 'cross-attn': '交叉注意力',
      'cross-concat': '交叉拼接', 'cross-res': '残差', 'cross-norm': '归一化',
      'ffn-up': 'FFN 升维', 'ffn-act': 'ReLU', 'ffn-down': 'FFN 降维',
      'addnorm2-res': '残差相加', 'addnorm2-norm': '层归一化', output: '写出输出', done: '完成',
    }[phase] || '';
    const infoLines = [
      `阶段：${phaseName}`,
      `均值 ${st.mean.toFixed(3)} · 标准差 ${st.std.toFixed(3)}`,
      `L2 范数 ${st.norm.toFixed(2)}`,
      `头数 ${snap.heads || 1} · d_k=${snap.dk || dModel}`,
      snap.cross ? '已启用 cross-attention' : '仅 decoder 自注意力',
      '残差：Y = LayerNorm(X + Sublayer(X))',
      'FFN：max(0, X·W₁)·W₂',
    ];
    const info = infoLines.map((t, i) => (
      <text key={`i${i}`} x={400} y={232 + i * 14} fontSize="9" fill={i === 0 ? c.text : c.muted}>{t}</text>));

    return (
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} preserveAspectRatio="xMidYMid meet">
        <text x={20} y={22} fontSize="12" fill={c.text}>Transformer Block 数据流</text>
        {boxes}
        <line x1="248" y1="20" x2="248" y2="326" stroke={c.grid} strokeWidth="1" />
        {heat}
        {attnG}
        {info}
      </svg>
    );
  },
};
