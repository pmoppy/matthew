import DOMPurify from 'dompurify';
import { marked } from 'marked';
import { useMemo } from 'react';

marked.setOptions({ gfm: true, breaks: true });

export function mdToHtml(md: string): string {
  return DOMPurify.sanitize(marked.parse(md, { async: false }) as string);
}

export function Markdown({ text }: { text: string }) {
  const html = useMemo(() => mdToHtml(text), [text]);
  return <div className="md" dangerouslySetInnerHTML={{ __html: html }} />;
}
