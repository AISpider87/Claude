#!/usr/bin/env bash
# Lighthouse (mobile) on the public pages of a running build.
#   npm run build && npm run start &   then:   scripts/lighthouse.sh [base-url]
# Needs a Chromium (CHROME_PATH) and downloads lighthouse on first run.
set -euo pipefail
BASE="${1:-http://127.0.0.1:3000}"
OUT="${LH_OUT:-lighthouse}"
mkdir -p "$OUT"
for path in login registrati offline; do
  npx --yes lighthouse@12 "$BASE/$path" --quiet \
    --chrome-flags="--headless=new --no-sandbox --disable-gpu" \
    --form-factor=mobile --screenEmulation.mobile \
    --only-categories=performance,accessibility,best-practices,seo \
    --output=json --output-path="$OUT/$path.json" >/dev/null
  node -e "const r=require('./$OUT/$path.json');console.log('$path', Object.values(r.categories).map(x=>x.id+'='+Math.round(x.score*100)).join(' '))"
done
