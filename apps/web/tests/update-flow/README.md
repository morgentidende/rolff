# Update flow (manual, headless Chrome)

Checks that reopening the app after a deploy shows the new version without a
manual refresh, and that it never reload-loops. Not part of CI (needs Chrome).

```sh
# build two versions of main ("old") and of this code ("new") into $V/{old,new}-v{1,2}
# (title patched to "Rolff v1"/"Rolff v2"), then:
npm i --no-save playwright-core
UPDATE_FLOW_BUILDS=$V node tests/update-flow/flow.mjs
```

Expected: A (old code, no cache headers) stays on v1 = the bug; B/C/E reach v2;
C with no extra reload; D (server keeps serving stale HTML) reloads exactly once and stops.
