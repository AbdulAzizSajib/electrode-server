## Context

See proposal.md — Why. The load-bearing fact for this design: `logoUrl` and `footerLogoUrl` already exist end-to-end — column, Zod schema, public projection, admin upload widget — and **only the render step is missing**. `nextjs/src/components/layout/Header.tsx` renders `{storeName}{siteNameAccent}` unconditionally at its brand link; `Footer.tsx` does the same in an `<h4>`. Neither file mentions `logoUrl`.

That shapes the work: the backend change is four additive columns, not a new subsystem, and the storefront change is a genuinely new render path in two components that have never drawn an image in their brand slot.

Constraints this design has to sit inside:

- **`StoreSetting` is a singleton** edited by seven admin editors sharing one partial `PATCH /settings`. They coexist only by sending **disjoint key sets** — `site-settings-page.tsx` already owns `logoUrl` / `footerLogoUrl` / `storeName` / `siteNameAccent` / `copyrightText` / `theme`, so the four new keys belong to that same editor and to no other.
- **`.optional()` vs `.nullable()`** is a real convention here: `.nullable().optional()` is reserved for columns with three meaningful states. None of these four has one.
- **Both frontends mirror backend limits** as local constants under an explicit obligation to keep them in step (`SETTINGS_LIMITS`, `CURRENCY_DECIMALS_LIMITS`, `FALLBACK_SETTINGS`).
- The admin read (`GET /settings`) returns the row as-is while the public read merges defaults, so each editor seeds from a mirrored `DEFAULT_*` constant to tell "not configured" from "configured to the default".

## Goals / Non-Goals

**Goals:**

- Wire the two existing logo columns through to an actual rendered image, for the first time.
- Make the header and footer brand slots independently switchable between wordmark and logo.
- Guarantee no existing storefront's rendering changes on deploy.
- Guarantee a brand slot is never blank, and never shifts the page as its image arrives.

**Non-Goals:**

- **A "logo + wordmark side by side" mode.** Two modes only. A third would need its own spacing, alignment and truncation rules in each of two components, for a layout the request did not ask for. Addable later without changing the stored shape — the field is an enum, not a boolean.
- **Per-breakpoint logos or heights.** One image and one height per slot; CSS handles small screens by scaling within the reserved box.
- **Dark/light-variant switching.** The two slots already exist precisely so a merchant can supply artwork per background; that is the mechanism, and it is enough.
- **Touching the mobile drawer, the landing-page route group, or the admin panel's own branding.** Out of scope; `(landing)` is deliberately bare chrome.
- **Reworking the upload pipeline.** Cloudinary + `useUploadImage` is reused unchanged.

## Decisions

### Decision 1: An enum column per slot, not a boolean and not a derived mode

`headerBrandMode` and `footerBrandMode`, each a Prisma enum `BrandDisplayMode { TEXT, LOGO }` defaulting to `TEXT`.

*Why not derive it from "is a logo uploaded"* — this is the alternative the request rules out. Under it, "footer shows text" is only expressible by deleting the footer artwork, which then makes the header's logo fall through into the footer by the documented fallback. The merchant's stated case — header logo, footer text — becomes unreachable. An explicit mode also means uploading artwork is never itself a publish action.

*Why not a boolean* (`headerShowsLogo`) — an enum leaves room for a third value later (`BOTH`) without a data migration, and reads correctly in the payload.

*Why two columns, not one JSON `brandingConfig` blob* — the existing branding fields on this row are flat columns (`logoUrl`, `siteNameAccent`, `copyrightText`); a blob would split branding across two storage styles for no gain. The Json columns on this row exist for *variable-shape* content (nav trees, footer columns); this is four scalars.

**Default `TEXT`, and that is the whole backwards-compatibility story.** Every existing storefront renders the wordmark today, so `TEXT` reproduces current behaviour exactly — including for a store that already uploaded logos, whose artwork simply becomes available rather than suddenly live. The migration is additive with no backfill.

### Decision 2: Heights as bounded Int columns, mirrored into both frontends

`headerLogoHeight` and `footerLogoHeight`, `Int` with defaults (header 40, footer 36), bounded **24–96** in Zod.

Postgres cannot express the range, so — exactly as with `currencyDecimals` — **Zod is the only gate**, and the bound is mirrored into the admin as a `LOGO_HEIGHT_LIMITS = { min, max, headerDefault, footerDefault }` constant so the number input bounds itself instead of surfacing a 400 the merchant has to decode. The storefront mirrors the defaults in `FALLBACK_SETTINGS`.

24 is roughly the floor at which a logo is still legible next to the header's text controls; 96 is above the header row's natural height, so anything larger is a layout the row was not built for rather than a bigger logo.

*Why store a height at all rather than a fixed CSS class* — merchant artwork varies enormously in padding and aspect ratio, and a fixed height that flatters a square mark starves a wide wordmark. This was the explicit choice made for this change.

*Why height-and-auto-width rather than stored intrinsic dimensions* — storing `width`/`height` per upload would mean probing the image at upload time, a new failure mode in the upload path, and re-probing on replace. Reserving a fixed height in CSS with `w-auto` gets the same layout-stability guarantee for none of that, and works for any aspect ratio.

### Decision 3: Layout stability comes from the reserved box, not from `next/image`

The brand slot renders a plain `<img>` with the configured height applied as an inline `height` style and `width: auto`, inside a container whose height is that same value.

The reserved height is what satisfies the spec's no-layout-shift requirement: the box is the right size before the bytes arrive, so the surrounding row never moves. `next/image` would want intrinsic `width`/`height` — which is precisely what Decision 2 declines to store — and would add a remote-pattern config entry per image host for a single small asset per page. The header is a client component and the footer a server component; a plain `<img>` behaves identically in both, which matters for Decision 4.

Trade-off accepted: no automatic format negotiation or responsive `srcset` for the logo. It is one small image, already served from Cloudinary's CDN.

### Decision 4: One shared resolver, so the two components cannot disagree

A single helper — given the settings and which slot is being rendered — returns either `{ kind: "text" }` or `{ kind: "logo", src, height, alt }`, applying:

1. mode is `TEXT` → text;
2. mode is `LOGO` → header resolves `logoUrl`; footer resolves `footerLogoUrl ?? logoUrl`;
3. no URL resolved → **text** (the never-empty guarantee).

The footer's fallback to the header's artwork is the behaviour the admin has been *describing* all along, and the reason it must live in one function is that it is the exact rule two separate components would otherwise each re-derive and drift on. Step 3 is why "logo mode with nothing uploaded" is a degraded render and not a blank brand block on every page of the site.

`alt` is always the composed wordmark (`storeName` + `siteNameAccent`), so the brand is announced identically in both modes and a failed image still conveys the shop's name. Both slots stay wrapped in their existing home link.

This mirrors the fallback convention already in force: chrome degrades when a degraded render is still truthful, and a wordmark instead of a logo is truthful.

### Decision 5: The new keys join the site-settings editor's existing disjoint set

All four are added to `site-settings-page.tsx`'s draft and to the key set it sends. No other editor gains or loses a key, so the partial-PATCH discipline holds by construction.

The heights are sent **unconditionally** as numbers, unlike the page's existing string fields which are omitted when blank — omitting a number would make "reset to default" inexpressible, and the value is always a valid in-range integer because the input bounds it. The modes are likewise always sent: a mode always has a value.

The section's description is corrected in the same edit. It currently documents a fallback chain that has never run; after this change it will be true, and it also has to explain that the mode — not the presence of artwork — is what decides.

## Risks / Trade-offs

- **A merchant switches to `LOGO`, has no artwork, and reads the resulting wordmark as "the setting didn't save".** → The admin shows the mode selector next to that slot's artwork preview, which reads `Not set`; the section description states that a logo mode with no image shows the site name. The degradation is documented where the decision is made, not only in the spec.
- **Artwork cut for a light header, shown on the dark footer via the fallback.** → Inherent to a fallback that exists precisely so the footer is never blank. The footer slot's own upload is the fix, and the admin already previews the footer logo on a dark swatch.
- **A very wide logo at a large height overflows the header row on a narrow viewport.** → The image is constrained by both the reserved height and a `max-width` within its flex track, so it scales down rather than pushing the row. The header's brand link already carries the responsive rules that keep it between the two mobile icon buttons; the logo renders inside that same box.
- **The four mirrored constants drift from the backend's.** → The same standing obligation this repo already carries for `SETTINGS_LIMITS` / `CURRENCY_DECIMALS_LIMITS` / `FALLBACK_SETTINGS`; the mirrored constants cite the backend symbol they mirror, as the existing ones do.
- **The migration silently drops the trigram indexes.** → The known repo-wide hazard: the generated SQL must have its three `DROP INDEX` lines deleted and the NOTE block carried forward from the most recent migration. Called out as its own task.

## Migration Plan

Additive and reversible in one direction without data loss:

1. Migrate: add `BrandDisplayMode` enum, two mode columns defaulting to `TEXT`, two height columns with defaults. **No backfill** — the column defaults are the intended value for every existing row.
2. Deploy backend. `GET /settings/public` gains four fields; older storefront builds ignore unknown keys, so backend-first is safe.
3. Deploy storefront and admin in either order. Until the storefront ships, the admin can set a mode that nothing reads yet — which is the status quo for logos today, so it is no worse.

**Rollback**: revert the app deploys; the columns can stay. With the storefront reverted, every slot renders the wordmark again regardless of stored mode — the pre-change behaviour — so no data needs undoing. Dropping the columns is only needed if the change is abandoned outright.

Deploy order note: the storefront's cached settings carry a 30s floor, and the backend fires `store-settings` revalidation on save, so a merchant's first mode change appears promptly rather than after the window.
