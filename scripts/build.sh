#!/usr/bin/env bash
# Build the browser dist with the localized startup cover (web/head.html).
set -euo pipefail
cd "$(dirname "$0")/.."
export PATH="$HOME/.local/bin:$PATH"
out=".forgeax/diag/build.json"
mkdir -p .forgeax/diag
pnpm exec forgeax project build --html-head web/head.html --json > "$out" 2>&1 || true
python3 - "$out" <<'PY'
import json, sys
raw = open(sys.argv[1]).read()
j = json.loads(raw[raw.rfind('{"ok"'):])
def walk(o):
    if isinstance(o, dict):
        if o.get('severity') in ('error', 'warning'): yield o
        for v in o.values(): yield from walk(v)
    elif isinstance(o, list):
        for v in o: yield from walk(v)
seen = set()
for e in walk(j):
    k = (e.get('severity'), e.get('rule'), e.get('actual'))
    if k in seen: continue
    seen.add(k)
    print('  ', k, (e.get('sourcePath') or '')[-48:], (e.get('hint') or '')[:140])
if j['ok']:
    print('build ok:', j['value']['artifactCount'], 'artifacts,', round(j['value']['artifactBytes'] / 1e6, 1), 'MB')
else:
    print('build FAILED:', json.dumps(j['error'])[:2500]); sys.exit(1)
PY
