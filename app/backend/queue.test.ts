import { describe, expect, test } from 'vitest'
import { createQueue } from './queue'

function setup() {
  const dock = { progress: [] as (number | null)[], badge: [] as string[] }
  const pushes: { event: string; data: unknown }[] = []
  let pending: (() => void)[] = []
  const queue = createQueue({
    dock: { progress: (v) => void dock.progress.push(v), badge: (t) => void dock.badge.push(t) },
    push: (event, data) => void pushes.push({ event, data }),
    setTimer: (_ms, fire) => void pending.push(fire),
  })
  /** Runs the 100 ms flush, as the real timer would. */
  const tick = () => {
    const due = pending
    pending = []
    due.forEach((fire) => fire())
  }
  return { queue, dock, pushes, tick }
}

describe('queue progress', () => {
  test('the Dock shows progress over the whole queue and the files that remain, then clears', () => {
    const { queue, dock, tick } = setup()

    queue.add(['1.1', '1.2'])
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

    queue.add(['1.1', '1.2'])
    queue.progress({ id: '1.1', sent: 10, total: 100 })
    queue.progress({ id: '1.1', sent: 40, total: 100 })
    queue.progress({ id: '1.2', sent: 5, total: 50 })
    tick()

    expect(pushes).toEqual([
      {
        event: 'progress',
        data: [
          { id: '1.1', sent: 40, total: 100, done: false },
          { id: '1.2', sent: 5, total: 50, done: false },
        ],
      },
    ])
  })

  test('progress never goes backwards when a retry starts the file again', () => {
    const { queue, dock, tick } = setup()

    queue.add(['1.1'])
    queue.progress({ id: '1.1', sent: 80, total: 100 })
    tick()
    queue.progress({ id: '1.1', sent: 20, total: 100 })
    tick()

    expect(dock.progress).toEqual([0.8, 0.8])
  })
})
