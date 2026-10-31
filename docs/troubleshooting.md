# More troubleshooting

The five most common failure modes stay in the README. The rest live here.

## `/muse-login` is not offered in the composer

The command needs the DSH command and authorization services, which UI-less
compositions do not mount, or the bundle is inactive. Restart DSH after
installing; in a headless profile the command surface does not exist by design.

## The sign-in reports that no Meta sign-in flow is registered

This DSH build does not ship the Meta provider. Update to DeepSeek Harness
`0.2.1-rc.3` or newer, restart, and retry.

## Meta denies the login, or the subscription is inactive

The account has no active Muse Code subscription, the code expired, or the
approval was declined. Start the sign-in again (Sign in control or
`/muse-login`) and approve the new code before it expires.

## The credential dot stays red after signing in

The route's credential reference is a copy of the record's minted key; the
plugin mirrors it on boot and on every record update. If the dot stays red
while the card says **Signed in**, restart DSH and check that the
`llm-pi-ai/meta` record still exists in the credential store.

## Edit and Delete on the Muse Code row

Both are DSH's generic provider-row actions and a plugin cannot hide them.

- **Edit** writes the route profile into your profile patch: display name,
  models, and the `apiKeyEnv` reference. The plugin restores the reference on
  the next boot and refills an emptied model list from the account catalog.
- **Delete** removes the user-layer route and the plugin treats that removal
  as a sign-out: it deletes the `llm-pi-ai/meta` OAuth record and clears the
  mirrored `MUSE_CODE_SUB_TOKEN` reference. The provider leaves Settings →
  Models and the picker, and a hand-edited model list is lost; the plugin
  re-declares the row on its next refresh (and on restart) with a red dot, so
  sign in again to keep using Muse Code.
- To remove Muse Code for good, uninstall the bundle and delete the credential
  record; the supported off switch is the plugin itself:

```bash
dsh plugin --profile desktop remove @thestreamcode/dsh-muse-code
```

## Upgrading from 0.1.x

0.1.x inserted a second `@deepseek-ai/dsh-llm-pi-ai` instance, which DSH
refuses to activate (each instance declares the whole provider catalog), so its
route never appeared and its device-code flow had no surface. Reinstall the
bundle and restart DSH: the new version declares the shipped `meta` route
instead. The old `dsh-muse-code/subscription` record is no longer used. The
route still uses `MUSE_CODE_SUB_TOKEN`, which the plugin mirrors from the
current sign-in.
