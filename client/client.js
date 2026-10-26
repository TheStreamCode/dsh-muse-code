// Web client half of the Muse Code integration.
//
// The Settings > Models page renders the plugins footer seat after the provider
// rows. This module adds the Sign in control there: it calls the Host's exact
// `/muse-code/login` route, which starts the shipped Meta device-code flow,
// opens the verification page in the default browser, and answers with the code
// and the instructions to show next to the button.
//
// This file is a browser CLASSIC SCRIPT, not an ES module: DSH concatenates
// client artifacts into plain script bundles, so an `export` statement here
// breaks the whole bundle ("Unexpected token 'export'"). It therefore lives
// outside the TypeScript source tree: tsc would emit `export {}` for an
// ES-module file. The loader registers a lazy factory whose id is the package
// name; React comes from the browser module table.

const PACKAGE_ID = "@thestreamcode/dsh-muse-code"
const HINT_ID = "dsh-muse-code-sign-in"
const LOGIN_ROUTE = "/muse-code/login"
const REQUEST_TIMEOUT_MS = 25_000

const loader = globalThis.__ModuleLoader__

/** Loopback origin of the Host that owns this page, when it is discoverable. */
function hostOrigin() {
  const transport = globalThis.__DSH_TRANSPORT__
  const base = transport && typeof transport.streamBaseUrl === "string" ? transport.streamBaseUrl : ""
  if (/^https?:\/\//i.test(base)) return base.replace(/\/+$/, "")
  const origin = globalThis.location && globalThis.location.origin
  if (typeof origin === "string" && /^https?:\/\//i.test(origin)) return origin.replace(/\/+$/, "")
  return ""
}

loader?.load({
  id: PACKAGE_ID,
  factory(require) {
    const React = require("react")
    const h = React.createElement

    function MuseCodeSignIn() {
      const [state, setState] = React.useState({ status: "idle", text: "" })
      const origin = hostOrigin()

      async function signIn() {
        setState({ status: "running", text: "" })
        const controller = typeof AbortController === "function" ? new AbortController() : undefined
        const timer = controller === undefined ? undefined : setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
        try {
          const response = await fetch(`${origin}${LOGIN_ROUTE}`, {
            method: "POST",
            headers: { accept: "application/json" },
            ...(controller === undefined ? {} : { signal: controller.signal }),
          })
          const payload = await response.json().catch(() => null)
          if (payload && typeof payload.text === "string" && payload.text.length > 0) {
            setState({ status: payload.ok === true ? "success" : "error", text: payload.text })
            return
          }
          setState({
            status: "error",
            text: `Sign-in failed (HTTP ${response.status}). Run /muse-login in a chat instead.`,
          })
        } catch {
          setState({
            status: "error",
            text: "Could not reach the Host. Run /muse-login in a chat instead.",
          })
        } finally {
          if (timer !== undefined) clearTimeout(timer)
        }
      }

      const style = {
        display: "flex",
        flexDirection: "column",
        gap: "0.5rem",
        margin: 0,
        fontSize: "0.875rem",
        lineHeight: 1.5,
        color: "var(--dsw-alias-text-secondary)",
      }
      const children = [
        h(
          "p",
          { key: "title", style: { margin: 0 } },
          "Muse Code (Meta subscription): ",
          origin.length > 0
            ? "sign in here once; the provider then appears in the model picker."
            : "run /muse-login in any chat to sign in.",
        ),
      ]
      if (origin.length > 0) {
        children.push(
          h(
            "div",
            { key: "actions", style: { display: "flex", alignItems: "center", gap: "0.75rem" } },
            h(
              "button",
              {
                type: "button",
                onClick: signIn,
                disabled: state.status === "running",
                style: {
                  padding: "0.375rem 0.875rem",
                  borderRadius: "0.5rem",
                  border: "1px solid var(--dsw-alias-border-secondary)",
                  background: "var(--dsw-alias-bg-interactive)",
                  color: "var(--dsw-alias-text-primary)",
                  cursor: state.status === "running" ? "progress" : "pointer",
                  fontSize: "0.875rem",
                },
              },
              state.status === "running" ? "Starting sign-in…" : "Sign in",
            ),
            h(
              "span",
              { "aria-live": "polite" },
              state.status === "idle" ? "" : state.text,
            ),
            h(
              "a",
              {
                href: `${origin}${LOGIN_ROUTE}`,
                target: "_blank",
                rel: "noreferrer",
                style: { fontSize: "0.8rem" },
              },
              "Open the sign-in page",
            ),
          ),
        )
      }
      return h("div", { style }, children)
    }

    return {
      inject: ["slots"],
      apply(ctx) {
        ctx.slots.inject("settings.models.footer", () =>
          ctx.slots.register(
            {
              name: "settings.models.footer",
              id: HINT_ID,
              order: 10,
            },
            MuseCodeSignIn,
          ),
        )
      },
    }
  },
})
