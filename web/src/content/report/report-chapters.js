// Shared order for chapter headings and the floating navigation.
// The opening overview is not a numbered chapter.
export const reportChapters = [
  { id: 'overview', label: '研究概览', number: null },
  { id: 'study-workflow', label: '实验流程', number: '01', headingId: 'workflow' },
  { id: 'target-anatomy', label: '靶点参考', title: '靶点与参考', number: '02', headingId: 'target-intro' },
  { id: 'design', label: '参考设计', title: '参考与设计条件', number: '03', headingId: 'design-section' },
  { id: 'toolkit', label: '模型分工', number: '04', headingId: 'toolkit-intro' },
  { id: 'comparison-methods', label: '比较方法', number: '05', headingId: 'comparison-methods-intro' },
  { id: 'generation-verification', label: '设计复核', title: '设计构象复核', number: '06', headingId: 'generation-verification-intro' },
  { id: 'target-diagnostics', label: '靶点对照', title: '靶点结构对照', number: '07', headingId: 'target-results-intro' },
  { id: 'comparison', label: '初筛结果', number: '08', headingId: 'comparison-section' },
  { id: 'structural-diagnostics', label: '差异诊断', title: '结构差异诊断', number: '09', headingId: 'diagnostic-intro' },
  { id: 'structures', label: '候选结构', number: '10', headingId: 'structure-section' },
  { id: 'candidates', label: '候选清单', number: '11', headingId: 'candidate-section' },
  { id: 'reliability', label: '对照复核', title: '亲本对照与重复性', number: '12', headingId: 'reliability-section' },
  { id: 'numbering-branch', label: '编号工具', title: '配套编号工具', number: '13' },
  { id: 'evidence', label: '方法来源', title: '方法与来源', number: '14', headingId: 'methods-section' },
];

export function chapterForHeading(headingId) {
  return reportChapters.find(chapter => chapter.headingId === headingId);
}

export function chapterForId(id) {
  return reportChapters.find(chapter => chapter.id === id);
}
