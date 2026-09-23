## Why

**Uploading a logo today does nothing.** `UI → Site Setting` offers a Header logo and a Footer logo slot, uploads them to Cloudinary, stores them on `StoreSetting.logoUrl` / `footerLogoUrl`, and publishes both on `GET /settings/public` — and then neither storefront component reads them. `Header.tsx` renders `{storeName}{siteNameAccent}` as text unconditionally; `Footer.tsx` renders the same pair as an `<h4>`. Nothing in `nextjs/src/` references `logoUrl` outside the unrelated SEO `structuredData.organization` block.

So the admin's own help text — *"With no footer logo set, the header's is used; with neither, the site name is shown as text"* — describes a fallback chain that has never run. A merchant uploads their artwork, saves, reloads the storefront, and sees the wordmark. There is no way to tell a broken upload from a feature that was never wired up.

Beyond wiring it up, merchants need the two slots decided **independently**. A header sitting on the brand colour usually wants the logo; a footer on the dark bar often reads better as the wordmark — or the reverse. Inferring the mode from "is an image uploaded" cannot express that: choosing text for the footer would mean deleting the footer artwork, which then makes the header's logo fall through into the footer.

## What Changes

### Each brand slot gets an explicit mode

- Two new settings — a **header brand mode** and a **footer brand mode** — each `LOGO` or `TEXT`, chosen independently on `UI → Site Setting`.
- `TEXT` renders the wordmark (`storeName` + accent-coloured `siteNameAccent`), exactly as both surfaces render today.
- `LOGO` renders that slot's image. The mode is what decides; an uploaded image is not itself a trigger, so a merchant can keep footer artwork on file while showing text.
- **Both default to `TEXT`**, which is precisely what every storefront renders today. The migration is additive and changes nothing on its own — no existing store's header or footer moves.

### The logos are actually rendered

- `Header.tsx` and `Footer.tsx` render an image in `LOGO` mode, wrapped in the same home link and carrying the wordmark as its `alt` text so the brand is still announced to a screen reader and still readable if the image fails.
- The footer keeps the documented fallback, now real: footer logo, else header logo, else text.
- **`LOGO` with no image available degrades to the wordmark rather than to a blank slot.** The brand block sits on every page of the site; an empty one is worse than the text it replaced.

### Merchant-set logo height

- Two new values — a header logo height and a footer logo height, in pixels, bounded and independent. Width is always automatic, so any aspect ratio works without re-cutting artwork.
- The height is applied as a reserved CSS box, so a logo that loads late cannot shift the page under a shopper who has already started reading.
- Defaults reproduce sensible header/footer sizing, so a merchant who never opens the field gets a correct result.

### Admin

- The Logos section on `UI → Site Setting` gains a mode selector per slot and a height field per slot, and its description is corrected — it currently documents behaviour that does not exist.
- The page keeps writing its own disjoint key set through the partial `PATCH /settings`, per the settings-editor rule; the new keys join that set and no other editor's keys are touched.

**Not breaking.** Existing rows keep their logos and gain `TEXT` for both modes, reproducing current rendering exactly. `GET /settings/public` gains four fields and removes none.

## Capabilities

### New Capabilities

- `storefront-branding`: how the storefront's header and footer each decide between the wordmark and a logo image — the two independent modes, which artwork each slot resolves to and its fallback order, the degradation when a mode names an image that is not there, logo sizing and its layout-stability guarantee, the accessible name a logo carries, and how the merchant edits all of it from one screen.

### Modified Capabilities

None. The existing header/footer chrome and the `logoUrl` / `footerLogoUrl` fields were specified in `server/openspec/changes/add-checkout-and-site-settings/`, a change-local delta that was never synced into a root `openspec/specs/` capability — there is no root spec whose requirements change. The capability above carries the branding requirements going forward, including the previously-unimplemented logo rendering.

## Impact

**server/**
- `prisma/schema/StoreSetting.prisma`: four additive columns (two modes, two heights) plus a new enum for the mode, and a doc-comment correcting the current "two logos" note — it describes a fallback the storefront never ran. One migration — **strip the three `DROP INDEX` lines and carry the NOTE block forward**, per `CLAUDE.md`.
- `store-setting.validation.ts`: the four new keys, heights bounded (Postgres cannot express the range). `.optional()` only — none of these has a third "unset" state.
- `store-setting.constant.ts`: the new keys on `DEFAULT_PUBLIC_SETTINGS`.
- `store-setting.service.ts`: the four fields join the public projection's per-key merge.
- `scripts/verify-site-settings.ts` extended; the modes and the fallback order are worth their own verify script.

**nextjs/**
- `src/types/store-settings.ts` and `src/services/store-settings.ts`: the new fields plus their `FALLBACK_SETTINGS` entries, which must mirror the backend defaults.
- `src/components/layout/Header.tsx` and `Footer.tsx`: the brand slot becomes mode-driven. This is the first place either file renders a logo at all.
- A shared brand-slot resolution helper, so the two components cannot disagree about the fallback order.

**admin/**
- `src/lib/api/store-settings.ts`: the new fields on the settings type and input, plus mirrored `DEFAULT_*` constants and bounds — the admin cannot otherwise distinguish "not configured" from "configured to the default".
- `src/features/ui/site-settings/site-settings-page.tsx`: mode selector and height field per slot; corrected section description.

**Public API**: `GET /settings/public` and the admin `GET /settings` gain four fields. `PATCH /settings` accepts four more keys. No removals, no changed shapes.
