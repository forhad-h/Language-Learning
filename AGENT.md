# AGENT.md

Instructions for AI coding assistants and automated agents working in this repository.

## GitHub operations — use the `gh` CLI

**All GitHub operations must be performed through the [`gh`](https://cli.github.com/) CLI.** Do not call the GitHub REST or GraphQL APIs directly, and do not shell out to `git push` / `curl` against `github.com` when a `gh` command exists.

This applies to anything that talks to GitHub on behalf of this repo:

- Authentication / who-am-I checks → `gh auth status`
- Viewing the repo, its settings, collaborators, teams, or visibility → `gh repo view`, `gh api`
- Issues and pull requests → `gh issue`, `gh pr`
- Releases and tags → `gh release`
- Workflows and Actions runs → `gh workflow`, `gh run`
- Creating or forking repos → `gh repo create`, `gh repo fork`
- Pushing code → commit locally, then `git push` (this is the one exception — `gh` doesn't push for you), or `gh repo sync` when mirroring
- API calls that don't have a dedicated `gh` subcommand → `gh api` (with the `graphql` variant for GraphQL)

### Why `gh` and not raw `git`/`curl`

- `gh` is already authenticated in this environment via the GitHub CLI keyring.
- It enforces the right authentication, scopes, and host for every command, so we don't leak credentials or hit the wrong account.
- Output is consistent and easy for other agents to parse.
- It keeps the project's interaction with GitHub auditable in one tool.

### Quick reference

```bash
gh auth status                          # confirm which account is active
gh repo view                            # repo metadata
gh issue list --limit 20                # open issues
gh pr list --state all                  # all PRs
gh pr create --base main --title "..." --body "..."
gh pr merge 123 --squash                # merge a PR by number
gh workflow run ci.yml                  # trigger a workflow
gh run watch 1234567890                 # watch a run to completion
gh release create v1.2.3 --notes "..."   # cut a release
gh api repos/:owner/:repo/issues        # anything not covered above
```

### Auth reminder

If `gh auth status` reports no active account, **stop and ask the user** before doing anything that would require credentials. Don't fall back to raw `curl` with embedded tokens.

## Other conventions for agents

- **Never commit secrets.** `.env` is git-ignored; keep it that way.
- **Never force-push to `main`.** Branch, PR, and let it merge through the normal flow.
- **Run the test suite** (`node test-e2e.js` — requires `devDependencies` from `npm install`) before opening a PR that touches `app.js`, `server.js`, or `styles.css`.
- **Match the existing commit-message style** in `git log` (short imperative subject, no scope prefix).
