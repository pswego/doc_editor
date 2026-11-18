import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { PDFPageProxy } from 'pdfjs-dist';
import type { TextItem } from 'pdfjs-dist/types/src/display/api';
import { pdfjs } from './pdfjs';
import { Icon } from '../components/Icon';
import { makeVp, rectToView, viewToRect, type Vp } from './geometry';
import type { Annot, PageRef, TextEdit, Tool } from './types';
import { TEXT_LINE_HEIGHT } from './save';

export interface PageInfo {
  view: number[];
  baseRotate: number;
  pdf?: PDFPageProxy;
}

export type NewAnnot = Omit<Annot, 'id' | 'author' | 'createdAt' | 'page'>;

export interface PageViewProps {
  pageRef: PageRef;
  num: number;
  info: PageInfo;
  scale: number;
  annots: Annot[];
  edits: TextEdit[];
  tool: Tool;
  color: string;
  opacity: number;
  strokeWidth: number;
  fontSize: number;
  stampLabel: string;
  signature: string | null;
  selectedId: string | null;
  editingId: string | null;
  flash: { page: string; rect: number[]; key: number } | null;
  onAdd: (page: string, a: NewAnnot, edit?: boolean) => string;
  onUpdate: (id: string, patch: Partial<Annot>, record: boolean) => void;
  onRemove: (id: string) => void;
  onSelect: (id: string | null) => void;
  onEditing: (id: string | null) => void;
  onAddEdit: (page: string, e: Omit<TextEdit, 'id' | 'page' | 'createdAt'>) => void;
  onUpdateEdit: (id: string, patch: Partial<TextEdit>) => void;
  onRemoveEdit: (id: string) => void;
  onPan: (dx: number, dy: number) => void;
  onVisible: (id: string) => void;
}

interface Item { str: string; rect: number[]; size: number; x: number; y: number; bold: boolean }

const MARKUP = new Set<Tool>(['highlight', 'underline', 'strike']);

function PageViewImpl(p: PageViewProps) {
  const { pageRef, info, scale } = p;
  const rotation = (((info.baseRotate + pageRef.rotate) % 360) + 360) % 360;
  const vp = useMemo(() => makeVp(info.view, scale, rotation), [info.view, scale, rotation]);
  const rootRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const textRef = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  const [items, setItems] = useState<Item[]>([]);
  const [draft, setDraft] = useState<null | { kind: Tool; x0: number; y0: number; x1: number; y1: number; pts?: number[][] }>(null);
  const [editBox, setEditBox] = useState<null | { item: Item; text: string; editId?: string }>(null);
  const drag = useRef<null | { id: string; sx: number; sy: number; orig: Annot; mode: 'move' | 'resize' }>(null);

  // 화면에 들어오면 그리기
  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const io = new IntersectionObserver((es) => {
      const v = es.some((e) => e.isIntersecting);
      setVisible(v);
      if (v) p.onVisible(pageRef.id);
    }, { rootMargin: '600px 0px' });
    io.observe(el);
    return () => io.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pageRef.id]);

  useEffect(() => {
    const page = info.pdf;
    const canvas = canvasRef.current;
    if (!visible || !page || !canvas) return;
    let cancelled = false;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const viewport = page.getViewport({ scale: scale * dpr, rotation });
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    const task = page.render({ canvasContext: canvas.getContext('2d')!, viewport, annotationMode: pdfjs.AnnotationMode.ENABLE });
    task.promise.catch(() => {});
    // 글자 층
    const tl = textRef.current;
    let textLayer: { cancel: () => void } | null = null;
    if (tl) {
      tl.replaceChildren();
      tl.style.setProperty('--scale-factor', String(scale));
      tl.style.setProperty('--total-scale-factor', String(scale));
      page.getTextContent().then((tc) => {
        if (cancelled) return;
        const layer = new pdfjs.TextLayer({ textContentSource: tc, container: tl, viewport: page.getViewport({ scale, rotation }) });
        textLayer = layer;
        layer.render().catch(() => {});
        const styles = tc.styles as Record<string, { fontFamily?: string }>;
        const list: Item[] = [];
        for (const it of tc.items as TextItem[]) {
          if (!('str' in it) || !it.str.trim()) continue;
          const [a, b, c, d, e, f] = it.transform;
          if (Math.abs(b) > 0.01 || Math.abs(c) > 0.01 || a < 0) continue; // 회전된 글자는 제외
          const size = Math.hypot(c, d) || it.height;
          const w = it.width;
          list.push({ str: it.str, size, x: e, y: f, rect: [e, f - size * 0.24, e + w, f + size * 0.9], bold: /bold|black|heavy/i.test(`${it.fontName} ${styles[it.fontName]?.fontFamily ?? ''}`) });
        }
        setItems(list);
      }).catch(() => {});
    }
    return () => {
      cancelled = true;
      task.cancel();
      textLayer?.cancel();
    };
  }, [visible, info.pdf, scale, rotation]);

  // 형광펜 등: 글자 선택으로 만들기
  const finishSelection = () => {
    const sel = window.getSelection();
    const root = rootRef.current;
    if (!sel || sel.isCollapsed || !root) return false;
    const range = sel.getRangeAt(0);
    if (!root.contains(range.commonAncestorContainer)) return false;
    const box = root.getBoundingClientRect();
    const rects = Array.from(range.getClientRects()).filter((r) => r.width > 1 && r.height > 1 && r.right > box.left && r.left < box.right && r.bottom > box.top && r.top < box.bottom);
    if (!rects.length) return false;
    // 같은 줄끼리 합치기
    const lines: { x: number; y: number; r: number; b: number }[] = [];
    for (const r of rects.sort((a, b) => a.top - b.top || a.left - b.left)) {
      const x = r.left - box.left, y = r.top - box.top, rr = r.right - box.left, bb = r.bottom - box.top;
      const last = lines[lines.length - 1];
      if (last && Math.abs(last.y - y) < (bb - y) * 0.5) {
        last.x = Math.min(last.x, x); last.r = Math.max(last.r, rr); last.y = Math.min(last.y, y); last.b = Math.max(last.b, bb);
      } else lines.push({ x, y, r: rr, b: bb });
    }
    const quote = sel.toString().replace(/\s+/g, ' ').trim();
    const pdfRects = lines.map((l) => viewToRect(vp, l.x, l.y, l.r - l.x, l.b - l.y));
    const id = p.onAdd(pageRef.id, { type: p.tool as Annot['type'], color: p.color, opacity: p.tool === 'highlight' ? p.opacity : 1, rects: pdfRects, quote });
    p.onSelect(id);
    sel.removeAllRanges();
    return true;
  };

  const local = (e: React.PointerEvent | PointerEvent) => {
    const b = rootRef.current!.getBoundingClientRect();
    return [(e.clientX - b.left) * (vp.width / b.width), (e.clientY - b.top) * (vp.height / b.height)] as const;
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    const t = p.tool;
    const target = e.target as HTMLElement;
    if (t === 'hand') {
      let lx = e.clientX, ly = e.clientY;
      const move = (ev: PointerEvent) => { p.onPan(lx - ev.clientX, ly - ev.clientY); lx = ev.clientX; ly = ev.clientY; };
      const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
      return;
    }
    if (MARKUP.has(t)) {
      if (target.closest('.textLayer span')) return; // 글자 선택은 브라우저에 맡김
      e.preventDefault();
    }
    if (t === 'select' || t === 'edit') {
      if (!target.closest('.annot-hit, .text-annot, .note-pin, .stamp-annot, .edit-item, .edit-box, .edit-applied, .handle')) p.onSelect(null);
      return;
    }
    e.preventDefault(); // 포커스가 새 글상자에서 빠져나가지 않도록
    if (p.editingId) {
      // 글상자 편집 중에 다른 곳을 누르면 편집만 끝낸다
      (document.activeElement as HTMLElement | null)?.blur();
      return;
    }
    const [x, y] = local(e);
    if (t === 'note') {
      const [px, py] = vp.toPdf(x, y);
      const id = p.onAdd(pageRef.id, { type: 'note', color: p.color === '#DC2626' ? '#FFD84D' : p.color, opacity: 1, rect: [px, py, px, py], comment: '' });
      p.onSelect(id);
      return;
    }
    if (t === 'text') {
      const w = 220 * scale, h = p.fontSize * TEXT_LINE_HEIGHT * scale + 4;
      const id = p.onAdd(pageRef.id, { type: 'text', color: p.color, opacity: 1, rect: viewToRect(vp, x, y - h / 2, w, h), text: '', fontSize: p.fontSize }, true);
      p.onSelect(id);
      return;
    }
    if (t === 'stamp' || t === 'signature') {
      if (t === 'signature' && !p.signature) return;
      if (t === 'stamp') {
        const w = Math.max(90, p.stampLabel.length * 22 + 30) * scale, h = 38 * scale;
        const id = p.onAdd(pageRef.id, { type: 'stamp', color: p.color, opacity: 0.9, rect: viewToRect(vp, x - w / 2, y - h / 2, w, h), text: p.stampLabel });
        p.onSelect(id);
      } else {
        const img = new Image();
        img.onload = () => {
          const w = 150 * scale, h = (w * img.naturalHeight) / (img.naturalWidth || 1);
          const id = p.onAdd(pageRef.id, { type: 'image', color: '#000000', opacity: 1, rect: viewToRect(vp, x - w / 2, y - h / 2, w, h), image: p.signature!, label: '서명' });
          p.onSelect(id);
        };
        img.src = p.signature!;
      }
      return;
    }
    // 끌어서 그리기: 펜 · 사각형 · 타원 · 화살표 · (빈 곳의) 형광펜
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    setDraft({ kind: t, x0: x, y0: y, x1: x, y1: y, pts: t === 'ink' ? [[x, y]] : undefined });
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (drag.current) return onDragMove(e);
    if (!draft) return;
    const [x, y] = local(e);
    setDraft((d) => (d ? { ...d, x1: x, y1: y, pts: d.pts ? [...d.pts, [x, y]] : undefined } : d));
  };

  const onPointerUp = (e: React.PointerEvent) => {
    if (drag.current) return onDragEnd();
    if (MARKUP.has(p.tool) && !draft) {
      setTimeout(finishSelection, 0);
      return;
    }
    if (!draft) return;
    const d = draft;
    setDraft(null);
    const x = Math.min(d.x0, d.x1), y = Math.min(d.y0, d.y1), w = Math.abs(d.x1 - d.x0), h = Math.abs(d.y1 - d.y0);
    let id = '';
    if (d.kind === 'ink' && d.pts && d.pts.length) {
      id = p.onAdd(pageRef.id, { type: 'ink', color: p.color, opacity: 1, width: p.strokeWidth, points: [d.pts.map(([a, b]) => vp.toPdf(a, b))] });
    } else if ((d.kind === 'rect' || d.kind === 'ellipse') && w > 4 && h > 4) {
      id = p.onAdd(pageRef.id, { type: d.kind, color: p.color, opacity: 1, width: p.strokeWidth, rect: viewToRect(vp, x, y, w, h) });
    } else if (d.kind === 'arrow' && Math.hypot(w, h) > 6) {
      const a = vp.toPdf(d.x0, d.y0), b = vp.toPdf(d.x1, d.y1);
      id = p.onAdd(pageRef.id, { type: 'arrow', color: p.color, opacity: 1, width: p.strokeWidth, rect: [a[0], a[1], b[0], b[1]] });
    } else if (MARKUP.has(d.kind) && w > 4 && h > 4) {
      id = p.onAdd(pageRef.id, { type: d.kind as Annot['type'], color: p.color, opacity: d.kind === 'highlight' ? p.opacity : 1, rects: [viewToRect(vp, x, y, w, h)] });
    }
    if (id) p.onSelect(id);
    void e;
  };

  // 선택 도구: 옮기기 · 크기 바꾸기
  const startDrag = (e: React.PointerEvent, a: Annot, mode: 'move' | 'resize') => {
    if (p.tool !== 'select' && !(p.tool === 'edit' && a.type === 'text')) return;
    e.stopPropagation();
    e.preventDefault();
    p.onSelect(a.id);
    const [x, y] = local(e);
    drag.current = { id: a.id, sx: x, sy: y, orig: JSON.parse(JSON.stringify(a)), mode };
    rootRef.current?.setPointerCapture?.(e.pointerId);
  };
  const moved = useRef(false);
  const onDragMove = (e: React.PointerEvent) => {
    const dg = drag.current!;
    const [x, y] = local(e);
    const dx = x - dg.sx, dy = y - dg.sy;
    if (Math.abs(dx) + Math.abs(dy) < 2 && !moved.current) return;
    moved.current = true;
    const [ox, oy] = vp.toPdf(0, 0);
    const [qx, qy] = vp.toPdf(dx, dy);
    const ddx = qx - ox, ddy = qy - oy;
    const o = dg.orig;
    if (dg.mode === 'move') {
      const patch: Partial<Annot> = {};
      if (o.rect) patch.rect = [o.rect[0] + ddx, o.rect[1] + ddy, o.rect[2] + ddx, o.rect[3] + ddy];
      if (o.rects) patch.rects = o.rects.map((r) => [r[0] + ddx, r[1] + ddy, r[2] + ddx, r[3] + ddy]);
      if (o.points) patch.points = o.points.map((s) => s.map(([a, b]) => [a + ddx, b + ddy]));
      p.onUpdate(dg.id, patch, false);
    } else if (o.rect) {
      const v = rectToView(vp, o.rect);
      const ratio = o.type === 'image' ? v.h / (v.w || 1) : 0;
      const nw = Math.max(12, v.w + dx);
      const nh = ratio ? nw * ratio : Math.max(10, v.h + dy);
      p.onUpdate(dg.id, { rect: viewToRect(vp, v.x, v.y, nw, nh) }, false);
    }
  };
  const onDragEnd = () => {
    const dg = drag.current;
    drag.current = null;
    if (dg && moved.current) p.onUpdate(dg.id, {}, true);
    moved.current = false;
  };

  // 텍스트 교체 시작
  const startEdit = (item: Item, existing?: TextEdit) => {
    setEditBox({ item, text: existing ? existing.text : item.str, editId: existing?.id });
  };
  const commitEdit = () => {
    const eb = editBox;
    setEditBox(null);
    if (!eb) return;
    if (eb.editId) {
      const ex = p.edits.find((x) => x.id === eb.editId);
      if (ex && eb.text === ex.original) p.onRemoveEdit(eb.editId);
      else p.onUpdateEdit(eb.editId, { text: eb.text });
      return;
    }
    if (eb.text === eb.item.str) return;
    p.onAddEdit(pageRef.id, { rect: eb.item.rect, original: eb.item.str, text: eb.text, fontSize: Math.round(eb.item.size * 10) / 10, color: '#000000', bold: eb.item.bold, x: eb.item.x, y: eb.item.y, angle: 0 });
  };

  const sel = p.selectedId;
  const toolClass = p.tool === 'select' || p.tool === 'edit' || MARKUP.has(p.tool) ? '' : 'no-text';
  const drawActive = !['select', 'edit', 'highlight', 'underline', 'strike'].includes(p.tool);
  const shapesInteractive = p.tool === 'select';
  const editedItems = new Set(p.edits.map((e) => e.rect.join(',')));

  const renderShape = (a: Annot) => {
    const isSel = a.id === sel;
    const hit = shapesInteractive ? { className: 'annot-hit', style: { pointerEvents: 'all' as const }, onPointerDown: (e: React.PointerEvent) => startDrag(e, a, 'move') } : { style: { pointerEvents: 'none' as const } };
    const sw = (a.width ?? 2) * scale;
    switch (a.type) {
      case 'highlight':
        return (
          <g key={a.id} {...hit}>
            {(a.rects ?? []).map((r, i) => { const v = rectToView(vp, r); return <rect key={i} x={v.x} y={v.y} width={v.w} height={v.h} fill={a.color} opacity={a.opacity} style={{ mixBlendMode: 'multiply' }} />; })}
            {isSel && (a.rects ?? []).map((r, i) => { const v = rectToView(vp, r); return <rect key={`s${i}`} x={v.x - 2} y={v.y - 2} width={v.w + 4} height={v.h + 4} fill="none" stroke="#2457D6" strokeWidth={1.5} />; })}
          </g>
        );
      case 'underline':
      case 'strike':
        return (
          <g key={a.id} {...hit}>
            {(a.rects ?? []).map((r, i) => {
              const v = rectToView(vp, r);
              const y = a.type === 'underline' ? v.y + v.h - Math.max(1, v.h * 0.06) : v.y + v.h * 0.55;
              return (
                <g key={i}>
                  <rect x={v.x} y={v.y} width={v.w} height={v.h} fill="transparent" />
                  <line x1={v.x} x2={v.x + v.w} y1={y} y2={y} stroke={a.color} strokeWidth={Math.max(1.2, v.h * 0.07)} />
                  {isSel && <rect x={v.x - 2} y={v.y - 2} width={v.w + 4} height={v.h + 4} fill="none" stroke="#2457D6" strokeWidth={1.5} />}
                </g>
              );
            })}
          </g>
        );
      case 'ink':
        return (
          <g key={a.id} {...hit}>
            {(a.points ?? []).map((s, i) => {
              const d = s.map(([x, y], k) => { const [vx, vy] = vp.toView(x, y); return `${k ? 'L' : 'M'}${vx.toFixed(1)} ${vy.toFixed(1)}`; }).join(' ');
              return (
                <g key={i}>
                  <path d={d} fill="none" stroke="transparent" strokeWidth={Math.max(sw, 12)} strokeLinecap="round" />
                  <path d={d} fill="none" stroke={isSel ? '#2457D6' : a.color} strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round" opacity={a.opacity} />
                </g>
              );
            })}
          </g>
        );
      case 'rect':
      case 'ellipse': {
        const v = rectToView(vp, a.rect!);
        return (
          <g key={a.id} {...hit}>
            {a.type === 'rect'
              ? <rect x={v.x} y={v.y} width={v.w} height={v.h} fill="transparent" stroke={a.color} strokeWidth={sw} opacity={a.opacity} />
              : <ellipse cx={v.x + v.w / 2} cy={v.y + v.h / 2} rx={v.w / 2} ry={v.h / 2} fill="transparent" stroke={a.color} strokeWidth={sw} opacity={a.opacity} />}
            {isSel && <rect x={v.x - 4} y={v.y - 4} width={v.w + 8} height={v.h + 8} fill="none" stroke="#2457D6" strokeDasharray="4 3" strokeWidth={1.2} />}
          </g>
        );
      }
      case 'arrow': {
        const [x1, y1] = vp.toView(a.rect![0], a.rect![1]);
        const [x2, y2] = vp.toView(a.rect![2], a.rect![3]);
        const ang = Math.atan2(y2 - y1, x2 - x1);
        const len = (8 + (a.width ?? 2) * 2.5) * scale;
        const h1 = [x2 - len * Math.cos(ang - 0.45), y2 - len * Math.sin(ang - 0.45)];
        const h2 = [x2 - len * Math.cos(ang + 0.45), y2 - len * Math.sin(ang + 0.45)];
        return (
          <g key={a.id} {...hit} stroke={isSel ? '#2457D6' : a.color} strokeWidth={sw} strokeLinecap="round" opacity={a.opacity}>
            <line x1={x1} y1={y1} x2={x2} y2={y2} stroke="transparent" strokeWidth={Math.max(sw, 12)} />
            <line x1={x1} y1={y1} x2={x2} y2={y2} />
            <polyline points={`${h1[0]},${h1[1]} ${x2},${y2} ${h2[0]},${h2[1]}`} fill="none" />
          </g>
        );
      }
      default:
        return null;
    }
  };

  const draftShape = () => {
    if (!draft) return null;
    const x = Math.min(draft.x0, draft.x1), y = Math.min(draft.y0, draft.y1), w = Math.abs(draft.x1 - draft.x0), h = Math.abs(draft.y1 - draft.y0);
    const sw = p.strokeWidth * scale;
    switch (draft.kind) {
      case 'ink':
        return <polyline points={(draft.pts ?? []).map((q) => q.join(',')).join(' ')} fill="none" stroke={p.color} strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round" />;
      case 'rect':
        return <rect x={x} y={y} width={w} height={h} fill="none" stroke={p.color} strokeWidth={sw} />;
      case 'ellipse':
        return <ellipse cx={x + w / 2} cy={y + h / 2} rx={w / 2} ry={h / 2} fill="none" stroke={p.color} strokeWidth={sw} />;
      case 'arrow':
        return <line x1={draft.x0} y1={draft.y0} x2={draft.x1} y2={draft.y1} stroke={p.color} strokeWidth={sw} strokeLinecap="round" />;
      default:
        return <rect x={x} y={y} width={w} height={h} fill={p.color} opacity={0.35} />;
    }
  };

  return (
    <div
      ref={rootRef}
      className={`pdf-page ${toolClass}`}
      style={{ width: vp.width, height: vp.height, cursor: p.tool === 'hand' ? 'grab' : drawActive ? 'crosshair' : undefined }}
      data-page-id={pageRef.id}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      aria-label={`${p.num}쪽`}
      role="group"
    >
      <span className="page-num" aria-hidden="true">{p.num}</span>
      {info.pdf && <canvas ref={canvasRef} className="render" aria-hidden="true" />}
      {info.pdf && <div ref={textRef} className="textLayer" style={{ width: vp.width, height: vp.height }} />}

      {/* 바뀐 글자 */}
      {p.edits.map((ed) => {
        const v = rectToView(vp, ed.rect);
        const it: Item = { str: ed.original, rect: ed.rect, size: ed.fontSize, x: ed.x ?? ed.rect[0], y: ed.y ?? ed.rect[1], bold: !!ed.bold };
        if (editBox?.editId === ed.id) return null;
        return (
          <div key={ed.id} className="edit-applied" title={`원문: ${ed.original}`} style={{ left: v.x - 1, top: v.y - 1, minWidth: v.w + 2, height: v.h + 2, fontSize: ed.fontSize * scale, color: ed.color, fontWeight: ed.bold ? 700 : 400, paddingBottom: ed.fontSize * scale * 0.2, pointerEvents: p.tool === 'edit' ? 'auto' : 'none' }} onPointerDown={(e) => { if (p.tool === 'edit') { e.stopPropagation(); e.preventDefault(); startEdit(it, ed); } }}>
            {ed.text}
          </div>
        );
      })}

      {/* 텍스트 편집 모드: 원문 글자 상자 */}
      {p.tool === 'edit' && items.map((it, i) => {
        if (editedItems.has(it.rect.join(','))) return null;
        const v = rectToView(vp, it.rect);
        return <div key={i} className="edit-item" title="눌러서 글자 고치기" style={{ left: v.x, top: v.y, width: v.w, height: v.h }} onPointerDown={(e) => { e.stopPropagation(); e.preventDefault(); startEdit(it); }} />;
      })}
      {editBox && (() => {
        const v = rectToView(vp, editBox.item.rect);
        return (
          <div className="edit-box" style={{ left: v.x - 2, top: v.y - 2, minWidth: Math.max(v.w + 24, 80), height: v.h + 4, fontSize: editBox.item.size * scale, fontWeight: editBox.item.bold ? 700 : 400 }} onPointerDown={(e) => e.stopPropagation()}>
            <input
              autoFocus
              aria-label="글자 고치기"
              value={editBox.text}
              size={Math.max(4, editBox.text.length + 2)}
              onChange={(e) => setEditBox({ ...editBox, text: e.target.value })}
              onBlur={commitEdit}
              onKeyDown={(e) => {
                if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                if (e.key === 'Escape') setEditBox(null);
              }}
            />
          </div>
        );
      })()}

      <svg className="overlay-svg" width={vp.width} height={vp.height} style={{ position: 'absolute', inset: 0, zIndex: 3, pointerEvents: 'none' }} aria-hidden="true">
        {p.annots.map(renderShape)}
        {draftShape()}
      </svg>

      {/* 글상자 · 도장 · 서명 · 메모 */}
      {p.annots.map((a) => {
        const isSel = a.id === sel;
        if (a.type === 'text') {
          const v = rectToView(vp, a.rect!);
          const editing = p.editingId === a.id;
          return (
            <div
              key={a.id}
              className={`text-annot ${editing ? 'editing' : ''} ${isSel && !editing ? 'annot-sel' : ''}`}
              style={{ left: v.x, top: v.y, width: v.w, minHeight: v.h, fontSize: (a.fontSize ?? 12) * scale, color: a.color, cursor: p.tool === 'select' ? 'move' : undefined, pointerEvents: p.tool === 'select' || editing ? 'auto' : 'none' }}
              onPointerDown={(e) => !editing && startDrag(e, a, 'move')}
              onDoubleClick={() => p.onEditing(a.id)}
            >
              {editing ? (
                <TextAreaAuto
                  value={a.text ?? ''}
                  onChange={(t) => p.onUpdate(a.id, { text: t }, false)}
                  onDone={(el) => {
                    p.onEditing(null);
                    if (!a.text?.trim()) return p.onRemove(a.id);
                    const h = el.parentElement!.getBoundingClientRect().height * (vp.width / rootRef.current!.getBoundingClientRect().width);
                    p.onUpdate(a.id, { rect: viewToRect(vp, v.x, v.y, v.w, Math.max(h, v.h)) }, true);
                  }}
                />
              ) : (a.text || ' ')}
              {isSel && !editing && p.tool === 'select' && <span className="handle" style={{ right: -6, bottom: -6, cursor: 'nwse-resize' }} onPointerDown={(e) => startDrag(e, a, 'resize')} />}
            </div>
          );
        }
        if (a.type === 'stamp' || a.type === 'image') {
          const v = rectToView(vp, a.rect!);
          return (
            <div
              key={a.id}
              className={`${a.type === 'stamp' ? 'stamp-annot' : ''} ${isSel ? 'annot-sel' : ''}`}
              style={{ position: 'absolute', left: v.x, top: v.y, width: v.w, height: v.h, zIndex: 4, color: a.color, borderColor: a.color, opacity: a.opacity, fontSize: v.h * 0.48, transform: vp.rotation ? `rotate(0deg)` : undefined, cursor: p.tool === 'select' ? 'move' : undefined, pointerEvents: p.tool === 'select' ? 'auto' : 'none' }}
              onPointerDown={(e) => startDrag(e, a, 'move')}
            >
              {a.type === 'stamp' ? a.text : <img src={a.image} alt={a.label ?? '서명'} style={{ width: '100%', height: '100%', objectFit: 'contain', pointerEvents: 'none' }} draggable={false} />}
              {isSel && p.tool === 'select' && <span className="handle" style={{ right: -6, bottom: -6, cursor: 'nwse-resize' }} onPointerDown={(e) => startDrag(e, a, 'resize')} />}
            </div>
          );
        }
        if (a.type === 'note') {
          const [x, y] = vp.toView(a.rect![0], a.rect![1]);
          return (
            <button
              key={a.id}
              className="note-pin"
              aria-label={`메모: ${a.comment || '(내용 없음)'}`}
              style={{ left: x, top: y, background: a.color, outline: isSel ? '2px solid #2457D6' : undefined, pointerEvents: 'auto' }}
              onPointerDown={(e) => { if (p.tool === 'select') startDrag(e, a, 'move'); else { e.stopPropagation(); p.onSelect(a.id); } }}
            >
              <Icon name="comment" size={15} />
            </button>
          );
        }
        return null;
      })}

      {p.flash && p.flash.page === pageRef.id && (() => {
        const v = rectToView(vp, p.flash.rect);
        return <span key={p.flash.key} className="search-flash" style={{ left: v.x - 2, top: v.y - 2, width: v.w + 4, height: v.h + 4 }} />;
      })()}
      {drawActive && <div className="draw-layer" aria-hidden="true" />}
    </div>
  );
}

function TextAreaAuto({ value, onChange, onDone }: { value: string; onChange: (v: string) => void; onDone: (el: HTMLTextAreaElement) => void }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, [value]);
  useLayoutEffect(() => {
    ref.current?.focus();
  }, []);
  return (
    <textarea
      ref={ref}
      aria-label="글상자 내용"
      value={value}
      placeholder="내용 입력"
      onChange={(e) => onChange(e.target.value)}
      onBlur={(e) => onDone(e.currentTarget)}
      onKeyDown={(e) => {
        if (e.key === 'Escape') (e.target as HTMLTextAreaElement).blur();
        e.stopPropagation();
      }}
      onPointerDown={(e) => e.stopPropagation()}
    />
  );
}

export const PageView = memo(PageViewImpl);

export type { Vp };
