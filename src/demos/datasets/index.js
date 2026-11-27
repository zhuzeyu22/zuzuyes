// 真实数据集统一入口。数据离线内嵌，运行时不联网。
// 每个数据集模块导出 { META, DATA }；DATA 为数值数组，最后一列是标签/目标。
import { META as IRIS_META, DATA as IRIS } from './iris.js';
import { META as WINE_META, DATA as WINE } from './wine.js';
import { META as BREAST_META, DATA as BREAST } from './breast-cancer.js';
import { META as DIABETES_META, DATA as DIABETES } from './diabetes.js';
import { META as DIGITS_META, DATA as DIGITS } from './digits.js';

export const DATASETS = {
  iris: { ...IRIS_META, rows: IRIS, features: IRIS[0].length - 1 },
  wine: { ...WINE_META, rows: WINE, features: WINE[0].length - 1 },
  breast: { ...BREAST_META, rows: BREAST, features: BREAST[0].length - 1 },
  diabetes: { ...DIABETES_META, rows: DIABETES, features: DIABETES[0].length - 1 },
  digits: { ...DIGITS_META, rows: DIGITS, features: DIGITS[0].length - 1 },
};

// 供参数 select 使用：真实数据集 + 合成数据对照
export const DATASET_OPTIONS = [
  { value: 'iris', label: 'Iris 鸢尾花（真实·150）' },
  { value: 'wine', label: 'Wine 葡萄酒（真实·178）' },
  { value: 'breast', label: 'Breast Cancer（真实·569）' },
  { value: 'diabetes', label: 'Diabetes 回归（真实·442）' },
  { value: 'digits', label: 'Digits 手写数字（真实·200）' },
  { value: 'synthetic', label: '合成数据（对照组）' },
];

export function datasetMeta(id) {
  return DATASETS[id] || null;
}

// 每列 min/max，用于归一化
export function columnStats(rows, nFeatures) {
  const lo = Array(nFeatures).fill(Infinity), hi = Array(nFeatures).fill(-Infinity);
  for (const r of rows) {
    for (let j = 0; j < nFeatures; j++) {
      const v = Number(r[j]) || 0;
      if (v < lo[j]) lo[j] = v;
      if (v > hi[j]) hi[j] = v;
    }
  }
  return { lo, hi };
}

// 把指定两列归一化到 [0,1]，返回 { x, y, cls }；标签用于着色
export function toPoints(id, f0 = 0, f1 = 1, limit = 120) {
  const ds = DATASETS[id];
  if (!ds) return [];
  const n = ds.features;
  const { lo, hi } = columnStats(ds.rows, n);
  const a = Math.min(f0, n - 1), b = Math.min(f1, n - 1);
  const spanA = hi[a] - lo[a] || 1, spanB = hi[b] - lo[b] || 1;
  const rows = ds.rows.slice(0, Math.min(limit, ds.rows.length));
  return rows.map((r) => ({
    x: (Number(r[a]) - lo[a]) / spanA,
    y: (Number(r[b]) - lo[b]) / spanB,
    cls: Number(r[n]) || 0,
    label: Number(r[n]) || 0,
    raw: [Number(r[a]), Number(r[b])],
  }));
}

// 适配既有 2D 散点演示：坐标映射到 [-1.5,1.5]，兼容原合成数据的坐标系
export function pointsForDemo(id, f0 = 0, f1 = 1, limit = 120, balanced = true) {
  const ds = DATASETS[id];
  if (!ds) return [];
  const n = ds.features;
  const { lo, hi } = columnStats(ds.rows, n);
  const a = Math.min(f0, n - 1), b = Math.min(f1, n - 1);
  const spanA = hi[a] - lo[a] || 1, spanB = hi[b] - lo[b] || 1;
  let rows = ds.rows;
  if (balanced) {
    // 按类别轮流取样，避免原始排序导致前段全是一类（如 breast 前 212 全是恶性）
    const byCls = new Map();
    for (const r of rows) {
      const c = Number(r[n]) || 0;
      if (!byCls.has(c)) byCls.set(c, []);
      byCls.get(c).push(r);
    }
    const groups = [...byCls.values()];
    const picked = [];
    const per = Math.ceil(limit / groups.length);
    for (let k = 0; k < per; k++) {
      for (const g of groups) if (g[k]) picked.push(g[k]);
    }
    rows = picked.slice(0, limit);
  } else {
    rows = rows.slice(0, Math.min(limit, rows.length));
  }
  return rows.map((r) => ({
    x: ((Number(r[a]) - lo[a]) / spanA - 0.5) * 3,
    y: ((Number(r[b]) - lo[b]) / spanB - 0.5) * 3,
    cls: Number(r[n]) || 0,
    label: Number(r[n]) || 0,
    raw: [Number(r[a]), Number(r[b])],
  }));
}

// 二分类标签映射：真实类别 → {0,1} 或 {-1,1}
export function binaryPoints(id, f0 = 0, f1 = 1, limit = 120, plusMinus = false) {
  return pointsForDemo(id, f0, f1, limit, true).map((p) => ({
    ...p,
    label: plusMinus ? (p.cls === 0 ? -1 : 1) : (p.cls === 0 ? 0 : 1),
  }));
}

// 回归数据：返回 { x, y }，x 为某特征归一化，y 为目标归一化
export function toRegression(id, feat = 2, limit = 120) {
  const ds = DATASETS[id];
  if (!ds) return [];
  const n = ds.features;
  const { lo, hi } = columnStats(ds.rows, n);
  const targetCol = n;
  const tlo = Math.min(...ds.rows.map((r) => Number(r[targetCol])));
  const thi = Math.max(...ds.rows.map((r) => Number(r[targetCol])));
  const f = Math.min(feat, n - 1);
  const span = hi[f] - lo[f] || 1, tspan = thi - tlo || 1;
  return ds.rows.slice(0, Math.min(limit, ds.rows.length)).map((r) => ({
    x: (Number(r[f]) - lo[f]) / span,
    y: (Number(r[targetCol]) - tlo) / tspan,
    rawX: Number(r[f]), rawY: Number(r[targetCol]),
  }));
}

// 返回多维向量（用于 t-SNE 等高维演示）：{ v: number[], cls }，前 nFeatures 列归一化到 [-1,1]
export function vectors(id, limit = 45, dims = 4) {
  const ds = DATASETS[id];
  if (!ds) return [];
  const n = ds.features;
  const { lo, hi } = columnStats(ds.rows, n);
  const k = Math.min(dims, n);
  const byCls = new Map();
  for (const r of ds.rows) {
    const c = Number(r[n]) || 0;
    if (!byCls.has(c)) byCls.set(c, []);
    byCls.get(c).push(r);
  }
  const groups = [...byCls.values()];
  const picked = [];
  const per = Math.ceil(limit / groups.length);
  for (let i = 0; i < per; i++) for (const g of groups) if (g[i]) picked.push(g[i]);
  return picked.slice(0, limit).map((r) => ({
    v: Array.from({ length: k }, (_, j) => ((Number(r[j]) - lo[j]) / (hi[j] - lo[j] || 1) - 0.5) * 2),
    cls: Number(r[n]) || 0,
  }));
}

// 来源标注文本（供 UI 显示）
export function sourceLine(id) {
  const ds = DATASETS[id];
  if (!ds) return '';
  return `${ds.name} · 来源 ${ds.source} · ${ds.license} · ${ds.url}`;
}
