/** ProseMirror(TipTap) JSON 노드 */
export interface PMMark {
  type: string;
  attrs?: Record<string, unknown>;
}
export interface PMNode {
  type: string;
  attrs?: Record<string, unknown>;
  content?: PMNode[];
  text?: string;
  marks?: PMMark[];
}

/** 쪽 설정 (단위 mm). width/height 는 용지의 세로 방향 기준 치수 */
export interface PageSetup {
  paper: string;
  width: number;
  height: number;
  landscape: boolean;
  marginTop: number;
  marginBottom: number;
  marginLeft: number;
  marginRight: number;
  marginHeader: number;
  marginFooter: number;
}

export const PAPERS: Record<string, { label: string; width: number; height: number }> = {
  A4: { label: 'A4', width: 210, height: 297 },
  A5: { label: 'A5', width: 148, height: 210 },
  B5: { label: 'B5 (JIS)', width: 182, height: 257 },
  B4: { label: 'B4 (JIS)', width: 257, height: 364 },
  A3: { label: 'A3', width: 297, height: 420 },
  Letter: { label: 'Letter', width: 215.9, height: 279.4 },
  Legal: { label: 'Legal', width: 215.9, height: 355.6 },
};

/** 한글 기본값: A4, 위 20 · 아래 15 · 왼쪽/오른쪽 30 · 머리말/꼬리말 15 mm */
export const DEFAULT_PAGE: PageSetup = {
  paper: 'A4',
  width: 210,
  height: 297,
  landscape: false,
  marginTop: 20,
  marginBottom: 15,
  marginLeft: 30,
  marginRight: 30,
  marginHeader: 15,
  marginFooter: 15,
};

export function paperNameFor(w: number, h: number) {
  const [a, b] = w < h ? [w, h] : [h, w];
  for (const [k, p] of Object.entries(PAPERS)) {
    if (Math.abs(p.width - a) < 1.5 && Math.abs(p.height - b) < 1.5) return k;
  }
  return 'custom';
}

/** 실제 화면에 놓이는 가로·세로 (방향 반영) */
export function pageDims(p: PageSetup) {
  return p.landscape ? { w: p.height, h: p.width } : { w: p.width, h: p.height };
}

export interface HwpDocument {
  doc: PMNode;
  page: PageSetup;
  title?: string;
  warnings: string[];
}

// ── 단위 ──────────────────────────────────
/** HWPUNIT = 1/7200 inch */
export const HWPUNIT_PER_MM = 7200 / 25.4;
export const mmToHwp = (mm: number) => Math.round(mm * HWPUNIT_PER_MM);
export const hwpToMm = (u: number) => Math.round((u / HWPUNIT_PER_MM) * 10) / 10;
/** 1 px(96dpi) = 75 HWPUNIT */
export const pxToHwp = (px: number) => Math.round(px * 75);
export const hwpToPx = (u: number) => u / 75;
/** 문단 여백 값은 HWPUNIT×2 로 저장된다 (10pt → 2000) */
export const paraUnitToPt = (u: number) => Math.round((u / 200) * 10) / 10;
export const ptToParaUnit = (pt: number) => Math.round(pt * 200);

export const DEFAULT_FONT = '함초롬바탕';
export const DEFAULT_SIZE = 10;
export const DEFAULT_LINE_HEIGHT = 160;

/** 개요 1~3 기본 모양 (편집기 CSS 와 같게 유지) */
export const HEADING_DEFAULTS: Record<number, { size: number; bold: boolean; font: string }> = {
  1: { size: 16, bold: true, font: '함초롬돋움' },
  2: { size: 13, bold: true, font: '함초롬돋움' },
  3: { size: 11, bold: true, font: '함초롬바탕' },
};

export function colorRefToHex(c: number): string | null {
  if (c === 0xffffffff || c < 0) return null;
  const r = c & 0xff;
  const g = (c >> 8) & 0xff;
  const b = (c >> 16) & 0xff;
  return '#' + [r, g, b].map((x) => x.toString(16).padStart(2, '0')).join('').toUpperCase();
}

export function normalizeHex(c: unknown): string | null {
  if (typeof c !== 'string') return null;
  const s = c.trim();
  if (/^#[0-9a-f]{6}$/i.test(s)) return s.toUpperCase();
  if (/^#[0-9a-f]{3}$/i.test(s)) return ('#' + s[1] + s[1] + s[2] + s[2] + s[3] + s[3]).toUpperCase();
  const m = /^rgba?\((\d+),\s*(\d+),\s*(\d+)/i.exec(s);
  if (m) return '#' + [m[1], m[2], m[3]].map((x) => Number(x).toString(16).padStart(2, '0')).join('').toUpperCase();
  return null;
}
