import React from 'react';
import { mulberry32, clamp, softmax } from '../utils.js';

const W = 720;
const H = 340;
const TOKENS = ['我', '爱', '学', '算', '法', '习'];

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
  id: 'multi-head-attention',
  params: [
    { key: 'heads', label: '头数', type: 'select', default: '4', options: [
      { value: '2', label: '2 头' }, { value: '4', label: '4 头' }, { value: '8', label: '8 头' },
    ] },
    { key: 'seqLen', label: '序列长度', type: 'range', min: 3, max: 6, step: 1, default: 4 },
    { key: 'focus', label: '聚焦头（0=混合）', type: 'range', min: 0, max: 8, step: 1, default: 0,
      hint: '0 显示拼接后的混合注意力，1~8 放大单个头' },
  ],
  height: H,
  legend: [
    { label: '各头注意力（小图）' }, { label: '当前计算头' },
    { label: '混合注意力' }, { label: '逐行 softmax' },
  ],
  hint: '多头注意力：每个头在不同子空间独立打分，拼接后综合多种关注模式。',

  buildSteps(p) {
    const heads = clamp(Math.round(Number(p.heads) || 4), 2, 8);
    const n = clamp(Math.round(Number(p.seqLen) || 4), 3, 6);
    const tokens = TOKENS.slice(0, n);
    const dk = 4;
    const dModel = heads * dk;

    const headData = [];
    for (let h = 0; h < heads; h++) {
      const rnd = mulberry32(77001 + h * 137 + n);
      const Q = Array.from({ length: n }, () => Array.from({ length: dk }, () => rnd() * 2 - 1));
      const K = Array.from({ length: n }, () => Array.from({ length: dk }, () => rnd() * 2 - 1));
      const V = Array.from({ length: n }, () => Array.from({ length: dk }, () => rnd() * 2 - 1));
      const mode = h % 4;
      const desc = ['关注局部相邻位置', '关注句首 token', '关注句尾 token', '关注中间位置'][mode];
      const center = Math.floor(n / 2);
      const bias = (i, j) => {
        if (mode === 0) return 2.2 * Math.exp(-Math.abs(i - j));
        if (mode === 1) return 2.5 * (j === 0 ? 1 : 0);
        if (mode === 2) return 2.5 * (j === n - 1 ? 1 : 0);
        return 2.5 * Math.exp(-((j - center) * (j - center)) / 2);
      };
      const scores = Array.from({ length: n }, (_, i) =>
        Array.from({ length: n }, (_, j) => {
          let s = 0;
          for (let t = 0; t < dk; t++) s += Q[i][t] * K[j][t];
          return s / Math.sqrt(dk) + bias(i, j);
        }));
      const attn = scores.map((row) => softmax(row, 1));
      const out = attn.map((row) => Array.from({ length: dk }, (_, t) => {
        let s = 0;
        for (let j = 0; j < n; j++) s += row[j] * V[j][t];
        return s;
      }));
      headData.push({ Q, K, V, scores, attn, out, desc, mode });
    }

    const mixedFull = Array.from({ length: n }, (_, i) =>
      Array.from({ length: n }, (_, j) =>
        headData.reduce((s, h) => s + h.attn[i][j], 0) / heads));
    const mixUpTo = (count) => Array.from({ length: n }, (_, i) =>
      Array.from({ length: n }, (_, j) => {
        const cnt = Math.max(1, count);
        let s = 0;
        for (let h = 0; h < cnt; h++) s += headData[h].attn[i][j];
        return s / cnt;
      }));
    const zeroM = () => Array.from({ length: n }, () => Array.from({ length: n }, () => 0));

    const steps = [];
    const push = (note, phase, extra = {}) => steps.push({
      tokens, n, heads, dk, dModel, headData, mixedFull,
      phase, head: -1, row: 0, activeHead: -1, mixCount: heads,
      filledRows: Array.from({ length: heads }, () => n), mixMatrix: mixedFull,
      note,
      metrics: {
        头数: heads,
        序列长度: n,
        每头维度: dk,
        拼接维度: dModel,
        当前头: (extra.head ?? -1) + 1,
        最大权重: Number(Math.max(...headData.flatMap((h) => h.attn.flat())).toFixed(3)),
      },
      ...extra,
    });

    const zeroRows = () => Array.from({ length: heads }, () => 0);
    const fullRows = () => Array.from({ length: heads }, () => n);

    push('多头注意力：并行运行多个注意力头，每个头在不同子空间独立打分。', 'intro',
      { filledRows: zeroRows(), mixMatrix: zeroM(), mixCount: 0 });
    push(`输入「${tokens.join('')}」，共 ${heads} 个头，d_k=${dk}，拼接后 d_model=${dModel}。`, 'dims',
      { filledRows: zeroRows(), mixMatrix: zeroM(), mixCount: 0 });
    for (let h = 0; h < heads; h++) {
      push(`头 ${h + 1} 的偏好：${headData[h].desc}，不同头学到的模式不同。`, 'bias',
        { head: h, activeHead: h, filledRows: zeroRows(), mixMatrix: zeroM(), mixCount: 0 });
    }
    for (let h = 0; h < heads; h++) {
      push(`头 ${h + 1}：计算 Q·Kᵀ/√d_k 并叠加偏好偏置，得到 ${n}×${n} 分数矩阵。`, 'score',
        { head: h, activeHead: h, filledRows: zeroRows(), mixMatrix: zeroM(), mixCount: 0 });
    }
    for (let h = 0; h < heads; h++) {
      for (let i = 0; i < n; i++) {
        const fr = Array.from({ length: heads }, (_, k) => (k < h ? n : (k === h ? i + 1 : 0)));
        push(`头 ${h + 1} 第 ${i + 1} 行 softmax：query「${tokens[i]}」的注意力分布逐步生成。`, 'softmax',
          { head: h, row: i, activeHead: h, filledRows: fr, mixMatrix: zeroM(), mixCount: 0 });
      }
    }
    for (let h = 0; h < heads; h++) {
      push(`拼接：汇总前 ${h + 1} 个头，混合注意力 = 各头权重取平均。`, 'concat',
        { head: h, activeHead: h, filledRows: fullRows(), mixCount: h + 1, mixMatrix: mixUpTo(h + 1) });
    }
    push('拼接所有头的输出并乘以 W_O，得到与输入同形状的最终输出。', 'output',
      { filledRows: fullRows(), mixCount: heads, mixMatrix: mixedFull });
    push('完成：每个头关注不同位置，混合注意力综合了多种关系。', 'done',
      { filledRows: fullRows(), mixCount: heads, mixMatrix: mixedFull });
    return finalize(steps);
  },

  render(snap, p, c) {
    const n = snap.n || 3;
    const heads = snap.heads || 2;
    const tokens = snap.tokens || [];
    const headData = snap.headData || [];
    const filledRows = snap.filledRows || Array.from({ length: heads }, () => n);
    const mixMatrix = snap.mixMatrix || [];
    const phase = snap.phase || 'intro';
    const activeHead = snap.activeHead ?? -1;
    const focus = clamp(Math.round(Number(p.focus) || 0), 0, heads);
    const focusOn = focus > 0 && focus <= heads;
    const dModel = snap.dModel || heads * 4;

    const tokW = Math.min(48, 300 / n);
    const topTokens = tokens.map((t, j) => (
      <g key={`t${j}`}>
        <rect x={24 + j * (tokW + 4)} y={20} width={tokW} height={20} rx={3}
          fill={c.primary} opacity={0.14} stroke={c.border} strokeWidth="0.5" />
        <text x={24 + j * (tokW + 4) + tokW / 2} y={34} textAnchor="middle" fontSize="10" fill={c.text}>{t}</text>
      </g>
    ));

    const smalls = [];
    const areaX = 20, areaW = 680, slotW = areaW / heads;
    const gridCell = Math.min(16, (slotW - 14) / n, 96 / n);
    smalls.push(<text key="sh" x={areaX} y={52} fontSize="11" fill={c.text}>各头注意力（并排）</text>);
    for (let h = 0; h < heads; h++) {
      const bx = areaX + h * slotW;
      const isActive = focusOn ? (h === focus - 1) : (h === activeHead);
      const hd = headData[h];
      smalls.push(<rect key={`bg${h}`} x={bx + 2} y={58} width={slotW - 6} height={128} rx={4}
        fill={c.panel2} opacity={0.4} stroke={isActive ? c.warning : c.border}
        strokeWidth={isActive ? 1.5 : 0.6} />);
      smalls.push(<text key={`h${h}`} x={bx + 8} y={72} fontSize="10"
        fill={isActive ? c.warning : c.text}>头 {h + 1}</text>);
      smalls.push(<text key={`d${h}`} x={bx + 8} y={84} fontSize="9" fill={c.muted}>
        {(hd && hd.desc ? hd.desc : '—').slice(0, 10)}
      </text>);
      const fr = filledRows[h] || 0;
      const at = hd ? hd.attn : [];
      for (let i = 0; i < n; i++) {
        for (let j = 0; j < n; j++) {
          const filled = i < fr;
          const v = filled && at[i] ? at[i][j] : 0;
          smalls.push(<rect key={`g${h}-${i}-${j}`} x={bx + 8 + j * gridCell} y={90 + i * gridCell}
            width={Math.max(1, gridCell - 1.5)} height={Math.max(1, gridCell - 1.5)} rx={1}
            fill={filled ? c.primary : c.panel2} opacity={filled ? 0.1 + 0.85 * v : 0.5} />);
        }
      }
    }

    const bigX = 30, bigY = 212;
    const bigCell = Math.min(24, 104 / n);
    const showNum = bigCell >= 20;
    const showAt = (focusOn && headData[focus - 1]) ? headData[focus - 1].attn : mixMatrix;
    const bigTitle = focusOn ? `聚焦：头 ${focus} 的注意力权重（含数值）` : '拼接后的混合注意力（各头平均）';
    const big = [];
    big.push(<text key="bt" x={bigX} y={bigY - 8} fontSize="11" fill={c.text}>{bigTitle}</text>);
    tokens.forEach((t, j) => big.push(<text key={`bc${j}`}
      x={bigX + 20 + j * bigCell + (bigCell - 2) / 2} y={bigY + 8} textAnchor="middle"
      fontSize="9" fill={c.muted}>{t}</text>));
    tokens.forEach((t, i) => big.push(<text key={`br${i}`} x={bigX + 16}
      y={bigY + 14 + i * bigCell + (bigCell - 2) / 2 + 3} textAnchor="end"
      fontSize="9" fill={c.muted}>{t}</text>));
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        const v = (showAt[i] && showAt[i][j]) || 0;
        const gx = bigX + 20 + j * bigCell, gy = bigY + 14 + i * bigCell;
        big.push(<g key={`b${i}-${j}`}>
          <rect x={gx} y={gy} width={bigCell - 2} height={bigCell - 2} rx={2}
            fill={c.primary} opacity={0.1 + 0.85 * v} stroke={c.border} strokeWidth="0.5" />
          {showNum && <text x={gx + (bigCell - 2) / 2} y={gy + (bigCell - 2) / 2 + 3}
            textAnchor="middle" fontSize="9" fill={c.text}>{v.toFixed(2)}</text>}
        </g>);
      }
    }

    const tx = 300;
    const panel = [];
    const phaseName = {
      intro: '① 多头并行', dims: '② 维度拆分', bias: '③ 各头偏好模式',
      score: '④ 逐头打分', softmax: '⑤ 逐行 softmax', concat: '⑥ 拼接与混合',
      output: '⑦ 乘 W_O 输出', done: '⑧ 完成',
    }[phase] || '';
    panel.push(<text key="ph" x={tx} y={214} fontSize="11" fill={c.text}>{phaseName}</text>);
    const infoLines = [
      `头数 ${heads} · 序列 ${n} · d_k=${snap.dk || 4} · d_model=${dModel}`,
      focusOn ? `当前放大：头 ${focus}` : '当前显示：各头平均后的混合注意力',
      `已混合头数：${snap.mixCount ?? heads} / ${heads}`,
      `拼接输出 ∈ R^{${n}×${dModel}}`,
    ];
    infoLines.forEach((t, i) => panel.push(
      <text key={`i${i}`} x={tx} y={232 + i * 15} fontSize="9" fill={c.muted}>{t}</text>));
    panel.push(<text key="plh" x={tx} y={284} fontSize="10" fill={c.text}>各头关注模式</text>);
    headData.slice(0, 8).forEach((hd, h) => {
      const isA = focusOn ? h === focus - 1 : h === activeHead;
      const col = h < 4 ? 0 : 1;
      const r = h % 4;
      panel.push(<text key={`pl${h}`} x={tx + col * 200} y={296 + r * 12}
        fontSize="9" fill={isA ? c.warning : c.muted}>{`头${h + 1}：${hd.desc}`}</text>);
    });

    return (
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} preserveAspectRatio="xMidYMid meet">
        {topTokens}
        {smalls}
        <line x1="20" y1="194" x2="700" y2="194" stroke={c.grid} strokeWidth="1" />
        {big}
        <line x1="288" y1="202" x2="288" y2="326" stroke={c.grid} strokeWidth="1" />
        {panel}
      </svg>
    );
  },
};
