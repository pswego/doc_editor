import type { Editor } from '@tiptap/core';
import type { PageSetup } from './format/types';

export interface EditorCtx {
  editor: Editor;
  page: PageSetup;
  setPage: (p: PageSetup) => void;
  zoom: number;
  setZoom: (z: number) => void;
  view: 'page' | 'web';
  setView: (v: 'page' | 'web') => void;
  showLeft: boolean;
  setShowLeft: (v: boolean) => void;
  showRight: boolean;
  setShowRight: (v: boolean) => void;
  showRuler: boolean;
  setShowRuler: (v: boolean) => void;
  setRightTab: (t: 'format' | 'find' | 'info') => void;
  saveHwpx: () => void;
  exportPdf: () => void;
  exportText: () => void;
  openFile: () => void;
  newDoc: () => void;
  goHome: () => void;
  insertImage: () => void;
  insertTable: (rows: number, cols: number) => void;
  openFind: (replace?: boolean) => void;
  wordCount: () => void;
  pageSetup: () => void;
  painter: { active: boolean; toggle: () => void };
}

export interface Cmd {
  id: string;
  label: string;
  group: string;
  icon?: string;
  keys?: string;
  keywords?: string;
  run: () => void;
}

export function curBlock(editor: Editor) {
  return editor.state.selection.$from.parent;
}

/** 문단 ↔ 개요 바꾸기 (문단 모양은 유지) */
export function setBlockStyle(editor: Editor, level: 0 | 1 | 2 | 3) {
  const attrs = { ...curBlock(editor).attrs } as Record<string, unknown>;
  delete attrs.level;
  if (level === 0) return editor.chain().focus().setNode('paragraph', attrs).run();
  return editor
    .chain()
    .focus()
    .setNode('heading', { ...attrs, level, spaceBefore: attrs.spaceBefore ?? (level === 1 ? 12 : 6), spaceAfter: attrs.spaceAfter ?? 4 })
    .run();
}

export function buildCommands(c: EditorCtx): Cmd[] {
  const e = c.editor;
  const ch = () => e.chain().focus();
  const list: Cmd[] = [
    { id: 'new', label: '새 문서', group: '파일', icon: 'docPlus', run: c.newDoc },
    { id: 'open', label: '문서 열기', group: '파일', icon: 'open', keys: 'Ctrl+O', run: c.openFile },
    { id: 'save', label: 'HWPX로 저장 (내려받기)', group: '파일', icon: 'save', keys: 'Ctrl+S', keywords: '저장 다운로드', run: c.saveHwpx },
    { id: 'pdf', label: 'PDF로 내보내기', group: '파일', icon: 'download', keywords: '인쇄 출력', run: c.exportPdf },
    { id: 'print', label: '인쇄', group: '파일', icon: 'print', keys: 'Ctrl+P', run: c.exportPdf },
    { id: 'txt', label: '텍스트로 저장', group: '파일', icon: 'text', run: c.exportText },
    { id: 'home', label: '홈으로', group: '파일', icon: 'home', run: c.goHome },
    { id: 'undo', label: '실행 취소', group: '편집', icon: 'undo', keys: 'Ctrl+Z', run: () => ch().undo().run() },
    { id: 'redo', label: '다시 실행', group: '편집', icon: 'redo', keys: 'Ctrl+Y', run: () => ch().redo().run() },
    { id: 'selectAll', label: '모두 선택', group: '편집', keys: 'Ctrl+A', run: () => ch().selectAll().run() },
    { id: 'find', label: '찾기', group: '편집', icon: 'search', keys: 'Ctrl+F', run: () => c.openFind(false) },
    { id: 'replace', label: '찾아 바꾸기', group: '편집', icon: 'convert', keys: 'Ctrl+H', run: () => c.openFind(true) },
    { id: 'painter', label: '모양 복사', group: '편집', icon: 'painter', run: c.painter.toggle },
    { id: 'bold', label: '진하게', group: '글자', keys: 'Ctrl+B', keywords: '굵게 bold', run: () => ch().toggleBold().run() },
    { id: 'italic', label: '기울임', group: '글자', keys: 'Ctrl+I', run: () => ch().toggleItalic().run() },
    { id: 'underline', label: '밑줄', group: '글자', keys: 'Ctrl+U', run: () => ch().toggleUnderline().run() },
    { id: 'strike', label: '취소선', group: '글자', run: () => ch().toggleStrike().run() },
    { id: 'sup', label: '위 첨자', group: '글자', run: () => ch().toggleSuperscript().run() },
    { id: 'sub', label: '아래 첨자', group: '글자', run: () => ch().toggleSubscript().run() },
    { id: 'clearFormat', label: '글자 모양 지우기', group: '글자', keywords: '서식 지우기', run: () => ch().unsetAllMarks().run() },
    { id: 'alignJustify', label: '양쪽 정렬', group: '문단', icon: 'alignJustify', keys: 'Ctrl+J', run: () => ch().setParagraphAttrs({ textAlign: 'justify' }).run() },
    { id: 'alignLeft', label: '왼쪽 정렬', group: '문단', icon: 'alignLeft', keys: 'Ctrl+L', run: () => ch().setParagraphAttrs({ textAlign: 'left' }).run() },
    { id: 'alignCenter', label: '가운데 정렬', group: '문단', icon: 'alignCenter', keys: 'Ctrl+E', run: () => ch().setParagraphAttrs({ textAlign: 'center' }).run() },
    { id: 'alignRight', label: '오른쪽 정렬', group: '문단', icon: 'alignRight', keys: 'Ctrl+R', run: () => ch().setParagraphAttrs({ textAlign: 'right' }).run() },
    { id: 'alignDistribute', label: '배분 정렬', group: '문단', icon: 'alignDistribute', run: () => ch().setParagraphAttrs({ textAlign: 'distribute' }).run() },
    { id: 'bullets', label: '글머리표', group: '문단', icon: 'bullets', run: () => ch().toggleBulletList().run() },
    { id: 'numbers', label: '문단 번호', group: '문단', icon: 'numbers', run: () => ch().toggleOrderedList().run() },
    { id: 'indent', label: '왼쪽 여백 늘리기', group: '문단', icon: 'indent', run: () => ch().adjustIndent(10).run() },
    { id: 'outdent', label: '왼쪽 여백 줄이기', group: '문단', icon: 'outdent', run: () => ch().adjustIndent(-10).run() },
    { id: 'styleBody', label: '스타일: 본문', group: '스타일', keys: 'Ctrl+Alt+0', run: () => setBlockStyle(e, 0) },
    { id: 'styleH1', label: '스타일: 개요 1', group: '스타일', keys: 'Ctrl+Alt+1', run: () => setBlockStyle(e, 1) },
    { id: 'styleH2', label: '스타일: 개요 2', group: '스타일', keys: 'Ctrl+Alt+2', run: () => setBlockStyle(e, 2) },
    { id: 'styleH3', label: '스타일: 개요 3', group: '스타일', keys: 'Ctrl+Alt+3', run: () => setBlockStyle(e, 3) },
    { id: 'table', label: '표 만들기 (3×3)', group: '입력', icon: 'table', keywords: '표 넣기', run: () => c.insertTable(3, 3) },
    { id: 'image', label: '그림 넣기', group: '입력', icon: 'image', keywords: '사진 이미지', run: c.insertImage },
    { id: 'pageBreak', label: '쪽 나누기', group: '입력', icon: 'pageBreak', keys: 'Ctrl+Enter', run: () => ch().insertPageBreak().run() },
    { id: 'hr', label: '가로줄', group: '입력', icon: 'hr', run: () => ch().setHorizontalRule().run() },
    { id: 'quote', label: '인용 문단', group: '입력', run: () => ch().toggleBlockquote().run() },
    { id: 'pageSetup', label: '편집 용지 (쪽 설정)', group: '쪽', icon: 'page', keywords: '용지 여백 A4 방향', run: c.pageSetup },
    { id: 'portrait', label: '용지 방향: 세로', group: '쪽', run: () => c.setPage({ ...c.page, landscape: false }) },
    { id: 'landscape', label: '용지 방향: 가로', group: '쪽', run: () => c.setPage({ ...c.page, landscape: true }) },
    { id: 'wordCount', label: '글자 수 세기 (문서 정보)', group: '검토', icon: 'wordCount', run: c.wordCount },
    { id: 'viewPage', label: '쪽 윤곽 보기', group: '보기', icon: 'page', run: () => c.setView('page') },
    { id: 'viewWeb', label: '웹 보기 (쪽 구분 없이)', group: '보기', icon: 'web', run: () => c.setView('web') },
    { id: 'zoomIn', label: '확대', group: '보기', icon: 'plus', run: () => c.setZoom(Math.min(3, Math.round((c.zoom + 0.1) * 10) / 10)) },
    { id: 'zoomOut', label: '축소', group: '보기', icon: 'minus', run: () => c.setZoom(Math.max(0.3, Math.round((c.zoom - 0.1) * 10) / 10)) },
    { id: 'zoom100', label: '배율 100%', group: '보기', run: () => c.setZoom(1) },
    { id: 'toggleLeft', label: '개요 창 보이기/숨기기', group: '보기', icon: 'panelLeft', run: () => c.setShowLeft(!c.showLeft) },
    { id: 'toggleRight', label: '서식 창 보이기/숨기기', group: '보기', icon: 'panelRight', run: () => c.setShowRight(!c.showRight) },
    { id: 'toggleRuler', label: '눈금자 보이기/숨기기', group: '보기', icon: 'ruler', run: () => c.setShowRuler(!c.showRuler) },
  ];
  return list;
}
