/**
 * Verifies that every courier provider does what it claims to.
 *
 * A CAPABILITY DECLARATION IS A CLAIM THE CODE CAN CONTRADICT, in both
 * directions, and both are silent:
 *
 *  - declaring `balance: true` without implementing `getBalance` renders a
 *    button that throws on click;
 *  - declaring `balance: false` while implementing it hides a working feature
 *    nobody ever finds.
 *
 * Neither shows up in a type check, because the interface's optional methods are
 * optional precisely so a provider can leave them out. This script is what ties
 * the two halves together.
 *
 * It also asserts the gate that makes the declarations mean anything: the
 * SERVICE refuses an undeclared action, so a stale admin bundle offering a
 * hidden control still cannot get it performed.
 *
 * Pure — no database, no network, no courier. Run with:
 *   npx tsx scripts/verify-courier-provider.ts
 */
import { CourierProvider } from "../src/generated/prisma/client";
import { CourierService } from "../src/app/module/courier/courier.service";
import {
    ICourierCapabilities,
    ICourierProvider,
} from "../src/app/module/courier/courier.provider";
import {
    isSupportedProvider,
    listProviders,
    resolveProvider,
} from "../src/app/module/courier/providers";
import { ManualProvider } from "../src/app/module/courier/providers/manual.provider";
import { SteadfastProvider } from "../src/app/module/courier/providers/steadfast.provider";

let failures = 0;

const check = (label: string, ok: boolean, detail: string) => {
    console.log(`${ok ? "PASS" : "FAIL"}  ${label} — ${detail}`);
    if (!ok) failures += 1;
};

/**
 * Each capability and the method a provider must implement to back it.
 *
 * `webhook` maps to two methods: parsing a payload is useless without a token to
 * authenticate it, and a token is useless without a parser.
 */
const CAPABILITY_METHODS: {
    capability: keyof ICourierCapabilities;
    methods: (keyof ICourierProvider)[];
}[] = [
    { capability: "dispatch", methods: ["createConsignments"] },
    { capability: "status", methods: ["getStatus", "readStatus"] },
    { capability: "balance", methods: ["getBalance"] },
    { capability: "returns", methods: ["createReturnRequest"] },
    { capability: "webhook", methods: ["parseWebhook", "webhookToken", "readStatus"] },
];

console.log("\n--- Every enum member has an adapter ---\n");

for (const member of Object.values(CourierProvider)) {
    let resolved: ICourierProvider | null = null;
    try {
        resolved = resolveProvider(member);
    } catch {
        resolved = null;
    }

    check(
        `${member} resolves to an adapter`,
        resolved !== null && resolved.id === member,
        resolved
            ? `${resolved.displayName}`
            : "a schema enum member without its adapter turns a dispatch into a runtime failure",
    );
}

check(
    "the registry lists every enum member",
    listProviders().length === Object.values(CourierProvider).length,
    `${listProviders().length} registered, ${Object.values(CourierProvider).length} in the enum`,
);

check(
    "an unregistered name is not reported as supported",
    !isSupportedProvider("pathao") && !isSupportedProvider(""),
    "the webhook route relies on this to reject an unknown provider before any query",
);

console.log("\n--- A declared capability is backed by a method ---\n");

for (const provider of listProviders()) {
    for (const { capability, methods } of CAPABILITY_METHODS) {
        const declared = provider.capabilities[capability];

        for (const method of methods) {
            const implemented = typeof provider[method] === "function";

            if (declared) {
                check(
                    `${provider.displayName} declares ${capability} and implements ${String(method)}`,
                    implemented,
                    implemented ? "" : "the panel would offer a control that throws on use",
                );
            } else {
                check(
                    `${provider.displayName} does not declare ${capability}, and omits ${String(method)}`,
                    !implemented,
                    !implemented
                        ? ""
                        : "an implemented-but-undeclared method is a working feature nobody can reach",
                );
            }
        }
    }
}

console.log("\n--- MANUAL declares nothing ---\n");

check(
    "MANUAL supports no courier action",
    Object.values(ManualProvider.capabilities).every((value) => value === false),
    "it exists to mean 'we hand parcels over ourselves', not 'the courier is broken'",
);

check(
    "MANUAL reports itself configured",
    ManualProvider.isConfigured(),
    "there is nothing to configure, and reporting false would show a working setup as broken",
);

check(
    "MANUAL still maps an order to a refusal rather than throwing",
    (() => {
        const result = ManualProvider.mapOrder({
            id: "o1",
            orderNumber: "ORD-1",
            status: "PACKED",
            notes: null,
            totalAmount: 100,
            customer: { firstName: "A", lastName: null, phone: "+8801712345678" },
            shippingAddress: null,
            payments: [],
            shipments: [],
        });
        return !result.ok && result.reason === "PROVIDER_CANNOT_DISPATCH";
    })(),
    "and the reason describes the SHOP's setup, not a fault in the order",
);

console.log("\n--- Steadfast declares the full set ---\n");

check(
    "Steadfast supports every capability",
    Object.values(SteadfastProvider.capabilities).every((value) => value === true),
    "the interface was extracted from it, so anything it cannot do would be a gap in the abstraction",
);

console.log("\n--- The service refuses an undeclared action ---\n");

const { assertCapability } = CourierService._internals;

const refuses = (
    provider: ICourierProvider,
    capability: keyof ICourierCapabilities,
): string | null => {
    try {
        assertCapability(provider, capability, "the action");
        return null;
    } catch (error) {
        return error instanceof Error ? error.message : String(error);
    }
};

for (const capability of ["dispatch", "status", "balance", "returns", "webhook"] as const) {
    const message = refuses(ManualProvider, capability);

    check(
        `${capability} is refused for a provider that does not declare it`,
        message !== null,
        message ?? "the gate let it through — hiding a control in the admin is not enough on its own",
    );
}

const named = refuses(ManualProvider, "balance");

check(
    "the refusal names the provider",
    named !== null && named.includes(ManualProvider.displayName),
    named ?? "",
);

check(
    "a declared capability is not refused",
    refuses(SteadfastProvider, "balance") === null,
    "",
);

console.log("\n--- Terminal statuses agree across the module ---\n");

const { TERMINAL_COURIER_STATUSES } = CourierService._internals;

check(
    "the service's terminal set matches the provider's reading",
    TERMINAL_COURIER_STATUSES.every((raw) => SteadfastProvider.readStatus!(raw).isTerminal),
    "reconciliation selects on the service's list while the switch guard and the provider read the same states — a mismatch strands a consignment or blocks a switch forever",
);

check(
    "`unknown` is not terminal",
    !SteadfastProvider.readStatus!("unknown").isTerminal &&
        !TERMINAL_COURIER_STATUSES.includes("unknown"),
    "it means the courier is telling us to contact support, which is the opposite of settled",
);

console.log(`\n${failures === 0 ? "All checks passed." : `${failures} check(s) FAILED.`}\n`);
process.exit(failures === 0 ? 0 : 1);
