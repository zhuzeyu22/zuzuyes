import React from 'react';
import { mulberry32, softmax, clamp } from '../utils.js';

const W = 720, H = 340;

export default {
  id: 'moe-router',
  params: [
    { key: 'experts', label: '专家数量', type: 'range', min: 4, max: 8, step: 2, default: 6 },
    { key: 'topK', label: '每 token 激活 top-k', type: 'range', min: 1, max: 2, step: 1, default: 2 },
    { key: 'tokens', label: 'token 数量', type: 'range', min: 4, max: 12, step: 1, default: 8 },
    { key: 'imbalance', label: '路由偏置强度', type: 'range', min: 0, max: 1, step: 0.1, default: 0.4 },
    { key: 'seed', label: '随机种子', type: 'range', min: 1, max: 30, step: 1, default: 11 },
  ],
  height: H,
  legend: [
    { color: '#226AFF', label: '路由打分（颜色越深越高）' },
    { color: '#12a06a', label: '被选中的专家' },
    { color: '#e5484d', label: '负载过高的专家' },
  ],
  hint: 'MoE 用路由器为每个 token 只激活 top-k 个专家：参数量可以很大，但单次前向的计算量不变。',

  buildSteps(p) {
    const E = p.experts, T = p.tokens, rnd = mulberry32(p.seed * 53 + E);
    const bias = Array.from({ length: E }, () => (rnd() - 0.5) * 2 * p.imbalance * 2.5);
    const logits = Array.from({ length: T }, () => Array.from({ length: E }, (_, e) => (rnd() - 0.5) * 2 + bias[e]));
    const loads = Array(E).fill(0);
    const steps = [];
    const push = (phase, note, extra = {}) => {
      const total = loads.reduce((a, b) => a + b, 0) || 1;
      const bal = E * loads.reduce((s, l) => s + (l / total - 1 / E) ** 2, 0);
      steps.push({
        phase, logits: logits.map((r) => [...r]), loads: [...loads], bal,
        note,
        metrics: { 已路由: extra.routed ?? 0, 均衡损失: Number(bal.toFixed(3)), 最忙专家负载: Math.max(...loads) },
        ...extra,
      });
    };
    push('init', `初始化 ${E} 个专家、${T} 个 token，每个 token 只激活 ${p.topK} 个专家。路由偏置强度 ${p.imbalance}。`);
    let routed = 0;
    for (let t = 0; t < T; t++) {
      const probs = softmax(logits[t], 1);
      push('score', `token ${t}：路由器输出各专家打分 [${logits[t].map((x) => x.toFixed(1)).join(', ')}]，softmax 后取最高分。`,
        { curToken: t, probs, routed });
      const order = probs.map((v, i) => ({ i, v })).sort((a, b) => b.v - a.v);
      const chosen = order.slice(0, Math.min(p.topK, E)).map((o) => o.i);
      const sum = chosen.reduce((s, i) => s + probs[i], 0) || 1;
      push('select', `token ${t} 选中专家 ${chosen.join('、')}，门控权重 ${chosen.map((i) => `${(probs[i] / sum).toFixed(2)}`).join(' / ')}；其余专家不参与计算。`,
        { curToken: t, probs, chosen, routed });
      chosen.forEach((i) => { loads[i] += 1; });
      routed++;
      push('dispatch', `token ${t} 分发完成，更新专家负载：[${loads.join(', ')}]。总计算量约为稠密模型的 ${((p.topK / E) * 100).toFixed(0)}%。`,
        { curToken: t, probs, chosen, routed });
    }
    push('done', `全部 ${T} 个 token 路由完成。负载分布 [${loads.join(', ')}]，均衡损失 ${steps[steps.length - 1].bal.toFixed(3)}（越接近 0 越均衡）；偏置过大会让少数专家过载。`,
      { routed, done: true });
    return steps;
  },

  render(s, p, c) {
    const E = p.experts, T = p.tokens;
    const logits = s.logits || [], loads = s.loads || Array(E).fill(0);
    const chosen = new Set(s.chosen || []);
    const cw = Math.min(56, 330 / E), ch = Math.min(20, 190 / T), ox = 26, oy = 48;
    const maxLoad = Math.max(1, ...loads);
    const gx = 420, gy = 62, gh = 120;
    return (
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} preserveAspectRatio="xMidYMid meet">
        <text x={ox} y="18" fontSize="11" fill={c.muted}>Router 打分矩阵（行 = token，列 = 专家）</text>
        {Array.from({ length: E }, (_, e) => (
          <text key={`e${e}`} x={ox + e * cw + cw / 2} y={oy - 6} textAnchor="middle" fontSize="9" fill={c.muted}>E{e}</text>
        ))}
        {logits.map((row, t) => row.map((v, e) => {
          const norm = clamp((v + 3) / 6, 0, 1);
          const isChosen = s.curToken === t && chosen.has(e);
          return (
            <g key={`${t}-${e}`}>
              <rect x={ox + e * cw} y={oy + t * ch} width={cw - 3} height={ch - 2} rx="3"
                fill={isChosen ? c.success : c.primary} opacity={isChosen ? 0.9 : 0.12 + 0.7 * norm}
                stroke={s.curToken === t ? c.warning : c.grid} strokeWidth={s.curToken === t ? 1.2 : 0.5} />
              <text x={ox + e * cw + cw / 2} y={oy + t * ch + ch / 2 + 3} textAnchor="middle" fontSize="9"
                fill={isChosen ? '#ffffff' : c.text}>{v.toFixed(1)}</text>
            </g>
          );
        }))}
        <text x={ox} y={oy + T * ch + 18} fontSize="10" fill={c.muted}>当前 token：{s.curToken ?? '—'} · 阶段：{s.phase}</text>

        <text x={gx} y="18" fontSize="11" fill={c.muted}>专家负载（被选中次数）</text>
        <rect x={gx} y={gy} width={278} height={gh} rx="8" fill={c.panel} stroke={c.border} />
        {Array.from({ length: E }, (_, e) => {
          const bw2 = 250 / E, h = (loads[e] / maxLoad) * 88;
          const hot = loads[e] === maxLoad && maxLoad > 0;
          return (
            <g key={e}>
              <rect x={gx + 14 + e * bw2} y={gy + 100 - h} width={bw2 - 8} height={h}
                fill={hot ? c.danger : c.primary} opacity={hot ? 0.9 : 0.7} />
              <text x={gx + 14 + e * bw2 + (bw2 - 8) / 2} y={gy + 96 - h} textAnchor="middle" fontSize="9" fill={c.text}>{loads[e]}</text>
              <text x={gx + 14 + e * bw2 + (bw2 - 8) / 2} y={gy + 114} textAnchor="middle" fontSize="9" fill={c.muted}>E{e}</text>
            </g>
          );
        })}
        <text x={gx} y="212" fontSize="11" fill={c.text}>已路由 {s.routed ?? 0} / {T} token · top-{p.topK}</text>
        <text x={gx} y="232" fontSize="11" fill={c.muted}>均衡损失 {(s.bal ?? 0).toFixed(3)}（0 = 完全均匀）</text>
        <text x={gx} y="252" fontSize="10" fill={c.muted}>单 token 计算量 ≈ {(p.topK / E * 100).toFixed(0)}% 稠密模型</text>

        <rect x="22" y="276" width="676" height="52" rx="8" fill={c.panel2 || c.panel} stroke={c.border} />
        <text x="36" y="296" fontSize="11" fill={c.text}>{s.note}</text>
        <text x="36" y="316" fontSize="10" fill={c.muted}>负载不均会导致部分专家饥饿或溢出，实际系统用辅助损失 + 容量因子 + 随机路由来缓解</text>
      </svg>
    );
  },
};
