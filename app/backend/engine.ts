// Starts the Engine and talks JSON-RPC 2.0 with it over a Unix socket in a private temp dir (PRD §9.2).
// Not stdin: txiki.js delivers only the first write to a child's stdin.

type Handler = (method: string, params: any) => Promise<unknown>

export interface EngineConnection {
  call<T>(method: string, params?: unknown): Promise<T>
}

const enc = new TextEncoder()
const dec = new TextDecoder()

function enginePath(): string {
  const dir = tjs.exePath.slice(0, tjs.exePath.lastIndexOf('/'))
  return tjs.env.DROPLIFT_ENGINE || dir + '/droplift-engine'
}

/** Starts the Engine. `onRequest` answers the Engine's own requests, such as `secret.request`. */
export async function startEngine(onRequest: Handler): Promise<EngineConnection> {
  const dir = await tjs.makeTempDir(tjs.tmpDir + '/droplift-XXXXXX')
  await tjs.chmod(dir, 0o700)
  const socket = dir + '/engine.sock'
  const server = await tjs.listen('pipe', socket)
  const listening = await server.opened
  await tjs.chmod(socket, 0o600)

  // app.spawnHidden is tjs.spawn on macOS (it only hides a console window on Windows), and it is not in the types.
  tjs.spawn([enginePath(), '--socket', socket], { stdin: 'ignore', stdout: 'ignore', stderr: 'inherit' })
  const { value: conn } = await listening.readable.getReader().read()
  const { readable, writable } = await conn.opened
  const writer = writable.getWriter()
  const send = (msg: object) => writer.write(enc.encode(JSON.stringify({ jsonrpc: '2.0', ...msg }) + '\n'))

  const waiting = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void }>()
  let nextId = 1

  ;(async () => {
    const reader = readable.getReader()
    let buf = ''
    for (;;) {
      const { value, done } = await reader.read()
      if (done) break
      buf += dec.decode(value, { stream: true })
      let i
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i)
        buf = buf.slice(i + 1)
        if (!line.trim()) continue
        const msg = JSON.parse(line)
        if (msg.method) {
          onRequest(msg.method, msg.params).then(
            (result) => msg.id != null && send({ id: msg.id, result }),
            (err) => msg.id != null && send({ id: msg.id, error: { code: -32000, message: String(err?.message ?? err) } }),
          )
          continue
        }
        const w = waiting.get(msg.id)
        waiting.delete(msg.id)
        if (msg.error) w?.reject(new Error(msg.error.message))
        else w?.resolve(msg.result)
      }
    }
  })()

  return {
    call: (method, params) =>
      new Promise((resolve, reject) => {
        const id = nextId++
        waiting.set(id, { resolve, reject })
        send({ id, method, params })
      }),
  }
}
