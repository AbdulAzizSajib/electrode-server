/**
 * Verification for the storefront's floating chat widget.
 *
 * Pins every scenario in the delta spec of
 * openspec/changes/add-footer-credit-and-chat-widget:
 *
 *  - the validation rule, per channel, and that it only bites while ENABLED;
 *  - phone normalisation, so separators never reach storage;
 *  - the `contactPhone` fallback, resolved identically on the admin and public
 *    reads — the property that keeps the admin preview and the storefront from
 *    dialling different numbers;
 *  - an explicit number overriding that fallback;
 *  - and the read-time disable: a stored-enabled widget serving `enabled: false`
 *    once its destination stops resolving, WITHOUT the stored block changing.
 *
 * UNLIKE MOST VERIFY SCRIPTS, THIS ONE CANNOT CREATE `__verify_*` ROWS.
 * `StoreSetting` is a singleton on a fixed id — there is no second row to make —
 * so it snapshots the live settings, mutates them, and restores the snapshot in
 * a `finally`. The restore matters more here than a delete would: leaving the
 * store's real contact phone cleared would break the footer, the mobile nav and
 * the announcement bar, not just this feature.
 *
 * Run with:
 *   npx tsx scripts/verify-chat-widget.ts
 */
import { prisma } from "../src/app/lib/prisma";
import { SINGLETON_ID } from "../src/app/module/store-setting/store-setting.constant";
import { StoreSettingService } from "../src/app/module/store-setting/store-setting.service";
import { chatWidgetSchema } from "../src/app/module/store-setting/store-setting.validation";

let failures = 0;

const check = (label: string, ok: boolean, detail: string) => {
    console.log(`${ok ? "PASS" : "FAIL"}  ${label} — ${detail}`);
    if (!ok) failures += 1;
};

/**
 * Compares a stored Json block by VALUE, not by serialisation.
 *
 * MySQL does not preserve a JSON object's key order, so a block written as
 * `{enabled, channel}` can read back as `{channel, enabled}` and a
 * `JSON.stringify` comparison would fail on a row that is byte-for-byte
 * correct. Sorting the keys first is what makes "the stored block was not
 * touched" a testable claim rather than a coin flip.
 */
const sameJson = (a: unknown, b: unknown): boolean => {
    const norm = (value: unknown): unknown => {
        if (Array.isArray(value)) return value.map(norm);
        if (value && typeof value === "object") {
            return Object.fromEntries(
                Object.entries(value as Record<string, unknown>)
                    .sort(([x], [y]) => x.localeCompare(y))
                    .map(([k, v]) => [k, norm(v)]),
            );
        }
        return value;
    };
    return JSON.stringify(norm(a)) === JSON.stringify(norm(b));
};

/** The one user id every audit entry this script provokes is attributed to. */
const actorId = async (): Promise<string> => {
    const user = await prisma.user.findFirstOrThrow({ select: { id: true } });
    return user.id;
};

const main = async () => {
    // ---- validation, no database needed ----------------------------------
    const parses = (label: string, input: unknown, expected: "ok" | "fail") => {
        const result = chatWidgetSchema.safeParse(input);
        const got = result.success ? "ok" : "fail";
        check(
            label,
            got === expected,
            result.success
                ? `parsed to ${JSON.stringify(result.data)}`
                : `rejected: ${result.error.issues[0].message}`,
        );
        return result;
    };

    parses(
        "enabled messenger with no username is refused",
        { enabled: true, channel: "messenger", messengerUsername: "" },
        "fail",
    );
    parses(
        "DISABLED messenger with no username is accepted (configure over several saves)",
        { enabled: false, channel: "messenger", messengerUsername: "" },
        "ok",
    );
    parses(
        "DISABLED whatsapp with no number is accepted",
        { enabled: false, channel: "whatsapp", whatsappNumber: "" },
        "ok",
    );
    /*
     * Blank-while-enabled is accepted by the SCHEMA on purpose: blank means
     * "use contactPhone", and whether that resolves needs a database read Zod
     * cannot do. The service enforces it — the read-time half is checked below.
     */
    parses(
        "enabled whatsapp with blank number parses (service owns the fallback check)",
        { enabled: true, channel: "whatsapp", whatsappNumber: "" },
        "ok",
    );
    parses(
        "a number that is not a BD mobile is refused",
        { enabled: true, channel: "whatsapp", whatsappNumber: "12345" },
        "fail",
    );
    parses(
        "an unknown key is refused, never silently stripped",
        { enabled: false, channel: "whatsapp", apiKey: "secret" },
        "fail",
    );

    const normalised = parses(
        "separators are normalised away on write",
        { enabled: true, channel: "whatsapp", whatsappNumber: "+880 1782-521705" },
        "ok",
    );
    if (normalised.success) {
        check(
            "normalisation yields E.164",
            normalised.data.whatsappNumber === "+8801782521705",
            `got "${normalised.data.whatsappNumber}", expected "+8801782521705"`,
        );
    }

    // ---- live, against the real singleton ---------------------------------
    const snapshot = await prisma.storeSetting.findUnique({ where: { id: SINGLETON_ID } });
    const restore = {
        chatWidget: (snapshot?.chatWidget ?? null) as never,
        contactPhone: snapshot?.contactPhone ?? null,
    };
    const userId = await actorId();

    try {
        // A blank number plus a real contact phone: both reads must resolve it.
        await prisma.storeSetting.update({
            where: { id: SINGLETON_ID },
            data: { contactPhone: "+8801782521705" },
        });
        await StoreSettingService.updateStoreSetting(userId, {
            chatWidget: { enabled: true, channel: "whatsapp", whatsappNumber: "" },
        });

        const adminRead = await StoreSettingService.getAdminStoreSetting();
        const publicRead = await StoreSettingService.getPublicStoreSetting();

        check(
            "blank number resolves to contactPhone on the ADMIN read",
            adminRead.chatWidget.whatsappNumber === "+8801782521705",
            `got "${adminRead.chatWidget.whatsappNumber}"`,
        );
        check(
            "blank number resolves to contactPhone on the PUBLIC read",
            publicRead.chatWidget.whatsappNumber === "+8801782521705",
            `got "${publicRead.chatWidget.whatsappNumber}"`,
        );
        check(
            "both reads agree — the property that stops the admin preview drifting",
            sameJson(adminRead.chatWidget, publicRead.chatWidget),
            `admin=${JSON.stringify(adminRead.chatWidget)} public=${JSON.stringify(publicRead.chatWidget)}`,
        );

        const storedAfterResolve = await prisma.storeSetting.findUnique({
            where: { id: SINGLETON_ID },
            select: { chatWidget: true },
        });
        check(
            "resolving does NOT write the fallback back into the row",
            (storedAfterResolve?.chatWidget as { whatsappNumber?: string })?.whatsappNumber === "",
            `stored number is ${JSON.stringify((storedAfterResolve?.chatWidget as { whatsappNumber?: string })?.whatsappNumber)}, expected ""`,
        );

        // An explicit number must win over the contact phone.
        await StoreSettingService.updateStoreSetting(userId, {
            chatWidget: { enabled: true, channel: "whatsapp", whatsappNumber: "01712345678" },
        });
        const overridden = await StoreSettingService.getPublicStoreSetting();
        check(
            "an explicit number overrides the contactPhone fallback",
            overridden.chatWidget.whatsappNumber === "+8801712345678",
            `got "${overridden.chatWidget.whatsappNumber}"`,
        );
        check(
            "the override leaves contactPhone alone",
            overridden.contact.phone === "+8801782521705",
            `contactPhone is now "${overridden.contact.phone}"`,
        );

        // The sequence the schema cannot catch: valid widget first, phone cleared after.
        await StoreSettingService.updateStoreSetting(userId, {
            chatWidget: { enabled: true, channel: "whatsapp", whatsappNumber: "" },
        });
        const storedBeforeClear = await prisma.storeSetting.findUnique({
            where: { id: SINGLETON_ID },
            select: { chatWidget: true },
        });

        await prisma.storeSetting.update({
            where: { id: SINGLETON_ID },
            data: { contactPhone: null },
        });

        const stranded = await StoreSettingService.getPublicStoreSetting();
        check(
            "a widget whose destination stopped resolving is SERVED disabled",
            stranded.chatWidget.enabled === false,
            `served enabled=${stranded.chatWidget.enabled}`,
        );

        const storedAfterClear = await prisma.storeSetting.findUnique({
            where: { id: SINGLETON_ID },
            select: { chatWidget: true },
        });
        check(
            "the STORED block is untouched, so restoring the phone restores the widget",
            sameJson(storedBeforeClear?.chatWidget, storedAfterClear?.chatWidget),
            `before=${JSON.stringify(storedBeforeClear?.chatWidget)} after=${JSON.stringify(storedAfterClear?.chatWidget)}`,
        );

        await prisma.storeSetting.update({
            where: { id: SINGLETON_ID },
            data: { contactPhone: "+8801782521705" },
        });
        const recovered = await StoreSettingService.getPublicStoreSetting();
        check(
            "restoring the contact phone brings the widget back with no re-save",
            recovered.chatWidget.enabled === true &&
                recovered.chatWidget.whatsappNumber === "+8801782521705",
            `enabled=${recovered.chatWidget.enabled} number="${recovered.chatWidget.whatsappNumber}"`,
        );

        // A widget the merchant switched off must stay off even when reachable.
        await StoreSettingService.updateStoreSetting(userId, {
            chatWidget: { enabled: false, channel: "whatsapp", whatsappNumber: "" },
        });
        const off = await StoreSettingService.getPublicStoreSetting();
        check(
            "a disabled widget stays disabled even with a resolvable destination",
            off.chatWidget.enabled === false,
            `served enabled=${off.chatWidget.enabled}`,
        );
    } finally {
        await prisma.storeSetting.update({
            where: { id: SINGLETON_ID },
            data: restore,
        });
        console.log("\n(store settings restored to their pre-run values)");
    }

    console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} check(s) FAILED.`);
    process.exit(failures === 0 ? 0 : 1);
};

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
