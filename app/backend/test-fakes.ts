// In-memory stand-ins for the system edges (SQLite file, Keychain), for tests only.
import { DatabaseSync } from 'node:sqlite'
import type { Db, SecretStore } from './destinations'

export function memoryDb(): Db {
  const db = new DatabaseSync(':memory:')
  return {
    run: (sql, params = []) => void db.prepare(sql).run(...(params as never[])),
    all: (sql, params = []) => db.prepare(sql).all(...(params as never[])) as never,
    exec: (sql) => db.exec(sql),
  }
}

export function memorySecrets(): SecretStore & { values: Map<string, string> } {
  const values = new Map<string, string>()
  return {
    values,
    get: async (key) => values.get(key) ?? null,
    set: async (key, value) => (values.set(key, value), true),
    delete: async (key) => values.delete(key),
  }
}
