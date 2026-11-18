import { useState } from 'react';
import { Icon } from '../components/Icon';
import { Thumb } from './Thumb';
import type { PageInfo } from './PageView';
import type { PageRef } from './types';

export function PagesGrid({ pages, infos, selected, setSelected, onMove, onOpen, annotCount }: {
  pages: PageRef[];
  infos: Map<string, PageInfo>;
  selected: Set<string>;
  setSelected: (s: Set<string>) => void;
  onMove: (ids: string[], beforeIndex: number) => void;
  onOpen: (id: string) => void;
  annotCount: (id: string) => number;
}) {
  const [dragIds, setDragIds] = useState<string[] | null>(null);
  const [dropAt, setDropAt] = useState<number | null>(null);
  const [anchor, setAnchor] = useState<number | null>(null);

  const click = (e: React.MouseEvent, i: number, id: string) => {
    const next = new Set(selected);
    if (e.shiftKey && anchor != null) {
      const [a, b] = [Math.min(anchor, i), Math.max(anchor, i)];
      for (let k = a; k <= b; k++) next.add(pages[k].id);
    } else if (e.ctrlKey || e.metaKey) {
      if (next.has(id)) next.delete(id);
      else next.add(id);
      setAnchor(i);
    } else {
      next.clear();
      next.add(id);
      setAnchor(i);
    }
    setSelected(next);
  };

  return (
    <div className="pages-grid" role="listbox" aria-multiselectable="true" aria-label="페이지 (끌어서 순서 바꾸기)">
      {pages.map((pg, i) => {
        const info = infos.get(pg.id);
        const sel = selected.has(pg.id);
        const n = annotCount(pg.id);
        return (
          <button
            key={pg.id}
            role="option"
            aria-selected={sel}
            className={`pg-card ${sel ? 'sel' : ''} ${dropAt === i ? 'drop-before' : ''}`}
            draggable
            onClick={(e) => click(e, i, pg.id)}
            onDoubleClick={() => onOpen(pg.id)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') onOpen(pg.id);
            }}
            onDragStart={(e) => {
              const ids = sel ? pages.filter((p) => selected.has(p.id)).map((p) => p.id) : [pg.id];
              setDragIds(ids);
              e.dataTransfer.effectAllowed = 'move';
              e.dataTransfer.setData('text/plain', ids.join(','));
            }}
            onDragOver={(e) => {
              if (!dragIds) return;
              e.preventDefault();
              const r = e.currentTarget.getBoundingClientRect();
              setDropAt(e.clientX > r.left + r.width / 2 ? i + 1 : i);
            }}
            onDrop={(e) => {
              e.preventDefault();
              if (dragIds && dropAt != null) onMove(dragIds, dropAt);
              setDragIds(null);
              setDropAt(null);
            }}
            onDragEnd={() => { setDragIds(null); setDropAt(null); }}
            style={{ opacity: dragIds?.includes(pg.id) ? 0.45 : 1 }}
          >
            <span className="chk" aria-hidden="true">{sel && <Icon name="check" size={14} />}</span>
            <span className="pv">{info ? <Thumb info={info} rotate={pg.rotate} width={140} /> : <span style={{ width: 140, height: 190, display: 'block' }} />}</span>
            <span className="lbl">
              {i + 1}
              {pg.rotate ? <span className="pill info">{pg.rotate}°</span> : null}
              {!pg.src && <span className="pill accent">빈 쪽</span>}
              {n > 0 && <span className="pill accent">주석 {n}</span>}
            </span>
          </button>
        );
      })}
      {dropAt === pages.length && <div aria-hidden="true" style={{ width: 4, background: 'var(--accent)', borderRadius: 2 }} />}
    </div>
  );
}
