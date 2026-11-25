import React from 'react';
import { mulberry32, clamp, softmax } from '../utils.js';
import { num, fmt } from '../kits/primitives.jsx';

const H = 340;
const TOK16 = ['我', '爱', '学', '算', '法', '模', '型', '数', '据', '语', '言', '文', '本', '向', '量', '空'];

function finalize(steps) {
  const out = steps.slice();
  if (out.length > 300) {
    const stride = Math.ceil(out.length / 300);
    return out.filter((_, i) => i % stride === 0 || i === out.length - 1);
  }
  const last = out[out.length - 1] || { note: '完成', metrics: {} };
  let k = 0;
  while (out.length < 24) {
    k += 1;
    out.push({ ...last, note: `保持最终状态：${last.note}（${k}）` });
  }
  return out;
}
function r3(v, d = 3) { return Number(num(v, 0).toFixed(d)); }
function t2(v, d = 2) { return fmt(v, d); }

export default {
  embedding: {
    params: [
      { key: 'vocabSize', label: '词表大小 V', type: 'range', min: 6, max: 16, step: 2, default: 10 },
      { key: 'dim', label: '向量维度 d', type: 'range', min: 8, max: 32, step: 8, default: 16 },
      { key: 'focus', label: '查询词序号', type: 'range', min: 0, max: 15, step: 1, default: 3 },
    ],
    height: H,
    legend: [{ label: '已填充的嵌入向量' }, { label: '查询 token' }, { label: '最相近 token' }],
    hint: '词嵌入：离散 token 查表映射成 d 维稠密向量，语义相近者在向量空间里距离更近。',
    buildSteps(p) {
      const V = clamp(Math.round(num(p.vocabSize, 10)), 6, 16);
      const d = clamp(Math.round(num(p.dim, 16)), 8, 32);
      const f = clamp(Math.round(num(p.focus, 3)), 0, V - 1);
      const rnd = mulberry32(41001 + V * 31 + d);
      const centers = Array.from({ length: 3 }, () => Array.from({ length: d }, () => rnd() * 2 - 1));
      const table = Array.from({ length: V }, (_, i) => {
        const g = i % 3;
        return Array.from({ length: d }, (_, k) => centers[g][k] * 0.8 + (rnd() * 2 - 1) * 0.28);
      });
      const norm = (v) => Math.sqrt(v.reduce((s, x) => s + x * x, 0)) || 1;
      const sims = table.map((v) => {
        let dot = 0;
        for (let k = 0; k < d; k++) dot += v[k] * table[f][k];
        return dot / (norm(v) * norm(table[f]));
      });
      const nearest = table.map((_, i) => i).filter((i) => i !== f)
        .sort((a, b) => sims[b] - sims[a]).slice(0, 3);
      const steps = [];
      const push = (note, phase, extra = {}) => steps.push({
        V, d, f, tokens: TOK16.slice(0, V), table, sims, nearest,
        filled: 0, vecCount: 0, simCount: 0, phase, note,
        metrics: {
          词表大小: V, 向量维度: d, 查询序号: f,
          最高相似度: r3(sims[nearest[0]] || 0), 相似度已算: 0,
        },
        ...extra,
      });
      push('词嵌入层本质是一张 V×d 的可学习查表矩阵，每个 token 对应其中一行。', 'intro');
      push(`表大小 ${V}×${d} = ${V * d} 个参数，初始化后随语言模型一起训练。`, 'intro');
      for (let i = 0; i < V; i++) {
        push(`填充第 ${i + 1} 个 token「${TOK16[i]}」的 ${d} 维向量（固定种子，结果可复现）。`, 'table', { filled: i + 1 });
      }
      push(`查表：「${TOK16[f]}」→ 第 ${f} 行向量 e_${f} ∈ R^${d}。`, 'lookup', { filled: V });
      for (let k = 0; k < Math.min(d, 12); k++) {
        push(`第 ${k + 1} 维 = ${table[f][k].toFixed(3)}，稠密向量的每一维都编码语义信息。`, 'vec',
          { filled: V, vecCount: k + 1 });
      }
      for (let i = 0; i < V; i++) {
        push(`余弦相似度 cos(e_${f}, e_${i}) = ${sims[i].toFixed(3)}${i === f ? '（自身）' : ''}。`, 'sim',
          { filled: V, vecCount: Math.min(d, 12), simCount: i + 1,
            metrics: { 词表大小: V, 向量维度: d, 查询序号: f, 最高相似度: r3(sims[i]), 相似度已算: i + 1 } });
      }
      push(`最相近三个：${nearest.map((i) => `${TOK16[i]}(${sims[i].toFixed(2)})`).join('、')}。`, 'nearest',
        { filled: V, vecCount: Math.min(d, 12), simCount: V });
      push(`完成：查表得到「${TOK16[f]}」的 ${d} 维表示，语义相近的向量余弦相似度更高。`, 'done',
        { filled: V, vecCount: Math.min(d, 12), simCount: V });
      return finalize(steps);
    },
    render(snap, p, c) {
      const V = num(snap.V, 6), d = num(snap.d, 8), f = num(snap.f, 0);
      const tokens = snap.tokens || [], table = snap.table || [], sims = snap.sims || [];
      const nearest = snap.nearest || [];
      const filled = num(snap.filled, 0), vecCount = num(snap.vecCount, 0), simCount = num(snap.simCount, 0);
      const phase = snap.phase || 'intro';
      const out = [];
      out.push(<text key="t1" x={20} y={38} fontSize="11" fill={c.text}>词嵌入查表矩阵（展示前 8 维 / 共 {String(d)} 维）</text>);
      const cw = Math.min(24, 230 / 8), ch = Math.min(15, 230 / V);
      for (let i = 0; i < V; i++) {
        out.push(<text key={`rl${i}`} x={78} y={58 + i * ch + ch / 2 + 3} textAnchor="end" fontSize="9"
          fill={i === f ? c.warning : c.muted}>{String(tokens[i] || '')}</text>);
        for (let k = 0; k < 8; k++) {
          const v = num((table[i] || [])[k], 0);
          const on = i < filled;
          const isFocus = i === f && ['lookup', 'vec', 'sim', 'nearest', 'done'].includes(phase);
          out.push(<rect key={`e${i}-${k}`} x={86 + k * cw} y={54 + i * ch}
            width={Math.max(1, cw - 1)} height={Math.max(1, ch - 1)} rx={1}
            fill={isFocus ? c.warning : (v >= 0 ? c.primary : c.danger)}
            opacity={on ? 0.14 + 0.72 * Math.min(1, Math.abs(v)) : 0.12}
            stroke={isFocus ? c.warning : 'none'} strokeWidth={isFocus ? 1.2 : 0} />);
        }
      }
      const rx = 360;
      out.push(<text key="t2" x={rx} y={38} fontSize="11" fill={c.text}>与查询词的余弦相似度（逐行算）</text>);
      for (let i = 0; i < V; i++) {
        if (i >= simCount) break;
        const s = num(sims[i], 0);
        const w = Math.max(1, Math.min(1, Math.abs(s)) * 250);
        const near = ['nearest', 'done'].includes(phase) && nearest.indexOf(i) >= 0;
        out.push(<g key={`s${i}`}>
          <text x={rx} y={64 + i * 15 + 8} fontSize="9" fill={near ? c.success : c.muted}>{String(tokens[i] || '')}</text>
          <rect x={rx + 26} y={64 + i * 15} width={w} height={10} rx={2}
            fill={near ? c.success : c.primary} opacity={near ? 0.92 : 0.66} />
          <text x={rx + 32 + w} y={64 + i * 15 + 8} fontSize="9" fill={c.text}>{t2(s, 3)}</text>
        </g>);
      }
      out.push(<line key="div" x1={344} y1={24} x2={344} y2={H - 14} stroke={c.grid} strokeWidth="1" />);
      out.push(<text key="t3" x={20} y={302} fontSize="10" fill={c.muted}>
        {phase === 'vec' ? `查询向量已揭示 ${String(vecCount)} / ${String(Math.min(d, 12))} 维` :
          (['nearest', 'done'].includes(phase) ? `最近邻：${nearest.map((i) => String(tokens[i] || '')).join('、')}` : '色块深浅 = 嵌入值大小，蓝正红负')}
      </text>);
      out.push(<text key="t4" x={rx} y={302} fontSize="10" fill={c.muted}>
        {`相似度已算 ${String(simCount)} / ${String(V)} · 余弦值越接近 1 语义越近`}
      </text>);
      return (
        <svg viewBox={`0 0 720 ${H}`} width="100%" height={H} preserveAspectRatio="xMidYMid meet">
          <text x={20} y={20} fontSize="11" fill={c.text}>Token Embedding · 查表与语义相似度</text>
          {out}
        </svg>
      );
    },
  },

  rope: {
    params: [
      { key: 'seqLen', label: '序列长度', type: 'range', min: 4, max: 12, step: 1, default: 8 },
      { key: 'dim', label: '维度 d（偶数）', type: 'range', min: 8, max: 24, step: 8, default: 16 },
      { key: 'focusPos', label: '聚焦位置 pos', type: 'range', min: 0, max: 11, step: 1, default: 3 },
    ],
    height: H,
    legend: [{ label: '基向量 (1,0)' }, { label: '旋转后的 Q/K' }, { label: '内积随相对距离衰减' }],
    hint: 'RoPE：按位置对 Q/K 的每个二维子空间做复数旋转，使注意力内积天然携带相对位置信息。',
    buildSteps(p) {
      const n = clamp(Math.round(num(p.seqLen, 8)), 4, 12);
      const d = clamp(Math.round(num(p.dim, 16)), 8, 24);
      const pos = clamp(Math.round(num(p.focusPos, 3)), 0, n - 1);
      const half = d / 2;
      const freqs = Array.from({ length: half }, (_, i) => 1 / Math.pow(10000, (2 * i) / d));
      const angles = Array.from({ length: n }, (_, q) => freqs.map((f) => q * f));
      const sim = (delta) => freqs.reduce((s, f) => s + Math.cos(delta * f), 0) / half;
      const sims = Array.from({ length: n }, (_, delta) => sim(delta));
      const steps = [];
      const push = (note, phase, extra = {}) => steps.push({
        n, d, pos, half, freqs, angles, sims,
        rotRows: 0, freqCount: 0, vecCount: 0, simCount: 0, angleCount: 0, phase, note,
        metrics: {
          序列长度: n, 维度: d, 聚焦位置: pos,
          基频: r3(freqs[0], 5), 距离1内积: r3(sims[1] || 0), 聚焦角: r3(pos * freqs[0]),
        },
        ...extra,
      });
      push('RoPE 不做加法，而是对 Q、K 的每个二维子空间按位置旋转。', 'intro');
      for (let k = 0; k < half; k++) {
        push(`频率 f_${k} = 1/10000^(${String(2 * k)}/${String(d)}) = ${freqs[k].toFixed(5)}，不同维度旋转速度不同。`,
          'freq', { freqCount: k + 1 });
      }
      for (let q = 0; q < n; q++) {
        push(`位置 ${q}：θ_i = ${String(q)}·f_i，各子空间旋转角依次为 ${angles[q].slice(0, 3).map((a) => a.toFixed(2)).join('、')} rad。`,
          'rotate', { freqCount: half, rotRows: q + 1 });
      }
      for (let k = 0; k < Math.min(4, half); k++) {
        push(`聚焦位置 ${pos} 的第 ${k} 个旋转角 θ = ${(pos * freqs[k]).toFixed(3)} rad，基向量 (1,0) 被转到 (${Math.cos(pos * freqs[k]).toFixed(2)}, ${Math.sin(pos * freqs[k]).toFixed(2)})。`,
          'angle', { freqCount: half, rotRows: n, angleCount: k + 1 });
      }
      for (let k = 0; k < d; k++) {
        push(`旋转后向量分量 ${k}：${k % 2 === 0 ? 'cos' : 'sin'}(${String(pos)}×f_${Math.floor(k / 2)})。`,
          'vec', { freqCount: half, rotRows: n, angleCount: Math.min(4, half), vecCount: k + 1 });
      }
      for (let delta = 0; delta < n; delta++) {
        push(`相对距离 ${delta}：内积 = Σ_i cos(${String(delta)}·f_i) = ${sims[delta].toFixed(3)}，只依赖相对位置。`,
          'sim', { freqCount: half, rotRows: n, angleCount: Math.min(4, half), vecCount: d, simCount: delta + 1 });
      }
      push(`完成：位置 ${pos} 的旋转角与距离衰减曲线已生成，外推时可复用相对位置结构。`, 'done',
        { freqCount: half, rotRows: n, angleCount: Math.min(4, half), vecCount: d, simCount: n });
      return finalize(steps);
    },
    render(snap, p, c) {
      const n = num(snap.n, 4), d = num(snap.d, 8), pos = num(snap.pos, 0);
      const half = num(snap.half, 4);
      const freqs = snap.freqs || [], angles = snap.angles || [], sims = snap.sims || [];
      const rotRows = num(snap.rotRows, 0), freqCount = num(snap.freqCount, 0);
      const vecCount = num(snap.vecCount, 0), simCount = num(snap.simCount, 0);
      const angleCount = num(snap.angleCount, 0), phase = snap.phase || 'intro';
      const out = [];
      const cx = 108, cy = 116, R = 58;
      out.push(<text key="h1" x={20} y={38} fontSize="11" fill={c.text}>复数平面旋转（位置 pos = {String(pos)}）</text>);
      out.push(<circle key="cc" cx={cx} cy={cy} r={R} fill="none" stroke={c.grid} strokeWidth="1" />);
      out.push(<line key="bx" x1={cx - R - 6} y1={cy} x2={cx + R + 6} y2={cy} stroke={c.grid} strokeWidth="0.7" />);
      out.push(<line key="by" x1={cx} y1={cy - R - 6} x2={cx} y2={cy + R + 6} stroke={c.grid} strokeWidth="0.7" />);
      out.push(<line key="base" x1={cx} y1={cy} x2={cx + R} y2={cy} stroke={c.accent} strokeWidth="1.6" />);
      for (let i = 0; i < Math.min(angleCount, 4); i++) {
        const a = pos * num(freqs[i], 0);
        const ex = cx + R * Math.cos(a), ey = cy - R * Math.sin(a);
        out.push(<line key={`ry${i}`} x1={cx} y1={cy} x2={ex} y2={ey}
          stroke={c.series[i % c.series.length]} strokeWidth="2" />);
        out.push(<circle key={`rd${i}`} cx={ex} cy={ey} r="3" fill={c.series[i % c.series.length]} />);
        out.push(<text key={`ra${i}`} x={20} y={196 + i * 14} fontSize="9" fill={c.series[i % c.series.length]}>
          {`θ${String(i)} = ${t2(a, 3)} rad`}
        </text>);
      }
      out.push(<text key="h2" x={250} y={38} fontSize="11" fill={c.text}>位置 × 频率的旋转角矩阵</text>);
      const cw = Math.min(18, 260 / half), ch = Math.min(13, 200 / n);
      for (let q = 0; q < n; q++) {
        out.push(<text key={`pl${q}`} x={244} y={56 + q * ch + ch / 2 + 3} textAnchor="end" fontSize="8"
          fill={q === pos ? c.warning : c.muted}>{String(q)}</text>);
        for (let i = 0; i < half; i++) {
          const a = num((angles[q] || [])[i], 0);
          const on = q < rotRows && i < freqCount;
          const norm = Math.min(1, Math.abs(a) / (Math.max(1, n) * 0.4 + 1e-6));
          out.push(<rect key={`m${q}-${i}`} x={250 + i * cw} y={52 + q * ch}
            width={Math.max(1, cw - 1)} height={Math.max(1, ch - 1)} rx={1}
            fill={q === pos && phase !== 'intro' ? c.warning : c.primary}
            opacity={on ? 0.12 + 0.7 * norm : 0.1} />);
        }
      }
      out.push(<text key="h3" x={20} y={262} fontSize="11" fill={c.text}>内积仅依赖相对距离 d = q − k</text>);
      const x0 = 52, x1 = 700, y0 = 280, y1 = 322, mid = (y0 + y1) / 2, amp = (y1 - y0) / 2 - 4;
      out.push(<line key="zx" x1={x0} y1={mid} x2={x1} y2={mid} stroke={c.grid} strokeWidth="0.8" />);
      const pts = [];
      for (let delta = 0; delta < Math.min(simCount, n); delta++) {
        const x = x0 + (delta / Math.max(1, n - 1)) * (x1 - x0);
        const y = mid - clamp(num(sims[delta], 0), -1, 1) * amp;
        pts.push(`${t2(x, 1)},${t2(y, 1)}`);
        out.push(<circle key={`sp${delta}`} cx={x} cy={y} r="2.2" fill={c.primary} />);
      }
      if (pts.length > 1) out.push(<polyline key="spl" points={pts.join(' ')} fill="none" stroke={c.primary} strokeWidth="1.6" />);
      out.push(<text key="ax0" x={x0} y={H - 6} fontSize="9" fill={c.muted}>d = 0</text>);
      out.push(<text key="ax1" x={x1} y={H - 6} textAnchor="end" fontSize="9" fill={c.muted}>{`d = ${String(n - 1)}`}</text>);
      out.push(<text key="vecnote" x={560} y={196} fontSize="10" fill={c.muted}>
        {`聚焦向量已揭示 ${String(vecCount)} / ${String(d)} 维`}
      </text>);
      out.push(<text key="phasenote" x={560} y={212} fontSize="10" fill={c.muted}>
        {`频率已算 ${String(freqCount)} / ${String(half)} · 旋转行 ${String(rotRows)} / ${String(n)}`}
      </text>);
      return (
        <svg viewBox={`0 0 720 ${H}`} width="100%" height={H} preserveAspectRatio="xMidYMid meet">
          <text x={20} y={20} fontSize="11" fill={c.text}>RoPE 旋转位置编码 · 角度 / 位置 / 内积衰减</text>
          {out}
        </svg>
      );
    },
  },

  'greedy-decode': {
    params: [
      { key: 'genSteps', label: '生成步数', type: 'range', min: 2, max: 8, step: 1, default: 5 },
      { key: 'vocabSize', label: '候选词表 V', type: 'range', min: 6, max: 12, step: 2, default: 8 },
      { key: 'temperature', label: '温度 T（对照用）', type: 'range', min: 0.1, max: 2, step: 0.1, default: 1 },
    ],
    height: H,
    legend: [{ label: '候选 token 概率' }, { label: '本步 argmax' }, { label: '已生成序列' }],
    hint: '贪心解码：每一步直接选概率最大的 token，确定、最快，但容易重复且没有多样性。',
    buildSteps(p) {
      const G = clamp(Math.round(num(p.genSteps, 5)), 2, 8);
      const V = clamp(Math.round(num(p.vocabSize, 8)), 6, 12);
      const T = clamp(num(p.temperature, 1), 0.1, 2);
      const vocab = TOK16.slice(0, V);
      const rnd = mulberry32(52001 + G * 19 + V);
      const logits = [], probs = [], chosen = [];
      let prev = 0;
      for (let t = 0; t < G; t++) {
        const row = Array.from({ length: V }, (_, i) => (i === (prev + 2) % V ? 3.2 : 0.4) + (rnd() * 2 - 1) * 1.3);
        const pr = softmax(row, T);
        logits.push(row);
        probs.push(pr);
        let best = 0;
        for (let i = 1; i < V; i++) if (row[i] > row[best]) best = i;
        chosen.push(best);
        prev = best;
      }
      const steps = [];
      const push = (note, phase, extra = {}) => steps.push({
        G, V, T, vocab, logits, probs, chosen,
        step: 0, visCount: 0, phase, note,
        metrics: {
          生成步: 0, 候选数: V, 最大概率: r3(probs[0][chosen[0]] || 0),
          已生成: 0, 温度: T,
        },
        ...extra,
      });
      push('自回归生成：模型每步输出词表概率分布，贪心策略取 argmax。', 'intro');
      push(`词表 V=${String(V)}，温度 T=${t2(T, 1)}（贪心始终取最大 logit，温度只改变对照概率的尖锐度）。`, 'intro');
      push(`初始上下文为空，第 1 步预测第一个 token。`, 'intro');
      for (let t = 0; t < G; t++) {
        for (let i = 0; i < V; i++) {
          push(`第 ${t + 1} 步 logits：token「${vocab[i]}」得分 ${logits[t][i].toFixed(2)}${i === chosen[t] ? '（当前最大）' : ''}。`,
            'logit', { step: t, visCount: i + 1 });
        }
        push(`第 ${t + 1} 步 softmax：最大概率 p(「${vocab[chosen[t]]}」) = ${probs[t][chosen[t]].toFixed(3)}。`,
          'prob', { step: t, visCount: V });
        push(`贪心选择「${vocab[chosen[t]]}」并追加到序列，下一步以它为条件继续生成。`,
          'pick', { step: t + 1, visCount: V });
      }
      push(`完成：生成 ${String(G)} 个 token「${chosen.map((i) => vocab[i]).join('')}」，每步都是确定性的 argmax。`, 'done',
        { step: G, visCount: V });
      return finalize(steps);
    },
    render(snap, p, c) {
      const G = num(snap.G, 2), V = num(snap.V, 6), T = num(snap.T, 1);
      const vocab = snap.vocab || [], logits = snap.logits || [], probs = snap.probs || [], chosen = snap.chosen || [];
      const step = num(snap.step, 0), visCount = num(snap.visCount, 0), phase = snap.phase || 'intro';
      const cur = clamp(step - (phase === 'pick' || phase === 'done' ? 1 : 0), 0, G - 1);
      const row = probs[cur] || [], lg = logits[cur] || [];
      const best = num(chosen[cur], 0);
      const out = [];
      out.push(<text key="h" x={20} y={38} fontSize="11" fill={c.text}>
        {`第 ${String(cur + 1)} / ${String(G)} 步 · 词表概率（绿 = argmax）`}
      </text>);
      const bw = Math.min(44, 640 / V), gap = 652 / V;
      const base = 184;
      for (let i = 0; i < V; i++) {
        if (i >= visCount) break;
        const pr = num(row[i], 0);
        const h = Math.max(1, pr * 120);
        const isBest = i === best && ['prob', 'pick', 'done'].includes(phase);
        const x = 24 + i * gap;
        out.push(<rect key={`b${i}`} x={x} y={base - h} width={bw} height={h} rx={2}
          fill={isBest ? c.success : c.primary} opacity={isBest ? 0.95 : 0.62} />);
        out.push(<text key={`v${i}`} x={x + bw / 2} y={base - h - 4} textAnchor="middle" fontSize="9" fill={c.text}>{t2(pr, 2)}</text>);
        out.push(<text key={`l${i}`} x={x + bw / 2} y={base + 14} textAnchor="middle" fontSize="10" fill={isBest ? c.success : c.muted}>
          {String(vocab[i] || '')}
        </text>);
        if (phase === 'logit') out.push(<text key={`g${i}`} x={x + bw / 2} y={base + 27} textAnchor="middle" fontSize="8" fill={c.muted}>
          {t2(num(lg[i], 0), 1)}
        </text>);
      }
      out.push(<line key="bl" x1={20} y1={base} x2={700} y2={base} stroke={c.grid} strokeWidth="1" />);
      out.push(<text key="h2" x={20} y={222} fontSize="11" fill={c.text}>已生成序列（贪心逐步追加）</text>);
      const shown = G <= 12 ? G : 12;
      for (let t = 0; t < shown; t++) {
        const idx = num(chosen[t], 0);
        const on = t < step || phase === 'done';
        const x = 24 + t * Math.min(56, 660 / shown);
        out.push(<rect key={`c${t}`} x={x} y={236} width={Math.min(48, 640 / shown - 4)} height={38} rx={5}
          fill={on ? c.success : c.panel2} opacity={on ? 0.88 : 0.6} stroke={t === step - 1 ? c.warning : 'none'}
          strokeWidth={t === step - 1 ? 1.6 : 0} />);
        out.push(<text key={`ct${t}`} x={x + Math.min(24, 320 / shown - 2)} y={260} textAnchor="middle" fontSize="14"
          fill={on ? c.bg : c.muted}>{on ? String(vocab[idx] || '') : '?'}</text>);
      }
      out.push(<text key="note" x={20} y={304} fontSize="10" fill={c.muted}>
        {`温度 T=${t2(T, 1)} · 贪心选 argmax 与温度无关 · 已生成 ${String(step)} / ${String(G)} token`}
      </text>);
      out.push(<text key="note2" x={20} y={H - 8} fontSize="10" fill={c.muted}>
        {phase === 'done' ? `结果「${chosen.map((i) => String(vocab[i] || '')).join('')}」：快但可能重复、缺多样性` : '拖动进度条看每一步概率与选择'}
      </text>);
      return (
        <svg viewBox={`0 0 720 ${H}`} width="100%" height={H} preserveAspectRatio="xMidYMid meet">
          <text x={20} y={20} fontSize="11" fill={c.text}>Greedy Decoding · 逐步取最大概率 token</text>
          {out}
        </svg>
      );
    },
  },

  'flash-attention': {
    params: [
      { key: 'seqLen', label: '序列长度 n', type: 'range', min: 16, max: 64, step: 8, default: 32 },
      { key: 'block', label: '分块大小 B', type: 'range', min: 8, max: 32, step: 8, default: 16 },
      { key: 'dim', label: '头维度 d', type: 'range', min: 32, max: 128, step: 32, default: 64 },
    ],
    height: H,
    legend: [{ label: '当前 Q/K 分块' }, { label: '已处理分块' }, { label: '写回的输出块' }],
    hint: 'FlashAttention：把 Q/K/V 分块放进 SRAM，流式计算在线 softmax，不把 n×n 注意力矩阵写回显存。',
    buildSteps(p) {
      const n = clamp(Math.round(num(p.seqLen, 32)), 16, 64);
      const B = clamp(Math.round(num(p.block, 16)), 8, 32);
      const d = clamp(Math.round(num(p.dim, 64)), 32, 128);
      const nb = Math.ceil(n / B);
      const rnd = mulberry32(63001 + n * 7 + B * 11 + d);
      const tiles = [];
      for (let ib = 0; ib < nb; ib++) {
        const row = [];
        for (let jb = 0; jb < nb; jb++) {
          const rows = [];
          for (let r = 0; r < Math.min(B, 4); r++) {
            const m = -8 + rnd() * 8, l = 0.4 + rnd() * 1.6;
            rows.push({ m, l });
          }
          row.push(rows);
        }
        tiles.push(row);
      }
      const steps = [];
      const push = (note, phase, extra = {}) => steps.push({
        n, B, d, nb, tiles,
        ib: 0, jb: 0, row: 0, phase, note,
        onlineM: -1e9, onlineL: 0,
        metrics: {
          序列长度: n, 分块大小: B, 分块数: nb,
          显存节省: r3(1 - (2 * n * d) / (n * n), 3),
          已处理块: 0, 在线归一化: 0,
        },
        ...extra,
      });
      push('注意力矩阵 n×n 若物化到 HBM，显存与带宽随 n² 增长，长序列不可承受。', 'intro');
      push(`分块：Q 切成 ${String(nb)} 块、K/V 切成 ${String(nb)} 块，每块 B=${String(B)} 行，能放进 SRAM。`,
        'intro');
      push('在线 softmax：维护每行运行最大值 m 与归一化因子 l，新块来了先修正旧累加。', 'intro');
      push(`本例 n=${String(n)}, d=${String(d)}：物化需 ${String(n * n)} 个分数，分块只需 O(n·d) 中间量。`, 'intro');
      for (let ib = 0; ib < nb; ib++) {
        for (let jb = 0; jb < nb; jb++) {
          for (let r = 0; r < Math.min(B, 4); r++) {
            const cell = tiles[ib][jb][r];
            const pm = Math.max(-1e9, r3(-1e9 + (r + 1) * 0.6, 2));
            push(`Q 块 ${ib} × K 块 ${jb} 第 ${r + 1} 行：块内 max=${cell.m.toFixed(2)}，块内 sum=${cell.l.toFixed(2)}，在线 m=${pm.toFixed(2)}。`,
              'tile', { ib, jb, row: r,
                metrics: { 序列长度: n, 分块大小: B, 分块数: nb, 显存节省: r3(1 - (2 * n * d) / (n * n), 3),
                  已处理块: ib * nb + jb, 在线归一化: r3(cell.l / (cell.l + 1), 3) } });
          }
        }
        push(`Q 块 ${ib} 的所有 K 块已流过，行归一化完成，把输出块一次性写回 HBM（避免写 n×n 矩阵）。`,
          'write', { ib, jb: nb - 1, row: Math.min(B, 4) - 1 });
      }
      push(`完成：${String(nb)} 个输出块全部写回，全程未物化 ${String(n)}×${String(n)} 注意力矩阵，结果精确无近似。`,
        'done', { ib: nb - 1, jb: nb - 1, row: Math.min(B, 4) - 1 });
      return finalize(steps);
    },
    render(snap, p, c) {
      const n = num(snap.n, 16), B = num(snap.B, 8), d = num(snap.d, 32), nb = num(snap.nb, 1);
      const tiles = snap.tiles || [];
      const ib = num(snap.ib, 0), jb = num(snap.jb, 0), row = num(snap.row, 0), phase = snap.phase || 'intro';
      const out = [];
      out.push(<text key="h" x={20} y={38} fontSize="11" fill={c.text}>Q 块 × K 块 分块矩阵（{String(nb)}×{String(nb)}）</text>);
      const cell = Math.min(46, 250 / Math.max(1, nb));
      const x0 = 90, y0 = 58;
      for (let i = 0; i < nb; i++) {
        for (let j = 0; j < nb; j++) {
          const done = i < ib || (i === ib && j < jb);
          const active = i === ib && j === jb && phase !== 'intro' && phase !== 'done';
          const rows = (tiles[i] || [])[j] || [];
          const t = num((rows[row] || {}).l, 0);
          out.push(<rect key={`t${i}-${j}`} x={x0 + j * cell} y={y0 + i * cell}
            width={Math.max(2, cell - 3)} height={Math.max(2, cell - 3)} rx={3}
            fill={active ? c.warning : (done ? c.success : c.panel2)}
            opacity={active ? 0.95 : (done ? 0.7 : 0.55)}
            stroke={active ? c.warning : 'none'} strokeWidth={active ? 1.6 : 0} />);
          out.push(<text key={`l${i}-${j}`} x={x0 + j * cell + cell / 2} y={y0 + i * cell + cell / 2 + 3}
            textAnchor="middle" fontSize="9" fill={active || done ? c.bg : c.muted}>
            {active ? t2(t, 1) : (done ? 'OK' : '—')}
          </text>);
        }
      }
      out.push(<text key="lq" x={20} y={y0 + 10} fontSize="9" fill={c.muted}>Q↓</text>);
      out.push(<text key="lk" x={x0} y={y0 - 8} fontSize="9" fill={c.muted}>K→</text>);
      const rx = 372;
      out.push(<text key="h2" x={rx} y={38} fontSize="11" fill={c.text}>显存占用对比（注意力分数）</text>);
      const full = n * n, tiled = 2 * n * d;
      const max = Math.max(1, full, tiled);
      const h1 = (full / max) * 96, h2 = (tiled / max) * 96;
      out.push(<rect key="f1" x={rx + 20} y={160 - h1} width={80} height={h1} rx={3} fill={c.danger} opacity={0.7} />);
      out.push(<text key="f1t" x={rx + 60} y={160 - h1 - 5} textAnchor="middle" fontSize="10" fill={c.text}>{String(full)}</text>);
      out.push(<text key="f1l" x={rx + 60} y={176} textAnchor="middle" fontSize="9" fill={c.muted}>物化 n²</text>);
      out.push(<rect key="f2" x={rx + 150} y={160 - h2} width={80} height={h2} rx={3} fill={c.success} opacity={0.8} />);
      out.push(<text key="f2t" x={rx + 190} y={160 - h2 - 5} textAnchor="middle" fontSize="10" fill={c.text}>{String(tiled)}</text>);
      out.push(<text key="f2l" x={rx + 190} y={176} textAnchor="middle" fontSize="9" fill={c.muted}>分块 O(nd)</text>);
      out.push(<text key="save" x={rx} y={210} fontSize="11" fill={c.success}>
        {`显存降幅约 ${t2(100 * (1 - tiled / max), 1)}%`}
      </text>);
      out.push(<text key="h3" x={rx} y={244} fontSize="11" fill={c.text}>在线 softmax 状态</text>);
      out.push(<text key="om" x={rx} y={268} fontSize="10" fill={c.muted}>
        {`当前 Q 块 ${String(ib)} · K 块 ${String(jb)} · 行 ${String(row)}`}
      </text>);
      out.push(<text key="ol" x={rx} y={288} fontSize="10" fill={c.muted}>
        {`块内 m / l 暂存 SRAM，不落 HBM`}
      </text>);
      out.push(<line key="dv" x1={352} y1={24} x2={352} y2={H - 14} stroke={c.grid} strokeWidth="1" />);
      out.push(<text key="foot" x={20} y={H - 8} fontSize="10" fill={c.muted}>
        {phase === 'done' ? '所有输出块写回完成 · 计算精确、不近似' : '每次只用一块 Q 与一块 K 进 SRAM，流式修正 m/l'}
      </text>);
      return (
        <svg viewBox={`0 0 720 ${H}`} width="100%" height={H} preserveAspectRatio="xMidYMid meet">
          <text x={20} y={20} fontSize="11" fill={c.text}>FlashAttention · 分块 IO + 在线 softmax</text>
          {out}
        </svg>
      );
    },
  },

  qlora: {
    params: [
      { key: 'bits', label: '基座位宽', type: 'select', default: '4bit', options: [
        { value: '4bit', label: '4-bit NF4' }, { value: '8bit', label: '8-bit' }, { value: '16bit', label: '16-bit 基线' },
      ] },
      { key: 'rank', label: 'LoRA 秩 r', type: 'range', min: 4, max: 32, step: 4, default: 8 },
      { key: 'steps', label: '训练步数', type: 'range', min: 5, max: 40, step: 5, default: 20 },
    ],
    height: H,
    legend: [{ label: '冻结的量化基座' }, { label: '可训练 LoRA 适配器' }, { label: 'loss 下降' }],
    hint: 'QLoRA：基座权重量化到 4-bit 并冻结，只训练低秩适配器，单卡即可微调大模型。',
    buildSteps(p) {
      const bits = p.bits === '8bit' || p.bits === '16bit' ? p.bits : '4bit';
      const r = clamp(Math.round(num(p.rank, 8)), 4, 32);
      const S = clamp(Math.round(num(p.steps, 20)), 5, 40);
      const bitVal = bits === '4bit' ? 4 : (bits === '8bit' ? 8 : 16);
      const baseParam = 7000000000;
      const adapterParam = 2 * 4096 * r;
      const memBase = 14 * bitVal / 16;
      const memAdapter = adapterParam * 2 / 1e9;
      const trainRatio = adapterParam / (baseParam + adapterParam);
      const rnd = mulberry32(71001 + r * 13 + bitVal * 7);
      const loss = [];
      let cur = 1.9;
      for (let s = 0; s <= S; s++) {
        loss.push(cur);
        cur = Math.max(0.35, cur - (0.055 + rnd() * 0.03) / (1 + s * 0.05));
      }
      const steps = [];
      const push = (note, phase, extra = {}) => steps.push({
        bits, bitVal, r, S, baseParam, adapterParam, memBase, memAdapter, trainRatio,
        loss: loss.slice(), step: 0, phase, note,
        metrics: {
          基座位宽: bitVal, LoRA秩: r, 可训练参数: adapterParam,
          冻结比例: r3(1 - trainRatio, 5), 基座显存GB: r3(memBase, 2),
          当前Loss: r3(loss[0], 4),
        },
        ...extra,
      });
      push('大模型全量微调显存爆炸：优化器状态 + 梯度 + 激活往往数倍于模型本身。', 'intro');
      push(`基座 ${t2(baseParam / 1e9, 1)}B 参数${bits === '4bit' ? '以 NF4 量化' : `以 ${String(bitVal)}-bit 存储`}并完全冻结。`, 'intro');
      push(`NF4 用 4 bit 表示正态权重，配合双重量化与分页优化器，基座显存约 ${t2(memBase, 1)} GB。`,
        'intro');
      push(`只训练 LoRA：B(${String(4096)}×${String(r)})·A(${String(r)}×${String(4096)})，共 ${String(adapterParam)} 个参数。`, 'intro');
      for (let s = 1; s <= S; s++) {
        push(`第 ${s} 步·前向：量化基座与适配器并行计算，h = W_qx + (α/r)·BAx，loss=${loss[s].toFixed(4)}。`,
          'forward', { step: s,
            metrics: { 基座位宽: bitVal, LoRA秩: r, 可训练参数: adapterParam,
              冻结比例: r3(1 - trainRatio, 5), 基座显存GB: r3(memBase, 2), 当前Loss: r3(loss[s], 4) } });
        push(`第 ${s} 步·反向：梯度只回传适配器（${String(adapterParam)} 参数），4-bit 基座权重不更新。`,
          'update', { step: s,
            metrics: { 基座位宽: bitVal, LoRA秩: r, 可训练参数: adapterParam,
              冻结比例: r3(1 - trainRatio, 5), 基座显存GB: r3(memBase, 2), 当前Loss: r3(loss[s], 4) } });
      }
      push(`完成：训练 ${String(S)} 步 loss 降至 ${loss[S].toFixed(4)}，可训练参数仅占 ${t2(trainRatio * 100, 4)}%。`,
        'done', { step: S });
      return finalize(steps);
    },
    render(snap, p, c) {
      const bitVal = num(snap.bitVal, 4), r = num(snap.r, 8), S = num(snap.S, 5);
      const baseParam = num(snap.baseParam, 7e9), adapterParam = num(snap.adapterParam, 0);
      const memBase = num(snap.memBase, 3.5), memAdapter = num(snap.memAdapter, 0);
      const trainRatio = num(snap.trainRatio, 0), step = num(snap.step, 0), loss = snap.loss || [];
      const phase = snap.phase || 'intro';
      const out = [];
      out.push(<text key="h" x={20} y={38} fontSize="11" fill={c.text}>显存与参数量（越矮越省）</text>);
      const top = 60, base = 176, maxMem = Math.max(1, 16, memBase + memAdapter);
      const bh = Math.max(2, (memBase / maxMem) * (base - top));
      const ah = Math.max(2, (memAdapter / maxMem) * (base - top));
      out.push(<rect key="mb" x={60} y={base - bh} width={90} height={bh} rx={3} fill={c.muted} opacity={0.75} />);
      out.push(<text key="mbt" x={105} y={base - bh - 5} textAnchor="middle" fontSize="10" fill={c.text}>{`${t2(memBase, 1)}GB`}</text>);
      out.push(<text key="mbl" x={105} y={base + 14} textAnchor="middle" fontSize="9" fill={c.muted}>{`${String(bitVal)}-bit 基座`}</text>);
      out.push(<rect key="ab" x={210} y={base - ah} width={90} height={ah} rx={3} fill={c.success} opacity={0.85} />);
      out.push(<text key="abt" x={255} y={base - ah - 5} textAnchor="middle" fontSize="9" fill={c.text}>{`${t2(memAdapter, 3)}GB`}</text>);
      out.push(<text key="abl" x={255} y={base + 14} textAnchor="middle" fontSize="9" fill={c.muted}>LoRA 适配器</text>);
      out.push(<rect key="fb" x={370} y={base - (base - top) * 0.92} width={90} height={(base - top) * 0.92} rx={3} fill={c.danger} opacity={0.45} />);
      out.push(<text key="fbt" x={415} y={base - (base - top) * 0.92 - 5} textAnchor="middle" fontSize="9" fill={c.text}>16-bit 全量</text>);
      out.push(<text key="fbl" x={415} y={base + 14} textAnchor="middle" fontSize="9" fill={c.muted}>对照约 14GB</text>);
      out.push(<text key="pr" x={500} y={90} fontSize="11" fill={c.success}>
        {`冻结 ${t2(100 * (1 - trainRatio), 4)}%`}
      </text>);
      out.push(<text key="pr2" x={500} y={110} fontSize="10" fill={c.muted}>
        {`可训练 ${String(adapterParam)} / ${String(baseParam)}`}
      </text>);
      out.push(<text key="pr3" x={500} y={130} fontSize="10" fill={c.muted}>
        {`r=${String(r)}，α/r 缩放`}
      </text>);
      const rx = 20;
      out.push(<text key="ct" x={rx} y={214} fontSize="11" fill={c.text}>训练 loss 曲线</text>);
      const x0 = 60, x1 = 690, y0 = 232, y1 = 300;
      const lmax = Math.max(1e-6, num(loss[0], 1));
      const pts = [];
      for (let s = 0; s <= Math.min(step, S); s++) {
        const x = x0 + (s / Math.max(1, S)) * (x1 - x0);
        const y = y1 - clamp(num(loss[s], 0) / lmax, 0, 1) * (y1 - y0);
        pts.push(`${t2(x, 1)},${t2(y, 1)}`);
      }
      if (pts.length > 1) out.push(<polyline key="cl" points={pts.join(' ')} fill="none" stroke={c.primary} strokeWidth="1.8" />);
      out.push(<line key="ax" x1={x0} y1={y1} x2={x1} y2={y1} stroke={c.grid} strokeWidth="0.8" />);
      out.push(<text key="a0" x={x0} y={y1 + 13} fontSize="9" fill={c.muted}>步 0</text>);
      out.push(<text key="a1" x={x1} y={y1 + 13} textAnchor="end" fontSize="9" fill={c.muted}>{`步 ${String(S)}`}</text>);
      out.push(<text key="lv" x={x1} y={y0 + 8} textAnchor="end" fontSize="9" fill={c.warning}>
        {`loss ${t2(num(loss[Math.min(step, S)], 0), 4)}`}
      </text>);
      out.push(<text key="foot" x={20} y={H - 8} fontSize="10" fill={c.muted}>
        {phase === 'done' ? '量化基座 + 小适配器：显存大幅下降，效果接近全量微调' : '冻结的 4-bit 基座不产生梯度与优化器状态'}
      </text>);
      return (
        <svg viewBox={`0 0 720 ${H}`} width="100%" height={H} preserveAspectRatio="xMidYMid meet">
          <text x={20} y={20} fontSize="11" fill={c.text}>QLoRA · 4-bit 冻结基座 + 低秩适配器</text>
          {out}
        </svg>
      );
    },
  },

  'prompt-tuning': {
    params: [
      { key: 'promptLen', label: '软提示长度 p', type: 'range', min: 4, max: 20, step: 2, default: 8 },
      { key: 'steps', label: '训练步数', type: 'range', min: 5, max: 40, step: 5, default: 20 },
      { key: 'initMode', label: '软提示初始化', type: 'select', default: 'embed', options: [
        { value: 'embed', label: '用词嵌入初始化' }, { value: 'random', label: '随机初始化' },
        { value: 'template', label: '模板词初始化' },
      ] },
    ],
    height: H,
    legend: [{ label: '可训练软提示' }, { label: '冻结的基座模型' }, { label: 'loss 曲线' }],
    hint: 'Prompt Tuning：冻结整个基座，只在输入前拼一段可训练的连续向量（软提示），参数量极小。',
    buildSteps(p) {
      const P = clamp(Math.round(num(p.promptLen, 8)), 4, 20);
      const S = clamp(Math.round(num(p.steps, 20)), 5, 40);
      const mode = ['embed', 'random', 'template'].indexOf(p.initMode) >= 0 ? p.initMode : 'embed';
      const d = 768, baseParam = 7000000000;
      const softParam = P * d;
      const ratio = softParam / (baseParam + softParam);
      const rnd = mulberry32(73001 + P * 17 + S * 3);
      const soft = Array.from({ length: P }, (_, i) => Array.from({ length: 8 }, () => (rnd() * 2 - 1) * (mode === 'random' ? 1 : 0.4)));
      const loss = [];
      let cur = 2.1;
      for (let s = 0; s <= S; s++) {
        loss.push(cur);
        cur = Math.max(0.5, cur - (0.06 + rnd() * 0.02) / (1 + s * 0.04));
      }
      const steps = [];
      const push = (note, phase, extra = {}) => steps.push({
        P, S, mode, d, baseParam, softParam, ratio, soft, loss: loss.slice(),
        step: 0, tokenCount: 0, phase, note,
        metrics: {
          软提示长度: P, 可训练参数: softParam, 冻结参数: baseParam,
          可训练占比: r3(ratio, 6), 当前Loss: r3(loss[0], 4), 训练步: 0,
        },
        ...extra,
      });
      push('全量微调要更新所有权重；Prompt Tuning 只学输入前的 p 个连续向量。', 'intro');
      push(`软提示 p=${String(P)}、维度 d=${String(d)}，可训练参数 p·d=${String(softParam)}。`, 'intro');
      push(`${mode === 'embed' ? '用词嵌入' : (mode === 'random' ? '随机' : '模板词')}初始化这 p 个向量，其余参数全部冻结。`, 'intro');
      push(`可训练占比仅 ${t2(ratio * 100, 5)}%，不同下游任务只需保存一份小软提示。`, 'param');
      push('基座模型参数在训练中完全不变（灰），梯度只流向软提示（蓝）。', 'freeze');
      for (let i = 0; i < P; i++) {
        push(`初始化第 ${i + 1}/${String(P)} 个软提示向量，拼在真实输入 token 之前。`, 'init', { tokenCount: i + 1 });
      }
      for (let s = 1; s <= S; s++) {
        push(`第 ${s} 步：输入 = [软提示 p 个向量 ; 任务输入]，冻结基座前向，loss=${loss[s].toFixed(4)}，只更新软提示。`,
          'train', { step: s, tokenCount: P,
            metrics: { 软提示长度: P, 可训练参数: softParam, 冻结参数: baseParam,
              可训练占比: r3(ratio, 6), 当前Loss: r3(loss[s], 4), 训练步: s } });
      }
      push(`完成：训练 ${String(S)} 步，loss 降至 ${loss[S].toFixed(4)}，更新参数只有 ${String(softParam)} 个。`,
        'done', { step: S, tokenCount: P });
      return finalize(steps);
    },
    render(snap, p, c) {
      const P = num(snap.P, 4), S = num(snap.S, 5), d = num(snap.d, 768);
      const softParam = num(snap.softParam, 0), baseParam = num(snap.baseParam, 0);
      const ratio = num(snap.ratio, 0), soft = snap.soft || [], loss = snap.loss || [];
      const step = num(snap.step, 0), tokenCount = num(snap.tokenCount, 0), phase = snap.phase || 'intro';
      const out = [];
      out.push(<text key="h" x={20} y={38} fontSize="11" fill={c.text}>输入序列：[可训练软提示 p 个][冻结输入]</text>);
      const per = Math.min(28, 620 / Math.max(1, P + 4));
      const bw = Math.max(6, per - 4);
      for (let i = 0; i < P; i++) {
        const on = i < tokenCount;
        const x = 24 + i * per;
        out.push(<rect key={`sp${i}`} x={x} y={54} width={bw} height={34} rx={4}
          fill={on ? c.primary : c.panel2} opacity={on ? 0.9 : 0.5}
          stroke={on ? c.primary : 'none'} strokeWidth={on ? 1.2 : 0} />);
        out.push(<text key={`sl${i}`} x={x + bw / 2} y={75} textAnchor="middle" fontSize="9"
          fill={on ? c.bg : c.muted}>{`P${String(i)}`}</text>);
      }
      for (let i = 0; i < 4; i++) {
        const x = 24 + (P + i) * per;
        out.push(<rect key={`in${i}`} x={x} y={54} width={bw} height={34} rx={4} fill={c.muted} opacity={0.4} />);
        out.push(<text key={`il${i}`} x={x + bw / 2} y={75} textAnchor="middle" fontSize="9" fill={c.bg}>{String(TOK16[i])}</text>);
      }
      out.push(<text key="cap" x={20} y={106} fontSize="9" fill={c.primary}>{`蓝 = 可训练（p=${String(P)}）`}</text>);
      out.push(<text key="cap2" x={180} y={106} fontSize="9" fill={c.muted}>灰 = 冻结的基座</text>);
      const rx = 380;
      out.push(<text key="h2" x={rx} y={38} fontSize="11" fill={c.text}>可训练参数量对比</text>);
      const maxP = Math.max(1, baseParam, softParam);
      const bh = Math.max(2, (softParam / maxP) * 110);
      out.push(<rect key="bp" x={rx + 20} y={170 - 110} width={70} height={110} rx={3} fill={c.muted} opacity={0.65} />);
      out.push(<text key="bpt" x={rx + 55} y={52} textAnchor="middle" fontSize="9" fill={c.text}>{`${t2(baseParam / 1e9, 1)}B`}</text>);
      out.push(<text key="bpl" x={rx + 55} y={188} textAnchor="middle" fontSize="9" fill={c.muted}>冻结基座</text>);
      out.push(<rect key="sp" x={rx + 130} y={170 - bh} width={70} height={bh} rx={3} fill={c.success} opacity={0.9} />);
      out.push(<text key="spt" x={rx + 165} y={170 - bh - 5} textAnchor="middle" fontSize="9" fill={c.text}>{String(softParam)}</text>);
      out.push(<text key="spl" x={rx + 165} y={188} textAnchor="middle" fontSize="9" fill={c.muted}>软提示</text>);
      out.push(<text key="rt" x={rx} y={216} fontSize="11" fill={c.success}>
        {`可训练占比 ${t2(ratio * 100, 5)}%`}
      </text>);
      out.push(<text key="rt2" x={rx} y={236} fontSize="10" fill={c.muted}>
        {`d=${String(d)} · p·d=${String(softParam)}`}
      </text>);
      const x0 = 60, x1 = 690, y0 = 256, y1 = 312;
      const lmax = Math.max(1e-6, num(loss[0], 1));
      const pts = [];
      for (let s = 0; s <= Math.min(step, S); s++) {
        const x = x0 + (s / Math.max(1, S)) * (x1 - x0);
        const y = y1 - clamp(num(loss[s], 0) / lmax, 0, 1) * (y1 - y0);
        pts.push(`${t2(x, 1)},${t2(y, 1)}`);
      }
      if (pts.length > 1) out.push(<polyline key="lc" points={pts.join(' ')} fill="none" stroke={c.primary} strokeWidth="1.8" />);
      out.push(<text key="ct" x={20} y={252} fontSize="10" fill={c.text}>loss 曲线</text>);
      out.push(<text key="foot" x={20} y={H - 6} fontSize="10" fill={c.muted}>
        {phase === 'done' ? '一个任务只存一份小软提示，切换任务无需改动基座' : '梯度只更新软提示，基座权重保持不变'}
      </text>);
      return (
        <svg viewBox={`0 0 720 ${H}`} width="100%" height={H} preserveAspectRatio="xMidYMid meet">
          <text x={20} y={20} fontSize="11" fill={c.text}>Prompt / Prefix Tuning · 冻结基座 + 可训练软提示</text>
          {out}
        </svg>
      );
    },
  },

  sft: {
    params: [
      { key: 'epochs', label: '训练轮数', type: 'range', min: 1, max: 5, step: 1, default: 3 },
      { key: 'dataSize', label: '指令数据量', type: 'range', min: 100, max: 2000, step: 100, default: 1000 },
      { key: 'lr', label: '学习率', type: 'select', default: '5e-5', options: [
        { value: '1e-5', label: '1e-5（保守）' }, { value: '5e-5', label: '5e-5（常用）' },
        { value: '1e-4', label: '1e-4（激进）' },
      ] },
    ],
    height: H,
    legend: [{ label: '训练 loss' }, { label: '验证 loss' }, { label: '指令-回答样本' }],
    hint: 'SFT：用高质量「指令-回答」对做下一步预测训练，让预训练模型学会遵循人类指令。',
    buildSteps(p) {
      const E = clamp(Math.round(num(p.epochs, 3)), 1, 5);
      const data = clamp(Math.round(num(p.dataSize, 1000)), 100, 2000);
      const lr = p.lr === '1e-5' || p.lr === '1e-4' ? p.lr : '5e-5';
      const lrMul = lr === '1e-5' ? 0.6 : (lr === '1e-4' ? 1.5 : 1);
      const total = E * 20;
      const rnd = mulberry32(74001 + E * 37 + Math.floor(data / 100));
      const trainLoss = [], valLoss = [];
      let tr = 2.4, vl = 2.35;
      for (let s = 0; s <= total; s++) {
        trainLoss.push(tr);
        valLoss.push(vl);
        const dataGain = 0.35 * (1 - Math.exp(-data / 600));
        tr = Math.max(0.4, tr - (0.045 + rnd() * 0.02) * lrMul * (1 + dataGain * 0.4) / (1 + s * 0.02));
        vl = Math.max(0.45, vl - (0.036 + rnd() * 0.016) * lrMul * (1 + dataGain) / (1 + s * 0.022));
      }
      const pair = { q: '用一句话解释什么是过拟合？', a: '模型在训练集上表现很好，但在未见过的数据上泛化能力下降。' };
      const steps = [];
      const push = (note, phase, extra = {}) => steps.push({
        E, data, lr, total, trainLoss: trainLoss.slice(), valLoss: valLoss.slice(), pair,
        step: 0, epoch: 0, phase, note,
        metrics: {
          训练轮数: E, 数据量: data, 学习率: lr,
          训练步: 0, 训练Loss: r3(trainLoss[0], 4), 验证Loss: r3(valLoss[0], 4),
        },
        ...extra,
      });
      push('预训练模型会续写文本，但不天然「听指令」；SFT 用问答对教会它按指令输出。', 'intro');
      push(`数据集 ${String(data)} 条指令-回答，学习率 ${lr}，共 ${String(E)} 轮 × 20 步 = ${String(total)} 步。`, 'intro');
      push(`样本示例 — 指令：「${pair.q}」 回答：「${pair.a}」。`, 'sample');
      for (let e = 1; e <= E; e++) {
        push(`第 ${e}/${String(E)} 轮开始：打乱数据，按下一步预测目标计算 loss。`, 'epoch', { epoch: e });
        for (let b = 1; b <= 20; b++) {
          const s = (e - 1) * 20 + b;
          push(`第 ${e} 轮第 ${b} 步：预测回答的下一个 token，train loss=${trainLoss[s].toFixed(4)}，val loss=${valLoss[s].toFixed(4)}。`,
            'train', { step: s, epoch: e,
              metrics: { 训练轮数: E, 数据量: data, 学习率: lr, 训练步: s,
                训练Loss: r3(trainLoss[s], 4), 验证Loss: r3(valLoss[s], 4) } });
        }
      }
      push(`完成：${String(E)} 轮后 train loss=${trainLoss[total].toFixed(4)}，模型已学会遵循指令格式。`, 'done',
        { step: total, epoch: E });
      return finalize(steps);
    },
    render(snap, p, c) {
      const E = num(snap.E, 1), total = num(snap.total, 20), data = num(snap.data, 100);
      const lr = String(snap.lr || '5e-5'), trainLoss = snap.trainLoss || [], valLoss = snap.valLoss || [];
      const pair = snap.pair || {}, step = num(snap.step, 0), phase = snap.phase || 'intro';
      const out = [];
      const x0 = 60, x1 = 690, y0 = 52, y1 = 200;
      const lmax = Math.max(1e-6, num(trainLoss[0], 2));
      const px = (s) => x0 + (s / Math.max(1, total)) * (x1 - x0);
      const py = (v) => y1 - clamp(num(v, 0) / lmax, 0, 1) * (y1 - y0);
      out.push(<text key="h" x={20} y={38} fontSize="11" fill={c.text}>SFT 训练 / 验证 loss（轮次 {String(E)} · 数据 {String(data)} · lr {lr}）</text>);
      for (let i = 0; i <= 4; i++) {
        const y = y0 + (i / 4) * (y1 - y0);
        out.push(<line key={`g${i}`} x1={x0} y1={y} x2={x1} y2={y} stroke={c.grid} strokeWidth="0.8" />);
      }
      const line = (arr, color, key) => {
        const pts = [];
        for (let s = 0; s <= Math.min(step, total); s++) pts.push(`${t2(px(s), 1)},${t2(py(arr[s]), 1)}`);
        return pts.length > 1
          ? <polyline key={key} points={pts.join(' ')} fill="none" stroke={color} strokeWidth="1.8" />
          : null;
      };
      out.push(line(trainLoss, c.primary, 'tl'));
      out.push(line(valLoss, c.warning, 'vl'));
      out.push(<text key="tl" x={x1} y={y0 + 10} textAnchor="end" fontSize="9" fill={c.primary}>train</text>);
      out.push(<text key="vl" x={x1} y={y0 + 24} textAnchor="end" fontSize="9" fill={c.warning}>val</text>);
      out.push(<text key="x0" x={x0} y={y1 + 14} fontSize="9" fill={c.muted}>步 0</text>);
      out.push(<text key="x1" x={x1} y={y1 + 14} textAnchor="end" fontSize="9" fill={c.muted}>{`步 ${String(total)}`}</text>);
      out.push(<rect key="pb" x={20} y={222} width={680} height={68} rx={6} fill={c.panel2} stroke={c.border} />);
      out.push(<text key="ph" x={34} y={244} fontSize="11" fill={c.text}>指令-回答样本（下一步预测目标）</text>);
      out.push(<text key="pq" x={34} y={266} fontSize="10" fill={c.primary}>{`Q：${String(pair.q || '')}`}</text>);
      out.push(<text key="pa" x={34} y={282} fontSize="10" fill={c.muted}>{`A：${String(pair.a || '')}`}</text>);
      out.push(<text key="foot" x={20} y={H - 8} fontSize="10" fill={c.muted}>
        {phase === 'done' ? 'SFT 之后通常再做 RLHF / DPO 对齐' : 'loss 越低 = 模型越会按指令生成回答'}
      </text>);
      return (
        <svg viewBox={`0 0 720 ${H}`} width="100%" height={H} preserveAspectRatio="xMidYMid meet">
          <text x={20} y={20} fontSize="11" fill={c.text}>Supervised Fine-Tuning · 指令遵循训练</text>
          {out}
        </svg>
      );
    },
  },

  ppo: {
    params: [
      { key: 'steps', label: '训练步数', type: 'range', min: 10, max: 60, step: 5, default: 30 },
      { key: 'beta', label: 'KL 系数 β', type: 'range', min: 0.01, max: 0.2, step: 0.01, default: 0.05 },
      { key: 'clip', label: '裁剪 ε', type: 'range', min: 0.1, max: 0.4, step: 0.05, default: 0.2 },
    ],
    height: H,
    legend: [{ label: '奖励 reward' }, { label: 'KL 散度' }, { label: '裁剪区间' }],
    hint: 'PPO：用裁剪的重要性采样比限制策略更新幅度，配合 KL 惩罚稳定 RLHF 训练。',
    buildSteps(p) {
      const S = clamp(Math.round(num(p.steps, 30)), 10, 60);
      const beta = clamp(num(p.beta, 0.05), 0.01, 0.2);
      const eps = clamp(num(p.clip, 0.2), 0.1, 0.4);
      const rnd = mulberry32(75001 + S * 11 + Math.round(beta * 100) + Math.round(eps * 20));
      const reward = [], kl = [], ratio = [], clipFrac = [];
      let rw = 0.2;
      for (let t = 0; t <= S; t++) {
        reward.push(rw);
        kl.push(beta * (1 - Math.exp(-t / 12)) * (0.8 + rnd() * 0.4) + 0.01);
        const r = 1 + (rnd() - 0.5) * 0.6 * (1 - t / (S + 5));
        ratio.push(r);
        clipFrac.push(r < 1 - eps || r > 1 + eps ? 1 : 0);
        rw = Math.min(1.6, rw + (0.05 + rnd() * 0.02) * (1 - t / (S + 12)));
      }
      const steps = [];
      const push = (note, phase, extra = {}) => steps.push({
        S, beta, eps, reward: reward.slice(), kl: kl.slice(), ratio: ratio.slice(),
        clipFrac: clipFrac.slice(), step: 0, phase, note,
        metrics: {
          训练步: 0, 奖励: r3(reward[0], 3), KL: r3(kl[0], 4),
          裁剪比例: r3(clipFrac[0], 3), 重要性比: r3(ratio[0], 3),
        },
        ...extra,
      });
      push('RLHF 中先用人类偏好训练奖励模型，再用 PPO 优化策略模型去最大化奖励。', 'intro');
      push(`KL 系数 β=${t2(beta, 2)} 惩罚偏离参考模型；裁剪 ε=${t2(eps, 2)} 限制单步策略变化。`, 'intro');
      push('目标：L = E[min(r·A, clip(r,1−ε,1+ε)·A)] − β·KL(π||π_ref)。', 'formula');
      push('r = π_new(a|s)/π_old(a|s) 为重要性采样比，超出 [1−ε, 1+ε] 被裁剪。', 'formula');
      for (let t = 1; t <= S; t++) {
        push(`第 ${t} 步·rollout：采样回答，奖励模型打分 ${reward[t].toFixed(3)}，KL≈${kl[t].toFixed(4)}。`,
          'rollout', { step: t,
            metrics: { 训练步: t, 奖励: r3(reward[t], 3), KL: r3(kl[t], 4),
              裁剪比例: r3(clipFrac[t], 3), 重要性比: r3(ratio[t], 3) } });
        push(`第 ${t} 步·更新：r=${ratio[t].toFixed(3)}${clipFrac[t] ? '（超出裁剪区间，梯度被截断）' : '（区间内，正常更新）'}。`,
          'update', { step: t,
            metrics: { 训练步: t, 奖励: r3(reward[t], 3), KL: r3(kl[t], 4),
              裁剪比例: r3(clipFrac[t], 3), 重要性比: r3(ratio[t], 3) } });
      }
      push(`完成：奖励从 ${reward[0].toFixed(2)} 升到 ${reward[S].toFixed(2)}，KL 控制在 ${kl[S].toFixed(4)} 附近。`,
        'done', { step: S });
      return finalize(steps);
    },
    render(snap, p, c) {
      const S = num(snap.S, 10), beta = num(snap.beta, 0.05), eps = num(snap.eps, 0.2);
      const reward = snap.reward || [], kl = snap.kl || [], ratio = snap.ratio || [], clipFrac = snap.clipFrac || [];
      const step = num(snap.step, 0), phase = snap.phase || 'intro';
      const out = [];
      const x0 = 60, x1 = 500, y0 = 52, y1 = 190;
      out.push(<text key="h" x={20} y={38} fontSize="11" fill={c.text}>奖励与 KL 随训练变化（β={t2(beta, 2)}）</text>);
      const rmax = Math.max(0.5, ...reward);
      const kmax = Math.max(0.01, ...kl);
      const px = (t) => x0 + (t / Math.max(1, S)) * (x1 - x0);
      const pyR = (v) => y1 - clamp(num(v, 0) / rmax, 0, 1) * (y1 - y0);
      const pyK = (v) => y1 - clamp(num(v, 0) / kmax, 0, 1) * (y1 - y0);
      for (let i = 0; i <= 4; i++) {
        const y = y0 + (i / 4) * (y1 - y0);
        out.push(<line key={`g${i}`} x1={x0} y1={y} x2={x1} y2={y} stroke={c.grid} strokeWidth="0.8" />);
      }
      const pr = [], pk = [];
      for (let t = 0; t <= Math.min(step, S); t++) {
        pr.push(`${t2(px(t), 1)},${t2(pyR(reward[t]), 1)}`);
        pk.push(`${t2(px(t), 1)},${t2(pyK(kl[t]), 1)}`);
      }
      if (pr.length > 1) out.push(<polyline key="lr" points={pr.join(' ')} fill="none" stroke={c.success} strokeWidth="2" />);
      if (pk.length > 1) out.push(<polyline key="lk" points={pk.join(' ')} fill="none" stroke={c.danger} strokeWidth="1.8" strokeDasharray="5 3" />);
      out.push(<text key="rl" x={x1} y={y0 + 10} textAnchor="end" fontSize="9" fill={c.success}>reward</text>);
      out.push(<text key="kl" x={x1} y={y0 + 24} textAnchor="end" fontSize="9" fill={c.danger}>KL</text>);
      const rx = 530;
      out.push(<text key="h2" x={rx} y={38} fontSize="11" fill={c.text}>重要性比 r 与裁剪</text>);
      const cx = 610, cy = 116, rr = 64;
      out.push(<line key="lo" x1={cx - rr} y1={cy} x2={cx + rr} y2={cy} stroke={c.grid} strokeWidth="1" />);
      const lo = cx - rr * Math.min(1, eps), hi = cx + rr * Math.min(1, eps);
      out.push(<rect key="band" x={lo} y={cy - 8} width={Math.max(2, hi - lo)} height={16} rx={3}
        fill={c.success} opacity={0.28} />);
      const r = num(ratio[Math.min(step, S)], 1);
      const rx2 = cx + rr * clamp(r - 1, -1, 1);
      out.push(<circle key="rd" cx={rx2} cy={cy} r="6" fill={num(clipFrac[Math.min(step, S)], 0) ? c.danger : c.primary} />);
      out.push(<text key="rt" x={rx} y={cy + 34} fontSize="10" fill={c.text}>{`r = ${t2(r, 3)}`}</text>);
      out.push(<text key="rt2" x={rx} y={cy + 52} fontSize="10" fill={c.muted}>{`区间 [${t2(1 - eps, 2)}, ${t2(1 + eps, 2)}]`}</text>);
      out.push(<text key="rt3" x={rx} y={cy + 70} fontSize="10" fill={num(clipFrac[Math.min(step, S)], 0) ? c.danger : c.success}>
        {num(clipFrac[Math.min(step, S)], 0) ? '已裁剪' : '正常更新'}
      </text>);
      out.push(<line key="dv" x1={516} y1={24} x2={516} y2={H - 14} stroke={c.grid} strokeWidth="1" />);
      out.push(<rect key="pb" x={20} y={214} width={680} height={78} rx={6} fill={c.panel2} stroke={c.border} />);
      out.push(<text key="pt" x={34} y={238} fontSize="11" fill={c.text}>当前状态 · 步 {String(step)}</text>);
      out.push(<text key="p1" x={34} y={260} fontSize="10" fill={c.success}>{`奖励 ${t2(num(reward[Math.min(step, S)], 0), 3)} · KL ${t2(num(kl[Math.min(step, S)], 0), 4)}`}</text>);
      out.push(<text key="p2" x={34} y={280} fontSize="10" fill={c.muted}>裁剪让策略更新更稳；β 越大越贴近参考模型</text>);
      out.push(<text key="foot" x={20} y={H - 6} fontSize="10" fill={c.muted}>
        {phase === 'done' ? 'PPO 稳定但需在线采样与奖励模型，工程复杂' : '每步先采样 rollout，再做裁剪更新'}
      </text>);
      return (
        <svg viewBox={`0 0 720 ${H}`} width="100%" height={H} preserveAspectRatio="xMidYMid meet">
          <text x={20} y={20} fontSize="11" fill={c.text}>PPO · 裁剪策略优化 + KL 约束</text>
          {out}
        </svg>
      );
    },
  },

  dpo: {
    params: [
      { key: 'beta', label: 'β 偏离约束', type: 'range', min: 0.05, max: 0.6, step: 0.05, default: 0.1 },
      { key: 'strength', label: '偏好数据质量', type: 'range', min: 0.2, max: 1, step: 0.1, default: 0.8 },
      { key: 'steps', label: '训练步数', type: 'range', min: 10, max: 60, step: 5, default: 30 },
    ],
    height: H,
    legend: [{ label: 'chosen 概率' }, { label: 'rejected 概率' }, { label: '偏好间隔 margin' }],
    hint: 'DPO：把奖励隐含进偏好似然，无需奖励模型和在线采样，直接用成对偏好数据优化。',
    buildSteps(p) {
      const beta = clamp(num(p.beta, 0.1), 0.05, 0.6);
      const q = clamp(num(p.strength, 0.8), 0.2, 1);
      const S = clamp(Math.round(num(p.steps, 30)), 10, 60);
      const rnd = mulberry32(76001 + Math.round(beta * 100) + S);
      const pc = [], pr = [], margin = [], loss = [];
      for (let t = 0; t <= S; t++) {
        const prog = 1 - Math.exp(-t / (10 + beta * 20));
        const gain = 0.4 * q * prog / (1 + beta);
        const c = clamp(0.55 + gain + (rnd() - 0.5) * 0.01, 0.05, 0.95);
        const r = clamp(0.45 - gain * 0.8 + (rnd() - 0.5) * 0.01, 0.03, 0.93);
        pc.push(c); pr.push(r); margin.push(c - r);
        loss.push(-Math.log(1 / (1 + Math.exp(-beta * Math.log((c / (1 - c)) / (r / (1 - r)))))));
      }
      const pair = { prompt: '请解释什么是机器学习？', chosen: '让模型从数据中学习规律并泛化到新样本。', rejected: '就是电脑自己写代码，不需要人管。' };
      const steps = [];
      const push = (note, phase, extra = {}) => steps.push({
        beta, q, S, pc: pc.slice(), pr: pr.slice(), margin: margin.slice(), loss: loss.slice(), pair,
        step: 0, phase, note,
        metrics: {
          训练步: 0, chosen概率: r3(pc[0], 3), rejected概率: r3(pr[0], 3),
          偏好间隔: r3(margin[0], 3), Loss: r3(loss[0], 3),
        },
        ...extra,
      });
      push('偏好数据形如 (prompt, chosen, rejected)：同一个问题，人类更喜欢 chosen。', 'intro');
      push(`样本 — prompt：「${pair.prompt}」；chosen：「${pair.chosen}」；rejected：「${pair.rejected}」。`, 'pair');
      push('DPO 损失：L = −log σ(β·[log π(y_w)/π_ref(y_w) − log π(y_l)/π_ref(y_l)])。', 'formula');
      push(`β=${t2(beta, 2)} 越大越贴近参考模型；不需要显式奖励模型与在线采样。`, 'formula');
      for (let t = 1; t <= S; t++) {
        push(`第 ${t} 步：chosen 概率 ${pc[t].toFixed(3)}，rejected ${pr[t].toFixed(3)}，间隔 ${margin[t].toFixed(3)}，loss=${loss[t].toFixed(3)}。`,
          'train', { step: t,
            metrics: { 训练步: t, chosen概率: r3(pc[t], 3), rejected概率: r3(pr[t], 3),
              偏好间隔: r3(margin[t], 3), Loss: r3(loss[t], 3) } });
        if (t % 5 === 0) {
          push(`第 ${t} 步·评估：偏好间隔已达 ${margin[t].toFixed(3)}，隐式奖励差 = β·Δlogπ = ${(beta * Math.log((pc[t] / (1 - pc[t])) / (pr[t] / (1 - pr[t])))).toFixed(3)}。`,
            'eval', { step: t });
        }
      }
      push(`完成：间隔从 ${margin[0].toFixed(3)} 扩大到 ${margin[S].toFixed(3)}，策略更偏好人类选择的回答。`,
        'done', { step: S });
      return finalize(steps);
    },
    render(snap, p, c) {
      const S = num(snap.S, 10), beta = num(snap.beta, 0.1), q = num(snap.q, 0.8);
      const pc = snap.pc || [], pr = snap.pr || [], margin = snap.margin || [], loss = snap.loss || [];
      const pair = snap.pair || {}, step = num(snap.step, 0), phase = snap.phase || 'intro';
      const i = Math.min(step, S);
      const out = [];
      out.push(<text key="h" x={20} y={38} fontSize="11" fill={c.text}>偏好对概率（步 {String(step)} · β={t2(beta, 2)}）</text>);
      const cw = Math.min(300, 660 / 2 - 20);
      const valC = num(pc[i], 0.5), valR = num(pr[i], 0.5);
      out.push(<rect key="cb" x={30} y={54} width={cw * valC} height={26} rx={4} fill={c.success} opacity={0.85} />);
      out.push(<text key="cl" x={30 + cw * valC + 8} y={72} fontSize="10" fill={c.text}>{`chosen ${t2(valC, 3)}`}</text>);
      out.push(<rect key="rb" x={30} y={96} width={cw * valR} height={26} rx={4} fill={c.danger} opacity={0.8} />);
      out.push(<text key="rl" x={30 + cw * valR + 8} y={114} fontSize="10" fill={c.text}>{`rejected ${t2(valR, 3)}`}</text>);
      out.push(<text key="mg" x={30} y={144} fontSize="11" fill={c.primary}>{`偏好间隔 margin = ${t2(num(margin[i], 0), 3)}`}</text>);
      const rx = 372;
      out.push(<text key="h2" x={rx} y={38} fontSize="11" fill={c.text}>chosen / rejected / margin 曲线</text>);
      const x0 = rx + 20, x1 = 700, y0 = 56, y1 = 176;
      const px = (t) => x0 + (t / Math.max(1, S)) * (x1 - x0);
      const py = (v) => y1 - clamp(num(v, 0), 0, 1) * (y1 - y0);
      const mk = (arr, color, key) => {
        const pts = [];
        for (let t = 0; t <= Math.min(step, S); t++) pts.push(`${t2(px(t), 1)},${t2(py(arr[t]), 1)}`);
        return pts.length > 1 ? <polyline key={key} points={pts.join(' ')} fill="none" stroke={color} strokeWidth="1.8" /> : null;
      };
      out.push(mk(pc, c.success, 'pc'));
      out.push(mk(pr, c.danger, 'pr'));
      out.push(mk(margin, c.primary, 'mg'));
      out.push(<line key="ax" x1={x0} y1={y1} x2={x1} y2={y1} stroke={c.grid} strokeWidth="0.8" />);
      out.push(<rect key="pb" x={20} y={204} width={680} height={82} rx={6} fill={c.panel2} stroke={c.border} />);
      out.push(<text key="pt" x={34} y={226} fontSize="11" fill={c.text}>偏好对样本</text>);
      out.push(<text key="pp" x={34} y={246} fontSize="10" fill={c.muted}>{`Prompt：${String(pair.prompt || '')}`}</text>);
      out.push(<text key="pw" x={34} y={264} fontSize="10" fill={c.success}>{`Chosen  ✓ ${String(pair.chosen || '')}`}</text>);
      out.push(<text key="pl" x={34} y={280} fontSize="10" fill={c.danger}>{`Rejected ✗ ${String(pair.rejected || '')}`}</text>);
      out.push(<text key="foot" x={20} y={H - 8} fontSize="10" fill={c.muted}>
        {phase === 'done' ? 'DPO 离线、简洁，但对偏好数据分布较敏感' : `loss=${t2(num(loss[i], 0), 3)} · 离线优化，无需在线采样`}
      </text>);
      return (
        <svg viewBox={`0 0 720 ${H}`} width="100%" height={H} preserveAspectRatio="xMidYMid meet">
          <text x={20} y={20} fontSize="11" fill={c.text}>DPO · 直接偏好优化（隐式奖励）</text>
          {out}
        </svg>
      );
    },
  },

  hnsw: {
    params: [
      { key: 'layers', label: '层数 L', type: 'range', min: 2, max: 5, step: 1, default: 3 },
      { key: 'nodeCount', label: '节点数', type: 'range', min: 12, max: 40, step: 4, default: 20 },
      { key: 'ef', label: 'ef 搜索宽度', type: 'range', min: 2, max: 16, step: 2, default: 8 },
    ],
    height: H,
    legend: [{ label: '当前层节点' }, { label: '搜索路径' }, { label: '最近邻结果' }],
    hint: 'HNSW：多层近邻图，高层做粗导航、底层精细搜索，贪心游走实现近似最近邻检索。',
    buildSteps(p) {
      const L = clamp(Math.round(num(p.layers, 3)), 2, 5);
      const N = clamp(Math.round(num(p.nodeCount, 20)), 12, 40);
      const ef = clamp(Math.round(num(p.ef, 8)), 2, 16);
      const rnd = mulberry32(77001 + N * 13 + L * 7 + ef);
      const base = Array.from({ length: N }, (_, i) => ({
        id: i, x: 0.08 + 0.84 * rnd(), y: 0.1 + 0.8 * rnd(), layer: 0,
      }));
      const graph = [base];
      for (let l = 1; l < L; l++) {
        const upper = graph[l - 1].filter(() => rnd() < 0.45).map((n) => ({ ...n, y: 0.1 + 0.8 * rnd(), layer: l }));
        if (!upper.length) upper.push({ ...graph[l - 1][0], y: 0.12, layer: l });
        graph.push(upper);
      }
      const edges = [];
      graph.forEach((nodes, l) => {
        nodes.forEach((n, i) => {
          const near = nodes.filter((_, j) => j !== i)
            .sort((a, b) => ((a.x - n.x) ** 2 + (a.y - n.y) ** 2) - ((b.x - n.x) ** 2 + (b.y - n.y) ** 2))
            .slice(0, 3);
          near.forEach((m) => edges.push({ from: `${l}-${n.id}`, to: `${l}-${m.id}`, layer: l }));
        });
      });
      const query = { x: 0.5, y: 0.5 };
      const dist = (n) => Math.sqrt((n.x - query.x) ** 2 + (n.y - query.y) ** 2);
      const steps = [];
      const push = (note, phase, extra = {}) => steps.push({
        L, N, ef, graph: graph.map((lv) => lv.map((n) => ({ ...n }))), edges, query,
        curLayer: L - 1, curId: -1, phase, note,
        metrics: {
          层数: L, 节点数: N, ef: ef, 当前层: L - 1,
          候选数: 0, 到查询距离: r3(1, 3),
        },
        ...extra,
      });
      push('HNSW 是带层次的小世界图：上层稀疏做导航，下层密集做精细搜索。', 'intro',
        { curLayer: L - 1, curId: 0 });
      for (let k = 1; k < 5; k++) {
        push(`第 ${k}/5 步概览：从最高层入口点出发，逐层贪心靠近查询 q。`,
          'intro', { curLayer: Math.max(0, L - 1 - k), curId: k });
      }
      for (let l = 0; l < L; l++) {
        push(`构建第 ${l} 层：${String(graph[l].length)} 个节点，每个节点连到最近的 3 个邻居。`, 'build',
          { curLayer: l, curId: -1 });
      }
      push(`从最高层 ${String(L - 1)} 的入口点开始，向查询 q 贪心游走。`, 'entry', { curLayer: L - 1, curId: 0 });
      for (let l = L - 1; l >= 0; l--) {
        const nodes = graph[l];
        for (let k = 0; k < Math.min(6, nodes.length); k++) {
          const n = nodes[k % nodes.length];
          push(`第 ${l} 层：访问节点 ${String(n.id)}，到查询距离 ${dist(n).toFixed(3)}，若更近则继续贪心。`,
            'walk', { curLayer: l, curId: n.id,
              metrics: { 层数: L, 节点数: N, ef: ef, 当前层: l, 候选数: k + 1, 到查询距离: r3(dist(n), 3) } });
        }
      }
      const bottom = graph[0].slice().sort((a, b) => dist(a) - dist(b)).slice(0, ef);
      bottom.forEach((n, k) => {
        push(`底层 ef 搜索：候选 ${k + 1}/${String(ef)}，节点 ${String(n.id)} 距离 ${dist(n).toFixed(3)}。`,
          'ef', { curLayer: 0, curId: n.id,
            metrics: { 层数: L, 节点数: N, ef: ef, 当前层: 0, 候选数: k + 1, 到查询距离: r3(dist(n), 3) } });
      });
      push(`完成：返回最近的 ${String(Math.min(ef, bottom.length))} 个候选，召回率高且查询约 O(log n)。`,
        'done', { curLayer: 0, curId: bottom.length ? bottom[0].id : 0 });
      push(`收尾：共访问 ${String(L)} 层图结构，实际查询复杂度近似 O(log n)。`,
        'done', { curLayer: 0, curId: bottom.length ? bottom[bottom.length - 1].id : 0 });
      return finalize(steps);
    },
    render(snap, p, c) {
      const L = num(snap.L, 2), ef = num(snap.ef, 2);
      const graph = snap.graph || [], edges = snap.edges || [], query = snap.query || { x: 0.5, y: 0.5 };
      const curLayer = num(snap.curLayer, 0), curId = num(snap.curId, -1), phase = snap.phase || 'intro';
      const out = [];
      out.push(<text key="h" x={20} y={36} fontSize="11" fill={c.text}>HNSW 分层近邻图（层 {String(curLayer)} / 共 {String(L)} 层）</text>);
      const px = (x) => 40 + num(x, 0) * 640;
      const py = (y) => 72 + ((L - 1 - curLayer) * 0 + num(y, 0)) * 150;
      const qx = px(query.x), qy = py(query.y);
      const nodes = graph[curLayer] || [];
      const activeEdges = edges.filter((e) => e.layer === curLayer);
      out.push(<circle key="qc" cx={qx} cy={qy} r="9" fill="none" stroke={c.danger} strokeWidth="2" strokeDasharray="4 3" />);
      out.push(<text key="ql" x={qx + 12} y={qy - 8} fontSize="10" fill={c.danger}>query</text>);
      activeEdges.forEach((e, i) => {
        const a = nodes.find((n) => String(n.id) === String(e.from).split('-')[1]);
        const b = nodes.find((n) => String(n.id) === String(e.to).split('-')[1]);
        if (!a || !b) return;
        out.push(<line key={`e${i}`} x1={px(a.x)} y1={py(a.y)} x2={px(b.x)} y2={py(b.y)}
          stroke={c.border} strokeWidth="1" />);
      });
      nodes.forEach((n) => {
        const active = n.id === curId && phase !== 'intro' && phase !== 'build';
        out.push(<circle key={`n${n.id}`} cx={px(n.x)} cy={py(n.y)} r={active ? 9 : 6}
          fill={active ? c.warning : (phase === 'done' ? c.success : c.primary)} opacity={active ? 1 : 0.72} />);
        out.push(<text key={`t${n.id}`} x={px(n.x)} y={py(n.y) + 3} textAnchor="middle" fontSize="8"
          fill={c.bg}>{String(n.id)}</text>);
      });
      out.push(<text key="h2" x={20} y={248} fontSize="11" fill={c.text}>搜索轨迹</text>);
      out.push(<rect key="pb" x={20} y={260} width={680} height={56} rx={6} fill={c.panel2} stroke={c.border} />);
      out.push(<text key="p1" x={34} y={282} fontSize="10" fill={c.muted}>
        {`入口点 → 高层贪心逐层下降 → 底层 ef=${String(ef)} 候选精排`}
      </text>);
      out.push(<text key="p2" x={34} y={302} fontSize="10" fill={c.text}>
        {`当前访问：第 ${String(curLayer)} 层节点 ${curId >= 0 ? String(curId) : '—'} · 复杂度约 O(log n)`}
      </text>);
      out.push(<text key="foot" x={20} y={H - 8} fontSize="10" fill={c.muted}>
        {phase === 'done' ? `返回 Top-${String(ef)} 近邻，高召回的 ANN 索引` : '红圈为查询点，黄色为当前访问的图节点'}
      </text>);
      return (
        <svg viewBox={`0 0 720 ${H}`} width="100%" height={H} preserveAspectRatio="xMidYMid meet">
          <text x={20} y={20} fontSize="11" fill={c.text}>HNSW · 分层图贪心导航</text>
          {out}
        </svg>
      );
    },
  },

  'rag-rerank': {
    params: [
      { key: 'candidates', label: '召回候选数', type: 'range', min: 6, max: 14, step: 2, default: 10 },
      { key: 'topK', label: '送入上下文 k', type: 'range', min: 2, max: 6, step: 1, default: 3 },
      { key: 'strength', label: '重排强度', type: 'range', min: 0, max: 1, step: 0.1, default: 0.6 },
    ],
    height: H,
    legend: [{ label: '召回分数（浅）' }, { label: '重排分数（深）' }, { label: '入选上下文' }],
    hint: 'RAG 重排：召回阶段快速但粗糙，交叉编码器精排后，把真正相关的片段放进有限上下文。',
    buildSteps(p) {
      const K = clamp(Math.round(num(p.candidates, 10)), 6, 14);
      const top = clamp(Math.round(num(p.topK, 3)), 2, 6);
      const str = clamp(num(p.strength, 0.6), 0, 1);
      const rnd = mulberry32(78001 + K * 17 + Math.round(str * 100));
      const docs = Array.from({ length: K }, (_, i) => {
        const relevant = i % 3 === 0;
        const first = 0.35 + rnd() * 0.45 + (relevant ? 0 : 0.12);
        const boost = (relevant ? 0.45 : -0.08) * str;
        const second = clamp(first + boost + (rnd() - 0.5) * 0.08, 0, 1);
        return { id: i, relevant, first, second };
      });
      const ranked = docs.slice().sort((a, b) => b.second - a.second).map((d) => d.id);
      const steps = [];
      const push = (note, phase, extra = {}) => steps.push({
        K, top, str, docs: docs.map((d) => ({ ...d })), ranked,
        scored: 0, reranked: 0, selected: [], phase, note,
        metrics: {
          候选数: K, 送入k: top, 重排强度: str,
          召回命中: 0, 重排后命中: 0, 已打分: 0,
        },
        ...extra,
      });
      push('RAG 分两阶段：先从向量库快速召回若干候选，再精排挑出最相关的几条。', 'intro');
      push(`召回 ${String(K)} 个候选，重排强度 ${t2(str, 1)}，最终只把 top-${String(top)} 拼进上下文。`, 'intro');
      push('召回分数来自 BM25 / 向量余弦，计算快但难以捕捉细粒度相关性。', 'intro');
      push('交叉编码器把 query 与 doc 拼在一起打分，精度高但慢，所以只用于候选集。', 'intro');
      push(`真实相关片段用深色标记，共 ${String(docs.filter((d) => d.relevant).length)} 条。`, 'intro');
      for (let i = 0; i < K; i++) {
        push(`召回打分：片段 #${String(i)} 分数 ${docs[i].first.toFixed(3)}${docs[i].relevant ? '（实际相关）' : ''}。`,
          'recall', { scored: i + 1,
            metrics: { 候选数: K, 送入k: top, 重排强度: str, 召回命中: 0, 重排后命中: K, 已打分: i + 1 } });
      }
      for (let i = 0; i < K; i++) {
        const d = docs[i];
        push(`重排：片段 #${String(i)} ${d.first.toFixed(3)} → ${d.second.toFixed(3)}${d.relevant ? '（相关片段被提分）' : '（噪声被压低）'}。`,
          'rerank', { scored: K, reranked: i + 1,
            metrics: { 候选数: K, 送入k: top, 重排强度: str, 召回命中: 0, 重排后命中: i + 1, 已打分: K } });
      }
      const sel = [];
      for (let k = 0; k < Math.min(top, ranked.length); k++) {
        const id = ranked[k];
        sel.push(id);
        const d = docs[id];
        push(`选入第 ${k + 1} 条：片段 #${String(id)}，重排分数 ${d.second.toFixed(3)}${d.relevant ? '，命中相关内容' : '，相关性一般'}。`,
          'select', { scored: K, reranked: K, selected: sel.slice() });
      }
      const hits = sel.filter((id) => docs[id].relevant).length;
      push(`完成：top-${String(top)} 中命中 ${String(hits)} 条相关片段，上下文质量更高、幻觉更少。`,
        'done', { scored: K, reranked: K, selected: sel.slice() });
      return finalize(steps);
    },
    render(snap, p, c) {
      const K = num(snap.K, 6), top = num(snap.top, 2), str = num(snap.str, 0);
      const docs = snap.docs || [], ranked = snap.ranked || [];
      const scored = num(snap.scored, 0), reranked = num(snap.reranked, 0);
      const selected = snap.selected || [], phase = snap.phase || 'intro';
      const sel = new Set(selected);
      const out = [];
      out.push(<text key="h" x={20} y={38} fontSize="11" fill={c.text}>候选分数：召回（浅）→ 重排（深）</text>);
      const rowH = Math.min(19, 240 / Math.max(1, K));
      const bx = 150, bw = Math.min(360, 400);
      docs.forEach((d, i) => {
        const y = 52 + i * rowH;
        const rec = i < scored;
        const rer = i < reranked;
        const f = num(d.first, 0), s = num(d.second, 0);
        const on = sel.has(d.id) && ['select', 'done'].includes(phase);
        out.push(<text key={`l${i}`} x={140} y={y + rowH - 4} textAnchor="end" fontSize="9"
          fill={d.relevant ? c.success : c.muted}>{`#${String(i)}${d.relevant ? '·相关' : ''}`}</text>);
        out.push(<rect key={`r1${i}`} x={bx} y={y + 1} width={rec ? bw * f : 0} height={Math.max(3, rowH / 2 - 2)} rx={2}
          fill={c.muted} opacity={0.45} />);
        out.push(<rect key={`r2${i}`} x={bx} y={y + rowH / 2} width={rer ? bw * s : 0} height={Math.max(3, rowH / 2 - 2)} rx={2}
          fill={on ? c.success : (d.relevant ? c.primary : c.danger)} opacity={on ? 0.95 : 0.7} />);
        if (rer) out.push(<text key={`v${i}`} x={bx + bw * s + 6} y={y + rowH - 4} fontSize="9"
          fill={on ? c.success : c.text}>{t2(s, 2)}</text>);
      });
      const rx = 560;
      out.push(<text key="h2" x={rx} y={38} fontSize="11" fill={c.text}>送入上下文的片段</text>);
      const topList = phase === 'intro' ? [] : (['select', 'done'].includes(phase) ? selected : ranked.slice(0, top));
      topList.forEach((id, k) => {
        const d = docs[id] || {};
        out.push(<rect key={`s${k}`} x={rx} y={56 + k * 30} width={150} height={24} rx={4}
          fill={d.relevant ? c.success : c.panel2} opacity={d.relevant ? 0.85 : 0.6} />);
        out.push(<text key={`st${k}`} x={rx + 8} y={72 + k * 30} fontSize="10" fill={d.relevant ? c.bg : c.text}>
          {`${String(k + 1)}. 片段#${String(id)}`}
        </text>);
      });
      out.push(<text key="rx2" x={rx} y={252} fontSize="10" fill={c.muted}>
        {`重排强度 ${t2(str, 1)} · top-${String(top)}`}
      </text>);
      out.push(<line key="dv" x1={542} y1={24} x2={542} y2={H - 14} stroke={c.grid} strokeWidth="1" />);
      out.push(<text key="foot" x={20} y={H - 8} fontSize="10" fill={c.muted}>
        {phase === 'done' ? '相关片段进入上下文 → 答案更忠实、幻觉更少' : '重排把相关片段从召回队列里提升到前列'}
      </text>);
      return (
        <svg viewBox={`0 0 720 ${H}`} width="100%" height={H} preserveAspectRatio="xMidYMid meet">
          <text x={20} y={20} fontSize="11" fill={c.text}>RAG Reranking · 候选重排与上下文选择</text>
          {out}
        </svg>
      );
    },
  },

  'context-window': {
    params: [
      { key: 'windowSize', label: '窗口大小', type: 'range', min: 4, max: 12, step: 2, default: 8 },
      { key: 'docLen', label: '文档长度', type: 'range', min: 10, max: 30, step: 2, default: 20 },
      { key: 'stride', label: '滑动步长', type: 'range', min: 1, max: 4, step: 1, default: 2 },
    ],
    height: H,
    legend: [{ label: '当前窗口内 token' }, { label: '窗口外被截断' }, { label: '滑窗起点' }],
    hint: '上下文窗口：模型一次只能看到有限 token；长文档要按窗口截断或滑动 processing。',
    buildSteps(p) {
      const Wn = clamp(Math.round(num(p.windowSize, 8)), 4, 12);
      const D = clamp(Math.round(num(p.docLen, 20)), 10, 30);
      const st = clamp(Math.round(num(p.stride, 2)), 1, 4);
      const tokens = Array.from({ length: D }, (_, i) => TOK16[i % TOK16.length]);
      const starts = [];
      for (let s = 0; s < D; s += st) starts.push(s);
      if (starts[starts.length - 1] !== Math.max(0, D - Wn)) starts.push(Math.max(0, D - Wn));
      const steps = [];
      const push = (note, phase, extra = {}) => steps.push({
        Wn, D, st, tokens, starts,
        start: 0, tokenCount: 0, winIdx: 0, phase, note,
        metrics: {
          窗口大小: Wn, 文档长度: D, 滑动步长: st,
          窗口数: starts.length, 当前起点: 0, 注意力代价: Wn * Wn,
        },
        ...extra,
      });
      push('Transformer 注意力复杂度随序列长度平方增长，因此上下文窗口有硬上限。', 'intro');
      push(`窗口大小 ${String(Wn)}，文档 ${String(D)} 个 token，步长 ${String(st)}，共 ${String(starts.length)} 个窗口。`, 'intro');
      push(`每个窗口的注意力代价约 ${String(Wn)}² = ${String(Wn * Wn)}；超出窗口的 token 必须截断或滑窗。`, 'intro');
      push(`先对文档分词，共 ${String(D)} 个 token。`, 'intro');
      for (let i = 0; i < D; i++) {
        push(`token ${i + 1}/${String(D)}：「${tokens[i]}」，进入长度 ${String(D)} 的输入序列。`,
          'tokenize', { tokenCount: i + 1 });
      }
      starts.forEach((s, k) => {
        const end = Math.min(D, s + Wn);
        push(`窗口 ${k + 1}/${String(starts.length)}：覆盖 [${String(s)}, ${String(end)})，窗口外 ${String(D - (end - s))} 个 token 暂不可见。`,
          'load', { start: s, winIdx: k + 1, tokenCount: D,
            metrics: { 窗口大小: Wn, 文档长度: D, 滑动步长: st, 窗口数: starts.length,
              当前起点: s, 注意力代价: (end - s) * (end - s) } });
        push(`窗口 ${k + 1} 内做自注意力，代价 O(${(end - s)}²)；滑窗让模型分段看完整个文档。`,
          'attend', { start: s, winIdx: k + 1, tokenCount: D });
        push(`窗口 ${k + 1} 输出融合后的表示，向前滑动 ${String(st)} 个 token 继续。`,
          'shift', { start: s, winIdx: k + 1, tokenCount: D });
      });
      push(`完成：${String(starts.length)} 个窗口覆盖 ${String(D)} 个 token，避免一次性 ${String(D)}² 的注意力开销。`,
        'done', { start: starts[starts.length - 1] || 0, winIdx: starts.length, tokenCount: D });
      return finalize(steps);
    },
    render(snap, p, c) {
      const Wn = num(snap.Wn, 4), D = num(snap.D, 10), st = num(snap.st, 1);
      const tokens = snap.tokens || [], starts = snap.starts || [];
      const start = num(snap.start, 0), tokenCount = num(snap.tokenCount, 0);
      const winIdx = num(snap.winIdx, 0), phase = snap.phase || 'intro';
      const out = [];
      out.push(<text key="h" x={20} y={38} fontSize="11" fill={c.text}>
        {`文档 token 序列（${String(D)} 个）· 窗口宽 ${String(Wn)} · 步长 ${String(st)}`}
      </text>);
      const per = Math.min(38, 660 / Math.max(1, D));
      const bw = Math.max(4, per - 3);
      for (let i = 0; i < D; i++) {
        const x = 24 + i * per;
        const known = i < tokenCount;
        const inWin = known && i >= start && i < start + Wn;
        out.push(<rect key={`t${i}`} x={x} y={58} width={bw} height={34} rx={3}
          fill={inWin ? c.primary : (known ? c.panel2 : c.border)} opacity={inWin ? 0.92 : (known ? 0.5 : 0.25)} />);
        out.push(<text key={`l${i}`} x={x + bw / 2} y={80} textAnchor="middle" fontSize={D > 20 ? 7 : 10}
          fill={inWin ? c.bg : c.muted}>{known ? String(tokens[i] || '') : ''}</text>);
      }
      const wx = 24 + start * per, ww = Math.min(Wn, Math.max(0, D - start)) * per;
      out.push(<rect key="win" x={wx - 2} y={54} width={Math.max(2, ww)} height={42} rx={4}
        fill="none" stroke={c.warning} strokeWidth="1.8" />);
      out.push(<text key="wl" x={wx} y={112} fontSize="9" fill={c.warning}>{`窗口起点 ${String(start)}`}</text>);
      out.push(<text key="h2" x={20} y={140} fontSize="11" fill={c.text}>滑动窗口序列</text>);
      const shown = Math.min(12, starts.length);
      starts.slice(0, shown).forEach((s, k) => {
        const x = 24 + k * Math.min(56, 660 / shown);
        const on = k < winIdx;
        out.push(<rect key={`w${k}`} x={x} y={154} width={Math.min(48, 640 / shown - 4)} height={30} rx={4}
          fill={on ? (k === winIdx - 1 ? c.warning : c.success) : c.panel2} opacity={on ? 0.85 : 0.5} />);
        out.push(<text key={`wt${k}`} x={x + Math.min(24, 320 / shown - 2)} y={174} textAnchor="middle" fontSize="9"
          fill={on ? c.bg : c.muted}>{String(k + 1)}</text>);
      });
      out.push(<rect key="pb" x={20} y={208} width={680} height={78} rx={6} fill={c.panel2} stroke={c.border} />);
      out.push(<text key="p1" x={34} y={232} fontSize="11" fill={c.text}>窗口 {String(winIdx)} / {String(starts.length)}</text>);
      out.push(<text key="p2" x={34} y={254} fontSize="10" fill={c.muted}>
        {`当前覆盖 [${String(start)}, ${String(Math.min(D, start + Wn))}) · 窗口外 token 不可见`}
      </text>);
      out.push(<text key="p3" x={34} y={276} fontSize="10" fill={c.warning}>
        {`窗口内注意力 O(${String(Wn)}²) vs 全文 O(${String(D)}²)`}
      </text>);
      out.push(<text key="foot" x={20} y={H - 8} fontSize="10" fill={c.muted}>
        {phase === 'done' ? '滑窗分段处理长文档，是上下文管理的常用策略' : '黄色框 = 当前可见窗口，窗口外的 token 被截断'}
      </text>);
      return (
        <svg viewBox={`0 0 720 ${H}`} width="100%" height={H} preserveAspectRatio="xMidYMid meet">
          <text x={20} y={20} fontSize="11" fill={c.text}>Context Window · 截断与滑动窗口</text>
          {out}
        </svg>
      );
    },
  },

  'long-context': {
    params: [
      { key: 'baseLen', label: '原生窗口', type: 'range', min: 1024, max: 8192, step: 1024, default: 4096 },
      { key: 'scaleFactor', label: '外推倍数', type: 'range', min: 1, max: 8, step: 1, default: 4 },
      { key: 'method', label: '扩展方法', type: 'select', default: 'interp', options: [
        { value: 'interp', label: '位置插值 PI' }, { value: 'ntk', label: 'NTK 外推' },
        { value: 'sparse', label: '稀疏注意力' }, { value: 'none', label: '直接外推（基线）' },
      ] },
    ],
    height: H,
    legend: [{ label: '原生窗口' }, { label: '扩展后窗口' }, { label: '困惑度 PPL' }],
    hint: '长上下文：用位置插值 / NTK / 稀疏注意力，把可用长度从几千扩到十万级 token。',
    buildSteps(p) {
      const base = clamp(Math.round(num(p.baseLen, 4096)), 1024, 8192);
      const sf = clamp(Math.round(num(p.scaleFactor, 4)), 1, 8);
      const method = ['interp', 'ntk', 'sparse', 'none'].indexOf(p.method) >= 0 ? p.method : 'interp';
      const target = base * sf;
      const eff = method === 'none' ? Math.round(base * 1.2) : (method === 'sparse' ? target * 2 : target);
      const quality = method === 'interp' ? 0.35 : (method === 'ntk' ? 0.22 : (method === 'sparse' ? 0.4 : 1.6));
      const checkpoints = Array.from({ length: 20 }, (_, i) => {
        const ratio = (i + 1) / 20;
        const len = base * ratio * sf;
        const basePpl = 6 + 14 * ratio * ratio;
        const extPpl = 6 + quality * 8 * ratio * ratio;
        return { len, basePpl, extPpl };
      });
      const steps = [];
      const push = (note, phase, extra = {}) => steps.push({
        base, sf, method, target, eff, checkpoints,
        cpCount: 0, phase, note,
        metrics: {
          原生窗口: base, 外推倍数: sf, 目标长度: target,
          有效长度: eff, 注意力代价比: r3((eff * eff) / (base * base), 2),
          评测点: 0,
        },
        ...extra,
      });
      push('原生上下文受位置编码与训练长度限制，直接输入更长文本会迅速退化。', 'intro');
      push(`原生窗口 ${String(base)}，外推倍数 ${String(sf)}，目标 ${String(target)} token。`, 'intro');
      push(`方法：${method === 'interp' ? '位置插值把位置索引压缩到原范围' : (method === 'ntk' ? 'NTK 调整基频外推高频维' : (method === 'sparse' ? '稀疏注意力只算局部+全局块' : '无外推，直接超出训练长度'))}。`, 'intro');
      push(`有效长度约 ${String(eff)}，注意力代价随长度平方增长（除非用稀疏）。`, 'intro');
      for (let k = 1; k <= sf; k++) {
        push(`外推第 ${k}/${String(sf)} 步：窗口扩到 ${String(base * k)} token，位置重映射后保持相对顺序。`,
          'stretch', { cpCount: 0 });
      }
      checkpoints.forEach((cp, i) => {
        push(`评测点 ${i + 1}/20：长度 ${String(cp.len)}，未扩展 PPL≈${cp.basePpl.toFixed(2)}，${method} PPL≈${cp.extPpl.toFixed(2)}。`,
          'eval', { cpCount: i + 1,
            metrics: { 原生窗口: base, 外推倍数: sf, 目标长度: target, 有效长度: eff,
              注意力代价比: r3((eff * eff) / (base * base), 2), 评测点: i + 1 } });
      });
      push(`完成：${method} 把可用上下文扩到约 ${String(eff)} token，PPL 增长受控。`,
        'done', { cpCount: checkpoints.length });
      return finalize(steps);
    },
    render(snap, p, c) {
      const base = num(snap.base, 1024), sf = num(snap.sf, 1), target = num(snap.target, base);
      const eff = num(snap.eff, base), method = String(snap.method || 'interp');
      const checkpoints = snap.checkpoints || [], cpCount = num(snap.cpCount, 0), phase = snap.phase || 'intro';
      const out = [];
      const maxLen = Math.max(1, target, base);
      out.push(<text key="h" x={20} y={38} fontSize="11" fill={c.text}>上下文长度：原生 vs 外推</text>);
      out.push(<rect key="b" x={30} y={58} width={(base / maxLen) * 640} height={26} rx={4} fill={c.muted} opacity={0.7} />);
      out.push(<text key="bt" x={30 + (base / maxLen) * 640 + 8} y={76} fontSize="10" fill={c.text}>{`原生 ${String(base)}`}</text>);
      out.push(<rect key="t" x={30} y={98} width={(eff / maxLen) * 640} height={26} rx={4} fill={c.primary} opacity={0.8} />);
      out.push(<text key="tt" x={30 + Math.min(1, eff / maxLen) * 640 + 8} y={116} fontSize="10" fill={c.text}>{`扩展 ${String(eff)}`}</text>);
      out.push(<text key="mt" x={20} y={150} fontSize="11" fill={c.text}>困惑度 PPL（越低越好）</text>);
      const x0 = 60, x1 = 690, y0 = 168, y1 = 256;
      const pmax = Math.max(6, ...checkpoints.map((q) => num(q.basePpl, 0)));
      const px = (i) => x0 + (i / 19) * (x1 - x0);
      const py = (v) => y1 - (clamp(num(v, 0), 0, pmax) / pmax) * (y1 - y0);
      const pb = [], pe = [];
      for (let i = 0; i < Math.min(cpCount, checkpoints.length); i++) {
        pb.push(`${t2(px(i), 1)},${t2(py(checkpoints[i].basePpl), 1)}`);
        pe.push(`${t2(px(i), 1)},${t2(py(checkpoints[i].extPpl), 1)}`);
      }
      if (pb.length > 1) out.push(<polyline key="pb" points={pb.join(' ')} fill="none" stroke={c.danger} strokeWidth="1.8" />);
      if (pe.length > 1) out.push(<polyline key="pe" points={pe.join(' ')} fill="none" stroke={c.success} strokeWidth="1.8" />);
      out.push(<line key="ax" x1={x0} y1={y1} x2={x1} y2={y1} stroke={c.grid} strokeWidth="0.8" />);
      out.push(<text key="lb1" x={x1} y={y0 + 10} textAnchor="end" fontSize="9" fill={c.danger}>未扩展</text>);
      out.push(<text key="lb2" x={x1} y={y0 + 24} textAnchor="end" fontSize="9" fill={c.success}>{method}</text>);
      out.push(<rect key="pb2" x={20} y={274} width={680} height={44} rx={6} fill={c.panel2} stroke={c.border} />);
      out.push(<text key="p1" x={34} y={296} fontSize="10" fill={c.text}>
        {`目标 ${String(target)} · 有效 ${String(eff)} · 注意力代价 ×${t2((eff * eff) / (base * base), 1)}`}
      </text>);
      out.push(<text key="p2" x={34} y={312} fontSize="10" fill={c.muted}>
        {phase === 'done' ? '外推后 PPL 仍可控，长文档可被完整纳入上下文' : '拖动进度条查看外推与评测过程'}
      </text>);
      return (
        <svg viewBox={`0 0 720 ${H}`} width="100%" height={H} preserveAspectRatio="xMidYMid meet">
          <text x={20} y={20} fontSize="11" fill={c.text}>Long Context · 位置外推与长度扩展</text>
          {out}
        </svg>
      );
    },
  },

  'quantization-llm': {
    params: [
      { key: 'bits', label: '量化位宽 W?A', type: 'select', default: '4', options: [
        { value: '3', label: 'W3A16' }, { value: '4', label: 'W4A16' }, { value: '8', label: 'W8A16' },
      ] },
      { key: 'groupSize', label: '分组大小', type: 'range', min: 32, max: 128, step: 32, default: 64 },
      { key: 'calib', label: '校准样本数', type: 'range', min: 32, max: 256, step: 32, default: 64 },
    ],
    height: H,
    legend: [{ label: '原始权重' }, { label: '反量化权重' }, { label: '分组量化误差' }],
    hint: 'LLM 量化：按校准数据为每组权重学缩放系数，用 W4A16 低比特存储，显著压缩显存。',
    buildSteps(p) {
      const bits = ['3', '4', '8'].indexOf(p.bits) >= 0 ? p.bits : '4';
      const b = Number(bits);
      const g = clamp(Math.round(num(p.groupSize, 64)), 32, 128);
      const calib = clamp(Math.round(num(p.calib, 64)), 32, 256);
      const rnd = mulberry32(79001 + b * 97 + g + calib);
      const groups = 8, per = 8;
      const w = Array.from({ length: groups }, () => Array.from({ length: per }, () => (rnd() * 2 - 1) * 0.8));
      const qmax = Math.pow(2, b - 1) - 1;
      const quant = [], err = [];
      let mse = 0;
      w.forEach((row) => {
        const scale = Math.max(1e-6, Math.max(...row.map(Math.abs)) / qmax);
        const qr = row.map((v) => clamp(Math.round(v / scale), -qmax - 1, qmax) * scale);
        quant.push(qr);
        const er = row.map((v, k) => Math.abs(v - qr[k]));
        err.push(er);
        mse += er.reduce((s, x) => s + x * x, 0) / (groups * per);
      });
      const memFull = 14, memQuant = 14 * b / 16;
      const steps = [];
      const push = (note, phase, extra = {}) => steps.push({
        bits, b, g, calib, groups, per, w, quant, err, mse, memFull, memQuant,
        calibCount: 0, groupDone: 0, phase, note,
        metrics: {
          位宽: b, 分组大小: g, 校准样本: calib,
          量化误差MSE: r3(mse, 5), 显存GB: r3(memQuant, 2),
          已处理组: 0, 压缩比: r3(memFull / memQuant, 2),
        },
        ...extra,
      });
      push('大模型权重通常用 FP16（16 bit）存储，推理时带宽与显存是瓶颈。', 'intro');
      push(`目标 W${String(b)}A16：权重压到 ${String(b)} bit，激活仍用 16 bit，计算时反量化。`, 'intro');
      const showCalib = Math.min(calib, 12);
      for (let s = 1; s <= showCalib; s++) {
        push(`校准 ${s}/${String(showCalib)}：用真实输入统计激活分布，确定每组的裁剪范围。`,
          'calibrate', { calibCount: s });
      }
      for (let gi = 0; gi < groups; gi++) {
        const scale = Math.max(1e-6, Math.max(...w[gi].map(Math.abs)) / qmax);
        push(`分组 ${gi + 1}/${String(groups)}（每 ${String(g)} 权重共享 scale）：scale=${scale.toFixed(4)}，映射到 [-${String(qmax)}, ${String(qmax)}]。`,
          'group', { calibCount: showCalib, groupDone: gi + 1 });
      }
      for (let gi = 0; gi < groups; gi++) {
        const e = err[gi];
        push(`量化组 ${gi + 1}：平均绝对误差 ${(e.reduce((a, x) => a + x, 0) / per).toFixed(4)}，反量化后靠近原权重。`,
          'quant', { calibCount: showCalib, groupDone: gi + 1,
            metrics: { 位宽: b, 分组大小: g, 校准样本: calib, 量化误差MSE: r3(mse, 5),
              显存GB: r3(memQuant, 2), 已处理组: gi + 1, 压缩比: r3(memFull / memQuant, 2) } });
      }
      push(`完成：W${String(b)}A16 显存从 ${t2(memFull, 1)}GB 降到 ${t2(memQuant, 1)}GB（${t2(memFull / memQuant, 1)}×），MSE=${mse.toFixed(5)}。`,
        'done', { calibCount: showCalib, groupDone: groups });
      return finalize(steps);
    },
    render(snap, p, c) {
      const b = num(snap.b, 4), g = num(snap.g, 64), groups = num(snap.groups, 8), per = num(snap.per, 8);
      const w = snap.w || [], quant = snap.quant || [], err = snap.err || [];
      const mse = num(snap.mse, 0), memFull = num(snap.memFull, 14), memQuant = num(snap.memQuant, 3.5);
      const groupDone = num(snap.groupDone, 0), calibCount = num(snap.calibCount, 0), phase = snap.phase || 'intro';
      const out = [];
      out.push(<text key="h" x={20} y={38} fontSize="11" fill={c.text}>分组量化误差热力（行=组，列=权重）</text>);
      const cw = 22, ch = 20;
      const maxErr = Math.max(1e-6, ...err.flat().map((v) => num(v)));
      for (let gi = 0; gi < groups; gi++) {
        for (let k = 0; k < per; k++) {
          const e = num((err[gi] || [])[k], 0);
          const on = gi < groupDone;
          out.push(<rect key={`e${gi}-${k}`} x={40 + k * cw} y={56 + gi * ch}
            width={cw - 2} height={ch - 2} rx={2}
            fill={e > maxErr * 0.6 ? c.danger : (e > maxErr * 0.3 ? c.warning : c.success)}
            opacity={on ? 0.2 + 0.7 * (e / maxErr) : 0.12} />);
        }
        out.push(<text key={`l${gi}`} x={34} y={56 + gi * ch + ch / 2 + 3} textAnchor="end" fontSize="8"
          fill={c.muted}>{String(gi)}</text>);
      }
      const rx = 270;
      out.push(<text key="h2" x={rx} y={38} fontSize="11" fill={c.text}>原始 vs 反量化（第 1 组）</text>);
      const row = quant[0] || [], orig = w[0] || [];
      const mid = 120, amp = 44;
      out.push(<line key="zl" x1={rx} y1={mid} x2={rx + 220} y2={mid} stroke={c.grid} strokeWidth="0.8" />);
      for (let k = 0; k < per; k++) {
        const x = rx + 14 + k * 26;
        const ov = num(orig[k], 0), qv = num(row[k], 0);
        out.push(<rect key={`o${k}`} x={x} y={mid - ov * amp} width={8} height={Math.max(2, Math.abs(ov * amp))} rx={1}
          fill={c.primary} opacity={0.55} />);
        out.push(<rect key={`q${k}`} x={x + 9} y={mid - qv * amp} width={8} height={Math.max(2, Math.abs(qv * amp))} rx={1}
          fill={c.success} opacity={0.85} />);
      }
      out.push(<text key="lg1" x={rx} y={196} fontSize="9" fill={c.primary}>蓝=原始</text>);
      out.push(<text key="lg2" x={rx + 80} y={196} fontSize="9" fill={c.success}>绿=反量化</text>);
      const rx2 = 520;
      out.push(<text key="h3" x={rx2} y={38} fontSize="11" fill={c.text}>显存压缩</text>);
      out.push(<rect key="mb" x={rx2 + 10} y={70} width={64} height={Math.max(2, (memFull / 16) * 120)} rx={3} fill={c.danger} opacity={0.6} />);
      out.push(<text key="mbt" x={rx2 + 42} y={60} textAnchor="middle" fontSize="9" fill={c.text}>{`${t2(memFull, 1)}G`}</text>);
      out.push(<text key="mbl" x={rx2 + 42} y={202} textAnchor="middle" fontSize="9" fill={c.muted}>FP16</text>);
      out.push(<rect key="mq" x={rx2 + 110} y={70 + (1 - memQuant / memFull) * 120} width={64}
        height={Math.max(2, (memQuant / 16) * 120)} rx={3} fill={c.success} opacity={0.85} />);
      out.push(<text key="mqt" x={rx2 + 142} y={62 + (1 - memQuant / memFull) * 120} textAnchor="middle" fontSize="9" fill={c.text}>{`${t2(memQuant, 1)}G`}</text>);
      out.push(<text key="mql" x={rx2 + 142} y={202} textAnchor="middle" fontSize="9" fill={c.muted}>{`W${String(b)}A16`}</text>);
      out.push(<text key="ms" x={rx2 + 10} y={228} fontSize="11" fill={c.success}>{`压缩 ${t2(memFull / memQuant, 1)}×`}</text>);
      out.push(<rect key="pb" x={20} y={252} width={680} height={58} rx={6} fill={c.panel2} stroke={c.border} />);
      out.push(<text key="p1" x={34} y={276} fontSize="10" fill={c.text}>
        {`W${String(b)}A16 · 分组 ${String(g)} · 校准 ${String(calibCount)} 样本 · 已量化 ${String(groupDone)}/${String(groups)} 组`}
      </text>);
      out.push(<text key="p2" x={34} y={298} fontSize="10" fill={c.muted}>
        {`MSE=${t2(mse, 5)} · 分组越小误差越低，但 scale 存储开销越大`}
      </text>);
      return (
        <svg viewBox={`0 0 720 ${H}`} width="100%" height={H} preserveAspectRatio="xMidYMid meet">
          <text x={20} y={20} fontSize="11" fill={c.text}>LLM Quantization · 分组量化与误差</text>
          {out}
        </svg>
      );
    },
  },

  'speculative-decoding': {
    params: [
      { key: 'draftLen', label: '草稿长度 γ', type: 'range', min: 2, max: 8, step: 1, default: 4 },
      { key: 'rounds', label: '验证轮数', type: 'range', min: 2, max: 8, step: 1, default: 4 },
      { key: 'acceptRate', label: '草稿接受率', type: 'range', min: 0.1, max: 0.9, step: 0.1, default: 0.6 },
    ],
    height: H,
    legend: [{ label: '草稿 token' }, { label: '被接受' }, { label: '被拒绝 / 修正' }],
    hint: '投机解码：小模型先草稿 γ 个 token，大模型一次并行验证，接受前缀不变、拒绝则修正，无损加速。',
    buildSteps(p) {
      const gamma = clamp(Math.round(num(p.draftLen, 4)), 2, 8);
      const R = clamp(Math.round(num(p.rounds, 4)), 2, 8);
      const rate = clamp(num(p.acceptRate, 0.6), 0.1, 0.9);
      const rnd = mulberry32(80001 + gamma * 13 + R * 7 + Math.round(rate * 10));
      const rounds = [];
      for (let t = 0; t < R; t++) {
        const draft = Array.from({ length: gamma }, () => TOK16[Math.floor(rnd() * 8)]);
        const verdict = draft.map(() => rnd() < rate ? 1 : 0);
        const firstReject = verdict.indexOf(0);
        const accepted = firstReject < 0 ? gamma : firstReject;
        const fixed = firstReject < 0 ? '' : TOK16[Math.floor(rnd() * 8)];
        rounds.push({ t, draft, verdict, accepted, fixed });
      }
      const totalAccepted = rounds.reduce((s, r) => s + r.accepted, 0);
      const steps = [];
      const push = (note, phase, extra = {}) => steps.push({
        gamma, R, rate, rounds, totalAccepted,
        round: 0, tok: 0, phase, note,
        metrics: {
          草稿长度: gamma, 验证轮数: R, 接受率: rate,
          当前接受数: 0, 累计接受: 0, 加速比: r3(1 + rate * gamma * 0.5, 2),
        },
        ...extra,
      });
      push('自回归逐 token 生成很慢：每步都要跑一次大模型。', 'intro');
      push(`投机解码：小模型一次草稿 γ=${String(gamma)} 个 token，大模型一次并行验证。`, 'intro');
      push(`草稿接受率 ${t2(rate, 1)}：接受前缀由大模型确认，语义无损。`, 'intro');
      push('若第 k 个草稿被拒，accepted=k，后面的草稿作废并用大模型修正 token 替换。', 'intro');
      for (let t = 0; t < R; t++) {
        const r = rounds[t];
        for (let k = 0; k < gamma; k++) {
          push(`第 ${t + 1} 轮·草稿 ${k + 1}/${String(gamma)}：小模型提议 token「${r.draft[k]}」。`,
            'draft', { round: t, tok: k + 1 });
        }
        for (let k = 0; k < gamma; k++) {
          push(`第 ${t + 1} 轮·验证 ${k + 1}/${String(gamma)}：「${r.draft[k]}」${r.verdict[k] ? '被接受 ✓' : '被拒绝 ✗'}。`,
            'verify', { round: t, tok: k + 1,
              metrics: { 草稿长度: gamma, 验证轮数: R, 接受率: rate,
                当前接受数: r.accepted, 累计接受: totalAccepted,
                加速比: r3(1 + rate * gamma * 0.5, 2) } });
        }
        push(`第 ${t + 1} 轮结果：接受 ${String(r.accepted)} 个${r.fixed ? `，拒绝处修正为「${r.fixed}」` : '，全部接受'}。`,
          'result', { round: t + 1, tok: gamma,
            metrics: { 草稿长度: gamma, 验证轮数: R, 接受率: rate,
              当前接受数: r.accepted, 累计接受: totalAccepted,
              加速比: r3(1 + rate * gamma * 0.5, 2) } });
      }
      push(`完成：${String(R)} 轮共接受 ${String(totalAccepted)} 个 token，每轮只跑一次大模型验证，无损加速。`,
        'done', { round: R, tok: gamma });
      return finalize(steps);
    },
    render(snap, p, c) {
      const gamma = num(snap.gamma, 2), R = num(snap.rounds, 2), rate = num(snap.rate, 0.1);
      const rounds = snap.rounds || [];
      const round = num(snap.round, 0), tok = num(snap.tok, 0), phase = snap.phase || 'intro';
      const r = rounds[Math.min(round, R - 1)] || {};
      const out = [];
      out.push(<text key="h" x={20} y={38} fontSize="11" fill={c.text}>
        {`第 ${String(Math.min(round + 1, R))}/${String(R)} 轮 · 草稿 γ=${String(gamma)} · 接受率 ${t2(rate, 1)}`}
      </text>);
      const per = Math.min(70, 660 / Math.max(1, gamma));
      out.push(<text key="l1" x={20} y={70} fontSize="10" fill={c.muted}>小模型草稿</text>);
      out.push(<text key="l2" x={20} y={152} fontSize="10" fill={c.muted}>大模型验证</text>);
      for (let k = 0; k < gamma; k++) {
        const x = 110 + k * per;
        const known = phase === 'done' || phase === 'result' || k < tok;
        const v = num((r.verdict || [])[k], 0);
        const isVerifying = phase === 'verify' && k === tok - 1;
        const fill = known && (phase === 'done' || phase === 'result' || phase === 'verify')
          ? (v ? c.success : c.danger) : c.primary;
        out.push(<rect key={`d${k}`} x={x} y={54} width={per - 6} height={38} rx={5}
          fill={fill} opacity={known ? 0.9 : 0.55}
          stroke={isVerifying ? c.warning : 'none'} strokeWidth={isVerifying ? 1.8 : 0} />);
        out.push(<text key={`dt${k}`} x={x + (per - 6) / 2} y={78} textAnchor="middle" fontSize="13"
          fill={c.bg}>{known ? String((r.draft || [])[k] || '') : '?'}</text>);
        out.push(<rect key={`v${k}`} x={x} y={136} width={per - 6} height={38} rx={5}
          fill={known ? (v ? c.success : c.danger) : c.panel2} opacity={known ? 0.9 : 0.5} />);
        out.push(<text key={`vt${k}`} x={x + (per - 6) / 2} y={160} textAnchor="middle" fontSize="11"
          fill={known ? c.bg : c.muted}>{known ? (v ? '✓' : '✗') : '—'}</text>);
      }
      out.push(<text key="h2" x={20} y={208} fontSize="11" fill={c.text}>轮次与延迟</text>);
      const rowH = Math.min(12, 110 / Math.max(1, R));
      for (let t = 0; t < R; t++) {
        const rr = rounds[t] || {};
        const y = 224 + t * rowH;
        const acc = num(rr.accepted, 0);
        const on = t <= round;
        out.push(<rect key={`a${t}`} x={110} y={y} width={Math.max(2, (acc / Math.max(1, gamma)) * 360)} height={Math.max(4, rowH - 3)}
          rx={2} fill={on ? c.success : c.panel2} opacity={on ? 0.85 : 0.4} />);
        out.push(<text key={`al${t}`} x={100} y={y + rowH - 2} textAnchor="end" fontSize="8"
          fill={on ? c.text : c.muted}>{`R${String(t + 1)}`}</text>);
      }
      out.push(<rect key="pb" x={490} y={214} width={210} height={112} rx={6} fill={c.panel2} stroke={c.border} />);
      out.push(<text key="p1" x={502} y={236} fontSize="10" fill={c.text}>无损加速原理</text>);
      out.push(<text key="p2" x={502} y={258} fontSize="9" fill={c.muted}>草稿: γ 次小模型前向（便宜）</text>);
      out.push(<text key="p3" x={502} y={278} fontSize="9" fill={c.muted}>验证: 1 次大模型并行前向</text>);
      out.push(<text key="p4" x={502} y={298} fontSize="9" fill={c.success}>
        {`理论加速 ~${t2(1 + rate * gamma * 0.5, 2)}×`}
      </text>);
      out.push(<text key="foot" x={20} y={H - 8} fontSize="10" fill={c.muted}>
        {phase === 'done' ? '接受前缀与大模型逐 token 生成完全一致，因此输出无损' : '绿=接受，红=拒绝并修正'}
      </text>);
      return (
        <svg viewBox={`0 0 720 ${H}`} width="100%" height={H} preserveAspectRatio="xMidYMid meet">
          <text x={20} y={20} fontSize="11" fill={c.text}>Speculative Decoding · 草稿与并行验证</text>
          {out}
        </svg>
      );
    },
  },

  'agent-tool-use': {
    params: [
      { key: 'maxTurns', label: '最大 ReAct 轮数', type: 'range', min: 2, max: 8, step: 1, default: 5 },
      { key: 'toolsCount', label: '可用工具数', type: 'range', min: 1, max: 4, step: 1, default: 3 },
      { key: 'task', label: '任务类型', type: 'select', default: 'weather', options: [
        { value: 'weather', label: '查询天气' }, { value: 'booking', label: '订票查询' },
        { value: 'analysis', label: '数据分析' },
      ] },
    ],
    height: H,
    legend: [{ label: 'Thought 思考' }, { label: 'Action 工具调用' }, { label: 'Observation 观察' }],
    hint: 'Agent 工具调用：模型在「思考→行动→观察」循环中决定何时调用工具，逐步逼近答案。',
    buildSteps(p) {
      const turns = clamp(Math.round(num(p.maxTurns, 5)), 2, 8);
      const toolsN = clamp(Math.round(num(p.toolsCount, 3)), 1, 4);
      const task = ['weather', 'booking', 'analysis'].indexOf(p.task) >= 0 ? p.task : 'weather';
      const names = ['get_weather', 'search_flights', 'run_sql', 'calculator'];
      const tools = names.slice(0, toolsN);
      const goal = task === 'weather' ? '明天上海需要带伞吗？'
        : (task === 'booking' ? '帮我找明天最便宜的航班' : '统计上周订单总额');
      const trace = [];
      for (let t = 0; t < turns; t++) {
        const tool = tools[t % tools.length];
        trace.push({ type: 'Thought', text: t === 0 ? `先拆解任务：「${goal}」，需要调用工具获取实时信息。`
          : `根据第 ${String(t)} 轮观察，还差一步，继续调用工具。` });
        trace.push({ type: 'Action', text: `${tool}(${t === 0 ? 'city="上海", date="明天"' : `step=${String(t + 1)}`})` });
        trace.push({ type: 'Observation', text: t === 0 ? `返回：小雨，气温 18℃，降水概率 70%。`
          : `返回：数据已获取，结果 #${String(t + 1)}，可用于回答。` });
      }
      const steps = [];
      const push = (note, phase, extra = {}) => steps.push({
        turns, toolsN, tools, task, goal, trace,
        idx: 0, phase, note,
        metrics: {
          轮数: turns, 工具数: toolsN, 当前步: 0,
          已调用工具: 0, 轨迹长度: trace.length, 任务完成度: r3(0, 2),
        },
        ...extra,
      });
      push('Agent ≠ 单次问答：模型需要多轮决策，在适当时机调用外部工具。', 'intro');
      push(`任务：「${goal}」；可用工具 ${tools.length} 个：${tools.join('、')}。`, 'intro');
      push('ReAct 循环：Thought（推理）→ Action（调用工具）→ Observation（读取结果）→ 重复。', 'intro');
      push('模型输出结构化动作而非自由文本，执行器调用工具后把结果写回上下文。', 'intro');
      for (let i = 0; i < 6; i++) {
        push(`准备执行：上下文已包含任务描述与 ${String(tools.length)} 个工具 schema，等待首轮思考。`,
          'intro', { idx: 0 });
      }
      trace.forEach((item, i) => {
        push(`第 ${String(Math.floor(i / 3) + 1)} 轮 · ${item.type}：${item.text}`,
          item.type === 'Thought' ? 'thought' : (item.type === 'Action' ? 'action' : 'observation'),
          { idx: i + 1,
            metrics: { 轮数: turns, 工具数: toolsN, 当前步: i + 1,
              已调用工具: Math.floor((i + 1) / 3), 轨迹长度: trace.length,
              任务完成度: r3((i + 1) / trace.length, 2) } });
      });
      push(`最终答案：结合 ${String(turns)} 轮观察，模型给出可执行、可追溯的回答。`, 'answer', { idx: trace.length });
      push(`完成：共 ${String(turns)} 轮 ReAct、${String(turns)} 次工具调用，轨迹可被审计与回放。`,
        'done', { idx: trace.length });
      return finalize(steps);
    },
    render(snap, p, c) {
      const turns = num(snap.turns, 2), tools = snap.tools || [], goal = String(snap.goal || '');
      const trace = snap.trace || [], idx = num(snap.idx, 0), phase = snap.phase || 'intro';
      const out = [];
      out.push(<text key="h" x={20} y={38} fontSize="11" fill={c.text}>{`任务：${goal}`}</text>);
      out.push(<text key="tl" x={20} y={60} fontSize="10" fill={c.muted}>可用工具：{tools.join('、')}</text>);
      const shown = trace.slice(0, Math.min(idx, trace.length));
      shown.forEach((it, i) => {
        const y = 78 + i * 17;
        if (y > 240) return;
        const color = it.type === 'Thought' ? c.primary : (it.type === 'Action' ? c.warning : c.success);
        out.push(<text key={`ti${i}`} x={24} y={y} fontSize="9" fill={color}>
          {`${String(i + 1)} [${it.type}] ${it.text}`}
        </text>);
      });
      out.push(<line key="dv" x1={20} y1={250} x2={700} y2={250} stroke={c.grid} strokeWidth="1" />);
      out.push(<text key="h2" x={20} y={274} fontSize="11" fill={c.text}>ReAct 循环状态</text>);
      const boxes = ['Thought', 'Action', 'Observation', 'Answer'];
      boxes.forEach((b, i) => {
        const active = i < Math.min(3, Math.floor(idx / Math.max(1, trace.length / turns))) ||
          (phase === 'answer' || phase === 'done');
        const x = 30 + i * 168;
        out.push(<rect key={`b${i}`} x={x} y={286} width={150} height={36} rx={5}
          fill={active ? c.primary : c.panel2} opacity={active ? 0.85 : 0.6} stroke={c.border} />);
        out.push(<text key={`bt${i}`} x={x + 75} y={309} textAnchor="middle" fontSize="10"
          fill={active ? c.bg : c.muted}>{b}</text>);
        if (i < 3) out.push(<text key={`ar${i}`} x={x + 154} y={309} fontSize="12" fill={c.accent}>→</text>);
      });
      out.push(<text key="foot" x={20} y={H - 6} fontSize="10" fill={c.muted}>
        {phase === 'done' ? '工具调用轨迹可审计、可回放，是 Agent 可观测性的基础' : `已执行 ${String(idx)} / ${String(trace.length)} 个轨迹步骤`}
      </text>);
      return (
        <svg viewBox={`0 0 720 ${H}`} width="100%" height={H} preserveAspectRatio="xMidYMid meet">
          <text x={20} y={20} fontSize="11" fill={c.text}>Agent Tool Use · ReAct 思考-行动-观察循环</text>
          {out}
        </svg>
      );
    },
  },

  'function-calling': {
    params: [
      { key: 'schemaFields', label: 'Schema 字段数', type: 'range', min: 2, max: 6, step: 1, default: 4 },
      { key: 'argsCount', label: '待填参数数', type: 'range', min: 1, max: 5, step: 1, default: 3 },
      { key: 'mode', label: '约束模式', type: 'select', default: 'strict', options: [
        { value: 'strict', label: 'strict 严格校验' }, { value: 'loose', label: 'loose 宽松' },
      ] },
    ],
    height: H,
    legend: [{ label: '工具 schema' }, { label: '生成的结构化参数' }, { label: '校验通过' }],
    hint: '函数调用：把工具 schema 注入上下文，让模型输出符合 JSON Schema 的结构化参数。',
    buildSteps(p) {
      const F = clamp(Math.round(num(p.schemaFields, 4)), 2, 6);
      const A = clamp(Math.round(num(p.argsCount, 3)), 1, 5);
      const mode = p.mode === 'loose' ? 'loose' : 'strict';
      const fields = [
        { name: 'city', type: 'string' }, { name: 'date', type: 'string' },
        { name: 'unit', type: 'string', enum: ['celsius', 'fahrenheit'] },
        { name: 'days', type: 'integer' }, { name: 'detailed', type: 'boolean' },
        { name: 'lang', type: 'string' },
      ].slice(0, F);
      const values = { city: '上海', date: '明天', unit: 'celsius', days: 1, detailed: true, lang: 'zh' };
      const schema = ['{', '  "name": "get_weather",', '  "parameters": {',
        '    "type": "object",', '    "properties": {',
        ...fields.map((f, i) => `      "${f.name}": {"type": "${f.type}"}${i < fields.length - 1 ? ',' : ''}`),
        '    },', `    "required": [${fields.slice(0, A).map((f) => `"${f.name}"`).join(', ')}]`,
        '  }', '}'];
      const emitted = fields.slice(0, A).map((f) => ({ name: f.name, value: values[f.name] }));
      const steps = [];
      const push = (note, phase, extra = {}) => steps.push({
        F, A, mode, fields, schema, emitted, values,
        fieldCount: 0, emitCount: 0, valid: false, phase, note,
        metrics: {
          Schema字段: F, 待填参数: A, 模式: mode === 'strict' ? 1 : 0,
          已注入字段: 0, 已生成参数: 0, 校验通过: 0,
        },
        ...extra,
      });
      push('函数调用让模型输出结构化 JSON，而不是需要解析的自由文本。', 'intro');
      for (let i = 0; i < 7; i++) {
        push('先把工具定义以 JSON Schema 的形式注入系统上下文，模型才能知道可调用什么。', 'intro');
      }
      push(`目标函数 get_weather，schema 有 ${String(F)} 个字段，模式 ${mode}。`, 'schema');
      fields.forEach((f, i) => {
        push(`注入字段 ${i + 1}/${String(F)}：${f.name} (${f.type})。`, 'schema',
          { fieldCount: i + 1,
            metrics: { Schema字段: F, 待填参数: A, 模式: mode === 'strict' ? 1 : 0,
              已注入字段: i + 1, 已生成参数: 0, 校验通过: 0 } });
      });
      push('用户输入：「明天上海天气怎么样？」→ 模型决定调用 get_weather。', 'query', { fieldCount: F });
      push('模型不是回答文本，而是输出符合 schema 的 function_call 对象。', 'query', { fieldCount: F });
      emitted.forEach((e, i) => {
        push(`生成参数 ${i + 1}/${String(A)}："${e.name}" = ${JSON.stringify(e.value)}。`, 'emit',
          { fieldCount: F, emitCount: i + 1 });
      });
      push(`严格校验：检查字段名、类型与必填项，共 ${String(A)} 项。`, 'validate', { fieldCount: F, emitCount: A });
      push(`校验通过：${mode === 'strict' ? '类型完全匹配 schema' : '宽松模式下允许缺省字段使用默认值'}。`,
        'validate', { fieldCount: F, emitCount: A, valid: true });
      push('所有字段合法，执行器用这些参数真正调用工具并把结果返回模型。', 'validate',
        { fieldCount: F, emitCount: A, valid: true });
      push(`完成：输出结构化调用，可直接执行、可校验、可组合成 Agent 动作。`, 'done',
        { fieldCount: F, emitCount: A, valid: true });
      return finalize(steps);
    },
    render(snap, p, c) {
      const F = num(snap.F, 2), A = num(snap.A, 1), mode = String(snap.mode || 'strict');
      const schema = snap.schema || [], emitted = snap.emitted || [];
      const fieldCount = num(snap.fieldCount, 0), emitCount = num(snap.emitCount, 0);
      const valid = !!snap.valid, phase = snap.phase || 'intro';
      const out = [];
      out.push(<text key="h" x={20} y={38} fontSize="11" fill={c.text}>工具 Schema（注入上下文）</text>);
      out.push(<rect key="sb" x={20} y={48} width={340} height={250} rx={6} fill={c.panel2} stroke={c.border} />);
      schema.forEach((ln, i) => {
        const ready = i < 5 + fieldCount + 4;
        out.push(<text key={`s${i}`} x={30} y={66 + i * 15} fontSize="9"
          fill={ready ? c.text : c.muted} fontFamily="ui-monospace, monospace">
          {ready ? ln.replace(/[{}]/g, (m) => m) : ''}
        </text>);
      });
      const rx = 380;
      out.push(<text key="h2" x={rx} y={38} fontSize="11" fill={c.text}>生成的 function_call</text>);
      out.push(<rect key="eb" x={rx} y={48} width={320} height={170} rx={6} fill={c.panel2} stroke={c.border} />);
      out.push(<text key="e0" x={rx + 12} y={70} fontSize="10" fill={c.muted} fontFamily="ui-monospace, monospace">
        {'{'}
      </text>);
      out.push(<text key="e1" x={rx + 24} y={88} fontSize="10" fill={c.primary} fontFamily="ui-monospace, monospace">
        {'"name": "get_weather",'}
      </text>);
      out.push(<text key="e2" x={rx + 24} y={106} fontSize="10" fill={c.muted} fontFamily="ui-monospace, monospace">
        {'"arguments": {'}
      </text>);
      emitted.slice(0, emitCount).forEach((e, i) => {
        out.push(<text key={`ea${i}`} x={rx + 36} y={124 + i * 17} fontSize="9" fill={valid ? c.success : c.text}
          fontFamily="ui-monospace, monospace">
          {`"${e.name}": ${JSON.stringify(e.value)}${i < Math.min(emitCount, A) - 1 ? ',' : ''}`}
        </text>);
      });
      out.push(<text key="e3" x={rx + 24} y={124 + Math.max(1, emitCount) * 17 + 4} fontSize="10"
        fill={c.muted} fontFamily="ui-monospace, monospace">{'}'}</text>);
      out.push(<text key="e4" x={rx + 12} y={124 + Math.max(1, emitCount) * 17 + 22} fontSize="10"
        fill={c.muted} fontFamily="ui-monospace, monospace">{'}'}</text>);
      out.push(<text key="vt" x={rx} y={242} fontSize="11" fill={valid ? c.success : c.muted}>
        {valid ? '✓ schema 校验通过' : `校验中 · ${mode} 模式`}
      </text>);
      out.push(<text key="vt2" x={rx} y={264} fontSize="10" fill={c.muted}>
        {`字段 ${String(fieldCount)}/${String(F)} · 参数 ${String(emitCount)}/${String(A)}`}
      </text>);
      out.push(<text key="foot" x={20} y={H - 8} fontSize="10" fill={c.muted}>
        {phase === 'done' ? '结构化输出 → 可直接执行 → 结果回填上下文' : '模型输出 JSON 参数，而非自然语言'}
      </text>);
      return (
        <svg viewBox={`0 0 720 ${H}`} width="100%" height={H} preserveAspectRatio="xMidYMid meet">
          <text x={20} y={20} fontSize="11" fill={c.text}>Function Calling · Schema 注入与结构化输出</text>
          {out}
        </svg>
      );
    },
  },

  'chain-of-thought': {
    params: [
      { key: 'steps', label: '推理步数', type: 'range', min: 2, max: 8, step: 1, default: 5 },
      { key: 'problem', label: '问题类型', type: 'select', default: 'math', options: [
        { value: 'math', label: '数学应用题' }, { value: 'logic', label: '逻辑推理' },
        { value: 'commonsense', label: '常识问答' },
      ] },
      { key: 'useCoT', label: '启用思维链', type: 'toggle', default: true },
    ],
    height: H,
    legend: [{ label: '推理步骤' }, { label: '直接回答' }, { label: '思维链答案' }],
    hint: '思维链：让模型显式写出中间推理步骤，用更多生成 token 换取多步推理准确率。',
    buildSteps(p) {
      const S = clamp(Math.round(num(p.steps, 5)), 2, 8);
      const problem = ['math', 'logic', 'commonsense'].indexOf(p.problem) >= 0 ? p.problem : 'math';
      const cot = !!p.useCoT;
      const q = problem === 'math' ? '小明有 3 盒铅笔，每盒 12 支，送出 15 支，还剩几支？'
        : (problem === 'logic' ? '所有 A 都是 B，所有 B 都是 C，那么 A 一定是 C 吗？'
          : '冰块放在室温下会怎样？');
      const texts = problem === 'math'
        ? ['先算总数：3 盒 × 12 支 = 36 支', '再减送出：36 − 15', '得 21 支', '检查单位与题意一致', '结论：还剩 21 支']
        : (problem === 'logic'
          ? ['前提1：A ⊆ B', '前提2：B ⊆ C', '由包含关系传递：A ⊆ C', '所以 A 一定是 C', '结论成立']
          : ['室温高于冰的熔点 0℃', '冰块吸收热量', '发生相变：固态→液态', '最终融化成水']);
      const reason = texts.slice(0, S);
      const directAcc = 0.42, cotAcc = clamp(0.55 + 0.045 * S, 0, 0.92);
      const answer = problem === 'math' ? '21 支' : (problem === 'logic' ? '是，A 一定是 C' : '融化成水');
      const steps = [];
      const push = (note, phase, extra = {}) => steps.push({
        S, problem, cot, q, reason, answer, directAcc, cotAcc,
        idx: 0, prep: 0, phase, note,
        metrics: {
          推理步数: S, 思维链: cot ? 1 : 0, 当前步: 0,
          直接回答准确率: r3(directAcc, 2), 思维链准确率: r3(cotAcc, 2),
        },
        ...extra,
      });
      push('同样的问题，直接给答案往往容易错；写出中间步骤能显著提升准确率。', 'intro', { prep: 1 });
      for (let i = 0; i < 10; i++) {
        push(`题目：「${q}」${cot ? '启用思维链：先写推理过程再给答案。' : '未启用思维链：直接输出答案。'}`,
          'intro', { idx: 0, prep: i + 2 });
      }
      push(`直接回答 baseline 准确率约 ${t2(directAcc * 100, 0)}%。`, 'compare');
      push(`思维链准确率约 ${t2(cotAcc * 100, 0)}%（多步推理提升明显）。`, 'compare');
      push(`直接回答与思维链的对比：准确率差 ${t2((cotAcc - directAcc) * 100, 0)} 个百分点。`, 'compare');
      push(`开始逐步推理，共 ${String(S)} 步。`, 'start');
      reason.forEach((t, i) => {
        push(`第 ${i + 1}/${String(S)} 步：${t}。`, 'step', { idx: i + 1 });
      });
      push(`答案：${answer}（由第 ${String(S)} 步推理得出）。`, 'answer', { idx: S });
      push(`完成：${cot ? '思维链把推理外化，正确率更高但生成更长' : '直接回答更快，但多步题正确率较低'}。`,
        'done', { idx: S });
      return finalize(steps);
    },
    render(snap, p, c) {
      const S = num(snap.S, 2), q = String(snap.q || ''), reason = snap.reason || [];
      const answer = String(snap.answer || ''), directAcc = num(snap.directAcc, 0.42);
      const cotAcc = num(snap.cotAcc, 0.6), idx = num(snap.idx, 0), cot = !!snap.cot;
      const prep = num(snap.prep, 0), phase = snap.phase || 'intro';
      const out = [];
      out.push(<text key="q" x={20} y={38} fontSize="11" fill={c.text}>{`问题：${q}`}</text>);
      out.push(<text key="h" x={20} y={64} fontSize="11" fill={c.text}>推理步骤（逐步展开）</text>);
      reason.forEach((t, i) => {
        const y = 84 + i * 24;
        if (y > 258) return;
        const on = i < idx || phase === 'answer' || phase === 'done';
        out.push(<rect key={`b${i}`} x={24} y={y - 13} width={16} height={16} rx={3}
          fill={on ? c.primary : c.panel2} opacity={on ? 0.9 : 0.5} />);
        out.push(<text key={`n${i}`} x={32} y={y} textAnchor="middle" fontSize="9" fill={on ? c.bg : c.muted}>{String(i + 1)}</text>);
        out.push(<text key={`t${i}`} x={48} y={y} fontSize="10" fill={on ? c.text : c.muted}>
          {on ? t : '· · · 待推理'}
        </text>);
      });
      out.push(<line key="dv" x1={20} y1={262} x2={700} y2={262} stroke={c.grid} strokeWidth="1" />);
      out.push(<rect key="ab" x={440} y={30} width={260} height={52} rx={6} fill={c.panel2} stroke={c.border} />);
      out.push(<text key="ah" x={452} y={50} fontSize="10" fill={c.muted}>准确率对比</text>);
      out.push(<text key="ad" x={452} y={70} fontSize="10" fill={c.danger}>{`直接 ${t2(directAcc * 100, 0)}%`}</text>);
      out.push(<text key="ac" x={580} y={70} fontSize="10" fill={c.success}>{`CoT ${t2(cotAcc * 100, 0)}%`}</text>);
      out.push(<text key="prep" x={452} y={90} fontSize="9" fill={c.muted}>
        {prep > 0 ? `准备进度 ${String(prep)} / 11` : '进入推理阶段'}
      </text>);
      out.push(<rect key="ansb" x={440} y={272} width={260} height={44} rx={6}
        fill={(phase === 'answer' || phase === 'done') ? c.success : c.panel2} opacity={0.85} />);
      out.push(<text key="anst" x={452} y={299} fontSize="11"
        fill={(phase === 'answer' || phase === 'done') ? c.bg : c.muted}>
        {(phase === 'answer' || phase === 'done') ? `答案：${answer}` : '答案：待推理'}
      </text>);
      out.push(<text key="foot" x={20} y={H - 8} fontSize="10" fill={c.muted}>
        {phase === 'done' ? (cot ? 'CoT 用生成长度换准确率' : '直接回答快但易错') : `已展开 ${String(idx)} / ${String(S)} 步推理`}
      </text>);
      return (
        <svg viewBox={`0 0 720 ${H}`} width="100%" height={H} preserveAspectRatio="xMidYMid meet">
          <text x={20} y={20} fontSize="11" fill={c.text}>Chain-of-Thought · 显式推理步骤</text>
          {out}
        </svg>
      );
    },
  },

  'rag-evaluation': {
    params: [
      { key: 'sampleCount', label: '评测样本数', type: 'range', min: 10, max: 100, step: 10, default: 50 },
      { key: 'threshold', label: '相关性阈值', type: 'range', min: 0.3, max: 0.9, step: 0.1, default: 0.6 },
      { key: 'k', label: '检索 top-k', type: 'range', min: 1, max: 5, step: 1, default: 3 },
    ],
    height: H,
    legend: [{ label: '命中率 Hit Rate' }, { label: '幻觉率' }, { label: '忠实度 Faithfulness' }],
    hint: 'RAG 评测：分开评估检索命中率、上下文相关性与答案忠实度，定位链路失效环节。',
    buildSteps(p) {
      const N = clamp(Math.round(num(p.sampleCount, 50)), 10, 100);
      const th = clamp(num(p.threshold, 0.6), 0.3, 0.9);
      const k = clamp(Math.round(num(p.k, 3)), 1, 5);
      const rnd = mulberry32(81001 + N + Math.round(th * 10) + k);
      const samples = [];
      const hit = [], hallu = [], faith = [];
      let hc = 0, fc = 0, ac = 0;
      for (let i = 0; i < N; i++) {
        const score = rnd();
        const hitK = score >= th - 0.1 + k * 0.02;
        if (hitK) hc += 1;
        const faithful = hitK && rnd() > 0.2;
        if (faithful) fc += 1;
        if (!faithful && rnd() > 0.4) ac += 1;
        samples.push({ id: i, hitK, faithful });
        hit.push(hc / (i + 1));
        faith.push(fc / (i + 1));
        hallu.push(ac / (i + 1));
      }
      const steps = [];
      const push = (note, phase, extra = {}) => steps.push({
        N, th, k, samples, hit: hit.slice(), hallu: hallu.slice(), faith: faith.slice(),
        count: 0, prep: 0, phase, note,
        metrics: {
          样本数: N, 阈值: th, topK: k, 已评测: 0,
          命中率: r3(hit[0] || 0, 3), 幻觉率: r3(hallu[0] || 0, 3),
          忠实度: r3(faith[0] || 0, 3),
        },
        ...extra,
      });
      push('RAG 是链路系统：检索没命中、上下文不相关、答案不忠实，都会导致失败。', 'intro', { prep: 1 });
      for (let i = 0; i < 10; i++) {
        push(`评测配置：${String(N)} 条问答、阈值 ${t2(th, 1)}、top-${String(k)}，分项统计而非只看最终答案。`, 'intro',
          { prep: i + 2 });
      }
      push('检索命中率：答案所需片段是否出现在 top-k 召回中。', 'metric', { prep: 12 });
      push('上下文忠实度：生成答案是否可由检索到的上下文支撑。', 'metric', { prep: 13 });
      push('幻觉率：答案包含上下文无法支撑内容的比例。', 'metric', { prep: 14 });
      samples.forEach((s, i) => {
        push(`样本 ${i + 1}/${String(N)}：检索${s.hitK ? '命中' : '未命中'}，答案${s.faithful ? '忠实' : '不忠实'}；当前命中率 ${hit[i].toFixed(2)}，幻觉率 ${hallu[i].toFixed(2)}。`,
          'eval', { count: i + 1,
            metrics: { 样本数: N, 阈值: th, topK: k, 已评测: i + 1,
              命中率: r3(hit[i], 3), 幻觉率: r3(hallu[i], 3), 忠实度: r3(faith[i], 3) } });
      });
      push(`完成：命中率 ${hit[N - 1].toFixed(2)}、忠实度 ${faith[N - 1].toFixed(2)}、幻觉率 ${hallu[N - 1].toFixed(2)}，定位链路瓶颈。`,
        'done', { count: N });
      return finalize(steps);
    },
    render(snap, p, c) {
      const N = num(snap.N, 10), th = num(snap.th, 0.6), k = num(snap.k, 1);
      const hit = snap.hit || [], hallu = snap.hallu || [], faith = snap.faith || [];
      const count = num(snap.count, 0), prep = num(snap.prep, 0), phase = snap.phase || 'intro';
      const i = Math.max(0, Math.min(count, N) - 1);
      const out = [];
      out.push(<text key="h" x={20} y={38} fontSize="11" fill={c.text}>
        {`评测进度 ${String(count)}/${String(N)} · 阈值 ${t2(th, 1)} · top-${String(k)}`}
      </text>);
      const metrics = [
        { label: '命中率', v: num(hit[i], 0), color: c.success },
        { label: '忠实度', v: num(faith[i], 0), color: c.primary },
        { label: '幻觉率', v: num(hallu[i], 0), color: c.danger },
      ];
      metrics.forEach((m, j) => {
        const y = 58 + j * 30;
        out.push(<text key={`l${j}`} x={20} y={y + 8} fontSize="10" fill={c.muted}>{m.label}</text>);
        out.push(<rect key={`b${j}`} x={90} y={y} width={Math.max(2, m.v * 240)} height={14} rx={3}
          fill={m.color} opacity={0.85} />);
        out.push(<text key={`v${j}`} x={96 + m.v * 240} y={y + 11} fontSize="9" fill={c.text}>{t2(m.v, 2)}</text>);
      });
      const rx = 380;
      out.push(<text key="h2" x={rx} y={38} fontSize="11" fill={c.text}>指标随样本累积</text>);
      const x0 = rx + 20, x1 = 700, y0 = 58, y1 = 186;
      const px = (t) => x0 + (t / Math.max(1, N - 1)) * (x1 - x0);
      const py = (v) => y1 - clamp(num(v, 0), 0, 1) * (y1 - y0);
      const mk = (arr, color, key) => {
        const pts = [];
        for (let t = 0; t < count; t++) pts.push(`${t2(px(t), 1)},${t2(py(arr[t]), 1)}`);
        return pts.length > 1 ? <polyline key={key} points={pts.join(' ')} fill="none" stroke={color} strokeWidth="1.8" /> : null;
      };
      out.push(mk(hit, c.success, 'h'));
      out.push(mk(faith, c.primary, 'f'));
      out.push(mk(hallu, c.danger, 'a'));
      out.push(<line key="ax" x1={x0} y1={y1} x2={x1} y2={y1} stroke={c.grid} strokeWidth="0.8" />);
      out.push(<text key="g1" x={x1} y={y0 + 10} textAnchor="end" fontSize="9" fill={c.success}>命中</text>);
      out.push(<text key="g2" x={x1} y={y0 + 24} textAnchor="end" fontSize="9" fill={c.primary}>忠实</text>);
      out.push(<text key="g3" x={x1} y={y0 + 38} textAnchor="end" fontSize="9" fill={c.danger}>幻觉</text>);
      out.push(<rect key="pb" x={20} y={212} width={680} height={96} rx={6} fill={c.panel2} stroke={c.border} />);
      out.push(<text key="p1" x={34} y={236} fontSize="11" fill={c.text}>分项诊断</text>);
      out.push(<text key="p2" x={34} y={260} fontSize="10" fill={c.muted}>
        `命中率低 → 检索/embedding 问题；忠实度低 → 上下文噪声或模型生成问题`
      </text>);
      out.push(<text key="p3" x={34} y={284} fontSize="10" fill={c.muted}>
        `幻觉率高 → 加强引用约束与拒答机制`
      </text>);
      out.push(<text key="prep" x={34} y={301} fontSize="9" fill={c.muted}>
        {prep > 0 ? `准备阶段 ${String(prep)} / 14` : '逐样本评测中'}
      </text>);
      out.push(<text key="p4" x={34} y={H - 22} fontSize="10" fill={c.text}>
        {phase === 'done' ? `最终 命中 ${t2(num(hit[N - 1], 0), 2)} · 忠实 ${t2(num(faith[N - 1], 0), 2)} · 幻觉 ${t2(num(hallu[N - 1], 0), 2)}` : '只评最终答案无法定位是哪一环失效'}
      </text>);
      return (
        <svg viewBox={`0 0 720 ${H}`} width="100%" height={H} preserveAspectRatio="xMidYMid meet">
          <text x={20} y={20} fontSize="11" fill={c.text}>RAG Evaluation · 命中率 / 忠实度 / 幻觉率</text>
          {out}
        </svg>
      );
    },
  },

  guardrail: {
    params: [
      { key: 'rulesCount', label: '护栏规则数', type: 'range', min: 2, max: 6, step: 1, default: 4 },
      { key: 'stage', label: '检查阶段', type: 'select', default: 'both', options: [
        { value: 'input', label: '仅输入侧' }, { value: 'output', label: '仅输出侧' },
        { value: 'both', label: '输入 + 输出' },
      ] },
      { key: 'strictness', label: '严格度', type: 'range', min: 0.2, max: 1, step: 0.1, default: 0.6 },
    ],
    height: H,
    legend: [{ label: '通过请求' }, { label: '输入侧拦截' }, { label: '输出侧拦截' }],
    hint: '安全护栏：在输入输出两侧做规则与模型过滤，拦截越界内容并约束工具权限。',
    buildSteps(p) {
      const R = clamp(Math.round(num(p.rulesCount, 4)), 2, 6);
      const stage = ['input', 'output', 'both'].indexOf(p.stage) >= 0 ? p.stage : 'both';
      const strict = clamp(num(p.strictness, 0.6), 0.2, 1);
      const rules = ['敏感词过滤', '越狱检测', 'PII 脱敏', '工具权限校验', '输出事实核查', '格式合规'].slice(0, R);
      const rnd = mulberry32(82001 + R * 31 + Math.round(strict * 10));
      const reqs = [];
      let blocked = 0, passed = 0, fp = 0;
      for (let i = 0; i < 12; i++) {
        const risky = rnd() < 0.35;
        const caught = risky && rnd() < strict;
        const falsePositive = !risky && rnd() < strict * 0.12;
        let where = 'none';
        if (caught || falsePositive) {
          where = (stage === 'both' ? (rnd() < 0.5 ? 'input' : 'output') : stage);
        }
        if (where !== 'none') blocked += 1; else passed += 1;
        if (falsePositive) fp += 1;
        reqs.push({ id: i, risky, blocked: where !== 'none', where, falsePositive });
      }
      const steps = [];
      const push = (note, phase, extra = {}) => steps.push({
        R, stage, strict, rules, reqs,
        idx: 0, blocked, passed, fp, phase, note,
        metrics: {
          规则数: R, 严格度: strict, 当前请求: 0,
          累计拦截: 0, 通过数: 0, 通过率: r3(passed / 12, 3),
        },
        ...extra,
      });
      push('LLM 应用需要护栏：在输入和输出两侧拦截越界内容与越权工具调用。', 'intro');
      push(`启用 ${String(R)} 条规则：${rules.join('、')}；检查阶段：${stage}。`, 'intro');
      push(`严格度 ${t2(strict, 1)}：越高拦截越多，但误拦率也会上升。`, 'intro');
      reqs.forEach((r, i) => {
        const route = r.blocked ? (r.where === 'input' ? '输入侧拦截' : '输出侧拦截') : '通过';
        push(`请求 ${i + 1}/12：${r.risky ? '含风险' : '正常'} → ${route}${r.falsePositive ? '（误拦）' : ''}。`,
          r.blocked ? 'block' : 'pass', { idx: i + 1,
            metrics: { 规则数: R, 严格度: strict, 当前请求: i + 1,
              累计拦截: reqs.slice(0, i + 1).filter((x) => x.blocked).length,
              通过数: reqs.slice(0, i + 1).filter((x) => !x.blocked).length,
              通过率: r3(reqs.slice(0, i + 1).filter((x) => !x.blocked).length / (i + 1), 3) } });
      });
      push(`完成：12 条请求拦截 ${String(blocked)}、通过 ${String(passed)}、误拦 ${String(fp)}；护栏需在安全与可用间权衡。`,
        'done', { idx: 12 });
      return finalize(steps);
    },
    render(snap, p, c) {
      const rules = snap.rules || [], reqs = snap.reqs || [];
      const stage = String(snap.stage || 'both'), strict = num(snap.strict, 0.6);
      const idx = num(snap.idx, 0), phase = snap.phase || 'intro';
      const cur = reqs[Math.max(0, idx - 1)] || {};
      const out = [];
      const boxes = [
        { label: '用户输入', color: c.primary },
        { label: '输入护栏', color: stage === 'output' ? c.muted : c.warning },
        { label: 'LLM', color: c.primary },
        { label: '输出护栏', color: stage === 'input' ? c.muted : c.warning },
        { label: '响应', color: c.success },
      ];
      boxes.forEach((b, i) => {
        const blockedNode = (i === 1 && cur.where === 'input') || (i === 3 && cur.where === 'output');
        const x = 24 + i * 138;
        out.push(<rect key={`b${i}`} x={x} y={54} width={124} height={44} rx={6}
          fill={blockedNode ? c.danger : b.color} opacity={blockedNode ? 0.9 : 0.7} stroke={c.border} />);
        out.push(<text key={`t${i}`} x={x + 62} y={81} textAnchor="middle" fontSize="10"
          fill={c.bg}>{b.label}</text>);
        if (i < 4) out.push(<text key={`a${i}`} x={x + 128} y={81} fontSize="13" fill={c.accent}>→</text>);
      });
      const blocked = !!cur.blocked;
      out.push(<text key="route" x={24} y={120} fontSize="11" fill={blocked ? c.danger : c.success}>
        {blocked ? `拦截路径：${cur.where === 'input' ? '输入护栏' : '输出护栏'} · 请求未进入下一步`
          : '通过路径：输入→LLM→输出→响应'}
      </text>);
      out.push(<text key="rh" x={24} y={148} fontSize="11" fill={c.text}>规则（{String(rules.length)} 条）</text>);
      rules.forEach((r, i) => {
        const x = 24 + (i % 3) * 220, y = 166 + Math.floor(i / 3) * 26;
        out.push(<rect key={`r${i}`} x={x} y={y} width={208} height={20} rx={4}
          fill={c.panel2} stroke={c.border} />);
        out.push(<text key={`rt${i}`} x={x + 8} y={y + 14} fontSize="9" fill={c.muted}>{`✓ ${r}`}</text>);
      });
      out.push(<rect key="pb" x={24} y={238} width={672} height={72} rx={6} fill={c.panel2} stroke={c.border} />);
      out.push(<text key="p1" x={38} y={262} fontSize="11" fill={c.text}>
        {`请求 ${String(idx)} / 12 · 严格度 ${t2(strict, 1)}`}
      </text>);
      const recent = reqs.slice(Math.max(0, idx - 5), idx);
      recent.forEach((r, j) => {
        out.push(<text key={`q${j}`} x={38 + j * 120} y={288} fontSize="9"
          fill={r.blocked ? c.danger : c.success}>
          {`#${String(r.id + 1)} ${r.blocked ? '拦截' : '通过'}`}
        </text>);
      });
      out.push(<text key="foot" x={24} y={H - 8} fontSize="10" fill={c.muted}>
        {phase === 'done' ? '护栏需在安全性（拦截率）与可用性（误拦率）间权衡' : '红线节点为当前请求被拦截的位置'}
      </text>);
      return (
        <svg viewBox={`0 0 720 ${H}`} width="100%" height={H} preserveAspectRatio="xMidYMid meet">
          <text x={20} y={20} fontSize="11" fill={c.text}>Guardrails · 输入输出双侧拦截路径</text>
          {out}
        </svg>
      );
    },
  },
};
