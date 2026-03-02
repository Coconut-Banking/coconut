# Coconut

Personal finance with **semantic search** and **AI** — like Rocket Money, but you can search transactions by meaning and ask questions about your data in plain language.

## Features (MVP)

- **Subscriptions** — View recurring subscriptions and monthly total
- **Transactions** — List recent transactions with merchant, category, amount, date
- **Semantic search** — Search transactions by intent (e.g. "coffee", "subscriptions", "dining")
- **AI chat** — Ask questions about your spending and subscriptions; answers use your data (requires `OPENAI_API_KEY`)

## Tech

- **Next.js 14** (App Router), TypeScript, Tailwind CSS
- Mock transaction and subscription data (no bank linking in MVP)
- Search: keyword + category matching (no API key); optional embeddings with OpenAI for richer semantic search
- Chat: OpenAI GPT-4o-mini with context from search + subscriptions (set `OPENAI_API_KEY` to enable)

## Run locally

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

### Optional: AI chat

Create `.env.local` and add:

```
OPENAI_API_KEY=sk-...
```

Then the "Ask about your data" chat will use your transactions and subscriptions to answer questions.

## Scripts

- `npm run dev` — development server
- `npm run build` — production build
- `npm run start` — run production build

