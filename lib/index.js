// DeepSeek Harness bundle: Muse Code subscription route + login flow.
//
// The route is declared by cordis.patch.yml through a second pi-ai adapter
// instance. This plugin owns the human sign-in: it runs Meta's device flow,
// mints the account-bound inference key, stores it under the
// MUSE_CODE_SUB_TOKEN credential reference, and commits the authorization
// record the seam requires.
import { deviceAuthorize, mintKey, pollToken } from "./auth.js";
export const name = "dsh-muse-code";
export const inject = ["credentials", "authorization"];
const FLOW_KEY = "dsh-muse-code/subscription";
const CREDENTIAL_REF = "MUSE_CODE_SUB_TOKEN";
export function apply(ctx) {
    const flow = {
        key: FLOW_KEY,
        label: "Muse Code (subscription)",
        methods: [{ id: "device", label: "Sign in with Meta device code" }],
        async run(session) {
            const device = await deviceAuthorize(session.signal);
            const url = device.verification_uri_complete || device.verification_uri;
            session.notify({ message: `Open ${url} and enter code ${device.user_code}`, url });
            const accessToken = await pollToken(device.device_code, device.interval, device.expires_in, session.signal);
            const minted = await mintKey(accessToken, session.signal);
            await ctx.credentials.set(CREDENTIAL_REF, minted.apiKey);
            await ctx.credentials.modifyRecord(FLOW_KEY, async () => ({
                kind: "grant",
                payload: {
                    accountId: minted.accountId,
                    ...(minted.email ? { email: minted.email } : {}),
                },
            }));
            session.notify({ message: `Signed in as ${minted.email || minted.accountId}` });
        },
    };
    const register = () => ctx.authorization.registerFlow(flow);
    if (ctx.effect)
        ctx.effect(register);
    else
        register();
}
