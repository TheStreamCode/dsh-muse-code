# Sign-in plumbing

DSH 0.2.1 exposes no generic Remote method for starting a provider OAuth flow,
so the Settings page cannot call the authorization seam directly. The bundle
therefore registers exact local Web routes on the Host's own HTTP server:

- `POST /muse-code/login` starts the sign-in and answers with the code and the
  Meta URL;
- `GET /muse-code/status` reports `pending`, `authorized`, `failed`, or `idle`,
  which is what lets the **Muse Code OAuth** settings page flip to **Signed in**
  without a reload.

The `/muse-login` command runs the same flow and waits for Meta's confirmation
before answering, so the chat shows the final state instead of leaving the
prompt waiting. The **Settings → Muse Code OAuth** page calls the two routes
above and falls back to that command when its origin cannot reach the Host.
The page states and actions are documented in
[settings-page.md](settings-page.md).

The credential lives in the DSH credential store as the `llm-pi-ai/meta`
record. It is never written to `cordis.patch.yml`, which carries only the
route's display name and its model list.
