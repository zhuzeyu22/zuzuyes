import React from 'react';
import { mulberry32, clamp, makePoints, softmax } from '../utils.js';
import { num, fmt, Frame } from '../kits/primitives.jsx';
import { datasetParam, scatterPoints, vectorData, dataNote } from '../datasets/adapter.js';

// 机器学习演示配置集合：每个 demo 都是 { params, height, legend, hint, buildSteps, render }。
// 所有随机性都来自确定性种子；buildSteps / render 均为纯函数。

const W = 720, H = 320;
const PX0 = 26, PX1 = 352, PY0 = 50, PY1 = 262;
const CX0 = 386, CX1 = 700, CY0 = 50, CY1 = 262;

function safe(v, fb = 0) {
  const n = Number(v);
  if (!Number.isFinite(n)) return fb;
  return Math.max(-1e9, Math.min(1e9, n));
}
function gauss(rnd) {
  const u = Math.max(1e-9, rnd()), v = rnd();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}
function dXY(pts, fx, fy) {
  return pts.map((q, i) => `${i === 0 ? 'M' : 'L'}${safe(fx(q[0], i)).toFixed(1)},${safe(fy(q[1], i)).toFixed(1)}`).join(' ');
}
function dVals(vals, fx, fy) {
  return vals.map((v, i) => `${i === 0 ? 'M' : 'L'}${safe(fx(i)).toFixed(1)},${safe(fy(v, i)).toFixed(1)}`).join(' ');
}
function Box({ c, x, y, w, h, title, sub }) {
  return (
    <g>
      <rect x={x} y={y} width={w} height={h} fill={c.panel} stroke={c.border} />
      <text x={x} y={y - 8} fontSize="11" fill={c.muted}>{String(title || '')}</text>
      {sub ? <text x={x + w} y={y - 8} fontSize="9" textAnchor="end" fill={c.muted}>{String(sub)}</text> : null}
    </g>
  );
}
function Foot({ c, text }) {
  return <text x="18" y={H - 10} fontSize="11" fill={c.text}>{String(text || '')}</text>;
}
function gini(cnt0, cnt1) {
  const n = cnt0 + cnt1;
  if (n === 0) return 0;
  const q = cnt1 / n;
  return 1 - q * q - (1 - q) * (1 - q);
}

// ── 1. 朴素贝叶斯：先验 → 逐词似然 → 后验累加 ──────────────────────────────
const NB_WORDS = ['折扣', '免费', '中奖', '会议', '项目', '报告'];
const NB_QW = [0, 1, 2, 4, 5];
function nbGenDocs(n, seed) {
  const rnd = mulberry32(seed >>> 0);
  const spamP = [0.55, 0.6, 0.5, 0.12, 0.15, 0.1];
  const hamP = [0.15, 0.12, 0.08, 0.55, 0.5, 0.45];
  return Array.from({ length: n }, (_, i) => {
    const cls = i % 2;
    const probs = cls === 0 ? spamP : hamP;
    const words = [];
    for (let j = 0; j < NB_WORDS.length; j++) if (rnd() < probs[j]) words.push(j);
    if (words.length === 0) words.push(cls === 0 ? 3 : 0);
    return { cls, words };
  });
}

// ── 2. 随机森林：Bagging + 随机特征子空间的决策桩集成 ──────────────────────
function rfStump(pts, idx, rnd) {
  const f = rnd() < 0.5 ? 0 : 1;
  const lo = -1.25, hi = 1.25;
  let best = null;
  for (let t = 1; t <= 10; t++) {
    const thr = lo + (2.5 * t) / 11;
    let c0 = [0, 0], c1 = [0, 0];
    for (const i of idx) {
      const v = f === 0 ? pts[i].x : pts[i].y;
      const side = v <= thr ? c0 : c1;
      side[pts[i].cls] += 1;
    }
    const n0 = c0[0] + c0[1], n1 = c1[0] + c1[1];
    if (n0 === 0 || n1 === 0) continue;
    const gain = gini(c0[0], c0[1]) * (n0 / idx.length) + gini(c1[0], c1[1]) * (n1 / idx.length);
    if (!best || gain < best.gain) best = { f, thr, gain, n0, n1, c0, c1 };
  }
  if (!best) return { f, thr: 0, p0: 0.5, p1: 0.5 };
  const p0 = best.c0[1] / Math.max(1, best.n0);
  const p1 = best.c1[1] / Math.max(1, best.n1);
  return { f, thr: best.thr, p0, p1 };
}
function rfPredict(tree, pt) {
  const v = tree.f === 0 ? pt.x : pt.y;
  return v <= tree.thr ? tree.p0 : tree.p1;
}

// ── 3. AdaBoost：样本权重 + 加权弱分类器 ──────────────────────────────────
function abStump(xs, ys, w) {
  let best = null;
  const n = xs.length;
  for (let k = 1; k < n; k++) {
    const thr = (xs[k - 1] + xs[k]) / 2;
    for (const polarity of [-1, 1]) {
      let err = 0;
      for (let i = 0; i < n; i++) {
        const h = (xs[i] < thr ? -1 : 1) * polarity;
        if (h !== ys[i]) err += w[i];
      }
      if (!best || err < best.err) best = { thr, polarity, err };
    }
  }
  best.err = clamp(best.err, 1e-6, 1 - 1e-6);
  return best;
}
function abPredict(stump, x) {
  return (x < stump.thr ? -1 : 1) * stump.polarity;
}

// ── 4. XGBoost：二阶梯度 + 正则化分裂增益 ─────────────────────────────────
function gbTruth(x) { return 0.9 * Math.sin(2.8 * x) + 0.35 * x; }
function xgbTree(xs, g, depth, lambda, gamma) {
  let leaves = [{ lo: -1.1, hi: 1.1, idx: xs.map((_, i) => i), w: 0, gain: 0 }];
  const splits = [];
  for (let d = 0; d < depth; d++) {
    const next = [];
    for (const leaf of leaves) {
      if (leaf.idx.length < 6) { next.push(leaf); continue; }
      const sorted = leaf.idx.slice().sort((a, b) => xs[a] - xs[b]);
      const G = sorted.reduce((s, i) => s + g[i], 0);
      const H = sorted.length;
      let best = null;
      for (let k = 1; k <= 8; k++) {
        const pos = Math.floor((sorted.length * k) / 9);
        if (pos === 0 || pos >= sorted.length) continue;
        const L = sorted.slice(0, pos), R = sorted.slice(pos);
        const GL = L.reduce((s, i) => s + g[i], 0), GR = G - GL;
        const HL = L.length, HR = H - HL;
        const gain = 0.5 * ((GL * GL) / (HL + lambda) + (GR * GR) / (HR + lambda) - (G * G) / (H + lambda)) - gamma;
        if (gain > 1e-9 && (!best || gain > best.gain)) best = { thr: xs[sorted[pos]], gain, L, R, GL, GR, HL, HR };
      }
      if (!best) { next.push(leaf); continue; }
      const wL = -best.GL / (best.HL + lambda), wR = -best.GR / (best.HR + lambda);
      const a = { lo: leaf.lo, hi: best.thr, idx: best.L, w: wL, gain: best.gain };
      const b = { lo: best.thr, hi: leaf.hi, idx: best.R, w: wR, gain: best.gain };
      splits.push({ thr: best.thr, gain: best.gain, depth: d, lo: leaf.lo, hi: leaf.hi });
      next.push(a, b);
    }
    leaves = next;
  }
  return { leaves, splits };
}
function xgbEval(leaves, x) {
  for (const lf of leaves) if (x >= lf.lo && x <= lf.hi) return lf.w;
  return 0;
}

export default {
  'naive-bayes': {
    params: [
      { key: 'n', label: '训练文档数', type: 'range', min: 20, max: 80, step: 1, default: 40 },
      { key: 'alpha', label: '拉普拉斯平滑 α', type: 'range', min: 0.2, max: 3, step: 0.1, default: 1 },
      { key: 'queryLen', label: '待分类词数', type: 'range', min: 1, max: 5, step: 1, default: 3 },
      { key: 'seed', label: '随机种子', type: 'range', min: 1, max: 40, step: 1, default: 9 },
    ],
    height: H,
    legend: [
      { label: '垃圾邮件似然' }, { label: '正常邮件似然' }, { label: '后验概率' }, { label: '对数得分' },
    ],
    hint: '先统计先验与每个词的类条件似然（含拉普拉斯平滑），再对查询文档逐词累加对数似然得到后验。',

    buildSteps(p) {
      const n = clamp(Math.round(num(p.n, 40)), 20, 80);
      const alpha = clamp(num(p.alpha, 1), 0.2, 3);
      const qLen = clamp(Math.round(num(p.queryLen, 3)), 1, 5);
      const seed = num(p.seed, 9) >>> 0;
      const docs = nbGenDocs(n, seed);
      const V = NB_WORDS.length;
      const qset = NB_QW.slice(0, qLen);
      const clsCnt = [0, 0];
      const wordCnt = [new Array(V).fill(0), new Array(V).fill(0)];
      const probs = () => [0, 1].map((t) => wordCnt[t].map((v) => (v + alpha) / (clsCnt[t] + alpha * V)));
      const priors = () => [clsCnt[0] / Math.max(1, clsCnt[0] + clsCnt[1]), clsCnt[1] / Math.max(1, clsCnt[0] + clsCnt[1])];
      const steps = [];
      const push = (note, phase, observed, wordIdx, post, scoreLog) => steps.push({
        probs: probs(), priors: priors(), post: post || [0.5, 0.5], scoreLog: (scoreLog || [0, 0]).slice(),
        qset, phase, observed, wordIdx: wordIdx || -1, V,
        note,
        metrics: {
          已观察文档: observed, 类别数: 2, 词表大小: V,
          后验垃圾: safe(post ? post[0] : 0.5),
          对数似然差: safe((scoreLog ? scoreLog[0] : 0) - (scoreLog ? scoreLog[1] : 0)),
        },
      });
      push('初始：两个类别的先验与词频都为空，从训练文档中统计先验与似然。', '统计先验/似然', 0, -1);
      for (let i = 0; i < n; i++) {
        const d = docs[i];
        clsCnt[d.cls] += 1;
        for (const j of d.words) wordCnt[d.cls][j] += 1;
        push(`统计第 ${i + 1}/${n} 篇文档（类${d.cls + 1}，含 ${d.words.length} 个词），更新先验与词频。`, '统计先验/似然', i + 1, -1);
      }
      const pr = probs();
      const score = [Math.log(Math.max(1e-9, priors()[0])), Math.log(Math.max(1e-9, priors()[1]))];
      push(`先验统计完成：P(垃圾)=${priors()[0].toFixed(2)}，P(正常)=${priors()[1].toFixed(2)}；开始逐词推断。`, '推断', n, -1, softmax(score), score);
      for (let j = 0; j < V; j++) {
        const present = qset.indexOf(j) >= 0;
        for (let t = 0; t < 2; t++) {
          const pj = clamp(pr[t][j], 1e-9, 1 - 1e-9);
          score[t] += Math.log(present ? pj : 1 - pj);
        }
        const post = softmax(score);
        push(`第 ${j + 1}/${V} 个词「${NB_WORDS[j]}」${present ? '出现' : '未出现'}：累加 log P(词|类)，后验变为 [${post[0].toFixed(3)}, ${post[1].toFixed(3)}]。`,
          '推断', n, j, post, score);
      }
      const post = softmax(score);
      push(`推断完成：查询判为「${post[0] >= post[1] ? '垃圾' : '正常'}邮件」，后验 P(垃圾)=${post[0].toFixed(3)}。`, '完成', n, V, post, score);
      return steps;
    },

    render(snap, p, c) {
      const probs = snap.probs || [[], []];
      const priors = snap.priors || [0.5, 0.5];
      const post = snap.post || [0.5, 0.5];
      const scoreLog = snap.scoreLog || [0, 0];
      const qset = snap.qset || [];
      const phase = String(snap.phase || '统计');
      const observed = num(snap.observed, 0);
      const cw = (PX1 - PX0 - 24) / NB_WORDS.length;
      const sx = (x) => PX0 + ((x + 1.5) / 3) * (PX1 - PX0);
      return (
        <Frame c={c} height={H} title="朴素贝叶斯：先验 → 似然 → 后验" subtitle={`阶段：${phase}`}>
          <defs><clipPath id="nb-clip"><rect x={PX0} y={PY0} width={PX1 - PX0} height={PY1 - PY0} /></clipPath></defs>
          <Box c={c} x={PX0} y={PY0} w={PX1 - PX0} h={PY1 - PY0} title="类条件似然 P(词|类)（平滑后）" sub="列=词，行=类别" />
          <g clipPath="url(#nb-clip)">
            {[0, 1].map((t) => NB_WORDS.map((wd, j) => {
              const pv = clamp(num(probs[t] && probs[t][j], 0), 0, 1);
              return (
                <g key={`${t}-${j}`}>
                  <rect x={PX0 + 12 + j * cw} y={PY0 + 30 + t * 46} width={cw - 3} height="38" rx="3"
                    fill={c.series[t % c.series.length]} opacity={0.12 + 0.72 * pv} />
                  <text x={PX0 + 12 + j * cw + (cw - 3) / 2} y={PY0 + 52 + t * 46} fontSize="9"
                    textAnchor="middle" fill={c.text}>{fmt(pv, 2)}</text>
                </g>
              );
            }))}
            {NB_WORDS.map((wd, j) => (
              <text key={j} x={PX0 + 12 + j * cw + (cw - 3) / 2} y={PY0 + 22} fontSize="9"
                textAnchor="middle" fill={c.muted}>{String(wd)}</text>
            ))}
            {['垃圾', '正常'].map((nm, t) => (
              <text key={nm} x={PX0 + 2} y={PY0 + 52 + t * 46} fontSize="9" fill={c.muted}>{nm}</text>
            ))}
            <text x={PX0 + 12} y={PY0 + 136} fontSize="10" fill={c.muted}>
              {`先验：垃圾 ${fmt(priors[0], 2)} · 正常 ${fmt(priors[1], 2)}`}
            </text>
            <text x={PX0 + 12} y={PY0 + 156} fontSize="10" fill={c.muted}>
              {`已统计 ${String(Math.round(observed))} 篇文档`}
            </text>
          </g>
          <Box c={c} x={CX0} y={CY0} w={CX1 - CX0} h={CY1 - CY0} title="查询文档的后验概率" sub="垃圾 vs 正常" />
          {[0, 1].map((t) => {
            const pv = clamp(num(post[t], 0), 0, 1);
            const bh = 70 * pv;
            const bx = CX0 + 44 + t * 118;
            return (
              <g key={t}>
                <rect x={bx} y={CY0 + 150 - bh} width="62" height={Math.max(1, bh)} fill={c.series[t % c.series.length]} opacity="0.85" />
                <text x={bx + 31} y={CY0 + 166} fontSize="10" textAnchor="middle" fill={c.muted}>{t === 0 ? '垃圾' : '正常'}</text>
                <text x={bx + 31} y={CY0 + 144 - bh} fontSize="10" textAnchor="middle" fill={c.text}>{fmt(pv, 3)}</text>
              </g>
            );
          })}
          <text x={CX0 + 14} y={CY0 + 190} fontSize="10" fill={c.muted}>对数得分累加</text>
          {[0, 1].map((t) => (
            <text key={t} x={CX0 + 14} y={CY0 + 210 + t * 18} fontSize="10" fill={c.series[t % c.series.length]}>
              {`${t === 0 ? '垃圾' : '正常'}：${fmt(scoreLog[t], 2)}`}
            </text>
          ))}
          <text x={CX0 + 14} y={CY0 + 26} fontSize="10" fill={c.muted}>
            {`查询词：${qset.map((j) => NB_WORDS[j]).join('、') || '（空）'}`}
          </text>
          <text x={CX0 + 14} y={CY0 + 44} fontSize="10" fill={num(post[0], 0) >= num(post[1], 0) ? c.success : c.danger}>
            {`预测 → ${num(post[0], 0) >= num(post[1], 0) ? '垃圾邮件' : '正常邮件'}`}
          </text>
          <Foot c={c} text={snap.note} />
        </Frame>
      );
    },
  },

  'random-forest': {
    params: [
      datasetParam('breast', ['breast']),
      { key: 'trees', label: '树的数量 T', type: 'range', min: 10, max: 60, step: 1, default: 30 },
      { key: 'n', label: '样本数', type: 'range', min: 40, max: 120, step: 1, default: 72 },
      { key: 'seed', label: '随机种子', type: 'range', min: 1, max: 40, step: 1, default: 14 },
    ],
    height: H,
    legend: [
      { label: '类别 A 样本' }, { label: '类别 B 样本' }, { label: '当前森林决策区' }, { label: '袋外样本' },
    ],
    hint: '每棵树用 Bootstrap 采样并对特征做随机子空间选择，最后把所有树的概率输出平均投票，袋外误差随之下降。',
    buildSteps(p) {
      const T = clamp(Math.round(num(p.trees, 30)), 10, 60);
      const n = clamp(Math.round(num(p.n, 72)), 40, 120);
      const seed = num(p.seed, 14) >>> 0;
      const rnd = mulberry32(seed);
      const pts = scatterPoints(p, 'breast', () => makePoints(n, (seed * 17 + 3) >>> 0, 1.2).map((q) => ({
        x: q.x, y: q.y,
        cls: (q.x * q.x + q.y * q.y < 0.36 || (q.x > 0.3 && q.y < -0.2)) ? 1 : 0,
      })), 0, 1);
      const dSrc = dataNote(p, 'breast');
      const query = { x: 0.15, y: 0.1 };
      const grid = [];
      for (let gx = 0; gx < 12; gx++) for (let gy = 0; gy < 12; gy++) {
        grid.push({ x: -1.2 + (2.4 * (gx + 0.5)) / 12, y: -1.2 + (2.4 * (gy + 0.5)) / 12, gx, gy });
      }
      const forest = [];
      const oobSum = new Array(n).fill(0), oobCnt = new Array(n).fill(0);
      const accHist = [];
      const steps = [];
      const predict = (pt) => forest.length ? forest.reduce((s, tr) => s + rfPredict(tr, pt), 0) / forest.length : 0.5;
      const accuracy = () => {
        let hit = 0, tot = 0;
        for (let i = 0; i < n; i++) if (oobCnt[i] > 0) {
          hit += (oobSum[i] / oobCnt[i] >= 0.5 ? 1 : 0) === pts[i].cls ? 1 : 0;
          tot += 1;
        }
        return tot ? hit / tot : 0;
      };
      const push = (note, phase, bootstrap, tree) => {
        const pv = predict(query);
        steps.push({
          pts, grid, forest: forest.slice(), bootstrap: bootstrap || [], query, predQ: safe(pv, 0.5),
          accHist: accHist.slice(), phase, oobCnt: oobCnt.slice(),
          note: `${note} ${dSrc}`,
          metrics: {
            树数量: forest.length, 样本数: pts.length, '查询P(类B)': safe(pv, 0.5), 袋外准确率: safe(accuracy()),
          },
        });
      };
      push('初始：森林为空，所有网格暂定为中性色；开始逐棵训练 Bagging 决策桩。', '初始', [], null);
      for (let t = 0; t < T; t++) {
        const boot = Array.from({ length: n }, () => Math.floor(rnd() * n));
        const inBag = new Set(boot);
        push(`第 ${t + 1}/${T} 棵树：Bootstrap 抽出 ${inBag.size} 个不同样本，随机选 1 个特征作为分裂候选。`, '采样', boot, null);
        const tree = rfStump(pts, boot, rnd);
        forest.push(tree);
        for (let i = 0; i < n; i++) if (!inBag.has(i)) {
          oobSum[i] += rfPredict(tree, pts[i]);
          oobCnt[i] += 1;
        }
        accHist.push(safe(accuracy()));
        push(`第 ${t + 1} 棵树加入：特征 x${tree.f === 0 ? '' : 'y'} 阈值 ${fmt(tree.thr, 2)}，袋外准确率 ${fmt(accuracy(), 3)}。`, '集成', [], tree);
      }
      push(`训练完成：共 ${T} 棵树投票，查询点 P(类B)=${fmt(predict(query), 3)}，袋外准确率 ${fmt(accuracy(), 3)}。`, '完成', [], null);
      return steps;
    },

    render(snap, p, c) {
      const pts = snap.pts || [];
      const grid = snap.grid || [];
      const forest = snap.forest || [];
      const boot = snap.bootstrap || [];
      const query = snap.query || { x: 0, y: 0 };
      const accHist = snap.accHist || [];
      const phase = String(snap.phase || '初始');
      const sx = (x) => PX0 + ((x + 1.25) / 2.5) * (PX1 - PX0);
      const sy = (y) => PY1 - ((y + 1.25) / 2.5) * (PY1 - PY0);
      const cw = (PX1 - PX0) / 12, ch = (PY1 - PY0) / 12;
      const xg = (i) => CX0 + (i / Math.max(1, accHist.length)) * (CX1 - CX0);
      const yg = (v) => CY1 - clamp(num(v, 0), 0, 1) * (CY1 - CY0);
      const dAcc = dVals(accHist, xg, yg);
      return (
        <Frame c={c} height={H} title="随机森林：Bagging + 随机特征" subtitle={phase}>
          <defs><clipPath id="rf-clip"><rect x={PX0} y={PY0} width={PX1 - PX0} height={PY1 - PY0} /></clipPath></defs>
          <Box c={c} x={PX0} y={PY0} w={PX1 - PX0} h={PY1 - PY0} title="森林决策区 + 样本" sub={`已集成 ${String(forest.length)} 棵树`} />
          <g clipPath="url(#rf-clip)">
            {grid.map((q) => {
              let pv = 0.5;
              for (const tr of forest) pv += rfPredict(tr, q) / Math.max(1, forest.length);
              const a = 0.06 + 0.42 * Math.abs(pv - 0.5) * 2;
              return <rect key={`g${q.gx}-${q.gy}`} x={PX0 + q.gx * cw} y={PY0 + q.gy * ch}
                width={cw + 0.4} height={ch + 0.4} fill={c.series[pv >= 0.5 ? 1 : 0]} opacity={a} />;
            })}
            {pts.map((q, i) => (
              <g key={`p${i}`}>
                <circle cx={sx(q.x)} cy={sy(q.y)} r={phase === '采样' && boot.indexOf(i) >= 0 ? 3.8 : 2.4}
                  fill={c.series[q.cls % c.series.length]} opacity={0.85}
                  stroke={c.warning} strokeWidth={phase === '采样' && boot.indexOf(i) >= 0 ? 1.4 : 0} />
              </g>
            ))}
            <circle cx={sx(query.x)} cy={sy(query.y)} r="5" fill="none" stroke={c.warning} strokeWidth="2" />
            <circle cx={sx(query.x)} cy={sy(query.y)} r="2" fill={c.warning} />
          </g>
          <Box c={c} x={CX0} y={CY0} w={CX1 - CX0} h={CY1 - CY0} title="袋外准确率随树数变化" sub="Out-of-Bag" />
          <line x1={CX0} y1={CY1} x2={CX1} y2={CY1} stroke={c.grid} />
          <line x1={CX0} y1={CY0} x2={CX0} y2={CY1} stroke={c.grid} />
          {accHist.length > 1 && <path d={dAcc} fill="none" stroke={c.success} strokeWidth="2" />}
          <text x={CX0 + 10} y={CY0 + 16} fontSize="10" fill={c.muted}>{`查询 P(类B)=${fmt(snap.predQ, 3)}`}</text>
          <text x={CX0 + 10} y={CY0 + 34} fontSize="10" fill={c.muted}>{`当前准确率=${fmt(accHist.length ? accHist[accHist.length - 1] : 0, 3)}`}</text>
          <text x={(CX0 + CX1) / 2} y={CY1 + 16} fontSize="10" textAnchor="middle" fill={c.muted}>树的数量 →</text>
          <Foot c={c} text={snap.note} />
        </Frame>
      );
    },
  },

  'adaboost': {
    params: [
      { key: 'rounds', label: '弱分类器轮数', type: 'range', min: 10, max: 45, step: 1, default: 24 },
      { key: 'n', label: '样本数', type: 'range', min: 24, max: 64, step: 1, default: 40 },
      { key: 'noise', label: '标签噪声', type: 'range', min: 0, max: 0.3, step: 0.02, default: 0.08 },
      { key: 'seed', label: '随机种子', type: 'range', min: 1, max: 40, step: 1, default: 11 },
    ],
    height: H,
    legend: [
      { label: '正类样本（大小=权重）' }, { label: '负类样本' }, { label: '当前弱分类器' }, { label: '集成决策带' },
    ],
    hint: '每轮找加权错误率最低的决策桩，按误差给弱分类器权重 α，再提高错分样本权重，让下一轮聚焦难例。',
    buildSteps(p) {
      const T = clamp(Math.round(num(p.rounds, 24)), 10, 45);
      const n = clamp(Math.round(num(p.n, 40)), 24, 64);
      const noise = clamp(num(p.noise, 0.08), 0, 0.3);
      const seed = num(p.seed, 11) >>> 0;
      const rnd = mulberry32(seed);
      const xs = Array.from({ length: n }, (_, i) => -1 + (2 * i) / (n - 1));
      const ys = xs.map((x) => ((x > -0.35 && x < 0.4) ? 1 : -1));
      for (let i = 0; i < n; i++) if (rnd() < noise) ys[i] = -ys[i];
      let w = new Array(n).fill(1 / n);
      const learners = [];
      const errHist = [], alphaHist = [];
      const steps = [];
      const ens = (x) => learners.reduce((s, l) => s + l.alpha * abPredict(l.stump, x), 0);
      const trainErr = () => {
        let e = 0;
        for (let i = 0; i < n; i++) if ((ens(xs[i]) >= 0 ? 1 : -1) !== ys[i]) e += 1;
        return e / n;
      };
      const push = (note, phase, round, cur) => steps.push({
        xs, ys, w: w.slice(), learners: learners.slice(), cur: cur || null,
        errHist: errHist.slice(), alphaHist: alphaHist.slice(), phase, round,
        note,
        metrics: {
          轮次: round, 样本数: n, 弱分类器权重α: safe(cur ? cur.alpha : 0),
          加权错误率: safe(cur ? cur.stump.err : 0), 集成训练误差: safe(trainErr()),
        },
      });
      push('初始：所有样本等权重 1/n，开始寻找加权错误率最低的决策桩。', '初始化', 0, null);
      for (let t = 1; t <= T; t++) {
        const stump = abStump(xs, ys, w);
        const alpha = clamp(0.5 * Math.log((1 - stump.err) / stump.err), -4, 4);
        push(`第 ${t} 轮：找到阈值 ${fmt(stump.thr, 2)}，加权错误率 ${fmt(stump.err, 3)}，α=${fmt(alpha, 3)}。`, '找弱分类器', t, { stump, alpha });
        const next = w.map((wi, i) => wi * Math.exp(-alpha * ys[i] * abPredict(stump, xs[i])));
        const sum = next.reduce((a, b) => a + b, 0) || 1;
        w = next.map((v) => v / sum);
        learners.push({ stump, alpha });
        errHist.push(safe(trainErr()));
        alphaHist.push(safe(Math.abs(alpha)));
        push(`第 ${t} 轮：按 α 更新样本权重，错分样本权重上调并归一化，集成训练误差 ${fmt(trainErr(), 3)}。`, '更新权重', t, { stump, alpha });
      }
      push(`训练完成：${T} 个弱分类器加权投票，最终训练误差 ${fmt(trainErr(), 3)}。`, '完成', T, null);
      return steps;
    },

    render(snap, p, c) {
      const xs = snap.xs || [], ys = snap.ys || [], w = snap.w || [];
      const learners = snap.learners || [], cur = snap.cur;
      const errHist = snap.errHist || [], alphaHist = snap.alphaHist || [];
      const round = num(snap.round, 0);
      const sx = (x) => PX0 + ((x + 1.1) / 2.2) * (PX1 - PX0);
      const maxW = Math.max(1e-6, ...w);
      const xg = (i) => CX0 + (i / Math.max(1, errHist.length)) * (CX1 - CX0);
      const dErr = dVals(errHist, xg, (v) => CY0 + 96 - clamp(num(v, 0), 0, 1) * 88);
      const dAlpha = dVals(alphaHist, xg, (v) => CY0 + 174 - clamp(num(v, 0), 0, 4) * 22);
      return (
        <Frame c={c} height={H} title="AdaBoost：重加权难例 + 加权投票" subtitle={`第 ${String(Math.round(round))} 轮`}>
          <defs><clipPath id="ab-clip"><rect x={PX0} y={PY0} width={PX1 - PX0} height={PY1 - PY0} /></clipPath></defs>
          <Box c={c} x={PX0} y={PY0} w={PX1 - PX0} h={PY1 - PY0} title="样本权重（圆点大小）与弱分类器" sub="上排=正类，下排=负类" />
          <g clipPath="url(#ab-clip)">
            <line x1={PX0} y1={PY0 + 100} x2={PX1} y2={PY0 + 100} stroke={c.grid} />
            {[0, 1].map((k) => (
              <rect key={k} x={PX0} y={PY0 + 112 + k * 74} width={PX1 - PX0} height="50"
                fill={k === 0 ? c.series[1] : c.series[0]} opacity={0.07} />
            ))}
            {xs.map((x, i) => {
              const r = 1.6 + 4.2 * (num(w[i], 0) / maxW);
              return <circle key={i} cx={sx(x)} cy={PY0 + (ys[i] === 1 ? 72 : 150)} r={r}
                fill={c.series[ys[i] === 1 ? 1 : 0]} opacity="0.9" />;
            })}
            {cur && <g>
              <line x1={sx(cur.stump.thr)} y1={PY0 + 40} x2={sx(cur.stump.thr)} y2={PY1 - 16}
                stroke={c.warning} strokeWidth="2" strokeDasharray="4 3" />
              <text x={sx(cur.stump.thr) + 4} y={PY0 + 50} fontSize="9" fill={c.warning}>{`α=${fmt(cur.alpha, 2)}`}</text>
            </g>}
            {learners.length > 0 && <text x={PX0 + 8} y={PY1 - 8} fontSize="9" fill={c.muted}>
              {`已集成 ${String(learners.length)} 个弱分类器`}
            </text>}
          </g>
          <Box c={c} x={CX0} y={CY0} w={CX1 - CX0} h={CY1 - CY0} title="训练误差与弱分类器权重" sub="红=误差，绿=|α|" />
          <line x1={CX0} y1={CY0 + 96} x2={CX1} y2={CY0 + 96} stroke={c.grid} />
          <line x1={CX0} y1={CY0 + 174} x2={CX1} y2={CY0 + 174} stroke={c.grid} />
          {errHist.length > 0 && <path d={dErr} fill="none" stroke={c.danger} strokeWidth="2" />}
          {alphaHist.length > 0 && <path d={dAlpha} fill="none" stroke={c.success} strokeWidth="2" />}
          <text x={CX0 + 8} y={CY0 + 16} fontSize="9" fill={c.muted}>误差</text>
          <text x={CX0 + 8} y={CY0 + 188} fontSize="9" fill={c.muted}>|α|</text>
          <Foot c={c} text={snap.note} />
        </Frame>
      );
    },
  },

  'xgboost': {
    params: [
      { key: 'rounds', label: 'Boosting 轮数', type: 'range', min: 10, max: 50, step: 1, default: 26 },
      { key: 'lr', label: '学习率 η', type: 'range', min: 0.05, max: 0.5, step: 0.05, default: 0.2 },
      { key: 'lambda', label: '正则系数 λ', type: 'range', min: 0.1, max: 5, step: 0.1, default: 1 },
      { key: 'seed', label: '随机种子', type: 'range', min: 1, max: 40, step: 1, default: 5 },
    ],
    height: H,
    legend: [
      { label: '训练样本' }, { label: '真实函数' }, { label: '集成预测' }, { label: '本轮梯度直方图' },
    ],
    hint: '每轮用一阶梯度 g 与二阶梯度 h（平方损失下 h=1）计算带 λ、γ 正则的分裂增益，拟合一棵深度受限的树并乘 η 累加。',
    buildSteps(p) {
      const T = clamp(Math.round(num(p.rounds, 26)), 10, 50);
      const lr = clamp(num(p.lr, 0.2), 0.05, 0.5);
      const lambda = clamp(num(p.lambda, 1), 0.1, 5);
      const gamma = 0.02;
      const seed = num(p.seed, 5) >>> 0;
      const rnd = mulberry32(seed);
      const n = 48;
      const xs = Array.from({ length: n }, (_, i) => -1 + (2 * i) / (n - 1));
      const ys = xs.map((x) => gbTruth(x) + 0.12 * gauss(rnd));
      const F = new Array(n).fill(0);
      const Fg = Array.from({ length: 121 }, (_, i) => -1 + (2 * i) / 120);
      const Fpred = new Array(Fg.length).fill(0);
      const lossHist = [];
      const steps = [];
      const loss = () => {
        let s = 0;
        for (let i = 0; i < n; i++) { const e = F[i] - ys[i]; s += e * e; }
        return s / n;
      };
      const push = (note, phase, round, tree, hist) => steps.push({
        xs, ys, F: F.slice(), Fg, Fpred: Fpred.slice(), tree, hist: hist || [], lossHist: lossHist.slice(),
        phase, round, lr, lambda,
        note,
        metrics: {
          轮次: round, 学习率: lr, 正则λ: lambda, 均方损失: safe(loss()),
          分裂数: tree ? tree.splits.length : 0,
        },
      });
      lossHist.push(safe(loss()));
      push('初始预测 F=0：梯度 g=F−y=−y，开始按直方图候选分裂计算增益。', '初始', 0, null, []);
      for (let t = 1; t <= T; t++) {
        const g = F.map((v, i) => v - ys[i]);
        const B = 8;
        const hist = new Array(B).fill(0);
        for (let i = 0; i < n; i++) {
          const b = clamp(Math.floor(((xs[i] + 1) / 2) * B), 0, B - 1);
          hist[b] += Math.abs(g[i]);
        }
        push(`第 ${t} 轮：把 |g| 分到 ${B} 个直方图桶，准备评估候选分裂（增益含 λ=${fmt(lambda, 1)} 正则）。`, '梯度直方图', t, null, hist);
        const tree = xgbTree(xs, g, 2, lambda, gamma);
        for (let i = 0; i < n; i++) F[i] += lr * xgbEval(tree.leaves, xs[i]);
        for (let j = 0; j < Fg.length; j++) Fpred[j] += lr * xgbEval(tree.leaves, Fg[j]);
        lossHist.push(safe(loss()));
        push(`第 ${t} 轮：选出 ${tree.splits.length} 个分裂（最大增益 ${fmt(Math.max(0, ...tree.splits.map((s) => s.gain)), 3)}），叶权重乘 η 累加，损失 ${fmt(loss(), 3)}。`, '分裂与更新', t, tree, hist);
      }
      push(`训练完成：${T} 轮 boosting 后均方损失 ${fmt(loss(), 4)}。`, '完成', T, null, []);
      return steps;
    },

    render(snap, p, c) {
      const xs = snap.xs || [], ys = snap.ys || [], F = snap.F || [], Fg = snap.Fg || [];
      const Fpred = snap.Fpred || [], tree = snap.tree, hist = snap.hist || [], lossHist = snap.lossHist || [];
      const round = num(snap.round, 0);
      const sy = (y) => PY1 - ((clamp(y, -2.4, 2.4) + 2.4) / 4.8) * (PY1 - PY0);
      const sx = (x) => PX0 + ((x + 1.1) / 2.2) * (PX1 - PX0);
      const dTruth = dXY(Fg.map((x) => [x, gbTruth(x)]), (x) => sx(x), (y) => sy(y));
      const dPred = dXY(Fg.map((x, i) => [x, Fpred[i] || 0]), (x) => sx(x), (y) => sy(y));
      let dTree = '';
      if (tree) tree.leaves.forEach((lf, k) => {
        const x0 = clamp(lf.lo, -1, 1), x1 = clamp(lf.hi, -1, 1);
        dTree += `${k === 0 ? 'M' : 'L'}${sx(x0).toFixed(1)},${sy(lf.w).toFixed(1)} L${sx(x1).toFixed(1)},${sy(lf.w).toFixed(1)} `;
      });
      const maxH = Math.max(1e-6, ...hist);
      const bw = (CX1 - CX0 - 20) / Math.max(1, hist.length);
      const xg = (i) => CX0 + (i / Math.max(1, lossHist.length - 1)) * (CX1 - CX0);
      const maxL = Math.max(1e-6, ...lossHist);
      const dLoss = dVals(lossHist, xg, (v) => CY1 - (clamp(v, 0, maxL) / maxL) * 92);
      return (
        <Frame c={c} height={H} title="XGBoost：二阶梯度 + 正则分裂" subtitle={`第 ${String(Math.round(round))} 轮`}>
          <defs><clipPath id="xgb-clip"><rect x={PX0} y={PY0} width={PX1 - PX0} height={PY1 - PY0} /></clipPath></defs>
          <Box c={c} x={PX0} y={PY0} w={PX1 - PX0} h={PY1 - PY0} title="回归拟合：预测逐步逼近真实函数" sub="黄=本轮树" />
          <g clipPath="url(#xgb-clip)">
            <line x1={PX0} y1={sy(0)} x2={PX1} y2={sy(0)} stroke={c.grid} />
            <path d={dTruth} fill="none" stroke={c.muted} strokeWidth="1.4" strokeDasharray="4 3" />
            {tree && <path d={dTree} fill="none" stroke={c.warning} strokeWidth="1.6" strokeDasharray="5 3" />}
            <path d={dPred} fill="none" stroke={c.primary} strokeWidth="2.4" />
            {xs.map((x, i) => <circle key={i} cx={sx(x)} cy={sy(ys[i])} r="1.8" fill={c.muted} opacity="0.6" />)}
          </g>
          <Box c={c} x={CX0} y={CY0} w={CX1 - CX0} h={CY1 - CY0} title="|g| 直方图与损失收敛" sub="桶数=8" />
          {hist.map((v, i) => {
            const h = (clamp(num(v, 0), 0, maxH) / maxH) * 56;
            return <rect key={i} x={CX0 + 10 + i * bw} y={CY0 + 78 - h} width={bw - 2} height={Math.max(1, h)}
              fill={c.purple} opacity="0.8" />;
          })}
          <line x1={CX0} y1={CY0 + 78} x2={CX1} y2={CY0 + 78} stroke={c.grid} />
          {lossHist.length > 1 && <path d={dLoss} fill="none" stroke={c.danger} strokeWidth="2" />}
          <text x={CX0 + 8} y={CY0 + 16} fontSize="9" fill={c.muted}>损失</text>
          <text x={CX0 + 8} y={CY0 + 94} fontSize="9" fill={c.muted}>{`当前损失=${fmt(lossHist.length ? lossHist[lossHist.length - 1] : 0, 3)}`}</text>
          <Foot c={c} text={snap.note} />
        </Frame>
      );
    },
  },

  'lightgbm': {
    params: [
      { key: 'rounds', label: '迭代轮数', type: 'range', min: 8, max: 30, step: 1, default: 18 },
      { key: 'bins', label: '直方图分桶数', type: 'range', min: 8, max: 24, step: 1, default: 16 },
      { key: 'lr', label: '学习率 η', type: 'range', min: 0.05, max: 0.5, step: 0.05, default: 0.2 },
      { key: 'goss', label: 'GOSS 梯度采样', type: 'toggle', default: true, hint: '保留大梯度样本 + 随机小梯度样本' },
      { key: 'seed', label: '随机种子', type: 'range', min: 1, max: 40, step: 1, default: 17 },
    ],
    height: H,
    legend: [
      { label: '训练样本' }, { label: '集成预测' }, { label: '直方图梯度' }, { label: '按叶子生长的树' },
    ],
    hint: '把连续特征离散成直方图桶，用梯度统计在桶边界上算分裂增益；每轮选择增益最大的叶子做 leaf-wise 生长。',
    buildSteps(p) {
      const T = clamp(Math.round(num(p.rounds, 18)), 8, 30);
      const B = clamp(Math.round(num(p.bins, 16)), 8, 24);
      const lr = clamp(num(p.lr, 0.2), 0.05, 0.5);
      const goss = !!p.goss;
      const seed = num(p.seed, 17) >>> 0;
      const rnd = mulberry32(seed);
      const n = 48, lambda = 1, gamma = 0.01, maxLeaves = 4;
      const xs = Array.from({ length: n }, (_, i) => -1 + (2 * i) / (n - 1));
      const ys = xs.map((x) => gbTruth(x) + 0.12 * gauss(rnd));
      const F = new Array(n).fill(0);
      const Fg = Array.from({ length: 121 }, (_, i) => -1 + (2 * i) / 120);
      const Fpred = new Array(Fg.length).fill(0);
      const lossHist = [];
      const steps = [];
      let sampled = n;
      const loss = () => {
        let s = 0;
        for (let i = 0; i < n; i++) { const e = F[i] - ys[i]; s += e * e; }
        return s / n;
      };
      const binOf = (x) => clamp(Math.floor(((x + 1) / 2) * B), 0, B - 1);
      const bestSplit = (g, idx) => {
        const G = new Array(B).fill(0), Hc = new Array(B).fill(0);
        for (const i of idx) { const b = binOf(xs[i]); G[b] += g[i]; Hc[b] += 1; }
        const totG = G.reduce((a, v) => a + v, 0), totH = idx.length;
        let best = null;
        for (let b = 1; b < B; b++) {
          let GL = 0, HL = 0;
          for (let k = 0; k < b; k++) { GL += G[k]; HL += Hc[k]; }
          const GR = totG - GL, HR = totH - HL;
          if (HL < 3 || HR < 3) continue;
          const gain = 0.5 * ((GL * GL) / (HL + lambda) + (GR * GR) / (HR + lambda) - (totG * totG) / (totH + lambda)) - gamma;
          if (gain > 1e-9 && (!best || gain > best.gain)) best = { b, thr: -1 + (2 * b) / B, gain };
        }
        return best;
      };
      const push = (note, phase, round, tree, hist) => steps.push({
        xs, ys, F: F.slice(), Fg, Fpred: Fpred.slice(), tree, hist: hist || [], lossHist: lossHist.slice(),
        phase, round, bins: B, goss,
        note,
        metrics: {
          轮次: round, 分桶数: B, 叶子数: tree ? tree.leaves.length : 0,
          均方损失: safe(loss()), GOSS采样样本数: safe(goss ? sampled : n),
        },
      });
      lossHist.push(safe(loss()));
      push('初始预测 F=0；按分桶统计梯度直方图，开始 leaf-wise 生长。', '初始', 0, null, []);
      for (let t = 1; t <= T; t++) {
        const rawG = F.map((v, i) => v - ys[i]);
        let g = rawG.slice();
        sampled = n;
        if (goss) {
          const order = rawG.map((v, i) => [i, Math.abs(v)]).sort((a, b) => b[1] - a[1]);
          const aN = Math.max(1, Math.floor(n * 0.3)), bN = Math.max(1, Math.floor(n * 0.2));
          g = new Array(n).fill(0);
          for (let k = 0; k < aN; k++) g[order[k][0]] = rawG[order[k][0]];
          const rest = order.slice(aN);
          const factor = (n - aN) / Math.max(1, bN);
          for (let k = 0; k < Math.min(bN, rest.length); k++) g[rest[k][0]] = rawG[rest[k][0]] * factor;
          sampled = aN + Math.min(bN, rest.length);
        }
        const hist = new Array(B).fill(0);
        for (let i = 0; i < n; i++) hist[binOf(xs[i])] += Math.abs(g[i]);
        push(`第 ${t} 轮：统计 ${B} 个桶的梯度直方图${goss ? `（GOSS 保留 ${String(sampled)}/${String(n)} 样本，小梯度乘放大系数）` : ''}。`, '直方图', t, null, hist);
        let leaves = [{ lo: -1, hi: 1, idx: xs.map((_, i) => i), w: 0, gain: 0 }];
        const splits = [];
        for (let step = 0; step < maxLeaves - 1; step++) {
          let chosen = null;
          for (let li = 0; li < leaves.length; li++) {
            const lf = leaves[li];
            if (lf.idx.length < 8) continue;
            const sp = bestSplit(g, lf.idx);
            if (sp && (!chosen || sp.gain > chosen.sp.gain)) chosen = { li, lf, sp };
          }
          if (!chosen) break;
          const L = chosen.lf.idx.filter((i) => xs[i] <= chosen.sp.thr);
          const R = chosen.lf.idx.filter((i) => xs[i] > chosen.sp.thr);
          const wl = -L.reduce((s, i) => s + g[i], 0) / (L.length + lambda);
          const wr = -R.reduce((s, i) => s + g[i], 0) / (R.length + lambda);
          const nl = { lo: chosen.lf.lo, hi: chosen.sp.thr, idx: L, w: wl, gain: chosen.sp.gain };
          const nr = { lo: chosen.sp.thr, hi: chosen.lf.hi, idx: R, w: wr, gain: chosen.sp.gain };
          splits.push({ ...chosen.sp, li: chosen.li });
          leaves = leaves.filter((_, k) => k !== chosen.li).concat([nl, nr]);
        }
        const tree = { leaves, splits };
        push(`第 ${t} 轮：候选叶子中最大增益 ${fmt(Math.max(0, ...splits.map((s) => s.gain)), 3)}，共生长到 ${leaves.length} 个叶子。`, '增益评估', t, tree, hist);
        for (let i = 0; i < n; i++) {
          for (const lf of leaves) if (xs[i] >= lf.lo && xs[i] <= lf.hi) { F[i] += lr * lf.w; break; }
        }
        for (let j = 0; j < Fg.length; j++) {
          for (const lf of leaves) if (Fg[j] >= lf.lo && Fg[j] <= lf.hi) { Fpred[j] += lr * lf.w; break; }
        }
        lossHist.push(safe(loss()));
        push(`第 ${t} 轮：叶权重乘 η=${fmt(lr, 2)} 累加，训练损失降到 ${fmt(loss(), 3)}。`, '分裂与更新', t, tree, hist);
      }
      push(`训练完成：${T} 轮 leaf-wise 生长后均方损失 ${fmt(loss(), 4)}。`, '完成', T, null, []);
      return steps;
    },

    render(snap, p, c) {
      const xs = snap.xs || [], ys = snap.ys || [], F = snap.F || [], Fg = snap.Fg || [];
      const Fpred = snap.Fpred || [], tree = snap.tree, hist = snap.hist || [], lossHist = snap.lossHist || [];
      const round = num(snap.round, 0);
      const sx = (x) => PX0 + ((x + 1.1) / 2.2) * (PX1 - PX0);
      const sy = (y) => PY1 - ((clamp(y, -2.4, 2.4) + 2.4) / 4.8) * (PY1 - PY0);
      const dTruth = dXY(Fg.map((x) => [x, gbTruth(x)]), (x) => sx(x), (y) => sy(y));
      const dPred = dXY(Fg.map((x, i) => [x, Fpred[i] || 0]), (x) => sx(x), (y) => sy(y));
      const maxH = Math.max(1e-6, ...hist);
      const bw = (CX1 - CX0 - 20) / Math.max(1, hist.length);
      const xg = (i) => CX0 + (i / Math.max(1, lossHist.length - 1)) * (CX1 - CX0);
      const maxL = Math.max(1e-6, ...lossHist);
      const dLoss = dVals(lossHist, xg, (v) => CY1 - (clamp(v, 0, maxL) / maxL) * 92);
      return (
        <Frame c={c} height={H} title="LightGBM：直方图分桶 + Leaf-wise 生长" subtitle={`第 ${String(Math.round(round))} 轮`}>
          <defs><clipPath id="lgb-clip"><rect x={PX0} y={PY0} width={PX1 - PX0} height={PY1 - PY0} /></clipPath></defs>
          <Box c={c} x={PX0} y={PY0} w={PX1 - PX0} h={PY1 - PY0} title="预测逼近 + 本轮叶子区间" sub="蓝=集成，黄虚线=真实" />
          <g clipPath="url(#lgb-clip)">
            {tree && tree.leaves.map((lf, k) => (
              <rect key={k} x={sx(clamp(lf.lo, -1, 1))} y={PY0} width={Math.max(1, sx(clamp(lf.hi, -1, 1)) - sx(clamp(lf.lo, -1, 1)))}
                height={PY1 - PY0} fill={c.series[k % c.series.length]} opacity="0.07" />
            ))}
            <path d={dTruth} fill="none" stroke={c.warning} strokeWidth="1.4" strokeDasharray="4 3" />
            <path d={dPred} fill="none" stroke={c.primary} strokeWidth="2.4" />
            {xs.map((x, i) => <circle key={i} cx={sx(x)} cy={sy(ys[i])} r="1.8" fill={c.muted} opacity="0.6" />)}
          </g>
          <Box c={c} x={CX0} y={CY0} w={CX1 - CX0} h={CY1 - CY0} title="梯度直方图 / 损失" sub={`桶=${String(snap.bins || 16)}`} />
          {hist.map((v, i) => {
            const h = (clamp(num(v, 0), 0, maxH) / maxH) * 56;
            return <rect key={i} x={CX0 + 10 + i * bw} y={CY0 + 78 - h} width={bw - 2} height={Math.max(1, h)}
              fill={c.purple} opacity="0.8" />;
          })}
          <line x1={CX0} y1={CY0 + 78} x2={CX1} y2={CY0 + 78} stroke={c.grid} />
          {lossHist.length > 1 && <path d={dLoss} fill="none" stroke={c.danger} strokeWidth="2" />}
          <text x={CX0 + 8} y={CY0 + 16} fontSize="9" fill={c.muted}>{`损失=${fmt(lossHist.length ? lossHist[lossHist.length - 1] : 0, 3)}`}</text>
          <text x={CX0 + 8} y={CY0 + 94} fontSize="9" fill={c.muted}>{`GOSS=${snap.goss ? '开' : '关'}`}</text>
          <Foot c={c} text={snap.note} />
        </Frame>
      );
    },
  },

  'hierarchical-clustering': {
    params: [
      datasetParam('iris', ['iris', 'wine']),
      { key: 'n', label: '样本数', type: 'range', min: 10, max: 18, step: 1, default: 12 },
      { key: 'linkage', label: '簇间距离定义', type: 'select', default: 'average', options: [
        { value: 'single', label: '最短距离(single)' },
        { value: 'complete', label: '最长距离(complete)' },
        { value: 'average', label: '平均距离(average)' },
      ] },
      { key: 'seed', label: '随机种子', type: 'range', min: 1, max: 40, step: 1, default: 23 },
    ],
    height: H,
    legend: [
      { label: '样本（按当前簇着色）' }, { label: '最近一次合并' }, { label: '树状图合并高度=距离' },
    ],
    hint: '自底向上：每一步找出距离最近的两个簇并合并，同时更新簇间距离，直到所有点合成一簇；树状图高度即合并距离。',
    buildSteps(p) {
      const n = clamp(Math.round(num(p.n, 12)), 10, 18);
      const linkage = p.linkage === 'single' || p.linkage === 'complete' ? p.linkage : 'average';
      const seed = num(p.seed, 23) >>> 0;
      const pts = scatterPoints(p, 'iris', () => makePoints(n, seed, 1.15), 2, 3);
      const dSrc = dataNote(p, 'iris');
      const d = pts.map((a) => pts.map((b) => Math.hypot(a.x - b.x, a.y - b.y)));
      const maxD = Math.max(1e-6, ...d.flat());
      let clusters = pts.map((_, i) => [i]);
      let nextId = n;
      const nodes = [];
      const steps = [];
      const pairDist = (a, b) => {
        const vals = [];
        for (const i of a) for (const j of b) vals.push(d[i][j]);
        if (!vals.length) return Infinity;
        if (linkage === 'single') return Math.min(...vals);
        if (linkage === 'complete') return Math.max(...vals);
        return vals.reduce((s, v) => s + v, 0) / vals.length;
      };
      const assign = () => {
        const arr = new Array(n).fill(0);
        clusters.forEach((cl, k) => cl.forEach((i) => { arr[i] = k; }));
        return arr;
      };
      const push = (note, phase, merge) => steps.push({
        pts, d: d.map((r) => r.slice()), clusters: clusters.map((cl) => cl.slice()),
        assign: assign(), nodes: nodes.slice(), merge: merge || null, maxD, linkage,
        note: `${note} ${dSrc}`,
        metrics: {
          样本数: n, 当前簇数: clusters.length,
          本次合并距离: safe(merge ? merge.dist : 0), 已合并次数: nodes.length,
        },
      });
      push(`初始：${n} 个样本各自成簇，链接准则=${linkage}，开始计算两两簇间距离。`, '初始', null);
      while (clusters.length > 1) {
        let best = null;
        for (let a = 0; a < clusters.length; a++) for (let b = a + 1; b < clusters.length; b++) {
          const dist = pairDist(clusters[a], clusters[b]);
          if (!best || dist < best.dist) best = { a, b, dist };
        }
        const leafA = nodes.find((nd) => nd.id === best.a);
        const leafB = nodes.find((nd) => nd.id === best.b);
        push(`评估最近簇：簇 ${best.a + 1} 与簇 ${best.b + 1} 距离 ${fmt(best.dist, 3)}，为当前最小。`, '评估距离', null);
        const newId = nextId++;
        const merged = clusters[best.a].concat(clusters[best.b]);
        const xa = leafA ? leafA.x : (best.a + 0.5) / n;
        const xb = leafB ? leafB.x : (best.b + 0.5) / n;
        const node = { id: newId, a: best.a, b: best.b, x: (xa + xb) / 2, dist: best.dist, size: merged.length };
        nodes.push(node);
        clusters = clusters.filter((_, k) => k !== best.a && k !== best.b).concat([merged]);
        push(`合并簇 ${best.a + 1} 与 ${best.b + 1}（距离 ${fmt(best.dist, 3)}），形成含 ${merged.length} 个样本的新簇。`, '合并', node);
      }
      push(`层次聚类完成：共 ${nodes.length} 次合并，树状图完整呈现 ${n} 个样本的多粒度分组。`, '完成', null);
      return steps;
    },

    render(snap, p, c) {
      const pts = snap.pts || [], clusters = snap.clusters || [];
      const assign = snap.assign || [], nodes = snap.nodes || [], merge = snap.merge;
      const maxD = num(snap.maxD, 1);
      const sx = (x) => PX0 + ((x + 1.3) / 2.6) * (PX1 - PX0);
      const sy = (y) => PY1 - ((y + 1.3) / 2.6) * (PY1 - PY0);
      const dx = (x) => CX0 + 16 + clamp(num(x, 0), 0, 1) * (CX1 - CX0 - 32);
      const dy = (dist) => CY1 - 12 - (clamp(num(dist, 0), 0, maxD) / maxD) * (CY1 - CY0 - 32);
      const posOf = (id) => {
        const nd = nodes.find((v) => v.id === id);
        return nd ? { x: nd.x, y: nd.dist } : { x: (id + 0.5) / Math.max(1, pts.length), y: 0 };
      };
      return (
        <Frame c={c} height={H} title="层次聚类：自底向上合并" subtitle={`链接：${String(snap.linkage || '')}`}>
          <defs><clipPath id="hc-clip"><rect x={PX0} y={PY0} width={PX1 - PX0} height={PY1 - PY0} /></clipPath></defs>
          <Box c={c} x={PX0} y={PY0} w={PX1 - PX0} h={PY1 - PY0} title="散点按当前簇着色" sub={`当前 ${String(clusters.length)} 簇`} />
          <g clipPath="url(#hc-clip)">
            {pts.map((q, i) => (
              <circle key={i} cx={sx(q.x)} cy={sy(q.y)} r="3.2"
                fill={c.series[num(assign[i], 0) % c.series.length]} opacity="0.9" />
            ))}
            {merge && <g>
              <circle cx={dx(posOf(merge.a).x)} cy={dy(posOf(merge.a).y)} r="3" fill={c.warning} />
            </g>}
          </g>
          <Box c={c} x={CX0} y={CY0} w={CX1 - CX0} h={CY1 - CY0} title="树状图（纵轴=合并距离）" sub={`共 ${String(nodes.length)} 次合并`} />
          <line x1={CX0 + 12} y1={CY1 - 12} x2={CX1 - 12} y2={CY1 - 12} stroke={c.grid} />
          {nodes.map((nd, k) => {
            const pa = posOf(nd.a), pb = posOf(nd.b);
            const x = dx(nd.x), ya = dy(pa.y), yb = dy(pb.y), y = dy(nd.dist);
            const col = merge && merge.id === nd.id ? c.warning : c.primary;
            return (
              <g key={k}>
                <line x1={dx(pa.x)} y1={ya} x2={dx(pa.x)} y2={y} stroke={col} strokeWidth="1.4" />
                <line x1={dx(pb.x)} y1={yb} x2={dx(pb.x)} y2={y} stroke={col} strokeWidth="1.4" />
                <line x1={dx(pa.x)} y1={y} x2={dx(pb.x)} y2={y} stroke={col} strokeWidth="1.4" />
              </g>
            );
          })}
          <text x={CX0 + 12} y={CY0 + 16} fontSize="9" fill={c.muted}>{`最大距离=${fmt(maxD, 2)}`}</text>
          <Foot c={c} text={snap.note} />
        </Frame>
      );
    },
  },

  'gmm-em': {
    params: [
      { key: 'k', label: '高斯分量数 K', type: 'range', min: 2, max: 4, step: 1, default: 3 },
      { key: 'n', label: '样本数', type: 'range', min: 48, max: 96, step: 1, default: 72 },
      { key: 'iters', label: 'EM 迭代轮数', type: 'range', min: 5, max: 14, step: 1, default: 8 },
      { key: 'seed', label: '随机种子', type: 'range', min: 1, max: 40, step: 1, default: 31 },
    ],
    height: H,
    legend: [
      { label: '样本（不透明度=归属置信度）' }, { label: '各分量均值 μ' }, { label: '对数似然收敛' }, { label: '混合权重 π' },
    ],
    hint: 'E 步按当前高斯参数计算每个样本对各分量的责任概率；M 步用责任加权重算均值、方差与混合权重，似然单调上升。',
    buildSteps(p) {
      const K = clamp(Math.round(num(p.k, 3)), 2, 4);
      const n = clamp(Math.round(num(p.n, 72)), 48, 96);
      const T = clamp(Math.round(num(p.iters, 8)), 5, 14);
      const seed = num(p.seed, 31) >>> 0;
      const rnd = mulberry32(seed);
      const centers = [[-0.85, 0.55], [0.8, 0.45], [0.05, -0.8], [0.9, -0.7]].slice(0, K);
      const pts = [];
      for (let i = 0; i < n; i++) {
        const ctr = centers[i % K];
        pts.push({
          x: clamp(ctr[0] + gauss(rnd) * 0.3, -1.5, 1.5),
          y: clamp(ctr[1] + gauss(rnd) * 0.3, -1.5, 1.5),
        });
      }
      let mu = centers.map((ctr, k) => [pts[Math.floor((k * n) / K)].x + 0.12 * (k % 2 ? 1 : -1), pts[Math.floor((k * n) / K)].y + 0.12 * (k % 2 ? -1 : 1)]);
      let sig2 = new Array(K).fill(0.22), pi = new Array(K).fill(1 / K);
      const llHist = [];
      const steps = [];
      const respAll = () => pts.map(() => new Array(K).fill(1 / K));
      const eStep = () => {
        const resp = [];
        let ll = 0;
        for (const q of pts) {
          const lp = [];
          for (let k = 0; k < K; k++) {
            const ds = (q.x - mu[k][0]) ** 2 + (q.y - mu[k][1]) ** 2;
            lp.push(Math.log(Math.max(1e-9, pi[k])) - ds / (2 * sig2[k]) - Math.log(2 * Math.PI * sig2[k]));
          }
          const mx = Math.max(...lp);
          const sum = lp.reduce((s, v) => s + Math.exp(v - mx), 0);
          ll += mx + Math.log(Math.max(1e-12, sum));
          resp.push(lp.map((v) => Math.exp(v - mx) / sum));
        }
        return { resp, ll: safe(ll) };
      };
      const push = (note, phase, round, resp, reveal, ll) => steps.push({
        pts, mu: mu.map((v) => v.slice()), sig2: sig2.slice(), pi: pi.slice(),
        resp: resp || respAll(), reveal: reveal === undefined ? n : reveal, llHist: llHist.slice(),
        phase, round, K,
        note,
        metrics: {
          轮次: round, 分量数K: K, 对数似然: safe(ll === undefined ? llHist[llHist.length - 1] || 0 : ll),
          已展示责任: reveal === undefined ? n : reveal, 最大权重: safe(Math.max(...pi)),
        },
      });
      push('初始：随机放置 K 个高斯中心，方差与混合权重相等，开始 E 步估计责任。', '初始化', 0, respAll(), 0);
      for (let t = 1; t <= T; t++) {
        const { resp, ll } = eStep();
        llHist.push(ll);
        const batches = 4;
        for (let b = 1; b <= batches; b++) {
          const reveal = Math.floor((n * b) / batches);
          push(`第 ${t} 轮·E 步(${b}/${batches})：为 ${reveal}/${n} 个样本计算责任概率 r(i,k)。`, 'E步', t, resp, reveal, ll);
        }
        const nextMu = [], nextSig = [], nextPi = [];
        for (let k = 0; k < K; k++) {
          let Nk = 1e-6, sx = 0, sy = 0;
          for (let i = 0; i < n; i++) {
            const r = resp[i][k];
            Nk += r; sx += r * pts[i].x; sy += r * pts[i].y;
          }
          const mx = sx / Nk, my = sy / Nk;
          let varSum = 0;
          for (let i = 0; i < n; i++) varSum += resp[i][k] * ((pts[i].x - mx) ** 2 + (pts[i].y - my) ** 2);
          nextMu.push([mx, my]);
          nextSig.push(clamp(varSum / (2 * Nk), 0.02, 4));
          nextPi.push(Nk / n);
        }
        mu = nextMu; sig2 = nextSig; pi = nextPi;
        push(`第 ${t} 轮·M 步：用责任加权更新 μ、σ²、π，对数似然=${fmt(ll, 2)}。`, 'M步', t, eStep().resp, n, ll);
      }
      push(`EM 收敛：${T} 轮后对数似然=${fmt(llHist[llHist.length - 1] || 0, 2)}，软分配趋于稳定。`, '完成', T, eStep().resp, n);
      return steps;
    },

    render(snap, p, c) {
      const pts = snap.pts || [], mu = snap.mu || [], resp = snap.resp || [];
      const llHist = snap.llHist || [], pi = snap.pi || [], sig2 = snap.sig2 || [];
      const reveal = num(snap.reveal, pts.length);
      const sx = (x) => PX0 + ((x + 1.6) / 3.2) * (PX1 - PX0);
      const sy = (y) => PY1 - ((y + 1.6) / 3.2) * (PY1 - PY0);
      const xg = (i) => CX0 + (i / Math.max(1, llHist.length - 1)) * (CX1 - CX0);
      const lo = Math.min(0, ...llHist), hi = Math.max(1, ...llHist);
      const dLl = dVals(llHist, xg, (v) => CY1 - ((clamp(num(v, 0), lo, hi) - lo) / Math.max(1e-6, hi - lo)) * 92);
      return (
        <Frame c={c} height={H} title="GMM / EM：责任与参数交替更新" subtitle={`第 ${String(Math.round(num(snap.round, 0)))} 轮 · ${String(snap.phase || '')}`}>
          <defs><clipPath id="em-clip"><rect x={PX0} y={PY0} width={PX1 - PX0} height={PY1 - PY0} /></clipPath></defs>
          <Box c={c} x={PX0} y={PY0} w={PX1 - PX0} h={PY1 - PY0} title="软分配：颜色=最可能分量，透明度=置信度" sub={`已计算责任 ${String(Math.round(reveal))}/${String(pts.length)}`} />
          <g clipPath="url(#em-clip)">
            {mu.map((m, k) => (
              <circle key={`e${k}`} cx={sx(m[0])} cy={sy(m[1])} r={Math.max(8, Math.sqrt(clamp(num(sig2[k], 0.2), 0.02, 4)) * 52)}
                fill="none" stroke={c.series[k % c.series.length]} strokeWidth="1.4" strokeDasharray="4 3" opacity="0.8" />
            ))}
            {pts.map((q, i) => {
              const r = resp[i] || [];
              let best = 0;
              for (let k = 1; k < r.length; k++) if (num(r[k], 0) > num(r[best], 0)) best = k;
              const conf = clamp(num(r[best], 0), 0, 1);
              return <circle key={i} cx={sx(q.x)} cy={sy(q.y)} r="2.8"
                fill={c.series[best % c.series.length]} opacity={0.2 + 0.78 * conf} />;
            })}
            {mu.map((m, k) => (
              <g key={`m${k}`}>
                <path d={`M ${sx(m[0]) - 6} ${sy(m[1])} L ${sx(m[0]) + 6} ${sy(m[1])} M ${sx(m[0])} ${sy(m[1]) - 6} L ${sx(m[0])} ${sy(m[1]) + 6}`}
                  stroke={c.series[k % c.series.length]} strokeWidth="2.4" fill="none" />
              </g>
            ))}
          </g>
          <Box c={c} x={CX0} y={CY0} w={CX1 - CX0} h={CY1 - CY0} title="对数似然收敛" sub="权重 π（右下角）" />
          <line x1={CX0} y1={CY1} x2={CX1} y2={CY1} stroke={c.grid} />
          {llHist.length > 1 && <path d={dLl} fill="none" stroke={c.success} strokeWidth="2" />}
          {pi.map((v, k) => (
            <g key={k}>
              <rect x={CX0 + 12 + k * 44} y={CY1 - 16} width="34" height={Math.max(2, 40 * clamp(num(v, 0), 0, 1))}
                fill={c.series[k % c.series.length]} opacity="0.75" />
              <text x={CX0 + 29 + k * 44} y={CY1 - 20} fontSize="9" textAnchor="middle" fill={c.muted}>{fmt(v, 2)}</text>
            </g>
          ))}
          <text x={CX0 + 10} y={CY0 + 16} fontSize="9" fill={c.muted}>{`似然=${fmt(llHist.length ? llHist[llHist.length - 1] : 0, 2)}`}</text>
          <Foot c={c} text={snap.note} />
        </Frame>
      );
    },
  },

  'lda': {
    params: [
      datasetParam('iris', ['iris', 'wine']),
      { key: 'n', label: '每类样本数', type: 'range', min: 12, max: 30, step: 1, default: 20 },
      { key: 'iters', label: '投影轴迭代次数', type: 'range', min: 20, max: 50, step: 1, default: 30 },
      { key: 'sep', label: '类间分离度', type: 'range', min: 0.4, max: 1.4, step: 0.05, default: 0.9 },
      { key: 'seed', label: '随机种子', type: 'range', min: 1, max: 40, step: 1, default: 19 },
    ],
    height: H,
    legend: [
      { label: '三类样本' }, { label: 'LDA 投影轴' }, { label: '瑞利商（类间/类内）' }, { label: '投影后类均值' },
    ],
    hint: '用幂迭代求 S_W⁻¹S_B 的主特征向量，即最大化「类间散度 / 类内散度」的投影方向；观察投影轴上类均值越分越开。',
    buildSteps(p) {
      const per = clamp(Math.round(num(p.n, 20)), 12, 30);
      const T = clamp(Math.round(num(p.iters, 30)), 20, 50);
      const sep = clamp(num(p.sep, 0.9), 0.4, 1.4);
      const seed = num(p.seed, 19) >>> 0;
      const rnd = mulberry32(seed);
      const realPts = scatterPoints(p, 'iris', () => [], 2, 3);
      const useReal = realPts.length > 0;
      const pts = useReal ? realPts.slice(0, per * 3).map((q) => ({ x: q.x, y: q.y, cls: q.cls })) : (() => {
        const centers = [[-0.75 * sep, 0.6 * sep], [0.75 * sep, 0.6 * sep], [0, -0.75 * sep]];
        const arr = [];
        for (let t = 0; t < 3; t++) for (let i = 0; i < per; i++) {
          arr.push({
            x: clamp(centers[t][0] + gauss(rnd) * 0.28, -1.5, 1.5),
            y: clamp(centers[t][1] + gauss(rnd) * 0.28, -1.5, 1.5),
            cls: t,
          });
        }
        return arr;
      })();
      const dSrc = dataNote(p, 'iris');
      const n = pts.length;
      const mean = pts.reduce((s, q) => [s[0] + q.x / n, s[1] + q.y / n], [0, 0]);
      const mk = [0, 1, 2].map((t) => {
        const g = pts.filter((q) => q.cls === t);
        return [g.reduce((s, q) => s + q.x, 0) / g.length, g.reduce((s, q) => s + q.y, 0) / g.length];
      });
      let SW = [0, 0, 0, 0]; // a,b;c,d
      for (const q of pts) {
        const dx = q.x - mk[q.cls][0], dy = q.y - mk[q.cls][1];
        SW[0] += dx * dx; SW[1] += dx * dy; SW[2] += dx * dy; SW[3] += dy * dy;
      }
      let SB = [0, 0, 0, 0];
      for (let t = 0; t < 3; t++) {
        const dx = mk[t][0] - mean[0], dy = mk[t][1] - mean[1];
        SB[0] += per * dx * dx; SB[1] += per * dx * dy; SB[2] += per * dx * dy; SB[3] += per * dy * dy;
      }
      const ridge = 1e-6 * (Math.abs(SW[0]) + Math.abs(SW[3]) + 1);
      SW = [SW[0] + ridge, SW[1], SW[2], SW[3] + ridge];
      const det = SW[0] * SW[3] - SW[1] * SW[2];
      const invSW = Math.abs(det) < 1e-12 ? [1e6, 0, 0, 1e6] : [SW[3] / det, -SW[1] / det, -SW[2] / det, SW[0] / det];
      const M = [
        invSW[0] * SB[0] + invSW[1] * SB[2], invSW[0] * SB[1] + invSW[1] * SB[3],
        invSW[2] * SB[0] + invSW[3] * SB[2], invSW[2] * SB[1] + invSW[3] * SB[3],
      ];
      const mul = (A, v) => [A[0] * v[0] + A[1] * v[1], A[2] * v[0] + A[3] * v[1]];
      const quad = (A, v) => safe(v[0] * (A[0] * v[0] + A[1] * v[1]) + v[1] * (A[2] * v[0] + A[3] * v[1]));
      let w = [Math.SQRT1_2, Math.SQRT1_2];
      const steps = [];
      const rayleigh = () => {
        const den = quad(SW, w);
        return safe(quad(SB, w) / (Math.abs(den) < 1e-12 ? 1e-12 : den));
      };
      const push = (note, phase, round, hist, axis) => steps.push({
        pts, mean, mk, SW, SB, w: axis || w.slice(), hist: hist.slice(), phase, round,
        note: `${note} ${dSrc}`,
        metrics: {
          迭代: round, 样本数: n, 瑞利商: safe(rayleigh()),
          轴角度: safe((Math.atan2(w[1], w[0]) * 180) / Math.PI), 类间散度: safe(quad(SB, w)),
        },
      });
      let hist = [];
      push('初始：投影轴取 45°，计算类间散度 S_B 与类内散度 S_W，开始幂迭代。', '初始', 0, hist, w);
      for (let t = 1; t <= T; t++) {
        let nw = mul(M, w);
        const norm = Math.hypot(nw[0], nw[1]);
        if (norm > 1e-9) w = [nw[0] / norm, nw[1] / norm];
        hist.push(safe(rayleigh()));
        push(`第 ${t} 次幂迭代：w ← S_W⁻¹S_B·w 并归一化，瑞利商（类间/类内）=${fmt(rayleigh(), 3)}。`, '幂迭代', t, hist, w);
      }
      push(`收敛：投影轴角度 ${fmt((Math.atan2(w[1], w[0]) * 180) / Math.PI, 1)}°，三类均值在轴上尽量分离，瑞利商=${fmt(rayleigh(), 3)}。`, '完成', T, hist, w);
      return steps;
    },

    render(snap, p, c) {
      const pts = snap.pts || [], mk = snap.mk || [], mean = snap.mean || [0, 0];
      const w = snap.w || [1, 0], hist = snap.hist || [];
      const sx = (x) => PX0 + ((x + 1.6) / 3.2) * (PX1 - PX0);
      const sy = (y) => PY1 - ((y + 1.6) / 3.2) * (PY1 - PY0);
      const ex = 2.4;
      const ax0 = [mean[0] - w[0] * ex, mean[1] - w[1] * ex];
      const ax1 = [mean[0] + w[0] * ex, mean[1] + w[1] * ex];
      const proj = (q) => (q.x - mean[0]) * w[0] + (q.y - mean[1]) * w[1];
      const xg = (i) => CX0 + (i / Math.max(1, hist.length - 1)) * (CX1 - CX0);
      const lo = Math.min(0, ...hist), hi = Math.max(1, ...hist);
      const dHist = dVals(hist, xg, (v) => CY1 - ((clamp(num(v, 0), lo, hi) - lo) / Math.max(1e-6, hi - lo)) * 92);
      const axisX = (v) => CX0 + 20 + ((clamp(v, -1.8, 1.8) + 1.8) / 3.6) * (CX1 - CX0 - 40);
      return (
        <Frame c={c} height={H} title="LDA：最大化类间/类内散度比" subtitle={`迭代 ${String(Math.round(num(snap.round, 0)))}`}>
          <defs><clipPath id="lda-clip"><rect x={PX0} y={PY0} width={PX1 - PX0} height={PY1 - PY0} /></clipPath></defs>
          <Box c={c} x={PX0} y={PY0} w={PX1 - PX0} h={PY1 - PY0} title="散点与 LDA 投影轴" sub="投影轴穿过总体均值" />
          <g clipPath="url(#lda-clip)">
            {pts.map((q, i) => {
              const pv = proj(q);
              const px = mean[0] + w[0] * pv, py = mean[1] + w[1] * pv;
              return (
                <g key={i}>
                  <line x1={sx(q.x)} y1={sy(q.y)} x2={sx(px)} y2={sy(py)} stroke={c.grid} strokeWidth="0.8" />
                  <circle cx={sx(q.x)} cy={sy(q.y)} r="2.6" fill={c.series[q.cls % c.series.length]} opacity="0.85" />
                </g>
              );
            })}
            <line x1={sx(ax0[0])} y1={sy(ax0[1])} x2={sx(ax1[0])} y2={sy(ax1[1])} stroke={c.warning} strokeWidth="2.4" />
            <circle cx={sx(mean[0])} cy={sy(mean[1])} r="3.4" fill="none" stroke={c.text} strokeWidth="1.6" />
          </g>
          <Box c={c} x={CX0} y={CY0} w={CX1 - CX0} h={CY1 - CY0} title="瑞利商收敛 / 投影后类均值" sub="上=曲线，下=轴" />
          <line x1={CX0} y1={CY1} x2={CX1} y2={CY1} stroke={c.grid} />
          {hist.length > 1 && <path d={dHist} fill="none" stroke={c.success} strokeWidth="2" />}
          <text x={CX0 + 10} y={CY0 + 16} fontSize="9" fill={c.muted}>{`瑞利商=${fmt(hist.length ? hist[hist.length - 1] : 0, 3)}`}</text>
          <line x1={CX0 + 14} y1={CY1 - 42} x2={CX1 - 14} y2={CY1 - 42} stroke={c.border} strokeWidth="1.2" />
          {mk.map((m, t) => {
            const v = (m[0] - mean[0]) * w[0] + (m[1] - mean[1]) * w[1];
            return <circle key={t} cx={axisX(v)} cy={CY1 - 42} r="5" fill={c.series[t % c.series.length]} />;
          })}
          <Foot c={c} text={snap.note} />
        </Frame>
      );
    },
  },

  'tsne': {
    params: [
      datasetParam('iris', ['iris', 'wine']),
      { key: 'n', label: '样本数', type: 'range', min: 36, max: 54, step: 1, default: 45 },
      { key: 'perp', label: '困惑度', type: 'range', min: 5, max: 15, step: 1, default: 8 },
      { key: 'iters', label: '布局迭代次数', type: 'range', min: 40, max: 120, step: 1, default: 70 },
      { key: 'seed', label: '随机种子', type: 'range', min: 1, max: 40, step: 1, default: 27 },
    ],
    height: H,
    legend: [
      { label: '低维嵌入点（颜色=原始类别）' }, { label: '高维邻域概率 P' }, { label: 'KL 散度' },
    ],
    hint: '先把高维距离转成以困惑度标定带宽的邻域概率 P，再用 t 分布低维概率 Q 拟合 P，梯度下降最小化 KL(P‖Q)。',
    buildSteps(p) {
      let n = clamp(Math.round(num(p.n, 45)), 36, 54);
      const perp = clamp(Math.round(num(p.perp, 8)), 5, 15);
      const T = clamp(Math.round(num(p.iters, 70)), 40, 120);
      const seed = num(p.seed, 27) >>> 0;
      const rnd = mulberry32(seed);
      const realVec = vectorData(p, 'iris', () => null, 4);
      const useReal = realVec && realVec.length > 0;
      const labels = useReal ? realVec.map((o) => o.cls) : [];
      const centers = [[-0.9, 0.7, 0.2, 0.1], [0.9, 0.6, -0.2, 0.3], [0, -0.85, 0.4, -0.3]];
      const X = useReal ? realVec.map((o) => o.v) : (() => {
        const arr = [];
        for (let i = 0; i < n; i++) {
          const ctr = centers[i % 3];
          arr.push(ctr.map((v) => v + gauss(rnd) * 0.34));
        }
        return arr;
      })();
      n = X.length;
      const dSrc = dataNote(p, 'iris');
      const dist2 = X.map((a) => X.map((b) => a.reduce((s, v, d) => s + (v - b[d]) ** 2, 0)));
      const Pcond = [];
      const targetH = Math.log(perp);
      for (let i = 0; i < n; i++) {
        let beta = 1, lo = 0, hi = Infinity, pv = new Array(n).fill(0);
        for (let it = 0; it < 40; it++) {
          let sum = 0, dsum = 0;
          const tmp = new Array(n).fill(0);
          for (let j = 0; j < n; j++) {
            if (j === i) continue;
            tmp[j] = Math.exp(-dist2[i][j] * beta);
            sum += tmp[j];
            dsum += dist2[i][j] * tmp[j];
          }
          if (sum < 1e-12) {
            pv = new Array(n).fill(0);
            for (let j = 0; j < n; j++) if (j !== i) pv[j] = 1 / (n - 1);
            break;
          }
          const H = Math.log(sum) + (beta * dsum) / sum;
          pv = tmp.map((v) => v / sum);
          const diff = H - targetH;
          if (Math.abs(diff) < 1e-4) break;
          if (diff > 0) { lo = beta; beta = Number.isFinite(hi) ? (beta + hi) / 2 : beta * 2; }
          else { hi = beta; beta = (beta + lo) / 2; }
        }
        Pcond.push(pv);
      }
      const P = Array.from({ length: n }, () => new Array(n).fill(1e-12));
      for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) if (i !== j) {
        P[i][j] = Math.max(1e-12, (Pcond[i][j] + Pcond[j][i]) / (2 * n));
      }
      const psum = P.flat().reduce((a, v) => a + v, 0) || 1;
      for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) P[i][j] /= psum;
      let Y = Array.from({ length: n }, () => [gauss(rnd) * 0.01, gauss(rnd) * 0.01]);
      let vel = Array.from({ length: n }, () => [0, 0]);
      const steps = [];
      const klOf = () => {
        const numW = Y.map(() => new Array(n).fill(0));
        let den = 0;
        for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) if (i !== j) {
          const w = 1 / (1 + (Y[i][0] - Y[j][0]) ** 2 + (Y[i][1] - Y[j][1]) ** 2);
          numW[i][j] = w; den += w;
        }
        let kl = 0;
        for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
          const q = Math.max(1e-12, numW[i][j] / Math.max(1e-12, den));
          kl += P[i][j] * Math.log(Math.max(1e-12, P[i][j] / q));
        }
        return { kl: safe(kl), numW, den: Math.max(1e-12, den) };
      };
      const push = (note, phase, round, kl, extra) => {
        const showN = Math.min(10, n);
        steps.push({
          Y: Y.map((v) => v.slice()), labels: useReal ? labels : X.map((_, i) => i % 3), Pshow: P.slice(0, showN).map((r) => r.slice(0, showN)),
          klHist: (extra ? extra.hist : []).slice(), kl: safe(kl || 0), phase, round, perp, n,
          note: `${note} ${dSrc}`,
          metrics: { 迭代: round, 样本数: n, 困惑度: perp, KL散度: safe(kl || 0) },
        });
      };
      let hist = [];
      push('初始化：用困惑度二分搜索确定每点的高斯带宽，得到对称邻域概率 P；低维坐标取极小随机值。', '初始化', 0, klOf().kl, { hist });
      for (let t = 1; t <= T; t++) {
        const { numW, den } = klOf();
        const grad = Array.from({ length: n }, () => [0, 0]);
        for (let i = 0; i < n; i++) {
          let gx = 0, gy = 0;
          for (let j = 0; j < n; j++) {
            if (i === j) continue;
            const qij = Math.max(1e-12, numW[i][j] / den);
            const coef = 4 * (P[i][j] - qij) * numW[i][j];
            gx += coef * (Y[i][0] - Y[j][0]);
            gy += coef * (Y[i][1] - Y[j][1]);
          }
          grad[i] = [gx, gy];
        }
        const momentum = t < 20 ? 0.5 : 0.8;
        const lr = 160;
        for (let i = 0; i < n; i++) for (let d = 0; d < 2; d++) {
          vel[i][d] = momentum * vel[i][d] - lr * clamp(grad[i][d], -50, 50);
          Y[i][d] += vel[i][d];
          Y[i][d] = clamp(Y[i][d], -50, 50);
        }
        const kl = klOf().kl;
        hist.push(kl);
        push(`第 ${t} 次迭代：按梯度更新低维坐标（动量=${fmt(momentum, 1)}），KL(P‖Q)=${fmt(kl, 3)}，簇结构逐渐显现。`, '梯度下降', t, kl, { hist });
      }
      push(`布局完成：共 ${T} 次迭代，KL 收敛到 ${fmt(hist[hist.length - 1] || 0, 3)}，相似样本在低维聚成一团。`, '完成', T, hist[hist.length - 1] || 0, { hist });
      return steps;
    },

    render(snap, p, c) {
      const Y = snap.Y || [], labels = snap.labels || [], Pshow = snap.Pshow || [], klHist = snap.klHist || [];
      const sx = (v) => PX0 + ((clamp(v, -12, 12) + 12) / 24) * (PX1 - PX0);
      const sy = (v) => PY1 - ((clamp(v, -12, 12) + 12) / 24) * (PY1 - PY0);
      const xg = (i) => CX0 + (i / Math.max(1, klHist.length - 1)) * (CX1 - CX0);
      const hi = Math.max(1e-6, ...klHist);
      const dKl = dVals(klHist, xg, (v) => CY1 - 14 - (clamp(num(v, 0), 0, hi) / hi) * 62);
      const cell = 9;
      return (
        <Frame c={c} height={H} title="t-SNE：高维邻域概率 → 低维布局" subtitle={`迭代 ${String(Math.round(num(snap.round, 0)))} · KL=${fmt(snap.kl, 3)}`}>
          <defs><clipPath id="ts-clip"><rect x={PX0} y={PY0} width={PX1 - PX0} height={PY1 - PY0} /></clipPath></defs>
          <Box c={c} x={PX0} y={PY0} w={PX1 - PX0} h={PY1 - PY0} title="低维嵌入（颜色为原始类别）" sub={`困惑度=${String(snap.perp || 8)}`} />
          <g clipPath="url(#ts-clip)">
            {Y.map((q, i) => (
              <circle key={i} cx={sx(q[0])} cy={sy(q[1])} r="3"
                fill={c.series[num(labels[i], 0) % c.series.length]} opacity="0.85" />
            ))}
          </g>
          <Box c={c} x={CX0} y={CY0} w={CX1 - CX0} h={CY1 - CY0} title="邻域概率 P（前 10 点）与 KL 收敛" sub="格越亮越相似" />
          {Pshow.map((row, i) => row.map((v, j) => (
            <rect key={`${i}-${j}`} x={CX0 + 12 + j * cell} y={CY0 + 14 + i * cell} width={cell - 1} height={cell - 1}
              fill={c.primary} opacity={0.05 + 0.9 * clamp(num(v, 0) * 60, 0, 1)} />
          )))}
          <line x1={CX0 + 12} y1={CY1 - 14} x2={CX1 - 12} y2={CY1 - 14} stroke={c.grid} />
          {klHist.length > 1 && <path d={dKl} fill="none" stroke={c.danger} strokeWidth="2" />}
          <text x={CX0 + 12} y={CY0 + 118} fontSize="9" fill={c.muted}>KL ↓</text>
          <text x={CX0 + 12} y={CY0 + 132} fontSize="9" fill={c.danger}>{fmt(snap.kl, 3)}</text>
          <Foot c={c} text={snap.note} />
        </Frame>
      );
    },
  },

  'association-rules': {
    params: [
      { key: 'minSup', label: '最小支持度', type: 'range', min: 0.1, max: 0.6, step: 0.05, default: 0.3 },
      { key: 'minConf', label: '最小置信度', type: 'range', min: 0.3, max: 0.9, step: 0.05, default: 0.6 },
      { key: 'm', label: '交易数', type: 'range', min: 30, max: 60, step: 1, default: 44 },
      { key: 'seed', label: '随机种子', type: 'range', min: 1, max: 40, step: 1, default: 33 },
    ],
    height: H,
    legend: [
      { label: '交易中出现的商品' }, { label: '当前候选集' }, { label: '频繁项集支持度' }, { label: '强关联规则' },
    ],
    hint: 'Apriori：先按支持度筛出一维频繁项，再逐层连接生成候选并用「频繁项集的子集必频繁」剪枝，最后按置信度产出规则。',
    buildSteps(p) {
      const minSup = clamp(num(p.minSup, 0.3), 0.1, 0.6);
      const minConf = clamp(num(p.minConf, 0.6), 0.3, 0.9);
      const m = clamp(Math.round(num(p.m, 44)), 30, 60);
      const seed = num(p.seed, 33) >>> 0;
      const rnd = mulberry32(seed);
      const V = 6;
      const items = ['面包', '牛奶', '尿布', '啤酒', '鸡蛋', '可乐'];
      const trans = [];
      for (let t = 0; t < m; t++) {
        const r = rnd();
        let basket;
        if (r < 0.5) basket = [1, 2, 3];       // 强关联模式：尿布+啤酒+牛奶
        else if (r < 0.8) basket = [0, 4];     // 面包+鸡蛋
        else basket = [Math.floor(rnd() * V), Math.floor(rnd() * V)];
        const set = new Set(basket);
        if (rnd() < 0.1 && set.size > 1) set.delete([...set][Math.floor(rnd() * set.size)]); // 少量噪声
        if (rnd() < 0.12) set.add(5);
        trans.push([...set].sort((a, b) => a - b));
      }
      const support = (set) => trans.reduce((s, tr) => s + (set.every((it) => tr.indexOf(it) >= 0) ? 1 : 0), 0) / m;
      const steps = [];
      let revealed = 0;
      const push = (note, phase, cur, sup, rules, freq) => steps.push({
        trans, items, revealed, cur: cur || [], sup: safe(sup), rules: (rules || []).slice(),
        freqCount: freq === undefined ? 0 : freq, minSup, minConf, m,
        note,
        metrics: {
          交易数: m, 已扫描: revealed, 最小支持度: minSup, 最小置信度: minConf,
          频繁项集数: freq === undefined ? 0 : freq, 规则数: rules ? rules.length : 0,
        },
      });
      push(`初始：m=${m}，最小支持度 ${fmt(minSup, 2)}、置信度 ${fmt(minConf, 2)}；逐条扫描交易。`, '扫描交易', [], 0, [], 0);
      for (let t = 0; t < m; t++) { revealed = t + 1; push(`扫描第 ${t + 1}/${m} 条交易，统计单项计数。`, '扫描交易', [], 0, [], 0); }
      const freqSets = [];
      const combos = (arr, k) => {
        const out = [];
        const rec = (start, cur) => {
          if (cur.length === k) { out.push(cur.slice()); return; }
          for (let i = start; i < arr.length; i++) { cur.push(arr[i]); rec(i + 1, cur); cur.pop(); }
        };
        rec(0, []);
        return out;
      };
      const all = Array.from({ length: V }, (_, i) => i);
      for (let k = 1; k <= 3; k++) {
        const cands = combos(all, k);
        for (const cand of cands) {
          const subsets = k > 1 ? combos(cand, k - 1).every((ss) => freqSets.some((fs) => fs.set.join(',') === ss.join(','))) : true;
          const sup = subsets ? support(cand) : 0;
          if (sup >= minSup) freqSets.push({ set: cand, sup });
          push(`候选 {${cand.map((i) => items[i]).join('、')}}：支持度 ${fmt(sup, 3)}${subsets ? '' : '（子集不频繁，剪枝）'}${sup >= minSup ? ' → 频繁项集' : ''}。`,
            '逐层筛选', cand, sup, [], freqSets.length);
        }
      }
      const rules = [];
      for (const fs of freqSets) {
        if (fs.set.length < 2) continue;
        for (let k = 1; k < fs.set.length; k++) {
          for (const A of combos(fs.set, k)) {
            const B = fs.set.filter((v) => A.indexOf(v) < 0);
            const supA = freqSets.find((f) => f.set.join(',') === A.join(','));
            if (!supA || supA.sup <= 0) continue;
            const conf = fs.sup / supA.sup;
            if (conf >= minConf) rules.push({ A, B, conf: safe(conf), sup: safe(fs.sup) });
          }
        }
      }
      rules.sort((a, b) => b.conf - a.conf);
      const top = rules.slice(0, 12);
      for (let i = 0; i < top.length; i++) {
        const r = top[i];
        push(`规则 {${r.A.map((j) => items[j]).join('、')}} ⇒ {${r.B.map((j) => items[j]).join('、')}}：置信度 ${fmt(r.conf, 3)} ≥ ${fmt(minConf, 2)}。`,
          '生成规则', top[i].A.concat(top[i].B), r.sup, top.slice(0, i + 1), freqSets.length);
      }
      push(`完成：共 ${freqSets.length} 个频繁项集、${rules.length} 条强规则，按置信度排序展示前 ${top.length} 条。`, '完成', [], 0, top, freqSets.length);
      return steps;
    },

    render(snap, p, c) {
      const trans = snap.trans || [], items = snap.items || [], revealed = num(snap.revealed, 0);
      const cur = snap.cur || [], rules = snap.rules || [];
      const rowH = Math.max(1.6, (PY1 - PY0 - 26) / Math.max(1, trans.length));
      const cw = (PX1 - PX0 - 60) / Math.max(1, items.length);
      return (
        <Frame c={c} height={H} title="关联规则：Apriori 支持度/置信度筛选" subtitle={`已扫描 ${String(Math.round(revealed))} 条交易`}>
          <defs><clipPath id="ar-clip"><rect x={PX0} y={PY0} width={PX1 - PX0} height={PY1 - PY0} /></clipPath></defs>
          <Box c={c} x={PX0} y={PY0} w={PX1 - PX0} h={PY1 - PY0} title="交易矩阵（行=交易，列=商品）" sub="亮=当前候选商品" />
          <g clipPath="url(#ar-clip)">
            {items.map((it, j) => <text key={j} x={PX0 + 42 + j * cw + cw / 2} y={PY0 + 16} fontSize="8"
              textAnchor="middle" fill={cur.indexOf(j) >= 0 ? c.warning : c.muted}>{String(it)}</text>)}
            {trans.map((tr, i) => (
              <g key={i}>
                <text x={PX0 + 34} y={PY0 + 26 + i * rowH + rowH - 1} fontSize="7" textAnchor="end" fill={c.muted}>{String(i + 1)}</text>
                {items.map((it, j) => (
                  <rect key={j} x={PX0 + 42 + j * cw} y={PY0 + 26 + i * rowH} width={Math.max(1, cw - 1.4)} height={Math.max(1, rowH - 0.8)}
                    fill={tr.indexOf(j) >= 0 ? (cur.indexOf(j) >= 0 ? c.warning : c.primary) : c.border}
                    opacity={i < revealed ? (tr.indexOf(j) >= 0 ? 0.85 : 0.1) : 0.05} />
                ))}
              </g>
            ))}
          </g>
          <Box c={c} x={CX0} y={CY0} w={CX1 - CX0} h={CY1 - CY0} title="强关联规则" sub={`支持度 ${fmt(snap.sup, 3)}`} />
          <text x={CX0 + 12} y={CY0 + 22} fontSize="9" fill={c.muted}>{`频繁项集：${String(snap.freqCount)} 条`}</text>
          {rules.slice(0, 8).map((r, i) => (
            <text key={i} x={CX0 + 12} y={CY0 + 44 + i * 17} fontSize="10" fill={c.series[i % c.series.length]}>
              {`{${r.A.map((j) => items[j]).join('&')}} ⇒ {${r.B.map((j) => items[j]).join('&')}}  conf=${fmt(r.conf, 2)}`}
            </text>
          ))}
          <Foot c={c} text={snap.note} />
        </Frame>
      );
    },
  },

  'anomaly-isolation-forest': {
    params: [
      { key: 'trees', label: '树的数量 T', type: 'range', min: 12, max: 40, step: 1, default: 22 },
      { key: 'n', label: '样本数', type: 'range', min: 60, max: 100, step: 1, default: 80 },
      { key: 'seed', label: '随机种子', type: 'range', min: 1, max: 40, step: 1, default: 41 },
    ],
    height: H,
    legend: [
      { label: '正常样本' }, { label: '异常分数高的样本' }, { label: '当前树的随机切分' }, { label: '平均路径长度' },
    ],
    hint: '每棵树随机选特征与切分点把样本逐层孤立；异常点更快落到小叶子（路径短），用平均路径长度归一化得到异常分数。',
    buildSteps(p) {
      const T = clamp(Math.round(num(p.trees, 22)), 12, 40);
      const n = clamp(Math.round(num(p.n, 80)), 60, 100);
      const seed = num(p.seed, 41) >>> 0;
      const rnd = mulberry32(seed);
      const pts = [];
      for (let i = 0; i < n; i++) {
        const anomaly = i % 10 === 0;
        if (anomaly) pts.push({ x: (rnd() - 0.5) * 3.4, y: (rnd() - 0.5) * 3.4 });
        else {
          const ctr = i % 2 === 0 ? [-0.6, 0.3] : [0.6, -0.3];
          pts.push({ x: clamp(ctr[0] + gauss(rnd) * 0.22, -1.6, 1.6), y: clamp(ctr[1] + gauss(rnd) * 0.22, -1.6, 1.6) });
        }
      }
      const cOf = (m) => {
        if (m <= 1) return 1;
        return Math.max(1e-6, 2 * (Math.log(m - 1) + 0.5772156649) - (2 * (m - 1)) / m);
      };
      const cN = cOf(n);
      const buildTree = (idx, depth, splits) => {
        const bounds = {
          x0: Math.min(...idx.map((i) => pts[i].x)), x1: Math.max(...idx.map((i) => pts[i].x)),
          y0: Math.min(...idx.map((i) => pts[i].y)), y1: Math.max(...idx.map((i) => pts[i].y)),
        };
        if (idx.length <= 1 || depth >= 8) return { idx, depth, bounds, leaf: true };
        const axis = rnd() < 0.5 ? 'x' : 'y';
        const lo = axis === 'x' ? bounds.x0 : bounds.y0;
        const hi = axis === 'x' ? bounds.x1 : bounds.y1;
        if (hi - lo < 1e-9) return { idx, depth, bounds, leaf: true };
        const thr = lo + rnd() * (hi - lo);
        const L = idx.filter((i) => pts[i][axis] <= thr), R = idx.filter((i) => pts[i][axis] > thr);
        if (!L.length || !R.length) return { idx, depth, bounds, leaf: true };
        splits.push({ axis, thr, bounds });
        return { axis, thr, bounds, leaf: false, left: buildTree(L, depth + 1, splits), right: buildTree(R, depth + 1, splits) };
      };
      const pathOf = (node, q, h) => {
        if (node.leaf) return h + cOf(node.idx.length);
        return pathOf(q[node.axis] <= node.thr ? node.left : node.right, q, h + 1);
      };
      const hSum = new Array(n).fill(0);
      const scoreHist = [];
      const steps = [];
      const scores = () => hSum.map((v) => safe(Math.pow(2, -(v / T) / cN), 0));
      const push = (note, phase, round, tree, splits) => steps.push({
        pts, splits: splits || [], hSum: hSum.slice(), scores: scores(), scoreHist: scoreHist.slice(),
        phase, round, trees: T,
        note,
        metrics: {
          树数量: round, 样本数: n, 异常阈值: 0.5,
          最高异常分: safe(Math.max(...scores())), 已建树: round,
        },
      });
      push('初始：正常样本聚成两团、异常点散落四周；开始随机选特征与切分点构造孤立树。', '初始', 0, null, []);
      for (let t = 1; t <= T; t++) {
        const splits = [];
        const tree = buildTree(pts.map((_, i) => i), 0, splits);
        push(`第 ${t}/${T} 棵树：随机切分 ${splits.length} 次，把样本递归孤立到叶子。`, '随机切分', t, tree, splits);
        for (let i = 0; i < n; i++) hSum[i] += pathOf(tree, pts[i], 0);
        scoreHist.push(safe(Math.max(...scores())));
        push(`第 ${t} 棵树完成：累加路径长度，最高异常分数 ${fmt(Math.max(...scores()), 3)}。`, '路径累加', t, tree, splits);
      }
      push(`完成：${T} 棵树平均路径长度归一化后，散落样本被标记为异常（分数接近 1）。`, '完成', T, null, []);
      return steps;
    },

    render(snap, p, c) {
      const pts = snap.pts || [], splits = snap.splits || [], scores = snap.scores || [];
      const scoreHist = snap.scoreHist || [];
      const sx = (x) => PX0 + ((x + 1.8) / 3.6) * (PX1 - PX0);
      const sy = (y) => PY1 - ((y + 1.8) / 3.6) * (PY1 - PY0);
      const xg = (i) => CX0 + (i / Math.max(1, scoreHist.length - 1)) * (CX1 - CX0);
      const dScore = dVals(scoreHist, xg, (v) => CY1 - clamp(num(v, 0), 0, 1) * 92);
      const sorted = scores.slice().sort((a, b) => a - b);
      return (
        <Frame c={c} height={H} title="孤立森林：随机切分路径与异常分数" subtitle={`已建 ${String(Math.round(num(snap.round, 0)))} 棵树`}>
          <defs><clipPath id="if-clip"><rect x={PX0} y={PY0} width={PX1 - PX0} height={PY1 - PY0} /></clipPath></defs>
          <Box c={c} x={PX0} y={PY0} w={PX1 - PX0} h={PY1 - PY0} title="样本与当前树的随机切分" sub="红=高异常分" />
          <g clipPath="url(#if-clip)">
            {splits.map((sp, k) => sp.axis === 'x' ? (
              <line key={k} x1={sx(sp.thr)} y1={sy(sp.bounds.y0)} x2={sx(sp.thr)} y2={sy(sp.bounds.y1)}
                stroke={c.warning} strokeWidth="1" strokeDasharray="3 2" opacity="0.7" />
            ) : (
              <line key={k} x1={sx(sp.bounds.x0)} y1={sy(sp.thr)} x2={sx(sp.bounds.x1)} y2={sy(sp.thr)}
                stroke={c.warning} strokeWidth="1" strokeDasharray="3 2" opacity="0.7" />
            ))}
            {pts.map((q, i) => {
              const s = clamp(num(scores[i], 0), 0, 1);
              return <circle key={i} cx={sx(q.x)} cy={sy(q.y)} r={s > 0.5 ? 4 : 2.6}
                fill={s > 0.5 ? c.danger : c.series[0]} opacity={s > 0.5 ? 0.95 : 0.7} />;
            })}
          </g>
          <Box c={c} x={CX0} y={CY0} w={CX1 - CX0} h={CY1 - CY0} title="异常分数分布 / 最高分收敛" sub="升序" />
          {sorted.map((v, i) => {
            const bw = (CX1 - CX0 - 20) / Math.max(1, sorted.length);
            const h = clamp(num(v, 0), 0, 1) * 56;
            return <rect key={i} x={CX0 + 10 + i * bw} y={CY0 + 78 - h} width={Math.max(1, bw - 0.6)} height={Math.max(1, h)}
              fill={num(v, 0) > 0.5 ? c.danger : c.series[0]} opacity="0.75" />;
          })}
          <line x1={CX0} y1={CY0 + 78} x2={CX1} y2={CY0 + 78} stroke={c.grid} />
          {scoreHist.length > 1 && <path d={dScore} fill="none" stroke={c.purple} strokeWidth="2" />}
          <text x={CX0 + 10} y={CY0 + 16} fontSize="9" fill={c.muted}>{`最高分=${fmt(scoreHist.length ? scoreHist[scoreHist.length - 1] : 0, 3)}`}</text>
          <Foot c={c} text={snap.note} />
        </Frame>
      );
    },
  },

  'calibration': {
    params: [
      { key: 'n', label: '样本数', type: 'range', min: 120, max: 300, step: 10, default: 200 },
      { key: 'bins', label: '可靠曲线分箱数', type: 'range', min: 5, max: 15, step: 1, default: 10 },
      { key: 'distortion', label: '失准程度', type: 'range', min: 0, max: 1, step: 0.05, default: 0.5 },
      { key: 'method', label: '校准方法', type: 'select', default: 'platt', options: [
        { value: 'platt', label: 'Platt Scaling (Sigmoid)' },
        { value: 'isotonic', label: 'Isotonic Regression' },
      ] },
      { key: 'seed', label: '随机种子', type: 'range', min: 1, max: 40, step: 1, default: 7 },
    ],
    height: H,
    legend: [
      { label: '理想校准对角线' }, { label: '未校准可靠曲线' }, { label: '校准后曲线' }, { label: '各分箱样本数' },
    ],
    hint: '把预测分按区间分箱，比较箱内真实正例率与平均预测概率得到可靠性曲线；用 Platt 或保序回归把分数映射成真实概率。',
    buildSteps(p) {
      const n = clamp(Math.round(num(p.n, 200)), 120, 300);
      const bins = clamp(Math.round(num(p.bins, 10)), 5, 15);
      const dist = clamp(num(p.distortion, 0.5), 0, 1);
      const method = p.method === 'isotonic' ? 'isotonic' : 'platt';
      const seed = num(p.seed, 7) >>> 0;
      const rnd = mulberry32(seed);
      const samples = [];
      for (let i = 0; i < n; i++) {
        const pTrue = 0.05 + 0.9 * rnd();
        const logit = Math.log(pTrue / (1 - pTrue)) + dist * ((rnd() - 0.5) * 3 + 0.35);
        const score = clamp(1 / (1 + Math.exp(-logit)), 1e-4, 1 - 1e-4);
        samples.push({ score, y: rnd() < pTrue ? 1 : 0, z: Math.log(score / (1 - score)) });
      }
      const computeBins = () => {
        const bs = Array.from({ length: bins }, () => ({ cnt: 0, ySum: 0, sSum: 0 }));
        for (const d of samples) {
          const b = clamp(Math.floor(d.score * bins), 0, bins - 1);
          bs[b].cnt += 1; bs[b].ySum += d.y; bs[b].sSum += d.score;
        }
        return bs.map((b) => ({
          cnt: b.cnt,
          x: b.cnt ? b.sSum / b.cnt : 0,
          y: b.cnt ? b.ySum / b.cnt : 0,
        }));
      };
      const ece = (bs) => safe(bs.reduce((s, b) => s + (b.cnt / n) * Math.abs(b.x - b.y), 0));
      const steps = [];
      let revealed = 0;
      const push = (note, phase, bs, calib, extra) => steps.push({
        samples: samples.slice(0, n), revealed, bins: bs.slice(), calib: (calib || []).slice(),
        ece: safe(ece(bs)), method, n,
        extra: extra || null,
        note,
        metrics: {
          样本数: n, 分箱数: bins, ECE: safe(ece(bs)), 失准程度: dist,
        },
      });
      let bs = computeBins().map((b) => ({ ...b, cnt: 0, ySum: 0, sSum: 0 }));
      push(`初始：生成 ${n} 个带失准（程度 ${fmt(dist, 2)}）的预测分，开始逐批统计分箱。`, '采样', bs, []);
      for (let b = 1; b <= 20; b++) { revealed = Math.floor((n * b) / 20); push(`已收集 ${revealed}/${n} 个样本的预测分与真实标签。`, '采样', bs, []); }
      bs = computeBins();
      for (let k = 0; k < bins; k++) {
        push(`第 ${k + 1}/${bins} 箱：平均预测 ${fmt(bs[k].x, 3)}，真实正例率 ${fmt(bs[k].y, 3)}，样本 ${String(bs[k].cnt)}。`, '可靠性统计', bs, []);
      }
      if (method === 'platt') {
        let a = 1, b = 0;
        for (let it = 1; it <= 30; it++) {
          let ga = 0, gb = 0;
          for (const d of samples) {
            const pred = 1 / (1 + Math.exp(-clamp(a * d.z + b, -30, 30)));
            const e = pred - d.y;
            ga += e * d.z; gb += e;
          }
          a = clamp(a - 0.02 * ga / n, -5, 5);
          b = clamp(b - 0.02 * gb / n, -5, 5);
          const calib = bs.map((bin) => ({ x: bin.x, y: 1 / (1 + Math.exp(-clamp(a * Math.log(Math.max(1e-4, bin.x / (1 - bin.x))) + b, -30, 30))) }));
          push(`Platt 第 ${it} 步：a=${fmt(a, 3)}, b=${fmt(b, 3)}，把分数映射到 sigmoid(a·logit+b)。`, 'Platt 拟合', bs, calib, { a, b });
        }
      } else {
        let vals = bs.map((bin) => ({ x: bin.x, y: bin.y, w: bin.cnt }));
        let calib = vals.map((v) => ({ x: v.x, y: v.y }));
        push('Isotonic：初始把每箱的实测正例率作为单调回归估计。', '保序回归', bs, calib, null);
        let iter = 0;
        let changed = true;
        while (changed && iter < bins) {
          changed = false;
          for (let k = 0; k + 1 < vals.length; k++) {
            if (vals[k].y > vals[k + 1].y) {
              const w = vals[k].w + vals[k + 1].w;
              const merged = { x: (vals[k].x * vals[k].w + vals[k + 1].x * vals[k + 1].w) / Math.max(1, w),
                y: (vals[k].y * vals[k].w + vals[k + 1].y * vals[k + 1].w) / Math.max(1, w), w };
              vals = vals.slice(0, k).concat([merged], vals.slice(k + 2));
              changed = true; iter += 1;
              calib = vals.map((v) => ({ x: v.x, y: v.y }));
              push(`保序回归 PAVA：合并第 ${k + 1}/${k + 2} 个违规箱，使估计单调不减。`, '保序回归', bs, calib, { merges: iter });
              break;
            }
          }
        }
      }
      push(`校准完成（${method === 'platt' ? 'Platt' : 'Isotonic'}）：可靠性曲线更贴近对角线，初始 ECE=${fmt(ece(bs), 3)}。`, '完成', bs, bs.map((v) => ({ x: v.x, y: v.y })), null);
      return steps;
    },

    render(snap, p, c) {
      const bins = snap.bins || [], calib = snap.calib || [];
      const ece = num(snap.ece, 0);
      const maxCnt = Math.max(1, ...bins.map((b) => num(b.cnt, 0)));
      const px = (v) => PX0 + 18 + clamp(num(v, 0), 0, 1) * (PX1 - PX0 - 34);
      const py = (v) => PY1 - 16 - clamp(num(v, 0), 0, 1) * (PY1 - PY0 - 32);
      const dIdeal = `M${px(0).toFixed(1)},${py(0).toFixed(1)} L${px(1).toFixed(1)},${py(1).toFixed(1)}`;
      const raw = bins.filter((b) => num(b.cnt, 0) > 0).map((b) => [b.x, b.y]);
      const dRaw = dXY(raw, (v) => px(v), (v) => py(v));
      const dCal = dXY(calib.filter((b) => Number.isFinite(num(b.x)) && Number.isFinite(num(b.y))), (v) => px(v), (v) => py(v));
      const bw = (CX1 - CX0 - 20) / Math.max(1, bins.length);
      return (
        <Frame c={c} height={H} title="概率校准：可靠性曲线与分箱" subtitle={`ECE=${fmt(ece, 3)} · ${String(snap.method === 'isotonic' ? 'Isotonic' : 'Platt')}`}>
          <defs><clipPath id="cal-clip"><rect x={PX0} y={PY0} width={PX1 - PX0} height={PY1 - PY0} /></clipPath></defs>
          <Box c={c} x={PX0} y={PY0} w={PX1 - PX0} h={PY1 - PY0} title="可靠性图：预测概率 vs 真实频率" sub="虚线=理想校准" />
          <g clipPath="url(#cal-clip)">
            <path d={dIdeal} fill="none" stroke={c.muted} strokeWidth="1.4" strokeDasharray="5 4" />
            {raw.length > 1 && <path d={dRaw} fill="none" stroke={c.danger} strokeWidth="2" />}
            {calib.length > 1 && <path d={dCal} fill="none" stroke={c.success} strokeWidth="2" />}
            {raw.map((q, i) => <circle key={i} cx={px(q[0])} cy={py(q[1])} r="2.4" fill={c.danger} />)}
          </g>
          <Box c={c} x={CX0} y={CY0} w={CX1 - CX0} h={CY1 - CY0} title="各分箱样本数" sub={`共 ${String(bins.length)} 箱`} />
          {bins.map((b, i) => {
            const h = (clamp(num(b.cnt, 0), 0, maxCnt) / maxCnt) * 96;
            return <rect key={i} x={CX0 + 10 + i * bw} y={CY1 - 14 - h} width={Math.max(1, bw - 2)} height={Math.max(1, h)}
              fill={c.primary} opacity="0.75" />;
          })}
          <line x1={CX0} y1={CY1 - 14} x2={CX1} y2={CY1 - 14} stroke={c.grid} />
          <text x={CX0 + 10} y={CY0 + 18} fontSize="9" fill={c.muted}>{`ECE=${fmt(ece, 3)}`}</text>
          <text x={CX0 + 10} y={CY0 + 36} fontSize="9" fill={c.muted}>{`样本=${String(Math.round(num(snap.revealed, 0)))}`}</text>
          <Foot c={c} text={snap.note} />
        </Frame>
      );
    },
  },
};
