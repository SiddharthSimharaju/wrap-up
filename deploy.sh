#!/usr/bin/env bash
# One-shot: create the GitHub repo, push, and turn on GitHub Pages (Actions build).
# Needs the GitHub CLI, signed in:  brew install gh && gh auth login
set -euo pipefail
OWNER="SiddharthSimharaju"; REPO="${1:-wrap-up}"
command -v gh >/dev/null || { echo "Install the GitHub CLI first: https://cli.github.com"; exit 1; }
gh auth status >/dev/null 2>&1 || { echo "Run: gh auth login"; exit 1; }
npm test && npm run check
git add -A && (git diff --cached --quiet || git commit -m "Update")
git branch -M main
if gh repo view "$OWNER/$REPO" >/dev/null 2>&1; then
  git remote get-url origin >/dev/null 2>&1 || git remote add origin "https://github.com/$OWNER/$REPO.git"
  git push -u origin main
else
  gh repo create "$OWNER/$REPO" --public --source=. --remote=origin --push \
    --description "Your YouTube year from your own Google Takeout. No sign-in, nothing uploaded."
fi
gh api -X POST "repos/$OWNER/$REPO/pages" -f build_type=workflow >/dev/null 2>&1 \
  || gh api -X PUT "repos/$OWNER/$REPO/pages" -f build_type=workflow >/dev/null 2>&1 || true
echo; echo "Pushed. The Pages workflow is running (about a minute):"
echo "  https://github.com/$OWNER/$REPO/actions"
echo "Your site: https://${OWNER,,}.github.io/$REPO/"
