import { Download, FileText, Printer, Share2 } from 'lucide-react';
import { useMemo } from 'react';
import { isNative } from '../lib/native';
import { downloadReport, printReport, reportBodyHtml, shareReport } from '../lib/reportHtml';
import type { Report } from '../lib/store';

export function ReportCard({ report }: { report: Report }) {
  const html = useMemo(() => reportBodyHtml(report), [report]);
  return (
    <article className="report-card">
      <header className="report-bar">
        <span className="report-tag">
          <FileText size={16} aria-hidden /> Report
        </span>
        <span className="spacer" />
        {isNative ? (
          <button className="ghost sm" onClick={() => shareReport(report).catch(() => {})}>
            <Share2 size={16} aria-hidden /> Share / save
          </button>
        ) : (
          <>
            <button className="ghost sm" onClick={() => printReport(report)}>
              <Printer size={16} aria-hidden /> Print / PDF
            </button>
            <button className="ghost sm" onClick={() => downloadReport(report)}>
              <Download size={16} aria-hidden /> Download
            </button>
          </>
        )}
      </header>
      <div className="report-body" dangerouslySetInnerHTML={{ __html: html }} />
    </article>
  );
}
