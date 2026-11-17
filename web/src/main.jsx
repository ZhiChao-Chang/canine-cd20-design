import React from 'react';
import { createRoot } from 'react-dom/client';
import snapshot from './data.json';
import { ProjectProvider } from './project-ui.jsx';
import { ReportContent } from './content/report/ReportContent.jsx';
import './theme.css';
import './project-ui.css';
import './content/report/report.css';
createRoot(document.getElementById('root')).render(<ProjectProvider snapshot={snapshot}><main className="report-page"><ReportContent /></main></ProjectProvider>);
