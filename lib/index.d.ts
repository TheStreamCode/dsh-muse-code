import type { IncomingMessage, ServerResponse } from "node:http";
export declare const name = "dsh-muse-code";
export declare const inject: string[];
/** Web route the Settings control calls to start the sign-in. */
export declare const LOGIN_ROUTE = "/muse-code/login";
/** Web route that reports whether the sign-in completed. */
export declare const STATUS_ROUTE = "/muse-code/status";
type Logger = {
    info?(message: string): void;
    warn?(message: string, ...rest: unknown[]): void;
    debug?(message: string): void;
};
type CommandResult = {
    kind: "success";
    text?: string;
} | {
    kind: "error";
    text: string;
};
type AuthorizationMethods = Array<{
    id: string;
    label: string;
}>;
type AuthorizationEntry = {
    key: string;
    label: string;
    methods: AuthorizationMethods;
    inFlight: boolean;
};
/**
 * One notice from the authorization seam. The seam's vocabulary is
 * `{ message, url?, code? }`; the raw pi-ai fields are accepted too so the
 * reader also covers a direct adapter notice.
 */
type AuthorizationNotice = {
    type?: string;
    message?: string;
    instructions?: string;
    url?: string;
    code?: string;
    userCode?: string;
    verificationUri?: string;
    expiresInSeconds?: number;
};
type AuthorizationInteraction = {
    notify(notice: AuthorizationNotice): void;
    prompt(prompt: unknown): Promise<unknown>;
};
type AuthorizationFace = {
    describe(key: string): AuthorizationEntry | undefined;
    begin(request: {
        key: string;
        method?: string;
        interaction: AuthorizationInteraction;
    }): Promise<{
        status: string;
    }>;
    cancel?(key: string): void;
};
type CommandFace = {
    register(definition: {
        name: string;
        description: string;
        handler(context: {
            rawInput?: string;
        }): Promise<CommandResult>;
    }): () => void;
};
type SettingsRow = {
    ns: string;
    revision: number;
    value: Record<string, unknown>;
};
type SettingsFace = {
    describe(): SettingsRow[];
    update(ns: string, patch: Record<string, unknown>, expectedRevision: number): Promise<void>;
};
type CredentialRecord = {
    kind?: string;
    payload?: Record<string, unknown>;
};
type CredentialsFace = {
    readRecord(key: string): Promise<CredentialRecord | undefined>;
    describeRecord(key: string): Promise<{
        configured: boolean;
    }>;
};
type WebRoute = {
    kind: "exact" | "prefix";
    path: string;
    handler(request: IncomingMessage, response: ServerResponse): Promise<void>;
};
type WebServerFace = {
    register(route: WebRoute): () => void;
};
type ChildContext = HostContext & {
    settings?: SettingsFace;
    webServer?: WebServerFace;
    credentials?: CredentialsFace;
};
type HostContext = {
    authorization: AuthorizationFace;
    commands: CommandFace;
    logger?: Logger;
    effect(callback: () => () => void, label?: string): () => void;
    inject?(dependencies: string[], callback: (child: ChildContext) => void): void;
    on?(event: string, listener: (...args: never[]) => void): () => void;
};
/** One sign-in lifecycle fact the surfaces can read. */
export type SignInSnapshot = {
    state: "idle" | "pending" | "authorized" | "failed" | "cancelled";
    text?: string;
    code?: string;
    at: number;
};
/** Mutable snapshot shared by the command and the two Web routes. */
export type SignInState = {
    get(): SignInSnapshot;
    set(snapshot: SignInSnapshot): void;
};
/** Create one empty sign-in state. */
export declare function createSignInState(): SignInState;
/** Injected side effects, overridable in tests. */
export type SignInOptions = {
    openBrowser?: (url: string) => boolean;
    timeoutMs?: number;
    /** How long the command waits for Meta's confirmation after opening the page. */
    waitForResultMs?: number;
    state?: SignInState;
    credentials?: () => CredentialsFace | undefined;
    /** Capture the background attempt so the command can wait for its result. */
    onAttempt?: (attempt: Promise<{
        status: string;
    }>) => void;
    /** Override the live catalog fetch, for tests. */
    fetchModelIds?: (accessKey: string) => Promise<string[] | null>;
};
/** Actionable instructions extracted from one authorization notice. */
export type SignInInstruction = {
    /** Verification page as the flow reported it. */
    url: string;
    /** Verification page with the user code attached when the URL accepts it. */
    completeUrl: string;
    code?: string;
    message?: string;
};
type SignInOutcome = {
    ok: true;
    opened: boolean;
    text: string;
    url: string;
    code?: string;
} | {
    ok: false;
    reason: "unavailable" | "busy" | "timeout" | "failed" | "ended";
    text: string;
};
/**
 * Register the sign-in command, the Settings > Models routes, the live catalog
 * sync, and the settings write that makes the Muse Code provider visible.
 * @param ctx - Host plugin context.
 */
export declare function apply(ctx: HostContext): void;
/** Command definition for the sign-in; exported for tests. */
export declare function museLoginCommand(ctx: HostContext, options?: SignInOptions): Parameters<CommandFace["register"]>[0];
/**
 * Build the exact Web route that starts the same sign-in from the Settings
 * page. POST answers JSON for the Settings control; GET answers a small page
 * that shows the code and polls the status route until Meta confirms.
 * @param ctx - Host plugin context.
 * @param options - injected side effects, overridable in tests.
 * @returns an HTTP handler for {@link LOGIN_ROUTE}.
 */
export declare function createLoginRouteHandler(ctx: HostContext, options?: SignInOptions): (request: IncomingMessage, response: ServerResponse) => Promise<void>;
/**
 * Build the exact Web route that reports the sign-in state, so the Settings
 * control can flip to "Signed in" after Meta confirms.
 * @param ctx - Host plugin context.
 * @param options - injected side effects, overridable in tests.
 * @returns an HTTP handler for {@link STATUS_ROUTE}.
 */
export declare function createStatusRouteHandler(ctx: HostContext, options?: SignInOptions): (request: IncomingMessage, response: ServerResponse) => Promise<void>;
/**
 * Start one sign-in attempt and wait for the actionable device-code notice.
 * The attempt itself keeps running after the notice, so Meta's approval is
 * picked up and the credential is stored by the seam.
 * @param ctx - Host plugin context.
 * @param options - injected side effects, overridable in tests.
 * @returns the user-facing outcome.
 */
export declare function startSignIn(ctx: HostContext, options?: SignInOptions): Promise<SignInOutcome>;
/**
 * Wait for one sign-in attempt to settle, bounded by the caller's deadline.
 * @param attempt - the background attempt promise.
 * @param waitMs - upper bound in milliseconds.
 * @returns the settled outcome, or undefined on timeout/failure to settle.
 */
export declare function waitForSettlement(attempt: Promise<{
    status: string;
}>, waitMs: number): Promise<{
    status: string;
} | undefined>;
/**
 * Read the actionable instruction out of one authorization notice.
 * @param notice - a seam notice (`message`/`url`/`code`) or a raw adapter one.
 * @returns the instruction, or undefined for progress notices with no page.
 */
export declare function readSignInNotice(notice: AuthorizationNotice): SignInInstruction | undefined;
/**
 * Render the instruction text shared by the command result and the Settings
 * control.
 * @param instruction - actionable notice.
 * @param opened - whether the browser hand-off was started.
 * @returns one line the user can act on.
 */
export declare function formatSignInText(instruction: SignInInstruction, opened: boolean): string;
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
export declare function ensureMuseRoute(settings: SettingsFace, logger?: Logger, options?: {
    attempts?: number;
    delayMs?: number;
}): Promise<boolean>;
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
export declare function syncMuseModels(settings: SettingsFace, logger?: Logger, options?: Pick<SignInOptions, "credentials" | "fetchModelIds">): Promise<boolean>;
/** Map one live model id to a conservative DSH pi-ai model entry. */
export declare function museModelEntry(id: string): Record<string, unknown>;
/** Whether one catalog id is a chat model this route can serve. */
export declare function isChatModelId(id: string): boolean;
/** Turn a live model id into a display name ("muse-wonder-full-1.0"). */
export declare function prettifyModelName(id: string): string;
/**
 * Fetch the account's live chat catalog.
 * @param accessKey - minted subscription key stored in the OAuth record.
 * @param timeoutMs - request bound.
 * @returns the chat model ids, or null on any failure.
 */
export declare function fetchLiveModelIds(accessKey: string, timeoutMs?: number): Promise<string[] | null>;
/**
 * The page a plain navigation to {@link LOGIN_ROUTE} receives: the code, a link
 * to Meta, and a poll of {@link STATUS_ROUTE} until the sign-in completes.
 * @param outcome - result of the sign-in attempt.
 * @returns a self-contained HTML document.
 */
export declare function signInPage(outcome: SignInOutcome): string;
export {};
