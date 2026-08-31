/* eslint-disable @typescript-eslint/no-explicit-any */
import { toNodeHandler } from "better-auth/node";
import cookieParser from "cookie-parser";
import cors from "cors";
import express, { Application, Request, Response } from "express";
// import cron from "node-cron";
import path from "path";
import qs from "qs";
import { envVars } from "./config/env";
import { auth } from "./lib/auth";
import { globalErrorHandler } from "./middleware/globalErrorHandler";
import { notFound } from "./middleware/notFound";

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
app.set("views",path.resolve(process.cwd(), `src/app/templates`) )

app.use(cors({
    origin : [envVars.FRONTEND_URL, envVars.BETTER_AUTH_URL, "http://localhost:4000", "http://localhost:5000", "http://localhost:5173", "http://localhost:5174"],
    credentials : true,
    methods : ["GET", "POST", "PUT", "DELETE", "PATCH"],
    // Idempotency-Key rides on checkout (see order.controller.ts). It reaches the
    // server today only because the storefront proxies through its own origin;
    // a direct browser call would have it stripped by preflight without this.
    allowedHeaders : ["Content-Type", "Authorization", "Idempotency-Key"]
}))

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
        message: 'pmsp api is working',
    })
});

app.use(globalErrorHandler)
app.use(notFound)


export default app;