/**
 * What an integration is, and what it declares about itself.
 *
 * An integration is any third-party service this shop connects to: a courier, a
 * tracking pixel, whatever comes next. They have almost nothing in common at
 * runtime — one creates consignments, another renders a script tag — so this
 * module deliberately does NOT try to abstract what they DO. It abstracts only
 * the two things every one of them shares: secrets that must be stored safely,
 * and a card in the admin panel that must be rendered without hardcoding the
 * integration's name.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE DESCRIPTOR IS THE CONTRACT. An integration declares which credentials it
 * needs and which of them are secret; the admin renders the form from that
 * declaration, and the service enforces it.
 *
 * The alternative — a hand-written form per integration — puts "which of these
 * fields is a secret" in two places, and two places drift. Here `secret: true`
 * drives the masked input, the write-only treatment and the hint together, so a
 * newly added credential cannot accidentally be rendered in plain text by
 * someone who updated the form but not the storage.
 *
 * It is also what keeps the next integration cheap: adding a courier that needs
 * four credentials instead of two is a descriptor change, not an admin rewrite.
 * This mirrors the reasoning `courier.provider.ts` already applies to
 * capabilities, which are declared rather than inferred and enforced on both
 * sides.
 *
 * See openspec/changes/rename-courier-setting-to-integrations, design.md
 * Decision 4.
 */

/**
 * One credential an integration needs.
 *
 * `kind` is the stable storage key — it is the `IntegrationCredential.kind`
 * column and must never change once values exist under it, because nothing
 * migrates a renamed kind and the old row would simply stop being read.
 */
export interface ICredentialDescriptor {
    /** Storage key. Stable forever; see above. */
    kind: string;
    /** What the merchant sees, e.g. "API Key". */
    label: string;
    /**
     * Whether this value must never be readable after it is saved.
     *
     * Almost always true. False exists for values that are merely
     * configuration-shaped — an account id or a client id that the other side
     * treats as public — where showing it back saves the merchant from having to
     * find it again. When in doubt, mark it secret: the cost of hiding a
     * non-secret is mild inconvenience, and the cost of exposing a secret is the
     * merchant's account.
     */
    secret: boolean;
    /** Placeholder text, and any hint about where the merchant finds this value. */
    placeholder?: string;
}

/**
 * How an integration receives push notifications, when it does.
 *
 * Declared rather than assumed because most integrations never receive one, and
 * a card offering a callback URL for a service that does not call back teaches
 * the merchant that the panel is unreliable.
 */
export interface IWebhookDescriptor {
    /** The `kind` under which the generated secret is stored. */
    kind: string;
    /** What the other side calls this field, e.g. "Auth Token (Bearer)". */
    label: string;
    /** Steps shown in the card's Quick Setup block, in order. */
    instructions: string[];
}

/**
 * Where an integration appears in the admin, so cards group sensibly.
 *
 * `NOTIFICATION` is its own category rather than a corner of `MARKETING`
 * because the categories are how the admin page groups its cards, and a
 * merchant looking for "where do I turn off the order alerts" would be hunting
 * under Marketing, next to ad measurement — a grouping that is wrong about what
 * the integration is for. A one-word union member is a cheaper fix than a
 * misleading page. See openspec/changes/add-telegram-notifications, design.md
 * Decision 2.
 */
export type IntegrationCategory = "COURIER" | "MARKETING" | "NOTIFICATION";

/**
 * One integration, as declared by the registry.
 *
 * This is the STATIC declaration — what the integration is and needs. It carries
 * no state: whether it is enabled and whether its credentials are present are
 * database facts, resolved per request and returned by the service.
 */
export interface IIntegrationDescriptor {
    /** Stable identity, and the `Integration.provider` primary key. */
    id: string;
    /** What staff see. Every reference to this integration in the admin uses it. */
    displayName: string;
    /** One line under the name, e.g. "Delivery integration". */
    description: string;
    category: IntegrationCategory;
    /** Empty for an integration that needs no configuration, like MANUAL. */
    credentials: ICredentialDescriptor[];
    /** Absent when this integration receives no callbacks. */
    webhook?: IWebhookDescriptor;
}

/** One credential's state, as disclosed to the admin. */
export interface ICredentialState {
    kind: string;
    label: string;
    secret: boolean;
    placeholder?: string;
    /** Whether a value is stored. Never accompanied by the value itself. */
    present: boolean;
    /**
     * `••••1234`, or null when nothing is stored.
     *
     * The ONLY thing derived from a secret that ever leaves the server — enough
     * for a merchant to tell which value is stored, useless to anyone else. A
     * non-secret credential returns its actual value here instead, which is what
     * `secret: false` means.
     */
    hint: string | null;
}

/**
 * One integration's full state, as returned by `GET /integrations`.
 *
 * NOTE WHAT IS ABSENT: there is no field on this type that can carry a stored
 * secret, and that is the point. A value the API can return is a value an XSS or
 * a logged response can capture, so the shape itself refuses — there is no
 * "reveal" endpoint to add later without changing this interface, which is
 * exactly the friction intended.
 */
export interface IIntegrationState {
    id: string;
    displayName: string;
    description: string;
    category: IntegrationCategory;
    /** Whether the merchant has switched this integration on. */
    enabled: boolean;
    /**
     * Whether every credential this integration requires is present AND
     * readable. False when a credential is missing, and false when one is
     * stored but cannot be decrypted — the distinction goes in `readable`.
     */
    configured: boolean;
    /**
     * False when a stored credential could not be decrypted.
     *
     * Distinguished from `configured` because the two need different fixes and
     * look identical otherwise: an unconfigured integration is fixed by typing
     * the credentials in, and an unreadable one is fixed by restoring the
     * encryption key — typing them in again under the wrong key would just
     * produce more unreadable rows.
     */
    readable: boolean;
    credentials: ICredentialState[];
    /** Present only when this integration receives callbacks. */
    webhook?: {
        label: string;
        instructions: string[];
        configured: boolean;
        /** The full URL to paste into the other side's panel. */
        callbackUrl: string | null;
    };
}

/** One credential being saved. The value is plaintext here and nowhere else. */
export interface IUpdateCredentialsPayload {
    /** Only the kinds the merchant actually filled in; omitted kinds are left as they are. */
    values: Record<string, string>;
}

/** Turning an integration on or off. */
export interface IUpdateIntegrationPayload {
    enabled: boolean;
}

/** The result of generating a webhook secret. */
export interface IGeneratedWebhookSecret {
    /**
     * The generated secret, in plaintext.
     *
     * RETURNED EXACTLY ONCE, from the endpoint that generates it, and never
     * readable again. The merchant has to paste it into the courier's panel, so
     * there is no way to avoid showing it here — but showing it once on the
     * response to an explicit "generate" action is a far narrower surface than a
     * stored value any subsequent read could return.
     */
    secret: string;
    callbackUrl: string;
}
