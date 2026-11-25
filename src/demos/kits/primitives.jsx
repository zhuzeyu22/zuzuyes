import React from 'react';

/* 共享 SVG 原语：只依赖 React 与主题配色，供新增 demo 配置直接复用。 */

export function num(v, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

export function fmt(v, digits = 2) {
  const n = num(v, 0);
  if (Number.isInteger(n)) return String(n);
  return Number(n.toFixed(digits)).toString();
}

export function stateColor(c, state) {
  const map = {
    active: c.primary, current: c.primary, focus: c.primary,
    done: c.success, ok: c.success, hit: c.success, good: c.success,
    bad: c.danger, fail: c.danger, swap: c.danger, danger: c.danger,
    warn: c.warning, compare: c.warning, warning: c.warning,
    alt: c.purple, purple: c.purple, teal: c.teal,
    muted: c.accent, idle: c.border, dim: c.border,
  };
  return map[state] || c.primary;
}

export function Frame({ c, height = 300, title, subtitle, children }) {
  const H = Math.max(180, num(height, 300));
  return (
    <svg viewBox={`0 0 720 ${H}`} width="100%" height={H} preserveAspectRatio="xMidYMid meet"
      role="img" aria-label={typeof title === 'string' ? title : '算法演示'}>
      <rect x="0" y="0" width="720" height={H} fill={c.bg} />
      {title ? <text x="18" y="22" fontSize="12" fontWeight="600" fill={c.text}>{String(title)}</text> : null}
      {subtitle ? <text x="702" y="22" fontSize="11" textAnchor="end" fill={c.muted}>{String(subtitle)}</text> : null}
      {children}
    </svg>
  );
}

export function Bars({ c, values = [], highlight = {}, marks = {}, height = 300, title,
  subtitle, maxValue, baselineLabel, showValues = true, colors = {} }) {
  const arr = values.map((v) => num(v, 0));
  const H = Math.max(180, num(height, 300));
  const top = title || subtitle ? 38 : 16;
  const base = H - 34;
  const max = Math.max(1, num(maxValue, Math.max(1, ...arr)));
  const gap = arr.length > 32 ? 1 : 3;
  const bw = Math.max(2, (680 - gap * Math.max(0, arr.length - 1)) / Math.max(1, arr.length));
  return (
    <Frame c={c} height={H} title={title} subtitle={subtitle}>
      <line x1="20" y1={base} x2="700" y2={base} stroke={c.grid} strokeWidth="1" />
      {arr.map((v, i) => {
        const h = Math.max(1, (Math.max(0, v) / max) * (base - top));
        const x = 20 + i * (bw + gap);
        const fill = colors[i] || stateColor(c, highlight[i]);
        return (
          <g key={i}>
            <rect x={x} y={base - h} width={bw} height={h} rx={Math.min(3, bw / 3)} fill={fill} opacity="0.92" />
            {showValues && arr.length <= 30
              ? <text x={x + bw / 2} y={base - h - 5} fontSize="9" textAnchor="middle" fill={c.muted}>{fmt(v, 1)}</text>
              : null}
            {marks[i] !== undefined
              ? <text x={x + bw / 2} y={base + 14} fontSize="9" textAnchor="middle" fill={c.muted}>{String(marks[i])}</text>
              : null}
          </g>
        );
      })}
      {baselineLabel ? <text x="20" y={H - 8} fontSize="10" fill={c.muted}>{String(baselineLabel)}</text> : null}
    </Frame>
  );
}

export function Cells({ c, items = [], height = 300, title, subtitle, wrap = 12, cellW = 46,
  cellH = 38, x0 = 22, y0 = 52, gap = 5 }) {
  const H = Math.max(180, num(height, 300));
  const list = Array.isArray(items) ? items : [];
  const perRow = Math.max(1, Math.floor(670 / (num(cellW, 46) + gap)));
  const limit = Math.max(1, num(wrap, perRow));
  const nPerRow = Math.min(perRow, limit);
  return (
    <Frame c={c} height={H} title={title} subtitle={subtitle}>
      {list.map((it, i) => {
        const row = Math.floor(i / nPerRow), col = i % nPerRow;
        const x = x0 + col * (cellW + gap), y = y0 + row * (cellH + gap);
        if (y + cellH > H - 8) return null;
        const fill = it.color || stateColor(c, it.state);
        const label = it.text === undefined || it.text === null ? '' : String(it.text);
        return (
          <g key={i}>
            <rect x={x} y={y} width={cellW} height={cellH} rx="4" fill={fill} opacity={it.state === 'idle' ? 0.25 : 0.88} />
            <text x={x + cellW / 2} y={y + cellH / 2 + 1} fontSize={label.length > 5 ? 9 : 11}
              textAnchor="middle" dominantBaseline="middle" fill={c.bg} fontWeight="600">{label}</text>
            {it.sub !== undefined && it.sub !== null
              ? <text x={x + cellW / 2} y={y + cellH + 11} fontSize="9" textAnchor="middle" fill={c.muted}>{String(it.sub)}</text>
              : null}
          </g>
        );
      })}
    </Frame>
  );
}

export function Matrix({ c, table = [], rowLabels = [], colLabels = [], highlight = [],
  path = [], height = 300, title, subtitle, cell = 34, x0 = 66, y0 = 54 }) {
  const H = Math.max(180, num(height, 300));
  const rows = Array.isArray(table) ? table : [];
  const cols = rows.reduce((m, r) => Math.max(m, Array.isArray(r) ? r.length : 0), 0);
  const values = rows.flat().filter((v) => typeof v === 'number' && Number.isFinite(v));
  const lo = values.length ? Math.min(...values) : 0;
  const hi = values.length ? Math.max(...values) : 1;
  const span = Math.max(1e-9, hi - lo);
  const marks = Array.isArray(highlight) ? highlight : [];
  const markAt = new Map(marks.map((m) => [`${num(m.r)},${num(m.cc, m.c)}`, m]));
  return (
    <Frame c={c} height={H} title={title} subtitle={subtitle}>
      {Array.from({ length: cols }, (_, j) => (
        <text key={`c${j}`} x={x0 + j * cell + cell / 2} y={y0 - 8} fontSize="10" textAnchor="middle" fill={c.muted}>
          {colLabels[j] === undefined ? String(j) : String(colLabels[j])}
        </text>
      ))}
      {rows.map((row, i) => (
        <g key={`r${i}`}>
          <text x={x0 - 8} y={y0 + i * cell + cell / 2 + 3} fontSize="10" textAnchor="end" fill={c.muted}>
            {rowLabels[i] === undefined ? String(i) : String(rowLabels[i])}
          </text>
          {Array.from({ length: cols }, (_, j) => {
            const v = Array.isArray(row) ? row[j] : undefined;
            const mark = markAt.get(`${i},${j}`);
            const numeric = typeof v === 'number' && Number.isFinite(v);
            const intensity = numeric ? 0.1 + 0.55 * ((v - lo) / span) : 0.08;
            const fill = mark ? (mark.color || stateColor(c, mark.state)) : c.primary;
            return (
              <g key={`v${j}`}>
                <rect x={x0 + j * cell} y={y0 + i * cell} width={cell - 2} height={cell - 2} rx="3"
                  fill={fill} opacity={mark ? 0.9 : intensity} />
                <text x={x0 + j * cell + (cell - 2) / 2} y={y0 + i * cell + (cell - 2) / 2 + 3}
                  fontSize={String(v).length > 6 ? 8 : 10} textAnchor="middle" fill={mark ? c.bg : c.text}>
                  {v === undefined ? '' : String(v)}
                </text>
              </g>
            );
          })}
        </g>
      ))}
      {Array.isArray(path) && path.length > 1
        ? <polyline points={path.map((q) => `${x0 + num(q.c) * cell + cell / 2},${y0 + num(q.r) * cell + cell / 2}`).join(' ')}
            fill="none" stroke={c.danger} strokeWidth="2" strokeDasharray="4 3" />
        : null}
    </Frame>
  );
}

export function Curves({ c, series = [], height = 300, title, subtitle, xLabel, yLabel, grid = 10 }) {
  const H = Math.max(180, num(height, 300));
  const list = Array.isArray(series) ? series : [];
  const all = list.flatMap((s) => Array.isArray(s.points) ? s.points : []);
  const xs = all.map((q) => num(q[0])).filter(Number.isFinite);
  const ys = all.map((q) => num(q[1])).filter(Number.isFinite);
  const xmin = xs.length ? Math.min(...xs) : 0, xmax = xs.length ? Math.max(...xs) : 1;
  const ymin = ys.length ? Math.min(...ys) : 0, ymax = ys.length ? Math.max(...ys) : 1;
  const xspan = Math.max(1e-9, xmax - xmin), yspan = Math.max(1e-9, ymax - ymin);
  const left = 52, right = 700, top = 44, bottom = H - 34;
  const px = (x) => left + ((num(x) - xmin) / xspan) * (right - left);
  const py = (y) => bottom - ((num(y) - ymin) / yspan) * (bottom - top);
  return (
    <Frame c={c} height={H} title={title} subtitle={subtitle}>
      {Array.from({ length: num(grid, 10) + 1 }, (_, i) => {
        const y = top + (i / num(grid, 10)) * (bottom - top);
        return <line key={`g${i}`} x1={left} y1={y} x2={right} y2={y} stroke={c.grid} strokeWidth="1" />;
      })}
      <line x1={left} y1={top} x2={left} y2={bottom} stroke={c.border} strokeWidth="1" />
      <line x1={left} y1={bottom} x2={right} y2={bottom} stroke={c.border} strokeWidth="1" />
      <text x={left} y={H - 10} fontSize="10" fill={c.muted}>{xLabel === undefined ? fmt(xmin, 1) : String(xLabel)}</text>
      <text x={right} y={H - 10} fontSize="10" textAnchor="end" fill={c.muted}>{fmt(xmax, 1)}</text>
      <text x={left - 6} y={top - 6} fontSize="10" textAnchor="end" fill={c.muted}>{fmt(ymax, 1)}</text>
      <text x={left - 6} y={bottom + 3} fontSize="10" textAnchor="end" fill={c.muted}>{yLabel === undefined ? fmt(ymin, 1) : String(yLabel)}</text>
      {list.map((s, i) => {
        const points = Array.isArray(s.points) ? s.points : [];
        const poly = points.map((q) => `${px(q[0])},${py(q[1])}`).join(' ');
        return (
          <g key={i}>
            {points.length > 1
              ? <polyline points={poly} fill="none" stroke={s.color || c.series[i % c.series.length]}
                  strokeWidth={num(s.width, 2)} strokeDasharray={s.dashed ? '5 4' : undefined} />
              : null}
            {s.dots !== false ? points.map((q, k) => (
              <circle key={k} cx={px(q[0])} cy={py(q[1])} r={num(s.radius, 2.2)}
                fill={s.color || c.series[i % c.series.length]} />
            )) : null}
            {s.label ? <text x={right - i * 96} y={top - 8} fontSize="10" textAnchor="end"
              fill={s.color || c.series[i % c.series.length]}>{String(s.label)}</text> : null}
          </g>
        );
      })}
    </Frame>
  );
}

export function GraphView({ c, nodes = [], edges = [], height = 300, title, subtitle, directed = false }) {
  const H = Math.max(180, num(height, 300));
  const ns = Array.isArray(nodes) ? nodes : [];
  const es = Array.isArray(edges) ? edges : [];
  const map = new Map(ns.map((n) => [String(n.id), n]));
  const pos = (id) => {
    const n = map.get(String(id));
    return { x: 40 + num(n?.x, 0) * 640, y: 46 + num(n?.y, 0) * (H - 92) };
  };
  return (
    <Frame c={c} height={H} title={title} subtitle={subtitle}>
      <defs>
        <marker id="kit-arrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto">
          <path d="M0,0 L8,4 L0,8 z" fill={c.accent} />
        </marker>
      </defs>
      {es.map((e, i) => {
        const a = pos(e.from), b = pos(e.to);
        const active = e.state === 'active' || e.state === 'done' || e.state === 'bad';
        const color = active ? stateColor(c, e.state) : c.border;
        const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
        return (
          <g key={i}>
            <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={color}
              strokeWidth={active ? 2.4 : 1.2} strokeDasharray={e.dashed ? '4 3' : undefined}
              markerEnd={directed ? 'url(#kit-arrow)' : undefined} opacity={active ? 1 : 0.8} />
            {e.label !== undefined && e.label !== null
              ? <text x={mx} y={my - 4} fontSize="9" textAnchor="middle" fill={c.muted}>{String(e.label)}</text>
              : null}
          </g>
        );
      })}
      {ns.map((n, i) => {
        const x = 40 + num(n.x, 0) * 640, y = 46 + num(n.y, 0) * (H - 92);
        const fill = n.color || stateColor(c, n.state);
        return (
          <g key={i}>
            <circle cx={x} cy={y} r={num(n.r, 13)} fill={fill} opacity={n.state === 'idle' ? 0.35 : 0.95} />
            <text x={x} y={y + 3} fontSize="10" textAnchor="middle" fill={c.bg} fontWeight="600">
              {n.label === undefined ? String(n.id) : String(n.label)}
            </text>
            {n.sub ? <text x={x} y={y + 26} fontSize="9" textAnchor="middle" fill={c.muted}>{String(n.sub)}</text> : null}
          </g>
        );
      })}
    </Frame>
  );
}

export function Scatter({ c, points = [], centers = [], height = 300, title, subtitle, bounds }) {
  const H = Math.max(180, num(height, 300));
  const ps = Array.isArray(points) ? points : [];
  const b = bounds || {};
  const xs = ps.map((p) => num(p.x)), ys = ps.map((p) => num(p.y));
  const xmin = num(b.xmin, xs.length ? Math.min(...xs) : -2), xmax = num(b.xmax, xs.length ? Math.max(...xs) : 2);
  const ymin = num(b.ymin, ys.length ? Math.min(...ys) : -2), ymax = num(b.ymax, ys.length ? Math.max(...ys) : 2);
  const xspan = Math.max(1e-9, xmax - xmin), yspan = Math.max(1e-9, ymax - ymin);
  const px = (x) => 48 + ((num(x) - xmin) / xspan) * 640;
  const py = (y) => H - 32 - ((num(y) - ymin) / yspan) * (H - 88);
  return (
    <Frame c={c} height={H} title={title} subtitle={subtitle}>
      {[0, 1, 2, 3, 4].map((i) => <line key={`gx${i}`} x1={48 + i * 160} y1={40} x2={48 + i * 160} y2={H - 32} stroke={c.grid} />)}
      {[0, 1, 2, 3].map((i) => <line key={`gy${i}`} x1={48} y1={40 + i * ((H - 72) / 4)} x2={688} y2={40 + i * ((H - 72) / 4)} stroke={c.grid} />)}
      {ps.map((p, i) => (
        <circle key={i} cx={px(p.x)} cy={py(p.y)} r={num(p.r, 3.4)}
          fill={p.color || (p.cluster !== undefined ? c.series[num(p.cluster) % c.series.length] : stateColor(c, p.state))}
          opacity={p.opacity === undefined ? 0.88 : num(p.opacity, 0.88)} />
      ))}
      {(Array.isArray(centers) ? centers : []).map((q, i) => (
        <g key={`c${i}`}>
          <path d={`M ${px(q.x) - 7} ${py(q.y)} L ${px(q.x) + 7} ${py(q.y)} M ${px(q.x)} ${py(q.y) - 7} L ${px(q.x)} ${py(q.y) + 7}`}
            stroke={q.color || c.danger} strokeWidth="2.4" fill="none" />
          {q.label ? <text x={px(q.x) + 9} y={py(q.y) - 6} fontSize="9" fill={c.muted}>{String(q.label)}</text> : null}
        </g>
      ))}
    </Frame>
  );
}

export function Flow({ c, items = [], height = 300, title, subtitle, activeIndex = -1, vertical = false }) {
  const H = Math.max(180, num(height, 300));
  const list = Array.isArray(items) ? items : [];
  if (vertical) {
    const boxW = 250, boxH = 34, x = 235, y0 = 46;
    return (
      <Frame c={c} height={H} title={title} subtitle={subtitle}>
        {list.map((it, i) => {
          const y = y0 + i * (boxH + 10);
          if (y + boxH > H - 6) return null;
          const fill = it.color || stateColor(c, it.state);
          return (
            <g key={i}>
              <rect x={x} y={y} width={boxW} height={boxH} rx="5" fill={fill} opacity={i === activeIndex ? 0.95 : 0.55} />
              <text x={x + boxW / 2} y={y + boxH / 2 + 4} fontSize="11" textAnchor="middle" fill={c.bg} fontWeight="600">
                {String(it.label === undefined ? i + 1 : it.label)}
              </text>
              {it.sub ? <text x={x + boxW + 8} y={y + boxH / 2 + 4} fontSize="10" fill={c.muted}>{String(it.sub)}</text> : null}
              {i < list.length - 1 ? <line x1={x + boxW / 2} y1={y + boxH} x2={x + boxW / 2} y2={y + boxH + 10}
                stroke={c.accent} strokeWidth="1.5" /> : null}
            </g>
          );
        })}
      </Frame>
    );
  }
  const n = Math.max(1, list.length);
  const boxW = Math.min(110, (660 - (n - 1) * 14) / n);
  const boxH = 54, y = Math.max(56, (H - boxH) / 2);
  return (
    <Frame c={c} height={H} title={title} subtitle={subtitle}>
      {list.map((it, i) => {
        const x = 30 + i * (boxW + 14);
        const fill = it.color || stateColor(c, it.state);
        return (
          <g key={i}>
            <rect x={x} y={y} width={boxW} height={boxH} rx="6" fill={fill} opacity={i === activeIndex ? 0.95 : 0.55} />
            <text x={x + boxW / 2} y={y + 22} fontSize="10" textAnchor="middle" fill={c.bg} fontWeight="600">
              {String(it.label === undefined ? i + 1 : it.label)}
            </text>
            {it.sub ? <text x={x + boxW / 2} y={y + 40} fontSize="9" textAnchor="middle" fill={c.bg}>{String(it.sub)}</text> : null}
            {i < n - 1 ? <path d={`M${x + boxW + 2},${y + boxH / 2} l8,-4 l0,8 z`} fill={c.accent} /> : null}
          </g>
        );
      })}
    </Frame>
  );
}

export function Timeline({ c, bars = [], height = 300, title, subtitle, max }) {
  const H = Math.max(180, num(height, 300));
  const list = Array.isArray(bars) ? bars : [];
  const last = Math.max(1, num(max, ...list.map((b) => num(b.end, 0))));
  const top = 54, rowH = Math.min(30, (H - 76) / Math.max(1, list.length));
  return (
    <Frame c={c} height={H} title={title} subtitle={subtitle}>
      {Array.from({ length: 6 }, (_, i) => <line key={i} x1={110 + i * 96} y1={top - 8} x2={110 + i * 96} y2={H - 22} stroke={c.grid} />)}
      {list.map((b, i) => {
        const y = top + i * rowH;
        if (y + rowH - 4 > H - 12) return null;
        const x1 = 110 + (num(b.start) / last) * 580;
        const w = Math.max(2, ((num(b.end) - num(b.start)) / last) * 580);
        return (
          <g key={i}>
            <text x="102" y={y + rowH / 2 + 3} fontSize="10" textAnchor="end" fill={c.muted}>{String(b.label)}</text>
            <rect x={x1} y={y} width={w} height={rowH - 5} rx="3" fill={b.color || stateColor(c, b.state)} opacity="0.85" />
            {b.note ? <text x={x1 + w + 6} y={y + rowH / 2 + 3} fontSize="9" fill={c.muted}>{String(b.note)}</text> : null}
          </g>
        );
      })}
      <text x="110" y={H - 6} fontSize="10" fill={c.muted}>0</text>
      <text x="690" y={H - 6} fontSize="10" textAnchor="end" fill={c.muted}>{fmt(last, 1)}</text>
    </Frame>
  );
}

export function TextPanel({ c, lines = [], height = 300, title, subtitle, fontSize = 12 }) {
  const H = Math.max(180, num(height, 300));
  const list = Array.isArray(lines) ? lines : [];
  return (
    <Frame c={c} height={H} title={title} subtitle={subtitle}>
      {list.map((ln, i) => {
        const y = 52 + i * 19;
        if (y > H - 8) return null;
        const text = typeof ln === 'string' ? ln : (ln.text === undefined ? '' : String(ln.text));
        const color = typeof ln === 'string' ? c.text : (ln.color || stateColor(c, ln.state || 'muted'));
        return <text key={i} x="24" y={y} fontSize={num(fontSize, 12)} fill={color}
          fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace">{text}</text>;
      })}
    </Frame>
  );
}

export function Radial({ c, items = [], height = 300, title, subtitle, activeIndex = -1 }) {
  const H = Math.max(180, num(height, 300));
  const list = Array.isArray(items) ? items : [];
  const cx = 360, cy = Math.max(120, H / 2 + 8), r = Math.min(105, (H - 100) / 2);
  return (
    <Frame c={c} height={H} title={title} subtitle={subtitle}>
      {list.map((it, i) => {
        const a = (2 * Math.PI * i) / Math.max(1, list.length) - Math.PI / 2;
        const x = cx + r * Math.cos(a), y = cy + r * Math.sin(a);
        const px2 = cx + r * Math.cos((2 * Math.PI * ((i + 1) % list.length)) / Math.max(1, list.length) - Math.PI / 2);
        const py2 = cy + r * Math.sin((2 * Math.PI * ((i + 1) % list.length)) / Math.max(1, list.length) - Math.PI / 2);
        const fill = it.color || stateColor(c, it.state);
        return (
          <g key={i}>
            {list.length > 1
              ? <line x1={x} y1={y} x2={px2} y2={py2} stroke={c.border} strokeWidth="1" />
              : null}
            <circle cx={x} cy={y} r={num(it.r, 12)} fill={fill} opacity={i === activeIndex ? 1 : 0.62} />
            <text x={x} y={y + 3} fontSize="9" textAnchor="middle" fill={c.bg} fontWeight="600">
              {String(it.label === undefined ? i + 1 : it.label)}
            </text>
          </g>
        );
      })}
    </Frame>
  );
}

export function HeatBars({ c, rows = [], height = 300, title, subtitle, max }) {
  const H = Math.max(180, num(height, 300));
  const list = Array.isArray(rows) ? rows : [];
  const m = Math.max(1, num(max, ...list.flatMap((r) => Array.isArray(r.values) ? r.values : [])));
  const rowH = Math.min(24, (H - 74) / Math.max(1, list.length));
  return (
    <Frame c={c} height={H} title={title} subtitle={subtitle}>
      {list.map((r, i) => {
        const y = 50 + i * rowH;
        if (y + rowH > H - 12) return null;
        const vals = Array.isArray(r.values) ? r.values : [];
        const cellW = Math.min(28, 600 / Math.max(1, vals.length));
        return (
          <g key={i}>
            <text x="106" y={y + rowH - 5} fontSize="10" textAnchor="end" fill={c.muted}>{String(r.label)}</text>
            {vals.map((v, j) => {
              const val = num(v);
              const fill = r.color || c.primary;
              return <rect key={j} x={112 + j * cellW} y={y} width={cellW - 2} height={Math.max(2, rowH - 4)}
                rx="2" fill={fill} opacity={0.1 + 0.85 * (Math.abs(val) / m)} />;
            })}
          </g>
        );
      })}
    </Frame>
  );
}
