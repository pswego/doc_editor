import { useState } from 'react';
import { Icon } from '../components/Icon';
import { Modal } from '../components/Modal';
import { createHwpDoc, importFile, navigate } from '../lib/docs';
import { baseName, detectKind, downloadBlob, pickFiles, type FileKind } from '../lib/files';
import { formatBytes } from '../lib/storage';
import { toast } from '../lib/toast';

export function ConvertDialog({ onClose }: { onClose: () => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [kind, setKind] = useState<FileKind>('unknown');
  const [busy, setBusy] = useState<string | null>(null);

  const choose = async () => {
    const [f] = await pickFiles('.hwp,.hwpx,.pdf,application/pdf');
    if (!f) return;
    const k = await detectKind(f);
    if (k === 'unknown') return toast('HWP·HWPX·PDF 파일만 변환할 수 있습니다.', 'error');
    setFile(f);
    setKind(k);
  };

  const run = async (label: string, fn: () => Promise<void>) => {
    setBusy(label);
    try {
      await fn();
    } catch (e) {
      toast((e as Error).message || '변환하지 못했습니다.', 'error', 5000);
    } finally {
      setBusy(null);
    }
  };

  const hwpOpts = file && (kind === 'hwp' || kind === 'hwpx') ? [
    {
      icon: 'save', t: 'HWPX로 저장', d: '한글 2010 이후 버전과 이 편집기에서 열리는 개방형 형식',
      go: () => run('HWPX로 바꾸는 중…', async () => {
        const { readHangul, writeHwpx } = await import('../hwp/format');
        const hd = await readHangul(new Uint8Array(await file.arrayBuffer()));
        downloadBlob(await writeHwpx(hd.doc, hd.page, baseName(file.name)), `${baseName(file.name)}.hwpx`, 'application/octet-stream');
        toast('HWPX 파일을 내려받았습니다.', 'ok');
      }),
    },
    {
      icon: 'print', t: 'PDF로 저장', d: '문서를 열고 인쇄 창에서 ‘PDF로 저장’을 고릅니다',
      go: () => run('문서를 여는 중…', async () => {
        const r = await importFile(file);
        sessionStorage.setItem('auto-print', r.id);
        navigate(`/hwp/${r.id}`);
      }),
    },
    {
      icon: 'text', t: '텍스트(.txt)로 저장', d: '서식 없이 글자만 꺼냅니다',
      go: () => run('글자를 꺼내는 중…', async () => {
        const { readHangul } = await import('../hwp/format');
        const { docToText } = await import('../lib/convert');
        const hd = await readHangul(new Uint8Array(await file.arrayBuffer()));
        downloadBlob(docToText(hd.doc), `${baseName(file.name)}.txt`, 'text/plain;charset=utf-8');
        toast('텍스트 파일을 내려받았습니다.', 'ok');
      }),
    },
  ] : [];

  const pdfOpts = file && kind === 'pdf' ? [
    {
      icon: 'docPlus', t: '한글 문서로 변환해 편집', d: 'PDF의 글자를 문단으로 묶어 편집 가능한 문서로 엽니다 (레이아웃은 단순해집니다)',
      go: () => run('글자를 읽는 중…', async () => {
        const { pdfToHwpDoc } = await import('../lib/convert');
        const doc = await pdfToHwpDoc(await file.arrayBuffer());
        const id = await createHwpDoc(baseName(file.name), { doc });
        navigate(`/hwp/${id}`);
      }),
    },
    {
      icon: 'image', t: '이미지(PNG)로 저장', d: '쪽마다 PNG 한 장, ZIP으로 묶어 내려받기',
      go: () => run('쪽을 그리는 중…', async () => {
        const { pdfToImages } = await import('../lib/convert');
        const blob = await pdfToImages(await file.arrayBuffer(), 2, (i, n) => setBusy(`쪽을 그리는 중… ${i}/${n}`));
        downloadBlob(blob, `${baseName(file.name)}_이미지.zip`);
        toast('이미지 ZIP을 내려받았습니다.', 'ok');
      }),
    },
    {
      icon: 'text', t: '텍스트(.txt)로 저장', d: '쪽별로 글자만 꺼냅니다 (스캔 이미지는 글자가 없습니다)',
      go: () => run('글자를 꺼내는 중…', async () => {
        const { pdfToText } = await import('../lib/convert');
        downloadBlob(await pdfToText(await file.arrayBuffer()), `${baseName(file.name)}.txt`, 'text/plain;charset=utf-8');
        toast('텍스트 파일을 내려받았습니다.', 'ok');
      }),
    },
  ] : [];

  return (
    <Modal
      title="파일 변환"
      onClose={onClose}
      width={540}
      icon={<span style={{ width: 32, height: 32, borderRadius: 9, background: 'var(--success-soft)', color: 'var(--success-text)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Icon name="convert" /></span>}
    >
      {!file ? (
        <div className="drop-zone">
          <Icon name="upload" size={24} />
          <span>변환할 HWP · HWPX · PDF 파일을 고르세요</span>
          <button className="btn btn-primary btn-sm" onClick={choose}>파일 고르기</button>
        </div>
      ) : (
        <>
          <div className="file-row">
            <span className={`badge ${kind === 'pdf' ? 'pdf' : 'hwp'}`}>{kind.toUpperCase()}</span>
            <span className="nm">{file.name}</span>
            <span className="muted" style={{ fontSize: 12 }}>{formatBytes(file.size)}</span>
            <button className="btn btn-outline btn-sm" onClick={choose}>바꾸기</button>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {[...hwpOpts, ...pdfOpts].map((o) => (
              <button key={o.t} className="opt-card" disabled={!!busy} onClick={o.go}>
                <span className="qi" style={{ width: 36, height: 36, borderRadius: 10, background: 'var(--ground)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--ink-3)', flex: 'none' }}><Icon name={o.icon} /></span>
                <span style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                  <span className="t">{o.t}</span>
                  <span className="d">{o.d}</span>
                </span>
                <Icon name="chevRight" style={{ marginLeft: 'auto', color: 'var(--ink-2)' }} />
              </button>
            ))}
          </div>
        </>
      )}
      {busy && <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 13 }} role="status"><div className="spinner" style={{ width: 20, height: 20 }} />{busy}</div>}
    </Modal>
  );
}
