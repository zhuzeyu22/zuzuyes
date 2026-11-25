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

const STRATEGY_OPTIONS = [
  { value: 'chain', label: '链地址法' },
  { value: 'linear', label: '线性探测' },
  { value: 'quadratic', label: '二次探测' },
];
const STRATEGY_LABEL = { chain: '链地址法', linear: '线性探测', quadratic: '二次探测' };

export default {
  id: 'hash-table',
  params: [
    { key: 'buckets', label: '桶数量', type: 'range', min: 6, max: 14, step: 1, default: 8 },
    { key: 'insertCount', label: '插入元素数', type: 'range', min: 6, max: 18, step: 1, default: 10 },
    { key: 'strategy', label: '冲突策略', type: 'select', default: 'chain', options: STRATEGY_OPTIONS },
    { key: 'seed', label: '随机种子', type: 'range', min: 1, max: 30, step: 1, default: 7 },
    { key: 'detail', label: '逐步展示探测', type: 'toggle', default: true, hint: '关闭后每次插入只记录关键帧' },
  ],
  height: H,
  legend: [
    { color: L.primary, label: '已存键' },
    { color: L.warning, label: '当前探测路径' },
    { color: L.danger, label: '发生冲突' },
    { color: L.success, label: '成功放入' },
    { color: L.muted, label: '空桶' },
  ],
  hint: '按哈希值把键放进桶数组：链地址法挂链表，开放寻址按线性或二次步长探测，统计冲突与负载因子。',

  buildSteps(p) {
    const B = p.buckets, K = p.insertCount;
    const strategy = p.strategy || 'chain';
    const rnd = mulberry32(p.seed * 733 + 23);
    const keys = Array.from({ length: K }, () => 10 + Math.floor(rnd() * 90));
    const cells = Array.from({ length: B }, () => []);
    const steps = [];
    let collisions = 0, inserted = 0;
    const push = (note, extra = {}) => steps.push({
      buckets: B, strategy, cells: cells.map((x) => [...x]),
      collisions, inserted,
      currentKey: null, home: -1, probePath: [], placedAt: -1,
      done: false, note,
      metrics: { 冲突次数: collisions, 已插入: inserted, 负载因子: Number((inserted / B).toFixed(2)) },
      ...extra,
    });
    push(`初始化 ${B} 个空桶，准备插入 ${K} 个键，策略：${STRATEGY_LABEL[strategy]}。`);
    for (const key of keys) {
      const h = key % B;
      if (strategy === 'chain') {
        push(`插入键 ${key}，哈希值 ${key} mod ${B} = ${h}，检查桶 ${h} 的链表。`, {
          currentKey: key, home: h, probePath: [h], placedAt: -1,
        });
        for (const existing of cells[h]) {
          collisions++;
          if (p.detail) {
            push(`桶 ${h} 中已有键 ${existing}，链地址法沿链表继续查找。`, {
              currentKey: key, home: h, probePath: [h], placedAt: -1, conflict: true,
              collisions, inserted,
            });
          }
        }
        cells[h].push(key);
        inserted++;
        push(`键 ${key} 挂到桶 ${h} 链表末尾，链长变为 ${cells[h].length}。`, {
          currentKey: key, home: h, probePath: [h], placedAt: h, insertedNow: true,
        });
      } else {
        push(`插入键 ${key}，哈希起点 ${h}，按${strategy === 'quadratic' ? '二次' : '线性'}步长探测空位。`, {
          currentKey: key, home: h, probePath: [h], placedAt: -1,
        });
        const path = [];
        let placed = -1;
        for (let t = 0; t < B; t++) {
          const s = (h + (strategy === 'quadratic' ? t * t : t)) % B;
          path.push(s);
          if (cells[s].length === 0) { placed = s; break; }
          collisions++;
          if (p.detail) {
            push(`探测位置 ${s} 已被键 ${cells[s][0]} 占用，发生冲突，继续探测。`, {
              currentKey: key, home: h, probePath: [...path], placedAt: -1,
              conflict: true, collisions, inserted,
            });
          }
        }
        if (placed < 0) {
          push(`探测 ${B} 次后表已满，键 ${key} 无法插入。`, {
            currentKey: key, home: h, probePath: [...path], placedAt: -1, full: true,
          });
        } else {
          cells[placed].push(key);
          inserted++;
          push(`键 ${key} 放入空位置 ${placed}（哈希起点 ${h}）。`, {
            currentKey: key, home: h, probePath: [...path], placedAt: placed, insertedNow: true,
          });
        }
      }
    }
    push(`插入结束：${inserted} 个键成功，冲突 ${collisions} 次，负载因子 ${(inserted / B).toFixed(2)}。`, {
      done: true, currentKey: null, home: -1, probePath: [], placedAt: -1,
    });
    return finalize(steps);
  },

  render(snap, p, c) {
    const B = snap.buckets || p.buckets || 8;
    const cells = snap.cells || [];
    const strategy = snap.strategy || p.strategy || 'chain';
    const currentKey = snap.currentKey;
    const home = snap.home ?? -1;
    const probePath = snap.probePath || [];
    const placedAt = snap.placedAt ?? -1;
    const rowH = Math.min(26, (H - 76) / Math.max(1, B));
    const y0 = 40;
    const idxW = 58, nodeW = 42, nodeGap = 4;
    const rows = [];
    for (let i = 0; i < B; i++) {
      const y = y0 + i * rowH;
      const inPath = probePath.includes(i);
      const isHome = i === home;
      const list = cells[i] || [];
      const shown = list.slice(0, 12);
      const extra = list.length - shown.length;
      rows.push(
        <g key={`r${i}`}>
          <rect x="24" y={y} width={idxW} height={rowH - 2} rx="2" fill={c.panel}
            stroke={isHome ? c.primary : c.border} strokeWidth={isHome ? 1.8 : 1} />
          <text x={24 + idxW / 2} y={y + (rowH - 2) / 2 + 3} textAnchor="middle"
            fontSize="10" fill={isHome ? c.primary : c.muted}>桶 {i}</text>
          {inPath && (
            <rect x={24 + idxW + 4} y={y} width={W - 24 - (24 + idxW + 4)} height={rowH - 2} rx="2"
              fill={c.warning} fillOpacity={0.1} stroke="none" />
          )}
          {shown.map((key, k) => {
            const x = 24 + idxW + 8 + k * (nodeW + nodeGap);
            const isNew = placedAt === i && k === list.length - 1;
            let col = c.primary;
            if (isNew) col = c.success;
            return (
              <g key={`n${k}`}>
                <rect x={x} y={y} width={nodeW} height={rowH - 2} rx="2" fill={c.panel}
                  stroke={col} strokeWidth={isNew ? 1.8 : 1} />
                <text x={x + nodeW / 2} y={y + (rowH - 2) / 2 + 3} textAnchor="middle"
                  fontSize="9" fill={col}>{key}</text>
                {k < shown.length - 1 && (
                  <text x={x + nodeW + 1} y={y + (rowH - 2) / 2 + 3} fontSize="9" fill={c.muted}>→</text>
                )}
              </g>
            );
          })}
          {extra > 0 && (
            <text x={24 + idxW + 8 + 12 * (nodeW + nodeGap)} y={y + (rowH - 2) / 2 + 3}
              fontSize="9" fill={c.muted}>+{extra}</text>
          )}
        </g>
      );
    }
    return (
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} preserveAspectRatio="xMidYMid meet">
        <text x="24" y="18" fontSize="10" fill={c.muted}>
          {`哈希策略：${STRATEGY_LABEL[strategy]} · 桶数 ${B} · 当前键 ${currentKey ?? '—'} · 哈希起点 ${home >= 0 ? home : '—'}`}
        </text>
        {rows}
        <text x="24" y={H - 14} fontSize="11" fill={c.muted}>
          {snap.done
            ? '插入完成'
            : (snap.full
              ? '表已满，本次插入失败'
              : (placedAt >= 0
                ? `键 ${currentKey} 已放入桶 ${placedAt}`
                : `探测路径：${probePath.join(' → ')}`))}
        </text>
        <text x={W - 24} y={H - 14} fontSize="11" textAnchor="end" fill={c.muted}>
          {`冲突 ${snap.collisions ?? 0} 次 · 负载因子 ${snap.inserted != null ? (snap.inserted / B).toFixed(2) : '0.00'}`}
        </text>
      </svg>
    );
  },
};
