// Drops, Batches, and Uploads (PRD D1, §10.2, P6). The Engine does the transfer; the Host keeps the record.
import type { Db, UploadTarget } from './destinations'
import { withoutBundlePaths } from './launch'

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
}) {
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

      const results = await Promise.allSettled(ids.map((id, i) => engine.enqueue({ id, path: paths[i], destination })))
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
      if (links.length > 0) deps.clipboard.writeText(links.join('\n'))
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
