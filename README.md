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
2. Open **Settings → Models** and find **Muse Code (Meta subscription)**. Its models are the
   ones DSH's Meta catalog advertises: Muse Spark 1.1, 1.2, and 1.3, plus their `-contributor`
   variants.
3. Press **Sign in** in the Muse Code area of that page. The Host starts DSH's Meta device-code
   flow, opens the verification page in your default browser, and shows the code to confirm.
   Without the page (CLI or a page that cannot reach the Host), run `/muse-login` in any chat and
   follow the printed URL and code instead.
4. Confirm the code on Meta's page and approve the login. DSH stores the credential and keeps it
   fresh; the Muse Code models are selectable as soon as Meta confirms.
5. Pick a Muse model in the model picker, for example `Muse Spark 1.3`.

The credential lives in the DSH credential store as the `llm-pi-ai/meta` record. It is never
written to `cordis.patch.yml`, which carries only the route's display name.

## Where the sign-in lives

DSH 0.2.1 exposes no generic Remote method for starting a provider OAuth flow, so the Settings
page cannot call the authorization seam directly. The bundle therefore registers an exact local
Web route (`POST /muse-code/login`) on the Host's own HTTP server; the **Sign in** control under
Settings → Models calls it, and the Host both opens the verification page and answers with the
code and the instructions. The same flow is available as the `/muse-login` command for the
composer, CLI surfaces, or a page whose origin cannot reach the Host.

## Features

- Declares the shipped `meta` provider route in the `llm-pi-ai` settings section, labeled
  **Muse Code (Meta subscription)**, so Settings → Models and the model picker show it. An
  existing `meta` profile is left untouched.
- Adds a **Sign in** control under Settings → Models, backed by the local
  `POST /muse-code/login` route, and the `/muse-login` chat command. Both start DSH's own
  device-code flow (`llm-pi-ai/meta`), open the verification page in the default browser, and
  return the code so the surface can show it.
- Leaves credential handling to DSH: the shipped flow stores the sign-in as an OAuth credential
  record and re-mints Meta's short-lived inference key automatically, so the route keeps
  working after the key rotates.
- Serves the models DSH advertises for the Meta provider, with text and image input, a
  1,048,576-token context window, and the reasoning levels each model supports.

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
| **Sign in** control | Starts the shipped Meta device-code flow from Settings → Models, opens the browser, and shows the code. Backed by `POST /muse-code/login` on the local Host. | available after install |
| `/muse-login` | The same sign-in from a chat or CLI surface, printing the URL and code. | available after install |
| `META_API_KEY` | Optional Meta Model API key that DSH's Meta provider accepts instead of the subscription sign-in. | unset |
| Model | Any model the Meta provider advertises; availability depends on the subscription plan. | `muse-spark-1.3` |

The `MUSE_CODE_SUB_TOKEN` reference from the 0.1.x releases is no longer used by this bundle;
see the upgrade note under Troubleshooting.

## Privacy and security

- The bundle itself calls no endpoint and stores no secret. The sign-in, the credential record,
  and the inference requests belong to DSH: requests go to `https://api.meta.ai/v1`, and the
  verification page is opened on `https://auth.meta.com`.
- The local `POST /muse-code/login` route only starts that flow and answers with the verification
  URL and the one-time code; it transmits no credential and is reachable only on the Host's own
  loopback listener.
- The stored credential is the `llm-pi-ai/meta` record in the DSH credential store. It never
  appears in configuration or logs.
- To remove access, remove the bundle, remove the declared provider from **Settings → Models**
  (or from the profile's `cordis.patch.yml`), and delete the `llm-pi-ai/meta` record while DSH
  is stopped (the file is `$DSH_HOME/.credentials.yaml`), or run the sign-in again to replace
  it. Removing the bundle alone stops the route but leaves the record and the declaration in
  place.

See [SECURITY.md](SECURITY.md) for vulnerability reporting and
[AUTH_CONTRACT.md](AUTH_CONTRACT.md) for the pinned login contract that DSH implements.

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

The Host opens it best-effort through the platform's URI handler. Both the control and the
command print the verification URL and the code, so open the URL manually and enter the code.

### Meta denies the login, or the subscription is inactive

The account has no active Muse Code subscription, the code expired, or the approval was
declined. Start the sign-in again (Sign in control or `/muse-login`) and approve the new code
before it expires.

### Requests fail with 401 after a while

DSH re-mints the inference key from the stored session. When Meta ends that session, run the
sign-in again (Sign in control or `/muse-login`) to sign in and replace the record.

### Upgrading from 0.1.x

0.1.x inserted a second `@deepseek-ai/dsh-llm-pi-ai` instance, which DSH refuses to activate
(each instance declares the whole provider catalog), so its route never appeared and its
device-code flow had no surface. Reinstall the bundle and restart DSH: the new version declares
the shipped `meta` route instead. The stale `MUSE_CODE_SUB_TOKEN` credential and its
`dsh-muse-code/subscription` record can be deleted from the DSH credential store; nothing reads
them any more.

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
