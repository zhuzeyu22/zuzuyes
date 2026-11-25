// 自检所有交互演示：构建步骤、参数边界、SVG 渲染是否都能跑通。
// 用法：npm run check:demos
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { renderToStaticMarkup } from 'react-dom/server';
import { PALETTE } from '../src/demos/utils.js';
import { BY_ID } from '../src/data/catalog.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const defDir = path.join(root, 'src/demos/definitions');
const outDir = path.join(root, '.demo-check');
const files = fs.readdirSync(defDir).filter((f) => f.endsWith('.jsx')).sort();

if (!files.length) { console.error('没有找到演示文件'); process.exit(1); }
fs.mkdirSync(outDir, { recursive: true });

await build({
  entryPoints: files.map((f) => path.join(defDir, f)),
  outdir: outDir,
  bundle: true,
  format: 'esm',
  platform: 'node',
  external: ['react', 'react-dom'],
  logLevel: 'silent',
});

const defaults = (def) => Object.fromEntries((def.params || []).map((p) => [p.key, p.default]));
const extremes = (def) => {
  const mk = (which) => Object.fromEntries((def.params || []).map((p) => {
    if (p.type === 'range') return [p.key, which === 'min' ? p.min : p.max];
    if (p.type === 'select') return [p.key, (p.options || []).map((o) => o.value)[which === 'min' ? 0 : (p.options || []).length - 1] ?? p.default];
    if (p.type === 'toggle') return [p.key, which === 'min' ? false : true];
    return [p.key, p.default];
  }));
  return [mk('min'), mk('max')];
};

let ok = 0, fail = 0;
const problems = [];
for (const f of files) {
  const id = f.replace(/\.jsx$/, '');
  const mod = await import(pathToFileURL(path.join(outDir, f.replace(/\.jsx$/, '.js'))).href + `?v=${Date.now()}`);
  const def = mod.default;
  const errs = [];
  try {
    if (!def || !def.id) errs.push('缺少 export default / id');
    else {
      if (def.id !== id) errs.push(`id 与文件名不一致: ${def.id} != ${id}`);
      if (!BY_ID[def.id]) errs.push('目录中不存在该算法 id');
      if (typeof def.buildSteps !== 'function') errs.push('缺少 buildSteps');
      if (typeof def.render !== 'function') errs.push('缺少 render');
      if (!(def.params || []).length) errs.push('没有参数控件');
      (def.params || []).forEach((p) => {
        if (!p.key || !p.label || !p.type) errs.push(`参数定义不完整: ${JSON.stringify(p)}`);
        if (p.default === undefined) errs.push(`参数 ${p.key} 缺少 default`);
      });

      const cases = [['默认', defaults(def)], ...extremes(def).map((v, i) => [i ? '上限' : '下限', v])];
      for (const [label, p] of cases) {
        const steps = def.buildSteps(p);
        if (!Array.isArray(steps) || !steps.length) { errs.push(`${label}参数：buildSteps 未返回有效数组`); continue; }
        if (steps.length > 1500) errs.push(`${label}参数：步骤过多 ${steps.length}`);
        const probes = [steps[0], steps[Math.floor(steps.length / 2)], steps[steps.length - 1]];
        const htmls = [];
        probes.forEach((s, i) => {
          if (!s || typeof s !== 'object') { errs.push(`${label}参数：第 ${i} 帧不是对象`); return; }
          if (typeof s.note !== 'string' || !s.note) errs.push(`${label}参数：第 ${i} 帧缺少 note`);
          const el = def.render(s, p, PALETTE.light);
          const html = renderToStaticMarkup(el);
          htmls.push(html);
          if (!html.includes('<svg')) errs.push(`${label}参数：第 ${i} 帧未渲染出 <svg>`);
          if (/NaN|Infinity|undefined/.test(html)) errs.push(`${label}参数：第 ${i} 帧输出含 NaN/Infinity/undefined`);
        });
        if (htmls.length === 3 && new Set(htmls).size < 2 && steps.length > 3) {
          errs.push(`${label}参数：首/中/末帧画面完全相同，疑似静态图`);
        }
      }
    }
  } catch (e) { errs.push(`运行异常: ${e.message}`); }

  if (errs.length) { fail++; problems.push({ id, errs }); console.log(`✗ ${id}\n    ${errs.slice(0, 5).join('\n    ')}`); }
  else { ok++; console.log(`✓ ${id}`); }
}

fs.rmSync(outDir, { recursive: true, force: true });
console.log(`\n结果：${ok} 通过 / ${fail} 失败 / 共 ${files.length}`);
if (fail) {
  console.log('\n失败明细：');
  problems.forEach((p) => console.log(`  ${p.id}: ${p.errs.join(' | ')}`));
  process.exit(1);
}
