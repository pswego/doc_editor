/**
 * 편집기 문서(ProseMirror JSON) → HWPX(OWPML) 패키지
 * 구조: mimetype · version.xml · META-INF/* · Contents/{content.hpf, header.xml, section0.xml} · BinData/* · settings.xml · Preview/PrvText.txt
 */
import JSZip from 'jszip';
import { base64ToBytes } from './build';
import {
  DEFAULT_FONT, DEFAULT_LINE_HEIGHT, DEFAULT_SIZE, HEADING_DEFAULTS, mmToHwp, normalizeHex, pageDims, pxToHwp,
  type PageSetup, type PMMark, type PMNode,
} from './types';

const NS =
  'xmlns:ha="http://www.hancom.co.kr/hwpml/2011/app" ' +
  'xmlns:hp="http://www.hancom.co.kr/hwpml/2011/paragraph" ' +
  'xmlns:hp10="http://www.hancom.co.kr/hwpml/2016/paragraph" ' +
  'xmlns:hs="http://www.hancom.co.kr/hwpml/2011/section" ' +
  'xmlns:hc="http://www.hancom.co.kr/hwpml/2011/core" ' +
  'xmlns:hh="http://www.hancom.co.kr/hwpml/2011/head" ' +
  'xmlns:hhs="http://www.hancom.co.kr/hwpml/2011/history" ' +
  'xmlns:hm="http://www.hancom.co.kr/hwpml/2011/master-page" ' +
  'xmlns:hpf="http://www.hancom.co.kr/schema/2011/hpf" ' +
  'xmlns:dc="http://purl.org/dc/elements/1.1/" ' +
  'xmlns:opf="http://www.idpf.org/2007/opf/" ' +
  'xmlns:ooxmlchart="http://www.hancom.co.kr/hwpml/2016/ooxmlchart" ' +
  'xmlns:hwpunitchar="http://www.hancom.co.kr/hwpml/2016/HwpUnitChar" ' +
  'xmlns:epub="http://www.idpf.org/2007/ops" ' +
  'xmlns:config="urn:oasis:names:tc:opendocument:xmlns:config:1.0"';

const LANGS = ['HANGUL', 'LATIN', 'HANJA', 'JAPANESE', 'OTHER', 'SYMBOL', 'USER'];
const SERIF_HINT = /바탕|명조|궁서|Serif|Batang|Myeongjo/i;

export function esc(s: string) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

interface CharKey {
  font: string;
  size: number;
  bold: boolean;
  italic: boolean;
  underline: boolean;
  strike: boolean;
  sup: boolean;
  sub: boolean;
  color: string;
  shade: string;
  spacing: number;
}
interface ParaKey {
  align: string;
  left: number;
  right: number;
  indent: number;
  before: number;
  after: number;
  line: number;
}

class Registry<K> {
  list: K[] = [];
  map = new Map<string, number>();
  id(k: K) {
    const s = JSON.stringify(k);
    let i = this.map.get(s);
    if (i === undefined) {
      i = this.list.length;
      this.list.push(k);
      this.map.set(s, i);
    }
    return i;
  }
}

interface BinItem { id: string; href: string; mime: string; data: Uint8Array }

class HwpxWriter {
  fonts = new Registry<string>();
  chars = new Registry<CharKey>();
  paras = new Registry<ParaKey>();
  fills = new Registry<string>(); // 셀 배경색
  bins: BinItem[] = [];
  seq = 0;
  bodyWidth: number;
  preview: string[] = [];

  constructor(public page: PageSetup) {
    const d = pageDims(page);
    this.bodyWidth = mmToHwp(d.w - page.marginLeft - page.marginRight);
    this.fonts.id(DEFAULT_FONT);
    this.chars.id(this.charKey([], 0));
    this.paras.id(this.paraKey({}));
  }

  nextId() {
    return ++this.seq;
  }

  charKey(marks: PMMark[] | undefined, heading: number): CharKey {
    const hd = heading ? HEADING_DEFAULTS[heading] : undefined;
    const k: CharKey = {
      font: hd?.font ?? DEFAULT_FONT,
      size: hd?.size ?? DEFAULT_SIZE,
      bold: hd?.bold ?? false,
      italic: false,
      underline: false,
      strike: false,
      sup: false,
      sub: false,
      color: '#000000',
      shade: 'none',
      spacing: 0,
    };
    let boldMark = false;
    for (const m of marks ?? []) {
      const a = m.attrs ?? {};
      switch (m.type) {
        case 'bold': boldMark = true; break;
        case 'italic': k.italic = true; break;
        case 'underline': k.underline = true; break;
        case 'strike': k.strike = true; break;
        case 'superscript': k.sup = true; break;
        case 'subscript': k.sub = true; break;
        case 'highlight': k.shade = normalizeHex(a.color) ?? '#FFFF00'; break;
        case 'textStyle':
          if (typeof a.fontFamily === 'string' && a.fontFamily) k.font = a.fontFamily;
          if (a.fontSize) k.size = Number(a.fontSize);
          if (a.color) k.color = normalizeHex(a.color) ?? '#000000';
          if (a.letterSpacing) k.spacing = Math.max(-50, Math.min(50, Math.round(Number(a.letterSpacing))));
          if (Number(a.fontWeight) === 400) k.bold = false;
          break;
      }
    }
    if (boldMark) k.bold = true;
    this.fonts.id(k.font);
    return k;
  }

  paraKey(attrs: Record<string, unknown>): ParaKey {
    const num = (v: unknown) => (typeof v === 'number' && isFinite(v) ? v : 0);
    const align = String(attrs.textAlign ?? 'justify');
    return {
      align: ({ left: 'LEFT', right: 'RIGHT', center: 'CENTER', justify: 'JUSTIFY', distribute: 'DISTRIBUTE' } as Record<string, string>)[align] ?? 'JUSTIFY',
      left: num(attrs.indentLeft),
      right: num(attrs.indentRight),
      indent: num(attrs.textIndent),
      before: num(attrs.spaceBefore),
      after: num(attrs.spaceAfter),
      line: num(attrs.lineHeight) || DEFAULT_LINE_HEIGHT,
    };
  }

  // ── 본문 ───────────────────────────────
  section(doc: PMNode): string {
    const blocks = doc.content ?? [];
    const out: string[] = [];
    let pendingBreak = false;
    let first = true;
    const secPr = this.secPr();
    for (const b of this.flatten(blocks, 0)) {
      if (b.type === 'pageBreak') {
        pendingBreak = true;
        continue;
      }
      out.push(this.paragraph(b, pendingBreak, first ? secPr : ''));
      pendingBreak = false;
      first = false;
    }
    if (first) out.push(this.paragraph({ type: 'paragraph' }, false, secPr));
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes" ?><hs:sec ${NS}>${out.join('')}</hs:sec>`;
  }

  /** 목록·인용 등 HWP 에 없는 블록을 문단으로 평탄화 */
  flatten(blocks: PMNode[], depth: number): PMNode[] {
    const out: PMNode[] = [];
    for (const b of blocks) {
      switch (b.type) {
        case 'bulletList':
        case 'orderedList': {
          let n = Number(b.attrs?.start ?? 1);
          for (const li of b.content ?? []) {
            const inner = li.content ?? [];
            inner.forEach((child, idx) => {
              if (child.type === 'paragraph' || child.type === 'heading') {
                const prefix = idx === 0 ? (b.type === 'bulletList' ? (depth % 2 ? '◦ ' : '• ') : `${n}. `) : '';
                const attrs = { ...(child.attrs ?? {}), indentLeft: Number(child.attrs?.indentLeft ?? 0) + 12 * (depth + 1), textIndent: idx === 0 ? -10 : 0 };
                out.push({ ...child, attrs, content: prefix ? [{ type: 'text', text: prefix }, ...(child.content ?? [])] : child.content });
              } else out.push(...this.flatten([child], depth + 1));
            });
            n++;
          }
          break;
        }
        case 'blockquote':
          for (const c of this.flatten(b.content ?? [], depth)) {
            out.push({ ...c, attrs: { ...(c.attrs ?? {}), indentLeft: Number(c.attrs?.indentLeft ?? 0) + 20 } });
          }
          break;
        case 'horizontalRule':
          out.push({ type: 'paragraph', attrs: { textAlign: 'center' }, content: [{ type: 'text', text: '―'.repeat(20) }] });
          break;
        case 'codeBlock':
          for (const line of (b.content ?? []).map((t) => t.text ?? '').join('').split('\n')) {
            out.push({ type: 'paragraph', attrs: { textAlign: 'left' }, content: line ? [{ type: 'text', text: line, marks: [{ type: 'textStyle', attrs: { fontFamily: '함초롬돋움' } }] }] : undefined });
          }
          break;
        default:
          out.push(b);
      }
    }
    return out;
  }

  paragraph(b: PMNode, pageBreak: boolean, prefixRun: string): string {
    const heading = b.type === 'heading' ? Number(b.attrs?.level ?? 1) : 0;
    const styleId = heading ? Math.min(heading, 3) : 0;
    const paraPr = this.paras.id(this.paraKey(b.attrs ?? {}));
    const runs: string[] = [];
    if (prefixRun) runs.push(`<hp:run charPrIDRef="0">${prefixRun}</hp:run>`);
    let previewLine = '';

    if (b.type === 'table') {
      runs.push(`<hp:run charPrIDRef="0">${this.table(b)}</hp:run>`);
      previewLine = '';
    } else {
      // 같은 글자 모양끼리 run 으로 묶기
      let curChar = -1;
      let buf = '';
      const flush = () => {
        if (curChar >= 0) runs.push(`<hp:run charPrIDRef="${curChar}"><hp:t>${buf}</hp:t></hp:run>`);
        curChar = -1;
        buf = '';
      };
      for (const n of b.content ?? []) {
        if (n.type === 'text') {
          const id = this.chars.id(this.charKey(n.marks, heading));
          if (id !== curChar) {
            flush();
            curChar = id;
          }
          const parts = (n.text ?? '').split('\t');
          buf += parts.map(esc).join('<hp:tab width="4000" leader="NONE" type="LEFT"/>');
          previewLine += n.text ?? '';
        } else if (n.type === 'hardBreak') {
          if (curChar < 0) curChar = this.chars.id(this.charKey(undefined, heading));
          buf += '<hp:lineBreak/>';
          previewLine += ' ';
        } else if (n.type === 'image') {
          flush();
          const pic = this.picture(n);
          if (pic) runs.push(`<hp:run charPrIDRef="0">${pic}<hp:t/></hp:run>`);
        }
      }
      flush();
      if (!runs.length || (prefixRun && runs.length === 1)) {
        runs.push(`<hp:run charPrIDRef="${this.chars.id(this.charKey(undefined, heading))}"/>`);
      }
    }
    if (previewLine) this.preview.push(previewLine);
    return `<hp:p id="${this.nextId()}" paraPrIDRef="${paraPr}" styleIDRef="${styleId}" pageBreak="${pageBreak ? 1 : 0}" columnBreak="0" merged="0">${runs.join('')}</hp:p>`;
  }

  table(t: PMNode): string {
    // 격자 배치 계산 (rowspan/colspan)
    const rows = t.content ?? [];
    const occ: boolean[][] = [];
    type Placed = { r: number; c: number; cs: number; rs: number; node: PMNode };
    const placed: Placed[] = [];
    let colCnt = 0;
    rows.forEach((row, r) => {
      occ[r] ??= [];
      let c = 0;
      for (const cell of row.content ?? []) {
        while (occ[r][c]) c++;
        const cs = Math.max(1, Number(cell.attrs?.colspan ?? 1));
        const rs = Math.max(1, Number(cell.attrs?.rowspan ?? 1));
        for (let dr = 0; dr < rs; dr++) {
          occ[r + dr] ??= [];
          for (let dc = 0; dc < cs; dc++) occ[r + dr][c + dc] = true;
        }
        placed.push({ r, c, cs, rs, node: cell });
        c += cs;
        colCnt = Math.max(colCnt, c);
      }
    });
    const rowCnt = Math.max(rows.length, occ.length);
    colCnt = Math.max(1, colCnt);
    // 열 너비: colwidth(px) 이 있으면 비율, 없으면 균등. 본문 폭에 맞춤
    const raw: (number | null)[] = Array(colCnt).fill(null);
    for (const p of placed) {
      const cw = p.node.attrs?.colwidth as number[] | null | undefined;
      if (cw && p.cs === cw.length) cw.forEach((w, k) => { if (w && raw[p.c + k] == null) raw[p.c + k] = w; });
    }
    const known = raw.filter((x): x is number => x != null);
    const avg = known.length ? known.reduce((a, b) => a + b, 0) / known.length : 100;
    const filled = raw.map((x) => x ?? avg);
    const sum = filled.reduce((a, b) => a + b, 0);
    // 모든 열 너비를 알면 원래 크기 그대로, 아니면 본문 폭에 맞춤
    const totalW = known.length === colCnt ? pxToHwp(sum) : this.bodyWidth;
    const colW = filled.map((w) => Math.max(500, Math.floor((w / sum) * totalW)));
    const ROW_H = 1800;
    const tableW = colW.reduce((a, b) => a + b, 0);

    const byRow: Placed[][] = Array.from({ length: rowCnt }, () => []);
    placed.forEach((p) => byRow[p.r].push(p));
    const prevPreviewLen = this.preview.length;
    const trs = byRow.map((cells) => {
      const tcs = cells.map((p) => {
        const isHeader = p.node.type === 'tableHeader';
        const bg = normalizeHex(p.node.attrs?.background) ?? (isHeader ? '#EEF1F5' : null);
        const bf = bg ? 3 + this.fills.id(bg) : 2;
        let w = 0;
        for (let k = 0; k < p.cs; k++) w += colW[p.c + k] ?? colW[0];
        const inner = this.flatten(p.node.content ?? [{ type: 'paragraph' }], 0)
          .filter((x) => x.type !== 'pageBreak')
          .map((x) => this.paragraph(x, false, ''))
          .join('') || this.paragraph({ type: 'paragraph' }, false, '');
        return (
          `<hp:tc name="" header="${isHeader ? 1 : 0}" hasMargin="0" protect="0" editable="0" dirty="0" borderFillIDRef="${bf}">` +
          `<hp:subList id="" textDirection="HORIZONTAL" lineWrap="BREAK" vertAlign="CENTER" linkListIDRef="0" linkListNextIDRef="0" textWidth="0" textHeight="0" hasTextRef="0" hasNumRef="0">${inner}</hp:subList>` +
          `<hp:cellAddr colAddr="${p.c}" rowAddr="${p.r}"/>` +
          `<hp:cellSpan colSpan="${p.cs}" rowSpan="${p.rs}"/>` +
          `<hp:cellSz width="${w}" height="${ROW_H * p.rs}"/>` +
          `<hp:cellMargin left="510" right="510" top="141" bottom="141"/>` +
          `</hp:tc>`
        );
      });
      return `<hp:tr>${tcs.join('')}</hp:tr>`;
    });
    // 미리보기 텍스트: 셀 단위 < > 표기
    const cellLines = this.preview.splice(prevPreviewLen);
    if (cellLines.length) this.preview.push(cellLines.map((l) => `<${l}>`).join(''));
    return (
      `<hp:tbl id="${this.nextId()}" zOrder="0" numberingType="TABLE" textWrap="TOP_AND_BOTTOM" textFlow="BOTH_SIDES" lock="0" dropcapstyle="None" pageBreak="CELL" repeatHeader="1" rowCnt="${rowCnt}" colCnt="${colCnt}" cellSpacing="0" borderFillIDRef="2" noAdjust="0">` +
      `<hp:sz width="${tableW}" widthRelTo="ABSOLUTE" height="${ROW_H * rowCnt}" heightRelTo="ABSOLUTE" protect="0"/>` +
      `<hp:pos treatAsChar="1" affectLSpacing="0" flowWithText="1" allowOverlap="0" holdAnchorAndSO="0" vertRelTo="PARA" horzRelTo="COLUMN" vertAlign="TOP" horzAlign="LEFT" vertOffset="0" horzOffset="0"/>` +
      `<hp:outMargin left="283" right="283" top="283" bottom="283"/>` +
      `<hp:inMargin left="510" right="510" top="141" bottom="141"/>` +
      trs.join('') +
      `</hp:tbl>`
    );
  }

  picture(n: PMNode): string | null {
    const src = String(n.attrs?.src ?? '');
    const m = /^data:(image\/[a-z0-9.+-]+);base64,(.*)$/i.exec(src);
    if (!m) return null;
    const mime = m[1].toLowerCase();
    const ext = ({ 'image/jpeg': 'jpg', 'image/png': 'png', 'image/gif': 'gif', 'image/bmp': 'bmp', 'image/webp': 'png' } as Record<string, string>)[mime];
    if (!ext) return null;
    const idx = this.bins.length + 1;
    const item: BinItem = { id: `image${idx}`, href: `BinData/image${idx}.${ext}`, mime, data: base64ToBytes(m[2]) };
    this.bins.push(item);
    let wpx = Number(n.attrs?.width) || 0;
    let hpx = Number(n.attrs?.height) || 0;
    const nat = imageSize(item.data);
    if (!wpx && !hpx && nat) { wpx = nat.w; hpx = nat.h; }
    else if (wpx && !hpx) hpx = nat ? (wpx * nat.h) / nat.w : wpx * 0.75;
    else if (!wpx && hpx) wpx = nat ? (hpx * nat.w) / nat.h : hpx / 0.75;
    if (!wpx) { wpx = 400; hpx = 300; }
    const w = pxToHwp(wpx);
    const h = pxToHwp(hpx);
    const ow = nat ? pxToHwp(nat.w) : w;
    const oh = nat ? pxToHwp(nat.h) : h;
    return (
      `<hp:pic id="${this.nextId()}" zOrder="0" numberingType="PICTURE" textWrap="TOP_AND_BOTTOM" textFlow="BOTH_SIDES" lock="0" dropcapstyle="None" href="" groupLevel="0" instid="${this.nextId()}" reverse="0">` +
      `<hp:offset x="0" y="0"/><hp:orgSz width="${ow}" height="${oh}"/><hp:curSz width="${w}" height="${h}"/>` +
      `<hp:flip horizontal="0" vertical="0"/>` +
      `<hp:rotationInfo angle="0" centerX="${(w / 2) | 0}" centerY="${(h / 2) | 0}" rotateimage="1"/>` +
      `<hp:renderingInfo><hc:transMatrix e1="1" e2="0" e3="0" e4="0" e5="1" e6="0"/><hc:scaMatrix e1="${(w / ow).toFixed(6)}" e2="0" e3="0" e4="0" e5="${(h / oh).toFixed(6)}" e6="0"/><hc:rotMatrix e1="1" e2="0" e3="0" e4="0" e5="1" e6="0"/></hp:renderingInfo>` +
      `<hc:img binaryItemIDRef="${item.id}" bright="0" contrast="0" effect="REAL_PIC" alpha="0"/>` +
      `<hp:imgRect><hc:pt0 x="0" y="0"/><hc:pt1 x="${ow}" y="0"/><hc:pt2 x="${ow}" y="${oh}"/><hc:pt3 x="0" y="${oh}"/></hp:imgRect>` +
      `<hp:imgClip left="0" right="${ow}" top="0" bottom="${oh}"/>` +
      `<hp:inMargin left="0" right="0" top="0" bottom="0"/>` +
      `<hp:imgDim dimwidth="${ow}" dimheight="${oh}"/>` +
      `<hp:effects/>` +
      `<hp:sz width="${w}" widthRelTo="ABSOLUTE" height="${h}" heightRelTo="ABSOLUTE" protect="0"/>` +
      `<hp:pos treatAsChar="1" affectLSpacing="0" flowWithText="1" allowOverlap="0" holdAnchorAndSO="0" vertRelTo="PARA" horzRelTo="PARA" vertAlign="TOP" horzAlign="LEFT" vertOffset="0" horzOffset="0"/>` +
      `<hp:outMargin left="0" right="0" top="0" bottom="0"/>` +
      `</hp:pic>`
    );
  }

  secPr(): string {
    const p = this.page;
    const pn = (type: string) =>
      `<hp:pageBorderFill type="${type}" borderFillIDRef="1" textBorder="PAPER" headerInside="0" footerInside="0" fillArea="PAPER"><hp:offset left="1417" right="1417" top="1417" bottom="1417"/></hp:pageBorderFill>`;
    return (
      `<hp:secPr id="" textDirection="HORIZONTAL" spaceColumns="1134" tabStop="8000" tabStopVal="4000" tabStopUnit="HWPUNIT" outlineShapeIDRef="1" memoShapeIDRef="0" textVerticalWidthHead="0" masterPageCnt="0">` +
      `<hp:grid lineGrid="0" charGrid="0" wonggojiFormat="0"/>` +
      `<hp:startNum pageStartsOn="BOTH" page="0" pic="0" tbl="0" equation="0"/>` +
      `<hp:visibility hideFirstHeader="0" hideFirstFooter="0" hideFirstMasterPage="0" border="SHOW_ALL" fill="SHOW_ALL" hideFirstPageNum="0" hideFirstEmptyLine="0" showLineNumber="0"/>` +
      `<hp:lineNumberShape restartType="0" countBy="0" distance="0" startNumber="0"/>` +
      `<hp:pagePr landscape="${p.landscape ? 'NARROWLY' : 'WIDELY'}" width="${mmToHwp(p.width)}" height="${mmToHwp(p.height)}" gutterType="LEFT_ONLY">` +
      `<hp:margin header="${mmToHwp(p.marginHeader)}" footer="${mmToHwp(p.marginFooter)}" gutter="0" left="${mmToHwp(p.marginLeft)}" right="${mmToHwp(p.marginRight)}" top="${mmToHwp(p.marginTop)}" bottom="${mmToHwp(p.marginBottom)}"/>` +
      `</hp:pagePr>` +
      `<hp:footNotePr><hp:autoNumFormat type="DIGIT" userChar="" prefixChar="" suffixChar=")" supscript="0"/><hp:noteLine length="-1" type="SOLID" width="0.12 mm" color="#000000"/><hp:noteSpacing betweenNotes="283" belowLine="567" aboveLine="850"/><hp:numbering type="CONTINUOUS" newNum="1"/><hp:placement place="EACH_COLUMN" beneathText="0"/></hp:footNotePr>` +
      `<hp:endNotePr><hp:autoNumFormat type="DIGIT" userChar="" prefixChar="" suffixChar=")" supscript="0"/><hp:noteLine length="14692344" type="SOLID" width="0.12 mm" color="#000000"/><hp:noteSpacing betweenNotes="0" belowLine="567" aboveLine="850"/><hp:numbering type="CONTINUOUS" newNum="1"/><hp:placement place="END_OF_DOCUMENT" beneathText="0"/></hp:endNotePr>` +
      pn('BOTH') + pn('EVEN') + pn('ODD') +
      `</hp:secPr>` +
      `<hp:ctrl><hp:colPr id="" type="NEWSPAPER" layout="LEFT" colCount="1" sameSz="1" sameGap="0"/></hp:ctrl>`
    );
  }

  // ── 머리 정보 ───────────────────────────
  header(): string {
    // 스타일(개요 1~3)이 참조할 글자 모양을 먼저 등록 (글꼴 목록에도 반영되도록)
    const styleChars = [1, 2, 3].map((lv) => this.chars.id(this.charKey(undefined, lv)));
    const fonts = this.fonts.list;
    const fontXml = (f: string, i: number) =>
      `<hh:font id="${i}" face="${esc(f)}" type="TTF" isEmbedded="0"><hh:typeInfo familyType="${SERIF_HINT.test(f) ? 'FCAT_MYUNGJO' : 'FCAT_GOTHIC'}" weight="6" proportion="4" contrast="0" strokeVariation="1" armStyle="1" letterform="1" midline="1" xHeight="1"/></hh:font>`;
    const fontfaces = LANGS.map((l) => `<hh:fontface lang="${l}" fontCnt="${fonts.length}">${fonts.map(fontXml).join('')}</hh:fontface>`).join('');

    const border = (side: string, type: string) => `<hh:${side} type="${type}" width="0.12 mm" color="#000000"/>`;
    const bf = (id: number, type: string, fill?: string) =>
      `<hh:borderFill id="${id}" threeD="0" shadow="0" centerLine="NONE" breakCellSeparateLine="0">` +
      `<hh:slash type="NONE" Crooked="0" isCounter="0"/><hh:backSlash type="NONE" Crooked="0" isCounter="0"/>` +
      border('leftBorder', type) + border('rightBorder', type) + border('topBorder', type) + border('bottomBorder', type) +
      `<hh:diagonal type="SOLID" width="0.1 mm" color="#000000"/>` +
      (fill ? `<hc:fillBrush><hc:winBrush faceColor="${fill}" hatchColor="#999999" alpha="0"/></hc:fillBrush>` : '') +
      `</hh:borderFill>`;
    const fills = this.fills.list;
    const borderFills = `<hh:borderFills itemCnt="${2 + fills.length}">${bf(1, 'NONE')}${bf(2, 'SOLID')}${fills.map((c, i) => bf(3 + i, 'SOLID', c)).join('')}</hh:borderFills>`;

    const all7 = (v: number | string) => LANGS.map((l) => `${l.toLowerCase()}="${v}"`).join(' ');
    const charPr = (k: CharKey, id: number) => {
      const f = this.fonts.id(k.font);
      return (
        `<hh:charPr id="${id}" height="${Math.round(k.size * 100)}" textColor="${k.color}" shadeColor="${k.shade}" useFontSpace="0" useKerning="0" symMark="NONE" borderFillIDRef="1">` +
        `<hh:fontRef ${all7(f)}/><hh:ratio ${all7(100)}/><hh:spacing ${all7(k.spacing)}/><hh:relSz ${all7(100)}/><hh:offset ${all7(0)}/>` +
        (k.italic ? '<hh:italic/>' : '') +
        (k.bold ? '<hh:bold/>' : '') +
        `<hh:underline type="${k.underline ? 'BOTTOM' : 'NONE'}" shape="SOLID" color="${k.color}"/>` +
        `<hh:strikeout shape="${k.strike ? 'SOLID' : 'NONE'}" color="${k.color}"/>` +
        `<hh:outline type="NONE"/><hh:shadow type="NONE" color="#B2B2B2" offsetX="10" offsetY="10"/>` +
        (k.sup ? '<hh:supscript/>' : k.sub ? '<hh:subscript/>' : '') +
        `</hh:charPr>`
      );
    };
    const charProps = `<hh:charProperties itemCnt="${this.chars.list.length}">${this.chars.list.map(charPr).join('')}</hh:charProperties>`;

    const margins = (k: ParaKey, mul: number) =>
      `<hh:margin><hc:intent value="${Math.round(k.indent * mul)}" unit="HWPUNIT"/><hc:left value="${Math.round(k.left * mul)}" unit="HWPUNIT"/><hc:right value="${Math.round(k.right * mul)}" unit="HWPUNIT"/><hc:prev value="${Math.round(k.before * mul)}" unit="HWPUNIT"/><hc:next value="${Math.round(k.after * mul)}" unit="HWPUNIT"/></hh:margin>` +
      `<hh:lineSpacing type="PERCENT" value="${Math.round(k.line)}" unit="HWPUNIT"/>`;
    const paraPr = (k: ParaKey, id: number) =>
      `<hh:paraPr id="${id}" tabPrIDRef="0" condense="0" fontLineHeight="0" snapToGrid="1" suppressLineNumbers="0" checked="0">` +
      `<hh:align horizontal="${k.align}" vertical="BASELINE"/>` +
      `<hh:heading type="NONE" idRef="0" level="0"/>` +
      `<hh:breakSetting breakLatinWord="KEEP_WORD" breakNonLatinWord="KEEP_WORD" widowOrphan="0" keepWithNext="0" keepLines="0" pageBreakBefore="0" lineWrap="BREAK"/>` +
      `<hh:autoSpacing eAsianEng="0" eAsianNum="0"/>` +
      // HwpUnitChar 를 아는 읽기 프로그램은 case(실제 HWPUNIT), 나머지는 default(×2) 값을 쓴다
      `<hp:switch><hp:case hp:required-namespace="http://www.hancom.co.kr/hwpml/2016/HwpUnitChar">${margins(k, 100)}</hp:case><hp:default>${margins(k, 200)}</hp:default></hp:switch>` +
      `<hh:border borderFillIDRef="1" offsetLeft="0" offsetRight="0" offsetTop="0" offsetBottom="0" connect="0" ignoreMargin="0"/>` +
      `</hh:paraPr>`;
    const paraProps = `<hh:paraProperties itemCnt="${this.paras.list.length}">${this.paras.list.map(paraPr).join('')}</hh:paraProperties>`;

    const styles =
      `<hh:styles itemCnt="4">` +
      `<hh:style id="0" type="PARA" name="바탕글" engName="Normal" paraPrIDRef="0" charPrIDRef="0" nextStyleIDRef="0" langID="1042" lockForm="0"/>` +
      [1, 2, 3].map((lv, i) => `<hh:style id="${lv}" type="PARA" name="개요 ${lv}" engName="Outline ${lv}" paraPrIDRef="0" charPrIDRef="${styleChars[i]}" nextStyleIDRef="0" langID="1042" lockForm="0"/>`).join('') +
      `</hh:styles>`;

    return (
      `<?xml version="1.0" encoding="UTF-8" standalone="yes" ?><hh:head ${NS} version="1.4" secCnt="1">` +
      `<hh:beginNum page="1" footnote="1" endnote="1" pic="1" tbl="1" equation="1"/>` +
      `<hh:refList>` +
      `<hh:fontfaces itemCnt="${LANGS.length}">${fontfaces}</hh:fontfaces>` +
      borderFills +
      charProps +
      `<hh:tabProperties itemCnt="1"><hh:tabPr id="0" autoTabLeft="0" autoTabRight="0"/></hh:tabProperties>` +
      `<hh:numberings itemCnt="1"><hh:numbering id="1" start="0">${[1, 2, 3, 4, 5, 6, 7].map((lv) => `<hh:paraHead start="1" level="${lv}" align="LEFT" useInstWidth="1" autoIndent="1" widthAdjust="0" textOffsetType="PERCENT" textOffset="50" numFormat="DIGIT" charPrIDRef="4294967295" checkable="0">^${lv}.</hh:paraHead>`).join('')}</hh:numbering></hh:numberings>` +
      paraProps +
      styles +
      `</hh:refList>` +
      `<hh:compatibleDocument targetProgram="HWP201X"><hh:layoutCompatibility/></hh:compatibleDocument>` +
      `<hh:docOption><hh:linkinfo path="" pageInherit="0" footnoteInherit="0"/></hh:docOption>` +
      `</hh:head>`
    );
  }
}

/** PNG/JPEG/GIF/BMP 치수 읽기 */
export function imageSize(b: Uint8Array): { w: number; h: number } | null {
  if (b.length > 24 && b[0] === 0x89 && b[1] === 0x50) {
    const dv = new DataView(b.buffer, b.byteOffset);
    return { w: dv.getUint32(16), h: dv.getUint32(20) };
  }
  if (b.length > 10 && b[0] === 0x47 && b[1] === 0x49) return { w: b[6] | (b[7] << 8), h: b[8] | (b[9] << 8) };
  if (b.length > 26 && b[0] === 0x42 && b[1] === 0x4d) {
    const dv = new DataView(b.buffer, b.byteOffset);
    return { w: dv.getInt32(18, true), h: Math.abs(dv.getInt32(22, true)) };
  }
  if (b[0] === 0xff && b[1] === 0xd8) {
    let p = 2;
    while (p + 9 < b.length) {
      if (b[p] !== 0xff) { p++; continue; }
      const marker = b[p + 1];
      const len = (b[p + 2] << 8) | b[p + 3];
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        return { h: (b[p + 5] << 8) | b[p + 6], w: (b[p + 7] << 8) | b[p + 8] };
      }
      p += 2 + len;
    }
  }
  return null;
}

export async function writeHwpx(doc: PMNode, page: PageSetup, title = ''): Promise<Uint8Array> {
  const w = new HwpxWriter(page);
  const section = w.section(doc);
  const header = w.header();
  const zip = new JSZip();
  zip.file('mimetype', 'application/hwp+zip', { compression: 'STORE' });
  zip.file(
    'version.xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes" ?><hv:HCFVersion xmlns:hv="http://www.hancom.co.kr/hwpml/2011/version" tagetApplication="WORDPROCESSOR" major="5" minor="1" micro="0" buildNumber="1" os="1" xmlVersion="1.4" application="DocEditor" appVersion="0.1"/>`,
  );
  zip.file(
    'META-INF/container.xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes" ?><ocf:container xmlns:ocf="urn:oasis:names:tc:opendocument:xmlns:container" xmlns:hpf="http://www.hancom.co.kr/schema/2011/hpf"><ocf:rootfiles><ocf:rootfile full-path="Contents/content.hpf" media-type="application/hwpml-package+xml"/><ocf:rootfile full-path="Preview/PrvText.txt" media-type="text/plain"/></ocf:rootfiles></ocf:container>`,
  );
  zip.file('META-INF/manifest.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes" ?><odf:manifest xmlns:odf="urn:oasis:names:tc:opendocument:xmlns:manifest:1.0"/>`);
  const items = [
    `<opf:item id="header" href="Contents/header.xml" media-type="application/xml"/>`,
    ...w.bins.map((b) => `<opf:item id="${b.id}" href="${b.href}" media-type="${b.mime}" isEmbeded="1"/>`),
    `<opf:item id="section0" href="Contents/section0.xml" media-type="application/xml"/>`,
    `<opf:item id="settings" href="settings.xml" media-type="application/xml"/>`,
  ];
  zip.file(
    'Contents/content.hpf',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes" ?><opf:package ${NS} version="" unique-identifier="" id="">` +
      `<opf:metadata><opf:title>${esc(title)}</opf:title><opf:language>ko</opf:language></opf:metadata>` +
      `<opf:manifest>${items.join('')}</opf:manifest>` +
      `<opf:spine><opf:itemref idref="header" linear="yes"/><opf:itemref idref="section0" linear="yes"/></opf:spine>` +
      `</opf:package>`,
  );
  zip.file('Contents/header.xml', header);
  zip.file('Contents/section0.xml', section);
  zip.file(
    'settings.xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes" ?><ha:HWPApplicationSetting xmlns:ha="http://www.hancom.co.kr/hwpml/2011/app" xmlns:config="urn:oasis:names:tc:opendocument:xmlns:config:1.0"><ha:CaretPosition listIDRef="0" paraIDRef="0" pos="0"/></ha:HWPApplicationSetting>`,
  );
  for (const b of w.bins) zip.file(b.href, b.data, { compression: /png|jpe?g|gif/.test(b.mime) ? 'STORE' : 'DEFLATE' });
  zip.file('Preview/PrvText.txt', w.preview.join('\r\n').slice(0, 2000));
  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE', mimeType: 'application/hwp+zip' });
}
