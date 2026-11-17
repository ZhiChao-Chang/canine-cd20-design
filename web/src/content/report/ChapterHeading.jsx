import React from 'react';
import { RichNarrative } from '../../project-ui.jsx';
import { chapterForHeading, chapterForId } from './report-chapters.js';
import './chapter-headings.css';

export function ChapterHeading({ id, title, text, titleSuffix = 'title', textSuffix = 'intro' }) {
  const chapter = chapterForHeading(id);
  if (!chapter) {
    // Contact-footprint analysis and expanded numbering details are subsections.
    return <header className="research-subsection-heading">
      <RichNarrative id={id + ':' + titleSuffix} value={'### ' + title} className="research-subsection-title" />
      {text && <RichNarrative id={id + ':' + textSuffix} value={text} className="research-section-description" />}
    </header>;
  }
  const name = chapter.title || chapter.label;
  return <header className="research-section-heading chapter-heading" data-chapter-id={chapter.id} data-chapter-number={chapter.number}>
    <div className="chapter-title-row">
      <span className="chapter-number">第{chapter.number}章</span>
      <RichNarrative id={id + ':chapter-name'} value={'## ' + name} className="chapter-heading-title" />
    </div>
    {title !== name && <RichNarrative id={id + ':' + titleSuffix} value={title} className="chapter-topic" />}
    {text && <RichNarrative id={id + ':' + textSuffix} value={text} className="research-section-description" />}
  </header>;
}

export function NumberingChapterSummary() {
  const chapter = chapterForId('numbering-branch');
  return <summary className="chapter-branch-summary" data-chapter-id={chapter.id} data-chapter-number={chapter.number}>
    <span className="chapter-number">第{chapter.number}章</span>
    <span className="chapter-summary-title">{chapter.title}</span>
    <span className="chapter-disclosure-state" aria-hidden="true"><span className="when-closed">展开 ＋</span><span className="when-open">收起 −</span></span>
  </summary>;
}
