import { ICurrencyFormat } from "../module/store-setting/store-setting.interface";
import { DEFAULT_PUBLIC_SETTINGS, SINGLETON_ID } from "../module/store-setting/store-setting.constant";

/**
 * Writes a monetary amount the way the merchant has configured it.
 *
 * Used wherever the SERVER emits a formatted amount inside a message a human
 * reads — a price-mismatch conflict, an overpayment rejection. It exists so
 * those messages agree with what the shopper saw on the storefront and what the
 * merchant sees in the admin panel: a shopper told "server computed 1200.00"
 * while their basket said "৳1,200.00" has to do the translation themselves.
 *
 * NOT used for machine-readable output. Report CSVs deliberately emit bare
 * decimals (see report.columns.ts) so a spreadsheet reads those columns as
 * numeric — running them through here would turn a summable column into text.
 *
 * The frontend and the admin panel each carry their own copy of this logic
 * rather than importing it, because they are separate deployments. The three
 * must agree, and the rules they agree on are: `Intl` groups the digits, we
 * place the symbol, no space before, one non-breaking space after.
 */

/** One formatter per distinct decimal count. Constructing an `Intl.NumberFormat` is not free, and a report renders hundreds of amounts. */
const formatterCache = new Map<number, Intl.NumberFormat>();

const numberFormatter = (decimals: number): Intl.NumberFormat => {
    const cached = formatterCache.get(decimals);
    if (cached) return cached;

    /*
     * `en-US` for grouping, NOT `style: "currency"`. Currency style derives the
     * symbol and its side from the currency code and locale — `BDT` in `en-US`
     * renders "BDT 1,200.00" — which is exactly the decision this feature hands
     * to the merchant. So Intl formats the number and we attach the symbol.
     */
    const formatter = new Intl.NumberFormat("en-US", {
        minimumFractionDigits: decimals,
        maximumFractionDigits: decimals,
    });

    formatterCache.set(decimals, formatter);
    return formatter;
};

/**
 * The fallback format, matching DEFAULT_PUBLIC_SETTINGS.
 *
 * A caller that cannot load settings still produces a symbol-bearing amount
 * rather than a bare number — the same posture every other default in this
 * module takes.
 */
export const DEFAULT_CURRENCY_FORMAT: ICurrencyFormat = {
    symbol: DEFAULT_PUBLIC_SETTINGS.currencySymbol,
    position: DEFAULT_PUBLIC_SETTINGS.currencyPosition,
    decimals: DEFAULT_PUBLIC_SETTINGS.currencyDecimals,
};

/**
 * Written as an escape, never as a pasted character: a literal U+00A0 in source
 * is invisible in every editor and indistinguishable from an ordinary space in
 * a diff. The frontend and admin copies of this logic spell it the same way.
 */
const NBSP = "\u00A0";

/**
 * Spacing is a fixed consequence of the position, not a further setting: none
 * when the symbol leads (`৳1,200.00`), one non-breaking space when it trails
 * (`1,200.00` + NBSP + `৳`). That is what leading-symbol and trailing-symbol
 * locales respectively do, and the non-breaking space keeps an amount from
 * wrapping away from its symbol at the end of a line.
 */
export const formatMoney = (
    amount: number,
    format: ICurrencyFormat = DEFAULT_CURRENCY_FORMAT,
): string => {
    const digits = numberFormatter(format.decimals).format(amount);

    return format.position === "AFTER"
        ? `${digits}${NBSP}${format.symbol}`
        : `${format.symbol}${digits}`;
};

/**
 * Pulls the format out of a StoreSetting row.
 *
 * Takes the three columns loosely rather than the whole row so a caller holding
 * a `select`ed subset can still use it.
 */
export const currencyFormatOf = (setting: {
    currencySymbol: string;
    currencyPosition: ICurrencyFormat["position"];
    currencyDecimals: number;
}): ICurrencyFormat => ({
    symbol: setting.currencySymbol,
    position: setting.currencyPosition,
    decimals: setting.currencyDecimals,
});

/**
 * The same read, but on a caller's own client — so a path already inside a
 * transaction formats its message without asking the pool for a second
 * connection while holding one.
 *
 * Falls back to the defaults rather than throwing, for the reason
 * StoreSettingService.getCurrencyFormat does: failing to format an error
 * message must not replace the error being reported.
 */
export const currencyFormatOfTx = async (client: {
    storeSetting: {
        findUnique: (args: {
            where: { id: string };
            select: {
                currencySymbol: true;
                currencyPosition: true;
                currencyDecimals: true;
            };
        }) => Promise<{
            currencySymbol: string;
            currencyPosition: ICurrencyFormat["position"];
            currencyDecimals: number;
        } | null>;
    };
}): Promise<ICurrencyFormat> => {
    const stored = await client.storeSetting.findUnique({
        where: { id: SINGLETON_ID },
        select: { currencySymbol: true, currencyPosition: true, currencyDecimals: true },
    });

    return stored ? currencyFormatOf(stored) : DEFAULT_CURRENCY_FORMAT;
};
