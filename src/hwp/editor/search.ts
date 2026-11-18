/** 찾기·바꾸기: 일치 항목 강조 표시 */
import { Extension } from '@tiptap/core';
import { Plugin, PluginKey, TextSelection } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import type { Node as PMNode } from '@tiptap/pm/model';

export interface SearchState {
  query: string;
  caseSensitive: boolean;
  matches: { from: number; to: number }[];
  current: number;
}

export const searchKey = new PluginKey<SearchState>('search');

function findMatches(doc: PMNode, query: string, caseSensitive: boolean) {
  const out: { from: number; to: number }[] = [];
  if (!query) return out;
  const q = caseSensitive ? query : query.toLowerCase();
  doc.descendants((node, pos) => {
    if (!node.isTextblock) return true;
    // 텍스트 블록의 문자열과 위치 대응표 만들기
    let text = '';
    const map: number[] = [];
    node.forEach((child, off) => {
      if (child.isText) {
        const t = child.text ?? '';
        for (let i = 0; i < t.length; i++) map.push(pos + 1 + off + i);
        text += t;
      } else {
        map.push(-1);
        text += '￼';
      }
    });
    const hay = caseSensitive ? text : text.toLowerCase();
    let i = hay.indexOf(q);
    while (i >= 0) {
      const from = map[i];
      const last = map[i + q.length - 1];
      if (from >= 0 && last >= 0) out.push({ from, to: last + 1 });
      i = hay.indexOf(q, i + Math.max(1, q.length));
    }
    return false;
  });
  return out;
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    search: {
      setSearch: (query: string, caseSensitive?: boolean) => ReturnType;
      findNext: (dir?: 1 | -1) => ReturnType;
      replaceCurrent: (text: string) => ReturnType;
      replaceAll: (text: string) => ReturnType;
    };
  }
}

export const Search = Extension.create({
  name: 'search',
  addCommands() {
    const select = (m: { from: number; to: number } | undefined) =>
      ({ tr, dispatch }: { tr: import('@tiptap/pm/state').Transaction; dispatch?: (tr: import('@tiptap/pm/state').Transaction) => void }) => {
        if (!m) return false;
        if (dispatch) {
          tr.setSelection(TextSelection.create(tr.doc, m.from, m.to)).scrollIntoView();
        }
        return true;
      };
    return {
      setSearch:
        (query, caseSensitive = false) =>
        ({ tr, dispatch }) => {
          if (dispatch) dispatch(tr.setMeta(searchKey, { query, caseSensitive }));
          return true;
        },
      findNext:
        (dir = 1) =>
        ({ state, tr, dispatch }) => {
          const s = searchKey.getState(state);
          if (!s || !s.matches.length) return false;
          const head = state.selection.from;
          let idx: number;
          if (dir === 1) {
            idx = s.matches.findIndex((m) => m.from > head || (m.from === head && state.selection.empty));
            if (idx < 0) idx = 0;
          } else {
            idx = -1;
            for (let i = s.matches.length - 1; i >= 0; i--) if (s.matches[i].from < head) { idx = i; break; }
            if (idx < 0) idx = s.matches.length - 1;
          }
          tr.setMeta(searchKey, { current: idx });
          return select(s.matches[idx])({ tr, dispatch });
        },
      replaceCurrent:
        (text) =>
        ({ state, tr, dispatch }) => {
          const s = searchKey.getState(state);
          if (!s || !s.matches.length) return false;
          const sel = state.selection;
          let m = s.matches.find((x) => x.from === sel.from && x.to === sel.to);
          if (!m) m = s.matches.find((x) => x.from >= sel.from) ?? s.matches[0];
          if (dispatch) {
            const marks = state.doc.resolve(m.from + 1).marks();
            if (text) tr.replaceWith(m.from, m.to, state.schema.text(text, marks));
            else tr.delete(m.from, m.to);
            const after = tr.mapping.map(m.to);
            tr.setSelection(TextSelection.create(tr.doc, after));
            dispatch(tr);
          }
          return true;
        },
      replaceAll:
        (text) =>
        ({ state, tr, dispatch }) => {
          const s = searchKey.getState(state);
          if (!s || !s.matches.length) return false;
          if (dispatch) {
            for (let i = s.matches.length - 1; i >= 0; i--) {
              const m = s.matches[i];
              const marks = state.doc.resolve(m.from + 1).marks();
              if (text) tr.replaceWith(m.from, m.to, state.schema.text(text, marks));
              else tr.delete(m.from, m.to);
            }
            dispatch(tr);
          }
          return true;
        },
    };
  },
  addProseMirrorPlugins() {
    return [
      new Plugin<SearchState>({
        key: searchKey,
        state: {
          init: () => ({ query: '', caseSensitive: false, matches: [], current: -1 }),
          apply(tr, old, _o, newState) {
            const meta = tr.getMeta(searchKey) as Partial<SearchState> | undefined;
            if (meta && ('query' in meta || 'caseSensitive' in meta)) {
              const query = meta.query ?? old.query;
              const cs = meta.caseSensitive ?? old.caseSensitive;
              return { query, caseSensitive: cs, matches: findMatches(newState.doc, query, cs), current: -1 };
            }
            if (meta && 'current' in meta) return { ...old, current: meta.current ?? -1 };
            if (tr.docChanged && old.query) return { ...old, matches: findMatches(newState.doc, old.query, old.caseSensitive) };
            return old;
          },
        },
        props: {
          decorations(state) {
            const s = searchKey.getState(state);
            if (!s || !s.matches.length) return null;
            return DecorationSet.create(
              state.doc,
              s.matches.map((m, i) => Decoration.inline(m.from, m.to, { class: i === s.current ? 'search-hit current' : 'search-hit' })),
            );
          },
        },
      }),
    ];
  },
});
