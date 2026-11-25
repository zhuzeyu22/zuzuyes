import React, { useEffect, useMemo, useRef, useState } from 'react';
import { PALETTE, clamp } from './utils.js';
import { useTheme } from '../theme.jsx';

/* ------------------------------------------------------------------ *
 * 交互演示统一规范（所有 demo 定义文件必须遵守）
 *
 * export default {
 *   id: 'bubble-sort',                 // 必须与 catalog.js 的算法 id 一致
 *   params: [                          // 参数控件，类型 range / select / toggle
 *     { key, label, type, default, min, max, step, unit, options, hint }
 *   ],
 *   buildSteps: (p) => [               // 纯函数：依据参数生成步骤快照数组
 *     { ...任意数据, note: '这一步在做什么', metrics: { 比较: 12, 交换: 3 } }
 *   ],
 *   render: (snap, p, c) => <svg …>,  // 纯函数：渲染当前快照；c 为当前主题配色
 *   height: 300,                      // 可选，画布高度
 *   legend: [{ color: '#226AFF', label: '比较中' }], // 可选
 *   hint: '可选的一句话提示',
 * };
 *
 * 约定：
 *  - buildSteps 必须是纯函数，不修改入参，不依赖随机数（需要随机就用 mulberry32(seed)）。
 *  - 快照数组长度建议 20~800；每个快照都应是完整状态，便于拖动进度条。
 *  - render 返回的 JSX 根节点请用 <svg viewBox="0 0 720 H" …> 或 <div>；
 *    颜色一律取 c.* / c.series[i]，不要写死深色或浅色。
 *  - 不要 import 任何第三方库，只用 React + ../utils.js。
 * ------------------------------------------------------------------ */

export function defaultParams(def) {
  const out = {};
  (def.params || []).forEach((p) => { out[p.key] = p.default; });
  return out;
}

function Control({ spec, value, onChange }) {
  const id = `p-${spec.key}`;
  if (spec.type === 'range') {
    return (
      <div className="param-item">
        <label htmlFor={id}>
          <span>{spec.label}</span>
          <b>{value}{spec.unit || ''}</b>
        </label>
        <input id={id} type="range" min={spec.min} max={spec.max} step={spec.step || 1}
          value={value} onChange={(e) => onChange(Number(e.target.value))} />
        {spec.hint && <small>{spec.hint}</small>}
      </div>
    );
  }
  if (spec.type === 'select') {
    return (
      <div className="param-item">
        <label htmlFor={id}><span>{spec.label}</span></label>
        <select id={id} value={value} onChange={(e) => onChange(e.target.value)}>
          {(spec.options || []).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        {spec.hint && <small>{spec.hint}</small>}
      </div>
    );
  }
  if (spec.type === 'toggle') {
    return (
      <div className="param-item param-toggle">
        <label htmlFor={id}><span>{spec.label}</span></label>
        <button id={id} className={`switch ${value ? 'on' : ''}`} onClick={() => onChange(!value)}
          aria-pressed={!!value}><i /></button>
        {spec.hint && <small>{spec.hint}</small>}
      </div>
    );
  }
  return null;
}

export function ParamControls({ def, values, onChange, columns = 3 }) {
  return (
    <div className="param-grid" style={{ '--cols': columns }}>
      {(def.params || []).map((spec) => (
        <Control key={spec.key} spec={spec} value={values[spec.key]}
          onChange={(v) => onChange({ ...values, [spec.key]: v })} />
      ))}
    </div>
  );
}

const Icon = {
  play: <path d="M8 5v14l11-7z" fill="currentColor" />,
  pause: <path d="M6 5h4v14H6zM14 5h4v14h-4z" fill="currentColor" />,
  prev: <path d="M6 5h2v14H6zM19 5v14l-10-7z" fill="currentColor" />,
  next: <path d="M16 5h2v14h-2zM5 5v14l10-7z" fill="currentColor" />,
  reset: <path d="M12 5V2L7 6l5 4V7a5 5 0 1 1-5 5H5a7 7 0 1 0 7-7z" fill="currentColor" />,
};

/**
 * controller（可选）用于对比页同步播放：
 * { idx, playing, speed, setIdx, setPlaying, setSpeed }
 * 传入时 runner 自身的播放按钮改为操作 controller，多个 runner 共享同一个进度时钟。
 */
export default function DemoRunner({ def, params: externalParams, onParamsChange, hideParams = false, controller = null, title = null }) {
  const { theme } = useTheme();
  const c = PALETTE[theme] || PALETTE.light;
  const [internalParams, setInternalParams] = useState(() => defaultParams(def));
  const params = externalParams || internalParams;
  const setParams = (v) => {
    if (onParamsChange) onParamsChange(v);
    else if (!externalParams) setInternalParams(v);
  };
  const [internalIdx, setInternalIdx] = useState(0);
  const [internalPlaying, setInternalPlaying] = useState(false);
  const [internalSpeed, setInternalSpeed] = useState(5);
  const [showSteps, setShowSteps] = useState(false);
  const stepListRef = useRef(null);

  const idx = controller ? clamp(controller.idx, 0, 999999) : internalIdx;
  const playing = controller ? controller.playing : internalPlaying;
  const speed = controller ? controller.speed : internalSpeed;
  const setPlaying = controller ? controller.setPlaying : setInternalPlaying;
  const setIdx = controller ? controller.setIdx : setInternalIdx;
  const setSpeed = controller ? controller.setSpeed : setInternalSpeed;

  const steps = useMemo(() => {
    try { return def.buildSteps(params) || [{ note: '暂无数据' }]; }
    catch (err) { return [{ note: `演示数据生成失败：${err.message}` }]; }
  }, [def, JSON.stringify(params)]);

  const total = Math.max(1, steps.length);
  const safeIdx = Math.min(idx, total - 1);
  const snap = steps[safeIdx] || {};

  // 完整步骤清单：每帧的 note + 关键指标，点击即可跳转
  const stepNotes = useMemo(() => steps.map((s, i) => ({
    i,
    note: s?.note || def.hint || `第 ${i + 1} 步`,
    metrics: s?.metrics || null,
  })), [steps, def.hint]);

  useEffect(() => {
    if (!showSteps || !stepListRef.current) return;
    const active = stepListRef.current.querySelector('.steps-item.on');
    if (active) active.scrollIntoView({ block: 'nearest' });
  }, [showSteps, safeIdx]);

  // 参数变化时回到起点
  useEffect(() => { setInternalIdx(0); if (controller) controller.setIdx(0); }, [JSON.stringify(params)]);

  // 播放时钟：非 controller 模式各自驱动；controller 模式由对比页统一驱动
  useEffect(() => {
    if (controller || !playing) return;
    const delay = Math.max(16, 620 - speed * 58);
    const t = setInterval(() => {
      setInternalIdx((i) => Math.min(steps.length - 1, i + 1));
    }, delay);
    return () => clearInterval(t);
  }, [controller, playing, speed, steps.length]);

  useEffect(() => {
    if (!controller && internalPlaying && internalIdx >= total - 1) setInternalPlaying(false);
  }, [controller, internalPlaying, internalIdx, total]);

  const H = def.height || 300;
  let canvas = null;
  try {
    canvas = def.render(snap, params, c);
  } catch (err) {
    canvas = <div className="demo-error">渲染出错：{err.message}</div>;
  }

  return (
    <div className="demo-runner">
      {title && <h3 className="demo-title">{title}</h3>}
      {!hideParams && (def.params || []).length > 0 && (
        <div className="demo-params">
          <div className="demo-params-head"><span>参数调节</span>
            <button className="text-btn" onClick={() => setParams(defaultParams(def))}>恢复默认</button></div>
          <ParamControls def={def} values={params} onChange={setParams} />
        </div>
      )}

      <div className="demo-canvas" style={{ minHeight: H }}>
        {canvas}
      </div>

      {(def.legend || []).length > 0 && (
        <div className="demo-legend">
          {def.legend.map((l, i) => <span key={i}><i style={{ background: l.color || c.series[i] }} />{l.label}</span>)}
        </div>
      )}

      <div className="demo-controls">
        <div className="transport">
          <button title="上一步" onClick={() => { setPlaying(false); setIdx(Math.max(0, safeIdx - 1)); }}>
            <svg viewBox="0 0 24 24" width="16" height="16">{Icon.prev}</svg></button>
          <button className="primary" title={playing ? '暂停' : '播放'}
            onClick={() => { if (safeIdx >= total - 1) setIdx(0); setPlaying(!playing); }}>
            <svg viewBox="0 0 24 24" width="16" height="16">{playing ? Icon.pause : Icon.play}</svg>
            {playing ? '暂停' : '播放'}</button>
          <button title="下一步" onClick={() => { setPlaying(false); setIdx(Math.min(total - 1, safeIdx + 1)); }}>
            <svg viewBox="0 0 24 24" width="16" height="16">{Icon.next}</svg></button>
          <button title="重置" onClick={() => { setPlaying(false); setIdx(0); }}>
            <svg viewBox="0 0 24 24" width="16" height="16">{Icon.reset}</svg></button>
        </div>
        <input className="scrubber" type="range" min={0} max={total - 1} value={safeIdx}
          onChange={(e) => { setPlaying(false); setIdx(Number(e.target.value)); }} />
        <span className="step-count">{safeIdx + 1} / {total}</span>
        {!controller && <label className="speed-ctl">速度
          <input type="range" min="1" max="10" value={speed} onChange={(e) => setSpeed(Number(e.target.value))} />
        </label>}
      </div>

      <div className="demo-note">
        <b>第 {safeIdx + 1} 步</b>
        <span>{snap.note || def.hint || '拖动进度条查看每一步变化'}</span>
      </div>

      <div className="steps-bar">
        <button className="text-btn steps-toggle" onClick={() => setShowSteps((v) => !v)}
          aria-expanded={showSteps} title="查看全部步骤并跳转">
          {showSteps ? '▾ 收起完整步骤' : `▸ 展开完整步骤（${total}）`}
        </button>
        <span className="steps-tip">点击任一步骤直接跳转 · 播放时自动跟随当前步</span>
      </div>

      {showSteps && (
        <div className="steps-panel" ref={stepListRef}>
          {stepNotes.map((s) => (
            <button key={s.i} className={`steps-item ${s.i === safeIdx ? 'on' : ''}`}
              onClick={() => { setPlaying(false); setIdx(s.i); }}>
              <span className="si-idx">{s.i + 1}</span>
              <span className="si-body">
                <b>{s.note}</b>
                {s.metrics && Object.keys(s.metrics).length > 0 && (
                  <em>{Object.entries(s.metrics).map(([k, v]) =>
                    `${k} ${typeof v === 'number' && !Number.isInteger(v) ? v.toFixed(2) : v}`
                  ).join(' · ')}</em>
                )}
              </span>
            </button>
          ))}
        </div>
      )}

      {snap.metrics && Object.keys(snap.metrics).length > 0 && (
        <div className="demo-metrics">
          {Object.entries(snap.metrics).map(([k, v]) => (
            <span key={k}><em>{typeof v === 'number' && !Number.isInteger(v) ? v.toFixed(3) : v}</em>{k}</span>
          ))}
        </div>
      )}
    </div>
  );
}
