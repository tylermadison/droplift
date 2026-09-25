import { useEffect, useState } from 'react'
import { formatSize } from '../../backend/format'
import type { ProgressRow } from '../../backend/queue'

/** Where rows come from: the Host's `progress` push in the app, a fake in tests. */
export interface ProgressSource {
  onProgress(fn: (rows: ProgressRow[]) => void): () => void
}

const stateLabel: Record<ProgressRow['state'], string> = { active: 'Uploading', done: 'Done', failed: 'Failed' }

export function ProgressWindow({ source }: { source: ProgressSource }) {
  const [rows, setRows] = useState<ProgressRow[]>([])
  useEffect(() => source.onProgress(setRows), [source])

  return (
    <ul className="uploads" aria-label="Uploads">
      {rows.map((r) => {
        const percent = r.total > 0 ? Math.round((r.sent / r.total) * 100) : 0
        return (
          <li key={r.id} className="row" data-state={r.state}>
            <div className="line">
              <span className="name">{r.name}</span>
              <span className="provider">{r.provider.toUpperCase()}</span>
              <span className={`state-${r.state}`}>{stateLabel[r.state]}</span>
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
  )
}
