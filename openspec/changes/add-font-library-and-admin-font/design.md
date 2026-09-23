## Context

See proposal.md — Why. The design-relevant facts about what already exists:

- **The paste parser is done and hardened.** `server/src/app/module/store-setting/google-font.ts` exports `parseGoogleFontEmbed(input) → {ok, value:{family,url}} | {ok:false, message}`. It matches the first absolute URL, requires `https:`, requires `hostname === "fonts.googleapis.com"` by *equality* (a `endsWith` would accept `fonts.googleapis.com.evil.test`), restricts the path to `/css2`/`/css`, validates family against `/^[A-Za-z0-9][A-Za-z0-9 -]{0,63}$/` and the axis spec against `/^[A-Za-z0-9,;.@+-]{1,200}$/`, then **rebuilds** the URL from validated parts with `display=swap` forced. `scripts/verify-site-settings.ts` covers it with host-lookalike, breakout and idempotence checks. **This change reuses it verbatim.** Nothing here re-opens font parsing security.
- **Its idempotence is load-bearing.** A bare URL is an accepted paste form, so `parse(parse(x).url).url === parse(x).url`. That is what lets a stored URL be re-fed through the same validation with no second, unvalidated path into the column.
- **The font lives in a Json blob.** `StoreSetting.theme Json?` holds `{background, foreground, brand, brandDark, accent, sale, maxWidth, font:{family,url}}`. Postgres does not constrain it, so `themeSchema` in `store-setting.validation.ts` is the only write gate and `nextjs/src/lib/theme.ts` re-validates on read anyway.
- **`themeSchema` is `.strict()` with every key required**, because the theme is one column written whole — a partial object would blank what it omits.
- **`fontSchema` is a `z.transform`: string in, `{family,url}` object out.** The wire write shape and the stored shape already differ.
- **The storefront render path works and is not the problem.** `layout.tsx` puts `--font-sans` on `<html>` via an inline style (beats any stylesheet rule regardless of cascade layer) and emits `<link precedence="default">` so React hoists and dedupes it in `<head>`.
- **The admin's own font is hardcoded Roboto in three places** — `index.html` `<link>`, `--font-sans` in `index.css`, and `fontFamily` in the static `antdTheme` object passed once to `<ConfigProvider>` in `main.tsx`.
- **Seeding does not run on Vercel.** `api.ts` exports the app without listening, so `seedSuperAdmin()` in `server.ts` never executes there.

## Goals / Non-Goals

**Goals:**

- One reusable font catalogue behind both surfaces, with paste happening in exactly one place.
- Two independent selections that cannot leave a surface pointing at a deleted font.
- The admin panel themed at runtime without a flash of the wrong typeface, across both shadcn/Tailwind and antd.
- Reuse `parseGoogleFontEmbed` unchanged; add no second parsing path.

**Non-Goals:**

- No self-hosted, uploaded, or non-Google fonts. The parser's host equality check is the security boundary and stays.
- No per-element typography control (headings vs body, sizes, weights). One family per surface.
- No font-weight/axis picker UI. Weights come from whatever embed was pasted; changing them means editing the font's embed.
- No live preview of the storefront inside the admin.
- Not touching `nextjs/src/lib/theme.ts` or the storefront's render path beyond deleting the stray `@import`.

## Decisions

### 1. `Font` is a real table, not an array inside the `theme` blob

The library could have been a Json array on `StoreSetting`, avoiding a migration. Rejected: the library needs list/search/paging/edit/delete, which is exactly what `ResourceListPage` gives for a table-backed resource and nothing gives for a blob. A blob would also make "is this font in use" a read-modify-write on the same row being edited.

```prisma
model Font {
  id        String   @id @default(uuid())
  family    String   @unique   // "Open Sans", human-readable with spaces
  url       String              // rebuilt by parseGoogleFontEmbed, never merchant text
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
}
```

`family` carries the unique constraint, so duplicate rejection is enforced by the database rather than a racy pre-check. Case-insensitive comparison is done by the service before insert; the constraint is the backstop.

**Migration warning applies**: per CLAUDE.md, the generated SQL will contain `DROP INDEX` for the three `pg_trgm` indexes. Delete those three lines and carry the NOTE block forward from the most recent migration.

### 2. The selection stays in `theme`, storing the same `{family, url}` shape it stores today

`theme.font` keeps its exact stored and served shape; `theme.adminFont` is a new sibling with the same shape. **The selection is denormalised — the family and URL are copied into the theme, not referenced by font id.**

Alternative considered: store `theme.fontId` and join. Rejected for two reasons that matter more than the duplication:

1. **The storefront read path stays untouched.** `resolveFontStack`, `resolveFontHref`, `layout.tsx`, the public payload contract and the storefront's `FALLBACK_SETTINGS` merge all already consume `{family,url}`. A foreign key would force a join into `getPublicStoreSetting` and a shape change through three packages for zero user-visible gain.
2. **A dangling reference degrades worse.** A stale `{family,url}` still renders a real font; a dangling id renders nothing.

The cost is that editing a font's embed must propagate to any surface selected on it — handled in Decision 4.

`themeSchema` is `.strict()` with all keys required, so adding `adminFont` means every writer must send it. `store-setting.service.ts` currently merges `theme` **wholesale** (`merge(stored?.theme, DEFAULT.theme)`) unlike its neighbours; this change switches it to a per-key merge with a nested merge for both font keys, so a row written before `adminFont` existed resolves the default instead of serving the key absent. This mirrors the repair `nextjs/src/services/store-settings.ts` already performs on its side.

### 3. `PATCH /settings` accepts a font as a family name selection, and still accepts a paste

The write shape for `theme.font` / `theme.adminFont` becomes a **union**:

- `{ family: string }` — the selection form. The service looks the family up in `Font` and copies `{family, url}` from the row. An unknown family is a 400.
- `string` — the legacy paste form, still routed through `fontSchema` / `parseGoogleFontEmbed`.

Keeping the string arm is what makes this non-breaking: existing API consumers, the Postman collection and `verify-site-settings.ts`'s existing assertions keep working unchanged. The admin UI only ever sends the selection form.

Because the lookup is a DB read, it cannot live in Zod (per the module conventions: Zod is shape-only, DB-dependent invariants belong in the service, transactionally). Zod validates the union's *shape*; the service resolves the family to a row inside the same transaction as the settings upsert.

### 4. Editing a font's embed propagates to the surfaces using it, in one transaction

Because the selection is denormalised (Decision 2), `PATCH /fonts/:id` must, in a single transaction: update the row, then — if `theme.font.family` or `theme.adminFont.family` equals that font's family — rewrite the corresponding `url` in `theme`. Otherwise a merchant who edits Poppins to add a weight would see nothing change until they re-selected it.

Renaming the family (pasting an embed for a *different* family into an existing row) is treated the same way: both `family` and `url` are rewritten on the selected surfaces.

### 5. Delete-in-use is a 409 the client cannot pre-empt

`DELETE /fonts/:id` checks whether the font's family matches either selection and, if so, throws `AppError(409, ...)` naming the surfaces. This follows the established convention stated in CLAUDE.md: **the client never decides whether something is in use** — the server refuses and the UI escalates.

The response body carries which surfaces hold the font so the reassign dialog can be specific. The reassign flow is **not** a new endpoint: the admin sends `PATCH /settings` with the replacement, then retries the `DELETE`. Two calls, each already idempotent-safe, in place of a bespoke transactional endpoint.

Trade-off accepted: a crash between the two calls leaves the selection reassigned but the old font still in the library — harmless and self-evident, versus the alternative of never deleting. The spec's "not left partly changed" requirement is satisfied because neither call is itself partial.

### 6. The starter fonts seed follows `seedStoreSettings`, and gets a script

Ten fonts as a constant array of embed URLs, each run through `parseGoogleFontEmbed` at seed time so the seed cannot introduce a value the API would have rejected. Inserted with `createMany({ skipDuplicates: true })` keyed on the unique `family`, which gives idempotence and — critically — **does not resurrect a font the merchant deleted**... except that `skipDuplicates` alone *would* reinstate deletions on the next boot.

To satisfy the spec's "a starter font the merchant deleted is not silently reinstated": the seed runs **only when the `Font` table is empty**. An empty table means first run; a non-empty one means the merchant owns the library. This is the simplest rule that satisfies both idempotence requirements without a "seeded once" marker row.

The list includes **Hind Siliguri** for Bangla script, alongside Outfit, Inter, Roboto, Poppins, Nunito, Lato, Montserrat, Open Sans and Manrope.

Since `seedSuperAdmin()` never runs on Vercel, the seed is also exposed as `server/scripts/seed-fonts.ts` runnable with `npx tsx`.

### 7. The admin applies its font by writing a CSS variable, and re-renders `ConfigProvider`

The panel needs one font to reach two independent styling systems. The mechanism:

- `index.html`'s Roboto `<link>` is deleted. `index.css` keeps `--font-sans` but with **Roboto first in the fallback stack** — so the panel looks exactly as it does today before the setting resolves, and if the stylesheet never loads. `body { font-family: var(--font-sans) }` is unchanged.
- A provider mounted in `main.tsx` fetches the settings, then (a) sets `--font-sans` on `document.documentElement` and (b) injects/updates a single `<link rel="stylesheet">` for the font URL, keyed by a stable id so repeated changes replace rather than accumulate.
- `antdTheme` becomes a **function** `buildAntdTheme(fontFamily)`; `ConfigProvider` receives `useMemo(() => buildAntdTheme(family), [family])`. antd reads `token.fontFamily` at render, not from CSS, so the variable alone would leave every antd form in Roboto while the rest of the panel changed — which the spec forbids ("no section left in the previous one").

Both values pass through the same validation as the storefront's: a `resolveFontStack` / `resolveFontHref` pair mirroring `nextjs/src/lib/theme.ts`. The stored blob is unconstrained by Postgres, so the admin re-validates before use exactly as the storefront does.

Alternative considered: server-side injection into `index.html`. Impossible — the admin is a static Vite bundle with no server render step.

### 8. Radio cards, previewed in their own typeface

The picker renders one card per library font with the family name set in that font. Rendering the preview requires the stylesheet to be loaded, so the picker injects a `<link>` per library font while mounted. With a ~10-30 font library that is acceptable; the links are removed on unmount.

The `useSettingsDraft` / `useUnsavedChangesGuard` pattern is kept as-is — the draft holds `{font: {family}, adminFont: {family}}` and `markSaved` runs after a successful `PATCH`.

**Partial-PATCH discipline**: the Site Setting editor already owns the whole `theme` key, so adding `adminFont` to its payload does not encroach on any other editor's disjoint key set.

## Risks / Trade-offs

- **Denormalised selection can drift from the library** → Decision 4 propagates edits inside the same transaction; Decision 5 blocks the delete that would strand it. A drifted value still renders a real font, so the failure mode is stale, not broken.
- **`themeSchema` is `.strict()` and now requires `adminFont`** → any writer omitting it gets a 400. The Site Setting editor is the only writer; the Postman collection and verify scripts must be updated in the same change, and `DEFAULT_THEME` in all three packages gains `adminFont` together.
- **Three copies of `DEFAULT_THEME`** (server constant, admin api module, storefront fallback) with nothing enforcing agreement — a known standing issue this change makes marginally worse by adding a key. Mitigated only by updating all three in one task and asserting the shape in `verify-site-settings.ts`.
- **The admin fetches settings before first paint** → a brief moment in the Roboto fallback. Accepted: it is the current appearance, so it reads as normal rather than as a flash of something wrong.
- **The picker loads every library font's stylesheet** → bounded by library size, admin-only, and torn down on unmount. If a merchant grows the library past ~50 fonts this wants lazy loading; not built now.
- **Migration will try to drop the trigram indexes** → the standing repo-wide hazard. Task list makes stripping them an explicit step.
- **Seeding is skipped on Vercel** → `scripts/seed-fonts.ts` is the documented manual path. If nobody runs it, the library is empty and the pickers show nothing but the current selection — degraded, not broken.

## Migration Plan

1. Ship the `Font` table and module first; it is additive and inert until something selects from it.
2. Ship the `theme.adminFont` key with a default, and the per-key merge on read — old rows resolve the default, so no backfill is needed.
3. Ship the admin runtime font provider (defaults to Roboto until a selection exists), then the pickers.
4. Delete `globals.css` line 1 last, once the storefront is confirmed serving the selected font's `<link>`.

**Rollback**: the string arm of the font union is retained throughout, so reverting the admin UI to the paste textarea requires no server change. `theme.adminFont` becoming unread is inert. The `Font` table can be left in place.

## Open Questions

- Whether the starter list should be regionally weighted beyond the single Bangla face (e.g. adding Baloo Da 2 or Tiro Bangla). Deferred: the list is a constant, adding to it changes no spec, no schema and no task structure.
