# cPanel (shared hosting) এ backend + database deploy

Express 5 + Prisma 7 backend-টা cPanel-এর **Setup Node.js App** (Passenger, Node 22) দিয়ে,
আর database cPanel-এর **MySQL Databases** দিয়ে চালানোর নোট (host-এ MariaDB 10.11)।

Build হয় নিজের PC-তে; সার্ভারে শুধু তৈরি হওয়া `dist/` + `node_modules` যায় — shared hosting-এ
`tsc` আর `npm install` চালালে RAM/process limit-এ মাঝপথে kill হয়ে যায়।

Storefront-এর নোট আলাদা: [`nextjs/CPANEL-DEPLOY.md`](../nextjs/CPANEL-DEPLOY.md)।

---

## ০. আগে এইটা পড়ুন — database engine বদলে গেছে, আর data যাচ্ছে না

Database এখন **PostgreSQL নয়, MySQL/MariaDB** — cPanel account-এ PostgreSQL নেই।
পুরো data layer এর জন্য convert করা হয়েছে (`openspec/changes/switch-database-to-mysql/`)।

**নতুন database সম্পূর্ণ খালি শুরু হয়, আর seed করা হয় — restore করা হয় না।**
Neon-এ থাকা product/order/customer কিছুই যাচ্ছে না; এটা সচেতন সিদ্ধান্ত, ভুলে বাদ পড়া নয়।
দুই engine-এর dump format আলাদা, আর migration history নতুন করে শুরু হয়েছে, তাই পুরনো
`pg_dump` বা পুরনো backup file এই database-এ কাজে লাগবে না।

> Admin-এর backup/restore feature-ও পুরনো Postgres backup নেবে না: backup file-এ
> `schemaVersion` হিসেবে সর্বশেষ migration-এর নাম থাকে, আর সেটা এখন আলাদা।

**Neon account আর Vercel deployment অন্তত এক মাস বন্ধ করবেন না।** cPanel-এ কিছু ভাঙলে
ফেরার জায়গা ওটাই — এই কাজের কোনো ধাপ Neon-এ লেখে না, তাই ফিরে যেতে কিছু undo করতে হবে না।

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
  root-এ hoist হয়, `server/node_modules`-এ express/prisma/mariadb কিছুই নেই। কপি করলে archive
  unpack হয়, তারপর প্রথম request-এ মরে।
- **`fix-imports.js` চলেছে কি না চেক করে।** না চললে `dist/`-এ extension ছাড়া import থাকে,
  Node-এর ESM loader সেটা নেয় না — build সফল দেখায়, boot-এ `ERR_MODULE_NOT_FOUND`।

> Windows-এ build করা `node_modules` Linux-এ চলে কারণ Prisma 7 এখানে **PrismaMariaDb driver
> adapter** দিয়ে চলে — pure JavaScript, কোনো platform-specific query engine binary নেই।
> ভবিষ্যতে `sharp` / `bcrypt`-এর মতো native package যোগ করলে এই সুবিধা শেষ, তখন Linux-এ (WSL)
> build করতে হবে।

---

## ২. cPanel-এ MySQL database বানানো

1. **cPanel → MySQL Databases**
   - Database বানান, যেমন `cpuser_electrode`
   - User বানান + শক্ত password (বিশেষ অক্ষর `@ : / ?` এড়িয়ে চলুন — URL-এ encode করতে হয়)
   - User-টাকে database-এ **ALL PRIVILEGES** দিন

2. **⚠️ Character set ঠিক করুন — migration চালানোর আগেই।**

   cPanel Terminal-এ:

   ```bash
   mysql -u cpuser_dbuser -p cpuser_electrode -e "ALTER DATABASE cpuser_electrode CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"
   ```

   **কেন এটা আগে:** Prisma-র migration প্রতিটা table-এ নিজে থেকেই
   `utf8mb4 / utf8mb4_unicode_ci` বসায়, তাই app-এর নিজের table গুলো এমনিতেই নিরাপদ।
   কিন্তু database-এর default তিনটা জিনিস নিয়ন্ত্রণ করে যেগুলো migration ছোঁয় না:
   `_prisma_migrations` table, পরে হাতে বানানো যেকোনো table, আর session-এর default
   charset — যেটা ঠিক করে raw query-র ভেতরের string literal কীভাবে column-এর সাথে
   তুলনা হবে।

   Server-এর default যদি `latin1` হয় (কিছু cPanel host-এ হয়), আর এই ধাপ বাদ পড়ে,
   তাহলে কোনো error আসবে না — কিন্তু ঐ জায়গাগুলোয় বাংলা লেখা mojibake হয়ে বসবে।

   `_ci` collation-টাও জরুরি: brand/tag/attribute/tax rule-এর **duplicate নাম ধরার
   guard গুলো এখন collation-এর উপর নির্ভর করে**। আগে Prisma-কে `mode: "insensitive"`
   বলা হতো; MySQL-এ ওরকম per-query option নেই। `_bin` বা `_cs` collation-এ ঐ guard গুলো
   200 OK দিতেই থাকবে, শুধু "Samsung" আর "samsung" আলাদা ধরবে।

3. **Connection string** — এই রূপে:

   ```
   mysql://cpuser_dbuser:PASSWORD@localhost:3306/cpuser_electrode
   ```

   App আর database একই সার্ভারে, তাই `localhost` — আর তাই **`sslmode` লাগে না**, Neon-এর
   মতো `channel_binding`-ও না। **`DIRECT_DATABASE_URL` আর নেই** — ওটা শুধু Neon-এর
   channel_binding সমস্যার জন্য ছিল, এখন [`prisma.config.ts`](prisma.config.ts) সরাসরি
   `DATABASE_URL` পড়ে।

   > Host যদি connection সংখ্যা কম রাখে, URL-এ `?connection_limit=5` যোগ করুন।
   > আসল সীমা কত সেটা host-ই বলতে পারে, তাই আগে থেকে বসানো নেই।

---

## ৩. Database ভরা — seed, restore নয়

§0-তে বলা হয়েছে: পুরনো data যাচ্ছে না। §5.6-এ `migrate deploy` চালানোর পর database-এ
schema থাকবে কিন্তু কোনো সারি থাকবে না। প্রথম boot-এ [`utils/seed.ts`](src/app/utils/seed.ts)
role আর super admin তৈরি করে (§7-এর শেষ অংশ দেখুন) — বাকি সব (store setting, category,
product, banner) admin panel থেকে হাতে বসাতে হবে।

> পুরনো Neon data দেখার দরকার হলে Neon project-টা চালু আছে (§0)। ওখান থেকে দেখে দেখে
> নতুন করে বসানো ছাড়া উপায় নেই — দুই engine-এর মধ্যে কোনো import path রাখা হয়নি।

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
   DATABASE_URL=mysql://cpuser_dbuser:PASSWORD@localhost:3306/cpuser_electrode
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

   > **`INTEGRATION_ENCRYPTION_KEY`** — database খালি শুরু হচ্ছে বলে এখানে নতুন key দেওয়া
   > যায়। courier credential আবার নতুন করে বসাতে হবে, কারণ পুরনো কোনো row আসছে না।

   > `FRONTEND_URL` / `ADMIN_URL` শুধু redirect নয় — CORS allowlist-ও এখান থেকেই তৈরি হয়।

6. **Database migration।** §2.2-এর `ALTER DATABASE` আগে চালানো হয়েছে কি না নিশ্চিত হয়ে
   নিন — পরে চালালে ততক্ষণে তৈরি হয়ে যাওয়া `_prisma_migrations` ঠিক হবে না।

   ```bash
   source ~/nodevenv/backend/22/bin/activate
   cd ~/backend
   npx prisma migrate deploy
   ```

7. **Charset যাচাই করুন — অন্য কিছু করার আগে।**

   ```bash
   npx tsx scripts/verify-mysql-charset.ts
   ```

   এটা database আর প্রতিটা table-এর charset/collation/engine পড়ে দেখে, আর একটা বাংলা
   string server-এ পাঠিয়ে ফেরত এনে মিলিয়ে দেখে। এখানে FAIL এলে **এগোবেন না** — content
   বসানোর পর ঠিক করা যাবে না।

8. **Restart**: `touch ~/backend/tmp/restart.txt`

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

## ৭. Demo host — এক deployment, কয়েকটা demo shop

**এই অংশটা শুধু আপনার নিজের demo সার্ভারের জন্য। কোনো client-এর cPanel-এ এর কিছুই লাগে না —
সেখানে §৫-এর env তালিকাই যথেষ্ট, আর `DEMO_DATABASES` সেট না করলে এই পুরো ব্যবস্থাটা নিষ্ক্রিয়।**

Prospect-দের দেখানোর জন্য কয়েকটা আলাদা দোকান — একেকটা আলাদা subdomain-এ, আলাদা database-এ —
কিন্তু **একটাই Node app, একটাই storefront process**। Demo বাড়লেও RAM বাড়ে না, যেটা ২ GB-র
account-এ গুরুত্বপূর্ণ।

আপনার নিজের আসল site এই demo গুলোর সাথে **মেশাবেন না** — ওটা আলাদা stack হিসেবে §১–§৬ ধরে
deploy করুন। তাতে একটা demo ভাঙলে আপনার business site অক্ষত থাকে, আর client যে পথে deploy
হবে সেটা আপনি প্রতিদিন নিজেই যাচাই করতে থাকেন।

### ৭.১ প্রতি demo-র জন্য subdomain + database

cPanel-এ Subdomain সীমাহীন, Database-ও। প্রতিটা demo-র জন্য:

1. **Subdomains** → `fashion`, `grocery` … (যেমন `fashion.apnardomain.com`)
2. **MySQL Databases** → একটা করে DB, যেমন `cpuser_demo_fashion`
3. **§২.২-এর `ALTER DATABASE` প্রতিটাতে চালান** — charset ঠিক না করলে বাংলা লেখা mojibake হবে,
   আর সেটা পরে সারানো যায় না
4. প্রতিটাতে migration চালান:

   ```bash
   source ~/nodevenv/backend/22/bin/activate && cd ~/backend
   DATABASE_URL="mysql://cpuser_u:pass@localhost:3306/cpuser_demo_fashion" npx prisma migrate deploy
   ```

> **Subdomain-এর নাম-ই demo key।** `fashion.apnardomain.com` → key `fashion`। তাই subdomain-এর
> নাম আর `DEMO_DATABASES`-এর key হুবহু এক হতে হবে।

### ৭.২ `DEMO_DATABASES`

Backend app-এর Environment variables-এ একটা লাইন — JSON, key → connection string:

```
DEMO_DATABASES={"fashion":"mysql://cpuser_u:pass@localhost:3306/cpuser_demo_fashion?connection_limit=2","grocery":"mysql://cpuser_u:pass@localhost:3306/cpuser_demo_grocery?connection_limit=2"}
```

**`?connection_limit=2` বাদ দেবেন না।** প্রতিটা demo নিজের connection pool খোলে, আর shared
hosting-এ MySQL-এর concurrent connection সীমিত। ৪টা demo × default pool মিলে সীমা ছাড়ালে
`Too many connections` এসে **সব** demo একসাথে বসে যাবে।

`DATABASE_URL` আগের মতোই থাকবে — ওটা fallback: header ছাড়া বা অচেনা key নিয়ে আসা request
ওই database থেকেই উত্তর পাবে।

### ৭.৩ Storefront আর admin

**দুটোরই একটা করে build, সব demo-র জন্য।**

- **Storefront** — চারটে subdomain-ই একই Node app-এ যাবে। App নিজের incoming hostname দেখে
  demo চিনে নেয় আর API-কে জানায়।
- **Admin** — static file, তাই প্রতি demo subdomain-এ একই `dist/` রাখলেই হয়।
  **`VITE_API_BASE_URL` সেট করবেন না** — না থাকলে panel নিজের origin-কে API ধরে, আর সেটাই
  এক build-কে সব demo-তে কাজ করায়। (Client-এর install-এ উল্টো — সেখানে ওটা সেট করতেই হবে,
  §৬ দেখুন।)

### ৭.৪ Demo আবার আগের অবস্থায় ফেরানো

Prospect ঘাঁটাঘাঁটি করে data এলোমেলো করে ফেললে — seed করার পরপরই প্রতিটা demo-র একটা dump
রেখে দিন:

```bash
mysqldump -u cpuser_u -p cpuser_demo_fashion > ~/demo-backups/fashion.sql
```

ফেরাতে:

```bash
mysql -u cpuser_u -p cpuser_demo_fashion < ~/demo-backups/fashion.sql
```

ইচ্ছাকৃতভাবে হাতে — এক ক্লিকে DB মুছে ফেলার বোতাম বানানো হয়নি, কারণ ভুল database-এ চাপ পড়লে
ফেরার পথ থাকে না।

### ৭.৫ ⚠️ Demo key নিরাপত্তার সীমা নয়

Demo key শুধু **routing** — কোন database, তাই বলে। যে কেউ অন্য demo-র key পাঠিয়ে সেই demo-র
data দেখতে পারবে। এটা ঠেকানো হয়নি, ইচ্ছাকৃতভাবে।

**তাই `DEMO_DATABASES` সেট করা আছে এমন কোনো deployment-এ আসল customer data রাখবেন না।**
Demo host-এ শুধু দেখানোর জন্য বানানো data থাকবে।

Client-এর install-এ এই ঝুঁকি নেই — সেখানে map নেই, তাই header সম্পূর্ণ উপেক্ষিত।

কখনো যদি সত্যিকারের আলাদা করার দরকার হয়, এই নকশাটা তার জন্য নয় — তখন একে বদলাতে হবে,
শক্ত করার চেষ্টা নয়। (`server/openspec/changes/add-multi-demo-hosting/design.md`, Decision 6)

---
## ৮. সমস্যা হলে

- **503 / "Incomplete response"** — হাতে চালিয়ে আসল error দেখুন:
  ```bash
  source ~/nodevenv/backend/22/bin/activate && cd ~/backend
  PORT=5099 node app.js
  ```
  আর `~/backend/stderr.log` দেখুন।
- **`Environment variable X is required`** — §5.5-এর কোনো একটা বাদ পড়েছে। Server ইচ্ছাকৃতভাবে
  boot করে না, যাতে অর্ধেক-configure করা deployment চুপচাপ না চলে।
- **`ERR_MODULE_NOT_FOUND`** — archive `npm run build:cpanel` দিয়ে বানানো হয়নি।
- **`P1001: Can't reach database server`** — `DATABASE_URL` `mysql://` দিয়ে শুরু হচ্ছে কি না,
  host `localhost` আর port `3306` কি না, আর password-এ special character থাকলে URL-encode
  করা আছে কি না দেখুন।
- **`Data too long for column 'x'`** — ঐ column-টা `VARCHAR(191)` রয়ে গেছে যেখানে
  `@db.Text` দরকার ছিল। [`string-field-audit.tsv`](openspec/changes/switch-database-to-mysql/string-field-audit.tsv)
  দেখুন, schema-তে annotation যোগ করে নতুন migration বানান।
- **একই নামের brand/tag দুবার তৈরি হচ্ছে** — collation `_ci` নয়। §2.2 আর
  `verify-mysql-charset.ts` দেখুন।
- **বাংলা লেখা `????` বা উল্টোপাল্টা দেখাচ্ছে** — §2.2-এর `ALTER DATABASE` বাদ পড়েছে।
  ঐ data আর উদ্ধার হবে না; charset ঠিক করে আবার বসাতে হবে।
- **`Too many connections`** — `DATABASE_URL`-এ `?connection_limit=5` যোগ করুন (§2.3)।
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
