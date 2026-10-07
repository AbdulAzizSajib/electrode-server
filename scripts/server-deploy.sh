#!/bin/bash
# এই স্ক্রিপ্টটা cPanel server-এ চলে (GitHub Actions SSH দিয়ে call করে —
# .github/workflows/deploy-backend.yml দেখুন)।
# কাজ: package.json বদলালে production dependencies install করা, তারপর Passenger restart।
#
# কেন: rsync শুধু বদলানো file পাঠায়। dependency বদলালে server-এ নতুন package
# install দরকার; না বদলালে শুধু restart-ই যথেষ্ট।
#
# ⚠️ এই script কোনো Prisma command চালায় না — migrate deploy ও নয়।
# Database-এ আসল order/product/customer data আছে। Schema বদলালে সেটা হাতে,
# backup নিয়ে চালাতে হবে (CPANEL-DEPLOY.md §5.4)। `prisma migrate reset` আর
# `prisma db push` data মুছে দেয় — এই ফাইলে ওগুলো কখনো আসবে না।

set -euo pipefail

APP_DIR="$HOME/backend"
NODE_ENV_ACTIVATE="$HOME/nodevenv/backend/22/bin/activate"
HASH_FILE="$APP_DIR/.deploy-pkg-hash"

cd "$APP_DIR"

# cPanel Node 22 environment activate (node + npm PATH-এ আসে)।
# cPanel-এর activate script CL_VIRTUAL_ENV-এর মতো unset variable ছোঁয়,
# তাই source করার সময় `set -u` (nounset) সাময়িকভাবে বন্ধ রাখি।
set +u
# shellcheck disable=SC1090
source "$NODE_ENV_ACTIVATE"
set -u

echo "==> Node: $(node -v), npm: $(npm -v)"

# package.json এর hash বের করি — আগেরবারের সাথে মিলিয়ে দেখি বদলেছে কিনা।
NEW_HASH="$(sha256sum package.json | awk '{print $1}')"
OLD_HASH=""
if [ -f "$HASH_FILE" ]; then
  OLD_HASH="$(cat "$HASH_FILE")"
fi

if [ -d node_modules ] && [ ! -L node_modules ]; then
  # A real node_modules directory means it came inside backend.tar.gz
  # (scripts/package-cpanel.mjs installs production deps into the archive).
  # The dependencies are already here, and CloudLinux's NodeJS Selector refuses
  # `npm install` while node_modules is a folder rather than its own symlink
  # into ~/nodevenv — so installing would only fail. Record the hash and move on.
  echo "==> node_modules shipped in the archive → skipping npm install."
  echo "$NEW_HASH" > "$HASH_FILE"
elif [ "$NEW_HASH" != "$OLD_HASH" ]; then
  echo "==> package.json changed → installing production dependencies..."
  # `npm ci` নয়, `npm install` — archive-এ package-lock.json যায় না
  # (scripts/package-cpanel.mjs staging tree-তে lock রাখে না), আর ci lock
  # ছাড়া চলে না।
  #
  # package-lock.json মুছি না। আগের version মুছত "পুরোনো version আটকে রাখে"
  # যুক্তিতে, কিন্তু lock-এর কাজই সেটা: ওটা মুছলে প্রতিবার dependency-র নতুন
  # minor/patch আসে, ফলে host-এ যা চলছে তা CI-তে build হওয়া tree-র সাথে আর
  # মেলে না — আর সেই অমিল কেবল production-এ ধরা পড়ে।
  npm install --omit=dev --no-audit --no-fund
  echo "$NEW_HASH" > "$HASH_FILE"
else
  echo "==> package.json unchanged → skipping npm install."
fi

# Passenger restart: tmp/restart.txt touch করলেই অ্যাপ reload হয়।
mkdir -p "$APP_DIR/tmp"
touch "$APP_DIR/tmp/restart.txt"
echo "==> Touched tmp/restart.txt — Passenger will reload the app."

echo "==> Deploy complete."
