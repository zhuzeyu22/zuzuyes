import React, { useEffect, useMemo, useState } from 'react';
import { useParams, Link, Navigate } from 'react-router-dom';
import { COMPARE_GROUPS, LEVELS } from '../data/catalog.js';
import { compareItems } from '../demos/registry.js';
import { useDemos } from '../demos/useDemo.js';
import DemoRunner, { defaultParams } from '../demos/DemoRunner.jsx';
import { LevelBadge } from '../components/Layout.jsx';

export default function ComparePage() {
  const { group } = useParams();
  const info = COMPARE_GROUPS[group];
  const items = compareItems(group);
  const itemKey = items.map((x) => x.id).join('|');
  const { defs: loaded, loading } = useDemos(itemKey ? itemKey.split('|') : []);
  const [idx, setIdx] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(5);
  const [paramsMap, setParamsMap] = useState(null);
  const [layout, setLayout] = useState(2);

  const defs = useMemo(() => loaded
    .map(({ id, def }) => ({ it: items.find((x) => x.id === id), def }))
    .filter((x) => x.it), [loaded, itemKey]);
  useEffect(() => {
    setParamsMap(Object.fromEntries(defs.map(({ it, def }) => [it.id, defaultParams(def)])));
    setIdx(0); setPlaying(false);
  }, [itemKey, defs]);

  const paramsKey = JSON.stringify(paramsMap);
  const maxSteps = useMemo(() => {
    if (!paramsMap) return 1;
    let m = 1;
    defs.forEach(({ it, def }) => {
      try { m = Math.max(m, def.buildSteps(paramsMap[it.id]).length); } catch { /* ignore */ }
    });
    return m;
  }, [group, paramsKey]);

  useEffect(() => {
    if (!playing) return;
    const delay = Math.max(16, 620 - speed * 58);
    const t = setInterval(() => setIdx((i) => Math.min(maxSteps - 1, i + 1)), delay);
    return () => clearInterval(t);
  }, [playing, speed, maxSteps]);
  useEffect(() => { if (playing && idx >= maxSteps - 1) setPlaying(false); }, [idx, playing, maxSteps]);

  if (!info) return <Navigate to="/compare" replace />;
  if (items.length < 2) return (
    <div className="page">
      <div className="crumb"><Link to="/">总览</Link> / <Link to="/compare">对比实验室</Link> / <span>{info.name}</span></div>
      <div className="empty">
        <b>这个对比组还在准备中</b>
        <p>同屏对比需要至少 2 个已实现交互演示的算法，当前组内只有 {items.length} 个。</p>
        <Link className="btn ghost" to="/compare">查看其它对比组 →</Link>
      </div>
    </div>
  );
  if (loading || !paramsMap) return <div className="page"><p>正在准备演示…</p></div>;

  const controller = { idx, playing, speed, setIdx, setPlaying, setSpeed };
  const syncParams = () => {
    if (!defs.length) return;
    const base = paramsMap[defs[0].it.id] || {};
    const next = { ...paramsMap };
    defs.forEach(({ it, def }) => {
      const allowed = new Set((def.params || []).map((p) => p.key));
      const merged = { ...next[it.id] };
      Object.entries(base).forEach(([k, v]) => { if (allowed.has(k)) merged[k] = v; });
      next[it.id] = merged;
    });
    setParamsMap(next); setPlaying(false); setIdx(0);
  };

  return (
    <div className="page compare-page">
      <div className="crumb"><Link to="/">总览</Link> / <Link to="/compare">对比实验室</Link> / <span>{info.name}</span></div>
      <div className="page-head">
        <div><h1>{info.name}</h1><p>{info.desc}</p></div>
        <div className="ph-count"><b>{items.length}</b> 个算法同屏</div>
      </div>

      <div className="compare-toolbar">
        <div className="transport master">
          <button title="上一步" onClick={() => { setPlaying(false); setIdx(Math.max(0, idx - 1)); }}>◀|</button>
          <button className="primary" onClick={() => { if (idx >= maxSteps - 1) setIdx(0); setPlaying(!playing); }}>
            {playing ? '❚❚ 全部暂停' : '▶ 同步播放'}</button>
          <button title="下一步" onClick={() => { setPlaying(false); setIdx(Math.min(maxSteps - 1, idx + 1)); }}>|▶</button>
          <button title="重置" onClick={() => { setPlaying(false); setIdx(0); }}>↺</button>
        </div>
        <input className="scrubber" type="range" min={0} max={Math.max(0, maxSteps - 1)} value={Math.min(idx, maxSteps - 1)}
          onChange={(e) => { setPlaying(false); setIdx(Number(e.target.value)); }} />
        <span className="step-count">{Math.min(idx, maxSteps - 1) + 1} / {maxSteps}</span>
        <label className="speed-ctl">速度 <input type="range" min="1" max="10" value={speed} onChange={(e) => setSpeed(Number(e.target.value))} /></label>
        <button className="btn ghost small" onClick={syncParams} title="把第一个算法的同名参数广播给其它算法">⇄ 同步参数</button>
        <button className="btn ghost small" onClick={() => setLayout(layout === 2 ? 1 : 2)}>{layout === 2 ? '单列' : '双列'}</button>
      </div>

      <div className="cmp-hint">提示：{info.hint}。各卡片可独立调参；点「同步参数」把第一个卡片的同名参数广播给全部。进度条与播放由上方统一控制。</div>

      <div className={`compare-board cols-${layout}`}>
        {defs.map(({ it, def }) => (
          <div className="compare-cell" key={it.id}>
            <div className="cc-head2">
              <div><Link to={`/algorithm/${it.id}`}><h2>{it.name}</h2></Link><span>{it.en}</span></div>
              <LevelBadge level={it.level} small />
            </div>
            <div className="cc-meta"><code>{it.time}</code> · {LEVELS[it.level].name} · <Link to={`/algorithm/${it.id}`}>知识卡 →</Link></div>
            <DemoRunner def={def} params={paramsMap[it.id]}
              onParamsChange={(v) => setParamsMap((m) => ({ ...m, [it.id]: v }))}
              controller={controller} />
          </div>
        ))}
      </div>

      <div className="tip-line">同组算法：{items.map((x) => <Link key={x.id} to={`/algorithm/${x.id}`}>{x.name}</Link>)}</div>
    </div>
  );
}
