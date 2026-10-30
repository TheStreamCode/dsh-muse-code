/** Version of the wire rules below; bump with ADAPTER_CONTRACT.md. */
export declare const ADAPTER_VERSION = 3;
/** Default upstream; tests override it with a local fake. */
export declare const DEFAULT_UPSTREAM = "https://api.meta.ai";
/**
 * Muse Code builtin tool names.
 *
 * Reconstructed from the 1.4.14 binary's tool catalog and from `muse exec`
 * captures, then probed one by one against api.meta.ai on 2026-10-30: a flat
 * client tool with one of these exact names is refused with 403
 * `client_attestation_denied`. The catalog includes goal, cron, session and
 * patch tools as well as the file, shell and web families. `tool_search` is
 * included defensively: one probe returned 200, but field reports see a 403.
 */
export declare const COLLIDING_TOOL_NAMES: ReadonlySet<string>;
type JsonRecord = Record<string, unknown>;
/** One alias plan: original name to wire name, plus the reverse map. */
export interface AliasPlan {
    readonly aliases: ReadonlyMap<string, string>;
    readonly reverse: ReadonlyMap<string, string>;
}
/**
 * Decide which declared tool names must be aliased.
 *
 * Only flat `function` tools are considered: those are the declarations Meta
 * compares against its builtin set. A namespace container is left untouched.
 * With `all`, every flat function tool is aliased; the proxy uses that as a
 * one-shot retry when the gate refuses names this release does not know.
 */
export declare function planToolAliases(tools: unknown, options?: {
    all?: boolean;
}): AliasPlan;
/** Result of adapting a request body: the body to send, its plan and a log line. */
export interface AdaptedRequest {
    readonly body: JsonRecord;
    readonly plan: AliasPlan;
    readonly notes: string[];
}
/**
 * Apply the wire rules to one Responses/Chat request body.
 *
 * The input object is not mutated: a shallow copy is returned. Unknown fields
 * are preserved untouched. Pass a plan from {@link planToolAliases} to reuse a
 * mapping, for example the full-aliasing retry.
 */
export declare function transformRequestBody(body: JsonRecord, plan?: AliasPlan): AdaptedRequest;
/**
 * Streaming name restorer.
 *
 * Feeds complete SSE lines and returns the line to relay. It restores aliased
 * function-call names and repairs empty `arguments` from the streamed deltas:
 * Meta's authoritative `response.output_item.done` sometimes ships "" even
 * though the deltas carried the JSON.
 */
export declare class SseRestorer {
    private readonly reverse;
    private readonly arguments;
    constructor(reverse: ReadonlyMap<string, string>);
    /** Adapt one complete SSE line (without the trailing newline). */
    feed(line: string): string;
    private adapt;
    /** Restore names in an emitted response object (tools echo and output items). */
    private adaptResponse;
    private collectArguments;
    private repairArguments;
}
/** Restore aliased names and empty arguments in a complete JSON response. */
export declare function transformResponseBody(body: JsonRecord, reverse: ReadonlyMap<string, string>): JsonRecord;
/** Options for {@link startMuseCodeAdapter}. */
export interface AdapterOptions {
    /** Upstream origin; override for tests only. */
    readonly upstream?: string;
    /** Candidate loopback ports; the first free one wins, then an ephemeral port. */
    readonly ports?: readonly number[];
    /** Diagnostic sink; one short line per adapted request. */
    readonly log?: (message: string) => void;
    /** Disable the wire rules but keep proxying (MUSE_CODE_ADAPTER=off). */
    readonly passthrough?: boolean;
}
/** A running adapter. */
export interface RunningAdapter {
    /** Loopback origin to use as the provider baseURL, e.g. http://127.0.0.1:43219/v1. */
    readonly baseUrl: string;
    /** Actual loopback port. */
    readonly port: number;
    /** Stop accepting and close the server. */
    close(): Promise<void>;
}
/**
 * Start the loopback adapter.
 *
 * The server binds 127.0.0.1 only. Requests to the Responses and Chat
 * completion paths are adapted; every other path is relayed untouched, so
 * the provider's model discovery keeps working through the same baseURL.
 */
export declare function startMuseCodeAdapter(options?: AdapterOptions): Promise<RunningAdapter>;
export {};
