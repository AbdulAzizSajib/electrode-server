/**
 * Shared slug helpers for catalog models (Category, Brand, Product) whose
 * `slug` column is a unique, stable lookup key (see `api/catalog` spec:
 * "Category and brand slugs are stable, unique lookup keys").
 */

export const slugify = (value: string): string => {
    return value
        .toString()
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9\s-]/g, "")
        .replace(/[\s_-]+/g, "-")
        .replace(/^-+|-+$/g, "");
};

/**
 * Turns `base` (a raw name, or a caller-supplied slug candidate) into a
 * unique slug by appending `-2`, `-3`, ... until `checkExists` reports no
 * collision. `checkExists` should scope the uniqueness check to the correct
 * model (and, on update, exclude the record being updated).
 */
export const generateUniqueSlug = async (
    base: string,
    checkExists: (candidate: string) => Promise<boolean>,
): Promise<string> => {
    const baseSlug = slugify(base);
    let candidate = baseSlug;
    let counter = 2;

    while (await checkExists(candidate)) {
        candidate = `${baseSlug}-${counter}`;
        counter += 1;
    }

    return candidate;
};
