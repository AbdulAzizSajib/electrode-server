import { getParsedModels, type ParsedModel } from "./backup.schema-parse";

/**
 * Which tables a backup covers, and the order they must be written and deleted
 * in.
 *
 * The order is derived, never hand-written: a list of 57 table names maintained
 * by hand is wrong the first time someone adds a model and forgets it, and the
 * failure surfaces as a foreign-key error during a restore — on the day someone
 * most needs the restore to work.
 *
 * See add-database-backup-restore design.md Decision 2.
 */

/**
 * Models a backup deliberately excludes. Everything else is included, so a
 * model added later is backed up by default — the safe direction to be wrong in.
 */
const EXCLUDED_MODELS = new Set([
    /** Restoring a session would revive a login that had been signed out. */
    "Session",
    /** Short-lived email/OTP challenges; a restored one is stale by definition. */
    "Verification",
    /** The record of what was done to the shop, including the restore itself — restoring it would erase the evidence of the operation being performed. */
    "AuditLog",
    /** Per-user and transient; restoring old notifications tells users about things that already happened. */
    "Notification",
]);

/**
 * The Prisma client property for a model — `User` -> `prisma.user`.
 *
 * Lowercasing the first letter only, which is what Prisma does. It is NOT the
 * `@@map` name: four models here map to lowercase table names (`user`,
 * `account`, `session`, `verification`) while the client property is still
 * derived from the model name.
 */
export const clientKeyOf = (modelName: string): string =>
    modelName.charAt(0).toLowerCase() + modelName.slice(1);

export interface TableOrder {
    /** Dependency-first: a model appears after everything it points at. */
    writeOrder: string[];
    /** The exact reverse of `writeOrder`. */
    deleteOrder: string[];
    /**
     * Models holding a foreign key onto themselves (`Category.parentId`).
     * Their rows cannot be ordered by table order alone — the restore inserts
     * them with the self-referencing column null and patches it afterwards.
     */
    selfReferencing: { model: string; columns: string[] }[];
}

/** Included models, in schema order (not yet a write order). */
const includedModels = (): ParsedModel[] =>
    getParsedModels().filter((model) => !EXCLUDED_MODELS.has(model.name));

/**
 * Topologically sorts the included models so that every model comes after the
 * models it holds a foreign key onto.
 *
 * A self-reference is not an ordering constraint — a table cannot come after
 * itself — so it is skipped here and handled by `selfReferencing` instead.
 *
 * Depth-first with an explicit "in progress" marker, so a cycle is detected as
 * a cycle rather than silently producing a plausible-but-wrong order. A wrong
 * order fails at restore time with a foreign-key violation that says nothing
 * about the real cause.
 */
const topologicalSort = (models: ParsedModel[]): string[] => {
    const byName = new Map(models.map((model) => [model.name, model]));
    const sorted: string[] = [];
    const settled = new Set<string>();
    const inProgress = new Set<string>();

    const visit = (name: string, path: string[]) => {
        if (settled.has(name)) return;

        if (inProgress.has(name)) {
            const cycle = [...path.slice(path.indexOf(name)), name].join(" -> ");
            throw new Error(
                `Cyclic foreign keys between models: ${cycle}. A backup cannot ` +
                    `derive a safe write order for a cycle; break it or exclude one ` +
                    `of the models (see backup.tables.ts).`,
            );
        }

        const model = byName.get(name);
        // Points at an excluded model — no ordering constraint, because that
        // table is neither deleted nor written by a restore.
        if (!model) return;

        inProgress.add(name);

        for (const relation of model.relations) {
            if (relation.type === name) continue; // self-reference, handled separately
            visit(relation.type, [...path, name]);
        }

        inProgress.delete(name);
        settled.add(name);
        sorted.push(name);
    };

    // Sorted by name first so the output is deterministic run to run: the
    // dependency constraints leave many valid orders, and a stable one makes
    // a backup file diffable and a failure reproducible.
    for (const model of [...models].sort((a, b) => a.name.localeCompare(b.name))) {
        visit(model.name, []);
    }

    return sorted;
};

let cached: TableOrder | null = null;

/**
 * The table order, computed once per process.
 *
 * Throws on a cycle. Called during a backup and a restore, and by the startup
 * check, so a schema that cannot be ordered is reported before anyone relies
 * on a backup of it.
 */
export const getTableOrder = (): TableOrder => {
    if (cached) return cached;

    const models = includedModels();
    const writeOrder = topologicalSort(models);

    const selfReferencing = models
        .map((model) => ({
            model: model.name,
            columns: model.relations
                .filter((relation) => relation.type === model.name)
                .flatMap((relation) => relation.fromFields),
        }))
        .filter((entry) => entry.columns.length > 0);

    cached = {
        writeOrder,
        deleteOrder: [...writeOrder].reverse(),
        selfReferencing,
    };

    return cached;
};

/** Test seam: forces the next `getTableOrder()` to recompute. */
export const clearTableOrderCache = () => {
    cached = null;
};

export const isExcluded = (modelName: string) => EXCLUDED_MODELS.has(modelName);
