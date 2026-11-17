import React, { useEffect, useMemo, useRef, useState } from 'react';
import { DataComponent, RichNarrative, useProjectReport } from '../../project-ui.jsx';
import data from '../assets/candidate-comparison.json';
import { loadLibrary, loadGroup } from './StructureViewer.jsx';
import { loadDiagnosticReference, applyTransform } from './DiagnosticViewer.jsx';
import './candidate-workbench.css';

const models={alphafold3:'AF3',boltz2:'Boltz-2',esmfold2:'ESMFold2'};
const regions=['H1','H2','H3','L1','L2','L3'];
const regionNames={H1:'重链CDR1',H2:'重链CDR2',H3:'重链CDR3',L1:'轻链CDR1',L2:'轻链CDR2',L3:'轻链CDR3'};
const byKey=new Map(data.entries.map(e=>[e.key,e]));
const palette=['#0071e3','#cc4a00','#07835f','#9146b3','#b03278','#9c6b00','#027e86','#4f46e5','#b74641','#405466'];
const groupCache=new Map();
const colorFor=key=>{let i=data.palette_keys.indexOf(key);if(i<0)i=data.palette_keys.length+data.entries.findIndex(e=>e.key===key);return i<palette.length?palette[i]:`hsl(${(i*137.508)%360} 68% 41%)`;};
const label=e=>`${e.reference_id} · ${e.route==='rfd4'?'RFD4':'BoltzGen'} #${e.rank}`;
const median=xs=>{const a=xs.filter(Number.isFinite).sort((a,b)=>a-b);return a.length?a.length%2?a[(a.length-1)/2]:(a[a.length/2-1]+a[a.length/2])/2:null;};
const fmt=x=>Number.isFinite(x)?x.toFixed(1):'—';
function getGroup(ref){if(!groupCache.has(ref))groupCache.set(ref,loadGroup(ref));return groupCache.get(ref);}
function download(name,text,type='text/plain'){const u=URL.createObjectURL(new Blob([text],{type})),a=document.createElement('a');a.href=u;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(u),1000);}
function csv(rows){return rows.map(row=>row.map(v=>'"'+String(v??'').replaceAll('"','""')+'"').join(',')).join('\r\n')+'\r\n';}
function positionOrder(label){const m=label.match(/(\d+)(?:\.(\d+))?/);if(!m)return 0;return Number(m[1])+(m[2]?(Number(m[1])===112?-1:1)*Number(m[2])/1000:0);}
function parentRow(ref){const p=data.references[ref];return{key:'parent:'+ref,reference_id:ref,parent:true,name:ref+' 原始抗体',cdr:p.positions.filter(x=>x.region!=='framework').map(x=>({key:x.chain+':'+x.imgt_position,chain:x.chain,label:x.imgt_position,region:x.chain+x.region.slice(-1),index:x.sequence_index,aa:p.parents[x.chain][x.sequence_index-1],parent:p.parents[x.chain][x.sequence_index-1]}))};}
export function cdrIdentity(a,b,region='all'){
 const aa=new Map(a.cdr.filter(c=>region==='all'||c.region===region).map(c=>[c.key,c.aa])),bb=new Map(b.cdr.filter(c=>region==='all'||c.region===region).map(c=>[c.key,c.aa]));
 const keys=new Set([...aa.keys(),...bb.keys()]);let same=0;for(const key of keys)if(aa.has(key)&&bb.has(key)&&aa.get(key)===bb.get(key))same++;
 return {same,total:keys.size,percent:keys.size?100*same/keys.size:null};
}

function pdbString(atoms){return atoms.map((a,i)=>'ATOM  '+String((i+1)%100000).padStart(5)+' '+String(a.atom||'CA').padStart(4)+' '+String(a.resn||'UNK').padStart(3)+' '+String(a.chain||'A').slice(0,1)+String(a.resi).padStart(4)+String(a.icode||' ').slice(0,1)+'   '+[a.x,a.y,a.z].map(v=>Number(v).toFixed(3).padStart(8)).join('')+'  1.00  0.00          '+String(a.elem||'C').padStart(2)+'  ').join('\n')+'\nEND\n';}

export function CandidateWorkbench({selectedKeys,onSelectionChange,initialReference='6VJA'}){
 const {snapshot}=useProjectReport();const rows=snapshot.queries.candidateComparison?.rows||[];
 const [refFilter,setRefFilter]=useState(initialReference),[routeFilter,setRouteFilter]=useState('all'),[search,setSearch]=useState('');
 const [predictor,setPredictor]=useState('alphafold3'),[anchor,setAnchor]=useState(initialReference),[mode,setMode]=useState('core');
 const [showTarget,setShowTarget]=useState(true),[showParent,setShowParent]=useState(false),[allTargets,setAllTargets]=useState(false),[onlyCdr,setOnlyCdr]=useState(false),[fade,setFade]=useState(false),[opacity,setOpacity]=useState(1),[spin,setSpin]=useState(false);
 const [hidden,setHidden]=useState(new Set()),[busy,setBusy]=useState(false),[error,setError]=useState(''),[progress,setProgress]=useState(''),[picked,setPicked]=useState('');
 const [sequenceScope,setSequenceScope]=useState('selected'),[region,setRegion]=useState('all'),[includeParents,setIncludeParents]=useState(true);
 const host=useRef(null),viewer=useRef(null),molecules=useRef({}),home=useRef(null),request=useRef(0),settings=useRef({});
 const selected=selectedKeys.map(k=>byKey.get(k)).filter(Boolean);
 const selectedSet=new Set(selectedKeys);
 const listed=data.entries.filter(e=>e.has_structure&&(refFilter==='all'||e.reference_id===refFilter)&&(routeFilter==='all'||e.route===routeFilter)&&(!search||(label(e)+' '+e.candidate_id+' '+e.family).toLowerCase().includes(search.toLowerCase())));
 const sequenceEntries=sequenceScope==='selected'?selected:data.entries.filter(e=>(refFilter==='all'||e.reference_id===refFilter)&&(sequenceScope!=='retained'||e.has_structure)&&(routeFilter==='all'||e.route===routeFilter));
 const refs=[...new Set(sequenceEntries.map(e=>e.reference_id))];
 const seqRows=[...(includeParents?refs.map(parentRow):[]),...sequenceEntries];
 const columnMap=new Map();for(const entry of seqRows)for(const c of entry.cdr)if(region==='all'||c.region===region)columnMap.set(c.key,{...c});
 const columns=[...columnMap.values()].sort((a,b)=>regions.indexOf(a.region)-regions.indexOf(b.region)||positionOrder(a.label)-positionOrder(b.label));
 const identityRows=seqRows;
 const identities=useMemo(()=>{const pairs=[];for(let i=0;i<sequenceEntries.length;i++)for(let j=i+1;j<sequenceEntries.length;j++)pairs.push(cdrIdentity(sequenceEntries[i],sequenceEntries[j],region).percent);return pairs;},[sequenceScope,refFilter,routeFilter,region,selectedKeys.join('|')]);
 const reviewRows=entries=>rows.filter(r=>entries.some(e=>e.key===r.key));
 settings.current={showTarget,showParent,allTargets,onlyCdr,fade,opacity,hidden,mode,selected};
 function toggle(key){onSelectionChange(selectedSet.has(key)?selectedKeys.filter(k=>k!==key):[...selectedKeys,key]);}
 function paint(){
  if(!viewer.current)return;const s=settings.current;
  for(const [key,mol]of Object.entries(molecules.current)){
   mol.setStyle({},{});mol.show();
   if(key==='parent'){
    if(s.showTarget)mol.setStyle({chain:['A','B']},{cartoon:{color:'#8ba0b1',opacity:.5}});
    if(s.showParent)mol.setStyle({chain:['H','L']},{cartoon:{color:'#626a74',opacity:.55}});
    continue;
   }
   if(s.hidden.has(key)){mol.hide();continue;}
   const entry=byKey.get(key),color=colorFor(key),mask=data.references[entry.reference_id].cdr_indices;
   if(s.allTargets&&s.showTarget)mol.setStyle({chain:['A','B']},{cartoon:{color,opacity:.15}});
   if(!s.onlyCdr)mol.setStyle({chain:['H','L']},{cartoon:{color,opacity:s.fade?s.opacity*.35:s.opacity}});
   for(const ch of ['H','L'])mol.setStyle({chain:ch,resi:mask[ch]},{cartoon:{color,opacity:s.opacity}});
   mol.setClickable({chain:['H','L']},true,a=>setPicked(label(entry)+' · '+(a.chain==='H'?'VH':'VL')+' · '+a.resn+' · 序列第'+a.resi+'位'));
  }
  viewer.current.render();
 }
 function fit(){if(!viewer.current)return;const ids=Object.entries(molecules.current).filter(([k])=>k==='parent'?(settings.current.showTarget||settings.current.showParent):!settings.current.hidden.has(k)).map(([,m])=>m.getID());if(ids.length)viewer.current.zoomTo({model:ids,chain:settings.current.showTarget?['A','B','H','L']:['H','L']},0);viewer.current.render();}
 useEffect(()=>{
  if(!host.current)return;let cancelled=false;const token=++request.current;setBusy(true);setError('');setProgress('正在读取已有结构');setSpin(false);
  (async()=>{
   await loadLibrary();const parent=await loadDiagnosticReference(anchor);const needed=[...new Set(selected.map(e=>e.reference_id))];const groups=Object.fromEntries(await Promise.all(needed.map(async ref=>[ref,await getGroup(ref)])));
   if(cancelled||request.current!==token)return;
   const firstView=!viewer.current;
   if(!viewer.current)viewer.current=window.$3Dmol.createViewer(host.current,{backgroundColor:'#fff',antialias:true});
   viewer.current.spin(false);viewer.current.removeAllModels();viewer.current.removeAllLabels();molecules.current={};
   molecules.current.parent=viewer.current.addModel(parent.parents.parent_dog.pdb[predictor],'pdb');
   for(let i=0;i<selected.length;i++){
    if(cancelled||request.current!==token)return;
    const entry=selected[i],scene=groups[entry.reference_id].cases.find(c=>c.key===entry.key);if(!scene)throw new Error('未找到候选 '+entry.key);
    const mol=viewer.current.addModel(scene.pdb[predictor],'pdb');applyTransform(mol,data.transforms[anchor][entry.key][predictor][mode]);molecules.current[entry.key]=mol;
    if(i%5===0){setProgress(`正在叠加 ${i+1}/${selected.length} 条候选`);await new Promise(resolve=>setTimeout(resolve,0));}
   }
   if(cancelled||request.current!==token)return;paint();fit();if(firstView)viewer.current.rotate(65,'x');viewer.current.render();home.current=viewer.current.getView().slice();setBusy(false);setProgress('');
  })().catch(e=>{if(!cancelled){setError(e.message);setBusy(false);}});
  return()=>{cancelled=true;};
 },[selectedKeys.join('|'),predictor,anchor,mode]);
 useEffect(()=>{paint();fit();},[showTarget,showParent,allTargets,onlyCdr,fade,opacity,hidden]);
 useEffect(()=>{if(viewer.current)viewer.current.spin(spin?'y':false,.5,true);},[spin]);
 useEffect(()=>{const o=new ResizeObserver(()=>{if(viewer.current){viewer.current.resize();fit();}});if(host.current)o.observe(host.current);return()=>o.disconnect();},[]);
 useEffect(()=>()=>{request.current++;viewer.current?.spin(false);viewer.current?.clear();},[]);
 useEffect(()=>{window.researchCandidateComparison=()=>({selected:selectedKeys,model:predictor,anchor,mode,loading:busy,error,modelCount:Object.keys(molecules.current).length,sequenceRows:seqRows.length,sequenceScope,columns:columns.length,visible:selectedKeys.filter(k=>!hidden.has(k))});return()=>{delete window.researchCandidateComparison;};},[selectedKeys.join('|'),predictor,anchor,mode,busy,error,sequenceScope,seqRows.length,columns.length,hidden]);

 function exportPyMol(){
  if(!viewer.current||busy)return;
  const lines=['# Existing predictions, rigidly aligned for visual comparison.',`# Predictor: ${predictor}; seed: 42; alignment: ${mode}; anchor parent: ${anchor}`, 'from pymol import cmd','cmd.delete("cd20_compare_*")','cmd.bg_color("white")'];
  let n=0;
  for(const [key,mol]of Object.entries(molecules.current)){
   const entry=byKey.get(key),name=key==='parent'?'cd20_compare_parent':'cd20_compare_'+entry.reference_id+'_'+entry.route+'_'+entry.rank;if(key!=='parent')n++;lines.push('# '+name+': '+(entry?entry.candidate_id:anchor+' original antibody + dog CD20'));const atoms=mol.selectedAtoms({});lines.push('cmd.read_pdb('+JSON.stringify(pdbString(atoms))+', '+JSON.stringify(name)+')');
   const color=key==='parent'?'#626a74':colorFor(key);let rgb;
   if(color.startsWith('#'))rgb=[1,3,5].map(i=>parseInt(color.slice(i,i+2),16)/255);else{const canvas=document.createElement('canvas').getContext('2d');canvas.fillStyle=color;canvas.fillRect(0,0,1,1);rgb=[...canvas.getImageData(0,0,1,1).data].slice(0,3).map(v=>v/255);}
   lines.push(`cmd.set_color("comparison_color_${n}", ${JSON.stringify(rgb)})`,`cmd.color("comparison_color_${n}", "${name}")`,`cmd.hide("everything", "${name}")`);
   if(key==='parent'){if(showTarget)lines.push(`cmd.show("cartoon", "${name} and chain A+B")`);if(showParent)lines.push(`cmd.show("cartoon", "${name} and chain H+L")`);}
   else{if(onlyCdr){for(const ch of ['H','L'])lines.push(`cmd.show("cartoon", "${name} and chain ${ch} and resi ${data.references[entry.reference_id].cdr_indices[ch].join('+')}")`);}else lines.push(`cmd.show("cartoon", "${name} and chain H+L")`);if(allTargets&&showTarget)lines.push(`cmd.show("cartoon", "${name} and chain A+B")`);if(hidden.has(key))lines.push(`cmd.disable("${name}")`);}
  }
  lines.push('cmd.orient()');download('CD20_selected_candidate_overlay.py',lines.join('\n')+'\n');
 }
 const flatMatrix=identityRows.flatMap(a=>identityRows.map(b=>({a:a.key,b:b.key,...cdrIdentity(a,b,region)})));
 return <div className="candidate-workbench">
  <RichNarrative id="candidate-workbench:intro" className="research-section-description" value="自由勾选保留候选：可混合RFD4与BoltzGen，也可跨参考组合。结构窗口固定一个预测器和种子42，颜色代表不同候选。下方同步比较六段CDR的序列差异。"/>
  <div className="cw-controls"><label>筛选候选列表<select aria-label="叠加候选参考筛选"value={refFilter}onChange={e=>setRefFilter(e.target.value)}><option value="all">全部7个参考</option>{Object.keys(data.references).map(ref=><option key={ref}value={ref}>{ref} · {data.references[ref].family}</option>)}</select></label><label>生成路线<select aria-label="叠加候选路线筛选"value={routeFilter}onChange={e=>setRouteFilter(e.target.value)}><option value="all">RFD4与BoltzGen</option><option value="rfd4">RFD4</option><option value="boltzgen">BoltzGen</option></select></label><label>搜索<input aria-label="搜索叠加候选"value={search}onChange={e=>setSearch(e.target.value)}placeholder="参考、路线或候选ID"/></label></div>
  <div className="cw-selection-toolbar"><strong>已选 {selected.length} / 70 条</strong><button type="button"onClick={()=>onSelectionChange([...new Set([...selectedKeys,...listed.map(e=>e.key)])])}>加入当前列表全部</button><button type="button"onClick={()=>onSelectionChange(data.palette_keys.slice())}>全选70条</button><button type="button"onClick={()=>onSelectionChange([])}>清空</button></div>
  <div className="cw-candidate-list"aria-label="自由组合候选">{listed.map(e=><label key={e.key}><input type="checkbox"aria-label={'叠加 '+label(e)}checked={selectedSet.has(e.key)}onChange={()=>toggle(e.key)}/><i style={{background:colorFor(e.key)}}/><span>{label(e)}</span></label>)}</div>
  <DataComponent id="multi-candidate-overlay"title="多候选结构叠加"queryId="candidateComparison"queryIds={['candidateComparison','generationProtocol']}kind="custom"displayRows={selected}sourceRowsByQuery={{candidateComparison:reviewRows(selected),generationProtocol:(snapshot.queries.generationProtocol?.rows||[]).filter(r=>r.reference_id===anchor)}}>
   <div className="cw-controls"><label>预测器<select aria-label="多候选叠加预测器"value={predictor}onChange={e=>setPredictor(e.target.value)}>{Object.entries(models).map(([key,name])=><option key={key}value={key}>{name} · 种子42</option>)}</select></label><label>叠合方式<select aria-label="多候选叠合方式"value={mode}onChange={e=>{setMode(e.target.value);setShowTarget(e.target.value==='core');}}><option value="core">CD20核心叠合 · 看结合姿态</option><option value="framework">框架叠合 · 看CDR形状</option></select></label><label>坐标对齐对象<select aria-label="多候选对齐亲本"value={anchor}onChange={e=>setAnchor(e.target.value)}>{Object.keys(data.references).map(ref=><option key={ref}value={ref}>{ref} 原始抗体＋犬CD20</option>)}</select></label></div>
   <div className="cw-stage"><div ref={host}className="cw-canvas"aria-label="多条候选抗体同时叠加的三维结构"tabIndex={0}/>{(busy||error)&&<div className="cw-status"role={error?'alert':'status'}>{error||progress}</div>}<button className="cw-reset"type="button"aria-label="重置多候选视角"onClick={()=>{setSpin(false);if(viewer.current&&home.current){viewer.current.setView(home.current);viewer.current.render();}}}>↺</button></div>
   <div className="cw-view-controls"><label><input type="checkbox"checked={showTarget}onChange={e=>setShowTarget(e.target.checked)}/>CD20</label><label><input type="checkbox"checked={showParent}onChange={e=>setShowParent(e.target.checked)}/>原始抗体</label><label><input type="checkbox"checked={allTargets}onChange={e=>setAllTargets(e.target.checked)}/>各候选靶点</label><label><input type="checkbox"checked={onlyCdr}onChange={e=>setOnlyCdr(e.target.checked)}/>只看CDR</label><label><input type="checkbox"checked={fade}onChange={e=>setFade(e.target.checked)}/>框架淡化</label><label><input type="checkbox"checked={spin}onChange={e=>setSpin(e.target.checked)}/>旋转</label><label>透明度<input aria-label="候选显示不透明度"type="range"min="0.1"max="1"step="0.05"value={opacity}onChange={e=>setOpacity(Number(e.target.value))}/></label><button type="button"disabled={busy}onClick={()=>{const a=document.createElement('a');if(viewer.current){a.href=viewer.current.pngURI();a.download='CD20_candidate_overlay.png';a.click();}}}>保存PNG</button><button type="button"disabled={busy}onClick={exportPyMol}>下载PyMOL叠加脚本</button></div>
   <div className="cw-legend"aria-label="显示或隐藏候选">{selected.map(e=><button key={e.key}type="button"aria-pressed={!hidden.has(e.key)}onClick={()=>setHidden(old=>{const next=new Set(old);if(next.has(e.key))next.delete(e.key);else next.add(e.key);return next;})}><i style={{background:colorFor(e.key)}}/>{label(e)}</button>)}</div>
   <p className="cw-note">{picked||`颜色代表候选；点击图例可逐条显示或隐藏。对齐到${anchor}亲本仅用于统一坐标，不参与候选排名。`}</p>
  </DataComponent>
  <RichNarrative id="multi-candidate-overlay:method" className="cw-note" value="叠合方法：CD20模式将每条候选的犬CD20二聚体（330个Cα原子）刚体对齐到所选亲本的同一预测器结果，再看抗体相对位置；二聚体两种等价链对应中，采用Fv偏差较小的一种。框架模式联合拟合VH/VL共有的IMGT框架位置，CDR不参与拟合，用于观察环的形状差异。"/>
  <DataComponent id="multi-candidate-sequences"title="六段CDR序列对齐"queryId="candidateComparison"kind="custom"displayRows={sequenceEntries}sourceRows={reviewRows(sequenceEntries)}>
   <RichNarrative id="multi-candidate-sequences:heading" className="cw-subheading" value="### 六段CDR：替换了哪些氨基酸"/>
   <div className="cw-controls"><label>序列范围<select aria-label="CDR序列比较范围"value={sequenceScope}onChange={e=>setSequenceScope(e.target.value)}><option value="selected">结构窗口选中的候选</option><option value="retained">当前列表范围的保留候选</option><option value="all">当前参考与路线的全部生成候选</option></select></label><label>CDR区域<select aria-label="选择CDR区域"value={region}onChange={e=>setRegion(e.target.value)}><option value="all">六段CDR</option>{regions.map(r=><option key={r}value={r}>{regionNames[r]}</option>)}</select></label><label><input type="checkbox"checked={includeParents}onChange={e=>setIncludeParents(e.target.checked)}/>显示各自亲本</label><button type="button"onClick={()=>download('CDR_changes.csv',csv([['reference','candidate','chain','region','IMGT_position','sequence_index','parent','candidate_aa','changed'],...sequenceEntries.flatMap(e=>e.cdr.filter(c=>region==='all'||c.region===region).map(c=>[e.reference_id,e.candidate_id,c.chain,c.region,c.label,c.index,c.parent,c.aa,c.parent!==c.aa]))]),'text/csv')}>下载逐位点差异CSV</button><button type="button"onClick={()=>download('selected_candidates.fasta',sequenceEntries.map(e=>'>'+e.reference_id+'|'+e.candidate_id+'|VH\n'+e.heavy_sequence+'\n>'+e.reference_id+'|'+e.candidate_id+'|VL\n'+e.light_sequence).join('\n')+'\n')}>下载VH/VL FASTA</button></div>
   <div className="cw-sequence-summary"data-reviewed-rows>当前 {sequenceEntries.length} 条候选 · 替换数按各自亲本计算 · 候选间CDR一致性中位数 {fmt(median(identities))}%{identities.length>0?`（范围${fmt(Math.min(...identities))}—${fmt(Math.max(...identities))}%）`:''}</div>
   <div className="cw-sequence-scroll"><table className="cw-alignment"data-reviewed-rows><thead><tr><th className="cw-row-name">亲本 / 候选</th>{regions.filter(r=>columns.some(c=>c.region===r)).map(r=><th key={r}colSpan={columns.filter(c=>c.region===r).length}>{regionNames[r]}</th>)}</tr><tr><th className="cw-row-name">IMGT位置</th>{columns.map(c=><th key={c.key}title={c.label}>{c.label.slice(1)}</th>)}</tr></thead><tbody>{seqRows.map(e=>{const map=new Map(e.cdr.map(c=>[c.key,c]));return <tr key={e.key}><th className="cw-row-name">{e.parent?e.name:label(e)}{!e.parent&&<small>{e.mutation_count}位替换 · {e.has_structure?'保留候选':'初筛候选'}</small>}</th>{columns.map(c=>{const v=map.get(c.key),changed=v&&v.aa!==v.parent;return <td key={c.key}className={changed?'cw-changed':''}style={changed?{background:`color-mix(in srgb, ${colorFor(e.key)} 12%, transparent)`,borderBottomColor:colorFor(e.key)}:undefined}title={`${e.parent?e.name:label(e)} · ${c.label} · ${v?`${v.parent} → ${v.aa}；序列第${v.index}位`:'无对应残基'}`}>{v?.aa||'−'}</td>;})}</tr>;})}</tbody></table></div>
   <p className="cw-note">按生成时冻结的IMGT位置对齐；有色单元格表示相对各自亲本的替换，横线表示该标准位置没有残基。跨参考比较同时包含亲本差异。</p>
  </DataComponent>
  <DataComponent id="multi-candidate-identity"title="候选间CDR序列一致性"queryId="candidateComparison"kind="custom"displayRows={flatMatrix}sourceRows={reviewRows(sequenceEntries)}>
   <RichNarrative id="multi-candidate-identity:heading" className="cw-subheading" value="### 候选之间：CDR序列有多相似"/>
   <div className="cw-matrix-toolbar"><span>相同氨基酸数 ÷ 两序列至少一方有残基的CDR列数；只比较CDR，不用固定框架抬高一致性。</span><button type="button"onClick={()=>download('CDR_identity_matrix.csv',csv([['candidate',...identityRows.map(e=>e.parent?e.name:label(e))],...identityRows.map(a=>[a.parent?a.name:label(a),...identityRows.map(b=>fmt(cdrIdentity(a,b,region).percent))])]),'text/csv')}>下载一致性矩阵</button></div>
   <div className="cw-matrix-scroll"><table className="cw-matrix"data-reviewed-rows><thead><tr><th/><th colSpan={identityRows.length}>列号对应左侧行号；单元格为一致性%</th></tr><tr><th>亲本 / 候选</th>{identityRows.map((e,i)=><th key={e.key}title={e.parent?e.name:label(e)}>{i+1}</th>)}</tr></thead><tbody>{identityRows.map((a,i)=><tr key={a.key}><th>{i+1} · {a.parent?a.name:label(a)}</th>{identityRows.map(b=>{const value=cdrIdentity(a,b,region);return <td key={b.key}style={{background:`rgba(0,113,227,${.03+.35*(value.percent||0)/100})`}}title={`${a.parent?a.name:label(a)} ↔ ${b.parent?b.name:label(b)}：${value.same}/${value.total}`}>{fmt(value.percent)}</td>;})}</tr>)}</tbody></table></div>
  </DataComponent>
 </div>;
}
