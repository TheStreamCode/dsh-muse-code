import { test } from "node:test"
import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import {
  apply,
  createLoginRouteHandler,
  createSignInState,
  createStatusRouteHandler,
  ensureMuseRoute,
  fetchLiveModelIds,
  formatSignInText,
  isChatModelId,
  inject,
  LOGIN_ROUTE,
  museLoginCommand,
  museModelEntry,
  name,
  prettifyModelName,
  readSignInNotice,
  STATUS_ROUTE,
  syncMuseModels,
} from "../lib/index.js"

const PACKAGE = "@thestreamcode/dsh-muse-code"
const FLOW = {
  key: "llm-pi-ai/meta",
  label: "Meta",
  methods: [
    { id: "oauth", label: "Sign in with Meta" },
    { id: "api-key", label: "Meta Model API key" },
  ],
  inFlight: false,
}
const NEUTRAL_NOTICE = {
  message: "Enter this code on the verification page to finish signing in.",
  url: "https://auth.meta.com/oauth/device/",
  code: "ABCD-EFGH",
}

function makeSettings(rows) {
  const updates = []
  const settings = {
    describe() {
      return rows.map((row) => ({ ...row }))
    },
    async update(ns, patch, revision) {
      updates.push({ ns, patch, revision })
    },
  }
  return { settings, updates }
}

function makeCredentials(configured = false, payload = undefined) {
  return {
    async describeRecord() {
      return { configured }
    },
    async readRecord() {
      return configured ? { kind: "grant", payload } : undefined
    },
  }
}

function makeContext(options = {}) {
  const flow = "flow" in options ? options.flow : FLOW
  const credentials = options.credentials ?? makeCredentials(false)
  const settingsRows = options.settingsRows ?? [
    { ns: "llm-pi-ai", revision: 3, value: { providers: { meta: { displayName: "Muse Code (Meta subscription)" } } } },
  ]
  const commands = []
  const children = []
  const routes = []
  const cancels = []
  const { settings, updates } = makeSettings(settingsRows)
  const ctx = {
    credentials,
    authorization: {
      describe(key) {
        assert.equal(key, "llm-pi-ai/meta")
        if (flow === undefined) return undefined
        return { ...flow, ...(options.inFlight === undefined ? {} : { inFlight: options.inFlight }) }
      },
      async begin() {
        throw new Error("unexpected begin")
      },
      cancel(key) {
        cancels.push(key)
      },
    },
    commands: {
      register(definition) {
        commands.push(definition)
        return () => {}
      },
    },
    logger: { info() {}, warn() {}, debug() {} },
    effect(callback) {
      return callback()
    },
    inject(dependencies, callback) {
      children.push({ dependencies })
      callback({ ...ctx, settings, credentials, webServer: { register(route) { routes.push(route); return () => {} } } })
      return () => {}
    },
    on() {
      return () => {}
    },
  }
  return { ctx, commands, children, routes, cancels, updates, settings, credentials }
}

function makeResponse() {
  const state = { status: 0, headers: {}, body: "" }
  const response = {
    setHeader(name, value) {
      state.headers[name.toLowerCase()] = value
    },
    writeHead(status, headers) {
      state.status = status
      for (const [name, value] of Object.entries(headers ?? {})) state.headers[name.toLowerCase()] = value
    },
    end(text) {
      state.body = text === undefined ? "" : String(text)
    },
  }
  return { response, state }
}

test("manifest: bundle patch inserts one row and the client half is exported", async () => {
  const manifest = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"))
  assert.deepEqual(manifest.dsh.bundle, { patch: "./cordis.patch.yml" })
  assert.equal(manifest.dsh.client.platform, "web")
  assert.equal(manifest.exports["./client"], "./client/client.js")
  assert.ok(manifest.files.includes("client/client.js"))
  assert.ok(manifest.files.includes("locale/*.json"))

  const patch = await readFile(new URL("../cordis.patch.yml", import.meta.url), "utf8")
  assert.match(patch, new RegExp(`name: '${PACKAGE}'`))
  assert.equal(patch.match(/- id: muse-code/g)?.length, 1)
  assert.doesNotMatch(patch, /^\s*- id: muse-code-llm/m)
  assert.doesNotMatch(patch, /^\s*name: '@deepseek-ai\/dsh-llm-pi-ai'/m)
})

test("plugin registers the command, both routes, the settings write, and credentials", () => {
  const { ctx, commands, children, routes } = makeContext()
  apply(ctx)
  assert.equal(name, "dsh-muse-code")
  assert.deepEqual(inject, ["authorization", "commands"])
  assert.equal(commands.length, 1)
  assert.equal(commands[0].name, "muse-login")
  assert.deepEqual(children.map((child) => child.dependencies), [["credentials"], ["webServer"], ["settings"]])
  assert.deepEqual(
    routes.map((route) => [route.kind, route.path]),
    [
      ["exact", LOGIN_ROUTE],
      ["exact", STATUS_ROUTE],
    ],
  )
})

test("route declaration merges the meta provider only when absent", async () => {
  const absent = makeSettings([{ ns: "llm-pi-ai", revision: 7, value: { providers: { "opencode-go": { apiKeyEnv: "X" } } } }])
  assert.equal(await ensureMuseRoute(absent.settings, undefined, { attempts: 1 }), true)
  assert.equal(absent.updates.length, 1)
  assert.deepEqual(absent.updates[0].patch, {
    providers: { meta: { displayName: "Muse Code (Meta subscription)" } },
  })

  const declared = makeSettings([{ ns: "llm-pi-ai", revision: 1, value: { providers: { meta: { displayName: "kept" } } } }])
  assert.equal(await ensureMuseRoute(declared.settings, undefined, { attempts: 1 }), false)
  assert.equal(declared.updates.length, 0)
})

test("seam notices and raw adapter notices both become instructions", () => {
  const neutral = readSignInNotice(NEUTRAL_NOTICE)
  assert.deepEqual(neutral, {
    url: NEUTRAL_NOTICE.url,
    completeUrl: `${NEUTRAL_NOTICE.url}?code=ABCD-EFGH`,
    code: "ABCD-EFGH",
    message: NEUTRAL_NOTICE.message,
  })
  const raw = readSignInNotice({
    type: "device_code",
    userCode: "WXYZ",
    verificationUri: "https://auth.meta.com/oauth/device/?theme=dark",
  })
  assert.equal(raw.completeUrl, "https://auth.meta.com/oauth/device/?theme=dark&code=WXYZ")
  assert.equal(readSignInNotice({ message: "Signing in…" }), undefined)
  assert.equal(readSignInNotice({ url: "not a url" }), undefined)
  assert.equal(readSignInNotice({ url: "file:///etc/passwd" }), undefined)
})

test("instruction text carries the code and the browser hint", () => {
  const instruction = readSignInNotice(NEUTRAL_NOTICE)
  const opened = formatSignInText(instruction, true)
  assert.match(opened, /ABCD-EFGH/)
  assert.match(opened, /browser tab should have opened/)
  assert.doesNotMatch(opened, /https:\/\/auth\.meta\.com/)
  assert.match(formatSignInText(instruction, false), /Open the sign-in page/)
})

test("the command waits for Meta and reports the final state", async () => {
  const { ctx } = makeContext()
  const opened = []
  ctx.authorization.begin = async (request) => {
    request.interaction.notify(NEUTRAL_NOTICE)
    await new Promise((resolve) => setTimeout(resolve, 10))
    return { status: "authorized" }
  }
  const result = await museLoginCommand(ctx, {
    openBrowser(url) {
      opened.push(url)
      return true
    },
  }).handler({})
  assert.equal(result.kind, "success")
  assert.match(result.text, /signed in/i)
  assert.deepEqual(opened, [NEUTRAL_NOTICE.url + "?code=ABCD-EFGH"])
})

test("the command returns the instructions when no browser opened", async () => {
  const { ctx } = makeContext()
  ctx.authorization.begin = async (request) => {
    request.interaction.notify(NEUTRAL_NOTICE)
    return new Promise((resolve) => setTimeout(() => resolve({ status: "cancelled" }), 60))
  }
  const result = await museLoginCommand(ctx, { openBrowser: () => false, waitForResultMs: 0 }).handler({})
  assert.equal(result.kind, "success")
  assert.match(result.text, /ABCD-EFGH/)
})

test("the command reports a missing flow, a busy flow, and a failed attempt", async () => {
  const missing = makeContext({ flow: undefined })
  const missingResult = await museLoginCommand(missing.ctx).handler({})
  assert.equal(missingResult.kind, "error")
  assert.match(missingResult.text, /Muse Code is unavailable/)

  const busy = makeContext({ inFlight: true })
  const busyResult = await museLoginCommand(busy.ctx).handler({})
  assert.equal(busyResult.kind, "error")
  assert.match(busyResult.text, /already running/)

  const failing = makeContext()
  failing.ctx.authorization.begin = async () => {
    throw new Error("Meta login was denied.")
  }
  const failedResult = await museLoginCommand(failing.ctx).handler({})
  assert.equal(failedResult.kind, "error")
  assert.match(failedResult.text, /Meta login was denied\./)
})

test("the login route starts the sign-in and answers JSON with CORS", async () => {
  const { ctx } = makeContext()
  ctx.authorization.begin = async (request) => {
    request.interaction.notify(NEUTRAL_NOTICE)
    return { status: "authorized" }
  }
  const handler = createLoginRouteHandler(ctx, { openBrowser: () => true })
  const { response, state } = makeResponse()
  await handler({ method: "POST" }, response)
  assert.equal(state.status, 200)
  assert.equal(state.headers["access-control-allow-origin"], "*")
  const payload = JSON.parse(state.body)
  assert.equal(payload.ok, true)
  assert.equal(payload.code, "ABCD-EFGH")
  assert.equal(payload.opened, true)
})

test("the login route answers a plain navigation with a polling page", async () => {
  const { ctx } = makeContext()
  ctx.authorization.begin = async (request) => {
    request.interaction.notify(NEUTRAL_NOTICE)
    return { status: "authorized" }
  }
  const handler = createLoginRouteHandler(ctx, { openBrowser: () => true })
  const { response, state } = makeResponse()
  await handler({ method: "GET" }, response)
  assert.equal(state.status, 200)
  assert.match(state.headers["content-type"] ?? "", /text\/html/)
  assert.match(state.body, /ABCD-EFGH/)
  assert.match(state.body, new RegExp(STATUS_ROUTE))
})

test("the login route reports a busy flow and times out with a cancel", async () => {
  const busy = makeContext({ inFlight: true })
  const busyResponse = makeResponse()
  await createLoginRouteHandler(busy.ctx)({ method: "POST" }, busyResponse.response)
  assert.equal(busyResponse.state.status, 409)
  assert.equal(JSON.parse(busyResponse.state.body).reason, "busy")

  const slow = makeContext()
  slow.ctx.authorization.begin = () => new Promise((resolve) => setTimeout(() => resolve({ status: "cancelled" }), 50))
  const slowResponse = makeResponse()
  await createLoginRouteHandler(slow.ctx, { timeoutMs: 5 })({ method: "POST" }, slowResponse.response)
  assert.equal(slowResponse.state.status, 504)
  assert.deepEqual(slow.cancels, ["llm-pi-ai/meta"])
})

test("the status route reports authorized, pending, failed, and idle", async () => {
  const authorized = makeContext({ credentials: makeCredentials(true) })
  const authorizedResponse = makeResponse()
  await createStatusRouteHandler(authorized.ctx, { credentials: () => authorized.credentials })(
    { method: "GET" },
    authorizedResponse.response,
  )
  assert.equal(JSON.parse(authorizedResponse.state.body).state, "authorized")

  const state = createSignInState()
  state.set({ state: "pending", text: "Confirm", code: "ABCD", at: Date.now() })
  const pending = makeContext({ inFlight: true })
  const pendingResponse = makeResponse()
  await createStatusRouteHandler(pending.ctx, { state, credentials: () => pending.credentials })(
    { method: "GET" },
    pendingResponse.response,
  )
  const pendingBody = JSON.parse(pendingResponse.state.body)
  assert.equal(pendingBody.state, "pending")
  assert.equal(pendingBody.code, "ABCD")

  const failedState = createSignInState()
  failedState.set({ state: "failed", text: "Denied", at: Date.now() })
  const failed = makeContext()
  const failedResponse = makeResponse()
  await createStatusRouteHandler(failed.ctx, { state: failedState, credentials: () => failed.credentials })(
    { method: "GET" },
    failedResponse.response,
  )
  assert.equal(JSON.parse(failedResponse.state.body).state, "failed")

  const idle = makeContext()
  const idleResponse = makeResponse()
  await createStatusRouteHandler(idle.ctx, { credentials: () => idle.credentials })(
    { method: "GET" },
    idleResponse.response,
  )
  assert.equal(JSON.parse(idleResponse.state.body).state, "idle")
})

test("model entries mirror the catalog for Spark and use family defaults otherwise", () => {
  assert.equal(prettifyModelName("muse-wonder-full-1.0-contributor"), "Muse Wonder Full 1.0 Contributor")
  const spark13 = museModelEntry("muse-spark-1.3")
  assert.equal(spark13.name, "Muse Spark 1.3")
  assert.equal(spark13.contextWindow, 1_048_576)
  assert.equal(spark13.maxTokens, 131_072)
  assert.equal(spark13.reasoningEfforts.max, "max")
  assert.equal(museModelEntry("muse-spark-1.2").reasoningEfforts.max, undefined)
  const wonder = museModelEntry("muse-wonder-1.0")
  assert.equal(wonder.name, "Muse Wonder 1.0")
  assert.equal(wonder.reasoningEfforts.max, undefined)

  assert.equal(isChatModelId("muse-wonder-1.0"), true)
  assert.equal(isChatModelId("muse-image-1.0"), false)
  assert.equal(isChatModelId("muse-voice-transcribe-1.0"), false)
  assert.equal(isChatModelId("sam-segmentation"), false)
})

test("the model sync writes the live chat catalog into the declared route", async () => {
  const { settings, updates } = makeContext()
  const wrote = await syncMuseModels(settings, undefined, {
    credentials: () => makeCredentials(true, { access: "secret-key" }),
    fetchModelIds: async (access) => {
      assert.equal(access, "secret-key")
      return ["muse-spark-1.3", "muse-wonder-1.0", "muse-image-1.0"]
    },
  })
  assert.equal(wrote, true)
  assert.equal(updates.length, 1)
  const profile = updates[0].patch.providers.meta
  assert.deepEqual(
    profile.models.map((model) => model.id),
    ["muse-spark-1.3", "muse-wonder-1.0"],
  )
  assert.equal(profile.displayName, "Muse Code (Meta subscription)")
})

test("the model sync leaves an existing models list alone and skips without a key", async () => {
  const withModels = makeContext({
    settingsRows: [
      { ns: "llm-pi-ai", revision: 1, value: { providers: { meta: { models: [{ id: "muse-spark-1.3" }] } } } },
    ],
  })
  assert.equal(
    await syncMuseModels(withModels.settings, undefined, {
      credentials: () => makeCredentials(true, { access: "key" }),
      fetchModelIds: async () => ["muse-wonder-1.0"],
    }),
    false,
  )
  assert.equal(withModels.updates.length, 0)

  const unsigned = makeContext()
  assert.equal(
    await syncMuseModels(unsigned.settings, undefined, {
      credentials: () => makeCredentials(false),
      fetchModelIds: async () => ["muse-wonder-1.0"],
    }),
    false,
  )
  assert.equal(unsigned.updates.length, 0)
})

test("fetchLiveModelIds parses the account catalog", async () => {
  const original = globalThis.fetch
  globalThis.fetch = async () =>
    new Response(JSON.stringify({ data: [{ id: "muse-spark-1.3" }, { id: "muse-wonder-1.0" }, { nope: 1 }] }), {
      status: 200,
      headers: { "content-type": "application/json" },
    })
  try {
    assert.deepEqual(await fetchLiveModelIds("key"), ["muse-spark-1.3", "muse-wonder-1.0"])
  } finally {
    globalThis.fetch = original
  }
})
