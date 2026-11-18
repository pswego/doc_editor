/**
 * 좌표 변환. 주석은 PDF 사용자 공간(pt)에 저장하고,
 * 화면/저장 시에는 "보이는 방향" 좌표(회전 반영)로 바꿔 다룬다.
 */
export interface Vp {
  /** 보이는 크기 (px) */
  width: number;
  height: number;
  scale: number;
  rotation: number;
  toView(x: number, y: number): [number, number];
  toPdf(vx: number, vy: number): [number, number];
}

/** pdf.js PageViewport 와 같은 변환을 직접 계산 (viewBox = [x0,y0,x1,y1]) */
export function makeVp(view: number[], scale: number, rotation: number): Vp {
  const [x0, y0, x1, y1] = view;
  const r = ((rotation % 360) + 360) % 360;
  const cx = (x0 + x1) / 2;
  const cy = (y0 + y1) / 2;
  let a: number, b: number, c: number, d: number;
  switch (r) {
    case 90: a = 0; b = 1; c = 1; d = 0; break;
    case 180: a = -1; b = 0; c = 0; d = 1; break;
    case 270: a = 0; b = -1; c = -1; d = 0; break;
    default: a = 1; b = 0; c = 0; d = -1;
  }
  const w0 = Math.abs(x1 - x0);
  const h0 = Math.abs(y1 - y0);
  const width = (r === 90 || r === 270 ? h0 : w0) * scale;
  const height = (r === 90 || r === 270 ? w0 : h0) * scale;
  // [a b c d e f] — pdf.js 와 같은 식
  const ta = a * scale, tb = b * scale, tc = c * scale, td = d * scale;
  const te = width / 2 - ta * cx - tc * cy;
  const tf = height / 2 - tb * cx - td * cy;
  const det = ta * td - tb * tc;
  return {
    width,
    height,
    scale,
    rotation: r,
    toView: (x, y) => [ta * x + tc * y + te, tb * x + td * y + tf],
    toPdf: (vx, vy) => {
      const px = vx - te, py = vy - tf;
      return [(td * px - tc * py) / det, (-tb * px + ta * py) / det];
    },
  };
}

/** PDF 사각형 [x1,y1,x2,y2] → 보이는 사각형 {x,y,w,h} */
export function rectToView(vp: Vp, r: number[]) {
  const [ax, ay] = vp.toView(r[0], r[1]);
  const [bx, by] = vp.toView(r[2], r[3]);
  return { x: Math.min(ax, bx), y: Math.min(ay, by), w: Math.abs(bx - ax), h: Math.abs(by - ay) };
}

/** 보이는 사각형 → PDF 사각형 (정규화) */
export function viewToRect(vp: Vp, x: number, y: number, w: number, h: number): number[] {
  const [ax, ay] = vp.toPdf(x, y);
  const [bx, by] = vp.toPdf(x + w, y + h);
  return [Math.min(ax, bx), Math.min(ay, by), Math.max(ax, bx), Math.max(ay, by)];
}

export function hexToRgb01(hex: string): [number, number, number] {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex) ?? ['', 'ff', 'd8', '4d'];
  return [parseInt(m[1], 16) / 255, parseInt(m[2], 16) / 255, parseInt(m[3], 16) / 255];
}
