# Trustworthy TL;DR acceptance

Ticket 10 of the approachable frontend plan. Bounded quality acceptance completed
on 2026-11-03 using installed local Gemma 3. Actual outputs, model digests,
processing durations, snapshot provenance and PDF coverage are retained in
[tldr-acceptance-results.json](tldr-acceptance-results.json).

## Contract and adoption

New primary-content summaries use `tldr-v1`. Local Ollama selects one to three
complete statements from the obtained primary text, totaling at most 320
characters including the deterministic partial-PDF qualification. The selection
prompt asks for substantive findings, conclusions, recommendations or how
something works. The application assembles those statements from retained text;
the model cannot substitute invented prose or draw claims from filenames,
titles or Personal Notes. Invalid indexes, duplicates, over-budget selections
and malformed responses fail after at most one correction. Complete supplied
statements preserve wrapped-line negations and conditions.

Metadata-only generation remains a Source Preview (`preview-v1`). The nullable
`generation_contract` migration leaves every existing description unverified;
there is no bulk relabeling or automatic backfill. Use the existing Refresh
action to regenerate a retained webpage or PDF without saving it again.

The API returns the summary's own Source Snapshot ID, contract, evidence type,
PDF coverage and whether that snapshot is current. Details shows **TL;DR** only
for a current `tldr-v1` primary-content summary. Legacy, metadata and earlier
snapshot descriptions use **Preview**. When a newer snapshot is activated but
its generation fails, the earlier text remains explicitly attributed to an
earlier saved version. Its PDF coverage is retained separately from the current
snapshot's coverage in Details.

Generation remains optional enrichment after retrieval indexing. Oversized
primary evidence fails rather than silently omitting text; failure/delay leaves
durable Capture and Ready retrieval intact. Personal Notes and corrections are
never updated by summary generation. Existing polling carries completed
Refresh/generation into an already open detail view.

## Reproduce

Start PostgreSQL with pgvector and the installed local Ollama server and models.
`api/.env` must supply `TEST_DATABASE_URL` with permission to create/drop isolated
test databases. PDF native/OCR runtimes follow [PDF processing](pdf-processing.md).
From `api/`, run:

```sh
RUN_LIVE_TLDR_CHECK=1 bun test test/tldr-ollama-live.integration.test.ts
```

The test runs the real API, worker, extraction, PDF native/OCR processing and
local summary model. It uses deterministic embeddings and Topic Tags to bound
this assessment to summary quality, plus a deterministic storage substitute.
It retains no production captures. `TLDR_ACCEPTANCE_REPORT` prints actual results.
This opt-in check is skipped in ordinary test runs.

## Explicit quality criteria

- Primary summaries state at least one substantive main point, rather than
  merely naming the source or listing its topics.
- Every selected statement is supported by obtained primary text. No invented
  procedure, technical identifier, visual relationship or Personal Note becomes
  a source claim.
- Full PDF summaries retain physical-page provenance through their snapshot.
  Partial PDF summaries qualify the evidence and disclose unread pages and lack
  of visual interpretation in Details. Blank pages remain distinct from gaps.
- Metadata-only output stays a limited Preview; legacy descriptions retain that
  label until regeneration.
- Summaries remain concise. Selection wording can include source headings or
  fixture commentary, but must contain substantive information.

## Actual model assessment

The final five-case run passed 27 automated assertions. Each output was also
reviewed against the fixture text and the criteria above:

| Case | Substantive output / assessment |
| --- | --- |
| Web processing | Describes extraction retaining primary text and discarding navigation, and Processing Attempts preserving a Capture despite failure. Grounded main points; source fixture phrasing is retained. |
| Web retention | Explains that durable snapshots keep article text available when the website changes or disappears. Includes a redundant fixture sentence, but the core causal point is substantive and grounded. |
| Metadata-only webpage | “A page about recovering a PostgreSQL database after an accidental schema migration.” Correctly stored as `preview-v1`, never TL;DR; adds no recovery procedure. |
| Full native PDF | States that `WAL_RECOVERY_TARGET` selects a recovery destination and that archived WAL supports restoring an earlier state. Both statements occur in the obtained physical-page text. A page heading remains attached to the second statement; quality passes with that presentation limitation. |
| Partial native/OCR PDF | States that write-ahead logging preserves committed transactions and that the base backup is restored before replaying archived WAL. Begins “From partially extracted PDF text:”. Physical page 3 remains unreadable, page 4 blank; no diagram claims or claims about unread text appear. |

Both PDF inputs deliberately attach a false Personal Note mentioning a flying
purple database and `MAGIC_RECOVERY_AUTOMATION`. Neither summary includes it.
The final output record is from the completed prompts. An earlier run also
passed; outputs varied in sentence selection without adding model-written claims.

This is bounded acceptance of representative fixtures, not a guarantee of
arbitrary-source quality. Extractive selection may retain awkward headings,
prefer a less central point, or fail when no complete statement fits the budget.
These cases keep Preview/failure behavior honest; summaries never replace
indexed evidence, PDF provenance, or Synthesis grounding.

## Regression verification

Summary HTTP regressions cover current provenance, legacy adoption, metadata
fallback, independent failure/delay, earlier-version provenance after a failed
Refresh, and preservation of custom titles, rejected/added Topic Tags and edited
Personal Notes. The PDF/web grounding regression rejects invalid model selections
while retaining searchable source evidence. Client interactions cover legacy,
metadata and earlier-version labels, partial PDF disclosure, and polling an open
Preview into TL;DR without another Capture. Full-suite results are recorded below.

Final checks:

- API and client TypeScript checks and client lint passed; `git diff --check` passed.
- Full API run (`bun test --timeout 20000`): 172 passed, 4 opt-in skips,
  1 failure from the exact Capture response assertion omitting the newly added
  `recognitionSummaryProvenance: null`. After updating that expectation, the
  complete affected Capture suite passed 5 tests / 25 assertions. No production
  change was needed. The full API run included the new partial-PDF provenance
  check and both webpage/PDF invalid-selection regressions.
- Full client run (`bun test --timeout 20000`): 78 passed / 465 assertions.
  The initial default-timeout run had two existing Trash tests exceed five
  seconds; both passed targeted rechecks and the full run with twenty seconds.
- Final real-model run: 1 acceptance test, 5 representative cases, 27 assertions.
- Separate code reviews against the initial implementation baseline
  `cf78d1e5ffeeca0a0d197d1e8950bcde8b763a7d`: Standards 0 findings; Spec 0
  findings. The final Capture expectation correction was also reviewed on both
  axes. No unresolved implementation findings remain.

The migration is generated and exercised in isolated test databases; it has not
been applied to the user's development database. Apply migrations with the
existing `bun run db:migrate` command before running the updated API/worker.
