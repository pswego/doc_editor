import { useEffect, useMemo, useRef, useState } from 'react';
import { Icon } from '../components/Icon';
import type { Cmd } from './commands';

/** 기능 검색 (Ctrl+K) — 기능 이름이나 문서 내용으로 */
export function CommandPalette({ commands, onClose, onFindText, initial = '' }: { commands: Cmd[]; onClose: () => void; onFindText: (q: string) => void; initial?: string }) {
  const [q, setQ] = useState(initial);
  const [idx, setIdx] = useState(0);
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => ref.current?.focus(), []);
  const list = useMemo(() => {
    const s = q.trim().toLowerCase().replace(/\s+/g, '');
    const hits = s
      ? commands.filter((c) => (c.label + c.group + (c.keywords ?? '')).toLowerCase().replace(/\s+/g, '').includes(s))
      : commands;
    return hits.slice(0, 40);
  }, [q, commands]);
  const total = list.length + (q.trim() ? 1 : 0);
  const run = (i: number) => {
    onClose();
    if (i < list.length) setTimeout(() => list[i].run(), 0);
    else if (q.trim()) onFindText(q.trim());
  };
  return (
    <div className="palette" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="palette-box" role="dialog" aria-label="기능 검색">
        <input
          ref={ref}
          value={q}
          placeholder="기능 이름이나 찾을 문서 내용을 입력하세요"
          aria-label="기능 검색"
          role="combobox"
          aria-expanded="true"
          aria-controls="palette-list"
          onChange={(e) => { setQ(e.target.value); setIdx(0); }}
          onKeyDown={(e) => {
            if (e.key === 'Escape') onClose();
            else if (e.key === 'ArrowDown') { e.preventDefault(); setIdx((i) => Math.min(total - 1, i + 1)); }
            else if (e.key === 'ArrowUp') { e.preventDefault(); setIdx((i) => Math.max(0, i - 1)); }
            else if (e.key === 'Enter') { e.preventDefault(); run(idx); }
          }}
        />
        <div className="palette-list" id="palette-list" role="listbox">
          {list.map((c, i) => (
            <button key={c.id} role="option" aria-selected={i === idx} className={`palette-item ${i === idx ? 'on' : ''}`} onMouseEnter={() => setIdx(i)} onClick={() => run(i)}>
              <Icon name={c.icon ?? 'chevRight'} size={16} />
              {c.label}
              {c.keys && <span className="kbd" style={{ marginLeft: 8 }}>{c.keys}</span>}
              <span className="grp-name">{c.group}</span>
            </button>
          ))}
          {q.trim() && (
            <button role="option" aria-selected={idx === list.length} className={`palette-item ${idx === list.length ? 'on' : ''}`} onMouseEnter={() => setIdx(list.length)} onClick={() => run(list.length)}>
              <Icon name="search" size={16} />문서에서 ‘{q.trim()}’ 찾기
              <span className="grp-name">문서 내용</span>
            </button>
          )}
          {!total && <div className="muted" style={{ padding: 14, fontSize: 13 }}>일치하는 기능이 없습니다.</div>}
        </div>
      </div>
    </div>
  );
}
