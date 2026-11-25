import React from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { CATEGORIES, ALGORITHMS, LEVELS } from '../data/catalog.js';
import { compareGroups, stats, hasDemo } from '../demos/registry.js';
import AlgorithmCard from '../components/AlgorithmCard.jsx';

const FEATURED = ['quick-sort', 'bfs', 'gradient-descent', 'kmeans', 'self-attention', 'softmax-sampling', 'rag-vector-search', 'bandit-exploration'];

export default function Home() {
  const nav = useNavigate();
  const s = stats();
  const groups = compareGroups();

  return (
    <div className="page home">
      <section className="hero">
        <div className="hero-inner">
          <div className="hero-kicker">INTERACTIVE ALGORITHM ATLAS</div>
          <h1>把算法<em>看</em>明白</h1>
          <p className="hero-sub">从冒泡排序到 Self-Attention，从协同过滤到 RLHF。<br />每个算法一页知识卡，相似算法并排对比，参数一动，过程立刻变。</p>
          <div className="hero-actions">
            <button className="btn primary" onClick={() => nav('/browse')}>浏览全部算法 →</button>
            <Link className="btn ghost" to="/path">按难度学习</Link>
            <Link className="btn ghost" to={`/compare/${groups[0]?.id || 'sorting'}`}>去对比实验室</Link>
          </div>
          <div className="hero-stats">
            <div><b>{s.total}</b><span>算法条目</span></div>
            <div><b>{s.demos}</b><span>交互演示</span></div>
            <div><b>{s.categories}</b><span>知识分类</span></div>
            <div><b>{groups.length}</b><span>对比实验</span></div>
          </div>
        </div>
        <div className="hero-art" aria-hidden="true">
          <svg viewBox="0 0 420 260" width="100%">
            <defs><linearGradient id="hg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#226AFF" stopOpacity=".18"/><stop offset="1" stopColor="#7c5cff" stopOpacity=".05"/></linearGradient></defs>
            <rect x="0" y="0" width="420" height="260" rx="18" fill="url(#hg)" />
            {[0,1,2,3,4,5,6,7,8,9,10,11].map((i) => {
              const h = 30 + ((i * 37) % 130);
              return <rect key={i} x={24 + i * 31} y={218 - h} width="20" height={h} rx="4" className={i < 4 ? 'ha-bar' : 'ha-bar-dim'} opacity={i < 4 ? 0.85 : 0.35} />;
            })}
            <path d="M24 200 C110 90, 190 190, 260 110 S360 70, 396 96" className="ha-line" fill="none" strokeWidth="3" strokeLinecap="round"/>
            <circle cx="260" cy="110" r="6" className="ha-dot-a" />
            <circle cx="396" cy="96" r="6" className="ha-dot-b" />
            <text x="24" y="34" fontSize="12" className="ha-text" fontFamily="monospace">sort() → converge() → attend()</text>
            <text x="24" y="242" fontSize="11" className="ha-text">每一步都可见 · 每个参数都能调</text>
          </svg>
        </div>
      </section>

      <section className="section">
        <div className="sec-head"><h2>按分类学习</h2><span>9 大类 · 覆盖基础到前沿</span></div>
        <div className="cat-grid">
          {CATEGORIES.map((c) => {
            const items = ALGORITHMS.filter((a) => a.cat === c.id);
            const lv = [1, 2, 3].map((n) => items.filter((a) => a.level === n).length);
            const demos = items.filter((a) => hasDemo(a.id)).length;
            return (
              <Link key={c.id} to={`/category/${c.id}`} className="cat-card">
                <div className="cc-bar" style={{ background: c.color }} />
                <div className="cc-head"><h3>{c.name}</h3><b>{items.length}</b></div>
                <p>{c.desc}</p>
                <div className="cc-levels">
                  {lv.map((n, i) => <span key={i} style={{ width: `${Math.max(6, (n / items.length) * 100)}%`, background: LEVELS[i + 1].color }} title={`${LEVELS[i + 1].name} ${n}`} />)}
                </div>
                <div className="cc-foot"><span>初级 {lv[0]} · 中级 {lv[1]} · 高级 {lv[2]}</span><em>{demos} 个演示</em></div>
              </Link>
            );
          })}
        </div>
      </section>

      <section className="section">
        <div className="sec-head"><h2>精选交互演示</h2><Link to="/browse?demo=1">查看全部演示 →</Link></div>
        <div className="card-grid">
          {FEATURED.filter((id) => hasDemo(id)).map((id) => <AlgorithmCard key={id} a={ALGORITHMS.find((x) => x.id === id)} showCat />)}
        </div>
      </section>

      <section className="section">
        <div className="sec-head"><h2>对比实验室</h2><Link to="/compare">全部对比 →</Link></div>
        <p className="sec-note">同类算法共享参数、同步播放，差异一眼看清。</p>
        <div className="compare-grid">
          {groups.slice(0, 6).map((g) => (
            <Link key={g.id} to={`/compare/${g.id}`} className="cmp-card">
              <div className="cmp-avatars">{g.items.slice(0, 4).map((it) => <span key={it.id}>{it.name.slice(0, 2)}</span>)}</div>
              <h3>{g.name}</h3>
              <p>{g.desc}</p>
              <div className="cmp-foot">{g.items.length} 个算法同屏 <b>→</b></div>
            </Link>
          ))}
        </div>
      </section>

      <section className="section">
        <div className="sec-head"><h2>难度分级</h2></div>
        <div className="level-row">
          {[1, 2, 3].map((lv) => (
            <div className="level-card" key={lv}>
              <span className="lc-dot" style={{ background: LEVELS[lv].color }} />
              <b>{LEVELS[lv].name}</b>
              <em>{s.byLevel[lv - 1]} 个算法</em>
              <p>{LEVELS[lv].desc}</p>
              <Link to={`/browse?level=${lv}`}>查看 →</Link>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
