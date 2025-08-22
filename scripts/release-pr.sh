#!/usr/bin/env bash
set -euo pipefail

# Prepare a release branch and open a PR.
# Usage:
#   BUMP=patch|minor|major scripts/release-pr.sh
# or:
#   scripts/release-pr.sh --bump patch

parse_bump() {
  local val="${BUMP:-}";
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --bump)
        shift; val="$1";;
    esac; shift || true;
  done
  echo "${val:-patch}"
}

require_clean_tree() {
  if [[ -n "$(git status --porcelain)" ]]; then
    echo "Error: working tree is not clean. Commit or stash changes first." >&2
    git status --porcelain
    exit 1
  fi
}

main() {
  command -v jq >/dev/null || { echo "jq is required" >&2; exit 1; }
  command -v gh >/dev/null || { echo "gh CLI is required" >&2; exit 1; }

  local bump; bump=$(parse_bump "$@");
  require_clean_tree

  echo "Bumping version (${bump})…"
  npm version "${bump}" --no-git-tag-version >/dev/null
  local version; version=$(jq -r .version package.json)
  local branch="release/v${version}"

  echo "Creating branch ${branch}…"
  git checkout -b "${branch}"

  # Ensure CHANGELOG has an entry header if missing
  if ! grep -q "^## \[${version}\]" CHANGELOG.md 2>/dev/null; then
    date_str=$(date +%Y-%m-%d)
    printf '\n## [%s] - %s\n\n### Changed\n- Prepare release %s\n' "$version" "$date_str" "$version" >> CHANGELOG.md
  fi

  git add -A
  git commit -m "chore(release): v${version}"
  git push -u origin "${branch}"

  echo "Opening pull request…"
  gh pr create \
    --title "chore(release): v${version}" \
    --body "This PR prepares the v${version} release.\n\n- Bump version in package files\n- Update CHANGELOG\n\nMerging to main will trigger the release workflow to tag, create a GitHub release, and publish to npm." \
    --base main \
    --head "${branch}" || true

  echo "Done. Review and merge the PR to release v${version}."
}

main "$@"

