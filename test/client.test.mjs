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
  return { module: modules[0], source }
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
    cleanup() {
      for (const hook of hooks) {
        if (hook?.cleanup !== undefined) {
          hook.cleanup()
          hook.cleanup = undefined
        }
      }
    },
  }
}

function applyPlugin(module, react) {
  const plugin = module.factory(() => react)
  assert.deepEqual(plugin.inject, ["slots"])
  const registered = []
  const injected = []
  const effects = []
  const disposers = []
  plugin.apply({
    effect(callback, label) {
      effects.push(label)
      disposers.push(callback())
    },
    slots: {
      inject(ownerKey, callback) {
        injected.push(ownerKey)
        callback()
      },
      register(options, component) {
        registered.push({ options, component })
        return () => {}
      },
    },
  })
  assert.deepEqual(injected, ["settings.section"])
  assert.equal(registered.length, 1)
  return { registration: registered[0], effects, disposers }
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
  return findBy(node, (element) => element.type === "button" && textOf(element).includes(label))
}

function findDeviceCode(node) {
  return findBy(node, (element) => element.props?.className === "mso-deviceCode")
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

test("the client registers a settings.section and no footer card", async () => {
  const { module, source } = await loadClient()
  const harness = createHarness()
  const { registration, effects } = applyPlugin(module, harness.react)
  assert.equal(registration.options.name, "settings.section")
  assert.equal(registration.options.id, "muse-code-oauth")
  assert.equal(registration.options.order, 53)
  assert.equal(registration.options.label(), "Muse Code")
  assert.equal(effects.length, 1)
  assert.doesNotMatch(source, /settings\.models\.footer/)
  assert.doesNotMatch(source, /dsh-muse-code-sign-in/)
})

test("apply injects the scoped stylesheet once and removes it on dispose", async () => {
  const { module } = await loadClient()
  const harness = createHarness()
  const appended = []
  let removed = 0
  const style = {
    textContent: "",
    setAttribute(name, value) {
      this.attribute = [name, value]
    },
    remove() {
      removed += 1
    },
  }
  globalThis.document = {
    head: {
      appendChild(node) {
        appended.push(node)
      },
    },
    createElement(tag) {
      assert.equal(tag, "style")
      return style
    },
  }
  try {
    const { effects, disposers } = applyPlugin(module, harness.react)
    assert.equal(effects.length, 1)
    assert.equal(appended.length, 1)
    assert.match(style.textContent, /\.mso-root \{/)
    assert.match(style.textContent, /\.mso-deviceCode \{/)
    assert.match(style.textContent, /\.mso-codeRow \{/)
    assert.match(style.textContent, /var\(--dsw-alias-settings-card-fill\)/)
    assert.doesNotMatch(style.textContent, /data-ds-dark-theme/)
    assert.doesNotMatch(style.textContent, /#[0-9a-f]{3,8}\b/i)
    for (const dispose of disposers) dispose()
    assert.equal(removed, 1)
  } finally {
    delete globalThis.document
  }
})

test("the page shows the signed-in state and hides the device code", async () => {
  const { module } = await loadClient()
  const harness = createHarness()
  globalThis.__DSH_TRANSPORT__ = { streamBaseUrl: "http://127.0.0.1:49806" }
  const fetch = stubFetch([
    ["/muse-code/status", { body: { state: "authorized", text: "Muse Code is signed in." } }],
  ])
  try {
    const { registration } = applyPlugin(module, harness.react)
    harness.render(registration.component)
    await tick()
    await tick()
    const tree = harness.render(registration.component)
    const text = textOf(tree)
    assert.match(text, /Muse Code OAuth/)
    assert.match(text, /Signed in/)
    assert.match(text, /Muse Code is signed in\. The model list is synced from your Meta account\./)
    assert.match(text, /muse-code-oauth/)
    assert.match(text, /Meta device code/)
    assert.match(text, /Synced from your Meta account/)
    assert.ok(findButton(tree, "Sign in again"), "the page offers Sign in again")
    assert.equal(findButton(tree, "Sign in with Meta"), undefined)
    assert.equal(
      findButton(tree, "Sign in again").props["data-variant"],
      "outline",
      "Sign in again is the outline action",
    )
    assert.equal(
      findBy(tree, (element) => element.props?.role === "status"),
      undefined,
      "the signed-in state needs no extra status notice",
    )
    assert.equal(findDeviceCode(tree), undefined)
    const dot = findBy(tree, (element) => element.props?.className === "mso-dot")
    assert.equal(dot.props["data-state"], "success")
  } finally {
    fetch.restore()
    harness.cleanup()
    delete globalThis.__DSH_TRANSPORT__
  }
})

test("the page starts the sign-in and shows the code while waiting", async () => {
  const { module } = await loadClient()
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
    const { registration } = applyPlugin(module, harness.react)
    harness.render(registration.component)
    await tick()
    const trigger = findButton(harness.render(registration.component), "Sign in with Meta")
    assert.ok(trigger, "the page renders a Sign in with Meta button")
    await trigger.props.onClick()
    await tick()
    await tick()
    const tree = harness.render(registration.component)
    const text = textOf(tree)
    assert.match(text, /ABCD-EFGH/)
    assert.match(text, /Waiting for Meta/)
    assert.match(text, /Enter this code on Meta's page\./)
    const metaLink = findBy(
      tree,
      (element) =>
        element.type === "a" &&
        element.props.href === "https://auth.meta.com/oauth/device/?code=ABCD-EFGH",
    )
    assert.ok(metaLink, "the page links to the Meta page")
    assert.match(textOf(metaLink), /Open Meta page/)
    assert.equal(
      findButton(tree, "Sign in with Meta"),
      undefined,
      "the primary sign-in button is hidden while pending",
    )
    const codeRow = findBy(tree, (element) => element.props?.className === "mso-codeRow")
    assert.ok(codeRow, "the code and its label share one row")
    assert.ok(
      findBy(codeRow, (element) => element.props?.className === "mso-factLabel" && textOf(element) === "Code"),
      "the code row carries the Code label",
    )
    assert.ok(
      findBy(codeRow, (element) => element.props?.className === "mso-deviceCode" && textOf(element) === "ABCD-EFGH"),
      "the code row carries the device code",
    )
    const dot = findBy(tree, (element) => element.props?.className === "mso-dot")
    assert.equal(dot.props["data-state"], "warning")
  } finally {
    fetch.restore()
    harness.cleanup()
    delete globalThis.__DSH_TRANSPORT__
  }
})

test("the page reports a failed sign-in with an error notice", async () => {
  const { module } = await loadClient()
  const harness = createHarness()
  globalThis.__DSH_TRANSPORT__ = { streamBaseUrl: "http://127.0.0.1:49806" }
  const fetch = stubFetch([
    ["/muse-code/status", { body: { state: "failed", text: "Muse Code sign-in ended (denied)." } }],
  ])
  try {
    const { registration } = applyPlugin(module, harness.react)
    harness.render(registration.component)
    await tick()
    await tick()
    const tree = harness.render(registration.component)
    assert.match(textOf(tree), /Sign-in failed/)
    const retry = findButton(tree, "Sign in with Meta")
    assert.ok(retry, "the page offers a retry")
    assert.equal(retry.props["data-variant"], "primary")
    assert.equal(findDeviceCode(tree), undefined)
    const notice = findBy(tree, (element) => element.props?.role === "alert")
    assert.ok(notice, "the failure is announced as an alert")
    assert.match(textOf(notice), /denied/)
  } finally {
    fetch.restore()
    harness.cleanup()
    delete globalThis.__DSH_TRANSPORT__
  }
})

test("without a discoverable Host origin the page points at the command", async () => {
  const { module } = await loadClient()
  const harness = createHarness()
  const fetch = stubFetch([])
  try {
    const { registration } = applyPlugin(module, harness.react)
    const tree = harness.render(registration.component)
    const text = textOf(tree)
    assert.match(text, /This page cannot reach the local Host\./)
    assert.match(text, /\/muse-login/)
    assert.equal(findButton(tree, "Sign in with Meta"), undefined)
    assert.equal(fetch.calls.length, 0)
  } finally {
    fetch.restore()
    harness.cleanup()
  }
})
