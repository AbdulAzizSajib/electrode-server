# topitsolution.com — cPanel deploy runbook

আপনার নিজের site cPanel-এ তোলার ধাপে ধাপে নির্দেশ। **Demo site এখানে নেই** — ওটা পরে, §১০ দেখুন।

> **এই ফাইলটা আপনার নিজের deployment-এর, generic নির্দেশ নয়।** এতে আসল domain আর DB-র নাম আছে।
> `server/` repo-তে রাখা হয়েছে যাতে git-এ থাকে — root কোনো repo নয়, ওখানে রাখলে কোনো backup থাকত না।
>
> **মানে এটা clone-এর সাথে যাবে।** Client-এর জন্য কোড copy করার সময় এই ফাইলটা মুছে দেবেন:
> `rm DEPLOY-topitsolution.md`. Generic নির্দেশ `CPANEL-DEPLOY.md`-এ, সেটাই client-এর জন্য।

---

## ০. শুরুর আগে তিনটে কথা

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

**cPanel → Terminal:**

```bash
mysql -u cpuser_topituser -p cpuser_topit -e "ALTER DATABASE cpuser_topit CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"
```

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
cd "E:\Next Level Project\E-Commerce\Ecom\server"
npm run build:cpanel
```

→ `server/backend.tar.gz` (~৭৭ MB)

### ৪.২ Storefront

`frontend/.env.production.local` ফাইলে (না থাকলে বানান):

```
NEXT_PUBLIC_API_BASE_URL=https://api.topitsolution.com/api/v1
```

```powershell
cd "E:\Next Level Project\E-Commerce\Ecom\frontend"
npm run build:cpanel
```

→ `frontend/storefront.tar.gz` (~১৪ MB)

> `NEXT_PUBLIC_*` মান **build-এর সময়** bundle-এ বসে যায়। cPanel-এর env-এ পরে বদলালে কিছুই হবে না —
> আবার build করতে হবে।

### ৪.৩ Admin

```powershell
cd "E:\Next Level Project\E-Commerce\Ecom\admin"
$env:VITE_API_BASE_URL="https://api.topitsolution.com/api/v1"
npm run build
```

→ `admin/dist/`

> এটাও build-time। **না দিলে** panel নিজের origin (`admin.topitsolution.com/api/v1`) কে API ধরবে,
> যেখানে কিছু নেই — সব request 404 হবে।

---

## ৫. Backend বসানো

### ৫.১ আপলোড

FileZilla দিয়ে `backend.tar.gz` → `~/backend/` এ। (৭৭ MB File Manager-এ প্রায়ই আটকায়।)

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
| **বাংলা লেখা `????` দেখাচ্ছে** | §৩.১ বাদ পড়েছে। ঐ data আর উদ্ধার হবে না — charset ঠিক করে আবার বসাতে হবে |
| **একই নামের brand দুবার তৈরি হচ্ছে** | collation `_ci` নয়। `verify-mysql-charset.ts` চালান |
| **Login হয় কিন্তু টেকে না** | HTTPS নেই (§২) |
| **Admin-এ CORS error** | `ADMIN_URL` env-এ নেই, বা admin build-এ `VITE_API_BASE_URL` ভুল |
| **Admin refresh করলে 404** | §৭-এর `.htaccess` বসানো হয়নি |
| **Admin সব request localhost-এ পাঠাচ্ছে** | `VITE_API_BASE_URL` ছাড়া build হয়েছে (§৪.৩) |
| **`Too many connections`** | `DATABASE_URL`-এ `?connection_limit=5` যোগ করুন |
| **`ERR_MODULE_NOT_FOUND`** | archive `npm run build:cpanel` দিয়ে বানানো হয়নি |
| **প্রথম request ধীর** | অনেকক্ষণ কেউ না এলে Passenger app বন্ধ করে দেয়। স্বাভাবিক |

### Vercel-এ যা আপনাআপনি হতো, এখানে নিজে করতে হবে

**Courier reconciliation cron** — cPanel → **Cron Jobs**:

```bash
curl -s -X POST https://api.topitsolution.com/api/v1/courier/sync \
  -H "Authorization: Bearer $COURIER_SYNC_SECRET"
```

না দিলে dispatch আর webhook চলবে, কিন্তু কোনো missed webhook আর কখনো catch-up হবে না।
