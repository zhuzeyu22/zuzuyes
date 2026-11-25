import React, { useMemo, useState, useEffect } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import { ALGORITHMS, CATEGORIES, LEVELS } from '../data/catalog.js';
import { hasDemo } from '../demos/registry.js';
import AlgorithmCard from '../components/AlgorithmCard.jsx';

export default function Browse() {
  const [sp, setSp] = useSearchParams();
  const q = sp.get('q') || '';
  const level = sp.get('level') || '';
  const cat = sp.get('cat') || '';
  const demoOnly = sp.get('demo') === '1';
  const [text, setText] = useState(q);
  const [sort, setSort] = useState('default');

  useEffect(() => setText(q), [q]);
  const set = (k, v) => {
    const next = new URLSearchParams(sp);
    if (v) next.set(k, v); else next.delete(k);
    setSp(next);
  };

  const list = useMemo(() => {
    const kw = q.trim().toLowerCase();
    let r = ALGORITHMS.filter((a) => {
      if (level && String(a.level) !== level) return false;
      if (cat && a.cat !== cat) return false;
      if (demoOnly && !hasDemo(a.id)) return false;
      if (!kw) return true;
      return [a.id, a.name, a.en, a.sub, a.summary, a.tags.join(' '), a.time]
        .join(' ').toLowerCase().includes(kw);
    });
    if (sort === 'level') r = [...r].sort((x, y) => x.level - y.level || x.cat.localeCompare(y.cat));
    if (sort === 'name') r = [...r].sort((x, y) => x.name.localeCompare(y.name, 'zh'));
    if (sort === 'demo') r = [...r].sort((x, y) => Number(hasDemo(y.id)) - Number(hasDemo(x.id)));
    return r;
  }, [q, level, cat, demoOnly, sort]);

  return (
    <div className="page">
      <div className="page-head">
        <div><h1>全部算法</h1><p>搜索、按分类与难度筛选，快速定位想学的算法。</p></div>
        <div className="ph-count"><b>{list.length}</b> / {ALGORITHMS.length} 条</div>
      </div>

      <div className="filter-bar">
        <div className="search-local">
          <input value={text} placeholder="搜索名称 / 英文 / 标签 / 复杂度…"
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') set('q', text); }} />
          <button onClick={() => set('q', text)}>搜索</button>
          {q && <button className="clear" onClick={() => { setText(''); set('q', ''); }}>清除</button>}
        </div>
        <div className="filter-row">
          <span className="fl-label">分类</span>
          <button className={`chip ${!cat ? 'on' : ''}`} onClick={() => set('cat', '')}>全部</button>
          {CATEGORIES.map((c) => <button key={c.id} className={`chip ${cat === c.id ? 'on' : ''}`} onClick={() => set('cat', c.id)}>{c.short}</button>)}
        </div>
        <div className="filter-row">
          <span className="fl-label">难度</span>
          <button className={`chip ${!level ? 'on' : ''}`} onClick={() => set('level', '')}>全部</button>
          {[1, 2, 3].map((lv) => <button key={lv} className={`chip ${level === String(lv) ? 'on' : ''}`} onClick={() => set('level', String(lv))}>{LEVELS[lv].name}</button>)}
          <span className="fl-sep" />
          <button className={`chip ${demoOnly ? 'on' : ''}`} onClick={() => set('demo', demoOnly ? '' : '1')}>◆ 仅看有交互</button>
          <span className="fl-sep" />
          <select value={sort} onChange={(e) => setSort(e.target.value)}>
            <option value="default">默认顺序</option>
            <option value="level">按难度</option>
            <option value="demo">优先有演示</option>
            <option value="name">按名称</option>
          </select>
        </div>
      </div>

      {list.length === 0 ? (
        <div className="empty">
          <b>没有匹配的算法</b>
          <p>试试更短的关键词，或清除筛选条件。</p>
          <button className="btn ghost" onClick={() => setSp(new URLSearchParams())}>清除全部筛选</button>
        </div>
      ) : (
        <div className="card-grid">
          {list.map((a) => <AlgorithmCard key={a.id} a={a} showCat />)}
        </div>
      )}

      <div className="tip-line">找不到想要的算法？目录持续扩充中，交互演示按优先级逐步补齐。<Link to="/path">查看建议学习顺序 →</Link></div>
    </div>
  );
}
