// Muse Code (Meta subscription) integration for DeepSeek Harness.
//
// DeepSeek Harness already serves this subscription: the shipped pi-ai catalog
// exposes the `meta` route (api.meta.ai/v1) and registers the `llm-pi-ai/meta`
// authorization flow, which runs Meta's device-code login and stores the
// renewable credential record. The Web/Desktop Settings surface has no generic
// button for provider OAuth flows, so this bundle adds the pieces a user needs:
//
// - it declares the `meta` route in the `llm-pi-ai` settings section, so the
//   provider appears under Settings > Models and its models in the model picker;
// - it exposes the shipped sign-in as the `/muse-login` command;
// - it registers an exact Web route (`/muse-code/login`) and a Sign in control
//   under Settings > Models that calls it, because the Settings page cannot
//   reach the Host authorization seam through the Remote API.
//
// The Host opens the verification page in the user's default browser itself; the
// route and the command also return the code and the URL, so a blocked browser
// never strands the sign-in.
//
// A second `@deepseek-ai/dsh-llm-pi-ai` instance is not an option: every
// instance declares the whole installed provider catalog, so the extra instance
// fails to activate with a duplicate configurable-provider error.
import { openExternal } from "./open-browser.js";
export const name = "dsh-muse-code";
export const inject = ["authorization", "commands"];
/** Settings namespace whose provider profiles configure the pi-ai routes. */
const SETTINGS_NS = "llm-pi-ai";
/** Route served by the shipped pi-ai Meta provider. */
const PROVIDER = "meta";
/** Credential record / authorization flow the shipped pi-ai adapter registers. */
const AUTH_KEY = "llm-pi-ai/meta";
/** Preferred sign-in method; the shipped flow offers `oauth` first. */
const AUTH_METHOD = "oauth";
/** Display name for the route this bundle declares. */
const ROUTE_LABEL = "Muse Code (Meta subscription)";
/** Web route the Settings control calls to start the sign-in. */
export const LOGIN_ROUTE = "/muse-code/login";
/** How long the sign-in waits for the device-code notice before giving up. */
const NOTICE_TIMEOUT_MS = 20_000;
/**
 * Register the sign-in command, the Settings > Models sign-in route, and the
 * settings write that makes the Muse Code provider visible.
 * @param ctx - Host plugin context.
 */
export function apply(ctx) {
    ctx.effect(() => ctx.commands.register(museLoginCommand(ctx)), "dsh-muse-code: /muse-login");
    if (typeof ctx.inject !== "function")
        return;
    ctx.inject(["webServer"], (child) => {
        const webServer = child.webServer;
        if (webServer === undefined)
            return;
        child.effect(() => webServer.register({
            kind: "exact",
            path: LOGIN_ROUTE,
            handler: createLoginRouteHandler(ctx),
        }), "dsh-muse-code: login route");
    });
    ctx.inject(["settings"], (child) => {
        child.effect(() => {
            const settings = child.settings;
            if (settings === undefined)
                return () => { };
            void ensureMuseRoute(settings, ctx.logger).catch((error) => {
                warn(ctx.logger, "dsh-muse-code: could not declare the Muse Code route", error);
            });
            return () => { };
        }, "dsh-muse-code: declare route");
    });
}
/** Command definition for the sign-in; exported for tests. */
export function museLoginCommand(ctx, options = {}) {
    return {
        name: "muse-login",
        description: "Sign in to the Muse Code (Meta) subscription and enable its models",
        async handler() {
            const outcome = await startSignIn(ctx, options);
            if (outcome.ok)
                return { kind: "success", text: outcome.text };
            return { kind: "error", text: outcome.text };
        },
    };
}
/**
 * Build the exact Web route that starts the same sign-in from the Settings
 * page. The route answers JSON so the Client control can render the code and
 * the failure reason next to its button.
 * @param ctx - Host plugin context.
 * @param options - injected side effects, overridable in tests.
 * @returns an HTTP handler for {@link LOGIN_ROUTE}.
 */
export function createLoginRouteHandler(ctx, options = {}) {
    return async (request, response) => {
        setCorsHeaders(response);
        if (request.method === "OPTIONS") {
            response.writeHead(204);
            response.end();
            return;
        }
        if (request.method === "GET") {
            // A plain navigation: this tab is the browser, so the flow need not open
            // another one. The page shows the code and moves on to Meta's page.
            const outcome = await startSignIn(ctx, { ...options, openBrowser: () => false });
            sendHtml(response, signInPage(outcome));
            return;
        }
        if (request.method !== "POST") {
            sendJson(response, 405, { ok: false, reason: "method", text: "Use GET or POST to start the sign-in." });
            return;
        }
        const outcome = await startSignIn(ctx, options);
        if (outcome.ok) {
            sendJson(response, 200, { ok: true, text: outcome.text, url: outcome.url, code: outcome.code });
            return;
        }
        const status = outcome.reason === "busy" ? 409 : outcome.reason === "timeout" ? 504 : 500;
        sendJson(response, status, { ok: false, reason: outcome.reason, text: outcome.text });
    };
}
/**
 * Start one sign-in attempt and wait for the actionable device-code notice.
 * The attempt itself keeps running after the notice, so Meta's approval is
 * picked up and the credential is stored by the seam.
 * @param ctx - Host plugin context.
 * @param options - injected side effects, overridable in tests.
 * @returns the user-facing outcome.
 */
export async function startSignIn(ctx, options = {}) {
    const entry = ctx.authorization.describe(AUTH_KEY);
    if (entry === undefined) {
        return {
            ok: false,
            reason: "unavailable",
            text: "Muse Code is unavailable: this DeepSeek Harness build has no Meta sign-in flow " +
                `(${AUTH_KEY}). Update DeepSeek Harness or add the Meta provider under Settings > Models first.`,
        };
    }
    if (entry.inFlight) {
        return {
            ok: false,
            reason: "busy",
            text: "A Muse Code sign-in is already running. Approve it in the browser, then retry.",
        };
    }
    const method = entry.methods.find((candidate) => candidate.id === AUTH_METHOD)?.id ?? entry.methods[0]?.id;
    if (method === undefined) {
        return {
            ok: false,
            reason: "unavailable",
            text: `The Muse Code sign-in flow offers no method to run (${AUTH_KEY}).`,
        };
    }
    const openBrowser = options.openBrowser ?? openExternal;
    const timeoutMs = options.timeoutMs ?? NOTICE_TIMEOUT_MS;
    let announced;
    let announce = () => { };
    const notice = new Promise((resolve) => {
        announce = resolve;
    });
    const attempt = ctx.authorization.begin({
        key: AUTH_KEY,
        method,
        interaction: {
            notify(value) {
                const instruction = readSignInNotice(value);
                if (instruction === undefined)
                    return;
                announced = instruction;
                announce(instruction);
            },
            prompt() {
                return Promise.reject(new Error("Muse Code sign-in does not accept interactive prompts"));
            },
        },
    });
    // The attempt outlives the request that started it: Meta approval arrives
    // later and the seam stores the credential then.
    attempt.then((outcome) => ctx.logger?.info?.(`dsh-muse-code: sign-in settled as ${outcome.status}`), (failure) => warn(ctx.logger, "dsh-muse-code: sign-in failed", failure));
    const announcedNotice = notice.then((instruction) => ({ kind: "notice", instruction }));
    const settled = attempt.then((outcome) => ({ kind: "settled", outcome }), (failure) => ({ kind: "failed", failure }));
    const timer = {};
    const timeout = new Promise((resolve) => {
        timer.handle = setTimeout(() => resolve({ kind: "timeout" }), timeoutMs);
        timer.handle.unref?.();
    });
    try {
        const outcome = await Promise.race([announcedNotice, settled, timeout]);
        if (outcome.kind === "notice") {
            return successOutcome(outcome.instruction, openBrowser);
        }
        if (outcome.kind === "timeout") {
            ctx.authorization.cancel?.(AUTH_KEY);
            return {
                ok: false,
                reason: "timeout",
                text: "Muse Code sign-in did not answer in time. Check the connection and run /muse-login again.",
            };
        }
        if (outcome.kind === "failed") {
            const text = messageOf(outcome.failure);
            if (/already running/i.test(text)) {
                return { ok: false, reason: "busy", text: "A Muse Code sign-in is already running. Approve it in the browser, then retry." };
            }
            return { ok: false, reason: "failed", text: `Muse Code sign-in failed: ${text}` };
        }
        if (announced !== undefined)
            return successOutcome(announced, openBrowser);
        if (outcome.outcome.status === "authorized") {
            return {
                ok: false,
                reason: "ended",
                text: "Muse Code sign-in finished without showing a code. Run /muse-login again if the models stay unavailable.",
            };
        }
        return { ok: false, reason: "ended", text: `Muse Code sign-in ended (${outcome.outcome.status}).` };
    }
    finally {
        if (timer.handle !== undefined)
            clearTimeout(timer.handle);
    }
}
function successOutcome(instruction, openBrowser) {
    // The browser hand-off is a courtesy for a purely local effect: the user must
    // still confirm the code on Meta's page, and both surfaces expose the URL.
    const opened = openBrowser(instruction.completeUrl);
    return {
        ok: true,
        url: instruction.completeUrl,
        ...(instruction.code === undefined ? {} : { code: instruction.code }),
        text: formatSignInText(instruction, opened),
    };
}
/**
 * Read the actionable instruction out of one authorization notice.
 * @param notice - a seam notice (`message`/`url`/`code`) or a raw adapter one.
 * @returns the instruction, or undefined for progress notices with no page.
 */
export function readSignInNotice(notice) {
    const rawUrl = firstNonEmptyString(notice.url, notice.verificationUri);
    if (rawUrl === undefined)
        return undefined;
    let url;
    try {
        url = new URL(rawUrl);
    }
    catch {
        return undefined;
    }
    if (url.protocol !== "http:" && url.protocol !== "https:")
        return undefined;
    const code = firstNonEmptyString(notice.code, notice.userCode);
    const message = firstNonEmptyString(notice.message, notice.instructions);
    if (code !== undefined && !url.searchParams.has("code"))
        url.searchParams.set("code", code);
    return {
        url: rawUrl,
        completeUrl: url.toString(),
        ...(code === undefined ? {} : { code }),
        ...(message === undefined ? {} : { message }),
    };
}
/**
 * Render the instruction text shared by the command result and the Settings
 * control.
 * @param instruction - actionable notice.
 * @param opened - whether the browser hand-off was started.
 * @returns one line the user can act on.
 */
export function formatSignInText(instruction, opened) {
    const openPart = opened
        ? "A browser tab should have opened; if not, open it yourself."
        : "Open this page in your browser.";
    const codePart = instruction.code === undefined
        ? "Confirm the sign-in on the Meta page."
        : `Confirm the code ${instruction.code} there.`;
    return `Muse Code sign-in started. ${openPart} ${codePart} Page: ${instruction.completeUrl} Muse Code models become available as soon as Meta confirms.`;
}
/**
 * Declare the shipped `meta` route in the `llm-pi-ai` settings section so the
 * provider appears in Settings > Models and its models in the picker.
 *
 * The write is a merge into the entry's editable config, exactly what the
 * Models page does when a user adds this provider by hand; an already declared
 * `meta` profile is never touched.
 *
 * @param settings - the Settings form service.
 * @param logger - optional plugin logger.
 * @param options - retry window for late-activating profile entries.
 * @returns whether this call added the route.
 */
export async function ensureMuseRoute(settings, logger, options = {}) {
    const attempts = options.attempts ?? 12;
    const delayMs = options.delayMs ?? 250;
    for (let attempt = 0; attempt < attempts; attempt += 1) {
        const row = settings.describe().find((candidate) => candidate.ns === SETTINGS_NS);
        if (row !== undefined) {
            const providers = row.value["providers"];
            const declared = isRecord(providers) && Object.hasOwn(providers, PROVIDER);
            if (declared)
                return false;
            await settings.update(SETTINGS_NS, { providers: { [PROVIDER]: { displayName: ROUTE_LABEL } } }, row.revision);
            logger?.info?.(`dsh-muse-code: declared the ${PROVIDER} route in Settings > Models`);
            return true;
        }
        if (attempt < attempts - 1 && delayMs > 0)
            await sleep(delayMs);
    }
    logger?.debug?.(`dsh-muse-code: no configurable "${SETTINGS_NS}" entry; leaving the route to Settings > Models`);
    return false;
}
function setCorsHeaders(response) {
    response.setHeader("Access-Control-Allow-Origin", "*");
    response.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
    response.setHeader("Access-Control-Allow-Headers", "content-type");
    response.setHeader("Cache-Control", "no-store");
}
function sendJson(response, status, body) {
    const text = JSON.stringify(body);
    response.writeHead(status, { "content-type": "application/json; charset=utf-8" });
    response.end(text);
}
function sendHtml(response, html) {
    response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    response.end(html);
}
/**
 * The page a plain navigation to {@link LOGIN_ROUTE} receives: the code, the
 * fallback link, and an immediate move to Meta's verification page.
 * @param outcome - result of the sign-in attempt.
 * @returns a self-contained HTML document.
 */
function signInPage(outcome) {
    const title = "Muse Code sign-in";
    if (!outcome.ok) {
        return `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title></head>` +
            `<body style="font-family:system-ui,sans-serif;padding:2rem;line-height:1.5">` +
            `<h1 style="font-size:1.1rem">${escapeHtml(title)}</h1>` +
            `<p>${escapeHtml(outcome.text)}</p>` +
            `<p><a href="/muse-code/login">Try again</a></p></body></html>`;
    }
    const codePart = outcome.code === undefined
        ? ""
        : `<p style="font-size:1.4rem;letter-spacing:0.1em"><strong>${escapeHtml(outcome.code)}</strong></p>`;
    return `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title>` +
        `<meta http-equiv="refresh" content="1; url=${escapeHtml(outcome.url)}"></head>` +
        `<body style="font-family:system-ui,sans-serif;padding:2rem;line-height:1.5">` +
        `<h1 style="font-size:1.1rem">${escapeHtml(title)}</h1>` +
        `<p>Confirm this code on Meta's page:</p>${codePart}` +
        `<p>If the page does not open, <a href="${escapeHtml(outcome.url)}">continue on Meta</a>.</p>` +
        `</body></html>`;
}
function escapeHtml(value) {
    return value
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;");
}
function firstNonEmptyString(...values) {
    for (const value of values) {
        if (typeof value === "string" && value.trim().length > 0)
            return value.trim();
    }
    return undefined;
}
function isRecord(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
function messageOf(failure) {
    if (failure instanceof Error && failure.message.length > 0)
        return failure.message;
    const text = String(failure);
    return text.length > 0 ? text : "unknown error";
}
function warn(logger, message, error) {
    const text = `${message}: ${messageOf(error)}`;
    if (logger?.warn !== undefined)
        logger.warn(text);
    else if (logger?.debug !== undefined)
        logger.debug(text);
}
function sleep(ms) {
    return new Promise((resolve) => {
        const handle = setTimeout(resolve, ms);
        handle.unref?.();
    });
}
