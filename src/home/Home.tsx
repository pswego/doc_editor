import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { Icon } from '../components/Icon';
import { Modal } from '../components/Modal';
import { Popover, usePopover } from '../components/Popover';
import { createFromTemplate, importFile, navigate } from '../lib/docs';
import { ACCEPT_ALL, pickFiles } from '../lib/files';
import { deleteDoc, formatBytes, formatWhen, listDocs, patchMeta, storageEstimate, type DocMeta } from '../lib/storage';
import { toast } from '../lib/toast';
import { useFileDrop } from '../lib/useFileDrop';
import { TemplateThumb } from './TemplateThumb';
import { TEMPLATES } from '../hwp/templates';
import './home.css';

export const PRODUCT = '문서공방';

const ConvertDialog = lazy(() => import('./ConvertDialog').then((m) => ({ default: m.ConvertDialog })));
const MergeDialog = lazy(() => import('./MergeDialog').then((m) => ({ default: m.MergeDialog })));

type Filter = 'all' | 'hwp' | 'pdf';

export async function openFilesAndGo(files: File[], setBusy?: (s: string | null) => void) {
  const f = files[0];
  if (!f) return;
  setBusy?.(`‘${f.name}’ 여는 중…`);
  try {
    const r = await importFile(f);
    if (r.warnings.length) sessionStorage.setItem('open-warnings', JSON.stringify(r.warnings));
    navigate(`/${r.kind}/${r.id}`);
  } catch (e) {
    toast((e as Error).message || '문서를 열지 못했습니다.', 'error', 5000);
  } finally {
    setBusy?.(null);
  }
  if (files.length > 1) toast('한 번에 한 문서만 열 수 있어 첫 번째 파일을 열었습니다. 여러 PDF를 합치려면 ‘PDF 합치기·나누기’를 쓰세요.', 'info', 5000);
}

export function Home({ section }: { section?: string }) {
  const view = section === 'recent' || section === 'starred' || section === 'trash' ? section : 'home';
  const [docs, setDocs] = useState<DocMeta[] | null>(null);
  const [filter, setFilter] = useState<Filter>('all');
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [usage, setUsage] = useState<{ usage: number; quota: number } | null>(null);
  const [dialog, setDialog] = useState<null | 'merge' | 'convert' | { rename: DocMeta } | { purge: DocMeta }>(null);

  const reload = useCallback(async () => {
    setDocs(await listDocs());
    setUsage(await storageEstimate());
  }, []);
  useEffect(() => {
    reload();
    document.title = `${PRODUCT} · HWP·PDF 편집기`;
  }, [reload]);

  const onFiles = useCallback((files: File[]) => openFilesAndGo(files, setBusy), []);
  const dragging = useFileDrop(onFiles);

  const openPicker = async () => onFiles(await pickFiles(ACCEPT_ALL));
  const openPdfPicker = async (mode?: string) => {
    const files = await pickFiles('.pdf,application/pdf');
    if (!files[0]) return;
    setBusy(`‘${files[0].name}’ 여는 중…`);
    try {
      const r = await importFile(files[0]);
      navigate(`/${r.kind}/${r.id}${mode && r.kind === 'pdf' ? `/${mode}` : ''}`);
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setBusy(null);
    }
  };
  const newFromTemplate = async (id: string) => {
    const docId = await createFromTemplate(id);
    navigate(`/hwp/${docId}`);
  };

  const visible = useMemo(() => {
    if (!docs) return [];
    const q = query.trim().toLowerCase();
    return docs.filter((d) => {
      if (view === 'trash' ? !d.trashed : d.trashed) return false;
      if (view === 'starred' && !d.starred) return false;
      if (filter !== 'all' && d.kind !== filter) return false;
      if (q && !d.name.toLowerCase().includes(q) && !(d.preview ?? '').toLowerCase().includes(q)) return false;
      return true;
    });
  }, [docs, filter, query, view]);

  const counts = useMemo(() => ({
    starred: docs?.filter((d) => d.starred && !d.trashed).length ?? 0,
    trash: docs?.filter((d) => d.trashed).length ?? 0,
  }), [docs]);

  const open = (d: DocMeta) => navigate(`/${d.kind}/${d.id}`);
  const toggleStar = async (d: DocMeta) => {
    await patchMeta(d.id, { starred: !d.starred });
    reload();
  };
  const trash = async (d: DocMeta, v: boolean) => {
    await patchMeta(d.id, { trashed: v });
    toast(v ? `‘${d.name}’을(를) 휴지통으로 옮겼습니다.` : `‘${d.name}’을(를) 복원했습니다.`, 'ok');
    reload();
  };

  const pct = usage && usage.quota ? Math.min(100, (usage.usage / usage.quota) * 100) : 0;

  return (
    <div className="home">
      <nav className="home-nav" aria-label="주 메뉴">
        <div className="brand">
          <span className="brand-mark"><Icon name="doc" /></span>
          <span className="brand-name">{PRODUCT}</span>
        </div>
        <NewButton onTemplate={newFromTemplate} onOpen={openPicker} />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <a className={`nv ${view === 'home' ? 'on' : ''}`} href="#/" aria-current={view === 'home' ? 'page' : undefined}><Icon name="home" />홈</a>
          <a className={`nv ${view === 'recent' ? 'on' : ''}`} href="#/recent" aria-current={view === 'recent' ? 'page' : undefined}><Icon name="clock" />최근 문서</a>
          <a className={`nv ${view === 'starred' ? 'on' : ''}`} href="#/starred" aria-current={view === 'starred' ? 'page' : undefined}><Icon name="star" />즐겨찾기{counts.starred > 0 && <span className="count">{counts.starred}</span>}</a>
          <a className={`nv ${view === 'trash' ? 'on' : ''}`} href="#/trash" aria-current={view === 'trash' ? 'page' : undefined}><Icon name="trash" />휴지통{counts.trash > 0 && <span className="count">{counts.trash}</span>}</a>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <span className="nav-label">도구</span>
          <button className="nv" onClick={() => setDialog('merge')}><Icon name="layers" />PDF 합치기·나누기</button>
          <button className="nv" onClick={() => setDialog('convert')}><Icon name="convert" />파일 변환</button>
          <button className="nv" onClick={() => openPdfPicker('sign')}><Icon name="sign" />PDF에 서명하기</button>
        </div>
        <div className="storage-card">
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, gap: 8 }}>
            <span style={{ fontWeight: 500 }}>이 브라우저에 저장됨</span>
            <span className="muted">{usage ? formatBytes(usage.usage) : '—'}</span>
          </div>
          <div className="meter" aria-hidden="true"><span style={{ width: `${Math.max(pct, usage?.usage ? 2 : 0)}%` }} /></div>
          <span style={{ fontSize: 11, color: 'var(--ink-2)', lineHeight: 1.5 }}>문서는 서버로 보내지 않고 이 기기 브라우저 안에만 보관됩니다.</span>
        </div>
      </nav>

      <main className="home-main">
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 12 }}>
          <label className="search-box">
            <Icon name="search" />
            <input type="search" placeholder="파일 이름, 문서 내용으로 검색" aria-label="문서 검색" value={query} onChange={(e) => setQuery(e.target.value)} />
          </label>
          <button className="btn btn-outline btn-lg" style={{ marginLeft: 'auto' }} onClick={openPicker}><Icon name="open" />문서 열기</button>
        </div>

        {view === 'home' && !query && (
          <>
            <section className="h-sec">
              <h1>무엇을 할까요?</h1>
              <div className="qa-grid">
                <button className="qa" onClick={() => newFromTemplate('blank')}>
                  <span className="qi" style={{ background: 'var(--accent-soft)', color: 'var(--accent-strong)' }}><Icon name="docPlus" /></span>
                  <span className="qt">새 한글 문서</span>
                  <span className="qd">빈 문서로 시작해 HWPX로 저장</span>
                </button>
                <button className="qa" onClick={() => openPdfPicker()}>
                  <span className="qi" style={{ background: 'var(--pdf-soft)', color: 'var(--pdf-text)' }}><Icon name="folder" /></span>
                  <span className="qt">PDF 열고 편집</span>
                  <span className="qd">텍스트 수정·주석·페이지 정리</span>
                </button>
                <button className="qa" onClick={openPicker}>
                  <span className="qi" style={{ background: 'var(--accent-soft)', color: 'var(--accent-strong)' }}><Icon name="open" /></span>
                  <span className="qt">한글 문서 열기</span>
                  <span className="qd">HWP · HWPX 파일을 열어 편집</span>
                </button>
                <button className="qa" onClick={() => setDialog('convert')}>
                  <span className="qi" style={{ background: 'var(--success-soft)', color: 'var(--success-text)' }}><Icon name="convert" /></span>
                  <span className="qt">파일 변환</span>
                  <span className="qd">HWP → HWPX · PDF → 이미지 · 텍스트 · 한글</span>
                </button>
                <button className="qa" onClick={() => setDialog('merge')}>
                  <span className="qi" style={{ background: 'var(--purple-soft)', color: 'var(--purple-text)' }}><Icon name="layers" /></span>
                  <span className="qt">PDF 합치기·나누기</span>
                  <span className="qd">여러 파일을 끌어다 순서 정리</span>
                </button>
                <button className="qa" onClick={() => openPdfPicker('sign')}>
                  <span className="qi" style={{ background: 'var(--warn-soft)', color: 'var(--warn-text)' }}><Icon name="sign" /></span>
                  <span className="qt">PDF에 서명하기</span>
                  <span className="qd">손글씨 서명을 만들어 원하는 위치에</span>
                </button>
              </div>
            </section>

            <section className="h-sec">
              <h2>서식 문서로 시작</h2>
              <div className="tp-grid">
                {TEMPLATES.filter((t) => t.id !== 'blank').map((t) => (
                  <button key={t.id} className="tp" onClick={() => newFromTemplate(t.id)}>
                    <TemplateThumb id={t.id} />
                    {t.name}
                  </button>
                ))}
              </div>
            </section>
          </>
        )}

        <section className="h-sec">
          <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8 }}>
            <h2 style={{ marginRight: 8 }}>
              {query ? '검색 결과' : view === 'starred' ? '즐겨찾기' : view === 'trash' ? '휴지통' : '최근 문서'}
            </h2>
            {(['all', 'hwp', 'pdf'] as Filter[]).map((f) => (
              <button key={f} className={`chip ${filter === f ? 'on' : ''}`} aria-pressed={filter === f} onClick={() => setFilter(f)}>
                {f === 'all' ? '전체' : f === 'hwp' ? '한글' : 'PDF'}
              </button>
            ))}
            <span style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--ink-2)' }}>
              {view === 'trash' ? '휴지통의 문서는 직접 영구 삭제할 때까지 남아 있습니다' : '파일을 여기로 끌어 놓아도 열 수 있어요'}
            </span>
          </div>
          <div className="doc-table-wrap">
            {docs === null ? (
              <div className="empty-state"><div className="spinner" /></div>
            ) : visible.length === 0 ? (
              <div className="empty-state">
                <Icon name={view === 'trash' ? 'trash' : 'doc'} />
                <span>
                  {query ? '검색과 일치하는 문서가 없습니다.' : view === 'trash' ? '휴지통이 비어 있습니다.' : view === 'starred' ? '별표한 문서가 없습니다.' : '아직 연 문서가 없습니다. HWP·HWPX·PDF 파일을 열거나 새 문서를 만들어 보세요.'}
                </span>
                {view === 'home' && !query && <button className="btn btn-primary" onClick={openPicker}><Icon name="open" />문서 열기</button>}
              </div>
            ) : (
              <table className="doc-table">
                <thead>
                  <tr><th>이름</th><th>종류</th><th>수정</th><th style={{ textAlign: 'right' }}>크기</th><th style={{ width: 96 }}><span className="sr-only">작업</span></th></tr>
                </thead>
                <tbody>
                  {visible.map((d) => (
                    <tr key={d.id}>
                      <td>
                        <button className="doc-link" onClick={() => (view === 'trash' ? undefined : open(d))} disabled={view === 'trash'}>
                          <span className={`badge ${d.kind}`}>{d.kind === 'hwp' ? (d.ext === 'hwp' ? 'HWP' : 'HWPX') : 'PDF'}</span>
                          <span className="nm">{d.name}</span>
                          {d.status && <span className={`pill ${/서명/.test(d.status) ? 'ok' : 'accent'}`}>{d.status}</span>}
                        </button>
                      </td>
                      <td className="muted">{d.kind === 'hwp' ? '한글 문서' : `PDF${d.pages ? ` · ${d.pages}쪽` : ''}`}</td>
                      <td>{formatWhen(d.updatedAt)}</td>
                      <td style={{ textAlign: 'right', color: 'var(--ink-2)' }}>{d.size ? formatBytes(d.size) : '—'}</td>
                      <td style={{ textAlign: 'right' }}>
                        {view === 'trash' ? (
                          <span style={{ display: 'inline-flex', gap: 4 }}>
                            <button className="btn btn-soft btn-sm" onClick={() => trash(d, false)}>복원</button>
                            <button className="btn btn-danger btn-sm" onClick={() => setDialog({ purge: d })}>삭제</button>
                          </span>
                        ) : (
                          <span style={{ display: 'inline-flex', gap: 2 }}>
                            <button className={`tb ${d.starred ? 'on' : ''}`} aria-label={d.starred ? '즐겨찾기 해제' : '즐겨찾기'} aria-pressed={!!d.starred} onClick={() => toggleStar(d)}>
                              <Icon name="star" size={16} style={d.starred ? { fill: 'currentColor' } : undefined} />
                            </button>
                            <RowMenu onOpen={() => open(d)} onRename={() => setDialog({ rename: d })} onTrash={() => trash(d, true)} />
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </section>
      </main>

      {dragging && <div className="drop-overlay">놓으면 문서를 엽니다 (HWP · HWPX · PDF)</div>}
      {busy && (
        <div className="modal-back" role="status">
          <div className="modal" style={{ width: 340, padding: 24, alignItems: 'center', gap: 14 }}>
            <div className="spinner" />
            <span>{busy}</span>
          </div>
        </div>
      )}
      <Suspense fallback={null}>
        {dialog === 'merge' && <MergeDialog onClose={() => setDialog(null)} />}
        {dialog === 'convert' && <ConvertDialog onClose={() => setDialog(null)} />}
      </Suspense>
      {dialog && typeof dialog === 'object' && 'rename' in dialog && (
        <RenameDialog doc={dialog.rename} onClose={() => setDialog(null)} onDone={() => { setDialog(null); reload(); }} />
      )}
      {dialog && typeof dialog === 'object' && 'purge' in dialog && (
        <Modal
          title="영구 삭제"
          onClose={() => setDialog(null)}
          footer={<>
            <button className="btn btn-outline" onClick={() => setDialog(null)}>취소</button>
            <button className="btn btn-danger" onClick={async () => { await deleteDoc(dialog.purge.id); setDialog(null); toast('문서를 영구 삭제했습니다.', 'ok'); reload(); }}>영구 삭제</button>
          </>}
        >
          <p style={{ margin: 0 }}>‘{dialog.purge.name}’을(를) 이 브라우저에서 완전히 지웁니다. 되돌릴 수 없습니다.</p>
        </Modal>
      )}
    </div>
  );
}

function NewButton({ onTemplate, onOpen }: { onTemplate: (id: string) => void; onOpen: () => void }) {
  const pop = usePopover();
  return (
    <>
      <button className="btn btn-primary btn-lg" style={{ width: '100%' }} onClick={pop.open} aria-haspopup="menu" aria-expanded={pop.isOpen}>
        <Icon name="plus" />새로 만들기
      </button>
      {pop.isOpen && (
        <Popover anchor={pop.anchor} onClose={pop.close} width={232}>
          <div role="menu">
            {TEMPLATES.map((t) => (
              <button key={t.id} role="menuitem" className="menu-item" onClick={() => { pop.close(); onTemplate(t.id); }}>
                <Icon name={t.id === 'blank' ? 'docPlus' : 'doc'} size={16} />{t.name}
              </button>
            ))}
            <div className="menu-sep" />
            <button role="menuitem" className="menu-item" onClick={() => { pop.close(); onOpen(); }}><Icon name="open" size={16} />파일 열기…</button>
          </div>
        </Popover>
      )}
    </>
  );
}

function RowMenu({ onOpen, onRename, onTrash }: { onOpen: () => void; onRename: () => void; onTrash: () => void }) {
  const pop = usePopover();
  return (
    <>
      <button className="tb" aria-label="더 보기" aria-haspopup="menu" aria-expanded={pop.isOpen} onClick={pop.open}><Icon name="more" /></button>
      {pop.isOpen && (
        <Popover anchor={pop.anchor} onClose={pop.close} align="end" width={180}>
          <div role="menu">
            <button role="menuitem" className="menu-item" onClick={() => { pop.close(); onOpen(); }}><Icon name="open" size={16} />열기</button>
            <button role="menuitem" className="menu-item" onClick={() => { pop.close(); onRename(); }}><Icon name="textEdit" size={16} />이름 바꾸기</button>
            <div className="menu-sep" />
            <button role="menuitem" className="menu-item" style={{ color: 'var(--danger-text)' }} onClick={() => { pop.close(); onTrash(); }}><Icon name="trash" size={16} />휴지통으로 이동</button>
          </div>
        </Popover>
      )}
    </>
  );
}

function RenameDialog({ doc, onClose, onDone }: { doc: DocMeta; onClose: () => void; onDone: () => void }) {
  const [name, setName] = useState(doc.name);
  const save = async () => {
    if (!name.trim()) return;
    await patchMeta(doc.id, { name: name.trim() });
    onDone();
  };
  return (
    <Modal title="이름 바꾸기" onClose={onClose} width={420} footer={<><button className="btn btn-outline" onClick={onClose}>취소</button><button className="btn btn-primary" onClick={save}>바꾸기</button></>}>
      <label className="fl">문서 이름<input className="in" value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && save()} style={{ height: 38, fontSize: 14 }} /></label>
    </Modal>
  );
}
