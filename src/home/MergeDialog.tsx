import { useState } from 'react';
import { Icon } from '../components/Icon';
import { Modal } from '../components/Modal';
import { createPdfDoc, navigate } from '../lib/docs';
import { baseName, downloadBlob, pickFiles } from '../lib/files';
import { mergePdfs, parseRanges, splitPdf } from '../lib/convert';
import { newId, formatBytes } from '../lib/storage';
import { toast } from '../lib/toast';
import { countPdfPages } from '../pdf/pdfjs';
import type { PdfStored } from '../pdf/types';

interface Item { id: string; file: File; bytes: ArrayBuffer; pages: number }

export function MergeDialog({ onClose }: { onClose: () => void }) {
  const [tab, setTab] = useState<'merge' | 'split'>('merge');
  const [items, setItems] = useState<Item[]>([]);
  const [busy, setBusy] = useState(false);
  const [over, setOver] = useState(false);
  const [dragId, setDragId] = useState<string | null>(null);
  const [range, setRange] = useState('');
  const [splitMode, setSplitMode] = useState<'each' | 'range'>('range');

  const add = async (files: File[]) => {
    const pdfs = files.filter((f) => /\.pdf$/i.test(f.name) || f.type === 'application/pdf');
    if (pdfs.length < files.length) toast('PDF가 아닌 파일은 뺐습니다.', 'info');
    setBusy(true);
    try {
      const added: Item[] = [];
      for (const f of pdfs) {
        const bytes = await f.arrayBuffer();
        try {
          added.push({ id: newId(), file: f, bytes, pages: await countPdfPages(bytes) });
        } catch {
          toast(`‘${f.name}’을(를) 읽을 수 없습니다.`, 'error');
        }
      }
      setItems((cur) => (tab === 'split' ? added.slice(0, 1) : [...cur, ...added]));
    } finally {
      setBusy(false);
    }
  };

  const move = (i: number, d: number) => setItems((cur) => {
    const next = [...cur];
    const j = i + d;
    if (j < 0 || j >= next.length) return cur;
    [next[i], next[j]] = [next[j], next[i]];
    return next;
  });

  const editMerged = async () => {
    setBusy(true);
    try {
      const sources = items.map((it) => ({ id: newId(), name: it.file.name, bytes: it.bytes }));
      const stored: PdfStored = {
        sources,
        state: {
          pages: sources.flatMap((s, k) => Array.from({ length: items[k].pages }, (_, i) => ({ id: newId(), src: s.id, index: i, rotate: 0 }))),
          annots: [], edits: [], form: {},
        },
      };
      const total = items.reduce((a, b) => a + b.pages, 0);
      const name = items.length > 1 ? `${baseName(items[0].file.name)} 외 ${items.length - 1}개 합본` : baseName(items[0].file.name);
      const id = await createPdfDoc(name, stored, items.reduce((a, b) => a + b.file.size, 0), total);
      navigate(`/pdf/${id}/pages`);
    } finally {
      setBusy(false);
    }
  };

  const downloadMerged = async () => {
    setBusy(true);
    try {
      const data = await mergePdfs(items.map((i) => i.bytes));
      downloadBlob(data, `${baseName(items[0].file.name)}_합본.pdf`, 'application/pdf');
      toast('합친 PDF를 내려받았습니다.', 'ok');
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  };

  const doSplit = async () => {
    const it = items[0];
    if (!it) return;
    try {
      const groups = splitMode === 'each' ? Array.from({ length: it.pages }, (_, i) => [i]) : parseRanges(range, it.pages);
      if (!groups.length) throw new Error('추출할 쪽 범위를 입력하세요. 예: 1-3, 5');
      setBusy(true);
      const out = await splitPdf(it.bytes, groups, baseName(it.file.name));
      downloadBlob(out.blob, out.name);
      toast(`${groups.length}개 파일로 나눴습니다.`, 'ok');
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  };

  const total = items.reduce((a, b) => a + b.pages, 0);

  return (
    <Modal
      title="PDF 합치기 · 나누기"
      onClose={onClose}
      width={560}
      icon={<span className="qi" style={{ width: 32, height: 32, borderRadius: 9, background: 'var(--purple-soft)', color: 'var(--purple-text)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Icon name="layers" /></span>}
      footer={tab === 'merge' ? (
        <>
          <span className="muted" style={{ marginRight: 'auto', fontSize: 13, alignSelf: 'center' }}>{items.length ? `${items.length}개 파일 · 모두 ${total}쪽` : ''}</span>
          <button className="btn btn-outline" disabled={items.length < 2 || busy} onClick={downloadMerged}><Icon name="download" />바로 내려받기</button>
          <button className="btn btn-primary" disabled={!items.length || busy} onClick={editMerged}>합쳐서 편집하기</button>
        </>
      ) : (
        <>
          <button className="btn btn-outline" onClick={onClose}>닫기</button>
          <button className="btn btn-primary" disabled={!items.length || busy} onClick={doSplit}><Icon name="download" />나누어 내려받기</button>
        </>
      )}
    >
      <div className="segs" role="tablist" aria-label="작업">
        <button role="tab" aria-selected={tab === 'merge'} className={`seg ${tab === 'merge' ? 'on' : ''}`} onClick={() => setTab('merge')}>합치기</button>
        <button role="tab" aria-selected={tab === 'split'} className={`seg ${tab === 'split' ? 'on' : ''}`} onClick={() => { setTab('split'); setItems((c) => c.slice(0, 1)); }}>나누기</button>
      </div>
      <div
        className={`drop-zone ${over ? 'over' : ''}`}
        onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); setOver(true); }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => { e.preventDefault(); e.stopPropagation(); setOver(false); add(Array.from(e.dataTransfer.files)); }}
      >
        <Icon name="upload" size={24} />
        <span>{tab === 'merge' ? 'PDF 파일을 여기에 끌어 놓거나' : '나눌 PDF 한 개를 끌어 놓거나'}</span>
        <button className="btn btn-outline btn-sm" onClick={async () => add(await pickFiles('.pdf,application/pdf', tab === 'merge'))}>파일 고르기</button>
      </div>
      {busy && <div style={{ display: 'flex', justifyContent: 'center' }}><div className="spinner" /></div>}
      {items.length > 0 && (
        <div className="file-list" aria-label="파일 순서">
          {items.map((it, i) => (
            <div
              key={it.id}
              className="file-row"
              draggable={tab === 'merge'}
              onDragStart={() => setDragId(it.id)}
              onDragOver={(e) => {
                e.preventDefault();
                if (!dragId || dragId === it.id) return;
                setItems((cur) => {
                  const from = cur.findIndex((x) => x.id === dragId);
                  const to = cur.findIndex((x) => x.id === it.id);
                  const next = [...cur];
                  const [m] = next.splice(from, 1);
                  next.splice(to, 0, m);
                  return next;
                });
              }}
              onDragEnd={() => setDragId(null)}
              style={{ opacity: dragId === it.id ? 0.5 : 1, cursor: tab === 'merge' ? 'grab' : undefined }}
            >
              <span className="badge pdf">PDF</span>
              <span className="nm">{it.file.name}</span>
              <span className="muted" style={{ fontSize: 12 }}>{it.pages}쪽 · {formatBytes(it.file.size)}</span>
              {tab === 'merge' && (
                <>
                  <button className="tb" aria-label="위로" disabled={i === 0} onClick={() => move(i, -1)}><Icon name="chevDown" style={{ transform: 'rotate(180deg)' }} size={16} /></button>
                  <button className="tb" aria-label="아래로" disabled={i === items.length - 1} onClick={() => move(i, 1)}><Icon name="chevDown" size={16} /></button>
                </>
              )}
              <button className="tb" aria-label="빼기" onClick={() => setItems((c) => c.filter((x) => x.id !== it.id))}><Icon name="x" size={16} /></button>
            </div>
          ))}
        </div>
      )}
      {tab === 'merge' && items.length > 0 && <span className="muted" style={{ fontSize: 12 }}>끌어서 순서를 바꿀 수 있어요. ‘합쳐서 편집하기’를 누르면 페이지 단위로 다시 정리하고 주석도 달 수 있습니다.</span>}
      {tab === 'split' && items[0] && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14 }}>
            <input type="radio" name="split" checked={splitMode === 'range'} onChange={() => setSplitMode('range')} />
            쪽 범위로 추출
          </label>
          <input className="in" disabled={splitMode !== 'range'} placeholder={`예: 1-3, 5, 8-${items[0].pages}  (쉼표로 구분한 범위마다 파일 하나)`} value={range} onChange={(e) => setRange(e.target.value)} style={{ height: 38 }} aria-label="쪽 범위" />
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14 }}>
            <input type="radio" name="split" checked={splitMode === 'each'} onChange={() => setSplitMode('each')} />
            한 쪽씩 모두 나누기 ({items[0].pages}개 파일, ZIP)
          </label>
        </div>
      )}
    </Modal>
  );
}
