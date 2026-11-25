import React from 'react';
import { mulberry32, clamp } from '../utils.js';

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

const METHOD_NAME = { sin: '正弦余弦', rope: 'RoPE 旋转', learned: '可学习' };

export default {
  id: 'positional-encoding',
  params: [
    { key: 'method', label: '编码方式', type: 'select', default: 'sin', options: [
      { value: 'sin', label: '正弦余弦' }, { value: 'rope', label: 'RoPE 旋转' },
      { value: 'learned', label: '可学习' },
    ] },
    { key: 'seqLen', label: '序列长度', type: 'range', min: 4, max: 16, step: 1, default: 8 },
    { key: 'dim', label: '维度', type: 'range', min: 8, max: 32, step: 4, default: 16 },
    { key: 'pos', label: '聚焦位置 pos', type: 'range', min: 0, max: 15, step: 1, default: 3 },
  ],
  height: H,
  legend: [
    { label: '位置向量正值' }, { label: '位置向量负值' },
    { label: '聚焦位置' }, { label: '相似度衰减曲线' },
  ],
  hint: '位置编码把「第几个 token」注入向量；正弦 / RoPE 的相似度随距离衰减，可学习编码无固定结构。',

  buildSteps(p) {
    const method = METHOD_NAME[p.method] ? p.method : 'sin';
    const seqLen = clamp(Math.round(Number(p.seqLen) || 8), 4, 16);
    const dim = clamp(Math.round(Number(p.dim) || 16), 8, 32);
    const pos = clamp(Math.round(Number(p.pos) || 0), 0, seqLen - 1);

    const freqs = Array.from({ length: dim / 2 }, (_, i) => 1 / Math.pow(10000, (2 * i) / dim));

    let pe;
    if (method === 'sin') {
      pe = Array.from({ length: seqLen }, (_, q) => Array.from({ length: dim }, (_, k) => {
        const i = Math.floor(k / 2);
        const ang = q / Math.pow(10000, (2 * i) / dim);
        return k % 2 === 0 ? Math.sin(ang) : Math.cos(ang);
      }));
    } else if (method === 'rope') {
      pe = Array.from({ length: seqLen }, (_, q) => Array.from({ length: dim }, (_, k) => {
        const i = Math.floor(k / 2);
        const ang = q * freqs[i];
        return k % 2 === 0 ? Math.cos(ang) : Math.sin(ang);
      }));
    } else {
      const rnd = mulberry32(88001 + seqLen * 13 + dim);
      pe = Array.from({ length: seqLen }, () => Array.from({ length: dim }, () => rnd() * 2 - 1));
    }

    // 相似度随相对距离 d 变化：对所有间距为 d 的位置对取平均（不越界）
    const sims = Array.from({ length: seqLen }, (_, d) => {
      if (method === 'rope') {
        let s = 0;
        for (const f of freqs) s += Math.cos(d * f);
        return s / freqs.length;
      }
      let acc = 0, cnt = 0;
      for (let q = 0; q + d < seqLen; q++) {
        const a = pe[q], b = pe[q + d];
        let dot = 0, na = 0, nb = 0;
        for (let t = 0; t < dim; t++) { dot += a[t] * b[t]; na += a[t] * a[t]; nb += b[t] * b[t]; }
        acc += dot / (Math.sqrt(na * nb) + 1e-9);
        cnt++;
      }
      return cnt ? acc / cnt : 0;
    });

    const steps = [];
    const push = (note, phase, extra = {}) => steps.push({
      method, seqLen, dim, pos, pe, sims, freqs,
      phase, fillRows: 0, vecCount: 0, simCount: 0, curSim: 0, note,
      metrics: {
        编码方式: METHOD_NAME[method],
        序列长度: seqLen,
        维度: dim,
        聚焦位置: pos,
        距离1相似度: Number(sims[1].toFixed(3)),
      },
      ...extra,
    });

    push('位置编码：为每个位置生成一条 d 维向量，与词向量相加后注入顺序信息。', 'intro');
    if (method === 'sin') {
      push(`正弦余弦：PE(pos,2i)=sin(pos/10000^(2i/d))，PE(pos,2i+1)=cos(...)，d=${dim}。`, 'formula');
    } else if (method === 'rope') {
      push(`RoPE：每个二维子空间按角度 θ_i=pos·freq_i 旋转，freq_i=1/10000^(2i/d)。`, 'formula');
    } else {
      push(`可学习：位置嵌入表随机初始化（固定种子），由梯度下降训练，无固有衰减结构。`, 'formula');
    }

    for (let q = 0; q < seqLen; q++) {
      push(`填充位置 ${q} 的向量：${dim} 个维度依次写入，形成 ${seqLen}×${dim} 位置矩阵。`, 'fill',
        { fillRows: q + 1 });
    }
    for (let k = 0; k < dim; k++) {
      const v = pe[pos][k];
      push(`聚焦位置 ${pos}：第 ${k} 维 = ${v.toFixed(3)}${method === 'rope' ? `（旋转角 θ=${(pos * freqs[Math.floor(k / 2)]).toFixed(3)}）` : ''}。`,
        'vec', { fillRows: seqLen, vecCount: k + 1 });
    }
    for (let d = 0; d < seqLen; d++) {
      push(`距离 ${d} 的平均相似度 = ${sims[d].toFixed(3)}：${method === 'rope' ? 'RoPE 内积只依赖相对距离' : (method === 'learned' ? '随机嵌入无单调规律' : '随距离增大总体衰减')}。`,
        'sim', { fillRows: seqLen, vecCount: dim, simCount: d + 1, curSim: sims[d] });
    }
    push(`完成：${METHOD_NAME[method]}编码共 ${seqLen}×${dim} = ${seqLen * dim} 个值，距离 1 相似度 ${sims[1].toFixed(3)}。`, 'done',
      { fillRows: seqLen, vecCount: dim, simCount: seqLen, curSim: sims[seqLen - 1] });
    return finalize(steps);
  },

  render(snap, p, c) {
    const method = snap.method || 'sin';
    const seqLen = snap.seqLen || 4;
    const dim = snap.dim || 8;
    const pos = snap.pos || 0;
    const pe = snap.pe || [];
    const sims = snap.sims || [];
    const freqs = snap.freqs || [];
    const phase = snap.phase || 'intro';
    const fillRows = snap.fillRows ?? 0;
    const vecCount = snap.vecCount ?? 0;
    const simCount = snap.simCount ?? 0;

    const x0 = 52, y0 = 64;
    const cellW = Math.min(20, 256 / dim);
    const cellH = Math.min(16, 220 / seqLen);

    const heat = [];
    heat.push(<text key="ax" x={x0} y={54} fontSize="9" fill={c.muted}>维度 0 → {dim - 1}</text>);
    heat.push(<text key="ay" x={20} y={y0 + 10} fontSize="9" fill={c.muted}>位置↓</text>);
    for (let q = 0; q < seqLen; q++) {
      heat.push(<text key={`l${q}`} x={x0 - 6} y={y0 + q * cellH + cellH / 2 + 3}
        textAnchor="end" fontSize="9" fill={q === pos ? c.warning : c.muted}>{q}</text>);
      for (let k = 0; k < dim; k++) {
        const v = (pe[q] && pe[q][k]) || 0;
        const filled = q < fillRows;
        const fill = v >= 0 ? c.primary : c.danger;
        heat.push(<rect key={`h${q}-${k}`} x={x0 + k * cellW} y={y0 + q * cellH}
          width={Math.max(1, cellW - 1)} height={Math.max(1, cellH - 1)} rx={1}
          fill={filled ? fill : c.panel2} opacity={filled ? 0.12 + 0.75 * Math.abs(v) : 0.45} />);
      }
    }
    heat.push(<rect key="focus" x={x0 - 1} y={y0 + pos * cellH - 1}
      width={dim * cellW + 1} height={cellH} rx={1} fill="none"
      stroke={c.warning} strokeWidth="1.2" />);

    const right = [];
    right.push(<text key="rt" x={352} y={30} fontSize="11" fill={c.text}>
      聚焦位置 pos = {pos} 的向量分量
    </text>);

    if (method === 'rope') {
      const cx = 410, cy = 92, r = 36;
      right.push(<circle key="cc" cx={cx} cy={cy} r={r} fill="none" stroke={c.grid} strokeWidth="1" />);
      right.push(<line key="cx" x1={cx - r - 4} y1={cy} x2={cx + r + 4} y2={cy} stroke={c.grid} strokeWidth="0.6" />);
      right.push(<line key="cy" x1={cx} y1={cy - r - 4} x2={cx} y2={cy + r + 4} stroke={c.grid} strokeWidth="0.6" />);
      for (let i = 0; i < 4; i++) {
        const ang = pos * (freqs[i] || 0);
        const ex = cx + r * Math.cos(ang), ey = cy - r * Math.sin(ang);
        right.push(<line key={`ray${i}`} x1={cx} y1={cy} x2={ex} y2={ey}
          stroke={c.series[i]} strokeWidth="1.6" />);
        right.push(<circle key={`dot${i}`} cx={ex} cy={ey} r={2.4} fill={c.series[i]} />);
        right.push(<text key={`ang${i}`} x={470} y={64 + i * 15} fontSize="9" fill={c.series[i]}>
          {`θ${i} = ${ang.toFixed(3)} rad`}
        </text>);
      }
      right.push(<text key="rn" x={352} y={140} fontSize="9" fill={c.muted}>
        低频维度旋转慢、高频旋转快；内积仅依赖相对距离
      </text>);
    } else {
      const desc = method === 'sin'
        ? ['偶数维取 sin、奇数维取 cos，', '不同维度对应不同波长，', '远距离位置相似度总体下降。']
        : ['位置嵌入表由随机初始化，', '随训练梯度更新，', '无固定单调衰减规律。'];
      desc.forEach((t, i) => right.push(<text key={`d${i}`} x={352} y={58 + i * 18}
        fontSize="10" fill={c.muted}>{t}</text>));
    }

    const shown = Math.min(8, dim);
    for (let k = 0; k < shown; k++) {
      const col = k % 4, r = Math.floor(k / 4);
      const bx = 352 + col * 86, by = 150 + r * 18;
      const v = (pe[pos] && pe[pos][k]) || 0;
      const ready = k < vecCount;
      right.push(<rect key={`vb${k}`} x={bx} y={by} width={78} height={15} rx={2}
        fill={ready ? (v >= 0 ? c.primary : c.danger) : c.panel2}
        opacity={ready ? 0.2 + 0.6 * Math.abs(v) : 0.5} stroke={c.border} strokeWidth="0.5" />);
      right.push(<text key={`vt${k}`} x={bx + 39} y={by + 11} textAnchor="middle" fontSize="9" fill={c.text}>
        {ready ? `d${k}:${v.toFixed(2)}` : `d${k}:—`}
      </text>);
    }

    right.push(<text key="ct" x={352} y={192} fontSize="11" fill={c.text}>相似度随相对距离衰减</text>);
    const cx0 = 380, cx1 = 690, cy0 = 210, cy1 = 300;
    const mid = (cy0 + cy1) / 2, amp = (cy1 - cy0) / 2 - 6;
    right.push(<line key="z" x1={cx0} y1={mid} x2={cx1} y2={mid} stroke={c.grid} strokeWidth="0.8" />);
    right.push(<text key="zy" x={cx0 - 6} y={mid + 3} textAnchor="end" fontSize="9" fill={c.muted}>0</text>);
    const pts = [];
    for (let d = 0; d < Math.min(simCount, seqLen); d++) {
      const x = cx0 + (d / Math.max(1, seqLen - 1)) * (cx1 - cx0);
      const y = mid - clamp(sims[d] || 0, -1, 1) * amp;
      pts.push(`${x.toFixed(1)},${y.toFixed(1)}`);
      right.push(<circle key={`pt${d}`} cx={x} cy={y} r={2.2} fill={c.primary} />);
    }
    if (pts.length > 1) {
      right.push(<polyline key="pl" points={pts.join(' ')} fill="none"
        stroke={c.primary} strokeWidth="1.6" />);
    }
    right.push(<text key="cx0" x={cx0} y={cy1 + 14} fontSize="9" fill={c.muted}>距离 0</text>);
    right.push(<text key="cx1" x={cx1} y={cy1 + 14} textAnchor="end" fontSize="9" fill={c.muted}>
      距离 {seqLen - 1}
    </text>);
    right.push(<text key="simv" x={cx1} y={cy0 - 4} textAnchor="end" fontSize="9" fill={c.warning}>
      当前 sim({Math.max(0, simCount - 1)}) = {simCount > 0 && snap.curSim !== undefined ? snap.curSim.toFixed(3) : '—'}
    </text>);

    return (
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} preserveAspectRatio="xMidYMid meet">
        <text x={20} y={26} fontSize="12" fill={c.text}>位置编码矩阵 · {METHOD_NAME[method] || ''}</text>
        {heat}
        <line x1="336" y1="20" x2="336" y2="326" stroke={c.grid} strokeWidth="1" />
        {right}
        <text x={20} y={330} fontSize="10" fill={c.muted}>
          正值用主色、负值用警示色 · 黄色框为聚焦位置 · 曲线为真实计算的平均相似度
        </text>
      </svg>
    );
  },
};
