/**
 * The integration registry — the one place an id becomes a declaration.
 *
 * ADDING AN INTEGRATION IS AN ENTRY HERE. The admin card, the credential form,
 * the masked inputs and the webhook block are all rendered from what an entry
 * declares, so nothing in the panel and nothing in the service needs to learn
 * the new integration's name.
 *
 * `kind` values are STORAGE KEYS and must never change once credentials exist
 * under them: nothing migrates a renamed kind, so the old row simply stops being
 * read and the integration silently reports itself unconfigured. Add a kind,
 * never rename one.
 *
 * See openspec/changes/rename-courier-setting-to-integrations, design.md
 * Decision 4.
 */
import { IIntegrationDescriptor } from "./integration.interface";

/**
 * Credential kinds, named once.
 *
 * Referenced by the providers that resolve them, so a typo is a compile error
 * rather than a credential that is written under one spelling and read under
 * another — a failure that looks exactly like "the merchant never entered it".
 */
export const CredentialKind = {
    API_KEY: "apiKey",
    SECRET_KEY: "secretKey",
    WEBHOOK_TOKEN: "webhookToken",
    ACCESS_TOKEN: "accessToken",
} as const;

/** Integration ids, named once, for the same reason as the kinds above. */
export const IntegrationId = {
    STEADFAST: "STEADFAST",
    MANUAL: "MANUAL",
    FACEBOOK_PIXEL: "FACEBOOK_PIXEL",
    FACEBOOK_CAPI: "FACEBOOK_CAPI",
} as const;

/**
 * Every integration this system knows about.
 *
 * Couriers are listed under ids matching the `CourierProvider` enum, because the
 * courier module resolves an adapter by that value and the two must not drift.
 * Non-couriers use their own ids and have no enum — forcing the Meta pixel into
 * a courier enum to make it storable would be a worse problem than the string
 * key this model uses instead.
 */
export const INTEGRATIONS: IIntegrationDescriptor[] = [
    {
        id: IntegrationId.STEADFAST,
        displayName: "SteadFast Courier",
        description: "Delivery integration",
        category: "COURIER",
        credentials: [
            {
                kind: CredentialKind.API_KEY,
                label: "API Key",
                secret: true,
                placeholder: "Paste API Key",
            },
            {
                kind: CredentialKind.SECRET_KEY,
                label: "Secret Key",
                secret: true,
                placeholder: "Paste Secret Key",
            },
        ],
        webhook: {
            kind: CredentialKind.WEBHOOK_TOKEN,
            label: "Webhook Auth Token",
            instructions: [
                "Copy the Callback URL below and paste it into Steadfast's Webhook settings.",
                'Set the same value in Steadfast "Auth Token (Bearer)" and this panel.',
                "Enable the Webhook toggle and save the webhook settings.",
            ],
        },
    },
    {
        /**
         * "We hand parcels over ourselves" — a real choice, not a
         * misconfiguration.
         *
         * Declares no credentials, which is what makes it report itself
         * configured: an integration that needs nothing is ready, and saying
         * otherwise would show a working setup as broken.
         */
        id: IntegrationId.MANUAL,
        displayName: "Manual (no courier integration)",
        description: "Orders are handed over by hand",
        category: "COURIER",
        credentials: [],
    },
    {
        /**
         * The pixel id itself is NOT a credential and is deliberately absent
         * from this list — it lives in `StoreSetting.integrationConfig`, because
         * the storefront has to read it to render the pixel and it is published
         * to every visitor anyway. This entry exists so the pixel appears as a
         * card with an enable toggle alongside the others.
         */
        id: IntegrationId.FACEBOOK_PIXEL,
        displayName: "Facebook Pixel",
        description: "Track website visitors and their actions",
        category: "MARKETING",
        credentials: [],
    },
    {
        /**
         * The CAPI access token IS a credential, unlike the pixel id above.
         * Same feature, two halves, stored differently on purpose: one is
         * published by the act of using it, the other can post events as the
         * merchant's business. See StoreSetting.integrationConfig's comment.
         */
        id: IntegrationId.FACEBOOK_CAPI,
        displayName: "Facebook CAPI",
        description: "Track events and conversions server-side",
        category: "MARKETING",
        credentials: [
            {
                kind: CredentialKind.ACCESS_TOKEN,
                label: "Access Token (CAPI)",
                secret: true,
                placeholder: "Paste Access Token",
            },
        ],
    },
];

/** One integration's declaration, or undefined when the id is unknown. */
export const findIntegration = (id: string): IIntegrationDescriptor | undefined =>
    INTEGRATIONS.find((integration) => integration.id === id);

/** Whether a string names an integration this system supports. Used by the
 *  routes, which take the id from the URL and must reject an unknown one before
 *  touching the database. */
export const isKnownIntegration = (id: string): boolean => findIntegration(id) !== undefined;
