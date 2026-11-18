import { useEffect, useRef, useState } from 'react';
import { Modal } from '../components/Modal';

const KEY = 'pdf-signatures';

export function loadSignatures(): string[] {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? '[]');
  } catch {
    return [];
  }
}
export function saveSignatures(list: string[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(list.slice(0, 8)));
  } catch {
    /* 저장 공간 부족은 무시 — 이번 세션에서만 사용 */
  }
}

/** 투명 여백을 잘라낸 PNG */
function trimCanvas(src: HTMLCanvasElement): string | null {
  const ctx = src.getContext('2d')!;
  const { width, height } = src;
  const data = ctx.getImageData(0, 0, width, height).data;
  let x0 = width, y0 = height, x1 = -1, y1 = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (data[(y * width + x) * 4 + 3] > 8) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  }
  if (x1 < 0) return null;
  const pad = 6;
  x0 = Math.max(0, x0 - pad); y0 = Math.max(0, y0 - pad); x1 = Math.min(width - 1, x1 + pad); y1 = Math.min(height - 1, y1 + pad);
  const out = document.createElement('canvas');
  out.width = x1 - x0 + 1;
  out.height = y1 - y0 + 1;
  out.getContext('2d')!.drawImage(src, x0, y0, out.width, out.height, 0, 0, out.width, out.height);
  return out.toDataURL('image/png');
}

export function SignatureDialog({ onClose, onCreate }: { onClose: () => void; onCreate: (dataUrl: string) => void }) {
  const [tab, setTab] = useState<'draw' | 'type'>('draw');
  const [color, setColor] = useState('#111316');
  const [name, setName] = useState('');
  const [empty, setEmpty] = useState(true);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const last = useRef<[number, number] | null>(null);

  useEffect(() => {
    const c = canvasRef.current;
    if (!c) return;
    const r = c.getBoundingClientRect();
    c.width = r.width * 2;
    c.height = r.height * 2;
  }, [tab]);

  const pos = (e: React.PointerEvent) => {
    const r = canvasRef.current!.getBoundingClientRect();
    return [(e.clientX - r.left) * 2, (e.clientY - r.top) * 2] as [number, number];
  };
  const down = (e: React.PointerEvent) => {
    canvasRef.current!.setPointerCapture(e.pointerId);
    last.current = pos(e);
  };
  const move = (e: React.PointerEvent) => {
    if (!last.current) return;
    const ctx = canvasRef.current!.getContext('2d')!;
    const p = pos(e);
    ctx.strokeStyle = color;
    ctx.lineWidth = 5 * (e.pressure && e.pointerType === 'pen' ? 0.5 + e.pressure : 1);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(...last.current);
    ctx.lineTo(...p);
    ctx.stroke();
    last.current = p;
    setEmpty(false);
  };
  const clear = () => {
    const c = canvasRef.current!;
    c.getContext('2d')!.clearRect(0, 0, c.width, c.height);
    setEmpty(true);
  };

  const create = () => {
    let url: string | null = null;
    if (tab === 'draw') url = canvasRef.current ? trimCanvas(canvasRef.current) : null;
    else if (name.trim()) {
      const c = document.createElement('canvas');
      c.width = 1200;
      c.height = 300;
      const ctx = c.getContext('2d')!;
      ctx.fillStyle = color;
      ctx.font = "italic 700 150px 'Noto Serif KR', serif";
      ctx.textBaseline = 'middle';
      ctx.fillText(name.trim(), 20, 150, 1160);
      url = trimCanvas(c);
    }
    if (!url) return;
    onCreate(url);
    onClose();
  };

  return (
    <Modal
      title="서명 만들기"
      onClose={onClose}
      width={520}
      footer={<><button className="btn btn-outline" onClick={onClose}>취소</button><button className="btn btn-primary" disabled={tab === 'draw' ? empty : !name.trim()} onClick={create}>만들기</button></>}
    >
      <div className="segs" role="tablist">
        <button role="tab" aria-selected={tab === 'draw'} className={`seg ${tab === 'draw' ? 'on' : ''}`} onClick={() => setTab('draw')}>직접 그리기</button>
        <button role="tab" aria-selected={tab === 'type'} className={`seg ${tab === 'type' ? 'on' : ''}`} onClick={() => setTab('type')}>이름 입력</button>
      </div>
      {tab === 'draw' ? (
        <>
          <canvas ref={canvasRef} className="sig-pad" aria-label="서명 그리는 곳" onPointerDown={down} onPointerMove={move} onPointerUp={() => (last.current = null)} />
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span className="muted" style={{ fontSize: 13 }}>마우스나 손가락, 펜으로 서명하세요.</span>
            <button className="btn btn-outline btn-sm" style={{ marginLeft: 'auto' }} onClick={clear}>지우기</button>
          </div>
        </>
      ) : (
        <>
          <input className="in" style={{ height: 40, fontSize: 15 }} placeholder="이름" value={name} onChange={(e) => setName(e.target.value)} aria-label="서명할 이름" />
          <div style={{ height: 90, border: '1.5px dashed var(--line-strong)', borderRadius: 12, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: "'Noto Serif KR', serif", fontStyle: 'italic', fontWeight: 700, fontSize: 38, color }}>
            {name || <span className="muted" style={{ fontSize: 14, fontStyle: 'normal', fontWeight: 400, fontFamily: 'var(--font-ui)' }}>미리보기</span>}
          </div>
        </>
      )}
      <div role="radiogroup" aria-label="서명 색" style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
        <span className="muted" style={{ fontSize: 13 }}>색</span>
        {[['#111316', '검정'], ['#1D3A8A', '파랑'], ['#B91C1C', '빨강']].map(([c, l]) => (
          <button key={c} role="radio" aria-checked={color === c} aria-label={l} className={`sw ${color === c ? 'on' : ''}`} style={{ background: c }} onClick={() => setColor(c)} />
        ))}
      </div>
    </Modal>
  );
}
