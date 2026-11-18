/** 문서 글꼴 이름 → 화면 표시용 CSS font-family (설치되지 않은 경우 본고딕/본명조 대체) */
const SERIF = /바탕|명조|궁서|신명조|Batang|Myeongjo|Serif|Times|Georgia|Gungsuh|세리프/i;
const MONO = /코딩|Coding|Mono|Courier|Consolas/i;

export function fontStack(name?: string | null): string {
  if (!name) return "'함초롬바탕', 'Noto Serif KR', 'Batang', serif";
  const q = `'${name.replace(/'/g, '')}'`;
  if (MONO.test(name)) return `${q}, 'D2Coding', 'Consolas', monospace`;
  if (SERIF.test(name)) return `${q}, 'Noto Serif KR', 'Batang', serif`;
  return `${q}, 'Noto Sans KR', 'Malgun Gothic', 'Apple SD Gothic Neo', sans-serif`;
}

export function isSerif(name?: string | null) {
  return !name || SERIF.test(name);
}

export const FONT_CHOICES = [
  '함초롬바탕',
  '함초롬돋움',
  '맑은 고딕',
  '바탕',
  '돋움',
  '굴림',
  '궁서',
  '나눔고딕',
  '나눔명조',
  'Noto Sans KR',
  'Noto Serif KR',
  'Arial',
  'Times New Roman',
];

export const SIZE_CHOICES = [8, 9, 10, 10.5, 11, 12, 13, 14, 15, 16, 18, 20, 22, 24, 28, 32, 36, 40, 48, 60, 72];

export const TEXT_COLORS = [
  '#000000', '#3A3F47', '#6E7581', '#A6ADB8', '#FFFFFF',
  '#C2410C', '#DC2626', '#B45309', '#15803D', '#0E7490',
  '#2457D6', '#1D3A8A', '#6B21A8', '#BE185D', '#854D0E',
];

export const HIGHLIGHT_COLORS = ['#FFF176', '#FFD84D', '#B9F6CA', '#C6E2FF', '#F8BBD0', '#E1BEE7', '#FFE0B2', '#E0E0E0'];
