import type { IncomingMessage, ServerResponse } from "node:http";
export declare const name = "dsh-muse-code";
export declare const inject: string[];
/** Web route the Settings control calls to start the sign-in. */
export declare const LOGIN_ROUTE = "/muse-code/login";
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
};
type HostContext = {
    authorization: AuthorizationFace;
    commands: CommandFace;
    logger?: Logger;
    effect(callback: () => () => void, label?: string): () => void;
    inject?(dependencies: string[], callback: (child: ChildContext) => void): void;
};
/** Injected side effects, overridable in tests. */
export type SignInOptions = {
    openBrowser?: (url: string) => boolean;
    timeoutMs?: number;
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
    text: string;
    url: string;
    code?: string;
} | {
    ok: false;
    reason: "unavailable" | "busy" | "timeout" | "failed" | "ended";
    text: string;
};
/**
 * Register the sign-in command, the Settings > Models sign-in route, and the
 * settings write that makes the Muse Code provider visible.
 * @param ctx - Host plugin context.
 */
export declare function apply(ctx: HostContext): void;
/** Command definition for the sign-in; exported for tests. */
export declare function museLoginCommand(ctx: HostContext, options?: SignInOptions): Parameters<CommandFace["register"]>[0];
/**
 * Build the exact Web route that starts the same sign-in from the Settings
 * page. The route answers JSON so the Client control can render the code and
 * the failure reason next to its button.
 * @param ctx - Host plugin context.
 * @param options - injected side effects, overridable in tests.
 * @returns an HTTP handler for {@link LOGIN_ROUTE}.
 */
export declare function createLoginRouteHandler(ctx: HostContext, options?: SignInOptions): (request: IncomingMessage, response: ServerResponse) => Promise<void>;
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
export {};
