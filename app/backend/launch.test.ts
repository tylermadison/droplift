import { describe, expect, test } from 'vitest'
import { createLaunch } from './launch'

const BUNDLE = '/Applications/Droplift.app'

function setup() {
  const timers: { ms: number; fire: () => void }[] = []
  const shown: string[] = []
  const launch = createLaunch({
    bundlePath: BUNDLE,
    showDashboard: () => void shown.push('dashboard'),
    setTimer: (ms, fire) => void timers.push({ ms, fire }),
  })
  return { launch, shown, fireTimer: () => timers.forEach((t) => t.fire()), timers }
}

describe('launch', () => {
  test('files that arrive before the timer keep the dashboard hidden', () => {
    const { launch, shown, fireTimer } = setup()

    launch.init()
    launch.openFiles(['/Users/me/Desktop/a.png'])
    fireTimer()

    expect(shown).toEqual([])
  })

  test('a launch with no files shows the dashboard after 400 ms', () => {
    const { launch, shown, fireTimer, timers } = setup()

    launch.init()
    fireTimer()

    expect(timers.map((t) => t.ms)).toEqual([400])
    expect(shown).toEqual(['dashboard'])
  })

  test("the app's own entry.js is not a file drop", () => {
    const { launch, shown, fireTimer } = setup()

    launch.init()
    launch.openFiles([`${BUNDLE}/Contents/Resources/app/entry.js`])
    fireTimer()

    expect(shown).toEqual(['dashboard'])
  })
})
