// Drops, Batches, and Uploads (PRD D1, §10.2, P6). The Engine does the transfer; the Host keeps the record.
import type { Db, UploadTarget } from './destinations'
import { formatSize } from './format'
import { withoutBundlePaths } from './launch'
import type { QueueFile } from './queue'

export interface UploadRequest {
  id: string
  path: string
  destination: Omit<UploadTarget, 'destinationId'>
}

export interface UploadDone {
  id: string
  key: string
  etag: string
  checksum: string
  link: string
  size: number
}

/** A notification for the user; `id` comes back with the action the user picks. */
export interface Notice {
  id: string
  title: string
  body: string
  actions: { id: 'copy' | 'open' | 'dashboard'; title: string }[]
}

export interface UploadEngine {
  enqueue(request: UploadRequest): Promise<UploadDone>
}

export interface UploadSummary {
  id: string
  batchId: number
  path: string
  state: 'active' | 'done' | 'failed'
  key: string | null
  link: string | null
  error: string | null
}

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS batches (
    id INTEGER PRIMARY KEY,
    created_at TEXT NOT NULL,
    source TEXT NOT NULL,
    file_count INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS uploads (
    id TEXT PRIMARY KEY,
    batch_id INTEGER NOT NULL REFERENCES batches(id),
    destination_id INTEGER NOT NULL,
    position INTEGER NOT NULL,
    path TEXT NOT NULL,
    state TEXT NOT NULL,
    key TEXT,
    etag TEXT,
    checksum TEXT,
    link TEXT,
    error_msg TEXT,
    started_at TEXT NOT NULL,
    finished_at TEXT
  )`

export function createUploads(deps: {
  db: Db
  engine: UploadEngine
  destinations: { defaultForUpload(): Promise<UploadTarget | null> }
  clipboard: { writeText(text: string): void }
  bundlePath: string
  /** Live progress (Dock and windows). */
  queue?: { add(files: QueueFile[]): void; finish(id: string, ok: boolean): void }
  notify?: (notice: Notice) => void
  /** Milliseconds; for the Batch duration. */
  now?: () => number
  openUrl?: (url: string) => void
  showDashboard?: () => void
}) {
  const clock = deps.now ?? Date.now
  const { db, engine } = deps
  db.exec(SCHEMA)
  // Column added after the table first shipped to a development database.
  if (!db.all<{ name: string }>('PRAGMA table_info(uploads)').some((c) => c.name === 'error_msg')) {
    db.exec('ALTER TABLE uploads ADD COLUMN error_msg TEXT')
  }

  return {
    /** One Drop: every file goes to the default destination; the Links go to the clipboard. */
    async drop(dropped: string[]): Promise<void> {
      const paths = withoutBundlePaths(dropped, deps.bundlePath)
      if (paths.length === 0) return
      const startedAt = clock()
      const target = await deps.destinations.defaultForUpload()
      if (!target) return
      const now = new Date().toISOString()
      const [batch] = db.all<{ id: number }>(
        'INSERT INTO batches (created_at, source, file_count) VALUES (?, ?, ?) RETURNING id',
        [now, 'drop', paths.length],
      )
      const { destinationId, ...destination } = target
      const ids = paths.map((path, position) => {
        const id = `${batch.id}.${position + 1}`
        db.run(
          `INSERT INTO uploads (id, batch_id, destination_id, position, path, state, started_at)
           VALUES (?, ?, ?, ?, ?, 'active', ?)`,
          [id, batch.id, destinationId, position, path, now],
        )
        return id
      })

      deps.queue?.add(ids.map((id, i) => ({ id, name: paths[i].split('/').pop()!, provider: destination.provider })))
      const results = await Promise.allSettled(
        ids.map((id, i) =>
          engine.enqueue({ id, path: paths[i], destination }).then(
            (done) => (deps.queue?.finish(id, true), done),
            (err) => {
              deps.queue?.finish(id, false)
              throw err
            },
          ),
        ),
      )
      const links: string[] = []
      results.forEach((r, i) => {
        const finishedAt = new Date().toISOString()
        if (r.status === 'fulfilled') {
          const d = r.value
          db.run(
            `UPDATE uploads SET state = 'done', key = ?, etag = ?, checksum = ?, link = ?, finished_at = ? WHERE id = ?`,
            [d.key, d.etag, d.checksum, d.link, finishedAt, ids[i]],
          )
          links.push(d.link)
        } else {
          const message = r.reason instanceof Error ? r.reason.message : String(r.reason)
          db.run(`UPDATE uploads SET state = 'failed', error_msg = ?, finished_at = ? WHERE id = ?`, [message, finishedAt, ids[i]])
        }
      })
      if (links.length === 0) return
      deps.clipboard.writeText(links.join('\n'))
      const bytes = results.reduce((sum, r) => sum + (r.status === 'fulfilled' ? r.value.size : 0), 0)
      const seconds = ((clock() - startedAt) / 1000).toFixed(1)
      deps.notify?.({
        id: `batch.${batch.id}`,
        title: 'Upload done',
        body: `${links.length} ${links.length === 1 ? 'file' : 'files'} uploaded · ${formatSize(bytes)} · ${seconds} s`,
        actions: [
          { id: 'copy', title: 'Copy links' },
          { id: 'open', title: 'Open' },
          { id: 'dashboard', title: 'Show in dashboard' },
        ],
      })
    },

    /** The user picked an action on a Batch notification (PRD P5). */
    async notificationAction(info: { id: string; action: string }): Promise<void> {
      const batchId = Number(info.id.replace(/^batch\./, ''))
      const links = db
        .all<{ link: string }>(
          "SELECT link FROM uploads WHERE batch_id = ? AND state = 'done' ORDER BY position",
          [batchId],
        )
        .map((r) => r.link)
      if (info.action === 'copy') deps.clipboard.writeText(links.join('\n'))
      if (info.action === 'open') links.forEach((link) => deps.openUrl?.(link))
      if (info.action === 'dashboard') deps.showDashboard?.()
    },

    async listUploads(): Promise<UploadSummary[]> {
      return db
        .all<{
          id: string
          batch_id: number
          path: string
          state: UploadSummary['state']
          key: string | null
          link: string | null
          error_msg: string | null
        }>('SELECT id, batch_id, path, state, key, link, error_msg FROM uploads ORDER BY batch_id, position')
        .map((r) => ({
          id: r.id,
          batchId: r.batch_id,
          path: r.path,
          state: r.state,
          key: r.key,
          link: r.link,
          error: r.error_msg,
        }))
    },
  }
}
