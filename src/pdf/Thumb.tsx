import { memo, useEffect, useRef, useState } from 'react';
import type { PageInfo } from './PageView';
import { makeVp } from './geometry';

/** 작은 페이지 미리보기 (화면에 보일 때만 그림) */
function ThumbImpl({ info, rotate, width }: { info: PageInfo; rotate: number; width: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [vis, setVis] = useState(false);
  const rotation = (((info.baseRotate + rotate) % 360) + 360) % 360;
  const base = makeVp(info.view, 1, rotation);
  const scale = width / base.width;
  const h = base.height * scale;
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver((es) => es.some((e) => e.isIntersecting) && setVis(true), { rootMargin: '300px' });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  useEffect(() => {
    const c = ref.current;
    if (!vis || !info.pdf || !c) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const vp = info.pdf.getViewport({ scale: scale * dpr, rotation });
    c.width = Math.ceil(vp.width);
    c.height = Math.ceil(vp.height);
    const task = info.pdf.render({ canvasContext: c.getContext('2d')!, viewport: vp });
    task.promise.catch(() => {});
    return () => task.cancel();
  }, [vis, info.pdf, scale, rotation]);
  if (!info.pdf) return <span ref={ref as unknown as React.Ref<HTMLSpanElement>} className="blank" style={{ width, height: h, display: 'block' }} aria-hidden="true" />;
  return <canvas ref={ref} style={{ width, height: h }} aria-hidden="true" />;
}

export const Thumb = memo(ThumbImpl);
