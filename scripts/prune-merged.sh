#!/usr/bin/env bash
# Removes the local branch and worktree of every PR merged on GitHub.
#
# Run by the Claude Code SessionStart hook (.claude/settings.json), safe to run
# by hand. A branch is only touched when all of these hold:
#   - its upstream is gone (GitHub deletes the head branch on merge),
#   - GitHub has a *merged* PR for it (a closed-unmerged one is kept),
#   - it is not main and not the branch of the worktree running this script,
#   - its worktree, if any, has no uncommitted or untracked changes.
set -u

git fetch --prune --quiet origin || exit 0

current=$(git branch --show-current)
main_wt=$(git worktree list --porcelain | awk 'NR == 1 { print $2 }')

worktree_of() {
  git worktree list --porcelain |
    awk -v ref="refs/heads/$1" '/^worktree / { wt = $2 } $0 == "branch " ref { print wt }'
}

git for-each-ref --format='%(refname:short) %(upstream:track)' refs/heads |
  while read -r branch track; do
    [ "$track" = "[gone]" ] || continue
    [ "$branch" = main ] || [ "$branch" = "$current" ] && continue
    merged=$(gh pr list --state merged --head "$branch" --json number --jq '.[0].number' 2>/dev/null)
    [ -n "$merged" ] || continue

    wt=$(worktree_of "$branch")
    if [ -n "$wt" ]; then
      [ "$wt" = "$main_wt" ] && continue
      if [ -n "$(git -C "$wt" status --porcelain)" ]; then
        echo "kept $branch (PR #$merged merged): uncommitted changes in $wt"
        continue
      fi
      git worktree remove "$wt" || continue
    fi
    git branch -D --quiet "$branch" && echo "deleted $branch and its worktree (PR #$merged merged)"
  done
