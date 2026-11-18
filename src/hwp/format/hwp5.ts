/**
 * HWP 5.0 (바이너리, OLE 복합 문서) 읽기
 * 참고: 한글과컴퓨터 「한글 문서 파일 형식 5.0」 공개 문서
 */
import * as CFB from 'cfb';
import { inflateRaw } from 'pako';
import { InlineBuilder, marksFor, paraNode, headingLevelFromStyleName, mimeFromExt, bytesToBase64, solveColumnWidths, type ParaStyle, type RunStyle } from './build';
import { DEFAULT_PAGE, colorRefToHex, hwpToMm, hwpToPx, paraUnitToPt, paperNameFor, type HwpDocument, type PMNode, type PageSetup } from './types';

const TAG = {
  DOCUMENT_PROPERTIES: 16,
  ID_MAPPINGS: 17,
  BIN_DATA: 18,
  FACE_NAME: 19,
  BORDER_FILL: 20,
  CHAR_SHAPE: 21,
  PARA_SHAPE: 25,
  STYLE: 26,
  PARA_HEADER: 66,
  PARA_TEXT: 67,
  PARA_CHAR_SHAPE: 68,
  CTRL_HEADER: 71,
  LIST_HEADER: 72,
  PAGE_DEF: 73,
  SHAPE_COMPONENT: 76,
  TABLE: 77,
  SHAPE_COMPONENT_PICTURE: 85,
} as const;

interface Rec {
  tag: number;
  level: number;
  data: Uint8Array;
  children: Rec[];
}

class R {
  dv: DataView;
  p = 0;
  constructor(public b: Uint8Array) {
    this.dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  }
  get left() {
    return this.b.length - this.p;
  }
  u8() { const v = this.dv.getUint8(this.p); this.p += 1; return v; }
  i8() { const v = this.dv.getInt8(this.p); this.p += 1; return v; }
  u16() { const v = this.dv.getUint16(this.p, true); this.p += 2; return v; }
  i16() { const v = this.dv.getInt16(this.p, true); this.p += 2; return v; }
  u32() { const v = this.dv.getUint32(this.p, true); this.p += 4; return v; }
  i32() { const v = this.dv.getInt32(this.p, true); this.p += 4; return v; }
  wstr(n: number) {
    let s = '';
    for (let i = 0; i < n; i++) s += String.fromCharCode(this.u16());
    return s;
  }
  skip(n: number) { this.p += n; }
}

function u16at(b: Uint8Array, o: number) { return o + 2 <= b.length ? b[o] | (b[o + 1] << 8) : 0; }
function u32at(b: Uint8Array, o: number) { return o + 4 <= b.length ? (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0 : 0; }
function i32at(b: Uint8Array, o: number) { return o + 4 <= b.length ? (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) : 0; }

function readRecords(data: Uint8Array): Rec[] {
  const flat: Rec[] = [];
  let p = 0;
  while (p + 4 <= data.length) {
    const h = u32at(data, p);
    p += 4;
    const tag = h & 0x3ff;
    const level = (h >>> 10) & 0x3ff;
    let size = h >>> 20;
    if (size === 0xfff) {
      size = u32at(data, p);
      p += 4;
    }
    flat.push({ tag, level, data: data.subarray(p, p + size), children: [] });
    p += size;
  }
  // 수준(level)으로 트리 구성
  const root: Rec[] = [];
  const stack: Rec[] = [];
  for (const r of flat) {
    while (stack.length && stack[stack.length - 1].level >= r.level) stack.pop();
    if (stack.length) stack[stack.length - 1].children.push(r);
    else root.push(r);
    stack.push(r);
  }
  return root;
}

function chid(n: number) {
  return String.fromCharCode((n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff);
}

interface CharShape extends RunStyle {}
interface Style { name: string; paraShape: number; charShape: number }
interface BinItem { id: number; ext: string; compress: number }

class Hwp5Reader {
  cfb: CFB.CFB$Container;
  compressed = false;
  version = 0;
  fonts: string[] = []; // 한글 글꼴
  charShapes: CharShape[] = [];
  paraShapes: ParaStyle[] = [];
  styles: Style[] = [];
  borderFills: (string | null)[] = []; // 배경색
  binItems: BinItem[] = [];
  page: PageSetup = { ...DEFAULT_PAGE };
  pageFound = false;
  warnings: string[] = [];

  constructor(bytes: Uint8Array) {
    this.cfb = CFB.read(bytes, { type: 'array' });
  }

  stream(path: string): Uint8Array | null {
    const e = CFB.find(this.cfb, 'Root Entry/' + path) ?? CFB.find(this.cfb, '/' + path);
    if (!e || !e.content) return null;
    return e.content instanceof Uint8Array ? e.content : new Uint8Array(e.content as ArrayLike<number>);
  }

  decompress(b: Uint8Array, force?: boolean) {
    if (!(force ?? this.compressed)) return b;
    try {
      return inflateRaw(b);
    } catch {
      return b;
    }
  }

  readHeader() {
    const h = this.stream('FileHeader');
    if (!h) throw new Error('HWP 파일 헤더가 없습니다.');
    const sig = String.fromCharCode(...Array.from(h.subarray(0, 17)));
    if (!sig.startsWith('HWP Document File')) throw new Error('HWP 5.0 문서가 아닙니다.');
    this.version = u32at(h, 32);
    const props = u32at(h, 36);
    this.compressed = (props & 1) !== 0;
    if (props & 2) throw new Error('암호가 설정된 문서는 열 수 없습니다. 한글에서 암호를 해제한 뒤 다시 열어 주세요.');
    if (props & 4) throw new Error('배포용 문서는 편집할 수 없습니다.');
  }

  readDocInfo() {
    const raw = this.stream('DocInfo');
    if (!raw) throw new Error('DocInfo 스트림이 없습니다.');
    const recs = readRecords(this.decompress(raw));
    let fontLangCounts: number[] = [];
    let fontIndex = 0;
    const flat: Rec[] = [];
    const walk = (rs: Rec[]) => rs.forEach((r) => { flat.push(r); walk(r.children); });
    walk(recs);
    for (const rec of flat) {
      const r = new R(rec.data);
      switch (rec.tag) {
        case TAG.ID_MAPPINGS: {
          const vals: number[] = [];
          while (r.left >= 4) vals.push(r.i32());
          fontLangCounts = vals.slice(1, 8);
          break;
        }
        case TAG.BIN_DATA: {
          const attr = r.u16();
          const type = attr & 0xf;
          const compress = (attr >> 4) & 0x3;
          if (type === 0) {
            this.binItems.push({ id: 0, ext: '', compress });
          } else {
            const id = r.u16();
            let ext = '';
            if (type === 1 && r.left >= 2) ext = r.wstr(r.u16());
            this.binItems.push({ id, ext, compress });
          }
          break;
        }
        case TAG.FACE_NAME: {
          r.u8();
          const name = r.wstr(r.u16());
          // 첫 언어(한글) 묶음만 보관
          if (!fontLangCounts.length || fontIndex < fontLangCounts[0]) this.fonts.push(name);
          fontIndex++;
          break;
        }
        case TAG.BORDER_FILL: {
          const b = rec.data;
          // 속성 2 + 테두리 4×6 + 대각선 6 = 32
          let bg: string | null = null;
          if (b.length >= 40) {
            const fillType = u32at(b, 32);
            if (fillType & 1) {
              const c = u32at(b, 36);
              bg = colorRefToHex(c);
              if (bg === '#FFFFFF') bg = null;
            }
          }
          this.borderFills.push(bg);
          break;
        }
        case TAG.CHAR_SHAPE: {
          const b = rec.data;
          const fontId = u16at(b, 0);
          const spacing = (b[21] << 24) >> 24; // INT8 (한글)
          const base = i32at(b, 42);
          const attr = u32at(b, 46);
          const text = u32at(b, 52);
          const shade = u32at(b, 60);
          const cs: CharShape = {
            font: this.fonts[fontId],
            size: base / 100,
            italic: (attr & 1) !== 0,
            bold: (attr & 2) !== 0,
            underline: ((attr >> 2) & 3) === 1,
            sup: (attr & (1 << 15)) !== 0,
            sub: (attr & (1 << 16)) !== 0,
            strike: ((attr >> 18) & 7) !== 0,
            color: colorRefToHex(text),
            highlight: shade === 0xffffffff ? null : colorRefToHex(shade),
            spacing: spacing || undefined,
          };
          if (cs.highlight === '#FFFFFF') cs.highlight = null;
          this.charShapes.push(cs);
          break;
        }
        case TAG.PARA_SHAPE: {
          const b = rec.data;
          const a1 = u32at(b, 0);
          const left = i32at(b, 4);
          const right = i32at(b, 8);
          const indent = i32at(b, 12);
          const prev = i32at(b, 16);
          const next = i32at(b, 20);
          let lsType = a1 & 3;
          let ls = i32at(b, 24);
          if (b.length >= 54) {
            lsType = u32at(b, 46) & 0x1f;
            ls = u32at(b, 50);
          }
          const alignCode = (a1 >> 2) & 7;
          const align = (['justify', 'left', 'right', 'center', 'distribute', 'distribute'] as const)[alignCode] ?? 'justify';
          const headType = (a1 >> 23) & 3;
          const headLevel = ((a1 >> 25) & 7) + 1;
          this.paraShapes.push({
            align,
            left: paraUnitToPt(left),
            right: paraUnitToPt(right),
            indent: paraUnitToPt(indent),
            before: paraUnitToPt(prev),
            after: paraUnitToPt(next),
            lineHeight: lsType === 0 && ls > 0 ? ls : undefined,
            heading: headType === 1 ? headLevel : undefined,
          });
          break;
        }
        case TAG.STYLE: {
          const name = r.wstr(r.u16());
          r.wstr(r.u16());
          r.u8();
          r.u8();
          r.i16();
          const paraShape = r.u16();
          const charShape = r.u16();
          this.styles.push({ name, paraShape, charShape });
          break;
        }
      }
    }
  }

  binImage(binId: number): string | null {
    const item = this.binItems[binId - 1];
    if (!item || !item.ext) return null;
    const mime = mimeFromExt(item.ext);
    if (!mime) {
      this.warnings.push(`지원하지 않는 그림 형식(${item.ext.toUpperCase()})은 빠졌습니다.`);
      return null;
    }
    const name = `BIN${item.id.toString(16).toUpperCase().padStart(4, '0')}.${item.ext}`;
    const raw = this.stream(`BinData/${name}`) ?? this.stream(`BinData/${name.toLowerCase()}`);
    if (!raw) return null;
    const force = item.compress === 1 ? true : item.compress === 2 ? false : this.compressed;
    const data = this.decompress(raw, force);
    return `data:${mime};base64,${bytesToBase64(data)}`;
  }

  readSections(): PMNode[] {
    const blocks: PMNode[] = [];
    for (let i = 0; ; i++) {
      const raw = this.stream(`BodyText/Section${i}`);
      if (!raw) break;
      const recs = readRecords(this.decompress(raw));
      for (const r of recs) if (r.tag === TAG.PARA_HEADER) blocks.push(...this.paragraph(r));
    }
    return blocks;
  }

  readPageDef(ctrl: Rec) {
    const pd = ctrl.children.find((c) => c.tag === TAG.PAGE_DEF);
    if (!pd || this.pageFound) return;
    const b = pd.data;
    let w = u32at(b, 0), h = u32at(b, 4);
    const attr = u32at(b, 36);
    const landscape = (attr & 1) === 1;
    if (landscape && w > h) [w, h] = [h, w];
    this.page = {
      paper: paperNameFor(hwpToMm(w), hwpToMm(h)),
      width: hwpToMm(w),
      height: hwpToMm(h),
      landscape,
      marginLeft: hwpToMm(u32at(b, 8)),
      marginRight: hwpToMm(u32at(b, 12)),
      marginTop: hwpToMm(u32at(b, 16)),
      marginBottom: hwpToMm(u32at(b, 20)),
      marginHeader: hwpToMm(u32at(b, 24)),
      marginFooter: hwpToMm(u32at(b, 28)),
    };
    this.pageFound = true;
  }

  /** 문단 하나 → 블록 노드들 (표는 별도 블록으로 분리) */
  paragraph(ph: Rec): PMNode[] {
    const h = ph.data;
    const paraShapeId = u16at(h, 8);
    const styleId = h[10];
    const breakType = h[11];
    const style = this.styles[styleId];
    const ps: ParaStyle = { ...(this.paraShapes[paraShapeId] ?? {}) };
    const lvl = headingLevelFromStyleName(style?.name) ?? ps.heading;
    ps.heading = lvl && lvl <= 3 ? lvl : undefined;

    const textRec = ph.children.find((c) => c.tag === TAG.PARA_TEXT);
    const csRec = ph.children.find((c) => c.tag === TAG.PARA_CHAR_SHAPE);
    const ctrls = ph.children.filter((c) => c.tag === TAG.CTRL_HEADER);

    const shapeRuns: [number, number][] = [];
    if (csRec) for (let o = 0; o + 8 <= csRec.data.length; o += 8) shapeRuns.push([u32at(csRec.data, o), u32at(csRec.data, o + 4)]);
    if (!shapeRuns.length) shapeRuns.push([0, style?.charShape ?? 0]);
    const shapeAt = (pos: number) => {
      let id = shapeRuns[0][1];
      for (const [p, s] of shapeRuns) {
        if (p <= pos) id = s;
        else break;
      }
      return this.charShapes[id] ?? {};
    };

    const out: PMNode[] = [];
    if (breakType & 0x04) out.push({ type: 'pageBreak' });
    const inl = new InlineBuilder();
    const after: PMNode[] = [];
    const flush = () => {
      if (!inl.empty) out.push(paraNode(ps, inl.take()));
    };
    let ctrlIdx = 0;
    const b = textRec?.data ?? new Uint8Array(0);
    const n = b.length >> 1;
    let i = 0;
    while (i < n) {
      const c = u16at(b, i * 2);
      if (c < 32) {
        const isChar = c === 0 || c === 10 || c === 13 || c === 24 || c === 25 || c === 26 || c === 27 || c === 28 || c === 29 || c === 30 || c === 31;
        if (isChar) {
          if (c === 10) inl.push({ type: 'hardBreak' });
          else if (c === 24) inl.text('-', marksFor(shapeAt(i), !!ps.heading));
          else if (c === 30) inl.text(' ', marksFor(shapeAt(i), !!ps.heading));
          else if (c === 31) inl.text(' ', marksFor(shapeAt(i), !!ps.heading));
          i += 1;
          continue;
        }
        // 인라인/확장 컨트롤 (8 WCHAR)
        if (c === 9) inl.text('\t', marksFor(shapeAt(i), !!ps.heading));
        const extended = [1, 2, 3, 11, 12, 14, 15, 16, 17, 18, 21, 22, 23].includes(c);
        if (extended) {
          const ctrl = ctrls[ctrlIdx++];
          if (ctrl) {
            const id = chid(u32at(ctrl.data, 0));
            if (id === 'secd') this.readPageDef(ctrl);
            else if (id === 'tbl ') {
              flush();
              const t = this.table(ctrl);
              if (t) out.push(t);
            } else if (id === 'gso ') {
              const img = this.picture(ctrl);
              if (img) inl.push(img);
              else after.push(...this.shapeText(ctrl));
            }
          }
        }
        i += 8;
        continue;
      }
      // 일반 문자 (UTF-16 서로게이트 포함)
      let s = String.fromCharCode(c);
      let j = i + 1;
      const st = shapeAt(i);
      while (j < n) {
        const d = u16at(b, j * 2);
        if (d < 32) break;
        if (shapeAt(j) !== st) break;
        s += String.fromCharCode(d);
        j++;
      }
      inl.text(s, marksFor(st, !!ps.heading));
      i = j;
    }
    const content = inl.take();
    // 표만 있는 문단은 빈 문단을 따로 만들지 않는다
    if (content.length || !out.some((x) => x.type === 'table')) out.push(paraNode(ps, content));
    out.push(...after);
    return out;
  }

  /** 그리기 개체(글상자 등) 안의 문단 */
  shapeText(ctrl: Rec): PMNode[] {
    const out: PMNode[] = [];
    const visit = (rs: Rec[]) => {
      for (const r of rs) {
        if (r.tag === TAG.PARA_HEADER) out.push(...this.paragraph(r));
        else visit(r.children);
      }
    };
    visit(ctrl.children);
    return out;
  }

  picture(ctrl: Rec): PMNode | null {
    let pic: Rec | undefined;
    const find = (rs: Rec[]) => {
      for (const r of rs) {
        if (pic) return;
        if (r.tag === TAG.SHAPE_COMPONENT_PICTURE) pic = r;
        else find(r.children);
      }
    };
    find(ctrl.children);
    if (!pic) return null;
    const binId = u16at(pic.data, 71);
    const src = this.binImage(binId);
    if (!src) return null;
    const w = u32at(ctrl.data, 16);
    const h = u32at(ctrl.data, 20);
    return { type: 'image', attrs: { src, width: w ? Math.round(hwpToPx(w)) : null, height: h ? Math.round(hwpToPx(h)) : null } };
  }

  table(ctrl: Rec): PMNode | null {
    const tbl = ctrl.children.find((c) => c.tag === TAG.TABLE);
    if (!tbl) return null;
    type Cell = { row: number; col: number; rs: number; cs: number; w: number; bg: string | null; paras: PMNode[] };
    const cells: Cell[] = [];
    let cur: Cell | null = null;
    for (const c of ctrl.children) {
      if (c.tag === TAG.LIST_HEADER) {
        const d = c.data;
        cur = {
          col: u16at(d, 8),
          row: u16at(d, 10),
          cs: Math.max(1, u16at(d, 12)),
          rs: Math.max(1, u16at(d, 14)),
          w: u32at(d, 16),
          bg: this.borderFills[u16at(d, 32) - 1] ?? null,
          paras: [],
        };
        cells.push(cur);
      } else if (c.tag === TAG.PARA_HEADER && cur) {
        cur.paras.push(...this.paragraph(c));
      }
    }
    if (!cells.length) return null;
    const nodes = new Map<Cell, PMNode>();
    for (const c of cells) {
      const paras = c.paras.filter((p) => p.type !== 'pageBreak');
      nodes.set(c, {
        type: 'tableCell',
        attrs: { colspan: c.cs, rowspan: c.rs, colwidth: null, background: c.bg },
        content: paras.length ? paras : [{ type: 'paragraph' }],
      });
    }
    solveColumnWidths(cells.map((c) => ({ col: c.col, cs: c.cs, w: hwpToPx(c.w), node: nodes.get(c)! })));
    const rows = new Map<number, Cell[]>();
    for (const c of cells) {
      if (!rows.has(c.row)) rows.set(c.row, []);
      rows.get(c.row)!.push(c);
    }
    const content: PMNode[] = [...rows.keys()].sort((a, b) => a - b).map((r) => ({
      type: 'tableRow',
      content: rows.get(r)!.sort((a, b) => a.col - b.col).map((c) => nodes.get(c)!),
    }));
    return { type: 'table', content };
  }

  previewText(): string | null {
    const raw = this.stream('PrvText');
    if (!raw) return null;
    let s = '';
    for (let i = 0; i + 1 < raw.length; i += 2) s += String.fromCharCode(raw[i] | (raw[i + 1] << 8));
    return s.replace(/\0+$/, '');
  }
}

export function readHwp5(bytes: Uint8Array): HwpDocument {
  const r = new Hwp5Reader(bytes);
  r.readHeader();
  let blocks: PMNode[] = [];
  try {
    r.readDocInfo();
    blocks = r.readSections();
  } catch (e) {
    const text = r.previewText();
    if (!text) throw e;
    r.warnings.push('본문 구조를 읽지 못해 미리보기 텍스트만 가져왔습니다.');
    blocks = text.split(/\r?\n/).map((line) => ({ type: 'paragraph', content: line ? [{ type: 'text', text: line.replace(/<|>/g, '') }] : undefined }));
  }
  if (!blocks.length) blocks = [{ type: 'paragraph' }];
  // 연속된 쪽 나누기 정리
  blocks = blocks.filter((b, i) => !(b.type === 'pageBreak' && (i === 0 || blocks[i - 1].type === 'pageBreak')));
  return { doc: { type: 'doc', content: blocks }, page: r.page, warnings: [...new Set(r.warnings)] };
}
