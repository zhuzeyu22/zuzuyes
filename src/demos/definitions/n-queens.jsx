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
  id: 'n-queens',
  params: [
    { key: 'n', label: '棋盘规模 N', type: 'range', min: 4, max: 8, step: 1, default: 6 },
    { key: 'order', label: '列尝试顺序', type: 'select', default: 'seq',
      options: [
        { value: 'seq', label: '从左到右' },
        { value: 'random', label: '随机优先（受种子影响）' },
      ] },
    { key: 'seed', label: '随机种子', type: 'range', min: 1, max: 30, step: 1, default: 7 },
    { key: 'allSolutions', label: '搜索全部解', type: 'toggle', default: false, hint: '关闭时找到第一个解即停止' },
  ],
  height: H,
  legend: [
    { color: L.panel, label: '空格' },
    { color: L.primary, label: '已放置皇后' },
    { color: L.warning, label: '正在尝试' },
    { color: L.danger, label: '冲突格 / 冲突皇后' },
    { color: L.success, label: '找到解' },
  ],
  hint: '逐行尝试放皇后，同列或同对角线即冲突并回溯，可选择只找第一个解或搜索全部解。',

  buildSteps(p) {
    const n = p.n;
    const rnd = mulberry32(p.seed * 101 + 29);
    const base = Array.from({ length: n }, (_, i) => i);
    const shuffled = () => {
      const a = [...base];
      for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(rnd() * (i + 1));
        const t = a[i]; a[i] = a[j]; a[j] = t;
      }
      return a;
    };
    const queens = Array(n).fill(-1);
    const steps = [];
    let attempts = 0, conflicts = 0, solutions = 0, stop = false;
    const push = (note, extra = {}) => steps.push({
      n, queens: [...queens], row: -1, trying: null, conflictWith: [],
      attempts, conflicts, solutions, phase: 'try', done: false, note,
      metrics: {
        尝试次数: attempts, 已放皇后: queens.filter((q) => q >= 0).length,
        冲突次数: conflicts, 找到解: solutions,
      },
      ...extra,
    });
    push(`在 ${n}×${n} 棋盘上逐行放置皇后，同行同列同对角线不可共存。`);
    function solve(r) {
      if (stop) return;
      if (r === n) {
        solutions++;
        push(`找到第 ${solutions} 个解！${n} 个皇后互不冲突。`, {
          row: n, trying: null, conflictWith: [], phase: 'solution',
        });
        if (!p.allSolutions) stop = true;
        return;
      }
      const cols = p.order === 'random' ? shuffled() : base;
      for (const col of cols) {
        if (stop) return;
        attempts++;
        const bad = [];
        for (let pr = 0; pr < r; pr++) {
          if (queens[pr] === col || Math.abs(queens[pr] - col) === r - pr) {
            bad.push({ r: pr, c: queens[pr] });
          }
        }
        push(`第 ${r + 1} 行尝试第 ${col + 1} 列。`, {
          row: r, trying: { r, c: col }, conflictWith: [], phase: 'try',
        });
        if (bad.length) {
          conflicts++;
          push(`该列与 ${bad.length} 个已放皇后冲突，放弃此列。`, {
            row: r, trying: { r, c: col },
            conflictWith: bad.map((b) => ({ ...b })), phase: 'conflict',
          });
          continue;
        }
        queens[r] = col;
        push(`第 ${r + 1} 行第 ${col + 1} 列安全，放下皇后。`, {
          row: r + 1, trying: null, conflictWith: [], phase: 'place',
        });
        solve(r + 1);
        queens[r] = -1;
      }
      if (!stop) {
        push(`第 ${r + 1} 行所有列都试过，回溯到上一行。`, {
          row: r - 1, trying: null, conflictWith: [], phase: 'backtrack',
        });
      }
    }
    solve(0);
    push(p.allSolutions
      ? `搜索结束：共尝试 ${attempts} 次，找到 ${solutions} 个解。`
      : `第 ${attempts} 次尝试后找到第一个解，停止搜索。`, {
      row: -1, trying: null, conflictWith: [], phase: 'done', done: true,
    });
    return finalize(steps);
  },

  render(snap, p, c) {
    const n = snap.n || p.n || 6;
    const queens = snap.queens || [];
    const trying = snap.trying || null;
    const conflictWith = snap.conflictWith || [];
    const phase = snap.phase || 'try';
    const cell = Math.min(44, 240 / Math.max(1, n));
    const bx = 30, by = 46;
    const cells = [];
    for (let r = 0; r < n; r++) {
      for (let col = 0; col < n; col++) {
        const x = bx + col * cell, y = by + r * cell;
        const dark = (r + col) % 2 === 1;
        const isTry = trying && trying.r === r && trying.c === col;
        const isConflict = phase === 'conflict' && conflictWith.some((b) => b.r === r && b.c === col);
        const hasQueen = queens[r] === col;
        const qCol = phase === 'solution' ? c.success : c.primary;
        cells.push(
          <g key={`${r}-${col}`}>
            <rect x={x} y={y} width={cell - 1} height={cell - 1} rx="2"
              fill={c.panel} stroke={c.border} strokeWidth="1" />
            {dark && (
              <rect x={x} y={y} width={cell - 1} height={cell - 1} rx="2"
                fill={c.muted} fillOpacity={0.12} stroke="none" />
            )}
            {isConflict && (
              <rect x={x} y={y} width={cell - 1} height={cell - 1} rx="2"
                fill={c.danger} fillOpacity={0.28} stroke="none" />
            )}
            {isTry && (
              <rect x={x} y={y} width={cell - 1} height={cell - 1} rx="2"
                fill={phase === 'conflict' ? c.danger : c.warning} fillOpacity={0.3}
                stroke={phase === 'conflict' ? c.danger : c.warning} strokeWidth="2" />
            )}
            {hasQueen && (
              <g>
                <circle cx={x + (cell - 1) / 2} cy={y + (cell - 1) / 2} r={cell * 0.32}
                  fill={c.panel} stroke={qCol} strokeWidth="2" />
                <text x={x + (cell - 1) / 2} y={y + (cell - 1) / 2 + 4}
                  textAnchor="middle" fontSize="12" fill={qCol}>后</text>
              </g>
            )}
          </g>
        );
      }
    }
    return (
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} preserveAspectRatio="xMidYMid meet">
        <text x="24" y="18" fontSize="11" fill={c.muted}>N 皇后棋盘（{n}×{n}） · 红格为冲突位置</text>
        {cells}
        <text x="330" y="30" fontSize="11" fill={c.muted}>回溯栈（已放置的皇后）</text>
        {queens.map((q, r) => (q >= 0 ? (
          <g key={`q${r}`}>
            <rect x="330" y={40 + r * 24} width="180" height="20" rx="3"
              fill={c.panel} stroke={c.border} strokeWidth="1" />
            <text x="338" y={54 + r * 24} fontSize="10" fill={c.text}>第 {r + 1} 行 → 第 {q + 1} 列</text>
          </g>
        ) : null))}
        <text x="530" y="30" fontSize="11" fill={c.muted}>统计</text>
        <text x="530" y="62" fontSize="11" fill={c.text}>尝试次数 {snap.attempts ?? 0}</text>
        <text x="530" y="84" fontSize="11" fill={c.text}>冲突次数 {snap.conflicts ?? 0}</text>
        <text x="530" y="106" fontSize="11" fill={c.success}>找到解 {snap.solutions ?? 0}</text>
        <text x="530" y="140" fontSize="10" fill={c.muted}>
          {phase === 'solution'
            ? '当前为一个合法解'
            : (trying ? `正在尝试第 ${trying.r + 1} 行第 ${trying.c + 1} 列` : '逐行回溯中')}
        </text>
        <text x="24" y={H - 14} fontSize="11" fill={c.muted}>
          {snap.done ? `搜索结束，共 ${snap.solutions ?? 0} 个解` : `棋盘 ${n}×${n} · 当前阶段：${phase}`}
        </text>
        <text x={W - 24} y={H - 14} fontSize="11" textAnchor="end" fill={c.muted}>回溯 · 时间 O(N!) · 空间 O(N)</text>
      </svg>
    );
  },
};
