import React from 'react';
import { mulberry32, clamp } from '../utils.js';

const W = 720;
const H = 340;
const TOKENS = ['我', '爱', '学', '算', '法', '模型', '数据', '语言'];

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
  id: 'beam-search',
  params: [
    { key: 'beamWidth', label: '束宽 beam width', type: 'range', min: 1, max: 4, step: 1, default: 3 },
    { key: 'maxLen', label: '最大长度', type: 'range', min: 2, max: 6, step: 1, default: 4 },
    { key: 'vocabSize', label: '词表大小', type: 'range', min: 3, max: 8, step: 1, default: 5 },
    { key: 'lenPenalty', label: '长度惩罚 α', type: 'range', min: 0, max: 1.5, step: 0.1, default: 0.6 },
  ],
  height: H,
  legend: [
    { label: '当前候选' }, { label: '保留分支' },
    { label: '被剪枝分支' }, { label: '当前 beam' },
  ],
  hint: '束搜索：每步扩展所有候选，按（长度惩罚后的）累积打分排序，只保留 top-K 条继续。',

  buildSteps(p) {
    const beamWidth = clamp(Math.round(Number(p.beamWidth) || 3), 1, 4);
    const maxLen = clamp(Math.round(Number(p.maxLen) || 4), 2, 6);
    const vocabSize = clamp(Math.round(Number(p.vocabSize) || 5), 3, 8);
    const lenPenalty = clamp(Number(p.lenPenalty) || 0, 0, 1.5);
    const pool = TOKENS.slice(0, vocabSize);

    const logp = (step, bIdx, tIdx, prev) => {
      const r = mulberry32(41001 + step * 911 + bIdx * 137 + tIdx * 17 + vocabSize * 7)();
      let lp = -0.35 - r * 2.0 - tIdx * 0.04;
      if (prev.length && prev[prev.length - 1] === pool[tIdx]) lp -= 0.6;
      return lp;
    };

    let beam = [{ tokens: [], logScore: 0 }];
    let bestFinal = { tokens: [], score: -Infinity, logScore: 0 };
    const steps = [];
    const base = {
      pool, beamWidth, maxLen, vocabSize, lenPenalty,
      phase: 'bos', step: 0, beam, newBeam: beam, expansions: [], displayOrder: [],
      visibleExp: 0, keptIdx: [], prunedIdx: [], bestFinal,
    };
    const push = (note, phase, extra = {}) => steps.push({
      ...base, note,
      metrics: {
        当前步: extra.step ?? base.step,
        束宽: beamWidth,
        候选数: (extra.expansions || []).length,
        剪枝数: (extra.expansions || []).length - beamWidth < 0 ? 0 : (extra.expansions || []).length - beamWidth,
        长度惩罚: lenPenalty,
        序列长度: maxLen,
      },
      ...extra,
    });

    push(`起点：<起>（空序列），每步从 ${vocabSize} 个词扩展，束宽 ${beamWidth}。`, 'bos');
    push(`打分规则：累积 logP 除以 len^α（α=${lenPenalty}），α 越大越不偏向短序列。`, 'intro');

    for (let step = 1; step <= maxLen; step++) {
      const expansions = [];
      beam.forEach((b, bIdx) => {
        pool.forEach((tk, tIdx) => {
          const lp = logp(step, bIdx, tIdx, b.tokens);
          const tokens = b.tokens.concat(tk);
          const logScore = b.logScore + lp;
          const len = tokens.length;
          const score = logScore / Math.pow(len, lenPenalty);
          expansions.push({ parentIdx: bIdx, token: tk, tokens, logScore, score, len });
        });
      });
      const order = expansions.map((_, i) => i).sort((a, b) => expansions[b].score - expansions[a].score);
      const keptIdx = order.slice(0, beamWidth);
      const prunedIdx = order.slice(beamWidth);
      expansions.forEach((e, i) => {
        e.rank = order.indexOf(i);
        e.kept = keptIdx.includes(i);
        e.pruned = prunedIdx.includes(i);
      });
      const newBeam = keptIdx.map((i) => ({ tokens: expansions[i].tokens, logScore: expansions[i].logScore }));
      const top = expansions[order[0]];
      if (top.score > bestFinal.score) bestFinal = { tokens: top.tokens, score: top.score, logScore: top.logScore };

      const ctx = {
        step, beam, newBeam, expansions, displayOrder: order,
        visibleExp: expansions.length, keptIdx, prunedIdx, bestFinal,
      };
      for (let k = 0; k < expansions.length; k++) {
        const e = expansions[k];
        push(`第 ${step} 步·扩展：由父 ${e.parentIdx + 1} 生成「${pool.indexOf(e.token) + 1}号词 ${e.token}」，累积 logP=${e.logScore.toFixed(2)}。`,
          'expand', { ...ctx, displayOrder: expansions.map((_, i) => i), visibleExp: k + 1 });
      }
      push(`第 ${step} 步·排序：按惩罚后 score 降序排列 ${expansions.length} 条候选。`, 'sort', ctx);
      push(`第 ${step} 步·长度惩罚：score = logP / len^${lenPenalty}，当前最优 score=${top.score.toFixed(2)}。`,
        'penalty', ctx);
      push(`第 ${step} 步·剪枝：保留前 ${keptIdx.length} 条，剪掉 ${prunedIdx.length} 条低分分支。`,
        'prune', ctx);
      push(`第 ${step} 步·更新 beam：${newBeam.length} 条序列成为下一步的父节点。`,
        'beam', ctx);
      beam = newBeam;
      base.beam = beam;
      base.newBeam = newBeam;
      base.step = step;
    }

    push(`结束：达到最大长度 ${maxLen}，全局最优序列分数 ${bestFinal.score.toFixed(2)}。`, 'summary',
      { step: maxLen, visibleExp: 0, bestFinal });
    push(`最终结果：「${bestFinal.tokens.join('')}」，累积 logP=${bestFinal.logScore.toFixed(2)}，惩罚后 ${bestFinal.score.toFixed(2)}。`,
      'done', { step: maxLen, visibleExp: 0, bestFinal });
    return finalize(steps);
  },

  render(snap, p, c) {
    const pool = snap.pool || [];
    const expansions = snap.expansions || [];
    const displayOrder = snap.displayOrder || [];
    const visibleExp = snap.visibleExp ?? 0;
    const phase = snap.phase || 'bos';
    const beamWidth = snap.beamWidth || 1;
    const maxLen = snap.maxLen || 2;
    const lenPenalty = snap.lenPenalty || 0;
    const beam = snap.beam || [];
    const newBeam = snap.newBeam || beam;
    const bestFinal = snap.bestFinal || { tokens: [], score: 0, logScore: 0 };

    const head = `束搜索 · beam=${beamWidth} · 最大长度=${maxLen} · 词表=${pool.length} · 长度惩罚 α=${lenPenalty} · 第 ${snap.step || 0}/${maxLen} 步`;

    const maxRows = 18;
    const table = [];
    table.push(<text key="th" x={20} y={46} fontSize="10" fill={c.muted}>
      序列 / 累积 logP / 惩罚后 score / 状态
    </text>);
    const shown = displayOrder.slice(0, Math.min(maxRows, visibleExp));
    shown.forEach((idx, r) => {
      const e = expansions[idx];
      if (!e) return;
      const y = 58 + r * 14;
      let state = '候选', stateColor = c.muted, dim = false;
      if (phase === 'sort') { state = `#${e.rank + 1}`; stateColor = c.text; }
      if (phase === 'penalty') { state = `÷${e.len}^α`; stateColor = c.text; }
      if (phase === 'prune' || phase === 'beam') {
        if (e.kept) { state = '保留'; stateColor = c.success; }
        else { state = '剪枝'; stateColor = c.muted; dim = true; }
      }
      const txt = '<起>' + e.tokens.join('');
      table.push(<g key={`r${r}`}>
        {e.kept && (phase === 'prune' || phase === 'beam') && <rect x={18} y={y - 10} width={462} height={13} rx={2}
          fill={c.success} opacity={0.08} />}
        <text x={22} y={y} fontSize="9" fill={dim ? c.muted : c.text} opacity={dim ? 0.55 : 1}>
          {txt.length > 20 ? txt.slice(0, 19) + '…' : txt}
        </text>
        <text x={232} y={y} fontSize="9" fill={dim ? c.muted : c.text} opacity={dim ? 0.55 : 1}>
          {e.logScore.toFixed(2)}
        </text>
        <text x={322} y={y} fontSize="9" fill={dim ? c.muted : c.text} opacity={dim ? 0.55 : 1}>
          {e.score.toFixed(2)}
        </text>
        <text x={402} y={y} fontSize="9" fill={stateColor}>{state}</text>
      </g>);
    });
    if (displayOrder.length > maxRows && visibleExp > maxRows) {
      table.push(<text key="more" x={22} y={58 + maxRows * 14} fontSize="9" fill={c.muted}>
        … 其余 {displayOrder.length - maxRows} 条候选省略（已被剪枝）
      </text>);
    }
    if (!shown.length && (phase === 'bos' || phase === 'intro' || phase === 'summary' || phase === 'done')) {
      table.push(<text key="idle" x={22} y={70} fontSize="10" fill={c.muted}>
        {phase === 'done' ? '搜索结束，见右侧最优序列' : '拖动进度条开始逐步扩展候选 →'}
      </text>);
    }

    const rx = 496;
    const panel = [];
    const shownBeam = (phase === 'expand' || phase === 'bos' || phase === 'intro') ? beam : newBeam;
    panel.push(<text key="bh" x={rx} y={46} fontSize="10" fill={c.text}>
      {phase === 'expand' ? '父节点 beam' : '当前 beam（top-K）'}
    </text>);
    shownBeam.slice(0, 4).forEach((b, i) => {
      panel.push(<text key={`b${i}`} x={rx} y={62 + i * 18} fontSize="9" fill={c.muted}>
        {`${i + 1}. <起>${(b.tokens || []).join('')}  logP=${(b.logScore || 0).toFixed(2)}`}
      </text>);
    });
    panel.push(<line key="sep" x1={rx} y1={148} x2={700} y2={148} stroke={c.grid} strokeWidth="1" />);
    panel.push(<text key="best" x={rx} y={166} fontSize="10" fill={c.text}>当前全局最优</text>);
    panel.push(<text key="bs" x={rx} y={184} fontSize="10" fill={c.success}>
      {'<起>' + (bestFinal.tokens || []).join('')}
    </text>);
    panel.push(<text key="bsc" x={rx} y={200} fontSize="9" fill={c.muted}>
      {`score=${(bestFinal.score === -Infinity ? 0 : bestFinal.score).toFixed(2)}`}
    </text>);
    const infoLines = [
      '每步：扩展 beam × 词表 条候选',
      'score = 累积logP / len^α',
      'α 大 → 长序列不被过度惩罚',
      '剪枝：只留 top-K，其余丢弃',
      '时间复杂度 O(maxLen·K·V)',
    ];
    infoLines.forEach((t, i) => panel.push(<text key={`i${i}`} x={rx} y={224 + i * 16}
      fontSize="9" fill={c.muted}>{t}</text>));

    return (
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} preserveAspectRatio="xMidYMid meet">
        <text x={20} y={22} fontSize="11" fill={c.text}>{head}</text>
        {table}
        <line x1="484" y1="36" x2="484" y2={H - 12} stroke={c.grid} strokeWidth="1" />
        {panel}
        <text x={20} y={330} fontSize="10" fill={c.muted}>
          {phase === 'prune' ? '置灰的分支被永久剪掉，不再参与后续扩展'
            : phase === 'expand' ? '候选表格随扩展逐个生成'
              : '累积打分随序列增长而下降，长度惩罚用于公平比较不同长度'}
        </text>
      </svg>
    );
  },
};
