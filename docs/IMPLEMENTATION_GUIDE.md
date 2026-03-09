# Implementation guide (for agents & humans)

How to implement features like a senior engineer: efficient, minimal, correct.

## Before you code

1. **Read the codebase** — Find similar features. Copy patterns. Don’t reinvent.
2. **Scope small** — Prefer 1–3 files, one clear behavior change. Split big tasks into multiple issues.
3. **Plan then code** — List files to touch, data flow, edge cases. Then implement.

## Patterns to follow

### New API route
- `app/api/[resource]/route.ts` → GET/POST
- `app/api/[resource]/[id]/route.ts` → GET/PATCH/DELETE
- Use `auth()` from `@clerk/nextjs/server` for auth
- Use `getSupabase()` from `@/lib/supabase` for DB
- Return `NextResponse.json()` with proper status codes

### New page
- `app/app/[name]/page.tsx` — "use client" if interactive
- Add nav link in `components/AppLayout.tsx`
- Use existing layout: `max-w-3xl mx-auto px-8 py-8`

### New hook
- `hooks/use[Thing].ts` — fetch, loading, error state, refetch
- Use `useState`, `useEffect`, `useCallback` appropriately

### New lib module
- `lib/[name].ts` — pure logic or server helpers
- Keep API routes thin; put logic in lib

## Efficiency rules

- **Reuse** — Same component? Extract. Same API shape? Share types.
- **Minimal diff** — Only change what’s needed. No unrelated refactors.
- **Tests for logic** — `lib/*.test.ts` for pure functions. Mock external deps.
- **Types** — Prefer inference. Add explicit types at boundaries (API, props).

## Common mistakes to avoid

- Adding new dependencies without checking if existing ones suffice
- Modifying `middleware.ts` or auth flow without careful review
- Changing env var names or adding new required env without `.env.example`
- Large, unrelated formatting changes (stick to the task)
