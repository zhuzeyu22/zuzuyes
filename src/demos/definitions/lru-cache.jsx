import React from 'react';
import { mulberry32, PALETTE } from '../utils.js';

const W = 720, H = 340, CAP = 560;
const L = PALETTE.light;

function finalize(steps, cap = CAP) {
  let out = steps;
  if (out.length > cap) {
    const stride = Math.ceil(out.length / cap);
    out = out.filter((_, i) => i % stride === 0 || i === steps.length - 1);
  }
  let guard = 0;
  while (out.length < 20 && guard++ < 40) {
    const first = out[0] || {};
    out.splice(1, 0, { ...first, note: `准备：${first.note || '即将开始'}` });
  }
  return out;
}

const KEYSPACE_OPTIONS = [
  { value: '4', label: '4 种键（高命中）' },
  { value: '6', label: '6 种键' },
  { value: '9', label: '9 种键（低命中）' },
];
const LETTERS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I'];

export default {
  id: 'lru-cache',
  params: [
    { key: 'capacity', label: '缓存容量', type: 'range', min: 3, max: 7, step: 1, default: 4 },
    { key: 'seqLen', label: '访问序列长度', type: 'range', min: 10, max: 24, step: 1, default: 16 },
    { key: 'keySpace', label: '键空间大小', type: 'select', default: '6', options: KEYSPACE_OPTIONS },
    { key: 'seed', label: '随机种子', type: 'range', min: 1, max: 30, step: 1, default: 7 },
    { key: 'verbose', label: '逐步展示命中判定', type: 'toggle', default: true, hint: '关闭后每次访问只记录结果帧' },
  ],
  height: H,
  legend: [
    { color: L.primary, label: '缓存链表节点' },
    { color: L.success, label: '命中并移到队首' },
    { color: L.danger, label: '被淘汰的最近最少使用' },
    { color: L.warning, label: '当前访问键 / 新插入' },
    { color: L.series[4], label: '哈希表映射' },
  ],
  hint: '双向链表维护「最近使用」顺序，命中移到队首、未命中且满容量时淘汰队尾。',

  buildSteps(p) {
    const cap = p.capacity, len = p.seqLen, ks = Number(p.keySpace) || 6;
    const rnd = mulberry32(p.seed * 211 + 37);
    const seq = Array.from({ length: len }, () => Math.floor(rnd() * ks));
    const list = [];
    const steps = [];
    let hits = 0, misses = 0, evictions = 0;
    const push = (note, extra = {}) => steps.push({
      capacity: cap, seq: [...seq], keySpace: ks,
      list: [...list], index: -1, current: -1, hit: false, evicted: -1,
      hits, misses, evictions, done: false, note,
      metrics: {
        访问次数: hits + misses, 命中次数: hits, 淘汰次数: evictions,
        命中率: Number((hits / Math.max(1, hits + misses)).toFixed(3)),
      },
      ...extra,
    });
    push(`生成长度 ${len} 的访问序列，缓存容量 ${cap}，键空间 ${ks} 种。`);
    for (let t = 0; t < len; t++) {
      const key = seq[t];
      const pos = list.indexOf(key);
      const hit = pos >= 0;
      push(`第 ${t + 1} 步访问键 ${LETTERS[key]}。`, {
        index: t, current: key, hit: false, evicted: -1,
      });
      if (p.verbose) {
        push(`查哈希表：${hit ? `命中，位于链表第 ${pos + 1} 位` : '未命中，需要加载'}。`, {
          index: t, current: key, hit, evicted: -1, probe: true,
        });
      }
      if (hit) {
        hits++;
        list.splice(pos, 1);
        list.unshift(key);
        push(`命中！把 ${LETTERS[key]} 移到链表队首（最近使用）。`, {
          index: t, current: key, hit: true, evicted: -1,
        });
      } else {
        misses++;
        let ev = -1;
        if (list.length >= cap) {
          ev = list[list.length - 1];
          list.pop();
          evictions++;
          push(`未命中且缓存已满，淘汰队尾 ${LETTERS[ev]}（最近最少使用）。`, {
            index: t, current: key, hit: false, evicted: ev,
          });
        }
        list.unshift(key);
        push(`把 ${LETTERS[key]} 插入链表队首。`, {
          index: t, current: key, hit: false, evicted: ev,
        });
      }
    }
    push(`访问结束：命中 ${hits} 次，淘汰 ${evictions} 次，命中率 ${(hits / Math.max(1, len)).toFixed(3)}。`, {
      done: true, index: len - 1, current: -1, hit: false, evicted: -1,
    });
    return finalize(steps);
  },

  render(snap, p, c) {
    const cap = snap.capacity ?? p.capacity ?? 4;
    const seq = snap.seq || [];
    const ks = snap.keySpace ?? Number(p.keySpace) ?? 6;
    const list = snap.list || [];
    const index = snap.index ?? -1;
    const current = snap.current ?? -1;
    const hit = !!snap.hit;
    const evicted = snap.evicted ?? -1;
    const done = !!snap.done;
    const hits = snap.hits ?? 0, misses = snap.misses ?? 0, evictions = snap.evictions ?? 0;
    const seqBoxW = Math.min(30, (W - 48) / Math.max(1, seq.length));
    const seqEls = seq.map((k, t) => {
      const x = 24 + t * seqBoxW;
      const isCur = t === index;
      const passed = t < index;
      return (
        <g key={`s${t}`}>
          <rect x={x} y="34" width={seqBoxW - 2} height="22" rx="2" fill={c.panel}
            stroke={isCur ? c.warning : c.border} strokeWidth={isCur ? 2 : 1} />
          <text x={x + (seqBoxW - 2) / 2} y="49" textAnchor="middle" fontSize="10"
            fill={isCur ? c.warning : (passed ? c.muted : c.text)}>{LETTERS[k] || k}</text>
        </g>
      );
    });
    const nodeW = 64, nodeH = 42, nodeGap = 26;
    const listX = 50, listY = 88;
    const arrows = [];
    for (let i = 0; i < list.length - 1; i++) {
      const x1 = listX + i * (nodeW + nodeGap) + nodeW;
      const x2 = listX + (i + 1) * (nodeW + nodeGap);
      arrows.push(
        <g key={`a${i}`}>
          <line x1={x1} y1={listY + 14} x2={x2} y2={listY + 14} stroke={c.border} strokeWidth="1" />
          <polygon points={`${x2},${listY + 14} ${x2 - 6},${listY + 10} ${x2 - 6},${listY + 18}`} fill={c.muted} />
          <line x1={x1} y1={listY + 28} x2={x2} y2={listY + 28} stroke={c.border} strokeWidth="1" />
          <polygon points={`${x1},${listY + 28} ${x1 + 6},${listY + 24} ${x1 + 6},${listY + 32}`} fill={c.muted} />
        </g>
      );
    }
    const listEls = list.map((k, i) => {
      const x = listX + i * (nodeW + nodeGap);
      const isHead = i === 0;
      const isHit = hit && k === current;
      const isNew = !hit && k === current && i === 0;
      let col = c.primary;
      if (isHit) col = c.success;
      if (isNew) col = c.warning;
      return (
        <g key={`l${i}`}>
          <rect x={x} y={listY} width={nodeW} height={nodeH} rx="4" fill={c.panel}
            stroke={col} strokeWidth={isHit || isNew ? 2.2 : 1.4} />
          <text x={x + nodeW / 2} y={listY + 26} textAnchor="middle" fontSize="13" fill={col}>
            {LETTERS[k] || k}
          </text>
          <text x={x + nodeW / 2} y={listY - 6} textAnchor="middle" fontSize="9" fill={c.muted}>
            {isHead ? '队首(MRU)' : (i === list.length - 1 ? '队尾(LRU)' : `第${i + 1}位`)}
          </text>
        </g>
      );
    });
    const mapY = 172;
    const mapBoxW = Math.min(64, (W - 48) / Math.max(1, ks));
    return (
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} preserveAspectRatio="xMidYMid meet">
        <text x="24" y="18" fontSize="11" fill={c.muted}>访问序列（高亮为当前访问）</text>
        {seqEls}
        <text x="24" y="72" fontSize="11" fill={c.muted}>双向链表（队首=最近使用，队尾=最久未用，上下箭头为 prev/next）</text>
        {arrows}
        {listEls}
        {evicted >= 0 && (
          <text x={W - 24} y={listY + 24} textAnchor="end" fontSize="11" fill={c.danger}>
            刚淘汰：{LETTERS[evicted] || evicted}
          </text>
        )}
        <text x="24" y={mapY - 10} fontSize="11" fill={c.muted}>哈希表（键 → 链表位置，— 表示不在缓存）</text>
        {Array.from({ length: ks }, (_, k) => {
          const x = 24 + k * mapBoxW;
          const pos = list.indexOf(k);
          const isCur = k === current;
          return (
            <g key={`m${k}`}>
              <rect x={x} y={mapY} width={mapBoxW - 3} height="30" rx="3" fill={c.panel}
                stroke={isCur ? c.warning : c.series[4]} strokeWidth={isCur ? 2 : 1} />
              <text x={x + (mapBoxW - 3) / 2} y={mapY + 13} textAnchor="middle" fontSize="10"
                fill={isCur ? c.warning : c.text}>{LETTERS[k] || k}</text>
              <text x={x + (mapBoxW - 3) / 2} y={mapY + 25} textAnchor="middle" fontSize="9"
                fill={c.muted}>{pos >= 0 ? `→${pos + 1}` : '—'}</text>
            </g>
          );
        })}
        <text x="24" y="240" fontSize="11" fill={c.muted}>运行统计</text>
        <text x="24" y="262" fontSize="12" fill={c.text}>
          {`访问 ${hits + misses} 次 · 命中 ${hits} 次 · 淘汰 ${evictions} 次 · 容量 ${cap}`}
        </text>
        <text x={W - 24} y="262" textAnchor="end" fontSize="12" fill={c.success}>
          命中率 {((hits / Math.max(1, hits + misses))).toFixed(3)}
        </text>
        <text x="24" y={H - 14} fontSize="11" fill={c.muted}>
          {done
            ? '访问序列处理完毕'
            : `第 ${index + 1} 步：访问 ${LETTERS[current] || '—'} · ${hit ? '命中' : '未命中'}`}
        </text>
        <text x={W - 24} y={H - 14} fontSize="11" textAnchor="end" fill={c.muted}>查询 O(1) · 链表 + 哈希表</text>
      </svg>
    );
  },
};
