# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
