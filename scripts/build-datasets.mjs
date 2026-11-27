// 把公开数据集 CSV 转成紧凑的离线 JS 模块。
// 源数据从 jsdelivr CDN 下载到 .datasets/（仅构建期使用，不进仓库产物）；输出 src/demos/datasets/*.js。
// 用法：node scripts/build-datasets.mjs
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = path.join(root, '.datasets');
const out = path.join(root, 'src/demos/datasets');
fs.mkdirSync(src, { recursive: true });
fs.mkdirSync(out, { recursive: true });

const BASE_SK = 'https://cdn.jsdelivr.net/gh/scikit-learn/scikit-learn@main/sklearn/datasets/data/';
const SOURCES = {
  'iris.csv': `${BASE_SK}iris.csv`,
  'wine_data.csv': `${BASE_SK}wine_data.csv`,
  'breast_cancer.csv': `${BASE_SK}breast_cancer.csv`,
  'diabetes_data_raw.csv.gz': `${BASE_SK}diabetes_data_raw.csv.gz`,
  'diabetes_target.csv.gz': `${BASE_SK}diabetes_target.csv.gz`,
  'digits.csv.gz': `${BASE_SK}digits.csv.gz`,
};
for (const [name, url] of Object.entries(SOURCES)) {
  const dest = path.join(src, name);
  if (fs.existsSync(dest)) continue;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`下载 ${name} 失败：HTTP ${res.status}`);
  fs.writeFileSync(dest, Buffer.from(await res.arrayBuffer()));
  console.log(`下载 ${name}`);
}

const read = (f) => fs.readFileSync(path.join(src, f), 'utf8').trim();
const gunzip = (f) => zlib.gunzipSync(fs.readFileSync(path.join(src, f))).toString('utf8');
const lines = (text) => text.split(/\r?\n/).filter(Boolean);
const num = (v) => Math.round(Number(v) * 1e4) / 1e4;

// 保留 n 位小数的紧凑数组
const compact = (rows) => rows.map((r) => `[${r.map(num).join(',')}]`).join(',\n');

function write(name, meta, body) {
  const header = `// ${meta.title}\n// 来源：${meta.source}\n// 许可：${meta.license}\n// 说明：${meta.note}\n// 本文件由 scripts/build-datasets.mjs 生成，请勿手改。\n\n`;
  fs.writeFileSync(path.join(out, `${name}.js`), header + body);
  console.log(`${name}.js  ${(fs.statSync(path.join(out, `${name}.js`)).size / 1024).toFixed(1)} KB`);
}

// ---- Iris：150×4，3 类，分类/聚类/降维的样板数据 ----
{
  const rows = lines(read('iris.csv')).slice(1).map((l) => {
    const [sl, sw, pl, pw, sp] = l.split(',');
    const label = ['setosa', 'versicolor', 'virginica'].indexOf(sp) >= 0
      ? ['setosa', 'versicolor', 'virginica'].indexOf(sp) : Number(sp);
    return [num(sl), num(sw), num(pl), num(pw), label];
  });
  write('iris', {
    title: 'Iris 鸢尾花数据集（sklearn / UCI）',
    source: 'https://scikit-learn.org/stable/modules/generated/sklearn.datasets.load_iris.html（原始 UCI: https://archive.ics.uci.edu/dataset/53/iris）',
    license: 'CC BY 4.0（UCI）',
    note: '150 个样本，4 个特征（花萼长/宽、花瓣长/宽），3 个物种各 50 个。',
  }, `export const META = ${JSON.stringify({
    name: 'Iris 鸢尾花', short: 'iris', source: 'UCI / scikit-learn',
    url: 'https://archive.ics.uci.edu/dataset/53/iris', license: 'CC BY 4.0',
    desc: '150 朵鸢尾花 · 4 特征 · 3 物种',
    features: ['花萼长', '花萼宽', '花瓣长', '花瓣宽'], classes: ['山鸢尾', '变色鸢尾', '维吉尼亚鸢尾'],
  }, null, 2)};\n\nexport const DATA = [\n${compact(rows)}\n];\n`);
}

// ---- Wine：178×13，3 类，高维分类 ----
{
  const all = lines(read('wine_data.csv'));
  const rows = all.slice(1).map((l) => l.split(',').map(Number)).map((r) => r.map(num));
  write('wine', {
    title: 'Wine 葡萄酒数据集（sklearn / UCI）',
    source: 'https://scikit-learn.org/stable/modules/generated/sklearn.datasets.load_wine.html（原始 UCI: https://archive.ics.uci.edu/dataset/151/wine）',
    license: 'CC BY 4.0（UCI）',
    note: '178 个样本，13 个理化特征，3 个产地类别；末列为类别编号。',
  }, `export const META = ${JSON.stringify({
    name: 'Wine 葡萄酒', short: 'wine', source: 'UCI / scikit-learn',
    url: 'https://archive.ics.uci.edu/dataset/151/wine', license: 'CC BY 4.0',
    desc: '178 瓶葡萄酒 · 13 理化特征 · 3 产地',
    features: ['酒精', '苹果酸', '灰分', '灰分碱度', '镁', '总酚', '类黄酮', '非黄烷类酚', '原花青素', '色泽强度', '色调', '稀释白葡萄酒', '脯氨酸'],
    classes: ['产地 1', '产地 2', '产地 3'],
  }, null, 2)};\n\nexport const DATA = [\n${compact(rows)}\n];\n`);
}

// ---- Breast Cancer：569×30，2 类 ----
{
  const all = lines(read('breast_cancer.csv'));
  // 只保留前 10 个形态特征 + 标签，控制体积（原始 30 特征）
  const rows = all.slice(1).map((l) => l.split(',').map(Number)).map((r) => [...r.slice(0, 10), r[30]].map(num));
  write('breast-cancer', {
    title: 'Breast Cancer 乳腺癌诊断数据集（sklearn / UCI）',
    source: 'https://scikit-learn.org/stable/modules/generated/sklearn.datasets.load_breast_cancer.html（原始 UCI: https://archive.ics.uci.edu/dataset/17/breast+cancer+wisconsin+diagnostic）',
    license: 'CC BY 4.0（UCI）',
    note: '569 个样本，30 个细胞形态特征，二分类（恶性 0 / 良性 1）；末列为标签。',
  }, `export const META = ${JSON.stringify({
    name: 'Breast Cancer 乳腺癌', short: 'breast', source: 'UCI / scikit-learn',
    url: 'https://archive.ics.uci.edu/dataset/17/breast+cancer+wisconsin+diagnostic', license: 'CC BY 4.0',
    desc: '569 个样本 · 30 形态特征 · 良性/恶性',
    features: ['半径', '纹理', '周长', '面积', '平滑度', '紧致度', '凹点', '凹点数量', '对称性', '分形维数'],
    classes: ['恶性', '良性'],
  }, null, 2)};\n\nexport const DATA = [\n${compact(rows)}\n];\n`);
}

// ---- Diabetes：442×10，回归目标 ----
{
  const X = lines(gunzip('diabetes_data_raw.csv.gz')).map((l) => l.trim().split(/\s+/).map(Number).map(num));
  const y = lines(gunzip('diabetes_target.csv.gz')).map((l) => num(Number(l)));
  const rows = X.map((r, i) => [...r, y[i]]);
  write('diabetes', {
    title: 'Diabetes 糖尿病进展数据集（sklearn）',
    source: 'https://scikit-learn.org/stable/modules/generated/sklearn.datasets.load_diabetes.html',
    license: 'CC BY 4.0',
    note: '442 个样本，10 个基线特征（已标准化），目标为一年后疾病进展量化值；末列为目标值。',
  }, `export const META = ${JSON.stringify({
    name: 'Diabetes 糖尿病进展', short: 'diabetes', source: 'scikit-learn',
    url: 'https://scikit-learn.org/stable/modules/generated/sklearn.datasets.load_diabetes.html', license: 'CC BY 4.0',
    desc: '442 个样本 · 10 特征 · 连续目标（疾病进展）',
    features: ['年龄', '性别', 'BMI', '血压', 'T细胞', 'LDL', 'HDL', '总胆固醇', '血糖', 'S1'],
    classes: [],
  }, null, 2)};\n\nexport const DATA = [\n${compact(rows)}\n];\n`);
}

// ---- Digits：1797×64，10 类，手写数字（8×8 像素） ----
{
  const all = lines(gunzip('digits.csv.gz')).map((l) => l.split(',').map(Number));
  // 每类取前 20 张（共 200 张），足够演示且控制体积
  const picked = [];
  const count = Array(10).fill(0);
  for (const r of all) {
    const label = r[64];
    if (count[label] >= 20) continue;
    count[label]++;
    picked.push([...r.slice(0, 64).map(num), label]);
  }
  const rows = picked;
  write('digits', {
    title: 'Digits 手写数字数据集（sklearn / OpenML）',
    source: 'https://scikit-learn.org/stable/modules/generated/sklearn.datasets.load_digits.html',
    license: 'CC BY 4.0',
    note: '原始 1797 张 8×8 手写数字灰度图（0–16），标签 0–9；此处每类取前 20 张共 200 张以控制体积。每行前 64 列为像素，末列为数字。',
  }, `export const META = ${JSON.stringify({
    name: 'Digits 手写数字', short: 'digits', source: 'OpenML / scikit-learn',
    url: 'https://scikit-learn.org/stable/modules/generated/sklearn.datasets.load_digits.html', license: 'CC BY 4.0',
    desc: '200 张 8×8 灰度图（每类 20 张）· 10 个数字',
    features: Array.from({ length: 64 }, (_, i) => `p${i}`), classes: ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9'],
  }, null, 2)};\n\nexport const DATA = [\n${compact(rows)}\n];\n`);
}

console.log('数据集模块生成完毕。');
