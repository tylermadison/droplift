// Host entry (PRD §9.1). The page can call only the methods in `api`.
import { createDestinationsApi, type DestinationDraft } from './destinations'
import { startEngine, type EngineConnection } from './engine'
import { createLaunch } from './launch'
import { createQueue, type ProgressEvent } from './queue'
import { openDb } from './sqlite'
import { createUploads, type UploadDone } from './uploads'

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
  launch = createLaunch({ bundlePath, showDashboard: () => app.show(), setTimer: (ms, fire) => setTimeout(fire, ms) })
  launch.init()

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
  })
  engine = await startEngine(async (method, params) => {
    if (method === 'secret.request') return destinations!.secretFor(params?.account)
    if (method === 'progress') return queue.progress(params as ProgressEvent)
    throw new Error(`unknown method ${method}`)
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
    engine: { enqueue: (request) => engine!.call<UploadDone>('upload.enqueue', request) },
    clipboard: { writeText: (text) => app.clipboard.write({ text }) },
    bundlePath,
    queue,
    notify: (n) => void app.notify({ id: n.id, title: n.title, body: n.body, actions: n.actions }),
    openUrl: (url) => void app.shell.open(url),
    showDashboard: () => app.show(),
  })
  markReady()
}

/** Dock or Finder drop; tinyjs buffers launch events until the app is ready (PRD D1). */
export async function onOpenFiles(paths: string[]) {
  launch?.openFiles(paths)
  await ready
  await uploads!.drop(paths)
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
