// 演示注册与索引。
// 列表页只需要 id 清单（manifest.js），演示代码按需动态加载，避免把 204 个定义打进入口 chunk。
import { ALGORITHMS, COMPARE_GROUPS, CATEGORIES, BY_ID } from '../data/catalog.js';
import { DEMO_IDS, DEMO_ID_SET, DEMO_CONFIGS } from './manifest.js';

// 只建立 loader 映射，不在构建期执行任何 demo 模块。
// 手写演示走 definitions/<id>.jsx；批量补齐的演示直接走分类配置，省掉 158 个包装 chunk。
const loaders = import.meta.glob('./definitions/*.jsx');
const configLoaders = import.meta.glob('./configs/*.jsx');

export const demoIds = DEMO_IDS;
export const hasDemo = (id) => DEMO_ID_SET.has(id);
export const demoCount = DEMO_IDS.length;

/** 按需加载单个演示定义；返回 null 表示该算法没有演示。 */
export async function loadDemo(id) {
  const cfg = DEMO_CONFIGS[id];
  if (cfg) {
    const loader = configLoaders[`./configs/${cfg}`];
    if (!loader) return null;
    const mod = await loader();
    const def = mod.default?.[id];
    return def ? { id, ...def } : null;
  }
  const loader = loaders[`./definitions/${id}.jsx`];
  if (!loader) return null;
  const mod = await loader();
  return mod.default || null;
}

export const compareItems = (group) => ALGORITHMS.filter((a) => a.compare === group && hasDemo(a.id));
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
