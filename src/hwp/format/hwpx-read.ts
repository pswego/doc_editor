/**
 * HWPX(OWPML, ZIP+XML) 읽기 → 편집기 문서(ProseMirror JSON)
 */
import JSZip from 'jszip';
import { InlineBuilder, bytesToBase64, headingLevelFromStyleName, marksFor, mimeFromExt, paraNode, solveColumnWidths, type ParaStyle, type RunStyle } from './build';
import { DEFAULT_PAGE, hwpToMm, hwpToPx, normalizeHex, paperNameFor, type HwpDocument, type PMNode, type PageSetup } from './types';

type El = Element;

const kids = (e: El | Document): El[] => {
  const out: El[] = [];
  const nodes = e.childNodes;
  for (let i = 0; i < nodes.length; i++) if (nodes[i].nodeType === 1) out.push(nodes[i] as El);
  return out;
};
const ln = (e: El) => e.localName || e.nodeName.replace(/^.*:/, '');
const child = (e: El, name: string) => kids(e).find((c) => ln(c) === name);
const childrenNamed = (e: El, name: string) => kids(e).filter((c) => ln(c) === name);
/** 하위 전체에서 이름으로 찾기 (깊이 우선) */
function findAll(e: El | Document, name: string, out: El[] = []): El[] {
  for (const c of kids(e)) {
    if (ln(c) === name) out.push(c);
    findAll(c, name, out);
  }
  return out;
}
function findFirst(e: El, name: string): El | undefined {
  for (const c of kids(e)) {
    if (ln(c) === name) return c;
    const f = findFirst(c, name);
    if (f) return f;
  }
  return undefined;
}
const attr = (e: El | undefined, n: string) => (e ? e.getAttribute(n) : null);
const num = (e: El | undefined, n: string, d = 0) => {
  const v = attr(e, n);
  if (v == null || v === '') return d;
  const x = Number(v);
  return isFinite(x) ? x : d;
};

function parseXml(text: string): Document {
  const P = (globalThis as unknown as { DOMParser: typeof DOMParser }).DOMParser;
  return new P().parseFromString(text, 'application/xml');
}

class HwpxReader {
  fonts: string[] = [];
  chars = new Map<string, RunStyle>();
  paras = new Map<string, ParaStyle>();
  styles = new Map<string, string>();
  fills = new Map<string, string | null>();
  images = new Map<string, string>(); // manifest id → data URL
  page: PageSetup = { ...DEFAULT_PAGE };
  pageFound = false;
  warnings: string[] = [];

  header(doc: Document) {
    const root = doc.documentElement;
    const hangul = findAll(root, 'fontface').find((f) => attr(f, 'lang') === 'HANGUL');
    if (hangul) for (const f of childrenNamed(hangul, 'font')) this.fonts[num(f, 'id')] = attr(f, 'face') ?? '';

    for (const bf of findAll(root, 'borderFill')) {
      const wb = findFirst(bf, 'winBrush');
      let c = wb ? normalizeHex(attr(wb, 'faceColor')) : null;
      if (c === '#FFFFFF') c = null;
      this.fills.set(attr(bf, 'id') ?? '', c);
    }

    for (const cp of findAll(root, 'charPr')) {
      const fontRef = child(cp, 'fontRef');
      const spacing = child(cp, 'spacing');
      const ul = child(cp, 'underline');
      const so = child(cp, 'strikeout');
      const shade = attr(cp, 'shadeColor');
      let hl = shade && shade !== 'none' ? normalizeHex(shade) : null;
      if (hl === '#FFFFFF') hl = null;
      this.chars.set(attr(cp, 'id') ?? '', {
        font: this.fonts[num(fontRef, 'hangul')],
        size: num(cp, 'height', 1000) / 100,
        bold: !!child(cp, 'bold'),
        italic: !!child(cp, 'italic'),
        underline: !!ul && (attr(ul, 'type') ?? 'NONE') !== 'NONE',
        strike: !!so && (attr(so, 'shape') ?? 'NONE') !== 'NONE',
        sup: !!child(cp, 'supscript'),
        sub: !!child(cp, 'subscript'),
        color: normalizeHex(attr(cp, 'textColor')),
        highlight: hl,
        spacing: num(spacing, 'hangul') || undefined,
      });
    }

    for (const pp of findAll(root, 'paraPr')) {
      const al = attr(child(pp, 'align'), 'horizontal') ?? 'JUSTIFY';
      const align = ({ LEFT: 'left', RIGHT: 'right', CENTER: 'center', JUSTIFY: 'justify', DISTRIBUTE: 'distribute', DISTRIBUTE_SPACE: 'distribute' } as const)[al as 'LEFT'] ?? 'justify';
      // switch/case(HwpUnitChar) 는 실제 HWPUNIT, 그 외는 ×2 값
      const margin = findFirst(pp, 'margin');
      const inCase = !!margin && !!margin.parentNode && ln(margin.parentNode as El) === 'case';
      const div = inCase ? 100 : 200;
      const mv = (n: string) => {
        if (!margin) return 0;
        const el = child(margin, n);
        const v = el ? num(el, 'value') : num(margin, n);
        return Math.round((v / div) * 10) / 10;
      };
      const ls = findFirst(pp, 'lineSpacing');
      const head = child(pp, 'heading');
      const headType = attr(head, 'type');
      this.paras.set(attr(pp, 'id') ?? '', {
        align,
        left: mv('left'),
        right: mv('right'),
        indent: mv('intent') || mv('indent'),
        before: mv('prev'),
        after: mv('next'),
        lineHeight: ls && (attr(ls, 'type') ?? 'PERCENT') === 'PERCENT' ? num(ls, 'value', 160) : undefined,
        heading: headType === 'OUTLINE' ? num(head, 'level') + 1 : undefined,
      });
    }

    for (const st of findAll(root, 'style')) this.styles.set(attr(st, 'id') ?? '', attr(st, 'name') ?? '');
  }

  readPage(secPr: El) {
    if (this.pageFound) return;
    const pp = child(secPr, 'pagePr');
    if (!pp) return;
    const m = child(pp, 'margin');
    let w = num(pp, 'width', 59528);
    let h = num(pp, 'height', 84186);
    const landscape = attr(pp, 'landscape') === 'NARROWLY';
    if (w > h) [w, h] = [h, w];
    this.page = {
      paper: paperNameFor(hwpToMm(w), hwpToMm(h)),
      width: hwpToMm(w),
      height: hwpToMm(h),
      landscape,
      marginLeft: hwpToMm(num(m, 'left', 8504)),
      marginRight: hwpToMm(num(m, 'right', 8504)),
      marginTop: hwpToMm(num(m, 'top', 5668)),
      marginBottom: hwpToMm(num(m, 'bottom', 4252)),
      marginHeader: hwpToMm(num(m, 'header', 4252)),
      marginFooter: hwpToMm(num(m, 'footer', 4252)),
    };
    this.pageFound = true;
  }

  paragraph(p: El): PMNode[] {
    const ps: ParaStyle = { ...(this.paras.get(attr(p, 'paraPrIDRef') ?? '0') ?? {}) };
    const lvl = headingLevelFromStyleName(this.styles.get(attr(p, 'styleIDRef') ?? '')) ?? ps.heading;
    ps.heading = lvl && lvl <= 3 ? lvl : undefined;
    const isHeading = !!ps.heading;
    const out: PMNode[] = [];
    if (attr(p, 'pageBreak') === '1') out.push({ type: 'pageBreak' });
    const inl = new InlineBuilder();
    const after: PMNode[] = [];

    const walkText = (t: El, rs: RunStyle) => {
      const marks = marksFor(rs, isHeading);
      const nodes = t.childNodes;
      for (let i = 0; i < nodes.length; i++) {
        const n = nodes[i];
        if (n.nodeType === 3 || n.nodeType === 4) inl.text((n.nodeValue ?? '').replace(/\r?\n/g, ''), marks);
        else if (n.nodeType === 1) {
          const name = ln(n as El);
          if (name === 'lineBreak') inl.push({ type: 'hardBreak' });
          else if (name === 'tab') inl.text('\t', marks);
          else if (name === 'nbSpace' || name === 'fwSpace') inl.text(' ', marks);
          else if (name === 'hyphen') inl.text('-', marks);
          else walkText(n as El, rs);
        }
      }
    };

    for (const run of childrenNamed(p, 'run')) {
      const rs = this.chars.get(attr(run, 'charPrIDRef') ?? '0') ?? {};
      for (const c of kids(run)) {
        const name = ln(c);
        if (name === 't') walkText(c, rs);
        else if (name === 'secPr') this.readPage(c);
        else if (name === 'tbl') {
          if (!inl.empty) out.push(paraNode(ps, inl.take()));
          const t = this.table(c);
          if (t) out.push(t);
        } else if (name === 'pic') {
          const img = this.picture(c);
          if (img) inl.push(img);
        } else if (['rect', 'ellipse', 'polygon', 'curve', 'container', 'arc', 'textart'].includes(name)) {
          for (const sl of findAll(c, 'subList')) for (const sp of childrenNamed(sl, 'p')) after.push(...this.paragraph(sp));
          for (const pic of findAll(c, 'pic')) {
            const img = this.picture(pic);
            if (img) inl.push(img);
          }
        } else if (name === 'equation') {
          const script = findFirst(c, 'script');
          if (script?.textContent) inl.text(script.textContent, [{ type: 'italic' }]);
        }
      }
    }
    const content = inl.take();
    if (content.length || !out.some((x) => x.type === 'table')) out.push(paraNode(ps, content));
    out.push(...after);
    return out;
  }

  picture(pic: El): PMNode | null {
    const img = findFirst(pic, 'img');
    const ref = attr(img, 'binaryItemIDRef');
    const src = ref ? this.images.get(ref) : undefined;
    if (!src) return null;
    const sz = child(pic, 'curSz') ?? child(pic, 'sz');
    const w = num(sz, 'width');
    const h = num(sz, 'height');
    return { type: 'image', attrs: { src, width: w ? Math.round(hwpToPx(w)) : null, height: h ? Math.round(hwpToPx(h)) : null } };
  }

  table(tbl: El): PMNode | null {
    const rows: PMNode[] = [];
    const all: { col: number; cs: number; w: number; node: PMNode }[] = [];
    for (const tr of childrenNamed(tbl, 'tr')) {
      const cells: { col: number; node: PMNode }[] = [];
      for (const tc of childrenNamed(tr, 'tc')) {
        const addr = child(tc, 'cellAddr');
        const span = child(tc, 'cellSpan');
        const sz = child(tc, 'cellSz');
        const cs = Math.max(1, num(span, 'colSpan', 1));
        const rs = Math.max(1, num(span, 'rowSpan', 1));
        const w = num(sz, 'width');
        const paras: PMNode[] = [];
        const sl = child(tc, 'subList');
        if (sl) for (const p of childrenNamed(sl, 'p')) paras.push(...this.paragraph(p).filter((x) => x.type !== 'pageBreak'));
        const cell = {
          col: num(addr, 'colAddr'),
          node: {
            type: attr(tc, 'header') === '1' ? 'tableHeader' : 'tableCell',
            attrs: {
              colspan: cs,
              rowspan: rs,
              colwidth: cs === 1 && w ? [Math.round(hwpToPx(w))] : null,
              background: this.fills.get(attr(tc, 'borderFillIDRef') ?? '') ?? null,
            },
            content: paras.length ? paras : [{ type: 'paragraph' }],
          } as PMNode,
        };
        cells.push(cell);
        all.push({ col: cell.col, cs, w: hwpToPx(w), node: cell.node });
      }
      cells.sort((a, b) => a.col - b.col);
      if (cells.length) rows.push({ type: 'tableRow', content: cells.map((c) => c.node) });
    }
    solveColumnWidths(all);
    return rows.length ? { type: 'table', content: rows } : null;
  }
}

export async function readHwpx(bytes: Uint8Array | ArrayBuffer): Promise<HwpDocument> {
  const zip = await JSZip.loadAsync(bytes);
  const mt = zip.file('mimetype');
  if (mt) {
    const m = (await mt.async('string')).trim();
    if (m && !/hwp/i.test(m)) throw new Error('HWPX 문서가 아닙니다.');
  }
  const r = new HwpxReader();
  // 매니페스트
  let sectionPaths: string[] = [];
  const hpfFile = zip.file('Contents/content.hpf');
  if (hpfFile) {
    const hpf = parseXml(await hpfFile.async('string'));
    const items = findAll(hpf, 'item');
    const byId = new Map(items.map((i) => [attr(i, 'id') ?? '', i]));
    for (const it of items) {
      const href = attr(it, 'href') ?? '';
      const id = attr(it, 'id') ?? '';
      const type = attr(it, 'media-type') ?? '';
      if (type.startsWith('image/') || /^BinData\//i.test(href)) {
        const f = zip.file(href) ?? zip.file(href.replace(/^\//, ''));
        if (!f) continue;
        const ext = href.split('.').pop() ?? '';
        const mime = type.startsWith('image/') ? type : mimeFromExt(ext);
        if (!mime || /wmf|emf/i.test(ext)) {
          r.warnings.push(`지원하지 않는 그림 형식(${ext.toUpperCase()})은 빠졌습니다.`);
          continue;
        }
        r.images.set(id, `data:${mime};base64,${bytesToBase64(await f.async('uint8array'))}`);
      }
    }
    sectionPaths = findAll(hpf, 'itemref')
      .map((ir) => byId.get(attr(ir, 'idref') ?? ''))
      .map((it) => attr(it, 'href') ?? '')
      .filter((h) => /section\d+\.xml$/i.test(h));
  }
  if (!sectionPaths.length) {
    sectionPaths = Object.keys(zip.files).filter((n) => /^Contents\/section\d+\.xml$/i.test(n)).sort((a, b) => Number(a.match(/\d+/)![0]) - Number(b.match(/\d+/)![0]));
  }
  const headerFile = zip.file('Contents/header.xml');
  if (!headerFile) throw new Error('HWPX 머리 정보(header.xml)가 없습니다.');
  r.header(parseXml(await headerFile.async('string')));

  const blocks: PMNode[] = [];
  for (const path of sectionPaths) {
    const f = zip.file(path);
    if (!f) continue;
    const sec = parseXml(await f.async('string'));
    for (const p of childrenNamed(sec.documentElement, 'p')) blocks.push(...r.paragraph(p));
  }
  if (!blocks.length) blocks.push({ type: 'paragraph' });
  const cleaned = blocks.filter((b, i) => !(b.type === 'pageBreak' && (i === 0 || blocks[i - 1].type === 'pageBreak')));
  let title: string | undefined;
  return { doc: { type: 'doc', content: cleaned }, page: r.page, title, warnings: [...new Set(r.warnings)] };
}
