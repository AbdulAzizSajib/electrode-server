# Backend CI/CD — GitHub Actions → cPanel (`api.topitsolution.com`)

`DEPLOY-topitsolution.md` দিয়ে হাতে একবার deploy করা হয়ে গেছে — এই ফাইল তার পরের ধাপ: **`server` repo-তে
`main`-এ push করলেই backend নিজে থেকে build হয়ে cPanel-এ উঠবে।**

> **এটা শুধু এই repo-র (`electrode-server`) জন্য।** Storefront আর admin-এর CI/CD তাদের নিজের repo-তে
> নিজের ফাইলে (`frontend/CICD-topitsolution.md`, `admin/CICD-topitsolution.md`)। তিনটা workflow
> একে অপরের থেকে সম্পূর্ণ আলাদা — server-এ push করলে শুধু backend deploy হবে, বাকি দুটো ছোঁবে না।
>
> এতে আসল domain আছে — client-এর জন্য কোড clone করার সময় এই ফাইলও মুছে দেবেন, `DEPLOY-topitsolution.md`-এর মতো।

---

## ০. কীভাবে কাজ করবে

```
git push (main)
   └─ GitHub Actions (Linux runner)
        ├─ npm ci
        ├─ verify-postman-routes.ts      ← API contract ভাঙলে এখানেই থামবে
        ├─ npm run build:cpanel          ← backend.tar.gz (আপনার PC-তে যা বানাতেন, হুবহু সেটাই)
        ├─ scp → ~/deploy/backend.tar.gz
        └─ ssh → নতুন folder-এ extract → prisma migrate deploy → folder swap → restart
                 └─ https://api.topitsolution.com/api/v1/products যাচাই
```

**কেন cPanel-এর নিজের "Git Version Control" নয়:** ওটা repo-র source টেনে আনে, তারপর build
cPanel-এর ভেতরেই করতে হয় — `npm install`, `prisma generate`, `tsc`। shared plan-এ ঠিক ওটাই ভাঙে
(process limit-এ `fork: Resource temporarily unavailable`, আর `package-cpanel.mjs`-এর মাথায় লেখা
আছে "Run NPM Install" কেন ব্যর্থ হয়)। তাই build হয় GitHub-এর machine-এ, cPanel শুধু তৈরি archive
পায় — ঠিক যেভাবে এখন হাতে করছেন।

বাড়তি লাভ: archive এখন **Linux-এ** build হবে। `package-cpanel.mjs` সতর্ক করে যে Windows-এ বানানো
`node_modules` শুধু ততদিন নিরাপদ যতদিন কোনো native dependency নেই — সেই ঝুঁকি এখানে আর নেই।

---

## ১. একবারের setup — SSH key

GitHub-এর machine-কে আপনার cPanel-এ ঢোকার অনুমতি দিতে একটা আলাদা key লাগবে।

> **তিনটা repo-তে একই key ব্যবহার করতে পারেন** — key-টা একবার বানাবেন, শুধু GitHub secret তিনটা repo-তে
> আলাদা আলাদা বসাবেন। Storefront/admin-এর ফাইলেও এই ধাপ আছে; একবার করা থাকলে সেখানে আবার
> key বানাতে হবে না।

### ১.১ নিজের PC-তে key বানান (Git Bash)

```bash
ssh-keygen -t ed25519 -C "github-deploy-topit" -f ~/.ssh/topit_deploy -N ""
```

দুটো ফাইল হবে: `~/.ssh/topit_deploy` (private — GitHub-এ যাবে) আর `~/.ssh/topit_deploy.pub` (public — cPanel-এ যাবে)।

### ১.২ Public key cPanel-এ বসান

**cPanel → Terminal:**

```bash
mkdir -p ~/.ssh && chmod 700 ~/.ssh
echo 'ssh-ed25519 AAAA...পুরো লাইনটা... github-deploy-topit' >> ~/.ssh/authorized_keys
chmod 600 ~/.ssh/authorized_keys
```

(`.pub` ফাইলের পুরো একটা লাইন `echo '...'`-এর ভেতরে পেস্ট করবেন। পেস্টে `^[[200~` জুড়ে গেলে লাইনটা
নষ্ট হবে — `DEPLOY-topitsolution.md` §৩.১ দেখুন। তখন **cPanel → SSH Access → Import Key** দিয়ে বসিয়ে
**Manage → Authorize** চাপুন।)

### ১.৩ SSH host কোনটা — আগে PC থেকে পরীক্ষা করুন

```bash
ssh -i ~/.ssh/topit_deploy -p 22 CPUSER@HOST 'echo ok && which tar'
```

- `CPUSER` = cPanel username।
- `HOST` = FileZilla-তে SFTP-র জন্য যে host দিয়েছিলেন সেটাই। **domain Cloudflare-এর পেছনে থাকলে
  `topitsolution.com` দিয়ে SSH হবে না** — তখন cPanel-এর ডান sidebar-এর **Shared IP Address** বা
  server hostname দিন।
- `ok` না এলে এগোবেন না। §৭ দেখুন।

### ১.৪ Host fingerprint তুলে রাখুন

```bash
ssh-keyscan -p 22 HOST
```

যা বেরোবে সব লাইন কপি — এটা `SSH_KNOWN_HOSTS` secret হবে। এটা দিলে GitHub নিশ্চিত হয় যে সে সত্যিই
আপনার server-এ ঢুকছে।

---

## ২. একবারের setup — migration-এর জন্য DB URL

cPanel-এর **Setup Node.js App**-এ যে env variable দিয়েছেন সেগুলো শুধু Passenger-এর চালানো app পায় —
**SSH session পায় না।** তাই `prisma migrate deploy` চালাতে `DATABASE_URL` আলাদা একটা ফাইলে রাখতে হবে।

**cPanel → Terminal:**

```bash
mkdir -p ~/deploy && chmod 700 ~/deploy
nano ~/deploy/backend.env
```

ভেতরে এক লাইন (Node app-এ যা দিয়েছেন হুবহু তাই):

```
DATABASE_URL=mysql://cpuser_topituser:PASSWORD@localhost:3306/cpuser_topit
```

```bash
chmod 600 ~/deploy/backend.env
```

> DB password GitHub-এ যায় না — শুধু server-এই থাকে। `~/deploy/` public_html-এর বাইরে, তাই web থেকে
> পড়া যায় না।

---

## ৩. GitHub-এ secret বসানো — শুধু `electrode-server` repo-তে

**GitHub → `AbdulAzizSajib/electrode-server` → Settings → Secrets and variables → Actions → New repository secret:**

| Secret | মান |
|---|---|
| `SSH_HOST` | §১.৩-এর `HOST` |
| `SSH_PORT` | `22` (আপনার host অন্য port দিলে সেটা) |
| `SSH_USER` | cPanel username |
| `SSH_PRIVATE_KEY` | `~/.ssh/topit_deploy` ফাইলের **পুরো** লেখা, `-----BEGIN` থেকে `-----END` লাইন পর্যন্ত |
| `SSH_KNOWN_HOSTS` | §১.৪-এর output |

`gh` CLI থাকলে (Git Bash, `server/` folder থেকে):

```bash
gh secret set SSH_HOST        --body "HOST"
gh secret set SSH_PORT        --body "22"
gh secret set SSH_USER        --body "CPUSER"
gh secret set SSH_PRIVATE_KEY < ~/.ssh/topit_deploy
ssh-keyscan -p 22 HOST | gh secret set SSH_KNOWN_HOSTS
```

(`server/` folder থেকে চালালে `gh` নিজেই `electrode-server` repo ধরে — অন্য repo-তে যায় না।)

---

## ৪. Workflow ফাইল

`server/.github/workflows/deploy.yml` বানান:

```yaml
name: Deploy backend

on:
  push:
    branches: [main]
  workflow_dispatch:

# একটার পর একটা — দুটো push পরপর হলে দ্বিতীয়টা প্রথমটা শেষ হওয়ার অপেক্ষা করবে,
# মাঝপথে কাটবে না (মাঝপথে কাটলে migration অর্ধেক থেকে যেতে পারে)।
concurrency:
  group: deploy-backend
  cancel-in-progress: false

jobs:
  deploy:
    runs-on: ubuntu-latest
    timeout-minutes: 25

    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm

      - run: npm ci

      - name: Postman contract
        run: npx tsx scripts/verify-postman-routes.ts

      - name: Build archive
        run: npm run build:cpanel
        env:
          # prisma generate-এর জন্য — DB-তে কোনো connection হয় না, তাই নকল মানই যথেষ্ট
          DATABASE_URL: mysql://ci:ci@localhost:3306/ci

      - name: SSH setup
        run: |
          mkdir -p ~/.ssh && chmod 700 ~/.ssh
          printf '%s\n' "${{ secrets.SSH_PRIVATE_KEY }}" > ~/.ssh/deploy_key
          chmod 600 ~/.ssh/deploy_key
          printf '%s\n' "${{ secrets.SSH_KNOWN_HOSTS }}" > ~/.ssh/known_hosts
          cat > ~/.ssh/config <<EOF
          Host cpanel
            HostName ${{ secrets.SSH_HOST }}
            Port ${{ secrets.SSH_PORT }}
            User ${{ secrets.SSH_USER }}
            IdentityFile ~/.ssh/deploy_key
            IdentitiesOnly yes
            ServerAliveInterval 30
          EOF

      - name: Upload
        run: |
          ssh cpanel 'mkdir -p ~/deploy'
          scp backend.tar.gz cpanel:deploy/backend.tar.gz

      - name: Release
        run: |
          ssh cpanel 'bash -s' <<'REMOTE'
          set -eo pipefail
          APP="$HOME/backend"
          NEW="$HOME/backend.new"
          OLD="$HOME/backend.old"

          # ১. নতুন build আলাদা folder-এ — চালু app এখনো ছোঁয়া হয়নি
          rm -rf "$NEW" && mkdir -p "$NEW"
          tar -xzf "$HOME/deploy/backend.tar.gz" -C "$NEW"
          rm -f "$HOME/deploy/backend.tar.gz"
          mkdir -p "$NEW/tmp"

          # ২. Migration — ব্যর্থ হলে script এখানেই থামে, পুরনো app চলতেই থাকে
          source "$HOME/nodevenv/backend/22/bin/activate"
          set -a; . "$HOME/deploy/backend.env"; set +a
          cd "$NEW"
          PRISMA_VERSION=$(node -p "require('./package.json').devDependencies.prisma")
          npx --yes "prisma@$PRISMA_VERSION" migrate deploy

          # ৩. Swap — এক মুহূর্তের কাজ। পুরনোটা backend.old-এ থাকে rollback-এর জন্য
          cd "$HOME"
          rm -rf "$OLD"
          mv "$APP" "$OLD"
          mv "$NEW" "$APP"
          touch "$APP/tmp/restart.txt"
          echo "Released."
          REMOTE

      - name: Health check
        run: |
          curl -fsS --retry 6 --retry-delay 10 --retry-all-errors \
            https://api.topitsolution.com/api/v1/products | head -c 300

      - name: Server log on failure
        if: failure()
        run: ssh cpanel 'tail -60 ~/backend/stderr.log 2>/dev/null || echo "stderr.log নেই"'
```

### এই ধাপগুলো কেন এভাবে

- **নতুন folder-এ extract, তারপর swap** — পুরনো ফাইলের ওপর `tar -xzf` করলে মুছে যাওয়া ফাইল পড়ে থাকে,
  আর extract চলাকালীন কেউ request করলে অর্ধেক-নতুন অর্ধেক-পুরনো code পায়। Swap দুটো `mv` — প্রায় সাথে সাথে।
- **Migration swap-এর আগে** — migrate ব্যর্থ হলে `set -e` script থামিয়ে দেয়, `~/backend` তখনো পুরনো,
  site চলতে থাকে। শুধু GitHub-এ লাল ✗ দেখবেন।
- **Prisma-র version `package.json` থেকে** — `prisma` devDependency, archive-এর `node_modules`-এ নেই
  (`--omit=dev`)। `npx` host-এ নামিয়ে নেয় — `DEPLOY-topitsolution.md` §৫.৪-এ হাতে যেটা চালিয়েছিলেন, এটা
  সেই একই কমান্ড, শুধু version বাঁধা যাতে local-এর সাথে কখনো না মেলে এমন না হয়।
- **`stderr.log` পুরনো folder-এ থেকে যায়** — নতুন process নতুন log লেখে। আগের crash খুঁজতে
  `~/backend.old/stderr.log` দেখবেন।

---

## ৫. প্রথমবার চালানো

```bash
cd server
git add .github/workflows/deploy.yml
git commit -m "ci: deploy backend to cPanel"
git push
```

**GitHub → Actions** ট্যাবে "Deploy backend" চলতে দেখবেন (~৪–৮ মিনিট)। সব ধাপ সবুজ হলে
`https://api.topitsolution.com/api/v1/products` খুলে দেখুন।

Push ছাড়াই আবার চালাতে: Actions → Deploy backend → **Run workflow**।

> **`main`-এ প্রতিটা push এখন live-এ যায়।** অর্ধেক কাজ push করতে চাইলে আলাদা branch-এ করুন,
> শেষ হলে `main`-এ merge করুন।

---

## ৬. Rollback — নতুন version ভাঙলে

**cPanel → Terminal:**

```bash
cd ~
mv backend backend.broken
mv backend.old backend
touch backend/tmp/restart.txt
```

> **Migration ফেরত যায় না।** নতুন version কোনো column মুছে দিলে পুরনো code সেটা খুঁজবে আর ভাঙবে।
> সাধারণ যোগ-করা migration (নতুন column, নতুন table) হলে পুরনো code নিশ্চিন্তে চলে।

ঠিক করে আবার push করলে workflow `backend.broken` ছোঁবে না — হাতে `rm -rf ~/backend.broken` দেবেন।

---

## ৭. সমস্যা হলে

| যা দেখবেন | কারণ |
|---|---|
| **`Permission denied (publickey)`** | §১.২-এর public key বসেনি, বা `SSH_PRIVATE_KEY`-এ BEGIN/END লাইন বাদ পড়েছে। PC থেকে §১.৩-এর কমান্ড আবার চালান |
| **`Host key verification failed`** | `SSH_KNOWN_HOSTS` খালি বা অন্য host-এর। `SSH_HOST`-এ যা দিয়েছেন সেটা দিয়েই `ssh-keyscan` চালান |
| **`Connection timed out` port 22-এ** | domain Cloudflare-এর পেছনে, বা host SSH-এর জন্য অন্য port দেয়। §১.৩ দেখুন |
| **`npm ci` ব্যর্থ: lockfile মেলে না** | `package.json` বদলেছেন কিন্তু `package-lock.json` commit করেননি। local-এ `npm install` চালিয়ে lockfile commit করুন |
| **`verify-postman-routes` ব্যর্থ** | route বদলেছেন কিন্তু Postman collection নয় (বা উল্টো)। collection ঠিক করে push করুন — এটা ইচ্ছাকৃত gate |
| **`fork: Resource temporarily unavailable`** | cPanel-এর process limit। কিছুই বদলায়নি (swap-এর আগে থেমেছে)। কয়েক মিনিট পর Actions-এ **Re-run jobs** |
| **migrate ব্যর্থ: `P1001` / `DATABASE_URL`** | `~/deploy/backend.env` নেই বা ভুল (§২)। site পুরনো version-এ চলছে |
| **Release সবুজ, Health check লাল** | নতুন code boot হয়নি। "Server log on failure" ধাপের output পড়ুন, তারপর §৬ rollback |
| **`Disk quota exceeded`** | `backend` + `backend.old` + `backend.new` তিনটে একসাথে থাকে (প্রতিটা কয়েকশো MB)। `rm -rf ~/backend.old ~/backend.broken` |

**GitHub Actions-এর খরচ:** private repo-তে মাসে ২,০০০ মিনিট ফ্রি। একেকটা deploy ৪–৮ মিনিট।
