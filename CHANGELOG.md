# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
