# Use hybrid Passage retrieval

MindVault combines vector similarity with PostgreSQL text search over Passages, then aggregates those matches into Knowledge Item results. This supports both vague conceptual memory and exact technical identifiers while keeping retrieval in PostgreSQL and pgvector rather than introducing a separate search service.
