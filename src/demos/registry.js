// 自动注册：definitions/ 下任何 .jsx 文件只要 export default 一个带 id 的 def，
// 就会被自动识别为交互演示，无需手工维护 import 列表。
import { ALGORITHMS, COMPARE_GROUPS, CATEGORIES, BY_ID } from '../data/catalog.js';

const modules = import.meta.glob('./definitions/*.jsx', { eager: true });

export const DEMOS = {};
Object.keys(modules).sort().forEach((path) => {
  const def = modules[path]?.default;
  if (def && def.id) DEMOS[def.id] = def;
  else console.warn('[algo-atlas] 忽略无效的 demo 定义：', path);
});

export const hasDemo = (id) => Boolean(DEMOS[id]);
export const demoCount = Object.keys(DEMOS).length;
export const getDemo = (id) => DEMOS[id];

export const compareItems = (group) => ALGORITHMS.filter((a) => a.compare === group && DEMOS[a.id]);
export const compareGroups = () => Object.keys(COMPARE_GROUPS)
  .map((id) => ({ id, ...COMPARE_GROUPS[id], items: compareItems(id) }))
  .filter((g) => g.items.length >= 2);

export const relatedOf = (id) => {
  const a = BY_ID[id];
  if (!a) return [];
  const sameSub = ALGORITHMS.filter((x) => x.cat === a.cat && x.sub === a.sub && x.id !== id);
  const sameCompare = a.compare ? ALGORITHMS.filter((x) => x.compare === a.compare && x.id !== id) : [];
  const seen = new Set([id]);
  return [...sameCompare, ...sameSub].filter((x) => !seen.has(x.id) && seen.add(x.id)).slice(0, 8);
};

export const stats = () => ({
  total: ALGORITHMS.length,
  demos: demoCount,
  categories: CATEGORIES.length,
  byLevel: [1, 2, 3].map((lv) => ALGORITHMS.filter((a) => a.level === lv).length),
});
