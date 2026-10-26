// Web client half of the Muse Code integration.
//
// Renders one card in the Settings > Models footer seat: the subscription
// status, the Sign in control, the device code, and a live status that flips
// from "Waiting for Meta…" to "Signed in" without a page reload. The card calls
// the Host's exact routes (`POST /muse-code/login`, `GET /muse-code/status`).
//
// This file is a browser CLASSIC SCRIPT, not an ES module: DSH concatenates
// client artifacts into plain script bundles, so an `export` statement here
// breaks the whole bundle ("Unexpected token 'export'"). It therefore lives
// outside the TypeScript source tree: tsc would emit `export {}` for an
// ES-module file. The loader registers a lazy factory whose id is the package
// name; React comes from the browser module table.

const PACKAGE_ID = "@thestreamcode/dsh-muse-code"
const CARD_ID = "dsh-muse-code-sign-in"
const LOGIN_ROUTE = "/muse-code/login"
const STATUS_ROUTE = "/muse-code/status"
const REQUEST_TIMEOUT_MS = 25_000
const POLL_INTERVAL_MS = 2_000
const POLL_ATTEMPTS = 150

const COLOR = {
  labelPrimary: "var(--dsw-alias-label-primary)",
  labelSecondary: "var(--dsw-alias-label-secondary)",
  labelTertiary: "var(--dsw-alias-label-tertiary)",
  labelError: "var(--dsw-alias-state-error-primary)",
  labelSuccess: "var(--dsw-alias-state-success-primary)",
  labelWarn: "var(--dsw-alias-state-warn-primary)",
  border: "var(--dsw-alias-border-l2)",
  primaryFill: "var(--dsw-alias-button-primary-fill)",
  primaryForeground: "var(--dsw-alias-label-primary-foreground)",
  layer: "var(--dsw-alias-bg-layer-1)",
  inlineCode: "var(--dsw-alias-markdown-inline-code)",
}

const MODULE_FONT = "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace"

const loader = globalThis.__ModuleLoader__

/** One module-level poll chain: the footer seat renders one card. */
const pollState = { timer: undefined, tries: 0 }

function stopPolling() {
  if (pollState.timer !== undefined) {
    clearTimeout(pollState.timer)
    pollState.timer = undefined
  }
}

/** Loopback origin of the Host that owns this page, when it is discoverable. */
function hostOrigin() {
  const transport = globalThis.__DSH_TRANSPORT__
  const base = transport && typeof transport.streamBaseUrl === "string" ? transport.streamBaseUrl : ""
  if (/^https?:\/\//i.test(base)) return base.replace(/\/+$/, "")
  const origin = globalThis.location && globalThis.location.origin
  if (typeof origin === "string" && /^https?:\/\//i.test(origin)) return origin.replace(/\/+$/, "")
  return ""
}

async function getJson(url, init) {
  const controller = typeof AbortController === "function" ? new AbortController() : undefined
  const timer = controller === undefined ? undefined : setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
  try {
    const response = await fetch(url, {
      ...(init || {}),
      headers: { accept: "application/json" },
      ...(controller === undefined ? {} : { signal: controller.signal }),
    })
    const payload = await response.json().catch(() => null)
    return { ok: response.ok, status: response.status, payload }
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
}

loader?.load({
  id: PACKAGE_ID,
  factory(require) {
    const React = require("react")
    const h = React.createElement

    function statusView(phase) {
      if (phase === "authorized") return { label: "Signed in", color: COLOR.labelSuccess }
      if (phase === "pending" || phase === "starting") return { label: "Waiting for Meta…", color: COLOR.labelWarn }
      if (phase === "failed") return { label: "Sign-in failed", color: COLOR.labelError }
      if (phase === "checking") return { label: "Checking…", color: COLOR.labelTertiary }
      return { label: "Not signed in", color: COLOR.labelTertiary }
    }

    function MuseCodeSignIn() {
      const [state, setState] = React.useState({
        phase: "checking",
        text: "",
        code: "",
        metaUrl: "",
      })
      const origin = hostOrigin()

      function applyStatus(payload) {
        if (!payload || typeof payload.state !== "string") return
        if (payload.state === "authorized") {
          stopPolling()
          setState(function (previous) {
            return {
              ...previous,
              phase: "authorized",
              text: payload.text || "Muse Code is signed in.",
              code: "",
            }
          })
          return
        }
        if (payload.state === "pending") {
          setState(function (previous) {
            return {
              ...previous,
              phase: "pending",
              code: typeof payload.code === "string" ? payload.code : previous.code,
            }
          })
          pollStatus()
          return
        }
        if (payload.state === "failed" || payload.state === "cancelled") {
          stopPolling()
          setState(function (previous) {
            return {
              ...previous,
              phase: "failed",
              text: payload.text || "Sign-in did not complete.",
            }
          })
          return
        }
        setState(function (previous) {
          return previous.phase === "checking" ? { ...previous, phase: "idle" } : previous
        })
      }

      function pollStatus() {
        if (origin.length === 0) return
        if (pollState.timer !== undefined) return
        if (pollState.tries >= POLL_ATTEMPTS) return
        pollState.tries += 1
        pollState.timer = setTimeout(function () {
          pollState.timer = undefined
          getJson(origin + STATUS_ROUTE).then(
            function (response) {
              applyStatus(response.payload)
            },
            function () {
              pollStatus()
            },
          )
        }, POLL_INTERVAL_MS)
        // Browser timers are numbers; Node's test runner sees the object. The
        // optional call keeps a pending poll from pinning the process open.
        pollState.timer.unref?.()
      }

      function refreshStatus() {
        if (origin.length === 0) return
        getJson(origin + STATUS_ROUTE).then(
          function (response) {
            applyStatus(response.payload)
          },
          function () {
            setState(function (previous) {
              return previous.phase === "checking" ? { ...previous, phase: "idle" } : previous
            })
          },
        )
      }

      React.useEffect(
        function () {
          refreshStatus()
          return function () {
            stopPolling()
          }
        },
        [origin],
      )

      async function startSignIn() {
        stopPolling()
        pollState.tries = 0
        setState(function (previous) {
          return { ...previous, phase: "starting", text: "Starting the sign-in…", code: "" }
        })
        try {
          const response = await getJson(origin + LOGIN_ROUTE, { method: "POST" })
          const payload = response.payload
          if (payload && payload.ok === true) {
            setState(function (previous) {
              return {
                ...previous,
                phase: "pending",
                text: payload.text || "Confirm the code on Meta's page.",
                code: typeof payload.code === "string" ? payload.code : "",
                metaUrl: typeof payload.url === "string" ? payload.url : "",
              }
            })
            pollStatus()
            return
          }
          setState(function (previous) {
            return {
              ...previous,
              phase: "failed",
              text:
                (payload && typeof payload.text === "string" && payload.text) ||
                "Could not start the sign-in. Run /muse-login in a chat instead.",
            }
          })
        } catch {
          setState(function (previous) {
            return {
              ...previous,
              phase: "failed",
              text: "Could not reach the Host. Run /muse-login in a chat instead.",
            }
          })
        }
      }

      const view = statusView(state.phase)
      const busy = state.phase === "starting" || state.phase === "pending"
      const description =
        state.phase === "authorized"
          ? "Muse Code models are available in the model picker."
          : "Sign in once with the Meta account that holds the Muse Code subscription."
      const messageColor =
        state.phase === "failed"
          ? COLOR.labelError
          : state.phase === "authorized"
            ? COLOR.labelSuccess
            : COLOR.labelSecondary
      const secondaryHref =
        state.metaUrl.length > 0 ? state.metaUrl : origin.length > 0 ? origin + LOGIN_ROUTE : ""

      const children = [
        h(
          "div",
          {
            key: "head",
            style: {
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: "0.75rem",
              flexWrap: "wrap",
            },
          },
          h(
            "span",
            { style: { fontSize: "0.9375rem", fontWeight: 500, color: COLOR.labelPrimary } },
            "Muse Code (Meta subscription)",
          ),
          h(
            "span",
            {
              style: {
                display: "inline-flex",
                alignItems: "center",
                gap: "0.375rem",
                fontSize: "0.75rem",
                color: COLOR.labelSecondary,
              },
            },
            h("span", {
              style: { width: "0.5rem", height: "0.5rem", borderRadius: "999px", background: view.color, flex: "0 0 auto" },
              "aria-hidden": true,
            }),
            view.label,
          ),
        ),
        h(
          "p",
          {
            key: "description",
            style: { margin: 0, fontSize: "0.8125rem", lineHeight: 1.5, color: COLOR.labelSecondary },
          },
          description,
        ),
      ]

      if (state.code.length > 0 && state.phase !== "authorized") {
        children.push(
          h(
            "div",
            { key: "code", style: { display: "flex", alignItems: "center", gap: "0.5rem", flexWrap: "wrap" } },
            h("span", { style: { fontSize: "0.75rem", color: COLOR.labelTertiary } }, "Code"),
            h(
              "code",
              {
                style: {
                  fontFamily: MODULE_FONT,
                  fontSize: "1rem",
                  letterSpacing: "0.1em",
                  padding: "0.125rem 0.5rem",
                  borderRadius: "0.375rem",
                  background: COLOR.inlineCode,
                  color: COLOR.labelPrimary,
                },
              },
              state.code,
            ),
          ),
        )
      }

      if (state.text.length > 0) {
        children.push(
          h(
            "p",
            {
              key: "message",
              role: "status",
              style: {
                margin: 0,
                fontSize: "0.8125rem",
                lineHeight: 1.5,
                color: messageColor,
                overflowWrap: "anywhere",
              },
            },
            state.text,
          ),
        )
      }

      if (origin.length > 0) {
        children.push(
          h(
            "div",
            {
              key: "actions",
              style: { display: "flex", alignItems: "center", gap: "0.5rem", flexWrap: "wrap", marginTop: "0.25rem" },
            },
            h(
              "button",
              {
                type: "button",
                disabled: busy,
                onClick: startSignIn,
                style: {
                  padding: "0.375rem 0.875rem",
                  borderRadius: "0.5rem",
                  border: "none",
                  background: busy ? COLOR.border : COLOR.primaryFill,
                  color: busy ? COLOR.labelTertiary : COLOR.primaryForeground,
                  fontSize: "0.8125rem",
                  fontWeight: 500,
                  cursor: busy ? "progress" : "pointer",
                },
              },
              busy ? "Signing in…" : state.phase === "authorized" ? "Sign in again" : "Sign in",
            ),
            secondaryHref.length > 0
              ? h(
                  "a",
                  {
                    href: secondaryHref,
                    target: "_blank",
                    rel: "noreferrer",
                    style: {
                      padding: "0.375rem 0.875rem",
                      borderRadius: "0.5rem",
                      border: `1px solid ${COLOR.border}`,
                      color: COLOR.labelPrimary,
                      fontSize: "0.8125rem",
                      textDecoration: "none",
                      whiteSpace: "nowrap",
                    },
                  },
                  state.phase === "pending" ? "Open Meta page" : "Open sign-in page",
                )
              : null,
          ),
        )
      } else {
        children.push(
          h(
            "p",
            { key: "fallback", style: { margin: 0, fontSize: "0.8125rem", color: COLOR.labelSecondary } },
            "This page cannot reach the local Host; run ",
            h("code", null, "/muse-login"),
            " in a chat to sign in.",
          ),
        )
      }

      return h(
        "div",
        {
          style: {
            marginTop: "1rem",
            padding: "0.875rem 1rem",
            border: `1px solid ${COLOR.border}`,
            borderRadius: "0.75rem",
            background: COLOR.layer,
            display: "flex",
            flexDirection: "column",
            gap: "0.5rem",
            maxWidth: "42rem",
            textAlign: "left",
            boxSizing: "border-box",
          },
        },
        children,
      )
    }

    return {
      inject: ["slots"],
      apply(ctx) {
        ctx.slots.inject("settings.models.footer", () =>
          ctx.slots.register(
            {
              name: "settings.models.footer",
              id: CARD_ID,
              order: 10,
            },
            MuseCodeSignIn,
          ),
        )
      },
    }
  },
})
