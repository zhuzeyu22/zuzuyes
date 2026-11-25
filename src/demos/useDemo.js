import { useEffect, useState } from 'react';
import { hasDemo, loadDemo } from './registry.js';

const IDLE = { def: null, loading: false, error: null };

/** 按算法 id 懒加载单个演示定义。 */
export function useDemo(id) {
  const [state, setState] = useState(() => (id && hasDemo(id) ? { def: null, loading: true, error: null } : IDLE));

  useEffect(() => {
    let alive = true;
    if (!id || !hasDemo(id)) { setState(IDLE); return () => { alive = false; }; }
    setState({ def: null, loading: true, error: null });
    loadDemo(id)
      .then((def) => { if (alive) setState({ def, loading: false, error: null }); })
      .catch((error) => { if (alive) setState({ def: null, loading: false, error }); });
    return () => { alive = false; };
  }, [id]);

  return state;
}

/** 批量懒加载对比页演示；用 id 拼接键避免数组引用变化导致重复加载。 */
export function useDemos(ids) {
  const key = (ids || []).join('|');
  const [state, setState] = useState(() => (key ? { defs: [], loading: true, error: null } : { defs: [], loading: false, error: null }));

  useEffect(() => {
    let alive = true;
    const list = key ? key.split('|') : [];
    if (!list.length) { setState({ defs: [], loading: false, error: null }); return () => { alive = false; }; }
    setState({ defs: [], loading: true, error: null });
    Promise.all(list.map((id) => loadDemo(id).catch(() => null)))
      .then((loaded) => {
        if (!alive) return;
        setState({
          defs: loaded.map((def, i) => ({ id: list[i], def })).filter((x) => x.def),
          loading: false,
          error: null,
        });
      });
    return () => { alive = false; };
  }, [key]);

  return state;
}
