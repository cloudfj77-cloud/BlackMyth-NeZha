#!/usr/bin/env bash
# 发版（v1.4.0 scripts/release.sh 移植）：质量门禁 → 升版本号 → 写更新日志 → 提交 → 打标签。
# 用法：
#   scripts/release.sh patch "修复锁定镜头抖动"
#   scripts/release.sh minor "移植敖丙；新标题界面"      （多条用；分隔）
# 门禁不通过就中止，不改版本、不提交、不打标签。SKIP_GATE=1 仅限紧急修复，且须在说明中注明。
set -euo pipefail
cd "$(dirname "$0")/.."

TYPE="${1:-}"; shift || true
NOTES="${*:-}"
if [[ ! "$TYPE" =~ ^(patch|minor|major)$ ]] || [[ -z "${NOTES}" ]]; then
  echo "用法: scripts/release.sh <patch|minor|major> \"更新说明（多条用；分隔）\""; exit 1
fi
[[ -f VERSION ]] || echo "2.0.0" > VERSION
CUR="$(tr -d '[:space:]' < VERSION)"
IFS=. read -r MA MI PA <<< "$CUR"
case "$TYPE" in
  major) MA=$((MA + 1)); MI=0; PA=0 ;;
  minor) MI=$((MI + 1)); PA=0 ;;
  patch) PA=$((PA + 1)) ;;
esac
NEW="$MA.$MI.$PA"
if git rev-parse "v${NEW}" >/dev/null 2>&1; then echo "标签 v${NEW} 已存在"; exit 1; fi

if [[ "${SKIP_GATE:-0}" != "1" ]]; then
  echo "▶ 发版门禁（qa/gate.cjs：构建 + 单元测试 + 真实键鼠实机）……"
  if ! node qa/gate.cjs; then
    echo "❌ 门禁未通过，已中止发版。看 artifacts/gate/report.md，修好后重来。"; exit 1
  fi
  echo "✅ 门禁通过。请按 design/release-review.md 看截图打分，任一项 < 3 分请 Ctrl-C 中止。"
fi

echo "${NEW}" > VERSION
echo "▶ 构建 GitHub Pages 站点（scripts/build-pages.sh）……"
bash scripts/build-pages.sh
NEW="${NEW}" DATE="$(date +%Y-%m-%d)" NOTES="${NOTES}" python3 - <<'PY'
import os, re
ver, date, notes = os.environ['NEW'], os.environ['DATE'], os.environ['NOTES']
items = [n.strip() for n in re.split(r'[;；]', notes) if n.strip()]
entry = f"## [{ver}] - {date}\n" + "".join(f"- {i}\n" for i in items) + "\n"
p = 'CHANGELOG.md'
s = open(p, encoding='utf-8').read() if os.path.exists(p) else "# 更新日志\n\n"
idx = s.find('\n## [')
s = s + "\n" + entry if idx < 0 else s[:idx + 1] + entry + s[idx + 1:]
open(p, 'w', encoding='utf-8').write(s)
PY
git add -A
git commit -m "release: v${NEW} - ${NOTES}"
git tag -a "v${NEW}" -m "v${NEW}: ${NOTES}"
git push origin HEAD          # 先推代码（触发 Pages 部署）
git push origin "v${NEW}"     # 再推标签（触发 Release）
echo "✅ 已发版 v${NEW}：https://cloudfj77-cloud.github.io/WhiteMyth-NeZha/"
