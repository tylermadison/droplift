// Minimal typing for tjs:sqlite (fully sync; statements have run/all/finalize only).
declare module 'tjs:sqlite' {
  interface Statement {
    run(...params: unknown[]): void
    all(...params: unknown[]): Record<string, unknown>[]
    finalize(): void
  }
  export class Database {
    constructor(path: string)
    prepare(sql: string): Statement
    exec(sql: string): void
    close(): void
  }
}
