/** 변환 도구: PDF → 이미지/텍스트/한글, PDF 나누기·합치기 */
import JSZip from 'jszip';
import { PDFDocument } from 'pdf-lib';
import { loadPdf } from '../pdf/pdfjs';
import type { PMNode } from '../hwp/format/types';
import type { TextItem } from 'pdfjs-dist/types/src/display/api';
export { parseRanges } from './ranges';

export async function pdfToImages(bytes: ArrayBuffer, scale = 2, onProgress?: (i: number, n: number) => void): Promise<Blob> {
  const doc = await loadPdf(bytes);
  const zip = new JSZip();
  try {
    for (let i = 1; i <= doc.numPages; i++) {
      onProgress?.(i, doc.numPages);
      const page = await doc.getPage(i);
      const vp = page.getViewport({ scale });
      const canvas = document.createElement('canvas');
      canvas.width = Math.ceil(vp.width);
      canvas.height = Math.ceil(vp.height);
      const ctx = canvas.getContext('2d')!;
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({ canvasContext: ctx, viewport: vp }).promise;
      const blob = await new Promise<Blob>((res) => canvas.toBlob((b) => res(b!), 'image/png'));
      zip.file(`page-${String(i).padStart(3, '0')}.png`, blob);
      page.cleanup();
    }
  } finally {
    await doc.destroy();
  }
  return zip.generateAsync({ type: 'blob' });
}

interface Line { y: number; x: number; size: number; text: string; bold: boolean; right: number }

async function pdfLines(bytes: ArrayBuffer) {
  const doc = await loadPdf(bytes);
  const pages: { lines: Line[]; width: number }[] = [];
  try {
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i);
      const vp = page.getViewport({ scale: 1 });
      const tc = await page.getTextContent();
      const styles = tc.styles as Record<string, { fontFamily?: string }>;
      const items = (tc.items as TextItem[]).filter((it) => 'str' in it && it.str.trim() !== '' || ('hasEOL' in it && it.hasEOL));
      const lines: Line[] = [];
      for (const it of items) {
        if (!it.str) continue;
        const [, , c, d, e, f] = it.transform;
        const size = Math.hypot(c, d) || it.height || 10;
        const [x, y] = vp.convertToViewportPoint(e, f);
        const font = `${it.fontName} ${styles[it.fontName]?.fontFamily ?? ''}`;
        const bold = /bold|black|heavy|semibold|\bB\b/i.test(font);
        const last = lines[lines.length - 1];
        if (last && Math.abs(last.y - y) < size * 0.5) {
          const gap = x - last.right;
          last.text += (gap > size * 0.25 && !last.text.endsWith(' ') && !it.str.startsWith(' ') ? ' ' : '') + it.str;
          last.right = x + it.width;
          last.bold = last.bold && bold;
          last.size = Math.max(last.size, size);
        } else lines.push({ y, x, size, text: it.str, bold, right: x + it.width });
      }
      lines.sort((a, b) => a.y - b.y || a.x - b.x);
      pages.push({ lines, width: vp.width });
      page.cleanup();
    }
  } finally {
    await doc.destroy();
  }
  return pages;
}

export async function pdfToText(bytes: ArrayBuffer): Promise<string> {
  const pages = await pdfLines(bytes);
  return pages.map((p, i) => `── ${i + 1}쪽 ──\n` + p.lines.map((l) => l.text).join('\n')).join('\n\n');
}

/** PDF 글자를 문단으로 묶어 한글 문서로 */
export async function pdfToHwpDoc(bytes: ArrayBuffer): Promise<PMNode> {
  const pages = await pdfLines(bytes);
  const content: PMNode[] = [];
  pages.forEach((pg, pi) => {
    if (pi > 0) content.push({ type: 'pageBreak' });
    const sizes = pg.lines.map((l) => Math.round(l.size)).sort((a, b) => a - b);
    const body = sizes[Math.floor(sizes.length / 2)] || 10;
    let para: Line[] = [];
    const flush = () => {
      if (!para.length) return;
      const size = Math.round(Math.max(...para.map((l) => l.size)) * 2) / 2;
      const text = para.map((l) => l.text.trim()).filter(Boolean).join(' ');
      const center = para.every((l) => Math.abs(l.x + (l.right - l.x) / 2 - pg.width / 2) < pg.width * 0.08) && para[0].right - para[0].x < pg.width * 0.7;
      const marks: PMNode['marks'] = [];
      if (para.every((l) => l.bold)) marks.push({ type: 'bold' });
      if (Math.abs(size - 10) > 0.6) marks.push({ type: 'textStyle', attrs: { fontSize: Math.min(72, Math.max(6, size)) } });
      content.push({ type: 'paragraph', attrs: { textAlign: center ? 'center' : 'justify' }, content: text ? [{ type: 'text', text, ...(marks.length ? { marks } : {}) }] : undefined });
      para = [];
    };
    let prev: Line | null = null;
    for (const l of pg.lines) {
      if (prev) {
        const gap = l.y - prev.y;
        const newPara = gap > Math.max(l.size, prev.size) * 1.7 || Math.abs(l.size - prev.size) > 1.5 || l.x - prev.x > body * 1.5 || (prev.right < pg.width * 0.6 && prev.text.trim().length < 40);
        if (newPara) flush();
      }
      para.push(l);
      prev = l;
    }
    flush();
  });
  if (!content.length) content.push({ type: 'paragraph' });
  return { type: 'doc', content };
}

export function docToText(doc: PMNode): string {
  const out: string[] = [];
  const inline = (n: PMNode): string => (n.type === 'text' ? n.text ?? '' : n.type === 'hardBreak' ? '\n' : (n.content ?? []).map(inline).join(''));
  const block = (n: PMNode) => {
    if (n.type === 'paragraph' || n.type === 'heading') out.push(inline(n));
    else if (n.type === 'table') {
      for (const r of n.content ?? []) out.push((r.content ?? []).map((c) => (c.content ?? []).map(inline).join(' ')).join('\t'));
    } else if (n.type === 'pageBreak') out.push('\f');
    else (n.content ?? []).forEach(block);
  };
  (doc.content ?? []).forEach(block);
  return out.join('\n');
}

export async function extractPages(bytes: ArrayBuffer, indices: number[]): Promise<Uint8Array> {
  const src = await PDFDocument.load(bytes, { ignoreEncryption: true });
  const out = await PDFDocument.create();
  const pages = await out.copyPages(src, indices);
  pages.forEach((p) => out.addPage(p));
  return out.save();
}

export async function splitPdf(bytes: ArrayBuffer, groups: number[][], base: string): Promise<{ blob: Blob; name: string }> {
  if (groups.length === 1) {
    const g = groups[0];
    const data = await extractPages(bytes, g);
    return { blob: new Blob([data as BlobPart], { type: 'application/pdf' }), name: `${base}_${g[0] + 1}${g.length > 1 ? `-${g[g.length - 1] + 1}` : ''}쪽.pdf` };
  }
  const zip = new JSZip();
  for (const g of groups) {
    const data = await extractPages(bytes, g);
    zip.file(`${base}_${g[0] + 1}${g.length > 1 ? `-${g[g.length - 1] + 1}` : ''}쪽.pdf`, data);
  }
  return { blob: await zip.generateAsync({ type: 'blob' }), name: `${base}_나누기.zip` };
}

export async function mergePdfs(list: ArrayBuffer[]): Promise<Uint8Array> {
  const out = await PDFDocument.create();
  for (const b of list) {
    const src = await PDFDocument.load(b, { ignoreEncryption: true });
    const pages = await out.copyPages(src, src.getPageIndices());
    pages.forEach((p) => out.addPage(p));
  }
  return out.save();
}
