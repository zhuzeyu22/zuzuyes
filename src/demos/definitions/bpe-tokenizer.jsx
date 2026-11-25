import React from 'react';
import { clamp } from '../utils.js';

const W = 720;
const H = 340;

// 语料：每个词条为 [文本, 频次]，BPE 在字符级上统计与合并
const CORPORA = {
  zh: {
    name: '中文示例句',
    words: [
      ['我爱算法', 3], ['我爱学习', 2], ['学习算法', 2],
      ['大模型', 2], ['大模型算法', 3], ['算法模型', 1], ['我爱大模型', 2],
    ],
  },
  en: {
    name: '英文示例句',
    words: [
      ['low', 5], ['lower', 2], ['newest', 6],
      ['widest', 3], ['new', 2], ['wide', 1], ['lowest', 2],
    ],
  },
  mix: {
    name: '中英混合',
    words: [
      ['我爱LLM', 3], ['LLM算法', 2], ['大模型LLM', 2],
      ['AI模型', 2], ['算法AI', 1], ['我爱AI', 2], ['大模型', 2],
    ],
  },
};

function finalize(steps) {
  if (steps.length > 300) {
    const stride = Math.ceil(steps.length / 300);
    return steps.filter((_, i) => i % stride === 0 || i === steps.length - 1);
  }
  const out = steps.slice();
  const last = out[out.length - 1] || { note: '完成', metrics: {} };
  while (out.length < 15) out.push({ ...last, note: '保持最终状态：' + (last.note || '') });
  return out;
}

// 统计所有相邻符号对的总频次（按词频加权）
function countPairs(words) {
  const m = new Map();
  for (const w of words) {
    for (let i = 0; i < w.symbols.length - 1; i++) {
      const key = w.symbols[i] + '|' + w.symbols[i + 1];
      m.set(key, (m.get(key) || 0) + w.freq);
    }
  }
  return m;
}

function applyMerge(words, a, b, merged) {
  for (const w of words) {
    const out = [];
    for (let i = 0; i < w.symbols.length; i++) {
      if (i < w.symbols.length - 1 && w.symbols[i] === a && w.symbols[i + 1] === b) {
        out.push(merged);
        i++;
      } else {
        out.push(w.symbols[i]);
      }
    }
    w.symbols = out;
  }
}

export default {
  id: 'bpe-tokenizer',
  params: [
    { key: 'merges', label: '合并轮数', type: 'range', min: 1, max: 12, step: 1, default: 6 },
    { key: 'vocabMax', label: '词表上限', type: 'range', min: 20, max: 60, step: 2, default: 40 },
    { key: 'corpus', label: '语料', type: 'select', default: 'zh', options: [
      { value: 'zh', label: '中文示例句' },
      { value: 'en', label: '英文示例句' },
      { value: 'mix', label: '中英混合' },
    ] },
    { key: 'showFreq', label: '显示频次', type: 'toggle', default: true },
  ],
  height: H,
  legend: [
    { label: '语料切分' }, { label: '最高频相邻对' },
    { label: '新合并的子词' }, { label: '当前词表' },
  ],
  hint: 'BPE 从字符开始，反复合并出现最频繁的相邻符号对，逐步构造子词词表。',

  buildSteps(p) {
    const corpus = CORPORA[p.corpus] || CORPORA.zh;
    const mergesWant = clamp(Math.round(Number(p.merges) || 6), 1, 12);
    const vocabMax = clamp(Math.round(Number(p.vocabMax) || 40), 12, 80);
    const showFreq = !!p.showFreq;

    const words = corpus.words.map(([txt, freq]) => ({ txt, freq, symbols: Array.from(txt) }));
    const baseChars = [];
    for (const w of words) for (const s of w.symbols) if (!baseChars.includes(s)) baseChars.push(s);
    const vocab = baseChars.slice();
    const rules = [];
    const steps = [];

    const snap = (note, extra = {}) => {
      const tokenTotal = words.reduce((s, w) => s + w.symbols.length, 0);
      const charTotal = words.reduce((s, w) => s + Array.from(w.txt).length, 0);
      steps.push({
        words: words.map((w) => ({ txt: w.txt, freq: w.freq, symbols: w.symbols.slice() })),
        vocab: vocab.slice(),
        rules: rules.map((r) => ({ ...r })),
        corpusName: corpus.name, showFreq, vocabMax,
        note,
        metrics: {
          合并轮次: rules.length,
          词表大小: vocab.length,
          语料Token数: tokenTotal,
          压缩率: charTotal ? (tokenTotal / charTotal).toFixed(2) : '1.00',
          剩余相邻对: countPairs(words).size,
        },
        ...extra,
      });
    };

    snap('初始：语料按字符切分，每个字符是独立符号，词表仅含单字符。', { phase: 'init', initCount: 0 });
    for (let i = 0; i < words.length; i++) {
      snap(`词「${words[i].txt}」频次 ${words[i].freq}，初始切分为 ${Array.from(words[i].txt).join(' / ')}。`,
        { phase: 'init', initCount: i + 1 });
    }
    snap(`基础词表共 ${vocab.length} 个字符：${vocab.join(' ')}。开始统计相邻符号对。`, { phase: 'vocab' });

    for (let round = 0; round < mergesWant; round++) {
      if (vocab.length >= vocabMax) break;
      const pairMap = countPairs(words);
      if (pairMap.size === 0) break;
      const sorted = [...pairMap.entries()].sort((x, y) => y[1] - x[1] || x[0].localeCompare(y[0]));
      const bestKey = sorted[0][0];
      const best = { key: bestKey, a: bestKey.split('|')[0], b: bestKey.split('|')[1], cnt: sorted[0][1] };
      const topPairs = sorted.slice(0, 8).map(([k, v]) => ({ a: k.split('|')[0], b: k.split('|')[1], cnt: v }));

      snap(`第 ${round + 1} 轮·统计：共 ${pairMap.size} 种相邻对，最高频「${best.a}+${best.b}」出现 ${best.cnt} 次。`,
        { phase: 'count', topPairs, best, round });
      snap(`第 ${round + 1} 轮·选中：合并「${best.a}」与「${best.b}」为新符号「${best.a + best.b}」。`,
        { phase: 'merge', topPairs, best, round });

      const merged = best.a + best.b;
      applyMerge(words, best.a, best.b, merged);
      vocab.push(merged);
      rules.push({ a: best.a, b: best.b, merged, cnt: best.cnt });

      snap(`第 ${round + 1} 轮·词表：加入「${merged}」，词表增至 ${vocab.length}（上限 ${vocabMax}）。`,
        { phase: 'vocab', topPairs, best, round });
      snap(`第 ${round + 1} 轮·应用：含该相邻对的词已重新切分，如「${words[0].txt}」→ ${words[0].symbols.join(' | ')}。`,
        { phase: 'apply', topPairs, best, round });
    }

    snap('停止合并：达到轮数上限、词表上限，或已无可合并的相邻对。', { phase: 'final' });
    snap(`最终切分完成：词表 ${vocab.length} 条，共 ${steps[steps.length - 1].metrics.语料Token数} 个 token。`,
      { phase: 'done', done: true });
    return finalize(steps);
  },

  render(snap, p, c) {
    const words = snap.words || [];
    const vocab = snap.vocab || [];
    const rules = snap.rules || [];
    const topPairs = snap.topPairs || [];
    const best = snap.best || null;
    const phase = snap.phase || 'init';
    const showFreq = snap.showFreq !== false;
    const initCount = snap.initCount ?? words.length;

    const leftX = 20, leftW = 345;
    const rowY = (i) => 44 + i * 40;
    const left = [];
    left.push(<text key="lh" x={leftX} y={26} fontSize="12" fill={c.text}>语料切分 · {snap.corpusName || '中文示例句'}</text>);

    words.forEach((w, i) => {
      const y = rowY(i);
      if (phase === 'init' && i >= initCount) return;
      left.push(<text key={`lb${i}`} x={leftX} y={y + 15} fontSize="10" fill={c.muted}>
        {w.txt + (showFreq ? ` ×${w.freq}` : '')}
      </text>);
      const syms = w.symbols || [];
      const bw = Math.max(16, Math.min(46, (leftW - 80) / Math.max(1, syms.length)));
      const x0 = leftX + 78;
      syms.forEach((s, j) => {
        const x = x0 + j * (bw + 2);
        if (x + bw > leftX + leftW) return;
        const isMerged = s.length > 1;
        const isBest = !!best && (s === best.a || s === best.b) && (phase === 'count' || phase === 'merge');
        const fill = isMerged ? c.success : c.primary;
        const op = isBest ? 0.55 : (isMerged ? 0.4 : 0.16);
        left.push(<g key={`s${i}-${j}`}>
          <rect x={x} y={y} width={bw} height={22} rx={3} fill={fill} opacity={op}
            stroke={isBest ? c.warning : (isMerged ? c.success : c.border)}
            strokeWidth={isBest || isMerged ? 1.2 : 0.6} />
          <text x={x + bw / 2} y={y + 15} textAnchor="middle" fontSize="9" fill={c.text}>
            {s.length > 4 ? s.slice(0, 3) + '…' : s}
          </text>
        </g>);
      });
    });

    const rightX = 378, rightW = 322;
    const right = [];
    right.push(<text key="rh" x={rightX} y={26} fontSize="12" fill={c.text}>相邻符号对频次（Top）</text>);
    const pairs = topPairs.slice(0, 8);
    const maxCnt = Math.max(1, ...pairs.map((o) => o.cnt));
    if (!pairs.length) {
      right.push(<text key="empty" x={rightX} y={48} fontSize="10" fill={c.muted}>初始阶段暂无统计，前进到合并轮次查看。</text>);
    }
    pairs.forEach((o, i) => {
      const y = 38 + i * 17;
      const isBest = !!best && o.a === best.a && o.b === best.b;
      const barW = (o.cnt / maxCnt) * 118;
      right.push(<g key={`p${i}`}>
        <text x={rightX} y={y + 10} fontSize="10" fill={isBest ? c.warning : c.text}>{o.a + ' + ' + o.b}</text>
        <rect x={rightX + 96} y={y + 2} width={barW} height={11} rx={2}
          fill={isBest ? c.warning : c.primary} opacity={0.55} />
        {showFreq && <text x={rightX + 96 + barW + 4} y={y + 11} fontSize="9" fill={c.muted}>{o.cnt}</text>}
      </g>);
    });

    right.push(<text key="rrh" x={rightX} y={188} fontSize="12" fill={c.text}>已学习的合并规则（最近 4 条）</text>);
    const recent = rules.slice(-4);
    if (!recent.length) right.push(<text key="r0" x={rightX} y={206} fontSize="10" fill={c.muted}>尚无合并规则</text>);
    recent.forEach((r, i) => {
      right.push(<text key={`r${i}`} x={rightX} y={206 + i * 15} fontSize="10" fill={c.muted}>
        {`${r.a} + ${r.b} → ${r.merged}`}{showFreq ? `（${r.cnt}次）` : ''}
      </text>);
    });

    right.push(<text key="rvh" x={rightX} y={272} fontSize="12" fill={c.text}>词表（{vocab.length} / {snap.vocabMax || 40}）</text>);
    let cx = rightX, cy = 282;
    vocab.slice(0, 26).forEach((v, i) => {
      const cw = Math.max(16, Math.min(40, 10 + v.length * 9));
      if (cx + cw > rightX + rightW) { cx = rightX; cy += 18; }
      if (cy > 330) return;
      right.push(<g key={`v${i}`}>
        <rect x={cx} y={cy} width={cw} height={15} rx={2} fill={c.primary} opacity={0.14}
          stroke={c.border} strokeWidth="0.5" />
        <text x={cx + cw / 2} y={cy + 11} textAnchor="middle" fontSize="9" fill={c.text}>
          {v.length > 4 ? v.slice(0, 3) + '…' : v}
        </text>
      </g>);
      cx += cw + 3;
    });

    const phaseLabel = {
      init: '① 初始字符切分', vocab: '② 词表', count: '③ 统计相邻对频次',
      merge: '④ 选中最高频对', apply: '⑤ 应用合并并重新切分',
      final: '⑥ 结束', done: '⑥ 最终 token 切分',
    }[phase] || '';

    return (
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} preserveAspectRatio="xMidYMid meet">
        {left}
        <line x1="368" y1="20" x2="368" y2="326" stroke={c.grid} strokeWidth="1" />
        {right}
        <text x={leftX} y={332} fontSize="10" fill={c.muted}>
          {phaseLabel} · 词表 {vocab.length} · 已合并 {rules.length} 轮
        </text>
      </svg>
    );
  },
};
