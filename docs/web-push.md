# Voluntary web push

**Status 2026-11-12:** approved by Nicolai and released from PR54 (migration `20261112210000_web_push.sql`).
Every user starts opted out; push is only sent after the user's explicit Ja/Slå til on that device.
The notification text follows the recipient's app language (`profiles.locale` via `locale_of`):
“ROLFF — Du har nye beskeder klar.” (da, default) or “ROLFF — You have new messages ready.” (en).
The frontend build gate is now on by default (`VITE_WEB_PUSH_ENABLED=false` hides it); the DB gate
(`push_runtime.enabled` + VAPID public key) and worker gate (`WEB_PUSH_ENABLED`) are the kill switches.
The historical notes below describe the original local implementation.

Implementation starts at main `09bcaccd71c6104e6c02ad0abe46103759511032`.
No production mutation, secret, schedule, actual push, model/mail call, real account,
or real message was used. Source-only commit/PR validation is separate from release. No merge/deploy or production mutation is authorized by this implementation.

## Architecture and privacy

- Existing manifest/icons retained. `public/sw.js` is push-only, with **no fetch handler**
  or offline cache of messages. It keeps only account ID, opaque local fence/binding in
  IndexedDB; never auth tokens, endpoint or encryption keys. No Apple/Google developer
  account, Firebase project, new paid service or existing-provider change required.
- `PushSettings` offers **Ja / Ikke nu** on the signed-in overview (also first onboarding).
  Both are neutral. Read/sign-in never requests permission; only the explicit click does.
  Declining is persisted per account, with a later menu/settings path. Unsupported,
  permission-denied, offline, subscription and server errors never claim working enable.
- Owner-pinned non-refreshing Supabase clients preserve a captured JWT across all awaits.
  Epoch checks + worker fences reject late account-A results in account B. Failed late
  persistence attempts rollback with A's captured token. One active notification account
  per browser worker scope, including multiple tabs. Signout immediately requests local
  clearing and best-effort server revoke. Offline revoke can fail; the old remote record
  then expires within 90 days, and cannot display against the new local binding.
- No endpoint/key client table access. RLS enabled, explicit execute/table grants; RPCs
  derive ownership from auth.uid(), cap eight devices and replace old bindings on renewal.
  Clients receive only their safe device metadata. Subscriptions expire after 90 days;
  browser-expired endpoints are removed on 404/410. Re-enable explicitly to renew.
- Existing `_release_for(uid,false)` is used, unchanged. Minute sweep advances a bounded
  recipient cursor so closed/locked recipients do not starve everyone after the first 100.
  Existing force-receive stays a separate explicit user action and is NEVER a scheduler
  option. Receive-settings saves never release or enqueue notifications.
- Actual release jobs -> per-(job, subscription) attempts -> SKIP LOCKED claim -> fresh
  prepare -> encryption -> atomic one-use handoff intent -> immediate bounded transport -> fenced finish. One worker claims <=10 transports,
  leases 90 sec, retries max five with 60/120/240/480/960 sec delays (cap3600), 5 sec
  transport and 10 sec DB RPC deadlines. 404/410 remove subscriptions; other non-transient
  4xx and redirects become terminal. Provider bodies are cancelled, not read or logged.
  No arbitrary Retry-After is trusted. Old jobs stop after24h; metadata deleted after7d
  on a worker tick. No notifications for release jobs predating subscription consent.
- Prepare is a preflight capability fetch, NOT permission to send. Encryption, body construction
  and SHA256 request digest happen before `handoff_push`. That final transaction repeats all
  current opt-in/window/owner/expiry/released-delivery checks under the existing try-shared
  locks, atomically consumes the attempt's lease into one explicit `push_handoffs` intent.
  Claim/preflight/intent are never recorded as a physical send or provider acceptance.
  TTL0 avoids storage by a push service while a device is offline.
- `npm:web-push@3.6.7`'s documented **generateRequestDetails** runs crypto only. Deno fetch
  performs the actual HTTPS POST with redirect:error, bounded body/timeout, and exact
  supported-provider URL allowlist: fcm.googleapis.com/fcm/send/, Mozilla's
  updates.push.services.mozilla.com/wpush/v1/ or v2/, one-label *.push.apple.com. No ports,
  credentials, IPs, custom domains, escapes, query strings or fragments. This intentionally
  does NOT support Edge WNS/other vendor endpoints yet; platform errors stay honest.
  `http_ece` supports a dangerous ECE_KEYLOG option: module loading fails closed if it is1.
- Encrypted payload is ONLY v, random binding, short expiry. Notification is fixed:
  **ROLFF — Du har nye beskeder klar.** No sender/body/email/conversation/private URL in
  payload, notification or logs. Click ignores payload navigation and opens only fixed
  same-origin overview. Stale/expired pushes, old clicks and mismatched binding are dropped;
  logout clears matching visible generic notices as feasible. Browser/OS may still retain
  notices already received. No exactly-once or precise-display guarantee.

## Dispatch contract and linearization proof

The minimal standard design is a **committed one-use dispatch intent**, NOT a database
connection held across HTTP. No new credentials, SQL channel or provider was introduced.

The logical send-start/linearization point is the **successful commit of `handoff_push`**.
It records the concrete (job, subscription owner/binding, lease, encrypted request SHA256)
intent under an unpredictable ID. It is explicitly an INTENT, not evidence that a network
packet left the worker. The intent is minted only for an already-encrypted request that
will be invoked immediately, never for a pending batch/queue of future physical sends.

Proof obligations, source locations and evidence:

1. `save_my_receive_settings` / timezone sync take the existing exclusive receive advisory
   lock; `save_my_push` / `revoke_my_push` take the exclusive push lock. `handoff_push` takes
   compatible shared versions, and a share row lock against the runtime kill switch.
   A writer committed BEFORE the intent is rechecked with its new values (or an in-flight
   writer causes immediate deferral). A writer competing AFTER acquisition cannot commit
   until the intent commits. The final eligibility read occurs while those locks are held.
   This orders committed changes, not merely the time a person touched a button.
2. An attempt row lock, handoff_id and unique(job,subscription,lease) make finalization
   one-use. Repeating the final RPC never yields a reusable authorization. `prepare_push`
   alone cannot finish a job as accepted. Owner deletion/renewal before finalization makes
   it fail; revocation after it retains the explicit in-flight audit (no endpoint/key copy).
3. The intent has at most750ms validity, clipped to the next DB window-minute boundary.
   The worker starts monotonic AND wall-clock measurement BEFORE its final RPC. It accepts
   only a DB-relative duration <=750ms and requires max(elapsed clocks) < duration-50ms.
   Thus RPC/network/commit-response delay consumes the budget rather than extending it.
   Backwards jumps fail closed; server/worker absolute-clock offsets cannot extend it.
   All crypto is before that point; a second check immediately precedes fetch, with no
   await/async queue between them. An expired/late response causes NO fetch and records
   expired, not sent. An admitted fetch has a five-second hard abort deadline.
4. `push_handoffs.outcome='intent'` and notification_jobs.sent_at=NULL until an actual
   provider response is reported. Explicit expired intents, failed/unknown handoffs and
   provider acceptance are separate. A crash/lost RPC response never replays that intent;
   a later bounded retry needs a NEW lease and fresh final authorization. A closed window
   prevents claims/authorization; opt-out/renewal removes the old binding. There is no
   stale authorization queue flushed after opt-out or when a window closes.
5. PGlite tests cover before/after changes, one-use finalization, no false acceptance,
   expiry, revocation/logout, fresh retry, runtime gating and unknown recovery. Deno tests
   deny all network and cover encryption-before-authorization, denied/late handoff, relative
   clock checks, one local authorization and bounded transport. The PostgreSQL17 CI workflow
   tests actual competing connections and lock ordering; local results do not replace its run evidence.

Precise tradeoff: a committed short-lived intent is already logically in flight; an edit
or opt-out ordered AFTER it does not retroactively cancel that single dispatch. It may
still expire locally without any network call. We do NOT label such an intent "physically
sent" or "delivered". Even after fetch invocation, provider/network/OS can delay or omit
receipt/display; a process can be preempted and an abort cannot retract bytes already
handed off. This is not an atomic DB+HTTP transaction and makes no absolute OS/display
or exactly-once promise. Retry after an unknown transport result can create a duplicate
of a generic notice; topic/tag coalescing is best-effort only.

This resolves the avoidable gap between a reusable preflight authorization and dispatch:
current changes BEFORE the one-use finalization prevent it, and after-point work has a
concrete, bounded, explicitly tracked in-flight intent. It does not pretend an authorization
pending in an arbitrary queue is already a physical send. No further user-level product
choice is needed for the original voluntary-notification request; real CI/Edge/mobile
verification and release approval remain outstanding.

Other honest limitations: expired/invalidated subscriptions require an explicit logged-in
renewal; no background anonymous re-subscribe. There is no unseen-count badge or read
status. A generic notice only means a delivery was released, not that it is unread.

## Scheduling choice (not provisioned)

Use the existing Supabase provider's pg_cron + pg_net + Vault, once per minute, invoking
`notification-dispatch` with dedicated `x-cron-secret`. This matches the existing
inactivity-sweep convention, does not expose the service role to cron headers, and needs
no external scheduler/routine/account. `web-push-scheduler.sql.example` is a review-only
explicit provisioning template, NOT auto-run migration. Follow official Vault warning:
pg_net temporarily stores a decrypted request token; protect DB logins and queue access.

## Narrow, separately approved rollout checklist — nothing below was run

1. Review the dispatch contract above and obtain explicit release/config/DB approval. Target ONLY
   Supabase **dubwlbqazbllnwpsqrjv**. Installed Supabase connector points to the WRONG
   project (haeanmqzdrpcvsqrkwln) and MUST NOT be used for this rollout.
2. Run synthetic PostgreSQL concurrency test in a fresh guarded CI database; PGlite
   cannot prove real advisory-lock or competing-connection behavior. No apt/PG install needed.
3. Apply `20261107100000_web_push.sql` via the approved release path. It starts DB gate off
   and retires all pre-consent historical jobs. Deploy worker and SW/client **still disabled**.
4. Separately generate persistent VAPID keys in approved secret handling (never in chat/git),
   configure VAPID_PRIVATE_KEY, VAPID_PUBLIC_KEY, real VAPID_SUBJECT (contact URL/mailto),
   and independent PUSH_CRON_SECRET (>=32 chars) in Edge secrets. Ensure ECE_KEYLOG is not1.
   Store matching cron-only secret in Vault. No real key was generated by this task.
5. Three distinct gates must agree: VITE_WEB_PUSH_ENABLED=true (frontend build),
   WEB_PUSH_ENABLED=true (worker), push_runtime.enabled=true plus matching public key (DB).
   Default/missing config remains unavailable; no permission button pretends to work.
   Have an approved canary plan before flipping gates; do not open public rollout first.
6. Provision one minute schedule from reviewed template; monitor counts only. Verify actual
   Supabase Edge runtime supports pinned node:crypto/library (local Deno test is NOT a
   deployed-runtime certification). Verify SW correct scope, HTTPS, JS MIME, no-cache for SW,
   manifest/icon delivery. No dev tools, logs or error monitoring may capture endpoints/keys.
7. Approved E2E using synthetic accounts/messages: opt-in, pending then window release with
   app closed, every supported push provider, denial, logout/account switch, revoked device,
   window edits, lock contention/retry, mobile overnight/DST. Physical iOS16.4+ Home Screen,
   Android Chrome and desktop Firefox/Safari needed. OS display delay must be explained.
8. Only after actual E2E and separate release approval announce availability. Update privacy
   heading “not yet activated” only when activation is true. No guaranteed display time.
   Disable all three gates + unschedule on rollback; never drop tables or VAPID keys casually.

## Reproducible synthetic tests

From repository root, with existing dependencies (no secret/test-account files):

```
node --test apps/web/tests/notifications/*.test.cjs
node tests/sql/notifications.mjs
ECE_KEYLOG=0 deno test --config supabase/functions/deno.json --cached-only --deny-net --allow-env=ECE_KEYLOG,DEBUG,NODE_DEBUG,FORCE_COLOR tests/notifications/transport_test.ts
deno check --config supabase/functions/deno.json supabase/functions/notification-dispatch/index.ts
npm run build:web
npm run test:sql
deno test --config supabase/functions/deno.json --cached-only --deny-net --allow-read=apps/web/src,apps/web/public tests/web tests/moderation/moderation_test.ts
npm run test:back --prefix apps/web
npm run test:clarification --prefix apps/web
node tests/sql/timezone-functional.mjs
node tests/lint/no_content_logs_test.mjs
```

Network denied in transport tests; React fixtures block network and never request browser
permission or register a real worker. SQL is in-memory PGlite with invented accounts/content.
Known deterministic public test scalars are crypto fixtures, NOT production VAPID material.

The `.github/workflows/notifications-postgres.yml` source uses workflow_dispatch plus narrowly
path-filtered pull_request (never pull_request_target), read-only repository permissions, checkout
without persisted credentials, no production secrets and fresh per-matrix PostgreSQL17 DBs for
both functionality and concurrency. A guarded query asserts/prints the actual server version.
Execution evidence belongs to the PR check logs, not the local PGlite runs. The real-lock suite is `tests/sql/notifications-concurrency.mjs`; same existing strict
CI/loopback/synthetic-only database guards as timezone tests. It requires fresh disposable
PostgreSQL, TIMEZONE_SQL_BACKEND=postgres, CI=true, TIMEZONE_SQL_TEST=synthetic-only and
TIMEZONE_TEST_DATABASE_URL restricted to the documented local synthetic DB/user.

Local UI fixture (same actual PushSettings/controller, fully mocked provider/permission/DB):
`node apps/web/tests/notifications/build-fixture.cjs /workspace/rolff-notifications-ui`.
The builder also emits **self-contained.html** with inline JS/CSS, no imports or external
resources, for file:// inspection without a server/CORS. Both fixture versions block all
network/workers, with offer/settings/unsupported/denied/unavailable scenarios. Parent's
initial server attempts returned ERR_CONNECTION_REFUSED in its browser despite local
curl200; NO browser UI scenarios have been tested. Do not count jsdom tests as browser QA.
No proxy/network settings or hosting routes were investigated. This is **not** actual push verification.

## Official/platform/library docs read for this implementation

- https://supabase.com/docs/guides/functions/schedule-functions
- https://supabase.com/docs/guides/cron
- https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/
- https://developer.mozilla.org/en-US/docs/Web/API/PushManager/subscribe
- https://github.com/web-push-libs/web-push (README: generateRequestDetails, VAPID, TTL)
- https://raw.githubusercontent.com/web-push-libs/web-push/master/README.md
- https://mozilla-services.github.io/autopush-rs/http.html
- https://web.dev/articles/push-notifications-web-push-protocol

- https://docs.postgrest.org/en/stable/references/transactions.html (per-request transaction, READ COMMITTED, commit/rollback)

## Source integration with blocking lists (not a release)

PR54 integrates blocking-list source commit `891476922fd92668667c122a16fb41d159c0bb90`. Notification SQL fixtures now create conversation/invitation/membership through owner RPCs and send via `prepare_send` → private recipient snapshot → `issue_reply_approval_v3` → `commit_message_reply`. They neither insert messages/deliveries directly nor grant fixture privileges or disable policy triggers. The six additional `notifications-v3.mjs` regressions cover owner-private lists, edits before issue/consume, legacy-v2 rejection, pending→normal release→concrete intent, and post-consumption idempotency. All approvals/model decisions in tests are synthetic; no model/provider is called. The PostgreSQL workflow runs these alongside the 50 functional and nine parallel cases on disposable PostgreSQL17.

This source merge does not authorize notification deployment. Gates remain disabled. The separately approved blocking-only release may rename its migration to the server-generated version; before a later notification release, integrate that bookkeeping and retest migration chronology without retaining duplicate migrations. Actual push, deployed Edge, physical mobile and integrated browser QA remain unverified.
