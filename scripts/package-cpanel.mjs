/*
 * Turns the compiled server into one archive a cPanel / Passenger host runs
 * with `node app.js`. Run after `npm run build` — `npm run build:cpanel` does
 * both. Deployment steps are in CPANEL-DEPLOY.md.
 *
 * Unlike the storefront's package-standalone.mjs, there is no tracing step that
 * works out the needed dependencies: the archive carries a full production
 * `node_modules`, installed fresh into the staging tree. That is deliberate.
 * cPanel's "Run NPM Install" button builds against the host's toolchain and
 * regularly fails on a shared plan, so the tree ships prebuilt instead.
 *
 * Shipping a Windows-built tree is only safe because Prisma 7 runs through the
 * PrismaPg driver adapter — pure JavaScript, no platform-specific query engine.
 * Verified: no `.node` binary exists anywhere under @prisma. If a native
 * dependency is ever added (sharp, bcrypt, better-sqlite3), this script stops
 * being portable and the tree must be installed on the host or on Linux.
 *
 * `tar` rather than PowerShell's Compress-Archive, whose 5.1 build writes `\`
 * separators that Linux `unzip` turns into literal filenames.
 */
import { execFileSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ARCHIVE = "backend.tar.gz";

if (!existsSync(join(root, "dist", "app", "server.js"))) {
  console.error(
    "dist/app/server.js not found — run `npm run build` first.",
  );
  process.exit(1);
}

/*
 * The one check that catches a skipped fix-imports.js. `tsc` emits
 * extensionless relative imports that Node's ESM loader rejects, so an archive
 * built without it compiles cleanly and then dies on boot with
 * ERR_MODULE_NOT_FOUND — on the host, where the error is hardest to read.
 */
const entry = join(root, "dist", "app", "server.js");
if (/from\s+["']\.\.?\/[^"']*(?<!\.js)["']/.test(readFileSync(entry, "utf8"))) {
  console.error(
    "dist/ has extensionless relative imports — `scripts/fix-imports.js` did not run.\n" +
      "Use `npm run build` (which runs it), not a bare `tsc`.",
  );
  process.exit(1);
}

/*
 * `payload/` is a level below the temp root so the archive can be written
 * beside it rather than inside it — tar packing its own growing output
 * otherwise races and corrupts the file.
 */
const tmpRoot = mkdtempSync(join(tmpdir(), "electrode-cpanel-"));
const staging = join(tmpRoot, "payload");

try {
  cpSync(join(root, "dist"), join(staging, "dist"), { recursive: true });
  cpSync(join(root, "package.json"), join(staging, "package.json"));

  /*
   * EJS templates are read from disk at runtime (OTP mail, the Google redirect
   * page) and live under src/, which tsc does not copy. vercel.json lists them
   * as includeFiles for the same reason.
   */
  cpSync(
    join(root, "src", "app", "templates"),
    join(staging, "src", "app", "templates"),
    { recursive: true },
  );

  /*
   * Migrations ship so `npx prisma migrate deploy` can run from the host over
   * cPanel Terminal. The schema comes along because the migrate command reads
   * it through prisma.config.ts.
   */
  cpSync(join(root, "prisma"), join(staging, "prisma"), { recursive: true });
  cpSync(join(root, "prisma.config.ts"), join(staging, "prisma.config.ts"));

  /*
   * A fresh production install into the staging tree, NOT a copy of
   * server/node_modules.
   *
   * This is an npm workspace: the root hoists every shared dependency, so
   * server/node_modules holds almost nothing (a handful of dev-only type
   * packages) and carries no express, no @prisma, no pg. Copying it produces
   * an archive that unpacks cleanly and then dies on the first require.
   * Verified the hard way — an earlier build of this script shipped 333 files
   * and zero runtime dependencies.
   *
   * `--omit=dev` because the host only ever runs the compiled output, and
   * `--ignore-scripts` because postinstall hooks here would run against the
   * build machine's platform. Prisma's client is already generated into dist/
   * by `npm run build`, so nothing is lost by skipping them.
   */
  console.log("Installing production dependencies into staging…");
  /*
   * `shell: true` on Windows because npm is a `.cmd` shim, and Node 22 refuses
   * to spawn one directly — it fails with EINVAL rather than running it.
   */
  execFileSync(
    "npm",
    ["install", "--omit=dev", "--ignore-scripts", "--no-audit", "--no-fund"],
    { cwd: staging, stdio: "inherit", shell: process.platform === "win32" },
  );

  /*
   * Passenger starts the app by requiring the startup file from the app root,
   * so the entry lives at the top rather than at dist/app/server.js — cPanel's
   * "Application startup file" field takes a path, but CloudLinux resolves
   * node_modules from the app root only, and a nested entry has bitten this
   * deployment's storefront sibling before (see CPANEL-DEPLOY.md §5).
   */
  writeFileSync(
    join(staging, "app.js"),
    [
      "/*",
      " * Passenger entry point. Generated by scripts/package-cpanel.mjs —",
      " * edit that script, not this file.",
      " *",
      " * server.js seeds the super admin and calls app.listen(PORT). Passenger",
      " * supplies PORT, so no port is configured here.",
      " */",
      'import "./dist/app/server.js";',
      "",
    ].join("\n"),
  );

  rmSync(join(root, ARCHIVE), { force: true });
  /*
   * Relative paths only, with `cwd` doing the work of `-C`: GNU tar (Git Bash)
   * splits an absolute Windows path on the colon and reads `D:` as a remote
   * host, failing with status 2. So the archive is written inside the staging
   * directory and moved afterwards, rather than named by absolute path here.
   */
  execFileSync("tar", ["-czf", ARCHIVE, "-C", "payload", "."], {
    cwd: tmpRoot,
    stdio: "inherit",
  });
  cpSync(join(tmpRoot, ARCHIVE), join(root, ARCHIVE));

  console.log(`Packed ${join(root, ARCHIVE)}`);
} finally {
  rmSync(tmpRoot, { recursive: true, force: true });
}
