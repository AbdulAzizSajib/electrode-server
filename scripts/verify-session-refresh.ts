/**
 * A signed-in customer stays signed in past their access token's lifetime.
 *
 * The storefront used to sign every customer out a day after they signed in.
 * Two faults compounded: the session-token cookie lived one day (the backend
 * refuses a refresh without it, so after a day there was nothing to refresh
 * with), and the refresh itself was attempted inside a Server Component, where
 * the new cookies cannot be written. Renewal now happens in the storefront's
 * proxy.ts, before the render, for pages and /api routes alike.
 *
 * End to end, over HTTP, against BOTH running dev servers (storefront and API)
 * and the live database. Mints real tokens for a throwaway user and session,
 * deletes them in the finally. Checked:
 *   - a day later (no access cookie) a protected page renders signed in, on the
 *     same request, and the browser gets new cookies — session kept 7 days
 *   - a browser-side API call in that state is served as the customer
 *   - an expired access token is renewed; a valid one is left alone
 *   - a session the backend has ended is sent to login with its cookies cleared
 *   - guests are unaffected
 *   - the backend answers a refresh without a session token with 401, not 500
 *
 * Run with both dev servers up:  npx tsx scripts/verify-session-refresh.ts
 */
import crypto from "crypto";
import jwt from "jsonwebtoken";
import { prisma } from "../src/app/lib/prisma";
import { envVars } from "../src/app/config/env";
import { tokenUtils } from "../src/app/utils/token";

const SHOP = (envVars.STOREFRONT_URL || "http://localhost:4000").replace(/\/$/, "");
const API = `http://localhost:${envVars.PORT}/api/v1`;
let failures = 0;
const check = (label: string, ok: boolean, detail: string) => { console.log(`${ok ? "PASS" : "FAIL"}  ${label} — ${detail}`); if (!ok) failures++; };
const cookieHeader = (jar: Record<string, string>) => Object.entries(jar).map(([k, v]) => `${k}=${v}`).join("; ");
const setCookies = (res: Response) => res.headers.getSetCookie();
const named = (list: string[], name: string) => list.find((c) => c.startsWith(`${name}=`));
const cleared = (c?: string) => !!c && (/^[^=]+=;/.test(c) || /Max-Age=0/i.test(c) || /Expires=Thu, 01 Jan 1970/i.test(c));

(async () => {
  const userId = `zzrefresh-${crypto.randomUUID()}`;
  const email = `${userId}@verify.test`;
  try {
    const user = await prisma.user.create({ data: { id: userId, name: "Zz Refresh Test", email, emailVerified: true }, include: { role: true } });
    const sessionToken = crypto.randomBytes(24).toString("hex");
    await prisma.session.create({ data: { id: crypto.randomUUID(), token: sessionToken, userId, expiresAt: new Date(Date.now() + 7 * 864e5) } });
    const payload = { userId, role: user.role.name, name: user.name, email, isActive: true, isDeleted: false, emailVerified: true };
    const refreshToken = tokenUtils.getRefreshToken(payload);
    const expiredAccess = jwt.sign({ ...payload, exp: Math.floor(Date.now() / 1000) - 60 }, envVars.ACCESS_TOKEN_SECRET);
    const validAccess = tokenUtils.getAccessToken(payload);

    // 1. A day later: the access cookie is gone, refresh + session remain.
    const dayLater = { refreshToken, "better-auth.session_token": sessionToken };
    const r1 = await fetch(`${SHOP}/account`, { headers: { cookie: cookieHeader(dayLater) }, redirect: "manual" });
    const h1 = await r1.text();
    const sc1 = setCookies(r1);
    check("a day later, /account is not bounced to login", r1.status === 200, `status ${r1.status} ${r1.headers.get("location") ?? ""}`);
    check("...and renders the signed-in customer on that same request", h1.includes(email), h1.includes(email) ? "email shown" : "email absent");
    check("...and hands the browser a new access token", !!named(sc1, "accessToken") && !cleared(named(sc1, "accessToken")), named(sc1, "accessToken")?.slice(0, 60) ?? "no Set-Cookie");
    const sessionCookie = named(sc1, "better-auth.session_token") ?? "";
    const maxAge = Number(sessionCookie.match(/Max-Age=(\d+)/i)?.[1]);
    check("...and keeps the session cookie for 7 days", maxAge === 7 * 86400, `Max-Age=${maxAge}`);

    // 2. Same state, a browser-side API call (wishlist count).
    const r2 = await fetch(`${SHOP}/api/wishlist/count`, { headers: { cookie: cookieHeader(dayLater) } });
    const b2 = await r2.text();
    check("a day later, /api/wishlist/count is served as the customer", r2.status === 200, `status ${r2.status} ${b2.slice(0, 80)}`);
    check("...and renews cookies on the API response too", !!named(setCookies(r2), "accessToken"), `${setCookies(r2).length} Set-Cookie`);

    // 3. An expired access token still present in the cookie jar.
    const r3 = await fetch(`${SHOP}/account`, { headers: { cookie: cookieHeader({ accessToken: expiredAccess, ...dayLater }) }, redirect: "manual" });
    const h3 = await r3.text();
    check("an expired access token is renewed, not treated as signed out", r3.status === 200 && h3.includes(email), `status ${r3.status}`);

    // 4. A healthy session is left alone — no refresh round trip.
    const r4 = await fetch(`${SHOP}/account`, { headers: { cookie: cookieHeader({ accessToken: validAccess, ...dayLater }) }, redirect: "manual" });
    const h4 = await r4.text();
    check("a valid access token is not refreshed", r4.status === 200 && h4.includes(email) && !named(setCookies(r4), "accessToken"), `status ${r4.status}, Set-Cookie accessToken ${named(setCookies(r4), "accessToken") ? "present" : "absent"}`);

    // 5. The backend has ended the session: cookies cleared, login required.
    const ended = { refreshToken, "better-auth.session_token": "not-a-real-session" };
    const r5 = await fetch(`${SHOP}/account`, { headers: { cookie: cookieHeader(ended) }, redirect: "manual" });
    const sc5 = setCookies(r5);
    check("an ended session is sent to login", r5.status === 307 && (r5.headers.get("location") ?? "").includes("/account/login"), `status ${r5.status} → ${r5.headers.get("location")}`);
    check("...and all three auth cookies are cleared", ["accessToken", "refreshToken", "better-auth.session_token"].every((n) => cleared(named(sc5, n))), sc5.map((c) => c.split(";")[0]).join(" | "));

    // 6. A guest is unaffected.
    const r6 = await fetch(`${SHOP}/account`, { redirect: "manual" });
    check("a guest is still sent to login with no auth cookies written", r6.status === 307 && !named(setCookies(r6), "accessToken"), `status ${r6.status}`);
    const r6b = await fetch(`${SHOP}/`, { redirect: "manual" });
    check("a guest's homepage is unaffected", r6b.status === 200, `status ${r6b.status}`);

    // 7. Backend: refresh without the session cookie is a 401, not a 500.
    const r7 = await fetch(`${API}/auth/refresh-token`, { method: "POST", headers: { cookie: `refreshToken=${refreshToken}` } });
    check("backend refuses a refresh without a session token with 401", r7.status === 401, `status ${r7.status}`);
  } finally {
    await prisma.customer.deleteMany({ where: { userId } });
    await prisma.user.deleteMany({ where: { id: userId } });
    await prisma.$disconnect();
  }
  console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} check(s) FAILED.`);
  if (failures > 0) process.exitCode = 1;
})();
