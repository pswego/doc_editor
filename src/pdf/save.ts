/**
 * 편집 상태(페이지 구성 + 주석 + 텍스트 교체 + 양식 값) → 새 PDF 바이트
 * 주석은 페이지 내용에 그려 넣고(어떤 뷰어에서도 똑같이 보이도록), 메모는 PDF 메모 주석으로도 남긴다.
 */
import { PDFDocument, PDFName, PDFString, PDFHexString, BlendMode, LineCapStyle, degrees, rgb, type PDFFont, type PDFPage } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import type { Annot, PdfSource, PdfState, TextEdit } from './types';
import { hexToRgb01, makeVp, rectToView, type Vp } from './geometry';

export const TEXT_LINE_HEIGHT = 1.3;

let fontCache: Promise<{ regular: ArrayBuffer; bold: ArrayBuffer }> | null = null;
export function loadKoreanFonts(fetcher: (path: string) => Promise<ArrayBuffer> = defaultFetch) {
  fontCache ??= Promise.all([fetcher('fonts/NotoSansKR-Regular.ttf'), fetcher('fonts/NotoSansKR-Bold.ttf')]).then(([regular, bold]) => ({ regular, bold }));
  return fontCache;
}
async function defaultFetch(path: string) {
  const res = await fetch(new URL(path, document.baseURI));
  if (!res.ok) throw new Error('한글 글꼴을 불러오지 못했습니다.');
  return res.arrayBuffer();
}

const col = (hex: string) => {
  const [r, g, b] = hexToRgb01(hex);
  return rgb(r, g, b);
};

/** 글꼴 너비로 줄바꿈 (공백 우선, 긴 낱말은 글자 단위) */
export function wrapLines(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const out: string[] = [];
  for (const para of text.split('\n')) {
    if (!para) { out.push(''); continue; }
    let line = '';
    const tokens = para.match(/\S+\s*|\s+/g) ?? [para];
    for (const tok of tokens) {
      const cand = line + tok;
      if (font.widthOfTextAtSize(cand.trimEnd(), size) <= maxWidth || !line) {
        if (font.widthOfTextAtSize(cand.trimEnd(), size) <= maxWidth) { line = cand; continue; }
        // 낱말 하나가 너무 길면 글자 단위로 자르기
        for (const ch of tok) {
          if (font.widthOfTextAtSize((line + ch).trimEnd(), size) > maxWidth && line) { out.push(line.trimEnd()); line = ''; }
          line += ch;
        }
        continue;
      }
      out.push(line.trimEnd());
      line = tok.trimStart();
    }
    out.push(line.trimEnd());
  }
  return out;
}

/** 공백 너비가 틀어지는 문제를 피하려고 낱말 단위로 위치를 계산해 그린다 */
function drawRun(page: PDFPage, text: string, x: number, y: number, angleDeg: number, size: number, font: PDFFont, color: ReturnType<typeof rgb>, opacity = 1) {
  const rad = (angleDeg * Math.PI) / 180;
  const dx = Math.cos(rad), dy = Math.sin(rad);
  const space = font.widthOfTextAtSize(' ', size) || size * 0.25;
  let off = 0;
  for (const word of text.split(' ')) {
    if (word) page.drawText(word, { x: x + dx * off, y: y + dy * off, size, font, color, opacity, rotate: degrees(angleDeg) });
    off += font.widthOfTextAtSize(word, size) + space;
  }
}

function needsFont(state: PdfState) {
  return state.annots.some((a) => (a.type === 'text' || a.type === 'stamp') && a.text) || state.edits.length > 0 || Object.keys(state.form).length > 0;
}

/** 글꼴에 없는 글자(이모지 등) 걸러내기 */
function safeText(font: PDFFont, s: string) {
  const set = font.getCharacterSet();
  return Array.from(s).map((ch) => (ch === '\n' || set.includes(ch.codePointAt(0)!) ? ch : '?')).join('');
}

interface Fonts { regular: PDFFont; bold: PDFFont }

/** 굵은 글꼴은 실제로 쓸 때만 넣는다 (CJK 글꼴은 하위 집합 없이 통째로 넣어야 글자가 깨지지 않음) */
async function embedFonts(out: PDFDocument, state: PdfState, fetcher?: (p: string) => Promise<ArrayBuffer>): Promise<Fonts> {
  const f = await loadKoreanFonts(fetcher);
  const regular = await out.embedFont(f.regular, { subset: false });
  const needBold = state.annots.some((a) => a.type === 'stamp' && a.text) || state.edits.some((e) => e.bold);
  const bold = needBold ? await out.embedFont(f.bold, { subset: false }) : regular;
  return { regular, bold };
}

function drawAnnot(page: PDFPage, a: Annot, vp: Vp, fonts: Fonts | null, images: Map<string, import('pdf-lib').PDFImage>) {
  const color = col(a.color);
  const rot = degrees(vp.rotation);
  const pt = (vx: number, vy: number) => {
    const [x, y] = vp.toPdf(vx, vy);
    return { x, y };
  };
  switch (a.type) {
    case 'highlight':
      for (const r of a.rects ?? []) {
        page.drawRectangle({ x: r[0], y: r[1], width: r[2] - r[0], height: r[3] - r[1], color, opacity: a.opacity, blendMode: BlendMode.Multiply });
      }
      break;
    case 'underline':
    case 'strike':
      for (const r of a.rects ?? []) {
        const v = rectToView(vp, r);
        const y = a.type === 'underline' ? v.y + v.h - Math.max(1, v.h * 0.06) : v.y + v.h * 0.55;
        page.drawLine({ start: pt(v.x, y), end: pt(v.x + v.w, y), thickness: Math.max(0.8, v.h * 0.07), color, opacity: Math.max(0.6, a.opacity) });
      }
      break;
    case 'ink':
      for (const s of a.points ?? []) {
        for (let i = 1; i < s.length; i++) {
          page.drawLine({ start: { x: s[i - 1][0], y: s[i - 1][1] }, end: { x: s[i][0], y: s[i][1] }, thickness: a.width ?? 2, color, opacity: a.opacity, lineCap: LineCapStyle.Round });
        }
        if (s.length === 1) page.drawCircle({ x: s[0][0], y: s[0][1], size: (a.width ?? 2) / 2, color, opacity: a.opacity });
      }
      break;
    case 'rect': {
      const v = rectToView(vp, a.rect!);
      const o = pt(v.x, v.y + v.h);
      page.drawRectangle({ x: o.x, y: o.y, width: v.w, height: v.h, rotate: rot, borderColor: color, borderWidth: a.width ?? 2, borderOpacity: a.opacity });
      break;
    }
    case 'ellipse': {
      const v = rectToView(vp, a.rect!);
      const c = pt(v.x + v.w / 2, v.y + v.h / 2);
      page.drawEllipse({ x: c.x, y: c.y, xScale: v.w / 2, yScale: v.h / 2, rotate: rot, borderColor: color, borderWidth: a.width ?? 2, borderOpacity: a.opacity });
      break;
    }
    case 'arrow': {
      const [x1, y1, x2, y2] = a.rect!;
      const w = a.width ?? 2;
      page.drawLine({ start: { x: x1, y: y1 }, end: { x: x2, y: y2 }, thickness: w, color, opacity: a.opacity, lineCap: LineCapStyle.Round });
      const ang = Math.atan2(y2 - y1, x2 - x1);
      const len = 8 + w * 2.5;
      for (const s of [-1, 1]) {
        const t = ang + Math.PI + s * 0.45;
        page.drawLine({ start: { x: x2, y: y2 }, end: { x: x2 + len * Math.cos(t), y: y2 + len * Math.sin(t) }, thickness: w, color, opacity: a.opacity, lineCap: LineCapStyle.Round });
      }
      break;
    }
    case 'text': {
      if (!fonts || !a.text) break;
      const v = rectToView(vp, a.rect!);
      const size = a.fontSize ?? 12;
      const font = fonts.regular;
      const lines = wrapLines(safeText(font, a.text), font, size, Math.max(size, v.w - 4));
      const lh = size * TEXT_LINE_HEIGHT;
      lines.forEach((line, i) => {
        const base = pt(v.x + 2, v.y + 2 + i * lh + size * 1.0);
        if (line) drawRun(page, line, base.x, base.y, vp.rotation, size, font, color, a.opacity);
      });
      break;
    }
    case 'stamp': {
      const v = rectToView(vp, a.rect!);
      const o = pt(v.x, v.y + v.h);
      page.drawRectangle({ x: o.x, y: o.y, width: v.w, height: v.h, rotate: rot, borderColor: color, borderWidth: 2.2, borderOpacity: a.opacity, opacity: 0 });
      if (fonts && a.text) {
        const font = fonts.bold;
        const t = safeText(font, a.text);
        let size = v.h * 0.5;
        const tw = font.widthOfTextAtSize(t, size);
        if (tw > v.w * 0.86) size *= (v.w * 0.86) / tw;
        const w = font.widthOfTextAtSize(t, size);
        const base = pt(v.x + (v.w - w) / 2, v.y + v.h / 2 + size * 0.36);
        drawRun(page, t, base.x, base.y, vp.rotation, size, font, color, a.opacity);
      }
      break;
    }
    case 'image': {
      const img = a.image ? images.get(a.image) : undefined;
      if (!img) break;
      const v = rectToView(vp, a.rect!);
      const o = pt(v.x, v.y + v.h);
      page.drawImage(img, { x: o.x, y: o.y, width: v.w, height: v.h, rotate: rot, opacity: a.opacity });
      break;
    }
    case 'note':
      break;
  }
}

function drawEdit(page: PDFPage, e: TextEdit, fonts: Fonts) {
  const [x1, y1, x2, y2] = e.rect;
  const pad = 0.8;
  page.drawRectangle({ x: x1 - pad, y: y1 - pad, width: x2 - x1 + pad * 2, height: y2 - y1 + pad * 2, color: rgb(1, 1, 1) });
  if (!e.text) return;
  const font = e.bold ? fonts.bold : fonts.regular;
  const text = safeText(font, e.text.replace(/\n/g, ' '));
  const ang = e.angle ?? 0;
  drawRun(page, text, e.x ?? x1, e.y ?? y1 + (y2 - y1) * 0.22, ang, e.fontSize, font, col(e.color));
}

/** PDF 메모(Text) 주석 추가 — 다른 뷰어에서도 메모 아이콘으로 보인다 */
function addNoteAnnot(doc: PDFDocument, page: PDFPage, a: Annot, rect: number[], content: string) {
  const [r, g, b] = hexToRgb01(a.color);
  const dict = doc.context.obj({
    Type: 'Annot',
    Subtype: a.type === 'note' ? 'Text' : 'Square',
    Rect: rect,
    Contents: PDFHexString.fromText(content),
    T: PDFHexString.fromText(a.author || '나'),
    M: PDFString.fromDate(new Date(a.createdAt)),
    C: [r, g, b],
    F: a.type === 'note' ? 4 : 4 | 2, // 인쇄 / (덧붙인 메모는 숨김)
    ...(a.type === 'note' ? { Name: 'Comment', Open: false } : {}),
  });
  const ref = doc.context.register(dict);
  const annots = page.node.lookup(PDFName.of('Annots'));
  if (annots && 'push' in annots) (annots as unknown as { push: (x: unknown) => void }).push(ref);
  else page.node.set(PDFName.of('Annots'), doc.context.obj([ref]));
}

function annotBounds(a: Annot): number[] | null {
  if (a.rect) return [Math.min(a.rect[0], a.rect[2]), Math.min(a.rect[1], a.rect[3]), Math.max(a.rect[0], a.rect[2]), Math.max(a.rect[1], a.rect[3])];
  if (a.rects?.length) return [Math.min(...a.rects.map((r) => r[0])), Math.min(...a.rects.map((r) => r[1])), Math.max(...a.rects.map((r) => r[2])), Math.max(...a.rects.map((r) => r[3]))];
  if (a.points?.length) {
    const all = a.points.flat();
    return [Math.min(...all.map((p) => p[0])), Math.min(...all.map((p) => p[1])), Math.max(...all.map((p) => p[0])), Math.max(...all.map((p) => p[1]))];
  }
  return null;
}

export interface BuildOptions {
  fontFetcher?: (path: string) => Promise<ArrayBuffer>;
}

/** 원본 첫 문서의 페이지를 순서대로 그대로 쓰는지 (양식·책갈피 보존 가능) */
export function isInPlace(sources: PdfSource[], state: PdfState) {
  const s0 = sources[0];
  return !!s0 && state.pages.every((p, i) => p.src === s0.id && p.index === i) && state.pages.length > 0;
}

export async function buildPdf(sources: PdfSource[], state: PdfState, pageCounts: Map<string, number>, opts: BuildOptions = {}): Promise<Uint8Array> {
  const inPlace = isInPlace(sources, state) && state.pages.length === pageCounts.get(sources[0].id);
  const srcDocs = new Map<string, PDFDocument>();
  const loadSrc = async (id: string) => {
    let d = srcDocs.get(id);
    if (!d) {
      const s = sources.find((x) => x.id === id)!;
      d = await PDFDocument.load(s.bytes.slice(0), { ignoreEncryption: true, updateMetadata: false });
      srcDocs.set(id, d);
    }
    return d;
  };

  let out: PDFDocument;
  const pages: PDFPage[] = [];
  if (inPlace) {
    out = await loadSrc(sources[0].id);
    pages.push(...out.getPages());
  } else {
    out = await PDFDocument.create();
    for (const ref of state.pages) {
      if (!ref.src) {
        pages.push(out.addPage([ref.w ?? 595.28, ref.h ?? 841.89]));
        continue;
      }
      const src = await loadSrc(ref.src);
      const [copied] = await out.copyPages(src, [ref.index]);
      pages.push(out.addPage(copied));
    }
  }
  out.registerFontkit(fontkit);
  let fonts: Fonts | null = null;
  if (needsFont(state)) {
    fonts = await embedFonts(out, state, opts.fontFetcher);
  }
  const images = new Map<string, import('pdf-lib').PDFImage>();
  for (const a of state.annots) {
    if (a.type !== 'image' || !a.image || images.has(a.image)) continue;
    const m = /^data:image\/(png|jpe?g);base64,/.exec(a.image);
    if (!m) continue;
    const bytes = Uint8Array.from(atob(a.image.slice(a.image.indexOf(',') + 1)), (c) => c.charCodeAt(0));
    images.set(a.image, m[1] === 'png' ? await out.embedPng(bytes) : await out.embedJpg(bytes));
  }

  state.pages.forEach((ref, i) => {
    const page = pages[i];
    const base = page.getRotation().angle;
    const rotation = (((base + ref.rotate) % 360) + 360) % 360;
    if (ref.rotate) page.setRotation(degrees(rotation));
    const mb = page.getCropBox();
    const vp = makeVp([mb.x, mb.y, mb.x + mb.width, mb.y + mb.height], 1, rotation);
    if (fonts) for (const e of state.edits.filter((x) => x.page === ref.id)) drawEdit(page, e, fonts);
    for (const a of state.annots.filter((x) => x.page === ref.id)) {
      drawAnnot(page, a, vp, fonts, images);
      const note = [a.comment, ...(a.replies ?? []).map((r) => `${r.author}: ${r.text}`)].filter(Boolean).join('\n');
      const b = annotBounds(a);
      if (b && (a.type === 'note' || note)) addNoteAnnot(out, page, a, a.type === 'note' ? [b[0], b[3] - 20, b[0] + 20, b[3]] : b, note || '');
    }
  });

  // 양식 값
  if (Object.keys(state.form).length && inPlace) {
    const form = out.getForm();
    for (const [name, value] of Object.entries(state.form)) {
      try {
        const field = form.getField(name);
        const kind = field.constructor.name;
        if (kind === 'PDFTextField') (field as import('pdf-lib').PDFTextField).setText(String(value));
        else if (kind === 'PDFCheckBox') (value ? (field as import('pdf-lib').PDFCheckBox).check() : (field as import('pdf-lib').PDFCheckBox).uncheck());
        else if (kind === 'PDFDropdown') (field as import('pdf-lib').PDFDropdown).select(String(value));
        else if (kind === 'PDFRadioGroup') (field as import('pdf-lib').PDFRadioGroup).select(String(value));
        else if (kind === 'PDFOptionList') (field as import('pdf-lib').PDFOptionList).select(String(value));
      } catch {
        /* 없는 필드는 건너뜀 */
      }
    }
    if (fonts) {
      try {
        form.updateFieldAppearances(fonts.regular);
      } catch {
        /* 일부 필드 모양 갱신 실패는 무시 */
      }
    }
  }
  out.setProducer('문서공방 PDF 편집기');
  out.setModificationDate(new Date());
  return out.save({ useObjectStreams: true });
}
