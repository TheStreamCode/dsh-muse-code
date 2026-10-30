// Muse Code (Meta subscription) integration for DeepSeek Harness.
//
// DeepSeek Harness already serves this subscription: the shipped pi-ai catalog
// exposes the `meta` route (api.meta.ai/v1) and registers the `llm-pi-ai/meta`
// authorization flow, which runs Meta's device-code login and stores the
// renewable credential record. This bundle adds what the harness does not:
//
// - it declares the `meta` route in the `llm-pi-ai` settings section, so the
//   provider appears under Settings > Models and its models in the model picker;
// - it syncs the account's live chat catalog (`GET /v1/models`) into that
//   route, so models the shipped pi-ai catalog does not list (Muse Wonder and
//   future ids) are selectable without a DSH update;
// - it exposes the shipped sign-in as `/muse-login` and as an exact local Web
//   route (`POST /muse-code/login`) that the Settings control calls, because
//   the Settings page cannot reach the authorization seam through the Remote
//   API;
// - it reports the sign-in state (`GET /muse-code/status`) so both the Settings
//   control and the command can say "signed in" instead of leaving the user
//   waiting after Meta confirmed.
//
// A second `@deepseek-ai/dsh-llm-pi-ai` instance is not an option: every
// instance declares the whole installed provider catalog, so the extra instance
// fails to activate with a duplicate configurable-provider error.

import type { IncomingMessage, ServerResponse } from "node:http"

import { openExternal } from "./open-browser.js"

export const name = "dsh-muse-code"
export const inject = ["authorization", "commands"]

/** Settings namespace whose provider profiles configure the pi-ai routes. */
const SETTINGS_NS = "llm-pi-ai"
/** Route served by the shipped pi-ai Meta provider. */
const PROVIDER = "meta"
/** Credential record / authorization flow the shipped pi-ai adapter registers. */
const AUTH_KEY = "llm-pi-ai/meta"
/** Preferred sign-in method; the shipped flow offers `oauth` first. */
const AUTH_METHOD = "oauth"
/** Display name for the route this bundle declares. */
const ROUTE_LABEL = "Muse Code (Meta subscription)"
/**
 * Credential reference the route reads through `apiKeyEnv`.
 *
 * DSH paints the Models row's credential dot only for a route that names a
 * reference, so the route reads the minted inference key through this reference
 * and the plugin keeps it in step with the OAuth record.
 */
export const CREDENTIAL_REFERENCE = "MUSE_CODE_SUB_TOKEN"
/** Key-mint endpoint of the pinned Muse contract. */
const KEY_MINT_URL = "https://api.meta.ai/muse-code/key"
/** Meta's minted inference keys live about a day. */
const KEY_LIFETIME_MS = 24 * 60 * 60 * 1000
/** Re-mint the key once the record is this close to expiry. */
const REFRESH_WINDOW_MS = 6 * 60 * 60 * 1000
/** How often the plugin re-checks the record while it runs. */
const REFRESH_CHECK_MS = 15 * 60 * 1000
/** Settle time before treating a removed route as a user sign-out. */
const ROUTE_DELETE_CHECK_MS = 400
/** Web route the Settings control calls to start the sign-in. */
export const LOGIN_ROUTE = "/muse-code/login"
/** Web route that reports whether the sign-in completed. */
export const STATUS_ROUTE = "/muse-code/status"
/** How long the sign-in waits for the device-code notice before giving up. */
const NOTICE_TIMEOUT_MS = 20_000
/** How long `/muse-login` waits for Meta's confirmation before answering. */
const RESULT_WAIT_MS = 120_000
/** Live chat catalog of the Meta Model API. */
const MODELS_URL = "https://api.meta.ai/v1/models"
const MODELS_TIMEOUT_MS = 8_000
/** Endpoint families the Muse subscription also lists but DSH cannot chat with. */
const NON_CHAT_PREFIXES = ["sam-", "muse-image-", "muse-voice-"]
/** Family defaults mirrored from the sibling Muse plugins and the pi-ai catalog. */
const MUSE_CONTEXT_WINDOW = 1_048_576
const MUSE_MAX_OUTPUT_TOKENS = 131_072

/** The five Muse Spark rows the shipped pi-ai catalog describes, with fidelity. */
const SPARK_MODELS: Record<string, { name: string; max: boolean }> = {
  "muse-spark-1.1": { name: "Muse Spark 1.1", max: false },
  "muse-spark-1.2": { name: "Muse Spark 1.2", max: false },
  "muse-spark-1.2-contributor": { name: "Muse Spark 1.2 Contributor", max: false },
  "muse-spark-1.3": { name: "Muse Spark 1.3", max: true },
  "muse-spark-1.3-contributor": { name: "Muse Spark 1.3 Contributor", max: false },
}

type Logger = {
  info?(message: string): void
  warn?(message: string, ...rest: unknown[]): void
  debug?(message: string): void
}

type CommandResult = { kind: "success"; text?: string } | { kind: "error"; text: string }

type ModelStreamChunk = {
  type: string
  reason?: {
    kind: string
    failure?: { code: string; message: string; [key: string]: unknown }
    [key: string]: unknown
  }
  [key: string]: unknown
}

type AuthorizationMethods = Array<{ id: string; label: string }>

type AuthorizationEntry = {
  key: string
  label: string
  methods: AuthorizationMethods
  inFlight: boolean
}

/**
 * One notice from the authorization seam. The seam's vocabulary is
 * `{ message, url?, code? }`; the raw pi-ai fields are accepted too so the
 * reader also covers a direct adapter notice.
 */
type AuthorizationNotice = {
  type?: string
  message?: string
  instructions?: string
  url?: string
  code?: string
  userCode?: string
  verificationUri?: string
  expiresInSeconds?: number
}

type AuthorizationInteraction = {
  notify(notice: AuthorizationNotice): void
  prompt(prompt: unknown): Promise<unknown>
}

type AuthorizationFace = {
  describe(key: string): AuthorizationEntry | undefined
  begin(request: {
    key: string
    method?: string
    interaction: AuthorizationInteraction
  }): Promise<{ status: string }>
  cancel?(key: string): void
}

type CommandFace = {
  register(definition: {
    name: string
    description: string
    handler(context: { rawInput?: string }): Promise<CommandResult>
  }): () => void
}

type SettingsRow = {
  ns: string
  revision: number
  value: Record<string, unknown>
}

type SettingsFace = {
  describe(): SettingsRow[]
  update(ns: string, patch: Record<string, unknown>, expectedRevision: number): Promise<void>
}

type CredentialRecord = {
  kind?: string
  payload?: Record<string, unknown>
}

type CredentialsFace = {
  readRecord(key: string): Promise<CredentialRecord | undefined>
  describeRecord(key: string): Promise<{ configured: boolean }>
  /** Stored reference state, used to avoid rewriting an unchanged key. */
  resolve?(reference: string): Promise<{ value?: string; source?: string } | undefined>
  set?(reference: string, value: string): Promise<void>
  unset?(reference: string): Promise<void>
  deleteRecord?(key: string): Promise<void>
  modifyRecord?(
    key: string,
    update: (current: CredentialRecord | undefined) => Promise<CredentialRecord | undefined>,
  ): Promise<unknown>
}

type WebRoute = {
  kind: "exact" | "prefix"
  path: string
  handler(request: IncomingMessage, response: ServerResponse): Promise<void>
}

type WebServerFace = {
  register(route: WebRoute): () => void
}

type ChildContext = HostContext & {
  settings?: SettingsFace
  webServer?: WebServerFace
  credentials?: CredentialsFace
}

type HostContext = {
  authorization: AuthorizationFace
  commands: CommandFace
  logger?: Logger
  effect(callback: () => () => void, label?: string): () => void
  inject?(dependencies: string[], callback: (child: ChildContext) => void): void
  on?(event: string, listener: (...args: never[]) => void, options?: { global?: boolean }): () => void
}

/** One sign-in lifecycle fact the surfaces can read. */
export type SignInSnapshot = {
  state: "idle" | "pending" | "authorized" | "failed" | "cancelled"
  text?: string
  code?: string
  at: number
}

/** Mutable snapshot shared by the command and the two Web routes. */
export type SignInState = {
  get(): SignInSnapshot
  set(snapshot: SignInSnapshot): void
}

/** Create one empty sign-in state. */
export function createSignInState(): SignInState {
  let snapshot: SignInSnapshot = { state: "idle", at: 0 }
  return {
    get: () => snapshot,
    set: (next) => {
      snapshot = next
    },
  }
}

/** Injected side effects, overridable in tests. */
export type SignInOptions = {
  openBrowser?: (url: string) => boolean
  timeoutMs?: number
  /** How long the command waits for Meta's confirmation after opening the page. */
  waitForResultMs?: number
  state?: SignInState
  credentials?: () => CredentialsFace | undefined
  /** Capture the background attempt so the command can wait for its result. */
  onAttempt?: (attempt: Promise<{ status: string }>) => void
  /** Override the live catalog fetch, for tests. */
  fetchModelIds?: (accessKey: string) => Promise<string[] | null>
}

/** Actionable instructions extracted from one authorization notice. */
export type SignInInstruction = {
  /** Verification page as the flow reported it. */
  url: string
  /** Verification page with the user code attached when the URL accepts it. */
  completeUrl: string
  code?: string
  message?: string
}

type SignInOutcome =
  | { ok: true; opened: boolean; text: string; url: string; code?: string }
  | { ok: false; reason: "unavailable" | "busy" | "timeout" | "failed" | "ended"; text: string }

/**
 * Register the sign-in command, the Settings > Models routes, the live catalog
 * sync, and the settings write that makes the Muse Code provider visible.
 * @param ctx - Host plugin context.
 */
export function apply(ctx: HostContext): void {
  const state = createSignInState()
  let credentialsFace: CredentialsFace | undefined
  const options: SignInOptions = { state, credentials: () => credentialsFace }

  ctx.effect(() => ctx.commands.register(museLoginCommand(ctx, options)), "dsh-muse-code: /muse-login")
  ctx.on?.("llm/stream", (request: { provider: string }, next: () => AsyncIterable<ModelStreamChunk>) =>
    explainClientRestriction(request.provider, next()),
    { global: true },
  )
  if (typeof ctx.inject !== "function") return

  ctx.inject(["credentials"], (child) => {
    const credentials = child.credentials
    if (credentials === undefined) return
    credentialsFace = credentials
    child.effect(() => {
      const run = () => {
        void syncCredentialState(credentials, { logger: ctx.logger }).catch((error: unknown) => {
          warn(ctx.logger, "dsh-muse-code: could not sync the Muse Code credentials", error)
        })
      }
      run()
      const timer = setInterval(run, REFRESH_CHECK_MS)
      timer.unref?.()
      const dispose = ctx.on?.("credentials/record-updated", (key: string) => {
        if (key === AUTH_KEY) run()
      })
      return () => {
        clearInterval(timer)
        dispose?.()
      }
    }, "dsh-muse-code: credential sync")
  })

  ctx.inject(["webServer"], (child) => {
    const webServer = child.webServer
    if (webServer === undefined) return
    child.effect(() => {
      const disposeLogin = webServer.register({
        kind: "exact",
        path: LOGIN_ROUTE,
        handler: createLoginRouteHandler(ctx, options),
      })
      const disposeStatus = webServer.register({
        kind: "exact",
        path: STATUS_ROUTE,
        handler: createStatusRouteHandler(ctx, options),
      })
      return () => {
        disposeStatus()
        disposeLogin()
      }
    }, "dsh-muse-code: login routes")
  })

  ctx.inject(["settings"], (child) => {
    child.effect(() => {
      const settings = child.settings
      if (settings === undefined) return () => {}
      let sawRoute = false
      let checkTimer: ReturnType<typeof setTimeout> | undefined
      const routeIsDeclared = (): boolean => {
        const row = settings.describe().find((candidate) => candidate.ns === SETTINGS_NS)
        if (row === undefined) return false
        const providers = row.value["providers"]
        return isRecord(providers) && isRecord(providers[PROVIDER])
      }
      const refresh = () => {
        void (async () => {
          await ensureMuseRoute(settings, ctx.logger)
          await syncMuseModels(settings, ctx.logger, options)
          if (routeIsDeclared()) sawRoute = true
        })().catch((error: unknown) => {
          warn(ctx.logger, "dsh-muse-code: could not refresh the Muse Code settings", error)
        })
      }
      // The Models page Delete only unsets the user-layer route; for a
      // plugin-managed provider that reads as a sign-out, so drop the OAuth
      // record and its mirrored reference instead of leaving a green dot for a
      // row that no longer exists.
      const scheduleDeleteCheck = () => {
        if (checkTimer !== undefined) clearTimeout(checkTimer)
        checkTimer = setTimeout(() => {
          checkTimer = undefined
          if (routeIsDeclared()) {
            sawRoute = true
            return
          }
          if (!sawRoute) return
          sawRoute = false
          const credentials = credentialsFace
          if (credentials === undefined) return
          void logoutMuseCode(credentials, ctx.logger).catch((error: unknown) => {
            warn(ctx.logger, "dsh-muse-code: could not sign out after the route was deleted", error)
          })
        }, ROUTE_DELETE_CHECK_MS)
        checkTimer.unref?.()
      }
      refresh()
      const disposers: Array<() => void> = []
      const onRecord = ctx.on?.("credentials/record-updated", (key: string) => {
        if (key === AUTH_KEY) refresh()
      })
      if (onRecord !== undefined) disposers.push(onRecord)
      const onDocument = ctx.on?.("settings/document-updated", (ns: string) => {
        if (ns === SETTINGS_NS) scheduleDeleteCheck()
      })
      if (onDocument !== undefined) disposers.push(onDocument)
      return () => {
        if (checkTimer !== undefined) clearTimeout(checkTimer)
        for (const dispose of disposers) dispose()
      }
    }, "dsh-muse-code: settings")
  })
}

/** Preserve Meta's specific subscription refusal instead of classifying it as an invalid key. */
export async function* explainClientRestriction(
  provider: string,
  chunks: AsyncIterable<ModelStreamChunk>,
): AsyncGenerator<ModelStreamChunk> {
  for await (const chunk of chunks) {
    const failure = chunk.type === "finish" && chunk.reason?.kind === "error"
      ? chunk.reason.failure
      : undefined
    if (provider === PROVIDER && failure !== undefined && (
      /client_attestation_denied/i.test(`${failure.code} ${failure.message}`) ||
      /muse code subscriptions cover requests from the muse code client only/i.test(failure.message)
    )) {
      yield {
        ...chunk,
        reason: {
          ...chunk.reason!,
          failure: {
            ...failure,
            code: "MUSE_CODE_CLIENT_RESTRICTED",
            message: "Meta rejected this request because Muse Code subscriptions cover the Muse Code client only. Signing in again will not change this restriction.",
          },
        },
      }
    } else {
      yield chunk
    }
  }
}

/** Command definition for the sign-in; exported for tests. */
export function museLoginCommand(
  ctx: HostContext,
  options: SignInOptions = {},
): Parameters<CommandFace["register"]>[0] {
  return {
    name: "muse-login",
    description: "Sign in to the Muse Code (Meta) subscription and enable its models",
    async handler() {
      let attempt: Promise<{ status: string }> | undefined
      const started = await startSignIn(ctx, {
        ...options,
        onAttempt: (pending) => {
          attempt = pending
        },
      })
      if (!started.ok) return { kind: "error", text: started.text }
      const waitMs = options.waitForResultMs ?? RESULT_WAIT_MS
      if (!started.opened || attempt === undefined || waitMs <= 0) {
        return { kind: "success", text: started.text }
      }
      const result = await waitForSettlement(attempt, waitMs)
      if (result === undefined) {
        return { kind: "success", text: `${started.text} Still waiting for Meta: the sign-in completes when you approve the page.` }
      }
      if (result.status === "authorized") {
        return { kind: "success", text: "Muse Code is signed in. Model access depends on Meta's subscription policy." }
      }
      return {
        kind: "error",
        text: `Muse Code sign-in ended (${result.status}). Run /muse-login again to retry.`,
      }
    },
  }
}

/**
 * Build the exact Web route that starts the same sign-in from the Settings
 * page. POST answers JSON for the Settings control; GET answers a small page
 * that shows the code and polls the status route until Meta confirms.
 * @param ctx - Host plugin context.
 * @param options - injected side effects, overridable in tests.
 * @returns an HTTP handler for {@link LOGIN_ROUTE}.
 */
export function createLoginRouteHandler(
  ctx: HostContext,
  options: SignInOptions = {},
): (request: IncomingMessage, response: ServerResponse) => Promise<void> {
  return async (request, response) => {
    setCorsHeaders(response)
    if (request.method === "OPTIONS") {
      response.writeHead(204)
      response.end()
      return
    }
    if (request.method === "GET") {
      // A plain navigation: this tab is the browser, so the flow need not open
      // another one. The page itself polls the status route.
      const outcome = await startSignIn(ctx, { ...options, openBrowser: () => false })
      sendHtml(response, signInPage(outcome))
      return
    }
    if (request.method !== "POST") {
      sendJson(response, 405, { ok: false, reason: "method", text: "Use GET or POST to start the sign-in." })
      return
    }
    const outcome = await startSignIn(ctx, options)
    if (outcome.ok) {
      sendJson(response, 200, {
        ok: true,
        text: outcome.text,
        url: outcome.url,
        code: outcome.code,
        opened: outcome.opened,
      })
      return
    }
    const status = outcome.reason === "busy" ? 409 : outcome.reason === "timeout" ? 504 : 500
    sendJson(response, status, { ok: false, reason: outcome.reason, text: outcome.text })
  }
}

/**
 * Build the exact Web route that reports the sign-in state, so the Settings
 * control can flip to "Signed in" after Meta confirms.
 * @param ctx - Host plugin context.
 * @param options - injected side effects, overridable in tests.
 * @returns an HTTP handler for {@link STATUS_ROUTE}.
 */
export function createStatusRouteHandler(
  ctx: HostContext,
  options: SignInOptions = {},
): (request: IncomingMessage, response: ServerResponse) => Promise<void> {
  return async (request, response) => {
    setCorsHeaders(response)
    if (request.method === "OPTIONS") {
      response.writeHead(204)
      response.end()
      return
    }
    if (request.method !== "GET") {
      sendJson(response, 405, { ok: false, text: "Use GET for the sign-in status." })
      return
    }
    const snapshot = options.state?.get()
    try {
      const credentials = options.credentials?.()
      if (credentials !== undefined) {
        const record = await credentials.describeRecord(AUTH_KEY)
        if (record.configured) {
          sendJson(response, 200, { state: "authorized", text: "Muse Code is signed in." })
          return
        }
      }
    } catch {
      // Fall through to the in-memory state.
    }
    const entry = ctx.authorization.describe(AUTH_KEY)
    if (entry?.inFlight === true) {
      sendJson(response, 200, {
        state: "pending",
        ...(snapshot?.text === undefined ? {} : { text: snapshot.text }),
        ...(snapshot?.code === undefined ? {} : { code: snapshot.code }),
      })
      return
    }
    if (snapshot !== undefined && snapshot.state !== "idle") {
      sendJson(response, 200, {
        state: snapshot.state,
        ...(snapshot.text === undefined ? {} : { text: snapshot.text }),
      })
      return
    }
    sendJson(response, 200, { state: "idle" })
  }
}

/**
 * Start one sign-in attempt and wait for the actionable device-code notice.
 * The attempt itself keeps running after the notice, so Meta's approval is
 * picked up and the credential is stored by the seam.
 * @param ctx - Host plugin context.
 * @param options - injected side effects, overridable in tests.
 * @returns the user-facing outcome.
 */
export async function startSignIn(ctx: HostContext, options: SignInOptions = {}): Promise<SignInOutcome> {
  const fail = (reason: Extract<SignInOutcome, { ok: false }>["reason"], text: string): SignInOutcome => {
    options.state?.set({ state: "failed", text, at: Date.now() })
    return { ok: false, reason, text }
  }
  const entry = ctx.authorization.describe(AUTH_KEY)
  if (entry === undefined) {
    return fail(
      "unavailable",
      "Muse Code is unavailable: this DeepSeek Harness build has no Meta sign-in flow " +
        `(${AUTH_KEY}). Update DeepSeek Harness or add the Meta provider under Settings > Models first.`,
    )
  }
  if (entry.inFlight) {
    return fail("busy", "A Muse Code sign-in is already running. Approve it in the browser, then retry.")
  }
  const method = entry.methods.find((candidate) => candidate.id === AUTH_METHOD)?.id
  if (method === undefined) {
    return fail("unavailable", `The Muse Code sign-in flow offers no browser OAuth method (${AUTH_KEY}).`)
  }

  const openBrowser = options.openBrowser ?? openExternal
  const timeoutMs = options.timeoutMs ?? NOTICE_TIMEOUT_MS
  let announced: SignInInstruction | undefined
  let announce: (instruction: SignInInstruction) => void = () => {}
  const notice = new Promise<SignInInstruction>((resolve) => {
    announce = resolve
  })
  const attempt = ctx.authorization.begin({
    key: AUTH_KEY,
    method,
    interaction: {
      notify(value) {
        const instruction = readSignInNotice(value)
        if (instruction === undefined) return
        announced = instruction
        announce(instruction)
      },
      prompt() {
        return Promise.reject(new Error("Muse Code sign-in does not accept interactive prompts"))
      },
    },
  })
  options.onAttempt?.(attempt)
  // The attempt outlives the request that started it: Meta approval arrives
  // later and the seam stores the credential then.
  attempt.then(
    (outcome) => {
      options.state?.set({
        state: outcome.status === "authorized" ? "authorized" : "cancelled",
        text:
          outcome.status === "authorized"
            ? "Muse Code is signed in."
            : `Muse Code sign-in ended (${outcome.status}).`,
        at: Date.now(),
      })
      ctx.logger?.info?.(`dsh-muse-code: sign-in settled as ${outcome.status}`)
    },
    (failure: unknown) => {
      const text = `Muse Code sign-in failed: ${messageOf(failure)}`
      options.state?.set({ state: "failed", text, at: Date.now() })
      warn(ctx.logger, "dsh-muse-code: sign-in failed", failure)
    },
  )

  const announcedNotice = notice.then((instruction) => ({ kind: "notice" as const, instruction }))
  const settled = attempt.then(
    (outcome) => ({ kind: "settled" as const, outcome }),
    (failure: unknown) => ({ kind: "failed" as const, failure }),
  )
  const timer: { handle?: ReturnType<typeof setTimeout> } = {}
  const timeout = new Promise<{ kind: "timeout" }>((resolve) => {
    timer.handle = setTimeout(() => resolve({ kind: "timeout" }), timeoutMs)
    timer.handle.unref?.()
  })
  try {
    const outcome = await Promise.race([announcedNotice, settled, timeout])
    if (outcome.kind === "notice") return successOutcome(outcome.instruction, openBrowser, options.state)
    if (outcome.kind === "timeout") {
      ctx.authorization.cancel?.(AUTH_KEY)
      return fail(
        "timeout",
        "Muse Code sign-in did not answer in time. Check the connection and run /muse-login again.",
      )
    }
    if (outcome.kind === "failed") {
      const text = messageOf(outcome.failure)
      if (/already running/i.test(text)) {
        return fail("busy", "A Muse Code sign-in is already running. Approve it in the browser, then retry.")
      }
      return fail("failed", `Muse Code sign-in failed: ${text}`)
    }
    if (announced !== undefined) return successOutcome(announced, openBrowser, options.state)
    if (outcome.outcome.status === "authorized") {
      return fail("ended", "Muse Code sign-in finished without showing a code. Run /muse-login again if the models stay unavailable.")
    }
    return fail("ended", `Muse Code sign-in ended (${outcome.outcome.status}).`)
  } finally {
    if (timer.handle !== undefined) clearTimeout(timer.handle)
  }
}

function successOutcome(
  instruction: SignInInstruction,
  openBrowser: (url: string) => boolean,
  state: SignInState | undefined,
): SignInOutcome {
  // The browser hand-off is a courtesy for a purely local effect: the user must
  // still confirm the code on Meta's page, and both surfaces expose the URL.
  const opened = openBrowser(instruction.completeUrl)
  const text = formatSignInText(instruction, opened)
  state?.set({
    state: "pending",
    text,
    ...(instruction.code === undefined ? {} : { code: instruction.code }),
    at: Date.now(),
  })
  return {
    ok: true,
    opened,
    url: instruction.completeUrl,
    ...(instruction.code === undefined ? {} : { code: instruction.code }),
    text,
  }
}

/**
 * Wait for one sign-in attempt to settle, bounded by the caller's deadline.
 * @param attempt - the background attempt promise.
 * @param waitMs - upper bound in milliseconds.
 * @returns the settled outcome, or undefined on timeout/failure to settle.
 */
export async function waitForSettlement(
  attempt: Promise<{ status: string }>,
  waitMs: number,
): Promise<{ status: string } | undefined> {
  const settled = attempt.then(
    (outcome) => outcome,
    () => ({ status: "failed" }),
  )
  let timer: ReturnType<typeof setTimeout> | undefined
  const deadline = new Promise<undefined>((resolve) => {
    timer = setTimeout(() => resolve(undefined), waitMs)
    timer.unref?.()
  })
  try {
    return await Promise.race([settled, deadline])
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
}

/**
 * Read the actionable instruction out of one authorization notice.
 * @param notice - a seam notice (`message`/`url`/`code`) or a raw adapter one.
 * @returns the instruction, or undefined for progress notices with no page.
 */
export function readSignInNotice(notice: AuthorizationNotice): SignInInstruction | undefined {
  const rawUrl = firstNonEmptyString(notice.url, notice.verificationUri)
  if (rawUrl === undefined) return undefined
  let url: URL
  try {
    url = new URL(rawUrl)
  } catch {
    return undefined
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return undefined
  const code = firstNonEmptyString(notice.code, notice.userCode)
  const message = firstNonEmptyString(notice.message, notice.instructions)
  if (code !== undefined && !url.searchParams.has("code")) url.searchParams.set("code", code)
  return {
    url: rawUrl,
    completeUrl: url.toString(),
    ...(code === undefined ? {} : { code }),
    ...(message === undefined ? {} : { message }),
  }
}

/**
 * Render the instruction text shared by the command result and the Settings
 * control.
 * @param instruction - actionable notice.
 * @param opened - whether the browser hand-off was started.
 * @returns one line the user can act on.
 */
export function formatSignInText(instruction: SignInInstruction, opened: boolean): string {
  const openPart = opened
    ? "A browser tab should have opened."
    : "Open the sign-in page in your browser."
  const codePart = instruction.code === undefined
    ? "Confirm the sign-in on Meta's page."
    : `Confirm the code ${instruction.code} there.`
  return `Muse Code sign-in started. ${openPart} ${codePart} The models become available as soon as Meta confirms.`
}

/**
 * Declare the shipped `meta` route in the `llm-pi-ai` settings section so the
 * provider appears in Settings > Models and its models in the picker.
 *
 * The write is a merge into the entry's editable config, exactly what the
 * Models page does when a user adds this provider by hand; an already declared
 * `meta` profile is never touched.
 *
 * @param settings - the Settings form service.
 * @param logger - optional plugin logger.
 * @param options - retry window for late-activating profile entries.
 * @returns whether this call added the route.
 */
export async function ensureMuseRoute(
  settings: SettingsFace,
  logger?: Logger,
  options: { attempts?: number; delayMs?: number } = {},
): Promise<boolean> {
  const attempts = options.attempts ?? 12
  const delayMs = options.delayMs ?? 250
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const row = settings.describe().find((candidate) => candidate.ns === SETTINGS_NS)
    if (row !== undefined) {
      const providers = row.value["providers"]
      const declared = isRecord(providers) && Object.hasOwn(providers, PROVIDER)
      if (!declared) {
        await settings.update(
          SETTINGS_NS,
          { providers: { [PROVIDER]: { displayName: ROUTE_LABEL, apiKeyEnv: CREDENTIAL_REFERENCE } } },
          row.revision,
        )
        logger?.info?.(`dsh-muse-code: declared the ${PROVIDER} route in Settings > Models`)
        return true
      }
      const profile = isRecord(providers) ? providers[PROVIDER] : undefined
      if (isRecord(profile) && profile["apiKeyEnv"] === undefined) {
        // The Models page paints the row's credential dot only for a route that
        // names a reference; add ours without touching the rest of the profile.
        await settings.update(
          SETTINGS_NS,
          { providers: { [PROVIDER]: { apiKeyEnv: CREDENTIAL_REFERENCE } } },
          row.revision,
        )
        logger?.info?.(`dsh-muse-code: linked the ${PROVIDER} route to ${CREDENTIAL_REFERENCE}`)
        return true
      }
      return false
    }
    if (attempt < attempts - 1 && delayMs > 0) await sleep(delayMs)
  }
  logger?.debug?.(`dsh-muse-code: no configurable "${SETTINGS_NS}" entry; leaving the route to Settings > Models`)
  return false
}

/**
 * Sync the account's live chat catalog into the declared route.
 *
 * Meta lists the subscription catalog behind the minted key and publishes no
 * static metadata, so the ids are turned into conservative DSH model entries:
 * the five Muse Spark rows keep the shipped catalog's fidelity, every other
 * chat id (Muse Wonder included) takes the family defaults. A route that
 * already declares its own `models` list is left untouched.
 *
 * @param settings - the Settings form service.
 * @param logger - optional plugin logger.
 * @param options - credentials access and fetch override, for tests.
 * @returns whether this call wrote a model list.
 */
export async function syncMuseModels(
  settings: SettingsFace,
  logger?: Logger,
  options: Pick<SignInOptions, "credentials" | "fetchModelIds"> = {},
): Promise<boolean> {
  const credentials = await waitForCredentials(options.credentials)
  if (credentials === undefined) return false
  const accessKey = await readSubscriptionKey(credentials)
  if (accessKey === undefined) return false
  const row = settings.describe().find((candidate) => candidate.ns === SETTINGS_NS)
  if (row === undefined) return false
  const providers = row.value["providers"]
  if (!isRecord(providers) || !isRecord(providers[PROVIDER])) return false
  const profile = providers[PROVIDER]
  // The Settings form projects absent arrays as `[]`, so only a non-empty
  // declared list counts as a user-owned catalog.
  const declaredModels = profile["models"]
  if (declaredModels !== undefined && (!Array.isArray(declaredModels) || declaredModels.length > 0)) return false
  const ids = await (options.fetchModelIds ?? fetchLiveModelIds)(accessKey)
  if (ids === null || ids.length === 0) {
    logger?.debug?.("dsh-muse-code: live catalog unavailable; keeping the shipped pi-ai catalog")
    return false
  }
  const models = ids.filter(isChatModelId).map(museModelEntry)
  if (models.length === 0) return false
  await settings.update(
    SETTINGS_NS,
    { providers: { [PROVIDER]: { displayName: ROUTE_LABEL, models } } },
    row.revision,
  )
  logger?.info?.(`dsh-muse-code: synced ${String(models.length)} Muse models from the account catalog`)
  return true
}

/** Map one live model id to a conservative DSH pi-ai model entry. */
export function museModelEntry(id: string): Record<string, unknown> {
  const known = SPARK_MODELS[id]
  const name = known?.name ?? prettifyModelName(id)
  const withMax = known?.max === true
  const reasoningEfforts: Record<string, string> = {
    minimal: "minimal",
    low: "low",
    medium: "medium",
    high: "high",
    xhigh: "xhigh",
    ...(withMax ? { max: "max" } : {}),
  }
  return {
    id,
    name,
    contextWindow: MUSE_CONTEXT_WINDOW,
    maxTokens: MUSE_MAX_OUTPUT_TOKENS,
    input: ["text", "image"],
    reasoningEfforts,
  }
}

/** Whether one catalog id is a chat model this route can serve. */
export function isChatModelId(id: string): boolean {
  return !NON_CHAT_PREFIXES.some((prefix) => id.startsWith(prefix))
}

/** Turn a live model id into a display name ("muse-wonder-full-1.0"). */
export function prettifyModelName(id: string): string {
  if (!id.startsWith("muse-")) return id
  return id
    .split("-")
    .map((part) => (/^\d/.test(part) ? part : part.charAt(0).toUpperCase() + part.slice(1)))
    .join(" ")
}

/**
 * Fetch the account's live chat catalog.
 * @param accessKey - minted subscription key stored in the OAuth record.
 * @param timeoutMs - request bound.
 * @returns the chat model ids, or null on any failure.
 */
export async function fetchLiveModelIds(
  accessKey: string,
  timeoutMs: number = MODELS_TIMEOUT_MS,
): Promise<string[] | null> {
  try {
    const response = await fetch(MODELS_URL, {
      headers: { Accept: "application/json", Authorization: `Bearer ${accessKey}` },
      signal: AbortSignal.timeout(timeoutMs),
    })
    if (!response.ok) return null
    const body: unknown = await response.json()
    if (!isRecord(body) || !Array.isArray(body["data"])) return null
    const ids: string[] = []
    for (const row of body["data"]) {
      if (isRecord(row) && typeof row["id"] === "string" && row["id"].length > 0) ids.push(row["id"])
    }
    return ids
  } catch {
    return null
  }
}

async function readSubscriptionKey(credentials: CredentialsFace): Promise<string | undefined> {
  try {
    const record = await credentials.readRecord(AUTH_KEY)
    const payload = record?.payload
    if (!isRecord(payload)) return undefined
    const access = payload["access"]
    return typeof access === "string" && access.length > 0 ? access : undefined
  } catch {
    return undefined
  }
}

async function waitForCredentials(
  getter: (() => CredentialsFace | undefined) | undefined,
  attempts = 8,
  delayMs = 250,
): Promise<CredentialsFace | undefined> {
  if (getter === undefined) return undefined
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const face = getter()
    if (face !== undefined) return face
    if (attempt < attempts - 1 && delayMs > 0) await sleep(delayMs)
  }
  return undefined
}

/**
 * Sign out of Muse Code: drop the OAuth record and the route's mirrored
 * credential reference. The Models page's **Delete** action only unsets the
 * user-layer route, so the plugin treats that removal as a sign-out rather
 * than leaving credentials behind for a row that no longer exists.
 * @param credentials - the credential seam.
 * @param logger - optional plugin logger.
 */
export async function logoutMuseCode(credentials: CredentialsFace, logger?: Logger): Promise<void> {
  let failed = false
  try {
    await credentials.deleteRecord?.(AUTH_KEY)
  } catch (error) {
    failed = true
    warn(logger, "dsh-muse-code: could not delete the Muse Code record", error)
  }
  try {
    await credentials.unset?.(CREDENTIAL_REFERENCE)
  } catch (error) {
    failed = true
    warn(logger, "dsh-muse-code: could not clear the Muse Code credential reference", error)
  }
  if (!failed) logger?.info?.("dsh-muse-code: deleted the route in Settings > Models; signed out")
}

/** Injected side effects for the credential bridge, overridable in tests. */
export type CredentialSyncOptions = {
  logger?: Logger
  fetchImpl?: typeof fetch
  now?: () => number
  refreshWindowMs?: number
}

/**
 * Keep the route's credential reference equal to the OAuth record's minted key
 * and re-mint that key before it expires.
 *
 * The route names `apiKeyEnv: MUSE_CODE_SUB_TOKEN` so DSH paints its credential
 * dot; an explicit reference is also the highest-priority auth override, which
 * means the plugin must keep it fresh itself. The OAuth record stays the source
 * of truth (the shipped flow wrote it, and it carries the non-renewable identity
 * token), so this only mirrors its `access` field and rotates it ahead of
 * expiry through the pinned key-mint endpoint.
 *
 * @param credentials - the credential seam.
 * @param options - injected side effects, overridable in tests.
 * @returns which steps ran.
 */
export async function syncCredentialState(
  credentials: CredentialsFace,
  options: CredentialSyncOptions = {},
): Promise<{ refreshed: boolean; mirrored: boolean }> {
  const refreshed = await refreshCredentialRecord(credentials, options)
  const mirrored = await mirrorCredentialReference(credentials, options)
  return { refreshed, mirrored }
}

/**
 * Copy the record's minted inference key into the route's credential reference,
 * or clear the reference when the record is gone (the row then shows red).
 * @param credentials - the credential seam.
 * @param options - injected side effects.
 * @returns whether the stored reference now carries a key.
 */
export async function mirrorCredentialReference(
  credentials: CredentialsFace,
  options: CredentialSyncOptions = {},
): Promise<boolean> {
  let access: string | undefined
  try {
    const record = await credentials.readRecord(AUTH_KEY)
    const payload = isRecord(record?.payload) ? record.payload : undefined
    access = typeof payload?.["access"] === "string" && payload["access"].length > 0 ? payload["access"] : undefined
  } catch (error) {
    warn(options.logger, "dsh-muse-code: could not read the Muse Code record", error)
    return false
  }
  try {
    if (access === undefined) {
      await credentials.unset?.(CREDENTIAL_REFERENCE)
      return false
    }
    const current = credentials.resolve === undefined ? undefined : await credentials.resolve(CREDENTIAL_REFERENCE)
    if (current?.value !== access) await credentials.set?.(CREDENTIAL_REFERENCE, access)
    return true
  } catch (error) {
    warn(options.logger, "dsh-muse-code: could not mirror the Muse Code credential", error)
    return false
  }
}

/**
 * Re-mint the inference key from the record's identity token when the current
 * key is close to expiry, and store it back into the record.
 * @param credentials - the credential seam.
 * @param options - injected side effects.
 * @returns whether a fresh key was minted and stored.
 */
export async function refreshCredentialRecord(
  credentials: CredentialsFace,
  options: CredentialSyncOptions = {},
): Promise<boolean> {
  if (credentials.modifyRecord === undefined) return false
  const now = options.now?.() ?? Date.now()
  let identity: string | undefined
  let expires: number | undefined
  try {
    const record = await credentials.readRecord(AUTH_KEY)
    const payload = isRecord(record?.payload) ? record.payload : undefined
    identity = typeof payload?.["refresh"] === "string" && payload["refresh"].length > 0 ? payload["refresh"] : undefined
    expires = typeof payload?.["expires"] === "number" ? payload["expires"] : undefined
  } catch {
    return false
  }
  if (identity === undefined) return false
  if (expires !== undefined && expires - now > (options.refreshWindowMs ?? REFRESH_WINDOW_MS)) return false
  let minted: string | undefined
  try {
    minted = await mintInferenceKey(identity, options.fetchImpl ?? fetch)
  } catch (error) {
    warn(options.logger, "dsh-muse-code: could not refresh the Muse Code key", error)
    return false
  }
  if (minted === undefined) return false
  try {
    await credentials.modifyRecord(AUTH_KEY, async (current) => {
      const payload = isRecord(current?.payload) ? current.payload : undefined
      // Another writer (a fresh sign-in) replaced the identity token meanwhile:
      // keep its record instead of stamping a key minted from the old session.
      if (payload === undefined || payload["refresh"] !== identity) return current
      return {
        ...current,
        payload: { ...payload, access: minted, expires: now + KEY_LIFETIME_MS },
      }
    })
    return true
  } catch (error) {
    warn(options.logger, "dsh-muse-code: could not store the refreshed Muse Code key", error)
    return false
  }
}

/**
 * Exchange the non-renewable Meta identity token for a fresh inference key.
 * @param identityToken - the record's `refresh` field.
 * @param fetchImpl - injectable fetch.
 * @param timeoutMs - request bound.
 * @returns the minted key, or undefined on any failure.
 */
export async function mintInferenceKey(
  identityToken: string,
  fetchImpl: typeof fetch = fetch,
  timeoutMs: number = MODELS_TIMEOUT_MS,
): Promise<string | undefined> {
  const response = await fetchImpl(KEY_MINT_URL, {
    method: "POST",
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${identityToken}`,
      "Content-Type": "application/json",
      "x-api-version": "1.0.0",
    },
    body: "{}",
    signal: AbortSignal.timeout(timeoutMs),
  })
  if (!response.ok) return undefined
  const body: unknown = await response.json()
  if (!isRecord(body)) return undefined
  const apiKey = body["api_key"]
  return typeof apiKey === "string" && apiKey.length > 0 ? apiKey : undefined
}

function setCorsHeaders(response: ServerResponse): void {
  response.setHeader("Access-Control-Allow-Origin", "*")
  response.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
  response.setHeader("Access-Control-Allow-Headers", "content-type")
  response.setHeader("Cache-Control", "no-store")
}

function sendJson(response: ServerResponse, status: number, body: unknown): void {
  const text = JSON.stringify(body)
  response.writeHead(status, { "content-type": "application/json; charset=utf-8" })
  response.end(text)
}

function sendHtml(response: ServerResponse, html: string): void {
  response.writeHead(200, { "content-type": "text/html; charset=utf-8" })
  response.end(html)
}

/**
 * The page a plain navigation to {@link LOGIN_ROUTE} receives: the code, a link
 * to Meta, and a poll of {@link STATUS_ROUTE} until the sign-in completes.
 * @param outcome - result of the sign-in attempt.
 * @returns a self-contained HTML document.
 */
export function signInPage(outcome: SignInOutcome): string {
  const title = "Muse Code sign-in"
  if (!outcome.ok) {
    return `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title></head>` +
      `<body style="font-family:system-ui,sans-serif;padding:2rem;line-height:1.6;max-width:42rem">` +
      `<h1 style="font-size:1.15rem">${escapeHtml(title)}</h1>` +
      `<p>${escapeHtml(outcome.text)}</p>` +
      `<p><a href="${LOGIN_ROUTE}">Try again</a></p></body></html>`
  }
  const codeBlock = outcome.code === undefined
    ? ""
    : `<p style="margin:1rem 0;font-size:1.5rem;letter-spacing:0.12em;font-family:ui-monospace,Consolas,monospace"><strong>${escapeHtml(outcome.code)}</strong></p>`
  return `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title></head>` +
    `<body style="font-family:system-ui,sans-serif;padding:2rem;line-height:1.6;max-width:42rem">` +
    `<h1 style="font-size:1.15rem">${escapeHtml(title)}</h1>` +
    `<p>Confirm this code on Meta's page:</p>${codeBlock}` +
    `<p><a href="${escapeHtml(outcome.url)}" target="_blank" rel="noreferrer">Open the Meta sign-in page</a></p>` +
    `<p id="status" style="color:#6b7280">Waiting for Meta to confirm…</p>` +
    `<script>(function(){var el=document.getElementById('status');var tries=0;` +
    `function poll(){if(tries++>150){el.textContent='Still waiting. You can close this page and retry from Settings > Models.';return}` +
    `fetch('${STATUS_ROUTE}',{headers:{accept:'application/json'}}).then(function(r){return r.json()})` +
    `.then(function(s){if(!s){setTimeout(poll,2000);return}` +
    `if(s.state==='authorized'){document.body.innerHTML='<h1 style="font-size:1.15rem">Muse Code</h1><p>Signed in. Model access depends on the Meta subscription policy.</p>';return}` +
    `if(s.state==='failed'||s.state==='cancelled'){document.body.innerHTML='<h1 style="font-size:1.15rem">Muse Code</h1><p>'+String(s.text||'Sign-in did not complete.').replace(/[<>&]/g,'')+'</p>';return}` +
    `el.textContent='Waiting for Meta to confirm…';setTimeout(poll,2000)})` +
    `.catch(function(){setTimeout(poll,3000)})}poll()})()</script>` +
    `</body></html>`
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
}

function firstNonEmptyString(...values: Array<string | undefined>): string | undefined {
  for (const value of values) {
    if (typeof value === "string" && value.trim().length > 0) return value.trim()
  }
  return undefined
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function messageOf(failure: unknown): string {
  if (failure instanceof Error && failure.message.length > 0) return failure.message
  const text = String(failure)
  return text.length > 0 ? text : "unknown error"
}

function warn(logger: Logger | undefined, message: string, error: unknown): void {
  const text = `${message}: ${messageOf(error)}`
  if (logger?.warn !== undefined) logger.warn(text)
  else if (logger?.debug !== undefined) logger.debug(text)
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const handle = setTimeout(resolve, ms)
    handle.unref?.()
  })
}
