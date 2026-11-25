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

export default {
  id: 'knapsack',
  params: [
    { key: 'capacity', label: '背包容量', type: 'range', min: 6, max: 16, step: 1, default: 10 },
    { key: 'itemCount', label: '物品数量', type: 'range', min: 4, max: 10, step: 1, default: 6 },
    { key: 'seed', label: '随机种子', type: 'range', min: 1, max: 30, step: 1, default: 7 },
    { key: 'detail', label: '逐格显示候选比较', type: 'toggle', default: true, hint: '关闭后每格只记录写入结果' },
  ],
  height: H,
  legend: [
    { color: L.panel, label: '尚未计算' },
    { color: L.primary, label: '已计算（颜色越深值越大）' },
    { color: L.warning, label: '当前单元格' },
    { color: L.success, label: '选中的物品' },
    { color: L.danger, label: '回溯所在单元格' },
  ],
  hint: '逐格填 01 背包 DP 表，再从右下角回溯出被选中的物品集合。',

  buildSteps(p) {
    const C = p.capacity, m = p.itemCount;
    const rnd = mulberry32(p.seed * 419 + 17);
    const items = Array.from({ length: m }, () => ({
      w: 1 + Math.floor(rnd() * Math.max(1, C - 1)),
      v: 1 + Math.floor(rnd() * 20),
    }));
    const full = Array.from({ length: m + 1 }, () => Array(C + 1).fill(0));
    for (let i = 1; i <= m; i++) {
      for (let w = 0; w <= C; w++) {
        const it = items[i - 1];
        full[i][w] = w < it.w
          ? full[i - 1][w]
          : Math.max(full[i - 1][w], full[i - 1][w - it.w] + it.v);
      }
    }
    const maxVal = full[m][C] || 1;
    const dp = Array.from({ length: m + 1 }, () => Array(C + 1).fill(null));
    for (let w = 0; w <= C; w++) dp[0][w] = 0;
    const steps = [];
    let filled = 0, curW = 0, curVal = 0, chosenCount = 0;
    const push = (note, extra = {}) => steps.push({
      capacity: C, itemCount: m, items: items.map((it) => ({ ...it })),
      dp: dp.map((r) => [...r]), maxVal,
      cur: null, chosen: [], traceW: -1, phase: 'fill', done: false, note,
      metrics: {
        已填单元格: filled, 当前容量: curW, 当前价值: curVal,
        最大价值: maxVal, 已选物品: chosenCount,
      },
      ...extra,
    });
    push(`生成 ${m} 个物品、背包容量 ${C}，DP 表共 ${m + 1} 行 × ${C + 1} 列。`);
    for (let i = 1; i <= m; i++) {
      const it = items[i - 1];
      push(`处理第 ${i} 个物品：重量 ${it.w}，价值 ${it.v}。`, { cur: { i, w: 0 } });
      for (let w = 0; w <= C; w++) {
        curW = w;
        const noTake = dp[i - 1][w];
        const take = w >= it.w ? dp[i - 1][w - it.w] + it.v : -1;
        if (p.detail) {
          push(`单元格 [${i}, ${w}]：不选=${noTake}${take >= 0 ? `，选=${take}` : '，容量不足不能选'}，取较大者。`, {
            cur: { i, w }, candNo: noTake, candTake: take,
          });
        }
        const val = w < it.w ? noTake : Math.max(noTake, take);
        dp[i][w] = val;
        filled++;
        curVal = val;
        push(`写入 dp[${i}][${w}] = ${val}。`, { cur: { i, w }, candNo: noTake, candTake: take });
      }
    }
    let wRemain = C;
    const chosen = [];
    push(`填表完成，最大价值 ${dp[m][C]}。从 dp[${m}][${C}] 开始回溯。`, {
      cur: null, chosen: [...chosen], traceW: wRemain, phase: 'trace',
    });
    for (let i = m; i >= 1; i--) {
      if (dp[i][wRemain] !== dp[i - 1][wRemain]) {
        chosen.push(i - 1);
        wRemain -= items[i - 1].w;
        chosenCount = chosen.length;
        push(`第 ${i} 个物品被选中（重 ${items[i - 1].w}，值 ${items[i - 1].v}），剩余容量 ${Math.max(0, wRemain)}。`, {
          cur: { i, w: wRemain }, chosen: [...chosen], traceW: Math.max(0, wRemain), phase: 'trace',
        });
      } else {
        chosenCount = chosen.length;
        push(`第 ${i} 个物品未选中，向上回退一行。`, {
          cur: { i, w: wRemain }, chosen: [...chosen], traceW: wRemain, phase: 'trace',
        });
      }
    }
    push(`回溯完成：共选 ${chosen.length} 件物品，最大价值 ${dp[m][C]}。`, {
      done: true, cur: null, chosen: [...chosen], traceW: wRemain, phase: 'done',
    });
    return finalize(steps);
  },

  render(snap, p, c) {
    const C = snap.capacity ?? p.capacity ?? 8;
    const m = snap.itemCount ?? p.itemCount ?? 4;
    const items = snap.items || [];
    const dp = snap.dp || [];
    const maxVal = snap.maxVal || 1;
    const cur = snap.cur || null;
    const chosen = snap.chosen || [];
    const phase = snap.phase || 'fill';
    const cols = C + 1, rows = m + 1;
    const tableX = 44, tableY = 52;
    const cellW = Math.min(38, 446 / Math.max(1, cols));
    const cellH = Math.min(24, 230 / Math.max(1, rows));
    const cells = [];
    for (let i = 0; i < rows; i++) {
      for (let w = 0; w < cols; w++) {
        const val = dp[i] ? dp[i][w] : undefined;
        const computed = val !== null && val !== undefined;
        const isCur = cur && cur.i === i && cur.w === w;
        const x = tableX + w * cellW, y = tableY + i * cellH;
        const stroke = isCur ? (phase === 'fill' ? c.warning : c.danger) : (computed ? c.primary : c.border);
        cells.push(
          <g key={`${i}-${w}`}>
            <rect x={x} y={y} width={cellW - 1.5} height={cellH - 1.5} rx="2"
              fill={computed ? c.primary : c.panel}
              fillOpacity={computed ? 0.15 + 0.8 * (maxVal > 0 ? (val || 0) / maxVal : 0) : 1}
              stroke={stroke} strokeWidth={isCur ? 2.2 : 1} />
            {computed && (
              <text x={x + (cellW - 1.5) / 2} y={y + (cellH - 1.5) / 2 + 3}
                textAnchor="middle" fontSize="9" fill={c.text}>{val}</text>
            )}
          </g>
        );
      }
    }
    const colHeads = Array.from({ length: cols }, (_, w) => (
      <text key={`c${w}`} x={tableX + w * cellW + (cellW - 1.5) / 2} y={tableY - 6}
        textAnchor="middle" fontSize="9" fill={c.muted}>{w}</text>
    ));
    const rowHeads = Array.from({ length: rows }, (_, i) => (
      <text key={`r${i}`} x={tableX - 8} y={tableY + i * cellH + (cellH - 1.5) / 2 + 3}
        textAnchor="end" fontSize="9" fill={c.muted}>{i}</text>
    ));
    return (
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} preserveAspectRatio="xMidYMid meet">
        <text x="24" y="18" fontSize="10" fill={c.muted}>DP 表（行=前 i 件物品，列=容量 w）</text>
        <text x="24" y="34" fontSize="9" fill={c.muted}>i ↓　w →</text>
        {colHeads}
        {rowHeads}
        {cells}
        <text x="500" y="30" fontSize="11" fill={c.muted}>物品列表（重量 / 价值）</text>
        {items.map((it, k) => {
          const y = 44 + k * 24;
          const sel = chosen.includes(k);
          return (
            <g key={`it${k}`}>
              <rect x="500" y={y} width="196" height="20" rx="3" fill={c.panel}
                stroke={sel ? c.success : c.border} strokeWidth={sel ? 1.8 : 1} />
              <text x="508" y={y + 14} fontSize="10" fill={sel ? c.success : c.text}>物品 {k + 1}</text>
              <text x="690" y={y + 14} textAnchor="end" fontSize="10" fill={sel ? c.success : c.muted}>
                重 {it.w} / 值 {it.v}
              </text>
            </g>
          );
        })}
        <text x="500" y={H - 40} fontSize="12" fill={c.text}>最大价值：{maxVal}</text>
        <text x="500" y={H - 22} fontSize="10" fill={c.muted}>
          {phase === 'fill' ? '逐格填表中' : `已选 ${chosen.length} 件物品`}
        </text>
        <text x="24" y={H - 14} fontSize="11" fill={c.muted}>
          {snap.done
            ? `回溯完成：选中 ${chosen.length} 件物品`
            : (phase === 'fill'
              ? `填表：单元格 [${cur ? cur.i : 0}, ${cur ? cur.w : 0}]`
              : `回溯：剩余容量 ${snap.traceW ?? C}`)}
        </text>
        <text x={W - 24} y={H - 14} fontSize="11" textAnchor="end" fill={c.muted}>时间 O(m·C) · 空间 O(m·C)</text>
      </svg>
    );
  },
};
