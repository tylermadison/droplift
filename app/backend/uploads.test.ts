import { describe, expect, test } from 'vitest'
import { createDestinationsApi, type DestinationDraft } from './destinations'
import { createQueue } from './queue'
import { EngineExitedError, EngineStoppedError } from './engine-supervisor'
import { createUploads, type Notice, type UploadEngine, type UploadRequest } from './uploads'
import { memoryDb, memorySecrets } from './test-fakes'

const BUNDLE = '/Applications/Droplift.app'

const r2Draft: DestinationDraft = {
  provider: 'r2',
  name: 'personal',
  bucket: 'public-assets',
  accountId: '0123456789abcdef0123456789abcdef',
  credentials: { kind: 'keys', accessKeyId: 'AKIDEXAMPLE', secretAccessKey: 'wJalrXUtnFEMI/K7MDENG' },
  publicBaseUrl: 'https://cdn.example.com',
}

/** An engine that "uploads" instantly and links to the file name. */
const instantEngine: UploadEngine = {
  enqueue: async (req) => ({
    id: req.id,
    key: req.path.split('/').pop()!,
    etag: 'etag',
    checksum: 'crc',
    link: 'https://cdn.example.com/' + req.path.split('/').pop(),
    size: 42_000_000,
    retries: 0,
  }),
}

async function setup(
  engine: Pick<UploadEngine, 'enqueue'> & Partial<UploadEngine> = instantEngine,
  queue?: ReturnType<typeof createQueue>,
  clock: () => number = () => 0,
  db = memoryDb(),
  extra: Partial<Parameters<typeof createUploads>[0]> = {},
) {
  const destinations = createDestinationsApi({ db, secrets: memorySecrets(), engine: { testDestination: async () => ({ ok: true }) } })
  if ((await destinations.listDestinations()).length === 0) {
    await destinations.testDestination(r2Draft)
    await destinations.saveDestination(r2Draft)
  }
  const clipboard: string[] = []
  const notifications: Notice[] = []
  const opened: string[] = []
  const shown: string[] = []
  const uploads = createUploads({
    db,
    engine: { pause: async () => {}, cancel: async () => {}, ...engine },
    destinations,
    clipboard: { writeText: (text) => void clipboard.push(text) },
    bundlePath: BUNDLE,
    queue,
    notify: (n) => void notifications.push(n),
    now: clock,
    openUrl: (url) => void opened.push(url),
    showDashboard: () => void shown.push('dashboard'),
    ...extra,
  })
  return { uploads, clipboard, notifications, opened, shown }
}

describe('drop', () => {
  test('dropping 2 files makes one batch of 2 uploads and puts one link per line on the clipboard', async () => {
    const { uploads, clipboard } = await setup()

    await uploads.drop(['/Users/me/Desktop/a.png', '/Users/me/Desktop/b.png'])

    const list = await uploads.listUploads()
    expect(list).toHaveLength(2)
    expect(new Set(list.map((u) => u.batchId)).size).toBe(1)
    expect(list.map((u) => u.state)).toEqual(['done', 'done'])
    expect(clipboard).toEqual(['https://cdn.example.com/a.png\nhttps://cdn.example.com/b.png'])
  })

  test('one file puts only its link on the clipboard', async () => {
    const { uploads, clipboard } = await setup()

    await uploads.drop(['/Users/me/Desktop/a.png'])

    expect(clipboard).toEqual(['https://cdn.example.com/a.png'])
  })

  test('a failed upload is marked failed with its message, and the others still finish', async () => {
    const { uploads, clipboard } = await setup({
      enqueue: async (req) => {
        if (req.path.endsWith('bad.png')) throw new Error('personal cannot write to public-assets.')
        return instantEngine.enqueue(req)
      },
    })

    await uploads.drop(['/Users/me/Desktop/bad.png', '/Users/me/Desktop/good.png'])

    expect((await uploads.listUploads()).map((u) => [u.state, u.error])).toEqual([
      ['failed', 'personal cannot write to public-assets.'],
      ['done', null],
    ])
    expect(clipboard).toEqual(['https://cdn.example.com/good.png'])
  })

  test('a drop shows its files on the Dock badge while they upload, then clears', async () => {
    const dock = { progress: [] as (number | null)[], badge: [] as string[] }
    let flushes: (() => void)[] = []
    const tick = () => {
      const due = flushes
      flushes = []
      due.forEach((f) => f())
    }
    const queue = createQueue({
      dock: { progress: (v) => void dock.progress.push(v), badge: (t) => void dock.badge.push(t) },
      push: () => {},
      setTimer: (_ms, fire) => void flushes.push(fire),
    })
    let release!: () => void
    let started!: () => void
    const held = new Promise<void>((r) => (release = r))
    const uploading = new Promise<void>((r) => (started = r))
    const engine: UploadEngine = { enqueue: async (req) => (started(), await held, instantEngine.enqueue(req)) }
    const { uploads } = await setup(engine, queue)

    const dropping = uploads.drop(['/Users/me/Desktop/a.png', '/Users/me/Desktop/b.png'])
    await uploading
    tick()
    release()
    await dropping
    tick()

    expect(dock.badge).toEqual(['2', ''])
    expect(dock.progress.at(-1)).toBeNull()
  })

  test('paths inside the app bundle are not uploads', async () => {
    const { uploads, clipboard } = await setup()

    await uploads.drop([`${BUNDLE}/Contents/Resources/app/entry.js`])
    await uploads.drop([`${BUNDLE}/Contents/Resources/app/entry.js`, '/Users/me/Desktop/a.png'])

    expect((await uploads.listUploads()).map((u) => u.path)).toEqual(['/Users/me/Desktop/a.png'])
    expect(clipboard).toEqual(['https://cdn.example.com/a.png'])
  })
})

describe('concurrency', () => {
  /** An engine that holds each file until the test releases it, and counts the files in flight. */
  function heldEngine() {
    const held: (() => void)[] = []
    const engine = {
      inFlight: 0,
      most: 0,
      async enqueue(req: Parameters<UploadEngine['enqueue']>[0]) {
        engine.inFlight++
        engine.most = Math.max(engine.most, engine.inFlight)
        await new Promise<void>((r) => held.push(r))
        engine.inFlight--
        return instantEngine.enqueue(req)
      },
      /** Lets the files in flight finish, one turn at a time, until the drop is done. */
      async releaseAll(done: Promise<void>) {
        let finished = false
        done.then(() => (finished = true))
        while (!finished) {
          held.splice(0).forEach((r) => r())
          await new Promise((r) => setTimeout(r, 0))
        }
      },
    }
    return engine
  }

  test('at most 3 files upload at the same time, and the others wait their turn', async () => {
    const engine = heldEngine()
    const { uploads } = await setup(engine)
    const paths = ['a', 'b', 'c', 'd', 'e'].map((n) => `/Users/me/Desktop/${n}.png`)

    const dropping = uploads.drop(paths)
    await engine.releaseAll(dropping)

    expect(engine.most).toBe(3)
    expect((await uploads.listUploads()).map((u) => u.state)).toEqual(['done', 'done', 'done', 'done', 'done'])
  })

  test('the limit of 3 files is for all drops together', async () => {
    const engine = heldEngine()
    const { uploads } = await setup(engine)

    const first = uploads.drop(['/Users/me/Desktop/a.png', '/Users/me/Desktop/b.png'])
    const second = uploads.drop(['/Users/me/Desktop/c.png', '/Users/me/Desktop/d.png'])
    await engine.releaseAll(Promise.all([first, second]).then(() => {}))

    expect(engine.most).toBe(3)
  })
})

describe('retries', () => {
  test('an Upload keeps the retry count that the Engine gives', async () => {
    const { uploads } = await setup({ enqueue: async (req) => ({ ...(await instantEngine.enqueue(req)), retries: 3 }) })

    await uploads.drop(['/Users/me/Desktop/video.mov'])

    expect((await uploads.listUploads()).map((u) => u.retries)).toEqual([3])
  })

  test('a failed Upload keeps the retry count from the Engine error', async () => {
    const { uploads } = await setup({
      enqueue: async () => {
        throw Object.assign(new Error('The service is not available.'), { data: { retries: 7 } })
      },
    })

    await uploads.drop(['/Users/me/Desktop/video.mov'])

    expect((await uploads.listUploads()).map((u) => [u.state, u.retries])).toEqual([['failed', 7]])
  })
})

describe('parts', () => {
  test('each part.done from the Engine is kept as a Part of its Upload', async () => {
    let uploads!: Awaited<ReturnType<typeof setup>>['uploads']
    const engine: UploadEngine = {
      async enqueue(req) {
        uploads.partDone({ id: req.id, n: 2, size: 4_194_304, etag: 'part-2', checksum: 'crc-2', startedAt: '2026-09-24T21:00:00.500Z', finishedAt: '2026-09-24T21:00:01.500Z', retries: 1, bps: 4_194_304 })
        uploads.partDone({ id: req.id, n: 1, size: 8_388_608, etag: 'part-1', checksum: 'crc-1', startedAt: '2026-09-24T21:00:00Z', finishedAt: '2026-09-24T21:00:02Z', retries: 0, bps: 4_194_304 })
        return instantEngine.enqueue(req)
      },
    }
    ;({ uploads } = await setup(engine))

    await uploads.drop(['/Users/me/Desktop/video.mov'])
    const [upload] = await uploads.listUploads()

    expect(await uploads.listParts(upload.id)).toEqual([
      { n: 1, size: 8_388_608, startedAt: '2026-09-24T21:00:00Z', finishedAt: '2026-09-24T21:00:02Z', retries: 0, bps: 4_194_304 },
      { n: 2, size: 4_194_304, startedAt: '2026-09-24T21:00:00.500Z', finishedAt: '2026-09-24T21:00:01.500Z', retries: 1, bps: 4_194_304 },
    ])
  })
})

describe('batch notification', () => {
  test('a finished batch sends one notification with count, size, duration, and 3 actions', async () => {
    const times = [0, 6200]
    const { uploads, notifications } = await setup(instantEngine, undefined, () => times.shift() ?? 6200)

    await uploads.drop(['/Users/me/Desktop/a.png', '/Users/me/Desktop/b.png'])

    expect(notifications).toEqual([
      {
        id: 'batch.1',
        title: 'Upload done',
        body: '2 files uploaded · 84 MB · 6.2 s',
        actions: [
          { id: 'copy', title: 'Copy links' },
          { id: 'open', title: 'Open' },
          { id: 'dashboard', title: 'Show in dashboard' },
        ],
      },
    ])
  })

  test('one small file reads "1 file" with one decimal for the size', async () => {
    const times = [0, 800]
    const oneFile: UploadEngine = { enqueue: async (req) => ({ ...(await instantEngine.enqueue(req)), size: 2_500_000 }) }
    const { uploads, notifications } = await setup(oneFile, undefined, () => times.shift() ?? 800)

    await uploads.drop(['/Users/me/Desktop/a.png'])

    expect(notifications.map((n) => n.body)).toEqual(['1 file uploaded · 2.5 MB · 0.8 s'])
  })
})

describe('notification actions', () => {
  test('Copy links puts the batch links on the clipboard again', async () => {
    const { uploads, clipboard } = await setup()
    await uploads.drop(['/Users/me/Desktop/a.png', '/Users/me/Desktop/b.png'])
    clipboard.length = 0

    await uploads.notificationAction({ id: 'batch.1', action: 'copy' })

    expect(clipboard).toEqual(['https://cdn.example.com/a.png\nhttps://cdn.example.com/b.png'])
  })

  test('Open opens each link of the batch in the browser', async () => {
    const { uploads, opened } = await setup()
    await uploads.drop(['/Users/me/Desktop/a.png', '/Users/me/Desktop/b.png'])

    await uploads.notificationAction({ id: 'batch.1', action: 'open' })

    expect(opened).toEqual(['https://cdn.example.com/a.png', 'https://cdn.example.com/b.png'])
  })

  test('Show in dashboard shows the dashboard', async () => {
    const { uploads, shown } = await setup()
    await uploads.drop(['/Users/me/Desktop/a.png'])

    await uploads.notificationAction({ id: 'batch.1', action: 'dashboard' })

    expect(shown).toEqual(['dashboard'])
  })
})

describe('resume (ticket 11)', () => {
  const started = { id: '1.1', key: '2026/09/video.mov', uploadId: 'up-1', hash: 'b3-hash' }
  const part1 = { n: 1, size: 8_388_608, etag: 'part-1', checksum: 'crc-1', startedAt: '2026-10-13T10:00:00Z', finishedAt: '2026-10-13T10:00:02Z', retries: 0, bps: 4_194_304 }
  const done = { id: '1.1', key: '2026/09/video.mov', etag: 'whole', checksum: 'crc-3', link: 'https://cdn.example.com/video.mov', size: 20_971_520, retries: 0 }

  test('the Engine exits during an Upload: the Upload runs again with the saved state, and is not marked failed', async () => {
    const requests: UploadRequest[] = []
    let uploads!: Awaited<ReturnType<typeof setup>>['uploads']
    const engine: UploadEngine = {
      enqueue: async (req) => {
        requests.push(req)
        if (requests.length === 1) {
          uploads.uploadStarted(started)
          uploads.partDone({ id: req.id, ...part1 })
          throw new EngineExitedError()
        }
        return done
      },
    }
    const s = await setup(engine)
    uploads = s.uploads

    await uploads.drop(['/Users/me/Movies/video.mov'])

    expect(requests.map((r) => r.resume)).toEqual([
      undefined,
      { key: '2026/09/video.mov', uploadId: 'up-1', hash: 'b3-hash', parts: [{ n: 1, etag: 'part-1', checksum: 'crc-1' }] },
    ])
    const [upload] = await uploads.listUploads()
    expect(upload).toMatchObject({ state: 'done', key: '2026/09/video.mov', error: null })
    expect(s.clipboard).toEqual(['https://cdn.example.com/video.mov'])
  })

  test('at launch, an Upload that a kill left active resumes from its saved Parts', async () => {
    const db = memoryDb()
    // First run: the app is killed after Part 1; the Engine never answers.
    let first!: Awaited<ReturnType<typeof setup>>['uploads']
    const killed: UploadEngine = {
      enqueue: (req) => {
        first.uploadStarted(started)
        first.partDone({ id: req.id, ...part1 })
        return new Promise(() => {})
      },
    }
    first = (await setup(killed, undefined, undefined, db)).uploads
    void first.drop(['/Users/me/Movies/video.mov'])
    await new Promise((r) => setTimeout(r, 0))

    // Next launch.
    const requests: UploadRequest[] = []
    const { uploads } = await setup({ enqueue: async (req) => (requests.push(req), done) }, undefined, undefined, db)
    await uploads.resumeActive()

    expect(requests).toEqual([
      expect.objectContaining({
        id: '1.1',
        path: '/Users/me/Movies/video.mov',
        destination: expect.objectContaining({ bucket: 'public-assets', provider: 'r2' }),
        resume: { key: '2026/09/video.mov', uploadId: 'up-1', hash: 'b3-hash', parts: [{ n: 1, etag: 'part-1', checksum: 'crc-1' }] },
      }),
    ])
    const [upload] = await uploads.listUploads()
    expect(upload).toMatchObject({ state: 'done', link: 'https://cdn.example.com/video.mov' })
  })

  test('at launch, an active Upload with no saved upload ID starts again from the beginning', async () => {
    const db = memoryDb()
    const first = (await setup({ enqueue: () => new Promise(() => {}) }, undefined, undefined, db)).uploads
    void first.drop(['/Users/me/Desktop/a.png'])
    await new Promise((r) => setTimeout(r, 0))

    const requests: UploadRequest[] = []
    const { uploads } = await setup({ enqueue: async (req) => (requests.push(req), { ...done, id: req.id }) }, undefined, undefined, db)
    await uploads.resumeActive()

    expect(requests).toHaveLength(1)
    expect(requests[0].resume).toBeUndefined()
    expect((await uploads.listUploads())[0].state).toBe('done')
  })

  test('a new upload ID from the Engine replaces the saved Parts of the old one', async () => {
    const requests: UploadRequest[] = []
    let uploads!: Awaited<ReturnType<typeof setup>>['uploads']
    const engine: UploadEngine = {
      enqueue: async (req) => {
        requests.push(req)
        if (requests.length === 1) {
          uploads.uploadStarted(started)
          uploads.partDone({ id: req.id, ...part1 })
          uploads.uploadStarted({ ...started, uploadId: 'up-2' }) // The old upload was gone.
          throw new EngineExitedError()
        }
        return done
      },
    }
    uploads = (await setup(engine)).uploads

    await uploads.drop(['/Users/me/Movies/video.mov'])

    expect(requests[1].resume).toEqual({ key: '2026/09/video.mov', uploadId: 'up-2', hash: 'b3-hash', parts: [] })
  })

  test('the Engine stopped for good: the Upload stays active for the next launch, and is not marked failed', async () => {
    const queue = { added: [] as string[], finished: [] as [string, boolean][] }
    const engine: UploadEngine = { enqueue: async () => Promise.reject(new EngineStoppedError()) }
    const { uploads } = await setup(engine, {
      add: (files: { id: string }[]) => void queue.added.push(...files.map((f) => f.id)),
      finish: (id: string, ok: boolean) => void queue.finished.push([id, ok]),
    } as never)

    await uploads.drop(['/Users/me/Movies/video.mov'])

    expect((await uploads.listUploads())[0]).toMatchObject({ state: 'active', error: null })
    expect(queue.finished).toEqual([['1.1', false]])
  })
})

describe('pause, resume, and cancel (ticket 12)', () => {
  const started = { id: '1.1', key: '2026/10/video.mov', uploadId: 'up-1', hash: 'b3-hash' }
  const part1 = { n: 1, size: 8_388_608, etag: 'part-1', checksum: 'crc-1', startedAt: '2026-10-15T10:00:00Z', finishedAt: '2026-10-15T10:00:02Z', retries: 0, bps: 4_194_304 }
  const settle = () => new Promise((r) => setTimeout(r, 0))

  /** An Engine that holds each call until the test finishes it, and stops a call on pause or cancel, like the real one. */
  function controlledEngine() {
    const held = new Map<string, { finish: () => void; stop: (err: Error) => void }>()
    const engine = {
      requests: [] as UploadRequest[],
      paused: [] as string[],
      cancelled: [] as { id: string; key?: string; destination: unknown }[],
      enqueue(req: UploadRequest) {
        engine.requests.push(req)
        return new Promise<Awaited<ReturnType<UploadEngine['enqueue']>>>((resolve, reject) => {
          held.set(req.id, { finish: () => resolve(instantEngine.enqueue(req)), stop: reject })
        })
      },
      async pause(id: string) {
        engine.paused.push(id)
        held.get(id)?.stop(new Error('the upload was paused'))
        held.delete(id)
      },
      async cancel(req: { id: string; key?: string; destination: unknown }) {
        engine.cancelled.push(req)
        held.get(req.id)?.stop(new Error('the upload was cancelled'))
        held.delete(req.id)
      },
      finish(id: string) {
        held.get(id)?.finish()
        held.delete(id)
      },
      running: () => [...held.keys()],
    }
    return engine
  }

  function queueSpy() {
    const calls: string[] = []
    return {
      calls,
      add: (files: { id: string; state?: string }[]) => void calls.push(...files.map((f) => `add ${f.id} ${f.state ?? 'active'}`)),
      finish: (id: string, ok: boolean) => void calls.push(`finish ${id} ${ok}`),
      pause: (id: string) => void calls.push(`pause ${id}`),
      resume: (id: string) => void calls.push(`resume ${id}`),
      cancel: (id: string) => void calls.push(`cancel ${id}`),
    }
  }

  test('pause stops the running Upload in the Engine and marks it paused, not failed', async () => {
    const engine = controlledEngine()
    const queue = queueSpy()
    const { uploads } = await setup(engine, queue as never)

    void uploads.drop(['/Users/me/Movies/video.mov'])
    await settle()
    await uploads.pause('1.1')
    await settle()

    expect(engine.paused).toEqual(['1.1'])
    expect((await uploads.listUploads())[0]).toMatchObject({ state: 'paused', error: null })
    expect(queue.calls).toContain('pause 1.1')
    expect(queue.calls).not.toContain('finish 1.1 false')
  })

  test('resume runs the paused Upload again from its saved Parts, and the Batch then puts the Link on the clipboard', async () => {
    let uploads!: Awaited<ReturnType<typeof setup>>['uploads']
    const engine = controlledEngine()
    const enqueue = engine.enqueue
    engine.enqueue = (req) => {
      if (engine.requests.length === 0) {
        uploads.uploadStarted(started)
        uploads.partDone({ id: req.id, ...part1 })
      }
      return enqueue(req)
    }
    const s = await setup(engine)
    uploads = s.uploads

    const dropping = uploads.drop(['/Users/me/Movies/video.mov'])
    await settle()
    await uploads.pause('1.1')
    await settle()
    await uploads.resume('1.1')
    await settle()
    engine.finish('1.1')
    await dropping

    expect(engine.requests.map((r) => r.resume)).toEqual([
      undefined,
      { key: '2026/10/video.mov', uploadId: 'up-1', hash: 'b3-hash', parts: [{ n: 1, etag: 'part-1', checksum: 'crc-1' }] },
    ])
    expect((await uploads.listUploads())[0].state).toBe('done')
    expect(s.clipboard).toEqual(['https://cdn.example.com/video.mov'])
  })

  test('a paused Upload gives back its turn, so a waiting file starts', async () => {
    const engine = controlledEngine()
    const { uploads } = await setup(engine, undefined, undefined, undefined, { filesAtOnce: 1 })

    void uploads.drop(['/Users/me/Desktop/a.png', '/Users/me/Desktop/b.png'])
    await settle()
    expect(engine.running()).toEqual(['1.1'])
    await uploads.pause('1.1')
    await settle()

    expect(engine.running()).toEqual(['1.2'])
  })

  test('a waiting Upload that is paused does not start when its turn comes', async () => {
    const engine = controlledEngine()
    const { uploads } = await setup(engine, undefined, undefined, undefined, { filesAtOnce: 1 })

    void uploads.drop(['/Users/me/Desktop/a.png', '/Users/me/Desktop/b.png'])
    await settle()
    await uploads.pause('1.2')
    engine.finish('1.1')
    await settle()

    expect(engine.requests.map((r) => r.id)).toEqual(['1.1'])
    expect((await uploads.listUploads()).map((u) => u.state)).toEqual(['done', 'paused'])
  })

  test('cancel stops the running Upload and asks the Engine to abort its multipart upload; the Batch ends with no Link for it', async () => {
    let uploads!: Awaited<ReturnType<typeof setup>>['uploads']
    const engine = controlledEngine()
    const enqueue = engine.enqueue
    engine.enqueue = (req) => {
      if (req.id === '1.1') uploads.uploadStarted(started)
      return enqueue(req)
    }
    const queue = queueSpy()
    const s = await setup(engine, queue as never)
    uploads = s.uploads

    const dropping = uploads.drop(['/Users/me/Movies/video.mov', '/Users/me/Desktop/b.png'])
    await settle()
    await uploads.cancel('1.1')
    engine.finish('1.2')
    await dropping

    expect(engine.cancelled).toEqual([
      { id: '1.1', key: '2026/10/video.mov', destination: expect.objectContaining({ bucket: 'public-assets' }) },
    ])
    expect((await uploads.listUploads()).map((u) => [u.state, u.error])).toEqual([
      ['cancelled', null],
      ['done', null],
    ])
    expect(queue.calls).toContain('cancel 1.1')
    expect(queue.calls).not.toContain('finish 1.1 false')
    expect(s.clipboard).toEqual(['https://cdn.example.com/b.png'])
  })

  test('cancel of a paused Upload aborts its saved multipart upload and ends the Batch', async () => {
    let uploads!: Awaited<ReturnType<typeof setup>>['uploads']
    const engine = controlledEngine()
    const enqueue = engine.enqueue
    engine.enqueue = (req) => (uploads.uploadStarted(started), enqueue(req))
    uploads = (await setup(engine)).uploads

    const dropping = uploads.drop(['/Users/me/Movies/video.mov'])
    await settle()
    await uploads.pause('1.1')
    await uploads.cancel('1.1')
    await dropping

    expect(engine.cancelled).toEqual([expect.objectContaining({ id: '1.1', key: '2026/10/video.mov' })])
    expect((await uploads.listUploads())[0].state).toBe('cancelled')
  })

  test('Pause all pauses every active Upload; Resume all runs them again', async () => {
    const engine = controlledEngine()
    const { uploads } = await setup(engine, undefined, undefined, undefined, { filesAtOnce: 2 })

    const dropping = uploads.drop(['/Users/me/Desktop/a.png', '/Users/me/Desktop/b.png', '/Users/me/Desktop/c.png'])
    await settle()
    await uploads.pauseAll()
    await settle()
    expect((await uploads.listUploads()).map((u) => u.state)).toEqual(['paused', 'paused', 'paused'])
    expect(engine.running()).toEqual([])

    await uploads.resumeAll()
    for (let i = 0; i < 3; i++) {
      await settle()
      engine.running().forEach((id) => engine.finish(id))
    }
    await dropping

    expect((await uploads.listUploads()).map((u) => u.state)).toEqual(['done', 'done', 'done'])
  })

  test('a paused Upload stays paused after a restart, shows in the Queue as paused, and resumes from its saved Parts', async () => {
    const db = memoryDb()
    let first!: Awaited<ReturnType<typeof setup>>['uploads']
    const engine = controlledEngine()
    const enqueue = engine.enqueue
    engine.enqueue = (req) => (first.uploadStarted(started), first.partDone({ id: req.id, ...part1 }), enqueue(req))
    first = (await setup(engine, undefined, undefined, db)).uploads
    void first.drop(['/Users/me/Movies/video.mov'])
    await settle()
    await first.pause('1.1')

    // Next launch.
    const next = controlledEngine()
    const queue = queueSpy()
    const { uploads } = await setup(next, queue as never, undefined, db, { fileSize: async () => 20_971_520 })
    await uploads.resumeActive()
    await settle()
    expect(next.requests).toEqual([])
    expect((await uploads.listUploads())[0].state).toBe('paused')
    expect(queue.calls).toEqual(['add 1.1 paused'])

    await uploads.resume('1.1')
    await settle()
    expect(next.requests.map((r) => r.resume?.parts)).toEqual([[{ n: 1, etag: 'part-1', checksum: 'crc-1' }]])
    next.finish('1.1')
    await settle()
    expect((await uploads.listUploads())[0].state).toBe('done')
  })

  test('after a restart, a paused Upload shows in the Queue at once, also while an active Upload still runs', async () => {
    const db = memoryDb()
    const engine = controlledEngine()
    const before = (await setup(engine, undefined, undefined, db)).uploads
    void before.drop(['/Users/me/Movies/a.mov', '/Users/me/Movies/b.mov'])
    await settle()
    await before.pause('1.1')
    await settle()
    expect(engine.running()).toEqual(['1.2'])

    // Next launch: 1.2 runs again and is held; 1.1 stays paused.
    const next = controlledEngine()
    const queue = queueSpy()
    const { uploads } = await setup(next, queue as never, undefined, db, { fileSize: async () => 20_971_520 })
    void uploads.resumeActive()
    await settle()
    await settle()

    expect(next.running()).toEqual(['1.2'])
    expect(queue.calls).toEqual(['add 1.2 active', 'add 1.1 paused'])
  })
})
