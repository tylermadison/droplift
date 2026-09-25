import { act, render, screen, within } from '@testing-library/react'
import { describe, expect, test } from 'vitest'
import type { ProgressRow } from '../../backend/queue'
import { ProgressWindow, type ProgressSource } from './ProgressWindow'

function fakeSource() {
  let listener: ((rows: ProgressRow[]) => void) | undefined
  const source: ProgressSource = {
    onProgress: (fn) => {
      listener = fn
      return () => (listener = undefined)
    },
  }
  const emit = (rows: ProgressRow[]) => act(() => listener?.(rows))
  return { source, emit }
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
    render(<ProgressWindow source={source} />)

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
    render(<ProgressWindow source={source} />)

    emit([photo])
    emit([{ ...photo, sent: 4_000_000, etaSeconds: 1 }])

    expect(screen.getByRole('progressbar', { name: 'photo.png' })).toHaveAttribute('aria-valuenow', '80')
    expect(screen.getByRole('listitem')).toHaveTextContent('1 s left')
  })
})
