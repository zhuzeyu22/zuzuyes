// 共享工具：确定性随机、数据生成、配色。所有 demo 定义文件都可以 import 这里的函数。
// 路径示例：import { makeArray, PALETTE } from '../utils.js';

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function clamp(v, lo, hi) { return Math.min(hi, Math.max(lo, v)); }

// dist: 'random' | 'nearly' | 'reversed' | 'few'
export function makeArray(n, dist = 'random', seed = 7) {
  const rnd = mulberry32(seed);
  const arr = Array.from({ length: n }, (_, i) => 5 + Math.round(rnd() * 95));
  if (dist === 'nearly') {
    arr.sort((a, b) => a - b);
    const swaps = Math.max(1, Math.floor(n * 0.12));
    for (let k = 0; k < swaps; k++) {
      const i = Math.floor(rnd() * n), j = Math.floor(rnd() * n);
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
  } else if (dist === 'reversed') {
    arr.sort((a, b) => b - a);
  } else if (dist === 'few') {
    const pool = [18, 40, 62, 84];
    for (let i = 0; i < n; i++) arr[i] = pool[Math.floor(rnd() * pool.length)];
  }
  return arr;
}

export function makePoints(n, seed = 11, spread = 1) {
  const rnd = mulberry32(seed);
  return Array.from({ length: n }, () => ({
    x: (rnd() - 0.5) * 2 * spread,
    y: (rnd() - 0.5) * 2 * spread,
  }));
}

export function softmax(logits, temperature = 1) {
  const t = Math.max(0.01, temperature);
  const m = Math.max(...logits);
  const ex = logits.map((z) => Math.exp((z - m) / t));
  const s = ex.reduce((a, b) => a + b, 0);
  return ex.map((e) => e / s);
}

export const PALETTE = {
  light: {
    bg: '#ffffff', panel: '#f7f8fc', panel2: '#eef1f8', border: '#e2e6f0',
    text: '#1a1f36', muted: '#6b7291', grid: '#e8ebf3',
    primary: '#226AFF', accent: '#7D87AB', success: '#12a06a',
    danger: '#e5484d', warning: '#f5a524', purple: '#7c5cff', teal: '#0ea5a5',
    series: ['#226AFF', '#e5484d', '#12a06a', '#f5a524', '#7c5cff', '#0ea5a5', '#d946a0', '#5b6b8c'],
  },
  dark: {
    bg: '#12162a', panel: '#191f38', panel2: '#222a48', border: '#2c3559',
    text: '#eef1ff', muted: '#9aa4c8', grid: '#293153',
    primary: '#5b8dff', accent: '#98a4c8', success: '#3ecf92',
    danger: '#ff6b6b', warning: '#ffc14d', purple: '#a78bfa', teal: '#2dd4bf',
    series: ['#5b8dff', '#ff6b6b', '#3ecf92', '#ffc14d', '#a78bfa', '#2dd4bf', '#f472b6', '#8fa3d0'],
  },
};

export function usePalette() {
  // 轻量实现：读取 <html data-theme>，配合 App 中的 ThemeContext 触发重渲染
  if (typeof document === 'undefined') return PALETTE.light;
  return document.documentElement.getAttribute('data-theme') === 'dark' ? PALETTE.dark : PALETTE.light;
}

export const DIST_OPTIONS = [
  { value: 'random', label: '随机分布' },
  { value: 'nearly', label: '近乎有序' },
  { value: 'reversed', label: '逆序' },
  { value: 'few', label: '大量重复' },
];
