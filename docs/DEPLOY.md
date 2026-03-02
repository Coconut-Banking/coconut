# Deploy setup

## Git: one push updates both repos

`origin` is configured to push to **both** repos:

- `Coconut-Banking/coconut` (org/team repo)
- `harshils2340/coconut` (personal fork)

Running `git push` updates both. No need to push twice.

## Vercel

Vercel is currently connected to **harshils2340/coconut**.

To have deploys triggered when **anyone** pushes to the org repo:

1. Vercel → Project Settings → Git
2. Disconnect from harshils2340/coconut
3. Connect to **Coconut-Banking/coconut** instead
4. Grant Vercel access to the Coconut-Banking org if prompted

Then any team member with push access to Coconut-Banking will trigger deploys.
