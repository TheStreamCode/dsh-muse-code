# dsh-muse-code

Muse Code subscription models and device-code sign-in for DeepSeek Harness

[![CI](https://github.com/TheStreamCode/dsh-muse-code/actions/workflows/ci.yml/badge.svg)](https://github.com/TheStreamCode/dsh-muse-code/actions/workflows/ci.yml)
[![License](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Release](https://img.shields.io/github/v/release/TheStreamCode/dsh-muse-code)](https://github.com/TheStreamCode/dsh-muse-code/releases/latest)

DeepSeek Harness (DSH) bundle that serves Meta Muse Code models through a Muse Code
subscription and adds a native device-code login flow. No API key is copied by hand: the
plugin runs Meta's device login, mints the account-bound inference key, and stores it in the
DSH credential store.

> **Unofficial and experimental.** This plugin uses a Muse Code subscription credential from
> DeepSeek Harness. Meta's terms limit that credential to Muse Code, so this use may not be
> supported and Meta may suspend or revoke accounts or credentials. Use it at your own risk;
> the authors cannot recover an account. Read [DISCLAIMER.md](DISCLAIMER.md) before installing.

## Install

This bundle is distributed from GitHub; no npm package is published.

```bash
dsh plugin --profile desktop add github:TheStreamCode/dsh-muse-code
```

From a local checkout:

```bash
dsh plugin --profile desktop add link:C:\path\to\dsh-muse-code
```

The bundle inserts its route and auth plugin through `cordis.patch.yml`; no manual profile
edit is required. Restart DSH if the profile does not pick up the bundle immediately.

## Quick start

1. Install the bundle with the command above.
2. Open **Settings**, select **Authorization** (the credential and sign-in surface), then
   **Muse Code (subscription)**.
3. Open the printed Meta URL, enter the printed code, and approve the login.
4. Select the `muse-code` provider and a Muse model in the DSH model picker, for example
   `muse-code/muse-spark-1.3`.

The plugin commits the minted key as the `MUSE_CODE_SUB_TOKEN` credential, and the route
reads it per request, so the key never appears in a configuration file.

## Features

- Adds a `muse-code` model route through a second `@deepseek-ai/dsh-llm-pi-ai` instance
  (`api: openai-responses`, `baseURL: https://api.meta.ai/v1`), so the existing `llm-pi-ai`
  configuration is not replaced.
- Registers the **Muse Code (subscription)** authorization flow: Meta device login, key
  mint, and credential commit.
- Stores the key in the DSH credential store under `MUSE_CODE_SUB_TOKEN` and reads it through
  `apiKeyEnv`.
- Serves `muse-spark-1.3`, `muse-spark-1.2`, `muse-wonder-1.0`, and `muse-wonder-full-1.0`
  with text and image input, a 1,048,576-token context window, and reasoning-effort mapping
  from `minimal` to `max`.
- Accepts an explicit `MUSE_CODE_SUB_TOKEN` environment variable instead of the stored
  credential.

## Requirements

- DeepSeek Harness `0.2.1-rc.2` or newer.
- Node.js 20 or newer on the DSH host; CI runs Node.js 20, 22, and 24.
- A Meta account with an active Muse Code subscription.
- The plugin needs no separate service and no third-party CLI.

## Configuration

| Setting | Purpose | Default |
| --- | --- | --- |
| `MUSE_CODE_SUB_TOKEN` | Inference key read by the `muse-code` route through `apiKeyEnv`. An explicit value wins over the stored credential. | from the authorization flow |
| `muse-code` provider | Provider entry added by `cordis.patch.yml`; select it in the DSH model picker. | enabled after install |
| Model id | Model served by the route; availability depends on the subscription plan. | `muse-spark-1.3` |
| Reasoning effort | Maps DSH effort levels to Meta's wire vocabulary. | provider default |

## Privacy and security

The subscription key is stored only in the DSH credential store under `MUSE_CODE_SUB_TOKEN`;
it is never written to a configuration file, and the OAuth access token stays in memory. The
plugin talks only to `auth.meta.com` for the device login and `api.meta.ai` for key minting and
inference. Do not share credential caches or exported keys.

To remove access, delete the `MUSE_CODE_SUB_TOKEN` credential from the DSH credential store or
sign out of the authorization record, then remove the bundle:

```bash
dsh plugin --profile desktop remove @thestreamcode/dsh-muse-code
```

See [SECURITY.md](SECURITY.md) for vulnerability reporting and
[AUTH_CONTRACT.md](AUTH_CONTRACT.md) for the pinned login contract.

## Troubleshooting

### The provider does not appear in the model picker

The bundle was not loaded by the active profile. Re-run the install command with the same
profile, restart DSH, and check that `cordis.patch.yml` is part of the installed bundle.

### Muse Code subscription is inactive for this account

The signed-in account has no active Muse Code subscription, or the subscription lapsed.
Renew it, or sign in with the account that holds the subscription.

### The device login expires or is denied

Start the authorization flow again and approve the printed code before the expiry printed by
the flow. The login completes in your own browser on Meta's authorization page.

### Requests fail with 401 after a subscription change

The stored key was revoked or rotated. Remove the `MUSE_CODE_SUB_TOKEN` credential, run the
authorization flow again, and restart DSH if a running process cached the old value.

## Development

Requirements: Node.js 20 or newer and npm.

```bash
git clone https://github.com/TheStreamCode/dsh-muse-code.git
cd dsh-muse-code
npm install
npm run typecheck
npm test
```

`npm test` builds `lib/` and runs the `node:test` suite. `lib/` is committed because DSH
bundle installs from Git may not run a build; regenerate it with `npm run build` after any
source change. The offline tests cover the device flow, the credential wiring, and the plugin
manifest; no Meta account is needed.

## Support

Usage questions and workflows belong in GitHub Discussions; reproducible defects belong in
GitHub Issues using the bug report form. See [SUPPORT.md](SUPPORT.md). The plugin cannot
obtain, restore, or protect a Meta account, subscription, or credential.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Pull requests must pass the required CI checks.

## License

MIT — see [`LICENSE`](LICENSE). The software is provided "as is"; see
[DISCLAIMER.md](DISCLAIMER.md) for the risk notice and liability terms.

---

Maintained by [Michael Gasperini (Mikesoft)](https://mikesoft.it).
If this project is useful to you, consider
[sponsoring its maintenance](https://github.com/sponsors/TheStreamCode).
