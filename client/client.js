// Web client half of the Muse Code integration.
//
// Renders the "Muse Code OAuth" settings section: the subscription status, the
// Sign in with Meta control, the device code, and a live status that flips from
// "Waiting for Meta…" to "Signed in" without a page reload. The page calls the
// Host's exact routes (`POST /muse-code/login`, `GET /muse-code/status`) and
// points at the `/muse-login` command when it cannot reach the Host.
//
// This file is a browser CLASSIC SCRIPT, not an ES module: DSH concatenates
// client artifacts into plain script bundles, so an `export` statement here
// breaks the whole bundle ("Unexpected token 'export'"). It therefore lives
// outside the TypeScript source tree: tsc would emit `export {}` for an
// ES-module file. The loader registers a lazy factory whose id is the package
// name; React comes from the browser module table.

const PACKAGE_ID = "@thestreamcode/dsh-muse-code"
const LOGIN_ROUTE = "/muse-code/login"
const STATUS_ROUTE = "/muse-code/status"
const REQUEST_TIMEOUT_MS = 25_000
const POLL_INTERVAL_MS = 2_000
const POLL_ATTEMPTS = 150

const SECTION_TITLE = "Muse Code OAuth"
// The settings rail cell is ~112px wide, so the nav uses the short name; the
// page itself keeps the full title.
const NAV_LABEL = "Muse Code"
const SECTION_DESCRIPTION =
  "Sign in once with the Meta account that holds the Muse Code subscription. Model access and limits follow Meta's subscription policy."
const HINT_SIGNED_IN = "Muse Code is signed in. The model list is synced from your Meta account."
const HINT_SIGNED_OUT = "Sign in with Meta to use your subscription models in the model picker."
const HINT_PENDING = "Enter this code on Meta's page. This page updates automatically when Meta confirms."
const HOW_TO_TITLE = "How DSH uses these models"
const HOW_TO_INTRO =
  "The plugin declares DSH's shipped meta route as muse-code-oauth and points it at a local adapter. Signing in stores the subscription credential and syncs the model list from your Meta account."
const HOW_TO_NOTE =
  "Run this command in a chat when this page cannot reach the local Host. It runs the same Meta device-code flow."

// Scoped under .mso-root so this page and the Gemini OAuth page can be mounted
// together. Tokens only: the theme owns every color.
const SETTINGS_CSS = `.mso-root {
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  gap: 12px;
  width: 100%;
  max-width: 720px;
  color: var(--dsw-alias-label-primary);
  font-family: inherit;
  text-align: left;
}

.mso-title {
  margin: 0;
  font-size: 16px;
  line-height: 24px;
  font-weight: 500;
  color: var(--dsw-alias-label-primary);
}

.mso-description,
.mso-hint,
.mso-notice {
  margin: 0;
  font-size: 13px;
  line-height: 20px;
  color: var(--dsw-alias-label-secondary);
  overflow-wrap: anywhere;
}

.mso-notice[data-tone="success"] { color: var(--dsw-alias-state-success-primary); }
.mso-notice[data-tone="warning"] { color: var(--dsw-alias-state-warn-label); }
.mso-notice[data-tone="error"] { color: var(--dsw-alias-state-error-primary); }

.mso-card {
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  gap: 12px;
  min-width: 0;
  padding: 12px 14px;
  border: 0.5px solid var(--dsw-alias-settings-card-stroke);
  border-radius: var(--dsw-radius-xl);
  background: var(--dsw-alias-settings-card-fill);
}

.mso-cardHead {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
  min-width: 0;
}

.mso-state {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  font-size: 14px;
  line-height: 22px;
  font-weight: 500;
  color: var(--dsw-alias-label-primary);
}

.mso-dot {
  flex: none;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  corner-shape: round;
  background: currentColor;
  color: var(--dsw-alias-state-idle-primary);
}

.mso-dot[data-state="success"] { color: var(--dsw-alias-state-success-primary); }
.mso-dot[data-state="warning"] { color: var(--dsw-alias-state-warn-primary); }
.mso-dot[data-state="error"] { color: var(--dsw-alias-state-error-primary); }

.mso-identity {
  min-width: 0;
  font-size: 13px;
  line-height: 20px;
  color: var(--dsw-alias-label-tertiary);
  overflow-wrap: anywhere;
}

.mso-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.mso-cardHead > .mso-actions { margin-left: auto; }

.mso-button {
  box-sizing: border-box;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  height: 36px;
  padding: 0 14px;
  border: none;
  border-radius: var(--dsw-radius-md);
  background: transparent;
  color: var(--dsw-alias-label-primary);
  font-family: inherit;
  font-size: 14px;
  line-height: 22px;
  text-decoration: none;
  cursor: pointer;
}

.mso-button:disabled { opacity: 0.4; cursor: not-allowed; }

.mso-button[data-variant="primary"] {
  background: var(--dsw-alias-button-primary-fill);
  color: var(--dsw-alias-label-primary-foreground);
}

.mso-button[data-variant="outline"] {
  box-shadow: inset 0 0 0 0.5px var(--dsw-alias-border-l3);
}

.mso-button[data-variant="danger"] {
  color: var(--dsw-alias-state-error-primary);
}

@media (hover: hover) {
  .mso-button[data-variant="primary"]:hover:not(:disabled) {
    background: var(--dsw-alias-button-primary-hover);
  }

  .mso-button[data-variant="outline"]:hover:not(:disabled),
  .mso-button[data-variant="ghost"]:hover:not(:disabled) {
    background: var(--dsw-alias-interactive-bg-hover);
  }

  .mso-button[data-variant="danger"]:hover:not(:disabled) {
    background: var(--dsw-alias-interactive-bg-hover-danger);
  }
}

.mso-facts {
  display: grid;
  grid-template-columns: max-content minmax(0, 1fr);
  gap: 8px 16px;
  align-items: start;
  min-width: 0;
}

.mso-factLabel {
  font-size: 13px;
  line-height: 20px;
  color: var(--dsw-alias-label-tertiary);
}

.mso-factValue {
  min-width: 0;
  font-size: 13px;
  line-height: 20px;
  color: var(--dsw-alias-label-secondary);
  overflow-wrap: anywhere;
}

.mso-code {
  font-family: var(--ds-font-family-code, ui-monospace, SFMono-Regular, Menlo, Consolas, monospace);
  font-size: 12px;
  line-height: 18px;
  padding: 1px 6px;
  border-radius: var(--dsw-radius-xs);
  background: var(--dsw-alias-markdown-inline-code);
  color: var(--dsw-alias-label-primary);
}

.mso-codeRow {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}

.mso-deviceCode {
  align-self: flex-start;
  font-family: var(--ds-font-family-code, ui-monospace, SFMono-Regular, Menlo, Consolas, monospace);
  font-size: 20px;
  line-height: 28px;
  font-weight: 500;
  letter-spacing: 0.12em;
  padding: 4px 10px;
  border-radius: var(--dsw-radius-sm);
  background: var(--dsw-alias-markdown-inline-code);
  color: var(--dsw-alias-label-primary);
}

.mso-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 8px;
}

.mso-chip {
  font-family: var(--ds-font-family-code, ui-monospace, SFMono-Regular, Menlo, Consolas, monospace);
  font-size: 11px;
  line-height: 17px;
  padding: 1px 8px;
  border-radius: 999px;
  corner-shape: round;
  background: var(--dsw-alias-bg-module-platform);
  color: var(--dsw-alias-label-secondary);
  white-space: nowrap;
}

.mso-fold {
  border: 0.5px solid var(--dsw-alias-settings-card-stroke);
  border-radius: var(--dsw-radius-xl);
  background: var(--dsw-alias-settings-card-fill);
  overflow: hidden;
}

.mso-fold > summary {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px 14px;
  font-size: 13px;
  line-height: 20px;
  font-weight: 500;
  color: var(--dsw-alias-label-primary);
  cursor: pointer;
  list-style: none;
}

.mso-fold > summary::-webkit-details-marker { display: none; }

.mso-foldBody {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 0 14px 14px;
  min-width: 0;
}

.mso-chevron {
  flex: none;
  width: 6px;
  height: 6px;
  margin-left: auto;
  border-right: 1.5px solid var(--dsw-alias-label-tertiary);
  border-bottom: 1.5px solid var(--dsw-alias-label-tertiary);
  transform: rotate(45deg);
  transition: transform 0.15s ease;
}

.mso-fold[open] .mso-chevron { transform: rotate(-135deg); }

@media (prefers-reduced-motion: reduce) {
  .mso-chevron { transition: none; }
}

.mso-pre {
  margin: 0;
  padding: 10px 12px;
  border-radius: var(--dsw-radius-lg);
  background: var(--dsw-alias-markdown-code-block);
  color: var(--dsw-alias-label-secondary);
  font-family: var(--ds-font-family-code, ui-monospace, SFMono-Regular, Menlo, Consolas, monospace);
  font-size: 12px;
  line-height: 18px;
  overflow: auto;
  white-space: pre;
}

.mso-count {
  font-weight: 400;
  color: var(--dsw-alias-label-tertiary);
}`

const loader = globalThis.__ModuleLoader__

/** One module-level poll chain: the settings section renders one page. */
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

/**
 * Inject the page stylesheet once per apply. The Host runs the client inside the
 * browser, but the Node tests evaluate this file without a DOM.
 */
function installStylesheet() {
  if (typeof document === "undefined" || document.head === undefined || document.head === null) {
    return function () {}
  }
  const style = document.createElement("style")
  style.setAttribute("data-dsh-muse-code", "settings-section")
  style.textContent = SETTINGS_CSS
  document.head.appendChild(style)
  return function () {
    if (typeof style.remove === "function") style.remove()
    else if (style.parentNode !== undefined && style.parentNode !== null) style.parentNode.removeChild(style)
  }
}

loader?.load({
  id: PACKAGE_ID,
  factory(require) {
    const React = require("react")
    const h = React.createElement

    function statusView(phase) {
      if (phase === "authorized") return { label: "Signed in", state: "success" }
      if (phase === "pending" || phase === "starting") return { label: "Waiting for Meta…", state: "warning" }
      if (phase === "checking") return { label: "Checking…", state: "idle" }
      if (phase === "failed") return { label: "Sign-in failed", state: "error" }
      return { label: "Not signed in", state: "idle" }
    }

    function stateHint(phase) {
      if (phase === "authorized") return HINT_SIGNED_IN
      if (phase === "pending" || phase === "starting") return HINT_PENDING
      return HINT_SIGNED_OUT
    }

    function MuseCodeSection() {
      const origin = hostOrigin()
      const [state, setState] = React.useState({
        phase: origin.length === 0 ? "idle" : "checking",
        text: "",
        code: "",
        metaUrl: "",
      })

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
              metaUrl: "",
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
              code: "",
              metaUrl: "",
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
          return { ...previous, phase: "starting", text: "", code: "", metaUrl: "" }
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
              metaUrl: "",
            }
          })
        } catch {
          setState(function (previous) {
            return {
              ...previous,
              phase: "failed",
              text: "Could not reach the Host. Run /muse-login in a chat instead.",
              metaUrl: "",
            }
          })
        }
      }

      const view = statusView(state.phase)
      const signedIn = state.phase === "authorized"
      const pending = state.phase === "pending" || state.phase === "starting"
      const showActions = origin.length > 0 && state.phase !== "checking"
      // While a sign-in is pending the primary control would only duplicate the
      // Meta hand-off, so the page keeps the "Open Meta page" link alone.
      const showPrimary = showActions && !pending
      const secondaryLabel = pending ? "Open Meta page" : "Open sign-in page"
      const secondaryHref =
        pending && state.metaUrl.length > 0
          ? state.metaUrl
          : origin.length > 0
            ? origin + LOGIN_ROUTE
            : ""

      const cardChildren = [
        h(
          "div",
          { key: "head", className: "mso-cardHead" },
          h(
            "span",
            { key: "state", className: "mso-state" },
            h("span", { key: "dot", className: "mso-dot", "data-state": view.state, "aria-hidden": true }),
            view.label,
          ),
          showPrimary
            ? h(
                "div",
                { key: "primary", className: "mso-actions" },
                h(
                  "button",
                  {
                    type: "button",
                    className: "mso-button",
                    "data-variant": signedIn ? "outline" : "primary",
                    onClick: startSignIn,
                  },
                  signedIn ? "Sign in again" : "Sign in with Meta",
                ),
              )
            : null,
        ),
        h("p", { key: "hint", className: "mso-hint" }, stateHint(state.phase)),
        pending && state.code.length > 0
          ? h(
              "div",
              { key: "code", className: "mso-codeRow" },
              h("span", { key: "codeLabel", className: "mso-factLabel" }, "Code"),
              h("code", { key: "codeValue", className: "mso-deviceCode" }, state.code),
            )
          : null,
        h(
          "div",
          { key: "facts", className: "mso-facts" },
          h("span", { key: "providerLabel", className: "mso-factLabel" }, "Provider"),
          h(
            "span",
            { key: "providerValue", className: "mso-factValue" },
            h("code", { key: "providerCode", className: "mso-code" }, "muse-code-oauth"),
          ),
          h("span", { key: "signInLabel", className: "mso-factLabel" }, "Sign-in"),
          h("span", { key: "signInValue", className: "mso-factValue" }, "Meta device code"),
          h("span", { key: "modelsLabel", className: "mso-factLabel" }, "Models"),
          h("span", { key: "modelsValue", className: "mso-factValue" }, "Synced from your Meta account"),
        ),
        showActions && secondaryHref.length > 0
          ? h(
              "div",
              { key: "secondary", className: "mso-actions" },
              h(
                "a",
                {
                  key: "link",
                  className: "mso-button",
                  "data-variant": "outline",
                  href: secondaryHref,
                  target: "_blank",
                  rel: "noreferrer",
                },
                secondaryLabel,
              ),
            )
          : null,
        origin.length === 0
          ? h(
              "p",
              { key: "fallback", className: "mso-notice", "data-tone": "warning", role: "status" },
              "This page cannot reach the local Host. Run ",
              h("code", { key: "fallbackCommand", className: "mso-code" }, "/muse-login"),
              " in a chat to sign in.",
            )
          : null,
        state.text.length > 0 && !signedIn
          ? h(
              "p",
              {
                key: "notice",
                className: "mso-notice",
                ...(state.phase === "failed"
                  ? { "data-tone": "error", role: "alert" }
                  : { role: "status" }),
              },
              state.text,
            )
          : null,
      ]

      return h(
        "section",
        { className: "mso-root" },
        h("h2", { key: "title", className: "mso-title" }, SECTION_TITLE),
        h("p", { key: "description", className: "mso-description" }, SECTION_DESCRIPTION),
        h("div", { key: "card", className: "mso-card" }, cardChildren),
        h(
          "details",
          { key: "howTo", className: "mso-fold" },
          h(
            "summary",
            null,
            HOW_TO_TITLE,
            h("span", { key: "chevron", className: "mso-chevron", "aria-hidden": true }),
          ),
          h(
            "div",
            { className: "mso-foldBody" },
            h("p", { className: "mso-hint" }, HOW_TO_INTRO),
            h("pre", { className: "mso-pre" }, "/muse-login"),
            h("p", { className: "mso-hint" }, HOW_TO_NOTE),
          ),
        ),
      )
    }

    return {
      inject: ["slots"],
      apply(ctx) {
        ctx.effect(installStylesheet, "dsh-muse-code: settings section styles")
        ctx.slots.inject("settings.section", () =>
          ctx.slots.register(
            {
              name: "settings.section",
              id: "muse-code-oauth",
              order: 53,
              label: () => NAV_LABEL,
            },
            MuseCodeSection,
          ),
        )
      },
    }
  },
})
