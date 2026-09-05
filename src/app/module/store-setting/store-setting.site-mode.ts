/**
 * The rule that decides whether a site-mode setting is servable.
 *
 * Extracted from store-setting.service.ts for the same reason
 * order.checkout-fields.ts was extracted from order.service.ts: the rule that
 * decides whether a save is accepted should be exercisable directly, rather
 * than only through a live PATCH with a database behind it. See
 * scripts/verify-landing-page.ts.
 *
 * The service keeps the two halves this file cannot do: reading the landing
 * page row, and doing so inside the transaction that writes the settings, so
 * two admins racing cannot leave the storefront root serving nothing.
 */
import { LandingPageStatus, SiteMode } from "../../../generated/prisma/client";

/** The settings pair as it will be after the save — not merely what the payload mentioned. */
export interface IResolvedSiteMode {
    siteMode: SiteMode;
    activeLandingPageId: string | null;
}

/** The selected page as the database has it, or null when there is no such row. */
export interface ISelectedLandingPage {
    status: LandingPageStatus;
    title: string;
}

/**
 * Why this combination cannot be served, or null when it can.
 *
 * Returns the message rather than throwing so the decision can be tested
 * without a server, an error class or an HTTP status in the way. The caller
 * turns a non-null result into a 400.
 *
 * WEBSITE mode is always servable, whatever the selection says — a shop showing
 * its own homepage cannot be broken by which landing page happens to be
 * selected, and refusing a save on those grounds would trap a merchant who
 * deleted the page they had picked.
 */
export const siteModeRejection = (
    resolved: IResolvedSiteMode,
    selected: ISelectedLandingPage | null,
): string | null => {
    if (resolved.siteMode !== SiteMode.LANDING_PAGE) return null;

    if (!resolved.activeLandingPageId) {
        return "Choose which landing page should be live before switching your site to landing page mode.";
    }

    if (!selected) {
        return "That landing page no longer exists — choose another one before switching your site to landing page mode.";
    }

    if (selected.status !== LandingPageStatus.PUBLISHED) {
        return `"${selected.title}" is still a draft. Publish it before making it your site's home page.`;
    }

    return null;
};

/**
 * The pair a save will leave behind, from the payload and the stored row.
 *
 * Resolved before either half is checked because either half alone can produce
 * an unservable combination: a PATCH that only flips `siteMode` leaves the
 * existing selection in place, and one that only clears the selection leaves
 * the existing mode in place. Checking only what the payload mentioned would
 * miss both.
 */
export const resolveSiteMode = (
    payload: { siteMode?: SiteMode; activeLandingPageId?: string | null },
    existing: { siteMode?: SiteMode; activeLandingPageId?: string | null } | null,
): IResolvedSiteMode => ({
    siteMode: payload.siteMode ?? existing?.siteMode ?? SiteMode.WEBSITE,
    activeLandingPageId:
        payload.activeLandingPageId !== undefined
            ? payload.activeLandingPageId
            : (existing?.activeLandingPageId ?? null),
});
