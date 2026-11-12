---
name: release
description: Use when the user wants to publish a new gripsou release - bumping the version, tagging main and writing the GitHub release page. Triggers on "/release", "release 1.9.0", "make a new release", "publish a release", "cut a version".
---

# Releasing gripsou

A release bumps the package versions on `main`, tags that commit `vX.Y.Z` and publishes a GitHub release page. Pushing the tag starts no workflow and builds no image. The user updates production by hand, from the release page.

The repo is public: the bump commit, the tag and the page are published the moment they are pushed. Nothing is pushed before the user approves the draft. This skill is the one exception to the rule against pushing to `main`, and the exception covers only the bump commit.

The skill never touches production.

## 1. Check main

Stop and tell the user if any check fails. Don't work around a failure.

- The checkout is on `main` with a clean tree.
- After `git fetch --tags origin`, local `main` equals `origin/main`.
- CI is green on that exact commit: `gh run list --branch main --commit <sha> --json status,conclusion`. If CI is still running, wait for it. If it failed, stop.
- There is something to release: `git log <last-tag>..HEAD` is not empty. Find the last tag with `git describe --tags --abbrev=0`.

## 2. Collect what changed since the last tag

- **The PRs:** read the `(#n)` numbers from `git log <last-tag>..HEAD --oneline`. Then read each one with `gh pr view <n> --json title,body,closingIssuesReferences`, and read the issues it closes.
- **Upgrade facts:** run `git diff --name-status <last-tag>..HEAD -- backend/migrations .env.example docker/ scripts/`.
  - For each new migration, read it and note whether it changes or deletes stored data, or only adds things.
  - Note any variable added to or removed from `.env.example`, any change to the compose files, and any script that was removed.
  - Read the last release's Upgrading section (`gh release view <last-tag>`) for steps that still apply, such as a version people must pass through first.

## 3. Pick the version

The user's version wins when they gave one. Otherwise:
- **Minor** (`1.8.0` → `1.9.0`) when there is a new feature or a new migration.
- **Patch** (`1.8.0` → `1.8.1`) when there are only fixes and no migrations.
- **Major** only when the user asks for it.

## 4. Write the draft and wait for a yes

Show the user the following in the conversation:
- the version and the reason for it,
- the title, `vX.Y.Z: <short theme>` (examples: "Consistent figures & speed", "Security & settings"),
- the commit that will be bumped,
- the full notes.

Write the notes in the style of the earlier releases (`gh release view v1.8.0`):

```markdown
- <one bullet per change a user would notice, in plain words, with (#n) when it has an issue or PR>
- Smaller fixes: <short list, on one line>

## Upgrading

<numbered steps, only those that apply>

**Full changelog:** https://github.com/TagCopperLight/gripsou/compare/<last-tag>...vX.Y.Z
```

- Describe what the user sees and does. Leave out internals, file paths and SQL.
- Group the internal work into one closing bullet, such as "Codebase cleanup (#84)".
- **No private data:** don't use real amounts, balances, accounts, merchants, categories or bank names from the user's instance.
- **Upgrading appears only when a step is needed:** a database backup because a migration changes or deletes data (and then say whether going back to the previous version means restoring that backup), an `.env` change, a manual step, or a version to upgrade through first. If none of these apply, leave the whole section out. The usual build-and-start does not count as a step.

Wait for the user's yes. If they ask for changes, apply them and show the draft again.

## 5. Bump, push and wait for CI

The version lives in three files:
- `backend/Cargo.toml`, in the `[workspace.package]` `version`, which all the crates share,
- `backend/Cargo.lock`: run `cd backend && cargo update --workspace --offline`. It updates the five gripsou crates and no dependency.
- `frontend/package.json`: run `cd frontend && bun pm pkg set version=X.Y.Z`.

Then:
1. Check that `git diff --stat` lists only those three files. Stop if anything else changed.
2. Commit with the message `Release vX.Y.Z` and push it to `origin main`.
3. Wait for CI on the new commit. If it fails, stop and report the failure. Don't tag.

## 6. Tag and publish

1. Run `git tag -a vX.Y.Z -m "vX.Y.Z" <bump-sha>`, then `git push origin vX.Y.Z`. Push only that tag, never `--tags`.
2. Publish with `gh release create vX.Y.Z --verify-tag --latest --title "<title>" --notes "$(cat <<'EOF' ... EOF)"`.
3. Open the page with `gh release view vX.Y.Z` to check that it exists and is marked Latest.

## 7. Report

Give the user the link to the release and, when the release has an Upgrading section, the production steps in order. Say plainly that production has not been updated.
