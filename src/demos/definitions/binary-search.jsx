import React from 'react';
import { mulberry32, PALETTE } from '../utils.js';

const W = 720, H = 300, CAP = 560;
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
  id: 'binary-search',
  params: [
    { key: 'n', label: '数组长度', type: 'range', min: 8, max: 40, step: 1, default: 20 },
    { key: 'target', label: '目标值', type: 'range', min: 0, max: 100, step: 1, default: 55 },
    { key: 'seed', label: '随机种子', type: 'range', min: 1, max: 30, step: 1, default: 7 },
    { key: 'dup', label: '允许重复值', type: 'toggle', default: false, hint: '有序数组中出现相等元素' },
  ],
  height: H,
  legend: [
    { color: L.muted, label: '已排除' },
    { color: L.primary, label: '查找区间' },
    { color: L.warning, label: '中点 mid' },
    { color: L.danger, label: '目标值' },
    { color: L.success, label: '命中' },
  ],
  hint: '有序数组上每次取中点比较，把目标所在区间折半收缩，直到命中或区间为空。',

  buildSteps(p) {
    const n = p.n;
    const target = p.target;
    const rnd = mulberry32(p.seed * 977 + 3);
    const a = [];
    let cur = 2;
    for (let i = 0; i < n; i++) {
      cur += p.dup ? Math.floor(rnd() * 3) : 1 + Math.floor(rnd() * 2);
      a.push(Math.min(cur, 99));
    }
    const steps = [];
    let comparisons = 0, found = -1;
    let lo = 0, hi = n - 1, mid = -1;
    const push = (note, extra = {}) => steps.push({
      arr: [...a], target, lo, hi, mid, found, done: false, note,
      metrics: { 比较次数: comparisons, 区间长度: Math.max(0, hi - lo + 1), 查找结果: found >= 0 ? '已命中' : '进行中' },
      ...extra,
    });
    push(`生成 ${n} 个元素的升序数组，目标值为 ${target}。`);
    push(`初始化边界 lo = 0，hi = ${n - 1}，整个数组都是候选区间。`);
    while (lo <= hi) {
      mid = (lo + hi) >> 1;
      comparisons++;
      push(`取中点 mid = ${mid}，值为 ${a[mid]}，区间 [${lo}, ${hi}]。`, { lo, hi, mid });
      push(`比较 ${a[mid]} 与目标 ${target}。`, { lo, hi, mid });
      if (a[mid] === target) {
        found = mid;
        push(`命中！目标 ${target} 位于下标 ${mid}。`, { lo, hi, mid, found });
        break;
      }
      if (a[mid] < target) {
        push(`${a[mid]} 小于 ${target}，舍弃左半 [${lo}, ${mid}]，lo 收缩到 ${mid + 1}。`, { lo, hi, mid });
        lo = mid + 1;
      } else {
        push(`${a[mid]} 大于 ${target}，舍弃右半 [${mid}, ${hi}]，hi 收缩到 ${mid - 1}。`, { lo, hi, mid });
        hi = mid - 1;
      }
      push(`区间更新为 [${lo}, ${hi}]，剩余长度 ${Math.max(0, hi - lo + 1)}。`, { lo, hi, mid: -1 });
    }
    push(found >= 0
      ? `查找成功：${target} 在下标 ${found}，共比较 ${comparisons} 次。`
      : `查找失败：数组中不存在 ${target}，共比较 ${comparisons} 次。`, {
      lo, hi, mid: -1, found, done: true,
      metrics: { 比较次数: comparisons, 区间长度: 0, 查找结果: found >= 0 ? '已命中' : '未找到' },
    });
    return finalize(steps);
  },

  render(snap, p, c) {
    const arr = snap.arr || [];
    const n = arr.length;
    const target = snap.target ?? p.target ?? 0;
    const lo = snap.lo ?? 0, hi = snap.hi ?? Math.max(0, n - 1), mid = snap.mid ?? -1;
    const found = snap.found ?? -1;
    const top = 34, bottom = 252;
    const gap = 2, bw = (W - 48) / Math.max(1, n) - gap;
    const max = Math.max(100, ...arr, target);
    const bars = arr.map((v, i) => {
      const h = (v / max) * (bottom - top);
      const x = 24 + i * (bw + gap);
      let fill = c.muted;
      if (i >= lo && i <= hi) fill = c.primary;
      if (i === mid) fill = c.warning;
      if (i === found) fill = c.success;
      return (
        <g key={i}>
          <rect x={x} y={bottom - h} width={Math.max(1, bw)} height={h}
            rx={Math.min(3, bw / 3)} fill={fill} opacity={0.9} />
          {n <= 26 && (
            <text x={x + bw / 2} y={bottom - h - 5} textAnchor="middle" fontSize="9" fill={c.muted}>{v}</text>
          )}
          {(i === lo || i === hi) && (
            <text x={x + bw / 2} y={bottom + 12} textAnchor="middle" fontSize="9" fill={c.primary}>
              {lo === hi ? 'lo/hi' : (i === lo ? 'lo' : 'hi')}
            </text>
          )}
          {i === mid && (
            <text x={x + bw / 2} y={top - 12} textAnchor="middle" fontSize="9" fill={c.warning}>mid</text>
          )}
        </g>
      );
    });
    const ty = bottom - (target / max) * (bottom - top);
    return (
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} preserveAspectRatio="xMidYMid meet">
        <line x1="24" y1={bottom} x2={W - 24} y2={bottom} stroke={c.grid} strokeWidth="1" />
        <line x1="24" y1={ty} x2={W - 24} y2={ty} stroke={c.danger} strokeWidth="1" strokeDasharray="5 4" />
        <text x={W - 24} y={ty - 4} textAnchor="end" fontSize="10" fill={c.danger}>目标 {target}</text>
        {bars}
        <text x="24" y="288" fontSize="11" fill={c.muted}>
          {snap.done
            ? (found >= 0 ? `命中下标 ${found}` : '目标不存在')
            : `查找区间 [${lo}, ${hi}] · 中点 ${mid >= 0 ? mid : '待取'}`}
        </text>
        <text x={W - 24} y="288" fontSize="11" textAnchor="end" fill={c.muted}>时间 O(log n) · 空间 O(1) · 要求有序</text>
      </svg>
    );
  },
};
