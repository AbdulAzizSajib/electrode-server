## Context

The Google flow today, with where each hop runs:

```
storefront  <a href=API/auth/login/google?redirect=/account/oauth/callback?next=…>
API         googleLogin          → signInSocial, forwards state cookie, 302 to Google
Google      consent              → 302 to API/api/auth/callback/google
API         better-auth callback → creates user/session, sets session cookie, 302 to callbackURL
API         googleLoginSuccess   → reads session cookie, issues JWTs, 302 to FRONTEND_URL + redirect
storefront  /account/oauth/callback → forwards browser cookies to POST /auth/refresh-token
```

Two facts decide the design (proposal.md — Why has the detail):

- In production better-auth's cookies carry a `__Secure-` prefix, and `googleLoginSuccess` hard-codes the unprefixed name.
- The last hop needs the backend's cookies, which are host-only on the API host and never reach the storefront host.

Constraints from the codebase:

- `refresh-token` and `checkAuth` read **our** `better-auth.session_token` cookie (set by `tokenUtils.setBetterAuthSessionCookie`), not better-auth's. Those are two different cookies that happen to share a base name; this change touches only how the success step finds better-auth's.
- `checkAuth` accepts a plain session token (it splits `{token}.{signature}` on `.` and keeps the left half), so the storefront can hold the plain `Session.token`.
- The admin, the storefront and every verify script import services directly — the mint/redeem logic goes in `auth.service.ts`, with no `req`/`res`.
- One shop per API in production (confirmed with the merchant), so the `x-demo-key` scope is irrelevant to this flow.

## Goals / Non-Goals

**Goals:**
- The success step finds the session through better-auth, so the cookie name is never ours to get wrong.
- The storefront gets the token trio over a server-to-server call, keyed by something useless on its own.
- No migration.

**Non-Goals:**
- Changing the email sign-in path or `refresh-token`.
- Removing the backend's own session/JWT cookies from the success response. They are harmless, and the admin, if it ever offers Google, would be same-site with the API and could use them.
- A general-purpose "one-time code" facility. This is one consumer; it gets one prefix.

## Decisions

### 1. The success step asks better-auth for the session from the raw request headers

`auth.api.getSession({ headers: fromNodeHeaders(req.headers) })`, from `better-auth/node` — the same package `app.ts` already imports `toNodeHandler` from. better-auth then looks its cookie up under the name it set it with — the same `createCookieGetter` result, prefixed in production and not locally — so the handler no longer contains a cookie name at all, and the cookie's signature is verified as part of the lookup.

*Alternative:* read `__Secure-better-auth.session_token ?? better-auth.session_token`. Rejected: it restates better-auth's naming rule in our code, which is how this bug got in, and it would break again on a `cookiePrefix` change. Also, the current code rebuilds a `Cookie` header with the *unprefixed* name and passes it to `getSession`, which in production looks for the prefixed one — so even a correct read would have failed one line later.

### 2. A one-time exchange code, stored in the existing `Verification` table

At the success step the backend:

1. generates 32 random bytes, base64url — the **code**;
2. stores a `Verification` row: `identifier = "google-exchange:" + sha256(code)`, `value = <Session.id>`, `expiresAt = now + 60 s`;
3. redirects to `FRONTEND_URL + redirect` with `code` appended via `URL.searchParams`, so an existing `?next=` survives.

`POST /auth/google/exchange { code }` hashes the code, finds the row, deletes it, loads the session by id (unexpired), and returns `{ accessToken, refreshToken, sessionToken }` built exactly as `googleLoginSuccess` builds the JWTs today.

**Why `Verification`:** it is better-auth's table for precisely this row shape (an identifier, a value, an expiry) — it already holds OAuth state and email OTPs. A dedicated model would mean a migration, and with it the trigram `DROP INDEX` hazard, for a table with one column of difference. The `google-exchange:` prefix keeps our rows from colliding with better-auth's identifiers, which are emails and state strings.

**Why hash the code:** a code is a bearer handle for 60 seconds. Storing only `sha256(code)` means a read of the table — a backup, a log of a query, a support session — cannot redeem anything. A fast hash is right here (not bcrypt): the input is 256 random bits, so there is nothing to brute-force, and the lookup must be by equality.

**Why store `Session.id`, not the token:** the exchange then re-reads the session, so a session signed out or expired between the redirect and the redemption is refused naturally, with no second check to forget. It also keeps a copy of the session token out of a second table.

*Alternatives:*
- **Tokens in the redirect URL.** Rejected, as `add-storefront-auth-recovery-ui` design.md Decision 1 already did: history, proxy logs, `Referer`.
- **`Domain=.topitsolution.com` cookies.** Works only while every storefront is a subdomain of one parent; a client on their own domain breaks again, and every sibling subdomain (admin, other demos) receives the session. Rejected.
- **A signed, stateless code (JWT).** Cannot be single-use without a store, and single use is what makes a leaked callback URL harmless. Rejected.

This reverses `add-storefront-auth-recovery-ui` Decision 1, which rejected the exchange code as "out of proportion". That judgement rested on the cookie bridge working in a split-domain deploy, which it does not.

### 3. Single use is enforced by the delete, not by a read-then-check

Redemption is `findFirst` (by identifier, `expiresAt > now`) followed by `deleteMany({ where: { id } })`, and it proceeds **only if the delete count is 1**. Two concurrent redemptions both read the row; the database serialises the two deletes, and exactly one sees a count of 1. A flag column checked before use would let both through.

Opportunistically, minting also deletes expired `google-exchange:` rows, so abandoned codes do not accumulate. No cron.

### 4. Every refusal is 401 with one message

Unknown, expired, replayed, and revoked-session codes all return 401 `"Invalid or expired sign-in code"`. Distinguishing them would tell a caller which codes once existed. The storefront maps any failure to the same `no_session_found` it uses today, so no new error reason or copy is needed in `oauth-errors.ts`.

A missing or non-string code is a 400 from `validateRequest`, which is a client bug, not a sign-in outcome.

### 5. The storefront callback is the same route with its input swapped

`/account/oauth/callback` reads `code` from its own query, `apiFetch("/auth/google/exchange", { method: "POST", body: { code } })`, and writes the trio with the existing `authCookieOptions` / `authCookieMaxAge` exactly as today. `next` handling, `safeRedirect`, and the failure mapping are unchanged. The route's header comment is rewritten: its claim that the cookie bridge works split-domain is the false premise this change exists to remove.

The callback is a Route Handler that only redirects, so it renders no page and loads no third-party resource — the code in its URL has no `Referer` to leak through.

## Risks / Trade-offs

- **Server and storefront deployed out of step** → Google sign-in fails with `no_session_found` until both are live. Email sign-in is unaffected. Mitigation: ship together; the failure is visible and recoverable, never a wrong session.
- **Clock skew between app and database** → `expiresAt` is written and compared by the API process (`new Date()`), never by `NOW()` in SQL, so only one clock is involved.
- **60 s is too short on a very slow connection** → the window covers one redirect from API to storefront and one server-to-server call, normally well under a second. A customer who misses it is told sign-in did not complete and can retry; nothing is half-written.
- **`Verification` is better-auth's table** → a future better-auth version could sweep or reshape it. Our rows are self-contained (prefixed, short-lived); a sweep that deleted them early would surface as `no_session_found`, not as a wrong session. The verify script pins the round trip so an upgrade that breaks it is caught.
- **The backend still sets its own cookies on the success response** → unused by the storefront, harmless, and left in place (Non-Goals).

## Migration Plan

1. Deploy server and storefront together. No env var, no schema change, no Google console change — the registered redirect URIs already point at `/api/auth/callback/google`, which this change does not move.
2. Rollback: revert both. No data to unwind; any `google-exchange:` rows expire within 60 seconds.
