import { toNodeHandler } from "better-auth/node";
import cookieParser from "cookie-parser";
import cors from "cors";
import express, { Application, Request, Response } from "express";
// import cron from "node-cron";
import qs from "qs";
import { envVars } from "./config/env";
import { auth } from "./lib/auth";
import { DEMO_KEY_HEADER, resolveDemoKey, runInDemoScope } from "./lib/tenant";
import { globalErrorHandler } from "./middleware/globalErrorHandler";
import { notFound } from "./middleware/notFound";
import { TEMPLATES_DIR } from "./utils/templatePath";

import { IndexRoutes } from "./routes";

const app: Application = express();
app.set("query parser", (str : string) => qs.parse(str));

// This deployment sits behind a proxy, so without this `req.ip` is the
// proxy's address and every visitor looks like the same client. Guest
// checkout rate-limits per IP (see order.service.ts), which would then
// throttle all guests collectively instead of one abuser.
//
// Set to 1, not `true`: trusting the whole chain lets a client forge
// X-Forwarded-For and pick its own apparent IP, which defeats the limit.
// One hop trusts only the platform's own proxy.
app.set("trust proxy", 1);

app.set("view engine", "ejs");
// The .ejs views are never compiled, so they live under `src/` in every
// environment and reach the Vercel function via `includeFiles` in vercel.json.
// See utils/templatePath.ts — that path and vercel.json must stay in step.
app.set("views", TEMPLATES_DIR)

/*
 * The three deployed origins, plus the local dev ports.
 *
 * ADMIN_URL is separate from the other two and easy to forget: FRONTEND_URL is
 * the storefront, BETTER_AUTH_URL is this server, and the admin panel is a third
 * deployment of its own. Omitting it fails CORS preflight on every admin
 * request, which presents as "the panel loads but nothing works" rather than as
 * a configuration error.
 *
 * `.filter(Boolean)` because all three are optional in some environments, and
 * `undefined` in this array would match an origin-less request.
 *
 * Deliberately an exact list rather than a `*.vercel.app` pattern: `credentials`
 * is true below, so a wildcard would let any site on that shared domain make
 * authenticated requests with a visitor's cookies. Preview deployments get
 * fresh URLs and are therefore not covered — that is the accepted cost.
 */
const allowedOrigins = [
    envVars.FRONTEND_URL,
    envVars.BETTER_AUTH_URL,
    envVars.ADMIN_URL,
    "http://localhost:4000",
    "http://localhost:5000",
    "http://localhost:5173",
    "https://edemo1.topitsolution.com",
    "https://api.topitsolution.com",
    "https://admin.topitsolution.com",
    "https://edemo2.topitsolution.com",
    "https://apiedemo2.vercel.app",
    "https://adminedemo2.vercel.app",
    "https://edemo3.topitsolution.com",
    "https://apiedemo3.vercel.app",
    "https://adminedemo3.vercel.app",

].filter(Boolean) as string[];

app.use(cors({
    origin : allowedOrigins,
    credentials : true,
    methods : ["GET", "POST", "PUT", "DELETE", "PATCH"],
    // Idempotency-Key rides on checkout (see order.controller.ts). It reaches the
    // server today only because the storefront proxies through its own origin;
    // a direct browser call would have it stripped by preflight without this.
    //
    // The demo key is listed for the same reason and it matters more here: the
    // admin panel calls this API from the browser, cross-origin, so without it
    // preflight drops the header and every demo's admin would quietly edit the
    // DATABASE_URL shop instead of its own.
    allowedHeaders : ["Content-Type", "Authorization", "Idempotency-Key", DEMO_KEY_HEADER]
}))

/*
 * Which demo's database serves this request.
 *
 * ABOVE better-auth's handler on purpose, not merely above /api/v1. The
 * better-auth Prisma adapter reads the same `prisma` export as everything
 * else, so a session written below this line would land in the DATABASE_URL
 * shop while the rest of the request read a demo's — a login that appears to
 * work and then cannot find its own user.
 *
 * Resolves to the default shop when the header is absent, when no demo map is
 * configured, or when the key is unknown. A single-shop installation therefore
 * behaves exactly as it did before this middleware existed.
 */
app.use((req, _res, next) => {
    runInDemoScope(resolveDemoKey(req.headers[DEMO_KEY_HEADER]), next);
});

app.use("/api/auth", toNodeHandler(auth))

// Enable URL-encoded form data parsing
app.use(express.urlencoded({ extended: true }));

// Middleware to parse JSON bodies
app.use(express.json());
app.use(cookieParser())
app.use(express.urlencoded({ extended: true }));

// cron.schedule("*/25 * * * *", async () => {
//     try {
//         console.log("Running cron job to cancel unpaid appointments...");
//         await AppointmentService.cancelUnpaidAppointments();
//     } catch (error : any) {
//         console.error("Error occurred while canceling unpaid appointments:", error.message);    
//     }
// })

app.use("/api/v1", IndexRoutes);

// Basic route
app.get('/', async (req: Request, res: Response) => {
    res.status(201).json({
        success: true,
        message: 'Ecom Server api is working',
    })
});

app.use(globalErrorHandler)
app.use(notFound)


export default app;