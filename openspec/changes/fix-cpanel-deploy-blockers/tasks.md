## 1. Storefront: the bundle that could not boot

- [x] 1.1 Reproduce locally rather than trusting the host's stack trace: `grep -rho "postcss-[0-9a-f]\{16\}" .next/server/` finds the same hashed specifier the host reported.
- [x] 1.2 Establish that the package itself ships correctly — `postcss` and `sanitize-html` are both present in the standalone `node_modules/`, so only the NAME in the bundle is wrong.
- [x] 1.3 **First fix, which was wrong and shipped.** `serverExternalPackages: ["sanitize-html"]` removed `postcss-<hash>` and introduced `sanitize-html-6ef27188a4b3dc42`. Verification missed it because it grepped for the reported symptom (`postcss-`) rather than for the shape of the fault.
- [x] 1.4 Prove the mechanism: removing the entry brings `postcss-9745a0d11e3197ae` straight back. Marking a package external is what triggers the hashing, so no choice of external package can fix it.
- [x] 1.5 `transpilePackages: ["sanitize-html", "postcss"]` — Turbopack compiles both into the chunks, leaving no external specifier to mangle.
- [x] 1.6 Verify by enumerating EVERY external, not one name: `grep -rhoE 'a\.x\("[^"]+"' .next/server/chunks/ssr/*.js | sort -u` returns 15 specifiers, all real and resolvable, none carrying a 16-hex suffix.
- [x] 1.7 Boot the standalone output and request the route that crashed. `/` 200, `/offer/test-slug` 404 (rendered, not 500), `/products` 200, and the boot log holds no module error.
- [x] 1.8 Confirm the sanitiser still works when bundled — `<p>হ্যালো<script>alert(1)</script></p>` → `<p>হ্যালো</p>` against the standalone tree.
- [x] 1.9 Storefront suite unchanged: 24 files / 352 tests passing.
- [x] 1.10 Record the mechanism, the failed first attempt, and the verification command in `next.config.ts`, with the warning that `next build` exits 0 in every broken variant.

## 2. Storefront: packaging

- [x] 2.1 `scripts/package-standalone.mjs` locates the entrypoint (`standalone/server.js` or `standalone/<dir>/server.js`) instead of assuming the flat layout that `outputFileTracingRoot` rules out here.
- [x] 2.2 Copy `public/` and `.next/static/` beside the entrypoint, not at the standalone root.
- [x] 2.3 Move the traced `node_modules` in beside `server.js` when nested — once unpacked on the host there is no level above it for Node to resolve upward to.
- [x] 2.4 Tar from the app directory, POSIX-separated, so the archive's top level is `server.js` + `node_modules` + `.next` + `public` + `package.json`. Verified by listing the archive.

## 3. Backend: the archive missed what the runbook runs

- [x] 3.1 `scripts/package-cpanel.mjs` ships `scripts/`. Both deploy guides instruct `npx tsx scripts/verify-mysql-charset.ts` immediately after `migrate deploy`; the archive did not contain it, so the one step that stands between a latin1 database and unrecoverable mojibake failed with `ERR_MODULE_NOT_FOUND`.
- [x] 3.2 Comment states why they ship as `.ts` and run through `npx tsx` — `--omit=dev` means tsx is not in the shipped tree, so the on-demand fetch is the only way they run.

## 4. Admin: `tsc -b` exits 0

- [x] 4.1 `tsconfig.test.json` extends the app project and adds `vitest/globals` + `node`, so test sources type-check with the globals they actually use.
- [x] 4.2 `tsconfig.app.json` excludes the test globs; `tsconfig.json` references the new project. Both files carry the obligation that the two glob lists stay in step.
- [x] 4.3 Override the inherited `exclude` with `[]` — `extends` carries the parent's exclude, which cancelled the test project's own include and reported TS18003 "no inputs".
- [x] 4.4 Prove the test project is checked rather than skipped: a deliberate type error in `hero-slots.test.ts` is caught, then reverted.
- [x] 4.5 `asHeroVariant` in `lib/api/store-settings.ts` narrows a section entry's `variant` through `HERO_VARIANT_OPTIONS`, and `home-slider-page.tsx` uses it.
- [x] 4.6 `npx tsc -b` exits 0; all three projects build. Admin suite unchanged at 38 files / 418 tests. ESLint clean on both changed files.
- [x] 4.7 Confirm the other two readings in `add-multi-demo-hosting` task 7.1 still hold rather than assuming: admin `lint` still exits 1 on one pre-existing `react-hooks/refs` error in `lib/realtime/use-order-alert.ts`, and the frontend still carries exactly 431 lint errors. That task note is annotated as superseded for the TS errors only.

## 5. Runbook

- [x] 5.1 §3.1 charset moves to phpMyAdmin, with both silent Terminal failures named: the `nproc` fork failure that means the command never ran, and bracketed-paste debris corrupting a pasted line.
- [x] 5.2 §3.1 gains the case where `ALTER DATABASE` succeeds and changes nothing — the user lacks permission and MySQL reports no error — plus the line to send hosting support.
- [x] 5.3 §4.1–4.3 paths corrected (`E:\Next Level Project\…` → the real tree; `frontend/` → `nextjs/`).
- [x] 5.4 §4.3 adds `VITE_STOREFRONT_URL`, whose absence points the panel's outbound storefront links at `localhost:4000`, and says why a PowerShell variable is preferred over `.env.local`.
- [x] 5.5 §4.2 adds the externals grep as a pre-upload step, stating that `next build` succeeding proves nothing about it.
- [x] 5.6 §5.1 replaces FTPS-by-default with SFTP and a `curl -LO` alternative, with the `Initializing TLS…` timeout named as the symptom of TLS-scanning middleboxes.
- [x] 5.7 §5.4 gains a pure-SQL equivalent of the eight charset checks, for when `scripts/` is absent or `npx tsx` cannot install under the process limit. It uses an explicit schema name because `DATABASE()` is empty in phpMyAdmin's SQL tab — which reports `tables exist: 0` and makes the three checks after it pass vacuously.
- [x] 5.8 §5.4 distinguishes which FAIL blocks the deploy: table-level charset must be fixed before content exists; the database default can be fixed later by support.
- [x] 5.9 §6 adds the remove-before-extract procedure, since Next's chunk names change per build and `tar -xzf` overwrites without deleting.
- [x] 5.10 New §6.1 — read `stderr.log` rather than guessing, with four causes tabulated, and the note that a missing `.htaccess` gives 404 rather than 500.
- [x] 5.11 §11 gains six rows: hashed-specifier crash, fork limit, FileZilla TLS timeout, missing `scripts/`, silent `ALTER DATABASE`, and phpMyAdmin's empty `DATABASE()`.
- [x] 5.12 Correct the two §6.1/§11 rows that credited `serverExternalPackages` — they named the fix that did not work, and were written before task 1.4 disproved it.

## 6. Gate

- [x] 6.1 Storefront: `next build` clean, externals grep clean, standalone boots, three routes render, 352 tests pass.
- [x] 6.2 Admin: `tsc -b` exits 0, 418 tests pass, ESLint clean on changed files.
- [x] 6.3 Runbook: no stale paths remain, no stale `serverExternalPackages` claim remains, code fences balanced (42), `<details>` balanced.
- [ ] 6.4 Server: `npm run build:cpanel` and confirm `scripts/` is present in `backend.tar.gz`. Not run here — the user builds, and the script change is a single `cpSync` whose source directory is known to exist.
- [ ] 6.5 On the host: upload the new storefront archive over a cleaned directory and confirm every route renders. The storefront fix is verified locally against the standalone output, which is the same artifact, but the host is where both previous attempts failed.
