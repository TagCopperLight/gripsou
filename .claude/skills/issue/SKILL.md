---
name: issue
description: Use when the user wants to create a GitHub issue on gripsou — writing down a quick idea so it isn't forgotten, or working out the details now and filing a detailed issue. Triggers on "create an issue", "open an issue for", "note this idea", "write up an issue", "remind me to".
---

# Creating gripsou issues

Issues live on `TagCopperLight/gripsou`, a **public** repo: everything written there is published.

There are two workflows. Pick one from how the user phrases the request:

- **Quick** — "quick idea", "so I don't forget", "think about it later", "not thought through". The details get worked out when the issue is tackled.
- **Detailed** — "let's detail it", "write a full issue", "work it out now".

If the wording doesn't say, ask once which one they want. Ask nothing else before deciding.

This skill only files issues. Never create a branch, a worktree or touch code here.

## Both workflows

1. **Look for duplicates:** `gh issue list --state all --search "<keywords>"`. If one already covers it, show it and ask whether to comment on it rather than open a new one.
2. **Labels:** run `gh label list` and use only labels that exist.
   - Type: `enhancement` or `bug`.
   - Area, as many as fit: `budget`, `sync`, `ui`, `admin`.
   - `idea` only for the quick workflow. A detailed issue has no `idea` label; no label means ready to build.
3. **Writing:**
   - Plain language: describe what the user sees and does, not SQL or internals. File paths go only in a *Where* section.
   - Short, plain title that names the thing, not the solution.
   - **No private data:** never put real amounts, balances, categories, merchants, account names or bank details from the user's data in an issue. Use generic wording ("a transfer between two accounts").
   - No Claude attribution, no "Generated with" footer.
4. **Create** with `gh issue create --title ... --label ... --body "$(cat <<'EOF' ... EOF)"`.
5. **Report back:** the link, the labels, and a short plain-words summary of what the issue says.

## Quick workflow

- Ask no questions. Write down the idea as the user gave it, without adding scope they didn't mention.
- If it's cheap, glance at the code to describe today's behaviour in a line or two. Don't investigate deeper.
- Body:

  ```markdown
  Rough idea, not thought through yet. Written down to come back to later.

  <the idea, in the user's words, lightly tidied>

  ## Today            (optional, only if checked)
  <one or two lines on how it works now>

  Open questions for later:
  - <what will need deciding when this is tackled>
  ```

- Labels: type + area + `idea`.

## Detailed workflow

1. **Read the code** that's involved, enough to describe how it works today and where a change would land. Check facts against the code (and live data when it matters) rather than assuming.
2. **Ask questions one at a time**, multiple choice when possible, with a recommended option first. Ask about what changes for the user, not about implementation. Stop when these are settled:
   - what the behaviour should be,
   - the choices that had to be made, and why,
   - what's out of scope,
   - how to tell it's done.
3. **Show the draft** issue (title, labels, body) in the conversation and wait for a yes before creating it.
4. Body for a feature:

   ```markdown
   ## Today
   <how it works now, in user-visible terms>

   ## Wanted
   <the new behaviour>

   ## Decisions
   - <choice> — <why>

   ## Out of scope
   - <what this issue deliberately doesn't do>

   ## Where
   <files / modules involved>

   ## Done when
   - <checkable outcome>
   ```

   Body for a bug:

   ```markdown
   ## What happens
   <steps and what goes wrong>

   ## Expected
   <what should happen>

   ## Where
   <files and the cause, if found>
   ```

5. Labels: type + area, no `idea`.
