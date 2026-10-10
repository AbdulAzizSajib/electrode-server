## 0. Prerequisite

- [x] 0.1 Archive `add-header-footer-brand-display` (all its tasks are complete) so the main `storefront-branding` spec exists for this change's MODIFIED deltas. Verify with `openspec validate add-brand-display-both`, which must pass.

## 1. Schema and migration (server)

- [x] 1.1 Append `BOTH` after `LOGO` in `enum BrandDisplayMode` (`prisma/schema/enums.prisma`), not inserted, per design.md Decision 1. Update the enum's doc comment: the third variant it anticipated now exists. Verify `npx prisma validate` passes.
- [x] 1.2 Update the `headerBrandMode`/`footerBrandMode` doc comment in `StoreSetting.prisma` to describe three modes. Verify by reading it back against the spec's "decided independently" requirement.
- [x] 1.3 Hand-write `prisma/migrations/<timestamp>_add_brand_display_both/migration.sql`:
  - two `MODIFY … ENUM('TEXT','LOGO','BOTH') NOT NULL DEFAULT 'TEXT'` clauses;
  - a header comment in the style of `20261008000000_…`, which says it is additive and gives the `migrate resolve --applied` fallback.

  Verify the SQL matches what `npx prisma migrate diff --from-migrations prisma/migrations --to-schema prisma/schema --script` emits for this change. **Do not run it against the database; the user applies it.**

## 2. Backend module (server)

- [x] 2.1 Widen both `z.enum(["TEXT", "LOGO"], …)` in `store-setting.validation.ts` to include `BOTH`, and update their messages. Verify that `BOTH` parses and `"BOTH_X"` is rejected with the message.
- [x] 2.2 Update the doc comment on the mode fields in `store-setting.interface.ts`. `DEFAULT_PUBLIC_SETTINGS` stays `TEXT`. Verify the server type-checks with `npx tsc --noEmit -p tsconfig.json`.
- [x] 2.3 Extend `scripts/verify-brand-display.ts`:
  - mirror the new resolver: `BOTH` resolves to the logo with `withWordmark: true` and `alt: ""`, or to text when there is no artwork;
  - add a persistence round-trip that saves `BOTH` and confirms the other slot is untouched.

  Verify with `npx tsx scripts/verify-brand-display.ts` after the migration is applied (the user runs it).

## 3. Storefront (nextjs)

- [x] 3.1 Add `"BOTH"` to `BrandDisplayMode` in `src/types/store-settings.ts` and update its doc comment. Verify `npx tsc --noEmit` passes.
- [x] 3.2 In `src/lib/brand-slot.ts`:
  - add `withWordmark` to the logo variant of `ResolvedBrand`;
  - resolve `LOGO` and `BOTH` through the same artwork chain, with `alt: ""` when `withWordmark` is true;
  - update the header comment's three rules to cover `BOTH` (design.md Decision 3).

  Verify with the tests in 3.3.
- [x] 3.3 Extend `src/lib/brand-slot.test.ts`:
  - `BOTH` with header art in the header;
  - `BOTH` in the footer borrowing the header's art;
  - `BOTH` with no art giving text;
  - `alt === ""` only when `withWordmark` is true;
  - `LOGO` unchanged, with `withWordmark: false`.

  Verify `npm run test --workspace nextjs -- src/lib/brand-slot.test.ts` passes.
- [ ] 3.4 `Header.tsx`:
  - lift the existing two-colour wordmark into one local fragment;
  - when `brand.withWordmark`, render logo then fragment in an `inline-flex items-center gap-2` row, with `shrink-0` on the image and `min-w-0 truncate` on the name (design.md Decision 4).

  Verify `TEXT` and `LOGO` render byte-identical markup to before, and that at 320px with a long name the account and menu buttons stay on the row.
- [ ] 3.5 `Footer.tsx`: same pattern inside the existing `<h4>`, reusing `brandName`. Verify the `<h4>`'s accessible name is the shop's name once in `BOTH`.
- [ ] 3.6 `LandingBrand.tsx`: same pattern, centred with `gap-3`, keeping `text-lp-accent`. Verify an `/offer/<slug>` page with the header set to `BOTH` shows logo and name.
- [ ] 3.7 Run `npm run lint --workspace nextjs` and `npx tsc --noEmit` in `nextjs/`; both must be clean.

## 4. Admin (admin)

- [x] 4.1 Add `'BOTH'` to `BrandDisplayMode` in `src/lib/api/store-settings.ts`. Verify the admin type-checks with `npx tsc --noEmit -p tsconfig.app.json`.
- [x] 4.2 In `site-settings-page.tsx`:
  - add `{ value: 'BOTH', label: 'Both' }` to `BrandModeField` and update its doc comment ("three options");
  - replace the four `=== 'LOGO'` gates with a `showsLogo(mode)` helper.

  Verify that choosing Both reveals the logo upload, height and "no logo set" note for that slot only.
- [x] 4.3 Update the Branding section description to name the third option and that "Both" without an image shows the name alone. Verify the copy matches the resolver's actual fallbacks.
- [x] 4.4 Run `npx eslint` on the changed admin files and the admin vitest suite. Both must pass.

## 5. End to end

- [ ] 5.1 With the migration applied and all three apps running, set the header to Both and the footer to Site name, save, and verify:
  - the storefront header shows logo and name;
  - the footer shows the name only;
  - after reloading the admin page, both buttons stay selected (the round-trip persisted);
  - the storefront updates without waiting for the cache window (the `store-settings` tag fires).
- [ ] 5.2 Set the footer to Both with no footer logo and verify it shows the header's logo plus the name. Then clear the header logo too and verify both slots fall back to the name alone with no broken image.
