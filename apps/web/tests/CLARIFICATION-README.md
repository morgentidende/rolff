# Clarification regression drafts
Copy the `clarification/` and `moderation-endpoints/` directories into `apps/web/tests/`.
All source imports are relative; endpoint handlers are bundled from the current checkout freshly on every run into an OS temporary directory, removed afterwards. No checked-in compiled endpoint/source copies are needed.

Prerequisites: Node 22, existing web dependencies installed (`cd apps/web && npm ci`), plus `jsdom@26.1.0` and `esbuild` available as web dev dependencies. Parent must intentionally update package/lock if adding these; this draft does not do so. Existing Vite dependency already supplies esbuild in current checkout, but declare it directly for durable CI.

From repository root:
```
node --test apps/web/tests/clarification/app.test.cjs
node apps/web/tests/moderation-endpoints/run.cjs
```
No Deno permissions, database, environment secrets or provider credentials are required. Fabricated auth and request values are declared in the mocks. UI network APIs throw; provider fetch is an in-process fake; no external provider is contacted.

Expected: 4 mounted App tests (normal/StrictMode x text/file), 12 endpoint scenarios.
UI cases retain reply, text and attachment/caption after clarify; check neutral notice and absence of suggestion/send-anyway; verify exact mocked function args and no added message. UI selectors use accessible labels/button names, not composer child positions. The single message is chosen via its accessible role/name.
Endpoint cases cover text/file clarify and harmful result, transcript hard-filter and recipient block priority, long-filename regression, malformed provider503, text accepted historical retry without provider, text/file allow issuing v2 only. Clarify paths assert zero issue/commit and zero table writes. Allowed send cases intentionally invoke mocked issue/commit only.

Limits: jsdom is not a browser layout/native Android Back simulator; file selection is synthetic. No live model semantic-accuracy evaluation and no SQL-policy enforcement tests. Existing Back tests were not edited.
