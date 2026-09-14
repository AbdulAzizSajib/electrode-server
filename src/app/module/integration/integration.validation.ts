/**
 * Zod shapes for the integration endpoints.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * NO SCHEMA HERE MAY PRODUCE AN ERROR MESSAGE CONTAINING THE SUBMITTED VALUE.
 *
 * This is the one rule that makes this file different from every other
 * `.validation.ts` in the codebase, and it is not theoretical. Two of Zod's
 * built-in messages interpolate the input — `z.enum` ("Invalid option: expected
 * one of ... received 'sk_live_abc123'") and `z.literal` — and
 * `globalErrorHandler` serialises the whole error object into the response when
 * `NODE_ENV === 'development'`. A secret that reaches a validation error reaches
 * the response body, the browser's network tab, and any proxy log in between.
 *
 * So: credential values are validated as plain strings with explicit messages
 * that describe the constraint and never quote the input, and the KEY is
 * validated instead of the value wherever a set of allowed options is involved.
 * The service performs the "is this a declared kind" check, where it can name
 * the kind (which is public) rather than the value (which is not).
 *
 * Do not add `.regex()` with a custom message that interpolates, do not switch a
 * value field to `z.enum`, and do not add `.refine()` whose message includes the
 * value being refined.
 *
 * See openspec/changes/rename-courier-setting-to-integrations, design.md
 * Decision 5.
 */
import z from "zod";

/**
 * A credential value.
 *
 * Bounded at both ends, with messages that quote nothing. The upper bound is
 * generous — some OAuth tokens are genuinely long — but not unbounded, because
 * an unbounded text column reachable by an authenticated endpoint is a cheap way
 * to fill a database.
 */
const credentialValueSchema = z
    .string({ error: "Each credential must be sent as a string." })
    .max(4096, { error: "That credential is too long; check it was pasted correctly." });

/**
 * `PUT /integrations/:provider/credentials`
 *
 * A partial map of kind → value. Kinds the merchant did not fill in are absent,
 * and the service leaves those credentials untouched — which is what lets the
 * admin form submit only what was typed, rather than having to resend secrets it
 * does not have in order to avoid clearing them.
 *
 * A blank value is accepted here and ignored by the service. Rejecting it would
 * mean a merchant who focuses and leaves a field gets a validation error; wiping
 * on blank would mean the same gesture silently deletes a working API key.
 * Ignoring is the only option that cannot cause a dispatch outage.
 *
 * WHICH kinds are valid is deliberately NOT checked here: that depends on the
 * provider in the URL, which a body schema cannot see, and the service refuses
 * an undeclared kind with a message naming the kind rather than the value.
 */
export const updateCredentialsZodSchema = z.object({
    values: z
        .record(z.string(), credentialValueSchema, {
            error: "Credentials must be sent as an object of field names to values.",
        })
        .refine((values) => Object.keys(values).length > 0, {
            error: "Send at least one credential to save.",
        }),
});

/**
 * `PATCH /integrations/:provider`
 *
 * Enabling or disabling. Deliberately its own endpoint and its own schema rather
 * than a field on the credentials payload: toggling an integration off must not
 * require resending its credentials, and saving credentials must not silently
 * flip its enabled state.
 */
export const updateIntegrationZodSchema = z.object({
    enabled: z.boolean({ error: "enabled must be true or false." }),
});

/**
 * `PUT /integrations/:provider/webhook`
 *
 * Generating a secret takes no input — the server produces the value, because a
 * merchant-chosen webhook secret is a merchant-chosen password. The body is
 * accepted and ignored so the endpoint stays a plain PUT with a JSON content
 * type, which is what the admin's fetch layer sends.
 */
export const generateWebhookZodSchema = z.object({}).loose();
