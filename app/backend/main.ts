// Host entry (PRD §9.1). The page can call only the methods in `api`.
import { createDestinationsApi, type DestinationDraft } from './destinations'
import { startEngine, type EngineConnection } from './engine'
import { superviseEngine } from './engine-supervisor'
import { createLaunch, withoutBundlePaths } from './launch'
import { createQueue, type ProgressEvent } from './queue'
import { openDb } from './sqlite'
import { createUploads, type UploadDone, type PartDone, type UploadStarted } from './uploads'

let destinations: ReturnType<typeof createDestinationsApi> | undefined
let uploads: ReturnType<typeof createUploads> | undefined
let engine: EngineConnection | undefined
let markReady!: () => void
const ready = new Promise<void>((resolve) => (markReady = resolve))

/** The .app folder, from Contents/MacOS/tjs. In `tinyjs dev` there is no bundle, and nothing matches. */
const bundlePath = tjs.exePath.replace(/\/Contents\/MacOS\/[^/]+$/, '')

let launch: ReturnType<typeof createLaunch> | undefined

export async function init(app: TinyApp) {
  // Info.plist starts the app as "accessory" so no window shows; normal presence brings back the Dock icon (spike 01).
  app.presence('normal')
  launch = createLaunch({ bundlePath, showDashboard: () => app.window('main').show(), setTimer: (ms, fire) => setTimeout(fire, ms) })
  launch.init()
  progress = progressWindow(app)

  const queue = createQueue({
    dock: {
      progress: (value) => app.progress(value),
      // After the accessory start, the Dock tile drops badges for a few seconds, and the launcher skips a
      // badge text that did not change. Clearing first makes every flush set the badge again (ticket 06).
      badge: (text) => {
        app.badge('')
        if (text) app.badge(text)
      },
    },
    push: (event, data) => app.push(event, data),
    setTimer: (ms, fire) => setTimeout(fire, ms),
    window: progress,
  })
  const onEngineRequest = async (method: string, params: any) => {
    if (method === 'secret.request') return destinations!.secretFor(params?.account)
    if (method === 'progress') return queue.progress(params as ProgressEvent)
    if (method === 'upload.started') return uploads?.uploadStarted(params as UploadStarted)
    if (method === 'part.done') return uploads?.partDone(params as PartDone)
    throw new Error(`unknown method ${method}`)
  }
  // If the Engine exits, it starts again and the Uploads resume; after 3 exits in one minute, the Host stops (PRD §9.2).
  engine = superviseEngine({
    start: () => startEngine(onEngineRequest),
    now: Date.now,
    onStop: () =>
      void app.notify({
        id: 'engine.stopped',
        title: 'Uploads stopped',
        body: 'The upload engine stopped 3 times in one minute. Open Droplift again to continue your uploads.',
        actions: [],
      }),
  })
  const db = await openDb(app)
  destinations = createDestinationsApi({
    db,
    secrets: app.secrets,
    engine: { testDestination: (request) => engine!.call('dest.test', request) },
  })
  uploads = createUploads({
    db,
    destinations,
    engine: { enqueue: (request) => engine!.call<UploadDone>(request.resume ? 'upload.resume' : 'upload.enqueue', request) },
    clipboard: { writeText: (text) => app.clipboard.write({ text }) },
    bundlePath,
    queue,
    notify: (n) => void app.notify({ id: n.id, title: n.title, body: n.body, actions: n.actions }),
    openUrl: (url) => void app.shell.open(url),
    showDashboard: () => app.window('main').show(),
  })
  markReady()
  // Uploads that a crash or a kill stopped continue from their last completed Part (PRD U6).
  void uploads.resumeActive()
}

const PROGRESS_SIZE = { width: 380, height: 220 }
const PROGRESS_MARGIN = 16

/** The small frameless progress window at the top right of the main screen (PRD P2). */
function progressWindow(app: TinyApp) {
  // Read the screen once at start, so the window opens in its place with no jump.
  // Do not make the window early: openWindow shows a new window at once (only 'main' starts hidden).
  const position = app.screens().then(([screen]) => {
    const v = screen?.visible ?? { x: 0, y: 0, width: 1440, height: 900 }
    return { x: v.x + v.width - PROGRESS_SIZE.width - PROGRESS_MARGIN, y: v.y + PROGRESS_MARGIN }
  })
  let open = false
  return {
    show() {
      if (open) return app.window('progress').show({ activate: false })
      open = true
      void position.then(({ x, y }) => {
        app.openWindow('progress', {
          page: 'progress.html',
          title: 'Uploads',
          size: `${PROGRESS_SIZE.width}x${PROGRESS_SIZE.height}`,
          chrome: { frame: false, windowControls: ['close'] },
          x,
          y,
        })
        // A window opened from a drop stayed hidden (0x0) without this; one opened at init did not.
        app.window('progress').show({ activate: false })
      })
    },
    close() {
      if (!open) return
      open = false
      app.window('progress').close()
    },
    /** The user closed the window; the next drop opens a new one. */
    closed() {
      open = false
    },
  }
}

let progress: ReturnType<typeof progressWindow> | undefined

/** Dock or Finder drop; tinyjs buffers launch events until the app is ready (PRD D1). */
export async function onOpenFiles(paths: string[]) {
  launch?.openFiles(paths)
  // Show the progress window before the Engine and the database are ready (PRD §8: < 500 ms).
  if (withoutBundlePaths(paths, bundlePath).length > 0) progress?.show()
  await ready
  await uploads!.drop(paths)
}

/** Any window closed, also by the user (tinyjs calls this with the window id). */
export function onWindowClosed(id: string) {
  if (id === 'progress') progress?.closed()
}

/** A button on a Batch notification: Copy links, Open, or Show in dashboard (PRD P5). */
export async function onNotificationAction(info: TinyNotificationAction) {
  await ready
  await uploads!.notificationAction(info)
}

// Page API. Never add secretFor here: the page must not receive secret values (PRD A6).
export const api: Record<string, TinyApiHandler> = {
  listDestinations: async () => (await ready, destinations!.listDestinations()),
  testDestination: async (draft: DestinationDraft) => (await ready, destinations!.testDestination(draft)),
  saveDestination: async (draft: DestinationDraft) => (await ready, destinations!.saveDestination(draft)),
  awsProfiles: async () => (await ready, engine!.call('aws.profiles')),
  listUploads: async () => (await ready, uploads!.listUploads()),
}
