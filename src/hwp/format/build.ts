import { DEFAULT_FONT, DEFAULT_LINE_HEIGHT, DEFAULT_SIZE, type PMMark, type PMNode } from './types';

/** 형식(HWP/HWPX)에 관계없는 글자 모양 */
export interface RunStyle {
  font?: string;
  size?: number;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  strike?: boolean;
  sup?: boolean;
  sub?: boolean;
  color?: string | null;
  highlight?: string | null;
  /** 자간 % */
  spacing?: number;
}

/** 형식에 관계없는 문단 모양 (단위 pt, 줄 간격 %) */
export interface ParaStyle {
  align?: 'left' | 'center' | 'right' | 'justify' | 'distribute';
  left?: number;
  right?: number;
  indent?: number;
  before?: number;
  after?: number;
  lineHeight?: number;
  heading?: number;
}

export function marksFor(rs: RunStyle, inHeading: boolean): PMMark[] {
  const marks: PMMark[] = [];
  // 개요 문단은 기본이 굵게라 굵은 글자는 표시하지 않는다 (굵지 않은 글자만 fontWeight 400)
  if (rs.bold && !inHeading) marks.push({ type: 'bold' });
  if (rs.italic) marks.push({ type: 'italic' });
  if (rs.underline) marks.push({ type: 'underline' });
  if (rs.strike) marks.push({ type: 'strike' });
  if (rs.sup) marks.push({ type: 'superscript' });
  else if (rs.sub) marks.push({ type: 'subscript' });
  if (rs.highlight) marks.push({ type: 'highlight', attrs: { color: rs.highlight } });
  const ts: Record<string, unknown> = {};
  if (rs.font && (inHeading || rs.font !== DEFAULT_FONT)) ts.fontFamily = rs.font;
  if (rs.size && (inHeading || Math.abs(rs.size - DEFAULT_SIZE) > 0.01)) ts.fontSize = rs.size;
  if (rs.color && rs.color !== '#000000') ts.color = rs.color;
  if (rs.spacing) ts.letterSpacing = rs.spacing;
  // 개요 문단은 기본이 굵게이므로 굵지 않은 글자는 명시
  if (inHeading && !rs.bold) ts.fontWeight = 400;
  if (Object.keys(ts).length) marks.push({ type: 'textStyle', attrs: ts });
  return marks;
}

function sameMarks(a?: PMMark[], b?: PMMark[]) {
  return JSON.stringify(a ?? []) === JSON.stringify(b ?? []);
}

/** 인라인 노드 목록을 정리: 이웃한 같은 모양 텍스트 병합 */
export class InlineBuilder {
  nodes: PMNode[] = [];
  text(t: string, marks: PMMark[]) {
    if (!t) return;
    const last = this.nodes[this.nodes.length - 1];
    if (last && last.type === 'text' && sameMarks(last.marks, marks.length ? marks : undefined)) {
      last.text += t;
      return;
    }
    const n: PMNode = { type: 'text', text: t };
    if (marks.length) n.marks = marks;
    this.nodes.push(n);
  }
  push(n: PMNode) {
    this.nodes.push(n);
  }
  get empty() {
    return this.nodes.length === 0;
  }
  take() {
    const n = this.nodes;
    this.nodes = [];
    // 끝의 줄바꿈 제거
    while (n.length && n[n.length - 1].type === 'hardBreak') n.pop();
    return n;
  }
}

export function paraNode(ps: ParaStyle, content: PMNode[]): PMNode {
  const attrs: Record<string, unknown> = {};
  if (ps.align && ps.align !== 'justify') attrs.textAlign = ps.align;
  else attrs.textAlign = 'justify';
  if (ps.left) attrs.indentLeft = ps.left;
  if (ps.right) attrs.indentRight = ps.right;
  if (ps.indent) attrs.textIndent = ps.indent;
  if (ps.before) attrs.spaceBefore = ps.before;
  if (ps.after) attrs.spaceAfter = ps.after;
  if (ps.lineHeight && ps.lineHeight !== DEFAULT_LINE_HEIGHT) attrs.lineHeight = ps.lineHeight;
  const node: PMNode = ps.heading && ps.heading <= 3
    ? { type: 'heading', attrs: { ...attrs, level: ps.heading } }
    : { type: 'paragraph', attrs };
  if (content.length) node.content = content;
  return node;
}

export function emptyDoc(): PMNode {
  return { type: 'doc', content: [{ type: 'paragraph', attrs: { textAlign: 'justify' } }] };
}

/** 개요 스타일 이름 → 수준 */
export function headingLevelFromStyleName(name: string | undefined | null): number | undefined {
  if (!name) return undefined;
  const m = /^(?:개요|Outline)\s*([1-9])/i.exec(name.trim());
  if (m) return Number(m[1]);
  return undefined;
}

export function mimeFromExt(ext: string) {
  const e = ext.toLowerCase();
  if (e === 'jpg' || e === 'jpeg') return 'image/jpeg';
  if (e === 'png') return 'image/png';
  if (e === 'gif') return 'image/gif';
  if (e === 'bmp') return 'image/bmp';
  if (e === 'webp') return 'image/webp';
  if (e === 'svg') return 'image/svg+xml';
  return null;
}

export function bytesToBase64(bytes: Uint8Array) {
  let s = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) s += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + chunk)));
  return btoa(s);
}

export function base64ToBytes(b64: string) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/**
 * 셀마다 주어진 실제 너비(px)로 열 너비를 풀어, 모든 셀에 colwidth 배열을 채운다.
 * 병합 셀은 이미 아는 열 너비를 빼고 남은 한 열을 역산한다.
 */
export function solveColumnWidths(cells: { col: number; cs: number; w: number; node: PMNode }[]) {
  const cols = Math.max(0, ...cells.map((c) => c.col + c.cs));
  const width: (number | null)[] = Array(cols).fill(null);
  for (const c of cells) if (c.cs === 1 && c.w > 0) width[c.col] ??= c.w;
  for (let iter = 0; iter < 4; iter++) {
    let changed = false;
    for (const c of cells) {
      if (c.cs === 1 || !(c.w > 0)) continue;
      const span = width.slice(c.col, c.col + c.cs);
      const unknown = span.map((x, i) => (x == null ? i : -1)).filter((i) => i >= 0);
      if (unknown.length === 0) continue;
      const known = span.reduce<number>((a, x) => a + (x ?? 0), 0);
      const rest = Math.max(8, (c.w - known) / unknown.length);
      if (unknown.length === 1 || iter === 3) {
        for (const i of unknown) width[c.col + i] = rest;
        changed = true;
      }
    }
    if (!changed && !width.includes(null)) break;
  }
  if (width.includes(null)) return;
  for (const c of cells) {
    c.node.attrs = { ...(c.node.attrs ?? {}), colwidth: width.slice(c.col, c.col + c.cs).map((x) => Math.round(x!)) };
  }
}
