import { useState, type ReactNode } from 'react';
import type { Editor } from '@tiptap/core';
import { Icon } from '../components/Icon';
import { Popover, usePopover } from '../components/Popover';
import { ColorGrid } from '../components/ColorGrid';
import { toast } from '../lib/toast';
import { FONT_CHOICES, HIGHLIGHT_COLORS, SIZE_CHOICES, TEXT_COLORS, fontStack } from './fonts';
import { curBlock, setBlockStyle, type EditorCtx } from './commands';
import { DEFAULT_FONT, DEFAULT_LINE_HEIGHT, DEFAULT_SIZE, HEADING_DEFAULTS, PAPERS } from './format/types';

export type RibbonTab = 'file' | 'edit' | 'insert' | 'format' | 'page' | 'review' | 'view' | 'table' | 'image';

const TABS: { id: RibbonTab; label: string }[] = [
  { id: 'file', label: '파일' },
  { id: 'edit', label: '편집' },
  { id: 'insert', label: '입력' },
  { id: 'format', label: '서식' },
  { id: 'page', label: '쪽' },
  { id: 'review', label: '검토' },
  { id: 'view', label: '보기' },
];

/** 현재 커서 위치의 글자 모양 (개요 기본값 반영) */
export function currentText(editor: Editor) {
  const ts = editor.getAttributes('textStyle') as Record<string, unknown>;
  const block = curBlock(editor);
  const hd = block.type.name === 'heading' ? HEADING_DEFAULTS[Number(block.attrs.level)] : undefined;
  return {
    font: (ts.fontFamily as string) || hd?.font || DEFAULT_FONT,
    size: Number(ts.fontSize) || hd?.size || DEFAULT_SIZE,
    color: (ts.color as string) || '#000000',
    spacing: Number(ts.letterSpacing) || 0,
    bold: editor.isActive('bold') || (!!hd?.bold && Number(ts.fontWeight) !== 400),
  };
}

function G({ label, children, last }: { label: string; children: ReactNode; last?: boolean }) {
  return (
    <div className="grp" role="group" aria-label={label} style={last ? { borderRight: 0 } : undefined}>
      {children}
      <span className="gl">{label}</span>
    </div>
  );
}

function Big({ icon, label, onClick, on, disabled }: { icon: string; label: string; onClick: (e: React.MouseEvent<HTMLButtonElement>) => void; on?: boolean; disabled?: boolean }) {
  return (
    <button className={`tb tb-col ${on ? 'on' : ''}`} onClick={onClick} disabled={disabled} aria-pressed={on}>
      <Icon name={icon} />
      {label}
    </button>
  );
}

function T({ label, onClick, on, children, disabled, style }: { label: string; onClick: (e: React.MouseEvent<HTMLButtonElement>) => void; on?: boolean; children: ReactNode; disabled?: boolean; style?: React.CSSProperties }) {
  return (
    <button className={`tb ${on ? 'on' : ''}`} aria-label={label} title={label} aria-pressed={on} onClick={onClick} disabled={disabled} style={style}>
      {children}
    </button>
  );
}

// ── 글자 그룹 ─────────────────────────────
export function FontSelect({ editor, width = 132 }: { editor: Editor; width?: number | string }) {
  const cur = currentText(editor);
  const fonts = FONT_CHOICES.includes(cur.font) ? FONT_CHOICES : [cur.font, ...FONT_CHOICES];
  return (
    <select className="dd" aria-label="글꼴" style={{ width, fontFamily: fontStack(cur.font) }} value={cur.font} onChange={(e) => editor.chain().focus().setTextAttrs({ fontFamily: e.target.value }).run()}>
      {fonts.map((f) => (
        <option key={f} value={f} style={{ fontFamily: fontStack(f) }}>{f}</option>
      ))}
    </select>
  );
}

export function SizeInput({ editor, width = 72 }: { editor: Editor; width?: number }) {
  const cur = currentText(editor);
  const [text, setText] = useState<string | null>(null);
  const apply = (v: string) => {
    const n = parseFloat(v);
    setText(null);
    if (isFinite(n) && n >= 1 && n <= 400) editor.chain().focus().setTextAttrs({ fontSize: Math.round(n * 10) / 10 }).run();
  };
  return (
    <span style={{ position: 'relative', display: 'inline-flex' }}>
      <input
        className="dd"
        aria-label="글자 크기 (pt)"
        list="hwp-sizes"
        style={{ width, cursor: 'text' }}
        value={text ?? `${cur.size}`}
        onChange={(e) => setText(e.target.value)}
        onFocus={(e) => e.currentTarget.select()}
        onBlur={(e) => text != null && apply(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') apply((e.target as HTMLInputElement).value);
          if (e.key === 'Escape') setText(null);
        }}
      />
      <span style={{ position: 'absolute', right: 8, top: 9, fontSize: 12, color: 'var(--ink-2)', pointerEvents: 'none' }}>pt</span>
      <datalist id="hwp-sizes">{SIZE_CHOICES.map((s) => <option key={s} value={s} />)}</datalist>
    </span>
  );
}

export function StyleSelect({ editor, width = 92 }: { editor: Editor; width?: number }) {
  const b = curBlock(editor);
  const v = b.type.name === 'heading' ? String(b.attrs.level) : '0';
  return (
    <select className="dd" aria-label="문단 스타일" style={{ width }} value={v} onChange={(e) => setBlockStyle(editor, Number(e.target.value) as 0 | 1 | 2 | 3)}>
      <option value="0">본문</option>
      <option value="1">개요 1</option>
      <option value="2">개요 2</option>
      <option value="3">개요 3</option>
    </select>
  );
}

function ColorButton({ editor, kind }: { editor: Editor; kind: 'text' | 'highlight' }) {
  const pop = usePopover();
  const cur = currentText(editor);
  const hl = (editor.getAttributes('highlight').color as string) || '#FFD84D';
  const [last, setLast] = useState(kind === 'text' ? '#C2410C' : '#FFD84D');
  const apply = (c: string | null) => {
    pop.close();
    if (kind === 'text') editor.chain().focus().setTextAttrs({ color: c }).run();
    else if (c) editor.chain().focus().setHighlight({ color: c }).run();
    else editor.chain().focus().unsetHighlight().run();
    if (c) setLast(c);
  };
  return (
    <span style={{ display: 'inline-flex' }}>
      <button className="tb" aria-label={kind === 'text' ? `글자 색 (${last})` : `형광펜 (${last})`} title={kind === 'text' ? '글자 색' : '형광펜'} style={{ flexDirection: 'column', gap: 0, paddingTop: 4, minWidth: 28, paddingRight: 2 }} onClick={() => apply(last)}>
        {kind === 'text' ? <span style={{ fontSize: 14, fontWeight: 700, lineHeight: 1 }}>가</span> : <Icon name="highlighter" size={16} />}
        <span className="color-bar" style={{ background: last }} />
      </button>
      <button className="tb" aria-label={kind === 'text' ? '글자 색 고르기' : '형광펜 색 고르기'} aria-haspopup="dialog" style={{ minWidth: 14, padding: 0, width: 14 }} onClick={pop.open}>
        <Icon name="chevDown" size={12} />
      </button>
      {pop.isOpen && (
        <Popover anchor={pop.anchor} onClose={pop.close}>
          <ColorGrid colors={kind === 'text' ? TEXT_COLORS : HIGHLIGHT_COLORS} value={kind === 'text' ? cur.color : hl} onPick={apply} noneLabel={kind === 'text' ? '자동(검정)' : '형광펜 지우기'} />
        </Popover>
      )}
    </span>
  );
}

export function CharGroup({ editor }: { editor: Editor }) {
  const cur = currentText(editor);
  const ch = () => editor.chain().focus();
  return (
    <G label="글자">
      <div className="col">
        <div className="row" style={{ gap: 6 }}>
          <StyleSelect editor={editor} />
          <FontSelect editor={editor} />
          <SizeInput editor={editor} />
        </div>
        <div className="row" style={{ gap: 1 }}>
          <T label="진하게 (Ctrl+B)" on={cur.bold} onClick={() => ch().toggleBold().run()} style={{ fontWeight: 700, fontSize: 15 }}>가</T>
          <T label="기울임 (Ctrl+I)" on={editor.isActive('italic')} onClick={() => ch().toggleItalic().run()} style={{ fontStyle: 'italic', fontSize: 15 }}>가</T>
          <T label="밑줄 (Ctrl+U)" on={editor.isActive('underline')} onClick={() => ch().toggleUnderline().run()} style={{ textDecoration: 'underline', fontSize: 15 }}>가</T>
          <T label="취소선" on={editor.isActive('strike')} onClick={() => ch().toggleStrike().run()} style={{ textDecoration: 'line-through', fontSize: 15 }}>가</T>
          <T label="위 첨자" on={editor.isActive('superscript')} onClick={() => ch().toggleSuperscript().run()}>x<sup style={{ fontSize: 9 }}>2</sup></T>
          <T label="아래 첨자" on={editor.isActive('subscript')} onClick={() => ch().toggleSubscript().run()}>x<sub style={{ fontSize: 9 }}>2</sub></T>
          <ColorButton editor={editor} kind="text" />
          <ColorButton editor={editor} kind="highlight" />
        </div>
      </div>
    </G>
  );
}

function LineHeightButton({ editor }: { editor: Editor }) {
  const pop = usePopover();
  const cur = Number(curBlock(editor).attrs.lineHeight) || DEFAULT_LINE_HEIGHT;
  const set = (v: number) => {
    pop.close();
    editor.chain().focus().setParagraphAttrs({ lineHeight: v === DEFAULT_LINE_HEIGHT ? null : v }).run();
  };
  return (
    <>
      <button className="tb" aria-label={`줄 간격 ${cur}%`} title="줄 간격" aria-haspopup="menu" onClick={pop.open}>
        <Icon name="lineHeight" />
        {cur}%
      </button>
      {pop.isOpen && (
        <Popover anchor={pop.anchor} onClose={pop.close} width={160}>
          <div role="menu">
            {[100, 130, 150, 160, 180, 200, 250, 300].map((v) => (
              <button key={v} role="menuitemradio" aria-checked={v === cur} className="menu-item" onClick={() => set(v)}>
                <span style={{ width: 16 }}>{v === cur ? <Icon name="check" size={14} /> : null}</span>
                {v}%{v === 160 && <span className="kbd" style={{ marginLeft: 'auto' }}>기본</span>}
              </button>
            ))}
          </div>
        </Popover>
      )}
    </>
  );
}

export function ParaGroup({ editor }: { editor: Editor }) {
  const align = (curBlock(editor).attrs.textAlign as string) || 'justify';
  const ch = () => editor.chain().focus();
  const A = (v: string, icon: string, label: string) => (
    <T label={label} on={align === v} onClick={() => ch().setParagraphAttrs({ textAlign: v }).run()}><Icon name={icon} /></T>
  );
  return (
    <G label="문단">
      <div className="col">
        <div className="row" style={{ gap: 1 }}>
          {A('justify', 'alignJustify', '양쪽 정렬 (Ctrl+J)')}
          {A('left', 'alignLeft', '왼쪽 정렬 (Ctrl+L)')}
          {A('center', 'alignCenter', '가운데 정렬 (Ctrl+E)')}
          {A('right', 'alignRight', '오른쪽 정렬 (Ctrl+R)')}
          {A('distribute', 'alignDistribute', '배분 정렬')}
        </div>
        <div className="row" style={{ gap: 1 }}>
          <LineHeightButton editor={editor} />
          <T label="글머리표" on={editor.isActive('bulletList')} onClick={() => ch().toggleBulletList().run()}><Icon name="bullets" /></T>
          <T label="문단 번호" on={editor.isActive('orderedList')} onClick={() => ch().toggleOrderedList().run()}><Icon name="numbers" /></T>
          <T label="왼쪽 여백 줄이기" onClick={() => ch().adjustIndent(-10).run()}><Icon name="outdent" /></T>
          <T label="왼쪽 여백 늘리기" onClick={() => ch().adjustIndent(10).run()}><Icon name="indent" /></T>
        </div>
      </div>
    </G>
  );
}

export function StyleGroup({ editor }: { editor: Editor }) {
  const b = curBlock(editor);
  const lv = b.type.name === 'heading' ? Number(b.attrs.level) : 0;
  const chip = (level: 0 | 1 | 2 | 3, sample: ReactNode, name: string) => (
    <button className={`style-chip ${lv === level ? 'on' : ''}`} aria-pressed={lv === level} onClick={() => setBlockStyle(editor, level)}>
      {sample}
      <small>{name}</small>
    </button>
  );
  return (
    <G label="스타일">
      <div className="row" style={{ gap: 6 }}>
        {chip(0, <span style={{ fontFamily: 'var(--font-doc)', fontSize: 13 }}>가나다</span>, '본문')}
        {chip(1, <span style={{ fontSize: 14, fontWeight: 700 }}>Ⅰ. 가나</span>, '개요 1')}
        {chip(2, <span style={{ fontSize: 13, fontWeight: 700 }}>□ 가나</span>, '개요 2')}
        {chip(3, <span style={{ fontSize: 13, fontWeight: 700, fontFamily: 'var(--font-doc)' }}>○ 가나</span>, '개요 3')}
      </div>
    </G>
  );
}

function TablePicker({ onPick }: { onPick: (r: number, c: number) => void }) {
  const pop = usePopover();
  const [hover, setHover] = useState<[number, number]>([0, 0]);
  return (
    <>
      <Big icon="table" label="표" onClick={pop.open} />
      {pop.isOpen && (
        <Popover anchor={pop.anchor} onClose={pop.close}>
          <div style={{ fontSize: 12, color: 'var(--ink-2)', padding: '2px 4px' }}>{hover[0] ? `${hover[0]}줄 × ${hover[1]}칸` : '줄·칸 수를 고르세요'}</div>
          <div className="table-grid-pick" onMouseLeave={() => setHover([0, 0])}>
            {Array.from({ length: 64 }, (_, i) => {
              const r = Math.floor(i / 8) + 1;
              const c = (i % 8) + 1;
              return (
                <span
                  key={i}
                  role="button"
                  tabIndex={-1}
                  aria-label={`${r}줄 ${c}칸 표`}
                  className={r <= hover[0] && c <= hover[1] ? 'on' : ''}
                  onMouseEnter={() => setHover([r, c])}
                  onClick={() => { pop.close(); onPick(r, c); }}
                />
              );
            })}
          </div>
          <button className="menu-item" onClick={() => { pop.close(); onPick(3, 3); }}><Icon name="table" size={16} />3×3 표 바로 넣기</button>
        </Popover>
      )}
    </>
  );
}

const SYMBOLS = '※○●◎□■△▲▽▼◇◆☆★→←↑↓↔①②③④⑤⑥⑦⑧⑨⑩㉠㉡㉢㉣㈜℃°±×÷≠≤≥∞∴∵‰§¶†‡「」『』《》〈〉【】·…―‘’“”™©®'.split('');

function SymbolPicker({ editor }: { editor: Editor }) {
  const pop = usePopover();
  return (
    <>
      <Big icon="omega" label="문자표" onClick={pop.open} />
      {pop.isOpen && (
        <Popover anchor={pop.anchor} onClose={pop.close} width={300}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(10, 1fr)', gap: 2 }}>
            {SYMBOLS.map((s, i) => (
              <button key={i} className="tb" style={{ minWidth: 0, width: '100%', height: 30, fontSize: 15 }} aria-label={`기호 ${s}`} onClick={() => editor.chain().focus().insertContent(s).run()}>
                {s}
              </button>
            ))}
          </div>
        </Popover>
      )}
    </>
  );
}

function DatePicker({ editor }: { editor: Editor }) {
  const pop = usePopover();
  const d = new Date();
  const y = d.getFullYear(), m = d.getMonth() + 1, day = d.getDate();
  const wd = '일월화수목금토'[d.getDay()];
  const hh = d.getHours(), mm = String(d.getMinutes()).padStart(2, '0');
  const formats = [`${y}. ${m}. ${day}.`, `${y}년 ${m}월 ${day}일`, `${y}년 ${m}월 ${day}일 (${wd})`, `${y}-${String(m).padStart(2, '0')}-${String(day).padStart(2, '0')}`, `${hh < 12 ? '오전' : '오후'} ${hh % 12 || 12}:${mm}`];
  return (
    <>
      <Big icon="calendar" label="날짜" onClick={pop.open} />
      {pop.isOpen && (
        <Popover anchor={pop.anchor} onClose={pop.close} width={220}>
          {formats.map((f) => (
            <button key={f} className="menu-item" onClick={() => { pop.close(); editor.chain().focus().insertContent(f).run(); }}>{f}</button>
          ))}
        </Popover>
      )}
    </>
  );
}

async function pasteFromClipboard(editor: Editor) {
  try {
    if (navigator.clipboard?.read) {
      const items = await navigator.clipboard.read();
      for (const it of items) {
        if (it.types.includes('text/html')) {
          const html = await (await it.getType('text/html')).text();
          editor.chain().focus().insertContent(html).run();
          return;
        }
        const img = it.types.find((t) => t.startsWith('image/'));
        if (img) {
          const blob = await it.getType(img);
          const src = await new Promise<string>((res) => { const r = new FileReader(); r.onload = () => res(r.result as string); r.readAsDataURL(blob); });
          editor.chain().focus().setImage({ src }).run();
          return;
        }
      }
    }
    const text = await navigator.clipboard.readText();
    editor.chain().focus().insertContent(text).run();
  } catch {
    toast('브라우저가 클립보드 읽기를 막았습니다. Ctrl+V 로 붙여 넣어 주세요.', 'info', 4000);
  }
}

// ── 리본 본체 ─────────────────────────────
export function Ribbon({ ctx, tab, setTab }: { ctx: EditorCtx; tab: RibbonTab; setTab: (t: RibbonTab) => void }) {
  const { editor } = ctx;
  const inTable = editor.isActive('table');
  const imgSel = editor.isActive('image');
  const effTab = (tab === 'table' && !inTable) || (tab === 'image' && !imgSel) ? 'edit' : tab;
  const ch = () => editor.chain().focus();
  const exec = (cmd: 'cut' | 'copy') => {
    editor.commands.focus();
    if (!document.execCommand(cmd)) toast(`Ctrl+${cmd === 'cut' ? 'X' : 'C'} 를 사용해 주세요.`, 'info');
  };

  const undoGrp = (
    <G label="실행">
      <div className="row">
        <T label="실행 취소 (Ctrl+Z)" onClick={() => ch().undo().run()} disabled={!editor.can().undo()}><Icon name="undo" /></T>
        <T label="다시 실행 (Ctrl+Y)" onClick={() => ch().redo().run()} disabled={!editor.can().redo()}><Icon name="redo" /></T>
      </div>
    </G>
  );
  const findGrp = (
    <G label="찾기" last>
      <div className="col" style={{ gap: 2 }}>
        <button className="tb" style={{ justifyContent: 'flex-start' }} onClick={() => ctx.openFind(false)}><Icon name="search" />찾기</button>
        <button className="tb" style={{ justifyContent: 'flex-start' }} onClick={() => ctx.openFind(true)}><Icon name="convert" />바꾸기</button>
      </div>
    </G>
  );
  const insertGrp = (label: string) => (
    <G label={label}>
      <div className="row">
        <TablePicker onPick={ctx.insertTable} />
        <Big icon="image" label="그림" onClick={ctx.insertImage} />
        <Big icon="pageBreak" label="쪽 나누기" onClick={() => ch().insertPageBreak().run()} />
      </div>
    </G>
  );

  let body: ReactNode;
  switch (effTab) {
    case 'file':
      body = (
        <>
          <G label="문서">
            <div className="row">
              <Big icon="docPlus" label="새 문서" onClick={ctx.newDoc} />
              <Big icon="open" label="열기" onClick={ctx.openFile} />
            </div>
          </G>
          <G label="저장">
            <div className="row">
              <Big icon="save" label="HWPX 저장" onClick={ctx.saveHwpx} />
              <Big icon="download" label="PDF로" onClick={ctx.exportPdf} />
              <Big icon="text" label="텍스트로" onClick={ctx.exportText} />
            </div>
          </G>
          <G label="출력">
            <div className="row">
              <Big icon="print" label="인쇄" onClick={ctx.exportPdf} />
              <Big icon="page" label="편집 용지" onClick={ctx.pageSetup} />
            </div>
          </G>
          <G label="정보" last>
            <div className="row">
              <Big icon="wordCount" label="문서 정보" onClick={ctx.wordCount} />
              <Big icon="home" label="홈으로" onClick={ctx.goHome} />
            </div>
          </G>
        </>
      );
      break;
    case 'edit':
      body = (
        <>
          {undoGrp}
          <G label="클립보드">
            <div className="row">
              <Big icon="paste" label="붙이기" onClick={() => pasteFromClipboard(editor)} />
              <div className="col" style={{ gap: 0 }}>
                <div className="row">
                  <T label="오려 두기 (Ctrl+X)" onClick={() => exec('cut')}><Icon name="cut" /></T>
                  <T label="복사하기 (Ctrl+C)" onClick={() => exec('copy')}><Icon name="copy" /></T>
                </div>
                <button className={`tb ${ctx.painter.active ? 'on' : ''}`} aria-pressed={ctx.painter.active} style={{ fontSize: 12 }} onClick={ctx.painter.toggle} title="커서 위치의 모양을 복사해 다음에 선택하는 글자에 입힙니다">
                  <Icon name="painter" size={16} />모양 복사
                </button>
              </div>
            </div>
          </G>
          <CharGroup editor={editor} />
          <ParaGroup editor={editor} />
          <StyleGroup editor={editor} />
          {insertGrp('빠른 입력')}
          {findGrp}
        </>
      );
      break;
    case 'insert':
      body = (
        <>
          {insertGrp('개체')}
          <G label="문자">
            <div className="row">
              <SymbolPicker editor={editor} />
              <DatePicker editor={editor} />
            </div>
          </G>
          <G label="모양" last>
            <div className="row">
              <Big icon="hr" label="가로줄" onClick={() => ch().setHorizontalRule().run()} />
              <Big icon="comment" label="인용 문단" on={editor.isActive('blockquote')} onClick={() => ch().toggleBlockquote().run()} />
            </div>
          </G>
        </>
      );
      break;
    case 'format':
      body = (
        <>
          {undoGrp}
          <CharGroup editor={editor} />
          <ParaGroup editor={editor} />
          <StyleGroup editor={editor} />
          <G label="지우기" last>
            <div className="row">
              <Big icon="x" label="모양 지우기" onClick={() => ch().unsetAllMarks().setParagraphAttrs({ textAlign: 'justify', lineHeight: null, indentLeft: null, indentRight: null, textIndent: null, spaceBefore: null, spaceAfter: null }).run()} />
            </div>
          </G>
        </>
      );
      break;
    case 'page': {
      const p = ctx.page;
      const presets: [string, Partial<typeof p>][] = [
        ['기본', { marginTop: 20, marginBottom: 15, marginLeft: 30, marginRight: 30, marginHeader: 15, marginFooter: 15 }],
        ['좁게', { marginTop: 10, marginBottom: 10, marginLeft: 15, marginRight: 15, marginHeader: 10, marginFooter: 10 }],
        ['넓게', { marginTop: 25, marginBottom: 20, marginLeft: 40, marginRight: 40, marginHeader: 15, marginFooter: 15 }],
      ];
      body = (
        <>
          <G label="편집 용지">
            <div className="row">
              <Big icon="page" label="쪽 설정" onClick={ctx.pageSetup} />
              <div className="col">
                <select className="dd" aria-label="용지 종류" value={p.paper in PAPERS ? p.paper : 'custom'} onChange={(e) => {
                  const k = e.target.value;
                  const pp = PAPERS[k];
                  if (pp) ctx.setPage({ ...p, paper: k, width: pp.width, height: pp.height });
                }}>
                  {Object.entries(PAPERS).map(([k, v]) => <option key={k} value={k}>{v.label} ({v.width}×{v.height})</option>)}
                  {!(p.paper in PAPERS) && <option value="custom">사용자 정의 ({p.width}×{p.height})</option>}
                </select>
                <div className="segs" role="radiogroup" aria-label="용지 방향" style={{ width: 160 }}>
                  <button role="radio" aria-checked={!p.landscape} className={`seg ${!p.landscape ? 'on' : ''}`} onClick={() => ctx.setPage({ ...p, landscape: false })}>세로</button>
                  <button role="radio" aria-checked={p.landscape} className={`seg ${p.landscape ? 'on' : ''}`} onClick={() => ctx.setPage({ ...p, landscape: true })}>가로</button>
                </div>
              </div>
            </div>
          </G>
          <G label="용지 여백">
            <div className="row" style={{ gap: 6 }}>
              {presets.map(([name, m]) => {
                const on = Object.entries(m).every(([k, v]) => (p as unknown as Record<string, number>)[k] === v);
                return (
                  <button key={name} className={`style-chip ${on ? 'on' : ''}`} aria-pressed={on} onClick={() => ctx.setPage({ ...p, ...m })}>
                    <span style={{ fontSize: 13, fontWeight: 500 }}>{name}</span>
                    <small>좌우 {m.marginLeft}mm</small>
                  </button>
                );
              })}
            </div>
          </G>
          <G label="나누기" last>
            <div className="row">
              <Big icon="pageBreak" label="쪽 나누기" onClick={() => ch().insertPageBreak().run()} />
            </div>
          </G>
        </>
      );
      break;
    }
    case 'review':
      body = (
        <>
          <G label="정보">
            <div className="row">
              <Big icon="wordCount" label="글자 수" onClick={ctx.wordCount} />
            </div>
          </G>
          {findGrp}
        </>
      );
      break;
    case 'view':
      body = (
        <>
          <G label="문서 보기">
            <div className="row">
              <Big icon="page" label="쪽 윤곽" on={ctx.view === 'page'} onClick={() => ctx.setView('page')} />
              <Big icon="web" label="웹 보기" on={ctx.view === 'web'} onClick={() => ctx.setView('web')} />
            </div>
          </G>
          <G label="배율">
            <div className="row">
              <Big icon="minus" label="축소" onClick={() => ctx.setZoom(Math.max(0.3, Math.round((ctx.zoom - 0.1) * 10) / 10))} />
              <Big icon="plus" label="확대" onClick={() => ctx.setZoom(Math.min(3, Math.round((ctx.zoom + 0.1) * 10) / 10))} />
              <Big icon="fit" label="100%" on={ctx.zoom === 1} onClick={() => ctx.setZoom(1)} />
            </div>
          </G>
          <G label="창" last>
            <div className="row">
              <Big icon="panelLeft" label="개요 창" on={ctx.showLeft} onClick={() => ctx.setShowLeft(!ctx.showLeft)} />
              <Big icon="panelRight" label="서식 창" on={ctx.showRight} onClick={() => ctx.setShowRight(!ctx.showRight)} />
              <Big icon="ruler" label="눈금자" on={ctx.showRuler} onClick={() => ctx.setShowRuler(!ctx.showRuler)} />
            </div>
          </G>
        </>
      );
      break;
    case 'table':
      body = <TableTools editor={editor} />;
      break;
    case 'image':
      body = <ImageTools editor={editor} />;
      break;
  }

  return (
    <>
      <nav className="ribbon-tabs" aria-label="리본 메뉴" role="tablist">
        {TABS.map((t) => (
          <button key={t.id} role="tab" aria-selected={effTab === t.id} className={`tab ${effTab === t.id ? 'on' : ''}`} onClick={() => setTab(t.id)}>{t.label}</button>
        ))}
        {inTable && (
          <button role="tab" aria-selected={effTab === 'table'} className={`tab ctx ${effTab === 'table' ? 'on' : ''}`} onClick={() => setTab('table')}>
            <span className="ctx-tag">상황 탭</span>표 레이아웃
          </button>
        )}
        {imgSel && (
          <button role="tab" aria-selected={effTab === 'image'} className={`tab ctx ${effTab === 'image' ? 'on' : ''}`} onClick={() => setTab('image')}>
            <span className="ctx-tag">상황 탭</span>그림
          </button>
        )}
      </nav>
      <div className="ribbon" role="toolbar" aria-label="도구">{body}</div>
    </>
  );
}

function TableTools({ editor }: { editor: Editor }) {
  const ch = () => editor.chain().focus();
  const pop = usePopover();
  const bg = (editor.getAttributes('tableCell').background || editor.getAttributes('tableHeader').background) as string | undefined;
  return (
    <>
      <G label="줄·칸 추가">
        <div className="row">
          <Big icon="rowAbove" label="위에 줄" onClick={() => ch().addRowBefore().run()} />
          <Big icon="rowBelow" label="아래에 줄" onClick={() => ch().addRowAfter().run()} />
          <Big icon="colLeft" label="왼쪽에 칸" onClick={() => ch().addColumnBefore().run()} />
          <Big icon="colRight" label="오른쪽에 칸" onClick={() => ch().addColumnAfter().run()} />
        </div>
      </G>
      <G label="지우기">
        <div className="row">
          <Big icon="rowDelete" label="줄 지우기" onClick={() => ch().deleteRow().run()} />
          <Big icon="colDelete" label="칸 지우기" onClick={() => ch().deleteColumn().run()} />
          <Big icon="trash" label="표 지우기" onClick={() => ch().deleteTable().run()} />
        </div>
      </G>
      <G label="셀">
        <div className="row">
          <Big icon="merge" label="셀 합치기" disabled={!editor.can().mergeCells()} onClick={() => ch().mergeCells().run()} />
          <Big icon="split" label="셀 나누기" disabled={!editor.can().splitCell()} onClick={() => ch().splitCell().run()} />
          <Big icon="headerRow" label="제목 줄" onClick={() => ch().toggleHeaderRow().run()} />
          <button className="tb tb-col" onClick={pop.open} aria-haspopup="dialog">
            <span style={{ width: 22, height: 22, borderRadius: 5, border: '1px solid var(--line-strong)', background: bg || '#fff' }} />
            셀 배경
          </button>
          {pop.isOpen && (
            <Popover anchor={pop.anchor} onClose={pop.close}>
              <ColorGrid
                colors={['#FFFFFF', '#EEF1F5', '#E2E5EA', '#EAF0FD', '#DCE6FB', '#E6F4EC', '#FDF3D8', '#FCEBDF', '#F1EAFB', '#FFF1A8']}
                value={bg}
                noneLabel="배경 없음"
                onPick={(c) => { pop.close(); ch().setCellAttribute('background', c).run(); }}
              />
            </Popover>
          )}
        </div>
      </G>
    </>
  );
}

function ImageTools({ editor }: { editor: Editor }) {
  const attrs = editor.getAttributes('image');
  const [w, setW] = useState<string | null>(null);
  const apply = (v: string) => {
    setW(null);
    const n = parseInt(v, 10);
    if (n > 8) editor.chain().focus().updateAttributes('image', { width: n, height: null }).run();
  };
  return (
    <>
      <G label="크기">
        <div className="col">
          <label className="fl" style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            너비
            <input className="dd" style={{ width: 90 }} value={w ?? String(attrs.width ?? '')} placeholder="원래 크기" onChange={(e) => setW(e.target.value)} onBlur={(e) => w != null && apply(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && apply((e.target as HTMLInputElement).value)} aria-label="그림 너비 (px)" />
            px
          </label>
          <div className="row" style={{ gap: 4 }}>
            {[25, 50, 75, 100].map((p) => (
              <button key={p} className="btn btn-outline btn-sm" onClick={() => {
                const el = editor.view.dom.querySelector('img.ProseMirror-selectednode') as HTMLImageElement | null;
                const content = editor.view.dom.clientWidth;
                const natural = el?.naturalWidth || content;
                editor.chain().focus().updateAttributes('image', { width: Math.round(Math.min(content, natural) * (p / 100)), height: null }).run();
              }}>{p}%</button>
            ))}
          </div>
        </div>
      </G>
      <G label="정렬">
        <div className="row">
          <Big icon="alignLeft" label="왼쪽" onClick={() => editor.chain().focus().setParagraphAttrs({ textAlign: 'left' }).run()} />
          <Big icon="alignCenter" label="가운데" onClick={() => editor.chain().focus().setParagraphAttrs({ textAlign: 'center' }).run()} />
          <Big icon="alignRight" label="오른쪽" onClick={() => editor.chain().focus().setParagraphAttrs({ textAlign: 'right' }).run()} />
        </div>
      </G>
      <G label="지우기" last>
        <div className="row">
          <Big icon="trash" label="그림 지우기" onClick={() => editor.chain().focus().deleteSelection().run()} />
        </div>
      </G>
    </>
  );
}
