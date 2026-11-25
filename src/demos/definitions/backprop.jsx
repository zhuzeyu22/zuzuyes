import React from 'react';
import { clamp } from '../utils.js';

const H = 380;
const X = [0.8, -0.4];
const W1_0 = [[0.30, -0.70], [-0.50, 0.20], [0.80, 0.10]];
const W2_0 = [0.60, -0.40, 0.30];
const B1_0 = [0.10, -0.20, 0.05];
const B2_0 = [-0.10];

const sigmoid = (z) => 1 / (1 + Math.exp(-clamp(z, -30, 30)));
const copy2 = (m) => m.map((r) => r.slice());
const fmt = (v) => Number(v).toFixed(3);

function forward(W1, W2, b1, b2) {
  const z1 = W1.map((row, i) => row[0] * X[0] + row[1] * X[1] + b1[i]);
  const a1 = z1.map(sigmoid);
  const z2 = W2.reduce((s, w, i) => s + w * a1[i], b2[0]);
  const y = sigmoid(z2);
  return { z1, a1, z2, y };
}

export default {
  id: 'backprop',
  params: [
    { key: 'lr', label: '学习率 η', type: 'range', min: 0.05, max: 1.2, step: 0.05, default: 0.3, hint: '过大会震荡甚至发散' },
    { key: 'epochs', label: '训练轮数', type: 'range', min: 1, max: 6, step: 1, default: 3 },
    { key: 'target', label: '目标输出', type: 'select', default: 1, options: [{ value: 0, label: '0（低）' }, { value: 1, label: '1（高）' }] },
  ],
  height: H,
  legend: [
    { label: '正权重' }, { label: '负权重' }, { label: '本步梯度' }, { label: '激活值强度' },
  ],
  hint: '反向传播 = 链式法则 + 误差逐层回传：先算输出误差 δ₂，再把它乘回 W₂ 得到隐层误差 δ₁。',

  buildSteps(p) {
    const lr = clamp(Number(p.lr) || 0.3, 0.05, 1.2);
    const epochs = Math.round(clamp(Number(p.epochs) || 3, 1, 6));
    const target = Number(p.target) === 0 ? 0 : 1;

    let W1 = copy2(W1_0), W2 = W2_0.slice(), b1 = B1_0.slice(), b2 = B2_0.slice();
    const history = [];
    const frame = (note, phase, extra = {}) => ({
      note, phase, epoch: 0, W1: copy2(W1), W2: W2.slice(), b1: b1.slice(), b2: b2.slice(),
      history: history.slice(), X, target, lr,
      z1: [0, 0, 0], a1: [0.5, 0.5, 0.5], z2: 0, y: 0.5, loss: 0,
      gradW1: copy2(W1_0).map((r) => r.map(() => 0)), gradW2: W2_0.map(() => 0),
      d1: [0, 0, 0], d2: 0,
      metrics: { 轮次: `${0}/${epochs}`, 损失: '0.000', 学习率: lr, 目标: target },
      ...extra,
    });

    const steps = [frame(
      `网络结构：2 输入 → 3 隐层（Sigmoid）→ 1 输出。输入 x = [${X.join(', ')}]，目标 t = ${target}。`,
      'init'
    )];

    for (let ep = 1; ep <= epochs; ep++) {
      const f = forward(W1, W2, b1, b2);
      const loss = 0.5 * (f.y - target) ** 2;
      history.push(loss);
      const base = {
        epoch: ep, ...f, loss,
        metrics: { 轮次: `${ep}/${epochs}`, 损失: fmt(loss), 学习率: lr, 目标: target },
      };

      steps.push(frame(`第 ${ep} 轮·前向：z₁ = W₁x + b₁ → a₁ = σ(z₁)，再算出输出 y = σ(W₂a₁ + b₂) = ${fmt(f.y)}。`,
        'forward', base));

      // 输出层误差：δ₂ = (y - t) · y(1-y)
      const d2 = (f.y - target) * f.y * (1 - f.y);
      const gradW2 = f.a1.map((a) => d2 * a);
      const gradb2 = d2;
      steps.push(frame(`第 ${ep} 轮·输出层反向：δ₂ = (y−t)·y(1−y) = ${fmt(d2)}，用它求 W₂ 与 b₂ 的梯度。`,
        'back-out', { ...base, d2, gradW2, gradb2 }));

      // 隐层误差：δ₁ = (W₂ᵀδ₂) ⊙ a₁(1-a₁)，注意使用的是更新前的 W₂
      const d1 = W2.map((w, i) => d2 * w * f.a1[i] * (1 - f.a1[i]));
      const gradW1 = d1.map((d) => X.map((x) => d * x));
      steps.push(frame(`第 ${ep} 轮·隐层反向：δ₁ = (W₂ᵀδ₂) ⊙ a₁(1−a₁)，误差就这样一层层往回传。`,
        'back-hidden', { ...base, d1, d2, gradW1, gradW2, gradb2 }));

      W1 = W1.map((row, i) => row.map((w, j) => w - lr * gradW1[i][j]));
      W2 = W2.map((w, i) => w - lr * gradW2[i]);
      b1 = b1.map((v, i) => v - lr * d1[i]);
      b2 = b2.map((v) => v - lr * gradb2);
      steps.push(frame(`第 ${ep} 轮·参数更新：W ← W − η·∂L/∂W。损失 ${fmt(loss)}，下一轮 y 会更接近目标。`,
        'update', { ...base, d1, d2, gradW1, gradW2, gradb2 }));
    }

    steps.push(frame(
      `训练完成：共 ${epochs} 轮，损失从 ${fmt(history[0])} 降到 ${fmt(history[history.length - 1])}。调大学习率看看收敛是否更稳。`,
      'done',
      {
        epoch: epochs,
        ...(() => {
          const f = forward(W1, W2, b1, b2);
          return { ...f, loss: 0.5 * (f.y - target) ** 2 };
        })(),
        metrics: { 轮次: `${epochs}/${epochs}`, 最终损失: fmt(history[history.length - 1]), 学习率: lr, 目标: target },
      }
    ));
    return steps;
  },

  render(snap, p, c) {
    const W1 = snap.W1 || W1_0;
    const W2 = snap.W2 || W2_0;
    const a1 = snap.a1 || [0.5, 0.5, 0.5];
    const y = typeof snap.y === 'number' ? snap.y : 0.5;
    const phase = snap.phase || 'init';
    const gradW1 = snap.gradW1 || W1.map((r) => r.map(() => 0));
    const gradW2 = snap.gradW2 || W2.map(() => 0);
    const history = snap.history || [];
    const inPos = [{ x: 104, y: 96 }, { x: 104, y: 216 }];
    const hidPos = [{ x: 360, y: 66 }, { x: 360, y: 156 }, { x: 360, y: 246 }];
    const outPos = { x: 626, y: 156 };
    const r = 23;
    const showGrad = phase === 'back-out' || phase === 'back-hidden' || phase === 'update';

    const edge = (x1, y1, x2, y2, w, g, key) => {
      const active = showGrad && Math.abs(g) > 0.0005;
      const width = 1 + Math.min(4, Math.abs(w) * 2.4);
      return (
        <line key={key} x1={x1} y1={y1} x2={x2} y2={y2}
          stroke={active ? c.warning : w >= 0 ? c.primary : c.danger}
          strokeWidth={active ? width + 1.5 : width}
          strokeOpacity={active ? 0.95 : 0.22 + Math.min(0.6, Math.abs(w) * 0.7)}
          strokeLinecap="round" />
      );
    };

    const node = (x, yv, label, val, key, highlight) => (
      <g key={key}>
        <circle cx={x} cy={yv} r={r} fill={highlight ? c.panel2 : c.panel}
          stroke={highlight ? c.success : c.border} strokeWidth={highlight ? 2.5 : 1.5} />
        <text x={x} y={yv - 3} textAnchor="middle" fontSize="12" fill={c.text} fontWeight="600">{label}</text>
        <text x={x} y={yv + 12} textAnchor="middle" fontSize="10" fill={c.muted}>{fmt(val)}</text>
      </g>
    );

    const edges = [];
    W1.forEach((row, i) => row.forEach((w, j) => edges.push(
      edge(inPos[j].x + r, inPos[j].y, hidPos[i].x - r, hidPos[i].y, w, gradW1[i][j], `w1-${i}-${j}`)
    )));
    W2.forEach((w, i) => edges.push(
      edge(hidPos[i].x + r, hidPos[i].y, outPos.x - r, outPos.y, w, gradW2[i], `w2-${i}`)
    ));

    const lossPts = history.map((v, i) => {
      const x = 56 + (i / Math.max(1, history.length - 1)) * 180;
      const y = 352 - Math.min(1, v / 0.25) * 34;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    }).join(' ');

    return (
      <svg viewBox="0 0 720 380" width="100%" role="img" aria-label="反向传播计算过程">
        <text x="24" y="26" fontSize="12" fill={c.muted}>输入层</text>
        <text x="330" y="26" fontSize="12" fill={c.muted}>隐藏层 · Sigmoid</text>
        <text x="608" y="26" fontSize="12" fill={c.muted}>输出层</text>
        {edges}
        {inPos.map((pt, i) => node(pt.x, pt.y, `x${i + 1}`, X[i], `in${i}`, false))}
        {hidPos.map((pt, i) => node(pt.x, pt.y, `h${i + 1}`, a1[i], `hid${i}`, phase === 'forward' || phase === 'back-hidden'))}
        {node(outPos.x, outPos.y, 'y', y, 'out', phase === 'forward' || phase === 'back-out')}
        <text x="626" y="206" textAnchor="middle" fontSize="11" fill={c.muted}>
          目标 {snap.target === 0 ? 0 : 1} · 损失 {fmt(snap.loss || 0)}
        </text>

        <rect x="36" y="300" width="224" height="64" rx="10" fill={c.panel} stroke={c.border} />
        <text x="48" y="317" fontSize="11" fill={c.muted}>训练损失曲线</text>
        {history.length > 1 && <polyline points={lossPts} fill="none" stroke={c.success} strokeWidth="2" />}
        {history.map((v, i) => {
          const x = 56 + (i / Math.max(1, history.length - 1)) * 180;
          const yy = 352 - Math.min(1, v / 0.25) * 34;
          return <circle key={`p${i}`} cx={x} cy={yy} r="2.5" fill={c.success} />;
        })}

        <rect x="474" y="300" width="210" height="64" rx="10" fill={c.panel} stroke={c.border} />
        <text x="486" y="317" fontSize="11" fill={c.muted}>当前阶段</text>
        <text x="486" y="338" fontSize="12" fill={c.text}>
          {{ init: '初始化参数', forward: '前向传播', 'back-out': '输出层反向', 'back-hidden': '隐层反向', update: '梯度更新', done: '训练完成' }[phase] || phase}
        </text>
        <text x="486" y="354" fontSize="10" fill={c.muted}>δ₂ = {fmt(snap.d2 || 0)} · η = {fmt(snap.lr || 0.3)}</text>
      </svg>
    );
  },
};
