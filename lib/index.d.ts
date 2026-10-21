type CredentialStore = {
    set(reference: string, value: string): Promise<void>;
    modifyRecord(key: string, update: () => Promise<unknown>): Promise<unknown>;
};
type AuthorizationSession = {
    signal?: AbortSignal;
    notify(input: {
        message: string;
        url?: string;
    }): void;
};
type AuthorizationFlow = {
    key: string;
    label: string;
    methods: Array<{
        id: string;
        label: string;
    }>;
    run(session: AuthorizationSession): Promise<void>;
};
type HostContext = {
    credentials: CredentialStore;
    authorization: {
        registerFlow(flow: AuthorizationFlow): () => void;
    };
    effect?(callback: () => (() => void) | void): () => void;
};
export declare const name = "dsh-muse-code";
export declare const inject: string[];
export declare function apply(ctx: HostContext): void;
export {};
