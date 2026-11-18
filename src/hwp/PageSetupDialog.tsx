import { useState } from 'react';
import { Modal } from '../components/Modal';
import { NumField } from './panels';
import { PAPERS, pageDims, type PageSetup } from './format/types';

export function PageSetupDialog({ page, onClose, onApply }: { page: PageSetup; onClose: () => void; onApply: (p: PageSetup) => void }) {
  const [p, setP] = useState<PageSetup>(page);
  const set = (patch: Partial<PageSetup>) => setP((x) => ({ ...x, ...patch }));
  const d = pageDims(p);
  const scale = 120 / Math.max(d.w, d.h);
  return (
    <Modal
      title="편집 용지"
      onClose={onClose}
      width={560}
      footer={<><button className="btn btn-outline" onClick={onClose}>취소</button><button className="btn btn-primary" onClick={() => { onApply(p); onClose(); }}>설정</button></>}
    >
      <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap' }}>
        <div style={{ flex: '1 1 260px', display: 'flex', flexDirection: 'column', gap: 12 }}>
          <label className="fl">
            용지 종류
            <select className="in" value={p.paper in PAPERS ? p.paper : 'custom'} onChange={(e) => {
              const k = e.target.value;
              const pp = PAPERS[k];
              if (pp) set({ paper: k, width: pp.width, height: pp.height });
              else set({ paper: 'custom' });
            }}>
              {Object.entries(PAPERS).map(([k, v]) => <option key={k} value={k}>{v.label} ({v.width} × {v.height} mm)</option>)}
              <option value="custom">사용자 정의</option>
            </select>
          </label>
          <div className="grid2">
            <NumField label="폭" unit="mm" value={p.width} min={50} max={1000} onCommit={(v) => v && set({ width: v, paper: 'custom' })} />
            <NumField label="길이" unit="mm" value={p.height} min={50} max={1000} onCommit={(v) => v && set({ height: v, paper: 'custom' })} />
          </div>
          <div className="segs" role="radiogroup" aria-label="용지 방향">
            <button role="radio" aria-checked={!p.landscape} className={`seg ${!p.landscape ? 'on' : ''}`} onClick={() => set({ landscape: false })}>세로</button>
            <button role="radio" aria-checked={p.landscape} className={`seg ${p.landscape ? 'on' : ''}`} onClick={() => set({ landscape: true })}>가로</button>
          </div>
          <div className="sec-title" style={{ marginTop: 4 }}>용지 여백 (mm)</div>
          <div className="grid2">
            <NumField label="위쪽" value={p.marginTop} min={0} max={200} onCommit={(v) => set({ marginTop: v ?? 0 })} />
            <NumField label="아래쪽" value={p.marginBottom} min={0} max={200} onCommit={(v) => set({ marginBottom: v ?? 0 })} />
            <NumField label="왼쪽" value={p.marginLeft} min={0} max={200} onCommit={(v) => set({ marginLeft: v ?? 0 })} />
            <NumField label="오른쪽" value={p.marginRight} min={0} max={200} onCommit={(v) => set({ marginRight: v ?? 0 })} />
            <NumField label="머리말" value={p.marginHeader} min={0} max={200} onCommit={(v) => set({ marginHeader: v ?? 0 })} />
            <NumField label="꼬리말" value={p.marginFooter} min={0} max={200} onCommit={(v) => set({ marginFooter: v ?? 0 })} />
          </div>
        </div>
        <div style={{ flex: '0 0 150px', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--ground)', borderRadius: 12, minHeight: 170 }} aria-hidden="true">
          <div style={{ position: 'relative', width: d.w * scale, height: d.h * scale, background: '#fff', boxShadow: 'var(--shadow-page)' }}>
            <div style={{ position: 'absolute', left: p.marginLeft * scale, right: p.marginRight * scale, top: (p.marginTop + p.marginHeader) * scale, bottom: (p.marginBottom + p.marginFooter) * scale, border: '1px dashed var(--accent)', background: 'repeating-linear-gradient(#fff 0 5px, #E4E7EC 5px 6px)' }} />
          </div>
        </div>
      </div>
    </Modal>
  );
}
