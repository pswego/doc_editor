import { useEffect, useState } from 'react';
import { Icon } from '../components/Icon';

type Toast = { id: number; text: string; kind: 'info' | 'ok' | 'error' };
let listeners: ((t: Toast[]) => void)[] = [];
let toasts: Toast[] = [];
let seq = 1;

export function toast(text: string, kind: Toast['kind'] = 'info', ms = 3200) {
  const t = { id: seq++, text, kind };
  toasts = [...toasts, t];
  listeners.forEach((l) => l(toasts));
  setTimeout(() => {
    toasts = toasts.filter((x) => x.id !== t.id);
    listeners.forEach((l) => l(toasts));
  }, ms);
}

export function Toasts() {
  const [list, setList] = useState<Toast[]>(toasts);
  useEffect(() => {
    listeners.push(setList);
    return () => {
      listeners = listeners.filter((l) => l !== setList);
    };
  }, []);
  return (
    <div className="toasts" role="status" aria-live="polite">
      {list.map((t) => (
        <div key={t.id} className={`toast ${t.kind}`}>
          {t.kind === 'ok' && <Icon name="check" size={16} />}
          {t.kind === 'error' && <Icon name="warn" size={16} />}
          <span>{t.text}</span>
        </div>
      ))}
    </div>
  );
}
