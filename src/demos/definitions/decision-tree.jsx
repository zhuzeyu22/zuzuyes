import React from 'react';
import { mulberry32, clamp } from '../utils.js';

const W = 720, H = 320;
const PX0 = 46, PX1 = 406, PY0 = 34, PY1 = 262;
const CX0 = 448, CX1 = 694, CY0 = 50, CY1 = 200;
const T = 12;            // 每轴 12 个候选阈值 → 每次分裂评估 24 个候选
const MAX_SPLITS = 12;   // 分裂总数上限，控制帧数

function genData(n, seed) {
  const rnd = mulberry32(seed >>> 0);
  const pts = [];
  for (let i = 0; i < n; i++) {
    const x = rnd(), y = rnd();
    let label = ((x > 0.32 && x < 0.68) || ((x - 0.78) ** 2 + (y - 0.32) ** 2 < 0.022)) ? 1 : 0;
    if (rnd() < 0.07) label = 1 - label;
    pts.push({ x, y, label });
  }
  return pts;
}
function impurity(idx, pts, criterion) {
  let n1 = 0;
  for (const i of idx) n1 += pts[i].label;
  const n = idx.length || 1;
  const q = n1 / n;
  if (criterion === 'entropy') {
    const e = (v) => (v <= 0 || v >= 1 ? 0 : -(v * Math.log2(v) + (1 - v) * Math.log2(1 - v)));
    return e(q);
  }
  return 1 - q * q - (1 - q) * (1 - q);
}

export default {
  id: 'decision-tree',
  params: [
    { key: 'maxDepth', label: '最大深度', type: 'range', min: 1, max: 6, step: 1, default: 4 },
    { key: 'minLeaf', label: '最小叶样本数', type: 'range', min: 1, max: 12, step: 1, default: 3 },
    { key: 'criterion', label: '分裂准则', type: 'select', default: 'gini', options: [
      { value: 'gini', label: '基尼不纯度' },
      { value: 'entropy', label: '信息增益(熵)' },
    ] },
    { key: 'n', label: '样本数', type: 'range', min: 40, max: 160, step: 1, default: 90 },
    { key: 'seed', label: '随机种子', type: 'range', min: 1, max: 40, step: 1, default: 8 },
  ],
  height: H,
  legend: [
    { label: '类别 A 样本' }, { label: '类别 B 样本' }, { label: '已确认切分线' },
    { label: '当前评估的候选线' }, { label: '分裂增益' },
  ],
  hint: 'CART 贪心：逐条评估轴对齐候选切分的纯度增益，选最优者递归二分，直至达到最大深度。',

  buildSteps(p) {
    const maxDepth = clamp(Math.round(Number(p.maxDepth) || 4), 1, 6);
    const minLeaf = clamp(Math.round(Number(p.minLeaf) || 3), 1, 20);
    const criterion = p.criterion === 'entropy' ? 'entropy' : 'gini';
    const n = clamp(Math.round(Number(p.n) || 90), 40, 160);
    const seed = (Number(p.seed) || 8) >>> 0;
    const pts = genData(n, seed);
    const all = Array.from({ length: n }, (_, i) => i);
    const critName = criterion === 'entropy' ? '信息增益' : '基尼增益';
    const cuts = [], leaves = [], gainHist = [], frames = [];
    let splitCount = 0;
    const push = (note, evalLine, bestLine) => frames.push({
      cuts: cuts.slice(), leaves: leaves.slice(), evalLine, bestLine,
      gainHist: gainHist.slice(), pts, criterion,
      note,
      metrics: {
        准则: critName, 已分裂: splitCount, 叶节点: leaves.length,
        最大深度: maxDepth, 当前最优增益: bestLine ? clamp(bestLine.gain, 0, 1) : 0,
      },
    });
    const leafNote = (x0, y0, x1, y1, idx, depth) => {
      let n1 = 0;
      for (const i of idx) n1 += pts[i].label;
      const cls = n1 * 2 >= idx.length ? 1 : 0;
      leaves.push({ x0, y0, x1, y1, cls, count: idx.length, depth });
      push(`深度 ${depth} 节点成为叶：${idx.length} 个样本，多数类为第 ${cls + 1} 类。`, null, null);
    };
    const build = (x0, y0, x1, y1, idx, depth) => {
      if (idx.length === 0) return;
      if (depth >= maxDepth || splitCount >= MAX_SPLITS || idx.length < 2 * minLeaf) {
        leafNote(x0, y0, x1, y1, idx, depth);
        return;
      }
      const parentImp = impurity(idx, pts, criterion);
      const rect = { x0, y0, x1, y1 };
      let best = null;
      for (let axis = 0; axis < 2; axis++) {
        const lo = axis === 0 ? x0 : y0, hi = axis === 0 ? x1 : y1;
        for (let t = 1; t <= T; t++) {
          const thr = lo + ((hi - lo) * t) / (T + 1);
          const L = [], R = [];
          for (const i of idx) {
            const v = axis === 0 ? pts[i].x : pts[i].y;
            (v <= thr ? L : R).push(i);
          }
          const valid = L.length >= minLeaf && R.length >= minLeaf;
          const gain = valid
            ? parentImp - (L.length * impurity(L, pts, criterion) + R.length * impurity(R, pts, criterion)) / idx.length
            : 0;
          const cand = { axis, thr, rect, gain, valid };
          push(`评估候选：${axis === 0 ? 'x' : 'y'}=${thr.toFixed(2)}，${valid ? `${critName} ${gain.toFixed(3)}` : '子叶样本不足，跳过'}。`, cand, best);
          if (valid && gain > 1e-9 && (!best || gain > best.gain)) best = cand;
        }
      }
      if (best) {
        push(`选中 ${best.axis === 0 ? 'x' : 'y'}=${best.thr.toFixed(2)}（${critName} ${best.gain.toFixed(3)}），画出切分线并递归。`, null, best);
        cuts.push({ axis: best.axis, thr: best.thr, rect: best.rect, gain: best.gain, depth });
        gainHist.push(best.gain);
        splitCount += 1;
        const L = [], R = [];
        for (const i of idx) {
          const v = best.axis === 0 ? pts[i].x : pts[i].y;
          (v <= best.thr ? L : R).push(i);
        }
        if (best.axis === 0) {
          build(x0, y0, best.thr, y1, L, depth + 1);
          build(best.thr, y0, x1, y1, R, depth + 1);
        } else {
          build(x0, y0, x1, best.thr, L, depth + 1);
          build(x0, best.thr, x1, y1, R, depth + 1);
        }
      } else {
        leafNote(x0, y0, x1, y1, idx, depth);
      }
    };
    push(`初始：${n} 个样本位于根矩形 [0,1]²，准则=${critName}，开始评估候选切分。`, null, null);
    build(0, 0, 1, 1, all, 0);
    push(`构建完成：共 ${splitCount} 次分裂、${leaves.length} 个叶节点。`, null, null);
    if (frames.length > 400) {
      const stride = Math.ceil(frames.length / 400);
      return frames.filter((_, i) => i % stride === 0 || i === frames.length - 1);
    }
    return frames;
  },

  render(snap, p, c) {
    const pts = snap.pts || [];
    const cuts = snap.cuts || [];
    const leaves = snap.leaves || [];
    const evalLine = snap.evalLine || null;
    const gainHist = snap.gainHist || [];
    const sx = (x) => PX0 + x * (PX1 - PX0);
    const sy = (y) => PY1 - y * (PY1 - PY0);
    const lineOf = (axis, thr, rect, color, dash, width) => {
      if (!rect) return null;
      if (axis === 0) {
        return <line x1={sx(thr)} y1={sy(rect.y1)} x2={sx(thr)} y2={sy(rect.y0)} stroke={color} strokeWidth={width} strokeDasharray={dash} />;
      }
      return <line x1={sx(rect.x0)} y1={sy(thr)} x2={sx(rect.x1)} y2={sy(thr)} stroke={color} strokeWidth={width} strokeDasharray={dash} />;
    };
    const maxG = Math.max(1e-6, ...gainHist);
    const hx = (i) => CX0 + (i / Math.max(1, gainHist.length)) * (CX1 - CX0);
    const hy = (v) => CY1 - (clamp(v, 0, maxG) / maxG) * (CY1 - CY0);
    const dGain = gainHist.map((v, i) => `${i === 0 ? 'M' : 'L'}${hx(i).toFixed(1)},${hy(v).toFixed(1)}`).join(' ');
    return (
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} preserveAspectRatio="xMidYMid meet">
        <defs><clipPath id="dt-clip"><rect x={PX0} y={PY0} width={PX1 - PX0} height={PY1 - PY0} /></clipPath></defs>
        <rect x={PX0} y={PY0} width={PX1 - PX0} height={PY1 - PY0} fill={c.panel} stroke={c.border} />
        <g clipPath="url(#dt-clip)">
          {leaves.map((lf, i) => (
            <rect key={`lf${i}`} x={sx(lf.x0)} y={sy(lf.y1)}
              width={sx(lf.x1) - sx(lf.x0)} height={sy(lf.y0) - sy(lf.y1)}
              fill={c.series[lf.cls % c.series.length]} opacity={0.1} />
          ))}
          {cuts.map((ct, i) => (
            <g key={`ct${i}`}>{lineOf(ct.axis, ct.thr, ct.rect, c.primary, undefined, 1.8)}</g>
          ))}
          {evalLine && lineOf(evalLine.axis, evalLine.thr, evalLine.rect, c.warning, '5 3', 2)}
          {pts.map((q, i) => (
            <circle key={i} cx={sx(q.x)} cy={sy(q.y)} r="2.3"
              fill={c.series[q.label % c.series.length]} opacity={0.85} />
          ))}
        </g>
        <text x={PX0} y={PY0 - 8} fontSize="11" fill={c.muted}>二维特征平面：递归矩形切分</text>
        <text x={PX0} y={PY1 + 16} fontSize="10" fill={c.muted}>蓝线=已选切分，黄虚线=正在评估</text>
        <text x={PX1} y={PY1 + 16} fontSize="10" textAnchor="end" fill={c.muted}>淡色=叶区域多数类</text>
        <text x={CX0} y={CY0 - 14} fontSize="11" fill={c.muted}>历次分裂增益</text>
        <rect x={CX0} y={CY0} width={CX1 - CX0} height={CY1 - CY0} fill={c.panel} stroke={c.border} />
        <line x1={CX0} y1={CY1} x2={CX1} y2={CY1} stroke={c.grid} />
        <line x1={CX0} y1={CY0} x2={CX0} y2={CY1} stroke={c.grid} />
        <path d={dGain} fill="none" stroke={c.success} strokeWidth="2" />
        <text x={CX0} y={CY0 + 12} fontSize="9" fill={c.muted}>增益</text>
        <text x={CX1} y={CY0 + 12} fontSize="9" textAnchor="end" fill={c.muted}>{snap.criterion === 'entropy' ? '信息增益' : '基尼增益'}</text>
        <text x={(CX0 + CX1) / 2} y={CY1 + 16} fontSize="10" textAnchor="middle" fill={c.muted}>分裂序号 →</text>
        <text x="20" y={H - 12} fontSize="11" fill={c.text}>{snap.note || '拖动进度条查看贪心分裂'}</text>
      </svg>
    );
  },
};
