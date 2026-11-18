export type FileKind = 'hwp' | 'hwpx' | 'pdf' | 'unknown';

export function extOf(name: string) {
  const m = /\.([a-z0-9]+)$/i.exec(name);
  return m ? m[1].toLowerCase() : '';
}

export function baseName(name: string) {
  return name.replace(/\.[a-z0-9]+$/i, '');
}

export async function detectKind(file: File | Blob, name = (file as File).name ?? ''): Promise<FileKind> {
  const head = new Uint8Array(await file.slice(0, 8).arrayBuffer());
  if (head[0] === 0x25 && head[1] === 0x50 && head[2] === 0x44 && head[3] === 0x46) return 'pdf'; // %PDF
  if (head[0] === 0xd0 && head[1] === 0xcf && head[2] === 0x11 && head[3] === 0xe0) return 'hwp'; // CFB
  if (head[0] === 0x50 && head[1] === 0x4b) return 'hwpx'; // ZIP
  const ext = extOf(name);
  if (ext === 'pdf' || ext === 'hwp' || ext === 'hwpx') return ext;
  return 'unknown';
}

export function pickFiles(accept: string, multiple = false): Promise<File[]> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.multiple = multiple;
    input.style.display = 'none';
    document.body.appendChild(input);
    input.addEventListener('change', () => {
      resolve(Array.from(input.files ?? []));
      input.remove();
    });
    input.addEventListener('cancel', () => {
      resolve([]);
      input.remove();
    });
    input.click();
  });
}

export function downloadBlob(data: Blob | Uint8Array | ArrayBuffer | string, name: string, type = 'application/octet-stream') {
  const blob = data instanceof Blob ? data : new Blob([data as BlobPart], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export function readAsDataURL(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as string);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}

export const ACCEPT_ALL = '.hwp,.hwpx,.pdf,application/pdf';
