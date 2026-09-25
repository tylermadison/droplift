import { describe, expect, test } from 'vitest'
import { createQueue } from './queue'

const file = (id: string, name = `${id}.bin`) => ({ id, name, provider: 'r2' as const })

function setup() {
  let now = 0
  const dock = { progress: [] as (number | null)[], badge: [] as string[] }
  const pushes: { event: string; data: unknown }[] = []
  let pending: { ms: number; fire: () => void }[] = []
  const windowCalls: string[] = []
  const queue = createQueue({
    dock: { progress: (v) => void dock.progress.push(v), badge: (t) => void dock.badge.push(t) },
    push: (event, data) => void pushes.push({ event, data }),
    setTimer: (ms, fire) => void pending.push({ ms, fire }),
    now: () => now,
    window: { show: () => void windowCalls.push('show'), close: () => void windowCalls.push('close') },
  })
  /** Runs the timers with this delay, as the real timers would. */
  const run = (ms: number) => {
    const due = pending.filter((t) => t.ms === ms)
    pending = pending.filter((t) => t.ms !== ms)
    due.forEach((t) => t.fire())
  }
  /** The 100 ms flush. */
  const tick = () => run(100)
  const advance = (ms: number) => void (now += ms)
  return { queue, dock, pushes, tick, advance, windowCalls, after3s: () => run(3000) }
}

describe('queue progress', () => {
  test('the Dock shows progress over the whole queue and the files that remain, then clears', () => {
    const { queue, dock, tick } = setup()

    queue.add([file('1.1'), file('1.2')])
    queue.progress({ id: '1.1', sent: 50, total: 100 })
    queue.progress({ id: '1.2', sent: 0, total: 300 })
    tick()
    queue.finish('1.1')
    queue.progress({ id: '1.2', sent: 300, total: 300 })
    queue.finish('1.2')
    tick()

    // 50 of 400 bytes, 2 files left; then everything is done.
    expect(dock.progress).toEqual([0.125, null])
    expect(dock.badge).toEqual(['2', ''])
  })

  test('events inside one 100 ms window become one push to the windows', () => {
    const { queue, pushes, tick } = setup()

    queue.add([file('1.1'), file('1.2')])
    queue.progress({ id: '1.1', sent: 10, total: 100 })
    queue.progress({ id: '1.1', sent: 40, total: 100 })
    queue.progress({ id: '1.2', sent: 5, total: 50 })
    tick()

    expect(pushes).toEqual([
      {
        event: 'progress',
        data: [
          expect.objectContaining({ id: '1.1', sent: 40, total: 100, state: 'active' }),
          expect.objectContaining({ id: '1.2', sent: 5, total: 50, state: 'active' }),
        ],
      },
    ])
  })

  test('progress never goes backwards when a retry starts the file again', () => {
    const { queue, dock, tick } = setup()

    queue.add([file('1.1')])
    queue.progress({ id: '1.1', sent: 80, total: 100 })
    tick()
    queue.progress({ id: '1.1', sent: 20, total: 100 })
    tick()

    expect(dock.progress).toEqual([0.8, 0.8])
  })
})

describe('queue rows', () => {
  test('a row has the name, provider, speed, ETA, and state of its upload', () => {
    const { queue, pushes, tick, advance } = setup()

    queue.add([file('1.1', 'photo.png')])
    queue.progress({ id: '1.1', sent: 0, total: 5_000_000 })
    tick()
    advance(1000)
    queue.progress({ id: '1.1', sent: 1_000_000, total: 5_000_000 })
    tick()

    expect(pushes.at(-1)?.data).toEqual([
      {
        id: '1.1',
        name: 'photo.png',
        provider: 'r2',
        sent: 1_000_000,
        total: 5_000_000,
        bytesPerSecond: 1_000_000,
        etaSeconds: 4,
        state: 'active',
      },
    ])
  })

  test('a failed upload shows as failed, and only active uploads count on the badge', () => {
    const { queue, pushes, dock, tick } = setup()

    queue.add([file('1.1'), file('1.2')])
    queue.finish('1.1', false)
    tick()

    expect((pushes.at(-1)?.data as { id: string; state: string }[]).map((r) => [r.id, r.state])).toEqual([
      ['1.1', 'failed'],
      ['1.2', 'active'],
    ])
    expect(dock.badge.at(-1)).toBe('1')
  })
})

describe('progress window', () => {
  test('a drop shows the window, and it closes 3 s after the queue is done with no errors', () => {
    const { queue, tick, after3s, windowCalls } = setup()

    queue.add([file('1.1')])
    queue.finish('1.1', true)
    tick()
    after3s()

    expect(windowCalls).toEqual(['show', 'close'])
  })

  test('the window stays open when an upload failed', () => {
    const { queue, tick, after3s, windowCalls } = setup()

    queue.add([file('1.1'), file('1.2')])
    queue.finish('1.1', false)
    queue.finish('1.2', true)
    tick()
    after3s()

    expect(windowCalls).toEqual(['show'])
  })

  test('a new drop in the 3 s keeps the window open', () => {
    const { queue, tick, after3s, windowCalls } = setup()

    queue.add([file('1.1')])
    queue.finish('1.1', true)
    tick()
    queue.add([file('2.1')])
    after3s()

    expect(windowCalls).toEqual(['show', 'show'])
  })
})
