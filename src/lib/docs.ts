/** 문서 열기·만들기·저장소 연동 */
import type { HwpDocument, PageSetup, PMNode } from '../hwp/format/types';
import { DEFAULT_PAGE } from '../hwp/format/types';
import { TEMPLATES } from '../hwp/templates';
import type { PdfStored } from '../pdf/types';
import { baseName, detectKind, extOf } from './files';
import { newId, saveData, saveMeta, type DocMeta } from './storage';

export interface HwpStored {
  doc: PMNode;
  page: PageSetup;
  warnings?: string[];
}

export function navigate(path: string) {
  if (location.hash !== `#${path}`) location.hash = path;
}

function previewOf(doc: PMNode): string {
  let s = '';
  const walk = (n: PMNode) => {
    if (s.length > 80) return;
    if (n.text) s += n.text;
    n.content?.forEach((c) => {
      walk(c);
      if (c.type === 'paragraph' || c.type === 'heading') s += ' ';
    });
  };
  walk(doc);
  return s.replace(/\s+/g, ' ').trim().slice(0, 80);
}

export async function createHwpDoc(name: string, hd: { doc: PMNode; page?: PageSetup; warnings?: string[] }, ext = 'hwpx', size = 0) {
  const id = newId();
  const now = Date.now();
  const meta: DocMeta = { id, name, kind: 'hwp', ext, createdAt: now, updatedAt: now, size, preview: previewOf(hd.doc) };
  await saveData(id, { doc: hd.doc, page: hd.page ?? { ...DEFAULT_PAGE }, warnings: hd.warnings } satisfies HwpStored);
  await saveMeta(meta);
  return id;
}

export async function createFromTemplate(templateId: string) {
  const t = TEMPLATES.find((x) => x.id === templateId) ?? TEMPLATES[0];
  const name = t.id === 'blank' ? '새 문서' : t.name.replace(/\s*\(.*\)/, '');
  return createHwpDoc(name, { doc: t.build() });
}

export async function createPdfDoc(name: string, stored: PdfStored, size: number, pages: number) {
  const id = newId();
  const now = Date.now();
  await saveData(id, stored);
  await saveMeta({ id, name, kind: 'pdf', ext: 'pdf', createdAt: now, updatedAt: now, size, pages });
  return id;
}

export interface OpenResult {
  id: string;
  kind: 'hwp' | 'pdf';
  warnings: string[];
}

/** 파일을 열어 저장소에 넣고 문서 id 를 돌려준다 */
export async function importFile(file: File): Promise<OpenResult> {
  const kind = await detectKind(file);
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (kind === 'hwp' || kind === 'hwpx') {
    const { readHangul } = await import('../hwp/format');
    const hd: HwpDocument = await readHangul(bytes);
    const id = await createHwpDoc(baseName(file.name), hd, extOf(file.name) || kind, file.size);
    return { id, kind: 'hwp', warnings: hd.warnings };
  }
  if (kind === 'pdf') {
    const { countPdfPages } = await import('../pdf/pdfjs');
    const pages = await countPdfPages(bytes.slice().buffer);
    const srcId = newId();
    const stored: PdfStored = {
      sources: [{ id: srcId, name: file.name, bytes: bytes.buffer }],
      state: { pages: Array.from({ length: pages }, (_, i) => ({ id: newId(), src: srcId, index: i, rotate: 0 })), annots: [], edits: [], form: {} },
    };
    const id = await createPdfDoc(baseName(file.name), stored, file.size, pages);
    return { id, kind: 'pdf', warnings: [] };
  }
  throw new Error(`지원하지 않는 파일 형식입니다: ${file.name}`);
}
