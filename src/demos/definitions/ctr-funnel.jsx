import React from 'react';
import { mulberry32, clamp } from '../utils.js';

const W = 720;
const r2 = (v) => Math.round((Number.isFinite(v) ? v : 0) * 100) / 100;
const f2 = (v) => (Number.isFinite(v) ? v : 0).toFixed(2);

export default {
  id: 'ctr-funnel',
  params: [
    { key: 'pool', label: '候选池规模', type: 'range', min: 100, max: 1000, step: 50, default: 500 },
    { key: 'recallKeep', label: '召回保留率', type: 'range', min: 0.05, max: 0.5, step: 0.05, default: 0.2 },
    { key: 'rankKeep', label: '粗排保留率', type: 'range', min: 0.1, max: 0.6, step: 0.05, default: 0.3 },
    { key: 'fineKeep', label: '精排保留率', type: 'range', min: 0.1, max: 0.8, step: 0.05, default: 0.4 },
    { key: 'ctrThresh', label: 'CTR 模型阈值', type: 'range', min: 0.1, max: 0.9, step: 0.05, default: 0.5, hint: '精排 pCTR 低于阈值的物品被过滤' },
    { key: 'seed', label: '随机种子', type: 'range', min: 1, max: 30, step: 1, default: 7 },
    { key: 'dedup', label: '重排同类目去重', type: 'toggle', default: true, hint: '按类目轮转选取，打散曝光列表' },
  ],
  height: 380,
  legend: [
    { color: '#226AFF', label: '召回' },
    { color: '#12a06a', label: '粗排' },
    { color: '#f5a524', label: '精排' },
    { color: '#e5484d', label: '重排 / 最终曝光' },
  ],
  hint: '推荐系统漏斗：召回→粗排→精排→重排，逐层筛掉大部分候选；观察 CTR 预估排序变化、最终曝光列表与耗时估算。',

  buildSteps(p) {
    const rnd = mulberry32(p.seed);
    const pool = clamp(Math.round(p.pool), 100, 1000);
    const recallKeep = clamp(Number(p.recallKeep) || 0.05, 0.02, 0.9);
    const rankKeep = clamp(Number(p.rankKeep) || 0.1, 0.05, 0.9);
    const fineKeep = clamp(Number(p.fineKeep) || 0.1, 0.05, 0.9);
    const ctrThresh = clamp(Number(p.ctrThresh) || 0, 0, 1);
    const dedup = !!p.dedup;

    // 每个物品：真实 CTR 与三个模型的带噪估计（噪声逐层减小）
    const items = Array.from({ length: pool }, (_, id) => {
      const trueCtr = 0.02 + 0.85 * rnd() * rnd();
      return {
        id,
        trueCtr,
        recallScore: clamp(trueCtr + (rnd() - 0.5) * 0.35, 0, 1),
        coarseCtr: clamp(trueCtr + (rnd() - 0.5) * 0.3, 0, 1),
        fineCtr: clamp(trueCtr + (rnd() - 0.5) * 0.08, 0, 1),
        cat: Math.floor(rnd() * 4),
      };
    });
    const allIds = items.map((o) => o.id);

    // 逐层漏斗（全部为真实排序 / 筛选）
    const n1 = Math.max(1, Math.round(pool * recallKeep));
    const recallList = allIds.slice().sort((a, b) => items[b].recallScore - items[a].recallScore).slice(0, n1);
    const n2 = Math.max(1, Math.round(n1 * rankKeep));
    const coarseList = recallList.slice().sort((a, b) => items[b].coarseCtr - items[a].coarseCtr).slice(0, n2);

    let passed = coarseList.filter((id) => items[id].fineCtr >= ctrThresh);
    if (passed.length === 0) {
      const best = coarseList.slice().sort((a, b) => items[b].fineCtr - items[a].fineCtr)[0];
      passed = best === undefined ? [] : [best];
    }
    passed.sort((a, b) => items[b].fineCtr - items[a].fineCtr);
    const n3 = Math.max(1, Math.round(passed.length * fineKeep));
    const fineList = passed.slice(0, n3);

    // 重排：可选按类目轮转去重，得到最终曝光列表
    const targetN = Math.min(10, Math.max(1, fineList.length));
    let finalIds;
    if (dedup) {
      const byCat = Array.from({ length: 4 }, () => []);
      fineList.forEach((id) => byCat[items[id].cat].push(id));
      finalIds = [];
      for (let round = 0; round < targetN && finalIds.length < targetN; round++) {
        for (let cat = 0; cat < 4 && finalIds.length < targetN; cat++) {
          if (byCat[cat][round] !== undefined) finalIds.push(byCat[cat][round]);
        }
      }
    } else {
      finalIds = fineList.slice(0, targetN);
    }
    if (finalIds.length === 0 && fineList.length > 0) finalIds = [fineList[0]];

    // 排序变化：同一批粗排候选，在粗排模型与精排模型下的名次
    const coarseSorted = coarseList.slice().sort((a, b) => items[b].coarseCtr - items[a].coarseCtr);
    const fineSorted = coarseList.slice().sort((a, b) => items[b].fineCtr - items[a].fineCtr);
    const rankCompare = fineSorted.slice(0, 8).map((id, t) => {
      const cr = coarseSorted.indexOf(id);
      return { id, fineRank: t + 1, coarseRank: cr >= 0 ? cr + 1 : null,
        coarseCtr: items[id].coarseCtr, fineCtr: items[id].fineCtr };
    });

    // 计算量 / 耗时估算（随规模与保留率真实变化）
    const units = { recall: pool, coarse: n1 * 8, fine: n2 * 60, rerank: fineList.length * 3 + 10 };
    const totalUnits = units.recall + units.coarse + units.fine + units.rerank;
    const msOf = (u) => u * 0.015;
    const totalMs = 2 + msOf(totalUnits);
    const STAGES = [
      { key: 'recall', name: '召回', inCount: pool, outCount: n1, units: units.recall, ms: msOf(units.recall),
        detail: '向量检索取召回分最高的物品' },
      { key: 'coarse', name: '粗排', inCount: n1, outCount: n2, units: units.coarse, ms: msOf(units.coarse),
        detail: '轻量模型按 coarseCtr 截断' },
      { key: 'fine', name: '精排', inCount: n2, outCount: fineList.length, units: units.fine, ms: msOf(units.fine),
        detail: `DNN 精排 + 过滤 pCTR < ${f2(ctrThresh)}` },
      { key: 'rerank', name: '重排', inCount: fineList.length, outCount: finalIds.length, units: units.rerank, ms: msOf(units.rerank),
        detail: dedup ? '按类目轮转去重打散' : '按 pCTR 直接截断' },
    ];

    const steps = [];
    const snapOf = (note, stage, metrics, extra) => steps.push({
      items, pool, recallKeep, rankKeep, fineKeep, ctrThresh, dedup,
      STAGES, rankCompare, finalIds, fineList, coarseList,
      units, totalUnits, totalMs, stage, note, metrics, ...extra,
    });

    snapOf(`候选池 ${pool} 个物品，每阶段按保留率逐层筛选；总计算量约 ${r2(totalUnits)} 单位、预估耗时 ${f2(totalMs)} ms。`,
      'init',
      { 候选池: pool, 召回保留率: r2(recallKeep), 粗排保留率: r2(rankKeep), 精排阈值: r2(ctrThresh), 预估总耗时: r2(totalMs) },
      { progress: 0, revealRank: 0, revealExpose: 0 });

    let cumUnits = 0;
    for (const s of STAGES) {
      cumUnits += s.units;
      for (let f = 1; f <= 5; f++) {
        snapOf(`${s.name}阶段（${f}/5）：从 ${s.inCount} 个候选中按「${s.detail}」保留 ${s.outCount} 个；本阶段计算量 ${r2(s.units)} 单位 / ${f2(s.ms)} ms，累计 ${r2(cumUnits)} 单位。`,
          s.key,
          { 阶段: s.name, 输入数: s.inCount, 输出数: s.outCount, 本阶段耗时: r2(s.ms), 累计计算量: r2(cumUnits) },
          { progress: f / 5, revealRank: 0, revealExpose: 0 });
      }
    }

    for (let t = 1; t <= rankCompare.length; t++) {
      const o = rankCompare[t - 1];
      const cr = o.coarseRank;
      const delta = cr === null ? '↑新进' : (cr > o.fineRank ? '↑' + (cr - o.fineRank) : (cr < o.fineRank ? '↓' + (o.fineRank - cr) : '→'));
      snapOf(`CTR 排序变化｜精排第 ${o.fineRank} 名 I${o.id}：粗排名次 ${cr === null ? '榜外' : cr}（${delta}），粗排 pCTR=${f2(o.coarseCtr)} → 精排 pCTR=${f2(o.fineCtr)}。`,
        'rank',
        { 精排名次: o.fineRank, 物品: 'I' + o.id, 粗排名次: cr === null ? '榜外' : cr, 精排pCTR: r2(o.fineCtr), 名次变化: delta },
        { progress: 1, revealRank: t, revealExpose: 0 });
    }

    for (let t = 1; t <= finalIds.length; t++) {
      const id = finalIds[t - 1];
      snapOf(`最终曝光第 ${t} 位：I${id}（类目 C${items[id].cat}，pCTR=${f2(items[id].fineCtr)}）；重排${dedup ? '按类目去重' : '直接截断'}后共 ${finalIds.length} 个曝光。`,
        'expose',
        { 曝光位: t, 物品: 'I' + id, 精排pCTR: r2(items[id].fineCtr), 类目: items[id].cat, 曝光总数: finalIds.length },
        { progress: 1, revealRank: rankCompare.length, revealExpose: t });
    }

    snapOf(`完成｜召回 ${n1} → 粗排 ${n2} → 精排 ${fineList.length} → 曝光 ${finalIds.length}；总计算量 ${r2(totalUnits)} 单位，整体耗时约 ${f2(totalMs)} ms。`,
      'end',
      { 总耗时: r2(totalMs), 总计算量: r2(totalUnits), 最终曝光数: finalIds.length, 召回数: n1, 精排数: fineList.length },
      { progress: 1, revealRank: rankCompare.length, revealExpose: finalIds.length });

    return steps;
  },

  render(snap, p, c) {
    const H = 380;
    const items = Array.isArray(snap.items) ? snap.items : [];
    const STAGES = Array.isArray(snap.STAGES) ? snap.STAGES : [];
    const rankCompare = Array.isArray(snap.rankCompare) ? snap.rankCompare : [];
    const finalIds = Array.isArray(snap.finalIds) ? snap.finalIds : [];
    const pool = snap.pool || 0;
    const stage = snap.stage || 'init';
    const progress = snap.progress ?? 0;
    const revealRank = snap.revealRank ?? 0;
    const revealExpose = snap.revealExpose ?? 0;
    const totalMs = snap.totalMs || 0;
    const stageIdx = STAGES.findIndex((s) => s.key === stage);

    const layerY = [42, 106, 170, 234];
    const centerX = 190;

    return (
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} preserveAspectRatio="xMidYMid meet">
        <text x="20" y="14" fontSize="11" fill={c.text}>
          推荐漏斗 · 召回 → 粗排 → 精排 → 重排 · 候选池 {pool} · 总耗时 ≈ {f2(totalMs)} ms
        </text>
        <text x="20" y="30" fontSize="10" fill={c.muted}>各层物品数量与方块示意（宽度 ∝ 数量）</text>
        <text x="380" y="30" fontSize="10" fill={c.muted}>CTR 预估排序变化（粗排 → 精排）</text>

        {/* 左：漏斗各层 */}
        {STAGES.map((s, i) => {
          const scale = Math.sqrt(s.outCount / Math.max(1, pool));
          const wt = 70 + 250 * clamp(scale, 0, 1);
          const x = centerX - wt / 2;
          const y = layerY[i] || (42 + i * 64);
          const shown = Math.ceil(30 * progress);
          const cols = clamp(Math.floor((wt - 16) / 10), 4, 10);
          const isCur = i === stageIdx;
          return (
            <g key={s.key}>
              <rect x={x} y={y} width={wt} height="54" rx="4" fill={c.panel}
                stroke={isCur ? c.warning : c.border} strokeWidth={isCur ? 1.6 : 1} />
              <text x={centerX} y={y + 13} textAnchor="middle" fontSize="9" fill={c.text}>
                {s.name} · {s.outCount} 个 · {f2(s.ms)} ms
              </text>
              {Array.from({ length: shown }, (_, k) => {
                const col = k % cols, row = Math.floor(k / cols);
                if (row >= 3) return null;
                const bx = centerX - (cols * 10) / 2 + 5 + col * 10;
                const by = y + 21 + row * 10;
                return <rect key={k} x={bx} y={by} width="7" height="7" rx="1"
                  fill={c.series[i % c.series.length]} opacity={0.45 + 0.4 * ((k % 5) / 5)} />;
              })}
            </g>
          );
        })}
        <text x="20" y="304" fontSize="9" fill={c.muted}>方块为数量示意（每层最多 30 个）；真实数量以层内数字为准。</text>
        <text x="20" y="320" fontSize="9" fill={c.muted}>
          计算量估算：召回 pool×1、粗排 ×8、精排 ×60、重排 ×3，1 单位 ≈ 0.015 ms。
        </text>
        <text x="20" y="336" fontSize="9" fill={c.muted}>
          总计算量 {r2(snap.totalUnits || 0)} 单位；调大池子或保留率会同步推高耗时。
        </text>

        {/* 右上：排序变化表 */}
        {rankCompare.length === 0 ? (
          <text x="380" y="52" fontSize="9" fill={c.muted}>（粗排候选过少，暂无排序对比）</text>
        ) : rankCompare.slice(0, revealRank).map((o, t) => {
          const y = 46 + t * 14;
          const cr = o.coarseRank;
          const up = cr !== null && cr > o.fineRank;
          const down = cr !== null && cr < o.fineRank;
          const delta = cr === null ? '↑新进' : (up ? '↑' + (cr - o.fineRank) : (down ? '↓' + (o.fineRank - cr) : '→'));
          return (
            <g key={'rk' + t}>
              <text x="380" y={y + 9} fontSize="9" fill={c.text}>精#{o.fineRank} I{o.id}</text>
              <text x="470" y={y + 9} fontSize="9" fill={c.muted}>粗#{cr === null ? '榜外' : cr}</text>
              <text x="530" y={y + 9} fontSize="9" fill={cr === null || up ? c.success : (down ? c.danger : c.muted)}>{delta}</text>
              <text x="580" y={y + 9} fontSize="9" fill={c.text}>p粗 {f2(o.coarseCtr)} → p精 {f2(o.fineCtr)}</text>
            </g>
          );
        })}

        {/* 右中：最终曝光列表 */}
        <text x="380" y="176" fontSize="10" fill={c.text}>最终曝光列表（{finalIds.length} 个）</text>
        {finalIds.length === 0 ? (
          <text x="380" y="194" fontSize="9" fill={c.muted}>（尚未产生曝光）</text>
        ) : finalIds.slice(0, revealExpose).map((id, t) => {
          const it = items[id] || {};
          const y = 190 + t * 12;
          return (
            <g key={'ex' + t}>
              <text x="380" y={y + 8} fontSize="9" fill={c.text}>{t + 1}. I{id}</text>
              <rect x="440" y={y} width="10" height="9" rx="2" fill={c.series[(it.cat || 0) % c.series.length]} />
              <text x="454" y={y + 8} fontSize="9" fill={c.muted}>C{it.cat ?? 0}</text>
              <rect x="490" y={y + 1} width="120" height="7" rx="2" fill={c.panel2} />
              <rect x="490" y={y + 1} width={clamp(it.fineCtr || 0, 0, 1) * 120} height="7" rx="2" fill={c.primary} opacity="0.85" />
              <text x="616" y={y + 8} fontSize="9" fill={c.text}>pCTR {f2(it.fineCtr)}</text>
            </g>
          );
        })}

        {/* 右下：各阶段耗时分布 */}
        <text x="380" y="318" fontSize="9" fill={c.muted}>各阶段计算量 / 耗时分布</text>
        {STAGES.map((s, i) => {
          const w = totalMs > 0 ? (s.ms / totalMs) * 290 : 0;
          let acc = 0;
          for (let j = 0; j < i; j++) acc += totalMs > 0 ? (STAGES[j].ms / totalMs) * 290 : 0;
          return (
            <g key={'ms' + i}>
              <rect x={380 + acc} y="326" width={Math.max(0, w)} height="10"
                fill={c.series[i % c.series.length]} opacity="0.85" />
              <text x={380 + acc} y="348" fontSize="9" fill={c.muted}>{s.name}</text>
            </g>
          );
        })}
        <text x="670" y="348" textAnchor="end" fontSize="9" fill={c.text}>合计 {f2(totalMs)} ms</text>

        <line x1="20" y1="356" x2={W - 20} y2="356" stroke={c.grid} strokeWidth="1" />
        <text x="20" y="372" fontSize="9" fill={c.muted}>
          精排模型噪声更小，pCTR 排序相对粗排发生升降；阈值过滤掉低 pCTR 物品，重排{dedupText(snap.dedup)}后产出曝光列表。
        </text>
      </svg>
    );
  },
};

function dedupText(dedup) { return dedup ? '按类目轮转去重' : '直接按 pCTR 截断'; }
