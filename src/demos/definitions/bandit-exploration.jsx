import React from 'react';
import { mulberry32, clamp } from '../utils.js';

const W = 720;
const r2 = (v) => Math.round((Number.isFinite(v) ? v : 0) * 100) / 100;
const f2 = (v) => (Number.isFinite(v) ? v : 0).toFixed(2);

const META = [
  { key: 'egreedy', name: 'ε-greedy', short: 'εG' },
  { key: 'ucb', name: 'UCB', short: 'UCB' },
  { key: 'thompson', name: 'Thompson', short: 'TS' },
  { key: 'greedy', name: '纯贪心', short: '贪心' },
];

const gammaInt = (n, rnd) => {
  let s = 0;
  for (let k = 0; k < n; k++) s += -Math.log(Math.max(1e-9, rnd()));
  return s;
};
const betaSample = (a, b, rnd) => {
  const ga = gammaInt(a, rnd), gb = gammaInt(b, rnd);
  const d = ga + gb;
  return d > 1e-9 ? ga / d : 0.5;
};
const argmax = (scores) => {
  let bi = 0;
  for (let i = 1; i < scores.length; i++) if (scores[i] > scores[bi]) bi = i;
  return bi;
};

export default {
  id: 'bandit-exploration',
  params: [
    {
      key: 'focus', label: '策略聚焦', type: 'select', default: 'all',
      options: [
        { value: 'all', label: '全部策略同屏对比' },
        { value: 'egreedy', label: '聚焦 ε-greedy' },
        { value: 'ucb', label: '聚焦 UCB' },
        { value: 'thompson', label: '聚焦 Thompson Sampling' },
        { value: 'greedy', label: '聚焦 纯贪心（对照）' },
      ],
    },
    { key: 'arms', label: '臂数', type: 'range', min: 3, max: 8, step: 1, default: 5 },
    { key: 'steps', label: '总步数', type: 'range', min: 30, max: 200, step: 10, default: 100 },
    { key: 'epsilon', label: '探索率 ε', type: 'range', min: 0, max: 0.5, step: 0.05, default: 0.1 },
    { key: 'seed', label: '随机种子', type: 'range', min: 1, max: 30, step: 1, default: 7 },
    { key: 'showCI', label: '显示估计置信区间', type: 'toggle', default: true },
  ],
  height: 370,
  legend: [
    { color: '#226AFF', label: 'ε-greedy' },
    { color: '#e5484d', label: 'UCB' },
    { color: '#12a06a', label: 'Thompson Sampling' },
    { color: '#f5a524', label: '纯贪心（对照）' },
  ],
  hint: '真实模拟伯努利臂：同屏对比四种策略的累积遗憾与累积收益，观察探索（ε/置信上界/Beta 后验）如何避免陷入次优臂。',

  buildSteps(p) {
    const arms = clamp(Math.round(p.arms), 3, 8);
    const T = clamp(Math.round(p.steps), 30, 200);
    const eps = clamp(Number(p.epsilon) || 0, 0, 0.5);
    const focus = p.focus || 'all';
    const showCI = !!p.showCI;
    const rnd = mulberry32(p.seed);
    const rnd2 = mulberry32(((p.seed * 7919 + 13) >>> 0));

    // 真实臂均值：一个明显最优臂，其余为 0.08~0.7
    const mu = Array.from({ length: arms }, () => 0.08 + 0.62 * rnd());
    const bestArm = Math.floor(rnd() * arms);
    mu[bestArm] = 0.9;
    const muStar = mu[bestArm];

    // 共同的伯努利世界：各策略在同一 (臂,步) 看到相同 reward，保证公平对比
    const outcomes = Array.from({ length: arms }, (_, a) =>
      Array.from({ length: T }, () => (rnd() < mu[a] ? 1 : 0)));

    const states = {};
    META.forEach((m) => {
      states[m.key] = {
        pulls: Array(arms).fill(0), succ: Array(arms).fill(0), empMean: Array(arms).fill(0),
        cumReward: 0, expSum: 0, regret: [0], reward: [0], lastArm: null, lastR: 0,
      };
    });

    const steps = [];
    const cloneAll = () => {
      const out = {};
      META.forEach((m) => {
        const s = states[m.key];
        out[m.key] = {
          pulls: s.pulls.slice(), succ: s.succ.slice(), empMean: s.empMean.slice(),
          cumReward: s.cumReward, regret: s.regret.slice(), reward: s.reward.slice(),
          lastArm: s.lastArm, lastR: s.lastR,
        };
      });
      return out;
    };
    const snapOf = (note, t, metrics) => steps.push({
      mu, muStar, bestArm, arms, T, eps, focus, showCI,
      strategies: cloneAll(), t, note, metrics,
    });
    const lastReg = (key) => { const h = states[key].regret; return h[h.length - 1] || 0; };

    snapOf(`初始化：${arms} 个伯努利臂，真实均值 μ = [${mu.map(f2).join(', ')}]，最优臂 A${bestArm}（μ*=${f2(muStar)}）。`,
      -1, { 臂数: arms, 总步数: T, 最优臂: 'A' + bestArm, 最优均值: r2(muStar), 探索率ε: r2(eps) });

    for (let t = 0; t < T; t++) {
      META.forEach((m) => {
        const s = states[m.key];
        const untried = [];
        for (let a = 0; a < arms; a++) if (s.pulls[a] === 0) untried.push(a);
        let chosen;
        if (untried.length > 0) {
          chosen = untried[0];
        } else if (m.key === 'egreedy') {
          chosen = rnd2() < eps ? Math.floor(rnd2() * arms) : argmax(s.empMean);
        } else if (m.key === 'ucb') {
          const scores = s.empMean.map((e, a) => e + Math.sqrt(2 * Math.log(t + 1) / s.pulls[a]));
          chosen = argmax(scores);
        } else if (m.key === 'thompson') {
          const scores = Array.from({ length: arms }, (_, a) =>
            betaSample(s.succ[a] + 1, s.pulls[a] - s.succ[a] + 1, rnd2));
          chosen = argmax(scores);
        } else {
          chosen = argmax(s.empMean);
        }
        const r = outcomes[chosen][t];
        s.pulls[chosen] += 1;
        s.succ[chosen] += r;
        s.empMean[chosen] = s.succ[chosen] / s.pulls[chosen];
        s.cumReward += r;
        s.expSum += mu[chosen];
        s.lastArm = chosen; s.lastR = r;
        s.regret.push((t + 1) * muStar - s.expSum);
        s.reward.push(s.cumReward);
      });
      const picks = META.map((m) => `${m.short}:A${states[m.key].lastArm}(${states[m.key].lastR})`).join('  ');
      const regs = META.map((m) => `${m.short} ${f2(lastReg(m.key))}`).join(' / ');
      const leader = META.reduce((b, m) => (lastReg(m.key) < lastReg(b.key) ? m : b), META[0]);
      snapOf(
        `第 ${t + 1} 步｜选臂 ${picks}；累积期望遗憾 ${regs}。Thompson 用 Beta(s+1,f+1) 后验抽样，UCB 用置信上界。`,
        t,
        {
          步数: t + 1, 最优臂: 'A' + bestArm, 探索率ε: r2(eps),
          εG遗憾: r2(lastReg('egreedy')), UCB遗憾: r2(lastReg('ucb')),
          TS遗憾: r2(lastReg('thompson')), 贪心遗憾: r2(lastReg('greedy')),
          领先策略: leader.name,
        },
      );
    }

    const leader = META.reduce((b, m) => (lastReg(m.key) < lastReg(b.key) ? m : b), META[0]);
    snapOf(`对比完成：累积遗憾 εG ${f2(lastReg('egreedy'))} / UCB ${f2(lastReg('ucb'))} / TS ${f2(lastReg('thompson'))} / 贪心 ${f2(lastReg('greedy'))}，最低者为 ${leader.name}。`,
      T, {
        最终遗憾εG: r2(lastReg('egreedy')), 最终遗憾UCB: r2(lastReg('ucb')),
        最终遗憾TS: r2(lastReg('thompson')), 最终遗憾贪心: r2(lastReg('greedy')),
        最优策略: leader.name, 最优臂命中率: r2((states[leader.key].pulls[bestArm] || 0) / T),
      });

    return steps;
  },

  render(snap, p, c) {
    const H = 370;
    const mu = Array.isArray(snap.mu) ? snap.mu : [];
    const arms = mu.length;
    const T = snap.T || 0;
    const bestArm = snap.bestArm ?? -1;
    const muStar = snap.muStar || 0;
    const focus = snap.focus || 'all';
    const showCI = !!snap.showCI;
    const focused = focus !== 'all' ? focus : null;
    const S = snap.strategies || {};
    const metaOf = (key) => META.find((m) => m.key === key);
    const st = (key) => S[key] || { pulls: [], succ: [], empMean: [], regret: [], reward: [], lastArm: null, lastR: 0 };

    const allReg = [], allRew = [];
    META.forEach((m) => { allReg.push(...st(m.key).regret); allRew.push(...st(m.key).reward); });
    const maxReg = Math.max(1, ...allReg), maxRew = Math.max(1, ...allRew);

    const poly = (hist, gx, gy, gw, gh, maxV) => hist.map((v, idx) =>
      `${gx + (idx / Math.max(1, hist.length - 1)) * gw},${gy + gh - (clamp(v, 0, maxV) / maxV) * gh}`).join(' ');

    const estOf = (a) => {
      if (focused) return st(focused).empMean[a] || 0;
      let s = 0;
      META.forEach((m) => { s += st(m.key).empMean[a] || 0; });
      return s / META.length;
    };
    const pullOf = (a) => (focused ? st(focused) : st('egreedy')).pulls[a] || 0;

    const groupW = 392 / Math.max(1, arms);

    return (
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} preserveAspectRatio="xMidYMid meet">
        <text x="20" y="16" fontSize="11" fill={c.text}>
          多臂老虎机 · 四策略同屏对比 · 第 {Math.min(T, Math.max(0, (snap.t ?? 0) + 1))}/{T} 步 · 最优臂 A{bestArm < 0 ? '—' : bestArm}(μ*={f2(muStar)})
        </text>
        <text x="20" y="32" fontSize="10" fill={c.muted}>累积期望遗憾（越低越好）</text>
        <text x="370" y="32" fontSize="10" fill={c.muted}>累积收益（伯努利抽样，越高越好）</text>

        {/* 累积遗憾曲线 */}
        <line x1="40" y1="174" x2="350" y2="174" stroke={c.grid} strokeWidth="1" />
        <line x1="40" y1="44" x2="40" y2="174" stroke={c.grid} strokeWidth="1" />
        {[0.25, 0.5, 0.75].map((f) => (
          <line key={'rl' + f} x1="40" y1={174 - f * 130} x2="350" y2={174 - f * 130}
            stroke={c.grid} strokeWidth="0.6" strokeDasharray="3 3" />
        ))}
        {META.map((m, i) => {
          const h = st(m.key).regret;
          const dim = focused && focused !== m.key;
          return h.length > 1 ? (
            <polyline key={m.key} points={poly(h, 40, 44, 310, 130, maxReg)}
              fill="none" stroke={c.series[i]} strokeWidth={dim ? 1.2 : (focused ? 2.4 : 1.6)}
              opacity={dim ? 0.3 : 0.95} />
          ) : null;
        })}
        <text x="36" y="48" textAnchor="end" fontSize="9" fill={c.muted}>{f2(maxReg)}</text>
        <text x="36" y="177" textAnchor="end" fontSize="9" fill={c.muted}>0</text>
        <text x="350" y="186" textAnchor="end" fontSize="9" fill={c.muted}>步数 → {T}</text>

        {/* 累积收益曲线 */}
        <line x1="390" y1="174" x2="680" y2="174" stroke={c.grid} strokeWidth="1" />
        <line x1="390" y1="44" x2="390" y2="174" stroke={c.grid} strokeWidth="1" />
        {[0.25, 0.5, 0.75].map((f) => (
          <line key={'wl' + f} x1="390" y1={174 - f * 130} x2="680" y2={174 - f * 130}
            stroke={c.grid} strokeWidth="0.6" strokeDasharray="3 3" />
        ))}
        {META.map((m, i) => {
          const h = st(m.key).reward;
          const dim = focused && focused !== m.key;
          return h.length > 1 ? (
            <polyline key={m.key} points={poly(h, 390, 44, 290, 130, maxRew)}
              fill="none" stroke={c.series[i]} strokeWidth={dim ? 1.2 : (focused ? 2.4 : 1.6)}
              opacity={dim ? 0.3 : 0.95} />
          ) : null;
        })}
        <text x="386" y="48" textAnchor="end" fontSize="9" fill={c.muted}>{f2(maxRew)}</text>
        <text x="680" y="186" textAnchor="end" fontSize="9" fill={c.muted}>步数 → {T}</text>

        {/* 图例 */}
        {META.map((m, i) => (
          <g key={'lg' + m.key}>
            <rect x={20 + i * 175} y="192" width="10" height="10" rx="1" fill={c.series[i]}
              opacity={focused && focused !== m.key ? 0.35 : 1} />
            <text x={34 + i * 175} y="201" fontSize="9" fill={c.text}>
              {m.name} 遗憾 {f2((st(m.key).regret[st(m.key).regret.length - 1]) || 0)}
            </text>
          </g>
        ))}

        {/* 每臂真实均值 vs 估计均值 */}
        <text x="20" y="220" fontSize="10" fill={c.text}>
          每臂真实均值 μ（虚线）vs 估计均值（柱）· {focused ? '聚焦 ' + (metaOf(focused) ? metaOf(focused).name : '') : '四策略平均'}
        </text>
        <line x1="28" y1="326" x2="420" y2="326" stroke={c.grid} strokeWidth="1" />
        {mu.map((m, a) => {
          const gx0 = 28 + a * groupW;
          const est = clamp(estOf(a), 0, 1);
          const pulls = pullOf(a);
          const se = pulls > 0 ? Math.sqrt(est * (1 - est) / pulls) : 0;
          const cx = gx0 + groupW / 2;
          return (
            <g key={'arm' + a}>
              <rect x={gx0 + groupW * 0.3} y={326 - est * 88} width={groupW * 0.4} height={est * 88}
                fill={c.primary} opacity="0.8" />
              <line x1={gx0 + 2} y1={326 - m * 88} x2={gx0 + groupW - 2} y2={326 - m * 88}
                stroke={c.text} strokeWidth="1.4" strokeDasharray="4 2" />
              {showCI && pulls > 0 && (() => {
                const hi = clamp(est + 1.96 * se, 0, 1), lo = clamp(est - 1.96 * se, 0, 1);
                return (
                  <g>
                    <line x1={cx} y1={326 - hi * 88} x2={cx} y2={326 - lo * 88} stroke={c.warning} strokeWidth="1" />
                    <line x1={cx - 3} y1={326 - hi * 88} x2={cx + 3} y2={326 - hi * 88} stroke={c.warning} strokeWidth="1" />
                    <line x1={cx - 3} y1={326 - lo * 88} x2={cx + 3} y2={326 - lo * 88} stroke={c.warning} strokeWidth="1" />
                  </g>
                );
              })()}
              <text x={cx} y={326 - m * 88 - 4} textAnchor="middle" fontSize="9" fill={c.muted}>{f2(m)}</text>
              <text x={cx} y="338" textAnchor="middle" fontSize="9" fill={a === bestArm ? c.success : c.text}>
                A{a}{a === bestArm ? '*' : ''}
              </text>
            </g>
          );
        })}

        {/* 各策略拉取次数分布 */}
        <text x="450" y="220" fontSize="10" fill={c.text}>各策略臂拉取次数分布</text>
        {META.map((m, i) => {
          const s = st(m.key);
          const total = (s.pulls || []).reduce((x, y) => x + y, 0) || 1;
          let acc = 0;
          return (
            <g key={'dist' + m.key}>
              <text x="450" y={248 + i * 26} fontSize="9" fill={c.text}>{m.short}</text>
              <rect x="505" y={238 + i * 26} width="158" height="12" rx="2" fill={c.panel2} />
              {(s.pulls || []).map((cnt, a) => {
                const w = (cnt / total) * 158;
                const x0 = 505 + acc; acc += w;
                return <rect key={a} x={x0} y={238 + i * 26} width={Math.max(0, w)} height="12"
                  fill={c.series[a % c.series.length]} opacity={a === bestArm ? 1 : 0.72} />;
              })}
              <text x="666" y={248 + i * 26} fontSize="9" fill={c.text}>
                命中A* {Math.round(100 * ((s.pulls || [])[bestArm] || 0) / total)}%
              </text>
            </g>
          );
        })}
        <text x="450" y="340" fontSize="9" fill={c.muted}>色块按臂分段；A* 段越宽，命中真实最优臂越多。</text>

        <line x1="20" y1="346" x2={W - 20} y2="346" stroke={c.grid} strokeWidth="1" />
        <text x="20" y="362" fontSize="9" fill={c.muted}>
          regret(t)=t·μ* − Σμ(所选臂)（期望累积遗憾）；收益曲线用真实伯努利抽样。ε-greedy 以 ε 随机探索，UCB 用 √(2ln t / n)，TS 用 Beta 后验。
        </text>
      </svg>
    );
  },
};
