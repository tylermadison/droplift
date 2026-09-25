// Host entry (PRD §9.1). The page can call only the methods in `api`.
import { createDestinationsApi, type DestinationDraft } from './destinations'
import { startEngine, type EngineConnection } from './engine'
import { openDb } from './sqlite'

let destinations: ReturnType<typeof createDestinationsApi> | undefined
let engine: EngineConnection | undefined
let markReady!: () => void
const ready = new Promise<void>((resolve) => (markReady = resolve))

export async function init(app: TinyApp) {
  engine = await startEngine(async (method, params) => {
    if (method === 'secret.request') return destinations!.secretFor(params?.account)
    throw new Error(`unknown method ${method}`)
  })
  destinations = createDestinationsApi({
    db: await openDb(app),
    secrets: app.secrets,
    engine: { testDestination: (request) => engine!.call('dest.test', request) },
  })
  markReady()
}

// Page API. Never add secretFor here: the page must not receive secret values (PRD A6).
export const api: Record<string, TinyApiHandler> = {
  listDestinations: async () => (await ready, destinations!.listDestinations()),
  testDestination: async (draft: DestinationDraft) => (await ready, destinations!.testDestination(draft)),
  saveDestination: async (draft: DestinationDraft) => (await ready, destinations!.saveDestination(draft)),
  awsProfiles: async () => (await ready, engine!.call('aws.profiles')),
}
