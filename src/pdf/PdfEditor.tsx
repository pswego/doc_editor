import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Icon } from '../components/Icon';
import { Popover, usePopover } from '../components/Popover';
import { Loading } from '../App';
import { createHwpDoc, navigate } from '../lib/docs';
import { baseName, downloadBlob, pickFiles } from '../lib/files';
import { formatWhen, getData, getExtra, getMeta, newId, patchMeta, saveData, saveExtra, type DocMeta } from '../lib/storage';
import { toast } from '../lib/toast';
import { useFileDrop } from '../lib/useFileDrop';
import { openFilesAndGo } from '../home/Home';
import { loadPdf, type PDFDocumentProxy } from './pdfjs';
import { PageView, type NewAnnot, type PageInfo } from './PageView';
import { PagesGrid } from './PagesGrid';
import { Thumb } from './Thumb';
import { SignatureDialog, loadSignatures, saveSignatures } from './SignatureDialog';
import { buildPdf, isInPlace } from './save';
import { makeVp } from './geometry';
import type { Annot, PageRef, PdfSource, PdfState, PdfStored, TextEdit, Tool } from './types';
import './pdf.css';

type Mode = 'view' | 'annotate' | 'edit' | 'pages' | 'form' | 'sign' | 'convert';

const MODES: { id: Mode; label: string; icon: string }[] = [
  { id: 'view', label: '보기', icon: 'eye' },
  { id: 'annotate', label: '주석', icon: 'comment' },
  { id: 'edit', label: '텍스트 편집', icon: 'textEdit' },
  { id: 'pages', label: '페이지', icon: 'grid' },
  { id: 'form', label: '양식', icon: 'form' },
  { id: 'sign', label: '서명', icon: 'sign' },
  { id: 'convert', label: '변환', icon: 'convert' },
];

const DEFAULT_TOOL: Record<Mode, Tool> = { view: 'select', annotate: 'highlight', edit: 'edit', pages: 'select', form: 'select', sign: 'signature', convert: 'select' };
const COLORS: [string, string][] = [['#FFD84D', '노랑'], ['#7FD99A', '초록'], ['#8CC4FF', '하늘'], ['#F9A8D4', '분홍'], ['#DC2626', '빨강'], ['#2457D6', '파랑'], ['#111316', '검정']];
const STAMPS = ['검토 완료', '승인', '반려', '확인', '기밀', '사본', '긴급'];
const TYPE_LABEL: Record<string, string> = { highlight: '형광펜', underline: '밑줄', strike: '취소선', note: '메모', text: '글상자', ink: '펜', rect: '사각형', ellipse: '타원', arrow: '화살표', stamp: '도장', image: '서명' };

export default function PdfEditor({ id, initialMode }: { id: string; initialMode?: string }) {
  const [meta, setMeta] = useState<DocMeta | null>(null);
  const [stored, setStored] = useState<PdfStored | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    (async () => {
      const m = await getMeta(id);
      const d = await getData<PdfStored>(id);
      if (!m || !d) return setError('문서를 찾을 수 없습니다. 이 브라우저에서 지워졌을 수 있어요.');
      const st = await getExtra<PdfState>(`pdfstate:${id}`);
      setMeta(m);
      setStored(st ? { ...d, state: st } : d);
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
  if (!meta || !stored) return <Loading text="PDF를 여는 중…" />;
  const mode = (MODES.some((m) => m.id === initialMode) ? initialMode : initialMode === 'sign' ? 'sign' : 'annotate') as Mode;
  return <PdfScreen meta={meta} initial={stored} initialMode={mode} />;
}

function PdfScreen({ meta, initial, initialMode }: { meta: DocMeta; initial: PdfStored; initialMode: Mode }) {
  const id = meta.id;
  const [sources, setSources] = useState<PdfSource[]>(initial.sources);
  const [docs, setDocs] = useState<Map<string, PDFDocumentProxy>>(new Map());
  const [infos, setInfos] = useState<Map<string, PageInfo>>(new Map());
  const [state, setState] = useState<PdfState>(initial.state);
  const hist = useRef<{ past: PdfState[]; future: PdfState[] }>({ past: [], future: [] });
  const [mode, setModeState] = useState<Mode>(initialMode);
  const [tool, setToolState] = useState<Tool>(DEFAULT_TOOL[initialMode]);
  const [color, setColor] = useState('#FFD84D');
  /** 도구에 어울리는 색으로 자동 전환 (형광펜은 밝은 색, 글·선은 진한 색) */
  const setTool = useCallback((t: Tool) => {
    setToolState(t);
    const pastel = ['#FFD84D', '#7FD99A', '#8CC4FF', '#F9A8D4'];
    setColor((c) => {
      if (t === 'highlight' && !pastel.includes(c)) return '#FFD84D';
      if (t === 'text' && pastel.includes(c)) return '#111316';
      if ((t === 'ink' || t === 'rect' || t === 'ellipse' || t === 'arrow' || t === 'underline' || t === 'strike') && pastel.includes(c)) return '#DC2626';
      if (t === 'stamp' && pastel.includes(c)) return '#C2410C';
      return c;
    });
  }, []);
  const [opacity, setOpacity] = useState(0.4);
  const [strokeWidth, setStrokeWidth] = useState(2);
  const [fontSize, setFontSize] = useState(12);
  const [stampLabel, setStampLabel] = useState(STAMPS[0]);
  const [scale, setScale] = useState(1);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [selPages, setSelPages] = useState<Set<string>>(new Set());
  const [curPage, setCurPage] = useState(0);
  const [leftTab, setLeftTab] = useState<'pages' | 'outline'>('pages');
  const [outline, setOutline] = useState<{ title: string; page: number }[]>([]);
  const [flash, setFlash] = useState<{ page: string; rect: number[]; key: number } | null>(null);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [signatures, setSignatures] = useState<string[]>(loadSignatures);
  const [signature, setSignature] = useState<string | null>(() => loadSignatures()[0] ?? null);
  const [sigDialog, setSigDialog] = useState(false);
  const [name, setName] = useState(meta.name);
  const pendingText = useRef<string | null>(null);
  const mainRef = useRef<HTMLDivElement>(null);
  const fitted = useRef(false);

  // ── 원본 불러오기 ─────────────────────────
  useEffect(() => {
    let alive = true;
    (async () => {
      const next = new Map(docs);
      for (const s of sources) {
        if (next.has(s.id)) continue;
        try {
          next.set(s.id, await loadPdf(s.bytes));
        } catch (e) {
          const msg = (e as Error).message || '';
          toast(/password/i.test(msg) ? `‘${s.name}’은(는) 암호가 걸려 있어 열 수 없습니다.` : `‘${s.name}’을(를) 읽지 못했습니다.`, 'error', 6000);
        }
      }
      if (alive) setDocs(next);
    })();
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sources]);
  useEffect(() => () => { docs.forEach((d) => d.destroy()); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    let alive = true;
    (async () => {
      const next = new Map(infos);
      let changed = false;
      for (const p of state.pages) {
        if (next.has(p.id)) continue;
        if (!p.src) {
          next.set(p.id, { view: [0, 0, p.w ?? 595.28, p.h ?? 841.89], baseRotate: 0 });
          changed = true;
          continue;
        }
        const d = docs.get(p.src);
        if (!d) continue;
        try {
          const pg = await d.getPage(p.index + 1);
          next.set(p.id, { view: pg.view, baseRotate: pg.rotate, pdf: pg });
          changed = true;
        } catch {
          /* 깨진 페이지는 건너뜀 */
        }
      }
      if (alive && changed) setInfos(next);
    })();
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docs, state.pages]);

  // 책갈피(목차)
  useEffect(() => {
    const d = docs.get(sources[0]?.id);
    if (!d) return;
    d.getOutline().then(async (items) => {
      if (!items) return;
      const out: { title: string; page: number }[] = [];
      const walk = async (list: typeof items, depth: number) => {
        for (const it of list) {
          let page = -1;
          try {
            const dest = typeof it.dest === 'string' ? await d.getDestination(it.dest) : it.dest;
            if (dest && dest[0]) page = await d.getPageIndex(dest[0]);
          } catch { /* 무시 */ }
          out.push({ title: `${'  '.repeat(depth)}${it.title}`, page });
          if (it.items?.length && depth < 2) await walk(it.items, depth + 1);
        }
      };
      await walk(items, 0);
      setOutline(out);
    }).catch(() => {});
  }, [docs, sources]);

  // 처음에 폭 맞춤
  const fitWidth = useCallback(() => {
    const el = mainRef.current;
    const first = infos.get(state.pages[0]?.id);
    if (!el || !first) return;
    const vp = makeVp(first.view, 1, first.baseRotate + state.pages[0].rotate);
    setScale(Math.max(0.3, Math.min(3, Math.floor(((el.clientWidth - 96) / vp.width) * 20) / 20)));
  }, [infos, state.pages]);
  useEffect(() => {
    if (fitted.current || !infos.size) return;
    fitted.current = true;
    const el = mainRef.current;
    const first = infos.get(state.pages[0]?.id);
    if (!el || !first) return;
    const vp = makeVp(first.view, 1, first.baseRotate + state.pages[0].rotate);
    setScale(Math.max(0.5, Math.min(1.4, Math.floor(((el.clientWidth - 96) / vp.width) * 20) / 20)));
  }, [infos, state.pages]);

  // ── 상태 변경 · 기록 ─────────────────────
  const commit = useCallback((next: PdfState | ((s: PdfState) => PdfState), record = true) => {
    setState((cur) => {
      const n = typeof next === 'function' ? next(cur) : next;
      if (n === cur) return cur;
      if (record) {
        hist.current.past.push(cur);
        if (hist.current.past.length > 100) hist.current.past.shift();
        hist.current.future = [];
      }
      return n;
    });
    setDirty(true);
  }, []);
  const undo = useCallback(() => {
    const prev = hist.current.past.pop();
    if (!prev) return;
    setState((cur) => { hist.current.future.push(cur); return prev; });
    setDirty(true);
  }, []);
  const redo = useCallback(() => {
    const nx = hist.current.future.pop();
    if (!nx) return;
    setState((cur) => { hist.current.past.push(cur); return nx; });
    setDirty(true);
  }, []);

  // 자동 저장 (브라우저)
  const saveTimer = useRef(0);
  useEffect(() => {
    clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => {
      saveExtra(`pdfstate:${id}`, state);
      const n = state.annots.length;
      patchMeta(id, { updatedAt: Date.now(), pages: state.pages.length, status: state.annots.some((a) => a.type === 'image' && a.label === '서명') ? '서명함' : n ? `주석 ${n}` : undefined });
    }, 500);
  }, [state, id]);
  const persistSources = useCallback(async (list: PdfSource[], st: PdfState) => {
    await saveData(id, { sources: list, state: st } satisfies PdfStored);
  }, [id]);

  const setMode = (m: Mode) => {
    setModeState(m);
    setTool(DEFAULT_TOOL[m]);
    setSelectedId(null);
    setEditingId(null);

  };

  // ── 주석 조작 ─────────────────────────────
  const onAdd = useCallback((page: string, a: NewAnnot, edit?: boolean) => {
    const aid = newId();
    const full: Annot = { ...a, id: aid, page, author: '나', createdAt: Date.now() } as Annot;
    if (full.type === 'text' && pendingText.current) {
      full.text = pendingText.current;
      pendingText.current = null;
      edit = false;
      setTool('select');
    }
    commit((s) => ({ ...s, annots: [...s.annots, full] }));
    if (edit) setEditingId(aid);
    return aid;
  }, [commit]);
  const onUpdate = useCallback((aid: string, patch: Partial<Annot>, record: boolean) => {
    if (!Object.keys(patch).length) {
      // 끌기 끝: 지금 상태를 기록에 남김
      if (record) setState((cur) => { hist.current.past.push(dragStart.current ?? cur); dragStart.current = null; hist.current.future = []; return cur; });
      return;
    }
    if (!record && !dragStart.current) dragStart.current = stateRef.current;
    commit((s) => ({ ...s, annots: s.annots.map((x) => (x.id === aid ? { ...x, ...patch } : x)) }), record);
  }, [commit]);
  const dragStart = useRef<PdfState | null>(null);
  const stateRef = useRef(state);
  stateRef.current = state;
  const onRemove = useCallback((aid: string) => {
    commit((s) => ({ ...s, annots: s.annots.filter((x) => x.id !== aid) }));
    setSelectedId((cur) => (cur === aid ? null : cur));
  }, [commit]);
  const onAddEdit = useCallback((page: string, e: Omit<TextEdit, 'id' | 'page' | 'createdAt'>) => {
    commit((s) => ({ ...s, edits: [...s.edits, { ...e, id: newId(), page, createdAt: Date.now() }] }));
  }, [commit]);
  const onUpdateEdit = useCallback((eid: string, patch: Partial<TextEdit>) => commit((s) => ({ ...s, edits: s.edits.map((x) => (x.id === eid ? { ...x, ...patch } : x)) })), [commit]);
  const onRemoveEdit = useCallback((eid: string) => commit((s) => ({ ...s, edits: s.edits.filter((x) => x.id !== eid) })), [commit]);
  const onPan = useCallback((dx: number, dy: number) => { mainRef.current?.scrollBy(dx, dy); }, []);
  const onVisible = useCallback(() => {}, []);

  // 현재 쪽 추적
  useEffect(() => {
    const el = mainRef.current;
    if (!el) return;
    let raf = 0;
    const on = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const mid = el.getBoundingClientRect().top + el.clientHeight * 0.35;
        const pages = el.querySelectorAll<HTMLElement>('[data-page-id]');
        let idx = 0;
        pages.forEach((p, i) => { if (p.getBoundingClientRect().top <= mid) idx = i; });
        setCurPage(idx);
      });
    };
    el.addEventListener('scroll', on, { passive: true });
    return () => el.removeEventListener('scroll', on);
  }, [mode]);

  const goPage = useCallback((idx: number) => {
    const p = state.pages[Math.max(0, Math.min(state.pages.length - 1, idx))];
    if (!p) return;
    if (mode === 'pages') setMode('annotate');
    setTimeout(() => mainRef.current?.querySelector(`[data-page-id="${p.id}"]`)?.scrollIntoView({ block: 'start', behavior: 'smooth' }), 30);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.pages, mode]);

  // ── 저장 · 내보내기 ─────────────────────────
  const pageCounts = useMemo(() => new Map([...docs].map(([k, d]) => [k, d.numPages])), [docs]);
  const build = useCallback(async (st: PdfState = state) => {
    return buildPdf(sources, st, pageCounts);
  }, [sources, state, pageCounts]);
  const save = useCallback(async () => {
    setBusy('PDF를 만드는 중…');
    try {
      const bytes = await build();
      downloadBlob(bytes, `${name}.pdf`, 'application/pdf');
      setDirty(false);
      toast('편집한 PDF를 내려받았습니다.', 'ok');
    } catch (e) {
      toast(`저장하지 못했습니다: ${(e as Error).message}`, 'error', 6000);
    } finally {
      setBusy(null);
    }
  }, [build, name]);
  const print = useCallback(async () => {
    setBusy('인쇄용 PDF를 만드는 중…');
    try {
      const bytes = await build();
      const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: 'application/pdf' }));
      const w = window.open(url, '_blank');
      if (!w) downloadBlob(bytes, `${name}.pdf`, 'application/pdf');
      toast('새 탭에서 인쇄 버튼을 눌러 주세요.', 'info');
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setBusy(null);
    }
  }, [build, name]);

  // ── 페이지 정리 ─────────────────────────────
  const selectedOrCurrent = () => (selPages.size ? state.pages.filter((p) => selPages.has(p.id)) : state.pages[curPage] ? [state.pages[curPage]] : []);
  const rotatePages = (deg: number) => {
    const ids = new Set(selectedOrCurrent().map((p) => p.id));
    if (!ids.size) return;
    commit((s) => ({ ...s, pages: s.pages.map((p) => (ids.has(p.id) ? { ...p, rotate: (((p.rotate + deg) % 360) + 360) % 360 } : p)) }));
  };
  const deletePages = () => {
    const ids = new Set(selectedOrCurrent().map((p) => p.id));
    if (!ids.size) return;
    if (ids.size >= state.pages.length) return toast('모든 페이지를 지울 수는 없습니다.', 'error');
    commit((s) => ({ ...s, pages: s.pages.filter((p) => !ids.has(p.id)), annots: s.annots.filter((a) => !ids.has(a.page)), edits: s.edits.filter((e) => !ids.has(e.page)) }));
    setSelPages(new Set());
    toast(`${ids.size}쪽을 지웠습니다. (Ctrl+Z로 되돌리기)`, 'ok');
  };
  const duplicatePages = () => {
    const list = selectedOrCurrent();
    if (!list.length) return;
    commit((s) => {
      const pages = [...s.pages];
      const annots = [...s.annots];
      const last = Math.max(...list.map((p) => pages.findIndex((x) => x.id === p.id)));
      const copies = list.map((p) => {
        const nid = newId();
        s.annots.filter((a) => a.page === p.id).forEach((a) => annots.push({ ...JSON.parse(JSON.stringify(a)), id: newId(), page: nid }));
        return { ...p, id: nid };
      });
      pages.splice(last + 1, 0, ...copies);
      return { ...s, pages, annots };
    });
  };
  const insertBlank = () => {
    const ref = selectedOrCurrent().slice(-1)[0];
    const info = ref ? infos.get(ref.id) : undefined;
    const vp = info ? makeVp(info.view, 1, info.baseRotate + (ref?.rotate ?? 0)) : { width: 595.28, height: 841.89 };
    const blank: PageRef = { id: newId(), src: null, index: 0, rotate: 0, w: vp.width, h: vp.height };
    commit((s) => {
      const pages = [...s.pages];
      const at = ref ? pages.findIndex((p) => p.id === ref.id) + 1 : pages.length;
      pages.splice(at, 0, blank);
      return { ...s, pages };
    });
  };
  const insertPdf = async () => {
    const files = await pickFiles('.pdf,application/pdf', true);
    if (!files.length) return;
    setBusy('PDF를 끼워 넣는 중…');
    try {
      const added: PdfSource[] = [];
      const refs: PageRef[] = [];
      for (const f of files) {
        const bytes = await f.arrayBuffer();
        const d = await loadPdf(bytes);
        const src = { id: newId(), name: f.name, bytes };
        added.push(src);
        for (let i = 0; i < d.numPages; i++) refs.push({ id: newId(), src: src.id, index: i, rotate: 0 });
        await d.destroy();
      }
      const ref = selectedOrCurrent().slice(-1)[0];
      let nextState: PdfState = state;
      commit((s) => {
        const pages = [...s.pages];
        const at = ref ? pages.findIndex((p) => p.id === ref.id) + 1 : pages.length;
        pages.splice(at, 0, ...refs);
        nextState = { ...s, pages };
        return nextState;
      });
      const list = [...sources, ...added];
      setSources(list);
      setTimeout(() => persistSources(list, nextState), 0);
      toast(`${refs.length}쪽을 끼워 넣었습니다.`, 'ok');
    } catch (e) {
      toast(`PDF를 읽지 못했습니다: ${(e as Error).message}`, 'error');
    } finally {
      setBusy(null);
    }
  };
  const extractPages = async () => {
    const list = selectedOrCurrent();
    if (!list.length) return;
    setBusy('선택한 페이지를 꺼내는 중…');
    try {
      const ids = new Set(list.map((p) => p.id));
      const bytes = await build({ ...state, pages: state.pages.filter((p) => ids.has(p.id)), form: {} });
      downloadBlob(bytes, `${name}_${list.length}쪽.pdf`, 'application/pdf');
      toast(`${list.length}쪽을 새 PDF로 내려받았습니다.`, 'ok');
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setBusy(null);
    }
  };
  const movePages = (ids: string[], before: number) => {
    commit((s) => {
      const moving = s.pages.filter((p) => ids.includes(p.id));
      const beforeId = s.pages[before]?.id;
      const rest = s.pages.filter((p) => !ids.includes(p.id));
      let at = beforeId ? rest.findIndex((p) => p.id === beforeId) : rest.length;
      if (at < 0) at = rest.length;
      rest.splice(at, 0, ...moving);
      return { ...s, pages: rest };
    });
  };

  // ── 키보드 ────────────────────────────────
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      const typing = t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable;
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === 's') { e.preventDefault(); save(); return; }
      if (mod && e.key.toLowerCase() === 'p') { e.preventDefault(); print(); return; }
      if (typing) return;
      if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); if (e.shiftKey) redo(); else undo(); }
      else if (mod && e.key.toLowerCase() === 'y') { e.preventDefault(); redo(); }
      else if (mod && (e.key === '=' || e.key === '+')) { e.preventDefault(); setScale((s) => Math.min(4, Math.round((s + 0.1) * 10) / 10)); }
      else if (mod && e.key === '-') { e.preventDefault(); setScale((s) => Math.max(0.25, Math.round((s - 0.1) * 10) / 10)); }
      else if ((e.key === 'Delete' || e.key === 'Backspace') && selectedId) { e.preventDefault(); onRemove(selectedId); }
      else if ((e.key === 'Delete' || e.key === 'Backspace') && mode === 'pages' && selPages.size) { e.preventDefault(); deletePages(); }
      else if (e.key === 'Escape') { setSelectedId(null); if (mode !== 'pages') setTool(DEFAULT_TOOL[mode] === 'signature' ? 'select' : 'select'); }
      else if (mode === 'pages' && mod && e.key.toLowerCase() === 'a') { e.preventDefault(); setSelPages(new Set(state.pages.map((p) => p.id))); }
      else if (e.key === 'PageDown') { e.preventDefault(); goPage(curPage + 1); }
      else if (e.key === 'PageUp') { e.preventDefault(); goPage(curPage - 1); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  useFileDrop(useCallback((files: File[]) => openFilesAndGo(files), []), mode !== 'pages');
  useEffect(() => { document.title = `${name} · 문서공방`; }, [name]);

  // ── 문서 검색 ─────────────────────────────
  const textCache = useRef(new Map<string, { str: string; rect: number[] }[]>());
  const search = useCallback(async (q: string) => {
    const out: { page: number; id: string; snippet: string; rect: number[] }[] = [];
    if (!q.trim()) return out;
    const needle = q.toLowerCase();
    for (let i = 0; i < state.pages.length; i++) {
      const ref = state.pages[i];
      const info = infos.get(ref.id);
      if (!info?.pdf) continue;
      let items = textCache.current.get(ref.id);
      if (!items) {
        const tc = await info.pdf.getTextContent();
        items = (tc.items as { str?: string; transform?: number[]; width?: number; height?: number }[])
          .filter((it) => it.str)
          .map((it) => {
            const [, , c, d, e, f] = it.transform!;
            const h = Math.hypot(c, d) || it.height || 10;
            return { str: it.str!, rect: [e, f - h * 0.24, e + (it.width ?? 0), f + h * 0.9] };
          });
        textCache.current.set(ref.id, items);
      }
      for (const it of items) {
        const k = it.str.toLowerCase().indexOf(needle);
        if (k >= 0) out.push({ page: i, id: ref.id, snippet: it.str.slice(Math.max(0, k - 20), k + needle.length + 30), rect: it.rect });
        if (out.length > 300) return out;
      }
    }
    return out;
  }, [state.pages, infos]);
  const showHit = (h: { page: number; id: string; rect: number[] }) => {
    if (mode === 'pages') setMode('view');
    setTimeout(() => {
      const el = mainRef.current?.querySelector(`[data-page-id="${h.id}"]`) as HTMLElement | null;
      if (el && mainRef.current) {
        const info = infos.get(h.id)!;
        const ref = state.pages[h.page];
        const vp = makeVp(info.view, scale, info.baseRotate + ref.rotate);
        const [, vy] = vp.toView(h.rect[0], h.rect[3]);
        mainRef.current.scrollTo({ top: el.offsetTop + vy - mainRef.current.clientHeight / 3, behavior: 'smooth' });
      }
      setFlash({ page: h.id, rect: h.rect, key: Date.now() });
    }, 40);
  };

  // ── 화면 ────────────────────────────────
  const annotsByPage = useMemo(() => {
    const m = new Map<string, Annot[]>();
    state.annots.forEach((a) => { if (!m.has(a.page)) m.set(a.page, []); m.get(a.page)!.push(a); });
    return m;
  }, [state.annots]);
  const editsByPage = useMemo(() => {
    const m = new Map<string, TextEdit[]>();
    state.edits.forEach((e) => { if (!m.has(e.page)) m.set(e.page, []); m.get(e.page)!.push(e); });
    return m;
  }, [state.edits]);
  const EMPTY: never[] = useMemo(() => [], []);
  const changes = state.annots.length + state.edits.length + (hist.current.past.length ? 0 : 0);
  const sourceNames = sources.map((s) => s.name);
  const inPlace = isInPlace(sources, state);
  const effTool: Tool = mode === 'view' ? (tool === 'hand' ? 'hand' : 'select') : tool;

  const toolBtn = (t: Tool, label: string, icon: string | null, text?: string, style?: React.CSSProperties) => (
    <button className={`tb ${tool === t ? 'on' : ''}`} aria-pressed={tool === t} aria-label={text ? undefined : label} title={label} onClick={() => setTool(t)} style={style}>
      {icon && <Icon name={icon} />}
      {text}
    </button>
  );
  const colorRow = (list = COLORS) => (
    <div role="radiogroup" aria-label="색상" style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '0 6px', flex: 'none' }}>
      {list.map(([c, l]) => <button key={c} role="radio" aria-checked={color === c} aria-label={l} title={l} className={`sw ${color === c ? 'on' : ''}`} style={{ background: c }} onClick={() => { setColor(c); if (selectedId) onUpdate(selectedId, { color: c }, true); }} />)}
    </div>
  );

  let toolbar: React.ReactNode = null;
  if (mode === 'annotate') {
    toolbar = (
      <>
        {toolBtn('select', '선택 (옮기기·지우기)', 'cursor')}
        {toolBtn('hand', '손 도구 (화면 이동)', 'hand')}
        <span className="sep-v" />
        {toolBtn('highlight', '형광펜 — 글자를 드래그하세요', 'highlighter', '형광펜')}
        {toolBtn('underline', '밑줄 — 글자를 드래그하세요', null, '가', { textDecoration: 'underline', fontWeight: 700, fontSize: 15 })}
        {toolBtn('strike', '취소선 — 글자를 드래그하세요', null, '가', { textDecoration: 'line-through', fontWeight: 700, fontSize: 15 })}
        {toolBtn('note', '메모 — 놓을 곳을 누르세요', 'note', '메모')}
        {toolBtn('text', '글상자 — 넣을 곳을 누르세요', 'textbox', '텍스트 상자')}
        <span className="sep-v" />
        {toolBtn('ink', '펜', 'pen')}
        {toolBtn('rect', '사각형', 'rect')}
        {toolBtn('ellipse', '타원', 'ellipse')}
        {toolBtn('arrow', '화살표', 'arrow')}
        <StampButton tool={tool} setTool={setTool} label={stampLabel} setLabel={setStampLabel} />
        <span className="sep-v" />
        {colorRow()}
        {tool === 'highlight' && <OpacityButton value={opacity} onChange={setOpacity} />}
        {(tool === 'ink' || tool === 'rect' || tool === 'ellipse' || tool === 'arrow') && <WidthButton value={strokeWidth} onChange={setStrokeWidth} />}
        {tool === 'text' && <FontSizeButton value={fontSize} onChange={setFontSize} />}
      </>
    );
  } else if (mode === 'view') {
    toolbar = (
      <>
        {toolBtn('select', '선택 · 글자 복사', 'cursor', '선택')}
        {toolBtn('hand', '손 도구', 'hand', '이동')}
        <span className="sep-v" />
        <span className="muted" style={{ fontSize: 13, flex: 'none' }}>읽기 모드 — 주석을 달려면 ‘주석’을 고르세요.</span>
      </>
    );
  } else if (mode === 'edit') {
    toolbar = (
      <>
        {toolBtn('edit', '원래 글자 고치기 — 바꿀 글자를 누르세요', 'textEdit', '글자 고치기')}
        {toolBtn('text', '새 글자 넣기', 'textbox', '글자 넣기')}
        {toolBtn('select', '선택', 'cursor')}
        <span className="sep-v" />
        {tool === 'text' && <><FontSizeButton value={fontSize} onChange={setFontSize} />{colorRow([['#111316', '검정'], ['#2457D6', '파랑'], ['#DC2626', '빨강']])}</>}
        <span className="muted" style={{ fontSize: 12, flex: 'none' }}>고친 글자는 원래 자리를 흰색으로 덮고 본고딕(Noto Sans KR)으로 다시 씁니다.</span>
      </>
    );
  } else if (mode === 'sign') {
    toolbar = (
      <>
        {toolBtn('signature', '서명 넣기 — 넣을 곳을 누르세요', 'sign', '서명 넣기')}
        <button className="tb" onClick={() => { pendingText.current = todayText(); setTool('text'); toast('날짜를 넣을 곳을 누르세요.', 'info'); }}><Icon name="calendar" />날짜</button>
        {toolBtn('text', '글자 넣기', 'textbox', '글자')}
        <StampButton tool={tool} setTool={setTool} label={stampLabel} setLabel={setStampLabel} />
        {toolBtn('select', '선택 (옮기기·크기)', 'cursor')}
        <span className="sep-v" />
        <button className="btn btn-outline btn-sm" onClick={() => setSigDialog(true)}><Icon name="plus" size={16} />새 서명 만들기</button>
      </>
    );
  } else if (mode === 'pages') {
    const n = selPages.size;
    toolbar = (
      <>
        <button className="tb" onClick={() => setSelPages(n === state.pages.length ? new Set() : new Set(state.pages.map((p) => p.id)))}><Icon name="check" />{n === state.pages.length ? '선택 해제' : '모두 선택'}</button>
        <span className="sep-v" />
        <button className="tb" disabled={!n} onClick={() => rotatePages(-90)}><Icon name="rotateLeft" />왼쪽 회전</button>
        <button className="tb" disabled={!n} onClick={() => rotatePages(90)}><Icon name="rotate" />오른쪽 회전</button>
        <button className="tb" disabled={!n} onClick={duplicatePages}><Icon name="duplicate" />복제</button>
        <button className="tb" disabled={!n} onClick={deletePages} style={{ color: n ? 'var(--danger-text)' : undefined }}><Icon name="trash" />지우기</button>
        <span className="sep-v" />
        <button className="tb" onClick={insertBlank}><Icon name="plus" />빈 페이지</button>
        <button className="tb" onClick={insertPdf}><Icon name="insertPdf" />PDF 끼워 넣기</button>
        <button className="tb" disabled={!n} onClick={extractPages}><Icon name="extract" />선택 페이지 추출</button>
        <span className="muted" style={{ marginLeft: 8, fontSize: 12, flex: 'none' }}>{n ? `${n}쪽 선택됨 · ` : ''}끌어서 순서를 바꾸고, Shift·Ctrl로 여러 쪽을 고르세요</span>
      </>
    );
  } else if (mode === 'form') {
    toolbar = <span className="muted" style={{ fontSize: 13 }}>오른쪽 창에서 양식 칸을 채운 뒤 ‘저장’을 누르면 값이 들어간 PDF가 만들어집니다.</span>;
  } else if (mode === 'convert') {
    toolbar = <span className="muted" style={{ fontSize: 13 }}>지금까지 편집한 내용이 반영된 결과로 변환합니다.</span>;
  }

  const sel = state.annots.find((a) => a.id === selectedId) ?? null;

  return (
    <div className="pdf-app">
      <header className="app-header">
        <div className="title-row">
          <a href="#/" className="logo-btn" aria-label="홈으로"><Icon name="doc" /></a>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 1, minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span className="badge pdf" style={{ fontSize: 11, padding: '1px 6px' }}>PDF</span>
              <input className="title-input" aria-label="문서 이름" value={name} size={Math.max(8, Math.min(36, name.length + 2))} onChange={(e) => setName(e.target.value)} onBlur={() => { const n = name.trim() || '제목 없음'; setName(n); patchMeta(id, { name: n }); }} onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()} />
            </div>
            <span style={{ fontSize: 12, color: 'var(--ink-2)' }}>
              {state.pages.length}쪽{sourceNames.length > 1 ? ` · 원본 ${sourceNames.length}개` : ''} · {dirty ? (changes ? `변경 ${changes}건 · 아직 내려받지 않음` : '아직 내려받지 않음') : `편집 상태 자동 저장됨 · ${formatWhen(meta.updatedAt)}`}
            </span>
          </div>
          <nav aria-label="작업 모드" style={{ flex: '1 1 520px', display: 'flex', flexWrap: 'wrap', justifyContent: 'center', gap: 2 }}>
            {MODES.map((m) => (
              <button key={m.id} className={`md ${mode === m.id ? 'on' : ''}`} aria-current={mode === m.id ? 'page' : undefined} onClick={() => setMode(m.id)}>
                <Icon name={m.icon} />{m.label}
              </button>
            ))}
          </nav>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <SearchButton search={search} onHit={showHit} />
            <button className="tb" aria-label="인쇄 (Ctrl+P)" title="인쇄" onClick={print}><Icon name="print" /></button>
            <button className="tb" aria-label="실행 취소 (Ctrl+Z)" title="실행 취소" disabled={!hist.current.past.length} onClick={undo}><Icon name="undo" /></button>
            <button className="tb" aria-label="다시 실행 (Ctrl+Y)" title="다시 실행" disabled={!hist.current.future.length} onClick={redo}><Icon name="redo" /></button>
            <button className="btn btn-primary" onClick={save}><Icon name="download" />저장</button>
          </div>
        </div>
        <div className="pdf-toolbar" role="toolbar" aria-label="도구">{toolbar}</div>
      </header>

      <div className="pdf-work">
        {mode !== 'pages' && (
          <aside className="pdf-side-left" aria-label="페이지 탐색">
            <div className="tabs-v" role="tablist" aria-orientation="vertical" aria-label="탐색 보기">
              <button className={`tb ${leftTab === 'pages' ? 'on' : ''}`} role="tab" aria-selected={leftTab === 'pages'} aria-label="페이지" onClick={() => setLeftTab('pages')}><Icon name="grid" /></button>
              <button className={`tb ${leftTab === 'outline' ? 'on' : ''}`} role="tab" aria-selected={leftTab === 'outline'} aria-label="책갈피" onClick={() => setLeftTab('outline')}><Icon name="bookmark" /></button>
            </div>
            <div className="thumbs">
              {leftTab === 'pages' ? (
                <>
                  {state.pages.map((p, i) => {
                    const info = infos.get(p.id);
                    const n = (annotsByPage.get(p.id)?.length ?? 0) + (editsByPage.get(p.id)?.length ?? 0);
                    return (
                      <button key={p.id} className={`th ${i === curPage ? 'on' : ''}`} onClick={() => goPage(i)} aria-label={`${i + 1}쪽으로`} aria-current={i === curPage ? 'page' : undefined}>
                        {info ? <Thumb info={info} rotate={p.rotate} width={96} /> : <span className="blank" style={{ width: 96, height: 132 }} />}
                        {i + 1}
                        {n > 0 && <span className="cnt" aria-label={`주석 ${n}개`}>{n}</span>}
                      </button>
                    );
                  })}
                  <button className="tb" style={{ marginTop: 6, width: '100%', border: '1px dashed #B5BCC7', fontSize: 12, color: 'var(--ink-2)' }} onClick={() => { setMode('pages'); }}>
                    <Icon name="grid" size={15} />페이지 정리
                  </button>
                </>
              ) : outline.length ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 2, width: '100%' }}>
                  {outline.map((o, i) => (
                    <button key={i} className="ol" style={{ fontSize: 12, whiteSpace: 'pre-wrap' }} disabled={o.page < 0} onClick={() => {
                      const k = state.pages.findIndex((p) => p.src === sources[0].id && p.index === o.page);
                      if (k >= 0) goPage(k);
                    }}>{o.title}</button>
                  ))}
                </div>
              ) : (
                <p className="muted" style={{ fontSize: 12, lineHeight: 1.6 }}>이 PDF에는 책갈피가 없습니다.</p>
              )}
            </div>
          </aside>
        )}

        <main ref={mainRef} className={`pdf-main ${effTool === 'hand' ? 'hand' : ''}`} aria-label="PDF 페이지">
          {!docs.size && <div style={{ padding: 60 }}><div className="spinner" /></div>}
          {mode === 'pages' ? (
            <PagesGrid
              pages={state.pages}
              infos={infos}
              selected={selPages}
              setSelected={setSelPages}
              onMove={movePages}
              onOpen={(pid) => { setMode('annotate'); setTimeout(() => goPage(state.pages.findIndex((p) => p.id === pid)), 50); }}
              annotCount={(pid) => annotsByPage.get(pid)?.length ?? 0}
            />
          ) : (
            <>
              {mode === 'sign' && (
                <div className="banner" role="status">
                  <span style={{ width: 28, height: 28, borderRadius: 8, background: 'var(--warn-soft)', color: 'var(--warn-text)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Icon name="sign" size={16} /></span>
                  <span style={{ flex: '1 1 200px' }}>{signature ? <>서명할 위치를 누르면 <b>선택한 서명</b>이 들어갑니다. 넣은 뒤 끌어서 옮기거나 크기를 바꿀 수 있어요.</> : <>먼저 <b>서명을 만들어</b> 주세요. 이 브라우저에 저장해 두고 다시 쓸 수 있습니다.</>}</span>
                  {!signature && <button className="btn btn-dark btn-sm" onClick={() => setSigDialog(true)}>서명 만들기</button>}
                </div>
              )}
              {mode === 'form' && !inPlace && (
                <div className="banner" role="status"><Icon name="info" />페이지 구성을 바꾼 문서라 양식 값은 저장되지 않습니다. 원래 순서로 되돌리면 양식을 채울 수 있어요.</div>
              )}
              {state.pages.map((p, i) => {
                const info = infos.get(p.id);
                if (!info) return <div key={p.id} className="pdf-page" style={{ width: 600 * scale, height: 800 * scale }} data-page-id={p.id} />;
                return (
                  <PageView
                    key={p.id}
                    pageRef={p}
                    num={i + 1}
                    info={info}
                    scale={scale}
                    annots={annotsByPage.get(p.id) ?? EMPTY}
                    edits={editsByPage.get(p.id) ?? EMPTY}
                    tool={effTool}
                    color={color}
                    opacity={opacity}
                    strokeWidth={strokeWidth}
                    fontSize={fontSize}
                    stampLabel={stampLabel}
                    signature={signature}
                    selectedId={selectedId}
                    editingId={editingId}
                    flash={flash}
                    onAdd={onAdd}
                    onUpdate={onUpdate}
                    onRemove={onRemove}
                    onSelect={setSelectedId}
                    onEditing={setEditingId}
                    onAddEdit={onAddEdit}
                    onUpdateEdit={onUpdateEdit}
                    onRemoveEdit={onRemoveEdit}
                    onPan={onPan}
                    onVisible={onVisible}
                  />
                );
              })}
            </>
          )}
          {mode !== 'pages' && (
            <div className="float-nav" role="toolbar" aria-label="페이지 및 배율">
              <button className="tb" aria-label="이전 페이지" disabled={curPage <= 0} onClick={() => goPage(curPage - 1)}><Icon name="chevLeft" /></button>
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '0 4px' }}>
                <PageInput value={curPage + 1} max={state.pages.length} onGo={(n) => goPage(n - 1)} />
                <span className="muted">/ {state.pages.length}</span>
              </label>
              <button className="tb" aria-label="다음 페이지" disabled={curPage >= state.pages.length - 1} onClick={() => goPage(curPage + 1)}><Icon name="chevRight" /></button>
              <span className="sep-v" />
              <button className="tb" aria-label="축소" onClick={() => setScale((s) => Math.max(0.25, Math.round((s - 0.1) * 10) / 10))}><Icon name="minus" /></button>
              <button className="tb" style={{ fontWeight: 500, minWidth: 56 }} onClick={() => setScale(1)} aria-label="배율 100%로">{Math.round(scale * 100)}%</button>
              <button className="tb" aria-label="확대" onClick={() => setScale((s) => Math.min(4, Math.round((s + 0.1) * 10) / 10))}><Icon name="plus" /></button>
              <span className="sep-v" />
              <button className="tb" style={{ fontSize: 12 }} onClick={fitWidth}>폭 맞춤</button>
              <button className="tb" aria-label="현재 페이지 오른쪽으로 회전" onClick={() => { const p = state.pages[curPage]; if (p) commit((s) => ({ ...s, pages: s.pages.map((x) => (x.id === p.id ? { ...x, rotate: (x.rotate + 90) % 360 } : x)) })); }}><Icon name="rotate" /></button>
            </div>
          )}
        </main>

        {mode !== 'pages' && (
          <aside className="pdf-side-right" aria-label={mode === 'form' ? '양식' : mode === 'sign' ? '서명' : mode === 'convert' ? '변환' : mode === 'edit' ? '고친 글자' : '주석 목록'}>
            {(mode === 'annotate' || mode === 'view') && (
              <CommentsPanel annots={state.annots} pages={state.pages} selected={sel} onSelect={(a) => { setSelectedId(a.id); const i = state.pages.findIndex((p) => p.id === a.page); if (i >= 0 && i !== curPage) goPage(i); }} onUpdate={(aid, patch) => onUpdate(aid, patch, true)} onRemove={onRemove} />
            )}
            {mode === 'edit' && <EditsPanel edits={state.edits} pages={state.pages} onRemove={onRemoveEdit} onGo={(e) => goPage(state.pages.findIndex((p) => p.id === e.page))} />}
            {mode === 'sign' && (
              <SignPanel
                signatures={signatures}
                selected={signature}
                onSelect={(s) => { setSignature(s); setTool('signature'); }}
                onRemove={(s) => { const l = signatures.filter((x) => x !== s); setSignatures(l); saveSignatures(l); if (signature === s) setSignature(l[0] ?? null); }}
                onNew={() => setSigDialog(true)}
                placed={state.annots.filter((a) => a.type === 'image').length}
              />
            )}
            {mode === 'form' && <FormPanel source={sources[0]} enabled={inPlace} values={state.form} onChange={(k, v) => commit((s) => ({ ...s, form: { ...s.form, [k]: v } }))} />}
            {mode === 'convert' && <ConvertPanel build={build} name={name} setBusy={setBusy} />}
          </aside>
        )}
      </div>

      {sigDialog && <SignatureDialog onClose={() => setSigDialog(false)} onCreate={(url) => { const l = [url, ...signatures]; setSignatures(l); saveSignatures(l); setSignature(url); setTool('signature'); }} />}
      {busy && (
        <div className="modal-back" role="status">
          <div className="modal" style={{ width: 320, padding: 24, alignItems: 'center', gap: 14 }}>
            <div className="spinner" />
            <span>{busy}</span>
          </div>
        </div>
      )}
    </div>
  );
}

function todayText() {
  const d = new Date();
  return `${d.getFullYear()}. ${d.getMonth() + 1}. ${d.getDate()}.`;
}

function PageInput({ value, max, onGo }: { value: number; max: number; onGo: (n: number) => void }) {
  const [t, setT] = useState<string | null>(null);
  return (
    <input
      aria-label="페이지 번호"
      value={t ?? String(value)}
      onChange={(e) => setT(e.target.value)}
      onBlur={() => setT(null)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          const n = parseInt((e.target as HTMLInputElement).value, 10);
          if (n >= 1 && n <= max) onGo(n);
          setT(null);
          (e.target as HTMLInputElement).blur();
        }
      }}
      style={{ width: 40, height: 28, boxSizing: 'border-box', border: '1px solid var(--line-strong)', borderRadius: 6, textAlign: 'center' }}
    />
  );
}

function StampButton({ tool, setTool, label, setLabel }: { tool: Tool; setTool: (t: Tool) => void; label: string; setLabel: (s: string) => void }) {
  const pop = usePopover();
  return (
    <>
      <button className={`tb ${tool === 'stamp' ? 'on' : ''}`} aria-pressed={tool === 'stamp'} onClick={() => setTool('stamp')} title="도장 — 찍을 곳을 누르세요"><Icon name="stamp" />도장</button>
      <button className="tb" aria-label={`도장 종류: ${label}`} style={{ minWidth: 0, padding: '0 6px', fontSize: 12 }} onClick={pop.open} aria-haspopup="menu">{label}<Icon name="chevDown" size={12} /></button>
      {pop.isOpen && (
        <Popover anchor={pop.anchor} onClose={pop.close} width={170}>
          <div role="menu">
            {STAMPS.map((s) => (
              <button key={s} role="menuitemradio" aria-checked={s === label} className="menu-item" onClick={() => { setLabel(s); setTool('stamp'); pop.close(); }}>
                <span style={{ border: '1.5px solid var(--pdf)', color: 'var(--pdf)', borderRadius: 4, padding: '0 6px', fontWeight: 700, fontSize: 12 }}>{s}</span>
              </button>
            ))}
          </div>
        </Popover>
      )}
    </>
  );
}

function OpacityButton({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  const pop = usePopover();
  return (
    <>
      <button className="tb" style={{ fontSize: 12, border: '1px solid var(--line-strong)', height: 30 }} onClick={pop.open} aria-haspopup="dialog">불투명도 {Math.round(value * 100)}%</button>
      {pop.isOpen && (
        <Popover anchor={pop.anchor} onClose={pop.close} width={200}>
          <label className="fl" style={{ padding: 6 }}>불투명도 {Math.round(value * 100)}%<input type="range" min={10} max={100} step={5} value={Math.round(value * 100)} onChange={(e) => onChange(Number(e.target.value) / 100)} style={{ accentColor: 'var(--accent)' }} /></label>
        </Popover>
      )}
    </>
  );
}

function WidthButton({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  return (
    <div role="radiogroup" aria-label="선 굵기" style={{ display: 'flex', gap: 2, flex: 'none' }}>
      {[1, 2, 4, 6].map((w) => (
        <button key={w} role="radio" aria-checked={value === w} aria-label={`굵기 ${w}`} className={`tb ${value === w ? 'on' : ''}`} onClick={() => onChange(w)}>
          <span style={{ width: 16, height: w + 0.5, background: 'currentColor', borderRadius: 2 }} />
        </button>
      ))}
    </div>
  );
}

function FontSizeButton({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  return (
    <select className="dd" aria-label="글자 크기" value={value} onChange={(e) => onChange(Number(e.target.value))} style={{ width: 82, flex: 'none' }}>
      {[8, 9, 10, 11, 12, 14, 16, 18, 20, 24, 28, 36].map((s) => <option key={s} value={s}>{s} pt</option>)}
    </select>
  );
}

function SearchButton({ search, onHit }: { search: (q: string) => Promise<{ page: number; id: string; snippet: string; rect: number[] }[]>; onHit: (h: { page: number; id: string; rect: number[] }) => void }) {
  const pop = usePopover();
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<{ page: number; id: string; snippet: string; rect: number[] }[] | null>(null);
  const [loading, setLoading] = useState(false);
  const run = async () => {
    setLoading(true);
    setHits(await search(q));
    setLoading(false);
  };
  return (
    <>
      <button className="tb" aria-label="문서에서 찾기" title="찾기" onClick={pop.open} aria-haspopup="dialog"><Icon name="search" /></button>
      {pop.isOpen && (
        <Popover anchor={pop.anchor} onClose={pop.close} align="end" width={320}>
          <div style={{ display: 'flex', gap: 6, padding: 4 }}>
            <input className="in" autoFocus placeholder="찾을 낱말" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && run()} aria-label="찾을 낱말" />
            <button className="btn btn-primary btn-sm" onClick={run}>찾기</button>
          </div>
          <div style={{ maxHeight: 320, overflow: 'auto', display: 'flex', flexDirection: 'column', gap: 1 }}>
            {loading && <div style={{ padding: 10 }}><div className="spinner" style={{ width: 18, height: 18 }} /></div>}
            {hits && !loading && !hits.length && <div className="muted" style={{ padding: 10, fontSize: 13 }}>찾는 내용이 없습니다. (스캔한 PDF는 글자 정보가 없을 수 있어요)</div>}
            {hits?.map((h, i) => (
              <button key={i} className="menu-item" style={{ whiteSpace: 'normal', alignItems: 'flex-start', padding: '6px 10px' }} onClick={() => onHit(h)}>
                <span className="pill accent" style={{ flex: 'none' }}>{h.page + 1}쪽</span>
                <span style={{ fontSize: 12, lineHeight: 1.4 }}>{h.snippet}</span>
              </button>
            ))}
          </div>
        </Popover>
      )}
    </>
  );
}

function CommentsPanel({ annots, pages, selected, onSelect, onUpdate, onRemove }: { annots: Annot[]; pages: PageRef[]; selected: Annot | null; onSelect: (a: Annot) => void; onUpdate: (id: string, patch: Partial<Annot>) => void; onRemove: (id: string) => void }) {
  const [reply, setReply] = useState('');
  const [filter, setFilter] = useState<'all' | 'page'>('all');
  const order = new Map(pages.map((p, i) => [p.id, i]));
  const list = [...annots].filter((a) => order.has(a.page)).sort((a, b) => order.get(a.page)! - order.get(b.page)! || a.createdAt - b.createdAt);
  const shown = filter === 'page' && selected ? list.filter((a) => a.page === selected.page) : list;
  const time = (t: number) => { const d = new Date(t); const h = d.getHours(); return `${h < 12 ? '오전' : '오후'} ${h % 12 || 12}:${String(d.getMinutes()).padStart(2, '0')}`; };
  return (
    <>
      <div className="panel-head">
        <span className="t">주석</span>
        <span className="muted" style={{ fontSize: 12 }}>{list.length}개</span>
        <select className="dd" style={{ marginLeft: 'auto', height: 30, fontSize: 12 }} value={filter} onChange={(e) => setFilter(e.target.value as 'all' | 'page')} aria-label="주석 거르기">
          <option value="all">모든 쪽</option>
          <option value="page">선택한 쪽만</option>
        </select>
      </div>
      <div className="panel-body">
        {!list.length && <p className="muted" style={{ fontSize: 13, lineHeight: 1.6, margin: 0 }}>아직 주석이 없습니다. 형광펜으로 글자를 드래그하거나, 메모·글상자·펜·도장 도구로 표시해 보세요. 넣은 주석은 ‘저장’할 때 PDF에 그대로 들어갑니다.</p>}
        {shown.map((a) => {
          const on = selected?.id === a.id;
          return (
            <div key={a.id} className={`cm ${on ? 'on' : ''}`} onClick={() => !on && onSelect(a)} role="button" tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && !on && onSelect(a)} aria-pressed={on}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span className="av">{a.author.slice(0, 1)}</span>
                <div style={{ display: 'flex', flexDirection: 'column' }}>
                  <span style={{ fontSize: 13, fontWeight: 500 }}>{a.author}</span>
                  <span style={{ fontSize: 11, color: 'var(--ink-2)' }}>{TYPE_LABEL[a.type]} · {order.get(a.page)! + 1}쪽 · {time(a.createdAt)}</span>
                </div>
                <span aria-hidden="true" style={{ marginLeft: 'auto', width: 14, height: 14, borderRadius: 4, background: a.color }} />
              </div>
              {a.quote && <p style={{ margin: 0, fontSize: 12, color: 'var(--ink-2)', borderLeft: `3px solid ${a.color}`, paddingLeft: 8, lineHeight: 1.5 }}>{a.quote.length > 80 ? a.quote.slice(0, 80) + '…' : a.quote}</p>}
              {a.type === 'text' && a.text && <p style={{ margin: 0, fontSize: 12, color: 'var(--ink-2)', lineHeight: 1.5 }}>“{a.text.slice(0, 80)}”</p>}
              {a.type === 'stamp' && <p style={{ margin: 0, fontSize: 12, color: a.color, fontWeight: 700 }}>{a.text}</p>}
              {on ? (
                <textarea className="in" rows={3} placeholder={a.type === 'note' ? '메모 내용을 입력하세요' : '이 주석에 의견 남기기'} value={a.comment ?? ''} onChange={(e) => onUpdate(a.id, { comment: e.target.value })} autoFocus={a.type === 'note' && !a.comment} aria-label="의견" />
              ) : a.comment ? <p style={{ margin: 0, fontSize: 13, lineHeight: 1.55, whiteSpace: 'pre-wrap' }}>{a.comment}</p> : null}
              {(a.replies ?? []).map((r, i) => (
                <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'flex-start', paddingTop: 6, borderTop: '1px solid var(--line-2)' }}>
                  <span className="av" style={{ width: 22, height: 22, fontSize: 10 }}>{r.author.slice(0, 1)}</span>
                  <span style={{ fontSize: 12, lineHeight: 1.5 }}>{r.text}</span>
                </div>
              ))}
              {on && (
                <>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 6, height: 34, padding: '0 10px', border: '1px solid var(--line-strong)', borderRadius: 8, fontSize: 13 }}>
                    <input placeholder="답글 입력…" aria-label="답글 입력" value={reply} onChange={(e) => setReply(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && reply.trim()) { onUpdate(a.id, { replies: [...(a.replies ?? []), { author: '나', text: reply.trim(), at: Date.now() }] }); setReply(''); } }} style={{ flex: 1, border: 0, outline: 'none', background: 'transparent', minWidth: 0 }} />
                    <button className="tb" aria-label="답글 보내기" style={{ minWidth: 26, height: 26, color: 'var(--accent)' }} onClick={() => { if (reply.trim()) { onUpdate(a.id, { replies: [...(a.replies ?? []), { author: '나', text: reply.trim(), at: Date.now() }] }); setReply(''); } }}><Icon name="send" size={16} /></button>
                  </label>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <button className="btn btn-danger btn-sm" onClick={(e) => { e.stopPropagation(); onRemove(a.id); }}><Icon name="trash" size={14} />지우기</button>
                  </div>
                </>
              )}
            </div>
          );
        })}
      </div>
    </>
  );
}

function EditsPanel({ edits, pages, onRemove, onGo }: { edits: TextEdit[]; pages: PageRef[]; onRemove: (id: string) => void; onGo: (e: TextEdit) => void }) {
  const order = new Map(pages.map((p, i) => [p.id, i]));
  return (
    <>
      <div className="panel-head"><span className="t">고친 글자</span><span className="muted" style={{ fontSize: 12 }}>{edits.length}건</span></div>
      <div className="panel-body">
        {!edits.length && <p className="muted" style={{ fontSize: 13, lineHeight: 1.6, margin: 0 }}>‘글자 고치기’ 도구로 페이지의 글자를 누르면 그 자리에서 바로 고칠 수 있습니다. 한 줄 단위로 바뀌며, 원래 글꼴 대신 본고딕으로 다시 씁니다.</p>}
        {edits.map((e) => (
          <div key={e.id} className="cm" onClick={() => onGo(e)} role="button" tabIndex={0}>
            <span style={{ fontSize: 11, color: 'var(--ink-2)' }}>{(order.get(e.page) ?? 0) + 1}쪽</span>
            <p style={{ margin: 0, fontSize: 13, lineHeight: 1.55 }}><span style={{ textDecoration: 'line-through', color: '#6E7581' }}>{e.original}</span><br /><b style={{ color: 'var(--accent-strong)' }}>{e.text || '(지움)'}</b></p>
            <div><button className="btn btn-outline btn-sm" onClick={(ev) => { ev.stopPropagation(); onRemove(e.id); }}><Icon name="restore" size={14} />원래대로</button></div>
          </div>
        ))}
      </div>
    </>
  );
}

function SignPanel({ signatures, selected, onSelect, onRemove, onNew, placed }: { signatures: string[]; selected: string | null; onSelect: (s: string) => void; onRemove: (s: string) => void; onNew: () => void; placed: number }) {
  return (
    <>
      <div className="panel-head"><span className="t">내 서명</span><span className="muted" style={{ fontSize: 12 }}>문서에 {placed}개 넣음</span></div>
      <div className="panel-body">
        {signatures.map((s, i) => (
          <div key={i} style={{ position: 'relative' }}>
            <button className={`sig-item ${s === selected ? 'on' : ''}`} style={{ width: '100%' }} aria-pressed={s === selected} onClick={() => onSelect(s)}>
              <img src={s} alt={`서명 ${i + 1}`} />
            </button>
            <button className="tb" aria-label="서명 지우기" style={{ position: 'absolute', right: 6, top: 6 }} onClick={() => onRemove(s)}><Icon name="x" size={14} /></button>
          </div>
        ))}
        <button className="btn btn-outline" onClick={onNew}><Icon name="plus" />새 서명 만들기</button>
        <p className="muted" style={{ fontSize: 12, lineHeight: 1.6, margin: 0 }}>서명은 이 브라우저에만 저장됩니다. 넣은 서명은 그림으로 PDF에 들어가며, 공인 전자서명(인증서)은 아닙니다.</p>
      </div>
    </>
  );
}

interface FieldInfo { name: string; kind: 'text' | 'check' | 'choice'; value: string | boolean; options?: string[]; multiline?: boolean }

function FormPanel({ source, enabled, values, onChange }: { source: PdfSource | undefined; enabled: boolean; values: Record<string, string | boolean>; onChange: (k: string, v: string | boolean) => void }) {
  const [fields, setFields] = useState<FieldInfo[] | null>(null);
  useEffect(() => {
    if (!source) return;
    (async () => {
      const { PDFDocument, PDFTextField, PDFCheckBox, PDFDropdown, PDFRadioGroup, PDFOptionList } = await import('pdf-lib');
      try {
        const doc = await PDFDocument.load(source.bytes.slice(0), { ignoreEncryption: true });
        const out: FieldInfo[] = [];
        for (const f of doc.getForm().getFields()) {
          const name = f.getName();
          if (f instanceof PDFTextField) out.push({ name, kind: 'text', value: f.getText() ?? '', multiline: f.isMultiline() });
          else if (f instanceof PDFCheckBox) out.push({ name, kind: 'check', value: f.isChecked() });
          else if (f instanceof PDFDropdown) out.push({ name, kind: 'choice', value: f.getSelected()[0] ?? '', options: f.getOptions() });
          else if (f instanceof PDFOptionList) out.push({ name, kind: 'choice', value: f.getSelected()[0] ?? '', options: f.getOptions() });
          else if (f instanceof PDFRadioGroup) out.push({ name, kind: 'choice', value: f.getSelected() ?? '', options: f.getOptions() });
        }
        setFields(out);
      } catch {
        setFields([]);
      }
    })();
  }, [source]);
  return (
    <>
      <div className="panel-head"><span className="t">양식 채우기</span>{fields && <span className="muted" style={{ fontSize: 12 }}>{fields.length}칸</span>}</div>
      <div className="panel-body">
        {!fields && <div className="spinner" />}
        {fields && !fields.length && <p className="muted" style={{ fontSize: 13, lineHeight: 1.6, margin: 0 }}>이 PDF에는 채울 수 있는 양식 칸이 없습니다. 빈칸에 글을 쓰려면 ‘주석’의 텍스트 상자나 ‘서명’ 모드를 쓰세요.</p>}
        {fields?.map((f) => {
          const v = values[f.name] ?? f.value;
          if (f.kind === 'check') return <label key={f.name} style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13 }}><input type="checkbox" disabled={!enabled} checked={!!v} onChange={(e) => onChange(f.name, e.target.checked)} />{f.name}</label>;
          if (f.kind === 'choice') return <label key={f.name} className="fl">{f.name}<select className="in" disabled={!enabled} value={String(v)} onChange={(e) => onChange(f.name, e.target.value)}><option value="">(선택 안 함)</option>{f.options!.map((o) => <option key={o} value={o}>{o}</option>)}</select></label>;
          return <label key={f.name} className="fl">{f.name}{f.multiline ? <textarea className="in" rows={3} disabled={!enabled} value={String(v)} onChange={(e) => onChange(f.name, e.target.value)} /> : <input className="in" disabled={!enabled} value={String(v)} onChange={(e) => onChange(f.name, e.target.value)} />}</label>;
        })}
      </div>
    </>
  );
}

function ConvertPanel({ build, name, setBusy }: { build: () => Promise<Uint8Array>; name: string; setBusy: (s: string | null) => void }) {
  const run = async (label: string, fn: (bytes: ArrayBuffer) => Promise<void>) => {
    setBusy(label);
    try {
      const b = await build();
      await fn(b.slice().buffer as ArrayBuffer);
    } catch (e) {
      toast((e as Error).message || '변환하지 못했습니다.', 'error');
    } finally {
      setBusy(null);
    }
  };
  const opts = [
    { icon: 'docPlus', t: '한글 문서로 편집', d: '글자를 문단으로 묶어 HWP 편집기에서 엽니다', go: () => run('글자를 읽는 중…', async (b) => { const { pdfToHwpDoc } = await import('../lib/convert'); const doc = await pdfToHwpDoc(b); navigate(`/hwp/${await createHwpDoc(baseName(name), { doc })}`); }) },
    { icon: 'image', t: '이미지(PNG)로', d: '쪽마다 PNG 한 장 · ZIP', go: () => run('쪽을 그리는 중…', async (b) => { const { pdfToImages } = await import('../lib/convert'); downloadBlob(await pdfToImages(b, 2, (i, n) => setBusy(`쪽을 그리는 중… ${i}/${n}`)), `${name}_이미지.zip`); toast('이미지 ZIP을 내려받았습니다.', 'ok'); }) },
    { icon: 'text', t: '텍스트(.txt)로', d: '쪽별로 글자만 꺼내기', go: () => run('글자를 꺼내는 중…', async (b) => { const { pdfToText } = await import('../lib/convert'); downloadBlob(await pdfToText(b), `${name}.txt`, 'text/plain;charset=utf-8'); toast('텍스트 파일을 내려받았습니다.', 'ok'); }) },
    { icon: 'download', t: 'PDF로 저장', d: '주석·서명·고친 글자를 반영한 PDF', go: () => run('PDF를 만드는 중…', async (b) => { downloadBlob(b, `${name}.pdf`, 'application/pdf'); }) },
  ];
  return (
    <>
      <div className="panel-head"><span className="t">변환</span></div>
      <div className="panel-body">
        {opts.map((o) => (
          <button key={o.t} className="opt-card" onClick={o.go}>
            <span style={{ width: 36, height: 36, borderRadius: 10, background: 'var(--ground)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--ink-3)', flex: 'none' }}><Icon name={o.icon} /></span>
            <span style={{ display: 'flex', flexDirection: 'column', gap: 2 }}><span className="t">{o.t}</span><span className="d">{o.d}</span></span>
          </button>
        ))}
      </div>
    </>
  );
}
