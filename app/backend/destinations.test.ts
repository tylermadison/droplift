import { describe, expect, test } from 'vitest'
import { createDestinationsApi, type EngineClient } from './destinations'
import { memoryDb, memorySecrets } from './test-fakes'

function engineThatPasses(): EngineClient {
  return { testDestination: async () => ({ ok: true }) }
}

const r2Draft = {
  provider: 'r2' as const,
  name: 'personal',
  bucket: 'public-assets',
  accountId: '0123456789abcdef0123456789abcdef',
  credentials: { kind: 'keys' as const, accessKeyId: 'AKIDEXAMPLE', secretAccessKey: 'wJalrXUtnFEMI/K7MDENG' },
  publicBaseUrl: 'https://cdn.example.com',
}

describe('destinations API', () => {
  test('a destination that passed Test is saved as the default destination', async () => {
    const api = createDestinationsApi({ db: memoryDb(), secrets: memorySecrets(), engine: engineThatPasses() })

    await api.testDestination(r2Draft)
    await api.saveDestination(r2Draft)

    expect(await api.listDestinations()).toEqual([
      expect.objectContaining({ name: 'personal', provider: 'r2', bucket: 'public-assets', isDefault: true }),
    ])
  })

  test('saved keys go to the Keychain as one item, and nothing else holds the secret', async () => {
    const db = memoryDb()
    const secrets = memorySecrets()
    const api = createDestinationsApi({ db, secrets, engine: engineThatPasses() })

    await api.testDestination(r2Draft)
    await api.saveDestination(r2Draft)

    expect(secrets.values.size).toBe(1)
    expect([...secrets.values.values()][0]).toContain('wJalrXUtnFEMI/K7MDENG')
    expect(JSON.stringify(await api.listDestinations())).not.toContain('wJalrXUtnFEMI/K7MDENG')
    const everyRow = db.all("SELECT name FROM sqlite_master WHERE type = 'table'").flatMap(({ name }) =>
      db.all(`SELECT * FROM ${name}`),
    )
    expect(JSON.stringify(everyRow)).not.toContain('wJalrXUtnFEMI/K7MDENG')
  })

  test('the engine gets the keys for Test only through a secret request', async () => {
    const seen: { request?: string; keys?: unknown } = {}
    const api = createDestinationsApi({
      db: memoryDb(),
      secrets: memorySecrets(),
      engine: {
        testDestination: async (request) => {
          seen.request = JSON.stringify(request)
          seen.keys = await api.secretFor(request.account)
          return { ok: true }
        },
      },
    })

    await api.testDestination(r2Draft)

    expect(seen.request).not.toContain('wJalrXUtnFEMI/K7MDENG')
    expect(seen.keys).toEqual({ accessKeyId: 'AKIDEXAMPLE', secretAccessKey: 'wJalrXUtnFEMI/K7MDENG' })
  })

  test('a failed Test gives its message, and save stays refused', async () => {
    const message = 'personal cannot write to public-assets.'
    const api = createDestinationsApi({
      db: memoryDb(),
      secrets: memorySecrets(),
      engine: { testDestination: async () => ({ ok: false, message }) },
    })

    expect(await api.testDestination(r2Draft)).toEqual({ ok: false, message })
    await expect(api.saveDestination(r2Draft)).rejects.toThrow('Test the destination before you save it.')
  })

  test('save is refused when the draft changed after Test', async () => {
    const api = createDestinationsApi({ db: memoryDb(), secrets: memorySecrets(), engine: engineThatPasses() })

    await api.testDestination(r2Draft)

    await expect(api.saveDestination({ ...r2Draft, bucket: 'other-bucket' })).rejects.toThrow(
      'Test the destination before you save it.',
    )
  })

  test('a saved destination keeps its public base URL', async () => {
    const api = createDestinationsApi({ db: memoryDb(), secrets: memorySecrets(), engine: engineThatPasses() })

    await api.testDestination(r2Draft)
    await api.saveDestination(r2Draft)

    expect(await api.listDestinations()).toEqual([expect.objectContaining({ publicBaseUrl: 'https://cdn.example.com' })])
  })

  test('the saved link type decides the link for uploads', async () => {
    const presigned = { ...r2Draft, link: { type: 'presigned' as const, ttlSeconds: 604800 as const } }
    const api = createDestinationsApi({ db: memoryDb(), secrets: memorySecrets(), engine: engineThatPasses() })

    await api.testDestination(presigned)
    await api.saveDestination(presigned)

    expect((await api.defaultForUpload())?.link).toEqual({ type: 'presigned', ttlSeconds: 604800 })
  })

  test('a public link uses the public base URL', async () => {
    const pub = { ...r2Draft, link: { type: 'public' as const } }
    const api = createDestinationsApi({ db: memoryDb(), secrets: memorySecrets(), engine: engineThatPasses() })

    await api.testDestination(pub)
    await api.saveDestination(pub)

    expect((await api.defaultForUpload())?.link).toEqual({ type: 'public', baseUrl: 'https://cdn.example.com' })
  })

  test('save is refused when the destination was not tested', async () => {
    const api = createDestinationsApi({ db: memoryDb(), secrets: memorySecrets(), engine: engineThatPasses() })

    await expect(api.saveDestination(r2Draft)).rejects.toThrow('Test the destination before you save it.')
    expect(await api.listDestinations()).toEqual([])
  })
})
