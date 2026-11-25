import React from 'react';
import { mulberry32, clamp } from '../utils.js';

const W = 720;
const r2 = (v) => Math.round((Number.isFinite(v) ? v : 0) * 100) / 100;
const f2 = (v) => (Number.isFinite(v) ? v : 0).toFixed(2);

export default {
  id: 'mmr-rerank',
  params: [
    { key: 'lambda', label: '相关性权重 λ', type: 'range', min: 0, max: 1, step: 0.05, default: 0.5, hint: 'λ=1 退化为纯相关性排序，λ=0 只看多样性' },
    { key: 'K', label: '推荐列表长度 K', type: 'range', min: 3, max: 8, step: 1, default: 5 },
    { key: 'nCand', label: '候选数', type: 'range', min: 8, max: 16, step: 1, default: 10 },
    { key: 'nCat', label: '类目数', type: 'range', min: 2, max: 5, step: 1, default: 3 },
    { key: 'seed', label: '随机种子', type: 'range', min: 1, max: 30, step: 1, default: 7 },
    {
      key: 'divBasis', label: '冗余相似度度量', type: 'select', default: 'cat',
      options: [
        { value: 'cat', label: '类目重合（同类目=1）' },
        { value: 'feat', label: '特征向量余弦' },
      ],
    },
  ],
  height: 370,
  legend: [
    { color: '#226AFF', label: '候选相关性 / λ·Rel 项' },
    { color: '#e5484d', label: '冗余惩罚 (1−λ)·maxSim' },
    { color: '#12a06a', label: 'MMR 已选结果' },
    { color: '#98a4c8', label: '纯相关性排序（对照）' },
  ],
  hint: 'MMR 每步选 argmax[λ·相关性 − (1−λ)·与已选的最大相似度]，用少量相关性换取类目多样性。',

  buildSteps(p) {
    const rnd = mulberry32(p.seed);
    const nCand = clamp(Math.round(p.nCand), 8, 16);
    const nCat = clamp(Math.round(p.nCat), 2, 5);
    const K = clamp(Math.round(p.K), 1, Math.min(8, nCand));
    const lambda = clamp(Number(p.lambda) || 0, 0, 1);
    const divBasis = p.divBasis === 'feat' ? 'feat' : 'cat';

    // 候选：类目 0 的相关性整体偏高，使纯相关排序高度集中，便于对比 MMR
    const cands = Array.from({ length: nCand }, (_, i) => {
      const cat = i < Math.ceil(nCand * 0.55) ? 0 : Math.floor(rnd() * nCat);
      const rel = clamp(0.22 + 0.6 * rnd() + (cat === 0 ? 0.18 : 0), 0.05, 1);
      const feat = [rnd(), rnd(), rnd()];
      return { i, cat, rel, feat };
    });
    if (nCand >= 2) cands[1].cat = Math.min(1, nCat - 1);

    const sim = (a, b) => {
      if (divBasis === 'feat') {
        const fa = cands[a].feat, fb = cands[b].feat;
        let dot = 0, na = 0, nb = 0;
        for (let d = 0; d < fa.length; d++) { dot += fa[d] * fb[d]; na += fa[d] * fa[d]; nb += fb[d] * fb[d]; }
        const den = Math.sqrt(na) * Math.sqrt(nb);
        return den > 1e-9 ? dot / den : 0;
      }
      return cands[a].cat === cands[b].cat ? 1 : 0;
    };

    const baseline = cands.slice().sort((x, y) => y.rel - x.rel).slice(0, K).map((o) => o.i);
    const avgRel = (list) => list.length ? list.reduce((s, i) => s + cands[i].rel, 0) / list.length : 0;
    const cover = (counts) => counts.filter((x) => x > 0).length;
    const countsOf = (list) => {
      const arr = Array(nCat).fill(0);
      list.forEach((i) => { arr[cands[i].cat] += 1; });
      return arr;
    };

    const buildTable = (S) => cands.map((cd) => {
      if (S.includes(cd.i)) return { i: cd.i, selected: true, rel: cd.rel, cat: cd.cat };
      let simMax = 0, simWith = -1;
      S.forEach((s) => {
        const sv = sim(cd.i, s);
        if (sv > simMax) { simMax = sv; simWith = s; }
      });
      const relTerm = lambda * cd.rel;
      const divTerm = (1 - lambda) * simMax;
      return { i: cd.i, selected: false, rel: cd.rel, cat: cd.cat, simMax, simWith, relTerm, divTerm, mmr: relTerm - divTerm };
    });

    const steps = [];
    const S = [];
    const snapOf = (note, phase, metrics, extra) => steps.push({
      cands, nCand, nCat, K, lambda, divBasis, baseline,
      S: S.slice(), phase, note, metrics, ...extra,
    });

    const cntB = countsOf(baseline);
    snapOf(`候选池共 ${nCand} 个（${nCat} 个类目）。纯相关性 Top-${K} 覆盖 ${cover(cntB)} 个类目，下面用 MMR 逐步重排引入多样性。`,
      'init',
      { 候选数: nCand, 列表长度: K, 类目数: nCat, 相关性权重λ: r2(lambda), 纯相关覆盖类目: cover(cntB) },
      { table: buildTable(S), evalUpTo: 0, round: 0, distReveal: 0 });

    for (let r = 1; r <= K; r++) {
      const table = buildTable(S);
      // 逐个候选展示 MMR 各项数值
      for (let d = 0; d < nCand; d++) {
        const row = table[d];
        if (row.selected) {
          snapOf(`第 ${r} 轮｜候选 C${d} 已在已选集合中，跳过（不重复入选）。`, 'eval',
            { 轮次: r, 已选: S.length, 当前候选: 'C' + d, MMR得分: 0 },
            { table, evalUpTo: d + 1, round: r, distReveal: 0 });
        } else {
          snapOf(
            `第 ${r} 轮｜评估 C${d}：λ·Rel=${f2(row.relTerm)} − (1−λ)·maxSim=${f2(row.divTerm)} → MMR=${f2(row.mmr)}（最相似已选 ${row.simWith >= 0 ? 'C' + row.simWith : '无'}，sim=${f2(row.simMax)}）。`,
            'eval',
            { 轮次: r, 已选: S.length, 当前候选: 'C' + d, 相关性项: r2(row.relTerm), 冗余惩罚: r2(row.divTerm), MMR得分: r2(row.mmr) },
            { table, evalUpTo: d + 1, round: r, distReveal: 0 },
          );
        }
      }
      // 选中本轮 MMR 最大者
      let best = null;
      table.forEach((row) => {
        if (row.selected) return;
        if (!best || row.mmr > best.mmr) best = row;
      });
      if (!best) break;
      const chosen = best.i;
      S.push(chosen);
      snapOf(`第 ${r} 轮｜选中 C${chosen}（类目 C${cands[chosen].cat}，MMR=${f2(best.mmr)}）：已选 ${S.length}/${K}。`,
        'select',
        { 轮次: r, 选中: 'C' + chosen, MMR得分: r2(best.mmr), 已选: S.length, 选中类目: cands[chosen].cat },
        { table, evalUpTo: nCand, round: r, distReveal: 0 });
    }

    const cntM = countsOf(S);
    snapOf(`对照｜纯相关性排序 = [${baseline.map((i) => 'C' + i).join(', ')}]，平均相关性 ${f2(avgRel(baseline))}，覆盖 ${cover(cntB)} 个类目。`,
      'baseline',
      { 纯相关平均相关性: r2(avgRel(baseline)), 纯相关覆盖类目: cover(cntB), 列表长度: K },
      { table: buildTable(S), evalUpTo: nCand, round: K, distReveal: 0 });

    for (let t = 0; t < nCat; t++) {
      snapOf(`类目 C${t} 分布对比：纯相关列表 ${cntB[t]} 个，MMR 列表 ${cntM[t]} 个。`,
        'dist',
        { 类目: 'C' + t, 纯相关该数: cntB[t], MMR该数: cntM[t], MMR覆盖类目: cover(cntM) },
        { table: buildTable(S), evalUpTo: nCand, round: K, distReveal: t + 1 });
    }
    snapOf(`完成｜MMR 覆盖 ${cover(cntM)} 个类目（纯相关 ${cover(cntB)} 个），平均相关性 ${f2(avgRel(S))} vs ${f2(avgRel(baseline))}：用 ${f2(avgRel(baseline) - avgRel(S))} 的相关性换取多样性。`,
      'end',
      { MMR覆盖类目: cover(cntM), 纯相关覆盖类目: cover(cntB), MMR平均相关性: r2(avgRel(S)), 相关性损失: r2(avgRel(baseline) - avgRel(S)) },
      { table: buildTable(S), evalUpTo: nCand, round: K, distReveal: nCat });

    return steps;
  },

  render(snap, p, c) {
    const H = 370;
    const cands = Array.isArray(snap.cands) ? snap.cands : [];
    const table = Array.isArray(snap.table) ? snap.table : [];
    const S = Array.isArray(snap.S) ? snap.S : [];
    const baseline = Array.isArray(snap.baseline) ? snap.baseline : [];
    const nCand = cands.length, nCat = snap.nCat || 0, K = snap.K || 0;
    const lambda = snap.lambda ?? 0.5;
    const phase = snap.phase || 'init';
    const evalUpTo = snap.evalUpTo ?? 0;
    const distReveal = snap.distReveal ?? 0;
    const rowH = 240 / Math.max(1, nCand);

    const countsOf = (list) => {
      const arr = Array(nCat).fill(0);
      list.forEach((i) => { if (cands[i] && cands[i].cat < arr.length) arr[cands[i].cat] += 1; });
      return arr;
    };
    const cntB = countsOf(baseline), cntM = countsOf(S);
    const maxCnt = Math.max(1, ...cntB, ...cntM);
    const gw = 230 / Math.max(1, nCat);

    return (
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} preserveAspectRatio="xMidYMid meet">
        <text x="20" y="14" fontSize="11" fill={c.text}>
          MMR 多样性重排 · λ={f2(lambda)} · {snap.divBasis === 'feat' ? '特征余弦' : '类目重合'} · 已选 {S.length}/{K}
        </text>
        <text x="20" y="30" fontSize="10" fill={c.muted}>候选池与 MMR 打分表</text>
        <text x="20" y="38" fontSize="9" fill={c.muted}>ID</text>
        <text x="56" y="38" fontSize="9" fill={c.muted}>相关性</text>
        <text x="150" y="38" fontSize="9" fill={c.muted}>类目</text>
        <text x="205" y="38" fontSize="9" fill={c.muted}>λ·Rel</text>
        <text x="265" y="38" fontSize="9" fill={c.muted}>惩罚</text>
        <text x="325" y="38" fontSize="9" fill={c.muted}>MMR</text>
        <text x="390" y="38" fontSize="9" fill={c.muted}>状态</text>

        {cands.map((cd, t) => {
          const row = table[t] || {};
          const y = 42 + t * rowH;
          const selIdx = S.indexOf(cd.i);
          const isCur = phase === 'eval' && t === evalUpTo - 1 && selIdx < 0;
          const scored = phase !== 'eval' || t < evalUpTo;
          return (
            <g key={cd.i}>
              <rect x="18" y={y} width="412" height={Math.max(1, rowH - 1)} rx="2"
                fill={selIdx >= 0 ? c.success : (isCur ? c.warning : c.panel)}
                opacity={selIdx >= 0 ? 0.22 : (isCur ? 0.3 : (t % 2 ? 0.5 : 0.85))} />
              <text x="22" y={y + rowH / 2 + 3} fontSize="9" fill={c.text}>C{cd.i}</text>
              <rect x="56" y={y + rowH / 2 - 4} width="70" height="8" rx="2" fill={c.panel2} />
              <rect x="56" y={y + rowH / 2 - 4} width={clamp(cd.rel, 0, 1) * 70} height="8" rx="2" fill={c.primary} opacity="0.85" />
              <text x="130" y={y + rowH / 2 + 3} fontSize="9" fill={c.text}>{f2(cd.rel)}</text>
              <rect x="150" y={y + rowH / 2 - 5} width="12" height="10" rx="2" fill={c.series[cd.cat % c.series.length]} />
              <text x="166" y={y + rowH / 2 + 3} fontSize="9" fill={c.muted}>C{cd.cat}</text>
              <text x="205" y={y + rowH / 2 + 3} fontSize="9" fill={c.text}>{scored && !row.selected ? f2(row.relTerm) : (row.selected ? '已选' : '—')}</text>
              <text x="265" y={y + rowH / 2 + 3} fontSize="9" fill={c.danger}>{scored && !row.selected ? f2(row.divTerm) : (row.selected ? '已选' : '—')}</text>
              <text x="325" y={y + rowH / 2 + 3} fontSize="9" fill={c.success}>{scored && !row.selected ? f2(row.mmr) : (row.selected ? '已选' : '—')}</text>
              <text x="390" y={y + rowH / 2 + 3} fontSize="9" fill={c.text}>
                {selIdx >= 0 ? '已选#' + (selIdx + 1) : (isCur ? '评估中' : '候选')}
              </text>
            </g>
          );
        })}
        <line x1="18" y1="284" x2="430" y2="284" stroke={c.grid} strokeWidth="1" />
        <text x="20" y="300" fontSize="9" fill={c.muted}>
          MMR(d) = {f2(lambda)}·Rel(d) − {f2(1 - lambda)}·maxₛ Sim(d, s)，S 为已选集合。
        </text>
        <text x="20" y="316" fontSize="9" fill={c.muted}>
          每轮先逐个候选算分，再取最大者入选；λ→1 退化为纯相关性排序，λ→0 只追求多样性。
        </text>

        {/* 右上：已选列表 */}
        <text x="450" y="30" fontSize="10" fill={c.text}>MMR 已选列表（按选中顺序）</text>
        {S.length === 0 && <text x="450" y="50" fontSize="9" fill={c.muted}>（尚未选择任何候选）</text>}
        {S.map((ci, t) => (
          <g key={'sel' + t}>
            <text x="450" y={46 + t * 14} fontSize="9" fill={c.text}>{t + 1}. C{ci}</text>
            <rect x="510" y={38 + t * 14} width="12" height="10" rx="2"
              fill={cands[ci] ? c.series[cands[ci].cat % c.series.length] : c.panel2} />
            <text x="528" y={46 + t * 14} fontSize="9" fill={c.muted}>
              {cands[ci] ? '类目 C' + cands[ci].cat + ' · Rel ' + f2(cands[ci].rel) : ''}
            </text>
          </g>
        ))}

        {/* 右中：类目分布对比 */}
        <text x="450" y="172" fontSize="10" fill={c.text}>类目分布对比：纯相关 vs MMR</text>
        <rect x="450" y="182" width="9" height="9" rx="1" fill={c.accent} />
        <text x="463" y="190" fontSize="9" fill={c.muted}>纯相关列表</text>
        <rect x="540" y="182" width="9" height="9" rx="1" fill={c.success} />
        <text x="553" y="190" fontSize="9" fill={c.muted}>MMR 列表（当前已选）</text>
        <line x1="450" y1="300" x2="680" y2="300" stroke={c.grid} strokeWidth="1" />
        {Array.from({ length: nCat }, (_, t) => {
          const x = 450 + t * gw;
          const hb = (cntB[t] / maxCnt) * 100, hm = (cntM[t] / maxCnt) * 100;
          const hi = phase === 'dist' && t === distReveal - 1;
          return (
            <g key={'cat' + t}>
              {hi && <rect x={x + 1} y="196" width={gw - 2} height="104" rx="2" fill={c.warning} opacity="0.16" />}
              <rect x={x + gw * 0.12} y={300 - hb} width={gw * 0.32} height={hb} fill={c.accent} opacity="0.75" />
              <rect x={x + gw * 0.54} y={300 - hm} width={gw * 0.32} height={hm} fill={c.success} opacity="0.9" />
              <text x={x + gw * 0.28} y={300 - hb - 3} textAnchor="middle" fontSize="9" fill={c.muted}>{cntB[t]}</text>
              <text x={x + gw * 0.7} y={300 - hm - 3} textAnchor="middle" fontSize="9" fill={c.success}>{cntM[t]}</text>
              <rect x={x + gw * 0.34} y="306" width="8" height="8" rx="1" fill={c.series[t % c.series.length]} />
              <text x={x + gw * 0.34 + 11} y="313" fontSize="9" fill={c.text}>C{t}</text>
            </g>
          );
        })}
        <text x="450" y="324" fontSize="9" fill={c.muted}>柱高 = 该类目在列表中的物品数；MMR 让类目更分散。</text>

        <line x1="20" y1="326" x2={W - 20} y2="326" stroke={c.grid} strokeWidth="1" />
        <text x="20" y="342" fontSize="9" fill={c.muted}>
          {snap.divBasis === 'feat'
            ? '相似度 Sim = 候选特征向量的余弦相似度（0~1）；'
            : '相似度 Sim = 同类目取 1、不同类目取 0；'}
          纯相关 baseline 固定为按 Rel 降序的前 {K} 个。
        </text>
        <text x="20" y="358" fontSize="9" fill={c.muted}>
          调大 λ、改类目数 / 度量方式 / 种子，都会真实改变每一步的 MMR 打分与最终类目分布。
        </text>
      </svg>
    );
  },
};
