import { test } from "node:test"
import assert from "node:assert/strict"
import { apply, inject, name } from "../lib/index.js"

function makeContext() {
  const flows = []
  const stored = []
  const records = []
  const ctx = {
    credentials: {
      async set(reference, value) {
        stored.push({ reference, value })
      },
      async modifyRecord(key, update) {
        records.push({ key, value: await update() })
      },
    },
    authorization: {
      registerFlow(flow) {
        flows.push(flow)
        return () => {}
      },
    },
    effect(callback) {
      return callback()
    },
  }
  return { ctx, flows, stored, records }
}

test("registers one authorization flow", () => {
  const { ctx, flows } = makeContext()
  apply(ctx)
  assert.equal(name, "dsh-muse-code")
  assert.deepEqual(inject, ["credentials", "authorization"])
  assert.equal(flows.length, 1)
  assert.equal(flows[0].key, "dsh-muse-code/subscription")
  assert.match(flows[0].label, /Muse Code/)
  assert.equal(flows[0].methods[0].id, "device")
})

test("flow stores the minted key and commits its record", async () => {
  const { ctx, flows, stored, records } = makeContext()
  apply(ctx)
  const flow = flows[0]

  const original = globalThis.fetch
  globalThis.fetch = async (input) => {
    const url = String(input)
    if (url.includes("authorization")) {
      return new Response(
        JSON.stringify({
          device_code: "dc",
          user_code: "ABCD",
          verification_uri: "https://auth.meta.com/device",
          interval: 0,
          expires_in: 600,
        }),
      )
    }
    if (url.includes("token")) {
      return new Response(JSON.stringify({ access_token: "dca-token" }))
    }
    return new Response(
      JSON.stringify({
        api_key: "LLM|inference",
        user_id: "account-1",
        user_email: "user@example.com",
        is_subs_active: true,
      }),
    )
  }

  const notifications = []
  try {
    await flow.run({
      signal: undefined,
      notify(input) {
        notifications.push(input)
      },
    })
  } finally {
    globalThis.fetch = original
  }

  assert.equal(stored.length, 1)
  assert.deepEqual(stored[0], {
    reference: "MUSE_CODE_SUB_TOKEN",
    value: "LLM|inference",
  })
  assert.equal(records.length, 1)
  assert.equal(records[0].key, "dsh-muse-code/subscription")
  assert.equal(records[0].value.kind, "grant")
  assert.equal(records[0].value.payload.accountId, "account-1")
  assert.equal(records[0].value.payload.email, "user@example.com")
  assert.equal(notifications.length, 2)
  assert.match(notifications[0].message, /ABCD/)
  assert.match(notifications[1].message, /Signed in as user@example.com/)
})
