import React, { useMemo, useState } from 'react';
import { DataComponent, DataTable, EvidenceChart as SourceChart, ReportSection, RichNarrative, useProjectReport } from '../../project-ui.jsx';
import { ComparisonContext, RmsdFormula } from './StudyWorkflow.jsx';
import { ChapterHeading } from './ChapterHeading.jsx';
import { DiagnosticViewer } from './DiagnosticViewer.jsx';
import './explainer.css';

const modelNames={alphafold3:'AF3',boltz2:'Boltz-2',esmfold2:'ESMFold2'};
const modelColors={AF3:'var(--chart-1)','Boltz-2':'var(--chart-2)',ESMFold2:'var(--chart-3)'};
const median=values=>{const a=values.filter(Number.isFinite).sort((a,b)=>a-b);return !a.length?null:a.length%2?a[(a.length-1)/2]:(a[a.length/2-1]+a[a.length/2])/2;};
const mean=values=>values.length?values.reduce((a,b)=>a+b,0)/values.length:null;
const quantile=(values,p)=>{const a=values.filter(Number.isFinite).sort((a,b)=>a-b);if(!a.length)return null;const x=(a.length-1)*p,i=Math.floor(x);return a[i]+(a[Math.min(i+1,a.length-1)]-a[i])*(x-i);};
const fmt=(value,d=1)=>Number.isFinite(value)?value.toFixed(d):'—';
const getRows=(snapshot,key)=>snapshot.queries[key]?.rows||[];

function EvidenceChart({description,comparison,children,...props}){
  return <div className="explain-chart-block">{comparison&&<ComparisonContext {...comparison}/>}<SourceChart {...props}>
    {description&&<RichNarrative id={props.id+':visible-caption'}value={description}className="research-caption"/>}
    {children}
  </SourceChart></div>;
}

function Intro({id,title,text}){
  return <ChapterHeading id={id} title={title} text={text} />;
}

export function ModelGuide(){
  const {snapshot}=useProjectReport(), rows=getRows(snapshot,'toolkit');
  const generators=rows.filter(r=>['rfd4','boltzgen'].includes(r.id)), predictors=rows.filter(r=>['alphafold3','boltz2','esmfold2'].includes(r.id));
  const mpnn=rows.find(r=>r.id==='solublempnn');
  const output={rfd4:'候选VH/VL序列与条件生成构象；本轮运行quickstart。',boltzgen:'设计结构及逆折叠后的最终序列；本轮运行design和inverse_folding。',alphafold3:'四链原子坐标与结构置信分数，用于界面、姿态和接触比较。',boltz2:'四链坐标与链对置信信息；本轮使用结构输出和界面分数。',esmfold2:'standard权重的四链坐标与置信信息，作为第三套固定序列预测。'};
  const card=row=><div key={row.id} className="explain-model-card" data-model={row.id}><span className="explain-stage-label">{row.stage}</span><h3>{row.name}</h3><dl><dt>能做什么</dt><dd>{row.capability}</dd><dt>主要特点</dt><dd>{row.feature}</dd><dt>本轮怎么用</dt><dd>{row.project_role}</dd><dt>本轮输出</dt><dd>{output[row.id]}</dd></dl>
    {row.id==='boltzgen'&&<div className="mpnn-nested" data-model="solublempnn"><span>BoltzGen路线内部 · 逆折叠子步骤</span><h4>SolubleMPNN</h4><p>{mpnn.capability} 本轮为BoltzGen提出的CDR骨架选择最终序列，保留框架固定位置。</p><a href={mpnn.source} target="_blank" rel="noreferrer">ProteinMPNN 官方资料 ↗</a></div>}
    <div className="explain-model-footer"><span>本轮版本：{row.version}</span><RichNarrative id={row.id+':official-source'} value={`[官方资料 ↗](${row.source})`} sourcePreviews={{[row.source]:{title:row.name+' · 官方仓库',summary:row.capability,source:'Official model repository',approvedForReport:true}}}/></div></div>;
  return <section id="toolkit" className="research-chapter explain-chapter"><Intro id="toolkit-intro"  title="模型如何接入这条主线" text="生成器提出新的CDR与构象；预测器接收最终序列，重新给出结构。SolubleMPNN嵌在BoltzGen路线内部，负责从设计骨架选择序列。"/>
    <DataComponent id="model-capabilities" title="模型能力与本轮调用范围" queryId="toolkit" kind="custom" displayRows={rows} sourceRows={rows}><div data-reviewed-rows><h3 className="explain-model-group-label">生成阶段 · 两条路线</h3><div className="explain-model-grid">{generators.map(card)}</div><h3 className="explain-model-group-label">固定序列复预测 · 三套模型</h3><div className="explain-model-grid predictor-model-grid">{predictors.map(card)}</div></div></DataComponent>
    <ReportSection id="rfd4-folding-explanation" title="设计构象与复预测的分工" queryId="toolkit" sourceRows={rows} showHeading={false}><RichNarrative id="rfd4-folding-explanation:body" className="explain-prose" value="### 为什么生成了结构，还要重新预测？\n\n生成阶段接收靶点、框架几何和结合区域，回答‘在这些条件下，能提出哪些序列和构象’。复预测阶段接收最终序列，回答‘换一个模型，这条序列会形成什么结构’。比较两者，可以检查设计提出的姿态是否在另一套结构模型中保留。\n\n本轮RFD4用于条件设计，BoltzGen运行生成与逆折叠；统一复预测由AF3、Boltz-2和ESMFold2 standard承担。所有模型使用预训练权重。"/></ReportSection>
  </section>;
}

export function GeneratorComparison(){
  const {snapshot}=useProjectReport();
  const generationRows=getRows(snapshot,'generatorComparison');
  const generationPlot=Object.entries(modelNames).flatMap(([model,name])=>['rfd4','boltzgen'].map(route=>{const group=generationRows.filter(r=>r.model===model&&r.route===route);return {model:name,route:route==='rfd4'?'RFD4设计':'BoltzGen设计',value:median(group.map(r=>r.fv_pose_ca_rmsd_A)),pairs:group.length};}));
  return <section id="generation-verification" className="research-chapter explain-chapter">
    <Intro id="generation-verification-intro" title="生成构象的复预测检查"text="对每条候选，把生成时的复合物坐标与最终序列重新预测得到的坐标配对，检查设计姿态是否得到保留。"/>
    <EvidenceChart id="generator-reprediction-chart"queryId="generatorComparison"title="同一候选：生成器设计构象 ↔ 三模型复预测" comparison={{left:'RFD4或BoltzGen输出的该候选设计构象',right:'同一候选最终序列的AF3 / Boltz-2 / ESMFold2预测（种子42）',fit:'两份复合物的CD20核心Cα；只求一组刚体旋转和平移',measure:'保持上述变换，计算对应Fv Cα的RMSD；每柱汇总70对',use:'生成时提出的结合姿态，在另一模型重新预测后保留了多少'}}rows={generationPlot}sourceRows={generationRows}height={330}variant="card"
      spec={{type:'bar',x:'model',y:'value',series:'route',startAtZero:true,valueDecimals:2,yLabel:'对设计构象的Fv姿态RMSD / Å',stackable:false,colors:{RFD4设计:'var(--chart-1)',BoltzGen设计:'var(--chart-2)'}}}
      description="每种颜色代表一条生成路线，每个横轴类别代表接收最终序列的预测器。每柱取7参考×10条候选的70个RMSD中位数，共6柱、420组配对。数值越小，表示该预测器越接近生成器提出的Fv姿态。"/>
  </section>;
}

export function TargetGuide({mode='all',referenceId,onReferenceChange}){
  const {snapshot}=useProjectReport(),[localReference,setLocalReference]=useState('6VJA'),[profileKind,setProfileKind]=useState('parent_dog'),[hover,setHover]=useState(null);
  const reference=referenceId||localReference;
  const setReference=onReferenceChange||setLocalReference;
  const sequence=getRows(snapshot,'targetSequence'), identity=getRows(snapshot,'sequenceIdentity'), topology=snapshot.explanation.topology;
  const inventory=getRows(snapshot,'inventory'),native=getRows(snapshot,'diagnosticScenes').find(r=>r.reference_id===reference);
  const parentRows=getRows(snapshot,'humanDiagnostics').filter(r=>r.reference_id===reference&&r.kind.startsWith('parent_'));
  const targetComparison=Object.entries(modelNames).flatMap(([model,name])=>['parent_human','parent_dog'].map(kind=>({model:name,species:kind==='parent_human'?'人源亲本':'犬靶点亲本',value:median(parentRows.filter(r=>r.model===model&&r.kind===kind).map(r=>r.human_reference_antigen_fit_A)),samples:3})));
  const profileSource=getRows(snapshot,'targetProfiles').filter(r=>r.reference_id===reference&&r.kind===profileKind);
  const profile=profileSource.map(r=>({...r,modelLabel:modelNames[r.model]}));
  const baselineSource=getRows(snapshot,'fullMonomer').filter(r=>r.reference_id===reference);
  const baseline=Object.entries(modelNames).flatMap(([model,name])=>[['full_to_afdb_A','全长对AFDB'],['core_to_afdb_A','核心对AFDB'],['core_to_human_experiment_A','核心对人源实验']].map(([key,metric])=>({model:name,metric,value:median(baselineSource.filter(r=>r.model===model).map(r=>r[key])),samples:5})));
  const footprint=getRows(snapshot,'experimentalFootprints').find(r=>r.reference_id===reference);
  const coreSequence=sequence.filter(r=>r.in_core);
  const identityPlot=identity.map(row=>({...row,shortLabel:{full:'Full',core:'Core',ecd:'ECD',tm:'TM'}[row.region]}));
  const roleName={tm:'跨膜区',ecd:'胞外区',cyto:'胞内区'};
  return <section id={mode==='results'?'target-diagnostics':'target-anatomy'}className="research-chapter explain-chapter">
    {mode!=='results'&&<>
    <Intro id="target-intro" title="人源实验参考与犬CD20靶点"text="CD20是靶蛋白；VH/VL属于识别它的抗体。本轮从人源实验复合物获得参考装配和抗体亲本，针对犬CD20提出候选。"/>
    <RichNarrative id="antibody-parts-definition"className="research-caption"value="VH、VL分别是抗体重链和轻链的可变区；每条含3段CDR，两条合计6段，框架区提供其余支撑。本轮开放这6段CDR进行设计，保留框架与链长；完整Fab另含常数区，完整IgG还具有Fc。"/>
    <div className="explain-source-columns">
      <RichNarrative id="human-source-intro"className="explain-prose"value="### 人源：P11836\n\nUniProt条目对应人CD20。6VJA等PDB条目是其与已有抗体的**实验复合物结构**，提供已观察到的CD20与抗体空间关系。不同条目的可见残基、Fab数目和构建体覆盖并不完全相同。"/>
      <RichNarrative id="dog-source-intro"className="explain-prose"value="### 犬源：Q3C2E2\n\n本轮设计靶点，297个氨基酸。初始单体几何来自**AlphaFold DB v6预测**，二聚体装配和起始抗体位置分别参考人源复合物转移。"/>
    </div>
    <DataComponent id="target-topology"title="犬CD20的序列区域与设计范围"queryId="targetSequence"kind="custom"sourceRows={sequence}displayRows={topology}>
      <div className="explain-topology"data-reviewed-rows>
        <svg viewBox="0 0 1000 90"role="img"aria-label="犬CD20的297个序列位置，标出胞内、跨膜和胞外区及46至210设计核心">
          {topology.map((r,i)=><g key={i}tabIndex={0}onPointerEnter={()=>setHover(r)}onFocus={()=>setHover(r)}aria-label={`${roleName[r.role]} ${r.start}至${r.end}位`}>
            <rect x={(r.start-1)/297*1000}y="16"width={r.length/297*1000}height="28"fill={{tm:'#0071e3',ecd:'#cf6525',cyto:'#b6bdc5'}[r.role]}/>
          </g>)}
          <path d={`M ${45/297*1000} 59 v 8 H ${210/297*1000} v -8`}fill="none"stroke="currentColor"strokeWidth="2"/>
          <text x={127.5/297*1000}y="85"textAnchor="middle"fill="currentColor"fontSize="15">靶点建模核心：46—210位 · 165 aa</text>
        </svg>
        <div className="explain-topology-legend"><span><i style={{background:'#b6bdc5'}}/>胞内</span><span><i style={{background:'#0071e3'}}/>跨膜</span><span><i style={{background:'#cf6525'}}/>胞外</span></div>
        <p>{hover?`${roleName[hover.role]}：${hover.start}—${hover.end}位，${hover.length} aa。`:'点击或聚焦色块查看范围。胞外位点仅为73—75和144—188，可设计的抗体CDR应朝向胞外区域。'}</p>
      </div>
    </DataComponent>
    <RichNarrative id="topology-evidence-limit"className="research-caption"value="区域采用本轮冻结的UniProt膜拓扑标注。46—210位覆盖人源参考中可见的靶点核心，包含跨膜骨架和胞外识别区域。"/>
    <div className="research-reference-filter"><label>人源实验参考<select aria-label="选择解释页实验参考"value={reference}onChange={e=>setReference(e.target.value)}>{inventory.map(r=><option key={r.id}value={r.id}>{r.id} · {r.family}</option>)}</select></label></div>
    <DataComponent id="reference-structure-lab"title={reference+' · 实验参考、犬靶点与亲本预测'}queryId="diagnosticScenes"kind="custom"displayRows={native?[native]:[]}sourceRows={getRows(snapshot,'diagnosticScenes').filter(r=>r.reference_id===reference)}>
      <DiagnosticViewer referenceId={reference}purpose="target"/>
    </DataComponent>
    <RichNarrative id="native-structure-scope"className="research-caption"value={`${reference}原始条目含${native?.protein_residues??'—'}个已解析蛋白残基、${native?.atom_count??'—'}个原子，对应的CD20观测核心共${native?.observed_core_ca??'—'}个Cα。原始装配模式展示实际可见的完整上下文；亲本/候选叠合则限制为两个CD20核心和一对VH/VL。完整Fab的常数区、额外Fab和Fc没有混入四链预测指标。`}/>
    <RichNarrative id="parent-control-definition"className="research-caption"value="“人源亲本”和“犬靶点亲本”使用同一参考的原始抗体VH/VL，CDR都未修改；两组只更换CD20靶点的物种。“犬”修饰的是靶点物种；抗体仍为该参考的原始VH/VL。"/>
    </>}
    {mode!=='intro'&&<>
    {mode==='results'&&<>
      <Intro id="target-results-intro" title="序列、CD20形状与全长单体的分别比较"text="使用同一人源实验参考，比较人犬序列、亲本预测中的CD20，以及已有全长犬CD20单体样本。"/>
      <div className="research-reference-filter"><label>靶点对照参考<select aria-label="选择靶点对照参考"value={reference}onChange={e=>setReference(e.target.value)}>{inventory.map(r=><option key={r.id}value={r.id}>{r.id} · {r.family}</option>)}</select></label></div>
    </>}
    <EvidenceChart id="target-sequence-identity"queryId="sequenceIdentity"title="人源与犬源CD20的序列一致性"rows={identityPlot}sourceRows={identity}height={300}variant="card"
      spec={{type:'horizontalBar',x:'shortLabel',y:'identity_percent',startAtZero:true,valueDecimals:1,xLabel:'氨基酸一致性 / %',stackable:false}}
      description="全长两物种均为297 aa；全局比对有298列，包含胞内尾部的两列gap。设计核心没有比对缺口。Full/Core/ECD/TM分别对应全长、建模核心、胞外区、跨膜区。">
      <DataTable rows={identity}searchable={false}columns={[{field:'region',label:'图中简称',renderCell:v=>({full:'Full',core:'Core',ecd:'ECD',tm:'TM'}[v])},{field:'label',label:'区域'},{field:'matched',label:'相同残基数'},{field:'positions',label:'比对位置数'},{field:'identity_percent',label:'一致性',renderCell:v=>fmt(v,1)+'%'}]}/>
    </EvidenceChart>
    <DataComponent id="sequence-comparison"title="设计核心的逐位点序列对应"queryId="targetSequence"kind="custom"displayRows={coreSequence}sourceRows={sequence}>
      <details className="research-disclosure"><summary>查看46—210位人犬序列差异与人源接触位点</summary>
        <div className="explain-sequence-grid"data-reviewed-rows>{coreSequence.map(r=><div key={r.alignment_column}className={`${r.match?'':'is-mismatch'} ${footprint?.positions.includes(r.position)?'is-reference-contact':''}`}tabIndex={0}title={`犬${r.position} / 人${r.human_position}：${r.human}→${r.dog}${footprint?.positions.includes(r.position)?'；该人源参考存在CDR接触':''}`}>
          <span>{r.position}</span><b>{r.human}</b><b>{r.dog}</b>
        </div>)}</div>
        <RichNarrative id="sequence-grid-key"value="每格依次为犬序列位置、人源残基、犬源残基；浅橙色标记替换，紫色下划线标记当前人源实验参考的CDR接触位点。接触按一对Fv与两个CD20核心的重原子距离<4.5 Å定义。"className="research-caption"/>
      </details>
    </DataComponent>
    <EvidenceChart id="human-dog-reference-chart"queryId="humanDiagnostics"title={reference+' · 人/犬亲本预测的CD20 ↔ 人源实验CD20'} comparison={{left:'三模型重新预测的亲本复合物；分别使用人CD20和犬CD20',right:reference+'实验复合物中已解析的两条人CD20核心',fit:'按序列对应匹配CD20 Cα；共同拟合两个亚基，检查AB/BA等价对应',measure:'叠合后的CD20核心Cα RMSD；每模型、每物种取3种子中位数',use:'同物种预测恢复程度，以及换成犬靶点后与人源参考的形状和装配差异'}}rows={targetComparison}sourceRows={parentRows}height={330}variant="card"
      spec={{type:'bar',x:'model',y:'value',series:'species',startAtZero:true,valueDecimals:2,yLabel:'CD20核心Cα RMSD / Å',stackable:false,colors:{人源亲本:'var(--chart-1)',犬靶点亲本:'var(--chart-2)'}}}
      description="6VJA等条目已给出实验复合物；这里重新输入原始抗体序列与人或犬CD20序列，得到亲本预测。柱图只衡量其中的CD20，抗体不参与此项RMSD拟合或计分。"/>
    <div className="research-reference-filter"><label>左侧预测对象（右侧固定为人源实验CD20）<select aria-label="选择CD20残基比较对象"value={profileKind}onChange={e=>setProfileKind(e.target.value)}><option value="parent_dog">犬靶点亲本 · 跨物种结构对照</option><option value="parent_human">人源亲本 · 同物种结构对照</option></select></label></div>
    <EvidenceChart id="target-residue-profile"queryId="targetProfiles"title={reference+' · '+(profileKind==='parent_dog'?'犬亲本预测':'人源亲本预测')+' ↔ 人源实验CD20：逐位点偏差'} comparison={{left:(profileKind==='parent_dog'?'犬':'人源')+'CD20＋未修改CDR的参考抗体，经三模型预测（种子42）',right:reference+'中两条人CD20的对应实验坐标',fit:'先对两个CD20核心整体拟合；逐位置沿用同一变换',measure:'每位置对应Cα的欧氏距离，再对两个亚基取平均，单位Å',use:'定位整体结构差异主要集中在哪些跨膜或胞外位置'}}rows={profile}sourceRows={profileSource}height={340}variant="card"
      spec={{type:'line',x:'position',y:'mean_ca_residual_A',series:'modelLabel',startAtZero:true,valueDecimals:2,xLabel:'对应CD20序列位置',yLabel:'核心叠合后的Cα偏差 / Å',stackable:false,colors:modelColors}}
      description="每条线代表一个预测器。纵轴是“预测坐标到实验坐标”的逐位点平均距离，不是pLDDT或氨基酸固有分数。每个位置不再独立重新叠合；可结合上方膜拓扑查看偏差位于哪个区域。"/>
    <EvidenceChart id="full-length-baseline-chart"queryId="fullMonomer"title="全长犬CD20单体：分别对照犬AFDB与人源实验" comparison={{left:'三模型分别生成的全长犬CD20单体，每模型5份',right:'犬AFDB预测单体；或当前人源实验参考的第一CD20亚基',fit:'全长对AFDB用297位；核心对照用可匹配的46—210位；各自独立拟合',measure:'指定区域Cα RMSD的5份样本中位数',use:'区分尾部差异、核心形状差异，以及与人源可见核心的接近程度'}}rows={baseline}sourceRows={baselineSource}height={340}variant="card"
      spec={{type:'bar',x:'model',y:'value',series:'metric',startAtZero:true,valueDecimals:2,yLabel:'分别最优叠合后的Cα RMSD / Å',stackable:false,colors:{全长对AFDB:'var(--chart-1)',核心对AFDB:'var(--chart-2)',核心对人源实验:'var(--chart-3)'}}}
      description={`每柱为5份已有单体预测的中位数。AF3/ESMFold2为种子42—46；Boltz-2为种子42的5份扩散样本。人源比较取${reference}第一亚基的已解析核心；全长与核心分别拟合，因此对应不同的比较区域。`}/>
    </>}
  </section>;
}

export function ComparisonGuide(){
  const {snapshot}=useProjectReport(),[pattern,setPattern]=useState('cross-model'),[pairIndex,setPairIndex]=useState(0);
  const models=Object.keys(modelNames), seeds=[42,43,44];
  const pairs=pattern==='cross-model'?seeds.flatMap(seed=>[[0,1],[0,2],[1,2]].map(([a,b])=>[`${models[a]}:${seed}`,`${models[b]}:${seed}`])):
    models.flatMap(model=>[[42,43],[42,44],[43,44]].map(([a,b])=>[`${model}:${a}`,`${model}:${b}`]));
  const active=pairs[pairIndex%pairs.length], label=key=>{const[m,s]=key.split(':');return modelNames[m]+' · 种子'+s;};
  return <section id="comparison-methods"className="research-chapter explain-chapter">
    <Intro id="comparison-methods-intro" title="比较对象、配对数量与RMSD定义"text="先确定序列、模型、种子和拟合对象，再解释一个RMSD。下列比较都使用实际预测坐标；旋转网页相机不会改变数值。"/>
    <RichNarrative id="rmsd-relative-definition" className="metric-primer" value="**RMSD是两个结构之间的比较值。** 一个蛋白结构本身没有唯一的RMSD：必须指定比较对象、对应原子，以及叠合时用哪些原子。同一份预测对不同参考、或改用不同叠合区域，会得到不同数值。逐位点偏差也需要另一份结构作参照；只有模型置信分数等指标可以随单次预测直接输出。"/>
    <ReportSection id="comparison-population"title="预测与比较的数量关系"queryId="predictions"queryIds={['predictions','robustness','selected']}sourceRowsByQuery={{predictions:getRows(snapshot,'predictions'),robustness:getRows(snapshot,'robustness'),selected:getRows(snapshot,'selected')}}showHeading={false}>
      <RichNarrative id="comparison-population:body"className="explain-prose"value="**初筛：140条候选 × 3个预测器 = 420份候选结构。** 每条候选固定种子42，比较AF3↔Boltz-2、AF3↔ESMFold2、Boltz-2↔ESMFold2，共3组两两比较；因此是**420组候选姿态比较**。每条候选先取3组RMSD的中位数，再汇总140条候选，是原页面的候选级口径。\n\n**追加采样：70条保留候选，每条3模型 × 3种子 = 9份结构。** 同模型跨种子有3×C(3,2)=9组，同种子跨模型也有3×C(3,2)=9组。两类各630组；没有把同时更换模型和种子的另外18组混在一起。\n\n**对照：7个参考 × 人/犬两种亲本 × 3模型 × 3种子 = 126份结构。** 候选初筛420份＋候选追加420份＋亲本126份，共966份规范预测；生成器的140份设计构象另列，不计入966份复预测。三模型的输出、亲本对照和候选比较不是同一个分母。"/>
    </ReportSection>
    <DataComponent id="comparison-pairing-map"title="一条保留候选的9份预测如何配对"queryId="robustness"kind="custom"sourceRows={getRows(snapshot,'robustness')}displayRows={snapshot.explanation.pairCounts?[snapshot.explanation.pairCounts]:[]}>
      <div className="explain-pairing"data-reviewed-rows>
        <div className="explain-pill-row"><button type="button"aria-pressed={pattern==='cross-model'}onClick={()=>{setPattern('cross-model');setPairIndex(0);}}>固定种子，换模型 · 9组</button><button type="button"aria-pressed={pattern==='cross-seed'}onClick={()=>{setPattern('cross-seed');setPairIndex(0);}}>固定模型，换种子 · 9组</button></div>
        <div className="explain-pairing-grid"><span/><b>种子42</b><b>种子43</b><b>种子44</b>{models.map(model=><React.Fragment key={model}><b>{modelNames[model]}</b>{seeds.map(seed=>{const id=model+':'+seed;return <div key={seed}className={active.includes(id)?'is-active':''}>{modelNames[model]}<small>seed {seed}</small></div>;})}</React.Fragment>)}</div>
        <div className="explain-pair-selector">{pairs.map((pair,i)=><button type="button"key={i}aria-pressed={pairIndex%9===i}onClick={()=>setPairIndex(i)}>第{i+1}组</button>)}</div>
        <p className="explain-pair-label">当前比较：{label(active[0])} ↔ {label(active[1])}</p>
      </div>
    </DataComponent>
    <ReportSection id="pose-metric-recipe"title="抗原叠合后的Fv姿态RMSD"queryId="poseDiagnostics"sourceRows={getRows(snapshot,'poseDiagnostics').filter(r=>r.primary_screen_pair)}showHeading={false}>
      <RichNarrative id="pose-metric-recipe:body"className="explain-prose"value="### 一组姿态RMSD怎么计算\n\n1. 取两份预测的两个CD20核心Cα坐标，建立同位点对应关系；完整核心是2×165=330个Cα。\n2. 只用CD20求最优刚体旋转和平移（Kabsch拟合），让这两个靶点尽可能叠合。\n3. 将**同一旋转和平移**应用到抗体VH/VL；不再单独移动抗体。\n4. 对两份Fv的对应Cα计算RMSD，得到相对CD20坐标框架的Fv差异。单位为Å，数值越小表示这两份预测越接近。\n\n若先单独叠合Fv，则测量抗体自身形状差异。选择叠合区域，就是选择这个RMSD要回答的问题。"/>
      <RmsdFormula />
      <details className="research-disclosure"><summary>同源二聚体的A/B链如何对应</summary><RichNarrative id="symmetry-method"value="两个CD20亚基序列相同，A/B标签本身不具有生物学方向。原姿态指标分别对AB与BA两种对应做抗原拟合，再选择Fv偏差较小的等价摆放，并保留其抗原拟合误差。这不是再拟合Fv。\n\n新增的跨膜区/胞外区敏感性检查固定原核心拟合所选的亚基对应，只更换拟合残基集合。新增“CD20对人源参考”指标则按抗原自身RMSD选择对应，避免由抗体位置决定靶点形状对照。两种口径在来源中分别记录。"/></details>
    </ReportSection>
    <RichNarrative id="consistency-dimensions"className="explain-prose"value="### 汇报里的“一致性”需要说明是哪一种\n\n- **序列一致性：** 人、犬CD20有多少氨基酸相同；比较序列，不比较坐标。\n- **CD20结构差异：** 单体各自拟合看内部形状，二聚体共同拟合还受到亚基装配的影响。\n- **Fv形状差异：** 同一候选的Fv单独叠合，看抗体本身是否被预测成相似形状。\n- **相对姿态差异：** 只叠合CD20，再看抗体的位置和方向是否相似。\n- **接触足迹重合：** 比较CDR接触了哪些胞外CD20位点，不要求两个复合物所有坐标都相同。\n- **模型内部置信度：** ipTM等分数表达各模型自身的结构判断，不能代替前面的坐标比较，也不是实测亲和力。"/>
    <RichNarrative id="sampling-parameter-definition"className="research-caption"value="采样规模由本项目设置：每参考每路线生成10对，保留5对追加采样。各预测器接收相同序列与样本数，采用各自的推理设置。"/>
    <ReportSection id="interface-metric-definition"title="界面分数、接触和冲突的计算口径"queryId="predictions"sourceRows={getRows(snapshot,'predictions')}showHeading={false}>
      <RichNarrative id="interface-metric-definition:body"className="explain-prose"value="### 界面分数与几何检查如何使用\n\n本轮界面ipTM取A/B两条CD20与H/L两条抗体之间的8个有方向链对分数的平均：A→H、A→L、B→H、B→L，以及4个反方向。只汇总靶点与抗体之间的链对，CD20–CD20和VH–VL内部链对另行处理。\n\n不同模型的分数不保证同一校准；筛选时在每个参考、每个模型的20条候选内部转为百分位，再汇总三模型。胞外CDR重原子距离<4.5 Å表示接触支持，<1.5 Å的严重近接对作为几何警示；接触用于筛选界面支持，严重近接用于定位局部几何问题。"/>
    </ReportSection>
  </section>;
}

export function StructuralDiagnostics({sceneKey,onSceneChange}){
  const {snapshot}=useProjectReport(),[scope,setScope]=useState('all');
  const all=getRows(snapshot,'poseDiagnostics'), raw=all.filter(r=>r.kind==='designed_variant'&&r.primary_screen_pair&&(scope==='all'||r.reference_id===scope));
  const summary=getRows(snapshot,'poseSummary').filter(r=>scope==='all'||r.reference_id===scope);
  const index=getRows(snapshot,'structures'),current=index.find(r=>r.key===sceneKey)||index[0];
  const footReference=current?.reference_id||'6VJA';
  const setFootReference=id=>{const first=index.find(row=>row.reference_id===id);if(first)onSceneChange(first.key);};
  const scatter=raw.map(r=>({...r,pairLabel:modelNames[r.model_a]+' ↔ '+modelNames[r.model_b],name:r.reference_id+' · '+r.candidate_id}));
  const anchor=[['fv_pose_ca_rmsd_A','CD20核心拟合'],['tm_anchored_fv_rmsd_A','跨膜区拟合'],['ecd_anchored_fv_rmsd_A','胞外区拟合'],['fv_self_fit_ca_rmsd_A','Fv自身拟合']].map(([key,region])=>({region,shortLabel:{CD20核心拟合:'Core',跨膜区拟合:'TM',胞外区拟合:'ECD',Fv自身拟合:'Fv'}[region],value:median(raw.map(r=>r[key]))}));
  const mse=['fv_translation_mse_A2','fv_orientation_mse_A2','fv_shape_mse_A2'].map(key=>mean(raw.map(r=>r[key]))),total=mse.reduce((a,b)=>a+b,0);
  const decomposition=['质心平移项','方向变化项','最优拟合后形状项'].map((component,i)=>({component,shortLabel:['Shift','Orient.','Shape'][i],mse:mse[i],percent:100*mse[i]/total,pairs:raw.length}));
  const footprintSource=getRows(snapshot,'contactFootprints').filter(r=>r.reference_id===footReference&&(r.kind!=='designed_variant'||r.seed===42));
  const footPlot=Object.entries(modelNames).flatMap(([model,name])=>[['parent_human','人源亲本 · 3种子'],['parent_dog','犬亲本 · 3种子'],['designed_variant','候选 · 20条']].map(([kind,group])=>{const rows=footprintSource.filter(r=>r.model===model&&r.kind===kind);return {model:name,group,value:median(rows.map(r=>r.jaccard)),n:rows.length};}));
  const heatSource=getRows(snapshot,'contactHeatmap').filter(r=>r.reference_id===footReference),heat=heatSource.map(r=>({...r,modelLabel:modelNames[r.model]}));
  const targets=getRows(snapshot,'experimentalFootprints').filter(r=>r.reference_id===footReference);
  const cdrRows=getRows(snapshot,'cdrDiagnostics').filter(r=>scope==='all'||r.reference_id===scope);
  const localShape=[['fv_self_fit_A','整体Fv自身拟合'],['framework_self_fit_A','框架自身拟合'],['cdr_after_framework_fit_A','框架拟合后CDR位点']].map(([key,metric])=>({metric,shortLabel:{fv_self_fit_A:'Fv',framework_self_fit_A:'FR',cdr_after_framework_fit_A:'CDR'}[key],value:median(cdrRows.map(r=>r[key])),p95:quantile(cdrRows.map(r=>r[key]),.95),pairs:cdrRows.length}));
  const examples=index.filter(item=>scope==='all'||item.reference_id===scope).map(item=>({item,value:median(cdrRows.filter(r=>r.reference_id+'/'+r.candidate_id===item.key).map(r=>r.cdr_after_framework_fit_A))})).filter(row=>Number.isFinite(row.value)).sort((a,b)=>a.value-b.value);
  return <section id="structural-diagnostics"className="research-chapter explain-chapter">
    <Intro id="diagnostic-intro" title="靶点形变与抗体相对姿态的分开评估"text="先比较CD20和Fv各自的形状，再衡量抗体相对靶点的位置与方向，检查模型分歧主要体现在哪一层。"/>
    <ComparisonContext left="同一候选的AF3、Boltz-2或ESMFold2预测之一" right="该候选另一个模型的预测；三种模型共三种配对" fit="按各图要求，分别叠合CD20核心、跨膜区、胞外区、Fv或框架" measure="对应Cα的RMSD；范围筛选会同步更新图表与统计" use="把靶点形状、抗体形状和相对位置的分歧分开定位"/>
    <div className="research-reference-filter"><label>诊断统计范围<select aria-label="选择诊断统计参考"value={scope}onChange={e=>setScope(e.target.value)}><option value="all">全部7个参考</option>{getRows(snapshot,'inventory').map(r=><option key={r.id}value={r.id}>{r.id} · {r.family}</option>)}</select></label><span>当前{raw.length}组成对比较 · 种子42</span></div>
    <ReportSection id="diagnostic-findings"title="分解后的主要观察"queryId="poseDiagnostics"sourceRows={raw}showHeading={false}>
      <RichNarrative id="diagnostic-findings:body"className="explain-prose"value={`**Fv自身形状与相对姿态的差异不在同一量级。** 当前${raw.length}组成对比较中，Fv自身叠合后的RMSD中位数为${fmt(median(raw.map(r=>r.fv_self_fit_ca_rmsd_A)),2)} Å；CD20核心拟合后的Fv姿态差异为${fmt(median(raw.map(r=>r.fv_pose_ca_rmsd_A)))} Å。CD20二聚体本身的拟合RMSD中位数为${fmt(median(raw.map(r=>r.antigen_fit_ca_rmsd_A)))} Å，说明拟合的靶点并非相同刚体。\n\n**叠合基准会影响看到的抗体位置。** 将基准从整个核心改为胞外区后，Fv姿态RMSD的绝对变化中位数为${fmt(median(raw.map(r=>r.ecd_vs_core_pose_absolute_change_A)))} Å；同一组Fv坐标因基准变化产生的位移RMSD中位数为${fmt(median(raw.map(r=>r.ecd_frame_change_fv_rmsd_A)))} Å。这表明解释姿态差异时，应同时查看靶点形状和叠合基准。\n\n这些是**成对值直接汇总**的诊断口径；原页面先对每条候选取三对中位数，再跨候选汇总。两个汇总层级的中位数可以不同。`}/>
    </ReportSection>
    <EvidenceChart id="target-pose-scatter"queryId="poseDiagnostics"title="CD20自身差异与Fv相对姿态差异"rows={scatter}sourceRows={raw}height={400}variant="card"
      spec={{type:'scatter',x:'antigen_fit_ca_rmsd_A',y:'fv_pose_ca_rmsd_A',series:'pairLabel',label:'name',xLabel:'CD20核心拟合RMSD / Å',yLabel:'CD20拟合后Fv姿态RMSD / Å',startAtZero:true,valueDecimals:2,stackable:false}}
      description="每点比较同一候选的两套模型预测，三种模型共3种配对。横轴先单独拟合CD20、测其残余差异；纵轴沿用该变换测Fv差异，用于观察靶点与姿态分歧是否共同增大。"/>
    <EvidenceChart id="anchor-comparison"queryId="poseDiagnostics"title="不同叠合基准下的Fv差异"rows={anchor}sourceRows={raw}height={300}variant="card"
      spec={{type:'horizontalBar',x:'shortLabel',y:'value',startAtZero:true,valueDecimals:2,xLabel:'Fv Cα RMSD中位数 / Å',stackable:false}}
      description="前三项分别只拟合CD20核心、跨膜区或胞外区，保留抗体相对位置；最后一项单独拟合Fv，测内部形状。跨膜区168个、胞外区96个Cα；亚基对应固定。">
      <DataTable rows={anchor}searchable={false}columns={[{field:'shortLabel',label:'图中简称'},{field:'region',label:'叠合对象'},{field:'value',label:'Fv差异中位数 / Å',renderCell:v=>fmt(v,2)}]}/>
    </EvidenceChart>
    <EvidenceChart id="local-cdr-geometry"queryId="cdrDiagnostics"title="整体Fv、框架与CDR的局部差异"rows={localShape}sourceRows={cdrRows}height={300}variant="card"
      spec={{type:'horizontalBar',x:'shortLabel',y:'value',startAtZero:true,valueDecimals:2,xLabel:'Cα RMSD中位数 / Å',stackable:false}}
      description="CDR项先只用框架Cα拟合，再衡量被设计位点的残余差异；整体Fv项则用全部Fv拟合。均沿用亲本冻结IMGT掩码，重编号例外不改变原设计位置。"/>
    <DataComponent id="local-cdr-summary"queryId="cdrDiagnostics"title="同时报告中位数与高分歧尾部"kind="table"displayRows={localShape}sourceRows={cdrRows}>
      <DataTable rows={localShape}searchable={false}columns={[{field:'shortLabel',label:'图中简称'},{field:'metric',label:'比较对象'},{field:'pairs',label:'比较对数'},{field:'value',label:'中位数 / Å',renderCell:v=>fmt(v,2)},{field:'p95',label:'第95百分位 / Å',renderCell:v=>fmt(v,2)}]}/>
    </DataComponent>
    <RichNarrative id="cdr-tail-interpretation"className="research-caption"value={`当前范围中，整体Fv自身RMSD的第95百分位为${fmt(localShape[0]?.p95)} Å，框架拟合后CDR差异的第95百分位为${fmt(localShape[2]?.p95)} Å。中位数概括典型差异，第95百分位用于查看分歧较大的尾部候选。`}/>
    <DataComponent id="diagnostic-summary-table"queryId="poseSummary"title="各参考的靶点与抗体差异"kind="table"displayRows={summary}sourceRows={summary}>
      <DataTable rows={summary}searchable={false}columns={[{field:'reference_id',label:'参考'},{field:'pair_count',label:'比较对数'},
        {field:'antigen_fit_ca_rmsd_A_median',label:'CD20拟合 / Å',renderCell:v=>fmt(v)},
        {field:'antigen_monomer_self_fit_median_A_median',label:'CD20单体自身 / Å',renderCell:v=>fmt(v)},
        {field:'fv_self_fit_ca_rmsd_A_median',label:'Fv自身 / Å',renderCell:v=>fmt(v,2)},
        {field:'fv_pose_ca_rmsd_A_median',label:'Fv相对姿态 / Å',renderCell:v=>fmt(v)},
        {field:'ecd_vs_core_pose_absolute_change_A_median',label:'更换拟合区域的变化 / Å',renderCell:v=>fmt(v)}]}/>
    </DataComponent>
    <ReportSection id="target-attribution-limit"title="如何解释靶点与抗体的共同变化"queryId="poseDiagnostics"sourceRows={raw}showHeading={false}>
      <RichNarrative id="target-attribution-limit:body"className="explain-prose"value="### 三类差异需要联合阅读\n\nCD20形状决定叠合坐标框架，抗体的形状、位置与方向又共同决定Fv姿态RMSD。本轮分别报告CD20自身差异、Fv自身差异，以及更换核心/跨膜/胞外叠合区域后的指标变化，用它们定位分歧来源。\n\n下方平移、方向和形状占比，是同一坐标差异的几何分解。若要进一步确定CD20形变的因果贡献，需要固定靶点几何的受控比较。"/>
    </ReportSection>
    <EvidenceChart id="fv-decomposition"queryId="poseDiagnostics"title="Fv均方坐标差异的平移、方向与形状项"rows={decomposition}sourceRows={raw}height={300}variant="card"
        spec={{type:'horizontalBar',x:'shortLabel',y:'percent',startAtZero:true,valueDecimals:1,xLabel:'平均均方差中的占比 / %',stackable:false}}
        description="先逐对分解平方RMSD，再对当前范围的成对值等权平均；三项之和为100%。三项表示选定CD20叠合框架内，Fv坐标差异的几何组成。">
        <DataTable rows={decomposition}searchable={false}columns={[{field:'shortLabel',label:'图中简称'},{field:'component',label:'几何项'},{field:'mse',label:'平均均方差 / Å²',renderCell:v=>fmt(v,2)},{field:'percent',label:'占比',renderCell:v=>fmt(v,1)+'%'}]}/>
      </EvidenceChart>
    <details className="research-disclosure"><summary>进一步查看几何分解的计算方式</summary>
      <RichNarrative id="fv-decomposition-formula"value="`姿态RMSD² = 质心位移² + 中心化方向差异项 + Fv最优自拟合RMSD²`\n\n平移项来自两份Fv质心的距离；形状项是独立拟合Fv后的残余差异；方向项为其余中心化差异。原始RMSD不能按这三个百分比直接分配长度。"className="research-caption"/>
    </details>
    <div className="research-reference-filter"><label>三维诊断候选<select aria-label="选择三维诊断候选"value={current?.key||''}onChange={e=>onSceneChange(e.target.value)}>{index.map(r=><option key={r.key}value={r.key}>{r.reference_id} · {r.route==='rfd4'?'RFD4':'BoltzGen'} · 路线内第{r.rank}条</option>)}</select></label></div>
    {examples.length>0&&<div className="explain-pill-row"><button type="button"onClick={()=>onSceneChange(examples[0].item.key)}>查看保留集合内CDR差异最小示例</button><button type="button"onClick={()=>onSceneChange(examples[examples.length-1].item.key)}>查看保留集合内CDR差异最大示例</button></div>}
    <RichNarrative id="diagnostic-example-scope"className="research-caption"value="三维入口复用70条保留候选；上方初筛统计包含全部140条。示例按当前参考范围内，每条保留候选3组跨模型CDR差异的中位数选取；用于检查局部几何和分歧较大的具体结构。"/>
    <DataComponent id="candidate-structure-lab"queryId="structures"queryIds={['structures','diagnosticScenes']}title="交互检查：切换核心、跨膜、胞外或Fv自身叠合"kind="custom"displayRows={current?[current]:[]}sourceRowsByQuery={{structures:current?[current]:[],diagnosticScenes:getRows(snapshot,'diagnosticScenes').filter(r=>r.reference_id===current?.reference_id)}}>
      <DiagnosticViewer referenceId={current?.reference_id||'6VJA'}sceneKey={current?.key}purpose="candidate"/>
    </DataComponent>
    <Intro id="footprint-intro" title="胞外CDR接触位点与人源参考对照"text="结构形状、抗体姿态和接触位点并不等价。这里把每份预测的胞外CDR接触位点，与同一参考的一对人源Fv实际接触位点比较。"/>
    <div className="research-reference-filter"><label>接触位点参考<select aria-label="选择接触足迹参考"value={footReference}onChange={e=>setFootReference(e.target.value)}>{getRows(snapshot,'inventory').map(r=><option key={r.id}value={r.id}>{r.id} · {r.family}</option>)}</select></label></div>
    <ReportSection id="human-epitope-sites"queryId="experimentalFootprints"title="当前人源参考接触位点"sourceRows={targets}showHeading={false}>
      <RichNarrative id="human-epitope-sites:body"className="research-caption"value={`${footReference}实验参考在本轮可比范围内的接触位点：${targets[0]?.positions.join('、')||'—'}。按CDR与胞外CD20重原子距离<4.5 Å判定，合并两个亚基的同一UniProt位置；只计参考配对Fv，未把第二份Fab一起加入分母。`}/>
    </ReportSection>
    <EvidenceChart id="contact-footprint-overlap"queryId="contactFootprints"title="与人源实验接触足迹的重合程度"rows={footPlot}sourceRows={footprintSource}height={330}variant="card"
      spec={{type:'bar',x:'model',y:'value',series:'group',startAtZero:true,valueDecimals:2,yLabel:'接触位点Jaccard中位数',stackable:false,colors:{'人源亲本 · 3种子':'var(--chart-1)','犬亲本 · 3种子':'var(--chart-2)','候选 · 20条':'var(--chart-3)'}}}
      description="Jaccard＝预测与实验共同接触位置数÷两者位置并集数。亲本各取3种子；候选仅种子42的20条。数值越大，预测的胞外接触位置集合与当前人源实验参考越接近。"/>
    <EvidenceChart id="contact-footprint-map"queryId="contactHeatmap"title={footReference+' · 三模型在哪些胞外位置形成接触'}rows={heat}sourceRows={heatSource}height={290}variant="card"
      renderPlot={plot=><div className="explain-heatmap-scroll"><div className="explain-heatmap-wide">{plot}</div></div>}
        spec={{type:'heatmap',x:'position_label',y:'contact_percent',series:'modelLabel',colorDomain:[0,100],showValues:false,reverseRows:true,missingValues:'gap',valueDecimals:0,xLabel:'犬CD20对应位置；*为人源实验接触位点',yLabel:'20条候选中的接触比例 / %',stackable:false}}
        description="每格为同一参考、同一模型的20条初筛候选中，在该位置形成胞外CDR接触的比例。两条设计路线各10条，CDR沿用亲本冻结位置掩码。横向滚动可查看全部48个胞外位置。"/>
  </section>;
}
