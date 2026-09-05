import { envVars } from "../../config/env";

/**
 * Turns the `from`/`to` calendar dates a report is asked for into the pair of
 * instants it actually queries, resolved in ONE timezone on the server.
 *
 * Why the server owns this (design decision 14): if the admin panel sent
 * instants derived from the browser's timezone, the same range run from two
 * machines would return different totals and neither would be wrong. The
 * resolved boundaries are echoed back in every report response, so an
 * off-by-one is reproducible rather than arguable.
 *
 * `Asia/Dhaka` when STORE_TIMEZONE is unset. Making the timezone a
 * merchant-editable store setting is its own change.
 */
const FALLBACK_TIMEZONE = "Asia/Dhaka";

const resolveTimeZone = (): string => {
    const configured = envVars.STORE_TIMEZONE;
    if (!configured) return FALLBACK_TIMEZONE;

    try {
        // Throws RangeError on an unknown zone. Falling back beats booting a
        // server that dates every report by a zone that does not exist.
        new Intl.DateTimeFormat("en-US", { timeZone: configured });
        return configured;
    } catch {
        console.warn(
            `STORE_TIMEZONE "${configured}" is not a recognised IANA timezone; reports will use ${FALLBACK_TIMEZONE}.`,
        );
        return FALLBACK_TIMEZONE;
    }
};

export const STORE_TIMEZONE = resolveTimeZone();

/** Milliseconds the given zone is ahead of UTC at the given instant. */
const zoneOffsetMs = (instant: Date, timeZone: string): number => {
    const parts = new Intl.DateTimeFormat("en-US", {
        timeZone,
        hour12: false,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
    }).formatToParts(instant);

    const read = (type: string) => Number(parts.find((part) => part.type === type)?.value ?? 0);

    const asIfUtc = Date.UTC(
        read("year"),
        read("month") - 1,
        read("day"),
        // Intl renders midnight as hour 24 in some engines under hour12: false.
        read("hour") % 24,
        read("minute"),
        read("second"),
    );

    // Differenced against the instant truncated to whole seconds. `asIfUtc` is
    // built from Intl parts, which carry no millisecond component — comparing
    // it against an instant that has one makes the offset wrong by exactly that
    // remainder, which is how the inclusive end boundary (…23:59:59.999) came
    // out 999ms into the following day.
    const wholeSeconds = Math.floor(instant.getTime() / 1000) * 1000;

    return asIfUtc - wholeSeconds;
};

/**
 * The UTC instant at which the given wall-clock time occurs in `timeZone`.
 *
 * Two passes because the offset depends on the instant we are trying to find:
 * guess with the offset at the naive instant, then re-read the offset at that
 * candidate and correct. Asia/Dhaka has no DST so one pass would do there, but
 * a store that later sets a DST-observing zone should not silently shift its
 * month boundaries twice a year.
 */
const wallClockToUtc = (
    year: number,
    month: number,
    day: number,
    hour: number,
    minute: number,
    second: number,
    ms: number,
    timeZone: string,
): Date => {
    const naive = Date.UTC(year, month - 1, day, hour, minute, second, ms);
    const firstPass = naive - zoneOffsetMs(new Date(naive), timeZone);
    return new Date(naive - zoneOffsetMs(new Date(firstPass), timeZone));
};

export interface IResolvedRange {
    /** Inclusive start instant. */
    start: Date;
    /** Inclusive end instant — the last millisecond of the `to` day, so a record dated then is included. */
    end: Date;
    /** The calendar dates the merchant chose, echoed so the UI can show what it got. */
    from: string;
    to: string;
    timeZone: string;
}

const DEFAULT_RANGE_DAYS = 30;

const toDateOnly = (instant: Date, timeZone: string): string => {
    const parts = new Intl.DateTimeFormat("en-CA", {
        timeZone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
    }).formatToParts(instant);
    const read = (type: string) => parts.find((part) => part.type === type)?.value ?? "01";
    return `${read("year")}-${read("month")}-${read("day")}`;
};

/**
 * Defaults to the last 30 days ending today when either endpoint is missing,
 * which `admin-reporting/report-shell` requires the UI to then display — a
 * report that silently covers "everything ever" reads as a month's trading.
 */
export const resolveRange = (from?: string, to?: string): IResolvedRange => {
    const timeZone = STORE_TIMEZONE;
    const today = toDateOnly(new Date(), timeZone);

    const resolvedTo = to ?? today;
    const resolvedFrom =
        from ??
        toDateOnly(
            new Date(
                new Date(`${resolvedTo}T00:00:00Z`).getTime() -
                    (DEFAULT_RANGE_DAYS - 1) * 86_400_000,
            ),
            "UTC",
        );

    const [fy, fm, fd] = resolvedFrom.split("-").map(Number);
    const [ty, tm, td] = resolvedTo.split("-").map(Number);

    return {
        start: wallClockToUtc(fy, fm, fd, 0, 0, 0, 0, timeZone),
        // 23:59:59.999 rather than the next midnight: the boundary is inclusive
        // per the spec, and a `lte` on the next midnight would pull in a record
        // dated exactly 00:00:00.000 of the following day.
        end: wallClockToUtc(ty, tm, td, 23, 59, 59, 999, timeZone),
        from: resolvedFrom,
        to: resolvedTo,
        timeZone,
    };
};

/** Prisma `where` fragment for a column that must fall inside the range. */
export const rangeFilter = (range: IResolvedRange) => ({ gte: range.start, lte: range.end });

/** The day a timestamp belongs to, in the store's timezone — used for day groupings. */
export const dayKeyInStoreZone = (instant: Date): string => toDateOnly(instant, STORE_TIMEZONE);
