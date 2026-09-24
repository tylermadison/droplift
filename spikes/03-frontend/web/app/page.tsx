'use client';
// PROTOTYPE — spike 03. One page: API call, pushed event, ECharts, uPlot, #hash views.
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { getTiny, report } from './tiny';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export default function Home() {
  const router = useRouter();
  const [view, setView] = useState('a');
  const [ping, setPing] = useState('…');
  const [tick, setTick] = useState<number | null>(null);
  const echartsEl = useRef<HTMLDivElement>(null);
  const uplotEl = useRef<HTMLDivElement>(null);
  const viewRef = useRef('a');

  useEffect(() => {
    const onHash = () => { const v = location.hash.replace('#', '') || 'a'; viewRef.current = v; setView(v); };
    onHash();
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  useEffect(() => {
    let cancelled = false;
    const status: Record<string, any> = { route: 'home', href: location.href, apiOk: false, eventOk: false, echartsOk: false, uplotOk: false, hashOk: false, errors: [] };
    const tiny = getTiny();
    let off = () => {};
    if (tiny) off = tiny.api.on('tick', (n: number) => { setTick(n); status.eventOk = true; });

    (async () => {
      // 1. API call
      try { const r = await tiny!.api.call('ping', { t: Date.now() }); setPing(String(r)); status.apiOk = r === 'pong'; }
      catch (e) { status.errors.push('ping: ' + e); }

      // 1b. a method the "api" origins gate should deny under Option B
      try { await tiny!.api.call('secret', {}); status.secretCall = 'allowed'; }
      catch (e) { status.secretCall = 'denied: ' + e; }

      // 2. ECharts (tree-shaken, canvas)
      try {
        const echarts = (await import('./echarts-lite')).default;
        const c = echarts.init(echartsEl.current!, undefined, { renderer: 'canvas' });
        c.setOption({ xAxis: { type: 'category', data: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'] }, yAxis: { type: 'value' }, series: [{ type: 'line', data: [5, 20, 36, 10, 10] }] });
        status.echartsOk = !!echartsEl.current!.querySelector('canvas');
      } catch (e) { status.errors.push('echarts: ' + e); }

      // 3. uPlot
      try {
        const uPlot = (await import('uplot')).default;
        const xs = Array.from({ length: 60 }, (_, i) => i);
        new uPlot({ width: 400, height: 150, series: [{}, { label: 'MB/s', stroke: 'steelblue' }] }, [xs, xs.map((x) => Math.sin(x / 5) * 10 + 10)], uplotEl.current!);
        status.uplotOk = !!uplotEl.current!.querySelector('canvas');
      } catch (e) { status.errors.push('uplot: ' + e); }

      // 4. #hash view switch
      location.hash = 'b'; await sleep(200);
      const bOk = viewRef.current === 'b' && !!document.querySelector('[data-view="b"]');
      location.hash = 'a'; await sleep(200);
      status.hashOk = bOk && viewRef.current === 'a';

      // 5. wait for a pushed event
      for (let i = 0; i < 30 && !status.eventOk; i++) await sleep(100);

      status.errors.push(...((window as any).__errs ?? []));
      if (cancelled) return;
      await report(status);

      // 6. extra: client-side route change with next/navigation (not required, informs A vs B)
      await sleep(300);
      router.push('/about/');
      await sleep(3000);
      if (location.pathname.indexOf('/about') < 0) await report({ route: 'about', ok: false, note: 'router.push did not land', href: location.href, errors: (window as any).__errs ?? [] });
    })();
    return () => { cancelled = true; off(); };
  }, [router]);

  return (
    <main>
      <h1>Spike 03 — Next.js {`16`} under tinyjs</h1>
      <p>ping → <b>{ping}</b> · tick → <b>{tick ?? '—'}</b> · view <b>{view}</b></p>
      <nav><a href="#a">View A</a> · <a href="#b">View B</a> · <Link href="/about/">About (next/link)</Link></nav>
      {view === 'b' ? <section data-view="b"><h2>View B</h2></section> : <section data-view="a"><h2>View A</h2></section>}
      <div ref={echartsEl} style={{ width: 400, height: 200 }} />
      <div ref={uplotEl} />
    </main>
  );
}
