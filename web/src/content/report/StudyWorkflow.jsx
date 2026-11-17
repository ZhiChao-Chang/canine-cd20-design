import React, { useState } from 'react';
import { DataComponent, DataTable, RichNarrative, useProjectReport } from '../../project-ui.jsx';
import './story.css';
import { ChapterHeading } from './ChapterHeading.jsx';

export function ComparisonContext({left,right,fit,measure,use}) {
  return <div className="comparison-context" aria-label="本图比较与计算口径">
    <div className="comparison-operands"><div><span>比较对象 A</span><strong>{left}</strong></div><b aria-hidden="true">↔</b><div><span>比较对象 B</span><strong>{right}</strong></div></div>
    <dl><div><dt>先叠合</dt><dd>{fit}</dd></div><div><dt>再计算</dt><dd>{measure}</dd></div><div><dt>用来回答</dt><dd>{use}</dd></div></dl>
  </div>;
}

export function RmsdFormula() {
  return <figure className="rmsd-equation">
    <math xmlns="http://www.w3.org/1998/Math/MathML" display="block" aria-label="RMSD等于N个对应原子坐标差的平方平均值的平方根">
      <mrow><mi mathvariant="normal">RMSD</mi><mo>=</mo><msqrt><mfrac><mn>1</mn><mi>N</mi></mfrac><munderover><mo>∑</mo><mrow><mi>i</mi><mo>=</mo><mn>1</mn></mrow><mi>N</mi></munderover><msup><mrow><mo>‖</mo><msub><mi mathvariant="bold">x</mi><mi>i</mi></msub><mo>−</mo><msub><mi mathvariant="bold">y</mi><mi>i</mi></msub><mo>‖</mo></mrow><mn>2</mn></msup></msqrt></mrow>
    </math>
    <figcaption>xᵢ、yᵢ：两份结构中第i个对应Cα的坐标；坐标已应用指定的叠合变换；N：参与测量的对应Cα数；单位：Å。</figcaption>
  </figure>;
}

function FlowText({id,title,body}) {
  return <RichNarrative id={id} value={`### ${title}\n\n${body}`} className="flow-copy"/>;
}

export function StudyWorkflow() {
  const {snapshot}=useProjectReport();
  const rows=snapshot.queries.generationProtocol?.rows||[];
  const [reference,setReference]=useState('6VJA');
  const current=rows.find(r=>r.reference_id===reference)||rows[0];
  const guides=[
    {n:'01',label:'准备起点',text:'犬CD20 + 人源参考Fv',href:'#target-anatomy'},
    {n:'02',label:'生成候选',text:'两条路线，分别设计CDR',href:'#design'},
    {n:'03',label:'重新预测',text:'最终序列 → 三套结构',href:'#comparison-methods'},
    {n:'04',label:'比较与筛选',text:'形状、姿态、接触与重复性',href:'#generation-verification'},
  ];
  return <section id="study-workflow" className="research-chapter workflow-chapter">
    <ChapterHeading textSuffix="lead" id="workflow" title="两条生成路线，一套复核流程" text="从已知人源CD20–抗体复合物分别出发，保留抗体框架，针对犬CD20重新设计六段CDR，再检查最终序列在不同模型下能否保持相近的构象。" />
    <nav className="story-roadmap" aria-label="CD20设计研究主线">{guides.map(g=><a key={g.n} href={g.href}><span>步骤{Number(g.n)}</span><strong>{g.label}</strong><small>{g.text}</small></a>)}</nav>
    <DataComponent id="generation-workflow" title="两个生成器的实际输入与输出" queryId="generationProtocol" kind="custom" sourceRows={rows} displayRows={current?[current]:[]}>
      <div className="generation-flow" data-reviewed-rows aria-label="共同输入分成RFD4与BoltzGen两路，合并为最终序列后交给三个预测器">
        <div className="flow-input">
          <div className="flow-step-number">共同输入</div>
          <FlowText id="workflow:input" title="四链结构 + 设计规则" body="两份犬CD20核心（46—210位）＋参考抗体VH/VL。犬单体形状取自AFDB，二聚体装配借鉴各人源实验参考。自编IMGT编号确定六段CDR，其余框架序列保留。结合区域取起点中距抗体重原子≤6 Å的胞外靶点残基。"/>
          <div className="flow-constraints"><span>靶点序列固定</span><span>框架序列保留</span><span>CDR长度固定</span><span>胞外结合区域引导</span></div>
        </div>
        <div className="flow-fork" aria-hidden="true"><span>↓</span><span>↓</span></div>
        <div className="flow-lanes">
          <div className="flow-lane rfd4-lane">
            <div className="flow-step-number">路线 A · RFD4–Proteina</div>
            <FlowText id="workflow:rfd4-input" title="结构条件下联合设计" body="输入CIF＋YAML：提供靶点与框架序列、两个独立骨架条件组和胞外热点；六段CDR开放设计。靶点二聚体为一组，VH/VL框架为另一组，保留各自内部几何，允许两组之间重新安排相对姿态。"/>
            <div className="flow-inline-arrow" aria-hidden="true">↓</div>
            <FlowText id="workflow:rfd4-output" title="新的VH/VL序列 + 设计构象" body="模型在条件约束下联合提出氨基酸序列与三维坐标。每参考生成10对候选，输出包含CD20二聚体与Fv的复合物CIF。"/>
          </div>
          <div className="flow-lane boltzgen-lane">
            <div className="flow-step-number">路线 B · BoltzGen</div>
            <FlowText id="workflow:boltz-input" title="在相同设计范围内提出结构" body="输入同一四链起点与YAML，指定六段CDR为设计区域，并提供靶点、框架结构组及胞外结合区域。采用antibody-anything协议。"/>
            <div className="flow-substep"><span>BoltzGen路线内部 · inverse_folding</span><FlowText id="workflow:mpnn" title="SolubleMPNN：骨架 → 序列" body="根据BoltzGen提出的CDR骨架选择相容的氨基酸，保留框架固定位置，得到最终VH/VL序列。"/></div>
            <FlowText id="workflow:boltz-output" title="最终VH/VL序列 + 设计骨架" body="每参考生成10对候选，保留逆折叠后的CIF。该结构用于记录设计几何；最终序列进入下方统一复预测。"/>
          </div>
        </div>
        <div className="flow-join" aria-hidden="true">↓</div>
        <div className="flow-output">
          <div className="flow-step-number">汇合 · 固定最终序列</div>
          <FlowText id="workflow:handoff" title="7个参考 × 2条路线 × 10对 = 140对候选VH/VL" body="先检查靶点序列、框架保留、链长、VH/VL配对和序列重复。然后只把最终四链序列交给AF3、Boltz-2、ESMFold2 standard：空MSA、无模板、种子42。"/>
          <div className="flow-predictors"><span>AlphaFold 3</span><span>Boltz-2</span><span>ESMFold2 standard</span></div>
          <FlowText id="workflow:evaluation" title="比较设计构象与复预测，再检查模型间一致性" body="对齐CD20后比较Fv姿态；单独对齐Fv后比较自身形状；统计胞外CDR接触与原子近接。每参考、每路线保留5条，70条候选追加种子43、44检查重复性。"/>
        </div>
      </div>
      <details className="research-disclosure"><summary>逐参考查看实际输入、CDR掩码与输出数量</summary>
        <div className="research-reference-filter"><label>输入参考<select aria-label="查看生成器输入参考" value={reference} onChange={e=>setReference(e.target.value)}>{rows.map(r=><option key={r.reference_id} value={r.reference_id}>{r.reference_id} · {r.family}</option>)}</select></label></div>
        {current&&<><DataTable searchable={false} rows={[
          {item:'四链输入长度',value:`CD20 ${current.target_core_length} × 2；VH ${current.vh_length}；VL ${current.vl_length} aa`},
          {item:'VH可设计位置（序列索引）',value:current.cdr_h.join('、')},
          {item:'VL可设计位置（序列索引）',value:current.cdr_l.join('、')},
          {item:'胞外热点数（按亚基计）',value:String(current.hotspot_count)},
          {item:'RFD4附加条件',value:'抗体CATH类别2.60.40；CDR中CYS概率设为0'},
          {item:'RFD4输出',value:`${current.rfd4_count}对VH/VL；序列＋设计构象`},
          {item:'BoltzGen输出',value:`${current.boltzgen_count}对VH/VL；逆折叠序列＋设计骨架`},
        ]} columns={[{field:'item',label:'项目'},{field:'value',label:'本轮设置'}]}/><RichNarrative id={'workflow:reference-note:'+reference} value="位置是从1开始的构建体序列索引，CDR归属由IMGT编号映射得到。两个模型分别读取rfd4.yaml和boltzgen.yaml；10条由1条试运行和9条批量输出组成。" className="research-caption"/></>}
      </details>
    </DataComponent>
  </section>;
}
