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

## Partial closeout assessment — 2026-10-26

A local model check used the production parser, Recognition Summary prompt, and
Ollama providers on fixture evidence from eight Sources: primary processing,
logical replication metadata, account security, command-line identifiers,
PostgreSQL text search, a climate studio homepage, database recovery metadata,
and durable Source retention. This was a provider/parser check, **not** an
API/PostgreSQL/worker acceptance run. The PostgreSQL server refused connections
to `192.168.0.111:5432`, including outside the sandbox; milestone acceptance
remains open. The test harness creates disposable databases through `postgres`,
so creating a database named `mindvault-test` does not resolve that TCP failure.

With the revised metadata prompt, Gemma 3 produced:

- Title-only replication evidence: “A page about how PostgreSQL logical
  replication keeps read models current.” No read-replica synchronization claim.
- Homepage description: “A page about Signal Garden.” Grounded, but less
  recognizable than the available description.
- Database recovery description: “A page about recovering a PostgreSQL database
  after an accidental schema migration.” Grounded in the description.

The eight-item embedding comparison retained the intended first result. For the
conceptual failure-visibility query, primary processing scored 0.3072 and Source
retention 0.3317, while unrelated replication metadata (0.3848), account security
(0.3880), and command-line text (0.3968) also crossed the existing 0.4 cutoff.
For the replication query, its metadata scored 0.2513; generic retention text
also crossed 0.35 at 0.3437. The rainfall question's closest candidate scored
0.4688, outside the cutoff. Keep the cutoff unchanged: lowering it would not
establish a general relevance guarantee, and generation still must restrict
claims to supporting evidence. The expanded API live check records the same
collection for later end-to-end assessment.

The first contextual rewrite left “What does it preserve?” unchanged. After
adding a concrete reference-resolution example, the real provider returned
“What does MindVault preserve when processing fails?” for the prior failure
visibility conversation. A separate unrelated capital-of-France question stayed
unchanged. This checks interpretation only; fresh retrieval, cited answers,
follow-ups, tags, and lifecycle regressions still need database-backed execution.
The installed model digests match the 2026-09-08 record above.
