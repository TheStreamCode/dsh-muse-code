# Muse auth contract (v1)

DeepSeek Harness implements this Meta device-code contract in its shipped pi-ai Meta
provider (`llm-pi-ai/meta`); this bundle relies on that implementation. The sibling Muse Code
plugins implement the same flow themselves, so change this file and the pinned values together
with:

- `opencode-muse-auth`
- `hermes-muse-code`
- `openclaw-muse-code`
- `dsh-muse-code`

## Wire contract

| Item | Value |
|---|---|
| `CLIENT_ID` | `1031625952748946` |
| Device authorization | `https://auth.meta.com/oidc/device/authorization/` |
| Device token | `https://auth.meta.com/oidc/device/token/` |
| Key mint | `https://api.meta.ai/muse-code/key` |
| API version header | `x-api-version: 1.0.0` |
| Credential reference | `MUSE_CODE_SUB_TOKEN` |
| Inference base URL | `https://api.meta.ai/v1` |

DeepSeek Harness stores the same sign-in as the OAuth credential record `llm-pi-ai/meta` and
re-mints its short-lived key, because the pi-ai adapter owns that flow. The pinned
`MUSE_CODE_SUB_TOKEN` reference describes the sibling plugins' credential, not DSH's.

## Behaviour

- Device flow: request a device code, poll the token endpoint, accept
  `authorization_pending`, increase the interval on `slow_down`, stop on a
  terminal error or at `expires_in`.
- Key mint: exchange the OAuth access token for the account-bound inference
  key; reject an inactive subscription or a pending payment.
- Persistence: the sibling plugins store the key through the DSH credential seam under
  `MUSE_CODE_SUB_TOKEN` and keep the OAuth access token in memory. DeepSeek Harness stores the
  sign-in as the `llm-pi-ai/meta` credential record and renews the key from it.
- Any change to this contract bumps the version constant in the implementations' code and
  requires updating the pinned tests in all four repositories.
