## 1. Backend — exchange code in the service

- [x] 1.1 In `auth.service.ts`, add `createGoogleExchangeCode(sessionId)`: 32 random bytes base64url, store a `Verification` row with `identifier = "google-exchange:" + sha256(code)`, `value = sessionId`, `expiresAt = now + 60 s`, delete expired `google-exchange:` rows in the same call, return the raw code. Verify with task 3.1.
- [x] 1.2 In `auth.service.ts`, add `redeemGoogleExchangeCode(code)`: hash, `findFirst` unexpired row, `deleteMany({ where: { id } })` and continue only when the count is 1, load the unexpired `Session` by id with its user, build the JWTs through the same `buildTokenPayload` path `googleLoginSuccess` uses, and return `{ accessToken, refreshToken, sessionToken: session.token }`. Every refusal throws `AppError(401, "Invalid or expired sign-in code")` (design.md Decision 4). Verify with task 3.1.
- [x] 1.3 Change `AuthService.googleLoginSuccess` to also return the session's id and token alongside the JWTs, with its callers updated; verify `npm run lint --workspace server` passes.

## 2. Backend — controller, route, validation

- [x] 2.1 In `auth.controller.ts` `googleLoginSuccess`, replace the `req.cookies["better-auth.session_token"]` read and the rebuilt `Cookie` header with `auth.api.getSession({ headers: fromNodeHeaders(req.headers) })` (import from `better-auth/node`); keep the existing `no_session_found` / `no_user_found` redirects. Verify by reading the handler: no cookie name string remains in it.
- [x] 2.2 In the same handler, mint the code (1.1) and build the redirect with `new URL(finalRedirectPath, envVars.FRONTEND_URL)` plus `searchParams.set("code", …)`, so an existing `?next=` is preserved; keep the off-site guard on `redirect`. Update the handler's comment to cite `openspec/changes/fix-google-oauth-cross-domain`. Verify with task 4.2.
- [x] 2.3 Add `googleExchangeZodSchema` (`{ code: z.string().min(1) }`) to `auth.validation.ts`, an `exchangeGoogleCode` controller that calls `redeemGoogleExchangeCode` and `sendResponse`s the trio, and `router.post("/google/exchange", validateRequest(googleExchangeZodSchema), AuthController.exchangeGoogleCode)` in `auth.route.ts`. Verify `npm run build --workspace server` succeeds (user runs builds — name the command).
- [x] 2.4 Add the `POST /auth/google/exchange` request to the Postman collection under Auth. Verify the collection is valid JSON.

## 3. Backend — verify script

- [x] 3.1 Add `scripts/verify-google-exchange.ts` (services imported directly, `__verify_*` user and session created and removed in `finally`, plus deletion of any `google-exchange:` rows it made) asserting: a fresh code redeems to a trio whose `sessionToken` equals the session's token; a second redemption is refused; a code past `expiresAt` is refused; an unknown code is refused; a code whose session was deleted is refused; two concurrent `redeemGoogleExchangeCode` calls on one code yield exactly one success; the stored identifier does not contain the raw code. Verify `npx tsx scripts/verify-google-exchange.ts` prints only PASS lines.

## 4. Storefront — callback redeems the code

- [x] 4.1 Rewrite `nextjs/src/app/(shop)/account/oauth/callback/route.ts` to read `code` from its query, fail with `no_session_found` when absent, `apiFetch("/auth/google/exchange", { method: "POST", body: { code } })`, map a 401 to `no_session_found` and anything else to `oauth_failed`, and write the trio with the existing `authCookieOptions`/`authCookieMaxAge`. Rewrite the header comment: the cookie bridge and its "works split-domain" claim go, the exchange code and a pointer to `server/openspec/changes/fix-google-oauth-cross-domain` come in. Verify `npm run lint --workspace nextjs` passes.
- [x] 4.2 Add or update a Vitest test for the callback route covering: valid code → cookies written and redirect to `next`; missing code → `/account/login?error=no_session_found` with no cookies; exchange 401 → `no_session_found`; exchange unreachable (status 0) → `oauth_failed`; off-site `next` → `/account`. Verify `npm run test --workspace nextjs -- "src/app/(shop)/account/oauth/callback"` passes.
- [x] 4.3 Update the `GoogleSignInButton.tsx` header comment, which describes the callback as "what converts the backend's session into this app's cookies", to say it redeems the exchange code. Verify by reading the comment.

## 5. End to end

- [ ] 5.1 Locally (`npm run dev`), sign in with Google from the storefront and confirm the address bar passes through `/account/oauth/callback?…&code=…`, the customer lands on the original destination signed in, and reloading that callback URL returns to `/account/login?error=no_session_found`.
- [ ] 5.2 After deploying server and storefront together, repeat 5.1 on `https://edemo1.topitsolution.com` and confirm the customer is signed in; record the result in this change before archiving.
