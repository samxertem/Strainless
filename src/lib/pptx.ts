// A small, safe PowerPoint (.pptx) reader. It turns the slide XML into plain data
// (positions, text runs, image blobs); the UI renders that with React, so nothing
// from the file is ever inserted as HTML or executed.
//
// Covered: slide size, backgrounds, text boxes and placeholders (with layout/master
// inheritance), bullets and numbering, fonts/sizes/colours, theme colours, shapes
// (solid/gradient fill, outline, rect/round-rect/ellipse), pictures (incl. crop),
// groups, tables, speaker notes. Charts, SmartArt and video show as labelled boxes.

import JSZip from 'jszip';

const EMU_PER_PX = 9525; // 914400 EMU per inch / 96 px per inch

export interface Deck {
  width: number; // px
  height: number; // px
  slides: SlideModel[];
  /** Object URLs created for images; revoke when done. */
  urls: string[];
}

export interface SlideModel {
  background: string; // CSS background value
  shapes: ShapeModel[];
  notes: string;
}

export interface ShapeModel {
  x: number;
  y: number;
  w: number;
  h: number;
  rot: number;
  flipH: boolean;
  flipV: boolean;
  fill: string | null; // CSS background
  line: { color: string; width: number } | null;
  geom: 'rect' | 'roundRect' | 'ellipse';
  text: TextBody | null;
  image: ImageModel | null;
  table: TableModel | null;
  label: string | null; // for content we don't draw (charts, SmartArt…)
}

export interface ImageModel {
  url: string;
  crop: { l: number; t: number; r: number; b: number }; // fractions 0..1
}

export interface TextBody {
  anchor: 't' | 'ctr' | 'b';
  insets: [number, number, number, number]; // l t r b px
  wrap: boolean;
  vertical: boolean;
  paragraphs: Paragraph[];
}

export interface Paragraph {
  align: 'left' | 'center' | 'right' | 'justify';
  marginLeft: number; // px
  indent: number; // px (first line, usually negative for hanging bullets)
  bullet: { text: string; color: string | null; size: number } | null;
  lineHeight: number | null; // multiplier
  spaceBefore: number; // px
  spaceAfter: number; // px
  runs: Run[];
  emptySize: number; // pt, height of an empty paragraph
}

export interface Run {
  text: string;
  size: number; // pt
  bold: boolean;
  italic: boolean;
  underline: boolean;
  strike: boolean;
  color: string;
  font: string;
  baseline: number; // percent, for super/subscript
  lineBreak: boolean;
}

export interface TableModel {
  columns: number[]; // px widths
  rows: { height: number; cells: TableCell[] }[];
}

export interface TableCell {
  text: TextBody;
  fill: string | null;
  colSpan: number;
  rowSpan: number;
  merged: boolean; // covered by another cell's span
}

// ---------- XML helpers (namespace-agnostic: match on local names) ----------

const kids = (el: Element | null | undefined, name?: string): Element[] =>
  el ? Array.from(el.children).filter((c) => !name || c.localName === name) : [];
const kid = (el: Element | null | undefined, name: string): Element | null => kids(el, name)[0] ?? null;
const path = (el: Element | null | undefined, ...names: string[]): Element | null =>
  names.reduce<Element | null>((cur, n) => kid(cur, n), el ?? null);
const num = (el: Element | null | undefined, attr: string): number | null => {
  const v = el?.getAttribute(attr);
  return v == null || v === '' ? null : Number(v);
};
const flag = (el: Element | null | undefined, attr: string): boolean | null => {
  const v = el?.getAttribute(attr);
  return v == null ? null : v === '1' || v === 'true';
};
const parseXml = (xml: string) => new DOMParser().parseFromString(xml, 'application/xml').documentElement;

function resolvePath(base: string, target: string): string {
  if (target.startsWith('/')) return target.slice(1);
  const parts = base.split('/').slice(0, -1);
  for (const seg of target.split('/')) {
    if (seg === '..') parts.pop();
    else if (seg !== '.') parts.push(seg);
  }
  return parts.join('/');
}

const relsPathFor = (part: string) => {
  const i = part.lastIndexOf('/');
  return `${part.slice(0, i)}/_rels/${part.slice(i + 1)}.rels`;
};

interface Rel {
  target: string;
  type: string;
  external: boolean;
}

// ---------- colours ----------

type Theme = { colors: Record<string, string>; majorFont: string; minorFont: string };
type ColorMap = Record<string, string>;

const PRESET: Record<string, string> = {
  black: '000000', white: 'FFFFFF', red: 'FF0000', green: '008000', blue: '0000FF', yellow: 'FFFF00',
  gray: '808080', grey: '808080', darkGray: 'A9A9A9', lightGray: 'D3D3D3', orange: 'FFA500', navy: '000080',
};

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(0, 6), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function rgbToHsl([r, g, b]: [number, number, number]): [number, number, number] {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h / 6, s, l];
}

function hslToRgb([h, s, l]: [number, number, number]): [number, number, number] {
  if (s === 0) return [l * 255, l * 255, l * 255];
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const f = (t: number) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  return [f(h + 1 / 3) * 255, f(h) * 255, f(h - 1 / 3) * 255];
}

class Ctx {
  constructor(
    public zip: JSZip,
    public theme: Theme,
    public colorMap: ColorMap,
    public urls: string[],
    public mediaCache: Map<string, Promise<string | null>>,
  ) {}

  /** A colour element's parent (solidFill, buClr…) → CSS colour, or null. */
  color(parent: Element | null | undefined): string | null {
    const el = kids(parent).find((c) => ['srgbClr', 'schemeClr', 'sysClr', 'prstClr', 'scrgbClr'].includes(c.localName));
    if (!el) return null;
    let hex: string | null = null;
    if (el.localName === 'srgbClr') hex = el.getAttribute('val');
    else if (el.localName === 'sysClr') hex = el.getAttribute('lastClr') ?? (el.getAttribute('val') === 'window' ? 'FFFFFF' : '000000');
    else if (el.localName === 'prstClr') hex = PRESET[el.getAttribute('val') ?? ''] ?? '000000';
    else if (el.localName === 'scrgbClr') {
      const c = (a: string) => Math.round(Math.min(1, (num(el, a) ?? 0) / 100000) * 255).toString(16).padStart(2, '0');
      hex = c('r') + c('g') + c('b');
    } else {
      const name = el.getAttribute('val') ?? '';
      const mapped = this.colorMap[name] ?? name;
      hex = this.theme.colors[mapped] ?? this.theme.colors[name] ?? null;
    }
    if (!hex) return null;

    let rgb = hexToRgb(hex);
    let alpha = 1;
    const mods = kids(el);
    const lumMod = mods.find((m) => m.localName === 'lumMod');
    const lumOff = mods.find((m) => m.localName === 'lumOff');
    if (lumMod || lumOff) {
      const hsl = rgbToHsl(rgb);
      hsl[2] = Math.min(1, Math.max(0, hsl[2] * ((num(lumMod, 'val') ?? 100000) / 100000) + (num(lumOff, 'val') ?? 0) / 100000));
      rgb = hslToRgb(hsl);
    }
    for (const m of mods) {
      const v = (num(m, 'val') ?? 100000) / 100000;
      if (m.localName === 'tint') rgb = rgb.map((c) => c + (255 - c) * (1 - v)) as typeof rgb;
      if (m.localName === 'shade') rgb = rgb.map((c) => c * v) as typeof rgb;
      if (m.localName === 'alpha') alpha = v;
    }
    const [r, g, b] = rgb.map((c) => Math.round(c));
    return alpha < 1 ? `rgba(${r}, ${g}, ${b}, ${alpha})` : `rgb(${r}, ${g}, ${b})`;
  }

  /** An spPr / bgPr / tcPr element → CSS background, or null (no fill info), or 'none'. */
  async fill(props: Element | null | undefined, rels: Map<string, Rel>, partPath: string): Promise<string | null> {
    if (!props) return null;
    if (kid(props, 'noFill')) return 'none';
    const solid = kid(props, 'solidFill');
    if (solid) return this.color(solid);
    const grad = kid(props, 'gradFill');
    if (grad) {
      const stops = kids(path(grad, 'gsLst'), 'gs')
        .map((gs) => ({ pos: (num(gs, 'pos') ?? 0) / 1000, color: this.color(gs) }))
        .filter((s) => s.color);
      if (stops.length === 0) return null;
      const angle = (num(kid(grad, 'lin'), 'ang') ?? 0) / 60000;
      return `linear-gradient(${90 + angle}deg, ${stops.map((s) => `${s.color} ${s.pos}%`).join(', ')})`;
    }
    const blip = path(props, 'blipFill', 'blip');
    if (blip) {
      const url = await this.media(blip, rels, partPath);
      return url ? `center / cover no-repeat url("${url}")` : null;
    }
    return null;
  }

  /** a:blip r:embed → object URL for the image, or null if missing/unsupported. */
  media(blip: Element, rels: Map<string, Rel>, partPath: string): Promise<string | null> {
    const id = blip.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'embed')
      ?? blip.getAttribute('r:embed');
    const rel = id ? rels.get(id) : undefined;
    if (!rel || rel.external) return Promise.resolve(null);
    const target = resolvePath(partPath, rel.target);
    const cached = this.mediaCache.get(target);
    if (cached) return cached;
    const promise = (async () => {
      const ext = target.split('.').pop()?.toLowerCase() ?? '';
      const type = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', bmp: 'image/bmp', webp: 'image/webp', svg: 'image/svg+xml' }[ext];
      const file = this.zip.file(target);
      if (!type || !file) return null; // EMF/WMF/TIFF: browsers can't draw them
      // An <img> never runs scripts, even for SVG, so object URLs are safe here.
      const url = URL.createObjectURL(new Blob([await file.async('arraybuffer')], { type }));
      this.urls.push(url);
      return url;
    })();
    this.mediaCache.set(target, promise);
    return promise;
  }
}

// ---------- text style inheritance ----------

/** Where text defaults come from, most specific first: shape, layout, master placeholder, master text styles. */
type StyleChain = (Element | null)[];

const lvlProps = (lstStyle: Element | null, level: number) => kid(lstStyle, `lvl${level + 1}pPr`);

function pick<T>(chain: StyleChain, level: number, get: (lvl: Element) => T | null): T | null {
  for (const lst of chain) {
    const lvl = lvlProps(lst, level);
    const v = lvl ? get(lvl) : null;
    if (v !== null && v !== undefined) return v;
  }
  return null;
}

// ---------- shapes ----------

interface Xfrm { x: number; y: number; w: number; h: number; rot: number; flipH: boolean; flipV: boolean }

function readXfrm(el: Element | null): Xfrm | null {
  if (!el) return null;
  const off = kid(el, 'off');
  const ext = kid(el, 'ext');
  if (!off || !ext) return null;
  return {
    x: (num(off, 'x') ?? 0) / EMU_PER_PX,
    y: (num(off, 'y') ?? 0) / EMU_PER_PX,
    w: (num(ext, 'cx') ?? 0) / EMU_PER_PX,
    h: (num(ext, 'cy') ?? 0) / EMU_PER_PX,
    rot: (num(el, 'rot') ?? 0) / 60000,
    flipH: flag(el, 'flipH') ?? false,
    flipV: flag(el, 'flipV') ?? false,
  };
}

/** Maps child coordinates of a group into slide coordinates. */
type Transform = (x: Xfrm) => Xfrm;
const identity: Transform = (x) => x;

interface Placeholder { type: string; idx: string | null }

function placeholderOf(sp: Element): Placeholder | null {
  const ph = kids(sp).map((c) => path(c, 'nvPr', 'ph')).find(Boolean);
  if (!ph) return null;
  return { type: ph.getAttribute('type') ?? 'obj', idx: ph.getAttribute('idx') };
}

/** Finds the matching placeholder shape on a layout or master. */
function matchPlaceholder(tree: Element | null, ph: Placeholder, byIdx: boolean): Element | null {
  if (!tree) return null;
  const candidates = kids(tree).filter((c) => c.localName === 'sp');
  const norm = (t: string) => (t === 'ctrTitle' ? 'title' : t === 'subTitle' || t === 'obj' ? 'body' : t);
  if (byIdx && ph.idx !== null) {
    const hit = candidates.find((c) => placeholderOf(c)?.idx === ph.idx);
    if (hit) return hit;
  }
  return candidates.find((c) => {
    const other = placeholderOf(c);
    return other && norm(other.type) === norm(ph.type);
  }) ?? null;
}

interface Part {
  path: string;
  root: Element;
  tree: Element | null; // p:cSld/p:spTree
  rels: Map<string, Rel>;
}

async function loadPart(zip: JSZip, partPath: string): Promise<Part | null> {
  const file = zip.file(partPath);
  if (!file) return null;
  const root = parseXml(await file.async('string'));
  const rels = new Map<string, Rel>();
  const relsFile = zip.file(relsPathFor(partPath));
  if (relsFile) {
    for (const r of kids(parseXml(await relsFile.async('string')), 'Relationship')) {
      rels.set(r.getAttribute('Id') ?? '', {
        target: r.getAttribute('Target') ?? '',
        type: r.getAttribute('Type') ?? '',
        external: r.getAttribute('TargetMode') === 'External',
      });
    }
  }
  return { path: partPath, root, tree: path(root, 'cSld', 'spTree'), rels };
}

const relOfType = (part: Part, suffix: string) => [...part.rels.values()].find((r) => r.type.endsWith(suffix));

interface SlideParts {
  slide: Part;
  layout: Part | null;
  master: Part | null;
}

async function readTextBody(
  ctx: Ctx, txBody: Element | null, chain: StyleChain, inherited: { bodyPr: Element | null }[],
  defaults: { color: string; font: string },
): Promise<TextBody | null> {
  if (!txBody) return null;
  const bodyPrs = [kid(txBody, 'bodyPr'), ...inherited.map((i) => i.bodyPr)];
  const bp = <T,>(get: (b: Element) => T | null): T | null => {
    for (const b of bodyPrs) {
      const v = b ? get(b) : null;
      if (v !== null && v !== undefined) return v;
    }
    return null;
  };
  const autofit = path(txBody, 'bodyPr', 'normAutofit');
  const fontScale = (num(autofit, 'fontScale') ?? 100000) / 100000;
  const spacingReduction = (num(autofit, 'lnSpcReduction') ?? 0) / 100000;
  const shapeChain: StyleChain = [kid(txBody, 'lstStyle'), ...chain];

  const resolveFont = (typeface: string | null) => {
    if (!typeface) return defaults.font;
    if (typeface.startsWith('+mj')) return ctx.theme.majorFont;
    if (typeface.startsWith('+mn')) return ctx.theme.minorFont;
    return typeface;
  };

  const paragraphs: Paragraph[] = [];
  const autoNumbers = new Map<number, number>(); // level → current number

  for (const p of kids(txBody, 'p')) {
    const pPr = kid(p, 'pPr');
    const level = num(pPr, 'lvl') ?? 0;
    /** A paragraph property: the paragraph's own pPr first, then the style chain for its level. */
    const prop = <V,>(get: (el: Element) => V | null): V | null => (pPr ? get(pPr) : null) ?? pick(shapeChain, level, get);
    /** A default run property (defRPr) along the same chain. */
    const defRun = <V,>(get: (el: Element) => V | null): V | null =>
      prop((el) => {
        const d = kid(el, 'defRPr');
        return d ? get(d) : null;
      });
    const baseSize = (defRun((d) => num(d, 'sz')) ?? 1800) / 100;

    const runs: Run[] = [];
    for (const r of kids(p)) {
      if (r.localName === 'br') {
        runs.push({ ...emptyRun(baseSize * fontScale, defaults), lineBreak: true });
        continue;
      }
      if (r.localName !== 'r' && r.localName !== 'fld') continue;
      const rPr = kid(r, 'rPr');
      const from = <V,>(get: (el: Element) => V | null): V | null => (rPr ? get(rPr) : null) ?? defRun(get);
      const size = ((from((el) => num(el, 'sz')) ?? baseSize * 100) / 100) * fontScale;
      const colorEl = from((el) => kid(el, 'solidFill'));
      runs.push({
        text: kid(r, 't')?.textContent ?? '',
        size,
        bold: from((el) => flag(el, 'b')) ?? false,
        italic: from((el) => flag(el, 'i')) ?? false,
        underline: (from((el) => el.getAttribute('u')) ?? 'none') !== 'none',
        strike: (from((el) => el.getAttribute('strike')) ?? 'noStrike') !== 'noStrike',
        color: ctx.color(colorEl) ?? defaults.color,
        font: resolveFont(from((el) => kid(el, 'latin')?.getAttribute('typeface') ?? null)),
        baseline: (from((el) => num(el, 'baseline')) ?? 0) / 1000,
        lineBreak: false,
      });
    }

    // Bullets: whichever of none / character / numbering is set nearest to the paragraph wins.
    let bullet: Paragraph['bullet'] = null;
    const hasText = runs.some((r) => r.text.trim());
    const bulletEl = prop((el) => kids(el).find((c) => ['buNone', 'buChar', 'buAutoNum'].includes(c.localName)) ?? null);
    const kind = bulletEl?.localName ?? 'buNone';
    if (hasText && kind !== 'buNone') {
      const color = ctx.color(prop((el) => kid(el, 'buClr'))) ?? runs[0]?.color ?? defaults.color;
      const sizePct = (prop((el) => num(kid(el, 'buSzPct'), 'val')) ?? 100000) / 100000;
      if (kind === 'buAutoNum') {
        const start = num(bulletEl, 'startAt') ?? 1;
        const n = (autoNumbers.get(level) ?? start - 1) + 1;
        autoNumbers.set(level, n);
        bullet = { text: formatAutoNumber(bulletEl!.getAttribute('type') ?? 'arabicPeriod', n), color, size: sizePct };
      } else {
        bullet = { text: normaliseBulletChar(bulletEl!.getAttribute('char') ?? '•'), color, size: sizePct };
      }
    }
    if (kind !== 'buAutoNum') autoNumbers.delete(level);

    const lnPct = prop((el) => num(path(el, 'lnSpc', 'spcPct'), 'val'));
    const spcBef = prop((el) => num(path(el, 'spcBef', 'spcPts'), 'val'));
    const spcAft = prop((el) => num(path(el, 'spcAft', 'spcPts'), 'val'));
    const algn = prop((el) => el.getAttribute('algn'));

    paragraphs.push({
      align: algn === 'ctr' ? 'center' : algn === 'r' ? 'right' : algn === 'just' ? 'justify' : 'left',
      marginLeft: (prop((el) => num(el, 'marL')) ?? 0) / EMU_PER_PX,
      indent: (prop((el) => num(el, 'indent')) ?? 0) / EMU_PER_PX,
      bullet,
      lineHeight: lnPct !== null ? Math.max(0.6, (lnPct / 100000) * (1 - spacingReduction)) : null,
      spaceBefore: ((spcBef ?? 0) / 100) * (4 / 3),
      spaceAfter: ((spcAft ?? 0) / 100) * (4 / 3),
      runs,
      emptySize: ((num(kid(p, 'endParaRPr'), 'sz') ?? baseSize * 100) / 100) * fontScale,
    });
  }

  const inset = (attr: string, fallback: number) => (bp((b) => num(b, attr)) ?? fallback) / EMU_PER_PX;
  const anchor = bp((b) => b.getAttribute('anchor'));
  return {
    anchor: anchor === 'ctr' ? 'ctr' : anchor === 'b' ? 'b' : 't',
    insets: [inset('lIns', 91440), inset('tIns', 45720), inset('rIns', 91440), inset('bIns', 45720)],
    wrap: bp((b) => b.getAttribute('wrap')) !== 'none',
    vertical: (bp((b) => b.getAttribute('vert')) ?? 'horz').startsWith('vert'),
    paragraphs,
  };
}

const emptyRun = (size: number, d: { color: string; font: string }): Run => ({
  text: '', size, bold: false, italic: false, underline: false, strike: false, color: d.color, font: d.font, baseline: 0, lineBreak: false,
});

function normaliseBulletChar(c: string): string {
  // Wingdings/Symbol private-use bullets → readable equivalents.
  const map: Record<string, string> = { '': '▪', '': '•', '': '➢', '': '✓', '': '❖', '§': '▪', 'Ø': '➢', 'ü': '✓', 'q': '❑', 'n': '■', 'l': '●', 'Ÿ': '•' };
  return map[c] ?? c;
}

function formatAutoNumber(type: string, n: number): string {
  const alpha = (k: number) => {
    let s = '';
    for (; k > 0; k = Math.floor((k - 1) / 26)) s = String.fromCharCode(97 + ((k - 1) % 26)) + s;
    return s;
  };
  const roman = (k: number) => {
    const t: [number, string][] = [[1000, 'm'], [900, 'cm'], [500, 'd'], [400, 'cd'], [100, 'c'], [90, 'xc'], [50, 'l'], [40, 'xl'], [10, 'x'], [9, 'ix'], [5, 'v'], [4, 'iv'], [1, 'i']];
    let s = '';
    for (const [v, r] of t) for (; k >= v; k -= v) s += r;
    return s;
  };
  const body = type.startsWith('alphaLc') ? alpha(n) : type.startsWith('alphaUc') ? alpha(n).toUpperCase()
    : type.startsWith('romanLc') ? roman(n) : type.startsWith('romanUc') ? roman(n).toUpperCase() : String(n);
  return type.endsWith('ParenBoth') ? `(${body})` : type.endsWith('ParenR') ? `${body})` : type.endsWith('Plain') ? body : `${body}.`;
}

async function readShapes(
  ctx: Ctx, tree: Element | null, part: Part, parts: SlideParts, transform: Transform,
  options: { skipPlaceholders: boolean },
): Promise<ShapeModel[]> {
  const out: ShapeModel[] = [];
  for (const el of kids(tree)) {
    switch (el.localName) {
      case 'sp':
        if (options.skipPlaceholders && placeholderOf(el)) break;
        out.push(...(await readSp(ctx, el, part, parts, transform)));
        break;
      case 'pic':
        out.push(...(await readPic(ctx, el, part, transform)));
        break;
      case 'grpSp': {
        const x = path(el, 'grpSpPr', 'xfrm');
        const off = readXfrm(x);
        const chOff = kid(x, 'chOff');
        const chExt = kid(x, 'chExt');
        let inner = transform;
        if (off && chOff && chExt) {
          const cx = (num(chOff, 'x') ?? 0) / EMU_PER_PX;
          const cy = (num(chOff, 'y') ?? 0) / EMU_PER_PX;
          const sx = off.w / Math.max(1, (num(chExt, 'cx') ?? 1) / EMU_PER_PX);
          const sy = off.h / Math.max(1, (num(chExt, 'cy') ?? 1) / EMU_PER_PX);
          inner = (c) => transform({ ...c, x: off.x + (c.x - cx) * sx, y: off.y + (c.y - cy) * sy, w: c.w * sx, h: c.h * sy });
        }
        out.push(...(await readShapes(ctx, el, part, parts, inner, options)));
        break;
      }
      case 'graphicFrame':
        out.push(...(await readGraphicFrame(ctx, el, transform, parts)));
        break;
      case 'AlternateContent': {
        // Newer content with a fallback for older readers: use the fallback.
        const fallback = kid(el, 'Fallback');
        if (fallback) out.push(...(await readShapes(ctx, fallback, part, parts, transform, options)));
        break;
      }
    }
  }
  return out;
}

const baseShape = (x: Xfrm): ShapeModel => ({
  ...x, fill: null, line: null, geom: 'rect', text: null, image: null, table: null, label: null,
});

async function readSp(ctx: Ctx, sp: Element, part: Part, parts: SlideParts, transform: Transform): Promise<ShapeModel[]> {
  const ph = placeholderOf(sp);
  const layoutPh = ph && part === parts.slide ? matchPlaceholder(parts.layout?.tree ?? null, ph, true) : null;
  const masterPh = ph ? matchPlaceholder(parts.master?.tree ?? null, ph, false) : null;
  const spPr = kid(sp, 'spPr');

  const xfrm = readXfrm(kid(spPr, 'xfrm')) ?? readXfrm(path(layoutPh, 'spPr', 'xfrm')) ?? readXfrm(path(masterPh, 'spPr', 'xfrm'));
  if (!xfrm) return [];
  const shape = baseShape(transform(xfrm));

  const geom = path(spPr, 'prstGeom')?.getAttribute('prst');
  shape.geom = geom === 'ellipse' ? 'ellipse' : geom === 'roundRect' ? 'roundRect' : 'rect';

  // Fill and outline: explicit, else the shape style's theme references.
  const style = kid(sp, 'style');
  const fill = await ctx.fill(spPr, part.rels, part.path);
  if (fill && fill !== 'none') shape.fill = fill;
  else if (fill === null && style && (num(kid(style, 'fillRef'), 'idx') ?? 0) > 0) shape.fill = ctx.color(kid(style, 'fillRef'));
  const ln = kid(spPr, 'ln');
  if (ln && !kid(ln, 'noFill')) {
    const color = ctx.color(kid(ln, 'solidFill')) ?? (style ? ctx.color(kid(style, 'lnRef')) : null);
    if (color) shape.line = { color, width: Math.max(1, (num(ln, 'w') ?? 12700) / EMU_PER_PX) };
  } else if (!ln && style && (num(kid(style, 'lnRef'), 'idx') ?? 0) > 0 && !ph) {
    const color = ctx.color(kid(style, 'lnRef'));
    if (color) shape.line = { color, width: 1 };
  }

  // Text, with inheritance: shape → layout placeholder → master placeholder → master text styles.
  const txStyles = path(parts.master?.root, 'txStyles');
  const type = ph?.type ?? null;
  const masterStyle = type === 'title' || type === 'ctrTitle' ? kid(txStyles, 'titleStyle')
    : type && !['dt', 'ftr', 'sldNum'].includes(type) ? kid(txStyles, 'bodyStyle') : kid(txStyles, 'otherStyle');
  const chain: StyleChain = [path(layoutPh, 'txBody', 'lstStyle'), path(masterPh, 'txBody', 'lstStyle'), masterStyle];
  const fontRefColor = style ? ctx.color(kid(style, 'fontRef')) : null;
  const isTitle = type === 'title' || type === 'ctrTitle';
  shape.text = await readTextBody(
    ctx, kid(sp, 'txBody'), chain,
    [{ bodyPr: path(layoutPh, 'txBody', 'bodyPr') }, { bodyPr: path(masterPh, 'txBody', 'bodyPr') }],
    { color: fontRefColor ?? ctx.color(colorRef('tx1')) ?? 'rgb(0, 0, 0)', font: isTitle ? ctx.theme.majorFont : ctx.theme.minorFont },
  );
  return [shape];
}

/** A fake <a:schemeClr val="…"/> parent, to resolve theme colours by name. */
function colorRef(name: string): Element {
  const doc = document.implementation.createDocument(null, 'x');
  const el = doc.createElement('schemeClr');
  el.setAttribute('val', name);
  doc.documentElement.appendChild(el);
  return doc.documentElement;
}

async function readPic(ctx: Ctx, pic: Element, part: Part, transform: Transform): Promise<ShapeModel[]> {
  const xfrm = readXfrm(path(pic, 'spPr', 'xfrm'));
  if (!xfrm) return [];
  const shape = baseShape(transform(xfrm));
  const blipFill = kid(pic, 'blipFill');
  const blip = kid(blipFill, 'blip');
  const url = blip ? await ctx.media(blip, part.rels, part.path) : null;
  if (url) {
    const src = kid(blipFill, 'srcRect');
    const f = (a: string) => Math.max(0, (num(src, a) ?? 0) / 100000);
    shape.image = { url, crop: { l: f('l'), t: f('t'), r: f('r'), b: f('b') } };
  } else {
    const isVideo = path(pic, 'nvPicPr', 'nvPr', 'videoFile') || path(pic, 'nvPicPr', 'nvPr', 'extLst');
    shape.label = isVideo ? 'Video' : 'Image (format not shown)';
  }
  return [shape];
}

async function readGraphicFrame(ctx: Ctx, frame: Element, transform: Transform, parts: SlideParts): Promise<ShapeModel[]> {
  const xfrm = readXfrm(kid(frame, 'xfrm'));
  if (!xfrm) return [];
  const shape = baseShape(transform(xfrm));
  const data = path(frame, 'graphic', 'graphicData');
  const uri = data?.getAttribute('uri') ?? '';
  const tbl = kid(data, 'tbl');
  if (tbl) {
    const columns = kids(kid(tbl, 'tblGrid'), 'gridCol').map((c) => (num(c, 'w') ?? 0) / EMU_PER_PX);
    const otherStyle = path(parts.master?.root, 'txStyles', 'otherStyle');
    const rows: TableModel['rows'] = [];
    for (const tr of kids(tbl, 'tr')) {
      const cells: TableCell[] = [];
      for (const tc of kids(tr, 'tc')) {
        const text = (await readTextBody(ctx, kid(tc, 'txBody'), [otherStyle], [], {
          color: ctx.color(colorRef('tx1')) ?? 'rgb(0, 0, 0)', font: ctx.theme.minorFont,
        })) ?? { anchor: 't', insets: [6, 4, 6, 4], wrap: true, vertical: false, paragraphs: [] };
        const fill = await ctx.fill(kid(tc, 'tcPr'), new Map(), '');
        cells.push({
          text,
          fill: fill === 'none' ? null : fill,
          colSpan: num(tc, 'gridSpan') ?? 1,
          rowSpan: num(tc, 'rowSpan') ?? 1,
          merged: flag(tc, 'hMerge') === true || flag(tc, 'vMerge') === true,
        });
      }
      rows.push({ height: (num(tr, 'h') ?? 0) / EMU_PER_PX, cells });
    }
    shape.table = { columns, rows };
  } else {
    shape.label = uri.includes('chart') ? 'Chart' : uri.includes('diagram') ? 'Diagram (SmartArt)' : uri.includes('ole') ? 'Embedded object' : 'Content';
  }
  return [shape];
}

async function readBackground(ctx: Ctx, parts: Part[]): Promise<string> {
  for (const part of parts) {
    const bg = path(part.root, 'cSld', 'bg');
    if (!bg) continue;
    const bgPr = kid(bg, 'bgPr');
    if (bgPr) {
      const fill = await ctx.fill(bgPr, part.rels, part.path);
      if (fill && fill !== 'none') return fill;
    }
    const ref = kid(bg, 'bgRef');
    if (ref) {
      const color = ctx.color(ref);
      if (color) return color;
    }
  }
  return ctx.color(colorRef('bg1')) ?? 'white';
}

async function readNotes(zip: JSZip, slide: Part): Promise<string> {
  const rel = relOfType(slide, '/notesSlide');
  if (!rel) return '';
  const notes = await loadPart(zip, resolvePath(slide.path, rel.target));
  const body = kids(notes?.tree).find((sp) => placeholderOf(sp)?.type === 'body');
  return kids(kid(body, 'txBody'), 'p')
    .map((p) => Array.from(p.getElementsByTagNameNS('*', 't')).map((t) => t.textContent).join(''))
    .join('\n')
    .trim();
}

async function readTheme(zip: JSZip, master: Part | null): Promise<Theme> {
  const theme: Theme = { colors: {}, majorFont: 'Calibri Light', minorFont: 'Calibri' };
  const rel = master && relOfType(master, '/theme');
  const file = rel && zip.file(resolvePath(master.path, rel.target));
  if (!file) return theme;
  const root = parseXml(await file.async('string'));
  const elements = path(root, 'themeElements');
  for (const c of kids(path(elements, 'clrScheme'))) {
    const v = kid(c, 'srgbClr')?.getAttribute('val') ?? kid(c, 'sysClr')?.getAttribute('lastClr');
    if (v) theme.colors[c.localName] = v;
  }
  theme.majorFont = path(elements, 'fontScheme', 'majorFont', 'latin')?.getAttribute('typeface') || theme.majorFont;
  theme.minorFont = path(elements, 'fontScheme', 'minorFont', 'latin')?.getAttribute('typeface') || theme.minorFont;
  return theme;
}

/** Plain text of each slide (its own text plus speaker notes), for search. No images are decoded. */
export async function readPptxText(data: ArrayBuffer): Promise<string[]> {
  const zip = await JSZip.loadAsync(data);
  const pres = await loadPart(zip, 'ppt/presentation.xml');
  if (!pres) throw new Error('this file is not a PowerPoint presentation (.pptx)');
  const texts: string[] = [];
  for (const id of kids(path(pres.root, 'sldIdLst'), 'sldId')) {
    const rid = id.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id') ?? id.getAttribute('r:id');
    const rel = rid ? pres.rels.get(rid) : undefined;
    const slide = rel ? await loadPart(zip, resolvePath('ppt/presentation.xml', rel.target)) : null;
    if (!slide) continue;
    const paragraphs = Array.from(slide.root.getElementsByTagNameNS('*', 'p'))
      .map((p) => Array.from(p.getElementsByTagNameNS('*', 't')).map((t) => t.textContent).join(''));
    texts.push([...paragraphs, await readNotes(zip, slide)].join('\n'));
  }
  return texts;
}

/** Reads a .pptx into slide models. Throws on files that aren't PowerPoint presentations. */
export async function readPptx(data: ArrayBuffer): Promise<Deck> {
  const zip = await JSZip.loadAsync(data);
  const presFile = zip.file('ppt/presentation.xml');
  if (!presFile) throw new Error('this file is not a PowerPoint presentation (.pptx)');
  const pres = await loadPart(zip, 'ppt/presentation.xml');
  const size = path(pres!.root, 'sldSz');
  const width = (num(size, 'cx') ?? 12192000) / EMU_PER_PX;
  const height = (num(size, 'cy') ?? 6858000) / EMU_PER_PX;

  const urls: string[] = [];
  const mediaCache = new Map<string, Promise<string | null>>();
  const masters = new Map<string, Promise<{ part: Part | null; theme: Theme; colorMap: ColorMap }>>();
  const slides: SlideModel[] = [];

  for (const id of kids(path(pres!.root, 'sldIdLst'), 'sldId')) {
    const rid = id.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id') ?? id.getAttribute('r:id');
    const rel = rid ? pres!.rels.get(rid) : undefined;
    if (!rel) continue;
    const slide = await loadPart(zip, resolvePath('ppt/presentation.xml', rel.target));
    if (!slide) continue;
    const layoutRel = relOfType(slide, '/slideLayout');
    const layout = layoutRel ? await loadPart(zip, resolvePath(slide.path, layoutRel.target)) : null;
    const masterRel = layout && relOfType(layout, '/slideMaster');
    const masterPath = masterRel ? resolvePath(layout!.path, masterRel.target) : '';

    if (!masters.has(masterPath)) {
      masters.set(masterPath, (async () => {
        const part = masterPath ? await loadPart(zip, masterPath) : null;
        const theme = await readTheme(zip, part);
        const map = path(part?.root, 'clrMap');
        const colorMap: ColorMap = {};
        for (const a of Array.from(map?.attributes ?? [])) colorMap[a.name] = a.value;
        return { part, theme, colorMap };
      })());
    }
    const { part: master, theme, colorMap } = await masters.get(masterPath)!;
    const ctx = new Ctx(zip, theme, colorMap, urls, mediaCache);
    const parts: SlideParts = { slide, layout, master };

    // Decorative shapes from the master and layout sit behind the slide's own content.
    const showMaster = flag(slide.root, 'showMasterSp') !== false && flag(layout?.root, 'showMasterSp') !== false;
    const shapes: ShapeModel[] = [];
    if (showMaster && master) shapes.push(...(await readShapes(ctx, master.tree, master, parts, identity, { skipPlaceholders: true })));
    if (layout) shapes.push(...(await readShapes(ctx, layout.tree, layout, parts, identity, { skipPlaceholders: true })));
    shapes.push(...(await readShapes(ctx, slide.tree, slide, parts, identity, { skipPlaceholders: false })));

    slides.push({
      background: await readBackground(ctx, [slide, layout, master].filter((p): p is Part => !!p)),
      shapes,
      notes: await readNotes(zip, slide),
    });
  }
  return { width, height, slides, urls };
}
