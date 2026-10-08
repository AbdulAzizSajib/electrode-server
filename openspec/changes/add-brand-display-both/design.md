## Context

`add-header-footer-brand-display` built the brand slots. They work like this today:

- `StoreSetting.headerBrandMode` and `footerBrandMode` are each a `BrandDisplayMode` enum (`TEXT | LOGO`). On MySQL that is a native `ENUM('TEXT','LOGO')` column, created in `20260930000000_init`.
- One pure resolver decides what a slot draws: `nextjs/src/lib/brand-slot.ts` `resolveBrandSlot`. It returns `{ kind: "text" }` or `{ kind: "logo", src, height, alt }`.
- Three components consume it, and each styles the wordmark its own way:
  - `Header.tsx`: two-colour, `storeName` plus `text-accent` `siteNameAccent`, inside a home `<Link>`;
  - `Footer.tsx`: `brandName` inside an `<h4>`;
  - `LandingBrand.tsx`: `text-lp-accent`, inside a `<p>`.
- `server/scripts/verify-brand-display.ts` duplicates the resolver's matrix on purpose, so the two packages must agree.
- In the admin, `BrandModeField` is a row of `aria-pressed` buttons. The logo upload and height fields are gated on `mode === 'LOGO'`.

See proposal.md for why `BOTH` is wanted and specs/storefront-branding for the required behaviour.

## Goals / Non-Goals

**Goals:**
- One more enum value, carried through every layer that names the enum. No second flag.
- Every consumer renders `BOTH` from the same resolver result, so the three cannot disagree about fallbacks.
- Each component keeps its own wordmark styling in `BOTH`. The name next to the logo looks exactly like that slot's name alone.

**Non-Goals:**
- **No layout options for `BOTH`.** There is no "name under logo", no separate size for the name and no gap setting. It is side by side, logo first. Adding stacking later would be a new enum value or a new column, which this design does not rule out.
- **No change to the `TEXT` and `LOGO` paths.** Their markup is unchanged.
- **No change to the copyright line in the footer.** It already prints the name in every mode.

## Decisions

### Decision 1: `BOTH` is a third enum value, appended last

`BOTH` is added to `BrandDisplayMode` rather than a separate `showWordmarkWithLogo` boolean. The enum's own doc comment reserved this. A boolean would create an invalid fourth state (`TEXT` + show-wordmark) that every reader would have to define away.

It is appended **after** `LOGO`, not inserted. MySQL stores an `ENUM` by index:

- Appending a value at the end is an in-place metadata change on InnoDB, and existing rows' stored indexes keep their meaning.
- Reordering would rewrite the table and, in the worst case, remap stored values.

### Decision 2: The migration is written by hand, not generated against the live database

The repository's practice is that the user runs database commands themselves. The migration is one statement per column:

```sql
ALTER TABLE `StoreSetting`
  MODIFY `headerBrandMode` ENUM('TEXT', 'LOGO', 'BOTH') NOT NULL DEFAULT 'TEXT',
  MODIFY `footerBrandMode` ENUM('TEXT', 'LOGO', 'BOTH') NOT NULL DEFAULT 'TEXT';
```

The statement is exactly what `prisma migrate diff` emits for this schema change, and it is checked with that command before being committed. The header comment follows the convention of the most recent migration (`20261008000000_…`): what it changes, that it is additive, and how to mark it applied on a database already altered by hand (`migrate resolve --applied`).

### Decision 3: The resolver keeps `kind: "logo"` and adds `withWordmark`

`ResolvedBrand` becomes:

```ts
| { kind: "text" }
| { kind: "logo"; src: string; height: number; alt: string; withWordmark: boolean }
```

`BOTH` with resolved artwork returns `kind: "logo"` with `withWordmark: true` and **`alt: ""`**. Every other case is unchanged: `LOGO` returns `withWordmark: false` and the name as `alt`, and an unresolved `BOTH` returns `{ kind: "text" }` by the existing rule 3.

The alternative was a third `kind: "both"`. It was rejected because every consumer already writes `brand.kind === "logo" ? <img/> : <text/>`. A ternary on an open union does not fail to compile on a new member; it silently routes `"both"` into the text branch. With `withWordmark` on the logo branch, a consumer that is not updated still shows the logo, and only the name beside it is missing. That is a visible, smaller failure, and the tests catch it.

`alt: ""` is decided **in the resolver**, not in each component, because "the name is announced once" (spec) is a rule about the slot. Left to three components, it would be remembered in two.

### Decision 4: Rendering is logo, then the slot's existing wordmark fragment, in one flex row

Each component renders its existing logo branch. When `withWordmark` is true, it then renders the **same JSX it already uses for the text branch**, inside `inline-flex items-center gap-2` (header and footer) or `gap-3` (landing, which is centred). The text fragment is lifted into a local variable so the `TEXT` branch and the `BOTH` branch render one definition, not two copies.

Narrow screens, header only (spec: "a narrow screen"):

- The image keeps `shrink-0` and the wordmark gets `min-w-0 truncate`.
- At 320px a long shop name therefore ends in an ellipsis instead of pushing the account and menu buttons off the row.
- The `<Link>` keeps its existing classes; only the inner row is new.

### Decision 5: The admin shows three buttons and treats "shows a logo" as `mode !== 'TEXT'`

- `BrandModeField` gains `{ value: 'BOTH', label: 'Both' }`.
- The four conditions that currently read `=== 'LOGO'` (upload field, "no logo set" warning, for header and footer) become one helper, `showsLogo(mode)`, so a fourth mode later changes one line.
- The Branding section's description is updated to name the third option and to say that "Both" with no image shows the name alone.
- `DEFAULT_BRAND_DISPLAY` is unchanged (`TEXT`), and the editor's disjoint key set is unchanged: no new keys, only a new value.

## Risks / Trade-offs

- **Server deployed before the migration.** Prisma would write `BOTH` into a two-value column, and MySQL strict mode rejects it, so the save fails. → The migration runs first (Migration Plan). The validation rejects `BOTH` until the code ships, so the admin cannot send it early.
- **Storefront older than the server.** The old resolver's `mode !== "LOGO"` sends `BOTH` to the wordmark. → Degraded but truthful: the name shows and the logo does not. Deploy the storefront with the server.
- **A cached public-settings payload carries `BOTH` before the new storefront is live.** This is the same degradation as the previous risk, and it clears on the next revalidate.
- **Long name plus wide logo on a phone.** → Truncation (Decision 4). A merchant who wants the full name on phones uses `TEXT`.
- **The resolver is duplicated in the verify script.** → The script's matrix is extended in the same change. It exists to fail when the two diverge.

## Migration Plan

1. Merge the schema and migration. The user runs `npx prisma migrate deploy` (or `migrate resolve --applied` on a database already altered by hand).
2. Deploy the server, which now accepts `BOTH`, and the storefront, which now renders it, together.
3. Deploy the admin. Until then the third button does not exist, so nothing sends `BOTH`.

**Rollback:**
- Revert the admin and storefront first.
- Before reverting the server, reset any slot set to `BOTH` (`UPDATE StoreSetting SET headerBrandMode='LOGO' WHERE headerBrandMode='BOTH'`, and the same for the footer).
- Only then narrow the enum. Narrowing it with `BOTH` rows present fails under strict mode.
