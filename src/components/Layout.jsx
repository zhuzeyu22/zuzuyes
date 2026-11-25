import React, { useState } from 'react';
import { NavLink, Link, useNavigate } from 'react-router-dom';
import { CATEGORIES, ALGORITHMS } from '../data/catalog.js';
import { compareGroups, demoCount } from '../demos/registry.js';
import { useTheme } from '../theme.jsx';

export function LevelBadge({ level, small = false }) {
  const names = { 1: '初级', 2: '中级', 3: '高级' };
  return <span className={`level-badge lv-${level} ${small ? 'small' : ''}`}>{names[level]}</span>;
}

export function Tag({ children }) { return <span className="tag">{children}</span>; }

export default function Layout({ children }) {
  const { theme, toggle } = useTheme();
  const nav = useNavigate();
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const groups = compareGroups();

  const submit = (e) => {
    e.preventDefault();
    nav(`/browse?q=${encodeURIComponent(q.trim())}`);
    setOpen(false);
  };

  return (
    <div className="app-shell">
      <aside className={`sidebar ${open ? 'open' : ''}`}>
        <Link to="/" className="brand" onClick={() => setOpen(false)}>
          <span className="brand-mark">A</span>
          <span className="brand-text"><b>算法图谱</b><small>ALGO ATLAS</small></span>
        </Link>

        <div className="side-scroll">
          <div className="side-section">
            <div className="side-label">导航</div>
            <NavLink to="/" end onClick={() => setOpen(false)}><i className="dot" />总览</NavLink>
            <NavLink to="/browse" onClick={() => setOpen(false)}><i className="dot" />全部算法 <em>{ALGORITHMS.length}</em></NavLink>
            <NavLink to="/path" onClick={() => setOpen(false)}><i className="dot" />学习路径</NavLink>
            <NavLink to="/compare" onClick={() => setOpen(false)}><i className="dot" />对比实验室 <em>{groups.length}</em></NavLink>
          </div>

          <div className="side-section">
            <div className="side-label">算法分类</div>
            {CATEGORIES.map((cat) => (
              <NavLink key={cat.id} to={`/category/${cat.id}`} onClick={() => setOpen(false)}>
                <i className="cat-dot" style={{ background: cat.color }} />
                <span className="cat-name">{cat.name}</span>
                <em>{ALGORITHMS.filter((a) => a.cat === cat.id).length}</em>
              </NavLink>
            ))}
          </div>

          <div className="side-section">
            <div className="side-label">热门对比</div>
            {groups.slice(0, 5).map((g) => (
              <NavLink key={g.id} to={`/compare/${g.id}`} onClick={() => setOpen(false)} className="sub-link">
                {g.name}
              </NavLink>
            ))}
          </div>
        </div>

        <div className="side-foot">
          <div className="side-stat"><b>{ALGORITHMS.length}</b> 个算法 · <b>{demoCount}</b> 个交互演示</div>
          <button className="theme-btn" onClick={toggle}>
            <span>{theme === 'light' ? '◐' : '◑'}</span> {theme === 'light' ? '切换深色' : '切换浅色'}
          </button>
        </div>
      </aside>

      {open && <div className="side-mask" onClick={() => setOpen(false)} />}

      <div className="main-wrap">
        <header className="topbar">
          <button className="menu-btn" onClick={() => setOpen(!open)} aria-label="菜单">☰</button>
          <form className="global-search" onSubmit={submit}>
            <svg viewBox="0 0 24 24" width="16" height="16"><path d="M15.5 14h-.8l-.3-.3a6.5 6.5 0 1 0-.7.7l.3.3v.8l5 5 1.5-1.5-5-5zm-6 0a4.5 4.5 0 1 1 0-9 4.5 4.5 0 0 1 0 9z" fill="currentColor" /></svg>
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="搜索算法、英文名、标签…  例如：注意力 / sorting / DP" />
            <kbd>Enter</kbd>
          </form>
          <div className="top-right">
            <span className="top-hint">分类 {CATEGORIES.length} · 演示 {demoCount}</span>
            <button className="theme-icon" onClick={toggle} title="切换主题">{theme === 'light' ? '◐' : '◑'}</button>
          </div>
        </header>
        <main className="content">{children}</main>
        <footer className="foot">
          算法图谱 · 从冒泡排序到 Transformer 与推荐系统　|　所有演示均在浏览器本地计算，数据不上传
        </footer>
      </div>
    </div>
  );
}
