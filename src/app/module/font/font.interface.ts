/**
 * The font library's payloads.
 *
 * Note what is NOT here: a `family` or a `url` field. Both are derived by
 * parseGoogleFontEmbed from the pasted `embed`, never accepted from the
 * caller — a client that could set `url` directly would be a second, unchecked
 * path into a column the storefront interpolates into a stylesheet link. The
 * asymmetry is deliberate: callers write an embed, readers get
 * `{ family, url }`.
 *
 * See openspec/changes/add-font-library-and-admin-font, design.md Decision 1.
 */
export interface ICreateFontPayload {
    /**
     * Whatever Google Fonts hands the merchant — the `@import url(...)` rule,
     * the `<link ...>` tag, or the bare stylesheet URL. All three are accepted
     * paste forms; the parser matches the first absolute URL in the text.
     */
    embed: string;
}

/**
 * Update takes the same single field rather than `Partial<ICreateFontPayload>`.
 *
 * There is nothing else to patch: `family` and `url` both come out of one
 * parse, so editing means re-pasting an embed. An update carrying no embed
 * would be a no-op, which is why this is required rather than optional.
 */
export interface IUpdateFontPayload {
    embed: string;
}

/**
 * What every read returns. Mirrors the `Font` row.
 */
export interface IFontResult {
    id: string;
    /** Human-readable, with spaces — "Open Sans", never "Open+Sans". */
    family: string;
    /** Rebuilt by the parser from validated parts, with `display=swap` forced. */
    url: string;
    createdAt: Date;
    updatedAt: Date;
}

/**
 * Which surfaces currently select a given font.
 *
 * Returned with the 409 that refuses to delete a font in use, so the admin's
 * reassign dialog can name them specifically rather than saying "somewhere".
 * Both false means the font is free to delete.
 */
export interface IFontUsage {
    storefront: boolean;
    adminPanel: boolean;
}
