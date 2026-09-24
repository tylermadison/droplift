// PROTOTYPE — spike 02. Throwaway. Host side of the Engine sidecar test:
// private temp dir (0700) → Unix socket (0600) → spawn engine hidden →
// 200+ JSON-RPC pings, in-order check, one unsolicited event.
const enc = new TextEncoder();
const dec = new TextDecoder();
const N = 250;
const LOG = tjs.homeDir + '/Library/Logs/droplift-spike02.log';
const lines = [];
let theApp = null;

async function log(line) {
  const l = new Date().toISOString() + ' ' + line;
  lines.push(l);
  theApp?.push('log', l);
  await tjs.writeFile(LOG, enc.encode(lines.join('\n') + '\n'));
}
const dirOf = (p) => p.slice(0, p.lastIndexOf('/'));
const octal = (m) => (m & 0o777).toString(8);

export const api = {
  history: async () => lines,
};

export function init(app) {
  theApp = app;
  run(app).catch(async (e) => {
    await log('FAIL fatal: ' + (e?.stack || e));
    finish(app, false);
  });
}

async function finish(app, ok) {
  await log(ok ? 'RESULT PASS' : 'RESULT FAIL');
  if (!tjs.env.SPIKE_KEEP_OPEN) setTimeout(() => app.quit(), 1500);
}

async function run(app) {
  await log('exePath=' + tjs.exePath);
  const enginePath = tjs.env.DROPLIFT_ENGINE || dirOf(tjs.exePath) + '/droplift-engine';
  const est = await tjs.stat(enginePath);
  await log(`engine=${enginePath} mode=${octal(est.mode)} size=${est.size}`);

  const dir = await tjs.makeTempDir(tjs.tmpDir + '/droplift-XXXXXX');
  await tjs.chmod(dir, 0o700);
  const dmode = octal((await tjs.stat(dir)).mode);
  await log(`${dmode === '700' ? 'PASS' : 'FAIL'} private dir ${dir} mode=${dmode}`);

  const sock = dir + '/engine.sock';
  const server = await tjs.listen('pipe', sock);
  const info = await server.opened;
  await tjs.chmod(sock, 0o600);
  const smode = octal((await tjs.stat(sock)).mode);
  await log(`${smode === '600' ? 'PASS' : 'FAIL'} socket ${sock} mode=${smode}`);

  const t0 = Date.now();
  const proc = app.spawnHidden([enginePath, '--socket', sock], { stdin: 'ignore', stdout: 'ignore', stderr: 'pipe' });
  await log('spawned engine pid=' + proc.pid);

  const acceptReader = info.readable.getReader();
  const first = await Promise.race([
    acceptReader.read().then(({ value }) => ({ conn: value })),
    proc.wait().then((st) => ({ exited: st })),
    new Promise((r) => setTimeout(() => r({ timeout: true }), 5000)),
  ]);
  if (!first.conn) {
    await log('FAIL engine did not connect: ' + JSON.stringify(first));
    return finish(app, false);
  }
  await log(`PASS engine connected after ${Date.now() - t0} ms`);
  const { readable, writable } = await first.conn.opened;
  const writer = writable.getWriter();
  const reader = readable.getReader();

  const pending = new Map();
  const replies = [];
  let notif = null;
  (async () => {
    let buf = '';
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i); buf = buf.slice(i + 1);
        if (!line.trim()) continue;
        const m = JSON.parse(line);
        if (m.id == null && m.method) { notif = m; log(`event ${m.method} ${JSON.stringify(m.params)}`); continue; }
        replies.push(m.id);
        pending.get(m.id)?.(m);
        pending.delete(m.id);
      }
    }
  })();
  const call = (id, method, params) => new Promise((resolve) => {
    pending.set(id, resolve);
    writer.write(enc.encode(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n'));
  });

  // Burst: N separate writes without awaiting replies (the stdin bug was
  // "only the first write arrives" — this is the direct counter-test).
  const t1 = Date.now();
  const results = await Promise.all(Array.from({ length: N }, (_, k) => call(k + 1, 'ping', { seq: k + 1 })));
  const ms = Date.now() - t1;
  const inOrder = replies.slice(0, N).every((id, k) => id === k + 1);
  const seqOk = results.every((r, k) => r.result?.seq === k + 1 && r.result?.count === k + 1);
  await log(`${results.length === N ? 'PASS' : 'FAIL'} ${results.length}/${N} replies in ${ms} ms`);
  await log(`${inOrder && seqOk ? 'PASS' : 'FAIL'} replies in order, seq/count match`);

  // Sequential round trips too.
  const t2 = Date.now();
  for (let k = 0; k < 50; k++) await call(N + 1 + k, 'ping', { seq: N + 1 + k });
  await log(`PASS 50 sequential round trips, avg ${((Date.now() - t2) / 50).toFixed(2)} ms`);

  await new Promise((r) => setTimeout(r, 100));
  await log(`${notif ? 'PASS' : 'FAIL'} unsolicited event received: ${notif ? notif.method : 'none'}`);

  const bye = await call(9999, 'shutdown', {});
  const st = await proc.wait();
  await log(`engine shutdown count=${bye.result?.count} exit=${JSON.stringify(st)}`);
  await tjs.remove(dir, { recursive: true }).catch(() => {});
  finish(app, results.length === N && inOrder && seqOk && !!notif);
}
