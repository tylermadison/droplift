import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, test } from 'vitest'
import type { ProgressRow } from '../../backend/queue'
import { ProgressWindow, type ProgressActions, type ProgressSource } from './ProgressWindow'

function fakeSource(current: ProgressRow[] = []) {
  let listener: ((rows: ProgressRow[]) => void) | undefined
  const source: ProgressSource = {
    onProgress: (fn) => {
      listener = fn
      return () => (listener = undefined)
    },
    current: async () => current,
  }
  const emit = (rows: ProgressRow[]) => act(() => listener?.(rows))
  return { source, emit }
}

function fakeActions() {
  const calls: string[] = []
  const actions: ProgressActions = {
    pause: async (id) => void calls.push(`pause ${id}`),
    resume: async (id) => void calls.push(`resume ${id}`),
    cancel: async (id) => void calls.push(`cancel ${id}`),
    pauseAll: async () => void calls.push('pauseAll'),
    resumeAll: async () => void calls.push('resumeAll'),
  }
  return { actions, calls }
}

const photo: ProgressRow = {
  id: '1.1',
  name: 'photo.png',
  provider: 'r2',
  sent: 1_000_000,
  total: 5_000_000,
  bytesPerSecond: 1_000_000,
  etaSeconds: 4,
  state: 'active',
}

describe('ProgressWindow', () => {
  test('shows one row per upload with name, destination, bytes, speed, time left, and state', () => {
    const { source, emit } = fakeSource()
    render(<ProgressWindow source={source} actions={fakeActions().actions} />)

    emit([photo, { ...photo, id: '1.2', name: 'notes.txt', state: 'done', sent: 5_000_000, etaSeconds: null }])

    const rows = screen.getAllByRole('listitem')
    expect(rows).toHaveLength(2)
    expect(rows[0]).toHaveTextContent('photo.png')
    expect(rows[0]).toHaveTextContent('R2')
    expect(rows[0]).toHaveTextContent('1.0 MB of 5.0 MB')
    expect(rows[0]).toHaveTextContent('1.0 MB/s')
    expect(rows[0]).toHaveTextContent('4 s left')
    expect(rows[0]).toHaveTextContent('Uploading')
    expect(rows[1]).toHaveTextContent('Done')
    expect(within(rows[0]).getByRole('progressbar', { name: 'photo.png' })).toHaveAttribute('aria-valuenow', '20')
  })

  test('rows update when a new progress push arrives', () => {
    const { source, emit } = fakeSource()
    render(<ProgressWindow source={source} actions={fakeActions().actions} />)

    emit([photo])
    emit([{ ...photo, sent: 4_000_000, etaSeconds: 1 }])

    expect(screen.getByRole('progressbar', { name: 'photo.png' })).toHaveAttribute('aria-valuenow', '80')
    expect(screen.getByRole('listitem')).toHaveTextContent('1 s left')
  })

  test('an active row has Pause and Cancel; a paused row has Resume and Cancel; an ended row has none (PRD P2)', () => {
    const { source, emit } = fakeSource()
    const { actions, calls } = fakeActions()
    render(<ProgressWindow source={source} actions={actions} />)

    emit([
      photo,
      { ...photo, id: '1.2', name: 'notes.txt', state: 'paused', etaSeconds: null },
      { ...photo, id: '1.3', name: 'old.zip', state: 'done', etaSeconds: null },
    ])
    const [active, paused, done] = screen.getAllByRole('listitem')
    fireEvent.click(within(active).getByRole('button', { name: 'Pause photo.png' }))
    fireEvent.click(within(active).getByRole('button', { name: 'Cancel photo.png' }))
    fireEvent.click(within(paused).getByRole('button', { name: 'Resume notes.txt' }))

    expect(paused).toHaveTextContent('Paused')
    expect(within(done).queryAllByRole('button')).toEqual([])
    expect(calls).toEqual(['pause 1.1', 'cancel 1.1', 'resume 1.2'])
  })

  test('"Pause all" shows while an upload is active, and "Resume all" while one is paused', () => {
    const { source, emit } = fakeSource()
    const { actions, calls } = fakeActions()
    render(<ProgressWindow source={source} actions={actions} />)

    emit([photo])
    fireEvent.click(screen.getByRole('button', { name: 'Pause all' }))
    expect(screen.queryByRole('button', { name: 'Resume all' })).toBeNull()

    emit([{ ...photo, state: 'paused', etaSeconds: null }])
    fireEvent.click(screen.getByRole('button', { name: 'Resume all' }))
    expect(screen.queryByRole('button', { name: 'Pause all' })).toBeNull()

    expect(calls).toEqual(['pauseAll', 'resumeAll'])
  })

  test('a cancelled row shows as cancelled', () => {
    const { source, emit } = fakeSource()
    render(<ProgressWindow source={source} actions={fakeActions().actions} />)

    emit([{ ...photo, state: 'cancelled', etaSeconds: null }])

    expect(screen.getByRole('listitem')).toHaveTextContent('Cancelled')
  })

  test('a window that opens after the last push shows the current rows (a paused row gets no more pushes)', async () => {
    const { source } = fakeSource([{ ...photo, state: 'paused', etaSeconds: null }])
    render(<ProgressWindow source={source} actions={fakeActions().actions} />)

    expect(await screen.findByRole('listitem')).toHaveTextContent('Paused')
  })

  test('a push that comes before the current rows wins over them', async () => {
    let answer!: (rows: ProgressRow[]) => void
    const { source, emit } = fakeSource()
    source.current = () => new Promise((r) => (answer = r))
    render(<ProgressWindow source={source} actions={fakeActions().actions} />)

    emit([{ ...photo, sent: 4_000_000 }])
    await act(async () => answer([photo]))

    expect(screen.getByRole('progressbar', { name: 'photo.png' })).toHaveAttribute('aria-valuenow', '80')
  })
})
