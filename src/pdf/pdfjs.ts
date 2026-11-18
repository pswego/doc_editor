import * as pdfjs from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import type { PDFDocumentProxy } from 'pdfjs-dist';

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

const base = new URL('./pdfjs/', document.baseURI).href;

export function loadPdf(bytes: ArrayBuffer): Promise<PDFDocumentProxy> {
  // pdf.js 가 버퍼를 워커로 넘기므로 항상 복사본을 준다
  return pdfjs.getDocument({
    data: new Uint8Array(bytes.slice(0)),
    cMapUrl: base + 'cmaps/',
    cMapPacked: true,
    standardFontDataUrl: base + 'standard_fonts/',
    isEvalSupported: false,
  }).promise;
}

export async function countPdfPages(bytes: ArrayBuffer) {
  const doc = await loadPdf(bytes);
  const n = doc.numPages;
  await doc.destroy();
  return n;
}

export { pdfjs };
export type { PDFDocumentProxy };
