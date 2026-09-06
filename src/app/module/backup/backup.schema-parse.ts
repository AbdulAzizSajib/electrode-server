import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Reads `prisma/schema/*.prisma` and returns what a backup needs to know about
 * the data model: which models exist, what type each scalar column is, and
 * which side of each relation holds the foreign key.
 *
 * WHY PARSE THE SCHEMA AT ALL — the generated client cannot answer this:
 *
 *   - `Prisma.dmmf` does not exist. This project uses the `prisma-client`
 *     generator (Prisma 7), not `prisma-client-js`; nothing under
 *     `src/generated/prisma/` exports a dmmf.
 *   - `runtimeDataModel` (reachable on the client internals) carries every
 *     model and each relation field's name/kind/type/relationName, but NOT
 *     `relationFromFields`. Without that the foreign-key side is unrecoverable:
 *     `Category.parent` and `Category.children` are identical in shape apart
 *     from the field name. Direction is precisely what a topological sort
 *     needs, so that source cannot produce one.
 *
 * The `.prisma` files state it explicitly — `@relation(fields: [...])` — so
 * they are the source of truth here. They ship to production: the deploy
 * rsyncs `dist/ + package.json + prisma/` (`scripts/server-deploy.sh`).
 *
 * Deliberately narrow. This reads model blocks, their field lines, and the
 * relation attribute. It is not a Prisma parser and must not grow into one —
 * anything it does not understand, it ignores rather than guesses at.
 *
 * See add-database-backup-restore design.md Decision 2.
 */

/** A scalar column, with the Prisma type the serializer encodes it by. */
export interface ParsedScalarField {
    name: string;
    /** `String`, `Int`, `Decimal`, `DateTime`, `Json`, `Boolean`, `BigInt`, `Bytes`, or an enum name. */
    type: string;
    isList: boolean;
    isOptional: boolean;
}

/** A relation field that holds the foreign key — i.e. one carrying `fields: [...]`. */
export interface ParsedRelationField {
    name: string;
    /** The model this points at. */
    type: string;
    /** The scalar column(s) holding the foreign key. Single-column throughout this schema. */
    fromFields: string[];
    isOptional: boolean;
}

export interface ParsedModel {
    name: string;
    scalars: ParsedScalarField[];
    /**
     * Only the owning side of each relation — the side that declares
     * `fields: [...]`. A back-relation (`children Category[]`) is not listed:
     * it holds no column and imposes no write-order constraint.
     */
    relations: ParsedRelationField[];
}

/**
 * Fields Prisma understands that are not columns. `@relation` is handled
 * separately; these are attribute lines inside a model block.
 */
const BLOCK_ATTRIBUTE = /^@@/;

/** `model Foo {` — the start of a block. */
const MODEL_START = /^model\s+([A-Za-z_][A-Za-z0-9_]*)\s*\{/;

/**
 * A field line: `name  Type[]?  @attr(...)`. The type is captured without its
 * list/optional markers, which are read separately.
 */
const FIELD_LINE = /^([A-Za-z_][A-Za-z0-9_]*)\s+([A-Za-z_][A-Za-z0-9_]*)(\[\])?(\?)?(.*)$/;

/** `fields: [a]` or `fields: [a, b]` inside an `@relation(...)`. */
const RELATION_FIELDS = /@relation\s*\([^)]*\bfields:\s*\[([^\]]*)\]/;

/**
 * Scalar types Prisma defines. Anything else in type position is either a
 * model (a relation) or an enum — both are resolved after every block is read,
 * because a model may reference one declared later in the file.
 */
const SCALAR_TYPES = new Set([
    "String",
    "Boolean",
    "Int",
    "BigInt",
    "Float",
    "Decimal",
    "DateTime",
    "Json",
    "Bytes",
]);

/**
 * Where `prisma/schema` lives, relative to this file at runtime.
 *
 * Resolved by walking up for the directory that contains it rather than
 * assuming a fixed depth: in development this file runs from `src/app/module/
 * backup/`, and in production from `dist/app/module/backup/`, with `prisma/`
 * beside `dist/` either way. A fixed `../../../..` would be right in exactly
 * one of those.
 */
const findSchemaDir = (): string => {
    // The package is ESM (`"type": "module"`), so `__dirname` does not exist —
    // derived from `import.meta.url`, the same way the generated client does it.
    let dir = path.dirname(fileURLToPath(import.meta.url));

    for (let i = 0; i < 10; i++) {
        const candidate = path.join(dir, "prisma", "schema");
        if (fs.existsSync(candidate)) return candidate;

        const parent = path.dirname(dir);
        if (parent === dir) break;
        dir = parent;
    }

    throw new Error(
        "Could not locate prisma/schema. The backup module reads the schema " +
            "files to determine table order; they must be deployed alongside the " +
            "application (the deploy rsyncs `prisma/` — see scripts/server-deploy.sh).",
    );
};

/** Strips a `//` comment, leaving string literals alone (none appear in field lines). */
const stripComment = (line: string): string => {
    const index = line.indexOf("//");
    return index === -1 ? line : line.slice(0, index);
};

/**
 * Parses one `.prisma` file's model blocks.
 *
 * Enum and other top-level blocks are skipped: only `model` introduces a table.
 */
const parseModels = (source: string): ParsedModel[] => {
    const models: ParsedModel[] = [];
    const lines = source.split(/\r?\n/);

    let current: ParsedModel | null = null;

    for (const raw of lines) {
        const line = stripComment(raw).trim();
        if (!line) continue;

        if (!current) {
            const start = MODEL_START.exec(line);
            if (start) {
                current = { name: start[1], scalars: [], relations: [] };
            }
            continue;
        }

        if (line === "}") {
            models.push(current);
            current = null;
            continue;
        }

        // `@@index`, `@@unique`, `@@map` — block-level, not columns.
        if (BLOCK_ATTRIBUTE.test(line)) continue;

        const field = FIELD_LINE.exec(line);
        if (!field) continue;

        const [, name, type, list, optional, rest] = field;
        const isList = Boolean(list);
        const isOptional = Boolean(optional);

        const relation = RELATION_FIELDS.exec(rest);
        if (relation) {
            // The owning side: it declares the foreign key column(s).
            current.relations.push({
                name,
                type,
                fromFields: relation[1]
                    .split(",")
                    .map((part) => part.trim())
                    .filter(Boolean),
                isOptional,
            });
            continue;
        }

        // A relation field with no `fields:` is the back-relation (`children
        // Category[]`, `posts Post[]`). It holds no column, so it is neither a
        // scalar to serialize nor a write-order constraint. Recognised by its
        // type resolving to a model, which cannot be known until every block
        // has been read — deferred to `resolveScalars` below.
        current.scalars.push({ name, type, isList, isOptional });
    }

    return models;
};

/**
 * Drops the entries in `scalars` whose type is actually a model — the
 * back-relations that `parseModels` could not classify while reading.
 *
 * Enums stay: an enum column is a real column and round-trips as its string
 * value, which is what the database stores.
 */
const resolveScalars = (models: ParsedModel[]): ParsedModel[] => {
    const modelNames = new Set(models.map((model) => model.name));

    return models.map((model) => ({
        ...model,
        scalars: model.scalars.filter((field) => !modelNames.has(field.type)),
    }));
};

let cached: ParsedModel[] | null = null;

/**
 * The parsed data model, read once per process.
 *
 * Cached because the schema cannot change while the server runs, and both the
 * backup and the restore ask for it repeatedly.
 */
export const getParsedModels = (): ParsedModel[] => {
    if (cached) return cached;

    const schemaDir = findSchemaDir();
    const files = fs
        .readdirSync(schemaDir)
        .filter((file) => file.endsWith(".prisma"))
        .sort();

    const parsed = files.flatMap((file) =>
        parseModels(fs.readFileSync(path.join(schemaDir, file), "utf8")),
    );

    if (parsed.length === 0) {
        throw new Error(`No models found in ${schemaDir} — the backup module cannot determine table order.`);
    }

    cached = resolveScalars(parsed);
    return cached;
};

/** Test seam: forces the next `getParsedModels()` to re-read from disk. */
export const clearParsedModelsCache = () => {
    cached = null;
};

export const isScalarType = (type: string) => SCALAR_TYPES.has(type);
