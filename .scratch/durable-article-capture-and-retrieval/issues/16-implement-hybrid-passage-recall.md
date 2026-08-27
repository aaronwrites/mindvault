# 16: Recall Knowledge Items through hybrid Passage ranking

**What to build:** A query finds captured knowledge through both vague conceptual memory and exact technical language, returning Knowledge Items with grounded evidence rather than standalone chunks.

**Blocked by:** 15: Make Knowledge Items Ready only after trustworthy indexing.

**Status:** resolved

- [x] Lexical and semantic Passage rankings are fused before Passage matches are aggregated into final Knowledge Item scores.
- [x] Capture Context receives a deliberate ranking boost, verified with a fixed corpus where the expected ordering is chosen independently of the ranking formula.
- [x] Search returns Knowledge Item identity, strongest matching excerpts, Passage origin context, Source provenance, and ranking information suitable for presentation.
- [x] The client renders grounded excerpts and original-address actions, supports conceptual and exact-language examples, and explains empty or failed searches in plain language.

## Comments

- Implemented hybrid PostgreSQL Passage Recall with reciprocal-rank fusion, Capture Context weighting, semantic relevance filtering, Knowledge Item aggregation, grounded excerpt/provenance contracts, and the Recall UI. Fixed-corpus API coverage exercises conceptual Recall, exact technical language, Context ordering, and an empty result. Full API suite (51 tests), API typecheck, client tests, client typecheck, and client lint pass.
