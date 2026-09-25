// The `Db` interface over tjs:sqlite, which is fully sync (run/all only).
import { Database } from 'tjs:sqlite'
import type { Db } from './destinations'

export async function openDb(app: TinyApp): Promise<Db> {
  const dir = app.paths.data
  await tjs.makeDir(dir, { recursive: true })
  const db = new Database(dir + '/droplift.db')
  return {
    run: (sql, params = []) => db.prepare(sql).run(...params),
    all: (sql, params = []) => db.prepare(sql).all(...params) as never,
    exec: (sql) => db.exec(sql),
  }
}
