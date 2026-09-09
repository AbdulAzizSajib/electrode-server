import status from "http-status";
import { AuditAction, Prisma } from "../../../generated/prisma/client";
import AppError from "../../errorHelpers/AppError";
import { IQueryParams } from "../../interfaces/query.interface";
import { prisma } from "../../lib/prisma";
import { QueryBuilder } from "../../utils/QueryBuilder";
import { revalidateStorefront, STORE_SETTINGS_TAG } from "../../utils/revalidateStorefront";
import { AuditLogService } from "../audit-log/audit-log.service";
import { parseGoogleFontEmbed } from "../store-setting/google-font";
import { ICreateFontPayload, IFontUsage, IUpdateFontPayload } from "./font.interface";

/**
 * The font library.
 *
 * Two things here are load-bearing and easy to undo by accident:
 *
 *  1. **The parser is imported, never reimplemented.** `parseGoogleFontEmbed`
 *     already rejects non-HTTPS, non-`fonts.googleapis.com` (by host EQUALITY,
 *     so a lookalike suffix cannot slip through), non-stylesheet paths, and
 *     family/axis values outside a strict pattern — then rebuilds the URL from
 *     the validated parts rather than slicing the input. Every write path in
 *     this file funnels through it. A second path that sets `url` from raw text
 *     would defeat all of that.
 *
 *  2. **The selection is denormalised into StoreSetting.theme**, not a foreign
 *     key (design.md Decision 2). That keeps the storefront read path untouched
 *     and means a stale selection still renders a real typeface. The price is
 *     paid right here: `updateFont` must propagate a changed family/url to the
 *     surfaces selected on it, and `deleteFont` must refuse while selected.
 *     Both are below; neither is optional.
 *
 * See openspec/changes/add-font-library-and-admin-font.
 */

/**
 * The shape the theme blob stores per selection. Local to this file: the theme
 * is a Json column, so Prisma types it as JsonValue and nothing narrower is
 * available without asserting.
 */
type StoredFont = { family?: string; url?: string };
type StoredTheme = { font?: StoredFont; adminFont?: StoredFont } & Record<string, unknown>;

/**
 * Reads the two font selections off the singleton.
 *
 * Returns an empty object rather than throwing when the row or the theme is
 * missing — a store whose theme has never been written has no selection, which
 * is a legitimate state meaning "nothing is in use", not an error.
 */
const readThemeSelections = async (
    client: Prisma.TransactionClient | typeof prisma = prisma,
): Promise<{ theme: StoredTheme | null; font?: StoredFont; adminFont?: StoredFont }> => {
    const stored = await client.storeSetting.findUnique({
        where: { id: "singleton" },
        select: { theme: true },
    });

    const theme = (stored?.theme as StoredTheme | null) ?? null;

    return { theme, font: theme?.font, adminFont: theme?.adminFont };
};

/**
 * Case- and whitespace-insensitive, matching how the duplicate check compares.
 * A merchant who selected "Open Sans" and a row stored as "open sans" are the
 * same typeface as far as every surface is concerned.
 */
const sameFamily = (a: string | undefined, b: string | undefined) =>
    typeof a === "string" && typeof b === "string" && a.trim().toLowerCase() === b.trim().toLowerCase();

const getFontOrThrow = async (id: string) => {
    const font = await prisma.font.findUnique({ where: { id } });

    if (!font) {
        throw new AppError(status.NOT_FOUND, "Font not found");
    }

    return font;
};

/**
 * Parses an embed or throws the parser's own message as a 400.
 *
 * The parser's messages are written for the merchant ("Only fonts.googleapis.com
 * stylesheets are accepted.") so they are surfaced verbatim rather than
 * replaced with something generic.
 */
const parseOrThrow = (embed: string) => {
    const result = parseGoogleFontEmbed(embed);

    if (!result.ok) {
        throw new AppError(status.BAD_REQUEST, result.message);
    }

    return result.value;
};

/**
 * Which surfaces select this family. Both false means the font is free to
 * delete.
 */
const getFontUsage = async (
    family: string,
    client: Prisma.TransactionClient | typeof prisma = prisma,
): Promise<IFontUsage> => {
    const { font, adminFont } = await readThemeSelections(client);

    return {
        storefront: sameFamily(font?.family, family),
        adminPanel: sameFamily(adminFont?.family, family),
    };
};

const createFont = async (userId: string | undefined, payload: ICreateFontPayload) => {
    const parsed = parseOrThrow(payload.embed);

    /*
     * Checked case-insensitively BEFORE the insert so the merchant gets "that
     * font is already in the library" rather than a unique-constraint error.
     * The constraint remains as the backstop against a race between two
     * simultaneous adds — this check is the message, not the guarantee.
     */
    const existing = await prisma.font.findFirst({
        where: { family: { equals: parsed.family, mode: "insensitive" } },
    });

    if (existing) {
        throw new AppError(
            status.CONFLICT,
            `${existing.family} is already in the font library.`,
        );
    }

    const font = await prisma.font.create({ data: parsed });

    await AuditLogService.record(userId, AuditAction.CREATE, "Font", font.id, {
        newData: font,
    });

    return font;
};

/**
 * Admin list. Search is on `family` only — `url` is a rebuilt address no
 * merchant thinks in, and matching it would surface hits for a substring like
 * "wght" across unrelated fonts.
 */
const getFonts = async (queryParams: IQueryParams) => {
    const queryBuilder = new QueryBuilder(
        prisma.font,
        /*
         * Alphabetical by default rather than QueryBuilder's newest-first: this
         * list is a catalogue a merchant scans for a name, not a feed. Still
         * overridable with ?sortBy=.
         */
        {
            ...queryParams,
            sortBy: queryParams.sortBy || "family",
            sortOrder: queryParams.sortOrder || "asc",
        },
        { searchableFields: ["family"] },
    );

    return queryBuilder.search().filter().sort().paginate().execute();
};

/**
 * Every font, unpaginated, alphabetical — what the pickers list.
 *
 * Separate from `getFonts` because a picker showing page one of a paginated
 * library would silently hide the merchant's own fonts behind a control that
 * has no next page. Bounded in practice by the size of a hand-curated library.
 */
const getAllFonts = async () => {
    return prisma.font.findMany({ orderBy: { family: "asc" } });
};

/**
 * Re-paste an embed for an existing row.
 *
 * Everything below happens in ONE transaction because of the denormalised
 * selection: updating the row without propagating would leave a surface
 * pointing at the old URL, so a merchant who edited Poppins to add a weight
 * would see nothing change until they re-selected it. Propagating without the
 * update, or either one half-applied, is worse. `family` is rewritten too, not
 * just `url` — pasting an embed for a different family into an existing row is
 * a rename, and a selection naming the old family would otherwise dangle.
 */
const updateFont = async (
    userId: string | undefined,
    id: string,
    payload: IUpdateFontPayload,
) => {
    const existing = await getFontOrThrow(id);
    const parsed = parseOrThrow(payload.embed);

    /*
     * A rename onto a family another row already holds would produce two cards
     * for one typeface, exactly what the create path refuses. Excludes this row
     * so re-pasting the same family onto itself — the common case, adding
     * weights — is allowed.
     */
    const clash = await prisma.font.findFirst({
        where: {
            id: { not: id },
            family: { equals: parsed.family, mode: "insensitive" },
        },
    });

    if (clash) {
        throw new AppError(
            status.CONFLICT,
            `${clash.family} is already in the font library.`,
        );
    }

    const font = await prisma.$transaction(async (tx) => {
        const updated = await tx.font.update({ where: { id }, data: parsed });

        const { theme } = await readThemeSelections(tx);

        if (theme) {
            const patch: StoredTheme = { ...theme };
            let touched = false;

            // Matched on the PREVIOUS family: that is what the selection holds
            // before this edit lands.
            if (sameFamily((theme.font as StoredFont | undefined)?.family, existing.family)) {
                patch.font = { family: updated.family, url: updated.url };
                touched = true;
            }

            if (sameFamily((theme.adminFont as StoredFont | undefined)?.family, existing.family)) {
                patch.adminFont = { family: updated.family, url: updated.url };
                touched = true;
            }

            if (touched) {
                await tx.storeSetting.update({
                    where: { id: "singleton" },
                    data: { theme: patch as Prisma.InputJsonValue },
                });
            }
        }

        return updated;
    });

    await AuditLogService.record(userId, AuditAction.UPDATE, "Font", id, {
        oldData: existing,
        newData: font,
    });

    // Unconditional: an edit that did not touch a selection still cannot have
    // changed one, and firing on the cheap side costs a revalidation the
    // storefront would have done within its window anyway.
    revalidateStorefront(STORE_SETTINGS_TAG);

    return font;
};

/**
 * Delete, refused while the font is selected.
 *
 * The 409 names the surfaces so the admin's reassign dialog can be specific.
 * The client is never asked to decide whether a font is in use — it asks, the
 * server refuses, the UI escalates. That is the delete convention this
 * codebase uses everywhere (see ResourceListPage).
 *
 * Reassignment is not performed here: the admin sends PATCH /settings with the
 * replacement, then retries this call. Two ordinary calls beat a bespoke
 * transactional endpoint, and neither is itself partial — the failure mode is
 * "reassigned but not deleted", which is visible and harmless.
 */
const deleteFont = async (userId: string | undefined, id: string) => {
    const existing = await getFontOrThrow(id);

    const usage = await getFontUsage(existing.family);

    if (usage.storefront || usage.adminPanel) {
        const surfaces = [
            usage.storefront ? "the storefront" : null,
            usage.adminPanel ? "the admin panel" : null,
        ].filter(Boolean);

        throw new AppError(
            status.CONFLICT,
            `${existing.family} is in use by ${surfaces.join(" and ")}. Choose a different font there first.`,
        );
    }

    const font = await prisma.font.delete({ where: { id } });

    await AuditLogService.record(userId, AuditAction.DELETE, "Font", id, {
        oldData: existing,
    });

    return font;
};

export const FontService = {
    createFont,
    getFonts,
    getAllFonts,
    getFontOrThrow,
    getFontUsage,
    updateFont,
    deleteFont,
};
