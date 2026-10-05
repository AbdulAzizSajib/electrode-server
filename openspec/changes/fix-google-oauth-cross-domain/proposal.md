## Why

"Continue with Google" works on localhost and fails on every production deployment, because two things that only line up on localhost both have to line up for it to succeed:

1. **The backend looks for the session cookie under the wrong name.** `advanced.useSecureCookies` is true in production, so better-auth names its cookie `__Secure-better-auth.session_token` (confirmed in the installed `createCookieGetter`). `googleLoginSuccess` reads `req.cookies["better-auth.session_token"]`, finds nothing, and sends the customer to `/login?error=oauth_failed` — after Google has already approved them.
2. **The storefront callback depends on cookies the browser never sends it.** `/account/oauth/callback` forwards the browser's cookies to `POST /auth/refresh-token`, expecting the backend's session cookies to be among them. Those cookies are host-only on `api.topitsolution.com`; the browser never sends them to `edemo1.topitsolution.com`. On localhost the bridge works by accident — cookies ignore ports, so `localhost:4000` receives what `localhost:5000` set.

Fixing (1) alone moves the failure one step later, to `?error=no_session_found`. Both have to go.

## What Changes

- **The Google success handler reads the session the way better-auth names it.** The session is resolved from the request's headers by better-auth itself, so the `__Secure-` prefix is handled in production and absent locally, with no cookie name written out in our code.
- **New: a one-time exchange code hands the session to the storefront.** On a successful handshake the backend mints a random, single-use code valid for 60 seconds, stores only its hash, and redirects to the storefront callback with `?code=`. The code names a session; it is not a credential on its own and is worthless once redeemed or expired.
- **New endpoint `POST /auth/google/exchange`** trades a code for `{ accessToken, refreshToken, sessionToken }` — the same trio `refresh-token` and `login` return. Called server-to-server by the storefront, so no token ever appears in a URL, in browser history or in a `Referer`.
- **The storefront callback redeems the code instead of forwarding cookies.** Same route, same redirect-to-`next` behaviour, same failure reasons; the cookie bridge is removed.
- **BREAKING (internal contract only):** the backend's Google success redirect now carries `code` and the storefront callback requires it. A storefront deployed without this change, talking to a backend with it, will fail Google sign-in with `no_session_found` — deploy the two together.

Out of scope, stated so they are not mistaken for oversights:
- **Per-demo Google sign-in on a shared demo host.** A top-level navigation cannot carry `x-demo-key`, so on a host with `DEMO_DATABASES` set, Google sign-in resolves to the default shop. Production runs one shop per API, so this does not affect it.
- **Merging a guest cart on Google sign-in in a split-domain deploy.** `guestToken` lives on the storefront's domain, so the backend's merge in the success handler cannot see it — the same gap email sign-in already has. Unchanged here.
- **Redirecting to an origin other than `FRONTEND_URL`.** With one storefront per API, `FRONTEND_URL` is already correct.

## Capabilities

### New Capabilities
- `api/social-sign-in`: how the backend completes a Google handshake in any deployment shape, and how it hands the resulting session to a storefront on another host — the one-time code, its lifetime and single use, and the exchange endpoint.

- `storefront/social-sign-in`: the requirement "Storefront session established after the handshake", changed from "establish the session from the backend's cookies" to "establish it by redeeming the code the handshake returned". Behaviourally this is a modification of the requirement introduced by `nextjs/openspec/changes/add-storefront-auth-recovery-ui`, but that change was never archived, so no main spec exists to apply a MODIFIED delta to. It is therefore ADDED here, restated in full; the entry-point and error-message requirements from that change are unaffected and are not repeated.

### Modified Capabilities
None.

## Impact

**server**
- `src/app/module/auth/auth.controller.ts` — `googleLoginSuccess` resolves the session through better-auth and redirects with a code; new `exchangeGoogleCode` handler.
- `src/app/module/auth/auth.service.ts` — mint and redeem the code; `googleLoginSuccess` returns the session token alongside the JWTs.
- `src/app/module/auth/auth.route.ts` + `auth.validation.ts` — `POST /google/exchange`, body `{ code }`.
- **No schema change and no migration.** Codes live in the existing `Verification` table under a `google-exchange:` identifier prefix — the table better-auth already uses for exactly this shape of row (identifier, value, expiry).
- New `scripts/verify-google-exchange.ts`.

**nextjs**
- `src/app/(shop)/account/oauth/callback/route.ts` — redeem `code`; header comment rewritten (its "works in a split-domain deploy" claim was not true).
- `src/lib/oauth-errors.ts` — unchanged reasons; verify none are newly reachable.

**Deployment** — server and storefront must ship together. No env var changes; the Google console redirect URIs the merchant already registered (`https://api.topitsolution.com/api/auth/callback/google`, `http://localhost:5000/api/auth/callback/google`) are correct and stay as they are.
