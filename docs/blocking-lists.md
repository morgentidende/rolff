# Private blocking lists (local implementation)

The conversation menu now opens **Blokeringer** with independent word/phrase and topic sections.
Word matching itself is unchanged (`rules.ts`): the existing acknowledgment still discloses only
an exact matched word/phrase to a sender. The entire lists remain owner-only.

- Alphabetical order uses the selected locale's `Intl.Collator` (Danish Æ, Ø, Å).
- Oldest/newest order normalizes the existing database `created_at` to fixed-width UTC microseconds,
  with deterministic ID ties even for mixed fractional precision or UTC offsets.
  Display sorting never saves a reordered list or fabricates historical timestamps.
- Each entry has an accessible SVG trash button with a 44px target. The reset modal clears
  only the current owner's words in the current conversation, never their topics.
- Both sections have info controls supporting longpress, tap, Enter and Space. Move/scroll/
  pointercancel cancels longpress. Modal Escape and Back integrate the existing in-memory
  navigation stack. Drafts and private criteria never enter browser history.
- Loads/saves are token-pinned to the opening account. Account/conversation keys and generation
  checks discard stale responses; failed mutations preserve the displayed entries and draft.

## Semantic boundaries

Topics are free-form recipient preferences (2–240 characters, maximum20 per conversation owner).
First-person criteria mean **the recipient**, not the sender: a recipient's “mine forældre”
should match incoming “dine forældre”, not normally the sender's “mine forældre”. Neutral and
positive mentions count too. No family, identity or appearance is inferred from arbitrary photos.

A separate strict deny-only classifier runs **after** ordinary moderation allows. The primary
safety prompt never receives recipient criteria. A secondary allow cannot override an existing
harm block or clarification. A secondary block has a generic private-boundary response; material
ambiguity requests clarification, with no send-anyway path. Malformed output/provider errors fail
closed. Caption, attachment transcript, file name and accessible textual alt are checked by the
same semantic stage. Existing file safety and literal checks are retained.

Both existing provider implementations use a dedicated schema and prompt for the secondary
stage. No model/provider/paid tier setting is changed. Criteria are sent to the configured AI
processor; UI and privacy policy disclose this and do not promise EU processing or Zero Data
Retention. Only fabricated data and mocked traffic have been tested. The fixture corpus records
recipient-perspective expectations, **not** evidence of actual model accuracy.

## Atomic policy binding and cutover

`recipient_filter_snapshot` atomically returns words, topics and an opaque string revision.
Word/topic edits and active membership changes increment a per-conversation revision in the
same transaction. `issue_reply_approval_v3` compares the **evaluated** revision under a row lock;
consumption checks the same revision, holding the lock until the message transaction commits.
A stale request cannot fetch a fresh revision merely to promote its old evaluation.

Conversation-first key-share locks agree with existing membership RPC ordering.
Trash RPCs and word reset acquire the revision lock before entry tuple locks, matching duplicate
upserts; direct client DELETE on both lists is revoked to prevent tuple/revision lock inversion. Replies,
content/file hashes,60-second ticket lifetime, person/timezone rules, shared locks and160/480
quotas are unchanged. Tickets carry only a revision, never private criteria.

The migration rejects still-unconsumed pre-feature/v2 tickets, including old in-flight Edge code.
Previously accepted idempotent retries remain valid. Deploy migration and updated endpoints as a
coordinated fail-closed cutover: either side missing causes sends to fail rather than skip checks.
No migration is applied by the local workstream. The timestamped SQL filename is a local candidate;
use the usual authoritative migration-version process before a future release.

## Synthetic tests and visual fixture

- `npm run test:sql`: baseline plus topic ownership, separate reset, bounds, owner export,
  snapshot-before-AI/issuer and issuer-before-consumption races in PGlite.
- `deno test --allow-env=APP_URL,MAILER_URL,MAILER_SECRET --allow-read=apps/web tests/moderation tests/web`:
  pure validators, existing moderation/web regressions, mocked provider schemas and sort/token contracts.
- `cd apps/web && npm run test:blocking`: actual React UI under jsdom, mocked fetch only.
- `cd apps/web && npm run test:back && npm run test:clarification`: baseline navigation/UI and actual
  endpoint bundles with provider fetch mocked, including private-topic deny-only routing.
- `cd tests/sql && node timezone-functional.mjs`: existing synthetic timezone regressions.
- `npm run build:web` and `git diff --check`.
- `node tests/lint/no_content_logs_test.mjs && node tests/lint/no_content_logs.mjs`.

`tests/sql/blocking-concurrency.mjs` adds actual parallel PostgreSQL checks to the existing
PostgreSQL17 CI matrix; it requires the existing guarded fresh localhost CI database and is not
locally run in PGlite. No PostgreSQL installation is needed or performed here.

For later browser verification: `apps/web/blocking-lists-fixture.html` uses only fabricated data
and replaces fetch with an in-memory handler. It rejects every non-synthetic URL. The separately
built `/workspace/rolff-blocking-lists-preview.html` is self-contained, network-disabled and includes
light/dark controls. Neither is production data. Visual320/390px/device verification remains to be
performed by the coordinator; jsdom does not prove layout, native focus trapping or Android behavior.
