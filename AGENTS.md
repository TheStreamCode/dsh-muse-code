# Agent instructions

Repository: dsh-muse-code
Maintainer: Michael Gasperini (Mikesoft)

This repository is an unofficial bundle for DeepSeek Harness that serves Muse Code
subscription models. The subscription-credential framing in `DISCLAIMER.md` and the pinned wire
values in `AUTH_CONTRACT.md` are part of the contract: keep them intact and in sync with the
sibling Muse plugins (`hermes-muse-code`, `openclaw-muse-code`, `opencode-muse-auth`).

## Layout

- `src/` — bundle source: provider route wiring, device-code login, credential handling.
- `lib/` — compiled output, committed because DSH bundle installs from Git may not run a build.
  Regenerate with `npm run build`; never edit by hand.
- `test/` — `node:test` suite; new behavior needs a test.
- `cordis.patch.yml` — bundle patch that inserts the model route and the auth plugin.
- `AUTH_CONTRACT.md` — pinned device-flow and key-mint contract shared with the sibling plugins.
- `.github/workflows/` — CI; do not weaken checks, pins, or permissions.

## Commands

```bash
npm install
npm run typecheck
npm test
npm run build
```

`npm test` builds `lib/` first. Use npm and the committed `package-lock.json`; never regenerate
the lockfile without a dependency change. Never commit build output generated outside `lib/` or
any local credential file.

## Constraints

- Keep changes focused; no drive-by refactors, no new runtime dependencies without a stated
  reason.
- Public documentation, comments, and commit messages are in English.
- Do not change `LICENSE`, `DISCLAIMER.md`, `AUTH_CONTRACT.md`, `SECURITY.md`,
  `CODE_OF_CONDUCT.md`, or release metadata unless the task is about them.
- Never add instructions that bypass Meta's terms or credential rules. The unofficial /
  use-at-your-own-risk framing stays in the README, `DISCLAIMER.md`, and the package
  description.
- Releases are tag-driven; do not create tags, releases, or publish packages.
- Run the checks above before proposing a change; the committed `lib/` must match `src/`.
