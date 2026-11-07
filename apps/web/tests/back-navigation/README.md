# Frontend Back/auth regression tests

Run from `apps/web`:

```sh
npm ci
npm run test:back
```

Entrypoint: `node --test tests/back-navigation/*.test.cjs`.

## Dependencies/runtime

Use the existing CI Node 22 major (Vite 7 requires Node >=22.12 on that major).
Validation used Node 22.23.3 / npm 10.9.9. Reuse the existing locked React,
ReactDOM, TypeScript and Vite packages. Add only these direct dev dependencies:

```sh
npm install --save-dev --save-exact jsdom@26.1.0 esbuild@0.28.2
npm pkg set 'scripts.test:back=node --test tests/back-navigation/*.test.cjs'
```

Both versions were verified with `npm view`; esbuild 0.28.2 already exists in the
web package lock transitively. jsdom 26.1.0 was used for the previous local review.
Commit BOTH `apps/web/package.json` and its updated `package-lock.json` with the
tests. Do not run npm update, regenerate the lock from scratch, or touch the SQL
package. No root-level dependencies or package changes are required.

## Coverage

- Two actual-App integration chains, normal/StrictMode: 15 scenarios each.
- Eleven deterministic controller cases, using the actual class transformed in
  memory, including restored orphan guards, forward entries, unknown boundaries,
  pending pruning and queued cleanup. The production module is not edited/exported.
- Four logout controls (normal/StrictMode; alias editor previously opened or not).
  They catch duplicate sibling keys, orphaned contact DOM and Forward resurrection.
- Two delayed initial-session tests: auth callback B must win over late getSession
  A and INITIAL_SESSION A. A test-only React Fiber key lookup confirms the actual
  mounted Home belongs to B. This lookup may need adjusting on a major React upgrade.
- Two alias mutation tests: the supplied mock PostgREST builder captures explicit
  Authorization, holds the fake A mutation while auth changes to B, then completes.
  Assert A's explicit fake header remains and late completion does not relabel B UI.
  This proves App supplies its captured-account header, NOT Supabase SDK internal
  token-provider behavior. All tokens are conspicuously synthetic.

There are 21 Node test cases, incorporating all previous 30 App + 11 controller
scenario checks and additional auth/logout/alias tests. Failure exits nonzero.
React warnings/errors, jsdom errors, stale private DOM, inappropriate history
payload/callbacks, revived UI, incorrect navigation and network attempts fail CI.

## Safety and boundaries

`support.cjs` bundles actual App and components with esbuild. Only the Supabase
and receiveTimezone modules are replaced by test modules. No production Supabase
module/SDK is initialized; no VITE keys, env files, credentials or data are needed.
All users, contacts, messages and tokens are fabricated. Browser storage is fresh
memory per test. IndexedDB calls use a disabled/synthetic adapter, never a real
cache. jsdom subresource loading is off; fetch/XHR/WebSocket/EventSource/beacon
are blocked. No workflow, SQL file or backend function is involved.

The HTMLDialogElement polyfill and jsdom history are unit/DOM simulations. These
are not physical Android/PWA, native close-request, real Alt+Left, layout or
attachment-picker tests. Keep a real-browser/Android smoke test before release.

Fixtures are recreated per test and unmounted/closed in finally. React warnings
are strict failures; do not suppress duplicate-key warnings to make CI pass.
