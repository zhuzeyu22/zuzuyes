import React from 'react';
import { Link } from 'react-router-dom';
import { LevelBadge } from './Layout.jsx';
import { CATEGORIES } from '../data/catalog.js';
import { hasDemo } from '../demos/registry.js';

const CAT = Object.fromEntries(CATEGORIES.map((c) => [c.id, c]));

export default function AlgorithmCard({ a, showCat = false }) {
  const cat = CAT[a.cat];
  return (
    <Link to={`/algorithm/${a.id}`} className="algo-card">
      <div className="ac-top">
        <LevelBadge level={a.level} small />
        {hasDemo(a.id) && <span className="demo-flag">◆ 可交互</span>}
        {showCat && <span className="ac-cat" style={{ color: cat?.color }}>{cat?.short}</span>}
      </div>
      <h4>{a.name}</h4>
      <div className="ac-en">{a.en}</div>
      <p>{a.summary}</p>
      <div className="ac-meta">
        <span>时间 {a.time}</span><span>空间 {a.space}</span>
      </div>
    </Link>
  );
}
