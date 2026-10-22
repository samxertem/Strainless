import * as pdfjs from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

export { pdfjs };

// Copied into public/ by scripts/copy-pdfjs-assets.mjs. Trailing slashes are required.
export const PDF_ASSETS = {
  cMapUrl: '/pdfjs/cmaps/',
  cMapPacked: true,
  standardFontDataUrl: '/pdfjs/standard_fonts/',
  wasmUrl: '/pdfjs/wasm/',
  iccUrl: '/pdfjs/iccs/',
};

/** Plain text of every page, for search. Parsing runs in the pdf.js worker. */
export async function readPdfText(data: ArrayBuffer): Promise<string[]> {
  const task = pdfjs.getDocument({ data: new Uint8Array(data), ...PDF_ASSETS });
  try {
    const doc = await task.promise;
    const pages: string[] = [];
    for (let n = 1; n <= doc.numPages; n++) {
      const page = await doc.getPage(n);
      const content = await page.getTextContent();
      pages.push(content.items.map((item) => ('str' in item ? item.str + (item.hasEOL ? '\n' : ' ') : '')).join(''));
      page.cleanup();
    }
    return pages;
  } finally {
    await task.destroy();
  }
}
