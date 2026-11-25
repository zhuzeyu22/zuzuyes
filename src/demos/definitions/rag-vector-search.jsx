import React from 'react';
import { mulberry32, clamp } from '../utils.js';

const W = 720, H = 340;

function makeDocs(n, seed, qAngle, metric) {
  const rnd = mulberry32(seed * 89 + n);
  const q = { x: Math.cos(qAngle), y: Math.sin(qAngle) };
  const docs = Array.from({ length: n }, (_, i) => {
    const ang = (i / n) * Math.PI * 2 + (rnd() - 0.5) * 0.5;
    const len = 0.45 + rnd() * 0.5;
    const x = Math.cos(ang) * len, y = Math.sin(ang) * len;
    const dot = q.x * x + q.y * y;
    const norm = Math.max(1e-6, Math.sqrt(x * x + y * y));
    const cos = dot / norm;
    const l2 = Math.sqrt((q.x - x) ** 2 + (q.y - y) ** 2);
    const score = metric === 'dot' ? dot : metric === 'l2' ? 1 / (1 + l2) : cos;
    return { id: i, x, y, score, relevant: cos > 0.55 };
  });
  return { q, docs };
}

export default {
  id: 'rag-vector-search',
  params: [
    { key: 'topK', label: '检索 top-k', type: 'range', min: 1, max: 6, step: 1, default: 3 },
    { key: 'docCount', label: '文档片段数', type: 'range', min: 8, max: 20, step: 2, default: 12 },
    { key: 'metric', label: '相似度度量', type: 'select', default: 'cosine',
      options: [{ value: 'cosine', label: '余弦相似度' }, { value: 'dot', label: '点积' }, { value: 'l2', label: 'L2 距离倒数' }] },
    { key: 'angle', label: '查询向量角度', type: 'range', min: 0, max: 350, step: 10, default: 30, unit: '°' },
    { key: 'rerank', label: '启用精排重排', type: 'toggle', default: false, hint: '模拟交叉编码器把相关片段提前' },
  ],
  height: H,
  legend: [
    { color: '#226AFF', label: '文档向量 / 已计算相似度' },
    { color: '#12a06a', label: 'top-k 命中片段' },
    { color: '#e5484d', label: '查询向量' },
  ],
  hint: '先把查询与文档编码到同一向量空间，取相似度最高的 k 段拼进上下文，再让模型基于上下文生成。',

  buildSteps(p) {
    const qAngle = (p.angle * Math.PI) / 180;
    const { q, docs } = makeDocs(p.docCount, 7, qAngle, p.metric);
    const scored = p.rerank
      ? [...docs].sort((a, b) => (b.score + (b.relevant ? 0.25 : 0)) - (a.score + (a.relevant ? 0.25 : 0)))
      : [...docs].sort((a, b) => b.score - a.score);
    const steps = [];
    const push = (phase, note, extra = {}) => steps.push({
      phase, q, docs: docs.map((d) => ({ ...d })), ranked: scored.map((d) => d.id),
      note, metrics: { 已打分: extra.scoredCount ?? 0, 已选片段: (extra.selected || []).length, 命中相关: (extra.selected || []).filter((id) => docs[id].relevant).length },
      ...extra,
    });

    push('encode', `把查询编码成向量 q（角度 ${p.angle}°），文档库共 ${p.docCount} 个片段。度量：${p.metric}。`, { scoredCount: 0, selected: [] });
    docs.forEach((d, i) => {
      push('score', `计算片段 ${d.id} 与查询的相似度：${d.score.toFixed(3)}${d.relevant ? '（相关内容）' : ''}。已打分 ${i + 1}/${docs.length}。`,
        { scoredCount: i + 1, curDoc: d.id, selected: [] });
    });
    push('rank', `按相似度降序排序${p.rerank ? '（启用精排：相关片段额外加权）' : ''}，前几名：${scored.slice(0, 6).map((d) => `${d.id}(${d.score.toFixed(2)})`).join('、')}。`,
      { scoredCount: docs.length, selected: [] });
    const selected = [];
    for (let k = 0; k < Math.min(p.topK, scored.length); k++) {
      selected.push(scored[k].id);
      push('select', `选中第 ${k + 1} 个片段：#${scored[k].id}，相似度 ${scored[k].score.toFixed(3)}${scored[k].relevant ? '，命中相关内容' : '，与查询相关性较低'}。`,
        { scoredCount: docs.length, selected: [...selected], curDoc: scored[k].id });
    }
    const hits = selected.filter((id) => docs[id].relevant).length;
    push('generate', `把 ${selected.length} 个片段按序拼进 prompt，送入大模型生成。命中相关片段 ${hits}/${selected.length}；top-k 过小易漏信息，过大则引入噪声并挤占上下文。`,
      { scoredCount: docs.length, selected, done: true });
    return steps;
  },

  render(s, p, c) {
    const docs = s.docs || [], q = s.q || { x: 1, y: 0 };
    const selected = new Set(s.selected || []);
    const cx = 170, cy = 175, R = 122;
    const px = (x) => cx + x * R, py = (y) => cy - y * R;
    const scoredCount = s.scoredCount ?? 0;
    return (
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} preserveAspectRatio="xMidYMid meet">
        <text x="22" y="16" fontSize="11" fill={c.muted}>二维向量空间示意（真实场景为高维 embedding）</text>
        <circle cx={cx} cy={cy} r={R} fill={c.panel} stroke={c.border} />
        <line x1={cx - R} y1={cy} x2={cx + R} y2={cy} stroke={c.grid} />
        <line x1={cx} y1={cy - R} x2={cx} y2={cy + R} stroke={c.grid} />
        <line x1={cx} y1={cy} x2={px(q.x)} y2={py(q.y)} stroke={c.danger} strokeWidth="3" />
        <circle cx={px(q.x)} cy={py(q.y)} r="6" fill={c.danger} />
        <text x={px(q.x) + 9} y={py(q.y) - 6} fontSize="10" fill={c.danger}>query</text>
        {docs.map((d, i) => {
          const on = selected.has(d.id);
          const computed = i < scoredCount;
          return (
            <g key={d.id}>
              <circle cx={px(d.x)} cy={py(d.y)} r={on ? 8 : 5}
                fill={on ? c.success : (computed ? c.primary : c.border)}
                opacity={on ? 1 : (computed ? 0.8 : 0.5)}
                stroke={s.curDoc === d.id ? c.warning : 'none'} strokeWidth="3" />
              {on && <text x={px(d.x) + 10} y={py(d.y) + 3} fontSize="10" fill={c.success}>#{d.id}</text>}
            </g>
          );
        })}

        <text x="350" y="16" fontSize="11" fill={c.muted}>检索链路</text>
        {['编码 Encode', '相似度打分', '排序 / 精排', `取 Top-${p.topK}`, '拼接上下文 → 生成'].map((st, i) => {
          const order = ['encode', 'score', 'rank', 'select', 'generate'];
          const active = order.indexOf(s.phase) === i;
          return (
            <g key={st}>
              <rect x={350 + (i % 2) * 178} y={26 + Math.floor(i / 2) * 38} width="168" height="30" rx="6"
                fill={active ? c.primary : c.panel} opacity={active ? 0.85 : 1} stroke={c.border} />
              <text x={359 + (i % 2) * 178} y={46 + Math.floor(i / 2) * 38} fontSize="10.5" fill={active ? '#ffffff' : c.text}>{st}</text>
            </g>
          );
        })}

        <text x="350" y="150" fontSize="11" fill={c.muted}>排序后的候选（绿色 = 已选入上下文）</text>
        {(s.ranked || []).slice(0, 6).map((id, i) => {
          const d = docs[id];
          if (!d) return null;
          const on = selected.has(id);
          return (
            <g key={id}>
              <rect x="350" y={160 + i * 25} width="348" height="22" rx="4"
                fill={on ? c.success : c.panel} opacity={on ? 0.2 : 1} stroke={on ? c.success : c.border} />
              <text x="358" y={176 + i * 25} fontSize="10.5" fill={c.text}>#{id}　{d.relevant ? '相关' : '一般'}</text>
              <text x="620" y={176 + i * 25} fontSize="10.5" fill={c.muted}>{d.score.toFixed(3)}</text>
              {on && <text x="680" y={176 + i * 25} fontSize="10" fill={c.success}>✓</text>}
            </g>
          );
        })}
        <text x="350" y="322" fontSize="10" fill={c.muted}>当前阶段：{s.phase} · 已打分 {scoredCount}/{docs.length}</text>
        <text x="22" y="326" fontSize="10.5" fill={c.text}>{s.note}</text>
      </svg>
    );
  },
};
