import React from 'react';
import { clamp, mulberry32, softmax } from '../utils.js';
import { Frame, fmt } from '../kits/primitives.jsx';
import { PHOTOS } from '../photos/cat-cnn-photos.js';

// 自监督旋转预测：把真实照片旋转 0/90/180/270°，标签从「我们转了多少度」自动生成，
// 全程不用猫/狗/叶的类别标注。卷积核经真实反向传播学出通用特征。

const N = 16, KS = 3, OUT = 14, POOL = 7, CLS = 4;
const H = 470;
const KEYS = ['cat', 'dog', 'leaf'];
const ANGLES = [
  { label: '0°' }, { label: '90°' }, { label: '180°' }, { label: '270°' },
];
const STAGES = ['原图', '随机旋转', '自动打标签', '自监督训练', '迁移价值'];

function rot90(g) {
  const n = g.length;
  return Array.from({ length: n }, (_, r) => Array.from({ length: n }, (_, c) => g[n - 1 - c][r]));
}
function rotate(g, k) {
  let x = g.map((row) => [...row]);
  for (let i = 0; i < k; i++) x = rot90(x);
  return x;
}
function makeData(noise, per = 10) {
  const rnd = mulberry32(2024);
  const data = [];
  for (const key of KEYS) {
    const base = PHOTOS[key].grid;
    for (let ang = 0; ang < 4; ang++) for (let j = 0; j < per; j++) {
      const amp = j === 0 ? 0 : noise;
      const noisy = base.map((row) => row.map((v) => clamp(v + (rnd() - 0.5) * amp, 0, 1)));
      data.push({ g: rotate(noisy, ang), y: ang });
    }
  }
  return data;
}
function initModel(kerns, seed) {
  const rnd = mulberry32(seed);
  const K = Array.from({ length: kerns }, () => Array.from({ length: KS }, () => Array.from({ length: KS }, () => (rnd() - 0.5) * 0.6)));
  const F = POOL * POOL * kerns;
  const W = Array.from({ length: CLS }, () => Array.from({ length: F }, () => (rnd() - 0.5) * 2 / Math.sqrt(F)));
  return { K, W, b: [0, 0, 0, 0] };
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
  const logits = [0, 1, 2, 3].map((cl) => model.b[cl] + flat.reduce((s, v, i) => s + v * model.W[cl][i], 0));
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
function cosine(a, b) {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; na += a[i] ** 2; nb += b[i] ** 2; }
  return clamp(dot / Math.sqrt(Math.max(1e-9, na * nb)), 0, 1);
}
function wrapLines(s, width = 62) {
  const str = String(s || '');
  const out = [];
  for (let i = 0; i < str.length; i += width) out.push(str.slice(i, i + width));
  return out.slice(0, 2);
}

export default {
  id: 'self-supervised-rotation',
  params: [
    { key: 'epochs', label: '训练轮数', type: 'range', min: 60, max: 160, step: 10, default: 120, unit: '轮' },
    { key: 'lr', label: '学习率', type: 'range', min: 0.1, max: 0.8, step: 0.05, default: 0.3 },
    { key: 'kerns', label: '卷积核数', type: 'range', min: 2, max: 8, step: 1, default: 6 },
    { key: 'noise', label: '增强噪声', type: 'range', min: 0, max: 30, step: 5, default: 12, unit: '%' },
    { key: 'focus', label: '聚焦核', type: 'range', min: 1, max: 8, step: 1, default: 1 },
    { key: 'angle', label: '展示旋转角', type: 'select', default: '1', options: [
      { value: '0', label: '0°' }, { value: '1', label: '90°' }, { value: '2', label: '180°' }, { value: '3', label: '270°' },
    ] },
  ],
  height: H,
  legend: [
    { label: '无类别标注', color: '#f5a524' },
    { label: '自监督信号', color: '#378ADD' },
    { label: '学到的特征', color: '#12a06a' },
  ],
  hint: '把真实照片随机旋转 0/90/180/270°，标签直接来自「我们转了多少度」——不需要人工标猫狗叶。CNN 靠预测旋转角学会通用特征，再看这些特征能否把猫狗叶分开。',

  buildSteps(p) {
    const epochs = clamp(Math.round(Number(p.epochs) || 120), 60, 160);
    const lr = clamp(Number(p.lr) || 0.3, 0.1, 0.8);
    const kerns = clamp(Math.round(Number(p.kerns) || 6), 2, 8);
    const noise = clamp(Number(p.noise) || 0, 0, 30) / 100;
    const focus = clamp(Math.round(Number(p.focus) || 1), 1, kerns) - 1;
    const angle = clamp(Math.round(Number(p.angle) || 1), 0, 3);
    const data = makeData(noise);
    let model = initModel(kerns, 777);

    const snapshot = (ep, loss, acc, stage) => {
      const previewG = rotate(PHOTOS.cat.grid, angle);
      const f = forward(previewG, model);
      const feats = KEYS.map((key) => forward(PHOTOS[key].grid, model).flat);
      const cd = cosine(feats[0], feats[1]), cl = cosine(feats[0], feats[2]), dl = cosine(feats[1], feats[2]);
      return {
        ep, loss, acc, stage, angle,
        preview: previewG,
        probs: f.probs,
        map: downAct(f.act, focus),
        kernels: model.K.map((k) => k.map((row) => [...row])),
        sims: [cd, cl, dl],
      };
    };

    const log = [snapshot(0, Math.log(CLS), 1 / CLS, 0)];
    for (let ep = 1; ep <= epochs; ep++) {
      const dW = model.W.map((row) => row.map(() => 0)), db = [0, 0, 0, 0];
      const dK = model.K.map((k) => k.map((row) => row.map(() => 0)));
      let loss = 0, correct = 0;
      for (const sample of data) {
        const f = forward(sample.g, model);
        loss -= Math.log(Math.max(1e-9, f.probs[sample.y]));
        if (f.probs.indexOf(Math.max(...f.probs)) === sample.y) correct++;
        const dl = f.probs.map((v, i) => v - (i === sample.y ? 1 : 0));
        for (let cl = 0; cl < CLS; cl++) {
          db[cl] += dl[cl];
          for (let i = 0; i < f.flat.length; i++) dW[cl][i] += dl[cl] * f.flat[i];
        }
        const dpool = Array.from({ length: POOL }, () => Array.from({ length: POOL }, () => new Array(kerns).fill(0)));
        for (let r = 0; r < POOL; r++) for (let c = 0; c < POOL; c++) for (let o = 0; o < kerns; o++) {
          let s = 0;
          for (let cl = 0; cl < CLS; cl++) s += dl[cl] * model.W[cl][(r * POOL + c) * kerns + o];
          dpool[r][c][o] = s;
        }
        const dact = Array.from({ length: OUT }, () => Array.from({ length: OUT }, () => new Array(kerns).fill(0)));
        for (let r = 0; r < OUT; r++) for (let c = 0; c < OUT; c++) for (let o = 0; o < kerns; o++) {
          dact[r][c][o] = f.mask[r][c][o] * dpool[Math.floor(r / 2)][Math.floor(c / 2)][o] * (f.pre[r][c][o] > 0 ? 1 : 0);
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
      log.push(snapshot(ep, loss / n, correct / n, 3));
    }

    const frameCount = 50;
    const idxs = [...new Set(Array.from({ length: frameCount }, (_, i) => Math.round(i * (log.length - 1) / (frameCount - 1))))];
    if (idxs[idxs.length - 1] !== log.length - 1) idxs.push(log.length - 1);
    return idxs.map((gi, frameIdx) => {
      const s = log[gi];
      const first = frameIdx === 0, last = frameIdx === idxs.length - 1;
      return {
        ...s,
        history: log.slice(0, gi + 1).map((h) => ({ ep: h.ep, loss: h.loss, acc: h.acc })),
        stage: first ? 1 : last ? 4 : s.stage,
        note: first
          ? `取真实照片，随机旋转 ${ANGLES[angle].label}。标签不需要人来标：我们把图转了多少度，答案就是几——这就是自监督的「监督信号」。此时卷积核随机初始化，对角度基本瞎猜（各 25%）。`
          : last
            ? `${epochs} 轮自监督训练结束：角度识别准确率 ${fmt(s.acc * 100, 0)}%，全程没用过猫/狗/叶标签。更关键的是——用学到的特征看三类图，两两余弦相似度降到 ${s.sims.map((v) => fmt(v, 2)).join(' / ')}，说明特征已经能区分它们，可直接迁移到下游分类。`
            : `第 ${s.ep}/${epochs} 轮：网络猜旋转角 → 和真实旋转量比对算损失 ${fmt(s.loss, 3)} → 反向传播 → SGD 更新核。它被迫学会边缘方向和纹理——这些正是识别猫狗叶所需的通用特征。`,
        metrics: {
          轮次: s.ep,
          角度损失: Number(s.loss.toFixed(4)),
          角度准确率: Number(s.acc.toFixed(3)),
          特征相似度猫狗: Number(s.sims[0].toFixed(3)),
        },
      };
    });
  },

  render(snap, p, c) {
    const hist = Array.isArray(snap.history) ? snap.history : [];
    const kernels = Array.isArray(snap.kernels) ? snap.kernels : [];
    const probs = Array.isArray(snap.probs) ? snap.probs : [0.25, 0.25, 0.25, 0.25];
    const map = Array.isArray(snap.map) ? snap.map : [];
    const preview = Array.isArray(snap.preview) ? snap.preview : PHOTOS.cat.grid;
    const sims = Array.isArray(snap.sims) ? snap.sims : [1, 1, 1];
    const stage = clamp(Number(snap.stage) || 0, 0, 4);
    const angle = clamp(Number(snap.angle) || 0, 0, 3);
    const ep = Number(snap.ep) || 0;

    const pipeline = STAGES.map((name, i) => {
      const x = 20 + i * 136;
      const on = stage === i, done = stage > i;
      return (
        <g key={`st-${i}`}>
          <rect x={x} y="36" width="122" height="26" rx="5" fill={on ? c.warning : done ? c.success : c.panel2} opacity={on ? 0.95 : 0.85} />
          <text x={x + 8} y="53" fontSize="10" fill={on || done ? c.bg : c.text} fontWeight="600">{String(name)}</text>
          {i < 4 ? <path d={`M${x + 124},49 l7,-4 l0,8 z`} fill={c.accent} /> : null}
        </g>
      );
    });

    const px = preview.map((row, r) => row.map((v, col) => (
      <rect key={`px-${r}-${col}`} x={20 + col * 4.5} y={88 + r * 4.5} width="4" height="4"
        fill={c.primary} opacity={0.05 + 0.9 * clamp(Number(v) || 0, 0, 1)} />
    )));
    const kernelG = kernels.map((ker, o) => {
      const x = 100 + o * 58, y = 100;
      return (
        <g key={`k-${o}`}>
          <rect x={x - 2} y={y - 14} width="54" height="56" rx="4" fill={c.panel2} opacity="0.5" />
          <text x={x} y={y - 4} fontSize="8" fill={c.muted}>{`核 ${o + 1}`}</text>
          {ker.map((row, r) => row.map((v, col) => (
            <g key={`kc-${r}-${col}`}>
              <rect x={x + col * 17} y={y + r * 17} width="16" height="16" rx="2"
                fill={Number(v) >= 0 ? c.success : c.danger} opacity={0.12 + 0.8 * clamp(Math.abs(Number(v)) / 2, 0, 1)} />
              <text x={x + col * 17 + 8} y={y + r * 17 + 11} fontSize="7" textAnchor="middle" fill={c.text}>{fmt(v, 1)}</text>
            </g>
          )))}
        </g>
      );
    });

    const maxI = Math.max(1, hist.length - 1);
    const maxLoss = Math.max(1.5, ...hist.map((h) => h.loss));
    const cx = (i) => 436 + (i / maxI) * 250;
    const cyL = (v) => 214 - (clamp(v, 0, maxLoss) / maxLoss) * 116;
    const cyA = (v) => 214 - clamp(v, 0, 1) * 116;
    const curves = (
      <g>
        <rect x="430" y="88" width="264" height="140" rx="6" fill={c.panel2} opacity="0.4" />
        {[0, 1, 2, 3, 4].map((i) => <line key={`cg-${i}`} x1="436" y1={98 + i * 29} x2="690" y2={98 + i * 29} stroke={c.grid} />)}
        <polyline points={hist.map((h, i) => `${cx(i)},${cyL(h.loss)}`).join(' ')} fill="none" stroke={c.danger} strokeWidth="2" />
        <polyline points={hist.map((h, i) => `${cx(i)},${cyA(h.acc)}`).join(' ')} fill="none" stroke={c.success} strokeWidth="2" />
        <text x="436" y="98" fontSize="9" fill={c.danger}>{`损失 ${fmt(snap.loss, 3)}`}</text>
        <text x="560" y="98" fontSize="9" fill={c.success}>{`角度准确率 ${fmt((snap.acc || 0) * 100, 0)}%`}</text>
        <text x="436" y="222" fontSize="9" fill={c.muted}>0</text>
        <text x="690" y="222" fontSize="9" textAnchor="end" fill={c.muted}>{`第 ${ep} 轮`}</text>
      </g>
    );

    const mapCells = map.map((row, r) => row.map((v, col) => (
      <rect key={`m-${r}-${col}`} x={20 + col * 8} y={196 + r * 8} width="7" height="7" rx="1"
        fill={c.success} opacity={0.05 + 0.9 * clamp(Number(v) || 0, 0, 1)} />
    )));
    const probBars = ANGLES.map((a, i) => {
      const v = clamp(Number(probs[i]) || 0, 0, 1);
      const y = 258 + i * 30;
      const isTruth = i === angle;
      return (
        <g key={`pb-${i}`}>
          <text x="100" y={y + 9} fontSize="10" fill={isTruth ? c.warning : c.muted}>{`${String(a.label)}${isTruth ? ' ←真实' : ''}`}</text>
          <rect x="180" y={y} width="160" height="13" rx="4" fill={c.panel2} />
          <rect x="180" y={y} width={160 * v} height="13" rx="4" fill={isTruth ? c.success : c.series[i % c.series.length]} opacity="0.92" />
          <text x="350" y={y + 11} fontSize="9" textAnchor="end" fill={c.text}>{fmt(v * 100, 1)}%</text>
        </g>
      );
    });
    const simBars = [
      { label: '猫 ↔ 狗', v: sims[0] },
      { label: '猫 ↔ 叶', v: sims[1] },
      { label: '狗 ↔ 叶', v: sims[2] },
    ].map((s, i) => {
      const y = 258 + i * 30;
      return (
        <g key={`sim-${i}`}>
          <text x="436" y={y + 9} fontSize="10" fill={c.muted}>{String(s.label)}</text>
          <rect x="510" y={y} width="150" height="13" rx="4" fill={c.panel2} />
          <rect x="510" y={y} width={150 * clamp(Number(s.v) || 0, 0, 1)} height="13" rx="4" fill={c.warning} opacity="0.9" />
          <text x="690" y={y + 11} fontSize="9" textAnchor="end" fill={c.text}>{fmt(s.v, 2)}</text>
        </g>
      );
    });

    const notes = wrapLines(snap.note, 64);
    return (
      <Frame c={c} height={H} title="自监督 · 靠旋转自己给自己造标签"
        subtitle={`第 ${ep} 轮 · 真实照片旋转增强 · 无类别标注`}>
        {pipeline}
        <text x="20" y="80" fontSize="10" fill={c.muted}>{`旋转 ${ANGLES[angle].label} 后的猫图（16×16）`}</text>
        {px}
        <text x="100" y="80" fontSize="10" fill={c.muted}>卷积核权重（正绿/负红）</text>
        {kernelG}
        <text x="20" y="188" fontSize="9" fill={c.muted}>聚焦核响应图（8×8）</text>
        {mapCells}
        <text x="430" y="80" fontSize="10" fill={c.muted}>损失与角度准确率</text>
        {curves}
        <text x="100" y="246" fontSize="10" fill={c.muted}>旋转角预测（★ = 真实角度）</text>
        {probBars}
        <text x="436" y="246" fontSize="10" fill={c.muted}>迁移价值：三类图特征相似度（越低越可分）</text>
        {simBars}
        <line x1="20" y1="386" x2="700" y2="386" stroke={c.grid} />
        {notes.map((ln, i) => <text key={`nt-${i}`} x="20" y={404 + i * 16} fontSize="10" fill={c.text}>{String(ln)}</text>)}
        <text x="20" y="452" fontSize="9" fill={c.muted}>
          {`标签来自旋转操作本身（0/90/180/270°），无需人工标注；Conv3×3 → ReLU → MaxPool → FC4，交叉熵 + SGD。相似度基于展平特征。`}
        </text>
      </Frame>
    );
  },
};
