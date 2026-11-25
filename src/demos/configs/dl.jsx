// 深度学习交互演示配置：由 scripts/generate-demos.mjs 注入 definitions/。
// 仅依赖 React、utils 与共享 SVG 原语；buildSteps 为确定性纯函数。
import React from 'react';
import { clamp, mulberry32, softmax } from '../utils.js';
import { Frame, fmt } from '../kits/primitives.jsx';

const S = (v, f = 0) => { const n = Number(v); return Number.isFinite(n) ? n : f; };
const C = (v, lo, hi, f = lo) => clamp(S(v, f), lo, hi);
const sig = (z) => 1 / (1 + Math.exp(-C(z, -30, 30)));
const th = (z) => Math.tanh(C(z, -30, 30));
const f2 = (v) => fmt(S(v), 2);
const f3 = (v) => fmt(S(v), 3);
const r2 = (v) => Number(S(v).toFixed(2));
const r3 = (v) => Number(S(v).toFixed(3));
const avg = (a) => (a && a.length ? a.reduce((s, v) => s + S(v), 0) / a.length : 0);
const varr = (a) => { const m = avg(a); return avg((a || []).map((v) => (S(v) - m) ** 2)); };
const gauss = (rnd) => {
  const u = Math.max(1e-9, rnd());
  return C(Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rnd()), -4, 4);
};
const normal = (seed, n, mu, sd) => {
  const rnd = mulberry32(seed);
  return Array.from({ length: n }, () => mu + sd * gauss(rnd));
};
const hist = (values, bins = 12, lo = -5, hi = 5) => {
  const out = new Array(bins).fill(0);
  (values || []).forEach((v) => {
    const k = Math.floor(((C(v, lo, hi) - lo) / (hi - lo)) * bins);
    out[C(k, 0, bins - 1)]++;
  });
  return out;
};
// 统一约束帧数：过多则等距抽样，过少则补细节帧（note 递增，画面不会全同）。
const fit = (steps, min = 20, max = 600) => {
  const arr = Array.isArray(steps) ? steps.slice() : [];
  if (arr.length > max) {
    const stride = Math.ceil(arr.length / max);
    const out = arr.filter((_, i) => i % stride === 0);
    const last = arr[arr.length - 1];
    if (out.length && out[out.length - 1] !== last) out.push(last);
    return out;
  }
  while (arr.length < min) {
    const last = arr[arr.length - 1] || { note: '准备开始' };
    arr.push({ ...last, note: `${String(last.note || '').slice(0, 52)}（细节 ${arr.length + 1}）`, focus: arr.length + 1 });
  }
  return arr;
};

const NoteLine = ({ c, text, y = 292 }) => (
  <text x="18" y={y} fontSize="10" fill={c.muted}>{String(text == null ? '' : text).slice(0, 78)}</text>
);
const Panel = ({ c, x, y, w, h, title, children }) => (
  <g>
    <rect x={x} y={y} width={w} height={h} rx="8" fill={c.panel} stroke={c.border} />
    {title ? <text x={x + 10} y={y + 16} fontSize="11" fill={c.muted}>{String(title)}</text> : null}
    {children}
  </g>
);
const BarRow = ({ c, values, x, y, w, h, maxV, colors, labels, showValues = true }) => {
  const arr = (values || []).map((v) => C(v, 0, 1e12));
  const n = Math.max(1, arr.length);
  const m = Math.max(1e-9, S(maxV, Math.max(1, ...arr)));
  const gap = 3;
  const bw = Math.max(2, (w - gap * (n - 1)) / n);
  return (
    <g>
      <line x1={x} y1={y + h} x2={x + w} y2={y + h} stroke={c.grid} />
      {arr.map((v, i) => {
        const bh = Math.max(1, (v / m) * h);
        const bx = x + i * (bw + gap);
        return (
          <g key={i}>
            <rect x={bx} y={y + h - bh} width={bw} height={bh} rx="2" fill={(colors && colors[i]) || c.primary} opacity="0.9" />
            {showValues ? <text x={bx + bw / 2} y={y + h - bh - 3} fontSize="8" textAnchor="middle" fill={c.muted}>{f2(v)}</text> : null}
            {labels ? <text x={bx + bw / 2} y={y + h + 11} fontSize="8" textAnchor="middle" fill={c.muted}>{String(labels[i])}</text> : null}
          </g>
        );
      })}
    </g>
  );
};
const LineChart = ({ c, points, x, y, w, h, min = 0, max = 1, color, dashed }) => {
  const arr = (points || []).map((v) => S(v));
  const lo = S(min), hi = Math.max(lo + 1e-9, S(max, lo + 1));
  const py = (v) => y + h - ((C(v, lo, hi) - lo) / (hi - lo)) * h;
  const px = (i) => x + (i / Math.max(1, arr.length - 1)) * w;
  const poly = arr.map((v, i) => `${px(i).toFixed(1)},${py(v).toFixed(1)}`).join(' ');
  return (
    <g>
      <line x1={x} y1={y + h} x2={x + w} y2={y + h} stroke={c.grid} />
      <line x1={x} y1={y} x2={x} y2={y + h} stroke={c.grid} />
      {arr.length > 1 ? <polyline points={poly} fill="none" stroke={color || c.primary} strokeWidth="2" strokeDasharray={dashed ? '4 3' : undefined} /> : null}
      {arr.length ? <circle cx={px(arr.length - 1)} cy={py(arr[arr.length - 1])} r="3" fill={color || c.primary} /> : null}
    </g>
  );
};

const CONFIGS = {
  perceptron: {
    params: [
      { key: 'lr', label: '学习率 η', type: 'range', min: 0.05, max: 1, step: 0.05, default: 0.2 },
      { key: 'iters', label: '样本更新次数', type: 'range', min: 20, max: 300, step: 10, default: 120 },
      { key: 'initAngle', label: '初始分界线角度', type: 'range', min: -170, max: 170, step: 10, default: 40 },
      { key: 'noise', label: '标签噪声', type: 'toggle', default: false, hint: '每 7 个样本翻转一次标签，观察线性不可分时的震荡' },
    ],
    height: 300,
    legend: [{ label: '+1 类样本' }, { label: '-1 类样本' }, { label: '误分类' }, { label: '当前分界线' }, { label: '准确率' }],
    hint: '感知机逐样本检查：分类正确不动，分错就按 w ← w + η·y·x 把分界线往正确一侧旋转。',

    buildSteps(p) {
      const lr = C(p.lr, 0.05, 1, 0.2);
      const iters = Math.round(C(p.iters, 20, 300, 120));
      const ang = C(p.initAngle, -170, 170, 40) * Math.PI / 180;
      const noise = !!p.noise;
      const rnd = mulberry32(731);
      const data = [];
      for (let k = 0; k < 34; k++) {
        const x = (rnd() - 0.5) * 8.2, y = (rnd() - 0.5) * 8.2;
        const score = 1.1 * x + 0.7 * y - 0.35;
        if (Math.abs(score) < 0.4) continue;
        const label = score >= 0 ? 1 : -1;
        data.push({ x, y, label: noise && data.length % 7 === 0 ? -label : label });
      }
      let w = [Math.cos(ang), Math.sin(ang)], b = 0, updates = 0, idx = 0;
      const predsOf = () => data.map((q) => ((w[0] * q.x + w[1] * q.y + b) >= 0 ? 1 : -1));
      const accOf = (preds) => (data.length ? preds.filter((pp, i) => pp === data[i].label).length / data.length : 0);
      const frames = [];
      const accHist = [];
      const firstPreds = predsOf();
      accHist.push(accOf(firstPreds));
      frames.push({
        note: `初始化：w=(${f2(w[0])}, ${f2(w[1])})，b=0，分界线由角度 ${f2(ang * 180 / Math.PI)}° 决定。`,
        w: w.slice(), b, data, pred: firstPreds, acc: accOf(firstPreds), focus: -1, hist: accHist.slice(),
        metrics: { 样本更新: 0, 累计修正: 0, 学习率: lr, 准确率: Math.round(accOf(firstPreds) * 100) },
      });
      for (let t = 1; t <= iters; t++) {
        const q = data[idx % data.length];
        const pred = (w[0] * q.x + w[1] * q.y + b) >= 0 ? 1 : -1;
        let msg;
        if (pred === q.label) {
          msg = '分类正确，参数保持不变';
        } else {
          w = [w[0] + lr * q.label * q.x, w[1] + lr * q.label * q.y];
          b += lr * q.label;
          updates++;
          msg = '分错，执行 w ← w + η·y·x 旋转分界线';
        }
        idx++;
        const preds = predsOf(), acc = accOf(preds);
        accHist.push(acc);
        frames.push({
          note: `第 ${t} 次样本 (${f2(q.x)}, ${f2(q.y)})，真实标签 ${q.label > 0 ? '+1' : '-1'}：${msg}；当前准确率 ${f2(acc * 100)}%。`,
          w: w.slice(), b, data, pred: preds, acc, focus: (idx - 1) % data.length, hist: accHist.slice(),
          metrics: { 样本更新: t, 累计修正: updates, 学习率: lr, 准确率: Math.round(acc * 100) },
        });
      }
      return fit(frames);
    },

    render(snap, p, c) {
      const H = 300;
      const data = snap.data || [];
      const pred = snap.pred || [];
      const w = [(snap.w || [])[0] || 1, (snap.w || [])[1] || 0];
      const b = S(snap.b);
      const focus = Math.round(S(snap.focus, -1));
      const x0 = 20, y0 = 36, pw = 430, ph = 230;
      const px = (v) => x0 + ((C(v, -4.5, 4.5) + 4.5) / 9) * pw;
      const py = (v) => y0 + ph - ((C(v, -4.5, 4.5) + 4.5) / 9) * ph;
      const n2 = Math.max(1e-6, w[0] * w[0] + w[1] * w[1]);
      const ox = -b * w[0] / n2, oy = -b * w[1] / n2;
      const dx = -w[1], dy = w[0];
      const line = `M${px(ox - 12 * dx).toFixed(1)},${py(oy - 12 * dy).toFixed(1)} L${px(ox + 12 * dx).toFixed(1)},${py(oy + 12 * dy).toFixed(1)}`;
      const points = data.map((q, i) => {
        const wrong = pred[i] !== q.label;
        return (
          <g key={i}>
            {i === focus ? <circle cx={px(q.x)} cy={py(q.y)} r="8" fill="none" stroke={c.warning} strokeWidth="2" /> : null}
            <circle cx={px(q.x)} cy={py(q.y)} r={wrong ? 5 : 4} fill={wrong ? c.warning : q.label > 0 ? c.series[0] : c.series[1]}
              stroke={wrong ? c.danger : c.bg} strokeWidth={wrong ? 1.5 : 0.8} />
          </g>
        );
      });
      return (
        <Frame c={c} height={H} title="感知机 · 分界线随误分类更新" subtitle={`w=(${f2(w[0])}, ${f2(w[1])}) · b=${f2(b)}`}>
          <defs><clipPath id="perc-clip"><rect x={x0} y={y0} width={pw} height={ph} /></clipPath></defs>
          <Panel c={c} x={x0} y={y0} w={pw} h={ph} title="样本平面 · w·x+b=0">
            <g clipPath="url(#perc-clip)">
              <line x1={px(-4.5)} y1={py(0)} x2={px(4.5)} y2={py(0)} stroke={c.grid} />
              <line x1={px(0)} y1={py(-4.5)} x2={px(0)} y2={py(4.5)} stroke={c.grid} />
              <path d={line} fill="none" stroke={c.primary} strokeWidth="2.5" />
              {points}
            </g>
          </Panel>
          <Panel c={c} x={466} y={y0} w={236} h={ph} title="分类准确率">
            <LineChart c={c} points={(snap.hist || []).length ? snap.hist : [S(snap.acc)]} x={480} y={54} w={208} h={150} min={0} max={1} color={c.success} />
            <text x="480" y="228" fontSize="11" fill={c.muted}>当前正确率</text>
            <text x="690" y="228" fontSize="13" textAnchor="end" fill={c.success}>{f2(S(snap.acc) * 100)}%</text>
            <text x="480" y="248" fontSize="10" fill={c.muted}>误分类样本用橙色标出</text>
          </Panel>
          <NoteLine c={c} text={snap.note} y={292} />
        </Frame>
      );
    },
  },

  'sgd-momentum': {
    params: [
      { key: 'lr', label: '学习率 η', type: 'range', min: 0.01, max: 0.4, step: 0.01, default: 0.06 },
      { key: 'beta', label: '动量系数 β', type: 'range', min: 0, max: 0.99, step: 0.01, default: 0.9 },
      { key: 'iters', label: '迭代次数', type: 'range', min: 20, max: 300, step: 10, default: 140 },
      { key: 'noise', label: '随机梯度噪声', type: 'toggle', default: false, hint: '模拟 mini-batch 抖动，观察惯性如何平滑' },
    ],
    height: 320,
    legend: [{ label: '损失等高线' }, { label: '参数轨迹' }, { label: '速度向量' }, { label: '损失曲线' }],
    hint: '动量用速度 v ← βv − η∇L 累积历史梯度：震荡方向相互抵消，平坦方向持续加速。',

    buildSteps(p) {
      const lr = C(p.lr, 0.01, 0.4, 0.06);
      const beta = C(p.beta, 0, 0.99, 0.9);
      const iters = Math.round(C(p.iters, 20, 300, 140));
      const noise = !!p.noise;
      let a = 3.2, bb = 2.6, va = 0, vb = 0;
      const path = [{ a, b: bb }], hist = [0.5 * (a * a + 12 * bb * bb)];
      const frames = [{
        note: `初始化 w=(${f2(a)}, ${f2(bb)})，v=0。损失 L=½(w₁²+12w₂²) 是扁长椭圆。`,
        a, b: bb, va, vb, path: path.slice(), hist: hist.slice(), grad: [a, 12 * bb],
        metrics: { 迭代: 0, 损失: r2(hist[0]), 速度模: 0, 学习率: lr, 动量: beta },
      }];
      for (let t = 1; t <= iters; t++) {
        const jitter = noise ? 0.35 * Math.sin(t * 2.7) : 0;
        const ga = a + jitter, gb = 12 * bb - jitter * 0.5;
        va = beta * va - lr * ga;
        vb = beta * vb - lr * gb;
        a = C(a + va, -12, 12, 0);
        bb = C(bb + vb, -12, 12, 0);
        const loss = 0.5 * (a * a + 12 * bb * bb);
        path.push({ a, b: bb });
        hist.push(loss);
        const vm = Math.sqrt(va * va + vb * vb);
        frames.push({
          note: `第 ${t} 步：梯度=(${f2(ga)}, ${f2(gb)})，速度 v=(${f3(va)}, ${f3(vb)})，w=(${f2(a)}, ${f2(bb)})，损失 ${f2(loss)}。`,
          a, b: bb, va, vb, path: path.slice(), hist: hist.slice(), grad: [ga, gb],
          metrics: { 迭代: t, 损失: r2(loss), 速度模: r3(vm), 学习率: lr, 动量: beta },
        });
      }
      return fit(frames);
    },

    render(snap, p, c) {
      const H = 320;
      const path = snap.path || [];
      const hist = snap.hist || [];
      const a = S(snap.a, 3), b2 = S(snap.b, 2.6);
      const va = S(snap.va), vb = S(snap.vb);
      const x0 = 20, y0 = 36, pw = 420, ph = 244;
      const R = 4.2;
      const px = (v) => x0 + ((C(v, -R, R) + R) / (2 * R)) * pw;
      const py = (v) => y0 + ph - ((C(v, -R, R) + R) / (2 * R)) * ph;
      const cx = px(0), cy = py(0);
      const levels = [1, 4, 9, 18, 32, 55];
      const ellipses = levels.map((L) => ({
        rx: (Math.sqrt(2 * L) / (2 * R)) * pw,
        ry: (Math.sqrt(2 * L / 12) / (2 * R)) * ph,
      }));
      const dp = path.map((q, i) => `${i === 0 ? 'M' : 'L'}${px(q.a).toFixed(1)},${py(q.b).toFixed(1)}`).join(' ');
      const vx = px(a + C(va * 6, -2, 2)), vy = py(b2 + C(vb * 6, -2, 2));
      return (
        <Frame c={c} height={H} title="SGD + 动量 · 参数轨迹与速度" subtitle={`β=${f2(S(p.beta, 0.9))} · η=${f2(S(p.lr, 0.06))}`}>
          <defs><clipPath id="mom-clip"><rect x={x0} y={y0} width={pw} height={ph} /></clipPath></defs>
          <Panel c={c} x={x0} y={y0} w={pw} h={ph} title="参数平面 · 等高线">
            <g clipPath="url(#mom-clip)">
              {ellipses.map((e, i) => <ellipse key={i} cx={cx} cy={cy} rx={e.rx} ry={e.ry} fill="none"
                stroke={i % 2 ? c.border : c.grid} strokeWidth="1" />)}
              <circle cx={cx} cy={cy} r="3" fill={c.success} />
              {path.length > 1 ? <path d={dp} fill="none" stroke={c.primary} strokeWidth="2" strokeLinejoin="round" /> : null}
              <line x1={px(a)} y1={py(b2)} x2={vx} y2={vy} stroke={c.warning} strokeWidth="2.5" />
              <circle cx={vx} cy={vy} r="3" fill={c.warning} />
              <circle cx={px(a)} cy={py(b2)} r="5" fill={c.danger} stroke={c.bg} strokeWidth="1.5" />
            </g>
          </Panel>
          <Panel c={c} x={456} y={y0} w={246} h={ph} title="损失收敛">
            <LineChart c={c} points={hist} x={470} y={56} w={218} h={150} min={0} max={Math.max(20, hist[0] || 20)} color={c.primary} />
            <text x="470" y="226" fontSize="11" fill={c.muted}>当前损失</text>
            <text x="690" y="226" fontSize="12" textAnchor="end" fill={c.text}>{f2(hist[hist.length - 1])}</text>
            <text x="470" y="246" fontSize="11" fill={c.muted}>速度 |v|</text>
            <text x="690" y="246" fontSize="12" textAnchor="end" fill={c.warning}>{f3(Math.sqrt(va * va + vb * vb))}</text>
            <text x="470" y="266" fontSize="10" fill={c.muted}>橙色箭头为本步更新方向</text>
          </Panel>
          <NoteLine c={c} text={snap.note} y={310} />
        </Frame>
      );
    },
  },

  adam: {
    params: [
      { key: 'lr', label: '学习率 α', type: 'range', min: 0.01, max: 0.5, step: 0.01, default: 0.12 },
      { key: 'beta1', label: 'β₁（一阶矩）', type: 'range', min: 0.5, max: 0.99, step: 0.01, default: 0.9 },
      { key: 'beta2', label: 'β₂（二阶矩）', type: 'range', min: 0.9, max: 0.999, step: 0.001, default: 0.999 },
      { key: 'iters', label: '迭代次数', type: 'range', min: 20, max: 300, step: 10, default: 140 },
    ],
    height: 320,
    legend: [{ label: '损失等高线' }, { label: '一阶矩 m̂' }, { label: '二阶矩 v̂' }, { label: '参数轨迹' }],
    hint: 'Adam 同时维护梯度均值 m 与平方均值 v，偏差校正后按 α·m̂/(√v̂+ε) 为每个参数单独缩放步长。',

    buildSteps(p) {
      const lr = C(p.lr, 0.01, 0.5, 0.12);
      const b1 = C(p.beta1, 0.5, 0.99, 0.9);
      const b2 = C(p.beta2, 0.9, 0.999, 0.999);
      const iters = Math.round(C(p.iters, 20, 300, 140));
      let a = 3.0, bb = 2.4, m1 = 0, m2 = 0, v1 = 0, v2 = 0;
      const path = [{ a, b: bb }], hist = [0.5 * (a * a + 12 * bb * bb)];
      const frame = (t, note, extra) => ({
        note, a, b: bb, m1, m2, v1, v2, path: path.slice(), hist: hist.slice(),
        metrics: { 迭代: t, 损失: r2(hist[hist.length - 1]), 学习率: lr, 一阶矩模: r3(Math.sqrt(m1 * m1 + m2 * m2)) },
        ...(extra || {}),
      });
      const frames = [frame(0, `初始化 Adam：m=v=0，β₁=${f2(b1)}，β₂=${f3(b2)}，先用偏差校正消除初期估计偏差。`, { mhat: [0, 0], vhat: [0, 0], step: [0, 0] })];
      for (let t = 1; t <= iters; t++) {
        const g1 = a, g2 = 12 * bb;
        m1 = b1 * m1 + (1 - b1) * g1;
        m2 = b1 * m2 + (1 - b1) * g2;
        v1 = b2 * v1 + (1 - b2) * g1 * g1;
        v2 = b2 * v2 + (1 - b2) * g2 * g2;
        const mh1 = m1 / (1 - Math.pow(b1, t)), mh2 = m2 / (1 - Math.pow(b1, t));
        const vh1 = v1 / (1 - Math.pow(b2, t)), vh2 = v2 / (1 - Math.pow(b2, t));
        const s1 = lr * mh1 / (Math.sqrt(Math.max(0, vh1)) + 1e-8);
        const s2 = lr * mh2 / (Math.sqrt(Math.max(0, vh2)) + 1e-8);
        a = C(a - s1, -12, 12, 0);
        bb = C(bb - s2, -12, 12, 0);
        const loss = 0.5 * (a * a + 12 * bb * bb);
        path.push({ a, b: bb });
        hist.push(loss);
        frames.push(frame(t,
          `第 ${t} 步：g=(${f2(g1)}, ${f2(g2)})，m̂=(${f3(mh1)}, ${f3(mh2)})，v̂=(${f3(vh1)}, ${f3(vh2)})，自适应步长=(${f3(s1)}, ${f3(s2)})。`,
          { mhat: [mh1, mh2], vhat: [vh1, vh2], step: [s1, s2], grad: [g1, g2] }));
      }
      return fit(frames);
    },

    render(snap, p, c) {
      const H = 320;
      const path = snap.path || [], hist = snap.hist || [];
      const a = S(snap.a, 3), b2 = S(snap.b, 2.4);
      const mhat = snap.mhat || [0, 0], vhat = snap.vhat || [0, 0], step = snap.step || [0, 0];
      const x0 = 20, y0 = 36, pw = 400, ph = 244, R = 4.2;
      const px = (v) => x0 + ((C(v, -R, R) + R) / (2 * R)) * pw;
      const py = (v) => y0 + ph - ((C(v, -R, R) + R) / (2 * R)) * ph;
      const cx = px(0), cy = py(0);
      const dp = path.map((q, i) => `${i === 0 ? 'M' : 'L'}${px(q.a).toFixed(1)},${py(q.b).toFixed(1)}`).join(' ');
      const mScale = Math.max(1e-6, Math.abs(mhat[0]), Math.abs(mhat[1]));
      const vScale = Math.max(1e-6, Math.abs(vhat[0]), Math.abs(vhat[1]));
      const sScale = Math.max(1e-6, Math.abs(step[0]), Math.abs(step[1]));
      return (
        <Frame c={c} height={H} title="Adam · 一阶/二阶矩与自适应步长" subtitle={`α=${f2(S(p.lr, 0.12))} · β₁=${f2(S(p.beta1, 0.9))} · β₂=${f3(S(p.beta2, 0.999))}`}>
          <defs><clipPath id="adam-clip"><rect x={x0} y={y0} width={pw} height={ph} /></clipPath></defs>
          <Panel c={c} x={x0} y={y0} w={pw} h={ph} title="参数轨迹 · w₁ 横向 / w₂ 纵向">
            <g clipPath="url(#adam-clip)">
              {[4, 16, 40, 80].map((L, i) => <ellipse key={i} cx={cx} cy={cy}
                rx={(Math.sqrt(2 * L) / (2 * R)) * pw} ry={(Math.sqrt(2 * L / 12) / (2 * R)) * ph}
                fill="none" stroke={i % 2 ? c.border : c.grid} />)}
              <circle cx={cx} cy={cy} r="3" fill={c.success} />
              {path.length > 1 ? <path d={dp} fill="none" stroke={c.purple} strokeWidth="2" /> : null}
              <circle cx={px(a)} cy={py(b2)} r="5" fill={c.danger} stroke={c.bg} strokeWidth="1.5" />
            </g>
          </Panel>
          <Panel c={c} x={436} y={y0} w={266} h={ph} title="矩估计 / 有效步长">
            <text x="450" y="62" fontSize="10" fill={c.muted}>|m̂| （一阶矩 · 方向）</text>
            <BarRow c={c} values={mhat.map(Math.abs)} x={450} y={70} w={236} h={34} maxV={mScale} colors={[c.primary, c.purple]} showValues={false} />
            <text x="450" y="124" fontSize="10" fill={c.muted}>|v̂| （二阶矩 · 尺度）</text>
            <BarRow c={c} values={vhat.map(Math.abs)} x={450} y={132} w={236} h={34} maxV={vScale} colors={[c.warning, c.success]} showValues={false} />
            <text x="450" y="186" fontSize="10" fill={c.muted}>有效步长 α·m̂/(√v̂+ε)</text>
            <BarRow c={c} values={step.map(Math.abs)} x={450} y={194} w={236} h={34} maxV={sScale} colors={[c.danger, c.teal]} showValues={false} />
            <text x="450" y="252" fontSize="10" fill={c.muted}>w₁ / w₂ 两个参数分别自适应</text>
            <text x="450" y="270" fontSize="10" fill={c.text}>损失 {f2(hist[hist.length - 1])} · 迭代 {String(path.length - 1)}</text>
          </Panel>
          <NoteLine c={c} text={snap.note} y={310} />
        </Frame>
      );
    },
  },

  'batch-norm': {
    params: [
      { key: 'batch', label: '批大小', type: 'range', min: 4, max: 64, step: 4, default: 16 },
      { key: 'drift', label: '分布漂移强度', type: 'range', min: 0, max: 1, step: 0.1, default: 0.5 },
      { key: 'gamma', label: '缩放 γ', type: 'range', min: 0.5, max: 2, step: 0.1, default: 1 },
      { key: 'steps', label: '批次数', type: 'range', min: 20, max: 120, step: 10, default: 50 },
    ],
    height: 320,
    legend: [{ label: '归一化前分布' }, { label: '归一化后分布' }, { label: '滑动均值' }, { label: '标准化区间' }],
    hint: 'BatchNorm 在每个 batch 内做 (x−μ_B)/√(σ_B²+ε) 再乘 γ：不管上游分布怎么漂移，输出都稳定在 0 均值、1 方差附近。',

    buildSteps(p) {
      const bs = Math.round(C(p.batch, 4, 64, 16));
      const drift = C(p.drift, 0, 1, 0.5);
      const gamma = C(p.gamma, 0.5, 2, 1);
      const steps = Math.round(C(p.steps, 20, 120, 50));
      let rm = 0, rv = 1;
      const frames = [];
      for (let t = 1; t <= steps; t++) {
        const mu = -1.4 + drift * 2.8 * Math.sin(t * 0.13);
        const sd = 0.7 + drift * 0.55 * (0.5 + 0.5 * Math.sin(t * 0.07 + 1));
        const vals = normal(9137 + t * 131, bs, mu, sd);
        const m = avg(vals), v = varr(vals);
        const normed = vals.map((z) => gamma * (z - m) / Math.sqrt(v + 1e-5));
        rm = 0.9 * rm + 0.1 * m;
        rv = 0.9 * rv + 0.1 * v;
        const nm = avg(normed), nv = varr(normed);
        frames.push({
          note: `第 ${t} 批（size=${bs}）：原始均值 ${f2(m)}、方差 ${f2(v)}；减均值除标准差后均值 ${f2(nm)}、方差 ${f2(nv)}，滑动均值 ${f2(rm)}。`,
          t, vals, normed, rawHist: hist(vals, 12, -6, 6), normHist: hist(normed, 12, -6, 6),
          m, v, nm, nv, rm, rv,
          metrics: { 批次: t, 批大小: bs, 原始均值: r2(m), 原始方差: r2(v), 归一化方差: r2(nv) },
        });
      }
      return fit(frames);
    },

    render(snap, p, c) {
      const H = 320;
      const raw = snap.rawHist || new Array(12).fill(0);
      const nor = snap.normHist || new Array(12).fill(0);
      const x0 = 20, y0 = 38, pw = 330, ph = 236;
      const x1 = 370;
      const maxCount = Math.max(1, ...raw, ...nor);
      return (
        <Frame c={c} height={H} title="Batch Normalization · 批次内归一化" subtitle={`batch=${String(snap.batch || 16)} · γ=${f2(S(p.gamma, 1))}`}>
          <Panel c={c} x={x0} y={y0} w={pw} h={ph} title="归一化前 · 激活分布漂移">
            <BarRow c={c} values={raw} x={x0 + 12} y={y0 + 24} w={pw - 24} h={ph - 60} maxV={maxCount}
              colors={raw.map((_, i) => c.series[i % c.series.length])} showValues={false} />
            <text x={x0 + 12} y={y0 + ph - 14} fontSize="10" fill={c.muted}>μ_B = {f2(snap.m)} · σ_B² = {f2(snap.v)}</text>
          </Panel>
          <Panel c={c} x={x1} y={y0} w={330} h={ph} title="归一化后 · 稳定在 0 附近">
            <BarRow c={c} values={nor} x={x1 + 12} y={y0 + 24} w={306} h={ph - 60} maxV={maxCount}
              colors={nor.map((_, i) => c.series[(i + 2) % c.series.length])} showValues={false} />
            <text x={x1 + 12} y={y0 + ph - 14} fontSize="10" fill={c.muted}>μ = {f2(snap.nm)} · σ² = {f2(snap.nv)}</text>
          </Panel>
          <text x="20" y="292" fontSize="10" fill={c.muted}>滑动统计：running μ = {f2(snap.rm)} · running σ² = {f2(snap.rv)} · 批大小 {String(snap.batch || 16)}</text>
          <NoteLine c={c} text={snap.note} y={308} />
        </Frame>
      );
    },
  },

  'layer-norm': {
    params: [
      { key: 'features', label: '特征维度 d', type: 'range', min: 4, max: 12, step: 2, default: 8 },
      { key: 'drift', label: '样本间差异', type: 'range', min: 0, max: 1, step: 0.1, default: 0.6 },
      { key: 'gamma', label: '缩放 γ', type: 'range', min: 0.5, max: 2, step: 0.1, default: 1 },
      { key: 'steps', label: '步数', type: 'range', min: 20, max: 120, step: 10, default: 50 },
    ],
    height: 300,
    legend: [{ label: '样本 A 特征' }, { label: '样本 B 特征' }, { label: '归一化后' }, { label: '逐样本统计' }],
    hint: 'LayerNorm 对每条样本自己的全部特征做标准化，不跨 batch：同一个 batch 里两个样本各有自己的 μ 与 σ。',

    buildSteps(p) {
      const d = Math.round(C(p.features, 4, 12, 8));
      const drift = C(p.drift, 0, 1, 0.6);
      const gamma = C(p.gamma, 0.5, 2, 1);
      const steps = Math.round(C(p.steps, 20, 120, 50));
      const frames = [];
      for (let t = 1; t <= steps; t++) {
        const base = Math.sin(t * 0.11);
        const a = normal(4421 + t * 71, d, -1.5 + drift * 2.6 * base, 0.55 + drift * 0.4);
        const b = normal(8819 + t * 53, d, 1.2 - drift * 2.1 * base, 0.8 + drift * 0.3);
        const ma = avg(a), mb = avg(b), va = varr(a), vb = varr(b);
        const na = a.map((z) => gamma * (z - ma) / Math.sqrt(va + 1e-5));
        const nb = b.map((z) => gamma * (z - mb) / Math.sqrt(vb + 1e-5));
        frames.push({
          note: `第 ${t} 步·逐样本归一化：A 的 μ=${f2(ma)}, σ²=${f2(va)}；B 的 μ=${f2(mb)}, σ²=${f2(vb)}。两条样本各算各的统计量，互不影响。`,
          t, a, b, na, nb, ma, mb, va, vb,
          metrics: { 步数: t, 特征数: d, 样本A均值: r2(ma), 样本B均值: r2(mb), 样本A方差: r2(va) },
        });
      }
      return fit(frames);
    },

    render(snap, p, c) {
      const H = 300;
      const a = snap.a || [], b = snap.b || [], na = snap.na || [], nb = snap.nb || [];
      const labelsA = a.map((_, i) => `f${i + 1}`);
      return (
        <Frame c={c} height={H} title="Layer Normalization · 单样本内归一化" subtitle={`d=${String(a.length)} · γ=${f2(S(p.gamma, 1))}`}>
          <Panel c={c} x={20} y={38} w={330} h={212} title="归一化前 · 两条样本均值不同">
            <text x="32" y="72" fontSize="10" fill={c.muted}>样本 A</text>
            <BarRow c={c} values={a} x={32} y={80} w={300} h={50} maxV={5} colors={a.map(() => c.primary)} labels={labelsA} showValues={false} />
            <text x="32" y="158" fontSize="10" fill={c.muted}>样本 B</text>
            <BarRow c={c} values={b} x={32} y={166} w={300} h={50} maxV={5} colors={b.map(() => c.purple)} labels={labelsA} showValues={false} />
          </Panel>
          <Panel c={c} x={370} y={38} w={330} h={212} title="归一化后 · 各自均值 0 方差 1">
            <text x="382" y="72" fontSize="10" fill={c.muted}>样本 A · μ={f2(snap.ma)}</text>
            <BarRow c={c} values={na} x={382} y={80} w={300} h={50} maxV={4} colors={na.map(() => c.success)} labels={labelsA} showValues={false} />
            <text x="382" y="158" fontSize="10" fill={c.muted}>样本 B · μ={f2(snap.mb)}</text>
            <BarRow c={c} values={nb} x={382} y={166} w={300} h={50} maxV={4} colors={nb.map(() => c.teal)} labels={labelsA} showValues={false} />
          </Panel>
          <text x="20" y="270" fontSize="10" fill={c.muted}>σ²(A)={f2(snap.va)} · σ²(B)={f2(snap.vb)} · 不依赖 batch 大小，Transformer 常用 Pre-LN</text>
          <NoteLine c={c} text={snap.note} y={288} />
        </Frame>
      );
    },
  },

  dropout: {
    params: [
      { key: 'rate', label: '丢弃率 p', type: 'range', min: 0, max: 0.8, step: 0.1, default: 0.5 },
      { key: 'iters', label: '迭代次数', type: 'range', min: 20, max: 200, step: 10, default: 60 },
      { key: 'scale', label: '推理时缩放 1/(1−p)', type: 'toggle', default: true, hint: '关闭可见未缩放时输出期望偏小' },
    ],
    height: 320,
    legend: [{ label: '保留神经元' }, { label: '被屏蔽神经元' }, { label: '保留比例历史' }, { label: '输出' }],
    hint: '每次迭代独立掷硬币屏蔽神经元，训练相当于采样多个子网络；推理时按 1/(1−p) 缩放可保持输出期望不变。',

    buildSteps(p) {
      const rate = C(p.rate, 0, 0.8, 0.5);
      const iters = Math.round(C(p.iters, 20, 200, 60));
      const scale = !!p.scale;
      const rnd = mulberry32(20260719);
      const sizes = [4, 6, 6, 3];
      const keepRatio = 1 - rate;
      const frames = [];
      let sumOut = 0;
      for (let t = 1; t <= iters; t++) {
        const masks = sizes.map((n, li) => (li === 0 ? Array(n).fill(true)
          : Array.from({ length: n }, () => rnd() >= rate)));
        const kept = masks.reduce((s, row) => s + row.filter(Boolean).length, 0);
        const factor = scale ? 1 / Math.max(0.2, keepRatio) : 1;
        let out = 0;
        for (let i = 0; i < sizes[3]; i++) {
          const prev = masks[2].map((on, k) => (on ? 0.4 + 0.12 * k + 0.05 * Math.sin(k + t) : 0));
          out += factor * avg(prev) * (0.8 + 0.1 * i);
        }
        out = C(out, 0, 20, 0);
        sumOut += out;
        frames.push({
          note: `迭代 ${t}：按 p=${f2(rate)} 独立屏蔽，本次保留 ${kept}/19 个神经元，${scale ? '推理乘 1/(1−p) 保持期望' : '不做缩放时输出期望变小'}；输出 ${f2(out)}。`,
          t, masks, sizes, kept, out, factor, scale, avgOut: sumOut / t,
          history: frames.slice(-18).map((f) => f.kept).concat(kept),
          metrics: { 迭代: t, 丢弃率: rate, 保留神经元: kept, 缩放因子: r2(factor), 输出均值: r3(sumOut / t) },
        });
      }
      return fit(frames);
    },

    render(snap, p, c) {
      const H = 320;
      const sizes = snap.sizes || [4, 6, 6, 3];
      const masks = snap.masks || sizes.map(() => []);
      const history = snap.history || [];
      const xs = [96, 248, 400, 552];
      const cy = 150;
      const cols = sizes.map((n, li) => (
        <g key={li}>
          <text x={xs[li]} y="52" fontSize="11" textAnchor="middle" fill={c.muted}>{li === 0 ? '输入' : li === 3 ? '输出' : `隐层 ${li}`}</text>
          {Array.from({ length: n }, (_, i) => {
            const on = masks[li] ? masks[li][i] !== false : true;
            const y = cy + (i - (n - 1) / 2) * 38;
            return (
              <g key={i}>
                <circle cx={xs[li]} cy={y} r="13" fill={on ? c.primary : c.panel2}
                  stroke={on ? c.success : c.border} strokeWidth={on ? 2 : 1.5}
                  strokeDasharray={on ? undefined : '3 2'} opacity={on ? 0.95 : 0.6} />
                <text x={xs[li]} y={y + 3} fontSize="9" textAnchor="middle" fill={on ? c.bg : c.muted}>{on ? String(i + 1) : '×'}</text>
              </g>
            );
          })}
        </g>
      ));
      return (
        <Frame c={c} height={H} title="Dropout · 每次迭代随机屏蔽神经元" subtitle={`p=${f2(S(p.rate, 0.5))} · 缩放=${snap.scale ? '开' : '关'} · 迭代 ${String(snap.t || 0)}`}>
          {cols}
          <Panel c={c} x={20} y={228} w={430} h={64} title="最近 18 次保留神经元数">
            <BarRow c={c} values={history} x={32} y={244} w={406} h={34} maxV={19} colors={history.map(() => c.teal)} showValues={false} />
          </Panel>
          <Panel c={c} x={466} y={228} w={236} h={64} title="输出期望">
            <text x="480" y="262" fontSize="11" fill={c.muted}>本步 {f2(snap.out)} · 均值 {f2(snap.avgOut)}</text>
            <text x="480" y="280" fontSize="10" fill={c.muted}>因子 {f2(snap.factor)} · 保留 {String(snap.kept || 0)}/19</text>
          </Panel>
          <NoteLine c={c} text={snap.note} y={310} />
        </Frame>
      );
    },
  },

  rnn: {
    params: [
      { key: 'seqLen', label: '时间步 T', type: 'range', min: 8, max: 16, step: 1, default: 10 },
      { key: 'signalPos', label: '首个脉冲位置', type: 'range', min: 1, max: 14, step: 1, default: 3 },
      { key: 'lr', label: '学习率 η', type: 'range', min: 0.05, max: 0.5, step: 0.05, default: 0.2 },
      { key: 'leaky', label: '循环权重 > 1（梯度爆炸）', type: 'toggle', default: false },
    ],
    height: 340,
    legend: [{ label: '输入 token' }, { label: '隐藏状态 h_t' }, { label: '梯度幅度' }, { label: '当前时间步' }],
    hint: 'RNN 把隐藏状态沿时间步反复乘同一个 W：远距离信号要么被 tanh 压没（梯度消失），要么被放大（梯度爆炸）。',

    buildSteps(p) {
      const T = Math.round(C(p.seqLen, 8, 16, 10));
      const lr = C(p.lr, 0.05, 0.5, 0.2);
      const pos = Math.min(Math.round(C(p.signalPos, 1, 14, 3)), T - 2);
      const leaky = !!p.leaky;
      const W = leaky ? 1.15 : 0.85;
      const xs = Array.from({ length: T }, (_, i) => (i === pos || i === T - 1 ? 1 : 0));
      let h = 0;
      const hs = [0], ys = [];
      const gradsOf = () => {
        const g = new Array(T).fill(0);
        g[T - 1] = 1;
        for (let i = T - 2; i >= 0; i--) g[i] = Math.min(1e6, g[i + 1] * W * (1 - th(hs[i + 1]) ** 2));
        return g;
      };
      const base = { xs, hs: [0], ys: [], grads: gradsOf(), t: 0, phase: 'intro', W };
      const frames = [
        { ...base, note: `RNN 沿时间展开 ${T} 步，循环权重 W=${r2(W)}${leaky ? '（>1，梯度会放大）' : '（<1，梯度会衰减）'}。`, metrics: { 时间步: 0, 序列长度: T, 隐藏状态: 0, 输出: 0, 学习率: lr } },
        { ...base, note: `每个时间步：h_t = tanh(W·h_{t−1} + V·x_t + b)，输出 y_t = σ(2.5·h_t)。`, metrics: { 时间步: 0, 序列长度: T, 隐藏状态: 0, 输出: 0, 学习率: lr } },
        { ...base, note: `输入在第 ${pos + 1} 与第 ${T} 步各有一个脉冲 1，其余为 0，检验能否记住长距离信号。`, metrics: { 时间步: 0, 序列长度: T, 隐藏状态: 0, 输出: 0, 学习率: lr } },
      ];
      for (let t = 0; t < T; t++) {
        h = th(W * h + 0.9 * xs[t] - 0.1);
        hs.push(h);
        const y = sig(2.5 * h);
        ys.push(y);
        const grads = gradsOf();
        frames.push({
          xs, hs: hs.slice(), ys: ys.slice(), grads, t: t + 1, phase: 'forward', W,
          note: `第 ${t + 1}/${T} 步·前向：x=${xs[t]}，h=${f3(h)}，y=${f3(y)}；隐藏状态被写入计算图。`,
          metrics: { 时间步: t + 1, 序列长度: T, 隐藏状态: r3(h), 输出: r3(y), 学习率: lr },
        });
        frames.push({
          xs, hs: hs.slice(), ys: ys.slice(), grads, t: t + 1, phase: 'back', W,
          note: `第 ${t + 1}/${T} 步·反向：∂L/∂h₁ 通过 ${t + 1} 次连乘衰减到 ${f3(grads[0])}，早期信号${grads[0] < 0.05 ? '几乎消失' : '仍可回传'}。`,
          metrics: { 时间步: t + 1, 序列长度: T, 隐藏状态: r3(h), 输出: r3(y), 首步梯度: r3(grads[0]) },
        });
      }
      frames.push({
        ...frames[frames.length - 1], phase: 'done',
        note: `展开完成：末端输出 ${f3(ys[ys.length - 1])}，首步梯度 ${f3(gradsOf()[0])}。LSTM/GRU 用门控与加法路径缓解这个问题。`,
        metrics: { 时间步: T, 序列长度: T, 隐藏状态: r3(hs[hs.length - 1]), 输出: r3(ys[ys.length - 1]), 首步梯度: r3(gradsOf()[0]) },
      });
      return fit(frames);
    },

    render(snap, p, c) {
      const H = 340;
      const xs = snap.xs || [], hs = snap.hs || [], ys = snap.ys || [], grads = snap.grads || [];
      const T = Math.max(1, xs.length);
      const cur = Math.round(S(snap.t));
      const cw = Math.min(40, 660 / T);
      const x0 = 30;
      const cells = xs.map((x, i) => {
        const xx = x0 + i * cw;
        const hv = hs[i + 1] === undefined ? 0 : hs[i + 1];
        const active = cur === i + 1;
        return (
          <g key={i}>
            <rect x={xx} y="64" width={cw - 4} height="32" rx="4" fill={x ? c.warning : c.panel2}
              stroke={active ? c.danger : c.border} strokeWidth={active ? 2 : 1} />
            <text x={xx + (cw - 4) / 2} y="84" fontSize="10" textAnchor="middle" fill={x ? c.bg : c.muted}>x={String(x)}</text>
            <line x1={xx + (cw - 4) / 2} y1="98" x2={xx + (cw - 4) / 2} y2="114" stroke={c.accent} strokeWidth="1.5" />
            <rect x={xx} y="116" width={cw - 4} height="42" rx="5" fill={c.primary}
              fillOpacity={C(Math.abs(hv), 0.08, 0.85)} stroke={active ? c.success : c.border} strokeWidth={active ? 2 : 1} />
            <text x={xx + (cw - 4) / 2} y="142" fontSize="9" textAnchor="middle" fill={Math.abs(hv) > 0.5 ? c.bg : c.text}>{f2(hv)}</text>
            <text x={xx + (cw - 4) / 2} y="176" fontSize="8" textAnchor="middle" fill={c.muted}>{ys[i] === undefined ? '—' : f2(ys[i])}</text>
          </g>
        );
      });
      return (
        <Frame c={c} height={H} title="RNN · 时间步展开与梯度回传" subtitle={`T=${String(T)} · W=${f2(S(snap.W, 0.85))} · 阶段 ${String(snap.phase)}`}>
          <text x="20" y="52" fontSize="11" fill={c.muted}>输入序列（脉冲触发）</text>
          <text x="20" y="194" fontSize="11" fill={c.muted}>隐藏状态 h_t → 输出 y_t（第二行数字）</text>
          {cells}
          <Panel c={c} x={20} y={210} w={680} h={92} title="反向传播时每一步的梯度幅度（越靠左越易消失）">
            <BarRow c={c} values={grads.slice(0, T)} x={32} y={230} w={656} h={44} maxV={Math.max(1, ...grads.slice(0, T))}
              colors={grads.slice(0, T).map((g) => (g < 0.05 ? c.danger : c.success))} showValues={false} />
            <text x="32" y="292" fontSize="10" fill={c.muted}>早期梯度 {f3(grads[0])} · 末端梯度 {f3(grads[T - 1])}</text>
          </Panel>
          <NoteLine c={c} text={snap.note} y={330} />
        </Frame>
      );
    },
  },

  lstm: {
    params: [
      { key: 'seqLen', label: '时间步 T', type: 'range', min: 8, max: 16, step: 1, default: 10 },
      { key: 'pulsePos', label: '记忆触发位置', type: 'range', min: 1, max: 14, step: 1, default: 2 },
      { key: 'forgetBias', label: '遗忘门偏置', type: 'range', min: -1, max: 1, step: 0.1, default: 0 },
      { key: 'longRange', label: '末尾放置查询脉冲', type: 'toggle', default: true },
    ],
    height: 360,
    legend: [{ label: '输入门 i' }, { label: '遗忘门 f' }, { label: '输出门 o' }, { label: '细胞状态 c' }],
    hint: 'LSTM 用三门控制信息：f 决定忘掉多少旧记忆，i 决定写入多少新内容，o 决定暴露多少；细胞状态走加法通道，梯度更稳。',

    buildSteps(p) {
      const T = Math.round(C(p.seqLen, 8, 16, 10));
      const pp = Math.min(Math.round(C(p.pulsePos, 1, 14, 2)), T - 2);
      const fb = C(p.forgetBias, -1, 1, 0);
      const long = !!p.longRange;
      const xs = Array.from({ length: T }, (_, i) => (i === pp || (long && i === T - 1) ? 1 : 0));
      let h = 0, cell = 0;
      const hs = [0], cs = [0], gsI = [], gsF = [], gsO = [];
      const base = { xs, hs: [0], cs: [0], gsI: [], gsF: [], gsO: [], t: 0, phase: 'intro', fb };
      const frames = [
        { ...base, note: `LSTM 展开 ${T} 步：细胞状态 c 跨时间累加，三门各自学开关；遗忘门偏置 ${r2(fb)}。`, metrics: { 时间步: 0, 序列长度: T, 输入门: 0, 遗忘门: 0, 细胞状态: 0 } },
        { ...base, note: `门控公式：i=σ(1.2x+0.4h₋₁)，f=σ(0.9+b+0.3h₋₁−0.5x)，o=σ(0.5+0.4h₋₁)。`, metrics: { 时间步: 0, 序列长度: T, 输入门: 0, 遗忘门: 0, 细胞状态: 0 } },
        { ...base, note: `第 ${pp + 1} 步写入记忆，${long ? `第 ${T} 步查询，中间隔 ${T - 1 - pp} 步` : '不设末尾查询'}，观察 c 能否保留信号。`, metrics: { 时间步: 0, 序列长度: T, 输入门: 0, 遗忘门: 0, 细胞状态: 0 } },
      ];
      for (let t = 0; t < T; t++) {
        const x = xs[t];
        const i = sig(1.2 * x + 0.4 * h);
        const f = sig(0.9 + fb + 0.3 * h - 0.5 * x);
        const o = sig(0.5 + 0.4 * h);
        const ch = th(0.9 * x + 0.2 * h);
        gsI.push(i); gsF.push(f); gsO.push(o);
        frames.push({
          xs, hs: hs.slice(), cs: cs.slice(), gsI: gsI.slice(), gsF: gsF.slice(), gsO: gsO.slice(),
          t: t + 1, phase: 'gate', fb,
          note: `第 ${t + 1}/${T} 步·门控：输入门 i=${f3(i)}，遗忘门 f=${f3(f)}，输出门 o=${f3(o)}（候选 ĉ=${f3(ch)}）。`,
          metrics: { 时间步: t + 1, 序列长度: T, 输入门: r3(i), 遗忘门: r3(f), 输出门: r3(o) },
        });
        cell = C(f * cell + i * ch, -8, 8, 0);
        h = C(o * th(cell), -3, 3, 0);
        cs.push(cell); hs.push(h);
        frames.push({
          xs, hs: hs.slice(), cs: cs.slice(), gsI: gsI.slice(), gsF: gsF.slice(), gsO: gsO.slice(),
          t: t + 1, phase: 'state', fb,
          note: `第 ${t + 1}/${T} 步·状态：c = f·c₋₁ + i·ĉ = ${f3(cell)}，h = o·tanh(c) = ${f3(h)}；加法路径保住长程信息。`,
          metrics: { 时间步: t + 1, 序列长度: T, 细胞状态: r3(cell), 隐藏状态: r3(h), 输出门: r3(o) },
        });
      }
      frames.push({
        ...frames[frames.length - 1], phase: 'done',
        note: `序列结束：最终 c=${f3(cs[cs.length - 1])}，h=${f3(hs[hs.length - 1])}。遗忘门越大，早期记忆保留越久。`,
        metrics: { 时间步: T, 序列长度: T, 细胞状态: r3(cell), 隐藏状态: r3(h), 末步输出门: r3(gsO[gsO.length - 1]) },
      });
      return fit(frames);
    },

    render(snap, p, c) {
      const H = 360;
      const xs = snap.xs || [], gsI = snap.gsI || [], gsF = snap.gsF || [], gsO = snap.gsO || [];
      const cs = snap.cs || [], hs = snap.hs || [];
      const T = Math.max(1, xs.length);
      const cur = Math.round(S(snap.t));
      const cw = Math.min(40, 660 / T);
      const x0 = 30;
      const bars = (arr, yi, color) => arr.slice(0, T).map((v, i) => {
        const xx = x0 + i * cw + 4;
        const bh = Math.max(1, C(v, 0, 1) * 28);
        return <rect key={`${yi}-${i}`} x={xx} y={yi + 28 - bh} width={Math.max(3, cw - 10)} height={bh} rx="2"
          fill={color} opacity={cur === i + 1 ? 1 : 0.62} />;
      });
      const tokens = xs.map((x, i) => {
        const xx = x0 + i * cw;
        return (
          <g key={`t${i}`}>
            <rect x={xx} y="56" width={cw - 4} height="24" rx="4" fill={x ? c.warning : c.panel2}
              stroke={cur === i + 1 ? c.danger : c.border} strokeWidth={cur === i + 1 ? 2 : 1} />
            <text x={xx + (cw - 4) / 2} y="72" fontSize="9" textAnchor="middle" fill={x ? c.bg : c.muted}>x={String(x)}</text>
          </g>
        );
      });
      return (
        <Frame c={c} height={H} title="LSTM · 三门 + 细胞状态" subtitle={`T=${String(T)} · 遗忘门偏置=${f2(S(snap.fb))} · ${String(snap.phase)}`}>
          <text x="20" y="50" fontSize="10" fill={c.muted}>输入脉冲</text>
          {tokens}
          <text x="20" y="94" fontSize="10" fill={c.muted}>i 输入门</text>
          <text x="20" y="130" fontSize="10" fill={c.muted}>f 遗忘门</text>
          <text x="20" y="166" fontSize="10" fill={c.muted}>o 输出门</text>
          <g transform="translate(46,0)">{bars(gsI, 78, c.series[0])}</g>
          <g transform="translate(46,0)">{bars(gsF, 114, c.series[1])}</g>
          <g transform="translate(46,0)">{bars(gsO, 150, c.series[2])}</g>
          <Panel c={c} x={20} y={194} w={680} h={126} title="细胞状态 c_t（加法通道）与隐藏状态 h_t">
            <LineChart c={c} points={cs.slice(1)} x={36} y={214} w={648} h={44} min={-3} max={3} color={c.success} />
            <LineChart c={c} points={hs.slice(1)} x={36} y={274} w={648} h={36} min={-3} max={3} color={c.primary} />
          </Panel>
          <NoteLine c={c} text={snap.note} y={348} />
        </Frame>
      );
    },
  },

  gru: {
    params: [
      { key: 'seqLen', label: '时间步 T', type: 'range', min: 8, max: 16, step: 1, default: 10 },
      { key: 'pulsePos', label: '记忆触发位置', type: 'range', min: 1, max: 14, step: 1, default: 3 },
      { key: 'updateBias', label: '更新门偏置', type: 'range', min: -1, max: 1, step: 0.1, default: 0 },
    ],
    height: 340,
    legend: [{ label: '更新门 z' }, { label: '重置门 r' }, { label: '隐藏状态 h' }, { label: '当前时间步' }],
    hint: 'GRU 只有更新门 z 与重置门 r：h_t=(1−z)·h_{t−1}+z·ĥ，用同一个门权衡保留旧记忆与写入新内容，参数比 LSTM 少。',

    buildSteps(p) {
      const T = Math.round(C(p.seqLen, 8, 16, 10));
      const pp = Math.min(Math.round(C(p.pulsePos, 1, 14, 3)), T - 2);
      const ub = C(p.updateBias, -1, 1, 0);
      const xs = Array.from({ length: T }, (_, i) => (i === pp || i === T - 1 ? 1 : 0));
      let h = 0;
      const hs = [0], gsZ = [], gsR = [];
      const base = { xs, hs: [0], gsZ: [], gsR: [], t: 0, phase: 'intro', ub };
      const frames = [
        { ...base, note: `GRU 展开 ${T} 步，只有两个门：更新门 z 与重置门 r，参数量约为 LSTM 的 2/3。`, metrics: { 时间步: 0, 序列长度: T, 更新门: 0, 重置门: 0, 隐藏状态: 0 } },
        { ...base, note: '更新门 z=σ(0.8x+0.4h₋₁+b)；重置门 r=σ(0.3+0.6h₋₁−0.2x)。', metrics: { 时间步: 0, 序列长度: T, 更新门: 0, 重置门: 0, 隐藏状态: 0 } },
        { ...base, note: `候选 ĥ=tanh(0.9x+r·0.5h₋₁)，最终 h=(1−z)·h₋₁+z·ĥ；更新门偏置 ${r2(ub)}。`, metrics: { 时间步: 0, 序列长度: T, 更新门: 0, 重置门: 0, 隐藏状态: 0 } },
      ];
      for (let t = 0; t < T; t++) {
        const x = xs[t];
        const z = sig(0.8 * x + 0.4 * h + ub);
        const r = sig(0.3 + 0.6 * h - 0.2 * x);
        const hh = th(0.9 * x + r * 0.5 * h);
        gsZ.push(z); gsR.push(r);
        frames.push({
          xs, hs: hs.slice(), gsZ: gsZ.slice(), gsR: gsR.slice(), t: t + 1, phase: 'gate', ub,
          note: `第 ${t + 1}/${T} 步·门控：更新门 z=${f3(z)}，重置门 r=${f3(r)}；候选 ĥ=${f3(hh)}。`,
          metrics: { 时间步: t + 1, 序列长度: T, 更新门: r3(z), 重置门: r3(r), 隐藏状态: r3(h) },
        });
        h = C((1 - z) * h + z * hh, -3, 3, 0);
        hs.push(h);
        frames.push({
          xs, hs: hs.slice(), gsZ: gsZ.slice(), gsR: gsR.slice(), t: t + 1, phase: 'state', ub,
          note: `第 ${t + 1}/${T} 步·状态：h=(1−${f2(z)})·h₋₁+${f2(z)}·ĥ=${f3(h)}，z 越大越偏向新信息。`,
          metrics: { 时间步: t + 1, 序列长度: T, 隐藏状态: r3(h), 更新门: r3(z), 重置门: r3(r) },
        });
      }
      frames.push({
        ...frames[frames.length - 1], phase: 'done',
        note: `序列结束：h=${f3(h)}。没有独立细胞状态，靠 z 门在"保留/更新"之间连续插值。`,
        metrics: { 时间步: T, 序列长度: T, 隐藏状态: r3(h), 更新门: r3(gsZ[gsZ.length - 1]), 重置门: r3(gsR[gsR.length - 1]) },
      });
      return fit(frames);
    },

    render(snap, p, c) {
      const H = 340;
      const xs = snap.xs || [], gsZ = snap.gsZ || [], gsR = snap.gsR || [], hs = snap.hs || [];
      const T = Math.max(1, xs.length);
      const cur = Math.round(S(snap.t));
      const cw = Math.min(40, 660 / T), x0 = 30;
      const gateBars = (arr, yi, color) => arr.slice(0, T).map((v, i) => {
        const xx = x0 + i * cw + 4, bh = Math.max(1, C(v, 0, 1) * 30);
        return <rect key={`${yi}-${i}`} x={xx} y={yi + 30 - bh} width={Math.max(3, cw - 10)} height={bh} rx="2"
          fill={color} opacity={cur === i + 1 ? 1 : 0.6} />;
      });
      return (
        <Frame c={c} height={H} title="GRU · 更新门 / 重置门" subtitle={`T=${String(T)} · 更新门偏置=${f2(S(snap.ub))} · ${String(snap.phase)}`}>
          <text x="20" y="52" fontSize="10" fill={c.muted}>输入</text>
          {xs.map((x, i) => {
            const xx = x0 + i * cw;
            return (
              <g key={i}>
                <rect x={xx} y="62" width={cw - 4} height="24" rx="4" fill={x ? c.warning : c.panel2}
                  stroke={cur === i + 1 ? c.danger : c.border} strokeWidth={cur === i + 1 ? 2 : 1} />
                <text x={xx + (cw - 4) / 2} y="78" fontSize="9" textAnchor="middle" fill={x ? c.bg : c.muted}>{String(x)}</text>
              </g>
            );
          })}
          <text x="20" y="108" fontSize="10" fill={c.muted}>z 更新门</text>
          <text x="20" y="148" fontSize="10" fill={c.muted}>r 重置门</text>
          <g transform="translate(46,0)">{gateBars(gsZ, 92, c.series[0])}</g>
          <g transform="translate(46,0)">{gateBars(gsR, 132, c.series[3])}</g>
          <Panel c={c} x={20} y={180} w={680} h={124} title="隐藏状态 h_t · 门控插值轨迹">
            <LineChart c={c} points={hs.slice(1)} x={36} y={200} w={648} h={80} min={-3} max={3} color={c.primary} />
            <text x="36" y="292" fontSize="10" fill={c.muted}>h=(1−z)·h₋₁+z·ĥ · 只有两个门，训练更快</text>
          </Panel>
          <NoteLine c={c} text={snap.note} y={328} />
        </Frame>
      );
    },
  },

  seq2seq: {
    params: [
      { key: 'srcLen', label: '源句长度', type: 'range', min: 5, max: 10, step: 1, default: 6 },
      { key: 'tgtLen', label: '目标句长度', type: 'range', min: 5, max: 10, step: 1, default: 6 },
      { key: 'teacher', label: 'Teacher Forcing', type: 'toggle', default: true, hint: '关闭后把上一步预测当作解码输入，误差会累积' },
    ],
    height: 380,
    legend: [{ label: '源 token' }, { label: '目标 token' }, { label: '注意力权重' }, { label: '上下文向量' }],
    hint: '编码器把整句压成隐藏状态序列 h₁…h_T，解码器逐步自回归生成；注意力让每个输出 token 只"看"相关的源位置。',

    buildSteps(p) {
      const SL = Math.round(C(p.srcLen, 5, 10, 6));
      const TL = Math.round(C(p.tgtLen, 5, 10, 6));
      const teacher = !!p.teacher;
      const SRC = ['我', '今', '天', '学', '习', '深', '度', '模', '型', '很'];
      const TGT = ['I', 'study', 'deep', 'learning', 'today', '.', 'OK', 'yes', 'go', '!'];
      const src = SRC.slice(0, SL), tgt = TGT.slice(0, TL);
      let eh = 0;
      const encHs = [];
      const frames = [];
      const common = { src, tgt, encHs: [], decSteps: [], curDec: -1, context: [], phase: 'intro' };
      frames.push({ ...common, note: `编码器读入 ${SL} 个源 token，解码器自回归生成 ${TL} 个目标 token。`, metrics: { 编码步: 0, 解码步: 0, 注意力峰值: 0, 置信度: 0, 教师强制: teacher ? 1 : 0 } });
      frames.push({ ...common, note: 'Encoder：h_t = tanh(0.55·h_{t−1} + 0.45·sin(index+1))，逐 token 压缩语义。', metrics: { 编码步: 0, 解码步: 0, 注意力峰值: 0, 置信度: 0, 教师强制: teacher ? 1 : 0 } });
      frames.push({ ...common, note: `Decoder：第 j 步输入 ${teacher ? '真实前一 token（Teacher Forcing）' : '上一步预测 token'}，输出一个词。`, metrics: { 编码步: 0, 解码步: 0, 注意力峰值: 0, 置信度: 0, 教师强制: teacher ? 1 : 0 } });
      for (let i = 0; i < SL; i++) {
        eh = th(0.55 * eh + 0.45 * Math.sin(i + 1));
        encHs.push(eh);
        frames.push({
          ...common, encHs: encHs.slice(), phase: 'encode', curEnc: i,
          note: `编码第 ${i + 1}/${SL} 步「${src[i]}」：h=${f3(eh)}，把语义写入隐藏状态序列。`,
          metrics: { 编码步: i + 1, 解码步: 0, 注意力峰值: 0, 置信度: 0, 教师强制: teacher ? 1 : 0 },
        });
      }
      const context = encHs.slice();
      frames.push({
        ...common, encHs: encHs.slice(), context: context.slice(), phase: 'context',
        note: `上下文向量由 ${SL} 个源隐藏状态拼成，解码器通过注意力按需读取。`,
        metrics: { 编码步: SL, 解码步: 0, 注意力峰值: r3(Math.max(...encHs.map(Math.abs))), 置信度: 0, 教师强制: teacher ? 1 : 0 },
      });
      const decSteps = [];
      let prev = '<s>';
      for (let j = 0; j < TL; j++) {
        const scores = encHs.map((hh, k) => hh * (0.8 + 0.12 * k) + 0.3 * Math.sin(j * 1.3 + k * 0.7));
        const attn = softmax(scores, 1);
        const peak = Math.max(...attn);
        const idx = Math.min(tgt.length - 1, Math.round(attn.indexOf(peak) * 1.7 + j * 0.6) % tgt.length);
        const token = tgt[idx];
        const conf = clamp(peak, 0, 1);
        decSteps.push({ attn, token, inp: prev, conf });
        frames.push({
          ...common, encHs: encHs.slice(), context: context.slice(), decSteps: decSteps.slice(), curDec: j, phase: 'attend',
          note: `解码第 ${j + 1}/${TL} 步·注意力：输入「${prev}」，对源位置权重 [${attn.map((a) => f2(a)).join(', ')}]，峰值 ${f2(peak)}。`,
          metrics: { 编码步: SL, 解码步: j + 1, 注意力峰值: r3(peak), 置信度: r3(conf), 教师强制: teacher ? 1 : 0 },
        });
        frames.push({
          ...common, encHs: encHs.slice(), context: context.slice(), decSteps: decSteps.slice(), curDec: j, phase: 'emit',
          note: `解码第 ${j + 1}/${TL} 步·生成：按加权上下文读出 token「${token}」，自回归把它送入下一步。`,
          metrics: { 编码步: SL, 解码步: j + 1, 注意力峰值: r3(peak), 置信度: r3(conf), 教师强制: teacher ? 1 : 0 },
        });
        prev = teacher ? (tgt[j] || token) : token;
      }
      frames.push({
        ...common, encHs: encHs.slice(), context: context.slice(), decSteps: decSteps.slice(), curDec: TL - 1, phase: 'done',
        note: `翻译完成：${src.join('')} → ${decSteps.map((d) => d.token).join(' ')}。`,
        metrics: { 编码步: SL, 解码步: TL, 注意力峰值: r3(Math.max(...decSteps.map((d) => Math.max(...d.attn)))), 置信度: r3(avg(decSteps.map((d) => d.conf))), 教师强制: teacher ? 1 : 0 },
      });
      return fit(frames);
    },

    render(snap, p, c) {
      const H = 380;
      const src = snap.src || [], tgt = snap.tgt || [], encHs = snap.encHs || [];
      const decSteps = snap.decSteps || [], curDec = Math.round(S(snap.curDec, -1));
      const ew = Math.min(56, 620 / Math.max(1, src.length)), ex = 40;
      const dw = Math.min(62, 620 / Math.max(1, tgt.length)), dx = 40;
      const encBoxes = src.map((s, i) => {
        const x = ex + i * (ew + 6), active = snap.phase === 'encode' && snap.curEnc === i;
        return (
          <g key={`e${i}`}>
            <rect x={x} y="60" width={ew} height="34" rx="5" fill={c.primary} fillOpacity={0.25 + C(Math.abs(encHs[i] || 0), 0, 1) * 0.6}
              stroke={active ? c.danger : c.border} strokeWidth={active ? 2 : 1} />
            <text x={x + ew / 2} y="82" fontSize="11" textAnchor="middle" fill={c.text}>{String(s)}</text>
            <text x={x + ew / 2} y="108" fontSize="8" textAnchor="middle" fill={c.muted}>{f2(encHs[i])}</text>
          </g>
        );
      });
      const decBoxes = tgt.map((t, j) => {
        const x = dx + j * (dw + 6), stepInfo = decSteps[j];
        const active = curDec === j;
        const links = stepInfo ? stepInfo.attn.map((a, k) => {
          const x1 = ex + k * (ew + 6) + ew / 2, y1 = 100, x2 = x + dw / 2, y2 = 236;
          return <line key={`a${j}-${k}`} x1={x1} y1={y1} x2={x2} y2={y2} stroke={c.purple}
            strokeWidth={1 + 3 * C(a, 0, 1)} strokeOpacity={active ? C(a, 0.05, 0.8) : C(a, 0.02, 0.22)} />;
        }) : null;
        return (
          <g key={`d${j}`}>
            {links}
            <rect x={x} y="236" width={dw} height="36" rx="5" fill={stepInfo ? c.success : c.panel2}
              fillOpacity={stepInfo ? (active ? 0.95 : 0.5) : 0.45}
              stroke={active ? c.warning : c.border} strokeWidth={active ? 2.5 : 1} />
            <text x={x + dw / 2} y="259" fontSize="10" textAnchor="middle" fill={stepInfo ? c.bg : c.muted}>{stepInfo ? String(stepInfo.token) : '·'}</text>
          </g>
        );
      });
      const last = decSteps[decSteps.length - 1];
      return (
        <Frame c={c} height={H} title="Seq2Seq · 编码—注意力—解码" subtitle={`源 ${String(src.length)} → 目标 ${String(tgt.length)} · ${String(snap.phase)}`}>
          <text x="20" y="50" fontSize="11" fill={c.muted}>Encoder 源序列</text>
          {encBoxes}
          <Panel c={c} x={20} y={124} w={680} h={78} title="上下文向量（源隐藏状态拼接）">
            <BarRow c={c} values={encHs.map(Math.abs)} x={34} y={146} w={652} h={40} maxV={1}
              colors={encHs.map(() => c.teal)} showValues={false} />
          </Panel>
          <text x="20" y="226" fontSize="11" fill={c.muted}>Decoder 目标序列（连线为注意力权重）</text>
          {decBoxes}
          <text x="20" y="300" fontSize="10" fill={c.muted}>{last ? `上一步输入「${String(last.inp)}」→ 生成「${String(last.token)}」· 置信度 ${f2(last.conf)}` : '等待解码开始'}</text>
          <text x="20" y="320" fontSize="10" fill={c.muted}>{snap.teacher ? 'Teacher Forcing：使用真实前一 token' : '自由运行：使用上一步预测 token'}</text>
          <NoteLine c={c} text={snap.note} y={368} />
        </Frame>
      );
    },
  },

  resnet: {
    params: [
      { key: 'depth', label: '残差块数量', type: 'range', min: 4, max: 12, step: 1, default: 6 },
      { key: 'strength', label: '残差分支强度', type: 'range', min: -1, max: 1, step: 0.1, default: 0.3 },
      { key: 'plain', label: '显示普通网络对比', type: 'toggle', default: true },
    ],
    height: 360,
    legend: [{ label: '残差分支 F(x)' }, { label: '跳连 x' }, { label: '残差梯度' }, { label: '普通网络梯度' }],
    hint: '残差块 y = F(x) + x 提供一条恒等通路：反向时梯度可直接穿过跳连回到浅层，因此上百层也能训练。',

    buildSteps(p) {
      const depth = Math.round(C(p.depth, 4, 12, 6));
      const strength = C(p.strength, -1, 1, 0.3);
      const plain = !!p.plain;
      let act = 1, gRes = 1, gPlain = 1;
      const acts = [1], gResArr = [1], gPlainArr = [1], fs = [0];
      const base = { depth, acts: [1], gResArr: [1], gPlainArr: [1], fs: [0], cur: 0, phase: 'intro', strength, plain };
      const frames = [
        { ...base, note: `构造 ${depth} 个残差块，F 的强度 ${r2(strength)}；每个块输出 y = F(x) + x。`, metrics: { 层数: 0, 残差激活: 1, 残差梯度: 1, 普通梯度: 1, 块数: depth } },
        { ...base, note: '反向时残差路径的导数是 1 + F′，即使 F′ 很小，梯度也近似 1，不会逐层衰减。', metrics: { 层数: 0, 残差激活: 1, 残差梯度: 1, 普通梯度: 1, 块数: depth } },
      ];
      for (let i = 1; i <= depth; i++) {
        const F = C(strength + 0.32 * Math.sin(i * 1.7), -1.5, 1.5, 0);
        fs.push(F);
        frames.push({
          ...base, acts: acts.slice(), fs: fs.slice(), cur: i, phase: 'forward',
          note: `第 ${i}/${depth} 块·前向：F(x)=${f3(F)}，分支与输入相加得到 y=${f3(C(act + F, -6, 6, 0))}。`,
          metrics: { 层数: i, 残差激活: r3(act), 残差梯度: r3(gRes), 普通梯度: r3(gPlain), 块数: depth },
        });
        act = C(act + F, -6, 6, 0);
        acts.push(act);
        gRes = Math.min(1e5, gRes * (1 + 0.25 * Math.abs(F)));
        gPlain = Math.max(1e-9, gPlain * (0.52 + 0.16 * Math.abs(F)));
        gResArr.push(gRes); gPlainArr.push(gPlain);
        frames.push({
          ...base, acts: acts.slice(), fs: fs.slice(), gResArr: gResArr.slice(), gPlainArr: gPlainArr.slice(),
          cur: i, phase: 'skip',
          note: `第 ${i}/${depth} 块·跳连：x 原样加到输出上，∂y/∂x = 1 + F′ ≈ ${f3(1 + 0.25 * Math.abs(F))}。`,
          metrics: { 层数: i, 残差激活: r3(act), 残差梯度: r3(gRes), 普通梯度: r3(gPlain), 块数: depth },
        });
        frames.push({
          ...base, acts: acts.slice(), fs: fs.slice(), gResArr: gResArr.slice(), gPlainArr: gPlainArr.slice(),
          cur: i, phase: 'res-grad',
          note: `第 ${i}/${depth} 块·残差反向：梯度连乘后仍为 ${f3(gRes)}，浅层信号保留。`,
          metrics: { 层数: i, 残差激活: r3(act), 残差梯度: r3(gRes), 普通梯度: r3(gPlain), 块数: depth },
        });
        frames.push({
          ...base, acts: acts.slice(), fs: fs.slice(), gResArr: gResArr.slice(), gPlainArr: gPlainArr.slice(),
          cur: i, phase: 'plain-grad',
          note: `第 ${i}/${depth} 块·普通网络对比：没有跳连时梯度已衰减到 ${f3(gPlain)}${plain ? '' : '（对比面板仍显示参考值）'}。`,
          metrics: { 层数: i, 残差激活: r3(act), 残差梯度: r3(gRes), 普通梯度: r3(gPlain), 块数: depth },
        });
        frames.push({
          ...base, acts: acts.slice(), fs: fs.slice(), gResArr: gResArr.slice(), gPlainArr: gPlainArr.slice(),
          cur: i, phase: 'compare',
          note: `第 ${i}/${depth} 块·对比：残差 ${f3(gRes)} vs 普通 ${f3(gPlain)}，差距随深度指数扩大。`,
          metrics: { 层数: i, 残差激活: r3(act), 残差梯度: r3(gRes), 普通梯度: r3(gPlain), 块数: depth },
        });
      }
      frames.push({
        ...base, acts: acts.slice(), fs: fs.slice(), gResArr: gResArr.slice(), gPlainArr: gPlainArr.slice(),
        cur: depth, phase: 'done',
        note: `训练到第 ${depth} 层：残差梯度 ${f3(gRes)}，普通网络梯度 ${f3(gPlain)}。跳连让深层网络可优化。`,
        metrics: { 层数: depth, 残差激活: r3(act), 残差梯度: r3(gRes), 普通梯度: r3(gPlain), 块数: depth },
      });
      return fit(frames);
    },

    render(snap, p, c) {
      const H = 360;
      const acts = snap.acts || [1], fs = snap.fs || [], gResArr = snap.gResArr || [1], gPlainArr = snap.gPlainArr || [1];
      const depth = Math.round(S(snap.depth, 6));
      const cur = Math.round(S(snap.cur));
      const rowH = Math.min(30, 250 / Math.max(1, depth));
      const y0 = 44;
      const blocks = fs.slice(1).map((f, i) => {
        const y = y0 + i * rowH;
        if (y + rowH > 300) return null;
        const active = cur === i + 1;
        return (
          <g key={i}>
            <path d={`M 62,${y - 4} C 92,${y - 4} 92,${y + rowH + 4} 122,${y + rowH + 4}`} fill="none"
              stroke={c.success} strokeWidth={active ? 2.5 : 1.4} opacity={active ? 1 : 0.6} />
            <rect x="122" y={y} width="190" height={rowH - 4} rx="4" fill={active ? c.primary : c.panel2}
              fillOpacity={active ? 0.85 : 0.55} stroke={active ? c.warning : c.border} strokeWidth={active ? 2 : 1} />
            <text x="132" y={y + rowH / 2 + 2} fontSize="9" fill={active ? c.bg : c.text}>F({f2(acts[i])}) = {f3(f)}</text>
            <text x="308" y={y + rowH / 2 + 2} fontSize="9" fill={c.muted}>→ {f2(acts[i + 1])}</text>
          </g>
        );
      });
      const gmax = Math.max(1, ...gResArr.slice(0, depth + 1));
      return (
        <Frame c={c} height={H} title="ResNet · 跳连与梯度通路" subtitle={`${String(depth)} 个残差块 · ${String(snap.phase)}`}>
          <text x="20" y="36" fontSize="10" fill={c.muted}>绿色弧线 = 恒等跳连 x</text>
          {blocks}
          <Panel c={c} x={340} y={44} w={360} h={252} title="梯度随层数的变化">
            <LineChart c={c} points={gResArr.slice(0, depth + 1)} x={356} y={70} w={328} h={88} min={0} max={gmax} color={c.success} />
            <text x="356" y="174" fontSize="10" fill={c.success}>残差网络梯度 {f3(gResArr[gResArr.length - 1])}</text>
            <LineChart c={c} points={gPlainArr.slice(0, depth + 1)} x={356} y={190} w={328} h={70} min={0} max={gmax} color={c.danger} dashed />
            <text x="356" y="280" fontSize="10" fill={c.danger}>普通网络梯度 {f3(gPlainArr[gPlainArr.length - 1])}</text>
          </Panel>
          <NoteLine c={c} text={snap.note} y={348} />
        </Frame>
      );
    },
  },

  word2vec: {
    params: [
      { key: 'window', label: '共现窗口半径', type: 'range', min: 1, max: 5, step: 1, default: 2 },
      { key: 'negatives', label: '负采样个数', type: 'range', min: 0, max: 4, step: 1, default: 2 },
      { key: 'lr', label: '学习率 η', type: 'range', min: 0.01, max: 0.5, step: 0.01, default: 0.12 },
      { key: 'steps', label: '训练步数', type: 'range', min: 20, max: 120, step: 10, default: 60 },
    ],
    height: 360,
    legend: [{ label: '中心词' }, { label: '上下文词' }, { label: '负样本' }, { label: '向量更新方向' }],
    hint: 'Skip-gram 用中心词 predict 窗口内上下文：共现的词向量被拉近，负采样的词被推远，语义逐渐落到二维向量里。',

    buildSteps(p) {
      const win = Math.round(C(p.window, 1, 5, 2));
      const negs = Math.round(C(p.negatives, 0, 4, 2));
      const lr = C(p.lr, 0.01, 0.5, 0.12);
      const steps = Math.round(C(p.steps, 20, 120, 60));
      const CORPUS = ['我', '爱', '机', '器', '学', '习', '深', '度', '模', '型', '很', '有', '趣', '啊', '好', '呀', '的', '是', '在', '和'];
      const N = CORPUS.length;
      const rnd = mulberry32(6241);
      const vecs = CORPUS.map(() => [(rnd() - 0.5) * 2.4, (rnd() - 0.5) * 2.4]);
      const meet = (a, b) => a[0] * b[0] + a[1] * b[1];
      const nrm = (a) => Math.sqrt(meet(a, a));
      const centAvg = (idxs) => {
        if (!idxs.length) return [0, 0];
        return [avg(idxs.map((i) => vecs[i][0])), avg(idxs.map((i) => vecs[i][1]))];
      };
      let sim = 0;
      const frames = [{
        note: `词表 ${N} 个词，随机初始化二维向量；窗口半径 ${win}，负样本 ${negs} 个。`,
        corpus: CORPUS, vecs: vecs.map((v) => v.slice()), t: 0, ci: -1, ctxIdx: [], negIdx: [], prev: [0, 0], sim: 0,
        metrics: { 步数: 0, 窗口: win, 中心词: 0, 相似度: 0, 负样本数: negs },
      }];
      for (let t = 1; t <= steps; t++) {
        const ci = (t * 3 + 1) % N;
        const ctxIdx = [];
        for (let d = 1; d <= win; d++) { ctxIdx.push((ci - d + N) % N); ctxIdx.push((ci + d) % N); }
        const negIdx = [];
        for (let k = 0; k < negs; k++) {
          const ni = (ci + 3 + k * 5 + t) % N;
          if (ni !== ci && ctxIdx.indexOf(ni) < 0 && negIdx.indexOf(ni) < 0) negIdx.push(ni);
        }
        const prev = vecs[ci].slice();
        const cVec = centAvg(ctxIdx), nVec = centAvg(negIdx);
        sim = meet(vecs[ci], cVec) / Math.max(0.1, nrm(vecs[ci]) * nrm(cVec));
        vecs[ci][0] = C(vecs[ci][0] + lr * 0.35 * (cVec[0] - vecs[ci][0]) - lr * 0.08 * nVec[0], -3, 3, 0);
        vecs[ci][1] = C(vecs[ci][1] + lr * 0.35 * (cVec[1] - vecs[ci][1]) - lr * 0.08 * nVec[1], -3, 3, 0);
        ctxIdx.forEach((j) => {
          vecs[j][0] = C(vecs[j][0] + lr * 0.1 * (vecs[ci][0] - vecs[j][0]), -3, 3, 0);
          vecs[j][1] = C(vecs[j][1] + lr * 0.1 * (vecs[ci][1] - vecs[j][1]), -3, 3, 0);
        });
        frames.push({
          note: `第 ${t} 步·中心词「${CORPUS[ci]}」：窗口内 [${ctxIdx.map((i) => CORPUS[i]).join(' ')}] 被拉近，负样本 [${negIdx.map((i) => CORPUS[i]).join(' ')}] 被推远，相似度 ${f3(sim)}。`,
          corpus: CORPUS, vecs: vecs.map((v) => v.slice()), t, ci, ctxIdx, negIdx, prev, sim,
          metrics: { 步数: t, 窗口: win, 中心词: ci + 1, 相似度: r3(sim), 负样本数: negIdx.length },
        });
      }
      return fit(frames);
    },

    render(snap, p, c) {
      const H = 360;
      const corpus = snap.corpus || [], vecs = snap.vecs || [];
      const ci = Math.round(S(snap.ci, -1)), ctxIdx = snap.ctxIdx || [], negIdx = snap.negIdx || [];
      const cw = Math.min(32, 660 / Math.max(1, corpus.length));
      const tokens = corpus.map((w, i) => {
        const state = i === ci ? c.primary : ctxIdx.indexOf(i) >= 0 ? c.success : negIdx.indexOf(i) >= 0 ? c.danger : c.panel2;
        return (
          <g key={i}>
            <rect x={20 + i * cw} y="52" width={cw - 3} height="26" rx="4" fill={state}
              opacity={i === ci || ctxIdx.indexOf(i) >= 0 || negIdx.indexOf(i) >= 0 ? 0.9 : 0.55} />
            <text x={20 + i * cw + (cw - 3) / 2} y="69" fontSize="9" textAnchor="middle" fill={c.bg}>{String(w)}</text>
          </g>
        );
      });
      const px = (v) => 32 + ((C(v, -3, 3) + 3) / 6) * 376;
      const py = (v) => 292 - ((C(v, -3, 3) + 3) / 6) * 186;
      const prev = snap.prev || [0, 0];
      const dots = vecs.map((v, i) => {
        const isC = i === ci, isCtx = ctxIdx.indexOf(i) >= 0, isNeg = negIdx.indexOf(i) >= 0;
        const fill = isC ? c.primary : isCtx ? c.success : isNeg ? c.danger : c.series[7];
        return (
          <g key={i}>
            {isCtx && ci >= 0 ? <line x1={px(vecs[ci][0])} y1={py(vecs[ci][1])} x2={px(v[0])} y2={py(v[1])} stroke={c.success} strokeWidth="1" strokeOpacity="0.45" /> : null}
            {isNeg && ci >= 0 ? <line x1={px(vecs[ci][0])} y1={py(vecs[ci][1])} x2={px(v[0])} y2={py(v[1])} stroke={c.danger} strokeWidth="1" strokeDasharray="3 2" strokeOpacity="0.4" /> : null}
            <circle cx={px(v[0])} cy={py(v[1])} r={isC ? 6 : 4} fill={fill} stroke={c.bg} strokeWidth="0.8" />
            <text x={px(v[0]) + 6} y={py(v[1]) - 5} fontSize="8" fill={c.muted}>{String(corpus[i])}</text>
          </g>
        );
      });
      const arrow = ci >= 0 ? (
        <g>
          <line x1={px(prev[0])} y1={py(prev[1])} x2={px(vecs[ci][0])} y2={py(vecs[ci][1])} stroke={c.warning} strokeWidth="2" />
          <circle cx={px(prev[0])} cy={py(prev[1])} r="3" fill={c.warning} opacity="0.6" />
        </g>
      ) : null;
      const sims = vecs.slice(0, 6).map((v, i) => C((v[0] + v[1]) / 6, 0, 1));
      return (
        <Frame c={c} height={H} title="Word2Vec · 共现窗口与向量更新" subtitle={`窗口=${String(p.window)} · 负样本=${String(p.negatives)} · 步 ${String(snap.t || 0)}`}>
          <text x="20" y="46" fontSize="10" fill={c.muted}>语料序列（蓝=中心，绿=上下文，红=负样本）</text>
          {tokens}
          <Panel c={c} x={20} y={92} w={408} h={212} title="二维词向量空间">
            {dots}
            {arrow}
          </Panel>
          <Panel c={c} x={440} y={92} w={262} h={212} title="本步统计">
            <text x="454" y="122" fontSize="11" fill={c.muted}>中心—上下文相似度</text>
            <text x="688" y="122" fontSize="13" textAnchor="end" fill={c.success}>{f3(snap.sim)}</text>
            <text x="454" y="148" fontSize="11" fill={c.muted}>上下文词数 {String(ctxIdx.length)} · 负样本 {String(negIdx.length)}</text>
            <text x="454" y="180" fontSize="10" fill={c.muted}>前 6 个词的投影强度</text>
            <BarRow c={c} values={sims} x={454} y={190} w={234} h={64} maxV={1}
              colors={sims.map((_, i) => c.series[i % c.series.length])} showValues={false} />
            <text x="454" y="280" fontSize="10" fill={c.muted}>橙色箭头 = 中心词向量更新</text>
          </Panel>
          <NoteLine c={c} text={snap.note} y={348} />
        </Frame>
      );
    },
  },

  crf: {
    params: [
      { key: 'seqLen', label: '序列长度', type: 'range', min: 4, max: 8, step: 1, default: 6 },
      { key: 'strength', label: '转移约束强度', type: 'range', min: 0, max: 2, step: 0.1, default: 1 },
      { key: 'noise', label: '发射分数扰动', type: 'toggle', default: false },
    ],
    height: 380,
    legend: [{ label: '转移得分' }, { label: '发射得分' }, { label: '维特比 DP' }, { label: '最优路径' }],
    hint: 'CRF 不只逐位置看发射分数，还用转移矩阵约束标签顺序；维特比在货架式网格上求全局得分最高的那条路径。',

    buildSteps(p) {
      const T = Math.round(C(p.seqLen, 4, 8, 6));
      const st = C(p.strength, 0, 2, 1);
      const noise = !!p.noise;
      const LABELS = ['B', 'I', 'O'];
      const trans = [
        [-0.5, 2.0 * st, 0.6],
        [-0.8, 1.6 * st, 0.9],
        [0.5, -0.7, 1.3],
      ];
      const emit = Array.from({ length: T }, (_, t) => LABELS.map((_, l) =>
        C(0.9 * Math.sin(t * 1.1 + l * 2.0) + (l === 1 ? 0.5 : 0) + (noise ? 0.35 * Math.cos(t * 3.3 + l) : 0), -3, 3, 0)));
      const dp = [], back = [];
      const mkFrame = (note, phase, cur, extra) => ({
        note, phase, cur, T, LABELS, trans, emit,
        dp: dp.map((r) => r.slice()), back: back.map((r) => r.slice()), path: [],
        metrics: { 序列长度: T, 当前位置: cur, 最优得分: r3(dp.length ? Math.max(...dp[dp.length - 1]) : 0), 转移强度: r2(st), 标签数: 3 },
        ...(extra || {}),
      });
      const frames = [
        mkFrame('转移矩阵约束标签顺序：B→I 强、I→I 强、O→I 弱，避免不合语法的标注。', 'intro', 0),
        mkFrame(`为每个位置准备发射分数（${noise ? '加入了扰动' : '无扰动'}）：模型对 B/I/O 的局部打分。`, 'intro', 0),
        mkFrame('维特比递推：dp[t][l] = max_k ( dp[t−1][k] + trans[k][l] ) + emit[t][l]。', 'intro', 0),
      ];
      for (let t = 0; t < T; t++) {
        frames.push(mkFrame(`第 ${t + 1}/${T} 位·发射：得分 [${emit[t].map((v) => f2(v)).join(', ')}]。`, 'emit', t + 1));
        let row;
        if (t === 0) row = emit[0].slice();
        else row = LABELS.map((_, l) => {
          let best = -Infinity, bk = 0;
          for (let k = 0; k < 3; k++) {
            const v = dp[t - 1][k] + trans[k][l];
            if (v > best) { best = v; bk = k; }
          }
          return best + emit[t][l];
        }).map((v) => C(v, -1e5, 1e5, 0));
        dp.push(row);
        const bkRow = t === 0 ? [0, 0, 0] : LABELS.map((_, l) => {
          let best = -Infinity, bk = 0;
          for (let k = 0; k < 3; k++) {
            const v = dp[t - 1][k] + trans[k][l];
            if (v > best) { best = v; bk = k; }
          }
          return bk;
        });
        back.push(bkRow);
        frames.push(mkFrame(`第 ${t + 1}/${T} 位·DP：累计最高分 [${row.map((v) => f2(v)).join(', ')}]，路径得分被全局更新。`, 'dp', t + 1));
        frames.push(mkFrame(`第 ${t + 1}/${T} 位·回溯指针：每个标签记录得分最高的前驱标签 ${bkRow.join('/')}。`, 'back', t + 1));
        const bestLabel = row.indexOf(Math.max(...row));
        const pathSoFar = new Array(T).fill(0);
        pathSoFar[t] = bestLabel;
        for (let q = t - 1; q >= 0; q--) pathSoFar[q] = back[q + 1] ? back[q + 1][pathSoFar[q + 1]] : 0;
        frames.push(mkFrame(`第 ${t + 1}/${T} 位·当前最优路径：${pathSoFar.map((l) => LABELS[l]).join(' ')}。`, 'best', t + 1, { path: pathSoFar }));
      }
      const bestLast = dp[T - 1].indexOf(Math.max(...dp[T - 1]));
      const bestPath = new Array(T).fill(0);
      bestPath[T - 1] = bestLast;
      for (let q = T - 2; q >= 0; q--) bestPath[q] = back[q + 1][bestPath[q + 1]];
      for (let k = 0; k < T; k++) {
        frames.push(mkFrame(`回溯第 ${T - k}/${T} 位：沿指针继续往前，逐步还原全局最优标签序列。`, 'trace', T - k, { path: bestPath.slice() }));
      }
      frames.push(mkFrame(`维特比解码完成：最优路径 ${bestPath.map((l) => LABELS[l]).join(' ')}，得分 ${f3(Math.max(...dp[T - 1]))}。`, 'done', T, { path: bestPath.slice() }));
      return fit(frames);
    },

    render(snap, p, c) {
      const H = 380;
      const LABELS = snap.LABELS || ['B', 'I', 'O'];
      const trans = snap.trans || [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
      const emit = snap.emit || [];
      const dp = snap.dp || [];
      const path = snap.path || [];
      const cur = Math.round(S(snap.cur));
      const transCell = 46, tx = 56, ty = 62;
      const transCells = trans.map((row, i) => row.map((v, j) => (
        <g key={`${i}-${j}`}>
          <rect x={tx + j * transCell} y={ty + i * transCell} width={transCell - 3} height={transCell - 3} rx="4"
            fill={c.primary} fillOpacity={C((v + 2) / 4, 0.1, 0.75)} stroke={path.length > 1 && path.indexOf(i) >= 0 && path.indexOf(j) >= 0 ? c.success : c.border} />
          <text x={tx + j * transCell + (transCell - 3) / 2} y={ty + i * transCell + transCell / 2 + 2}
            fontSize="9" textAnchor="middle" fill={c.text}>{f2(v)}</text>
        </g>
      )));
      const T = Math.round(S(snap.T, 6));
      const cw = Math.min(56, 520 / Math.max(1, T)), gx = 226, gy = 62;
      const lattice = dp.map((row, t) => row.map((v, l) => {
        const x = gx + 26 + t * cw, y = gy + 22 + l * 46;
        const onPath = path[t] === l;
        return (
          <g key={`d${t}-${l}`}>
            <circle cx={x} cy={y} r={onPath ? 8 : 6} fill={onPath ? c.danger : c.primary}
              fillOpacity={onPath ? 0.95 : 0.35 + C((v + 6) / 18, 0, 0.55)} stroke={c.bg} strokeWidth="1" />
            {t === T - 1 || dp.length < 2 ? null : <line x1={x} y1={y} x2={x + cw} y2={y} stroke={c.grid} />}
          </g>
        );
      }));
      const poly = path.map((l, t) => `${gx + 26 + t * cw},${gy + 22 + l * 46}`).join(' ');
      return (
        <Frame c={c} height={H} title="CRF · 转移矩阵与维特比最优路径" subtitle={`T=${String(T)} · 阶段 ${String(snap.phase)} · 位置 ${String(cur)}`}>
          <Panel c={c} x={20} y={44} w={190} h={182} title="转移矩阵 trans[k][l]">
            {LABELS.map((l, j) => <text key={`c${j}`} x={tx + j * transCell + 18} y={ty - 6} fontSize="9" textAnchor="middle" fill={c.muted}>{String(l)}</text>)}
            {LABELS.map((l, i) => <text key={`r${i}`} x={tx - 8} y={ty + i * transCell + 26} fontSize="9" textAnchor="end" fill={c.muted}>{String(l)}</text>)}
            {transCells}
          </Panel>
          <Panel c={c} x={222} y={44} w={478} h={252} title="维特比网格 · 红点为当前最优标签">
            {LABELS.map((l, i) => <text key={`l${i}`} x={gx + 8} y={gy + 26 + i * 46} fontSize="10" fill={c.muted}>{String(l)}</text>)}
            {Array.from({ length: T }, (_, t) => <text key={`p${t}`} x={gx + 26 + t * cw} y={gy + 12} fontSize="8" textAnchor="middle" fill={c.muted}>t{String(t + 1)}</text>)}
            {lattice}
            {path.length > 1 ? <polyline points={poly} fill="none" stroke={c.danger} strokeWidth="2.5" strokeDasharray="4 2" /> : null}
          </Panel>
          <text x="20" y="248" fontSize="10" fill={c.muted}>发射分数（当前位）</text>
          <text x="20" y="268" fontSize="10" fill={c.text}>{emit.length ? emit[C(cur - 1, 0, emit.length - 1, 0)].map((v, i) => `${String(LABELS[i])}:${f2(v)}`).join('  ') : '—'}</text>
          <text x="20" y="298" fontSize="11" fill={c.muted}>最优路径</text>
          <text x="20" y="320" fontSize="14" fill={c.success}>{path.length ? path.map((l) => String(LABELS[l])).join(' ') : '等待解码'}</text>
          <NoteLine c={c} text={snap.note} y={368} />
        </Frame>
      );
    },
  },

  'contrastive-learning': {
    params: [
      { key: 'batch', label: '批大小（含 1 正样本）', type: 'range', min: 4, max: 12, step: 2, default: 8 },
      { key: 'temp', label: '温度 τ', type: 'range', min: 0.1, max: 1, step: 0.1, default: 0.2 },
      { key: 'lr', label: '学习率 η', type: 'range', min: 0.01, max: 0.3, step: 0.01, default: 0.1 },
      { key: 'steps', label: '训练步数', type: 'range', min: 20, max: 100, step: 10, default: 50 },
    ],
    height: 340,
    legend: [{ label: '锚样本 anchor' }, { label: '正样本' }, { label: '负样本' }, { label: '相似边' }],
    hint: 'InfoNCE 把正样本的相似度推高、负样本推低：温度越小，对最难负样本越敏感，表示空间里的同类会聚成簇。',

    buildSteps(p) {
      const B = Math.round(C(p.batch, 4, 12, 8));
      const tau = C(p.temp, 0.1, 1, 0.2);
      const lr = C(p.lr, 0.01, 0.3, 0.1);
      const steps = Math.round(C(p.steps, 20, 100, 50));
      let anchor = [0.2, 0.1];
      const pos = [1.5, 0.9];
      const negs = Array.from({ length: B - 1 }, (_, i) => {
        const ang = (2 * Math.PI * i) / (B - 1);
        return [2.3 * Math.cos(ang) + 0.4, 2.3 * Math.sin(ang) + 0.3];
      });
      const dot = (a, b) => a[0] * b[0] + a[1] * b[1];
      const dist = (a, b) => Math.sqrt((a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2);
      const losses = [];
      const frames = [];
      for (let t = 1; t <= steps; t++) {
        const sp = dot(anchor, pos) / tau;
        const sn = negs.map((n) => dot(anchor, n) / tau);
        const mx = Math.max(sp, ...sn);
        const ep = Math.exp(C(sp - mx, -30, 30));
        const en = sn.reduce((s, v) => s + Math.exp(C(v - mx, -30, 30)), 0);
        const loss = -Math.log(Math.max(1e-9, ep / Math.max(1e-9, ep + en)));
        losses.push(loss);
        const dp = dist(anchor, pos), dn = avg(negs.map((n) => dist(anchor, n)));
        frames.push({
          note: `第 ${t} 步：正样本距离 ${f3(dp)}，负样本平均距离 ${f3(dn)}，相似度 ${f3(sp)} vs ${f3(avg(sn))}，InfoNCE=${f3(loss)}。`,
          t, anchor: anchor.slice(), pos: pos.slice(), negs: negs.map((n) => n.slice()), sp, sn, dn, dp, loss, losses: losses.slice(),
          metrics: { 步数: t, 批大小: B, 温度: tau, 正样本距离: r3(dp), 负样本距离: r3(dn), 损失: r3(loss) },
        });
        anchor = [
          C(anchor[0] + lr * 0.35 * (pos[0] - anchor[0]) - lr * 0.08 * avg(negs.map((n) => n[0] - anchor[0])), -3, 3, 0),
          C(anchor[1] + lr * 0.35 * (pos[1] - anchor[1]) - lr * 0.08 * avg(negs.map((n) => n[1] - anchor[1])), -3, 3, 0),
        ];
      }
      return fit(frames);
    },

    render(snap, p, c) {
      const H = 340;
      const anchor = snap.anchor || [0, 0], pos = snap.pos || [0, 0], negs = snap.negs || [];
      const sn = snap.sn || [], losses = snap.losses || [];
      const px = (v) => 40 + ((C(v, -3, 3) + 3) / 6) * 380;
      const py = (v) => 270 - ((C(v, -3, 3) + 3) / 6) * 200;
      const negDots = negs.map((n, i) => (
        <g key={`n${i}`}>
          <line x1={px(anchor[0])} y1={py(anchor[1])} x2={px(n[0])} y2={py(n[1])} stroke={c.danger}
            strokeWidth="1" strokeDasharray="3 3" strokeOpacity={C(sn[i] === undefined ? 0.2 : (sn[i] + 2) / 8, 0.1, 0.6)} />
          <circle cx={px(n[0])} cy={py(n[1])} r="5" fill={c.danger} stroke={c.bg} strokeWidth="0.8" />
        </g>
      ));
      return (
        <Frame c={c} height={H} title="对比学习 · 拉近正样本 / 推远负样本" subtitle={`τ=${f2(S(p.temp, 0.2))} · batch=${String(snap.metrics ? snap.metrics.批大小 : 8)} · 步 ${String(snap.t || 0)}`}>
          <Panel c={c} x={20} y={40} w={440} h={252} title="表示空间（虚线=负样本，实线=正样本）">
            {negDots}
            <line x1={px(anchor[0])} y1={py(anchor[1])} x2={px(pos[0])} y2={py(pos[1])} stroke={c.success} strokeWidth="2.5" />
            <circle cx={px(pos[0])} cy={py(pos[1])} r="7" fill={c.success} stroke={c.bg} strokeWidth="1.2" />
            <circle cx={px(anchor[0])} cy={py(anchor[1])} r="8" fill={c.primary} stroke={c.warning} strokeWidth="2" />
            <text x={px(anchor[0]) + 10} y={py(anchor[1]) - 8} fontSize="9" fill={c.muted}>anchor</text>
            <text x={px(pos[0]) + 9} y={py(pos[1]) - 8} fontSize="9" fill={c.muted}>正</text>
          </Panel>
          <Panel c={c} x={474} y={40} w={228} h={252} title="相似度 / InfoNCE 损失">
            <text x="488" y="68" fontSize="10" fill={c.muted}>正样本相似度</text>
            <text x="690" y="68" fontSize="12" textAnchor="end" fill={c.success}>{f3(snap.sp)}</text>
            <text x="488" y="88" fontSize="10" fill={c.muted}>负样本均相似度</text>
            <text x="690" y="88" fontSize="12" textAnchor="end" fill={c.danger}>{f3(avg(sn))}</text>
            <text x="488" y="112" fontSize="10" fill={c.muted}>负样本相似度分布</text>
            <BarRow c={c} values={sn.map((v) => Math.abs(v))} x={488} y={122} w={200} h={48} maxV={Math.max(1, ...sn.map(Math.abs))}
              colors={sn.map(() => c.danger)} showValues={false} />
            <text x="488" y="196" fontSize="10" fill={c.muted}>InfoNCE 损失（下降）</text>
            <LineChart c={c} points={losses} x={488} y={204} w={200} h={62} min={0} max={Math.max(1, ...losses)} color={c.warning} />
            <text x="488" y="282" fontSize="9" fill={c.muted}>正距 {f3(snap.dp)} · 负距 {f3(snap.dn)}</text>
          </Panel>
          <NoteLine c={c} text={snap.note} y={330} />
        </Frame>
      );
    },
  },

  'knowledge-distillation': {
    params: [
      { key: 'temp', label: '蒸馏温度 T', type: 'range', min: 1, max: 6, step: 0.5, default: 3 },
      { key: 'alpha', label: '软标签权重 α', type: 'range', min: 0, max: 1, step: 0.1, default: 0.5 },
      { key: 'steps', label: '训练步数', type: 'range', min: 20, max: 100, step: 10, default: 50 },
    ],
    height: 340,
    legend: [{ label: '教师软标签' }, { label: '学生概率' }, { label: 'KL 散度' }, { label: '总损失' }],
    hint: '教师 logits 除以温度后 softmax 得到"暗知识"软标签；学生同时拟合软标签与真实硬标签，T² 平衡梯度尺度。',

    buildSteps(p) {
      const T = C(p.temp, 1, 6, 3);
      const alpha = C(p.alpha, 0, 1, 0.5);
      const steps = Math.round(C(p.steps, 20, 100, 50));
      const NAMES = ['猫', '狗', '鸟', '车', '鱼'];
      let student = [0, 0, 0, 0, 0];
      const kls = [], losses = [];
      const frames = [];
      for (let t = 1; t <= steps; t++) {
        const teacher = [2.0, 0.6, -0.2, 1.1, -0.9].map((v, i) => v + 0.12 * Math.sin(t * 0.09 + i));
        student = student.map((v, i) => C(v + 0.09 * (0.85 * teacher[i] - v), -6, 6, 0));
        const ts = softmax(teacher, T), ss = softmax(student, T);
        const kl = ts.reduce((s, q, i) => s + q * Math.log(Math.max(1e-9, q / Math.max(1e-9, ss[i]))), 0);
        const hard = softmax(student, 1);
        const ce = -Math.log(Math.max(1e-9, hard[0]));
        const loss = alpha * T * T * kl + (1 - alpha) * ce;
        kls.push(kl); losses.push(loss);
        frames.push({
          note: `第 ${t} 步·温度 ${f2(T)}：教师软标签 [${ts.map((v) => f2(v)).join(', ')}]，学生 [${ss.map((v) => f2(v)).join(', ')}]；KL=${f3(kl)}，硬标签 CE=${f3(ce)}，总损失=${f3(loss)}。`,
          t, NAMES, teacher, student: student.slice(), ts, ss, kl, ce, loss, kls: kls.slice(), losses: losses.slice(),
          metrics: { 步数: t, 温度: T, 软标签权重: alpha, KL散度: r3(kl), 学生置信度: r3(ss[0]), 总损失: r3(loss) },
        });
      }
      return fit(frames);
    },

    render(snap, p, c) {
      const H = 340;
      const names = snap.NAMES || ['猫', '狗', '鸟', '车', '鱼'];
      const ts = snap.ts || [], ss = snap.ss || [], kls = snap.kls || [], losses = snap.losses || [];
      return (
        <Frame c={c} height={H} title="知识蒸馏 · 教师/学生分布与 KL" subtitle={`T=${f2(S(p.temp, 3))} · α=${f2(S(p.alpha, 0.5))} · 步 ${String(snap.t || 0)}`}>
          <Panel c={c} x={20} y={40} w={430} h={246} title="5 类概率分布：教师软标签 vs 学生">
            <text x="34" y="70" fontSize="10" fill={c.muted}>教师（T 越高越平滑）</text>
            <BarRow c={c} values={ts} x={34} y={78} w={402} h={62} maxV={1} colors={ts.map(() => c.primary)} labels={names} />
            <text x="34" y="172" fontSize="10" fill={c.muted}>学生（逐步逼近软标签）</text>
            <BarRow c={c} values={ss} x={34} y={180} w={402} h={62} maxV={1} colors={ss.map(() => c.success)} labels={names} />
            <text x="34" y="266" fontSize="10" fill={c.muted}>教师 logits [{String((snap.teacher || []).map((v) => f2(v)).join(', '))}]</text>
          </Panel>
          <Panel c={c} x={464} y={40} w={238} h={246} title="损失曲线">
            <text x="478" y="70" fontSize="10" fill={c.muted}>KL(教师 ‖ 学生)</text>
            <LineChart c={c} points={kls} x={478} y={78} w={210} h={66} min={0} max={Math.max(0.01, ...kls)} color={c.purple} />
            <text x="478" y="168" fontSize="10" fill={c.muted}>总损失 α·T²·KL + (1−α)·CE</text>
            <LineChart c={c} points={losses} x={478} y={176} w={210} h={66} min={0} max={Math.max(1, ...losses)} color={c.warning} />
            <text x="478" y="266" fontSize="10" fill={c.text}>KL {f3(snap.kl)} · 损失 {f3(snap.loss)}</text>
          </Panel>
          <NoteLine c={c} text={snap.note} y={330} />
        </Frame>
      );
    },
  },

  quantization: {
    params: [
      { key: 'bits', label: '量化位数', type: 'range', min: 2, max: 8, step: 1, default: 4 },
      { key: 'clip', label: '截断范围 ±c', type: 'range', min: 0.5, max: 3, step: 0.5, default: 1.5 },
      { key: 'steps', label: '批次数', type: 'range', min: 20, max: 80, step: 10, default: 40 },
    ],
    height: 330,
    legend: [{ label: 'FP32 权重分布' }, { label: '量化格点' }, { label: '截断区' }, { label: '均方误差' }],
    hint: '把连续浮点权重映射到有限整数格点：q=round(x/scale)，反量化 q·scale；超出 ±c 的值被截断，位数越低误差越大。',

    buildSteps(p) {
      const bits = Math.round(C(p.bits, 2, 8, 4));
      const clip = C(p.clip, 0.5, 3, 1.5);
      const steps = Math.round(C(p.steps, 20, 80, 40));
      const levels = Math.pow(2, bits) - 1;
      const scale = clip / levels;
      const mses = [];
      const frames = [];
      for (let t = 1; t <= steps; t++) {
        const mu = 0.25 * Math.sin(t * 0.14);
        const vals = normal(3127 + t * 97, 64, mu, 0.62);
        const qs = vals.map((v) => C(Math.round(v / scale), -levels, levels, 0));
        const deq = qs.map((q) => q * scale);
        const clipped = vals.filter((v) => Math.abs(v) > clip).length;
        const mse = avg(vals.map((v, i) => (v - deq[i]) ** 2));
        mses.push(mse);
        const range = Math.max(0.01, Math.max(...vals.map(Math.abs)));
        frames.push({
          note: `第 ${t} 批·INT${bits}：scale=${f3(scale)}，${vals.length} 个权重中 ${clipped} 个超出 ±${f2(clip)} 被截断，反量化均方误差 ${f3(mse)}。`,
          t, vals, qs, deq, clipped, mse, mses: mses.slice(), levels, scale, clip, range,
          metrics: { 批次: t, 位数: bits, 格点数: levels + 1, 截断个数: clipped, 均方误差: r3(mse), 动态范围: r3(range) },
        });
      }
      return fit(frames);
    },

    render(snap, p, c) {
      const H = 330;
      const vals = snap.vals || [], deq = snap.deq || [], mses = snap.mses || [];
      const levels = Math.round(S(snap.levels, 15)), scale = Math.max(1e-9, S(snap.scale, 0.1));
      const clip = S(snap.clip, 1.5);
      const bins = hist(vals, 12, -3, 3);
      const maxCount = Math.max(1, ...bins);
      const x0 = 20, y0 = 40, pw = 424, ph = 232;
      const px = (v) => x0 + ((C(v, -3, 3) + 3) / 6) * pw;
      const gridLines = [];
      for (let k = -4; k <= 4; k++) {
        const v = k * scale * Math.max(1, Math.round(levels / 4));
        if (Math.abs(v) > 3) continue;
        gridLines.push(<line key={k} x1={px(v)} y1={y0 + 26} x2={px(v)} y2={y0 + ph - 24} stroke={c.warning} strokeWidth="1" strokeDasharray="3 3" strokeOpacity="0.7" />);
      }
      const deqDots = deq.map((v, i) => (
        <rect key={i} x={px(v) - 2} y={y0 + 28 + (i % 8) * 2} width="4" height="4" rx="1" fill={c.success} opacity="0.6" />
      ));
      return (
        <Frame c={c} height={H} title="量化训练 · FP32 → 低比特整数格点" subtitle={`INT${String(p.bits)} · ±${f2(S(p.clip, 1.5))} · scale=${f3(snap.scale)}`}>
          <Panel c={c} x={x0} y={y0} w={pw} h={ph} title="权重分布（柱）与量化格点（虚线）">
            <rect x={x0 + 6} y={y0 + 26} width={px(-clip) - (x0 + 6)} height={ph - 50} fill={c.danger} opacity="0.08" />
            <rect x={px(clip)} y={y0 + 26} width={x0 + pw - 6 - px(clip)} height={ph - 50} fill={c.danger} opacity="0.08" />
            {gridLines}
            <BarRow c={c} values={bins} x={x0 + 8} y={y0 + 26} w={pw - 16} h={ph - 52} maxV={maxCount}
              colors={bins.map(() => c.primary)} showValues={false} />
            {deqDots}
            <text x={x0 + 10} y={y0 + ph - 8} fontSize="9" fill={c.muted}>← 截断区 · 量化格点间隔 scale={f3(snap.scale)} · 截断区 →</text>
          </Panel>
          <Panel c={c} x={460} y={y0} w={242} h={ph} title="量化误差">
            <LineChart c={c} points={mses} x={474} y={70} w={214} h={90} min={0} max={Math.max(0.001, ...mses)} color={c.danger} />
            <text x="474" y="182" fontSize="10" fill={c.muted}>均方误差（越低越好）</text>
            <text x="474" y="210" fontSize="11" fill={c.muted}>截断权重数</text>
            <text x="690" y="210" fontSize="12" textAnchor="end" fill={c.danger}>{String(snap.clipped || 0)}</text>
            <text x="474" y="236" fontSize="11" fill={c.muted}>当前 MSE</text>
            <text x="690" y="236" fontSize="12" textAnchor="end" fill={c.text}>{f3(snap.mse)}</text>
            <text x="474" y="262" fontSize="10" fill={c.muted}>格点总数 {String(levels * 2 + 1)}</text>
          </Panel>
          <NoteLine c={c} text={snap.note} y={320} />
        </Frame>
      );
    },
  },

  'mixed-precision': {
    params: [
      { key: 'format', label: '计算精度', type: 'select', default: 'fp16', options: [
        { value: 'fp16', label: 'FP16（半精度）' }, { value: 'bf16', label: 'BF16（脑浮点）' },
      ] },
      { key: 'scale', label: '损失缩放因子 S', type: 'select', default: 64, options: [
        { value: 1, label: '1（不缩放）' }, { value: 8, label: '8' }, { value: 64, label: '64' },
        { value: 512, label: '512' }, { value: 1024, label: '1024' },
      ] },
      { key: 'steps', label: '训练步数', type: 'range', min: 20, max: 100, step: 10, default: 50 },
    ],
    height: 340,
    legend: [{ label: '原始梯度 FP32' }, { label: '缩放后梯度' }, { label: '可表示阈值' }, { label: '下溢区' }],
    hint: 'FP16 的梯度太小会下溢成 0：先乘 S 放大再转半精度，反算梯度时除回 S；BF16 指数范围大，通常无需缩放。',

    buildSteps(p) {
      const fmtName = p.format === 'bf16' ? 'bf16' : 'fp16';
      const scale = Math.max(1, Math.round(C(p.scale, 1, 1024, 64)));
      const steps = Math.round(C(p.steps, 20, 100, 50));
      const minNormal = fmtName === 'bf16' ? 1.18e-38 : 6.1e-5;
      const mantissa = fmtName === 'bf16' ? 7 : 10;
      const rnd = mulberry32(7781);
      const gs = [], ss = [], errs = [];
      const frames = [];
      for (let t = 1; t <= steps; t++) {
        const g = 0.004 * Math.exp(-0.11 * t);
        const scaled = g * scale;
        const ok = scaled >= minNormal;
        const quantum = Math.max(1e-30, scaled * Math.pow(2, -(mantissa + 1)));
        const casted = ok ? Math.round(scaled / quantum) * quantum * (0.999 + 0.002 * rnd()) : 0;
        const unscaled = casted / scale;
        const rel = g > 0 ? Math.abs(unscaled - g) / g : 0;
        gs.push(g); ss.push(scaled); errs.push(rel);
        frames.push({
          note: `第 ${t} 步·${fmtName === 'bf16' ? 'BF16' : 'FP16'}：真实梯度 ${Number(g.toPrecision(3))}，乘 S=${scale} 后 ${Number(scaled.toPrecision(3))}，${ok ? '高于最小正规数，可表示' : '低于阈值，下溢为 0'}，还原相对误差 ${f3(rel)}。`,
          t, fmtName, scale, g, scaled, ok, unscaled, rel, minNormal,
          gs: gs.slice(), ss: ss.slice(), errs: errs.slice(),
          metrics: { 步数: t, 缩放因子: scale, 梯度值: Number(g.toPrecision(3)), 缩放后: Number(scaled.toPrecision(3)), 下溢: ok ? 0 : 1, 相对误差: r3(rel) },
        });
      }
      return fit(frames);
    },

    render(snap, p, c) {
      const H = 340;
      const gs = snap.gs || [], ss = snap.ss || [];
      const fmtName = snap.fmtName || 'fp16';
      const scale = Math.round(S(snap.scale, 64));
      const minNormal = S(snap.minNormal, 6.1e-5);
      const LO = -9, HI = -2;
      const ly = (v) => 68 + 156 - ((C(Math.log10(Math.max(1e-12, v)), LO, HI) - LO) / (HI - LO)) * 156;
      const lx = (i, n) => 48 + (i / Math.max(1, n - 1)) * 390;
      const poly = (arr) => arr.map((v, i) => `${lx(i, arr.length).toFixed(1)},${ly(v).toFixed(1)}`).join(' ');
      const thrY = ly(minNormal);
      return (
        <Frame c={c} height={H} title="混合精度 · 损失缩放与下溢" subtitle={`${fmtName === 'bf16' ? 'BF16' : 'FP16'} · S=${String(scale)} · 最小正规数 ${Number(minNormal.toPrecision(2))}`}>
          <Panel c={c} x={20} y={40} w={440} h={230} title="梯度幅值（对数轴 log₁₀）">
            <rect x="46" y={Math.min(224, Math.max(68, thrY))} width="396" height={Math.max(0, 224 - Math.min(224, Math.max(68, thrY)))} fill={c.danger} opacity="0.1" />
            {[-8, -6, -4].map((e) => <line key={e} x1="48" y1={ly(Math.pow(10, e))} x2="438" y2={ly(Math.pow(10, e))} stroke={c.grid} />)}
            {thrY >= 68 && thrY <= 224 ? <line x1="48" y1={thrY} x2="438" y2={thrY} stroke={c.warning} strokeWidth="2" strokeDasharray="5 3" /> : null}
            {gs.length > 1 ? <polyline points={poly(gs)} fill="none" stroke={c.primary} strokeWidth="2" /> : null}
            {ss.length > 1 ? <polyline points={poly(ss)} fill="none" stroke={c.success} strokeWidth="2" strokeDasharray="4 3" /> : null}
            <text x="48" y="260" fontSize="9" fill={c.muted}>10⁻⁹</text>
            <text x="438" y="260" fontSize="9" textAnchor="end" fill={c.muted}>10⁻²</text>
            <text x="48" y="62" fontSize="9" fill={c.warning}>虚线 = 可表示阈值 · 红区 = 下溢</text>
          </Panel>
          <Panel c={c} x={474} y={40} w={228} h={230} title="当前步数值映射">
            <text x="488" y="72" fontSize="10" fill={c.muted}>FP32 主权重梯度</text>
            <text x="688" y="72" fontSize="12" textAnchor="end" fill={c.primary}>{Number(S(snap.g).toPrecision(3))}</text>
            <text x="488" y="102" fontSize="10" fill={c.muted}>× S = {String(scale)}</text>
            <text x="688" y="102" fontSize="12" textAnchor="end" fill={c.success}>{Number(S(snap.scaled).toPrecision(3))}</text>
            <text x="488" y="132" fontSize="10" fill={c.muted}>低精度可表示</text>
            <text x="688" y="132" fontSize="12" textAnchor="end" fill={snap.ok ? c.success : c.danger}>{snap.ok ? '是' : '否（下溢）'}</text>
            <text x="488" y="162" fontSize="10" fill={c.muted}>÷ S 还原梯度</text>
            <text x="688" y="162" fontSize="12" textAnchor="end" fill={c.text}>{Number(S(snap.unscaled).toPrecision(3))}</text>
            <text x="488" y="192" fontSize="10" fill={c.muted}>相对误差</text>
            <text x="688" y="192" fontSize="12" textAnchor="end" fill={c.warning}>{f3(snap.rel)}</text>
            <text x="488" y="224" fontSize="10" fill={c.muted}>{fmtName === 'bf16' ? 'BF16 指数范围大，一般不溢出' : 'FP16 需配合缩放避免下溢'}</text>
          </Panel>
          <NoteLine c={c} text={snap.note} y={330} />
        </Frame>
      );
    },
  },

  // __END__
};

export default CONFIGS;
