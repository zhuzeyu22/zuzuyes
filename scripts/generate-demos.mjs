// 为 catalog 中尚无手写演示的算法生成轻量包装文件（src/demos/generated/）。
// 运行时直接按 manifest 映射加载分类配置，不加载这些包装文件；它们只用于 check:demos 逐项校验。
// 用法：node scripts/generate-demos.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ALGORITHMS } from '../src/data/catalog.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const defDir = path.join(root, 'src/demos/definitions');
const genDir = path.join(root, 'src/demos/generated');
const cfgDir = path.join(root, 'src/demos/configs');
fs.mkdirSync(genDir, { recursive: true });

const CONFIG_FILE = {
  fundamentals: 'fundamentals.jsx',
  'data-structures': 'data-structures.jsx',
  graph: 'graph.jsx',
  ml: 'ml.jsx',
  dl: 'dl.jsx',
  llm: 'llm.jsx',
  rec: 'rec.jsx',
  ir: 'ir.jsx',
  math: 'math.jsx',
};

// 兼容旧版本：把 definitions/ 下自动生成的包装文件迁到 generated/。
for (const f of fs.readdirSync(defDir)) {
  if (!f.endsWith('.jsx')) continue;
  const p = path.join(defDir, f);
  if (fs.readFileSync(p, 'utf8').startsWith('// 由 scripts/generate-demos.mjs 自动生成')) {
    const to = path.join(genDir, f);
    if (!fs.existsSync(to)) fs.renameSync(p, to);
    else fs.unlinkSync(p);
  }
}

const handwritten = new Set(fs.readdirSync(defDir).filter((f) => f.endsWith('.jsx')).map((f) => f.replace(/\.jsx$/, '')));
let created = 0, skipped = 0;
const problems = [];

for (const a of ALGORITHMS) {
  if (handwritten.has(a.id)) { skipped++; continue; }
  const cfg = CONFIG_FILE[a.cat];
  if (!cfg || !fs.existsSync(path.join(cfgDir, cfg))) {
    problems.push(`${a.id}: 缺少配置文件 ${cfg || '(无分类映射)'}`);
    continue;
  }
  const target = path.join(genDir, `${a.id}.jsx`);
  if (fs.existsSync(target)) { skipped++; continue; }
  const source = [
    '// 由 scripts/generate-demos.mjs 自动生成；修改请编辑 src/demos/configs/ 下对应配置。',
    `import CONFIGS from '../configs/${cfg}';`,
    '',
    `export default { id: '${a.id}', ...CONFIGS['${a.id}'] };`,
    '',
  ].join('\n');
  fs.writeFileSync(target, source, 'utf8');
  created++;
}

// 轻量清单：列表页只需 id；运行时按 DEMO_CONFIGS 直接懒加载分类配置。
const demoIds = [
  ...handwritten,
  ...fs.readdirSync(genDir).filter((f) => f.endsWith('.jsx')).map((f) => f.replace(/\.jsx$/, '')),
].sort();
const catById = new Map(ALGORITHMS.map((a) => [a.id, a.cat]));
const generatedIds = fs.readdirSync(genDir).filter((f) => f.endsWith('.jsx')).map((f) => f.replace(/\.jsx$/, '')).sort();
const manifest = [
  '// 由 scripts/generate-demos.mjs 自动生成；只包含 id 与映射，不引入任何演示代码。',
  'export const DEMO_IDS = [',
  ...demoIds.map((id) => `  '${id}',`),
  '];',
  'export const DEMO_ID_SET = new Set(DEMO_IDS);',
  'export const DEMO_CONFIGS = {',
  ...generatedIds.map((id) => `  '${id}': '${CONFIG_FILE[catById.get(id)]}',`),
  '};',
  '',
].join('\n');
fs.writeFileSync(path.join(root, 'src/demos/manifest.js'), manifest, 'utf8');

console.log(`生成 ${created} 个包装文件，保留 ${skipped} 个已有演示；清单 ${demoIds.length} 项。`);
if (problems.length) {
  console.error(`\n${problems.length} 个算法无法生成：\n${problems.join('\n')}`);
  process.exit(1);
}
