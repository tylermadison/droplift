import { describe, expect, test } from 'vitest'
import { EngineExitedError, EngineStoppedError, superviseEngine, type EngineProcess } from './engine-supervisor'

/** A fake Engine process: calls wait until the test answers them, and `exit()` kills it. */
function fakeProcess() {
  let exit!: () => void
  const calls: { method: string; resolve: (v: unknown) => void }[] = []
  const proc: EngineProcess & { calls: typeof calls; exit: () => void } = {
    calls,
    exit: () => exit(),
    exited: new Promise<void>((r) => (exit = r)),
    call: <T>(method: string) => new Promise<T>((resolve) => void calls.push({ method, resolve: resolve as never })),
  }
  return proc
}

function setup() {
  let now = 0
  const started: ReturnType<typeof fakeProcess>[] = []
  const stops: number[] = []
  const engine = superviseEngine({
    start: async () => {
      const p = fakeProcess()
      started.push(p)
      return p
    },
    now: () => now,
    onStop: () => void stops.push(now),
  })
  return {
    engine,
    started,
    stops,
    advance: (ms: number) => void (now += ms),
    /** Kills the running Engine and lets the supervisor react. */
    kill: async () => {
      started[started.length - 1].exit()
      await new Promise((r) => setTimeout(r, 0))
    },
  }
}

const flush = () => new Promise((r) => setTimeout(r, 0))

/** Marks a call that the test expects to fail later as handled, so Node does not report it. */
const later = <T>(p: Promise<T>) => (p.catch(() => {}), p)

describe('engine supervisor', () => {
  test('a call goes to the running Engine and gives its result', async () => {
    const { engine, started } = setup()
    const result = engine.call('aws.profiles')
    await flush()
    started[0].calls[0].resolve(['default'])
    await expect(result).resolves.toEqual(['default'])
  })

  test('the Engine exits during a call: the call fails with EngineExitedError and a new Engine takes the next call', async () => {
    const { engine, started, kill } = setup()
    const inFlight = later(engine.call('upload.enqueue'))
    await flush()

    await kill()

    await expect(inFlight).rejects.toBeInstanceOf(EngineExitedError)
    expect(started).toHaveLength(2)
    const next = engine.call('upload.resume')
    await flush()
    expect(started[1].calls.map((c) => c.method)).toEqual(['upload.resume'])
    started[1].calls[0].resolve('ok')
    await expect(next).resolves.toBe('ok')
  })

  test('a call after the exit error goes to the new Engine, not the dead one', async () => {
    const { engine, started, kill } = setup()
    const inFlight = engine.call('upload.enqueue').catch(() => engine.call('upload.resume'))
    await flush()

    await kill()
    await flush()

    expect(started[0].calls.map((c) => c.method)).toEqual(['upload.enqueue'])
    expect(started[1].calls.map((c) => c.method)).toEqual(['upload.resume'])
    started[1].calls[0].resolve('ok')
    await expect(inFlight).resolves.toBe('ok')
  })

  test('3 exits in one minute: no more restarts, one stop, and calls fail with EngineStoppedError', async () => {
    const { engine, started, stops, kill, advance } = setup()
    await flush()
    await kill()
    advance(20_000)
    await kill()
    advance(20_000)
    const inFlight = later(engine.call('upload.enqueue'))
    await flush()
    await kill()

    expect(started).toHaveLength(3)
    expect(stops).toEqual([40_000])
    await expect(inFlight).rejects.toBeInstanceOf(EngineStoppedError)
    await expect(engine.call('upload.enqueue')).rejects.toBeInstanceOf(EngineStoppedError)
  })

  test('3 exits over more than one minute: the Engine starts again each time', async () => {
    const { started, stops, kill, advance } = setup()
    await flush()
    await kill()
    advance(40_000)
    await kill()
    advance(40_000)
    await kill()

    expect(started).toHaveLength(4)
    expect(stops).toEqual([])
  })

  test('an Engine that cannot start counts as an exit', async () => {
    let tries = 0
    const stops: string[] = []
    const engine = superviseEngine({
      start: async () => {
        tries++
        throw new Error('no engine binary')
      },
      now: () => 0,
      onStop: () => void stops.push('stop'),
    })

    const first = later(engine.call('aws.profiles'))
    await flush()
    await expect(first).rejects.toBeInstanceOf(EngineExitedError)
    await flush()
    await expect(engine.call('aws.profiles')).rejects.toBeInstanceOf(EngineStoppedError)
    expect(tries).toBe(3)
    expect(stops).toEqual(['stop'])
  })
})
