import React from 'react';
import { makeArray, DIST_OPTIONS, PALETTE } from '../utils.js';

const W = 720, H = 320, CAP = 560;
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
  id: 'merge-sort',
  params: [
    { key: 'n', label: '元素个数', type: 'range', min: 8, max: 32, step: 1, default: 16 },
    { key: 'dist', label: '初始分布', type: 'select', default: 'random', options: DIST_OPTIONS },
    { key: 'seed', label: '随机种子', type: 'range', min: 1, max: 30, step: 1, default: 7 },
    { key: 'detail', label: '逐元素比较明细', type: 'toggle', default: true, hint: '关闭后每段只记录关键帧' },
  ],
  height: H,
  legend: [
    { color: L.primary, label: '待合并数组' },
    { color: L.warning, label: '左有序段' },
    { color: L.series[4], label: '右有序段' },
    { color: L.success, label: '已写回' },
    { color: L.danger, label: '写回位置' },
  ],
  hint: '自底向上按层把相邻有序段两两归并，写回原数组，段长逐层翻倍直至整体有序。',

  buildSteps(p) {
    const a = makeArray(p.n, p.dist, p.seed);
    const n = a.length;
    const steps = [];
    let comparisons = 0, writes = 0;
    const push = (note, extra = {}) => {
      const lv = extra.level ?? 0;
      const wd = extra.width ?? 1;
      steps.push({
        arr: [...a], n, level: lv, width: wd,
        lo: -1, mid: -1, hi: -1, i: -1, j: -1, k: -1, writeAt: -1,
        done: false, note,
        metrics: { 比较次数: comparisons, 写回次数: writes, 当前层: lv + 1, 段长: wd },
        ...extra,
      });
    };
    push(`初始数组共 ${n} 个元素，先视为 ${n} 个长度为 1 的有序段。`);
    let width = 1, level = 0;
    while (width < n) {
      push(`第 ${level + 1} 层：开始合并长度为 ${width} 的相邻有序段。`, { level, width });
      for (let lo = 0; lo < n; lo += 2 * width) {
        const mid = Math.min(lo + width, n);
        const hi = Math.min(lo + 2 * width, n);
        if (mid >= hi) {
          push(`区间 [${lo}, ${hi - 1}] 没有右段，保持原样。`, { level, width, lo, mid, hi });
          continue;
        }
        const left = a.slice(lo, mid);
        const right = a.slice(mid, hi);
        let i = 0, j = 0, k = lo;
        push(`合并左段 [${lo}, ${mid - 1}] 与右段 [${mid}, ${hi - 1}]，从位置 ${lo} 开始写回。`, {
          level, width, lo, mid, hi, i, j, k, writeAt: -1,
        });
        while (i < left.length && j < right.length) {
          comparisons++;
          if (p.detail) {
            push(`比较左段 ${left[i]} 与右段 ${right[j]}，较小的写回位置 ${k}。`, {
              level, width, lo, mid, hi, i, j, k, writeAt: k,
            });
          }
          const takeLeft = left[i] <= right[j];
          const val = takeLeft ? left[i] : right[j];
          if (takeLeft) i++; else j++;
          a[k] = val;
          writes++;
          push(`写回位置 ${k}：值 ${val}（来自${takeLeft ? '左段' : '右段'}）。`, {
            level, width, lo, mid, hi, i, j, k, writeAt: k,
          });
          k++;
        }
        while (i < left.length) {
          const val = left[i];
          a[k] = val; writes++; i++;
          push(`左段剩余 ${val} 直接写回位置 ${k}。`, {
            level, width, lo, mid, hi, i, j, k, writeAt: k,
          });
          k++;
        }
        while (j < right.length) {
          const val = right[j];
          a[k] = val; writes++; j++;
          push(`右段剩余 ${val} 直接写回位置 ${k}。`, {
            level, width, lo, mid, hi, i, j, k, writeAt: k,
          });
          k++;
        }
        push(`区间 [${lo}, ${hi - 1}] 已合并成一个有序段。`, {
          level, width, lo, mid, hi, i, j, k, writeAt: -1,
        });
      }
      width *= 2;
      level++;
    }
    push('归并排序完成，整个数组有序。', {
      done: true, level, width, lo: -1, mid: -1, hi: -1, i: -1, j: -1, k: -1, writeAt: -1,
    });
    return finalize(steps);
  },

  render(snap, p, c) {
    const arr = snap.arr || [];
    const n = snap.n || arr.length || 1;
    const top = 112, bottom = 262;
    const gap = 2, bw = (W - 48) / Math.max(1, n) - gap;
    const max = Math.max(100, ...arr);
    const xb = (idx) => 24 + idx * (bw + gap);
    const levels = Math.max(1, Math.ceil(Math.log2(Math.max(2, n))));
    const lv = snap.level ?? 0;
    const lo = snap.lo ?? -1, mid = snap.mid ?? -1, hi = snap.hi ?? -1;
    const k = snap.k ?? -1, writeAt = snap.writeAt ?? -1;
    const bands = [];
    for (let l = 0; l < levels; l++) {
      const step = Math.pow(2, l);
      for (let s = 0; s < n; s += step) {
        const e = Math.min(s + step, n) - 1;
        let fill = c.panel, stroke = c.border, op = 0.7;
        if (l === lv && !snap.done) {
          op = 1; stroke = c.primary;
          if (s === lo) fill = c.warning;
          else if (s === mid) fill = c.series[4];
        }
        bands.push(
          <rect key={`${l}-${s}`} x={xb(s)} y={30 + l * 14}
            width={Math.max(1, (e - s + 1) * (bw + gap) - gap)} height="10" rx="2"
            fill={fill} stroke={stroke} strokeWidth="1" opacity={op} />
        );
      }
    }
    const bars = arr.map((v, idx) => {
      const h = (v / max) * (bottom - top);
      const x = xb(idx);
      let fill = c.primary;
      if (snap.done) fill = c.success;
      else if (idx >= lo && idx < hi) {
        if (k >= 0 && idx < k) fill = c.success;
        else if (idx < mid) fill = c.warning;
        else fill = c.series[4];
      }
      if (idx === writeAt && !snap.done) fill = c.danger;
      return (
        <g key={idx}>
          <rect x={x} y={bottom - h} width={Math.max(1, bw)} height={h}
            rx={Math.min(3, bw / 3)} fill={fill} opacity={0.92} />
          {n <= 26 && (
            <text x={x + bw / 2} y={bottom - h - 5} textAnchor="middle" fontSize="9" fill={c.muted}>{v}</text>
          )}
        </g>
      );
    });
    return (
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} preserveAspectRatio="xMidYMid meet">
        <text x="24" y="18" fontSize="10" fill={c.muted}>分治层级（每段长度逐层翻倍，高亮为当前合并的两段）</text>
        {bands}
        <line x1="24" y1={bottom} x2={W - 24} y2={bottom} stroke={c.grid} strokeWidth="1" />
        {bars}
        {!snap.done && lo >= 0 && mid >= 0 && (
          <g>
            <text x={xb(lo + (snap.i ?? 0)) + bw / 2} y={bottom + 14} textAnchor="middle" fontSize="9" fill={c.warning}>i</text>
            <text x={xb(mid + (snap.j ?? 0)) + bw / 2} y={bottom + 14} textAnchor="middle" fontSize="9" fill={c.series[4]}>j</text>
            {k >= 0 && k < n && (
              <text x={xb(k) + bw / 2} y={top - 8} textAnchor="middle" fontSize="9" fill={c.danger}>写回</text>
            )}
          </g>
        )}
        <text x="24" y="302" fontSize="11" fill={c.muted}>
          {snap.done
            ? '全部有序'
            : (lo >= 0 && mid >= 0
              ? `第 ${lv + 1} 层 · 段长 ${snap.width ?? 1} · 合并 [${lo}, ${mid - 1}] 与 [${mid}, ${hi - 1}]`
              : '准备归并')}
        </text>
        <text x={W - 24} y="302" fontSize="11" textAnchor="end" fill={c.muted}>时间 O(n log n) · 空间 O(n) · 稳定</text>
      </svg>
    );
  },
};
