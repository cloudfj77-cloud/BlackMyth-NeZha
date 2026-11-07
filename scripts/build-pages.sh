#!/usr/bin/env bash
# Build the GitHub Pages site: the ForgeAX game at /WhiteMyth-NeZha/ plus the three.js v1.4.0 build at /legacy/.
set -euo pipefail
cd "$(dirname "$0")/.."
export PATH="$HOME/.local/bin:$PATH"
tmp="$(mktemp -d)"
pnpm exec forgeax project build --html-head web/head.html --base /WhiteMyth-NeZha/ --out-dir "$tmp/site" --json > .forgeax/diag/pages-build.json 2>&1 || { tail -c 2000 .forgeax/diag/pages-build.json; exit 1; }
rm -rf site && mkdir -p site/legacy
cp -R "$tmp/site/." site/
cp -R legacy/threejs-v1.4.0/wukong/. site/legacy/
touch site/.nojekyll
rm -rf "$tmp"
echo "site ready: $(du -sh site | cut -f1)"
