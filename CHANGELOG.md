# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.2.4] - 2026-10-30

### Fixed

- Meta's client restriction is reported as a policy refusal instead of `API key is invalid`;
  signing in again does not remove it.

### Changed

- The sign-in requires the browser OAuth method and never falls back to an API-key prompt.
- The sign-in card, command, and page copy state that model access depends on Meta's subscription
  policy.

## [0.2.3] - 2026-10-26

### Added

- Measured the Meta prompt-cache window: same-key entries still hit after 12 minutes (2673 of
  2800 tokens), a fresh key reports 0, and `prompt_cache_retention: 24h` made no difference in
  that window — so there is no retention knob worth exposing.

### Changed

- **Delete on the Muse Code row now signs out.** The Models page's Delete only unsets the
  user-layer route; the plugin treats that removal as a sign-out and deletes the
  `llm-pi-ai/meta` OAuth record together with the mirrored `MUSE_CODE_SUB_TOKEN` reference,
  instead of leaving a green dot behind for a row that no longer exists. The row is re-declared
  (red dot) on the next refresh or restart.

## [0.2.2] - 2026-10-26

### Added

- Native credential dot on the **Muse Code (Meta subscription)** row: the route names
  `apiKeyEnv: MUSE_CODE_SUB_TOKEN`; the plugin mirrors the OAuth record's minted key into that
  reference (red without a credential, green with one) and re-mints it before Meta's ~24 h
  expiry, because an explicit reference is DSH's highest-priority auth override.
- Documented the Meta prompt-cache behavior (`prompt_cache_key` = DSH session id) and the
  meaning/consequences of the generic **Edit** and **Delete** row actions.

### Fixed

- The live catalog sync no longer mistakes the empty `models` array that the Settings form
  projects for a user-owned catalog, so Muse Wonder keeps being filled into the route.

## [0.2.1] - 2026-10-26

### Added

- Live model catalog sync: the plugin reads the account's chat catalog
  (`GET https://api.meta.ai/v1/models`) with the stored subscription key and declares it on the
  route, so Muse Wonder and future chat models appear in the picker. Non-chat families
  (`muse-image-*`, `muse-voice-*`, `sam-*`) are filtered; the Muse Spark rows keep the shipped
  catalog fidelity; a model list edited by the user is never overwritten.
- Live sign-in status: an exact `GET /muse-code/status` route reports `pending`, `authorized`,
  `failed`, or `idle`.
- The Settings > Models card was rebuilt as a proper panel: title, coloured status dot
  (**Signed in**, **Waiting for Meta…**, **Sign-in failed**), the device code as a monospace
  badge, and separate primary/secondary actions. The card polls the status route and flips to
  **Signed in** without a reload.

### Fixed

- `/muse-login` no longer leaves the chat on "sign-in started": after opening the browser it waits
  for Meta's confirmation (bounded) and answers with the final state or the failure reason.

## [0.2.0] - 2026-10-26

### Changed

- Integrate Muse Code through the `meta` provider that DeepSeek Harness ships, instead of
  inserting a second `@deepseek-ai/dsh-llm-pi-ai` instance. DSH declares every provider catalog
  per instance, so the second instance could not activate
  (`configurable provider "amazon-bedrock" is already declared`) and the `muse-code` route never
  existed.

### Added

- `/muse-login` command that runs the shipped `llm-pi-ai/meta` device-code flow and prints the
  verification URL and user code.
- **Sign in** control under **Settings → Models**, backed by an exact local
  `POST /muse-code/login` route: DSH exposes no Remote method for provider OAuth flows, so the
  Host starts the flow and answers the page with the code and instructions.
- The Host opens the verification page in the default browser for both entry points.
- Automatic declaration of the `meta` route in the `llm-pi-ai` settings section, so the provider
  appears under **Settings → Models** and in the model picker labeled
  **Muse Code (Meta subscription)**.
- Client half that adds the sign-in control and its footer hint under **Settings → Models**.

### Removed

- The hand-written `muse-code` route, its `MUSE_CODE_SUB_TOKEN` credential handling, and the
  bundle's own device-code client. DSH's Meta provider owns the sign-in, the credential record,
  and key renewal.
- The `muse-wonder` model ids: models now follow the catalog DeepSeek Harness advertises for the
  Meta provider (`muse-spark-1.1`, `muse-spark-1.2`, `muse-spark-1.3`, and the `-contributor`
  variants).

### Fixed

- Read the authorization seam's neutral notice (`{ message, url, code }`), not the raw pi-ai
  event shape. The previous reader never recognized the device-code notice, so `/muse-login`
  reported "did not answer in time" while the flow was waiting normally.
- Ship the Client half as a browser classic script (`client/client.js`, outside the TypeScript
  output). The Web UI concatenates client artifacts into plain script bundles, so the `export {}`
  that `tsc` emitted for `lib/client.js` broke the whole bundle with
  `Uncaught SyntaxError: Unexpected token 'export'` and aborted the Web boot.

## [0.1.0] - 2026-10-21

### Added

- Muse Code subscription model route for DeepSeek Harness through a second
  `@deepseek-ai/dsh-llm-pi-ai` instance (`openai-responses`, `https://api.meta.ai/v1`), leaving
  the existing `llm-pi-ai` configuration untouched.
- Native device-code authorization flow that mints the account-bound inference key and stores
  it in the DSH credential store under `MUSE_CODE_SUB_TOKEN`.
- Models `muse-spark-1.3`, `muse-spark-1.2`, `muse-wonder-1.0`, and `muse-wonder-full-1.0` with
  text and image input and reasoning-effort mapping.
- Shared Muse auth contract (`AUTH_CONTRACT.md`) with offline tests for the device flow and the
  plugin wiring.
- Unofficial-use risk notice for Meta subscription credentials (`DISCLAIMER.md`).

[0.1.0]: https://github.com/TheStreamCode/dsh-muse-code/releases/tag/v0.1.0
[0.2.0]: https://github.com/TheStreamCode/dsh-muse-code/releases/tag/v0.2.0
