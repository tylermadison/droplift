// PROTOTYPE — spike 01 (Dock drop + launch detection). Throwaway.
// Logs every lifecycle event with ms since backend module load, to a file
// and to the window. Implements the PRD 400 ms launch-detection timer.
const T0 = Date.now();
const LOG = tjs.env.HOME + '/Library/Logs/droplift-spike-01.log';
const enc = new TextEncoder();
const lines = [];
let appRef = null;
let gotFiles = false;
let shown = false;

async function log(ev, data) {
  const line = `${new Date().toISOString()} +${String(Date.now() - T0).padStart(5)}ms pid=${tjs.pid} ${ev}${data !== undefined ? ' ' + JSON.stringify(data) : ''}`;
  lines.push(line);
  try {
    const f = await tjs.open(LOG, 'a');
    await f.write(enc.encode(line + '\n'));
    await f.close();
  } catch (e) { console.log('logfail', String(e)); }
  console.log(line);
  if (appRef) appRef.push('log', { line });
}

log('module-load');

export const api = { getLog: async () => lines };

export function init(app) {
  appRef = app;
  log('init');
  // Plist TinyjsActivation=accessory keeps the window hidden at launch but
  // also starts as a UIElement (no Dock icon). Promote back to a Dock app now.
  app.presence('normal');
  log('presence-normal');
  setTimeout(() => {
    log('timer-400ms', { gotFiles });
    if (!gotFiles && !shown) { shown = true; app.window('main').show(); log('show-dashboard'); }
  }, 400);
}

// tinyjs forwards the backend's own argv (…/Contents/Resources/app/entry.js)
// as an open-files event on every launch. Ignore paths inside our bundle.
const SELF = '.app/Contents/Resources/app/';
export function onOpenFiles(paths, app) {
  const real = paths.filter((p) => !p.includes(SELF));
  log('onOpenFiles', { count: paths.length, real: real.length, paths });
  if (!real.length) return;
  gotFiles = true;
  // D6 workaround probe: a drop of a file named PARK "parks" the app when idle:
  // NSApp-hide first, then order the window in without activating. A later
  // Dock click (reopen) unhides the app and so shows the dashboard.
  if (real.some((p) => p.endsWith('/PARK'))) setTimeout(() => {
    const w = app.window('main');
    // same tick: order in without activating, then NSApp hide at once
    w.show({ activate: false });
    w.hide();                     // main hide() = NSApp hide
    log('park: show(activate:false)+hide same tick');
  }, 1000);
}
export function onSystem(kind, value) { log('onSystem', { kind, value }); }
export function onWindowState(info) { log('onWindowState', info); }
export function onWindowClosed(info) { log('onWindowClosed', info); }
