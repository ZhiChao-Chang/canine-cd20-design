import React, { useEffect, useMemo, useState } from 'react';
import { DataComponent, DataTable, EvidenceChart, ReportSection, RichNarrative, useProjectReport } from '../../project-ui.jsx';
import { ChapterHeading, NumberingChapterSummary } from './ChapterHeading.jsx';
import { chapterForId } from './report-chapters.js';
import { SectionBubbleNav } from './SectionBubbleNav.jsx';
import { StudyWorkflow } from './StudyWorkflow.jsx';
import { CandidateWorkbench } from './CandidateWorkbench.jsx';
import { StructureViewer } from './StructureViewer.jsx';
import { ModelGuide, TargetGuide, ComparisonGuide, GeneratorComparison, StructuralDiagnostics } from './ReportExplainer.jsx';
import scenes from '../assets/structures.json';
import heroMolecule from '../assets/hero-molecule.png';

const models = { alphafold3: 'AF3', boltz2: 'Boltz-2', esmfold2: 'ESMFold2' };
const generators = { rfd4: 'RFD4', boltzgen: 'BoltzGen' };
const median = values => { const a = values.filter(Number.isFinite).sort((x,y) => x-y); const n=a.length; return n ? n%2 ? a[(n-1)/2] : (a[n/2-1]+a[n/2])/2 : null; };
const decimal = (value, digits=2) => Number.isFinite(value) ? value.toFixed(digits) : '—';

function Heading({ id, title, text }) {
  return <ChapterHeading id={id} title={title} text={text} titleSuffix="heading" textSuffix="description" />;
}

export function ReportContent() {
  const { snapshot, visible, appTitle, setAppTitle, canEdit, mode } = useProjectReport();
  const get = key => snapshot.queries[key]?.rows || [];
  // Apply the requested report rename through the public title setter.
  useEffect(() => { if (appTitle === '抗体计算研究') setAppTitle(snapshot.title); }, [appTitle, snapshot.title, setAppTitle]);
  const study = snapshot.study;
  const candidates = get('candidates'), selected = get('selected'), predictions = get('predictions');
  const inventory = get('inventory'), numbering = get('numbering')[0], robustness = get('robustness'), annotations=get('annotations');
  const [sceneKey, setSceneKey] = useState(scenes.index[0]?.key);
  const [comparisonKeys,setComparisonKeys] = useState(() => [...scenes.index.filter(x=>x.reference_id==='6VJA'&&x.route==='rfd4').slice(0,2),...scenes.index.filter(x=>x.reference_id==='6VJA'&&x.route==='boltzgen').slice(0,1)].map(x=>x.key));
  const selectedScene = scenes.index.find(x => x.key === sceneKey) || scenes.index[0];
  const reference = selectedScene?.reference_id || '6VJA';
  const chooseExplanationReference = id => {const item=scenes.index.find(row=>row.reference_id===id);if(item)setSceneKey(item.key);};
  const [tableReference, setTableReference] = useState('current'), [tableRoute, setTableRoute] = useState('all');
  const displayedCandidate = selected.find(x => x.reference_id+'/'+x.candidate_id===selectedScene?.key);
  const fasta = displayedCandidate ? '>'+displayedCandidate.reference_id+'|'+displayedCandidate.candidate_id+'|VH\n'+displayedCandidate.heavy_sequence+'\n>'+displayedCandidate.reference_id+'|'+displayedCandidate.candidate_id+'|VL\n'+displayedCandidate.light_sequence+'\n' : '';
  const currentCandidates = candidates.filter(x => x.reference_id === reference);
  const scatter = currentCandidates.map((x,i) => ({ ...x, label: generators[x.route]+' · '+x.within_route_rank,
    af3Iptm: x.alphafold3_interface_iptm, poseRmsd: x.median_cross_predictor_fv_pose_rmsd_A, generator: generators[x.route] }));
  const primary = predictions.filter(x => x.kind === 'designed_variant' && Number(x.seed) === 42);
  const confidence = useMemo(() => {
    const groups = new Map();
    for (const row of primary) {
      const key=row.reference_id+'/'+row.model;
      if (!groups.has(key)) groups.set(key,[]); groups.get(key).push(row.interface_iptm);
    }
    return [...groups.entries()].map(([key,values]) => { const [referenceId,model]=key.split('/'); return { referenceId, modelLabel: models[model], medianIptm: median(values), candidates:values.length }; });
  }, [snapshot]);
  const precisionRows=[...new Set(confidence.map(x => x.referenceId))].map(id => ({referenceId:id,poseMedianA:get('references').find(x=>x.id===id)?.median_cross_predictor_pose_A ?? null,...Object.fromEntries(Object.keys(models).map(model => [model,confidence.find(x => x.referenceId===id && x.modelLabel===models[model])?.medianIptm ?? null]))}));
  const typicalPose = median(candidates.map(x => x.median_cross_predictor_fv_pose_rmsd_A));
  const humanParents=get('parents').filter(x => x.kind==='parent_human');
  const currentParents = humanParents.filter(x => x.reference_id === reference);
  const parentOverview=[...new Set(humanParents.map(x=>x.reference_id))].map(id => ({referenceId:id,...Object.fromEntries(Object.keys(models).map(model => [model,median(humanParents.filter(x=>x.reference_id===id && x.model===model).map(x=>x.fv_pose_ca_rmsd_A))]))}));
  const parentClosest=Object.fromEntries(Object.keys(models).map(model=>[model,parentOverview.filter(x=>Number.isFinite(x[model]) && x[model]===Math.min(...Object.keys(models).map(m=>x[m]).filter(Number.isFinite))).length]));
  const parentPlot = Object.keys(models).map(model => ({ model:models[model], poseRmsd:median(currentParents.filter(x => x.model===model).map(x => x.fv_pose_ca_rmsd_A)) })).filter(x => x.poseRmsd !== null);
  const routeComparison=[...new Set(candidates.map(x => x.reference_id))].map(id => {
    const a=candidates.filter(x => x.reference_id===id && x.route==='rfd4');
    const b=candidates.filter(x => x.reference_id===id && x.route==='boltzgen');
    const am=median(a.map(x => x.median_cross_predictor_fv_pose_rmsd_A)),bm=median(b.map(x => x.median_cross_predictor_fv_pose_rmsd_A));
    return {referenceId:id,rfdMedian:am,boltzMedian:bm,poseDelta:am!==null&&bm!==null?am-bm:null,rfdCount:a.length,boltzCount:b.length};
  }).filter(x => x.poseDelta!==null);
  const repeatPlot=robustness.filter(x => Number(x.validated_prediction_count)===9).map(x => {
    const item=selected.find(y => y.case_id===x.case_id);
    return {referenceId:x.reference_id,family:x.family,name:x.reference_id+' '+generators[x.route]+' '+(item?.within_route_rank??''),
      withinPose:x.within_predictor_seed_pose_median_A,betweenPose:x.cross_predictor_pose_median_A,case_id:x.case_id,sceneKey:x.reference_id+'/'+x.candidate_id,
      support4:x.contact_support_4A,support45:x.contact_support_4_5A,support5:x.contact_support_5A};
  });
  const repeatWithin=median(repeatPlot.map(x => x.withinPose)),repeatBetween=median(repeatPlot.map(x => x.betweenPose));
  const betweenGreaterCount=repeatPlot.filter(x=>x.betweenPose>x.withinPose).length;
  const thresholdSensitive=repeatPlot.filter(x => !(x.support4===x.support45 && x.support45===x.support5)).length;
  const rfdLower=routeComparison.filter(x => x.poseDelta<0).length;
  const robustRows = robustness.filter(x => x.reference_id === reference);
  const majorityCount=candidates.filter(x=>Number(x.contact_support_models)>=2).length;
  const clashFor=x=>Number(robustness.find(v=>v.case_id===x.case_id)?.max_severe_clash_atom_pairs ?? x.max_antigen_fv_clash_atom_pairs);
  const selectedClashCount=selected.filter(x=>clashFor(x)>0).length;
  const tableRows = selected.filter(x => (tableReference==='all' || x.reference_id===reference) && (tableRoute==='all' || x.route===tableRoute)).map(x => ({
    ...x, sceneKey:x.reference_id+'/'+x.candidate_id, reference:x.reference_id, generator:generators[x.route],
    rank:x.within_route_rank, annotation:x.independent_renumbering_status==='consistent' ? '一致' : '需复核', af3:x.alphafold3_interface_iptm, boltz:x.boltz2_interface_iptm, esm:x.esmfold2_interface_iptm,
    pose:x.median_cross_predictor_fv_pose_rmsd_A, clashes:clashFor(x), supports:x.contact_support_models,
    repeated:robustness.find(v => v.case_id===x.case_id)?.validated_prediction_count ?? null,
    contactOutput:robustness.find(v => v.case_id===x.case_id) ? String(robustness.find(v => v.case_id===x.case_id).contact_support_4_5A)+'/'+String(robustness.find(v => v.case_id===x.case_id).validated_prediction_count) : String(x.contact_support_models)+'/3',
  }));
  const isBaseline=study.mode==='baseline';
  const annotationExceptions=annotations.filter(x => !x.mask_matches_design);
  const referencePoseValues=get('references').map(x=>x.median_cross_predictor_pose_A).filter(Number.isFinite);
  const poseRange=referencePoseValues.length ? decimal(Math.min(...referencePoseValues),1)+'—'+decimal(Math.max(...referencePoseValues),1) : '—';
  const primarySelectedClashes=selected.filter(x=>Number(x.max_antigen_fv_clash_atom_pairs)>0).length;
  const repeatInterpretation=repeatPlot.length ? (repeatBetween>repeatWithin
    ? `跨模型差异的中位数高于同模型换种子的差异（${decimal(repeatBetween,1)} 对 ${decimal(repeatWithin,1)} Å），更换随机种子后，模型间的姿态分歧仍然存在；同一模型自身也表现出明显波动。`
    : `同模型跨种子差异同样需要关注（${decimal(repeatWithin,1)} Å）；本轮采样不足以把任何单次姿态作为确定结果。`) : '追加采样尚未完成，当前结论以种子42的初筛为限。';

  const heatSpec={ type:'heatmap',x:'modelLabel',y:'medianIptm',series:'referenceId',colorDomain:[0,1],showValues:true,reverseRows:true,missingValues:'gap',
    valueDecimals:3, xLabel:'预测器',yLabel:'界面ipTM中位数',showXAxisLabel:false,showYAxisLabel:false,categoryOrder:['AF3','Boltz-2','ESMFold2'],baseColor:'var(--chart-1)',stackable:false };
  const scatterSpec={ type:'scatter',x:'af3Iptm',y:'poseRmsd',series:'generator',label:'label',valueDecimals:3,
    xLabel:'AF3界面分数',yLabel:'跨模型Fv偏差 / Å',startAtZero:true,stackable:false,colors:{ RFD4:'var(--chart-1)',BoltzGen:'var(--chart-2)' } };

  return <article className="report-content apple-research-report">
    <SectionBubbleNav />
    <nav className="research-local-nav" aria-label="汇报章节">
      <span className="research-wordmark">CANINE CD20</span>
      <div>{['overview','study-workflow','target-anatomy','toolkit','comparison-methods','generation-verification','structures','numbering-branch'].map(id=>{const chapter=chapterForId(id);return <a key={id} href={'#'+id}>{chapter.label}</a>;})}<a href="./teaching.html">教学说明</a></div>
    </nav>

    <header className="research-hero" id="overview">
      <div className="research-hero-copy">
        <RichNarrative id="hero:kicker" value="多参考CDR设计 · 计算研究" className="research-eyebrow" label="编辑报告题签" />
        <h1 data-data-app-title contentEditable={canEdit && mode==='edit'} suppressContentEditableWarning
          onBlur={canEdit && mode==='edit' ? event => setAppTitle(event.currentTarget.textContent.trim() || appTitle) : undefined}>{appTitle}</h1>
        <RichNarrative id="hero:lead" value={"多参考CDR生成与结构复核"} className="research-hero-lead" label="编辑主视觉说明" />
        <RichNarrative id="hero:description" value="从7个人源实验复合物出发，分别设计识别犬CD20的候选抗体，用三套模型比较其形状、结合姿态与接触位点。" className="research-hero-description" label="编辑研究简介" />
        <div className="research-hero-actions"><a className="research-primary-link" href="#study-workflow">查看实验流程 <span aria-hidden="true">↗</span></a><a className="research-text-link" href="#structures">三维结构浏览 <span aria-hidden="true">→</span></a></div>
        <span className="research-phase-badge"><i />{study.phaseLabel}</span>
      </div>
      <DataComponent id="hero-structure" title="犬CD20与一个候选的预测结构" queryId="structures" kind="custom" displayRows={get('structures').slice(0,1)} sourceRows={get('structures').slice(0,1)}><div className="research-hero-art"><img src={heroMolecule} alt="来自实际AF3预测的犬CD20与候选抗体结构" /><div className="research-hero-art-note">真实预测坐标 · AF3</div></div></DataComponent>
    </header>

    <RichNarrative id="report-terms-primer"className="research-caption"value="CD20是设计靶点。VH和VL是抗体的重、轻链可变区，两者构成Fv；六段CDR位于Fv上，直接参与识别靶点。本轮保留已有抗体框架，重新设计这些识别环。"/>
    <ReportSection id="overview-findings" title="主要结果与结论" queryId="candidates" queryIds={['numbering','candidates','selected','robustness','predictions','parents','references']}
      sourceRowsByQuery={{ numbering:get('numbering'),candidates,selected,robustness,predictions,parents:get('parents'),references:get('references') }} showHeading={false} className="research-overview">
      <RichNarrative id="overview-findings:body" className="research-overview-copy" label="编辑研究结论"
        value={`**完成140对候选的生成与复核。** ${study.referenceCount}个人源参考分别运行RFD4与BoltzGen，各生成10对VH/VL；保留70对候选追加种子采样，共获得${study.totalPredictionCount}份规范结构预测。\n\n**模型间的结合姿态仍存在较大分歧。** 初筛候选的跨模型Fv姿态差异中位数为${decimal(typicalPose,1)} Å，各参考为${poseRange} Å。后文分别检查靶点形状、抗体自身形状和相对位置。\n\n**下一步优先复核结构分歧与局部几何。** 初筛${majorityCount}/${candidates.length}条获得至少2/3模型接触支持，保留集合中${primarySelectedClashes}条至少一份初筛结构出现严重近接。当前分析支持按姿态、CDR形状与重复性进一步选择实验候选。`} />
    </ReportSection>

    <StudyWorkflow />

    <TargetGuide mode="intro" referenceId={reference} onReferenceChange={chooseExplanationReference} />

    <section id="design" className="research-chapter design-chapter">
      <Heading id="design-section" title="多参考犬CD20抗体设计" text="设计靶点为犬CD20（Q3C2E2）；各人源CD20（P11836）复合物分别提供自己的亲本与结构起点。" />
      <DataComponent id="design-scale" title={isBaseline ? '已完成的单参考基线规模' : '本轮多参考初筛规模'} queryId="candidates" queryIds={['candidates','predictions']}
        displayRows={[{references:study.referenceCount,candidates:study.candidateCount,predictions:study.primaryPredictionCount}]}
        sourceRowsByQuery={{candidates,predictions}} kind="custom">
        <div className="research-large-facts" data-reviewed-rows>
          <div><strong>{study.referenceCount}</strong><span>个已验收参考体系</span></div>
          <div><strong>{study.candidateCount}</strong><span>条设计候选记录</span></div>
          <div><strong>{study.primaryPredictionCount}</strong><span>例初筛复预测 · 含亲本对照</span></div>
        </div>
      </DataComponent>
      <DataComponent id="reference-inventory" title="独立参考复合物" queryId="inventory" kind="custom" displayRows={inventory} sourceRows={inventory}>
        <div className="research-reference-grid" data-reviewed-rows>{inventory.map(item => <a key={item.id} href={'https://www.rcsb.org/structure/'+item.id} target="_blank" rel="noreferrer" className="research-reference-card">
          <span className="reference-source">实验参考</span><strong>{item.id}</strong><span>{item.family}</span><span className="reference-resolution">{item.resolution_A} Å</span>
          {item.id==='8VGO' && <em>工程化框架</em>}
        </a>)}</div>
      </DataComponent>
      <RichNarrative id="reference-inventory:scope" className="research-caption" label="编辑参考来源说明" value="参考覆盖Rituximab、Ofatumumab、Obinutuzumab三种治疗抗体，并加入Rituximab.4DS工程化参考。同一种抗体的多个结构单独列出，不作为多个不同药物计数。" />
      <ReportSection id="generated-numbering-check" title="生成后的重编号检查" queryId="annotations" sourceRows={annotations} showHeading={false}>
        <RichNarrative id="generated-numbering-check:body" className="research-caption" label="编辑生成后编号检查" value={`生成后重新编号：${study.annotationChainsConsistent}/${study.annotationChainsChecked}条VH/VL链的CDR边界与设计条件一致。${study.annotationExceptionCandidates ? `有${study.annotationExceptionCandidates}条候选含自动重编号例外，已保留并另列诊断，未改变既定排名；生成和几何分析仍采用亲本映射的固定位置掩码。` : '本次检查范围内未发现边界不一致。'}`} />
      </ReportSection>
      {annotationExceptions.length>0 && <details className="research-disclosure"><summary>查看重编号诊断例外 <span aria-hidden="true">＋</span></summary><DataComponent id="annotation-exceptions" title="自动重编号例外" queryId="annotations" kind="table" displayRows={annotationExceptions} sourceRows={annotationExceptions}><DataTable rows={annotationExceptions} searchable={false} caption="未因此更改生成集合或初筛排名" columns={[{field:'reference_id',label:'参考'},{field:'candidate_id',label:'候选'},{field:'chain',label:'链'},{field:'scheme_status',label:'自动编号状态'},{field:'reason',label:'程序返回原因'}]} /></DataComponent></details>}
      <details className="research-disclosure"><summary>查看生成、复预测与筛选的执行顺序</summary>
      <DataComponent id="design-protocol" title="独立参考设计与评估方法" queryId="candidates" queryIds={['inventory','candidates','predictions','selected','robustness']} kind="custom" sourceRowsByQuery={{inventory,candidates,predictions,selected,robustness}} displayRows={[study]}>
        <ol className="research-protocol-list" data-reviewed-rows>
          <li><b>确定每个参考的起点</b><span>取其实际可见的配对VH/VL；犬CD20核心46—210位分别转移到该参考的起始装配。统一为两个CD20核心加一对VH/VL，不跨参考融合。</span></li>
          <li><b>用自编IMGT编号确定可变位点</b><span>仅六CDR允许改变；保留该亲本框架序列和链长度。编号任务提供位置映射，结构设计工具负责提出新序列与构象。</span></li>
          <li><b>两条路线独立生成并核验</b><span>RFD4与BoltzGen各参考各尝试10条（1次pilot＋9次batch）；核对链身份、目标序列、框架保留和序列对唯一性。</span></li>
          <li><b>固定序列，三模型重新预测</b><span>将候选VH/VL与靶点交给AF3、Boltz-2、ESMFold2；初筛种子42、单样本、空MSA、无模板，不把生成姿态传给复预测。</span></li>
          <li><b>分参考排序，再检验重复性</b><span>按接触支持、参考内模型百分位、姿态差异及CDR多样性，每方法保留最多5条；固定该集合后追加43/44种子，保留严重近接等诊断。</span></li>
        </ol>
      </DataComponent>
      </details>
    </section>

    <ModelGuide />
    <ComparisonGuide />
    <div className="results-reading-map"><RichNarrative id="results-reading-map" className="explain-prose" value="### 结果按三个问题展开\n\n**设计姿态保留了吗？** 先比较生成构象与三模型复预测。\n\n**分歧体现在哪里？** 再对照人源实验结构，分别检查CD20、Fv形状和相对姿态。\n\n**哪些候选值得继续看？** 最后结合接触、局部几何和跨种子重复性，浏览保留候选。"/></div>
    <GeneratorComparison />
    <TargetGuide mode="results" referenceId={reference} onReferenceChange={chooseExplanationReference} />

    <section className="research-chapter evidence-chapter" id="comparison">
      <Heading id="comparison-section" title="初筛结果与模型一致性" text={(isBaseline ? '以下为已完成的6VJA单参考基线；扩展结果尚未混入这些数值。' : '统一空MSA、无模板、单样本初筛；分别观察各参考的界面输出与模型间姿态差异。')+'界面分数按预测器分别汇总，姿态差异由同一候选的三组模型配对计算。'} />
      <div className="research-reference-filter"><label>逐参考查看<select aria-label="选择比较参考" value={reference} onChange={event => setSceneKey(scenes.index.find(x => x.reference_id===event.target.value).key)}>{[...new Set(scenes.index.map(x => x.reference_id))].map(id => <option key={id} value={id}>{inventory.find(x => x.id===id)?.family} · {id}</option>)}</select></label><span>候选散点、三维结构与人源对照同步切换</span></div>
      <div className="research-chart-grid">
        <EvidenceChart variant="card" padding="spacious" id="confidence-matrix" title="各参考的界面ipTM中位数" queryId="predictions" rows={confidence} sourceRows={primary} spec={heatSpec} height={390}
          description="仅初筛种子42、有效设计候选；不含亲本。每格汇总该参考20条候选的界面分数；按模型分列查看各参考的分布。" />
        <EvidenceChart variant="card" padding="spacious" id="candidate-agreement" title={reference+' · 候选界面与姿态差异'} queryId="candidates" rows={scatter} sourceRows={currentCandidates} spec={scatterSpec} height={390}
          description="每点一个候选；横轴为该候选的AF3界面分数；纵轴先对齐CD20，再取三组跨模型Fv姿态RMSD的中位数，用于寻找界面支持与姿态稳定性兼具的候选。" />
      </div>
      <DataComponent id="confidence-table" title="各参考初筛分数与姿态中位数" queryId="predictions" queryIds={['predictions','references']} kind="table" className="research-precision-table" displayRows={precisionRows} sourceRowsByQuery={{predictions:primary,references:get('references')}}>
        <DataTable rows={precisionRows} searchable={false} caption="仅初筛候选，不含亲本；分数与姿态分别解释" columns={[{field:'referenceId',label:'参考'},...Object.keys(models).map(model => ({field:model,label:models[model],renderCell:v => decimal(v,3)})),{field:'poseMedianA',label:'跨模型Fv差异 / Å',renderCell:v=>decimal(v,1)}]} />
      </DataComponent>
      <EvidenceChart variant="card" padding="spacious" id="route-comparison" title="两条生成路线的姿态差异" queryId="candidates" rows={routeComparison} sourceRows={candidates}
        spec={{type:'horizontalBar',x:'referenceId',y:'poseDelta',colorBySign:false,colors:Object.fromEntries(routeComparison.map(x=>[x.referenceId,x.poseDelta<0 ? 'var(--chart-1)' : 'var(--chart-2)'])),xLabel:'差值 / Å（RFD4 − BoltzGen）',startAtZero:true,valueDecimals:2,showValues:false,stackable:false}}
        height={Math.max(210,routeComparison.length*44+90)} description="负值（蓝色）表示RFD4的跨模型姿态差异较小，正值（橙色）表示BoltzGen较小；此处比较的是计算一致性。" />
      <ReportSection id="route-interpretation" title="路线比较观察" queryId="candidates" sourceRows={candidates} showHeading={false}>
        <RichNarrative id="route-interpretation:body" className="research-caption" label="编辑路线比较观察" value={`蓝色负值对应RFD4姿态差异较小，橙色正值对应BoltzGen较小。\n\n本轮可比较的${routeComparison.length}个参考中，${rfdLower}个参考的RFD4姿态差异中位数较小，${routeComparison.filter(x=>x.poseDelta>0).length}个参考的BoltzGen较小。该比较按参考逐一进行，不将参考内部的置信度百分位混为全局排名。`} />
      </ReportSection>
      <DataComponent id="pose-observation" title="候选跨模型姿态差异" queryId="candidates" kind="custom" displayRows={[{medianPoseRmsd_A:typicalPose}]} sourceRows={candidates}>
        <div className="research-pose-callout" data-reviewed-rows><strong>{decimal(typicalPose,1)}<small> Å</small></strong><div><b>跨模型Fv姿态差异的中位数</b><span>先对齐CD20，再比较抗体的位置；每条候选计算AF3↔Boltz-2、AF3↔ESMFold2、Boltz-2↔ESMFold2三组RMSD，先取其中位数，再汇总140条候选。</span></div></div>
      </DataComponent>
      <ReportSection id="contact-clash-observations" title="初筛接触与几何观察" queryId="candidates" queryIds={['candidates','selected','robustness']} sourceRowsByQuery={{candidates,selected,robustness}} showHeading={false}>
        <RichNarrative id="contact-clash-observations:body" className="research-caption" label="编辑接触与几何观察" value={`初筛${majorityCount}/${candidates.length}条获得至少2/3模型的胞外CDR接触支持。${majorityCount===candidates.length ? '本批该门槛没有拉开优先级。' : '接触门槛仅作为计算排序依据。'}保留集合${selectedClashCount}/${selected.length}条在已完成预测中出现小于1.5 Å的抗原–Fv近接；近接对用于定位需要检查的局部几何，具体候选见后续清单。`} />
      </ReportSection>
    </section>

    <StructuralDiagnostics sceneKey={sceneKey} onSceneChange={setSceneKey} />

    <section className="research-chapter structure-chapter" id="structures">
      <Heading id="structure-section" title="候选结构比较" text="先自由组合多条候选，在同一预测器下比较结合姿态与CDR；下方保留单条候选的三预测器对照。" />
      <div id="candidate-comparison-workbench"><CandidateWorkbench selectedKeys={comparisonKeys} onSelectionChange={setComparisonKeys}/></div>
      <div id="single-candidate-view"><RichNarrative id="single-candidate-view:intro" className="cw-legacy-title" value="### 单条候选的三预测器对照" />
      {visible('structure-browser') && <DataComponent id="structure-browser" title="抗体与犬CD20结构浏览" queryId="structures" kind="custom"
        displayRows={get('structures').filter(x => x.key===selectedScene?.key)} sourceRows={get('structures').filter(x => x.key===selectedScene?.key)}>
        <StructureViewer sceneKey={sceneKey} onSceneChange={setSceneKey} />
      </DataComponent>}
      {displayedCandidate && <DataComponent id="paired-sequence" title="当前候选的配对序列" queryId="selected" kind="custom" displayRows={[displayedCandidate]} sourceRows={[displayedCandidate]}>
        <details className="research-disclosure"><summary>查看当前VH/VL序列 <span aria-hidden="true">＋</span></summary><div className="research-sequence" data-reviewed-rows><pre>{fasta}</pre><button type="button" onClick={() => {const link=document.createElement('a');link.href=URL.createObjectURL(new Blob([fasta],{type:'text/plain'}));link.download=displayedCandidate.reference_id+'_'+displayedCandidate.candidate_id+'.fasta';link.click();setTimeout(()=>URL.revokeObjectURL(link.href),1000);}}>下载配对FASTA</button></div></details>
      </DataComponent>}
      </div>
    </section>

    <section className="research-chapter candidate-chapter" id="candidates">
      <Heading id="candidate-section" title="候选清单与诊断" text="每参考、每方法独立保留最多五条用于计算复核；点击候选进入三维结构。近接对为各候选可用预测中，抗原与Fv之间小于1.5 Å原子对数的最大值。" />
      <DataComponent id="candidate-table" title="分参考候选结果" queryId="selected" queryIds={['selected','robustness','annotations']} kind="table" displayRows={tableRows} sourceRowsByQuery={{selected:selected.filter(x => tableRows.some(y => y.case_id===x.case_id)),robustness:robustness.filter(x => tableRows.some(y => y.case_id===x.case_id)),annotations:annotations.filter(x => tableRows.some(y => y.reference_id===x.reference_id && y.candidate_id===x.candidate_id))}}>
        <DataTable rows={tableRows} caption="保留的计算复核集合" rowKey="sceneKey" selectedRowKey={sceneKey} onRowSelect={row => {setSceneKey(row.sceneKey); document.getElementById('single-candidate-view')?.scrollIntoView({behavior:'smooth'});}}
          rowActionLabel={row => '查看'+row.reference+' '+row.generator+'候选结构'}
          toolbarControls={<div className="research-table-controls"><label>参考<select value={tableReference==='all' ? 'all' : reference} onChange={e => {if(e.target.value==='all'){setTableReference('all');}else{setTableReference('current');setSceneKey(scenes.index.find(x=>x.reference_id===e.target.value).key);}}}><option value="all">全部参考</option>{[...new Set(selected.map(x => x.reference_id))].map(id => <option key={id}>{id}</option>)}</select></label><label>生成方法<select value={tableRoute} onChange={e => setTableRoute(e.target.value)}><option value="all">全部</option><option value="rfd4">RFD4</option><option value="boltzgen">BoltzGen</option></select></label></div>}
          columns={[{field:'sceneKey',label:'多选叠加',renderCell:(v,row)=><button type="button" onClick={e=>{e.stopPropagation();setComparisonKeys(old=>[...new Set([...old,row.sceneKey])]);document.getElementById('candidate-comparison-workbench')?.scrollIntoView({behavior:'smooth'});}}>{comparisonKeys.includes(row.sceneKey)?'已加入 · 查看':'加入叠加'}</button>},{field:'reference',label:'参考'},{field:'generator',label:'生成方法'},{field:'rank',label:'路线内排名'},
            {field:'af3',label:'AF3界面',renderCell:v => decimal(v,3)},{field:'boltz',label:'Boltz-2界面',renderCell:v => decimal(v,3)},
            {field:'esm',label:'ESM界面',renderCell:v => decimal(v,3)},{field:'pose',label:'姿态差异 / Å',renderCell:v => decimal(v,1)},{field:'clashes',label:'<1.5 Å近接对'},
            {field:'annotation',label:'编号边界'},{field:'contactOutput',label:'接触支持输出'},{field:'repeated',label:'重复采样覆盖',renderCell:v => v===null ? isBaseline ? '未追加' : '计算中' : v+'/9'}]} />
      </DataComponent>
    </section>

    <section className="research-chapter reliability-chapter" id="reliability">
      <Heading id="reliability-section" title="亲本对照与候选重复性" text="在统一四链简化体系下检查人源亲本姿态，再用追加采样观察保留候选的重复性。" />
      <div className="research-chart-grid">
        <EvidenceChart variant="card" padding="spacious" id="human-parent-control" title={reference+' · 人源亲本姿态偏差'} queryId="parents" rows={parentPlot} sourceRows={currentParents}
          spec={{type:'horizontalBar',x:'model',y:'poseRmsd',colorBySign:false,colors:{AF3:'var(--chart-1)','Boltz-2':'var(--chart-2)',ESMFold2:'var(--chart-3)'},xLabel:'姿态RMSD / Å',startAtZero:true,valueDecimals:2,stackable:false}} height={280}
          description={(study.mode==='final' ? '每模型为三个种子的姿态偏差中位数。' : '初筛种子42的姿态偏差。')+'按该参考可用抗原坐标拟合后比较Fv；越小越接近该人源实验参考。'} />
        <ReportSection id="robustness-readout" title="追加采样结果" queryId="robustness" sourceRows={robustRows} showHeading={false} className="research-robustness-panel">
          <RichNarrative id="robustness-readout:body" label="编辑追加采样结果" className="research-robustness-copy"
            value={robustRows.length ? `## 保留集合的重复采样\n\n当前参考已有${robustRows.filter(x => Number(x.validated_prediction_count)===9).length}条保留候选完成三模型×三种子的9份预测。\n\n同一候选分别比较固定模型换种子、固定种子换模型，判断姿态波动主要体现在哪一层。` : '## 重复采样进度\n\n扩展实验会对初筛保留集合追加43、44两个种子，并比较4.0、4.5、5.0 Å接触阈值。完成后在本页更新；当前不填入未产生的数值。'} />
        </ReportSection>
      </div>
      <ReportSection id="parent-overview-observations" title="人源亲本自洽检查汇总" queryId="parents" sourceRows={humanParents} showHeading={false}>
        <RichNarrative id="parent-overview-observations:body" className="research-caption" label="编辑人源亲本汇总" value={`本轮${parentOverview.length}个参考的人源亲本检查中，姿态偏差最小的参考数为AF3 ${parentClosest.alphafold3}、Boltz-2 ${parentClosest.boltz2}、ESMFold2 ${parentClosest.esmfold2}（${study.mode==='final' ? '每模型先取三种子中位数' : '初筛种子42'}）。每组使用该参考原始抗体和人源CD20序列，检查四链预测对已知实验姿态的恢复程度。`} />
      </ReportSection>
      <details className="research-disclosure"><summary>查看全部参考的人源亲本对照 <span aria-hidden="true">＋</span></summary><DataComponent id="parent-overview-table" title="人源亲本姿态偏差 / Å" queryId="parents" kind="table" displayRows={parentOverview} sourceRows={humanParents}><DataTable rows={parentOverview} searchable={false} caption="各参考内部比较，数值越小越接近该实验参考" columns={[{field:'referenceId',label:'参考'},...Object.keys(models).map(model=>({field:model,label:models[model],renderCell:v=>decimal(v,1)}))]} /></DataComponent></details>
      {repeatPlot.length>0 && <>
        <EvidenceChart variant="card" padding="spacious" id="repeatability-comparison" title="重复采样的姿态变化" queryId="robustness" rows={repeatPlot} sourceRows={robustness}
          spec={{type:'scatter',x:'withinPose',y:'betweenPose',series:'family',label:'name',xLabel:'跨种子Fv偏差 / Å',yLabel:'跨模型Fv偏差 / Å',valueDecimals:2,startAtZero:true,stackable:false,
            colors:{Rituximab:'var(--chart-1)',Ofatumumab:'var(--chart-2)',Obinutuzumab:'var(--chart-3)','Rituximab.4DS':'var(--chart-4)'}}}
          height={400} description="仅初筛保留集合中完成九份预测的候选；每点一个候选，横纵坐标均为该候选成对姿态RMSD的中位数。" />
        <ReportSection id="repeatability-interpretation" title="重复采样观察" queryId="robustness" sourceRows={robustness} showHeading={false}>
          <RichNarrative id="repeatability-interpretation:body" className="research-caption" label="编辑重复采样观察"
            value={`**重复性结论。** ${repeatInterpretation}\n\n已完整复核的${repeatPlot.length}条候选中，候选级同模型跨种子姿态差异中位数为${decimal(repeatWithin,1)} Å，候选级跨模型差异中位数为${decimal(repeatBetween,1)} Å；${betweenGreaterCount}/${repeatPlot.length}条的跨模型差异大于跨种子差异。4.0、4.5、5.0 Å三个接触阈值下，有${thresholdSensitive}条候选的接触支持次数发生变化。接触支持与姿态稳定性分别报告。`} />
        </ReportSection>
      </>}
      <RichNarrative id="biological-limit" className="research-final-statement" label="编辑结论边界" value="**本轮结论：** 已完成指定批次的自主编号复现，并获得多参考条件下可追溯的设计与预测结果。在本轮四链、空MSA条件下，多个参考均显示较大的模型间姿态差异。新增分解显示，Fv整体形状差异的中位数较小，但局部CDR及部分离群预测仍有明显分歧；CD20本身的形变和叠合基准需要与相对姿态一起解释；现阶段应优先联合查看CDR局部形状、相对姿态、接触位点及重复性，再选择表达、结合与功能实验的候选。" />
    </section>

    <details className="numbering-branch" id="numbering-branch"><NumberingChapterSummary /><p>编号为主线提供CDR位置映射；这里单独展示算法构建和参考复现结果。</p>
    <section id="numbering" className="research-chapter numbering-chapter">
      <Heading id="numbering-section" title="自编编号算法与验收" text="定位、对齐和编号规则由本项目实现，运行不调用现成编号模型。" />
      <DataComponent id="numbering-proof" title="给定批次复现结果" queryId="numbering" kind="custom" displayRows={get('numbering')} sourceRows={get('numbering')}>
        <div className="research-large-facts" data-reviewed-rows>
          <div><strong>{numbering.effectiveRecords}</strong><span>条有效输入</span></div>
          <div><strong>{numbering.systems}</strong><span>种编号体系</span></div>
          <div><strong>{numbering.matchedGroups}<small> / {numbering.totalGroups}</small></strong><span>组输出与网站参考一致</span></div>
        </div>
      </DataComponent>
      <div className="numbering-system-row">{['Kabat','Chothia','IMGT','Martin','AHo'].map(name => <span key={name}>{name}</span>)}</div>
      <ReportSection id="numbering-method-summary" title="编号算法的构建方法" queryId="numbering" sourceRows={get('numbering')} showHeading={false}>
        <RichNarrative id="numbering-method-summary:body" className="research-method-intro" label="编辑编号算法说明" value="编号标准提供位置命名约定；本项目实现的是**把新序列映射到这些标准位置的算法**。公开已编号框架提供定位参照，框架对应由动态规划求解，环区与插入标签按规则生成。没有神经网络训练阶段，也不在推理时读取本批网站答案。" />
      </ReportSection>
      <DataComponent id="numbering-architecture" title="自编编号算法架构" queryId="numbering" kind="custom" displayRows={get('numbering')} sourceRows={get('numbering')}>
        <ol className="research-algorithm-grid" aria-label="编号计算的六个阶段" data-reviewed-rows>
          <li><span>步骤1 · 输入处理</span><h3>规范化并保留索引</h3><p>读取FASTA、转大写、去掉对齐横线；未知残基保留为X，记录清理前后位置，含终止符按约定暂跳过。</p><code>read_fasta()</code></li>
          <li><span>步骤2 · 定位参照</span><h3>读取公开编号框架</h3><p>五条公开框架包含H、κ/λ类型、框架区间和五体系标签；环区被遮蔽，不直接复制环区答案。</p><code>AnchorNumberer.__init__()</code></li>
          <li><span>步骤3 · 区域定位</span><h3>枚举锚点与分段</h3><p>利用C、W和YYC类模式，结合可支持的区域长度，提出多套重/轻链与框架—环区边界假设。</p><code>locate()</code></li>
          <li><span>步骤4 · 残基对应</span><h3>动态规划与候选评分</h3><p>比较匹配、缺失和插入路径并回溯；结合锚点及轻链类型支持，选择框架对应最合适的分段。</p><code>align() / framework_alignment()</code></li>
          <li><span>步骤5 · 编号生成</span><h3>框架映射与环区规则</h3><p>沿对齐关系转移框架标签；按链型、环长和标准分别计算环区标签、中心留空及字母/小数插入位点。</p><code>number() / loop_labels()</code></li>
          <li><span>步骤6 · 输出与核验</span><h3>附加参考频率</h3><p>按“体系＋位置＋氨基酸”读取公开计数表，输出编号、频率、状态及来源；推理结束后再与网站参考对照。</p><code>FrequencyTables.lookup()</code></li>
        </ol>
      </DataComponent>
      <details className="research-disclosure"><summary>编号评分、输出含义与适用范围 <span aria-hidden="true">＋</span></summary>
        <RichNarrative id="numbering-implementation-details" label="编辑编号实现细节" value="动态规划采用同残基+3、不同−1、未知X为0、普通缺口−5，并对端部截短单独处理。同分使用固定回溯顺序。候选选择还加入C/W锚点及κ/λ类型支持；这些是人工确定的规则分值，并未校准成正确概率。\n\n框架位置来自公开编号参考的对应关系；环区标签由本项目规则生成，因此它是一套自编实现，并未发明新的编号标准。某些罕见形式尚不支持；网站历史AHo部分输出的兼容行为也单独记录。\n\n参考频率＝该标准位置当前氨基酸计数÷参考总计数（包含gap）×100%。它描述参考数据分布，不能当作本次编号正确概率。" />
        <a className="research-teaching-link" href="./teaching.html#task-numbering">查看九步算法教学、动态规划示例与源码说明 →</a>
        <a className="research-teaching-link" href="https://github.com/ZhiChao-Chang/antibody-numbering" target="_blank" rel="noreferrer">抗体编号公开源码与运行说明 ↗</a>
      </details>
      <ReportSection id="numbering-scope" title="编号验收范围" queryId="numbering" sourceRows={get('numbering')} showHeading={false}>
        <RichNarrative id="numbering-scope:body" className="research-caption" label="编辑编号范围说明" value={`原始${numbering.rawRecords}条记录中，${numbering.skippedRecords}条含终止符按要求暂跳过；有效输入中${numbering.numberedRecords}条可编号、${numbering.unclassifiedRecords}条未分类；比较组包含未分类对应的空输出。原批次参与过开发；另${numbering.publicSequences}条公开序列的${numbering.publicTotalGroups}组输出一致，属于小规模外部检查，尚不代表任意抗体都已验证。`} />
      </ReportSection>
    </section>

    </details>

    <section id="evidence" className="research-chapter methods-chapter">
      <Heading id="methods-section" title="实验条件与数据来源" />
      <RichNarrative id="study-scope-once" className="research-caption" value="**研究范围。** 本轮为计算设计研究，使用两个CD20核心与一对VH/VL，未显式建模脂质膜、完整Fab或Fc。犬起点来自AFDB预测，装配参考人源实验复合物；犬候选的结合、亲和力与功能有待实验测定。各模型的界面分数分别解释，结构RMSD统一按对应坐标计算。"/>
      <details className="research-disclosure"><summary>查看编号方法与验收口径 <span aria-hidden="true">＋</span></summary>
        <RichNarrative id="numbering:methods" label="编辑编号方法" value="本项目实现框架锚点定位、动态规划对齐和区域编号转换；公开编号框架用于对齐参照，循环区与插入标签按规则计算。运行不调用ANARCI、ANARCII或在线编号服务，不需要神经网络训练。\n\n验收对照是abYsis网站给出的参考编号，并非实验测得的唯一生物学真值。原批次参与过开发，另有小规模公开序列检查；结果不代表所有新抗体均已验证。\n\n频率输出表示参考数据中某标准位置出现某种氨基酸的频率，不表示该次编号正确的概率。生成后重编号诊断与原批次复现验收分别报告。" />
      </details>
      <details className="research-disclosure"><summary>查看参考检索与纳入范围 <span aria-hidden="true">＋</span></summary>
        <RichNarrative id="inventory:methods" label="编辑参考检索说明" value="对P11836关联结构及CD20全文匹配进行检索，共检查24个匹配条目，采用其中7个具有CD20核心与配对抗体空间上下文的复合物。短肽复合物、单独抗体和Fc片段另行记录，没有混入同一个完整靶点设计输入。

C2H7等额外抗体可查到短肽复合物，但本轮没有用其他参考拼接其完整靶点装配。6Y97与6Y9A属于同一亲本的不同坐标覆盖，8VGO属于工程化来源；使用各自实际可见的Fv部分，不把这些条目视为七种不同药物，也不冒称保留了完整Fab或Fc的全部工程属性。" />
      </details>
      <details className="research-disclosure"><summary>查看实验条件与筛选规则 <span aria-hidden="true">＋</span></summary>
        <RichNarrative id="methods:body" label="编辑方法说明" value="各参考使用自己实验结构中的配对可变区和起始装配；犬靶点核心统一为46—210位，几何来自犬AFDB预测并分别转移到各人源参考。各体系统一为两个CD20核心加一对VH/VL，共四条蛋白链；没有保留完整Fab、第二个协同Fab或Fc，因此人源对照也不是原实验完整体系的严格复现。只改自编IMGT编号确定的六CDR，框架序列与两条链长度固定，不显式模拟膜。\n\n夜间扩展每参考每方法尝试10条，种子101/102；初筛三个预测器均为种子42、单样本、空MSA和无模板。按胞外CDR接触支持、参考内部模型百分位、跨模型姿态及CDR多样性保留最多5条/路线。\n\n参考独立指生成条件和结果分组独立；各体系仍共享靶点、预测模型及部分亲本序列，不是七个独立生物学重复。复预测只输入序列，不输入生成姿态；相同序列和种子可能得到相同预测。\n\n初筛接触阈值4.5 Å；追加采样检查4.0/4.5/5.0 Å敏感性。小于1.5 Å的严重接近保留为诊断，不是完整物理能量评价。不同参考的构建体末端覆盖和工程化框架差异均保留，详见对应来源。生成后的重编号是另行诊断：短片段若类似框架锚点，可触发当前编号器的unsupported输出；此类候选保留并标注，不把亲本固定位置映射冒称为重新编号已通过。\n\n人源亲本与该人源实验复合物比较；犬亲本同时保留起始转移姿态的对照，并在新增靶点诊断中与人源实验CD20进行跨物种比较。亲本CDR保持原始序列。" />
      </details>
      <details className="research-disclosure"><summary>查看结构来源与显示说明 <span aria-hidden="true">＋</span></summary>
        <RichNarrative id="sources:body" label="编辑来源说明" value="公共实验结构来自RCSB PDB；每份参考、输入和预测均保留哈希与来源。结构显示使用本地3Dmol.js 2.5.5，坐标和显示库随页面携带，不向外部结构服务上传。\n\n网页先按抗原将模型放入共同坐标框架；拖动只改变相机视角。显示用PDB序列化误差不超过0.000501 Å，科学分析保留原CIF坐标。" />
        <details className="research-license"><summary>显示库许可</summary><pre>{scenes.license}</pre></details>
      </details>
      <p className="research-teaching-navigation"><a href="./teaching.html">打开同步更新的教学页：从抗体结构、编号算法到本轮设计流程 →</a></p>
      <footer className="research-footer"><span>犬CD20抗体设计 · 科研结果展示</span><span>编号复现 / 独立参考设计 / 多模型复核</span><span data-reviewed-rows>预测数据截止：{study.cutoffBeijing} · 北京时间{snapshot.explanation?.reanalysisAtBeijing ? `；本地诊断更新：${snapshot.explanation.reanalysisAtBeijing}` : ''}</span></footer>
    </section>
  </article>;
}
