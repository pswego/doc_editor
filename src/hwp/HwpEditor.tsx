import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { EditorContent, useEditor, type Editor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Underline from '@tiptap/extension-underline';
import TextStyle from '@tiptap/extension-text-style';
import Highlight from '@tiptap/extension-highlight';
import Subscript from '@tiptap/extension-subscript';
import Superscript from '@tiptap/extension-superscript';
import Placeholder from '@tiptap/extension-placeholder';
import Table from '@tiptap/extension-table';
import TableRow from '@tiptap/extension-table-row';
import type { EditorView } from '@tiptap/pm/view';
import { Icon } from '../components/Icon';
import { Modal } from '../components/Modal';
import { Loading } from '../App';
import { createFromTemplate, navigate, type HwpStored } from '../lib/docs';
import { ACCEPT_ALL, downloadBlob, pickFiles, readAsDataURL } from '../lib/files';
import { getData, getMeta, patchMeta, saveData, type DocMeta } from '../lib/storage';
import { toast } from '../lib/toast';
import { useFileDrop } from '../lib/useFileDrop';
import { openFilesAndGo } from '../home/Home';
import { HwpImage, HwpTableCell, HwpTableHeader, PageBreak, ParagraphFormat, TextFormat } from './editor/extensions';
import { Pagination, type PageLayout } from './editor/pagination';
import { Search } from './editor/search';
import { Ribbon, type RibbonTab } from './Ribbon';
import { FindPanel, FormatPanel, InfoPanel, OutlinePanel, docStats } from './panels';
import { CommandPalette } from './CommandPalette';
import { PageSetupDialog } from './PageSetupDialog';
import { buildCommands, curBlock, type EditorCtx } from './commands';
import { pageDims, type PageSetup, type PMNode } from './format/types';
import './hwp.css';

const PX = 96 / 25.4;

export default function HwpEditor({ id }: { id: string }) {
  const [meta, setMeta] = useState<DocMeta | null>(null);
  const [data, setData] = useState<HwpStored | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    (async () => {
      const m = await getMeta(id);
      const d = await getData<HwpStored>(id);
      if (!m || !d) return setError('문서를 찾을 수 없습니다. 이 브라우저에서 지워졌을 수 있어요.');
      setMeta(m);
      setData(d);
    })().catch((e) => setError(String(e?.message ?? e)));
  }, [id]);
  if (error)
    return (
      <div className="loading-screen">
        <Icon name="warn" size={32} />
        <span>{error}</span>
        <a className="btn btn-primary" href="#/">홈으로</a>
      </div>
    );
  if (!meta || !data) return <Loading text="문서를 여는 중…" />;
  return <EditorScreen meta={meta} initial={data} />;
}

function insertImageFiles(view: EditorView, files: File[], pos?: number) {
  const imgs = files.filter((f) => f.type.startsWith('image/'));
  if (!imgs.length) return false;
  (async () => {
    for (const f of imgs) {
      const src = await readAsDataURL(f);
      const width = await naturalWidth(src, view.dom.clientWidth);
      const node = view.state.schema.nodes.image.create({ src, width });
      const tr = pos != null ? view.state.tr.insert(pos, node) : view.state.tr.replaceSelectionWith(node);
      view.dispatch(tr.scrollIntoView());
    }
  })();
  return true;
}

function naturalWidth(src: string, max: number): Promise<number | null> {
  return new Promise((res) => {
    const img = new Image();
    img.onload = () => res(Math.min(img.naturalWidth, max) || null);
    img.onerror = () => res(null);
    img.src = src;
  });
}

function EditorScreen({ meta, initial }: { meta: DocMeta; initial: HwpStored }) {
  const id = meta.id;
  const [name, setName] = useState(meta.name);
  const [page, setPageState] = useState<PageSetup>(initial.page);
  const [zoom, setZoom] = useState(() => Number(localStorage.getItem('hwp-zoom')) || 1);
  const [view, setView] = useState<'page' | 'web'>('page');
  const [showLeft, setShowLeft] = useState(() => window.innerWidth > 860);
  const [showRight, setShowRight] = useState(() => window.innerWidth > 860);
  const [showRuler, setShowRuler] = useState(true);
  const [rightTab, setRightTab] = useState<'format' | 'find' | 'info'>('format');
  const [replaceMode, setReplaceMode] = useState(false);
  const [findKey, setFindKey] = useState(0);
  const [tab, setTab] = useState<RibbonTab>('edit');
  const [layout, setLayout] = useState<PageLayout>({ pages: 1, lastFill: 0, starts: [] });
  const [saveState, setSaveState] = useState<'saved' | 'saving' | 'dirty'>('saved');
  const [exportedAt, setExportedAt] = useState<number | null>(null);
  const [palette, setPalette] = useState<string | null>(null);
  const [dialog, setDialog] = useState<null | 'page' | 'count'>(null);
  const [painter, setPainter] = useState<null | { marks: { type: string; attrs: Record<string, unknown> }[]; attrs: Record<string, unknown> }>(null);
  const [mini, setMini] = useState<{ left: number; top: number } | null>(null);
  const saveTimer = useRef(0);
  const pageRef = useRef(page);
  pageRef.current = page;
  const scrollRef = useRef<HTMLDivElement>(null);

  const editor = useEditor({
    extensions: [
      StarterKit.configure({ heading: { levels: [1, 2, 3] }, codeBlock: false, code: false }),
      Underline,
      TextStyle,
      TextFormat,
      Highlight.configure({ multicolor: true }),
      Subscript,
      Superscript,
      ParagraphFormat,
      Table.configure({ resizable: true, cellMinWidth: 24 }),
      TableRow,
      HwpTableHeader,
      HwpTableCell,
      HwpImage,
      PageBreak,
      Search,
      Placeholder.configure({ placeholder: '여기에 내용을 입력하세요' }),
      Pagination.configure({ onLayout: (l) => setLayout((old) => (JSON.stringify(old) === JSON.stringify(l) ? old : l)) }),
    ],
    content: initial.doc,
    editorProps: {
      attributes: { class: 'hwp-doc', spellcheck: 'false', 'aria-label': '문서 본문' },
      handlePaste: (v, e) => insertImageFiles(v, Array.from(e.clipboardData?.files ?? [])),
      handleDrop: (v, e) => {
        const files = Array.from((e as DragEvent).dataTransfer?.files ?? []);
        if (!files.some((f) => f.type.startsWith('image/'))) return false;
        e.preventDefault();
        const pos = v.posAtCoords({ left: (e as DragEvent).clientX, top: (e as DragEvent).clientY })?.pos;
        return insertImageFiles(v, files, pos);
      },
    },
    onUpdate: () => scheduleSave(),
  });

  // ── 자동 저장 (브라우저) ───────────────────
  const persist = useCallback(async (ed: Editor) => {
    const doc = ed.getJSON() as PMNode;
    await saveData(id, { doc, page: pageRef.current, warnings: initial.warnings } satisfies HwpStored);
    const text = ed.state.doc.textBetween(0, Math.min(ed.state.doc.content.size, 2000), ' ', ' ');
    await patchMeta(id, { updatedAt: Date.now(), preview: text.replace(/\s+/g, ' ').trim().slice(0, 80), pages: undefined });
    setSaveState('saved');
  }, [id, initial.warnings]);

  const scheduleSave = useCallback(() => {
    setSaveState('dirty');
    clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => {
      if (!editorRef.current) return;
      setSaveState('saving');
      persist(editorRef.current).catch(() => toast('브라우저에 저장하지 못했습니다. 저장 공간을 확인해 주세요.', 'error'));
    }, 700);
  }, [persist]);
  const editorRef = useRef<Editor | null>(null);
  editorRef.current = editor;

  const setPage = useCallback((p: PageSetup) => {
    setPageState(p);
    pageRef.current = p;
    scheduleSave();
  }, [scheduleSave]);

  useEffect(() => () => {
    clearTimeout(saveTimer.current);
    if (editorRef.current && !editorRef.current.isDestroyed) persist(editorRef.current);
  }, [persist]);

  useEffect(() => {
    localStorage.setItem('hwp-zoom', String(zoom));
  }, [zoom]);

  // ── 쪽 나누기 측정 설정 ─────────────────────
  const dims = pageDims(page);
  const padTopMm = page.marginTop + page.marginHeader;
  const padBottomMm = page.marginBottom + page.marginFooter;
  useEffect(() => {
    if (!editor) return;
    const st = editor.storage.pagination as { opts: Record<string, unknown>; remeasure: () => void };
    st.opts = {
      enabled: view === 'page',
      contentHeight: (dims.h - padTopMm - padBottomMm) * PX,
      padTop: padTopMm * PX,
      padBottom: padBottomMm * PX,
      padLeft: page.marginLeft * PX,
      paperWidth: dims.w * PX,
      gap: 24,
    };
    st.remeasure();
  }, [editor, view, dims.w, dims.h, padTopMm, padBottomMm, page.marginLeft, page.marginRight, zoom]);

  // 열 때 알림 / 자동 인쇄
  useEffect(() => {
    document.title = `${name} · 문서공방`;
  }, [name]);
  useEffect(() => {
    const w = sessionStorage.getItem('open-warnings');
    if (w) {
      sessionStorage.removeItem('open-warnings');
      (JSON.parse(w) as string[]).forEach((m) => toast(m, 'info', 5000));
    }
    if (sessionStorage.getItem('auto-print') === id) {
      sessionStorage.removeItem('auto-print');
      setTimeout(() => exportPdfRef.current(), 900);
    }
  }, [id]);

  // ── 동작 ────────────────────────────────
  const saveHwpx = useCallback(async () => {
    if (!editor) return;
    try {
      const { writeHwpx } = await import('./format/hwpx-write');
      const bytes = await writeHwpx(editor.getJSON() as PMNode, pageRef.current, name);
      downloadBlob(bytes, `${name}.hwpx`, 'application/octet-stream');
      setExportedAt(Date.now());
      await persist(editor);
      toast(meta.ext === 'hwp' ? 'HWPX로 저장했습니다. (HWP 5.0 바이너리 쓰기는 지원하지 않아 HWPX로 저장합니다)' : 'HWPX 파일로 저장했습니다.', 'ok', 4500);
    } catch (e) {
      toast(`저장하지 못했습니다: ${(e as Error).message}`, 'error');
    }
  }, [editor, name, meta.ext, persist]);

  const exportPdf = useCallback(() => {
    const p = pageRef.current;
    const d = pageDims(p);
    let style = document.getElementById('print-page-style') as HTMLStyleElement | null;
    if (!style) {
      style = document.createElement('style');
      style.id = 'print-page-style';
      document.head.appendChild(style);
    }
    style.textContent = `@page { size: ${d.w}mm ${d.h}mm; margin: ${p.marginTop + p.marginHeader}mm ${p.marginRight}mm ${p.marginBottom + p.marginFooter}mm ${p.marginLeft}mm; }`;
    const prev = document.title;
    document.title = name;
    toast('인쇄 창에서 대상을 ‘PDF로 저장’으로 고르면 PDF 파일이 만들어집니다.', 'info', 5000);
    setTimeout(() => {
      window.print();
      document.title = prev;
    }, 60);
  }, [name]);
  const exportPdfRef = useRef(exportPdf);
  exportPdfRef.current = exportPdf;

  const exportText = useCallback(async () => {
    if (!editor) return;
    const { docToText } = await import('../lib/convert');
    downloadBlob(docToText(editor.getJSON() as PMNode), `${name}.txt`, 'text/plain;charset=utf-8');
  }, [editor, name]);

  const openFile = useCallback(async () => {
    const files = await pickFiles(ACCEPT_ALL);
    if (files.length) openFilesAndGo(files);
  }, []);
  useFileDrop(useCallback((files: File[]) => {
    if (files.every((f) => f.type.startsWith('image/'))) return; // 그림은 편집기 안에서 처리
    openFilesAndGo(files);
  }, []));

  const newDoc = useCallback(async () => navigate(`/hwp/${await createFromTemplate('blank')}`), []);
  const insertImage = useCallback(async () => {
    const files = await pickFiles('image/png,image/jpeg,image/gif,image/bmp,image/webp');
    if (editor && files.length) insertImageFiles(editor.view, files);
  }, [editor]);
  const insertTable = useCallback((rows: number, cols: number) => editor?.chain().focus().insertTable({ rows, cols, withHeaderRow: false }).run(), [editor]);
  const openFind = useCallback((replace = false) => {
    setShowRight(true);
    setRightTab('find');
    setReplaceMode(replace);
    setFindKey((k) => k + 1);
  }, []);
  const togglePainter = useCallback(() => {
    if (!editor) return;
    if (painter) return setPainter(null);
    const $from = editor.state.selection.$from;
    const marks = (editor.state.storedMarks ?? $from.marks()).map((m) => ({ type: m.type.name, attrs: m.attrs as Record<string, unknown> }));
    const attrs = { ...curBlock(editor).attrs } as Record<string, unknown>;
    delete attrs.level;
    setPainter({ marks, attrs });
    toast('모양을 복사했습니다. 바꿀 글자를 드래그해 선택하세요. (Esc: 취소)', 'info');
  }, [editor, painter]);

  // 모양 복사 적용: 선택을 마치면 입힌다
  useEffect(() => {
    if (!editor || !painter) return;
    const up = () => setTimeout(() => {
      if (editor.state.selection.empty) return;
      let c = editor.chain().focus().unsetAllMarks();
      painter.marks.forEach((m) => { c = c.setMark(m.type, m.attrs); });
      c.setParagraphAttrs(painter.attrs).run();
      setPainter(null);
    }, 0);
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setPainter(null);
    editor.view.dom.addEventListener('mouseup', up);
    window.addEventListener('keydown', esc);
    editor.view.dom.style.cursor = 'copy';
    return () => {
      editor.view.dom.removeEventListener('mouseup', up);
      window.removeEventListener('keydown', esc);
      editor.view.dom.style.cursor = '';
    };
  }, [editor, painter]);

  // 선택 영역 미니 툴바 위치
  useEffect(() => {
    if (!editor) return;
    const update = () => {
      const { selection } = editor.state;
      if (selection.empty || !editor.isFocused || selection.constructor.name === 'CellSelection' || editor.isActive('image')) return setMini(null);
      const start = editor.view.coordsAtPos(selection.from);
      setMini({ left: Math.max(8, start.left), top: Math.max(8, start.top - 46) });
    };
    const hide = () => setMini(null);
    editor.on('selectionUpdate', update);
    editor.on('blur', hide);
    const sc = scrollRef.current;
    sc?.addEventListener('scroll', hide, { passive: true });
    return () => {
      editor.off('selectionUpdate', update);
      editor.off('blur', hide);
      sc?.removeEventListener('scroll', hide);
    };
  }, [editor]);

  const ctx: EditorCtx | null = editor
    ? {
        editor, page, setPage, zoom, setZoom, view, setView, showLeft, setShowLeft, showRight, setShowRight, showRuler, setShowRuler, setRightTab,
        saveHwpx, exportPdf, exportText, openFile, newDoc, goHome: () => navigate('/'), insertImage, insertTable, openFind,
        wordCount: () => setDialog('count'), pageSetup: () => setDialog('page'), painter: { active: !!painter, toggle: togglePainter },
      }
    : null;
  const commands = useMemo(() => (ctx ? buildCommands(ctx) : []), [ctx]);

  // ── 단축키 ──────────────────────────────
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      if (!mod) return;
      const k = e.key.toLowerCase();
      if (k === 's') { e.preventDefault(); saveHwpx(); }
      else if (k === 'p') { e.preventDefault(); exportPdf(); }
      else if (k === 'k') { e.preventDefault(); setPalette(''); }
      else if (k === 'f' && !e.shiftKey) { e.preventDefault(); openFind(false); }
      else if (k === 'h') { e.preventDefault(); openFind(true); }
      else if (k === 'o') { e.preventDefault(); openFile(); }
      else if (k === '=' || k === '+') { e.preventDefault(); setZoom((z) => Math.min(3, Math.round((z + 0.1) * 10) / 10)); }
      else if (k === '-') { e.preventDefault(); setZoom((z) => Math.max(0.3, Math.round((z - 0.1) * 10) / 10)); }
      else if (k === '0' && !e.altKey) { e.preventDefault(); setZoom(1); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [saveHwpx, exportPdf, openFind, openFile]);

  if (!editor || !ctx) return <Loading text="편집기를 준비하는 중…" />;

  const sel = editor.state.selection.from;
  let curPage = 1;
  layout.starts.forEach((s) => { if (s <= sel) curPage++; });
  const stats = docStats(editor);
  const paged = view === 'page';
  const block = curBlock(editor);
  const indentLeftPt = Number(block.attrs.indentLeft) || 0;
  const textIndentPt = Number(block.attrs.textIndent) || 0;

  return (
    <div className="hwp-app">
      <header className="app-header">
        <div className="title-row">
          <a href="#/" className="logo-btn" aria-label="홈으로"><Icon name="doc" /></a>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 1, minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span className="badge hwp" style={{ fontSize: 11, padding: '1px 6px' }}>{meta.ext === 'hwp' ? 'HWP' : 'HWPX'}</span>
              <input
                className="title-input"
                aria-label="문서 이름"
                value={name}
                size={Math.max(8, Math.min(40, name.length + 2))}
                onChange={(e) => setName(e.target.value)}
                onBlur={() => { const n = name.trim() || '제목 없음'; setName(n); patchMeta(id, { name: n }); }}
                onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
              />
            </div>
            <div className="save-state" role="status">
              {saveState === 'saved' ? <Icon name="check" size={14} style={{ color: 'var(--success)' }} /> : <span className="spinner" style={{ width: 12, height: 12, borderWidth: 2 }} />}
              <span>{saveState === 'saved' ? '이 브라우저에 자동 저장됨' : '저장 중…'}{exportedAt ? ' · HWPX 내려받음' : ''}</span>
            </div>
          </div>
          <div style={{ flex: '1 1 280px', display: 'flex', justifyContent: 'center' }}>
            <label className="cmd-search">
              <Icon name="search" />
              <input type="search" placeholder="기능·문서 내용 검색 (예: 쪽 번호, 표 만들기)" aria-label="기능 및 문서 검색" onFocus={(e) => { e.currentTarget.blur(); setPalette(''); }} readOnly />
              <span className="kbd">Ctrl K</span>
            </label>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <button className="btn btn-outline" onClick={exportPdf}><Icon name="download" />PDF로 내보내기</button>
            <button className="btn btn-primary" onClick={saveHwpx}><Icon name="save" />저장</button>
          </div>
        </div>
        <Ribbon ctx={ctx} tab={tab} setTab={setTab} />
      </header>

      <div className="workspace">
        {showLeft && (
          <aside className={`side side-left ${showLeft ? 'force' : ''}`} aria-label="문서 개요">
            <OutlinePanel editor={editor} layout={layout} onClose={window.innerWidth <= 860 ? () => setShowLeft(false) : undefined} />
          </aside>
        )}

        <main className={`doc-scroll ${paged ? 'paged' : ''}`} ref={scrollRef} onMouseDown={(e) => {
          if (e.target === e.currentTarget) { e.preventDefault(); editor.commands.focus('end'); }
        }}>
          <div className="paper-zoom" style={{ zoom }}>
            {showRuler && (
              <div className="ruler-wrap" style={{ width: paged ? `${dims.w}mm` : 'min(960px, 92vw)' }}>
                <Ruler width={paged ? dims.w : 0} left={page.marginLeft} right={page.marginRight} indentLeft={indentLeftPt} textIndent={textIndentPt} />
              </div>
            )}
            <div
              className={`paper ${paged ? '' : 'web'}`}
              style={paged ? {
                width: `${dims.w}mm`,
                minHeight: `${dims.h}mm`,
                padding: `${padTopMm}mm ${page.marginRight}mm calc(${padBottomMm}mm + ${layout.lastFill}px) ${page.marginLeft}mm`,
              } : { width: 'min(960px, 92vw)', padding: '32px 40px 64px' }}
              onMouseDown={(e) => {
                if (e.target === e.currentTarget) { e.preventDefault(); editor.commands.focus('end'); }
              }}
            >
              <EditorContent editor={editor} />
              {paged && <span className="pg-last-num" style={{ bottom: `${Math.max(12, padBottomMm * PX * 0.45)}px` }}>- {layout.pages} -</span>}
            </div>
          </div>
        </main>

        {showRight && (
          <aside className={`side side-right ${showRight ? 'force' : ''}`} aria-label="서식 패널">
            <div role="tablist" aria-label="패널" style={{ display: 'flex', padding: '0 8px', borderBottom: '1px solid var(--line)', alignItems: 'center' }}>
              <button className={`tab ${rightTab === 'format' ? 'on' : ''}`} role="tab" aria-selected={rightTab === 'format'} style={{ flex: 1 }} onClick={() => setRightTab('format')}>서식</button>
              <button className={`tab ${rightTab === 'find' ? 'on' : ''}`} role="tab" aria-selected={rightTab === 'find'} style={{ flex: 1 }} onClick={() => openFind(replaceMode)}>찾기</button>
              <button className={`tab ${rightTab === 'info' ? 'on' : ''}`} role="tab" aria-selected={rightTab === 'info'} style={{ flex: 1 }} onClick={() => setRightTab('info')}>정보</button>
              {window.innerWidth <= 860 && <button className="tb" aria-label="패널 닫기" onClick={() => setShowRight(false)}><Icon name="x" /></button>}
            </div>
            {rightTab === 'format' && <FormatPanel editor={editor} page={page} setPage={setPage} onPageDialog={() => setDialog('page')} />}
            {rightTab === 'find' && <FindPanel editor={editor} replaceMode={replaceMode} focusKey={findKey} />}
            {rightTab === 'info' && <InfoPanel editor={editor} layout={layout} name={name} />}
          </aside>
        )}
      </div>

      <footer className="status-bar">
        <span>{curPage} / {layout.pages} 쪽</span>
        <span>글자 {stats.noSpace.toLocaleString()}</span>
        <span>낱말 {stats.words.toLocaleString()}</span>
        <span>{block.type.name === 'heading' ? `개요 ${block.attrs.level}` : '본문'}</span>
        {painter && <span style={{ color: 'var(--accent-strong)', fontWeight: 700 }}>모양 복사 중 — 바꿀 글자를 선택하세요 (Esc 취소)</span>}
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 4 }}>
          <button className={`tb ${showLeft ? 'on' : ''}`} aria-label="개요 창" aria-pressed={showLeft} style={{ height: 28, minWidth: 28 }} onClick={() => setShowLeft(!showLeft)}><Icon name="panelLeft" size={15} /></button>
          <button className={`tb ${showRight ? 'on' : ''}`} aria-label="서식 창" aria-pressed={showRight} style={{ height: 28, minWidth: 28 }} onClick={() => setShowRight(!showRight)}><Icon name="panelRight" size={15} /></button>
          <span style={{ width: 1, height: 16, background: 'var(--line)', margin: '0 6px' }} />
          <button className={`tb ${paged ? 'on' : ''}`} aria-label="쪽 윤곽 보기" aria-pressed={paged} style={{ height: 28, minWidth: 28 }} onClick={() => setView('page')}><Icon name="page" size={15} /></button>
          <button className={`tb ${!paged ? 'on' : ''}`} aria-label="웹 보기" aria-pressed={!paged} style={{ height: 28, minWidth: 28 }} onClick={() => setView('web')}><Icon name="web" size={15} /></button>
          <span style={{ width: 1, height: 16, background: 'var(--line)', margin: '0 6px' }} />
          <button className="tb" aria-label="축소" style={{ height: 28, minWidth: 28 }} onClick={() => setZoom(Math.max(0.3, Math.round((zoom - 0.1) * 10) / 10))}><Icon name="minus" size={15} /></button>
          <input type="range" className="zoom-range" min={30} max={300} step={10} value={Math.round(zoom * 100)} onChange={(e) => setZoom(Number(e.target.value) / 100)} aria-label="배율" />
          <button className="tb" aria-label="확대" style={{ height: 28, minWidth: 28 }} onClick={() => setZoom(Math.min(3, Math.round((zoom + 0.1) * 10) / 10))}><Icon name="plus" size={15} /></button>
          <button className="tb" style={{ height: 28, fontSize: 12, fontWeight: 500, minWidth: 48 }} onClick={() => setZoom(1)} aria-label="배율 100%로">{Math.round(zoom * 100)}%</button>
        </div>
      </footer>

      {mini && !painter && (
        <div className="mini-bar" role="toolbar" aria-label="선택 영역 서식" style={{ left: mini.left, top: mini.top }} onMouseDown={(e) => e.preventDefault()}>
          <button className={`tb ${editor.isActive('bold') ? 'on' : ''}`} aria-label="진하게" style={{ fontWeight: 700 }} onClick={() => editor.chain().focus().toggleBold().run()}>가</button>
          <button className={`tb ${editor.isActive('italic') ? 'on' : ''}`} aria-label="기울임" style={{ fontStyle: 'italic' }} onClick={() => editor.chain().focus().toggleItalic().run()}>가</button>
          <button className={`tb ${editor.isActive('underline') ? 'on' : ''}`} aria-label="밑줄" style={{ textDecoration: 'underline' }} onClick={() => editor.chain().focus().toggleUnderline().run()}>가</button>
          <button className="tb" aria-label="형광펜" onClick={() => editor.chain().focus().toggleHighlight({ color: '#FFD84D' }).run()}><span style={{ width: 14, height: 14, borderRadius: 4, background: '#F5C518' }} /></button>
          <span style={{ width: 1, height: 18, background: '#3C414A' }} />
          <button className="tb" style={{ fontSize: 12 }} onClick={() => openFind(false)}><Icon name="search" size={15} />찾기</button>
          <button className="tb" style={{ fontSize: 12 }} onClick={() => editor.chain().focus().unsetAllMarks().run()}><Icon name="x" size={15} />모양 지우기</button>
        </div>
      )}

      {palette !== null && (
        <CommandPalette
          commands={commands}
          initial={palette}
          onClose={() => setPalette(null)}
          onFindText={(q) => {
            openFind(false);
            setTimeout(() => { editor.commands.setSearch(q); editor.commands.findNext(1); }, 30);
          }}
        />
      )}
      {dialog === 'page' && <PageSetupDialog page={page} onClose={() => setDialog(null)} onApply={setPage} />}
      {dialog === 'count' && (
        <Modal title="문서 정보" onClose={() => setDialog(null)} width={380} footer={<button className="btn btn-primary" onClick={() => setDialog(null)}>확인</button>}>
          <InfoPanel editor={editor} layout={layout} name={name} />
        </Modal>
      )}
    </div>
  );
}

function Ruler({ width, left, right, indentLeft, textIndent }: { width: number; left: number; right: number; indentLeft: number; textIndent: number }) {
  if (!width) return <div className="ruler" style={{ width: '100%' }} aria-hidden="true" />;
  const ticks = [];
  const body = width - left - right;
  for (let mm = 0; mm <= width; mm += 2.5) {
    const rel = mm - left;
    const major = Math.abs(rel % 10) < 0.01;
    const mid = Math.abs(rel % 5) < 0.01;
    ticks.push(<span key={mm} className="tick" style={{ left: `${mm}mm`, height: major ? 7 : mid ? 4 : 2 }} />);
    if (major && rel > 0 && rel < body) ticks.push(<span key={`n${mm}`} className="num" style={{ left: `${mm}mm` }}>{rel / 10}</span>);
  }
  const ptToMm = 25.4 / 72;
  const hang = textIndent < 0 ? -textIndent : 0;
  const firstLine = left + (indentLeft + hang + textIndent) * ptToMm;
  const rest = left + (indentLeft + hang) * ptToMm;
  return (
    <div className="ruler" style={{ width: `${width}mm` }} aria-hidden="true">
      <span className="mg" style={{ left: 0, width: `${left}mm` }} />
      <span className="mg" style={{ right: 0, width: `${right}mm` }} />
      {ticks}
      <span className="mark top" style={{ left: `${firstLine}mm` }} />
      <span className="mark bot" style={{ left: `${rest}mm` }} />
    </div>
  );
}
