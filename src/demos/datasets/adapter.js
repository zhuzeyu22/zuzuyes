// 演示接入真实数据集的共享适配层。
// 纯函数、确定性；不在构建期联网。
import { DATASETS, pointsForDemo, binaryPoints, toRegression, vectors } from './index.js';

// 数据集参数：默认真实数据集，可切回合成数据对照
export function datasetParam(defaultId, options, label = '数据来源') {
  return {
    key: 'dataset', label, type: 'select', default: defaultId,
    options: [
      ...options.map((id) => ({ value: id, label: DATASETS[id].name })),
      { value: 'synthetic', label: '合成数据（对照）' },
    ],
    hint: `真实数据：${options.map((id) => DATASETS[id].desc).join('；')}`,
  };
}

export function isReal(p, fallback) {
  const id = p.dataset || fallback;
  return id !== 'synthetic' && !!DATASETS[id];
}

// 2D 散点（多分类）：真实数据 / 合成数据由调用方提供 genData
export function scatterPoints(p, fallback, genData, f0 = 0, f1 = 1) {
  const id = p.dataset || fallback;
  if (id === 'synthetic' || !DATASETS[id]) return genData();
  return pointsForDemo(id, f0, f1, Number(p.n) || 100);
}

// 2D 散点（二分类）
export function binaryScatter(p, fallback, genData, f0 = 0, f1 = 1, plusMinus = false) {
  const id = p.dataset || fallback;
  if (id === 'synthetic' || !DATASETS[id]) return genData();
  return binaryPoints(id, f0, f1, Number(p.n) || 100, plusMinus);
}

// 回归点 {x,y}，x/y 已归一化到 [0,1]
export function regressionPoints(p, fallback, genData, feat = 2) {
  const id = p.dataset || fallback;
  if (id === 'synthetic' || !DATASETS[id]) return genData();
  return toRegression(id, feat, Number(p.n) || 60);
}

// 多维向量（t-SNE 等）
export function vectorData(p, fallback, genData, dims = 4) {
  const id = p.dataset || fallback;
  if (id === 'synthetic' || !DATASETS[id]) return genData();
  return vectors(id, Number(p.n) || 45, dims);
}

export function dataLabel(p, fallback) {
  const id = p.dataset || fallback;
  return id === 'synthetic' || !DATASETS[id] ? '合成数据' : DATASETS[id].name;
}

export function dataNote(p, fallback) {
  const id = p.dataset || fallback;
  return id === 'synthetic' || !DATASETS[id]
    ? '（合成数据：确定性随机生成，用于对照）'
    : `（真实数据：${DATASETS[id].name}，来源 ${DATASETS[id].source}）`;
}
