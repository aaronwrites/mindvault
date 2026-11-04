# Warm editorial redesign validation

Validated 2026-11-04. This supersedes the earlier visual acceptance notes for the neutral/red outlined design. Earlier review artifacts are retained.

## Automated checks

- `cd client && bun test`: 110 passed, 0 failed across 5 files.
- `cd client && bun run lint`: passed.
- `cd client && bunx tsc --noEmit`: passed.
- `cd client && bun run build --webpack`: passed; all application routes compiled and page generation completed.
- `git diff --check`: passed.
- Impeccable detector over `client/app` and `client/components`: no deterministic findings.

The default `bun run build` failed because Turbopack's CSS worker could not bind a local port in this environment, including after an escalated retry. The production build was verified with Next's supported Webpack option. No package scripts or runtime dependencies were changed to work around this environment issue.

## Browser evidence

Used installed Chrome through Playwright with isolated API fixtures; no real Knowledge Items were created, modified, or deleted. Fixture content deliberately includes text-heavy items, long titles, a broken preview, unsupported retained files, incomplete organization, and a partially extracted PDF. Images in these review captures are illustrative fixture previews, not product assets or generated document covers.

Inspected desktop (1440 × 1000) and mobile (390 × 844) together in Light and Dark. Captured collection, item details, capture, Ask, citation details, search, and Trash. The final confirmation uses viewport screenshots for overlays so browser full-page capture does not misrepresent fixed-position elements.

- No horizontal document or dialog overflow in either theme.
- Desktop details: 1120px wide, centered with a 32px viewport gutter.
- Mobile details and Ask: full viewport, x=0, y=0; reading content scrolls internally.
- Ask keeps its composer below a scrollable conversation.
- Citation → item → close restores the citation's focus in all four viewport/theme combinations.
- Failed follow-up preserves the prior answer and the question for retry.
- Search displays visible matching excerpts, physical PDF pages, and extraction limitations.
- Missing/broken images become text cards; filenames and long titles wrap.

Additional layout checks cover 320, 640, 720, 1024, and 1280px in both themes, sparse collections, an empty collection, reduced-motion preference, and theme persistence after reload. The 720px viewport verifies desktop reflow corresponding to a 1440px viewport at 200% zoom. No horizontal overflow was found. Header controls meet 44px targets; shared button and filter targets are at least 44px. Lora and Manrope load locally with fallbacks and license notices.

## Behavior coverage

The existing suite retains durable capture, editable-field paste protection, independent batch retries, duplicate recognition, stale-search protection, relevance order and filters, hash/Back/Escape navigation, restored focus, citation layering, failed follow-ups, summary provenance, PDF coverage, background updates, title/note/tag draft recovery, Trash, Undo, restore, and permanent deletion recovery. New cases cover mixed card treatments, broken-image fallback, visible organization exceptions, and independent header Add/Ask dialogs with focus restoration.

The two asynchronous Trash scenarios use a 10-second test deadline to accommodate polling and nested-dialog focus restoration; their assertions and recovery requirements remain intact.

## Review fixes — 2026-11-04

- Ask's introduction and disclosures now scroll with the conversation while the composer remains anchored. Browser checks at 390×400 (Light and Dark) and 720×400 confirm the submit button ends at y=380 within the 400px viewport, with 215px remaining for scrolling content. Initial empty conversations start at scroll position zero. These short-height checks supplement the earlier width-only zoom approximation; actual browser zoom was not exercised in this follow-up.
- At 800px width, paste/drop guidance is visible beside Add without horizontal overflow.
- Both card action menu entries measure 44px high after their opening transition.
- A regression test verifies Organization incomplete stays visible alongside Ready through collection → search → clearing search.
- Full client suite: 111 passed, 0 failed. Lint, TypeScript, Webpack production build, diff whitespace checks, and the targeted design detector passed. A partial four-file test invocation produced four capture-dialog failures; the normal full-suite invocation passed, indicating test-order sensitivity outside these fixes.
