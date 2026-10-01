## Why

The first real cPanel deployment of this codebase hit five separate blockers. None of them was a bug in the application: every one was in the packaging scripts, the build configuration, or the runbook — the parts that only run when someone actually deploys, and which nothing in CI exercises.

What they shared is the reason they are worth recording together: **each failed silently, or reported success, or named the wrong cause.** `next build` exits 0 on a storefront bundle that cannot boot. `tsc -b` had failed on test files for long enough that the failure was recorded as "pre-existing" rather than fixed. `ALTER DATABASE` returns no error when the user lacks permission. `bash` reports a fork failure that reads as a MySQL problem. A missing directory in an archive surfaces as `ERR_MODULE_NOT_FOUND` at the exact step the runbook says is the one you must not skip.

The storefront blocker is the one that justifies a change document rather than five commits. It was "fixed" once, verified, and shipped — and the fix was wrong. It moved the failure from one package to another rather than removing it, and the verification missed that because it grepped for the symptom (`postcss-`) rather than the class of fault. The second diagnosis is in design.md, Decision 1, together with the check that would have caught the first.

## What Changes

- **The storefront's hoisted dependencies are bundled, not externalised.** `transpilePackages: ["sanitize-html", "postcss"]` replaces a `serverExternalPackages` entry that did not work. Turbopack emits a content-hashed specifier for any server-side external that resolves outside the app directory — which, under npm workspaces, is every shared dependency.
- **`scripts/` ships in the backend archive.** Two deploy guides instruct running `scripts/verify-mysql-charset.ts` on the host immediately after `migrate deploy`; the archive did not contain it.
- **The storefront packaging script finds its entrypoint** instead of assuming `.next/standalone/server.js`. With `outputFileTracingRoot` pinned to the monorepo root, Next writes it to `.next/standalone/nextjs/server.js`.
- **The admin's test sources type-check as their own project.** `tsconfig.test.json` carries vitest's and node's globals; `tsconfig.app.json` excludes the same globs, so production code still cannot reach for `process` or `readFileSync` and compile.
- **`asHeroVariant` narrows a section entry's layout.** A real type error, not a configuration one — see design.md, Decision 4.
- **`DEPLOY-topitsolution.md` records what actually happened at each step**, including the two failure modes of the charset step that produce no error at all.

## Capabilities

### New Capabilities

None. Nothing here changes what the system does — only whether it can be built and deployed.

### Modified Capabilities

None. No endpoint, service, schema or validation file is touched. The admin's `asHeroVariant` changes a type, not a behaviour: the value it returns for every input the backend produces is the value the previous expression produced.

## Impact

**nextjs** — `next.config.ts` (`transpilePackages`), `scripts/package-standalone.mjs` (entrypoint discovery, nested `node_modules`, POSIX tar path).

**server** — `scripts/package-cpanel.mjs` (ships `scripts/`), `DEPLOY-topitsolution.md` (§3.1, §4.1–4.3, §5.1, §5.4, §6, new §6.1, §11).

**admin** — new `tsconfig.test.json`; `tsconfig.app.json` and `tsconfig.json` reference it; `asHeroVariant` added to `src/lib/api/store-settings.ts` and used in `src/features/ui/home-slider/home-slider-page.tsx`.

**Not affected** — no application source outside the one admin page, no schema, no migration, no verify script's assertions.

**Accepted risk, stated rather than mitigated**: nothing in CI catches a recurrence of the storefront blocker. `next build` exits 0 in every broken variant, and the repo has no test that boots the standalone output. The check is a documented grep in `next.config.ts` and in the runbook, which is a comment and a habit, not a gate. Making it a gate means booting the standalone server in CI — worth doing, and out of scope here.
