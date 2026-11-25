import React from 'react';
import { clamp } from '../utils.js';

const H = 360;
const DOCS = [
  { name: 'D1 算法可视化入门', len: 9, tf: { 算法: 2, 可视化: 2, 排序: 1, 检索: 0, 大模型: 0, 推荐: 0 } },
  { name: 'D2 大模型推荐系统', len: 7, tf: { 算法: 1, 可视化: 0, 排序: 1, 检索: 1, 大模型: 2, 推荐: 2 } },
  { name: 'D3 检索排序实践', len: 11, tf: { 算法: 1, 可视化: 1, 排序: 3, 检索: 2, 大模型: 0, 推荐: 0 } },
  { name: 'D4 交互可视化设计', len: 6, tf: { 算法: 0, 可视化: 3, 排序: 0, 检索: 0, 大模型: 0, 推荐: 0 } },
  { name: 'D5 大模型算法访谈', len: 8, tf: { 算法: 2, 可视化: 0, 排序: 0, 检索: 0, 大模型: 2, 推荐: 1 } },
];
const QUERIES = {
  'algo-vis': { label: '算法 可视化', terms: ['算法', '可视化'] },
  'llm-rec': { label: '大模型 推荐', terms: ['大模型', '推荐'] },
  'rank-ir': { label: '排序 检索', terms: ['排序', '检索'] },
};
const fmt = (v) => Number(v).toFixed(3);

export default {
  id: 'bm25',
  params: [
    { key: 'query', label: '查询', type: 'select', default: 'algo-vis', options: Object.entries(QUERIES).map(([value, q]) => ({ value, label: q.label })) },
    { key: 'k1', label: '词频饱和 k1', type: 'range', min: 0.2, max: 2.5, step: 0.1, default: 1.2, hint: '越大越奖励高频词' },
    { key: 'b', label: '长度归一 b', type: 'range', min: 0, max: 1, step: 0.05, default: 0.75, hint: '越大越惩罚长文档' },
  ],
  height: H,
  legend: [
    { label: '当前计算项' }, { label: '正贡献' }, { label: '文档长度惩罚' }, { label: '最终得分条' },
  ],
  hint: 'BM25 = Σ IDF(t) · TF 饱和项 ·长度归一项；k1 控制词频饱和，b 控制文档长度惩罚。',

  buildSteps(p) {
    const queryKey = QUERIES[p.query] ? p.query : 'algo-vis';
    const terms = QUERIES[queryKey].terms;
    const k1 = clamp(Number(p.k1) || 1.2, 0.2, 2.5);
    const b = clamp(Number(p.b) || 0.75, 0, 1);
    const N = DOCS.length;
    const avgdl = DOCS.reduce((s, d) => s + d.len, 0) / N;
    const df = Object.fromEntries(terms.map((t) => [t, DOCS.filter((d) => (d.tf[t] || 0) > 0).length]));
    const idf = Object.fromEntries(terms.map((t) => [t, Math.log(1 + (N - df[t] + 0.5) / (df[t] + 0.5))]));
    const scores = DOCS.map(() => 0);
    const contrib = DOCS.map(() => ({}));
    const common = {
      docs: DOCS, terms, df, idf, scores: scores.slice(), contrib: contrib.map((x) => ({ ...x })),
      queryLabel: QUERIES[queryKey].label, k1, b, avgdl, activeDoc: -1, activeTerm: '',
      metrics: { 查询: QUERIES[queryKey].label, k1, b, 平均分: fmt(avgdl) },
    };

    const steps = [{ ...common, phase: 'init',
      note: `语料 ${N} 篇文档，平均长度 ${fmt(avgdl)}。查询「${QUERIES[queryKey].label}」包含 ${terms.length} 个词。` }];
    steps.push({ ...common, phase: 'idf',
      note: `先算逆文档频率：IDF(t) = ln(1 + (N−df+0.5)/(df+0.5))。稀有词得分更高。` });

    terms.forEach((t) => {
      DOCS.forEach((d, i) => {
        const tf = d.tf[t] || 0;
        const tfPart = tf * (k1 + 1) / (tf + k1 * (1 - b + b * d.len / avgdl));
        const c = idf[t] * tfPart;
        scores[i] += c;
        contrib[i][t] = c;
        steps.push({
          ...common, phase: 'score', activeDoc: i, activeTerm: t,
          scores: scores.slice(), contrib: contrib.map((x) => ({ ...x })),
          note: `D${i + 1} · 词「${t}」tf=${tf}，长度 ${d.len}：IDF ${fmt(idf[t])} × 饱和项 ${fmt(tfPart)} = ${fmt(c)}。`,
          metrics: { 查询: QUERIES[queryKey].label, k1, b, 当前词: t, 当前得分: fmt(scores[i]) },
        });
      });
    });

    const ranked = DOCS.map((d, i) => ({ name: d.name, score: scores[i] })).sort((a, z) => z.score - a.score);
    steps.push({ ...common, phase: 'rank', activeDoc: -1, activeTerm: '',
      scores: scores.slice(), contrib: contrib.map((x) => ({ ...x })),
      note: `排序完成：${ranked[0].name} 得分最高（${fmt(ranked[0].score)}）。把 b 调到 1 再看短文档是否反超。`,
      metrics: { 查询: QUERIES[queryKey].label, k1, b, 最高分: fmt(ranked[0].score), 第一名: ranked[0].name.slice(0, 2) },
    });
    return steps;
  },

  render(snap, p, c) {
    const docs = snap.docs || DOCS;
    const terms = snap.terms || [];
    const idf = snap.idf || {};
    const df = snap.df || {};
    const scores = snap.scores || docs.map(() => 0);
    const contrib = snap.contrib || {};
    const activeDoc = snap.activeDoc ?? -1;
    const activeTerm = snap.activeTerm || '';
    const k1 = snap.k1 || 1.2;
    const b = snap.b || 0.75;
    const maxScore = Math.max(0.001, ...scores);
    const rowY = (i) => 76 + i * 48;

    return (
      <svg viewBox="0 0 720 360" width="100%" role="img" aria-label="BM25 相关性打分过程">
        <text x="32" y="28" fontSize="12" fill={c.muted}>文档打分 · 查询「{snap.queryLabel || '算法 可视化'}」</text>
        <text x="500" y="28" fontSize="12" fill={c.muted}>IDF 权重</text>
        <rect x="486" y="40" width="202" height="96" rx="10" fill={c.panel} stroke={c.border} />
        {terms.map((t, i) => (
          <g key={`idf-${t}`}>
            <text x="500" y={62 + i * 30} fontSize="11" fill={activeTerm === t ? c.warning : c.text}>{t}</text>
            <text x="560" y={62 + i * 30} fontSize="11" fill={c.muted}>df={df[t] || 0}</text>
            <text x="612" y={62 + i * 30} fontSize="11" fill={c.primary}>{fmt(idf[t] || 0)}</text>
          </g>
        ))}

        {docs.map((d, i) => {
          const y = rowY(i);
          const active = i === activeDoc;
          return (
            <g key={d.name}>
              <rect x="28" y={y - 26} width="446" height="42" rx="8" fill={active ? c.panel2 : c.panel}
                stroke={active ? c.warning : c.border} strokeWidth={active ? 2 : 1} />
              <text x="40" y={y - 7} fontSize="11" fill={c.text}>{d.name}</text>
              <text x="40" y={y + 9} fontSize="10" fill={c.muted}>len={d.len}</text>
              {terms.map((t, j) => {
                const val = (contrib[i] && contrib[i][t]) || 0;
                return (
                  <text key={`c-${i}-${t}`} x={164 + j * 84} y={y} fontSize="10"
                    fill={activeTerm === t && active ? c.warning : val > 0 ? c.success : c.muted}>
                    {t}:{fmt(val)}
                  </text>
                );
              })}
              <rect x="490" y={y - 12} width={Math.max(3, (scores[i] / maxScore) * 122)} height="12" rx="6"
                fill={c.series[0]} fillOpacity="0.75" />
              <text x="620" y={y - 2} fontSize="11" fill={c.text}>{fmt(scores[i] || 0)}</text>
            </g>
          );
        })}

        <rect x="28" y="316" width="660" height="32" rx="8" fill={c.panel2} />
        <text x="40" y="336" fontSize="11" fill={c.muted}>
          score(D,Q) = Σ IDF(t) · tf(k1+1)/(tf + k1(1−b+b·len/avgdl))　·　k1={fmt(k1)}　b={fmt(b)}　avgdl={fmt(snap.avgdl || 0)}
        </text>
      </svg>
    );
  },
};
