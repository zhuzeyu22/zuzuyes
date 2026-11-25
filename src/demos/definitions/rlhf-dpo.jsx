import React from 'react';
import { clamp } from '../utils.js';

const W = 720, H = 340;

export default {
  id: 'rlhf-dpo',
  params: [
    { key: 'method', label: '对齐方法', type: 'select', default: 'dpo',
      options: [{ value: 'dpo', label: 'DPO 直接偏好优化' }, { value: 'ppo', label: 'PPO-RLHF（显式奖励模型）' }, { value: 'sft', label: 'SFT 基线（只做监督微调）' }] },
    { key: 'beta', label: 'β（偏离约束强度）', type: 'range', min: 0.05, max: 0.6, step: 0.05, default: 0.1 },
    { key: 'strength', label: '偏好数据质量', type: 'range', min: 0.2, max: 1, step: 0.1, default: 0.8 },
    { key: 'steps', label: '训练步数', type: 'range', min: 10, max: 60, step: 5, default: 30 },
  ],
  height: H,
  legend: [
    { color: '#12a06a', label: 'chosen 回答概率' },
    { color: '#e5484d', label: 'rejected 回答概率' },
    { color: '#226AFF', label: '偏好间隔 margin' },
  ],
  hint: '用「人类更喜欢哪个回答」的成对数据驱动对齐：PPO 需显式奖励模型，DPO 把奖励隐含进偏好似然。',

  buildSteps(p) {
    const steps = [];
    const hist = [];
    for (let t = 0; t <= p.steps; t++) {
      const prog = 1 - Math.exp(-t / 14);
      let pc = 0.55, pr = 0.45, kl = 0;
      if (p.method === 'sft') {
        pc = 0.55 + 0.02 * prog; pr = 0.45 - 0.02 * prog;
      } else if (p.method === 'ppo') {
        const gain = 0.32 * p.strength * prog / (1 + p.beta * 2.2);
        pc = 0.55 + gain; pr = 0.45 - gain * 0.75;
        kl = 0.06 * p.strength * prog / (1 + p.beta * 3);
      } else {
        const gain = 0.36 * p.strength * prog / (1 + p.beta * 1.4);
        pc = 0.55 + gain; pr = 0.45 - gain * 0.82;
        kl = 0.035 * p.strength * prog / (1 + p.beta * 4);
      }
      pc = clamp(pc, 0.05, 0.95); pr = clamp(pr, 0.03, 0.93);
      const margin = pc - pr;
      const logratio = Math.log(pc / 0.5) - Math.log(pr / 0.5);
      const loss = p.method === 'sft' ? 0.69 - 0.08 * prog : -Math.log(1 / (1 + Math.exp(-p.beta * logratio * 2 - 0.4)));
      hist.push({ pc, pr, margin });
      steps.push({
        t, pc, pr, margin, kl, loss, hist: hist.map((x) => ({ ...x })),
        note: t === 0
          ? `初始化：SFT 模型对 chosen / rejected 的概率接近（0.55 / 0.45），偏好间隔很小。方法 = ${p.method.toUpperCase()}，β = ${p.beta}。`
          : `第 ${t} 步：chosen 概率 ${pc.toFixed(3)}，rejected ${pr.toFixed(3)}，间隔 ${margin.toFixed(3)}，KL 偏移 ${kl.toFixed(3)}。`,
        metrics: { 训练步数: t, 偏好间隔: Number(margin.toFixed(3)), 损失: Number(loss.toFixed(3)), KL: Number(kl.toFixed(3)) },
      });
    }
    steps.push({
      ...steps[steps.length - 1], done: true,
      note: `${p.method.toUpperCase()} 训练结束：偏好间隔从 0.10 提升到 ${steps[steps.length - 1].margin.toFixed(3)}。β 越大越保守，偏好数据质量越差间隔越难拉开。`,
    });
    return steps;
  },

  render(s, p, c) {
    const stages = ['SFT 基座', '偏好数据 (x, y_w, y_l)', p.method === 'ppo' ? '奖励模型 + PPO' : '隐式奖励 / 偏好损失', '对齐后策略'];
    const activeStage = Math.min(3, Math.floor((s.t ?? 0) / Math.max(1, p.steps / 4)));
    const hist = s.hist || [];
    const gx = 26, gy = 118, gw = 420, gh = 130;
    const X = (i) => gx + (i / Math.max(1, hist.length - 1)) * gw;
    const Y = (v) => gy + gh - v * gh;
    const line = (key, color) => (
      <polyline key={key} points={hist.map((h, i) => `${X(i)},${Y(h[key])}`).join(' ')} fill="none" stroke={color} strokeWidth="2" />
    );
    return (
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} preserveAspectRatio="xMidYMid meet">
        <text x="22" y="16" fontSize="11" fill={c.muted}>对齐流程</text>
        {stages.map((st, i) => (
          <g key={i}>
            <rect x={22 + i * 174} y="26" width="160" height="42" rx="7"
              fill={i === activeStage ? c.primary : c.panel} opacity={i === activeStage ? 0.85 : 1} stroke={c.border} />
            <text x={102 + i * 174} y="51" textAnchor="middle" fontSize="10.5" fill={i === activeStage ? '#ffffff' : c.text}>{st}</text>
            {i < 3 && <text x={186 + i * 174} y="52" fontSize="13" fill={c.muted}>→</text>}
          </g>
        ))}

        <text x={gx} y="104" fontSize="11" fill={c.muted}>概率随训练变化</text>
        <rect x={gx} y={gy} width={gw} height={gh} rx="6" fill={c.panel} stroke={c.border} />
        {[0, 0.25, 0.5, 0.75, 1].map((v) => (
          <g key={v}>
            <line x1={gx} y1={Y(v)} x2={gx + gw} y2={Y(v)} stroke={c.grid} strokeWidth="0.7" />
            <text x={gx - 5} y={Y(v) + 3} textAnchor="end" fontSize="9" fill={c.muted}>{v.toFixed(2)}</text>
          </g>
        ))}
        {line('pc', c.success)}{line('pr', c.danger)}{line('margin', c.primary)}

        <rect x="468" y="118" width="230" height="130" rx="8" fill={c.panel} stroke={c.border} />
        <text x="482" y="140" fontSize="11" fill={c.muted}>当前指标 · step {s.t ?? 0}</text>
        <text x="482" y="164" fontSize="11" fill={c.success}>chosen　{(s.pc ?? 0).toFixed(3)}</text>
        <text x="482" y="186" fontSize="11" fill={c.danger}>rejected　{(s.pr ?? 0).toFixed(3)}</text>
        <text x="482" y="208" fontSize="11" fill={c.primary}>margin　{(s.margin ?? 0).toFixed(3)}</text>
        <text x="482" y="230" fontSize="11" fill={c.text}>loss {(s.loss ?? 0).toFixed(3)} · KL {(s.kl ?? 0).toFixed(3)}</text>

        <rect x="22" y="262" width="676" height="64" rx="8" fill={c.panel2 || c.panel} stroke={c.border} />
        <text x="36" y="284" fontSize="11" fill={c.text}>{s.note}</text>
        <text x="36" y="306" fontSize="10" fill={c.muted}>
          DPO：L = −log σ(β·[log π(y_w)/π_ref(y_w) − log π(y_l)/π_ref(y_l)])　·　β 越大越贴近参考模型，防止跑偏
        </text>
        <text x="36" y="320" fontSize="10" fill={c.muted}>PPO 需在线采样与奖励模型；DPO 离线、简洁，但对偏好数据分布更敏感</text>
      </svg>
    );
  },
};
