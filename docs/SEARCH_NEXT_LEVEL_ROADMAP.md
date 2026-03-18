# Coconut Search: Next-Level Architecture

A research-grounded roadmap to make Coconut's transaction search 10x smarter than current fintech AI.

---

## Current State (2025)

| Component | What Coconut Has | Gap |
|-----------|------------------|-----|
| Intent extraction | LLM → structured JSON (metric, dates, merchant, category) | Good foundation; PR #56 adds data-aware merchant resolution |
| Retrieval | SQL (ILIKE, category filter) + pgvector fallback | No BM25, no hybrid fusion, no reranker |
| Embeddings | text-embedding-3-small on merchant+category+amount+date | Single vector per tx; no token-level (ColBERT) |
| Answer generation | Deterministic `generateAnswer()` from results | No LLM answer synthesis; no verification loop |

---

## Research Breakthroughs → Coconut Action Plan

### 1. Text-to-SQL / Semantic Parsing (already partially there)

**Research:** DIN-SQL, SQL-PaLM — LLM generates executable SQL over structured data.

**Coconut today:** Intent extraction → parameterized Supabase query builder. We're doing *structured intent*, not raw SQL. This is actually safer (no injection) and works well.

**Next step:** Enhance intent schema to support:
- Multi-step queries ("compare spending this month vs last month")
- Subqueries ("transactions over $100 at restaurants")
- Aggregations beyond sum/count (percentile, trend)

**Phase:** 1 (incremental)

---

### 2. Hybrid Retrieval (BM25 + Dense + Fusion)

**Research:** Best systems combine keyword + vector + reranking. Vector alone misses exact merchant names.

**Coconut today:** 
- Keyword: `ILIKE` on merchant_name, raw_name, normalized_merchant
- Dense: pgvector cosine similarity when SQL returns 0 and coverage ≥30%

**Gap:** 
- No BM25 (Postgres has `ts_tsvector`/`ts_rank` — can add full-text search)
- No fusion (e.g. Reciprocal Rank Fusion of ILIKE + vector results)
- No explicit "keyword for merchant, vector for concept" routing

**Implementation:**
```
1. Add tsvector column + GIN index on transactions (merchant_name, raw_name, primary_category)
2. For "Uber" or "Shell" → BM25/ILIKE only (exact match)
3. For "rideshare" or "gas" → vector + BM25, then RRF fusion
4. Return top K fused results
```

**Phase:** 2 (medium effort)

---

### 3. Neural Re-Ranking

**Research:** Retrieve 50–100, rerank with cross-encoder (Cohere Rerank, BGE) → top 10.

**Why it matters for transactions:**
- "UBER TRIP" vs "UBER EATS" vs "UBER CASH" — reranker disambiguates intent
- "coffee" could match "Starbucks", "Dunkin", "PROGENY COFFEE" — reranker picks best

**Implementation:**
- Add Cohere Rerank API or self-host BGE-reranker
- After hybrid retrieval → pass (query, candidate_titles) to reranker → reorder
- Cost: ~$1/million tokens for Cohere; acceptable for 20–50 results per query

**Phase:** 2

---

### 4. Financial Intent Embeddings (moonshot)

**Research:** Embed *structured intent* instead of raw text. Queries become near-perfect matches.

**Idea:** Instead of:
```
embed("UBER *TRIP 03/04 SAN FRANCISCO")
```
Embed a structured representation:
```
{ merchant: "uber", category: "transportation", type: "rideshare", recurring: false }
```

**Query "rides last week"** → embed same structure → cosine match on intent space.

**Implementation options:**
- A) JSON serialization → embed the stringified struct (simple)
- B) Multi-vector: one for merchant, one for category, combined at query time
- C) Train a small fintech-specific embedding model on (query, tx) pairs

**Phase:** 3 (experimental)

---

### 5. Knowledge Graph (explainable + powerful)

**Research:** Build merchant→category, merchant→type relationships. "Subscriptions that increased" = graph traversal.

**Coconut application:**
- Nodes: merchants, categories, subscription merchants
- Edges: merchant → category, merchant → "is_subscription", category → parent_category
- Query "streaming spend" → traverse to [Netflix, Hulu, Spotify] → sum

**Implementation:**
- Maintain `merchant_metadata` table: merchant_name, category, is_subscription, merchant_type
- Populate from Plaid + LLM enrichment
- Graph queries via recursive CTE or Neo4j (if scale demands)

**Phase:** 3

---

### 6. Agentic Reasoning (ReAct + SQL)

**Research:** DSPy, Self-Refine — LLM plans, runs queries, verifies, refines.

**Flow:**
1. LLM: "User wants transportation spend in SF. I need: category=TRANSPORTATION, location SF."
2. Run query → 0 results
3. LLM: "No location in DB. Relax location, try category only."
4. Run again → results
5. LLM: "Got it. Sum = $X. Answer: ..."

**Pros:** Handles ambiguity, self-corrects.  
**Cons:** Latency (multi-round), cost, complexity.

**Phase:** 4 (future)

---

### 7. ColBERT (token-level embeddings)

**Research:** Match query tokens to doc tokens. Handles "uber rides" → "UBER *TRIP" well.

**Reality check:** Heavier compute, custom index. Pinecone/Weaviate support it. Supabase pgvector does not natively. Would need separate ColBERT service or Vespa.

**Phase:** 4 (only if others insufficient)

---

## Recommended Phased Roadmap

### Phase 1 — Quick Wins (1–2 weeks)
1. **Merge PR #56** — data-aware merchant resolution, final-pass LLM filter
2. **Embedding coverage** — ensure embed runs on every sync; add coverage logging
3. **Intent cache** — cache `extractIntent` for identical/similar queries (5 min TTL)
4. **Structured answer synthesis** — optional LLM pass to generate natural language from results (instead of template)

### Phase 2 — Hybrid + Rerank (2–4 weeks)
1. **Full-text search** — add `tsvector` on transactions, BM25 for keyword-heavy queries
2. **Hybrid fusion** — when both ILIKE and vector return results, use RRF to merge
3. **Neural reranker** — Cohere Rerank or BGE after retrieval (top 50 → top 10)
4. **Route by query type** — "Uber" → ILIKE only; "rideshare" → vector+BM25+rerank

### Phase 3 — Structured Intelligence (1–2 months)
1. **Financial intent embeddings** — pilot: embed `{merchant, category}` struct, compare vs text embedding
2. **Merchant metadata table** — canonical merchant→category, is_subscription, type
3. **Knowledge graph lite** — merchant→category edges for "coffee" → [Starbucks, Dunkin, ...]
4. **Multi-step queries** — "compare this month vs last" → two queries, LLM compares

### Phase 4 — Agentic (future)
1. **ReAct loop** — plan → query → verify → refine
2. **Self-correction** — if 0 results, relax filters and retry
3. **Explainable answers** — "I looked at X, Y, Z and found..."

---

## Tech Stack Summary (Target State)

| Layer | Technology |
|-------|------------|
| Database | Postgres + pgvector |
| Keyword | tsvector + GIN (BM25) |
| Dense | text-embedding-3-small (or financial-intent vectors) |
| Fusion | Reciprocal Rank Fusion |
| Rerank | Cohere Rerank or BGE-reranker-v2 |
| Intent | gpt-4o-mini (extract) + optional refinement |
| Answer | Template (Phase 1) → LLM synthesis (Phase 2+) |

---

## Success Metrics

- **Accuracy:** % of queries where top-5 contains what user wanted (manual eval set)
- **Latency:** p95 < 2s for search
- **Cost:** < $0.01 per search (embedding + 1–2 LLM calls)
- **Coverage:** Embedding coverage >90% for active users

---

## References

- SQL-PaLM, DIN-SQL (text-to-SQL)
- ColBERT (token-level retrieval)
- SPLADE, BM25 (sparse retrieval)
- Cohere Rerank, BGE-reranker (neural reranking)
- DSPy, ReAct (agentic reasoning)
