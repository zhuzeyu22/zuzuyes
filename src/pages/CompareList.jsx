import React from 'react';
import { Link } from 'react-router-dom';
import { compareGroups } from '../demos/registry.js';
import { COMPARE_GROUPS } from '../data/catalog.js';

export default function CompareList() {
  const groups = compareGroups();
  return (
    <div className="page">
      <div className="page-head">
        <div><h1>对比实验室</h1><p>同类算法共享参数、同步播放。差异不是背下来的，是看出来的。</p></div>
        <div className="ph-count"><b>{groups.length}</b> 组可比</div>
      </div>
      <div className="cmp-list">
        {groups.map((g) => (
          <Link key={g.id} to={`/compare/${g.id}`} className="cmp-list-item">
            <div className="cli-main">
              <h2>{g.name}</h2>
              <p>{g.desc}</p>
              <div className="cli-tags">{g.items.map((it) => <span key={it.id}>{it.name}</span>)}</div>
            </div>
            <div className="cli-side">
              <b>{g.items.length}</b><span>个算法同屏</span><em>进入 →</em>
            </div>
          </Link>
        ))}
      </div>
      <div className="tip-line">对比组由目录中的 <code>compare</code> 字段自动生成；新增交互演示后会自动出现在对应组里。全部对比组：{Object.keys(COMPARE_GROUPS).length} 个。</div>
    </div>
  );
}
