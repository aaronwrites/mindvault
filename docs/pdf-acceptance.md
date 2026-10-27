# PDF quality acceptance — 2026-10-27

The bounded PDF milestone uses retained PDF bytes, actual PDF.js extraction/rendering, local Tesseract OCR, PostgreSQL hybrid retrieval, the real worker, and local Gemma 3/Nomic Embed Text. Storage in this assessment is the deterministic private-storage adapter, as required by the finalized specification. It retains actual fixture bytes and exercises signed Open/Download, expiry/signature validation and physical page targeting. Live Cloudinary delivery remains opt-in; this assessment does not claim a browser viewer or external Cloudinary check.

## Reproduce

Install the worker runtimes described in [PDF processing](pdf-processing.md), start PostgreSQL with pgvector and Ollama with the configured models, and provide `TEST_DATABASE_URL` for an account allowed to create and drop isolated test databases. From `api/`, run:

```sh
bun run test:pdf-live
bun test --timeout 20000
bun run typecheck
```

The live check is skipped unless `RUN_LIVE_PDF_CHECK=1` and `TEST_DATABASE_URL` are set; `test:pdf-live` sets the former. A successful live check still needs inspection: read `PDF_ACCEPTANCE_REPORT` in stdout against the fixture source. The report includes model digests, API projections, real extracted excerpts, Recall ranks, questions, answers, citations, coverage and generation inputs. It contains fixture data, never real personal captures. Each PDF answers a question and follow-up while other collection items are in Trash, then all items are restored for collection-wide Synthesis. No production database is processed. The test uses three bounded worker attempts with retry delays shortened to 1 ms; model timeouts, input ceilings and PDF resource limits retain their defaults.

Client verification, from `client/`:

```sh
bun test
bunx tsc --noEmit
bun run lint
```

This session used an existing local preload to supply the test database environment; the preload is not a repository dependency and credentials are not recorded here. Full-suite runner timeouts accommodate database timing independently of production PDF deadlines.

## Runtime and corpus

Validated runtime: Bun 1.3.14, Node 24.21.0, PDF.js 6.4.299, Tesseract 5.5.3 with English data and Leptonica 1.87.0, PostgreSQL with pgvector. Rendering uses PDF.js's installed optional canvas package. No new runtime dependency was added for acceptance.

- Gemma 3: `a2af6cc3eb7fa8be8504abaf9b04e88f17a119ec3f04a3addf55f92841195f5a`
- Nomic Embed Text: `0a109f422b47e3a30ba2b10eca18548e944e8a23073ee3f3e947efcf3c45e59f`

The corpus is deliberately small, synthetic, English and repository-owned. [generate.py](../api/test/fixtures/pdf/generate.py) records the selectable text and raster construction using ReportLab, pypdf, Pillow and macOS Courier New, solely for fixture development. These dependencies are not worker requirements. Fixture identifiers such as `WAL_RECOVERY_TARGET` are test evidence, not a claim that a PostgreSQL setting exists. The local webpage comes from [the Source fixture server](../api/test/support/source-fixture-server.ts), `/articles/semantic-retention`.

| Fixture | Provenance and expected evidence | Observed extraction |
| --- | --- | --- |
| `selectable.pdf` | Two native-text technical pages; physical 1/2 labeled `i`/`1` | Correct readable order, native text on both pages; exact identifier and SQL preserved |
| `printed-scan.pdf` | Five English checklist/code lines rasterized into an image-only PDF; no selectable text layer | All five lines recovered in order, including `SCAN_RECOVERY_MARKER` and `SELECT pg_switch_wal();` |
| `mixed.pdf` | Native page, same printed scan, short diagram label/shapes, empty page | Physical 1 native/extracted; 2 OCR/extracted; 3 OCR/unreadable with reason; 4 none/blank; useful text Ready |
| `no-evidence.pdf` | Diagram/label without supported prose | Needs attention with explicit no-trustworthy-text reason; retained original, no generated summary |
| `reading-order.pdf`, `scan-with-footer.pdf`, `scan-native-code.pdf` | Reversed drawing order; scan beneath native footer; native punctuation/code over raster | API regressions preserve physical reading order, recover scan body and retain exact native code without duplicate OCR copies |
| `encrypted.pdf`, `malformed.pdf`, `empty.pdf`, `scan-blank.pdf`, `blank-pages.pdf` | Password protection, invalid bytes, empty content and white raster | Specific no-evidence/failure outcomes, retained bytes and access; blank and unreadable pages distinguished |
| `generation-limit.pdf`, `coverage-limit.pdf` | 40 repeated native pages; 200-page coverage stress fixture, with source in `generate-coverage-limit.py` | Explicit enrichment or Synthesis budget errors; useful indexed evidence remains retrievable |

## Limits and preserved contracts

[PDF processing](pdf-processing.md#processing-limits) is the authoritative setting table. Defaults are 50 MiB, 200 pages, one million extracted characters, separate 30-second storage/parser deadlines and a 256 MiB V8 old-space ceiling. OCR defaults are 20 candidate pages, 150 DPI, eight million pixels per page, 80 million cumulative pixels and five seconds per invocation with at most two invocations per candidate page. Heap/output-canvas bounds are not a hard resident-memory guarantee; enforce an OS/container quota when needed. No limits were raised to obtain acceptance.

Generation retains the 28,000-byte complete-input ceiling, 32,768-token context, 2,048-token output, 180-second generation timeout and 60-second nontruncating embedding timeout. Existing HTTP/worker checks demonstrate explicit byte/page/text/time/heap failures, bounded OCR gaps, retained Ready evidence after reduced processing, and a searchable oversized document with failed whole-document enrichment. The 200-page follow-up check returns recoverable HTTP 422 rather than silently discarding coverage. Historical real boundary probes recorded in the processing document accepted 200 native pages, rejected 201, and extracted 20 scan pages while disclosing page 21 as unprocessed.

The retained-PDF scenario removes pre-adapter processing artifacts as fixture setup, observes Unsupported through HTTP, then explicitly processes the same item without reupload or a new Capture. Three documents produce exactly three stored originals. Recall and returned citations preserve physical page 2 despite printed label `1`; private Open returns a signed target ending in `#page=2`. Each PDF also exercises inline Open and attachment Download and rejects an unsigned storage URL. Client tests retain visible page/excerpt fallback; honoring the fragment in every browser remains outside the application guarantee.

## Quality assessment

Initial inspection caught a real Ollama summary failure (`HTTP 500`, token repeat limit), exposed as a warning while the scan remained Ready with OCR and tags. The acceptance runner now permits the normal bounded attempt count. A later run recovered complete enrichment. Another inspection found a mixed-PDF answer quoting two supplied pages but returning only one page citation, and no verbal acknowledgement of incomplete coverage. Closing generation instructions now require citations for every used evidence item and explicit unread physical pages. PDF summary instructions were simplified after another run exposed character-count commentary and repeated generation failures; they request an explicit partial-text qualification and keep structured formatting inside the Ollama adapter. Prompt changes did not reliably make answers acknowledge gaps, so the API now prepends a deterministic notice for each distinct cited partial Snapshot, identifying physical pages with missing text. An existing HTTP regression failed before this change and passed afterward. These are bounded grounding improvements, not a guarantee of arbitrary model factuality.

The initial scan follow-up asked what command switches a log segment. The scan only prints SQL, without stating its effect; expecting that answer would reward outside knowledge. The final contextual follow-up asks which SQL statement appears in the captured recovery procedure, a fact explicitly present in all three PDFs. Exact Recall independently verifies the identifiers and SQL text.

## Recorded outcome: acceptance incomplete

The [retained assessment record](pdf-acceptance-results.json) preserves actual inputs, excerpts, API projections and answers from the completed run (58,513 ms overall; 123 transport assertions passed). It is **rejected for factuality**, not evidence that the milestone passed. The record uses synthetic fixture URLs on an ephemeral local port and contains no signed storage URLs or credentials.

| Observation | Actual result |
| --- | --- |
| Retained selectable PDF | Ready; native evidence; summary: “This guide details PostgreSQL recovery using WAL and transaction log management.” Tags include Backup, PostgreSQL Recovery, Transaction Log and Write-Ahead Logging. Both native pages are retrievable; SQL follow-up cites physical page 2, printed label `1`. |
| Printed scan | Ready; five exact OCR lines and grounded cited SQL follow-up on physical page 1. Summary: “This document outlines a PostgreSQL recovery checklist using WAL replay and scan procedures.” The **scan procedures** phrase is unsupported: `SCAN_RECOVERY_MARKER` names an identifier, not a scanning workflow. |
| Mixed PDF | Ready with physical page 3 unreadable and 4 blank. Summary explicitly begins “From partially extracted PDF text”. Answers and follow-ups include a deterministic missing-page notice. The main answer invents **`WAL_RECOVERY_MARKER`**, absent from supplied evidence. Physical page 2 says `SCAN_RECOVERY_MARKER`; physical page 1 says `WAL_RECOVERY_TARGET`. Citation resolution alone cannot detect that fabricated combination. |
| Collection-wide answer | Actual web and PDF evidence supplied together; returned citations cover native/OCR pages and the webpage. The answer's base-backup/WAL and durable Source Snapshot claims are supported by supplied excerpts. Partial PDF disclosure remains visible. |
| Unsupported visual question | Actual generation received five evidence items, including partial PDF coverage. It returned `insufficientEvidence: true` with no citations and no invented visual relationship. Its literal answer “InsufficientEvidence true” is awkward presentation but an honest refusal. |
| No-evidence document | Original retained; Needs attention with “no trustworthy selectable text or printed English OCR evidence”; no Recognition Summary. |
| Recall and access | Every format returned conceptual and exact matches, no-note Capture remained supported, and Original File Open/Download/page-target checks passed. |

This is why the opt-in runner now checks that uppercase underscore-separated identifiers in an answer occur literally in its cited excerpts, in addition to returning a report for human factuality inspection. This narrow check does not validate arbitrary paraphrases or summaries. The original broad recovery question is retained; it was not narrowed to conceal the failure.

Ticket 04 and the parent milestone remain **incomplete**. Follow-up `.scratch/pdf-understanding/issues/05-correct-live-pdf-grounding.md` records the remaining grounding work. Preserve these counterexamples when evaluating a correction; further prompt tuning without a repeated actual-output assessment is insufficient.

## Verification and limits of acceptance

Client: **30 passed**, TypeScript and lint passed. API TypeScript and seven focused Ollama provider checks passed. The focused HTTP PDF Synthesis regression passed **2 tests / 29 assertions** after its recorded red run, including deterministic partial-coverage disclosure and existing page access, mixed evidence, recoverable limits, follow-ups and Trash behavior. The stricter live run passed **126 assertions** in 62,001 ms. Its mixed answer used supported identifiers, but its scan summary still invented “a scan procedure”; manual quality acceptance therefore still failed. Both runs are retained in the assessment record. Final full API/PostgreSQL/real-worker suite: **146 passed, 3 opt-in checks skipped, 0 failed**, 704 assertions, 244.55 s. This fresh process includes the final deterministic coverage correction and identifier gate. Session logs: `/private/tmp/mindvault-ticket04-api-complete.log` and `/private/tmp/mindvault-ticket04-live-gate.log`; durable quality evidence is retained in the linked JSON record.

The final full API suite covers migration from empty and legacy databases, retained-file access/lifecycle cleanup, Trash/Restore/permanent deletion, URL Capture/Recall/Synthesis, storage failures, reduced-extraction preservation, OCR runtime recovery, resource limits and generation-input overflow. External Cloudinary delivery remains skipped under the existing opt-in contract. No new migration was necessary for this ticket. Final whitespace checks passed. Two-axis review: Standards **0 remaining findings** after the provider-boundary correction; Spec **1 unresolved P1**, unsupported real-model PDF claims. This is the recorded acceptance failure, not a closed milestone.

These clean synthetic fixtures establish bounded printed English extraction and readable order, not damaged-scan accuracy, complex reading order, multilingual OCR, handwriting, mathematics or visual interpretation. Real-model factuality and retrieval precision are not universal guarantees. In this run factuality has a concrete in-scope failure, so adapter expansion remains behind the quality gate rather than being declared unblocked.
