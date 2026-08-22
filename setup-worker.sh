#!/usr/bin/env bash
# One-time setup for the admin API. Run from the project root: ./setup-worker.sh
#
# You will be prompted twice by Cloudflare's own tooling:
#   - once in the browser, to authorise wrangler against your account
#   - once in the terminal, to type the admin password (it is never echoed or logged)
set -euo pipefail

CFG=worker/wrangler.toml

echo "==> 1/5  Signing in to Cloudflare (opens a browser)"
npx wrangler login

echo
echo "==> 2/5  Creating the KV namespace"
OUT=$(npx wrangler kv namespace create TIMELINE --config "$CFG" 2>&1) || { echo "$OUT"; exit 1; }
echo "$OUT"
ID=$(printf '%s' "$OUT" | grep -oE '[0-9a-f]{32}' | head -1)
if [ -z "$ID" ]; then
  echo "Could not read the namespace id from the output above."
  echo "Copy it into $CFG by hand, then re-run from step 3."
  exit 1
fi
python3 - "$CFG" "$ID" <<'PY'
import re, sys, pathlib
cfg, nid = pathlib.Path(sys.argv[1]), sys.argv[2]
s = cfg.read_text()
s = re.sub(r'^id = ".*"$', f'id = "{nid}"', s, flags=re.M)
cfg.write_text(s)
print(f"    wrote namespace id {nid} into {cfg}")
PY

echo
echo "==> 3/5  Setting the admin password (typed by you, never shown to anyone else)"
npx wrangler secret put ADMIN_PASSWORD --config "$CFG"

echo
echo "==> 4/5  Setting the session signing key (random, generated locally)"
python3 -c "import secrets;print(secrets.token_urlsafe(48))" \
  | npx wrangler secret put SESSION_SECRET --config "$CFG"

echo
echo "==> 5/5  Deploying"
npx wrangler deploy --config "$CFG"

echo
echo "Done. Copy the workers.dev URL printed above into v2/config.js:"
echo '    window.BT_API = "https://baby-timeline-api.<your-subdomain>.workers.dev";'
echo "then: git add -A && git commit -m 'point v2 at the API' && git push"
