/**
 * The merchant who uses a courier this system does not integrate with.
 *
 * A REAL PROVIDER, NOT THE ABSENCE OF ONE. It declares no capabilities and
 * creates no consignments; selecting it means "we hand parcels to someone whose
 * API we do not talk to", and manual shipment entry keeps working exactly as it
 * does for any shipment without a consignment.
 *
 * Modelling this as `courierProvider = null` instead would cost twice. Every
 * call site would have to answer "what if nobody chose", which is a state with
 * no useful behaviour. And "deliberately unintegrated" would become
 * indistinguishable from "misconfigured deployment" — which is precisely the
 * distinction the admin panel exists to show: a merchant on MANUAL should see a
 * courier section that is quietly switched off, not one shouting that its
 * credentials are missing.
 *
 * It is also what makes provider selection useful today, before a second HTTP
 * adapter exists: a merchant on Pathao or RedX or a local courier can configure
 * this platform honestly right now.
 *
 * Every optional method is deliberately absent rather than present-and-throwing.
 * The capability gate in `courier.service.ts` refuses these actions before any
 * provider method is reached, so an absent method is unreachable — and leaving
 * it out means `verify-courier-provider.ts` can assert the correspondence
 * between what a provider claims and what it implements.
 *
 * See openspec/changes/add-courier-provider-selection, design.md Decision 6.
 */
import { CourierProvider } from "../../../../generated/prisma/client";
import {
    CourierMapResult,
    ICourierProvider,
    NO_CAPABILITIES,
} from "../courier.provider";

export const ManualProvider: ICourierProvider = {
    id: CourierProvider.MANUAL,
    displayName: "Manual (no courier integration)",
    capabilities: NO_CAPABILITIES,

    /*
     * Configured by definition. There is nothing to configure, and answering
     * false would make the admin report a working setup as broken — the exact
     * confusion this provider exists to prevent.
     */
    isConfigured: () => true,
    isWebhookConfigured: () => false,

    /*
     * Unreachable in practice: dispatch is refused at the capability gate before
     * any order is mapped. Implemented rather than omitted because `mapOrder` is
     * the one non-optional method on the interface, and a refusal that names the
     * reason beats a crash if the gate is ever bypassed.
     */
    mapOrder: (): CourierMapResult => ({
        ok: false,
        reason: "PROVIDER_CANNOT_DISPATCH",
        detail:
            "This shop is not configured with a courier integration, so orders are handed over by hand. Record the shipment on the order instead.",
    }),
};
