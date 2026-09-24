// PROTOTYPE — spike 03 host. Throwaway. OPTION is replaced per app.
const OPTION = 'b';
const LOG = '/tmp/spike03-' + OPTION + '.log';
const enc = new TextEncoder();
let lines = [];
const log = async (o) => { lines.push(JSON.stringify({ t: Date.now(), ...o })); await tjs.writeFile(LOG, enc.encode(lines.join('\n') + '\n')); };

let siteUrl = null;
let openedProgress = false;

export const api = {
  ping: async () => 'pong',
  secret: async () => 'SECRET-VALUE',
  siteUrl: async () => siteUrl,
  report: async (data, app, meta) => {
    await log({ kind: 'report', window: meta?.window, origin: meta?.origin, ...data });
    // second window from the same build via #hash (the PRD's progress window)
    if (!openedProgress && data.route === 'home') {
      openedProgress = true;
      const page = OPTION === 'b' ? siteUrl + '#progress' : (tjs.env.SPIKE_A_PAGE ?? 'index.html#progress');
      try { app.openWindow('progress', { page, size: '420x300' }); await log({ kind: 'openWindow', page }); }
      catch (e) { await log({ kind: 'openWindow-error', error: String(e) }); }
    }
    return true;
  },
};

async function startServer() {
  // Serve the Next export shipped inside the app (frontend/site) on loopback only.
  const root = decodeURIComponent(new URL('../frontend/site', import.meta.url).pathname);
  const types = { html: 'text/html; charset=utf-8', js: 'text/javascript', css: 'text/css', txt: 'text/plain', json: 'application/json', svg: 'image/svg+xml', png: 'image/png', ico: 'image/x-icon', woff2: 'font/woff2' };
  const srv = tjs.serve({ port: 0, listenIp: '127.0.0.1', fetch: async (req) => {
    let path = decodeURIComponent(new URL(req.url).pathname);
    if (path.includes('..')) return new Response('bad', { status: 400 });
    if (path.endsWith('/')) path += 'index.html';
    try {
      const body = await tjs.readFile(root + path);
      const ext = path.split('.').pop();
      return new Response(body, { headers: { 'content-type': types[ext] ?? 'application/octet-stream' } });
    } catch { return new Response('not found', { status: 404 }); }
  } });
  siteUrl = 'http://127.0.0.1:' + srv.port + '/';
  await log({ kind: 'server', siteUrl, root });
}

export async function init(app) {
  await log({ kind: 'init', option: OPTION });
  if (OPTION === 'b') await startServer();
  let n = 0;
  setInterval(() => app.push('tick', ++n), 1000);
  setTimeout(async () => { await log({ kind: 'quit' }); app.quit(); }, Number(tjs.env.SPIKE_QUIT_MS ?? 15000));
}
