# Bug Council v3

Automated evidence-based audits for **coconut** (web) and **coconut-app** (mobile), run from the coconut repo.

## What changed in v3

- **Prunes stale PRs** before each run (empty, lockfile-only, doc-only, old conflicts).
- **At most one open** `fix/bug-council-*` PR per repo.
- **Gates new PRs** — auto-closes if the diff is empty, lockfile churn, or rules-only.
- **Checks `origin/main` first** — fixers must SKIP bugs already fixed on main.
- **Known false positives** — see [BUG_COUNCIL_FALSE_POSITIVES.md](./BUG_COUNCIL_FALSE_POSITIVES.md) (e.g. mobile Stripe amounts are dollars; backend converts to cents).

## Commands

```bash
./scripts/setup-bug-council.sh run              # Full audit (both repos)
./scripts/setup-bug-council.sh reactive "…"     # Quick web fix
./scripts/setup-bug-council.sh reactive-mobile "…"
./scripts/setup-bug-council.sh logs
./scripts/setup-bug-council.sh status
```

## Layout

| Path | Role |
|------|------|
| `scripts/.bug-council-runner.sh` | Orchestrator (Claude + CI poll + Telegram) |
| `scripts/bug-council-lib.sh` | PR hygiene + state + prompt extras |
| `.claude/commands/bug-council.md` | Web audit playbook |
| `.claude/commands/bug-council-mobile.md` | Mobile audit playbook |
| `.bug-council-logs/.last-successful-run-{repo}` | Last audited `main` SHA (gitignored) |

## Operator tips

- Review open PRs on GitHub before merging; v3 reduces noise but does not replace human review.
- If the council keeps reporting the same bug, add it to `BUG_COUNCIL_FALSE_POSITIVES.md`.
- Do not commit `package-lock.json` from automated runs unless a real dependency fix was made.
