// Muse Code (Meta subscription) integration for DeepSeek Harness.
//
// DeepSeek Harness already serves this subscription: the shipped pi-ai catalog
// exposes the `meta` route (api.meta.ai/v1) and registers the `llm-pi-ai/meta`
// authorization flow, which runs Meta's device-code login and stores the
// renewable credential record. This bundle adds what the harness does not:
//
// - it declares the `meta` route in the `llm-pi-ai` settings section, so the
//   provider appears under Settings > Models and its models in the model picker;
// - it syncs the account's live chat catalog (`GET /v1/models`) into that
//   route, so models the shipped pi-ai catalog does not list (Muse Wonder and
//   future ids) are selectable without a DSH update;
// - it exposes the shipped sign-in as `/muse-login` and as an exact local Web
//   route (`POST /muse-code/login`) that the Settings control calls, because
//   the Settings page cannot reach the authorization seam through the Remote
//   API;
// - it reports the sign-in state (`GET /muse-code/status`) so both the Settings
//   control and the command can say "signed in" instead of leaving the user
//   waiting after Meta confirmed.
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
/** Web route that reports whether the sign-in completed. */
export const STATUS_ROUTE = "/muse-code/status";
/** How long the sign-in waits for the device-code notice before giving up. */
const NOTICE_TIMEOUT_MS = 20_000;
/** How long `/muse-login` waits for Meta's confirmation before answering. */
const RESULT_WAIT_MS = 120_000;
/** Live chat catalog of the Meta Model API. */
const MODELS_URL = "https://api.meta.ai/v1/models";
const MODELS_TIMEOUT_MS = 8_000;
/** Endpoint families the Muse subscription also lists but DSH cannot chat with. */
const NON_CHAT_PREFIXES = ["sam-", "muse-image-", "muse-voice-"];
/** Family defaults mirrored from the sibling Muse plugins and the pi-ai catalog. */
const MUSE_CONTEXT_WINDOW = 1_048_576;
const MUSE_MAX_OUTPUT_TOKENS = 131_072;
/** The five Muse Spark rows the shipped pi-ai catalog describes, with fidelity. */
const SPARK_MODELS = {
    "muse-spark-1.1": { name: "Muse Spark 1.1", max: false },
    "muse-spark-1.2": { name: "Muse Spark 1.2", max: false },
    "muse-spark-1.2-contributor": { name: "Muse Spark 1.2 Contributor", max: false },
    "muse-spark-1.3": { name: "Muse Spark 1.3", max: true },
    "muse-spark-1.3-contributor": { name: "Muse Spark 1.3 Contributor", max: false },
};
/** Create one empty sign-in state. */
export function createSignInState() {
    let snapshot = { state: "idle", at: 0 };
    return {
        get: () => snapshot,
        set: (next) => {
            snapshot = next;
        },
    };
}
/**
 * Register the sign-in command, the Settings > Models routes, the live catalog
 * sync, and the settings write that makes the Muse Code provider visible.
 * @param ctx - Host plugin context.
 */
export function apply(ctx) {
    const state = createSignInState();
    let credentialsFace;
    const options = { state, credentials: () => credentialsFace };
    ctx.effect(() => ctx.commands.register(museLoginCommand(ctx, options)), "dsh-muse-code: /muse-login");
    if (typeof ctx.inject !== "function")
        return;
    ctx.inject(["credentials"], (child) => {
        credentialsFace = child.credentials;
    });
    ctx.inject(["webServer"], (child) => {
        const webServer = child.webServer;
        if (webServer === undefined)
            return;
        child.effect(() => {
            const disposeLogin = webServer.register({
                kind: "exact",
                path: LOGIN_ROUTE,
                handler: createLoginRouteHandler(ctx, options),
            });
            const disposeStatus = webServer.register({
                kind: "exact",
                path: STATUS_ROUTE,
                handler: createStatusRouteHandler(ctx, options),
            });
            return () => {
                disposeStatus();
                disposeLogin();
            };
        }, "dsh-muse-code: login routes");
    });
    ctx.inject(["settings"], (child) => {
        child.effect(() => {
            const settings = child.settings;
            if (settings === undefined)
                return () => { };
            const refresh = () => {
                void (async () => {
                    await ensureMuseRoute(settings, ctx.logger);
                    await syncMuseModels(settings, ctx.logger, options);
                })().catch((error) => {
                    warn(ctx.logger, "dsh-muse-code: could not refresh the Muse Code settings", error);
                });
            };
            refresh();
            const dispose = ctx.on?.("credentials/record-updated", (key) => {
                if (key === AUTH_KEY)
                    refresh();
            });
            return dispose ?? (() => { });
        }, "dsh-muse-code: settings");
    });
}
/** Command definition for the sign-in; exported for tests. */
export function museLoginCommand(ctx, options = {}) {
    return {
        name: "muse-login",
        description: "Sign in to the Muse Code (Meta) subscription and enable its models",
        async handler() {
            let attempt;
            const started = await startSignIn(ctx, {
                ...options,
                onAttempt: (pending) => {
                    attempt = pending;
                },
            });
            if (!started.ok)
                return { kind: "error", text: started.text };
            const waitMs = options.waitForResultMs ?? RESULT_WAIT_MS;
            if (!started.opened || attempt === undefined || waitMs <= 0) {
                return { kind: "success", text: started.text };
            }
            const result = await waitForSettlement(attempt, waitMs);
            if (result === undefined) {
                return { kind: "success", text: `${started.text} Still waiting for Meta: the sign-in completes when you approve the page.` };
            }
            if (result.status === "authorized") {
                return { kind: "success", text: "Muse Code is signed in. Its models are available in the model picker." };
            }
            return {
                kind: "error",
                text: `Muse Code sign-in ended (${result.status}). Run /muse-login again to retry.`,
            };
        },
    };
}
/**
 * Build the exact Web route that starts the same sign-in from the Settings
 * page. POST answers JSON for the Settings control; GET answers a small page
 * that shows the code and polls the status route until Meta confirms.
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
            // another one. The page itself polls the status route.
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
            sendJson(response, 200, {
                ok: true,
                text: outcome.text,
                url: outcome.url,
                code: outcome.code,
                opened: outcome.opened,
            });
            return;
        }
        const status = outcome.reason === "busy" ? 409 : outcome.reason === "timeout" ? 504 : 500;
        sendJson(response, status, { ok: false, reason: outcome.reason, text: outcome.text });
    };
}
/**
 * Build the exact Web route that reports the sign-in state, so the Settings
 * control can flip to "Signed in" after Meta confirms.
 * @param ctx - Host plugin context.
 * @param options - injected side effects, overridable in tests.
 * @returns an HTTP handler for {@link STATUS_ROUTE}.
 */
export function createStatusRouteHandler(ctx, options = {}) {
    return async (request, response) => {
        setCorsHeaders(response);
        if (request.method === "OPTIONS") {
            response.writeHead(204);
            response.end();
            return;
        }
        if (request.method !== "GET") {
            sendJson(response, 405, { ok: false, text: "Use GET for the sign-in status." });
            return;
        }
        const snapshot = options.state?.get();
        try {
            const credentials = options.credentials?.();
            if (credentials !== undefined) {
                const record = await credentials.describeRecord(AUTH_KEY);
                if (record.configured) {
                    sendJson(response, 200, { state: "authorized", text: "Muse Code is signed in." });
                    return;
                }
            }
        }
        catch {
            // Fall through to the in-memory state.
        }
        const entry = ctx.authorization.describe(AUTH_KEY);
        if (entry?.inFlight === true) {
            sendJson(response, 200, {
                state: "pending",
                ...(snapshot?.text === undefined ? {} : { text: snapshot.text }),
                ...(snapshot?.code === undefined ? {} : { code: snapshot.code }),
            });
            return;
        }
        if (snapshot !== undefined && snapshot.state !== "idle") {
            sendJson(response, 200, {
                state: snapshot.state,
                ...(snapshot.text === undefined ? {} : { text: snapshot.text }),
            });
            return;
        }
        sendJson(response, 200, { state: "idle" });
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
    const fail = (reason, text) => {
        options.state?.set({ state: "failed", text, at: Date.now() });
        return { ok: false, reason, text };
    };
    const entry = ctx.authorization.describe(AUTH_KEY);
    if (entry === undefined) {
        return fail("unavailable", "Muse Code is unavailable: this DeepSeek Harness build has no Meta sign-in flow " +
            `(${AUTH_KEY}). Update DeepSeek Harness or add the Meta provider under Settings > Models first.`);
    }
    if (entry.inFlight) {
        return fail("busy", "A Muse Code sign-in is already running. Approve it in the browser, then retry.");
    }
    const method = entry.methods.find((candidate) => candidate.id === AUTH_METHOD)?.id ?? entry.methods[0]?.id;
    if (method === undefined) {
        return fail("unavailable", `The Muse Code sign-in flow offers no method to run (${AUTH_KEY}).`);
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
    options.onAttempt?.(attempt);
    // The attempt outlives the request that started it: Meta approval arrives
    // later and the seam stores the credential then.
    attempt.then((outcome) => {
        options.state?.set({
            state: outcome.status === "authorized" ? "authorized" : "cancelled",
            text: outcome.status === "authorized"
                ? "Muse Code is signed in."
                : `Muse Code sign-in ended (${outcome.status}).`,
            at: Date.now(),
        });
        ctx.logger?.info?.(`dsh-muse-code: sign-in settled as ${outcome.status}`);
    }, (failure) => {
        const text = `Muse Code sign-in failed: ${messageOf(failure)}`;
        options.state?.set({ state: "failed", text, at: Date.now() });
        warn(ctx.logger, "dsh-muse-code: sign-in failed", failure);
    });
    const announcedNotice = notice.then((instruction) => ({ kind: "notice", instruction }));
    const settled = attempt.then((outcome) => ({ kind: "settled", outcome }), (failure) => ({ kind: "failed", failure }));
    const timer = {};
    const timeout = new Promise((resolve) => {
        timer.handle = setTimeout(() => resolve({ kind: "timeout" }), timeoutMs);
        timer.handle.unref?.();
    });
    try {
        const outcome = await Promise.race([announcedNotice, settled, timeout]);
        if (outcome.kind === "notice")
            return successOutcome(outcome.instruction, openBrowser, options.state);
        if (outcome.kind === "timeout") {
            ctx.authorization.cancel?.(AUTH_KEY);
            return fail("timeout", "Muse Code sign-in did not answer in time. Check the connection and run /muse-login again.");
        }
        if (outcome.kind === "failed") {
            const text = messageOf(outcome.failure);
            if (/already running/i.test(text)) {
                return fail("busy", "A Muse Code sign-in is already running. Approve it in the browser, then retry.");
            }
            return fail("failed", `Muse Code sign-in failed: ${text}`);
        }
        if (announced !== undefined)
            return successOutcome(announced, openBrowser, options.state);
        if (outcome.outcome.status === "authorized") {
            return fail("ended", "Muse Code sign-in finished without showing a code. Run /muse-login again if the models stay unavailable.");
        }
        return fail("ended", `Muse Code sign-in ended (${outcome.outcome.status}).`);
    }
    finally {
        if (timer.handle !== undefined)
            clearTimeout(timer.handle);
    }
}
function successOutcome(instruction, openBrowser, state) {
    // The browser hand-off is a courtesy for a purely local effect: the user must
    // still confirm the code on Meta's page, and both surfaces expose the URL.
    const opened = openBrowser(instruction.completeUrl);
    const text = formatSignInText(instruction, opened);
    state?.set({
        state: "pending",
        text,
        ...(instruction.code === undefined ? {} : { code: instruction.code }),
        at: Date.now(),
    });
    return {
        ok: true,
        opened,
        url: instruction.completeUrl,
        ...(instruction.code === undefined ? {} : { code: instruction.code }),
        text,
    };
}
/**
 * Wait for one sign-in attempt to settle, bounded by the caller's deadline.
 * @param attempt - the background attempt promise.
 * @param waitMs - upper bound in milliseconds.
 * @returns the settled outcome, or undefined on timeout/failure to settle.
 */
export async function waitForSettlement(attempt, waitMs) {
    const settled = attempt.then((outcome) => outcome, () => ({ status: "failed" }));
    let timer;
    const deadline = new Promise((resolve) => {
        timer = setTimeout(() => resolve(undefined), waitMs);
        timer.unref?.();
    });
    try {
        return await Promise.race([settled, deadline]);
    }
    finally {
        if (timer !== undefined)
            clearTimeout(timer);
    }
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
        ? "A browser tab should have opened."
        : "Open the sign-in page in your browser.";
    const codePart = instruction.code === undefined
        ? "Confirm the sign-in on Meta's page."
        : `Confirm the code ${instruction.code} there.`;
    return `Muse Code sign-in started. ${openPart} ${codePart} The models become available as soon as Meta confirms.`;
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
/**
 * Sync the account's live chat catalog into the declared route.
 *
 * Meta lists the subscription catalog behind the minted key and publishes no
 * static metadata, so the ids are turned into conservative DSH model entries:
 * the five Muse Spark rows keep the shipped catalog's fidelity, every other
 * chat id (Muse Wonder included) takes the family defaults. A route that
 * already declares its own `models` list is left untouched.
 *
 * @param settings - the Settings form service.
 * @param logger - optional plugin logger.
 * @param options - credentials access and fetch override, for tests.
 * @returns whether this call wrote a model list.
 */
export async function syncMuseModels(settings, logger, options = {}) {
    const credentials = await waitForCredentials(options.credentials);
    if (credentials === undefined)
        return false;
    const accessKey = await readSubscriptionKey(credentials);
    if (accessKey === undefined)
        return false;
    const row = settings.describe().find((candidate) => candidate.ns === SETTINGS_NS);
    if (row === undefined)
        return false;
    const providers = row.value["providers"];
    if (!isRecord(providers) || !isRecord(providers[PROVIDER]))
        return false;
    const profile = providers[PROVIDER];
    if (profile["models"] !== undefined)
        return false;
    const ids = await (options.fetchModelIds ?? fetchLiveModelIds)(accessKey);
    if (ids === null || ids.length === 0) {
        logger?.debug?.("dsh-muse-code: live catalog unavailable; keeping the shipped pi-ai catalog");
        return false;
    }
    const models = ids.filter(isChatModelId).map(museModelEntry);
    if (models.length === 0)
        return false;
    await settings.update(SETTINGS_NS, { providers: { [PROVIDER]: { displayName: ROUTE_LABEL, models } } }, row.revision);
    logger?.info?.(`dsh-muse-code: synced ${String(models.length)} Muse models from the account catalog`);
    return true;
}
/** Map one live model id to a conservative DSH pi-ai model entry. */
export function museModelEntry(id) {
    const known = SPARK_MODELS[id];
    const name = known?.name ?? prettifyModelName(id);
    const withMax = known?.max === true;
    const reasoningEfforts = {
        minimal: "minimal",
        low: "low",
        medium: "medium",
        high: "high",
        xhigh: "xhigh",
        ...(withMax ? { max: "max" } : {}),
    };
    return {
        id,
        name,
        contextWindow: MUSE_CONTEXT_WINDOW,
        maxTokens: MUSE_MAX_OUTPUT_TOKENS,
        input: ["text", "image"],
        reasoningEfforts,
    };
}
/** Whether one catalog id is a chat model this route can serve. */
export function isChatModelId(id) {
    return !NON_CHAT_PREFIXES.some((prefix) => id.startsWith(prefix));
}
/** Turn a live model id into a display name ("muse-wonder-full-1.0"). */
export function prettifyModelName(id) {
    if (!id.startsWith("muse-"))
        return id;
    return id
        .split("-")
        .map((part) => (/^\d/.test(part) ? part : part.charAt(0).toUpperCase() + part.slice(1)))
        .join(" ");
}
/**
 * Fetch the account's live chat catalog.
 * @param accessKey - minted subscription key stored in the OAuth record.
 * @param timeoutMs - request bound.
 * @returns the chat model ids, or null on any failure.
 */
export async function fetchLiveModelIds(accessKey, timeoutMs = MODELS_TIMEOUT_MS) {
    try {
        const response = await fetch(MODELS_URL, {
            headers: { Accept: "application/json", Authorization: `Bearer ${accessKey}` },
            signal: AbortSignal.timeout(timeoutMs),
        });
        if (!response.ok)
            return null;
        const body = await response.json();
        if (!isRecord(body) || !Array.isArray(body["data"]))
            return null;
        const ids = [];
        for (const row of body["data"]) {
            if (isRecord(row) && typeof row["id"] === "string" && row["id"].length > 0)
                ids.push(row["id"]);
        }
        return ids;
    }
    catch {
        return null;
    }
}
async function readSubscriptionKey(credentials) {
    try {
        const record = await credentials.readRecord(AUTH_KEY);
        const payload = record?.payload;
        if (!isRecord(payload))
            return undefined;
        const access = payload["access"];
        return typeof access === "string" && access.length > 0 ? access : undefined;
    }
    catch {
        return undefined;
    }
}
async function waitForCredentials(getter, attempts = 8, delayMs = 250) {
    if (getter === undefined)
        return undefined;
    for (let attempt = 0; attempt < attempts; attempt += 1) {
        const face = getter();
        if (face !== undefined)
            return face;
        if (attempt < attempts - 1 && delayMs > 0)
            await sleep(delayMs);
    }
    return undefined;
}
function setCorsHeaders(response) {
    response.setHeader("Access-Control-Allow-Origin", "*");
    response.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
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
 * The page a plain navigation to {@link LOGIN_ROUTE} receives: the code, a link
 * to Meta, and a poll of {@link STATUS_ROUTE} until the sign-in completes.
 * @param outcome - result of the sign-in attempt.
 * @returns a self-contained HTML document.
 */
export function signInPage(outcome) {
    const title = "Muse Code sign-in";
    if (!outcome.ok) {
        return `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title></head>` +
            `<body style="font-family:system-ui,sans-serif;padding:2rem;line-height:1.6;max-width:42rem">` +
            `<h1 style="font-size:1.15rem">${escapeHtml(title)}</h1>` +
            `<p>${escapeHtml(outcome.text)}</p>` +
            `<p><a href="${LOGIN_ROUTE}">Try again</a></p></body></html>`;
    }
    const codeBlock = outcome.code === undefined
        ? ""
        : `<p style="margin:1rem 0;font-size:1.5rem;letter-spacing:0.12em;font-family:ui-monospace,Consolas,monospace"><strong>${escapeHtml(outcome.code)}</strong></p>`;
    return `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title></head>` +
        `<body style="font-family:system-ui,sans-serif;padding:2rem;line-height:1.6;max-width:42rem">` +
        `<h1 style="font-size:1.15rem">${escapeHtml(title)}</h1>` +
        `<p>Confirm this code on Meta's page:</p>${codeBlock}` +
        `<p><a href="${escapeHtml(outcome.url)}" target="_blank" rel="noreferrer">Open the Meta sign-in page</a></p>` +
        `<p id="status" style="color:#6b7280">Waiting for Meta to confirm…</p>` +
        `<script>(function(){var el=document.getElementById('status');var tries=0;` +
        `function poll(){if(tries++>150){el.textContent='Still waiting. You can close this page and retry from Settings > Models.';return}` +
        `fetch('${STATUS_ROUTE}',{headers:{accept:'application/json'}}).then(function(r){return r.json()})` +
        `.then(function(s){if(!s){setTimeout(poll,2000);return}` +
        `if(s.state==='authorized'){document.body.innerHTML='<h1 style="font-size:1.15rem">Muse Code</h1><p>Signed in. Muse Code models are available in DeepSeek Harness.</p>';return}` +
        `if(s.state==='failed'||s.state==='cancelled'){document.body.innerHTML='<h1 style="font-size:1.15rem">Muse Code</h1><p>'+String(s.text||'Sign-in did not complete.').replace(/[<>&]/g,'')+'</p>';return}` +
        `el.textContent='Waiting for Meta to confirm…';setTimeout(poll,2000)})` +
        `.catch(function(){setTimeout(poll,3000)})}poll()})()</script>` +
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
