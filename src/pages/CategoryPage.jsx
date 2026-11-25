import React, { useState } from 'react';
import { useParams, Link, Navigate } from 'react-router-dom';
import { CATEGORIES, byCategory, subOf, LEVELS } from '../data/catalog.js';
import { hasDemo, compareGroups } from '../demos/registry.js';
import AlgorithmCard from '../components/AlgorithmCard.jsx';
import { LevelBadge } from '../components/Layout.jsx';

export default function CategoryPage() {
  const { catId } = useParams();
  const cat = CATEGORIES.find((c) => c.id === catId);
  const [level, setLevel] = useState(0);
  if (!cat) return <Navigate to="/browse" replace />;

  const all = byCategory(catId);
  const subs = subOf(catId);
  const shown = level ? all.filter((a) => a.level === level) : all;
  const demos = all.filter((a) => hasDemo(a.id)).length;
  const groups = compareGroups().filter((g) => g.items.some((it) => it.cat === catId));
  const idx = CATEGORIES.findIndex((c) => c.id === catId);
  const prev = CATEGORIES[idx - 1], next = CATEGORIES[idx + 1];

  return (
    <div className="page">
      <div className="crumb"><Link to="/">总览</Link> / <span>{cat.name}</span></div>
      <div className="cat-hero" style={{ '--cat': cat.color }}>
        <div className="ch-num">{String(cat.order).padStart(2, '0')}</div>
        <div>
          <h1>{cat.name}</h1>
          <p>{cat.desc}</p>
          <div className="ch-tags">
            <span>{all.length} 个算法</span><span>{demos} 个交互演示</span>
            {[1, 2, 3].map((lv) => <span key={lv} style={{ color: LEVELS[lv].color }}>{LEVELS[lv].name} {all.filter((a) => a.level === lv).length}</span>)}
          </div>
        </div>
      </div>

      {groups.length > 0 && (
        <div className="inline-cmp">
          <b>相关对比实验</b>
          {groups.map((g) => <Link key={g.id} to={`/compare/${g.id}`}>{g.name} <em>{g.items.length} 个同屏 →</em></Link>)}
        </div>
      )}

      <div className="filter-row cat-filter">
        <span className="fl-label">难度筛选</span>
        <button className={`chip ${!level ? 'on' : ''}`} onClick={() => setLevel(0)}>全部</button>
        {[1, 2, 3].map((lv) => <button key={lv} className={`chip ${level === lv ? 'on' : ''}`} onClick={() => setLevel(lv)}><LevelBadge level={lv} small /> {LEVELS[lv].name}</button>)}
        <span className="fl-sep" /><span className="result-count">{shown.length} 条结果</span>
      </div>

      {subs.map((sub) => {
        const items = shown.filter((a) => a.sub === sub);
        if (!items.length) return null;
        return (
          <section className="sub-section" key={sub}>
            <div className="sub-head"><h2>{sub}</h2><span>{items.length} 个</span></div>
            <div className="card-grid">
              {items.map((a) => <AlgorithmCard key={a.id} a={a} />)}
            </div>
          </section>
        );
      })}

      <div className="page-nav">
        {prev ? <Link to={`/category/${prev.id}`}>← {prev.name}</Link> : <span />}
        <Link to="/browse">全部算法</Link>
        {next ? <Link to={`/category/${next.id}`}>{next.name} →</Link> : <span />}
      </div>
    </div>
  );
}
