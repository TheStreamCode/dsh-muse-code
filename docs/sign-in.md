# Sign-in plumbing

DSH 0.2.1 exposes no generic Remote method for starting a provider OAuth flow,
so the Settings page cannot call the authorization seam directly. The bundle
therefore registers exact local Web routes on the Host's own HTTP server:

- `POST /muse-code/login` starts the sign-in and answers with the code and the
  Meta URL;
- `GET /muse-code/status` reports `pending`, `authorized`, `failed`, or `idle`,
  which is what lets the card flip to **Signed in** without a reload.

The `/muse-login` command runs the same flow and waits for Meta's confirmation
before answering, so the chat shows the final state instead of leaving the
prompt waiting. A page whose origin cannot reach the Host falls back to that
command.

The credential lives in the DSH credential store as the `llm-pi-ai/meta`
record. It is never written to `cordis.patch.yml`, which carries only the
route's display name and its model list.
