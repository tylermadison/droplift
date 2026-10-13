// Drops, Batches, and Uploads (PRD D1, §10.2, P6). The Engine does the transfer; the Host keeps the record.
import type { Db, UploadTarget } from './destinations'
import { EngineExitedError, EngineStoppedError } from './engine-supervisor'
import { formatSize } from './format'
import { withoutBundlePaths } from './launch'
import type { QueueFile } from './queue'

export interface UploadRequest {
  id: string
  path: string
  destination: Omit<UploadTarget, 'destinationId'>
  /** The saved state of a multipart Upload that a crash or a kill stopped; the Engine sends only the missing Parts (PRD U6). */
  resume?: ResumeState
}

export interface ResumeState {
  key: string
  uploadId: string
  hash: string
  parts: { n: number; etag: string; checksum: string }[]
}

/** The Engine's `upload.started` event: what the Host saves to resume a multipart Upload. */
export interface UploadStarted {
  id: string
  key: string
  uploadId: string
  /** The blake3 of the file; a resume of a changed file starts again. */
  hash: string
}

export interface UploadDone {
  id: string
  key: string
  etag: string
  checksum: string
  link: string
  size: number
  /** Retries over all calls of the Upload (PRD U5). */
  retries: number
}

/** A notification for the user; `id` comes back with the action the user picks. */
export interface Notice {
  id: string
  title: string
  body: string
  actions: { id: 'copy' | 'open' | 'dashboard'; title: string }[]
}

export interface UploadEngine {
  /** Sends `upload.resume` when the request has `resume`, else `upload.enqueue`. */
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
  retries: number
}

/** One uploaded Part of a multipart Upload (PRD §9.6). */
export interface Part {
  n: number
  size: number
  startedAt: string
  finishedAt: string
  retries: number
  /** Bytes per second. */
  bps: number
}

/** The Engine's `part.done` event (PRD §9.2). */
export interface PartDone extends Part {
  id: string
  etag: string
  checksum: string
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
    retries INTEGER NOT NULL DEFAULT 0,
    started_at TEXT NOT NULL,
    finished_at TEXT,
    upload_id TEXT,
    hash TEXT
  );
  CREATE TABLE IF NOT EXISTS parts (
    upload_id TEXT NOT NULL,
    n INTEGER NOT NULL,
    size INTEGER NOT NULL,
    started_at TEXT NOT NULL,
    finished_at TEXT NOT NULL,
    retries INTEGER NOT NULL,
    bps REAL NOT NULL,
    etag TEXT,
    checksum TEXT,
    PRIMARY KEY (upload_id, n)
  )`

export const FILES_AT_ONCE = 3

/** Runs at most `max` tasks at the same time; the others wait in order. */
function limiter(max: number) {
  let running = 0
  const waiting: (() => void)[] = []
  return async <T>(task: () => Promise<T>): Promise<T> => {
    if (running >= max) await new Promise<void>((r) => waiting.push(r))
    else running++
    try {
      return await task()
    } finally {
      const next = waiting.shift()
      if (next) next()
      else running--
    }
  }
}

export function createUploads(deps: {
  db: Db
  engine: UploadEngine
  destinations: { defaultForUpload(): Promise<UploadTarget | null>; targetFor(destinationId: number): Promise<UploadTarget | null> }
  clipboard: { writeText(text: string): void }
  bundlePath: string
  /** Live progress (Dock and windows). */
  queue?: { add(files: QueueFile[]): void; finish(id: string, ok: boolean): void }
  notify?: (notice: Notice) => void
  /** Milliseconds; for the Batch duration. */
  now?: () => number
  openUrl?: (url: string) => void
  showDashboard?: () => void
  /** The most files that upload at the same time, over all Drops (PRD U4). */
  filesAtOnce?: number
}) {
  const clock = deps.now ?? Date.now
  const turn = limiter(deps.filesAtOnce ?? FILES_AT_ONCE)
  const { db, engine } = deps
  db.exec(SCHEMA)
  // Columns added after the table first shipped to a development database.
  const columns = db.all<{ name: string }>('PRAGMA table_info(uploads)').map((c) => c.name)
  if (!columns.includes('error_msg')) db.exec('ALTER TABLE uploads ADD COLUMN error_msg TEXT')
  if (!columns.includes('retries')) db.exec('ALTER TABLE uploads ADD COLUMN retries INTEGER NOT NULL DEFAULT 0')
  // Resume state (ticket 11): the multipart upload ID and the file hash; each Part's ETag and CRC32.
  if (!columns.includes('upload_id')) db.exec('ALTER TABLE uploads ADD COLUMN upload_id TEXT')
  if (!columns.includes('hash')) db.exec('ALTER TABLE uploads ADD COLUMN hash TEXT')
  const partColumns = db.all<{ name: string }>('PRAGMA table_info(parts)').map((c) => c.name)
  if (!partColumns.includes('etag')) db.exec('ALTER TABLE parts ADD COLUMN etag TEXT')
  if (!partColumns.includes('checksum')) db.exec('ALTER TABLE parts ADD COLUMN checksum TEXT')

  /** The saved state of a multipart Upload, or undefined when the Engine did not start one. */
  function savedState(id: string): ResumeState | undefined {
    const [row] = db.all<{ key: string | null; upload_id: string | null; hash: string | null }>(
      'SELECT key, upload_id, hash FROM uploads WHERE id = ?',
      [id],
    )
    if (!row?.key || !row.upload_id || !row.hash) return undefined
    const parts = db.all<{ n: number; etag: string; checksum: string }>(
      'SELECT n, etag, checksum FROM parts WHERE upload_id = ? AND etag IS NOT NULL ORDER BY n',
      [id],
    )
    return { key: row.key, uploadId: row.upload_id, hash: row.hash, parts }
  }

  /**
   * Runs one Upload to its end and records it. An Engine exit runs it again from the saved state (PRD U6).
   * Gives the Link, or null when the Upload failed or must wait for the next launch.
   */
  async function run(id: string, path: string, destination: UploadRequest['destination']): Promise<UploadDone | null> {
    let done: UploadDone
    try {
      for (;;) {
        try {
          done = await engine.enqueue({ id, path, destination, resume: savedState(id) })
          break
        } catch (err) {
          if (!(err instanceof EngineExitedError)) throw err
        }
      }
    } catch (err) {
      deps.queue?.finish(id, false)
      // The Engine stopped for good: the Upload stays active, and the next launch resumes it.
      if (err instanceof EngineStoppedError) return null
      const message = err instanceof Error ? err.message : String(err)
      const retries = (err as { data?: { retries?: number } })?.data?.retries ?? 0
      db.run(`UPDATE uploads SET state = 'failed', error_msg = ?, retries = ?, finished_at = ? WHERE id = ?`, [
        message,
        retries,
        new Date().toISOString(),
        id,
      ])
      return null
    }
    deps.queue?.finish(id, true)
    db.run(
      `UPDATE uploads SET state = 'done', key = ?, etag = ?, checksum = ?, link = ?, retries = ?, finished_at = ? WHERE id = ?`,
      [done.key, done.etag, done.checksum, done.link, done.retries, new Date().toISOString(), id],
    )
    return done
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
      const results = (await Promise.all(ids.map((id, i) => turn(() => run(id, paths[i], destination))))).filter(
        (d): d is UploadDone => d !== null,
      )
      const links = results.map((d) => d.link)
      if (links.length === 0) return
      deps.clipboard.writeText(links.join('\n'))
      const bytes = results.reduce((sum, d) => sum + d.size, 0)
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

    /** At launch: every Upload that a crash or a kill left active runs again, from its saved Parts (PRD U6). */
    async resumeActive(): Promise<void> {
      const rows = db.all<{ id: string; path: string; destination_id: number }>(
        "SELECT id, path, destination_id FROM uploads WHERE state = 'active' ORDER BY batch_id, position",
      )
      const runs = await Promise.all(
        rows.map(async (r) => ({ ...r, target: await deps.destinations.targetFor(r.destination_id) })),
      )
      deps.queue?.add(
        runs.filter((r) => r.target).map((r) => ({ id: r.id, name: r.path.split('/').pop()!, provider: r.target!.provider })),
      )
      await Promise.all(
        runs.map(({ id, path, target }) => {
          if (!target) {
            db.run(`UPDATE uploads SET state = 'failed', error_msg = ?, finished_at = ? WHERE id = ?`, [
              'The destination of this upload was deleted.',
              new Date().toISOString(),
              id,
            ])
            return
          }
          const { destinationId: _, ...destination } = target
          return turn(() => run(id, path, destination))
        }),
      )
    },

    /** The Engine started a multipart upload. A new upload ID makes the saved Parts of the old one useless. */
    uploadStarted(e: UploadStarted): void {
      db.run('UPDATE uploads SET key = ?, upload_id = ?, hash = ? WHERE id = ?', [e.key, e.uploadId, e.hash, e.id])
      db.run('DELETE FROM parts WHERE upload_id = ?', [e.id])
    },

    /** The Engine finished one Part of a multipart Upload. */
    partDone(p: PartDone): void {
      db.run(
        `INSERT OR REPLACE INTO parts (upload_id, n, size, started_at, finished_at, retries, bps, etag, checksum) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [p.id, p.n, p.size, p.startedAt, p.finishedAt, p.retries, p.bps, p.etag, p.checksum],
      )
    },

    async listParts(uploadId: string): Promise<Part[]> {
      return db
        .all<{ n: number; size: number; started_at: string; finished_at: string; retries: number; bps: number }>(
          'SELECT n, size, started_at, finished_at, retries, bps FROM parts WHERE upload_id = ? ORDER BY n',
          [uploadId],
        )
        .map((r) => ({ n: r.n, size: r.size, startedAt: r.started_at, finishedAt: r.finished_at, retries: r.retries, bps: r.bps }))
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
          retries: number
        }>('SELECT id, batch_id, path, state, key, link, error_msg, retries FROM uploads ORDER BY batch_id, position')
        .map((r) => ({
          id: r.id,
          batchId: r.batch_id,
          path: r.path,
          state: r.state,
          key: r.key,
          link: r.link,
          error: r.error_msg,
          retries: r.retries,
        }))
    },
  }
}
