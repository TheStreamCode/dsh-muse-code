# dsh-muse-code

Muse Code (Meta subscription) integration for DeepSeek Harness

[![CI](https://github.com/TheStreamCode/dsh-muse-code/actions/workflows/ci.yml/badge.svg)](https://github.com/TheStreamCode/dsh-muse-code/actions/workflows/ci.yml)
[![License](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Release](https://img.shields.io/github/v/release/TheStreamCode/dsh-muse-code)](https://github.com/TheStreamCode/dsh-muse-code/releases/latest)

DeepSeek Harness (DSH) already ships Meta's Muse Code subscription as the pi-ai `meta`
provider (`https://api.meta.ai/v1`, OpenAI Responses) together with its device-code sign-in
flow (`llm-pi-ai/meta`). This bundle connects that provider to the surfaces a user works in:
it declares the route so the provider appears under **Settings → Models** and in the model
picker, and it adds the `/muse-login` command that runs the shipped sign-in. No key is copied
by hand and no provider code is duplicated.

A successful login does not guarantee model access: Meta may reject subscription requests from
clients other than Muse Code.

> **Unofficial and experimental.** This plugin uses a Muse Code subscription credential from
> DeepSeek Harness. Meta's terms limit that credential to Muse Code, so this use may not be
> supported and Meta may suspend or revoke accounts or credentials. Use it at your own risk;
> the authors cannot recover an account. Read [DISCLAIMER.md](DISCLAIMER.md) before installing.

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

The bundle inserts one integration row through `cordis.patch.yml`; no manual profile edit is
required. On the first boot it declares the `meta` provider route in the `llm-pi-ai` settings
section — the same write the Models page performs when a provider is added by hand — and adds the
Sign in control and the `/muse-login` command. Restart DSH after installing or upgrading the
bundle.

## Quick start

1. Install the bundle and restart DSH.
2. Open **Settings → Models**: the **Muse Code (Meta subscription)** card shows the subscription
   status and the models the account catalog serves — Muse Spark 1.1/1.2/1.3 (+ `-contributor`)
   and the Muse Wonder family, plus any future chat model the account lists.
3. Press **Sign in** on that card. The Host starts DSH's Meta device-code flow, opens the
   verification page in your default browser, and shows the code. The card follows the attempt
   and switches to **Signed in** when Meta confirms. Without the page (CLI, or a page that cannot
   reach the Host), run `/muse-login` in a chat instead.
4. Confirm the code on Meta's page and approve. DSH stores the credential and keeps it fresh;
   `/muse-login` answers with the final state ("Muse Code is signed in") once Meta confirms.
5. Pick a Muse model in the model picker, for example `Muse Spark 1.3`. Meta's subscription
   restrictions still apply to requests from DSH.

The credential lives in the DSH credential store as the `llm-pi-ai/meta` record. It is never
written to `cordis.patch.yml`, which carries only the route's display name and its model list.

## Where the sign-in lives

DSH 0.2.1 exposes no generic Remote method for starting a provider OAuth flow, so the Settings
page cannot call the authorization seam directly. The bundle therefore registers exact local Web
routes on the Host's own HTTP server:

- `POST /muse-code/login` starts the sign-in and answers with the code and the Meta URL;
- `GET /muse-code/status` reports `pending`, `authorized`, `failed`, or `idle`, which is what lets
  the card flip to **Signed in** without a reload.

The `/muse-login` command runs the same flow and waits for Meta's confirmation before answering,
so the chat shows the final state instead of leaving the prompt waiting. A page whose origin
cannot reach the Host falls back to that command.

## Features

- Declares the shipped `meta` provider route in the `llm-pi-ai` settings section, labeled
  **Muse Code (Meta subscription)**, so Settings → Models and the model picker show it. An
  existing `meta` profile without a model list is left untouched apart from that list.
- Syncs the account's live chat catalog (`GET https://api.meta.ai/v1/models`, authenticated with
  the stored subscription key) into the route, so the Muse Wonder family and future chat models
  are selectable without waiting for a DSH catalog update. Non-chat families (`muse-image-*`,
  `muse-voice-*`, `sam-*`) are filtered out; the five Muse Spark rows keep the shipped catalog's
  names, context window, output cap, and reasoning levels. A model list you edited yourself is
  never overwritten.
- Adds a **Sign in** card under Settings → Models with the live status, the device code, and a
  direct Meta page link, backed by the routes above, plus the `/muse-login` chat command. Both
  start DSH's own device-code flow (`llm-pi-ai/meta`) and open the verification page in the
  default browser.
- Paints the native credential dot on the **Muse Code (Meta subscription)** row: the route names
  `apiKeyEnv: MUSE_CODE_SUB_TOKEN`, and the plugin mirrors the OAuth record's minted key into that
  reference (red without a credential, green with one) and re-mints it before Meta's ~24 h expiry.
- Leaves credential handling to DSH: the shipped flow stores the sign-in as an OAuth credential
  record and the plugin keeps the route's credential-reference copy fresh when the key rotates.

## Requirements

- DeepSeek Harness `0.2.1-rc.3` (verified) or newer, with the pi-ai `meta` provider. A DSH build
  without it cannot serve the subscription.
- Node.js 20 or newer on the DSH host; CI runs Node.js 20, 22, and 24.
- A Meta account with an active Muse Code subscription.
- No separate service, CLI, or key file.

## Configuration

| Setting | Purpose | Default |
| --- | --- | --- |
| `meta` provider route | Declared by the bundle in the `llm-pi-ai` settings section; shown under Settings → Models and in the model picker. | declared on first boot |
| **Sign in** card | Starts the shipped Meta device-code flow, opens the browser, shows the code, and follows the live status until **Signed in**. Backed by `POST /muse-code/login` and `GET /muse-code/status` on the local Host. | available after install |
| `/muse-login` | The same sign-in from a chat or CLI surface; waits for Meta's confirmation and reports the final state. | available after install |
| Live model catalog | Chat models the account serves (`GET /v1/models`), written into the declared route when it has no model list of its own. | synced after sign-in |
| `META_API_KEY` | Optional Meta Model API key that DSH's Meta provider accepts instead of the subscription sign-in. | unset |
| Model | Any model the route serves; availability depends on the subscription plan. | `muse-spark-1.3` |

The route uses `MUSE_CODE_SUB_TOKEN` as a credential reference for the key mirrored from the
sign-in record.

## Privacy and security

- The bundle calls `GET https://api.meta.ai/v1/models` to sync the account's chat catalog and
  `https://api.meta.ai/muse-code/key` to refresh the inference key. DSH owns the sign-in and
  credential store; the verification page is opened on `https://auth.meta.com`.
- The local `POST /muse-code/login`, `GET /muse-code/login`, and `GET /muse-code/status` routes
  only start the flow and report its state; they transmit no credential and are reachable only
  on the Host's own loopback listener.
- The stored credential is the `llm-pi-ai/meta` record in the DSH credential store; the
  `MUSE_CODE_SUB_TOKEN` reference the row reads is a copy of its minted key and is refreshed by
  the plugin. Neither ever appears in configuration or logs.
- To remove access, remove the bundle, remove the declared provider from **Settings → Models**
  (or from the profile's `cordis.patch.yml`), and delete the `llm-pi-ai/meta` record while DSH
  is stopped (the file is `$DSH_HOME/.credentials.yaml`), or run the sign-in again to replace
  it. Removing the bundle alone stops the route but leaves the record and the declaration in
  place.

See [SECURITY.md](SECURITY.md) for vulnerability reporting and
[AUTH_CONTRACT.md](AUTH_CONTRACT.md) for the pinned login contract that DSH implements.

## Prompt caching

The Meta Model API caches the request prefix per `prompt_cache_key`, and a request without that
key gets no reuse at all. DSH's pi-ai adapter sends the session id as the key for every call, so
turns in the same session reuse the prefix Meta already saw. Measured against the live API with
an identical 1.6k-token prefix: same key → 1521 of 1600 tokens cached on the second call;
different key or no key → 0. After a 12-minute pause the same-key entries still reported 2673 of
2800 cached tokens, with or without `prompt_cache_retention`, and a fresh key still reported 0 —
so the default retention is enough for normal turn pacing and there is no retention knob to tune.

The ratio you see in the usage panel therefore depends on how the session is used:

- the cache is per key and per model — switching model or route starts a fresh prefix;
- a short session, or turns spaced far apart, shows a low ratio, because the first call of every
  cache window pays full price;
- editing the system prompt or compacting the history invalidates the prefix once.

The plugin does not change the request shape, so this behaves like any other pi-ai route in the
same harness (for example `opencode-go`). DeepSeek's first-party routes report their own cache
counters and are not directly comparable.

## Troubleshooting

### Nothing named Muse Code appears under Settings → Models

The bundle was not loaded by the active profile, or the profile lacks the `llm-pi-ai` adapter.
Re-run the install command for the same profile, restart DSH, and check the startup output for
`did not activate` warnings. A DSH build without the pi-ai Meta provider cannot serve the
subscription; update DSH.

### `/muse-login` is not offered in the composer

The command needs the DSH command and authorization services, which UI-less compositions do not
mount, or the bundle is inactive. Restart DSH after installing; in a headless profile the
command surface does not exist by design.

### The sign-in reports that no Meta sign-in flow is registered

This DSH build does not ship the Meta provider. Update to DeepSeek Harness `0.2.1-rc.3` or newer,
restart, and retry.

### The Sign in control reports that it cannot reach the Host

The Settings page's origin cannot reach the local Web route — some Desktop and non-loopback
deployments carry HTTP through a bridge. Use `/muse-login` in a chat instead; it starts the same
flow.

### The browser did not open

The Host opens it best-effort through the platform's URI handler. The card and the command show
the code and the sign-in page link, so open the page manually and enter the code.

### The Muse Code card stays on "Waiting for Meta…"

Meta has not confirmed the code yet, or the page could not reach the Host's status route. Approve
the code on Meta's page; if the card never changes, use `/muse-login` in a chat, which waits for
the confirmation itself.

### Muse Wonder (or another catalog model) is missing

The live catalog sync only fills a route that has no model list of its own. If you edited the
provider's models under **Settings → Models → Edit**, remove that list (or reset it) and restart
DSH so the sync can refill it from the account catalog. The sync also needs the stored credential:
sign in again first if the card is not **Signed in**.

### Meta denies the login, or the subscription is inactive

The account has no active Muse Code subscription, the code expired, or the approval was
declined. Start the sign-in again (Sign in control or `/muse-login`) and approve the new code
before it expires.

### Requests fail with 401 after a while

DSH re-mints the inference key from the stored session. When Meta ends that session, run the
sign-in again (Sign in control or `/muse-login`) to sign in and replace the record.

### Meta rejects subscription requests from this client

Meta may return a 403 mentioning `client_attestation_denied` or that Muse Code subscriptions cover
the Muse Code client only. This is a client restriction, not evidence of an expired key. Signing in
again does not remove the restriction. Use Muse Code for the subscription, or a separate
pay-as-you-go Meta Model API key for other clients, subject to Meta's terms. Older DSH versions may
display this refusal as `API key is invalid`.

### The credential dot stays red after signing in

The route's credential reference is a copy of the record's minted key; the plugin mirrors it on
boot and on every record update. If the dot stays red while the card says **Signed in**, restart
DSH and check that the `llm-pi-ai/meta` record still exists in the credential store.

### Requests fail after about a day without the plugin running

The route authenticates through the mirrored reference, and the plugin re-mints the key before
its ~24 h expiry. If DSH ran with the plugin disabled long enough for the key to lapse, sign in
again (Sign in card or `/muse-login`).

### Edit and Delete on the Muse Code row

Both are DSH's generic provider-row actions and a plugin cannot hide them.

- **Edit** writes the route profile into your profile patch: display name, models, and the
  `apiKeyEnv` reference. The plugin restores the reference on the next boot and refills an
  emptied model list from the account catalog.
- **Delete** removes the user-layer route and the plugin treats that removal as a sign-out: it
  deletes the `llm-pi-ai/meta` OAuth record and clears the mirrored `MUSE_CODE_SUB_TOKEN`
  reference. The provider leaves Settings → Models and the picker, and a hand-edited model list
  is lost; the plugin re-declares the row on its next refresh (and on restart) with a red dot, so
  sign in again to keep using Muse Code.
- To remove Muse Code for good, uninstall the bundle and delete the credential record; the
  supported off switch is the plugin itself:

```bash
dsh plugin --profile desktop remove @thestreamcode/dsh-muse-code
```

### Upgrading from 0.1.x

0.1.x inserted a second `@deepseek-ai/dsh-llm-pi-ai` instance, which DSH refuses to activate
(each instance declares the whole provider catalog), so its route never appeared and its
device-code flow had no surface. Reinstall the bundle and restart DSH: the new version declares
the shipped `meta` route instead. The old `dsh-muse-code/subscription` record is no longer used.
The route still uses `MUSE_CODE_SUB_TOKEN`, which the plugin mirrors from the current sign-in.

## Development

Requirements: Node.js 20 or newer and npm.

```bash
git clone https://github.com/TheStreamCode/dsh-muse-code.git
cd dsh-muse-code
npm install
npm run typecheck
npm test
```

`npm test` builds `lib/` and runs the `node:test` suite. `lib/` is committed because DSH bundle
installs from Git may not run a build; regenerate it with `npm run build` after any source
change. The Client half is `client/client.js`, a hand-written browser classic script kept outside
the TypeScript output on purpose: DSH concatenates client artifacts into plain script bundles, so
an `export`/`import` statement there breaks the Web boot. The suite parses that file with classic
script grammar and registers its Models footer contribution. The offline tests cover the sign-in
command, the route declaration, the Client half, and the plugin manifest; no Meta account is
needed.

## Support

Usage questions and workflows belong to GitHub Discussions; reproducible defects belong to
GitHub Issues using the bug report form. See [SUPPORT.md](SUPPORT.md). The plugin cannot obtain,
restore, or protect a Meta account, subscription, or credential.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Pull requests must pass the required CI checks.

## License

MIT — see [`LICENSE`](LICENSE). The software is provided "as is"; see
[DISCLAIMER.md](DISCLAIMER.md) for the risk notice and liability terms.

---

Maintained by [Michael Gasperini (Mikesoft)](https://mikesoft.it).
If this project is useful to you, consider
[sponsoring its maintenance](https://github.com/sponsors/TheStreamCode).
