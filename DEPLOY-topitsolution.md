# topitsolution.com — cPanel deploy runbook

আপনার নিজের site cPanel-এ তোলার ধাপে ধাপে নির্দেশ। **Demo site এখানে নেই** — ওটা পরে, §১০ দেখুন।

> **এই ফাইলটা আপনার নিজের deployment-এর, generic নির্দেশ নয়।** এতে আসল domain আর DB-র নাম আছে।
> `server/` repo-তে রাখা হয়েছে যাতে git-এ থাকে — root কোনো repo নয়, ওখানে রাখলে কোনো backup থাকত না।
>
> **মানে এটা clone-এর সাথে যাবে।** Client-এর জন্য কোড copy করার সময় এই ফাইলটা মুছে দেবেন:
> `rm DEPLOY-topitsolution.md`. Generic নির্দেশ `CPANEL-DEPLOY.md`-এ, সেটাই client-এর জন্য।

---

---

## এই ফাইলে দুটো অংশ — আপনার কোনটা দরকার?

| | কখন | কোথায় |
|---|---|---|
| **PART ১ — প্রথমবার বসানো** | নতুন host, নতুন database। একবারই লাগে | §০ – §৯, নিচে |
| **PART ২ — প্রতিবার update** | কোড বদলেছে, নতুন field/table যোগ হয়েছে, বা শুধু নতুন build তুলবেন | §১২ |

**সব কিছু ইতিমধ্যে চালু থাকলে PART ১ লাগবে না** — সোজা §১২-এ যান।

# PART ১ — প্রথমবার বসানো (একবারের কাজ)

## ০. শুরুর আগে তিনটে কথা

> **⚠️ এই §০ প্রথম deploy-এর কথা, আজকের অবস্থা নয়।** Database এখন **খালি নয়** — আসল order,
> product, customer আছে। তাই schema বদলানোর আগে **§১২.২ পড়ুন**: `migrate reset` আর `db push`
> এখন সব মুছে দেবে, যেখানে খালি database-এ ওগুলো নিরাপদ ছিল।

**১. পুরনো কোনো data যাচ্ছে না।** নতুন MySQL database সম্পূর্ণ খালি শুরু হবে। Neon-এ যা আছে
(product, order, customer) তার কিছুই আপনাআপনি আসবে না — দুই engine আলাদা, migration history নতুন।
Product/category সব admin panel থেকে হাতে বসাতে হবে।

**২. Neon আর Vercel অন্তত এক মাস বন্ধ করবেন না।** cPanel-এ কিছু ভাঙলে ফেরার জায়গা ওটাই।
এই কাজের কোনো ধাপ Neon-এ লেখে না, তাই ফিরতে কিছু undo করতে হবে না।

**৩. `cpuser_` লেখা দেখলে আপনার আসল cPanel username বসাবেন।** cPanel নিজে থেকেই database আর
user-এর নামের আগে ওটা জুড়ে দেয় — DB বানানোর সময় স্ক্রিনেই দেখতে পাবেন।

---

## ১. কী কোথায় বসবে

| Subdomain | কী চলবে | ধরন |
|---|---|---|
| `topitsolution.com` | Storefront (Next.js) | Node app |
| `api.topitsolution.com` | Backend (Express) | Node app |
| `admin.topitsolution.com` | Admin panel | **শুধু static file**, Node নয় |

Admin কোনো Node process নেয় না — Vite-এর `dist/` ফোল্ডার, Apache সরাসরি পরিবেশন করে। তাই
RAM-এ শুধু দুটো process: storefront + backend।

---

## ২. cPanel-এ subdomain বানানো

**cPanel → Domains → Create A New Domain** (বা Subdomains):

1. `api.topitsolution.com` — document root `~/api-public` (ডিফল্ট মানও চলবে)
2. `admin.topitsolution.com` — document root `~/admin-public`

`topitsolution.com` root domain ইতিমধ্যে আছে, আলাদা করে বানাতে হবে না।

**SSL চালু করুন** — cPanel → **SSL/TLS Status** → তিনটেতেই **Run AutoSSL**।

> **SSL ঐচ্ছিক নয়।** Login cookie-তে `secure: true` + `sameSite: "none"` বসে
> ([token.ts](src/app/utils/token.ts))। শুধু `http`-এ browser ঐ cookie নেবেই না — login
> হবে, কিন্তু পরের ক্লিকেই logout হয়ে যাবে।

---

## ৩. Database — এই ধাপে ভুল করলে পরে সারানো যাবে না

**cPanel → MySQL Databases:**

1. **Create New Database**: `topit` → আসল নাম হবে `cpuser_topit`
2. **Add New User**: `topituser` → `cpuser_topituser`, শক্ত password
   — password-এ `@ : / ? # &` **এড়িয়ে চলুন**, URL-এ encode করতে হয়
3. **Add User To Database** → **ALL PRIVILEGES**

### ⚠️ ৩.১ Charset ঠিক করুন — migration চালানোর আগেই

**phpMyAdmin → ডান পাশের তালিকা থেকে database সিলেক্ট → SQL ট্যাব:**

```sql
ALTER DATABASE cpuser_topit CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
```

> **Terminal নয়, phpMyAdmin — কারণ Terminal দুভাবে ব্যর্থ হয়, আর দুটোই নীরবে।**
>
> প্রথমত, shared cPanel-এ process limit (`nproc`) ভরে গেলে bash নতুন process চালু করতেই পারে না —
> `bash: fork: retry: Resource temporarily unavailable` আসে আর `mysql` ক্লায়েন্ট আদৌ চলে না।
> কমান্ডটা চলেনি, অথচ দেখে মনে হয় কিছু একটা হয়েছে।
>
> দ্বিতীয়ত, পেস্ট করলে লাইনের শুরুতে bracketed-paste-এর আবর্জনা (`^[[200~`) জুড়ে যায় আর কমান্ড নষ্ট
> করে। phpMyAdmin দুটোই এড়ায়।

**ALTER চললেও charset না বদলালে** — নিচের যাচাইয়ে `utf8mb3` বা `latin1` থেকে গেলে — আপনার MySQL
user-এর `ALTER DATABASE` অনুমতি নেই। MySQL এক্ষেত্রে **কোনো error দেয় না, চুপ করে থাকে**। shared
hosting-এ এটা স্বাভাবিক। হোস্টিং সাপোর্টকে এক লাইন লিখুন:

> Please set the default character set of database `cpuser_topit` to utf8mb4 with collation
> utf8mb4_unicode_ci. My MySQL user lacks ALTER DATABASE permission.

**কেন এটা আগে:** Prisma-র migration প্রতিটা table-এ নিজেই `utf8mb4` বসায়, তাই app-এর table গুলো
এমনিতেই নিরাপদ। কিন্তু database-এর default ঠিক করে `_prisma_migrations` table, পরে হাতে বানানো
যেকোনো table, আর **session-এর default charset** — যেটা raw query-র ভেতরের বাংলা string কীভাবে
তুলনা হবে তা ঠিক করে।

Server-এর default যদি `latin1` হয় আর এই ধাপ বাদ পড়ে, **কোনো error আসবে না** — শুধু বাংলা লেখা
mojibake হয়ে বসবে, আর সেটা আর উদ্ধার হবে না।

---

## ৪. নিজের PC-তে তিনটে জিনিস build করা

### ৪.১ Backend

```powershell
cd "D:\Next.js\electrode\server"
npm run build:cpanel
```

→ `server/backend.tar.gz` (~৭৭ MB)

### ৪.২ Storefront

`nextjs/.env.production.local` ফাইলে (না থাকলে বানান):

```
NEXT_PUBLIC_API_BASE_URL=https://api.topitsolution.com/api/v1
```

```powershell
cd "D:\Next.js\electrode\nextjs"
npm run build:cpanel
```

→ `nextjs/storefront.tar.gz` (~১৪ MB)

> `NEXT_PUBLIC_*` মান **build-এর সময়** bundle-এ বসে যায়। cPanel-এর env-এ পরে বদলালে কিছুই হবে না —
> আবার build করতে হবে।

**আপলোড করার আগে এই এক লাইন চালান** (Git Bash-এ, `nextjs/` ফোল্ডার থেকে):

```bash
grep -rhoE 'a\.x\("[^"]*-[0-9a-f]{16}"' .next/server/chunks/ssr/*.js | sort -u
```

**কিছু বেরোলে আপলোড করবেন না।** Turbopack একটা package-কে external ধরলে তার নামের শেষে
একটা hash জুড়ে দেয় (`sanitize-html-6ef27188a4b3dc42`), আর ওই নামে কোনো package নেই — হোস্টে গিয়ে
প্রতিটা page 500 দেবে। npm workspace সব dependency monorepo root-এ hoist করে বলে এটা এই repo-তে
সহজেই ঘটে। সমাধান: `next.config.ts`-এর `transpilePackages`-এ package-টার নাম যোগ করুন।

**`next build` সফল হওয়া কোনো প্রমাণ নয়** — এই bug-এর প্রতিটা রূপেই build exit 0 দেয়।

### ৪.৩ Admin

```powershell
cd "D:\Next.js\electrode\admin"
$env:VITE_API_BASE_URL="https://api.topitsolution.com/api/v1"
$env:VITE_STOREFRONT_URL="https://topitsolution.com"
npm run build
```

→ `admin/dist/`

> এটাও build-time। **`VITE_API_BASE_URL` না দিলে** panel নিজের origin
> (`admin.topitsolution.com/api/v1`) কে API ধরবে, যেখানে কিছু নেই — সব request 404 হবে।
>
> **`VITE_STOREFRONT_URL` বাদ দেবেন না।** Panel storefront-এ বাইরের দিকে link করে — landing
> page-এর "View page", active-campaign banner। না দিলে ওগুলো `http://localhost:4000`-এ যাবে,
> अর্থাৎ client-এর ব্রাউজারে ভাঙা link। দুটোই `admin/.env.example`-এ ব্যাখ্যা করা আছে।
>
> `.env.local` ফাইলে না লিখে PowerShell variable-এ দিচ্ছি কারণ `.env.local` local
> development-ও production API-তে পাঠিয়ে দেয়। শেল বন্ধ করলেই variable মুছে যায়।

---

## ৫. Backend বসানো

### ৫.১ আপলোড

`backend.tar.gz` → `~/backend/` এ। (৭৭ MB File Manager-এ প্রায়ই আটকায়।)

> **FileZilla-তে FTPS বাদ দিয়ে SFTP ব্যবহার করুন** — Protocol: SFTP, port **22**, user আপনার
> **cPanel username** (FTP account নয়), password cPanel-এর। অফিসের ফায়ারওয়াল আর অ্যান্টিভাইরাসের
> TLS-স্ক্যানিং FTPS-এর handshake ভেঙে দেয় — log-এ `Initializing TLS...` এ আটকে ৬০ সেকেন্ড পর
> timeout হয়। SFTP দেখতে সাধারণ SSH ট্রাফিকের মতো, তাই এ সমস্যা হয় না।
>
> **সবচেয়ে সহজ বিকল্প — FileZilla এড়িয়ে যান।** আর্কাইভটা Google Drive / Dropbox-এ রেখে direct
> link নিন, তারপর Terminal-এ:
>
> ```bash
> cd ~/backend
> curl -LO "<direct-download-url>"
> ```
>
> সার্ভার নিজেই নামায় — আপনার upload ব্যান্ডউইথও লাগে না, অফিসের ফায়ারওয়ালও মাঝখানে থাকে না।

**cPanel → Terminal:**

```bash
cd ~/backend
tar -xzf backend.tar.gz && rm backend.tar.gz
mkdir -p tmp && touch tmp/restart.txt
```

### ৫.২ Node app তৈরি

**cPanel → Setup Node.js App → Create Application:**

| ঘর | মান |
|---|---|
| Node.js version | 22.x |
| Application mode | Production |
| Application root | `backend` |
| Application URL | `api.topitsolution.com` |
| Application startup file | `app.js` |

**`PORT` দেবেন না** — Passenger নিজে দেয়।
**"Run NPM Install" চাপবেন না** — `node_modules` archive-এর ভেতরেই আছে।

### ৫.৩ Environment variables

একই স্ক্রিনে, একটা একটা করে। **এই ২৬টা না পেলে server boot-ই করবে না:**

```
NODE_ENV=production
PORT=5000
DATABASE_URL=mysql://cpuser_topituser:PASSWORD@localhost:3306/cpuser_topit
BETTER_AUTH_SECRET=<নতুন random, ৩২+ অক্ষর>
BETTER_AUTH_URL=https://api.topitsolution.com
ACCESS_TOKEN_SECRET=<নতুন random>
REFRESH_TOKEN_SECRET=<নতুন random>
ACCESS_TOKEN_EXPIRES_IN=1d
REFRESH_TOKEN_EXPIRES_IN=7d
EMAIL_SENDER_SMTP_USER=...
EMAIL_SENDER_SMTP_PASS=...
EMAIL_SENDER_SMTP_HOST=smtp.gmail.com
EMAIL_SENDER_SMTP_PORT=465
EMAIL_SENDER_SMTP_FROM=...
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
GOOGLE_CALLBACK_URL=https://api.topitsolution.com/api/auth/callback/google
FRONTEND_URL=https://topitsolution.com
CLOUDINARY_CLOUD_NAME=...
CLOUDINARY_API_KEY=...
CLOUDINARY_API_SECRET=...
SUPER_ADMIN_EMAIL=...
SUPER_ADMIN_PASSWORD=...
SUBSCRIPTION_BKASH_NUMBER=...
INTEGRATION_ENCRYPTION_KEY=<নতুন random>
```

ঐচ্ছিক কিন্তু **দরকারি**:

```
ADMIN_URL=https://admin.topitsolution.com
STOREFRONT_URL=https://topitsolution.com
STOREFRONT_REVALIDATE_SECRET=<random, frontend-এর REVALIDATE_SECRET-এর সমান>
```

> **`ADMIN_URL` না দিলে admin-এ CORS error** — allowlist এখান থেকেই তৈরি হয়
> ([app.ts](src/app/app.ts))।

> **`DEMO_DATABASES` দেবেন না।** ওটা শুধু demo host-এর জন্য (§১০)। না থাকলে এই install একদম
> সাধারণ single-shop — ঠিক যেমন client-এর কাছে যাবে।

### ৫.৪ Migration, যাচাই, restart

```bash
source ~/nodevenv/backend/22/bin/activate
cd ~/backend

npx prisma migrate deploy
npx tsx scripts/verify-mysql-charset.ts
```

**`verify-mysql-charset.ts`-এ একটাও FAIL এলে এগোবেন না** — §৩.১ ঠিকমতো হয়নি। Content বসানোর পর
ঠিক করা যাবে না।

> **`Cannot find module .../scripts/verify-mysql-charset.ts` এলে** — আপনার archive-টা
> `scripts/` ফোল্ডার ছাড়াই বানানো। `scripts/package-cpanel.mjs` এখন ওটা আর্কাইভে পাঠায়, তাই
> নতুন করে `npm run build:cpanel` চালালে সমস্যা থাকবে না। পুরনো archive নিয়ে এগোতে চাইলে নিচের
> SQL-টা phpMyAdmin-এ চালান — হুবহু একই আটটা চেক করে। `tsx` on-demand install-ও §৩.১-এর
> process limit-এ আটকাতে পারে, তাই SQL পথটা এমনিতেও নিরাপদ।

<details>
<summary>phpMyAdmin-এ একই যাচাই (SQL)</summary>

`topitsolution_topit` এর জায়গায় আপনার আসল database-এর নাম বসান। `DATABASE()` ব্যবহার করা হয়নি —
phpMyAdmin-এর SQL ট্যাবে ওটা খালি থাকতে পারে, তখন `tables exist` মিথ্যা করে `0` দেখায় আর
তার পরের তিনটা চেক আপনাআপনি PASS হয় — শূন্যের মধ্যে কোনো ভুল table থাকে না বলে।

```sql
SELECT 'database charset' AS check_name,
       DEFAULT_CHARACTER_SET_NAME AS value,
       IF(DEFAULT_CHARACTER_SET_NAME = 'utf8mb4', 'PASS', 'FAIL') AS result
FROM information_schema.SCHEMATA WHERE SCHEMA_NAME = 'topitsolution_topit'
UNION ALL
SELECT 'database collation', DEFAULT_COLLATION_NAME,
       IF(DEFAULT_COLLATION_NAME LIKE '%\_ci', 'PASS', 'FAIL')
FROM information_schema.SCHEMATA WHERE SCHEMA_NAME = 'topitsolution_topit'
UNION ALL
SELECT 'tables exist', CAST(COUNT(*) AS CHAR), IF(COUNT(*) > 0, 'PASS', 'FAIL')
FROM information_schema.TABLES WHERE table_schema = 'topitsolution_topit' AND TABLE_TYPE = 'BASE TABLE'
UNION ALL
SELECT 'tables NOT utf8mb4', CAST(COUNT(*) AS CHAR), IF(COUNT(*) = 0, 'PASS', 'FAIL')
FROM information_schema.TABLES WHERE table_schema = 'topitsolution_topit' AND TABLE_TYPE = 'BASE TABLE'
  AND TABLE_COLLATION NOT LIKE 'utf8mb4%'
UNION ALL
SELECT 'tables NOT case-insensitive', CAST(COUNT(*) AS CHAR), IF(COUNT(*) = 0, 'PASS', 'FAIL')
FROM information_schema.TABLES WHERE table_schema = 'topitsolution_topit' AND TABLE_TYPE = 'BASE TABLE'
  AND TABLE_COLLATION NOT LIKE '%\_ci'
UNION ALL
SELECT 'tables NOT InnoDB', CAST(COUNT(*) AS CHAR), IF(COUNT(*) = 0, 'PASS', 'FAIL')
FROM information_schema.TABLES WHERE table_schema = 'topitsolution_topit' AND TABLE_TYPE = 'BASE TABLE'
  AND ENGINE <> 'InnoDB'
UNION ALL
SELECT 'Bangla round trip', 'চার্জার ফাস্ট',
       IF('চার্জার ফাস্ট' = CONVERT('চার্জার ফাস্ট' USING utf8mb4), 'PASS', 'FAIL')
UNION ALL
SELECT 'case folding', 'Samsung = samsung',
       IF('Samsung' = 'samsung', 'PASS', 'FAIL');
```

</details>

**শুধু `database charset` FAIL করলে এগোনো যায়।** Prisma প্রতিটা table-এ নিজেই `utf8mb4_unicode_ci`
বসায়, তাই shop-এর content নিরাপদ — ইমোজিসহ। database default-টা `_prisma_migrations`, পরে
হাতে বানানো table আর raw query-র string literal-এর জন্য — ওটা পরে সাপোর্টকে দিয়ে ঠিক করা
যায় (§৩.১)। **কিন্তু `tables NOT utf8mb4` বা `tables NOT case-insensitive` FAIL করলে থামুন** —
সেটা content বসার আগেই সারাতে হবে:

```sql
SELECT CONCAT('ALTER TABLE `', TABLE_NAME,
              '` CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;') AS cmd
FROM information_schema.TABLES
WHERE table_schema = 'topitsolution_topit' AND TABLE_TYPE = 'BASE TABLE'
  AND TABLE_COLLATION <> 'utf8mb4_unicode_ci';
```

ফলাফলের `ALTER` লাইনগুলো কপি করে চালান, তারপর যাচাই আবার চালান।

আটটা PASS দেখলে:

```bash
touch ~/backend/tmp/restart.txt
```

প্রথম boot-এ role আর super admin নিজে থেকেই তৈরি হবে (`SUPER_ADMIN_EMAIL`/`PASSWORD` দিয়ে)।

**পরীক্ষা:** `https://api.topitsolution.com/api/v1/products` খুলুন — `{"success":true,...}` আসা উচিত।
---

## ৬. Storefront বসানো

`storefront.tar.gz` → `~/storefront/` এ আপলোড করে:

```bash
cd ~/storefront
tar -xzf storefront.tar.gz && rm storefront.tar.gz
mkdir -p tmp && touch tmp/restart.txt
```

> **পরে কখনো নতুন build তুললে পুরনোটা আগে মুছুন:**
>
> ```bash
> cd ~/storefront
> rm -rf .next node_modules public server.js package.json
> tar -xzf storefront.tar.gz && rm storefront.tar.gz
> touch tmp/restart.txt
> ```
>
> `tar -xzf` পুরনো ফাইল overwrite করে, কিন্তু মুছে না — Next-এর chunk-এর নাম প্রতি build-এ
> বদলায়, তাই পুরনো chunk পড়ে থাকলে Passenger কখনো সেগুলোই load করতে পারে। `tmp/` আর
> `stderr.log` রেখে দিচ্ছি — log-টাই পরের বার সমস্যা ধরার একমাত্র উপায়।

**Setup Node.js App → Create Application:**

| ঘর | মান |
|---|---|
| Node.js version | 22.x |
| Application root | `storefront` |
| Application URL | `topitsolution.com` |
| Application startup file | `server.js` |

Environment variables:

```
NODE_ENV=production
REVALIDATE_SECRET=<backend-এর STOREFRONT_REVALIDATE_SECRET-এর হুবহু সমান>
```

> দুটো আলাদা হলে admin-এ save করার পর storefront সাথে সাথে বদলাবে না — নিজের ~৩০০ সেকেন্ডের
> timer-এ বদলাবে। কোনো error দেখাবে না, শুধু "পুরনো দেখাচ্ছে" মনে হবে।

`touch ~/storefront/tmp/restart.txt` → `https://topitsolution.com` খুলুন।

### ৬.১ Internal Server Error এলে — `stderr.log` পড়ুন, अনুমান করবেন না

```bash
tail -50 ~/storefront/stderr.log
```

Passenger crash করলে আসল কারণ ওখানেই লেখে। ব্রাউজারে সব ভুল একই "Internal Server Error"
দেখায়। `.htaccess` না থাকলে সাধারণত **404** আসে, 500 নয় — তাই 500 মানে routing কাজ করছে,
app নিজে ব্যর্থ হচ্ছে।

| log-এ যা দেখবেন | কারণ |
|---|---|
| `Cannot find module '<package>-<16 hex>'` | §৪.২-এর build পুরনো। `next.config.ts`-এর `transpilePackages` এটা ঠেকায় — নতুন করে build করে উপরের পদ্ধতিতে পুরনো ফাইল মুছে তুলুন। প্যাকেজের নাম `postcss`, `sanitize-html` — যেকোনোটা হতে পারে |
| `Cannot find module` — अন্য কোনো package | archive अসম্পূর্ণ বা अর্ধেক extract হয়েছে |
| `EADDRINUSE` / port-সংক্রান্ত | Application startup file `server.js` কিনা দেখুন |
| `ApiError` / `status 0` | backend চালু নয়, বা `NEXT_PUBLIC_API_BASE_URL` ভুল |

---

## ৭. Admin বসানো

`admin/dist/` এর **ভেতরের সব ফাইল** → `~/admin-public/` এ আপলোড (ফোল্ডারটা নয়, ভেতরের জিনিস)।

`~/admin-public/.htaccess` ফাইল বানান — SPA-র জন্য লাগবে, নইলে refresh করলে 404:

```apache
<IfModule mod_rewrite.c>
  RewriteEngine On
  RewriteBase /
  RewriteRule ^index\.html$ - [L]
  RewriteCond %{REQUEST_FILENAME} !-f
  RewriteCond %{REQUEST_FILENAME} !-d
  RewriteRule . /index.html [L]
</IfModule>
```

`https://admin.topitsolution.com` → `SUPER_ADMIN_EMAIL` / `SUPER_ADMIN_PASSWORD` দিয়ে login।

---

## ৮. Google OAuth

Google Cloud Console → Credentials → OAuth client → **Authorized redirect URIs**-এ যোগ করুন:

```
https://api.topitsolution.com/api/auth/callback/google
```

---

## ৯. ⬅️ RAM মাপুন — এটাই আমার দরকার

তিনটেই চালু হওয়ার পর, একবার storefront আর admin ব্রাউজ করে নিন (process গুলো যাতে সত্যিই জেগে থাকে)।

**cPanel → Resource Usage** (বা sidebar-এর Statistics) → **Physical Memory Usage**।

সংখ্যাটা আমাকে বলবেন। আপনার সীমা **2 GB**।

| পাঠ | মানে |
|---|---|
| ≤ ৩০০ MB | ৫টা site আলাদা আলাদা রাখলেও ধরবে। Demo-র কোড নিষ্ক্রিয় পড়ে থাকবে, ক্ষতি নেই |
| ৩০০–৪০০ MB | সীমানায়। ভাগাভাগি করাই নিরাপদ |
| > ৪০০ MB | ৫টা আলাদা রাখা অসম্ভব — ভাগাভাগি ছাড়া উপায় নেই |

---

## ১০. Demo site — এখনো দুটো কাজ বাকি

Demo-র কোড লেখা শেষ (`DEMO_DATABASES` দিলেই ৪টা demo এক process-এ চলবে), কিন্তু **cPanel-এ বসাতে
গেলে দুটো জায়গায় আটকাবে**, আর এগুলো আমি design করার সময় ধরতে পারিনি:

**১. CORS allowlist ৪টা demo admin origin ধরতে পারে না.** [app.ts](src/app/app.ts)-এ
`origin` একটা স্থির array, আর `ADMIN_URL` একটামাত্র মান। `fashion.admin.topitsolution.com`,
`grocery.admin...` — কোনোটাই allow হবে না, admin login-ই হবে না।

**২. cPanel এক Node app-কে এক Application URL-এ বাঁধে.** ৪টা storefront subdomain এক Next.js
app-এ পাঠাতে হলে প্রতিটা subdomain-এর document root-এ একই Passenger `.htaccess` হাতে কপি করতে হবে।
কাজ করে, কিন্তু কোথাও লেখা নেই।

দুটোই ছোট কাজ। §৯-এর সংখ্যাটা পেলে তবেই বোঝা যাবে ভাগাভাগি আদৌ লাগবে কিনা — লাগলে এই দুটো বন্ধ
করে তারপর demo বসাব।

---

## ১১. সমস্যা হলে

| যা দেখবেন | কারণ |
|---|---|
| **503 / "Incomplete response"** | `source ~/nodevenv/backend/22/bin/activate && cd ~/backend && PORT=5099 node app.js` চালিয়ে আসল error দেখুন, আর `~/backend/stderr.log` পড়ুন |
| **`Environment variable X is required`** | §৫.৩-এর কোনো একটা বাদ পড়েছে। Server ইচ্ছাকৃতভাবে boot করে না, যাতে অর্ধেক-configure করা deployment চুপচাপ না চলে |
| **`P1001: Can't reach database server`** | `DATABASE_URL` `mysql://` দিয়ে শুরু হচ্ছে কি না, host `localhost`, port `3306`, আর password-এ special character থাকলে URL-encode করা আছে কি না |
| **`Data too long for column 'x'`** | ঐ column `VARCHAR(191)` রয়ে গেছে যেখানে `@db.Text` দরকার। `server/openspec/changes/switch-database-to-mysql/string-field-audit.tsv` দেখুন |
| **`The migration ... was modified after it was applied` / `We need to reset`** | **reset-এ রাজি হবেন না, সব ডেটা মুছে যাবে।** §১২.২-এর `repair-migration-checksums.ts` দেখুন |
| **নতুন column যোগ করতে গিয়ে migration ফেল** | Table-এ আগেই row আছে, column-টা nullable বা `@default(...)` নয়। §১২.২ দেখুন |
| **App নতুন field খুঁজছে, database-এ নেই** | `migrate deploy` চালানো হয়নি — build আপলোড হয়েছে কিন্তু schema পুরনো (§১২.২ ধাপ ৩) |
| **বাংলা লেখা `????` দেখাচ্ছে** | §৩.১ বাদ পড়েছে। ঐ data আর উদ্ধার হবে না — charset ঠিক করে আবার বসাতে হবে |
| **একই নামের brand দুবার তৈরি হচ্ছে** | collation `_ci` নয়। `verify-mysql-charset.ts` চালান |
| **Login হয় কিন্তু টেকে না** | HTTPS নেই (§২) |
| **Admin-এ CORS error** | `ADMIN_URL` env-এ নেই, বা admin build-এ `VITE_API_BASE_URL` ভুল |
| **Admin refresh করলে 404** | §৭-এর `.htaccess` বসানো হয়নি |
| **Admin সব request localhost-এ পাঠাচ্ছে** | `VITE_API_BASE_URL` ছাড়া build হয়েছে (§৪.৩) |
| **`Too many connections`** | `DATABASE_URL`-এ `?connection_limit=5` যোগ করুন |
| **`ERR_MODULE_NOT_FOUND`** | archive `npm run build:cpanel` দিয়ে বানানো হয়নি |
| **Storefront-এ `Cannot find module '<package>-<16 hex>'`** | §৬.১ দেখুন — পুরনো build, নতুন করে build করে পুরনো ফাইল মুছে তুলুন |
| **`bash: fork: Resource temporarily unavailable`** | cPanel-এর process limit ভরেছে — কমান্ডটা **চলেইনি**। কিছুক্ষণ अপেক্ষা করুন, বা কাজটা phpMyAdmin-এ করুন |
| **FileZilla: `Initializing TLS...` এ আটকে timeout** | অফিস/অ্যান্টিভাইরাসের TLS স্ক্যানিং FTPS handshake ভাঙছে। **SFTP** ব্যবহার করুন (port 22, cPanel username), অথবা Terminal-এ `curl -LO <url>` দিয়ে সার্ভারকেই নামাতে দিন |
| **`Cannot find module .../scripts/verify-*.ts`** | archive-এ `scripts/` নেই। `package-cpanel.mjs` এখন ওটা পাঠায় — নতুন build করুন, বা §৫.৪-এর SQL বিকল্প চালান |
| **`ALTER DATABASE` চললো কিন্তু charset বদলায়নি** | MySQL user-এর অনুমতি নেই, আর MySQL কোনো error দেয় না। হোস্টিং সাপোর্টকে বলুন (§৩.১) |
| **phpMyAdmin-এ `tables exist: 0` অথচ table দেখা যাচ্ছে** | SQL ট্যাবে `DATABASE()` খালি। কোয়ারিতে database-এর নাম সরাসরি লিখুন (§৫.৪) |
| **প্রথম request ধীর** | অনেকক্ষণ কেউ না এলে Passenger app বন্ধ করে দেয়। স্বাভাবিক |

### Vercel-এ যা আপনাআপনি হতো, এখানে নিজে করতে হবে

**Courier reconciliation cron** — cPanel → **Cron Jobs**:

```bash
curl -s -X POST https://api.topitsolution.com/api/v1/courier/sync \
  -H "Authorization: Bearer $COURIER_SYNC_SECRET"
```

না দিলে dispatch আর webhook চলবে, কিন্তু কোনো missed webhook আর কখনো catch-up হবে না।

---

# PART ২ — প্রতিবারের কাজ

## ১২. প্রতিবার update — রুটিন কাজ

PART ১ একবারই লাগে। এরপর থেকে যা করবেন সেটা এখানে।

**প্রথমে ঠিক করুন কোন ধরনের update:**

| কী বদলেছে | কী করতে হবে | কোথায় |
|---|---|---|
| শুধু backend কোড (service, route, controller) | build → upload → restart | §১২.১ |
| Prisma schema — নতুন field বা table | উপরেরটা **+ migration** | §১২.২ |
| Storefront কোড | আলাদা build, backend ছোঁয়ার দরকার নেই | §১২.৩ |
| Admin কোড | আলাদা build | §১২.৪ |
| শুধু product/banner/setting যোগ করা | **কিছুই না** — admin panel থেকেই হয় | — |

> **শেষ সারিটা খেয়াল করুন।** নতুন product, category, banner বা setting যোগ করা **database-এর
> content**, schema নয় — ওগুলোর জন্য কোনো deploy, migration বা restart লাগে না। Admin panel
> থেকে save করলেই storefront-এ চলে আসে (cache tag নিজে থেকে invalidate হয়)।

---

### ১২.১ শুধু backend কোড বদলালে

নিজের PC-তে:

```powershell
cd "D:\Next.js\electrode\server"
npm run build:cpanel
```

`backend.tar.gz` আপলোড করে cPanel Terminal-এ:

```bash
cd ~/backend
tar -xzf backend.tar.gz && rm backend.tar.gz
bash scripts/server-deploy.sh
```

`server-deploy.sh` দুটো কাজ করে: `package.json` বদলালে production dependency install করে
(না বদলালে বাদ দেয়), তারপর `tmp/restart.txt` touch করে Passenger reload করায়।

**Output-এর শেষ লাইন `==> Deploy complete.` কি না দেখুন।** Script টা `set -e` দিয়ে চলে — মাঝের
কোনো ধাপে (যেমন `npm install`) error হলে সেখানেই থামে, restart পর্যন্ত পৌঁছায়ই না। তখন disk-এ
নতুন code থাকে অথচ চলতে থাকে পুরনোটা, কারণ Node code একবারই memory-তে পড়ে।

**পরীক্ষা — আপনি যা বদলেছেন সেটাই খুঁজুন, শুধু `success` নয়।** `{"success":true}` পুরনো code-ও
দেয়, তাই ওটা দেখে বোঝা যায় না নতুন code চলছে কি না। যেমন নতুন setting field যোগ করলে
`https://api.topitsolution.com/api/v1/settings/public?v=2`-এ ঐ key টা আছে কি না দেখুন (`?v=2`
cache এড়ায়)। না থাকলে:

```bash
touch ~/backend/tmp/restart.txt
```

তাতেও না হলে cPanel → **Setup Node.js App** → **Restart**।

> ২০২৬-১০-০৫: `adminFaviconUrl` যোগ করার পর disk-এ নতুন `dist` ছিল, database-এ column আর মান
> ছিল, তবু API-তে key টা আসছিল না — app restart হয়নি। `success:true` পরীক্ষা এটা ধরতে পারেনি।

---

### ১২.২ Prisma schema বদলালে — নতুন field বা নতুন table

এটাই একমাত্র ধরনের update যেখানে **ডেটা নষ্ট হতে পারে**, তাই ধাপগুলো ক্রমে মানুন।

#### ⚠️ এই তিনটে command কখনো চালাবেন না

**এখন database খালি নয়, আসল order/product/customer আছে।** §০-এর কথাটা প্রথম deploy-এর, তারপর
থেকে আর খাটে না। তাই schema বদলানোর নিয়মও বদলে গেছে: যে command গুলো খালি database-এ নিরাপদ
ছিল, এখন সেগুলোই সব মুছে দিতে পারে।

**তিনটে command কখনো চালাবেন না** — কোনোটাই জিজ্ঞেস করে না, আর কোনোটাই ফেরানো যায় না:

| ❌ Command | কী করে |
|---|---|
| `prisma migrate reset` | **প্রতিটা table drop করে** নতুন করে বানায়। সব order, customer, product শেষ |
| `prisma db push` | migration file ছাড়াই database বদলায়। column rename/type বদলালে প্রায়ই "drop করে নতুন বানাই" পথ নেয় |
| `npm run push --workspace server` | উপরেরটারই shortcut — `package.json`-এ আছে, কিন্তু ওটা খালি database-এর জন্য |

> **`db push` কেন খারাপ, যদিও এটা "দ্রুত":** কোনো migration file তৈরি হয় না। মানে cPanel-এ ঐ
> একই বদল আনার কোনো উপায় থাকে না — local আর production schema আলাদা হয়ে যায়। আর তারপর
> `migrate dev` চালালে Prisma history-র সাথে অমিল দেখে **`migrate reset` অফার করে**, অর্থাৎ
> দ্রুত পথটা শেষ হয় সব ডেটা মোছার প্রস্তাবে।

#### যা করবেন — তিন ধাপ

**ধাপ ১ — Local-এ migration বানান**

```powershell
cd "D:\Next.js\electrode\server"
npm run migrate -- --name add_product_warranty
```

(এটাই `prisma migrate dev`।) এটা `prisma/migrations/`-এ নতুন folder বানায়, local database-এ
চালায়, আর Prisma client regenerate করে।

> **⚠️ চালানোর আগে `server/.env`-এ `DATABASE_URL` কয়টা আছে আর সেটা কোথায় যায়, দুটোই দেখুন।**
>
> ```bash
> grep -c "^DATABASE_URL" .env                 # ১ ছাড়া অন্য কিছু এলে থামুন
> grep "^DATABASE_URL" .env | grep -c "@localhost"   # ১ না এলে থামুন — ওটা local নয়
> ```
>
> **শুধু গোনা যথেষ্ট নয়।** ২০২৬-১০-০৫ তারিখে ওখানে প্রথমে **৪টে** ছিল (দুটো পুরনো Neon, একটা
> local, একটা production)। dotenv একই key বারবার পেলে **শেষেরটা জেতে**, তাই কোনটা সক্রিয় সেটা
> ফাইলের ক্রম দেখে বোঝা যায় না। পরে সেগুলো কমিয়ে **একটায়** আনা হয় — কিন্তু যেটা থেকে গেল
> সেটা ছিল `topitsolution.com:3306`, অর্থাৎ **production database সরাসরি**। গুনলে `1` আসত,
> অথচ `migrate dev` গিয়ে পড়ত আসল shop-এ। তাই দ্বিতীয় লাইনটা host যাচাই করে।
>
> **একটাই রাখুন, সেটা local** (`mysql://root:...@localhost:3306/ecom`)। Production URL দরকার
> হলে `.env.production` নামে আলাদা ফাইলে রাখুন — কোনো Prisma command ওটা নিজে থেকে পড়ে না।

**ধাপ ২ — Generated SQL পড়ুন, তারপর commit**

```bash
cat prisma/migrations/<নতুন-folder>/migration.sql
```

`DROP TABLE`, `DROP COLUMN` বা `TRUNCATE` থাকলে **থামুন** — আপনি শুধু কিছু যোগ করতে চেয়েছিলেন,
অথচ Prisma মোছার SQL লিখেছে। সাধারণত এর মানে schema-তে rename হয়েছে, আর Prisma rename বোঝে
না: পুরনো column drop করে নতুন একটা বানায়, মাঝের ডেটা হারিয়ে যায়।

**ধাপ ৩ — Server-এ apply করুন**

নতুন build আপলোডের পর (§৫.১), restart-এর **আগে**:

```bash
source ~/nodevenv/backend/22/bin/activate
cd ~/backend
npx prisma migrate deploy
touch tmp/restart.txt
```

`migrate deploy` নিরাপদ — শুধু যে migration গুলো এখনো চলেনি সেগুলো চালায়, কোনো reset করে না,
কিছু জিজ্ঞেসও করে না। **এর আগে phpMyAdmin → Export দিয়ে backup নিন।**

#### নতুন column যোগ করার নিয়ম

Table-এ আগে থেকেই row আছে, তাই নতুন column-কে হয় **nullable**, নয় **default** দিতে হবে:

```prisma
warranty      String?                      // ✅ nullable
isFeatured    Boolean  @default(false)      // ✅ default আছে
stockAlert    Int                           // ❌ migration ফেল করবে
```

তৃতীয়টায় MySQL বলবে পুরনো row গুলোতে কী বসাবে সেটা জানা নেই।

#### Checksum mismatch — এখানেই আসল ফাঁদ

Migration file apply হওয়ার **পরে** সেটা edit করলে Prisma বলবে:

```
The migration `...` was modified after it was applied.
We need to reset the database
```

**ঐ reset-এ রাজি হবেন না।** আপনার migration এখন মাত্র একটা (৬৩ table-এর `init`), তাই reset
মানে পুরো shop মুছে যাওয়া। এর জন্য আলাদা script আছে:

```bash
npx tsx scripts/repair-migration-checksums.ts          # শুধু দেখায়
npx tsx scripts/repair-migration-checksums.ts --force  # লেখে
```

এটা শুধু `_prisma_migrations`-এর recorded hash ঠিক করে — কোনো DDL চালায় না, কোনো table ছোঁয়
না। **তবে এটা নিরাপদ শুধু তখনই যখন edit-টা আসলে কিছু বদলায়নি** (comment, formatting, বা যে
statement আগেই চলে গেছে)। আসল DDL যোগ করে এটা চালালে database-এ ঐ DDL কখনো চলেনি অথচ "চলেছে"
লেখা থাকবে। Script-টার header comment-এ পুরো ব্যাখ্যা আছে — চালানোর আগে পড়ুন।

#### Drift আছে কি না — অনুমান না করে জেনে নিন

Schema আর database মিলছে কি না, সেটা Prisma নিজেই বলে দেয়:

```powershell
npx prisma migrate status
```

**"Database schema is up to date!"** এলে সব ঠিক — কিছু করার নেই।

আরো নিশ্চিত হতে চাইলে আসল database-এর সাথে schema মিলিয়ে দেখুন (read-only, কিছু বদলায় না):

```powershell
npx prisma migrate diff --from-config-datasource --to-schema prisma/schema --script
```

`-- This is an empty migration.` এলে কোনো অমিল নেই।

> **⚠️ `--from-migrations` দিয়ে drift যাচাই করবেন না।** ওটা migration folder থেকে schema
> পুনর্গঠনের চেষ্টা করে, আর এই repo-তে ব্যর্থ হয়ে "শূন্য থেকে সব বানাও" ধরে নেয় — ফলে ৫৯টা
> `CREATE TABLE` আর ২৭২টা `DROP` সহ ১৭৬৭ লাইনের SQL বেরোয়, যা দেখতে ভয়ানক drift-এর মতো
> অথচ আসলে কোনো drift নয়। **ঐ SQL ভুল করে চালালে পুরো database মুছে যাবে।** যাচাই করতে
> সবসময় `--from-config-datasource` (আসল database) ব্যবহার করুন।

> **Shadow database লাগলে আলাদা খালি একটা বানান** — `CREATE DATABASE shadow_tmp;`।
> কাজের database (`ecom`) shadow হিসেবে দেবেন না: `migrate diff` ওখানে schema বানায় আর
> মুছে ফেলে, অর্থাৎ ওর সব table চলে যাবে।

**যদি সত্যিই drift পান** — database-এ column আছে কিন্তু migration-এ নেই — তখন
`migrate diff`-এর SQL দিয়ে একটা migration folder বানিয়ে `migrate resolve --applied <folder>`
চালাতে হবে। এটা কোনো SQL চালায় না, শুধু `_prisma_migrations`-এ লিখে রাখে যে ওটা আগেই চলেছে।

---

### ১২.৩ Storefront কোড বদলালে

```powershell
cd "D:\Next.js\electrode\nextjs"
npm run build:cpanel
```

§৪.২-এর hash-check চালাতে ভুলবেন না, তারপর §৬-এর নিয়মে **পুরনো ফাইল মুছে** নতুন build তুলুন:

```bash
cd ~/storefront
rm -rf .next node_modules public server.js package.json
tar -xzf storefront.tar.gz && rm storefront.tar.gz
touch tmp/restart.txt
```

> Backend-এর URL না বদলালে backend-এ কিছু করার দরকার নেই — দুটো আলাদা app।

---

### ১২.৪ Admin কোড বদলালে

```powershell
cd "D:\Next.js\electrode\admin"
$env:VITE_API_BASE_URL="https://api.topitsolution.com/api/v1"
$env:VITE_STOREFRONT_URL="https://topitsolution.com"
npm run build
```

`admin/dist/`-এর **ভেতরের সব ফাইল** → `~/admin-public/` এ। `.htaccess` আগের বারেরটাই থাকবে,
আবার বানাতে হবে না।

> দুটো `$env:` ভুলবেন না — এগুলো build-time মান। না দিলে panel localhost-এ request পাঠাবে (§৪.৩)।

---

### ১২.৫ প্রতিটা update-এর আগে — ছোট checklist

- [ ] Schema বদলেছে? → §১২.২, আর **phpMyAdmin → Export দিয়ে backup**
- [ ] `.env`-এ কয়টা `DATABASE_URL` সক্রিয়? → `grep -c "^DATABASE_URL" .env` (১ হওয়া উচিত)
- [ ] Storefront build করলে hash-check চালিয়েছেন? → §৪.২
- [ ] Admin build করলে দুটো `$env:` দিয়েছেন? → §৪.৩
- [ ] Deploy-এর পর `settings/public` খুলে দেখেছেন?
