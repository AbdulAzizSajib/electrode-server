#!/bin/bash
# এই স্ক্রিপ্টটা cPanel server-এ চলে (GitHub Actions SSH দিয়ে call করে)।
# কাজ: package.json বদলালে production dependencies install করা, তারপর Passenger restart।
#
# কেন: rsync শুধু dist/ + package.json + prisma/ পাঠায়। dependency বদলালে
# server-এ নতুন package install দরকার; না বদলালে শুধু restart-ই যথেষ্ট।

set -euo pipefail

APP_DIR="$HOME/my-nodejs-pro"
NODE_ENV_ACTIVATE="$HOME/nodevenv/my-nodejs-pro/20/bin/activate"
HASH_FILE="$APP_DIR/.deploy-pkg-hash"

cd "$APP_DIR"

# cPanel Node 20 environment activate (node + npm PATH-এ আসে)।
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

if [ "$NEW_HASH" != "$OLD_HASH" ]; then
  echo "==> package.json changed → installing production dependencies..."
  # package-lock.json থাকলে পুরোনো version আটকে রাখে — মুছে দিই (DEPLOYMENT.md অনুযায়ী)।
  rm -f package-lock.json
  # Build server-এ হয় না, prisma generate লাগে না (driver adapter)।
  # তাই শুধু production deps install করি।
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
