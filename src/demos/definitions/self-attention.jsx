import React from 'react';
import { mulberry32, clamp, softmax } from '../utils.js';

const W = 720;
const H = 340;
const TOKENS = ['我', '爱', '学', '算', '法', '习', '模', '型'];

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
  id: 'self-attention',
  params: [
    { key: 'seqLen', label: '序列长度', type: 'range', min: 3, max: 8, step: 1, default: 5 },
    { key: 'dk', label: '缩放维度 d_k', type: 'range', min: 4, max: 64, step: 4, default: 16 },
    { key: 'temperature', label: '温度 T', type: 'range', min: 0.2, max: 2, step: 0.1, default: 1 },
    { key: 'mask', label: '因果 mask', type: 'toggle', default: false, hint: '屏蔽未来位置' },
  ],
  height: H,
  legend: [
    { label: 'Q·Kᵀ 分数' }, { label: '注意力权重' },
    { label: '加权输出' }, { label: '被 mask 位置' },
  ],
  hint: '自注意力：Q·Kᵀ 打分 → 缩放 / mask → softmax → 对 V 加权求和。',

  buildSteps(p) {
    const n = clamp(Math.round(Number(p.seqLen) || 5), 3, 8);
    const dk = clamp(Math.round(Number(p.dk) || 16), 4, 64);
    const temp = clamp(Number(p.temperature) || 1, 0.2, 2);
    const mask = !!p.mask;
    const tokens = TOKENS.slice(0, n);

    const rnd = mulberry32(20240501 + n * 7 + dk);
    const Q = Array.from({ length: n }, () => Array.from({ length: dk }, () => rnd() * 2 - 1));
    const K = Array.from({ length: n }, () => Array.from({ length: dk }, () => rnd() * 2 - 1));
    const V = Array.from({ length: n }, () => Array.from({ length: dk }, () => rnd() * 2 - 1));
    const scale = 1 / Math.sqrt(dk);

    // 真实计算 S = Q·Kᵀ
    const raw = Array.from({ length: n }, (_, i) =>
      Array.from({ length: n }, (_, j) => {
        let s = 0;
        for (let t = 0; t < dk; t++) s += Q[i][t] * K[j][t];
        return s;
      }));
    // 缩放 + 因果 mask
    const scaled = raw.map((row, i) => row.map((v, j) =>
      (mask && j > i) ? -Infinity : v * scale));
    // 按行 softmax（先减最大值，数值稳定；-Infinity 自动变 0）
    const attn = scaled.map((row) => softmax(row, temp));
    // 输出 o_i = Σ_j A_ij · v_j
    const out = attn.map((row) =>
      Array.from({ length: dk }, (_, t) => {
        let s = 0;
        for (let j = 0; j < n; j++) s += row[j] * (V[j] ? V[j][t] : 0);
        return s;
      }));

    const steps = [];
    const push = (note, phase, extra = {}) => steps.push({
      tokens, n, dk, temp, mask, scale, raw, scaled, attn, out, Q, K, V,
      phase, row: 0, note,
      metrics: {
        序列长度: n,
        缩放因子: Number(scale.toFixed(3)),
        温度: temp,
        最大注意力: Number(Math.max(...attn.flat()).toFixed(3)),
        mask: mask ? '开启' : '关闭',
      },
      ...extra,
    });

    push('输入序列：每个 token 将生成查询 Q、键 K、值 V 三组向量。', 'tokens');
    push(`随机初始化 Q / K / V ∈ R^{${n}×${dk}}（固定种子，结果可复现）。`, 'qkv');
    push(`打分公式 S = Q·Kᵀ / √d_k，其中 1/√d_k = ${scale.toFixed(3)} 防止点积分数过大。`, 'formula');
    push('以第 0 个 query 与第 0 个 key 为例：逐维度相乘再累加得到 S₀₀。', 'dot');
    for (let i = 0; i < n; i++) {
      push(`计算第 ${i + 1} 行：query「${tokens[i]}」与所有 key 的点积分数 S[${i}, :]。`, 'score', { row: i });
    }
    push(`缩放：全部分数乘 ${scale.toFixed(3)}${mask ? '；因果 mask 把上三角（未来位置）置为 −∞' : ''}。`, 'scaled');
    for (let i = 0; i < n; i++) {
      push(`第 ${i + 1} 行 softmax(S / T)：转成和为 1 的权重，T=${temp} ${temp < 1 ? '使分布更尖' : '使分布更平'}。`,
        'softmax', { row: i });
    }
    push('完整注意力权重矩阵 A：行是 query、列是 key，颜色越深关注越强。', 'attn');
    for (let i = 0; i < n; i++) {
      push(`输出 o_${i + 1} = Σ_j A[${i},j]·v_j：按权重对 V 加权求和。`, 'output', { row: i });
    }
    push('自注意力完成：每个 token 融合了全序列信息，输出与输入同形状。', 'done');
    return finalize(steps);
  },

  render(snap, p, c) {
    const n = snap.n || 3;
    const tokens = snap.tokens || [];
    const raw = snap.raw || [];
    const scaled = snap.scaled || [];
    const attn = snap.attn || [];
    const out = snap.out || [];
    const Q = snap.Q || [], K = snap.K || [];
    const phase = snap.phase || 'tokens';
    const row = snap.row ?? 0;
    const temp = snap.temp || 1;
    const dk = snap.dk || 8;
    const mask = !!snap.mask;
    const scale = snap.scale || 0.25;

    const x0 = 84, y0 = 84;
    const cell = Math.min(30, 216 / n);

    const mode = phase === 'scaled' ? 'scaled'
      : (['softmax', 'attn', 'output', 'done'].includes(phase)) ? 'attn'
        : phase === 'score' ? 'raw' : 'none';
    const rowsToShow = (phase === 'score' || phase === 'softmax') ? row + 1 : n;

    let maxAbs = 1;
    if (mode === 'raw' || mode === 'scaled') {
      const src = mode === 'raw' ? raw : scaled;
      let m = 0;
      src.forEach((r) => r.forEach((v) => {
        if (Number.isFinite(v) && Math.abs(v) > m) m = Math.abs(v);
      }));
      maxAbs = m || 1;
    }

    const phaseName = {
      tokens: '① 输入序列', qkv: '② Q / K / V', formula: '③ 打分公式', dot: '④ 点积示例',
      score: '⑤ 计算 Q·Kᵀ', scaled: '⑥ 缩放 / mask', softmax: '⑦ 逐行 softmax',
      attn: '⑧ 注意力权重', output: '⑨ 加权求和', done: '⑩ 完成',
    }[phase] || '';

    const cells = [];
    if (mode !== 'none') {
      for (let i = 0; i < n; i++) {
        for (let j = 0; j < n; j++) {
          const x = x0 + j * cell, y = y0 + i * cell;
          let fill = c.panel2, op = 0.25, label = '', txtColor = c.muted;
          let stroke = c.border, sw = 0.5;
          if (i < rowsToShow) {
            if (mode === 'attn') {
              const v = (attn[i] && attn[i][j]) || 0;
              fill = c.primary; op = 0.1 + 0.85 * v; label = v.toFixed(2); txtColor = c.text;
            } else if (mode === 'scaled') {
              const v = scaled[i] ? scaled[i][j] : 0;
              if (!Number.isFinite(v)) {
                fill = c.panel2; op = 0.7; label = '—'; txtColor = c.muted;
              } else {
                fill = c.primary; op = 0.12 + 0.7 * (Math.abs(v) / maxAbs);
                label = v.toFixed(1); txtColor = c.text;
              }
            } else {
              const v = (raw[i] && raw[i][j]) || 0;
              fill = c.primary; op = 0.12 + 0.7 * (Math.abs(v) / maxAbs);
              label = v.toFixed(1); txtColor = c.text;
            }
          }
          if (i === row && (phase === 'score' || phase === 'softmax' || phase === 'output')) {
            stroke = c.warning; sw = 1.2;
          }
          cells.push(<g key={`${i}-${j}`}>
            <rect x={x} y={y} width={cell - 2} height={cell - 2} rx={2}
              fill={fill} opacity={op} stroke={stroke} strokeWidth={sw} />
            {label && <text x={x + (cell - 2) / 2} y={y + (cell - 2) / 2 + 3}
              textAnchor="middle" fontSize="9" fill={txtColor}>{label}</text>}
          </g>);
        }
      }
    }

    const colLabels = tokens.map((t, j) => (
      <g key={`c${j}`}>
        <rect x={x0 + j * cell} y={y0 - 24} width={cell - 2} height={18} rx={2}
          fill={c.primary} opacity={0.14} stroke={c.border} strokeWidth="0.5" />
        <text x={x0 + j * cell + (cell - 2) / 2} y={y0 - 11}
          textAnchor="middle" fontSize="10" fill={c.text}>{t}</text>
      </g>
    ));
    const rowLabels = tokens.map((t, i) => (
      <text key={`rl${i}`} x={x0 - 8} y={y0 + i * cell + (cell - 2) / 2 + 3}
        textAnchor="end" fontSize="10" fill={c.muted}>{t}</text>
    ));

    const rx = 380;
    const info = [];
    info.push(<text key="h" x={rx} y={30} fontSize="12" fill={c.text}>{phaseName}</text>);
    const lines = [
      `序列长度 n = ${n}，d_k = ${dk}`,
      `缩放因子 1/√d_k = ${scale.toFixed(3)}`,
      `温度 T = ${temp}，因果 mask：${mask ? '开' : '关'}`,
      '分数 S = Q·Kᵀ / √d_k',
      '权重 A = softmax(S / T)',
      '输出 o_i = Σ_j A_ij · v_j',
    ];
    lines.forEach((t, i) => info.push(
      <text key={`l${i}`} x={rx} y={52 + i * 17} fontSize="10" fill={c.muted}>{t}</text>));

    if (phase === 'dot' && Q[0] && K[0]) {
      for (let t = 0; t < Math.min(6, dk); t++) {
        const prod = Q[0][t] * K[0][t];
        info.push(<text key={`d${t}`} x={rx} y={172 + t * 16} fontSize="9" fill={c.text}>
          {`t=${t}: ${Q[0][t].toFixed(2)}×${K[0][t].toFixed(2)} = ${prod.toFixed(2)}`}
        </text>);
      }
      info.push(<text key="dsum" x={rx} y={172 + Math.min(6, dk) * 16 + 4} fontSize="10" fill={c.warning}>
        {`全部 ${dk} 项累加得 S₀₀ = ${((raw[0] && raw[0][0]) || 0).toFixed(2)}`}
      </text>);
    }

    const outBars = [];
    if (phase === 'output' || phase === 'done') {
      const norms = Array.from({ length: n }, (_, i) =>
        out[i] ? Math.sqrt(out[i].reduce((s, v) => s + v * v, 0)) : 0);
      const maxN = Math.max(1e-6, ...norms);
      const showN = phase === 'output' ? row + 1 : n;
      outBars.push(<text key="oh" x={rx} y={168} fontSize="11" fill={c.text}>输出向量范数 ‖o_i‖</text>);
      for (let i = 0; i < n; i++) {
        const y = 184 + i * 17;
        if (i < showN) {
          const w = (norms[i] / maxN) * 180;
          outBars.push(<g key={`o${i}`}>
            <text x={rx} y={y + 9} fontSize="9" fill={c.muted}>{tokens[i] || ''}</text>
            <rect x={rx + 22} y={y + 1} width={w} height={10} rx={2}
              fill={c.success} opacity={i === row ? 0.95 : 0.55} />
            <text x={rx + 26 + w} y={y + 9} fontSize="9" fill={c.text}>{norms[i].toFixed(2)}</text>
          </g>);
        } else {
          outBars.push(<text key={`o${i}`} x={rx} y={y + 9} fontSize="9" fill={c.muted}>
            {`${tokens[i] || ''} — 待计算`}
          </text>);
        }
      }
    }

    return (
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} preserveAspectRatio="xMidYMid meet">
        <text x={20} y={26} fontSize="12" fill={c.text}>自注意力计算矩阵</text>
        <text x={x0 - 30} y={y0 - 11} fontSize="9" fill={c.muted}>Q\K</text>
        {colLabels}
        {rowLabels}
        {cells}
        {mode === 'none' && <text x={x0 + 8} y={y0 + 40} fontSize="11" fill={c.muted}>
          拖动进度条，观察 Q·Kᵀ 分数矩阵逐步生成 →
        </text>}
        <line x1="360" y1="20" x2="360" y2="326" stroke={c.grid} strokeWidth="1" />
        {info}
        {outBars}
        <text x={20} y={330} fontSize="10" fill={c.muted}>
          {mode === 'attn' ? '格子越深 = 注意力权重越大'
            : mode === 'scaled' ? '「—」为被 mask 屏蔽的位置'
              : '格子数值 = 对应位置的分数'}
          {mask ? ' · 已启用因果 mask' : ''}
        </text>
      </svg>
    );
  },
};
