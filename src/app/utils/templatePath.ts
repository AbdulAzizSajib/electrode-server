import path from "path";

/**
 * Absolute path to the EJS template directory.
 *
 * The templates are NOT compiled — `tsc` only emits the files it compiles, so
 * `.ejs` never appears under `dist/`. They are shipped to the Vercel function
 * verbatim from `src/` via `includeFiles` in vercel.json, which means `src/app/
 * templates` is the correct location in every environment: locally it is the
 * source tree, and on Vercel it is what the bundler copied in.
 *
 * Keep this path and `includeFiles` in vercel.json in step — they name the same
 * directory, and nothing fails at build time if they drift. The previous
 * mismatch (`includeFiles` pointed at `dist/app/templates`, a directory the
 * build never created) shipped a function with no views at all: the OTP mail
 * path threw ENOENT and the Google OAuth redirect rendered nothing, surfacing
 * as FUNCTION_INVOCATION_FAILED rather than as a missing file.
 *
 * `process.cwd()` is the function's root on Vercel and the package root
 * locally, which is why it is right here — but it is only right because the
 * path is relative to the project, not to this module. Do not rewrite this to
 * be module-relative without also copying the templates into `dist/`.
 */
export const TEMPLATES_DIR = path.resolve(process.cwd(), "src/app/templates");

/** Absolute path to a single template, by name and without the extension. */
export const templateFile = (templateName: string): string =>
    path.join(TEMPLATES_DIR, `${templateName}.ejs`);
