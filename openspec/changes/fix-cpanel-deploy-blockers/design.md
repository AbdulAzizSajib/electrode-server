## Context

See [proposal.md](proposal.md) — Why. The facts that decide the shape:

- **This is an npm workspace.** Every shared dependency is hoisted to the monorepo root, so from `nextjs/` a package like `sanitize-html` resolves to `<repo>/node_modules/sanitize-html` — outside the app directory. That one fact causes Decision 1.
- **`outputFileTracingRoot` is pinned to the monorepo root**, and must stay there: pinning it to the app directory can make Next unresolvable when it is itself hoisted. Next mirrors the app's path relative to that root inside `.next/standalone`, so the entrypoint is nested.
- **`next build` exits 0 on a storefront that cannot boot.** Both storefront blockers below reported success at build time and failed only on the host, at first render.
- **The server has no test framework**; the admin and storefront have vitest. Nothing in any of them boots a production artifact.
- **The deploy runbook is read on a host, in a terminal, by someone who cannot read the source.** An instruction that names the wrong cause costs more there than anywhere else.

## Goals / Non-Goals

**Goals:**

- A storefront archive that boots and renders every route on the host.
- A backend archive that contains what the runbook tells the operator to run.
- `tsc -b` exits 0 in the admin, so `npm run build` is a usable gate again.
- A runbook whose failure cases name the actual cause.

**Non-Goals:**

- **A CI gate for any of this.** Stated as accepted risk in the proposal rather than quietly skipped.
- **Changing `outputFileTracingRoot`.** The nesting it causes is handled in the packaging script; moving it trades a solved problem for an unsolved one.
- **Fixing the admin's remaining lint error.** `react-hooks/refs` in `lib/realtime/use-order-alert.ts` is pre-existing, unrelated, and untouched here.
- Any application behaviour change.

## Decisions

### 1. Bundle the hoisted packages; do not externalise them

The storefront died on the host with `Cannot find module 'postcss-9745a0d11e3197ae'`. No package has that name. The 16-hex suffix is Turbopack's: it emits a **content-hashed specifier** for a server-side external that resolves outside the app directory.

The first fix was `serverExternalPackages: ["sanitize-html"]`, reasoning that marking the parent external would keep its dependency tree as plain runtime requires. **It was wrong, and it shipped.** The next deploy failed with `Cannot find module 'sanitize-html-6ef27188a4b3dc42'` — the hash had moved from the dependency to the parent, because *marking something external is what triggers the hashing in the first place*.

Confirmed by removing the entry: `postcss-9745a0d11e3197ae` comes straight back.

**Chosen:** `transpilePackages: ["sanitize-html", "postcss"]`. Turbopack compiles both into the server chunks, so there is no external specifier left to mangle. `postcss` is listed explicitly because `sanitize-html` depends on it and it is hoisted too.

**Why the first verification missed it:** it grepped for `postcss-`, the symptom that had been reported, and found nothing. The check that distinguishes every variant is to enumerate *all* externals and look for the shape of the fault:

```bash
grep -rhoE 'a\.x\("[^"]+"' .next/server/chunks/ssr/*.js | sort -u
```

Every specifier it prints must be a real, resolvable name. That command is now in `next.config.ts` and in the runbook's §4.2, with the warning that `next build` proves nothing here.

*Alternative considered:* un-hoisting these two into `nextjs/node_modules`. It would work, and npm offers no supported per-package way to express it that survives a fresh `npm install`.

### 2. The packaging script finds the entrypoint rather than assuming it

`outputFileTracingRoot` is the monorepo root, so Next writes `.next/standalone/nextjs/server.js`, not `.next/standalone/server.js`. The packaging script checked the latter and exited 1 with a message blaming a missing `output: "standalone"` — which was configured correctly all along.

Both layouts are real: the config's own `isMonorepoCheckout` branch produces the flat one. So the script searches rather than branching on a flag, copies `public/` and `.next/static/` *beside* the entrypoint, moves the traced `node_modules` in beside it when nested (once unpacked on the host there is no level above `server.js`), and tars from the app directory so the archive's top level is what Passenger expects.

### 3. Tests get their own TypeScript project

Two of the admin's three TS errors were test files: `tsconfig.app.json` sweeps `src/` and declares neither vitest's globals nor node's.

Adding `vitest/globals` and `node` to the app project would fix the error and **cost the guarantee that makes the project worth having** — production code could then reach for `process` or `readFileSync` and still compile, in a browser bundle.

**Chosen:** `tsconfig.test.json` extends the app project and adds only those types; `tsconfig.app.json` excludes the same globs. The two lists must stay in step — a file matched by neither is checked by nothing, which is worse than the original failure because it is silent. Both files say so.

One trap, recorded because it looks like a broken config: `extends` inherits `exclude`, so the test project's `include` was cancelled by the parent's `exclude` and TS18003 reported "no inputs". `"exclude": []` overrides it.

### 4. `asHeroVariant` narrows through the picker's own option list

The third admin error was real. `homeConfig` is one array of entries of every kind, so an entry's `variant` is typed `SectionLayout` — a union that includes `GRID`, which is not a hero layout. `find((s) => s.key === 'HERO')` does not narrow it, and the code assigned the result to `HeroVariant`.

Narrowing through `HERO_VARIANT_OPTIONS` rather than a hand-written list of members: that array is already the picker's single source of valid hero layouts, so a layout added or withdrawn there cannot leave the guard behind. The file records `SPLIT_ONE` being withdrawn for exactly this reason — a stored value the backend now refuses. Such a value resolves to the registry default rather than crashing, which is the only sensible render.

### 5. The runbook records the failure, not the happy path

Four of the five blockers produced no error, or an error naming the wrong thing:

- `ALTER DATABASE` without permission returns success and changes nothing.
- `bash: fork: Resource temporarily unavailable` means the command never ran at all — it reads as a MySQL failure.
- Bracketed-paste debris (`^[[200~`) corrupts a pasted command.
- `tables exist: 0` in phpMyAdmin's SQL tab, when the tables plainly exist, because `DATABASE()` is empty there — and the three checks after it then pass vacuously.

So §3.1 moved to phpMyAdmin, §5.4 gained a pure-SQL equivalent of the verify script, and §11 gained a row per failure. The guiding rule: a runbook step that can fail silently must say what silence looks like.

## Risks / Trade-offs

**The storefront blocker recurs under a different package** → any newly hoisted dependency that Turbopack externalises reproduces it. Mitigated only by the documented grep; nothing enforces it. This is the accepted risk in the proposal.

**`tsconfig.app.json` and `tsconfig.test.json` drift apart** → a file matched by neither project is type-checked by nothing, silently. Mitigated by a comment in both files stating the obligation, which is the same mechanism this repo uses for the two frontends mirroring backend limits.

**`transpilePackages` changes how `sanitize-html` is compiled** → it is now processed by Turbopack rather than loaded as-is. Its 24 storefront test files pass unchanged, and the sanitiser was exercised directly against the standalone tree (`<p>হ্যালো<script>…</script></p>` → `<p>হ্যালো</p>`), so the allowlist behaviour is intact.

**The runbook is now longer** → more to read on a host where reading is expensive. Accepted: every addition is a failure that actually occurred during this deployment, and the alternative is rediscovering it.

## Migration Plan

Nothing to migrate. All five changes take effect on the next build:

1. `npm run build:cpanel` in `server/` — the archive now contains `scripts/`.
2. `npm run build:cpanel` in `nextjs/` — run the externals grep from Decision 1 before uploading.
3. `npm run build` in `admin/` with `VITE_API_BASE_URL` and `VITE_STOREFRONT_URL` set.
4. On the host, remove the old files before extracting a storefront build: Next's chunk names change per build, and `tar -xzf` overwrites but does not delete.

**Rollback:** revert the files. No data, schema or deployed state depends on any of it.

## Open Questions

- Whether a CI step that boots the standalone output is worth its runtime. It is the only thing that would have caught either storefront blocker, and it would have caught both on the first build.
- Whether other hoisted packages are one import away from the same fault. The grep answers it per build; nothing answers it in advance.
