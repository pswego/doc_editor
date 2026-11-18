import { createStore, get, set, del, keys, getMany } from 'idb-keyval';

export type DocKind = 'hwp' | 'pdf';

export interface DocMeta {
  id: string;
  name: string;
  kind: DocKind;
  /** 원본 확장자 */
  ext: string;
  createdAt: number;
  updatedAt: number;
  size: number;
  pages?: number;
  starred?: boolean;
  trashed?: boolean;
  /** 표시용 상태 (예: 서명 완료, 주석 3개) */
  status?: string;
  /** 첫 줄 미리보기 */
  preview?: string;
}

const store = createStore('doc-editor', 'docs');

export function newId() {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

export async function listDocs(): Promise<DocMeta[]> {
  const ks = (await keys(store)).filter((k) => typeof k === 'string' && k.startsWith('meta:')) as string[];
  const metas = (await getMany(ks, store)) as DocMeta[];
  return metas.filter(Boolean).sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function getMeta(id: string) {
  return (await get(`meta:${id}`, store)) as DocMeta | undefined;
}

export async function saveMeta(meta: DocMeta) {
  await set(`meta:${meta.id}`, meta, store);
}

export async function patchMeta(id: string, patch: Partial<DocMeta>) {
  const m = await getMeta(id);
  if (m) await saveMeta({ ...m, ...patch });
}

export async function getData<T = unknown>(id: string) {
  return (await get(`data:${id}`, store)) as T | undefined;
}

export async function saveData(id: string, data: unknown) {
  await set(`data:${id}`, data, store);
}

export async function deleteDoc(id: string) {
  await del(`meta:${id}`, store);
  await del(`data:${id}`, store);
  await del(`pdfstate:${id}`, store);
}

/** 문서에 딸린 보조 값 (예: PDF 편집 상태) — 큰 원본과 따로 저장해 자주 쓰기 */
export async function getExtra<T = unknown>(key: string) {
  return (await get(key, store)) as T | undefined;
}
export async function saveExtra(key: string, value: unknown) {
  await set(key, value, store);
}

export async function storageEstimate(): Promise<{ usage: number; quota: number } | null> {
  try {
    if (!navigator.storage?.estimate) return null;
    const e = await navigator.storage.estimate();
    return { usage: e.usage ?? 0, quota: e.quota ?? 0 };
  } catch {
    return null;
  }
}

export function formatBytes(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(1)} GB`;
}

export function formatWhen(t: number) {
  const now = Date.now();
  const diff = now - t;
  if (diff < 60_000) return '방금 전';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}분 전`;
  const d = new Date(t);
  const today = new Date();
  const sameDay = d.toDateString() === today.toDateString();
  const hh = d.getHours();
  const mm = String(d.getMinutes()).padStart(2, '0');
  const ampm = hh < 12 ? '오전' : '오후';
  const h12 = hh % 12 === 0 ? 12 : hh % 12;
  if (sameDay) return `오늘 ${ampm} ${h12}:${mm}`;
  const y = new Date(today);
  y.setDate(today.getDate() - 1);
  if (d.toDateString() === y.toDateString()) return '어제';
  if (d.getFullYear() === today.getFullYear()) return `${d.getMonth() + 1}월 ${d.getDate()}일`;
  return `${d.getFullYear()}. ${d.getMonth() + 1}. ${d.getDate()}.`;
}
