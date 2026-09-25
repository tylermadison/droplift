// The Queue's live progress: Dock progress and badge, and `progress` pushes to the windows (PRD P1, P3, P4).
// Engine events come in often; the Queue applies them together at most every 100 ms.

export const FLUSH_MS = 100

export interface ProgressEvent {
  id: string
  sent: number
  total: number
}

interface Entry {
  shown: number
  total: number
  done: boolean
}

export function createQueue(deps: {
  dock: { progress(value: number | null): void; badge(text: string): void }
  push(event: string, data: unknown): void
  setTimer(ms: number, fire: () => void): void
}) {
  const entries = new Map<string, Entry>()
  let scheduled = false

  function flush() {
    scheduled = false
    deps.push(
      'progress',
      [...entries].map(([id, e]) => ({ id, sent: e.shown, total: e.total, done: e.done })),
    )
    const active = [...entries.values()]
    const remaining = active.filter((e) => !e.done).length
    if (remaining === 0) {
      entries.clear()
      deps.dock.progress(null)
      deps.dock.badge('')
      return
    }
    const total = active.reduce((sum, e) => sum + e.total, 0)
    const shown = active.reduce((sum, e) => sum + e.shown, 0)
    deps.dock.progress(total > 0 ? shown / total : 0)
    deps.dock.badge(String(remaining))
  }

  function schedule() {
    if (scheduled) return
    scheduled = true
    deps.setTimer(FLUSH_MS, flush)
  }

  return {
    add(ids: string[]) {
      for (const id of ids) entries.set(id, { shown: 0, total: 0, done: false })
      schedule()
    },
    progress(e: ProgressEvent) {
      const entry = entries.get(e.id)
      if (!entry) return
      entry.total = e.total
      entry.shown = Math.max(entry.shown, e.sent)
      schedule()
    },
    finish(id: string) {
      const entry = entries.get(id)
      if (!entry) return
      entry.done = true
      entry.shown = entry.total
      schedule()
    },
  }
}
