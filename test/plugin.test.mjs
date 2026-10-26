import { test } from "node:test"
import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import {
  apply,
  createLoginRouteHandler,
  ensureMuseRoute,
  formatSignInText,
  inject,
  LOGIN_ROUTE,
  museLoginCommand,
  name,
  readSignInNotice,
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

function makeContext(options = {}) {
  const flow = "flow" in options ? options.flow : FLOW
  const settingsRows = options.settingsRows ?? [
    { ns: "llm-pi-ai", revision: 3, value: { providers: { meta: {} } } },
  ]
  const commands = []
  const children = []
  const routes = []
  const cancels = []
  const { settings, updates } = makeSettings(settingsRows)
  const ctx = {
    authorization: {
      describe(key) {
        assert.equal(key, "llm-pi-ai/meta")
        return flow
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
    logger: {
      info() {},
      warn() {},
      debug() {},
    },
    effect(callback) {
      return callback()
    },
    inject(dependencies, callback) {
      children.push({ dependencies })
      callback({
        ...ctx,
        settings,
        webServer: {
          register(route) {
            routes.push(route)
            return () => {}
          },
        },
      })
      return () => {}
    },
  }
  return { ctx, commands, children, routes, cancels, updates }
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

test("plugin registers the command, the login route, and the settings write", () => {
  const { ctx, commands, children, routes } = makeContext()
  apply(ctx)
  assert.equal(name, "dsh-muse-code")
  assert.deepEqual(inject, ["authorization", "commands"])
  assert.equal(commands.length, 1)
  assert.equal(commands[0].name, "muse-login")
  assert.match(commands[0].description, /Muse Code/)

  assert.deepEqual(children.map((child) => child.dependencies), [["webServer"], ["settings"]])
  assert.equal(routes.length, 1)
  assert.equal(routes[0].kind, "exact")
  assert.equal(routes[0].path, LOGIN_ROUTE)
  assert.equal(typeof routes[0].handler, "function")
})

test("route declaration merges the meta provider only when absent", async () => {
  const absent = makeSettings([
    { ns: "llm-pi-ai", revision: 7, value: { providers: { "opencode-go": { apiKeyEnv: "X" } } } },
  ])
  assert.equal(await ensureMuseRoute(absent.settings, undefined, { attempts: 1 }), true)
  assert.equal(absent.updates.length, 1)
  assert.equal(absent.updates[0].ns, "llm-pi-ai")
  assert.equal(absent.updates[0].revision, 7)
  assert.deepEqual(absent.updates[0].patch, {
    providers: { meta: { displayName: "Muse Code (Meta subscription)" } },
  })

  const declared = makeSettings([
    { ns: "llm-pi-ai", revision: 1, value: { providers: { meta: { displayName: "kept" } } } },
  ])
  assert.equal(await ensureMuseRoute(declared.settings, undefined, { attempts: 1 }), false)
  assert.equal(declared.updates.length, 0)
})

test("route declaration retries while the llm-pi-ai entry activates", async () => {
  const rows = []
  const updates = []
  let calls = 0
  const settings = {
    describe() {
      calls += 1
      return rows.slice()
    },
    async update(ns, patch, revision) {
      updates.push({ ns, patch, revision })
    },
  }
  setTimeout(() => {
    rows.push({ ns: "llm-pi-ai", revision: 2, value: {} })
  }, 5)
  assert.equal(await ensureMuseRoute(settings, undefined, { attempts: 20, delayMs: 5 }), true)
  assert.equal(updates.length, 1)
  assert.ok(calls > 1)
})

test("route declaration gives up when the namespace never appears", async () => {
  const { settings, updates } = makeSettings([])
  assert.equal(await ensureMuseRoute(settings, undefined, { attempts: 2, delayMs: 0 }), false)
  assert.equal(updates.length, 0)
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
  assert.equal(raw.code, "WXYZ")

  assert.equal(readSignInNotice({ message: "Signing in…" }), undefined)
  assert.equal(readSignInNotice({ url: "not a url" }), undefined)
  assert.equal(readSignInNotice({ url: "file:///etc/passwd" }), undefined)
})

test("instruction text carries the code, the page, and the browser hint", () => {
  const instruction = readSignInNotice(NEUTRAL_NOTICE)
  const opened = formatSignInText(instruction, true)
  assert.match(opened, /ABCD-EFGH/)
  assert.match(opened, /auth\.meta\.com/)
  assert.match(opened, /browser tab should have opened/)
  const failed = formatSignInText(instruction, false)
  assert.match(failed, /Open this page in your browser/)
})

test("the command opens the browser and reports the code", async () => {
  const { ctx } = makeContext()
  const opened = []
  ctx.authorization.begin = async (request) => {
    assert.equal(request.method, "oauth")
    request.interaction.notify(NEUTRAL_NOTICE)
    return { status: "authorized" }
  }
  const command = museLoginCommand(ctx, {
    openBrowser(url) {
      opened.push(url)
      return true
    },
  })
  const result = await command.handler({ rawInput: "" })
  assert.equal(result.kind, "success")
  assert.match(result.text, /ABCD-EFGH/)
  assert.match(result.text, /auth\.meta\.com/)
  assert.deepEqual(opened, [NEUTRAL_NOTICE.url + "?code=ABCD-EFGH"])
})

test("the command reports a missing flow, a busy flow, and a failed attempt", async () => {
  const missing = makeContext({ flow: undefined })
  const missingResult = await museLoginCommand(missing.ctx).handler({})
  assert.equal(missingResult.kind, "error")
  assert.match(missingResult.text, /Muse Code is unavailable/)

  const busy = makeContext({ flow: { ...FLOW, inFlight: true } })
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
  assert.match(payload.text, /auth\.meta\.com/)
})

test("the login route answers a plain navigation with the code and a Meta page", async () => {
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
  assert.match(state.body, /http-equiv="refresh"/)
  assert.match(state.body, /auth\.meta\.com/)
})

test("the login route refuses unsupported methods", async () => {
  const { ctx } = makeContext()
  const handler = createLoginRouteHandler(ctx)
  const { response, state } = makeResponse()
  await handler({ method: "PUT" }, response)
  assert.equal(state.status, 405)
  assert.equal(JSON.parse(state.body).ok, false)
})

test("the login route reports a busy flow", async () => {
  const { ctx } = makeContext({ flow: { ...FLOW, inFlight: true } })
  const handler = createLoginRouteHandler(ctx)
  const { response, state } = makeResponse()
  await handler({ method: "POST" }, response)
  assert.equal(state.status, 409)
  assert.equal(JSON.parse(state.body).reason, "busy")
})

test("the login route times out and cancels the attempt", async () => {
  const { ctx, cancels } = makeContext()
  // A slow flow that settles after the route's deadline: never leave an
  // unresolved promise behind, the test runner treats one as a failure when the
  // event loop drains.
  ctx.authorization.begin = () =>
    new Promise((resolve) => {
      setTimeout(() => resolve({ status: "cancelled" }), 50)
    })
  const handler = createLoginRouteHandler(ctx, { timeoutMs: 5 })
  const { response, state } = makeResponse()
  await handler({ method: "POST" }, response)
  assert.equal(state.status, 504)
  assert.deepEqual(cancels, ["llm-pi-ai/meta"])
})
