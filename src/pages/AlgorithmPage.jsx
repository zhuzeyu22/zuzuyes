import React from 'react';
import { useParams, Link, Navigate } from 'react-router-dom';
import { ALGORITHMS, BY_ID, CATEGORIES, LEVELS, COMPARE_GROUPS } from '../data/catalog.js';
import { getDetail } from '../data/details.js';
import { getDemo, hasDemo, relatedOf, compareItems } from '../demos/registry.js';
import DemoRunner from '../demos/DemoRunner.jsx';
import AlgorithmCard from '../components/AlgorithmCard.jsx';
import { LevelBadge } from '../components/Layout.jsx';

export default function AlgorithmPage() {
  const { id } = useParams();
  const a = BY_ID[id];
  if (!a) return <Navigate to="/browse" replace />;

  const cat = CATEGORIES.find((c) => c.id === a.cat);
  const detail = getDetail(id);
  const def = getDemo(id);
  const related = relatedOf(id);
  const idx = ALGORITHMS.findIndex((x) => x.id === id);
  const prev = ALGORITHMS[idx - 1], next = ALGORITHMS[idx + 1];
  const cmp = a.compare ? compareItems(a.compare) : [];

  return (
    <div className="page algo-page">
      <div className="crumb">
        <Link to="/">总览</Link> / <Link to={`/category/${a.cat}`}>{cat?.name}</Link> / <span>{a.name}</span>
      </div>

      <div className="algo-head">
        <div className="ah-left">
          <div className="ah-badges">
            <LevelBadge level={a.level} />
            <span className="ah-cat" style={{ '--cat': cat?.color }}>{cat?.name} · {a.sub}</span>
            {hasDemo(id) && <span className="demo-flag big">◆ 含交互演示</span>}
          </div>
          <h1>{a.name}</h1>
          <div className="ah-en">{a.en}</div>
          <p className="ah-summary">{a.summary}</p>
          <div className="ah-tags">{a.tags.map((t) => <span className="tag" key={t}>{t}</span>)}</div>
        </div>
        <div className="ah-complex">
          <div><span>时间复杂度</span><b>{a.time}</b></div>
          <div><span>空间复杂度</span><b>{a.space}</b></div>
          <div><span>难度</span><b style={{ color: LEVELS[a.level].color }}>{LEVELS[a.level].name}</b></div>
        </div>
      </div>

      {def && (
        <section className="algo-demo">
          <div className="sec-head"><h2>交互演示</h2><span>拖动参数，观察算法过程与数值变化</span></div>
          <DemoRunner def={def} />
          {def.hint && <div className="demo-hint"><b>提示</b> {def.hint}</div>}
        </section>
      )}

      {!def && (
        <section className="demo-pending">
          <div className="dp-icon">◇</div>
          <div>
            <b>交互演示待补齐</b>
            <p>本条目目前是完整知识卡（原理、复杂度、难度与关联）。交互演示按优先级逐步补充，可先查看同类中已有演示的算法。</p>
            <div className="dp-links">
              {related.filter((r) => hasDemo(r.id)).slice(0, 4).map((r) => <Link key={r.id} to={`/algorithm/${r.id}`}>{r.name} →</Link>)}
              <Link to="/browse?demo=1">浏览全部演示 →</Link>
            </div>
          </div>
        </section>
      )}

      <div className="algo-cols">
        <section className="panel">
          <h2>核心思想与步骤</h2>
          <p className="lead">{a.summary}</p>
          {detail ? (
            <ol className="step-list">
              {detail.steps.map((s, i) => <li key={i}><span>{i + 1}</span><div>{s}</div></li>)}
            </ol>
          ) : (
            <p className="muted-note">该条目为知识索引，尚未编写分步讲解；复杂度与要点见右侧与下方关联内容。</p>
          )}
          {detail?.insight && <div className="insight"><b>要点 / 常见坑</b><p>{detail.insight}</p></div>}
        </section>

        <section className="panel">
          <h2>速查表</h2>
          <table className="fact-table"><tbody>
            <tr><td>分类</td><td><Link to={`/category/${a.cat}`}>{cat?.name}</Link> / {a.sub}</td></tr>
            <tr><td>难度</td><td><LevelBadge level={a.level} small /> {LEVELS[a.level].desc}</td></tr>
            <tr><td>时间复杂度</td><td><code>{a.time}</code></td></tr>
            <tr><td>空间复杂度</td><td><code>{a.space}</code></td></tr>
            <tr><td>交互演示</td><td>{def ? '已支持' : '待补齐'}</td></tr>
            {a.compare && <tr><td>对比组</td><td><Link to={`/compare/${a.compare}`}>{COMPARE_GROUPS[a.compare]?.name}</Link></td></tr>}
          </tbody></table>
          {detail?.pseudo && (
            <div className="pseudo-block">
              <div className="pb-head">伪代码 <span>PSEUDOCODE</span></div>
              <pre>{detail.pseudo}</pre>
            </div>
          )}
        </section>
      </div>

      {cmp.length >= 2 && (
        <section className="section">
          <div className="sec-head"><h2>放进对比实验室</h2><Link to={`/compare/${a.compare}`}>开始对比 →</Link></div>
          <p className="sec-note">{COMPARE_GROUPS[a.compare]?.desc}　{COMPARE_GROUPS[a.compare]?.hint}</p>
          <div className="cmp-peers">{cmp.map((x) => <Link key={x.id} to={`/algorithm/${x.id}`} className={x.id === id ? 'on' : ''}>{x.name}{x.id === id && <em>当前</em>}</Link>)}</div>
        </section>
      )}

      {related.length > 0 && (
        <section className="section">
          <div className="sec-head"><h2>关联 / 相似算法</h2></div>
          <div className="card-grid">{related.map((r) => <AlgorithmCard key={r.id} a={r} showCat />)}</div>
        </section>
      )}

      <div className="page-nav">
        {prev ? <Link to={`/algorithm/${prev.id}`}>← {prev.name}</Link> : <span />}
        <Link to={`/category/${a.cat}`}>返回 {cat?.name}</Link>
        {next ? <Link to={`/algorithm/${next.id}`}>{next.name} →</Link> : <span />}
      </div>
    </div>
  );
}
