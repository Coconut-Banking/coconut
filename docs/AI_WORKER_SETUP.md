# AI Worker Setup — Run Like a Senior Engineer

What's needed for [coconut-ai-worker](https://github.com/Coconut-Banking/coconut-ai-worker) to work effectively and simulate Cursor-quality output.

## Coconut repo (done)

- `AGENTS.md` — guardrails, UI rules, validation
- `PROJECT_SPEC.md` — stack, paths, design system
- `docs/IMPLEMENTATION_GUIDE.md` — patterns, mindset
- `typecheck` script in package.json
- `.github/ISSUE_TEMPLATE/auto-build.md` — issue format for worker

## Worker config (coconut-ai-worker)

### Required env

```bash
GITHUB_TOKEN=          # repo scope
OPENAI_API_KEY=
GITHUB_OWNER=Coconut-Banking
GITHUB_REPO=coconut
```

### Tuning for quality

| Flag | Default | Recommendation |
|------|---------|----------------|
| `OPENAI_MODEL_PLANNER` | gpt-4o | Keep. Use o1 for complex planning if needed. |
| `OPENAI_MODEL_CODER` | gpt-4o | Keep. Fast and good. |
| `MAX_FILES_CHANGED` | 5 | Increase to 8–10 for features that span API + UI + hook |
| `DRY_RUN` | true | Start true; set false when ready for real edits |
| `TEST_MODE` | true | Keep true until you trust output; then false + OPEN_PR |

### Production mode

When ready to open PRs:

```bash
DRY_RUN=false
TEST_MODE=false
OPEN_PR=true
```

## Issue quality = output quality

**Good issue** (worker can implement cleanly):

```
Goal: Add a "Last synced" timestamp to the transactions page header when Plaid is linked.

Requirements:
- Show "Synced 2 min ago" (relative) next to "Live from linked account" badge
- Use existing useTransactions or add lastSyncedAt from /api/plaid/transactions
- Match current badge styling (text-xs, green)
- No API changes if data already available
```

**Bad issue** (vague, too big):

```
Goal: Improve transactions.

Requirements:
- Make it better
```

## Running the worker

```bash
cd coconut-ai-worker
npm run run-once    # Process one issue
npm run dev        # Watch mode for development
```

## Suggested worker enhancements (in coconut-ai-worker repo)

1. **Retry on validation failure** — If lint/typecheck/test fails, feed the error back to the coder and retry once (max 1 retry).
2. **Richer planner prompt** — Include AGENTS.md + IMPLEMENTATION_GUIDE content in the planner system prompt so it plans with guardrails in mind.
3. **File tree in context** — Give the coder a compact file tree (or key files) so it knows structure without blind edits.
4. **PR body** — When opening PR, include: Goal, what changed (file list), how to test.
