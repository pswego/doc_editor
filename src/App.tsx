import { lazy, Suspense, useEffect, useState } from 'react';
import { Home } from './home/Home';
import { Toasts } from './lib/toast';

const HwpEditor = lazy(() => import('./hwp/HwpEditor'));
const PdfEditor = lazy(() => import('./pdf/PdfEditor'));

type Route = { view: 'home'; section?: string } | { view: 'hwp'; id: string } | { view: 'pdf'; id: string; mode?: string };

function parse(): Route {
  const h = location.hash.replace(/^#\/?/, '');
  const [view, id, mode] = h.split('/');
  if (view === 'hwp' && id) return { view: 'hwp', id };
  if (view === 'pdf' && id) return { view: 'pdf', id, mode };
  return { view: 'home', section: view || undefined };
}

export function Loading({ text = '불러오는 중…' }: { text?: string }) {
  return (
    <div className="loading-screen" role="status">
      <div className="spinner" aria-hidden="true" />
      <span>{text}</span>
    </div>
  );
}

export function App() {
  const [route, setRoute] = useState<Route>(parse);
  useEffect(() => {
    const on = () => setRoute(parse());
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return (
    <>
      <Suspense fallback={<Loading />}>
        {route.view === 'home' && <Home section={route.section} />}
        {route.view === 'hwp' && <HwpEditor key={route.id} id={route.id} />}
        {route.view === 'pdf' && <PdfEditor key={route.id} id={route.id} initialMode={route.mode} />}
      </Suspense>
      <Toasts />
    </>
  );
}
