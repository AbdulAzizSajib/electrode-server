/**
 * Checks that the Postman collection and the server agree on every route.
 *
 * A collection nobody checks drifts silently: a renamed endpoint keeps its old
 * entry, a new one never gets an entry at all, and the drift is only found by
 * someone following the docs into a 404.
 *
 * Reads the route files rather than introspecting Express. Express 5 no longer
 * exposes a layer's mount path — it compiles matchers instead — so walking the
 * live router would mean reverse-engineering private internals that change
 * between minor versions. The route files are the source of truth anyway, and
 * parsing them is something a reader can follow.
 *
 * Run with: npx tsx scripts/verify-postman-routes.ts
 */
import fs from "node:fs";
import path from "node:path";

const SERVER_ROOT = process.cwd();
const MODULE_DIR = path.join(SERVER_ROOT, "src", "app", "module");
const INDEX_ROUTES = path.join(SERVER_ROOT, "src", "app", "routes", "index.ts");
const COLLECTION = path.join(SERVER_ROOT, "postman", "Ecom.postman_collection.json");

interface PostmanItem {
    name: string;
    item?: PostmanItem[];
    request?: { method: string; url: { path?: string[] } };
}

/** `:id`, `{{productId}}` and a literal cuid are all one slot to a router. */
const asSlot = (segment: string) =>
    /^(\{\{.+\}\}|:.+)$/.test(segment) ? ":param" : segment;

const normalisePath = (segments: string[]) => "/" + segments.map(asSlot).join("/");

/**
 * `router.use("/products", ProductRoutes)` → `["/products", "ProductRoutes"]`.
 *
 * Mount order matters on the server — `/products/:id/reviews` is declared above
 * `/products` so the latter's `/:slug` cannot swallow it — but not here, since
 * this only compares sets.
 */
const readMounts = (): { prefix: string; routerName: string }[] => {
    const source = fs.readFileSync(INDEX_ROUTES, "utf8");
    const mounts: { prefix: string; routerName: string }[] = [];
    const pattern = /router\.use\(\s*"([^"]+)"\s*,\s*(\w+)\s*\)/g;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(source)) !== null) {
        mounts.push({ prefix: match[1], routerName: match[2] });
    }
    return mounts;
};

/**
 * Every `<variable>.<method>("<path>")` in a route file, grouped by the router
 * variable it was called on — a file can define two (see coupon.route.ts, which
 * exports both a cart-scoped and an admin-scoped router).
 */
const readRouteFile = (file: string) => {
    const source = fs.readFileSync(file, "utf8");

    const exports = new Map<string, string>(); // exported name -> variable
    const exportPattern = /export const (\w+)\s*=\s*(\w+);/g;
    let match: RegExpExecArray | null;
    while ((match = exportPattern.exec(source)) !== null) {
        exports.set(match[1], match[2]);
    }

    const byVariable = new Map<string, string[]>();
    const callPattern = /(\w+)\.(get|post|patch|put|delete)\(\s*"([^"]*)"/g;
    while ((match = callPattern.exec(source)) !== null) {
        const [, variable, method, routePath] = match;
        const list = byVariable.get(variable) ?? [];
        list.push(`${method.toUpperCase()} ${routePath}`);
        byVariable.set(variable, list);
    }

    return { exports, byVariable };
};

const main = () => {
    const mounts = readMounts();

    // exported router name -> its own method+path pairs
    const routesByExport = new Map<string, string[]>();
    for (const dir of fs.readdirSync(MODULE_DIR)) {
        const file = path.join(MODULE_DIR, dir, `${dir}.route.ts`);
        if (!fs.existsSync(file)) continue;
        const { exports, byVariable } = readRouteFile(file);
        for (const [exportedName, variable] of exports) {
            routesByExport.set(exportedName, byVariable.get(variable) ?? []);
        }
    }

    const mounted = new Set<string>();
    const unresolved: string[] = [];
    for (const { prefix, routerName } of mounts) {
        const routes = routesByExport.get(routerName);
        if (!routes) {
            unresolved.push(`${prefix} → ${routerName}`);
            continue;
        }
        for (const route of routes) {
            const [method, routePath] = route.split(" ");
            const full = (prefix + (routePath === "/" ? "" : routePath))
                .replace(/\/:[^/]+/g, "/:param")
                .replace(/\{\{[^}]+\}\}/g, ":param");
            mounted.add(`${method} ${full || "/"}`);
        }
    }

    const collection = JSON.parse(fs.readFileSync(COLLECTION, "utf8")) as { item: PostmanItem[] };

    const documented = new Map<string, string[]>();
    const walk = (items: PostmanItem[], trail: string) => {
        for (const item of items) {
            if (item.item) {
                walk(item.item, `${trail}/${item.name}`);
            } else if (item.request?.url?.path) {
                const key = `${item.request.method} ${normalisePath(item.request.url.path)}`;
                documented.set(key, [...(documented.get(key) ?? []), `${trail}/${item.name}`]);
            }
        }
    };
    walk(collection.item, "");

    const notOnServer = [...documented.keys()].filter((r) => !mounted.has(r)).sort();
    const notDocumented = [...mounted].filter((r) => !documented.has(r)).sort();

    console.log(`Mounted routes:      ${mounted.size}`);
    console.log(`Documented requests: ${[...documented.values()].flat().length}`);
    console.log(`Distinct paths:      ${documented.size}\n`);

    if (unresolved.length > 0) {
        console.log("MOUNTED BUT NO ROUTE FILE FOUND (this script cannot see them):");
        for (const line of unresolved) console.log(`  ${line}`);
        console.log();
    }

    if (notOnServer.length > 0) {
        console.log("IN THE COLLECTION BUT NOT ON THE SERVER — these would 404:");
        for (const route of notOnServer) {
            console.log(`  ${route}`);
            for (const name of documented.get(route) ?? []) console.log(`      ${name}`);
        }
        console.log();
    }

    if (notDocumented.length > 0) {
        console.log("ON THE SERVER BUT NOT IN THE COLLECTION:");
        for (const route of notDocumented) console.log(`  ${route}`);
        console.log();
    }

    if (notOnServer.length === 0 && notDocumented.length === 0) {
        console.log("The collection and the server agree on every route.");
    }

    // Only a documented route that does not exist is a failure. An undocumented
    // route is worth reporting but is not wrong in the same way — the auth
    // callback routes, for instance, are never called by hand.
    process.exit(notOnServer.length > 0 ? 1 : 0);
};

main();
