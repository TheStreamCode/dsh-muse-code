import { test } from "node:test"
import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"

// DSH serves Client artifacts as CLASSIC SCRIPTS (they are concatenated into
// plain script bundles), not as ES modules. These tests are the closest
// browser-equivalent checks available without a page: `new Function` rejects
// `export`/`import` exactly like a classic script, and the captured factory is
// driven with a stub React, slot surface, and fetch.

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

function makeReact() {
  const slots = []
  return {
    react: {
      createElement: (type, props, ...children) => ({ type, props: props ?? {}, children }),
      useState(initial) {
        const slot = { value: initial }
        slots.push(slot)
        return [slot.value, (next) => { slot.value = next }]
      },
    },
    slots,
  }
}

function registerFooter(module, react) {
  const plugin = module.factory(() => react)
  assert.deepEqual(plugin.inject, ["slots"])
  const registered = []
  const ctx = {
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
  }
  plugin.apply(ctx)
  assert.equal(registered.length, 1)
  assert.equal(registered[0].options.name, "settings.models.footer")
  return registered[0]
}

function findButton(node) {
  if (node === null || typeof node !== "object") return undefined
  if (Array.isArray(node)) {
    for (const child of node) {
      const hit = findButton(child)
      if (hit !== undefined) return hit
    }
    return undefined
  }
  if (node.type === "button") return node
  for (const child of node.children ?? []) {
    const hit = findButton(child)
    if (hit !== undefined) return hit
  }
  return undefined
}

function findLink(node) {
  if (node === null || typeof node !== "object") return undefined
  if (Array.isArray(node)) {
    for (const child of node) {
      const hit = findLink(child)
      if (hit !== undefined) return hit
    }
    return undefined
  }
  if (node.type === "a") return node
  for (const child of node.children ?? []) {
    const hit = findLink(child)
    if (hit !== undefined) return hit
  }
  return undefined
}

function textOf(node) {
  if (node === null || node === undefined) return ""
  if (typeof node === "string" || typeof node === "number") return String(node)
  if (Array.isArray(node)) return node.map(textOf).join("")
  return (node.children ?? []).map(textOf).join("")
}

test("client artifact registers the Models footer contribution", async () => {
  const module = await loadClient()
  const { react } = makeReact()
  const footer = registerFooter(module, react)
  assert.equal(footer.options.id, "dsh-muse-code-sign-in")
})

test("the footer control signs in through the Host login route and shows the code", async () => {
  const module = await loadClient()
  const { react, slots } = makeReact()
  globalThis.__DSH_TRANSPORT__ = { streamBaseUrl: "http://127.0.0.1:49806" }
  const requests = []
  const originalFetch = globalThis.fetch
  globalThis.fetch = async (url, init) => {
    requests.push({ url: String(url), init })
    return new Response(
      JSON.stringify({
        ok: true,
        text: "Muse Code sign-in started. Confirm the code ABCD-EFGH. Page: https://auth.meta.com/oauth/device/?code=ABCD-EFGH",
        url: "https://auth.meta.com/oauth/device/?code=ABCD-EFGH",
        code: "ABCD-EFGH",
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    )
  }
  try {
    const footer = registerFooter(module, react)
    const tree = footer.component()
    const button = findButton(tree)
    assert.ok(button, "the control renders a Sign in button")
    assert.match(textOf(button), /Sign in/)
    const link = findLink(tree)
    assert.ok(link, "the control renders a direct sign-in link")
    assert.equal(link.props.href, "http://127.0.0.1:49806/muse-code/login")
    assert.equal(link.props.target, "_blank")
    await button.props.onClick()
  } finally {
    globalThis.fetch = originalFetch
    delete globalThis.__DSH_TRANSPORT__
  }

  assert.equal(requests.length, 1)
  assert.equal(requests[0].url, "http://127.0.0.1:49806/muse-code/login")
  assert.equal(requests[0].init.method, "POST")
  assert.equal(slots[0].value.status, "success")
  assert.match(slots[0].value.text, /ABCD-EFGH/)
})

test("without a discoverable Host origin the control points at the command", async () => {
  const module = await loadClient()
  const { react } = makeReact()
  const footer = registerFooter(module, react)
  const tree = footer.component()
  assert.equal(findButton(tree), undefined)
  assert.match(textOf(tree), /\/muse-login/)
})
