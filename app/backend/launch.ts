// Launch detection (PRD §7.1 D5/D6). tinyjs has no "launched with files" flag, so the Host starts
// hidden and shows the dashboard only if no files arrive within 400 ms (spike 01).

export const LAUNCH_WAIT_MS = 400

/** Drops the paths inside our own app bundle: tinyjs sends its own entry.js to onOpenFiles on every launch. */
export function withoutBundlePaths(paths: string[], bundlePath: string): string[] {
  const inBundle = bundlePath.replace(/\/?$/, '/')
  return paths.filter((p) => !p.startsWith(inBundle))
}

export function createLaunch(deps: {
  bundlePath: string
  showDashboard: () => void
  setTimer: (ms: number, fire: () => void) => void
}) {
  let gotFiles = false
  return {
    init() {
      deps.setTimer(LAUNCH_WAIT_MS, () => {
        if (!gotFiles) deps.showDashboard()
      })
    },
    openFiles(paths: string[]) {
      if (withoutBundlePaths(paths, deps.bundlePath).length > 0) gotFiles = true
    },
  }
}
