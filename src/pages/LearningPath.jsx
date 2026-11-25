import React from 'react';
import { Link } from 'react-router-dom';
import { ALGORITHMS, CATEGORIES, LEVELS } from '../data/catalog.js';
import { hasDemo, compareGroups } from '../demos/registry.js';
import { LevelBadge } from '../components/Layout.jsx';

const STAGES = [
  {
    id: 1, title: '阶段一 · 建立直觉', sub: '看得见的排序、查找与遍历',
    goal: '能用复杂度描述算法，理解「步骤」而不是背代码。',
    pick: ['bubble-sort', 'selection-sort', 'insertion-sort', 'binary-search', 'bfs', 'dijkstra', 'hash-table', 'lru-cache'],
  },
  {
    id: 2, title: '阶段二 · 分治与动态规划', sub: '从「会写」到「会拆问题」',
    goal: '掌握递归、状态定义与最优子结构，能自己推导转移方程。',
    pick: ['quick-sort', 'merge-sort', 'heap-sort', 'knapsack', 'n-queens', 'fibonacci-recursion', 'lcs', 'union-find'],
  },
  {
    id: 3, title: '阶段三 · 从数据里学模型', sub: '机器学习与优化',
    goal: '理解损失函数、梯度与过拟合，能解释每条曲线的变化。',
    pick: ['gradient-descent', 'linear-regression', 'logistic-regression', 'knn', 'decision-tree', 'kmeans', 'dbscan', 'svm', 'pca', 'gradient-boosting'],
  },
  {
    id: 4, title: '阶段四 · 大模型机制', sub: 'Transformer 与解码生成',
    goal: '能说清 QKV、位置信息、采样策略与推理优化分别在解决什么问题。',
    pick: ['bpe-tokenizer', 'embedding', 'self-attention', 'multi-head-attention', 'positional-encoding', 'transformer-block', 'softmax-sampling', 'beam-search', 'kv-cache', 'lora', 'rlhf-dpo', 'rag-vector-search'],
  },
  {
    id: 5, title: '阶段五 · 推荐与检索系统', sub: '从算法到工业链路',
    goal: '理解召回-排序-重排全链路，以及探索利用、多样性与评估指标。',
    pick: ['user-item-cf', 'matrix-factorization', 'two-tower', 'multi-recall', 'ctr-funnel', 'mmr-rerank', 'bandit-exploration', 'bm25', 'ann-search', 'ndcg'],
  },
];

export default function LearningPath() {
  const byId = Object.fromEntries(ALGORITHMS.map((a) => [a.id, a]));
  const groups = compareGroups();
  return (
    <div className="page">
      <div className="page-head">
        <div><h1>学习路径</h1><p>按「先直觉、后推导、再系统」的顺序推进。每阶段都配了可交互的算法。</p></div>
        <div className="ph-count"><b>{STAGES.length}</b> 个阶段</div>
      </div>

      <div className="level-row path-legend">
        {[1, 2, 3].map((lv) => (
          <div key={lv}><LevelBadge level={lv} small /> <span>{LEVELS[lv].desc}</span></div>
        ))}
      </div>

      <div className="path-list">
        {STAGES.map((s) => {
          const list = s.pick.map((id) => byId[id]).filter(Boolean);
          const demos = list.filter((a) => hasDemo(a.id)).length;
          return (
            <section className="path-stage" key={s.id}>
              <div className="ps-rail"><span>{String(s.id).padStart(2, '0')}</span></div>
              <div className="ps-body">
                <div className="ps-head">
                  <div><h2>{s.title}</h2><span>{s.sub}</span></div>
                  <em>{list.length} 个算法 · {demos} 个可交互</em>
                </div>
                <p className="ps-goal"><b>学完能做到</b> {s.goal}</p>
                <div className="ps-items">
                  {list.map((a) => (
                    <Link key={a.id} to={`/algorithm/${a.id}`} className={hasDemo(a.id) ? 'has-demo' : ''}>
                      <LevelBadge level={a.level} small />
                      <span>{a.name}</span>
                      {hasDemo(a.id) && <i>◆</i>}
                    </Link>
                  ))}
                </div>
                <div className="ps-foot">
                  {CATEGORIES.filter((c) => list.some((a) => a.cat === c.id)).slice(0, 4).map((c) => <Link key={c.id} to={`/category/${c.id}`}>{c.name} →</Link>)}
                </div>
              </div>
            </section>
          );
        })}
      </div>

      <section className="section">
        <div className="sec-head"><h2>每阶段都配一个对比实验</h2><Link to="/compare">全部 →</Link></div>
        <div className="path-cmp">
          {STAGES.map((s, i) => {
            const g = groups[i % groups.length];
            return <Link key={s.id} to={`/compare/${g.id}`}><b>{s.title.split('·')[1]?.trim()}</b><span>{g.name}</span></Link>;
          })}
        </div>
      </section>
    </div>
  );
}
