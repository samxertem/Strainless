import { Marked } from 'marked';
import { markedHighlight } from 'marked-highlight';
import hljs from 'highlight.js/lib/common';
import DOMPurify from 'dompurify';

const marked = new Marked(
  markedHighlight({
    emptyLangClass: 'hljs',
    langPrefix: 'hljs language-',
    highlight(code, lang) {
      // highlight.js returns escaped HTML with <span class="hljs-…"> tokens.
      const language = hljs.getLanguage(lang) ? lang : 'plaintext';
      return hljs.highlight(code, { language }).value;
    },
  }),
  { gfm: true, breaks: true },
);

/**
 * Images pasted into course notes are referenced as `strainless-file:course_file/<id>`.
 * DOMPurify would drop that unknown URL scheme, so it's turned into a same-page
 * fragment (#course-file-12) that the preview swaps for the real image URL.
 */
export const courseImageRef = (id: number) => `strainless-file:course_file/${id}`;
const IMAGE_REF = /\(strainless-file:course_file\/(\d+)\)/g;
export const COURSE_IMAGE_PREFIX = '#course-file-';

/** Markdown → sanitized HTML, with syntax-highlighted code blocks. */
export function renderMarkdown(source: string): string {
  const html = marked.parse(source.replace(IMAGE_REF, `(${COURSE_IMAGE_PREFIX}$1)`), { async: false }) as string;
  return DOMPurify.sanitize(html);
}
