# Ollama acceptance

## Automated coverage

The deterministic suite retains injected providers and does not require Ollama.
Controlled HTTP-boundary tests cover structured generation, malformed output,
embedding task prefixes, dimensions and normalization, missing models, timeouts,
oversized generation inputs, and server failures. PostgreSQL integration coverage
checks resumable replacement of incompatible embeddings and preservation of
retained Trashed knowledge. Worker integration coverage checks lease renewal for
slow inference and prevention of overlapping polls in one worker instance.

## Runtime limits

- Generation context: 32,768 tokens
- Generation output: 2,048 tokens
- Generation input ceiling: 28,000 UTF-8 bytes
- Generation timeout: 180 seconds
- Embedding timeout: 60 seconds with truncation disabled

The input byte ceiling is deliberately conservative and remains an accepted
limitation. Requests that exceed it fail explicitly rather than losing grounding
instructions or evidence.

## Live acceptance record — 2026-09-08

The opt-in check ran the actual worker and providers against an isolated database.

- Gemma 3 digest: `a2af6cc3eb7fa8be8504abaf9b04e88f17a119ec3f04a3addf55f92841195f5a`
- Nomic Embed Text digest: `0a109f422b47e3a30ba2b10eca18548e944e8a23073ee3f3e947efcf3c45e59f`
- Primary Capture: 5,486 ms; metadata-only Capture: 2,574 ms; inaccessible Capture: 65 ms
- Exact Recall: 58 ms; conceptual Recall: 46 ms
- Primary answer: 1,458 ms; metadata answer: 2,248 ms; follow-up: 2,707 ms; unanswerable question: 26 ms

The primary-content Capture became Ready with a useful summary and five relevant
tags. The metadata-only Capture became Ready without notes and produced three
relevant tags. Authentication-gated content became Needs attention with the
correct reason. Exact and conceptual Recall both returned the intended primary
Passage. Primary, metadata-only, and follow-up answers were grounded in resolvable
citations, and the out-of-collection rainfall question returned insufficient
evidence without invoking generation.

The current `0.4` semantic-distance cutoff needs more calibration. The intended
conceptual result scored `0.3073`, but the unrelated metadata Passage also crossed
the cutoff at `0.3847`. The exact result scored `0.3756` semantically and also had
a lexical match. Unanswerable candidates scored `0.5442` and `0.5458` and were
correctly excluded. This small corpus suggests evaluating a cutoff near `0.35`,
but it is not enough evidence to change the production value safely.

Quality acceptance remains open: the metadata-only Recognition Summary added an
unstated claim that read replicas stay synchronized with the primary database,
despite the source evidence containing only the title. Synthesis itself remained
within that title. Do not substitute another model silently; repeat acceptance
after addressing metadata-summary grounding and calibrating retrieval on a larger
representative corpus.

Run `bun run test:ollama-live` with `TEST_DATABASE_URL` set to repeat the check.
The provider switch does not close the URL-to-chat milestone or its reviewed
defects.
