import { describe, expect, test } from 'vitest'
import { createDestinationsApi, type DestinationDraft } from './destinations'
import { createQueue } from './queue'
import { createUploads, type Notice, type UploadEngine } from './uploads'
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
  }),
}

async function setup(
  engine: UploadEngine = instantEngine,
  queue?: ReturnType<typeof createQueue>,
  clock: () => number = () => 0,
) {
  const db = memoryDb()
  const destinations = createDestinationsApi({ db, secrets: memorySecrets(), engine: { testDestination: async () => ({ ok: true }) } })
  await destinations.testDestination(r2Draft)
  await destinations.saveDestination(r2Draft)
  const clipboard: string[] = []
  const notifications: Notice[] = []
  const opened: string[] = []
  const shown: string[] = []
  const uploads = createUploads({
    db,
    engine,
    destinations,
    clipboard: { writeText: (text) => void clipboard.push(text) },
    bundlePath: BUNDLE,
    queue,
    notify: (n) => void notifications.push(n),
    now: clock,
    openUrl: (url) => void opened.push(url),
    showDashboard: () => void shown.push('dashboard'),
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
