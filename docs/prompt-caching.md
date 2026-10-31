# Prompt caching

The Meta Model API caches the request prefix per `prompt_cache_key`, and a
request without that key gets no reuse at all. DSH's pi-ai adapter sends the
session id as the key for every call, so turns in the same session reuse the
prefix Meta already saw. Measured against the live API with an identical
1.6k-token prefix: same key → 1521 of 1600 tokens cached on the second call;
different key or no key → 0. After a 12-minute pause the same-key entries still
reported 2673 of 2800 cached tokens, with or without `prompt_cache_retention`,
and a fresh key still reported 0 — so the default retention is enough for
normal turn pacing and there is no retention knob to tune.

The ratio you see in the usage panel therefore depends on how the session is
used:

- the cache is per key and per model — switching model or route starts a fresh
  prefix;
- a short session, or turns spaced far apart, shows a low ratio, because the
  first call of every cache window pays full price;
- editing the system prompt or compacting the history invalidates the prefix
  once.

The plugin does not change the request shape, so this behaves like any other
pi-ai route in the same harness (for example `opencode-go`). DeepSeek's
first-party routes report their own cache counters and are not directly
comparable.
