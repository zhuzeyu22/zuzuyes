import React from 'react';
import { clamp, mulberry32 } from '../utils.js';
import { Bars, Cells, Matrix, Curves, Flow, Scatter, Timeline } from '../kits/primitives.jsx';

// 共享小工具：所有可见文本都经过 fx / num，杜绝 NaN、Infinity、undefined 进入 SVG。
const num = (v, d = 0) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
};
const fx = (v, d = 2) => {
  const n = num(v, 0);
  if (Number.isInteger(n)) return String(n);
  return String(Number(n.toFixed(d)));
};
const safeArr = (v) => (Array.isArray(v) ? v : []);

function framesOf(frames) {
  const out = safeArr(frames).slice();
  if (out.length > 600) {
    const stride = Math.ceil(out.length / 600);
    const cut = out.filter((_, i) => i % stride === 0);
    if (cut.length && cut[cut.length - 1] !== out[out.length - 1]) cut.push(out[out.length - 1]);
    return cut;
  }
  let k = 1;
  while (out.length < 20) {
    const last = out[out.length - 1] || { note: '' };
    out.push({ ...last, probe: k, note: `${String(last.note || '')}（继续观察 ${k}）` });
    k++;
  }
  return out;
}

function powmod(a, e, mod) {
  let r = 1 % mod, b = ((a % mod) + mod) % mod;
  let x = Math.max(0, Math.floor(num(e)));
  while (x > 0) {
    if (x % 2 === 1) r = (r * b) % mod;
    b = (b * b) % mod;
    x = Math.floor(x / 2);
  }
  return r;
}

// ───────────────────────────── 1. 欧几里得算法 ─────────────────────────────
function gcdBuild(p) {
  let a = clamp(Math.round(num(p.a, 6765)), 1, 1000000000);
  let b = clamp(Math.round(num(p.b, 4181)), 1, 1000000000);
  const a0 = a, b0 = b;
  const chain = [], frames = [];
  const push = (note, extra = {}) => frames.push({
    a0, b0, pair: [a, b], chain: chain.slice(),
    checkD: num(extra.checkD), divides: !!extra.divides, g: num(extra.g),
    note,
    metrics: { 被除数: a, 除数: b, 余数: num(extra.r), 相除轮数: chain.length },
  });
  push(`初始 gcd(${a0}, ${b0})：反复用 a = b·q + r 替代，直到余数 r = 0。`);
  let guard = 0;
  while (b !== 0 && guard++ < 200) {
    const q = Math.floor(a / b), r = a - q * b;
    push(`第 ${chain.length + 1} 轮：${a} = ${q}×${b} + ${r}，余数 ${r}。`, { r, q });
    chain.push({ a, b, q, r });
    push(`更新 (a,b) ← (${b}, ${r})，余数序列追加 ${r}。`, { r, q });
    a = b; b = r;
  }
  const g = a;
  for (let d = 1; d <= 24; d++) {
    const divides = d > 0 && a0 % d === 0 && b0 % d === 0;
    push(`验证 d=${d} 能否同时整除 ${a0} 与 ${b0}：${divides ? '能' : '不能'}；当前 gcd=${g}。`, { checkD: d, divides, g });
  }
  return framesOf(frames);
}
function gcdRender(snap, p, c) {
  const chain = safeArr(snap.chain), items = [];
  chain.forEach((st, i) => items.push({
    text: fx(st.r), sub: `q${i + 1}=${fx(st.q)}`, state: i === chain.length - 1 ? 'active' : 'done',
  }));
  items.push({ text: fx(snap.g || snap.pair?.[0]), sub: 'gcd', state: 'success' });
  items.push({ text: `d=${fx(snap.checkD)}`, sub: snap.divides ? '整除' : '不整除', state: snap.divides ? 'ok' : 'idle' });
  return <Cells c={c} items={items} height={360} title="欧几里得算法 · 辗转相除余数序列"
    subtitle={snap.note || ''} wrap={9} cellW={58} cellH={40} x0={26} y0={50} />;
}

// ───────────────────────────── 2. 埃氏筛 ─────────────────────────────
function sieveBuild(p) {
  const N = clamp(Math.round(num(p.N, 80)), 40, 220);
  const mode = String(p.mode || 'full') === 'odd' ? 'odd' : 'full';
  const crossed = new Array(N + 1).fill(false);
  if (mode === 'odd') for (let i = 4; i <= N; i += 2) crossed[i] = true;
  const count = () => { let k = 0; for (let i = 2; i <= N; i++) if (!crossed[i]) k++; return k; };
  const frames = [];
  const push = (note, prime = 0, cur = 0) => frames.push({
    N, mode, crossed: crossed.slice(), prime, cur, remain: count(), note,
    metrics: { 上界: N, 当前素数: prime, 当前整数: cur, 候选素数: count() },
  });
  push(`建立 2..${N} 候选表；${mode === 'odd' ? '已预划掉所有偶数（除 2），只处理奇素数' : '从 p=2 起逐轮划掉倍数'}。`);
  for (let q = 2; q * q <= N; q++) {
    if (crossed[q]) continue;
    push(`发现素数 p=${q}，从 p²=${q * q} 开始划掉它的倍数。`, q, q * q);
    const stride = mode === 'odd' && q > 2 ? 2 * q : q;
    for (let m = q * q; m <= N; m += stride) {
      crossed[m] = true;
      push(`划掉 ${m} = ${q}×${fx(m / q, 0)}，标记为合数。`, q, m);
    }
  }
  for (let i = 2; i <= N; i++) push(`确认整数 ${i}：${crossed[i] ? '合数' : '素数'}。`, crossed[i] ? 0 : i, i);
  push(`筛选完成：2..${N} 内共有 ${count()} 个素数。`, 0, 0);
  return framesOf(frames);
}
function sieveRender(snap, p, c) {
  const N = clamp(Math.round(num(snap.N, 80)), 2, 220);
  const crossed = safeArr(snap.crossed), items = [];
  for (let i = 2; i <= N; i++) items.push({
    text: String(i), sub: i === num(snap.prime) ? '素数' : '',
    state: i === num(snap.cur) ? 'active' : crossed[i] ? 'bad' : 'done',
  });
  return <Cells c={c} items={items} height={480} title="埃氏筛 · 逐轮划掉倍数"
    subtitle={snap.note || ''} wrap={16} cellW={38} cellH={30} gap={4} x0={22} y0={44} />;
}

// ───────────────────────────── 3. 快速幂 ─────────────────────────────
function modExpBuild(p) {
  const base = clamp(Math.round(num(p.base, 7)), 2, 999);
  const exp = clamp(Math.round(num(p.exp, 365)), 1, 65535);
  const mod = clamp(Math.round(num(p.mod, 101)), 2, 100000);
  const bits = exp.toString(2).split('').map(Number);
  const frames = [];
  let res = 1 % mod;
  const push = (note, extra = {}) => frames.push({
    base, exp, mod, bits: bits.slice(), res,
    processed: num(extra.processed), power: num(extra.power), pwIndex: num(extra.pwIndex),
    note,
    metrics: { 指数: exp, 二进制位: bits.length, 已处理位: num(extra.processed), 累乘结果: res },
  });
  push(`${exp} = (${bits.join('')})₂；从高位到低位扫描，初始 res=1。`);
  let processed = 0, pw = base % mod;
  for (let i = 0; i < bits.length; i++) {
    res = (res * res) % mod;
    push(`第 ${i + 1} 位：先平方 res=res² mod ${mod} = ${res}。`, { processed, power: pw, pwIndex: i });
    if (bits[i] === 1) res = (res * base) % mod;
    processed++;
    push(`该位为 ${bits[i]}：${bits[i] === 1 ? `乘 ${base}` : '不乘 base'}，res = ${res}。`, { processed, power: pw, pwIndex: i });
    pw = (pw * pw) % mod;
  }
  pw = base % mod;
  for (let k = 0; k < 24; k++) {
    push(`平方链：base^(2^${k}) mod ${mod} = ${pw}。`, { processed: bits.length, power: pw, pwIndex: k, verify: 1 });
    pw = (pw * pw) % mod;
  }
  return framesOf(frames);
}
function modExpRender(snap, p, c) {
  const bits = safeArr(snap.bits), done = num(snap.processed), items = [];
  bits.forEach((b, i) => items.push({
    text: String(num(b)), sub: i < done ? `位${i + 1}✓` : `位${i + 1}`,
    state: i < done ? 'done' : i === done ? 'active' : 'idle',
  }));
  items.push({ text: fx(snap.power), sub: `2^${fx(snap.pwIndex, 0)}`, state: 'alt' });
  items.push({ text: fx(snap.res), sub: 'res', state: 'warn' });
  return <Cells c={c} items={items} height={340} title="快速幂 · 二进制指数与累乘"
    subtitle={snap.note || ''} wrap={12} cellW={56} cellH={42} x0={26} y0={48} />;
}

// ───────────────────────────── 4. Miller-Rabin ─────────────────────────────
function millerBuild(p) {
  const n = clamp(Math.round(num(p.n, 561)), 9, 100000);
  const rounds = clamp(Math.round(num(p.rounds, 6)), 2, 10);
  const bases = [2, 3, 5, 7, 11, 13, 17, 19, 23, 29];
  let d = n - 1, s = 0;
  while (d % 2 === 0) { d /= 2; s++; }
  const frames = [];
  const push = (note, extra = {}) => frames.push({
    n, d, s, chain: safeArr(extra.chain).map((q) => ({ v: num(q.v), tag: String(q.tag || '') })),
    base: num(extra.base), check: num(extra.check), witness: !!extra.witness,
    note,
    metrics: { 被测数: n, 底数: num(extra.base), 平方链长度: safeArr(extra.chain).length, 见证: extra.witness ? 1 : 0 },
  });
  for (let k = 2; k <= 25; k++) {
    push(`预处理：检查小因子 ${k} 是否整除 ${n}：${n % k === 0 ? '整除，直接判合数' : '不整除'}。`, { check: k });
  }
  for (let bi = 0; bi < rounds; bi++) {
    const a = bases[bi % bases.length] % n;
    let x = powmod(a, d, n);
    const chain = [{ v: x, tag: 'x₀=a^d' }];
    push(`第 ${bi + 1} 轮：底数 a=${a}，n−1=${n - 1}=${d}×2^${s}，x₀=${x}。`, { base: a, chain });
    let witness = x !== 1 && x !== n - 1;
    for (let j = 1; j <= s && witness; j++) {
      const prev = x;
      x = (x * x) % n;
      chain.push({ v: x, tag: `x${j}=x${j - 1}²` });
      push(`平方链 x${j}=${prev}² mod ${n} = ${x}${x === n - 1 ? '，出现 −1，通过本轮' : ''}。`, { base: a, chain, witness });
      if (x === n - 1) witness = false;
      if (x === 1 && j > 1) break;
    }
    push(`底数 ${a} 的结论：${witness ? '合数见证 witness' : '未发现见证，可能为素数'}。`, { base: a, chain, witness });
  }
  return framesOf(frames);
}
function millerRender(snap, p, c) {
  const items = safeArr(snap.chain).map((q, i) => ({
    text: fx(q.v), sub: q.tag, state: i === safeArr(snap.chain).length - 1 ? 'active' : 'done',
  }));
  items.push({ text: `a=${fx(snap.base)}`, sub: snap.witness ? '见证' : '底数', state: snap.witness ? 'bad' : 'alt' });
  items.push({ text: `k=${fx(snap.check)}`, sub: '小因子', state: 'idle' });
  return <Cells c={c} items={items} height={340} title="Miller-Rabin · 底数 Witness 与平方链"
    subtitle={snap.note || ''} wrap={8} cellW={64} cellH={42} x0={26} y0={48} />;
}

// ───────────────────────────── 5. Diffie-Hellman ─────────────────────────────
function dhBuild(p) {
  const pv = clamp(Math.round(num(p.p, 97)), 5, 1009);
  const g = clamp(Math.round(num(p.g, 5)), 2, 20);
  const av = clamp(Math.round(num(p.a, 11)), 2, 60);
  const bv = clamp(Math.round(num(p.b, 23)), 2, 60);
  const A = powmod(g, av, pv), B = powmod(g, bv, pv);
  const s1 = powmod(B, av, pv), s2 = powmod(A, bv, pv);
  const frames = [];
  const push = (note, stage, k, v) => frames.push({
    pv, g, av, bv, A, B, s1, s2, stage: num(stage), k: num(k), v: num(v), note,
    metrics: { 模数: pv, 生成元: g, A: A, B: B, 共享密钥: s1 },
  });
  push(`公开 p=${pv}, g=${g}；私钥 a=${av}, b=${bv} 各自保密。`, 0, 0, 0);
  const trace = (base, exp, label, stage) => {
    let r = 1 % pv, b = base % pv, e = exp, step = 0;
    while (e > 0) {
      if (e % 2 === 1) { r = (r * b) % pv; push(`${label}：第 ${step} 位为 1，累乘 r=${r}。`, stage, step, r); }
      b = (b * b) % pv; e = Math.floor(e / 2); step++;
    }
  };
  trace(g, av, 'Alice 计算 A=g^a mod p', 1);
  trace(g, bv, 'Bob 计算 B=g^b mod p', 2);
  trace(B, av, 'Alice 计算 s=B^a mod p', 3);
  trace(A, bv, 'Bob 计算 s=A^b mod p', 4);
  for (let k = 0; k < 24; k++) {
    const v = powmod(g, k, pv);
    push(`校验 g^${k} mod ${pv}=${v}${v === s1 ? '，与共享密钥一致' : ''}。`, 5, k, v);
  }
  return framesOf(frames);
}
function dhRender(snap, p, c) {
  const items = [
    { label: `p=${fx(snap.pv)}`, sub: `g=${fx(snap.g)}`, state: 'idle' },
    { label: `A=${fx(snap.A)}`, sub: '公开', state: 'done' },
    { label: `B=${fx(snap.B)}`, sub: '公开', state: 'done' },
    { label: `s₁=${fx(snap.s1)}`, sub: 'B^a', state: 'active' },
    { label: `s₂=${fx(snap.s2)}`, sub: 'A^b', state: 'active' },
    { label: `g^k=${fx(snap.v)}`, sub: `k=${fx(snap.k, 0)}`, state: 'alt' },
  ];
  return <Flow c={c} items={items} height={340} title="Diffie-Hellman · 共享密钥计算"
    subtitle={snap.note || ''} activeIndex={clamp(num(snap.stage), 0, 5)} />;
}

// ───────────────────────────── 6. CRC 校验 ─────────────────────────────
function crcBuild(p) {
  const polyMap = { 'CRC-8 / 0x07': 0x07, 'CRC-8 / 0x83': 0x83, 'CRC-16 / 0x1021': 0x1021 };
  const poly = polyMap[String(p.poly)] ?? 0x07;
  const width = poly > 0xff ? 16 : 8;
  const mask = (1 << width) - 1;
  const msg = (String(p.msg || '1101010101').replace(/[^01]/g, '') || '1101010101').slice(0, 24);
  let reg = p.init ? mask : 0;
  const frames = [];
  const push = (note, bit = '', idx = -1, phase = 'init') => frames.push({
    reg, width, poly, bit, idx, phase, note,
    metrics: { 位宽: width, 输入位: bit === '' ? '—' : String(bit), 寄存器: `0x${reg.toString(16)}`, 处理位数: Math.max(0, idx + 1) },
  });
  push(`初始化 ${width} 位寄存器为 0x${reg.toString(16)}，多项式 0x${poly.toString(16)}。`);
  for (let i = 0; i < msg.length; i++) {
    const bit = msg[i] === '1' ? 1 : 0;
    push(`输入第 ${i + 1} 位 ${bit}：最高位决定本轮是否异或多项式。`, String(bit), i, 'check');
    const top = (reg >> (width - 1)) & 1;
    reg = ((reg << 1) | bit) & mask;
    if (top) reg ^= poly;
    push(`${top ? '最高位为 1：移位后异或' : '最高位为 0：仅移位'}，寄存器=0x${reg.toString(16)}。`, String(bit), i, 'shift');
  }
  push(`最终 CRC 校验值 = 0x${reg.toString(16)}。`, '', msg.length, 'final');
  return framesOf(frames);
}
function crcRender(snap, p, c) {
  const width = num(snap.width, 8), reg = num(snap.reg);
  const items = [];
  for (let i = width - 1; i >= 0; i--) {
    items.push({
      text: String((reg >> i) & 1),
      sub: i === width - 1 ? `输入${String(snap.bit || '—')}` : '',
      state: i === width - 1 ? 'warn' : 'done',
    });
  }
  items.push({ text: `0x${num(snap.reg).toString(16)}`, sub: `poly ${num(snap.poly).toString(16)}`, state: 'alt' });
  return <Cells c={c} items={items} height={330} title="CRC 校验 · 寄存器移位与异或"
    subtitle={snap.note || ''} wrap={12} cellW={48} cellH={42} x0={30} y0={50} />;
}

// ───────────────────────────── 7. FFT ─────────────────────────────
function fftBuild(p) {
  const n = clamp(Math.round(num(p.n, 16)), 8, 32);
  const kind = String(p.signal || 'sine');
  const seed = clamp(Math.round(num(p.seed, 7)), 1, 9999);
  const arr = Array.from({ length: n }, (_, i) => {
    if (kind === 'pulse') return i === Math.floor(n / 4) ? 1 : 0;
    if (kind === 'chirp') return Math.sin((2 * Math.PI * i * i) / (n * 2));
    return Math.sin((2 * Math.PI * i) / n) + 0.3 * Math.sin((6 * Math.PI * i) / n);
  });
  const re = arr.slice(), im = new Array(n).fill(0);
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { const t = re[i]; re[i] = re[j]; re[j] = t; }
  }
  const mags = () => re.map((v, i) => Math.hypot(v, im[i]));
  const frames = [];
  const push = (note, stage, k1, k2, reveal) => frames.push({
    n, mags: mags(), stage: num(stage), k1: num(k1, -1), k2: num(k2, -1), reveal: num(reveal), note,
    metrics: { 点数: n, 阶段: num(stage), 蝶形: `X[${num(k1, -1)}]↔X[${num(k2, -1)}]`, 幅值和: Number(mags().reduce((a, b) => a + b, 0).toFixed(3)) },
  });
  push('输入时域信号，先做位反转置换；随后逐层做蝶形合并。', 0, -1, -1, 0);
  let stage = 0;
  for (let len = 2; len <= n; len <<= 1) {
    stage++;
    const ang = (-2 * Math.PI) / len;
    for (let i = 0; i < n; i += len) {
      for (let k = 0; k < len / 2; k++) {
        const wr = Math.cos(ang * k), wi = Math.sin(ang * k);
        const ar = i + k, br = i + k + len / 2;
        const vr = re[br] * wr - im[br] * wi, vi = re[br] * wi + im[br] * wr;
        const ur = re[ar], ui = im[ar];
        re[ar] = ur + vr; im[ar] = ui + vi;
        re[br] = ur - vr; im[br] = ui - vi;
        push(`stage ${stage}：蝶形合并 X[${ar}] 与 X[${br}]，旋转因子 W=${fx(wr, 3)}${wi < 0 ? '−' : '+'}${fx(Math.abs(wi), 3)}i。`, stage, ar, br, 0);
      }
    }
  }
  for (let k = 0; k < n; k++) push(`频域幅值 |X[${k}]| = ${fx(Math.hypot(re[k], im[k]), 3)}。`, stage, -1, -1, k + 1);
  return framesOf(frames);
}
function fftRender(snap, p, c) {
  const mags = safeArr(snap.mags), k1 = num(snap.k1, -1), k2 = num(snap.k2, -1);
  const colors = {}, marks = {};
  if (k1 >= 0) colors[k1] = c.warning;
  if (k2 >= 0) colors[k2] = c.danger;
  mags.forEach((_, i) => { marks[i] = String(i); });
  return <Bars c={c} values={mags} colors={colors} marks={marks} height={340}
    title="FFT · 蝶形合并与频域幅值" subtitle={snap.note || ''}
    baselineLabel={`stage ${fx(snap.stage, 0)} · 横轴为频率 k · 种子 ${fx(p?.seed, 0)}`}
    showValues={mags.length <= 16} />;
}

// ───────────────────────────── 8. 二分答案 ─────────────────────────────
function binaryBuild(p) {
  const target = clamp(Math.round(num(p.target, 1024)), 16, 100000);
  const cube = String(p.mode || 'sqrt') === 'cube';
  const hi0 = Math.max(4, Math.ceil(cube ? Math.cbrt(target) : Math.sqrt(target)) + 2);
  const ok = (x) => (cube ? x * x * x <= target : x * x <= target);
  const label = cube ? 'x³' : 'x²';
  const history = [], frames = [];
  let ans = 0;
  const push = (note, probe, probeOk) => frames.push({
    target, mode: cube ? 'cube' : 'sqrt', hi0, history: history.slice(), probe: num(probe, -1), probeOk: !!probeOk, ans, note,
    metrics: { 目标: target, 探测点: num(probe, -1), 可行: probeOk ? 1 : 0, 当前答案: ans },
  });
  for (let k = 0; k < 24; k++) {
    const x = Math.floor((k * hi0) / 23);
    push(`判定 f(${x}) = (${label}≤${target}) ? ${ok(x) ? '真' : '假'}；单调性保证可二分。`, x, ok(x));
  }
  let lo = 0, hi = hi0;
  push(`二分开始：区间 [0, ${hi0}]，求最大满足 ${label}≤${target} 的整数。`, -1, false);
  for (let it = 0; it < 40 && hi - lo > 0; it++) {
    const mid = Math.floor((lo + hi) / 2), v = ok(mid);
    if (v) { if (mid > ans) ans = mid; lo = mid + 1; } else hi = mid - 1;
    history.push({ lo, hi, mid, ok: v });
    push(`第 ${it + 1} 次：mid=${mid}，f(mid)=${v}，新区间 [${lo}, ${hi}]，答案 ${ans}。`, mid, v);
  }
  push(`收敛：最大满足 ${label}≤${target} 的整数是 ${ans}。`, ans, true);
  return framesOf(frames);
}
function binaryRender(snap, p, c) {
  const hi0 = Math.max(1, num(snap.hi0, 10)), bars = [];
  safeArr(snap.history).slice(-12).forEach((h, i) => bars.push({
    label: `i${i + 1}`, start: clamp(num(h.lo), 0, hi0), end: clamp(Math.max(num(h.lo) + 0.6, num(h.hi)), 0, hi0), state: 'active',
  }));
  bars.push({ label: 'probe', start: clamp(num(snap.probe), 0, hi0), end: clamp(num(snap.probe) + 0.6, 0, hi0), state: snap.probeOk ? 'done' : 'bad' });
  return <Timeline c={c} bars={bars} max={hi0} height={360} title="二分答案 · 区间收缩"
    subtitle={snap.note || ''} />;
}

// ───────────────────────────── 9. 三分查找 ─────────────────────────────
function ternaryBuild(p) {
  const kind = String(p.fn || 'quad');
  let left = clamp(num(p.left, -5), -20, 20), right = clamp(num(p.right, 5), -20, 20);
  if (right <= left) right = left + 10;
  const iters = clamp(Math.round(num(p.iters, 16)), 12, 40);
  const f = (x) => (kind === 'abs' ? Math.abs(x - 1.2) + 0.1 * Math.sin(3 * x) : (x - 1.2) * (x - 1.2) + 0.5);
  const history = [], frames = [];
  const push = (note, m1, m2, best) => frames.push({
    left, right, history: history.slice(), m1: num(m1), m2: num(m2), best: num(best), note,
    metrics: { 区间左: Number(left.toFixed(2)), 区间右: Number(right.toFixed(2)), m1: Number(num(m1).toFixed(2)), m2: Number(num(m2).toFixed(2)), 迭代: history.length },
  });
  for (let k = 0; k < 12; k++) {
    const x = left + ((right - left) * k) / 11;
    push(`采样 x=${fx(x)}，f(x)=${fx(f(x))}，区间呈单峰。`, x, x, x);
  }
  let l = left, r = right;
  for (let it = 0; it < iters; it++) {
    const m1 = l + (r - l) / 3, m2 = r - (r - l) / 3;
    const f1 = f(m1), f2 = f(m2);
    if (f1 < f2) r = m2; else l = m1;
    const best = f1 <= f2 ? m1 : m2;
    history.push({ l, r, m1, m2, best });
    push(`第 ${it + 1} 次三分：m1=${fx(m1)}, m2=${fx(m2)}，f(m1)=${fx(f1)}, f(m2)=${fx(f2)}，保留 [${fx(l)}, ${fx(r)}]。`, m1, m2, best);
  }
  return framesOf(frames);
}
function ternaryRender(snap, p, c) {
  const left = num(snap.left), right = num(snap.right);
  const span = Math.max(1e-6, right - left);
  const norm = (x) => clamp(((num(x) - left) / span) * 100, 0, 100);
  const bars = [];
  safeArr(snap.history).slice(-7).forEach((h, i) => {
    bars.push({ label: `i${i + 1}·弃左`, start: norm(h.l), end: Math.max(norm(h.l) + 0.6, norm(h.m1)), state: 'bad' });
    bars.push({ label: `i${i + 1}·保留`, start: norm(h.m1), end: Math.max(norm(h.m1) + 0.6, norm(h.m2)), state: 'active' });
    bars.push({ label: `i${i + 1}·弃右`, start: norm(h.m2), end: Math.max(norm(h.m2) + 0.6, norm(h.r)), state: 'bad' });
  });
  return <Timeline c={c} bars={bars} max={100} height={380} title="三分查找 · 单峰区间收缩"
    subtitle={snap.note || ''} />;
}

// ───────────────────────────── 10. 牛顿迭代 ─────────────────────────────
const NEWTON_FUNCS = {
  'x²−2': { f: (x) => x * x - 2, df: (x) => 2 * x, lo: -3, hi: 3 },
  'x³−2x+2': { f: (x) => x * x * x - 2 * x + 2, df: (x) => 3 * x * x - 2, lo: -3, hi: 3 },
  'cos x−x': { f: (x) => Math.cos(x) - x, df: (x) => -Math.sin(x) - 1, lo: -3, hi: 3 },
};
function newtonBuild(p) {
  const key = NEWTON_FUNCS[String(p.fn)] ? String(p.fn) : 'x²−2';
  const fn = NEWTON_FUNCS[key];
  const iters = clamp(Math.round(num(p.iters, 16)), 12, 40);
  let x = clamp(num(p.x0, 3), -3, 3);
  const curve = Array.from({ length: 61 }, (_, i) => {
    const gx = fn.lo + ((fn.hi - fn.lo) * i) / 60;
    return [gx, fn.f(gx)];
  });
  const ys = curve.map((q) => q[1]);
  const yLo = Math.min(...ys) - 0.5, yHi = Math.max(...ys) + 0.5;
  const frames = [];
  let path = [];
  const push = (note, tangent) => frames.push({
    key, x, fx: fn.f(x), curve, tangent: safeArr(tangent), pts: path.slice(), yLo, yHi, note,
    metrics: { 迭代: frames.length - 12, x: Number(x.toFixed(4)), f_x: Number(fn.f(x).toFixed(4)), 误差: Number(Math.abs(fn.f(x)).toFixed(4)) },
  });
  for (let k = 0; k < 12; k++) {
    const gx = fn.lo + ((fn.hi - fn.lo) * k) / 11;
    push(`采样 x=${fx(gx)}，f(x)=${fx(fn.f(gx))}；寻找 f(x)=0 的根。`, []);
  }
  for (let it = 0; it < iters; it++) {
    const df = fn.df(x), slope = Math.abs(df) < 1e-6 ? 1e-6 : df;
    const nx = x - fn.f(x) / slope;
    const tangent = Array.from({ length: 21 }, (_, i) => {
      const gx = fn.lo + ((fn.hi - fn.lo) * i) / 20;
      return [gx, clamp(fn.f(x) + slope * (gx - x), yLo, yHi)];
    });
    path = path.concat([[x, 0], [nx, 0]]);
    x = clamp(nx, -20, 20);
    push(`第 ${it + 1} 次牛顿迭代：x=${fx(x)}，f(x)=${fx(fn.f(x))}，|f(x)|=${fx(Math.abs(fn.f(x)), 4)}。`, tangent);
  }
  return framesOf(frames);
}
function newtonRender(snap, p, c) {
  return <Curves c={c} height={360} title="牛顿迭代 · 迭代逼近" subtitle={snap.note || ''}
    xLabel="x" yLabel="f(x)" series={[
      { points: safeArr(snap.curve), color: c.series[0], label: 'f(x)', dots: false },
      { points: safeArr(snap.tangent), color: c.warning, label: '切线', dots: false, width: 1.5 },
      { points: safeArr(snap.pts), color: c.success, label: '迭代点', radius: 3 },
    ]} />;
}

// ───────────────────────────── 11. 凸优化 ─────────────────────────────
function convexBuild(p) {
  const objective = String(p.objective || 'bowl');
  const constrained = !!p.constrained;
  const iters = clamp(Math.round(num(p.iters, 14)), 12, 36);
  let x = clamp(num(p.x0, 2.4), -3, 3), y = clamp(num(p.y0, 2.4), -3, 3);
  const f = (a, b) => 0.5 * (a * a + (objective === 'ill' ? 12 * b * b : b * b));
  const feasible = (a, b) => !constrained || a + b <= 1;
  const frames = [];
  const push = (note, iter) => frames.push({
    objective, constrained, iter: num(iter), x, y, fx: f(x, y), feasible: feasible(x, y), note,
    metrics: { 迭代: num(iter), x: Number(x.toFixed(3)), y: Number(y.toFixed(3)), 目标值: Number(f(x, y).toFixed(3)), 可行: feasible(x, y) ? 1 : 0 },
  });
  for (let gy = 0; gy < 8; gy++) for (let gx = 0; gx < 8; gx++) {
    const a = -3 + (gx * 6) / 7, b = -3 + (gy * 6) / 7;
    push(`可行域扫描 (${fx(a, 1)}, ${fx(b, 1)})：f=${fx(f(a, b))}${feasible(a, b) ? '，可行' : '，违反约束'}。`, -1);
  }
  for (let it = 0; it < iters; it++) {
    const lr = 0.18;
    let nx = x - lr * x, ny = y - lr * (objective === 'ill' ? 12 * y : y);
    if (constrained && nx + ny > 1) { const s = (nx + ny - 1) / 2; nx -= s; ny -= s; }
    x = nx; y = ny;
    push(`投影梯度第 ${it + 1} 步：x=(${fx(x)}, ${fx(y)})，f=${fx(f(x, y))}${constrained ? '，投影回可行域' : ''}。`, it);
  }
  return framesOf(frames);
}
function convexRender(snap, p, c) {
  const items = [], curX = num(snap.x), curY = num(snap.y), step = 6 / 7;
  for (let gy = 0; gy < 8; gy++) for (let gx = 0; gx < 8; gx++) {
    const x = -3 + gx * step, y = -3 + gy * step;
    const v = 0.5 * (x * x + (snap.objective === 'ill' ? 12 * y * y : y * y));
    const feas = !snap.constrained || x + y <= 1;
    const near = Math.abs(x - curX) < step / 2 && Math.abs(y - curY) < step / 2;
    const lv = clamp(Math.floor(v / 3), 0, c.series.length - 1);
    items.push({
      text: `${fx(x, 1)},${fx(y, 1)}`, sub: feas ? fx(v, 1) : '不可行',
      color: near ? c.warning : feas ? c.series[lv] : c.border,
    });
  }
  return <Cells c={c} items={items} height={440} title="凸优化 · 可行域与等值线"
    subtitle={snap.note || ''} wrap={8} cellW={62} cellH={42} gap={5} x0={40} y0={50} />;
}

// ───────────────────────────── 12. 拉格朗日乘子 ─────────────────────────────
function lagrangeBuild(p) {
  const iters = clamp(Math.round(num(p.iters, 16)), 12, 36);
  let x = clamp(num(p.x0, -1), -3, 3);
  const contour = (level) => {
    const r = Math.sqrt(Math.max(0, level));
    return Array.from({ length: 49 }, (_, i) => {
      const a = (2 * Math.PI * i) / 48;
      return [1 + r * Math.cos(a), 2 + r * Math.sin(a)];
    });
  };
  const contours = [contour(0.5), contour(2), contour(6)];
  const constraint = [[-2, 6], [5, -1]];
  const frames = [];
  let path = [];
  const push = (note, lam) => frames.push({
    x, y: 4 - x, lam: num(lam), contours, constraint, path: path.slice(), note,
    metrics: { 迭代: frames.length - 12, x: Number(x.toFixed(3)), y: Number((4 - x).toFixed(3)), λ: Number(num(lam).toFixed(3)) },
  });
  for (let k = 0; k < 12; k++) {
    const gx = -2 + (k * 7) / 11;
    push(`约束线 x+y=4 上采样 (${fx(gx)}, ${fx(4 - gx)})，f=${fx((gx - 1) ** 2 + (2 - gx) ** 2)}。`, -2 * (gx - 1));
  }
  for (let it = 0; it < iters; it++) {
    x = x - 0.12 * (4 * x - 6);
    const lam = -2 * (x - 1);
    path.push([x, 4 - x]);
    push(`第 ${it + 1} 步：x=${fx(x)}, y=${fx(4 - x)}，λ=${fx(lam)}，∇f+λ∇g→0。`, lam);
  }
  return framesOf(frames);
}
function lagrangeRender(snap, p, c) {
  return <Curves c={c} height={360} title="拉格朗日乘子 · 可行域与等值线" subtitle={snap.note || ''}
    xLabel="x" yLabel="y" series={[
      { points: safeArr(snap.constraint), color: c.danger, label: '约束 x+y=4', dots: false, width: 2 },
      { points: safeArr(snap.contours)?.[0] || [], color: c.series[0], label: 'f=0.5', dots: false },
      { points: safeArr(snap.contours)?.[1] || [], color: c.series[1], label: 'f=2', dots: false },
      { points: safeArr(snap.contours)?.[2] || [], color: c.series[2], label: 'f=6', dots: false },
      { points: safeArr(snap.path), color: c.warning, label: '迭代点', radius: 3 },
    ]} />;
}

// ───────────────────────────── 13. MCMC ─────────────────────────────
function mcmcBuild(p) {
  const kind = String(p.target || 'bimodal');
  const step = clamp(num(p.step, 1), 0.1, 3);
  const seed = clamp(Math.round(num(p.seed, 9)), 1, 9999);
  const steps = clamp(Math.round(num(p.steps, 30)), 12, 80);
  const rnd = mulberry32(seed);
  const pdf = (x, y) => {
    if (kind === 'gauss') return Math.exp(-0.5 * (x * x + y * y));
    return 0.6 * Math.exp(-0.5 * ((x + 1.2) ** 2 + y * y))
      + 0.4 * Math.exp(-0.5 * ((x - 1.4) ** 2 + (y - 0.6) ** 2));
  };
  let x = (rnd() - 0.5) * 2, y = (rnd() - 0.5) * 2;
  const chain = [{ x, y, acc: true }];
  let accepted = 0;
  const frames = [];
  const push = (note, prop, acc) => frames.push({
    kind, chain: chain.slice(), x, y, prop: prop || { x, y }, acc: !!acc,
    accepted, rate: accepted / Math.max(1, chain.length - 1), note,
    metrics: { 步数: chain.length - 1, 提议: `(${fx(prop?.x, 2)}, ${fx(prop?.y, 2)})`, 接受: acc ? 1 : 0, 接受率: Number((accepted / Math.max(1, chain.length - 1)).toFixed(3)) },
  });
  for (let k = 0; k < 12; k++) {
    const gx = -3 + (k * 6) / 11;
    push(`目标密度扫描：x=${fx(gx)}，π(x,0)=${fx(pdf(gx, 0), 3)}；MH 用随机游走探索。`, { x: gx, y: 0 }, true);
  }
  for (let it = 0; it < steps; it++) {
    const px = x + (rnd() - 0.5) * 2 * step, py = y + (rnd() - 0.5) * 2 * step;
    const a = clamp(pdf(px, py) / Math.max(1e-9, pdf(x, y)), 0, 1);
    const acc = rnd() < a;
    if (acc) { x = px; y = py; accepted++; }
    chain.push({ x, y, acc });
    push(`第 ${it + 1} 步：提议 (${fx(px)}, ${fx(py)})，α=${fx(a, 3)}，${acc ? '接受' : '拒绝'}；累计接受率 ${fx(accepted / (it + 1), 3)}。`, { x: px, y: py }, acc);
  }
  return framesOf(frames);
}
function mcmcRender(snap, p, c) {
  const pts = safeArr(snap.chain).map((q) => ({ x: q.x, y: q.y, color: c.series[0], r: 2.6 }));
  pts.push({ x: num(snap.prop?.x), y: num(snap.prop?.y), color: snap.acc ? c.success : c.danger, r: 4.4 });
  const centers = snap.kind === 'gauss'
    ? [{ x: 0, y: 0, label: '峰值' }]
    : [{ x: -1.2, y: 0, label: '峰1' }, { x: 1.4, y: 0.6, label: '峰2' }];
  return <Scatter c={c} points={pts} centers={centers} height={360}
    title="MCMC · 随机游走与接受率" subtitle={snap.note || ''}
    bounds={{ xmin: -4, xmax: 4, ymin: -4, ymax: 4 }} />;
}

// ───────────────────────────── 14. 遗传算法 ─────────────────────────────
function gaBuild(p) {
  const pop = clamp(Math.round(num(p.pop, 12)), 8, 20);
  const gens = clamp(Math.round(num(p.gens, 18)), 12, 40);
  const mut = clamp(num(p.mut, 0.1), 0.01, 0.5);
  const seed = clamp(Math.round(num(p.seed, 5)), 1, 9999);
  const rnd = mulberry32(seed);
  const L = 10;
  const fit = (g) => {
    let v = 0;
    for (let i = 0; i < L; i++) if (g[i]) v++;
    if (g[0] && g[L - 1]) v += 2;
    return v;
  };
  let popu = Array.from({ length: pop }, () => Array.from({ length: L }, () => (rnd() < 0.5 ? 1 : 0)));
  const frames = [];
  const push = (note, gen, best) => {
    const fits = popu.map(fit);
    frames.push({
      pop, gen: num(gen), fits, genotyp: popu.map((g) => g.slice()), best: num(best, Math.max(...fits)), note,
      metrics: { 世代: num(gen), 个体数: pop, 最优适应度: Math.max(...fits), 平均适应度: Number((fits.reduce((a, b) => a + b, 0) / pop).toFixed(2)) },
    });
  };
  push('初始化种群：每个个体是 10 位二进制串，适应度含首尾协同奖励。', 0, 0);
  for (let i = 0; i < pop; i++) push(`个体 ${i + 1} 适应度 = ${fit(popu[i])}。`, 0, 0);
  for (let gen = 1; gen <= gens; gen++) {
    const fits = popu.map(fit);
    const pick = () => {
      let a = Math.floor(rnd() * pop), b = Math.floor(rnd() * pop);
      return fits[a] >= fits[b] ? popu[a].slice() : popu[b].slice();
    };
    const next = [];
    next.push(popu[fits.indexOf(Math.max(...fits))].slice());
    while (next.length < pop) {
      const p1 = pick(), p2 = pick(), cut = 1 + Math.floor(rnd() * (L - 1));
      const child = p1.slice(0, cut).concat(p2.slice(cut));
      for (let i = 0; i < L; i++) if (rnd() < mut) child[i] = child[i] ? 0 : 1;
      next.push(child);
    }
    popu = next;
    push(`第 ${gen} 代：选择-交叉-变异完成，最优适应度 = ${Math.max(...popu.map(fit))}。`, gen, Math.max(...popu.map(fit)));
  }
  return framesOf(frames);
}
function gaRender(snap, p, c) {
  const fits = safeArr(snap.fits), colors = {}, marks = {};
  const bestIdx = fits.indexOf(Math.max(...fits, 0));
  fits.forEach((_, i) => { if (i === bestIdx) colors[i] = c.success; marks[i] = `C${i + 1}`; });
  return <Bars c={c} values={fits} colors={colors} marks={marks} height={340}
    title="遗传算法 · 种群收敛" subtitle={snap.note || ''}
    baselineLabel={`世代 ${fx(snap.gen, 0)} · 绿柱为当前最优个体`} showValues={fits.length <= 20} />;
}

// ───────────────────────────── 15. 粒子群 ─────────────────────────────
function psoBuild(p) {
  const n = clamp(Math.round(num(p.n, 12)), 8, 20);
  const iters = clamp(Math.round(num(p.iters, 18)), 12, 40);
  const w = clamp(num(p.w, 0.7), 0.2, 1.2);
  const seed = clamp(Math.round(num(p.seed, 3)), 1, 9999);
  const rnd = mulberry32(seed);
  const f = (x, y) => x * x + y * y;
  let parts = Array.from({ length: n }, () => {
    const x = (rnd() - 0.5) * 6, y = (rnd() - 0.5) * 6;
    return { x, y, vx: (rnd() - 0.5), vy: (rnd() - 0.5), bx: x, by: y, bf: f(x, y) };
  });
  let g = parts.reduce((a, b) => (b.bf < a.bf ? b : a));
  const frames = [];
  const push = (note, iter) => frames.push({
    n, iter: num(iter), parts: parts.map((q) => ({ ...q })),
    g: { x: g.x, y: g.y, bf: g.bf }, note,
    metrics: { 迭代: num(iter), 粒子数: n, 全局最优: Number(g.bf.toFixed(4)), 惯性权重: w },
  });
  push('初始化粒子位置与速度，各自记住 pBest，群体共享 gBest。', 0);
  for (let i = 0; i < n; i++) push(`粒子 ${i + 1} 初始位置 (${fx(parts[i].x)}, ${fx(parts[i].y)})，f=${fx(parts[i].bf)}。`, 0);
  for (let it = 0; it < iters; it++) {
    parts.forEach((q) => {
      q.vx = w * q.vx + 1.4 * rnd() * (q.bx - q.x) + 1.4 * rnd() * (g.x - q.x);
      q.vy = w * q.vy + 1.4 * rnd() * (q.by - q.y) + 1.4 * rnd() * (g.y - q.y);
      q.vx = clamp(q.vx, -2, 2); q.vy = clamp(q.vy, -2, 2);
      q.x = clamp(q.x + q.vx, -4, 4); q.y = clamp(q.y + q.vy, -4, 4);
      const v = f(q.x, q.y);
      if (v < q.bf) { q.bf = v; q.bx = q.x; q.by = q.y; }
      if (v < g.bf) g = q;
    });
    push(`第 ${it + 1} 次更新：gBest=(${fx(g.x)}, ${fx(g.y)})，f=${fx(g.bf, 3)}。`, it + 1);
  }
  return framesOf(frames);
}
function psoRender(snap, p, c) {
  const points = safeArr(snap.parts).map((q) => ({
    x: q.x, y: q.y, color: c.series[0], r: 3.2,
  }));
  const centers = [{ x: num(snap.g?.x), y: num(snap.g?.y), label: 'gBest' }];
  return <Scatter c={c} points={points} centers={centers} height={360}
    title="粒子群优化 · 粒子收敛" subtitle={snap.note || ''}
    bounds={{ xmin: -4, xmax: 4, ymin: -4, ymax: 4 }} />;
}

// ───────────────────────────── 16. EM 算法 ─────────────────────────────
function emBuild(p) {
  const k = clamp(Math.round(num(p.k, 2)), 2, 3);
  const seed = clamp(Math.round(num(p.seed, 4)), 1, 9999);
  const iters = clamp(Math.round(num(p.iters, 10)), 8, 30);
  const rnd = mulberry32(seed);
  const N = 24;
  const data = Array.from({ length: N }, (_, i) => (i < N / 2 ? -2 : 2) + (rnd() - 0.5) * 1.6);
  let means = k === 2 ? [-2.2, 2.2] : [-2.2, 0, 2.2];
  let vars = Array.from({ length: k }, () => 1.2);
  const weights = Array.from({ length: k }, () => 1 / k);
  const frames = [];
  const resp = (x) => {
    const w = means.map((m, j) => weights[j] * Math.exp(-((x - m) ** 2) / (2 * vars[j])) / Math.sqrt(2 * Math.PI * vars[j]));
    const sm = w.reduce((a, b) => a + b, 0);
    return w.map((v) => v / Math.max(1e-12, sm));
  };
  const loglik = () => data.reduce((acc, x) => {
    const w = means.map((m, j) => weights[j] * Math.exp(-((x - m) ** 2) / (2 * vars[j])) / Math.sqrt(2 * Math.PI * vars[j]));
    return acc + Math.log(Math.max(1e-12, w.reduce((a, b) => a + b, 0)));
  }, 0);
  const push = (note, iter, ll) => frames.push({
    k, N, data: data.slice(), means: means.slice(), vars: vars.slice(),
    gamma: data.map(resp), ll: num(ll), iter: num(iter), note,
    metrics: { 迭代: num(iter), 分量数: k, 对数似然: Number(num(ll).toFixed(3)), μ1: Number(means[0].toFixed(3)), μ2: Number(means[1].toFixed(3)) },
  });
  for (let i = 0; i < N; i++) push(`样本 ${i + 1}：x=${fx(data[i])}，初始责任 γ₁=${fx(resp(data[i])[0], 3)}。`, 0, loglik());
  for (let it = 0; it < iters; it++) {
    const G = data.map(resp);
    const Nk = Array.from({ length: k }, (_, j) => G.reduce((a, r) => a + r[j], 0));
    means = means.map((_, j) => G.reduce((a, r, i) => a + r[j] * data[i], 0) / Math.max(1e-9, Nk[j]));
    vars = vars.map((_, j) => clamp(G.reduce((a, r, i) => a + r[j] * (data[i] - means[j]) ** 2, 0) / Math.max(1e-9, Nk[j]), 0.05, 20));
    push(`第 ${it + 1} 轮 M 步：更新 μ=[${means.map((m) => fx(m)).join(', ')}]，对数似然 ${fx(loglik(), 3)}。`, it + 1, loglik());
  }
  return framesOf(frames);
}
function emRender(snap, p, c) {
  const gamma = safeArr(snap.gamma), colors = {}, marks = {}, vals = [];
  gamma.forEach((row, i) => {
    const g = safeArr(row);
    vals.push(num(g[0]));
    let best = 0;
    for (let j = 1; j < g.length; j++) if (num(g[j]) > num(g[best])) best = j;
    colors[i] = c.series[best % c.series.length];
    marks[i] = String(i + 1);
  });
  return <Bars c={c} values={vals} colors={colors} marks={marks} height={340}
    title="EM 算法 · 隐变量责任与似然上升" subtitle={snap.note || ''}
    baselineLabel={`迭代 ${fx(snap.iter, 0)} · log L=${fx(snap.ll, 3)} · 柱高=γ(属于分量1)`} />;
}

// ───────────────────────────── 17. 贝叶斯推断 ─────────────────────────────
function bayesBuild(p) {
  const prior = String(p.prior || 'uniform');
  const n = clamp(Math.round(num(p.n, 10)), 2, 20);
  const succ = Math.min(clamp(Math.round(num(p.s, 6)), 0, 20), n);
  const a0 = prior === 'favorYes' ? 4 : prior === 'favorNo' ? 1 : 1;
  const b0 = prior === 'favorYes' ? 1 : prior === 'favorNo' ? 4 : 1;
  const grid = Array.from({ length: 51 }, (_, i) => i / 50);
  const raw = (t, al, be) => Math.pow(Math.max(1e-9, t), al - 1) * Math.pow(Math.max(1e-9, 1 - t), be - 1);
  const norm = (al, be) => {
    const w = grid.map((t) => raw(t, al, be));
    const sm = w.reduce((a, b) => a + b, 0);
    return w.map((v) => v / Math.max(1e-12, sm));
  };
  const priorCurve = norm(a0, b0);
  const frames = [];
  let a = a0, b = b0, postCurve = priorCurve.slice();
  const push = (note, seen, sSeen) => frames.push({
    grid, priorCurve: priorCurve.slice(), postCurve: postCurve.slice(), seen: num(seen), sSeen: num(sSeen),
    note,
    metrics: { 试验数: num(seen), 成功数: num(sSeen), α: a, β: b, 后验均值: Number((a / (a + b)).toFixed(3)) },
  });
  for (let k = 0; k < 20; k++) push(`先验扫描 θ=${fx(grid[k])}：p(θ)=${fx(priorCurve[k], 4)}；将用 ${n} 次试验更新。`, 0, 0);
  for (let t = 1; t <= n; t++) {
    const sSeen = Math.round((succ * t) / n);
    a = a0 + sSeen; b = b0 + t - sSeen;
    postCurve = norm(a, b);
    push(`第 ${t} 次：观测${t - sSeen < sSeen ? '成功' : '失败'}，后验 Beta(${a}, ${b})，均值 ${fx(a / (a + b), 3)}。`, t, sSeen);
  }
  return framesOf(frames);
}
function bayesRender(snap, p, c) {
  const grid = safeArr(snap.grid);
  return <Curves c={c} height={340} title="贝叶斯推断 · 先验到后验" subtitle={snap.note || ''}
    xLabel="θ" yLabel="密度" series={[
      { points: grid.map((t, i) => [t, num(snap.priorCurve?.[i])]), color: c.series[1], label: '先验', dots: false },
      { points: grid.map((t, i) => [t, num(snap.postCurve?.[i])]), color: c.series[0], label: '后验', dots: false },
    ]} />;
}

// ───────────────────────────── 18. 马尔可夫链 ─────────────────────────────
function markovBuild(p) {
  const S = clamp(Math.round(num(p.S, 4)), 3, 6);
  const steps = clamp(Math.round(num(p.steps, 20)), 8, 40);
  const seed = clamp(Math.round(num(p.seed, 6)), 1, 9999);
  const rnd = mulberry32(seed);
  const P = Array.from({ length: S }, () => {
    const row = Array.from({ length: S }, () => rnd() + 0.1);
    const sm = row.reduce((a, b) => a + b, 0);
    return row.map((v) => v / sm);
  });
  let dist = Array.from({ length: S }, (_, i) => (i === 0 ? 1 : 0));
  const chain = [], frames = [];
  const push = (note, t) => frames.push({
    S, P: P.map((r) => r.slice()), dist: dist.slice(), chain: chain.slice(), t: num(t), note,
    metrics: { 步数: num(t), 状态数: S, 最可能状态: dist.indexOf(Math.max(...dist)), 稳态误差: Number(Math.max(...dist.map((v, i) => Math.abs(v - 1 / S))).toFixed(3)) },
  });
  for (let k = 0; k < 12; k++) push(`转移矩阵第 ${k % S + 1} 行：行和恒为 1，描述从该状态出发的概率。`, k % S);
  for (let t = 0; t < steps; t++) {
    const next = Array.from({ length: S }, (_, j) => dist.reduce((a, v, i) => a + v * P[i][j], 0));
    dist = next;
    let u = rnd(), idx = 0;
    while (idx < S - 1 && u > next[idx]) { u -= next[idx]; idx++; }
    chain.push(idx);
    push(`第 ${t + 1} 步：π=[${next.map((v) => fx(v, 2)).join(', ')}]，采样状态 S${idx}。`, t + 1);
  }
  return framesOf(frames);
}
function markovRender(snap, p, c) {
  const P = safeArr(snap.P), S = num(snap.S, 4);
  const chain = safeArr(snap.chain), cur = chain.length ? chain[chain.length - 1] : 0;
  const highlight = [{ r: clamp(cur, 0, S - 1), c: clamp(num(snap.t) % S, 0, S - 1), state: 'active' }];
  const path = chain.slice(-S).map((v, i) => ({ r: clamp(v, 0, S - 1), c: i % S }));
  return <Matrix c={c} table={P} highlight={highlight} path={path} height={360}
    rowLabels={Array.from({ length: S }, (_, i) => `S${i}`)} colLabels={Array.from({ length: S }, (_, i) => `S${i}`)}
    title="马尔可夫链 · 转移矩阵与稳态" subtitle={snap.note || ''} cell={34} x0={70} y0={56} />;
}

// ───────────────────────────── 19. HMM ─────────────────────────────
function hmmBuild(p) {
  const S = clamp(Math.round(num(p.S, 3)), 3, 5);
  const T = clamp(Math.round(num(p.T, 10)), 6, 20);
  const seed = clamp(Math.round(num(p.seed, 8)), 1, 9999);
  const rnd = mulberry32(seed);
  const stoch = (rows, cols) => Array.from({ length: rows }, () => {
    const row = Array.from({ length: cols }, () => rnd() + 0.05);
    const sm = row.reduce((a, b) => a + b, 0);
    return row.map((v) => v / sm);
  });
  const A = stoch(S, S), B = stoch(S, 3);
  const obs = Array.from({ length: T }, () => Math.floor(rnd() * 3));
  const hidden = [];
  let st = 0;
  for (let t = 0; t < T; t++) {
    hidden.push(st);
    let u = rnd(), j = 0;
    while (j < S - 1 && u > A[st][j]) { u -= A[st][j]; j++; }
    st = j;
  }
  let alpha = Array.from({ length: S }, (_, i) => (i === 0 ? 1 : 0) * B[i][obs[0]]);
  const frames = [];
  const push = (note, t) => frames.push({
    S, T, A: A.map((r) => r.slice()), B: B.map((r) => r.slice()), obs: obs.slice(), hidden: hidden.slice(),
    alpha: alpha.slice(), t: num(t), note,
    metrics: { 观测步: num(t), 状态数: S, 观测符号: obs[Math.max(0, Math.min(T - 1, num(t)))], 前向概率和: Number(alpha.reduce((a, b) => a + b, 0).toFixed(4)) },
  });
  for (let i = 0; i < S; i++) push(`发射矩阵第 ${i} 行：隐藏态 S${i} 生成符号 0/1/2 的概率。`, 0);
  for (let j = 0; j < S; j++) push(`转移矩阵第 ${j} 行：从 S${j} 出发的转移概率，行和为 1。`, 0);
  for (let t = 0; t < T; t++) {
    if (t > 0) alpha = Array.from({ length: S }, (_, j) => {
      const sm = alpha.reduce((a, v, i) => a + v * A[i][j], 0);
      return sm * B[j][obs[t]];
    });
    push(`t=${t + 1}：观测 O${t}=${obs[t]}，前向概率 α=[${alpha.map((v) => fx(v, 3)).join(', ')}]。`, t + 1);
  }
  return framesOf(frames);
}
function hmmRender(snap, p, c) {
  const A = safeArr(snap.A), S = num(snap.S, 3), hidden = safeArr(snap.hidden), t = num(snap.t);
  const from = hidden[Math.max(0, t - 1)] ?? 0, to = hidden[t] ?? 0;
  const highlight = [{ r: clamp(from, 0, S - 1), c: clamp(to, 0, S - 1), state: 'active' }];
  const path = hidden.slice(-S).map((v, i) => ({ r: clamp(v, 0, S - 1), c: i % S }));
  return <Matrix c={c} table={A} highlight={highlight} path={path} height={360}
    rowLabels={Array.from({ length: S }, (_, i) => `S${i}`)} colLabels={Array.from({ length: S }, (_, i) => `S${i}`)}
    title="HMM · 转移矩阵与状态序列" subtitle={snap.note || ''} cell={34} x0={70} y0={56} />;
}

// ───────────────────────────── 20. 维特比解码 ─────────────────────────────
function viterbiBuild(p) {
  const S = clamp(Math.round(num(p.S, 3)), 3, 5);
  const T = clamp(Math.round(num(p.T, 10)), 6, 20);
  const seed = clamp(Math.round(num(p.seed, 7)), 1, 9999);
  const rnd = mulberry32(seed);
  const stoch = (rows, cols) => Array.from({ length: rows }, () => {
    const row = Array.from({ length: cols }, () => rnd() + 0.05);
    const sm = row.reduce((a, b) => a + b, 0);
    return row.map((v) => v / sm);
  });
  const A = stoch(S, S), B = stoch(S, 3);
  const obs = Array.from({ length: T }, () => Math.floor(rnd() * 3));
  const delta = [], psi = [];
  delta.push(Array.from({ length: S }, (_, j) => (1 / S) * B[j][obs[0]]));
  psi.push(Array.from({ length: S }, () => -1));
  for (let t = 1; t < T; t++) {
    const row = [], back = [];
    for (let j = 0; j < S; j++) {
      let best = -1, bi = 0;
      for (let i = 0; i < S; i++) {
        const v = delta[t - 1][i] * A[i][j];
        if (v > best) { best = v; bi = i; }
      }
      row.push(Math.max(1e-12, best * B[j][obs[t]]));
      back.push(bi);
    }
    delta.push(row); psi.push(back);
  }
  let last = 0;
  for (let j = 1; j < S; j++) if (delta[T - 1][j] > delta[T - 1][last]) last = j;
  const bestPath = Array.from({ length: T }, () => 0);
  bestPath[T - 1] = last;
  for (let t = T - 1; t >= 1; t--) bestPath[t - 1] = psi[t][bestPath[t]];
  const frames = [];
  const show = (t) => delta.slice(0, t + 1).map((r) => r.slice());
  const push = (note, t) => frames.push({
    S, T, A: A.map((r) => r.slice()), B: B.map((r) => r.slice()), obs: obs.slice(),
    delta: show(t), bestPath: bestPath.slice(), t: num(t), note,
    metrics: { 时间步: num(t), 状态数: S, 观测: obs[Math.max(0, Math.min(T - 1, num(t)))], 最优路径概率: Number(delta[Math.max(0, Math.min(T - 1, num(t)))][bestPath[Math.max(0, Math.min(T - 1, num(t)))]].toFixed(5)) },
  });
  for (let i = 0; i < S; i++) push(`初始化 δ₁(S${i}) = π(S${i})·b_i(O₀)。`, 0);
  for (let t = 0; t < T; t++) push(`观测序列 O${t}=${obs[t]}，准备递推。`, 0);
  for (let t = 0; t < T; t++) {
    const col = delta[t].map((v, j) => `S${j}:${fx(v, 4)}`).join(' ');
    push(`维特比 t=${t + 1}：δ=[${col}]，保留每状态最佳前驱。`, t);
  }
  return framesOf(frames);
}
function viterbiRender(snap, p, c) {
  const delta = safeArr(snap.delta), S = num(snap.S, 3), path = safeArr(snap.bestPath);
  const table = Array.from({ length: S }, (_, j) => delta.map((row) => num(row?.[j])));
  const t = clamp(num(snap.t), 0, Math.max(0, delta.length - 1));
  const highlight = Array.from({ length: S }, (_, j) => ({ r: j, c: t, state: 'active' }));
  const bestCells = path.slice(0, delta.length).map((v, i) => ({ r: clamp(v, 0, S - 1), c: i, state: 'done' }));
  return <Matrix c={c} table={table} highlight={bestCells.concat(highlight)} height={380}
    rowLabels={Array.from({ length: S }, (_, i) => `S${i}`)} colLabels={delta.map((_, i) => String(i))}
    title="维特比解码 · DP 表与最优路径" subtitle={snap.note || ''} cell={30} x0={70} y0={56} />;
}

// ───────────────────────────── 21. 差分隐私 ─────────────────────────────
function dpBuild(p) {
  const eps = clamp(num(p.eps, 1), 0.1, 5);
  const queries = clamp(Math.round(num(p.queries, 10)), 5, 20);
  const seed = clamp(Math.round(num(p.seed, 2)), 1, 9999);
  const rnd = mulberry32(seed);
  const scale = 1 / eps;
  const truth = Array.from({ length: queries }, (_, i) => 10 + i * 3);
  const laplace = () => {
    let u = rnd() - 0.5;
    if (Math.abs(u) < 1e-9) u = 1e-9;
    return -scale * Math.sign(u) * Math.log(Math.max(1e-9, 1 - 2 * Math.abs(u)));
  };
  const noisy = truth.map((v) => v + laplace());
  const frames = [];
  const push = (note, idx, val) => frames.push({
    eps, queries, truth: truth.slice(), noisy: noisy.slice(), idx: num(idx), val: num(val),
    note,
    metrics: { ε: eps, 查询数: queries, 噪声尺度: Number(scale.toFixed(3)), 本轮噪声: Number((num(val) - (truth[Math.max(0, idx)] || 0)).toFixed(3)) },
  });
  for (let k = 0; k < 15; k++) {
    const nz = laplace();
    push(`噪声机制演示 ${k + 1}：Lap(0, ${fx(scale, 2)}) 抽样得到 ${fx(nz, 3)}；ε 越小噪声越大。`, -1, truth[0] + nz);
  }
  for (let i = 0; i < queries; i++) push(`查询 ${i + 1}：真值 ${truth[i]} → 加噪回答 ${fx(noisy[i], 3)}。`, i, noisy[i]);
  return framesOf(frames);
}
function dpRender(snap, p, c) {
  const truth = safeArr(snap.truth), noisy = safeArr(snap.noisy), colors = {}, marks = {}, vals = [];
  truth.forEach((v, i) => { vals.push(num(v)); colors[i] = c.series[0]; marks[i] = `T${i + 1}`; });
  noisy.forEach((v, i) => {
    const j = truth.length + i;
    vals.push(num(v)); colors[j] = c.series[1]; marks[j] = `Ñ${i + 1}`;
  });
  const err = noisy.reduce((a, v, i) => a + Math.abs(num(v) - num(truth[i])), 0) / Math.max(1, noisy.length);
  return <Bars c={c} values={vals} colors={colors} marks={marks} height={340}
    title="差分隐私 · 噪声注入" subtitle={snap.note || ''}
    baselineLabel={`ε=${fx(snap.eps, 2)} · 蓝=真值 红=加噪回答 · 平均误差 ${fx(err, 2)}`} showValues={vals.length <= 16} />;
}

// ───────────────────────────── 22. 联邦学习 ─────────────────────────────
function flBuild(p) {
  const clients = clamp(Math.round(num(p.clients, 5)), 4, 8);
  const rounds = clamp(Math.round(num(p.rounds, 12)), 6, 25);
  const seed = clamp(Math.round(num(p.seed, 11)), 1, 9999);
  const lr = clamp(num(p.lr, 0.3), 0.05, 1);
  const rnd = mulberry32(seed);
  const acc = Array.from({ length: clients }, () => 0.2 + rnd() * 0.18);
  const avg = () => acc.reduce((a, b) => a + b, 0) / clients;
  const frames = [];
  const push = (note, round, client) => frames.push({
    clients, round: num(round), client: num(client), acc: acc.slice(), globalAcc: avg(), note,
    metrics: { 通信轮次: num(round), 客户端数: clients, 全局准确率: Number(avg().toFixed(4)), 本地训练端: num(client) < 0 ? '聚合' : num(client) + 1 },
  });
  push(`启动 ${clients} 个客户端：原始数据留在本地，仅上传模型更新。`, 0, -1);
  for (let i = 0; i < clients; i++) push(`客户端 ${i + 1} 初始本地准确率 ${fx(acc[i], 3)}。`, 0, -1);
  for (let r = 1; r <= rounds; r++) {
    for (let i = 0; i < clients; i++) {
      acc[i] = clamp(acc[i] + lr * (0.93 - acc[i]) * (0.5 + 0.5 * rnd()), 0, 0.99);
      push(`第 ${r} 轮 · 客户端 ${i + 1} 本地训练：本地准确率 ${fx(acc[i], 3)}。`, r, i);
    }
    push(`第 ${r} 轮聚合：FedAvg 平均模型更新，全局准确率 ${fx(avg(), 3)}。`, r, -1);
  }
  return framesOf(frames);
}
function flRender(snap, p, c) {
  const acc = safeArr(snap.acc), colors = {}, marks = {};
  acc.forEach((_, i) => {
    colors[i] = i === num(snap.client) ? c.warning : c.series[0];
    marks[i] = `C${i + 1}`;
  });
  return <Bars c={c} values={acc} colors={colors} marks={marks} height={340}
    title="联邦学习 · 本地轮次与聚合" subtitle={snap.note || ''}
    baselineLabel={`轮次 ${fx(snap.round, 0)} · 全局准确率 ${fx(snap.globalAcc, 3)} · 黄柱为本地训练端`} />;
}

export default {
  'euclidean-gcd': {
    params: [
      { key: 'a', label: '被除数 a', type: 'range', min: 12, max: 999999, step: 1, default: 6765 },
      { key: 'b', label: '除数 b', type: 'range', min: 1, max: 99999, step: 1, default: 4181 },
    ],
    height: 360,
    legend: [{ label: '余数序列' }, { label: '当前相除' }, { label: '最大公约数' }, { label: '整除验证' }],
    hint: '反复用 a = b·q + r 取代 (a,b)，余数序列最后一个非零余数就是最大公约数；右侧每帧验证一个候选因子。',
    buildSteps: gcdBuild, render: gcdRender,
  },
  'sieve-eratosthenes': {
    params: [
      { key: 'N', label: '筛选上界 N', type: 'range', min: 40, max: 220, step: 1, default: 80 },
      { key: 'mode', label: '筛选方式', type: 'select', options: [{ value: 'full', label: '全部整数' }, { value: 'odd', label: '仅奇数优化' }], default: 'full' },
    ],
    height: 480,
    legend: [{ label: '素数候选' }, { label: '当前划掉的倍数' }, { label: '已确认合数' }],
    hint: '从 p=2 起，把每个素数的倍数从 p² 开始划掉；剩下的就是素数，复杂度 O(n log log n)。',
    buildSteps: sieveBuild, render: sieveRender,
  },
  'modular-exponentiation': {
    params: [
      { key: 'base', label: '底数', type: 'range', min: 2, max: 99, step: 1, default: 7 },
      { key: 'exp', label: '指数', type: 'range', min: 1, max: 65535, step: 1, default: 365 },
      { key: 'mod', label: '模数', type: 'range', min: 7, max: 10000, step: 1, default: 101 },
    ],
    height: 340,
    legend: [{ label: '二进制位' }, { label: '已处理位' }, { label: '当前平方幂' }, { label: '累乘结果 res' }],
    hint: '把指数写成二进制，逐位平方、遇 1 累乘，把 O(exp) 次乘法降到 O(log exp)。',
    buildSteps: modExpBuild, render: modExpRender,
  },
  'primality-miller-rabin': {
    params: [
      { key: 'n', label: '被测整数 n', type: 'range', min: 9, max: 100000, step: 2, default: 561 },
      { key: 'rounds', label: '底数轮数', type: 'range', min: 2, max: 10, step: 1, default: 6 },
    ],
    height: 340,
    legend: [{ label: '平方链' }, { label: '当前底数' }, { label: '合数见证' }, { label: '小因子检查' }],
    hint: '把 n−1 写成 d·2^s，对每个底数计算 a^d, a^(2d)…；若出现 −1 则通过，否则该底数是合数见证。',
    buildSteps: millerBuild, render: millerRender,
  },
  'diffie-hellman': {
    params: [
      { key: 'p', label: '公开素数 p', type: 'select', options: [{ value: 23, label: '23' }, { value: 97, label: '97' }, { value: 197, label: '197' }, { value: 1009, label: '1009' }], default: 97 },
      { key: 'g', label: '生成元 g', type: 'range', min: 2, max: 20, step: 1, default: 5 },
      { key: 'a', label: 'Alice 私钥 a', type: 'range', min: 2, max: 60, step: 1, default: 11 },
      { key: 'b', label: 'Bob 私钥 b', type: 'range', min: 2, max: 60, step: 1, default: 23 },
    ],
    height: 340,
    legend: [{ label: '公开参数' }, { label: 'A / B' }, { label: '双方共享密钥' }, { label: '一致性校验' }],
    hint: '双方只交换 A=g^a 与 B=g^b，各自算出 s=B^a=A^b；离散对数难解使窃听者无法恢复 a、b。',
    buildSteps: dhBuild, render: dhRender,
  },
  'crc-checksum': {
    params: [
      { key: 'poly', label: '生成多项式', type: 'select', options: [{ value: 'CRC-8 / 0x07', label: 'CRC-8 (0x07)' }, { value: 'CRC-8 / 0x83', label: 'CRC-8 (0x83)' }, { value: 'CRC-16 / 0x1021', label: 'CRC-16 (0x1021)' }], default: 'CRC-8 / 0x07' },
      { key: 'msg', label: '信息比特串', type: 'select', options: [{ value: '1101010101', label: '1101010101' }, { value: '100100111010', label: '100100111010' }, { value: '101100101101', label: '101100101101' }], default: '1101010101' },
      { key: 'init', label: '寄存器初值全 1', type: 'toggle', default: false },
    ],
    height: 330,
    legend: [{ label: '寄存器比特' }, { label: '当前输入位' }, { label: '异或多项式' }],
    hint: '每个输入位先检查寄存器最高位：为 1 则移位后异或生成多项式，为 0 则只移位；最终寄存器即校验码。',
    buildSteps: crcBuild, render: crcRender,
  },
  'fast-fourier-transform': {
    params: [
      { key: 'n', label: '变换点数', type: 'select', options: [{ value: 8, label: '8 点' }, { value: 16, label: '16 点' }, { value: 32, label: '32 点' }], default: 16 },
      { key: 'signal', label: '输入信号', type: 'select', options: [{ value: 'sine', label: '正弦叠加' }, { value: 'pulse', label: '单脉冲' }, { value: 'chirp', label: '线性调频' }], default: 'sine' },
      { key: 'seed', label: '随机种子', type: 'range', min: 1, max: 9999, step: 1, default: 7 },
    ],
    height: 340,
    legend: [{ label: '频域幅值 |X[k]|' }, { label: '蝶形左支' }, { label: '蝶形右支' }],
    hint: '位反转后按层合并：每对蝶形用旋转因子 W 结合，把 DFT 从 O(n²) 降到 O(n log n)。',
    buildSteps: fftBuild, render: fftRender,
  },
  'binary-answer': {
    params: [
      { key: 'target', label: '目标值', type: 'range', min: 16, max: 100000, step: 1, default: 1024 },
      { key: 'mode', label: '判定函数', type: 'select', options: [{ value: 'sqrt', label: 'x²≤目标' }, { value: 'cube', label: 'x³≤目标' }], default: 'sqrt' },
    ],
    height: 360,
    legend: [{ label: '当前可行区间' }, { label: '探测点（真=绿，假=红）' }],
    hint: '判定函数 f(x)=(x²≤target) 关于 x 单调：每次取中点折半，最后落在最大的可行整数上。',
    buildSteps: binaryBuild, render: binaryRender,
  },
  'ternary-search': {
    params: [
      { key: 'fn', label: '单峰函数', type: 'select', options: [{ value: 'quad', label: '二次函数' }, { value: 'abs', label: '带扰动绝对值' }], default: 'quad' },
      { key: 'left', label: '区间左端', type: 'range', min: -20, max: -1, step: 1, default: -5 },
      { key: 'right', label: '区间右端', type: 'range', min: 1, max: 20, step: 1, default: 5 },
      { key: 'iters', label: '迭代次数', type: 'range', min: 12, max: 40, step: 1, default: 16 },
    ],
    height: 380,
    legend: [{ label: '保留区间' }, { label: '舍弃部分' }],
    hint: '在单峰区间取两个三分点 m1<m2，比较 f(m1) 与 f(m2) 后丢掉一段，逐步逼近极值点。',
    buildSteps: ternaryBuild, render: ternaryRender,
  },
  'newton-method': {
    params: [
      { key: 'fn', label: '目标方程', type: 'select', options: [{ value: 'x²−2', label: 'x²−2=0' }, { value: 'x³−2x+2', label: 'x³−2x+2=0' }, { value: 'cos x−x', label: 'cos x−x=0' }], default: 'x²−2' },
      { key: 'x0', label: '初始值 x₀', type: 'range', min: -3, max: 3, step: 0.1, default: 3 },
      { key: 'iters', label: '迭代次数', type: 'range', min: 12, max: 40, step: 1, default: 16 },
    ],
    height: 360,
    legend: [{ label: '目标函数 f(x)' }, { label: '当前切线' }, { label: '迭代落点' }],
    hint: '用切线与 x 轴的交点作为下一个近似：x←x−f(x)/f′(x)，在根附近呈平方收敛。',
    buildSteps: newtonBuild, render: newtonRender,
  },
  'convex-optimization': {
    params: [
      { key: 'objective', label: '目标函数', type: 'select', options: [{ value: 'bowl', label: '标准二次碗' }, { value: 'ill', label: '病态椭圆' }], default: 'bowl' },
      { key: 'constrained', label: '启用线性约束 x+y≤1', type: 'toggle', default: true },
      { key: 'iters', label: '迭代次数', type: 'range', min: 12, max: 36, step: 1, default: 14 },
      { key: 'x0', label: '起点 x₀', type: 'range', min: -3, max: 3, step: 0.1, default: 2.4 },
      { key: 'y0', label: '起点 y₀', type: 'range', min: -3, max: 3, step: 0.1, default: 2.4 },
    ],
    height: 440,
    legend: [{ label: '可行区域' }, { label: '不可行区域' }, { label: '等值线层级' }, { label: '当前迭代点' }],
    hint: '凸目标加凸约束时局部最优即全局最优；每步沿梯度下降，再投影回可行域。',
    buildSteps: convexBuild, render: convexRender,
  },
  'lagrange-multiplier': {
    params: [
      { key: 'x0', label: '起点 x₀', type: 'range', min: -3, max: 3, step: 0.1, default: -1 },
      { key: 'iters', label: '迭代次数', type: 'range', min: 12, max: 36, step: 1, default: 16 },
    ],
    height: 360,
    legend: [{ label: '约束直线 x+y=4' }, { label: '目标等值线' }, { label: '迭代点' }],
    hint: '把等式约束并入目标：∇f+λ∇g=0。等值线与约束相切处就是带约束最优解，λ 衡量约束的边际代价。',
    buildSteps: lagrangeBuild, render: lagrangeRender,
  },
  'mcmc': {
    params: [
      { key: 'target', label: '目标分布', type: 'select', options: [{ value: 'bimodal', label: '双峰混合' }, { value: 'gauss', label: '标准正态' }], default: 'bimodal' },
      { key: 'step', label: '提议步长', type: 'range', min: 0.1, max: 3, step: 0.1, default: 1 },
      { key: 'steps', label: '采样步数', type: 'range', min: 12, max: 80, step: 1, default: 30 },
      { key: 'seed', label: '随机种子', type: 'range', min: 1, max: 9999, step: 1, default: 9 },
    ],
    height: 360,
    legend: [{ label: '接受的样本' }, { label: '当前提议' }, { label: '目标分布峰位' }],
    hint: 'Metropolis-Hastings：以 α=min(1, π(新)/π(旧)) 接受随机游走提议；步长过大接受率低，过小混合慢。',
    buildSteps: mcmcBuild, render: mcmcRender,
  },
  'genetic-algorithm': {
    params: [
      { key: 'pop', label: '种群规模', type: 'range', min: 8, max: 20, step: 1, default: 12 },
      { key: 'gens', label: '进化代数', type: 'range', min: 12, max: 40, step: 1, default: 18 },
      { key: 'mut', label: '变异概率', type: 'range', min: 0.01, max: 0.5, step: 0.01, default: 0.1 },
      { key: 'seed', label: '随机种子', type: 'range', min: 1, max: 9999, step: 1, default: 5 },
    ],
    height: 340,
    legend: [{ label: '个体适应度' }, { label: '当前最优个体' }],
    hint: '每代按适应度选择父代，交叉重组并随机变异，用精英保留维持最优；种群逐步向高适应度收敛。',
    buildSteps: gaBuild, render: gaRender,
  },
  'particle-swarm': {
    params: [
      { key: 'n', label: '粒子数', type: 'range', min: 8, max: 20, step: 1, default: 12 },
      { key: 'iters', label: '迭代次数', type: 'range', min: 12, max: 40, step: 1, default: 18 },
      { key: 'w', label: '惯性权重', type: 'range', min: 0.2, max: 1.2, step: 0.1, default: 0.7 },
      { key: 'seed', label: '随机种子', type: 'range', min: 1, max: 9999, step: 1, default: 3 },
    ],
    height: 360,
    legend: [{ label: '粒子位置' }, { label: '群体最优 gBest' }],
    hint: '速度由惯性、个体历史最优 pBest 与群体最优 gBest 三项合成；粒子在Sphere函数上聚集到原点。',
    buildSteps: psoBuild, render: psoRender,
  },
  'em-algorithm': {
    params: [
      { key: 'k', label: '高斯分量数', type: 'select', options: [{ value: 2, label: '2 个分量' }, { value: 3, label: '3 个分量' }], default: 2 },
      { key: 'iters', label: '迭代次数', type: 'range', min: 8, max: 30, step: 1, default: 10 },
      { key: 'seed', label: '随机种子', type: 'range', min: 1, max: 9999, step: 1, default: 4 },
    ],
    height: 340,
    legend: [{ label: '样本属于分量1的责任 γ' }, { label: '样本所属分量（按颜色）' }],
    hint: 'E 步用当前参数算隐变量后验责任 γ，M 步用 γ 加权更新均值与方差；对数似然单调不减。',
    buildSteps: emBuild, render: emRender,
  },
  'bayes-inference': {
    params: [
      { key: 'prior', label: '先验分布', type: 'select', options: [{ value: 'uniform', label: '均匀 Beta(1,1)' }, { value: 'favorYes', label: '偏成功 Beta(4,1)' }, { value: 'favorNo', label: '偏失败 Beta(1,4)' }], default: 'uniform' },
      { key: 'n', label: '试验次数', type: 'range', min: 2, max: 20, step: 1, default: 10 },
      { key: 's', label: '成功次数', type: 'range', min: 0, max: 20, step: 1, default: 6 },
    ],
    height: 340,
    legend: [{ label: '先验分布' }, { label: '后验分布' }],
    hint: 'Beta 先验与二项似然共轭：每观察一次成功 α+1、失败 β+1，后验曲线越来越尖，不确定性下降。',
    buildSteps: bayesBuild, render: bayesRender,
  },
  'markov-chain': {
    params: [
      { key: 'S', label: '状态数', type: 'range', min: 3, max: 6, step: 1, default: 4 },
      { key: 'steps', label: '演化步数', type: 'range', min: 8, max: 40, step: 1, default: 20 },
      { key: 'seed', label: '随机种子', type: 'range', min: 1, max: 9999, step: 1, default: 6 },
    ],
    height: 360,
    legend: [{ label: '转移概率矩阵 P' }, { label: '当前行（高亮）' }, { label: '采样状态路径' }],
    hint: '下一状态只依赖当前状态：π_{t+1}=π_t P。反复相乘后分布趋于稳态，与初始分布无关。',
    buildSteps: markovBuild, render: markovRender,
  },
  'hmm': {
    params: [
      { key: 'S', label: '隐藏状态数', type: 'range', min: 3, max: 5, step: 1, default: 3 },
      { key: 'T', label: '观测序列长度', type: 'range', min: 6, max: 20, step: 1, default: 10 },
      { key: 'seed', label: '随机种子', type: 'range', min: 1, max: 9999, step: 1, default: 8 },
    ],
    height: 360,
    legend: [{ label: '转移矩阵 A' }, { label: '当前转移（高亮）' }, { label: '隐藏状态序列' }],
    hint: '隐藏状态按 A 演化，再按发射矩阵 B 生成观测；前向算法 α_t(j)=Σ_i α_{t−1}(i)A_ij·b_j(O_t) 递推似然。',
    buildSteps: hmmBuild, render: hmmRender,
  },
  'viterbi': {
    params: [
      { key: 'S', label: '状态数', type: 'range', min: 3, max: 5, step: 1, default: 3 },
      { key: 'T', label: '观测长度', type: 'range', min: 6, max: 20, step: 1, default: 10 },
      { key: 'seed', label: '随机种子', type: 'range', min: 1, max: 9999, step: 1, default: 7 },
    ],
    height: 380,
    legend: [{ label: 'DP 概率表 δ' }, { label: '当前时间列' }, { label: '回溯最优路径' }],
    hint: 'δ_t(j)=max_i δ_{t−1}(i)A_ij·b_j(O_t)，同时记录最佳前驱 ψ；从末列回溯得到概率最大的隐状态序列。',
    buildSteps: viterbiBuild, render: viterbiRender,
  },
  'differential-privacy': {
    params: [
      { key: 'eps', label: '隐私预算 ε', type: 'range', min: 0.1, max: 5, step: 0.1, default: 1 },
      { key: 'queries', label: '查询次数', type: 'range', min: 5, max: 20, step: 1, default: 10 },
      { key: 'seed', label: '随机种子', type: 'range', min: 1, max: 9999, step: 1, default: 2 },
    ],
    height: 340,
    legend: [{ label: '真实查询结果' }, { label: '加噪回答' }],
    hint: '对敏感度 Δ 的查询加 Laplace(Δ/ε) 噪声：ε 越小隐私保护越强，但数据可用性越差。',
    buildSteps: dpBuild, render: dpRender,
  },
  'federated-learning': {
    params: [
      { key: 'clients', label: '客户端数', type: 'range', min: 4, max: 8, step: 1, default: 5 },
      { key: 'rounds', label: '通信轮次', type: 'range', min: 6, max: 25, step: 1, default: 12 },
      { key: 'lr', label: '本地学习率', type: 'range', min: 0.05, max: 1, step: 0.05, default: 0.3 },
      { key: 'seed', label: '随机种子', type: 'range', min: 1, max: 9999, step: 1, default: 11 },
    ],
    height: 340,
    legend: [{ label: '各客户端本地准确率' }, { label: '当前训练端' }],
    hint: '每轮各端在本地数据上训练若干步，只上传模型更新；服务端用 FedAvg 聚合后下发全局模型。',
    buildSteps: flBuild, render: flRender,
  },
};
