import { Prisma } from "../../../generated/prisma/client";
import { getParsedModels, type ParsedScalarField } from "./backup.schema-parse";

/**
 * Turns rows into JSON-safe values and back.
 *
 * The problem this solves: `JSON.stringify` is lossy for the types this schema
 * actually uses, and the loss is silent.
 *
 *   - `Decimal` serializes to a bare string — `"750"` — which is
 *     indistinguishable from a `String` column holding "750". Reading it back
 *     as a number would turn money into a float, and this schema stores money
 *     as `Decimal(12,2)`: `0.1 + 0.2` arithmetic on an order total is exactly
 *     the bug that must not be introduced by a backup round-trip.
 *   - `DateTime` serializes to an ISO string, likewise indistinguishable from
 *     a `String` column that happens to hold one.
 *
 * So decoding is driven by the schema's DECLARED type for each column, never
 * by the shape of the JSON value. `backup.schema-parse.ts` supplies those
 * types. A value's own appearance is never consulted, because appearance is
 * precisely what is ambiguous.
 *
 * See add-database-backup-restore design.md Decision 1.
 */

/** A JSON-safe value: what `JSON.stringify` can round-trip without loss. */
export type EncodedValue = string | number | boolean | null | EncodedValue[] | { [key: string]: EncodedValue };

export type EncodedRow = Record<string, EncodedValue>;

/**
 * Encodes one value according to its declared Prisma type.
 *
 * `null` passes through as `null` — distinct from `""`, which matters for
 * nullable text columns where "not said" and "said nothing" differ.
 */
const encodeValue = (value: unknown, type: string): EncodedValue => {
    if (value === null || value === undefined) return null;

    switch (type) {
        case "Decimal":
            // As a string, preserving scale exactly. `toString()` on a Decimal
            // never goes through a float, so trailing zeros and precision
            // survive as stored.
            return String(value);

        case "DateTime":
            return value instanceof Date ? value.toISOString() : String(value);

        case "BigInt":
            // Not present in this schema today, but a BigInt would overflow a
            // JSON number, so it is carried as a string.
            return String(value);

        case "Bytes":
            return Buffer.isBuffer(value)
                ? value.toString("base64")
                : Buffer.from(value as Uint8Array).toString("base64");

        case "Json":
            // Already JSON by definition — passed through untouched, including
            // a legitimately-null JSON value.
            return value as EncodedValue;

        case "Int":
        case "Float":
        case "Boolean":
        case "String":
            return value as EncodedValue;

        default:
            // An enum. Stored and returned as its string name, which is what
            // the database column holds.
            return value as EncodedValue;
    }
};

/**
 * Decodes one value back to what Prisma expects on write.
 *
 * The inverse of `encodeValue`, and deliberately the same switch: if a type is
 * added to one it must be added to the other, and having them adjacent is what
 * makes that obvious.
 */
const decodeValue = (value: EncodedValue, type: string): unknown => {
    if (value === null || value === undefined) return null;

    switch (type) {
        case "Decimal":
            // Reconstructed as a Decimal, never a float. This is the single
            // most important line in this file.
            return new Prisma.Decimal(value as string);

        case "DateTime":
            return new Date(value as string);

        case "BigInt":
            return BigInt(value as string);

        case "Bytes":
            return Buffer.from(value as string, "base64");

        case "Json":
            return value;

        case "Int":
        case "Float":
        case "Boolean":
        case "String":
            return value;

        default:
            // An enum — the string name is what Prisma accepts.
            return value;
    }
};

/** The scalar columns of each model, by model name, computed once. */
let fieldsByModel: Map<string, ParsedScalarField[]> | null = null;

const getFieldsFor = (modelName: string): ParsedScalarField[] => {
    if (!fieldsByModel) {
        fieldsByModel = new Map(getParsedModels().map((model) => [model.name, model.scalars]));
    }

    const fields = fieldsByModel.get(modelName);
    if (!fields) {
        throw new Error(`Unknown model "${modelName}" — it is not in the parsed schema.`);
    }
    return fields;
};

/**
 * Encodes every row of one table.
 *
 * Only declared scalar columns are carried. A relation object that a caller
 * accidentally `include`d is dropped rather than serialized, so a backup can
 * never contain the same row twice under two different tables.
 */
export const encodeRows = (modelName: string, rows: Record<string, unknown>[]): EncodedRow[] => {
    const fields = getFieldsFor(modelName);

    return rows.map((row) => {
        const encoded: EncodedRow = {};
        for (const field of fields) {
            if (!(field.name in row)) continue;
            encoded[field.name] = encodeValue(row[field.name], field.type);
        }
        return encoded;
    });
};

/** Decodes every row of one table, ready to be written back. */
export const decodeRows = (modelName: string, rows: EncodedRow[]): Record<string, unknown>[] => {
    const fields = getFieldsFor(modelName);

    return rows.map((row) => {
        const decoded: Record<string, unknown> = {};
        for (const field of fields) {
            if (!(field.name in row)) continue;
            decoded[field.name] = decodeValue(row[field.name], field.type);
        }
        return decoded;
    });
};

/**
 * Checks that a table's rows look like rows of that table, before a restore
 * deletes anything.
 *
 * Deliberately shallow: it confirms each row is an object and carries no
 * column the model does not declare. Type-checking every value would duplicate
 * the database's own constraint checking, which runs inside the restore
 * transaction and rolls back on violation — so the useful thing to catch here
 * is a file describing a *different schema*, which an unknown column reveals.
 */
export const assertRowsMatchModel = (modelName: string, rows: unknown): asserts rows is EncodedRow[] => {
    if (!Array.isArray(rows)) {
        throw new Error(`Table "${modelName}" in the backup is not a list of rows.`);
    }

    const known = new Set(getFieldsFor(modelName).map((field) => field.name));

    for (const [index, row] of rows.entries()) {
        if (typeof row !== "object" || row === null || Array.isArray(row)) {
            throw new Error(`Row ${index} of table "${modelName}" in the backup is not an object.`);
        }

        for (const column of Object.keys(row)) {
            if (!known.has(column)) {
                throw new Error(
                    `Table "${modelName}" in the backup has an unknown column "${column}". ` +
                        `The backup was probably taken from a different schema version.`,
                );
            }
        }
    }
};

/** Test seam: forces the next call to re-read the parsed schema. */
export const clearSerializeCache = () => {
    fieldsByModel = null;
};
