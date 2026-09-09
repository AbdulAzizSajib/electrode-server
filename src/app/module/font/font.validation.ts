import z from "zod";
import { MAX_FONT_EMBED_LENGTH } from "./font.constant";

/**
 * Shape only. Deliberately does NOT parse the embed.
 *
 * The obvious move here is to reuse `fontSchema` from store-setting.validation
 * — a `z.transform` that runs parseGoogleFontEmbed and yields `{ family, url }`
 * — so a bad paste is rejected by Zod before the controller runs. It is not
 * used, for two reasons:
 *
 *  1. The service needs the parsed family to check for a duplicate, and that
 *     check is a database read. Module convention puts DB-dependent invariants
 *     in the service, transactionally, not in validation. Splitting the parse
 *     across both layers would mean parsing twice or passing a half-validated
 *     value between them.
 *  2. `validateRequest` REPLACES req.body with the parsed output. A transform
 *     here would hand the controller `{ embed: { family, url } }` — an embed
 *     key holding something that is not an embed — which reads as a mistake at
 *     every later call site.
 *
 * So this bounds the input and the service parses it. The parser is still the
 * only thing that decides what is acceptable; nothing about the security
 * boundary moves.
 */
const embedSchema = z
    .string()
    .min(1, "Paste the embed code from Google Fonts.")
    .max(
        MAX_FONT_EMBED_LENGTH,
        `That embed is too long — paste just the @import rule, the <link> tag, or the URL (max ${MAX_FONT_EMBED_LENGTH} characters).`,
    );

export const createFontZodSchema = z.object({
    embed: embedSchema,
});

/**
 * Not `.partial()`, unlike every other update schema in this codebase.
 *
 * `family` and `url` both come out of one parse of one field, so there is no
 * subset of a font to patch — an update with no embed would be a no-op. See
 * IUpdateFontPayload.
 */
export const updateFontZodSchema = z.object({
    embed: embedSchema,
});
