import React, { useEffect, useRef, useState } from 'react';
import diagnosticData from '../assets/diagnostic-scenes.json';
import { loadLibrary, loadGroup } from './StructureViewer.jsx';

const names = { alphafold3:'AF3', boltz2:'Boltz-2', esmfold2:'ESMFold2', afdb:'犬AFDB v6', reference:'人源实验参考' };
const colors = { alphafold3:'#0071e3', boltz2:'#cc4a00', esmfold2:'#07835f', afdb:'#167c98', reference:'#8153a1' };
const predictors = ['alphafold3','boltz2','esmfold2'];
const frameNames = { core:'CD20核心叠合', tm:'跨膜区叠合', ecd:'胞外区叠合', fv:'Fv自身叠合' };
const cache = new Map();

async function unpack(key, encoded) {
  if (cache.has(key)) return cache.get(key);
  const bytes = Uint8Array.from(atob(encoded), c => c.charCodeAt(0));
  const data = JSON.parse(await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).text());
  cache.set(key,data);
  return data;
}

export function applyTransform(model, matrix) {
  if (!matrix) return;
  const { r,t } = matrix;
  model.selectedAtoms({}).forEach(atom => {
    const {x,y,z}=atom;
    atom.x=x*r[0][0]+y*r[1][0]+z*r[2][0]+t[0];
    atom.y=x*r[0][1]+y*r[1][1]+z*r[2][1]+t[1];
    atom.z=x*r[0][2]+y*r[1][2]+z*r[2][2]+t[2];
  });
}

export async function loadDiagnosticReference(id) { return unpack(id, diagnosticData.references[id]); }

export function DiagnosticViewer({ referenceId='6VJA', sceneKey, purpose='target' }) {
  const host=useRef(null), viewer=useRef(null), molecules=useRef({}), payload=useRef(null), home=useRef(null), pristine=useRef(null);
  const [subject,setSubject]=useState(purpose==='candidate'?'candidate':'native');
  const [frame,setFrame]=useState('core'), [active,setActive]=useState('alphafold3');
  const [sample,setSample]=useState('1'), [showTarget,setShowTarget]=useState(true), [showFv,setShowFv]=useState(true);
  const [showReference,setShowReference]=useState(true), [spin,setSpin]=useState(false);
  const [busy,setBusy]=useState(true), [error,setError]=useState(''), [picked,setPicked]=useState('');
  const [enabled,setEnabled]=useState(false);
  const settings=useRef({});
  settings.current={active,showTarget,showFv,showReference,frame,subject};

  function paint() {
    if (!viewer.current || !payload.current) return;
    const state=settings.current, data=payload.current;
    for(const [key,mol] of Object.entries(molecules.current)) {
      mol.setStyle({},{});
      if(key==='reference' && subject!=='native' && !state.showReference) {mol.hide();continue;}
      if(predictors.includes(key) && state.active!=='overlay' && state.active!==key) {mol.hide();continue;}
      mol.show();
      if(data.fullNative && key==='reference') {
        const native=data.native;
        if(state.showTarget) mol.setStyle({chain:native.target_chains},{cartoon:{color:'#6e879b'}});
        if(state.showFv) {
          mol.setStyle({chain:native.heavy_chains},{cartoon:{color:'#8759ba'}});
          mol.setStyle({chain:native.light_chains},{cartoon:{color:'#d29845'}});
        }
      } else if(data.referenceMonomer && key==='reference') {
        if(state.showTarget) mol.setStyle({chain:['A']},{cartoon:{color:colors.reference,opacity:.6}});
      } else if(data.monomer || key==='afdb') {
        if(state.showTarget) mol.setStyle({},{cartoon:{color:colors[key],opacity:key==='reference'?.45:.95}});
      } else {
        const reference=key==='reference';
        if(state.showTarget) mol.setStyle({chain:['A','B']},{cartoon:{color:reference?'#9c89b8':colors[key],opacity:reference?.4:.48}});
        if(state.showFv) mol.setStyle({chain:['H','L']},{cartoon:{color:colors[key],opacity:reference?.65:1}});
      }
      mol.setClickable({},true,atom=>{
        const target=data.fullNative ? data.native.target_chains.includes(atom.chain) : data.monomer || key==='afdb' || ['A','B'].includes(atom.chain);
        let position=atom.resi;
        if(target && !data.fullNative && !data.monomer && key!=='afdb') position+=45;
        setPicked(`${data.afdbReference && key==='reference'?'犬AFDB预测参考':names[key]} · 链${atom.chain} · ${atom.resn} ${atom.resi}${atom.icode||''}${target && !data.fullNative ? ` · CD20序列位置${position}`:''}`);
      });
    }
    viewer.current.render();
  }

  function fit() {
    if(!viewer.current) return;
    const ids=Object.entries(molecules.current).filter(([key])=>key==='reference'?subject==='native'||settings.current.showReference:!predictors.includes(key)||settings.current.active==='overlay'||settings.current.active===key).map(([,mol])=>mol.getID());
    const filter={model:ids};
    if(frame==='fv' && !payload.current?.monomer) filter.chain=['H','L'];
    viewer.current.zoomTo(filter,0);
    const box=host.current.getBoundingClientRect();
    if(box.width<box.height) viewer.current.zoom(.85*box.width/box.height);
    viewer.current.render();
  }

  useEffect(()=>{
    const observer=new IntersectionObserver(entries=>{if(entries.some(e=>e.isIntersecting)){setEnabled(true);observer.disconnect();}},{rootMargin:'300px'});
    if(host.current) observer.observe(host.current);
    return()=>observer.disconnect();
  },[]);

  useEffect(()=>{
    if(!enabled || !host.current) return;
    let cancelled=false;
    setBusy(true);setError('');setPicked('');setSpin(false);
    if(viewer.current) viewer.current.spin(false);
    (async()=>{
      await loadLibrary();
      const group=await unpack(referenceId,diagnosticData.references[referenceId]);
      const monomers=await unpack('monomers',diagnosticData.monomers);
      let pdb={}, transforms={}, info={native:group.native}, effective=frame;
      if(subject==='native') {
        pdb.reference=group.native.pdb; info.fullNative=true;
      } else if(subject==='afdb') {
        pdb.afdb=monomers.afdb_pdb;transforms.afdb=group.afdb_native_frame;
        pdb.reference=group.native.study_pdb;
        // Only one observed human subunit is used for the monomer comparison.
        info.referenceMonomer=true;
      } else if(subject==='full') {
        const full=monomers.cases[sample];
        effective=frame==='fv'?'core':frame;
        pdb={...full.pdb,reference:monomers.afdb_pdb};
        transforms=full.frames[effective];info.monomer=true;info.afdbReference=true;
      } else {
        let selected;
        if(subject==='candidate') {
          const cases=await loadGroup(referenceId);
          const match=cases.cases.find(c=>c.key===sceneKey)||cases.cases[0];
          if(!match) throw new Error('当前参考没有可显示的候选');
          selected={pdb:match.pdb,...diagnosticData.candidate_frames[match.key]};
          info.scene=match.key;
        } else selected=group.parents[subject==='human'?'parent_human':'parent_dog'];
        pdb={...selected.pdb,reference:group.native.study_pdb};
        transforms={...selected.frames[effective],reference:selected.native_frames[effective]};
      }
      if(cancelled) return;
      if(!viewer.current) {viewer.current=window.$3Dmol.createViewer(host.current,{backgroundColor:'#fff',antialias:true});pristine.current=viewer.current.getView().slice();}
      viewer.current.removeAllModels();molecules.current={};payload.current=info;
      viewer.current.setView(pristine.current);
      for(const [key,text]of Object.entries(pdb)) {
        const mol=viewer.current.addModel(text,'pdb');
        applyTransform(mol,transforms[key]);
        molecules.current[key]=mol;
      }
      if(info.referenceMonomer) {
        // Hide the second human subunit/Fv in this mode during paint below.
        payload.current.monomerNativeContext=true;
      }
      paint();fit();viewer.current.rotate(75,'x');viewer.current.render();home.current=viewer.current.getView().slice();
      setBusy(false);
    })().catch(e=>{if(!cancelled){setError(e.message);setBusy(false);}});
    return()=>{cancelled=true;};
  },[enabled,referenceId,sceneKey,subject,frame,sample]);

  useEffect(()=>{paint();fit();},[active,showTarget,showFv,showReference]);
  useEffect(()=>{if(viewer.current)viewer.current.spin(spin?'y':false,1);},[spin]);
  useEffect(()=>{
    const resize=new ResizeObserver(()=>{if(viewer.current){viewer.current.resize();fit();}});
    if(host.current)resize.observe(host.current);
    return()=>resize.disconnect();
  },[]);
  useEffect(()=>()=>{if(viewer.current){viewer.current.spin(false);viewer.current.clear();}},[]);
  useEffect(()=>{
    if(!enabled) return;
    window.researchDiagnosticViewers=window.researchDiagnosticViewers||{};
    window.researchDiagnosticViewers[purpose]=()=>{
      const atomSets=Object.fromEntries(predictors.filter(key=>molecules.current[key]).map(key=>[key,molecules.current[key].selectedAtoms({chain:['H','L'],atom:'CA'})]));
      const base=atomSets.alphafold3;
      const distances=base?.length?Object.fromEntries(Object.entries(atomSets).map(([key,atoms])=>[key,atoms.length===base.length?Math.sqrt(atoms.reduce((sum,a,i)=>sum+(a.x-base[i].x)**2+(a.y-base[i].y)**2+(a.z-base[i].z)**2,0)/base.length):null])):{};
      return {reference:referenceId,subject,frame,active,loading:busy,error,scene:payload.current?.scene,
        atoms:Object.fromEntries(Object.entries(molecules.current).map(([key,mol])=>[key,mol.selectedAtoms({}).length])),fvRmsdToAf3:distances,
        view:viewer.current?.getView(),showTarget,showFv,showReference};
    };
    return()=>{delete window.researchDiagnosticViewers?.[purpose];};
  },[enabled,referenceId,subject,frame,active,busy,error,showTarget,showFv,showReference]);

  const hasPredictors=['candidate','human','dog','full'].includes(subject);
  const referenceLabel=subject==='full'?'AFDB预测参考':subject==='afdb'?'人源实验CD20单体':'人源实验四链范围';
  const description=subject==='native'?'原始实验坐标，使用作者链名与残基标识，展示条目实际解析的CD20及Fab链。':
    subject==='afdb'?'犬AFDB全长单体与当前人源实验CD20单体按核心叠合，比较靶点形状。':
    subject==='full'?'全长犬CD20单体预测，按选定区域对AFDB叠合；每模型第n份样本不代表相同种子的配对。':
    frame==='fv'?'把Boltz-2、ESMFold2及实验参考的VH/VL共同叠合到AF3的VH/VL，查看Fv内部形状。':
    `种子42；各模型以${frame==='core'?'两个CD20核心':frame==='tm'?'跨膜区':'胞外区'}叠合到AF3。人源参考只显示与四链预测对应的已解析范围。`;
  return <div className="explain-viewer" data-viewer={purpose}>
    <div className="explain-viewer-toolbar">
      <label>浏览内容<select aria-label={purpose==='target'?'靶点结构内容':'诊断结构内容'} value={subject} onChange={e=>setSubject(e.target.value)}>
        {purpose==='candidate'&&<option value="candidate">当前设计候选</option>}
        <option value="native">人源实验复合物 · 原始装配</option><option value="afdb">犬全长CD20 · AFDB预测</option>
        <option value="human">人CD20＋原始抗体 · 亲本预测</option><option value="dog">犬CD20＋原始抗体 · 亲本预测</option>
        <option value="full">犬全长单体 · 三模型预测</option>
      </select></label>
      {hasPredictors&&<label>叠合基准<select aria-label={purpose==='target'?'靶点叠合基准':'诊断叠合基准'} value={frame} onChange={e=>{setFrame(e.target.value);if(e.target.value==='fv')setShowTarget(false);else setShowTarget(true);}}>
        {Object.entries(frameNames).filter(([key])=>subject!=='full'||key!=='fv').map(([key,name])=><option key={key}value={key}>{name}</option>)}
      </select></label>}
      {subject==='full'&&<label>样本序号<select value={sample} onChange={e=>setSample(e.target.value)}>{['1','2','3','4','5'].map(i=><option key={i}>{i}</option>)}</select></label>}
    </div>
    <div className="explain-molecule-stage">
      <div className="explain-molecule-canvas" ref={host} tabIndex={0} aria-label={purpose==='target'?'人源参考与犬CD20交互结构':'抗体姿态分解交互结构'} onKeyDown={e=>{if(viewer.current&&['ArrowLeft','ArrowRight'].includes(e.key)){e.preventDefault();viewer.current.rotate(e.key==='ArrowLeft'?-10:10,'y');viewer.current.render();}}}/>
      {(busy||error)&&<div className="explain-molecule-status" role={error?'alert':'status'}>{error||(!enabled?'滚动到此处载入实际结构':'正在载入实际结构')}</div>}
      <button type="button" className="explain-view-reset" aria-label={purpose==='target'?'重置靶点视角':'重置诊断视角'} onClick={()=>{setSpin(false);if(viewer.current&&home.current){viewer.current.setView(home.current);viewer.current.render();}}}>↺</button>
    </div>
    {hasPredictors&&<div className="explain-model-buttons">{[...predictors,'overlay'].map(key=><button key={key}type="button"aria-pressed={active===key}onClick={()=>setActive(key)}>{key==='overlay'?'三模型叠合':names[key]}</button>)}</div>}
    <div className="explain-viewer-switches">
      <label><input type="checkbox"checked={showTarget}onChange={e=>setShowTarget(e.target.checked)}/>CD20</label>
      {subject!=='full'&&subject!=='afdb'&&<label><input type="checkbox"checked={showFv}onChange={e=>setShowFv(e.target.checked)}/>抗体{subject==='native'?'Fab':'Fv'}</label>}
      {subject!=='native'&&<label><input type="checkbox"checked={showReference}onChange={e=>setShowReference(e.target.checked)}/>{referenceLabel}</label>}
      <label><input type="checkbox"checked={spin}onChange={e=>setSpin(e.target.checked)}/>旋转</label>
      <button type="button"onClick={()=>{if(!viewer.current)return;const a=document.createElement('a');a.download=`${referenceId}_${subject}_${frame}.png`;a.href=viewer.current.pngURI();a.click();}}>保存当前视图</button>
    </div>
    <div className="explain-molecule-legend">
      {subject==='native'?<><span><i style={{background:'#6e879b'}}/>人源CD20</span><span><i style={{background:'#8759ba'}}/>Fab重链</span><span><i style={{background:'#d29845'}}/>Fab轻链</span></>:
        <>{(hasPredictors?predictors.filter(key=>active==='overlay'||active===key):['afdb']).map(key=><span key={key}><i style={{background:colors[key]}}/>{names[key]}</span>)}{showReference&&<span><i style={{background:colors.reference}}/>{subject==='full'?'犬AFDB预测参考':'人源实验参考'}</span>}</>}
    </div>
    <p className="explain-viewer-note">{description}</p>
    <div className="explain-picked">{picked||'拖动旋转，滚轮缩放；点击残基查看链名和位置。'}</div>
  </div>;
}
