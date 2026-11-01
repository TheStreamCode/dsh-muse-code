# dsh-muse-code

Muse Code subscription integration for DeepSeek Harness

[![CI](https://github.com/TheStreamCode/dsh-muse-code/actions/workflows/ci.yml/badge.svg)](https://github.com/TheStreamCode/dsh-muse-code/actions/workflows/ci.yml)
[![License](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Release](https://img.shields.io/github/v/release/TheStreamCode/dsh-muse-code)](https://github.com/TheStreamCode/dsh-muse-code/releases/latest)

DeepSeek Harness (DSH) ships Meta's Muse Code subscription as the pi-ai `meta`
provider with its device-code sign-in flow. This bundle connects that
provider to the surfaces you work in: it declares the route so the provider
appears under **Settings → Models** and in the model picker, and it adds the
**Muse Code OAuth** settings page and the `/muse-login` command that run the
shipped sign-in. No hand-copied key, no duplicated provider code.

Since 2026-10-29 Meta rejects subscription requests whose client tool
declarations collide with Muse Code's builtin tool names, so the bundle ships
a loopback wire adapter that aliases exactly those names toward `api.meta.ai`
and restores them in the answer. The behavior is pinned in
[ADAPTER_CONTRACT.md](ADAPTER_CONTRACT.md).

> **Unofficial and experimental.** This plugin uses a Muse Code subscription
> credential from DeepSeek Harness. Meta's terms limit that credential to Muse
> Code, so this use may not be supported and Meta may suspend or revoke accounts
> or credentials. Use it at your own risk. Read [DISCLAIMER.md](DISCLAIMER.md)
> before installing.

## Install

From the npm registry:

```bash
dsh plugin --profile desktop add @thestreamcode/dsh-muse-code
```

From the public GitHub repository:

```bash
dsh plugin --profile desktop add github:TheStreamCode/dsh-muse-code
```

From a local checkout:

```bash
dsh plugin --profile desktop add link:C:\path\to\dsh-muse-code
```

No manual profile edit is required. Restart DSH after installing or upgrading.

## Quick start

1. Install the bundle and restart DSH.
2. Open **Settings → Muse Code OAuth** and press **Sign in with Meta**. The
   Host runs DSH's device-code flow, opens the verification page, and shows the
   code.
3. Confirm the code on Meta's page; the page switches to **Signed in** and DSH
   stores the credential.
4. Pick a Muse model in the model picker, for example `muse-spark-1.3`.

If the Settings page cannot reach the Host, run `/muse-login` in a chat instead;
it runs the same flow ([how the sign-in fits together](docs/sign-in.md)). The
page states, actions, and provider-row migration are documented in
[docs/settings-page.md](docs/settings-page.md).

## Features

- Declares the shipped `meta` provider route as `muse-code-oauth` for
  Settings → Models and the model picker.
- Syncs the account's live chat catalog into the route, so new chat models
  appear without a DSH catalog update. A model list you edited is never
  overwritten.
- Adds a **Muse Code OAuth** settings page with live status, device code, and
  Meta page link, plus the `/muse-login` chat command. Both start DSH's
  device-code flow.
- Paints the native credential dot on the provider row and re-mints the key
  before Meta's ~24 h expiry.
- Routes inference through a loopback adapter that aliases colliding tool
  names and normalizes parameters (`MUSE_CODE_ADAPTER=off` keeps the proxy,
  drops the reshaping).
- Leaves credential handling to DSH: the shipped flow stores the sign-in and
  the plugin keeps the route's reference copy fresh.

## Requirements

- DeepSeek Harness `0.2.1-rc.3` or newer, with the pi-ai `meta` provider.
- Node.js 20 or newer on the DSH host; CI runs Node.js 20, 22, and 24.
- A Meta account with an active Muse Code subscription.
- No separate service, CLI, or key file.

## Configuration

| Setting | Purpose | Default |
| --- | --- | --- |
| `muse-code-oauth` provider route | The shipped `meta` route, declared by the bundle; shown under Settings → Models and in the model picker. | declared on first boot |
| **Muse Code OAuth** page | Starts the device-code flow and follows the status until **Signed in**. | available after install |
| `/muse-login` | The same sign-in from a chat or CLI surface. | available after install |
| Live model catalog | Account chat models, written into the route when it has no list. | synced after sign-in |
| `META_API_KEY` | Optional pay-as-you-go key accepted instead of the sign-in. | unset |
| `MUSE_CODE_ADAPTER` | `off` keeps the local proxy but disables the reshaping. | unset |
| Model | Any model the route serves. | `muse-spark-1.3` |

The route reads the mirrored key through `MUSE_CODE_SUB_TOKEN`. Caching behaves
like any other pi-ai route ([measured behavior](docs/prompt-caching.md)).

Installs upgraded from 0.3.x stored **Muse Code (Meta subscription)** as the
route label. 0.4.0 renames that legacy label to `muse-code-oauth` on the next
boot and keeps a display name edited by hand.

## Privacy and security

- The bundle calls `GET /v1/models` on `api.meta.ai` to sync the catalog and
  `/muse-code/key` to refresh the key. DSH owns the sign-in and the credential
  store; verification happens on `https://auth.meta.com`.
- The local sign-in routes and the wire adapter listen on loopback only and
  transmit no credential. The adapter forwards `Authorization` unchanged and
  never reads, stores, or logs credentials or bodies.
- To remove access, remove the bundle and the declared provider, and delete
  the `llm-pi-ai/meta` record while DSH is stopped.

See [SECURITY.md](SECURITY.md) for vulnerability reporting,
[AUTH_CONTRACT.md](AUTH_CONTRACT.md) for the pinned login contract, and
[ADAPTER_CONTRACT.md](ADAPTER_CONTRACT.md) for the inference wire rules.

## Troubleshooting

### The `muse-code-oauth` row is missing from Settings → Models

The bundle was not loaded by the active profile, or the profile lacks the
`llm-pi-ai` adapter. Re-run the install command for the same profile, restart
DSH, and check for `did not activate` warnings. Without the pi-ai Meta
provider, update DSH.

### The sign-in page cannot reach the Host

Some Desktop and non-loopback deployments cannot reach the local Web route, and
the Host opens the browser on a best-effort basis. Open the Meta page from the
shown link, enter the code, and if the Muse Code OAuth page never flips to
**Signed in**, run `/muse-login` in a chat instead; it waits for Meta's
confirmation itself.

### Meta rejects subscription requests from this client

A 403 mentioning `client_attestation_denied` should no longer happen for
colliding tool names while the adapter runs. If it does, the adapter could not
bind a loopback port, `MUSE_CODE_ADAPTER=off` is set, or Meta changed the gate.
Signing in again does not change it; the alternatives are Muse Code itself or
a pay-as-you-go key.

### Requests fail with 401

When Meta ends the stored session, or the mirrored key lapsed while the
plugin was disabled, sign in again to replace the record.

### A catalog model is missing

The live sync only fills a route that has no model list of its own. If you
edited the provider's models, remove that list and restart DSH so the sync can
refill it. Sign in first if the Muse Code OAuth page is not **Signed in**.

More failures: [docs/troubleshooting.md](docs/troubleshooting.md).

## Development

Requirements: Node.js 20 or newer and npm.

```bash
git clone https://github.com/TheStreamCode/dsh-muse-code.git
cd dsh-muse-code
npm install
npm run typecheck
npm test
```

`npm test` builds `lib/` and runs the `node:test` suite; no Meta account is
needed. `lib/` is committed because DSH bundle installs from Git may not run a
build; regenerate it with `npm run build` after any source change. The Client
half is `client/client.js`, a hand-written classic script kept outside the
TypeScript output because DSH concatenates client artifacts into plain script
bundles.

## Support

Usage questions belong to GitHub Discussions; reproducible defects belong to
GitHub Issues using the bug report form. See [SUPPORT.md](SUPPORT.md). The
plugin cannot obtain, restore, or protect a Meta account, subscription, or
credential.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Pull requests must pass the required CI
checks.

## License

MIT — see [`LICENSE`](LICENSE). The software is provided "as is"; see
[DISCLAIMER.md](DISCLAIMER.md) for the risk notice and liability terms.

---

Maintained by [Michael Gasperini (Mikesoft)](https://mikesoft.it).
If it is useful to you, consider
[sponsoring its maintenance](https://github.com/sponsors/TheStreamCode).
