import { Extension, Node, mergeAttributes } from '@tiptap/core';
import TableCell from '@tiptap/extension-table-cell';
import TableHeader from '@tiptap/extension-table-header';
import Image from '@tiptap/extension-image';
import { fontStack } from '../fonts';

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    paragraphFormat: {
      setParagraphAttrs: (attrs: Record<string, unknown>) => ReturnType;
      adjustIndent: (deltaPt: number) => ReturnType;
    };
    textFormat: {
      setTextAttrs: (attrs: Record<string, unknown>) => ReturnType;
    };
    pageBreak: {
      insertPageBreak: () => ReturnType;
    };
  }
}

const num = (v: string | null | undefined) => {
  if (v == null || v === '') return null;
  const x = parseFloat(v);
  return isFinite(x) ? x : null;
};
/** CSS 길이(px/pt/em) → pt */
const toPt = (v: string | null | undefined) => {
  if (!v) return null;
  const x = parseFloat(v);
  if (!isFinite(x)) return null;
  if (v.endsWith('px')) return Math.round(x * 0.75 * 10) / 10;
  if (v.endsWith('em')) return Math.round(x * 10 * 10) / 10;
  return x;
};

/** 문단 모양: 정렬 · 줄 간격 · 여백 · 들여쓰기/내어쓰기 · 문단 위/아래 간격 */
export const ParagraphFormat = Extension.create({
  name: 'paragraphFormat',
  addGlobalAttributes() {
    return [
      {
        types: ['paragraph', 'heading'],
        attributes: {
          textAlign: {
            default: 'justify',
            parseHTML: (el) => (el.getAttribute('data-align') || el.style.textAlign || 'justify').replace('start', 'left'),
            renderHTML: (a) => {
              const v = a.textAlign as string;
              if (v === 'distribute') return { 'data-align': 'distribute', style: 'text-align: justify; text-align-last: justify' };
              return { style: `text-align: ${v || 'justify'}` };
            },
          },
          lineHeight: {
            default: null,
            parseHTML: (el) => {
              const lh = el.style.lineHeight;
              if (!lh) return null;
              if (lh.endsWith('%')) return num(lh);
              const x = num(lh);
              return x && x < 10 ? Math.round(x * 100) : null;
            },
            renderHTML: (a) => (a.lineHeight ? { style: `line-height: ${Number(a.lineHeight) / 100}` } : {}),
          },
          indentLeft: {
            default: null,
            parseHTML: (el) => toPt(el.style.paddingLeft) || toPt(el.style.marginLeft),
            renderHTML: (a) => {
              // 한글의 내어쓰기: 첫 줄은 왼쪽 여백에서, 둘째 줄부터 더 들어간다
              const ind = Number(a.textIndent) || 0;
              const left = (Number(a.indentLeft) || 0) + (ind < 0 ? -ind : 0);
              if (!left) return {};
              return { style: left > 0 ? `padding-left: ${left}pt` : `margin-left: ${left}pt` };
            },
          },
          indentRight: {
            default: null,
            parseHTML: (el) => toPt(el.style.paddingRight),
            renderHTML: (a) => {
              const v = Number(a.indentRight) || 0;
              return v ? { style: v > 0 ? `padding-right: ${v}pt` : `margin-right: ${v}pt` } : {};
            },
          },
          textIndent: {
            default: null,
            parseHTML: (el) => toPt(el.style.textIndent),
            renderHTML: (a) => {
              const v = Number(a.textIndent);
              return v ? { style: `text-indent: ${v}pt` } : {};
            },
          },
          spaceBefore: {
            default: null,
            parseHTML: (el) => toPt(el.style.paddingTop),
            renderHTML: (a) => (a.spaceBefore ? { style: `padding-top: ${a.spaceBefore}pt` } : {}),
          },
          spaceAfter: {
            default: null,
            parseHTML: (el) => toPt(el.style.paddingBottom),
            renderHTML: (a) => (a.spaceAfter ? { style: `padding-bottom: ${a.spaceAfter}pt` } : {}),
          },
        },
      },
    ];
  },
  addCommands() {
    return {
      setParagraphAttrs:
        (attrs) =>
        ({ tr, state, dispatch }) => {
          const { from, to } = state.selection;
          let changed = false;
          state.doc.nodesBetween(from, to, (node, pos) => {
            if (node.type.name === 'paragraph' || node.type.name === 'heading') {
              tr.setNodeMarkup(pos, undefined, { ...node.attrs, ...attrs });
              changed = true;
              return false;
            }
            return true;
          });
          if (changed && dispatch) dispatch(tr);
          return changed;
        },
      adjustIndent:
        (delta) =>
        ({ tr, state, dispatch }) => {
          const { from, to } = state.selection;
          state.doc.nodesBetween(from, to, (node, pos) => {
            if (node.type.name === 'paragraph' || node.type.name === 'heading') {
              const cur = Number(node.attrs.indentLeft ?? 0);
              const next = Math.max(0, Math.round((cur + delta) * 10) / 10);
              tr.setNodeMarkup(pos, undefined, { ...node.attrs, indentLeft: next || null });
              return false;
            }
            return true;
          });
          if (dispatch) dispatch(tr);
          return true;
        },
    };
  },
  addKeyboardShortcuts() {
    return {
      'Mod-l': () => this.editor.commands.setParagraphAttrs({ textAlign: 'left' }),
      'Mod-e': () => this.editor.commands.setParagraphAttrs({ textAlign: 'center' }),
      'Mod-r': () => this.editor.commands.setParagraphAttrs({ textAlign: 'right' }),
      'Mod-j': () => this.editor.commands.setParagraphAttrs({ textAlign: 'justify' }),
    };
  },
});

/** 글자 모양: 글꼴 · 크기 · 색 · 자간 · 굵기 */
export const TextFormat = Extension.create({
  name: 'textFormat',
  addGlobalAttributes() {
    return [
      {
        types: ['textStyle'],
        attributes: {
          fontFamily: {
            default: null,
            parseHTML: (el) => el.getAttribute('data-font') || el.style.fontFamily?.split(',')[0]?.replace(/['"]/g, '').trim() || null,
            renderHTML: (a) => (a.fontFamily ? { 'data-font': a.fontFamily, style: `font-family: ${fontStack(a.fontFamily as string)}` } : {}),
          },
          fontSize: {
            default: null,
            parseHTML: (el) => toPt(el.style.fontSize),
            renderHTML: (a) => (a.fontSize ? { style: `font-size: ${a.fontSize}pt` } : {}),
          },
          color: {
            default: null,
            parseHTML: (el) => el.style.color || null,
            renderHTML: (a) => (a.color ? { style: `color: ${a.color}` } : {}),
          },
          letterSpacing: {
            default: null,
            parseHTML: (el) => {
              const v = el.style.letterSpacing;
              if (!v) return null;
              const x = parseFloat(v);
              return v.endsWith('em') ? Math.round(x * 100) : null;
            },
            renderHTML: (a) => (a.letterSpacing ? { style: `letter-spacing: ${Number(a.letterSpacing) / 100}em` } : {}),
          },
          fontWeight: {
            default: null,
            parseHTML: (el) => (el.style.fontWeight === '400' || el.style.fontWeight === 'normal' ? 400 : null),
            renderHTML: (a) => (a.fontWeight ? { style: `font-weight: ${a.fontWeight}` } : {}),
          },
        },
      },
    ];
  },
  addCommands() {
    return {
      setTextAttrs:
        (attrs) =>
        ({ chain }) =>
          chain().setMark('textStyle', attrs).removeEmptyTextStyle().run(),
    };
  },
});

const backgroundAttr = {
  background: {
    default: null as string | null,
    parseHTML: (el: HTMLElement) => el.getAttribute('data-bg') || el.style.backgroundColor || null,
    renderHTML: (a: Record<string, unknown>) => (a.background ? { 'data-bg': a.background, style: `background-color: ${a.background}` } : {}),
  },
};

export const HwpTableCell = TableCell.extend({
  addAttributes() {
    return { ...this.parent?.(), ...backgroundAttr };
  },
});

export const HwpTableHeader = TableHeader.extend({
  addAttributes() {
    return { ...this.parent?.(), ...backgroundAttr };
  },
});

export const HwpImage = Image.extend({
  inline: true,
  group: 'inline',
  draggable: true,
  addAttributes() {
    return {
      ...this.parent?.(),
      width: {
        default: null,
        parseHTML: (el) => num(el.getAttribute('width')) ?? num(el.style.width),
        renderHTML: (a) => (a.width ? { width: a.width, style: `width: ${a.width}px` } : {}),
      },
      height: {
        default: null,
        parseHTML: (el) => num(el.getAttribute('height')) ?? num(el.style.height),
        renderHTML: (a) => (a.height ? { height: a.height } : {}),
      },
    };
  },
}).configure({ inline: true, allowBase64: true });

/** 쪽 나누기 (Ctrl+Enter) */
export const PageBreak = Node.create({
  name: 'pageBreak',
  group: 'block',
  atom: true,
  selectable: true,
  parseHTML() {
    return [{ tag: 'div[data-page-break]' }, { tag: 'hr[data-page-break]' }];
  },
  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-page-break': '', class: 'page-break', contenteditable: 'false' }), ['span', {}, '쪽 나누기']];
  },
  addCommands() {
    return {
      insertPageBreak:
        () =>
        ({ chain }) =>
          chain().insertContent([{ type: 'pageBreak' }, { type: 'paragraph' }]).run(),
    };
  },
  addKeyboardShortcuts() {
    return {
      'Mod-Enter': () => this.editor.commands.insertPageBreak(),
    };
  },
});
