import { Suspense, lazy, useCallback, useEffect, useState, type ReactNode } from 'react';
import { ChevronLeft, ChevronRight, ExternalLink, X } from 'lucide-react';
import { extensionOf, type PreviewFile } from '../lib/files';
import { AnnotatedViewer } from './annotate/AnnotatedViewer';

// Viewers are large; each loads the first time it's needed, not at app start.
const PdfViewer = lazy(() => import('./PdfViewer').then((m) => ({ default: m.PdfViewer })));
const DocxViewer = lazy(() => import('./DocxViewer').then((m) => ({ default: m.DocxViewer })));
const SlidesViewer = lazy(() => import('./SlidesViewer').then((m) => ({ default: m.SlidesViewer })));
const SheetViewer = lazy(() => import('./SheetViewer').then((m) => ({ default: m.SheetViewer })));

// HEIC/TIFF aren't supported by WebView2 on Windows, so they open externally.
const IMAGE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp'];
const SHEET_EXTENSIONS = ['xlsx', 'xlsm', 'xls', 'ods', 'csv'];

export type PreviewKind = 'pdf' | 'image' | 'docx' | 'slides' | 'sheet';

export function previewKind(file: { name: string; mime?: string | null }): PreviewKind | null {
  const ext = extensionOf(file.name);
  if (ext === 'pdf' || file.mime === 'application/pdf') return 'pdf';
  if (IMAGE_EXTENSIONS.includes(ext)) return 'image';
  if (ext === 'docx') return 'docx';
  if (ext === 'pptx') return 'slides';
  if (SHEET_EXTENSIONS.includes(ext)) return 'sheet';
  return null;
}

const SEGMENT_LABEL: Record<Exclude<PreviewKind, 'image'>, string> = {
  pdf: 'Page',
  docx: 'Page',
  slides: 'Slide',
  sheet: 'Sheet',
};

const OLD_FORMAT_HINT: Record<string, string> = {
  doc: 'This is an old-style Word file (.doc), which can’t be previewed here. Saved as .docx, it opens right here.',
  ppt: 'This is an old-style PowerPoint file (.ppt), which can’t be previewed here. Saved as .pptx, it opens right here.',
};

interface Props {
  files: PreviewFile[];
  index: number;
  onIndexChange: (index: number) => void;
  onClose: () => void;
  /** Scroll to this highlight once the document is open (from the Starred page). */
  initialAnnotationId?: number;
  /** Open the first file at this page/slide (0-based) and mark these words: a search result. */
  initialLocation?: number;
  findText?: string;
}

export function Preview({ files, index, onIndexChange, onClose, initialAnnotationId, initialLocation, findText }: Props) {
  const file = files[index];
  const kind = previewKind(file);
  const [error, setError] = useState<string | null>(null);
  const go = useCallback(
    (delta: number) => onIndexChange((index + delta + files.length) % files.length),
    [index, files.length, onIndexChange],
  );

  // Capture phase + stopImmediatePropagation: Escape closes only the preview, not the panel behind it.
  // Arrow keys switch files unless you're typing (e.g. a note in the highlights panel).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = (e.target as HTMLElement | null)?.closest('input, textarea, [contenteditable="true"]');
      if (e.key === 'Escape' && typing?.matches('[data-page-jump]')) (typing as HTMLElement).blur();
      else if (e.key === 'Escape') onClose();
      else if (!typing && e.key === 'ArrowLeft' && files.length > 1) go(-1);
      else if (!typing && e.key === 'ArrowRight' && files.length > 1) go(1);
      else return;
      e.preventDefault();
      e.stopImmediatePropagation();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [go, onClose, files.length]);

  const openExternally = () => file.openExternally().catch((e) => setError(String(e)));
  const loading = <p className="mt-20 text-center text-sm text-white/70">Loading…</p>;

  let viewer: ReactNode;
  switch (kind) {
    case 'pdf':
      viewer = <PdfViewer fileKey={file.ref} load={file.load} />;
      break;
    case 'docx':
      viewer = <DocxViewer fileKey={file.ref} load={file.load} />;
      break;
    case 'slides':
      viewer = <SlidesViewer fileKey={file.ref} load={file.load} />;
      break;
    case 'sheet':
      viewer = <SheetViewer fileKey={file.ref} load={file.load} />;
      break;
    case 'image':
      viewer = <ImageViewer file={file} />;
      break;
    default:
      viewer = (
        <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center text-white/80">
          <p className="max-w-md text-sm">{OLD_FORMAT_HINT[extensionOf(file.name)] ?? 'No preview for this file type.'}</p>
          <button type="button" onClick={openExternally}
            className="inline-flex items-center gap-1.5 rounded-lg bg-white/15 px-3 py-2 text-sm hover:bg-white/25">
            <ExternalLink size={14} /> Open with default app
          </button>
        </div>
      );
  }

  return (
    <div className="fixed inset-0 z-[60] flex flex-col bg-black/85 backdrop-blur-sm">
      <div className="flex items-center gap-3 px-4 py-2.5 text-white select-none">
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium">{file.name}</div>
          <div className="text-xs text-white/60">
            {files.length > 1 && <>{index + 1} of {files.length} · ← → to switch · </>}
            {kind && kind !== 'image' && 'Select text to highlight, star or copy it'}
          </div>
        </div>
        {files.length > 1 && (
          <>
            <IconButton title="Previous (←)" onClick={() => go(-1)}><ChevronLeft size={17} /></IconButton>
            <IconButton title="Next (→)" onClick={() => go(1)}><ChevronRight size={17} /></IconButton>
          </>
        )}
        <button type="button" onClick={openExternally}
          className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs hover:bg-white/15">
          <ExternalLink size={14} /> Open in app
        </button>
        <IconButton title="Close (Esc)" onClick={onClose}><X size={17} /></IconButton>
      </div>

      <div className="min-h-0 flex-1">
        <Suspense fallback={loading}>
          {kind && kind !== 'image' ? (
            <AnnotatedViewer key={file.ref} fileRef={file.ref} segmentLabel={SEGMENT_LABEL[kind]} initialAnnotationId={initialAnnotationId}
              initialLocation={index === 0 ? initialLocation : undefined} findText={index === 0 ? findText : undefined}
              ink={kind === 'pdf' || kind === 'slides'}>
              {viewer}
            </AnnotatedViewer>
          ) : (
            viewer
          )}
        </Suspense>
      </div>
      {error && <p className="pb-3 text-center text-xs text-red-300">{error}</p>}
    </div>
  );
}

function ImageViewer({ file }: { file: PreviewFile }) {
  const [url, setUrl] = useState<string | null>(null);
  const [actualSize, setActualSize] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let live = true;
    setUrl(null);
    setFailed(false);
    setActualSize(false);
    file.url().then((u) => live && setUrl(u), () => live && setFailed(true));
    return () => {
      live = false;
    };
  }, [file]);

  if (failed) return <p className="mt-20 text-center text-sm text-white/70">Couldn't load this image.</p>;
  if (!url) return null;
  return (
    // margin:auto inside a scrolling flex box centres small images without clipping large ones.
    <div className="flex h-full overflow-auto p-6">
      <img
        src={url}
        alt={file.name}
        onClick={() => setActualSize((v) => !v)}
        onError={() => setFailed(true)}
        className={`m-auto ${actualSize ? 'max-w-none cursor-zoom-out' : 'max-h-full max-w-full cursor-zoom-in object-contain'}`}
      />
    </div>
  );
}

function IconButton({ children, title, onClick }: { children: ReactNode; title: string; onClick: () => void }) {
  return (
    <button type="button" title={title} onClick={onClick} className="rounded-lg p-1.5 hover:bg-white/15">
      {children}
    </button>
  );
}
