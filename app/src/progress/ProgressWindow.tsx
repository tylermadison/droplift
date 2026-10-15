import { useEffect, useState } from 'react'
import { formatSize } from '../../backend/format'
import type { ProgressRow } from '../../backend/queue'

/** Where rows come from: the Host's `progress` push in the app, a fake in tests. */
export interface ProgressSource {
  onProgress(fn: (rows: ProgressRow[]) => void): () => void
  /** The rows now; the window can open after the last push. */
  current(): Promise<ProgressRow[]>
}

/** The buttons of the window: the Host API in the app, a fake in tests (PRD U7, P2). */
export interface ProgressActions {
  pause(id: string): Promise<void>
  resume(id: string): Promise<void>
  cancel(id: string): Promise<void>
  pauseAll(): Promise<void>
  resumeAll(): Promise<void>
}

const stateLabel: Record<ProgressRow['state'], string> = {
  active: 'Uploading',
  paused: 'Paused',
  cancelled: 'Cancelled',
  done: 'Done',
  failed: 'Failed',
}

export function ProgressWindow({ source, actions }: { source: ProgressSource; actions: ProgressActions }) {
  const [rows, setRows] = useState<ProgressRow[]>([])
  useEffect(() => {
    let pushed = false
    const off = source.onProgress((next) => {
      pushed = true
      setRows(next)
    })
    void source.current().then((now) => pushed || setRows(now))
    return off
  }, [source])
  const anyActive = rows.some((r) => r.state === 'active')
  const anyPaused = rows.some((r) => r.state === 'paused')

  return (
    <>
      {(anyActive || anyPaused) && (
        <div className="toolbar">
          {anyActive && (
            <button type="button" onClick={() => void actions.pauseAll()}>
              Pause all
            </button>
          )}
          {anyPaused && (
            <button type="button" onClick={() => void actions.resumeAll()}>
              Resume all
            </button>
          )}
        </div>
      )}
      <ul className="uploads" aria-label="Uploads">
        {rows.map((r) => {
          const percent = r.total > 0 ? Math.round((r.sent / r.total) * 100) : 0
          return (
            <li key={r.id} className="row" data-state={r.state}>
              <div className="line">
                <span className="name">{r.name}</span>
                <span className="provider">{r.provider.toUpperCase()}</span>
                <span className={`state-${r.state}`}>{stateLabel[r.state]}</span>
                {r.state === 'active' && (
                  <button type="button" className="icon" aria-label={`Pause ${r.name}`} title="Pause" onClick={() => void actions.pause(r.id)}>
                    ❙❙
                  </button>
                )}
                {r.state === 'paused' && (
                  <button type="button" className="icon" aria-label={`Resume ${r.name}`} title="Resume" onClick={() => void actions.resume(r.id)}>
                    ▶
                  </button>
                )}
                {(r.state === 'active' || r.state === 'paused') && (
                  <button type="button" className="icon" aria-label={`Cancel ${r.name}`} title="Cancel" onClick={() => void actions.cancel(r.id)}>
                    ✕
                  </button>
                )}
              </div>
              <div
                className="bar"
                role="progressbar"
                aria-label={r.name}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={percent}
              >
                <div className="fill" style={{ width: `${percent}%` }} />
              </div>
              <div className="line detail">
                <span>
                  {formatSize(r.sent)} of {formatSize(r.total)}
                </span>
                {r.state === 'active' && r.bytesPerSecond > 0 && <span>· {formatSize(r.bytesPerSecond)}/s</span>}
                {r.etaSeconds !== null && <span>· {r.etaSeconds} s left</span>}
              </div>
            </li>
          )
        })}
      </ul>
    </>
  )
}
