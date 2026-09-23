## Why

The storefront typeface is set by pasting a raw Google Fonts embed into a free-text box on **UI → Site Setting** (`theme.font`). Every font change is a fresh paste: the merchant must leave the admin, find the font on fonts.google.com, copy the right snippet, and hope the server accepts it. Nothing is remembered, so switching back to a font used last month means going and fetching it again. There is no way to compare options, and a typo surfaces only as a red toast after saving.

The admin panel meanwhile has **no font control at all** — its typeface is hardcoded to Roboto in three disconnected places (`admin/index.html`, `admin/src/index.css`, `admin/src/lib/antd-theme.ts`) and never reads any setting.

This change turns a one-shot paste into a **reusable font library**: the merchant pastes a font once, it stays available forever, and both the storefront and the admin panel pick from that library with radio buttons.

## What Changes

### A merchant-managed font library

- New `Font` model and `/fonts` module: a merchant-owned catalogue of Google Fonts. Adding a font is the *same* paste flow that exists today (`@import` rule, `<link>` tag, or bare URL), routed through the **existing, unchanged** `parseGoogleFontEmbed` parser — the paste moves from the Site Setting page to the font library, it is not reinvented.
- New admin screen **UI → Fonts** (`/ui/fonts`), a standard `ResourceListPage` with create/edit/delete.
- The library is **seeded at boot with ten fonts** — Outfit, Inter, Roboto, Poppins, Nunito, Lato, Montserrat, Open Sans, Manrope and Hind Siliguri (Bangla script) — so the picker is useful on day one. Seeded rows are ordinary rows: editable and deletable, with no protected flag.

### Two independent font selections, picked by radio button

- **Storefront font** and **admin panel font** are separate selections, so the two surfaces may differ.
- On **UI → Site Setting**, the single free-text Font textarea is replaced by two radio-card groups listing the library, each card previewing the font in its own typeface. Selecting is one click; there is no paste box on this page any more.
- The storefront selection continues to live at `theme.font`, preserving the served `{family, url}` shape every downstream reader already depends on. The admin selection is a new sibling key, `theme.adminFont`.

### The admin panel becomes themeable

- The hardcoded Roboto `<link>` in `admin/index.html` is removed; the admin loads its stylesheet and family from the setting at runtime and writes them into the same `--font-sans` variable, mirrored into the antd token so shadcn and antd surfaces never disagree.
- Roboto stays as the first entry in the CSS fallback stack, so the panel is fully readable before the setting resolves and if the stylesheet never loads.

### Deleting a font in use is refused

- `DELETE /fonts/:id` returns **409** when the font is the current storefront or admin selection, naming which surface holds it. The admin escalates to a reassign dialog — pick a replacement, then delete — matching the delete convention already used across `ResourceListPage`.

### Also fixed here

- `nextjs/src/app/globals.css` line 1 unconditionally `@import`s the Outfit stylesheet on every page load regardless of the merchant's choice. It is a leftover from before the setting existed and is removed; the fallback stack already covers the pre-resolution frame.

**Not breaking.** `theme.font` keeps its stored and served shape, so existing rows, the public payload, and the storefront's `resolveFontStack` / `resolveFontHref` path are untouched. `PATCH /settings` continues to accept a pasted font string for backwards compatibility, alongside the new selection-by-id form.

## Capabilities

### New Capabilities

- `font-library`: the merchant-managed catalogue of Google Fonts — how a font is added (paste parsing, what is accepted, what is stored), listed, edited and deleted; the refusal to delete a font in use and the reassign path; and the boot-time seed.
- `font-selection`: how the storefront font and the admin panel font are each chosen from the library and applied to their surface — the two independent selections, the served payload shape, the fallback behaviour when a stylesheet fails or nothing is configured, and the requirement that neither surface flashes an unstyled or wrong typeface.

### Modified Capabilities

None. The theming behaviour this change extends is specified in `server/openspec/changes/add-checkout-and-site-settings/specs/storefront-cms/theming/spec.md`, which is a change-local delta that was never synced into a root `openspec/specs/` capability — there is no existing root spec whose requirements change. The two new capabilities above carry the font requirements going forward.

## Impact

**server/**
- `prisma/schema/Font.prisma` (new model) + one migration — **remember to strip the three `DROP INDEX` lines and carry the NOTE block forward**, per `CLAUDE.md`.
- New module `src/app/module/font/` (route, controller, service, validation, interface, constant) mounted in `src/app/routes/index.ts`.
- `src/app/module/store-setting/`: `store-setting.validation.ts` gains the by-id selection form for `theme.font` and the new `theme.adminFont`; `store-setting.constant.ts` gains `DEFAULT_ADMIN_FONT` and the seed list; `store-setting.service.ts` switches `theme` from a wholesale merge to a per-key merge so a row predating `adminFont` still resolves it.
- `google-font.ts` and `parseGoogleFontEmbed` are **reused unmodified**.
- Boot seed alongside `seedSuperAdmin()` — note this does **not** run on Vercel (`api.ts` never listens), so seeding must also be reachable as a script.
- New verify scripts; `scripts/verify-site-settings.ts` extended.

**admin/**
- New `src/lib/api/fonts.ts` + query keys; `src/lib/api/store-settings.ts` gains `adminFont` and the selection input shape.
- New `src/features/ui/fonts/` list + form pages, registered in **both** `src/routes/nav-config.ts` and `src/routes/app-router.tsx`.
- `src/features/ui/site-settings/site-settings-page.tsx`: font textarea → two radio-card groups.
- New runtime font provider; `admin/index.html` loses its Roboto `<link>`; `src/index.css` and `src/lib/antd-theme.ts` read the variable instead of a literal.

**nextjs/**
- `src/services/store-settings.ts` and `src/types/store-settings.ts` gain `adminFont` (carried, not applied).
- `src/app/globals.css` line 1 `@import` removed.
- `src/lib/theme.ts` and `src/app/layout.tsx` are unchanged — the storefront font path already works and this change deliberately does not disturb it.

**Public API**: `GET /settings/public` gains `theme.adminFont`; new `/fonts` endpoints (admin-authenticated for writes). No removals.
