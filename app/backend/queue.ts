// The Queue's live progress: Dock progress and badge, and `progress` pushes to the windows (PRD P1–P4).
// Engine events come in often; the Queue applies them together at most every 100 ms.

export const FLUSH_MS = 100
/** The progress window closes this long after a Batch is done with no errors. */
export const CLOSE_AFTER_MS = 3000

export interface ProgressEvent {
  id: string
  sent: number
  total: number
}

export interface QueueFile {
  id: string
  name: string
  provider: 's3' | 'r2'
  /** An Upload that a restart left paused comes in paused, with its saved bytes (ticket 12). */
  state?: 'active' | 'paused'
  sent?: number
  total?: number
}

/** One row of the progress window. */
export interface ProgressRow extends Omit<QueueFile, 'state' | 'sent' | 'total'> {
  sent: number
  total: number
  bytesPerSecond: number
  etaSeconds: number | null
  state: 'active' | 'paused' | 'cancelled' | 'done' | 'failed'
}

interface Entry extends Omit<QueueFile, 'state' | 'sent' | 'total'> {
  shown: number
  total: number
  state: ProgressRow['state']
  // For the speed: what was shown at the last flush, and when.
  lastShown: number
  lastAt: number
  bytesPerSecond: number
}

export function createQueue(deps: {
  dock: { progress(value: number | null): void; badge(text: string): void }
  push(event: string, data: unknown): void
  setTimer(ms: number, fire: () => void): void
  /** Milliseconds; for the speed. */
  now?: () => number
  /** The progress window (PRD P2, §10.2). */
  window?: { show(): void; close(): void }
}) {
  const now = deps.now ?? Date.now
  const entries = new Map<string, Entry>()
  let scheduled = false

  function row(e: Entry): ProgressRow {
    const left = e.total - e.shown
    return {
      id: e.id,
      name: e.name,
      provider: e.provider,
      sent: e.shown,
      total: e.total,
      bytesPerSecond: e.bytesPerSecond,
      etaSeconds: e.state === 'active' && e.bytesPerSecond > 0 ? Math.ceil(left / e.bytesPerSecond) : null,
      state: e.state,
    }
  }

  function flush() {
    scheduled = false
    const t = now()
    for (const e of entries.values()) {
      if (e.state !== 'active') e.bytesPerSecond = 0
      else if (t > e.lastAt) e.bytesPerSecond = ((e.shown - e.lastShown) * 1000) / (t - e.lastAt)
      e.lastShown = e.shown
      e.lastAt = t
    }
    deps.push('progress', [...entries.values()].map(row))

    // A paused Upload still waits in the Queue; a cancelled one leaves the totals (ticket 12).
    const all = [...entries.values()].filter((e) => e.state !== 'cancelled')
    const remaining = all.filter((e) => e.state === 'active' || e.state === 'paused').length
    if (remaining === 0) {
      const failed = all.some((e) => e.state === 'failed')
      entries.clear()
      deps.dock.progress(null)
      deps.dock.badge('')
      // Close only when nothing failed and no new drop came in meanwhile.
      if (!failed) deps.setTimer(CLOSE_AFTER_MS, () => entries.size === 0 && deps.window?.close())
      return
    }
    const total = all.reduce((sum, e) => sum + e.total, 0)
    const shown = all.reduce((sum, e) => sum + e.shown, 0)
    deps.dock.progress(total > 0 ? shown / total : 0)
    deps.dock.badge(String(remaining))
  }

  function setState(id: string, state: 'active' | 'paused' | 'cancelled') {
    const entry = entries.get(id)
    if (!entry) return
    entry.state = state
    entry.lastShown = entry.shown
    entry.lastAt = now()
    schedule()
  }

  function schedule() {
    if (scheduled) return
    scheduled = true
    deps.setTimer(FLUSH_MS, flush)
  }

  return {
    add(files: QueueFile[]) {
      deps.window?.show()
      const t = now()
      for (const { state = 'active', sent = 0, total = 0, ...f } of files) {
        entries.set(f.id, { ...f, shown: sent, total, state, lastShown: sent, lastAt: t, bytesPerSecond: 0 })
      }
      schedule()
    },
    progress(e: ProgressEvent) {
      const entry = entries.get(e.id)
      if (!entry) return
      entry.total = e.total
      entry.shown = Math.max(entry.shown, e.sent)
      schedule()
    },
    finish(id: string, ok = true) {
      const entry = entries.get(id)
      if (!entry || entry.state === 'cancelled') return
      entry.state = ok ? 'done' : 'failed'
      if (ok) entry.shown = entry.total
      schedule()
    },
    pause(id: string) {
      setState(id, 'paused')
    },
    resume(id: string) {
      setState(id, 'active')
    },
    cancel(id: string) {
      setState(id, 'cancelled')
    },
    /** The rows now, for a window that opens after the last push (a paused row gets no more pushes). */
    rows(): ProgressRow[] {
      return [...entries.values()].map(row)
    },
  }
}
