# Muse Code OAuth settings page

The bundle's browser half registers the page as a DSH `settings.section`
(id `muse-code-oauth`, order 53). Settings shows it as **Muse Code** in the
rail and as **Muse Code OAuth** in the page body.

The page is the interactive companion of `/muse-login`: both call the shipped
`llm-pi-ai/meta` device-code flow, and the page adds live status, the device
code, and the Meta page link without a page reload.

## States

| State | Dot | What it means | Available actions |
| --- | --- | --- | --- |
| Checking | Grey | The first status read is in flight. | None yet |
| Not signed in | Grey | No Muse Code credential record is stored. | **Sign in with Meta**, **Open sign-in page** |
| Waiting for Meta | Amber | The device-code flow is running. The page shows the code and updates itself. | **Open Meta page** |
| Signed in | Green | DSH stores the subscription credential and the model list is synced from the account. | **Sign in again**, **Open sign-in page** |
| Sign-in failed | Red | Meta denied the request, the code expired, or the Host could not start the flow. | **Sign in with Meta** after reading the message |

The pending state hides the primary button on purpose: the only useful action
while Meta waits for confirmation is opening the verification page. The
**Open Meta page** link points at the URL returned by the login request; when
the page was reloaded mid-flow, it falls back to the local sign-in page, which
starts the flow again and shows a fresh code.

## Behavior

- **Sign in with Meta** sends `POST /muse-code/login` and shows the device code
  from the answer.
- The page polls `GET /muse-code/status` every two seconds while a sign-in is
  pending, and stops when the state is authorized, failed, or the page unmounts.
- An authorized status renders **Signed in** without a reload. DSH owns the
  credential; the plugin never writes it to the page or to `cordis.patch.yml`.
- When the page origin cannot reach the local Host, the card states that and
  points at `/muse-login` in a chat. The command runs the same flow and waits
  for Meta's confirmation itself.

The page does not edit models, the endpoint, or the credential reference.
Those stay on the provider row under **Settings → Models**, which the Models
page owns.

## The `muse-code-oauth` provider row

The bundle declares the shipped `meta` route with the display name
`muse-code-oauth`, so the row under **Settings → Models** and the model picker
group use that name. The route id stays `meta`; only the label changes.

Installations upgraded from 0.3.x still stored **Muse Code (Meta
subscription)**. The plugin renames that legacy label on the next boot and
leaves a display name you edited by hand untouched.
