import React from 'react';
import { mulberry32, clamp } from '../utils.js';
import {
  Frame, GraphView, Scatter, num, stateColor,
} from '../kits/primitives.jsx';

/* 检索类交互演示配置：全部为纯函数、确定性、可在无 DOM 环境渲染。 */

const F = (v, d = 2) => num(v, 0).toFixed(d);
const r2 = (v) => Math.round(num(v, 0) * 100) / 100;
const r4 = (v) => Math.round(num(v, 0) * 10000) / 10000;
const tx = (v) => String(v === undefined || v === null ? '' : v);
const dv = (a, b) => (num(b, 0) > 0 ? num(a, 0) / num(b, 1) : 0);
const cp = (v, lo, hi) => clamp(num(v, lo), lo, hi);
const sg = (x) => 1 / (1 + Math.exp(-clamp(num(x, 0), -40, 40)));
const uniq = (a) => Array.from(new Set(a));
const ascend = (a) => a.slice().sort((x, y) => x - y);
const mk = (phase, note, metrics, extra = {}) => ({ phase, note, metrics, ...extra });

function padSteps(steps, min = 20, label = '校验') {
  while (steps.length < min) {
    const i = steps.length;
    steps.push(mk(label, `${label}第 ${i + 1} 项：累计处理 ${i + 1} 项，状态保持稳定。`,
      { 已处理: i + 1 }, { done: i + 1, total: Math.max(min, steps.length + 1) }));
  }
  return steps;
}

function chip(x, y, label, color, c, active = false, w = 38) {
  const ww = Math.max(26, w);
  return (
    <g key={`chip-${tx(label)}-${x}-${y}`}>
      <rect x={x} y={y} width={ww} height="22" rx="4" fill={color}
        opacity={active ? 1 : 0.72} stroke={active ? c.text : color} strokeWidth={active ? 2 : 1} />
      <text x={x + ww / 2} y={y + 15} fontSize="10" textAnchor="middle" fill={c.bg} fontWeight="600">
        {tx(label)}
      </text>
    </g>
  );
}

function footer(c, snap, H, formula) {
  const done = snap.done ?? 0, total = snap.total ?? 1;
  return (
    <g>
      <line x1="18" y1={H - 44} x2="702" y2={H - 44} stroke={c.grid} strokeWidth="1" />
      <text x="20" y={H - 28} fontSize="10" fill={c.muted}>{tx(formula)}</text>
      <text x="20" y={H - 12} fontSize="10" fill={c.text}>
        {`阶段 ${tx(snap.phase)} · 进度 ${num(done, 0)}/${num(total, 1)} · ${String(snap.note || '').slice(0, 46)}`}
      </text>
      <rect x="560" y={H - 50} width="140" height="5" rx="2" fill={c.panel2} />
      <rect x="560" y={H - 50} width={140 * clamp(dv(done, total), 0, 1)} height="5" rx="2" fill={c.primary} />
    </g>
  );
}

/* ================================================================ *
 * 1. 布尔检索：倒排表集合交 / 并 / 差
 * ================================================================ */
const BR_QUERIES = {
  and: { label: 'A AND B', op: '∩' },
  or: { label: 'A OR B', op: '∪' },
  not: { label: 'A AND NOT B', op: '∖' },
};

const booleanRetrieval = {
  params: [
    { key: 'query', label: '布尔查询', type: 'select', default: 'and',
      options: [{ value: 'and', label: 'A AND B（交集）' }, { value: 'or', label: 'A OR B（并集）' }, { value: 'not', label: 'A NOT B（差集）' }] },
    { key: 'nDocs', label: '文档数', type: 'range', min: 6, max: 12, step: 1, default: 8 },
    { key: 'seed', label: '随机种子', type: 'range', min: 1, max: 30, step: 1, default: 5 },
  ],
  height: 380,
  legend: [
    { label: '词项 A 倒排表' }, { label: '词项 B 倒排表' }, { label: '当前扫描指针' }, { label: '命中结果' },
  ],
  hint: '布尔检索把每个词项映射为升序文档列表，再用集合交（AND）、并（OR）、差（NOT）得到精确结果，但没有相关性排序。',

  buildSteps(p) {
    const n = Math.round(cp(p.nDocs, 6, 12));
    const seed = Math.round(cp(p.seed, 1, 30));
    const rnd = mulberry32(seed * 31 + n);
    const q = BR_QUERIES[p.query] ? p.query : 'and';
    const info = BR_QUERIES[q];
    const docs = Array.from({ length: n }, (_, i) => ({
      id: i, A: rnd() > 0.42, B: rnd() > 0.52,
      text: `${rnd() > 0.5 ? '算法' : '检索'} 文档 ${i}`,
    }));
    const postA = ascend(docs.filter((d) => d.A).map((d) => d.id));
    const postB = ascend(docs.filter((d) => d.B).map((d) => d.id));
    const gt = postA.filter((id) => postB.includes(id));
    const empty = { A: [], B: [], result: [], pa: -1, pb: -1, docs, done: 0, total: 1 };
    const steps = [];

    steps.push(mk('init', `建立倒排索引：语料 ${n} 篇，词项 A/B 各维护一条升序文档表；查询「${info.label}」。`,
      { 文档数: n, 命中: 0 }, { ...empty, total: 1 }));

    let ba = [], bb = [];
    docs.forEach((d, i) => {
      ba = d.A ? [...ba, d.id] : ba;
      bb = d.B ? [...bb, d.id] : bb;
      steps.push(mk('tokenize', `文档 D${d.id}：${d.text}；词项 A=${d.A ? 1 : 0}，B=${d.B ? 1 : 0}。`,
        { 文档: d.id, 文档数: n }, { ...empty, A: ba.slice(), B: bb.slice(), done: i + 1, total: n * 3 }));
      ['A', 'B'].forEach((t) => {
        const hit = t === 'A' ? d.A : d.B;
        if (hit) {
          if (t === 'A') ba = ascend([...ba, d.id]); else bb = ascend([...bb, d.id]);
        }
        steps.push(mk('posting', `倒排表 ${t}：文档 D${d.id} ${hit ? '命中，追加到列表末尾' : '未命中，跳过'}。当前 [${(t === 'A' ? ba : bb).join(', ')}]。`,
          { 词项: t === 'A' ? 1 : 2, 列表长度: (t === 'A' ? ba : bb).length },
          { ...empty, A: ba.slice(), B: bb.slice(), done: i * 3 + (t === 'A' ? 2 : 3), total: n * 3 }));
      });
    });

    steps.push(mk('query', `解析查询「${info.label}」：A 表长 ${postA.length}，B 表长 ${postB.length}，开始双指针扫描。`,
      { A表长: postA.length, B表长: postB.length },
      { ...empty, A: postA, B: postB, done: n * 3 + 1, total: n * 3 + postA.length + postB.length + 3 }));

    const result = [];
    let i = 0, j = 0, stepNo = n * 3 + 2;
    const maxLoop = postA.length + postB.length + 2;
    let loops = 0;
    while (i < postA.length && j < postB.length && loops < maxLoop) {
      loops++;
      const a = postA[i], b = postB[j];
      let action = '';
      if (q === 'and') {
        if (a === b) { result.push(a); i++; j++; action = `相等 → 结果加入 D${a}，双指针前进`; }
        else if (a < b) { i++; action = `A 的 ${a} 较小 → pa 前进`; }
        else { j++; action = `B 的 ${b} 较小 → pb 前进`; }
      } else if (q === 'or') {
        if (a === b) { result.push(a); i++; j++; action = `相等 → 结果加入 D${a}（去重）`; }
        else if (a < b) { result.push(a); i++; action = `A 的 ${a} 较小 → 加入 D${a}，pa 前进`; }
        else { result.push(b); j++; action = `B 的 ${b} 较小 → 加入 D${b}，pb 前进`; }
      } else {
        if (a === b) { i++; j++; action = `A/B 共有 D${a} → 被 NOT 排除，双指针前进`; }
        else if (a < b) { result.push(a); i++; action = `D${a} 仅在 A → 保留，pa 前进`; }
        else { j++; action = `D${b} 仅在 B → pb 前进`; }
      }
      stepNo++;
      steps.push(mk('scan', `扫描 ${info.label}：pa=${a}, pb=${b}；${action}。已得 [${result.join(', ')}]。`,
        { 当前A: a, 当前B: b, 结果数: result.length },
        { ...empty, A: postA, B: postB, result: result.slice(), pa: i, pb: j, done: stepNo, total: n * 3 + postA.length + postB.length + 3 }));
    }
    while (q === 'or' && i < postA.length && loops < maxLoop) {
      result.push(postA[i]); loops++; stepNo++;
      steps.push(mk('scan', `扫描余项：A 表剩余 D${postA[i]} 加入并集。`, { 结果数: result.length },
        { ...empty, A: postA, B: postB, result: result.slice(), pa: i, pb: j, done: stepNo, total: stepNo + 1 }));
      i++;
    }
    while (q === 'or' && j < postB.length && loops < maxLoop) {
      result.push(postB[j]); loops++; stepNo++;
      steps.push(mk('scan', `扫描余项：B 表剩余 D${postB[j]} 加入并集。`, { 结果数: result.length },
        { ...empty, A: postA, B: postB, result: result.slice(), pa: i, pb: j, done: stepNo, total: stepNo + 1 }));
      j++;
    }
    while (q === 'not' && i < postA.length && loops < maxLoop) {
      result.push(postA[i]); loops++; stepNo++;
      steps.push(mk('scan', `扫描余项：A 表剩余 D${postA[i]} 未出现在 B，保留。`, { 结果数: result.length },
        { ...empty, A: postA, B: postB, result: result.slice(), pa: i, pb: j, done: stepNo, total: stepNo + 1 }));
      i++;
    }

    const prec = result.length ? result.filter((id) => gt.includes(id)).length / result.length : 0;
    const rec = gt.length ? result.filter((id) => gt.includes(id)).length / gt.length : 0;
    steps.push(mk('end', `查询完成：「${info.label}」命中 ${result.length} 篇 [${result.join(', ')}]；相对 A∩B 的精确率 ${F(prec)}，召回率 ${F(rec)}。`,
      { 命中: result.length, 精确率: r2(prec), 召回率: r2(rec) },
      { ...empty, A: postA, B: postB, result: result.slice(), done: steps.length + 1, total: steps.length + 1 }));
    return padSteps(steps, 20, '校验');
  },

  render(snap, p, c) {
    const H = 380;
    const A = Array.isArray(snap.A) ? snap.A : [];
    const B = Array.isArray(snap.B) ? snap.B : [];
    const result = Array.isArray(snap.result) ? snap.result : [];
    const pa = num(snap.pa, -1), pb = num(snap.pb, -1);
    const q = BR_QUERIES[p.query] ? p.query : 'and';
    const info = BR_QUERIES[q];
    return (
      <Frame c={c} height={H} title="布尔检索 · 倒排表集合运算" subtitle={`查询 ${info.label}`}>
        <text x="20" y="44" fontSize="11" fill={c.muted}>词项倒排表（升序文档编号）</text>
        <text x="20" y="78" fontSize="12" fill={c.primary}>A:</text>
        {A.length === 0 && <text x="46" y="78" fontSize="10" fill={c.muted}>（空）</text>}
        {A.map((id, k) => (
          <g key={`a${id}`}>
            {chip(46 + k * 44, 64, `D${id}`, c.primary, c, pa === k)}
            {pa === k && <text x={46 + k * 44 + 12} y="58" fontSize="10" fill={c.warning}>pa</text>}
          </g>
        ))}
        <text x="20" y="126" fontSize="12" fill={c.secondary || c.purple}>B:</text>
        {B.length === 0 && <text x="46" y="126" fontSize="10" fill={c.muted}>（空）</text>}
        {B.map((id, k) => (
          <g key={`b${id}`}>
            {chip(46 + k * 44, 112, `D${id}`, c.purple, c, pb === k)}
            {pb === k && <text x={46 + k * 44 + 12} y="106" fontSize="10" fill={c.warning}>pb</text>}
          </g>
        ))}

        <rect x="20" y="160" width="330" height="60" rx="8" fill={c.panel} stroke={c.border} />
        <text x="34" y="184" fontSize="11" fill={c.text}>集合运算：A {info.op} B</text>
        <text x="34" y="206" fontSize="10" fill={c.muted}>
          {q === 'and' ? '指针相等才入结果；较小者前进' : q === 'or' ? '较小者入结果；相等去重' : '保留仅出现在 A 的文档'}
        </text>

        <text x="380" y="44" fontSize="11" fill={c.muted}>命中结果集</text>
        <rect x="380" y="56" width="320" height="164" rx="8" fill={c.panel} stroke={c.border} />
        {result.length === 0 && <text x="398" y="90" fontSize="10" fill={c.muted}>（尚未命中）</text>}
        {result.map((id, k) => chip(398 + (k % 6) * 48, 74 + Math.floor(k / 6) * 34, `D${id}`, c.success, c, false, 40))}
        <text x="398" y="196" fontSize="10" fill={c.muted}>共 {result.length} 篇 · 精确匹配，无相关性得分</text>

        {footer(c, snap, H, 'AND = 交集 · OR = 并集 · NOT = A 减去 B；双指针按升序归并，复杂度 O(|A|+|B|)')}
      </Frame>
    );
  },
};

/* ================================================================ *
 * 2. 倒排索引：postings 构建与查询词合并
 * ================================================================ */
const IV_VOCAB = ['算法', '检索', '排序', '向量', '模型', '推荐'];

const invertedIndex = {
  params: [
    { key: 'nDocs', label: '文档数', type: 'range', min: 6, max: 14, step: 1, default: 10 },
    { key: 'vocabSize', label: '词表大小', type: 'range', min: 4, max: 6, step: 1, default: 5 },
    { key: 'queryMode', label: '查询合并方式', type: 'select', default: 'union',
      options: [{ value: 'single', label: '单词项' }, { value: 'union', label: '两词并集' }, { value: 'intersect', label: '两词交集' }] },
    { key: 'seed', label: '随机种子', type: 'range', min: 1, max: 30, step: 1, default: 7 },
  ],
  height: 380,
  legend: [
    { label: '文档含该词项' }, { label: '构建中的 postings' }, { label: '查询合并指针' }, { label: '候选结果' },
  ],
  hint: '倒排索引记录「词项 → 文档列表」。先逐文档构建 postings，再把查询词的多条列表按升序归并，得到候选文档。',

  buildSteps(p) {
    const n = Math.round(cp(p.nDocs, 6, 14));
    const vs = Math.round(cp(p.vocabSize, 4, 6));
    const seed = Math.round(cp(p.seed, 1, 30));
    const mode = ['single', 'union', 'intersect'].includes(p.queryMode) ? p.queryMode : 'union';
    const rnd = mulberry32(seed * 41 + n * 7 + vs);
    const vocab = IV_VOCAB.slice(0, vs);
    const docs = Array.from({ length: n }, (_, i) => {
      const terms = vocab.filter(() => rnd() > 0.52);
      if (!terms.length) terms.push(vocab[i % vs]);
      return { id: i, terms: uniq(terms) };
    });
    const postings = Object.fromEntries(vocab.map((t) => [t, ascend(docs.filter((d) => d.terms.includes(t)).map((d) => d.id))]));
    const total = n * 3 + vs + vocab.length + vocab[0].length + vocab[1].length + 4;
    const steps = [];
    const built = Object.fromEntries(vocab.map((t) => [t, []]));
    const base = { docs, vocab, built, postings, merge: [], result: [], pa: -1, pb: -1, df: {}, done: 0, total };

    steps.push(mk('init', `初始化倒排索引：${n} 篇文档、${vs} 个词项；词表 [${vocab.join('、')}]。`,
      { 文档数: n, 词项数: vs }, { ...base }));

    docs.forEach((d, i) => {
      steps.push(mk('token', `分词 D${d.id}：得到词项 [${d.terms.join('、')}]，准备写入各自 postings。`,
        { 文档: d.id, 词项数: d.terms.length },
        { ...base, built: Object.fromEntries(vocab.map((t) => [t, built[t].slice()])), done: i * 3 + 1 }));
      d.terms.forEach((t) => { if (built[t] && !built[t].includes(d.id)) built[t] = ascend([...built[t], d.id]); });
      steps.push(mk('append', `写入 D${d.id}：更新后 ${vocab.map((t) => `${t}=[${built[t].join(',')}]`).join(' ')}。`,
        { 文档: d.id, 已建词项: vocab.filter((t) => built[t].length > 0).length },
        { ...base, built: Object.fromEntries(vocab.map((t) => [t, built[t].slice()])), done: i * 3 + 2 }));
      steps.push(mk('verify', `校验 D${d.id}：倒排表保持文档编号升序，便于后续归并。`,
        { 文档: d.id }, { ...base, built: Object.fromEntries(vocab.map((t) => [t, built[t].slice()])), done: i * 3 + 3 }));
    });

    const df = Object.fromEntries(vocab.map((t) => [t, postings[t].length]));
    vocab.forEach((t, k) => {
      steps.push(mk('finalize', `词项「${t}」postings 完成：df=${df[t]}，文档列表 [${postings[t].join(', ')}]。`,
        { 词项序: k + 1, df: df[t] },
        { ...base, built: Object.fromEntries(vocab.map((x) => [x, postings[x].slice()])), df, done: n * 3 + k + 1 }));
    });

    const t0 = vocab[0], t1 = vocab[1];
    const l0 = postings[t0], l1 = postings[t1];
    const result = [];
    let i = 0, j = 0, stepNo = n * 3 + vs + 1;
    const mergeMax = l0.length + l1.length + 2;
    let loops = 0;
    while (i < l0.length && j < l1.length && loops < mergeMax) {
      loops++;
      const a = l0[i], b = l1[j];
      let act = '';
      if (a === b) {
        if (mode === 'single' || mode === 'union' || mode === 'intersect') result.push(a);
        i++; j++; act = `相等 → D${a} 入候选，双指针前进`;
      } else if (a < b) {
        if (mode === 'union') result.push(a);
        i++; act = `D${a} 较小 → pa 前进${mode === 'union' ? '（并入结果）' : ''}`;
      } else {
        if (mode === 'union') result.push(b);
        j++; act = `D${b} 较小 → pb 前进${mode === 'union' ? '（并入结果）' : ''}`;
      }
      stepNo++;
      steps.push(mk('merge', `合并「${t0}」与「${t1}」：pa=${a}, pb=${b}；${act}。候选 [${uniq(result).join(', ')}]。`,
        { 当前A: a, 当前B: b, 候选数: uniq(result).length },
        { ...base, built: Object.fromEntries(vocab.map((x) => [x, postings[x].slice()])), df,
          merge: uniq(result).slice(), result: uniq(result).slice(), pa: i, pb: j, done: stepNo }));
    }
    if (mode === 'single') {
      l0.forEach((id, k) => {
        stepNo++;
        steps.push(mk('merge', `单词项「${t0}」扫描 postings：D${id} 直接入选。`, { 候选数: k + 1 },
          { ...base, df, merge: l0.slice(0, k + 1), result: l0.slice(0, k + 1), done: stepNo }));
      });
    } else {
      const rest = mode === 'union' ? uniq([...l0, ...l1]).filter((x) => !result.includes(x)) : [];
      rest.forEach((id, k) => {
        stepNo++;
        result.push(id);
        steps.push(mk('merge', `归并余项：D${id} 加入候选集。`, { 候选数: result.length },
          { ...base, df, merge: uniq(result).slice(), result: uniq(result).slice(), done: stepNo }));
      });
    }
    const hits = uniq(result);
    steps.push(mk('end', `查询合并完成：候选文档 ${hits.length} 篇 [${hits.join(', ')}]；倒排索引把全文检索压缩为列表归并。`,
      { 候选数: hits.length, 词项数: vs },
      { ...base, df, merge: hits.slice(), result: hits.slice(), done: steps.length + 1 }));
    return padSteps(steps, 20, '校验');
  },

  render(snap, p, c) {
    const H = 380;
    const docs = Array.isArray(snap.docs) ? snap.docs : [];
    const vocab = Array.isArray(snap.vocab) ? snap.vocab : [];
    const postings = snap.postings && typeof snap.postings === 'object' ? snap.postings : {};
    const built = snap.built && typeof snap.built === 'object' ? snap.built : {};
    const df = snap.df && typeof snap.df === 'object' ? snap.df : {};
    const result = Array.isArray(snap.result) ? snap.result : [];
    const mode = ['single', 'union', 'intersect'].includes(p.queryMode) ? p.queryMode : 'union';
    const cw = Math.max(28, Math.min(42, 420 / Math.max(1, docs.length)));
    return (
      <Frame c={c} height={H} title="倒排索引 · 构建与查询合并" subtitle={`模式 ${mode} · ${vocab.length} 词项 / ${docs.length} 文档`}>
        <text x="20" y="44" fontSize="11" fill={c.muted}>词项 × 文档命中矩阵（实心 = 文档含该词）</text>
        {vocab.map((t, r) => {
          const y = 58 + r * Math.min(30, 180 / Math.max(1, vocab.length));
          const list = Array.isArray(built[t]) ? built[t] : [];
          return (
            <g key={t}>
              <text x="20" y={y + 12} fontSize="10" fill={c.text}>{tx(t)}</text>
              {docs.map((d, k) => {
                const has = d.terms && d.terms.includes(t);
                return <rect key={d.id} x={64 + k * (cw + 2)} y={y} width={cw} height="16" rx="2"
                  fill={has ? (list.includes(d.id) ? c.primary : c.border) : c.panel2}
                  opacity={has ? 0.9 : 0.5} />;
              })}
              <text x={64 + docs.length * (cw + 2) + 6} y={y + 12} fontSize="9" fill={c.muted}>
                {`df=${num(df[t], list.length)} [${list.join(',')}]`}
              </text>
            </g>
          );
        })}

        <line x1="18" y1="248" x2="702" y2="248" stroke={c.grid} strokeWidth="1" />
        <text x="20" y="268" fontSize="11" fill={c.muted}>查询词 postings 归并</text>
        <text x="20" y="290" fontSize="10" fill={c.primary}>
          {`「${tx(vocab[0])}」 [${(postings[vocab[0]] || []).join(', ')}]  ${mode === 'single' ? '' : infoOp(mode)}  「${tx(vocab[1])}」 [${(postings[vocab[1]] || []).join(', ')}]`}
        </text>
        <text x="20" y="312" fontSize="10" fill={c.muted}>候选结果：</text>
        {result.map((id, k) => chip(100 + k * 44, 298, `D${id}`, c.success, c, false, 38))}
        {footer(c, snap, H, '倒排表 = 词项 → [文档编号升序]；df 为列表长度，查询通过归并多条列表得到候选集')}
      </Frame>
    );
  },
};

function infoOp(mode) { return mode === 'union' ? '∪' : '∩'; }

/* ================================================================ *
 * 3. TF-IDF：词频 × 逆文档频率打分
 * ================================================================ */
const TF_VOCAB = ['算法', '检索', '排序', '向量', '模型', '推荐'];

const tfidf = {
  params: [
    { key: 'nDocs', label: '文档数', type: 'range', min: 5, max: 10, step: 1, default: 6 },
    { key: 'nTerms', label: '词表大小', type: 'range', min: 3, max: 6, step: 1, default: 4 },
    { key: 'queryLen', label: '查询词个数', type: 'range', min: 1, max: 3, step: 1, default: 2 },
    { key: 'seed', label: '随机种子', type: 'range', min: 1, max: 30, step: 1, default: 11 },
  ],
  height: 380,
  legend: [
    { label: '词频 tf' }, { label: '逆文档频率 idf' }, { label: '当前计算项' }, { label: '文档得分' },
  ],
  hint: 'TF-IDF 用词频衡量词在文档内的重要性，用逆文档频率抑制到处出现的常见词；文档得分是查询词 tf·idf 之和。',

  buildSteps(p) {
    const n = Math.round(cp(p.nDocs, 5, 10));
    const m = Math.round(cp(p.nTerms, 3, 6));
    const ql = Math.round(cp(p.queryLen, 1, 3));
    const seed = Math.round(cp(p.seed, 1, 30));
    const rnd = mulberry32(seed * 53 + n * 11 + m);
    const vocab = TF_VOCAB.slice(0, m);
    const query = vocab.slice(0, Math.min(ql, m));
    const docs = Array.from({ length: n }, (_, i) => ({
      id: i,
      tf: vocab.map(() => Math.floor(rnd() * 4)),
    }));
    const df = vocab.map((_, j) => docs.filter((d) => d.tf[j] > 0).length);
    const idf = df.map((v) => Math.log((n + 1) / (v + 1)) + 1);
    const tfidf = docs.map((d) => d.tf.map((v, j) => v * idf[j]));
    const total = n * 3 + m + query.length * n + 3;
    const steps = [];
    const scores = docs.map(() => 0);
    const base = { docs, vocab, query, df, idf, tfidf, scores: scores.slice(), reveal: 0, scoreCount: 0, ql: query.length, cur: -1, done: 0, total };

    steps.push(mk('init', `语料 ${n} 篇、词表 ${m} 个；查询词 [${query.join('、')}]。TF-IDF = tf × idf。`,
      { 文档数: n, 词项数: m }, { ...base }));

    docs.forEach((d, i) => {
      steps.push(mk('tf', `D${d.id} 词频向量 [${d.tf.join(', ')}]，对应词项 [${vocab.join(', ')}]。`,
        { 文档: d.id, 词项数: m }, { ...base, reveal: i + 1, cur: i, done: i + 1 }));
      steps.push(mk('norm', `D${d.id} 词频已就绪；常见词将被 idf 压低，罕见词被放大。`,
        { 文档: d.id }, { ...base, reveal: i + 1, cur: i, done: n + i + 1 }));
      steps.push(mk('tfidf', `D${d.id} TF-IDF 向量 [${tfidf[i].map((v) => F(v)).join(', ')}]。`,
        { 文档: d.id, 最大权重: r2(Math.max(0.001, ...tfidf[i])) }, { ...base, reveal: i + 1, cur: i, done: n * 2 + i + 1 }));
    });

    vocab.forEach((t, j) => {
      steps.push(mk('idf', `词「${t}」df=${df[j]}，idf = ln((N+1)/(df+1))+1 = ${F(idf[j])}。df 越小权重越高。`,
        { 词项序: j + 1, df: df[j], idf: r2(idf[j]) }, { ...base, reveal: n, cur: -1, done: n * 3 + j + 1 }));
    });

    query.forEach((t, qi) => {
      const j = vocab.indexOf(t);
      docs.forEach((d, i) => {
        const add = tfidf[i][j];
        scores[i] += add;
        steps.push(mk('score', `D${d.id} 累加查询词「${t}」：tf=${d.tf[j]} × idf=${F(idf[j])} = ${F(add)}，当前总分 ${F(scores[i])}。`,
          { 查询词序: qi + 1, 文档: d.id, 累加: r2(add), 总分: r2(scores[i]) },
          { ...base, scores: scores.slice(), reveal: n, cur: i, scoreCount: qi * n + i + 1, done: n * 3 + m + qi * n + i + 1 }));
      });
    });

    const ranked = docs.map((d, i) => ({ id: d.id, s: scores[i] })).sort((a, b) => b.s - a.s);
    steps.push(mk('rank', `按 TF-IDF 总分排序：${ranked.slice(0, 4).map((r) => `D${r.id}(${F(r.s)})`).join('、')}。`,
      { 最高分: r2(ranked[0].s), 第一名: ranked[0].id },
      { ...base, scores: scores.slice(), reveal: n, cur: -1, scoreCount: query.length * n, done: steps.length + 1 }));
    return padSteps(steps, 20, '校验');
  },

  render(snap, p, c) {
    const H = 380;
    const docs = Array.isArray(snap.docs) ? snap.docs : [];
    const vocab = Array.isArray(snap.vocab) ? snap.vocab : [];
    const idf = Array.isArray(snap.idf) ? snap.idf : [];
    const tfidf = Array.isArray(snap.tfidf) ? snap.tfidf : [];
    const scores = Array.isArray(snap.scores) ? snap.scores : [];
    const query = Array.isArray(snap.query) ? snap.query : [];
    const maxS = Math.max(0.001, ...scores);
    const cw = Math.max(34, Math.min(56, 300 / Math.max(1, vocab.length)));
    const reveal = num(snap.reveal, 0), cur = num(snap.cur, -1);
    const doneDocs = Math.floor(num(snap.scoreCount, 0) / Math.max(1, num(snap.ql, 1)));
    return (
      <Frame c={c} height={H} title="TF-IDF · 词频 × 逆文档频率" subtitle={`查询 [${query.map(tx).join('、')}] · 已构建 ${reveal}/${docs.length} 行`}>
        <text x="20" y="44" fontSize="10" fill={c.muted}>TF-IDF 权重矩阵（列=词项，行=文档）</text>
        {vocab.map((t, j) => <text key={`h${t}`} x={64 + j * (cw + 2) + cw / 2} y="60" fontSize="9" textAnchor="middle" fill={c.muted}>{tx(t)}</text>)}
        <text x="20" y="60" fontSize="9" fill={c.muted}>idf</text>
        {vocab.map((t, j) => <text key={`i${t}`} x={64 + j * (cw + 2) + cw / 2} y="76" fontSize="9" textAnchor="middle" fill={c.primary}>{reveal >= docs.length ? F(idf[j]) : '—'}</text>)}
        {docs.map((d, i) => {
          if (i >= reveal) return null;
          const y = 88 + i * Math.min(24, 180 / Math.max(1, docs.length));
          const row = Array.isArray(tfidf[i]) ? tfidf[i] : [];
          return (
            <g key={d.id}>
              <text x="20" y={y + 12} fontSize="9" fill={c.text}>{`D${d.id}`}</text>
              {vocab.map((t, j) => (
                <g key={t}>
                  <rect x={64 + j * (cw + 2)} y={y} width={cw} height="16" rx="2" fill={c.panel2}
                    opacity={clamp(dv(row[j], Math.max(0.001, ...row)), 0, 1) * 0.85 + 0.12} />
                  <text x={64 + j * (cw + 2) + cw / 2} y={y + 12} fontSize="9" textAnchor="middle" fill={c.text}>{F(row[j])}</text>
                </g>
              ))}
            </g>
          );
        })}

        <line x1="18" y1="276" x2="702" y2="276" stroke={c.grid} strokeWidth="1" />
        <text x="20" y="292" fontSize="10" fill={c.muted}>文档得分 = Σ tf·idf（对查询词）</text>
        {docs.map((d, i) => {
          if (i >= doneDocs) return null;
          const y = 300 + i * Math.min(4, 28 / Math.max(1, docs.length));
          return <rect key={d.id} x="170" y={y} width={Math.max(2, dv(scores[i], maxS) * 400)} height="3" rx="2"
            fill={stateColor(c, cur === i ? 'current' : 'done')} opacity="0.85" />;
        })}
        <text x="580" y="312" fontSize="10" fill={c.success}>最高 {F(maxS)}</text>
        {footer(c, snap, H, 'idf = ln((N+1)/(df+1)) + 1；tf 越高、df 越低，TF-IDF 权重越大')}
      </Frame>
    );
  },
};

/* ================================================================ *
 * 4. PageRank：迭代与阻尼
 * ================================================================ */
const pagerankIR = {
  params: [
    { key: 'nNodes', label: '网页数', type: 'range', min: 6, max: 12, step: 1, default: 8 },
    { key: 'damping', label: '阻尼因子 d', type: 'range', min: 0.5, max: 0.95, step: 0.05, default: 0.85 },
    { key: 'iterations', label: '迭代轮数', type: 'range', min: 3, max: 12, step: 1, default: 8 },
    { key: 'seed', label: '随机种子', type: 'range', min: 1, max: 30, step: 1, default: 5 },
  ],
  height: 360,
  legend: [
    { label: '权威度较低' }, { label: '权威度中等' }, { label: '权威度最高' }, { label: '当前投票源' },
  ],
  hint: 'PageRank 把链接当投票：PR(i) = (1−d)/N + d·Σ PR(j)/outdeg(j)，反复迭代直到收敛；d 为阻尼因子。',

  buildSteps(p) {
    const n = Math.round(cp(p.nNodes, 6, 12));
    const T = Math.round(cp(p.iterations, 3, 12));
    const d = cp(p.damping, 0.5, 0.95);
    const seed = Math.round(cp(p.seed, 1, 30));
    const rnd = mulberry32(seed * 7 + n * 17 + T);
    const nodes = Array.from({ length: n }, (_, i) => {
      const ang = (i / n) * Math.PI * 2 + 0.3;
      return { id: i, x: 0.5 + 0.36 * Math.cos(ang), y: 0.5 + 0.36 * Math.sin(ang) };
    });
    const out = nodes.map((nd) => {
      const targets = [];
      while (targets.length < 2) {
        const k = Math.floor(rnd() * n);
        if (k !== nd.id && !targets.includes(k)) targets.push(k);
      }
      return targets;
    });
    const edges = out.flatMap((ts, j) => ts.map((k) => ({ from: j, to: k })));
    let pr = nodes.map(() => 1 / n);
    const total = 1 + T * (n + 1) + 1;
    const steps = [];
    const base = { nodes, edges, out, damping: d, iterations: T, n, done: 0, total };

    steps.push(mk('init', `初始化 ${n} 个网页，PR 均匀为 ${F(1 / n, 3)}；阻尼 d=${F(d)}，共迭代 ${T} 轮。`,
      { 迭代: 0, 网页数: n, 阻尼: r2(d) },
      { ...base, pr: pr.slice(), iter: 0, cur: -1, delta: 0, prList: [pr.slice()] }));

    for (let t = 1; t <= T; t++) {
      for (let j = 0; j < n; j++) {
        steps.push(mk('vote', `第 ${t}/${T} 轮：网页 P${j}（PR=${F(pr[j], 3)}）向 ${out[j].map((k) => `P${k}`).join('、')} 各投出 ${F(pr[j] / out[j].length, 3)}。`,
          { 迭代: t, 投票源: j, 单票: r4(pr[j] / out[j].length), PR: r4(pr[j]) },
          { ...base, pr: pr.slice(), iter: t, cur: j, delta: 0, prList: [pr.slice()] }));
      }
      const incoming = nodes.map(() => 0);
      edges.forEach((e) => { incoming[e.to] += pr[e.from] / out[e.from].length; });
      const next = nodes.map((_, i) => (1 - d) / n + d * incoming[i]);
      const sum = next.reduce((a, b) => a + b, 0);
      const norm = sum > 0 ? next.map((v) => v / sum) : next;
      const delta = Math.max(...norm.map((v, i) => Math.abs(v - pr[i])));
      pr = norm;
      steps.push(mk('commit', `第 ${t} 轮结束：按 PR'=(1−d)/N + d·Σ 投票 更新，最大变化 ${F(delta, 4)}，最高 PR=${F(Math.max(...pr), 3)}。`,
        { 迭代: t, 收敛差: r4(delta), 最高权威度: r4(Math.max(...pr)) },
        { ...base, pr: pr.slice(), iter: t, cur: -1, delta, prList: [pr.slice()] }));
    }
    const top = pr.indexOf(Math.max(...pr));
    steps.push(mk('end', `迭代完成：P${top} 权威度最高（${F(pr[top], 3)}）。增大阻尼会更依赖链接结构，减小则更均匀。`,
      { 迭代: T, 最高权威度: r4(pr[top]), 收敛差: r4(steps[steps.length - 1].delta || 0) },
      { ...base, pr: pr.slice(), iter: T, cur: -1, delta: 0, prList: [pr.slice()] }));
    return padSteps(steps, 20, '校验');
  },

  render(snap, p, c) {
    const H = 360;
    const nodes = Array.isArray(snap.nodes) ? snap.nodes : [];
    const edges = Array.isArray(snap.edges) ? snap.edges : [];
    const pr = Array.isArray(snap.pr) ? snap.pr : nodes.map(() => 0);
    const cur = num(snap.cur, -1);
    const mx = Math.max(0.0001, ...pr), mn = Math.min(...pr);
    const graphNodes = nodes.map((nd, i) => {
      const color = i === cur ? c.warning
        : (pr[i] >= mx * 0.92 ? c.success : (pr[i] <= mn * 1.08 ? c.accent : c.primary));
      return { id: `P${i}`, label: `P${i}`, sub: `PR=${F(pr[i], 3)}`, x: nd.x, y: nd.y, color, r: 13 };
    });
    const graphEdges = edges.map((e) => ({
      from: `P${e.from}`, to: `P${e.to}`,
      state: num(snap.cur, -1) === e.from ? 'active' : 'idle',
      label: num(snap.cur, -1) === e.from ? F(dv(pr[e.from], 2), 3) : undefined,
    }));
    return (
      <GraphView c={c} height={H} nodes={graphNodes} edges={graphEdges} directed
        title={`PageRank · 第 ${num(snap.iter, 0)}/${num(snap.iterations, 0)} 轮 · 阻尼 ${F(snap.damping, 2)}`}
        subtitle={`收敛差 ${F(snap.delta, 4)} · 投票源 ${cur >= 0 ? `P${cur}` : '—'}`} />
    );
  },
};

/* ================================================================ *
 * 5. 向量检索：query 向量与候选点距离
 * ================================================================ */
const vectorRetrieval = {
  params: [
    { key: 'topK', label: '检索 top-k', type: 'range', min: 1, max: 6, step: 1, default: 3 },
    { key: 'nDocs', label: '候选向量数', type: 'range', min: 8, max: 18, step: 2, default: 12 },
    { key: 'metric', label: '相似度度量', type: 'select', default: 'cosine',
      options: [{ value: 'cosine', label: '余弦相似度' }, { value: 'dot', label: '点积' }, { value: 'l2', label: 'L2 距离倒数' }] },
    { key: 'angle', label: '查询角度', type: 'range', min: 0, max: 350, step: 10, default: 30, unit: '°' },
    { key: 'seed', label: '随机种子', type: 'range', min: 1, max: 30, step: 1, default: 7 },
  ],
  height: 370,
  legend: [
    { label: '未打分候选' }, { label: '已打分候选' }, { label: '当前计算距离' }, { label: 'top-k 命中' },
  ],
  hint: '向量检索把查询与文档编码到同一空间，用余弦/点积/L2 计算距离，取最相似的 k 个候选。',

  buildSteps(p) {
    const K = Math.round(cp(p.topK, 1, 6));
    const n = Math.round(cp(p.nDocs, 8, 18));
    const metric = ['cosine', 'dot', 'l2'].includes(p.metric) ? p.metric : 'cosine';
    const ang = cp(p.angle, 0, 350) * Math.PI / 180;
    const seed = Math.round(cp(p.seed, 1, 30));
    const rnd = mulberry32(seed * 67 + n + K);
    const q = { x: Math.cos(ang), y: Math.sin(ang) };
    const docs = Array.from({ length: n }, (_, i) => {
      const a = (i / n) * Math.PI * 2 + (rnd() - 0.5) * 0.6;
      const len = 0.35 + rnd() * 0.6;
      const x = Math.cos(a) * len, y = Math.sin(a) * len;
      const dot = q.x * x + q.y * y;
      const norm = Math.max(1e-6, Math.hypot(x, y));
      const cos = dot / norm;
      const l2 = Math.hypot(q.x - x, q.y - y);
      const score = metric === 'dot' ? dot : metric === 'l2' ? 1 / (1 + l2) : cos;
      return { id: i, x, y, dot, cos, l2, score, relevant: cos > 0.5 };
    });
    const ranked = docs.slice().sort((a, b) => b.score - a.score);
    const total = 1 + n * 2 + 1 + K + 1;
    const steps = [];
    const base = { docs, q, metric, ranked: ranked.map((d) => d.id), done: 0, total };
    const selected = [];

    steps.push(mk('encode', `编码查询向量 q=(cos${F(ang * 180 / Math.PI, 0)}°, sin${F(ang * 180 / Math.PI, 0)}°)，候选 ${n} 个；度量 ${metric}。`,
      { 候选数: n, topK: K }, { ...base, done: 1 }));

    docs.forEach((d, i) => {
      steps.push(mk('component', `D${d.id} 向量 (${F(d.x)}, ${F(d.y)})：点积 q·d=${F(d.dot)}，|d|=${F(Math.hypot(d.x, d.y))}，L2=${F(d.l2)}。`,
        { 文档: d.id, 点积: r2(d.dot), L2: r2(d.l2) }, { ...base, done: 2 + i * 2, cur: d.id, scored: i }));
      steps.push(mk('score', `D${d.id} 相似度 = ${F(d.score)}${d.relevant ? '（高于相关阈值）' : ''}；已打分 ${i + 1}/${n}。`,
        { 文档: d.id, 相似度: r4(d.score), 已打分: i + 1 },
        { ...base, done: 3 + i * 2, cur: d.id, scored: i + 1 }));
    });

    steps.push(mk('rank', `按相似度降序：${ranked.slice(0, 5).map((d) => `#${d.id}(${F(d.score)})`).join('、')}。`,
      { 已打分: n, 第一名: ranked[0].id },
      { ...base, done: 2 + n * 2, scored: n, selected: [] }));

    for (let k = 0; k < Math.min(K, ranked.length); k++) {
      selected.push(ranked[k].id);
      steps.push(mk('select', `取第 ${k + 1} 名 #${ranked[k].id}，相似度 ${F(ranked[k].score)}${ranked[k].relevant ? '，命中相关' : '，相关性较低'}。`,
        { 已选: selected.length, 命中相关: selected.filter((id) => docs[id].relevant).length },
        { ...base, done: 3 + n * 2 + k, scored: n, selected: selected.slice(), cur: ranked[k].id }));
    }
    const hits = selected.filter((id) => docs[id].relevant).length;
    steps.push(mk('end', `送入下游 ${selected.length} 个向量：命中相关 ${hits}/${selected.length}。top-k 过小易漏召回，过大引入噪声。`,
      { 已选: selected.length, 命中相关: hits, 精确率: r2(dv(hits, selected.length)) },
      { ...base, done: steps.length + 1, scored: n, selected: selected.slice(), cur: -1 }));
    return padSteps(steps, 20, '校验');
  },

  render(snap, p, c) {
    const H = 370;
    const docs = Array.isArray(snap.docs) ? snap.docs : [];
    const q = snap.q && typeof snap.q === 'object' ? snap.q : { x: 1, y: 0 };
    const ranked = Array.isArray(snap.ranked) ? snap.ranked : [];
    const selected = Array.isArray(snap.selected) ? snap.selected : [];
    const scored = num(snap.scored, 0), cur = num(snap.cur, -1);
    const cx = 160, cy = 185, R = 130;
    const px = (x) => cx + num(x, 0) * R, py = (y) => cy - num(y, 0) * R;
    const sel = new Set(selected);
    return (
      <Frame c={c} height={H} title="向量检索 · query 与候选距离" subtitle={`度量 ${tx(snap.metric)} · ${docs.length} 候选`}>
        <circle cx={cx} cy={cy} r={R} fill={c.panel} stroke={c.border} />
        <line x1={cx - R} y1={cy} x2={cx + R} y2={cy} stroke={c.grid} />
        <line x1={cx} y1={cy - R} x2={cx} y2={cy + R} stroke={c.grid} />
        <line x1={cx} y1={cy} x2={px(q.x)} y2={py(q.y)} stroke={c.danger} strokeWidth="3" />
        <circle cx={px(q.x)} cy={py(q.y)} r="6" fill={c.danger} />
        <text x={px(q.x) + 9} y={py(q.y) - 7} fontSize="10" fill={c.danger}>query</text>
        {cur >= 0 && docs[cur] && (
          <line x1={cx} y1={cy} x2={px(docs[cur].x)} y2={py(docs[cur].y)} stroke={c.warning}
            strokeWidth="2" strokeDasharray="4 3" fill={c.bg} fillOpacity="0" />
        )}
        {docs.map((d, i) => {
          const on = sel.has(d.id);
          return (
            <g key={d.id}>
              <circle cx={px(d.x)} cy={py(d.y)} r={on ? 8 : 5}
                fill={on ? c.success : (i < scored ? c.primary : c.border)}
                opacity={on ? 1 : (i < scored ? 0.85 : 0.5)}
                stroke={cur === d.id ? c.warning : c.primary} strokeWidth={cur === d.id ? 3 : 0} />
              {on && <text x={px(d.x) + 10} y={py(d.y) + 3} fontSize="10" fill={c.success}>#{d.id}</text>}
            </g>
          );
        })}

        <text x="330" y="46" fontSize="11" fill={c.muted}>相似度排序（绿色 = top-k）</text>
        {ranked.slice(0, 9).map((id, k) => {
          const d = docs[id];
          if (!d) return null;
          const on = sel.has(id);
          const y = 58 + k * 26;
          return (
            <g key={id}>
              <rect x="330" y={y} width="370" height="22" rx="4" fill={on ? c.success : c.panel}
                opacity={on ? 0.22 : 1} stroke={on ? c.success : c.border} />
              <text x="340" y={y + 15} fontSize="10" fill={c.text}>{`#${id} ${d.relevant ? '相关' : '一般'}`}</text>
              <rect x="470" y={y + 7} width={Math.max(2, clamp(d.score, -1, 1) * 100 + 100)} height="8" rx="3" fill={c.series[0]} opacity="0.8" />
              <text x="640" y={y + 15} fontSize="10" fill={c.muted}>{F(d.score)}</text>
              {on && <text x="680" y={y + 15} fontSize="10" fill={c.success}>✓</text>}
            </g>
          );
        })}
        {footer(c, snap, H, `score = ${snap.metric === 'dot' ? 'q·d' : snap.metric === 'l2' ? '1/(1+L2)' : 'cos(q,d)'}；向量越接近 query，相似度越高`)}
      </Frame>
    );
  },
};

/* ================================================================ *
 * 6. ANN 近似最近邻：IVF 聚类与探针召回
 * ================================================================ */
const annSearch = {
  params: [
    { key: 'nDocs', label: '向量数', type: 'range', min: 12, max: 30, step: 2, default: 20 },
    { key: 'nClusters', label: '聚类数', type: 'range', min: 4, max: 8, step: 1, default: 6 },
    { key: 'nProbes', label: '探针数', type: 'range', min: 1, max: 6, step: 1, default: 3 },
    { key: 'seed', label: '随机种子', type: 'range', min: 1, max: 30, step: 1, default: 9 },
  ],
  height: 380,
  legend: [
    { label: '非探测簇向量' }, { label: '探测簇候选' }, { label: '簇中心' }, { label: 'query / 探测中心' },
  ],
  hint: 'ANN 用 IVF 把向量分簇，查询时只探测最近的若干簇，在候选里精排；探针越多召回越高、速度越慢。',

  buildSteps(p) {
    const n = Math.round(cp(p.nDocs, 12, 30));
    const nc = Math.round(cp(p.nClusters, 4, 8));
    const np = Math.round(cp(p.nProbes, 1, 6));
    const seed = Math.round(cp(p.seed, 1, 30));
    const rnd = mulberry32(seed * 73 + n * 5 + nc);
    const centers = Array.from({ length: nc }, (_, k) => {
      const a = (k / nc) * Math.PI * 2;
      return { k, x: Math.cos(a) * 0.6, y: Math.sin(a) * 0.6 };
    });
    const docs = Array.from({ length: n }, (_, i) => {
      const c = i % nc;
      const cen = centers[c];
      const x = cen.x + (rnd() - 0.5) * 0.42, y = cen.y + (rnd() - 0.5) * 0.42;
      return { id: i, x, y, cluster: c };
    });
    const q = { x: 0.72, y: 0.36 };
    const cd = centers.map((cen) => Math.hypot(q.x - cen.x, q.y - cen.y));
    const probes = cd.map((v, k) => ({ k, d: v })).sort((a, b) => a.d - b.d).slice(0, Math.min(np, nc)).map((o) => o.k);
    const exact = docs.slice().sort((a, b) => Math.hypot(q.x - a.x, q.y - a.y) - Math.hypot(q.x - b.x, q.y - b.y)).slice(0, 5).map((d) => d.id);
    const cand = docs.filter((d) => probes.includes(d.cluster));
    const candTop = cand.slice().sort((a, b) => Math.hypot(q.x - a.x, q.y - a.y) - Math.hypot(q.x - b.x, q.y - b.y)).slice(0, 5).map((d) => d.id);
    const recall = exact.length ? exact.filter((id) => candTop.includes(id)).length / exact.length : 0;
    const total = 1 + n + nc + probes.length + cand.length + 2;
    const steps = [];
    const base = { docs, centers, q, nc, np, probes: [], cd, recall, assigned: 0, done: 0, total };

    steps.push(mk('init', `IVF 索引：${n} 个向量分成 ${nc} 簇；查询 q=(0.72,0.36)，将探测 ${np} 个最近簇。`,
      { 向量数: n, 簇数: nc, 探针: np }, { ...base, done: 1 }));

    docs.forEach((d, i) => {
      steps.push(mk('assign', `向量 #${d.id} 归入簇 C${d.cluster}（最近中心）；簇内向量彼此接近。`,
        { 向量: d.id, 簇: d.cluster }, { ...base, assigned: i + 1, done: 2 + i }));
    });
    centers.forEach((cen, k) => {
      steps.push(mk('centroid', `簇 C${k} 中心 (${F(cen.x)},${F(cen.y)})，到 query 距离 ${F(cd[k])}。`,
        { 簇: k, 中心距离: r2(cd[k]) }, { ...base, assigned: n, done: 2 + n + k }));
    });
    probes.forEach((k, idx) => {
      steps.push(mk('probe', `按中心距离排序，探测第 ${idx + 1} 近的簇 C${k}（距离 ${F(cd[k])}）。`,
        { 探测序: idx + 1, 簇: k }, { ...base, assigned: n, probes: probes.slice(0, idx + 1), done: 2 + n + nc + idx + 1 }));
    });
    cand.forEach((d, idx) => {
      steps.push(mk('candidate', `候选 #${d.id}（簇 C${d.cluster}）进入精排，与 query 距离 ${F(Math.hypot(q.x - d.x, q.y - d.y))}。`,
        { 候选序: idx + 1, 距离: r2(Math.hypot(q.x - d.x, q.y - d.y)) },
        { ...base, assigned: n, probes, candidates: cand.slice(0, idx + 1).map((o) => o.id), done: 2 + n + nc + np + idx + 1 }));
    });
    steps.push(mk('rank', `在 ${cand.length} 个候选内精排，top-5 = [${candTop.join(', ')}]；暴力 top-5 = [${exact.join(', ')}]。`,
      { 候选数: cand.length, 召回率: r2(recall) },
      { ...base, assigned: n, probes, candidates: cand.map((d) => d.id), top: candTop, done: steps.length }));
    steps.push(mk('end', `ANN 召回率 ${F(recall)}（${exact.filter((id) => candTop.includes(id)).length}/${exact.length}）：只扫 ${cand.length}/${n} 个向量即近似全量结果。`,
      { 召回率: r2(recall), 扫描比例: r2(dv(cand.length, n)), 候选数: cand.length },
      { ...base, assigned: n, probes, candidates: cand.map((d) => d.id), top: candTop, done: steps.length + 1 }));
    return padSteps(steps, 20, '校验');
  },

  render(snap, p, c) {
    const H = 380;
    const docs = Array.isArray(snap.docs) ? snap.docs : [];
    const centers = Array.isArray(snap.centers) ? snap.centers : [];
    const probes = Array.isArray(snap.probes) ? snap.probes : [];
    const candidates = Array.isArray(snap.candidates) ? snap.candidates : [];
    const cand = new Set(candidates);
    const q = snap.q && typeof snap.q === 'object' ? snap.q : { x: 0.7, y: 0.4 };
    const assigned = num(snap.assigned, 0);
    const points = docs.map((d) => ({
      x: d.x, y: d.y,
      color: cand.has(d.id) ? c.success : (d.id < assigned ? c.series[num(d.cluster, 0) % c.series.length] : c.border),
      opacity: cand.has(d.id) ? 0.95 : (d.id < assigned ? 0.8 : 0.35),
      r: cand.has(d.id) ? 5.5 : 3.4,
    }));
    const cs = centers.map((cen) => ({
      x: cen.x, y: cen.y,
      color: probes.includes(cen.k) ? c.warning : c.accent,
      label: `C${cen.k}`,
    }));
    cs.push({ x: q.x, y: q.y, color: c.danger, label: 'Q' });
    return (
      <Scatter c={c} height={H} points={points} centers={cs}
        bounds={{ xmin: -1.3, xmax: 1.3, ymin: -1.3, ymax: 1.3 }}
        title={`ANN / IVF · 探测 ${probes.length} 簇 · 候选 ${candidates.length}/${docs.length}`}
        subtitle={`召回率 ${F(num(snap.recall, 0))} · 已探测 [${probes.map((k) => `C${k}`).join(', ')}]`} />
    );
  },
};

/* ================================================================ *
 * 7. LSH 局部敏感哈希：桶碰撞与召回
 * ================================================================ */
const lsh = {
  params: [
    { key: 'nDocs', label: '文档数', type: 'range', min: 10, max: 24, step: 2, default: 16 },
    { key: 'nTables', label: '哈希表数', type: 'range', min: 2, max: 6, step: 1, default: 4 },
    { key: 'nBits', label: '每表哈希位数', type: 'range', min: 2, max: 5, step: 1, default: 3 },
    { key: 'seed', label: '随机种子', type: 'range', min: 1, max: 30, step: 1, default: 13 },
  ],
  height: 390,
  legend: [
    { label: '普通文档' }, { label: '与 query 碰撞的候选' }, { label: 'query 所在桶' }, { label: '真正近邻' },
  ],
  hint: 'LSH 用随机投影把向量映射为比特串，相似向量更可能落入同一桶；把近邻搜索变成桶内查找，以概率换速度。',

  buildSteps(p) {
    const n = Math.round(cp(p.nDocs, 10, 24));
    const T = Math.round(cp(p.nTables, 2, 6));
    const B = Math.round(cp(p.nBits, 2, 5));
    const seed = Math.round(cp(p.seed, 1, 30));
    const rnd = mulberry32(seed * 97 + n * 3 + T * 5 + B);
    const dim = 6;
    const docs = Array.from({ length: n }, (_, i) => {
      const v = Array.from({ length: dim }, () => rnd() * 2 - 1);
      return { id: i, v };
    });
    const hashFns = Array.from({ length: T }, () => Array.from({ length: B }, () =>
      Array.from({ length: dim }, () => rnd() * 2 - 1)));
    const codeOf = (v) => hashFns.map((bits) => {
      let s = '';
      bits.forEach((w) => { s += (v.reduce((a, x, d) => a + x * w[d], 0) >= 0 ? '1' : '0'); });
      return s;
    });
    const codes = docs.map((d) => codeOf(d.v));
    const qv = Array.from({ length: dim }, () => rnd() * 2 - 1);
    const qcodes = codeOf(qv);
    const buckets = Array.from({ length: T }, () => ({}));
    const snapshotBuckets = () => buckets.map((bk) => Object.fromEntries(Object.entries(bk).map(([k, v]) => [k, v.slice()])));
    const candidates = uniq(codes.flatMap((cs, i) => cs.filter((code, t) => code === qcodes[t]).map(() => i)));
    const trueNN = docs.map((d) => ({
      id: d.id,
      sim: d.v.reduce((a, x, k) => a + x * qv[k], 0) / Math.max(1e-6, Math.hypot(...d.v) * Math.hypot(...qv)),
    })).sort((a, b) => b.sim - a.sim).slice(0, 5).map((o) => o.id);
    const recall = trueNN.length ? trueNN.filter((id) => candidates.includes(id)).length / trueNN.length : 0;
    const total = 1 + n * T + T + T + candidates.length + 2;
    const steps = [];
    const base = { codes, qcodes, buckets, n, T, B, done: 0, total };

    steps.push(mk('init', `LSH：${n} 个文档，${T} 张哈希表，每表 ${B} 位哈希（${Math.pow(2, B)} 个桶）。`,
      { 文档数: n, 表数: T, 位数: B }, { ...base, buckets: snapshotBuckets() }));

    docs.forEach((d, i) => {
      codes[i].forEach((code, t) => {
        if (!buckets[t][code]) buckets[t][code] = [];
        buckets[t][code].push(i);
        steps.push(mk('hash', `D${d.id} 在表 t${t} 的哈希 = ${code} → 落入桶 ${code}。`,
          { 文档: d.id, 表: t },
          { ...base, buckets: snapshotBuckets(), hashed: (i * T) + t + 1, done: 1 + i * T + t + 1 }));
      });
    });
    qcodes.forEach((code, t) => {
      steps.push(mk('queryhash', `query 在表 t${t} 的哈希 = ${code}，定位桶 ${code}；桶内文档成为候选。`,
        { 表: t, 桶编号: parseInt(code, 2) }, { ...base, qcode: qcodes.slice(0, t + 1), done: 1 + n * T + t + 1 }));
    });
    qcodes.forEach((code, t) => {
      const hits = buckets[t][code] || [];
      steps.push(mk('collision', `表 t${t} 桶 ${code} 碰撞文档 [${hits.join(', ')}]：与 query 哈希相同即候选。`,
        { 表: t, 碰撞数: hits.length }, { ...base, collisions: [hits], done: 1 + n * T + T + t + 1 }));
    });
    const candSet = new Set();
    candidates.forEach((id, k) => {
      candSet.add(id);
      steps.push(mk('candidate', `候选 #${id} 进入精排（出现在 query 桶中）；累计 ${candSet.size} 个不同候选。`,
        { 候选序: k + 1, 候选数: candSet.size },
        { ...base, candidates: Array.from(candSet), done: 1 + n * T + T + T + k + 1 }));
    });
    steps.push(mk('rank', `候选 ${candidates.length} 个；真正 top-5 近邻 [${trueNN.join(', ')}]，其中 ${trueNN.filter((id) => candidates.includes(id)).length} 个被召回。`,
      { 候选数: candidates.length, 召回率: r2(recall) },
      { ...base, candidates, top: trueNN, done: steps.length }));
    steps.push(mk('end', `LSH 召回率 ${F(recall)}：仅比较 ${candidates.length}/${n} 个文档。增加表数/位数可提升召回但增大桶开销。`,
      { 召回率: r2(recall), 扫描比例: r2(dv(candidates.length, n)) },
      { ...base, candidates, top: trueNN, done: steps.length + 1 }));
    return padSteps(steps, 20, '校验');
  },

  render(snap, p, c) {
    const H = 390;
    const T = Math.round(num(snap.T, 2));
    const B = Math.round(num(snap.B, 3));
    const nb = Math.pow(2, B);
    const buckets = snap.buckets && typeof snap.buckets === 'object' ? snap.buckets : {};
    const qcodes = Array.isArray(snap.qcode) ? snap.qcode : [];
    const candidates = Array.isArray(snap.candidates) ? snap.candidates : [];
    const collisions = Array.isArray(snap.collisions) ? snap.collisions : [];
    const top = Array.isArray(snap.top) ? snap.top : [];
    const cand = new Set(candidates);
    const bw = Math.min(22, 580 / Math.max(1, nb));
    return (
      <Frame c={c} height={H} title="LSH · 哈希桶与碰撞召回" subtitle={`${T} 表 × ${B} 位 · ${nb} 桶`}>
        <text x="20" y="44" fontSize="10" fill={c.muted}>每张哈希表：桶编号（二进制哈希）→ 落入的文档</text>
        {Array.from({ length: T }, (_, t) => {
          const y = 54 + t * Math.min(48, 250 / Math.max(1, T));
          const bk = buckets[t] || {};
          return (
            <g key={t}>
              <text x="20" y={y + 14} fontSize="10" fill={c.text}>{`表 ${t}`}</text>
              {Array.from({ length: nb }, (_, b) => {
                const code = b.toString(2).padStart(B, '0');
                const list = bk[code] || [];
                const isQ = qcodes[t] === code;
                return (
                  <g key={code}>
                    <rect x={64 + b * (bw + 2)} y={y} width={bw} height="30" rx="3"
                      fill={isQ ? c.warning : c.panel2} opacity={isQ ? 0.9 : 0.7} />
                    <text x={64 + b * (bw + 2) + bw / 2} y={y + 12} fontSize="8" textAnchor="middle" fill={isQ ? c.bg : c.muted}>{code}</text>
                    <text x={64 + b * (bw + 2) + bw / 2} y={y + 24} fontSize="8" textAnchor="middle" fill={isQ ? c.bg : c.text}>
                      {list.length ? `${list.length}篇` : '—'}
                    </text>
                  </g>
                );
              })}
            </g>
          );
        })}
        <line x1="18" y1="308" x2="702" y2="308" stroke={c.grid} strokeWidth="1" />
        <text x="20" y="326" fontSize="10" fill={c.muted}>query 哈希：</text>
        {qcodes.map((code, t) => <text key={t} x={100 + t * 70} y="326" fontSize="10" fill={c.warning}>{`t${t}=${code}`}</text>)}
        <text x="20" y="348" fontSize="10" fill={c.success}>候选文档：</text>
        {candidates.slice(0, 18).map((id, k) => chip(100 + k * 32, 336, `#${id}`, cand.has(id) && top.includes(id) ? c.success : c.primary, c, false, 28))}
        <text x="520" y="348" fontSize="10" fill={c.muted}>真近邻 {top.length} · 候选 {candidates.length}</text>
        {footer(c, snap, H, '相似向量更可能碰撞：P(碰撞) 随夹角减小而增大；多表取并集提升召回')}
      </Frame>
    );
  },
};

/* ================================================================ *
 * 8. 混合检索：关键词 + 向量双路融合
 * ================================================================ */
const hybridSearch = {
  params: [
    { key: 'topK', label: '返回 top-k', type: 'range', min: 1, max: 5, step: 1, default: 3 },
    { key: 'nDocs', label: '候选文档数', type: 'range', min: 8, max: 16, step: 2, default: 12 },
    { key: 'alpha', label: '关键词权重 α', type: 'range', min: 0, max: 1, step: 0.1, default: 0.5 },
    { key: 'seed', label: '随机种子', type: 'range', min: 1, max: 30, step: 1, default: 17 },
  ],
  height: 380,
  legend: [
    { label: '关键词检索分' }, { label: '向量检索分' }, { label: '融合分' }, { label: 'top-k 结果' },
  ],
  hint: '混合检索并行跑关键词与向量两路召回，各自归一化后按 α 加权融合，兼顾精确匹配与语义泛化。',

  buildSteps(p) {
    const K = Math.round(cp(p.topK, 1, 5));
    const n = Math.round(cp(p.nDocs, 8, 16));
    const a = cp(p.alpha, 0, 1);
    const seed = Math.round(cp(p.seed, 1, 30));
    const rnd = mulberry32(seed * 83 + n + K);
    const docs = Array.from({ length: n }, (_, i) => ({
      id: i,
      lex: rnd(),
      den: rnd(),
      rel: rnd() > 0.6,
    }));
    const nz = (arr) => {
      const lo = Math.min(...arr), hi = Math.max(...arr);
      return arr.map((v) => (hi - lo > 1e-9 ? (v - lo) / (hi - lo) : 0));
    };
    const lexN = nz(docs.map((d) => d.lex)), denN = nz(docs.map((d) => d.den));
    const fused = docs.map((d, i) => a * lexN[i] + (1 - a) * denN[i]);
    const ranked = docs.map((d, i) => ({ id: d.id, s: fused[i] })).sort((x, y) => y.s - x.s);
    const total = 1 + n * 3 + 2 + K + 1;
    const steps = [];
    const base = { docs, lexN, denN, alpha: a, fused: fused.slice(), ranked: ranked.map((r) => r.id), lexDone: 0, denDone: 0, fuseDone: 0, done: 0, total };

    steps.push(mk('init', `双路召回：关键词分支与向量分支各对 ${n} 篇文档打分，α=${F(a)} 控制融合权重。`,
      { 文档数: n, 关键词权重: r2(a) }, { ...base, done: 1 }));
    docs.forEach((d, i) => {
      steps.push(mk('lexical', `关键词分支 D${d.id}：原始分 ${F(d.lex)}，归一化 ${F(lexN[i])}；精确命中词项得分高。`,
        { 文档: d.id, 关键词分: r2(lexN[i]) }, { ...base, lexDone: i + 1, done: 1 + i + 1 }));
    });
    docs.forEach((d, i) => {
      steps.push(mk('dense', `向量分支 D${d.id}：原始分 ${F(d.den)}，归一化 ${F(denN[i])}；语义相近得分高。`,
        { 文档: d.id, 向量分: r2(denN[i]) }, { ...base, lexDone: n, denDone: i + 1, done: 1 + n + i + 1 }));
    });
    steps.push(mk('normalize', `两路分数各自 min-max 归一化到 [0,1]，消除量纲差异。`,
      { 文档数: n }, { ...base, lexDone: n, denDone: n, done: 1 + n * 2 + 1 }));
    docs.forEach((d, i) => {
      steps.push(mk('fuse', `融合 D${d.id}：α·lex=${F(a * lexN[i])} + (1−α)·den=${F((1 - a) * denN[i])} = ${F(fused[i])}。`,
        { 文档: d.id, 融合分: r4(fused[i]) }, { ...base, lexDone: n, denDone: n, fuseDone: i + 1, done: 2 + n * 2 + i + 1 }));
    });
    const selected = [];
    ranked.slice(0, K).forEach((r, k) => {
      selected.push(r.id);
      steps.push(mk('select', `取融合第 ${k + 1} 名 #${r.id}（分数 ${F(r.s)}），相关=${docs[r.id].rel ? '是' : '否'}。`,
        { 已选: selected.length, 命中相关: selected.filter((id) => docs[id].rel).length },
        { ...base, lexDone: n, denDone: n, fuseDone: n, selected: selected.slice(), done: 2 + n * 3 + k + 1 }));
    });
    const hits = selected.filter((id) => docs[id].rel).length;
    steps.push(mk('end', `返回 ${selected.length} 篇，命中相关 ${hits} 篇（精确率 ${F(dv(hits, selected.length))}）；调 α 观察两路贡献变化。`,
      { 已选: selected.length, 命中相关: hits, 精确率: r2(dv(hits, selected.length)) },
      { ...base, lexDone: n, denDone: n, fuseDone: n, selected: selected.slice(), done: steps.length + 1 }));
    return padSteps(steps, 20, '校验');
  },

  render(snap, p, c) {
    const H = 380;
    const docs = Array.isArray(snap.docs) ? snap.docs : [];
    const lexN = Array.isArray(snap.lexN) ? snap.lexN : [];
    const denN = Array.isArray(snap.denN) ? snap.denN : [];
    const fused = Array.isArray(snap.fused) ? snap.fused : [];
    const ranked = Array.isArray(snap.ranked) ? snap.ranked : [];
    const selected = Array.isArray(snap.selected) ? snap.selected : [];
    const sel = new Set(selected);
    const rankOf = Object.fromEntries(ranked.map((id, k) => [id, k + 1]));
    const rh = Math.min(24, 250 / Math.max(1, docs.length));
    const lexDone = num(snap.lexDone, 0), denDone = num(snap.denDone, 0), fuseDone = num(snap.fuseDone, 0);
    return (
      <Frame c={c} height={H} title="混合检索 · 双路加权融合" subtitle={`α=${F(snap.alpha, 2)} · top-${selected.length}`}>
        <text x="20" y="42" fontSize="9" fill={c.muted}>文档</text>
        <text x="70" y="42" fontSize="9" fill={c.primary}>关键词</text>
        <text x="250" y="42" fontSize="9" fill={c.purple}>向量</text>
        <text x="430" y="42" fontSize="9" fill={c.success}>融合</text>
        <text x="620" y="42" fontSize="9" fill={c.muted}>排名</text>
        {docs.map((d, i) => {
          const y = 50 + i * rh;
          const on = sel.has(d.id);
          return (
            <g key={d.id}>
              <rect x="18" y={y} width="684" height={Math.max(2, rh - 2)} rx="2"
                fill={on ? c.success : c.panel} opacity={on ? 0.2 : (i % 2 ? 0.5 : 0.85)} />
              <text x="22" y={y + rh / 2 + 3} fontSize="9" fill={c.text}>{`#${d.id}${d.rel ? '*' : ''}`}</text>
              {i < lexDone && <rect x="70" y={y + 3} width={140 * clamp(num(lexN[i], 0), 0, 1)} height={Math.max(2, rh - 8)} fill={c.primary} opacity="0.85" />}
              {i < denDone && <rect x="250" y={y + 3} width={140 * clamp(num(denN[i], 0), 0, 1)} height={Math.max(2, rh - 8)} fill={c.purple} opacity="0.85" />}
              {i < fuseDone && <rect x="430" y={y + 3} width={140 * clamp(num(fused[i], 0), 0, 1)} height={Math.max(2, rh - 8)} fill={c.success} opacity="0.9" />}
              <text x="620" y={y + rh / 2 + 3} fontSize="9" fill={c.text}>{fuseDone ? `#${num(rankOf[d.id], 0)}` : '—'}</text>
              <text x="660" y={y + rh / 2 + 3} fontSize="9" fill={c.muted}>{i < fuseDone ? F(fused[i]) : '—'}</text>
            </g>
          );
        })}
        {footer(c, snap, H, '融合分 = α·关键词分 + (1−α)·向量分；* 表示真正相关文档')}
      </Frame>
    );
  },
};

/* ================================================================ *
 * 9. RRF 倒数排名融合
 * ================================================================ */
const rrf = {
  params: [
    { key: 'nDocs', label: '候选数', type: 'range', min: 8, max: 16, step: 2, default: 12 },
    { key: 'k', label: 'RRF 常数 k', type: 'range', min: 5, max: 60, step: 5, default: 60 },
    { key: 'topK', label: '返回 top-k', type: 'range', min: 1, max: 5, step: 1, default: 3 },
    { key: 'seed', label: '随机种子', type: 'range', min: 1, max: 30, step: 1, default: 19 },
  ],
  height: 390,
  legend: [
    { label: '列表 A 排名贡献' }, { label: '列表 B 排名贡献' }, { label: 'RRF 总分' }, { label: '融合 top-k' },
  ],
  hint: 'RRF 按各路结果名次的倒数累加：score(d)=Σ 1/(k+rank(d))，无需分数归一化即可稳健融合多路列表。',

  buildSteps(p) {
    const n = Math.round(cp(p.nDocs, 8, 16));
    const kk = Math.round(cp(p.k, 5, 60));
    const K = Math.round(cp(p.topK, 1, 5));
    const seed = Math.round(cp(p.seed, 1, 30));
    const rnd = mulberry32(seed * 59 + n + kk);
    const docs = Array.from({ length: n }, (_, i) => ({ id: i, rel: rnd() > 0.6 }));
    const listA = docs.map((d) => ({ id: d.id, s: rnd() })).sort((a, b) => b.s - a.s).map((o) => o.id);
    const listB = docs.map((d) => ({ id: d.id, s: rnd() })).sort((a, b) => b.s - a.s).map((o) => o.id);
    const rankA = Object.fromEntries(listA.map((id, i) => [id, i + 1]));
    const rankB = Object.fromEntries(listB.map((id, i) => [id, i + 1]));
    const contribA = docs.map((d) => 1 / (kk + rankA[d.id]));
    const contribB = docs.map((d) => 1 / (kk + rankB[d.id]));
    const fused = docs.map((d, i) => contribA[i] + contribB[i]);
    const ranked = docs.map((d, i) => ({ id: d.id, s: fused[i] })).sort((a, b) => b.s - a.s).map((o) => o.id);
    const total = 1 + n + n + n + K + 1;
    const steps = [];
    const base = { docs, listA, listB, k: kk, fused: fused.slice(), ranked, revealA: 0, revealB: 0, fuseDone: 0, done: 0, total };

    steps.push(mk('init', `两路召回各返回 ${n} 个文档的有序列表；用 RRF（k=${kk}）按名次倒数融合，不需要分数归一化。`,
      { 候选数: n, k: kk }, { ...base, done: 1 }));
    listA.forEach((id, i) => {
      steps.push(mk('listA', `列表 A 第 ${i + 1} 名 #${id}：贡献 1/(${kk}+${i + 1}) = ${F(1 / (kk + i + 1), 4)}。`,
        { 列表: 1, 名次: i + 1, 贡献: r4(1 / (kk + i + 1)) }, { ...base, revealA: i + 1, done: 2 + i }));
    });
    listB.forEach((id, i) => {
      steps.push(mk('listB', `列表 B 第 ${i + 1} 名 #${id}：贡献 1/(${kk}+${i + 1}) = ${F(1 / (kk + i + 1), 4)}。`,
        { 列表: 2, 名次: i + 1, 贡献: r4(1 / (kk + i + 1)) }, { ...base, revealA: n, revealB: i + 1, done: 2 + n + i }));
    });
    docs.forEach((d, i) => {
      steps.push(mk('fuse', `#${d.id}：A 名次 ${rankA[d.id]} + B 名次 ${rankB[d.id]} → RRF = ${F(fused[i], 4)}。`,
        { 文档: d.id, A名次: rankA[d.id], B名次: rankB[d.id], RRF: r4(fused[i]) },
        { ...base, revealA: n, revealB: n, fuseDone: i + 1, done: 2 + n * 2 + i }));
    });
    const selected = [];
    ranked.slice(0, K).forEach((id, idx) => {
      selected.push(id);
      steps.push(mk('select', `融合第 ${idx + 1} 名 #${id}（A#${rankA[id]} / B#${rankB[id]}），相关=${docs[id].rel ? '是' : '否'}。`,
        { 已选: selected.length, 命中相关: selected.filter((x) => docs[x].rel).length },
        { ...base, revealA: n, revealB: n, fuseDone: n, selected: selected.slice(), done: 2 + n * 3 + idx }));
    });
    const hits = selected.filter((id) => docs[id].rel).length;
    steps.push(mk('end', `RRF top-${K} = [${selected.join(', ')}]，命中相关 ${hits} 篇；k 越大排名差异影响越小，融合越平滑。`,
      { 已选: selected.length, 命中相关: hits, 精确率: r2(dv(hits, selected.length)) },
      { ...base, revealA: n, revealB: n, fuseDone: n, selected: selected.slice(), done: steps.length + 1 }));
    return padSteps(steps, 20, '校验');
  },

  render(snap, p, c) {
    const H = 390;
    const docs = Array.isArray(snap.docs) ? snap.docs : [];
    const listA = Array.isArray(snap.listA) ? snap.listA : [];
    const listB = Array.isArray(snap.listB) ? snap.listB : [];
    const fused = Array.isArray(snap.fused) ? snap.fused : [];
    const ranked = Array.isArray(snap.ranked) ? snap.ranked : [];
    const selected = Array.isArray(snap.selected) ? snap.selected : [];
    const kk = num(snap.k, 60);
    const sel = new Set(selected);
    const rankA = Object.fromEntries(listA.map((id, i) => [id, i + 1]));
    const rankB = Object.fromEntries(listB.map((id, i) => [id, i + 1]));
    const maxF = Math.max(0.0001, ...fused);
    const revealA = num(snap.revealA, 0), revealB = num(snap.revealB, 0), fuseDone = num(snap.fuseDone, 0);
    const order = fuseDone > 0 && ranked.length ? ranked : docs.map((d) => d.id);
    const rh = Math.min(20, 240 / Math.max(1, docs.length));
    return (
      <Frame c={c} height={H} title="RRF · 倒数排名融合" subtitle={`k=${kk} · 融合 ${fuseDone}/${docs.length} · top-${selected.length}`}>
        <text x="20" y="42" fontSize="9" fill={c.muted}>文档</text>
        <text x="70" y="42" fontSize="9" fill={c.primary}>A 名次</text>
        <text x="170" y="42" fontSize="9" fill={c.purple}>B 名次</text>
        <text x="270" y="42" fontSize="9" fill={c.muted}>1/(k+rA)</text>
        <text x="390" y="42" fontSize="9" fill={c.muted}>1/(k+rB)</text>
        <text x="510" y="42" fontSize="9" fill={c.success}>RRF 总分</text>
        {order.map((id, i) => {
          const on = sel.has(id);
          const y = 50 + i * rh;
          return (
            <g key={id}>
              <rect x="18" y={y} width="684" height={Math.max(2, rh - 2)} rx="2"
                fill={on ? c.success : c.panel} opacity={on ? 0.22 : (i % 2 ? 0.5 : 0.85)} />
              <text x="22" y={y + rh / 2 + 3} fontSize="9" fill={c.text}>{`#${id}`}</text>
              <text x="70" y={y + rh / 2 + 3} fontSize="9" fill={c.primary}>{num(rankA[id], 99) <= revealA ? `#${num(rankA[id], 0)}` : '—'}</text>
              <text x="170" y={y + rh / 2 + 3} fontSize="9" fill={c.purple}>{num(rankB[id], 99) <= revealB ? `#${num(rankB[id], 0)}` : '—'}</text>
              <text x="270" y={y + rh / 2 + 3} fontSize="9" fill={c.muted}>{num(rankA[id], 99) <= revealA ? F(1 / (kk + num(rankA[id], 1)), 4) : '—'}</text>
              <text x="390" y={y + rh / 2 + 3} fontSize="9" fill={c.muted}>{num(rankB[id], 99) <= revealB ? F(1 / (kk + num(rankB[id], 1)), 4) : '—'}</text>
              {num(docs.findIndex((o) => o.id === id), 99) < fuseDone && <rect x="510" y={y + 2} width={160 * clamp(dv(num(fused[id], 0), maxF), 0, 1)} height={Math.max(2, rh - 6)} fill={c.success} opacity="0.85" />}
              <text x="676" y={y + rh / 2 + 3} fontSize="9" fill={c.text}>{num(docs.findIndex((o) => o.id === id), 99) < fuseDone ? F(num(fused[id], 0), 4) : '—'}</text>
            </g>
          );
        })}
        {footer(c, snap, H, 'RRF(d) = Σ 1/(k + rankᵢ(d))；只用名次，不依赖各路分数的尺度')}
      </Frame>
    );
  },
};

/* ================================================================ *
 * 10. 语义检索：embedding 相似度 + 交叉编码器重排
 * ================================================================ */
const semanticSearch = {
  params: [
    { key: 'nDocs', label: '候选文档数', type: 'range', min: 8, max: 16, step: 2, default: 12 },
    { key: 'topK', label: '最终 top-k', type: 'range', min: 1, max: 5, step: 1, default: 3 },
    { key: 'rerankW', label: '重排权重 w', type: 'range', min: 0, max: 1, step: 0.1, default: 0.6 },
    { key: 'metric', label: '召回相似度', type: 'select', default: 'cosine',
      options: [{ value: 'cosine', label: '余弦' }, { value: 'dot', label: '点积' }] },
    { key: 'seed', label: '随机种子', type: 'range', min: 1, max: 30, step: 1, default: 23 },
  ],
  height: 390,
  legend: [
    { label: '召回候选' }, { label: '重排候选池' }, { label: '重排后 top-k' }, { label: 'query 向量' },
  ],
  hint: '语义检索先用双塔 embedding 近似召回，再用交叉编码器对候选池精排；用语义相似度解决同义与表述差异。',

  buildSteps(p) {
    const n = Math.round(cp(p.nDocs, 8, 16));
    const K = Math.round(cp(p.topK, 1, 5));
    const w = cp(p.rerankW, 0, 1);
    const metric = p.metric === 'dot' ? 'dot' : 'cosine';
    const seed = Math.round(cp(p.seed, 1, 30));
    const rnd = mulberry32(seed * 89 + n + K);
    const ang = rnd() * Math.PI * 2;
    const q = { x: Math.cos(ang), y: Math.sin(ang) };
    const docs = Array.from({ length: n }, (_, i) => {
      const a = rnd() * Math.PI * 2;
      const len = 0.4 + rnd() * 0.55;
      const x = Math.cos(a) * len, y = Math.sin(a) * len;
      const cos = (q.x * x + q.y * y) / Math.max(1e-6, Math.hypot(x, y));
      const sim = metric === 'dot' ? q.x * x + q.y * y : cos;
      const cross = clamp(cos + (rnd() - 0.5) * 1.1, -1, 1);
      return { id: i, x, y, sim, cross, relevant: cos > 0.45 };
    });
    const bySim = docs.slice().sort((a, b) => b.sim - a.sim);
    const poolSize = Math.min(n, Math.max(K + 2, K * 2));
    const pool = bySim.slice(0, poolSize).map((d) => d.id);
    const rerank = pool.map((id) => ({ id, score: (1 - w) * docs[id].sim + w * docs[id].cross }))
      .sort((a, b) => b.score - a.score);
    const before = bySim.map((d) => d.id);
    const after = rerank.map((r) => r.id);
    const total = 1 + n + 1 + poolSize + poolSize + K + 1;
    const steps = [];
    const base = { docs, q, metric, before, after, pool, rerank, recalled: 0, rerankDone: 0, done: 0, total };

    steps.push(mk('encode', `编码查询 q 与 ${n} 篇文档到同一 embedding 空间（${metric}）；先做向量召回。`,
      { 候选数: n, 池大小: poolSize }, { ...base, done: 1 }));
    docs.forEach((d, i) => {
      steps.push(mk('recall', `D${d.id} embedding 相似度 ${F(d.sim)}${d.relevant ? '（语义相关）' : ''}。`,
        { 文档: d.id, 相似度: r4(d.sim) }, { ...base, recalled: i + 1, done: 2 + i }));
    });
    steps.push(mk('pool', `向量召回前 ${poolSize} 篇进入精排池：[${pool.join(', ')}]。`,
      { 池大小: poolSize }, { ...base, pool, recalled: n, done: 2 + n }));
    pool.forEach((id, k) => {
      steps.push(mk('cross', `交叉编码器评估 #${id}：cross=${F(docs[id].cross)}（捕捉词序与细粒度交互）。`,
        { 文档: id, 交叉分: r4(docs[id].cross) }, { ...base, pool, recalled: n, scored: pool.slice(0, k + 1), done: 3 + n + k }));
    });
    rerank.forEach((r, k) => {
      steps.push(mk('rerank', `重排 #${r.id}：(1−w)·sim + w·cross = ${F(r.score)}，当前第 ${k + 1} 位。`,
        { 文档: r.id, 重排分: r4(r.score), 名次: k + 1 },
        { ...base, pool, recalled: n, rerank: rerank.slice(0, k + 1), rerankDone: k + 1, done: 3 + n + poolSize + k }));
    });
    const selected = after.slice(0, K);
    selected.forEach((id, k) => {
      steps.push(mk('select', `最终第 ${k + 1} 名 #${id}：原召回名次 ${before.indexOf(id) + 1} → 重排名次 ${after.indexOf(id) + 1}。`,
        { 已选: k + 1 }, { ...base, recalled: n, rerankDone: poolSize, selected: selected.slice(0, k + 1), done: 3 + n + poolSize * 2 + k }));
    });
    const hits = selected.filter((id) => docs[id].relevant).length;
    steps.push(mk('end', `输出 top-${K} = [${selected.join(', ')}]，命中语义相关 ${hits} 篇；重排把交叉分高的文档提前。`,
      { 已选: K, 命中相关: hits, 精确率: r2(dv(hits, K)) },
      { ...base, recalled: n, rerankDone: poolSize, selected, done: steps.length + 1 }));
    return padSteps(steps, 20, '校验');
  },

  render(snap, p, c) {
    const H = 390;
    const docs = Array.isArray(snap.docs) ? snap.docs : [];
    const q = snap.q && typeof snap.q === 'object' ? snap.q : { x: 1, y: 0 };
    const before = Array.isArray(snap.before) ? snap.before : [];
    const after = Array.isArray(snap.after) ? snap.after : [];
    const pool = Array.isArray(snap.pool) ? snap.pool : [];
    const selected = Array.isArray(snap.selected) ? snap.selected : [];
    const recalled = num(snap.recalled, 0), rerankDone = num(snap.rerankDone, 0);
    const poolSet = new Set(rerankDone > 0 ? pool : []), selSet = new Set(selected);
    const cx = 150, cy = 190, R = 122;
    const px = (x) => cx + num(x, 0) * R, py = (y) => cy - num(y, 0) * R;
    const show = rerankDone > 0 ? after.slice(0, Math.min(8, Math.max(rerankDone, selected.length)))
      : before.slice(0, Math.min(8, Math.max(1, recalled)));
    return (
      <Frame c={c} height={H} title="语义检索 · 向量召回 + 交叉重排" subtitle={`${tx(snap.metric)} · 召回 ${recalled}/${docs.length} · 重排 ${rerankDone}/${pool.length}`}>
        <circle cx={cx} cy={cy} r={R} fill={c.panel} stroke={c.border} />
        <line x1={cx - R} y1={cy} x2={cx + R} y2={cy} stroke={c.grid} />
        <line x1={cx} y1={cy - R} x2={cx} y2={cy + R} stroke={c.grid} />
        <line x1={cx} y1={cy} x2={px(q.x)} y2={py(q.y)} stroke={c.danger} strokeWidth="3" />
        <circle cx={px(q.x)} cy={py(q.y)} r="6" fill={c.danger} />
        <text x={px(q.x) + 9} y={py(q.y) - 6} fontSize="10" fill={c.danger}>query</text>
        {docs.map((d) => (
          <circle key={d.id} cx={px(d.x)} cy={py(d.y)} r={selSet.has(d.id) ? 8 : (poolSet.has(d.id) ? 6 : 4)}
            fill={selSet.has(d.id) ? c.success : (poolSet.has(d.id) ? c.warning : (d.id < recalled ? c.primary : c.border))}
            opacity={selSet.has(d.id) ? 1 : (poolSet.has(d.id) ? 0.9 : (d.id < recalled ? 0.8 : 0.35))} />
        ))}
        <text x="320" y="42" fontSize="10" fill={c.muted}>召回排序 → 重排后排序（绿色 = top-k）</text>
        {show.map((id, k) => {
          const d = docs[id];
          if (!d) return null;
          const y = 54 + k * 30;
          const bIdx = before.indexOf(id), aIdx = after.indexOf(id);
          const moved = bIdx >= 0 && aIdx >= 0 && bIdx !== aIdx;
          return (
            <g key={id}>
              <rect x="320" y={y} width="382" height="26" rx="4" fill={selSet.has(id) ? c.success : c.panel}
                opacity={selSet.has(id) ? 0.22 : 1} stroke={selSet.has(id) ? c.success : c.border} />
              <text x="330" y={y + 17} fontSize="10" fill={c.text}>{`#${id}`}</text>
              <text x="372" y={y + 17} fontSize="10" fill={c.muted}>{`召回 #${bIdx + 1}`}</text>
              <text x="460" y={y + 17} fontSize="11" fill={moved ? c.warning : c.muted}>{moved ? '→' : '='}</text>
              <text x="500" y={y + 17} fontSize="10" fill={selSet.has(id) ? c.success : c.text}>{`重排 #${aIdx + 1}`}</text>
              <text x="620" y={y + 17} fontSize="10" fill={c.muted}>{`sim ${F(d.sim)}`}</text>
            </g>
          );
        })}
        {footer(c, snap, H, '双塔 embedding 召回候选 → 交叉编码器捕捉交互 → 加权分重排，兼顾效率与精度')}
      </Frame>
    );
  },
};

/* ================================================================ *
 * 11. 查询扩展：新增词与召回变化
 * ================================================================ */
const QE_CONCEPT = ['检索', '查询', '召回', '查寻'];
const QE_SYN = { '检索': ['查询', '召回'], '查询': ['检索', '召回'], '召回': ['检索', '查询'] };

const queryExpansion = {
  params: [
    { key: 'nDocs', label: '文档数', type: 'range', min: 8, max: 16, step: 2, default: 12 },
    { key: 'nExpand', label: '扩展词数', type: 'range', min: 1, max: 3, step: 1, default: 2 },
    { key: 'mode', label: '扩展方式', type: 'select', default: 'prf',
      options: [{ value: 'synonym', label: '同义词表' }, { value: 'prf', label: '伪相关反馈 PRF' }] },
    { key: 'seed', label: '随机种子', type: 'range', min: 1, max: 30, step: 1, default: 29 },
  ],
  height: 390,
  legend: [
    { label: '原查询命中' }, { label: '扩展新增命中' }, { label: '引入噪声' }, { label: '真正相关' },
  ],
  hint: '查询扩展用同义词或伪相关反馈补充查询词，把同义表述也召回回来，提升召回率但可能引入噪声。',

  buildSteps(p) {
    const n = Math.round(cp(p.nDocs, 8, 16));
    const ne = Math.round(cp(p.nExpand, 1, 3));
    const mode = p.mode === 'synonym' ? 'synonym' : 'prf';
    const seed = Math.round(cp(p.seed, 1, 30));
    const rnd = mulberry32(seed * 101 + n + ne);
    const vocab = ['检索', '查询', '召回', '查寻', '排序', '算法', '向量', '模型'];
    const docs = Array.from({ length: n }, (_, i) => {
      const rel = rnd() > 0.6;
      const terms = vocab.filter((t) => (QE_CONCEPT.includes(t) ? (rel ? 0.7 : 0.18) : 0.35) > rnd());
      return { id: i, rel, terms: uniq(terms.length ? terms : ['算法']) };
    });
    const orig = '检索';
    const baseline = docs.filter((d) => d.terms.includes(orig)).map((d) => d.id);
    let expand;
    if (mode === 'synonym') {
      expand = (QE_SYN[orig] || []).slice(0, ne);
    } else {
      const freq = {};
      baseline.forEach((id) => docs[id].terms.forEach((t) => { if (t !== orig) freq[t] = (freq[t] || 0) + 1; }));
      expand = Object.entries(freq).sort((a, b) => b[1] - a[1]).slice(0, ne).map((o) => o[0]);
    }
    if (expand.length < ne) expand = uniq([...expand, ...QE_CONCEPT.filter((t) => t !== orig)]).slice(0, ne);
    const after = docs.filter((d) => d.terms.includes(orig) || d.terms.some((t) => expand.includes(t))).map((d) => d.id);
    const newHits = after.filter((id) => !baseline.includes(id) && docs[id].rel);
    const noise = after.filter((id) => !baseline.includes(id) && !docs[id].rel);
    const relTotal = docs.filter((d) => d.rel).length;
    const rec0 = relTotal ? baseline.filter((id) => docs[id].rel).length / relTotal : 0;
    const rec1 = relTotal ? after.filter((id) => docs[id].rel).length / relTotal : 0;
    const total = 1 + n + 1 + expand.length + n + 1 + newHits.length + noise.length + 1;
    const steps = [];
    const base = { docs, vocab, orig, expand, baseline, after, newHits, noise, mode, rec0, rec1, done: 0, total };

    steps.push(mk('init', `原始查询「${orig}」；语料 ${n} 篇（真正相关 ${relTotal} 篇）。采用${mode === 'synonym' ? '同义词表' : '伪相关反馈'}扩展。`,
      { 文档数: n, 相关数: relTotal }, { ...base, done: 1 }));
    docs.forEach((d, i) => {
      steps.push(mk('score', `D${d.id} 词项 [${d.terms.join('、')}]：${d.terms.includes(orig) ? '命中原查询' : '未命中'}，相关=${d.rel ? '是' : '否'}。`,
        { 文档: d.id, 命中原查询: d.terms.includes(orig) ? 1 : 0 }, { ...base, done: 2 + i }));
    });
    steps.push(mk('baseline', `原查询召回 ${baseline.length} 篇，其中相关 ${baseline.filter((id) => docs[id].rel).length} 篇，召回率 ${F(rec0)}。`,
      { 原召回: baseline.length, 原召回率: r2(rec0) }, { ...base, done: 2 + n }));
    expand.forEach((t, k) => {
      steps.push(mk('expand', `加入第 ${k + 1} 个扩展词「${t}」（${mode === 'synonym' ? '同义词' : '来自初始结果的高频词'}），权重 ${F(1 - 0.2 * k)}。`,
        { 扩展序: k + 1, 扩展词数: k + 1 }, { ...base, expand: expand.slice(0, k + 1), done: 3 + n + k }));
    });
    docs.forEach((d, i) => {
      const hit = d.terms.includes(orig) || d.terms.some((t) => expand.includes(t));
      steps.push(mk('rescore', `扩展后 D${d.id}：${hit ? '被召回' : '仍未命中'}${hit && !baseline.includes(d.id) ? (d.rel ? '（新增相关）' : '（噪声）') : ''}。`,
        { 文档: d.id, 被召回: hit ? 1 : 0 }, { ...base, expand, after: after.slice(0, i + 1), done: 3 + n + expand.length + i }));
    });
    newHits.forEach((id, k) => {
      steps.push(mk('newhit', `新增召回 #${id}：含扩展词且真正相关，召回率提升到 ${F(rec1)}。`,
        { 新增命中: k + 1, 召回率: r2(rec1) }, { ...base, expand, after, done: 3 + n * 2 + expand.length + k }));
    });
    noise.forEach((id, k) => {
      steps.push(mk('noise', `噪声 #${id}：含扩展词但不相关，扩展可能牺牲精确率。`,
        { 噪声数: k + 1 }, { ...base, expand, after, done: 3 + n * 2 + expand.length + newHits.length + k }));
    });
    steps.push(mk('end', `扩展后召回 ${after.length} 篇，召回率 ${F(rec0)} → ${F(rec1)}（+${F(rec1 - rec0)}），新增相关 ${newHits.length} 篇、噪声 ${noise.length} 篇。`,
      { 召回率: r2(rec1), 原召回率: r2(rec0), 新增相关: newHits.length, 噪声: noise.length },
      { ...base, expand, after, done: steps.length + 1 }));
    return padSteps(steps, 20, '校验');
  },

  render(snap, p, c) {
    const H = 390;
    const docs = Array.isArray(snap.docs) ? snap.docs : [];
    const orig = tx(snap.orig || '检索');
    const expand = Array.isArray(snap.expand) ? snap.expand : [];
    const baseline = Array.isArray(snap.baseline) ? snap.baseline : [];
    const after = Array.isArray(snap.after) ? snap.after : [];
    const newHits = Array.isArray(snap.newHits) ? snap.newHits : [];
    const noise = Array.isArray(snap.noise) ? snap.noise : [];
    const baseSet = new Set(baseline), afterSet = new Set(after);
    return (
      <Frame c={c} height={H} title="查询扩展 · 新增词与召回变化" subtitle={`原查询「${orig}」+ ${expand.length} 个扩展词`}>
        <text x="20" y="42" fontSize="10" fill={c.muted}>查询词：</text>
        {chip(80, 30, orig, c.primary, c, true, 54)}
        {expand.map((t, k) => chip(146 + k * 56, 30, t, c.warning, c, false, 52))}

        <text x="20" y="76" fontSize="10" fill={c.muted}>文档召回状态（* = 真正相关）</text>
        {docs.map((d, i) => {
          const y = 86 + i * Math.min(20, 230 / Math.max(1, docs.length));
          const inBase = baseSet.has(d.id), inAfter = afterSet.has(d.id);
          const color = inBase ? c.primary : (newHits.includes(d.id) ? c.success : (noise.includes(d.id) ? c.danger : c.panel2));
          return (
            <g key={d.id}>
              <rect x="20" y={y} width="320" height={Math.max(2, Math.min(20, 230 / Math.max(1, docs.length)) - 2)} rx="2"
                fill={color} opacity={inBase || inAfter ? 0.8 : 0.35} />
              <text x="28" y={y + 12} fontSize="9" fill={inBase || inAfter ? c.bg : c.text}>
                {`D${d.id}${d.rel ? '*' : ''} [${d.terms.join('、')}]`}
              </text>
              <text x="350" y={y + 12} fontSize="9" fill={inBase ? c.primary : (inAfter ? c.success : c.muted)}>
                {inBase ? '原命中' : (inAfter ? (d.rel ? '新增命中' : '噪声') : '未召回')}
              </text>
            </g>
          );
        })}

        <rect x="460" y="86" width="242" height="220" rx="8" fill={c.panel} stroke={c.border} />
        <text x="476" y="112" fontSize="11" fill={c.text}>召回效果</text>
        <text x="476" y="142" fontSize="10" fill={c.muted}>原查询命中 {baseline.length} 篇</text>
        <text x="476" y="166" fontSize="10" fill={c.success}>扩展后命中 {after.length} 篇</text>
        <text x="476" y="194" fontSize="10" fill={c.success}>新增相关 {newHits.length} 篇</text>
        <text x="476" y="218" fontSize="10" fill={c.danger}>引入噪声 {noise.length} 篇</text>
        <text x="476" y="250" fontSize="11" fill={c.primary}>{`召回率 ${F(num(snap.rec1, 0))}`}</text>
        <text x="476" y="276" fontSize="9" fill={c.muted}>扩展提升召回但可能降低精确率</text>
        {footer(c, snap, H, '扩展词来自同义词表或伪相关反馈（PRF）的初始高分文档；与原查询取并集')}
      </Frame>
    );
  },
};

/* ================================================================ *
 * 12. BPR 贝叶斯个性化排序：pairwise 样本与梯度
 * ================================================================ */
const bpr = {
  params: [
    { key: 'nUsers', label: '用户数', type: 'range', min: 4, max: 8, step: 1, default: 6 },
    { key: 'nItems', label: '物品数', type: 'range', min: 8, max: 16, step: 2, default: 12 },
    { key: 'factors', label: '隐向量维度 k', type: 'range', min: 2, max: 8, step: 1, default: 4 },
    { key: 'lr', label: '学习率', type: 'range', min: 0.01, max: 0.2, step: 0.01, default: 0.05 },
    { key: 'iterations', label: '迭代次数', type: 'range', min: 10, max: 60, step: 10, default: 30 },
  ],
  height: 390,
  legend: [
    { label: '正样本 i+' }, { label: '负样本 j−' }, { label: '梯度上升' }, { label: '损失曲线' },
  ],
  hint: 'BPR 从隐式反馈采样 (u, i+, j−)，最大化「用户偏好正样本胜过未观测样本」的概率，用 SGD 更新隐向量。',

  buildSteps(p) {
    const nu = Math.round(cp(p.nUsers, 4, 8));
    const ni = Math.round(cp(p.nItems, 8, 16));
    const k = Math.round(cp(p.factors, 2, 8));
    const lr = cp(p.lr, 0.01, 0.2);
    const T = Math.round(cp(p.iterations, 10, 60));
    const rnd = mulberry32(2024 + nu * 13 + ni * 7 + k);
    const obs = Array.from({ length: nu }, () => Array.from({ length: ni }, () => rnd() > 0.72));
    const P = Array.from({ length: nu }, () => Array.from({ length: k }, () => (rnd() - 0.5) * 0.4));
    const Q = Array.from({ length: ni }, () => Array.from({ length: k }, () => (rnd() - 0.5) * 0.4));
    const dot = (a, b) => a.reduce((s, v, d) => s + v * b[d], 0);
    const loss = [];
    const acc = [];
    const steps = [];
    const base = { obs, nu, ni, k, lr, T, done: 0, total: 1 + T * 2 + 1 };

    steps.push(mk('init', `隐式反馈矩阵 ${nu}×${ni}（已观测为正样本），初始化用户/物品隐向量维度 k=${k}。`,
      { 用户数: nu, 物品数: ni, 维度: k }, { ...base, loss: [], acc: [], iter: 0 }));

    for (let t = 1; t <= T; t++) {
      const u = Math.floor(rnd() * nu);
      const pos = Array.from({ length: ni }, (_, i) => i).filter((i) => obs[u][i]);
      const neg = Array.from({ length: ni }, (_, i) => i).filter((i) => !obs[u][i]);
      if (!pos.length || !neg.length) continue;
      const i = pos[Math.floor(rnd() * pos.length)];
      const j = neg[Math.floor(rnd() * neg.length)];
      const diff = Q[i].map((v, d) => v - Q[j][d]);
      const x = dot(P[u], diff);
      const s = sg(x);
      const reg = 0.002;
      const bprLoss = -Math.log(Math.max(1e-9, s)) + reg * (P[u].reduce((a, v) => a + v * v, 0) + dot(Q[i], Q[i]) + dot(Q[j], Q[j]));
      const gP = P[u].map((_, d) => s * diff[d] - reg * P[u][d]);
      const oldQ = Q[i].map((v, d) => v - lr * (s * P[u][d] - reg * v));
      const oldQj = Q[j].map((v, d) => v - lr * (-s * P[u][d] - reg * v));
      const gradMag = Math.sqrt(gP.reduce((a, v) => a + v * v, 0));
      steps.push(mk('sample', `第 ${t}/${T} 轮采样三元组 (u=${u}, i+=${i}, j−=${j})：x=${F(x)}，sigmoid=${F(s)}，BPR 损失=${F(bprLoss)}，梯度模 ${F(gradMag)}。`,
        { 迭代: t, 用户: u, 正样本: i, 负样本: j, BPR损失: r4(bprLoss), 梯度模: r4(gradMag) },
        { ...base, loss: loss.slice(), acc: acc.slice(), iter: t, sample: { u, i, j, x, s, gradMag } }));
      P[u] = P[u].map((v, d) => v + lr * gP[d]);
      Q[i] = oldQ; Q[j] = oldQj;
      loss.push(bprLoss);
      acc.push(s >= 0.5 ? 1 : 0);
      const recent = acc.slice(-20);
      const a20 = recent.length ? recent.reduce((a, b) => a + b, 0) / recent.length : 0;
      steps.push(mk('update', `第 ${t} 轮 SGD 更新 u、i+、j− 的隐向量；近 20 次成对正确率 ${F(a20)}，累计损失 ${F(loss.reduce((a, b) => a + b, 0))}。`,
        { 迭代: t, 成对正确率: r2(a20), 累计损失: r2(loss.reduce((a, b) => a + b, 0)) },
        { ...base, loss: loss.slice(), acc: acc.slice(), iter: t, sample: { u, i, j, x, s, gradMag } }));
    }
    const recent = acc.slice(-20);
    const finalAcc = recent.length ? recent.reduce((a, b) => a + b, 0) / recent.length : 0;
    steps.push(mk('end', `训练完成 ${T} 轮：末段成对正确率 ${F(finalAcc)}，损失 ${F(loss.length ? loss[loss.length - 1] : 0)}。BPR 只优化相对偏好，不拟合绝对评分。`,
      { 迭代: T, 成对正确率: r2(finalAcc), 末轮损失: r4(loss.length ? loss[loss.length - 1] : 0) },
      { ...base, loss: loss.slice(), acc: acc.slice(), iter: T, sample: { u: 0, i: 0, j: 0, x: 0, s: 0.5, gradMag: 0 } }));
    return padSteps(steps, 20, '校验');
  },

  render(snap, p, c) {
    const H = 390;
    const obs = Array.isArray(snap.obs) ? snap.obs : [];
    const loss = Array.isArray(snap.loss) ? snap.loss : [];
    const sample = snap.sample && typeof snap.sample === 'object' ? snap.sample : { u: -1, i: -1, j: -1, x: 0, s: 0.5, gradMag: 0 };
    const u = num(sample.u, -1), i = num(sample.i, -1), j = num(sample.j, -1);
    const cw = Math.max(14, Math.min(28, 260 / Math.max(1, snap.ni || 1)));
    const maxLoss = Math.max(0.001, ...loss);
    const line = loss.map((v, k) => `${40 + (k / Math.max(1, loss.length - 1)) * 300},${280 - (num(v, 0) / maxLoss) * 90}`).join(' ');
    return (
      <Frame c={c} height={H} title="BPR · 成对偏好与梯度" subtitle={`迭代 ${num(snap.iter, 0)}/${num(snap.T, 0)} · k=${num(snap.k, 0)} · lr=${F(snap.lr)}`}>
        <text x="20" y="44" fontSize="10" fill={c.muted}>用户 × 物品隐式反馈（深色 = 已观测正样本）</text>
        {(obs.length ? obs : []).map((row, uu) => (
          <g key={uu}>
            {row.map((v, ii) => {
              const isPos = uu === u && ii === i, isNeg = uu === u && ii === j;
              return <rect key={ii} x={20 + ii * (cw + 1)} y={54 + uu * (cw + 1)} width={cw} height={cw} rx="2"
                fill={isPos ? c.success : (isNeg ? c.danger : (v ? c.primary : c.panel2))}
                opacity={v || isPos || isNeg ? 0.9 : 0.4} />;
            })}
          </g>
        ))}
        <text x="20" y={62 + obs.length * (cw + 1)} fontSize="9" fill={c.success}>i+ 正样本</text>
        <text x="90" y={62 + obs.length * (cw + 1)} fontSize="9" fill={c.danger}>j− 负样本</text>

        <rect x="360" y="54" width="340" height="150" rx="8" fill={c.panel} stroke={c.border} />
        <text x="376" y="78" fontSize="11" fill={c.text}>三元组 (u, i+, j−)</text>
        <text x="376" y="102" fontSize="10" fill={c.muted}>{`用户 u=${u} · 正样本 i+=${i} · 负样本 j−=${j}`}</text>
        <text x="376" y="126" fontSize="10" fill={c.primary}>{`x = p_u·(q_i − q_j) = ${F(sample.x)}`}</text>
        <text x="376" y="150" fontSize="10" fill={c.purple}>{`sigmoid(x) = ${F(sample.s)}`}</text>
        <rect x="376" y="166" width={Math.min(300, Math.max(2, num(sample.s, 0) * 300))} height="14" rx="4" fill={c.warning} opacity="0.85" />
        <text x="376" y="194" fontSize="9" fill={c.muted}>{`梯度模 ||∇|| = ${F(sample.gradMag)}`}</text>

        <text x="20" y={62 + obs.length * (cw + 1) + 40} fontSize="10" fill={c.muted}>BPR 损失曲线</text>
        <line x1="40" y1="280" x2="340" y2="280" stroke={c.grid} />
        <line x1="40" y1="190" x2="40" y2="280" stroke={c.grid} />
        {loss.length > 1 && <polyline points={line} fill={c.bg} fillOpacity="0" stroke={c.primary} strokeWidth="2" />}
        <text x="360" y="280" fontSize="10" fill={c.muted}>{`末轮损失 ${F(loss.length ? loss[loss.length - 1] : 0)} · 样本数 ${loss.length}`}</text>
        {footer(c, snap, H, 'L_BPR = −ln σ(p_u·(q_i−q_j)) + λ||Θ||²；只建模「喜欢 i+ 胜过 j−」的相对偏好')}
      </Frame>
    );
  },
};

/* ================================================================ *
 * 13. NDCG：排序变化与 DCG / IDCG
 * ================================================================ */
const ndcg = {
  params: [
    { key: 'nItems', label: '物品数', type: 'range', min: 8, max: 16, step: 2, default: 12 },
    { key: 'K', label: '评估位置 K', type: 'range', min: 2, max: 8, step: 1, default: 5 },
    { key: 'gain', label: '增益方式', type: 'select', default: 'exp',
      options: [{ value: 'linear', label: '线性增益 rel' }, { value: 'exp', label: '指数增益 2^rel−1' }] },
    { key: 'seed', label: '随机种子', type: 'range', min: 1, max: 30, step: 1, default: 31 },
  ],
  height: 390,
  legend: [
    { label: '当前排序相关性' }, { label: '理想排序相关性' }, { label: '正在计算的位置' }, { label: 'NDCG' },
  ],
  hint: 'NDCG 按位置对数折扣累加相关性增益，再除以理想排序的 DCG；越相关的结果排在越前，NDCG 越接近 1。',

  buildSteps(p) {
    const n = Math.round(cp(p.nItems, 8, 16));
    const K = Math.round(cp(p.K, 2, 8));
    const gain = p.gain === 'linear' ? 'linear' : 'exp';
    const seed = Math.round(cp(p.seed, 1, 30));
    const rnd = mulberry32(seed * 107 + n + K);
    const items = Array.from({ length: n }, (_, i) => ({ id: i, rel: Math.floor(rnd() * 4) }));
    const g = (rel) => (gain === 'exp' ? Math.pow(2, rel) - 1 : rel);
    let ranking = items.slice().sort(() => rnd() - 0.5).map((o) => o.id);
    const relOf = Object.fromEntries(items.map((o) => [o.id, o.rel]));
    const ideal = items.slice().sort((a, b) => b.rel - a.rel).map((o) => o.id);
    const dcgAt = (order, kk) => order.slice(0, kk).reduce((s, id, i) => s + g(relOf[id]) / Math.log2(i + 2), 0);
    const idcg = dcgAt(ideal, Math.min(K, n));
    const ndcgOf = (order) => (idcg > 0 ? dcgAt(order, Math.min(K, n)) / idcg : 0);
    const total = 1 + n + 1 + K * 2 + n + 1;
    const steps = [];
    const base = { items, relOf, ideal, gain, K, n, ranking: ranking.slice(), done: 0, total };

    steps.push(mk('init', `语料 ${n} 个物品，相关性 0~3，增益方式=${gain === 'exp' ? '2^rel−1' : 'rel'}；先打乱得到初始排序。`,
      { 物品数: n, 位置K: K }, { ...base, done: 1 }));
    items.forEach((it, k) => {
      steps.push(mk('rel', `物品 #${it.id} 相关性 rel=${it.rel}，增益 g=${F(g(it.rel))}。`,
        { 物品: it.id, rel: it.rel, 增益: r2(g(it.rel)) }, { ...base, done: 2 + k }));
    });
    steps.push(mk('ideal', `理想排序按 rel 降序：[${ideal.slice(0, 6).join(', ')}]，IDCG@${K}=${F(idcg)}。`,
      { IDCG: r4(idcg), 位置K: K }, { ...base, done: 2 + n }));

    for (let pos = 0; pos < Math.min(K, n); pos++) {
      steps.push(mk('dcg', `当前排序第 ${pos + 1} 位 #${ranking[pos]}：增益 ${F(g(relOf[ranking[pos]]))} / log2(${pos + 2}) = ${F(g(relOf[ranking[pos]]) / Math.log2(pos + 2))}；累计 DCG=${F(dcgAt(ranking, pos + 1))}。`,
        { 位置: pos + 1, 累计DCG: r4(dcgAt(ranking, pos + 1)), NDCG: r4(ndcgOf(ranking)) },
        { ...base, pos, done: 3 + n + pos }));
    }
    for (let pos = 0; pos < Math.min(K, n); pos++) {
      steps.push(mk('idcg', `理想排序第 ${pos + 1} 位 #${ideal[pos]}：增益 ${F(g(relOf[ideal[pos]]))} / log2(${pos + 2})；累计 IDCG=${F(dcgAt(ideal, pos + 1))}。`,
        { 位置: pos + 1, 累计IDCG: r4(dcgAt(ideal, pos + 1)) },
        { ...base, pos, done: 3 + n + K + pos }));
    }

    for (let pos = 0; pos < Math.min(K, n); pos++) {
      let best = pos;
      for (let q = pos + 1; q < n; q++) if (relOf[ranking[q]] > relOf[ranking[best]]) best = q;
      const before = ndcgOf(ranking);
      [ranking[pos], ranking[best]] = [ranking[best], ranking[pos]];
      const after = ndcgOf(ranking);
      steps.push(mk('swap', `把更相关的 #${ranking[pos]} 交换到第 ${pos + 1} 位：NDCG@${K} ${F(before)} → ${F(after)}。`,
        { 位置: pos + 1, NDCG: r4(after), 提升: r4(after - before) },
        { ...base, ranking: ranking.slice(), pos, done: 3 + n + K * 2 + pos }));
    }
    steps.push(mk('end', `优化后排序 [${ranking.slice(0, 6).join(', ')}]，NDCG@${K}=${F(ndcgOf(ranking))}（理想为 1）。高相关结果越靠前，NDCG 越高。`,
      { NDCG: r4(ndcgOf(ranking)), 位置K: K, 最高rel: Math.max(...items.map((o) => o.rel)) },
      { ...base, ranking: ranking.slice(), pos: -1, done: steps.length + 1 }));
    return padSteps(steps, 20, '校验');
  },

  render(snap, p, c) {
    const H = 390;
    const items = Array.isArray(snap.items) ? snap.items : [];
    const ranking = Array.isArray(snap.ranking) ? snap.ranking : [];
    const ideal = Array.isArray(snap.ideal) ? snap.ideal : [];
    const relOf = snap.relOf && typeof snap.relOf === 'object' ? snap.relOf : {};
    const K = Math.round(num(snap.K, 5));
    const pos = num(snap.pos, -1);
    const g = (rel) => (snap.gain === 'linear' ? num(rel, 0) : Math.pow(2, num(rel, 0)) - 1);
    const dcg = ranking.slice(0, K).reduce((s, id, i) => s + g(relOf[id]) / Math.log2(i + 2), 0);
    const idcg = ideal.slice(0, K).reduce((s, id, i) => s + g(relOf[id]) / Math.log2(i + 2), 0);
    const ndcg = idcg > 0 ? dcg / idcg : 0;
    const show = ranking.slice(0, Math.max(K, 6));
    const rh = Math.min(28, 250 / Math.max(1, show.length));
    return (
      <Frame c={c} height={H} title="NDCG · 排序质量评估" subtitle={`K=${K} · 增益 ${snap.gain === 'linear' ? 'rel' : '2^rel−1'}`}>
        <text x="20" y="42" fontSize="10" fill={c.muted}>当前排序（条形长度 = 相关性 rel）</text>
        {show.map((id, k) => {
          const rel = num(relOf[id], 0);
          const on = pos === k;
          const y = 50 + k * rh;
          return (
            <g key={id}>
              <rect x="20" y={y} width="330" height={Math.max(2, rh - 3)} rx="3"
                fill={on ? c.warning : c.panel} opacity={on ? 0.85 : (k % 2 ? 0.6 : 0.9)}
                stroke={on ? c.text : c.border} />
              <text x="28" y={y + rh / 2 + 3} fontSize="10" fill={on ? c.bg : c.text}>{`${k + 1}. #${id}  rel=${rel}`}</text>
              <rect x="200" y={y + 3} width={rel * 26} height={Math.max(2, rh - 9)} rx="2" fill={c.primary} opacity="0.85" />
              <text x="320" y={y + rh / 2 + 3} fontSize="9" fill={c.muted}>{F(g(rel) / Math.log2(k + 2))}</text>
            </g>
          );
        })}
        <rect x="380" y="50" width="322" height="190" rx="8" fill={c.panel} stroke={c.border} />
        <text x="396" y="76" fontSize="11" fill={c.text}>DCG / IDCG 对比</text>
        <text x="396" y="104" fontSize="10" fill={c.primary}>{`DCG@${K}  = ${F(dcg)}`}</text>
        <text x="396" y="130" fontSize="10" fill={c.purple}>{`IDCG@${K} = ${F(idcg)}`}</text>
        <text x="396" y="162" fontSize="14" fill={c.success}>{`NDCG@${K} = ${F(ndcg)}`}</text>
        <rect x="396" y="178" width="290" height="12" rx="4" fill={c.panel2} />
        <rect x="396" y="178" width={290 * clamp(ndcg, 0, 1)} height="12" rx="4" fill={c.success} opacity="0.9" />
        <text x="396" y="216" fontSize="9" fill={c.muted}>理想排序：</text>
        <text x="396" y="232" fontSize="9" fill={c.muted}>{ideal.slice(0, 10).map((id) => `#${id}`).join(' ')}</text>
        {footer(c, snap, H, 'DCG@K = Σ (2^rel−1)/log2(i+1)；NDCG = DCG/IDCG，越接近 1 排序越好')}
      </Frame>
    );
  },
};

export default {
  'boolean-retrieval': booleanRetrieval,
  'inverted-index': invertedIndex,
  'tf-idf': tfidf,
  'pagerank-ir': pagerankIR,
  'vector-retrieval': vectorRetrieval,
  'ann-search': annSearch,
  'lsh': lsh,
  'hybrid-search': hybridSearch,
  'reciprocal-rank-fusion': rrf,
  'semantic-search': semanticSearch,
  'query-expansion': queryExpansion,
  'bpr': bpr,
  'ndcg': ndcg,
};
