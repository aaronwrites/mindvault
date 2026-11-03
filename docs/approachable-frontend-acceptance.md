# Everyday frontend acceptance — 2026-11-03

Ticket 06 closes stage one of `.scratch/approachable-frontend/spec.md`.
The integrated journey passes the bounded acceptance below. Stage two (persistent
editing and the stronger TL;DR contract) remains separate; generated descriptions
continue to be labelled **Preview**.

## Reproduce

Use the installed Bun dependencies and a reachable PostgreSQL/pgvector instance.
`api/.env` must supply `TEST_DATABASE_URL` for the existing isolated-database
harness. It creates and migrates a fresh `mindvault_test_*` database, never the
user's application database. PDF processing uses the same Node/Tesseract setup
as [PDF processing](pdf-processing.md).

In separate terminals:

```sh
cd api
bun scripts/everyday-acceptance.ts
```

```sh
cd client
NEXT_PUBLIC_API_URL=http://localhost:4000 bun run dev --port 3000
```

Keep port 4000 free of the normal API. Open `http://localhost:3000`.
The acceptance API binds only to loopback, uses the real Express routes,
PostgreSQL retrieval and processing worker, and substitutes deterministic AI and
in-memory Original File storage. Signed file access serves the retained PDF
bytes locally, including the normal `#page=N` redirect. Stop the harness with
Ctrl-C to close its listeners and drop its disposable database.

The harness seeds an image-led webpage, a webpage with unavailable preview media,
a metadata-only webpage, `selectable.pdf`, `partial-native.pdf`, and
`encrypted.pdf`. It prints an additional webpage URL to save through Add or paste.
The PDF fixtures live in `api/test/fixtures/pdf/` and can also be selected together
in Add. The worker drains automatically every two seconds.

To simulate one failed request, run this before its UI action:

```sh
curl http://localhost:4000/__acceptance/fail-next \
  -H 'Content-Type: application/json' -d '{"path":"/captures/file"}'
```

Use `/captures` for a link failure, `/search` for search, `/synthesis` for Ask,
or `/knowledge-items` for loading the board. Each injection fails only the next
request to that exact path; automatic board retries may consume a loading failure.
The deliberately technical diagnostic must never appear in visible feedback.

## Acceptance observations

Browser checks used the in-app browser at 1280×900 and 390×844. Phone checks used
responsive sizing and click-accessible touch controls, not a physical touch device.
The browser pass used the same harness; extra webpage fixtures were added through
its public Capture endpoint during the pass.

| Journey | Observed result / regression evidence |
| --- | --- |
| Save a webpage | Add on the phone layout accepted the printed fixture URL without metadata. Saving feedback preceded a durable card; background processing produced a recognizable title and Preview. Original access remained available. |
| Save PDFs and recover a partial batch | Selected `selectable.pdf` and `partial-native.pdf` together with the next file request deliberately failed. The failed filename had explicit Retry feedback, the other request succeeded, and retry retained both saves. The Home cross-feature test also asserts the exact submitted file sequence, including only the failed file on retry. |
| Find and inspect | Searching `archived WAL` returned `selectable.pdf` with its physical page 2 excerpt and printed label 1. Search did not open Ask. Keyboard Enter opened details; browser Back preserved the query/results. Existing tests retain server relevance order and newest-first browse order. |
| Complete and partial PDF evidence | `selectable.pdf` disclosed 2/2 extracted pages. `partial-native.pdf` disclosed 1/3, the unread page, and lack of visual interpretation. Both retained Open original and Download; no TL;DR claim appeared. |
| Processing limitations and missing previews | Password-protected PDF feedback explains saving an unlocked copy; unavailable images use the existing text/title fallback. Metadata-only descriptions disclose that the full webpage was unavailable. Tests cover processing completion, failed refresh, unsupported files, retry, and retained Ready evidence. |
| Ask and citations | `archived WAL` produced an answer with the saved PDF excerpt, physical page 2, printed label 1, and direct PDF-page action. Cited details opened above the conversation on desktop and phone; Back returned to the answer and citation focus. |
| Ask outage | A deliberately failed follow-up retained the earlier answer/citation and question, showed safe failure copy, and allowed retry. A later insufficient-evidence response was explicit. |
| Remove, Undo, restore | The phone three-dot menu removed the test webpage without confirmation. Undo restored it. A second removal, Board menu → View Trash → details → Restore returned it to active saves. Existing client/API tests enforce Trash exclusion from retrieval and answers, stale-answer clearing, concurrent removals, and permanent-deletion confirmation/recovery. |
| Phone layout and position | Detail and Ask bounds measured exactly 390×844, with no horizontal overflow. Partial PDF details had 952px scrollable content in an 844px viewport. Opening and closing details with browser Back preserved board `scrollY=364`; touch Close restored focus to the same card. |
| Desktop and keyboard | Desktop details measured x=304, y=45, width=672, height=810 in the 1280×900 viewport. Enter/Escape and explicit Close worked; search and nested-dialog focus restoration remained coherent. Existing interaction tests exercise keyboard card actions, overlays, focus return and conversation scroll retention. |
| Cross-feature outages | The new Home regression keeps a successful file available through a failed batch, unavailable search and Ask, clearing search, and retrying just the failed file; retained original access still works. |

Screenshots: [desktop details](acceptance/everyday-desktop.jpg),
[phone details](acceptance/everyday-phone.jpg). PDF coverage is below the preview
and remains reachable by scrolling the detail view.

## Corrections made during acceptance

- Replaced raw board-load diagnostics with everyday copy and an explicit retry.
- Kept processing-action failures with their affected details instead of exposing
  raw diagnostics across the board or other saves.
- Replaced internal terminology in Recall, Ask, accessible labels, and deletion
  copy; retained the distinction between saved text, selected text, personal
  notes, website descriptions, and generated Preview.
- Made the existing failed-deletion recovery test use its manual worker clock.
  Queue defaults use PostgreSQL's clock; a slightly advanced database host could
  otherwise leave newly queued work ineligible and assert Pending before the
  intended failing attempt ran. The regression now exercises failure and manual
  recovery deterministically without changing production behavior.

## Checks and limits

- Client: `bun test` — **65 passed** (2 files).
- Client: `bunx tsc --noEmit`, `bun run lint`, and
  `bun run build --webpack` — passed.
- API: `bunx tsc --noEmit` — passed, including the acceptance script.
- API full `bun test` — **159 passed, 3 skipped, 2 timed out**. The two cases hit
  the default five-second limit while using remote PostgreSQL. Their asynchronous
  cleanup also emitted two errors after timeout. Targeted recheck:

  ```sh
  bun test --timeout 20000 test/pdf-understanding.integration.test.ts \
    test/semantic-passages.integration.test.ts \
    -t 'storage failures retry successfully|keeps an item Ready when a Refresh fails'
  ```

  Both passed (about 3.7 and 3.6 seconds). The focused permanent-deletion suite
  also passed all 3 tests after the clock correction.
- Existing API coverage verifies hybrid ranking, PDF page redirects and signed
  access, partial evidence, Trash exclusions and recovery. No retrieval algorithm,
  citation semantics, production storage, schema, or model behavior changed.
- The three optional skips are live Ollama, live PDF/Ollama, and live Cloudinary.
  This is frontend integration acceptance, not a new live-model quality claim;
  see [PDF quality acceptance](pdf-acceptance.md) for prior actual model evidence.
- Native operating-system file dragging/pasting and physical touch hardware were
  not automated in the browser pass. Existing Universal Capture Area tests cover
  whole-page drop/paste, editable-field protection, overlay cancellation, and
  per-file retry. Phone on-screen keyboard behavior remains a device check.

## Review

Review against the stage-one starting commit `135de2c` used independent Standards
and Spec axes. Standards: 0 findings. Spec: 0 findings. No unresolved implementation
defects were identified within the recorded acceptance bounds.
