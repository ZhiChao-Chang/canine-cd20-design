import React, { useCallback, useEffect, useRef, useState } from 'react';
import './section-bubble-nav.css';
import { reportChapters, chapterForId } from './report-chapters.js';

const chapters = reportChapters.map(chapter => [chapter.id, chapter.label]);

function revealSection(id) {
  const element = document.getElementById(id);
  if (!element) return null;
  // Open the numbering branch before measuring its destination.
  let parent = element;
  while (parent) {
    if (parent.tagName === 'DETAILS') parent.open = true;
    parent = parent.parentElement;
  }
  return element;
}

export function SectionBubbleNav() {
  const [active, setActive] = useState('overview');
  const [open, setOpen] = useState(false);
  const root = useRef(null);
  const raf = useRef(0);

  const updateCurrent = useCallback(() => {
    raf.current = 0;
    const threshold = Math.min(170, window.innerHeight * 0.25);
    let current = chapters[0][0];
    for (const [id] of chapters) {
      const target = document.getElementById(id);
      if (target && target.getBoundingClientRect().top <= threshold) current = id;
    }
    setActive(current);
  }, []);

  useEffect(() => {
    const schedule = () => {
      if (!raf.current) raf.current = requestAnimationFrame(updateCurrent);
    };
    const onLocation = () => {
      const id = location.hash.slice(1);
      if (chapters.some(([key]) => key === id)) {
        const target = revealSection(id);
        if (target) target.scrollIntoView({ behavior: 'auto', block: 'start' });
      }
      schedule();
    };
    const close = event => {
      if (event.key === 'Escape' || (event.type === 'pointerdown' && !root.current?.contains(event.target))) setOpen(false);
    };
    window.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', schedule);
    window.addEventListener('popstate', onLocation);
    window.addEventListener('hashchange', onLocation);
    document.addEventListener('toggle', schedule, true);
    document.addEventListener('keydown', close);
    document.addEventListener('pointerdown', close);
    // Respect a shared section URL, including the collapsed numbering branch.
    onLocation();
    return () => {
      cancelAnimationFrame(raf.current);
      window.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', schedule);
      window.removeEventListener('popstate', onLocation);
      window.removeEventListener('hashchange', onLocation);
      document.removeEventListener('toggle', schedule, true);
      document.removeEventListener('keydown', close);
      document.removeEventListener('pointerdown', close);
    };
  }, [updateCurrent]);

  function jump(event, id) {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    const target = revealSection(id);
    if (!target) return;
    if (location.hash !== '#' + id) history.pushState(null, '', '#' + id);
    setActive(id);
    setOpen(false);
    target.scrollIntoView({
      behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
      block: 'start',
    });
  }

  return <nav ref={root} className="research-bubble-nav" aria-label="右侧章节导航" data-open={open}>
    <button className="research-bubble-toggle" type="button" aria-controls="research-bubble-menu"
      aria-expanded={open} aria-label={open ? '收起章节导航' : '打开章节导航'} onClick={() => setOpen(value => !value)}>
      <span aria-hidden="true">{open ? '×' : '☰'}</span>章节
    </button>
    <div id="research-bubble-menu" className="research-bubble-menu">
      <span className="research-bubble-caption">章节导航</span>
      {chapters.map(([id, label]) => <a key={id} href={'#' + id} className="research-bubble-link" aria-label={label}
        aria-current={active === id ? 'location' : undefined} onClick={event => jump(event, id)}>{chapterForId(id)?.number && <span className="research-bubble-index" aria-hidden="true">{chapterForId(id).number}</span>}<span>{label}</span></a>)}
    </div>
  </nav>;
}
