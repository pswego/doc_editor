import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

/** 기준 요소 아래에 뜨는 팝오버. 바깥을 누르거나 Esc 로 닫힌다 */
export function Popover({ anchor, onClose, children, align = 'start', width }: { anchor: HTMLElement | null; onClose: () => void; children: ReactNode; align?: 'start' | 'end'; width?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  useLayoutEffect(() => {
    if (!anchor) return;
    const r = anchor.getBoundingClientRect();
    const el = ref.current;
    const w = el?.offsetWidth ?? width ?? 220;
    const h = el?.offsetHeight ?? 200;
    let left = align === 'end' ? r.right - w : r.left;
    left = Math.max(8, Math.min(left, window.innerWidth - w - 8));
    let top = r.bottom + 6;
    if (top + h > window.innerHeight - 8) top = Math.max(8, r.top - h - 6);
    setPos({ left, top });
  }, [anchor, align, width]);
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (ref.current?.contains(e.target as Node) || anchor?.contains(e.target as Node)) return;
      onClose();
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('mousedown', onDown, true);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onDown, true);
      window.removeEventListener('keydown', onKey);
    };
  }, [anchor, onClose]);
  return createPortal(
    <div ref={ref} className="menu" style={{ position: 'fixed', left: pos?.left ?? -9999, top: pos?.top ?? -9999, width }}>
      {children}
    </div>,
    document.body,
  );
}

/** 열림 상태 + 기준 요소를 함께 관리 */
export function usePopover() {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  return {
    anchor,
    open: (e: { currentTarget: HTMLElement }) => setAnchor((a) => (a === e.currentTarget ? null : e.currentTarget)),
    close: () => setAnchor(null),
    isOpen: !!anchor,
  };
}
