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
function matmul(A, B) {
  const m = A.length, k = (A[0] || []).length, n = (B[0] || []).length;
  const out = Array.from({ length: m }, () => new Array(n).fill(0));
  for (let i = 0; i < m; i++) for (let t = 0; t < k; t++) {
    const a = A[i][t];
    if (!a) continue;
    for (let j = 0; j < n; j++) out[i][j] += a * ((B[t] && B[t][j]) || 0);
  }
  return out;
}
function transpose(M) {
  if (!M.length) return [];
  return M[0].map((_, j) => M.map((r) => r[j]));
}

export default {
  id: 'lora',
  params: [
    { key: 'd', label: '原始维度 d', type: 'range', min: 8, max: 64, step: 8, default: 32 },
    { key: 'r', label: '秩 r', type: 'range', min: 1, max: 16, step: 1, default: 4 },
    { key: 'alpha', label: '缩放 alpha', type: 'range', min: 1, max: 32, step: 1, default: 8 },
    { key: 'steps', label: '训练步数', type: 'range', min: 5, max: 40, step: 5, default: 20 },
  ],
  height: H,
  legend: [
    { label: '冻结的 W' }, { label: '可训练 B / A' },
    { label: '低秩增量 ΔW' }, { label: 'loss 下降' },
  ],
  hint: 'LoRA：冻结 W(d×d)，只训练低秩分支 B(d×r)·A(r×d)，参数量从 d² 降到 2dr。',

  buildSteps(p) {
    const d = clamp(Math.round(Number(p.d) || 32), 8, 64);
    const r0 = clamp(Math.round(Number(p.r) || 4), 1, 16);
    const r = Math.min(r0, d);
    const alpha = clamp(Math.round(Number(p.alpha) || 8), 1, 32);
    const stepsWant = clamp(Math.round(Number(p.steps) || 20), 5, 40);
    const scale = alpha / r;

    const rnd = mulberry32(61001 + d * 17 + r * 7 + alpha);
    const randMat = (rows, cols, amp) => Array.from({ length: rows }, () =>
      Array.from({ length: cols }, () => (rnd() * 2 - 1) * amp));
    const Wm = randMat(d, d, 0.5);
    const U = randMat(d, r, 0.5), Vt = randMat(r, d, 0.5);
    const target = matmul(U, Vt); // 秩 ≤ r 的目标增量
    let B = randMat(d, r, 0.2), A = randMat(r, d, 0.2);

    const lossOf = (Bx, Ax) => {
      const dW = matmul(Bx, Ax).map((row) => row.map((v) => v * scale));
      let s = 0;
      for (let i = 0; i < d; i++) for (let j = 0; j < d; j++) {
        const e = dW[i][j] - target[i][j];
        s += e * e;
      }
      return { loss: s / (d * d), dW };
    };

    let cur = lossOf(B, A);
    const lossHistory = [cur.loss];
    const frames = [{ B: B.map((x) => x.slice()), A: A.map((x) => x.slice()), dW: cur.dW, loss: cur.loss }];

    for (let s = 1; s <= stepsWant; s++) {
      const E = cur.dW.map((row, i) => row.map((v, j) => v - target[i][j]));
      const At = transpose(A), Bt = transpose(B);
      const coef = (2 * scale) / (d * d);
      const gB = matmul(E, At).map((row) => row.map((v) => coef * v));
      const gA = matmul(Bt, E).map((row) => row.map((v) => coef * v));
      const gnorm = Math.sqrt(gB.flat().reduce((a, b) => a + b * b, 0)
        + gA.flat().reduce((a, b) => a + b * b, 0));
      const bnorm = Math.sqrt(B.flat().reduce((a, b) => a + b * b, 0)
        + A.flat().reduce((a, b) => a + b * b, 0));
      let lr = (0.1 * (bnorm + 1e-3)) / (gnorm + 1e-9);
      const l0 = cur.loss;
      let accepted = false;
      for (let tr = 0; tr < 6; tr++) {
        const b2 = B.map((row, i) => row.map((v, k) => v - lr * gB[i][k]));
        const a2 = A.map((row, i) => row.map((v, k) => v - lr * gA[i][k]));
        const r2 = lossOf(b2, a2);
        if (r2.loss < l0 - 1e-12) {
          B = b2; A = a2; cur = r2; accepted = true; break;
        }
        lr *= 0.5;
      }
      if (!accepted) cur = lossOf(B, A);
      lossHistory.push(cur.loss);
      frames.push({ B: B.map((x) => x.slice()), A: A.map((x) => x.slice()), dW: cur.dW, loss: cur.loss });
    }

    const fullParams = d * d, loraParams = 2 * d * r;
    const saveRatio = 1 - loraParams / fullParams;
    const steps = [];
    const push = (note, phase, s, extra = {}) => steps.push({
      d, r, alpha, scale, stepsWant, Wm, B: frames[s].B, A: frames[s].A, dW: frames[s].dW,
      loss: frames[s].loss, lossHistory: lossHistory.slice(0, s + 1),
      fullParams, loraParams, saveRatio,
      phase, step: s, visSteps: s, note,
      metrics: {
        原始维度: d,
        秩: r,
        缩放: Number(scale.toFixed(3)),
        训练步: s,
        全量参数: fullParams,
        LoRA参数: loraParams,
        节省比例: saveRatio.toFixed(3),
        当前Loss: Number(frames[s].loss.toFixed(4)),
      },
      ...extra,
    });

    push('LoRA：冻结预训练权重 W，用两个小矩阵 B、A 的乘积表示增量 ΔW。', 'intro', 0);
    push(`冻结 W ∈ R^{${d}×${d}}，含 ${fullParams} 个参数，训练中完全不更新。`, 'freeze', 0);
    push(`初始化 B ∈ R^{${d}×${r}}、A ∈ R^{${r}×${d}}，共 ${loraParams} 个可训练参数。`, 'init', 0);
    push(`参数量对比：全量微调 ${fullParams} vs LoRA ${loraParams}，节省 ${(saveRatio * 100).toFixed(1)}%。`, 'param', 0);
    push(`前向：ΔW = (α/r)·B·A，α/r = ${alpha}/${r} = ${scale.toFixed(2)}，h = Wx + ΔWx。`, 'scale', 0);
    for (let s = 1; s <= stepsWant; s++) {
      push(`第 ${s} 步·前向：计算 ΔW 并与目标比较，当前 loss = ${frames[s - 1].loss.toFixed(4)}。`,
        'forward', s - 1, { visSteps: s - 1 });
      push(`第 ${s} 步·更新：沿梯度调整 B、A，loss 降至 ${frames[s].loss.toFixed(4)}（W 仍冻结）。`,
        'update', s, { visSteps: s });
    }
    push(`完成：训练 ${stepsWant} 步后 loss = ${frames[stepsWant].loss.toFixed(4)}，仅更新 ${loraParams} 个参数。`,
      'done', stepsWant, { visSteps: stepsWant });
    return finalize(steps);
  },

  render(snap, p, c) {
    const d = snap.d || 8;
    const r = snap.r || 1;
    const scale = snap.scale || 1;
    const Wm = snap.Wm || [];
    const B = snap.B || [], A = snap.A || [], dW = snap.dW || [];
    const lossHistory = snap.lossHistory || [];
    const visSteps = snap.visSteps ?? 0;
    const fullParams = snap.fullParams || d * d;
    const loraParams = snap.loraParams || 2 * d * r;
    const saveRatio = snap.saveRatio || 0;
    const phase = snap.phase || 'intro';

    const GN = Math.min(d, 16), RN = Math.min(r, 8);
    const grid = (M, rows, cols, gx, gy, gw, gh, baseColor, tag) => {
      const out = [];
      const cw = gw / cols, chh = gh / rows;
      for (let i = 0; i < rows; i++) for (let j = 0; j < cols; j++) {
        const si = Math.floor((i / rows) * (M.length || 1));
        const sj = Math.floor((j / cols) * ((M[0] || []).length || 1));
        const v = (M[si] || [])[sj] || 0;
        out.push(<rect key={`${tag}-${i}-${j}`} x={gx + j * cw} y={gy + i * chh}
          width={Math.max(0.6, cw - 0.5)} height={Math.max(0.6, chh - 0.5)}
          fill={baseColor} opacity={0.12 + 0.7 * Math.min(1, Math.abs(v))} />);
      }
      return out;
    };

    const left = [];
    left.push(<text key="lt" x={20} y={40} fontSize="11" fill={c.text}>低秩分解示意（矩阵下采样显示）</text>);
    left.push(<text key="wl" x={30} y={56} fontSize="9" fill={c.muted}>W 冻结 {d}×{d}</text>);
    left.push(<rect key="wb" x={30} y={60} width={120} height={120} rx={2}
      fill="none" stroke={c.border} strokeWidth="1" />);
    left.push(...grid(Wm, GN, GN, 30, 60, 120, 120, c.muted, 'w'));

    left.push(<text key="bl" x={168} y={72} fontSize="9" fill={c.primary}>B {d}×{r}</text>);
    left.push(<rect key="bb" x={168} y={76} width={28} height={72} rx={2}
      fill="none" stroke={c.border} strokeWidth="1" />);
    left.push(...grid(B, GN, RN, 168, 76, 28, 72, c.primary, 'b'));
    left.push(<text key="mul" x={202} y={116} fontSize="12" fill={c.text}>×</text>);
    left.push(<text key="al" x={222} y={72} fontSize="9" fill={c.purple}>A {r}×{d}</text>);
    left.push(<rect key="ab" x={222} y={76} width={120} height={26} rx={2}
      fill="none" stroke={c.border} strokeWidth="1" />);
    left.push(...grid(A, RN, GN, 222, 76, 120, 26, c.purple, 'a'));
    left.push(<text key="sc" x={222} y={118} fontSize="9" fill={c.muted}>× (α/r) = {scale.toFixed(2)}</text>);

    left.push(<text key="dl" x={30} y={200} fontSize="9" fill={c.success}>ΔW = (α/r)·B·A</text>);
    left.push(<rect key="db" x={30} y={204} width={120} height={90} rx={2}
      fill="none" stroke={c.success} strokeWidth="1" />);
    left.push(...grid(dW, GN, GN, 30, 204, 120, 90, c.success, 'd'));
    left.push(<text key="fx" x={168} y={216} fontSize="10" fill={c.text}>h = W·x + ΔW·x</text>);
    left.push(<text key="fx2" x={168} y={232} fontSize="9" fill={c.muted}>只训练 B、A（蓝/紫）</text>);
    left.push(<text key="fx3" x={168} y={248} fontSize="9" fill={c.muted}>W 保持冻结（灰）</text>);
    left.push(<text key="fx4" x={168} y={272} fontSize="9" fill={c.text}>
      {`当前 loss = ${(snap.loss || 0).toFixed(4)}`}
    </text>);
    left.push(<text key="fx5" x={168} y={288} fontSize="9" fill={c.muted}>
      {`阶段：${{ intro: '总览', freeze: '冻结 W', init: '初始化 B/A', param: '参数量对比', scale: '缩放系数', forward: '前向传播', update: '梯度更新', done: '完成' }[phase] || ''}`}
    </text>);

    const rx = 372;
    const right = [];
    right.push(<text key="pt" x={rx} y={40} fontSize="11" fill={c.text}>可训练参数量对比</text>);
    const maxP = Math.max(1, fullParams, loraParams);
    const h1 = (fullParams / maxP) * 90, h2 = (loraParams / maxP) * 90;
    right.push(<rect key="p1" x={392} y={140 - h1} width={64} height={h1} rx={2} fill={c.muted} opacity={0.55} />);
    right.push(<text key="p1t" x={424} y={140 - h1 - 5} textAnchor="middle" fontSize="9" fill={c.text}>{fullParams}</text>);
    right.push(<text key="p1l" x={424} y={154} textAnchor="middle" fontSize="9" fill={c.muted}>全量微调</text>);
    right.push(<rect key="p2" x={492} y={140 - h2} width={64} height={h2} rx={2} fill={c.success} opacity={0.75} />);
    right.push(<text key="p2t" x={524} y={140 - h2 - 5} textAnchor="middle" fontSize="9" fill={c.text}>{loraParams}</text>);
    right.push(<text key="p2l" x={524} y={154} textAnchor="middle" fontSize="9" fill={c.muted}>LoRA</text>);
    right.push(<text key="sv" x={580} y={90} fontSize="11" fill={c.success}>
      {`节省 ${(saveRatio * 100).toFixed(1)}%`}
    </text>);
    right.push(<text key="sv2" x={580} y={108} fontSize="9" fill={c.muted}>{`2dr = 2×${d}×${r}`}</text>);
    right.push(<text key="sv3" x={580} y={124} fontSize="9" fill={c.muted}>{`d² = ${d}²`}</text>);

    right.push(<text key="ct" x={rx} y={180} fontSize="11" fill={c.text}>训练 loss 下降曲线</text>);
    const x0 = 392, x1 = 694, y0 = 194, y1 = 300;
    const total = Math.max(1, snap.stepsWant || 1);
    const l0 = Math.max(1e-6, lossHistory[0] || 1);
    const pts = [];
    for (let s = 0; s <= Math.min(visSteps, total); s++) {
      const lv = lossHistory[s] || 0;
      const x = x0 + (s / total) * (x1 - x0);
      const y = y1 - clamp(lv / l0, 0, 1) * (y1 - y0);
      pts.push(`${x.toFixed(1)},${y.toFixed(1)}`);
      right.push(<circle key={`cp${s}`} cx={x} cy={y} r={1.8} fill={c.primary} />);
    }
    if (pts.length > 1) right.push(<polyline key="pl" points={pts.join(' ')} fill="none"
      stroke={c.primary} strokeWidth="1.6" />);
    right.push(<line key="ax" x1={x0} y1={y1} x2={x1} y2={y1} stroke={c.grid} strokeWidth="0.8" />);
    right.push(<text key="a0" x={x0} y={y1 + 13} fontSize="9" fill={c.muted}>步 0</text>);
    right.push(<text key="a1" x={x1} y={y1 + 13} textAnchor="end" fontSize="9" fill={c.muted}>
      {`步 ${total}`}
    </text>);
    right.push(<text key="lv" x={x1} y={y0 + 10} textAnchor="end" fontSize="9" fill={c.warning}>
      {`loss=${(snap.loss || 0).toFixed(4)}`}
    </text>);

    return (
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} preserveAspectRatio="xMidYMid meet">
        {left}
        <line x1="358" y1="20" x2="358" y2={H - 12} stroke={c.grid} strokeWidth="1" />
        {right}
        <text x={20} y={330} fontSize="9" fill={c.muted}>
          ΔW 的秩最多为 r={r}；梯度只回传到 B、A，冻结的 W 不占显存梯度
        </text>
      </svg>
    );
  },
};
