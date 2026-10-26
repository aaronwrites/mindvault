# Retained PDF processing

Ticket 01 adds native selectable-text extraction for uploaded and already-retained PDFs. OCR is ticket 02; full page-target citation actions and collection-wide PDF Synthesis are ticket 03. Other Original File kinds remain Unsupported. No automatic backfill runs: use **Process PDF** on an existing retained item (the existing `POST /knowledge-items/:id/refresh` action). New PDF Captures schedule the normal staged Processing Attempt in the Capture transaction after storage succeeds.

## Runtime

Run `bun install` in `api/`. The worker also needs **Node.js >=22.13 or >=24** on PATH (validated with Node 24.21.0). `PDF_NODE_EXECUTABLE` can select an absolute Node executable. Bun still runs the API and worker. PDF.js 6.4.299 is the single new direct dependency; its legacy Node build runs in a separate process. It supports extraction and later rendering without requiring a system PDF CLI. See [PDF.js API](https://mozilla.github.io/pdf.js/api/draft/module-pdfjsLib.html). OCR and rendering acceptance are deferred to the next ticket.

The worker reads bounded bytes through OriginalFileStorage, verifies their SHA-256, and sends them to the parser on stdin. Cloudinary reads use private expiring authenticated access inside the provider, without exposing provider locators or signed URLs in knowledge contracts. The parser receives no application secrets or Source URLs. It executes neither embedded scripts nor password workflows and requests no remote fonts. Existing private Open/Download and cleanup operations are unchanged. See [Cloudinary authenticated access](https://cloudinary.com/documentation/control_access_to_media).

## Processing limits

All numeric settings must be positive integers. Defaults:

| Setting | Default | Outcome at limit |
| --- | --- | --- |
| `PDF_MAXIMUM_BYTES` | 52,428,800 (50 MiB) | Reject processing before parsing; stream reads enforce this independently of Content-Length |
| `PDF_MAXIMUM_PAGES` | 200 | Reject the entire extraction before visiting pages |
| `PDF_MAXIMUM_CHARACTERS` | 1,000,000 | Fail extraction explicitly rather than index a prefix |
| `PDF_TIMEOUT_MS` | 30,000 | Bound the storage read and, separately, parser execution; terminate the parser on timeout |
| `PDF_HEAP_MIB` | 256 | V8 old-space heap ceiling in the isolated parser; abnormal exits report a memory/output failure |

The heap setting is not a total resident-memory quota: input buffers, PDF.js native allocations, and the runtime add overhead. Input/output caps, sequential page processing and cleanup, and the process timeout provide additional bounds. Deployments needing an absolute resident-memory ceiling should run the worker under an OS/container memory limit. Native extraction does not render page images; its blank-page inspection caps PDF.js decoded image size at 16 million pixels and conservatively marks uncertain pages as requiring OCR. OCR/rendering work limits will be selected in ticket 02.

The existing 28,000-byte generation budget remains. A PDF prompt that cannot include all obtained text and Capture Context fails enrichment explicitly; the item stays Ready from indexed evidence. The API and card expose stage warnings and Organization incomplete after tag retries. No whole-document summary is generated from an omitted prefix. Automatic retries and manual retries use the existing stage/lease mechanics.

## Evidence and availability

Snapshots store ordered physical pages, optional printed labels, native extraction method, text, and page outcomes. Web provenance columns become nullable to represent file evidence honestly; existing values, hashes, passages and indexes are retained. PDF hashes include page text, provenance and outcomes. A repeated extraction reuses the Snapshot and deterministic Passages even if the submitted filename changes. Passages never span PDF pages. Capture Context remains separately authored and has no PDF Page Reference.

Short label-only or replacement-character text is conservatively marked as needing OCR. A page with no drawing content is blank; a parser error is failed. Useful native pages can become Ready with disclosed gaps. Enrichment receives the gaps and a limitation on visual relationships. This is textual extraction, not visual understanding or a guarantee of reading order for complex layouts. Activation preserves previously useful page text when a later attempt obtains less evidence; older immutable evidence and indexes remain available.

## Verification

The HTTP API/PostgreSQL/real-worker suite parses valid original PDFs from `api/test/fixtures/pdf/` with deterministic storage and AI providers. It covers no-note Capture, existing retained PDFs, native extraction, differing physical/printed page positions, conceptual and exact-language Recall, deduplication, blanks and native gaps, malformed/encrypted/empty documents, byte/page/text/time limits, transient storage retry, failed Refresh preservation, generation overflow, and Trash/Restore. Migration verification preserves existing webpage provenance, text-search matches and embedding records. Client checks cover processing an existing retained PDF and displaying enrichment while keeping Original File actions.

The fixtures are generated with ReportLab and pypdf for development only; `generate.py` records the source. The 40-page fixture exercises the generation boundary with actual parsed evidence. Live external Cloudinary checks remain opt-in. This ticket does not establish OCR quality or real-model factuality; the milestone's live OCR/Ollama acceptance remains ticket 04.
