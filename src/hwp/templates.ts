import type { PMMark, PMNode } from './format/types';

const t = (text: string, marks?: PMMark[]): PMNode => (marks?.length ? { type: 'text', text, marks } : { type: 'text', text });
const B: PMMark = { type: 'bold' };
const style = (attrs: Record<string, unknown>): PMMark => ({ type: 'textStyle', attrs });
const sans = (size: number, extra: Record<string, unknown> = {}) => style({ fontFamily: '함초롬돋움', fontSize: size, ...extra });

const p = (content: (PMNode | string)[] | string = [], attrs: Record<string, unknown> = {}): PMNode => {
  const list = typeof content === 'string' ? [content] : content;
  const nodes = list.filter((x) => x !== '').map((x) => (typeof x === 'string' ? t(x) : x));
  const n: PMNode = { type: 'paragraph', attrs: { textAlign: 'justify', ...attrs } };
  if (nodes.length) n.content = nodes;
  return n;
};
const h = (level: number, text: string, attrs: Record<string, unknown> = {}): PMNode => ({
  type: 'heading',
  attrs: { level, textAlign: 'left', spaceBefore: level === 1 ? 12 : 6, spaceAfter: 4, ...attrs },
  content: [t(text)],
});
const cell = (text: string | PMNode[], opts: { header?: boolean; bg?: string; colspan?: number; rowspan?: number; align?: string; width?: number } = {}): PMNode => ({
  type: opts.header ? 'tableHeader' : 'tableCell',
  attrs: { colspan: opts.colspan ?? 1, rowspan: opts.rowspan ?? 1, colwidth: opts.width ? [opts.width] : null, background: opts.bg ?? null },
  content: [typeof text === 'string' ? p(text ? [t(text, opts.header ? [B] : undefined)] : [], { textAlign: opts.align ?? 'center' }) : p(text, { textAlign: opts.align ?? 'center' })],
});
const row = (...cells: PMNode[]): PMNode => ({ type: 'tableRow', content: cells });
const table = (...rows: PMNode[]): PMNode => ({ type: 'table', content: rows });
const doc = (...content: PMNode[]): PMNode => ({ type: 'doc', content });

export interface Template {
  id: string;
  name: string;
  build: () => PMNode;
}

export const TEMPLATES: Template[] = [
  {
    id: 'blank',
    name: '빈 문서',
    build: () => doc(p()),
  },
  {
    id: 'report',
    name: '보고서 (개조식)',
    build: () =>
      doc(
        p([t('[보고서 제목]', [sans(20), B])], { textAlign: 'center', spaceBefore: 6, spaceAfter: 6 }),
        p([t('[작성일] · [부서명] [작성자]', [style({ fontSize: 9, color: '#3A3F47' })])], { textAlign: 'right', spaceAfter: 14 }),
        h(1, 'Ⅰ. 추진 배경'),
        p('□ [현재 상황과 문제를 한 문장으로 적습니다]', { indentLeft: 0, textIndent: -11, spaceBefore: 4 }),
        p('○ [세부 근거 또는 현황]', { indentLeft: 11, textIndent: -11 }),
        p('○ [세부 근거 또는 현황]', { indentLeft: 11, textIndent: -11 }),
        h(1, 'Ⅱ. 추진 목표'),
        p('□ [달성하려는 목표]', { textIndent: -11, spaceBefore: 4 }),
        table(
          row(cell('구분', { header: true, width: 110 }), cell('현재', { header: true }), cell('개선 후', { header: true })),
          row(cell('[항목]'), cell(''), cell('')),
          row(cell('[항목]'), cell(''), cell('')),
        ),
        h(1, 'Ⅲ. 세부 추진 과제'),
        p('□ ([과제명]) [내용]', { textIndent: -11, spaceBefore: 4 }),
        p('- [세부 내용]', { indentLeft: 22, textIndent: -8 }),
        h(1, 'Ⅳ. 향후 일정'),
        p('□ [일정] : [내용]', { textIndent: -11, spaceBefore: 4 }),
      ),
  },
  {
    id: 'official',
    name: '공문서 (기안문)',
    build: () =>
      doc(
        p([t('[기관명]', [sans(18), B])], { textAlign: 'center', spaceAfter: 12 }),
        p([t('수신  ', [B]), '[수신자]']),
        p([t('(경유)', [B])]),
        p([t('제목  ', [B]), '[제목]'], { spaceAfter: 10 }),
        p('1. [관련 근거]'),
        p('2. [본문 내용]'),
        p('  가. [세부 사항]', { indentLeft: 10 }),
        p('  나. [세부 사항]', { indentLeft: 10 }),
        p('붙임  [첨부 파일명] 1부.  끝.', { spaceBefore: 10 }),
        p(),
        p([t('[발신 명의]', [sans(16), B])], { textAlign: 'center', spaceBefore: 24, spaceAfter: 24 }),
        table(
          row(cell('기안자', { header: true }), cell('검토자', { header: true }), cell('결재권자', { header: true })),
          row(cell('[성명]'), cell('[성명]'), cell('[성명]')),
        ),
        p([t('시행  [문서번호] ([시행일])    접수  ([접수일])', [style({ fontSize: 9 })])], { spaceBefore: 8 }),
        p([t('우 [우편번호]  [주소]  /  전화 [번호]  /  [이메일]', [style({ fontSize: 9 })])]),
      ),
  },
  {
    id: 'resume',
    name: '이력서',
    build: () =>
      doc(
        p([t('이  력  서', [sans(22), B])], { textAlign: 'center', spaceAfter: 14 }),
        table(
          row(cell('사진', { rowspan: 3, width: 110 }), cell('성명', { header: true, width: 90 }), cell('[이름]'), cell('생년월일', { header: true, width: 90 }), cell('[YYYY.MM.DD]')),
          row(cell('연락처', { header: true, width: 90 }), cell('[전화번호]'), cell('이메일', { header: true, width: 90 }), cell('[이메일]')),
          row(cell('주소', { header: true, width: 90 }), cell('[주소]', { colspan: 3, align: 'left' })),
        ),
        h(2, '학력 사항', { spaceBefore: 14 }),
        table(
          row(cell('기간', { header: true, width: 150 }), cell('학교명', { header: true }), cell('전공', { header: true }), cell('비고', { header: true, width: 90 })),
          row(cell('[YYYY.MM ~ YYYY.MM]'), cell(''), cell(''), cell('')),
          row(cell(''), cell(''), cell(''), cell('')),
        ),
        h(2, '경력 사항', { spaceBefore: 14 }),
        table(
          row(cell('기간', { header: true, width: 150 }), cell('회사명', { header: true }), cell('직위', { header: true }), cell('담당 업무', { header: true })),
          row(cell('[YYYY.MM ~ YYYY.MM]'), cell(''), cell(''), cell('')),
          row(cell(''), cell(''), cell(''), cell('')),
        ),
        h(2, '자격 · 어학', { spaceBefore: 14 }),
        table(
          row(cell('취득일', { header: true, width: 150 }), cell('자격/시험명', { header: true }), cell('발행처', { header: true }), cell('등급/점수', { header: true })),
          row(cell(''), cell(''), cell(''), cell('')),
        ),
        p('위 기재 사항은 사실과 틀림이 없습니다.', { textAlign: 'center', spaceBefore: 24 }),
        p('[YYYY년 MM월 DD일]', { textAlign: 'center', spaceBefore: 8 }),
        p('작성자  [이름]  (인)', { textAlign: 'right', spaceBefore: 8 }),
      ),
  },
  {
    id: 'minutes',
    name: '회의록',
    build: () =>
      doc(
        p([t('회  의  록', [sans(20), B])], { textAlign: 'center', spaceAfter: 14 }),
        table(
          row(cell('회의명', { header: true, width: 100 }), cell('[회의명]', { colspan: 3, align: 'left' })),
          row(cell('일시', { header: true, width: 100 }), cell('[YYYY.MM.DD (요일) HH:MM]', { align: 'left' }), cell('장소', { header: true, width: 100 }), cell('[장소]', { align: 'left' })),
          row(cell('참석자', { header: true, width: 100 }), cell('[참석자 명단]', { colspan: 3, align: 'left' })),
        ),
        h(2, '1. 안건', { spaceBefore: 14 }),
        p('가. [안건 1]', { indentLeft: 10 }),
        p('나. [안건 2]', { indentLeft: 10 }),
        h(2, '2. 논의 내용', { spaceBefore: 12 }),
        p('가. [논의 내용]', { indentLeft: 10 }),
        h(2, '3. 결정 사항', { spaceBefore: 12 }),
        p('가. [결정 사항]', { indentLeft: 10 }),
        h(2, '4. 향후 할 일', { spaceBefore: 12 }),
        table(
          row(cell('할 일', { header: true }), cell('담당', { header: true, width: 100 }), cell('기한', { header: true, width: 110 })),
          row(cell(''), cell(''), cell('')),
          row(cell(''), cell(''), cell('')),
        ),
      ),
  },
  {
    id: 'contract',
    name: '계약서',
    build: () =>
      doc(
        p([t('[계약명] 계약서', [sans(20), B])], { textAlign: 'center', spaceAfter: 14 }),
        p('[갑 상호](이하 “갑”이라 한다)와 [을 상호](이하 “을”이라 한다)는 다음과 같이 계약을 체결한다.', { spaceAfter: 8 }),
        p([t('제1조 (목적)', [B])], { spaceBefore: 8 }),
        p('본 계약은 “갑”이 “을”에게 의뢰한 [업무]의 범위와 조건을 정함을 목적으로 한다.'),
        p([t('제2조 (계약 기간)', [B])], { spaceBefore: 8 }),
        p('계약 기간은 [시작일]부터 [종료일]까지로 한다.'),
        p([t('제3조 (계약 금액 및 지급)', [B])], { spaceBefore: 8 }),
        p('① 계약 금액은 금 [금액]원(부가세 [포함/별도])으로 한다.'),
        p('② “갑”은 [지급 조건]에 따라 대금을 지급한다.'),
        p([t('제4조 (비밀 유지)', [B])], { spaceBefore: 8 }),
        p('“을”은 계약 수행 중 알게 된 “갑”의 정보를 제3자에게 누설하여서는 아니 된다.'),
        p([t('제5조 (기타)', [B])], { spaceBefore: 8 }),
        p('본 계약에 정하지 않은 사항은 관계 법령과 상관례에 따른다.'),
        p('본 계약의 성립을 증명하기 위하여 계약서 2부를 작성하여 서명 날인 후 각 1부씩 보관한다.', { spaceBefore: 12 }),
        p('[YYYY년 MM월 DD일]', { textAlign: 'center', spaceBefore: 12, spaceAfter: 12 }),
        table(
          row(cell('“갑”', { header: true, width: 80 }), cell('[상호] / [주소] / 대표 [성명]  (인)', { align: 'left' })),
          row(cell('“을”', { header: true, width: 80 }), cell('[상호] / [주소] / 대표 [성명]  (인)', { align: 'left' })),
        ),
      ),
  },
];
