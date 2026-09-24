import { PromoBannerLayout } from "../../../generated/prisma/client";

/**
 * Payloads for the promo banner group module.
 *
 * A group is one promotional strip on the homepage: a name, how many tiles it
 * renders across, and its order among the other groups. Its BANNERS are not set
 * from here — a banner names its group, not the other way round, so membership
 * is edited on the banner (see banner.validation.ts). That keeps one writer per
 * relation rather than two that could disagree.
 */

export interface ICreatePromoBannerGroupPayload {
    name: string;
    /** Omitted means THREE — the column's default, and what the storefront
     *  rendered before strips were groupable. */
    layout?: PromoBannerLayout;
    sortOrder?: number;
}

/**
 * Every field optional, and `.optional()` alone rather than `.nullable()`:
 * none of the three has a meaningful "cleared" state. A group always has a
 * name, always renders some number of tiles, and always sits somewhere in the
 * order — so an omitted key means "leave unchanged" and there is nothing a
 * null could express that omission does not.
 */
export type IUpdatePromoBannerGroupPayload = Partial<ICreatePromoBannerGroupPayload>;

/**
 * A whole-list reorder, not a per-row sortOrder write.
 *
 * Position is relative: moving one group up moves another down, so writing a
 * single row's `sortOrder` cannot express the result without the client first
 * working out every other row's new value and hoping nothing changed in
 * between. Sending the intended order and letting the server index it makes the
 * operation atomic and the client's job trivial.
 */
export interface IReorderPromoBannerGroupsPayload {
    /** Group ids in the merchant's intended order, first to last. */
    ids: string[];
}

/**
 * A group as the API serves it.
 *
 * `bannerCount` is included because every surface that lists groups needs it —
 * the admin warns when it disagrees with the layout, and the merchant reads it
 * to know which strip is empty. Deriving it per caller would mean each one
 * loading the banners just to count them.
 */
export interface IPromoBannerGroupResult {
    id: string;
    name: string;
    layout: PromoBannerLayout;
    sortOrder: number;
    bannerCount: number;
    createdAt: Date;
    updatedAt: Date;
}
