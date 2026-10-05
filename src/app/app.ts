import { toNodeHandler } from "better-auth/node";
import compression from "compression";
import cookieParser from "cookie-parser";
import cors from "cors";
import express, { Application, Request, Response } from "express";
// import cron from "node-cron";
// testt
import qs from "qs";
import { envVars } from "./config/env";
import { auth } from "./lib/auth";
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
    allowedHeaders : ["Content-Type", "Authorization", "Idempotency-Key"]
}))

// gzip/brotli for every response large enough to benefit — product detail and
// /settings/public are tens of KB of JSON. Done here rather than left to the
// host: Passenger-proxied Node responses are not compressed on every cPanel
// plan, and a host that does compress sees Content-Encoding and leaves it.
app.use(compression())

app.use("/api/auth", toNodeHandler(auth))

// Enable URL-encoded form data parsing
app.use(express.urlencoded({ extended: true }));

// Middleware to parse JSON bodies
app.use(express.json());
app.use(cookieParser())

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