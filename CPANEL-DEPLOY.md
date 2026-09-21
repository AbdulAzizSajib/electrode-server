# cPanel (shared hosting) এ backend + database deploy

Express 5 + Prisma 7 backend-টা cPanel-এর **Setup Node.js App** (Passenger, Node 22) দিয়ে,
আর database cPanel-এর **PostgreSQL Databases** দিয়ে চালানোর নোট।

Build হয় নিজের PC-তে; সার্ভারে শুধু তৈরি হওয়া `dist/` + `node_modules` যায় — shared hosting-এ
`tsc` আর `npm install` চালালে RAM/process limit-এ মাঝপথে kill হয়ে যায়।

Storefront-এর নোট আলাদা: [`nextjs/CPANEL-DEPLOY.md`](../nextjs/CPANEL-DEPLOY.md)।

---

## ০. আগে এইটা পড়ুন — database migrate করা মানে data migrate করা নয়

এই ডকুমেন্ট cPanel-এ **খালি নতুন database** দাঁড় করানোর নিয়ম বলে। Neon-এ এখন যা data আছে
(product, order, customer) সেটা আপনাআপনি যাবে না — §3-এ আলাদা করে বলা আছে।

**Neon account-টা অন্তত এক মাস বন্ধ করবেন না।** cPanel-এ কিছু ভাঙলে ফেরার জায়গা ওটাই।

---

## ১. কোথায় কী বদলানো হয়েছে

| ফাইল | কী বদলেছে | কেন |
|---|---|---|
| `scripts/package-cpanel.mjs` (নতুন) | `dist/` + templates + prisma + একটা fresh production `node_modules` মিলিয়ে `backend.tar.gz` বানায় | সার্ভারে build বা `npm install` লাগে না |
| `package.json` | `"build:cpanel": "npm run build && node scripts/package-cpanel.mjs"` | এক কমান্ডে build + pack |
| `.gitignore` | `/backend.tar.gz` | archive যেন commit না হয় |

Code-এ **কিছু বদলায়নি** — CORS allowlist ([`src/app/app.ts`](src/app/app.ts#L51)) এমনিতেই
`FRONTEND_URL` / `ADMIN_URL` env থেকে পড়ে, তাই নতুন ডোমেইন env-এ দিলেই হবে।
`app.set("trust proxy", 1)` Passenger-এর জন্যও ঠিক আছে।

### script দুটো জিনিস নিজে থেকে সামলায়

- **`node_modules` কপি করে না, নতুন করে install করে।** এটা npm workspace — সব dependency
  root-এ hoist হয়, `server/node_modules`-এ express/prisma/pg কিছুই নেই। কপি করলে archive
  unpack হয়, তারপর প্রথম request-এ মরে।
- **`fix-imports.js` চলেছে কি না চেক করে।** না চললে `dist/`-এ extension ছাড়া import থাকে,
  Node-এর ESM loader সেটা নেয় না — build সফল দেখায়, boot-এ `ERR_MODULE_NOT_FOUND`।

> Windows-এ build করা `node_modules` Linux-এ চলে কারণ Prisma 7 এখানে **PrismaPg driver adapter**
> দিয়ে চলে — pure JavaScript, কোনো platform-specific query engine binary নেই (যাচাই করা হয়েছে)।
> ভবিষ্যতে `sharp` / `bcrypt`-এর মতো native package যোগ করলে এই সুবিধা শেষ, তখন Linux-এ (WSL)
> build করতে হবে।

---

## ২. cPanel-এ PostgreSQL database বানানো

1. **cPanel → PostgreSQL Databases**
   - Database বানান, যেমন `cpuser_electrode`
   - User বানান + শক্ত password (বিশেষ অক্ষর `@ : / ?` এড়িয়ে চলুন — URL-এ encode করতে হয়)
   - User-টাকে database-এ **ALL PRIVILEGES** দিন

2. **`pg_trgm` extension** — এটা ছাড়াও app চলবে, কিন্তু product search ধীর হয়ে যাবে।
   cPanel Terminal-এ চেষ্টা করুন:

   ```bash
   psql -U cpuser_dbuser -d cpuser_electrode -c "CREATE EXTENSION IF NOT EXISTS pg_trgm;"
   ```

   `permission denied to create extension` এলে hosting support-কে টিকিট করুন —
   "please enable the pg_trgm extension on database cpuser_electrode"। বেশিরভাগ host করে দেয়।

   > **না পেলে কী হয়:** [`prisma/migrations/20260831000000_add_product_search_indexes/`](prisma/migrations/20260831000000_add_product_search_indexes/migration.sql)
   > migration ব্যর্থ হবে। তখন ঐ migration-টা skip করতে হবে, আর `ProductService.searchProducts`
   > sequential scan-এ নেমে আসবে — কয়েকশো product পর্যন্ত টের পাবেন না, হাজার ছাড়ালে search আটকে যাবে।

3. **Connection string** — এই রূপে:

   ```
   postgresql://cpuser_dbuser:PASSWORD@localhost:5432/cpuser_electrode
   ```

   App আর database একই সার্ভারে, তাই `localhost` — আর তাই **`sslmode` লাগে না**, Neon-এর মতো
   `channel_binding`-ও না। মানে `DIRECT_DATABASE_URL`-এর দরকারও নেই (ওটা শুধু Neon-এর
   channel_binding সমস্যার জন্য ছিল — [`prisma.config.ts`](prisma.config.ts) দেখুন)।

---

## ৩. Neon থেকে data আনা (ঐচ্ছিক, কিন্তু সাধারণত দরকার)

নিজের PC-তে, Neon থেকে dump নিন:

```bash
pg_dump "<Neon DATABASE_URL>" --no-owner --no-privileges --format=plain -f dump.sql
```

`dump.sql` cPanel-এ আপলোড করে Terminal-এ:

```bash
psql -U cpuser_dbuser -d cpuser_electrode -f ~/dump.sql
```

তারপর **§5-এর `migrate deploy` আর চালাবেন না** — dump-এ schema + `_prisma_migrations` টেবিল
দুটোই আছে, Prisma নিজে থেকেই বুঝবে সব migration হয়ে গেছে।

> `pg_dump`-এর version cPanel-এর PostgreSQL version-এর চেয়ে নতুন হলে restore-এ error আসতে পারে।
> `psql -V` দিয়ে সার্ভারের version দেখে মিলিয়ে নিন।

---

## ৪. প্রতিবার deploy

লোকাল PC-তে (`server/` ফোল্ডারে):

```powershell
npm run build:cpanel
```

এতে `server/backend.tar.gz` (~76 MB) তৈরি হয়। আপলোডের আগে লোকালে চালিয়ে দেখা যায় —
archive খুলে `.env` রেখে `node app.js`।

> Archive-এ `.env` **যায় না**, ইচ্ছাকৃতভাবে — secret cPanel-এর Environment variables-এ থাকবে।
> ভুল করে সার্ভারে একটা `.env` থেকে গেলেও ক্ষতি নেই: `dotenv.config()` আগে থেকে থাকা env
> override করে না, তাই cPanel-এর মানই জেতে।

> 76 MB File Manager-এ আপলোড করতে সমস্যা হলে FTP (FileZilla) ব্যবহার করুন।

তারপর `backend.tar.gz` → `~/backend/` এ আপলোড করে cPanel Terminal-এ:

```bash
cd ~/backend
tar -xzf backend.tar.gz && rm backend.tar.gz
mkdir -p tmp && touch tmp/restart.txt
```

---

## ৫. cPanel-এ একবারের setup

1. **Subdomain** বানান, যেমন `api.yourdomain.com`।
2. **SSL চালু করুন** (AutoSSL / Let's Encrypt)। **এটা optional নয়** — [`src/app/utils/token.ts`](src/app/utils/token.ts#L32)
   cookie-তে `secure: true` + `sameSite: "none"` বসায়। শুধু `http`-এ browser ঐ cookie
   নেবেই না, ফলে login হবে কিন্তু টিকবে না।
3. **Setup Node.js App → Create Application**:

   | ঘর | মান |
   |---|---|
   | Node.js version | 22.x |
   | Application mode | Production |
   | Application root | `backend` (home-এর ভেতরে, `public_html`-এ না) |
   | Application URL | উপরের subdomain |
   | Application startup file | `app.js` |

   `PORT` দেবেন না — Passenger নিজে দেয়।

4. **আগে app create, তারপর ফাইল আপলোড।** **"Run NPM Install" চাপবেন না** —
   `node_modules` archive-এর ভেতরেই আছে, আর shared plan-এ ঐ বোতাম প্রায়ই ব্যর্থ হয়।

5. **Environment variables** — cPanel-এর Node.js App ইন্টারফেসে একটা একটা করে দিন।
   [`src/app/config/env.ts`](src/app/config/env.ts#L164) এই ২৫টা **না পেলে server boot-ই করবে না**
   (import-এর সময়েই throw করে):

   ```
   NODE_ENV=production
   PORT=5000
   DATABASE_URL=postgresql://cpuser_dbuser:PASSWORD@localhost:5432/cpuser_electrode
   BETTER_AUTH_SECRET=...
   BETTER_AUTH_URL=https://api.yourdomain.com
   ACCESS_TOKEN_SECRET=...
   REFRESH_TOKEN_SECRET=...
   ACCESS_TOKEN_EXPIRES_IN=1d
   REFRESH_TOKEN_EXPIRES_IN=7d
   EMAIL_SENDER_SMTP_USER=...
   EMAIL_SENDER_SMTP_PASS=...
   EMAIL_SENDER_SMTP_HOST=...
   EMAIL_SENDER_SMTP_PORT=465
   EMAIL_SENDER_SMTP_FROM=...
   GOOGLE_CLIENT_ID=...
   GOOGLE_CLIENT_SECRET=...
   GOOGLE_CALLBACK_URL=https://api.yourdomain.com/api/auth/callback/google
   FRONTEND_URL=https://shop.yourdomain.com
   CLOUDINARY_CLOUD_NAME=...
   CLOUDINARY_API_KEY=...
   CLOUDINARY_API_SECRET=...
   SUPER_ADMIN_EMAIL=...
   SUPER_ADMIN_PASSWORD=...
   SUBSCRIPTION_BKASH_NUMBER=...
   INTEGRATION_ENCRYPTION_KEY=...
   ```

   ঐচ্ছিক কিন্তু দরকারি:

   ```
   ADMIN_URL=https://admin.yourdomain.com
   STOREFRONT_URL=https://shop.yourdomain.com
   STOREFRONT_REVALIDATE_SECRET=...
   COURIER_SYNC_SECRET=...
   ```

   > **`INTEGRATION_ENCRYPTION_KEY` Neon-এরটার সমান হতে হবে** যদি §3-এ data import করে থাকেন।
   > আলাদা key দিলে merchant-এর courier credential আর decrypt হবে না, আর rotation tooling নেই।

   > `FRONTEND_URL` / `ADMIN_URL` শুধু redirect নয় — CORS allowlist-ও এখান থেকেই তৈরি হয়।

6. **Database migration** (§3-এ dump restore করলে এই ধাপ বাদ)। cPanel Terminal-এ:

   ```bash
   source ~/nodevenv/backend/22/bin/activate
   cd ~/backend
   npx prisma migrate deploy
   ```

7. **Restart**: `touch ~/backend/tmp/restart.txt`

---

## ৬. অন্য দুই app-এ যা বদলাতে হবে

Backend-এর URL বদলাচ্ছে, তাই দুটোই **rebuild** করতে হবে — এগুলো build-time মান, পরে env দিয়ে বদলানো যায় না।

| App | ফাইল | মান |
|---|---|---|
| Storefront | `nextjs/.env.production.local` | `NEXT_PUBLIC_API_BASE_URL=https://api.yourdomain.com/api/v1` |
| Admin | build-এর আগে env | `VITE_API_BASE_URL=https://api.yourdomain.com/api/v1` |

> Admin-এর [`src/lib/api/client.ts`](../admin/src/lib/api/client.ts) `VITE_API_BASE_URL` পড়ে,
> না পেলে `http://localhost:5000/api/v1`-এ নামে। মানে build-এর আগে env না দিলে deploy করা
> panel চুপচাপ localhost-এ কল করবে — কোনো error নয়, শুধু সব request ব্যর্থ।
> (CLAUDE.md এটাকে "hardcoded, no env var" বলে — ঐ লাইনটা পুরনো।)

**Google OAuth** — Google Cloud Console-এ নতুন callback URL
(`https://api.yourdomain.com/api/auth/callback/google`) authorized redirect URI-তে যোগ করুন।

---

## ৭. সমস্যা হলে

- **503 / "Incomplete response"** — হাতে চালিয়ে আসল error দেখুন:
  ```bash
  source ~/nodevenv/backend/22/bin/activate && cd ~/backend
  PORT=5099 node app.js
  ```
  আর `~/backend/stderr.log` দেখুন।
- **`Environment variable X is required`** — §5.5-এর কোনো একটা বাদ পড়েছে। Server ইচ্ছাকৃতভাবে
  boot করে না, যাতে অর্ধেক-configure করা deployment চুপচাপ না চলে।
- **`ERR_MODULE_NOT_FOUND`** — archive `npm run build:cpanel` দিয়ে বানানো হয়নি।
- **`P1001: Can't reach database server`** — `DATABASE_URL`-এ host `localhost` আছে কি না,
  আর password-এ special character থাকলে URL-encode করা আছে কি না দেখুন।
- **Login হয় কিন্তু টেকে না** — HTTPS নেই (§5.2)।
- **Admin/storefront-এ CORS error** — `FRONTEND_URL` / `ADMIN_URL` env-এ ঐ ডোমেইনটা নেই।
- **প্রথম request ধীর** — অনেকক্ষণ কেউ না এলে Passenger app বন্ধ করে দেয়। স্বাভাবিক।

### Vercel-এর যে দুটো জিনিস cPanel-এ নিজে করতে হবে

- **`seedSuperAdmin()` এখন চলবে** — Vercel-এ [`api.ts`](src/app/api.ts) `listen` করত না বলে
  seed কখনো চলত না; cPanel-এ [`server.js`](src/app/server.ts) চলে, তাই প্রথম boot-এ role আর
  super admin তৈরি হবে।
- **Courier reconciliation cron** — Vercel Cron ছিল, cPanel-এ নেই। cPanel → **Cron Jobs**-এ যোগ করুন:
  ```bash
  curl -s -X POST https://api.yourdomain.com/api/v1/courier/sync \
    -H "Authorization: Bearer $COURIER_SYNC_SECRET"
  ```
  না দিলে dispatch আর webhook চলবে, কিন্তু কোনো missed webhook আর কখনো catch-up হবে না।
