/**
 * 형식 변환 테스트: npm test
 * - 편집 문서 → HWPX → 다시 읽기 (왕복 보존)
 * - PDF 저장 엔진 (주석·텍스트 교체·페이지 회전/빈 쪽)
 * - HWP_SAMPLES=폴더 를 주면 그 안의 .hwp 파일을 모두 읽고 HWPX 왕복까지 확인
 */
import './setup-dom';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { writeHwpx } from '../src/hwp/format/hwpx-write';
import { readHwpx } from '../src/hwp/format/hwpx-read';
import { readHwp5 } from '../src/hwp/format/hwp5';
import { DEFAULT_PAGE, type PMNode } from '../src/hwp/format/types';
import { TEMPLATES } from '../src/hwp/templates';
import { buildPdf } from '../src/pdf/save';
import { parseRanges } from '../src/lib/ranges';

let passed = 0;
let failed = 0;
async function test(name: string, fn: () => unknown | Promise<unknown>) {
  try {
    await fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (e) {
    failed++;
    console.log(`  ✗ ${name}\n    ${(e as Error).stack?.split('\n').slice(0, 4).join('\n    ')}`);
  }
}
const text = (n: PMNode): string => (n.text ?? '') + (n.content ?? []).map(text).join('');
const strip = (n: PMNode): PMNode => JSON.parse(JSON.stringify(n, (k, v) => (k === 'src' ? '' : v)));

const sample: PMNode = {
  type: 'doc',
  content: [
    { type: 'heading', attrs: { level: 1, textAlign: 'left', spaceBefore: 12 }, content: [{ type: 'text', text: 'Ⅰ. 개요', marks: [{ type: 'textStyle', attrs: { fontFamily: '함초롬돋움', fontSize: 16 } }] }] },
    {
      type: 'paragraph',
      attrs: { textAlign: 'justify', indentLeft: 10, textIndent: -10, lineHeight: 180, spaceAfter: 4 },
      content: [
        { type: 'text', text: '□ 굵게 ' },
        { type: 'text', text: '강조', marks: [{ type: 'bold' }, { type: 'underline' }] },
        { type: 'text', text: ' 와 색', marks: [{ type: 'textStyle', attrs: { color: '#C2410C', letterSpacing: -5 } }] },
        { type: 'hardBreak' },
        { type: 'text', text: '형광펜', marks: [{ type: 'highlight', attrs: { color: '#FFD84D' } }] },
        { type: 'text', text: '\t탭 & <특수> "문자"' },
      ],
    },
    { type: 'pageBreak' },
    {
      type: 'table',
      content: [
        { type: 'tableRow', content: [
          { type: 'tableHeader', attrs: { colspan: 2, rowspan: 1, colwidth: [120, 200], background: '#EEF1F5' }, content: [{ type: 'paragraph', attrs: { textAlign: 'center' }, content: [{ type: 'text', text: '병합 머리' }] }] },
          { type: 'tableCell', attrs: { colspan: 1, rowspan: 2, colwidth: [100], background: null }, content: [{ type: 'paragraph', attrs: { textAlign: 'justify' }, content: [{ type: 'text', text: '세로 병합' }] }] },
        ] },
        { type: 'tableRow', content: [
          { type: 'tableCell', attrs: { colspan: 1, rowspan: 1, colwidth: [120], background: '#E6F4EC' }, content: [{ type: 'paragraph', attrs: { textAlign: 'justify' }, content: [{ type: 'text', text: 'A' }] }] },
          { type: 'tableCell', attrs: { colspan: 1, rowspan: 1, colwidth: [200], background: null }, content: [{ type: 'paragraph', attrs: { textAlign: 'justify' }, content: [{ type: 'text', text: 'B' }] }] },
        ] },
      ],
    },
    { type: 'paragraph', attrs: { textAlign: 'center' }, content: [{ type: 'text', text: '끝', marks: [{ type: 'superscript' }] }] },
  ],
};

console.log('HWPX 왕복');
await test('글자·문단 모양, 표 병합, 쪽 나누기가 보존된다', async () => {
  const page = { ...DEFAULT_PAGE, landscape: true, marginLeft: 20 };
  const back = await readHwpx(await writeHwpx(sample, page, '테스트'));
  assert.deepEqual(strip(back.doc), strip(sample));
  assert.deepEqual(back.page, page);
});
await test('서식 문서(템플릿)를 모두 저장하고 다시 읽을 수 있다', async () => {
  for (const t of TEMPLATES) {
    const doc = t.build();
    const back = await readHwpx(await writeHwpx(doc, DEFAULT_PAGE, t.name));
    assert.equal(text(back.doc).replace(/\s/g, ''), text(doc).replace(/\s/g, ''), t.name);
  }
});
await test('그림이 BinData 로 들어가고 다시 읽힌다', async () => {
  const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
  const doc: PMNode = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'image', attrs: { src: png, width: 40, height: 40 } }] }] };
  const back = await readHwpx(await writeHwpx(doc, DEFAULT_PAGE));
  const img = back.doc.content![0].content![0];
  assert.equal(img.type, 'image');
  assert.equal(img.attrs!.src, png);
  assert.equal(img.attrs!.width, 40);
});

console.log('PDF 저장');
await test('주석·텍스트 교체·회전·빈 쪽을 반영한 PDF 를 만든다', async () => {
  const src = await PDFDocument.create();
  const f = await src.embedFont(StandardFonts.Helvetica);
  for (let i = 0; i < 2; i++) src.addPage([595, 842]).drawText(`Page ${i + 1}`, { x: 50, y: 780, size: 20, font: f });
  const bytes = await src.save();
  const fetcher = async (p: string) => { const b = readFileSync(join('public', p)); return b.buffer.slice(b.byteOffset, b.byteOffset + b.length) as ArrayBuffer; };
  const now = Date.now();
  const base = { author: '나', createdAt: now, opacity: 1, color: '#DC2626' };
  const out = await buildPdf(
    [{ id: 's', name: 'a.pdf', bytes: bytes.buffer.slice(0) as ArrayBuffer }],
    {
      pages: [{ id: 'b', src: 's', index: 1, rotate: 90 }, { id: 'a', src: 's', index: 0, rotate: 0 }, { id: 'n', src: null, index: 0, rotate: 0, w: 300, h: 400 }],
      annots: [
        { ...base, id: '1', page: 'a', type: 'highlight', rects: [[50, 770, 150, 800]], color: '#FFD84D', opacity: 0.4, comment: '확인' },
        { ...base, id: '2', page: 'b', type: 'text', rect: [100, 100, 300, 140], text: '한글 글상자', fontSize: 14 },
        { ...base, id: '3', page: 'n', type: 'stamp', rect: [50, 50, 200, 90], text: '검토 완료' },
        { ...base, id: '4', page: 'a', type: 'note', rect: [400, 700, 400, 700], comment: '메모' },
      ],
      edits: [{ id: 'e', page: 'a', rect: [50, 775, 130, 800], original: 'Page 1', text: '첫 쪽', fontSize: 20, color: '#000000', x: 50, y: 780, angle: 0, createdAt: now }],
      form: {},
    },
    new Map([['s', 2]]),
    { fontFetcher: fetcher },
  );
  const doc = await PDFDocument.load(out);
  assert.equal(doc.getPageCount(), 3);
  assert.equal(doc.getPage(0).getRotation().angle, 90);
  assert.deepEqual([doc.getPage(2).getWidth(), doc.getPage(2).getHeight()], [300, 400]);
  const annots = doc.getPage(1).node.Annots();
  assert.ok(annots && annots.size() >= 2, '메모 주석이 들어가야 함');
});
await test('쪽 범위 해석', () => {
  assert.deepEqual(parseRanges('1-3, 5', 10), [[0, 1, 2], [4]]);
  assert.deepEqual(parseRanges('8-', 10), [[7, 8, 9]]);
  assert.throws(() => parseRanges('0-2', 10));
  assert.throws(() => parseRanges('3-20', 10));
});

const dir = process.env.HWP_SAMPLES;
if (dir) {
  console.log(`HWP 5.0 표본 (${dir})`);
  const files: string[] = [];
  const walk = (d: string) => readdirSync(d).forEach((f) => { const p = join(d, f); if (statSync(p).isDirectory()) walk(p); else if (/\.hwp$/i.test(p)) files.push(p); });
  walk(dir);
  for (const f of files) {
    await test(f.slice(dir.length).replace(/^\//, ''), async () => {
      const a = readHwp5(new Uint8Array(readFileSync(f)));
      const b = await readHwpx(await writeHwpx(a.doc, a.page));
      assert.equal(text(b.doc).replace(/\s/g, ''), text(a.doc).replace(/\s/g, ''));
    });
  }
}

console.log(`\n${passed} 통과, ${failed} 실패`);
process.exit(failed ? 1 : 0);
