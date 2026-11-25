import React from 'react';
import { mulberry32, clamp } from '../utils.js';

const W = 720;
const r2 = (v) => Math.round((Number.isFinite(v) ? v : 0) * 100) / 100;
const f2 = (v) => (Number.isFinite(v) ? v : 0).toFixed(2);

export default {
  id: 'matrix-factorization',
  params: [
    { key: 'k', label: '隐向量维度 k', type: 'range', min: 2, max: 8, step: 1, default: 3, hint: 'P、Q 的列数，越大表达力越强' },
    { key: 'lr', label: '学习率', type: 'range', min: 0.005, max: 0.1, step: 0.005, default: 0.03 },
    { key: 'lambda', label: '正则系数 λ', type: 'range', min: 0.001, max: 0.1, step: 0.001, default: 0.02 },
    { key: 'epochs', label: '迭代轮数', type: 'range', min: 3, max: 12, step: 1, default: 6 },
    { key: 'seed', label: '随机种子', type: 'range', min: 1, max: 30, step: 1, default: 7 },
    { key: 'useBias', label: '启用偏置项', type: 'toggle', default: true, hint: '预测加入 μ + b_u + b_i，通常收敛更快' },
  ],
  height: 360,
  legend: [
    { color: '#226AFF', label: '真实评分矩阵 R' },
    { color: '#7c5cff', label: '重构（补全）矩阵' },
    { color: '#f5a524', label: '当前更新样本 / 损失曲线' },
    { color: '#12a06a', label: '缺失评分补全预测' },
  ],
  hint: '矩阵分解用 P·Q 逼近评分矩阵：逐步 SGD 更新隐向量，观察重构误差下降与缺失评分的补全。',

  buildSteps(p) {
    const rnd = mulberry32(p.seed);
    const U = 5, I = 6;
    const K = clamp(Math.round(p.k), 2, 8);
    const lr = clamp(Number(p.lr) || 0.03, 0.001, 0.2);
    const lam = clamp(Number(p.lambda) || 0.02, 0, 0.5);
    const E = clamp(Math.round(p.epochs), 3, 12);
    const useBias = !!p.useBias;

    // 评分矩阵：1~5 分为已评分，0 为缺失（不参与训练）
    const R = Array.from({ length: U }, () =>
      Array.from({ length: I }, () => (rnd() < 0.72 ? 1 + Math.floor(rnd() * 5) : 0)));
    const rated = [];
    for (let u = 0; u < U; u++) for (let i = 0; i < I; i++) if (R[u][i] > 0) rated.push({ u, i, r: R[u][i] });
    for (let u = 0; u < U && rated.length < 12; u++)
      for (let i = 0; i < I && rated.length < 12; i++)
        if (R[u][i] === 0) { R[u][i] = 1 + Math.floor(rnd() * 5); rated.push({ u, i, r: R[u][i] }); }

    const P = Array.from({ length: U }, () => Array.from({ length: K }, () => (rnd() - 0.5) * 0.2));
    const Q = Array.from({ length: I }, () => Array.from({ length: K }, () => (rnd() - 0.5) * 0.2));
    const bu = Array.from({ length: U }, () => 0);
    const bi = Array.from({ length: I }, () => 0);
    const mu = rated.reduce((s, o) => s + o.r, 0) / Math.max(1, rated.length);

    const predict = (u, i) => {
      let d = 0;
      for (let t = 0; t < K; t++) d += P[u][t] * Q[i][t];
      if (useBias) d += mu + bu[u] + bi[i];
      return d;
    };
    const currentLoss = () => {
      let s = 0;
      for (const o of rated) { const e = o.r - predict(o.u, o.i); s += e * e; }
      return Math.sqrt(s / Math.max(1, rated.length));
    };

    const steps = [];
    const lossHistory = [];
    const snapOf = (note, extra, metrics) => steps.push({
      R, rated, U, I, K, mu, useBias, lr, lam, E,
      P: P.map((r) => r.slice()), Q: Q.map((r) => r.slice()),
      bu: bu.slice(), bi: bi.slice(),
      lossHistory: lossHistory.slice(), note, metrics, ...extra,
    });

    const firstLoss = currentLoss();
    lossHistory.push(firstLoss);
    snapOf(`初始化：共 ${rated.length} 个已评分格，P/Q 为 k=${K} 维小随机向量，初始 RMSE=${f2(firstLoss)}。`,
      { focus: null, epoch: 0, updateCount: 0 },
      { 已评分格: rated.length, 初始RMSE: r2(firstLoss), 隐向量维度: K, 学习率: lr, 正则λ: r2(lam) });

    let updateCount = 0;
    for (let ep = 1; ep <= E; ep++) {
      const order = rated.slice();
      for (let t = order.length - 1; t > 0; t--) {
        const j = Math.floor(rnd() * (t + 1));
        [order[t], order[j]] = [order[j], order[t]];
      }
      for (const o of order) {
        const pred0 = predict(o.u, o.i);
        const err = o.r - pred0;
        const pOld = P[o.u].slice(), qOld = Q[o.i].slice();
        let dot = 0; const dotTerms = [];
        for (let d = 0; d < K; d++) { const term = pOld[d] * qOld[d]; dotTerms.push(term); dot += term; }
        const biasPart = useBias ? mu + bu[o.u] + bi[o.i] : 0;
        for (let d = 0; d < K; d++) {
          P[o.u][d] = pOld[d] + lr * (err * qOld[d] - lam * pOld[d]);
          Q[o.i][d] = qOld[d] + lr * (err * pOld[d] - lam * qOld[d]);
        }
        if (useBias) {
          bu[o.u] += lr * (err - lam * bu[o.u]);
          bi[o.i] += lr * (err - lam * bi[o.i]);
        }
        const pNew = P[o.u].slice(), qNew = Q[o.i].slice();
        updateCount++;
        const loss = currentLoss();
        lossHistory.push(loss);
        snapOf(
          `第 ${ep} 轮 · 更新 (U${o.u},I${o.i})：p·q=${f2(dot)}${useBias ? ' +bias ' + f2(biasPart) : ''} → pred=${f2(pred0)}，e=${f2(err)}，RMSE=${f2(loss)}。`,
          {
            focus: { u: o.u, i: o.i, r: o.r, p: pOld, q: qOld, dotTerms, dot, biasPart, pred: pred0, err, pNew, qNew },
            epoch: ep, updateCount,
          },
          { 轮次: ep, 已更新: updateCount, 当前RMSE: r2(loss), 预测分: r2(pred0), 误差: r2(err) },
        );
      }
    }
    const finalLoss = currentLoss();
    lossHistory.push(finalLoss);
    snapOf(`训练完成：${E} 轮、${updateCount} 次梯度更新，RMSE 从 ${f2(firstLoss)} 降到 ${f2(finalLoss)}。`,
      { focus: null, epoch: E, updateCount, done: true },
      { 最终RMSE: r2(finalLoss), 下降幅度: r2(firstLoss - finalLoss), 已更新: updateCount, 训练轮数: E });

    if (steps.length > 260) {
      const stride = Math.ceil(steps.length / 260);
      return steps.filter((_, idx) => idx % stride === 0 || idx === steps.length - 1);
    }
    return steps;
  },

  render(snap, p, c) {
    const H = 360;
    const R = Array.isArray(snap.R) ? snap.R : [];
    const P = Array.isArray(snap.P) ? snap.P : [];
    const Q = Array.isArray(snap.Q) ? snap.Q : [];
    const bu = Array.isArray(snap.bu) ? snap.bu : [];
    const bi = Array.isArray(snap.bi) ? snap.bi : [];
    const U = R.length, I = U ? (R[0] || []).length : 0;
    const K = P.length ? (P[0] || []).length : 0;
    const mu = snap.mu || 0;
    const useBias = !!snap.useBias;
    const focus = snap.focus || null;
    const terms = focus && Array.isArray(focus.dotTerms) ? focus.dotTerms : [];
    const lh = Array.isArray(snap.lossHistory) ? snap.lossHistory : [];
    const lr = snap.lr ?? 0.03, lam = snap.lam ?? 0.02;
    const maxL = Math.max(0.5, ...lh);

    const predAt = (u, i) => {
      if (!P[u] || !Q[i]) return 0;
      let d = 0;
      for (let t = 0; t < K; t++) d += (P[u][t] || 0) * (Q[i][t] || 0);
      if (useBias) d += mu + (bu[u] || 0) + (bi[i] || 0);
      return Number.isFinite(d) ? d : 0;
    };

    const matrix = (y0, isRecon) => {
      const cw = 30, ch = 22, x0 = 28;
      return (
        <g>
          {I > 0 && Array.from({ length: I }, (_, i) => (
            <text key={'h' + i} x={x0 + (i + 0.5) * cw} y={y0 - 4} textAnchor="middle" fontSize="9" fill={c.muted}>I{i}</text>
          ))}
          {R.map((row, u) => (
            <g key={'r' + u}>
              <text x={x0 - 6} y={y0 + (u + 0.5) * ch + 3} textAnchor="end" fontSize="9" fill={c.muted}>U{u}</text>
              {(row || []).map((v, i) => {
                const x = x0 + i * cw, y = y0 + u * ch;
                const pred = isRecon ? predAt(u, i) : v;
                const lit = isRecon ? true : v > 0;
                const level = isRecon ? clamp(pred, 0, 6) : v;
                const predTxt = Math.abs(pred) > 9.9 ? (pred > 0 ? '9+' : '-9') : f2(pred);
                const isFocus = focus && focus.u === u && focus.i === i;
                return (
                  <g key={i}>
                    <rect x={x + 1} y={y + 1} width={cw - 2} height={ch - 2} rx="2"
                      fill={lit ? (isRecon ? c.purple : c.primary) : c.panel2}
                      opacity={lit ? Math.min(0.85, 0.08 + 0.11 * level) : 1}
                      stroke={isFocus ? c.warning : (isRecon && v === 0 ? c.success : 'none')}
                      strokeWidth={isFocus ? 1.6 : (isRecon && v === 0 ? 0.9 : 0)} />
                    <text x={x + cw / 2} y={y + ch / 2 + 3} textAnchor="middle" fontSize="9"
                      fill={lit ? c.text : c.muted}>{lit ? (isRecon ? predTxt : v) : '·'}</text>
                  </g>
                );
              })}
            </g>
          ))}
        </g>
      );
    };

    return (
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} preserveAspectRatio="xMidYMid meet">
        <text x="20" y="16" fontSize="11" fill={c.text}>
          矩阵分解 SGD · 隐向量 k={K || '—'} · {useBias ? '带偏置' : '无偏置'} · 第 {snap.epoch || 0} 轮
        </text>
        <text x="20" y="30" fontSize="10" fill={c.muted}>真实评分矩阵 R（数字=已评分，·=缺失）</text>
        <text x="250" y="30" fontSize="10" fill={c.muted}>重构误差 RMSE 下降曲线</text>
        <text x="490" y="30" fontSize="10" fill={c.muted}>p_u · q_i 计算与梯度更新</text>

        {matrix(42, false)}
        <text x="20" y="158" fontSize="10" fill={c.muted}>重构矩阵 P·Q（绿框 = 缺失评分的补全预测）</text>
        {matrix(172, true)}

        {/* 损失曲线 */}
        <line x1="250" y1="158" x2="470" y2="158" stroke={c.grid} strokeWidth="1" />
        <line x1="250" y1="42" x2="250" y2="158" stroke={c.grid} strokeWidth="1" />
        {[0.25, 0.5, 0.75].map((f) => (
          <line key={f} x1="250" y1={158 - f * 116} x2="470" y2={158 - f * 116}
            stroke={c.grid} strokeWidth="0.6" strokeDasharray="3 3" />
        ))}
        {lh.length > 1 && (
          <polyline
            points={lh.map((v, t) => `${250 + (t / (lh.length - 1)) * 218},${158 - (clamp(v, 0, maxL) / maxL) * 116}`).join(' ')}
            fill="none" stroke={c.primary} strokeWidth="1.6" />
        )}
        {lh.length > 0 && (
          <circle cx={250 + ((lh.length - 1) / Math.max(1, lh.length - 1)) * 218}
            cy={158 - (clamp(lh[lh.length - 1], 0, maxL) / maxL) * 116} r="3" fill={c.warning} />
        )}
        <text x="252" y="52" fontSize="9" fill={c.muted}>RMSE 上界 {f2(maxL)}</text>
        <text x="470" y="174" fontSize="9" textAnchor="end" fill={c.muted}>更新次数 {Math.max(0, lh.length - 1)}</text>
        <text x="360" y="194" fontSize="10" fill={c.text}>当前 RMSE = {lh.length ? f2(lh[lh.length - 1]) : '—'}</text>
        <text x="360" y="212" fontSize="9" fill={c.muted}>lr={f2(lr)} · λ={f2(lam)} · 每轮 {snap.rated ? snap.rated.length : 0} 次更新</text>

        {/* 点积展开面板 */}
        {!focus ? (
          <text x="490" y="60" fontSize="10" fill={c.muted}>训练开始后，这里逐步展开某个 (u,i) 的点积与梯度更新。</text>
        ) : (
          <g>
            <text x="490" y="56" fontSize="10" fill={c.text}>样本 (U{focus.u}, I{focus.i}) · 真实 r = {focus.r}</text>
            <text x="490" y="74" fontSize="9" fill={c.muted}>
              p_u = [{focus.p.slice(0, 4).map(f2).join(', ')}{focus.p.length > 4 ? ', …' : ''}]
            </text>
            <text x="490" y="90" fontSize="9" fill={c.muted}>
              q_i = [{focus.q.slice(0, 4).map(f2).join(', ')}{focus.q.length > 4 ? ', …' : ''}]
            </text>
            <text x="490" y="108" fontSize="10" fill={c.text}>逐维点积 p_d · q_d：</text>
            {terms.map((term, t) => (
              <text key={t} x={490 + (t % 2) * 106} y={124 + Math.floor(t / 2) * 14} fontSize="9" fill={c.text}>
                d{t}: {f2(focus.p[t])}×{f2(focus.q[t])} = {f2(term)}
              </text>
            ))}
            <text x="490" y="190" fontSize="10" fill={c.text}>Σ p·q = {f2(focus.dot)}</text>
            <text x="490" y="206" fontSize="9" fill={c.muted}>
              {useBias ? `+ (μ+b_u+b_i) = ${f2(focus.biasPart)}` : '无偏置项（pred = p·q）'}
            </text>
            <text x="490" y="222" fontSize="10" fill={c.primary}>pred = {f2(focus.pred)} · e = r − pred = {f2(focus.err)}</text>
            <text x="490" y="242" fontSize="9" fill={c.muted}>梯度下降：p ← p + lr·(e·q − λ·p)</text>
            <text x="490" y="258" fontSize="9" fill={c.text}>
              更新后 p_u = [{focus.pNew.slice(0, 4).map(f2).join(', ')}{focus.pNew.length > 4 ? ', …' : ''}]
            </text>
            <text x="490" y="276" fontSize="9" fill={c.muted}>第 {snap.epoch || 0} 轮 · 第 {snap.updateCount || 0} 次 SGD 更新</text>
          </g>
        )}

        <line x1="20" y1="292" x2={W - 20} y2="292" stroke={c.grid} strokeWidth="1" />
        <text x="20" y="308" fontSize="9" fill={c.muted}>
          预测 pred(u,i) = p_u·q_i{useBias ? ' + μ + b_u + b_i' : ''}；损失 L = ½(r−pred)² + λ/2·(‖p‖²+‖q‖²)
        </text>
        <text x="20" y="324" fontSize="9" fill={c.muted}>
          SGD 更新：p_u ← p_u + lr·(e·q_i − λ·p_u)，q_i ← q_i + lr·(e·p_u − λ·q_i)，e = r − pred
        </text>
        <text x="20" y="340" fontSize="9" fill={c.muted}>
          调大 lr / 轮数会加快下降，调大 λ 抑制过拟合，k 决定表达能力；种子改变评分与初始化。
        </text>
      </svg>
    );
  },
};
