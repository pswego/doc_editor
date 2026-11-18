import { useEffect, useMemo, useRef, useState } from 'react';
import type { Editor } from '@tiptap/core';
import { TextSelection } from '@tiptap/pm/state';
import { Icon } from '../components/Icon';
import { ColorGrid } from '../components/ColorGrid';
import { Popover, usePopover } from '../components/Popover';
import { FontSelect, currentText } from './Ribbon';
import { curBlock } from './commands';
import { TEXT_COLORS } from './fonts';
import { searchKey } from './editor/search';
import { DEFAULT_LINE_HEIGHT, PAPERS, pageDims, type PageSetup } from './format/types';
import type { PageLayout } from './editor/pagination';

// ── 숫자 입력 ─────────────────────────────
export function NumField({ label, value, unit, onCommit, step = 1, min, max, placeholder }: { label: string; value: number | null | undefined; unit?: string; onCommit: (v: number | null) => void; step?: number; min?: number; max?: number; placeholder?: string }) {
  const [text, setText] = useState<string | null>(null);
  const shown = text ?? (value == null || value === 0 ? (placeholder ? '' : '0') : String(Math.round(value * 10) / 10));
  const commit = (s: string) => {
    setText(null);
    if (s.trim() === '') return onCommit(null);
    let n = parseFloat(s);
    if (!isFinite(n)) return;
    if (min != null) n = Math.max(min, n);
    if (max != null) n = Math.min(max, n);
    onCommit(Math.round(n * 10) / 10);
  };
  return (
    <label className="fl">
      {label}
      <span style={{ position: 'relative', display: 'flex' }}>
        <input
          className="in"
          inputMode="decimal"
          value={shown}
          placeholder={placeholder}
          onChange={(e) => setText(e.target.value)}
          onBlur={(e) => text != null && commit(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commit((e.target as HTMLInputElement).value);
            if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
              e.preventDefault();
              const cur = parseFloat(shown) || 0;
              commit(String(cur + (e.key === 'ArrowUp' ? step : -step)));
            }
          }}
          style={{ paddingRight: unit ? 34 : undefined }}
        />
        {unit && <span style={{ position: 'absolute', right: 10, top: 8, fontSize: 12, color: 'var(--ink-2)', pointerEvents: 'none' }}>{unit}</span>}
      </span>
    </label>
  );
}

// ── 왼쪽: 개요 · 쪽 ─────────────────────────
const OUTLINE_PATTERN = /^\s*([ⅠⅡⅢⅣⅤⅥⅦⅧⅨⅩ]|[IVX]{1,4}\.|\d{1,2}\.|[가-하]\.|제\s?\d+\s?[장절조])\s*/;

export function OutlinePanel({ editor, layout, onClose }: { editor: Editor; layout: PageLayout; onClose?: () => void }) {
  const [tab, setTab] = useState<'outline' | 'pages'>('outline');
  const doc = editor.state.doc;
  const items = useMemo(() => {
    const out: { pos: number; level: number; text: string; guess?: boolean }[] = [];
    doc.forEach((node, pos) => {
      if (node.type.name === 'heading') out.push({ pos, level: Number(node.attrs.level), text: node.textContent.trim() });
    });
    if (out.length) return out;
    // 개요 스타일이 없는 문서: 번호로 시작하는 짧은 문단을 제목으로 추정
    doc.forEach((node, pos) => {
      if (node.type.name !== 'paragraph') return;
      const t = node.textContent.trim();
      if (!t || t.length > 50) return;
      const m = OUTLINE_PATTERN.exec(t);
      if (!m) return;
      const level = /[ⅠⅡⅢⅣⅤⅥⅦⅧⅨⅩ]|[IVX]{1,4}\.|장/.test(m[1]) ? 1 : /\d/.test(m[1]) && !/조/.test(m[1]) ? 2 : 3;
      out.push({ pos, level, text: t, guess: true });
    });
    return out.slice(0, 300);
  }, [doc]);

  const pages = useMemo(() => {
    const starts = [0, ...layout.starts];
    return starts.map((s, i) => {
      let text = '';
      doc.nodesBetween(Math.min(s, doc.content.size), Math.min(starts[i + 1] ?? doc.content.size, doc.content.size), (n) => {
        if (text.length < 60 && n.isText) text += n.text;
        return text.length < 60;
      });
      return { pos: s, text: text.trim().slice(0, 60) || '(빈 쪽)' };
    });
  }, [doc, layout]);

  const sel = editor.state.selection.from;
  let activeIdx = -1;
  items.forEach((it, i) => { if (it.pos <= sel) activeIdx = i; });
  let activePage = 0;
  layout.starts.forEach((s, i) => { if (s <= sel) activePage = i + 1; });

  const go = (pos: number) => {
    const p = Math.min(pos + 1, editor.state.doc.content.size);
    editor.chain().focus().setTextSelection(p).run();
    const dom = editor.view.domAtPos(p).node as HTMLElement;
    (dom.nodeType === 1 ? dom : dom.parentElement)?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    onClose?.();
  };

  return (
    <>
      <div role="tablist" aria-label="탐색 보기" className="segs">
        <button className={`seg ${tab === 'outline' ? 'on' : ''}`} role="tab" aria-selected={tab === 'outline'} onClick={() => setTab('outline')}>개요</button>
        <button className={`seg ${tab === 'pages' ? 'on' : ''}`} role="tab" aria-selected={tab === 'pages'} onClick={() => setTab('pages')}>쪽 {layout.pages}</button>
      </div>
      {tab === 'outline' ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          {items.length === 0 && <p className="muted" style={{ fontSize: 12, lineHeight: 1.6, margin: '4px 6px' }}>개요가 없습니다. 문단에 ‘개요 1~3’ 스타일을 적용하면 여기에 목차가 생깁니다.</p>}
          {items[0]?.guess && <p className="muted" style={{ fontSize: 11, margin: '0 6px 4px' }}>번호 문단으로 추정한 목차</p>}
          {items.map((it, i) => (
            <button key={it.pos} className={`ol ${i === activeIdx ? 'on' : ''}`} style={{ paddingLeft: 10 + (it.level - 1) * 16, fontWeight: it.level === 1 ? 500 : undefined }} onClick={() => go(it.pos)}>
              <span className="t">{it.text || '(제목 없음)'}</span>
            </button>
          ))}
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          {pages.map((p, i) => (
            <button key={i} className={`ol ${i === activePage ? 'on' : ''}`} onClick={() => go(p.pos)}>
              <span style={{ fontWeight: 700, minWidth: 22, fontSize: 12 }}>{i + 1}</span>
              <span className="t" style={{ color: 'var(--ink-2)' }}>{p.text}</span>
            </button>
          ))}
        </div>
      )}
    </>
  );
}

// ── 오른쪽: 서식 ─────────────────────────────
function TextColorField({ editor }: { editor: Editor }) {
  const pop = usePopover();
  const c = currentText(editor).color;
  return (
    <label className="fl">
      글자 색
      <button className="in" style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', textAlign: 'left' }} onClick={pop.open} aria-haspopup="dialog">
        <span style={{ width: 14, height: 14, borderRadius: 4, background: c, border: '1px solid var(--line)' }} />
        {c === '#000000' ? '검정' : c}
      </button>
      {pop.isOpen && (
        <Popover anchor={pop.anchor} onClose={pop.close}>
          <ColorGrid colors={TEXT_COLORS} value={c} noneLabel="자동(검정)" onPick={(v) => { pop.close(); editor.chain().focus().setTextAttrs({ color: v }).run(); }} />
        </Popover>
      )}
    </label>
  );
}

export function FormatPanel({ editor, page, setPage, onPageDialog }: { editor: Editor; page: PageSetup; setPage: (p: PageSetup) => void; onPageDialog: () => void }) {
  const cur = currentText(editor);
  const block = curBlock(editor);
  const a = block.attrs as Record<string, number | string | null>;
  const setPara = (attrs: Record<string, unknown>) => editor.chain().focus().setParagraphAttrs(attrs).run();
  const indent = Number(a.textIndent) || 0;
  const dims = pageDims(page);
  return (
    <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 20 }}>
      <section className="panel-sec" aria-label="글자 모양">
        <div className="sec-title">글자 모양</div>
        <div className="grid2">
          <label className="fl" style={{ gridColumn: 'span 2' }}>글꼴<FontSelect editor={editor} width="100%" /></label>
          <NumField label="크기" unit="pt" value={cur.size} step={0.5} min={1} max={400} onCommit={(v) => v && editor.chain().focus().setTextAttrs({ fontSize: v }).run()} />
          <NumField label="자간" unit="%" value={cur.spacing} min={-50} max={50} onCommit={(v) => editor.chain().focus().setTextAttrs({ letterSpacing: v || null }).run()} />
          <TextColorField editor={editor} />
        </div>
      </section>
      <section className="panel-sec" aria-label="문단 모양">
        <div className="sec-title">문단 모양</div>
        <div role="group" aria-label="정렬" className="segs">
          {[['justify', '양쪽'], ['left', '왼쪽'], ['center', '가운데'], ['right', '오른쪽'], ['distribute', '배분']].map(([v, l]) => (
            <button key={v} className={`seg ${(a.textAlign ?? 'justify') === v ? 'on' : ''}`} aria-pressed={(a.textAlign ?? 'justify') === v} onClick={() => setPara({ textAlign: v })} style={{ padding: 0, fontSize: 12 }}>{l}</button>
          ))}
        </div>
        <div className="grid2">
          <NumField label="왼쪽 여백" unit="pt" value={Number(a.indentLeft) || 0} onCommit={(v) => setPara({ indentLeft: v || null })} />
          <NumField label="오른쪽 여백" unit="pt" value={Number(a.indentRight) || 0} onCommit={(v) => setPara({ indentRight: v || null })} />
          <label className="fl">
            첫 줄
            <select className="in" value={indent > 0 ? 'in' : indent < 0 ? 'out' : 'none'} onChange={(e) => {
              const m = Math.abs(indent) || 10;
              setPara({ textIndent: e.target.value === 'none' ? null : e.target.value === 'in' ? m : -m });
            }}>
              <option value="none">보통</option>
              <option value="in">들여쓰기</option>
              <option value="out">내어쓰기</option>
            </select>
          </label>
          <NumField label={indent < 0 ? '내어쓰기' : '들여쓰기'} unit="pt" value={Math.abs(indent)} min={0} onCommit={(v) => setPara({ textIndent: v ? (indent < 0 ? -v : v) : null })} />
          <NumField label="줄 간격" unit="%" value={Number(a.lineHeight) || DEFAULT_LINE_HEIGHT} step={10} min={50} max={500} onCommit={(v) => setPara({ lineHeight: v && v !== DEFAULT_LINE_HEIGHT ? v : null })} />
          <span />
          <NumField label="문단 위" unit="pt" value={Number(a.spaceBefore) || 0} min={0} onCommit={(v) => setPara({ spaceBefore: v || null })} />
          <NumField label="문단 아래" unit="pt" value={Number(a.spaceAfter) || 0} min={0} onCommit={(v) => setPara({ spaceAfter: v || null })} />
        </div>
      </section>
      <section className="panel-sec" aria-label="쪽 설정">
        <div className="sec-title">쪽 설정</div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <span aria-hidden="true" style={{ width: page.landscape ? 46 : 34, height: page.landscape ? 34 : 46, border: '1.5px solid var(--accent)', borderRadius: 3, background: 'var(--accent-soft)', flex: 'none' }} />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2, fontSize: 13 }}>
            <span style={{ fontWeight: 500 }}>{PAPERS[page.paper]?.label ?? '사용자 정의'} · {page.landscape ? '가로' : '세로'}</span>
            <span style={{ fontSize: 12, color: 'var(--ink-2)' }}>{dims.w} × {dims.h} mm</span>
          </div>
          <button className="btn btn-outline btn-sm" style={{ marginLeft: 'auto' }} onClick={onPageDialog}>변경</button>
        </div>
        <div className="grid4">
          <NumField label="위" value={page.marginTop} min={0} max={100} onCommit={(v) => setPage({ ...page, marginTop: v ?? 0 })} />
          <NumField label="아래" value={page.marginBottom} min={0} max={100} onCommit={(v) => setPage({ ...page, marginBottom: v ?? 0 })} />
          <NumField label="왼쪽" value={page.marginLeft} min={0} max={100} onCommit={(v) => setPage({ ...page, marginLeft: v ?? 0 })} />
          <NumField label="오른쪽" value={page.marginRight} min={0} max={100} onCommit={(v) => setPage({ ...page, marginRight: v ?? 0 })} />
        </div>
        <span style={{ fontSize: 12, color: 'var(--ink-2)' }}>여백 단위: mm · 머리말 {page.marginHeader} · 꼬리말 {page.marginFooter}</span>
      </section>
    </div>
  );
}

// ── 오른쪽: 찾기·바꾸기 ─────────────────────────
export function FindPanel({ editor, replaceMode, focusKey }: { editor: Editor; replaceMode: boolean; focusKey: number }) {
  const st = searchKey.getState(editor.state);
  const [q, setQ] = useState(st?.query ?? '');
  const [r, setR] = useState('');
  const [cs, setCs] = useState(st?.caseSensitive ?? false);
  const inputRef = useRef<HTMLInputElement>(null);
  const replRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    // 선택한 글자가 있으면 검색어로
    const { from, to } = editor.state.selection;
    const selText = editor.state.doc.textBetween(from, to, ' ');
    if (selText && selText.length < 100) {
      setQ(selText);
      editor.commands.setSearch(selText, cs);
    }
    setTimeout(() => (replaceMode && selText ? replRef.current : inputRef.current)?.select(), 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusKey]);

  useEffect(() => () => { editor.commands.setSearch(''); }, [editor]);

  const update = (v: string, c = cs) => {
    setQ(v);
    editor.commands.setSearch(v, c);
  };
  const count = st?.matches.length ?? 0;
  const cur = st && st.current >= 0 ? st.current + 1 : 0;
  return (
    <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 14 }}>
      <label className="fl">
        찾을 내용
        <input ref={inputRef} className="in" value={q} onChange={(e) => update(e.target.value)} onKeyDown={(e) => {
          if (e.key === 'Enter') { e.preventDefault(); editor.commands.findNext(e.shiftKey ? -1 : 1); }
        }} placeholder="찾을 낱말" style={{ height: 36, fontSize: 14 }} />
      </label>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span className="find-hl" role="status">{q ? (count ? `${cur ? `${cur} / ` : ''}${count}개 찾음` : '찾는 내용이 없습니다') : ' '}</span>
        <span style={{ marginLeft: 'auto', display: 'flex', gap: 2 }}>
          <button className="tb" aria-label="이전 찾기 (Shift+Enter)" disabled={!count} onClick={() => editor.commands.findNext(-1)}><Icon name="chevDown" style={{ transform: 'rotate(180deg)' }} /></button>
          <button className="tb" aria-label="다음 찾기 (Enter)" disabled={!count} onClick={() => editor.commands.findNext(1)}><Icon name="chevDown" /></button>
        </span>
      </div>
      <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
        <input type="checkbox" checked={cs} onChange={(e) => { setCs(e.target.checked); update(q, e.target.checked); }} />
        대소문자 구분
      </label>
      <div style={{ height: 1, background: 'var(--line-2)' }} />
      <label className="fl">
        바꿀 내용
        <input ref={replRef} className="in" value={r} onChange={(e) => setR(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && editor.commands.replaceCurrent(r)} placeholder="바꿀 낱말 (비우면 지우기)" style={{ height: 36, fontSize: 14 }} />
      </label>
      <div style={{ display: 'flex', gap: 8 }}>
        <button className="btn btn-outline" style={{ flex: 1 }} disabled={!count} onClick={() => { editor.commands.replaceCurrent(r); editor.commands.findNext(1); }}>바꾸기</button>
        <button className="btn btn-primary" style={{ flex: 1 }} disabled={!count} onClick={() => editor.commands.replaceAll(r)}>모두 바꾸기</button>
      </div>
    </div>
  );
}

// ── 문서 정보 ─────────────────────────────
export function docStats(editor: Editor) {
  const doc = editor.state.doc;
  const text = doc.textBetween(0, doc.content.size, '\n', ' ');
  let paras = 0, tables = 0, images = 0;
  doc.descendants((n) => {
    if (n.type.name === 'paragraph' || n.type.name === 'heading') paras++;
    if (n.type.name === 'table') tables++;
    if (n.type.name === 'image') images++;
    return true;
  });
  const noSpace = text.replace(/\s/g, '').length;
  const withSpace = text.replace(/\n/g, '').length;
  const words = text.split(/\s+/).filter(Boolean).length;
  return { noSpace, withSpace, words, paras, tables, images };
}

export function InfoPanel({ editor, layout, name }: { editor: Editor; layout: PageLayout; name: string }) {
  const s = docStats(editor);
  const rows: [string, string][] = [
    ['쪽', `${layout.pages}`],
    ['글자 (공백 포함)', s.withSpace.toLocaleString()],
    ['글자 (공백 제외)', s.noSpace.toLocaleString()],
    ['낱말', s.words.toLocaleString()],
    ['문단', s.paras.toLocaleString()],
    ['표', s.tables.toLocaleString()],
    ['그림', s.images.toLocaleString()],
  ];
  return (
    <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div className="sec-title">{name}</div>
      <table style={{ borderCollapse: 'collapse', fontSize: 13 }}>
        <tbody>
          {rows.map(([k, v]) => (
            <tr key={k} style={{ borderBottom: '1px solid var(--line-2)' }}>
              <td style={{ padding: '8px 0', color: 'var(--ink-2)' }}>{k}</td>
              <td style={{ padding: '8px 0', textAlign: 'right', fontWeight: 500 }}>{v}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="muted" style={{ fontSize: 12, lineHeight: 1.6, margin: 0 }}>쪽 수는 화면에서 계산한 값이라 한글 프로그램과 조금 다를 수 있습니다.</p>
    </div>
  );
}

export function selectPos(editor: Editor, pos: number) {
  const tr = editor.state.tr.setSelection(TextSelection.near(editor.state.doc.resolve(pos)));
  editor.view.dispatch(tr.scrollIntoView());
}
