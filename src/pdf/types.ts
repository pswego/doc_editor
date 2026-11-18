export type Tool =
  | 'select' | 'hand'
  | 'highlight' | 'underline' | 'strike'
  | 'note' | 'text'
  | 'ink' | 'rect' | 'ellipse' | 'arrow'
  | 'stamp' | 'signature'
  | 'edit';

/** 페이지 참조: 원본 문서의 몇 번째 쪽인지 + 추가 회전 */
export interface PageRef {
  id: string;
  /** 원본(source) id. null 이면 빈 페이지 */
  src: string | null;
  index: number;
  rotate: number;
  /** 빈 페이지 크기 (pt) */
  w?: number;
  h?: number;
}

export type AnnotType = 'highlight' | 'underline' | 'strike' | 'note' | 'text' | 'ink' | 'rect' | 'ellipse' | 'arrow' | 'stamp' | 'image';

export interface Reply {
  author: string;
  text: string;
  at: number;
}

/** 모든 좌표는 PDF 사용자 공간(pt, 원점 왼쪽 아래, 페이지 회전 전) */
export interface Annot {
  id: string;
  page: string;
  type: AnnotType;
  color: string;
  opacity: number;
  width?: number;
  /** highlight/underline/strike: 줄별 사각형 [x1,y1,x2,y2] */
  rects?: number[][];
  /** ink: 획 목록 */
  points?: number[][][];
  /** rect/ellipse/text/stamp/image/note 위치. arrow 는 [x1,y1,x2,y2] 시작→끝 */
  rect?: number[];
  text?: string;
  fontSize?: number;
  image?: string;
  /** 표시 이름(도장) */
  label?: string;
  /** 선택한 원문 */
  quote?: string;
  comment?: string;
  replies?: Reply[];
  author: string;
  createdAt: number;
}

/** 원본 텍스트 교체: 원래 자리를 흰색으로 덮고 새 글자를 쓴다 */
export interface TextEdit {
  id: string;
  page: string;
  rect: number[];
  original: string;
  text: string;
  fontSize: number;
  color: string;
  bold?: boolean;
  /** 원래 글자의 기준선 시작점과 기울기(도) */
  x?: number;
  y?: number;
  angle?: number;
  createdAt: number;
}

export interface PdfState {
  pages: PageRef[];
  annots: Annot[];
  edits: TextEdit[];
  form: Record<string, string | boolean>;
}

export interface PdfSource {
  id: string;
  name: string;
  bytes: ArrayBuffer;
}

export interface PdfStored {
  sources: PdfSource[];
  state: PdfState;
}
