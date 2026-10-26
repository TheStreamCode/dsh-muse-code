import { test } from "node:test"
import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"

// DSH serves Client artifacts as CLASSIC SCRIPTS (they are concatenated into
// plain script bundles), not as ES modules. These tests evaluate the artifact
// with classic-script grammar (`new Function` rejects `export`/`import` exactly
// like a browser would) and drive the resulting component with a tiny hook
// runtime, a stub React, and stubbed fetch.

async function loadClient() {
  const source = await readFile(new URL("../client/client.js", import.meta.url), "utf8")
  assert.doesNotMatch(source, /^\s*(?:export|import)\b/m)

  const modules = []
  globalThis.__ModuleLoader__ = {
    load(module) {
      modules.push(module)
    },
  }
  try {
    new Function(source)()
  } finally {
    delete globalThis.__ModuleLoader__
  }
  assert.equal(modules.length, 1)
  assert.equal(modules[0].id, "@thestreamcode/dsh-muse-code")
  return modules[0]
}

function createHarness() {
  const hooks = []
  let cursor = 0
  const react = {
    createElement: (type, props, ...children) => ({ type, props: props ?? {}, children }),
    useState(initial) {
      const index = cursor++
      if (hooks[index] === undefined) hooks[index] = { value: initial }
      const slot = hooks[index]
      return [
        slot.value,
        (next) => {
          slot.value = typeof next === "function" ? next(slot.value) : next
        },
      ]
    },
    useEffect(callback) {
      const index = cursor++
      if (hooks[index] === undefined) hooks[index] = { ran: false }
      if (!hooks[index].ran) {
        hooks[index].ran = true
        hooks[index].cleanup = callback()
      }
    },
  }
  return {
    react,
    render(component) {
      cursor = 0
      return component()
    },
  }
}

function registerFooter(module, react) {
  const plugin = module.factory(() => react)
  assert.deepEqual(plugin.inject, ["slots"])
  const registered = []
  plugin.apply({
    slots: {
      inject(ownerKey, callback) {
        assert.equal(ownerKey, "settings.models.footer")
        callback()
      },
      register(options, component) {
        registered.push({ options, component })
        return () => {}
      },
    },
  })
  assert.equal(registered.length, 1)
  assert.equal(registered[0].options.id, "dsh-muse-code-sign-in")
  return registered[0]
}

function flatten(node, visit) {
  if (node === null || node === undefined) return
  if (typeof node === "string" || typeof node === "number") return
  if (Array.isArray(node)) {
    for (const child of node) flatten(child, visit)
    return
  }
  visit(node)
  for (const child of node.children ?? []) flatten(child, visit)
}

function findBy(node, predicate) {
  let hit
  flatten(node, (element) => {
    if (hit === undefined && predicate(element)) hit = element
  })
  return hit
}

function findButton(node, label) {
  return findBy(node, (element) => element.type === "button" && JSON.stringify(element.children).includes(label))
}

function textOf(node) {
  let text = ""
  if (node === null || node === undefined) return text
  if (typeof node === "string" || typeof node === "number") return String(node)
  if (Array.isArray(node)) return node.map(textOf).join("")
  return (node.children ?? []).map(textOf).join("")
}

function stubFetch(routes) {
  const calls = []
  const original = globalThis.fetch
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init })
    for (const [suffix, response] of routes) {
      if (String(url).endsWith(suffix)) {
        return new Response(JSON.stringify(response.body), {
          status: response.status ?? 200,
          headers: { "content-type": "application/json" },
        })
      }
    }
    return new Response("{}", { status: 404 })
  }
  return {
    calls,
    restore() {
      globalThis.fetch = original
    },
  }
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0))

test("client artifact registers the Muse Code card", async () => {
  const module = await loadClient()
  const { react } = createHarness()
  const footer = registerFooter(module, react)
  assert.equal(footer.options.name, "settings.models.footer")
})

test("the card shows the signed-in state and hides the code", async () => {
  const module = await loadClient()
  const harness = createHarness()
  globalThis.__DSH_TRANSPORT__ = { streamBaseUrl: "http://127.0.0.1:49806" }
  const fetch = stubFetch([
    ["/muse-code/status", { body: { state: "authorized", text: "Muse Code is signed in." } }],
  ])
  try {
    const footer = registerFooter(module, harness.react)
    harness.render(footer.component)
    await tick()
    await tick()
    const tree = harness.render(footer.component)
    const text = textOf(tree)
    assert.match(text, /Muse Code \(Meta subscription\)/)
    assert.match(text, /Signed in/)
    assert.match(text, /Sign in again/)
    assert.equal(findBy(tree, (element) => element.type === "code"), undefined)
  } finally {
    fetch.restore()
    delete globalThis.__DSH_TRANSPORT__
  }
})

test("the card starts the sign-in and shows the code while waiting", async () => {
  const module = await loadClient()
  const harness = createHarness()
  globalThis.__DSH_TRANSPORT__ = { streamBaseUrl: "http://127.0.0.1:49806" }
  const fetch = stubFetch([
    ["/muse-code/status", { body: { state: "idle" } }],
    [
      "/muse-code/login",
      {
        body: {
          ok: true,
          text: "Muse Code sign-in started. Confirm the code ABCD-EFGH there.",
          code: "ABCD-EFGH",
          url: "https://auth.meta.com/oauth/device/?code=ABCD-EFGH",
          opened: true,
        },
      },
    ],
  ])
  try {
    const footer = registerFooter(module, harness.react)
    harness.render(footer.component)
    await tick()
    const trigger = findButton(harness.render(footer.component), "Sign in")
    assert.ok(trigger, "the card renders a Sign in button")
    await trigger.props.onClick()
    await tick()
    await tick()
    const tree = harness.render(footer.component)
    const text = textOf(tree)
    assert.match(text, /ABCD-EFGH/)
    assert.match(text, /Waiting for Meta/)
    const metaLink = findBy(tree, (element) => element.type === "a" && element.props.href === "https://auth.meta.com/oauth/device/?code=ABCD-EFGH")
    assert.ok(metaLink, "the card links to the Meta page")
  } finally {
    fetch.restore()
    delete globalThis.__DSH_TRANSPORT__
  }
})

test("without a discoverable Host origin the card points at the command", async () => {
  const module = await loadClient()
  const harness = createHarness()
  const footer = registerFooter(module, harness.react)
  const tree = harness.render(footer.component)
  assert.equal(findButton(tree, "Sign in"), undefined)
  assert.match(textOf(tree), /\/muse-login/)
})
