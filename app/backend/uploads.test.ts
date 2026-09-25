import { describe, expect, test } from 'vitest'
import { createDestinationsApi, type DestinationDraft } from './destinations'
import { createQueue } from './queue'
import { createUploads, type UploadEngine } from './uploads'
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
  }),
}

async function setup(engine: UploadEngine = instantEngine, queue?: ReturnType<typeof createQueue>) {
  const db = memoryDb()
  const destinations = createDestinationsApi({ db, secrets: memorySecrets(), engine: { testDestination: async () => ({ ok: true }) } })
  await destinations.testDestination(r2Draft)
  await destinations.saveDestination(r2Draft)
  const clipboard: string[] = []
  const uploads = createUploads({
    db,
    engine,
    destinations,
    clipboard: { writeText: (text) => void clipboard.push(text) },
    bundlePath: BUNDLE,
    queue,
  })
  return { uploads, clipboard }
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
