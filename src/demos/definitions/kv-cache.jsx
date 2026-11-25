import React from 'react';
import { mulberry32, clamp } from '../utils.js';

const W = 720;
const H = 340;
const D = 8;

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

export default {
  id: 'kv-cache',
  params: [
    { key: 'genTokens', label: '生成 token 数', type: 'range', min: 2, max: 12, step: 1, default: 6 },
    { key: 'seqLen', label: '提示长度', type: 'range', min: 2, max: 10, step: 1, default: 4 },
    { key: 'useCache', label: '启用 KV Cache', type: 'toggle', default: true },
  ],
  height: H,
  legend: [
    { label: '已缓存的 K/V' }, { label: '本步重算全部' },
    { label: '只算新 token' }, { label: '累计计算量' },
  ],
  hint: 'KV Cache：缓存历史 token 的 K/V，生成时只算新 token，避免每步重算整个序列。',

  buildSteps(p) {
    const G = clamp(Math.round(Number(p.genTokens) || 6), 2, 12);
    const seqLen = clamp(Math.round(Number(p.seqLen) || 4), 2, 10);
    const useCache = !!p.useCache;
    const maxL = seqLen + G;

    const full = Array.from({ length: maxL }, (_, i) =>
      Array.from({ length: D }, (_, k) => mulberry32(51001 + i * 13 + k * 7)()));

    const noCacheStep = [seqLen], cacheStep = [seqLen];
    const noCacheCum = [seqLen], cacheCum = [seqLen];
    let nc = seqLen, cc = seqLen;
    for (let t = 1; t <= G; t++) {
      const L = seqLen + t;
      noCacheStep[t] = L; cacheStep[t] = 1;
      nc += L; cc += 1;
      noCacheCum[t] = nc; cacheCum[t] = cc;
    }

    const steps = [];
    const push = (note, phase, t, L, filledRows, mode, hotRows, extra = {}) => {
      const adopted = useCache ? cacheCum[t] : noCacheCum[t];
      const speedup = cacheCum[t] > 0 ? noCacheCum[t] / cacheCum[t] : 1;
      steps.push({
        genTokens: G, seqLen, useCache, maxL, D,
        full, noCacheStep, cacheStep, noCacheCum, cacheCum,
        phase, t, L, filledRows, mode, hotRows, costT: t,
        cacheMatrix: full.slice(0, L),
        adopted, speedup, note,
        metrics: {
          生成步: t,
          当前长度: L,
          缓存大小: filledRows * D,
          本步重算量: L,
          本步增量: 1,
          采用累计: adopted,
          无缓存累计: noCacheCum[t],
          缓存累计: cacheCum[t],
          加速比: Number(speedup.toFixed(2)),
        },
        ...extra,
      });
    };

    push('KV Cache：解码第 t 步时，历史 token 的 K/V 可复用，无需重新投影。', 'intro',
      0, seqLen, seqLen, 'none', []);
    push(`对比：无缓存每步重算全部 L 个 K/V；有缓存只算 1 个新 token 并追加。当前 ${useCache ? '启用' : '未启用'}缓存。`,
      'compare', 0, seqLen, seqLen, 'none', []);

    for (let i = 0; i < seqLen; i++) {
      push(`预填充：编码提示第 ${i + 1}/${seqLen} 个 token 的 K/V 并写入缓存。`, 'prefill',
        0, seqLen, i + 1, 'one', [i]);
    }

    for (let t = 1; t <= G; t++) {
      const L = seqLen + t;
      const all = Array.from({ length: L }, (_, i) => i);
      push(`第 ${t} 步·无缓存路径：需重算全部 ${L} 个位置的 K/V（本步代价 ${L}）。`,
        'recompute', t, L, L, 'all', all);
      if (useCache) {
        push(`第 ${t} 步·缓存路径：新 token 只需 1 次 K/V 投影，历史 ${seqLen + t - 1} 行直接读缓存。`,
          'incremental', t, L, L, 'one', [L - 1]);
        push(`第 ${t} 步·追加：把新 token 的 K/V 写入第 ${L} 行，缓存增至 ${L}×${D}。`,
          'append', t, L, L, 'one', [L - 1]);
      } else {
        push(`第 ${t} 步·未启用缓存：仍需重算全部 ${L} 个 K/V，无法只算新 token。`,
          'incremental', t, L, L, 'all', all);
        push(`第 ${t} 步·无缓存可追加：本步计算量维持 ${L}，缓存未增长。`,
          'append', t, L, L, 'all', all);
      }
      push(`第 ${t} 步·累计：无缓存 ${noCacheCum[t]}、缓存 ${cacheCum[t]} 次投影，${useCache ? '采用缓存路径累计 ' + cacheCum[t] : '采用无缓存路径累计 ' + noCacheCum[t]}。`,
        'cost', t, L, L, 'none', [L - 1]);
      push(`第 ${t} 步·注意力：新 Q 对 ${L} 个缓存 key 打分；省下的是 ${L - 1} 次历史 K/V 重算。`,
        'attention', t, L, L, 'one', [L - 1]);
    }

    push(`结束：生成 ${G} 个 token，理论加速比 ${(noCacheCum[G] / cacheCum[G]).toFixed(2)}×。`,
      'summary', G, seqLen + G, seqLen + G, 'none', []);
    push(`完成：${useCache ? '启用缓存时' : '未启用缓存时'}累计计算量 ${useCache ? cacheCum[G] : noCacheCum[G]} 次投影。`,
      'done', G, seqLen + G, seqLen + G, 'none', []);
    return finalize(steps);
  },

  render(snap, p, c) {
    const G = snap.genTokens || 2;
    const seqLen = snap.seqLen || 2;
    const useCache = !!snap.useCache;
    const maxL = snap.maxL || seqLen + G;
    const D = snap.D || 8;
    const L = snap.L || seqLen;
    const filledRows = snap.filledRows ?? seqLen;
    const mode = snap.mode || 'none';
    const hotRows = snap.hotRows || [];
    const hot = new Set(hotRows);
    const cacheMatrix = snap.cacheMatrix || [];
    const noCacheCum = snap.noCacheCum || [seqLen];
    const cacheCum = snap.cacheCum || [seqLen];
    const t = snap.t ?? 0;
    const costT = snap.costT ?? 0;
    const adopted = snap.adopted ?? seqLen;
    const speedup = snap.speedup || 1;

    const head = `KV Cache · 提示 ${seqLen} + 生成 ${G} · ${useCache ? '已启用缓存' : '未启用缓存'} · 第 ${t} 步 · 序列长度 ${L}`;

    const left = [];
    left.push(<text key="mt" x={20} y={40} fontSize="11" fill={c.text}>
      KV 缓存矩阵（{filledRows}×{D}）
    </text>);
    const cw = Math.min(26, 250 / D), ch = Math.min(14, 258 / maxL);
    for (let i = 0; i < L; i++) {
      for (let k = 0; k < D; k++) {
        const v = (cacheMatrix[i] || [])[k] || 0;
        const isHot = hot.has(i);
        const filled = i < filledRows;
        let fill = c.primary, op = 0.12 + 0.65 * v;
        if (isHot && mode === 'all') { fill = c.danger; op = 0.55; }
        else if (isHot && mode === 'one') { fill = c.success; op = 0.7; }
        else if (!filled) { fill = c.panel2; op = 0.4; }
        left.push(<rect key={`c${i}-${k}`} x={30 + k * cw} y={50 + i * ch}
          width={Math.max(1, cw - 1)} height={Math.max(1, ch - 1)} rx={1}
          fill={fill} opacity={op} />);
      }
      if (i % 4 === 0 || i === L - 1) {
        left.push(<text key={`lb${i}`} x={26} y={50 + i * ch + ch / 2 + 3}
          textAnchor="end" fontSize="9" fill={c.muted}>{i + 1}</text>);
      }
    }
    left.push(<text key="ml" x={20} y={326} fontSize="9" fill={c.muted}>
      {mode === 'all' ? '红 = 本步全部重算' : mode === 'one' ? '绿 = 本步只算/追加新行' : '色块值 = 缓存的 K/V 激活'}
    </text>);

    const rx = 330;
    const bars = [];
    bars.push(<text key="bt" x={rx} y={40} fontSize="11" fill={c.text}>累计计算量对比（K/V 投影次数）</text>);
    const maxCum = Math.max(1, noCacheCum[costT] || 1, cacheCum[costT] || 1);
    const barBase = 150, barMaxH = 92;
    const h1 = ((noCacheCum[costT] || 0) / maxCum) * barMaxH;
    const h2 = ((cacheCum[costT] || 0) / maxCum) * barMaxH;
    const adoptNo = !useCache;
    bars.push(<g key="b1">
      <rect x={360} y={barBase - h1} width={64} height={h1} rx={2} fill={c.danger} opacity={0.7}
        stroke={adoptNo ? c.warning : c.border} strokeWidth={adoptNo ? 1.6 : 0.6} />
      <text x={392} y={barBase - h1 - 5} textAnchor="middle" fontSize="10" fill={c.text}>
        {noCacheCum[costT] || 0}
      </text>
      <text x={392} y={barBase + 14} textAnchor="middle" fontSize="9" fill={c.muted}>无缓存重算</text>
    </g>);
    bars.push(<g key="b2">
      <rect x={470} y={barBase - h2} width={64} height={h2} rx={2} fill={c.success} opacity={0.7}
        stroke={!adoptNo ? c.warning : c.border} strokeWidth={!adoptNo ? 1.6 : 0.6} />
      <text x={502} y={barBase - h2 - 5} textAnchor="middle" fontSize="10" fill={c.text}>
        {cacheCum[costT] || 0}
      </text>
      <text x={502} y={barBase + 14} textAnchor="middle" fontSize="9" fill={c.muted}>KV Cache</text>
    </g>);
    bars.push(<text key="sp" x={560} y={100} fontSize="11" fill={c.warning}>
      {`加速比 ×${speedup.toFixed(2)}`}
    </text>);
    bars.push(<text key="ad" x={560} y={118} fontSize="9" fill={c.muted}>
      {`采用累计 ${adopted}`}
    </text>);

    const curve = [];
    curve.push(<text key="ct" x={rx} y={186} fontSize="11" fill={c.text}>累计计算量随生成步增长</text>);
    const x0 = 346, x1 = 690, y0 = 202, y1 = 300;
    const cumMax = Math.max(1, noCacheCum[G] || 1);
    const px = (tt) => x0 + (tt / Math.max(1, G)) * (x1 - x0);
    const py = (v) => y1 - (v / cumMax) * (y1 - y0);
    const p1 = [], p2 = [];
    for (let tt = 0; tt <= Math.min(costT, G); tt++) {
      p1.push(`${px(tt).toFixed(1)},${py(noCacheCum[tt] || 0).toFixed(1)}`);
      p2.push(`${px(tt).toFixed(1)},${py(cacheCum[tt] || 0).toFixed(1)}`);
    }
    if (p1.length > 1) curve.push(<polyline key="l1" points={p1.join(' ')} fill="none"
      stroke={c.danger} strokeWidth="1.6" />);
    if (p2.length > 1) curve.push(<polyline key="l2" points={p2.join(' ')} fill="none"
      stroke={c.success} strokeWidth="1.6" />);
    curve.push(<text key="g1" x={x1} y={y0 + 12} textAnchor="end" fontSize="9" fill={c.danger}>无缓存</text>);
    curve.push(<text key="g2" x={x1} y={y0 + 26} textAnchor="end" fontSize="9" fill={c.success}>缓存</text>);
    curve.push(<line key="ax" x1={x0} y1={y1} x2={x1} y2={y1} stroke={c.grid} strokeWidth="0.8" />);
    curve.push(<text key="a0" x={x0} y={y1 + 13} fontSize="9" fill={c.muted}>步 0</text>);
    curve.push(<text key="a1" x={x1} y={y1 + 13} textAnchor="end" fontSize="9" fill={c.muted}>步 {G}</text>);

    return (
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} preserveAspectRatio="xMidYMid meet">
        <text x={20} y={22} fontSize="11" fill={c.text}>{head}</text>
        {left}
        <line x1="312" y1="20" x2="312" y2={H - 12} stroke={c.grid} strokeWidth="1" />
        {bars}
        {curve}
        <text x={330} y={330} fontSize="9" fill={c.muted}>
          无缓存累计 Σ(seqLen+t)；缓存累计 seqLen+t，差距随生成长度二次增长
        </text>
      </svg>
    );
  },
};
