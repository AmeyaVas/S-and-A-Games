---
name: finished
description: Ship the current work to GitHub end to end - create a branch, stage and commit, push, open a pull request, merge it into the default branch, and clean up afterwards. Use this whenever the user signals they are done with a piece of work and want it on GitHub, including phrasings like "send to github", "send this up", "finished", "ship it", "push this up", "make a PR and merge it", "wrap this up", or "get this on main". Trigger on the intent even when the user does not spell out every step - "send it to github" means the whole branch to commit to PR to merge chain, not just a push. Do not use this for reviewing code, for pushing to an existing PR the user is still iterating on, or when the user explicitly asks only to commit or only to open a PR without merging.
---

# Finished

The user is done with a chunk of work and wants it on the default branch. Run the
whole chain without pausing for approval between steps - that is the point of the
skill. Handing back a PR link plus "shall I merge?" is a failure to do the job.

## Merge authorization

CLAUDE.md says merging is a separate request: open the PR, hand over the link, merge
only when asked. **Invoking this skill is that ask.** "finished" / "ship it" / "get
this on main" authorizes the merge in advance, for this run only.

That standing default still governs everywhere else. If the user asked for a commit,
a push, or a PR without invoking this skill, stop at the PR.

The one thing that halts a run mid-flight is a secret-scan hit. Everything else you
handle, work around, or report honestly at the end.

## Reaching GitHub: `gh` or the MCP tools

Every GitHub step below is written as a `gh` command, which is what a developer has
on their own machine. **Claude Code on the web has no `gh`**, and installing it does
not rescue the run: GitHub's GraphQL API is blocked in those sessions, most REST
paths are filtered at the proxy, and `gh pr create`, `gh pr merge`, `gh pr list`,
`gh pr view`, `gh repo view` and `gh auth status` all go through one or the other.
They fail with `HTTP 403: GitHub GraphQL is not available from Claude Code sessions`
or `Access to this GitHub API path is not permitted through this proxy`.

Use the `mcp__github__*` tools there instead. They are built for that environment,
need no install, and reach paths the proxy refuses to `gh`.

Settle which route you are on once, in preflight, and use it for the whole run:

```bash
command -v gh >/dev/null && gh repo view --json nameWithOwner -q .nameWithOwner 2>&1 | tail -1
```

Probe with a GraphQL-backed command like this one, not with `gh api`. Plain REST
calls such as `gh api repos/{owner}/{repo}` succeed in web sessions even though
`gh pr create` does not, so probing with one reports a working `gh` that then fails
at the step that matters.

Printing the repo name means `gh` works — follow the commands as written. Anything
else (no output, a 403, GraphQL in the message) means take the MCP column:

| Step | `gh` | MCP tool |
|---|---|---|
| Repo and default branch | `gh repo view --json defaultBranchRef,nameWithOwner` | `mcp__github__search_repositories`, or read `git remote -v` for the name |
| Auth check | `gh auth status` | skip — the tools carry their own credentials |
| Collaborators | `gh api repos/{owner}/{repo}/collaborators` | `mcp__github__list_repository_collaborators` |
| Find an existing PR | `gh pr list --head <branch>` | `mcp__github__list_pull_requests` with `head: "<owner>:<branch>"` |
| Open the PR | `gh pr create` | `mcp__github__create_pull_request` |
| Merge | `gh pr merge --squash\|--merge` | `mcp__github__merge_pull_request` with `merge_method` |
| Verify the merge | `gh pr view <n> --json state,mergeCommit` | `mcp__github__pull_request_read` with `method: "get"` |

Two differences that bite on the MCP route:

- `expectedHeadSha` wants the **full 40-character** SHA, not the short one. `git rev-parse HEAD`.
- There is no `--delete-branch`. Merge first, then delete the branch separately;
  if that returns 403, say so in the report rather than claiming it was cleaned up.
  Repos with "automatically delete head branches" enabled handle it for you.

Everything outside this section — the git commands, the secret scan, the strategy
call, the reporting — is identical on both routes.

## Preflight

Gather state in one batch before touching anything:

```bash
git rev-parse --show-toplevel && git branch --show-current && git status --porcelain=v1 --untracked-files=all && git log --oneline -5
```

`--untracked-files=all` matters: plain `git status` collapses an untracked directory
into one line, so a `.env` nested inside a stray `node_modules/` would slip past the
scan below looking innocuous.

```bash
git remote -v && gh auth status && gh repo view --json defaultBranchRef,nameWithOwner -q '.nameWithOwner + " base=" + .defaultBranchRef.name' && git config user.email && git config user.name
```

On the MCP route the middle two fail. Take the repo name from `git remote -v` and
the base branch from `git symbolic-ref refs/remotes/origin/HEAD`, and run the rest:

```bash
git remote -v && git symbolic-ref --short refs/remotes/origin/HEAD && git config user.email && git config user.name
```

Check `user.name` as well as `user.email` - either one missing stops `git commit`
dead, and it fails *after* you have branched and staged. And read the
`git branch --show-current` line deliberately: on a detached HEAD it prints nothing,
which mid-batch looks much like a line that had no output to give.

Stop and tell the user if any of these hold - none are yours to fix:

- **Not a git repo.** Offer `git init` plus `gh repo create`, but run neither
  uninvited; creating a public repo is not undone by deleting it.
- **No `origin`, or the remote is not GitHub.** Nothing to open a PR against.
- **`gh` not authenticated.** Point at `gh auth login`. This one does not apply on
  the MCP route: no `gh`, nothing to authenticate, carry on.
- **Detached HEAD.** Committing here strands the work. Ask which branch they meant.
- **No `user.email` / `user.name`.** Ask before setting it, and ask whether it goes
  in this repo or `--global` - that identity is stamped on every commit they make.

### Who else is in this repo

This picks the merge strategy in step 5, and it changes what the PR title in step 4
has to carry, so settle it here rather than at the merge.

```bash
gh api "repos/{owner}/{repo}/collaborators" --jq '[.[].login] | "collaborators \(length): \(join(", "))"'
```

MCP route: `mcp__github__list_repository_collaborators` with `affiliation: "all"`.
The proxy refuses this path to `gh api` even where other REST calls succeed.

```bash
git log --format='%ae' | grep -viE '@anthropic\.com|\[bot\]' | sort -u
```

The filter is the point: this skill only ever runs as Claude, so Claude is an author
in every repo it has touched. Counting itself, it would read its own presence as a
second person and force `merge` on a repo the user works alone in - a signal that is
always true tells you nothing. The same goes for other bots. Count humans.

The collaborator API needs no equivalent filter: commits are attributed to the
account whose credentials pushed them, so Claude does not appear in that list.

**Solo - the user is the only collaborator and the only *human* author in the log:
squash.** They wrote every commit on the branch and already know how the work went;
preserving six WIP commits and a merge bubble on main tells them nothing they do not
remember, and costs them a `git log` they can skim.

**Another human has push access, or another human appears in the log: merge.**
Individual commits are how a collaborator reconstructs a change they were not present
for. Squashing throws that away on someone else's behalf, which is not the user's
call to make by default. This holds for a collaborator who is not around right now -
an inactive contributor is still someone who will read this history later.

If the filter leaves no authors at all - a repo where every commit so far is Claude's
- treat the log as saying solo and let the collaborator API decide.

Both signals have to say solo. They answer different questions - the API says who
*can* push, the log says who actually has - and a public repo takes PRs from people
on neither list. When they disagree, or when the API call fails (it needs push access
and 403s without it), take the merge. Squash is the lossy option, so ambiguity
resolves toward the strategy that keeps history.

A user instruction outranks both signals. "Squash it", "keep the commits", "no merge
commit" - do what they said, and do not re-derive it here.

### Secret scan - the one hard stop

Everything else in this workflow can be reverted; a secret is published the moment it
is pushed, and merging bakes it into permanent history.

Filenames first. Stop and ask on `.env`, `.env.*`, `*.pem`, `*.key`, `id_rsa*`,
`*.pfx`, `*.p12`, `.npmrc`, `credentials.json`, `service-account*.json`, anything
named `secret*`, or vendored trees (`node_modules/`, `.venv/`, `dist/`, `build/`,
`target/`).

Then oversized files, usually a forgotten build artifact:

```bash
git ls-files -cmo --exclude-standard | while read -r f; do [ -f "$f" ] && find "$f" -size +5M; done; echo "scanned $(git ls-files -cmo --exclude-standard | wc -l) files"
```

Any path above the `scanned` line is a hit. The count distinguishes a real pass
("scanned 8 files", nothing listed) from a scan that inspected nothing and only
looked like one. If the command errors, say so and eyeball `git status` instead.

Filenames only catch the obvious cases; the likelier leak is pasted into a source
file. Skim the content:

```bash
git diff -U0 && git diff --cached -U0
```

```bash
git ls-files -o --exclude-standard
```

Run the untracked listing as its own command - chained onto the diffs its filenames
vanish into the same undifferentiated stream as the diff text.

**Read the contents of every file that second command lists.** `git diff` only
reports files git already tracks, so a brand-new file - what a just-finished feature
usually looks like - produces an empty diff and sails through a scan that appears to
have passed.

Watch for long random-looking literals, the usual prefixes (`sk-`, `sk_live`, `ghp_`,
`gho_`, `AKIA`, `-----BEGIN`, `xoxb-`), and assignments to `token`, `secret`,
`password`, or `api_key` holding a real value rather than a placeholder.

Do not talk yourself past a hit because the value looks fake - you cannot tell a dead
key from a live one by reading it, and the cost is asymmetric. Bring it to the user.

Show the suspect paths and offer a way forward matched to the hit:

- **A credential file incidental to the change** - offer to `.gitignore` it and carry
  on shipping the rest.
- **A secret inside a file that is part of the change** - gitignoring would ship an
  empty PR of the very feature they asked for. Offer to swap the literal for an
  environment lookup and continue, or to abort. Make the absence fail loudly rather
  than resolving to `undefined`, and say in the PR body that the feature now needs
  that variable set.

Quote enough to identify each hit - file, line, variable name, prefix - without
echoing the secret back. If it may have been real, say plainly that it should be
rotated.

With no user available to answer (scheduled run, background job, subagent), stop and
push nothing. Guessing on a credential's behalf is the one call this skill never
makes for itself. Noticing only *after* branching or staging changes nothing: do not
commit, leave the branch sitting, report. A local branch costs nothing to clean up; a
pushed one has already published.

## 1. Understand what is shipping

Read the diff - `git diff`, `git diff --cached`, `git log <base>..HEAD` if already on
a feature branch, plus the contents of anything `git ls-files -o --exclude-standard`
lists. You need this to name the branch, write an honest commit message, and write a
PR body that says what changed rather than restating the file list.

If there is genuinely nothing to ship, say so and stop. Do not manufacture an empty
commit to have something to merge.

## 2. Branch

If the current branch is **not** the default, stay on it - relocating the user's work
mid-flight would be surprising. An already-pushed branch with an open PR is fine:
add commits to it and merge the PR that exists rather than opening a second.

If it **is** the default branch:

```bash
git checkout -b <type>/<short-kebab-summary>
```

`<type>` is `feat`, `fix`, `chore`, `docs`, `refactor`, or `test`, from what the diff
actually does. Under ~50 characters, describing the change rather than the files -
`fix/login-redirect-loop` beats `fix/authjs-and-middleware`.

## 3. Commit

Stage what belongs to the change - normally `git add -A`, minus anything the scan
flagged and the user chose to leave out. When adding to a branch that already has
commits, check the dirty files belong to that branch's story; if the tree also holds
plainly unrelated edits, mention them rather than quietly bundling them into a PR
titled for something else.

Conventional-commit subject. Add a body explaining *why* when the change spans more
than one concern; the diff already covers what. The `Co-Authored-By` trailer goes on
every commit, which is why the heredoc form is worth using even for one-liners.

```
git commit -m "$(cat <<'MSG'
feat(auth): add refresh-token rotation

Sessions were expiring silently at 24h because the refresh token was
never reissued. Rotate on each use and extend the sliding window.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
MSG
)"
```

If a pre-commit hook fails, fix the problem and commit again. Never `--no-verify` -
that hook is the user's own gate, and bypassing it ships what they set it up to catch.

## 4. Push and open the PR

```bash
git push -u origin HEAD
```

```
gh pr create --base <base> --title "<see below>" --body "$(cat <<'BODY'
## Summary
- what changed and why, in a bullet or two

## Test plan
- how this was verified, or "not verified - <reason>" when it was not

🤖 Generated with [Claude Code](https://claude.com/claude-code)
BODY
)"
```

Single-commit branch: the PR title is the commit subject. Several commits: write a
title covering what the branch as a whole accomplishes.

Where that title lands depends on the strategy settled in preflight. Squashing, it
becomes the commit subject on the default branch (`<title> (#12)`) - the only line
anyone skimming `git log` will ever see, so it has to stand on its own. Merging,
GitHub's default subject is `Merge pull request #12 from <owner>/<branch>` and the
title goes in the body, so the individual commit subjects are what carry the log.
Repos can reconfigure both defaults.

Be truthful in the test plan. Look for a test runner first (a `test` script, a
`tests/` directory, a `Makefile` target) so the reason you give is the real one. Name
which tests passed, or write that you ran nothing. This PR is about to merge itself
into the default branch, and the test plan is the only signal the user gets first.

MCP route: `mcp__github__create_pull_request` with `owner`, `repo`, `base`, `head`
(the bare branch name), `title` and `body`. It returns the new PR's url, which
carries its number.

If a PR already exists, `gh pr create` says so - reuse it. Either way, capture the PR
number before merging rather than parsing it out of the URL by eye:

```bash
gh pr list --head <branch> --state open --json number,url -q '.[0] | "#\(.number) \(.url)"'
```

MCP route: `mcp__github__list_pull_requests` with `state: "open"` and
`head: "<owner>:<branch>"` - the owner prefix is required, and an empty array is the
answer that no PR exists yet.

Once the merge deletes the branch, `gh` can no longer infer it.

## 5. Merge

Use the strategy settled in preflight - squash on a solo repo, merge when anyone else
is in it, and whatever the user said if they said anything.

```bash
gh pr merge --squash --delete-branch
```

```bash
gh pr merge --merge --delete-branch
```

`--merge` creates a real merge commit, so the branch's individual commits survive on
the default branch. `--squash` collapses them into one new commit, and the originals
become unreachable once the branch is deleted. Either way the new commit is made on
GitHub's side, so your local `main` then fast-forwards onto it - "fast forward" in the
output does not mean a `--merge` degraded into one.

```bash
gh pr view <number> --json number,state,url,mergeCommit -q '"#\(.number) \(.state) \(.url) \(.mergeCommit.oid[0:7])"'
```

MCP route: merge with `mcp__github__merge_pull_request` (`merge_method: "merge"` or
`"squash"`, and `expectedHeadSha` as the full 40-character `git rev-parse HEAD` - a
short SHA is rejected outright). It has no `--delete-branch`, so the branch is a
separate step afterwards. Then verify with `mcp__github__pull_request_read`,
`method: "get"`: `merged` must read `true` and `state` must read `closed` before you
say it merged. The merge response's own `sha` is the resulting commit.

The number is not optional: `--delete-branch` has already moved you to the base
branch, so a bare `gh pr view` fails on `main` - or silently resolves some unrelated
PR and reports *that* one as merged. Do not skip this check. `gh pr merge` succeeds
quietly, handing you neither SHA nor URL, and a merge merely *queued* behind checks
looks much the same as one that landed. `state` must read `MERGED` before you say it
merged.

Four failure modes to handle rather than just report:

- **Not mergeable yet.** On a branch pushed seconds ago the check is often still
  computing. Wait a moment, retry once.
- **Required checks still running.** Re-run with `--auto` to queue the merge, then
  tell the user it is *queued*, not merged.
- **Behind the base and conflicting.** `git fetch origin && git merge origin/<base>`,
  resolve, push, retry. If resolving needs real judgment about intent, stop and show
  them the conflict.
- **The strategy is disabled in repo settings.** Squash and merge-commit can each be
  turned off per repo, and `gh` refuses rather than falling back. Use whichever the
  repo allows and say in the report that the repo overrode the choice.

If branch protection requires a human review, leave the PR open, hand over the link,
and say plainly that the repo wants a review first.

## 6. Clean up

```bash
git checkout <base> && git pull --ff-only && git remote prune origin
```

Expect no-ops. `--delete-branch` usually already switched you to the base,
fast-forwarded it, and deleted both copies of the feature branch - "Already on
'main'" is the success case. Run it anyway: idempotent, covers the cases where `gh`
leaves you behind, and the prune clears stale refs.

On the MCP route nothing has deleted the branch yet, so these are real work rather
than no-ops. Try `git push origin --delete <branch>` after the merge. It can come
back `HTTP 403` where the session's credentials do not carry ref-deletion rights;
that is not something to route around. Say in the report that the branch is still
there and how to remove it, or note that the repo's "automatically delete head
branches" setting already did. Either way the merge itself is unaffected.

```bash
git branch --show-current && git rev-parse --short HEAD && git status --porcelain=v1 && git ls-remote --heads origin <branch>
```

You want the base branch, a clean tree, and empty `ls-remote` output - which asks
GitHub directly rather than inferring from your own pruned refs. If the tree is
*not* clean, something was left unstaged in step 3; say so rather than letting the
user believe everything shipped.

## 7. Report

```
Merged: <PR title> (<squash|merge>)
PR:     https://github.com/<owner>/<repo>/pull/<n>
Commit: <resulting commit, short sha>
Branch: <name> deleted, now on <base> at <short sha>
```

Name the strategy on the first line. It is one word, it is not recoverable from the
summary otherwise, and on a repo that just gained its second collaborator the user
will want to notice the switch.

Short SHAs in both places - they come straight out of the verification commands in
steps 5 and 6.

If any part did not complete - queued behind checks, blocked on review, conflicts
unresolved - say so in the same breath, not buried under the parts that worked.
After invoking this skill the user's mental model is "it is on main"; when that is
not true, correcting it immediately is the whole job.

## Windows note

PowerShell 5.1 here has no `&&` and mangles multi-line strings. Run git and gh
through the Bash tool, and use the `"$(cat <<'MSG' ... MSG)"` form for any message
spanning more than one line.

Git will also print `warning: LF will be replaced by CRLF` on nearly every command.
That is normalisation working as configured - ignore it, do not mention it in the
report, do not go looking for a fix.
