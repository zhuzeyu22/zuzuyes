// 根据 configs/ 中的分类配置，为 catalog 中尚无演示的算法生成 definitions/<id>.jsx。
// 已存在的演示文件不会被覆盖。用法：node scripts/generate-demos.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ALGORITHMS } from '../src/data/catalog.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const defDir = path.join(root, 'src/demos/definitions');
const cfgDir = path.join(root, 'src/demos/configs');

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

let created = 0, skipped = 0;
const problems = [];

for (const a of ALGORITHMS) {
  const target = path.join(defDir, `${a.id}.jsx`);
  if (fs.existsSync(target)) { skipped++; continue; }
  const cfg = CONFIG_FILE[a.cat];
  if (!cfg || !fs.existsSync(path.join(cfgDir, cfg))) {
    problems.push(`${a.id}: 缺少配置文件 ${cfg || '(无分类映射)'}`);
    continue;
  }
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

console.log(`生成 ${created} 个演示文件，保留 ${skipped} 个已有演示。`);
if (problems.length) {
  console.error(`\n${problems.length} 个算法无法生成：\n${problems.join('\n')}`);
  process.exit(1);
}
