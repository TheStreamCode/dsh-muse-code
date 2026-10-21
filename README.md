# dsh-muse-code

Unofficial DeepSeek Harness bundle that serves Meta **Muse Code** models through
a Muse Code subscription and adds a native device-code login flow.

> **Unofficial and experimental.** This plugin uses a Muse Code subscription
> credential from DeepSeek Harness. Meta's terms limit that credential to Muse
> Code, so this use may not be supported and Meta may suspend or revoke accounts
> or credentials. Use it at your own risk; the authors cannot recover an account.
> Read [DISCLAIMER.md](DISCLAIMER.md) before installing.

## What it does

- Adds a `muse-code` model route to DSH through a second
  `@deepseek-ai/dsh-llm-pi-ai` instance, with `api: openai-responses` and
  `baseURL: https://api.meta.ai/v1`.
- Registers an authorization flow, **Muse Code (subscription)**, that runs
  Meta's device login and mints the account-bound inference key.
- Stores that key in the DSH credential store under the
  `MUSE_CODE_SUB_TOKEN` reference; the route reads it per request through
  `apiKeyEnv`, so the key never appears in a configuration file.
- Models: `muse-spark-1.3`, `muse-spark-1.2`, `muse-wonder-1.0`,
  `muse-wonder-full-1.0`. Availability depends on the subscription plan.

## Requirements

- DeepSeek Harness `0.2.1-rc.2` or newer.
- A Meta account with an active Muse Code subscription.
- Node.js 20 or newer on the DSH host.

## Install

With the DSH plugin manager:

```bash
dsh plugin --profile desktop add @thestreamcode/dsh-muse-code
```

From the public repository:

```bash
dsh plugin --profile desktop add github:TheStreamCode/dsh-muse-code
```

The bundle inserts its route and auth plugin through `cordis.patch.yml`; no
manual profile edit is required. Restart DSH if the profile does not pick up
the bundle immediately.

## Sign in

1. Open **Settings → Authorization** (the credential/sign-in surface).
2. Select **Muse Code (subscription)**.
3. Open the printed Meta URL, enter the printed code, and approve the login.
4. The plugin stores the inference key and commits the credential record.

Alternatively, set `MUSE_CODE_SUB_TOKEN` in the DSH environment to an
already-minted key; the stored credential, when present, takes precedence.

## Select the model

Choose the `muse-code` provider in the DSH model picker and one of the exposed
model ids, for example `muse-code/muse-spark-1.3`. Reasoning effort is
available through the route's `reasoningEfforts` mapping.

## Remove access

Delete the `MUSE_CODE_SUB_TOKEN` credential from the DSH credential store, or
sign out of the authorization record, then remove the bundle:

```bash
dsh plugin --profile desktop remove @thestreamcode/dsh-muse-code
```

## Development

```bash
npm install
npm run typecheck
npm test          # builds lib/ and runs the node:test suite
```

`lib/` is committed because DSH bundle installs from Git may not run a build.
Regenerate it with `npm run build` after any source change.

## Compliance

Meta Model API Terms of Service §3.2 restrict the subscription credential to
Muse Code. This bundle is an unofficial integration; see
[DISCLAIMER.md](DISCLAIMER.md) and [AUTH_CONTRACT.md](AUTH_CONTRACT.md).

## License

MIT — see [LICENSE](LICENSE).
