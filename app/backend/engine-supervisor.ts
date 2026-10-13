// Keeps the Engine running: if it exits, the Host starts it again, at most 3 times per minute (PRD §9.2, ticket 11).

/** The call was in flight when the Engine exited. The Engine starts again; the caller can run the call again. */
export class EngineExitedError extends Error {
  constructor() {
    super('The upload engine stopped.')
  }
}

/** The Engine exited 3 times in one minute, and the Host does not start it again until the next launch. */
export class EngineStoppedError extends Error {
  constructor() {
    super('The upload engine stopped 3 times in one minute.')
  }
}

/** One running Engine process. `exited` settles when the process or its socket ends. */
export interface EngineProcess {
  call<T>(method: string, params?: unknown): Promise<T>
  exited: Promise<void>
}

export const MAX_EXITS = 3
export const EXIT_WINDOW_MS = 60_000

export function superviseEngine(deps: {
  start: () => Promise<EngineProcess>
  /** Milliseconds. */
  now: () => number
  /** The Host gave up: show an error. */
  onStop: () => void
}) {
  const exits: number[] = []
  let stopped = false
  // Each process has its own in-flight calls; an exit fails only those.
  let current: { process: Promise<EngineProcess>; inFlight: Set<(err: Error) => void> }

  function launch() {
    const run = { process: deps.start(), inFlight: new Set<(err: Error) => void>() }
    current = run
    run.process.then(
      (p) => p.exited.then(() => exited(run)),
      () => exited(run),
    )
  }

  function exited(run: typeof current) {
    const now = deps.now()
    exits.push(now)
    while (exits.length > 0 && exits[0] <= now - EXIT_WINDOW_MS) exits.shift()
    if (exits.length >= MAX_EXITS) {
      stopped = true
      deps.onStop()
    } else {
      // Start the next Engine first, so a caller that runs its call again reaches the new one.
      launch()
    }
    const error = stopped ? new EngineStoppedError() : new EngineExitedError()
    for (const fail of run.inFlight) fail(error)
  }

  launch()

  return {
    call<T>(method: string, params?: unknown): Promise<T> {
      if (stopped) return Promise.reject(new EngineStoppedError())
      const run = current
      return new Promise<T>((resolve, reject) => {
        const fail = (err: Error) => reject(err)
        run.inFlight.add(fail)
        const settle = () => run.inFlight.delete(fail)
        run.process.then(
          (p) =>
            p.call<T>(method, params).then(
              (v) => (settle(), resolve(v)),
              (err) => (settle(), reject(err)),
            ),
          // The start failed: the exit handling fails the call.
          () => {},
        )
      })
    },
  }
}
