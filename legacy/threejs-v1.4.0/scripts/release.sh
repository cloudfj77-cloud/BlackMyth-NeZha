#!/usr/bin/env bash
# 发布新版本：自动升版本号 → 写更新日志 → 提交 → 打 tag → 推送
# 用法：
#   scripts/release.sh patch "修复锁定镜头抖动"            # 1.1.0 -> 1.1.1  小修复
#   scripts/release.sh minor "新增第二个 Boss；新增棍花"    # 1.1.0 -> 1.2.0  新功能（多条用；分隔）
#   scripts/release.sh major "第二回 黄风岭"                # 1.1.0 -> 2.0.0  大版本
set -euo pipefail
cd "$(dirname "$0")/.."

TYPE="${1:-}"; shift || true
NOTES="${*:-}"
if [[ ! "$TYPE" =~ ^(patch|minor|major)$ ]] || [[ -z "${NOTES}" ]]; then
  echo "用法: scripts/release.sh <patch|minor|major> \"更新说明（多条用；分隔）\""; exit 1
fi

CUR="$(tr -d '[:space:]' < VERSION)"
IFS=. read -r MA MI PA <<< "$CUR"
case "$TYPE" in
  major) MA=$((MA + 1)); MI=0; PA=0 ;;
  minor) MI=$((MI + 1)); PA=0 ;;
  patch) PA=$((PA + 1)) ;;
esac
NEW="$MA.$MI.$PA"
DATE="$(date +%Y-%m-%d)"

if git rev-parse "v${NEW}" >/dev/null 2>&1; then echo "标签 v${NEW} 已存在"; exit 1; fi

# ===== 质量门禁：自循环验收不通过，禁止发版 =====
# 设置 SKIP_QA=1 可跳过（仅限紧急修复，且需在更新说明中注明）
if [[ "${SKIP_QA:-0}" != "1" ]]; then
  echo "▶ 运行自循环验收（qa/run.js）……"
  [[ -d qa/node_modules ]] || (cd qa && npm i --silent)
  if ! node qa/run.js; then
    echo "❌ 验收未通过，已中止发版。查看 qa/report/report.md，修复后重新执行。"
    exit 1
  fi
  echo "✅ 验收通过，继续发版"
fi

echo "${NEW}" > VERSION
perl -pi -e "s/GAME_VERSION = '[^']*'/GAME_VERSION = '${NEW}'/" wukong/js/version.js

# 在更新日志顶部插入本版本条目
NEW="${NEW}" DATE="$DATE" NOTES="${NOTES}" python3 - <<'PY'
import os, re
ver, date, notes = os.environ['NEW'], os.environ['DATE'], os.environ['NOTES']
items = [n.strip() for n in re.split(r'[;；]', notes) if n.strip()]
entry = f"## [{ver}] - {date}\n" + "".join(f"- {i}\n" for i in items) + "\n"
p = 'CHANGELOG.md'
s = open(p, encoding='utf-8').read()
idx = s.find('\n## [')
s = s + "\n" + entry if idx < 0 else s[:idx + 1] + entry + s[idx + 1:]
open(p, 'w', encoding='utf-8').write(s)
PY

git add -A
git commit -m "release: v${NEW} - ${NOTES}"
git tag -a "v${NEW}" -m "v${NEW}: ${NOTES}"
git push origin HEAD          # 先推代码（触发在线版更新）
git push origin "v${NEW}"     # 再单独推标签（确保触发 Release 生成）
echo "✅ 已发布 v${NEW}（GitHub Actions 将自动更新在线版本并创建 Release）"
