import { test } from "node:test"
import assert from "node:assert/strict"
import {
  AUTH_CONTRACT_VERSION,
  CLIENT_ID,
  DEVICE_URL,
  KEY_URL,
  TOKEN_URL,
  deviceAuthorize,
  mintKey,
  pollToken,
} from "../lib/auth.js"

const DEVICE_OK = {
  device_code: "dc",
  user_code: "ABCD-EFGH",
  verification_uri: "https://auth.meta.com/device",
  verification_uri_complete: "https://auth.meta.com/device?user_code=ABCD-EFGH",
  interval: 0,
  expires_in: 600,
}

const KEY_OK = {
  api_key: "LLM|fresh",
  user_email: "User@Example.com",
  user_id: "uid-1",
  is_subs_active: true,
}

function stubFetch(handler) {
  const original = globalThis.fetch
  globalThis.fetch = async (input, init) => {
    const { status = 200, body } = handler(String(input), init)
    return new Response(JSON.stringify(body), { status })
  }
  return () => {
    globalThis.fetch = original
  }
}

test("auth contract is pinned", () => {
  assert.equal(AUTH_CONTRACT_VERSION, 1)
  assert.equal(CLIENT_ID, "1031625952748946")
  assert.equal(DEVICE_URL, "https://auth.meta.com/oidc/device/authorization/")
  assert.equal(TOKEN_URL, "https://auth.meta.com/oidc/device/token/")
  assert.equal(KEY_URL, "https://api.meta.ai/muse-code/key")
})

test("device authorize validates fields", async () => {
  let restore = stubFetch(() => ({ body: DEVICE_OK }))
  try {
    const device = await deviceAuthorize()
    assert.equal(device.user_code, "ABCD-EFGH")
    assert.match(device.verification_uri_complete, /ABCD-EFGH/)
  } finally {
    restore()
  }

  restore = stubFetch(() => ({ body: { user_code: "x" } }))
  try {
    await assert.rejects(deviceAuthorize(), /missing fields/)
  } finally {
    restore()
  }
})

test("poll token returns the access token", async () => {
  const restore = stubFetch((url) => {
    assert.match(url, /device\/token/)
    return { body: { access_token: "dca-new" } }
  })
  try {
    assert.equal(await pollToken("dc", 0, 600), "dca-new")
  } finally {
    restore()
  }
})

test("poll token rejects terminal errors", async () => {
  const restore = stubFetch(() => ({ status: 400, body: { error: "access_denied" } }))
  try {
    await assert.rejects(pollToken("dc", 0, 600), /access_denied/)
  } finally {
    restore()
  }
})

test("mint validates the subscription", async () => {
  let restore = stubFetch(() => ({ body: KEY_OK }))
  try {
    assert.deepEqual(await mintKey("dca-x"), {
      apiKey: "LLM|fresh",
      accountId: "uid-1",
      email: "user@example.com",
    })
  } finally {
    restore()
  }

  restore = stubFetch(() => ({ body: { ...KEY_OK, is_subs_active: false } }))
  try {
    await assert.rejects(mintKey("dca-x"), /inactive/)
  } finally {
    restore()
  }

  restore = stubFetch(() => ({
    body: { require_payment: true, action_url: "https://example.test/pay" },
  }))
  try {
    await assert.rejects(mintKey("dca-x"), /required.*example\.test\/pay/)
  } finally {
    restore()
  }
})
