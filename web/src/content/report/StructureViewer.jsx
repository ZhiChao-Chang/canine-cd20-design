import React, { useEffect, useRef, useState } from 'react';
import sceneData from '../assets/structures.json';

let libraryPromise;
const groupCache = new Map();
const MODEL_NAMES = { alphafold3: 'AF3', boltz2: 'Boltz-2', esmfold2: 'ESMFold2' };
const MODEL_COLORS = { alphafold3: '#0071e3', boltz2: '#cc4a00', esmfold2: '#07835f' };
const MODELS = Object.keys(MODEL_NAMES);

export function loadLibrary() {
  if (window.$3Dmol) return Promise.resolve();
  if (!libraryPromise) libraryPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'data:application/javascript;base64,' + sceneData.library;
    script.onload = () => window.$3Dmol ? resolve() : reject(new Error('三维显示库未初始化'));
    script.onerror = () => reject(new Error('三维显示库载入失败'));
    document.head.appendChild(script);
  });
  return libraryPromise;
}

export async function loadGroup(id) {
  if (groupCache.has(id)) return groupCache.get(id);
  if (typeof DecompressionStream === 'undefined') throw new Error('请使用支持离线解压的现代浏览器');
  const raw = atob(sceneData.groups[id]);
  const bytes = Uint8Array.from(raw, c => c.charCodeAt(0));
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
  const group = JSON.parse(await new Response(stream).text());
  groupCache.set(id, group);
  if (groupCache.size > 2) groupCache.delete(groupCache.keys().next().value);
  return group;
}

export function StructureViewer({ sceneKey, onSceneChange }) {
  const host = useRef(null), api = useRef(null), models = useRef({}), group = useRef(null), pristine = useRef(null), home = useRef(null);
  const [active, setActive] = useState('alphafold3');
  const [target, setTarget] = useState(true), [cdr, setCdr] = useState(true);
  const [loading, setLoading] = useState(true), [error, setError] = useState('');
  const [residue, setResidue] = useState('');
  const [spin, setSpin] = useState(false);
  const current = sceneData.index.find(x => x.key === sceneKey) || sceneData.index[0];
  const settings = useRef({ active, target, cdr }); settings.current = { active, target, cdr };
  const referenceIds = [...new Set(sceneData.index.map(x => x.reference_id))];
  const options = sceneData.index.filter(x => x.reference_id === current?.reference_id);

  function activeModels() { return settings.current.active === 'overlay' ? MODELS : [settings.current.active]; }
  function fit() {
    const viewer = api.current;
    if (!viewer || !Object.keys(models.current).length) return;
    const ids = activeModels().map(x => models.current[x].getID());
    viewer.zoomTo({ model: ids, chain: settings.current.target ? ['A', 'B', 'H', 'L'] : ['H', 'L'] }, 0);
    const bounds = host.current.getBoundingClientRect();
    if (bounds.width < bounds.height) viewer.zoom(.85 * bounds.width / bounds.height);
    viewer.render();
  }
  function paint() {
    const viewer = api.current;
    if (!viewer || !group.current) return;
    const state = settings.current;
    for (const model of MODELS) {
      const mol = models.current[model]; if (!mol) continue;
      mol.setStyle({}, {});
      if (!activeModels().includes(model)) { mol.hide(); continue; }
      mol.show();
      if (state.target) mol.setStyle({ chain: ['A', 'B'] }, { cartoon: { color: '#8bb5d4', opacity: state.active === 'overlay' ? .22 : .72 } });
      for (const chain of ['H', 'L']) {
        const color = state.active === 'overlay' ? MODEL_COLORS[model] : chain === 'H' ? '#0071e3' : '#e87524';
        mol.setStyle({ chain }, { cartoon: { color } });
        if (state.cdr) mol.setStyle({ chain, resi: group.current.cdr_indices[chain] }, { cartoon: { color: '#ac3189' } });
      }
      mol.setClickable({}, false);
      mol.setClickable({ chain: state.target ? ['A', 'B', 'H', 'L'] : ['H', 'L'] }, true, atom => {
        const role = atom.chain === 'H' ? 'VH' : atom.chain === 'L' ? 'VL' : 'CD20';
        let text = MODEL_NAMES[model] + ' · ' + role + ' · ' + atom.resn + ' · 构建体第' + atom.resi + '位';
        if (role === 'CD20') text += ' · 犬序列第' + group.current.target_positions[atom.resi - 1] + '位';
        setResidue(text);
      });
    }
    viewer.render();
  }

  useEffect(() => {
    let cancelled = false;
    if (!current || !host.current) return undefined;
    setLoading(true); setError(''); setResidue(''); setSpin(false);
    if (api.current) api.current.spin(false);
    Promise.all([loadLibrary(), loadGroup(current.reference_id)]).then(([, data]) => {
      if (cancelled) return;
      if (!api.current) { api.current = window.$3Dmol.createViewer(host.current, { backgroundColor: '#ffffff', antialias: true }); pristine.current = api.current.getView().slice(); }
      const viewer = api.current; viewer.removeAllModels(); viewer.removeAllLabels(); models.current = {}; group.current = data;
      const scene = data.cases.find(x => x.key === current.key);
      if (!scene) throw new Error('未找到该候选坐标');
      for (const model of MODELS) models.current[model] = viewer.addModel(scene.pdb[model], 'pdb');
      viewer.setView(pristine.current); viewer.resize(); paint(); fit(); viewer.rotate(15, 'y'); viewer.rotate(-10, 'x'); home.current = viewer.getView().slice(); viewer.render();
      setLoading(false);
    }).catch(reason => { if (!cancelled) { setError(String(reason.message || reason)); setLoading(false); } });
    return () => { cancelled = true; };
  }, [current?.key]);

  useEffect(() => { paint(); fit(); }, [active, target]);
  useEffect(() => { paint(); }, [cdr]);
  useEffect(() => {
    if (api.current) api.current.spin(spin ? 'y' : false, .5, true);
    return () => { if (api.current) api.current.spin(false); };
  }, [spin]);
  useEffect(() => {
    const observer = new ResizeObserver(entries => {
      if (api.current && entries.some(x => x.contentRect.width > 0 && x.contentRect.height > 0)) { api.current.resize(); fit(); }
    });
    if (host.current) observer.observe(host.current);
    const stop = () => { if (document.hidden) setSpin(false); };
    document.addEventListener('visibilitychange', stop);
    return () => { observer.disconnect(); document.removeEventListener('visibilitychange', stop); if (api.current) api.current.spin(false); };
  }, []);

  useEffect(() => {
    window.researchStructureDiagnostics = () => ({ scene: current?.key, reference: current?.reference_id, loading, error,
      active, target, cdr, spin, modelCount: Object.keys(models.current).length,
      designablePositions: group.current ? Object.values(group.current.cdr_indices).reduce((n,x) => n+x.length,0) : null,
      view: api.current?.getView(), atomCounts: Object.fromEntries(Object.entries(models.current).map(([k,m]) => [k,m.selectedAtoms({}).length])) });
  }, [current?.key, loading, error, active, target, cdr, spin]);

  if (!current) return <div className="molecule-unavailable">当前范围还没有可展示的已验收结构。</div>;
  return <div className="research-molecule">
    <div className="molecule-selector-row">
      <label>参考体系<select aria-label="选择参考体系" value={current.reference_id} onChange={event => onSceneChange(sceneData.index.find(x => x.reference_id === event.target.value).key)}>
        {referenceIds.map(id => <option key={id} value={id}>{sceneData.index.find(x => x.reference_id === id).family} · {id}</option>)}
      </select></label>
      <label>保留候选<select aria-label="选择候选结构" value={current.key} onChange={event => onSceneChange(event.target.value)}>
        {options.map(item => <option key={item.key} value={item.key}>{item.route === 'rfd4' ? 'RFD4' : 'BoltzGen'} · 路线内排名 {item.rank}</option>)}
      </select></label>
    </div>
    <div className="molecule-stage-premium">
      <div ref={host} className="molecule-canvas-premium" tabIndex={0} aria-label="可旋转的抗体与犬CD20预测结构" onKeyDown={event => {
        if (!api.current) return;
        if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') { event.preventDefault(); api.current.rotate(event.key === 'ArrowLeft' ? -10 : 10, 'y'); api.current.render(); }
      }} />
      {loading && <div className="molecule-loading" role="status">正在载入真实结构</div>}
      {error && <div className="molecule-loading" role="alert">{error}。请使用已启用WebGL的现代浏览器。</div>}
      <div className="molecule-view-label">{active === 'overlay' ? '三个预测器叠合 · 种子42' : MODEL_NAMES[active] + '预测结构 · 种子42'}</div>
      <button className="molecule-reset" type="button" aria-label="重置结构视角" onClick={() => { setSpin(false); if (api.current && home.current) api.current.setView(home.current); fit(); }}>↺</button>
    </div>
    <div className="molecule-controls-row">
      <div className="molecule-model-pills" aria-label="选择显示模型">
        {[...MODELS, 'overlay'].map(model => <button type="button" key={model} aria-pressed={active === model} onClick={() => { setActive(model); if (model === 'overlay') setCdr(false); }}>{model === 'overlay' ? '叠合' : MODEL_NAMES[model]}</button>)}
      </div>
      <div className="molecule-toggle-row">
        <label><input type="checkbox" checked={target} onChange={e => setTarget(e.target.checked)} />靶点</label>
        <label><input type="checkbox" checked={cdr} onChange={e => setCdr(e.target.checked)} />CDR</label>
        <label><input type="checkbox" checked={spin} onChange={e => setSpin(e.target.checked)} />转动</label>
        <button type="button" className="molecule-save" onClick={() => { if (api.current) { api.current.render(); const a = document.createElement('a'); a.download = current.reference_id + '_' + current.candidate_id + '.png'; a.href = api.current.pngURI(); a.click(); } }}>保存图像</button>
      </div>
    </div>
    <div className="molecule-legend">{(active==='overlay' ? [['#8bb5d4','CD20'],...MODELS.map(x => [MODEL_COLORS[x],MODEL_NAMES[x]])] : [['#8bb5d4','靶点CD20'],['#0071e3','VH'],['#e87524','VL'],...(cdr ? [['#ac3189','CDR']] : [])]).map(([color,name]) => <span key={name}><i style={{background:color}} />{name}</span>)}</div>
    <div className="molecule-caption"><span>{residue || '拖动旋转，滚轮缩放。坐标来自实际预测。'}</span><span>结构对比，不代表分子运动</span></div>
  </div>;
}
