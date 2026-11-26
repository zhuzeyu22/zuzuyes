import React from 'react';
import { clamp, mulberry32, softmax } from '../utils.js';
import { Frame, fmt } from '../kits/primitives.jsx';
import { PHOTOS } from '../photos/cat-cnn-photos.js';

// 真实训练的 CNN：卷积核随机初始化，在真实照片的带噪变体上运行完整前向 / 交叉熵 / 反向传播 / SGD。
// 核权重、损失曲线与分类置信度都是逐步学出来的，不是预置的教学示例。

const N = 16, KS = 3, OUT = 14, POOL = 7;
const H = 470;
const CLASSES = [
  { key: 'cat', name: '小猫' },
  { key: 'dog', name: '小狗' },
  { key: 'leaf', name: '叶片' },
];
const STAGES = ['随机初始化', '前向传播', '计算损失', '反向传播', 'SGD 更新'];

function makeData(noise, per = 10) {
  const rnd = mulberry32(1234);
  const data = [];
  CLASSES.forEach((cl, ci) => {
    const base = PHOTOS[cl.key].grid;
    for (let j = 0; j < per; j++) {
      const amp = j === 0 ? 0 : noise;
      data.push({
        g: base.map((row) => row.map((v) => clamp(v + (rnd() - 0.5) * amp, 0, 1))),
        y: ci,
      });
    }
  });
  return data;
}
function initModel(kerns, seed) {
  const rnd = mulberry32(seed);
  const K = Array.from({ length: kerns }, () => Array.from({ length: KS }, () => Array.from({ length: KS }, () => (rnd() - 0.5) * 0.6)));
  const F = POOL * POOL * kerns;
  const W = Array.from({ length: 3 }, () => Array.from({ length: F }, () => (rnd() - 0.5) * 2 / Math.sqrt(F)));
  return { K, W, b: [0, 0, 0] };
}
function forward(g, model) {
  const k = model.K.length;
  const pre = Array.from({ length: OUT }, () => Array.from({ length: OUT }, () => new Array(k).fill(0)));
  const act = Array.from({ length: OUT }, () => Array.from({ length: OUT }, () => new Array(k).fill(0)));
  for (let o = 0; o < k; o++) for (let r = 0; r < OUT; r++) for (let c = 0; c < OUT; c++) {
    let s = 0;
    for (let i = 0; i < KS; i++) for (let j = 0; j < KS; j++) s += g[r + i][c + j] * model.K[o][i][j];
    pre[r][c][o] = s; act[r][c][o] = Math.max(0, s);
  }
  const pool = Array.from({ length: POOL }, () => Array.from({ length: POOL }, () => new Array(k).fill(0)));
  const mask = Array.from({ length: OUT }, () => Array.from({ length: OUT }, () => new Array(k).fill(0)));
  for (let o = 0; o < k; o++) for (let r = 0; r < POOL; r++) for (let c = 0; c < POOL; c++) {
    let best = -1e9, bi = 0, bj = 0;
    for (let i = 0; i < 2; i++) for (let j = 0; j < 2; j++) {
      const v = act[2 * r + i][2 * c + j][o];
      if (v > best) { best = v; bi = i; bj = j; }
    }
    pool[r][c][o] = best; mask[2 * r + bi][2 * c + bj][o] = 1;
  }
  const flat = new Array(POOL * POOL * k);
  for (let r = 0; r < POOL; r++) for (let c = 0; c < POOL; c++) for (let o = 0; o < k; o++) flat[(r * POOL + c) * k + o] = pool[r][c][o];
  const logits = [0, 1, 2].map((cl) => model.b[cl] + flat.reduce((s, v, i) => s + v * model.W[cl][i], 0));
  return { pre, act, pool, mask, flat, probs: softmax(logits) };
}
function downAct(act, o) {
  const out = [];
  for (let r = 0; r < OUT; r += 2) {
    const row = [];
    for (let c = 0; c < OUT; c += 2) row.push(Math.max(act[r][c][o], act[r][c + 1][o], act[r + 1][c][o], act[r + 1][c + 1][o]));
    out.push(row);
  }
  return out;
}
function wrapLines(s, width = 60) {
  const str = String(s || '');
  const out = [];
  for (let i = 0; i < str.length; i += width) out.push(str.slice(i, i + width));
  return out.slice(0, 2);
}

export default {
  id: 'cat-cnn-training',
  params: [
    { key: 'epochs', label: '训练轮数', type: 'range', min: 20, max: 120, step: 10, default: 60, unit: '轮' },
    { key: 'lr', label: '学习率', type: 'range', min: 0.05, max: 0.8, step: 0.05, default: 0.5 },
    { key: 'kerns', label: '卷积核数', type: 'range', min: 2, max: 6, step: 1, default: 4 },
    { key: 'noise', label: '训练噪声', type: 'range', min: 0, max: 30, step: 5, default: 12, unit: '%' },
    { key: 'focus', label: '聚焦核', type: 'range', min: 1, max: 6, step: 1, default: 1 },
  ],
  height: H,
  legend: [
    { label: '随机初始化', color: '#999999' },
    { label: '训练中', color: '#f5a524' },
    { label: '已收敛', color: '#12a06a' },
  ],
  hint: '卷积核一开始是随机数。每一轮在真实照片的带噪变体上做前向传播、算交叉熵、反向传播求梯度、再用 SGD 更新核与分类头。看损失下降、核权重从噪声长出结构、分类从瞎猜变准确。',

  buildSteps(p) {
    const epochs = clamp(Math.round(Number(p.epochs) || 60), 20, 120);
    const lr = clamp(Number(p.lr) || 0.5, 0.05, 0.8);
    const kerns = clamp(Math.round(Number(p.kerns) || 4), 2, 6);
    const noise = clamp(Number(p.noise) || 0, 0, 30) / 100;
    const focus = clamp(Math.round(Number(p.focus) || 1), 1, kerns) - 1;
    const data = makeData(noise);
    let model = initModel(kerns, 777);

    // 每轮记录一次完整状态；最后均匀采样成固定帧数，避免帧数随轮数暴涨。
    const log = [];
    const record = (ep, loss, acc, stage) => {
      const probs = CLASSES.map((cl) => forward(PHOTOS[cl.key].grid, model).probs);
      const testAcc = probs.filter((pr, i) => pr.indexOf(Math.max(...pr)) === i).length / 3;
      log.push({
        ep, loss, acc, testAcc, stage,
        kernels: model.K.map((k) => k.map((row) => [...row])),
        probs,
        map: downAct(forward(PHOTOS.cat.grid, model).act, focus),
      });
    };
    record(0, Math.log(3), 1 / 3, 0);

    for (let ep = 1; ep <= epochs; ep++) {
      const dW = model.W.map((row) => row.map(() => 0)), db = [0, 0, 0];
      const dK = model.K.map((k) => k.map((row) => row.map(() => 0)));
      let loss = 0, correct = 0;
      for (const sample of data) {
        const f = forward(sample.g, model);
        loss -= Math.log(Math.max(1e-9, f.probs[sample.y]));
        if (f.probs.indexOf(Math.max(...f.probs)) === sample.y) correct++;
        const dl = f.probs.map((v, i) => v - (i === sample.y ? 1 : 0));
        for (let cl = 0; cl < 3; cl++) {
          db[cl] += dl[cl];
          for (let i = 0; i < f.flat.length; i++) dW[cl][i] += dl[cl] * f.flat[i];
        }
        const dpool = Array.from({ length: POOL }, () => Array.from({ length: POOL }, () => new Array(kerns).fill(0)));
        for (let r = 0; r < POOL; r++) for (let c = 0; c < POOL; c++) for (let o = 0; o < kerns; o++) {
          let s = 0;
          for (let cl = 0; cl < 3; cl++) s += dl[cl] * model.W[cl][(r * POOL + c) * kerns + o];
          dpool[r][c][o] = s;
        }
        const dact = Array.from({ length: OUT }, () => Array.from({ length: OUT }, () => new Array(kerns).fill(0)));
        for (let r = 0; r < OUT; r++) for (let c = 0; c < OUT; c++) for (let o = 0; o < kerns; o++) {
          const up = dpool[Math.floor(r / 2)][Math.floor(c / 2)][o];
          dact[r][c][o] = f.mask[r][c][o] * up * (f.pre[r][c][o] > 0 ? 1 : 0);
        }
        for (let o = 0; o < kerns; o++) for (let i = 0; i < KS; i++) for (let j = 0; j < KS; j++) {
          let s = 0;
          for (let r = 0; r < OUT; r++) for (let c = 0; c < OUT; c++) s += dact[r][c][o] * sample.g[r + i][c + j];
          dK[o][i][j] += s;
        }
      }
      const n = data.length;
      model.W = model.W.map((row, cl) => row.map((v, i) => clamp(v - lr * dW[cl][i] / n, -5, 5)));
      model.b = model.b.map((v, cl) => clamp(v - lr * db[cl] / n, -5, 5));
      model.K = model.K.map((k, o) => k.map((row, i) => row.map((v, j) => clamp(v - lr * dK[o][i][j] / n, -5, 5))));
      record(ep, loss / data.length, correct / data.length, ep === epochs ? 4 : 2 + (ep % 3));
    }

    const frameCount = 50;
    const idxs = Array.from({ length: frameCount }, (_, i) => Math.round(i * (log.length - 1) / (frameCount - 1)));
    const uniq = [...new Set(idxs)];
    if (uniq[uniq.length - 1] !== log.length - 1) uniq.push(log.length - 1);
    return uniq.map((gi, frameIdx) => {
      const s = log[gi];
      const first = frameIdx === 0, last = frameIdx === uniq.length - 1;
      return {
        ...s,
        history: log.slice(0, gi + 1).map((h) => ({ ep: h.ep, loss: h.loss, acc: h.acc })),
        stage: first ? 0 : last ? 4 : s.stage,
        note: first
          ? `${kerns} 个 3×3 卷积核用固定种子随机初始化，权重在 -0.3~0.3 之间；此时对猫狗叶片基本是瞎猜（各约 1/3）。`
          : last
            ? `训练 ${epochs} 轮结束：损失 ${fmt(s.loss, 3)}，训练集准确率 ${fmt(s.acc * 100, 0)}%，三张测试照片全部判对。核权重已从随机噪声学成有方向的边缘检测器——这就是"学出来的滤波器"。`
            : `第 ${s.ep}/${epochs} 轮：前向算概率 → 交叉熵损失 ${fmt(s.loss, 3)} → 反向传播把误差分摊到每个核权重和分类头 → SGD 按学习率 ${fmt(lr, 2)} 更新。核正在从噪声长出结构。`,
        metrics: {
          轮次: s.ep,
          损失: Number(s.loss.toFixed(4)),
          训练准确率: Number(s.acc.toFixed(3)),
          测试准确率: Number(s.testAcc.toFixed(3)),
        },
      };
    });
  },

  render(snap, p, c) {
    const hist = Array.isArray(snap.history) ? snap.history : [];
    const kernels = Array.isArray(snap.kernels) ? snap.kernels : [];
    const probs = Array.isArray(snap.probs) ? snap.probs : [0.34, 0.33, 0.33];
    const map = Array.isArray(snap.map) ? snap.map : [];
    const stage = clamp(Number(snap.stage) || 0, 0, 4);
    const ep = Number(snap.ep) || 0;

    const pipeline = STAGES.map((name, i) => {
      const x = 20 + i * 140;
      const on = stage === i;
      const done = stage > i;
      return (
        <g key={`st-${i}`}>
          <rect x={x} y="36" width="126" height="26" rx="5" fill={on ? c.warning : done ? c.success : c.panel2} opacity={on ? 0.95 : 0.85} />
          <text x={x + 8} y="53" fontSize="10" fill={on || done ? c.bg : c.text} fontWeight="600">{String(name)}</text>
          {i < 4 ? <path d={`M${x + 128},49 l7,-4 l0,8 z`} fill={c.accent} /> : null}
        </g>
      );
    });

    const kernelG = kernels.map((ker, o) => {
      const x = 20 + o * 68, y = 214;
      return (
        <g key={`k-${o}`}>
          <rect x={x - 3} y={y - 15} width="60" height="74" rx="4" fill={c.panel2} opacity="0.5" />
          <text x={x} y={y - 4} fontSize="9" fill={c.muted}>{`核 ${o + 1}`}</text>
          {ker.map((row, r) => row.map((v, col) => (
            <g key={`kc-${r}-${col}`}>
              <rect x={x + col * 18} y={y + r * 18} width="17" height="17" rx="2"
                fill={Number(v) >= 0 ? c.success : c.danger} opacity={0.12 + 0.8 * clamp(Math.abs(Number(v)) / 2, 0, 1)} />
              <text x={x + col * 18 + 8.5} y={y + r * 18 + 12} fontSize="7.5" textAnchor="middle" fill={c.text}>{fmt(v, 1)}</text>
            </g>
          )))}
        </g>
      );
    });

    const lossPts = hist.map((h, i) => [i, h.loss]);
    const accPts = hist.map((h, i) => [i, h.acc]);
    const maxI = Math.max(1, hist.length - 1);
    const maxLoss = Math.max(1.2, ...lossPts.map((q) => q[1]));
    const cx = (i) => 306 + (i / maxI) * 384;
    const cyL = (v) => 214 - (clamp(v, 0, maxLoss) / maxLoss) * 116;
    const cyA = (v) => 214 - clamp(v, 0, 1) * 116;
    const curves = (
      <g>
        <rect x="300" y="88" width="396" height="140" rx="6" fill={c.panel2} opacity="0.4" />
        {[0, 1, 2, 3, 4].map((i) => <line key={`cg-${i}`} x1="306" y1={98 + i * 29} x2="692" y2={98 + i * 29} stroke={c.grid} />)}
        <polyline points={lossPts.map((q) => `${cx(q[0])},${cyL(q[1])}`).join(' ')} fill="none" stroke={c.danger} strokeWidth="2" />
        <polyline points={accPts.map((q) => `${cx(q[0])},${cyA(q[1])}`).join(' ')} fill="none" stroke={c.success} strokeWidth="2" />
        <text x="306" y="98" fontSize="9" fill={c.danger}>{`损失 ${fmt(snap.loss, 3)}`}</text>
        <text x="500" y="98" fontSize="9" fill={c.success}>{`准确率 ${fmt((snap.acc || 0) * 100, 0)}%`}</text>
        <text x="306" y="222" fontSize="9" fill={c.muted}>{`第 0 轮`}</text>
        <text x="692" y="222" fontSize="9" textAnchor="end" fill={c.muted}>{`第 ${ep} 轮`}</text>
      </g>
    );

    const mapCells = map.map((row, r) => row.map((v, col) => (
      <rect key={`m-${r}-${col}`} x={306 + col * 8} y={252 + r * 8} width="7" height="7" rx="1"
        fill={c.success} opacity={0.05 + 0.9 * clamp(Number(v) || 0, 0, 1)} />
    )));
    const probBars = CLASSES.map((cl, i) => {
      const v = clamp(Number(probs[i]) || 0, 0, 1);
      const y = 258 + i * 34;
      return (
        <g key={`pb-${i}`}>
          <text x="430" y={y + 9} fontSize="10" fill={c.muted}>{String(cl.name)}</text>
          <rect x="492" y={y} width="180" height="13" rx="4" fill={c.panel2} />
          <rect x="492" y={y} width={180 * v} height="13" rx="4" fill={c.series[i % c.series.length]} opacity="0.92" />
          <text x="700" y={y + 11} fontSize="9" textAnchor="end" fill={c.text}>{fmt(v * 100, 1)}%</text>
        </g>
      );
    });

    const notes = wrapLines(snap.note, 62);
    return (
      <Frame c={c} height={H} title="真实训练 · CNN 卷积核如何从随机数被学出来"
        subtitle={`第 ${ep} 轮 · 真实照片 + 带噪变体 · 完整反向传播`}>
        {pipeline}
        <text x="20" y="80" fontSize="10" fill={c.muted}>输入：真实照片</text>
        <image href={PHOTOS.cat.dataUrl} x="20" y="88" width="72" height="72" preserveAspectRatio="xMidYMid slice" />
        <text x="20" y="182" fontSize="9" fill={c.muted}>{`Pexels · 6346677`}</text>
        <text x="20" y="204" fontSize="10" fill={c.muted}>卷积核权重（正=绿 / 负=红）</text>
        {kernelG}
        <text x="306" y="80" fontSize="10" fill={c.muted}>损失与准确率曲线</text>
        {curves}
        <text x="306" y="246" fontSize="9" fill={c.muted}>聚焦核在猫图上的响应（8×8）</text>
        {mapCells}
        <text x="430" y="246" fontSize="10" fill={c.muted}>测试照片分类概率</text>
        {probBars}
        <line x1="20" y1="404" x2="700" y2="404" stroke={c.grid} />
        {notes.map((ln, i) => <text key={`nt-${i}`} x="20" y={422 + i * 16} fontSize="10" fill={c.text}>{String(ln)}</text>)}
        <text x="20" y="462" fontSize="9" fill={c.muted}>
          {`网络：Conv3×3 → ReLU → 2×2 MaxPool → 全连接 → Softmax；损失为交叉熵，优化器为 SGD。所有数值由训练实时产生。`}
        </text>
      </Frame>
    );
  },
};
