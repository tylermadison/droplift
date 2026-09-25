// Destinations: configure, test, and save the places uploads go (PRD §7.2, §10.1).

export interface Db {
  run(sql: string, params?: unknown[]): void
  all<T = Record<string, unknown>>(sql: string, params?: unknown[]): T[]
  exec(sql: string): void
}

/** The Keychain. In the app this is `app.secrets`. */
export interface SecretStore {
  get(key: string): Promise<string | null>
  set(key: string, value: string): Promise<boolean>
  delete(key: string): Promise<boolean>
}

export type TestResult = { ok: true } | { ok: false; message: string }

/** What the Engine gets for `dest.test`. Never the secret: the Engine asks for it with `secret.request`. */
export interface EngineTestRequest {
  provider: 's3' | 'r2'
  /** Destination name, for the Engine's error messages. */
  name: string
  bucket: string
  region?: string
  accountId?: string
  profile?: string
  /** Key for `secret.request`; absent for profile credentials. */
  account?: string
}

export interface EngineClient {
  testDestination(request: EngineTestRequest): Promise<TestResult>
}

export interface AccessKeys {
  accessKeyId: string
  secretAccessKey: string
}

export type Credentials =
  | { kind: 'keys'; accessKeyId: string; secretAccessKey: string }
  | { kind: 'profile'; profile: string }

export interface DestinationDraft {
  provider: 's3' | 'r2'
  name: string
  bucket: string
  region?: string
  accountId?: string
  credentials: Credentials
  publicBaseUrl?: string
}

export interface DestinationSummary {
  id: number
  name: string
  provider: 's3' | 'r2'
  bucket: string
  publicBaseUrl: string | null
  isDefault: boolean
}

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS accounts (
    id INTEGER PRIMARY KEY,
    provider TEXT NOT NULL,
    name TEXT NOT NULL,
    keychain_ref TEXT,
    meta_json TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS destinations (
    id INTEGER PRIMARY KEY,
    account_id INTEGER NOT NULL REFERENCES accounts(id),
    name TEXT NOT NULL,
    provider TEXT NOT NULL,
    bucket TEXT NOT NULL,
    public_base_url TEXT,
    is_default INTEGER NOT NULL DEFAULT 0
  )`

/** JSON with sorted keys, so the same draft always gives the same string. */
function fingerprint(value: unknown): string {
  return JSON.stringify(value, (_key, v) =>
    v && typeof v === 'object' && !Array.isArray(v)
      ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b)))
      : v,
  )
}

export function createDestinationsApi(deps: { db: Db; secrets: SecretStore; engine: EngineClient }) {
  const { db, engine } = deps
  db.exec(SCHEMA)
  // Drafts that passed Test in this session. Save accepts only these exact drafts.
  const passed = new Set<string>()
  // Keys of drafts under Test. They are not in the Keychain until Save.
  const pending = new Map<string, AccessKeys>()
  let nextPending = 1

  return {
    async testDestination(draft: DestinationDraft): Promise<TestResult> {
      const { credentials } = draft
      const account = credentials.kind === 'keys' ? `pending.${nextPending++}` : undefined
      if (account && credentials.kind === 'keys') {
        pending.set(account, { accessKeyId: credentials.accessKeyId, secretAccessKey: credentials.secretAccessKey })
      }
      try {
        const result = await engine.testDestination({
          provider: draft.provider,
          name: draft.name,
          bucket: draft.bucket,
          region: draft.region,
          accountId: draft.accountId,
          profile: credentials.kind === 'profile' ? credentials.profile : undefined,
          account,
        })
        if (result.ok) passed.add(fingerprint(draft))
        return result
      } finally {
        if (account) pending.delete(account)
      }
    },

    /** Answers the Engine's `secret.request`. Not part of the page API (PRD A5, A6). */
    async secretFor(account: string | undefined): Promise<AccessKeys | null> {
      if (!account) return null
      const held = pending.get(account)
      if (held) return held
      const stored = await deps.secrets.get(account)
      return stored ? (JSON.parse(stored) as AccessKeys) : null
    },

    async saveDestination(draft: DestinationDraft): Promise<void> {
      if (!passed.has(fingerprint(draft))) throw new Error('Test the destination before you save it.')
      const { credentials } = draft
      const meta = {
        region: draft.region,
        accountId: draft.accountId,
        profile: credentials.kind === 'profile' ? credentials.profile : undefined,
      }
      const [account] = db.all<{ id: number }>(
        'INSERT INTO accounts (provider, name, meta_json) VALUES (?, ?, ?) RETURNING id',
        [draft.provider, draft.name, JSON.stringify(meta)],
      )
      if (credentials.kind === 'keys') {
        const ref = `account.${account.id}`
        const { accessKeyId, secretAccessKey } = credentials
        await deps.secrets.set(ref, JSON.stringify({ accessKeyId, secretAccessKey }))
        db.run('UPDATE accounts SET keychain_ref = ? WHERE id = ?', [ref, account.id])
      }

      const isFirst = db.all('SELECT id FROM destinations').length === 0
      db.run(
        'INSERT INTO destinations (account_id, name, provider, bucket, public_base_url, is_default) VALUES (?, ?, ?, ?, ?, ?)',
        [account.id, draft.name, draft.provider, draft.bucket, draft.publicBaseUrl ?? null, isFirst ? 1 : 0],
      )
    },

    async listDestinations(): Promise<DestinationSummary[]> {
      return db
        .all<{
          id: number
          name: string
          provider: 's3' | 'r2'
          bucket: string
          public_base_url: string | null
          is_default: number
        }>('SELECT id, name, provider, bucket, public_base_url, is_default FROM destinations ORDER BY id')
        .map((r) => ({
          id: r.id,
          name: r.name,
          provider: r.provider,
          bucket: r.bucket,
          publicBaseUrl: r.public_base_url,
          isDefault: r.is_default === 1,
        }))
    },
  }
}
