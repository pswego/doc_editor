/**
 * 쪽 윤곽 보기: 본문을 실제 쪽 크기로 나누어 쪽 사이 간격을 그린다.
 * - 문단은 줄 단위로 다음 쪽으로 넘긴다 (줄 시작 위치에 인라인 위젯 삽입)
 * - 표·그림처럼 나눌 수 없는 블록은 통째로 다음 쪽으로 넘긴다
 * - 쪽 나누기 노드 다음은 항상 새 쪽
 */
import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet, type EditorView } from '@tiptap/pm/view';
import type { Node as PMNode } from '@tiptap/pm/model';

export interface PaginationOptions {
  enabled: boolean;
  /** 본문 높이 (CSS px) */
  contentHeight: number;
  padTop: number;
  padBottom: number;
  padLeft: number;
  paperWidth: number;
  gap: number;
}

export interface PageLayout {
  pages: number;
  /** 마지막 쪽을 채우기 위한 여분 높이 (px) */
  lastFill: number;
  /** 각 쪽(2쪽부터)이 시작하는 문서 위치 */
  starts: number[];
}

interface Brk {
  pos: number;
  remaining: number;
  inline: boolean;
  offset: number;
  page: number;
}

const key = new PluginKey<{ deco: DecorationSet; sig: string }>('pagination');

function gapDom(b: Brk, o: PaginationOptions) {
  const el = document.createElement(b.inline ? 'span' : 'div');
  el.className = 'pm-page-gap';
  el.contentEditable = 'false';
  el.setAttribute('aria-hidden', 'true');
  const bottom = Math.max(0, b.remaining) + o.padBottom;
  el.style.cssText = `display:block;height:${bottom + o.gap + o.padTop}px;width:${o.paperWidth + 64}px;margin-left:${-(b.offset + 32)}px;text-indent:0`;
  const mk = (cls: string, h: number) => {
    const d = document.createElement('span');
    d.className = cls;
    d.style.height = `${h}px`;
    el.appendChild(d);
    return d;
  };
  const foot = mk('pg-foot', bottom);
  const num = document.createElement('span');
  num.className = 'pg-num';
  num.textContent = `- ${b.page - 1} -`;
  num.style.bottom = `${Math.max(12, o.padBottom * 0.45)}px`;
  foot.appendChild(num);
  mk('pg-band', o.gap);
  mk('pg-head', o.padTop);
  return el;
}

function lineBoxes(dom: HTMLElement, originTop: number, scale: number) {
  const range = document.createRange();
  range.selectNodeContents(dom);
  const rects = Array.from(range.getClientRects()).filter((r) => r.width > 0 && r.height > 0);
  const lines: { top: number; bottom: number; left: number; cy: number }[] = [];
  for (const r of rects) {
    const top = (r.top - originTop) / scale;
    const bottom = (r.bottom - originTop) / scale;
    const last = lines[lines.length - 1];
    // 같은 줄: 세로로 크게 겹치면 병합
    if (last && top < last.bottom - 2 && bottom > last.top + 2) {
      last.top = Math.min(last.top, top);
      last.bottom = Math.max(last.bottom, bottom);
      last.left = Math.min(last.left, r.left);
      continue;
    }
    lines.push({ top, bottom, left: r.left, cy: (r.top + r.bottom) / 2 });
  }
  return lines.sort((a, b) => a.top - b.top);
}

function containsTable(node: PMNode) {
  let found = false;
  node.descendants((n) => {
    if (n.type.name === 'table') found = true;
    return !found;
  });
  return found;
}

function measure(view: EditorView, o: PaginationOptions): { breaks: Brk[]; layout: PageLayout } {
  const root = view.dom as HTMLElement;
  const paper = root.parentElement as HTMLElement;
  const gaps = Array.from(root.querySelectorAll<HTMLElement>('.pm-page-gap'));
  // 측정 중 스크롤이 튀지 않도록 높이 고정
  const prevMin = paper.style.minHeight;
  paper.style.minHeight = `${paper.offsetHeight}px`;
  gaps.forEach((g) => (g.style.display = 'none'));
  const rootRect = root.getBoundingClientRect();
  const scale = rootRect.width / (root.offsetWidth || 1) || 1;
  const originTop = rootRect.top;
  const H = o.contentHeight;
  const breaks: Brk[] = [];
  let pageStart = 0;
  let page = 1;
  let force = false;
  let flowEnd = 0;

  const add = (pos: number, y: number, inline: boolean, offset: number) => {
    page++;
    breaks.push({ pos, remaining: Math.max(0, pageStart + H - y), inline, offset, page });
    pageStart = y;
  };

  try {
    view.state.doc.forEach((node, offset) => {
      const dom = view.nodeDOM(offset);
      if (!(dom instanceof HTMLElement)) return;
      const r = dom.getBoundingClientRect();
      const top = (r.top - originTop) / scale;
      const bottom = (r.bottom - originTop) / scale;
      if (node.type.name === 'pageBreak') {
        force = true;
        flowEnd = Math.max(flowEnd, bottom);
        return;
      }
      if (force) {
        add(offset, top, false, o.padLeft);
        force = false;
      }
      flowEnd = Math.max(flowEnd, bottom);
      const splittable = node.isTextblock || (!containsTable(node) && node.type.name !== 'table');
      let lines: ReturnType<typeof lineBoxes> | null = null;
      let guard = 0;
      while (bottom > pageStart + H + 0.5 && guard++ < 500) {
        const pageBottom = pageStart + H;
        if (!splittable) {
          if (top > pageStart + 0.5) {
            add(offset, top, false, o.padLeft);
            continue;
          }
          // 한 쪽보다 큰 블록: 넘치게 두고 다음 블록부터 새 쪽
          force = true;
          break;
        }
        lines ??= lineBoxes(dom, originTop, scale);
        const idx = lines.findIndex((l) => l.bottom > pageBottom + 0.5);
        if (idx < 0) {
          // 글줄은 모두 들어가고 아래 여백만 넘침 → 그대로 둔다. 글줄이 없는 빈 문단은 통째로 넘긴다
          if (lines.length || top <= pageStart + 0.5) break;
          add(offset, top, false, o.padLeft);
          continue;
        }
        const line = lines[idx];
        if (line.top <= pageStart + 0.5) {
          // 한 줄이 쪽보다 큼
          force = true;
          break;
        }
        const firstLineTop = lines[0]?.top ?? top;
        if (idx === 0 || line.top <= firstLineTop + 0.5) {
          if (top > pageStart + 0.5) {
            add(offset, top, false, o.padLeft);
            continue;
          }
        }
        const hit = view.posAtCoords({ left: line.left + 1, top: line.cy });
        let pos = hit?.pos ?? -1;
        if (pos <= offset || pos >= offset + node.nodeSize - 1) {
          if (top > pageStart + 0.5) {
            add(offset, top, false, o.padLeft);
            continue;
          }
          force = true;
          break;
        }
        const $p = view.state.doc.resolve(pos);
        if ($p.parent.textContent[$p.parentOffset] === ' ') pos++;
        const block = view.domAtPos(pos).node;
        const host = (block.nodeType === 1 ? block : block.parentElement) as HTMLElement;
        const para = host.closest('p,h1,h2,h3,li,blockquote') as HTMLElement | null;
        let offsetX = o.padLeft;
        if (para) {
          const cs = getComputedStyle(para);
          const pr = para.getBoundingClientRect();
          offsetX += (pr.left - rootRect.left) / scale + (parseFloat(cs.paddingLeft) || 0) + (parseFloat(cs.borderLeftWidth) || 0);
        }
        add(pos, line.top, true, offsetX);
      }
    });
  } finally {
    gaps.forEach((g) => (g.style.display = ''));
    paper.style.minHeight = prevMin;
  }
  return {
    breaks,
    layout: { pages: page, lastFill: Math.max(0, pageStart + H - flowEnd), starts: breaks.map((b) => b.pos) },
  };
}

export const Pagination = Extension.create<{ onLayout?: (l: PageLayout) => void }, { opts: PaginationOptions; remeasure: () => void }>({
  name: 'pagination',
  addOptions() {
    return { onLayout: undefined };
  },
  addStorage() {
    return {
      opts: { enabled: true, contentHeight: 900, padTop: 100, padBottom: 100, padLeft: 100, paperWidth: 794, gap: 24 },
      remeasure: () => {},
    };
  },
  addProseMirrorPlugins() {
    const storage = this.storage;
    const options = this.options;
    return [
      new Plugin({
        key,
        state: {
          init: () => ({ deco: DecorationSet.empty, sig: '' }),
          apply(tr, old) {
            const meta = tr.getMeta(key) as { deco: DecorationSet; sig: string } | undefined;
            if (meta) return meta;
            return { deco: old.deco.map(tr.mapping, tr.doc), sig: tr.docChanged ? '~' : old.sig };
          },
        },
        props: {
          decorations(state) {
            return key.getState(state)?.deco;
          },
        },
        view(view) {
          let timer = 0;
          let raf = 0;
          const run = () => {
            if (!view.dom.isConnected) return;
            const o = storage.opts;
            if (!o.enabled) {
              const st = key.getState(view.state);
              if (st && st.sig !== '') view.dispatch(view.state.tr.setMeta(key, { deco: DecorationSet.empty, sig: '' }).setMeta('addToHistory', false));
              options.onLayout?.({ pages: 1, lastFill: 0, starts: [] });
              return;
            }
            const { breaks, layout } = measure(view, o);
            const sig = JSON.stringify([breaks.map((b) => [b.pos, Math.round(b.remaining), b.inline, Math.round(b.offset)]), o]);
            const st = key.getState(view.state);
            if (!st || st.sig !== sig) {
              const deco = DecorationSet.create(
                view.state.doc,
                breaks.map((b) => Decoration.widget(b.pos, () => gapDom(b, o), { side: -1, ignoreSelection: true, key: `pg-${b.page}-${b.pos}-${Math.round(b.remaining)}-${Math.round(b.offset)}` })),
              );
              view.dispatch(view.state.tr.setMeta(key, { deco, sig }).setMeta('addToHistory', false));
            }
            options.onLayout?.(layout);
          };
          const schedule = (delay = 120) => {
            clearTimeout(timer);
            cancelAnimationFrame(raf);
            timer = window.setTimeout(() => {
              raf = requestAnimationFrame(run);
            }, delay);
          };
          storage.remeasure = () => schedule(30);
          const onLoad = (e: Event) => {
            if ((e.target as HTMLElement)?.tagName === 'IMG') schedule(30);
          };
          view.dom.addEventListener('load', onLoad, true);
          const onFonts = () => schedule(30);
          document.fonts?.addEventListener?.('loadingdone', onFonts);
          schedule(10);
          return {
            update(v, prev) {
              if (v.state.doc !== prev.doc) schedule();
            },
            destroy() {
              clearTimeout(timer);
              cancelAnimationFrame(raf);
              view.dom.removeEventListener('load', onLoad, true);
              document.fonts?.removeEventListener?.('loadingdone', onFonts);
            },
          };
        },
      }),
    ];
  },
});
